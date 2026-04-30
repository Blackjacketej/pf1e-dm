/**
 * hexConfig.js — Shared hex-grid configuration.
 *
 * Single source of truth for:
 *   (1) per-map hex size keyed off mapRegistry map id — drives HexGridOverlay
 *       rendering, pixelToHex math, and the pin-editor grid.
 *   (2) per-node hex-size lookup — drives overland travel-time math in
 *       overlandTravel.js so travel across the 1-mi Sandpoint Hinterlands
 *       detail map doesn't get calculated at the 6-mi default.
 *
 * Task #84 (2026-04-19) — lifted from duplicate copies in MapTab.jsx +
 * GMMapPinEditor.jsx. Task #86 adds the tree-lookup path so per-region scale
 * flows into travel-time math.
 *
 * Adding a new map:
 *   - Add its mapRegistry id as a key in HEX_CONFIGS.
 *   - Stamp the matching hexSizeMiles on whichever world-tree region node
 *     corresponds to that map (see worldTreeSeeds.js). The two sides don't
 *     have to be coupled (different code paths), but keeping them in sync
 *     prevents rendered-hex vs. travel-hex mismatches.
 */

// ────────────────────────────────────────────────────── defaults

export const DEFAULT_HEX_SIZE_MILES = 2;
export const DEFAULT_MAP_WIDTH_MILES = 25;
export const DEFAULT_HEX_CONFIG = Object.freeze({
  hexSizeMiles: DEFAULT_HEX_SIZE_MILES,
  mapWidthMiles: DEFAULT_MAP_WIDTH_MILES,
});

// ────────────────────────────────────────────────────── per-map config
// Keyed by mapRegistry map id. Canonical PF1e / Rise of the Runelords maps:
//   Sandpoint Hinterlands (local)  — 1-mi hexes × 25-mi-wide map (~25 across)
//   Varisia region (regional)      — 12-mi hexes × 350-mi-wide map (~29 across)
// Anything not listed falls through to DEFAULT_HEX_CONFIG (2-mi / 25-mi).
export const HEX_CONFIGS = Object.freeze({
  sandpoint_hinterlands: { hexSizeMiles: 1,  mapWidthMiles: 25 },
  varisia_region:        { hexSizeMiles: 12, mapWidthMiles: 350 },
});

/**
 * Resolve a hex-config by mapRegistry id.
 * Unknown ids fall back to DEFAULT_HEX_CONFIG.
 */
export function getHexConfig(mapId) {
  if (!mapId) return DEFAULT_HEX_CONFIG;
  const cfg = HEX_CONFIGS[mapId];
  return cfg ? { ...DEFAULT_HEX_CONFIG, ...cfg } : DEFAULT_HEX_CONFIG;
}

// ────────────────────────────────────────────────────── per-node lookup

/**
 * Resolve the effective hex size (in miles) for a given world-tree node.
 *
 * Walks from the node up through its ancestors looking for an explicit
 * `hexSizeMiles` property on any of them. The closest declaration wins,
 * so a nested region can override its parent country. Returns
 * DEFAULT_HEX_SIZE_MILES if no ancestor declares one.
 *
 * Regions should stamp hexSizeMiles to match their detail map:
 *   Sandpoint Hinterlands → 1  (local 1-mi detail map)
 *   Varisia (country)     → 12 (regional 12-mi map)
 *
 * DM override surface: set `node.hexSizeMiles` directly on any tree node
 * (via GM tools, hand-edit, or a custom seed) and it takes precedence over
 * any ancestor value. Useful for per-dungeon or per-landmark scale quirks.
 */
export function getHexSizeMilesForNode(tree, nodeId) {
  if (!tree?.nodes || !nodeId) return DEFAULT_HEX_SIZE_MILES;
  let cur = tree.nodes[nodeId];
  // Guard against cycles just in case (sibling shouldn't happen, but walking
  // parentId chains is the same pattern used in worldTree::findNodePath which
  // we've been defensive about elsewhere).
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (Number.isFinite(cur.hexSizeMiles) && cur.hexSizeMiles > 0) {
      return cur.hexSizeMiles;
    }
    cur = cur.parentId ? tree.nodes[cur.parentId] : null;
  }
  return DEFAULT_HEX_SIZE_MILES;
}

export default {
  DEFAULT_HEX_SIZE_MILES,
  DEFAULT_MAP_WIDTH_MILES,
  DEFAULT_HEX_CONFIG,
  HEX_CONFIGS,
  getHexConfig,
  getHexSizeMilesForNode,
};
