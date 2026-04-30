/**
 * PF1e Class Ability Resolver
 *
 * Resolves class abilities into concrete mechanical effects during combat.
 * Works alongside spellEffectResolver for a complete enforcement layer.
 *
 * BLOCK 1: CORE RULEBOOK — All 11 CRB classes fully scripted.
 *
 * Usage in combat:
 *   const result = resolveClassAbility('Sneak Attack', character, { isFlanking: true });
 *   const passives = getPassiveClassModifiers(character);
 *   const dailyUses = getDailyAbilityUses(character);
 */

import { rollDice, roll, mod } from './dice';
import {
  CLASS_ABILITIES,
  ROGUE_SNEAK_ATTACK,
  CLERIC_CHANNEL_ENERGY,
  PALADIN_LAY_ON_HANDS,
  PALADIN_SMITE_EVIL,
  PALADIN_MERCY,
  PALADIN_AURA_OF_COURAGE,
  PALADIN_CHANNEL_POSITIVE_ENERGY,
  PALADIN_AURA_OF_RIGHTEOUSNESS,
  PALADIN_HOLY_CHAMPION,
  PALADIN_DIVINE_BOND,
  BARBARIAN_RAGE,
  BARBARIAN_DR,
  BARBARIAN_INDOMITABLE_WILL,
  MONK_STUNNING_FIST,
  MONK_MANEUVER_TRAINING,
  MONK_FLURRY_OF_BLOWS,
  MONK_UNARMED_STRIKE,
  MONK_AC_BONUS,
  MONK_KI_POOL,
  MONK_WHOLENESS_OF_BODY,
  MONK_QUIVERING_PALM,
  MONK_DIAMOND_SOUL,
  MONK_PERFECT_SELF,
  MONK_EVASION,
  MONK_IMPROVED_EVASION,
  MONK_FAST_MOVEMENT,
  BARD_BARDIC_PERFORMANCE,
  BARD_BARDIC_KNOWLEDGE,
  FIGHTER_BRAVERY,
  FIGHTER_ARMOR_TRAINING,
  FIGHTER_WEAPON_TRAINING,
  FIGHTER_WEAPON_MASTERY,
  FIGHTER_ARMOR_MASTERY,
  RANGER_FAVORED_ENEMY,
  RANGER_FAVORED_TERRAIN,
  RANGER_TRACK,
  RANGER_MASTER_HUNTER,
  ROGUE_TRAPFINDING,
  ROGUE_MASTER_STRIKE,
  DRUID_WILD_SHAPE,
  DRUID_NATURE_SENSE,
  SORCERER_BLOODLINE,
  WIZARD_ARCANE_SCHOOL,
  PALADIN_DIVINE_GRACE,
  BARBARIAN_TRAP_SENSE,
  ALCHEMIST_BOMB,
  ALCHEMIST_MUTAGEN,
  INQUISITOR_JUDGMENT,
  INQUISITOR_BANE,
  INQUISITOR_TRUE_JUDGMENT,
  CAVALIER_CHALLENGE,
  WITCH_HEX,
  BLOODRAGER_BLOODRAGE,
  BLOODRAGER_DR,
  BRAWLER_MARTIAL_FLEXIBILITY,
  BRAWLER_KNOCKOUT,
  SLAYER_STUDIED_TARGET,
  SLAYER_SNEAK_ATTACK,
  SLAYER_MASTER_SLAYER,
  SWASHBUCKLER_DEEDS,
  SWASHBUCKLER_PANACHE,
  SWASHBUCKLER_CHARMED_LIFE,
  SWASHBUCKLER_NIMBLE,
  WARPRIEST_SACRED_WEAPON,
  WARPRIEST_SACRED_ARMOR,
  WARPRIEST_FERVOR,
  WARPRIEST_ASPECT_OF_WAR,
  SKALD_RAGING_SONG,
  HUNTER_ANIMAL_FOCUS,
  ARCANIST_ARCANE_RESERVOIR,
  INVESTIGATOR_INSPIRATION,
  INVESTIGATOR_STUDIED_COMBAT,
  INVESTIGATOR_STUDIED_STRIKE,
  SUMMONER_EIDOLON,
  SUMMONER_SUMMON_MONSTER,
  getClassAbilitiesForLevel,
  hasClassAbility,
} from '../data/classAbilities';


// ═══════════════════════════════════════════════════════
//  P A S S I V E   M O D I F I E R S
// ═══════════════════════════════════════════════════════

/**
 * Compute ALL passive class-ability modifiers for a character.
 * These are always-on and should be folded into stat computation.
 *
 * @param {object} character — { class, level, abilities, size, feats, ... }
 * @returns {object} Modifier object compatible with rulesEngine conditionMods
 */
export function getPassiveClassModifiers(character) {
  const result = {
    attack: 0,
    damage: 0,
    ac: 0,
    saves: { all: 0, Fort: 0, Ref: 0, Will: 0, fear: 0, enchantment: 0 },
    skills: {},
    speedBonus: 0,
    initiative: 0,
    dr: null,
    sr: 0,
    armorCheckReduction: 0,
    maxDexIncrease: 0,
  };

  const cls = character.class;
  const level = character.level || 1;

  // ── Paladin: Divine Grace ──
  if (hasClassAbility(cls, level, 'Divine Grace')) {
    const chaMod = mod(character.abilities?.CHA || 10);
    result.saves.all += Math.max(0, chaMod);
  }

  // ── Paladin: Aura of Courage — self is immune to fear ──
  if (hasClassAbility(cls, level, 'Aura of Courage')) {
    result.saves.fear += 99; // Effectively immune
  }

  // ── Paladin: Aura of Resolve — self immune to charm, allies +4 ──
  if (hasClassAbility(cls, level, 'Aura of Resolve')) {
    result.saves.charm = (result.saves.charm || 0) + 99; // Self is immune to charm
  }

  // ── Paladin: Aura of Righteousness — DR 5/evil ──
  if (hasClassAbility(cls, level, 'Aura of Righteousness')) {
    result.dr = { amount: 5, type: '/evil' };
  }

  // ── Paladin: Holy Champion — DR 10/evil ──
  if (hasClassAbility(cls, level, 'Holy Champion')) {
    result.dr = { amount: 10, type: '/evil' };
  }

  // ── Barbarian/Monk: Fast Movement ──
  if (hasClassAbility(cls, level, 'Fast Movement')) {
    result.speedBonus += MONK_FAST_MOVEMENT.speedBonus(level, cls);
  }

  // ── Barbarian: Damage Reduction ──
  if (cls === 'Barbarian' && level >= 7) {
    const drAmt = BARBARIAN_DR.dr(level);
    if (!result.dr || drAmt > (result.dr.amount || 0)) {
      result.dr = { amount: drAmt, type: '/-' };
    }
  }

  // ── Bloodrager: Damage Reduction ──
  if (cls === 'Bloodrager' && level >= 7) {
    const drAmt = BLOODRAGER_DR.dr(level);
    if (!result.dr || drAmt > (result.dr.amount || 0)) {
      result.dr = { amount: drAmt, type: '/-' };
    }
  }

  // ── Skald: Damage Reduction (L9) ──
  if (cls === 'Skald' && level >= 9) {
    const drAmt = level >= 19 ? 3 : level >= 14 ? 2 : 1;
    if (!result.dr || drAmt > (result.dr.amount || 0)) {
      result.dr = { amount: drAmt, type: '/lethal' };
    }
  }

  // ── Bloodrager: Indomitable Will (14+) ──
  if (cls === 'Bloodrager' && level >= 14) {
    result.saves.enchantment = (result.saves.enchantment || 0) + 4;
  }

  // ── Fighter: Bravery ──
  if (cls === 'Fighter' && level >= 2) {
    result.saves.fear += FIGHTER_BRAVERY.modifiers(level).saves.fear;
  }

  // ── Fighter: Armor Training ──
  if (cls === 'Fighter' && level >= 3) {
    const atBonus = FIGHTER_ARMOR_TRAINING.scaling(level);
    result.armorCheckReduction += atBonus;
    result.maxDexIncrease += atBonus;
  }

  // ── Fighter: Weapon Training — needs weapon group context ──
  // Handled at attack time since it depends on which weapon group

  // ── Fighter: Armor Mastery (19) ──
  if (cls === 'Fighter' && level >= 19) {
    result.dr = { amount: 5, type: '/-' };
  }

  // ── Fighter: Weapon Mastery (20) ──
  if (cls === 'Fighter' && level >= 20) {
    result.attack += 1;
    result.damage += 1;
  }

  // ── Monk: AC Bonus (WIS to AC + scaling) ──
  if (cls === 'Monk') {
    const wisMod = mod(character.abilities?.WIS || 10);
    const monkAC = MONK_AC_BONUS.modifiers(level, wisMod);
    result.ac += monkAC.ac;
  }

  // ── Monk: Still Mind ──
  if (cls === 'Monk' && level >= 3) {
    result.saves.enchantment += 2;
  }

  // ── Monk: Diamond Soul — SR ──
  if (cls === 'Monk' && level >= 13) {
    result.sr = MONK_DIAMOND_SOUL.sr(level);
  }

  // ── Monk: Perfect Self — DR 10/chaotic ──
  if (cls === 'Monk' && level >= 20) {
    result.dr = { amount: 10, type: '/chaotic' };
  }

  // ── Druid: Nature Sense ──
  if (cls === 'Druid') {
    result.skills['Knowledge (nature)'] = (result.skills['Knowledge (nature)'] || 0) + 2;
    result.skills['Survival'] = (result.skills['Survival'] || 0) + 2;
  }

  // ── Bard: Bardic Knowledge ──
  if (cls === 'Bard') {
    const bkBonus = Math.max(1, Math.floor(level / 2));
    result.skills['Knowledge'] = (result.skills['Knowledge'] || 0) + bkBonus;
  }

  // ── Ranger: Track ──
  if (cls === 'Ranger') {
    result.skills['Survival_tracking'] = (result.skills['Survival_tracking'] || 0) + Math.max(1, Math.floor(level / 2));
  }

  // ── Rogue: Trapfinding ──
  if (cls === 'Rogue') {
    const tfBonus = Math.max(1, Math.floor(level / 2));
    result.skills['Perception_traps'] = (result.skills['Perception_traps'] || 0) + tfBonus;
    result.skills['Disable Device'] = (result.skills['Disable Device'] || 0) + tfBonus;
  }

  // ── Barbarian/Rogue: Trap Sense ──
  if (hasClassAbility(cls, level, 'Trap Sense')) {
    const tsBonus = BARBARIAN_TRAP_SENSE.scaling(level, cls);
    result.saves.Ref += tsBonus; // vs traps only — context marker
  }

  // ── Investigator: Trap Sense (L3) ──
  if (cls === 'Investigator' && level >= 3) {
    const tsBonus = Math.floor(level / 3);
    result.saves.Ref += tsBonus; // vs traps only — context marker
  }

  // ── Monk: Maneuver Training (use monk level as BAB for CMB) ──
  if (cls === 'Monk' && level >= 3) {
    result.cmbBonus = (result.cmbBonus || 0) + MONK_MANEUVER_TRAINING.cmbBonus(level);
  }

  // ── Inquisitor: Stern Gaze ──
  if (cls === 'Inquisitor') {
    const sgBonus = Math.max(1, Math.floor(level / 2));
    result.skills['Intimidate'] = (result.skills['Intimidate'] || 0) + sgBonus;
    result.skills['Sense Motive'] = (result.skills['Sense Motive'] || 0) + sgBonus;
  }

  // ── Inquisitor: Cunning Initiative ──
  if (cls === 'Inquisitor') {
    const wisMod = mod(character.abilities?.WIS || 10);
    result.initiative += wisMod;
  }

  // ── Swashbuckler: Nimble ──
  if (cls === 'Swashbuckler' && level >= 3) {
    result.ac += Math.max(0, 1 + Math.floor((level - 3) / 4));
  }

  // ── Brawler: AC Bonus ──
  if (cls === 'Brawler' && level >= 4) {
    let acBonus = 1;
    if (level >= 18) acBonus = 4;
    else if (level >= 13) acBonus = 3;
    else if (level >= 9) acBonus = 2;
    result.ac += acBonus;
  }

  // ── Investigator: Trapfinding ──
  if (cls === 'Investigator') {
    const itfBonus = Math.max(1, Math.floor(level / 2));
    result.skills['Perception_traps'] = (result.skills['Perception_traps'] || 0) + itfBonus;
    result.skills['Disable Device'] = (result.skills['Disable Device'] || 0) + itfBonus;
  }

  // ── Investigator: Poison Resistance ──
  if (cls === 'Investigator' && level >= 2) {
    const prBonus = level >= 8 ? 6 : level >= 5 ? 4 : 2;
    result.saves.poison = (result.saves.poison || 0) + prBonus;
  }

  // ── Slayer: Stalker ──
  if (cls === 'Slayer' && level >= 7) {
    result.skills['Stealth'] = (result.skills['Stealth'] || 0) + Math.max(1, Math.floor(level / 2));
  }

  // ── Cavalier: Expert Trainer ──
  if (cls === 'Cavalier' && level >= 4) {
    result.skills['Handle Animal_mount'] = (result.skills['Handle Animal_mount'] || 0) + Math.floor(level / 2);
  }

  // ── Hunter: Track bonus (same as Ranger) ──
  if (cls === 'Hunter' && level >= 2) {
    result.skills['Survival_tracking'] = (result.skills['Survival_tracking'] || 0) + Math.max(1, Math.floor(level / 2));
  }

  // ── Skald: Bardic Knowledge ──
  if (cls === 'Skald') {
    const bkBonus = Math.max(1, Math.floor(level / 2));
    result.skills['Knowledge'] = (result.skills['Knowledge'] || 0) + bkBonus;
  }

  // ── Alchemist: Poison Resistance / Immunity ──
  if (cls === 'Alchemist' && level >= 2) {
    if (level >= 10) {
      result.saves.poison = 99; // Immune
    } else {
      const prBonus = level >= 8 ? 6 : level >= 5 ? 4 : 2;
      result.saves.poison = (result.saves.poison || 0) + prBonus;
    }
  }

  // ── Druid: Resist Nature's Lure (L4) ──
  if (cls === 'Druid' && level >= 4) {
    result.saves.fey_spells = (result.saves.fey_spells || 0) + 4;
  }

  // ── Druid: Venom Immunity (L9) ──
  if (cls === 'Druid' && level >= 9) {
    result.saves.poison = 99; // Immune
  }

  // ── Paladin: Divine Health (L3) — immunity to disease ──
  if (cls === 'Paladin' && level >= 3) {
    result.immunities = result.immunities || [];
    result.immunities.push('disease');
  }

  // ── Monk: Purity of Body (L5) — immunity to disease ──
  if (cls === 'Monk' && level >= 5) {
    result.immunities = result.immunities || [];
    result.immunities.push('disease');
  }

  // ── Monk: Diamond Body (L11) — immunity to poison ──
  if (cls === 'Monk' && level >= 11) {
    result.saves.poison = 99; // Immune
  }

  // ── Ranger: Endurance (L3) — +4 on certain checks ──
  if (cls === 'Ranger' && level >= 3) {
    result.saves.endurance = (result.saves.endurance || 0) + 4;
  }

  // ── Investigator: Poison Immunity (L11) ──
  if (cls === 'Investigator' && level >= 11) {
    result.saves.poison = 99; // Immune
  }

  return result;
}


// ═══════════════════════════════════════════════════════
//  S N E A K   A T T A C K
// ═══════════════════════════════════════════════════════

/**
 * Compute sneak attack damage for a qualifying attack.
 */
export function computeSneakAttackDamage(character, context = {}) {
  const cls = character.class;
  const level = character.level || 1;

  if (!ROGUE_SNEAK_ATTACK.classes.includes(cls)) {
    return { applies: false, reason: 'Class does not have Sneak Attack' };
  }

  if (!context.isFlanking && !context.targetDeniedDex) {
    return { applies: false, reason: 'Target is not flanked or denied DEX to AC' };
  }

  // PF1e: No creature types have blanket sneak attack immunity (3.5e rule removed)
  // Specific immunities (e.g., fortification armor) should be checked elsewhere

  if (context.isRanged && context.distanceFeet > ROGUE_SNEAK_ATTACK.restrictions.rangedMaxFeet) {
    return { applies: false, reason: 'Target beyond 30 feet for ranged sneak attack' };
  }

  const numDice = ROGUE_SNEAK_ATTACK.scaling.dicePerLevel(level);
  let totalDamage = 0;
  for (let i = 0; i < numDice; i++) {
    totalDamage += Math.floor(Math.random() * 6) + 1;
  }

  return {
    applies: true,
    dice: numDice,
    sides: 6,
    totalDice: numDice,
    damage: totalDamage,
    reason: `Sneak Attack ${numDice}d6`,
  };
}


// ═══════════════════════════════════════════════════════
//  C H A N N E L   E N E R G Y
// ═══════════════════════════════════════════════════════

/**
 * Resolve a Channel Energy use (Cleric or Paladin).
 */
export function resolveChannelEnergy(character, targets = [], mode = 'heal') {
  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);
  const isPaladin = character.class === 'Paladin';
  const effectiveLevel = isPaladin ? Math.max(1, level - 3) : level;
  const template = isPaladin ? PALADIN_CHANNEL_POSITIVE_ENERGY : CLERIC_CHANNEL_ENERGY;

  const numDice = template.scaling.dicePerLevel(effectiveLevel);
  const saveDC = template.saveDC(effectiveLevel, chaMod);

  let total = 0;
  const rolls = [];
  for (let i = 0; i < numDice; i++) {
    const r = Math.floor(Math.random() * 6) + 1;
    rolls.push(r);
    total += r;
  }

  const messages = [`Channel Energy: ${numDice}d6 = ${total} (${rolls.join(', ')})`];
  if (mode === 'heal') {
    messages.push(`All living allies in 30ft heal ${total} HP`);
  } else {
    messages.push(`All enemies in 30ft take ${total} damage (Will DC ${saveDC} for half)`);
  }

  return {
    total, numDice, rolls, saveDC, saveType: 'Will', mode, messages,
    hpChanges: targets.map(t => ({
      targetId: t.id, targetName: t.name,
      amount: mode === 'heal' ? total : -total,
      saveForHalf: mode === 'damage',
    })),
  };
}


// ═══════════════════════════════════════════════════════
//  L A Y   O N   H A N D S
// ═══════════════════════════════════════════════════════

/**
 * Resolve Lay on Hands (Paladin).
 */
export function resolveLayOnHands(character, target, isUndead = false) {
  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);
  const numDice = PALADIN_LAY_ON_HANDS.scaling.dicePerLevel(level);

  let total = 0;
  const rolls = [];
  for (let i = 0; i < numDice; i++) {
    const r = Math.floor(Math.random() * 6) + 1;
    rolls.push(r); total += r;
  }

  const isSelf = target?.id === character.id;
  const action = isSelf ? 'swift' : 'standard';
  const messages = [];

  if (isUndead) {
    const saveDC = PALADIN_LAY_ON_HANDS.undeadSaveDC(level, chaMod);
    messages.push(`Lay on Hands (vs undead): ${numDice}d6 = ${total} damage (Will DC ${saveDC} half)`);
    return { damage: total, healing: 0, numDice, rolls, action, saveDC, messages };
  }

  messages.push(`Lay on Hands: ${numDice}d6 = ${total} HP healed (${action} action${isSelf ? ' — self' : ''})`);

  // Mercy conditions that can be removed
  const merciesAvailable = [];
  if (level >= 3) merciesAvailable.push(...(character.merciesChosen || []));

  return { healing: total, damage: 0, numDice, rolls, action, messages, merciesAvailable };
}


// ═══════════════════════════════════════════════════════
//  S M I T E   E V I L
// ═══════════════════════════════════════════════════════

export function resolveSmiteEvil(character, target = {}) {
  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);
  const mods = PALADIN_SMITE_EVIL.modifiers(level, chaMod);

  const targetType = (target.type || target.creatureType || '').toLowerCase();
  const doubleTypes = mods.doubleDamageFirstHit || [];
  const isDoubleType = doubleTypes.some(t => targetType.includes(t));

  const messages = [
    `Smite Evil: +${chaMod} attack, +${level} damage${isDoubleType ? ` (×2 first hit vs ${targetType})` : ''}`,
    `+${chaMod} deflection AC vs this target`,
  ];

  return {
    attack: mods.attack, damage: mods.damage, deflectionBonus: mods.deflectionBonus,
    doubleDamageFirstHit: isDoubleType,
    firstHitDamage: isDoubleType ? level * 2 : level,
    messages,
  };
}


// ═══════════════════════════════════════════════════════
//  B A R B A R I A N   R A G E
// ═══════════════════════════════════════════════════════

export function resolveRage(character) {
  const level = character.level || 1;
  const conMod = mod(character.abilities?.CON || 10);
  const mods = BARBARIAN_RAGE.modifiers(level);
  const roundsPerDay = BARBARIAN_RAGE.roundsPerDay(level, conMod);
  const rageName = level >= 20 ? 'Mighty Rage' : level >= 11 ? 'Greater Rage' : 'Rage';

  const messages = [
    `${rageName}: +${mods.strBonus} STR, +${mods.conBonus} CON, +${mods.saves.Will} Will, -2 AC`,
    `${roundsPerDay} rounds per day`,
  ];

  // Indomitable Will at 14+
  if (level >= 14) {
    messages.push('+4 Will vs enchantment while raging');
  }

  return { modifiers: mods, roundsPerDay, rageName, messages };
}


// ═══════════════════════════════════════════════════════
//  F L U R R Y   O F   B L O W S
// ═══════════════════════════════════════════════════════

export function getFlurryAttacks(character) {
  const level = character.level || 1;
  if (!MONK_FLURRY_OF_BLOWS.classes.includes(character.class)) {
    return { extraAttacks: 0, attackPenalty: 0, messages: ['Not a Monk'] };
  }
  const extra = MONK_FLURRY_OF_BLOWS.extraAttacks(level);
  const penalty = MONK_FLURRY_OF_BLOWS.attackPenalty(level);
  return {
    extraAttacks: extra, attackPenalty: penalty,
    messages: [`Flurry of Blows: ${extra} extra attack${extra > 1 ? 's' : ''}${penalty ? ` at ${penalty}` : ''}`],
  };
}


// ═══════════════════════════════════════════════════════
//  M O N K   U N A R M E D   D A M A G E
// ═══════════════════════════════════════════════════════

export function getMonkUnarmedDamage(character) {
  if (character.class !== 'Monk') return null;
  return MONK_UNARMED_STRIKE.damageDice(character.level || 1, character.size || 'Medium');
}


// ═══════════════════════════════════════════════════════
//  M O N K   K I   P O O L
// ═══════════════════════════════════════════════════════

export function resolveKiAbility(character, abilityName) {
  const level = character.level || 1;
  const wisMod = mod(character.abilities?.WIS || 10);
  const poolSize = MONK_KI_POOL.poolSize(level, wisMod);
  const ability = MONK_KI_POOL.abilities[abilityName];

  if (!ability) return { resolved: false, reason: `Unknown ki ability: ${abilityName}` };

  const kiUsed = character.kiUsed || 0;
  if (kiUsed + ability.cost > poolSize) {
    return { resolved: false, reason: `Not enough ki (${poolSize - kiUsed} remaining, need ${ability.cost})` };
  }

  return {
    resolved: true,
    kiCost: ability.cost,
    effect: ability.effect,
    description: ability.description,
    messages: [`Ki (${ability.cost} point): ${ability.description}. ${poolSize - kiUsed - ability.cost} ki remaining.`],
  };
}

export function resolveWholenessOfBody(character) {
  const level = character.level || 1;
  const wisMod = mod(character.abilities?.WIS || 10);
  const poolSize = MONK_KI_POOL.poolSize(level, wisMod);
  const kiUsed = character.kiUsed || 0;

  if (kiUsed + 2 > poolSize) {
    return { resolved: false, reason: `Not enough ki (need 2, have ${poolSize - kiUsed})` };
  }

  return {
    resolved: true,
    healing: level,
    kiCost: 2,
    messages: [`Wholeness of Body: Heal ${level} HP (2 ki). ${poolSize - kiUsed - 2} ki remaining.`],
  };
}

export function resolveQuiveringPalm(character, target) {
  const level = character.level || 1;
  const wisMod = mod(character.abilities?.WIS || 10);
  const saveDC = MONK_QUIVERING_PALM.saveDC(level, wisMod);

  return {
    resolved: true,
    saveDC, saveType: 'Fort',
    onFailedSave: 'death',
    messages: [`Quivering Palm: Target must Fort save DC ${saveDC} or die!`],
  };
}


// ═══════════════════════════════════════════════════════
//  B A R D I C   P E R F O R M A N C E
// ═══════════════════════════════════════════════════════

export function resolveBardicPerformance(character, performanceName = 'inspire_courage') {
  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);

  const perf = BARD_BARDIC_PERFORMANCE.performances[performanceName];
  if (!perf) return { modifiers: {}, messages: ['Unknown performance'] };
  if (level < perf.minLevel) return { modifiers: {}, messages: [`Requires bard level ${perf.minLevel}`] };

  const action = BARD_BARDIC_PERFORMANCE.actionByLevel(level);
  const roundsPerDay = BARD_BARDIC_PERFORMANCE.roundsPerDay(level, chaMod);
  const mods = perf.modifiers ? perf.modifiers(level) : {};

  const messages = [`${perf.name}: ${action} action, ${roundsPerDay} rounds/day`];
  if (mods.attack) messages.push(`+${mods.attack} attack and damage for all allies`);
  if (mods.saves?.fear) messages.push(`+${mods.saves.fear} saves vs fear/charm`);
  if (mods.ac) messages.push(`+${mods.ac} AC for allies`);

  return {
    modifiers: mods, action, roundsPerDay,
    affectsAllies: perf.affectsAllies || false,
    maxTargets: perf.maxTargets ? perf.maxTargets(level) : null,
    messages,
  };
}


// ═══════════════════════════════════════════════════════
//  F I G H T E R   W E A P O N   T R A I N I N G
// ═══════════════════════════════════════════════════════

/**
 * Get Fighter Weapon Training bonus for a specific weapon group.
 */
export function getWeaponTrainingBonus(character, weaponGroup, groupIndex = 0) {
  if (character.class !== 'Fighter') return 0;
  const level = character.level || 1;
  if (level < 5) return 0;
  return FIGHTER_WEAPON_TRAINING.bonusForGroup(level, groupIndex);
}


// ═══════════════════════════════════════════════════════
//  R A N G E R   F A V O R E D   E N E M Y / T E R R A I N
// ═══════════════════════════════════════════════════════

/**
 * Get Favored Enemy bonus for a specific creature type.
 */
export function getFavoredEnemyBonus(character, creatureType, enemyIndex = 0) {
  if (character.class !== 'Ranger') return { bonus: 0, applies: false };
  const level = character.level || 1;
  const bonus = RANGER_FAVORED_ENEMY.bonusForEnemy(level, enemyIndex);
  return {
    bonus,
    applies: bonus > 0,
    modifiers: bonus > 0 ? RANGER_FAVORED_ENEMY.modifiers(bonus) : {},
    messages: bonus > 0 ? [`Favored Enemy (${creatureType}): +${bonus} attack, damage, and related skills`] : [],
  };
}

/**
 * Get Favored Terrain bonus for a specific terrain type.
 */
export function getFavoredTerrainBonus(character, terrainType, terrainIndex = 0) {
  if (character.class !== 'Ranger') return { bonus: 0, applies: false };
  const level = character.level || 1;
  const bonus = RANGER_FAVORED_TERRAIN.bonusForTerrain(level, terrainIndex);
  return {
    bonus,
    applies: bonus > 0,
    modifiers: bonus > 0 ? RANGER_FAVORED_TERRAIN.modifiers(bonus) : {},
    messages: bonus > 0 ? [`Favored Terrain (${terrainType}): +${bonus} initiative, Perception, Stealth, Survival`] : [],
  };
}


// ═══════════════════════════════════════════════════════
//  R O G U E   M A S T E R   S T R I K E
// ═══════════════════════════════════════════════════════

export function resolveMasterStrike(character, target, chosenEffect = 'sleep') {
  const level = character.level || 1;
  const intMod = mod(character.abilities?.INT || 10);
  const saveDC = ROGUE_MASTER_STRIKE.saveDC(level, intMod);

  return {
    resolved: true,
    saveDC, saveType: 'Fort',
    chosenEffect,
    messages: [`Master Strike: Target must Fort save DC ${saveDC} or be ${chosenEffect === 'death' ? 'slain' : chosenEffect}!`],
  };
}


// ═══════════════════════════════════════════════════════
//  R A N G E R   M A S T E R   H U N T E R
// ═══════════════════════════════════════════════════════

export function resolveMasterHunter(character, target) {
  const level = character.level || 1;
  const wisMod = mod(character.abilities?.WIS || 10);
  const saveDC = RANGER_MASTER_HUNTER.saveDC(level, wisMod);

  return {
    resolved: true,
    saveDC, saveType: 'Fort',
    onFailedSave: 'death',
    messages: [`Master Hunter: Favored enemy must Fort save DC ${saveDC} or die!`],
  };
}


// ═══════════════════════════════════════════════════════
//  W I L D   S H A P E
// ═══════════════════════════════════════════════════════

export function resolveWildShape(character, formName = 'beast_shape_i_medium') {
  const level = character.level || 1;
  const formMods = DRUID_WILD_SHAPE.formModifiers[formName];
  if (!formMods) return { resolved: false, reason: `Unknown form: ${formName}` };

  const duration = DRUID_WILD_SHAPE.duration(level);
  return {
    resolved: true,
    modifiers: formMods,
    duration,
    durationUnit: 'hours',
    messages: [`Wild Shape (${formName}): ${duration} hours. Mods: ${JSON.stringify(formMods)}`],
  };
}


// ═══════════════════════════════════════════════════════
//  S O R C E R E R   B L O O D L I N E   P O W E R S
// ═══════════════════════════════════════════════════════

export function resolveBloodlinePower(character, bloodlineName, powerLevel) {
  const bloodline = SORCERER_BLOODLINE.bloodlines[bloodlineName];
  if (!bloodline) return { resolved: false, reason: `Unknown bloodline: ${bloodlineName}` };

  const power = bloodline.powers[powerLevel];
  if (!power) return { resolved: false, reason: `No power at level ${powerLevel} for ${bloodlineName}` };

  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);
  const messages = [`${power.name}: ${power.description || ''}`];

  if (power.damage) messages.push(`Damage: ${power.damage(level)}`);
  if (power.usesPerDay) messages.push(`Uses/day: ${power.usesPerDay(chaMod)}`);

  return {
    resolved: true,
    power,
    messages,
  };
}


// ═══════════════════════════════════════════════════════
//  W I Z A R D   S C H O O L   P O W E R S
// ═══════════════════════════════════════════════════════

export function resolveSchoolPower(character, schoolName, powerLevel) {
  const school = WIZARD_ARCANE_SCHOOL.schools[schoolName];
  if (!school) return { resolved: false, reason: `Unknown school: ${schoolName}` };

  const power = school.powers[powerLevel];
  if (!power) return { resolved: false, reason: `No power at level ${powerLevel} for ${schoolName}` };

  const level = character.level || 1;
  const intMod = mod(character.abilities?.INT || 10);
  const messages = [`${power.name}: ${power.description || ''}`];

  if (power.damage) messages.push(`Damage: ${power.damage(level)}`);
  if (power.usesPerDay) messages.push(`Uses/day: ${power.usesPerDay(intMod)}`);

  return {
    resolved: true,
    power,
    messages,
  };
}


// ═══════════════════════════════════════════════════════
//  E V A S I O N   /   U N C A N N Y   D O D G E
// ═══════════════════════════════════════════════════════

export function hasEvasion(character) {
  const cls = character.class;
  const level = character.level || 1;
  if (!MONK_EVASION.classes.includes(cls)) return false;
  const minLvl = typeof MONK_EVASION.minLevel === 'object' ? (MONK_EVASION.minLevel[cls] || 99) : MONK_EVASION.minLevel;
  return level >= minLvl;
}

export function hasImprovedEvasion(character) {
  const cls = character.class;
  const level = character.level || 1;
  // Monk gets Improved Evasion at 9, Ranger at 16 (separate object)
  return hasClassAbility(cls, level, 'Improved Evasion')
    || hasClassAbility(cls, level, 'Improved Evasion (Ranger)');
}

export function hasUncannyDodge(character) {
  const cls = character.class;
  const level = character.level || 1;
  return hasClassAbility(cls, level, 'Uncanny Dodge')
    || hasClassAbility(cls, level, 'Uncanny Dodge (Bloodrager)')
    || hasClassAbility(cls, level, 'Uncanny Dodge (Skald)');
}

export function hasImprovedUncannyDodge(character) {
  const cls = character.class;
  const level = character.level || 1;
  return hasClassAbility(cls, level, 'Improved Uncanny Dodge')
    || hasClassAbility(cls, level, 'Improved Uncanny Dodge (Bloodrager)')
    || hasClassAbility(cls, level, 'Improved Uncanny Dodge (Skald)');
}

/**
 * Apply evasion to a Reflex save result.
 */
export function applyEvasion(character, savePassed, fullDamage) {
  const improved = hasImprovedEvasion(character);
  const basic = hasEvasion(character);

  if (!basic && !improved) {
    return {
      finalDamage: savePassed ? Math.floor(fullDamage / 2) : fullDamage,
      evasionApplied: false,
      message: savePassed ? 'Reflex save: half damage' : 'Reflex save failed',
    };
  }

  if (savePassed) {
    return {
      finalDamage: 0,
      evasionApplied: true,
      message: `${improved ? 'Improved ' : ''}Evasion: Reflex save passed — no damage!`,
    };
  }

  if (improved) {
    return {
      finalDamage: Math.floor(fullDamage / 2),
      evasionApplied: true,
      message: 'Improved Evasion: Reflex save failed — half damage',
    };
  }

  return {
    finalDamage: fullDamage,
    evasionApplied: false,
    message: 'Evasion: Reflex save failed — full damage',
  };
}


// ═══════════════════════════════════════════════════════
//  D A I L Y   U S E S   T R A C K I N G
// ═══════════════════════════════════════════════════════

/**
 * Get daily use limits for all class abilities that have them.
 */
export function getDailyAbilityUses(character) {
  const cls = character.class;
  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);
  const conMod = mod(character.abilities?.CON || 10);
  const wisMod = mod(character.abilities?.WIS || 10);
  const intMod = mod(character.abilities?.INT || 10);
  const uses = {};

  // ── Cleric ──
  if (cls === 'Cleric') {
    uses['Channel Energy'] = { max: CLERIC_CHANNEL_ENERGY.usesPerDay(level, chaMod), type: 'standard' };
  }

  // ── Paladin ──
  if (cls === 'Paladin') {
    if (level >= 2) uses['Lay on Hands'] = { max: PALADIN_LAY_ON_HANDS.usesPerDay(level, chaMod), type: 'standard/swift' };
    uses['Smite Evil'] = { max: PALADIN_SMITE_EVIL.usesPerDay(level), type: 'swift' };
    if (level >= 4) uses['Channel Positive Energy'] = { max: 3 + chaMod, type: 'standard', note: 'costs 2 Lay on Hands uses' };
    if (level >= 5) uses['Divine Bond'] = { max: PALADIN_DIVINE_BOND.weaponBond.usesPerDay(level), type: 'standard', note: 'weapon enchant or mount' };
  }

  // ── Barbarian ──
  if (cls === 'Barbarian') {
    uses['Rage'] = { max: BARBARIAN_RAGE.roundsPerDay(level, conMod), type: 'rounds' };
  }

  // ── Bard ──
  if (cls === 'Bard') {
    uses['Bardic Performance'] = { max: BARD_BARDIC_PERFORMANCE.roundsPerDay(level, chaMod), type: 'rounds' };
  }

  // ── Monk ──
  if (cls === 'Monk') {
    uses['Stunning Fist'] = { max: level, type: 'standard' };
    if (level >= 4) {
      uses['Ki Pool'] = { max: MONK_KI_POOL.poolSize(level, wisMod), type: 'points' };
      if (level >= 7) uses['Wholeness of Body'] = { max: Math.floor(MONK_KI_POOL.poolSize(level, wisMod) / 2), type: 'uses (2 ki each)' };
      if (level >= 15) uses['Quivering Palm'] = { max: 1, type: 'standard' };
    }
  }

  // ── Druid ──
  if (cls === 'Druid' && level >= 4) {
    uses['Wild Shape'] = { max: DRUID_WILD_SHAPE.usesPerDay(level), type: 'standard' };
  }

  // ── Ranger ──
  if (cls === 'Ranger' && level >= 20) {
    uses['Master Hunter'] = { max: 1, type: 'standard', note: 'vs favored enemy only' };
  }

  // ── Rogue ──
  if (cls === 'Rogue' && level >= 20) {
    uses['Master Strike'] = { max: Infinity, type: 'passive', note: 'once per sneak attack' };
  }

  // ── Sorcerer (bloodline powers) ──
  if (cls === 'Sorcerer') {
    // Level 1 bloodline power typically has 3+CHA/day
    uses['Bloodline Power (1st)'] = { max: 3 + chaMod, type: 'standard' };
    if (level >= 9) uses['Bloodline Power (9th)'] = { max: 1, type: 'standard' };
  }

  // ── Wizard (school powers) ──
  if (cls === 'Wizard') {
    uses['School Power (1st)'] = { max: 3 + intMod, type: 'standard' };
    uses['Bonded Object'] = { max: 1, type: 'free', note: 'cast one known spell' };
  }

  // ── APG CLASSES ──

  if (cls === 'Alchemist') {
    uses['Bomb'] = { max: ALCHEMIST_BOMB.usesPerDay(level, intMod), type: 'standard' };
    uses['Mutagen'] = { max: 1, type: 'brew (1 hour)', note: 'one at a time' };
  }

  if (cls === 'Cavalier') {
    uses['Challenge'] = { max: CAVALIER_CHALLENGE.usesPerDay(level), type: 'swift' };
  }

  if (cls === 'Inquisitor') {
    uses['Judgment'] = { max: INQUISITOR_JUDGMENT.usesPerDay(level), type: 'swift' };
    if (level >= 5) uses['Bane'] = { max: level, type: 'rounds' };
    if (level >= 5) uses['Discern Lies'] = { max: level, type: 'rounds' };
    if (level >= 20) uses['True Judgment'] = { max: 1, type: 'swift' };
  }

  if (cls === 'Summoner') {
    uses['Summon Monster'] = { max: SUMMONER_SUMMON_MONSTER.usesPerDay(level, chaMod), type: 'full-round' };
  }

  if (cls === 'Witch') {
    // Hexes are 1/target/24hrs — not a simple uses/day count
    uses['Hexes'] = { max: Infinity, type: 'standard', note: 'each hex once per target per 24 hours' };
  }

  // ── Oracle ──
  if (cls === 'Oracle') {
    // Revelations with daily uses depend on mystery — track generically
    uses['Revelation (Active)'] = { max: 3 + chaMod, type: 'varies', note: 'varies by mystery' };
  }

  // ── APG/ACG CLASSES ──

  if (cls === 'Shaman') {
    // Shaman hexes work like Witch hexes — 1/target/24hrs
    uses['Shaman Hex'] = { max: Infinity, type: 'standard', note: 'each hex once per target per 24 hours' };
  }

  if (cls === 'Hunter') {
    uses['Animal Focus'] = { max: Infinity, type: 'swift', note: 'minutes/day = level at self, unlimited on companion' };
  }

  // ── ACG CLASSES ──

  if (cls === 'Arcanist') {
    uses['Arcane Reservoir'] = { max: ARCANIST_ARCANE_RESERVOIR.poolSize(level, chaMod), type: 'points' };
  }

  if (cls === 'Bloodrager') {
    uses['Bloodrage'] = { max: BLOODRAGER_BLOODRAGE.roundsPerDay(level, conMod), type: 'rounds' };
  }

  if (cls === 'Brawler') {
    uses['Martial Flexibility'] = { max: BRAWLER_MARTIAL_FLEXIBILITY.usesPerDay(level), type: BRAWLER_MARTIAL_FLEXIBILITY.actionByLevel(level) };
    if (level >= 4) uses['Knockout'] = { max: BRAWLER_KNOCKOUT.usesPerDay(level), type: 'standard' };
  }

  if (cls === 'Skald') {
    uses['Raging Song'] = { max: SKALD_RAGING_SONG.roundsPerDay(level, chaMod), type: 'rounds' };
    if (level >= 5) uses['Spell Kenning'] = { max: level >= 17 ? 3 : level >= 11 ? 2 : 1, type: 'standard', note: 'cast any spell from bard/cleric/wizard list' };
  }

  if (cls === 'Slayer') {
    // Studied target doesn't have a daily limit per se, but uses per simultaneous targets
    uses['Studied Target'] = { max: SLAYER_STUDIED_TARGET.simultaneousTargets(level), type: 'simultaneous targets' };
  }

  if (cls === 'Swashbuckler') {
    uses['Panache'] = { max: SWASHBUCKLER_PANACHE.poolSize(chaMod), type: 'points', note: 'regain on crit/kill' };
    if (level >= 2) uses['Charmed Life'] = { max: SWASHBUCKLER_CHARMED_LIFE.usesPerDay(level), type: 'immediate' };
  }

  if (cls === 'Warpriest') {
    uses['Sacred Weapon'] = { max: WARPRIEST_SACRED_WEAPON.enchantRoundsPerDay(level), type: 'rounds' };
    uses['Blessings'] = { max: 3 + Math.floor(level / 2), type: 'swift' };
    if (level >= 2) uses['Fervor'] = { max: WARPRIEST_FERVOR.usesPerDay(level, wisMod), type: 'swift/standard' };
    if (level >= 7) uses['Sacred Armor'] = { max: WARPRIEST_SACRED_ARMOR.enchantRoundsPerDay(level), type: 'rounds' };
    if (level >= 20) uses['Aspect of War'] = { max: 1, type: 'swift', note: '1 minute duration' };
  }

  if (cls === 'Investigator') {
    uses['Inspiration'] = { max: INVESTIGATOR_INSPIRATION.poolSize(level, intMod), type: 'points', note: 'free on Knowledge/Linguistics/Spellcraft' };
  }

  return uses;
}


// ═══════════════════════════════════════════════════════
//  A P G / A C G   R E S O L V E R S
// ═══════════════════════════════════════════════════════

export function resolveAlchemistBomb(character, target) {
  const level = character.level || 1;
  const intMod = mod(character.abilities?.INT || 10);
  const numDice = Math.ceil(level / 2);
  let total = 0;
  for (let i = 0; i < numDice; i++) total += Math.floor(Math.random() * 6) + 1;
  total += intMod;
  const splash = numDice + intMod;
  const saveDC = ALCHEMIST_BOMB.saveDC(level, intMod);
  return {
    resolved: true, damage: total, splash, saveDC, saveType: 'Reflex',
    attackType: 'ranged_touch',
    messages: [`Bomb: ${numDice}d6+${intMod} = ${total} fire (splash ${splash}, Ref DC ${saveDC})`],
  };
}

export function resolveMutagen(character, chosenAbility = 'STR') {
  const level = character.level || 1;
  const mods = ALCHEMIST_MUTAGEN.modifiers(chosenAbility);
  const duration = ALCHEMIST_MUTAGEN.duration(level);
  return {
    resolved: true, modifiers: mods, duration, durationUnit: 'minutes',
    messages: [`Mutagen (${chosenAbility}): +4 ${chosenAbility}, +2 natural armor, ${duration} minutes`],
  };
}

export function resolveJudgment(character, judgmentType = 'destruction') {
  const level = character.level || 1;
  const judgment = INQUISITOR_JUDGMENT.judgments[judgmentType];
  if (!judgment) return { resolved: false, reason: `Unknown judgment: ${judgmentType}` };

  const bonusKey = Object.keys(judgment)[0];
  const bonus = judgment[bonusKey](level);
  return {
    resolved: true, judgmentType, bonus,
    messages: [`Judgment (${judgmentType}): +${bonus} ${bonusKey}`],
  };
}

export function resolveStudiedTarget(character, target) {
  const level = character.level || 1;
  const bonus = SLAYER_STUDIED_TARGET.bonus(level);
  const action = SLAYER_STUDIED_TARGET.actionByLevel(level);
  return {
    resolved: true, bonus, action,
    modifiers: SLAYER_STUDIED_TARGET.modifiers(bonus),
    messages: [`Studied Target: +${bonus} attack, damage, and skill checks vs target (${action} action)`],
  };
}

export function resolveBloodrage(character) {
  const level = character.level || 1;
  const conMod = mod(character.abilities?.CON || 10);
  const mods = BLOODRAGER_BLOODRAGE.modifiers(level);
  const roundsPerDay = BLOODRAGER_BLOODRAGE.roundsPerDay(level, conMod);
  const rageName = level >= 20 ? 'Mighty Bloodrage' : level >= 11 ? 'Greater Bloodrage' : 'Bloodrage';
  return {
    modifiers: mods, roundsPerDay, rageName,
    canCast: true, // Can cast bloodline spells
    messages: [`${rageName}: +${mods.strBonus} STR, +${mods.conBonus} CON, +${mods.saves.Will} Will, -2 AC. Can cast bloodline spells. ${roundsPerDay} rounds/day`],
  };
}

export function resolveRagingSong(character) {
  const level = character.level || 1;
  const chaMod = mod(character.abilities?.CHA || 10);
  const mods = SKALD_RAGING_SONG.modifiers(level);
  const roundsPerDay = SKALD_RAGING_SONG.roundsPerDay(level, chaMod);
  const action = SKALD_RAGING_SONG.actionByLevel(level);
  return {
    modifiers: mods, roundsPerDay, action, affectsAllies: true,
    messages: [`Raging Song: +${mods.strBonus} STR, +${mods.conBonus} CON, +${mods.saves.Will} Will, ${mods.ac} AC for all allies (${action} action, ${roundsPerDay} rounds/day)`],
  };
}

export function resolveAnimalFocus(character, focus = 'bear') {
  const level = character.level || 1;
  const tiers = HUNTER_ANIMAL_FOCUS.scaling(level);
  const baseMods = HUNTER_ANIMAL_FOCUS.foci[focus];
  if (!baseMods) return { resolved: false, reason: `Unknown focus: ${focus}` };
  // Scale bonuses using tier-appropriate values
  const scaled = {};
  for (const [k, v] of Object.entries(baseMods)) {
    if (typeof v === 'boolean') {
      scaled[k] = v; // evasion, etc. — not scaled
    } else if (['perception', 'stealth', 'climb'].includes(k)) {
      scaled[k] = tiers.competence;
    } else if (['speedBonus'].includes(k)) {
      scaled[k] = tiers.speed;
    } else if (typeof v === 'number') {
      scaled[k] = tiers.enhancement;
    } else {
      scaled[k] = v;
    }
  }
  return { resolved: true, modifiers: scaled, messages: [`Animal Focus (${focus}): ${JSON.stringify(scaled)}`] };
}

export function resolveFervor(character, target) {
  const level = character.level || 1;
  const numDice = Math.max(1, Math.floor(level / 3));
  let total = 0;
  for (let i = 0; i < numDice; i++) total += Math.floor(Math.random() * 6) + 1;
  const isSelf = target?.id === character.id;
  return {
    healing: total, numDice, action: isSelf ? 'swift' : 'standard',
    messages: [`Fervor: ${numDice}d6 = ${total} HP healed (${isSelf ? 'swift — self' : 'standard'})`],
  };
}

export function resolveStunningFist(character, target) {
  const level = character.level || 1;
  const wisMod = mod(character.abilities?.WIS || 10);
  const saveDC = MONK_STUNNING_FIST.saveDC(level, wisMod);
  let effect = 'stunned_1_round';
  if (level >= 20) effect = 'paralyzed_1d6p1_rounds';
  else if (level >= 16) effect = 'permanent_blind_or_deaf';
  else if (level >= 12) effect = 'staggered_1d6p1_rounds';
  else if (level >= 8) effect = 'sickened_1_minute';
  else if (level >= 4) effect = 'fatigued';

  return {
    resolved: true,
    saveDC, saveType: 'Fort', effect,
    messages: [`Stunning Fist: Target must Fort save DC ${saveDC} or be ${effect}!`],
  };
}

export function resolveCavalierChallenge(character, target) {
  const level = character.level || 1;
  return {
    resolved: true,
    damage: level,
    acPenaltyVsOthers: -2,
    messages: [`Challenge: +${level} damage vs target, -2 AC vs all other enemies`],
  };
}

export function resolveInquisitorBane(character) {
  const level = character.level || 1;
  const isGreater = level >= 12;
  const bonus = isGreater ? 4 : 2;
  const damageDice = isGreater ? '4d6' : '2d6';
  return {
    resolved: true,
    modifiers: { attack: bonus, damage: damageDice },
    roundsPerDay: level,
    messages: [`${isGreater ? 'Greater ' : ''}Bane: +${bonus} enhancement, +${damageDice} damage (${level} rounds/day)`],
  };
}

export function resolveKnockout(character, target) {
  const level = character.level || 1;
  const strMod = mod(character.abilities?.STR || 10);
  const saveDC = BRAWLER_KNOCKOUT.saveDC(level, strMod);
  return {
    resolved: true,
    saveDC, saveType: 'Fort',
    effect: 'unconscious_1d6_rounds',
    messages: [`Knockout: Target must Fort save DC ${saveDC} or fall unconscious 1d6 rounds!`],
  };
}

export function resolveStudiedCombat(character, target) {
  const level = character.level || 1;
  const intMod = mod(character.abilities?.INT || 10);
  const bonus = INVESTIGATOR_STUDIED_COMBAT.bonus(level);
  const action = INVESTIGATOR_STUDIED_COMBAT.actionByLevel(level);
  const duration = Math.max(1, intMod);
  return {
    resolved: true, bonus, action, duration,
    modifiers: { attack: bonus, damage: bonus },
    messages: [`Studied Combat: +${bonus} insight to attack/damage for ${duration} rounds (${action} action)`],
  };
}

export function resolveStudiedStrike(character) {
  const level = character.level || 1;
  const numDice = INVESTIGATOR_STUDIED_STRIKE.scaling.dicePerLevel(level);
  let total = 0;
  for (let i = 0; i < numDice; i++) total += Math.floor(Math.random() * 6) + 1;
  return {
    resolved: true,
    damage: total, dice: numDice, sides: 6,
    messages: [`Studied Strike: ${numDice}d6 = ${total} precision damage (ends Studied Combat)`],
  };
}

export function resolveCharmedLife(character) {
  const chaMod = mod(character.abilities?.CHA || 10);
  return {
    resolved: true,
    saveBonus: Math.max(0, chaMod),
    messages: [`Charmed Life: +${Math.max(0, chaMod)} to one saving throw (immediate action)`],
  };
}

export function resolvePreciseStrike(character) {
  const level = character.level || 1;
  return {
    resolved: true,
    damage: level,
    messages: [`Precise Strike: +${level} precision damage with light/one-handed piercing`],
  };
}

export function resolveWitchHex(character, hexName, target) {
  const level = character.level || 1;
  const intMod = mod(character.abilities?.INT || 10);
  const saveDC = 10 + Math.floor(level / 2) + intMod;
  const hex = WITCH_HEX.commonHexes?.[hexName];

  if (!hex) {
    return { resolved: true, saveDC, saveType: 'Will', messages: [`Hex (${hexName}): DC ${saveDC} Will save`] };
  }

  const messages = [`${hexName}: DC ${saveDC} ${hex.saveType || 'Will'} save`];
  if (hex.duration) messages.push(`Duration: ${typeof hex.duration === 'function' ? hex.duration(level) : hex.duration}`);

  return {
    resolved: true, saveDC,
    saveType: hex.saveType || 'Will',
    effect: hex.effect || hexName,
    messages,
  };
}

export function resolveSacredWeapon(character, enchantments = []) {
  const level = character.level || 1;
  const bonus = WARPRIEST_SACRED_WEAPON.enchantBonus(level);
  const duration = level; // rounds
  const messages = [`Sacred Weapon: +${bonus} enhancement (${duration} rounds/day)`];
  if (enchantments.length) messages.push(`Enchantments: ${enchantments.join(', ')}`);

  return {
    resolved: true,
    enchantBonus: bonus,
    durationRounds: duration,
    enchantments,
    messages,
  };
}

export function resolveSacredArmor(character, enchantments = []) {
  const level = character.level || 1;
  const bonus = WARPRIEST_SACRED_ARMOR.enchantBonus(level);
  const duration = level; // rounds
  const messages = [`Sacred Armor: +${bonus} enhancement (${duration} rounds/day)`];
  if (enchantments.length) messages.push(`Enchantments: ${enchantments.join(', ')}`);

  return {
    resolved: true,
    enchantBonus: bonus,
    durationRounds: duration,
    enchantments,
    messages,
  };
}

export function resolveMartialFlexibility(character, featName) {
  const level = character.level || 1;
  const action = BRAWLER_MARTIAL_FLEXIBILITY.actionByLevel(level);
  const featsGained = level >= 15 ? 3 : level >= 9 ? 2 : 1;
  const duration = 1; // minutes

  return {
    resolved: true,
    feat: featName || 'chosen combat feat',
    featsGained,
    action,
    durationMinutes: duration,
    messages: [`Martial Flexibility: Gain ${featsGained} feat(s) (${action} action, 1 min). Feat: ${featName || 'TBD'}`],
  };
}


// ═══════════════════════════════════════════════════════
//  M A S T E R   R E S O L V E R
// ═══════════════════════════════════════════════════════

/**
 * Resolve a class ability by name, returning its mechanical effect.
 * Main entry point for combat systems.
 */
export function resolveClassAbility(abilityName, character, context = {}) {
  switch (abilityName) {
    case 'Sneak Attack':
      return computeSneakAttackDamage(character, context);
    case 'Channel Energy':
    case 'Channel Positive Energy':
      return resolveChannelEnergy(character, context.targets || [], context.mode || 'heal');
    case 'Lay on Hands':
      return resolveLayOnHands(character, context.target, context.isUndead || false);
    case 'Smite Evil':
      return resolveSmiteEvil(character, context.target);
    case 'Rage':
      return resolveRage(character);
    case 'Flurry of Blows':
      return getFlurryAttacks(character);
    case 'Bardic Performance':
      return resolveBardicPerformance(character, context.performance || 'inspire_courage');
    case 'Ki Pool':
      return resolveKiAbility(character, context.kiAbility || 'extra_attack');
    case 'Wholeness of Body':
      return resolveWholenessOfBody(character);
    case 'Quivering Palm':
      return resolveQuiveringPalm(character, context.target);
    case 'Wild Shape':
      return resolveWildShape(character, context.form || 'beast_shape_i_medium');
    case 'Weapon Training':
      return { bonus: getWeaponTrainingBonus(character, context.weaponGroup, context.groupIndex || 0) };
    case 'Favored Enemy':
      return getFavoredEnemyBonus(character, context.creatureType, context.enemyIndex || 0);
    case 'Favored Terrain':
      return getFavoredTerrainBonus(character, context.terrainType, context.terrainIndex || 0);
    case 'Master Strike':
      return resolveMasterStrike(character, context.target, context.effect || 'sleep');
    case 'Master Hunter':
      return resolveMasterHunter(character, context.target);
    case 'Bloodline Power':
      return resolveBloodlinePower(character, context.bloodline, context.powerLevel || 1);
    case 'School Power':
      return resolveSchoolPower(character, context.school, context.powerLevel || 1);

    case 'Stunning Fist':
      return resolveStunningFist(character, context.target);

    // APG classes
    case 'Bomb':
      return resolveAlchemistBomb(character, context.target);
    case 'Mutagen':
      return resolveMutagen(character, context.ability || 'STR');
    case 'Judgment':
      return resolveJudgment(character, context.judgmentType || 'destruction');
    case 'Challenge':
      return resolveCavalierChallenge(character, context.target);
    case 'Bane':
      return resolveInquisitorBane(character);

    // ACG classes
    case 'Studied Target':
      return resolveStudiedTarget(character, context.target);
    case 'Bloodrage':
      return resolveBloodrage(character);
    case 'Raging Song':
      return resolveRagingSong(character);
    case 'Animal Focus':
      return resolveAnimalFocus(character, context.focus || 'bear');
    case 'Fervor':
      return resolveFervor(character, context.target);
    case 'Precise Strike':
      return resolvePreciseStrike(character);
    case 'Knockout':
      return resolveKnockout(character, context.target);
    case 'Studied Combat':
      return resolveStudiedCombat(character, context.target);
    case 'Studied Strike':
      return resolveStudiedStrike(character);
    case 'Charmed Life':
      return resolveCharmedLife(character);

    // New resolvers (pass 7)
    case 'Hexes':
    case 'Hex':
      return resolveWitchHex(character, context.hexName || 'Evil Eye', context.target);
    case 'Sacred Weapon':
      return resolveSacredWeapon(character, context.enchantments || []);
    case 'Sacred Armor':
      return resolveSacredArmor(character, context.enchantments || []);
    case 'Martial Flexibility':
      return resolveMartialFlexibility(character, context.feat);

    default:
      return { resolved: false, reason: `No active resolver for ${abilityName}` };
  }
}


// ═══════════════════════════════════════════════════════
//  A I   C O N T E X T
// ═══════════════════════════════════════════════════════

/**
 * Get a summary of class abilities for AI DM context.
 */
export function getClassAbilitiesContextForAI(character) {
  const cls = character.class;
  const level = character.level || 1;
  const abilities = getClassAbilitiesForLevel(cls, level);
  if (!abilities.length) return '';

  const parts = abilities.map(name => {
    if (name === 'Sneak Attack') return `Sneak Attack ${ROGUE_SNEAK_ATTACK.scaling.dicePerLevel(level)}d6`;
    if (name === 'Damage Reduction' && cls === 'Barbarian') return `DR ${BARBARIAN_DR.dr(level)}/-`;
    if (name === 'Weapon Training' && cls === 'Fighter') return `Weapon Training +${FIGHTER_WEAPON_TRAINING.bonusForGroup(level, 0)}`;
    if (name === 'Favored Enemy') return `Favored Enemy +${RANGER_FAVORED_ENEMY.bonusForEnemy(level, 0)}`;
    if (name === 'Diamond Soul') return `SR ${MONK_DIAMOND_SOUL.sr(level)}`;
    return name;
  });

  return `[Class Abilities: ${parts.join(', ')}]`;
}
