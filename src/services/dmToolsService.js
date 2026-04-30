import dmToolsData from '../data/dmToolsData.json';
import { roll, rollDice } from '../utils/dice';
import { resolveBluff, resolveSecretMessage } from '../utils/rulesEngine';
import { getEmotionalModifiers } from './npcPersonality.js';

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
 * Attempt social Bluff (deception) — CRB pp. 90–92.
 *
 * Opposed check: character's Bluff vs NPC's Sense Motive, modified by
 * plausibility, disposition, and optional circumstance modifiers.
 *
 * On failure by 5+, the NPC has a hostile reaction (CRB: "convinced you
 * are trying to use it"). Attitude drops to hostile.
 *
 * @param {object} character  { name, bluff (total modifier) }
 * @param {object} npc        { name, sense_motive, attitude, wis }
 * @param {string} plausibility  'believable' | 'unlikely' | 'far-fetched' | 'impossible'
 * @param {object} opts        { targetWantsToBelieve, drunk, proofBonus, retryPenalty }
 * @returns {object} { success, hostileReaction, newAttitude, roll, bluffTotal, smTotal, breakdown, description }
 */
export function attemptBluff(character, npc, plausibility = 'believable', opts = {}) {
  const bluffRoll = rollDice('1d20');
  const bluffTotal = bluffRoll + (character.bluff || 0);

  // NPC Sense Motive: use explicit bonus or derive from Wis + half level (untrained default)
  const smBonus = npc.sense_motive ?? Math.floor(((npc.wis || 10) - 10) / 2);
  const smRoll = rollDice('1d20');
  const smTotal = smRoll + smBonus;

  const targetWants = opts.targetWantsToBelieve || 0;
  const result = resolveBluff(bluffTotal, smTotal, plausibility, targetWants, {
    drunk: opts.drunk || false,
    proofBonus: opts.proofBonus || 0,
    retryPenalty: opts.retryPenalty || 0,
  });

  // Attitude consequence: hostile reaction drops attitude to hostile
  let newAttitude = npc.attitude || 'indifferent';
  if (result.hostileReaction) {
    newAttitude = 'hostile';
  }

  const pcName = character.name || 'Character';
  const npcName = npc.name || 'NPC';
  const description = result.success
    ? `${pcName} successfully deceived ${npcName} with a ${plausibility} lie.`
    : result.hostileReaction
      ? `${pcName}'s lie was seen through badly — ${npcName} is now hostile!`
      : `${pcName}'s lie was seen through by ${npcName}.`;

  return {
    success: result.success,
    hostileReaction: result.hostileReaction,
    discovered: !result.success,
    newAttitude,
    roll: bluffRoll,
    bluffTotal,
    smTotal,
    breakdown: result.breakdown,
    description,
  };
}

/**
 * Attempt to pass a secret message via Bluff — CRB p. 92.
 *
 * @param {object} sender    { name, bluff (total modifier) }
 * @param {object} listener  { name, sense_motive }
 * @param {string} complexity 'simple' (DC 15) | 'complex' (DC 20)
 * @returns {object} { senderSucceeds, wrongMessageDelivered, intendedReadable, breakdown, description }
 */
export function attemptSecretMessage(sender, listener, complexity = 'simple') {
  const bluffRoll = rollDice('1d20');
  const bluffTotal = bluffRoll + (sender.bluff || 0);
  const smRoll = rollDice('1d20');
  const smBonus = listener.sense_motive ?? Math.floor(((listener.wis || 10) - 10) / 2);
  const smTotal = smRoll + smBonus;

  const result = resolveSecretMessage(bluffTotal, smTotal, complexity);

  const sName = sender.name || 'Sender';
  const lName = listener.name || 'Listener';
  let description;
  if (result.wrongMessageDelivered) {
    description = `${sName} botched the secret message — the wrong meaning was conveyed to ${lName}!`;
  } else if (!result.senderSucceeds) {
    description = `${sName} failed to encode the message clearly.`;
  } else if (result.intendedReadable) {
    description = `${sName} passed a secret ${complexity} message to ${lName} successfully.`;
  } else {
    description = `${sName} encoded the message, but ${lName} couldn't decode it.`;
  }

  return {
    ...result,
    bluffRoll,
    bluffTotal,
    smTotal,
    description,
  };
}

/**
 * NPC → PC bluff pathway: an NPC lies to the party — CRB pp. 90-92.
 * The NPC rolls Bluff (using its stored bonus); the PC opposes with Sense Motive.
 *
 * @param {object} npc  { name, bluff (modifier), attitude }
 * @param {object} pc   { name, sense_motive or senseMotive (modifier) }
 * @param {string} plausibility  'believable' | 'unlikely' | 'far-fetched' | 'impossible'
 * @param {object} opts  { targetWantsToBelieve, drunk, proofBonus }
 * @returns {object} { success, hostileReaction, discovered, pcSuspects, breakdown, description, ... }
 */
export function attemptNPCBluff(npc, pc, plausibility = 'believable', opts = {}) {
  // NPC Bluff roll
  const bluffBonus = npc.bluff ?? npc.sense_motive ?? 0; // npc.bluff is explicit Bluff modifier
  const npcBluffRoll = rollDice('1d20');
  const bluffTotal = npcBluffRoll + (npc.bluff || 0);

  // PC Sense Motive roll
  const smBonus = pc.sense_motive ?? pc.senseMotive ?? Math.floor(((pc.wis || 10) - 10) / 2);
  const smRoll = rollDice('1d20');
  const smTotal = smRoll + smBonus;

  const result = resolveBluff(bluffTotal, smTotal, plausibility, opts.targetWantsToBelieve || 0, {
    drunk: opts.drunk || false,
    proofBonus: opts.proofBonus || 0,
    retryPenalty: opts.retryPenalty || 0,
  });

  const npcLabel = npc.name || 'The stranger';
  const pcName = pc.name || 'you';

  let description;
  if (result.success) {
    description = `${npcLabel} told ${pcName} a ${plausibility} lie — and ${pcName} believed it.`;
  } else if (result.hostileReaction) {
    description = `${pcName} saw through ${npcLabel}'s lie and is offended by the deception!`;
  } else {
    description = `${pcName} gets the feeling ${npcLabel} isn't being truthful.`;
  }

  return {
    success: result.success,
    hostileReaction: result.hostileReaction,
    discovered: !result.success,
    pcSuspects: !result.success && !result.hostileReaction,
    npcBluffRoll,
    bluffTotal,
    smRoll,
    smTotal,
    breakdown: result.breakdown,
    description,
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

// ══════════════════════════════════════════════════════════════════════════════
// NPC DECEPTION PERSONALITY SYSTEM
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Deception tendency — how inclined the NPC is to lie or withhold.
 *
 *   honest       — Lies only when life/loved-ones are at stake.
 *   evasive      — Dodges and deflects rather than outright lying.
 *   manipulative — Lies strategically for personal/political gain.
 *   compulsive   — Lies even when there's no clear benefit.
 *
 * Each tendency carries a base weight that feeds into shouldNPCDeceive().
 */
export const DECEPTION_TENDENCIES = {
  honest:       { label: 'Honest',       baseWeight: 0,  description: 'Lies only under dire threat to self or loved ones.' },
  evasive:      { label: 'Evasive',      baseWeight: 20, description: 'Prefers half-truths and deflection over outright lies.' },
  manipulative: { label: 'Manipulative', baseWeight: 45, description: 'Lies strategically to advance personal or political goals.' },
  compulsive:   { label: 'Compulsive',   baseWeight: 65, description: 'Lies frequently, even when truth would serve better.' },
};

/**
 * Personality → deception tendency weighting.
 * Existing personality strings from npcTracker map to likelihood of each tendency.
 */
const PERSONALITY_DECEPTION_MAP = {
  cunning:      { honest: 5,  evasive: 25, manipulative: 55, compulsive: 15 },
  secretive:    { honest: 10, evasive: 50, manipulative: 30, compulsive: 10 },
  greedy:       { honest: 10, evasive: 20, manipulative: 55, compulsive: 15 },
  paranoid:     { honest: 15, evasive: 45, manipulative: 25, compulsive: 15 },
  kind:         { honest: 65, evasive: 25, manipulative: 5,  compulsive: 5  },
  pious:        { honest: 55, evasive: 30, manipulative: 10, compulsive: 5  },
  noble:        { honest: 50, evasive: 30, manipulative: 15, compulsive: 5  },
  jovial:       { honest: 40, evasive: 30, manipulative: 15, compulsive: 15 },
  gruff:        { honest: 40, evasive: 35, manipulative: 15, compulsive: 10 },
  nervous:      { honest: 30, evasive: 40, manipulative: 10, compulsive: 20 },
  boisterous:   { honest: 35, evasive: 15, manipulative: 20, compulsive: 30 },
  melancholy:   { honest: 40, evasive: 40, manipulative: 10, compulsive: 10 },
  stern:        { honest: 45, evasive: 35, manipulative: 15, compulsive: 5  },
  'absent-minded': { honest: 50, evasive: 20, manipulative: 5, compulsive: 25 },
  flirtatious:  { honest: 20, evasive: 25, manipulative: 35, compulsive: 20 },
  sarcastic:    { honest: 30, evasive: 35, manipulative: 20, compulsive: 15 },
  suspicious:   { honest: 25, evasive: 45, manipulative: 20, compulsive: 10 },
};

/**
 * Pick a deception tendency based on personality weights.
 * Falls back to a balanced distribution if personality is unknown.
 */
function rollDeceptionTendency(personality) {
  const weights = PERSONALITY_DECEPTION_MAP[(personality || '').toLowerCase()]
    || { honest: 30, evasive: 30, manipulative: 25, compulsive: 15 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [tendency, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return tendency;
  }
  return 'honest'; // fallback
}

/**
 * Determine whether an NPC should attempt to deceive the party and with what
 * plausibility / approach, given the conversational context.
 *
 * @param {object} npc   — full NPC object (with secrets, deceptionTendency, attitude, etc.)
 * @param {string} topic — what the party is asking about (matched against npc.secrets[].topic)
 * @param {object} opts  — { pcIntimidate: bool, pcDiplomacy: bool, pcInsight: bool }
 * @returns {object} { willDeceive, approach, plausibility, reason, matchedSecret }
 *
 * approach values:
 *   'lie'      — outright false statement (Bluff check)
 *   'deflect'  — evasive non-answer (no check, but perceptive PCs may notice)
 *   'omit'     — tells partial truth, hides the dangerous part (Bluff at +2 situational)
 *   'truth'    — NPC tells the truth
 */
export function shouldNPCDeceive(npc, topic = '', opts = {}) {
  if (!npc) return { willDeceive: false, approach: 'truth', plausibility: 'believable', reason: 'No NPC provided.' };

  const tendency = npc.deceptionTendency || 'honest';
  const tendencyData = DECEPTION_TENDENCIES[tendency] || DECEPTION_TENDENCIES.honest;
  const attitude = (npc.attitude || 'indifferent').toLowerCase();
  const intScore = npc.int ?? npc.abilities?.INT ?? 10;
  const secrets = npc.secrets || [];

  // ── 1. Find relevant secret ──
  const topicLower = (topic || '').toLowerCase();
  const matchedSecret = secrets.find(s => {
    if (!s.topic) return false;
    const sTopic = s.topic.toLowerCase();
    return topicLower.includes(sTopic) || sTopic.includes(topicLower);
  });

  // ── 2. Base deception score (0–100) ──
  let score = tendencyData.baseWeight;

  // Secret relevance is the single biggest driver
  if (matchedSecret) {
    const severityBonus = { low: 10, medium: 25, high: 40, critical: 60 };
    score += severityBonus[matchedSecret.severity] || 25;
  } else if (tendency === 'compulsive') {
    // Compulsive liars may lie even without a secret to protect
    score += 10;
  }
  // No secret and not compulsive → strong pull toward truth
  if (!matchedSecret && tendency !== 'compulsive') {
    score = Math.min(score, 15);
  }

  // ── 3. Attitude modifier ──
  const attitudeMod = {
    hostile: 30,     // actively wants to mislead
    unfriendly: 15,  // not inclined to help
    indifferent: 0,
    friendly: -15,   // disposed to be helpful
    helpful: -30,    // strong pull toward honesty
  };
  score += attitudeMod[attitude] ?? 0;

  // ── 4. Intelligence modifier — smarter NPCs are better at judging when to lie ──
  if (intScore <= 5) {
    // Very low Int: poor liars, less likely to attempt
    score -= 15;
  } else if (intScore >= 16) {
    // High Int: better at crafting believable lies, more willing if strategic
    if (tendency === 'manipulative') score += 10;
  }

  // ── 5. Emotional state modifier ──
  const eMods = getEmotionalModifiers(npc.emotionalState);
  score += eMods.deceptionMod;

  // ── 6. Situational modifiers ──
  if (opts.pcIntimidate) {
    // Being intimidated can crack honest/evasive NPCs but makes manipulative ones dig in
    if (tendency === 'honest' || tendency === 'evasive') score -= 20;
    else score += 5;
  }
  if (opts.pcDiplomacy) {
    // Successful diplomacy lowers deception inclination
    score -= 15;
  }

  // ── 6. Clamp and decide ──
  score = Math.max(0, Math.min(100, score));
  const willDeceive = score >= 40;

  // ── 7. Pick approach based on tendency + score ──
  let approach = 'truth';
  if (willDeceive) {
    if (tendency === 'evasive' || (score < 55 && tendency !== 'compulsive')) {
      approach = score >= 50 ? 'omit' : 'deflect';
    } else {
      approach = 'lie';
    }
  }

  // ── 8. Plausibility — how believable is the lie? ──
  let plausibility = 'believable';
  if (willDeceive) {
    if (matchedSecret?.severity === 'critical' || matchedSecret?.severity === 'high') {
      // Big secrets are harder to cover convincingly
      plausibility = intScore >= 14 ? 'believable' : 'unlikely';
    }
    if (tendency === 'compulsive' && !matchedSecret) {
      // Pointless lies tend to be sloppy
      plausibility = 'unlikely';
    }
    if (intScore <= 5) {
      plausibility = 'far-fetched';
    }
  }

  const reason = willDeceive
    ? matchedSecret
      ? `${tendency} NPC is hiding a ${matchedSecret.severity} secret about "${matchedSecret.topic}".`
      : `${tendency} NPC is inclined to deceive (score ${score}).`
    : matchedSecret
      ? `Despite having a secret, ${tendency} NPC chooses honesty (score ${score}).`
      : `${tendency} NPC has no reason to lie.`;

  return { willDeceive, approach, plausibility, score, reason, matchedSecret: matchedSecret || null };
}

/**
 * Create NPC with attitude tracking
 * @param {string} name - NPC name
 * @param {string} attitude - Starting attitude
 * @param {number} level - NPC level/HD
 * @param {number} wis - Wisdom score
 * @param {object} extra - Optional overrides: { personality, secrets, deceptionTendency, int, cha }
 * @returns {object} Complete NPC object
 */
export function createTrackedNPC(name, attitude = 'indifferent', level = 1, wis = 10, extra = {}) {
  const personality = extra.personality || '';
  const deceptionTendency = extra.deceptionTendency || rollDeceptionTendency(personality);
  const intScore = extra.int ?? 10;
  const occupation = extra.occupation || '';
  return {
    name,
    attitude,
    level,
    hd: level,
    wis,
    cha: extra.cha ?? 10,
    int: intScore,
    sense_motive: 0,
    personality,
    occupation,
    deceptionTendency,
    secrets: extra.secrets || [],
    emotionalState: extra.emotionalState || { mood: 'calm', intensity: 0, setAt: null, recentEvents: [] },
    memories: extra.memories || [],
    goal: extra.goal || null,
    knowledge: extra.knowledge || [],
    relationships: extra.relationships || [],
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
  // Bug #15 fix: data key is `golarionMonths`, not `months` — old lookup
// always fell back to [] which made getMonth/advanceTime return 'Unknown'.
const calendar = dmToolsData.calendarAndTimekeeping?.golarionMonths || [];
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

  // Bug #15 fix: data key is `golarionMonths`, not `months` — old lookup
// always fell back to [] which made getMonth/advanceTime return 'Unknown'.
const calendar = dmToolsData.calendarAndTimekeeping?.golarionMonths || [];
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
  attemptNPCBluff,
  attemptSecretMessage,
  getRequestDC,
  createTrackedNPC,
  DECEPTION_TENDENCIES,
  shouldNPCDeceive,
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
