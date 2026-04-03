import dmToolsData from '../data/dmToolsData.json';
import { roll, rollDice } from '../utils/dice';

// ══════════════════════════════════════════════════════════════════════════════
// XP & ENCOUNTER BUILDING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get XP value for a given CR
 * @param {number|string} cr - Challenge Rating (can be "1/8", "1/4", etc.)
 * @returns {number} XP value for that CR
 */
export function getXPForCR(cr) {
  const crKey = String(cr);
  return dmToolsData.xpAwards.crXPTable[crKey] || 0;
}

/**
 * Calculate total encounter XP and per-character XP
 * @param {array} crList - Array of CRs in encounter (e.g., [5, 3, 3, 2])
 * @param {number} partySize - Number of characters
 * @returns {object} { totalXP, perCharXP, effectiveCR, difficulty, description }
 */
export function calculateEncounterXP(crList, partySize) {
  let totalXP = 0;
  let effectiveValue = 0;

  crList.forEach(cr => {
    const xp = getXPForCR(cr);
    totalXP += xp;
    effectiveValue += parseFloat(cr);
  });

  const perCharXP = Math.floor(totalXP / partySize);
  const adjustedXP = applyPartyAdjustment(totalXP, partySize);

  // Determine difficulty
  const apl = calculateAPL({ size: partySize });
  const avgCR = effectiveValue / crList.length;
  let difficulty = 'Easy';
  if (avgCR >= apl + 3) difficulty = 'Deadly';
  else if (avgCR >= apl + 2) difficulty = 'Hard';
  else if (avgCR >= apl + 1) difficulty = 'Medium';
  else if (avgCR >= apl) difficulty = 'Average';

  return {
    totalXP,
    perCharXP,
    adjustedXP,
    effectiveCR: (effectiveValue / crList.length).toFixed(1),
    difficulty,
    description: `${crList.length} monster(s) totaling ${totalXP} XP (${perCharXP} per character). Adjusted for party size: ${adjustedXP} XP. Difficulty: ${difficulty}`,
  };
}

/**
 * Apply party size adjustment to XP
 * @private
 */
function applyPartyAdjustment(xp, partySize) {
  const adjustments = dmToolsData.encounterBuilding.partySizeAdjustment || {};
  const sizeCategory = partySize <= 2 ? 'tiny' : partySize <= 3 ? 'small' : partySize <= 5 ? 'medium' : 'large';
  const multiplier = adjustments[sizeCategory] || 1.0;
  return Math.floor(xp * multiplier);
}

/**
 * Build an encounter to a target difficulty
 * @param {number} apl - Average Party Level
 * @param {number} partySize - Number of party members
 * @param {string} difficulty - 'Easy', 'Average', 'Medium', 'Hard', 'Deadly'
 * @returns {object} { targetXP, suggestedMonsters, totalXP, effectiveCR, description }
 */
export function buildEncounter(apl, partySize, difficulty = 'Average') {
  const budget = getEncounterBudget(apl, difficulty);
  const targetXP = budget.partyBudget;

  // Find monster suggestions
  const suggestedMonsters = [];
  const crTable = dmToolsData.xpAwards.crXPTable;
  const crValues = Object.keys(crTable).map(key => ({
    cr: parseFloat(key),
    crKey: key,
    xp: crTable[key],
  })).sort((a, b) => b.cr - a.cr);

  let remainingBudget = targetXP;
  let attemptedCRs = new Set();

  // Try to fill budget with varied encounters
  while (remainingBudget > 0 && suggestedMonsters.length < 6) {
    const validCRs = crValues.filter(c => c.xp <= remainingBudget && !attemptedCRs.has(c.crKey));
    if (validCRs.length === 0) break;

    const selectedCR = validCRs[Math.floor(Math.random() * Math.min(validCRs.length, 3))];
    const count = Math.floor(remainingBudget / selectedCR.xp);

    if (count > 0) {
      suggestedMonsters.push({
        cr: selectedCR.crKey,
        count,
        xp: selectedCR.xp * count,
      });
      remainingBudget -= selectedCR.xp * count;
      attemptedCRs.add(selectedCR.crKey);
    }
  }

  const totalXP = targetXP - remainingBudget;
  const crList = suggestedMonsters.flatMap(m => Array(m.count).fill(parseFloat(m.cr)));
  const calc = calculateEncounterXP(crList, partySize);

  return {
    targetXP,
    suggestedMonsters,
    totalXP,
    effectiveCR: calc.effectiveCR,
    difficulty,
    description: `Suggested ${suggestedMonsters.length} monster group(s) totaling ${totalXP} XP for ${difficulty} difficulty at APL ${apl}.`,
  };
}

/**
 * Get XP budget for a given APL and difficulty
 * @param {number} apl - Average Party Level
 * @param {string} difficulty - Difficulty category
 * @returns {object} { partyBudget, perCharBudget, difficulty, apl }
 */
export function getEncounterBudget(apl, difficulty = 'Average') {
  const budgets = dmToolsData.encounterBuilding.encounterBudgetByAPL || {};
  const levelBudget = budgets[apl] || budgets[Math.min(apl, 20)];

  if (!levelBudget) {
    return {
      partyBudget: 0,
      perCharBudget: 0,
      difficulty,
      apl,
      description: 'No budget found for this level',
    };
  }

  const diffMultipliers = {
    Easy: 0.5,
    Average: 1.0,
    Medium: 1.5,
    Hard: 2.0,
    Deadly: 3.0,
  };

  const multiplier = diffMultipliers[difficulty] || 1.0;
  const basePerChar = levelBudget.basePerCharacter || 1200;
  const partySize = 4; // Default for budget calculation

  return {
    partyBudget: Math.floor(basePerChar * partySize * multiplier),
    perCharBudget: Math.floor(basePerChar * multiplier),
    difficulty,
    apl,
    description: `${difficulty} difficulty encounter budget for APL ${apl}`,
  };
}

/**
 * Calculate APL with party size adjustment
 * @param {object} party - Party object with size and optionally levels array
 * @returns {object} { apl, adjustedAPL, partySize, description }
 */
export function calculateAPL(party) {
  let baseAPL = 0;

  if (party.levels && Array.isArray(party.levels)) {
    baseAPL = Math.floor(party.levels.reduce((a, b) => a + b, 0) / party.levels.length);
  } else if (party.level) {
    baseAPL = party.level;
  }

  const partySize = party.size || party.levels?.length || 4;

  // Adjust for party size
  let adjustedAPL = baseAPL;
  if (partySize <= 2) adjustedAPL -= 1;
  else if (partySize === 3) adjustedAPL -= 0.5;
  else if (partySize >= 6) adjustedAPL += 1;

  return {
    apl: baseAPL,
    adjustedAPL: Math.round(adjustedAPL * 2) / 2,
    partySize,
    description: `Average party level is ${baseAPL} (adjusted to ${adjustedAPL} for party size ${partySize})`,
  };
}

/**
 * Award story XP
 * @param {string} awardType - Type from storyAwards (e.g., "Major Quest Complete")
 * @param {number} apl - Average Party Level
 * @param {number} partySize - Party size
 * @returns {object} { xpPerChar, totalXP, awardType, description }
 */
export function calculateStoryAward(awardType, apl, partySize) {
  const awards = dmToolsData.xpAwards.storyAwards || [];
  const awardData = awards.find(a => a.type === awardType);

  if (!awardData) {
    return { xpPerChar: 0, totalXP: 0, awardType, description: 'Award type not found' };
  }

  // Base XP from CR matching APL
  const baseXP = getXPForCR(apl);
  const xpPerChar = Math.floor(baseXP * awardData.xpMultiplier);
  const totalXP = xpPerChar * partySize;

  return {
    xpPerChar,
    totalXP,
    awardType,
    multiplier: awardData.xpMultiplier,
    description: `${awardType}: ${xpPerChar} XP per character (${totalXP} total). ${awardData.description}`,
  };
}

/**
 * Award ad-hoc XP (e.g., for excellent roleplaying)
 * @param {number} characterLevel - Character's level
 * @param {string} size - 'small', 'medium', 'large'
 * @returns {object} { xp, description }
 */
export function calculateAdHocAward(characterLevel, size = 'medium') {
  const adHoc = dmToolsData.xpAwards.adHocAwards || {};
  const perSession = adHoc.perCharacterPerSession || {};
  const levelRange = characterLevel <= 5 ? 'lowLevel' : characterLevel <= 11 ? 'midLevel' : 'highLevel';
  const awards = perSession[levelRange] || {};
  const xp = awards[size] || 100;

  return {
    xp,
    size,
    description: `Ad-hoc award for ${size} action at level ${characterLevel}: ${xp} XP`,
  };
}

/**
 * Get XP needed for next level
 * @param {number} currentXP - Current total XP
 * @param {number} currentLevel - Current level (1-20)
 * @param {string} track - 'slow', 'medium', 'fast'
 * @returns {object} { xpToLevel, xpNeeded, nextLevel, currentLevel, xpInLevel, percentToLevel }
 */
export function getXPToNextLevel(currentXP, currentLevel, track = 'medium') {
  const tracks = dmToolsData.xpAwards.xpProgressionTracks || {};
  const progression = tracks[track] || tracks.medium;

  const nextLevel = Math.min(currentLevel + 1, 20);
  const nextLevelXP = progression[nextLevel] || progression[progression.length - 1];
  const currentLevelXP = progression[currentLevel] || 0;

  const xpInLevel = currentXP - currentLevelXP;
  const xpNeededForLevel = nextLevelXP - currentLevelXP;
  const xpToLevel = nextLevelXP - currentXP;
  const percentToLevel = Math.floor((xpInLevel / xpNeededForLevel) * 100);

  return {
    xpToLevel: Math.max(0, xpToLevel),
    xpNeeded: xpNeededForLevel,
    nextLevel,
    currentLevel,
    xpInLevel,
    percentToLevel,
    description: `${Math.max(0, xpToLevel)} XP until level ${nextLevel} (${percentToLevel}% progress)`,
  };
}

/**
 * Check if character should level up
 * @param {number} currentXP - Current XP
 * @param {number} currentLevel - Current level
 * @param {string} track - 'slow', 'medium', 'fast'
 * @returns {object} { shouldLevelUp, newLevel, xpOverflow }
 */
export function checkLevelUp(currentXP, currentLevel, track = 'medium') {
  const tracks = dmToolsData.xpAwards.xpProgressionTracks || {};
  const progression = tracks[track] || tracks.medium;

  let newLevel = currentLevel;
  let overflow = 0;

  for (let level = currentLevel + 1; level <= 20; level++) {
    if (progression[level] && currentXP >= progression[level]) {
      newLevel = level;
    } else {
      break;
    }
  }

  const shouldLevelUp = newLevel > currentLevel;

  return {
    shouldLevelUp,
    newLevel,
    xpOverflow: currentXP - (progression[newLevel] || 0),
    description: shouldLevelUp ? `Character levels up to ${newLevel}!` : `Not enough XP yet (${currentLevel} still)`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NPC ATTITUDES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get current attitude data
 * @param {string} attitudeId - Attitude ID ('hostile', 'unfriendly', 'indifferent', 'friendly', 'helpful')
 * @returns {object} Attitude data with DC modifiers
 */
export function getAttitude(attitudeId) {
  const attitudes = dmToolsData.npcAttitudes?.attitudes || {};
  const attitude = attitudes[attitudeId];

  if (!attitude) {
    return { id: attitudeId, description: 'Unknown attitude' };
  }

  return {
    id: attitudeId,
    ...attitude,
    description: `NPC is ${attitudeId}`,
  };
}

/**
 * Calculate DC to shift NPC attitude via Diplomacy
 * @param {string} currentAttitude - Current attitude
 * @param {number} targetCHA - NPC's CHA modifier
 * @param {string} requestDifficulty - 'trivial', 'simple', 'moderate', 'complex'
 * @returns {object} { baseDC, npcModifier, totalDC, description }
 */
export function getDiplomacyShiftDC(currentAttitude, targetCHA = 10, requestDifficulty = 'simple') {
  const diplomacyDCs = dmToolsData.npcAttitudes?.diplomacyShiftDC || {};
  const baseDC = diplomacyDCs[currentAttitude] || 15;

  const difficultyMods = { trivial: -5, simple: 0, moderate: 5, complex: 10 };
  const requestMod = difficultyMods[requestDifficulty] || 0;

  const npcModifier = Math.floor((targetCHA - 10) / 2);
  const totalDC = Math.max(5, baseDC + requestMod + npcModifier);

  return {
    baseDC,
    requestDifficulty,
    npcModifier,
    totalDC,
    description: `DC ${totalDC} to shift ${currentAttitude} NPC (base ${baseDC} + ${requestMod} for ${requestDifficulty} request)`,
  };
}

/**
 * Attempt to shift NPC attitude via Diplomacy
 * @param {object} character - { diplomacy, cha }
 * @param {object} npc - { attitude, wis }
 * @returns {object} { success, newAttitude, roll, dc, total, description }
 */
export function attemptDiplomacy(character, npc) {
  const dc = getDiplomacyShiftDC(npc.attitude, npc.wis || 10, 'simple');
  const roll = rollDice('1d20');
  const total = roll + (character.diplomacy || 0);
  const success = total >= dc.totalDC;

  let newAttitude = npc.attitude;
  if (success) {
    const attitudeProgression = ['hostile', 'unfriendly', 'indifferent', 'friendly', 'helpful'];
    const currentIndex = attitudeProgression.indexOf(npc.attitude);
    if (currentIndex >= 0 && currentIndex < attitudeProgression.length - 1) {
      newAttitude = attitudeProgression[currentIndex + 1];
    }
  }

  return {
    success,
    newAttitude,
    roll,
    total,
    dc: dc.totalDC,
    description: success
      ? `Diplomacy check succeeded! Attitude improved from ${npc.attitude} to ${newAttitude}.`
      : `Diplomacy check failed. Attitude remains ${npc.attitude}.`,
  };
}

/**
 * Attempt to Intimidate NPC
 * @param {object} character - { intimidate }
 * @param {object} npc - { hd, wis }
 * @returns {object} { success, effect, description }
 */
export function attemptIntimidate(character, npc) {
  const intimidateDC = 10 + (npc.hd || 1) + Math.floor((npc.wis - 10) / 2);
  const roll = rollDice('1d20');
  const total = roll + (character.intimidate || 0);
  const success = total >= intimidateDC;

  let effect = 'No effect';
  if (success) {
    const duration = Math.ceil(rollDice('1d6') * 10); // 1d6 × 10 minutes
    effect = `NPC is shaken and friendly for ${duration} minutes, then becomes hostile`;
  }

  return {
    success,
    roll,
    total,
    dc: intimidateDC,
    effect,
    description: success ? effect : `Intimidation failed. NPC becomes hostile!`,
  };
}

/**
 * Attempt to Bluff
 * @param {object} character - { bluff }
 * @param {object} npc - { sense_motive }
 * @param {string} lieCircumstance - 'trivial', 'believable', 'unlikely', 'far_fetched'
 * @returns {object} { success, discovered, description }
 */
export function attemptBluff(character, npc, lieCircumstance = 'believable') {
  const bluffRules = dmToolsData.npcAttitudes?.bluffRules || {};
  const dcMods = bluffRules.dcModifiers || {};
  const baseDC = dcMods[lieCircumstance] || 10;

  const roll = rollDice('1d20');
  const total = roll + (character.bluff || 0);
  const success = total >= baseDC + (npc.sense_motive || 0);

  return {
    success,
    discovered: !success,
    roll,
    total,
    dc: baseDC + (npc.sense_motive || 0),
    description: success
      ? `Bluff succeeded! NPC believed the ${lieCircumstance} lie.`
      : `Bluff failed! NPC saw through the lie and is now hostile.`,
  };
}

/**
 * Get request DC based on attitude
 * @param {string} attitude - Current attitude
 * @param {string} requestType - 'simple', 'risky', 'expensive', 'dangerous'
 * @returns {object} { dc, attitude, requestType, description }
 */
export function getRequestDC(attitude, requestType) {
  const requestDCs = dmToolsData.npcAttitudes?.requestDCs || {};
  const attitudeDCs = requestDCs[attitude] || {};
  const dc = attitudeDCs[requestType] || 20;

  return {
    dc,
    attitude,
    requestType,
    description: `DC ${dc} for NPC with ${attitude} attitude to agree to ${requestType} request`,
  };
}

/**
 * Create NPC with attitude tracking
 * @param {string} name - NPC name
 * @param {string} attitude - Starting attitude
 * @param {number} level - NPC level/HD
 * @param {number} wis - Wisdom score
 * @returns {object} Complete NPC object
 */
export function createTrackedNPC(name, attitude = 'indifferent', level = 1, wis = 10) {
  return {
    name,
    attitude,
    level,
    hd: level,
    wis,
    cha: 10,
    sense_motive: 0,
    gear: [],
    attitudeHistory: [{ attitude, timestamp: new Date().toISOString() }],
    description: `${name} (${attitude}) - HD ${level}, WIS ${wis}`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT GENERATION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a random settlement
 * @param {string} sizeType - 'thorp', 'village', 'town', 'city', 'metropolis', or null for random
 * @returns {object} Full settlement object with stats
 */
export function generateSettlement(sizeType = null) {
  const settlements = dmToolsData.settlements?.settlementSizes || [];

  if (!sizeType) {
    // Weighted random toward smaller settlements
    const rand = Math.random();
    if (rand < 0.35) sizeType = 'thorp';
    else if (rand < 0.60) sizeType = 'village';
    else if (rand < 0.80) sizeType = 'town';
    else if (rand < 0.95) sizeType = 'city';
    else sizeType = 'metropolis';
  }

  const stats = getSettlementStats(sizeType);
  const governments = dmToolsData.settlements?.governmentTypes || [];
  const government = governments[Math.floor(Math.random() * governments.length)] || { type: 'Council' };

  const qualities = [];
  const qualityList = dmToolsData.settlements?.settlementQualities || [];
  for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) {
    const quality = qualityList[Math.floor(Math.random() * qualityList.length)];
    if (quality && !qualities.find(q => q.type === quality.type)) {
      qualities.push(quality);
    }
  }

  const availableSorcerer = rollDice('1d20') <= 8;
  const availableCleric = rollDice('1d20') <= 6;
  const availableWizard = rollDice('1d20') <= 4;

  return {
    name: `${sizeType.charAt(0).toUpperCase() + sizeType.slice(1)} (Generated)`,
    size: sizeType,
    ...stats,
    government: government.type,
    qualities,
    availableSpells: {
      sorcerer: availableSorcerer,
      cleric: availableCleric,
      wizard: availableWizard,
      maxSpellLevel: availableWizard ? Math.min(6, Math.floor(stats.population / 500)) : availableCleric ? 5 : 3,
    },
    description: `${sizeType} settlement with ${government.type} government. Population: ${stats.population}`,
  };
}

/**
 * Get settlement stats by type
 * @param {string} sizeType - Settlement size
 * @returns {object} Stats object with population, market baselines, corruption, etc.
 */
export function getSettlementStats(sizeType) {
  const sizes = dmToolsData.settlements?.settlementSizes || {};
  const stats = sizes[sizeType];

  if (!stats) {
    return {
      sizeType,
      population: 0,
      marketBaseline: 0,
      corruption: 0,
      crime: 0,
      disadvantage: 0,
      danger: 0,
    };
  }

  return {
    sizeType,
    population: stats.population || 0,
    marketBaseline: stats.marketBaseline || 0,
    corruption: Math.floor(Math.random() * 10),
    crime: Math.floor(Math.random() * 10),
    disadvantage: stats.disadvantages?.[Math.floor(Math.random() * (stats.disadvantages?.length || 1))] || 'None',
    danger: 0,
  };
}

/**
 * Check if item is available in settlement
 * @param {number} itemPrice - Item's market price
 * @param {object} settlement - Settlement object
 * @returns {object} { available, percentChance, dc, description }
 */
export function checkItemAvailability(itemPrice, settlement) {
  const marketBaseline = settlement.marketBaseline || 0;
  let chance = 75; // 75% base chance for items up to market baseline
  let dc = 10;

  if (itemPrice > marketBaseline) {
    // Custom DC for items above baseline
    const multiplier = itemPrice / marketBaseline;
    chance = Math.floor(75 / multiplier);
    dc = 10 + Math.floor(Math.log(multiplier) * 5);
  }

  const roll = Math.random() * 100;
  const available = roll <= chance;

  return {
    available,
    percentChance: chance,
    itemPrice,
    marketBaseline,
    dc,
    description: available
      ? `Item (${itemPrice} gp) is available in ${settlement.name || 'settlement'}.`
      : `Item (${itemPrice} gp) is NOT available; DC ${dc} to find elsewhere.`,
  };
}

/**
 * Get available spellcasting level in settlement
 * @param {object} settlement - Settlement object
 * @returns {object} { maxSpellLevel, availableCasters, description }
 */
export function getAvailableSpellcasting(settlement) {
  const spells = settlement.availableSpells || {};
  const available = [];
  let maxLevel = 0;

  if (spells.wizard) {
    available.push('Wizard');
    maxLevel = Math.max(maxLevel, spells.maxSpellLevel || 3);
  }
  if (spells.cleric) {
    available.push('Cleric');
    maxLevel = Math.max(maxLevel, spells.maxSpellLevel || 2);
  }
  if (spells.sorcerer) {
    available.push('Sorcerer');
    maxLevel = Math.max(maxLevel, spells.maxSpellLevel || 2);
  }

  return {
    maxSpellLevel: maxLevel,
    availableCasters: available.length > 0 ? available.join(', ') : 'None',
    description: `Spellcasting up to level ${maxLevel} available (${available.join(', ') || 'none'}).`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN PACING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get campaign framework by ID
 * @param {string} frameworkId - Framework ID
 * @returns {object} Campaign framework data
 */
export function getCampaignFramework(frameworkId) {
  const frameworks = dmToolsData.campaignFrameworks?.frameworks || {};
  const framework = frameworks[frameworkId];

  if (!framework) {
    return { id: frameworkId, description: 'Framework not found' };
  }

  return {
    id: frameworkId,
    ...framework,
    description: `${framework.name || frameworkId} campaign framework`,
  };
}

/**
 * Get all available frameworks
 * @returns {array} All frameworks
 */
export function getAllFrameworks() {
  const frameworks = dmToolsData.campaignFrameworks?.frameworks || {};
  return Object.keys(frameworks).map(id => ({
    id,
    ...frameworks[id],
  }));
}

/**
 * Calculate encounters needed to level up
 * @param {number} currentLevel - Current level
 * @param {number} currentXP - Current XP
 * @param {string} track - 'slow', 'medium', 'fast'
 * @param {string} encounterDifficulty - Encounter difficulty
 * @returns {object} { encountersNeeded, xpPerEncounter, nextLevelXP, description }
 */
export function encountersToLevelUp(currentLevel, currentXP, track = 'medium', encounterDifficulty = 'Average') {
  const tracks = dmToolsData.xpAwards.xpProgressionTracks || {};
  const progression = tracks[track] || tracks.medium;

  const nextLevelXP = progression[currentLevel + 1] || progression[progression.length - 1];
  const xpNeeded = nextLevelXP - currentXP;

  // Estimate XP per encounter based on difficulty
  const xpPerChar = getEncounterBudget(currentLevel, encounterDifficulty).perCharBudget;
  const encountersNeeded = Math.ceil(xpNeeded / (xpPerChar * 0.75)); // Assume not all encounters are combat

  return {
    encountersNeeded: Math.max(1, encountersNeeded),
    xpPerEncounter: xpPerChar,
    xpNeeded,
    nextLevelXP,
    currentLevel,
    description: `Approximately ${Math.max(1, encountersNeeded)} ${encounterDifficulty} encounters needed to reach level ${currentLevel + 1}.`,
  };
}

/**
 * Generate adventure hook
 * @param {string} hookType - Type of hook, or null for random
 * @returns {object} { hook, type, description }
 */
export function generateAdventureHook(hookType = null) {
  const hooks = dmToolsData.campaignFrameworks?.adventureHooks || [];

  if (hooks.length === 0) {
    return { hook: 'A mysterious stranger approaches the party.', type: 'default' };
  }

  const selectedHook = hooks[Math.floor(Math.random() * hooks.length)];

  return {
    hook: selectedHook.hook || selectedHook,
    type: selectedHook.type || 'mystery',
    description: `Adventure hook: ${selectedHook.hook || selectedHook}`,
  };
}

/**
 * Generate plot twist
 * @returns {object} { twist, category, description }
 */
export function generatePlotTwist() {
  const twists = dmToolsData.campaignFrameworks?.plotTwists || [];

  if (twists.length === 0) {
    return { twist: 'Nothing is as it seems.', category: 'default' };
  }

  const selectedTwist = twists[Math.floor(Math.random() * twists.length)];

  return {
    twist: selectedTwist.twist || selectedTwist,
    category: selectedTwist.category || 'revelation',
    description: `Plot twist: ${selectedTwist.twist || selectedTwist}`,
  };
}

/**
 * Get story arc pacing for an adventure
 * @param {number} totalEncounters - Expected number of encounters
 * @returns {object} Pacing recommendations
 */
export function getStoryArcPacing(totalEncounters) {
  const pacing = dmToolsData.encounterBuilding?.encounterPacing || {};

  let phase = 'Act I';
  let recommendedEncounters = Math.floor(totalEncounters / 3);

  if (totalEncounters <= 3) phase = 'One-shot';
  else if (totalEncounters <= 6) phase = 'Act I';
  else if (totalEncounters <= 12) phase = 'Acts I-II';
  else phase = 'Full Campaign';

  return {
    phase,
    recommendedEncounters,
    act1Encounters: Math.floor(totalEncounters * 0.25),
    act2Encounters: Math.floor(totalEncounters * 0.50),
    act3Encounters: Math.floor(totalEncounters * 0.25),
    description: `${phase}: Recommend ${recommendedEncounters} encounters per act.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VERBAL DUELS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize a verbal duel
 * @param {object} participant1 - { name, cha, level }
 * @param {object} participant2 - { name, cha, level }
 * @returns {object} Duel state
 */
export function initVerbalDuel(participant1, participant2) {
  const chaMod1 = Math.floor((participant1.cha - 10) / 2);
  const chaMod2 = Math.floor((participant2.cha - 10) / 2);

  return {
    participant1: {
      ...participant1,
      determination: chaMod1 + Math.min(participant1.level, 5),
      startDetermination: chaMod1 + Math.min(participant1.level, 5),
      tactics: [],
    },
    participant2: {
      ...participant2,
      determination: chaMod2 + Math.min(participant2.level, 5),
      startDetermination: chaMod2 + Math.min(participant2.level, 5),
      tactics: [],
    },
    exchanges: 0,
    resolved: false,
    winner: null,
    description: `Verbal duel initiated between ${participant1.name} and ${participant2.name}`,
  };
}

/**
 * Resolve a verbal duel exchange
 * @param {object} duelState - Current duel state
 * @param {string} attackerTactic - Tactic used
 * @param {string} defenderTactic - Tactic used
 * @returns {object} Updated duel state with results
 */
export function resolveVerbalExchange(duelState, attackerTactic, defenderTactic) {
  const tactics = getVerbalTactics();
  const attackerData = tactics.find(t => t.name === attackerTactic);
  const defenderData = tactics.find(t => t.name === defenderTactic);

  if (!attackerData || !defenderData) {
    return { ...duelState, error: 'Invalid tactic' };
  }

  let damage = 0;
  let countered = false;

  // Check if defender counters attacker
  if (defenderData.counters?.includes(attackerTactic)) {
    countered = true;
    damage = Math.max(0, attackerData.impact - 1);
  } else {
    damage = attackerData.impact;
  }

  const newState = { ...duelState };
  newState.participant2.determination -= damage;
  newState.exchanges++;

  if (newState.participant2.determination <= 0) {
    newState.resolved = true;
    newState.winner = duelState.participant1.name;
  }

  newState.lastExchange = {
    attacker: duelState.participant1.name,
    defender: duelState.participant2.name,
    attackTactic: attackerTactic,
    defenseTactic: defenderTactic,
    damageDealt: damage,
    countered,
    description: countered
      ? `${duelState.participant1.name}'s ${attackerTactic} was countered!`
      : `${duelState.participant1.name} dealt ${damage} determination damage with ${attackerTactic}!`,
  };

  return newState;
}

/**
 * Get verbal duel tactics
 * @returns {array} Available tactics
 */
export function getVerbalTactics() {
  return dmToolsData.verbalDuels?.tactics || [
    {
      name: 'Charm',
      impact: 1,
      counters: ['Intimidation'],
      description: 'Appeal to their good nature',
    },
    {
      name: 'Intimidation',
      impact: 2,
      counters: ['Charm'],
      description: 'Use threats and fear',
    },
    {
      name: 'Logic',
      impact: 1,
      counters: ['Passion'],
      description: 'Use reason and facts',
    },
    {
      name: 'Passion',
      impact: 2,
      counters: ['Logic'],
      description: 'Appeal to emotions',
    },
    {
      name: 'Deflect',
      impact: 0,
      counters: [],
      description: 'Avoid or deflect the argument',
    },
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SKILL CHALLENGES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize a skill challenge
 * @param {number} complexity - 1-5 (1=easy, 5=deadly)
 * @param {number} apl - Average Party Level
 * @param {string} templateId - Optional template ID
 * @returns {object} Challenge state
 */
export function initSkillChallenge(complexity, apl, templateId = null) {
  const complexities = {
    1: { successesNeeded: 4, failuresAllowed: 3, dcMod: 0 },
    2: { successesNeeded: 6, failuresAllowed: 2, dcMod: 2 },
    3: { successesNeeded: 8, failuresAllowed: 2, dcMod: 5 },
    4: { successesNeeded: 10, failuresAllowed: 1, dcMod: 7 },
    5: { successesNeeded: 12, failuresAllowed: 0, dcMod: 10 },
  };

  const config = complexities[complexity] || complexities[3];
  const baseDC = 10 + apl;

  return {
    complexity,
    apl,
    templateId,
    successesNeeded: config.successesNeeded,
    failuresAllowed: config.failuresAllowed,
    successes: 0,
    failures: 0,
    primaryDC: baseDC,
    secondaryDC: baseDC + 2,
    resolved: false,
    result: null,
    checks: [],
    description: `Skill challenge (complexity ${complexity}): Need ${config.successesNeeded} successes, ${config.failuresAllowed} failures allowed.`,
  };
}

/**
 * Attempt a skill check in a skill challenge
 * @param {object} challenge - Challenge state
 * @param {object} character - { name, skill_bonus }
 * @param {string} skillName - Name of skill used
 * @param {boolean} isPrimary - Is this a primary DC check?
 * @returns {object} Updated challenge and check result
 */
export function attemptSkillCheck(challenge, character, skillName, isPrimary = true) {
  const dc = isPrimary ? challenge.primaryDC : challenge.secondaryDC;
  const roll = rollDice('1d20');
  const total = roll + (character.skill_bonus || 0);
  const success = total >= dc;

  if (success) {
    challenge.successes++;
  } else {
    challenge.failures++;
  }

  challenge.checks.push({
    character: character.name,
    skill: skillName,
    roll,
    total,
    dc,
    success,
    isPrimary,
  });

  // Check if challenge is resolved
  if (challenge.successes >= challenge.successesNeeded) {
    challenge.resolved = true;
    challenge.result = 'success';
  } else if (challenge.failures > challenge.failuresAllowed) {
    challenge.resolved = true;
    challenge.result = 'failure';
  }

  return {
    challenge,
    check: {
      character: character.name,
      skill: skillName,
      roll,
      total,
      dc,
      success,
      description: success
        ? `${character.name} succeeded with ${skillName} (${total} vs DC ${dc})`
        : `${character.name} failed ${skillName} (${total} vs DC ${dc})`,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PLANES & COSMOLOGY
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get plane data by name
 * @param {string} planeName - Name of plane
 * @returns {object} Plane data
 */
export function getPlane(planeName) {
  const planes = dmToolsData.planes?.planeList || {};
  const plane = planes[planeName];

  if (!plane) {
    return { name: planeName, description: 'Plane not found' };
  }

  return {
    name: planeName,
    ...plane,
    description: `${planeName}: ${plane.description || 'A mysterious plane of existence'}`,
  };
}

/**
 * Get all planes
 * @returns {array} All planes
 */
export function getAllPlanes() {
  const planes = dmToolsData.planes?.planeList || {};
  return Object.keys(planes).map(name => ({
    name,
    ...planes[name],
  }));
}

/**
 * Get planar hazard effects on character
 * @param {string} planeName - Plane name
 * @param {object} character - { level, abilities }
 * @returns {object} Hazard effects
 */
export function getPlanarHazardEffects(planeName, character) {
  const plane = getPlane(planeName);

  if (plane.hazards) {
    const hazard = plane.hazards[Math.floor(Math.random() * plane.hazards.length)];
    return {
      planeName,
      hazard: hazard.name,
      dc: hazard.dc || 15,
      damage: hazard.damage || '0',
      description: `${hazard.name}: ${hazard.description}`,
    };
  }

  return {
    planeName,
    hazard: 'None',
    description: `${planeName} has no immediate hazards.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR & TIME
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get month data by index
 * @param {number} monthIndex - 0-11
 * @returns {object} Month data
 */
export function getMonth(monthIndex) {
  const monthIndex0 = monthIndex % 12;
  const calendar = dmToolsData.calendarAndTimekeeping?.months || [];
  const month = calendar[monthIndex0];

  if (!month) {
    return { monthIndex: monthIndex0, name: 'Unknown' };
  }

  return {
    monthIndex: monthIndex0,
    ...month,
    description: `${month.name || 'Month'} (${month.daysInMonth || 30} days)`,
  };
}

/**
 * Get holidays for a month
 * @param {number} monthIndex - 0-11
 * @returns {array} Holidays in month
 */
export function getHolidaysForMonth(monthIndex) {
  const month = getMonth(monthIndex);
  return month.holidays || [];
}

/**
 * Advance time
 * @param {number} currentDay - Current day of month (1-30)
 * @param {number} currentHour - Current hour (0-23)
 * @param {number} hoursToAdvance - Hours to advance
 * @returns {object} { newDay, newHour, newMonth, daysElapsed, holidays, description }
 */
export function advanceTime(currentDay, currentHour, hoursToAdvance) {
  let day = currentDay;
  let hour = currentHour;
  let month = 0;
  let year = 0;
  let daysElapsed = 0;

  let totalHours = hoursToAdvance;
  hour += totalHours;

  while (hour >= 24) {
    hour -= 24;
    day++;
    daysElapsed++;
  }

  const calendar = dmToolsData.calendarAndTimekeeping?.months || [];
  const daysInCurrentMonth = calendar[month]?.daysInMonth || 30;

  while (day > daysInCurrentMonth) {
    day -= daysInCurrentMonth;
    month++;
    if (month >= calendar.length) {
      month = 0;
      year++;
    }
  }

  const holidays = getHolidaysForMonth(month);

  return {
    newDay: day,
    newHour: hour,
    newMonth: month,
    newYear: year,
    daysElapsed,
    holidays: holidays.filter(h => h.day === day),
    description: `Time advanced ${hoursToAdvance} hours. Now ${getMonth(month).name} ${day}, Year ${year}, Hour ${hour}:00`,
  };
}

/**
 * Get season for a month
 * @param {number} monthIndex - 0-11
 * @returns {object} { season, monthIndex, description }
 */
export function getSeasonForMonth(monthIndex) {
  const monthIndex0 = monthIndex % 12;
  const seasonMap = {
    0: 'Winter', 1: 'Winter', 2: 'Spring',
    3: 'Spring', 4: 'Spring', 5: 'Summer',
    6: 'Summer', 7: 'Summer', 8: 'Autumn',
    9: 'Autumn', 10: 'Autumn', 11: 'Winter',
  };

  const season = seasonMap[monthIndex0] || 'Unknown';

  return {
    season,
    monthIndex: monthIndex0,
    month: getMonth(monthIndex0).name,
    description: `${season} - ${getMonth(monthIndex0).name}`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NPC GEAR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Get NPC gear budget by level
 * @param {number} level - NPC level/CR
 * @returns {object} { totalBudget, weaponBudget, armorBudget, gearBudget, description }
 */
export function getNPCGearBudget(level) {
  const gearBudgets = dmToolsData.npcGearByLevel || {};
  const budget = gearBudgets[level];

  if (!budget) {
    // Estimate based on level
    const baseBudget = 500 * level;
    return {
      totalBudget: baseBudget,
      weaponBudget: Math.floor(baseBudget * 0.3),
      armorBudget: Math.floor(baseBudget * 0.3),
      gearBudget: Math.floor(baseBudget * 0.4),
      description: `Estimated gear budget for level ${level}: ${baseBudget} gp`,
    };
  }

  return {
    totalBudget: budget.total || 0,
    weaponBudget: budget.weapons || 0,
    armorBudget: budget.armor || 0,
    gearBudget: budget.gear || 0,
    description: `Gear budget for level ${level}: ${budget.total || 0} gp total`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export default {
  // XP & Encounters
  getXPForCR,
  calculateEncounterXP,
  buildEncounter,
  getEncounterBudget,
  calculateAPL,
  calculateStoryAward,
  calculateAdHocAward,
  getXPToNextLevel,
  checkLevelUp,
  // NPC Attitudes
  getAttitude,
  getDiplomacyShiftDC,
  attemptDiplomacy,
  attemptIntimidate,
  attemptBluff,
  getRequestDC,
  createTrackedNPC,
  // Settlements
  generateSettlement,
  getSettlementStats,
  checkItemAvailability,
  getAvailableSpellcasting,
  // Campaign
  getCampaignFramework,
  getAllFrameworks,
  encountersToLevelUp,
  generateAdventureHook,
  generatePlotTwist,
  getStoryArcPacing,
  // Verbal Duels
  initVerbalDuel,
  resolveVerbalExchange,
  getVerbalTactics,
  // Skill Challenges
  initSkillChallenge,
  attemptSkillCheck,
  // Planes
  getPlane,
  getAllPlanes,
  getPlanarHazardEffects,
  // Calendar
  getMonth,
  getHolidaysForMonth,
  advanceTime,
  getSeasonForMonth,
  // NPC Gear
  getNPCGearBudget,
};
