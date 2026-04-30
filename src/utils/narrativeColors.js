/**
 * narrativeColors — sentence-level color coding for split-party narration.
 *
 * Motivation: when the party splits up and the DM narrates each subgroup's
 * action ("Ironforge approaches the curiosity stall ... Shadowblade slips
 * into the festival flow ..."), the prose blurs together and the operator
 * has to re-read to see who's doing what. Coloring each sentence by the
 * single party member it names makes split-party logs scannable at a
 * glance — like a multi-track narration rendered in parallel.
 *
 * Behavior (Option B from the design discussion):
 *   • Split a narration string into rough sentences (preserves punctuation).
 *   • For each sentence, scan for party-member names with word-boundary
 *     matching (so "Sara" doesn't match inside "Sarah").
 *   • If EXACTLY ONE party member is named, that sentence inherits their
 *     color. If 0 or 2+ are named, the sentence stays default-colored —
 *     joint sentences shouldn't pretend to belong to a single PC.
 *   • Color comes from a class-based palette with a per-party fallback so
 *     even unrecognized classes (homebrew, multiclass) get distinct colors.
 *
 * Pure functions; consumers own the rendering.
 */

// PF1e core class → narrative color. Picked for distinct hue families with
// enough saturation to read on a dark log background. Add classes here as
// needed; unmatched classes fall through to FALLBACK_PALETTE by index.
const CLASS_COLORS = {
  fighter:    '#dc143c', // crimson
  barbarian:  '#a0522d', // sienna — warmer than fighter
  ranger:     '#6b8e23', // olive
  paladin:    '#e0e0ff', // pale silver-blue
  cleric:     '#ffd700', // gold
  oracle:     '#daa520', // dark gold
  wizard:     '#9370db', // medium purple
  sorcerer:   '#ba55d3', // medium orchid
  bard:       '#40e0d0', // turquoise
  rogue:      '#20b2aa', // light sea green
  druid:      '#228b22', // forest green
  monk:       '#ff8c00', // dark orange
  summoner:   '#ff69b4', // hot pink
  inquisitor: '#b8860b', // dark goldenrod
  alchemist:  '#7fff00', // chartreuse
  witch:      '#8a2be2', // blue violet
  cavalier:   '#4169e1', // royal blue
  gunslinger: '#cd853f', // peru
  magus:      '#9400d3', // dark violet
  antipaladin:'#8b0000', // dark red
};

// Used when a character's class isn't in the map above. Round-robin by
// position in the party so the four PCs always end up visually distinct
// even if they all share an unrecognized class.
const FALLBACK_PALETTE = [
  '#dc143c', '#9370db', '#ffd700', '#20b2aa',
  '#ff8c00', '#40e0d0', '#228b22', '#ba55d3',
];

/**
 * Resolve a narrative color for a single character. Tries `character.class`
 * (string) first, then the first entry of `character.classes` (the canonical
 * shape from the PF1e roster JSON), then falls back to the palette by index.
 */
export function getCharacterColor(character, fallbackIdx = 0) {
  if (!character) return FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length];
  let cls = '';
  if (typeof character.class === 'string' && character.class) {
    cls = character.class.toLowerCase();
  } else if (Array.isArray(character.classes) && character.classes.length > 0) {
    const first = character.classes[0];
    cls = (typeof first === 'string' ? first : first?.class || first?.name || '').toLowerCase();
  }
  if (cls && CLASS_COLORS[cls]) return CLASS_COLORS[cls];
  return FALLBACK_PALETTE[fallbackIdx % FALLBACK_PALETTE.length];
}

/**
 * Build a name → { color, name, id } map for the active party. Names are
 * lowercased for case-insensitive matching during sentence colorization.
 * Skips characters with no name.
 */
export function buildPartyColorMap(party = []) {
  const map = new Map();
  if (!Array.isArray(party)) return map;
  party.forEach((c, i) => {
    const name = (c?.name || '').trim();
    if (!name) return;
    map.set(name.toLowerCase(), {
      color: getCharacterColor(c, i),
      name,
      id: c.id,
    });
  });
  return map;
}

/**
 * Split a narrative chunk into rough sentences. Conservative: keeps
 * trailing punctuation with each sentence so "She stood up. Then she
 * paused." → ["She stood up.", "Then she paused."]. Doesn't try to be
 * perfect on abbreviations or quoted dialogue — even an imperfect split
 * gives most of the visual benefit, and over-splitting just produces
 * smaller colored chunks (still readable).
 */
function splitSentences(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  // Match: any non-terminator chars, followed by one+ terminators, followed
  // by whitespace OR end-of-string. Final non-terminated chunk is captured
  // by the second alternative.
  const parts = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!parts) return [text];
  return parts.map(s => s).filter(s => s.length > 0);
}

// Escape a string for safe use inside a RegExp literal.
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Colorize a narration string. Returns an array of `{ text, color }`
 * segments — `color` is null for sentences with no single matching PC.
 * Consumers render each segment as a span with the appropriate color
 * (whitespace between segments is preserved within each `text`).
 *
 * @param {string} text
 * @param {Map<string, {color: string, name: string, id: any}>} partyColorMap
 * @returns {Array<{text: string, color: string|null}>}
 */
export function colorizeNarration(text, partyColorMap) {
  if (typeof text !== 'string' || !text) return [{ text: text || '', color: null }];
  if (!partyColorMap || partyColorMap.size === 0) return [{ text, color: null }];

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [{ text, color: null }];

  return sentences.map(sentence => {
    let matchedColor = null;
    let multipleMatches = false;
    for (const [name, entry] of partyColorMap) {
      const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
      if (re.test(sentence)) {
        if (matchedColor && matchedColor !== entry.color) {
          multipleMatches = true;
          break;
        }
        matchedColor = entry.color;
      }
    }
    return {
      text: sentence,
      color: multipleMatches ? null : matchedColor,
    };
  });
}
