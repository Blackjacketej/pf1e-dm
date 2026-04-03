/**
 * downtimeService.js — PF1e Ultimate Campaign Downtime & Kingdom Building Engine
 * Handles capital earning, building construction, kingdom turns, organizations,
 * retraining, and story feat tracking.
 */
import ucData from '../data/ultimateCampaign.json';
import { rollDice } from '../utils/dice';

// ═══════════════════════════════════════════════════
// DOWNTIME CAPITAL SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Attempt to earn capital during downtime using a skill check.
 * UC p.77: Roll skill check, divide by 10 (round down), earn that many units.
 * You can spend GP instead at the listed gpValue per unit.
 */
export function earnCapital(character, capitalType, skillName) {
  const cap = ucData.downtime.capitalTypes[capitalType];
  if (!cap) return { success: false, error: 'Invalid capital type' };

  // Find skill bonus
  const skillBonus = getSkillBonus(character, skillName);
  const roll = rollDice(1, 20);
  const total = roll + skillBonus;
  const earned = Math.max(0, Math.floor(total / 10));

  return {
    success: true,
    capitalType,
    skill: skillName,
    roll,
    skillBonus,
    total,
    earned,
    gpEquivalent: earned * cap.gpValue,
    description: `${character.name} rolls ${skillName}: ${roll} + ${skillBonus} = ${total} → earns ${earned} ${cap.name} (worth ${earned * cap.gpValue} gp)`
  };
}

/**
 * Purchase capital with GP directly.
 * Each unit costs gpValue in gold.
 */
export function purchaseCapital(capitalType, units, availableGold) {
  const cap = ucData.downtime.capitalTypes[capitalType];
  if (!cap) return { success: false, error: 'Invalid capital type' };

  const cost = units * cap.gpValue;
  if (cost > availableGold) {
    return { success: false, error: `Not enough gold. Need ${cost} gp, have ${availableGold} gp` };
  }

  return {
    success: true,
    capitalType,
    units,
    cost,
    remaining: availableGold - cost,
    description: `Purchased ${units} ${cap.name} for ${cost} gp`
  };
}

/**
 * Get the list of valid skills for earning a capital type.
 */
export function getEarnSkills(capitalType) {
  return ucData.downtime.earnCapitalSkills[capitalType] || [];
}

// ═══════════════════════════════════════════════════
// BUILDING SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Get all available rooms with their costs and bonuses.
 */
export function getRooms() {
  return ucData.downtime.rooms;
}

/**
 * Get all available teams with their costs and bonuses.
 */
export function getTeams() {
  return ucData.downtime.teams;
}

/**
 * Get predefined building templates.
 */
export function getBuildings() {
  return ucData.downtime.buildings;
}

/**
 * Calculate total cost of a building from its room components.
 */
export function calculateBuildingCost(roomIds) {
  const rooms = ucData.downtime.rooms;
  const cost = { goods: 0, influence: 0, labor: 0, magic: 0, gp: 0, time: 0 };

  for (const roomId of roomIds) {
    const room = rooms.find(r => r.id === roomId);
    if (room) {
      cost.goods += room.cost.goods;
      cost.influence += room.cost.influence;
      cost.labor += room.cost.labor;
      cost.magic += room.cost.magic;
      cost.gp += room.cost.gp;
      cost.time += room.time;
    }
  }

  return cost;
}

/**
 * Calculate daily income from all owned buildings.
 * Each building's rooms generate capital based on their bonus type/amount.
 */
export function calculateDailyIncome(ownedBuildings) {
  const income = { goods: 0, influence: 0, labor: 0, magic: 0 };

  for (const building of ownedBuildings) {
    // Use predefined building earn rates if available
    const template = ucData.downtime.buildings.find(b => b.id === building.templateId);
    if (template && template.earn) {
      income[template.earn.type] += template.earn.amount;
    } else {
      // Otherwise sum room bonuses
      const rooms = ucData.downtime.rooms;
      for (const roomId of (building.rooms || [])) {
        const room = rooms.find(r => r.id === roomId);
        if (room && room.bonus) {
          income[room.bonus.type] += room.bonus.amount;
        }
      }
    }
  }

  return income;
}

/**
 * Roll a downtime event (d100).
 */
export function rollDowntimeEvent() {
  const roll = rollDice(1, 100);
  const event = ucData.downtime.events.find(e => roll >= e.range[0] && roll <= e.range[1]);
  return { roll, event };
}

/**
 * Start building construction. Returns construction state.
 */
export function startConstruction(buildingTemplateId) {
  const template = ucData.downtime.buildings.find(b => b.id === buildingTemplateId);
  if (!template) return { success: false, error: 'Unknown building template' };

  const cost = calculateBuildingCost(template.rooms);

  return {
    success: true,
    building: template,
    cost,
    daysRemaining: cost.time,
    description: `Started constructing ${template.name}. Requires ${cost.time} days, ${cost.goods} Goods, ${cost.influence} Influence, ${cost.labor} Labor, ${cost.magic} Magic, and ${cost.gp} gp.`
  };
}

// ═══════════════════════════════════════════════════
// KINGDOM BUILDING SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Initialize a new kingdom with default values.
 */
export function createKingdom(name) {
  return {
    name,
    alignment: 'Neutral',
    size: 1,
    population: 250,
    economy: 0,
    loyalty: 0,
    stability: 0,
    unrest: 0,
    bp: 0,
    consumption: 0,
    treasury: 0,
    turn: 0,
    leaders: {},
    hexes: [],
    cities: [],
    edicts: {
      holiday: 'None',
      promotion: 'None',
      taxation: 'Normal'
    },
    improvements: [],
    armies: [],
    diplomaticRelations: []
  };
}

/**
 * Calculate kingdom modifiers from edicts.
 */
export function getEdictModifiers(edicts) {
  const mods = { economy: 0, loyalty: 0, stability: 0, consumption: 0 };

  const holiday = ucData.kingdom.edicts.holiday.find(h => h.level === edicts.holiday);
  if (holiday) {
    mods.loyalty += holiday.loyalty;
    mods.consumption += holiday.consumption;
  }

  const promo = ucData.kingdom.edicts.promotion.find(p => p.level === edicts.promotion);
  if (promo) {
    mods.stability += promo.stability;
    mods.consumption += promo.consumption;
  }

  const tax = ucData.kingdom.edicts.taxation.find(t => t.level === edicts.taxation);
  if (tax) {
    mods.economy += tax.economy;
    mods.loyalty += tax.loyalty;
  }

  return mods;
}

/**
 * Calculate total kingdom stats from all sources.
 */
export function calculateKingdomStats(kingdom) {
  let eco = kingdom.economy;
  let loy = kingdom.loyalty;
  let stab = kingdom.stability;
  let consumption = kingdom.consumption;

  // Add edict modifiers
  const edictMods = getEdictModifiers(kingdom.edicts);
  eco += edictMods.economy;
  loy += edictMods.loyalty;
  stab += edictMods.stability;
  consumption += edictMods.consumption;

  // Add building bonuses from cities
  for (const city of (kingdom.cities || [])) {
    for (const bldg of (city.buildings || [])) {
      const template = ucData.kingdom.cityDistricts.buildings.find(b => b.id === bldg.id);
      if (template) {
        eco += template.economy;
        loy += template.loyalty;
        stab += template.stability;
      }
    }
  }

  // Size-based control DC
  const sizeEntry = ucData.kingdom.kingdomSizeTable.find(s => {
    const parts = s.hexes.split('-');
    if (s.hexes.endsWith('+')) {
      return kingdom.size >= parseInt(s.hexes);
    }
    return kingdom.size >= parseInt(parts[0]) && kingdom.size <= parseInt(parts[1]);
  });
  const controlDC = sizeEntry ? sizeEntry.controlDC : 20;

  // Vacancy penalties
  const vacancyPenalties = calculateVacancyPenalties(kingdom.leaders);

  eco += vacancyPenalties.economy;
  loy += vacancyPenalties.loyalty;
  stab += vacancyPenalties.stability;

  return {
    economy: eco,
    loyalty: loy,
    stability: stab,
    consumption,
    controlDC,
    unrest: kingdom.unrest,
    size: kingdom.size,
    bp: kingdom.bp
  };
}

/**
 * Calculate penalties from vacant leadership roles.
 */
function calculateVacancyPenalties(leaders) {
  const penalties = { economy: 0, loyalty: 0, stability: 0 };
  const roles = ucData.kingdom.leadershipRoles;

  for (const role of roles) {
    if (role.vacancy === 'None (optional)') continue;
    if (!leaders[role.id]) {
      // Parse vacancy penalty
      const vac = role.vacancy;
      const econMatch = vac.match(/Economy (-?\d+)/);
      const loyMatch = vac.match(/Loyalty (-?\d+)/);
      const stabMatch = vac.match(/Stability (-?\d+)/);
      if (econMatch) penalties.economy += parseInt(econMatch[1]);
      if (loyMatch) penalties.loyalty += parseInt(loyMatch[1]);
      if (stabMatch) penalties.stability += parseInt(stabMatch[1]);
      // Special: Ruler vacancy
      if (role.id === 'ruler') {
        penalties.economy -= 4;
        penalties.loyalty -= 4;
        penalties.stability -= 4;
      }
    }
  }

  return penalties;
}

/**
 * Process a kingdom turn (monthly). Returns results of each phase.
 * UC Kingdom Turn Sequence:
 * 1. Upkeep Phase
 * 2. Edict Phase
 * 3. Income Phase
 * 4. Event Phase
 */
export function processKingdomTurn(kingdom) {
  const results = [];
  const stats = calculateKingdomStats(kingdom);

  // Phase 1: Upkeep
  const upkeep = processUpkeep(kingdom, stats);
  results.push({ phase: 'Upkeep', ...upkeep });

  // Phase 2: Edict (handled by player choices — we just note current edicts)
  results.push({
    phase: 'Edicts',
    description: `Holiday: ${kingdom.edicts.holiday}, Promotion: ${kingdom.edicts.promotion}, Taxation: ${kingdom.edicts.taxation}`
  });

  // Phase 3: Income
  const income = processIncome(kingdom, stats);
  results.push({ phase: 'Income', ...income });

  // Phase 4: Event
  const event = rollKingdomEvent();
  results.push({ phase: 'Event', ...event });

  kingdom.turn += 1;

  return { turn: kingdom.turn, phases: results, updatedStats: calculateKingdomStats(kingdom) };
}

function processUpkeep(kingdom, stats) {
  const results = [];

  // Stability check to reduce Unrest
  if (kingdom.unrest > 0) {
    const stabRoll = rollDice(1, 20) + stats.stability;
    if (stabRoll >= stats.controlDC) {
      kingdom.unrest = Math.max(0, kingdom.unrest - 1);
      results.push(`Stability check ${stabRoll} vs DC ${stats.controlDC}: Success! Unrest reduced to ${kingdom.unrest}`);
    } else {
      kingdom.unrest += 1;
      results.push(`Stability check ${stabRoll} vs DC ${stats.controlDC}: Failed. Unrest increases to ${kingdom.unrest}`);
    }
  }

  // Pay consumption
  const consumed = stats.consumption;
  if (kingdom.bp >= consumed) {
    kingdom.bp -= consumed;
    results.push(`Paid ${consumed} BP in consumption. Treasury: ${kingdom.bp} BP`);
  } else {
    kingdom.unrest += 2;
    results.push(`Cannot pay ${consumed} BP consumption! Unrest +2 (now ${kingdom.unrest})`);
  }

  // Unrest threshold
  if (kingdom.unrest >= 20) {
    results.push('CRISIS: Unrest has reached 20! The kingdom is in danger of collapse!');
  }

  return { results, description: results.join('; ') };
}

function processIncome(kingdom, stats) {
  const roll = rollDice(1, 20);
  const ecoCheck = roll + stats.economy;
  let earned = 0;

  if (ecoCheck >= stats.controlDC) {
    earned = Math.max(0, ecoCheck - stats.controlDC);
    kingdom.bp += earned;
  }

  const description = `Economy check: ${roll} + ${stats.economy} = ${ecoCheck} vs DC ${stats.controlDC}. ` +
    (earned > 0 ? `Earned ${earned} BP. Treasury: ${kingdom.bp} BP` : 'No income earned this turn.');

  return { roll, total: ecoCheck, earned, description };
}

/**
 * Roll a kingdom event (d100).
 */
export function rollKingdomEvent() {
  const roll = rollDice(1, 100);
  const event = ucData.kingdom.kingdomEvents.find(e => roll >= e.range[0] && roll <= e.range[1]);
  return { roll, event, description: event ? `${event.name}: ${event.effect}` : 'No event' };
}

/**
 * Claim a new hex for the kingdom.
 */
export function claimHex(kingdom, terrainType) {
  const terrain = ucData.kingdom.terrainTypes[terrainType];
  if (!terrain) return { success: false, error: 'Invalid terrain type' };

  const prepCost = terrain.preparationCost;
  if (kingdom.bp < prepCost) {
    return { success: false, error: `Need ${prepCost} BP to prepare ${terrain.name} hex. Have ${kingdom.bp} BP` };
  }

  kingdom.bp -= prepCost;
  kingdom.size += 1;
  kingdom.hexes.push({
    terrain: terrainType,
    improvements: [],
    explored: true,
    claimed: true
  });

  return {
    success: true,
    terrain: terrain.name,
    cost: prepCost,
    newSize: kingdom.size,
    description: `Claimed a ${terrain.name} hex for ${prepCost} BP. Kingdom size: ${kingdom.size}`
  };
}

/**
 * Build an improvement on a hex.
 */
export function buildHexImprovement(kingdom, hexIndex, improvementId) {
  const improvement = ucData.kingdom.terrainImprovements.find(i => i.id === improvementId);
  if (!improvement) return { success: false, error: 'Invalid improvement' };

  const hex = kingdom.hexes[hexIndex];
  if (!hex) return { success: false, error: 'Invalid hex' };

  // Check terrain compatibility
  if (!improvement.terrain.includes('any') && !improvement.terrain.includes(hex.terrain) && !improvement.terrain.includes('any with river')) {
    return { success: false, error: `Cannot build ${improvement.name} on ${hex.terrain} terrain` };
  }

  if (kingdom.bp < improvement.cost) {
    return { success: false, error: `Need ${improvement.cost} BP. Have ${kingdom.bp} BP` };
  }

  kingdom.bp -= improvement.cost;
  hex.improvements.push(improvementId);

  return {
    success: true,
    improvement: improvement.name,
    cost: improvement.cost,
    bonus: improvement.bonus,
    description: `Built ${improvement.name} for ${improvement.cost} BP. ${improvement.bonus}`
  };
}

/**
 * Found a new city in a hex.
 */
export function foundCity(kingdom, hexIndex, cityName) {
  const hex = kingdom.hexes[hexIndex];
  if (!hex) return { success: false, error: 'Invalid hex' };

  if (kingdom.bp < 1) {
    return { success: false, error: 'Need at least 1 BP to found a city' };
  }

  kingdom.bp -= 1;
  const city = {
    name: cityName,
    hexIndex,
    districts: [{ buildings: [], lotsUsed: 0 }],
    baseValue: 200,
    defense: 0,
    population: 0
  };

  kingdom.cities.push(city);
  return {
    success: true,
    city: cityName,
    description: `Founded the city of ${cityName} in a ${hex.terrain} hex.`
  };
}

/**
 * Build a city building.
 */
export function buildCityBuilding(kingdom, cityIndex, districtIndex, buildingId) {
  const bldgTemplate = ucData.kingdom.cityDistricts.buildings.find(b => b.id === buildingId);
  if (!bldgTemplate) return { success: false, error: 'Invalid building' };

  const city = kingdom.cities[cityIndex];
  if (!city) return { success: false, error: 'Invalid city' };

  const district = city.districts[districtIndex];
  if (!district) return { success: false, error: 'Invalid district' };

  if (district.lotsUsed + bldgTemplate.lots > ucData.kingdom.cityDistricts.maxLots) {
    return { success: false, error: `District full (${district.lotsUsed}/${ucData.kingdom.cityDistricts.maxLots} lots). Start a new district.` };
  }

  if (kingdom.bp < bldgTemplate.cost) {
    return { success: false, error: `Need ${bldgTemplate.cost} BP. Have ${kingdom.bp} BP` };
  }

  kingdom.bp -= bldgTemplate.cost;
  district.buildings.push({ id: bldgTemplate.id, name: bldgTemplate.name });
  district.lotsUsed += bldgTemplate.lots;

  // Apply unrest reduction
  if (bldgTemplate.unrest < 0) {
    kingdom.unrest = Math.max(0, kingdom.unrest + bldgTemplate.unrest);
  }

  return {
    success: true,
    building: bldgTemplate.name,
    cost: bldgTemplate.cost,
    lots: bldgTemplate.lots,
    bonuses: { economy: bldgTemplate.economy, loyalty: bldgTemplate.loyalty, stability: bldgTemplate.stability },
    special: bldgTemplate.special,
    description: `Built ${bldgTemplate.name} for ${bldgTemplate.cost} BP (${bldgTemplate.lots} lots). Eco ${bldgTemplate.economy >= 0 ? '+' : ''}${bldgTemplate.economy}, Loy ${bldgTemplate.loyalty >= 0 ? '+' : ''}${bldgTemplate.loyalty}, Stab ${bldgTemplate.stability >= 0 ? '+' : ''}${bldgTemplate.stability}${bldgTemplate.special ? '. ' + bldgTemplate.special : ''}`
  };
}

/**
 * Get all city building templates.
 */
export function getCityBuildings() {
  return ucData.kingdom.cityDistricts.buildings;
}

/**
 * Get leadership roles.
 */
export function getLeadershipRoles() {
  return ucData.kingdom.leadershipRoles;
}

/**
 * Get terrain types.
 */
export function getTerrainTypes() {
  return ucData.kingdom.terrainTypes;
}

/**
 * Get hex improvements.
 */
export function getHexImprovements() {
  return ucData.kingdom.terrainImprovements;
}

/**
 * Get edict options.
 */
export function getEdicts() {
  return ucData.kingdom.edicts;
}

// ═══════════════════════════════════════════════════
// ORGANIZATION SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Create a new organization.
 */
export function createOrganization(name, typeId, founderLevel) {
  const orgType = ucData.organizations.types.find(t => t.id === typeId);
  if (!orgType) return { success: false, error: 'Invalid organization type' };

  // Determine member limit by founder level
  const limitEntry = Object.entries(ucData.organizations.memberLimits).find(([range]) => {
    const [lo, hi] = range.split('-').map(Number);
    return founderLevel >= lo && founderLevel <= hi;
  });
  const maxMembers = limitEntry ? limitEntry[1] : 5;

  return {
    success: true,
    organization: {
      name,
      type: orgType,
      loyalty: orgType.loyalty,
      members: 1,
      maxMembers,
      earnings: orgType.earnings,
      reputation: 0,
      founded: true
    },
    description: `Founded "${name}" (${orgType.name}). Base loyalty: ${orgType.loyalty}, Max members: ${maxMembers}, Earnings: ${orgType.earnings}`
  };
}

/**
 * Roll weekly organization earnings.
 */
export function rollOrganizationEarnings(org) {
  const earningsStr = org.type.earnings || org.earnings;
  // Parse "2d6 gp/week" format
  const match = earningsStr.match(/(\d+)d(\d+)/);
  if (!match) return { earned: 0, description: 'Unable to calculate earnings' };

  const earned = rollDice(parseInt(match[1]), parseInt(match[2]));
  return {
    earned,
    description: `${org.name} earns ${earned} gp this week (${earningsStr})`
  };
}

/**
 * Roll an organization loyalty event.
 */
export function rollOrganizationEvent() {
  const roll = rollDice(1, 100);
  const event = ucData.organizations.loyaltyEvents.find(e => roll >= e.range[0] && roll <= e.range[1]);
  return { roll, event, description: event ? `${event.name}: ${event.effect}` : 'No event' };
}

// ═══════════════════════════════════════════════════
// RETRAINING SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Get all retraining options.
 */
export function getRetrainingOptions() {
  return ucData.retraining.types;
}

/**
 * Calculate retraining cost for a character.
 */
export function calculateRetrainingCost(retrainingTypeId, characterLevel) {
  const type = ucData.retraining.types.find(t => t.id === retrainingTypeId);
  if (!type) return { success: false, error: 'Invalid retraining type' };

  let days = 5;
  let costPerDay = 10 * characterLevel;

  // Parse specific times
  if (type.id === 'class_level') {
    days = 7;
    costPerDay = 50;
    return {
      success: true,
      type: type.name,
      days,
      totalCost: 50 * characterLevel,
      description: `${type.name}: ${days} days, ${50 * characterLevel} gp total. ${type.description}`
    };
  }

  if (type.id === 'new_language') {
    days = 20;
  }

  if (type.id === 'hit_points') {
    days = 3;
  }

  if (type.id === 'spell_known') {
    days = 2; // per spell level, minimum 2
  }

  const totalCost = costPerDay * days;

  return {
    success: true,
    type: type.name,
    days,
    costPerDay,
    totalCost,
    description: `${type.name}: ${days} days at ${costPerDay} gp/day = ${totalCost} gp total. ${type.description}`
  };
}

// ═══════════════════════════════════════════════════
// STORY FEATS
// ═══════════════════════════════════════════════════

/**
 * Get all story feats.
 */
export function getStoryFeats() {
  return ucData.storyFeats;
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function getSkillBonus(character, skillName) {
  if (!character || !character.skills) return 0;
  const skill = character.skills.find(s =>
    s.name === skillName || s.name?.toLowerCase() === skillName?.toLowerCase()
  );
  return skill ? (skill.total || skill.bonus || skill.ranks || 0) : 0;
}

// Default export with all functions
export default {
  // Downtime
  earnCapital,
  purchaseCapital,
  getEarnSkills,
  getRooms,
  getTeams,
  getBuildings,
  calculateBuildingCost,
  calculateDailyIncome,
  rollDowntimeEvent,
  startConstruction,
  // Kingdom
  createKingdom,
  calculateKingdomStats,
  getEdictModifiers,
  processKingdomTurn,
  rollKingdomEvent,
  claimHex,
  buildHexImprovement,
  foundCity,
  buildCityBuilding,
  getCityBuildings,
  getLeadershipRoles,
  getTerrainTypes,
  getHexImprovements,
  getEdicts,
  // Organizations
  createOrganization,
  rollOrganizationEarnings,
  rollOrganizationEvent,
  // Retraining
  getRetrainingOptions,
  calculateRetrainingCost,
  // Story Feats
  getStoryFeats
};
