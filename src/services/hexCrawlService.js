/**
 * hexCrawlService.js — Hex Crawl Weather & Encounter Integration
 * Generates daily weather, CR-appropriate encounters from the monster database,
 * and handles hex crawl day advancement with all PF1e rules applied.
 */
import { generateWeather, applyWeatherEffects } from './worldService';
import { rollDice } from '../utils/dice';
import db from '../db/database';

// ═══════════════════════════════════════════════════
// TERRAIN → ENVIRONMENT MAPPING
// ═══════════════════════════════════════════════════

// Map hex terrain types to monster environment search terms
const TERRAIN_ENVIRONMENTS = {
  plains: ['plains', 'grassland', 'any land', 'temperate plains'],
  forest: ['forest', 'any forest', 'temperate forest', 'any land', 'woodland'],
  hills: ['hills', 'any hills', 'any land', 'temperate hills'],
  mountain: ['mountain', 'any mountain', 'any land', 'temperate mountain'],
  swamp: ['swamp', 'marsh', 'any swamp', 'any land', 'temperate swamp'],
  desert: ['desert', 'any desert', 'warm desert', 'any land'],
  water: ['aquatic', 'any aquatic', 'ocean', 'water'],
  coastal: ['coastal', 'any coastal', 'temperate coast', 'any aquatic', 'any land'],
  urban: ['urban', 'any urban', 'any land', 'any'],
  river: ['aquatic', 'any aquatic', 'river', 'freshwater'],
};

// Terrain → climate mapping for weather generation
const TERRAIN_CLIMATE = {
  plains: 'temperate',
  forest: 'temperate',
  hills: 'temperate',
  mountain: 'cold',
  swamp: 'temperate',
  desert: 'desert',
  water: 'temperate',
  coastal: 'temperate',
  urban: 'temperate',
  river: 'temperate',
};

// Monster types appropriate per terrain
const TERRAIN_MONSTER_TYPES = {
  plains: ['Animal', 'Magical Beast', 'Humanoid', 'Vermin'],
  forest: ['Animal', 'Fey', 'Plant', 'Magical Beast', 'Humanoid', 'Vermin'],
  hills: ['Animal', 'Humanoid', 'Magical Beast', 'Monstrous Humanoid', 'Dragon'],
  mountain: ['Animal', 'Dragon', 'Magical Beast', 'Monstrous Humanoid', 'Humanoid'],
  swamp: ['Animal', 'Undead', 'Aberration', 'Plant', 'Vermin'],
  desert: ['Animal', 'Vermin', 'Magical Beast', 'Monstrous Humanoid', 'Undead'],
  water: ['Animal', 'Magical Beast', 'Aberration'],
  coastal: ['Animal', 'Magical Beast', 'Humanoid', 'Aberration'],
  urban: ['Humanoid', 'Undead', 'Construct', 'Aberration'],
  river: ['Animal', 'Magical Beast', 'Fey'],
};

// Encounter chance per terrain (% per check, checked 3-4 times per day)
const ENCOUNTER_CHANCE = {
  plains: 15, forest: 20, hills: 15, mountain: 20,
  swamp: 25, desert: 15, water: 10, coastal: 12,
  urban: 10, river: 12,
};

// ═══════════════════════════════════════════════════
// SEASON HELPER
// ═══════════════════════════════════════════════════

function getSeason(dayNumber) {
  // Simple season cycle: 90 days each
  const dayInYear = ((dayNumber - 1) % 360);
  if (dayInYear < 90) return 'spring';
  if (dayInYear < 180) return 'summer';
  if (dayInYear < 270) return 'fall';
  return 'winter';
}

// ═══════════════════════════════════════════════════
// WEATHER GENERATION
// ═══════════════════════════════════════════════════

/**
 * Generate weather for the current hex crawl day.
 * Uses the terrain's climate zone and the current season.
 */
export function generateDailyWeather(terrainType, dayNumber) {
  const climate = TERRAIN_CLIMATE[terrainType] || 'temperate';
  const season = getSeason(dayNumber);
  const weather = generateWeather(climate, season, dayNumber);

  if (!weather) {
    return {
      description: 'Clear skies',
      temperature: 65,
      temperatureF: 65,
      wind: { name: 'Light', mph: 10 },
      precipitation: null,
      tempEffect: null,
      season,
      climate,
      speedPenalty: 0,
      gettingLostMod: 0,
    };
  }

  // Calculate speed penalty from weather
  let speedPenalty = 0;
  let gettingLostMod = 0;
  if (weather.precipitation) {
    const p = weather.precipitation;
    if (p.speedPenalty === 'half') speedPenalty = 0.5;
    else if (p.speedPenalty === 'quarter') speedPenalty = 0.75;
    else if (typeof p.speedPenalty === 'number') speedPenalty = p.speedPenalty;

    // Weather conditions make it easier to get lost
    if (p.name === 'snow' || p.name === 'rain') gettingLostMod = 2;
    if (p.name === 'fog') gettingLostMod = 4;
    if (p.isStorm) gettingLostMod = 4;
    if (p.name === 'blizzard' || p.name === 'sandstorm') gettingLostMod = 8;
  }

  // High wind getting lost modifier
  if (weather.wind && weather.wind.mph >= 50) gettingLostMod = Math.max(gettingLostMod, 4);

  return {
    ...weather,
    speedPenalty,
    gettingLostMod,
  };
}

// ═══════════════════════════════════════════════════
// ENCOUNTER GENERATION FROM MONSTER DATABASE
// ═══════════════════════════════════════════════════

/**
 * Query the Dexie monster database for CR-appropriate creatures matching terrain.
 * Returns an array of candidate monsters.
 */
export async function findMonstersForTerrain(terrainType, targetCR, crRange = 2) {
  const environments = TERRAIN_ENVIRONMENTS[terrainType] || TERRAIN_ENVIRONMENTS.plains;
  const monsterTypes = TERRAIN_MONSTER_TYPES[terrainType] || TERRAIN_MONSTER_TYPES.plains;

  const minCR = Math.max(0, targetCR - crRange);
  const maxCR = targetCR + crRange;

  try {
    // Get all monsters in CR range
    const allMonsters = await db.monsters
      .where('cr')
      .between(minCR, maxCR, true, true)
      .toArray();

    // Filter by environment/type relevance
    const scored = allMonsters.map(m => {
      let score = 0;
      const env = (m.environment || '').toLowerCase();
      const type = (m.type || '').toLowerCase();

      // Environment match
      for (const e of environments) {
        if (env.includes(e.toLowerCase())) { score += 3; break; }
      }
      // "any land" or "any" is a weak match
      if (env.includes('any land') || env === 'any') score += 1;

      // Type match
      for (const t of monsterTypes) {
        if (type.includes(t.toLowerCase())) { score += 2; break; }
      }

      // Penalize extraplanar/outsiders for mundane terrain
      if (type.includes('outsider') && !['mountain', 'desert'].includes(terrainType)) score -= 2;

      // Exact CR match bonus
      if (m.cr === targetCR) score += 1;

      return { ...m, _score: score };
    });

    // Sort by relevance, filter out poor matches
    return scored
      .filter(m => m._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 30); // Top 30 candidates
  } catch (err) {
    console.warn('[HexCrawl] Monster query failed:', err);
    return [];
  }
}

/**
 * Generate a random encounter appropriate for the terrain and party level.
 * Uses the monster database for real PF1e creatures.
 */
export async function generateEncounter(terrainType, partyLevel, timeOfDay = 'day') {
  // Roll for encounter
  const chance = ENCOUNTER_CHANCE[terrainType] || 15;
  const nightMod = (timeOfDay === 'night' || timeOfDay === 'midnight') ? 1.5 : 1.0;
  const roll = rollDice(1, 100).total;
  const threshold = Math.round(chance * nightMod);

  if (roll > threshold) {
    return {
      encountered: false,
      roll,
      threshold,
      terrain: terrainType,
      description: `No encounter (d100: ${roll} vs ${threshold}%)`,
    };
  }

  // Determine encounter CR (party level -1 to +3, weighted toward APL)
  const crOffset = rollDice(1, 6).total;
  let encounterCR;
  if (crOffset <= 2) encounterCR = partyLevel - 1;
  else if (crOffset <= 4) encounterCR = partyLevel;
  else if (crOffset <= 5) encounterCR = partyLevel + 1;
  else encounterCR = partyLevel + 2;
  encounterCR = Math.max(0.5, encounterCR);

  // Find monsters from database
  const candidates = await findMonstersForTerrain(terrainType, encounterCR);

  if (candidates.length === 0) {
    // Fallback if database query returns nothing
    return {
      encountered: true,
      roll,
      threshold,
      terrain: terrainType,
      cr: encounterCR,
      monster: null,
      description: `Encounter! (d100: ${roll} vs ${threshold}%) — CR ${encounterCR} creature (type unknown)`,
      fallback: true,
    };
  }

  // Pick a random monster from candidates (weighted toward better matches)
  const weights = candidates.map(m => m._score);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * totalWeight;
  let monster = candidates[0];
  for (let i = 0; i < candidates.length; i++) {
    pick -= weights[i];
    if (pick <= 0) { monster = candidates[i]; break; }
  }

  // Determine number of creatures
  let count = 1;
  if (monster.cr < encounterCR) {
    // Multiple weaker creatures
    const crDiff = encounterCR - monster.cr;
    if (crDiff >= 4) count = rollDice(3, 4).total;
    else if (crDiff >= 2) count = rollDice(1, 4).total + 1;
    else if (crDiff >= 1) count = rollDice(1, 3).total;
  }

  const countStr = count > 1 ? `${count}x ` : '';
  const description = `Encounter! (d100: ${roll} vs ${threshold}%) — ${countStr}${monster.name} (CR ${monster.cr})${count > 1 ? ` [Effective CR ~${encounterCR}]` : ''}`;

  return {
    encountered: true,
    roll,
    threshold,
    terrain: terrainType,
    cr: monster.cr,
    effectiveCR: encounterCR,
    monster: {
      name: monster.name,
      cr: monster.cr,
      type: monster.type,
      hp: monster.hp,
      ac: monster.ac,
      atk: monster.atk,
      special: monster.special,
      xp: monster.xp,
      environment: monster.environment,
    },
    count,
    description,
  };
}

// ═══════════════════════════════════════════════════
// FULL HEX CRAWL DAY ADVANCEMENT
// ═══════════════════════════════════════════════════

/**
 * Advance the hex crawl by one full day.
 * Generates weather, checks encounters (morning, afternoon, night),
 * handles rations/water, and returns all events.
 */
export async function advanceHexCrawlDay(worldState, party, terrainType) {
  const dayNumber = (worldState.currentDay || 1) + 1;
  const events = [];
  const partyLevel = Math.max(1, ...party.map(c => c.level || 1));

  // 1. Generate weather
  const weather = generateDailyWeather(terrainType, dayNumber);
  events.push({
    type: 'weather',
    text: `Day ${dayNumber} — ${weather.description} (${weather.temperatureF}°F)`,
  });

  // 2. Check encounters (morning, afternoon, night)
  const times = ['morning', 'afternoon', 'night'];
  const encounters = [];
  for (const time of times) {
    const enc = await generateEncounter(terrainType, partyLevel, time);
    if (enc.encountered) {
      encounters.push(enc);
      events.push({
        type: 'encounter',
        text: `[${time}] ${enc.description}`,
        encounter: enc,
      });
    }
  }

  // 3. Ration consumption
  const rationsCost = party.length;
  events.push({
    type: 'supply',
    text: `Party consumes ${rationsCost} rations and ${rationsCost} waterskins.`,
  });

  // 4. Weather effects on party
  if (weather.tempEffect && weather.tempEffect.range !== 'comfortable') {
    events.push({
      type: 'hazard',
      text: `Temperature hazard: ${weather.tempEffect.effect}`,
    });
  }

  return {
    dayNumber,
    weather,
    events,
    encounters,
    rationsCost,
  };
}

export default {
  generateDailyWeather,
  findMonstersForTerrain,
  generateEncounter,
  advanceHexCrawlDay,
  getSeason,
  TERRAIN_ENVIRONMENTS,
  TERRAIN_CLIMATE,
  ENCOUNTER_CHANCE,
};
