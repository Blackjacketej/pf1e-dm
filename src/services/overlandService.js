/**
 * overlandService.js — PF1e Overland Travel Engine
 * Handles party movement, terrain effects, forced march, getting lost,
 * random encounters, day/night cycle, weather integration, starvation/thirst,
 * cold/heat exposure, altitude sickness, and visibility.
 */
import mapData from '../data/sandpointMap.json';
import { rollDice } from '../utils/dice';

// ═══════════════════════════════════════════════════
// MOVEMENT & TRAVEL
// ═══════════════════════════════════════════════════

/**
 * Calculate daily travel distance for a party.
 * Uses slowest member's speed. Applies terrain & road multipliers.
 * PF1e CRB Table 7-6/7-7.
 */
export function calculateTravelDistance(partySpeed, terrainType, roadType, weatherPenalty = 0) {
  const rates = mapData.overland.movementRates;
  const speedKey = String(partySpeed);
  const baseDaily = rates[speedKey]?.daily || 24; // default 30ft speed

  // Get terrain multiplier
  const mult = mapData.overland.terrainMultipliers[roadType]?.[terrainType] || 0.75;

  // Weather can reduce speed (snow = -50%, storm = -25%)
  const weatherMult = Math.max(0.25, 1.0 - weatherPenalty);

  const distance = Math.max(1, Math.round(baseDaily * mult * weatherMult));

  return {
    baseMiles: baseDaily,
    terrainMultiplier: mult,
    weatherMultiplier: weatherMult,
    finalMiles: distance,
    speed: partySpeed,
    terrain: terrainType,
    road: roadType
  };
}

/**
 * Get the slowest party speed.
 */
export function getPartySpeed(party) {
  if (!party || party.length === 0) return 30;
  const speeds = party.map(c => {
    // Check for speed in various locations
    if (c.speed) return c.speed;
    if (c.race) {
      const raceSpeed = { 'Dwarf': 20, 'Halfling': 20, 'Gnome': 20, 'Human': 30, 'Elf': 30, 'Half-Elf': 30, 'Half-Orc': 30 };
      return raceSpeed[c.race] || 30;
    }
    return 30;
  });
  return Math.min(...speeds);
}

/**
 * Calculate travel for a single hour of movement.
 */
export function calculateHourlyTravel(partySpeed, terrainType, roadType) {
  const rates = mapData.overland.movementRates;
  const speedKey = String(partySpeed);
  const baseHourly = rates[speedKey]?.hourly || 3;
  const mult = mapData.overland.terrainMultipliers[roadType]?.[terrainType] || 0.75;
  return Math.max(0.25, Math.round(baseHourly * mult * 100) / 100);
}

// ═══════════════════════════════════════════════════
// FORCED MARCH
// ═══════════════════════════════════════════════════

/**
 * Check forced march effects for extra hours beyond 8.
 * PF1e CRB: Fort DC 10 + 2 per extra hour. Fail = 1d6 nonlethal + fatigued.
 */
export function checkForcedMarch(character, extraHours) {
  const results = [];
  let totalNonlethal = 0;
  let fatigued = false;
  let exhausted = false;

  for (let h = 1; h <= extraHours; h++) {
    const dc = 10 + (h * 2);
    const fortBonus = getAbilityMod(character, 'CON');
    const roll = rollDice(1, 20);
    const total = roll + fortBonus;
    const passed = total >= dc;

    if (!passed) {
      const damage = rollDice(1, 6);
      totalNonlethal += damage;
      if (fatigued) {
        exhausted = true;
      }
      fatigued = true;
      results.push({
        hour: 8 + h,
        dc,
        roll,
        fortBonus,
        total,
        passed: false,
        damage,
        condition: exhausted ? 'exhausted' : 'fatigued'
      });
    } else {
      results.push({ hour: 8 + h, dc, roll, fortBonus, total, passed: true, damage: 0 });
    }
  }

  return {
    character: character.name,
    results,
    totalNonlethal,
    fatigued,
    exhausted,
    description: results.map(r =>
      r.passed
        ? `Hour ${r.hour}: Fort ${r.total} vs DC ${r.dc} — passed`
        : `Hour ${r.hour}: Fort ${r.total} vs DC ${r.dc} — FAILED! ${r.damage} nonlethal, ${r.condition}`
    ).join('; ')
  };
}

// ═══════════════════════════════════════════════════
// GETTING LOST
// ═══════════════════════════════════════════════════

/**
 * Check if the party gets lost in the current terrain.
 * PF1e CRB: Survival check vs terrain DC. Modifiers for conditions.
 * Navigator makes the check. Failure = random direction deviation.
 */
export function checkGettingLost(navigator, terrainType, conditions = []) {
  const baseDC = mapData.overland.gettingLostDC[terrainType] || 14;

  // Apply condition modifiers
  let dcMod = 0;
  const mods = mapData.overland.gettingLostModifiers;
  for (const cond of conditions) {
    dcMod += mods[cond] || 0;
  }
  const finalDC = baseDC + dcMod;

  // On road = can't get lost
  if (terrainType === 'road' || terrainType === 'urban') {
    return { lost: false, dc: 0, description: 'Cannot get lost on a road or in a settlement.' };
  }

  const survivalBonus = getSkillBonus(navigator, 'Survival');
  const roll = rollDice(1, 20);
  const total = roll + survivalBonus;
  const lost = total < finalDC;

  // If lost, determine deviation
  let deviation = null;
  if (lost) {
    const deviationRoll = rollDice(1, 8);
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    deviation = directions[deviationRoll - 1];
  }

  return {
    lost,
    dc: finalDC,
    baseDC,
    conditionMod: dcMod,
    roll,
    survivalBonus,
    total,
    deviation,
    description: lost
      ? `${navigator.name} rolls Survival ${roll} + ${survivalBonus} = ${total} vs DC ${finalDC}: LOST! Party drifts ${deviation}.`
      : `${navigator.name} rolls Survival ${roll} + ${survivalBonus} = ${total} vs DC ${finalDC}: On course.`
  };
}

// ═══════════════════════════════════════════════════
// RANDOM ENCOUNTERS
// ═══════════════════════════════════════════════════

/**
 * Check for a random encounter based on terrain.
 * PF1e: Typically d100 check, terrain-specific % chance.
 * We check 4 times per day (dawn, noon, dusk, midnight).
 */
export function checkEncounter(terrainType, timeOfDay) {
  const baseChance = mapData.overland.encounterFrequency[terrainType] || 15;
  const timeData = mapData.overland.timeOfDay.find(t => t.id === timeOfDay);
  const mod = timeData?.encounterMod || 1.0;
  const chance = Math.round(baseChance * mod);

  const roll = rollDice(1, 100);
  const encountered = roll <= chance;

  let encounter = null;
  if (encountered) {
    encounter = rollEncounterTable(terrainType);
  }

  return {
    encountered,
    roll,
    chance,
    terrain: terrainType,
    timeOfDay: timeData?.name || timeOfDay,
    encounter,
    description: encountered
      ? `[${timeData?.name}] Encounter! (d100: ${roll} vs ${chance}%): ${encounter?.encounter || 'Unknown'} (CR ${encounter?.cr || '?'})`
      : `[${timeData?.name}] No encounter (d100: ${roll} vs ${chance}%)`
  };
}

/**
 * Roll on a terrain-specific encounter table.
 */
function rollEncounterTable(terrainType) {
  const table = mapData.encounterTables[terrainType] || mapData.encounterTables['road'];
  const roll = rollDice(1, 100);
  const entry = table.find(e => roll >= e.range[0] && roll <= e.range[1]);
  return entry ? { ...entry, tableRoll: roll } : { encounter: 'Nothing unusual', cr: 0, tableRoll: roll };
}

/**
 * Run all 4 daily encounter checks.
 */
export function dailyEncounterChecks(terrainType) {
  const times = ['dawn', 'morning', 'dusk', 'midnight'];
  return times.map(t => checkEncounter(terrainType, t));
}

// ═══════════════════════════════════════════════════
// DAY / NIGHT CYCLE
// ═══════════════════════════════════════════════════

/**
 * Get current time-of-day info and visibility conditions.
 */
export function getTimeOfDay(hour) {
  const tod = mapData.overland.timeOfDay.find(t => {
    const [start, end] = t.hours;
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end; // wraps midnight
  });
  return tod || mapData.overland.timeOfDay[0];
}

/**
 * Get visibility conditions for current time/weather.
 */
export function getVisibility(hour, weatherCondition = 'clear_day') {
  const tod = getTimeOfDay(hour);
  const isDark = tod.lightLevel === 'dark';
  const isDim = tod.lightLevel === 'dim' || tod.lightLevel === 'dim/bright';

  // Use weather if worse than time-of-day
  if (isDark && weatherCondition === 'clear_day') {
    return mapData.overland.visibility['night_dark'];
  }
  if (isDim && weatherCondition === 'clear_day') {
    return mapData.overland.visibility['night_moonlit'];
  }

  return mapData.overland.visibility[weatherCondition] || mapData.overland.visibility['clear_day'];
}

// ═══════════════════════════════════════════════════
// ENVIRONMENTAL HAZARDS
// ═══════════════════════════════════════════════════

/**
 * Check starvation effects.
 * PF1e: After 3 days without food, DC 10 + 1/day Con check. Fail = 1d6 nonlethal.
 */
export function checkStarvation(character, daysWithoutFood) {
  if (daysWithoutFood <= 3) {
    return { damage: 0, description: `Day ${daysWithoutFood} without food. Uncomfortable but no damage yet.` };
  }

  const dc = 10 + (daysWithoutFood - 3);
  const roll = rollDice(1, 20);
  const conMod = getAbilityMod(character, 'CON');
  const total = roll + conMod;
  const passed = total >= dc;

  if (passed) {
    return { damage: 0, dc, roll, total, description: `${character.name} resists starvation (Fort ${total} vs DC ${dc})` };
  }

  const damage = rollDice(1, 6);
  return {
    damage,
    dc,
    roll,
    total,
    type: 'nonlethal',
    description: `${character.name} suffers ${damage} nonlethal from starvation (Fort ${total} vs DC ${dc})`
  };
}

/**
 * Check thirst effects.
 * PF1e: After 1 day + CON hours, DC 10 + 1/hour Con check. Fail = 1d6 nonlethal.
 */
export function checkThirst(character, hoursWithoutWater) {
  const conScore = character.abilities?.CON || character.con || 10;
  const threshold = 24 + conScore;

  if (hoursWithoutWater <= threshold) {
    return { damage: 0, description: `Hour ${hoursWithoutWater} without water. ${threshold - hoursWithoutWater} hours until danger.` };
  }

  const hoursOver = hoursWithoutWater - threshold;
  const dc = 10 + hoursOver;
  const roll = rollDice(1, 20);
  const conMod = getAbilityMod(character, 'CON');
  const total = roll + conMod;
  const passed = total >= dc;

  if (passed) {
    return { damage: 0, dc, roll, total, description: `${character.name} resists thirst (Fort ${total} vs DC ${dc})` };
  }

  const damage = rollDice(1, 6);
  return {
    damage, dc, roll, total, type: 'nonlethal',
    description: `${character.name} suffers ${damage} nonlethal from dehydration (Fort ${total} vs DC ${dc})`
  };
}

/**
 * Check cold/heat exposure.
 * PF1e: Based on temperature thresholds, periodic Fort saves.
 */
export function checkTemperatureExposure(character, temperatureF) {
  // Cold checks
  for (const [, tier] of Object.entries(mapData.overland.coldExposure)) {
    if (temperatureF <= tier.threshold) {
      if (tier.fortDC === 0) {
        // Extreme cold — automatic damage
        const dmg = rollDice(1, 6);
        return { damage: dmg, type: 'lethal', description: `Extreme cold (${temperatureF}°F): ${dmg} cold damage (no save)` };
      }
      const roll = rollDice(1, 20);
      const conMod = getAbilityMod(character, 'CON');
      const total = roll + conMod;
      if (total < tier.fortDC) {
        const dmg = rollDice(1, 6);
        return { damage: dmg, type: 'nonlethal', dc: tier.fortDC, roll, total, description: `Cold exposure (${temperatureF}°F): ${character.name} takes ${dmg} nonlethal (Fort ${total} vs DC ${tier.fortDC})` };
      }
      return { damage: 0, dc: tier.fortDC, roll, total, description: `Cold exposure (${temperatureF}°F): ${character.name} resists (Fort ${total} vs DC ${tier.fortDC})` };
    }
  }

  // Heat checks
  for (const [, tier] of Object.entries(mapData.overland.heatExposure)) {
    if (temperatureF >= tier.threshold) {
      if (tier.fortDC === 0) {
        const dmg = rollDice(1, 6);
        return { damage: dmg, type: 'lethal', description: `Extreme heat (${temperatureF}°F): ${dmg} fire damage (no save)` };
      }
      const roll = rollDice(1, 20);
      const conMod = getAbilityMod(character, 'CON');
      const total = roll + conMod;
      if (total < tier.fortDC) {
        const dmg = rollDice(1, 4);
        return { damage: dmg, type: 'nonlethal', dc: tier.fortDC, roll, total, description: `Heat exposure (${temperatureF}°F): ${character.name} takes ${dmg} nonlethal (Fort ${total} vs DC ${tier.fortDC})` };
      }
      return { damage: 0, dc: tier.fortDC, roll, total, description: `Heat exposure (${temperatureF}°F): ${character.name} resists (Fort ${total} vs DC ${tier.fortDC})` };
    }
  }

  return { damage: 0, description: `Temperature ${temperatureF}°F — comfortable` };
}

// ═══════════════════════════════════════════════════
// TRAVEL STATE MANAGEMENT
// ═══════════════════════════════════════════════════

/**
 * Initialize a new travel session.
 */
export function initTravel(party, startLocationId) {
  const startLoc = mapData.locations.find(l => l.id === startLocationId) || mapData.locations[0];
  return {
    partyX: startLoc.x,
    partyY: startLoc.y,
    currentLocation: startLoc,
    dayNumber: 1,
    hour: 8, // start at 8 AM
    hoursWalked: 0,
    totalMilesTraveled: 0,
    travelLog: [`Day 1: Party begins at ${startLoc.name}`],
    conditions: [],
    rations: party.length * 7, // 7 days of food per person
    waterSkins: party.length * 3, // 3 days of water per person
    mounted: false,
    mountType: null,
    lost: false,
    lostDirection: null
  };
}

/**
 * Move the party toward a destination, processing 1 hour of travel.
 */
export function travelOneHour(travelState, party, destination, terrainType, roadType, weatherPenalty = 0) {
  const speed = getPartySpeed(party);
  const milesPerHour = calculateHourlyTravel(speed, terrainType, roadType);
  const weatherMult = Math.max(0.25, 1 - weatherPenalty);
  const actualMiles = Math.round(milesPerHour * weatherMult * 100) / 100;

  const events = [];

  // Move party position toward destination
  const dx = destination.x - travelState.partyX;
  const dy = destination.y - travelState.partyY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const pixelsPerMile = 10; // approximate scale
  const pixelMove = actualMiles * pixelsPerMile;

  if (dist > 0 && dist > pixelMove) {
    travelState.partyX += (dx / dist) * pixelMove;
    travelState.partyY += (dy / dist) * pixelMove;
  } else if (dist > 0) {
    travelState.partyX = destination.x;
    travelState.partyY = destination.y;
    travelState.currentLocation = destination;
    events.push(`Arrived at ${destination.name}!`);
  }

  travelState.hoursWalked += 1;
  travelState.totalMilesTraveled += actualMiles;
  travelState.hour = (travelState.hour + 1) % 24;

  // Check forced march
  if (travelState.hoursWalked > 8) {
    const extraHours = travelState.hoursWalked - 8;
    for (const char of party) {
      const result = checkForcedMarch(char, extraHours);
      if (result.totalNonlethal > 0) {
        events.push(result.description);
      }
    }
  }

  // Encounter check (25% chance per hour in wilderness)
  if (terrainType !== 'urban' && terrainType !== 'road') {
    const encounterRoll = rollDice(1, 100);
    const chance = (mapData.overland.encounterFrequency[terrainType] || 15) / 4; // per-hour chance
    if (encounterRoll <= chance) {
      const enc = rollEncounterTable(terrainType);
      events.push(`Encounter: ${enc.encounter} (CR ${enc.cr})`);
    }
  }

  // Advance hour
  if (travelState.hour === 0) {
    travelState.dayNumber += 1;
    travelState.hoursWalked = 0;
    events.push(`Day ${travelState.dayNumber} begins.`);
  }

  return {
    milesTraveled: actualMiles,
    hoursWalked: travelState.hoursWalked,
    hour: travelState.hour,
    events,
    arrived: travelState.currentLocation?.id === destination.id,
    distanceRemaining: Math.round(dist / pixelsPerMile * 10) / 10
  };
}

/**
 * Make camp and rest for the night.
 */
export function makeCamp(travelState, party) {
  const events = [];
  const tod = getTimeOfDay(travelState.hour);

  events.push(`Party makes camp at ${tod.name} (hour ${travelState.hour}).`);

  // Consume rations (1 per person per day)
  if (travelState.rations >= party.length) {
    travelState.rations -= party.length;
    events.push(`Consumed ${party.length} rations. ${travelState.rations} remaining.`);
  } else {
    events.push(`Not enough rations! ${travelState.rations} available for ${party.length} party members.`);
  }

  // Night encounter checks (2 checks: dusk and midnight)
  const duskCheck = checkEncounter(getTerrainAtPosition(travelState.partyX, travelState.partyY), 'dusk');
  const midnightCheck = checkEncounter(getTerrainAtPosition(travelState.partyX, travelState.partyY), 'midnight');

  if (duskCheck.encountered) events.push(duskCheck.description);
  if (midnightCheck.encountered) events.push(midnightCheck.description);

  // Advance to morning
  travelState.hour = 6; // Wake at 6 AM
  travelState.dayNumber += 1;
  travelState.hoursWalked = 0;

  events.push(`Day ${travelState.dayNumber} dawns.`);

  return {
    events,
    nightEncounters: [duskCheck, midnightCheck].filter(c => c.encountered),
    day: travelState.dayNumber
  };
}

/**
 * Determine terrain type at a map position based on regions.
 */
export function getTerrainAtPosition(x, y) {
  for (const region of mapData.regions) {
    if (x >= region.bounds.x && x <= region.bounds.x + region.bounds.w &&
        y >= region.bounds.y && y <= region.bounds.y + region.bounds.h) {
      return region.terrain;
    }
  }
  return 'plains'; // default
}

/**
 * Get the region at a map position.
 */
export function getRegionAtPosition(x, y) {
  for (const region of mapData.regions) {
    if (x >= region.bounds.x && x <= region.bounds.x + region.bounds.w &&
        y >= region.bounds.y && y <= region.bounds.y + region.bounds.h) {
      return region;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════
// MAP DATA ACCESSORS
// ═══════════════════════════════════════════════════

export function getLocations() { return mapData.locations; }
export function getRegions() { return mapData.regions; }
export function getRoads() { return mapData.roads; }
export function getRivers() { return mapData.rivers; }
export function getLocationCategories() { return mapData.locationCategories; }
export function getMapSettings() { return mapData.mapSettings; }
export function getEncounterTables() { return mapData.encounterTables; }
export function getMountSpeeds() { return mapData.overland.mountSpeeds; }
export function getTimeOfDayData() { return mapData.overland.timeOfDay; }

export function findLocation(id) {
  return mapData.locations.find(l => l.id === id);
}

export function findLocationByName(name) {
  return mapData.locations.find(l => l.name.toLowerCase().includes(name.toLowerCase()));
}

export function getLocationsInRegion(regionId) {
  return mapData.locations.filter(l => l.region === regionId);
}

export function getNearbyLocations(x, y, radius = 100) {
  return mapData.locations.filter(l => {
    const dx = l.x - x;
    const dy = l.y - y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  }).sort((a, b) => {
    const da = Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2);
    const db = Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2);
    return da - db;
  });
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function getAbilityMod(character, ability) {
  const score = character?.abilities?.[ability] || character?.[ability.toLowerCase()] || 10;
  return Math.floor((score - 10) / 2);
}

function getSkillBonus(character, skillName) {
  if (!character || !character.skills) return 0;
  const skill = character.skills.find(s =>
    s.name === skillName || s.name?.toLowerCase() === skillName?.toLowerCase()
  );
  return skill ? (skill.total || skill.bonus || skill.ranks || 0) : 0;
}

export default {
  calculateTravelDistance,
  getPartySpeed,
  calculateHourlyTravel,
  checkForcedMarch,
  checkGettingLost,
  checkEncounter,
  dailyEncounterChecks,
  getTimeOfDay,
  getVisibility,
  checkStarvation,
  checkThirst,
  checkTemperatureExposure,
  initTravel,
  travelOneHour,
  makeCamp,
  getTerrainAtPosition,
  getRegionAtPosition,
  getLocations,
  getRegions,
  getRoads,
  getRivers,
  getLocationCategories,
  getMapSettings,
  getEncounterTables,
  getMountSpeeds,
  getTimeOfDayData,
  findLocation,
  findLocationByName,
  getLocationsInRegion,
  getNearbyLocations,
  rollEncounterTable
};
