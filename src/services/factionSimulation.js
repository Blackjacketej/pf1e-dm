/**
 * Faction Simulation Ticks
 *
 * When world-time advances (offscreen), factions don't sit still. They:
 *   - Pursue goals (ticking progress up based on resources and priority)
 *   - Shift mood in response to resource changes and recent events
 *   - Drift inter-faction relations (feuds smolder, alliances cool)
 *   - Spread rumors between factions they're in contact with
 *   - Leak secrets (with probability tied to leakRisk and hostile rumors)
 *   - Risk schisms when legitimacy is low and mood is bad
 *   - Generate ambient events (internal promotions, rituals, scandals)
 *
 * All deterministic when given a seeded RNG.
 *
 * Public API:
 *   tickFaction(faction, hoursElapsed, context)   — single faction tick
 *   tickCampaign(campaign, hoursElapsed, opts)    — tick every faction +
 *                                                   inter-faction dynamics
 */

import { setMood, inferMoodFromResources, advanceGoal, shiftRelation } from './factionLife.js';
import { tickNPCCrafters, craftEventToDeed } from './craftSimulation.js';
import { addCompletedItemToShop, findHomeShopForNpc } from './shopStocking.js';
import { recordDeed, createReputation } from './reputation.js';

// ══════════════════════════════════════════════════════════════════════════════
// Per-faction tick
// ══════════════════════════════════════════════════════════════════════════════

export function tickFaction(faction, hoursElapsed, context = {}) {
  if (!faction.life) return { faction, events: [] };

  const rng = context.rng || Math.random;
  const days = hoursElapsed / 24;
  const events = [];
  let updated = faction;

  // 1. Resource drift — based on archetype + morale + goals-in-flight
  updated = driftResources(updated, days, rng);

  // 2. Mood — reassess if resources shifted significantly
  const inferredMood = inferMoodFromResources(updated.life.resources);
  if (inferredMood !== updated.life.mood) {
    updated = setMood(updated, inferredMood, 'resource drift over time');
    events.push({ type: 'mood_shift', from: faction.life.mood, to: inferredMood, factionId: faction.id });
  }

  // 3. Goal progress — each active goal gets a probabilistic tick
  for (const goal of [...updated.life.goals]) {
    const tickAmount = computeGoalTick(goal, updated.life, days, rng);
    if (tickAmount > 0) {
      const res = advanceGoal(updated, goal.id, tickAmount);
      updated = res.faction;
      if (res.completed) {
        events.push({ type: 'goal_completed', goalId: goal.id, factionId: faction.id, narrative: goal.narrative });
      }
    }
  }

  // 4. Leadership stress — low legitimacy + bad mood → challengers grow
  updated = tickLeadership(updated, days, rng, events);

  // 5. Secrets — leak risk
  updated = tickSecrets(updated, days, rng, events);

  return { faction: updated, events };
}

function driftResources(faction, days, rng) {
  const res = { ...faction.life.resources };
  const mood = faction.life.mood;
  const archetype = faction.archetype;

  // Base daily drift
  const moodImpact = {
    triumphant:  +0.5,
    ascendant:   +0.3,
    confident:   +0.1,
    stable:       0.0,
    wary:        -0.05,
    beleaguered: -0.3,
    desperate:   -0.6,
    rebuilding:  +0.2,
  }[mood] || 0;

  // Archetype drift preferences
  const drift = {
    mercantile:  { wealth: +0.2 },
    martial:     { manpower: +0.1 },
    criminal:    { secrecy: +0.05, wealth: +0.1 },
    hoard:       { wealth: +0.1 },
    caravan:     { wealth: +0.15, influence: +0.05 },
    religious:   { influence: +0.05, morale: +0.05 },
  }[archetype] || {};

  for (const key of Object.keys(res)) {
    const base = (drift[key] || 0) + moodImpact * 0.1;
    const jitter = (rng() - 0.5) * 0.2;
    res[key] = clamp(res[key] + (base + jitter) * days, 0, 100);
  }

  return { ...faction, life: { ...faction.life, resources: res } };
}

function computeGoalTick(goal, life, days, rng) {
  // Base chance per day, scaled by priority and relevant resources
  const priorityMult = { low: 0.3, normal: 1.0, high: 1.5, critical: 2.5 }[goal.priority] || 1.0;

  // Resources relevant to the goal type
  const typeResourceMap = {
    territorial_expansion: ['manpower'],
    wealth_accumulation:   ['wealth', 'influence'],
    political_influence:   ['influence', 'wealth'],
    religious_conversion:  ['influence', 'morale'],
    knowledge_pursuit:     ['influence', 'wealth'],
    revenge:               ['manpower', 'secrecy'],
    survival:              ['manpower', 'morale'],
    legacy_building:       ['wealth', 'influence'],
    ritual_completion:     ['secrecy', 'morale'],
    prophecy_fulfillment:  ['morale', 'influence'],
  };

  const keys = typeResourceMap[goal.type] || ['influence'];
  const avgRes = keys.reduce((s, k) => s + (life.resources[k] || 50), 0) / keys.length;

  // Expected tick per day: 0.5–4 progress points, scaled
  const basePerDay = 0.5 + (avgRes / 100) * 3.5;
  const perDay = basePerDay * priorityMult;
  const amount = perDay * days;

  // Add small random jitter so ticks aren't identical
  return Math.max(0, amount + (rng() - 0.5) * amount * 0.3);
}

function tickLeadership(faction, days, rng, events) {
  const led = faction.life.leadership;
  if (!led || !led.current) return faction;

  const mood = faction.life.mood;
  const legitimacyPressure = {
    triumphant: -2, ascendant: -1, confident: -0.3, stable: 0,
    wary: +0.3, beleaguered: +1, desperate: +2, rebuilding: +0.5,
  }[mood] || 0;

  // Legitimacy drifts; low legitimacy invites challengers
  const newLegit = clamp(led.legitimacy - legitimacyPressure * days, 0, 100);

  let updatedLed = { ...led, legitimacy: newLegit };

  // If legitimacy falls below 30 and we have no challengers, one emerges
  if (newLegit < 30 && (!led.challengers || led.challengers.length === 0) && rng() < 0.1 * days) {
    updatedLed = {
      ...updatedLed,
      challengers: [`challenger-${Date.now().toString(36)}`],
    };
    events.push({
      type: 'succession_threat',
      factionId: faction.id,
      narrative: `A challenger has risen against ${led.current}`,
    });
  }

  return { ...faction, life: { ...faction.life, leadership: updatedLed } };
}

function tickSecrets(faction, days, rng, events) {
  const secrets = faction.life.secrets || [];
  if (secrets.length === 0) return faction;

  const updated = secrets.map(secret => {
    if (secret.exposed) return secret;
    const perDayRisk = secret.leakRisk || 0.02;
    const riskOverPeriod = 1 - Math.pow(1 - perDayRisk, days);
    if (rng() < riskOverPeriod) {
      events.push({
        type: 'secret_exposed',
        factionId: faction.id,
        severity: secret.severity,
        narrative: secret.narrative,
      });
      return { ...secret, exposed: true, exposedAt: new Date().toISOString() };
    }
    return secret;
  });

  return { ...faction, life: { ...faction.life, secrets: updated } };
}

// ══════════════════════════════════════════════════════════════════════════════
// Campaign-level tick (every faction + inter-faction dynamics)
// ══════════════════════════════════════════════════════════════════════════════

export function tickCampaign(campaign, hoursElapsed, opts = {}) {
  const rng = opts.rng || Math.random;
  const events = [];

  // 1. Tick each faction
  const factionsOut = { ...campaign.factions };
  for (const [id, faction] of Object.entries(factionsOut)) {
    if (!faction.life) continue;
    const { faction: ticked, events: factionEvents } = tickFaction(faction, hoursElapsed, { rng });
    factionsOut[id] = ticked;
    events.push(...factionEvents);
  }

  // 2. Inter-faction relation drift (feuds worsen, distant allies cool)
  const newRelations = { ...campaign.factionRelations };
  const days = hoursElapsed / 24;
  for (const [key, rel] of Object.entries(newRelations)) {
    const [fromId, toId] = key.split('->');
    const from = factionsOut[fromId];
    const to = factionsOut[toId];
    if (!from || !to) continue;

    let drift = 0;

    // Negative relations drift further negative if either side is hostile-minded
    if (rel.score < -30 && (from.life?.mood === 'beleaguered' || from.life?.mood === 'desperate')) {
      drift -= 0.5 * days;
    }
    // Positive relations slowly decay toward neutral (absent reinforcement)
    if (rel.score > 30) {
      drift -= 0.1 * days;
    }

    // Rivalry tags on goals amplify
    const hasRevenge = from.life?.goals?.some(g => g.type === 'revenge');
    if (hasRevenge && rel.score < 0) drift -= 0.3 * days;

    if (Math.abs(drift) > 0.01) {
      newRelations[key] = {
        ...rel,
        score: clamp(rel.score + drift, -100, 100),
      };
    }
  }

  // 3. NPC craft tick (living-world crafters). Runs when >= 1 week has elapsed
  //    on a week boundary. Determined by dividing total elapsed hours by 168.
  //    Uses take-10 deterministic mode by default so craft drift is predictable
  //    across sim ticks.
  let npcsOut = campaign.npcs;
  let shopsOut = campaign.shops;
  const weeksElapsed = Math.floor((hoursElapsed || 0) / (24 * 7));
  if (weeksElapsed > 0 && campaign.npcs) {
    const craftResult = tickNPCCrafters(campaign.npcs, weeksElapsed, { rng, take10: true });
    npcsOut = craftResult.npcs;
    for (const ev of craftResult.events) {
      events.push({ type: 'craft', ...ev });
    }

    // Apply reputation deeds to crafter NPCs based on craft events.
    // Look up each event's NPC, find the source project (for commissionedBy/masterwork),
    // map to a deed key, and apply via recordDeed onto npc.reputation.
    npcsOut = applyCraftDeedsToNpcs(npcsOut, craftResult.events);

    // Stock completed items into each crafter's home shop (non-commissioned only)
    if (craftResult.completions && craftResult.completions.length && shopsOut) {
      for (const c of craftResult.completions) {
        if (c.commissionedBy) continue; // commissioned items are delivered elsewhere
        const shopId = findHomeShopForNpc(shopsOut, c.crafterNpcId);
        if (!shopId) continue;
        const r = addCompletedItemToShop(shopsOut, shopId, c);
        if (r.added) {
          shopsOut = r.shopsMap;
          events.push({ type: 'shop-stocked', shopId, entry: r.entry });
        }
      }
    }
  }

  // 4. World time advance
  const newHoursElapsed = campaign.worldTime.hoursElapsed + hoursElapsed;
  const totalHours = campaign.worldTime.hourOfDay + hoursElapsed;
  const day = campaign.worldTime.day + Math.floor(totalHours / 24);
  const hourOfDay = ((totalHours % 24) + 24) % 24;

  return {
    campaign: {
      ...campaign,
      factions: factionsOut,
      factionRelations: newRelations,
      npcs: npcsOut,
      shops: shopsOut,
      worldTime: { hoursElapsed: newHoursElapsed, day, hourOfDay },
    },
    events,
  };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// --------------------------------------------------------------------
// Craft deed application
// Maps each craft-tick event to a reputation deed and writes it onto
// the crafter NPC's reputation record. Commissioned vs non-commissioned,
// masterwork, and ruined-materials are all distinguished. Pure — caller
// passes the post-tick npcs map/array back in.

export function applyCraftDeedsToNpcs(npcs, craftEvents) {
  if (!npcs || !Array.isArray(craftEvents) || craftEvents.length === 0) {
    return npcs;
  }

  const getNpc = (container, id) =>
    Array.isArray(container) ? container.find((n) => n && n.id === id) : container[id];
  const setNpc = (nextContainer, id, updated) => {
    if (Array.isArray(nextContainer)) {
      return nextContainer.map((n) => (n && n.id === id ? updated : n));
    }
    return { ...nextContainer, [id]: updated };
  };

  let next = Array.isArray(npcs) ? [...npcs] : { ...npcs };

  for (const ev of craftEvents) {
    if (!ev?.npcId) continue;
    // Read from `next` so multiple deeds on the same NPC in one tick accumulate
    // onto the evolving reputation (fixes lost-update when an NPC has both a
    // material-loss and a completion event in the same tick).
    const npc = getNpc(next, ev.npcId);
    if (!npc) continue;
    // Source project: look up by projectId in updated craftProjects
    const project = (npc.craftProjects || []).find((p) => p && p.id === ev.projectId);
    const deed = craftEventToDeed(ev, project);
    if (!deed) continue;
    const rep = npc.reputation || createReputation();
    const nextRep = recordDeed(rep, deed.deedKey, {
      ...(deed.context || {}),
      timestamp: ev.at || new Date().toISOString(),
    });
    next = setNpc(next, ev.npcId, { ...npc, reputation: nextRep });
  }

  return next;
}
