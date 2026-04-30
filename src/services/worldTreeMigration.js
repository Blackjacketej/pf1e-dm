/**
 * worldTreeMigration.js — One-shot migrations into the world-tree model.
 *
 * Handles two legacy shapes:
 *   1. Flat `adventure.subLocations` dict from #37 (single-level rooms inside
 *      one location). Migrated as children of the current location node.
 *   2. `adventure.location` top-level without any tree. Migrated as a single
 *      node under a generic world root.
 *
 * Migration is idempotent — if `adventure.worldTree.nodes` already has content
 * we leave it alone. The caller spreads the returned patch into adventure
 * state; nothing is persisted from here.
 */

import {
  createTree,
  createChildNode,
  defaultParties,
  NODE_KINDS,
  DEFAULT_PARTY_ID,
  snapshotWorldTime,
  findNodePath,
  resolveLandingPath,
} from './worldTree';
import { buildSeedTree, ensureSeedInTree } from '../data/worldTreeSeeds';

// Subset of kinds we map `adventure.type` onto during migration.
const TYPE_TO_KIND = {
  town: NODE_KINDS.TOWN,
  city: NODE_KINDS.CITY,
  village: NODE_KINDS.VILLAGE,
  dungeon: NODE_KINDS.DUNGEON,
  wilderness: NODE_KINDS.WILDERNESS,
  building: NODE_KINDS.BUILDING,
};

function inferLocationKind(location, adventureType) {
  if (adventureType && TYPE_TO_KIND[adventureType]) return TYPE_TO_KIND[adventureType];
  if (location?.terrain === 'city') return NODE_KINDS.CITY;
  if (location?.terrain === 'town') return NODE_KINDS.TOWN;
  if (location?.terrain === 'village') return NODE_KINDS.VILLAGE;
  if (location?.terrain === 'wilderness' || location?.terrain === 'forest' || location?.terrain === 'hills') return NODE_KINDS.WILDERNESS;
  if (location?.terrain === 'dungeon') return NODE_KINDS.DUNGEON;
  return NODE_KINDS.AREA;
}

function cloneArr(v) {
  return Array.isArray(v) ? v.map(x => (x && typeof x === 'object' ? { ...x } : x)) : [];
}

/**
 * Resolve a sequence of node names to a path of node ids in the given tree.
 * Walks the tree from root, matching each name case-insensitively against
 * the current node's direct children.
 *
 * Bug #39 (2026-04-17): used by migration to honor a campaign's canonical
 * `startPath` (e.g. Rise of the Runelords → Market Square instead of Main
 * Road hub default). Returns null if any segment fails to resolve, so the
 * caller can fall back to the standard landing cascade rather than shipping
 * a broken currentPath.
 *
 * @param {Object} tree — worldTree { rootId, nodes }
 * @param {string[]} names — ordered node names from root leaf-ward
 * @returns {string[]|null} ids or null if unresolvable
 */
export function resolveNamedPath(tree, names) {
  if (!tree || !Array.isArray(names) || names.length === 0) return null;
  if (!tree.rootId || !tree.nodes || !tree.nodes[tree.rootId]) return null;
  const root = tree.nodes[tree.rootId];
  // Root match may or may not be included in names[0] — accept both.
  const firstName = String(names[0] || '').toLowerCase();
  const rootName = String(root.name || '').toLowerCase();
  const path = [root.id];
  let idx;
  if (firstName === rootName) {
    idx = 1;
  } else {
    idx = 0;
  }
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
 * Migrate an adventure object into the world-tree model. Returns a patch:
 *   { worldTree, parties, activeParty, subLocations: null, currentSub: null }
 * or null if no migration is needed.
 *
 * The caller is expected to apply the patch to adventure state and also clear
 * `nearbyNPCs` / `areaItems` live state if desired (the active-node's npcs /
 * items now own that role).
 *
 * @param {Object} adventure — The adventure record being migrated.
 * @param {Object} [opts]
 * @param {Object} [opts.worldState] — Current worldState for visit timestamps.
 * @param {Array}  [opts.memberIds] — PC ids to seed the default party with.
 * @param {Object} [opts.rootSeed] — { name, kind, desc } for a campaign-setting
 *   root (e.g., Golarion). If omitted, a generic 'World' root is used.
 * @param {string[]} [opts.startPath] — Optional ordered list of node names to
 *   land the party at on fresh migration. When supplied and resolvable, this
 *   OVERRIDES the standard `resolveLandingPath` defaultEntry cascade — use it
 *   for campaigns whose canonical opener is a specific child (e.g. RotR at
 *   Market Square rather than Sandpoint's Main Road hub). #39.
 */
export function migrateAdventureToWorldTree(adventure, opts = {}) {
  if (!adventure || typeof adventure !== 'object') return null;

  const hasTree = adventure.worldTree
    && adventure.worldTree.nodes
    && Object.keys(adventure.worldTree.nodes).length > 0;
  const hasParties = adventure.parties
    && adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID]
    && Array.isArray(adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID].currentPath)
    && adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID].currentPath.length > 0;

  // Already migrated — nothing to do.
  if (hasTree && hasParties) return null;

  const worldStateSnap = snapshotWorldTime(opts.worldState);
  const settingKey = opts.settingKey || 'pf1e';

  // Step 1: Build the tree root + canonical seed nodes.
  // If the adventure doesn't have a tree yet, seed a full canonical backbone
  // (Golarion > Avistan > Varisia > Sandpoint Hinterlands > Sandpoint, etc.).
  // If a tree already exists, idempotently top it up with any missing seed
  // nodes so existing campaigns get the backbone without duplicating work.
  let tree;
  if (hasTree) {
    tree = adventure.worldTree;
    ensureSeedInTree(tree, settingKey);
  } else {
    const seeded = buildSeedTree(settingKey);
    tree = seeded.tree;
  }
  let rootId = tree.rootId;
  if (!rootId || !tree.nodes[rootId]) {
    const fresh = buildSeedTree(settingKey);
    Object.assign(tree, fresh.tree);
    rootId = fresh.tree.rootId;
  }

  // Step 2: Ensure the current location exists as a node. First try to match
  // an existing seeded node (Sandpoint → canonical Sandpoint under Hinterlands).
  // Fallback: attach a new child directly under the root.
  let locationNodeId = null;
  let locationPath = [rootId];
  if (adventure.location && adventure.location.name) {
    const existing = Object.values(tree.nodes)
      .find(n => (n.name || '').toLowerCase() === String(adventure.location.name).toLowerCase());
    if (existing) {
      locationNodeId = existing.id;
      const p = findNodePath(tree, existing.id);
      if (p && p.length) locationPath = p;
      // Seed current live state into the matched node (so we land back
      // with whatever NPCs/items were on-screen).
      if (!existing.npcs || existing.npcs.length === 0) {
        existing.npcs = cloneArr(adventure.nearbyNPCs);
      }
      if (!existing.items || existing.items.length === 0) {
        existing.items = cloneArr(adventure.areaItems);
      }
      existing.visitCount = Math.max(existing.visitCount || 0, 1);
      if (!existing.firstVisitedAt) existing.firstVisitedAt = worldStateSnap;
      existing.lastVisitedAt = worldStateSnap;
    } else {
      const kind = inferLocationKind(adventure.location, adventure.type);
      const locNode = createChildNode(tree, rootId, {
        name: adventure.location.name || 'Unknown Location',
        kind,
        desc: adventure.location.description || adventure.location.desc || '',
      });
      locationNodeId = locNode.id;
      locationPath = [rootId, locNode.id];
      locNode.npcs = cloneArr(adventure.nearbyNPCs);
      locNode.items = cloneArr(adventure.areaItems);
      locNode.visitCount = 1;
      locNode.firstVisitedAt = worldStateSnap;
      locNode.lastVisitedAt = worldStateSnap;
    }
  }

  // Step 3: Migrate flat subLocations from #37.
  const subMap = adventure.subLocations || {};
  const currentSub = adventure.currentSub || null;
  const subIdToNewId = {};

  if (locationNodeId) {
    for (const [subKey, sub] of Object.entries(subMap)) {
      if (!sub || subKey === '__main') continue;
      // If there's already a child with the same name under the location,
      // skip (idempotent re-runs shouldn't duplicate).
      const locNode = tree.nodes[locationNodeId];
      const dup = (locNode.childrenIds || [])
        .map(cid => tree.nodes[cid])
        .find(n => n && (n.name || '').toLowerCase() === String(sub.name || '').toLowerCase());
      if (dup) {
        subIdToNewId[subKey] = dup.id;
        continue;
      }
      const childNode = createChildNode(tree, locationNodeId, {
        name: sub.name || 'Unnamed',
        kind: NODE_KINDS.ROOM,
        desc: sub.desc || '',
      });
      childNode.npcs = cloneArr(sub.npcs);
      childNode.items = cloneArr(sub.items);
      if (sub.visitedAt) {
        childNode.lastVisitedAt = sub.visitedAt;
        childNode.firstVisitedAt = sub.visitedAt;
        childNode.visitCount = 1;
      }
      subIdToNewId[subKey] = childNode.id;
    }

    // Step 3b: If the pre-#37 __main slot has staged npcs/items that differ
    // from current live state, we prefer the live state (already seeded above).
    // The __main slot's data is only used if live state was empty.
    const mainSlot = subMap['__main'];
    if (mainSlot && locationNodeId) {
      const locNode = tree.nodes[locationNodeId];
      if ((!locNode.npcs || locNode.npcs.length === 0) && Array.isArray(mainSlot.npcs)) {
        locNode.npcs = cloneArr(mainSlot.npcs);
      }
      if ((!locNode.items || locNode.items.length === 0) && Array.isArray(mainSlot.items)) {
        locNode.items = cloneArr(mainSlot.items);
      }
    }
  }

  // Step 4: Build the active party's currentPath.
  //   - If a canonical campaign startPath is supplied AND fully resolves in
  //     the tree, use it verbatim (bug #39 — RotR must open at Market Square,
  //     not Sandpoint's generic Main Road hub).
  //   - Else if a canonical seed matched, use its full ancestry
  //     (e.g. [golarion, avistan, varisia, hinterlands, sandpoint]).
  //   - Otherwise fall back to [root, location].
  //   - If the operator was inside a #37 sub-location, append that child's id.
  //   - If no known location → [root].
  let currentPath = null;
  let usedStartPath = false;
  if (Array.isArray(opts.startPath) && opts.startPath.length > 0) {
    const resolved = resolveNamedPath(tree, opts.startPath);
    if (resolved && resolved.length) {
      currentPath = resolved;
      usedStartPath = true;
    }
  }
  if (!currentPath) {
    currentPath = Array.isArray(locationPath) && locationPath.length
      ? [...locationPath]
      : [rootId];
    if (locationNodeId && currentSub && subIdToNewId[currentSub]) {
      currentPath.push(subIdToNewId[currentSub]);
    }
    // Bug #49 — if the migrated path terminates at a TOWN/CITY/VILLAGE node
    // with a canonical defaultEntry (e.g. Sandpoint → Market Square for RotRL),
    // auto-descend so the party lands at a specific sub-location instead of
    // the town-as-a-whole. Migration runs once per save; after this the
    // in-game navigator keeps the party inside sub-locations via the same
    // resolveLandingPath hook in switchToNodePath.
    currentPath = resolveLandingPath(tree, currentPath);
  }
  // When a startPath was honored, skip the cascade — the campaign author has
  // already specified the exact sub-location; cascading further would undo
  // their choice. This is the whole point of #39.
  void usedStartPath;

  // Step 5: Build/patch parties map.
  const partiesPatch = hasParties
    ? adventure.parties
    : defaultParties({ memberIds: opts.memberIds || [] });
  const activeId = adventure.activeParty || DEFAULT_PARTY_ID;
  partiesPatch[activeId] = {
    ...(partiesPatch[activeId] || { id: activeId, name: 'Main Party', memberIds: [], createdAt: Date.now() }),
    currentPath,
  };

  return {
    worldTree: tree,
    parties: partiesPatch,
    activeParty: activeId,
    // Legacy fields get cleared so downstream code stops reading them.
    subLocations: null,
    currentSub: null,
  };
}

/**
 * Lightweight check — does this adventure need migration?
 */
export function needsWorldTreeMigration(adventure) {
  if (!adventure) return false;
  const hasTree = adventure.worldTree
    && adventure.worldTree.nodes
    && Object.keys(adventure.worldTree.nodes).length > 0;
  const hasActivePath = adventure.parties
    && adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID]
    && Array.isArray(adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID].currentPath)
    && adventure.parties[adventure.activeParty || DEFAULT_PARTY_ID].currentPath.length > 0;
  return !(hasTree && hasActivePath);
}
