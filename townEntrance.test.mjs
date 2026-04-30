// Bug #49 (revision 2026-04-19) — town-entrance routing tests
//
// Covers resolveTownEntranceChildId + resolveLandingPath settlement path.
// Revised per operator direction: approach-direction signal is overland
// hex delta (fromHex), NOT tree-ancestry (fromNodeId has been dropped).
// Open-world fallback when no primary is tagged uses random entrance pick.
//
// Inline-mirror pattern per feedback_sandbox_mount_lag.md — vendors the
// helpers from src/services/worldTree.js byte-for-byte so Linux bindfs
// mount lag can't truncate the import. Run from repo root:
//   node townEntrance.test.mjs

// ────────────────────────────────────────────────────────────── vendored

const NODE_KINDS = Object.freeze({
  WORLD: 'world', CONTINENT: 'continent', COUNTRY: 'country', REGION: 'region',
  TOWN: 'town', CITY: 'city', VILLAGE: 'village',
  BUILDING: 'building', FLOOR: 'floor', ROOM: 'room',
  AREA: 'area', DUNGEON: 'dungeon', WILDERNESS: 'wilderness', LANDMARK: 'landmark',
});

const SETTLEMENT_KINDS = new Set([NODE_KINDS.TOWN, NODE_KINDS.CITY, NODE_KINDS.VILLAGE]);

const CONTAINER_KINDS = new Set([
  NODE_KINDS.WORLD, NODE_KINDS.CONTINENT, NODE_KINDS.COUNTRY, NODE_KINDS.REGION,
]);

function isContainerKind(kind) { return CONTAINER_KINDS.has(kind); }

function axialToCompass(dq, dr) {
  if (!Number.isFinite(dq) || !Number.isFinite(dr)) return null;
  if (dq === 0 && dr === 0) return null;
  const absQ = Math.abs(dq);
  const absR = Math.abs(dr);
  if (absQ > absR) return dq > 0 ? 'east' : 'west';
  return dr > 0 ? 'south' : 'north';
}

function parsePartyHexToAxial(partyHex) {
  if (typeof partyHex !== 'string') return null;
  const parts = partyHex.split(',').map(Number);
  if (parts.length !== 2) return null;
  const [col, row] = parts;
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  const q = col;
  const r = row - Math.floor((col + (col & 1)) / 2);
  return { q, r };
}

function resolveTownEntranceChildId(tree, townId, opts = {}) {
  const town = tree?.nodes?.[townId];
  if (!town) return null;
  const children = (town.childrenIds || []).map(cid => tree.nodes[cid]).filter(Boolean);
  const entrances = children.filter(c => c.entrance === true);
  if (entrances.length === 0) return null;

  if (opts.bySea) {
    const sea = entrances.find(e => e.approachFrom === 'sea');
    if (sea) return sea.id;
  }

  const fromHex = opts.fromHex;
  if (fromHex && Number.isFinite(fromHex.q) && Number.isFinite(fromHex.r)
      && Number.isFinite(town.hexQ) && Number.isFinite(town.hexR)) {
    const dq = town.hexQ - fromHex.q;
    const dr = town.hexR - fromHex.r;
    const compass = axialToCompass(-dq, -dr);
    if (compass) {
      const match = entrances.find(e => e.approachFrom === compass);
      if (match) return match.id;
    }
  }

  const primary = entrances.find(e => e.primary === true);
  if (primary) return primary.id;

  const rand = typeof opts.random === 'function' ? opts.random : Math.random;
  const pick = Math.floor(rand() * entrances.length);
  return entrances[Math.max(0, Math.min(entrances.length - 1, pick))].id;
}

function getDefaultEntryChildId(tree, nodeId) {
  const n = tree?.nodes?.[nodeId];
  if (!n) return null;
  const target = String(n.defaultEntry || '').trim().toLowerCase();
  if (!target) return null;
  const children = (n.childrenIds || []).map(cid => tree.nodes[cid]).filter(Boolean);
  const match = children.find(c => (c.name || '').trim().toLowerCase() === target);
  return match ? match.id : null;
}

function getContainerFallbackChildId(tree, nodeId) {
  const n = tree?.nodes?.[nodeId];
  if (!n) return null;
  if (!isContainerKind(n.kind)) return null;
  const children = (n.childrenIds || []).map(cid => tree.nodes[cid]).filter(Boolean);
  if (children.length === 0) return null;
  const nonContainer = children.find(c => !isContainerKind(c.kind));
  return (nonContainer || children[0]).id;
}

function resolveLandingPath(tree, path, opts = {}) {
  if (!Array.isArray(path) || path.length === 0 || !tree?.nodes) return path;
  let cascaded = false;
  let current = path;
  const seen = new Set(path);
  const MAX_HOPS = 12;
  let entranceOptsConsumed = false;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const tailId = current[current.length - 1];
    const tail = tree.nodes[tailId];
    let extendId = null;
    if (tail && SETTLEMENT_KINDS.has(tail.kind) && !entranceOptsConsumed) {
      extendId = resolveTownEntranceChildId(tree, tailId, opts);
      if (extendId) entranceOptsConsumed = true;
    }
    if (!extendId) extendId = getDefaultEntryChildId(tree, tailId);
    if (!extendId) extendId = getContainerFallbackChildId(tree, tailId);
    if (!extendId) break;
    if (seen.has(extendId)) break;
    seen.add(extendId);
    current = [...current, extendId];
    cascaded = true;
  }
  return cascaded ? current : path;
}

// ────────────────────────────────────────────────────────────── fixtures

// Sandpoint at axial (q=8, r=-1) — offset-even-q key "8,3".
// Magnimar at axial (q=7, r=4) — south of Sandpoint, offset "7,7" (col=7, row=4+floor((7+1)/2)=8)...
// For the tests we pass fromHex as axial directly so offset conversion is tested separately.

function makeTree() {
  const nodes = {
    world: { id: 'world', name: 'Golarion', kind: NODE_KINDS.WORLD, childrenIds: ['varisia'] },
    varisia: { id: 'varisia', name: 'Varisia', kind: NODE_KINDS.REGION, parentId: 'world',
               childrenIds: ['sandpoint', 'foxglove', 'magnimar', 'windsong', 'riddleport'] },
    sandpoint: { id: 'sandpoint', name: 'Sandpoint', kind: NODE_KINDS.TOWN, parentId: 'varisia',
                 hexQ: 8, hexR: -1, defaultEntry: 'Main Road',
                 childrenIds: ['bridge', 'southroad', 'docks', 'mainroad', 'rustydragon'] },
    bridge: { id: 'bridge', name: 'Turandarok Bridge', kind: NODE_KINDS.AREA, parentId: 'sandpoint',
              entrance: true, approachFrom: 'north', primary: true, childrenIds: [] },
    southroad: { id: 'southroad', name: 'Lost Coast Road (South)', kind: NODE_KINDS.AREA,
                 parentId: 'sandpoint', entrance: true, approachFrom: 'south', childrenIds: [] },
    docks: { id: 'docks', name: 'The Docks', kind: NODE_KINDS.AREA, parentId: 'sandpoint',
             entrance: true, approachFrom: 'sea', childrenIds: ['pier'] },
    pier: { id: 'pier', name: 'The Piers', kind: NODE_KINDS.AREA, parentId: 'docks', childrenIds: [] },
    mainroad: { id: 'mainroad', name: 'Main Road', kind: NODE_KINDS.AREA, parentId: 'sandpoint',
                childrenIds: [] },
    rustydragon: { id: 'rustydragon', name: 'Rusty Dragon', kind: NODE_KINDS.BUILDING,
                   parentId: 'sandpoint', defaultEntry: 'Ground Floor', childrenIds: ['ground'] },
    ground: { id: 'ground', name: 'Ground Floor', kind: NODE_KINDS.FLOOR, parentId: 'rustydragon',
              childrenIds: [] },
    foxglove: { id: 'foxglove', name: 'Foxglove Manor', kind: NODE_KINDS.DUNGEON, parentId: 'varisia',
                hexQ: 14, hexR: -2, childrenIds: [] },
    magnimar: { id: 'magnimar', name: 'Magnimar', kind: NODE_KINDS.CITY, parentId: 'varisia',
                hexQ: 7, hexR: 4, childrenIds: [] },
    windsong: { id: 'windsong', name: 'Windsong Abbey', kind: NODE_KINDS.LANDMARK, parentId: 'varisia',
                hexQ: 8, hexR: -8, childrenIds: [] },
    riddleport: { id: 'riddleport', name: 'Riddleport', kind: NODE_KINDS.CITY, parentId: 'varisia',
                  hexQ: 2, hexR: 0, childrenIds: [] },
  };
  return { rootId: 'world', nodes };
}

function makeTownWithoutEntrances() {
  return {
    rootId: 'world',
    nodes: {
      world: { id: 'world', name: 'World', kind: NODE_KINDS.WORLD, childrenIds: ['town'] },
      town: { id: 'town', name: 'Plainville', kind: NODE_KINDS.TOWN, parentId: 'world',
              defaultEntry: 'Square', childrenIds: ['square', 'tavern'] },
      square: { id: 'square', name: 'Square', kind: NODE_KINDS.AREA, parentId: 'town',
                childrenIds: [] },
      tavern: { id: 'tavern', name: 'Tavern', kind: NODE_KINDS.BUILDING, parentId: 'town',
                childrenIds: [] },
    },
  };
}

// Open-world town: two entrances, NO primary tagged.
function makeOpenWorldTown() {
  return {
    rootId: 'world',
    nodes: {
      world: { id: 'world', name: 'World', kind: NODE_KINDS.WORLD, childrenIds: ['ow'] },
      ow: { id: 'ow', name: 'Openville', kind: NODE_KINDS.VILLAGE, parentId: 'world',
            childrenIds: ['gateA', 'gateB', 'gateC'] },
      gateA: { id: 'gateA', name: 'North Gate', kind: NODE_KINDS.AREA, parentId: 'ow',
               entrance: true, childrenIds: [] },
      gateB: { id: 'gateB', name: 'East Gate', kind: NODE_KINDS.AREA, parentId: 'ow',
               entrance: true, childrenIds: [] },
      gateC: { id: 'gateC', name: 'South Gate', kind: NODE_KINDS.AREA, parentId: 'ow',
               entrance: true, childrenIds: [] },
    },
  };
}

// ────────────────────────────────────────────────────────────── tests

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    fail++;
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// Section 1: axialToCompass pure
test('compass: east when |dq|>|dr| and dq>0', () => eq(axialToCompass(5, 1), 'east'));
test('compass: west when |dq|>|dr| and dq<0', () => eq(axialToCompass(-5, 1), 'west'));
test('compass: south when |dr|>|dq| and dr>0', () => eq(axialToCompass(1, 5), 'south'));
test('compass: north when |dr|>|dq| and dr<0', () => eq(axialToCompass(1, -5), 'north'));
test('compass: tie prefers N/S axis', () => eq(axialToCompass(3, 3), 'south'));
test('compass: null on zero delta', () => eq(axialToCompass(0, 0), null));
test('compass: null on non-finite', () => eq(axialToCompass(NaN, 1), null));

// Section 2: parsePartyHexToAxial
test('parsePartyHex: "8,3" → axial {q:8, r:-1} (Sandpoint center)', () => {
  const ax = parsePartyHexToAxial('8,3');
  eq(ax.q, 8);
  eq(ax.r, -1);
});
test('parsePartyHex: "0,0" → axial {q:0, r:0}', () => {
  const ax = parsePartyHexToAxial('0,0');
  eq(ax.q, 0);
  eq(ax.r, 0);
});
test('parsePartyHex: negative coords roundtrip', () => {
  const ax = parsePartyHexToAxial('-3,-2');
  eq(ax.q, -3);
  // col=-3 is odd, so (col & 1) = 1 (in JS, -3 & 1 = 1), floor((-3+1)/2) = -1
  // r = -2 - (-1) = -1
  eq(ax.r, -1);
});
test('parsePartyHex: null → null', () => eq(parsePartyHexToAxial(null), null));
test('parsePartyHex: undefined → null', () => eq(parsePartyHexToAxial(undefined), null));
test('parsePartyHex: empty string → null', () => eq(parsePartyHexToAxial(''), null));
test('parsePartyHex: "8" (1-part) → null', () => eq(parsePartyHexToAxial('8'), null));
test('parsePartyHex: "a,b" (NaN) → null', () => eq(parsePartyHexToAxial('a,b'), null));
test('parsePartyHex: "8,3,extra" → null', () => eq(parsePartyHexToAxial('8,3,extra'), null));
test('parsePartyHex: non-string (number) → null', () => eq(parsePartyHexToAxial(83), null));

// Section 3: resolveTownEntranceChildId direction matching via fromHex
test('entrance: approach from north (fromHex q=8, r=-8) → bridge', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: { q: 8, r: -8 } });
  eq(id, 'bridge');
});
test('entrance: approach from south (fromHex q=7, r=4) → southroad', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: { q: 7, r: 4 } });
  eq(id, 'southroad');
});
test('entrance: approach from east (fromHex q=14, r=-2) → primary (bridge, no east entrance)', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: { q: 14, r: -2 } });
  eq(id, 'bridge');
});
test('entrance: approach from west (fromHex q=2, r=0) → primary (bridge, no west entrance)', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: { q: 2, r: 0 } });
  eq(id, 'bridge');
});
test('entrance: bySea overrides fromHex → docks', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: { q: 7, r: 4 }, bySea: true });
  eq(id, 'docks');
});
test('entrance: bySea with no sea entrance falls back to primary', () => {
  const tree = makeTree();
  delete tree.nodes.docks.entrance;
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { bySea: true });
  eq(id, 'bridge');
});

// Section 4: fallbacks
test('entrance: no opts → primary entrance (bridge)', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', {});
  eq(id, 'bridge');
});
test('entrance: fromHex missing q/r → primary', () => {
  const tree = makeTree();
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: {} });
  eq(id, 'bridge');
});
test('entrance: town missing hex coords → primary', () => {
  const tree = makeTree();
  delete tree.nodes.sandpoint.hexQ;
  delete tree.nodes.sandpoint.hexR;
  const id = resolveTownEntranceChildId(tree, 'sandpoint', { fromHex: { q: 7, r: 4 } });
  eq(id, 'bridge');
});
test('entrance: no entrances tagged → null', () => {
  const tree = makeTownWithoutEntrances();
  const id = resolveTownEntranceChildId(tree, 'town', {});
  eq(id, null);
});
test('entrance: one entrance, no primary → that entrance (no randomness)', () => {
  const tree = {
    rootId: 'w',
    nodes: {
      w: { id: 'w', name: 'W', kind: NODE_KINDS.WORLD, childrenIds: ['t'] },
      t: { id: 't', name: 'T', kind: NODE_KINDS.TOWN, parentId: 'w', childrenIds: ['e'] },
      e: { id: 'e', name: 'E', kind: NODE_KINDS.AREA, parentId: 't',
           entrance: true, childrenIds: [] },
    },
  };
  // Even with random, n=1 means the only entrance wins
  const id = resolveTownEntranceChildId(tree, 't', { random: () => 0.99 });
  eq(id, 'e');
});
test('entrance: missing town node → null', () => {
  const tree = makeTree();
  eq(resolveTownEntranceChildId(tree, 'nope', {}), null);
});
test('entrance: missing tree → null', () => {
  eq(resolveTownEntranceChildId(null, 'sandpoint', {}), null);
});

// Section 5: open-world random fallback (no primary tagged)
test('entrance: open-world, no direction, rand=0 → first entrance (gateA)', () => {
  const tree = makeOpenWorldTown();
  const id = resolveTownEntranceChildId(tree, 'ow', { random: () => 0 });
  eq(id, 'gateA');
});
test('entrance: open-world, no direction, rand=0.5 → middle entrance (gateB)', () => {
  const tree = makeOpenWorldTown();
  const id = resolveTownEntranceChildId(tree, 'ow', { random: () => 0.5 });
  eq(id, 'gateB');
});
test('entrance: open-world, no direction, rand=0.99 → last entrance (gateC)', () => {
  const tree = makeOpenWorldTown();
  const id = resolveTownEntranceChildId(tree, 'ow', { random: () => 0.99 });
  eq(id, 'gateC');
});
test('entrance: open-world, rand=1.0 clamps to last entrance (gateC)', () => {
  const tree = makeOpenWorldTown();
  const id = resolveTownEntranceChildId(tree, 'ow', { random: () => 1.0 });
  eq(id, 'gateC');
});
test('entrance: open-world with Math.random → returns SOME entrance from the pool', () => {
  const tree = makeOpenWorldTown();
  // Stochastic check — call many times, verify every return is a valid entrance
  const valid = new Set(['gateA', 'gateB', 'gateC']);
  for (let i = 0; i < 100; i += 1) {
    const id = resolveTownEntranceChildId(tree, 'ow', {});
    if (!valid.has(id)) throw new Error(`returned invalid id: ${id}`);
  }
});
test('entrance: open-world with fromHex but town has no matching direction → still random', () => {
  const tree = makeOpenWorldTown();
  // Openville has no hex coords → directional step skipped → falls through
  // to no-primary → random
  const id = resolveTownEntranceChildId(tree, 'ow', { fromHex: { q: 5, r: 5 }, random: () => 0 });
  eq(id, 'gateA');
});

// Section 6: resolveLandingPath settlement cascade
test('landing: Sandpoint from partyHex-south (q=7,r=4) → +southroad', () => {
  const tree = makeTree();
  const resolved = resolveLandingPath(tree, ['world', 'varisia', 'sandpoint'],
    { fromHex: { q: 7, r: 4 } });
  eq(Array.isArray(resolved), true);
  eq(resolved[resolved.length - 1], 'southroad');
});
test('landing: Sandpoint from partyHex-north (q=8,r=-8) → +bridge', () => {
  const tree = makeTree();
  const resolved = resolveLandingPath(tree, ['world', 'varisia', 'sandpoint'],
    { fromHex: { q: 8, r: -8 } });
  eq(resolved[resolved.length - 1], 'bridge');
});
test('landing: bySea stops at docks (no cascade past AREA)', () => {
  const tree = makeTree();
  const resolved = resolveLandingPath(tree, ['world', 'varisia', 'sandpoint'],
    { bySea: true });
  eq(resolved[resolved.length - 1], 'docks');
});
test('landing: Sandpoint no opts → primary (bridge)', () => {
  const tree = makeTree();
  const resolved = resolveLandingPath(tree, ['world', 'varisia', 'sandpoint'], {});
  eq(resolved[resolved.length - 1], 'bridge');
});
test('landing: town without entrances falls through to defaultEntry', () => {
  const tree = makeTownWithoutEntrances();
  const resolved = resolveLandingPath(tree, ['world', 'town'], {});
  eq(resolved[resolved.length - 1], 'square');
});
test('landing: identity equality when no cascade occurred', () => {
  const tree = makeTree();
  const path = ['world', 'varisia', 'sandpoint', 'mainroad'];
  const resolved = resolveLandingPath(tree, path, {});
  eq(resolved === path, true);
});
test('landing: returns new array when cascade occurred', () => {
  const tree = makeTree();
  const path = ['world', 'varisia', 'sandpoint'];
  const resolved = resolveLandingPath(tree, path, { fromHex: { q: 7, r: 4 } });
  eq(resolved !== path, true);
  eq(resolved.length, 4);
});
test('landing: open-world town + no primary + rand=0 → +gateA', () => {
  const tree = makeOpenWorldTown();
  const resolved = resolveLandingPath(tree, ['world', 'ow'], { random: () => 0 });
  eq(resolved[resolved.length - 1], 'gateA');
});

// Section 7: cycle / edge safety
test('landing: empty path → same array', () => {
  const tree = makeTree();
  const path = [];
  const resolved = resolveLandingPath(tree, path, {});
  eq(resolved === path, true);
});
test('landing: null tree → same path', () => {
  const path = ['x'];
  const resolved = resolveLandingPath(null, path, {});
  eq(resolved === path, true);
});
test('landing: non-array path → returns as-is', () => {
  const tree = makeTree();
  const resolved = resolveLandingPath(tree, null, {});
  eq(resolved, null);
});

// Section 8: Sandpoint canonical approach sanity using party-hex string
// partyHex "8,3" = axial (q=8, r=-1) = center of Sandpoint hex itself
test('sanity: partyHex "8,-8" (north of Sandpoint) → bridge', () => {
  const tree = makeTree();
  // partyHex "8,-4" offset → axial: q=8, r=-4 - floor((8+0)/2) = -4-4 = -8
  // That's 7 hexes north of Sandpoint at axial r=-1
  const ax = parsePartyHexToAxial('8,-4');
  const resolved = resolveLandingPath(tree, ['world', 'varisia', 'sandpoint'],
    { fromHex: ax });
  eq(resolved[resolved.length - 1], 'bridge');
});
test('sanity: partyHex "7,8" (south of Sandpoint, near Magnimar) → southroad', () => {
  const tree = makeTree();
  // offset (7,8) → axial: q=7, r=8 - floor((7+1)/2) = 8-4 = 4
  // That matches Magnimar's axial (7, 4) exactly
  const ax = parsePartyHexToAxial('7,8');
  const resolved = resolveLandingPath(tree, ['world', 'varisia', 'sandpoint'],
    { fromHex: ax });
  eq(resolved[resolved.length - 1], 'southroad');
});

console.log('');
console.log(`${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
