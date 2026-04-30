/**
 * Sandpoint Canonical NPC Hydrator
 *
 * Converts canonical roster entries (sandpoint-npcs.json) into full
 * living-world NPC objects compatible with the rest of the engine
 * (npcTracker shape, npcPersonality hooks, factionInference, memory,
 * emotionalState, goals, knowledge, relationships, schedule/activity).
 *
 * Canonical fields are PINNED — they override anything the defaults
 * would roll. Everything else is filled with deterministic sensible
 * defaults so tests stay stable and the simulation can tick over them
 * the moment the party first encounters them.
 *
 * This is the bridge between the "static source-book data" layer
 * and the "living, breathing town" layer.
 */

import { defaultEmotionalState } from './npcPersonality.js';
import sandpointRoster from '../data/sandpoint-npcs.json' with { type: 'json' };
import rotrBurntOfferingsRoster from '../data/rotr-burnt-offerings-npcs.json' with { type: 'json' };

// Title-case helpers — roster uses lowercase classes ("fighter"), but
// generateNPC and the rest of the engine use "Fighter". Normalize at the
// boundary so the rest of the app doesn't have to think about it.
function titleCase(s) {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function capitalizeRace(r) {
  if (!r) return 'Human';
  if (r === 'half-elf') return 'Half-Elf';
  if (r === 'half-orc') return 'Half-Orc';
  return titleCase(r);
}

// Map PF1e class strings → simplified attribute biases (same buckets
// generateNPC uses).
const WARRIOR_CLASSES = new Set(['fighter', 'warrior', 'ranger', 'paladin', 'monk', 'barbarian']);
const CASTER_CLASSES = new Set(['wizard', 'sorcerer', 'cleric', 'druid', 'witch', 'alchemist', 'mystic theurge']);

function primaryClass(entry) {
  // Pick the class with the highest level as the "main" class — used for
  // HP/AC estimation and occupation/knowledge generation.
  if (!entry.classes || entry.classes.length === 0) return { class: 'commoner', level: 1 };
  return [...entry.classes].sort((a, b) => b.level - a.level)[0];
}

function totalLevel(entry) {
  return (entry.classes || []).reduce((s, c) => s + (c.level || 0), 0) || 1;
}

// Deterministic stat block from canonical data — no RNG.
function deriveStats(entry) {
  const primary = primaryClass(entry);
  const level = totalLevel(entry);
  const cls = primary.class.toLowerCase();
  const isWarrior = WARRIOR_CLASSES.has(cls);
  const isCaster = CASTER_CLASSES.has(cls);
  // Fixed canonical averages — deterministic for tests
  const str = isWarrior ? 14 : 10;
  const dex = cls === 'rogue' || cls === 'ranger' || cls === 'monk' || cls === 'vigilante' ? 14 : 11;
  const con = 12;
  const int = isCaster ? 14 : 10;
  const wis = cls === 'cleric' || cls === 'druid' || cls === 'monk' ? 14 : 11;
  const cha = cls === 'bard' || cls === 'sorcerer' || cls === 'paladin' ? 14 : 10;
  const hd = isWarrior ? 10 : isCaster ? 6 : 8;
  const conMod = Math.floor((con - 10) / 2);
  const hp = Math.max(1, hd + conMod + (level - 1) * Math.max(1, Math.floor(hd / 2) + conMod));
  const ac = isWarrior ? 14 + Math.floor(level / 3) : 10 + Math.floor((dex - 10) / 2);
  return { str, dex, con, int, wis, cha, hp, ac, hd: level };
}

// Build a short appearance block without going so specific that the DM
// can't embellish. Age bucket comes from canonical age string.
const AGE_BUCKETS = {
  'young adult':  22,
  'adult':        30,
  'middle-aged':  48,
  'old':          64,
  'elderly':      70,
  'venerable':    82,
};
function deriveAppearance(entry) {
  return {
    gender: entry.sex || 'unspecified',
    age: AGE_BUCKETS[entry.age] || 30,
    ageBucket: entry.age || 'adult',
    hair: null,            // deliberately unset — DM/flavor can fill
    eyes: null,
    build: 'average',
    distinguishing: null,
  };
}

// Canonical NPCs are already "known" at the campaign level (the town
// knows them), BUT the party hasn't necessarily met them yet. Per the
// project rule about NPC names, knownToParty defaults to false: the
// party must interact to learn the name.
function buildFirstImpression(entry, appearance) {
  const genderWord = appearance.gender === 'female' ? 'woman'
                   : appearance.gender === 'male' ? 'man'
                   : 'person';
  const ageAdj = appearance.ageBucket !== 'adult' ? appearance.ageBucket : '';
  const raceAdj = entry.race === 'human' ? '' : (entry.race || '').toLowerCase();
  const parts = [ageAdj, raceAdj, genderWord].filter(Boolean);
  const role = entry.role ? ` They look like a ${entry.role.toLowerCase()}.` : '';
  return `A ${parts.join(' ')}.${role}`;
}

// Produce knowledge entries seeded from the NPC's faction tags + role.
// This gives faction-tied NPCs plausible rumors about their own orgs
// from the jump, so the party can extract real intel from conversations.
function seedKnowledge(entry) {
  const knowledge = [];
  for (const fid of (entry.factions || [])) {
    knowledge.push({
      topic: `faction:${fid}`,
      accuracy: 'fact',
      detail: `Insider knowledge about ${fid}`,
      source: 'membership',
      shareability: 'guarded',
    });
  }
  if (entry.hook) {
    knowledge.push({
      topic: `self:${entry.id}`,
      accuracy: 'fact',
      detail: entry.hook,
      source: 'personal',
      shareability: 'private',
    });
  }
  return knowledge;
}

// Seed a memory so the first time the party meets this NPC, their history
// isn't a blank slate. Useful for `recordMemory` / trust calculations.
function seedMemories(entry) {
  if (!entry.hook) return [];
  return [{
    type: 'background',
    label: 'canonical backstory',
    detail: entry.hook,
    pcName: null,
    timestamp: null,   // pre-campaign; doesn't decay
    trustImpact: 0,
    decaysAfterDays: null,
  }];
}

/**
 * hydrateCanonicalNPC(entry, overrides?) → full living-world NPC
 *
 * Canonical fields are preserved exactly. Everything else defaults to
 * stable values so tests are deterministic and simulation can tick.
 */
export function hydrateCanonicalNPC(entry, overrides = {}, opts = {}) {
  if (!entry || !entry.id) {
    throw new Error('hydrateCanonicalNPC: entry must have an id');
  }
  const sourceLabel = opts.canonicalSource || 'sandpoint';
  const settlementLabel = opts.settlement || 'Sandpoint';
  const primary = primaryClass(entry);
  const stats = deriveStats(entry);
  const appearance = deriveAppearance(entry);

  return {
    // ── canonical identity (pinned) ─────────────────────────────
    id: entry.id,
    name: entry.name,
    canonicalId: entry.id,           // back-reference to the roster
    canonicalSource: sourceLabel,

    // ── mechanics ──────────────────────────────────────────────
    race: capitalizeRace(entry.race),
    class: titleCase(primary.class),
    classes: (entry.classes || []).map(c => ({
      class: titleCase(c.class),
      level: c.level,
      deity: c.deity || null,
    })),
    level: totalLevel(entry),
    hd: stats.hd,
    hp: stats.hp,
    maxHP: stats.hp,
    ac: stats.ac,
    abilities: {
      STR: stats.str, DEX: stats.dex, CON: stats.con,
      INT: stats.int, WIS: stats.wis, CHA: stats.cha,
    },
    alignment: entry.alignment,
    feats: [],            // DM-expandable later

    // ── roleplay surface ───────────────────────────────────────
    appearance,
    occupation: entry.role || 'townsfolk',
    disposition: entry.alignment?.startsWith('C') ? 'outspoken'
               : entry.alignment?.startsWith('L') ? 'formal'
               : 'neutral',
    personality: 'canonical',
    ethnicity: entry.ethnicity || (entry.race === 'human' ? 'Varisian' : ''),
    origin: entry.origin || 'Sandpoint',
    heritage: '',
    characterTraits: [],
    drawback: null,
    arcaneBond: null,
    familiar: null,

    // ── living-world systems ───────────────────────────────────
    deceptionTendency: entry.deceptionTendency || 'honest',
    secrets: entry.secrets || [],
    emotionalState: defaultEmotionalState(),
    memories: seedMemories(entry),
    goal: entry.goal || null,
    knowledge: seedKnowledge(entry),
    courage: null,
    relationships: [],
    // Faction affiliations — point back to campaign.factions[id]
    factions: [...(entry.factions || [])],

    // ── identity / meta ────────────────────────────────────────
    knownToParty: false,           // party has not learned the name
    shortDesc: buildFirstImpression(entry, appearance).replace(/^A /, '')
                                                      .replace(/\..*/, ''),
    firstImpression: buildFirstImpression(entry, appearance),
    notes: entry.hook || '',
    location: entry.location || settlementLabel,
    settlement: settlementLabel,
    metAt: null,                   // not yet met
    alive: true,
    interactions: 0,
    attitude: 'indifferent',
    attitudeHistory: [],

    ...overrides,
  };
}

/**
 * hydrateSandpointRoster() → { byId, byFaction, byLocation, all }
 *
 * One call to produce the entire populated town. Indexes built up-front
 * so lookups are O(1) everywhere.
 */
export function hydrateSandpointRoster() {
  return hydrateRoster(sandpointRoster, { canonicalSource: 'sandpoint', settlement: 'Sandpoint' });
}

/**
 * hydrateRotrBurntOfferingsRoster() → { byId, byFaction, byLocation, all }
 *
 * Same shape as hydrateSandpointRoster but for the Rise of the Runelords
 * Chapter 1 antagonist roster. Default settlement is "Thistletop" since
 * most entries are located there or in the catacombs beneath Sandpoint.
 */
export function hydrateRotrBurntOfferingsRoster() {
  return hydrateRoster(rotrBurntOfferingsRoster, {
    canonicalSource: 'rotr-burnt-offerings',
    settlement: 'Thistletop',
  });
}

/**
 * Generic roster → hydrated-NPCs helper. Takes any roster with a .npcs
 * array and hydrates every entry using the provided opts.
 */
export function hydrateRoster(roster, opts = {}) {
  const all = (roster.npcs || []).map(entry => hydrateCanonicalNPC(entry, {}, opts));
  const byId = Object.fromEntries(all.map(n => [n.id, n]));
  const byFaction = {};
  const byLocation = {};
  for (const npc of all) {
    for (const fid of (npc.factions || [])) {
      (byFaction[fid] = byFaction[fid] || []).push(npc);
    }
    const loc = npc.location || 'Unknown';
    (byLocation[loc] = byLocation[loc] || []).push(npc);
  }
  return { all, byId, byFaction, byLocation };
}

/**
 * attachCanonicalNPCsToCampaign(campaign) → campaign (with .npcs field)
 *
 * Takes a seeded campaign and bolts the full hydrated Sandpoint roster
 * onto it. After this call:
 *   campaign.npcs[id]           → full living-world NPC
 *   campaign.factions[fid].members → now includes canonical NPC ids
 */
export function attachCanonicalNPCsToCampaign(campaign, opts = {}) {
  // By default, attach every roster we know about. Callers can restrict by
  // passing { rosters: ['sandpoint'] } or similar for narrower seeds.
  const which = opts.rosters || ['sandpoint', 'rotr-burnt-offerings'];
  const bundles = [];
  if (which.includes('sandpoint')) bundles.push(hydrateSandpointRoster());
  if (which.includes('rotr-burnt-offerings')) bundles.push(hydrateRotrBurntOfferingsRoster());

  const npcs = { ...(campaign.npcs || {}) };
  const factions = { ...campaign.factions };
  const warnings = [];

  for (const { all, byFaction } of bundles) {
    for (const npc of all) npcs[npc.id] = npc;
    // Merge canonical members onto faction member arrays (idempotent).
    // Record a warning for any faction id the NPC claims but the campaign
    // doesn't know about — otherwise these NPCs get added to campaign.npcs
    // but silently orphaned from faction.members.
    for (const [fid, members] of Object.entries(byFaction)) {
      if (!factions[fid]) {
        for (const m of members) {
          warnings.push({
            kind: 'unresolved-faction',
            npcId: m.id,
            factionId: fid,
            canonicalSource: m.canonicalSource,
            message: `NPC ${m.id} claims faction "${fid}" which is not in the campaign. Added to campaign.npcs but NOT to any faction.members.`,
          });
        }
        continue;
      }
      const existing = new Set(factions[fid].members || []);
      for (const m of members) existing.add(m.id);
      factions[fid] = { ...factions[fid], members: [...existing] };
    }
  }

  const next = { ...campaign, npcs, factions };
  // Attach a non-enumerable diagnostic so callers who want warnings can
  // find them without breaking callers that expect a plain campaign back.
  Object.defineProperty(next, '__attachWarnings', {
    value: warnings,
    enumerable: false,
    writable: false,
  });
  if (opts.onWarning) warnings.forEach(opts.onWarning);
  return next;
}

/**
 * auditCanonicalNPCFactionRefs(campaign, opts?) →
 *   { unresolved: [{npcId, factionId, canonicalSource}], orphanedFactions: [fid] }
 *
 * Read-only check: walks every NPC in every attached roster and reports
 * faction refs that don't resolve in the given campaign. Also reports
 * factions that exist in the campaign but have zero canonical members
 * (potential wiring gap).
 *
 * Use this as a sanity check after layering new source material.
 */
export function auditCanonicalNPCFactionRefs(campaign, opts = {}) {
  const which = opts.rosters || ['sandpoint', 'rotr-burnt-offerings'];
  const bundles = [];
  if (which.includes('sandpoint')) bundles.push({ label: 'sandpoint', ...hydrateSandpointRoster() });
  if (which.includes('rotr-burnt-offerings')) bundles.push({ label: 'rotr-burnt-offerings', ...hydrateRotrBurntOfferingsRoster() });

  const unresolved = [];
  const memberCounts = {};
  for (const { all, byFaction, label } of bundles) {
    for (const npc of all) {
      for (const fid of (npc.factions || [])) {
        if (!campaign.factions?.[fid]) {
          unresolved.push({ npcId: npc.id, factionId: fid, canonicalSource: label });
        }
      }
    }
    for (const [fid, members] of Object.entries(byFaction)) {
      memberCounts[fid] = (memberCounts[fid] || 0) + members.length;
    }
  }

  const orphanedFactions = [];
  for (const fid of Object.keys(campaign.factions || {})) {
    if (!memberCounts[fid]) orphanedFactions.push(fid);
  }

  return { unresolved, orphanedFactions };
}
