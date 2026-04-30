// Task #66 -- Regression tests for setNodeStatus + travel gate.
//
// Canonical test for the #63/#64/#65 arc. Covers:
//   1. single-node mutation + history append
//   2. cascade across active-baseline descendants
//   3. baseline preservation (independently-sealed child survives parent destroy)
//   4. cycle safety (collectDescendants, setNodeStatus, findNodePath)
//   5. unknown-status -> active coercion
//   6. isNodeTraversable truth table
//   7. travel-gate short-circuit (via extracted pure helper findTravelBlocker)
//
// Run: `node nodeStatus.test.mjs` from repo root.
//
// Uses inline-mirror pattern per feedback_sandbox_mount_lag.md -- the test
// vendors the production logic from src/services/worldTree.js byte-for-byte
// rather than importing, because the Linux sandbox bindfs mount has a
// persistent cache that truncates the real module mid-line. If
// setNodeStatus / getNodeStatus / isNodeTraversable / collectDescendants
// semantics change upstream, update this mirror.

const NODE_STATUS = Object.freeze({ ACTIVE: 'active', SEALED: 'sealed', DESTROYED: 'destroyed' });

function getNodeStatus(node) {
  if (!node) return NODE_STATUS.ACTIVE;
  const s = String(node.status || '').toLowerCase();
  if (s === NODE_STATUS.DESTROYED) return NODE_STATUS.DESTROYED;
  if (s === NODE_STATUS.SEALED) return NODE_STATUS.SEALED;
  return NODE_STATUS.ACTIVE;
}
function isNodeTraversable(node) { return getNodeStatus(node) === NODE_STATUS.ACTIVE; }
function uuid() { return 'n-' + Math.random().toString(36).slice(2, 10); }
function makeNode(d) {
  return { id: d.id || uuid(), name: String(d.name || 'X'), kind: String(d.kind || 'area'),
    parentId: d.parentId || null, childrenIds: [], desc: '', history: [], visitCount: 0 };
}
function createTree(d) {
  const r = makeNode({ name: (d && d.name) || 'W', kind: (d && d.kind) || 'world' });
  return { rootId: r.id, nodes: { [r.id]: r } };
}
function createChildNode(tree, parentId, data) {
  const n = makeNode({ name: data.name, kind: data.kind, parentId });
  tree.nodes[n.id] = n;
  tree.nodes[parentId].childrenIds.push(n.id);
  return n;
}
function appendNodeHistory(tree, id, ev) {
  const n = tree && tree.nodes && tree.nodes[id];
  if (!n) return;
  if (!Array.isArray(n.history)) n.history = [];
  n.history.push({ at: ev.at || null, atReal: Date.now(), kind: String(ev.kind || 'note'),
    text: String(ev.text || '').slice(0, 1000), data: ev.data || null });
  if (n.history.length > 500) n.history = n.history.slice(-500);
}
function collectDescendants(tree, id) {
  const out = [];
  const root = tree && tree.nodes && tree.nodes[id];
  if (!root) return out;
  const stack = [...(root.childrenIds || [])];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = tree && tree.nodes && tree.nodes[cur];
    if (!node) continue;
    out.push(cur);
    for (const c of (node.childrenIds || [])) stack.push(c);
  }
  return out;
}
function setNodeStatus(tree, id, status, opts) {
  opts = opts || {};
  const root = tree && tree.nodes && tree.nodes[id];
  if (!root) return [];
  const cascade = opts.cascade !== false;
  const reason = opts.reason || '';
  const at = opts.at || null;
  const normalized = String(status || '').toLowerCase();
  const allowed = [NODE_STATUS.ACTIVE, NODE_STATUS.SEALED, NODE_STATUS.DESTROYED];
  const next = allowed.indexOf(normalized) >= 0 ? normalized : NODE_STATUS.ACTIVE;
  const cascadeBase = getNodeStatus(root);
  const queue = cascade ? [id, ...collectDescendants(tree, id)] : [id];
  const touched = [];
  for (const nodeId of queue) {
    const node = tree.nodes[nodeId];
    if (!node) continue;
    const prev = getNodeStatus(node);
    if (nodeId !== id && cascade && prev !== cascadeBase) continue;
    if (prev === next) continue;
    node.status = next;
    node.statusChangedAt = at || null;
    node.statusReason = reason || null;
    appendNodeHistory(tree, nodeId, {
      at, kind: 'status',
      text: 'Status: ' + prev + ' -> ' + next + (reason ? ' -- ' + reason : ''),
      data: { prev, next, reason, cascadedFrom: nodeId === id ? null : id },
    });
    touched.push(nodeId);
  }
  return touched;
}
function findNodePath(tree, id) {
  if (!tree || !tree.nodes || !tree.nodes[id]) return [];
  const path = [];
  let cur = id;
  const safety = new Set();
  while (cur && tree.nodes[cur]) {
    if (safety.has(cur)) break;
    safety.add(cur);
    path.unshift(cur);
    cur = tree.nodes[cur].parentId;
  }
  return path;
}
// Travel-gate pure helper -- mirrors AdventureTab.jsx::switchToNodePath inline
// block (~line 2547). Returns the first non-traversable node along `path`, or
// null if every node on the path is active. Headless-testable; no side effects.
// If this helper ever moves into a production module, the AdventureTab inline
// block should be replaced with a direct call.
function findTravelBlocker(tree, path) {
  if (!tree || !Array.isArray(path)) return null;
  for (const nodeId of path) {
    const n = tree && tree.nodes && tree.nodes[nodeId];
    if (!n) continue;
    if (!isNodeTraversable(n)) return n;
  }
  return null;
}

// RotRL-canonical fixture: Golarion -> Varisia -> Hinterlands -> Sandpoint ->
// {Cathedral -> Crypt of Wrath -> Altar Chamber, Rusty Dragon}.
function makeFixture() {
  const tree = createTree({ name: 'Golarion', kind: 'world' });
  const worldId = tree.rootId;
  const varisia = createChildNode(tree, worldId, { name: 'Varisia', kind: 'country' });
  const hinter = createChildNode(tree, varisia.id, { name: 'Hinterlands', kind: 'region' });
  const town = createChildNode(tree, hinter.id, { name: 'Sandpoint', kind: 'town' });
  const cath = createChildNode(tree, town.id, { name: 'Cathedral', kind: 'building' });
  const crypt = createChildNode(tree, cath.id, { name: 'Crypt of Wrath', kind: 'floor' });
  const altar = createChildNode(tree, crypt.id, { name: 'Altar Chamber', kind: 'room' });
  const dragon = createChildNode(tree, town.id, { name: 'Rusty Dragon', kind: 'building' });
  return { tree, ids: { world: worldId, varisia: varisia.id, hinter: hinter.id, town: town.id,
    cath: cath.id, crypt: crypt.id, altar: altar.id, dragon: dragon.id } };
}

const tests = [];
function t(n, f) { tests.push({ name: n, fn: f }); }
function assert(c, m) { if (!c) throw new Error('assert: ' + (m || '')); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'eq') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }
function statusAt(tree, id) { return getNodeStatus(tree && tree.nodes && tree.nodes[id]); }

// --- 1. single-node mutation + history ------------------------------------
t('mutate status (cascade=false)', () => {
  const f = makeFixture();
  const touched = setNodeStatus(f.tree, f.ids.cath, 'sealed', { reason: 'warded', at: '2026-04-19T00:00:00Z', cascade: false });
  eq(touched.length, 1);
  eq(statusAt(f.tree, f.ids.cath), 'sealed');
  eq(statusAt(f.tree, f.ids.crypt), 'active');
  eq(f.tree.nodes[f.ids.cath].statusReason, 'warded');
  eq(f.tree.nodes[f.ids.cath].statusChangedAt, '2026-04-19T00:00:00Z');
});
t('history entry with prev/next/reason', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'sealed', { reason: 'warded' });
  const h = f.tree.nodes[f.ids.cath].history;
  const last = h[h.length - 1];
  eq(last.kind, 'status');
  eq(last.data.prev, 'active');
  eq(last.data.next, 'sealed');
  eq(last.data.reason, 'warded');
  eq(last.data.cascadedFrom, null);
  assert(last.text.indexOf('warded') >= 0);
});
t('no-op on prev===next (no history spam)', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'sealed', { cascade: false });
  const before = f.tree.nodes[f.ids.cath].history.length;
  const touched = setNodeStatus(f.tree, f.ids.cath, 'sealed', { cascade: false });
  eq(touched.length, 0);
  eq(f.tree.nodes[f.ids.cath].history.length, before);
});
t('unknown node id returns []', () => {
  const f = makeFixture();
  eq(setNodeStatus(f.tree, 'nope', 'sealed', {}).length, 0);
});

// --- 2. cascade across active-baseline descendants ------------------------
t('destroy cascades to all active descendants', () => {
  const f = makeFixture();
  const touched = setNodeStatus(f.tree, f.ids.cath, 'destroyed', { reason: 'fire', cascade: true });
  eq(statusAt(f.tree, f.ids.cath), 'destroyed');
  eq(statusAt(f.tree, f.ids.crypt), 'destroyed');
  eq(statusAt(f.tree, f.ids.altar), 'destroyed');
  eq(touched.length, 3);
});
t('cascade stays in subtree (sibling unaffected)', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: true });
  eq(statusAt(f.tree, f.ids.dragon), 'active');
  eq(statusAt(f.tree, f.ids.town), 'active');
});
t('descendant history records cascadedFrom=root', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { reason: 'fire', cascade: true });
  const h = f.tree.nodes[f.ids.crypt].history;
  eq(h[h.length - 1].data.cascadedFrom, f.ids.cath);
});
t('cascade=false leaves descendants alone', () => {
  const f = makeFixture();
  const touched = setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: false });
  eq(touched.length, 1);
  eq(statusAt(f.tree, f.ids.crypt), 'active');
});

// --- 3. baseline preservation ---------------------------------------------
t('independently-sealed crypt survives parent destroy cascade', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.crypt, 'sealed', { cascade: false });
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: true });
  eq(statusAt(f.tree, f.ids.cath), 'destroyed');
  eq(statusAt(f.tree, f.ids.crypt), 'sealed');
  // Altar was active at the time of destroy -- cathedral's baseline is active,
  // collectDescendants walks it regardless of intermediate crypt status, so
  // altar flips to destroyed.
  eq(statusAt(f.tree, f.ids.altar), 'destroyed');
});
t('restore only un-destroys matching-baseline descendants', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: true });
  setNodeStatus(f.tree, f.ids.crypt, 'sealed', { cascade: true });
  eq(statusAt(f.tree, f.ids.crypt), 'sealed');
  eq(statusAt(f.tree, f.ids.altar), 'sealed');
  // Cathedral baseline = destroyed; crypt + altar are sealed (mismatch), so
  // restoring the cathedral leaves the sealed subtree alone.
  const touched = setNodeStatus(f.tree, f.ids.cath, 'active', { cascade: true });
  eq(touched.length, 1);
  eq(statusAt(f.tree, f.ids.cath), 'active');
  eq(statusAt(f.tree, f.ids.crypt), 'sealed');
  eq(statusAt(f.tree, f.ids.altar), 'sealed');
});

// --- 4. cycle safety ------------------------------------------------------
t('collectDescendants terminates on cycle', () => {
  const f = makeFixture();
  f.tree.nodes[f.ids.altar].childrenIds = [f.ids.crypt];
  const descs = collectDescendants(f.tree, f.ids.cath);
  assert(descs.indexOf(f.ids.crypt) >= 0);
  assert(descs.indexOf(f.ids.altar) >= 0);
  const seen = new Set();
  for (const id of descs) { assert(!seen.has(id)); seen.add(id); }
});
t('setNodeStatus over cyclic subtree terminates', () => {
  const f = makeFixture();
  f.tree.nodes[f.ids.altar].childrenIds = [f.ids.crypt];
  const touched = setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: true });
  assert(touched.length >= 1);
  eq(statusAt(f.tree, f.ids.cath), 'destroyed');
  eq(statusAt(f.tree, f.ids.altar), 'destroyed');
});
t('findNodePath terminates on parent cycle', () => {
  const f = makeFixture();
  f.tree.nodes[f.ids.world].parentId = f.ids.altar;
  const p = findNodePath(f.tree, f.ids.altar);
  assert(Array.isArray(p));
  assert(p.length > 0);
});

// --- 5. unknown-status -> active coercion ---------------------------------
t('unknown status coerces to active', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'sealed', { cascade: false });
  const touched = setNodeStatus(f.tree, f.ids.cath, 'flooded', { cascade: false });
  eq(touched.length, 1);
  eq(statusAt(f.tree, f.ids.cath), 'active');
});
t('undefined status coerces to active', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: false });
  setNodeStatus(f.tree, f.ids.cath, undefined, { cascade: false });
  eq(statusAt(f.tree, f.ids.cath), 'active');
});
t('uppercase normalizes', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'DESTROYED', { cascade: false });
  eq(statusAt(f.tree, f.ids.cath), 'destroyed');
});

// --- 6. isNodeTraversable truth table -------------------------------------
t('isNodeTraversable active -> true', () => { eq(isNodeTraversable({ status: 'active' }), true); });
t('isNodeTraversable {} -> true', () => { eq(isNodeTraversable({}), true); });
t('isNodeTraversable sealed -> false', () => { eq(isNodeTraversable({ status: 'sealed' }), false); });
t('isNodeTraversable destroyed -> false', () => { eq(isNodeTraversable({ status: 'destroyed' }), false); });
t('isNodeTraversable mixed-case correctly classified', () => {
  eq(isNodeTraversable({ status: 'DESTROYED' }), false);
  eq(isNodeTraversable({ status: 'Sealed' }), false);
  eq(isNodeTraversable({ status: 'ACTIVE' }), true);
});
t('isNodeTraversable null -> true (permissive)', () => { eq(isNodeTraversable(null), true); });
t('isNodeTraversable garbage status -> true', () => {
  eq(isNodeTraversable({ status: 'flooded' }), true);
  eq(isNodeTraversable({ status: '' }), true);
});

// --- 7. travel-gate short-circuit -----------------------------------------
t('gate: all-active path -> null', () => {
  const f = makeFixture();
  const path = findNodePath(f.tree, f.ids.altar);
  eq(path.length, 7); // world -> varisia -> hinter -> town -> cath -> crypt -> altar
  eq(findTravelBlocker(f.tree, path), null);
});
t('gate: destroyed intermediate blocks', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: false });
  const blocker = findTravelBlocker(f.tree, findNodePath(f.tree, f.ids.altar));
  assert(blocker);
  eq(blocker.id, f.ids.cath);
});
t('gate: sealed final node blocks', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.dragon, 'sealed', { cascade: false });
  const blocker = findTravelBlocker(f.tree, findNodePath(f.tree, f.ids.dragon));
  assert(blocker);
  eq(blocker.id, f.ids.dragon);
});
t('gate: first-blocker-wins when multiple on path', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.hinter, 'sealed', { cascade: false });
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: false });
  const blocker = findTravelBlocker(f.tree, findNodePath(f.tree, f.ids.altar));
  eq(blocker.id, f.ids.hinter);
});
t('gate: empty/invalid path -> null', () => {
  const f = makeFixture();
  eq(findTravelBlocker(f.tree, []), null);
  eq(findTravelBlocker(f.tree, null), null);
  eq(findTravelBlocker(null, ['x']), null);
});
t('gate: missing node id in path is skipped', () => {
  const f = makeFixture();
  const path = [...findNodePath(f.tree, f.ids.altar), 'deleted-id'];
  eq(findTravelBlocker(f.tree, path), null);
});
t('gate: sibling reachable after sibling-destroy', () => {
  const f = makeFixture();
  setNodeStatus(f.tree, f.ids.cath, 'destroyed', { cascade: true });
  eq(findTravelBlocker(f.tree, findNodePath(f.tree, f.ids.dragon)), null);
  const b = findTravelBlocker(f.tree, findNodePath(f.tree, f.ids.altar));
  assert(b);
  eq(b.id, f.ids.cath);
});

let p = 0, fl = 0;
for (const ts of tests) {
  try { ts.fn(); console.log('  PASS  ' + ts.name); p += 1; }
  catch (e) { console.log('  FAIL  ' + ts.name + ': ' + e.message); fl += 1; }
}
console.log('');
console.log(p + '/' + tests.length + ' passed');
if (fl > 0) process.exit(1);
