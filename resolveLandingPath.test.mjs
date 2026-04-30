// resolveLandingPath.test.mjs — Bug #37 (2026-04-17) coverage.
//
// Verifies the extended resolveLandingPath cascade shipped alongside the
// breadcrumb over-travel fix. Covers:
//   - Container tiers (WORLD/CONTINENT/COUNTRY/REGION/PLANE) are never a
//     valid landing tail; cascade descends through them.
//   - defaultEntry takes precedence over first-child fallback.
//   - Town-like defaultEntry cascade (pre-existing #49 behavior) still works.
//   - Cycle guard prevents infinite loops on a malformed tree.
//   - Identity-equal return when no cascade occurs.
//   - Multi-hop cascade through full geographic stack.
//
// Run: npx vite-node resolveLandingPath.test.mjs

import {
  NODE_KINDS,
  isContainerKind,
  CONTAINER_KINDS,
  resolveLandingPath,
  getDefaultEntryChildId,
} from './src/services/worldTree.js';

let passed = 0;
let failed = 0;
const fails = [];

function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`\u2713 ${name}`);
  } catch (err) {
    failed += 1;
    fails.push({ name, err });
    console.error(`\u2717 ${name}\n  ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'expected equal'}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

function assertArrEq(actual, expected, msg) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) {
    throw new Error(`${msg || 'expected arrays'}`);
  }
  if (actual.length !== expected.length) {
    throw new Error(`${msg || 'length mismatch'}: got ${actual.length}, want ${expected.length}`);
  }
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${msg || 'index mismatch'} at [${i}]: got ${actual[i]}, want ${expected[i]}`);
    }
  }
}

// ─────────────────────────────────────── helpers

function makeTree(nodes) {
  const map = {};
  for (const n of nodes) map[n.id] = { ...n, childrenIds: n.childrenIds || [] };
  // Wire parentId → childrenIds if children were declared
  for (const n of Object.values(map)) {
    if (n.parentId && map[n.parentId] && !map[n.parentId].childrenIds.includes(n.id)) {
      map[n.parentId].childrenIds.push(n.id);
    }
  }
  return { rootId: nodes[0].id, nodes: map };
}

// ─────────────────────────────────────── T1: container kinds predicate

t('T1 — CONTAINER_KINDS includes world/continent/country/region/plane', () => {
  assert(CONTAINER_KINDS.has('world'), 'world should be container');
  assert(CONTAINER_KINDS.has('continent'), 'continent should be container');
  assert(CONTAINER_KINDS.has('country'), 'country should be container');
  assert(CONTAINER_KINDS.has('region'), 'region should be container');
  assert(CONTAINER_KINDS.has('plane'), 'plane should be container');
});

t('T1b — CONTAINER_KINDS does NOT include town/city/village/building/room/area/wilderness', () => {
  assert(!CONTAINER_KINDS.has('town'), 'town should NOT be container (uses defaultEntry cascade instead)');
  assert(!CONTAINER_KINDS.has('city'), 'city should NOT be container');
  assert(!CONTAINER_KINDS.has('village'), 'village should NOT be container');
  assert(!CONTAINER_KINDS.has('building'), 'building should NOT be container');
  assert(!CONTAINER_KINDS.has('room'), 'room should NOT be container');
  assert(!CONTAINER_KINDS.has('area'), 'area should NOT be container');
  assert(!CONTAINER_KINDS.has('wilderness'), 'wilderness should NOT be container');
});

t('T1c — isContainerKind helper agrees with set', () => {
  assert(isContainerKind('world'), 'isContainerKind(world) should be true');
  assert(!isContainerKind('town'), 'isContainerKind(town) should be false');
  assert(!isContainerKind('area'), 'isContainerKind(area) should be false');
  assert(!isContainerKind(undefined), 'isContainerKind(undefined) should be false');
});

// ─────────────────────────────────────── T2: town defaultEntry (pre-existing #49)

t('T2 — town with defaultEntry cascades to named child (#49 regression)', () => {
  const tree = makeTree([
    { id: 'sp', name: 'Sandpoint', kind: NODE_KINDS.TOWN, defaultEntry: 'Market Square' },
    { id: 'ms', parentId: 'sp', name: 'Market Square', kind: NODE_KINDS.AREA },
    { id: 'rd', parentId: 'sp', name: 'Main Road', kind: NODE_KINDS.AREA },
  ]);
  const resolved = resolveLandingPath(tree, ['sp']);
  assertArrEq(resolved, ['sp', 'ms'], 'should cascade Sandpoint → Market Square');
});

t('T2b — town without defaultEntry does NOT cascade (town is a valid leaf historically)', () => {
  // This preserves pre-#37 behavior: a town with no defaultEntry and no
  // container-kind rule is a valid leaf. Only explicit defaultEntry or
  // container-kind rule forces descent.
  const tree = makeTree([
    { id: 'sp', name: 'Sandpoint', kind: NODE_KINDS.TOWN /* no defaultEntry */ },
    { id: 'ms', parentId: 'sp', name: 'Market Square', kind: NODE_KINDS.AREA },
  ]);
  const resolved = resolveLandingPath(tree, ['sp']);
  assertArrEq(resolved, ['sp'], 'town without defaultEntry should stay as tail');
});

// ─────────────────────────────────────── T3: container cascade (Bug #37 core)

t('T3 — world-tier tail cascades down via first non-container child', () => {
  const tree = makeTree([
    { id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD },
    { id: 'a', parentId: 'g', name: 'Avistan', kind: NODE_KINDS.CONTINENT },
    { id: 'v', parentId: 'a', name: 'Varisia', kind: NODE_KINDS.COUNTRY },
    { id: 'h', parentId: 'v', name: 'Hinterlands', kind: NODE_KINDS.REGION },
    { id: 'sp', parentId: 'h', name: 'Sandpoint', kind: NODE_KINDS.TOWN, defaultEntry: 'Main Road' },
    { id: 'mr', parentId: 'sp', name: 'Main Road', kind: NODE_KINDS.AREA },
  ]);
  const resolved = resolveLandingPath(tree, ['g']);
  // Should cascade all the way down to Main Road
  assertArrEq(resolved, ['g', 'a', 'v', 'h', 'sp', 'mr'],
    'Golarion should cascade all the way down through containers to Main Road hub');
});

t('T3b — mid-geography cascade (party parked at Varisia) still lands at hub', () => {
  const tree = makeTree([
    { id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD },
    { id: 'a', parentId: 'g', name: 'Avistan', kind: NODE_KINDS.CONTINENT },
    { id: 'v', parentId: 'a', name: 'Varisia', kind: NODE_KINDS.COUNTRY },
    { id: 'h', parentId: 'v', name: 'Hinterlands', kind: NODE_KINDS.REGION },
    { id: 'sp', parentId: 'h', name: 'Sandpoint', kind: NODE_KINDS.TOWN, defaultEntry: 'Main Road' },
    { id: 'mr', parentId: 'sp', name: 'Main Road', kind: NODE_KINDS.AREA },
  ]);
  const resolved = resolveLandingPath(tree, ['g', 'a', 'v']);
  assertArrEq(resolved, ['g', 'a', 'v', 'h', 'sp', 'mr'],
    'Varisia should cascade through Hinterlands → Sandpoint → Main Road');
});

t('T3c — container with defaultEntry takes precedence over first-child', () => {
  const tree = makeTree([
    { id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD, defaultEntry: 'Tian Xia' },
    { id: 'a', parentId: 'g', name: 'Avistan', kind: NODE_KINDS.CONTINENT },
    { id: 'tx', parentId: 'g', name: 'Tian Xia', kind: NODE_KINDS.CONTINENT },
  ]);
  const resolved = resolveLandingPath(tree, ['g']);
  // Golarion.defaultEntry='Tian Xia' should be honored over first-child (Avistan)
  assertEq(resolved[1], 'tx', 'defaultEntry should win over first-child fallback');
});

t('T3d — container with no children is a dead-end, not a cascade (no crash)', () => {
  const tree = makeTree([
    { id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD /* no children */ },
  ]);
  const resolved = resolveLandingPath(tree, ['g']);
  // Without a child to cascade to, the path stays at Golarion. UI guards
  // should prevent this scenario from arising (you can't travel to a
  // childless container in the first place), but the function must not
  // crash or loop.
  assertArrEq(resolved, ['g'], 'childless container should not crash; returns input');
});

// ─────────────────────────────────────── T4: identity equality when no cascade

t('T4 — identity-equal return when tail is valid leaf', () => {
  const tree = makeTree([
    { id: 'sp', name: 'Sandpoint', kind: NODE_KINDS.TOWN, defaultEntry: 'Main Road' },
    { id: 'mr', parentId: 'sp', name: 'Main Road', kind: NODE_KINDS.AREA },
  ]);
  const input = ['sp', 'mr'];
  const resolved = resolveLandingPath(tree, input);
  assert(resolved === input, 'identity equality when path already lands at valid leaf');
});

t('T4b — empty path is identity no-op', () => {
  const tree = makeTree([{ id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD }]);
  const resolved = resolveLandingPath(tree, []);
  assertArrEq(resolved, [], 'empty path returns empty');
});

// ─────────────────────────────────────── T5: cycle guard

t('T5 — cycle-forming defaultEntry is broken (no infinite loop)', () => {
  // Build a tree where A.defaultEntry='B' and B.defaultEntry='A'. Malformed
  // but shouldn't hang.
  const tree = {
    rootId: 'a',
    nodes: {
      a: { id: 'a', name: 'A', kind: NODE_KINDS.TOWN, defaultEntry: 'B', childrenIds: ['b'] },
      b: { id: 'b', name: 'B', kind: NODE_KINDS.TOWN, defaultEntry: 'A', parentId: 'a', childrenIds: ['a'] },
    },
  };
  const resolved = resolveLandingPath(tree, ['a']);
  // First hop: a → b. Second hop: b would try to extend to a, but a is
  // already in the seen set, so we stop.
  assertArrEq(resolved, ['a', 'b'], 'cycle should terminate after one hop');
});

// ─────────────────────────────────────── T6: getDefaultEntryChildId extension

t('T6 — getDefaultEntryChildId now honors non-town nodes with defaultEntry', () => {
  // Phase 1 seeded BUILDINGs (e.g. Rusty Dragon) with defaultEntry='Ground Floor'.
  // Pre-#37 getDefaultEntryChildId was town-only and ignored these. Now it
  // honors any kind with defaultEntry.
  const tree = makeTree([
    { id: 'rd', name: 'The Rusty Dragon', kind: NODE_KINDS.BUILDING, defaultEntry: 'Ground Floor' },
    { id: 'gf', parentId: 'rd', name: 'Ground Floor', kind: NODE_KINDS.FLOOR },
    { id: 'uf', parentId: 'rd', name: 'Upper Floor', kind: NODE_KINDS.FLOOR },
  ]);
  const childId = getDefaultEntryChildId(tree, 'rd');
  assertEq(childId, 'gf', 'building defaultEntry should resolve');
});

t('T6b — getDefaultEntryChildId returns null on nodes without defaultEntry', () => {
  const tree = makeTree([
    { id: 'area', name: 'Plain Area', kind: NODE_KINDS.AREA /* no defaultEntry */ },
  ]);
  const childId = getDefaultEntryChildId(tree, 'area');
  assertEq(childId, null, 'no defaultEntry → null');
});

// ─────────────────────────────────────── T7: Phase 1 Sandpoint scenario (Bug #37 live repro)

t('T7 — Phase 1 scenario: party stuck at Golarion bounces back to Main Road', () => {
  // Exact layout from the bug repro: Tom walked Sandpoint → Hinterlands →
  // Varisia → Avistan → Golarion via breadcrumb pills. Now after the fix,
  // his save's activePath = ['g'] (single element). Mount-time
  // resolveLandingPath should cascade down to Main Road.
  const tree = makeTree([
    { id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD },
    { id: 'a', parentId: 'g', name: 'Avistan', kind: NODE_KINDS.CONTINENT },
    { id: 'v', parentId: 'a', name: 'Varisia', kind: NODE_KINDS.COUNTRY },
    { id: 'h', parentId: 'v', name: 'Sandpoint Hinterlands', kind: NODE_KINDS.REGION },
    { id: 'sp', parentId: 'h', name: 'Sandpoint', kind: NODE_KINDS.TOWN, defaultEntry: 'Main Road' },
    { id: 'mr', parentId: 'sp', name: 'Main Road', kind: NODE_KINDS.AREA },
    { id: 'ms', parentId: 'sp', name: 'Market Square', kind: NODE_KINDS.AREA },
  ]);
  const resolved = resolveLandingPath(tree, ['g']);
  assertArrEq(resolved, ['g', 'a', 'v', 'h', 'sp', 'mr'],
    'bad-save recovery: world-root path cascades to Main Road hub');
});

t('T7b — Phase 1 scenario: cascade respects defaultEntry when set mid-tree', () => {
  // If Avistan gained a defaultEntry='Varisia' (not currently seeded but
  // plausible future state), cascade should still reach the hub.
  const tree = makeTree([
    { id: 'g', name: 'Golarion', kind: NODE_KINDS.WORLD, defaultEntry: 'Avistan' },
    { id: 'a', parentId: 'g', name: 'Avistan', kind: NODE_KINDS.CONTINENT, defaultEntry: 'Varisia' },
    { id: 'v', parentId: 'a', name: 'Varisia', kind: NODE_KINDS.COUNTRY },
    { id: 'h', parentId: 'v', name: 'Sandpoint Hinterlands', kind: NODE_KINDS.REGION },
    { id: 'sp', parentId: 'h', name: 'Sandpoint', kind: NODE_KINDS.TOWN, defaultEntry: 'Main Road' },
    { id: 'mr', parentId: 'sp', name: 'Main Road', kind: NODE_KINDS.AREA },
  ]);
  const resolved = resolveLandingPath(tree, ['g']);
  assertEq(resolved[resolved.length - 1], 'mr', 'full defaultEntry chain reaches Main Road');
});

// ─────────────────────────────────────── T8: max-hops safety

t('T8 — max-hops limit prevents runaway (deep container chain beyond 12 levels)', () => {
  // Build a 20-deep chain of CONTINENT nodes, each linking to the next via
  // first-child. Cascade should terminate at 12 hops, not loop forever.
  const nodes = [];
  for (let i = 0; i < 20; i += 1) {
    nodes.push({
      id: `c${i}`,
      parentId: i === 0 ? null : `c${i - 1}`,
      name: `Continent ${i}`,
      kind: NODE_KINDS.CONTINENT,
    });
  }
  const tree = makeTree(nodes);
  const resolved = resolveLandingPath(tree, ['c0']);
  // Should have hopped at most 12 times, leaving a path of length ≤ 13.
  assert(resolved.length <= 13, `cascade should cap at 12 hops; got length ${resolved.length}`);
});

// ─────────────────────────────────────── summary

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of fails) console.error(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
