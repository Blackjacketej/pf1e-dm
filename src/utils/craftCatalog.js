// craftCatalog.js
// Pure helper: given an item with `craftable` metadata, resolve a concrete
// Craft "spec" — sub-skill, DC, raw material cost, and masterwork subtrack info.
//
// The `craftable` field on an item looks like:
//   {
//     subSkill: "Craft (weapons)" | "Craft (armor)" | "Craft (bows)" | "Craft (alchemy)" | ...
//     complexity: "martial weapon" | "leather armor" | "composite longbow" | "acid" | ...
//     acBonus?: number,          // armor/shield items → triggers 10 + AC formula
//     strRating?: number,        // composite bows → triggers 15 + 2×rating formula
//     masterworkable?: boolean,  // whether masterwork component subtrack applies
//     masterworkComponentGP?: number, // override; defaults by category (weapon 300 / armor 150)
//   }
//
// No Dexie, no React. All inputs must be passed in.

import {
  getCraftItemDC,
  getCraftArmorDC,
  getCraftCompositeBowDC,
  getCraftRawMaterialCost,
  CRAFT_ITEM_DCS,
} from './rulesEngine.js';

// --------------------------------------------------------------------
// Sub-skill normalization

const CRAFT_SUBSKILL_ALIASES = {
  alchemy: 'Craft (alchemy)',
  armor: 'Craft (armor)',
  bows: 'Craft (bows)',
  carpentry: 'Craft (carpentry)',
  jewelry: 'Craft (jewelry)',
  leather: 'Craft (leather)',
  locks: 'Craft (locks)',
  stonemasonry: 'Craft (stonemasonry)',
  traps: 'Craft (traps)',
  weapons: 'Craft (weapons)',
};

export function normalizeCraftSubSkill(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (CRAFT_SUBSKILL_ALIASES[low]) return CRAFT_SUBSKILL_ALIASES[low];
  // already in "Craft (x)" form
  const m = /^craft\s*\(\s*([^)]+)\s*\)\s*$/i.exec(s);
  if (m) {
    const inner = m[1].trim().toLowerCase();
    return CRAFT_SUBSKILL_ALIASES[inner] || `Craft (${inner})`;
  }
  return null;
}

// --------------------------------------------------------------------
// Default MW component prices (gp) by sub-skill

const DEFAULT_MW_COMPONENT_GP = {
  'Craft (weapons)': 300,
  'Craft (bows)': 300,
  'Craft (armor)': 150,
};

export function defaultMasterworkComponentGP(subSkill) {
  return DEFAULT_MW_COMPONENT_GP[subSkill] || 0;
}

// --------------------------------------------------------------------
// Core spec resolver

/**
 * Resolve a concrete craft spec from an item's `craftable` metadata + priceGP.
 * Returns:
 *   {
 *     craftable: true,
 *     subSkill: "Craft (weapons)",
 *     dc: 15,
 *     dcFormula: "flat" | "armor" | "composite-bow",
 *     priceGP: 15,
 *     materialsGP: 5,         // 1/3 priceGP
 *     masterworkable: false,
 *     masterworkDC: 20,       // only if masterworkable
 *     masterworkComponentGP: 300, // only if masterworkable
 *   }
 * or { craftable: false, reason: string } if the item can't be routed.
 */
export function getCraftSpec(item) {
  if (!item || typeof item !== 'object') {
    return { craftable: false, reason: 'no item given' };
  }
  const meta = item.craftable;
  if (!meta || typeof meta !== 'object') {
    return { craftable: false, reason: 'no craftable metadata on item' };
  }

  const subSkill = normalizeCraftSubSkill(meta.subSkill);
  if (!subSkill) {
    return { craftable: false, reason: `unknown subSkill "${meta.subSkill}"` };
  }

  const priceGP = Number(item.priceGP ?? meta.priceGP ?? 0);
  if (!Number.isFinite(priceGP) || priceGP <= 0) {
    return { craftable: false, reason: 'missing or non-positive priceGP' };
  }

  // Resolve DC via one of three paths:
  let dc = null;
  let dcFormula = 'flat';

  if (Number.isFinite(meta.acBonus)) {
    dc = getCraftArmorDC(meta.acBonus);
    dcFormula = 'armor';
  } else if (Number.isFinite(meta.strRating)) {
    dc = getCraftCompositeBowDC(meta.strRating);
    dcFormula = 'composite-bow';
  } else if (meta.complexity) {
    dc = getCraftItemDC(meta.complexity);
    dcFormula = 'flat';
  }

  if (dc === null || dc === undefined) {
    return {
      craftable: false,
      reason: `could not resolve DC from metadata ${JSON.stringify(meta)}`,
    };
  }

  const materialsGP = getCraftRawMaterialCost(priceGP);
  const masterworkable = !!meta.masterworkable;
  const out = {
    craftable: true,
    subSkill,
    dc,
    dcFormula,
    priceGP,
    materialsGP,
    masterworkable,
  };

  if (masterworkable) {
    out.masterworkDC = 20;
    out.masterworkComponentGP = Number.isFinite(meta.masterworkComponentGP)
      ? meta.masterworkComponentGP
      : defaultMasterworkComponentGP(subSkill);
  }
  return out;
}

// --------------------------------------------------------------------
// Filters + lookups across an item catalog

/**
 * Given an array of items, return only those that are craftable.
 */
export function filterCraftableItems(allItems) {
  if (!Array.isArray(allItems)) return [];
  return allItems.filter(
    (it) => it && it.craftable && normalizeCraftSubSkill(it.craftable.subSkill),
  );
}

/**
 * Given an array of items and a sub-skill, return craftable items for that sub-skill.
 */
export function filterCraftableBySubSkill(allItems, subSkill) {
  const want = normalizeCraftSubSkill(subSkill);
  if (!want) return [];
  return filterCraftableItems(allItems).filter(
    (it) => normalizeCraftSubSkill(it.craftable.subSkill) === want,
  );
}

/**
 * Given an array of items, return the list of distinct sub-skills covered.
 */
export function getCoveredSubSkills(allItems) {
  const set = new Set();
  for (const it of filterCraftableItems(allItems)) {
    const s = normalizeCraftSubSkill(it.craftable.subSkill);
    if (s) set.add(s);
  }
  return [...set].sort();
}

/**
 * Case-insensitive name lookup.
 */
export function findItemByName(allItems, name) {
  if (!Array.isArray(allItems) || !name) return null;
  const n = String(name).trim().toLowerCase();
  return (
    allItems.find((it) => String(it?.name || '').trim().toLowerCase() === n) ||
    null
  );
}

/**
 * Flat list of all known Craft sub-skills (derived from CRB).
 */
export function listCraftSubSkills() {
  return Object.values(CRAFT_SUBSKILL_ALIASES).sort();
}

// --------------------------------------------------------------------
// Registry-based lookup (for craftableItems.json)

/**
 * Normalize an item name key for registry lookup.
 */
function keyOf(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * Look up a craft spec by item name from a registry (e.g. craftableItems.json).
 * Registry shape: { items: { "longsword": {subSkill, complexity, priceGP, ...}, ... } }
 *
 * Returns the same shape as `getCraftSpec`.
 */
export function getCraftSpecByName(name, registry) {
  if (!registry || !registry.items) {
    return { craftable: false, reason: 'no registry provided' };
  }
  const key = keyOf(name);
  if (!key) return { craftable: false, reason: 'empty name' };
  const meta = registry.items[key];
  if (!meta) return { craftable: false, reason: `not in registry: ${name}` };
  // Synthesize an item + craftable field and delegate to getCraftSpec.
  return getCraftSpec({
    name,
    priceGP: meta.priceGP,
    craftable: {
      subSkill: meta.subSkill,
      complexity: meta.complexity,
      acBonus: meta.acBonus,
      strRating: meta.strRating,
      masterworkable: meta.masterworkable,
      masterworkComponentGP: meta.masterworkComponentGP,
    },
  });
}

/**
 * List all registered item names.
 */
export function listRegistryItems(registry) {
  if (!registry || !registry.items) return [];
  return Object.keys(registry.items).sort();
}

/**
 * List items filtered by sub-skill.
 */
export function listRegistryItemsBySubSkill(registry, subSkill) {
  const want = normalizeCraftSubSkill(subSkill);
  if (!want || !registry || !registry.items) return [];
  return Object.entries(registry.items)
    .filter(([_, v]) => normalizeCraftSubSkill(v.subSkill) === want)
    .map(([k]) => k)
    .sort();
}

// Re-export for test convenience
export { CRAFT_SUBSKILL_ALIASES, CRAFT_ITEM_DCS };
