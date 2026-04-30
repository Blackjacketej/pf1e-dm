/**
 * Inline-mirror tests for the sidecar-startPath preference logic at
 * src/components/AdventureTab.jsx:2381-2419 (the sidecar useEffect).
 *
 * The sidecar honors campaign.data.startPath ahead of the standard
 * resolveLandingPath cascade, but ONLY merges the party to it when curPath
 * is either a strict prefix of the resolved startPath (pre-#39 saves parked
 * at the town node) or a sibling-of-tail under the same parent (a previous
 * run routed to the wrong sub-location via the primary-entrance fallback).
 * A meaningfully diverged path is left alone — we never revert movement.
 *
 * Run:  node sidecarStartPath.test.mjs
 *
 * This file mirrors (not imports) the preference branch so it stays
 * headless-testable without a React render. If the logic in AdventureTab
 * drifts, update the mirror here and the assertions below in lock-step.
 */

// ---------- Inline mirror of the sidecar preference branch ----------
// Verbatim shape of samePath + the preference logic extracted from
// AdventureTab.jsx. resolveNamedPath is inlined (see below) so the test
// does not pull the component's import graph.

function samePath(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Mirror of src/services/worldTreeMigration.js::resolveNamedPath.
 * Resolves an ordered list of node names (root-leafward) to an array of
 * node ids. The root name may or may not appear as names[0] — both are
 * accepted. Returns null if any name fails to match a child.
 */
function resolveNamedPath(tree, names) {
  if (!tree || !Array.isArray(names) || names.length === 0) return null;
  if (!tree.rootId || !tree.nodes || !tree.nodes[tree.rootId]) return null;
  const root = tree.nodes[tree.rootId];
  const firstName = String(names[0] || '').toLowerCase();
  const rootName = String(root.name || '').toLowerCase();
  const path = [root.id];
  let idx = firstName === rootName ? 1 : 0;
  let current = root;
  for (; idx < names.length; idx += 1) {
    const target = String(names[idx] || '').toLowerCase();
    const childIds = Array.isArray(current.childrenIds) ? current.childrenIds : [];
    const match = childIds
      .map(cid => tree.nodes[cid])
      .find(n => n && String(n.name || '').toLowerCase() === target);
    if (!match) return null;
    path.push(match.id);
    current = match;
  }
  return path;
}

/**
 * Mirror of the sidecar preference branch. Given the world-tree, the
 * party's current path, and the campaign's startPath names, returns:
 *   { action: 'set', path }  when the party should be moved to the resolved startPath
 *   { action: 'noop' }       when the preference branch opts out (diverged path, already there, unresolvable, etc.)
 *
 * A return of 'noop' does NOT mean the sidecar is done — in the real
 * component, the fallback resolveLandingPath cascade runs next. This
 * mirror isolates the PREFERENCE branch only, since that's the slice
 * #39 follow-up shipped.
 */
function preferStartPath({ tree, curPath, startNames }) {
  if (!Array.isArray(startNames) || startNames.length === 0) return { action: 'noop', reason: 'no-startNames' };
  const resolvedStartPath = resolveNamedPath(tree, startNames);
  if (!resolvedStartPath || resolvedStartPath.length === 0) return { action: 'noop', reason: 'unresolvable' };

  const isPrefix = curPath.length <= resolvedStartPath.length
    && curPath.every((id, i) => id === resolvedStartPath[i]);

  let isSibling = false;
  if (!isPrefix
      && curPath.length === resolvedStartPath.length
      && curPath.length >= 2) {
    const parentA = curPath[curPath.length - 2];
    const parentB = resolvedStartPath[resolvedStartPath.length - 2];
    isSibling = parentA === parentB;
  }

  if (!(isPrefix || isSibling)) return { action: 'noop', reason: 'diverged' };
  if (samePath(resolvedStartPath, curPath)) return { action: 'noop', reason: 'already-there' };
  return { action: 'set', path: resolvedStartPath };
}

// ---------- Test scaffolding ----------

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { passed += 1; return; }
  failed += 1;
  failures.push(label);
}

function assertDeepEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed += 1; return; }
  failed += 1;
  failures.push(`${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}

// ---------- Fixtures ----------
//
// A tiny RotRL-like tree:
//   Golarion (root)
//     Varisia
//       Sandpoint Hinterlands
//         Sandpoint
//           Cathedral Square    <- canonical RotRL opener
//           Turandarok Bridge   <- primary-entrance fallback sibling
//           Main Road
//
// ids are opaque strings so the test can assert on path identity without
// relying on ordering or auto-generated suffixes.

function buildTree() {
  return {
    rootId: 'g',
    nodes: {
      g: { id: 'g', name: 'Golarion', childrenIds: ['v'] },
      v: { id: 'v', name: 'Varisia', childrenIds: ['h'] },
      h: { id: 'h', name: 'Sandpoint Hinterlands', childrenIds: ['s'] },
      s: { id: 's', name: 'Sandpoint', childrenIds: ['cs', 'tb', 'mr'] },
      cs: { id: 'cs', name: 'Cathedral Square', childrenIds: [] },
      tb: { id: 'tb', name: 'Turandarok Bridge', childrenIds: [] },
      mr: { id: 'mr', name: 'Main Road', childrenIds: [] },
    },
  };
}

const ROTR_START_NAMES = ['Golarion', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Cathedral Square'];
const RESOLVED_START = ['g', 'v', 'h', 's', 'cs'];

// ---------- Case (a) — strict-prefix extension ----------
// Pre-#39 save: migration ran before startPath support existed, so the
// party is parked at [...,Sandpoint] and should be extended to
// [...,Sandpoint,Cathedral Square].
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'set', 'case-a: strict-prefix returns set action');
  assertDeepEqual(result.path, RESOLVED_START, 'case-a: extends prefix to full startPath');
}

// Also valid: curPath is the bare root (length 1) — still a strict prefix.
{
  const tree = buildTree();
  const curPath = ['g'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'set', 'case-a: bare-root prefix returns set action');
  assertDeepEqual(result.path, RESOLVED_START, 'case-a: bare-root extends to full startPath');
}

// ---------- Case (b) — sibling-of-tail override ----------
// A previous sidecar pass routed the party to Turandarok Bridge via the
// primary-entrance fallback. Same length + shared parent + divergent tail:
// override to Cathedral Square.
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's', 'tb'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'set', 'case-b: sibling-of-tail returns set action');
  assertDeepEqual(result.path, RESOLVED_START, 'case-b: sibling override lands on Cathedral Square');
}

// Main Road is also a sibling under Sandpoint — same override applies.
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's', 'mr'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'set', 'case-b: Main Road sibling returns set action');
  assertDeepEqual(result.path, RESOLVED_START, 'case-b: Main Road override lands on Cathedral Square');
}

// ---------- Case (c) — diverged path left alone ----------
// Party has meaningfully traveled elsewhere (different ancestor chain, or
// same length but different parent). The sidecar MUST NOT yank them back.

// (c1) Shorter path but not a prefix — different branch entirely.
{
  const tree = buildTree();
  // Insert a foreign branch: Golarion -> Cheliax (wholly outside Sandpoint).
  tree.nodes.ch = { id: 'ch', name: 'Cheliax', childrenIds: [] };
  tree.nodes.g.childrenIds = ['v', 'ch'];
  const curPath = ['g', 'ch'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'noop', 'case-c1: diverged shorter-branch path is a noop');
  assert(result.reason === 'diverged', 'case-c1: noop reason is diverged (not a prefix)');
}

// (c2) Same length, different parent — NOT a sibling of Cathedral Square.
{
  const tree = buildTree();
  // Add a second town with its own child so the divergent path has
  // equal depth but a different parent chain.
  tree.nodes.m = { id: 'm', name: 'Magnimar', childrenIds: ['docks'] };
  tree.nodes.docks = { id: 'docks', name: 'Dockway', childrenIds: [] };
  tree.nodes.h.childrenIds = ['s', 'm'];
  const curPath = ['g', 'v', 'h', 'm', 'docks'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'noop', 'case-c2: same-length-different-parent is a noop');
  assert(result.reason === 'diverged', 'case-c2: noop reason is diverged');
}

// (c3) Longer than startPath — party has drilled past the opener. Leave alone.
{
  const tree = buildTree();
  // Extend Cathedral Square with a child so the party can be "deeper" than it.
  tree.nodes.cs.childrenIds = ['altar'];
  tree.nodes.altar = { id: 'altar', name: 'Altar', childrenIds: [] };
  const curPath = ['g', 'v', 'h', 's', 'cs', 'altar'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'noop', 'case-c3: deeper-than-startPath is a noop');
  assert(result.reason === 'diverged', 'case-c3: noop reason is diverged');
}

// ---------- Case (d) — already at target ----------
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's', 'cs'];
  const result = preferStartPath({ tree, curPath, startNames: ROTR_START_NAMES });
  assert(result.action === 'noop', 'case-d: already-at-target is a noop');
  assert(result.reason === 'already-there', 'case-d: noop reason is already-there');
}

// ---------- Case (e) — missing / empty startPath ----------
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's'];
  const r1 = preferStartPath({ tree, curPath, startNames: null });
  assert(r1.action === 'noop' && r1.reason === 'no-startNames', 'case-e: null startNames is a noop');

  const r2 = preferStartPath({ tree, curPath, startNames: [] });
  assert(r2.action === 'noop' && r2.reason === 'no-startNames', 'case-e: empty startNames is a noop');

  const r3 = preferStartPath({ tree, curPath, startNames: undefined });
  assert(r3.action === 'noop' && r3.reason === 'no-startNames', 'case-e: undefined startNames is a noop');
}

// ---------- Case (f) — unresolvable startPath ----------
// Name not in tree (typo or pre-seed campaign data). Preference branch
// opts out cleanly; the real component falls through to resolveLandingPath.
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's'];
  const bogus = ['Golarion', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Flarble Square'];
  const result = preferStartPath({ tree, curPath, startNames: bogus });
  assert(result.action === 'noop', 'case-f: unresolvable startPath is a noop');
  assert(result.reason === 'unresolvable', 'case-f: noop reason is unresolvable');
}

// Wrong branch at any depth also unresolvable.
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's'];
  const wrongBranch = ['Golarion', 'Cheliax', 'Egorian', 'Central Square'];
  const result = preferStartPath({ tree, curPath, startNames: wrongBranch });
  assert(result.action === 'noop', 'case-f: wrong-branch startPath is a noop');
  assert(result.reason === 'unresolvable', 'case-f: wrong-branch noop reason is unresolvable');
}

// ---------- Case (g) — startPath WITHOUT root prefix is also valid ----------
// resolveNamedPath accepts names starting at root OR starting at the first
// child. Confirm the sidecar works when campaign data omits the root name.
{
  const tree = buildTree();
  const curPath = ['g', 'v', 'h', 's'];
  const rootlessNames = ['Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Cathedral Square'];
  const result = preferStartPath({ tree, curPath, startNames: rootlessNames });
  assert(result.action === 'set', 'case-g: rootless startNames resolves');
  assertDeepEqual(result.path, RESOLVED_START, 'case-g: rootless extends to full startPath');
}

// ---------- Report ----------
if (failed > 0) {
  console.log(`FAIL: ${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log(`PASS: ${passed}/${passed} assertions`);
}
