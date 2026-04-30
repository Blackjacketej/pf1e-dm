/**
 * PF1e Rules Engine
 *
 * Central rules computation layer that enforces Pathfinder 1st Edition mechanics.
 * Computes saves, DCs, proficiency penalties, condition modifiers, and action economy.
 * Used by CombatTab, CharacterSheet, and dmEngine to ensure consistent rules enforcement.
 */

import { mod } from './dice';
import classesData from '../data/classes.json';
import { aggregateActiveEffectModifiers } from './activeEffectsTracker';
import { aggregateConditionModifiers } from './conditionTracker';
import { getPassiveClassModifiers } from './classAbilityResolver';
// Phase 7.3: fold familiar master-bonus (cat Stealth, rat Fort, toad HP,
// etc.) into the central modifier aggregator. This creates a circular
// import with familiarEngine.js — familiarEngine imports getBaseSave from
// here — but the cycle is safe because both symbols are consumed only
// inside function bodies, never at module-load time.
import { aggregateFamiliarModifiers } from './familiarEngine';

const classesMap = {};
classesData.forEach(c => { classesMap[c.name] = c; });

// ─────────────────────────────────────────────────────
// MODIFIER MERGING — Conditions + Active Spell Effects
// ─────────────────────────────────────────────────────

/**
 * Merge condition modifiers and active spell effect modifiers into one object.
 * Both systems produce the same shape; this combines them following PF1e stacking:
 *   - Typed bonuses (armor, shield, natural armor, deflection, enhancement ability): take highest
 *   - Untyped/dodge/morale bonuses: stack
 *   - Penalties: always stack
 *   - Boolean flags: any-true wins
 *
 * @param {object} condMods — from aggregateConditionModifiers()
 * @param {object} effectMods — from aggregateActiveEffectModifiers()
 * @returns {object} Merged modifier object
 */
export function mergeAllModifiers(condMods = {}, effectMods = {}) {
  return {
    // Untyped / stacking
    attack: (condMods.attack || 0) + (effectMods.attack || 0),
    damage: (condMods.damage || 0) + (effectMods.damage || 0),
    ac: (condMods.ac || 0) + (effectMods.ac || 0),
    initiative: (condMods.initiative || 0) + (effectMods.initiative || 0),
    cmb: (condMods.cmb || 0) + (effectMods.cmb || 0),
    cmd: (condMods.cmd || 0) + (effectMods.cmd || 0),
    concentration: (condMods.concentration || 0) + (effectMods.concentration || 0),

    // Typed bonuses — take highest across both sources (PF1e: same type doesn't stack)
    armorBonus: Math.max(condMods.armorBonus || 0, effectMods.armorBonus || 0),
    shieldBonus: Math.max(condMods.shieldBonus || 0, effectMods.shieldBonus || 0),
    naturalArmor: Math.max(condMods.naturalArmor || 0, effectMods.naturalArmor || 0),
    deflectionBonus: Math.max(condMods.deflectionBonus || 0, effectMods.deflectionBonus || 0),

    // Saves — stack (different sources/types)
    saves: {
      all: (condMods.saves?.all || 0) + (effectMods.saves?.all || 0),
      Fort: (condMods.saves?.Fort || 0) + (effectMods.saves?.Fort || 0),
      Ref: (condMods.saves?.Ref || 0) + (effectMods.saves?.Ref || 0),
      Will: (condMods.saves?.Will || 0) + (effectMods.saves?.Will || 0),
      fear: (condMods.saves?.fear || 0) + (effectMods.saves?.fear || 0),
    },

    // Skills — stack
    skills: mergeSkills(condMods.skills, effectMods.skills),

    // Ability bonuses — enhancement type, take highest across sources
    strBonus: Math.max(condMods.strBonus || 0, effectMods.strBonus || 0),
    dexBonus: Math.max(condMods.dexBonus || 0, effectMods.dexBonus || 0),
    conBonus: Math.max(condMods.conBonus || 0, effectMods.conBonus || 0),
    intBonus: Math.max(condMods.intBonus || 0, effectMods.intBonus || 0),
    wisBonus: Math.max(condMods.wisBonus || 0, effectMods.wisBonus || 0),
    chaBonus: Math.max(condMods.chaBonus || 0, effectMods.chaBonus || 0),

    // Penalties always stack
    strPenalty: (condMods.strPenalty || 0) + (effectMods.strPenalty || 0),
    dexPenalty: (condMods.dexPenalty || 0) + (effectMods.dexPenalty || 0),

    // Speed
    speedBonus: (condMods.speedBonus || 0) + (effectMods.speedBonus || 0),
    speed: Math.min(condMods.speed ?? 1, effectMods.speed ?? 1),
    flySpeed: Math.max(condMods.flySpeed || 0, effectMods.flySpeed || 0),

    // Miss chance — take worst (highest)
    missChance: Math.max(condMods.missChance || 0, effectMods.missChance || 0),

    // DR — last-wins (simplification)
    dr: effectMods.dr || condMods.dr || null,

    // Temp HP
    tempHP: (condMods.tempHP || 0) + (effectMods.tempHP || 0),

    // Boolean flags — any-true
    cannotAct: !!(condMods.cannotAct || effectMods.cannotAct),
    cannotAttack: !!(condMods.cannotAttack || effectMods.cannotAttack),
    cannotCast: !!(condMods.cannotCast || effectMods.cannotCast),
    cannotMove: !!(condMods.cannotMove || effectMods.cannotMove),
    cannotCharge: !!(condMods.cannotCharge || effectMods.cannotCharge),
    cannotRun: !!(condMods.cannotRun || effectMods.cannotRun),
    singleAction: !!(condMods.singleAction || effectMods.singleAction),
    moveOnly: !!(condMods.moveOnly || effectMods.moveOnly),
    loseDexToAC: !!(condMods.loseDexToAC || effectMods.loseDexToAC),
    mustFlee: !!(condMods.mustFlee || effectMods.mustFlee),
    extraAttack: !!(condMods.extraAttack || effectMods.extraAttack),
    smiteActive: !!(condMods.smiteActive || effectMods.smiteActive),
  };
}

function mergeSkills(a = {}, b = {}) {
  const result = { all: (a.all || 0) + (b.all || 0) };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'all') continue;
    result[k] = (a[k] || 0) + (b[k] || 0);
  }
  return result;
}

/**
 * Convenience: compute all modifiers for a character from their conditions + active effects.
 * Call this once per character per computation, then pass the result to all rulesEngine functions.
 *
 * @param {object} character — must have .activeConditions[] and .activeEffects[]
 * @param {object} [worldState] — optional worldState for 7.5 range-gating
 *                                the familiar bonus. When omitted, the
 *                                familiar is assumed to be with its master
 *                                (backward-compatible with 7.3 callers).
 * @returns {object} Merged modifiers ready for all rulesEngine functions
 */
export function getCharacterModifiers(character, worldState) {
  const condMods = aggregateConditionModifiers(character.activeConditions || character.conditions || []);
  const effectMods = aggregateActiveEffectModifiers(character.activeEffects || []);
  const merged = mergeAllModifiers(condMods, effectMods);

  // Phase 7.3 — fold in familiar master-granted bonuses. Skill and save
  // bonuses stack with the character's other modifiers and flow through
  // computeSkillCheck / computeSave via the standard skills[name] and
  // saves[Fort|Ref|Will] maps. HP bonus is stored separately because
  // tempHP gets consumed by damage first — callers should read
  // getEffectiveMaxHP() instead of character.maxHP for display.
  //
  // Phase 7.5 — the optional worldState argument activates the 1-mile
  // range gate (CRB p. 82) and the lost/ritual status guard. Call sites
  // that don't yet thread worldState through keep their 7.3 behavior.
  const familiarMods = aggregateFamiliarModifiers(character, { worldState });
  for (const [skillName, value] of Object.entries(familiarMods.skills || {})) {
    merged.skills[skillName] = (merged.skills[skillName] || 0) + value;
  }
  for (const [saveType, value] of Object.entries(familiarMods.saves || {})) {
    merged.saves[saveType] = (merged.saves[saveType] || 0) + value;
  }
  merged.familiarHPBonus = familiarMods.hpBonus || 0;
  merged.familiarApplied = familiarMods.applied || [];

  return merged;
}


// ─────────────────────────────────────────────────────
// RACIAL SPELL-LIKE ABILITY DC
// ─────────────────────────────────────────────────────

/**
 * Compute the DC for a racial spell-like ability at cast time.
 * PF1e CRB: SLA DC = 10 + spell level equivalent + ability modifier (usually CHA).
 * This reads the character's CURRENT ability score so DCs update with equipment/buffs.
 *
 * @param {object} character - Full character with abilities
 * @param {object} sla - SLA entry from character.racialSpellLikeAbilities
 * @returns {number|null} DC, or null if the SLA has no save
 */
export function computeSLADC(character, sla) {
  if (!sla || sla.save === 'none') return null;
  const abilityKey = sla.dcAbility || 'CHA';
  const abilityScore = character.abilities?.[abilityKey] || 10;
  const abilityMod = mod(abilityScore);
  // Gnome Magic +1 DC for illusion SLAs
  let racialDCBonus = 0;
  if (sla.school === 'illusion' && character.racialCombatBonuses?.gnomeMagic) {
    racialDCBonus = character.racialCombatBonuses.gnomeMagic.illusionDCBonus || 0;
  }
  return 10 + (sla.spellLevel || 0) + abilityMod + racialDCBonus;
}


// ─────────────────────────────────────────────────────
// SAVING THROWS
// ─────────────────────────────────────────────────────

/**
 * Compute base save bonus for a class at a given level.
 * PF1e: Good save = +2 + level/2, Poor save = level/3
 */
export function getBaseSave(className, level, saveType) {
  const cls = classesMap[className];
  if (!cls) return Math.floor(level / 3);
  // Support both formats: goodSaves array (preferred) and old saves object (fallback)
  let isGood = false;
  if (cls.goodSaves && cls.goodSaves.length > 0) {
    isGood = cls.goodSaves.includes(saveType);
  } else if (cls.saves) {
    const key = saveType.toLowerCase().slice(0, 4); // 'Fort' -> 'fort', 'Ref' -> 'ref', 'Will' -> 'will'
    isGood = cls.saves[key] === 'good';
  }
  if (isGood) return 2 + Math.floor(level / 2);
  return Math.floor(level / 3);
}

/**
 * Get the ability modifier that applies to a saving throw.
 * Fort = CON, Ref = DEX, Will = WIS
 */
export function getSaveAbility(saveType) {
  switch (saveType) {
    case 'Fort': return 'CON';
    case 'Ref': return 'DEX';
    case 'Will': return 'WIS';
    default: return 'CON';
  }
}

/**
 * Compute a saving throw modifier.
 * @param {object} character - Full character object
 * @param {string} saveType - 'Fort', 'Ref', or 'Will'
 * @param {object} [conditionMods] - Active condition/effect modifiers
 * @param {object} [saveContext] - Context about what triggered the save (PF1e CRB conditional bonuses)
 *   saveContext.isSpell    {boolean} — true if the save is against a spell/SLA
 *   saveContext.school     {string}  — spell school (e.g., 'enchantment', 'illusion')
 *   saveContext.descriptors {string[]} — spell/effect descriptors (e.g., ['fear', 'mind-affecting'])
 *   saveContext.isPoison   {boolean} — true if the save is against poison
 */
export function computeSave(character, saveType, conditionMods = {}, saveContext = {}) {
  const base = getBaseSave(character.class, character.level || 1, saveType);
  const abilityKey = getSaveAbility(saveType);
  const abilityMod = mod(character.abilities?.[abilityKey] || 10);
  const misc = character.saveBonuses?.[saveType] || 0;

  // Feat bonuses
  let featBonus = 0;
  const feats = character.feats || [];
  if (saveType === 'Fort' && feats.includes('Great Fortitude')) featBonus += 2;
  if (saveType === 'Ref' && feats.includes('Lightning Reflexes')) featBonus += 2;
  if (saveType === 'Will' && feats.includes('Iron Will')) featBonus += 2;

  // Condition + active effect modifiers (e.g., shaken = -2, Shield of Faith = save bonus)
  const condSaveMod = (conditionMods.saves?.[saveType] || 0) + (conditionMods.saves?.all || 0);

  // Ability bonuses from spells/effects (e.g., Bear's Endurance +4 CON → +2 Fort)
  const abilityBonusMap = { Fort: 'con', Ref: 'dex', Will: 'wis' };
  const abKey = abilityBonusMap[saveType];
  const spellAbilityBonus = abKey ? Math.floor((conditionMods[`${abKey}Bonus`] || 0) / 2) : 0;
  const spellAbilityPenalty = abKey ? Math.floor((conditionMods[`${abKey}Penalty`] || 0) / 2) : 0;

  // Cloak of resistance and similar item bonuses
  const resistanceBonus = character.resistanceBonus || 0;

  // Racial save bonuses — unconditional (e.g., Halfling Luck +1 all)
  const racialSaveBonus = character.racialSaveBonuses?.[saveType] || 0;

  // Racial conditional save bonuses (Hardy, Fearless, Illusion Resistance, Elven Immunities)
  // Only apply when the saveContext matches the condition's "vs" tags.
  let racialConditionalBonus = 0;
  const conditionalSources = [];
  const conditionals = character.racialConditionalSaves || [];
  for (const cond of conditionals) {
    if (!cond.saves.includes(saveType)) continue;
    // Check if the saveContext matches any of this condition's "vs" tags
    const matched = cond.vs.some(tag => {
      const t = tag.toLowerCase();
      if (t === 'spell' || t === 'spell-like') return !!saveContext.isSpell;
      if (t === 'poison') return !!saveContext.isPoison;
      if (t === 'fear') return (saveContext.descriptors || []).some(d => d.toLowerCase() === 'fear');
      if (t === 'illusion') return (saveContext.school || '').toLowerCase() === 'illusion';
      if (t === 'enchantment') return (saveContext.school || '').toLowerCase() === 'enchantment';
      return false;
    });
    if (matched) {
      racialConditionalBonus += cond.bonus;
      conditionalSources.push(`+${cond.bonus} ${cond.source}`);
    }
  }

  const totalRacial = racialSaveBonus + racialConditionalBonus;

  // Class passive save bonuses (Paladin Divine Grace, Fighter Bravery, Monk Still Mind, etc.)
  let classPassiveBonus = 0;
  try {
    const classPassives = getPassiveClassModifiers(character);
    classPassiveBonus += classPassives.saves?.all || 0;
    classPassiveBonus += classPassives.saves?.[saveType] || 0;
    // Handle conditional class save bonuses via saveContext
    if (saveContext.descriptors?.some(d => d.toLowerCase() === 'fear')) {
      classPassiveBonus += classPassives.saves?.fear || 0;
    }
    if ((saveContext.school || '').toLowerCase() === 'enchantment') {
      classPassiveBonus += classPassives.saves?.enchantment || 0;
    }
    if (saveContext.isPoison) {
      classPassiveBonus += classPassives.saves?.poison || 0;
    }
    if ((saveContext.school || '').toLowerCase() === 'charm' || (saveContext.descriptors || []).some(d => d.toLowerCase() === 'charm')) {
      classPassiveBonus += classPassives.saves?.charm || 0;
    }
  } catch (e) {
    // Safety: if classAbilityResolver has an issue, don't break saves
  }

  const total = base + abilityMod + misc + featBonus + condSaveMod + spellAbilityBonus + spellAbilityPenalty + resistanceBonus + totalRacial + classPassiveBonus;

  const racialLabel = totalRacial ? ` + ${totalRacial} racial${conditionalSources.length ? ` (${conditionalSources.join(', ')})` : ''}` : '';
  const classLabel = classPassiveBonus ? ` + ${classPassiveBonus} class` : '';

  return {
    total,
    base,
    ability: abilityMod,
    abilityKey,
    feat: featBonus,
    misc,
    conditionMod: condSaveMod,
    spellAbilityMod: spellAbilityBonus + spellAbilityPenalty,
    resistance: resistanceBonus,
    racialBonus: totalRacial,
    racialConditionalBonus,
    conditionalSources,
    classPassiveBonus,
    breakdown: `${base} base + ${abilityMod} ${abilityKey}${featBonus ? ` + ${featBonus} feat` : ''}${racialLabel}${classLabel}${misc ? ` + ${misc} misc` : ''}${condSaveMod ? ` + ${condSaveMod} cond` : ''}${spellAbilityBonus ? ` + ${spellAbilityBonus} spell` : ''}`.trim(),
  };
}

/**
 * Make a saving throw roll and determine pass/fail.
 * @param {object} character - Full character
 * @param {string} saveType - 'Fort', 'Ref', or 'Will'
 * @param {number} dc - Difficulty class
 * @param {number} d20Roll - The d20 roll result
 * @param {object} [conditionMods] - Active condition modifiers
 * @param {object} [saveContext] - Context for conditional racial bonuses (see computeSave)
 * @returns {{ passed, total, dc, natural, breakdown }}
 */
export function resolveSave(character, saveType, dc, d20Roll, conditionMods = {}, saveContext = {}) {
  const save = computeSave(character, saveType, conditionMods, saveContext);
  const total = d20Roll + save.total;
  // Natural 1 is always a fail, natural 20 always passes (PF1e optional rule used commonly)
  const passed = d20Roll === 1 ? false : (d20Roll === 20 ? true : total >= dc);

  return {
    passed,
    total,
    dc,
    natural: d20Roll,
    saveBonus: save.total,
    breakdown: `${d20Roll} + ${save.total} = ${total} vs DC ${dc}`,
    details: save,
  };
}


// ─────────────────────────────────────────────────────
// SPELL DCs
// ─────────────────────────────────────────────────────

const CASTING_ABILITY = {
  Wizard: 'INT', Sorcerer: 'CHA', Cleric: 'WIS', Druid: 'WIS',
  Bard: 'CHA', Paladin: 'CHA', Ranger: 'WIS', Witch: 'INT',
  Oracle: 'CHA', Inquisitor: 'WIS', Alchemist: 'INT', Magus: 'INT',
  Summoner: 'CHA', Bloodrager: 'CHA', Warpriest: 'WIS', Adept: 'WIS',
};

/**
 * Compute the DC for a spell cast by a character.
 * DC = 10 + spell level + casting ability modifier + Spell Focus bonus
 */
export function computeSpellDC(character, spellLevel, spellSchool) {
  const castingAbility = CASTING_ABILITY[character.class] || 'INT';
  const abilityMod = mod(character.abilities?.[castingAbility] || 10);

  let spellFocusBonus = 0;
  const feats = character.feats || [];
  // Check for Spell Focus in the spell's school
  if (spellSchool && feats.some(f =>
    f.toLowerCase().includes('spell focus') &&
    f.toLowerCase().includes(spellSchool.toLowerCase())
  )) {
    spellFocusBonus += 1;
    // Greater Spell Focus
    if (feats.some(f =>
      f.toLowerCase().includes('greater spell focus') &&
      f.toLowerCase().includes(spellSchool.toLowerCase())
    )) {
      spellFocusBonus += 1;
    }
  }

  return {
    dc: 10 + spellLevel + abilityMod + spellFocusBonus,
    base: 10,
    spellLevel,
    abilityMod,
    castingAbility,
    spellFocusBonus,
  };
}

/**
 * Compute caster level for a character.
 * Full casters = class level, partial casters (Paladin, Ranger) = class level - 3
 */
export function computeCasterLevel(character) {
  const cls = character.class;
  const level = character.level || 1;
  const partialCasters = ['Paladin', 'Ranger', 'Bloodrager'];
  if (partialCasters.includes(cls)) return Math.max(0, level - 3);
  if (CASTING_ABILITY[cls]) return level;
  return 0;
}


// ─────────────────────────────────────────────────────
// PROFICIENCY
// ─────────────────────────────────────────────────────

/**
 * Weapon proficiency categories in PF1e.
 */
const SIMPLE_WEAPONS = [
  'Dagger', 'Gauntlet', 'Unarmed Strike', 'Light Mace', 'Sickle', 'Club',
  'Heavy Mace', 'Morningstar', 'Shortspear', 'Longspear', 'Quarterstaff',
  'Spear', 'Heavy Crossbow', 'Light Crossbow', 'Dart', 'Javelin', 'Sling',
];

const MARTIAL_WEAPONS = [
  'Handaxe', 'Kukri', 'Light Hammer', 'Light Pick', 'Sap', 'Short Sword',
  'Starknife', 'Throwing Axe', 'Battleaxe', 'Flail', 'Heavy Flail',
  'Longsword', 'Heavy Pick', 'Rapier', 'Scimitar', 'Trident', 'Warhammer',
  'Falchion', 'Glaive', 'Greataxe', 'Greatclub', 'Greatsword', 'Guisarme',
  'Halberd', 'Lance', 'Ranseur', 'Scythe', 'Composite Longbow', 'Composite Shortbow',
  'Longbow', 'Shortbow',
];

/**
 * Armor proficiency levels.
 */
const ARMOR_PROFICIENCY = {
  light: ['Padded', 'Leather', 'Studded Leather', 'Chain Shirt'],
  medium: ['Hide', 'Scale Mail', 'Chainmail', 'Breastplate'],
  heavy: ['Splint Mail', 'Banded Mail', 'Half-Plate', 'Full Plate'],
};

const SHIELD_NAMES = ['Buckler', 'Light Shield (Wood)', 'Light Shield (Steel)', 'Heavy Shield (Wood)', 'Heavy Shield (Steel)', 'Tower Shield'];

/**
 * Check if a character is proficient with a given weapon.
 * Returns { proficient: boolean, penalty: number, reason: string }
 */
export function checkWeaponProficiency(character, weaponName) {
  const cls = classesMap[character.class];
  if (!cls?.proficiencies?.weapons) return { proficient: true, penalty: 0, reason: '' };

  const profs = cls.proficiencies.weapons.map(p => p.toLowerCase());
  const wName = (weaponName || '').toLowerCase();

  // Racial weapon familiarity (e.g., Dwarves with dwarven waraxe, Elves with longbow)
  const racialProfs = (character.racialWeaponProficiencies || []);
  if (racialProfs.some(rp => wName.includes(rp))) {
    return { proficient: true, penalty: 0, reason: '' };
  }

  // Check direct proficiency from feats
  const feats = (character.feats || []).map(f => f.toLowerCase());
  if (feats.some(f => f.includes('exotic weapon proficiency') && f.includes(wName))) {
    return { proficient: true, penalty: 0, reason: '' };
  }
  if (feats.some(f => f.includes('martial weapon proficiency') && f.includes(wName))) {
    return { proficient: true, penalty: 0, reason: '' };
  }

  // Check class proficiency categories
  const isSimple = SIMPLE_WEAPONS.some(w => wName.includes(w.toLowerCase()));
  const isMartial = MARTIAL_WEAPONS.some(w => wName.includes(w.toLowerCase()));

  if (profs.includes('all simple and martial weapons') || profs.includes('all martial weapons')) {
    if (isSimple || isMartial) return { proficient: true, penalty: 0, reason: '' };
  }
  if (profs.includes('simple weapons') || profs.includes('all simple weapons')) {
    if (isSimple) return { proficient: true, penalty: 0, reason: '' };
  }
  if (profs.includes('martial weapons')) {
    if (isMartial) return { proficient: true, penalty: 0, reason: '' };
  }

  // Check for specific weapon proficiency in class list
  if (profs.some(p => wName.includes(p))) {
    return { proficient: true, penalty: 0, reason: '' };
  }

  // Monks get special weapons
  if (character.class === 'Monk') {
    const monkWeapons = ['kama', 'nunchaku', 'sai', 'shuriken', 'siangham', 'handaxe', 'javelin', 'quarterstaff', 'short sword'];
    if (monkWeapons.some(m => wName.includes(m))) return { proficient: true, penalty: 0, reason: '' };
  }

  // Not proficient: -4 to attack rolls
  return {
    proficient: false,
    penalty: -4,
    reason: `Not proficient with ${weaponName} (-4 attack)`,
  };
}

/**
 * Check if a character is proficient with their equipped armor.
 * Non-proficiency: apply armor check penalty to attack rolls and all STR/DEX-based skill checks.
 * @returns {{ proficient, penalty, reason }}
 */
export function checkArmorProficiency(character, armorName) {
  if (!armorName || armorName === 'None') return { proficient: true, penalty: 0, reason: '' };

  const cls = classesMap[character.class];
  if (!cls?.proficiencies?.armor) return { proficient: true, penalty: 0, reason: '' };

  const profs = cls.proficiencies.armor.map(p => p.toLowerCase());
  const aName = (armorName || '').toLowerCase();

  // Check feat-based proficiency
  const feats = (character.feats || []).map(f => f.toLowerCase());
  if (feats.includes('armor proficiency, heavy') || feats.includes('heavy armor proficiency')) {
    return { proficient: true, penalty: 0, reason: '' };
  }
  if ((feats.includes('armor proficiency, medium') || feats.includes('medium armor proficiency'))) {
    const isHeavy = ARMOR_PROFICIENCY.heavy.some(a => aName.includes(a.toLowerCase()));
    if (!isHeavy) return { proficient: true, penalty: 0, reason: '' };
  }
  if ((feats.includes('armor proficiency, light') || feats.includes('light armor proficiency'))) {
    const isLight = ARMOR_PROFICIENCY.light.some(a => aName.includes(a.toLowerCase()));
    if (isLight) return { proficient: true, penalty: 0, reason: '' };
  }

  // Determine armor category
  const isLight = ARMOR_PROFICIENCY.light.some(a => aName.includes(a.toLowerCase()));
  const isMedium = ARMOR_PROFICIENCY.medium.some(a => aName.includes(a.toLowerCase()));
  const isHeavy = ARMOR_PROFICIENCY.heavy.some(a => aName.includes(a.toLowerCase()));

  // Check class proficiency
  if (profs.includes('all armor') || profs.includes('heavy armor')) return { proficient: true, penalty: 0, reason: '' };
  if (profs.includes('medium armor') && (isLight || isMedium)) return { proficient: true, penalty: 0, reason: '' };
  if (profs.includes('light armor') && isLight) return { proficient: true, penalty: 0, reason: '' };

  // Not proficient: ACP applies to attack rolls and STR/DEX-based checks
  // Look up ACP from armor data
  const acpMap = {
    'padded': 0, 'leather': 0, 'studded leather': -1, 'chain shirt': -2,
    'hide': -3, 'scale mail': -4, 'chainmail': -5, 'breastplate': -4,
    'splint mail': -7, 'banded mail': -6, 'half-plate': -7, 'full plate': -6,
  };
  const acp = Object.entries(acpMap).find(([key]) => aName.includes(key));
  const penalty = acp ? acp[1] : -4;

  return {
    proficient: false,
    penalty,
    reason: `Not proficient with ${armorName} (ACP ${penalty} to attacks & DEX/STR skills)`,
  };
}

/**
 * Check shield proficiency.
 */
export function checkShieldProficiency(character, shieldName) {
  if (!shieldName || shieldName === 'None') return { proficient: true, penalty: 0, reason: '' };

  const cls = classesMap[character.class];
  if (!cls?.proficiencies?.armor) return { proficient: true, penalty: 0, reason: '' };

  const profs = cls.proficiencies.armor.map(p => p.toLowerCase());
  const feats = (character.feats || []).map(f => f.toLowerCase());

  // Most martial classes get shield proficiency
  if (profs.some(p => p.includes('shield')) ||
      profs.includes('all armor') ||
      profs.includes('heavy armor') ||
      profs.includes('medium armor') ||
      feats.includes('shield proficiency')) {
    // Tower shield requires specific proficiency
    if (shieldName.toLowerCase().includes('tower')) {
      if (profs.some(p => p.includes('tower')) || feats.includes('tower shield proficiency')) {
        return { proficient: true, penalty: 0, reason: '' };
      }
      return { proficient: false, penalty: -10, reason: 'Not proficient with Tower Shield (-10 ACP)' };
    }
    return { proficient: true, penalty: 0, reason: '' };
  }

  return {
    proficient: false,
    penalty: -2,
    reason: `Not proficient with ${shieldName} (ACP applies to attacks)`,
  };
}

/**
 * Get all proficiency issues for a character.
 * Returns an array of { type, item, penalty, reason } objects.
 */
export function getAllProficiencyIssues(character) {
  const issues = [];

  // Check equipped weapon
  const mainWeapon = character.equipped?.mainHand || character.weapons?.[0];
  if (mainWeapon) {
    const wp = checkWeaponProficiency(character, mainWeapon.name || mainWeapon);
    if (!wp.proficient) issues.push({ type: 'weapon', item: mainWeapon.name || mainWeapon, ...wp });
  }

  // Check armor
  if (character.armor && character.armor !== 'None') {
    const ap = checkArmorProficiency(character, character.armor);
    if (!ap.proficient) issues.push({ type: 'armor', item: character.armor, ...ap });
  }

  // Check shield
  if (character.shield && character.shield !== 'None') {
    const sp = checkShieldProficiency(character, character.shield);
    if (!sp.proficient) issues.push({ type: 'shield', item: character.shield, ...sp });
  }

  return issues;
}


// ─────────────────────────────────────────────────────
// COMBAT MODIFIERS
// ─────────────────────────────────────────────────────

/**
 * Compute total attack modifier including proficiency, conditions, feat effects.
 * @returns {{ total, bab, abilityMod, profPenalty, conditionMod, featMod, sizeMod, breakdown }}
 */
export function computeAttackMod(character, weapon, conditionMods = {}, enemyTypes = []) {
  const bab = character.bab || 0;
  const isRanged = weapon?.category === 'ranged' || weapon?.type === 'ranged';
  const abilityKey = isRanged ? 'DEX' : 'STR';

  // Weapon Finesse check
  const feats = character.feats || [];
  const FINESSE_WEAPONS = ['rapier', 'dagger', 'short sword', 'whip', 'spiked chain', 'elven curve blade', 'starknife'];
  const wName = (weapon?.name || '').toLowerCase();
  const useFinesse = !isRanged && feats.includes('Weapon Finesse') &&
    FINESSE_WEAPONS.some(f => wName.includes(f));
  const effectiveAbility = useFinesse ? 'DEX' : abilityKey;

  const abilityMod = mod(character.abilities?.[effectiveAbility] || 10);

  // Proficiency
  const profCheck = checkWeaponProficiency(character, weapon?.name);
  const profPenalty = profCheck.penalty;

  // Armor proficiency penalty applies to attacks
  const armorProf = checkArmorProficiency(character, character.armor);
  const armorPenalty = armorProf.proficient ? 0 : armorProf.penalty;

  // Size modifier
  const sizeMod = character.size === 'Small' ? 1 : character.size === 'Large' ? -1 : 0;

  // Condition + active effect modifiers
  const condMod = conditionMods.attack || 0;

  // Ability bonuses from spells (e.g., Bull's Strength +4 STR → +2 attack for melee)
  const relevantAbility = effectiveAbility.toLowerCase();
  const spellAbilityAttackBonus = Math.floor((conditionMods[`${relevantAbility}Bonus`] || 0) / 2);
  const spellAbilityAttackPenalty = Math.floor((conditionMods[`${relevantAbility}Penalty`] || 0) / 2);

  // Feat modifiers (auto-applied combat feats)
  let featMod = 0;
  if (feats.includes('Weapon Focus') || feats.some(f => f.startsWith('Weapon Focus'))) {
    featMod += 1;
  }

  // Racial Hatred bonus (e.g., Dwarf +1 attack vs orc/goblinoid)
  let hatredBonus = 0;
  const hatred = character.racialCombatBonuses?.hatred;
  if (hatred && enemyTypes.length > 0) {
    const enemyLower = enemyTypes.map(t => t.toLowerCase());
    if (hatred.vsTypes.some(vt => enemyLower.includes(vt))) {
      hatredBonus = hatred.attackBonus;
    }
  }

  // Halfling +1 racial bonus with slings and thrown weapons
  let racialWeaponBonus = 0;
  const slingBonus = character.racialCombatBonuses?.slingThrownBonus;
  if (slingBonus) {
    const wLower = (weapon?.name || '').toLowerCase();
    const isThrown = weapon?.category === 'thrown' || weapon?.type === 'thrown';
    if (wLower.includes('sling') || isThrown) {
      racialWeaponBonus = slingBonus.attackBonus;
    }
  }

  const total = bab + abilityMod + profPenalty + armorPenalty + sizeMod + condMod + featMod + spellAbilityAttackBonus + spellAbilityAttackPenalty + hatredBonus + racialWeaponBonus;

  return {
    total,
    bab,
    abilityMod,
    abilityKey: effectiveAbility,
    profPenalty,
    armorPenalty,
    sizeMod,
    conditionMod: condMod,
    spellAbilityMod: spellAbilityAttackBonus + spellAbilityAttackPenalty,
    featMod,
    breakdown: [
      `${bab} BAB`,
      `${abilityMod >= 0 ? '+' : ''}${abilityMod} ${effectiveAbility}`,
      profPenalty ? `${profPenalty} non-prof` : '',
      armorPenalty ? `${armorPenalty} armor` : '',
      sizeMod ? `${sizeMod > 0 ? '+' : ''}${sizeMod} size` : '',
      condMod ? `${condMod > 0 ? '+' : ''}${condMod} conditions` : '',
      spellAbilityAttackBonus ? `+${spellAbilityAttackBonus} spell` : '',
      featMod ? `+${featMod} feat` : '',
      hatredBonus ? `+${hatredBonus} hatred` : '',
      racialWeaponBonus ? `+${racialWeaponBonus} racial` : '',
    ].filter(Boolean).join(', '),
    hatredBonus,
    racialWeaponBonus,
  };
}

/**
 * Compute damage modifier for a weapon attack.
 * Includes STR (or 1.5x for two-handed), Power Attack, conditions.
 */
export function computeDamageMod(character, weapon, conditionMods = {}) {
  const isRanged = weapon?.category === 'ranged' || weapon?.type === 'ranged';
  const isTwoHanded = weapon?.hands === 2 || weapon?.twoHanded ||
    ['greatsword', 'greataxe', 'greatclub', 'halberd', 'glaive', 'guisarme',
     'ranseur', 'scythe', 'falchion', 'longspear', 'quarterstaff'].some(w =>
      (weapon?.name || '').toLowerCase().includes(w));

  // STR to damage (1.5x for two-handed, 0 for ranged unless composite)
  const strMod = mod(character.abilities?.STR || 10);
  let strDmg = isRanged ? 0 : (isTwoHanded ? Math.floor(strMod * 1.5) : strMod);

  // Composite bows add STR (up to the bow's rating)
  if (isRanged && (weapon?.name || '').toLowerCase().includes('composite')) {
    strDmg = Math.max(0, strMod); // Simplified: full STR for composite
  }

  // Power Attack
  const feats = character.feats || [];
  let powerAttackDmg = 0;
  if (feats.includes('Power Attack') && !isRanged && character.powerAttackActive) {
    const bab = character.bab || 0;
    const paDmg = 2 + Math.floor(bab / 4) * 2; // +2 at BAB 1, +4 at BAB 4, etc.
    powerAttackDmg = isTwoHanded ? Math.floor(paDmg * 1.5) : paDmg;
  }

  // Deadly Aim (ranged Power Attack)
  let deadlyAimDmg = 0;
  if (feats.includes('Deadly Aim') && isRanged && character.deadlyAimActive) {
    const bab = character.bab || 0;
    deadlyAimDmg = 2 + Math.floor(bab / 4) * 2;
  }

  // Weapon Specialization
  let specDmg = 0;
  if (feats.includes('Weapon Specialization') || feats.some(f => f.startsWith('Weapon Specialization'))) {
    specDmg += 2;
  }
  if (feats.includes('Greater Weapon Specialization') || feats.some(f => f.startsWith('Greater Weapon Specialization'))) {
    specDmg += 2;
  }

  const condMod = conditionMods.damage || 0;

  // STR bonus from spells (e.g., Bull's Strength +4 STR → +2 damage for melee, 1.5x for 2H)
  let spellStrDmg = 0;
  if (!isRanged && (conditionMods.strBonus || conditionMods.strPenalty)) {
    const extraStr = Math.floor((conditionMods.strBonus || 0) / 2) + Math.floor((conditionMods.strPenalty || 0) / 2);
    spellStrDmg = isTwoHanded ? Math.floor(extraStr * 1.5) : extraStr;
  }

  const total = strDmg + powerAttackDmg + deadlyAimDmg + specDmg + condMod + spellStrDmg;

  return {
    total: Math.max(0, total),
    str: strDmg,
    spellStr: spellStrDmg,
    powerAttack: powerAttackDmg,
    deadlyAim: deadlyAimDmg,
    specialization: specDmg,
    conditionMod: condMod,
  };
}


// ─────────────────────────────────────────────────────
// SKILL CHECK ENFORCEMENT — CRB Chapter 4
// ─────────────────────────────────────────────────────

// CRB armor check penalties — armor has its own ACP, shields have a separate ACP
// Both stack on STR/DEX-based skill checks per CRB Chapter 6
const ARMOR_ACP_MAP = {
  'padded': 0, 'leather': 0, 'studded leather': -1, 'chain shirt': -2,
  'hide': -3, 'scale mail': -4, 'chainmail': -5, 'breastplate': -4,
  'splint mail': -7, 'banded mail': -6, 'half-plate': -7, 'full plate': -6,
};

// Shield ACP per CRB Table 6-6 — applies to attack rolls AND to STR/DEX-based skills
const SHIELD_ACP_MAP = {
  'buckler': -1,
  'light wooden shield': -1, 'light steel shield': -1,
  'heavy wooden shield': -2, 'heavy steel shield': -2,
  'tower shield': -10,
};

/**
 * Get armor + shield ACP that applies to STR/DEX-based skill checks.
 * Both stack per CRB. Returns negative number (or 0).
 *
 * Lookup uses LONGEST-MATCH-FIRST so that "studded leather" matches the
 * `studded leather` entry (-1) instead of falling through to the `leather`
 * entry (0) just because `leather` is a substring of `studded leather`.
 * Same for `chain shirt` vs `chainmail`, `light wooden shield` vs
 * `wooden shield`, etc. The previous code used `Object.entries(...).find()`
 * which honored insertion order and silently mis-priced several armors.
 */
export function getCombinedSkillACP(character) {
  let total = 0;
  const aName = (character.armor || '').toLowerCase();
  if (aName && aName !== 'none') {
    const armorEntries = Object.entries(ARMOR_ACP_MAP)
      .filter(([key]) => aName.includes(key))
      .sort((a, b) => b[0].length - a[0].length);
    if (armorEntries.length) total += armorEntries[0][1];
  }
  const sName = (character.shield || '').toLowerCase();
  if (sName && sName !== 'none') {
    const shieldEntries = Object.entries(SHIELD_ACP_MAP)
      .filter(([key]) => sName.includes(key))
      .sort((a, b) => b[0].length - a[0].length);
    if (shieldEntries.length) total += shieldEntries[0][1];
  }
  return total;
}

// Skills where Take 20 is FORBIDDEN by default because failure carries an inherent penalty.
// CRB pp. 86-87: Take 20 assumes you fail many times before succeeding, so each failure
// auto-incurs the failure penalty (falling, drowning, etc.). Disable Device is NOT in this set —
// CRB explicitly cites it as a canonical Take 20 skill for opening locks. Trap-disarming is the
// exception, which the caller signals via situation.disarmingTrap = true.
const TAKE20_FORBIDDEN_DEFAULT = new Set([
  'Climb',       // Failure means falling
  'Swim',        // Failure means going under / drowning checks
  'Acrobatics',  // Failure on jumps = falling
  'Fly',         // Failure means falling
  'Ride',        // Failure means thrown
]);

/**
 * Determine whether the given situation allows Take 10.
 * CRB: cannot Take 10 when "in immediate danger or distracted"
 * Distraction examples: combat, being attacked, casting underwater, racing the clock.
 */
export function canTake10(character, situation = {}) {
  // Combat is the canonical disqualifier
  if (situation.inCombat) return { allowed: false, reason: 'Cannot Take 10 in combat' };
  if (situation.threatened) return { allowed: false, reason: 'Cannot Take 10 while threatened by an enemy' };
  if (situation.distracted) return { allowed: false, reason: 'Cannot Take 10 while distracted' };
  // Conditions that distract
  const conds = (character.activeConditions || []).map(c => (typeof c === 'string' ? c : c.name || '').toLowerCase());
  if (conds.some(c => ['confused','dazed','frightened','panicked','stunned','nauseated'].includes(c))) {
    return { allowed: false, reason: 'Distracting condition prevents Take 10' };
  }
  return { allowed: true };
}

/**
 * Determine whether the given skill + situation allows Take 20.
 * CRB: requires plenty of time, no threats/distractions, AND failure must not carry inherent penalty.
 */
export function canTake20(character, skillName, situation = {}) {
  const ten = canTake10(character, situation);
  if (!ten.allowed) return { allowed: false, reason: ten.reason };
  if (situation.timeLimit) return { allowed: false, reason: 'Take 20 requires plenty of time (20× normal duration)' };
  // Default forbidden list — caller can override with situation.failurePenalty=false
  if (situation.failurePenalty !== false && TAKE20_FORBIDDEN_DEFAULT.has(skillName)) {
    return {
      allowed: false,
      reason: `${skillName} cannot Take 20 when failure carries an inherent penalty (e.g., falling)`,
    };
  }
  // Trap disarming via Disable Device specifically forbids Take 20 because failure can spring the trap
  if (skillName === 'Disable Device' && situation.disarmingTrap) {
    return { allowed: false, reason: 'Cannot Take 20 to disarm a trap — failure springs it' };
  }
  return { allowed: true };
}

/**
 * Compute a skill check total.
 * @param d20Roll  Pass a number to use that natural roll, or 'take10' / 'take20' to use those rules.
 * @param situation  Optional context: { inCombat, threatened, distracted, timeLimit, failurePenalty, disarmingTrap }
 * @returns {{ total, d20, ranks, abilityMod, classSkillBonus, conditionMod, armorPenalty, miscBonus, breakdown, take, canUse }}
 */
export function computeSkillCheck(character, skillName, d20Roll, skillsData, classSkillsList, conditionMods = {}, situation = {}) {
  const skill = (skillsData || []).find(s => s.name === skillName);
  if (!skill) return { total: d20Roll, d20: d20Roll, breakdown: `${d20Roll} (unknown skill)` };

  // Resolve Take 10 / Take 20 sentinel
  let effectiveD20 = d20Roll;
  let takeMode = null;
  if (d20Roll === 'take10') {
    const check = canTake10(character, situation);
    if (!check.allowed) {
      return { total: null, d20: null, canUse: false, reason: check.reason, breakdown: check.reason };
    }
    effectiveD20 = 10;
    takeMode = 'take10';
  } else if (d20Roll === 'take20') {
    const check = canTake20(character, skillName, situation);
    if (!check.allowed) {
      return { total: null, d20: null, canUse: false, reason: check.reason, breakdown: check.reason };
    }
    effectiveD20 = 20;
    takeMode = 'take20';
  }

  // Nullish-coalesce the ability score so that ability score 0 (paralyzed,
  // ability drain, certain spells) yields the proper -5 mod instead of being
  // silently treated as a 10. `|| 10` would short-circuit on a real 0.
  const abilityMod = mod(character.abilities?.[skill.ability] ?? 10);
  const ranks = character.skillRanks?.[skillName] || 0;
  const isClassSkill = classSkillsList?.includes(skillName);
  const classSkillBonus = (ranks > 0 && isClassSkill) ? 3 : 0;

  // Combined armor + shield check penalty for STR/DEX-based skills
  let armorPen = 0;
  if (skill.armorPenalty) {
    armorPen = getCombinedSkillACP(character);
  }

  // Condition modifiers to skills
  const condMod = conditionMods.skills?.[skillName] || conditionMods.skills?.all || 0;

  // Feat: Skill Focus (+3, or +6 with 10+ ranks)
  let featBonus = 0;
  // Filter out null/undefined feat entries before normalizing — corrupt or
  // partially-deleted save data can leave nulls in the array, and the
  // typeof-null trap (typeof null === 'object') would otherwise crash
  // f.name access in the next step. Also `.trim()` so feat labels stored
  // with leading/trailing whitespace ('Acrobatic ', 'Athletic\n') don't
  // silently bypass detection.
  const feats = (character.feats || [])
    .filter((f) => f != null)
    .map((f) => (typeof f === 'string' ? f : (f.name || '')).toLowerCase().trim());

  // Helper: detect a paired feat by name. Uses a token-aware substring check
  // so that variants like 'Acrobatic', 'Acrobatic Feat', 'Acrobatic (general)'
  // all match — consistent with how Skill Focus is detected. We anchor to a
  // word boundary at the start of the feat label to avoid false positives
  // from unrelated feats whose names happen to contain the substring (e.g.,
  // a homebrew "Hyper-Acrobatic" feat shouldn't grant the Acrobatic bonus,
  // but 'Acrobatic Steps' is a different real feat that ALSO shouldn't
  // grant it — we exclude that by requiring the label to start with the
  // feat name followed by end-of-string, whitespace, or punctuation).
  const hasFeat = (name) => {
    const n = name.toLowerCase();
    return feats.some((f) => {
      if (f === n) return true;
      // Match "<name>" followed by space, paren, colon, comma, or end
      const re = new RegExp(`^${n}(?:[\\s(:,\\-]|$)`);
      return re.test(f);
    });
  };

  if (feats.some((f) => f.includes('skill focus') && f.includes(skillName.toLowerCase()))) {
    featBonus = (ranks >= 10) ? 6 : 3;
  }
  // Alertness: +2 Perception & Sense Motive (+4 at 10+ ranks)
  if ((skillName === 'Perception' || skillName === 'Sense Motive') && hasFeat('alertness')) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }
  // Stealthy: +2 Stealth & Escape Artist (+4 at 10+ ranks)
  if ((skillName === 'Stealth' || skillName === 'Escape Artist') && hasFeat('stealthy')) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }
  // Athletic: +2 Climb & Swim (+4 at 10+ ranks)
  if ((skillName === 'Climb' || skillName === 'Swim') && hasFeat('athletic')) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }
  // Acrobatic: +2 Acrobatics & Fly (+4 at 10+ ranks).
  // Note: we deliberately do NOT match 'acrobatic steps' (a different feat
  // that grants difficult-terrain ignore, not a flat skill bonus). The
  // hasFeat regex anchors to the START of the label so 'acrobatic steps'
  // would only match if a separate plain 'acrobatic' label is also present.
  // Wait — 'acrobatic steps' starts with 'acrobatic' followed by a space, so
  // the regex `^acrobatic(?:[\s(:,\-]|$)` WOULD match it. Filter it out.
  if ((skillName === 'Acrobatics' || skillName === 'Fly')
      && hasFeat('acrobatic')
      && !feats.some((f) => f.startsWith('acrobatic steps'))) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }
  // Deceitful: +2 Bluff & Disguise (+4 at 10+ ranks)
  if ((skillName === 'Bluff' || skillName === 'Disguise') && hasFeat('deceitful')) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }
  // Persuasive: +2 Diplomacy & Intimidate (+4 at 10+ ranks)
  if ((skillName === 'Diplomacy' || skillName === 'Intimidate') && hasFeat('persuasive')) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }
  // Self-Sufficient: +2 Heal & Survival (+4 at 10+ ranks)
  if ((skillName === 'Heal' || skillName === 'Survival') && hasFeat('self-sufficient')) {
    featBonus += (ranks >= 10) ? 4 : 2;
  }

  // Size modifier for Stealth (PF1e CRB Table 4-? Stealth special)
  let sizeBonus = 0;
  if (skillName === 'Stealth') {
    const size = (character.size || 'Medium').toLowerCase();
    if (size === 'fine') sizeBonus = 16;
    else if (size === 'diminutive') sizeBonus = 12;
    else if (size === 'tiny') sizeBonus = 8;
    else if (size === 'small') sizeBonus = 4;
    else if (size === 'large') sizeBonus = -4;
    else if (size === 'huge') sizeBonus = -8;
    else if (size === 'gargantuan') sizeBonus = -12;
    else if (size === 'colossal') sizeBonus = -16;
  }

  const miscBonus = (character.skillBonuses?.[skillName] || 0) + (character.racialSkillBonuses?.[skillName] || 0);

  // Untrained check (CRB: skills with "Trained Only" marker need 1+ rank)
  if (!skill.untrained && ranks === 0) {
    return {
      total: null,
      d20: effectiveD20,
      canUse: false,
      reason: `${skillName} requires training (ranks) to use`,
      breakdown: 'Cannot use untrained',
    };
  }

  // Knowledge DC 10 rule: untrained Knowledge checks can only attempt DC 10 or lower commonplace info
  // We surface this as a flag — the caller (DM) decides based on the actual DC.
  const knowledgeUntrainedRestricted = skillName.startsWith('Knowledge') && ranks === 0;

  const total = effectiveD20 + abilityMod + ranks + classSkillBonus + armorPen + condMod + featBonus + miscBonus + sizeBonus;

  // "Unlearned" drawback: cannot attempt untrained Knowledge checks at all
  const drawback = (character.drawback || '').toLowerCase();
  if (knowledgeUntrainedRestricted && drawback === 'unlearned') {
    return {
      total: null,
      d20: effectiveD20,
      canUse: false,
      reason: 'Unlearned drawback prevents untrained Knowledge checks',
      breakdown: 'Cannot use — Unlearned drawback',
    };
  }

  return {
    total,
    d20: effectiveD20,
    ranks,
    abilityMod,
    abilityKey: skill.ability,
    classSkillBonus,
    armorPenalty: armorPen,
    conditionMod: condMod,
    featBonus,
    miscBonus,
    sizeBonus,
    canUse: true,
    take: takeMode,
    knowledgeUntrainedRestricted,
    breakdown: `${takeMode === 'take10' ? '[Take 10]' : takeMode === 'take20' ? '[Take 20]' : effectiveD20} + ${ranks} ranks + ${abilityMod} ${skill.ability}${classSkillBonus ? ' + 3 class' : ''}${armorPen ? ` ${armorPen} ACP` : ''}${condMod ? ` ${condMod > 0 ? '+' : ''}${condMod} cond` : ''}${featBonus ? ` +${featBonus} feat` : ''}${sizeBonus ? ` ${sizeBonus > 0 ? '+' : ''}${sizeBonus} size` : ''}${miscBonus ? ` ${miscBonus > 0 ? '+' : ''}${miscBonus} misc` : ''} = ${total}`,
  };
}

/**
 * Compute a character's static skill modifier (everything except the d20).
 * Useful for displaying "Perception +7" in character context for the AI.
 */
export function computeSkillModifier(character, skillName, skillsData, classSkillsList, conditionMods = {}) {
  // Use Take 10 as a vehicle, then subtract 10 to get the bare modifier
  const result = computeSkillCheck(character, skillName, 10, skillsData, classSkillsList, conditionMods);
  if (!result.canUse) return { total: null, canUse: false, reason: result.reason };
  return {
    total: result.total - 10,
    canUse: true,
    abilityKey: result.abilityKey,
    breakdown: result.breakdown.replace(/^10/, '0').replace(/= \d+/, `mod = ${result.total - 10}`),
  };
}

/**
 * Compute every skill modifier for a character. Returns a map { skillName: { total, abilityKey, isClassSkill, ranks, canUse } }
 * Used to feed the DM AI a complete picture so it can pick correct DCs and call for the right checks.
 */
export function computeAllSkillModifiers(character, skillsData, conditionMods = {}) {
  if (!skillsData) return {};
  const cls = classesMap[character.class];
  const classSkillsList = cls?.classSkills || [];
  const out = {};
  for (const s of skillsData) {
    const r = computeSkillModifier(character, s.name, skillsData, classSkillsList, conditionMods);
    out[s.name] = {
      total: r.total,
      canUse: r.canUse,
      ranks: character.skillRanks?.[s.name] || 0,
      ability: s.ability,
      isClassSkill: classSkillsList.includes(s.name),
      trainedOnly: !s.untrained,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────
// AID ANOTHER (skills) — CRB p. 86
// ─────────────────────────────────────────────────────

/**
 * Aid Another on a skill check. The aider rolls the same skill against DC 10.
 * Success grants +2 to the primary character's check. CANNOT Take 10 to aid.
 *
 * @param aider          The helping character.
 * @param skillName      Skill being aided.
 * @param aiderD20Roll   The aider's d20 roll (must be a number; cannot be 'take10').
 * @returns { success, bonus, breakdown }
 */
export function computeAidAnother(aider, skillName, aiderD20Roll, skillsData, classSkillsList, conditionMods = {}) {
  if (typeof aiderD20Roll !== 'number') {
    return { success: false, bonus: 0, breakdown: 'Aid Another requires an actual roll — cannot Take 10' };
  }
  const result = computeSkillCheck(aider, skillName, aiderD20Roll, skillsData, classSkillsList, conditionMods);
  if (!result.canUse) {
    return { success: false, bonus: 0, breakdown: `Aider cannot use ${skillName}: ${result.reason}` };
  }
  const success = result.total >= 10;
  // Cooperation feat upgrades aid bonus from +2 to +3
  const aiderFeats = (aider.feats || []).map(f => (typeof f === 'string' ? f : f.name || '').toLowerCase());
  const cooperationBonus = aiderFeats.includes('cooperation') ? 3 : 2;
  return {
    success,
    bonus: success ? cooperationBonus : 0,
    aiderResult: result.total,
    breakdown: success
      ? `${aider.name || 'Aider'} aids ${skillName}: ${result.total} ≥ 10 → +${cooperationBonus}`
      : `${aider.name || 'Aider'} fails to aid ${skillName}: ${result.total} < 10`,
  };
}

// ─────────────────────────────────────────────────────
// SOCIAL SKILLS — CRB pp. 92, 94, 99
// ─────────────────────────────────────────────────────

// Diplomacy attitude track (CRB p. 94, Table 4-? "Initial Attitude")
// Index represents how many steps "above" hostile.
export const ATTITUDES = ['hostile', 'unfriendly', 'indifferent', 'friendly', 'helpful'];

/**
 * Diplomacy: shift an NPC's attitude. CRB p. 94.
 * To improve attitude, the DC depends on the NPC's CURRENT attitude.
 * Standard shift is one step; +5 over the DC for two steps.
 * Failure by 5+ shifts attitude one step worse.
 *
 * Standard DCs (CRB Table — relative to current attitude → target):
 *   hostile     → unfriendly: 25
 *   hostile     → indifferent: 35
 *   unfriendly  → indifferent: 15
 *   unfriendly  → friendly:    25
 *   indifferent → friendly:    15
 *   indifferent → helpful:     25
 *   friendly    → helpful:     10
 *
 * Diplomacy is a full-round action (or longer for hostile), modified by Cha differential.
 *
 * @param diplomatCheckTotal  total of the diplomat's Diplomacy check (already includes mods)
 * @param currentAttitude     'hostile' | 'unfriendly' | 'indifferent' | 'friendly' | 'helpful'
 * @returns { newAttitude, change, dcOneStep, breakdown }
 */
export function resolveDiplomacyAttitude(diplomatCheckTotal, currentAttitude) {
  const cur = (currentAttitude || 'indifferent').toLowerCase();
  const idx = ATTITUDES.indexOf(cur);
  if (idx === -1) {
    return { newAttitude: cur, change: 0, breakdown: `Unknown attitude: ${currentAttitude}` };
  }
  // CRB DC table — DC to shift one step UP from current
  const oneStepDC = {
    'hostile': 25,
    'unfriendly': 15,
    'indifferent': 15,
    'friendly': 10,
    'helpful': null, // already maxed
  }[cur];

  if (oneStepDC === null) {
    return { newAttitude: 'helpful', change: 0, dcOneStep: null, breakdown: 'Already helpful — no change.' };
  }

  // Failure by 5+ → one step worse
  if (diplomatCheckTotal < oneStepDC - 5) {
    const newIdx = Math.max(0, idx - 1);
    return {
      newAttitude: ATTITUDES[newIdx],
      change: -1,
      dcOneStep: oneStepDC,
      breakdown: `Diplomacy ${diplomatCheckTotal} vs DC ${oneStepDC} — failed by 5+, attitude worsens to ${ATTITUDES[newIdx]}`,
    };
  }
  // Failure (within 4) → no change
  if (diplomatCheckTotal < oneStepDC) {
    return {
      newAttitude: cur,
      change: 0,
      dcOneStep: oneStepDC,
      breakdown: `Diplomacy ${diplomatCheckTotal} vs DC ${oneStepDC} — failed, attitude unchanged`,
    };
  }
  // Success — at least one step up; +5 over DC = two steps
  const stepsUp = diplomatCheckTotal >= oneStepDC + 5 ? 2 : 1;
  const newIdx = Math.min(ATTITUDES.length - 1, idx + stepsUp);
  return {
    newAttitude: ATTITUDES[newIdx],
    change: stepsUp,
    dcOneStep: oneStepDC,
    breakdown: `Diplomacy ${diplomatCheckTotal} vs DC ${oneStepDC} — ${stepsUp === 2 ? 'great success (+5 over DC)' : 'success'}, attitude → ${ATTITUDES[newIdx]}`,
  };
}

/**
 * Diplomacy: request a favor from an NPC. CRB p. 94.
 * Base DC depends on attitude; "favor" types add modifiers.
 * helpful → DC 0 (simple favor), friendly → DC 10, indifferent → DC 20, unfriendly → DC 25, hostile → impossible
 */
export function getDiplomacyFavorDC(currentAttitude, favorDifficulty = 'simple') {
  const cur = (currentAttitude || 'indifferent').toLowerCase();
  const baseDC = {
    'hostile': null, // hostile NPCs won't grant favors
    'unfriendly': 25,
    'indifferent': 20,
    'friendly': 10,
    'helpful': 0,
  }[cur];
  if (baseDC === null) return { dc: null, reason: 'Hostile NPCs will not grant favors — improve attitude first.' };
  const mod = { 'simple': 0, 'moderate': 5, 'major': 10, 'extreme': 15 }[favorDifficulty.toLowerCase()] || 0;
  return { dc: baseDC + mod, baseDC, modifier: mod };
}

/**
 * Bluff: opposed by Sense Motive (CRB pp. 90–92).
 *
 * ┌──────────────────────┬──────────────────┐
 * │ Circumstance         │ Bluff Modifier   │
 * ├──────────────────────┼──────────────────┤
 * │ Target wants to      │ +5               │
 * │   believe the lie    │                  │
 * │ The lie is           │ +0               │
 * │   believable         │                  │
 * │ The lie is unlikely  │ –5               │
 * │ The lie is           │ –10              │
 * │   far-fetched        │                  │
 * │ The lie is           │ –20              │
 * │   impossible         │                  │
 * │ Target is drunk /    │ +5               │
 * │   impaired           │                  │
 * │ Convincing proof     │ up to +10        │
 * └──────────────────────┴──────────────────┘
 *
 * CRB p. 90: "A successful Bluff check indicates that the target reacts as
 * you wish, at least for a short time … or believes something that you want
 * it to believe. … If the check fails by 5 or more, rather than believing
 * you, the creature is convinced you are trying to use it." (Not yet
 * tracked — noted for future enhancement.)
 *
 * Retry: CRB p. 90: "If you fail to deceive someone, any further attempts
 * to deceive them carry a –10 penalty." (Tracked via retryPenalty param.)
 *
 * @param bluffTotal            liar's Bluff check total
 * @param senseMotiveTotal      listener's Sense Motive total
 * @param plausibility          'believable' (+0) | 'unlikely' (–5) | 'far-fetched' (–10) | 'impossible' (–20)
 * @param targetWantsToBelieve  +5 if target wants to believe, –5 if suspicious (CRB p. 90)
 * @param opts                  { drunk: bool, proofBonus: 0-10, retryPenalty: 0|-10 }
 */
export function resolveBluff(bluffTotal, senseMotiveTotal, plausibility = 'unlikely', targetWantsToBelieve = 0, opts = {}) {
  const plausMod = {
    'believable': 0, 'unlikely': -5, 'far-fetched': -10, 'impossible': -20,
  }[(plausibility || '').toLowerCase()] ?? 0;
  const drunkMod = opts.drunk ? 5 : 0;
  const proofMod = Math.min(Math.max(opts.proofBonus || 0, 0), 10);
  const retryPen = opts.retryPenalty || 0;
  const adjustedBluff = bluffTotal + plausMod + (targetWantsToBelieve || 0) + drunkMod + proofMod + retryPen;
  const success = adjustedBluff >= senseMotiveTotal;
  const failBy = success ? 0 : senseMotiveTotal - adjustedBluff;
  const hostileReaction = failBy >= 5; // CRB: "convinced you are trying to use it"
  const modParts = [];
  if (plausMod) modParts.push(`${plausMod >= 0 ? '+' : ''}${plausMod} plausibility`);
  if (targetWantsToBelieve) modParts.push(`${targetWantsToBelieve >= 0 ? '+' : ''}${targetWantsToBelieve} disposition`);
  if (drunkMod) modParts.push('+5 impaired');
  if (proofMod) modParts.push(`+${proofMod} proof`);
  if (retryPen) modParts.push(`${retryPen} retry`);
  return {
    success,
    adjustedBluff,
    senseMotiveTotal,
    plausibilityModifier: plausMod,
    hostileReaction,
    breakdown: `Bluff ${bluffTotal}${modParts.length ? ` ${modParts.join(' ')}` : ''} = ${adjustedBluff} vs Sense Motive ${senseMotiveTotal} → ${success ? 'BELIEVED' : (hostileReaction ? 'seen through (hostile reaction)' : 'seen through')}`,
  };
}

/**
 * Bluff: feint in combat — compute the opposed DC (CRB p. 92, ch. 8 p. 201).
 *
 * Standard action; opposed by 10 + target's BAB + Wis modifier, or
 * 10 + target's Sense Motive bonus (if trained and higher).
 *
 * CRB p. 201 (Combat chapter, Feint action):
 *   "When feinting against a nonhumanoid you take a –4 penalty.
 *    Against a creature of animal Intelligence (1 or 2), you take a –8
 *    penalty. Against a creature lacking an Intelligence score, it's
 *    impossible."
 *
 * The –4 and –8 are penalties to the Bluff check, which is equivalent
 * to adding +4/+8 to the DC. The –8 REPLACES the –4 (not cumulative).
 *
 * On success the target is denied its DEX bonus to AC against the feinter's
 * next melee attack before the end of the feinter's next turn.
 *
 * @returns {{ dc, typePenalty, impossible, breakdown }}
 */
export function getBluffFeintOpposed(target) {
  const senseMotiveTotal = target.skills?.['Sense Motive']?.bonus || target.senseMotive || 0;
  const wisMod = target.wisMod != null ? target.wisMod : mod(target.abilities?.WIS || 10);
  const bab = target.bab || 0;
  // CRB p. 92: "10 + target's BAB + Wis modifier" or "10 + Sense Motive bonus"
  const baseDC = 10 + Math.max(senseMotiveTotal, bab + wisMod);

  // Determine creature type for feint penalty / DC adjustment
  const type = (target.type || target.creatureType || '').toLowerCase();
  const intelligence = target.intelligence ?? target.int ?? (target.abilities?.INT != null ? target.abilities.INT : null);

  // No Intelligence score → impossible (oozes, plants, vermin, mindless undead).
  // CRB p. 201: "Against a creature lacking an Intelligence score, it's impossible."
  // Guard: only flag if the creature type suggests a mindless creature; humanoid
  // PCs/NPCs always have Int, so null/undefined on them is just missing data.
  const noIntScore = intelligence === 'mindless' || (intelligence == null && type && !type.includes('humanoid'));
  if (noIntScore) {
    return { dc: Infinity, typePenalty: 0, impossible: true, breakdown: 'Cannot feint a creature lacking an Intelligence score' };
  }

  // CRB p. 201: –8 replaces –4 (not cumulative)
  let typePenalty = 0;
  if (intelligence != null && intelligence !== 'mindless' && intelligence <= 2) {
    // Animal Intelligence (1 or 2) → –8 on Bluff = +8 to DC
    typePenalty = 8;
  } else if (type && !type.includes('humanoid')) {
    // Non-humanoid with Int 3+ → –4 on Bluff = +4 to DC
    typePenalty = 4;
  }

  const dc = baseDC + typePenalty;
  const parts = [`10 + max(SM ${senseMotiveTotal}, BAB ${bab} + Wis ${wisMod})`];
  if (typePenalty) parts.push(`+${typePenalty} ${typePenalty === 8 ? 'animal Int' : 'non-humanoid'}`);
  return { dc, typePenalty, impossible: false, breakdown: `vs DC ${dc} (${parts.join(', ')})` };
}

/**
 * Intimidate: Demoralize action. CRB p. 99.
 * Standard action. DC = 10 + target HD + target Wis mod.
 * Success → target shaken for 1 round; +1 round per 5 over DC.
 * Use Intimidate or Strength (whichever the user prefers; CRB allows STR-based intimidation).
 */
export function resolveDemoralize(intimidateTotal, target) {
  const hd = target.hd || target.level || 1;
  const wisMod = mod(target.abilities?.WIS || 10);
  const dc = 10 + hd + wisMod;
  if (intimidateTotal < dc) {
    return { success: false, dc, breakdown: `Intimidate ${intimidateTotal} vs DC ${dc} (10 + ${hd} HD + ${wisMod} Wis) — fail` };
  }
  const overflow = intimidateTotal - dc;
  const rounds = 1 + Math.floor(overflow / 5);
  return {
    success: true,
    dc,
    rounds,
    condition: 'shaken',
    breakdown: `Intimidate ${intimidateTotal} vs DC ${dc} — success, target SHAKEN for ${rounds} round${rounds === 1 ? '' : 's'}`,
  };
}

/**
 * Intimidate: Change Attitude (longer interaction, CRB p. 99).
 * Full minute of interaction. DC = 10 + target HD + target Wis mod.
 * Success makes target friendly for 1d6×10 minutes — but they see the encounter as coerced and may seek revenge later.
 */
export function resolveIntimidateInfluence(intimidateTotal, target) {
  const hd = target.hd || target.level || 1;
  const wisMod = mod(target.abilities?.WIS || 10);
  const dc = 10 + hd + wisMod;
  if (intimidateTotal < dc) {
    return { success: false, dc, breakdown: `Intimidate ${intimidateTotal} vs DC ${dc} — fail; target hostile or unmoved` };
  }
  return {
    success: true,
    dc,
    temporaryAttitude: 'friendly',
    durationMinutes: '1d6 × 10',
    sideEffect: 'After duration ends, attitude shifts to UNFRIENDLY (or worse) — target remembers being coerced',
    breakdown: `Intimidate ${intimidateTotal} vs DC ${dc} — coerced cooperation`,
  };
}

// ─────────────────────────────────────────────────────
// PERCEPTION & STEALTH (opposed) — CRB pp. 102, 106
// ─────────────────────────────────────────────────────

/**
 * Apply situational modifiers to a Stealth check based on movement.
 * - Moving more than half normal speed: -5
 * - Running, charging: -20
 * - Sniping (after attacking): -20
 *
 * Returns the modifier to ADD to the raw Stealth check total.
 */
export function getStealthSituationalMod({ movement = 'normal', sniping = false } = {}) {
  let total = 0;
  const m = (movement || 'normal').toLowerCase();
  if (m === 'fast' || m === 'over-half') total -= 5;
  if (m === 'run' || m === 'running' || m === 'charge' || m === 'charging') total -= 20;
  if (sniping) total -= 20;
  return total;
}

/**
 * Apply situational modifiers to a Perception check.
 * - Distance: -1 per 10 ft for visible, -1 per 10 ft for sound
 * - Through wall, closed door: thick obstacles raise DCs (handled by caller)
 * - Distracted: -5
 * - Asleep: -10
 * - Favorable (silent room): +2
 * - Unfavorable (windy, raining): -2 to -5
 *
 * Returns the modifier to ADD to the Perception roll total.
 */
export function getPerceptionSituationalMod({ distanceFeet = 0, distracted = false, asleep = false, weather = 'clear' } = {}) {
  let total = 0;
  if (distanceFeet > 0) total -= Math.floor(distanceFeet / 10);
  if (distracted) total -= 5;
  if (asleep) total -= 10;
  const w = (weather || 'clear').toLowerCase();
  if (w.includes('heavy') && (w.includes('rain') || w.includes('snow'))) total -= 4;
  else if (w.includes('rain') || w.includes('snow') || w.includes('wind')) total -= 2;
  return total;
}

/**
 * Resolve an opposed Stealth vs Perception check.
 * @param stealthTotal   stealther's Stealth check total (including any movement penalty)
 * @param perceptionTotal observer's Perception check total
 * @returns { detected, margin, breakdown }
 */
export function resolveStealthVsPerception(stealthTotal, perceptionTotal) {
  // Ties go to the stealther (the observer must beat the Stealth check)
  const detected = perceptionTotal > stealthTotal;
  return {
    detected,
    margin: perceptionTotal - stealthTotal,
    breakdown: `Stealth ${stealthTotal} vs Perception ${perceptionTotal} → ${detected ? 'DETECTED' : 'unseen (ties go to stealther)'}`,
  };
}

// ─────────────────────────────────────────────────────
// HEAL — CRB p. 97
// ─────────────────────────────────────────────────────

/**
 * Heal: First Aid (stabilize a dying creature). CRB p. 97. Standard action. DC 15.
 * Success → target stabilizes (no longer dying).
 */
export function resolveFirstAid(healCheckTotal) {
  const dc = 15;
  return {
    success: healCheckTotal >= dc,
    dc,
    breakdown: `Heal ${healCheckTotal} vs DC 15 (first aid) → ${healCheckTotal >= dc ? 'stabilized' : 'failed'}`,
  };
}

/**
 * Heal: Long-term care. CRB p. 97. Provides care for up to 6 patients/day.
 * DC 15. On success, each patient recovers 2× normal HP per day of bed rest, plus 2× ability damage healed.
 */
export function resolveLongTermCare(healCheckTotal) {
  const dc = 15;
  if (healCheckTotal < dc) {
    return { success: false, dc, hpMultiplier: 1, abilityMultiplier: 1, breakdown: `Heal ${healCheckTotal} vs DC 15 — care fails, normal healing rate` };
  }
  return {
    success: true,
    dc,
    hpMultiplier: 2,
    abilityMultiplier: 2,
    breakdown: `Heal ${healCheckTotal} vs DC 15 — long-term care, 2× HP and 2× ability damage recovered per day`,
  };
}

/**
 * Heal: Treat Disease. CRB p. 97. Standard action, DC = disease save DC.
 * On success, the patient gets to substitute the heal check for their next save vs the disease.
 * Pass {diseaseSaveDC} so caller knows what to roll against.
 */
export function resolveTreatDisease(healCheckTotal, diseaseSaveDC) {
  const success = healCheckTotal >= diseaseSaveDC;
  return {
    success,
    dc: diseaseSaveDC,
    substituteForNextSave: success,
    breakdown: `Heal ${healCheckTotal} vs DC ${diseaseSaveDC} (disease save) → ${success ? 'patient may substitute this for next save' : 'no help'}`,
  };
}

// ─────────────────────────────────────────────────────
// DISABLE DEVICE — CRB p. 95
// ─────────────────────────────────────────────────────

/**
 * Disable Device: disarm a trap or pick a lock. CRB p. 95.
 * Time depends on complexity. Failure by 5+ on a trap MAY trigger it.
 *
 * @param checkTotal  the rogue's Disable Device total
 * @param dc          the trap/lock DC
 * @returns { success, triggered, breakdown }
 */
export function resolveDisableDevice(checkTotal, dc) {
  if (checkTotal >= dc) {
    return { success: true, triggered: false, breakdown: `Disable Device ${checkTotal} vs DC ${dc} — success` };
  }
  if (checkTotal <= dc - 5) {
    return { success: false, triggered: true, breakdown: `Disable Device ${checkTotal} vs DC ${dc} — failed by 5+, trap may trigger!` };
  }
  return { success: false, triggered: false, breakdown: `Disable Device ${checkTotal} vs DC ${dc} — failed, no result` };
}

// Lock DCs (CRB p. 95)
export const LOCK_DCS = {
  'simple': 20,
  'average': 25,
  'good': 30,
  'superior': 40,
};

// ─────────────────────────────────────────────────────
// KNOWLEDGE: IDENTIFY CREATURES — CRB p. 99
// ─────────────────────────────────────────────────────

// Maps creature type to the Knowledge skill that identifies it (CRB p. 100)
export const CREATURE_TYPE_KNOWLEDGE = {
  'aberration': 'Knowledge (Dungeoneering)',
  'animal': 'Knowledge (Nature)',
  'construct': 'Knowledge (Arcana)',
  'dragon': 'Knowledge (Arcana)',
  'fey': 'Knowledge (Nature)',
  'humanoid': 'Knowledge (Local)',
  'magical beast': 'Knowledge (Arcana)',
  'monstrous humanoid': 'Knowledge (Dungeoneering)',
  'ooze': 'Knowledge (Dungeoneering)',
  'outsider': 'Knowledge (Planes)',
  'plant': 'Knowledge (Nature)',
  'undead': 'Knowledge (Religion)',
  'vermin': 'Knowledge (Nature)',
};

/**
 * Compute the DC + which Knowledge skill applies for identifying a given creature.
 * CRB: DC = 10 + creature's CR. Success identifies the creature; every 5 over reveals 1 additional fact.
 * Fractional CRs (1/8, 1/6, 1/4, 1/3, 1/2) are rounded up to nearest integer to keep DCs whole.
 */
export function getCreatureIdentificationCheck(creatureType, cr) {
  const skill = CREATURE_TYPE_KNOWLEDGE[(creatureType || '').toLowerCase()] || 'Knowledge (Arcana)';
  const numericCR = Number(cr) || 1;
  const dc = 10 + Math.ceil(numericCR);
  return { skill, dc, formula: `Knowledge DC = 10 + CR ${cr} = ${dc}` };
}

/**
 * Given a creature identification result, count how many extra facts the player learns.
 * One additional fact per 5 by which the check exceeds the DC.
 */
export function countCreatureFactsLearned(checkTotal, dc) {
  if (checkTotal < dc) return 0;
  return 1 + Math.floor((checkTotal - dc) / 5);
}


// ─────────────────────────────────────────────────────
// CONCENTRATION CHECKS
// ─────────────────────────────────────────────────────

/**
 * Compute concentration check.
 * Concentration = d20 + caster level + casting ability mod
 */
export function computeConcentration(character, d20Roll, conditionMods = {}) {
  const castingAbility = CASTING_ABILITY[character.class] || 'INT';
  const abilityMod = mod(character.abilities?.[castingAbility] || 10);
  const casterLevel = computeCasterLevel(character);
  const featBonus = (character.feats || []).includes('Combat Casting') ? 4 : 0;
  const condMod = conditionMods.concentration || 0;

  const total = d20Roll + casterLevel + abilityMod + featBonus + condMod;

  return {
    total,
    d20: d20Roll,
    casterLevel,
    abilityMod,
    castingAbility,
    featBonus,
    conditionMod: condMod,
    breakdown: `${d20Roll} + ${casterLevel} CL + ${abilityMod} ${castingAbility}${featBonus ? ' + 4 Combat Casting' : ''} = ${total}`,
  };
}

// Common concentration DCs
export const CONCENTRATION_DCS = {
  casting_defensively: (spellLevel) => 15 + spellLevel * 2,
  damaged_during_casting: (damageTaken, spellLevel) => 10 + damageTaken + spellLevel,
  grappled: (spellLevel) => 10 + spellLevel + 5, // CMB + spell level, simplified
  vigorous_motion: (spellLevel) => 10 + spellLevel,
  violent_motion: (spellLevel) => 15 + spellLevel,
  entangled: (spellLevel) => 15 + spellLevel,
};


// ─────────────────────────────────────────────────────
// COMBAT MANEUVERS
// ─────────────────────────────────────────────────────

/**
 * Compute CMB (Combat Maneuver Bonus).
 * CMB = BAB + STR mod + size mod
 */
export function computeCMB(character, conditionMods = {}) {
  const bab = character.bab || 0;
  const strMod = mod(character.abilities?.STR || 10);
  const sizeMod = character.size === 'Small' ? -1 : character.size === 'Large' ? 1 : 0;
  const condMod = conditionMods.cmb || 0;
  const spellStr = Math.floor((conditionMods.strBonus || 0) / 2) + Math.floor((conditionMods.strPenalty || 0) / 2);

  // Improved maneuver feats
  let featBonus = 0;
  const feats = character.feats || [];
  const improvedManeuvers = ['Improved Bull Rush', 'Improved Disarm', 'Improved Grapple',
    'Improved Overrun', 'Improved Sunder', 'Improved Trip', 'Improved Drag',
    'Improved Dirty Trick', 'Improved Reposition', 'Improved Steal'];
  for (const im of improvedManeuvers) {
    if (feats.includes(im)) { featBonus = 2; break; }
  }

  return {
    total: bab + strMod + sizeMod + condMod + featBonus + spellStr,
    bab,
    strMod,
    sizeMod,
    conditionMod: condMod,
    featBonus,
    spellAbilityMod: spellStr,
  };
}

/**
 * Compute CMD (Combat Maneuver Defense).
 * CMD = 10 + BAB + STR + DEX + size mod
 */
export function computeCMD(character, conditionMods = {}, maneuverType = '') {
  const bab = character.bab || 0;
  const strMod = mod(character.abilities?.STR || 10);
  const dexMod = mod(character.abilities?.DEX || 10);
  const sizeMod = character.size === 'Small' ? -1 : character.size === 'Large' ? 1 : 0;
  const condMod = conditionMods.cmd || 0;
  const dodge = character.dodgeBonus || 0;
  const deflection = Math.max(character.deflectionBonus || 0, conditionMods.deflectionBonus || 0);
  const spellStr = Math.floor((conditionMods.strBonus || 0) / 2) + Math.floor((conditionMods.strPenalty || 0) / 2);
  const spellDex = Math.floor((conditionMods.dexBonus || 0) / 2) + Math.floor((conditionMods.dexPenalty || 0) / 2);

  // Racial Stability bonus (e.g., Dwarf +4 CMD vs bull rush/trip)
  let stabilityBonus = 0;
  const stability = character.racialCombatBonuses?.stability;
  if (stability && maneuverType) {
    if (stability.vsManeuvers.some(m => maneuverType.toLowerCase().includes(m))) {
      stabilityBonus = stability.cmdBonus;
    }
  }

  return {
    total: 10 + bab + strMod + dexMod + sizeMod + condMod + dodge + deflection + spellStr + spellDex + stabilityBonus,
    base: 10,
    bab,
    strMod,
    dexMod,
    sizeMod,
    conditionMod: condMod,
    dodge,
    deflection,
    spellAbilityMod: spellStr + spellDex,
    stabilityBonus,
  };
}


// ─────────────────────────────────────────────────────
// ACTION ECONOMY
// ─────────────────────────────────────────────────────

/**
 * PF1e action types and what they cost.
 */
export const ACTION_COSTS = {
  // Standard actions
  attack: 'standard',
  castSpell: 'standard',           // Most spells
  totalDefense: 'standard',
  activateItem: 'standard',
  aidAnother: 'standard',
  bull_rush: 'standard',           // Without Improved
  disarm: 'standard',
  grapple: 'standard',
  overrun: 'standard',
  sunder: 'standard',
  trip: 'standard',
  feint: 'standard',

  // Move actions
  move: 'move',
  drawWeapon: 'move',
  standUp: 'move',
  loadCrossbow: 'move',            // Light crossbow
  directSpell: 'move',

  // Full-round actions
  fullAttack: 'full-round',
  charge: 'full-round',
  withdrawAction: 'full-round',    // PF1e: Withdraw is full-round
  runAction: 'full-round',
  castFullRoundSpell: 'full-round',
  coup_de_grace: 'full-round',

  // Swift actions (1 per round)
  swiftCast: 'swift',

  // Free actions (unlimited but reasonable)
  dropItem: 'free',
  speak: 'free',
  fiveFootStep: 'free',            // Cannot take if you've moved

  // Immediate actions (1 per round, uses next round's swift)
  immediate: 'immediate',
};

/**
 * Check if a character has the action economy to perform an action.
 * @param {object} turnState - { standard: bool, move: bool, fullRound: bool, swift: bool, moved: bool }
 * @param {string} actionType - Key from ACTION_COSTS
 * @returns {{ allowed, reason, actionCost }}
 */
export function canPerformAction(turnState, actionType) {
  const cost = ACTION_COSTS[actionType] || 'standard';

  switch (cost) {
    case 'standard':
      if (turnState.fullRound) return { allowed: false, reason: 'Already used full-round action', actionCost: cost };
      if (turnState.standard) return { allowed: false, reason: 'Already used standard action', actionCost: cost };
      return { allowed: true, reason: '', actionCost: cost };

    case 'move':
      if (turnState.fullRound) return { allowed: false, reason: 'Already used full-round action', actionCost: cost };
      if (turnState.move) {
        // Can convert standard to move if standard not spent
        if (!turnState.standard) return { allowed: true, reason: 'Using standard action as extra move', actionCost: 'standard-as-move' };
        return { allowed: false, reason: 'Already used both move and standard actions', actionCost: cost };
      }
      return { allowed: true, reason: '', actionCost: cost };

    case 'full-round':
      if (turnState.standard || turnState.move || turnState.fullRound) {
        return { allowed: false, reason: 'Full-round action requires unused standard and move actions', actionCost: cost };
      }
      return { allowed: true, reason: '', actionCost: cost };

    case 'swift':
      if (turnState.swift) return { allowed: false, reason: 'Already used swift action this round', actionCost: cost };
      return { allowed: true, reason: '', actionCost: cost };

    case 'free':
      // Five-foot step special rule
      if (actionType === 'fiveFootStep' && turnState.moved) {
        return { allowed: false, reason: 'Cannot 5-foot step after moving', actionCost: cost };
      }
      return { allowed: true, reason: '', actionCost: cost };

    case 'immediate':
      if (turnState.swift) return { allowed: false, reason: 'Immediate action uses your next swift action', actionCost: cost };
      return { allowed: true, reason: '', actionCost: cost };

    default:
      return { allowed: true, reason: '', actionCost: cost };
  }
}


// ─────────────────────────────────────────────────────
// VALIDATION SUMMARY (for DM engine context)
// ─────────────────────────────────────────────────────

/**
 * Generate a rules summary for a character that can be passed to the AI DM.
 * Includes saves, proficiency issues, active conditions, and key modifiers.
 *
 * Phase 7.6: accepts optional worldState so the familiar range gate and
 * master-bonus aggregation propagate into the AI DM rules summary. When
 * worldState is omitted, behavior matches 7.3/7.5 (familiar assumed with
 * master).
 */
export function generateRulesSummary(character, conditionMods = null, worldState = undefined) {
  // If no mods passed, compute them from the character's conditions + active effects
  const mods = conditionMods || getCharacterModifiers(character, worldState);
  const fort = computeSave(character, 'Fort', mods);
  const ref = computeSave(character, 'Ref', mods);
  const will = computeSave(character, 'Will', mods);

  const profIssues = getAllProficiencyIssues(character);
  const cmb = computeCMB(character, mods);
  const cmd = computeCMD(character, mods);
  const casterLevel = computeCasterLevel(character);

  const summary = {
    saves: { Fort: fort.total, Ref: ref.total, Will: will.total },
    savesDetailed: { Fort: fort, Ref: ref, Will: will },
    proficiencyIssues: profIssues,
    cmb: cmb.total,
    cmd: cmd.total,
    casterLevel,
    hasProficiencyPenalties: profIssues.length > 0,
  };

  // Text version for AI prompt
  summary.text = [
    `Saves: Fort +${fort.total}, Ref +${ref.total}, Will +${will.total}`,
    `CMB +${cmb.total}, CMD ${cmd.total}`,
    casterLevel > 0 ? `Caster Level ${casterLevel}` : '',
    profIssues.length > 0 ? `PROFICIENCY WARNINGS: ${profIssues.map(i => i.reason).join('; ')}` : '',
  ].filter(Boolean).join(' | ');

  return summary;
}

// ═════════════════════════════════════════════════════════════════════
// CHAPTER 4 — INDIVIDUAL SKILL MECHANICS (alphabetical)
// All resolvers below take pre-computed check totals so they're easily
// composable with the existing resolveSkillCheck/Take 10/Take 20 helpers.
// Each returns { success, ...details, breakdown } for UI/log display.
// ═════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────
// ACROBATICS — CRB p. 87
// ─────────────────────────────────────────────────────

// CRB p.87 Acrobatics balance table — DC by surface WIDTH.
// Width values are in INCHES so that procedural location generators can pass
// numeric dimensions directly. Pass `widthInches` to resolveAcrobaticsBalance
// (preferred) or use one of the named labels below for back-compat.
export const ACROBATICS_BALANCE_WIDTH_DCS = [
  { minInches: 36,  dc: 0  }, // > 3 ft wide — no check needed
  { minInches: 12,  dc: 5  }, // 1-3 ft wide
  { minInches: 7,   dc: 10 }, // 7-11 in
  { minInches: 2,   dc: 15 }, // 2-6 in
  { minInches: 0,   dc: 20 }, // < 2 in (tightrope, edge of a blade)
];

// Back-compat name → effective width-in-inches mapping.
// Used by string callers; prefer widthInches when possible.
export const ACROBATICS_SURFACE_DCS = {
  'uneven floor': 5,                       // not technically a width row — minor obstacle
  'hewn stone floor': 10,                  // ditto
  'wooden beam (7+ inch wide)': 10,        // 7-11 in row
  'narrow surface (1 ft wide)': 5,         // 1-3 ft row
  'narrow surface': 15,                    // generic "narrow" → 2-6 in
  'rope/branch': 20,                       // <2 in equivalent
  'narrow ledge (less than 1 ft)': 15,     // 2-6 in row
  'tightrope (1 inch)': 20,                // <2 in row
};

function dcForWidthInches(inches) {
  if (typeof inches !== 'number' || !Number.isFinite(inches) || inches < 0) {
    return null; // signals "invalid width" to caller
  }
  for (const row of ACROBATICS_BALANCE_WIDTH_DCS) {
    if (inches >= row.minInches) return row.dc;
  }
  return 20;
}

// Tumble through enemy threatened squares (CRB p. 87)
// Base DC 15 for moving through a threatened square, DC 25 for moving through
// an enemy's actual occupied square. +2 per additional enemy past the first.
// Tumbling at greater than half speed adds +10 to the DC.
export function resolveAcrobaticsTumble(checkTotal, opts = {}) {
  // Per CRB: through a threatened square = DC 15, through an enemy's actual
  // occupied square = DC 25. The +10 difference is the rule, not a flat
  // modifier on top of the threatened-square baseline.
  const baseDC = opts.throughEnemySquare ? 25 : 15;
  // Input validation: enemyCount must be a non-negative INTEGER. Fractional
  // enemies are nonsensical (you can't tumble past 1.5 enemies) and would
  // produce non-integer DCs from the +2-per-extra-enemy formula.
  const rawEnemyCount = opts.enemyCount;
  if (rawEnemyCount != null && (
    typeof rawEnemyCount !== 'number' ||
    !Number.isFinite(rawEnemyCount) ||
    rawEnemyCount < 0 ||
    !Number.isInteger(rawEnemyCount)
  )) {
    return {
      success: false,
      impossible: true,
      dc: null,
      enemyCount: rawEnemyCount,
      breakdown: `Tumble invalid — enemyCount must be a non-negative integer (got ${rawEnemyCount})`,
    };
  }
  // Zero enemies = no tumble needed (no AoOs to provoke). Short-circuit —
  // even moving through an empty enemy "square" doesn't matter if no one's
  // there to threaten you. The half-speed restriction is the cost of the
  // tumble action itself; if you're not tumbling, you're not paying it,
  // so moveSpeedFraction is always 1 here regardless of opts.fullSpeed.
  if (rawEnemyCount === 0) {
    return {
      success: true,
      dc: 0,
      enemyCount: 0,
      noCheckNeeded: true,
      moveSpeedFraction: 1,
      modifiers: [],
      breakdown: 'No tumble check needed (no enemies threatening movement path)',
    };
  }
  const enemyCount = Math.max(1, rawEnemyCount || 1);
  let dc = baseDC + (enemyCount - 1) * 2;
  const mods = [];
  // NOTE: don't push a "base DC 25 (through enemy square)" entry — the
  // breakdown header below already says "through enemy square", so listing
  // it again as a modifier double-reports the same fact and clutters the UI.
  // The base DC choice (15 vs 25) is encoded above in the baseDC ternary.
  if (enemyCount > 1) mods.push(`+${(enemyCount - 1) * 2} (${enemyCount - 1} extra enemies)`);
  if (opts.fullSpeed) {
    dc += 10;
    mods.push('+10 (moving > ½ speed)');
  }
  const success = checkTotal >= dc;
  // CRB: tumbling at greater than half speed adds +10 DC; otherwise you're
  // limited to half speed for the round.
  const moveSpeedFraction = opts.fullSpeed ? 1 : 0.5;
  // Build a header that distinguishes "past N enemies' threatened squares"
  // (DC 15 base) from "through an enemy's occupied square" (DC 25 base), and
  // pluralizes correctly for either count.
  const action = opts.throughEnemySquare ? 'through enemy square' : 'past threatened squares';
  const enemyLabel = enemyCount === 1 ? '1 enemy' : `${enemyCount} enemies`;
  return {
    success,
    dc,
    enemyCount,
    fullSpeed: !!opts.fullSpeed,
    throughEnemySquare: !!opts.throughEnemySquare,
    moveSpeedFraction,
    modifiers: mods,
    breakdown: `Acrobatics ${checkTotal} vs DC ${dc} (Tumble ${action}, ${enemyLabel}${mods.length ? `; ${mods.join(', ')}` : ''}) — ${success ? 'no AoO provoked' : 'provokes attack of opportunity'}`,
  };
}

// Move along a narrow / unstable surface (CRB p. 87 — balance variant).
// Two calling conventions:
//   resolveAcrobaticsBalance(check, { widthInches: 6, ... })   ← preferred
//   resolveAcrobaticsBalance(check, 'narrow surface', { ... }) ← back-compat
// Modifiers (CRB):
//   full speed       -5 to check (+5 DC)
//   lightObstructed  +2 DC
//   severeObstructed +5 DC
//   lightSlippery    +2 DC
//   severeSlippery   +5 DC
//   sloped           +2 DC
//   severeWeather    +5 DC (DM ruling)
// CRB does NOT add a flat DC bump for taking damage. Per PRD: "If you take
// damage while using this skill, you must immediately make another Acrobatics
// check at the same DC to avoid falling or being knocked prone." So
// `tookDamage` here is exposed as a re-check trigger, not a DC modifier —
// the caller should re-invoke this resolver with the same DC.
// Failing by 5+ on a surface less than 1 ft wide = fall.
// While balancing you are denied DEX bonus to AC unless you have 5+ ranks.
export function resolveAcrobaticsBalance(checkTotal, surfaceOrOpts, maybeOpts) {
  // Normalize the two call signatures into (label, opts).
  let label = '';
  let opts;
  if (typeof surfaceOrOpts === 'object' && surfaceOrOpts !== null) {
    opts = surfaceOrOpts;
    label = opts.label || (opts.widthInches != null ? `${opts.widthInches} in wide surface` : 'surface');
  } else {
    opts = maybeOpts || {};
    label = surfaceOrOpts || 'surface';
  }

  // Resolve the base DC: width takes precedence; otherwise look up the named surface.
  let baseDC;
  let widthInches = opts.widthInches;
  if (widthInches != null) {
    baseDC = dcForWidthInches(widthInches);
    if (baseDC === null) {
      return {
        success: false,
        impossible: true,
        dc: null,
        surface: label,
        widthInches,
        breakdown: `Balance invalid — widthInches must be a non-negative number (got ${widthInches})`,
      };
    }
  } else if (typeof surfaceOrOpts === 'string' && ACROBATICS_SURFACE_DCS[surfaceOrOpts] != null) {
    baseDC = ACROBATICS_SURFACE_DCS[surfaceOrOpts];
  } else {
    baseDC = 10;
  }

  // Short-circuit: surface is wide enough that no balance check is needed.
  // Per CRB the "denied DEX while balancing" penalty only applies while you're
  // actually balancing on a precarious surface — not while walking down a 4 ft
  // wide corridor — so we don't return that flag in this branch either.
  if (baseDC === 0) {
    return {
      success: true,
      dc: 0,
      baseDC: 0,
      surface: label,
      widthInches: widthInches ?? null,
      fall: false,
      deniedDex: false,
      moveSpeedFraction: 1,
      noCheckNeeded: true,
      modifiers: [],
      breakdown: `No balance check needed (${label} is wide enough to walk normally)`,
    };
  }

  let dc = baseDC;
  const mods = [];
  if (opts.fullSpeed)        { dc += 5; mods.push('+5 (full speed, -5 to check)'); }
  // NOTE: tookDamage is intentionally NOT a flat DC modifier. Per CRB it
  // triggers an immediate re-check at the SAME DC, surfaced via the
  // `requiresRecheck` flag below so callers know to roll again.
  // Obstructed: light and severe are mutually exclusive — severe wins.
  if (opts.severeObstructed) {
    dc += 5; mods.push('+5 (severely obstructed)');
  } else if (opts.lightObstructed) {
    dc += 2; mods.push('+2 (lightly obstructed)');
  }
  // Slippery: light and severe are mutually exclusive — severe wins.
  // (Also accept legacy `slippery` flag as an alias for severe.)
  if (opts.severeSlippery || opts.slippery) {
    dc += 5; mods.push('+5 (severely slippery)');
  } else if (opts.lightSlippery) {
    dc += 2; mods.push('+2 (lightly slippery)');
  }
  if (opts.sloped)           { dc += 2; mods.push('+2 (sloped/angled)'); }
  if (opts.severeWeather)    { dc += 5; mods.push('+5 (severe weather)'); }

  const success = checkTotal >= dc;
  // CRB: failing by 5+ on a surface narrower than 1 ft (12 in) = fall.
  // The label-regex fallback is a back-compat path for string callers; it
  // catches obviously-narrow surfaces by keyword but must EXCLUDE labels
  // that explicitly call out a 1-ft-or-wider width. Without the negative
  // check, "narrow surface (1 ft wide)" — a 12-inch surface — would match
  // the "narrow" keyword and incorrectly trigger fall-on-fail-by-5, even
  // though CRB only fails on surfaces *less than* 1 ft.
  //
  // Subtlety: a label like "narrow ledge (less than 1 ft)" ALSO contains
  // "1 ft", but in context it asserts the surface is *narrower* than 1 ft,
  // not at-least-1-ft. Without the explicit "less than" exclusion, the
  // labelClaimsWide check would incorrectly mark it as wide and skip the
  // CRB fall rule. Detect those qualifiers first and treat them as a
  // strong "this is narrow" signal.
  const labelLessThan1Ft = /(?:less\s*than|under|<)\s*(?:1\s*(?:ft|foot)|12\s*in(?:ch(?:es)?)?)/i.test(label);
  const labelClaimsWide = !labelLessThan1Ft && /(?:\b1\s*ft|\b12\s*in)/i.test(label);
  const isNarrow = (widthInches != null)
    ? widthInches < 12
    : (/narrow|tightrope|ledge|rope|branch|beam/i.test(label) && !labelClaimsWide);
  const fall = !success && (checkTotal <= dc - 5) && isNarrow;

  const acrobaticsRanks = opts.acrobaticsRanks || 0;
  const deniedDex = acrobaticsRanks < 5;

  // CRB: while balancing you move at half speed. Taking the +5 DC for full speed
  // lets you move at your full base speed for the round.
  // On failure, you stagger and lose your move (CRB).
  const moveSpeedFraction = !success ? 0 : (opts.fullSpeed ? 1 : 0.5);

  // CRB: taking damage while balancing forces a re-check at the same DC.
  // We expose this as a flag so the caller can re-invoke us with the same
  // params if the character takes damage during the same round.
  const requiresRecheck = !!opts.tookDamage;

  return {
    success,
    dc,
    baseDC,
    surface: label,
    widthInches: widthInches ?? null,
    fall,
    deniedDex,
    moveSpeedFraction,
    requiresRecheck,
    modifiers: mods,
    breakdown: `Acrobatics ${checkTotal} vs DC ${dc} (Balance on ${label}${mods.length ? `; ${mods.join(', ')}` : ''}) — ${success ? 'crosses safely' : (fall ? 'FAILS BY 5+ — falls' : 'staggers; loses move')}${deniedDex ? ' [denied DEX to AC while balancing]' : ''}${requiresRecheck ? ' [took damage — must re-check at same DC]' : ''}`,
  };
}

// Acrobatics jump rules (CRB p. 88) — high jump and long jump.
//   Long jump: DC = distance in feet (running) or 2× distance (standing).
//     Maximum: cannot jump farther than your base land speed in a single move.
//     If you fail by 4 or less, the GM may allow a Reflex DC 20 to grab the
//     far edge — that's a save, not an Acrobatics check, so it's resolved
//     by the caller, not this resolver.
//   High jump: DC = 4 × height in feet (running) or 8 × height (standing).
//     Per CRB the maximum height attained = check result ÷ 4. There is no
//     other hard cap.
// Running start requires 10+ feet of straight movement immediately before.
// Speed adjustment: +4 to the CHECK per FULL 10 ft of base speed above 30,
// -4 per FULL 10 ft below.
export function resolveLongJump(checkTotal, distanceFeet, opts = {}) {
  const runningStart = !!opts.runningStart;
  // Use nullish-coalescing so speed=0 (paralyzed, held, ability damage) is
  // honored — `|| 30` would silently turn an immobile creature into a normal
  // jumper. The downstream `distanceFeet > baseSpeed` impossible-check then
  // correctly rejects every positive-distance jump.
  let baseSpeed = opts.baseSpeed ?? 30;
  // Sanitize: NaN/Infinity baseSpeed silently disables the physical-cap
  // check below because `distanceFeet > NaN` is always false. Coerce to a
  // finite number; fall back to 30 if the value is unusable.
  if (typeof baseSpeed !== 'number') baseSpeed = Number(baseSpeed);
  if (!Number.isFinite(baseSpeed)) baseSpeed = 30;
  // Input validation
  if (typeof distanceFeet !== 'number' || !Number.isFinite(distanceFeet) || distanceFeet <= 0) {
    return {
      success: false,
      impossible: true,
      dc: null,
      distanceFeet,
      breakdown: `Long jump invalid — distance must be a positive number (got ${distanceFeet})`,
    };
  }
  // Hard physical cap
  if (distanceFeet > baseSpeed) {
    return {
      success: false,
      impossible: true,
      dc: null,
      distanceFeet,
      maxDistance: baseSpeed,
      breakdown: `Long jump ${distanceFeet} ft IMPOSSIBLE — exceeds base land speed (${baseSpeed} ft)`,
    };
  }
  const dc = runningStart ? distanceFeet : distanceFeet * 2;
  const success = checkTotal >= dc;
  // CRB p.88: failing a long jump by 4 or less lets the jumper attempt a
  // DC 20 Reflex save to grab the far edge. The Reflex save is the caller's
  // responsibility — we just expose the boundary so they know whether to
  // prompt for it.
  const failBy = success ? 0 : (dc - checkTotal);
  const nearMiss = !success && failBy <= 4;
  return {
    success,
    dc,
    distanceFeet,
    runningStart,
    failBy,
    nearMiss,
    reflexSaveToGrabEdgeDC: nearMiss ? 20 : null,
    impossible: false,
    breakdown: `Acrobatics ${checkTotal} vs DC ${dc} (Long jump ${distanceFeet} ft${runningStart ? ', running start' : ', standing'}) — ${success ? 'cleared' : (nearMiss ? `failed by ${failBy} — may attempt DC 20 Reflex to grab the far edge` : 'failed; falls if over a hazard')}`,
  };
}

export function resolveHighJump(checkTotal, heightFeet, opts = {}) {
  const runningStart = !!opts.runningStart;
  // Input validation
  if (typeof heightFeet !== 'number' || !Number.isFinite(heightFeet) || heightFeet <= 0) {
    return {
      success: false,
      impossible: true,
      dc: null,
      heightFeet,
      breakdown: `High jump invalid — height must be a positive number (got ${heightFeet})`,
    };
  }
  // CRB p.88: max high jump height = your check result ÷ 4. There is no
  // separate hard cap — high-level characters with strong Acrobatics CAN
  // jump arbitrarily high. We only sanity-check absurd inputs.
  const maxHeight = opts.maxHeight ?? 1000;
  if (heightFeet > maxHeight) {
    return {
      success: false,
      impossible: true,
      dc: null,
      heightFeet,
      maxHeight,
      breakdown: `High jump ${heightFeet} ft IMPOSSIBLE — exceeds plausible vertical reach (${maxHeight} ft)`,
    };
  }
  // CRB p.88: DC = 4 × height in feet for high jump (NOT 16 × — that was a bug).
  const dcPerFoot = 4;
  const rawDC = heightFeet * dcPerFoot;
  const dc = runningStart ? rawDC : rawDC * 2;
  const success = checkTotal >= dc;
  // Derive the height the character actually attains by inverting the DC
  // formula. Running-start high jump uses DC = 4 × height, so the inverse
  // is check ÷ 4. Standing high jump doubles the DC (8 × height), so the
  // inverse is check ÷ 8 — without this branch, standing reach is over-
  // reported by 2×. Clamp at 0 to avoid negative heights from penalty rolls.
  const dcMultiplier = runningStart ? 4 : 8;
  const maxReachedFromCheck = Math.max(0, Math.floor(checkTotal / dcMultiplier));
  return {
    success,
    dc,
    heightFeet,
    runningStart,
    maxReachedFromCheck,
    impossible: false,
    breakdown: `Acrobatics ${checkTotal} vs DC ${dc} (High jump ${heightFeet} ft${runningStart ? ', running start' : ', standing'}) — ${success ? `reached (max from check: ${maxReachedFromCheck} ft)` : 'fell short'}`,
  };
}

// Speed adjustment to jump checks (CRB p. 88).
// +4 to the check per FULL 10 ft of base speed above 30, -4 per FULL 10 ft below.
// Sub-10 differences round toward zero (speed 25 = 0, not -4).
export function getJumpSpeedMod(baseSpeed) {
  // Nullish-coalesce so speed=0 yields the full -12 penalty rather than
  // falling back to the 30 ft default. Callers who actually want the default
  // for "missing field" should pass undefined, not 0.
  let speed = baseSpeed ?? 30;
  // Coerce strings ("40") to numbers — but reject NaN/Infinity. Without this
  // guard, NaN poisons every downstream check total via `total + NaN = NaN`,
  // which silently turns the entire jump-check pipeline into a guaranteed
  // failure with no diagnostic. Treat any non-finite input as the default 30.
  if (typeof speed !== 'number') speed = Number(speed);
  if (!Number.isFinite(speed)) speed = 30;
  const diff = speed - 30;
  const sign = Math.sign(diff);
  return sign * Math.floor(Math.abs(diff) / 10) * 4;
}

// Stand from prone without provoking attacks of opportunity (CRB p. 88).
// Standing from prone is normally a move action that provokes; with an
// Acrobatics check (DC 35) you stand as a free action without provoking.
export function resolveStandFromProne(checkTotal) {
  const dc = 35;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Acrobatics ${checkTotal} vs DC ${dc} (Stand from prone, no AoO) — ${success ? 'stands as free action without provoking' : 'must stand normally (move action, provokes)'}`,
  };
}

// Acrobatics dodge AC bonus when fighting defensively / total defense (CRB p. 87).
// With 3+ ranks in Acrobatics:
//   • Fighting defensively: +3 dodge AC instead of the normal +2
//   • Total defense:        +6 dodge AC instead of the normal +4
// Returns the dodge bonus the character should receive in the given stance,
// or 0 if not in either stance.
export function getAcrobaticsDefensiveDodge(acrobaticsRanks, stance) {
  const ranks = acrobaticsRanks || 0;
  const trained = ranks >= 3;
  switch (stance) {
    case 'fightingDefensively':
      return trained ? 3 : 2;
    case 'totalDefense':
      return trained ? 6 : 4;
    default:
      return 0;
  }
}

// Soft fall — reduce fall damage (CRB p. 88).
// DC 15: treat the fall as 10 ft shorter for damage purposes.
// CRB rule: if you have fewer than 5 ranks in Acrobatics, you can only soft-fall
// from a height up to your base land speed in feet. With 5+ ranks, no height limit.
export function resolveSoftFall(checkTotal, fallDistance, opts = {}) {
  const dc = 15;
  // Input validation: fall distance must be a non-negative finite number.
  if (typeof fallDistance !== 'number' || !Number.isFinite(fallDistance) || fallDistance < 0) {
    return {
      success: false,
      ineligible: true,
      dc,
      fallDistance,
      effectiveFall: fallDistance,
      reducedBy: 0,
      breakdown: `Soft fall invalid — fallDistance must be a non-negative number (got ${fallDistance})`,
    };
  }
  // Short-circuit: a 0 ft fall is not a fall. There's nothing to soften and
  // no DC 15 check is meaningful. Return early with noFall=true so callers
  // can skip rolling and skip the damage prompt entirely.
  if (fallDistance === 0) {
    return {
      success: true,
      dc,
      fallDistance: 0,
      effectiveFall: 0,
      reducedBy: 0,
      ineligible: false,
      noFall: true,
      breakdown: 'No soft-fall check needed (fall distance is 0 ft)',
    };
  }
  const acrobaticsRanks = opts.acrobaticsRanks || 0;
  // Nullish-coalesce: a creature with speed 0 should NOT get a 30 ft soft-fall
  // cap as if they were a normal walker. Without 5+ ranks, their cap is 0 ft.
  let baseSpeed = opts.baseSpeed ?? 30;
  // Sanitize: NaN/Infinity baseSpeed silently disables the cap check below
  // because `fallDistance > NaN` is always false. Coerce to a finite number;
  // fall back to 30 if the value is unusable.
  if (typeof baseSpeed !== 'number') baseSpeed = Number(baseSpeed);
  if (!Number.isFinite(baseSpeed)) baseSpeed = 30;
  const heightCap = acrobaticsRanks >= 5 ? Infinity : baseSpeed;
  if (fallDistance > heightCap) {
    return {
      success: false,
      ineligible: true,
      dc,
      fallDistance,
      effectiveFall: fallDistance,
      reducedBy: 0,
      breakdown: `Soft fall not allowed — fall of ${fallDistance} ft exceeds your base land speed (${baseSpeed} ft) and you have fewer than 5 ranks in Acrobatics`,
    };
  }
  const success = checkTotal >= dc;
  // Cap the actual reduction at the fall distance so a 5 ft soft-fall
  // doesn't claim it shaved 10 ft off the fall.
  const reducedBy = success ? Math.min(10, fallDistance) : 0;
  const effectiveFall = Math.max(0, fallDistance - reducedBy);
  return {
    success,
    dc,
    fallDistance,
    effectiveFall,
    reducedBy,
    ineligible: false,
    breakdown: `Acrobatics ${checkTotal} vs DC ${dc} (Soft fall, ${fallDistance} ft) — ${success ? `treated as ${effectiveFall} ft for damage` : 'full fall damage'}`,
  };
}

// ─────────────────────────────────────────────────────
// APPRAISE — CRB p. 89-90 (5th printing, verified against the PDF)
// ─────────────────────────────────────────────────────
// CRB verbatim (condensed):
//
//   Check: A DC 20 Appraise check determines the value of a common item. If
//   you succeed by 5 or more, you also determine if the item has magic
//   properties, although this success does not grant knowledge of the magic
//   item's abilities. If you fail the check by less than 5, you determine
//   the price of that item to within 20% of its actual value. If you fail
//   by 5 or more, the price is wildly inaccurate, subject to GM discretion.
//   Particularly rare or exotic items might increase the DC by 5 or more.
//
//   You can also use this check to determine the most valuable item visible
//   in a treasure hoard. The DC is generally 20 but can increase to as high
//   as 30 for a particularly large hoard.
//
//   Action: Appraising an item takes 1 standard action. Determining the
//   most valuable object in a treasure hoard takes 1 full-round action.
//
//   Try Again: Additional attempts to Appraise an item reveal the same
//   result.
//
//   Special: A spellcaster with a raven familiar gains a +3 bonus on
//   Appraise checks.
//
// Additional CRB rules from Equipment/Feats chapters (kept from pass 15):
//   - Magnifying glass +2 on small or highly detailed items (gems, etc.).
//   - Merchant's scale +2 on items valued by weight (coin lots, metals).
//   - Diligent feat +2.
//   These bonuses all stack with each other.
//
// Audit trail:
//   Pass 15 wrongly used DC 12 + 2d6+3 × 10% (D&D 3e, not PF1e).
//   Pass 16 restored DC 20 but wrongly removed the failure gradient and the
//   treasure-hoard mode (both CRB canonical — verified against the PDF).
//   Pass 17 adds the failure gradient, hoard mode, raven familiar, retry &
//   action metadata.
export function resolveAppraise(checkTotal, opts = {}) {
  const isHoard = !!opts.hoard;
  const itemRarity = opts.rarity || 'common'; // common | rare | exotic | magical

  // Default DC resolution:
  //   - opts.dc override always wins (caller-provided GM DC).
  //   - Hoard mode: DC 20 default (CRB says "generally 20", up to 30 for
  //     particularly large hoards — callers raise with opts.dc).
  //   - Otherwise rarity table: common 20, rare/exotic/magical 25 (common +5,
  //     the CRB floor for "rare or exotic items").
  let baseDC;
  if (opts.dc != null && Number.isFinite(opts.dc)) {
    baseDC = opts.dc;
  } else if (isHoard) {
    baseDC = 20;
  } else {
    const defaultDcByRarity = { common: 20, rare: 25, exotic: 25, magical: 25 };
    baseDC = defaultDcByRarity[itemRarity] ?? 20;
  }

  // Equipment / feat / familiar bonuses (all stack per CRB).
  let equipBonus = 0;
  const bonusNotes = [];
  if (opts.magnifyingGlass && opts.smallOrDetailed) {
    equipBonus += 2;
    bonusNotes.push('magnifying glass +2');
  }
  if (opts.merchantScale && opts.valuedByWeight) {
    equipBonus += 2;
    bonusNotes.push("merchant's scale +2");
  }
  if (opts.diligent) {
    equipBonus += 2;
    bonusNotes.push('Diligent +2');
  }
  if (opts.ravenFamiliar) {
    equipBonus += 3;
    bonusNotes.push('raven familiar +3');
  }

  const effectiveCheck = checkTotal + equipBonus;
  const diff = effectiveCheck - baseDC; // positive = success
  const success = diff >= 0;

  // Success by 5 or more determines whether the item has magic properties,
  // but NOT what those properties are (that's Spellcraft).
  const detectsMagic = success && diff >= 5;

  // Failure gradient:
  //   diff in (-5, 0)  → within 20% of actual value
  //   diff <= -5       → wildly inaccurate (GM discretion)
  const failsByLessThan5 = !success && diff > -5;
  const failsBy5OrMore = !success && diff <= -5;
  const estimateAccuracyPct = failsByLessThan5 ? 20 : null;

  // Action cost: item = 1 standard action; hoard = 1 full-round action.
  const action = isHoard ? 'full-round' : 'standard';

  // Build a readable breakdown.
  const checkStr = equipBonus > 0
    ? `${checkTotal}${equipBonus >= 0 ? '+' : ''}${equipBonus} = ${effectiveCheck}`
    : `${effectiveCheck}`;
  const bonusSuffix = bonusNotes.length ? ` [${bonusNotes.join(', ')}]` : '';
  const contextLabel = isHoard ? 'treasure hoard' : itemRarity;
  let outcome;
  if (isHoard && success) {
    outcome = 'identifies the most valuable item visible in the hoard';
  } else if (success && detectsMagic) {
    outcome = 'determines value; also senses magic presence (not the specific magic properties — use Spellcraft)';
  } else if (success) {
    outcome = 'determines the exact value';
  } else if (failsByLessThan5) {
    outcome = 'estimates price within 20% of actual value';
  } else {
    outcome = 'price is wildly inaccurate (GM discretion)';
  }

  return {
    success,
    dc: baseDC,
    rarity: itemRarity,
    hoard: isHoard,
    equipBonus,
    effectiveCheck,
    detectsMagic,
    failsByLessThan5,
    failsBy5OrMore,
    estimateAccuracyPct,
    bonusNotes,
    action,
    retry: 'reveals-same-result',
    breakdown: `Appraise ${checkStr} vs DC ${baseDC} (${contextLabel})${bonusSuffix} — ${outcome}`,
  };
}

// ─────────────────────────────────────────────────────
// CLIMB — CRB p. 90-91 (5th Printing)
// ─────────────────────────────────────────────────────
// Keys are lowercased lookup tokens; values are base DCs. Value `null`
// denotes "cannot be climbed" (perfectly smooth flat surfaces).
export const CLIMB_SURFACE_DCS = {
  // DC 0: slope too steep to walk up, OR knotted rope WITH wall to brace
  'slope': 0,
  'knotted rope with wall': 0,
  // DC 5: rope with wall brace, knotted rope (no wall), rope-trick spell rope
  'rope with wall to brace': 5,
  'knotted rope': 5,
  'rope trick spell': 5,
  // DC 10: surface with ledges (very rough wall, ship's rigging)
  'surface with ledges': 10,
  'ship rigging': 10,
  'rough wall': 10,
  // DC 15: adequate handholds AND footholds — natural or artificial. Examples
  // include very rough natural rock, a tree, an unknotted rope, OR pulling
  // yourself up when dangling by your hands.
  'adequate handholds': 15,
  'tree': 15,
  'unknotted rope': 15,
  'dangling hands pull-up': 15,
  // DC 20: uneven surface with narrow handholds/footholds (typical dungeon wall)
  'dungeon wall': 20,
  'narrow handholds': 20,
  // DC 25: rough surface — natural rock wall or brick wall
  'natural rock wall': 25,
  'brick wall': 25,
  // DC 30: overhang or ceiling with handholds only
  'overhang': 30,
  'ceiling (with handholds)': 30,
  // Impossible: perfectly smooth, flat vertical (or inverted) surface
  'perfectly smooth flat surface': null,
};

// Cumulative modifiers applied to the surface base DC (CRB p. 91).
// Use all that apply — a slippery corner would be −5 + +5 = 0 net.
export const CLIMB_DC_MODIFIERS = {
  chimney: -10, // bracing between two opposite walls (artificial or natural)
  corner: -5,   // bracing against perpendicular walls
  slippery: +5,
};

/**
 * Apply cumulative surface modifiers to a base climb DC.
 * `modifiers` can be an array of keys (['chimney','slippery']) or an object
 * ({ chimney: true, slippery: true }). Unknown keys are ignored silently.
 * Returns null if baseDc is null (impossible surface stays impossible).
 */
export function applyClimbModifiers(baseDc, modifiers) {
  if (baseDc === null || baseDc === undefined) return null;
  if (!modifiers) return baseDc;
  const keys = Array.isArray(modifiers)
    ? modifiers
    : Object.keys(modifiers).filter(k => modifiers[k]);
  let total = baseDc;
  for (const k of keys) {
    const delta = CLIMB_DC_MODIFIERS[k];
    if (Number.isFinite(delta)) total += delta;
  }
  return total;
}

/**
 * Primary climb resolution — CRB p. 90-91.
 * Movement: default 1/4 speed. Accelerated: 1/2 speed at −5 to check.
 * Failure by 4 or less → no progress but holds position.
 * Failure by 5+ → fall from current height.
 *
 * opts: {
 *   accelerated: bool,      // −5 check for 1/2 speed (normal climbers)
 *   modifiers: [...],       // surface modifiers (chimney/corner/slippery)
 *   hasClimbSpeed: bool,    // creature has a climb speed (see below)
 * }
 *
 * Climb-speed creatures (CRB p. 91) always may take 10 even if rushed or
 * threatened, and their "accelerated" variant works differently: 2× climb
 * speed (or land speed, whichever is slower), single Climb check at −5.
 * That movement-rate logic lives in the caller; this helper only reports
 * the −5 check application.
 */
export function resolveClimb(checkTotal, dc, opts = {}) {
  const accelerated = !!opts.accelerated;
  const modifiers = opts.modifiers || [];
  const hasClimbSpeed = !!opts.hasClimbSpeed;
  const effectiveDc = applyClimbModifiers(dc, modifiers);
  if (effectiveDc === null) {
    return {
      success: false,
      dc: null,
      accelerated,
      fell: false,
      impossible: true,
      breakdown: 'Climb impossible — perfectly smooth, flat surface cannot be climbed.',
    };
  }
  const effectiveCheck = accelerated ? checkTotal - 5 : checkTotal;
  const success = effectiveCheck >= effectiveDc;
  const fell = !success && effectiveCheck <= effectiveDc - 5;
  const modStr = modifiers.length ? ` (modifiers: ${(Array.isArray(modifiers) ? modifiers : Object.keys(modifiers)).join(',')})` : '';
  const accStr = accelerated ? ' (accelerated -5)' : '';
  const climbSpeedStr = hasClimbSpeed ? ' [climb-speed creature]' : '';
  return {
    success,
    dc: effectiveDc,
    baseDc: dc,
    accelerated,
    hasClimbSpeed,
    fell,
    impossible: false,
    breakdown: `Climb ${effectiveCheck} vs DC ${effectiveDc}${modStr}${accStr}${climbSpeedStr} — ${success ? 'progress made' : (fell ? 'FELL' : 'no progress, but holds position')}`,
  };
}

/**
 * CRB p. 91: "Anytime you take damage while climbing, make a Climb check
 * against the DC of the slope or wall. Failure means you fall from your
 * current height and sustain the appropriate falling damage."
 * Unlike the normal check, any failure causes a fall — not just by 5+.
 */
export function resolveDamageWhileClimbing(checkTotal, surfaceDc) {
  const success = checkTotal >= surfaceDc;
  return {
    success,
    dc: surfaceDc,
    fell: !success,
    breakdown: `Damage-while-climbing check ${checkTotal} vs DC ${surfaceDc} — ${success ? 'held grip' : 'FELL'}`,
  };
}

/**
 * CRB p. 91: "It's practically impossible to catch yourself on a wall while
 * falling… DC = wall's DC + 20. It's much easier to catch yourself on a
 * slope (DC = slope's DC + 10)."
 * opts.isSlope flips the +20 → +10 branch.
 */
export function resolveCatchSelfFalling(checkTotal, surfaceDc, opts = {}) {
  const penalty = opts.isSlope ? 10 : 20;
  const dc = surfaceDc + penalty;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Catch self falling: ${checkTotal} vs DC ${surfaceDc}+${penalty}=${dc} — ${success ? 'caught grip' : 'fell'}`,
  };
}

/**
 * CRB p. 91: "If someone climbing above you or adjacent to you falls, you
 * can attempt to catch the falling character if he or she is within your
 * reach. Doing so requires a successful melee touch attack… If you hit,
 * you must immediately attempt a Climb check (DC = wall's DC + 10). Success
 * indicates that you catch the falling character, but his total weight,
 * including equipment, cannot exceed your heavy load limit or you
 * automatically fall. If you fail your Climb check by 4 or less, you fail to
 * stop the character's fall but don't lose your grip on the wall. If you
 * fail by 5 or more, you fail to stop the character's fall and begin falling
 * as well."
 *
 * Two-step resolution: pass the touch-attack outcome + the climb check total.
 * Weight limits are the caller's responsibility when known (pass
 * `catcherHeavyLoad` + `fallenWeight` for auto-check).
 */
export function resolveCatchFallingCharacter({
  touchAttackHit,
  climbCheckTotal,
  wallDc,
  catcherHeavyLoad = null,
  fallenWeight = null,
}) {
  if (!touchAttackHit) {
    return {
      success: false,
      catcherFalls: false,
      reason: 'touch attack missed',
      breakdown: 'Catch falling character — touch attack missed; character continues to fall.',
    };
  }
  const dc = wallDc + 10;
  const margin = climbCheckTotal - dc;
  const success = margin >= 0;
  const catcherFalls = !success && margin <= -5;
  // Weight check: even on a successful catch, if fallen weight exceeds
  // catcher's heavy load, the catcher automatically falls.
  let overloaded = false;
  if (success && catcherHeavyLoad !== null && fallenWeight !== null) {
    overloaded = fallenWeight > catcherHeavyLoad;
  }
  return {
    success: success && !overloaded,
    catcherFalls: catcherFalls || overloaded,
    overloaded,
    dc,
    margin,
    breakdown: overloaded
      ? `Catch falling character — Climb ${climbCheckTotal} vs DC ${dc} succeeded, but fallen weight ${fallenWeight} exceeds heavy load ${catcherHeavyLoad}: catcher falls too.`
      : `Catch falling character — Climb ${climbCheckTotal} vs DC ${dc} — ${success ? 'caught' : (catcherFalls ? 'missed (caught fall too, fell with them)' : 'missed (kept grip)')}`,
  };
}

// ─────────────────────────────────────────────────────
// CRAFT — CRB p. 91-93 (5th Printing), Table 4-4
// ─────────────────────────────────────────────────────
// Progress per successful check = check result × DC, in silver pieces.
// Item completes when cumulative progress (sp) ≥ item price in sp.
// Failure by 4 or less → no progress this week.
// Failure by 5 or more → no progress AND half raw materials ruined.
// Raw material cost = 1/3 of item price (paid up front, before crafting).

// CRB Table 4-4 lookup — flat item-type → DC mapping. For armor/shield use
// `getCraftArmorDC(acBonus)` and for composite bows with STR rating use
// `getCraftCompositeBowDC(strRating)`.
export const CRAFT_ITEM_DCS = {
  // Generic complexity tiers (non-weapon/armor items)
  'very simple item': 5,    // wooden spoon
  'typical item': 10,       // iron pot
  'high-quality item': 15,  // bell
  'complex item': 20,       // lock — CRB "complex or superior"
  'superior item': 20,
  // Weapons (Craft: weapons)
  'simple weapon': 12,      // simple melee or thrown
  'crossbow': 15,
  'bolts': 15,
  'martial weapon': 15,
  'exotic weapon': 18,
  // Bows (Craft: bows)
  'longbow': 12,
  'shortbow': 12,
  'arrows': 12,
  'composite longbow': 15,
  'composite shortbow': 15,
  // Alchemy (Craft: alchemy)
  'acid': 15,
  "alchemist's fire": 20,
  'smokestick': 20,
  'tindertwig': 20,
  'antitoxin': 25,
  'sunrod': 25,
  'tanglefoot bag': 25,
  'thunderstone': 25,
  // Masterwork component (separate progress track from the base item)
  'masterwork component': 20,
};

// Back-compat shape — old callers used getCraftItemDC. Returns null for
// unknown types so the caller can branch (armor / composite bow / trap) or
// default explicitly rather than silently picking 15.
export function getCraftItemDC(itemType) {
  const key = (itemType || '').toLowerCase();
  const dc = CRAFT_ITEM_DCS[key];
  return dc === undefined ? null : dc;
}

/**
 * Armor and shield: CRB Table 4-4 "Armor or shield" entry is "10 + AC bonus".
 * Examples: leather (+2) → 12, studded leather (+3) → 13, chain shirt (+4) → 14,
 * breastplate (+6) → 16, half-plate (+8) → 18, full plate (+9) → 19.
 * Shields: buckler (+1) → 11, light (+1) → 11, heavy (+2) → 12, tower (+4) → 14.
 */
export function getCraftArmorDC(acBonus) {
  if (!Number.isFinite(acBonus) || acBonus < 0) return null;
  return 10 + acBonus;
}

/**
 * Composite bow with a high STR rating: DC = 15 + (2 × rating).
 * Rating-3 composite longbow → DC 21; rating-5 → DC 25. Base composite
 * (rating 0) → DC 15.
 */
export function getCraftCompositeBowDC(strRating = 0) {
  const r = Number(strRating) || 0;
  return 15 + 2 * r;
}

/**
 * Tool modifiers for any Craft check (CRB p. 92).
 * - improvised tools: -2 penalty to the check
 * - masterwork artisan's tools: +2 circumstance bonus to the check
 * - alchemist's lab: +2 circumstance on Craft (alchemy) only (caller-gated)
 * These modify the check, not the DC.
 */
export function applyCraftToolModifiers(checkTotal, opts = {}) {
  let total = checkTotal;
  const notes = [];
  if (opts.improvisedTools) { total -= 2; notes.push('improvised -2'); }
  if (opts.masterworkTools) { total += 2; notes.push('masterwork tools +2'); }
  if (opts.alchemistLab) { total += 2; notes.push("alchemist's lab +2"); }
  return { total, notes };
}

/**
 * CRB Special (p. 93): voluntary +10 DC for faster crafting. Per-check
 * choice; caller decides each week/day.
 */
export function applyCraftAccelerate(baseDc, accelerate = false) {
  if (!Number.isFinite(baseDc)) return baseDc;
  return accelerate ? baseDc + 10 : baseDc;
}

/**
 * Raw material cost — CRB p. 92 step 3: "Pay 1/3 of the item's price for
 * the raw material cost."
 */
export function getCraftRawMaterialCost(itemPriceGP) {
  return (itemPriceGP || 0) / 3;
}

/**
 * Weekly-progress resolution (CRB p. 92).
 * Progress = check × DC (in sp) ONLY on a successful check.
 * Any failure → zero progress this week. Fail by 5+ additionally wastes
 * half the raw materials (caller must charge half the raw cost again to
 * continue).
 *
 * opts:
 *   accelerated: bool — voluntary +10 DC
 *   toolMods: { improvisedTools?, masterworkTools?, alchemistLab? }
 */
export function resolveCraftProgressWeekly(checkTotal, itemDC, itemPriceGP, opts = {}) {
  const itemPriceSP = Math.round((itemPriceGP || 0) * 10);
  const toolResult = applyCraftToolModifiers(checkTotal, opts.toolMods || {});
  const effectiveCheck = toolResult.total;
  const effectiveDc = applyCraftAccelerate(itemDC, opts.accelerated);
  const success = effectiveCheck >= effectiveDc;
  const margin = effectiveCheck - effectiveDc;
  const failedByFive = !success && margin <= -5;
  // Per CRB: progress only on success. Failure by any amount = no progress
  // this week. Failure by 5+ additionally ruins half the raw materials.
  const progressSP = success ? effectiveCheck * effectiveDc : 0;
  const finished = success && progressSP >= itemPriceSP;
  const toolNote = toolResult.notes.length ? ` [${toolResult.notes.join(', ')}]` : '';
  const accNote = opts.accelerated ? ' (accelerated +10 DC)' : '';
  return {
    progressSP,
    progressGP: progressSP / 10,
    itemPriceSP,
    success,
    finished,
    failedByFive,
    materialsLost: failedByFive,
    effectiveCheck,
    effectiveDc,
    breakdown: success
      ? `Craft check ${effectiveCheck}${toolNote} × DC ${effectiveDc}${accNote} = ${progressSP} sp (item ${itemPriceSP} sp). ${finished ? 'COMPLETE.' : 'Progress logged.'}`
      : `Craft check ${effectiveCheck}${toolNote} vs DC ${effectiveDc}${accNote} — FAILED by ${-margin}. No progress this week.${failedByFive ? ' Half raw materials ruined!' : ''}`,
  };
}

/**
 * Daily-progress variant (CRB p. 93 "Progress by the Day"). Divides weekly
 * progress by 7 — same success/failure rules.
 */
export function resolveCraftProgressDaily(checkTotal, itemDC, itemPriceGP, opts = {}) {
  const weekly = resolveCraftProgressWeekly(checkTotal, itemDC, itemPriceGP, opts);
  const progressSP = Math.floor(weekly.progressSP / 7);
  const finished = weekly.success && progressSP >= weekly.itemPriceSP;
  return {
    ...weekly,
    progressSP,
    progressGP: progressSP / 10,
    finished,
    breakdown: weekly.success
      ? `Craft (daily) check ${weekly.effectiveCheck} × DC ${weekly.effectiveDc} / 7 = ${progressSP} sp today (item ${weekly.itemPriceSP} sp). ${finished ? 'COMPLETE.' : 'Progress logged.'}`
      : weekly.breakdown.replace('this week', 'today'),
  };
}

/**
 * Repair (CRB p. 93): same DC as creating the item; cost is 1/5 of the
 * item's price. Uses the weekly progress mechanic against the reduced
 * "repair price" (itemPriceGP / 5). Returns the computed repair cost.
 */
export function resolveCraftRepair(checkTotal, itemDC, itemPriceGP, opts = {}) {
  const repairPriceGP = (itemPriceGP || 0) / 5;
  const progress = resolveCraftProgressWeekly(checkTotal, itemDC, repairPriceGP, opts);
  return {
    ...progress,
    repairPriceGP,
    breakdown: progress.success
      ? `Repair at DC ${progress.effectiveDc}: ${progress.progressSP} sp toward ${progress.itemPriceSP} sp repair cost. ${progress.finished ? 'REPAIRED.' : 'Progress logged.'}`
      : progress.breakdown,
  };
}

/**
 * "Practice your trade" weekly side-income (CRB p. 91 first Check paragraph):
 * "you can practice your trade and make a decent living, earning half your
 * check result in gold pieces per week." No DC — only applies when the
 * crafter isn't actively progressing an item.
 */
export function resolveCraftPracticeIncome(checkTotal) {
  const gpPerWeek = Math.max(0, Math.floor(checkTotal / 2));
  return {
    gpPerWeek,
    breakdown: `Practice trade (Craft ${checkTotal}) — earns ${gpPerWeek} gp this week.`,
  };
}

// ─────────────────────────────────────────────────────
// DISGUISE — CRB p. 92
// ─────────────────────────────────────────────────────
// Opposed by Perception. Modifiers stack with the disguise check itself.
export function getDisguiseModifier(opts = {}) {
  let mod = 0;
  const notes = [];
  if (opts.minorDetail) { mod += 5; notes.push('minor detail change +5'); }
  if (opts.differentGender) { mod -= 2; notes.push('different gender -2'); }
  if (opts.differentRace) { mod -= 2; notes.push('different race -2'); }
  if (opts.differentAgeCategory) { mod -= 2; notes.push('age category shift -2'); }
  if (opts.familiarToObserver) { mod -= 4; notes.push('familiar to observer -4'); }
  if (opts.intimateRelationship) { mod -= 8; notes.push('intimate observer -8'); }
  return { mod, notes: notes.join(', ') || 'baseline' };
}

export function resolveDisguise(disguiseTotal, perceptionTotals = []) {
  // perceptionTotals is an array of opposed Perception rolls
  const beats = perceptionTotals.filter(p => disguiseTotal > p).length;
  const tied = perceptionTotals.filter(p => disguiseTotal === p).length;
  const seenThrough = perceptionTotals.filter(p => disguiseTotal < p).length;
  return {
    success: seenThrough === 0,
    beats,
    tied,
    seenThrough,
    breakdown: `Disguise ${disguiseTotal} vs ${perceptionTotals.length} Perception check(s): ${beats} fooled, ${tied} suspicious (tie), ${seenThrough} saw through (CRB ties go to disguiser)`,
  };
}

// ─────────────────────────────────────────────────────
// ESCAPE ARTIST — CRB p. 92
// ─────────────────────────────────────────────────────
export const ESCAPE_DCS = {
  rope: 20,            // +bonus from binder's CMB
  netOrAnimateRope: 20,
  snare: 23,
  manacles: 30,
  masterworkManacles: 35,
  tightSpace: 30,
};

export function resolveEscapeArtist(checkTotal, restraint, opts = {}) {
  const baseDC = ESCAPE_DCS[restraint] || 20;
  const binderBonus = restraint === 'rope' ? (opts.binderCMB || 0) : 0;
  const dc = baseDC + binderBonus;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Escape Artist ${checkTotal} vs DC ${dc} (${restraint}${binderBonus ? `, binder CMB +${binderBonus}` : ''}) — ${success ? 'escapes' : 'still bound'}`,
  };
}

// Escape from a grapple is opposed: Escape Artist vs grappler's CMD
export function resolveEscapeFromGrapple(escapeTotal, grapplerCMD) {
  const success = escapeTotal >= grapplerCMD;
  return {
    success,
    dc: grapplerCMD,
    breakdown: `Escape Artist ${escapeTotal} vs grappler CMD ${grapplerCMD} — ${success ? 'escapes the grapple' : 'still grappled'}`,
  };
}

// ─────────────────────────────────────────────────────
// FLY — CRB p. 96
// ─────────────────────────────────────────────────────
// Maneuverability: clumsy / poor / average / good / perfect
// Each affects the DC of various aerial maneuvers and minimum forward speed.
export const FLY_MANEUVERABILITY_MODS = {
  clumsy:  { mod: -8, minForward: '/2 speed' },
  poor:    { mod: -4, minForward: '/2 speed' },
  average: { mod:  0, minForward: '/2 speed' },
  good:    { mod: +4, minForward: 'none' },
  perfect: { mod: +8, minForward: 'none' },
};

export const FLY_DCS = {
  'move less than half speed': 10,
  'hover': 15,
  'turn greater than 45°': 15,
  'turn 180° (single move)': 20,
  'fly straight up': 15,
  'fly straight down': 0,
  'fly up at greater than 45°': 20,
  'avoid stall after losing speed': 20,
  'high winds (severe)': 20,
};

export function resolveFly(checkTotal, maneuver, maneuverability = 'average') {
  const baseDC = FLY_DCS[maneuver] ?? 15;
  const manData = FLY_MANEUVERABILITY_MODS[maneuverability] || FLY_MANEUVERABILITY_MODS.average;
  const adjustedCheck = checkTotal + manData.mod;
  const success = adjustedCheck >= baseDC;
  return {
    success,
    dc: baseDC,
    maneuverability,
    breakdown: `Fly ${checkTotal} ${manData.mod >= 0 ? '+' : ''}${manData.mod} (${maneuverability}) = ${adjustedCheck} vs DC ${baseDC} (${maneuver}) — ${success ? 'success' : 'fails; may stall or fall'}`,
  };
}

// ─────────────────────────────────────────────────────
// HANDLE ANIMAL — CRB p. 97
// ─────────────────────────────────────────────────────
export const HANDLE_ANIMAL_DCS = {
  'handle animal (known trick)': 10,        // standard action
  'push animal (known trick under duress)': 25,
  'teach trick': 15,                        // 1 week per trick
  'train for general purpose': 15,          // 2 months
  'rear wild animal': 15,                   // varies by HD
};

export function resolveHandleAnimal(checkTotal, task) {
  const dc = HANDLE_ANIMAL_DCS[task] ?? 15;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Handle Animal ${checkTotal} vs DC ${dc} (${task}) — ${success ? 'animal complies' : 'animal refuses or balks'}`,
  };
}

// ─────────────────────────────────────────────────────
// LINGUISTICS — CRB p. 99
// ─────────────────────────────────────────────────────
// Forgery: opposed Linguistics; reader gets +2 if familiar with handwriting,
// +5 if familiar with the document's contents, -2 if just the type of document.
export function resolveForgery(forgerTotal, readerTotal, opts = {}) {
  let readerMod = 0;
  if (opts.familiarHandwriting) readerMod += 2;
  if (opts.familiarContents) readerMod += 5;
  if (opts.unfamiliarContents) readerMod -= 2;
  const adjusted = readerTotal + readerMod;
  const fooled = forgerTotal > adjusted;
  return {
    fooled,
    breakdown: `Forgery: forger ${forgerTotal} vs reader ${readerTotal}${readerMod !== 0 ? ` (${readerMod >= 0 ? '+' : ''}${readerMod})` : ''} = ${adjusted} — ${fooled ? 'forgery accepted' : 'forgery detected'}`,
  };
}

// Decipher writing: DC 20 + 5 per language family removed from known
export function resolveDecipherScript(checkTotal, opts = {}) {
  const isMagical = !!opts.magical;
  const familiar = !!opts.relatedLanguage;
  const dc = isMagical ? 25 : (familiar ? 20 : 25);
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Linguistics ${checkTotal} vs DC ${dc} (decipher${isMagical ? ' magical' : ''} script) — ${success ? 'understands the gist' : 'cannot read'}`,
  };
}

// ─────────────────────────────────────────────────────
// PROFESSION — CRB p. 102
// ─────────────────────────────────────────────────────
// Weekly downtime income = check result / 2 in gp (CRB).
export function resolveProfessionIncome(checkTotal) {
  const incomeGP = Math.floor(checkTotal / 2);
  return {
    incomeGP,
    breakdown: `Profession check ${checkTotal} → ${incomeGP} gp earned for the week`,
  };
}

// ─────────────────────────────────────────────────────
// RIDE — CRB p. 103
// ─────────────────────────────────────────────────────
export const RIDE_DCS = {
  'guide with knees': 5,            // free action; success = hands free this round
  'stay in saddle (jolted)': 5,
  'fight from cover (mount as cover)': 15,
  'soft fall (when mount is killed)': 15,
  'leap (over obstacle)': 15,
  'spur mount (extra speed)': 15,
  'control mount in battle (untrained mount)': 20,
  'fast mount or dismount': 20,
};

export function resolveRide(checkTotal, task) {
  const dc = RIDE_DCS[task] ?? 15;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Ride ${checkTotal} vs DC ${dc} (${task}) — ${success ? 'maneuver succeeds' : 'fails; rider may be unseated'}`,
  };
}

// ─────────────────────────────────────────────────────
// SLEIGHT OF HAND — CRB p. 104
// ─────────────────────────────────────────────────────
// Palm a coin-sized object DC 10; lift a small item from a person opposed by Perception
export function resolveSleightOfHand(checkTotal, action, opts = {}) {
  const dcs = {
    palm: 10,
    drawHidden: 10,
    concealSmallWeapon: 20,  // raise to 0 vs full plate frisk per CRB note
    pickpocket: null,        // opposed
  };
  if (action === 'pickpocket') {
    const opposedPerception = opts.targetPerception || 0;
    const success = checkTotal >= opposedPerception;
    return {
      success,
      dc: opposedPerception,
      breakdown: `Sleight of Hand ${checkTotal} vs Perception ${opposedPerception} — ${success ? 'lifted unnoticed' : 'caught in the act'}`,
    };
  }
  const dc = dcs[action] ?? 10;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Sleight of Hand ${checkTotal} vs DC ${dc} (${action}) — ${success ? 'success' : 'fumbled / noticed'}`,
  };
}

// ─────────────────────────────────────────────────────
// SPELLCRAFT — CRB p. 106
// ─────────────────────────────────────────────────────
// Identify a spell as it's cast: DC 15 + spell level (free action)
// Identify a magic item via detect magic: DC 15 + item caster level
// Learn spell from a scroll/spellbook: DC 15 + spell level
// Decipher a written spell: DC 20 + spell level
export function resolveSpellcraftIdentifySpell(checkTotal, spellLevel) {
  const dc = 15 + (spellLevel || 0);
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Spellcraft ${checkTotal} vs DC ${dc} (identify level-${spellLevel} spell) — ${success ? 'recognized' : 'unknown'}`,
  };
}

export function resolveSpellcraftIdentifyItem(checkTotal, casterLevel) {
  const dc = 15 + (casterLevel || 0);
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Spellcraft ${checkTotal} vs DC ${dc} (identify CL ${casterLevel} magic item) — ${success ? 'properties revealed' : 'magic remains mysterious'}`,
  };
}

export function resolveSpellcraftLearnFromScroll(checkTotal, spellLevel) {
  const dc = 15 + (spellLevel || 0);
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Spellcraft ${checkTotal} vs DC ${dc} (learn level-${spellLevel} spell from scroll) — ${success ? 'transcribed into spellbook' : 'cannot decipher; try again after gaining a rank'}`,
  };
}

// ─────────────────────────────────────────────────────
// SURVIVAL — CRB p. 107
// ─────────────────────────────────────────────────────
// Tracking DC depends on surface and creature size; +1/+2 per category larger than Medium, etc.
export const SURVIVAL_TRACK_BASE = {
  'very soft (snow, mud)': 5,
  'soft (loose dirt)': 10,
  'firm (grass, hard dirt)': 15,
  'hard (stone, paving)': 20,
};

export const TRACK_SIZE_MOD = {
  fine: +8, diminutive: +4, tiny: +2, small: +1,
  medium: 0,
  large: -1, huge: -2, gargantuan: -4, colossal: -8,
};

export function getTrackingDC(surface, partySize, opts = {}) {
  const base = SURVIVAL_TRACK_BASE[surface] || 15;
  const sizeMod = TRACK_SIZE_MOD[(opts.creatureSize || 'medium').toLowerCase()] || 0;
  let dc = base + sizeMod;
  // -1 per 3 creatures past first (group is easier to track)
  if (partySize > 1) dc -= Math.floor((partySize - 1) / 3);
  // +1 per 24 hours of trail age, +1 per hour of rain, etc.
  if (opts.hoursOld) dc += Math.floor(opts.hoursOld / 24);
  if (opts.weatherFresh) dc += 5;
  if (opts.snowFresh) dc += 10;
  return Math.max(0, dc);
}

export function resolveTracking(checkTotal, dc) {
  const success = checkTotal >= dc;
  const lostByFive = !success && checkTotal <= dc - 5;
  return {
    success,
    dc,
    lostTrail: lostByFive,
    breakdown: `Survival ${checkTotal} vs DC ${dc} (track) — ${success ? 'follows the trail' : (lostByFive ? 'lost the trail (lost 1 hour finding it again)' : 'no progress this hour, retry')}`,
  };
}

// Forage food/water: DC 10 (plentiful) to DC 20 (sparse). Half check result = creatures fed.
export function resolveForage(checkTotal, terrain = 'normal') {
  const dcs = { plentiful: 10, normal: 15, sparse: 20 };
  const dc = dcs[terrain] || 15;
  const success = checkTotal >= dc;
  const fed = success ? Math.floor(checkTotal / 2) : 0;
  return {
    success,
    dc,
    creaturesFed: fed,
    breakdown: `Survival ${checkTotal} vs DC ${dc} (forage in ${terrain} terrain) — ${success ? `feeds ${fed} Medium creature${fed === 1 ? '' : 's'}` : 'no food found'}`,
  };
}

// Predict weather (DC 15) — 24 hours ahead; +5 per additional day
export function resolveWeatherPrediction(checkTotal, daysAhead = 1) {
  const dc = 15 + (daysAhead - 1) * 5;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    daysAhead,
    breakdown: `Survival ${checkTotal} vs DC ${dc} (predict weather ${daysAhead} day${daysAhead === 1 ? '' : 's'} ahead) — ${success ? 'forecast accurate' : 'forecast wrong'}`,
  };
}

// Avoid getting lost in trackless terrain: DC 15
export function resolveNavigation(checkTotal, terrain = 'forest') {
  const dcs = { plains: 10, forest: 15, desert: 15, marsh: 18, mountain: 20, jungle: 20 };
  const dc = dcs[terrain] || 15;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Survival ${checkTotal} vs DC ${dc} (navigate ${terrain}) — ${success ? 'on course' : 'lost; the party wanders'}`,
  };
}

// ─────────────────────────────────────────────────────
// SWIM — CRB p. 108
// ─────────────────────────────────────────────────────
export const SWIM_WATER_DCS = {
  calm: 10,
  rough: 15,
  stormy: 20,
};

// Swim at half base speed; failure by 5+ → submerged, may begin drowning.
export function resolveSwim(checkTotal, waterCondition = 'calm', opts = {}) {
  let dc = SWIM_WATER_DCS[waterCondition] || 10;
  if (opts.heavyLoad) dc += 5;
  const success = checkTotal >= dc;
  const submerged = !success && checkTotal <= dc - 5;
  return {
    success,
    dc,
    submerged,
    breakdown: `Swim ${checkTotal} vs DC ${dc} (${waterCondition} water${opts.heavyLoad ? ', heavy load' : ''}) — ${success ? 'swims forward' : (submerged ? 'goes under! Begin holding breath / drowning rules' : 'no progress, stays afloat')}`,
  };
}

// Drowning rules: after Con rounds holding breath, save vs Con DC 10 +1/round
// Success holds breath another round; failure begins drowning (1 round to 0 HP, next round dying, next round dead).
export function getDrowningSaveDC(roundsHeld) {
  return 10 + Math.max(0, roundsHeld);
}

// ─────────────────────────────────────────────────────
// USE MAGIC DEVICE — CRB p. 110
// ─────────────────────────────────────────────────────
// Activate blindly DC 25; emulate ability score DC 15 + ability score (round);
// emulate alignment DC 30; emulate class feature DC 20; emulate race DC 25.
// Decipher a written spell DC 25 + spell level. Failure by 9 = 1d4 negative levels (1 day).
export const UMD_DCS = {
  emulateAbilityScore: 15,        // + ability score
  emulateClassFeature: 20,
  emulateAlignment: 30,
  emulateRace: 25,
  activateBlindly: 25,
};

export function resolveUseMagicDevice(checkTotal, action, opts = {}) {
  let dc;
  let detail = action;
  switch (action) {
    case 'emulateAbilityScore':
      dc = UMD_DCS.emulateAbilityScore + (opts.requiredScore || 0);
      detail = `emulate ability score ${opts.requiredScore}`;
      break;
    case 'emulateClassFeature': dc = UMD_DCS.emulateClassFeature; break;
    case 'emulateAlignment': dc = UMD_DCS.emulateAlignment; break;
    case 'emulateRace': dc = UMD_DCS.emulateRace; break;
    case 'activateBlindly': dc = UMD_DCS.activateBlindly; break;
    case 'decipherSpell':
      dc = 25 + (opts.spellLevel || 0);
      detail = `decipher level-${opts.spellLevel || 0} spell`;
      break;
    default: dc = 20;
  }
  const success = checkTotal >= dc;
  // Catastrophic failure: failed by 9+ → cannot use this item for 24 hours
  const cannotRetry = !success && checkTotal <= dc - 10;
  return {
    success,
    dc,
    cannotRetry,
    breakdown: `Use Magic Device ${checkTotal} vs DC ${dc} (${detail}) — ${success ? 'item activates' : (cannotRetry ? 'CRITICAL FAILURE: cannot use this item for 24 hours' : 'fails; can retry')}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — GENERAL SKILL MECHANICS
// ─────────────────────────────────────────────────────

// Aid Another (CRB pg 86): standard action, DC 10 on the same skill
// the ally is using; success grants ally +2 (or +2 to AC for defense).
// A character can sometimes apply a circumstance bonus larger than +2 by
// beating a higher DC, but the standard rule is DC 10 → +2.
export function resolveAidAnother(checkTotal, opts = {}) {
  const dc = opts.dc || 10;
  const success = checkTotal >= dc;
  const bonus = success ? (opts.bonus || 2) : 0;
  return {
    success,
    dc,
    bonus,
    breakdown: success
      ? `Aid Another ${checkTotal} vs DC ${dc} — grants +${bonus} to ally`
      : `Aid Another ${checkTotal} vs DC ${dc} — failed, no bonus`,
  };
}

// Take 10 (CRB pg 86): when not threatened/distracted, treat the d20 as 10.
// Take 20 (CRB pg 86): when not threatened, no failure penalty, takes 20× the time.
// These return the resulting check total and a flag if the rule conditions
// were violated (caller should still be able to inspect).
export function takeTen(skillModifier, opts = {}) {
  const violations = [];
  if (opts.threatened) violations.push('threatened');
  if (opts.distracted) violations.push('distracted');
  return {
    legal: violations.length === 0,
    total: 10 + skillModifier,
    violations,
    breakdown: `Take 10: 10 + ${skillModifier} = ${10 + skillModifier}${violations.length ? ` (ILLEGAL: ${violations.join(', ')})` : ''}`,
  };
}

export function takeTwenty(skillModifier, baseRoundsPerCheck = 1, opts = {}) {
  const violations = [];
  if (opts.threatened) violations.push('threatened');
  if (opts.failurePenalty) violations.push('failure has penalty');
  const totalRounds = baseRoundsPerCheck * 20;
  return {
    legal: violations.length === 0,
    total: 20 + skillModifier,
    timeRounds: totalRounds,
    timeMinutes: Math.ceil(totalRounds / 10),
    violations,
    breakdown: `Take 20: 20 + ${skillModifier} = ${20 + skillModifier} (takes ${Math.ceil(totalRounds / 10)} min)${violations.length ? ` (ILLEGAL: ${violations.join(', ')})` : ''}`,
  };
}

// Cooperative skill check: each helper rolls Aid Another against DC 10
// and the primary character gains +2 per success (no formal cap in CRB,
// but most groups limit to ~4 helpers for sanity).
export function resolveCooperativeCheck(primaryTotal, helperRolls = [], dc) {
  const helperBonuses = helperRolls.map(r => r >= 10 ? 2 : 0);
  const totalBonus = helperBonuses.reduce((a, b) => a + b, 0);
  const finalTotal = primaryTotal + totalBonus;
  return {
    primaryTotal,
    helperBonuses,
    totalBonus,
    finalTotal,
    success: finalTotal >= dc,
    dc,
    breakdown: `Cooperative: ${primaryTotal} primary + ${totalBonus} from ${helperBonuses.filter(b => b > 0).length}/${helperRolls.length} helpers = ${finalTotal} vs DC ${dc}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — PERCEPTION (full DC table)
// ─────────────────────────────────────────────────────
// Distance penalty: -1 per 10 ft for sight, -1 per 10 ft for hearing
// Through closed door: +5 / through stone wall: +15
// Through obscured (fog, smoke): +5 to +20 depending on density
// Sleeping: +10 to DC; distracted: +5

export const PERCEPTION_DCS = {
  loudConversation: 0,        // notice loud conversation in same room
  noticeVisibleCreature: 0,   // notice obvious creature in clear sight
  detectStrongOdor: 0,
  hearArmyMarching: 5,        // 1 mile away
  detectFaintOdor: 5,
  hearTypicalConversation: 10,
  noticeRustlingArmor: 10,
  hearStealthyCreature: 15,   // base — opposed by Stealth normally
  findSimpleSecretDoor: 15,
  findTypicalTrap: 20,
  noticeHiddenObject: 20,
  hearWellTrainedSentry: 25,
  findWellHiddenSecretDoor: 30,
  noticeInvisibleCreature: 40, // standard noting; opposed in practice
};

export function resolvePerception(checkTotal, dc, opts = {}) {
  let modifiedDC = dc;
  const mods = [];
  if (opts.distanceFeet) {
    const penalty = Math.floor(opts.distanceFeet / 10);
    modifiedDC += penalty;
    if (penalty > 0) mods.push(`+${penalty} (distance ${opts.distanceFeet} ft)`);
  }
  if (opts.throughDoor) { modifiedDC += 5; mods.push('+5 (through door)'); }
  if (opts.throughWall) { modifiedDC += 15; mods.push('+15 (through wall)'); }
  if (opts.unfavorableConditions) { modifiedDC += 2; mods.push('+2 (poor conditions)'); }
  if (opts.terribleConditions) { modifiedDC += 5; mods.push('+5 (terrible conditions)'); }
  if (opts.distracted) { modifiedDC += 5; mods.push('+5 (distracted)'); }
  if (opts.asleep) { modifiedDC += 10; mods.push('+10 (asleep)'); }
  const success = checkTotal >= modifiedDC;
  return {
    success,
    dc: modifiedDC,
    baseDC: dc,
    modifiers: mods,
    breakdown: `Perception ${checkTotal} vs DC ${modifiedDC}${mods.length ? ` [${mods.join(', ')}]` : ''} — ${success ? 'noticed' : 'missed'}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — BLUFF SUB-TASKS
// ─────────────────────────────────────────────────────

/**
 * Feint in combat — full resolution (CRB pp. 92, 201).
 * Delegates DC computation to getBluffFeintOpposed for consistency.
 */
export function resolveFeintInCombat(bluffTotal, target = {}) {
  const opposed = getBluffFeintOpposed(target);
  if (opposed.impossible) {
    return { success: false, dc: opposed.dc, breakdown: opposed.breakdown };
  }
  const success = bluffTotal >= opposed.dc;
  return {
    success,
    dc: opposed.dc,
    breakdown: `Feint ${bluffTotal} ${opposed.breakdown} — ${success ? 'target denied Dex bonus to AC vs your next attack before end of next turn' : 'feint fails'}`,
  };
}

/**
 * Secret message via Bluff (CRB p. 92).
 *
 * DC 15 to get across a simple message ("Meet me at the tavern after dark").
 * DC 20 to get across a complex message ("There are three guards, two on the
 * left and one on the right; I'll distract the one on the right").
 *
 * CRB p. 92: "If your Bluff check fails by 5 or more, you deliver the
 * wrong message."
 *
 * Intended recipients who share the code/context make a Sense Motive check
 * opposed by the sender's Bluff to decode. Eavesdroppers likewise oppose
 * with Sense Motive — if they beat the sender's Bluff, they understand
 * the hidden meaning.
 *
 * @param bluffTotal        sender's Bluff check total
 * @param senseMotiveTotal  listener's Sense Motive total (intended or eavesdropper)
 * @param complexity        'simple' (DC 15) | 'complex' (DC 20)
 */
export function resolveSecretMessage(bluffTotal, senseMotiveTotal, complexity = 'simple') {
  const dc = complexity === 'complex' ? 20 : 15;
  const senderSucceeds = bluffTotal >= dc;
  const senderFailBy = senderSucceeds ? 0 : dc - bluffTotal;
  const wrongMessageDelivered = senderFailBy >= 5; // CRB: fail by 5+ = wrong message
  const intendedReadable = senderSucceeds && senseMotiveTotal >= bluffTotal;
  const interceptorMissesEntirely = senseMotiveTotal < bluffTotal - 5;

  let senderOutcome;
  if (wrongMessageDelivered) senderOutcome = 'wrong message delivered';
  else if (!senderSucceeds) senderOutcome = 'garbled';
  else senderOutcome = 'OK';

  let listenerOutcome;
  if (!senderSucceeds) listenerOutcome = wrongMessageDelivered ? 'received wrong meaning' : 'message unclear';
  else if (intendedReadable) listenerOutcome = 'decoded';
  else if (interceptorMissesEntirely) listenerOutcome = 'missed entirely';
  else listenerOutcome = 'sensed hidden meaning but unclear';

  return {
    senderSucceeds,
    wrongMessageDelivered,
    intendedReadable,
    interceptorMissesEntirely,
    dc,
    breakdown: `Secret message DC ${dc}: sender ${bluffTotal} (${senderOutcome}), listener ${senseMotiveTotal} (${listenerOutcome})`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — SENSE MOTIVE SUB-TASKS
// ─────────────────────────────────────────────────────

// Hunch: DC 20 — get a feeling about a social situation
// Sense Enchantment: DC 25 normally, DC 15 if target acts erratically
// Discern Lie: DC 20, but the liar opposes with Bluff
export function resolveSenseMotive(checkTotal, task = 'hunch', opts = {}) {
  let dc;
  let detail;
  switch (task) {
    case 'hunch':
      dc = 20;
      detail = 'general hunch about a social situation';
      break;
    case 'senseEnchantment':
      dc = opts.targetActsOddly ? 15 : 25;
      detail = `sense enchantment${opts.targetActsOddly ? ' (target acting oddly)' : ''}`;
      break;
    case 'discernLie':
      // Opposed by Bluff — caller may pass opts.opposingBluff
      if (opts.opposingBluff != null) {
        const success = checkTotal >= opts.opposingBluff;
        return {
          success,
          opposed: true,
          breakdown: `Discern Lie ${checkTotal} vs Bluff ${opts.opposingBluff} — ${success ? 'detects lie' : 'fooled'}`,
        };
      }
      dc = 20;
      detail = 'discern lie (no opposing roll given)';
      break;
    default: dc = 20; detail = task;
  }
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    breakdown: `Sense Motive ${checkTotal} vs DC ${dc} (${detail}) — ${success ? 'gets reliable read' : 'no useful insight'}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — DIPLOMACY: GATHER INFORMATION
// ─────────────────────────────────────────────────────
// CRB: DC 10 for common knowledge, harder for protected/secret info.
// Time: 1d4 hours of working a settlement.
// Bonus: large settlement +0, small +2 to DC, isolated +5.
export function resolveGatherInformation(checkTotal, opts = {}) {
  const obscurity = opts.obscurity || 'common'; // common | uncommon | obscure | secret
  const settlement = opts.settlement || 'town'; // metropolis | city | town | village | hamlet
  const baseDCs = { common: 10, uncommon: 15, obscure: 20, secret: 30 };
  const settlementMods = {
    metropolis: -2, city: -1, town: 0, village: 2, hamlet: 5,
  };
  let dc = (baseDCs[obscurity] ?? 10) + (settlementMods[settlement] ?? 0);
  if (opts.dangerous) dc += 5;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    obscurity,
    settlement,
    breakdown: `Gather Information ${checkTotal} vs DC ${dc} (${obscurity} info in ${settlement}) — ${success ? 'learns the answer' : 'no luck on the streets'}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — HEAL: TREAT POISON & RECURRING SAVE LOOP
// ─────────────────────────────────────────────────────
// Treat Poison: standard action each time the victim must save vs the
// poison; healer's check vs the poison's save DC. If healer beats it, the
// victim adds +4 to their save against that exposure.
export function resolveTreatPoison(healCheckTotal, poisonSaveDC) {
  const success = healCheckTotal >= poisonSaveDC;
  return {
    success,
    dc: poisonSaveDC,
    bonusOnNextSave: success ? 4 : 0,
    breakdown: `Treat Poison ${healCheckTotal} vs DC ${poisonSaveDC} — ${success ? 'patient gains +4 on next save vs this poison' : 'no help'}`,
  };
}

// Treat Disease loop: caller passes the patient's recent saves; success
// requires two consecutive successful saves (the disease's normal cure
// condition) — the Heal check just adds +4 to those saves.
export function resolveTreatDiseaseLoop(healCheckTotal, diseaseSaveDC, recentSaveResults = []) {
  const treatSucceeds = healCheckTotal >= diseaseSaveDC;
  const bonus = treatSucceeds ? 4 : 0;
  const lastTwo = recentSaveResults.slice(-2);
  const cured = lastTwo.length === 2 && lastTwo.every(s => s === 'success');
  return {
    treatSucceeds,
    bonusPerSave: bonus,
    cured,
    breakdown: `Treat Disease (loop) ${healCheckTotal} vs DC ${diseaseSaveDC} — ${treatSucceeds ? `+${bonus} to patient saves` : 'no aid'}; ${cured ? 'CURED (two consecutive saves)' : 'awaiting two consecutive saves'}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — KNOWLEDGE: LORE DC LADDER
// ─────────────────────────────────────────────────────
// CRB pg 99: For non-creature questions, the GM picks a DC by obscurity.
//   DC 10 — common knowledge anyone in the field would know
//   DC 15 — basic knowledge an apprentice might know
//   DC 20 — uncommon knowledge requiring focused study
//   DC 25 — obscure knowledge known only to specialists
//   DC 30 — extremely obscure / forbidden / secret lore
export const KNOWLEDGE_LORE_DCS = {
  common: 10,
  basic: 15,
  uncommon: 20,
  obscure: 25,
  secret: 30,
};

export function resolveKnowledgeLore(checkTotal, obscurity = 'common') {
  const dc = KNOWLEDGE_LORE_DCS[obscurity] ?? 10;
  const success = checkTotal >= dc;
  // Beating DC by 5+ grants extra detail per CRB
  const extraDetails = Math.max(0, Math.floor((checkTotal - dc) / 5));
  return {
    success,
    dc,
    obscurity,
    extraDetails,
    breakdown: `Knowledge ${checkTotal} vs DC ${dc} (${obscurity}) — ${success ? `success${extraDetails ? `, +${extraDetails} extra detail${extraDetails > 1 ? 's' : ''}` : ''}` : 'no recall'}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — STEALTH SUB-TASKS
// ─────────────────────────────────────────────────────
// Stealth penalties (CRB pg 106):
//   Moving > half speed: -5
//   Running / fighting: -20
//   Sniping (shoot then re-hide): -20 to the Stealth check after attacking
//   Creature one size larger than you: -4 (relative)
//   Without cover or concealment: usually impossible
export function resolveStealthAction(stealthTotal, perceptionTotal, opts = {}) {
  const mods = [];
  let modifiedTotal = stealthTotal;
  if (opts.movingFast) { modifiedTotal -= 5; mods.push('-5 (>½ speed)'); }
  if (opts.runningOrFighting) { modifiedTotal -= 20; mods.push('-20 (running/fighting)'); }
  if (opts.sniping) { modifiedTotal -= 20; mods.push('-20 (sniping)'); }
  if (opts.sizeDelta) {
    const delta = opts.sizeDelta * -4;
    modifiedTotal += delta;
    if (delta) mods.push(`${delta >= 0 ? '+' : ''}${delta} (size)`);
  }
  if (opts.noCover) {
    return {
      success: false,
      breakdown: 'Stealth IMPOSSIBLE: no cover or concealment available',
      modifiers: mods,
    };
  }
  const success = modifiedTotal >= perceptionTotal;
  return {
    success,
    modifiedTotal,
    perceptionTotal,
    modifiers: mods,
    breakdown: `Stealth ${modifiedTotal} ${mods.length ? `[${mods.join(', ')}] ` : ''}vs Perception ${perceptionTotal} — ${success ? 'unseen' : 'spotted'}`,
  };
}

// ─────────────────────────────────────────────────────
// CHAPTER 4 — SURVIVAL SUB-TASKS (severe weather, get along)
// ─────────────────────────────────────────────────────
// Get Along in the Wild: DC 10 — feed yourself & one other; +2 per extra.
// Endure Severe Weather: DC 15 hot/cold, DC 20 severe, DC 25 extreme.
// On success, party gains +2 Fort vs weather effects for that day.
export function resolveGetAlongInWild(checkTotal, partySize = 1) {
  const dc = 10 + Math.max(0, partySize - 1) * 2;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    partySize,
    breakdown: `Get Along in Wild ${checkTotal} vs DC ${dc} (party of ${partySize}) — ${success ? 'feeds & shelters whole party' : 'cannot sustain everyone'}`,
  };
}

export function resolveEndureSevereWeather(checkTotal, severity = 'severe') {
  const dcs = { mild: 10, hot: 15, cold: 15, severe: 20, extreme: 25 };
  const dc = dcs[severity] ?? 15;
  const success = checkTotal >= dc;
  return {
    success,
    dc,
    severity,
    fortBonus: success ? 2 : 0,
    breakdown: `Endure Weather ${checkTotal} vs DC ${dc} (${severity}) — ${success ? 'party gains +2 Fort vs weather today' : 'no shelter advice'}`,
  };
}


