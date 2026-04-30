/**
 * overlandTravel.js — PF1e overland movement service.
 *
 * Bug #42 (2026-04-17): travel between world-tree nodes used to be
 * instantaneous. The party could teleport from Sandpoint to Magnimar with no
 * time advancement, no random-encounter rolls, and no pass-through tick on
 * intervening nodes (so the living world froze during long journeys).
 *
 * This module is the single source of truth for:
 *   - base walking speed → miles/day conversion (CRB p.171)
 *   - terrain multipliers (CRB p.172, Table 7-8: Terrain and Overland Movement)
 *   - mount speed overrides (CRB p.173, Table 7-9)
 *   - travel plan construction (origin → destination path, pass-through nodes,
 *     duration, per-segment terrain and encounter rolls)
 *   - random encounter check per-segment (d20 vs terrain-specific DC)
 *
 * What it does NOT do (scope boundaries for this MVP slice):
 *   - Actually mutate worldState or the world tree — that's the caller's job
 *     (AdventureTab). This service is pure: given inputs, return a plan.
 *   - Generate encounter statblocks or tactical combat. When
 *     `rollEncounterCheck` reports an encounter, the caller decides whether
 *     to route it through dmEngine.narrate/startCombat.
 *   - Handle forced-march Constitution checks / fatigue damage. Recorded in
 *     FOLLOWUPS below.
 *
 * Follow-ups (parked, per operator ranking — file as bugs if needed):
 *   - Forced-march CON checks + nonlethal damage accumulation
 *   - Mount party mixing (slowest in the group sets pace; we currently assume
 *     all party members share a single speed)
 *   - Environmental hazards (extreme heat/cold, altitude, CRB p.436)
 *   - Weather tables (CRB p.438 — Ultimate Campaign has richer tables)
 *   - Water travel (rowed/sailed — Table 7-9 bottom half) — stub constant
 *     WATER_SPEEDS ready
 *
 * All CRB citations in this file are against:
 *   pdfs/Core Rulebook (5th Printing).pdf
 * Verify against the PDF, not web search or LLM recall, before adjusting
 * numbers (per feedback_crb_pdf_source memory).
 */

import { getHexSizeMilesForNode, DEFAULT_HEX_SIZE_MILES } from './hexConfig';

// ────────────────────────────────────────────────────── CRB Table 7-8: Terrain
// Multiplier applied to base miles-per-day for each terrain × road surface.
// Structure: TERRAIN_MULTIPLIERS[terrainKey][roadKey] → fractional multiplier.
//
// CRB p.172 enumerates nine terrain types crossed with three road surfaces.
// Terrain names are lowercased + stripped to stable keys; 'plains' is the
// default for unknown terrain so an operator who hasn't tagged a node still
// gets reasonable travel math rather than NaN.
export const TERRAIN_KINDS = Object.freeze([
  'desert',
  'forest',
  'hills',
  'jungle',
  'moor',
  'mountains',
  'plains',
  'swamp',
  'tundra',
]);

export const ROAD_KINDS = Object.freeze(['highway', 'road', 'trail', 'trackless']);

export const TERRAIN_MULTIPLIERS = Object.freeze({
  desert:    { highway: 1,     road: 1/2, trail: 1/2, trackless: 1/2 },
  forest:    { highway: 1,     road: 1,   trail: 1,   trackless: 1/2 },
  hills:     { highway: 1,     road: 3/4, trail: 3/4, trackless: 1/2 },
  jungle:    { highway: 1,     road: 3/4, trail: 3/4, trackless: 1/4 },
  moor:      { highway: 1,     road: 1,   trail: 1,   trackless: 3/4 },
  mountains: { highway: 3/4,   road: 3/4, trail: 3/4, trackless: 1/2 },
  plains:    { highway: 1,     road: 1,   trail: 1,   trackless: 3/4 },
  swamp:     { highway: 1,     road: 3/4, trail: 3/4, trackless: 1/2 },
  tundra:    { highway: 1,     road: 3/4, trail: 3/4, trackless: 3/4 },
});

// ────────────────────────────────────────────────────── CRB p.171: Base speed
// A character with a base speed of 30 feet can walk 3 mph for 8 hours a day →
// 24 miles/day. Standard party-pace defaults:
//   base speed 20 ft → 16 mi/day (dwarf/halfling)
//   base speed 30 ft → 24 mi/day (human, elf, half-elf, half-orc, goblin)
//   base speed 40 ft → 32 mi/day
// Hours/day for overland movement is fixed at 8 (walking). Forced march adds
// hours at a Constitution-check cost (not modeled here — see follow-ups).
export const BASE_WALK_HOURS_PER_DAY = 8;
export const BASE_MILES_PER_DAY_BY_SPEED = Object.freeze({
  10: 8,
  15: 12,
  20: 16,
  25: 20,
  30: 24,
  40: 32,
  50: 40,
  60: 48,
});

// ────────────────────────────────────────────────────── CRB Table 7-9: Mounts
// Per-day mileage by mount class (unladen column). Matches the CRB's values —
// caller can pass mountKey in travel options to override pedestrian base.
export const MOUNT_MILES_PER_DAY = Object.freeze({
  'light-horse':  40,
  'heavy-horse':  40,
  'pony':         32,
  'riding-dog':   32,
  'cart-wagon':   16,
});

// Water speeds (parked — not wired through calculateTravelPlan yet).
export const WATER_MILES_PER_DAY = Object.freeze({
  'raft-barge':  5,
  'keelboat':   10,
  'rowboat':    15,
  'sailing-ship': 48,
  'warship':    60,
  'longship':   72,
  'galley':     96,
});

// ────────────────────────────────────────────────────── Encounter frequency
// CRB doesn't ship a single canonical wilderness encounter table — they live
// in bestiaries + APs. For this slice we use GameMastery-style terrain-tagged
// probability targets: roll d20 every 4 hours of travel, encounter triggers
// on ≤ threshold. Numbers are calibrated to match the feel of published AP
// travel (Rise of the Runelords hinterlands: ~1 encounter per day of brisk
// travel on the Lost Coast Road).
//
// Operator can tune these — they're intentionally conservative so a d20=1
// isn't a guaranteed fight in every segment.
export const ENCOUNTER_FREQUENCY = Object.freeze({
  desert:    { perHours: 4, dc: 4 },
  forest:    { perHours: 4, dc: 5 },
  hills:     { perHours: 4, dc: 3 },
  jungle:    { perHours: 4, dc: 7 },
  moor:      { perHours: 4, dc: 3 },
  mountains: { perHours: 4, dc: 4 },
  plains:    { perHours: 4, dc: 2 },
  swamp:     { perHours: 4, dc: 6 },
  tundra:    { perHours: 4, dc: 4 },
});

// ────────────────────────────────────────────────────── Terrain key mapping

/**
 * Normalize arbitrary terrain text → one of TERRAIN_KINDS. Falls back to
 * 'plains' for anything we don't recognize (logged at call site if needed).
 */
export function normalizeTerrain(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'plains';
  // Direct hits
  if (TERRAIN_KINDS.includes(s)) return s;
  // Aliases
  if (s === 'coast' || s === 'coastal' || s === 'beach' || s === 'grassland') return 'plains';
  if (s === 'woods' || s === 'woodland') return 'forest';
  if (s === 'mountain' || s === 'alpine' || s === 'peak') return 'mountains';
  if (s === 'hill' || s === 'highlands') return 'hills';
  if (s === 'desert-sandy' || s === 'sand' || s === 'sandy') return 'desert';
  if (s === 'marsh' || s === 'bog' || s === 'wetland') return 'swamp';
  if (s === 'frozen' || s === 'snow' || s === 'ice') return 'tundra';
  if (s === 'rainforest') return 'jungle';
  if (s === 'interior' || s === 'underground' || s === 'dungeon') return 'plains'; // traversing dungeons uses local-scale movement, not overland; caller should short-circuit
  return 'plains';
}

/**
 * Normalize a road surface value. Defaults to 'road' (the common case for
 * well-traveled AP hooks like the Lost Coast Road).
 */
export function normalizeRoad(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (ROAD_KINDS.includes(s)) return s;
  if (s === 'paved' || s === 'imperial') return 'highway';
  if (s === 'path' || s === 'track' || s === 'pathway') return 'trail';
  if (s === 'wild' || s === 'offroad' || s === 'untracked' || s === 'none') return 'trackless';
  return 'road';
}

// ────────────────────────────────────────────────────── Speed & time helpers

/**
 * Resolve the party's base miles-per-day number. Slowest member sets pace
 * unless a mount is specified.
 * @param {Array} party — each member with `speed` (ft/round, optional).
 * @param {Object} opts — { mount: 'light-horse'|'heavy-horse'|... }
 * @returns {number} miles per day at walk pace
 */
export function partyMilesPerDay(party = [], opts = {}) {
  if (opts.mount && MOUNT_MILES_PER_DAY[opts.mount]) {
    return MOUNT_MILES_PER_DAY[opts.mount];
  }
  const speeds = (party || [])
    .map(c => Number.isFinite(c?.speed) ? c.speed : 30)
    .filter(s => s > 0);
  const slowest = speeds.length ? Math.min(...speeds) : 30;
  // Round down to nearest 5 to hit the lookup table.
  const bucket = Math.max(10, Math.floor(slowest / 5) * 5);
  return BASE_MILES_PER_DAY_BY_SPEED[bucket] || 24;
}

/**
 * Effective miles-per-day for a single terrain × road combination.
 * effMiles = baseMiles × TERRAIN_MULTIPLIERS[terrain][road]
 */
export function effectiveMilesPerDay(baseMiles, terrain, road) {
  const t = normalizeTerrain(terrain);
  const r = normalizeRoad(road);
  const mult = TERRAIN_MULTIPLIERS[t]?.[r] ?? 1;
  return baseMiles * mult;
}

// ────────────────────────────────────────────────────── Distance estimation

/**
 * Estimate the straight-line miles between two nodes given optional hex
 * coordinates stamped on each. If a node carries an explicit `travelMiles`
 * edge distance (future feature — GM-authored roads), prefer that.
 *
 * When coords aren't available we fall back to a conservative default per
 * node kind (same-region wilderness hops ≈ 10 mi, town-to-town ≈ 30 mi).
 *
 * Task #86 (2026-04-19) — `tree` is now an optional third arg. When supplied,
 * per-hex mile distance is resolved from the destination node's region
 * ancestors via `getHexSizeMilesForNode` (so Hinterlands travel uses 1-mi
 * hexes, Varisia uses 12-mi, etc.). Without `tree`, falls back to the
 * DEFAULT_HEX_SIZE_MILES — callers that have the tree in hand should always
 * pass it. `calculateTravelPlan` below does.
 *
 * NOTE: The hex-edge math is still straight Manhattan distance in axial
 * coords. A proper Dijkstra over tree edges is parked as a follow-up.
 */
export function estimateSegmentMiles(fromNode, toNode, tree = null) {
  if (!fromNode || !toNode) return 0;
  // Prefer explicit travel distance if the node-pair has one. DM-authored
  // per-edge override — wins over every other resolution.
  const edges = fromNode.travelEdges || {};
  if (Number.isFinite(edges[toNode.id])) return Math.max(0, edges[toNode.id]);

  // Hex coordinate distance (axial). Operator places nodes on a hex grid via
  // MapTab — each node carries {hexQ, hexR}. Hex-size in miles is resolved
  // from the destination node's region ancestors (so a 5-hex trek through
  // the 1-mi Hinterlands = 5 mi, but a 5-hex trek across 12-mi Varisia = 60).
  if (
    Number.isFinite(fromNode.hexQ) && Number.isFinite(fromNode.hexR) &&
    Number.isFinite(toNode.hexQ) && Number.isFinite(toNode.hexR)
  ) {
    const hexMiles = tree
      ? getHexSizeMilesForNode(tree, toNode.id)
      : DEFAULT_HEX_SIZE_MILES;
    const dq = fromNode.hexQ - toNode.hexQ;
    const dr = fromNode.hexR - toNode.hexR;
    const ds = -dq - dr;
    const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
    return Math.max(1, Math.round(dist * hexMiles));
  }

  // Fallback: kind-based heuristic. Child/parent hops are 0 (stepping into a
  // building doesn't trigger overland); siblings depend on parent kind.
  if (fromNode.id === toNode.parentId || toNode.id === fromNode.parentId) return 0;
  const k = String(toNode.kind || '').toLowerCase();
  if (k === 'room' || k === 'floor' || k === 'building' || k === 'area') return 0;
  if (k === 'town' || k === 'village' || k === 'city') return 30;
  if (k === 'wilderness' || k === 'landmark' || k === 'dungeon') return 10;
  if (k === 'region' || k === 'country') return 60;
  return 20;
}

// ────────────────────────────────────────────────────── Path planning

/**
 * Build the ordered list of pass-through node ids for a journey.
 *
 * We walk up from `fromPath` until we hit the lowest common ancestor with
 * `toPath`, then walk down. The ancestors in between represent abstract
 * regions the party crosses — they're tick-passes, not new scenes. The
 * target node (last id in toPath) is the arrival.
 *
 * Returns an array of node ids [from, ...intermediate, to] suitable for
 * tickArrivalCascade-style cascade ticks.
 */
export function buildTravelPath(fromPath, toPath) {
  if (!Array.isArray(fromPath) || !Array.isArray(toPath) || fromPath.length === 0 || toPath.length === 0) {
    return [];
  }
  // Find LCA index.
  let lca = -1;
  const lim = Math.min(fromPath.length, toPath.length);
  for (let i = 0; i < lim; i++) {
    if (fromPath[i] === toPath[i]) lca = i;
    else break;
  }
  if (lca < 0) {
    // No common ancestor — just concatenate and let caller dedupe.
    return [...fromPath, ...toPath];
  }
  const up = fromPath.slice(lca).reverse();
  const down = toPath.slice(lca + 1);
  const out = [...up];
  for (const id of down) out.push(id);
  return out;
}

/**
 * Compute a full travel plan between two world-tree paths.
 *
 * @param {Object} args
 * @param {Object} args.tree       — worldTree
 * @param {Array}  args.fromPath   — current activePath (id array root→leaf)
 * @param {Array}  args.toPath     — destination path (id array root→leaf)
 * @param {Array}  args.party      — party array (member objects for speed)
 * @param {Object} [args.opts]     — { mount, forcedMarchHours, roadOverride }
 * @returns {{
 *   fromId: string,
 *   toId: string,
 *   passThroughIds: string[],
 *   segments: Array<{
 *     fromId: string, toId: string, terrain: string, road: string,
 *     miles: number, hours: number, encounterCheck: { roll: number, triggered: boolean, dc: number } | null,
 *   }>,
 *   totalMiles: number,
 *   totalHours: number,
 *   totalDays: number,
 * }}
 */
export function calculateTravelPlan({ tree, fromPath, toPath, party = [], opts = {} } = {}) {
  const passThroughIds = buildTravelPath(fromPath, toPath);
  if (passThroughIds.length <= 1) {
    return {
      fromId: fromPath?.[fromPath.length - 1] || null,
      toId: toPath?.[toPath.length - 1] || null,
      passThroughIds,
      segments: [],
      totalMiles: 0,
      totalHours: 0,
      totalDays: 0,
    };
  }

  const baseMilesPerDay = partyMilesPerDay(party, opts);
  const segments = [];
  let totalMiles = 0;

  for (let i = 0; i < passThroughIds.length - 1; i++) {
    const a = tree?.nodes?.[passThroughIds[i]] || null;
    const b = tree?.nodes?.[passThroughIds[i + 1]] || null;
    if (!a || !b) continue;

    // Terrain/road resolved from the destination end of this segment so
    // "entering the forest" uses forest multipliers. Fallback to origin
    // side, then 'plains' / 'road'.
    const terrain = normalizeTerrain(b.terrain || a.terrain || 'plains');
    const road = normalizeRoad(opts.roadOverride || b.roadSurface || a.roadSurface || 'road');
    // Pass `tree` so estimateSegmentMiles can resolve per-region hex size
    // via ancestor walk (Task #86).
    const miles = estimateSegmentMiles(a, b, tree);
    if (miles <= 0) continue;

    const effMiles = effectiveMilesPerDay(baseMilesPerDay, terrain, road);
    const hoursPerDay = BASE_WALK_HOURS_PER_DAY;
    // Hours for this segment = miles / (effMiles / hoursPerDay) = miles × (hoursPerDay / effMiles)
    const hours = effMiles > 0 ? miles * (hoursPerDay / effMiles) : 0;

    segments.push({
      fromId: a.id,
      toId: b.id,
      fromName: a.name,
      toName: b.name,
      terrain,
      road,
      miles,
      hours: round1(hours),
      encounterCheck: null, // filled by rollEncountersForPlan if requested
    });
    totalMiles += miles;
  }

  const totalHours = segments.reduce((s, seg) => s + seg.hours, 0);
  const totalDays = totalHours / BASE_WALK_HOURS_PER_DAY;

  return {
    fromId: fromPath?.[fromPath.length - 1] || null,
    toId: toPath?.[toPath.length - 1] || null,
    passThroughIds,
    segments,
    totalMiles,
    totalHours: round1(totalHours),
    totalDays: round1(totalDays),
    baseMilesPerDay,
  };
}

// ────────────────────────────────────────────────────── Encounter rolls

/**
 * Deterministic RNG factory (mulberry32) so travel rolls are reproducible
 * from a seed. If no seed is provided, fall back to Math.random.
 */
function makeRng(seed) {
  if (!Number.isFinite(seed)) return Math.random;
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rollD20(rng = Math.random) {
  return 1 + Math.floor(rng() * 20);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Roll encounter checks for every segment in a plan. One check per
 * ENCOUNTER_FREQUENCY[terrain].perHours block (so a 12-hour forest segment
 * rolls 3 times for a 4-hour cadence).
 *
 * Mutates the plan (attaches encounterCheck to each segment) and returns the
 * list of triggered encounters for easy iteration by the caller.
 *
 * @returns {Array<{ segmentIndex: number, fromId: string, toId: string,
 *                   terrain: string, rollNumber: number, atHour: number }>}
 */
export function rollEncountersForPlan(plan, { seed } = {}) {
  if (!plan || !Array.isArray(plan.segments) || plan.segments.length === 0) return [];
  const rng = makeRng(seed);
  const triggered = [];
  plan.segments.forEach((seg, i) => {
    const freq = ENCOUNTER_FREQUENCY[seg.terrain] || ENCOUNTER_FREQUENCY.plains;
    const rollsThisSegment = Math.max(1, Math.ceil(seg.hours / freq.perHours));
    const rolls = [];
    for (let r = 0; r < rollsThisSegment; r++) {
      const roll = rollD20(rng);
      const hit = roll <= freq.dc;
      rolls.push({ roll, triggered: hit, dc: freq.dc });
      if (hit) {
        triggered.push({
          segmentIndex: i,
          fromId: seg.fromId,
          toId: seg.toId,
          terrain: seg.terrain,
          rollNumber: r + 1,
          atHour: (r + 1) * freq.perHours,
        });
      }
    }
    seg.encounterChecks = rolls;
    seg.encounterCheck = rolls.find(x => x.triggered) || rolls[0] || null;
  });
  return triggered;
}

// ────────────────────────────────────────────────────── Narrative beats

/**
 * Convert a plan into a list of human-readable beats suitable for a travel
 * modal or log. Each beat is { label, detail } and represents either a
 * terrain transition, a day's march, or a triggered encounter.
 *
 * The caller is expected to render these as a bulleted timeline and (for
 * encounter beats) offer an Acknowledge button before advancing.
 */
export function buildTravelBeats(plan) {
  if (!plan || !Array.isArray(plan.segments)) return [];
  const beats = [];
  plan.segments.forEach((seg, i) => {
    beats.push({
      kind: 'segment',
      label: `${seg.fromName || 'Origin'} → ${seg.toName || 'Destination'}`,
      detail: `${seg.miles} mi through ${seg.terrain} on ${seg.road} — ~${round1(seg.hours)} hours`,
      segmentIndex: i,
    });
    if (Array.isArray(seg.encounterChecks)) {
      seg.encounterChecks.forEach((r, idx) => {
        if (r.triggered) {
          beats.push({
            kind: 'encounter',
            label: `Encounter in the ${seg.terrain}`,
            detail: `d20=${r.roll} ≤ DC ${r.dc} — roll for an encounter (${seg.terrain})`,
            segmentIndex: i,
            rollIndex: idx,
          });
        }
      });
    }
  });
  if (plan.totalHours > 0) {
    beats.push({
      kind: 'summary',
      label: 'Arrival',
      detail: `${plan.totalMiles} mi total, ~${round1(plan.totalHours)} hours (${round1(plan.totalDays)} days of travel)`,
    });
  }
  return beats;
}

export default {
  TERRAIN_MULTIPLIERS,
  TERRAIN_KINDS,
  ROAD_KINDS,
  BASE_MILES_PER_DAY_BY_SPEED,
  MOUNT_MILES_PER_DAY,
  ENCOUNTER_FREQUENCY,
  normalizeTerrain,
  normalizeRoad,
  partyMilesPerDay,
  effectiveMilesPerDay,
  estimateSegmentMiles,
  buildTravelPath,
  calculateTravelPlan,
  rollEncountersForPlan,
  buildTravelBeats,
};
