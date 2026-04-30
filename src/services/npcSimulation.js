/**
 * NPC Offscreen Simulation
 *
 * The world doesn't pause when the party is away. This module advances NPCs
 * by N hours of game-time, running daily schedules, decaying emotions,
 * propagating delayed gossip, drifting relationships, and generating
 * ambient life events. The result is a new NPC state plus an event log
 * the DM can narrate when the party returns.
 *
 * Design goals:
 *   • Pure functions (no global state). Consumers own persistence.
 *   • Deterministic on given inputs + injected rng (tests can seed).
 *   • Layered on top of npcPersonality.js — no circular imports.
 *   • Cheap enough to run a town of 30 NPCs across a week (~5k ticks).
 *
 * Public API:
 *   simulateElapsed(npcs, hoursElapsed, context)
 *   simulateHour(npcs, context)
 *   getNPCActivityAtHour(npc, hourOfDay)
 *   OCCUPATION_SCHEDULES
 *   ACTIVITY_DEFS
 */

import {
  decayEmotion,
  applyEmotionalEvent,
  applyEventWithAwareness,
  determineAwareness,
  recordMemory,
  EMOTIONAL_EVENTS,
  PROPAGATION_RATES,
} from './npcPersonality.js';

// ══════════════════════════════════════════════════════════════════════════════
// Schedule templates
// ══════════════════════════════════════════════════════════════════════════════
//
// Each schedule is an array of {startHour, endHour, activity, location} blocks
// covering a 24-hour day. Hours are 0–23 local time. `location` is semantic
// (tags the NPC for co-location matching) rather than a map coordinate.

export const OCCUPATION_SCHEDULES = {
  merchant: [
    { startHour: 6,  endHour: 7,  activity: 'wake',     location: 'home' },
    { startHour: 7,  endHour: 8,  activity: 'meal',     location: 'home' },
    { startHour: 8,  endHour: 12, activity: 'work',     location: 'shop' },
    { startHour: 12, endHour: 13, activity: 'meal',     location: 'tavern' },
    { startHour: 13, endHour: 18, activity: 'work',     location: 'shop' },
    { startHour: 18, endHour: 19, activity: 'meal',     location: 'home' },
    { startHour: 19, endHour: 22, activity: 'leisure',  location: 'tavern' },
    { startHour: 22, endHour: 6,  activity: 'sleep',    location: 'home' },
  ],
  blacksmith: [
    { startHour: 5,  endHour: 6,  activity: 'wake',     location: 'home' },
    { startHour: 6,  endHour: 7,  activity: 'meal',     location: 'home' },
    { startHour: 7,  endHour: 12, activity: 'work',     location: 'forge' },
    { startHour: 12, endHour: 13, activity: 'meal',     location: 'tavern' },
    { startHour: 13, endHour: 18, activity: 'work',     location: 'forge' },
    { startHour: 18, endHour: 20, activity: 'leisure',  location: 'tavern' },
    { startHour: 20, endHour: 21, activity: 'meal',     location: 'home' },
    { startHour: 21, endHour: 5,  activity: 'sleep',    location: 'home' },
  ],
  innkeeper: [
    { startHour: 5,  endHour: 6,  activity: 'wake',     location: 'home' },
    { startHour: 6,  endHour: 10, activity: 'work',     location: 'tavern' },
    { startHour: 10, endHour: 11, activity: 'meal',     location: 'tavern' },
    { startHour: 11, endHour: 23, activity: 'work',     location: 'tavern' },
    { startHour: 23, endHour: 5,  activity: 'sleep',    location: 'tavern' },
  ],
  guard: [
    // Two-shift rotation abstracted to day watch
    { startHour: 5,  endHour: 6,  activity: 'wake',     location: 'barracks' },
    { startHour: 6,  endHour: 7,  activity: 'meal',     location: 'barracks' },
    { startHour: 7,  endHour: 12, activity: 'patrol',   location: 'streets' },
    { startHour: 12, endHour: 13, activity: 'meal',     location: 'tavern' },
    { startHour: 13, endHour: 19, activity: 'patrol',   location: 'streets' },
    { startHour: 19, endHour: 20, activity: 'meal',     location: 'barracks' },
    { startHour: 20, endHour: 22, activity: 'leisure',  location: 'tavern' },
    { startHour: 22, endHour: 5,  activity: 'sleep',    location: 'barracks' },
  ],
  priest: [
    { startHour: 5,  endHour: 6,  activity: 'wake',     location: 'temple' },
    { startHour: 6,  endHour: 8,  activity: 'worship',  location: 'temple' },
    { startHour: 8,  endHour: 9,  activity: 'meal',     location: 'temple' },
    { startHour: 9,  endHour: 12, activity: 'work',     location: 'temple' },
    { startHour: 12, endHour: 13, activity: 'meal',     location: 'temple' },
    { startHour: 13, endHour: 17, activity: 'work',     location: 'streets' }, // outreach
    { startHour: 17, endHour: 19, activity: 'worship',  location: 'temple' },
    { startHour: 19, endHour: 20, activity: 'meal',     location: 'temple' },
    { startHour: 20, endHour: 22, activity: 'leisure',  location: 'temple' },
    { startHour: 22, endHour: 5,  activity: 'sleep',    location: 'temple' },
  ],
  farmer: [
    { startHour: 4,  endHour: 5,  activity: 'wake',     location: 'home' },
    { startHour: 5,  endHour: 12, activity: 'work',     location: 'fields' },
    { startHour: 12, endHour: 13, activity: 'meal',     location: 'fields' },
    { startHour: 13, endHour: 18, activity: 'work',     location: 'fields' },
    { startHour: 18, endHour: 19, activity: 'meal',     location: 'home' },
    { startHour: 19, endHour: 21, activity: 'leisure',  location: 'tavern' },
    { startHour: 21, endHour: 4,  activity: 'sleep',    location: 'home' },
  ],
  noble: [
    { startHour: 8,  endHour: 9,  activity: 'wake',     location: 'manor' },
    { startHour: 9,  endHour: 10, activity: 'meal',     location: 'manor' },
    { startHour: 10, endHour: 13, activity: 'work',     location: 'manor' },
    { startHour: 13, endHour: 14, activity: 'meal',     location: 'manor' },
    { startHour: 14, endHour: 17, activity: 'leisure',  location: 'manor' },
    { startHour: 17, endHour: 19, activity: 'work',     location: 'manor' },
    { startHour: 19, endHour: 21, activity: 'meal',     location: 'manor' },
    { startHour: 21, endHour: 23, activity: 'leisure',  location: 'manor' },
    { startHour: 23, endHour: 8,  activity: 'sleep',    location: 'manor' },
  ],
  thief: [
    // Inverted schedule — nocturnal
    { startHour: 14, endHour: 15, activity: 'wake',     location: 'home' },
    { startHour: 15, endHour: 16, activity: 'meal',     location: 'home' },
    { startHour: 16, endHour: 20, activity: 'leisure',  location: 'tavern' },
    { startHour: 20, endHour: 21, activity: 'meal',     location: 'tavern' },
    { startHour: 21, endHour: 4,  activity: 'work',     location: 'streets' }, // "work" here is shady
    { startHour: 4,  endHour: 14, activity: 'sleep',    location: 'home' },
  ],
  scholar: [
    { startHour: 8,  endHour: 9,  activity: 'wake',     location: 'home' },
    { startHour: 9,  endHour: 10, activity: 'meal',     location: 'home' },
    { startHour: 10, endHour: 13, activity: 'work',     location: 'library' },
    { startHour: 13, endHour: 14, activity: 'meal',     location: 'tavern' },
    { startHour: 14, endHour: 20, activity: 'work',     location: 'library' },
    { startHour: 20, endHour: 21, activity: 'meal',     location: 'home' },
    { startHour: 21, endHour: 23, activity: 'leisure',  location: 'tavern' },
    { startHour: 23, endHour: 8,  activity: 'sleep',    location: 'home' },
  ],
  beggar: [
    { startHour: 6,  endHour: 19, activity: 'work',     location: 'streets' }, // panhandling
    { startHour: 19, endHour: 21, activity: 'meal',     location: 'streets' },
    { startHour: 21, endHour: 6,  activity: 'sleep',    location: 'streets' },
  ],
  soldier: [
    { startHour: 5,  endHour: 6,  activity: 'wake',     location: 'barracks' },
    { startHour: 6,  endHour: 7,  activity: 'meal',     location: 'barracks' },
    { startHour: 7,  endHour: 12, activity: 'train',    location: 'barracks' },
    { startHour: 12, endHour: 13, activity: 'meal',     location: 'barracks' },
    { startHour: 13, endHour: 18, activity: 'patrol',   location: 'streets' },
    { startHour: 18, endHour: 20, activity: 'leisure',  location: 'tavern' },
    { startHour: 20, endHour: 21, activity: 'meal',     location: 'barracks' },
    { startHour: 21, endHour: 5,  activity: 'sleep',    location: 'barracks' },
  ],
  entertainer: [
    { startHour: 10, endHour: 11, activity: 'wake',     location: 'home' },
    { startHour: 11, endHour: 12, activity: 'meal',     location: 'tavern' },
    { startHour: 12, endHour: 17, activity: 'leisure',  location: 'tavern' }, // practice
    { startHour: 17, endHour: 18, activity: 'meal',     location: 'tavern' },
    { startHour: 18, endHour: 24, activity: 'work',     location: 'tavern' }, // perform
    { startHour: 0,  endHour: 2,  activity: 'leisure',  location: 'tavern' },
    { startHour: 2,  endHour: 10, activity: 'sleep',    location: 'home' },
  ],
};

const DEFAULT_SCHEDULE = OCCUPATION_SCHEDULES.merchant;

// ══════════════════════════════════════════════════════════════════════════════
// Activity definitions
// ══════════════════════════════════════════════════════════════════════════════
//
// Each activity drives per-hour side effects:
//   goalProgress   — if activity supports NPC's goal category, progress ticks up
//   socialChance   — probability (0-1) of meaningful social contact with
//                    a co-located NPC that hour
//   ambientEventChance — probability of a random life event being rolled
//   economicDelta  — rough wealth change per hour (negative = spending)

export const ACTIVITY_DEFS = {
  wake:    { goalTags: [],               socialChance: 0.1, ambientEventChance: 0.02, economicDelta: 0 },
  sleep:   { goalTags: [],               socialChance: 0,   ambientEventChance: 0.01, economicDelta: 0 },
  meal:    { goalTags: ['survival'],     socialChance: 0.6, ambientEventChance: 0.05, economicDelta: -1 },
  work:    { goalTags: ['wealth','legacy','duty','knowledge'], socialChance: 0.2, ambientEventChance: 0.05, economicDelta: +2 },
  patrol:  { goalTags: ['duty','protection'],    socialChance: 0.3, ambientEventChance: 0.08, economicDelta: +1 },
  worship: { goalTags: ['duty','legacy'], socialChance: 0.2, ambientEventChance: 0.03, economicDelta: 0 },
  train:   { goalTags: ['duty','power'], socialChance: 0.2, ambientEventChance: 0.04, economicDelta: 0 },
  leisure: { goalTags: ['love','freedom'], socialChance: 0.7, ambientEventChance: 0.1, economicDelta: -2 },
};

// ══════════════════════════════════════════════════════════════════════════════
// Ambient event tables
// ══════════════════════════════════════════════════════════════════════════════
//
// Low-probability events rolled per hour. Each entry emits an EMOTIONAL_EVENTS
// key (or a synthetic event) and a narrative fragment the DM can use.

const AMBIENT_EVENT_TABLE = [
  { key: 'party_helped',        weight: 0, narrative: '' }, // party events only fired by caller
  { key: 'received_good_news',  weight: 8, narrative: 'got good news from a family member' },
  { key: 'was_embarrassed',     weight: 5, narrative: 'suffered a minor public embarrassment' },
  { key: 'lost_property',       weight: 3, narrative: "discovered something of theirs was missing or broken" },
  { key: 'under_pressure',      weight: 6, narrative: 'had a stressful day' },
  { key: 'inspired_by_speech',  weight: 4, narrative: 'heard a rousing speech or song' },
  { key: 'witnessed_violence',  weight: 2, narrative: 'saw a fight break out nearby' },
];

// ══════════════════════════════════════════════════════════════════════════════
// Public helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Look up an NPC's scheduled activity for a given local hour.
 */
export function getNPCActivityAtHour(npc, hourOfDay) {
  const schedule = OCCUPATION_SCHEDULES[(npc.occupation || '').toLowerCase()] || DEFAULT_SCHEDULE;
  const h = ((hourOfDay % 24) + 24) % 24;
  for (const block of schedule) {
    if (block.startHour <= block.endHour) {
      // Normal block (e.g., 8–18)
      if (h >= block.startHour && h < block.endHour) return block;
    } else {
      // Wraps midnight (e.g., 22–6)
      if (h >= block.startHour || h < block.endHour) return block;
    }
  }
  return { startHour: 0, endHour: 24, activity: 'leisure', location: 'streets' };
}

/**
 * Derive a deterministic RNG from a string seed. Optional — omit to use Math.random.
 * Used by tests; production calls can pass undefined for real randomness.
 */
function makeRng(seed) {
  if (!seed) return Math.random;
  // Simple LCG seeded from a string hash
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Core simulation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Simulate a single game-hour for all NPCs.
 *
 * @param {Array}  npcs     — NPC objects (each must have .name; others optional)
 * @param {object} context  — { currentTime: ISO, rng?: function, settlementSize? }
 * @returns {object} { npcs: updatedNPCs, events: [{ npcName, kind, ... }] }
 */
export function simulateHour(npcs, context = {}) {
  const rng = context.rng || Math.random;
  const now = new Date(context.currentTime || new Date().toISOString());
  const hourOfDay = now.getUTCHours();
  const events = [];

  // Phase 1: Pure per-NPC updates (decay, activity-driven progress, ambient events)
  const updated = npcs.map(npc => {
    const next = { ...npc };
    // 1a. Decay emotion toward calm
    if (next.emotionalState && next.emotionalState.mood !== 'calm') {
      next.emotionalState = decayEmotion(next.emotionalState, now.toISOString());
    }
    // 1b. Determine activity
    const block = getNPCActivityAtHour(next, hourOfDay);
    next.currentActivity = block.activity;
    next.currentLocation = block.location;
    const actDef = ACTIVITY_DEFS[block.activity] || ACTIVITY_DEFS.leisure;

    // 1c. Goal progress — if activity supports this NPC's goal category, tick it up
    if (next.goal && actDef.goalTags.includes(next.goal.category)) {
      const prev = next.goal.progress || 0;
      const gain = 0.2 + rng() * 0.5; // 0.2–0.7 per matching hour
      next.goal = { ...next.goal, progress: Math.min(100, prev + gain) };
      if (prev < 100 && next.goal.progress >= 100) {
        events.push({
          npcName: next.name,
          kind: 'goal_completed',
          detail: next.goal.description || next.goal.category,
          timestamp: now.toISOString(),
        });
      }
    }

    // 1d. Economy delta (rough — accumulates)
    next.wealth = (next.wealth || 0) + (actDef.economicDelta || 0);

    // 1e. Ambient event roll
    if (rng() < (actDef.ambientEventChance || 0)) {
      const ambient = rollWeighted(AMBIENT_EVENT_TABLE.filter(e => e.weight > 0), rng);
      if (ambient && EMOTIONAL_EVENTS[ambient.key]) {
        const result = applyEmotionalEvent(next, ambient.key, { timestamp: now.toISOString() });
        next.emotionalState = result.emotionalState;
        events.push({
          npcName: next.name,
          kind: 'ambient',
          eventKey: ambient.key,
          narrative: `${next.name} ${ambient.narrative}`,
          timestamp: now.toISOString(),
        });
      }
    }

    return next;
  });

  // Phase 2: Cross-NPC interactions (co-location social drift + delayed gossip)
  // 2a. Pair NPCs sharing a location; small trust drift based on personality compat
  const byLocation = {};
  for (const npc of updated) {
    const loc = npc.currentLocation || 'streets';
    const actDef = ACTIVITY_DEFS[npc.currentActivity] || ACTIVITY_DEFS.leisure;
    if (actDef.socialChance <= 0) continue;
    byLocation[loc] = byLocation[loc] || [];
    byLocation[loc].push({ npc, socialChance: actDef.socialChance });
  }
  for (const [loc, occupants] of Object.entries(byLocation)) {
    if (occupants.length < 2) continue;
    // Sample at most one interaction per location per hour (keeps cost linear-ish)
    const a = occupants[Math.floor(rng() * occupants.length)];
    const bCandidates = occupants.filter(o => o.npc.name !== a.npc.name);
    if (bCandidates.length === 0) continue;
    const b = bCandidates[Math.floor(rng() * bCandidates.length)];
    const chance = Math.min(a.socialChance, b.socialChance);
    if (rng() >= chance) continue;

    const drift = socialDrift(a.npc, b.npc, rng);
    if (drift !== 0) {
      // Record as a small, mutual relationship memory. We don't mutate trust
      // scores directly; instead we append a memory so the trust engine picks
      // it up on next computeTrustScore() call for relationships.
      a.npc.npcRelationshipDrift = a.npc.npcRelationshipDrift || {};
      a.npc.npcRelationshipDrift[b.npc.name] = (a.npc.npcRelationshipDrift[b.npc.name] || 0) + drift;
      b.npc.npcRelationshipDrift = b.npc.npcRelationshipDrift || {};
      b.npc.npcRelationshipDrift[a.npc.name] = (b.npc.npcRelationshipDrift[a.npc.name] || 0) + drift;
      events.push({
        npcName: a.npc.name,
        kind: 'social',
        with: b.npc.name,
        location: loc,
        drift,
        timestamp: now.toISOString(),
      });
    }
  }

  // 2b. Delayed gossip — if the context carries pending events, try to spread them
  if (Array.isArray(context.pendingGossip) && context.pendingGossip.length) {
    for (const pending of context.pendingGossip) {
      pending.hoursElapsed = (pending.hoursElapsed || 0) + 1;
      for (const npc of updated) {
        if (pending.reachedNPCs?.includes(npc.name)) continue;
        const awareness = determineAwareness(npc, pending.targetName, pending.eventKey, {
          presentNPCNames: [],
          relationships: pending.relationships || [],
          settlementSize: context.settlementSize || 'town',
          hoursElapsed: pending.hoursElapsed,
        });
        if (awareness.scope === 'gossip') {
          const r = applyEventWithAwareness(npc, pending.eventKey, 'gossip', {
            timestamp: now.toISOString(),
            gossipHops: awareness.gossipHops,
          });
          if (r.applied) {
            npc.emotionalState = r.emotionalState;
            pending.reachedNPCs = [...(pending.reachedNPCs || []), npc.name];
            events.push({
              npcName: npc.name,
              kind: 'gossip',
              eventKey: pending.eventKey,
              hops: awareness.gossipHops,
              timestamp: now.toISOString(),
            });
          }
        }
      }
    }
  }

  // Phase 3: Hygiene — prune unbounded arrays so long campaigns stay lean.
  // Cheap (linear in NPC count × small constants); safe to run every tick.
  const pruned = updated.map(n => pruneNPCState(n, now.toISOString(), context.pruneOpts));

  return { npcs: pruned, events };
}

/**
 * Simulate N hours in a row. Returns the aggregated result.
 *
 * @param {Array}  npcs
 * @param {number} hoursElapsed
 * @param {object} context   — { startTime, rng?, settlementSize?, pendingGossip? }
 * @returns {object} { npcs, events, endTime }
 */
export function simulateElapsed(npcs, hoursElapsed, context = {}) {
  const start = new Date(context.startTime || new Date().toISOString());
  const rng = context.rng || makeRng(context.seed);
  let current = npcs;
  let allEvents = [];
  const pendingGossip = context.pendingGossip ? [...context.pendingGossip] : [];

  for (let h = 0; h < hoursElapsed; h++) {
    const currentTime = new Date(start.getTime() + h * 3600 * 1000).toISOString();
    const { npcs: next, events } = simulateHour(current, {
      currentTime,
      rng,
      settlementSize: context.settlementSize,
      pendingGossip,
    });
    current = next;
    allEvents = allEvents.concat(events);
  }

  return {
    npcs: current,
    events: allEvents,
    endTime: new Date(start.getTime() + hoursElapsed * 3600 * 1000).toISOString(),
    pendingGossip: prunePendingGossip(pendingGossip, context.settlementSize),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Default state-pruning config. Tunable per-call.
 */
export const PRUNE_DEFAULTS = {
  maxMemories: 50,          // keep N most-recent; old ones already decayed out of trust relevance
  memoryAgeDays: 60,        // drop anything older than this regardless of count
  maxKnowledge: 40,
  maxDeferredEvents: 20,
  maxRecentEvents: 10,
};

/**
 * Trim unbounded arrays on an NPC to keep long campaigns lean.
 * Pure — returns a new NPC object; doesn't mutate the input.
 */
export function pruneNPCState(npc, currentTime, opts = {}) {
  const cfg = { ...PRUNE_DEFAULTS, ...opts };
  const now = new Date(currentTime || new Date().toISOString()).getTime();
  const ageCutoff = now - cfg.memoryAgeDays * 86400 * 1000;
  const next = { ...npc };

  if (Array.isArray(next.memories) && next.memories.length > 0) {
    const fresh = next.memories.filter(m => {
      const t = new Date(m.timestamp || m.setAt || 0).getTime();
      return isNaN(t) || t >= ageCutoff;
    });
    next.memories = fresh.slice(-cfg.maxMemories);
  }
  if (Array.isArray(next.knowledge) && next.knowledge.length > cfg.maxKnowledge) {
    next.knowledge = next.knowledge.slice(-cfg.maxKnowledge);
  }
  if (next.emotionalState) {
    const state = { ...next.emotionalState };
    if (Array.isArray(state.recentEvents) && state.recentEvents.length > cfg.maxRecentEvents) {
      state.recentEvents = state.recentEvents.slice(-cfg.maxRecentEvents);
    }
    if (Array.isArray(state.deferredEvents) && state.deferredEvents.length > cfg.maxDeferredEvents) {
      state.deferredEvents = state.deferredEvents.slice(-cfg.maxDeferredEvents);
    }
    next.emotionalState = state;
  }
  return next;
}

/**
 * Prune stale pending-gossip entries. Events that have exceeded their
 * propagation window will never reach new NPCs, so they can be discarded.
 */
export function prunePendingGossip(pendingGossip, settlementSize = 'town') {
  if (!Array.isArray(pendingGossip)) return [];
  return pendingGossip.filter(p => {
    const event = EMOTIONAL_EVENTS[p.eventKey];
    const visibility = event?.visibility || 'local';
    const rates = (PROPAGATION_RATES[settlementSize] || PROPAGATION_RATES.town)[visibility];
    const maxWindow = rates ? rates.maxHops * rates.hoursPerHop : 72;
    return (p.hoursElapsed || 0) <= maxWindow;
  });
}

function rollWeighted(table, rng) {
  const total = table.reduce((s, t) => s + t.weight, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const entry of table) {
    r -= entry.weight;
    if (r <= 0) return entry;
  }
  return table[table.length - 1];
}

/**
 * How two NPCs' personalities clash or click when co-located. Returns a
 * small integer drift (typically -2..+2) for this encounter.
 */
function socialDrift(a, b, rng) {
  const pa = (a.personality || '').toLowerCase();
  const pb = (b.personality || '').toLowerCase();

  const friendlyPairs = new Set([
    'kind|kind', 'kind|noble', 'kind|pious', 'noble|pious',
    'cunning|greedy', 'greedy|cunning',
  ]);
  const hostilePairs = new Set([
    'paranoid|cunning', 'cunning|paranoid',
    'noble|greedy', 'greedy|noble',
    'pious|cunning', 'cunning|pious',
  ]);

  const key = `${pa}|${pb}`;
  if (friendlyPairs.has(key)) return +1 + Math.floor(rng() * 2); // +1..+2
  if (hostilePairs.has(key))  return -1 - Math.floor(rng() * 2); // -1..-2

  // Default: slight positive drift (people who spend time together warm up)
  const roll = rng();
  if (roll < 0.6) return 0;
  if (roll < 0.9) return +1;
  return -1;
}
