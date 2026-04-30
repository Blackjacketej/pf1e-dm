// ─────────────────────────────────────────────────────
// Appraise metadata inference
// ─────────────────────────────────────────────────────
//
// This helper derives the five Appraise-relevant fields from an arbitrary
// item shape:
//
//   - actualValue       true gp value used for success display + range-band
//   - isMagic           whether the item radiates a magical aura (CRB
//                       success-by-5 reveals this PRESENCE, not the abilities)
//   - rarity            'common' | 'rare' | 'exotic' | 'magical' → default DC
//   - smallOrDetailed   enables magnifying glass +2 (CRB Equipment p.162)
//   - valuedByWeight    enables merchant's scale +2 (CRB Equipment p.162)
//
// The helper is a PURE function of the input item. It does not mutate. It
// accepts the existing equipment.json shape (name/category/priceGP/aura/cl/
// description) as well as any loot-drop shape the game loop invents at
// runtime. Unknown fields default conservatively (common rarity, no magic,
// no equipment-bonus flags).
//
// Heuristics are named and explicit so they can be tuned without breaking
// anything downstream. See tests in test_appraise_metadata_*.mjs for the
// expected behavior of each rule.

// ── Name-pattern regexes ─────────────────────────────
// Small or highly detailed items — CRB p.162: magnifying glass "+2 circumstance
// bonus on Appraise checks involving any item that is small or highly detailed".
// The CRB Ch.12 treasure taxonomy (gems, minor/medium/major jewelry) and the
// Equipment chapter together imply: gemstones (any named variety), jewelry
// pieces, small tokens, signet rings, cameos, etc.
const GEM_PATTERN = /\b(gem|gemstone|diamond|ruby|emerald|sapphire|pearl|topaz|opal|amethyst|jade|onyx|garnet|amber|quartz|agate|lapis\s*lazuli|obsidian|citrine|peridot|jasper|zircon|tigereye|moonstone|bloodstone|carnelian|chalcedony|alexandrite|azurite|aquamarine|tourmaline|spinel|coral|ivory\s*carving|cameo)\b/i;

const JEWELRY_PATTERN = /\b(ring|amulet|necklace|brooch|circlet|earring|bracelet|locket|medallion|pendant|tiara|bangle|choker|torc|signet|crown|diadem|anklet)\b/i;

const ART_OBJECT_PATTERN = /\b(statue|statuette|sculpture|painting|tapestry|vase|urn|idol|figurine|bust|portrait|artwork|chalice|goblet|plate\s*(of\s*silver|of\s*gold)|silverware|candelabra|reliquary)\b/i;

// Items valued by weight — CRB p.162: merchant's scale "+2 circumstance bonus
// on Appraise checks involving items that are valued by weight, including
// anything made of precious metals". Coins, ingots, bullion, raw ore/metal.
const WEIGHT_PATTERN = /\b(coin(?:s|age)?|bullion|ingot|ore|nugget|bar\s*of\s*(?:gold|silver|platinum|copper|electrum)|gold\s*bar|silver\s*bar|platinum\s*bar|copper\s*bar|dust\s*of\s*(?:gold|silver|platinum))\b/i;

// Raw precious-metal materials sold by weight (CRB Equipment ch.6: adamantine,
// mithral, cold iron, alchemical silver, darkwood as raw materials).
const RAW_MATERIAL_PATTERN = /^(adamantine|mithral|mithril|darkwood|dragonhide|alchemical\s*silver|cold\s*iron)$/i;

const MASTERWORK_PATTERN = /\bmasterwork\b/i;

// ── Price parsing ────────────────────────────────────
// Some equipment.json entries store price as a string ("3 GP-30 gp" or
// "500 gp") with priceGP sometimes 0 for range-priced items. Extract the
// first numeric token as a fallback.
function parsePriceGP(priceStr) {
  if (typeof priceStr !== 'string') return 0;
  const m = priceStr.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : 0;
}

// ── Main inference ───────────────────────────────────
export function computeAppraiseMetadata(item) {
  if (!item || typeof item !== 'object') {
    return {
      actualValue: 0,
      isMagic: false,
      rarity: 'common',
      smallOrDetailed: false,
      valuedByWeight: false,
    };
  }

  const name = typeof item.name === 'string' ? item.name : '';
  const category = typeof item.category === 'string' ? item.category : '';
  const description = typeof item.description === 'string' ? item.description : '';
  const aura = typeof item.aura === 'string' ? item.aura : '';
  const cl = item.cl != null ? item.cl : null;

  // actualValue: prefer explicit field, then priceGP, then parse string price.
  let actualValue = 0;
  if (typeof item.actualValue === 'number' && Number.isFinite(item.actualValue)) {
    actualValue = item.actualValue;
  } else if (typeof item.priceGP === 'number' && Number.isFinite(item.priceGP) && item.priceGP > 0) {
    actualValue = item.priceGP;
  } else if (typeof item.gold === 'number' && Number.isFinite(item.gold)) {
    actualValue = item.gold;
  } else if (typeof item.price === 'string') {
    actualValue = parsePriceGP(item.price);
  } else if (typeof item.value === 'number' && Number.isFinite(item.value)) {
    actualValue = item.value;
  }

  // isMagic: explicit flag wins; otherwise infer from aura / cl / magic categories.
  let isMagic;
  if (typeof item.isMagic === 'boolean') {
    isMagic = item.isMagic;
  } else if (aura && aura.trim().length > 0) {
    isMagic = true;
  } else if (cl != null && cl !== '' && cl !== '—') {
    isMagic = true;
  } else if (/^(ring|staff|rod|wand|scroll|potion)$/i.test(category)) {
    // Categories in equipment.json that are inherently magical.
    isMagic = true;
  } else if (/\b(of\s+the?\s+\w+|\+\d+)\b/i.test(name) && actualValue >= 1000) {
    // Named magic items like "Ring of the Ram" — catch-all for high-value
    // named items without an explicit aura field.
    isMagic = true;
  } else {
    isMagic = false;
  }

  // rarity: explicit wins; magic items always 'magical'; masterwork or
  // high-value non-magic → 'rare' / 'exotic'; else 'common'.
  let rarity;
  if (typeof item.rarity === 'string' && /^(common|rare|exotic|magical)$/i.test(item.rarity)) {
    rarity = item.rarity.toLowerCase();
  } else if (isMagic) {
    rarity = 'magical';
  } else if (MASTERWORK_PATTERN.test(name)) {
    rarity = 'rare';
  } else if (actualValue > 5000) {
    rarity = 'exotic';
  } else if (actualValue > 500) {
    rarity = 'rare';
  } else {
    rarity = 'common';
  }

  // smallOrDetailed: gems, jewelry, rings, small art objects, coins of
  // collectible nature. Explicit flag wins. Rings get a free pass because
  // even a non-magical signet ring is small enough to warrant the lens.
  let smallOrDetailed;
  if (typeof item.smallOrDetailed === 'boolean') {
    smallOrDetailed = item.smallOrDetailed;
  } else if (/^ring$/i.test(category)) {
    smallOrDetailed = true;
  } else if (GEM_PATTERN.test(name) || JEWELRY_PATTERN.test(name)) {
    smallOrDetailed = true;
  } else if (ART_OBJECT_PATTERN.test(name) && actualValue >= 100) {
    // Fine artwork over 100gp per CRB Ch.12 "Fine Artwork" category.
    smallOrDetailed = true;
  } else {
    smallOrDetailed = false;
  }

  // valuedByWeight: coins, bullion, ingots, raw precious-metal materials.
  let valuedByWeight;
  if (typeof item.valuedByWeight === 'boolean') {
    valuedByWeight = item.valuedByWeight;
  } else if (RAW_MATERIAL_PATTERN.test(name.trim())) {
    valuedByWeight = true;
  } else if (WEIGHT_PATTERN.test(name)) {
    valuedByWeight = true;
  } else if (/\b(gold|silver|platinum|copper|electrum)\b/i.test(name) &&
             /\b(bar|bars|ingot|ingots|coin|coins|nugget|nuggets|dust|lump|lumps)\b/i.test(name)) {
    valuedByWeight = true;
  } else {
    valuedByWeight = false;
  }

  return {
    actualValue,
    isMagic,
    rarity,
    smallOrDetailed,
    valuedByWeight,
  };
}

// Convenience: merge computed metadata INTO an item without mutating the
// original. Useful when hydrating loot drops from a minimal shape.
export function withAppraiseMetadata(item) {
  const meta = computeAppraiseMetadata(item);
  return { ...item, ...meta };
}

export { parsePriceGP };
