/**
 * worldTree.js — Nested location model.
 *
 * Each campaign carries a world tree:
 *   - Tree nodes represent places (world, country, region, town, building, floor,
 *     room, wilderness, dungeon, etc.) with their own map, NPC roster, area items,
 *     and visit/tick metadata.
 *   - The tree replaces the flat `adventure.subLocations` shape shipped in #37.
 *   - Unlimited depth: Golarion → Varisia → Sandpoint Hinterlands → Sandpoint →
 *     Rusty Dragon Inn → 2nd Floor → Their Room is a valid path.
 *
 * Party position lives on the party record (so multiple parties can eventually
 * occupy different nodes during party-splits):
 *   adventure.parties = { [partyId]: { id, name, memberIds[], currentPath[] } }
 *   adventure.activeParty = 'main'
 *
 * The tree itself is a flat id-keyed index navigated via parentId / childrenIds:
 *   adventure.worldTree = { rootId, nodes: { [id]: node } }
 *
 * See project_world_tree memory and claude-resolutions #39 (world-tree refactor)
 * for the full design rationale (maps auto+override, tree-native travel,
 * per-campaign root, parties stub for party-split).
 */

// ───────────────────────────────────────────────────────────── constants

/** Supported node kinds — drives default map generator + breadcrumb icons. */
export const NODE_KINDS = Object.freeze({
  WORLD: 'world',
  PLANE: 'plane',
  CONTINENT: 'continent',
  COUNTRY: 'country',
  REGION: 'region',
  TOWN: 'town',
  CITY: 'city',
  VILLAGE: 'village',
  WILDERNESS: 'wilderness',
  DUNGEON: 'dungeon',
  BUILDING: 'building',
  FLOOR: 'floor',
  ROOM: 'room',
  AREA: 'area',
  LANDMARK: 'landmark',
});

/** Default icon per kind (used by breadcrumb + travel picker). */
export const KIND_ICON = Object.freeze({
  world: '🌍',
  plane: '✨',
  continent: '🗺️',
  country: '🏴',
  region: '⛰️',
  town: '🏘️',
  city: '🏙️',
  village: '🛖',
  wilderness: '🌲',
  dungeon: '🕳️',
  building: '🏛️',
  floor: '🪜',
  room: '🚪',
  area: '📍',
  landmark: '🗿',
});

/** The reserved default party id. */
export const DEFAULT_PARTY_ID = 'main';

// ───────────────────────────────────────────────────────────── status
// Task #63 (2026-04-18) — narrative destruction of world-tree nodes.
// Operator rule: soft-mark, keep in tree. History + map position
// preserved; reversible via narrative or GM restore. Children cascade
// by default (a building burned to foundations also destroys its
// rooms), but the cascade is reversible when the parent is restored.
//
//   active    — normal, enterable
//   sealed    — blocked but reopenable (cave-in the party could dig out,
//               a door bolted from inside, a warded passage); UI shows
//               a [sealed] tag, travel is blocked until the narrative
//               or GM clears it.
//   destroyed — permanent in-fiction; burnt down, collapsed, leveled.
//               Travel blocked, strikethrough in UI. Still reversible
//               at the data layer (nothing is deleted) — but narratively
//               restoring a destroyed place should be rare.
export const NODE_STATUS = Object.freeze({
  ACTIVE: 'active',
  SEALED: 'sealed',
  DESTROYED: 'destroyed',
});

export function getNodeStatus(node) {
  if (!node) return NODE_STATUS.ACTIVE;
  const s = String(node.status || '').toLowerCase();
  if (s === NODE_STATUS.DESTROYED) return NODE_STATUS.DESTROYED;
  if (s === NODE_STATUS.SEALED) return NODE_STATUS.SEALED;
  return NODE_STATUS.ACTIVE;
}

/** True when the party can currently enter this node. */
export function isNodeTraversable(node) {
  return getNodeStatus(node) === NODE_STATUS.ACTIVE;
}

/**
 * Task #91 — travel-gate helper. Walk a resolved path array (node ids, root
 * → leaf) and return the first non-traversable node found, or null if the
 * whole path is clear. Used by AdventureTab.switchToNodePath to refuse
 * travel through destroyed/sealed nodes. Missing/null entries are treated
 * as permissive (matching isNodeTraversable's default).
 *
 * Pure function — no side effects, safe to call from headless tests.
 */
export function findTravelBlocker(tree, path) {
  if (!tree || !Array.isArray(path)) return null;
  for (const nodeId of path) {
    const n = tree && tree.nodes && tree.nodes[nodeId];
    if (!n) continue;
    if (!isNodeTraversable(n)) return n;
  }
  return null;
}

// ───────────────────────────────────────────────────────────── id utility

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ───────────────────────────────────────────────────────────── worldState helpers

/**
 * Snapshot a worldState for visit/tick metadata. We store only the coarse date
 * fields (no objects that might drift). Returns null if input is empty.
 */
export function snapshotWorldTime(worldState) {
  if (!worldState || typeof worldState !== 'object') return null;
  const s = {
    year: Number.isFinite(worldState.currentYear) ? worldState.currentYear : null,
    month: Number.isFinite(worldState.currentMonth) ? worldState.currentMonth : null,
    day: Number.isFinite(worldState.currentDay) ? worldState.currentDay : null,
    hour: Number.isFinite(worldState.currentHour) ? worldState.currentHour : null,
    minute: Number.isFinite(worldState.currentMinute) ? worldState.currentMinute : null,
    at: Date.now(),
  };
  if (s.year == null && s.month == null && s.day == null) return null;
  return s;
}

/** Convert a worldTime snapshot into absolute hours (for L3 tick delta math). */
export function worldTimeToAbsoluteHours(snap) {
  if (!snap) return null;
  const y = Number.isFinite(snap.year) ? snap.year : 0;
  const m = Number.isFinite(snap.month) ? snap.month : 0;
  const d = Number.isFinite(snap.day) ? snap.day : 1;
  const h = Number.isFinite(snap.hour) ? snap.hour : 0;
  const min = Number.isFinite(snap.minute) ? snap.minute : 0;
  // Approximate: 12 months × 30 days × 24 hours per year.
  // Good enough for tick math; exact calendar math lives in calendar.js.
  const days = y * 360 + m * 30 + (d - 1);
  return days * 24 + h + min / 60;
}

/** Hours elapsed between two worldTime snapshots. Negative → clamped to 0. */
export function hoursBetween(fromSnap, toSnap) {
  const a = worldTimeToAbsoluteHours(fromSnap);
  const b = worldTimeToAbsoluteHours(toSnap);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a);
}

// ───────────────────────────────────────────────────────────── tree construction

/**
 * Create a fresh node. Call via createChildNode or seedTree — do not use
 * directly unless building a root.
 */
function makeNode({ id, name, kind, parentId, desc, extras } = {}) {
  return {
    id: id || uuid(),
    name: String(name || 'Unnamed'),
    kind: String(kind || NODE_KINDS.AREA),
    parentId: parentId || null,
    childrenIds: [],
    desc: String(desc || ''),
    map: null,            // { id, src, kind } override — null means auto
    npcs: [],
    items: [],
    combat: null,

    // L2 visit history
    createdAt: Date.now(),
    firstVisitedAt: null, // worldTime snapshot
    lastVisitedAt: null,
    visitCount: 0,
    history: [],          // [{ at: worldTime, kind, text, data }]

    // L3 living-world metadata
    lastTickedAt: null,   // worldTime snapshot
    restock: null,        // { intervalHours, lastRestockAt, kind }
    weather: null,        // region only: { current, changedAt }
    npcScheduleHints: null, // optional

    ...(extras || {}),
  };
}

/**
 * Create a brand-new empty tree with a single root node.
 * @param {Object} rootData — { name, kind, desc }.
 */
export function createTree(rootData = {}) {
  const root = makeNode({
    name: rootData.name || 'World',
    kind: rootData.kind || NODE_KINDS.WORLD,
    desc: rootData.desc || '',
    parentId: null,
  });
  return {
    rootId: root.id,
    nodes: { [root.id]: root },
  };
}

/**
 * Add a child node under parentId. Returns the new node. Mutates the tree in
 * place — caller is responsible for persisting adventure state afterwards.
 */
export function createChildNode(tree, parentId, data = {}) {
  if (!tree || !tree.nodes || !tree.nodes[parentId]) {
    throw new Error(`createChildNode: parent ${parentId} not found`);
  }
  const node = makeNode({
    name: data.name,
    kind: data.kind,
    desc: data.desc,
    parentId,
    extras: data.extras,
  });
  tree.nodes[node.id] = node;
  tree.nodes[parentId].childrenIds.push(node.id);
  return node;
}

/**
 * Remove a node and all its descendants. Returns the list of removed ids.
 * Refuses to remove the root.
 */
export function removeNode(tree, id) {
  if (!tree || !tree.nodes || !tree.nodes[id]) return [];
  if (id === tree.rootId) {
    throw new Error('removeNode: cannot remove root');
  }
  const removed = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const n = tree.nodes[cur];
    if (!n) continue;
    removed.push(cur);
    for (const childId of (n.childrenIds || [])) stack.push(childId);
  }
  const parent = tree.nodes[tree.nodes[id].parentId];
  if (parent) {
    parent.childrenIds = parent.childrenIds.filter(c => c !== id);
  }
  for (const rid of removed) delete tree.nodes[rid];
  return removed;
}

export function renameNode(tree, id, name) {
  const n = tree?.nodes?.[id];
  if (!n) return;
  n.name = String(name || n.name);
}

/**
 * Collect all descendant ids of `id` (not including `id` itself) in DFS
 * order. Used by setNodeStatus cascade and by future "burn-down" effect
 * handlers. Cycle-safe via seen-set.
 */
function collectDescendants(tree, id) {
  const out = [];
  const root = tree?.nodes?.[id];
  if (!root) return out;
  const stack = [...(root.childrenIds || [])];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = tree?.nodes?.[cur];
    if (!node) continue;
    out.push(cur);
    for (const c of (node.childrenIds || [])) stack.push(c);
  }
  return out;
}

/**
 * Task #63 — set a node's status (active/sealed/destroyed) with cascade.
 *
 * Mutates in place. Returns the array of node ids whose status was
 * actually changed (so the caller can decide whether to re-persist or
 * fire a journal entry).
 *
 * `cascade` default true: descendants inherit the same status. A
 * burned-down building takes its interior rooms with it. When the GM
 * or narrative flips the root back to 'active', the cascade also
 * reverts (only descendants whose current status *equals* the root's
 * prior cascaded status are reverted — preserves a room that was
 * independently marked destroyed earlier).
 *
 * A 'status' entry is appended to node.history with { prev, next,
 * reason } so the adventurer's journal (and any future replay) can
 * reconstruct what happened.
 */
export function setNodeStatus(tree, id, status, opts = {}) {
  const root = tree?.nodes?.[id];
  if (!root) return [];
  const { cascade = true, reason = '', at = null } = opts;

  const normalized = String(status || '').toLowerCase();
  const next = [NODE_STATUS.ACTIVE, NODE_STATUS.SEALED, NODE_STATUS.DESTROYED].includes(normalized)
    ? normalized
    : NODE_STATUS.ACTIVE;

  // Capture the cascade baseline — only descendants whose status matches
  // the root's prior status get reverted when restoring. Avoids clobbering
  // rooms that were independently marked destroyed before the parent was.
  const cascadeBase = getNodeStatus(root);

  const queue = cascade ? [id, ...collectDescendants(tree, id)] : [id];
  const touched = [];
  for (const nodeId of queue) {
    const node = tree.nodes[nodeId];
    if (!node) continue;
    const prev = getNodeStatus(node);
    // For the root we always apply. For descendants during a cascade
    // we only apply if they currently match the baseline — otherwise
    // their independent status would get overwritten.
    if (nodeId !== id && cascade && prev !== cascadeBase) continue;
    if (prev === next) continue;
    node.status = next;
    node.statusChangedAt = at || null;
    node.statusReason = reason || null;
    appendNodeHistory(tree, nodeId, {
      at,
      kind: 'status',
      text: `Status: ${prev} → ${next}${reason ? ' — ' + reason : ''}`,
      data: { prev, next, reason, cascadedFrom: nodeId === id ? null : id },
    });
    touched.push(nodeId);
  }
  return touched;
}

// ───────────────────────────────────────────────────────────── lookups

export function getNode(tree, id) {
  return tree?.nodes?.[id] || null;
}

/** Walk the full ancestry id array from root down to id (inclusive). */
export function findNodePath(tree, id) {
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

/** Walk a path array of ids, returning the final node (or null on mismatch). */
export function getNodeByPath(tree, path) {
  if (!tree || !Array.isArray(path) || path.length === 0) return null;
  for (const id of path) {
    if (!tree.nodes?.[id]) return null;
  }
  return tree.nodes[path[path.length - 1]] || null;
}

export function getBreadcrumb(tree, path) {
  if (!Array.isArray(path)) return [];
  return path
    .map(id => tree?.nodes?.[id])
    .filter(Boolean);
}

export function getChildren(tree, id) {
  const n = tree?.nodes?.[id];
  if (!n) return [];
  return (n.childrenIds || [])
    .map(cid => tree.nodes[cid])
    .filter(Boolean);
}

export function getSiblings(tree, id) {
  const n = tree?.nodes?.[id];
  if (!n || !n.parentId) return [];
  const parent = tree.nodes[n.parentId];
  if (!parent) return [];
  return (parent.childrenIds || [])
    .filter(cid => cid !== id)
    .map(cid => tree.nodes[cid])
    .filter(Boolean);
}

export function getAncestors(tree, id) {
  const path = findNodePath(tree, id);
  if (path.length === 0) return [];
  return path.slice(0, -1).map(pid => tree.nodes[pid]).filter(Boolean);
}

/** All nodes visited at least once — used by travel picker fast-list. */
export function getVisitedNodes(tree) {
  if (!tree?.nodes) return [];
  return Object.values(tree.nodes).filter(n => (n?.visitCount || 0) > 0);
}

/**
 * Bug #69 (2026-04-18) — unified "has the party discovered this node?" rule.
 * The journal's World tree and the Locations tab should both gate against
 * the same definition, so neither leaks unvisited content that the party
 * has no reason to know exists.
 *
 * A node is considered discovered if ANY of:
 *   (a) it has been visited directly (visitCount > 0)
 *   (b) it is on the currently-active party path (includeCurrentPath arg)
 *   (c) one of its descendants has been visited — i.e. the party necessarily
 *       traveled through it to reach something deeper (transitive)
 *   (d) it has a recorded first-mention (firstMentionedAt, reserved for a
 *       future scene-extractor hookup that will flip it when narrative
 *       name-drops a location the party hasn't yet walked into)
 *
 * Computed rather than stored so existing saves don't need migration — the
 * discovery state is derived from visitCount + path + descendants on every
 * read. For large trees this is O(descendants); callers that render many
 * rows should memoize at the list level, not per-row.
 *
 * @param {object} tree            world tree { rootId, nodes }
 * @param {string} nodeId          node to check
 * @param {object} [opts]
 * @param {string[]} [opts.currentPath]    active party path (optional)
 * @param {Set<string>} [opts.visitedDescendantIds]  precomputed set (fast path)
 */
export function isNodeDiscovered(tree, nodeId, opts = {}) {
  const node = tree?.nodes?.[nodeId];
  if (!node) return false;
  if ((node.visitCount || 0) > 0) return true;
  if (node.firstMentionedAt) return true;
  if (Array.isArray(opts.currentPath) && opts.currentPath.includes(nodeId)) return true;
  // Fast path: caller handed us a precomputed set of "ancestors-of-visited" ids.
  if (opts.visitedDescendantIds && opts.visitedDescendantIds.has(nodeId)) return true;
  // Slow path: scan descendants. Only used for one-off checks; list render
  // paths should precompute visitedDescendantIds via
  // `computeVisitedAncestorIds(tree)` below.
  const queue = Array.isArray(node.childrenIds) ? [...node.childrenIds] : [];
  const safety = new Set();
  while (queue.length) {
    const cid = queue.shift();
    if (safety.has(cid)) continue;
    safety.add(cid);
    const c = tree.nodes[cid];
    if (!c) continue;
    if ((c.visitCount || 0) > 0) return true;
    if (Array.isArray(c.childrenIds)) queue.push(...c.childrenIds);
  }
  return false;
}

/**
 * Precompute the set of node ids whose subtree contains at least one visited
 * node. Used by WorldTreeSection to filter large trees in O(N) instead of
 * O(N * D) when calling isNodeDiscovered per-row.
 */
export function computeVisitedAncestorIds(tree) {
  const out = new Set();
  if (!tree?.nodes) return out;
  for (const node of Object.values(tree.nodes)) {
    if (!node || (node.visitCount || 0) === 0) continue;
    // Walk up via parentId chain — cheaper than running a DFS from every root.
    let cur = node.parentId ? tree.nodes[node.parentId] : null;
    while (cur) {
      if (out.has(cur.id)) break;   // chain already marked
      out.add(cur.id);
      cur = cur.parentId ? tree.nodes[cur.parentId] : null;
    }
  }
  return out;
}

/** Find first node by exact name match (case-insensitive). Null if none. */
export function findNodeByName(tree, name) {
  if (!tree?.nodes || !name) return null;
  const target = String(name).trim().toLowerCase();
  return Object.values(tree.nodes).find(n => (n?.name || '').trim().toLowerCase() === target) || null;
}

// ───────────────────────────────────────────────────────────── #49 landing

/**
 * Container-tier node kinds. These are geographic/organizational wrappers
 * that the party should never rest AT — they're routing abstractions over
 * a collection of real locations. Landing at any of these forces a
 * cascade down via defaultEntry (or first-child fallback) until a valid
 * leaf kind is reached. Enforced by `resolveLandingPath` + the travel UI
 * guards in AdventureTab.
 *
 * TOWN / CITY / VILLAGE are deliberately NOT in this list — they DO have
 * defaultEntry cascade (see getDefaultEntryChildId), but a user may
 * briefly traverse them as they ascend/descend. Containers above that
 * (region, country, continent, world, plane) are never valid landings.
 *
 * Bug #37 (2026-04-17) — added to block breadcrumb-click teleport to
 * Golarion / Avistan / Varisia from the live session report. Backstop
 * for the UI guards: even if some other caller passes a container tail
 * into switchToNodePath, this cascade bounces the party down.
 */
export const CONTAINER_KINDS = Object.freeze(new Set([
  NODE_KINDS.WORLD,
  NODE_KINDS.PLANE,
  NODE_KINDS.CONTINENT,
  NODE_KINDS.COUNTRY,
  NODE_KINDS.REGION,
]));

export function isContainerKind(kind) {
  return CONTAINER_KINDS.has(kind);
}

/**
 * Bug #66 (2026-04-18) — settlement-tier kinds. Used to gate overland /
 * hex-crawl interactions when the party is physically inside a town or
 * building. Operator rule: "I should only be allowed to hex travel when
 * I've left the town." When any ancestor node on the active party's
 * currentPath is a settlement kind, the MapTab hex grid is view-only.
 * Towns/cities/villages are the obvious settlements; buildings, floors,
 * and rooms are "inside a settlement" for the same reason (you can't
 * stride across the hinterlands while standing in the Rusty Dragon's
 * kitchen). Dungeons are intentionally NOT included — a dungeon node
 * parked on the regional map is still a wilderness-adjacent landmark,
 * and the hex crawl should work for repositioning between dungeon
 * entrance hexes.
 */
export const SETTLEMENT_KINDS = Object.freeze(new Set([
  NODE_KINDS.TOWN,
  NODE_KINDS.CITY,
  NODE_KINDS.VILLAGE,
  NODE_KINDS.BUILDING,
  NODE_KINDS.FLOOR,
  NODE_KINDS.ROOM,
]));

export function isSettlementKind(kind) {
  return SETTLEMENT_KINDS.has(kind);
}

/**
 * Walk a tree + path array and return the first ancestor node that is a
 * settlement-tier kind, or null if the party is not inside a settlement.
 * Callers use the returned node to show a locked-out banner naming the
 * town/building on the MapTab hex surface.
 */
export function findSettlementAncestor(tree, path) {
  if (!tree || !tree.nodes || !Array.isArray(path) || path.length === 0) return null;
  // Scan leaf→root so the deepest settlement (e.g. the Rusty Dragon when
  // standing in its kitchen) wins over broader ones (Sandpoint) — gives
  // the banner a more specific "currently in ___" readout.
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const node = tree.nodes[path[i]];
    if (node && isSettlementKind(node.kind)) return node;
  }
  return null;
}

/**
 * Bug #49 — auto-descend helper. Given a node id, if the node is a TOWN
 * (or CITY / VILLAGE) with a `defaultEntry` name that resolves to one of
 * its direct children, return that child's id. Otherwise return null.
 *
 * The operator's intent: standing at "Sandpoint" as a whole doesn't make
 * sense — the party should always be inside a specific sub-location (The
 * Rusty Dragon, Market Square, Town Hall, etc.). The town node is still
 * navigable via the breadcrumb + world-tree picker, but arriving there
 * from outside (or ascending into it from deeper inside) should re-route
 * to the canonical default entry. For RotRL that's Market Square, seeded
 * in worldTreeSeeds.js.
 *
 * Bug #37 (2026-04-17) — extended to honor defaultEntry on ANY node kind
 * (not only town-like). Container kinds (world/continent/country/region)
 * with an explicit defaultEntry cascade through. Plus: a BUILDING node
 * with `defaultEntry: 'Ground Floor'` will cascade on arrival from
 * outside, matching the Phase 1 Sandpoint seed convention.
 */
export function getDefaultEntryChildId(tree, nodeId) {
  const n = tree?.nodes?.[nodeId];
  if (!n) return null;
  const target = String(n.defaultEntry || '').trim().toLowerCase();
  if (!target) return null;
  const children = (n.childrenIds || []).map(cid => tree.nodes[cid]).filter(Boolean);
  const match = children.find(c => (c.name || '').trim().toLowerCase() === target);
  return match ? match.id : null;
}

/**
 * Bug #37 (2026-04-17) — container-tier fallback cascade. If the node is
 * a CONTAINER_KIND with no defaultEntry (e.g. a seeded Golarion /
 * Avistan / Varisia / Hinterlands — Phase 1 seed doesn't defaultEntry
 * these), return the id of its first child that is NOT itself a
 * container. This is a backstop so breadcrumb over-travel or a bad
 * legacy save can't park the party at a world-tier node. Returns null
 * if no usable child exists.
 */
function getContainerFallbackChildId(tree, nodeId) {
  const n = tree?.nodes?.[nodeId];
  if (!n) return null;
  if (!isContainerKind(n.kind)) return null;
  const children = (n.childrenIds || []).map(cid => tree.nodes[cid]).filter(Boolean);
  if (children.length === 0) return null;
  // Prefer first non-container child; else first child (cascade will
  // iterate on the next pass).
  const nonContainer = children.find(c => !isContainerKind(c.kind));
  return (nonContainer || children[0]).id;
}

/**
 * Settlement kinds that can have multiple entrances (Bug #49 Q2).
 * Narrower than the exported SETTLEMENT_KINDS (which also covers
 * BUILDING/FLOOR/ROOM for hex-crawl gating) — entrance routing only
 * applies at the town surface, not inside buildings.
 */
const SETTLEMENT_ENTRANCE_KINDS = new Set([
  NODE_KINDS.TOWN,
  NODE_KINDS.CITY,
  NODE_KINDS.VILLAGE,
]);

/**
 * Bug #49 — crude axial-delta → compass projection. Flat-top hex,
 * compared by dominant axis. MVP precision: 4 cardinal directions
 * (N/S/E/W). Diagonals get binned to the larger component; exact ties
 * prefer N-S (operator preference — Sandpoint's canonical gates are on
 * the north/south axis, ties shouldn't route through the Docks).
 *
 * Returns null if dq===dr===0 (no direction hint possible).
 */
function axialToCompass(dq, dr) {
  if (!Number.isFinite(dq) || !Number.isFinite(dr)) return null;
  if (dq === 0 && dr === 0) return null;
  const absQ = Math.abs(dq);
  const absR = Math.abs(dr);
  if (absQ > absR) return dq > 0 ? 'east' : 'west';
  return dr > 0 ? 'south' : 'north';
}

/**
 * Bug #49 revision — parse `worldState.partyHex` (offset-even-q string
 * like "8,3") into axial {q, r}. Returns null if the string is missing
 * or malformed.
 *
 * HexGridOverlay.js::pixelToHex emits offset coords:
 *   col = q_axial
 *   row = r_axial + floor((q_axial + (q_axial & 1)) / 2)
 * So inverting: q = col; r = row - floor((col + (col & 1)) / 2).
 * Matches the partyHex → nodes.hexQ/hexR alignment verified in #56.
 */
export function parsePartyHexToAxial(partyHex) {
  if (typeof partyHex !== 'string') return null;
  const parts = partyHex.split(',').map(Number);
  if (parts.length !== 2) return null;
  const [col, row] = parts;
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null;
  const q = col;
  const r = row - Math.floor((col + (col & 1)) / 2);
  return { q, r };
}

/**
 * Bug #49 revision — pick a settlement's entrance child based on
 * approach. Used by resolveLandingPath when the tail is a TOWN/CITY/
 * VILLAGE. Rules:
 *   1. Children with `entrance: true` form the entrance pool.
 *   2. If `bySea` is truthy and a sea-tagged entrance exists → sea wins.
 *   3. Else if `fromHex {q, r}` is finite and the settlement has hex
 *      coords, project the axial delta (origin → town) to a compass
 *      direction. Match against entrance children's `approachFrom`.
 *   4. Else if any entrance is tagged `primary: true` → primary
 *      (campaign-designated default entry).
 *   5. Else → random entrance from the pool (open-world fallback —
 *      operator direction 2026-04-19: no designated primary means
 *      sandbox play, pick a gate at random).
 *
 * Returns null if no entrances are tagged (caller falls through to
 * defaultEntry / container cascade).
 *
 * Per feedback_approach_direction_from_hex.md: the source of
 * direction is always overland hex delta, not tree-ancestry. The old
 * `fromNodeId` opt was a flawed proxy (tree doesn't store geography)
 * and has been removed.
 */
export function resolveTownEntranceChildId(tree, townId, opts = {}) {
  const town = tree?.nodes?.[townId];
  if (!town) return null;
  const children = (town.childrenIds || []).map(cid => tree.nodes[cid]).filter(Boolean);
  const entrances = children.filter(c => c.entrance === true);
  if (entrances.length === 0) return null;

  // 1. Sea override
  if (opts.bySea) {
    const sea = entrances.find(e => e.approachFrom === 'sea');
    if (sea) return sea.id;
  }

  // 2. Directional match via overland hex delta
  const fromHex = opts.fromHex;
  let zeroDelta = false;
  if (fromHex && Number.isFinite(fromHex.q) && Number.isFinite(fromHex.r)
      && Number.isFinite(town.hexQ) && Number.isFinite(town.hexR)) {
    const dq = town.hexQ - fromHex.q;
    const dr = town.hexR - fromHex.r;
    // Bug #49 follow-up 2026-04-20 — zero-delta = party is AT the town hex,
    // not approaching from a direction. Operator directive: at campaign
    // start pick a random entrance (open-world), OR honor startPath
    // (handled at a higher level in AdventureTab.jsx sidecar / migration).
    // We short-circuit directional matching and skip the primary fallback
    // to land on the random branch below.
    if (dq === 0 && dr === 0) {
      zeroDelta = true;
    } else {
      // Reversed: compass direction from town's perspective is "where did
      // they come from" — origin is south of town means approachFrom='south'.
      const compass = axialToCompass(-dq, -dr);
      if (compass) {
        const match = entrances.find(e => e.approachFrom === compass);
        if (match) return match.id;
      }
    }
  }

  // 3. Primary (campaign-scripted default entry) — skipped when the party
  // is AT the town hex (zero delta) so campaign-start defaults don't
  // override the operator's random-entrance expectation. Higher-level
  // code (migration / sidecar) handles the campaign-start case via
  // campaign.data.startPath; if they didn't, treat it as sandbox play.
  if (!zeroDelta) {
    const primary = entrances.find(e => e.primary === true);
    if (primary) return primary.id;
  }

  // 4. Open-world fallback — random entrance. Uses opts.random() if
  // supplied (test seam) else Math.random.
  const rand = typeof opts.random === 'function' ? opts.random : Math.random;
  const pick = Math.floor(rand() * entrances.length);
  return entrances[Math.max(0, Math.min(entrances.length - 1, pick))].id;
}

/**
 * Bug #49 / #37 — resolve a landing path. Cascades town-entrance →
 * defaultEntry → first non-container child until the tail is a valid
 * resting place. Returns the same array reference (identity equality)
 * when no redirect occurred so callers can cheaply check whether a
 * cascade happened.
 *
 * Cascade rules (applied iteratively, max 12 hops to prevent runaway):
 *   0. Bug #49 — if tail is a settlement (TOWN/CITY/VILLAGE) with any
 *      child tagged `entrance: true`, descend via resolveTownEntrance.
 *      opts.fromHex (axial) + opts.bySea direct the choice between
 *      multiple gates (e.g. Turandarok Bridge from the north, Docks
 *      by sea). Falls through to primary → random when unbiased.
 *   1. Else if tail has defaultEntry that resolves → descend.
 *   2. Else if tail is a CONTAINER_KIND with ≥1 child → descend via
 *      first non-container child (Phase 1 seeds Avistan/Varisia/etc.
 *      without defaultEntry; this keeps them from being valid leaves).
 *   3. Otherwise stop — tail is a valid landing.
 *
 * This honors the operator's stated travel model: world-tier geography
 * is routing scaffolding, not parking spots; settlements route arrivals
 * through an entrance, not the town-as-a-whole. See `project_world_tree.md`.
 */
export function resolveLandingPath(tree, path, opts = {}) {
  if (!Array.isArray(path) || path.length === 0 || !tree?.nodes) return path;

  let cascaded = false;
  let current = path;
  const seen = new Set(path);
  const MAX_HOPS = 12;
  // Bug #49 — entrance direction only biases the first settlement hit,
  // not nested sub-cascades (so Docks→buildings don't re-route).
  let entranceOptsConsumed = false;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const tailId = current[current.length - 1];
    const tail = tree.nodes[tailId];
    let extendId = null;

    if (tail && SETTLEMENT_ENTRANCE_KINDS.has(tail.kind) && !entranceOptsConsumed) {
      extendId = resolveTownEntranceChildId(tree, tailId, opts);
      if (extendId) entranceOptsConsumed = true;
    }
    if (!extendId) extendId = getDefaultEntryChildId(tree, tailId);
    if (!extendId) extendId = getContainerFallbackChildId(tree, tailId);
    if (!extendId) break;
    if (seen.has(extendId)) break; // cycle guard
    seen.add(extendId);
    current = [...current, extendId];
    cascaded = true;
  }

  return cascaded ? current : path;
}

// ───────────────────────────────────────────────────────────── live state

/**
 * Commit the live NPCs/items/combat state into the given node. Used when the
 * active party leaves a node so its roster freezes for the next visit.
 */
export function commitLiveStateIntoNode(tree, id, live = {}) {
  const n = tree?.nodes?.[id];
  if (!n) return;
  n.npcs = Array.isArray(live.npcs) ? [...live.npcs] : [];
  n.items = Array.isArray(live.items) ? [...live.items] : [];
  n.combat = live.combat ?? null;
}

/** Pull the node's frozen live state for hydration on arrival. */
export function loadNodeLiveState(tree, id) {
  const n = tree?.nodes?.[id];
  if (!n) return { npcs: [], items: [], combat: null };
  return {
    npcs: Array.isArray(n.npcs) ? [...n.npcs] : [],
    items: Array.isArray(n.items) ? [...n.items] : [],
    combat: n.combat ?? null,
  };
}

// ───────────────────────────────────────────────────────────── L2 visit history

/**
 * Append an event to the node's history log. `kind` is a short tag:
 *   arrival | departure | combat | death | quest | discovery | treasure |
 *   dialogue | rest | tick | note
 */
export function appendNodeHistory(tree, id, event = {}) {
  const n = tree?.nodes?.[id];
  if (!n) return;
  if (!Array.isArray(n.history)) n.history = [];
  n.history.push({
    at: event.at || null,          // worldTime snapshot or null
    atReal: Date.now(),
    kind: String(event.kind || 'note'),
    text: String(event.text || '').slice(0, 1000),
    data: event.data || null,
  });
  // Cap history to last 500 entries per node to bound memory.
  if (n.history.length > 500) n.history = n.history.slice(-500);
}

/**
 * Record a visit on arrival: bumps visitCount, updates firstVisitedAt /
 * lastVisitedAt, and appends an 'arrival' history entry.
 */
export function recordVisit(tree, id, worldStateOrSnap) {
  const n = tree?.nodes?.[id];
  if (!n) return;
  const snap = worldStateOrSnap && (worldStateOrSnap.at || worldStateOrSnap.currentYear !== undefined)
    ? (worldStateOrSnap.at ? worldStateOrSnap : snapshotWorldTime(worldStateOrSnap))
    : null;
  n.visitCount = (n.visitCount || 0) + 1;
  if (!n.firstVisitedAt) n.firstVisitedAt = snap;
  n.lastVisitedAt = snap;
  appendNodeHistory(tree, id, { at: snap, kind: 'arrival', text: `Arrived at ${n.name}.` });
}

/** Mark departure — stores lastTickedAt so the next arrival can compute elapsed. */
export function recordDeparture(tree, id, worldStateOrSnap) {
  const n = tree?.nodes?.[id];
  if (!n) return;
  const snap = worldStateOrSnap && (worldStateOrSnap.at || worldStateOrSnap.currentYear !== undefined)
    ? (worldStateOrSnap.at ? worldStateOrSnap : snapshotWorldTime(worldStateOrSnap))
    : null;
  n.lastTickedAt = snap;
  appendNodeHistory(tree, id, { at: snap, kind: 'departure', text: `Departed from ${n.name}.` });
}

// ───────────────────────────────────────────────────────────── parties

/** Return the active party record (or a synthesized default if missing). */
export function getActiveParty(adventure) {
  if (!adventure) return null;
  const activeId = adventure.activeParty || DEFAULT_PARTY_ID;
  const parties = adventure.parties || {};
  if (parties[activeId]) return parties[activeId];
  // Fall back to the first available party, or synthesize a default.
  const any = Object.values(parties).find(Boolean);
  return any || {
    id: DEFAULT_PARTY_ID,
    name: 'Main Party',
    memberIds: [],
    currentPath: [],
    createdAt: Date.now(),
  };
}

export function getActivePath(adventure) {
  const party = getActiveParty(adventure);
  return Array.isArray(party?.currentPath) ? party.currentPath : [];
}

export function getActiveNode(adventure, tree) {
  const path = getActivePath(adventure);
  return getNodeByPath(tree, path);
}

/**
 * Produce an updated `adventure.parties` map with the active party's
 * currentPath replaced. Does NOT mutate input. Used by reducers.
 */
export function setActivePath(adventure, newPath) {
  const parties = adventure?.parties || {};
  const activeId = adventure?.activeParty || DEFAULT_PARTY_ID;
  const prev = parties[activeId] || {
    id: activeId, name: 'Main Party', memberIds: [], currentPath: [], createdAt: Date.now(),
  };
  return {
    ...parties,
    [activeId]: { ...prev, currentPath: Array.isArray(newPath) ? [...newPath] : [] },
  };
}

/**
 * Build a default parties map seeded with a single 'main' party.
 * `memberIds` defaults to [] — caller can patch with actual PC ids.
 */
export function defaultParties({ memberIds = [] } = {}) {
  return {
    [DEFAULT_PARTY_ID]: {
      id: DEFAULT_PARTY_ID,
      name: 'Main Party',
      memberIds: [...memberIds],
      currentPath: [],
      createdAt: Date.now(),
    },
  };
}

// ───────────────────────────────────────────────────────────── convenience

/**
 * Ensure adventure has a worldTree + parties. Non-destructive: returns a
 * shallow-merged patch the caller can spread into adventure state.
 */
export function ensureAdventureTreeShape(adventure, { rootData } = {}) {
  const patch = {};
  if (!adventure?.worldTree || !adventure.worldTree.nodes) {
    patch.worldTree = createTree(rootData || { name: 'World', kind: NODE_KINDS.WORLD });
  }
  if (!adventure?.parties || !adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID]) {
    patch.parties = defaultParties();
    patch.activeParty = DEFAULT_PARTY_ID;
  }
  return patch;
}

/**
 * Path-equality check for currentPath arrays.
 */
export function samePath(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
