/**
 * tavernService.js — Pathfinder 1e tavern, inn, and social encounter system
 *
 * Implements: patron generation, tavern events, drinking/carousing,
 * gather information, rest/recovery, gambling, and entertainment.
 * All mechanics reference PF1e Core Rulebook, GameMastery Guide, and Ultimate Campaign.
 */

import settlementsData from '../data/settlements.json';
import { getCharacterSkillTotal } from '../utils/characterSkills';

// ─── Seeded PRNG (same as shopService) ─────────────────────────
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 0) / 0x7fffffff;
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function rollDieSeeded(sides, rng) {
  return Math.floor(rng() * sides) + 1;
}

// ─── Data accessors ────────────────────────────────────────────
export function getTavernQualityTiers() {
  return settlementsData.tavernQualityTiers || {};
}

export function getPatronTypes() {
  return settlementsData.patronTypes || {};
}

export function getDrinkingRules() {
  return settlementsData.drinkingRules || {};
}

export function getRestRules() {
  return settlementsData.restAndRecovery || {};
}

export function getCampaignRumors(settlementId, chapter) {
  const rumors = settlementsData.campaignRumors || {};
  const settlementRumors = rumors[settlementId] || {};
  // Return rumors for current chapter and all previous chapters
  const result = [];
  for (let ch = 1; ch <= (chapter || 1); ch++) {
    const chRumors = settlementRumors[String(ch)] || [];
    result.push(...chRumors);
  }
  return result;
}

// ─── Patron Generation ─────────────────────────────────────────
/**
 * Generate patrons for a tavern using seeded PRNG for weekly consistency.
 * @param {Object} tavern - Tavern data object with quality, id
 * @param {string} settlementId - Settlement ID
 * @param {number} seed - Week seed for consistency
 * @param {Object} settlementMods - Settlement modifiers {crime, corruption, etc.}
 * @returns {Array} Array of patron objects
 */
export function generatePatrons(tavern, settlementId, seed, settlementMods = {}) {
  const quality = tavern.quality || 'average';
  const tier = settlementsData.tavernQualityTiers[quality] || settlementsData.tavernQualityTiers.average;
  const patronWeights = settlementsData.patronWeightsByQuality[quality] || settlementsData.patronWeightsByQuality.average;
  const patronTypes = settlementsData.patronTypes || {};

  const rng = seededRandom(hashString(`${settlementId}-${tavern.id}-patrons-${seed}`));

  // Determine number of patrons based on tier capacity
  const [minCap, maxCap] = tier.patronCapacity;
  const count = minCap + Math.floor(rng() * (maxCap - minCap + 1));

  // High crime settlements have more criminals
  const adjustedWeights = { ...patronWeights };
  if ((settlementMods.crime || 0) >= 3) {
    adjustedWeights.criminal = (adjustedWeights.criminal || 0) + 2;
  }
  if ((settlementMods.lore || 0) >= 3) {
    adjustedWeights.scholar = (adjustedWeights.scholar || 0) + 1;
  }
  if ((settlementMods.economy || 0) >= 3) {
    adjustedWeights.merchant = (adjustedWeights.merchant || 0) + 1;
  }

  // Build weighted pool
  const pool = [];
  for (const [type, weight] of Object.entries(adjustedWeights)) {
    for (let i = 0; i < weight; i++) pool.push(type);
  }

  // Generate patrons
  const patrons = [];
  const NAMES_MALE = ['Aldric', 'Bowen', 'Cael', 'Dorin', 'Elric', 'Fenn', 'Gareth', 'Harlan', 'Idris', 'Joss', 'Kellan', 'Leoric', 'Marten', 'Nolan', 'Orin', 'Perrin', 'Quill', 'Ronan', 'Silas', 'Theron'];
  const NAMES_FEMALE = ['Aela', 'Brynn', 'Cora', 'Delia', 'Elara', 'Faye', 'Gwen', 'Hilda', 'Iris', 'Jenna', 'Kira', 'Lena', 'Mira', 'Nyla', 'Oona', 'Petra', 'Quinn', 'Rhea', 'Syla', 'Thessa'];
  const RACES = ['Human', 'Human', 'Human', 'Human', 'Human', 'Human', 'Half-Elf', 'Dwarf', 'Halfling', 'Gnome', 'Half-Orc', 'Elf'];
  const APPEARANCES = [
    'scarred face', 'missing tooth', 'bushy eyebrows', 'weathered skin', 'ink-stained fingers',
    'calloused hands', 'nervous eyes', 'loud laugh', 'hunched posture', 'well-groomed beard',
    'braided hair', 'missing finger', 'fresh bruises', 'mud-caked boots', 'faded tattoo',
    'silver streak in hair', 'squinting eyes', 'broad shoulders', 'thin and wiry', 'ruddy cheeks'
  ];

  for (let i = 0; i < count; i++) {
    const typeKey = pool[Math.floor(rng() * pool.length)];
    const typeDef = patronTypes[typeKey] || patronTypes.commoner;
    const isFemale = rng() > 0.5;
    const namePool = isFemale ? NAMES_FEMALE : NAMES_MALE;
    const race = RACES[Math.floor(rng() * RACES.length)];
    const appearance = APPEARANCES[Math.floor(rng() * APPEARANCES.length)];
    const gold = typeDef.wealthRange
      ? +(typeDef.wealthRange[0] + rng() * (typeDef.wealthRange[1] - typeDef.wealthRange[0])).toFixed(1)
      : 1;

    patrons.push({
      id: `patron-${tavern.id}-${i}`,
      type: typeKey,
      typeDef,
      name: namePool[Math.floor(rng() * namePool.length)],
      race,
      gender: isFemale ? 'Female' : 'Male',
      appearance,
      gold,
      mood: ['friendly', 'neutral', 'suspicious', 'drunk', 'busy', 'talkative'][Math.floor(rng() * 6)],
      knowledgeTopic: typeDef.knowledgeTopics?.[Math.floor(rng() * typeDef.knowledgeTopics.length)] || 'nothing interesting',
    });
  }

  return patrons;
}

// ─── Staff Generation ──────────────────────────────────────────
export function generateStaff(tavern) {
  const quality = tavern.quality || 'average';
  const tier = settlementsData.tavernQualityTiers[quality] || settlementsData.tavernQualityTiers.average;
  const [minStaff, maxStaff] = tier.staffCount;
  const count = minStaff + Math.floor(Math.random() * (maxStaff - minStaff + 1));

  const staff = [
    { role: 'Barkeep', description: tavern.proprietor, isOwner: true }
  ];

  const STAFF_ROLES = [
    { role: 'Barmaid', description: 'Serves drinks and food. Grants +2 to next Gather Information check if tipped well.' },
    { role: 'Cook', description: 'Prepares meals in the kitchen.' },
    { role: 'Bouncer', description: 'Keeps the peace. Intimidate +6, unarmed strike +4.' },
    { role: 'Stablehand', description: 'Tends to the horses and mounts outside.' },
    { role: 'Serving Boy', description: 'Runs errands and clears tables.' },
    { role: 'Musician', description: 'Plays music for the evening crowd. Perform +5.' },
  ];

  for (let i = 1; i < count && i < STAFF_ROLES.length + 1; i++) {
    staff.push(STAFF_ROLES[i - 1]);
  }

  return staff;
}

// ─── Tavern Events ─────────────────────────────────────────────
/**
 * Check if an event fires when visiting a tavern.
 * @param {Object} tavern - Tavern data
 * @param {number} seed - Visit seed (date-based for daily consistency)
 * @returns {Object|null} Event object or null
 */
export function checkForEvent(tavern, seed) {
  const quality = tavern.quality || 'average';
  const tier = settlementsData.tavernQualityTiers[quality] || settlementsData.tavernQualityTiers.average;
  const events = settlementsData.tavernEvents || [];

  const rng = seededRandom(hashString(`event-${tavern.id}-${seed}`));

  // Check if an event fires based on tavern quality
  if (rng() > tier.eventChance) return null;

  // Filter events valid for this quality tier
  const qualityOrder = ['squalid', 'poor', 'average', 'good', 'extravagant'];
  const qIdx = qualityOrder.indexOf(quality);
  const validEvents = events.filter(e => {
    const minIdx = qualityOrder.indexOf(e.qualityMin || 'squalid');
    const maxIdx = qualityOrder.indexOf(e.qualityMax || 'extravagant');
    return qIdx >= minIdx && qIdx <= maxIdx;
  });

  if (validEvents.length === 0) return null;

  // Weighted selection
  const totalWeight = validEvents.reduce((s, e) => s + (e.weight || 1), 0);
  let roll = rng() * totalWeight;
  for (const event of validEvents) {
    roll -= (event.weight || 1);
    if (roll <= 0) return { ...event };
  }
  return validEvents[validEvents.length - 1];
}

/**
 * Resolve a tavern event with a character's skill check.
 * @param {Object} event - Event data
 * @param {Object} char - Character data
 * @returns {Object} Result with success, roll, details
 */
export function resolveEvent(event, char) {
  if (!event || event.mechanic === 'passive') {
    return { success: true, passive: true, message: event?.successResult || 'Nothing notable happens.' };
  }

  const roll = rollDie(20);
  let modifier = 0;
  let skillUsed = event.mechanic;

  // Map mechanic to character skill/ability
  switch (event.mechanic) {
    case 'intimidate':
      modifier = getCharacterSkillTotal(char, 'Intimidate');
      skillUsed = 'Intimidate';
      break;
    case 'fortitude':
      modifier = char?.saves?.fort || Math.floor(((char?.abilities?.CON || 10) - 10) / 2);
      skillUsed = 'Fortitude';
      break;
    case 'perception':
      modifier = getCharacterSkillTotal(char, 'Perception');
      skillUsed = 'Perception';
      break;
    case 'strength':
      modifier = Math.floor(((char?.abilities?.STR || 10) - 10) / 2);
      skillUsed = 'Strength';
      break;
    case 'reflex_or_craft': {
      const craftTotal = getCharacterSkillTotal(char, 'Craft');
      modifier = Math.max(
        char?.saves?.ref || Math.floor(((char?.abilities?.DEX || 10) - 10) / 2),
        craftTotal
      );
      skillUsed = 'Reflex/Craft';
      break;
    }
    case 'diplomacy_or_bluff': {
      const dipTotal = getCharacterSkillTotal(char, 'Diplomacy');
      const bluffTotal = getCharacterSkillTotal(char, 'Bluff');
      // Prefer the first-listed skill on a tie. The previous tie-break sent
      // ties to 'Bluff', which felt arbitrary — Diplomacy is the more
      // in-character default for the social events that use this mechanic.
      if (bluffTotal > dipTotal) {
        modifier = bluffTotal;
        skillUsed = 'Bluff';
      } else {
        modifier = dipTotal;
        skillUsed = 'Diplomacy';
      }
      break;
    }
    case 'profession_gambler_or_bluff': {
      const gambTotal = getCharacterSkillTotal(char, 'Profession (gambler)');
      const bluffTotal2 = getCharacterSkillTotal(char, 'Bluff');
      // Same tie-break rule: the named professional skill wins on a tie
      // since the mechanic is "profession_gambler_or_bluff" — Bluff is the
      // alternate, not the default.
      if (bluffTotal2 > gambTotal) {
        modifier = bluffTotal2;
        skillUsed = 'Bluff';
      } else {
        modifier = gambTotal;
        skillUsed = 'Profession (Gambler)';
      }
      break;
    }
    default:
      modifier = 0;
  }

  const total = roll + modifier;
  const dc = event.dc || 15;
  const success = total >= dc;

  return {
    success,
    roll,
    modifier,
    total,
    dc,
    skillUsed,
    message: success ? event.successResult : event.failureResult,
    eventName: event.name,
    eventId: event.id,
    canJoin: event.canJoin,
    entryFee: event.entryFee,
    prizeMultiplier: event.prizeMultiplier,
    lossRange: event.lossRange,
  };
}

// ─── Drinking Contest System ───────────────────────────────────
/**
 * Run a full drinking contest round.
 * @param {Object} char - Character data
 * @param {number} round - Current round (1-based)
 * @param {string} drinkType - Type of drink from drinkingRules
 * @returns {Object} Result of this round
 */
export function drinkingContestRound(char, round, drinkType = 'ale') {
  const rules = settlementsData.drinkingRules || {};
  const drink = rules.drinkTypes?.[drinkType] || rules.drinkTypes?.ale || { fortDC: 12, intoxicationPoints: 1 };

  const dc = drink.fortDC + (round - 1) * 2; // DC increases each round
  const roll = rollDie(20);

  // Fort save modifier
  let fortMod = char?.saves?.fort || Math.floor(((char?.abilities?.CON || 10) - 10) / 2);

  // Racial bonuses
  const race = (char?.race || '').toLowerCase();
  const racialBonus = rules.racialBonuses?.[race] || {};
  fortMod += racialBonus.fortBonus || 0;

  const total = roll + fortMod;
  const success = total >= dc;

  return {
    success,
    roll,
    fortMod,
    total,
    dc,
    round,
    drinkName: drink.name,
    intoxicationPoints: success ? 0 : drink.intoxicationPoints,
    message: success
      ? `Round ${round}: ${char?.name || 'You'} keeps it down! (d20: ${roll} + Fort: ${fortMod} = ${total} vs DC ${dc})`
      : `Round ${round}: ${char?.name || 'You'} falters! (d20: ${roll} + Fort: ${fortMod} = ${total} vs DC ${dc})`,
  };
}

/**
 * Get intoxication level from accumulated points.
 * @param {number} points - Total intoxication points
 * @returns {Object} Current intoxication level data
 */
export function getIntoxicationLevel(points) {
  const levels = settlementsData.drinkingRules?.intoxicationLevels || [];
  let current = levels[0] || { level: 'sober', threshold: 0, effects: 'No effects', color: '#7fff00' };
  for (const lvl of levels) {
    if (points >= lvl.threshold) current = lvl;
  }
  return current;
}

/**
 * Calculate how many drinks a character can safely consume.
 * @param {Object} char - Character data
 * @returns {number} Safe drink count
 */
export function getSafeDrinkCount(char) {
  const conMod = Math.floor(((char?.abilities?.CON || 10) - 10) / 2);
  let safe = Math.max(1, 1 + 2 * conMod);
  // Racial bonuses
  const race = (char?.race || '').toLowerCase();
  const racialBonus = settlementsData.drinkingRules?.racialBonuses?.[race] || {};
  safe += racialBonus.safeDrinksBonus || 0;
  return Math.max(1, safe);
}

// ─── Gather Information ────────────────────────────────────────
/**
 * Make a Gather Information check at a tavern.
 * @param {Object} char - Character data
 * @param {Object} tavern - Tavern data
 * @param {string} settlementId - Settlement ID
 * @param {number} chapter - Current campaign chapter
 * @param {Object} settlementMods - Settlement modifiers
 * @param {Object} options - { buyDrinks: boolean, barmaidTip: boolean }
 * @returns {Object} Result with rumors found
 */
export function gatherInformation(char, tavern, settlementId, chapter, settlementMods = {}, options = {}) {
  const roll = rollDie(20);
  let modifier = getCharacterSkillTotal(char, 'Diplomacy');

  // Settlement Lore modifier applies to gather info
  modifier += settlementMods.lore || 0;

  // Tavern quality affects gather info (squalid taverns = easier for street-level info)
  const tier = settlementsData.tavernQualityTiers[tavern.quality || 'average'] || {};
  modifier += tier.gatherInfoBonus || 0;

  // Buying drinks for the house gives +2
  if (options.buyDrinks) modifier += 2;

  // Tipping barmaid gives +2 per GameMastery Guide
  if (options.barmaidTip) modifier += 2;

  // Criminal contacts in shady taverns give +2 to underworld info
  if (tavern.criminalContacts) modifier += 2;

  const total = roll + modifier;
  const cost = options.buyDrinks ? 5 : (options.barmaidTip ? 0.5 : 0);

  // Get available rumors up to the DC rolled
  const allRumors = getCampaignRumors(settlementId, chapter);
  const discovered = allRumors.filter(r => total >= r.dc);

  // Pick up to 1d3 rumors from those available (seeded by roll for consistency)
  const rumorCount = Math.min(discovered.length, 1 + Math.floor(Math.random() * 3));
  const shuffled = [...discovered].sort(() => Math.random() - 0.5);
  const returnedRumors = shuffled.slice(0, rumorCount);

  return {
    roll,
    modifier,
    total,
    cost,
    rumorsFound: returnedRumors,
    allAvailable: discovered.length,
    message: discovered.length > 0
      ? `${char?.name || 'You'} spends time asking around (Diplomacy: d20 ${roll} + ${modifier} = ${total}) and learns ${rumorCount} rumor${rumorCount !== 1 ? 's' : ''}.`
      : `${char?.name || 'You'} asks around (Diplomacy: d20 ${roll} + ${modifier} = ${total}) but hears nothing useful.`,
  };
}

// ─── Rest & Recovery ───────────────────────────────────────────
/**
 * Calculate overnight rest effects for a character.
 * @param {Object} char - Character data
 * @param {string} roomQuality - 'wilderness' | 'poor' | 'common' | 'good' | 'suite'
 * @returns {Object} Healing and effects
 */
export function calculateRest(char, roomQuality = 'common') {
  const rules = settlementsData.restAndRecovery || {};
  const lodging = rules.lodgingEffects?.[roomQuality] || rules.lodgingEffects?.common || {};
  const level = char?.level || 1;
  const baseHealing = level; // 1 HP per level per night
  const multiplier = lodging.healingMultiplier || 1.0;
  const healing = Math.max(1, Math.floor(baseHealing * multiplier));

  let fatigued = false;
  if (lodging.fatigueCheck) {
    const fortMod = char?.saves?.fort || Math.floor(((char?.abilities?.CON || 10) - 10) / 2);
    const roll = rollDie(20);
    const total = roll + fortMod;
    fatigued = total < (lodging.fatigueDC || 15);
  }

  return {
    healing,
    multiplier,
    fatigued,
    moraleBonus: lodging.moraleBonus || 0,
    moraleDuration: lodging.moraleBonus ? '4 hours' : null,
    restBonus: lodging.restBonus || false,
    description: lodging.description || 'Normal rest',
    roomQuality,
  };
}

// ─── Gambling Mini-Game ────────────────────────────────────────
/**
 * Play a round of gambling (card game, dice, etc.)
 * @param {Object} char - Character data
 * @param {number} stake - Gold wagered
 * @param {string} method - 'bluff' | 'profession_gambler' | 'sense_motive'
 * @returns {Object} Result
 */
export function gambleRound(char, stake, method = 'bluff') {
  const roll = rollDie(20);
  let modifier = 0;

  switch (method) {
    case 'bluff':
      modifier = getCharacterSkillTotal(char, 'Bluff');
      break;
    case 'profession_gambler':
      modifier = getCharacterSkillTotal(char, 'Profession (gambler)');
      break;
    case 'sense_motive':
      modifier = getCharacterSkillTotal(char, 'Sense Motive');
      break;
    default:
      modifier = 0;
  }

  // Opponent roll
  const oppRoll = rollDie(20) + 5 + Math.floor(Math.random() * 6); // NPC skill 5-10
  const total = roll + modifier;
  const success = total > oppRoll;

  // Margin determines payout
  const margin = total - oppRoll;
  let payout = 0;
  let message = '';

  if (margin >= 10) {
    payout = stake * 3; // Big win
    message = 'Dominant victory! You clean out the table.';
  } else if (margin >= 5) {
    payout = stake * 2; // Good win
    message = 'A solid win. You rake in the pot.';
  } else if (margin > 0) {
    payout = Math.floor(stake * 1.5); // Narrow win
    message = 'A close hand, but you take the pot.';
  } else if (margin > -5) {
    payout = -Math.floor(stake * 0.5); // Small loss
    message = 'Not your round. You lose part of your stake.';
  } else {
    payout = -stake; // Total loss
    message = 'Cleaned out. The other players grin as they take your gold.';
  }

  return {
    success: margin > 0,
    roll,
    modifier,
    total,
    oppRoll,
    margin,
    stake,
    payout,
    netGold: payout,
    method: method.replace('_', ' '),
    message,
  };
}

// ─── Room Occupancy Calculator ─────────────────────────────────
/**
 * Calculate how many rooms are available (some occupied by NPCs).
 * @param {Object} tavern - Tavern data
 * @param {number} seed - Week seed
 * @returns {Object} Room availability by type
 */
export function calculateRoomAvailability(tavern, seed) {
  if (!tavern.rooms) return null;

  const rng = seededRandom(hashString(`rooms-${tavern.id}-${seed}`));
  const quality = tavern.quality || 'average';
  const result = {};

  for (const [type, info] of Object.entries(tavern.rooms)) {
    const total = info.available || 0;
    // Occupancy rate varies by tavern quality — good/extravagant taverns tend to be fuller
    const occupancyRate = quality === 'extravagant' ? 0.7 : quality === 'good' ? 0.5 : quality === 'average' ? 0.4 : 0.2;
    const occupied = Math.floor(total * occupancyRate * (0.5 + rng()));
    const available = Math.max(0, total - Math.min(occupied, total));

    result[type] = {
      total,
      occupied: Math.min(occupied, total),
      available,
      price: info.price,
    };
  }

  return result;
}

// ─── Tavern Visit Summary ──────────────────────────────────────
/**
 * Generate a complete tavern visit state — patrons, staff, events, room availability.
 * Call once when entering a tavern.
 * @param {Object} tavern - Tavern data
 * @param {string} settlementId - Settlement ID
 * @param {Object} settlement - Settlement data
 * @param {number} seed - Week seed
 * @returns {Object} Full tavern state
 */
export function generateTavernVisit(tavern, settlementId, settlement, seed) {
  const patrons = generatePatrons(tavern, settlementId, seed, settlement?.modifiers || {});
  const staff = generateStaff(tavern);
  const event = checkForEvent(tavern, seed);
  const rooms = calculateRoomAvailability(tavern, seed);
  const qualityTier = settlementsData.tavernQualityTiers[tavern.quality || 'average'] || {};

  return {
    tavern,
    patrons,
    staff,
    event,
    rooms,
    qualityTier,
    patronCount: patrons.length,
    hasRooms: !!tavern.rooms,
    hasEvent: !!event,
  };
}

export default {
  getTavernQualityTiers,
  getPatronTypes,
  getDrinkingRules,
  getRestRules,
  getCampaignRumors,
  generatePatrons,
  generateStaff,
  checkForEvent,
  resolveEvent,
  drinkingContestRound,
  getIntoxicationLevel,
  getSafeDrinkCount,
  gatherInformation,
  calculateRest,
  gambleRound,
  calculateRoomAvailability,
  generateTavernVisit,
};
