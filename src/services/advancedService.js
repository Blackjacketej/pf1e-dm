/**
 * advancedService.js — PF1e Advanced GMG/UC Systems Engine
 * Mass Combat, Reputation/Fame, Honor, Contacts, Investigations,
 * Sanity/Madness, Magic Item Crafting, Bargaining, Gambling, Disasters,
 * Trade Routes, Espionage, Alignment, Lineage, Retirement.
 */
import advData from '../data/advancedSystems.json';
import { rollDice as rollDiceRaw } from '../utils/dice';
import { getMerchantSkills, attitudeBonus as attitudeBonusFor, attitudeBaseDiscount as attitudeBaseDiscountFor, refusesService } from './merchantSkills';
import { getCharacterSkillTotal } from '../utils/characterSkills';

// Local wrapper: every call site in this file uses rollDice as if it returned
// a plain number (e.g. `rollDice(1, 20) + skillBonus`). The canonical helper in
// utils/dice returns `{ total, rolls }`, which silently coerced into strings
// like "[object Object]" and broke every d20 check here. Unwrap to .total so
// the existing call sites continue to work arithmetically.
const rollDice = (count, sides) => rollDiceRaw(count, sides).total;

// ═══════════════════════════════════════════════════
// MASS COMBAT
// ═══════════════════════════════════════════════════

export function createArmy(name, acr, size, type, commander = null) {
  const sizeData = advData.massCombat.armySizes.find(s => s.size === size) || advData.massCombat.armySizes[4];
  const typeData = advData.massCombat.armyTypes.find(t => t.id === type) || advData.massCombat.armyTypes[0];
  const cmdBonus = commander ? getCommanderBonus(commander) : 0;

  return {
    name,
    acr,
    size: sizeData.size,
    type: typeData.name,
    hp: Math.max(1, Math.round(acr * 4.5)),
    maxHp: Math.max(1, Math.round(acr * 4.5)),
    om: acr + typeData.omBonus + sizeData.omMod + cmdBonus,
    dv: 10 + acr + sizeData.dvMod,
    speed: typeData.speed,
    morale: 0,
    consumption: Math.max(1, Math.ceil(parseInt(sizeData.creatures) / (sizeData.consumptionDiv || 1))),
    tactics: 'standard',
    specialAbilities: [],
    commander: commander?.name || 'None',
    commanderBonus: cmdBonus,
    routed: false
  };
}

function getCommanderBonus(commander) {
  const cha = commander?.abilities?.CHA || commander?.cha || 10;
  if (cha >= 28) return 5;
  if (cha >= 24) return 4;
  if (cha >= 20) return 3;
  if (cha >= 16) return 2;
  if (cha >= 12) return 1;
  return 0;
}

export function applyBattlefieldConditions(army, terrainType) {
  const terrain = advData.massCombat.battlefieldConditions.find(t => t.terrain === terrainType);
  if (!terrain) return { om: 0, dv: 0, speed: 0, special: '' };

  return {
    om: terrain.omMod,
    dv: terrain.dvMod,
    speed: terrain.speedMod,
    special: terrain.special,
    terrain: terrainType
  };
}

export function applySpecialAbilities(army) {
  if (!army.specialAbilities || army.specialAbilities.length === 0) {
    return { totalOmBonus: 0, totalDvBonus: 0, abilities: [] };
  }

  let totalOmBonus = 0;
  let totalDvBonus = 0;
  const appliedAbilities = [];

  for (const abilityId of army.specialAbilities) {
    const ability = advData.massCombat.specialAbilities.find(a => a.id === abilityId);
    if (ability) {
      totalOmBonus += (ability.omMod || 0);
      totalDvBonus += (ability.dvMod || 0);
      appliedAbilities.push({
        name: ability.name,
        om: ability.omMod || 0,
        dv: ability.dvMod || 0,
        effect: ability.effect || ability.description
      });
    }
  }

  return { totalOmBonus, totalDvBonus, abilities: appliedAbilities };
}

export function checkRoutRecovery(army, commanderDiplomacyMod = 0) {
  const dc = 20;
  const checkBonus = commanderDiplomacyMod;
  const roll = rollDice(1, 20);
  const total = roll + checkBonus;
  const recovered = total >= dc;

  return {
    roll,
    total,
    dc,
    recovered,
    newRouted: recovered ? false : army.routed,
    description: recovered
      ? `${army.name} recovers from rout! (${roll}+${checkBonus}=${total} vs DC ${dc})`
      : `${army.name} remains routed. (${roll}+${checkBonus}=${total} vs DC ${dc})`
  };
}

export function calculateArmyConsumption(army) {
  const sizeData = advData.massCombat.armySizes.find(s => s.size === army.size);
  if (!sizeData) return { weeklyConsumption: 0, monthlyConsumption: 0 };

  const creatures = parseInt(sizeData.creatures.replace('+', ''));
  const consumptionDiv = sizeData.consumptionDiv || 1;
  const weeklyUnits = Math.max(1, Math.ceil(creatures / consumptionDiv));

  return {
    weeklyConsumption: weeklyUnits,
    monthlyConsumption: weeklyUnits * 4,
    unitsAffected: creatures,
    description: `${army.name} consumes ${weeklyUnits} units of supplies per week (${weeklyUnits * 4} per month)`
  };
}

export function applyCommanderTier(army, commander) {
  if (!commander || !commander.level) {
    return { tier: null, abilities: [], maxArmies: 1, bonusOM: 0, bonusDV: 0 };
  }

  let tier = null;
  if (commander.level >= 20) tier = advData.massCombat.commanderTiers[3];
  else if (commander.level >= 15) tier = advData.massCombat.commanderTiers[2];
  else if (commander.level >= 10) tier = advData.massCombat.commanderTiers[1];
  else if (commander.level >= 5) tier = advData.massCombat.commanderTiers[0];

  if (!tier) return { tier: null, abilities: [], maxArmies: 1, bonusOM: 0, bonusDV: 0 };

  let bonusOM = 0, bonusDV = 0;
  if (tier.tier === '4') {
    bonusOM = 2;
    bonusDV = 2;
  }

  return {
    tier: parseInt(tier.tier),
    abilities: tier.abilities,
    maxArmies: tier.special.match(/\d+/)[0],
    bonusOM,
    bonusDV,
    description: `Commander Tier ${tier.tier}: ${tier.special}`
  };
}

export function resolveMassCombatRound(attackArmy, defenseArmy, battlefieldTerrain = null) {
  // Apply battlefield conditions
  let aBattleModOM = 0, aBattleModDV = 0;
  let dBattleModOM = 0, dBattleModDV = 0;
  if (battlefieldTerrain) {
    const aTerrainMod = applyBattlefieldConditions(attackArmy, battlefieldTerrain);
    aBattleModOM = aTerrainMod.om;
    aBattleModDV = aTerrainMod.dv;
    // Defenders often get advantage in certain terrains
    dBattleModDV = aTerrainMod.dv;
  }

  // Apply special abilities
  const aSpecial = applySpecialAbilities(attackArmy);
  const dSpecial = applySpecialAbilities(defenseArmy);

  const aTactic = advData.massCombat.tactics.find(t => t.id === attackArmy.tactics) || { omMod: 0, dvMod: 0 };
  const dTactic = advData.massCombat.tactics.find(t => t.id === defenseArmy.tactics) || { omMod: 0, dvMod: 0 };

  // Attacker rolls
  const aRoll = rollDice(1, 20);
  const aOM = attackArmy.om + aTactic.omMod + attackArmy.morale + aBattleModOM + aSpecial.totalOmBonus;
  const aTotal = aRoll + aOM;
  const dDV = defenseArmy.dv + dTactic.dvMod + dBattleModDV + dSpecial.totalDvBonus;

  // Defender rolls
  const dRoll = rollDice(1, 20);
  const dOM = defenseArmy.om + dTactic.omMod + defenseArmy.morale + dBattleModOM + dSpecial.totalOmBonus;
  const dTotal = dRoll + dOM;
  const aDV = attackArmy.dv + aTactic.dvMod + aBattleModDV + aSpecial.totalDvBonus;

  const results = [];

  // Attacker damage to defender
  if (aTotal >= dDV) {
    const dmg = Math.max(1, Math.floor((aTotal - dDV) / 4) + 1);
    defenseArmy.hp -= dmg;
    results.push(`${attackArmy.name} hits ${defenseArmy.name} for ${dmg} HP (${aRoll}+${aOM}=${aTotal} vs DV ${dDV})`);
  } else {
    results.push(`${attackArmy.name} misses ${defenseArmy.name} (${aRoll}+${aOM}=${aTotal} vs DV ${dDV})`);
  }

  // Defender damage to attacker
  if (dTotal >= aDV) {
    const dmg = Math.max(1, Math.floor((dTotal - aDV) / 4) + 1);
    attackArmy.hp -= dmg;
    results.push(`${defenseArmy.name} hits ${attackArmy.name} for ${dmg} HP (${dRoll}+${dOM}=${dTotal} vs DV ${aDV})`);
  } else {
    results.push(`${defenseArmy.name} misses ${attackArmy.name} (${dRoll}+${dOM}=${dTotal} vs DV ${aDV})`);
  }

  // Morale checks
  if (defenseArmy.hp > 0 && defenseArmy.hp <= defenseArmy.maxHp / 2) {
    const moraleCheck = rollDice(1, 20) + defenseArmy.morale;
    if (moraleCheck < 15) {
      defenseArmy.morale -= 1;
      results.push(`${defenseArmy.name} morale drops to ${defenseArmy.morale}!`);
    }
  }
  if (attackArmy.hp > 0 && attackArmy.hp <= attackArmy.maxHp / 2) {
    const moraleCheck = rollDice(1, 20) + attackArmy.morale;
    if (moraleCheck < 15) {
      attackArmy.morale -= 1;
      results.push(`${attackArmy.name} morale drops to ${attackArmy.morale}!`);
    }
  }

  // Check for rout
  if (defenseArmy.morale <= -4) { defenseArmy.routed = true; results.push(`${defenseArmy.name} ROUTS!`); }
  if (attackArmy.morale <= -4) { attackArmy.routed = true; results.push(`${attackArmy.name} ROUTS!`); }
  if (defenseArmy.hp <= 0) { results.push(`${defenseArmy.name} is DESTROYED!`); }
  if (attackArmy.hp <= 0) { results.push(`${attackArmy.name} is DESTROYED!`); }

  return { results, attackArmy, defenseArmy, battleOver: attackArmy.hp <= 0 || defenseArmy.hp <= 0 || attackArmy.routed || defenseArmy.routed };
}

export function getArmyTactics() { return advData.massCombat.tactics; }
export function getArmySizes() { return advData.massCombat.armySizes; }
export function getArmyTypes() { return advData.massCombat.armyTypes; }

// ═══════════════════════════════════════════════════
// REPUTATION / FAME
// ═══════════════════════════════════════════════════

export function getFameTier(fame) {
  const tiers = advData.reputation.fameTiers;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (fame >= tiers[i].fame) return tiers[i];
  }
  return tiers[0];
}

export function getInfamyTier(infamy) {
  const tiers = advData.reputation.infamyTiers;
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (infamy >= tiers[i].infamy) return tiers[i];
  }
  return tiers[0];
}

export function spendFame(currentFame, benefitId) {
  const benefits = advData.reputation.spendFame;
  const benefit = benefits.find(b => b.benefit === benefitId || b.id === benefitId);

  if (!benefit) return { success: false, error: 'Benefit not found' };
  if (currentFame < benefit.cost) {
    return { success: false, error: `Insufficient fame. Need ${benefit.cost}, have ${currentFame}` };
  }

  return {
    success: true,
    benefit: benefit.benefit,
    cost: benefit.cost,
    newFame: currentFame - benefit.cost,
    description: benefit.description,
    requirements: benefit.prerequisites,
    fameSpent: benefit.cost,
    fameRemaining: currentFame - benefit.cost
  };
}

export function getSpendFameOptions(currentFame) {
  const benefits = advData.reputation.spendFame;
  const affordable = benefits.filter(b => currentFame >= b.cost);

  return {
    currentFame,
    availableBenefits: affordable,
    totalOptions: affordable.length,
    options: affordable.map(b => ({
      name: b.benefit,
      cost: b.cost,
      description: b.description,
      prerequisites: b.prerequisites,
      canAfford: currentFame >= b.cost
    }))
  };
}

export function getSphereInfluence(sphereId) {
  const sphere = advData.reputation.spheresOfInfluence.find(s => s.id === sphereId || s.sphere === sphereId);

  if (!sphere) return { error: 'Sphere not found' };

  return {
    sphere: sphere.sphere,
    benefits: sphere.benefits,
    drawbacks: sphere.drawbacks,
    cost: sphere.cost,
    description: sphere.description || ''
  };
}

export function getReputationData() { return advData.reputation; }

// ═══════════════════════════════════════════════════
// HONOR
// ═══════════════════════════════════════════════════

export function calculateStartingHonor(chaMod) {
  return Math.max(1, 3 + chaMod);
}

export function getHonorBenefit(honor) {
  const benefits = advData.honor.honorBenefits.filter(b => honor >= b.threshold);
  return benefits;
}

export function getHonorCode(codeId) {
  const codes = advData.honor.honorCodes;
  if (!codes) return { error: 'No honor codes defined' };

  const code = codes.find(c => c.id === codeId || c.name === codeId);
  if (!code) return { error: 'Honor code not found' };

  return {
    id: code.id,
    name: code.name,
    description: code.description,
    rules: code.rules,
    benefits: code.benefits,
    violations: code.violations
  };
}

export function checkHonorViolation(code, action) {
  if (!code || !code.violations) {
    return { violation: false, severity: 'none', effect: '' };
  }

  const violation = code.violations.find(v =>
    v.action.toLowerCase() === action.toLowerCase() || action.includes(v.action)
  );

  if (!violation) {
    return { violation: false, severity: 'none', effect: 'This action does not violate the honor code.' };
  }

  return {
    violation: true,
    severity: violation.severity,
    effect: violation.effect,
    honorLoss: violation.honorLoss || 1,
    action: violation.action,
    description: `Honor code violation: ${violation.action}. ${violation.effect}`
  };
}

export function getDishonoredEffects(honor) {
  if (honor > 5) return { effect: 'No dishonor penalties', penalties: [] };

  const penalties = [];
  if (honor <= 5 && honor > 2) {
    penalties.push('-2 penalty on all Persuasion checks with honorable beings');
  }
  if (honor <= 2 && honor > 0) {
    penalties.push('-4 penalty on Persuasion, cannot take Honorable feats', 'Lose all honor benefits');
  }
  if (honor <= 0) {
    penalties.push('-6 penalty on all social checks', 'Cannot interact with courts', 'Former allies become enemies');
  }

  return {
    currentHonor: honor,
    dishonoredStatus: honor <= 2,
    penalties,
    description: penalties.length > 0 ? penalties.join('; ') : 'No penalties'
  };
}

export function getHonorEvents() { return advData.honor.honorEvents; }
export function getHonorData() { return advData.honor; }

// ═══════════════════════════════════════════════════
// CONTACTS
// ═══════════════════════════════════════════════════

export function askContactFavor(contact, difficultyLevel) {
  const dc = advData.contacts.askFavorDC[difficultyLevel] || 15;
  const trustLevel = advData.contacts.trustLevels.find(t => t.level === contact.trust) || advData.contacts.trustLevels[0];
  const adjustedDC = Math.max(5, dc - (contact.trust * 2));

  const roll = rollDice(1, 20);
  const total = roll + (contact.diplomacyMod || 0);
  const success = total >= adjustedDC;

  return {
    success,
    roll,
    total,
    dc: adjustedDC,
    trustLevel: trustLevel.name,
    description: success
      ? `Contact (${trustLevel.name}) agrees to the ${difficultyLevel} favor (${total} vs DC ${adjustedDC})`
      : `Contact (${trustLevel.name}) refuses the ${difficultyLevel} favor (${total} vs DC ${adjustedDC})`
  };
}

export function cultivateContact(contact, method = 'time', investment = 0) {
  if (!contact) return { error: 'Contact not found' };

  let trustGain = 0;
  let costDescription = '';

  switch (method.toLowerCase()) {
    case 'time':
      trustGain = 1;
      costDescription = 'Spent 1 week of quality time with contact';
      break;
    case 'gold':
      trustGain = Math.floor((investment || 100) / 100);
      costDescription = `Spent ${investment} gp on contact gifts and favors`;
      break;
    case 'influence':
      trustGain = 2;
      costDescription = 'Leveraged personal influence to aid contact';
      break;
    default:
      trustGain = 0;
      costDescription = 'Unknown cultivation method';
  }

  const newTrust = Math.min(5, (contact.trust || 0) + trustGain);
  const trustLevelData = advData.contacts.trustLevels.find(t => t.level === newTrust);

  return {
    previousTrust: contact.trust || 0,
    newTrust,
    trustGain,
    method,
    investment,
    costDescription,
    trustLevelName: trustLevelData?.name || 'Unknown',
    description: `Contact trust increased from ${contact.trust || 0} to ${newTrust}. ${costDescription}`
  };
}

export function checkBetrayal(contact) {
  if (!contact) return { error: 'Contact not found' };

  const trust = contact.trust || 0;
  const risk = contact.risk || 50;
  const betrayalChance = Math.max(5, Math.min(95, 50 - (trust * 10) + (risk * 0.5)));
  const roll = rollDice(1, 100);
  const betrayed = roll <= betrayalChance;

  return {
    roll,
    betrayalChance: betrayalChance.toFixed(1),
    trust,
    risk,
    betrayed,
    consequence: betrayed ? 'Contact betrays the party!' : 'Contact remains loyal.',
    description: `Betrayal check: ${roll} vs ${betrayalChance.toFixed(1)}% chance. ${betrayed ? 'BETRAYED!' : 'Loyal.'}`
  };
}

export function createContact(name, typeId, initialTrust = 1) {
  const typeData = advData.contacts.contactTypes.find(t => t.id === typeId);
  if (!typeData) return { error: 'Contact type not found' };

  const trustData = advData.contacts.trustLevels.find(t => t.level === initialTrust);

  return {
    name,
    type: typeData.name,
    typeId,
    trust: initialTrust,
    trustLevel: trustData?.name || 'Unknown',
    baseCapabilities: typeData.baseCapabilities || [],
    attitude: typeData.attitude || 'Neutral',
    reliability: typeData.reliability || 0,
    risk: typeData.riskFactor || 50,
    cost: typeData.cost || 0,
    created: true,
    description: `${name} (${typeData.name}): ${typeData.description}`
  };
}

export function getContactTypes() { return advData.contacts.contactTypes; }
export function getTrustLevels() { return advData.contacts.trustLevels; }

// ═══════════════════════════════════════════════════
// INVESTIGATIONS
// ═══════════════════════════════════════════════════

export function searchForClue(character, clueType, difficultyLevel) {
  const clue = advData.investigations.clueTypes.find(c => c.id === clueType);
  if (!clue) return { success: false, error: 'Invalid clue type' };

  const dc = advData.investigations.investigationDCs[difficultyLevel] || 15;
  const skill = clue.skills[0];
  const skillBonus = getSkillBonus(character, skill);
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const success = total >= dc;

  return {
    success,
    roll,
    skillBonus,
    total,
    dc,
    clueType: clue.name,
    skill,
    description: success
      ? `${character.name} finds ${clue.name}! (${skill}: ${total} vs DC ${dc})`
      : `${character.name} finds nothing useful. (${skill}: ${total} vs DC ${dc})`
  };
}

export function beginInvestigation(complexity = 'moderate') {
  const dcMap = { simple: 12, moderate: 15, complex: 20, impossible: 25 };
  const clueCountMap = { simple: 3, moderate: 5, complex: 8, impossible: 12 };

  const dc = dcMap[complexity] || 15;
  const requiredClues = clueCountMap[complexity] || 5;

  return {
    complexity,
    investigationDC: dc,
    cluesRequired: requiredClues,
    collectedClues: 0,
    progress: 0,
    breakthrough: false,
    description: `Investigation started (${complexity}). Requires ${requiredClues} clues to achieve breakthrough.`
  };
}

export function attemptDeduction(foundClues = [], requiredClues = 5) {
  const clueCount = foundClues.length;
  const threshold = requiredClues;
  const breakthrough = clueCount >= threshold;

  return {
    collectedClues: clueCount,
    requiredClues,
    breakthrough,
    progress: Math.min(100, Math.floor((clueCount / threshold) * 100)),
    cluesNeeded: Math.max(0, threshold - clueCount),
    description: breakthrough
      ? `BREAKTHROUGH! All ${threshold} clues gathered. Mystery solved!`
      : `${clueCount}/${threshold} clues found. ${requiredClues - clueCount} more needed.`
  };
}

export function interrogateNPC(character, npcWill = 10, approach = 'diplomacy') {
  let skill = 'Diplomacy';
  let dc = 10 + npcWill;

  if (approach.toLowerCase() === 'intimidate') {
    skill = 'Intimidate';
  } else if (approach.toLowerCase() === 'bluff') {
    skill = 'Bluff';
  }

  const skillBonus = getSkillBonus(character, skill);
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const success = total >= dc;

  return {
    skill,
    approach,
    roll,
    skillBonus,
    total,
    dc,
    npcWill,
    success,
    information: success ? 'NPC reveals useful information' : 'NPC refuses to talk or lies',
    description: `${approach.charAt(0).toUpperCase() + approach.slice(1)} check: ${skill} ${total} vs DC ${dc}. ${success ? 'SUCCESS - NPC talks' : 'FAILED - NPC resists'}`
  };
}

export function researchTopic(character, libraryTier = 'good', topic = '') {
  const tierDC = { poor: 20, average: 15, good: 12, excellent: 10, legendary: 5 };
  const tierTime = { poor: 7, average: 5, good: 3, excellent: 2, legendary: 1 };

  const dc = tierDC[libraryTier] || 15;
  const daysRequired = tierTime[libraryTier] || 3;

  const skillBonus = getSkillBonus(character, 'Knowledge');
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const success = total >= dc;

  return {
    topic,
    libraryTier,
    roll,
    skillBonus,
    total,
    dc,
    daysRequired,
    success,
    information: success ? `Comprehensive knowledge about ${topic}` : `Limited or confusing information about ${topic}`,
    description: `Library research (${libraryTier} library): Knowledge ${total} vs DC ${dc}. Takes ${daysRequired} days. ${success ? 'FOUND' : 'NOT FOUND'}`
  };
}

export function getClueTypes() { return advData.investigations.clueTypes; }
export function getInvestigationDCs() { return advData.investigations.investigationDCs; }

// ═══════════════════════════════════════════════════
// SANITY / MADNESS
// ═══════════════════════════════════════════════════

export function calculateSanityScore(character) {
  const wis = character?.abilities?.WIS || character?.wis || 10;
  const cha = character?.abilities?.CHA || character?.cha || 10;
  return (wis * 2) + cha;
}

export function checkSanityDamage(character, triggerIndex) {
  const trigger = advData.sanity.sanityDamage[triggerIndex];
  if (!trigger) return { damage: 0, description: 'Unknown trigger' };

  // Parse damage string
  const dmgMatch = trigger.damage.match(/(\d+)d(\d+)(?:\+(\d+))?/);
  const rawDmg = dmgMatch ? rollDice(parseInt(dmgMatch[1]), parseInt(dmgMatch[2])) + (parseInt(dmgMatch[3]) || 0) : 0;

  // Will save
  const dcMatch = trigger.save.match(/DC (\d+)/);
  const dc = dcMatch ? parseInt(dcMatch[1]) : 15;
  const wisMod = Math.floor(((character?.abilities?.WIS || 10) - 10) / 2);
  const roll = rollDice(1, 20);
  const total = roll + wisMod;
  const saved = total >= dc;
  const damage = saved ? Math.ceil(rawDmg / 2) : rawDmg;

  return {
    trigger: trigger.trigger,
    rawDamage: rawDmg,
    saved,
    finalDamage: damage,
    roll,
    wisMod,
    total,
    dc,
    description: `${trigger.trigger}: Will ${total} vs DC ${dc} — ${saved ? 'SAVED (half damage)' : 'FAILED'}. ${damage} sanity damage.`
  };
}

export function rollMadnessEffect() {
  const effects = advData.sanity.madnessEffects;
  const idx = rollDice(1, effects.length) - 1;
  return effects[idx];
}

export function checkMilestoneEffect(currentSanity, maxSanity) {
  const thresholds = {
    75: { percent: '75%', milestone: 'Caution', effect: '-1 on Wisdom checks' },
    50: { percent: '50%', milestone: 'Concern', effect: '-2 on all Wisdom checks, periodic nightmares' },
    25: { percent: '25%', milestone: 'Critical', effect: '-4 on Wisdom, mild delirium, paranoia' },
    0: { percent: '0%', milestone: 'Broken', effect: 'Permanent madness, catatonia, complete breakdown' }
  };

  const percent = Math.floor((currentSanity / maxSanity) * 100);
  let triggered = null;

  if (percent <= 25) {
    triggered = thresholds[25];
  } else if (percent <= 50) {
    triggered = thresholds[50];
  } else if (percent <= 75) {
    triggered = thresholds[75];
  } else if (percent <= 0) {
    triggered = thresholds[0];
  }

  return {
    currentSanity,
    maxSanity,
    percentRemaining: percent,
    milestoneTriggered: triggered ? true : false,
    milestone: triggered?.milestone || 'Stable',
    effect: triggered?.effect || 'No effect',
    description: `Sanity at ${percent}%. ${triggered ? triggered.effect : 'Character is stable.'}`
  };
}

export function rollIndefiniteMadness() {
  const effects = advData.sanity.madnessEffects || [];
  if (effects.length === 0) return { effect: 'Unknown madness', duration: 'Indefinite' };

  const idx = rollDice(1, effects.length) - 1;
  const madness = effects[idx];

  return {
    effect: madness.effect || madness.name || 'Undefined',
    duration: 'Until cured by magic (Greater Restoration or Wish)',
    severity: madness.severity || 'severe',
    description: `Indefinite madness: ${madness.effect || madness.name}. Only magical healing can cure this.`
  };
}

export function attemptRecovery(method = 'rest', character = null, days = 7) {
  const methods = {
    rest: { dc: 12, timeRequired: 7, description: 'Complete rest and safe environment' },
    therapy: { dc: 15, timeRequired: 14, description: 'Therapy with trained healer' },
    magic: { dc: 0, timeRequired: 0, description: 'Magical healing (Greater Restoration)' },
    meditation: { dc: 18, timeRequired: 21, description: 'Meditation and spiritual practice' },
    ritual: { dc: 16, timeRequired: 3, description: 'Healing ritual' }
  };

  const methodData = methods[method.toLowerCase()] || methods.rest;
  let roll = 0, total = 0;

  if (methodData.dc > 0) {
    roll = rollDice(1, 20);
    const wisMod = character ? Math.floor(((character?.abilities?.WIS || 10) - 10) / 2) : 0;
    total = roll + wisMod;
  }

  const success = methodData.dc === 0 || total >= methodData.dc;

  return {
    method: method.charAt(0).toUpperCase() + method.slice(1),
    dc: methodData.dc,
    roll: methodData.dc > 0 ? roll : null,
    total: methodData.dc > 0 ? total : null,
    success,
    daysRequired: methodData.timeRequired,
    sanityRecovered: success ? rollDice(1, 4) + 2 : 0,
    description: methodData.description,
    result: success
      ? `${method} successful! Character recovers sanity over ${methodData.timeRequired} days.`
      : `${method} attempt failed. No progress toward recovery.`
  };
}

export function getSanityTriggers() { return advData.sanity.sanityDamage; }
export function getMadnessEffects() { return advData.sanity.madnessEffects; }
export function getSanityRecovery() { return advData.sanity.recovery; }

// ═══════════════════════════════════════════════════
// MAGIC ITEM CRAFTING
// ═══════════════════════════════════════════════════

export function calculateCraftingCost(itemMarketPrice) {
  return Math.floor(itemMarketPrice / 2);
}

export function calculateCraftingTime(baseCost) {
  return Math.max(1, Math.floor(baseCost / 1000));
}

export function attemptCrafting(character, itemCasterLevel, baseCost) {
  const dc = 5 + itemCasterLevel;
  const casterLevel = character?.level || 1;
  const spellcraftBonus = getSkillBonus(character, 'Spellcraft');
  const roll = rollDice(1, 20);
  const total = roll + spellcraftBonus;

  if (roll === 1) {
    return {
      success: false,
      cursed: true,
      roll, total, dc,
      costLost: baseCost,
      description: `Natural 1! Crafting fails catastrophically. Materials (${baseCost} gp) lost. Cursed item may be created.`
    };
  }

  const success = total >= dc;
  return {
    success,
    cursed: false,
    roll, total, dc,
    costLost: success ? 0 : baseCost,
    description: success
      ? `Spellcraft ${total} vs DC ${dc}: Success! Item crafted in ${calculateCraftingTime(baseCost)} days for ${baseCost} gp.`
      : `Spellcraft ${total} vs DC ${dc}: Failed. ${baseCost} gp in materials lost.`
  };
}

export function attemptMundaneCraft(character, craftSkill = 'Craft (Blacksmithing)', itemDC = 15, rawMaterialCost = 100) {
  const skillBonus = getSkillBonus(character, craftSkill);
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const success = total >= itemDC;
  const weeklyProgress = success ? Math.max(1, skillBonus) : 0;

  return {
    skill: craftSkill,
    roll,
    skillBonus,
    total,
    itemDC,
    success,
    materialCost: rawMaterialCost,
    weeklyProgress,
    weeksToCraft: success ? Math.ceil(itemDC / weeklyProgress) : 'Never completes',
    description: success
      ? `${craftSkill} ${total} vs DC ${itemDC}: Weekly progress of ${weeklyProgress} points. Complete in ${Math.ceil(itemDC / weeklyProgress)} weeks.`
      : `${craftSkill} ${total} vs DC ${itemDC}: No progress this week. Try again.`
  };
}

export function calculateMasterworkCost(baseItemCost) {
  const masterworkAddon = 300;
  const totalCost = baseItemCost + masterworkAddon;

  return {
    baseItemCost,
    masterworkAddon,
    totalMasterworkCost: totalCost,
    percentIncrease: ((masterworkAddon / baseItemCost) * 100).toFixed(1),
    description: `Masterwork upgrade: ${baseItemCost} gp + 300 gp = ${totalCost} gp total`
  };
}

export function getSpecialMaterial(materialId) {
  const materials = advData.crafting.specialMaterials || [];
  const material = materials.find(m => m.id === materialId || m.name === materialId);

  if (!material) return { error: 'Material not found' };

  return {
    name: material.name,
    costMultiplier: material.costMultiplier || 1,
    properties: material.properties || [],
    benefits: material.benefits || [],
    drawbacks: material.drawbacks || [],
    craftingDC: material.craftingDC || 0,
    description: material.description || ''
  };
}

export function rollCursedItem() {
  const curses = [
    { curse: 'Curse of Incompetence', effect: '-2 penalty on all checks with item' },
    { curse: 'Curse of Misfortune', effect: 'Wearer rerolls all d20s and takes lowest result' },
    { curse: 'Curse of Bondage', effect: 'Item cannot be removed without Remove Curse' },
    { curse: 'Curse of Weakness', effect: '-2 STR while wearing item' },
    { curse: 'Curse of Compulsion', effect: 'Must use item once per day or take 1d6 psychic damage' },
    { curse: 'Curse of Malice', effect: 'Item actively harms wearer in random ways' },
    { curse: 'Curse of Consumption', effect: 'Item slowly consumes the wearer from inside (1 CON/week)' },
    { curse: 'Curse of Doom', effect: 'All critical hits against wearer deal double damage' }
  ];

  const idx = rollDice(1, curses.length) - 1;
  return {
    curse: curses[idx].curse,
    effect: curses[idx].effect,
    severity: 'severe',
    removal: 'Remove Curse or Wish spell required',
    description: `Cursed Item Created: ${curses[idx].curse}. Effect: ${curses[idx].effect}`
  };
}

export function cooperativeCrafting(characters = [], itemCasterLevel = 5, baseCost = 5000) {
  if (characters.length === 0) return { error: 'No characters specified' };

  const totalSpellcraft = characters.reduce((sum, char) => {
    return sum + getSkillBonus(char, 'Spellcraft');
  }, 0);

  const baseBonus = Math.floor((characters.length - 1) * 2);
  const totalBonus = baseBonus + Math.floor(totalSpellcraft / 2);
  const reducedTime = Math.max(1, calculateCraftingTime(baseCost) - Math.floor(characters.length / 2));

  return {
    craftersInvolved: characters.length,
    cooperativeBonus: totalBonus,
    totalSpellcraftPool: totalSpellcraft,
    baseCost,
    daysToComplete: reducedTime,
    description: `${characters.length} crafters working together: +${totalBonus} bonus. Item completes in ${reducedTime} days.`
  };
}

export function getCraftingItemTypes() { return advData.crafting.itemTypes; }

// ═══════════════════════════════════════════════════
// BARGAINING
// ═══════════════════════════════════════════════════

/**
 * Attempt to bargain down an item price.
 *
 * The 4th parameter is polymorphic for backward compatibility:
 *   - if a number, treated as the merchant's raw Sense Motive bonus (old
 *     call-site shape preserved from Phase 5)
 *   - if an object, treated as a merchant record and the relevant skill
 *     bonus is pulled from getMerchantSkills():
 *       * Diplomacy haggle → opposed by the merchant's ½ Diplomacy
 *       * Bluff haggle → opposed by the merchant's Sense Motive
 *       * Intimidate haggle → opposed by the merchant's own Intimidate
 *         (willpower to resist coercion)
 *
 * This lets ShopTab pass `shopData.merchant` directly instead of
 * hardcoding a flat +5.
 */
export function attemptBargain(character, itemPrice, skillName = 'Diplomacy', merchantOrSenseMotive = 5, attitude = 'indifferent') {
  // Resolve the opposed skill bonus from either a number or a merchant object
  let merchantOpposed = 0;
  let merchantOpposedLabel = 'Sense Motive';
  if (typeof merchantOrSenseMotive === 'number') {
    merchantOpposed = merchantOrSenseMotive;
  } else if (merchantOrSenseMotive && typeof merchantOrSenseMotive === 'object') {
    const m = getMerchantSkills(merchantOrSenseMotive);
    const lower = (skillName || '').toLowerCase();
    if (lower === 'bluff') {
      merchantOpposed = m.senseMotive || 0;
      merchantOpposedLabel = 'Sense Motive';
    } else if (lower === 'intimidate') {
      merchantOpposed = m.intimidate || 0;
      merchantOpposedLabel = 'Intimidate';
    } else {
      // Diplomacy or anything else: oppose by half the merchant's Diplomacy
      merchantOpposed = Math.floor((m.diplomacy || 0) / 2);
      merchantOpposedLabel = '½ Diplomacy';
    }
  }

  // Hostile merchants refuse to deal at all. Delegated to merchantSkills so
  // the "what counts as refusal" rule has a single source of truth.
  if (refusesService(attitude)) {
    return {
      refused: true,
      success: false,
      roll: null,
      total: null,
      dc: null,
      margin: null,
      merchantOpposed,
      merchantOpposedLabel,
      attitude,
      attitudeBonus: 0,
      discount: 0,
      discountLabel: '0%',  // shape parity with the success path for UI code
      originalPrice: itemPrice,
      newPrice: itemPrice,
      savings: 0,
      description: `The merchant is hostile and refuses to bargain.`,
    };
  }

  // Attitude folds into both the PC's effective roll and a baseline
  // price shift. Mirrors the resolveHaggle logic so the Bargain button
  // and the haggle flow agree.
  const attBonus = attitudeBonusFor(attitude);
  const attBase = attitudeBaseDiscountFor(attitude); // positive = discount, negative = markup

  const dc = 15 + merchantOpposed;
  const skillBonus = getSkillBonus(character, skillName);
  const roll = rollDice(1, 20);
  const total = roll + skillBonus + attBonus;
  const margin = total - dc;

  const adjustments = advData.bargaining.adjustments;
  let discount = 0;
  let desc = 'Failed to negotiate';

  if (margin >= 0) {
    for (let i = adjustments.length - 1; i >= 0; i--) {
      const minMargin = parseInt(adjustments[i].margin.split('-')[0].replace('+', ''));
      if (margin >= minMargin) {
        discount = parseInt(adjustments[i].discount);
        desc = adjustments[i].description;
        break;
      }
    }
  }

  // Apply baseline attitude discount/markup, clamped so the player never
  // ends up *paying more* after a successful bargain just because the
  // merchant is unfriendly.
  const totalDiscountFraction = (discount / 100) + attBase;
  const rawNewPrice = Math.round(itemPrice * (1 - totalDiscountFraction));
  const newPrice = margin >= 0 ? Math.min(itemPrice, Math.max(0, rawNewPrice)) : Math.max(0, rawNewPrice);

  const attPart = attBonus !== 0
    ? `, ${attitude}: ${attBonus >= 0 ? '+' : ''}${attBonus}`
    : '';

  return {
    success: margin >= 0,
    refused: false,
    roll, total, dc, margin,
    merchantOpposed,
    merchantOpposedLabel,
    attitude,
    attitudeBonus: attBonus,
    discount,                   // numeric, e.g. 10  (not "10%")
    discountLabel: `${discount}%`, // kept for any display code that wants the string
    originalPrice: itemPrice,
    newPrice,
    savings: Math.max(0, itemPrice - newPrice),
    description: `${skillName} ${total} vs DC ${dc} (${merchantOpposedLabel} ${merchantOpposed >= 0 ? '+' : ''}${merchantOpposed}${attPart}, margin ${margin >= 0 ? '+' : ''}${margin}): ${desc}. Price: ${itemPrice} gp → ${newPrice} gp`
  };
}

export function getSettlementModifier(settlementType) {
  const modifiers = {
    village: { buyLimit: 250, sellLimit: 500, modifier: -10, availability: 'Limited' },
    town: { buyLimit: 2500, sellLimit: 5000, modifier: 0, availability: 'Moderate' },
    city: { buyLimit: 10000, sellLimit: 50000, modifier: 5, availability: 'Extensive' },
    metropolis: { buyLimit: 50000, sellLimit: 250000, modifier: 10, availability: 'Rare items available' },
    outpost: { buyLimit: 100, sellLimit: 250, modifier: -20, availability: 'Very Limited' }
  };

  const mod = modifiers[settlementType.toLowerCase()] || modifiers.town;

  return {
    settlementType: settlementType.charAt(0).toUpperCase() + settlementType.slice(1),
    buyLimit: mod.buyLimit,
    sellLimit: mod.sellLimit,
    priceModifier: mod.modifier,
    availability: mod.availability,
    description: `${settlementType}: Buy up to ${mod.buyLimit} gp, sell up to ${mod.sellLimit} gp. ${mod.availability}`
  };
}

export function runAuction(startingBid = 100, bidders = [], rounds = 5) {
  if (!bidders || bidders.length === 0) return { error: 'No bidders specified' };

  let currentBid = startingBid;
  const biddingHistory = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < bidders.length; i++) {
      const bidder = bidders[i];
      const willContinue = Math.random() > (round * 0.2);

      if (willContinue) {
        const bidIncrease = Math.floor(currentBid * (0.1 + Math.random() * 0.2));
        currentBid += bidIncrease;
        biddingHistory.push({
          round: round + 1,
          bidder: bidder.name || `Bidder ${i + 1}`,
          bid: currentBid
        });
      } else {
        bidders[i].outBid = true;
      }
    }

    const activeBidders = bidders.filter(b => !b.outBid).length;
    if (activeBidders <= 1) break;
  }

  const winner = bidders.find(b => !b.outBid);

  return {
    startingBid,
    finalBid: currentBid,
    biddingHistory,
    winner: winner?.name || 'Unknown',
    totalRounds: Math.min(rounds, biddingHistory.length),
    profit: currentBid - startingBid,
    description: `Auction complete. ${winner?.name || 'Winner'} wins at ${currentBid} gp. Profit: ${currentBid - startingBid} gp`
  };
}

export function blackMarketSearch(item, settlementType = 'city') {
  const availability = {
    rare: { dc: 25, cost: 'x3-5', risk: 'High' },
    uncommon: { dc: 20, cost: 'x1.5-2', risk: 'Moderate' },
    common: { dc: 15, cost: 'x1.2-1.5', risk: 'Low' }
  };

  const tierMod = {
    village: -10,
    town: -5,
    city: 0,
    metropolis: 10,
    outpost: -20
  };

  const availData = availability.uncommon;
  const modValue = tierMod[settlementType.toLowerCase()] || 0;
  const adjustedDC = availData.dc + modValue;

  const roll = rollDice(1, 20);
  const found = roll >= adjustedDC - 5;

  return {
    item,
    settlementType: settlementType.charAt(0).toUpperCase() + settlementType.slice(1),
    searchDC: adjustedDC,
    roll,
    found,
    priceMultiplier: found ? availData.cost : 'Not available',
    riskLevel: found ? availData.risk : 'N/A',
    consequences: found && roll < adjustedDC - 5 ? 'Law enforcement alerted' : '',
    description: found
      ? `Black market contact found. Item available at ${availData.cost}x normal price. Risk: ${availData.risk}`
      : `No black market contact found for this item in ${settlementType}.`
  };
}

// ═══════════════════════════════════════════════════
// GAMBLING
// ═══════════════════════════════════════════════════

export function resolveGamble(character, gameId, betAmount, cheating = false) {
  const game = advData.gambling.games.find(g => g.id === gameId);
  if (!game) return { success: false, error: 'Unknown game' };

  let roll, bonus, total, dc;

  if (game.skillCheck === 'None (pure luck)') {
    roll = rollDice(1, 20);
    bonus = 0;
    total = roll;
    dc = 11; // 50/50
  } else if (game.skillCheck.includes('Strength')) {
    bonus = Math.floor(((character?.abilities?.STR || 10) - 10) / 2);
    roll = rollDice(1, 20);
    total = roll + bonus;
    dc = 10 + rollDice(1, 10); // Opponent's strength
  } else {
    const skills = game.skillCheck.split(' or ');
    const skillName = skills[0].replace('Profession (gambler)', 'Profession');
    bonus = getSkillBonus(character, skillName);
    roll = rollDice(1, 20);
    total = roll + bonus;
    dc = game.dc || 15;
  }

  // Cheating bonus
  if (cheating) {
    const sleightRoll = rollDice(1, 20) + getSkillBonus(character, 'Sleight of Hand');
    if (sleightRoll >= 20) {
      total += 5;
    } else {
      return {
        caught: true,
        roll, total, dc,
        description: `${character.name} caught cheating! (Sleight of Hand ${sleightRoll} vs DC 20). Expelled and reputation damaged.`
      };
    }
  }

  const margin = total - dc;
  const resultEntry = advData.gambling.results.reduce((best, r) => {
    if (margin >= r.margin && r.margin >= (best?.margin ?? -999)) return r;
    return best;
  }, null);

  let winnings = 0;
  if (margin >= 15) winnings = betAmount * 3;
  else if (margin >= 10) winnings = betAmount * 2;
  else if (margin >= 5) winnings = Math.round(betAmount * 1.5);
  else if (margin >= 0) winnings = betAmount;
  else if (margin >= -5) winnings = -betAmount;
  else winnings = -betAmount * 2;

  return {
    success: margin >= 0,
    roll, bonus, total, dc, margin,
    game: game.name,
    bet: betAmount,
    winnings,
    net: winnings,
    result: resultEntry?.result || 'Unknown',
    description: `${game.name}: ${total} vs DC ${dc} (margin ${margin >= 0 ? '+' : ''}${margin}). ${resultEntry?.result}. ${winnings >= 0 ? 'Won' : 'Lost'} ${Math.abs(winnings)} gp.`
  };
}

export function getGames() { return advData.gambling.games; }

// ═══════════════════════════════════════════════════
// DISASTERS
// ═══════════════════════════════════════════════════

export function rollDisaster() {
  const idx = rollDice(1, advData.disasters.length) - 1;
  return advData.disasters[idx];
}

export function getDisasters() { return advData.disasters; }

// ═══════════════════════════════════════════════════
// DRUGS & ADDICTION
// ═══════════════════════════════════════════════════

export function getDrugs() { return advData.drugs; }
export function getAddictionSeverity() { return advData.addictionSeverity; }

export function useDrug(character, drugId) {
  const drug = advData.drugs.find(d => d.id === drugId);
  if (!drug) return { success: false, error: 'Unknown drug' };

  const fortBonus = Math.floor(((character?.abilities?.CON || 10) - 10) / 2);
  const roll = rollDice(1, 20);
  const total = roll + fortBonus;
  const resisted = total >= drug.fortDC;

  // Addiction check
  const addRoll = rollDice(1, 20);
  const addTotal = addRoll + fortBonus;
  const addicted = addTotal < drug.addictionDC;

  return {
    drug: drug.name,
    effect: drug.effect,
    resisted,
    fortRoll: roll, fortTotal: total, fortDC: drug.fortDC,
    addicted,
    addictionRoll: addRoll, addictionTotal: addTotal, addictionDC: drug.addictionDC,
    description: `${drug.name}: ${resisted ? 'Resisted harmful effects' : drug.effect}. Addiction check: ${addicted ? 'ADDICTED!' : 'Safe'} (Fort ${addTotal} vs DC ${drug.addictionDC})`
  };
}

// ═══════════════════════════════════════════════════
// TRADE ROUTES
// ═══════════════════════════════════════════════════

export function establishTradeRoute(origin, destination, goods, initialInvestment = 1000) {
  const setupData = advData.tradeRoutes.routeEstablishment;
  const baseSetupTime = 2;
  const distanceModifier = 1;

  return {
    origin,
    destination,
    goods,
    initialInvestment,
    setupTime: baseSetupTime + Math.floor((initialInvestment - 500) / 400),
    establishmentCost: initialInvestment,
    status: 'Established',
    weeklyRevenue: 0,
    caravaansRunning: 0,
    description: `Trade route established: ${origin} → ${destination}. ${goods}. Setup time: ${baseSetupTime} weeks. Cost: ${initialInvestment} gp`
  };
}

export function calculateTradeProfits(route, caravan, distanceMultiplier = 1) {
  if (!route || !caravan) return { error: 'Route or caravan data missing' };

  const baseProfit = 1000 + rollDice(1, 6) * 100;
  const distanceFactor = distanceMultiplier || 1;
  const cargoValue = caravan.cargoValue || 5000;
  const totalProfit = Math.round((baseProfit * distanceFactor) + (cargoValue * 0.1));

  return {
    baseProfit,
    cargoValue,
    distanceMultiplier: distanceFactor,
    totalProfit,
    weeklyProfit: Math.round(totalProfit / 4),
    monthlyProfit: totalProfit,
    riskLevel: caravan.protection ? 'Low' : 'Moderate',
    description: `Route profit: ${baseProfit} gp base + ${Math.round(cargoValue * 0.1)} gp (cargo) = ${totalProfit} gp total. Monthly: ${totalProfit} gp.`
  };
}

export function rollBanditEncounter(route, baseChance = 2) {
  const roll = rollDice(1, 100);
  const encountered = roll <= baseChance;

  if (!encountered) {
    return { encountered: false, banditAttack: null, losses: 0, description: 'Caravan travels safely.' };
  }

  const cargoLoss = rollDice(1, 4) * 25;
  const numBandits = rollDice(2, 6) + 4;

  return {
    encountered: true,
    banditChance: baseChance,
    roll,
    numBandits,
    cargoLoss: cargoLoss,
    costOfEncounter: cargoLoss * 10,
    description: `Bandit encounter! ${numBandits} bandits attack. Cargo loss: ${cargoLoss}%. Cost: ${cargoLoss * 10} gp.`
  };
}

export function resolveCaravanMovement(caravan, terrain = 'roads', dailyDistance = 20) {
  const terrainSpeedMod = {
    roads: 1,
    forest: 0.7,
    mountains: 0.5,
    desert: 0.8,
    water: 0.6,
    plains: 1.2
  };

  const speedMultiplier = terrainSpeedMod[terrain.toLowerCase()] || 1;
  const actualDistance = dailyDistance * speedMultiplier;
  const daysToDestination = caravan.distanceToDestination ? Math.ceil(caravan.distanceToDestination / actualDistance) : 0;

  return {
    caravan,
    terrain,
    baseDistance: dailyDistance,
    speedMultiplier: speedMultiplier.toFixed(1),
    actualDistance: Math.round(actualDistance),
    daysToDestination,
    suppliesConsumed: 1,
    moraleMod: terrain === 'roads' ? 0 : -1,
    description: `Caravan travels ${Math.round(actualDistance)} miles/day through ${terrain}. Destination in ${daysToDestination} days.`
  };
}

// ═══════════════════════════════════════════════════
// ESPIONAGE
// ═══════════════════════════════════════════════════

export function gatherInformation(character, targetDC = 15, settlement = null) {
  const skillBonus = getSkillBonus(character, 'Diplomacy');
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const success = total >= targetDC;

  const timeMap = {
    simple: 1,
    moderate: rollDice(1, 6),
    complex: rollDice(2, 6)
  };

  let complexity = 'moderate';
  if (targetDC <= 12) complexity = 'simple';
  else if (targetDC >= 20) complexity = 'complex';

  return {
    roll,
    skillBonus,
    total,
    targetDC,
    success,
    complexity,
    daysRequired: timeMap[complexity],
    settlement,
    information: success ? 'Useful information gathered' : 'Information is inconclusive or misleading',
    description: `Information gathering: Diplomacy ${total} vs DC ${targetDC}. ${success ? 'SUCCESS' : 'FAILED'}. Takes ${timeMap[complexity]} days.`
  };
}

export function attemptSabotage(character, targetDC = 15, facility = 'generic') {
  const skillOptions = ['Stealth', 'Sabotage', 'Craft (bombs)', 'Thievery'];
  const bestSkill = skillOptions.reduce((best, skill) => {
    const bonus = getSkillBonus(character, skill);
    return bonus > (getSkillBonus(character, best) || 0) ? skill : best;
  }, skillOptions[0]);

  const skillBonus = getSkillBonus(character, bestSkill);
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const success = total >= targetDC;

  const sensingDC = targetDC + 5;
  const suspicionRoll = rollDice(1, 20);
  const detected = suspicionRoll >= sensingDC;

  return {
    facility,
    skill: bestSkill,
    roll,
    skillBonus,
    total,
    targetDC,
    success,
    suspicionRoll,
    sensingDC,
    detected: success ? detected : false,
    consequence: detected && success ? 'Sabotage succeeds but saboteur seen!' : success ? 'Sabotage succeeds undetected!' : 'Sabotage fails',
    description: `Sabotage attempt vs ${facility}: ${bestSkill} ${total} vs DC ${targetDC}. ${success ? 'SUCCESS' : 'FAILED'}. ${detected && success ? 'SPOTTED!' : success ? 'Undetected' : ''}`
  };
}

export function runCounterIntelligence(organization, spyDC = 15) {
  const roll = rollDice(1, 20);
  const senseMotive = rollDice(1, 20);
  const discovered = senseMotive >= spyDC;

  return {
    organization,
    spyNetworkDC: spyDC,
    sensMotiveRoll: senseMotive,
    discovered,
    spiesFound: discovered ? rollDice(1, 4) + 1 : 0,
    networkDisrupted: discovered,
    description: discovered
      ? `Spy network discovered! ${rollDice(1, 4) + 1} spies found and arrested.`
      : `Counter-intelligence sweep found no spies. Network remains hidden.`
  };
}

export function createSpyNetwork(investment = 5000, settlement = null) {
  const tier = investment < 2000 ? 'small' : investment < 10000 ? 'medium' : 'large';
  const effectiveness = {
    small: { agents: rollDice(1, 3) + 1, coverage: '20%', upkeep: 100 },
    medium: { agents: rollDice(2, 6) + 2, coverage: '50%', upkeep: 250 },
    large: { agents: rollDice(3, 8) + 5, coverage: '80%', upkeep: 500 }
  };

  const network = effectiveness[tier];

  return {
    settlement,
    investment,
    networkTier: tier.charAt(0).toUpperCase() + tier.slice(1),
    agents: network.agents,
    coverage: network.coverage,
    monthlyUpkeep: network.upkeep,
    established: true,
    description: `${tier.charAt(0).toUpperCase() + tier.slice(1)} spy network established in ${settlement}. ${network.agents} agents, ${network.coverage} coverage. ${network.upkeep} gp/month upkeep.`
  };
}

// ═══════════════════════════════════════════════════
// ALIGNMENT
// ═══════════════════════════════════════════════════

export function trackAlignmentInfraction(character, infractionType, severity = 'minor') {
  const infraction = advData.alignment.alignmentInfraction.find(i =>
    i.action.toLowerCase() === infractionType.toLowerCase() || infractionType.includes(i.action)
  );

  if (!infraction) {
    return { error: 'Infraction not found', tracked: false };
  }

  const shifts = {
    minor: -1,
    moderate: -2,
    major: -5
  };

  const shiftAmount = shifts[severity] || -1;

  return {
    character,
    action: infraction.action,
    severity: infraction.severity,
    shiftAmount,
    shiftDirection: infraction.shift,
    tracked: true,
    description: `${character.name} commits: ${infraction.action}. Alignment shift: ${shiftAmount} toward ${infraction.shift}.`
  };
}

export function checkAlignmentShift(character, alignmentScore = 0) {
  const thresholds = [
    { score: 9, alignment: 'Lawful Good' },
    { score: 6, alignment: 'Neutral Good' },
    { score: 3, alignment: 'Chaotic Good' },
    { score: 0, alignment: 'True Neutral' },
    { score: -3, alignment: 'Chaotic Neutral' },
    { score: -6, alignment: 'Neutral Evil' },
    { score: -9, alignment: 'Lawful Evil' }
  ];

  let currentAlignment = 'True Neutral';
  for (const threshold of thresholds) {
    if (alignmentScore >= threshold.score) {
      currentAlignment = threshold.alignment;
      break;
    }
  }

  return {
    character,
    alignmentScore,
    currentAlignment,
    shiftOccurred: currentAlignment !== (character.alignment || 'True Neutral'),
    previousAlignment: character.alignment || 'Unknown',
    description: `${character.name}'s alignment: ${currentAlignment} (score: ${alignmentScore})`
  };
}

export function calculateAtonementCost(character) {
  const atonement = advData.alignment.atonementSpell;

  return {
    character,
    spellRequired: 'Atonement',
    casterLevel: atonement.casterLevel,
    cost: atonement.cost,
    timeRequired: atonement.time,
    effect: atonement.effect,
    frequency: atonement.frequency,
    description: `Atonement required. Cost: ${atonement.cost} gp. Time: ${atonement.time}. Effect: ${atonement.effect}`
  };
}

// ═══════════════════════════════════════════════════
// LINEAGE & BLOODLINES
// ═══════════════════════════════════════════════════

export function getBloodline(bloodlineId) {
  const bloodlines = advData.lineage.bloodlines;
  const bloodline = bloodlines.find(b => b.id === bloodlineId || b.name === bloodlineId);

  if (!bloodline) return { error: 'Bloodline not found' };

  return {
    name: bloodline.name,
    description: bloodline.description,
    traits: bloodline.traits || [],
    abilities: bloodline.abilities || [],
    drawbacks: bloodline.drawbacks || [],
    fullData: bloodline
  };
}

export function applyBloodlineEffects(character, bloodlineId) {
  const bloodline = getBloodline(bloodlineId);
  if (bloodline.error) return { error: bloodline.error };

  const traits = bloodline.traits || [];
  const abilities = bloodline.abilities || [];
  const drawbacks = bloodline.drawbacks || [];

  return {
    character,
    bloodline: bloodline.name,
    appliedTraits: traits,
    appliedAbilities: abilities,
    appliedDrawbacks: drawbacks,
    description: `${bloodline.name} bloodline applied to ${character.name}. Abilities: ${abilities.join(', ')}. Drawbacks: ${drawbacks.join(', ')}`
  };
}

// ═══════════════════════════════════════════════════
// RETIREMENT & LEGACY
// ═══════════════════════════════════════════════════

export function retireCharacter(character) {
  const retirementData = advData.retirement.characterRetirement;

  return {
    retiredCharacter: character.name,
    becomesNPC: true,
    canProvideFavor: true,
    level: character.level,
    fame: character.fame || 0,
    gold: character.gold || 0,
    feats: character.feats || [],
    skills: character.skills || [],
    description: `${character.name} retires from adventuring. Now available as NPC mentor/patron with legacy benefits for successors.`,
    legacyData: retirementData.legacyBonuses
  };
}

export function applyLegacyBonus(newCharacter, retiredCharacters = []) {
  if (!retiredCharacters || retiredCharacters.length === 0) {
    return { newCharacter, legacyApplied: false, bonuses: {} };
  }

  const legacy = advData.retirement.legacyBonuses;
  const mentor = retiredCharacters[0];

  return {
    newCharacter,
    mentor,
    legacyFame: legacy.mentorFame,
    startingGold: rollDice(1, 10) * 1000 + 1000,
    inheritedFeat: mentor.feats ? mentor.feats[0] : null,
    trainingBonus: 3,
    alliedContacts: mentor.contacts || [],
    description: `${newCharacter.name} inherits legacy from ${mentor.name}. +${legacy.mentorFame} Fame, ${legacy.mentorGold} gp, one feat, +3 skill bonus, allied contacts.`
  };
}

// ═══════════════════════════════════════════════════
// NPC BOONS
// ═══════════════════════════════════════════════════

export function getNpcBoons() { return advData.npcBoons; }

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

// Delegates to the canonical characterSkills helper, which understands
// all three character storage shapes:
//   1. character.skillRanks (canonical — full rulesEngine computation)
//   2. character.skills object (legacy: { diplomacy: 4, ... })
//   3. character.skills array (legacy: [{ name: 'Diplomacy', total: 7 }])
function getSkillBonus(character, skillName) {
  return getCharacterSkillTotal(character, skillName);
}

export default {
  // Mass Combat
  createArmy, resolveMassCombatRound, getArmyTactics, getArmySizes, getArmyTypes,
  applyBattlefieldConditions, applySpecialAbilities, checkRoutRecovery, calculateArmyConsumption, applyCommanderTier,
  // Reputation
  getFameTier, getInfamyTier, getReputationData, spendFame, getSpendFameOptions, getSphereInfluence,
  // Honor
  calculateStartingHonor, getHonorBenefit, getHonorEvents, getHonorData, getHonorCode, checkHonorViolation, getDishonoredEffects,
  // Contacts
  askContactFavor, getContactTypes, getTrustLevels, cultivateContact, checkBetrayal, createContact,
  // Investigations
  searchForClue, getClueTypes, getInvestigationDCs, beginInvestigation, attemptDeduction, interrogateNPC, researchTopic,
  // Sanity
  calculateSanityScore, checkSanityDamage, rollMadnessEffect, getSanityTriggers, getMadnessEffects, getSanityRecovery,
  checkMilestoneEffect, rollIndefiniteMadness, attemptRecovery,
  // Crafting
  calculateCraftingCost, calculateCraftingTime, attemptCrafting, getCraftingItemTypes,
  attemptMundaneCraft, calculateMasterworkCost, getSpecialMaterial, rollCursedItem, cooperativeCrafting,
  // Bargaining
  attemptBargain, getSettlementModifier, runAuction, blackMarketSearch,
  // Gambling
  resolveGamble, getGames,
  // Disasters
  rollDisaster, getDisasters,
  // Drugs
  getDrugs, getAddictionSeverity, useDrug,
  // Trade Routes
  establishTradeRoute, calculateTradeProfits, rollBanditEncounter, resolveCaravanMovement,
  // Espionage
  gatherInformation, attemptSabotage, runCounterIntelligence, createSpyNetwork,
  // Alignment
  trackAlignmentInfraction, checkAlignmentShift, calculateAtonementCost,
  // Lineage
  getBloodline, applyBloodlineEffects,
  // Retirement
  retireCharacter, applyLegacyBonus,
  // NPC Boons
  getNpcBoons
};
