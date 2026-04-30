// settlementGate.test.mjs
// Regression tests for Bug #66 (2026-04-18): hex travel must be locked
// while the party is physically inside a settlement (town/city/village/
// building/floor/room). Exercises findSettlementAncestor + isSettlementKind
// + SETTLEMENT_KINDS from src/services/worldTree.js.
//
// Run: npx vite-node settlementGate.test.mjs

import {
  createTree,
  createChildNode,
  NODE_KINDS,
  isSettlementKind,
  findSettlementAncestor,
  SETTLEMENT_KINDS,
  isContainerKind,
} from './src/services/worldTree.js';

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// ──────────────────────────────────────────────────────────────────────
section('T1 — SETTLEMENT_KINDS membership');

assert('town is a settlement', isSettlementKind(NODE_KINDS.TOWN));
assert('city is a settlement', isSettlementKind(NODE_KINDS.CITY));
assert('village is a settlement', isSettlementKind(NODE_KINDS.VILLAGE));
assert('building is a settlement', isSettlementKind(NODE_KINDS.BUILDING));
assert('floor is a settlement', isSettlementKind(NODE_KINDS.FLOOR));
assert('room is a settlement', isSettlementKind(NODE_KINDS.ROOM));

assert('world is NOT a settlement', !isSettlementKind(NODE_KINDS.WORLD));
assert('continent is NOT a settlement', !isSettlementKind(NODE_KINDS.CONTINENT));
assert('country is NOT a settlement', !isSettlementKind(NODE_KINDS.COUNTRY));
assert('region is NOT a settlement', !isSettlementKind(NODE_KINDS.REGION));
assert('wilderness is NOT a settlement', !isSettlementKind(NODE_KINDS.WILDERNESS));
assert('landmark is NOT a settlement', !isSettlementKind(NODE_KINDS.LANDMARK));
assert('dungeon is NOT a settlement', !isSettlementKind(NODE_KINDS.DUNGEON));

// ──────────────────────────────────────────────────────────────────────
section('T2 — findSettlementAncestor resolves deepest settlement');

// Build Golarion → Avistan → Varisia → Sandpoint Hinterlands → Sandpoint → Rusty Dragon → Floor 2 → Common Room
const tree = createTree({ id: 'test-tree', rootName: 'Golarion', rootKind: NODE_KINDS.WORLD });
const world = tree.nodes[tree.rootId];
const continent = createChildNode(tree, world.id, { name: 'Avistan',  kind: NODE_KINDS.CONTINENT });
const country   = createChildNode(tree, continent.id, { name: 'Varisia', kind: NODE_KINDS.COUNTRY });
const region    = createChildNode(tree, country.id,   { name: 'Sandpoint Hinterlands', kind: NODE_KINDS.REGION });
const town      = createChildNode(tree, region.id,    { name: 'Sandpoint', kind: NODE_KINDS.TOWN });
const building  = createChildNode(tree, town.id,      { name: 'Rusty Dragon', kind: NODE_KINDS.BUILDING });
const floor     = createChildNode(tree, building.id,  { name: 'Floor 2', kind: NODE_KINDS.FLOOR });
const room      = createChildNode(tree, floor.id,     { name: 'Common Room', kind: NODE_KINDS.ROOM });

// Path: world → continent → country → region → town → building → floor → room
const fullPath = [world.id, continent.id, country.id, region.id, town.id, building.id, floor.id, room.id];

const deepest = findSettlementAncestor(tree, fullPath);
assert('deepest settlement returned (Common Room)', deepest && deepest.name === 'Common Room');

// Up a level — party in Floor 2
const floorPath = fullPath.slice(0, -1);
const floorHit = findSettlementAncestor(tree, floorPath);
assert('floor path → Floor 2', floorHit && floorHit.name === 'Floor 2');

// Building level
const buildingPath = fullPath.slice(0, -2);
const buildingHit = findSettlementAncestor(tree, buildingPath);
assert('building path → Rusty Dragon', buildingHit && buildingHit.name === 'Rusty Dragon');

// Town level
const townPath = [world.id, continent.id, country.id, region.id, town.id];
const townHit = findSettlementAncestor(tree, townPath);
assert('town path → Sandpoint', townHit && townHit.name === 'Sandpoint');

// Region level — outside town, should be null
const regionPath = [world.id, continent.id, country.id, region.id];
const regionHit = findSettlementAncestor(tree, regionPath);
assert('region path → null (not in a settlement)', regionHit === null);

// World/empty paths
assert('world-only path → null', findSettlementAncestor(tree, [world.id]) === null);
assert('empty path → null', findSettlementAncestor(tree, []) === null);
assert('null tree → null', findSettlementAncestor(null, fullPath) === null);
assert('missing nodes key → null', findSettlementAncestor({}, fullPath) === null);

// ──────────────────────────────────────────────────────────────────────
section('T3 — city + village kinds also gate');

const tree2 = createTree({ id: 'test-tree-2', rootName: 'Golarion', rootKind: NODE_KINDS.WORLD });
const w2 = tree2.nodes[tree2.rootId];
const c2 = createChildNode(tree2, w2.id, { name: 'Garund',   kind: NODE_KINDS.CONTINENT });
const k2 = createChildNode(tree2, c2.id, { name: 'Osirion',  kind: NODE_KINDS.COUNTRY });
const city = createChildNode(tree2, k2.id, { name: 'Sothis', kind: NODE_KINDS.CITY });
const vil  = createChildNode(tree2, k2.id, { name: 'Wati',   kind: NODE_KINDS.VILLAGE });

assert('city gates travel',    findSettlementAncestor(tree2, [w2.id, c2.id, k2.id, city.id])?.name === 'Sothis');
assert('village gates travel', findSettlementAncestor(tree2, [w2.id, c2.id, k2.id, vil.id])?.name === 'Wati');

// ──────────────────────────────────────────────────────────────────────
section('T4 — SETTLEMENT_KINDS disjoint from CONTAINER ancestors that should NOT gate');

// Containers (world/plane/continent/country/region) must not be classified
// as settlements — otherwise hex travel would be locked at the region level.
const containerOnlyKinds = [
  NODE_KINDS.WORLD,
  NODE_KINDS.PLANE,
  NODE_KINDS.CONTINENT,
  NODE_KINDS.COUNTRY,
  NODE_KINDS.REGION,
];
for (const k of containerOnlyKinds) {
  assert(`container kind "${k}" is NOT a settlement`, !SETTLEMENT_KINDS.has(k));
  assert(`container kind "${k}" still reports as container`, isContainerKind(k));
}

// ──────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
