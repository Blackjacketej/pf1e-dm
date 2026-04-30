/**
 * Race Demographics — CRB Tables 7-1 / 7-2 / 7-3 (page 168-170)
 *
 * Provides random starting age, height, weight, and race-suggested deities
 * for character generation. Core data is verified directly from the
 * Pathfinder 1e Core Rulebook (5th Printing) PDF.
 *
 * Coverage:
 *   - 7 core races: full CRB tables (Human, Dwarf, Elf, Gnome, Half-Elf, Half-Orc, Halfling)
 *   - 20+ extended races: reasonable defaults adapted from CRB analogues
 *     (e.g., Aasimar/Tiefling use Human, Dhampir uses Half-Elf, Duergar uses Dwarf, etc.)
 *
 * Class age categories (CRB Table 7-1):
 *   - intuitive : Barbarian, Oracle, Rogue, Sorcerer
 *   - selfTaught: Bard, Cavalier, Fighter, Gunslinger, Inquisitor, Magus, Paladin, Ranger, Summoner, Witch
 *   - trained   : Alchemist, Cleric, Druid, Monk, Wizard
 */

// ─────────────────────────────────────────────────────────────────────────
// Class → age category mapping (CRB p168 + APG/UM/UC)
// ─────────────────────────────────────────────────────────────────────────
export const CLASS_AGE_CATEGORY = {
  Barbarian: 'intuitive',
  Oracle:    'intuitive',
  Rogue:     'intuitive',
  Sorcerer:  'intuitive',

  Bard:       'selfTaught',
  Cavalier:   'selfTaught',
  Fighter:    'selfTaught',
  Gunslinger: 'selfTaught',
  Inquisitor: 'selfTaught',
  Magus:      'selfTaught',
  Paladin:    'selfTaught',
  Ranger:     'selfTaught',
  Summoner:   'selfTaught',
  Witch:      'selfTaught',

  Alchemist: 'trained',
  Cleric:    'trained',
  Druid:     'trained',
  Monk:      'trained',
  Wizard:    'trained',
};

// ─────────────────────────────────────────────────────────────────────────
// CRB Table 7-1: Random Starting Ages  (verified pages 168-169)
// adulthood = minimum adult age in years
// intuitive/selfTaught/trained = dice to roll and add to adulthood
//   format: { count, sides }   (e.g. {count:2,sides:6} → 2d6)
// ─────────────────────────────────────────────────────────────────────────
export const RANDOM_AGES = {
  Human:      { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Dwarf:      { adulthood: 40,  intuitive: { count: 3, sides: 6 },  selfTaught: { count: 5, sides: 6 },  trained: { count: 7, sides: 6 } },
  Elf:        { adulthood: 110, intuitive: { count: 4, sides: 6 },  selfTaught: { count: 6, sides: 6 },  trained: { count: 10, sides: 6 } },
  Gnome:      { adulthood: 40,  intuitive: { count: 4, sides: 6 },  selfTaught: { count: 6, sides: 6 },  trained: { count: 9, sides: 6 } },
  'Half-Elf': { adulthood: 20,  intuitive: { count: 1, sides: 6 },  selfTaught: { count: 2, sides: 6 },  trained: { count: 3, sides: 6 } },
  'Half-Orc': { adulthood: 14,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Halfling:   { adulthood: 20,  intuitive: { count: 2, sides: 4 },  selfTaught: { count: 3, sides: 6 },  trained: { count: 4, sides: 6 } },

  // ── Extended races (use closest CRB analogue) ──
  // Planetouched & spirit-folk → Human-like maturity
  Aasimar:    { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Tiefling:   { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Ifrit:      { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Oread:      { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Sylph:      { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Undine:     { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Changeling: { adulthood: 16,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Fetchling:  { adulthood: 16,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },

  // Dhampir → Half-Elf (long-lived)
  Dhampir:    { adulthood: 20,  intuitive: { count: 1, sides: 6 },  selfTaught: { count: 2, sides: 6 },  trained: { count: 3, sides: 6 } },

  // Underground dwarven cousins → Dwarf
  Duergar:    { adulthood: 40,  intuitive: { count: 3, sides: 6 },  selfTaught: { count: 5, sides: 6 },  trained: { count: 7, sides: 6 } },

  // Deep gnomes & shadow gnomes → Gnome
  Svirfneblin:{ adulthood: 40,  intuitive: { count: 4, sides: 6 },  selfTaught: { count: 6, sides: 6 },  trained: { count: 9, sides: 6 } },
  Wayang:     { adulthood: 40,  intuitive: { count: 4, sides: 6 },  selfTaught: { count: 6, sides: 6 },  trained: { count: 9, sides: 6 } },

  // Beast-folk → Half-Orc-ish (mature fast)
  Catfolk:    { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Kitsune:    { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Tengu:      { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Ratfolk:    { adulthood: 12,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Nagaji:     { adulthood: 15,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },

  // Monstrous humanoids → Half-Orc
  Orc:        { adulthood: 14,  intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Goblin:     { adulthood: 9,   intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
  Kobold:     { adulthood: 6,   intuitive: { count: 1, sides: 4 },  selfTaught: { count: 1, sides: 6 },  trained: { count: 2, sides: 6 } },
};

// ─────────────────────────────────────────────────────────────────────────
// CRB Table 7-2: Aging Effects  (verified page 169)
// All values in years
// ─────────────────────────────────────────────────────────────────────────
export const AGING_EFFECTS = {
  Human:      { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Dwarf:      { middle: 125, old: 188, venerable: 250, maxBase: 250, maxRoll: { count: 2, sides: 100 } },
  Elf:        { middle: 175, old: 263, venerable: 350, maxBase: 350, maxRoll: { count: 4, sides: 100 } },
  Gnome:      { middle: 100, old: 150, venerable: 200, maxBase: 200, maxRoll: { count: 3, sides: 100 } },
  'Half-Elf': { middle: 62,  old: 93,  venerable: 125, maxBase: 125, maxRoll: { count: 3, sides: 20 } },
  'Half-Orc': { middle: 30,  old: 45,  venerable: 60,  maxBase: 60,  maxRoll: { count: 2, sides: 10 } },
  Halfling:   { middle: 50,  old: 75,  venerable: 100, maxBase: 100, maxRoll: { count: 5, sides: 20 } },

  // Extended races mirror their analogues
  Aasimar:    { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Tiefling:   { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Ifrit:      { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Oread:      { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Sylph:      { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Undine:     { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Changeling: { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Fetchling:  { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Dhampir:    { middle: 62,  old: 93,  venerable: 125, maxBase: 125, maxRoll: { count: 3, sides: 20 } },
  Duergar:    { middle: 125, old: 188, venerable: 250, maxBase: 250, maxRoll: { count: 2, sides: 100 } },
  Svirfneblin:{ middle: 100, old: 150, venerable: 200, maxBase: 200, maxRoll: { count: 3, sides: 100 } },
  Wayang:     { middle: 100, old: 150, venerable: 200, maxBase: 200, maxRoll: { count: 3, sides: 100 } },
  Catfolk:    { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Kitsune:    { middle: 32,  old: 50,  venerable: 65,  maxBase: 65,  maxRoll: { count: 2, sides: 20 } },
  Tengu:      { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Ratfolk:    { middle: 30,  old: 45,  venerable: 60,  maxBase: 60,  maxRoll: { count: 2, sides: 10 } },
  Nagaji:     { middle: 35,  old: 53,  venerable: 70,  maxBase: 70,  maxRoll: { count: 2, sides: 20 } },
  Orc:        { middle: 30,  old: 45,  venerable: 60,  maxBase: 60,  maxRoll: { count: 2, sides: 10 } },
  Goblin:     { middle: 16,  old: 24,  venerable: 32,  maxBase: 32,  maxRoll: { count: 2, sides: 10 } },
  Kobold:     { middle: 16,  old: 24,  venerable: 32,  maxBase: 32,  maxRoll: { count: 2, sides: 10 } },
};

// ─────────────────────────────────────────────────────────────────────────
// CRB Table 7-3: Random Height and Weight  (verified page 170)
// baseHeightInches : starting height in inches
// heightMod        : dice added to base, in inches
// baseWeightLbs    : starting weight in pounds
// weightMultiplier : multiply heightMod result by this many pounds, add to base weight
// ─────────────────────────────────────────────────────────────────────────
export const HEIGHT_WEIGHT = {
  Human: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Dwarf: {
    male:   { baseHeightInches: 45, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 150, weightMultiplier: 7 },
    female: { baseHeightInches: 43, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 120, weightMultiplier: 7 },
  },
  Elf: {
    male:   { baseHeightInches: 64, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 100, weightMultiplier: 3 },
    female: { baseHeightInches: 64, heightMod: { count: 2, sides: 6 }, baseWeightLbs: 90,  weightMultiplier: 3 },
  },
  Gnome: {
    male:   { baseHeightInches: 36, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 35, weightMultiplier: 1 },
    female: { baseHeightInches: 34, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 30, weightMultiplier: 1 },
  },
  'Half-Elf': {
    male:   { baseHeightInches: 62, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 110, weightMultiplier: 5 },
    female: { baseHeightInches: 60, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 90,  weightMultiplier: 5 },
  },
  'Half-Orc': {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 12 }, baseWeightLbs: 150, weightMultiplier: 7 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 12 }, baseWeightLbs: 110, weightMultiplier: 7 },
  },
  Halfling: {
    male:   { baseHeightInches: 32, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 30, weightMultiplier: 1 },
    female: { baseHeightInches: 30, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 25, weightMultiplier: 1 },
  },

  // ── Extended races (Bestiary / ARG analogues) ──
  Aasimar: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Tiefling: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Ifrit: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Oread: {
    // Oreads are stocky and dense
    male:   { baseHeightInches: 56, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 140, weightMultiplier: 6 },
    female: { baseHeightInches: 51, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 100, weightMultiplier: 6 },
  },
  Sylph: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 110, weightMultiplier: 4 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 80,  weightMultiplier: 4 },
  },
  Undine: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Changeling: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Dhampir: {
    male:   { baseHeightInches: 62, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 110, weightMultiplier: 5 },
    female: { baseHeightInches: 60, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 90,  weightMultiplier: 5 },
  },
  Fetchling: {
    male:   { baseHeightInches: 58, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 5 },
    female: { baseHeightInches: 53, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 85,  weightMultiplier: 5 },
  },
  Duergar: {
    male:   { baseHeightInches: 45, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 150, weightMultiplier: 7 },
    female: { baseHeightInches: 43, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 120, weightMultiplier: 7 },
  },
  Svirfneblin: {
    male:   { baseHeightInches: 36, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 35, weightMultiplier: 1 },
    female: { baseHeightInches: 34, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 30, weightMultiplier: 1 },
  },
  Wayang: {
    male:   { baseHeightInches: 32, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 30, weightMultiplier: 1 },
    female: { baseHeightInches: 30, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 25, weightMultiplier: 1 },
  },
  Catfolk: {
    male:   { baseHeightInches: 60, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 120, weightMultiplier: 4 },
    female: { baseHeightInches: 55, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 90,  weightMultiplier: 4 },
  },
  Kitsune: {
    male:   { baseHeightInches: 60, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 100, weightMultiplier: 4 },
    female: { baseHeightInches: 58, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 80,  weightMultiplier: 4 },
  },
  Tengu: {
    male:   { baseHeightInches: 56, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 90, weightMultiplier: 3 },
    female: { baseHeightInches: 54, heightMod: { count: 2, sides: 8 }, baseWeightLbs: 75, weightMultiplier: 3 },
  },
  Ratfolk: {
    male:   { baseHeightInches: 36, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 35, weightMultiplier: 1 },
    female: { baseHeightInches: 34, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 30, weightMultiplier: 1 },
  },
  Nagaji: {
    male:   { baseHeightInches: 60, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 130, weightMultiplier: 5 },
    female: { baseHeightInches: 55, heightMod: { count: 2, sides: 10 }, baseWeightLbs: 95,  weightMultiplier: 5 },
  },
  Orc: {
    male:   { baseHeightInches: 60, heightMod: { count: 2, sides: 12 }, baseWeightLbs: 160, weightMultiplier: 7 },
    female: { baseHeightInches: 55, heightMod: { count: 2, sides: 12 }, baseWeightLbs: 120, weightMultiplier: 7 },
  },
  Goblin: {
    male:   { baseHeightInches: 30, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 30, weightMultiplier: 1 },
    female: { baseHeightInches: 28, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 25, weightMultiplier: 1 },
  },
  Kobold: {
    male:   { baseHeightInches: 24, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 25, weightMultiplier: 1 },
    female: { baseHeightInches: 24, heightMod: { count: 2, sides: 4 }, baseWeightLbs: 25, weightMultiplier: 1 },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Race-suggested deities  (CRB Chapter 2 race entries verified pages 21-43)
// Common = the deities most strongly associated with the race in lore.
// All deity names match entries in src/data/deities.json.
// ─────────────────────────────────────────────────────────────────────────
export const RACE_DEITIES = {
  // CRB-quoted: "Torag is a favorite among dwarves, though Abadar and Gorum are common choices as well."
  Dwarf:      { common: ['Torag', 'Abadar', 'Gorum'],                    note: 'Torag is the patron of the dwarves; Abadar and Gorum are common choices.' },
  // CRB-quoted: "Desna and Nethys are particular favorites… Calistria is perhaps the most notorious of elven deities."
  Elf:        { common: ['Desna', 'Nethys', 'Calistria'],                note: 'Elves favor Desna for her wonder, Nethys for magic, and Calistria for her elven ideals.' },
  // CRB-quoted: "Shelyn, Gozreh, Desna, and increasingly Cayden Cailean."
  Gnome:      { common: ['Shelyn', 'Gozreh', 'Desna', 'Cayden Cailean'], note: 'Gnomes worship deities of individuality and nature.' },
  // Halflings: "Erastil, Cayden Cailean, Desna" — common community/freedom deities
  Halfling:   { common: ['Erastil', 'Cayden Cailean', 'Desna'],          note: 'Halflings prefer deities of community, freedom, and travel.' },
  // CRB-quoted: half-elves "generally follow the common faiths of their homeland." Most often Desna/Shelyn/Calistria.
  'Half-Elf': { common: ['Desna', 'Shelyn', 'Calistria'],                note: 'Half-elves follow the common faiths of their homeland; popular choices include Desna and Shelyn.' },
  // CRB-quoted: "Gorum, Cayden Cailean, Lamashtu, and Rovagug."
  'Half-Orc': { common: ['Gorum', 'Cayden Cailean', 'Lamashtu', 'Rovagug'], note: 'Half-orcs favor deities of warfare and individual strength.' },
  // CRB: humans worship every deity; defaults to a wide pool
  Human:      { common: ['Abadar', 'Iomedae', 'Sarenrae', 'Desna', 'Shelyn', 'Cayden Cailean', 'Erastil', 'Pharasma', 'Asmodeus', 'Calistria'], note: 'Humans worship the widest range of deities of any race.' },

  // ── Extended races (lore-appropriate associations) ──
  Aasimar:    { common: ['Sarenrae', 'Iomedae', 'Shelyn', 'Desna'],            note: 'Aasimars favor good deities matching their celestial heritage.' },
  Tiefling:   { common: ['Asmodeus', 'Calistria', 'Norgorber', 'Lamashtu'],    note: 'Tieflings often turn to the same powers their ancestors served — though some rebel and pursue good faiths.' },
  Ifrit:      { common: ['Sarenrae', 'Cayden Cailean', 'Asmodeus'],            note: 'Ifrits drawn to fire and passion often worship Sarenrae or Cayden Cailean.' },
  Oread:      { common: ['Torag', 'Abadar', 'Gorum', 'Erastil'],               note: 'Oreads favor deities of stone, craft, and endurance.' },
  Sylph:      { common: ['Desna', 'Shelyn', 'Gozreh'],                         note: 'Sylphs revere deities of freedom and the open sky.' },
  Undine:     { common: ['Gozreh', 'Desna', 'Besmara'],                        note: 'Undines honor the gods of water and the sea.' },
  Changeling: { common: ['Desna', 'Pharasma', 'Calistria'],                    note: 'Changelings often hide their faith; many turn to deities of fate or freedom.' },
  Dhampir:    { common: ['Pharasma', 'Urgathoa', 'Zon-Kuthon'],                note: 'Dhampirs are drawn to deities of death — Pharasma for redemption, Urgathoa for embrace of their nature.' },
  Fetchling:  { common: ['Pharasma', 'Desna', 'Zon-Kuthon'],                   note: 'Fetchlings revere deities of shadow and the planar boundaries.' },

  Catfolk:    { common: ['Desna', 'Calistria', 'Erastil'],                     note: 'Catfolk worship deities of travel, freedom, and the wild.' },
  Kitsune:    { common: ['Desna', 'Shelyn', 'Calistria'],                      note: 'Kitsune favor deities of trickery, art, and beauty.' },
  Tengu:      { common: ['Desna', 'Calistria', 'Norgorber', 'Cayden Cailean'], note: 'Tengus revere deities of travel, luck, and cunning.' },
  Ratfolk:    { common: ['Norgorber', 'Cayden Cailean', 'Abadar'],             note: 'Ratfolk often worship deities of trade, secrets, and survival.' },
  Nagaji:     { common: ['Abadar', 'Irori', 'Asmodeus'],                       note: 'Nagaji typically worship deities of order and self-perfection.' },

  Orc:        { common: ['Rovagug', 'Lamashtu', 'Gorum'],                      note: 'Orcs revere deities of destruction, strength, and savagery.' },
  Goblin:     { common: ['Lamashtu', 'Rovagug', 'Zon-Kuthon'],                 note: 'Goblins worship the Mother of Monsters and other deities of chaos and ruin.' },
  Kobold:     { common: ['Asmodeus', 'Rovagug', 'Lamashtu'],                   note: 'Kobolds revere draconic powers and devils of cunning order.' },
  Duergar:    { common: ['Asmodeus', 'Torag', 'Zon-Kuthon'],                   note: 'Duergar revere dark smiths and devils of order — though some still honor Torag as ancestral patron.' },
  Svirfneblin:{ common: ['Pharasma', 'Torag', 'Abadar'],                       note: 'Svirfneblin honor gem-spirits and deities of stone and stealth.' },
  Wayang:     { common: ['Zon-Kuthon', 'Pharasma', 'Desna'],                   note: 'Wayangs revere deities of shadow and the spaces between.' },
};

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** Roll NdM */
function roll(count, sides) {
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  return total;
}

/** Pick a random element. */
function pick(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get the age category for a class. Defaults to selfTaught for unknown classes.
 */
export function getClassAgeCategory(className) {
  return CLASS_AGE_CATEGORY[className] || 'selfTaught';
}

/**
 * Roll a random starting age in years for the given race + class.
 * Unknown races fall back to Human.
 */
export function rollRandomAge(race, className) {
  const data = RANDOM_AGES[race] || RANDOM_AGES.Human;
  const category = getClassAgeCategory(className);
  const dice = data[category];
  return data.adulthood + roll(dice.count, dice.sides);
}

/** Get the age-bracket label (young/adult/middle/old/venerable) for a numeric age. */
export function getAgeBracket(race, age) {
  const data = AGING_EFFECTS[race] || AGING_EFFECTS.Human;
  const adulthood = (RANDOM_AGES[race] || RANDOM_AGES.Human).adulthood;
  if (age < adulthood)       return 'Young';
  if (age < data.middle)     return 'Adult';
  if (age < data.old)        return 'Middle Age';
  if (age < data.venerable)  return 'Old';
  return 'Venerable';
}

/**
 * Roll random height + weight for race + gender.
 * Returns { heightInches, heightFeet, heightInchesRem, heightLabel, weightLbs }
 * Per CRB: weight = baseWeight + (heightModRoll × weightMultiplier)
 * The SAME height-mod roll is used for both height and weight (CRB p169).
 */
export function rollRandomHeightWeight(race, gender) {
  const raceData = HEIGHT_WEIGHT[race] || HEIGHT_WEIGHT.Human;
  // Genders other than male/female randomly pick one of the two stat lines
  let key;
  if (gender === 'Male')        key = 'male';
  else if (gender === 'Female') key = 'female';
  else                          key = Math.random() < 0.5 ? 'male' : 'female';

  const data = raceData[key];
  const modRoll = roll(data.heightMod.count, data.heightMod.sides);
  const heightInches = data.baseHeightInches + modRoll;
  const weightLbs    = data.baseWeightLbs + (modRoll * data.weightMultiplier);

  const ft = Math.floor(heightInches / 12);
  const inRem = heightInches % 12;
  return {
    heightInches,
    heightFeet: ft,
    heightInchesRem: inRem,
    heightLabel: `${ft}'${inRem}"`,
    weightLbs,
  };
}

/**
 * Pick a random suggested deity for the given race + alignment.
 * If alignment is provided, filters to deities whose alignment is within 1 step
 * (the cleric restriction). The alignment filter requires the deities lookup
 * passed as the second argument.
 */
export function pickRandomDeity(race, alignment, deitiesLookup) {
  const entry = RACE_DEITIES[race] || RACE_DEITIES.Human;
  let pool = entry.common.slice();

  if (alignment && Array.isArray(deitiesLookup)) {
    const oneStep = (a, b) => {
      if (!a || !b) return true;
      if (a === b) return true;
      // Within one step on either axis
      const axes = (al) => ({
        l: al.includes('Lawful')  ? 1 : al.includes('Chaotic') ? -1 : 0,
        g: al.includes('Good')    ? 1 : al.includes('Evil')    ? -1 : 0,
      });
      const A = axes(a), B = axes(b);
      return Math.abs(A.l - B.l) <= 1 && Math.abs(A.g - B.g) <= 1;
    };
    pool = pool.filter(name => {
      const d = deitiesLookup.find(x => x.name === name);
      if (!d) return true;
      return oneStep(alignment, d.alignment);
    });
    if (pool.length === 0) pool = entry.common.slice(); // fallback if filter removed all
  }

  return pick(pool);
}

/** Get the suggestion note for a race (for UI hover/info). */
export function getDeityNote(race) {
  return (RACE_DEITIES[race] || RACE_DEITIES.Human).note;
}

export default {
  CLASS_AGE_CATEGORY,
  RANDOM_AGES,
  AGING_EFFECTS,
  HEIGHT_WEIGHT,
  RACE_DEITIES,
  getClassAgeCategory,
  rollRandomAge,
  getAgeBracket,
  rollRandomHeightWeight,
  pickRandomDeity,
  getDeityNote,
};
