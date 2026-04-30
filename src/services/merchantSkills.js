// ─────────────────────────────────────────────────────
// Merchant skills, attitude, and specialty helpers
// ─────────────────────────────────────────────────────
//
// This module centralizes everything the shop/haggle flow needs to reason
// about *merchants as NPCs* rather than as a bag of price modifiers:
//
//   1. A real skills block per merchant (Appraise, Bluff, Sense Motive,
//      Diplomacy, Intimidate) that drives bargain DCs. Merchants in
//      settlements.json can override; we otherwise derive from the
//      generic patronTypes.merchant default plus a shopType bias
//      (a jeweler appraises gems better; a magicShop senses motive
//      better; a blackMarket fence bluffs better).
//
//   2. Attitude tracking per merchant (CRB p.94: Hostile / Unfriendly /
//      Indifferent / Friendly / Helpful). Stored in worldState so we can
//      read it synchronously from React without going through Dexie.
//      Settlement merchants have string IDs (savah, redDogSmithy, …)
//      that aren't auto-persisted in encounteredNpcs, so a separate
//      cache keyed by "${settlementId}:${merchantId}" is simplest.
//
//   3. Specialty matching — when generateMerchantInventory builds a pool,
//      it boosts items matching merchant.specialties so Savah's
//      "masterwork weapons" actually skews her stock toward masterwork
//      weapons instead of being pure flavor.
//
// All helpers are pure apart from `applyMerchantAttitude`, which takes a
// setWorldState setter and mutates through React state. The unit tests
// exercise the pure pieces directly.

import settlementsData from '../data/settlements.json';

// ─── Default skills & shop-type bias ─────────────────────────────

// Baseline merchant skills (fallback if neither the merchant nor the
// patronTypes block provides them). Mirrors a CR 1 NPC expert with a few
// ranks in the trader package.
export const DEFAULT_MERCHANT_SKILLS = {
  appraise: 6,
  bluff: 4,
  senseMotive: 5,
  diplomacy: 4,
  intimidate: 2,
};

// Per-shopType bias applied on top of the baseline. These are
// intentionally modest (±2–4) so specialists feel different without
// outrunning the PC skill budget.
export const SHOP_TYPE_SKILL_BIAS = {
  blacksmith: { appraise: 2, intimidate: 2 },
  jeweler: { appraise: 4, senseMotive: 1 },
  magicShop: { appraise: 2, senseMotive: 2 },
  alchemist: { appraise: 1, senseMotive: 1 },
  temple: { diplomacy: 3, senseMotive: 2, intimidate: -2 },
  blackMarket: { bluff: 4, senseMotive: 3, appraise: 2 },
  generalStore: { diplomacy: 1 },
  stable: { intimidate: 1 },
  bookshop: { appraise: 1 },
  tailor: {},
};

// Read the patronTypes.merchant skills from settlements.json, normalizing
// the legacy "senseMotivee" typo to "senseMotive". Done lazily so callers
// can swap settlementsData in tests.
function getPatronMerchantSkills() {
  const raw = settlementsData?.patronTypes?.merchant?.skills || {};
  const out = { ...raw };
  if (out.senseMotivee != null && out.senseMotive == null) {
    out.senseMotive = out.senseMotivee;
  }
  delete out.senseMotivee;
  return out;
}

/**
 * Resolve a merchant's effective skills.
 *
 * Precedence, lowest → highest:
 *   DEFAULT_MERCHANT_SKILLS → SHOP_TYPE_SKILL_BIAS[shopType] →
 *   patronTypes.merchant.skills → merchant.skills (per-merchant override).
 *
 * Returns a brand-new object with keys appraise, bluff, senseMotive,
 * diplomacy, intimidate — always populated. Unknown skills on the merchant
 * are preserved as well.
 */
export function getMerchantSkills(merchant) {
  const base = { ...DEFAULT_MERCHANT_SKILLS };
  const patron = getPatronMerchantSkills();
  for (const [k, v] of Object.entries(patron)) {
    if (typeof v === 'number') base[k] = v;
  }
  const shopBias = SHOP_TYPE_SKILL_BIAS[merchant?.shopType] || {};
  for (const [k, v] of Object.entries(shopBias)) {
    base[k] = (base[k] || 0) + v;
  }
  const override = merchant?.skills || {};
  for (const [k, v] of Object.entries(override)) {
    if (typeof v === 'number') base[k] = v;
  }
  return base;
}

// ─── Attitude (CRB p. 94) ────────────────────────────────────────

export const ATTITUDE_LEVELS = ['hostile', 'unfriendly', 'indifferent', 'friendly', 'helpful'];

/**
 * Map an attitude to the modifier applied to the PC's haggle roll. Matches
 * the spirit of the Diplomacy attitude-shift table: two tiers in either
 * direction from Indifferent are ±2 each step, with Helpful capping at +5.
 */
export function attitudeBonus(attitude) {
  switch (attitude) {
    case 'hostile': return -5;
    case 'unfriendly': return -2;
    case 'indifferent': return 0;
    case 'friendly': return 2;
    case 'helpful': return 5;
    default: return 0;
  }
}

/**
 * Baseline discount offered *before* any haggle roll, representing the
 * merchant's natural willingness to cut a deal for the party. Helpful
 * merchants will lop 10% off sight-unseen; Friendly merchants 5%.
 * Hostile/Unfriendly merchants inflate prices — this is returned as a
 * *positive* number meaning "add to the price".
 */
export function attitudeBaseDiscount(attitude) {
  switch (attitude) {
    case 'hostile': return -0.5;  // +50% markup (often "refuses" — see refusesService)
    case 'unfriendly': return -0.25; // +25% markup
    case 'indifferent': return 0;
    case 'friendly': return 0.05;
    case 'helpful': return 0.10;
    default: return 0;
  }
}

/**
 * Hostile merchants refuse to deal in good faith. Shop code should skip
 * haggling entirely when this returns true and prompt the player to
 * improve the merchant's attitude first.
 */
export function refusesService(attitude) {
  return attitude === 'hostile';
}

export function getMerchantAttitudeKey(settlementId, merchantId) {
  return `${settlementId}:${merchantId}`;
}

/**
 * Read the current attitude entry for a merchant out of worldState. If no
 * entry exists, returns a synthetic "indifferent" baseline. If the entry
 * has expired (temporary shift from Intimidate or Diplomacy), this
 * function returns the *revert* attitude instead and marks the record
 * stale so the caller can clean it up.
 */
export function getMerchantAttitude(worldState, settlementId, merchantId, nowMs = Date.now()) {
  const key = getMerchantAttitudeKey(settlementId, merchantId);
  const cache = worldState?.merchantAttitudes || {};
  const entry = cache[key];
  if (!entry) {
    return { attitude: 'indifferent', reason: null, expiresAt: null, expired: false };
  }
  if (typeof entry.expiresAt === 'number' && entry.expiresAt <= nowMs) {
    return {
      attitude: entry.revertTo || 'unfriendly',
      reason: entry.reason || null,
      expiresAt: null,
      expired: true,
      previous: entry.attitude,
    };
  }
  return {
    attitude: entry.attitude || 'indifferent',
    reason: entry.reason || null,
    expiresAt: entry.expiresAt || null,
    expired: false,
  };
}

/**
 * Sync update wrapper for worldState.merchantAttitudes. `opts` can carry
 * durationMs (for a temporary shift that reverts afterward), revertTo,
 * and a reason string for the history trail.
 */
export function applyMerchantAttitude(setWorldState, settlementId, merchantId, newAttitude, opts = {}) {
  if (typeof setWorldState !== 'function') return;
  const key = getMerchantAttitudeKey(settlementId, merchantId);
  const now = opts.now || Date.now();
  const expiresAt = typeof opts.durationMs === 'number' ? now + opts.durationMs : null;
  setWorldState(prev => {
    const cache = { ...(prev?.merchantAttitudes || {}) };
    const prior = cache[key];
    const history = prior?.history ? [...prior.history] : [];
    history.push({
      at: now,
      from: prior?.attitude || 'indifferent',
      to: newAttitude,
      reason: opts.reason || null,
    });
    cache[key] = {
      attitude: newAttitude,
      reason: opts.reason || null,
      expiresAt,
      revertTo: opts.revertTo || null,
      history: history.slice(-10), // keep trailing 10 events
    };
    return { ...prev, merchantAttitudes: cache };
  });
}

// ─── Specialty matching ──────────────────────────────────────────

// Normalize a specialty string to a list of keywords we can substring-match
// against item fields. "masterwork weapons" → ["masterwork", "weapons"].
function specialtyKeywords(spec) {
  if (typeof spec !== 'string') return [];
  return spec
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'item', 'items', 'goods']);

// Known category words that live in item.category / item.subcategory /
// item.tier. We allow the keyword → category bridge so "weapons" matches
// items with category "weapon" (singular), etc.
const CATEGORY_ALIASES = {
  weapons: ['weapon'],
  weapon: ['weapon'],
  armor: ['armor'],
  armors: ['armor'],
  shield: ['shield'],
  shields: ['shield'],
  potion: ['potion'],
  potions: ['potion'],
  scroll: ['scroll'],
  scrolls: ['scroll'],
  wand: ['wand'],
  wands: ['wand'],
  wondrous: ['wondrous'],
  ring: ['ring'],
  rings: ['ring'],
  rod: ['rod'],
  staff: ['staff'],
  staves: ['staff'],
  gear: ['gear'],
  alchemical: ['alchemical'],
  poisons: ['alchemical'],
  poison: ['alchemical'],
};

// Tier keywords that are too permissive to trigger a match on their own —
// "minor wondrous items" should not snag every tier=minor potion in the pool.
// Note: "masterwork" is deliberately NOT in this set. Masterwork is a strong
// signal — a merchant whose specialty lists "masterwork" really does want
// items whose name contains that word — and matching via name.includes('masterwork')
// is exactly what we want.
const TIER_SKIP_WORDS = new Set(['minor', 'medium', 'major']);

/**
 * Does `item` match at least one of the merchant's specialty strings?
 *
 * Matching is evaluated *per specialty phrase*. Within a single phrase:
 *   - a "strong" hit (keyword appears in item.name, or keyword resolves
 *     to a category alias matching item.category/subcategory) is always
 *     enough on its own to flag the item
 *   - a "tier" keyword (minor/medium/major) alone is NOT enough — tier
 *     words are too permissive (e.g. "minor wondrous items" should not
 *     snag every tier=minor potion). A tier keyword only counts when it
 *     combines with a strong hit in the same phrase, which is handled
 *     naturally because the strong hit returns true anyway.
 *
 * A single phrase match is enough to flag the item. We don't try to be
 * clever about multi-word phrases — the callers just want *bias*, not a
 * strict filter.
 */
export function matchSpecialty(item, specialties) {
  if (!item || !Array.isArray(specialties) || specialties.length === 0) return false;
  const name = (item.name || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const sub = (item.subcategory || '').toLowerCase();
  for (const spec of specialties) {
    const kws = specialtyKeywords(spec);
    let strongHit = false;
    for (const kw of kws) {
      // Tier keywords (minor/medium/major) are intentionally skipped as
      // standalone triggers — they only ride along with a strong hit.
      if (TIER_SKIP_WORDS.has(kw)) continue;
      if (name.includes(kw)) { strongHit = true; break; }
      const catAliases = CATEGORY_ALIASES[kw];
      if (catAliases && (catAliases.includes(cat) || catAliases.includes(sub))) {
        strongHit = true;
        break;
      }
    }
    if (strongHit) return true;
  }
  return false;
}

/**
 * Apply a specialty bias to a pool of items by duplicating matched items.
 * Duplicates raise their odds of being selected when a caller randomly
 * samples the pool. `weight` controls how many extra copies each matched
 * item gets (default 2 ⇒ three total copies for matched, one for others).
 */
export function biasPoolBySpecialty(pool, specialties, weight = 2) {
  if (!Array.isArray(pool) || pool.length === 0) return pool || [];
  if (!Array.isArray(specialties) || specialties.length === 0) return pool;
  const biased = [];
  for (const item of pool) {
    biased.push(item);
    if (matchSpecialty(item, specialties)) {
      for (let i = 0; i < weight; i++) biased.push(item);
    }
  }
  return biased;
}
