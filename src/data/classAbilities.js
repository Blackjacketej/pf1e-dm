/**
 * PF1e Class Abilities — Complete Structured Mechanical Data
 * BLOCK 1: CORE RULEBOOK (11 classes)
 *
 * Every class feature from the PF1e Core Rulebook mapped to mechanical effects.
 * Consumed by classAbilityResolver.js for enforcement.
 *
 * Ability types:
 *   passive          — always-on modifier (e.g., Divine Grace, Fast Movement)
 *   extra_damage     — bonus damage on qualifying attacks (Sneak Attack)
 *   self_buff        — activated buff on self (Rage, Mutagen)
 *   party_buff       — activated buff on allies (Bardic Performance, Aura of Courage)
 *   targeted_buff    — activated buff on specific target (Smite Evil)
 *   targeted_heal_or_damage — single target heal/harm (Lay on Hands, Channel Energy)
 *   area_heal_or_damage — AoE heal/harm (Channel Energy burst)
 *   full_attack_modifier — modifies full attack action (Flurry of Blows)
 *   polymorph        — shape change with stat replacement (Wild Shape)
 *   passive_save_modifier — modifies save outcomes (Evasion)
 *   resource_pool    — expendable pool (Ki Pool, Arcane Pool)
 *   judgment         — variable scaling bonus (Inquisitor Judgment)
 */

// ═══════════════════════════════════════════════════════
//  B A R B A R I A N
// ═══════════════════════════════════════════════════════

// Note: Barbarian Fast Movement is handled by MONK_FAST_MOVEMENT (shared, classes: ['Barbarian', 'Monk'])

export const BARBARIAN_RAGE = {
  name: 'Rage',
  classes: ['Barbarian'],
  type: 'self_buff',
  action: 'free',
  minLevel: 1,
  description: 'Enter a furious rage gaining STR, CON, Will bonuses but AC penalty.',
  roundsPerDay: (level, conMod) => 4 + conMod + (level - 1) * 2,
  modifiers: (level) => {
    if (level >= 20) return { strBonus: 8, conBonus: 8, saves: { Will: 4 }, ac: -2, cannotConcentrate: true };
    if (level >= 11) return { strBonus: 6, conBonus: 6, saves: { Will: 3 }, ac: -2, cannotConcentrate: true };
    return { strBonus: 4, conBonus: 4, saves: { Will: 2 }, ac: -2, cannotConcentrate: true };
  },
  fatigueAfter: 2,
  restrictions: { cannotCast: true },
};

export const BARBARIAN_RAGE_POWER = {
  name: 'Rage Power',
  classes: ['Barbarian'],
  type: 'passive',
  minLevel: 2,
  description: 'Gain a rage power usable while raging. Selected at even levels.',
  levelInterval: 2,
  // Rage powers are selected by the player — this tracks eligibility
  powersKnown: (level) => Math.floor(level / 2),
};

export const BARBARIAN_UNCANNY_DODGE = {
  name: 'Uncanny Dodge',
  classes: ['Barbarian', 'Rogue'],
  type: 'passive',
  minLevel: { Barbarian: 2, Rogue: 4 },
  description: 'Cannot be caught flat-footed, retains DEX bonus to AC vs invisible attackers.',
  effect: 'retain_dex_to_ac',
};

export const BARBARIAN_TRAP_SENSE = {
  name: 'Trap Sense',
  classes: ['Barbarian', 'Rogue'],
  type: 'passive',
  minLevel: 3,
  description: 'Bonus on Reflex saves and AC vs traps.',
  scaling: (level, className) => {
    if (className === 'Barbarian') return Math.floor(level / 3);
    if (className === 'Rogue') return Math.floor(level / 3);
    return 0;
  },
  modifiers: (bonus) => ({ saves: { Ref: bonus }, ac: bonus }),
  context: 'traps_only',
};

export const BARBARIAN_IMPROVED_UNCANNY_DODGE = {
  name: 'Improved Uncanny Dodge',
  classes: ['Barbarian', 'Rogue'],
  type: 'passive',
  minLevel: { Barbarian: 5, Rogue: 8 },
  description: 'Cannot be flanked unless attacker has 4+ more rogue/barbarian levels.',
  effect: 'cannot_be_flanked',
  flankedByLevelThreshold: 4,
};

export const BARBARIAN_DR = {
  name: 'Damage Reduction',
  classes: ['Barbarian'],
  type: 'passive',
  minLevel: 7,
  description: 'Gain DR/-.',
  dr: (level) => {
    if (level < 7) return 0;
    return Math.floor((level - 4) / 3); // 1 at 7, 2 at 10, 3 at 13, 4 at 16, 5 at 19
  },
  drType: '/-',
};

export const BARBARIAN_GREATER_RAGE = {
  name: 'Greater Rage',
  classes: ['Barbarian'],
  type: 'passive', // Modifies Rage
  minLevel: 11,
  description: 'Rage bonuses increase to +6 STR/CON, +3 Will.',
  // Handled by BARBARIAN_RAGE.modifiers(level) scaling
};

export const BARBARIAN_INDOMITABLE_WILL = {
  name: 'Indomitable Will',
  classes: ['Barbarian'],
  type: 'passive',
  minLevel: 14,
  description: '+4 bonus on Will saves vs enchantment while raging.',
  modifiers: { saves: { Will: 4 } },
  context: 'while_raging_vs_enchantment',
};

export const BARBARIAN_TIRELESS_RAGE = {
  name: 'Tireless Rage',
  classes: ['Barbarian'],
  type: 'passive',
  minLevel: 17,
  description: 'No longer fatigued after rage ends.',
  effect: 'no_fatigue_after_rage',
};

export const BARBARIAN_MIGHTY_RAGE = {
  name: 'Mighty Rage',
  classes: ['Barbarian'],
  type: 'passive', // Modifies Rage
  minLevel: 20,
  description: 'Rage bonuses increase to +8 STR/CON, +4 Will.',
  // Handled by BARBARIAN_RAGE.modifiers(level) scaling
};


// ═══════════════════════════════════════════════════════
//  B A R D
// ═══════════════════════════════════════════════════════

export const BARD_CANTRIPS = {
  name: 'Cantrips (Bard)',
  classes: ['Bard'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells (known as cantrips) can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const BARD_BARDIC_KNOWLEDGE = {
  name: 'Bardic Knowledge',
  classes: ['Bard'],
  type: 'passive',
  minLevel: 1,
  description: 'Add half class level (min 1) to all Knowledge checks; can make untrained.',
  modifiers: (level) => ({
    skills: { Knowledge: Math.max(1, Math.floor(level / 2)) },
  }),
  effect: 'knowledge_untrained',
};

export const BARD_BARDIC_PERFORMANCE = {
  name: 'Bardic Performance',
  classes: ['Bard'],
  type: 'party_buff',
  action: 'standard',
  minLevel: 1,
  description: 'Use Perform skill to create magical effects.',
  actionByLevel: (level) => level >= 13 ? 'swift' : level >= 7 ? 'move' : 'standard',
  roundsPerDay: (level, chaMod) => 4 + chaMod + (level - 1) * 2,
  performances: {
    countersong: {
      name: 'Countersong',
      minLevel: 1,
      description: 'Use Perform check in place of saving throw vs sonic/language-dependent effects for allies within 30 ft.',
      action: 'standard',
      duration: 10, // rounds
    },
    distraction: {
      name: 'Distraction',
      minLevel: 1,
      description: 'Use Perform check in place of saving throw vs illusion (pattern/figment) for allies within 30 ft.',
      action: 'standard',
    },
    fascinate: {
      name: 'Fascinate',
      minLevel: 1,
      saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod,
      saveType: 'Will',
      maxTargets: (level) => Math.max(1, Math.floor(level / 3)),
      description: 'Fascinate creatures within 90 ft. (Will negates).',
    },
    inspire_courage: {
      name: 'Inspire Courage',
      minLevel: 1,
      modifiers: (level) => {
        const bonus = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
        return { attack: bonus, damage: bonus, saves: { fear: bonus, charm: bonus } };
      },
      affectsAllies: true,
      description: 'Morale bonus on attack, damage, saves vs fear/charm for all allies.',
    },
    inspire_competence: {
      name: 'Inspire Competence',
      minLevel: 3,
      modifiers: (level) => {
        const bonus = 2 + Math.floor((level - 3) / 4);
        return { skills: { specific: bonus } };
      },
      affectsSingleAlly: true,
      description: 'Competence bonus on one skill check for one ally.',
    },
    suggestion: {
      name: 'Suggestion',
      minLevel: 6,
      saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod,
      saveType: 'Will',
      description: 'As suggestion spell on a fascinated creature.',
    },
    inspire_greatness: {
      name: 'Inspire Greatness',
      minLevel: 9,
      modifiers: () => ({
        bonusHD: 2, // +2d10 temp HP
        attack: 2, // CRB p37: +2 competence bonus on attack rolls
        saves: { Fort: 1 },
      }),
      maxTargets: (level) => 1 + Math.floor((level - 9) / 3),
      description: '+2 bonus HD, +1 attack, +1 Fort for allies.',
    },
    soothing_performance: {
      name: 'Soothing Performance',
      minLevel: 12,
      description: 'As mass cure serious wounds (CL = bard level).',
      healing: (level) => ({ dice: 3, sides: 8, bonus: level }),
    },
    inspire_heroics: {
      name: 'Inspire Heroics',
      minLevel: 15,
      modifiers: () => ({ ac: 4, saves: { all: 4 } }),
      maxTargets: (level) => 1 + Math.floor((level - 15) / 3),
      description: '+4 dodge AC, +4 morale saves.',
    },
    mass_suggestion: {
      name: 'Mass Suggestion',
      minLevel: 18,
      saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod,
      saveType: 'Will',
      description: 'As mass suggestion on fascinated creatures.',
    },
    deadly_performance: {
      name: 'Deadly Performance',
      minLevel: 20,
      saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod,
      saveType: 'Fort',
      description: 'Target must Fort save or die. Success = 3d6+level damage + staggered.',
      onFailedSave: 'death',
      onPassedSave: (level) => ({ damage: { dice: 3, sides: 6, bonus: level }, condition: 'staggered' }),
    },
  },
};

export const BARD_VERSATILE_PERFORMANCE = {
  name: 'Versatile Performance',
  classes: ['Bard'],
  type: 'passive',
  minLevel: 2,
  description: 'Use Perform skill rank in place of associated skills.',
  levelInterval: 4, // Gain at 2, 6, 10, 14, 18
  performSkillMap: {
    'Act': ['Bluff', 'Disguise'],
    'Comedy': ['Bluff', 'Intimidate'],
    'Dance': ['Acrobatics', 'Fly'],
    'Keyboard': ['Diplomacy', 'Intimidate'],
    'Oratory': ['Diplomacy', 'Sense Motive'],
    'Percussion': ['Handle Animal', 'Intimidate'],
    'Sing': ['Bluff', 'Sense Motive'],
    'String': ['Bluff', 'Diplomacy'],
    'Wind': ['Diplomacy', 'Handle Animal'],
  },
};

export const BARD_WELL_VERSED = {
  name: 'Well-Versed',
  classes: ['Bard'],
  type: 'passive',
  minLevel: 2,
  description: '+4 save vs bardic performance, sonic, and language-dependent effects.',
  modifiers: { saves: { bardic: 4, sonic: 4, languageDependent: 4 } },
};

export const BARD_LORE_MASTER = {
  name: 'Lore Master',
  classes: ['Bard'],
  type: 'passive',
  minLevel: 5,
  description: 'Take 10 on Knowledge checks; take 20 once/day (plus once more per 6 levels).',
  take20PerDay: (level) => 1 + Math.floor((level - 5) / 6),
};

export const BARD_JACK_OF_ALL_TRADES = {
  name: 'Jack of All Trades',
  classes: ['Bard'],
  type: 'passive',
  minLevel: 10,
  description: 'Use any skill untrained. At 16, always take 10. At 19, take 20 once/day on any skill.',
  effect: 'all_skills_untrained',
};


// ═══════════════════════════════════════════════════════
//  C L E R I C
// ═══════════════════════════════════════════════════════

export const CLERIC_AURA = {
  name: 'Aura',
  classes: ['Cleric'],
  type: 'passive',
  minLevel: 1,
  description: 'Emit aura of alignment matching deity.',
  effect: 'detect_alignment_aura',
};

export const CLERIC_CHANNEL_ENERGY = {
  name: 'Channel Energy',
  classes: ['Cleric'],
  type: 'area_heal_or_damage',
  action: 'standard',
  minLevel: 1,
  description: 'Channel positive/negative energy in 30-ft burst.',
  scaling: {
    dicePerLevel: (level) => Math.max(1, Math.ceil(level / 2)),
    sides: 6,
  },
  usesPerDay: (level, chaMod) => 3 + chaMod,
  range: 30,
  saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod,
  saveType: 'Will',
  modes: {
    positive: { healsLiving: true, damagesUndead: true },
    negative: { damagesLiving: true, healsUndead: true },
  },
};

export const CLERIC_DOMAINS = {
  name: 'Domains',
  classes: ['Cleric'],
  type: 'passive',
  minLevel: 1,
  description: 'Choose 2 domains granting bonus spells and granted powers.',
  domainCount: 2,
  // Domain powers are defined per-domain; this tracks that cleric gets 2
  // Each domain grants: 1 bonus spell per spell level + 2 granted powers (1st and ~6-8th level)
};

export const CLERIC_SPONTANEOUS_CASTING = {
  name: 'Spontaneous Casting',
  classes: ['Cleric'],
  type: 'passive',
  minLevel: 1,
  description: 'Convert prepared spells into cure (positive) or inflict (negative) spells.',
  positiveChannel: 'cure_spells',
  negativeChannel: 'inflict_spells',
};

export const CLERIC_ORISONS = {
  name: 'Orisons',
  classes: ['Cleric', 'Druid'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};


// ═══════════════════════════════════════════════════════
//  D R U I D
// ═══════════════════════════════════════════════════════

export const DRUID_NATURE_BOND = {
  name: 'Nature Bond',
  classes: ['Druid'],
  type: 'passive',
  minLevel: 1,
  description: 'Choose animal companion OR cleric domain (from nature list).',
  options: ['animal_companion', 'domain'],
};

export const DRUID_NATURE_SENSE = {
  name: 'Nature Sense',
  classes: ['Druid'],
  type: 'passive',
  minLevel: 1,
  description: '+2 bonus on Knowledge (nature) and Survival checks.',
  modifiers: { skills: { 'Knowledge (nature)': 2, 'Survival': 2 } },
};

export const DRUID_WILD_EMPATHY = {
  name: 'Wild Empathy',
  classes: ['Druid', 'Ranger'],
  type: 'passive',
  minLevel: 1,
  description: 'Improve attitude of animals. Roll 1d20 + druid level + CHA mod.',
  check: (level, chaMod) => level + chaMod, // bonus to the d20 roll
};

export const DRUID_WOODLAND_STRIDE = {
  name: 'Woodland Stride',
  classes: ['Druid', 'Ranger'],
  type: 'passive',
  minLevel: { Druid: 2, Ranger: 7 },
  description: 'Move through natural undergrowth at normal speed without damage.',
  effect: 'ignore_natural_difficult_terrain',
};

export const DRUID_TRACKLESS_STEP = {
  name: 'Trackless Step',
  classes: ['Druid'],
  type: 'passive',
  minLevel: 3,
  description: 'Leave no trail in natural surroundings; cannot be tracked.',
  effect: 'cannot_be_tracked_natural',
};

export const DRUID_RESIST_NATURES_LURE = {
  name: "Resist Nature's Lure",
  classes: ['Druid'],
  type: 'passive',
  minLevel: 4,
  description: '+4 save vs spell-like and supernatural abilities of fey.',
  modifiers: { saves: { vsFey: 4 } },
};

export const DRUID_WILD_SHAPE = {
  name: 'Wild Shape',
  classes: ['Druid'],
  type: 'polymorph',
  action: 'standard',
  minLevel: 4,
  description: 'Transform into animal/elemental/plant forms.',
  usesPerDay: (level) => {
    if (level < 4) return 0;
    if (level < 6) return 1;
    if (level < 8) return 2;
    if (level < 10) return 3;
    if (level < 12) return 4;
    if (level < 14) return 5;
    if (level < 16) return 6;
    if (level < 18) return 7;
    if (level < 20) return 8;
    return Infinity; // CRB Table 3-7: at will at 20
  },
  duration: (level) => level, // hours
  formsByLevel: {
    4: { spell: 'beast_shape_i', sizes: ['Small', 'Medium'] },
    6: { spell: 'beast_shape_ii', sizes: ['Tiny', 'Large'] },
    8: { spell: 'beast_shape_iii', sizes: ['Diminutive', 'Huge'], alsoElemental: 'small' },
    10: { spell: 'beast_shape_iv', sizes: ['any'], alsoElemental: 'medium', alsoPlant: 'small' },
    12: { spell: 'beast_shape_iv', alsoElemental: 'large', alsoPlant: 'medium' },
  },
  // Beast Shape I (Small animal): +2 DEX, +1 natural armor
  // Beast Shape I (Medium animal): +2 STR, +2 natural armor
  // Beast Shape II (Tiny animal): +4 DEX, -2 STR, +1 natural armor
  // Beast Shape II (Large animal): +4 STR, -2 DEX, +4 natural armor
  formModifiers: {
    beast_shape_i_small: { dexBonus: 2, naturalArmor: 1, strPenalty: 0 },
    beast_shape_i_medium: { strBonus: 2, naturalArmor: 2 },
    beast_shape_ii_tiny: { dexBonus: 4, strPenalty: -2, naturalArmor: 1 },
    beast_shape_ii_large: { strBonus: 4, dexPenalty: -2, naturalArmor: 4 },
    beast_shape_iii_diminutive: { dexBonus: 6, strPenalty: -4, naturalArmor: 1 },
    beast_shape_iii_huge: { strBonus: 6, dexPenalty: -4, naturalArmor: 6 },
    elemental_small: { naturalArmor: 2 },
    elemental_medium: { strBonus: 2, naturalArmor: 3 },
    elemental_large: { strBonus: 4, dexBonus: 2, naturalArmor: 4, conBonus: 2 },
    elemental_huge: { strBonus: 6, dexBonus: 4, naturalArmor: 6, conBonus: 4 },
    plant_small: { strBonus: 2, naturalArmor: 2, conBonus: 2 },
    plant_medium: { strBonus: 4, naturalArmor: 4, conBonus: 2 },
  },
};

export const DRUID_VENOM_IMMUNITY = {
  name: 'Venom Immunity',
  classes: ['Druid'],
  type: 'passive',
  minLevel: 9,
  description: 'Immune to all poisons.',
  effect: 'poison_immunity',
};

export const DRUID_SPONTANEOUS_CASTING = {
  name: 'Spontaneous Casting (Druid)',
  classes: ['Druid'],
  type: 'passive',
  minLevel: 1,
  description: 'Convert prepared spells into summon nature\'s ally spells of the same level.',
  convertTo: 'summon_natures_ally',
};

export const DRUID_A_THOUSAND_FACES = {
  name: 'A Thousand Faces',
  classes: ['Druid'],
  type: 'passive',
  minLevel: 13,
  description: 'Alter self at will.',
  effect: 'alter_self_at_will',
};

// Timeless Body is shared with Monk — see MONK_TIMELESS_BODY (classes: ['Monk','Druid'], minLevel: { Monk: 17, Druid: 15 })


// ═══════════════════════════════════════════════════════
//  F I G H T E R
// ═══════════════════════════════════════════════════════

export const FIGHTER_BONUS_FEAT = {
  name: 'Bonus Combat Feat',
  classes: ['Fighter'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain a bonus combat feat at 1st and every even level.',
  featsGained: (level) => 1 + Math.floor(level / 2),
};

export const FIGHTER_BRAVERY = {
  name: 'Bravery',
  classes: ['Fighter'],
  type: 'passive',
  minLevel: 2,
  description: 'Bonus on Will saves vs fear.',
  scaling: (level) => level >= 2 ? 1 + Math.floor((level - 2) / 4) : 0,
  // +1 at 2, +2 at 6, +3 at 10, +4 at 14, +5 at 18
  modifiers: (level) => ({
    saves: { fear: Math.max(0, 1 + Math.floor((level - 2) / 4)) },
  }),
};

export const FIGHTER_ARMOR_TRAINING = {
  name: 'Armor Training',
  classes: ['Fighter'],
  type: 'passive',
  minLevel: 3,
  description: 'Reduce armor check penalty by 1 (+1 max DEX bonus). Increases at 7, 11, 15.',
  scaling: (level) => {
    if (level >= 15) return 4;
    if (level >= 11) return 3;
    if (level >= 7) return 2;
    if (level >= 3) return 1;
    return 0;
  },
  modifiers: (level) => {
    const bonus = FIGHTER_ARMOR_TRAINING.scaling(level);
    return {
      armorCheckReduction: bonus,
      maxDexIncrease: bonus,
    };
  },
  // At Armor Training 3 (level 11): move at full speed in medium armor
  // At Armor Training 4 (level 15): move at full speed in heavy armor
  mediumArmorFullSpeed: 11,
  heavyArmorFullSpeed: 15,
};

export const FIGHTER_WEAPON_TRAINING = {
  name: 'Weapon Training',
  classes: ['Fighter'],
  type: 'passive',
  minLevel: 5,
  description: '+1 attack/damage with chosen weapon group. Additional group at 9, 13, 17; earlier groups increase by +1.',
  scaling: (level) => {
    // Number of weapon groups
    if (level >= 17) return 4;
    if (level >= 13) return 3;
    if (level >= 9) return 2;
    if (level >= 5) return 1;
    return 0;
  },
  bonusForGroup: (level, groupIndex) => {
    // First group chosen at 5 gets +1, increases by +1 at 9, 13, 17
    // Second group at 9 gets +1, increases at 13, 17
    const groupStartLevel = 5 + (groupIndex * 4);
    if (level < groupStartLevel) return 0;
    return 1 + Math.floor((level - groupStartLevel) / 4);
  },
  modifiers: (level, groupBonus) => ({
    attack: groupBonus,
    damage: groupBonus,
  }),
  weaponGroups: [
    'Axes', 'Blades (Heavy)', 'Blades (Light)', 'Bows', 'Close', 'Crossbows',
    'Double', 'Flails', 'Hammers', 'Monk', 'Natural', 'Polearms', 'Spears', 'Thrown',
  ],
};

export const FIGHTER_WEAPON_MASTERY = {
  name: 'Weapon Mastery',
  classes: ['Fighter'],
  type: 'passive',
  minLevel: 20,
  description: 'Choose one weapon: auto-confirm crits, +1 crit multiplier, cannot be disarmed.',
  modifiers: {}, // CRB p56: no flat attack/damage bonus
  effects: ['auto_confirm_crits', 'crit_multiplier_increase_1', 'cannot_be_disarmed'],
};

export const FIGHTER_ARMOR_MASTERY = {
  name: 'Armor Mastery',
  classes: ['Fighter'],
  type: 'passive',
  minLevel: 19,
  description: 'DR 5/— when wearing armor or using a shield.',
  dr: 5,
  drType: '/-',
  requirement: 'wearing_armor_or_shield',
};


// ═══════════════════════════════════════════════════════
//  M O N K
// ═══════════════════════════════════════════════════════

export const MONK_BONUS_FEAT = {
  name: 'Bonus Feat (Monk)',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain bonus feats at 1st, 2nd, 6th, 10th, 14th, 18th. Choose from: Catch Off-Guard, Combat Reflexes, Deflect Arrows, Dodge, Improved Grapple, Scorpion Style, Throw Anything at 1st.',
  featsGained: (level) => {
    let count = 1; // L1
    if (level >= 2) count++;
    if (level >= 6) count++;
    if (level >= 10) count++;
    if (level >= 14) count++;
    if (level >= 18) count++;
    return count;
  },
};

export const MONK_STUNNING_FIST = {
  name: 'Stunning Fist',
  classes: ['Monk'],
  type: 'extra_damage',
  action: 'free', // Declared before attack
  minLevel: 1,
  description: 'Stun target on unarmed hit (Fort negates). Uses/day = level.',
  usesPerDay: (level) => level,
  saveDC: (level, wisMod) => 10 + Math.floor(level / 2) + wisMod,
  saveType: 'Fort',
  effect: 'stunned_1_round',
  alternateEffects: {
    4: 'fatigued',
    8: 'sickened_1_minute',
    12: 'staggered_1d6p1_rounds',
    16: 'permanent_blind_or_deaf',
    20: 'paralyzed_1d6p1_rounds',
  },
};

export const MONK_MANEUVER_TRAINING = {
  name: 'Maneuver Training',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 3,
  description: 'Use monk level in place of BAB for CMB. At 7, 11, 15, 19 gain +1 to CMB with chosen maneuver.',
  cmbBonus: (level) => {
    if (level < 7) return 0;
    return 1 + Math.floor((level - 7) / 4); // +1 at 7, +2 at 11, +3 at 15, +4 at 19
  },
  effect: 'monk_level_as_bab_for_cmb',
};

export const MONK_ABUNDANT_STEP = {
  name: 'Abundant Step',
  classes: ['Monk'],
  type: 'self_buff',
  action: 'move',
  minLevel: 12,
  description: 'Dimension door as a move action. Costs 2 ki.',
  kiCost: 2,
  effect: 'dimension_door',
  clLevel: (level) => level,
};

export const MONK_TONGUE_OF_SUN_AND_MOON = {
  name: 'Tongue of the Sun and Moon',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 17,
  description: 'Can speak with any living creature.',
  effect: 'speak_all_languages',
};

export const MONK_FLURRY_OF_BLOWS = {
  name: 'Flurry of Blows',
  classes: ['Monk'],
  type: 'full_attack_modifier',
  action: 'full-round',
  minLevel: 1,
  description: 'Make extra attacks at full BAB with monk weapons or unarmed strikes.',
  extraAttacks: (level) => {
    // CRB p57: +1 at 1 (TWF), +2 at 8 (ITWF), +3 at 15 (GTWF)
    if (level >= 15) return 3;
    if (level >= 8) return 2;
    return 1;
  },
  attackPenalty: () => -2, // CRB p57: Flurry uses TWF penalties (-2/-2 with light weapon)
  requiresMonkWeapon: true,
  requiresUnarmored: true,
};

export const MONK_UNARMED_STRIKE = {
  name: 'Unarmed Strike',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 1,
  description: 'Unarmed attacks deal increased damage scaling with level.',
  damageDice: (level, size = 'Medium') => {
    const mediumTable = {
      1: '1d6', 4: '1d8', 8: '1d10', 12: '2d6', 16: '2d8', 20: '2d10',
    };
    const smallTable = {
      1: '1d4', 4: '1d6', 8: '1d8', 12: '1d10', 16: '2d6', 20: '2d8',
    };
    const table = size === 'Small' ? smallTable : mediumTable;
    for (let l = level; l >= 1; l--) {
      if (table[l]) return table[l];
    }
    return size === 'Small' ? '1d4' : '1d6';
  },
};

export const MONK_AC_BONUS = {
  name: 'AC Bonus',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 1,
  description: 'Add WIS modifier to AC when unarmored and unencumbered. +1 AC at level 4 and every 4 after.',
  modifiers: (level, wisMod) => ({
    ac: Math.max(0, wisMod) + Math.floor(level / 4), // WIS mod + level scaling
  }),
  requirement: 'unarmored_unencumbered',
};

export const MONK_EVASION = {
  name: 'Evasion',
  classes: ['Rogue', 'Monk', 'Ranger'],
  type: 'passive_save_modifier',
  minLevel: { Rogue: 2, Monk: 2, Ranger: 9 },
  description: 'On successful Reflex save, take no damage instead of half.',
  effect: 'reflex_save_no_damage_on_success',
};

export const MONK_STILL_MIND = {
  name: 'Still Mind',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 3,
  description: '+2 save vs enchantment spells and effects.',
  modifiers: { saves: { enchantment: 2 } },
};

export const MONK_KI_POOL = {
  name: 'Ki Pool',
  classes: ['Monk'],
  type: 'resource_pool',
  minLevel: 4,
  description: 'Pool of ki points for special abilities.',
  poolSize: (level, wisMod) => Math.floor(level / 2) + wisMod,
  abilities: {
    extra_attack: { cost: 1, description: '+1 attack during flurry', effect: 'extra_attack_flurry' },
    speed_bonus: { cost: 1, description: '+20 ft. movement for 1 round', effect: { speedBonus: 20 } },
    ac_bonus: { cost: 1, description: '+4 dodge to AC for 1 round', effect: { ac: 4 } },
  },
  strikeTypes: {
    4: 'magic',    // Ki strikes count as magic
    7: 'cold_iron_silver', // Also count as cold iron and silver
    10: 'lawful',  // Also count as lawful
    16: 'adamantine', // Also count as adamantine
  },
};

export const MONK_SLOW_FALL = {
  name: 'Slow Fall',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 4,
  description: 'Reduce falling damage when near a wall.',
  distanceIgnored: (level) => {
    if (level >= 20) return Infinity; // Any distance
    return Math.floor(level / 2) * 10; // 20 ft at 4, 30 at 6, etc.
  },
};

export const MONK_PURITY_OF_BODY = {
  name: 'Purity of Body',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 5,
  description: 'Immune to all diseases (including supernatural/magical).',
  effect: 'disease_immunity',
};

export const MONK_HIGH_JUMP = {
  name: 'High Jump',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 5,
  description: 'Add level to Acrobatics checks for jumping. Always treated as having a running start. Spend 1 ki for +20 bonus.',
  modifiers: (level) => ({ skills: { Acrobatics_jump: level } }),
  kiBonus: 20,
};

export const MONK_WHOLENESS_OF_BODY = {
  name: 'Wholeness of Body',
  classes: ['Monk'],
  type: 'targeted_heal_or_damage',
  action: 'standard',
  minLevel: 7,
  description: 'Heal own damage equal to monk level. Costs 2 ki.',
  kiCost: 2,
  healing: (level) => level,
  targetSelfOnly: true,
};

export const MONK_IMPROVED_EVASION = {
  name: 'Improved Evasion',
  classes: ['Monk'],
  type: 'passive_save_modifier',
  minLevel: 9,
  description: 'On failed Reflex save, take half damage. On success, take none.',
  effect: 'reflex_save_half_on_fail',
};

export const MONK_DIAMOND_BODY = {
  name: 'Diamond Body',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 11,
  description: 'Immune to all poisons.',
  effect: 'poison_immunity',
};

export const MONK_DIAMOND_SOUL = {
  name: 'Diamond Soul',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 13,
  description: 'Gain spell resistance equal to monk level + 10.',
  sr: (level) => level + 10,
};

export const MONK_QUIVERING_PALM = {
  name: 'Quivering Palm',
  classes: ['Monk'],
  type: 'targeted_heal_or_damage',
  action: 'standard', // Part of an unarmed strike
  minLevel: 15,
  description: 'Set up vibration that can kill target. Fort save or die.',
  usesPerDay: () => 1, // Once per day
  saveDC: (level, wisMod) => 10 + Math.floor(level / 2) + wisMod,
  saveType: 'Fort',
  onFailedSave: 'death',
  kiCost: 0, // No ki cost, just limited use
};

export const MONK_TIMELESS_BODY = {
  name: 'Timeless Body',
  classes: ['Monk', 'Druid'],
  type: 'passive',
  minLevel: { Monk: 17, Druid: 15 },
  description: 'No longer takes penalties for aging (bonuses still apply).',
  effect: 'no_aging_penalties',
};

export const MONK_EMPTY_BODY = {
  name: 'Empty Body',
  classes: ['Monk'],
  type: 'self_buff',
  action: 'move',
  minLevel: 19,
  description: 'Become ethereal for 1 round per ki point spent.',
  kiCost: 3,
  effect: 'ethereal',
};

export const MONK_PERFECT_SELF = {
  name: 'Perfect Self',
  classes: ['Monk'],
  type: 'passive',
  minLevel: 20,
  description: 'Treated as outsider for spells/effects. DR 10/chaotic.',
  creatureType: 'outsider',
  dr: 10,
  drType: '/chaotic',
};

export const MONK_FAST_MOVEMENT = {
  name: 'Fast Movement',
  classes: ['Barbarian', 'Monk'],
  type: 'passive',
  minLevel: { Barbarian: 1, Monk: 3 },
  description: 'Bonus to land speed.',
  speedBonus: (level, className) => {
    if (className === 'Barbarian') return 10;
    if (className === 'Monk') return Math.floor(level / 3) * 10; // +10 at 3, +20 at 6, etc.
    return 0;
  },
};


// ═══════════════════════════════════════════════════════
//  P A L A D I N
// ═══════════════════════════════════════════════════════

export const PALADIN_AURA_OF_GOOD = {
  name: 'Aura of Good',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 1,
  description: 'Emit powerful aura of good.',
  effect: 'detect_alignment_aura',
};

export const PALADIN_DETECT_EVIL = {
  name: 'Detect Evil',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 1,
  description: 'At will, as the detect evil spell.',
  effect: 'detect_evil_at_will',
};

export const PALADIN_SMITE_EVIL = {
  name: 'Smite Evil',
  classes: ['Paladin'],
  type: 'targeted_buff',
  action: 'swift',
  minLevel: 1,
  description: '+CHA to attack, +level to damage, +CHA deflection vs target.',
  usesPerDay: (level) => 1 + Math.floor((level - 1) / 3), // 1/day, +1 at 4,7,10,13,16,19
  duration: 'until_target_dead_or_rest',
  modifiers: (level, chaMod) => ({
    attack: chaMod,
    damage: level,
    deflectionBonus: chaMod,
    doubleDamageFirstHit: ['dragon', 'outsider', 'undead'],
  }),
  requirement: 'target_must_be_evil',
};

export const PALADIN_DIVINE_GRACE = {
  name: 'Divine Grace',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 2,
  description: 'Add CHA modifier to all saving throws.',
  modifiers: (chaMod) => ({
    saves: { all: Math.max(0, chaMod) },
  }),
};

export const PALADIN_LAY_ON_HANDS = {
  name: 'Lay on Hands',
  classes: ['Paladin'],
  type: 'targeted_heal_or_damage',
  action: 'standard',
  minLevel: 2,
  description: 'Heal 1d6/2 levels or damage undead. Swift action on self.',
  scaling: {
    dicePerLevel: (level) => Math.max(1, Math.floor(level / 2)),
    sides: 6,
  },
  usesPerDay: (level, chaMod) => Math.floor(level / 2) + chaMod,
  selfAction: 'swift',
  damagesUndead: true,
  undeadSaveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod,
};

export const PALADIN_AURA_OF_COURAGE = {
  name: 'Aura of Courage',
  classes: ['Paladin'],
  type: 'party_buff',
  minLevel: 3,
  description: 'Paladin immune to fear; allies within 10 ft. get +4 vs fear.',
  selfEffect: 'fear_immunity',
  allyModifiers: { saves: { fear: 4 } },
  range: 10,
};

export const PALADIN_DIVINE_HEALTH = {
  name: 'Divine Health',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 3,
  description: 'Immune to all diseases.',
  effect: 'disease_immunity',
};

export const PALADIN_DIVINE_BOND = {
  name: 'Divine Bond',
  classes: ['Paladin'],
  type: 'self_buff',
  action: 'standard',
  minLevel: 5,
  description: 'Bond with weapon (add enhancement/properties) or mount (celestial steed).',
  options: ['weapon', 'mount'],
  weaponBond: {
    usesPerDay: (level) => 1 + Math.floor((level - 5) / 4), // 1/day at 5, 2 at 9, 3 at 13, 4 at 17
    duration: 1, // minutes per level
    enchantBonus: (level) => {
      if (level >= 20) return 6; // CRB p63: +6 at 20th level
      if (level >= 17) return 5;
      if (level >= 14) return 4;
      if (level >= 11) return 3;
      if (level >= 8) return 2;
      return 1;
    },
  },
  mountEffectiveDruidLevel: (level) => level,
};

export const PALADIN_CHANNEL_POSITIVE_ENERGY = {
  name: 'Channel Positive Energy',
  classes: ['Paladin'],
  type: 'area_heal_or_damage',
  action: 'standard',
  minLevel: 4,
  description: 'Channel positive energy using paladin level as effective cleric level.',
  scaling: {
    dicePerLevel: (level) => Math.max(1, Math.ceil(level / 2)), // CRB p63: uses paladin level, not level-3
    sides: 6,
  },
  usesPerDay: (level, chaMod) => 3 + chaMod,
  range: 30,
  saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod, // CRB p63: uses paladin level
  saveType: 'Will',
  costLayOnHands: 2, // Costs 2 uses of Lay on Hands
};

export const PALADIN_MERCY = {
  name: 'Mercy',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 3,
  description: 'Lay on Hands also removes a condition. Gain new mercies at 6, 9, 12, 15, 18.',
  merciesByLevel: {
    3: ['fatigued', 'sickened', 'shaken'],
    6: ['dazed', 'diseased', 'staggered'],
    9: ['cursed', 'exhausted', 'frightened', 'nauseated', 'poisoned'],
    12: ['blinded', 'deafened', 'paralyzed', 'stunned'],
    15: ['ability_damage', 'confusion', 'petrified'], // Greater mercies
    18: ['any_condition', 'restore_level_drain'],       // Ultimate mercies
  },
  merciesKnown: (level) => {
    let count = 0;
    if (level >= 3) count++;
    if (level >= 6) count++;
    if (level >= 9) count++;
    if (level >= 12) count++;
    if (level >= 15) count++;
    if (level >= 18) count++;
    return count;
  },
};

export const PALADIN_AURA_OF_RESOLVE = {
  name: 'Aura of Resolve',
  classes: ['Paladin'],
  type: 'party_buff',
  minLevel: 8,
  description: 'Allies within 10 ft. gain +4 morale bonus on saves vs charm effects. Self is immune to charm.',
  range: 10,
  modifiers: { saves: { charm: 4 } },
  selfEffect: 'charm_immunity',
};

export const PALADIN_AURA_OF_JUSTICE = {
  name: 'Aura of Justice',
  classes: ['Paladin'],
  type: 'party_buff',
  action: 'free',
  minLevel: 11,
  description: 'Expend 2 smite evil uses to grant smite evil to all allies within 10 ft.',
  range: 10,
  cost: 2, // smite evil uses
};

export const PALADIN_AURA_OF_FAITH = {
  name: 'Aura of Faith',
  classes: ['Paladin'],
  type: 'party_buff',
  minLevel: 14,
  description: 'Weapons of allies within 10 ft. treated as good-aligned for DR.',
  range: 10,
  effect: 'weapons_good_aligned',
};

export const PALADIN_AURA_OF_RIGHTEOUSNESS = {
  name: 'Aura of Righteousness',
  classes: ['Paladin'],
  type: 'party_buff',
  minLevel: 17,
  description: 'DR 5/evil, compulsion immunity; allies within 10 ft. gain DR 5/evil, +4 vs compulsion.',
  selfDR: { amount: 5, type: '/evil' },
  selfEffect: 'compulsion_immunity', // CRB p63: immune to compulsion spells and spell-like abilities
  allyDR: { amount: 5, type: '/evil' },
  allyModifiers: { saves: { compulsion: 4 } }, // CRB p63: +4 morale bonus vs compulsion effects
  range: 10,
};

export const PALADIN_HOLY_CHAMPION = {
  name: 'Holy Champion',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 20,
  description: 'DR 10/evil, smite evil maximizes damage on first hit, banishment on smite.',
  dr: 10,
  drType: '/evil',
  effects: ['smite_maximize_first_hit', 'smite_banishment'],
};

export const PALADIN_SPELLS = {
  name: 'Spells (Paladin)',
  classes: ['Paladin'],
  type: 'passive',
  minLevel: 4,
  description: 'Cast divine spells from the Paladin spell list (levels 1–4). CHA-based, prepared casting.',
  castingStat: 'CHA',
  casterType: 'prepared',
  maxSpellLevel: 4,
  spellListType: 'paladin',
};


// ═══════════════════════════════════════════════════════
//  R A N G E R
// ═══════════════════════════════════════════════════════

export const RANGER_FAVORED_ENEMY = {
  name: 'Favored Enemy',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 1,
  description: '+2 attack/damage, Bluff, Knowledge, Perception, Sense Motive, Survival vs chosen type. +2 more at 5, 10, 15, 20.',
  enemyTypes: [
    'Aberration', 'Animal', 'Construct', 'Dragon', 'Fey', 'Humanoid (human)',
    'Humanoid (elf)', 'Humanoid (dwarf)', 'Humanoid (orc)', 'Humanoid (goblinoid)',
    'Magical Beast', 'Monstrous Humanoid', 'Ooze', 'Outsider (evil)',
    'Outsider (good)', 'Outsider (chaotic)', 'Outsider (lawful)',
    'Plant', 'Undead', 'Vermin',
  ],
  bonusProgression: (level) => {
    // Number of favored enemies chosen
    const count = 1 + Math.floor(level / 5); // 1 at 1, 2 at 5, 3 at 10, 4 at 15, 5 at 20
    // First enemy: +2 base, +2 at levels 5, 10, 15, 20
    return count;
  },
  bonusForEnemy: (level, enemyIndex) => {
    const base = 2;
    const startLevel = enemyIndex * 5; // 0 at L1, 5 at L5, 10 at L10, etc.
    if (level < Math.max(1, startLevel)) return 0;
    return base + Math.floor(level / 5) * 2 - enemyIndex * 2;
  },
  modifiers: (bonus) => ({
    attack: bonus,
    damage: bonus,
    skills: { Bluff: bonus, 'Knowledge': bonus, Perception: bonus, 'Sense Motive': bonus, Survival: bonus },
  }),
};

export const RANGER_TRACK = {
  name: 'Track',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 1,
  description: '+1/2 level to Survival checks to follow tracks.',
  modifiers: (level) => ({
    skills: { Survival: Math.max(1, Math.floor(level / 2)) },
  }),
  context: 'tracking_only',
};

export const RANGER_COMBAT_STYLE = {
  name: 'Combat Style',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 2,
  description: 'Choose archery or two-weapon fighting. Gain bonus feats ignoring prerequisites.',
  styles: {
    archery: {
      2: ['Precise Shot', 'Rapid Shot'],
      6: ['Manyshot', 'Point-Blank Shot', 'Improved Precise Shot'],
      10: ['Pinpoint Targeting', 'Shot on the Run'],
    },
    two_weapon: {
      2: ['Double Slice', 'Two-Weapon Fighting'],
      6: ['Improved Two-Weapon Fighting', 'Two-Weapon Defense'],
      10: ['Greater Two-Weapon Fighting', 'Two-Weapon Rend'],
    },
  },
};

export const RANGER_ENDURANCE = {
  name: 'Endurance',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 3,
  description: '+4 bonus on various endurance-related checks (swim, Constitution checks).',
  modifiers: { endurance: 4 },
};

export const RANGER_FAVORED_TERRAIN = {
  name: 'Favored Terrain',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 3,
  description: '+2 initiative, Knowledge (geography), Perception, Stealth, Survival in chosen terrain.',
  terrainTypes: [
    'Cold', 'Desert', 'Forest', 'Jungle', 'Mountain', 'Plains',
    'Planes', 'Swamp', 'Underground', 'Urban', 'Water',
  ],
  bonusForTerrain: (level, terrainIndex) => {
    const startLevel = terrainIndex === 0 ? 3 : 3 + terrainIndex * 5;
    if (level < startLevel) return 0;
    return 2 + Math.floor((level - startLevel) / 5) * 2;
  },
  modifiers: (bonus) => ({
    initiative: bonus,
    skills: { 'Knowledge (geography)': bonus, Perception: bonus, Stealth: bonus, Survival: bonus },
  }),
};

export const RANGER_HUNTERS_BOND = {
  name: "Hunter's Bond",
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 4,
  description: 'Choose animal companion OR bond with companions (share half favored enemy bonus as move action).',
  options: ['animal_companion', 'companion_bond'],
  companionBond: {
    action: 'move',
    duration: (level) => Math.floor(level / 2), // rounds = WIS mod, but we'll use half level as fallback
    range: 30,
    effect: 'share_half_favored_enemy',
  },
};

export const RANGER_ANIMAL_COMPANION = {
  name: 'Animal Companion',
  classes: ['Ranger', 'Druid'],
  type: 'passive',
  minLevel: { Ranger: 4, Druid: 1 },
  description: 'Gain an animal companion. Ranger effective druid level = ranger level - 3.',
  effectiveDruidLevel: (level, className) => {
    if (className === 'Druid') return level;
    if (className === 'Ranger') return Math.max(0, level - 3);
    return 0;
  },
};

export const RANGER_SWIFT_TRACKER = {
  name: 'Swift Tracker',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 8,
  description: 'Track at normal speed without penalty, or at double speed at -10.',
  effect: 'track_without_speed_penalty',
};

// Note: Ranger Evasion is handled by MONK_EVASION (shared, classes: ['Rogue', 'Monk', 'Ranger'])

export const RANGER_CAMOUFLAGE = {
  name: 'Camouflage',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 12,
  description: 'Use Stealth to hide in any favored terrain, even without cover.',
  effect: 'stealth_without_cover_in_favored_terrain',
};

export const RANGER_IMPROVED_EVASION = {
  name: 'Improved Evasion (Ranger)',
  classes: ['Ranger'],
  type: 'passive_save_modifier',
  minLevel: 16,
  description: 'Improved Evasion while wearing light or no armor.',
  effect: 'reflex_save_half_on_fail',
};

export const RANGER_QUARRY = {
  name: 'Quarry',
  classes: ['Ranger'],
  type: 'targeted_buff',
  action: 'standard',
  minLevel: 11,
  description: 'Designate one target as quarry. +2 insight on attack, auto-confirm crits, can track at +20.',
  modifiers: { attack: 2 },
  effects: ['auto_confirm_crits', 'tracking_bonus_20'],
  restriction: 'one_target_at_a_time',
};

export const RANGER_IMPROVED_QUARRY = {
  name: 'Improved Quarry',
  classes: ['Ranger'],
  type: 'targeted_buff',
  action: 'free',
  minLevel: 19,
  description: 'Quarry as free action, +4 attack, auto-confirm crits, can track at +20, no penalty to move and track.',
  modifiers: { attack: 4 },
  effects: ['auto_confirm_crits', 'tracking_bonus_20', 'no_move_track_penalty'],
};

export const RANGER_HIDE_IN_PLAIN_SIGHT = {
  name: 'Hide in Plain Sight',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 17,
  description: 'Use Stealth even while being observed, in any favored terrain.',
  effect: 'stealth_while_observed_favored_terrain',
};

export const RANGER_MASTER_HUNTER = {
  name: 'Master Hunter',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 20,
  description: 'Standard action: favored enemy must Fort save (DC 10 + 1/2 level + WIS) or die.',
  saveDC: (level, wisMod) => 10 + Math.floor(level / 2) + wisMod,
  saveType: 'Fort',
  onFailedSave: 'death',
};

export const RANGER_SPELLS = {
  name: 'Spells (Ranger)',
  classes: ['Ranger'],
  type: 'passive',
  minLevel: 4,
  description: 'Cast divine spells from the Ranger spell list (levels 1–4). WIS-based, prepared casting.',
  castingStat: 'WIS',
  casterType: 'prepared',
  maxSpellLevel: 4,
  spellListType: 'ranger',
};

// Wild Empathy is shared with Druid — see DRUID_WILD_EMPATHY
// Woodland Stride is shared with Druid — see DRUID_WOODLAND_STRIDE
// Evasion is shared with Monk/Rogue — see MONK_EVASION


// ═══════════════════════════════════════════════════════
//  R O G U E
// ═══════════════════════════════════════════════════════

export const ROGUE_SNEAK_ATTACK = {
  name: 'Sneak Attack',
  classes: ['Rogue', 'Ninja'],
  type: 'extra_damage',
  minLevel: 1,
  trigger: 'flanking_or_denied_dex',
  description: 'Extra damage when target is flanked or denied DEX to AC.',
  scaling: {
    dicePerLevel: (level) => Math.ceil(level / 2), // 1d6 at 1, 2d6 at 3, etc.
    sides: 6,
  },
  restrictions: {
    requiresAttack: true,
    rangedMaxFeet: 30,
    // PF1e removed blanket creature type immunity to sneak attack (3.5e contamination removed)
    requiresVisibility: true,
  },
};

export const ROGUE_TRAPFINDING = {
  name: 'Trapfinding',
  classes: ['Rogue'],
  type: 'passive',
  minLevel: 1,
  description: '+1/2 level to Perception to find traps and Disable Device.',
  modifiers: (level) => ({
    skills: { Perception: Math.max(1, Math.floor(level / 2)), 'Disable Device': Math.max(1, Math.floor(level / 2)) },
  }),
  context: 'traps_only_for_perception',
  effect: 'can_disarm_magic_traps',
};

// Note: Rogue Evasion is handled by MONK_EVASION (shared, classes: ['Rogue', 'Monk', 'Ranger'])

export const ROGUE_TALENT = {
  name: 'Rogue Talent',
  classes: ['Rogue'],
  type: 'passive',
  minLevel: 2,
  description: 'Select a rogue talent every even level.',
  talentsKnown: (level) => Math.floor(level / 2),
  // Talents are player-selected; some common ones with mechanical effects:
  commonTalents: {
    'Bleeding Attack': { extraDamagePerRound: (level) => Math.ceil(level / 2), type: 'bleed' },
    'Combat Trick': { effect: 'bonus_combat_feat' },
    'Fast Stealth': { effect: 'stealth_at_full_speed' },
    'Finesse Rogue': { effect: 'weapon_finesse_feat' },
    'Surprise Attack': { effect: 'flat_footed_during_surprise_round' },
    'Trap Spotter': { effect: 'auto_perception_within_10ft_of_trap' },
    'Weapon Training': { effect: 'weapon_focus_feat' },
  },
};

export const ROGUE_ADVANCED_TALENT = {
  name: 'Advanced Talent',
  classes: ['Rogue'],
  type: 'passive',
  minLevel: 10,
  description: 'Can select advanced talents in place of rogue talents at 10+.',
  commonAdvancedTalents: {
    'Crippling Strike': { abilityDamage: { STR: 2 }, context: 'on_sneak_attack' },
    'Defensive Roll': { effect: 'reflex_save_vs_death_from_damage' },
    'Improved Evasion': { effect: 'reflex_save_half_on_fail' },
    'Opportunist': { effect: 'aoo_when_ally_hits' },
    'Skill Mastery': { effect: 'take_10_under_pressure' },
    'Slippery Mind': { effect: 'reroll_failed_will_vs_enchantment' },
  },
};

export const ROGUE_MASTER_STRIKE = {
  name: 'Master Strike',
  classes: ['Rogue'],
  type: 'passive',
  minLevel: 20,
  description: 'Sneak attack target must Fort save or be put to sleep, paralyzed, or slain.',
  saveDC: (level, intMod) => 10 + Math.floor(level / 2) + intMod,
  saveType: 'Fort',
  effects: ['sleep', 'paralyzed', 'death'], // Player chooses
};


// ═══════════════════════════════════════════════════════
//  S O R C E R E R
// ═══════════════════════════════════════════════════════

export const SORCERER_BLOODLINE = {
  name: 'Bloodline',
  classes: ['Sorcerer'],
  type: 'passive',
  minLevel: 1,
  description: 'Grants bonus spells, feats, and powers based on magical heritage.',
  bloodlines: {
    Aberrant: {
      classSkill: 'Knowledge (dungeoneering)',
      powers: {
        1: { name: 'Acidic Ray', type: 'ranged_touch', damage: (level) => `${3 + Math.floor(level / 2)}d6`, usesPerDay: (chaMod) => 3 + chaMod, damageType: 'acid' },
        3: { name: 'Long Limbs', type: 'passive', reach: (level) => 5 + Math.floor((level - 3) / 6) * 5, maxReach: 15 },
        9: { name: 'Unusual Anatomy', type: 'passive', fortification: (level) => level >= 13 ? 50 : 25 },
        15: { name: 'Alien Resistance', type: 'passive', sr: (level) => level + 10 },
        20: { name: 'Aberrant Form', type: 'passive', effects: ['blind_sight_60', 'dr_5_bludgeoning', 'immune_crits'] },
      },
    },
    Arcane: {
      classSkill: 'Knowledge (arcana)',
      powers: {
        1: { name: 'Arcane Bond', type: 'passive', description: 'Bonded item or familiar' },
        3: { name: 'Metamagic Adept', type: 'passive', usesPerDay: (level) => Math.max(1, Math.floor((level - 3) / 4) + 1), description: 'Apply metamagic without increased casting time' },
        9: { name: 'New Arcana', type: 'passive', bonusSpells: (level) => Math.floor((level - 9) / 4) + 1, description: 'Add spells from any list' },
        15: { name: 'School Power', type: 'passive', description: '+2 DC to spells from one school' },
        20: { name: 'Arcane Apotheosis', type: 'passive', description: 'Metamagic costs only +1 level increase' },
      },
    },
    Celestial: {
      classSkill: 'Heal',
      powers: {
        1: { name: 'Heavenly Fire', type: 'ranged_touch', damage: (level) => `${1 + Math.floor(level / 2)}d4`, healing: true, usesPerDay: (chaMod) => 3 + chaMod },
        3: { name: 'Celestial Resistances', type: 'passive', resistances: { acid: 5, cold: 5 }, scaling: (level) => level >= 9 ? 10 : 5 },
        9: { name: 'Wings of Heaven', type: 'self_buff', flySpeed: 60, duration: (level) => level, unit: 'minutes' },
        15: { name: 'Conviction', type: 'passive', rerollPerDay: 1, description: 'Reroll ability check, attack, skill, or save' },
        20: { name: 'Ascension', type: 'passive', effects: ['dr_10_evil', 'blindsense_60', 'immune_acid_cold_petrification', 'resist_electricity_fire_10', 'poison_immunity'] },
      },
    },
    Draconic: {
      classSkill: 'Perception',
      powers: {
        1: { name: 'Claws', type: 'natural_attack', damage: '1d4', attacks: 2, roundsPerDay: (level, chaMod) => 3 + chaMod, scaling: (level) => level >= 7 ? '+1d6 energy' : level >= 5 ? 'magic' : 'normal' },
        3: { name: 'Dragon Resistances', type: 'passive', naturalArmor: (level) => level >= 15 ? 4 : level >= 9 ? 2 : 1, energyResistance: (level) => level >= 9 ? 10 : 5 },
        9: { name: 'Breath Weapon', type: 'area_damage', damage: (level) => `${level}d6`, shape: '30ft_cone_or_60ft_line', usesPerDay: 1, saveDC: (level, chaMod) => 10 + Math.floor(level / 2) + chaMod, saveType: 'Reflex' },
        15: { name: 'Wings', type: 'passive', flySpeed: 60 },
        20: { name: 'Power of Wyrms', type: 'passive', effects: ['blindsense_60', 'immune_paralysis_sleep_energy', 'dragon_form_2_per_day'] },
      },
    },
    Infernal: {
      classSkill: 'Diplomacy',
      powers: {
        1: { name: 'Corrupting Touch', type: 'touch', roundsShaken: (level) => Math.max(1, Math.floor(level / 2)), usesPerDay: (chaMod) => 3 + chaMod },
        3: { name: 'Infernal Resistances', type: 'passive', resistances: { fire: 5 }, poisonSaveBonus: 2 },
        9: { name: 'Hellfire', type: 'area_damage', damage: (level) => `${level}d6`, usesPerDay: 1, halfFire: true, halfUnholy: true },
        15: { name: 'On Dark Wings', type: 'passive', flySpeed: 60 },
        20: { name: 'Power of the Pit', type: 'passive', effects: ['immune_fire_poison', 'resist_acid_cold_10', 'see_in_darkness', 'dr_10_good'] },
      },
    },
    Undead: {
      classSkill: 'Knowledge (religion)',
      powers: {
        1: { name: 'Grave Touch', type: 'touch', conditionApplied: 'shaken', duration: (level) => Math.max(1, Math.floor(level / 2)), usesPerDay: (chaMod) => 3 + chaMod },
        3: { name: "Death's Gift", type: 'passive', resistances: { cold: 5 }, dr: (level) => level >= 9 ? 'DR 5/—' : null },
        9: { name: 'Grasp of the Dead', type: 'area_damage', damage: (level) => `${level}d6`, usesPerDay: 1, description: 'Skeletal hands from ground' },
        15: { name: 'Incorporeal Form', type: 'self_buff', duration: (level) => level, unit: 'rounds', usesPerDay: 1 },
        20: { name: 'One of Us', type: 'passive', effects: ['immune_cold_nonlethal_paralysis_sleep', 'dr_5_magic', 'undead_type'] },
      },
    },
  },
};

export const SORCERER_BLOODLINE_ARCANA = {
  name: 'Bloodline Arcana',
  classes: ['Sorcerer'],
  type: 'passive',
  minLevel: 1,
  description: 'Passive bonus from bloodline that modifies spellcasting.',
  arcana: {
    Aberrant: 'Polymorph spells increase duration by 50%',
    Arcane: '+1 DC to metamagic spells',
    Celestial: 'Summoned creatures gain DR equal to half sorcerer level vs evil',
    Draconic: '+1 damage per die for spells matching dragon energy type',
    Infernal: 'Charm spells gain +2 DC against targets unaware of casting',
    Undead: 'Corporeal undead that were once humanoids are treated as humanoids for determining which spells affect them',
  },
};

export const SORCERER_CANTRIPS = {
  name: 'Cantrips',
  classes: ['Sorcerer'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const SORCERER_ESCHEW_MATERIALS = {
  name: 'Eschew Materials',
  classes: ['Sorcerer'],
  type: 'passive',
  minLevel: 1,
  description: 'Can cast spells without material components costing 1 gp or less.',
  effect: 'ignore_cheap_material_components',
};

export const SORCERER_BLOODLINE_BONUS_FEAT = {
  name: 'Bloodline Bonus Feat',
  classes: ['Sorcerer'],
  type: 'passive',
  minLevel: 7,
  description: 'Gain a bonus feat from your bloodline list at 7th, 13th, and 19th level.',
  featsGained: (level) => {
    if (level >= 19) return 3;
    if (level >= 13) return 2;
    if (level >= 7) return 1;
    return 0;
  },
};

export const SORCERER_BLOODLINE_SPELL = {
  name: 'Bloodline Spell',
  classes: ['Sorcerer'],
  type: 'passive',
  minLevel: 3,
  description: 'Gain bonus spells known from your bloodline at odd levels starting at 3rd (one per spell level 1–9).',
  spellsKnown: (level) => Math.min(9, Math.max(0, Math.floor((level - 1) / 2))),
};


// ═══════════════════════════════════════════════════════
//  W I Z A R D
// ═══════════════════════════════════════════════════════

export const WIZARD_ARCANE_BOND = {
  name: 'Arcane Bond',
  classes: ['Wizard'],
  type: 'passive',
  minLevel: 1,
  description: 'Bond with familiar or object. Object allows 1 free spell/day.',
  options: ['familiar', 'bonded_object'],
  bondedObjectFreeSpell: 1,
};

export const WIZARD_ARCANE_SCHOOL = {
  name: 'Arcane School',
  classes: ['Wizard'],
  type: 'passive',
  minLevel: 1,
  description: 'Specialize in a school for +1 spell slot/level and school powers.',
  schools: {
    Abjuration: {
      powers: {
        1: { name: 'Resistance', type: 'self_buff', bonus: (level) => 1 + Math.floor(level / 5), targets: 'saves', usesPerDay: (intMod) => 3 + intMod, duration: 1 },
        6: { name: 'Energy Absorption', type: 'passive', absorbPerDay: (level) => level * 3, description: 'Absorb energy damage from one type' },
      },
    },
    Conjuration: {
      powers: {
        1: { name: 'Acid Dart', type: 'ranged_touch', damage: (level) => `${1 + Math.floor(level / 2)}d6`, damageType: 'acid', usesPerDay: (intMod) => 3 + intMod },
        8: { name: 'Dimensional Steps', type: 'teleport', feetPerDay: (level) => level * 30 },
      },
    },
    Divination: {
      powers: {
        1: { name: "Forewarned", type: 'passive', initiative: (level) => Math.max(1, Math.floor(level / 2)), description: 'Always act in surprise round' },
        8: { name: "Diviner's Fortune", type: 'targeted_buff', bonus: (level) => Math.max(1, Math.floor(level / 2)), usesPerDay: (intMod) => 3 + intMod, description: 'Insight bonus on attacks, skill, ability, saves for 1 round' },
      },
    },
    Enchantment: {
      powers: {
        1: { name: 'Enchanting Smile', type: 'passive', skills: { Bluff: (level) => Math.max(1, Math.floor(level / 2)), Diplomacy: (level) => Math.max(1, Math.floor(level / 2)), Intimidate: (level) => Math.max(1, Math.floor(level / 2)) } },
        8: { name: 'Aura of Despair', type: 'area_debuff', penalty: -2, duration: (level) => Math.floor(level / 2), range: 30, saveType: 'Will' },
      },
    },
    Evocation: {
      powers: {
        1: { name: 'Force Missile', type: 'ranged', damage: (level) => `${1 + Math.floor(level / 2)}d4+${Math.floor(level / 2)}`, damageType: 'force', usesPerDay: (intMod) => 3 + intMod },
        8: { name: 'Elemental Wall', type: 'area_control', usesPerDay: (level) => Math.floor(level / 4), duration: (level) => level, description: 'Create wall of chosen element' },
      },
    },
    Illusion: {
      powers: {
        1: { name: 'Blinding Ray', type: 'ranged_touch', effect: 'blinded_1_round_or_dazzled', usesPerDay: (intMod) => 3 + intMod },
        8: { name: 'Invisibility Field', type: 'self_buff', duration: (level) => level, unit: 'rounds', usesPerDay: () => 1, description: 'Greater invisibility' },
      },
    },
    Necromancy: {
      powers: {
        1: { name: 'Power over Undead', type: 'passive', channelEnergy: true, description: 'Command or turn undead as cleric of wizard level' },
        8: { name: 'Life Sight', type: 'passive', range: 10, description: 'Blindsight vs living and undead' },
      },
    },
    Transmutation: {
      powers: {
        1: { name: 'Telekinetic Fist', type: 'ranged', damage: (level) => `${1 + Math.floor(level / 2)}d4`, damageType: 'force', usesPerDay: (intMod) => 3 + intMod },
        8: { name: 'Physical Enhancement', type: 'passive', bonus: (level) => level >= 16 ? 4 : level >= 11 ? 3 : 2, description: '+N enhancement to one physical ability score' },
      },
    },
    Universalist: {
      powers: {
        1: { name: 'Hand of the Apprentice', type: 'ranged', attackBonus: 'INT', damage: 'weapon', usesPerDay: (intMod) => 3 + intMod },
        8: { name: 'Metamagic Mastery', type: 'passive', usesPerDay: (level) => Math.max(1, Math.floor((level - 8) / 4) + 1), description: 'Apply metamagic without increased casting time' },
      },
    },
  },
};

export const WIZARD_CANTRIPS = {
  name: 'Cantrips (Wizard)',
  classes: ['Wizard'],
  type: 'passive',
  minLevel: 1,
  description: 'Can prepare 0-level spells unlimited times.',
  effect: 'unlimited_cantrips',
};

export const WIZARD_SCRIBE_SCROLL = {
  name: 'Scribe Scroll',
  classes: ['Wizard'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain Scribe Scroll as a bonus feat.',
  effect: 'bonus_feat_scribe_scroll',
};

export const WIZARD_BONUS_FEAT = {
  name: 'Bonus Feat (Wizard)',
  classes: ['Wizard'],
  type: 'passive',
  minLevel: 5,
  description: 'Gain a bonus metamagic or item creation feat at 5, 10, 15, 20.',
  levelInterval: 5,
  featsGained: (level) => Math.floor(level / 5),
  featTypes: ['metamagic', 'item_creation'],
};


// ═══════════════════════════════════════════════════════
//  M A S T E R   R E G I S T R Y
// ═══════════════════════════════════════════════════════

/**
 * All class abilities indexed by canonical name.
 * This is the single source of truth for lookups.
 */
export const CLASS_ABILITIES = {
  // ── Barbarian ──
  'Fast Movement': MONK_FAST_MOVEMENT, // Shared Barbarian + Monk
  'Rage': BARBARIAN_RAGE,
  'Rage Power': BARBARIAN_RAGE_POWER,
  'Uncanny Dodge': BARBARIAN_UNCANNY_DODGE,
  'Trap Sense': BARBARIAN_TRAP_SENSE,
  'Improved Uncanny Dodge': BARBARIAN_IMPROVED_UNCANNY_DODGE,
  'Damage Reduction': BARBARIAN_DR,
  'Greater Rage': BARBARIAN_GREATER_RAGE,
  'Indomitable Will': BARBARIAN_INDOMITABLE_WILL,
  'Tireless Rage': BARBARIAN_TIRELESS_RAGE,
  'Mighty Rage': BARBARIAN_MIGHTY_RAGE,

  // ── Bard ──
  'Cantrips (Bard)': BARD_CANTRIPS,
  'Bardic Knowledge': BARD_BARDIC_KNOWLEDGE,
  'Bardic Performance': BARD_BARDIC_PERFORMANCE,
  'Versatile Performance': BARD_VERSATILE_PERFORMANCE,
  'Well-Versed': BARD_WELL_VERSED,
  'Lore Master': BARD_LORE_MASTER,
  'Jack of All Trades': BARD_JACK_OF_ALL_TRADES,

  // ── Cleric ──
  'Aura': CLERIC_AURA,
  'Channel Energy': CLERIC_CHANNEL_ENERGY,
  'Domains': CLERIC_DOMAINS,
  'Spontaneous Casting': CLERIC_SPONTANEOUS_CASTING,
  'Orisons': CLERIC_ORISONS,

  // ── Druid ──
  'Spontaneous Casting (Druid)': DRUID_SPONTANEOUS_CASTING,
  'Nature Bond': DRUID_NATURE_BOND,
  'Nature Sense': DRUID_NATURE_SENSE,
  'Wild Empathy': DRUID_WILD_EMPATHY,
  'Woodland Stride': DRUID_WOODLAND_STRIDE,
  'Trackless Step': DRUID_TRACKLESS_STEP,
  "Resist Nature's Lure": DRUID_RESIST_NATURES_LURE,
  'Wild Shape': DRUID_WILD_SHAPE,
  'Venom Immunity': DRUID_VENOM_IMMUNITY,
  'A Thousand Faces': DRUID_A_THOUSAND_FACES,

  // ── Fighter ──
  'Bonus Combat Feat': FIGHTER_BONUS_FEAT,
  'Bravery': FIGHTER_BRAVERY,
  'Armor Training': FIGHTER_ARMOR_TRAINING,
  'Weapon Training': FIGHTER_WEAPON_TRAINING,
  'Weapon Mastery': FIGHTER_WEAPON_MASTERY,
  'Armor Mastery': FIGHTER_ARMOR_MASTERY,

  // ── Monk ──
  'Bonus Feat (Monk)': MONK_BONUS_FEAT,
  'Stunning Fist': MONK_STUNNING_FIST,
  'Flurry of Blows': MONK_FLURRY_OF_BLOWS,
  'Unarmed Strike': MONK_UNARMED_STRIKE,
  'AC Bonus': MONK_AC_BONUS,
  'Maneuver Training': MONK_MANEUVER_TRAINING,
  'Evasion': MONK_EVASION, // Shared Rogue + Monk + Ranger
  'Still Mind': MONK_STILL_MIND,
  'Ki Pool': MONK_KI_POOL,
  'Slow Fall': MONK_SLOW_FALL,
  'Purity of Body': MONK_PURITY_OF_BODY,
  'High Jump': MONK_HIGH_JUMP,
  'Wholeness of Body': MONK_WHOLENESS_OF_BODY,
  'Improved Evasion': MONK_IMPROVED_EVASION,
  'Diamond Body': MONK_DIAMOND_BODY,
  'Abundant Step': MONK_ABUNDANT_STEP,
  'Diamond Soul': MONK_DIAMOND_SOUL,
  'Quivering Palm': MONK_QUIVERING_PALM,
  'Tongue of the Sun and Moon': MONK_TONGUE_OF_SUN_AND_MOON,
  'Timeless Body': MONK_TIMELESS_BODY,
  'Empty Body': MONK_EMPTY_BODY,
  'Perfect Self': MONK_PERFECT_SELF,

  // ── Paladin ──
  'Aura of Good': PALADIN_AURA_OF_GOOD,
  'Detect Evil': PALADIN_DETECT_EVIL,
  'Smite Evil': PALADIN_SMITE_EVIL,
  'Divine Grace': PALADIN_DIVINE_GRACE,
  'Lay on Hands': PALADIN_LAY_ON_HANDS,
  'Aura of Courage': PALADIN_AURA_OF_COURAGE,
  'Divine Health': PALADIN_DIVINE_HEALTH,
  'Divine Bond': PALADIN_DIVINE_BOND,
  'Channel Positive Energy': PALADIN_CHANNEL_POSITIVE_ENERGY,
  'Mercy': PALADIN_MERCY,
  'Aura of Resolve': PALADIN_AURA_OF_RESOLVE,
  'Aura of Justice': PALADIN_AURA_OF_JUSTICE,
  'Aura of Faith': PALADIN_AURA_OF_FAITH,
  'Aura of Righteousness': PALADIN_AURA_OF_RIGHTEOUSNESS,
  'Holy Champion': PALADIN_HOLY_CHAMPION,
  'Spells (Paladin)': PALADIN_SPELLS,

  // ── Ranger ──
  'Favored Enemy': RANGER_FAVORED_ENEMY,
  'Track': RANGER_TRACK,
  'Combat Style': RANGER_COMBAT_STYLE,
  'Endurance': RANGER_ENDURANCE,
  'Favored Terrain': RANGER_FAVORED_TERRAIN,
  'Animal Companion': RANGER_ANIMAL_COMPANION,
  'Swift Tracker': RANGER_SWIFT_TRACKER,
  'Quarry': RANGER_QUARRY,
  "Hunter's Bond": RANGER_HUNTERS_BOND,
  'Camouflage': RANGER_CAMOUFLAGE,
  'Improved Quarry': RANGER_IMPROVED_QUARRY,
  'Improved Evasion (Ranger)': RANGER_IMPROVED_EVASION,
  'Hide in Plain Sight': RANGER_HIDE_IN_PLAIN_SIGHT,
  'Master Hunter': RANGER_MASTER_HUNTER,
  'Spells (Ranger)': RANGER_SPELLS,

  // ── Rogue ──
  'Sneak Attack': ROGUE_SNEAK_ATTACK,
  'Trapfinding': ROGUE_TRAPFINDING,
  'Rogue Talent': ROGUE_TALENT,
  'Advanced Talent': ROGUE_ADVANCED_TALENT,
  'Master Strike': ROGUE_MASTER_STRIKE,

  // ── Sorcerer ──
  'Bloodline': SORCERER_BLOODLINE,
  'Bloodline Arcana': SORCERER_BLOODLINE_ARCANA,
  'Cantrips': SORCERER_CANTRIPS,
  'Eschew Materials': SORCERER_ESCHEW_MATERIALS,
  'Bloodline Bonus Feat': SORCERER_BLOODLINE_BONUS_FEAT,
  'Bloodline Spell': SORCERER_BLOODLINE_SPELL,

  // ── Wizard ──
  'Arcane Bond': WIZARD_ARCANE_BOND,
  'Arcane School': WIZARD_ARCANE_SCHOOL,
  'Cantrips (Wizard)': WIZARD_CANTRIPS,
  'Scribe Scroll': WIZARD_SCRIBE_SCROLL,
  'Bonus Feat (Wizard)': WIZARD_BONUS_FEAT,
};


// ═══════════════════════════════════════════════════════
//  B L O C K  2:  A P G  C L A S S E S
// ═══════════════════════════════════════════════════════

// ── ALCHEMIST ──

export const ALCHEMIST_ALCHEMY = {
  name: 'Alchemy',
  classes: ['Alchemist', 'Investigator'],
  type: 'passive',
  minLevel: 1,
  description: 'Prepare extracts (spell-like effects) and create alchemical items at +level to Craft (alchemy).',
  modifiers: (level) => ({ skills: { 'Craft (alchemy)': level } }),
};

export const ALCHEMIST_BOMB = {
  name: 'Bomb',
  classes: ['Alchemist'],
  type: 'extra_damage',
  action: 'standard',
  minLevel: 1,
  description: 'Throw splash weapon dealing fire damage.',
  usesPerDay: (level, intMod) => level + intMod,
  damage: (level) => ({ dice: Math.ceil(level / 2), sides: 6 }),
  splashDamage: (level, intMod) => Math.ceil(level / 2) + (intMod || 0), // minimum damage + INT mod
  range: 20, // 20 ft range increment
  saveDC: (level, intMod) => 10 + Math.floor(level / 2) + intMod,
  saveType: 'Reflex',
  directHit: 'ranged_touch',
};

export const ALCHEMIST_MUTAGEN = {
  name: 'Mutagen',
  classes: ['Alchemist'],
  type: 'self_buff',
  action: 'standard', // 1 hour to brew
  minLevel: 1,
  description: '+4 alchemical bonus to one physical ability, +2 natural armor, -2 to corresponding mental.',
  duration: (level) => level * 10, // 10 min/level
  modifiers: (chosenAbility) => {
    const map = {
      STR: { strBonus: 4, naturalArmor: 2, intPenalty: -2 },
      DEX: { dexBonus: 4, naturalArmor: 2, wisPenalty: -2 },
      CON: { conBonus: 4, naturalArmor: 2, chaPenalty: -2 },
    };
    return map[chosenAbility] || map.STR;
  },
};

export const ALCHEMIST_POISON_RESISTANCE = {
  name: 'Poison Resistance (Alchemist)',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 2,
  description: '+2 save vs poison at 2, +4 at 5, +6 at 8.',
  modifiers: (level) => ({
    saves: { poison: level >= 8 ? 6 : level >= 5 ? 4 : 2 },
  }),
};

export const ALCHEMIST_POISON_USE = {
  name: 'Poison Use',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 2,
  description: 'Cannot accidentally poison self when applying poison to weapon.',
  effect: 'no_self_poisoning',
};

export const ALCHEMIST_POISON_IMMUNITY = {
  name: 'Poison Immunity (Alchemist)',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 10,
  description: 'Immune to all poisons.',
  effect: 'poison_immunity',
};

export const ALCHEMIST_BREW_POTION = {
  name: 'Brew Potion',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain Brew Potion as a bonus feat. Can brew potions of any formula known (up to 3rd level).',
  effect: 'bonus_feat_brew_potion',
};

export const ALCHEMIST_THROW_ANYTHING = {
  name: 'Throw Anything',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain Throw Anything as bonus feat. Add INT to splash weapon damage.',
  effect: 'bonus_feat_throw_anything',
  modifiers: (intMod) => ({ splashDamage: intMod }),
};

export const ALCHEMIST_DISCOVERY = {
  name: 'Discovery',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 2,
  description: 'Select a discovery every even level. Enhances bombs, mutagen, or extracts.',
  discoveriesKnown: (level) => Math.floor(level / 2),
  commonDiscoveries: {
    'Acid Bomb': { description: 'Bombs deal acid damage, target takes 1d6 acid next round' },
    'Concussive Bomb': { description: 'Bombs deal sonic damage, deafen target' },
    'Frost Bomb': { description: 'Bombs deal cold damage, stagger target' },
    'Inferno Bomb': { minLevel: 16, description: 'Direct hit creates smoke cloud, deals 6d6 fire/round' },
    'Precise Bombs': { description: 'Exclude squares from splash damage' },
    'Stink Bomb': { description: 'Smoke bomb nauseates (Fort negates)' },
    'Feral Mutagen': { description: 'Gain 2 claw and 1 bite attack while mutagen active' },
    'Cognatogen': { description: 'Mental stat mutagen instead of physical' },
  },
};

export const ALCHEMIST_SWIFT_ALCHEMY = {
  name: 'Swift Alchemy',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 3,
  description: 'Create alchemical items in half normal time. Apply poison as move action.',
  effect: 'half_time_alchemy',
  poisonAction: 'move',
};

export const ALCHEMIST_SWIFT_POISONING = {
  name: 'Swift Poisoning',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 6,
  description: 'Apply poison to weapon as a swift action.',
  poisonAction: 'swift',
};

export const ALCHEMIST_PERSISTENT_MUTAGEN = {
  name: 'Persistent Mutagen',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 14,
  description: 'Mutagen duration becomes 1 hour/level.',
  duration: (level) => level * 60, // minutes
};

export const ALCHEMIST_INSTANT_ALCHEMY = {
  name: 'Instant Alchemy',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 18,
  description: 'Create alchemical items as full-round action. Apply poison as immediate action.',
  effect: 'instant_alchemy',
  poisonAction: 'immediate',
};

export const ALCHEMIST_GRAND_DISCOVERY = {
  name: 'Grand Discovery',
  classes: ['Alchemist'],
  type: 'passive',
  minLevel: 20,
  description: 'Select a grand discovery (True Mutagen, Philosopher\'s Stone, Eternal Potion, etc.).',
  options: ['true_mutagen', 'philosophers_stone', 'eternal_potion', 'awakened_intellect', 'fast_healing', 'poison_touch'],
};

// ── CAVALIER ──

export const CAVALIER_ORDER = {
  name: 'Order',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 1,
  description: 'Pledge to an order, gaining abilities and an edict to follow.',
  orders: ['Cockatrice', 'Dragon', 'Lion', 'Shield', 'Star', 'Sword', 'Tome'],
};

export const CAVALIER_MOUNTED_BOND = {
  name: 'Mounted Bond',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain mount as druid animal companion (cavalier level = druid level).',
  effectiveDruidLevel: (level) => level,
};

export const CAVALIER_CHALLENGE = {
  name: 'Challenge',
  classes: ['Cavalier'],
  type: 'targeted_buff',
  action: 'swift',
  minLevel: 1,
  description: 'Challenge a target: +level damage vs target, -2 AC vs others.',
  usesPerDay: (level) => 1 + Math.floor(level / 3), // 1/day at 1, 2 at 4, 3 at 7, etc.
  modifiers: (level) => ({ damage: level, acPenaltyVsOthers: -2 }),
};

export const CAVALIER_TACTICIAN = {
  name: 'Tactician',
  classes: ['Cavalier'],
  type: 'party_buff',
  action: 'standard',
  minLevel: 1,
  description: 'Grant a teamwork feat to all allies within 30 ft.',
  usesPerDay: (level) => {
    if (level >= 17) return 5; // Master Tactician — unlimited as standard
    if (level >= 9) return 3;
    return 1 + Math.floor(level / 5);
  },
  duration: (level) => 3 + Math.floor(level / 2), // rounds
  range: 30,
};

export const CAVALIER_CHARGE = {
  name: "Cavalier's Charge",
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 3,
  description: '+4 attack on mounted charge (instead of +2), no AC penalty.',
  modifiers: { attack: 4, ac: 0 },
  requirement: 'mounted',
};

export const CAVALIER_BANNER = {
  name: 'Banner',
  classes: ['Cavalier'],
  type: 'party_buff',
  minLevel: 5,
  description: 'Allies within 60 ft. gain +2 morale vs fear, +1 attack on charges.',
  modifiers: { saves: { fear: 2 }, chargeAttack: 1 },
  range: 60,
  requirement: 'banner_displayed',
};

export const CAVALIER_GREATER_TACTICIAN = {
  name: 'Greater Tactician',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 9,
  description: 'Tactician as swift action; can grant any teamwork feat known.',
  effect: 'tactician_swift_action',
};

export const CAVALIER_MIGHTY_CHARGE = {
  name: 'Mighty Charge',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 11,
  description: 'Free bull rush, disarm, sunder, or trip on mounted charge hit. No AoO.',
  effects: ['free_maneuver_on_charge', 'no_aoo_for_maneuver'],
  requirement: 'mounted',
};

export const CAVALIER_DEMANDING_CHALLENGE = {
  name: 'Demanding Challenge',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 12,
  description: 'Challenged target takes -2 to attack anyone other than the cavalier.',
  modifiers: { targetAttackPenaltyVsOthers: -2 },
};

export const CAVALIER_GREATER_BANNER = {
  name: 'Greater Banner',
  classes: ['Cavalier'],
  type: 'party_buff',
  minLevel: 14,
  description: 'Allies within 60 ft. gain +2 morale vs fear/charm/compulsion, +2 attack on charges.',
  modifiers: { saves: { fear: 2, charm: 2, compulsion: 2 }, chargeAttack: 2 },
  range: 60,
};

export const CAVALIER_MASTER_TACTICIAN = {
  name: 'Master Tactician',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 17,
  description: 'Use Tactician as swift action with no limit on uses.',
  effect: 'tactician_unlimited_swift',
};

export const CAVALIER_SUPREME_CHARGE = {
  name: 'Supreme Charge',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 20,
  description: 'Mounted charge deals double damage (triple with lance). On crit, target stunned 1d4 rounds.',
  effects: ['double_damage_charge', 'triple_with_lance', 'stun_on_crit_1d4'],
  requirement: 'mounted',
};

export const CAVALIER_EXPERT_TRAINER = {
  name: 'Expert Trainer',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 4,
  description: 'Add 1/2 level to Handle Animal checks with mount. Can teach mount tricks as bonus tricks.',
  modifiers: (level) => ({ skills: { 'Handle Animal_mount': Math.floor(level / 2) } }),
};

export const CAVALIER_BONUS_FEAT = {
  name: 'Bonus Feat (Cavalier)',
  classes: ['Cavalier'],
  type: 'passive',
  minLevel: 6,
  description: 'Gain a bonus feat at 6th, 12th, and 18th level (combat or mounted combat feats).',
  featsGained: (level) => {
    if (level >= 18) return 3;
    if (level >= 12) return 2;
    if (level >= 6) return 1;
    return 0;
  },
};

// ── INQUISITOR ──

export const INQUISITOR_MONSTER_LORE = {
  name: 'Monster Lore',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 1,
  description: 'Add WIS modifier to Knowledge checks to identify creatures.',
  modifiers: (wisMod) => ({ skills: { 'Knowledge_identify': wisMod } }),
};

export const INQUISITOR_DOMAIN = {
  name: 'Inquisitor Domain',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 1,
  description: 'Choose one domain from deity. Gain domain powers but not bonus spells.',
  domainCount: 1,
  alternateOption: 'inquisition',
};

export const INQUISITOR_STERN_GAZE = {
  name: 'Stern Gaze',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 1,
  description: '+1/2 level to Intimidate and Sense Motive.',
  modifiers: (level) => ({
    skills: { Intimidate: Math.max(1, Math.floor(level / 2)), 'Sense Motive': Math.max(1, Math.floor(level / 2)) },
  }),
};

export const INQUISITOR_CUNNING_INITIATIVE = {
  name: 'Cunning Initiative',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 1,
  description: 'Add WIS modifier to initiative in addition to DEX.',
  modifiers: (wisMod) => ({ initiative: wisMod }),
};

export const INQUISITOR_DETECT_ALIGNMENT = {
  name: 'Detect Alignment',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 2,
  description: 'At will, use detect chaos/evil/good/law as spell-like ability.',
  effect: 'detect_alignment_at_will',
};

export const INQUISITOR_TRACK = {
  name: 'Track (Inquisitor)',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 2,
  description: '+1/2 level to Survival checks to follow tracks.',
  modifiers: (level) => ({ skills: { Survival_tracking: Math.max(1, Math.floor(level / 2)) } }),
};

export const INQUISITOR_SOLO_TACTICS = {
  name: 'Solo Tactics',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 3,
  description: 'All teamwork feats function as if allies also have those feats.',
  effect: 'teamwork_feats_always_active',
};

export const INQUISITOR_TEAMWORK_FEAT = {
  name: 'Teamwork Feat (Inquisitor)',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 3,
  description: 'Gain a bonus teamwork feat at 3rd level and every 3 levels. Can swap most recent.',
  featsGained: (level) => Math.max(0, Math.floor(level / 3)),
};

export const INQUISITOR_BANE = {
  name: 'Bane',
  classes: ['Inquisitor'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 5,
  description: 'Imbue weapon with +2 enhancement and +2d6 damage vs chosen creature type.',
  roundsPerDay: (level) => level,
  modifiers: { attack: 2, damage: '2d6' },
};

export const INQUISITOR_DISCERN_LIES = {
  name: 'Discern Lies',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 5,
  description: 'Use discern lies as spell-like ability for a number of rounds/day = level.',
  roundsPerDay: (level) => level,
};

export const INQUISITOR_SECOND_JUDGMENT = {
  name: 'Second Judgment',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 8,
  description: 'Can have two judgments active simultaneously when using Judgment.',
  simultaneousJudgments: 2,
};

export const INQUISITOR_STALWART = {
  name: 'Stalwart',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 11,
  description: 'On successful Fort or Will save for reduced effect, take no effect instead (like Evasion for Fort/Will).',
  effect: 'evasion_for_fort_and_will',
};

export const INQUISITOR_GREATER_BANE = {
  name: 'Greater Bane',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 12,
  description: 'Bane bonus increases to +4 enhancement and +4d6 damage.',
  modifiers: { attack: 4, damage: '4d6' },
};

export const INQUISITOR_EXPLOIT_WEAKNESS = {
  name: 'Exploit Weakness',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 14,
  description: 'On confirmed crit, ignore DR. Crit damage not multiplied by DR.',
  effect: 'ignore_dr_on_crit',
};

export const INQUISITOR_THIRD_JUDGMENT = {
  name: 'Third Judgment',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 16,
  description: 'Can have three judgments active simultaneously.',
  simultaneousJudgments: 3,
};

export const INQUISITOR_SLAYER = {
  name: 'Slayer (Inquisitor)',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 17,
  description: 'Choose one favored enemy type. +2 attack/damage vs that type, +2 DC on abilities.',
  modifiers: { attack: 2, damage: 2, dcBonus: 2 },
};

export const INQUISITOR_TRUE_JUDGMENT = {
  name: 'True Judgment',
  classes: ['Inquisitor'],
  type: 'targeted_buff',
  action: 'swift',
  minLevel: 20,
  description: 'Once per day, when activating judgment, deal death effect on melee hit (Fort negates).',
  usesPerDay: () => 1,
  saveDC: (level, wisMod) => 10 + Math.floor(level / 2) + wisMod,
  saveType: 'Fort',
  onFailedSave: 'death',
};

export const INQUISITOR_JUDGMENT = {
  name: 'Judgment',
  classes: ['Inquisitor'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 1,
  description: 'Invoke sacred judgment gaining scaling bonuses.',
  usesPerDay: (level) => 1 + Math.floor(level / 3), // 1/day at 1, 2/day at 4, etc.
  judgments: {
    destruction: { damage: (level) => 1 + Math.floor(level / 3) },
    healing: { fastHealing: (level) => 1 + Math.floor(level / 3) },
    justice: { attack: (level) => 1 + Math.floor(level / 5) },
    piercing: { concentrationAndCL: (level) => 1 + Math.floor(level / 3) },
    protection: { ac: (level) => 1 + Math.floor(level / 5) },
    purity: { saves: (level) => 1 + Math.floor(level / 5) },
    resiliency: { dr: (level) => 1 + Math.floor(level / 5), drType: '/magic' },
    resistance: { energyResist: (level) => 2 + Math.floor(level / 3) * 2 },
    smiting: { weaponAlignment: (level) => level >= 10 ? 'aligned' : level >= 6 ? 'magic' : 'magic' },
  },
};

export const INQUISITOR_ORISONS = {
  name: 'Orisons (Inquisitor)',
  classes: ['Inquisitor'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

// ── ORACLE ──

export const ORACLE_ORISONS = {
  name: 'Orisons (Oracle)',
  classes: ['Oracle'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const ORACLE_CURSE = {
  name: 'Oracle Curse',
  classes: ['Oracle'],
  type: 'passive',
  minLevel: 1,
  description: 'Cursed with a drawback that provides benefits as levels increase.',
  curses: {
    clouded_vision: { drawback: 'darkvision_30_only', benefit5: 'blindsense_30', benefit10: 'blindsight_15', benefit15: 'blindsight_30' },
    deaf: { drawback: 'cannot_hear', benefit5: 'no_verbal_component_penalty', benefit10: 'tremorsense_30' },
    haunted: { drawback: 'retrieving_item_is_standard', benefit5: 'mage_hand_ghost_sound', benefit10: 'levitate_minor_image', benefit15: 'telekinesis' },
    lame: { drawback: 'speed_reduced_10', benefit5: 'immune_fatigue', benefit10: 'immune_exhausted', benefit15: 'immune_staggered' },
    tongues: { drawback: 'speaks_only_celestial_in_combat', benefit5: 'more_languages', benefit10: 'speak_any_language' },
    wasting: { drawback: 'minus_4_cha_skills', benefit5: 'immune_sickened', benefit10: 'immune_nauseated', benefit15: 'immune_disease' },
  },
};

export const ORACLE_MYSTERY = {
  name: 'Oracle Mystery',
  classes: ['Oracle'],
  type: 'passive',
  minLevel: 1,
  description: 'Choose a mystery granting bonus spells, class skills, and revelations.',
  mysteries: ['Battle', 'Bones', 'Flame', 'Heavens', 'Life', 'Lore', 'Nature', 'Stone', 'Waves', 'Wind'],
};

export const ORACLE_REVELATION = {
  name: 'Revelation',
  classes: ['Oracle'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain a revelation from chosen mystery at 1st, 3rd, 7th, 11th, 15th, 19th level.',
  revelationsKnown: (level) => {
    let count = 1; // 1st
    if (level >= 3) count++;
    if (level >= 7) count++;
    if (level >= 11) count++;
    if (level >= 15) count++;
    if (level >= 19) count++;
    return count;
  },
};

export const ORACLE_FINAL_REVELATION = {
  name: 'Final Revelation',
  classes: ['Oracle'],
  type: 'passive',
  minLevel: 20,
  description: 'Gain the final revelation of your chosen mystery — powerful capstone ability.',
  effect: 'mystery_capstone',
};

// ── SUMMONER ──

export const SUMMONER_EIDOLON = {
  name: 'Eidolon',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 1,
  description: 'Summon outsider companion that gains evolution points.',
  evolutionPoints: (level) => {
    const table = { 1: 3, 2: 4, 3: 5, 4: 7, 5: 8, 6: 9, 7: 10, 8: 11, 9: 13, 10: 14, 11: 15, 12: 16, 13: 17, 14: 19, 15: 20, 16: 21, 17: 22, 18: 23, 19: 25, 20: 26 };
    return table[level] || 3;
  },
  hd: (level) => level, // Eidolon HD = summoner level
};

export const SUMMONER_SUMMON_MONSTER = {
  name: 'Summoning',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 1,
  description: 'Cast summon monster as spell-like ability. 3 + CHA mod times per day.',
  usesPerDay: (level, chaMod) => 3 + (chaMod || 0),
  maxSpellLevel: (level) => Math.min(9, Math.ceil(level / 2)),
};

export const SUMMONER_CANTRIPS = {
  name: 'Cantrips (Summoner)',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const SUMMONER_LIFE_LINK = {
  name: 'Life Link',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 1,
  description: 'Eidolon can siphon HP from summoner. If eidolon would be reduced below 0, summoner can sacrifice HP.',
  effect: 'eidolon_hp_transfer',
};

export const SUMMONER_BOND_SENSES = {
  name: 'Bond Senses',
  classes: ['Summoner'],
  type: 'self_buff',
  action: 'standard',
  minLevel: 2,
  description: 'Share senses with eidolon as a standard action for level rounds/day.',
  roundsPerDay: (level) => level,
};

export const SUMMONER_SHIELD_ALLY = {
  name: 'Shield Ally',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 4,
  description: 'While eidolon is within reach, summoner gains +2 shield AC and +2 saves.',
  modifiers: { ac: 2, saves: { all: 2 } },
  requirement: 'eidolon_adjacent',
};

export const SUMMONER_MAKERS_CALL = {
  name: "Maker's Call",
  classes: ['Summoner'],
  type: 'self_buff',
  action: 'standard',
  minLevel: 6,
  description: 'Teleport eidolon to adjacent square as standard action.',
  usesPerDay: (level) => Math.floor(level / 6),
  effect: 'teleport_eidolon_adjacent',
};

export const SUMMONER_TRANSPOSITION = {
  name: 'Transposition',
  classes: ['Summoner'],
  type: 'self_buff',
  action: 'standard',
  minLevel: 8,
  description: 'Swap places with eidolon as standard action.',
  usesPerDay: (level) => Math.floor(level / 6),
  effect: 'swap_places_eidolon',
};

export const SUMMONER_ASPECT = {
  name: 'Aspect',
  classes: ['Summoner'],
  type: 'self_buff',
  action: 'standard',
  minLevel: 10,
  description: 'Divert eidolon evolution points to self. 1 point at 10, +1 every 2 levels.',
  maxPoints: (level) => Math.max(1, Math.floor((level - 8) / 2)),
  duration: 'while_eidolon_dismissed',
};

export const SUMMONER_GREATER_SHIELD_ALLY = {
  name: 'Greater Shield Ally',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 12,
  description: 'While eidolon within reach, +4 shield AC and +4 saves (allies +2/+2).',
  modifiers: { ac: 4, saves: { all: 4 } },
  allyModifiers: { ac: 2, saves: { all: 2 } },
  requirement: 'eidolon_adjacent',
};

export const SUMMONER_LIFE_BOND = {
  name: 'Life Bond',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 14,
  description: 'Eidolon is not instantly killed below 0 HP if summoner is conscious; lives as long as summoner.',
  effect: 'eidolon_survives_at_neg_hp',
};

export const SUMMONER_MERGE_FORMS = {
  name: 'Merge Forms',
  classes: ['Summoner'],
  type: 'self_buff',
  action: 'full-round',
  minLevel: 16,
  description: 'Merge with eidolon, becoming protected within its body.',
  duration: (level) => level, // rounds
};

export const SUMMONER_GREATER_ASPECT = {
  name: 'Greater Aspect',
  classes: ['Summoner'],
  type: 'passive',
  minLevel: 18,
  description: 'Divert more evolution points and gain eidolon abilities on self.',
  maxPoints: (level) => Math.floor(level / 4),
};

export const SUMMONER_TWIN_EIDOLON = {
  name: 'Twin Eidolon',
  classes: ['Summoner'],
  type: 'self_buff',
  action: 'full-round',
  minLevel: 20,
  description: 'Merge forms and gain all evolutions and abilities of eidolon.',
  duration: (level) => level, // rounds
  effect: 'become_eidolon',
};

// ── WITCH ──

export const WITCH_PATRON = {
  name: 'Patron',
  classes: ['Witch'],
  type: 'passive',
  minLevel: 1,
  description: 'Choose a patron theme granting bonus spells at even levels.',
  patrons: ['Agility', 'Animals', 'Deception', 'Elements', 'Endurance', 'Plague', 'Shadow', 'Strength', 'Transformation', 'Trickery', 'Water', 'Wisdom'],
};

export const WITCH_CANTRIPS = {
  name: 'Cantrips (Witch)',
  classes: ['Witch'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const WITCH_MAJOR_HEX = {
  name: 'Major Hex',
  classes: ['Witch'],
  type: 'passive',
  minLevel: 10,
  description: 'Can select major hexes (more powerful) in place of regular hexes.',
  commonMajorHexes: {
    agony: { description: 'Nauseated for level rounds (Fort negates each round)' },
    ice_tomb: { description: 'Encase in ice, paralyzed and asleep, takes cold damage (Fort negates)' },
    nightmares: { description: 'Haunts dreams, prevents rest, -4 to DCs next day (Will negates)' },
    retribution: { description: 'Attackers take equal damage' },
    waxen_image: { description: 'As hex vulnerability, affect target at range' },
  },
};

export const WITCH_GRAND_HEX = {
  name: 'Grand Hex',
  classes: ['Witch'],
  type: 'passive',
  minLevel: 18,
  description: 'Can select grand hexes — devastating capstone abilities.',
  commonGrandHexes: {
    death_curse: { description: 'Target dies (Fort negates)', saveType: 'Fort' },
    eternal_slumber: { description: 'Target sleeps forever (Will negates, can only be woken by wish/miracle)', saveType: 'Will' },
    life_giver: { description: 'Resurrect dead creature once per day' },
    natural_disaster: { description: 'Call storm of vengeance (as spell)' },
  },
};

export const WITCH_FAMILIAR = {
  name: 'Familiar',
  classes: ['Witch'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain a familiar that stores all known spells (witch spellbook).',
  effect: 'familiar_is_spellbook',
};

export const WITCH_HEX = {
  name: 'Hexes',
  classes: ['Witch'],
  type: 'self_buff', // Active abilities
  minLevel: 1,
  description: 'Gain witch hexes. Each can target a creature once per 24 hours.',
  hexesKnown: (level) => 1 + Math.floor(level / 2), // 1 at 1st, +1 every 2 levels
  commonHexes: {
    cackle: { action: 'move', description: 'Extend duration of other hexes by 1 round' },
    evil_eye: { action: 'standard', penalty: -2, duration: (level, intMod) => 3 + (intMod || 0), saves: 'Will_for_1_round', affects: ['AC', 'attack', 'saves', 'skills'] },
    fortune: { action: 'standard', description: 'Target can reroll one ability/attack/save/skill and take better', duration: 1 },
    healing: { action: 'standard', healing: (level) => `${Math.ceil(level / 2)}d8+${level}`, oncePerDay: true },
    misfortune: { action: 'standard', description: 'Target must roll twice and take worse', duration: 1, save: 'Will' },
    slumber: { action: 'standard', description: 'Target falls asleep', save: 'Will', hdLimit: (level) => level },
    flight: { minLevel: 5, description: 'Levitate at 5, fly at 8' },
    ice_tomb: { minLevel: 10, description: 'Encase in ice, staggered', save: 'Fort' },
    retribution: { minLevel: 10, description: 'Attackers take equal damage' },
    death_curse: { minLevel: 18, description: 'Target dies (Fort negates)', save: 'Fort' },
  },
};


// ═══════════════════════════════════════════════════════
//  B L O C K  3:  A C G  +  O T H E R  C L A S S E S
// ═══════════════════════════════════════════════════════

// ── ARCANIST ──

export const ARCANIST_ARCANE_RESERVOIR = {
  name: 'Arcane Reservoir',
  classes: ['Arcanist'],
  type: 'resource_pool',
  minLevel: 1,
  description: 'Pool of arcane energy for exploits and boosting spells.',
  poolSize: (level, chaMod) => 3 + level,
  consume: { description: '+1 CL or +1 DC for one spell', cost: 1 },
};

export const ARCANIST_CONSUME_SPELLS = {
  name: 'Consume Spells',
  classes: ['Arcanist'],
  type: 'self_buff',
  action: 'move',
  minLevel: 1,
  description: 'Expend a prepared spell to regain reservoir points (1 per spell level).',
  pointsRecovered: (spellLevel) => spellLevel,
  effect: 'convert_spell_to_reservoir',
};

export const ARCANIST_ARCANE_EXPLOITS = {
  name: 'Arcane Exploits',
  classes: ['Arcanist'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain arcane exploits (supernatural abilities). 1 at 1st, +1 every odd level.',
  exploitsKnown: (level) => Math.ceil(level / 2),
  commonExploits: {
    acid_jet: { cost: 1, damage: (level) => `${1 + Math.floor(level / 2)}d6`, type: 'ranged_touch' },
    arcane_barrier: { cost: 1, ac: (level) => 1 + Math.floor(level / 5), duration: 1 },
    counterspell: { cost: 1, description: 'Counter spell as immediate action' },
    dimensional_slide: { cost: 1, distance: (level) => level * 10, unit: 'feet' },
    flame_arc: { cost: 1, damage: (level) => `${1 + Math.floor(level / 2)}d6`, area: '15ft_cone' },
    potent_magic: { cost: 1, description: '+2 CL or +2 DC (instead of +1)' },
    quick_study: { cost: 1, description: 'Swap a prepared spell as a full-round action' },
  },
};

export const ARCANIST_GREATER_EXPLOITS = {
  name: 'Greater Exploits',
  classes: ['Arcanist'],
  type: 'passive',
  minLevel: 11,
  description: 'Can select greater exploits (more powerful). Available at 11+.',
  commonGreaterExploits: {
    alter_enhancements: { cost: 1, description: 'Change weapon/armor enhancement properties as standard' },
    burning_flame: { cost: 2, description: 'Flame arc sets targets on fire' },
    counter_drain: { cost: 0, description: 'Regain reservoir points when successfully counterspelling' },
    greater_counterspell: { cost: 2, description: 'Counter with any spell, not just same/higher' },
    spell_resistance: { cost: 1, sr: (level) => 11 + level, duration: 1 },
    siphon_spell: { cost: 0, description: 'Absorb targeted spell as immediate action' },
  },
};

export const ARCANIST_CANTRIPS = {
  name: 'Cantrips (Arcanist)',
  classes: ['Arcanist'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

// ── BLOODRAGER ──

export const BLOODRAGER_BLOODRAGE = {
  name: 'Bloodrage',
  classes: ['Bloodrager'],
  type: 'self_buff',
  action: 'free',
  minLevel: 1,
  description: 'Enter rage gaining STR/CON/Will. Can cast bloodline spells while raging.',
  roundsPerDay: (level, conMod) => 4 + conMod + (level - 1) * 2,
  modifiers: (level) => {
    if (level >= 20) return { strBonus: 8, conBonus: 8, saves: { Will: 4 }, ac: -2 };
    if (level >= 11) return { strBonus: 6, conBonus: 6, saves: { Will: 3 }, ac: -2 };
    return { strBonus: 4, conBonus: 4, saves: { Will: 2 }, ac: -2 };
  },
  canCastBloodlineSpells: true,
};

export const BLOODRAGER_FAST_MOVEMENT = {
  name: 'Fast Movement (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 1,
  description: '+10 ft. land speed when not in heavy armor.',
  speedBonus: () => 10,
  restriction: 'not_heavy_armor',
};

export const BLOODRAGER_BLOODLINE = {
  name: 'Bloodrager Bloodline',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain bloodline powers while bloodraging + bonus spells/feats.',
  bloodlines: ['Aberrant', 'Abyssal', 'Arcane', 'Celestial', 'Destined', 'Draconic', 'Elemental', 'Fey', 'Infernal', 'Undead'],
};

export const BLOODRAGER_ESCHEW_MATERIALS = {
  name: 'Eschew Materials (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 1,
  description: 'Cast spells without material components costing 1 gp or less.',
  effect: 'ignore_cheap_material_components',
};

export const BLOODRAGER_BLOOD_SANCTUARY = {
  name: 'Blood Sanctuary',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 3,
  description: 'Allies must make concentration check (DC 15 + spell level) to target bloodrager with spells while bloodraging.',
  effect: 'allies_need_concentration_to_target',
};

export const BLOODRAGER_BLOOD_CASTING = {
  name: 'Blood Casting',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 4,
  description: 'Can cast bloodrager spells while bloodraging.',
  effect: 'cast_while_raging',
};

export const BLOODRAGER_UNCANNY_DODGE = {
  name: 'Uncanny Dodge (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 2,
  description: 'Cannot be caught flat-footed, retains DEX bonus to AC vs invisible attackers.',
  effect: 'retain_dex_to_ac',
};

export const BLOODRAGER_IMPROVED_UNCANNY_DODGE = {
  name: 'Improved Uncanny Dodge (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 5,
  description: 'Cannot be flanked unless attacker has 4+ more bloodrager levels.',
  effect: 'cannot_be_flanked',
  flankedByLevelThreshold: 4,
};

export const BLOODRAGER_DR = {
  name: 'Damage Reduction (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 7,
  description: 'Gain DR/- while bloodraging.',
  dr: (level) => {
    if (level < 7) return 0;
    return Math.floor((level - 4) / 3); // 1 at 7, 2 at 10, 3 at 13, 4 at 16, 5 at 19
  },
  drType: '/-',
  requirement: 'while_bloodraging',
};

export const BLOODRAGER_GREATER_BLOODRAGE = {
  name: 'Greater Bloodrage',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 11,
  description: 'Bloodrage bonuses increase to +6 STR/CON, +3 morale to Will saves.',
  // Handled by BLOODRAGER_BLOODRAGE.modifiers(level) scaling
};

export const BLOODRAGER_INDOMITABLE_WILL = {
  name: 'Indomitable Will (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 14,
  description: '+4 bonus on Will saves vs enchantment while bloodraging.',
  modifiers: { saves: { Will: 4 } },
  context: 'while_bloodraging_vs_enchantment',
};

export const BLOODRAGER_TIRELESS_BLOODRAGE = {
  name: 'Tireless Bloodrage',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 17,
  description: 'No longer fatigued after bloodrage ends.',
  effect: 'no_fatigue_after_bloodrage',
};

export const BLOODRAGER_MIGHTY_BLOODRAGE = {
  name: 'Mighty Bloodrage',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 20,
  description: 'Bloodrage bonuses increase to +8 STR/CON, +4 Will.',
};

export const BLOODRAGER_BLOODLINE_FEAT = {
  name: 'Bloodline Feat (Bloodrager)',
  classes: ['Bloodrager'],
  type: 'passive',
  minLevel: 6,
  description: 'Gain a bonus feat from your bloodline list at 6th, 9th, 12th, 15th, and 18th level.',
  featsGained: (level) => {
    let feats = 0;
    [6, 9, 12, 15, 18].forEach(l => { if (level >= l) feats++; });
    return feats;
  },
};

// ── BRAWLER ──

export const BRAWLER_MARTIAL_FLEXIBILITY = {
  name: 'Martial Flexibility',
  classes: ['Brawler'],
  type: 'self_buff',
  action: 'move', // Swift at 6, free at 10, immediate at 12
  minLevel: 1,
  description: 'Gain a combat feat for 1 minute.',
  usesPerDay: (level) => 4 + Math.floor(level / 4),
  actionByLevel: (level) => level >= 12 ? 'immediate' : level >= 10 ? 'free' : level >= 6 ? 'swift' : 'move',
  duration: 1, // minutes
  featsAtOnce: (level) => level >= 15 ? 3 : level >= 9 ? 2 : 1,
};

export const BRAWLER_UNARMED_STRIKE = {
  name: 'Unarmed Strike (Brawler)',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 1,
  description: 'Damage as monk of brawler level -4 (minimum 1).',
  damageDice: (level) => {
    const effectiveMonkLevel = Math.max(1, level - 4);
    const table = { 1: '1d6', 4: '1d8', 8: '1d10', 12: '2d6', 16: '2d8', 20: '2d10' };
    for (let l = effectiveMonkLevel; l >= 1; l--) {
      if (table[l]) return table[l];
    }
    return '1d6';
  },
};

export const BRAWLER_FLURRY = {
  name: "Brawler's Flurry",
  classes: ['Brawler'],
  type: 'full_attack_modifier',
  action: 'full-round',
  minLevel: 2,
  description: 'Full attack with unarmed/close weapons using TWF progression without penalties.',
  extraAttacks: (level) => {
    if (level >= 15) return 3; // Greater TWF
    if (level >= 11) return 2; // Improved TWF
    if (level >= 2) return 1; // TWF
    return 0;
  },
  attackPenalty: () => 0, // No penalty with close/unarmed
  requirement: 'unarmed_or_close_weapon',
};

export const BRAWLER_MANEUVER_TRAINING = {
  name: 'Maneuver Training (Brawler)',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 3,
  description: 'Use brawler level as BAB for CMB. +1 CMB with chosen maneuver at 3, 7, 11, 15, 19.',
  cmbBonus: (level) => {
    if (level < 3) return 0;
    return 1 + Math.floor((level - 3) / 4);
  },
  effect: 'brawler_level_as_bab_for_cmb',
};

export const BRAWLER_AC_BONUS = {
  name: 'AC Bonus (Brawler)',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 4,
  description: '+1 dodge AC at 4, increases by +1 at 9, 13, 18.',
  modifiers: (level) => {
    if (level >= 18) return { ac: 4 };
    if (level >= 13) return { ac: 3 };
    if (level >= 9) return { ac: 2 };
    if (level >= 4) return { ac: 1 };
    return { ac: 0 };
  },
  requirement: 'light_or_no_armor',
};

export const BRAWLER_BONUS_FEAT = {
  name: 'Bonus Feat (Brawler)',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 2,
  description: 'Gain a bonus combat feat at 2nd, 5th, 8th, 11th, 14th, 17th, and 20th level.',
  featsGained: (level) => {
    let count = 0;
    const levels = [2, 5, 8, 11, 14, 17, 20];
    for (const l of levels) { if (level >= l) count++; }
    return count;
  },
};

export const BRAWLER_KNOCKOUT = {
  name: 'Knockout',
  classes: ['Brawler'],
  type: 'extra_damage',
  action: 'standard',
  minLevel: 4,
  description: 'Once per day, declare knockout blow. Target must Fort save or fall unconscious 1d6 rounds.',
  usesPerDay: (level) => {
    if (level >= 16) return 4;
    if (level >= 12) return 3;
    if (level >= 8) return 2;
    return 1;
  },
  saveDC: (level, strMod) => 10 + Math.floor(level / 2) + strMod,
  saveType: 'Fort',
  effect: 'unconscious_1d6_rounds',
};

export const BRAWLER_BRAWLERS_STRIKE = {
  name: "Brawler's Strike",
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 5,
  description: 'Unarmed attacks count as magic (5), cold iron/silver (9), alignment (12), adamantine (17).',
  strikeTypes: {
    5: 'magic',
    9: 'cold_iron_silver',
    12: 'alignment',
    17: 'adamantine',
  },
};

export const BRAWLER_CLOSE_WEAPON_MASTERY = {
  name: 'Close Weapon Mastery',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 5,
  description: 'Close weapon group damage die improves by one step.',
  effect: 'close_weapon_die_increase',
};

export const BRAWLER_CUNNING = {
  name: "Brawler's Cunning",
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 1,
  description: 'INT counts as 13 for qualifying for combat feats.',
  effect: 'int_13_for_combat_feats',
};

export const BRAWLER_AWESOME_BLOW = {
  name: 'Awesome Blow',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 16,
  description: 'Can use Awesome Blow as a standard action, pushing target 10 ft and knocking prone on hit.',
  effect: 'awesome_blow_standard_action',
};

export const BRAWLER_IMPROVED_AWESOME_BLOW = {
  name: 'Improved Awesome Blow',
  classes: ['Brawler'],
  type: 'passive',
  minLevel: 20,
  description: 'Awesome Blow with double damage. Targets that fail Ref save are stunned 1 round.',
  saveDC: (level, strMod) => 10 + Math.floor(level / 2) + strMod,
  effects: ['double_damage', 'stun_1_round_on_failed_ref'],
};

// ── HUNTER ──

export const HUNTER_ORISONS = {
  name: 'Orisons (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const HUNTER_ANIMAL_COMPANION = {
  name: 'Animal Companion (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 1,
  description: 'Full druid-level animal companion.',
  effectiveDruidLevel: (level) => level,
};

export const HUNTER_ANIMAL_FOCUS = {
  name: 'Animal Focus',
  classes: ['Hunter'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 1,
  description: 'Gain aspect of an animal (+2 enhancement to ability or special ability).',
  foci: {
    bear: { conBonus: 2 }, bull: { strBonus: 2 }, falcon: { perception: 4 },
    monkey: { climb: 4 }, mouse: { evasion: true }, owl: { stealth: 4 },
    snake: { aooAttack: 2, aooAC: 2 }, stag: { speedBonus: 5 }, tiger: { dexBonus: 2 },
  },
  scaling: (level) => {
    if (level >= 15) return { enhancement: 6, competence: 8, speed: 10 };
    if (level >= 8) return { enhancement: 4, competence: 6, speed: 10 };
    return { enhancement: 2, competence: 4, speed: 5 };
  },
};

export const HUNTER_WILD_EMPATHY = {
  name: 'Wild Empathy (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 1,
  description: 'Improve attitude of animals. Roll 1d20 + hunter level + CHA mod.',
  check: (level, chaMod) => level + chaMod,
};

export const HUNTER_TRACK = {
  name: 'Track (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 2,
  description: '+1/2 level to Survival checks to follow tracks.',
  modifiers: (level) => ({ skills: { Survival_tracking: Math.max(1, Math.floor(level / 2)) } }),
};

export const HUNTER_PRECISE_COMPANION = {
  name: 'Precise Companion',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 2,
  description: 'Gain Precise Shot as bonus feat. Animal companion also gains this feat.',
  effect: 'bonus_feat_precise_shot_pair',
};

export const HUNTER_HUNTER_TACTICS = {
  name: 'Hunter Tactics',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 3,
  description: 'Animal companion counts as having all teamwork feats the hunter has.',
  effect: 'companion_shares_teamwork_feats',
};

export const HUNTER_TEAMWORK_FEAT = {
  name: 'Teamwork Feat (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 3,
  description: 'Gain bonus teamwork feat at 3, 6, 9, 12, 15, 18. Can swap most recent.',
  featsGained: (level) => Math.max(0, Math.floor(level / 3)),
};

export const HUNTER_WOODLAND_STRIDE = {
  name: 'Woodland Stride (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 5,
  description: 'Move through natural undergrowth at normal speed.',
  effect: 'ignore_natural_difficult_terrain',
};

export const HUNTER_RAISE_ANIMAL_COMPANION = {
  name: 'Raise Animal Companion',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 10,
  description: 'Can use raise dead on animal companion without material component, as full-round action.',
  effect: 'raise_dead_companion_free',
};

export const HUNTER_SECOND_ANIMAL_FOCUS = {
  name: 'Second Animal Focus',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 8,
  description: 'Can apply a second animal focus to self (or first focus to self while companion has one).',
  effect: 'second_animal_focus_self',
};

export const HUNTER_SWIFT_TRACKER = {
  name: 'Swift Tracker (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 8,
  description: 'Track at normal speed without penalty, or at double speed at -10.',
  effect: 'track_without_speed_penalty',
};

export const HUNTER_MASTER_HUNTER_CAPSTONE = {
  name: 'Master Hunter (Hunter)',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 20,
  description: 'Animal focus is now permanent. Can apply multiple foci.',
  effect: 'permanent_animal_focus',
};

export const HUNTER_NATURE_TRAINING = {
  name: 'Nature Training',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 1,
  description: 'Hunter level counts as both druid and ranger level for qualifying for feats, traits, and options.',
  effect: 'counts_as_druid_and_ranger_level',
};

export const HUNTER_BONUS_TRICKS = {
  name: 'Bonus Tricks',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 7,
  description: 'Animal companion gains bonus tricks equal to 1/2 hunter level.',
  bonusTricks: (level) => Math.floor(level / 2),
};

export const HUNTER_IMPROVED_EMPATHIC_LINK = {
  name: 'Improved Empathic Link',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 4,
  description: 'Can see through animal companion\'s eyes as swift action. Share spells at any distance.',
  effects: ['share_senses_swift', 'share_spells_any_distance'],
};

export const HUNTER_ONE_WITH_WILD = {
  name: 'One with the Wild',
  classes: ['Hunter'],
  type: 'passive',
  minLevel: 17,
  description: 'Constant wild empathy with animals in 30 ft. Can communicate with animals freely.',
  effect: 'constant_wild_empathy_30ft',
};

// ── INVESTIGATOR ──

export const INVESTIGATOR_INSPIRATION = {
  name: 'Inspiration',
  classes: ['Investigator'],
  type: 'resource_pool',
  minLevel: 1,
  description: 'Add 1d6 to skill checks, attack rolls, and saves by spending inspiration.',
  poolSize: (level, intMod) => Math.floor(level / 2) + intMod,
  inspirationDie: (level) => level >= 20 ? 'd8' : 'd6',
  freeOnKnowledge: true, // Free on Knowledge, Linguistics, Spellcraft
};

export const INVESTIGATOR_TRAPFINDING = {
  name: 'Trapfinding (Investigator)',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 1,
  description: '+1/2 level to Perception to find traps and Disable Device.',
  modifiers: (level) => ({
    skills: { Perception_traps: Math.max(1, Math.floor(level / 2)), 'Disable Device': Math.max(1, Math.floor(level / 2)) },
  }),
  effect: 'can_disarm_magic_traps',
};

export const INVESTIGATOR_POISON_LORE = {
  name: 'Poison Lore',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 2,
  description: 'Cannot accidentally poison self. Can identify poisons with Craft (alchemy).',
  effect: 'no_self_poisoning',
};

export const INVESTIGATOR_POISON_RESISTANCE = {
  name: 'Poison Resistance',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 2,
  description: '+2 save vs poison at 2, +4 at 5, +6 at 8.',
  modifiers: (level) => ({
    saves: { poison: level >= 8 ? 6 : level >= 5 ? 4 : 2 },
  }),
};

export const INVESTIGATOR_KEEN_RECOLLECTION = {
  name: 'Keen Recollection (Investigator)',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 2,
  description: 'Can make all Knowledge checks untrained.',
  effect: 'knowledge_untrained',
};

export const INVESTIGATOR_TRAP_SENSE = {
  name: 'Trap Sense (Investigator)',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 3,
  description: 'Bonus on Reflex saves and AC vs traps.',
  scaling: (level) => Math.floor(level / 3),
  modifiers: (bonus) => ({ saves: { Ref: bonus }, ac: bonus }),
  context: 'traps_only',
};

export const INVESTIGATOR_STUDIED_COMBAT = {
  name: 'Studied Combat',
  classes: ['Investigator'],
  type: 'targeted_buff',
  action: 'move', // Swift at 9
  minLevel: 4,
  description: 'Study a creature as move action: +1/2 level insight to attack and damage.',
  actionByLevel: (level) => level >= 9 ? 'swift' : 'move',
  bonus: (level) => Math.max(1, Math.floor(level / 2)),
  duration: (level, intMod) => intMod, // rounds = INT mod
  modifiers: (bonus) => ({ attack: bonus, damage: bonus }),
};

export const INVESTIGATOR_STUDIED_STRIKE = {
  name: 'Studied Strike',
  classes: ['Investigator'],
  type: 'extra_damage',
  minLevel: 4,
  description: 'End studied combat to deal extra precision damage on hit.',
  scaling: {
    dicePerLevel: (level) => Math.max(1, Math.floor(level / 4)), // 1d6 at 4, 2d6 at 8, etc.
    sides: 6,
  },
};

export const INVESTIGATOR_TALENT = {
  name: 'Investigator Talents',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 3,
  description: 'Gain investigator talents every odd level from 3.',
  talentsKnown: (level) => Math.max(0, Math.ceil((level - 1) / 2)),
};

export const INVESTIGATOR_POISON_IMMUNITY = {
  name: 'Poison Immunity (Investigator)',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 11,
  description: 'Immune to all poisons.',
  effect: 'poison_immunity',
};

export const INVESTIGATOR_TRUE_INSPIRATION = {
  name: 'True Inspiration',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 20,
  description: 'Inspiration die becomes d8. Can use on attack rolls and saves without spending points.',
  inspirationDie: 'd8',
  effect: 'free_inspiration_on_attacks_saves',
};

export const INVESTIGATOR_SWIFT_ALCHEMY = {
  name: 'Swift Alchemy (Investigator)',
  classes: ['Investigator'],
  type: 'passive',
  minLevel: 4,
  description: 'Create alchemical items in half normal time. Apply poison as move action.',
  effect: 'half_time_alchemy',
  poisonAction: 'move',
};

// ── SHAMAN ──

export const SHAMAN_SPIRIT = {
  name: 'Spirit',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 1,
  description: 'Bond with a spirit granting hexes and spirit abilities.',
  spirits: ['Battle', 'Bones', 'Flame', 'Heavens', 'Life', 'Lore', 'Mammoth', 'Nature', 'Stone', 'Waves', 'Wind', 'Wood'],
};

export const SHAMAN_SPIRIT_ANIMAL = {
  name: 'Spirit Animal Companion',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain a spirit animal familiar that grants additional abilities.',
  effect: 'familiar_with_spirit_powers',
};

export const SHAMAN_ORISONS = {
  name: 'Orisons (Shaman)',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const SHAMAN_HEX = {
  name: 'Shaman Hex',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 2,
  description: 'Gain shaman hexes (similar to witch hexes). Choose from spirit or wandering hex.',
  hexesKnown: (level) => Math.floor(level / 2),
};

export const SHAMAN_WANDERING_SPIRIT = {
  name: 'Wandering Spirit',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 4,
  description: 'Each day, bond with an additional spirit gaining its spirit ability and bonus spells.',
  effect: 'daily_second_spirit',
};

export const SHAMAN_WANDERING_HEX = {
  name: 'Wandering Hex',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 6,
  description: 'Each day, gain a hex from the wandering spirit.',
  effect: 'daily_wandering_hex',
};

export const SHAMAN_SPIRIT_MAGIC = {
  name: 'Spirit Magic',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain bonus spells from spirit (one per spell level, added to spells prepared each day).',
  effect: 'bonus_spells_from_spirit',
};

export const SHAMAN_GREATER_WANDERING_SPIRIT = {
  name: 'Greater Wandering Spirit',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 12,
  description: 'Gain the true spirit ability and greater spirit ability of the wandering spirit.',
  effect: 'greater_wandering_spirit_powers',
};

export const SHAMAN_MANIFESTATION = {
  name: 'Manifestation',
  classes: ['Shaman'],
  type: 'passive',
  minLevel: 20,
  description: 'Capstone ability from chosen spirit, granting immense power.',
  effect: 'spirit_capstone',
};

// ── SKALD ──

export const SKALD_RAGING_SONG = {
  name: 'Raging Song',
  classes: ['Skald'],
  type: 'party_buff',
  action: 'standard',
  minLevel: 1,
  description: 'Inspired rage: allies gain rage bonuses without the restrictions. Move action at 7, swift at 13.',
  roundsPerDay: (level, chaMod) => 4 + chaMod + (level - 1) * 2,
  actionByLevel: (level) => level >= 13 ? 'swift' : level >= 7 ? 'move' : 'standard',
  modifiers: (level) => {
    // PF1e ACG: +2/+2/+1/-1 base, increases by +2/+2/+1/-1 at L4 and every 4 levels
    const tier = Math.floor(level / 4);
    return {
      strBonus: 2 + tier * 2,
      conBonus: 2 + tier * 2,
      saves: { Will: 1 + tier },
      ac: -(1 + tier),
    };
  },
  affectsAllies: true,
  alliesCanCast: false, // Allies in inspired rage cannot cast spells
};

export const SKALD_BARDIC_KNOWLEDGE = {
  name: 'Bardic Knowledge (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 1,
  description: 'Add half class level to all Knowledge checks; can make untrained.',
  modifiers: (level) => ({ skills: { Knowledge: Math.max(1, Math.floor(level / 2)) } }),
  effect: 'knowledge_untrained',
};

export const SKALD_SCRIBE_SCROLL = {
  name: 'Scribe Scroll (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain Scribe Scroll as a bonus feat.',
  effect: 'bonus_feat_scribe_scroll',
};

export const SKALD_CANTRIPS = {
  name: 'Cantrips (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const SKALD_WELL_VERSED = {
  name: 'Well-Versed (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 2,
  description: '+4 save vs bardic performance, sonic, and language-dependent effects.',
  modifiers: { saves: { bardic: 4, sonic: 4, languageDependent: 4 } },
};

export const SKALD_VERSATILE_PERFORMANCE = {
  name: 'Versatile Performance (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 2,
  description: 'Use Perform skill rank in place of associated skills.',
  levelInterval: 5, // Gain at 2, 7, 12, 17
};

export const SKALD_LORE_MASTER = {
  name: 'Lore Master (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 5,
  description: 'Take 10 on Knowledge checks; take 20 once/day (plus once more per 6 levels).',
  take20PerDay: (level) => 1 + Math.floor((level - 5) / 6),
};

export const SKALD_SPELL_KENNING = {
  name: 'Spell Kenning',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 5,
  description: 'Once per day, cast any spell from bard/cleric/wizard list using a spell slot. Additional use at 11 and 17.',
  usesPerDay: (level) => {
    if (level >= 17) return 3;
    if (level >= 11) return 2;
    if (level >= 5) return 1;
    return 0;
  },
};

export const SKALD_SONG_OF_MARCHING = {
  name: 'Song of Marching',
  classes: ['Skald'],
  type: 'party_buff',
  minLevel: 3,
  description: 'Allies can force march without Con checks or nonlethal damage.',
  effect: 'force_march_no_penalty',
};

export const SKALD_RAGE_POWER = {
  name: 'Rage Power (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 3,
  description: 'Learn a rage power at 3rd and every 3 levels. Allies using raging song gain these powers.',
  powersKnown: (level) => Math.max(0, Math.floor(level / 3)),
};

export const SKALD_SONG_OF_STRENGTH = {
  name: 'Song of Strength',
  classes: ['Skald'],
  type: 'party_buff',
  minLevel: 6,
  description: 'Allies gain +2 STR and damage rolls (increases at 12 and 18).',
  modifiers: (level) => ({
    strBonus: level >= 18 ? 6 : level >= 12 ? 4 : 2,
    damage: level >= 18 ? 3 : level >= 12 ? 2 : 1,
  }),
};

export const SKALD_DIRGE_OF_DOOM = {
  name: 'Dirge of Doom',
  classes: ['Skald'],
  type: 'party_buff',
  minLevel: 10,
  description: 'Enemies within 30 ft. become shaken (no save).',
  range: 30,
  effect: 'enemies_shaken_no_save',
};

export const SKALD_SONG_OF_THE_FALLEN = {
  name: 'Song of the Fallen',
  classes: ['Skald'],
  type: 'party_buff',
  minLevel: 14,
  description: 'Dead allies within 30 ft. temporarily animate and fight.',
  range: 30,
  effect: 'animate_dead_allies',
};

export const SKALD_DR = {
  name: 'Damage Reduction (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 9,
  description: 'Gain DR/lethal. Increases at 14 and 19.',
  dr: (level) => {
    if (level >= 19) return 3;
    if (level >= 14) return 2;
    if (level >= 9) return 1;
    return 0;
  },
  drType: '/lethal',
};

export const SKALD_MASTER_SKALD = {
  name: 'Master Skald',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 20,
  description: 'DR 5/— while maintaining raging song. Cannot be flanked or caught flat-footed.',
  dr: { amount: 5, type: '/-' },
  effects: ['cannot_be_flanked', 'cannot_be_flat_footed'],
};

export const SKALD_UNCANNY_DODGE = {
  name: 'Uncanny Dodge (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 4,
  description: 'Cannot be caught flat-footed, retains DEX bonus to AC vs invisible attackers.',
  effect: 'retain_dex_to_ac',
};

export const SKALD_IMPROVED_UNCANNY_DODGE = {
  name: 'Improved Uncanny Dodge (Skald)',
  classes: ['Skald'],
  type: 'passive',
  minLevel: 8,
  description: 'Cannot be flanked unless attacker has 4+ more rogue levels.',
  effect: 'cannot_be_flanked',
  flankedByLevelThreshold: 4,
};

// ── SLAYER ──

export const SLAYER_STUDIED_TARGET = {
  name: 'Studied Target',
  classes: ['Slayer'],
  type: 'targeted_buff',
  action: 'move', // Swift at 7
  minLevel: 1,
  description: 'Study target: +bonus to attack, damage, Bluff, Knowledge, Perception, Sense Motive, Survival vs target.',
  actionByLevel: (level) => level >= 7 ? 'swift' : 'move',
  bonus: (level) => {
    if (level >= 20) return 5;
    if (level >= 15) return 4;
    if (level >= 10) return 3;
    if (level >= 5) return 2;
    return 1;
  },
  simultaneousTargets: (level) => {
    if (level >= 20) return 5;
    if (level >= 15) return 4;
    if (level >= 10) return 3;
    if (level >= 5) return 2;
    return 1;
  },
  modifiers: (bonus) => ({
    attack: bonus, damage: bonus,
    skills: { Bluff: bonus, Knowledge: bonus, Perception: bonus, 'Sense Motive': bonus, Survival: bonus },
  }),
};

export const SLAYER_SNEAK_ATTACK = {
  name: 'Sneak Attack (Slayer)',
  classes: ['Slayer'],
  type: 'extra_damage',
  minLevel: 3,
  trigger: 'flanking_or_denied_dex',
  scaling: {
    dicePerLevel: (level) => Math.max(0, Math.floor(level / 3)), // 1d6 at 3, 2d6 at 6, 3d6 at 9, etc.
    sides: 6,
  },
};

export const SLAYER_TRACK = {
  name: 'Track (Slayer)',
  classes: ['Slayer'],
  type: 'passive',
  minLevel: 1,
  description: '+1/2 level (minimum 1) to Survival checks to follow tracks.',
  modifiers: (level) => ({
    skills: { Survival_tracking: Math.max(1, Math.floor(level / 2)) },
  }),
};

export const SLAYER_TALENT = {
  name: 'Slayer Talent',
  classes: ['Slayer'],
  type: 'passive',
  minLevel: 2,
  description: 'Gain a slayer talent at 2nd level and every 2 levels. Can select ranger combat style or rogue talents.',
  talentsKnown: (level) => Math.floor(level / 2),
};

export const SLAYER_STALKER = {
  name: 'Stalker',
  classes: ['Slayer'],
  type: 'passive',
  minLevel: 7,
  description: '+1/2 level to Stealth checks (+5 when following studied target via Disguise).',
  modifiers: (level) => ({
    skills: { Stealth: Math.max(1, Math.floor(level / 2)) },
  }),
};

export const SLAYER_QUARRY = {
  name: 'Quarry (Slayer)',
  classes: ['Slayer'],
  type: 'targeted_buff',
  action: 'standard',
  minLevel: 14,
  description: 'Designate studied target as quarry. +2 attack, auto-confirm crits, can track with Perception.',
  modifiers: { attack: 2 },
  effects: ['auto_confirm_crits', 'track_with_perception'],
};

export const SLAYER_IMPROVED_QUARRY = {
  name: 'Improved Quarry (Slayer)',
  classes: ['Slayer'],
  type: 'targeted_buff',
  action: 'free',
  minLevel: 19,
  description: 'Quarry as free action, +4 attack, auto-confirm crits.',
  modifiers: { attack: 4 },
  effects: ['auto_confirm_crits'],
};

export const SLAYER_MASTER_SLAYER = {
  name: 'Master Slayer',
  classes: ['Slayer'],
  type: 'passive',
  minLevel: 20,
  description: 'Against studied target, sneak attack deals death effect (Fort negates). +5 studied target bonus.',
  saveDC: (level, intMod) => 10 + Math.floor(level / 2) + intMod,
  saveType: 'Fort',
  onFailedSave: 'death',
};

export const SLAYER_ADVANCED_TALENT = {
  name: 'Advanced Slayer Talent',
  classes: ['Slayer'],
  type: 'passive',
  minLevel: 10,
  description: 'At 10th level and above, can select advanced slayer talents in place of regular talents.',
  effect: 'unlock_advanced_talents',
};

// ── SWASHBUCKLER ──

export const SWASHBUCKLER_FINESSE = {
  name: 'Swashbuckler Finesse',
  classes: ['Swashbuckler'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain Weapon Finesse as bonus feat. Use CHA instead of INT for prerequisites of combat feats.',
  effects: ['weapon_finesse', 'cha_replaces_int_for_combat_feat_prereqs'],
};

export const SWASHBUCKLER_PANACHE = {
  name: 'Panache',
  classes: ['Swashbuckler'],
  type: 'resource_pool',
  minLevel: 1,
  description: 'Pool of panache points for daring deeds.',
  poolSize: (chaMod) => Math.max(1, chaMod),
  regain: ['crit_with_light_piercing', 'killing_blow_with_light_piercing'],
};

export const SWASHBUCKLER_DEEDS = {
  name: 'Deeds',
  classes: ['Swashbuckler'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain swashbuckler deeds at 1, 3, 7, 11, 15, 19.',
  deeds: {
    derring_do: { minLevel: 1, cost: 1, description: '+1d6 to Acrobatics, Climb, Escape Artist, Fly, Ride, Swim. Exploding on 6.' },
    dodging_panache: { minLevel: 1, cost: 1, description: 'Immediate: +INT to AC vs one attack' },
    opportune_parry: { minLevel: 1, cost: 1, description: 'AoO to parry melee attack, then riposte' },
    precise_strike: { minLevel: 3, cost: 0, description: '+level precision damage with light/one-handed piercing', damage: (level) => level },
    swashbuckler_initiative: { minLevel: 3, cost: 0, description: '+2 initiative while having 1+ panache' },
    menacing_swordplay: { minLevel: 3, cost: 1, description: 'Intimidate as swift after hit' },
    targeted_strike: { minLevel: 7, cost: 1, description: 'Target specific body parts for debuffs' },
    bleeding_wound: { minLevel: 11, cost: 1, description: 'Bleed damage equal to DEX mod or STR/DEX damage' },
    perfect_thrust: { minLevel: 15, cost: 2, description: 'Ignore DR, resolve as touch attack' },
    stunning_stab: { minLevel: 19, cost: 2, description: 'Target stunned 1 round (Fort negates)' },
  },
};

export const SWASHBUCKLER_WEAPON_TRAINING = {
  name: 'Weapon Training (Swashbuckler)',
  classes: ['Swashbuckler'],
  type: 'passive',
  minLevel: 5,
  description: '+1 attack/damage with light/one-handed piercing at 5, increases at 9, 13, 17.',
  scaling: (level) => {
    if (level >= 17) return 4;
    if (level >= 13) return 3;
    if (level >= 9) return 2;
    if (level >= 5) return 1;
    return 0;
  },
  modifiers: (bonus) => ({ attack: bonus, damage: bonus }),
};

export const SWASHBUCKLER_CHARMED_LIFE = {
  name: 'Charmed Life',
  classes: ['Swashbuckler'],
  type: 'self_buff',
  action: 'immediate',
  minLevel: 2,
  description: 'Add CHA modifier to one saving throw before rolling.',
  usesPerDay: (level) => {
    if (level >= 18) return 7;
    if (level >= 14) return 6;
    if (level >= 10) return 5;
    if (level >= 6) return 4;
    if (level >= 2) return 3;
    return 0;
  },
};

export const SWASHBUCKLER_NIMBLE = {
  name: 'Nimble',
  classes: ['Swashbuckler'],
  type: 'passive',
  minLevel: 3,
  description: '+1 dodge AC at 3, increases by +1 at 7, 11, 15, 19.',
  modifiers: (level) => ({
    ac: Math.max(0, 1 + Math.floor((level - 3) / 4)),
  }),
  requirement: 'light_or_no_armor',
};

export const SWASHBUCKLER_BONUS_FEAT = {
  name: 'Bonus Feat (Swashbuckler)',
  classes: ['Swashbuckler'],
  type: 'passive',
  minLevel: 4,
  description: 'Gain a bonus combat feat at 4 and every 4 levels thereafter.',
  featsGained: (level) => Math.floor(level / 4),
};

export const SWASHBUCKLER_WEAPON_MASTERY = {
  name: 'Swashbuckler Weapon Mastery',
  classes: ['Swashbuckler'],
  type: 'passive',
  minLevel: 20,
  description: 'Choose one piercing weapon: auto-confirm crits, +1 crit multiplier, cannot be disarmed.',
  effects: ['auto_confirm_crits', 'plus_1_crit_multiplier', 'cannot_be_disarmed'],
};

// ── WARPRIEST ──

export const WARPRIEST_BONUS_FEAT = {
  name: 'Bonus Feat (Warpriest)',
  classes: ['Warpriest'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain a bonus combat feat at 1st level and every 3 levels.',
  featsGained: (level) => 1 + Math.floor(level / 3),
};

export const WARPRIEST_ORISONS = {
  name: 'Orisons (Warpriest)',
  classes: ['Warpriest'],
  type: 'passive',
  minLevel: 1,
  description: '0-level spells can be cast unlimited times per day.',
  effect: 'unlimited_cantrips',
};

export const WARPRIEST_SACRED_WEAPON = {
  name: 'Sacred Weapon',
  classes: ['Warpriest'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 1,
  description: 'Deity-favored weapon deals damage scaling like monk unarmed. At 4+, enchant as swift action.',
  damageDice: (level) => {
    if (level >= 20) return '2d8';
    if (level >= 15) return '2d6';
    if (level >= 10) return '1d10';
    if (level >= 5) return '1d8';
    return '1d6'; // base
  },
  enchantRoundsPerDay: (level) => level, // Can be split across multiple uses
  enchantBonus: (level) => {
    if (level >= 16) return 4;
    if (level >= 12) return 3;
    if (level >= 8) return 2;
    if (level >= 4) return 1;
    return 0;
  },
};

export const WARPRIEST_BLESSINGS = {
  name: 'Blessings',
  classes: ['Warpriest'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 1,
  description: 'Choose 2 blessings from deity domains. Minor at 1, major at 10.',
  usesPerDay: (level, wisMod) => 3 + Math.floor(level / 2),
  blessingCount: 2,
};

export const WARPRIEST_CHANNEL_ENERGY = {
  name: 'Channel Energy (Warpriest)',
  classes: ['Warpriest'],
  type: 'area_heal_or_damage',
  action: 'standard',
  minLevel: 4,
  description: 'Channel positive/negative energy in 30-ft burst. Uses fervor uses.',
  scaling: {
    dicePerLevel: (level) => Math.max(1, Math.ceil((level - 3) / 2)), // Scales as cleric level - 3
    sides: 6,
  },
  range: 30,
  saveDC: (level, wisMod) => 10 + Math.floor(level / 2) + wisMod,
  saveType: 'Will',
  costFervor: 2,
};

export const WARPRIEST_SACRED_ARMOR = {
  name: 'Sacred Armor',
  classes: ['Warpriest'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 7,
  description: 'Enhance worn armor as swift action for level rounds/day.',
  enchantRoundsPerDay: (level) => level,
  enchantBonus: (level) => {
    if (level >= 18) return 4;
    if (level >= 14) return 3;
    if (level >= 10) return 2;
    if (level >= 7) return 1;
    return 0;
  },
};

export const WARPRIEST_ASPECT_OF_WAR = {
  name: 'Aspect of War',
  classes: ['Warpriest'],
  type: 'self_buff',
  action: 'swift',
  minLevel: 20,
  description: 'Gain DR 10/-, +4 insight to AC, attack, and saves for 1 minute once per day.',
  usesPerDay: () => 1,
  duration: 10, // rounds
  modifiers: { ac: 4, attack: 4, saves: { all: 4 } },
  dr: { amount: 10, type: '/-' },
};

export const WARPRIEST_FERVOR = {
  name: 'Fervor',
  classes: ['Warpriest'],
  type: 'targeted_heal_or_damage',
  action: 'swift',
  minLevel: 2,
  description: 'Touch healing (or swift self-buff with spell) 1d6/3 levels.',
  scaling: {
    dicePerLevel: (level) => Math.max(1, Math.floor(level / 3)),
    sides: 6,
  },
  usesPerDay: (level, wisMod) => Math.floor(level / 2) + wisMod,
};

export const WARPRIEST_AURA = {
  name: 'Aura (Warpriest)',
  classes: ['Warpriest'],
  type: 'passive',
  minLevel: 1,
  description: 'Emits an aura of alignment matching deity (as cleric).',
  effect: 'alignment_aura',
};

export const WARPRIEST_FOCUS_WEAPON = {
  name: 'Focus Weapon',
  classes: ['Warpriest'],
  type: 'passive',
  minLevel: 1,
  description: 'Gain Weapon Focus as a bonus feat with deity\'s favored weapon. This weapon benefits from Sacred Weapon.',
  effect: 'weapon_focus_deity_weapon',
};


// ═══════════════════════════════════════════════════════
//  U P D A T E D   M A S T E R   R E G I S T R Y
// ═══════════════════════════════════════════════════════

// Add APG + ACG to CLASS_ABILITIES registry
// (Appended after CRB entries)

// ── Alchemist ──
CLASS_ABILITIES['Alchemy'] = ALCHEMIST_ALCHEMY;
CLASS_ABILITIES['Bomb'] = ALCHEMIST_BOMB;
CLASS_ABILITIES['Mutagen'] = ALCHEMIST_MUTAGEN;
CLASS_ABILITIES['Brew Potion'] = ALCHEMIST_BREW_POTION;
CLASS_ABILITIES['Throw Anything'] = ALCHEMIST_THROW_ANYTHING;
CLASS_ABILITIES['Poison Resistance (Alchemist)'] = ALCHEMIST_POISON_RESISTANCE;
CLASS_ABILITIES['Poison Use'] = ALCHEMIST_POISON_USE;
CLASS_ABILITIES['Poison Immunity (Alchemist)'] = ALCHEMIST_POISON_IMMUNITY;
CLASS_ABILITIES['Discovery'] = ALCHEMIST_DISCOVERY;
CLASS_ABILITIES['Swift Alchemy'] = ALCHEMIST_SWIFT_ALCHEMY;
CLASS_ABILITIES['Swift Poisoning'] = ALCHEMIST_SWIFT_POISONING;
CLASS_ABILITIES['Persistent Mutagen'] = ALCHEMIST_PERSISTENT_MUTAGEN;
CLASS_ABILITIES['Instant Alchemy'] = ALCHEMIST_INSTANT_ALCHEMY;
CLASS_ABILITIES['Grand Discovery'] = ALCHEMIST_GRAND_DISCOVERY;

// ── Cavalier ──
CLASS_ABILITIES['Challenge'] = CAVALIER_CHALLENGE;
CLASS_ABILITIES['Order'] = CAVALIER_ORDER;
CLASS_ABILITIES['Mounted Bond'] = CAVALIER_MOUNTED_BOND;
CLASS_ABILITIES['Tactician'] = CAVALIER_TACTICIAN;
CLASS_ABILITIES["Cavalier's Charge"] = CAVALIER_CHARGE;
CLASS_ABILITIES['Banner'] = CAVALIER_BANNER;
CLASS_ABILITIES['Expert Trainer'] = CAVALIER_EXPERT_TRAINER;
CLASS_ABILITIES['Greater Tactician'] = CAVALIER_GREATER_TACTICIAN;
CLASS_ABILITIES['Mighty Charge'] = CAVALIER_MIGHTY_CHARGE;
CLASS_ABILITIES['Demanding Challenge'] = CAVALIER_DEMANDING_CHALLENGE;
CLASS_ABILITIES['Greater Banner'] = CAVALIER_GREATER_BANNER;
CLASS_ABILITIES['Master Tactician'] = CAVALIER_MASTER_TACTICIAN;
CLASS_ABILITIES['Supreme Charge'] = CAVALIER_SUPREME_CHARGE;
CLASS_ABILITIES['Bonus Feat (Cavalier)'] = CAVALIER_BONUS_FEAT;

// ── Inquisitor ──
CLASS_ABILITIES['Orisons (Inquisitor)'] = INQUISITOR_ORISONS;
CLASS_ABILITIES['Inquisitor Domain'] = INQUISITOR_DOMAIN;
CLASS_ABILITIES['Monster Lore'] = INQUISITOR_MONSTER_LORE;
CLASS_ABILITIES['Stern Gaze'] = INQUISITOR_STERN_GAZE;
CLASS_ABILITIES['Cunning Initiative'] = INQUISITOR_CUNNING_INITIATIVE;
CLASS_ABILITIES['Detect Alignment'] = INQUISITOR_DETECT_ALIGNMENT;
CLASS_ABILITIES['Track (Inquisitor)'] = INQUISITOR_TRACK;
CLASS_ABILITIES['Solo Tactics'] = INQUISITOR_SOLO_TACTICS;
CLASS_ABILITIES['Teamwork Feat (Inquisitor)'] = INQUISITOR_TEAMWORK_FEAT;
CLASS_ABILITIES['Judgment'] = INQUISITOR_JUDGMENT;
CLASS_ABILITIES['Bane'] = INQUISITOR_BANE;
CLASS_ABILITIES['Discern Lies'] = INQUISITOR_DISCERN_LIES;
CLASS_ABILITIES['Second Judgment'] = INQUISITOR_SECOND_JUDGMENT;
CLASS_ABILITIES['Stalwart'] = INQUISITOR_STALWART;
CLASS_ABILITIES['Greater Bane'] = INQUISITOR_GREATER_BANE;
CLASS_ABILITIES['Exploit Weakness'] = INQUISITOR_EXPLOIT_WEAKNESS;
CLASS_ABILITIES['Third Judgment'] = INQUISITOR_THIRD_JUDGMENT;
CLASS_ABILITIES['Slayer (Inquisitor)'] = INQUISITOR_SLAYER;
CLASS_ABILITIES['True Judgment'] = INQUISITOR_TRUE_JUDGMENT;

// ── Oracle ──
CLASS_ABILITIES['Orisons (Oracle)'] = ORACLE_ORISONS;
CLASS_ABILITIES['Oracle Curse'] = ORACLE_CURSE;
CLASS_ABILITIES['Oracle Mystery'] = ORACLE_MYSTERY;
CLASS_ABILITIES['Revelation'] = ORACLE_REVELATION;
CLASS_ABILITIES['Final Revelation'] = ORACLE_FINAL_REVELATION;

// ── Summoner ──
CLASS_ABILITIES['Eidolon'] = SUMMONER_EIDOLON;
CLASS_ABILITIES['Summoning'] = SUMMONER_SUMMON_MONSTER;
CLASS_ABILITIES['Cantrips (Summoner)'] = SUMMONER_CANTRIPS;
CLASS_ABILITIES['Life Link'] = SUMMONER_LIFE_LINK;
CLASS_ABILITIES['Bond Senses'] = SUMMONER_BOND_SENSES;
CLASS_ABILITIES['Shield Ally'] = SUMMONER_SHIELD_ALLY;
CLASS_ABILITIES["Maker's Call"] = SUMMONER_MAKERS_CALL;
CLASS_ABILITIES['Transposition'] = SUMMONER_TRANSPOSITION;
CLASS_ABILITIES['Aspect'] = SUMMONER_ASPECT;
CLASS_ABILITIES['Greater Shield Ally'] = SUMMONER_GREATER_SHIELD_ALLY;
CLASS_ABILITIES['Life Bond'] = SUMMONER_LIFE_BOND;
CLASS_ABILITIES['Merge Forms'] = SUMMONER_MERGE_FORMS;
CLASS_ABILITIES['Greater Aspect'] = SUMMONER_GREATER_ASPECT;
CLASS_ABILITIES['Twin Eidolon'] = SUMMONER_TWIN_EIDOLON;

// ── Witch ──
CLASS_ABILITIES['Patron'] = WITCH_PATRON;
CLASS_ABILITIES['Cantrips (Witch)'] = WITCH_CANTRIPS;
CLASS_ABILITIES['Familiar'] = WITCH_FAMILIAR;
CLASS_ABILITIES['Hexes'] = WITCH_HEX;
CLASS_ABILITIES['Major Hex'] = WITCH_MAJOR_HEX;
CLASS_ABILITIES['Grand Hex'] = WITCH_GRAND_HEX;

// ── Arcanist ──
CLASS_ABILITIES['Arcane Reservoir'] = ARCANIST_ARCANE_RESERVOIR;
CLASS_ABILITIES['Consume Spells'] = ARCANIST_CONSUME_SPELLS;
CLASS_ABILITIES['Arcane Exploits'] = ARCANIST_ARCANE_EXPLOITS;
CLASS_ABILITIES['Greater Exploits'] = ARCANIST_GREATER_EXPLOITS;
CLASS_ABILITIES['Cantrips (Arcanist)'] = ARCANIST_CANTRIPS;

// ── Bloodrager ──
CLASS_ABILITIES['Bloodrage'] = BLOODRAGER_BLOODRAGE;
CLASS_ABILITIES['Fast Movement (Bloodrager)'] = BLOODRAGER_FAST_MOVEMENT;
CLASS_ABILITIES['Bloodrager Bloodline'] = BLOODRAGER_BLOODLINE;
CLASS_ABILITIES['Eschew Materials (Bloodrager)'] = BLOODRAGER_ESCHEW_MATERIALS;
CLASS_ABILITIES['Blood Sanctuary'] = BLOODRAGER_BLOOD_SANCTUARY;
CLASS_ABILITIES['Blood Casting'] = BLOODRAGER_BLOOD_CASTING;
CLASS_ABILITIES['Uncanny Dodge (Bloodrager)'] = BLOODRAGER_UNCANNY_DODGE;
CLASS_ABILITIES['Improved Uncanny Dodge (Bloodrager)'] = BLOODRAGER_IMPROVED_UNCANNY_DODGE;
CLASS_ABILITIES['Damage Reduction (Bloodrager)'] = BLOODRAGER_DR;
CLASS_ABILITIES['Greater Bloodrage'] = BLOODRAGER_GREATER_BLOODRAGE;
CLASS_ABILITIES['Indomitable Will (Bloodrager)'] = BLOODRAGER_INDOMITABLE_WILL;
CLASS_ABILITIES['Tireless Bloodrage'] = BLOODRAGER_TIRELESS_BLOODRAGE;
CLASS_ABILITIES['Mighty Bloodrage'] = BLOODRAGER_MIGHTY_BLOODRAGE;
CLASS_ABILITIES['Bloodline Feat (Bloodrager)'] = BLOODRAGER_BLOODLINE_FEAT;

// ── Brawler ──
CLASS_ABILITIES['Martial Flexibility'] = BRAWLER_MARTIAL_FLEXIBILITY;
CLASS_ABILITIES['Bonus Feat (Brawler)'] = BRAWLER_BONUS_FEAT;
CLASS_ABILITIES['Unarmed Strike (Brawler)'] = BRAWLER_UNARMED_STRIKE;
CLASS_ABILITIES["Brawler's Flurry"] = BRAWLER_FLURRY;
CLASS_ABILITIES['Maneuver Training (Brawler)'] = BRAWLER_MANEUVER_TRAINING;
CLASS_ABILITIES['AC Bonus (Brawler)'] = BRAWLER_AC_BONUS;
CLASS_ABILITIES['Knockout'] = BRAWLER_KNOCKOUT;
CLASS_ABILITIES["Brawler's Strike"] = BRAWLER_BRAWLERS_STRIKE;
CLASS_ABILITIES['Close Weapon Mastery'] = BRAWLER_CLOSE_WEAPON_MASTERY;
CLASS_ABILITIES["Brawler's Cunning"] = BRAWLER_CUNNING;
CLASS_ABILITIES['Awesome Blow'] = BRAWLER_AWESOME_BLOW;
CLASS_ABILITIES['Improved Awesome Blow'] = BRAWLER_IMPROVED_AWESOME_BLOW;

// ── Hunter ──
CLASS_ABILITIES['Orisons (Hunter)'] = HUNTER_ORISONS;
CLASS_ABILITIES['Animal Companion (Hunter)'] = HUNTER_ANIMAL_COMPANION;
CLASS_ABILITIES['Animal Focus'] = HUNTER_ANIMAL_FOCUS;
CLASS_ABILITIES['Wild Empathy (Hunter)'] = HUNTER_WILD_EMPATHY;
CLASS_ABILITIES['Track (Hunter)'] = HUNTER_TRACK;
CLASS_ABILITIES['Precise Companion'] = HUNTER_PRECISE_COMPANION;
CLASS_ABILITIES['Hunter Tactics'] = HUNTER_HUNTER_TACTICS;
CLASS_ABILITIES['Teamwork Feat (Hunter)'] = HUNTER_TEAMWORK_FEAT;
CLASS_ABILITIES['Woodland Stride (Hunter)'] = HUNTER_WOODLAND_STRIDE;
CLASS_ABILITIES['Raise Animal Companion'] = HUNTER_RAISE_ANIMAL_COMPANION;
CLASS_ABILITIES['Second Animal Focus'] = HUNTER_SECOND_ANIMAL_FOCUS;
CLASS_ABILITIES['Swift Tracker (Hunter)'] = HUNTER_SWIFT_TRACKER;
CLASS_ABILITIES['Master Hunter (Hunter)'] = HUNTER_MASTER_HUNTER_CAPSTONE;
CLASS_ABILITIES['Nature Training'] = HUNTER_NATURE_TRAINING;
CLASS_ABILITIES['Bonus Tricks'] = HUNTER_BONUS_TRICKS;
CLASS_ABILITIES['Improved Empathic Link'] = HUNTER_IMPROVED_EMPATHIC_LINK;
CLASS_ABILITIES['One with the Wild'] = HUNTER_ONE_WITH_WILD;

// ── Investigator ──
CLASS_ABILITIES['Inspiration'] = INVESTIGATOR_INSPIRATION;
CLASS_ABILITIES['Trapfinding (Investigator)'] = INVESTIGATOR_TRAPFINDING;
CLASS_ABILITIES['Poison Lore'] = INVESTIGATOR_POISON_LORE;
CLASS_ABILITIES['Poison Resistance'] = INVESTIGATOR_POISON_RESISTANCE;
CLASS_ABILITIES['Keen Recollection (Investigator)'] = INVESTIGATOR_KEEN_RECOLLECTION;
CLASS_ABILITIES['Trap Sense (Investigator)'] = INVESTIGATOR_TRAP_SENSE;
CLASS_ABILITIES['Studied Combat'] = INVESTIGATOR_STUDIED_COMBAT;
CLASS_ABILITIES['Studied Strike'] = INVESTIGATOR_STUDIED_STRIKE;
CLASS_ABILITIES['Investigator Talents'] = INVESTIGATOR_TALENT;
CLASS_ABILITIES['Swift Alchemy (Investigator)'] = INVESTIGATOR_SWIFT_ALCHEMY;
CLASS_ABILITIES['Poison Immunity (Investigator)'] = INVESTIGATOR_POISON_IMMUNITY;
CLASS_ABILITIES['True Inspiration'] = INVESTIGATOR_TRUE_INSPIRATION;

// ── Shaman ──
CLASS_ABILITIES['Spirit'] = SHAMAN_SPIRIT;
CLASS_ABILITIES['Spirit Animal Companion'] = SHAMAN_SPIRIT_ANIMAL;
CLASS_ABILITIES['Orisons (Shaman)'] = SHAMAN_ORISONS;
CLASS_ABILITIES['Shaman Hex'] = SHAMAN_HEX;
CLASS_ABILITIES['Wandering Spirit'] = SHAMAN_WANDERING_SPIRIT;
CLASS_ABILITIES['Wandering Hex'] = SHAMAN_WANDERING_HEX;
CLASS_ABILITIES['Spirit Magic'] = SHAMAN_SPIRIT_MAGIC;
CLASS_ABILITIES['Greater Wandering Spirit'] = SHAMAN_GREATER_WANDERING_SPIRIT;
CLASS_ABILITIES['Manifestation'] = SHAMAN_MANIFESTATION;

// ── Skald ──
CLASS_ABILITIES['Raging Song'] = SKALD_RAGING_SONG;
CLASS_ABILITIES['Bardic Knowledge (Skald)'] = SKALD_BARDIC_KNOWLEDGE;
CLASS_ABILITIES['Scribe Scroll (Skald)'] = SKALD_SCRIBE_SCROLL;
CLASS_ABILITIES['Cantrips (Skald)'] = SKALD_CANTRIPS;
CLASS_ABILITIES['Versatile Performance (Skald)'] = SKALD_VERSATILE_PERFORMANCE;
CLASS_ABILITIES['Well-Versed (Skald)'] = SKALD_WELL_VERSED;
CLASS_ABILITIES['Rage Power (Skald)'] = SKALD_RAGE_POWER;
CLASS_ABILITIES['Lore Master (Skald)'] = SKALD_LORE_MASTER;
CLASS_ABILITIES['Spell Kenning'] = SKALD_SPELL_KENNING;
CLASS_ABILITIES['Song of Marching'] = SKALD_SONG_OF_MARCHING;
CLASS_ABILITIES['Song of Strength'] = SKALD_SONG_OF_STRENGTH;
CLASS_ABILITIES['Dirge of Doom'] = SKALD_DIRGE_OF_DOOM;
CLASS_ABILITIES['Song of the Fallen'] = SKALD_SONG_OF_THE_FALLEN;
CLASS_ABILITIES['Damage Reduction (Skald)'] = SKALD_DR;
CLASS_ABILITIES['Master Skald'] = SKALD_MASTER_SKALD;
CLASS_ABILITIES['Uncanny Dodge (Skald)'] = SKALD_UNCANNY_DODGE;
CLASS_ABILITIES['Improved Uncanny Dodge (Skald)'] = SKALD_IMPROVED_UNCANNY_DODGE;

// ── Slayer ──
CLASS_ABILITIES['Track (Slayer)'] = SLAYER_TRACK;
CLASS_ABILITIES['Studied Target'] = SLAYER_STUDIED_TARGET;
CLASS_ABILITIES['Sneak Attack (Slayer)'] = SLAYER_SNEAK_ATTACK;
CLASS_ABILITIES['Slayer Talent'] = SLAYER_TALENT;
CLASS_ABILITIES['Stalker'] = SLAYER_STALKER;
CLASS_ABILITIES['Quarry (Slayer)'] = SLAYER_QUARRY;
CLASS_ABILITIES['Improved Quarry (Slayer)'] = SLAYER_IMPROVED_QUARRY;
CLASS_ABILITIES['Master Slayer'] = SLAYER_MASTER_SLAYER;
CLASS_ABILITIES['Advanced Slayer Talent'] = SLAYER_ADVANCED_TALENT;

// ── Swashbuckler ──
CLASS_ABILITIES['Swashbuckler Finesse'] = SWASHBUCKLER_FINESSE;
CLASS_ABILITIES['Panache'] = SWASHBUCKLER_PANACHE;
CLASS_ABILITIES['Deeds'] = SWASHBUCKLER_DEEDS;
CLASS_ABILITIES['Charmed Life'] = SWASHBUCKLER_CHARMED_LIFE;
CLASS_ABILITIES['Nimble'] = SWASHBUCKLER_NIMBLE;
CLASS_ABILITIES['Bonus Feat (Swashbuckler)'] = SWASHBUCKLER_BONUS_FEAT;
CLASS_ABILITIES['Weapon Training (Swashbuckler)'] = SWASHBUCKLER_WEAPON_TRAINING;
CLASS_ABILITIES['Swashbuckler Weapon Mastery'] = SWASHBUCKLER_WEAPON_MASTERY;

// ── Warpriest ──
CLASS_ABILITIES['Bonus Feat (Warpriest)'] = WARPRIEST_BONUS_FEAT;
CLASS_ABILITIES['Orisons (Warpriest)'] = WARPRIEST_ORISONS;
CLASS_ABILITIES['Sacred Weapon'] = WARPRIEST_SACRED_WEAPON;
CLASS_ABILITIES['Blessings'] = WARPRIEST_BLESSINGS;
CLASS_ABILITIES['Fervor'] = WARPRIEST_FERVOR;
CLASS_ABILITIES['Channel Energy (Warpriest)'] = WARPRIEST_CHANNEL_ENERGY;
CLASS_ABILITIES['Sacred Armor'] = WARPRIEST_SACRED_ARMOR;
CLASS_ABILITIES['Aspect of War'] = WARPRIEST_ASPECT_OF_WAR;
CLASS_ABILITIES['Aura (Warpriest)'] = WARPRIEST_AURA;
CLASS_ABILITIES['Focus Weapon'] = WARPRIEST_FOCUS_WEAPON;


// ─────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────

/**
 * Get all class abilities a character qualifies for based on class + level.
 */
export function getClassAbilitiesForLevel(className, level) {
  const abilities = [];
  for (const [name, ability] of Object.entries(CLASS_ABILITIES)) {
    if (!ability.classes || !ability.classes.includes(className)) continue;
    const minLvl = typeof ability.minLevel === 'object'
      ? (ability.minLevel[className] || 1)
      : (ability.minLevel || 1);
    if (level >= minLvl) abilities.push(name);
  }
  return abilities;
}

/**
 * Look up a specific ability by name.
 */
export function getClassAbility(name) {
  return CLASS_ABILITIES[name] || null;
}

/**
 * Check if a character has a specific class ability.
 */
export function hasClassAbility(className, level, abilityName) {
  const ability = CLASS_ABILITIES[abilityName];
  if (!ability || !ability.classes?.includes(className)) return false;
  const minLvl = typeof ability.minLevel === 'object'
    ? (ability.minLevel[className] || 1)
    : (ability.minLevel || 1);
  return level >= minLvl;
}
