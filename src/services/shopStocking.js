// shopStocking.js
// Living-world shop stocking API: when NPC crafters finish projects, their
// output accumulates here and becomes available at the shop they stock.
//
// Shop registry lives in `src/data/shops.json` and is seeded into
// `worldState.shops` on campaign bootstrap. This module mutates copies only.

/**
 * Initialize a world-state shops map from the static shops registry.
 * Idempotent.
 */
export function bootstrapShops(shopRegistry) {
  if (!shopRegistry || !shopRegistry.shops) return {};
  const out = {};
  for (const [id, shop] of Object.entries(shopRegistry.shops)) {
    out[id] = {
      ...shop,
      inventory: Array.isArray(shop.inventory) ? [...shop.inventory] : [],
      stockedBy: Array.isArray(shop.stockedBy) ? [...shop.stockedBy] : [],
    };
  }
  return out;
}

/**
 * Find which shop (if any) a crafter NPC stocks. Returns shopId or null.
 */
export function findHomeShopForNpc(shopsMap, npcId) {
  if (!shopsMap || !npcId) return null;
  for (const [shopId, shop] of Object.entries(shopsMap)) {
    if (Array.isArray(shop.stockedBy) && shop.stockedBy.includes(npcId)) {
      return shopId;
    }
  }
  return null;
}

/**
 * Find shops in a given settlement.
 */
export function findShopsInSettlement(shopsMap, settlement) {
  if (!shopsMap || !settlement) return [];
  const s = String(settlement).trim().toLowerCase();
  return Object.values(shopsMap).filter(
    (shop) => String(shop.settlement || '').toLowerCase() === s,
  );
}

/**
 * Add a completed item to a shop's inventory. Returns { shopsMap, added }.
 * Pure — takes in a shops map and returns a new one.
 */
export function addCompletedItemToShop(shopsMap, shopId, completion) {
  if (!shopsMap || !shopId || !shopsMap[shopId]) {
    return { shopsMap, added: false, reason: `no shop ${shopId}` };
  }
  if (!completion || !completion.itemName) {
    return { shopsMap, added: false, reason: 'no completion' };
  }
  const shop = shopsMap[shopId];
  const entry = {
    id: completion.projectId || `stock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemName: completion.itemName,
    priceGP: completion.priceGP,
    stockedByNpc: completion.crafterNpcId || null,
    subSkill: completion.subSkill || null,
    masterwork: !!completion.masterwork,
    qty: 1,
    addedAt: completion.completedAt || new Date().toISOString(),
  };
  const nextShops = {
    ...shopsMap,
    [shopId]: {
      ...shop,
      inventory: [...(shop.inventory || []), entry],
    },
  };
  return { shopsMap: nextShops, added: true, entry };
}

/**
 * Remove an inventory entry (e.g. after purchase). Returns { shopsMap, removed }.
 */
export function removeItemFromShop(shopsMap, shopId, entryId) {
  if (!shopsMap || !shopId || !shopsMap[shopId]) {
    return { shopsMap, removed: false };
  }
  const shop = shopsMap[shopId];
  const next = (shop.inventory || []).filter((e) => e.id !== entryId);
  if (next.length === (shop.inventory || []).length) {
    return { shopsMap, removed: false };
  }
  return {
    shopsMap: { ...shopsMap, [shopId]: { ...shop, inventory: next } },
    removed: true,
  };
}

/**
 * Register an NPC as a crafter-supplier for a shop. Idempotent.
 */
export function addCrafterToShop(shopsMap, shopId, npcId) {
  if (!shopsMap || !shopId || !shopsMap[shopId] || !npcId) {
    return shopsMap;
  }
  const shop = shopsMap[shopId];
  const current = shop.stockedBy || [];
  if (current.includes(npcId)) return shopsMap;
  return {
    ...shopsMap,
    [shopId]: { ...shop, stockedBy: [...current, npcId] },
  };
}

/**
 * Summary counts for a shop's inventory (UI helper).
 */
export function summarizeShopInventory(shop) {
  if (!shop || !Array.isArray(shop.inventory)) {
    return { total: 0, masterworkCount: 0, totalPriceGP: 0 };
  }
  let mw = 0;
  let total = 0;
  for (const e of shop.inventory) {
    if (e.masterwork) mw++;
    total += Number(e.priceGP) || 0;
  }
  return {
    total: shop.inventory.length,
    masterworkCount: mw,
    totalPriceGP: total,
  };
}
