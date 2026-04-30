// craftFacilities.js
// Pure helpers for UC-style craft facility / room lookups.
//
// A "facility" is a UC room type (Forge, Alchemy Lab, Leather Workshop, etc.)
// that provides masterwork artisan's tools (+2 circumstance) for specific
// Craft sub-skills. This module answers two questions:
//   1. Given a Craft sub-skill, which facility types support it?
//   2. Given a location's facility list, does the crafter get a tool bonus?
//
// Separation of concerns:
//   * This module is pure data + lookups, no React, no Dexie.
//   * The caller (UI or tick) decides what facilities are available.
//   * The existing toolMods system on craft projects remains the single
//     source of truth for check modifiers. This module just helps the UI
//     auto-set toolMods.masterworkTools when a facility is present.

import facilitiesData from '../data/craftFacilities.json';

const facilities = facilitiesData.facilities || [];

// ──────────────────────────────────────────────────────────────────
// Build a sub-skill → facility lookup at import time (O(1) queries).

const subSkillToFacilities = new Map();
for (const fac of facilities) {
  for (const sub of fac.craftSubSkills || []) {
    const key = sub.toLowerCase().trim();
    if (!subSkillToFacilities.has(key)) {
      subSkillToFacilities.set(key, []);
    }
    subSkillToFacilities.get(key).push(fac);
  }
}

const facilityById = new Map(facilities.map(f => [f.id, f]));

// ──────────────────────────────────────────────────────────────────
// Public API

/**
 * Return all facility definitions.
 * @returns {Array}
 */
export function getAllFacilities() {
  return facilities;
}

/**
 * Look up a single facility by id.
 * @param {string} id
 * @returns {object|null}
 */
export function getFacilityById(id) {
  return facilityById.get(id) || null;
}

/**
 * Given a Craft sub-skill string (e.g. "Craft (weapons)"), return
 * facility definitions that provide masterwork tools for it.
 *
 * @param {string} subSkill
 * @returns {Array} — matching facility objects, or []
 */
export function getFacilitiesForSubSkill(subSkill) {
  if (!subSkill) return [];
  return subSkillToFacilities.get(String(subSkill).toLowerCase().trim()) || [];
}

/**
 * Given a Craft sub-skill and a list of facility IDs available at the
 * crafter's location, return the best matching facility (or null).
 *
 * "Best" is simply the first one that covers the sub-skill. In practice
 * there's only one facility type per sub-skill, so no tie-breaking needed.
 *
 * @param {string} subSkill
 * @param {string[]} availableFacilityIds — IDs the location offers
 * @returns {object|null} — { facility, toolBonus }
 */
export function resolveFacilityBonus(subSkill, availableFacilityIds) {
  if (!subSkill || !Array.isArray(availableFacilityIds) || availableFacilityIds.length === 0) {
    return null;
  }
  const candidates = getFacilitiesForSubSkill(subSkill);
  if (candidates.length === 0) return null;

  const idSet = new Set(availableFacilityIds.map(id => String(id).toLowerCase().trim()));
  for (const fac of candidates) {
    if (idSet.has(fac.id)) {
      return { facility: fac, toolBonus: fac.toolBonus || 2 };
    }
  }
  return null;
}

/**
 * Convert a facility bonus resolution into the toolMods shape already
 * used by startCraftProject / advanceCraftProjectWeekly.
 *
 * If the crafter has access to a facility for the sub-skill, auto-set
 * masterworkTools (or alchemistLab for alchemy). Preserves any existing
 * manual overrides in the input toolMods.
 *
 * @param {string} subSkill
 * @param {string[]} availableFacilityIds
 * @param {object} [existingToolMods] — current toolMods to merge with
 * @returns {object} — merged toolMods
 */
export function applyFacilityToToolMods(subSkill, availableFacilityIds, existingToolMods = {}) {
  const resolved = resolveFacilityBonus(subSkill, availableFacilityIds);
  if (!resolved) return { ...existingToolMods };

  const merged = { ...existingToolMods };
  // Alchemy Lab maps to the alchemistLab flag (separate CRB equipment).
  if (resolved.facility.id === 'alchemy-lab') {
    merged.alchemistLab = true;
  } else {
    merged.masterworkTools = true;
  }
  return merged;
}

/**
 * Given a settlement/location data object, extract the list of craft
 * facility IDs it provides. Supports multiple data shapes:
 *
 *   - location.craftFacilities: string[] of facility IDs (canonical)
 *   - location.type === 'blacksmith' / 'factory' / etc → inferred mapping
 *
 * This allows existing sandpoint.json locations to auto-resolve without
 * needing manual craftFacilities arrays on every location.
 *
 * @param {object} location
 * @returns {string[]}
 */
export function getLocationFacilityIds(location) {
  if (!location) return [];

  // Explicit facility list takes priority.
  if (Array.isArray(location.craftFacilities) && location.craftFacilities.length > 0) {
    return location.craftFacilities;
  }

  // Infer from location type for backward-compat with existing data.
  const inferred = [];
  const type = String(location.type || '').toLowerCase();
  const name = String(location.name || '').toLowerCase();
  const desc = String(location.description || '').toLowerCase();

  // Blacksmith / armory → Forge
  if (type === 'blacksmith' || type === 'armory' ||
      name.includes('armory') || name.includes('blacksmith') || name.includes('smithy') ||
      name.includes('forge')) {
    inferred.push('forge');
  }

  // Tannery / leatherworker
  if (type === 'tannery' || name.includes('tannery') || name.includes('leather')) {
    inferred.push('leather-workshop');
  }

  // Glassworks / jeweler → Artisan's Workshop
  if (type === 'factory' || name.includes('glasswork') || name.includes('jewel') ||
      name.includes('gemcutter') || name.includes('stonecutter')) {
    inferred.push('artisan-workshop');
  }

  // Alchemy shop / apothecary
  if (name.includes('alchemy') || name.includes('apothecary') || name.includes('alchemist')) {
    inferred.push('alchemy-lab');
  }

  // Bowyer / fletcher
  if (name.includes('bowyer') || name.includes('fletcher')) {
    inferred.push('bowyer-workshop');
  }

  return inferred;
}

/**
 * Union of facility IDs across an array of location-like objects.
 * Each location is passed through getLocationFacilityIds, and the results
 * are deduped. Order of first appearance is preserved.
 *
 * Use case: "party is in Sandpoint — what facilities can they reach?"
 * Caller pre-filters the locations (e.g. by settlement) and passes the
 * flat list here.
 *
 * @param {object[]} locations
 * @returns {string[]}
 */
export function collectFacilityIdsFromLocations(locations) {
  if (!Array.isArray(locations)) return [];
  const ids = new Set();
  for (const loc of locations) {
    for (const id of getLocationFacilityIds(loc)) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Resolve the craft facility IDs available to a given NPC. Tries two
 * strategies, in order:
 *
 *   1. Shop operator match — looks for a location whose `operatorNpc`
 *      equals the NPC's id, with or without a leading "npc-" prefix.
 *      (shops.json uses bare "das-korvut", sandpoint-npcs.json uses
 *      "npc-das-korvut" — we match both.)
 *
 *   2. Location name match — falls back to matching the NPC's .location
 *      string against location.name (case-insensitive).
 *
 * The caller passes a flat array of location-like objects (typically the
 * union of shops, sandpoint.json entries, and sandpointMap.json entries).
 *
 * @param {object} npc — living-world NPC (has .id, .location)
 * @param {object[]} allLocations — canonical location data
 * @returns {string[]}
 */
export function resolveNpcFacilityIds(npc, allLocations = []) {
  if (!npc || !Array.isArray(allLocations) || allLocations.length === 0) {
    return [];
  }

  const npcId = String(npc.id || '').toLowerCase();
  const altId = npcId.replace(/^npc-/, '');

  // Strategy 1: match by operatorNpc
  if (npcId) {
    for (const loc of allLocations) {
      const op = String(loc?.operatorNpc || '').toLowerCase();
      if (op && (op === npcId || op === altId)) {
        const ids = getLocationFacilityIds(loc);
        if (ids.length) return ids;
      }
    }
  }

  // Strategy 2: match by location name
  const locName = String(npc.location || '').trim().toLowerCase();
  if (!locName) return [];
  for (const loc of allLocations) {
    if (String(loc?.name || '').trim().toLowerCase() === locName) {
      const ids = getLocationFacilityIds(loc);
      if (ids.length) return ids;
    }
  }

  return [];
}
