/**
 * shopService.js — Pathfinder 1e–accurate settlement shop system
 *
 * Implements: base value / purchase limit, magic item availability by settlement size,
 * merchant-specific inventories, settlement qualities, haggling, special orders,
 * spellcasting services, inventory refresh, and item rarity classification.
 */

import settlementsData from '../data/settlements.json';
import psrdEquipment from '../data/equipment.json';
import weaponsData from '../data/weapons.json';
import gearData from '../data/gear.json';
import magicItemsData from '../data/magicItems.json';
import spellsData from '../data/spells.json';
import {
  getMerchantSkills,
  attitudeBonus,
  attitudeBaseDiscount,
  refusesService,
  biasPoolBySpecialty,
  matchSpecialty,
} from './merchantSkills';

// ─── Dice helpers ────────────────────────────────────────────────
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function rollDice(notation) {
  // "3d4" → roll 3 d4s
  const m = notation.match(/^(\d+)d(\d+)$/);
  if (!m) return 0;
  let total = 0;
  for (let i = 0; i < parseInt(m[1]); i++) total += rollDie(parseInt(m[2]));
  return total;
}

// ─── Master item database ────────────────────────────────────────
let MASTER_ITEMS = null;

function buildMasterItems() {
  if (MASTER_ITEMS) return MASTER_ITEMS;
  const items = [];
  const seen = new Set();
  const add = (item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  // Weapons
  weaponsData.forEach(w => {
    add({
      name: w.name,
      price: w.price || 0,
      weight: w.weight || 0,
      category: w.category === 'ammo' ? 'ammo' : 'weapon',
      subcategory: w.category,
      proficiency: w.proficiency,
      stat: w.category !== 'ammo' ? `${w.dmg} ${w.crit}` : '',
      desc: w.category !== 'ammo'
        ? `${w.proficiency} ${w.category}. ${w.type} damage.`
        : 'Ammunition',
      isMagic: false,
      tier: 'mundane',
      source: 'CRB',
    });
    // Masterwork version
    if (w.category !== 'ammo' && w.price > 0) {
      add({
        name: `Masterwork ${w.name}`,
        price: (w.price || 0) + 300,
        weight: w.weight || 0,
        category: 'weapon',
        subcategory: w.category,
        proficiency: w.proficiency,
        stat: `${w.dmg} ${w.crit} (+1 attack)`,
        desc: `Masterwork ${w.proficiency} ${w.category}. ${w.type} damage. +1 enhancement bonus to attack rolls.`,
        isMagic: false,
        tier: 'mundane',
        source: 'CRB',
      });
    }
  });

  // PSRD Equipment
  (Array.isArray(psrdEquipment) ? psrdEquipment : []).forEach(item => {
    if (!item.name) return;
    const price = item.priceGP || 0;
    const isMagic = price > 300 && (item.aura || item.cl);
    let tier = 'mundane';
    if (isMagic) {
      if (price <= 4000) tier = 'minor';
      else if (price <= 16000) tier = 'medium';
      else tier = 'major';
    }
    const isShield = item.name.toLowerCase().includes('shield') || (item.slot || '').toLowerCase().includes('shield');
    add({
      name: item.name,
      price,
      weight: parseFloat(item.weight) || 0,
      category: isShield ? 'shield' : (item.category || 'gear'),
      subcategory: item.slot || item.category,
      stat: item.slot && item.slot !== 'none' ? `Slot: ${item.slot}` : (item.aura || ''),
      desc: item.description || '',
      isMagic,
      tier,
      aura: item.aura,
      cl: item.cl,
      source: item.source || 'PSRD',
    });
  });

  // Gear.json supplements
  (Array.isArray(gearData) ? gearData : []).forEach(item => {
    if (!item.name) return;
    let price = 0;
    if (typeof item.price === 'number') price = item.price;
    else if (typeof item.price === 'string') {
      const m = item.price.match(/([\d,]+(?:\.\d+)?)/);
      if (m) price = parseFloat(m[1].replace(/,/g, ''));
    }
    const cat = item.type || item.category || 'gear';
    const catMap = {
      gear: 'gear', alchemical: 'alchemical', potion: 'potion', scroll: 'scroll',
      wand: 'wand', ring: 'ring', wondrous: 'wondrous', rod: 'rod', staff: 'staff',
      armor: 'armor', weapon: 'weapon',
    };
    add({
      name: item.name,
      price,
      weight: item.weight || 0,
      category: catMap[cat] || 'gear',
      subcategory: cat,
      stat: item.slot && item.slot !== 'none' ? `Slot: ${item.slot}` : '',
      desc: item.description || '',
      isMagic: ['wondrous', 'ring', 'rod', 'staff', 'wand'].includes(cat) && price > 50,
      tier: price <= 300 ? 'mundane' : price <= 4000 ? 'minor' : price <= 16000 ? 'medium' : 'major',
      source: 'CRB',
    });
  });

  // Magic Items
  magicItemsData.forEach(mi => {
    let price = 0;
    const pm = mi.price?.match?.(/(\d[\d,]*)\s*gp/);
    if (pm) price = parseInt(pm[1].replace(/,/g, ''));
    if (price === 0) return;
    const catMap = { wondrous: 'wondrous', rod: 'rod', staff: 'staff', ring: 'ring' };
    const cat = catMap[mi.type] || 'wondrous';
    add({
      name: mi.name,
      price,
      weight: 0,
      category: cat,
      subcategory: mi.slot || mi.type || 'wondrous',
      stat: mi.slot && mi.slot !== 'none' ? `Slot: ${mi.slot}` : (mi.aura || ''),
      desc: mi.description || '',
      isMagic: true,
      tier: price <= 4000 ? 'minor' : price <= 16000 ? 'medium' : 'major',
      aura: mi.aura,
      cl: mi.cl,
      source: 'CRB',
    });
  });

  MASTER_ITEMS = items;
  return items;
}

// ─── Settlement helpers ──────────────────────────────────────────
export function getSettlement(id) {
  return settlementsData.settlements[id] || null;
}

export function listSettlements() {
  return Object.entries(settlementsData.settlements).map(([id, s]) => ({
    id,
    name: s.name,
    type: s.type,
    population: s.population,
    baseValue: s.baseValue,
    chapter: s.chapter,
  }));
}

export function getSettlementType(typeId) {
  return settlementsData.settlementTypes[typeId] || null;
}

function getEffectiveBaseValue(settlement) {
  let base = settlement.baseValue;
  (settlement.qualities || []).forEach(q => {
    const qual = settlementsData.settlementQualities[q];
    if (qual?.baseValueMod) base = Math.floor(base * (1 + qual.baseValueMod));
  });
  return base;
}

function getEffectivePurchaseLimit(settlement) {
  let limit = settlement.purchaseLimit;
  (settlement.qualities || []).forEach(q => {
    const qual = settlementsData.settlementQualities[q];
    if (qual?.purchaseLimitMod) limit = Math.floor(limit * (1 + qual.purchaseLimitMod));
  });
  return limit;
}

// ─── Merchant inventory generation ───────────────────────────────
const SHOP_CATEGORY_MAP = {
  generalStore: ['gear', 'alchemical', 'ammo'],
  blacksmith: ['weapon', 'armor', 'shield'],
  magicShop: ['wondrous', 'ring', 'rod', 'staff', 'wand', 'scroll', 'potion'],
  alchemist: ['alchemical', 'potion'],
  temple: ['potion', 'scroll'],
  tailor: ['gear'],
  jeweler: ['ring', 'wondrous'],
  stable: ['gear'],
  bookshop: ['scroll', 'gear'],
  blackMarket: ['weapon', 'wondrous', 'potion', 'ring', 'scroll'],
};

/**
 * Generate a merchant's inventory based on settlement rules.
 * Uses a seed (date-based) so inventory is consistent within a "week" of game time
 * but refreshes periodically.
 */
export function generateMerchantInventory(settlementId, merchantId, options = {}) {
  const settlement = getSettlement(settlementId);
  if (!settlement) return { items: [], merchant: null, settlement: null };

  const merchant = (settlement.merchants || []).find(m => m.id === merchantId);
  if (!merchant) return { items: [], merchant: null, settlement };

  const shopDef = settlementsData.shopTypes[merchant.shopType];
  if (!shopDef) return { items: [], merchant, settlement };

  const allItems = buildMasterItems();
  const baseValue = getEffectiveBaseValue(settlement);
  const maxShopValue = baseValue * (shopDef.maxItemValue || 1.0);
  const categories = SHOP_CATEGORY_MAP[merchant.shopType] || shopDef.categories || [];
  const priceModifier = merchant.priceModifier || 1.0;
  const shopMarkup = shopDef.priceMarkup || 1.0;

  // Seed-based randomization for inventory consistency
  const seed = options.seed || Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7)); // weekly refresh
  const rng = seededRandom(seed + hashString(merchantId));

  // 1. Mundane items: all items in matching categories below base value (75% available)
  const rawMundanePool = allItems.filter(item =>
    !item.isMagic &&
    categories.some(c => item.category === c || item.subcategory === c) &&
    item.price <= baseValue &&
    item.price > 0
  );

  // Specialty bias: duplicate matched items so the 75% filter and later
  // random sampling are more likely to keep them. We de-dupe at the end.
  const specialties = merchant.specialties || [];
  const mundanePool = biasPoolBySpecialty(rawMundanePool, specialties, 2);

  // The base mundane roster: items that passed the 75% availability roll.
  // Kept separate from guaranteed specialty items so the downstream stockMult
  // trim can't accidentally strip every masterwork weapon out of a weapons
  // specialist's shop.
  const baseMundaneSeen = new Set();
  const baseMundaneItems = [];
  for (const item of mundanePool) {
    if (baseMundaneSeen.has(item.name)) continue;
    if (rng() < 0.75) {
      baseMundaneSeen.add(item.name);
      baseMundaneItems.push(item);
    }
  }

  // Guarantee a small "always in stock" tier for specialty-matched items
  // so Savah always has at least *some* masterwork weapons on hand. Cap
  // the guarantee so an open-ended specialty string (e.g. "weapons")
  // doesn't flood the shop with every masterwork weapon in the book.
  const MAX_SPECIALTY_GUARANTEE = 8;
  const guaranteedSeen = new Set(baseMundaneSeen);
  const guaranteedMundane = [];
  for (const item of rawMundanePool) {
    if (guaranteedMundane.length >= MAX_SPECIALTY_GUARANTEE) break;
    if (guaranteedSeen.has(item.name)) continue;
    if (matchSpecialty(item, specialties)) {
      guaranteedSeen.add(item.name);
      guaranteedMundane.push(item);
    }
  }

  // 2. Magic items: roll for availability per settlement type
  const typeData = getSettlementType(settlement.type);
  const magicPool = allItems.filter(item =>
    item.isMagic &&
    categories.some(c => item.category === c || item.subcategory === c) &&
    item.price <= maxShopValue
  );

  // Bias the magic pool by specialty too — "minor wondrous items" will
  // double up on tier=minor wondrous entries, making Vorvashali's stall
  // actually feel like a minor-wondrous specialist.
  const minorPool = biasPoolBySpecialty(magicPool.filter(i => i.tier === 'minor'), specialties, 2);
  const mediumPool = biasPoolBySpecialty(magicPool.filter(i => i.tier === 'medium'), specialties, 2);
  const majorPool = biasPoolBySpecialty(magicPool.filter(i => i.tier === 'major'), specialties, 2);

  const magicBonus = (merchant.stockBonus || 0) + (shopDef.magicItemBonus || 0);
  const minorCount = typeData ? rollDiceSeeded(typeData.minorItems, rng) + Math.min(magicBonus, 3) : 0;
  const mediumCount = typeData ? rollDiceSeeded(typeData.mediumItems, rng) + Math.floor(magicBonus / 2) : 0;
  const majorCount = typeData ? rollDiceSeeded(typeData.majorItems, rng) : 0;

  // Sample magic items uniquely. pickUniqueRandom keeps drawing from the
  // biased pool, skipping names already picked, until either the target
  // count is reached or the unique-name ceiling is hit. This avoids the
  // old pickRandom + dedup-after pattern, which under-delivered whenever
  // a specialty-boosted item was picked twice.
  const magicItems = [
    ...pickUniqueRandom(minorPool, minorCount, rng),
    ...pickUniqueRandom(mediumPool, mediumCount, rng),
    ...pickUniqueRandom(majorPool, majorCount, rng),
  ];

  // 3. Stock multiplier — thin out inventory for specialized shops. Apply
  // the trim to the *base* mundane list only; specialty guarantees are
  // appended afterward so they always survive. A weapons specialist should
  // never lose all its specialty stock just because the shopType's
  // stockMultiplier trimmed the pool.
  const stockMult = shopDef.stockMultiplier || 1.0;
  const stockBonus = merchant.stockBonus || 0;
  const maxBaseMundane = Math.max(10, Math.floor(baseMundaneItems.length * stockMult) + stockBonus * 3);
  const trimmedBaseMundane = baseMundaneItems.length > maxBaseMundane
    ? pickRandom(baseMundaneItems, maxBaseMundane, rng)
    : baseMundaneItems;
  const finalMundane = [...trimmedBaseMundane, ...guaranteedMundane];

  // 4. Combine and apply pricing
  const inventory = [...finalMundane, ...magicItems].map(item => ({
    ...item,
    shopPrice: Math.ceil(item.price * priceModifier * shopMarkup),
    sellPrice: Math.floor(item.price * 0.5 * (shopDef.sellMarkup || 1.0)),
    available: true,
  }));

  // Sort: mundane by price, then magic by tier/price
  inventory.sort((a, b) => {
    const tierOrder = { mundane: 0, minor: 1, medium: 2, major: 3 };
    const ta = tierOrder[a.tier] || 0;
    const tb = tierOrder[b.tier] || 0;
    if (ta !== tb) return ta - tb;
    return a.shopPrice - b.shopPrice;
  });

  return {
    items: inventory,
    merchant,
    merchantSkills: getMerchantSkills(merchant),
    settlement,
    baseValue,
    purchaseLimit: getEffectivePurchaseLimit(settlement),
    maxShopValue: Math.floor(maxShopValue),
    magicItemCounts: { minor: minorCount, medium: mediumCount, major: majorCount },
  };
}

// Re-export the merchant helper so callers outside this module can use it
// without reaching into ./merchantSkills directly. We export the already
// imported binding rather than re-declaring a new binding via
// `export { getMerchantSkills } from './merchantSkills'`, which would
// collide with the top-of-file import under strict ES module rules.
export { getMerchantSkills };

// ─── Spellcasting services ───────────────────────────────────────
export function getSpellcastingServices(settlementId, merchantId) {
  const settlement = getSettlement(settlementId);
  if (!settlement) return [];

  const merchant = (settlement.merchants || []).find(m => m.id === merchantId);
  const maxLevel = merchant?.spellcasterLevel || settlement.spellcasting || 0;

  return settlementsData.spellcastingServices.commonServices
    .filter(s => s.level <= maxLevel)
    .map(s => ({ ...s }));
}

export function getSpellcastingCost(spellLevel) {
  return settlementsData.spellcastingServices.costs[spellLevel] || 0;
}

// ─── Haggling ────────────────────────────────────────────────────
/**
 * Haggle over an item price. Per PF1e settlement rules:
 * - Diplomacy checks to adjust NPC attitudes use the Society modifier
 * - Bluff checks use the Corruption modifier
 * - We apply the better of the two as a settlement bonus to the haggle roll
 *
 * Phase 6 extensions:
 * - `merchant` (optional): when supplied, the merchant's Sense Motive (for
 *   Bluff) or ½ Diplomacy (for Diplomacy) raises the DC instead of using
 *   the flat 15. This turns the haggle into a proper opposed-style check.
 * - `attitude` (optional): the merchant's current attitude toward the
 *   party (CRB p.94). Hostile merchants refuse to deal. Others shift the
 *   PC's total via `attitudeBonus` and apply a baseline price delta via
 *   `attitudeBaseDiscount` (+markup for Unfriendly, discount for
 *   Friendly/Helpful) *before* the roll.
 *
 * @param {number} diplomacyMod - PC's Diplomacy or Bluff modifier
 * @param {number} itemPrice - The item's shop price
 * @param {object} [settlementMods] - Settlement modifier object {corruption, society, economy, ...}
 * @param {string} [skill] - Which skill is being used: 'diplomacy' or 'bluff'
 * @param {object} [merchant] - Merchant record (optional); see getMerchantSkills
 * @param {string} [attitude] - Current merchant attitude ('hostile' | 'unfriendly' | 'indifferent' | 'friendly' | 'helpful')
 */
export function resolveHaggle(diplomacyMod, itemPrice, settlementMods, skill, merchant, attitude) {
  const baseDC = settlementsData.haggling.baseDC;
  const roll = rollDie(20);

  // Merchant opposed skill: Bluff is opposed by Sense Motive; Diplomacy
  // (as a haggle attitude shift) is opposed by half the merchant's own
  // Diplomacy, rounded down. The DC floor stays at baseDC so low-skill
  // shopkeepers don't undercut the CRB's stated DC 15.
  let merchantOpposed = 0;
  let merchantOpposedLabel = null;
  if (merchant) {
    const mSkills = getMerchantSkills(merchant);
    if (skill === 'bluff') {
      merchantOpposed = Math.max(0, mSkills.senseMotive || 0);
      merchantOpposedLabel = `Sense Motive ${merchantOpposed >= 0 ? '+' : ''}${merchantOpposed}`;
    } else {
      merchantOpposed = Math.max(0, Math.floor((mSkills.diplomacy || 0) / 2));
      merchantOpposedLabel = `½ Diplomacy ${merchantOpposed >= 0 ? '+' : ''}${merchantOpposed}`;
    }
  }
  const dc = baseDC + merchantOpposed;

  // Hostile merchants refuse to deal in good faith, regardless of roll.
  // Return null for roll/total so UI can tell "refused" apart from "rolled
  // a natural 1", and saved=0 (there is no negotiation at all).
  if (attitude && refusesService(attitude)) {
    return {
      success: false,
      refused: true,
      attitude,
      attitudeBonus: attitudeBonus(attitude),
      attitudePriceDelta: -attitudeBaseDiscount(attitude),
      roll: null,
      skillMod: diplomacyMod,
      settlementBonus: 0,
      merchantOpposed,
      merchantOpposedLabel,
      total: null,
      dc,
      message: 'The merchant glares and waves you off. Improve their attitude first.',
      discount: 0,
      finalPrice: itemPrice,
      saved: 0,
    };
  }

  // Apply the appropriate settlement modifier per PF1e rules
  // Diplomacy (adjust attitudes) → Society modifier; Bluff (deceive) → Corruption modifier
  let settlementBonus = 0;
  if (settlementMods) {
    if (skill === 'bluff') {
      settlementBonus = settlementMods.corruption || 0;
    } else {
      // Default to Diplomacy → Society modifier
      settlementBonus = settlementMods.society || 0;
    }
  }

  // Attitude bonus applies to the PC's haggle total (a Friendly merchant
  // rounds numbers up in your favor; an Unfriendly merchant does the
  // opposite). Hostile is already handled above.
  const attBonus = attitude ? attitudeBonus(attitude) : 0;
  const total = roll + diplomacyMod + settlementBonus + attBonus;

  const maxDiscount = settlementsData.haggling.maxDiscount;
  const perFive = settlementsData.haggling.perFiveOverDC;

  // Attitude base discount is applied *before* the roll-based discount.
  // Friendly +5% / Helpful +10% even on failure; Unfriendly −25% markup.
  const attBaseDiscount = attitude ? attitudeBaseDiscount(attitude) : 0;

  if (total < dc) {
    // Even on failure, attitude still shifts the price floor (a Helpful
    // merchant won't suddenly gouge the party just because the PC rolled
    // badly; an Unfriendly one won't drop below markup).
    const failPrice = Math.max(1, Math.ceil(itemPrice * (1 - attBaseDiscount)));
    return {
      success: false,
      attitude: attitude || null,
      attitudeBonus: attBonus,
      attitudePriceDelta: -attBaseDiscount,
      roll,
      skillMod: diplomacyMod,
      settlementBonus,
      merchantOpposed,
      merchantOpposedLabel,
      total,
      dc,
      message: attBaseDiscount < 0
        ? `The merchant is cold and marks the price up ${Math.round(-attBaseDiscount * 100)}%.`
        : attBaseDiscount > 0
          ? `You fail to haggle further, but they still honor their ${Math.round(attBaseDiscount * 100)}% goodwill discount.`
          : 'The merchant is offended by your offer. No deal today.',
      discount: attBaseDiscount > 0 ? attBaseDiscount : 0,
      finalPrice: failPrice,
      // If attitude marked the price up, saved goes negative — clamp to 0
      // so the UI never displays "You saved -12 gp". The markup still
      // shows up in finalPrice (and in attitudePriceDelta), which is
      // where the UI should be looking anyway.
      saved: Math.max(0, itemPrice - failPrice),
    };
  }

  const overDC = total - dc;
  // The roll-based discount stacks on top of the attitude baseline, but
  // the combined discount is still capped at 25% (the original ceiling).
  const rollDiscount = maxDiscount + Math.floor(overDC / 5) * perFive;
  const discount = Math.min(Math.max(0, attBaseDiscount) + rollDiscount, 0.25);
  const finalPrice = Math.max(1, Math.ceil(itemPrice * (1 - discount)));

  return {
    success: true,
    attitude: attitude || null,
    attitudeBonus: attBonus,
    attitudePriceDelta: -attBaseDiscount,
    roll,
    skillMod: diplomacyMod,
    settlementBonus,
    merchantOpposed,
    merchantOpposedLabel,
    total,
    dc,
    discount,
    message: `You negotiate a ${Math.round(discount * 100)}% discount!`,
    finalPrice,
    saved: Math.max(0, itemPrice - finalPrice),
  };
}

// ─── Special orders ──────────────────────────────────────────────
export function estimateSpecialOrder(itemName, itemPrice, isMasterwork, enchantBonus) {
  const cfg = settlementsData.specialOrders;
  let days = cfg.baseDays + Math.floor(itemPrice / 1000) * cfg.perThousandGP;
  if (isMasterwork) days += cfg.mastworkDays;
  if (enchantBonus) days += enchantBonus * cfg.enchantmentDaysPerBonus;
  const markup = cfg.markup;
  return {
    itemName,
    estimatedDays: days,
    estimatedPrice: Math.ceil(itemPrice * markup),
    markup,
    description: `Special order: ${itemName}. ~${days} days, ${Math.ceil(itemPrice * markup)} gp (${Math.round((markup - 1) * 100)}% markup).`,
  };
}

// ─── Item search across all settlements ──────────────────────────
export function searchItemGlobally(itemName) {
  const items = buildMasterItems();
  const lower = itemName.toLowerCase();
  return items.filter(i => i.name.toLowerCase().includes(lower)).slice(0, 20);
}

// ─── Category helpers for UI ─────────────────────────────────────
export function getShopCategories(shopType) {
  const shopDef = settlementsData.shopTypes[shopType];
  if (!shopDef) return [];
  return SHOP_CATEGORY_MAP[shopType] || shopDef.categories || [];
}

export function getShopTypeInfo(shopType) {
  return settlementsData.shopTypes[shopType] || null;
}

export function getAllShopTypes() {
  return settlementsData.shopTypes;
}

export function getMagicItemTiers() {
  return settlementsData.magicItemTiers;
}

// ─── Location mapping ────────────────────────────────────────────
export function resolveSettlementFromLocation(locationString) {
  if (!locationString) return null;
  const mapping = settlementsData.locationMapping || {};
  // Direct match
  if (mapping[locationString] !== undefined) return mapping[locationString];
  // Partial match — check if the location starts with a known settlement name
  for (const [key, val] of Object.entries(mapping)) {
    if (locationString.startsWith(key) || key.startsWith(locationString)) return val;
  }
  // Fuzzy — check if any settlement name appears in the location string
  for (const [id, s] of Object.entries(settlementsData.settlements)) {
    if (locationString.toLowerCase().includes(s.name.toLowerCase())) return id;
  }
  return null; // Wilderness / dungeon — no settlement access
}

// ─── Tavern data ────────────────────────────────────────────────
export function getTaverns(settlementId) {
  return (settlementsData.taverns || {})[settlementId] || [];
}

export function getFoodAndDrink() {
  return settlementsData.foodAndDrink || {};
}

export function getLodgingPrices() {
  return settlementsData.lodging || {};
}

export function getCostOfLiving() {
  return settlementsData.costOfLiving || {};
}

export function getHirelings() {
  return settlementsData.hirelings || {};
}

export function getTownServices() {
  return settlementsData.services || {};
}

// ─── Utility: seeded PRNG ────────────────────────────────────────
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 0) / 0x7fffffff;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function rollDiceSeeded(notation, rng) {
  if (!notation || notation === '0') return 0;
  const m = notation.match(/^(\d+)d(\d+)$/);
  if (!m) return 0;
  let total = 0;
  for (let i = 0; i < parseInt(m[1]); i++) {
    total += Math.floor(rng() * parseInt(m[2])) + 1;
  }
  return total;
}

function pickRandom(arr, count, rng) {
  if (arr.length <= count) return [...arr];
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

// Sample up to `count` unique-by-name items from a biased pool. A biased
// pool contains duplicate references so matched items are more likely to
// be drawn, but the output must de-duplicate so the same item doesn't
// appear on the shelf three times. Unlike `pickRandom(...).filter()`, this
// keeps drawing until it reaches the target count or exhausts the pool —
// so a specialty boost never causes the shop to underfill.
function pickUniqueRandom(pool, count, rng) {
  if (!Array.isArray(pool) || pool.length === 0 || count <= 0) return [];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const seen = new Set();
  const out = [];
  for (const item of shuffled) {
    if (out.length >= count) break;
    const key = item?.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export default {
  getSettlement,
  listSettlements,
  getSettlementType,
  generateMerchantInventory,
  getSpellcastingServices,
  getSpellcastingCost,
  resolveHaggle,
  estimateSpecialOrder,
  searchItemGlobally,
  getShopCategories,
  getShopTypeInfo,
  getAllShopTypes,
  getMagicItemTiers,
  resolveSettlementFromLocation,
  getTaverns,
  getFoodAndDrink,
  getLodgingPrices,
  getCostOfLiving,
  getHirelings,
  getTownServices,
};
