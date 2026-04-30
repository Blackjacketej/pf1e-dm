/**
 * Faction & Reputation Layer
 *
 * Individuals are one layer; groups are another. A faction (Thieves' Guild,
 * Temple of Sarenrae, House Vashkar, Town Watch) has its own attitude toward
 * the party — computed from member opinions plus faction-wide events — and
 * propagates trust in both directions: joining/betraying a faction shifts
 * every member's baseline toward the party.
 *
 * Regional reputation (village / town / kingdom) is separate from any single
 * faction so "we cleared the dungeon" ripples differently than "we pickpocketed
 * the baker."
 *
 * Pure functions only. Consumers (WorldTab) own persistence.
 *
 * Public API:
 *   createFaction(config)                   — construct a faction record
 *   addMember / removeMember                — membership ops
 *   recordFactionEvent                      — faction-wide reputation delta
 *   computeFactionReputation                — roll up members + events
 *   propagateFactionReputationToMembers     — push faction rep down as a baseline
 *   getRegionalReputation                   — roll up all factions + NPCs
 */

import { computeTrustScore } from './npcPersonality.js';

// ══════════════════════════════════════════════════════════════════════════════
// Faction archetypes
// ══════════════════════════════════════════════════════════════════════════════
//
// Archetypes set default cohesion/secrecy/reach. Cohesion controls how hard
// a single member's opinion drags the faction (higher cohesion = more weight
// to the faction-wide event log, less to individual members). Secrecy slows
// reputation propagation (a secret society's opinion doesn't spread to the
// town at large). Reach defines how far the faction's reputation extends.

export const FACTION_ARCHETYPES = {
  // Human/urban
  religious:   { cohesion: 0.7, secrecy: 0.2, reach: 'regional', memory: 'medium' },
  mercantile:  { cohesion: 0.4, secrecy: 0.3, reach: 'regional', memory: 'short'  },
  martial:     { cohesion: 0.8, secrecy: 0.2, reach: 'local',    memory: 'medium' },
  criminal:    { cohesion: 0.6, secrecy: 0.9, reach: 'local',    memory: 'long'   },
  noble_house: { cohesion: 0.9, secrecy: 0.5, reach: 'regional', memory: 'long'   },
  scholarly:   { cohesion: 0.3, secrecy: 0.4, reach: 'regional', memory: 'long'   },
  artisan:     { cohesion: 0.5, secrecy: 0.2, reach: 'local',    memory: 'short'  },
  outcast:     { cohesion: 0.4, secrecy: 0.7, reach: 'local',    memory: 'medium' },
  // Non-human / tribal / collective
  tribe:       { cohesion: 0.8, secrecy: 0.4, reach: 'local',    memory: 'long'   }, // goblin/orc/kobold kin groups; oral tradition, long memory, slow gossip outward
  clan:        { cohesion: 0.9, secrecy: 0.3, reach: 'regional', memory: 'eternal'}, // dwarven/human bloodlines; grudges inherited
  hive:        { cohesion: 1.0, secrecy: 0.1, reach: 'local',    memory: 'short'  }, // ants, bees, aberrant collectives; individuals are the group
  pack:        { cohesion: 0.7, secrecy: 0.2, reach: 'local',    memory: 'short'  }, // gnolls, worgs; alpha-driven, rep flows from leader
  coven:       { cohesion: 0.5, secrecy: 0.95,reach: 'regional', memory: 'eternal'}, // hags, witches; ritual-bound, extremely secretive
  enclave:     { cohesion: 0.6, secrecy: 0.6, reach: 'regional', memory: 'eternal'}, // elves, druidic circles; isolated, deep memory
  horde:       { cohesion: 0.4, secrecy: 0.1, reach: 'regional', memory: 'short'  }, // large orc/giant armies; loose but visible
  cult:        { cohesion: 0.8, secrecy: 0.8, reach: 'local',    memory: 'medium' }, // fanatical, charismatic-leader driven
  monastery:   { cohesion: 0.7, secrecy: 0.3, reach: 'local',    memory: 'long'   }, // contemplative, slow to judge, slow to forgive
  caravan:     { cohesion: 0.5, secrecy: 0.3, reach: 'regional', memory: 'short'  }, // mobile; carries reputation between settlements faster than any other group
  court:       { cohesion: 0.4, secrecy: 0.9, reach: 'regional', memory: 'long'   }, // fey courts, drow houses, Byzantine intrigue; public face vs private dagger
  hoard:       { cohesion: 1.0, secrecy: 0.7, reach: 'regional', memory: 'eternal'}, // solitary dragons, liches; a "faction of one" with near-infinite patience
  consortium:  { cohesion: 0.6, secrecy: 0.8, reach: 'regional', memory: 'eternal'}, // lich councils, undead cabals; cold calculation, individual death meaningless
  guild:       { cohesion: 0.7, secrecy: 0.4, reach: 'regional', memory: 'long'   }, // formal craft/trade bodies; contract-bound, credentialing, jealous of standards
};

/**
 * Standard faction-level events (distinct from NPC emotional events). These
 * shift faction reputation toward the party as a whole.
 */
export const FACTION_EVENTS = {
  // Positive
  completed_faction_quest:   { repDelta:  25, narrative: 'completed a sanctioned quest' },
  donated_generously:        { repDelta:  15, narrative: 'donated generously'            },
  defended_faction_interest: { repDelta:  20, narrative: 'defended faction interests'    },
  recruited_member:          { repDelta:  10, narrative: 'brought in a new recruit'      },
  endorsed_leader:           { repDelta:  10, narrative: 'publicly endorsed a leader'    },
  // Negative
  stole_from_faction:        { repDelta: -30, narrative: 'stole from the faction'        },
  attacked_member:           { repDelta: -35, narrative: 'attacked a member'             },
  exposed_secret:            { repDelta: -40, narrative: 'exposed a faction secret'      },
  broke_faction_oath:        { repDelta: -30, narrative: 'broke a sworn oath'            },
  aided_rival_faction:       { repDelta: -25, narrative: 'aided a rival faction'         },
  // Neutral / context
  joined:                    { repDelta:   0, narrative: 'joined the faction'            },
  left:                      { repDelta:  -5, narrative: 'left the faction'              },
};

// ══════════════════════════════════════════════════════════════════════════════
// Construction
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a faction record.
 *
 * @param {object} cfg — { name, archetype, settlement, members?, attitude? }
 */
export function createFaction(cfg = {}) {
  const archetype = FACTION_ARCHETYPES[cfg.archetype] || FACTION_ARCHETYPES.mercantile;
  return {
    name: cfg.name || 'Unnamed Faction',
    archetype: cfg.archetype || 'mercantile',
    settlement: cfg.settlement || null,
    members: Array.isArray(cfg.members) ? [...cfg.members] : [],
    rivalFactions: Array.isArray(cfg.rivalFactions) ? [...cfg.rivalFactions] : [],
    alliedFactions: Array.isArray(cfg.alliedFactions) ? [...cfg.alliedFactions] : [],
    // Faction-wide event log (separate from NPC memories)
    events: [],
    // Base reputation toward the party; shifts through events
    baseReputation: typeof cfg.baseReputation === 'number' ? cfg.baseReputation : 0,
    // Cached computed attitude + last computation time — consumers recompute as needed
    cachedReputation: null,
    archetypeMeta: { ...archetype },
  };
}

export function addMember(faction, npcName) {
  if (!npcName || faction.members.includes(npcName)) return faction;
  return { ...faction, members: [...faction.members, npcName] };
}

export function removeMember(faction, npcName) {
  return { ...faction, members: faction.members.filter(m => m !== npcName) };
}

// ══════════════════════════════════════════════════════════════════════════════
// Reputation mechanics
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Append a faction-level event. Returns a new faction record.
 */
export function recordFactionEvent(faction, eventKey, opts = {}) {
  const def = FACTION_EVENTS[eventKey];
  const delta = def?.repDelta ?? (opts.repDelta || 0);
  const entry = {
    eventKey,
    repDelta: delta,
    narrative: def?.narrative || opts.narrative || eventKey,
    timestamp: opts.timestamp || new Date().toISOString(),
  };
  return {
    ...faction,
    events: [...faction.events, entry],
    baseReputation: clamp(faction.baseReputation + delta, -100, 100),
    cachedReputation: null, // invalidate
  };
}

/**
 * Compute the faction's current reputation toward the party.
 *
 * rep = cohesion * (baseReputation + event sum) +
 *       (1 - cohesion) * average(member trust scores toward party)
 *
 * @param {object} faction
 * @param {Array}  allNPCs  — used to read member trust scores
 * @param {string} currentTime — ISO
 * @returns {object} { reputation, tier, breakdown }
 */
export function computeFactionReputation(faction, allNPCs = [], currentTime) {
  const cohesion = faction.archetypeMeta?.cohesion ?? 0.5;
  const now = currentTime || new Date().toISOString();

  // Member-average trust score (−100..+100 scale from computeTrustScore)
  let memberAvg = 0;
  let memberCount = 0;
  for (const memberName of faction.members) {
    const npc = allNPCs.find(n => n.name === memberName);
    if (!npc) continue;
    const t = computeTrustScore(npc.memories || [], now);
    memberAvg += t.trustScore;
    memberCount++;
  }
  if (memberCount > 0) memberAvg /= memberCount;

  // Faction-level rep is already the baseline + event sum (clamped above)
  const factionRep = faction.baseReputation;

  const reputation = clamp(
    cohesion * factionRep + (1 - cohesion) * memberAvg,
    -100, 100
  );

  return {
    reputation: Math.round(reputation),
    tier: reputationTier(reputation),
    breakdown: {
      cohesion,
      factionRep,
      memberAvg: Math.round(memberAvg),
      memberCount,
    },
  };
}

/**
 * Push a small baseline rep shift onto every member NPC's trust. Used when a
 * faction-wide event happens that members would all react to (e.g., the party
 * pulls off a heist for the Thieves' Guild — every member trusts them more,
 * scaled by how tightly the faction coordinates).
 *
 * Returns a new array of NPCs. Each affected member gets a synthetic memory
 * of type 'helped' or 'promise_broken' depending on sign.
 *
 * @param {object} faction
 * @param {Array}  allNPCs
 * @param {number} delta — trust shift to apply per member (raw, before cohesion scale)
 * @param {object} opts  — { timestamp, reason }
 */
export function propagateFactionReputationToMembers(faction, allNPCs, delta, opts = {}) {
  const cohesion = faction.archetypeMeta?.cohesion ?? 0.5;
  const scaled = Math.round(delta * cohesion);
  if (scaled === 0) return allNPCs;

  const now = opts.timestamp || new Date().toISOString();
  const reason = opts.reason || 'faction-wide reputation shift';
  const memType = scaled > 0 ? 'helped' : 'promise_broken';

  return allNPCs.map(npc => {
    if (!faction.members.includes(npc.name)) return npc;
    const memory = {
      type: memType,
      detail: `[${faction.name}] ${reason}`,
      trustImpact: scaled,
      timestamp: now,
      source: 'faction',
    };
    return {
      ...npc,
      memories: [...(npc.memories || []), memory],
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Regional reputation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compute reputation across an entire settlement or region — a weighted
 * average of faction reputations plus unaffiliated NPC trust scores.
 * Settlement-reach factions weigh more than local ones.
 *
 * @param {Array}  factions
 * @param {Array}  allNPCs
 * @param {string} scope — 'local' | 'regional' (filters factions by reach)
 * @param {string} currentTime
 * @returns {object} { reputation, tier, breakdown }
 */
export function getRegionalReputation(factions = [], allNPCs = [], scope = 'local', currentTime) {
  const now = currentTime || new Date().toISOString();
  const relevant = factions.filter(f => {
    const reach = f.archetypeMeta?.reach || 'local';
    // Regional scope pulls in everything; local excludes regional-reach groups
    return scope === 'regional' ? true : reach === 'local';
  });

  let sum = 0;
  let weight = 0;
  const perFaction = [];
  for (const f of relevant) {
    const rep = computeFactionReputation(f, allNPCs, now);
    const w = Math.max(1, f.members.length); // bigger factions count more
    sum += rep.reputation * w;
    weight += w;
    perFaction.push({ faction: f.name, reputation: rep.reputation, members: f.members.length });
  }

  // Unaffiliated NPCs: members of no faction
  const affiliated = new Set(factions.flatMap(f => f.members));
  const unaffiliated = allNPCs.filter(n => !affiliated.has(n.name));
  let unaffAvg = 0;
  if (unaffiliated.length > 0) {
    let total = 0;
    for (const n of unaffiliated) {
      total += computeTrustScore(n.memories || [], now).trustScore;
    }
    unaffAvg = total / unaffiliated.length;
    // Count unaffiliated as collective "faction" weighted by population
    sum += unaffAvg * unaffiliated.length;
    weight += unaffiliated.length;
  }

  const reputation = weight > 0 ? sum / weight : 0;
  return {
    reputation: Math.round(reputation),
    tier: reputationTier(reputation),
    breakdown: {
      perFaction,
      unaffiliated: { count: unaffiliated.length, avg: Math.round(unaffAvg) },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

export function reputationTier(rep) {
  if (rep >= 75)  return { tier: 'revered',    label: 'Revered'    };
  if (rep >= 40)  return { tier: 'trusted',    label: 'Trusted'    };
  if (rep >= 10)  return { tier: 'friendly',   label: 'Friendly'   };
  if (rep >= -10) return { tier: 'neutral',    label: 'Neutral'    };
  if (rep >= -40) return { tier: 'wary',       label: 'Wary'       };
  if (rep >= -75) return { tier: 'distrustful',label: 'Distrustful'};
  return { tier: 'hated', label: 'Hated' };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
