/**
 * PF1e Structured Spell Effect Data
 *
 * Maps spell names to their actual mechanical effects per RAW.
 * Spells not in this table fall back to AI narration.
 *
 * Effect types:
 *   damage   — rolls dice, deals HP damage to target(s)
 *   healing  — rolls dice, restores HP to target(s)
 *   buff     — applies condition/modifier to caster or ally
 *   debuff   — applies condition/modifier to enemy (usually with save)
 *   control  — restricts actions (usually with save)
 *   utility  — non-combat or mixed effect
 *   summon   — creates a creature (narrative for now)
 *
 * Duration shorthand parsed by durationToRounds():
 *   "instantaneous"            → 0 (no tracking)
 *   "1 round/level"            → casterLevel rounds
 *   "10 min/level"             → casterLevel * 100 rounds
 *   "1 min/level"              → casterLevel * 10 rounds
 *   "1 hour/level"             → casterLevel * 600 rounds (simplified in combat to "permanent until rest")
 *   "concentration"            → until caster stops concentrating
 *   "Xd4 rounds"              → rolled
 *   "X rounds"                → fixed
 *   "permanent"               → no expiry
 */

// ─────────────────────────────────────────────────────
// DAMAGE SPELLS
// ─────────────────────────────────────────────────────

const DAMAGE_SPELLS = {
  // ── Cantrips ──
  'Acid Splash': {
    type: 'damage', damageType: 'acid',
    damage: { dice: 1, sides: 3, perLevel: false },
    range: 'close', target: 'single', save: 'none', sr: true,
  },
  'Ray of Frost': {
    type: 'damage', damageType: 'cold',
    damage: { dice: 1, sides: 3, perLevel: false },
    range: 'close', target: 'single', save: 'none', sr: true,
  },

  // ── Level 1 ──
  'Burning Hands': {
    type: 'damage', damageType: 'fire',
    damage: { dice: 1, sides: 4, perLevel: true, maxDice: 5 },
    range: 'cone15', target: 'area', save: 'Ref half', sr: true,
  },
  'Magic Missile': {
    type: 'damage', damageType: 'force',
    damage: { special: 'magic_missile' },
    range: 'medium', target: 'single', save: 'none', sr: true,
  },
  'Shocking Grasp': {
    type: 'damage', damageType: 'electricity',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 5 },
    range: 'touch', target: 'single', save: 'none', sr: true,
  },
  'Snowball': {
    type: 'damage', damageType: 'cold',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 5 },
    range: 'close', target: 'single', save: 'Fort partial', sr: false,
    onFailedSave: { condition: 'staggered', duration: '1 round' },
  },
  'Cause Fear': {
    type: 'debuff',
    save: 'Will negates', sr: true,
    condition: 'frightened', duration: '1d4 rounds',
    hdLimit: 6, // Only affects creatures with 5 HD or less (< 6)
  },

  // ── Level 2 ──
  'Scorching Ray': {
    type: 'damage', damageType: 'fire',
    damage: { special: 'scorching_ray' },
    range: 'close', target: 'ray', save: 'none', sr: true,
  },
  'Acid Arrow': {
    type: 'damage', damageType: 'acid',
    damage: { dice: 2, sides: 4, perLevel: false },
    range: 'long', target: 'ray', save: 'none', sr: false,
    dot: { dice: 2, sides: 4, rounds: 'special_acid_arrow' }, // 1 extra round per 3 CL above 3
  },

  // ── Level 3 ──
  'Fireball': {
    type: 'damage', damageType: 'fire',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 10 },
    range: 'long', target: 'area', save: 'Ref half', sr: true,
  },
  'Lightning Bolt': {
    type: 'damage', damageType: 'electricity',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 10 },
    range: 'line120', target: 'area', save: 'Ref half', sr: true,
  },

  // ── Level 4 ──
  'Ice Storm': {
    type: 'damage', damageType: 'cold_bludgeoning',
    damage: { special: 'ice_storm' }, // 3d6 bludgeoning + 2d6 cold
    range: 'long', target: 'area', save: 'none', sr: true,
  },
  'Phantasmal Killer': {
    type: 'damage', damageType: 'death',
    damage: { special: 'phantasmal_killer' },
    range: 'medium', target: 'single',
    save: 'Will disbelief then Fort partial', sr: true,
    onFailedSave: { death: true, onPartialFail: { dice: 3, sides: 6, damageType: 'fear' } },
  },
  'Shout': {
    type: 'damage', damageType: 'sonic',
    damage: { dice: 5, sides: 6, perLevel: false },
    range: 'cone30', target: 'area', save: 'Fort partial', sr: true,
    onFailedSave: { condition: 'deafened', duration: '2d6 rounds' },
  },

  // ── Level 5 ──
  'Cone of Cold': {
    type: 'damage', damageType: 'cold',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 15 },
    range: 'cone60', target: 'area', save: 'Ref half', sr: true,
  },
  'Flame Strike': {
    type: 'damage', damageType: 'fire_divine',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 15 }, // Half fire, half divine
    range: 'medium', target: 'area', save: 'Ref half', sr: true,
  },

  // ── Level 6 ──
  'Chain Lightning': {
    type: 'damage', damageType: 'electricity',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 20 },
    range: 'long', target: 'chain', save: 'Ref half', sr: true,
    secondaryDamage: { dice: 'half' }, // Secondary targets take half
  },
  'Disintegrate': {
    type: 'damage', damageType: 'force',
    damage: { dice: 2, sides: 6, perLevel: true, maxDice: 40 },
    range: 'medium', target: 'ray', save: 'Fort partial', sr: true,
    onSave: { dice: 5, sides: 6 }, // 5d6 on successful save
  },
  'Harm': {
    type: 'damage', damageType: 'negative',
    damage: { special: 'harm' }, // 10 HP/CL, max 150
    range: 'touch', target: 'single', save: 'Will half', sr: true,
  },

  // ── Level 7 ──
  'Finger of Death': {
    type: 'damage', damageType: 'death',
    damage: { special: 'finger_of_death' }, // 10 HP/CL on failed save, 3d6+CL on success
    range: 'close', target: 'single', save: 'Fort partial', sr: true,
  },

  // ── Level 8 ──
  'Polar Ray': {
    type: 'damage', damageType: 'cold',
    damage: { dice: 1, sides: 6, perLevel: true, maxDice: 25 },
    range: 'medium', target: 'ray', save: 'none', sr: true,
  },

  // ── Level 9 ──
  'Meteor Swarm': {
    type: 'damage', damageType: 'fire_bludgeoning',
    damage: { special: 'meteor_swarm' }, // 4 meteors, 6d6 bludgeoning + 24d6 fire
    range: 'long', target: 'area', save: 'Ref half', sr: true,
  },

  // ── Healing Damage ──
  'Searing Light': {
    type: 'damage', damageType: 'fire_light',
    damage: { special: 'searing_light' }, // Varies by target type
    range: 'medium', target: 'ray', save: 'none', sr: true,
  },
  'Sound Burst': {
    type: 'damage', damageType: 'sonic',
    damage: { dice: 1, sides: 8, perLevel: false },
    range: 'close', target: 'area', save: 'Fort partial', sr: true,
    onFailedSave: { condition: 'stunned', duration: '1 round' },
  },
  'Holy Smite': {
    type: 'damage', damageType: 'holy',
    damage: { special: 'holy_smite' }, // 1d8/2CL vs evil, half vs neutral
    range: 'medium', target: 'area', save: 'Will partial', sr: true,
    onFailedSave: { condition: 'blinded', duration: '1 round' },
  },
  'Unholy Blight': {
    type: 'damage', damageType: 'unholy',
    damage: { special: 'unholy_blight' },
    range: 'medium', target: 'area', save: 'Will partial', sr: true,
    onFailedSave: { condition: 'sickened', duration: '1d4 rounds' },
  },
};


// ─────────────────────────────────────────────────────
// HEALING SPELLS
// ─────────────────────────────────────────────────────

const HEALING_SPELLS = {
  'Cure Light Wounds': {
    type: 'healing',
    healing: { dice: 1, sides: 8, bonusPerLevel: 1, maxBonus: 5 },
    range: 'touch', target: 'single',
  },
  'Cure Moderate Wounds': {
    type: 'healing',
    healing: { dice: 2, sides: 8, bonusPerLevel: 1, maxBonus: 10 },
    range: 'touch', target: 'single',
  },
  'Cure Serious Wounds': {
    type: 'healing',
    healing: { dice: 3, sides: 8, bonusPerLevel: 1, maxBonus: 15 },
    range: 'touch', target: 'single',
  },
  'Cure Critical Wounds': {
    type: 'healing',
    healing: { dice: 4, sides: 8, bonusPerLevel: 1, maxBonus: 20 },
    range: 'touch', target: 'single',
  },
  'Heal': {
    type: 'healing',
    healing: { special: 'heal' }, // 10 HP/CL, max 150
    range: 'touch', target: 'single',
    removesConditions: ['exhausted', 'fatigued', 'nauseated', 'sickened', 'stunned', 'confused', 'dazed'],
  },
  'Mass Cure Light Wounds': {
    type: 'healing',
    healing: { dice: 1, sides: 8, bonusPerLevel: 1, maxBonus: 25 },
    range: 'close', target: 'mass',
  },
  'Mass Cure Moderate Wounds': {
    type: 'healing',
    healing: { dice: 2, sides: 8, bonusPerLevel: 1, maxBonus: 30 },
    range: 'close', target: 'mass',
  },
  'Mass Cure Serious Wounds': {
    type: 'healing',
    healing: { dice: 3, sides: 8, bonusPerLevel: 1, maxBonus: 35 },
    range: 'close', target: 'mass',
  },
  'Mass Cure Critical Wounds': {
    type: 'healing',
    healing: { dice: 4, sides: 8, bonusPerLevel: 1, maxBonus: 40 },
    range: 'close', target: 'mass',
  },
  'Channel Positive Energy': {
    type: 'healing',
    healing: { special: 'channel' }, // 1d6 per 2 cleric levels
    range: 'burst30', target: 'mass',
  },
  'Breath of Life': {
    type: 'healing',
    healing: { dice: 5, sides: 8, bonusPerLevel: 1, maxBonus: 25 },
    range: 'touch', target: 'single',
    special: 'can_revive', // Can revive if dead < 1 round
  },
};


// ─────────────────────────────────────────────────────
// BUFF SPELLS
// ─────────────────────────────────────────────────────

const BUFF_SPELLS = {
  // ── AC Buffs ──
  'Mage Armor': {
    type: 'buff', condition: null, // Not a condition, direct stat mod
    modifiers: { armorBonus: 4 },
    duration: '1 hour/level', range: 'touch', target: 'single',
  },
  'Shield': {
    type: 'buff',
    modifiers: { shieldBonus: 4 },
    duration: '1 min/level', range: 'self', target: 'self',
  },
  'Shield of Faith': {
    type: 'buff',
    modifiers: { deflectionBonus: 2 }, // +1 per 6 CL above 1st, max +5
    modifierScaling: { deflectionBonus: { base: 2, perLevels: 6, startAt: 6, max: 5 } },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  'Barkskin': {
    type: 'buff', condition: 'barkskin',
    modifiers: { naturalArmor: 2 }, // +1 per 3 CL above 3rd, max +5
    modifierScaling: { naturalArmor: { base: 2, perLevels: 3, startAt: 6, max: 5 } },
    duration: '10 min/level', range: 'touch', target: 'single',
  },

  // ── Attack/Damage Buffs ──
  'Bless': {
    type: 'buff', condition: 'bless',
    modifiers: { attack: 1, saves: { fear: 1 } },
    duration: '1 min/level', range: 'burst50', target: 'allies',
  },
  'Divine Favor': {
    type: 'buff',
    modifiers: { special: 'divine_favor' }, // +1 luck per 3 CL, max +3
    modifierScaling: { attack: { base: 1, perLevels: 3, startAt: 1, max: 3 }, damage: { base: 1, perLevels: 3, startAt: 1, max: 3 } },
    duration: '1 min', range: 'self', target: 'self',
  },
  'Divine Power': {
    type: 'buff',
    modifiers: { attack: 0, damage: 0, strBonus: 6, tempHP: 'casterLevel' },
    babOverride: 'casterLevel', // BAB becomes equal to CL
    duration: '1 round/level', range: 'self', target: 'self',
  },

  // ── Ability Buffs ──
  "Bull's Strength": {
    type: 'buff',
    modifiers: { strBonus: 4 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  "Bear's Endurance": {
    type: 'buff',
    modifiers: { conBonus: 4 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  "Cat's Grace": {
    type: 'buff',
    modifiers: { dexBonus: 4 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  "Eagle's Splendor": {
    type: 'buff',
    modifiers: { chaBonus: 4 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  "Fox's Cunning": {
    type: 'buff',
    modifiers: { intBonus: 4 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  "Owl's Wisdom": {
    type: 'buff',
    modifiers: { wisBonus: 4 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  'Enlarge Person': {
    type: 'buff', condition: 'enlarged',
    modifiers: { strBonus: 2, dexPenalty: -2, attack: -1, ac: -1 },
    duration: '1 min/level', range: 'close', target: 'single',
  },

  // ── Defensive Buffs ──
  'Mirror Image': {
    type: 'buff',
    modifiers: { mirrorImages: 'special' }, // 1d4+1 per 3 CL (max 8)
    duration: '1 min/level', range: 'self', target: 'self',
  },
  'Displacement': {
    type: 'buff',
    modifiers: { missChance: 50 },
    duration: '1 round/level', range: 'touch', target: 'single',
  },
  'Blur': {
    type: 'buff',
    modifiers: { missChance: 20 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  'Stoneskin': {
    type: 'buff',
    modifiers: { dr: '10/adamantine' },
    duration: '10 min/level', range: 'touch', target: 'single',
    drPool: 'special', // Absorbs 10 HP/CL, max 150
  },
  'Protection from Energy': {
    type: 'buff',
    modifiers: { energyAbsorb: 'special' }, // Absorbs 12 HP/CL (max 120) of chosen energy
    duration: '10 min/level', range: 'touch', target: 'single',
  },
  'Resist Energy': {
    type: 'buff',
    modifiers: { energyResist: 10 }, // 10, 20 at 7th, 30 at 11th
    modifierScaling: { energyResist: { base: 10, thresholds: [[7, 20], [11, 30]] } },
    duration: '10 min/level', range: 'touch', target: 'single',
  },

  // ── Speed/Mobility Buffs ──
  'Haste': {
    type: 'buff', condition: 'haste',
    modifiers: { attack: 1, ac: 1, saves: { Ref: 1 }, speedBonus: 30, extraAttack: true },
    duration: '1 round/level', range: 'close', target: 'allies', maxTargets: 'casterLevel',
  },
  'Fly': {
    type: 'buff',
    modifiers: { flySpeed: 60 },
    duration: '1 min/level', range: 'touch', target: 'single',
  },
  'Invisibility': {
    type: 'buff', condition: 'invisible',
    modifiers: { attack: 2, skills: { Stealth: 20 } },
    duration: '1 min/level', range: 'touch', target: 'single',
    endsOnAttack: true,
  },
  'Greater Invisibility': {
    type: 'buff', condition: 'invisible',
    modifiers: { attack: 2, skills: { Stealth: 20 }, missChance: 50 },
    duration: '1 round/level', range: 'touch', target: 'single',
  },

  // ── Composite Buffs ──
  'Righteous Might': {
    type: 'buff',
    modifiers: { strBonus: 4, conBonus: 4, naturalArmor: 2, ac: -1, attack: -1 },
    duration: '1 round/level', range: 'self', target: 'self',
    special: 'size_increase',
  },
  'Prayer': {
    type: 'buff',
    modifiers: { attack: 1, damage: 1, saves: { all: 1 }, skills: { all: 1 } },
    enemyModifiers: { attack: -1, damage: -1, saves: { all: -1 }, skills: { all: -1 } },
    duration: '1 round/level', range: 'burst40', target: 'allies',
  },
};


// ─────────────────────────────────────────────────────
// DEBUFF / CONTROL SPELLS
// ─────────────────────────────────────────────────────

const DEBUFF_SPELLS = {
  // ── Save-or-suck ──
  'Hold Person': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: 'paralyzed', duration: '1 round/level',
    savePerRound: true, // Target gets new save each round
    targetType: 'humanoid',
  },
  'Hold Monster': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: 'paralyzed', duration: '1 round/level',
    savePerRound: true,
  },
  'Dominate Person': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: null, // Special: controlled by caster
    duration: '1 day/level',
    targetType: 'humanoid',
    special: 'dominated',
  },
  'Sleep': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: 'unconscious', duration: '1 min/level',
    hdLimit: 5, // Affects 4 HD of creatures (total HD pool)
    hdPool: 4,
  },
  'Deep Slumber': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: 'unconscious', duration: '1 min/level',
    hdLimit: 11, // 10 HD max
    hdPool: 10,
  },
  'Color Spray': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: 'stunned', duration: '1 round', // Simplified; varies by HD
  },
  'Hideous Laughter': {
    type: 'control',
    save: 'Will negates', sr: true,
    condition: 'prone', duration: '1 round/level',
    additionalCondition: { condition: 'helpless', description: 'Laughing, cannot act' },
    savePerRound: true,
  },

  // ── Debuffs ──
  'Blindness/Deafness': {
    type: 'debuff',
    save: 'Fort negates', sr: true,
    condition: 'blinded', // Caster chooses blind or deaf
    duration: 'permanent',
  },
  'Bestow Curse': {
    type: 'debuff',
    save: 'Will negates', sr: true,
    condition: null, // Multiple options
    duration: 'permanent',
    curseOptions: [
      { name: 'Ability Drain', modifiers: { abilityDrain: 6 }, description: '-6 to one ability score' },
      { name: 'Penalty', modifiers: { attack: -4, saves: { all: -4 }, skills: { all: -4 } }, description: '-4 on attacks, saves, and checks' },
      { name: 'Inaction', special: 'lose_turn_50', description: '50% chance each round to act normally; otherwise take no action' },
    ],
  },
  'Ray of Enfeeblement': {
    type: 'debuff',
    save: 'Fort half', sr: true,
    condition: null,
    modifiers: { strPenalty: '1d6+CL/2' }, // 1d6 + 1 per 2 CL (max +5)
    duration: '1 round/level',
  },
  'Slow': {
    type: 'debuff',
    save: 'Will negates', sr: true,
    condition: null,
    modifiers: { attack: -1, ac: -1, saves: { Ref: -1 }, singleAction: true, speed: 0.5 },
    duration: '1 round/level',
    maxTargets: 'casterLevel',
  },
  'Feeblemind': {
    type: 'debuff',
    save: 'Will negates', sr: true,
    condition: null,
    modifiers: { intOverride: 1, chaOverride: 1, cannotCast: true },
    duration: 'permanent',
  },
  'Flesh to Stone': {
    type: 'debuff',
    save: 'Fort negates', sr: true,
    condition: 'petrified', duration: 'permanent',
  },
  'Glitterdust': {
    type: 'debuff',
    save: 'Will negates', sr: false,
    condition: 'blinded', duration: '1 round/level',
    additionalEffect: { name: 'outline', description: 'Outlined creatures cannot be invisible', modifiers: {} },
    alwaysApplies: ['outline'], // Outline applies regardless of save
  },
  'Web': {
    type: 'control',
    save: 'Ref negates', sr: false,
    condition: 'entangled', duration: '10 min/level',
    target: 'area',
  },
  'Grease': {
    type: 'control',
    save: 'Ref negates', sr: false,
    condition: 'prone', duration: '1 min/level',
    target: 'area',
    savePerRound: true,
  },
  'Entangle': {
    type: 'control',
    save: 'Ref partial', sr: false,
    condition: 'entangled', duration: '1 min/level',
    target: 'area',
  },
  'Stinking Cloud': {
    type: 'control',
    save: 'Fort negates', sr: false,
    condition: 'nauseated', duration: '1 round/level',
    target: 'area',
    onSave: { condition: 'sickened', duration: '1d4+1 rounds' },
  },
  'Fear': {
    type: 'debuff',
    save: 'Will partial', sr: true,
    condition: 'frightened', duration: '1 round/level',
    onSave: { condition: 'shaken', duration: '1 round' },
    target: 'area',
  },

  // ── Power Words ──
  'Power Word Stun': {
    type: 'control',
    save: 'none', sr: true,
    condition: 'stunned', duration: 'special_power_word_stun',
    hpThreshold: 150, // Only affects target with <= 150 HP
  },
  'Power Word Kill': {
    type: 'control',
    save: 'none', sr: true,
    condition: null, special: 'instant_death',
    hpThreshold: 100, // Only affects target with <= 100 HP
  },
};


// ─────────────────────────────────────────────────────
// COMBINED EXPORT
// ─────────────────────────────────────────────────────

export const SPELL_EFFECTS = {
  ...DAMAGE_SPELLS,
  ...HEALING_SPELLS,
  ...BUFF_SPELLS,
  ...DEBUFF_SPELLS,
};

/**
 * Look up structured effect data for a spell.
 * Returns null if the spell has no structured data (falls back to AI narration).
 * Case-insensitive matching.
 */
export function getSpellEffect(spellName) {
  if (!spellName) return null;
  const lower = spellName.toLowerCase();
  for (const [name, data] of Object.entries(SPELL_EFFECTS)) {
    if (name.toLowerCase() === lower) return { name, ...data };
  }
  return null;
}

/**
 * Check if we have structured effect data for a spell.
 */
export function hasSpellEffect(spellName) {
  return getSpellEffect(spellName) !== null;
}

/**
 * Get all spell names that have structured effects.
 */
export function getStructuredSpellNames() {
  return Object.keys(SPELL_EFFECTS);
}
