/**
 * gearHydrate.js — unify shapes for inventory items so the paperdoll / backpack
 * UI always has weight, price, description, and category regardless of whether
 * an item originated as a bare string ("Backpack"), a template inventory line
 * ("Trail rations (5)"), a weapons.json record, an equipment.json record, or a
 * gear.json record.
 *
 * Bug #52 context: templates.json ships inventory as bare strings. Before this
 * helper, TemplateSelector.buildCharFromTemplate turned each string into
 * { name, quantity, type: 'gear' } with no weight / price / description, so
 * every backpack row rendered as "0 lbs" with no tooltip. The render-time
 * weight display `{item.weight || 0}` had nothing to show.
 */

/**
 * Normalize a weight field (string "2 lbs." / "1 lb." / "½ lb." / "—" or a
 * number) into a plain number of pounds. Returns 0 for missing / unparseable.
 */
export function parseWeightLbs(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-') return 0;
  // Fractional glyphs a handful of gear.json entries use.
  const fracMap = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
  if (fracMap[s[0]] != null && (s[1] === ' ' || !s[1])) {
    const tail = s.slice(1).trim();
    const rest = tail.match(/^([\d.]*)/);
    const base = rest && rest[1] ? parseFloat(rest[1]) : 0;
    return fracMap[s[0]] + (Number.isFinite(base) ? base : 0);
  }
  const m = s.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Parse a trailing "(N)" off an item name where N is a pure integer and
 * return { name, quantity }. Leaves non-integer suffixes alone so
 * "Rope (50 ft.)" stays one entry at qty 1.
 */
export function parseQuantityFromName(rawName) {
  const s = String(rawName || '').trim();
  const m = s.match(/^(.*?)\s*\((\d+)\)\s*$/);
  if (!m) return { name: s, quantity: 1 };
  return { name: m[1].trim(), quantity: parseInt(m[2], 10) };
}

/**
 * Find a gear/equipment record by name across the provided lookup lists.
 * Case-insensitive match on full name. Returns the first hit or null.
 */
export function findGearRecord(name, ...lists) {
  if (!name) return null;
  const target = String(name).toLowerCase();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const hit = list.find(e => e && String(e.name || '').toLowerCase() === target);
    if (hit) return hit;
  }
  return null;
}

/**
 * Hydrate one inventory entry (string OR partial object) into a uniform
 * { name, quantity, weight (number), price, priceGP, description, category,
 *   source, type } shape. Pass one or more lookup lists (e.g. gearData,
 *   equipmentData, weaponsData) in priority order.
 *
 * - If the entry is a string: parse "(N)" into quantity, look the base name
 *   up, merge the record in.
 * - If the entry is already an object: preserve caller fields, look up by
 *   name to fill gaps (weight / price / description / category), and
 *   normalize weight → number.
 */
export function hydrateGearItem(rawEntry, ...lookupLists) {
  const asString = typeof rawEntry === 'string';
  const incoming = asString ? { name: rawEntry } : { ...(rawEntry || {}) };

  // Split "(N)" suffix only when caller didn't already supply a quantity.
  let name = incoming.name || '';
  let quantity = incoming.quantity;
  if (quantity == null) {
    const parsed = parseQuantityFromName(name);
    name = parsed.name;
    quantity = parsed.quantity;
  }

  const record = findGearRecord(name, ...lookupLists) || {};

  const merged = {
    ...record,
    ...incoming,
    name,
    quantity: quantity || 1,
    weight: parseWeightLbs(incoming.weight ?? record.weight),
    price: incoming.price ?? record.price ?? '',
    priceGP: incoming.priceGP ?? record.priceGP ?? null,
    description: incoming.description ?? record.description ?? '',
    category: incoming.category ?? record.category ?? record.type ?? 'gear',
    source: incoming.source ?? record.source ?? '',
    type: incoming.type ?? record.type ?? 'gear',
  };

  return merged;
}
