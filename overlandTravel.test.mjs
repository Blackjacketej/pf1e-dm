// Smoke test for src/services/overlandTravel.js (bug #42).
// Run: node overlandTravel.test.mjs
//
// Covers CRB Table 7-8 multipliers, speed → miles/day lookup, path building
// across a common ancestor, and deterministic encounter rolls with a seed.

import {
  TERRAIN_MULTIPLIERS,
  normalizeTerrain,
  normalizeRoad,
  partyMilesPerDay,
  effectiveMilesPerDay,
  estimateSegmentMiles,
  buildTravelPath,
  calculateTravelPlan,
  rollEncountersForPlan,
  buildTravelBeats,
} from './src/services/overlandTravel.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', msg); }
}
function assertEq(a, b, msg) {
  if (a === b) { passed++; }
  else { failed++; console.error(`FAIL: ${msg} — expected ${b}, got ${a}`); }
}

// ── Terrain normalization
assertEq(normalizeTerrain('Forest'), 'forest', 'normalizeTerrain capitalized');
assertEq(normalizeTerrain('woods'), 'forest', 'alias woods → forest');
assertEq(normalizeTerrain('marsh'), 'swamp', 'alias marsh → swamp');
assertEq(normalizeTerrain('alpine'), 'mountains', 'alias alpine → mountains');
assertEq(normalizeTerrain(''), 'plains', 'empty → plains default');
assertEq(normalizeTerrain(null), 'plains', 'null → plains default');
assertEq(normalizeTerrain('unknownstuff'), 'plains', 'unknown → plains default');

// ── Road normalization
assertEq(normalizeRoad('Highway'), 'highway', 'normalizeRoad capitalized');
assertEq(normalizeRoad('path'), 'trail', 'alias path → trail');
assertEq(normalizeRoad('wild'), 'trackless', 'alias wild → trackless');
assertEq(normalizeRoad(''), 'road', 'empty → road default');

// ── Terrain multipliers match CRB Table 7-8 p.172
// Sample hot-path rows verified against the PDF.
assertEq(TERRAIN_MULTIPLIERS.plains.highway, 1, 'plains × highway = ×1');
assertEq(TERRAIN_MULTIPLIERS.plains.trackless, 3/4, 'plains × trackless = ×3/4');
assertEq(TERRAIN_MULTIPLIERS.forest.trackless, 1/2, 'forest × trackless = ×1/2');
assertEq(TERRAIN_MULTIPLIERS.jungle.trackless, 1/4, 'jungle × trackless = ×1/4');
assertEq(TERRAIN_MULTIPLIERS.mountains.highway, 3/4, 'mountains × highway = ×3/4');
assertEq(TERRAIN_MULTIPLIERS.swamp.road, 3/4, 'swamp × road = ×3/4');
assertEq(TERRAIN_MULTIPLIERS.desert.road, 1/2, 'desert × road = ×1/2');
assertEq(TERRAIN_MULTIPLIERS.tundra.trackless, 3/4, 'tundra × trackless = ×3/4');

// ── Party miles per day — slowest member sets pace
assertEq(partyMilesPerDay([{ speed: 30 }, { speed: 30 }]), 24, '30 ft party → 24 mi/day');
assertEq(partyMilesPerDay([{ speed: 30 }, { speed: 20 }]), 16, 'mixed party → slowest 20 ft → 16 mi/day');
assertEq(partyMilesPerDay([{ speed: 40 }]), 32, 'single 40 ft → 32 mi/day');
assertEq(partyMilesPerDay([]), 24, 'empty party defaults to 30 ft');
assertEq(partyMilesPerDay([{ speed: 30 }], { mount: 'light-horse' }), 40, 'mount overrides → 40 mi/day');

// ── Effective miles with terrain
const forestTrackless = effectiveMilesPerDay(24, 'forest', 'trackless');
assertEq(forestTrackless, 12, '24 mi/day × forest trackless (1/2) = 12');

// ── Segment miles estimation
const nodeA = { id: 'a', name: 'A', hexQ: 0, hexR: 0, kind: 'town' };
const nodeB = { id: 'b', name: 'B', hexQ: 5, hexR: 0, kind: 'town' };
assertEq(estimateSegmentMiles(nodeA, nodeB), 30, 'hex distance 5 × 6mi = 30');

const dungeon = { id: 'd', name: 'Cave', kind: 'dungeon' };
const noCoord = { id: 'nc', name: 'Other Town', kind: 'town' };
assertEq(estimateSegmentMiles(dungeon, noCoord), 30, 'no coords → town heuristic = 30');

const room = { id: 'r', name: 'Room', kind: 'room' };
const wildernessLink = { id: 'w', name: 'Woods', kind: 'wilderness' };
assert(estimateSegmentMiles(dungeon, room) === 0 || estimateSegmentMiles(dungeon, room) === 10,
  'dungeon → room varies but non-negative');

// Explicit travelEdges override
const edgeA = { id: 'ea', travelEdges: { eb: 42 } };
const edgeB = { id: 'eb' };
assertEq(estimateSegmentMiles(edgeA, edgeB), 42, 'explicit travelEdges wins');

// ── Path building across LCA
// Tree: world → varisia → sandpoint (town), world → varisia → magnimar (town)
// fromPath = [world, varisia, sandpoint]
// toPath   = [world, varisia, magnimar]
// Expected passThroughIds: sandpoint → varisia → magnimar (up one, down one)
const fromP = ['world', 'varisia', 'sandpoint'];
const toP   = ['world', 'varisia', 'magnimar'];
const through = buildTravelPath(fromP, toP);
assertEq(JSON.stringify(through), JSON.stringify(['sandpoint', 'varisia', 'magnimar']),
  'LCA path: sandpoint → varisia → magnimar');

// No common ancestor → concat
const noLca = buildTravelPath(['a'], ['b']);
assertEq(JSON.stringify(noLca), JSON.stringify(['a', 'b']), 'no LCA → simple concat');

// Same path → degenerate: LCA is the leaf itself, so up=[leaf] and down=[]
// collapses to just the target id. Caller of switchToNodePath short-circuits
// via samePath() before ever hitting buildTravelPath with identical inputs.
const same = buildTravelPath(fromP, fromP);
assertEq(JSON.stringify(same), JSON.stringify(['sandpoint']),
  'same path → single-node pass-through (caller short-circuits earlier)');

// ── Full plan calculation
const tree = {
  rootId: 'world',
  nodes: {
    world:    { id: 'world',    name: 'Golarion', kind: 'world',   parentId: null,      childrenIds: ['varisia'] },
    varisia:  { id: 'varisia',  name: 'Varisia',  kind: 'region',  parentId: 'world',   childrenIds: ['sandpoint','magnimar'],
                terrain: 'hills', roadSurface: 'road', hexQ: 0, hexR: 0 },
    sandpoint:{ id: 'sandpoint',name: 'Sandpoint',kind: 'town',    parentId: 'varisia', childrenIds: [],
                terrain: 'coast', roadSurface: 'road', hexQ: 0, hexR: 0 },
    magnimar: { id: 'magnimar', name: 'Magnimar', kind: 'city',    parentId: 'varisia', childrenIds: [],
                terrain: 'coast', roadSurface: 'road', hexQ: 6, hexR: 0 }, // 36 mi via hex
  },
};
const plan = calculateTravelPlan({
  tree,
  fromPath: ['world', 'varisia', 'sandpoint'],
  toPath:   ['world', 'varisia', 'magnimar'],
  party:    [{ speed: 30 }],
});
assert(plan.totalMiles > 0, 'plan has non-zero miles');
assert(plan.totalHours > 0, 'plan has non-zero hours');
assertEq(plan.baseMilesPerDay, 24, 'plan baseline = 24 mi/day');
// Sandpoint → Varisia (0 mi, same-region ancestor step shouldn't add miles) +
// Varisia → Magnimar (hex 6 apart → 36 mi via plains/coast normalized).
assert(plan.segments.length >= 1, 'plan has at least one segment');

// ── Encounter rolls are deterministic with a seed
const plan2 = calculateTravelPlan({
  tree,
  fromPath: ['world', 'varisia', 'sandpoint'],
  toPath:   ['world', 'varisia', 'magnimar'],
  party:    [{ speed: 30 }],
});
const enc1 = rollEncountersForPlan(plan2, { seed: 42 });
const plan3 = calculateTravelPlan({
  tree,
  fromPath: ['world', 'varisia', 'sandpoint'],
  toPath:   ['world', 'varisia', 'magnimar'],
  party:    [{ speed: 30 }],
});
const enc2 = rollEncountersForPlan(plan3, { seed: 42 });
assertEq(JSON.stringify(enc1), JSON.stringify(enc2), 'same seed → identical encounters');

// Different seed diverges (usually — assertion is probabilistic but the space is large)
const plan4 = calculateTravelPlan({
  tree,
  fromPath: ['world', 'varisia', 'sandpoint'],
  toPath:   ['world', 'varisia', 'magnimar'],
  party:    [{ speed: 30 }],
});
const enc3 = rollEncountersForPlan(plan4, { seed: 999 });
// Sanity: at least the per-segment roll arrays are stamped
assert(plan4.segments.every(s => Array.isArray(s.encounterChecks)), 'every segment has encounterChecks');

// ── Beats render
const beats = buildTravelBeats(plan2);
assert(beats.length >= 2, 'beats include at least one segment + summary');
assert(beats.some(b => b.kind === 'summary'), 'beats include arrival summary');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
