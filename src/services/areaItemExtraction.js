// src/services/areaItemExtraction.js
//
// Bug #31 — the previous area-items panel pulled from a single generic
// town/dungeon random bucket that had no relationship to what the DM had
// just narrated. The operator filed: "Area items is very random and
// arbitrary... needs to be in theme with the location described. The GM
// narrative should be contributing to what shows up on the list."
//
// This extractor is the narrative-driven half of the fix. Given a chunk
// of DM narrative prose, it pulls out concrete scene objects the narrator
// mentioned (an altar, a banner, a chained cage, a ledger on the counter)
// and emits them as area-item candidates. Each candidate keeps the DM's
// own sentence as the item description, so the panel reads like a
// summary of what's actually in the scene rather than a random bucket.
//
// Pairs with the themed-pool fallback inside npcTracker.js:
//   1. Narrative extraction runs first (this file).
//   2. If the extractor yields < 3 candidates, themed-pool items fill in
//      from a location-category bucket (temple / graveyard / smithy /
//      market / tavern / cave / crypt / town / dungeon) instead of the
//      old terrain-only split.
//
// Deliberately conservative — false positives ruin the list faster than
// false negatives. Noun-whitelist + sentence-level matching + dedup.

// ── Multi-word scene nouns ────────────────────────────────────────────
// Scanned BEFORE the single-word list so compound phrases like
// "notice board" don't get split into a stray "notice" hit. Each entry
// is matched as a whole phrase.
const MULTI_WORD_NOUNS = [
  'notice board', 'menu board', 'announcement board', 'bulletin board',
  'offering bowl', 'prayer candle', 'prayer candles',
  'weapon rack', 'armor rack', 'weapons rack',
  'chest of drawers',
  'coat of arms',
  'holy symbol', 'holy water',
  'quench barrel',
];

// ── Scene-object whitelist ────────────────────────────────────────────
// Nouns that look like discrete, interactable or describable scene
// objects. Deliberately NOT abstract nouns ("shadow", "silence", "air")
// or locomotion verbs ("step", "walk"). Each noun listed singular here;
// the matcher also accepts the plural form (+ "s" or " shelves" variant).
const SCENE_NOUNS = [
  // Furniture & fixtures
  'altar', 'bier', 'brazier', 'chandelier', 'candelabra', 'sconce',
  'table', 'bench', 'stool', 'chair', 'throne', 'desk', 'counter',
  'shelf', 'shelves', 'rack', 'cabinet', 'armoire', 'wardrobe', 'chest of drawers',
  'fireplace', 'hearth', 'forge', 'anvil', 'kiln', 'furnace',
  'fountain', 'basin', 'trough', 'well', 'pool', 'cistern',
  'pedestal', 'plinth', 'column', 'pillar', 'obelisk',
  // Containers
  'chest', 'crate', 'coffer', 'strongbox', 'trunk', 'footlocker',
  'barrel', 'cask', 'keg', 'jar', 'urn', 'amphora',
  'sack', 'bag', 'pouch', 'purse', 'satchel',
  // Wall decor
  'tapestry', 'banner', 'pennant', 'standard', 'flag',
  'painting', 'portrait', 'mural', 'fresco',
  'statue', 'idol', 'effigy', 'figurine', 'carving', 'relief', 'bas-relief',
  'mirror',
  // Restraints & trappings
  'chain', 'rope', 'hook', 'cage', 'manacle', 'shackle', 'net',
  // Light sources
  'lantern', 'lamp', 'torch', 'candle', 'taper',
  // Papers & writing
  'book', 'tome', 'ledger', 'journal', 'diary', 'codex',
  'scroll', 'parchment', 'letter', 'note', 'missive', 'document',
  'map', 'chart', 'plan', 'deed',
  'sign', 'placard', 'notice', 'bulletin', 'handbill',
  // Weapons & gear on display
  'weapon', 'sword', 'dagger', 'blade', 'spear', 'axe', 'bow', 'crossbow',
  'hammer', 'mace', 'staff', 'rapier', 'scimitar',
  'shield', 'armor', 'helm', 'helmet', 'gauntlet', 'cloak',
  // Drink & dining
  'cup', 'mug', 'tankard', 'goblet', 'chalice', 'bottle', 'flask', 'vial',
  'decanter', 'bowl', 'plate', 'platter', 'pitcher',
  // Jewelry & small valuables
  'key', 'ring', 'amulet', 'pendant', 'necklace', 'locket', 'bracelet', 'brooch',
  'coin', 'coins', 'gem', 'jewel',
  // Graves & the dead
  'grave', 'tombstone', 'headstone', 'marker', 'crypt', 'tomb', 'sarcophagus',
  'coffin', 'ossuary', 'reliquary', 'shroud',
  'skeleton', 'skull', 'bones', 'bone',
  // Magic residue
  'rune', 'runes', 'glyph', 'sigil', 'inscription', 'seal', 'ward', 'circle',
  // Openings
  'door', 'gate', 'portcullis', 'archway', 'doorway', 'portal',
  'window', 'shutter', 'grate',
  'ladder', 'stairs', 'stairway', 'staircase', 'trapdoor',
  // Religious
  'censer', 'thurible', 'font', 'offering', 'offering bowl', 'pew', 'pulpit',
  // Market/smithy/tavern odds
  'scale', 'scales', 'weights', 'bellows', 'tongs', 'quench',
  'menu', 'menu board', 'chalkboard',
];

// Stop-words — if the matched word is one of these, reject. Guards
// against grammatical false positives like "a note of caution", where
// "note" isn't referring to a scene object at all.
const CONTEXTUAL_STOPS = new Set([
  'note of', 'note that', 'note how', 'note the irony',
  'ring of truth', 'ring a bell',
  'book passage', 'book a room',
  'coin a phrase',
  'staff of office', // usually refers to a person's staff, not pickupable — still OK to surface sometimes, so we'll NOT hard-block; keep this list short
]);

// Words that commonly form compound object names we'd like to keep as the
// name rather than pulling just the head noun. E.g. "prayer candle" reads
// better than bare "candle".
const MODIFIER_ACCEPT = new Set([
  'prayer', 'offering', 'holy', 'sacred', 'unholy', 'cursed', 'enchanted',
  'magical', 'ancient', 'crumbling', 'weathered', 'tattered', 'torn',
  'rusty', 'corroded', 'tarnished', 'gleaming', 'polished', 'ornate',
  'plain', 'simple', 'elegant', 'crude', 'broken', 'shattered',
  'bloody', 'blood-stained', 'stained', 'dirty', 'dusty',
  'copper', 'bronze', 'iron', 'silver', 'gold', 'golden', 'steel', 'wooden',
  'stone', 'marble', 'granite', 'obsidian', 'jade', 'crystal',
  'leather', 'velvet', 'silk', 'linen', 'canvas',
  'small', 'large', 'massive', 'huge', 'tiny', 'narrow', 'wide',
  'red', 'blue', 'green', 'black', 'white', 'grey', 'gray',
  'old', 'new', 'antique', 'modern', 'ritual', 'ceremonial',
  'battered', 'cracked', 'worn', 'faded', 'charred', 'scorched',
  'tall', 'short', 'low',
]);

// Title-case a phrase (for the item.name)
function titleCase(str) {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Split narrative prose into sentences, respecting `!`, `?`, `.`, and
// keeping the punctuation attached. em-dashes don't split.
function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .replace(/\r/g, '')
    // keep paragraph breaks as sentence-ish boundaries too
    .split(/(?<=[.!?])\s+(?=[A-Z"'])|\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Match SCENE_NOUNS inside a sentence and return the {phrase, noun} for
// each hit, where phrase includes any leading modifier adjective.
function matchNounsInSentence(sentence) {
  const lower = sentence.toLowerCase();
  const hits = [];
  const seen = new Set();
  // Track which character ranges have already been matched by an earlier
  // (higher-priority) phrase, so multi-word hits like "notice board" block
  // the single-word matcher from re-capturing "notice" or "board" later.
  const claimedRanges = [];
  const isClaimed = (start, end) =>
    claimedRanges.some(([s, e]) => !(end <= s || start >= e));
  const claim = (start, end) => { claimedRanges.push([start, end]); };

  // ── Pass 1: multi-word compound nouns ───────────────────────────────
  for (const multi of MULTI_WORD_NOUNS) {
    const re = new RegExp(
      `\\b(?:(?:(?:a|an|the|this|that|these|those|some|several|few|many)\\s+)?` +
        `(?:([a-z][a-z\\-]{2,})\\s+)?` +
        `(${multi.replace(/\s+/g, '\\s+')}))\\b`,
      'gi'
    );
    let m;
    while ((m = re.exec(lower)) !== null) {
      const modifier = m[1];
      const head = m[2].replace(/\s+/g, ' ');
      const start = m.index;
      const end = start + m[0].length;
      if (isClaimed(start, end)) continue;

      const keepMod = modifier && MODIFIER_ACCEPT.has(modifier);
      const phrase = keepMod ? `${modifier} ${head}` : head;
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      claim(start, end);
      hits.push({ phrase, noun: head, start });
    }
  }

  // ── Pass 2: single-word scene nouns ─────────────────────────────────
  for (const noun of SCENE_NOUNS) {
    // Word boundary match, allowing plural `s`
    const plural = noun.endsWith('s') || noun.endsWith('es') ? noun : `${noun}s?`;
    // Anchor to word boundaries so "torches" doesn't match "tortoise".
    const re = new RegExp(
      `\\b(?:(?:(?:a|an|the|this|that|these|those|some|several|few|many)\\s+)?` +
        `(?:([a-z][a-z\\-]{2,})\\s+)?` +
        `(${plural}))\\b`,
      'gi'
    );
    let m;
    while ((m = re.exec(lower)) !== null) {
      const modifier = m[1]; // optional leading adjective
      const head = m[2];     // the noun itself
      const start = m.index;
      const end = start + m[0].length;
      if (isClaimed(start, end)) continue;

      // Stop-word / context filter: reject if the phrase is part of an
      // idiomatic construction like "note of caution".
      let stopped = false;
      for (const stop of CONTEXTUAL_STOPS) {
        if (lower.indexOf(stop, Math.max(0, start - 4)) !== -1 &&
            Math.abs(lower.indexOf(stop, Math.max(0, start - 4)) - start) < 20) {
          stopped = true;
          break;
        }
      }
      if (stopped) continue;

      // Decide which phrase to keep: if there's a modifier the parser
      // likes ("prayer candle", "offering bowl"), keep modifier + head.
      // Otherwise just the head, since random adjectives in prose are
      // often just descriptive and read weirdly as an item name.
      const keepMod = modifier && MODIFIER_ACCEPT.has(modifier);
      const phrase = keepMod ? `${modifier} ${head}` : head;

      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      claim(start, end);
      hits.push({ phrase, noun: head, start });
    }
  }

  return hits;
}

// Classify an extracted item by the noun. Loot = take-able valuables
// (coins, rings, weapons on a rack), interactable = investigable
// fixtures (altars, chests, notice boards, doors), mundane = scenery
// (tapestries, torches, hearths).
function classifyByNoun(noun) {
  const n = noun.toLowerCase().replace(/s$/, '');
  const loot = new Set([
    'coin', 'ring', 'gem', 'jewel', 'amulet', 'pendant', 'necklace', 'locket',
    'bracelet', 'brooch', 'key', 'scroll', 'map', 'letter', 'note', 'missive',
    'ledger', 'journal', 'diary', 'book', 'tome', 'purse', 'pouch',
    'potion', 'vial', 'flask',
  ]);
  const interactable = new Set([
    'altar', 'chest', 'coffer', 'strongbox', 'trunk', 'crate',
    'door', 'gate', 'portcullis', 'trapdoor',
    'rune', 'glyph', 'sigil', 'inscription', 'seal', 'ward',
    'statue', 'idol', 'effigy',
    'notice', 'placard', 'sign', 'board', 'bulletin',
    'mirror', 'portal',
    'well', 'fountain', 'basin',
    'sarcophagus', 'coffin', 'tomb', 'crypt', 'grave', 'tombstone',
    'pedestal', 'lever', 'switch',
    'reliquary', 'censer',
    'anvil', 'forge', 'furnace', 'bellows',
  ]);
  if (loot.has(n)) return { loot: true, interactable: true };
  if (interactable.has(n)) return { interactable: true };
  return { mundane: true };
}

/**
 * Extract area-item candidates from narrative text.
 *
 * @param {string} narrative - DM-authored or AI-generated prose describing the scene.
 * @param {object} opts
 * @param {Array<{name:string}>} [opts.existing] - items already on the panel (dedup source).
 * @param {number} [opts.max] - cap on returned candidates (default 6).
 * @returns {Array<{name, description, mundane?, interactable?, loot?, _source:'narrative'}>}
 */
export function extractAreaItemsFromNarrative(narrative, opts = {}) {
  if (!narrative || typeof narrative !== 'string') return [];
  const existing = Array.isArray(opts.existing) ? opts.existing : [];
  const max = typeof opts.max === 'number' ? opts.max : 6;

  const existingNames = new Set(
    existing.map(i => (i?.name || '').toLowerCase()).filter(Boolean)
  );

  const sentences = splitSentences(narrative);
  const candidates = [];
  const seenPhrase = new Set();
  const seenHead = new Set(); // dedup by head noun across sentences —
  // keeps "Stone Altar" and filters the bare "Altar" mentioned two
  // sentences later so the panel doesn't list the same object twice.

  for (const sentence of sentences) {
    const hits = matchNounsInSentence(sentence);
    for (const { phrase, noun } of hits) {
      const name = titleCase(phrase);
      const key = name.toLowerCase();
      if (seenPhrase.has(key)) continue;
      if (existingNames.has(key)) continue;
      // Head-noun dedup: normalize plural s, check cross-sentence memory.
      const headKey = noun.toLowerCase().replace(/s$/, '').replace(/\s+/g, ' ');
      if (seenHead.has(headKey)) continue;
      seenPhrase.add(key);
      seenHead.add(headKey);

      const cls = classifyByNoun(noun);
      candidates.push({
        name,
        description: sentence,
        ...cls,
        _source: 'narrative',
      });
      if (candidates.length >= max) return candidates;
    }
  }

  return candidates;
}

/**
 * Small helper that the renderer can use to decide whether a refresh
 * pass should run. If the narrative contains no scene-object nouns we
 * skip the pass rather than regenerate items from a random pool — the
 * point of #31 is that items track the narrative, so no narrative
 * content = no refresh.
 */
export function narrativeHasExtractableObjects(narrative) {
  if (!narrative || typeof narrative !== 'string') return false;
  const sentences = splitSentences(narrative);
  for (const s of sentences) {
    if (matchNounsInSentence(s).length > 0) return true;
  }
  return false;
}

export default {
  extractAreaItemsFromNarrative,
  narrativeHasExtractableObjects,
};
