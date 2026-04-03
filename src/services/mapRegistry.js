/**
 * Map Registry — maps game locations to official map images.
 * Images are served from /maps/ (public folder).
 *
 * Entries with file: null are placeholders — the InteractiveMap component
 * will fall back to procedural SVG maps for those locations.
 * As the user adds more map images, just set the file field.
 *
 * Each entry contains:
 *   - id: unique identifier matching game location IDs
 *   - name: display name
 *   - file: filename in /maps/ (null if not yet provided)
 *   - type: 'region' | 'town' | 'dungeon' | 'building' | 'wilderness'
 *   - chapter: which RotRL chapter (1-6) or 'sandpoint' for the supplement
 *   - poi: points of interest for interactive pins [{ id, label, xPct, yPct, type }]
 */

const MAP_BASE = '/maps/';

const mapRegistry = [
  // ═══════════════════════════════════════════════════════════════
  // REGIONAL / OVERLAND MAPS (user-provided)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'varisia_region',
    name: 'Varisia',
    file: 'varisia-small-sandbox-campaign-v0-7ngfta16ppz91.webp',
    type: 'region',
    chapter: 0,
    description: 'The land of Varisia — from Riddleport to Magnimar, the Storval Plateau to the Lost Coast.',
    poi: [
      { id: 'sandpoint', label: 'Sandpoint', xPct: 33, yPct: 72, type: 'town' },
      { id: 'magnimar', label: 'Magnimar', xPct: 18, yPct: 82, type: 'city' },
      { id: 'riddleport', label: 'Riddleport', xPct: 27, yPct: 40, type: 'city' },
      { id: 'turtleback_ferry', label: 'Turtleback Ferry', xPct: 57, yPct: 58, type: 'town' },
      { id: 'xin_shalast', label: 'Xin-Shalast', xPct: 90, yPct: 8, type: 'ruin' },
      { id: 'kaer_maga', label: 'Kaer Maga', xPct: 65, yPct: 55, type: 'city' },
      { id: 'korvosa', label: 'Korvosa', xPct: 78, yPct: 88, type: 'city' },
      { id: 'janderhoff', label: 'Janderhoff', xPct: 87, yPct: 78, type: 'city' },
      { id: 'galduria', label: 'Galduria', xPct: 38, yPct: 68, type: 'town' },
      { id: 'wolf_ear', label: "Wolf's Ear", xPct: 42, yPct: 62, type: 'town' },
      { id: 'wartle', label: 'Wartle', xPct: 40, yPct: 78, type: 'town' },
      { id: 'nybor', label: 'Nybor', xPct: 42, yPct: 72, type: 'town' },
      { id: 'ravenmoor', label: 'Ravenmoor', xPct: 48, yPct: 42, type: 'town' },
      { id: 'storval_stairs', label: 'Storval Stairs', xPct: 55, yPct: 42, type: 'ruin' },
      { id: 'hook_mountain', label: 'Hook Mountain', xPct: 50, yPct: 48, type: 'dungeon' },
      { id: 'celwynvian', label: 'Celwynvian', xPct: 18, yPct: 28, type: 'ruin' },
      { id: 'crying_leaf', label: 'Crying Leaf', xPct: 20, yPct: 32, type: 'town' },
      { id: 'crystilan', label: 'Crystilan', xPct: 5, yPct: 10, type: 'ruin' },
      { id: 'windsong_abbey', label: 'Windsong Abbey', xPct: 22, yPct: 72, type: 'temple' },
      { id: 'churlwood', label: 'Churlwood', xPct: 35, yPct: 50, type: 'wilderness' },
      { id: 'lurkwood', label: 'Lurkwood', xPct: 40, yPct: 22, type: 'wilderness' },
    ],
  },
  {
    id: 'sandpoint_hinterlands',
    name: 'Sandpoint Hinterlands',
    file: 'sandpoint_hinterlands.webp',
    type: 'wilderness',
    chapter: 1,
    description: 'The Lost Coast region around Sandpoint — farms, moors, and the coastline.',
    poi: [
      { id: 'sandpoint', label: 'Sandpoint', xPct: 50, yPct: 28, type: 'town' },
      { id: 'thistletop', label: 'Thistletop', xPct: 18, yPct: 14, type: 'dungeon' },
      { id: 'foxglove_manor', label: 'Foxglove Manor', xPct: 82, yPct: 42, type: 'dungeon' },
      { id: 'brinestump_marsh', label: 'Brinestump Marsh', xPct: 62, yPct: 60, type: 'wilderness' },
      { id: 'old_light', label: 'The Old Light', xPct: 42, yPct: 22, type: 'ruin' },
      { id: 'nettlewood', label: 'Nettlewood', xPct: 25, yPct: 25, type: 'wilderness' },
      { id: 'farmlands', label: 'Farmlands', xPct: 60, yPct: 35, type: 'wilderness' },
      { id: 'devils_platter', label: "Devil's Platter", xPct: 35, yPct: 55, type: 'wilderness' },
      { id: 'mosswood', label: 'Mosswood', xPct: 45, yPct: 65, type: 'wilderness' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // TOWN / SETTLEMENT MAPS (placeholders — add file when provided)
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'sandpoint_town',
    name: 'Sandpoint',
    file: null,
    type: 'town',
    chapter: 1,
    description: 'The town of Sandpoint on the Lost Coast. Population ~1,240.',
    poi: [
      { id: 'cathedral', label: 'Sandpoint Cathedral', xPct: 62, yPct: 22, type: 'temple' },
      { id: 'rusty_dragon', label: 'The Rusty Dragon', xPct: 48, yPct: 55, type: 'tavern' },
      { id: 'glassworks', label: 'Sandpoint Glassworks', xPct: 55, yPct: 65, type: 'building' },
      { id: 'garrison', label: 'Sandpoint Garrison', xPct: 40, yPct: 45, type: 'government' },
      { id: 'old_light', label: 'The Old Light', xPct: 18, yPct: 18, type: 'ruin' },
    ],
  },
  {
    id: 'magnimar',
    name: 'Magnimar',
    file: null,
    type: 'town',
    chapter: 2,
    description: 'The City of Monuments — Varisia\'s largest city.',
  },
  {
    id: 'turtleback_ferry',
    name: 'Turtleback Ferry',
    file: null,
    type: 'town',
    chapter: 3,
    description: 'A small township on the north shore of Claybottom Lake.',
  },

  // ═══════════════════════════════════════════════════════════════
  // CHAPTER 1: BURNT OFFERINGS — DUNGEON MAPS
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'glassworks',
    name: 'Sandpoint Glassworks',
    file: null,
    type: 'dungeon',
    chapter: 1,
    description: 'The Kaijitsu family glassworks — now a goblin staging ground.',
  },
  {
    id: 'catacombs_of_wrath',
    name: 'Catacombs of Wrath',
    file: null,
    type: 'dungeon',
    chapter: 1,
    description: 'Ancient Thassilonian ruins beneath Sandpoint, devoted to the sin of Wrath.',
  },
  {
    id: 'thistletop',
    name: 'Thistletop',
    file: null,
    type: 'dungeon',
    chapter: 1,
    description: 'The goblin fortress on the isle of Thistletop.',
  },

  // ═══════════════════════════════════════════════════════════════
  // CHAPTER 2: THE SKINSAW MURDERS
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'habes_sanatorium',
    name: "Habe's Sanatorium",
    file: null,
    type: 'dungeon',
    chapter: 2,
    description: 'A remote sanatorium run by the questionable Erin Habe.',
  },
  {
    id: 'foxglove_manor',
    name: 'Foxglove Manor (The Misgivings)',
    file: null,
    type: 'dungeon',
    chapter: 2,
    description: 'The haunted manor on the cliffs.',
  },
  {
    id: 'shadow_clock',
    name: 'The Shadow Clock',
    file: null,
    type: 'dungeon',
    chapter: 2,
    description: 'The ruined clock tower in Magnimar\'s Underbridge district.',
  },

  // ═══════════════════════════════════════════════════════════════
  // CHAPTER 3: THE HOOK MOUNTAIN MASSACRE
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'graul_homestead',
    name: 'The Graul Homestead',
    file: null,
    type: 'dungeon',
    chapter: 3,
    description: 'The degenerate Graul family farm in the Kreegwood.',
  },
  {
    id: 'fort_rannick',
    name: 'Fort Rannick',
    file: null,
    type: 'dungeon',
    chapter: 3,
    description: 'The Black Arrow rangers\' keep, now overrun by ogres.',
  },
  {
    id: 'skulls_crossing',
    name: "Skull's Crossing",
    file: null,
    type: 'dungeon',
    chapter: 3,
    description: 'The ancient Thassilonian dam holding back the Storval Deep.',
  },
  {
    id: 'hook_mountain_clanhold',
    name: 'Hook Mountain Clanhold',
    file: null,
    type: 'dungeon',
    chapter: 3,
    description: 'The ogre clanhold deep within Hook Mountain.',
  },

  // ═══════════════════════════════════════════════════════════════
  // CHAPTERS 4-6
  // ═══════════════════════════════════════════════════════════════
  {
    id: 'jorgenfist',
    name: 'Jorgenfist',
    file: null,
    type: 'dungeon',
    chapter: 4,
    description: 'The stone giant fortress in the Iron Peaks.',
  },
  {
    id: 'runeforge',
    name: 'Runeforge',
    file: null,
    type: 'dungeon',
    chapter: 5,
    description: 'The ancient Thassilonian magical research complex.',
  },
  {
    id: 'xin_shalast_city',
    name: 'Xin-Shalast',
    file: null,
    type: 'town',
    chapter: 6,
    description: 'The lost city of greed, high in the Kodar Mountains.',
  },
  {
    id: 'pinnacle_of_avarice',
    name: 'Pinnacle of Avarice',
    file: null,
    type: 'dungeon',
    chapter: 6,
    description: 'Karzoug\'s seat of power atop Mhar Massif — the final dungeon.',
  },
];

// ─── Lookup helpers ──────────────────────────────────────────────

/** Get a map entry by its ID */
export function getMap(id) {
  return mapRegistry.find(m => m.id === id) || null;
}

/** Get the image URL for a map (null if no file provided yet) */
export function getMapUrl(id) {
  const entry = getMap(id);
  return entry?.file ? `${MAP_BASE}${entry.file}` : null;
}

/** Check if an official map image exists for this ID */
export function hasMapImage(id) {
  const entry = getMap(id);
  return !!(entry?.file);
}

/** Get all maps for a given chapter */
export function getMapsByChapter(chapter) {
  return mapRegistry.filter(m => m.chapter === chapter);
}

/** Get all maps of a given type */
export function getMapsByType(type) {
  return mapRegistry.filter(m => m.type === type);
}

/** Get all maps that have actual image files */
export function getAvailableMaps() {
  return mapRegistry.filter(m => m.file !== null);
}

/** Get all dungeon maps */
export function getDungeonMaps() {
  return mapRegistry.filter(m => m.type === 'dungeon');
}

/** Get all town/settlement maps */
export function getTownMaps() {
  return mapRegistry.filter(m => m.type === 'town');
}

/** Get all regional/overland maps */
export function getRegionMaps() {
  return mapRegistry.filter(m => m.type === 'region' || m.type === 'wilderness');
}

/**
 * Try to match a location name or description to a map.
 * Fuzzy matching — checks if the location name contains map keywords.
 */
export function findMapForLocation(locationName, locationType) {
  if (!locationName) return null;
  const name = locationName.toLowerCase();

  // Direct name matching
  for (const m of mapRegistry) {
    const mName = m.name.toLowerCase();
    if (name.includes(mName) || mName.includes(name)) return m;
  }

  // Keyword matching
  const keywords = {
    glassworks: 'glassworks',
    catacombs: 'catacombs_of_wrath',
    thistletop: 'thistletop',
    foxglove: 'foxglove_manor',
    misgivings: 'foxglove_manor',
    sanatorium: 'habes_sanatorium',
    'shadow clock': 'shadow_clock',
    graul: 'graul_homestead',
    rannick: 'fort_rannick',
    skull: 'skulls_crossing',
    'hook mountain': 'hook_mountain_clanhold',
    runeforge: 'runeforge',
    pinnacle: 'pinnacle_of_avarice',
    'xin-shalast': 'xin_shalast_city',
    jorgenfist: 'jorgenfist',
    sandpoint: 'sandpoint_town',
    magnimar: 'magnimar',
    turtleback: 'turtleback_ferry',
    farmland: 'sandpoint_hinterlands',
    hinterland: 'sandpoint_hinterlands',
    varisia: 'varisia_region',
    'old light': 'glassworks',
  };

  for (const [keyword, mapId] of Object.entries(keywords)) {
    if (name.includes(keyword)) return getMap(mapId);
  }

  return null;
}

/**
 * Get the best overland map for the current party location.
 * Returns the hinterlands map near Sandpoint, Varisia for broader travel.
 */
export function getOverlandMap(locationId) {
  // Near Sandpoint? Use hinterlands
  const nearSandpoint = ['sandpoint', 'thistletop', 'foxglove_manor', 'glassworks',
    'catacombs_of_wrath', 'nettlewood', 'brinestump_marsh', 'farmlands', 'old_light'];
  if (nearSandpoint.includes(locationId)) {
    return getMap('sandpoint_hinterlands');
  }
  // Default to full Varisia
  return getMap('varisia_region');
}

/** Get the full registry */
export function getAllMaps() {
  return [...mapRegistry];
}

export default {
  getMap,
  getMapUrl,
  hasMapImage,
  getMapsByChapter,
  getMapsByType,
  getAvailableMaps,
  getDungeonMaps,
  getTownMaps,
  getRegionMaps,
  findMapForLocation,
  getOverlandMap,
  getAllMaps,
};
