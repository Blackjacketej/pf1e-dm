/**
 * worldService.js — PF1e GameMastery Guide World Mechanics Engine
 * Handles weather, traps, haunts, hazards, diseases, poisons, curses,
 * random encounters, treasure generation, chase scenes, and NPC generation.
 */
import worldData from '../data/worldMechanics.json';
import { roll, rollDice } from '../utils/dice';

// ═══════════════════════════════════════════════════
// SEEDED RNG (consistent per game-day)
// ═══════════════════════════════════════════════════
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ═══════════════════════════════════════════════════
// WEATHER SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Generate weather for a given day, climate, and season.
 * Uses seeded RNG for consistency per game-day.
 */
export function generateWeather(climate, season, daySeed) {
  const zone = worldData.weather.climateZones[climate];
  if (!zone) return null;

  const rng = seededRandom(hashString(`weather-${climate}-${season}-${daySeed}`));

  // Temperature: base + random variance
  const baseTemp = zone.baseTemp[season] || 60;
  const variance = zone.tempVariance || 15;
  const temperature = Math.round(baseTemp + (rng() * 2 - 1) * variance);

  // Wind
  const windRoll = rng() * 100;
  let wind;
  if (windRoll < 50) wind = worldData.weather.windStrengths[1]; // Light
  else if (windRoll < 75) wind = worldData.weather.windStrengths[2]; // Moderate
  else if (windRoll < 88) wind = worldData.weather.windStrengths[3]; // Strong
  else if (windRoll < 95) wind = worldData.weather.windStrengths[4]; // Severe
  else if (windRoll < 99) wind = worldData.weather.windStrengths[5]; // Windstorm
  else wind = worldData.weather.windStrengths[6]; // Hurricane

  // Precipitation
  const precipChance = zone.precipChance[season] || 20;
  const hasPrecip = rng() * 100 < precipChance;
  let precipitation = null;

  if (hasPrecip) {
    const stormChance = zone.stormChance[season] || 10;
    const isStorm = rng() * 100 < stormChance;
    const precipType = zone.precipType[season] || 'rain';

    if (isStorm) {
      if (precipType === 'snow') precipitation = worldData.weather.precipitationTypes.blizzard;
      else if (precipType === 'sandstorm') precipitation = worldData.weather.precipitationTypes.sandstorm;
      else precipitation = worldData.weather.precipitationTypes.heavy_rain;
      precipitation = { ...precipitation, name: isStorm ? 'Storm' : precipType, isStorm: true };
    } else {
      precipitation = worldData.weather.precipitationTypes[precipType] || worldData.weather.precipitationTypes.rain;
      precipitation = { ...precipitation, name: precipType, isStorm: false };
    }
  }

  // Temperature effects
  const tempEffect = getTemperatureEffect(temperature);

  return {
    temperature,
    temperatureF: temperature,
    temperatureC: Math.round((temperature - 32) * 5 / 9),
    wind,
    precipitation,
    tempEffect,
    description: describeWeather(temperature, wind, precipitation),
    climate: zone.name,
    season,
  };
}

function getTemperatureEffect(temp) {
  const effects = worldData.weather.temperatureEffects;
  for (const effect of effects) {
    if (effect.compare === 'below' && temp < effect.threshold) {
      return effect;
    }
  }
  return effects.find(e => e.range === 'comfortable') || null;
}

function describeWeather(temp, wind, precip) {
  let desc = '';
  if (temp < 0) desc = 'Bitterly cold';
  else if (temp < 32) desc = 'Freezing';
  else if (temp < 50) desc = 'Cold';
  else if (temp < 70) desc = 'Mild';
  else if (temp < 85) desc = 'Warm';
  else if (temp < 100) desc = 'Hot';
  else desc = 'Sweltering';

  if (wind && wind.mph > 30) desc += ` with ${wind.name.toLowerCase()} winds`;
  if (precip) {
    if (precip.isStorm) desc += `, ${precip.name.toLowerCase()} raging`;
    else desc += `, ${precip.name}`;
  }
  return desc;
}

/**
 * Apply weather effects to a character for a time period.
 * Returns array of effects that occurred.
 */
export function applyWeatherEffects(weather, character, durationMinutes) {
  const effects = [];
  if (!weather?.tempEffect || weather.tempEffect.range === 'comfortable') return effects;

  const te = weather.tempEffect;
  if (!te.fortDC) {
    // Automatic damage (extreme temps)
    const rounds = Math.floor(durationMinutes);
    for (let i = 0; i < rounds; i++) {
      const dmgMatch = te.damage.match(/(\d+)d(\d+)/);
      if (dmgMatch) {
        const dmg = rollDice(parseInt(dmgMatch[1]), parseInt(dmgMatch[2])).total;
        effects.push({ type: te.damageType, damage: dmg, source: te.range });
      }
    }
  } else {
    // Fort save required
    const freqMinutes = te.frequency === '10 minutes' ? 10 : te.frequency === '1 hour' ? 60 : 1;
    const checks = Math.floor(durationMinutes / freqMinutes);
    let dc = te.fortDC;

    for (let i = 0; i < checks; i++) {
      const fortMod = Math.floor(((character.abilities?.CON || 10) - 10) / 2) + (character.saves?.fort || 0);
      const saveRoll = roll(20) + fortMod;
      if (saveRoll < dc) {
        const dmgMatch = te.damage.match(/(\d+)d(\d+)/);
        if (dmgMatch) {
          const dmg = rollDice(parseInt(dmgMatch[1]), parseInt(dmgMatch[2])).total;
          effects.push({ type: te.damageType, damage: dmg, dc, saveRoll, source: te.range });
        }
      }
      dc += (te.dcIncrement || 0);
    }
  }
  return effects;
}

// ═══════════════════════════════════════════════════
// TRAP SYSTEM
// ═══════════════════════════════════════════════════

export function getTrapTemplates() {
  return worldData.traps.sampleTraps;
}

/**
 * Attempt to detect a trap. Returns result of Perception check.
 */
export function detectTrap(trap, character) {
  const perceptionRanks = character.skillRanks?.Perception || 0;
  const wisMod = Math.floor(((character.abilities?.WIS || 10) - 10) / 2);
  const classBonus = perceptionRanks > 0 ? 3 : 0; // Class skill bonus
  const miscBonus = character.skillBonuses?.Perception || 0;
  const totalPerception = perceptionRanks + wisMod + classBonus + miscBonus;

  const perceptionRoll = roll(20);
  const total = perceptionRoll + totalPerception;
  const detected = total >= trap.perceptionDC;

  return {
    detected,
    roll: perceptionRoll,
    modifier: totalPerception,
    total,
    dc: trap.perceptionDC,
    trapName: detected ? trap.name : 'something suspicious',
  };
}

/**
 * Attempt to disable a trap. Returns result of Disable Device check.
 */
export function disableTrap(trap, character) {
  const ddRanks = character.skillRanks?.['Disable Device'] || 0;
  if (ddRanks === 0) return { success: false, canAttempt: false, reason: 'Disable Device is trained only' };

  const dexMod = Math.floor(((character.abilities?.DEX || 10) - 10) / 2);
  const classBonus = ddRanks > 0 ? 3 : 0;
  const miscBonus = character.skillBonuses?.['Disable Device'] || 0;
  const totalDD = ddRanks + dexMod + classBonus + miscBonus;

  const ddRoll = roll(20);
  const total = ddRoll + totalDD;
  const success = total >= trap.disableDC;

  // Fail by 5 or more triggers the trap
  const triggered = !success && (trap.disableDC - total >= 5);

  return {
    success,
    triggered,
    canAttempt: true,
    roll: ddRoll,
    modifier: totalDD,
    total,
    dc: trap.disableDC,
    trapName: trap.name,
  };
}

/**
 * Trigger a trap's effects against targets.
 */
export function triggerTrap(trap, targets) {
  const results = [];
  for (const target of targets) {
    // Parse trap effect for save DC and damage
    const saveDCMatch = trap.effect.match(/DC\s+(\d+)\s+(Reflex|Fort|Will)/i);
    const dmgMatch = trap.effect.match(/(\d+)d(\d+)(?:\+(\d+))?/);

    let saved = false;
    let saveRoll = 0;
    let damage = 0;

    if (dmgMatch) {
      damage = rollDice(parseInt(dmgMatch[1]), parseInt(dmgMatch[2])).total + (parseInt(dmgMatch[3]) || 0);
    }

    if (saveDCMatch) {
      const dc = parseInt(saveDCMatch[1]);
      const saveType = saveDCMatch[2].toLowerCase();
      const abilityMap = { reflex: 'DEX', fort: 'CON', will: 'WIS' };
      const ability = abilityMap[saveType] || 'DEX';
      const abilityMod = Math.floor(((target.abilities?.[ability] || 10) - 10) / 2);
      const saveBonus = target.saves?.[saveType.substring(0, 3)] || 0;
      saveRoll = roll(20) + abilityMod + saveBonus;
      saved = saveRoll >= dc;

      if (saved && trap.effect.toLowerCase().includes('half')) {
        damage = Math.floor(damage / 2);
      } else if (saved && trap.effect.toLowerCase().includes('negates')) {
        damage = 0;
      }
    }

    results.push({
      target: target.name || target.id,
      damage,
      saved,
      saveRoll,
      description: trap.effect,
    });
  }
  return results;
}

// ═══════════════════════════════════════════════════
// HAUNT SYSTEM
// ═══════════════════════════════════════════════════

export function getHauntTemplates() {
  return worldData.haunts.sampleHaunts;
}

export function resolveHaunt(haunt, targets) {
  const results = [];
  for (const target of targets) {
    const saveDCMatch = haunt.effect.match(/DC\s+(\d+)\s+(Will|Fort|Reflex)/i);
    const dmgMatch = haunt.effect.match(/(\d+)d(\d+)/);

    let saved = false;
    let damage = 0;

    if (dmgMatch) {
      damage = rollDice(parseInt(dmgMatch[1]), parseInt(dmgMatch[2])).total;
    }

    if (saveDCMatch) {
      const dc = parseInt(saveDCMatch[1]);
      const saveType = saveDCMatch[2].toLowerCase();
      const abilityMap = { will: 'WIS', fort: 'CON', reflex: 'DEX' };
      const ability = abilityMap[saveType] || 'WIS';
      const abilityMod = Math.floor(((target.abilities?.[ability] || 10) - 10) / 2);
      const saveBonus = target.saves?.[saveType.substring(0, 3)] || 0;
      const saveRoll = roll(20) + abilityMod + saveBonus;
      saved = saveRoll >= dc;

      if (saved && haunt.effect.toLowerCase().includes('negates')) damage = 0;
      if (saved && haunt.effect.toLowerCase().includes('halves')) damage = Math.floor(damage / 2);
    }

    results.push({
      target: target.name,
      damage,
      saved,
      hauntName: haunt.name,
      effect: haunt.effect,
    });
  }
  return results;
}

/**
 * Damage a haunt with positive energy (channel energy, cure spells).
 */
export function damageHaunt(haunt, positiveEnergyDamage) {
  const maxHP = haunt.persistent
    ? Math.floor(haunt.cr * 4.5)
    : haunt.cr * 2;
  const hp = haunt.currentHP ?? maxHP;
  const newHP = Math.max(0, hp - positiveEnergyDamage);

  return {
    previousHP: hp,
    currentHP: newHP,
    maxHP,
    neutralized: newHP <= 0,
    destructionCondition: haunt.destruction,
  };
}

// ═══════════════════════════════════════════════════
// DISEASE & POISON SYSTEM
// ═══════════════════════════════════════════════════

export function getDiseases() { return worldData.hazards.diseases; }
export function getPoisons() { return worldData.hazards.poisons; }
export function getCurses() { return worldData.hazards.curses; }

/**
 * Roll a disease/poison save for a character.
 */
export function rollAfflictionSave(affliction, character) {
  const fortMod = Math.floor(((character.abilities?.CON || 10) - 10) / 2);
  const saveMod = character.saves?.fort || 0;
  const fortRoll = roll(20);
  const total = fortRoll + fortMod + saveMod;
  const success = total >= affliction.fortDC;

  // Track consecutive saves for cure
  const consecutiveSaves = (affliction._consecutiveSaves || 0) + (success ? 1 : 0);
  const cureMatch = affliction.cure?.match(/(\d+)\s+consecutive/);
  const cureThreshold = cureMatch ? parseInt(cureMatch[1]) : 2;
  const cured = consecutiveSaves >= cureThreshold;

  // Parse effect damage
  let abilityDamage = null;
  let hpDamage = 0;
  if (!success) {
    const effMatch = affliction.effect.match(/(\d+)d(\d+)\s+(\w+)\s+damage/i);
    if (effMatch) {
      const dmg = rollDice(parseInt(effMatch[1]), parseInt(effMatch[2])).total;
      const ability = effMatch[3];
      if (['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'].includes(ability)) {
        abilityDamage = { ability: ability.toUpperCase(), amount: dmg };
      } else {
        hpDamage = dmg;
      }
    }
  }

  return {
    success,
    roll: fortRoll,
    total,
    dc: affliction.fortDC,
    abilityDamage: success ? null : abilityDamage,
    hpDamage: success ? 0 : hpDamage,
    consecutiveSaves: success ? consecutiveSaves : 0,
    cured,
    name: affliction.name,
  };
}

// ═══════════════════════════════════════════════════
// RANDOM ENCOUNTER SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Check for a random encounter based on terrain, time of day, and modifiers.
 */
export function checkRandomEncounter(terrain, timeOfDay, modifiers = {}) {
  const terrainData = worldData.randomEncounters.terrainTypes[terrain];
  if (!terrainData) return { encountered: false, terrain };

  const isNight = timeOfDay === 'dusk' || timeOfDay === 'midnight';
  const baseChance = isNight ? terrainData.encounterChance.night : terrainData.encounterChance.day;
  const adjustedChance = baseChance + (modifiers.chanceBonus || 0);

  const encounterRoll = roll(100);
  const encountered = encounterRoll <= adjustedChance;

  if (!encountered) return { encountered: false, roll: encounterRoll, chance: adjustedChance, terrain };

  // Roll on encounter table
  const tier = modifiers.tier || 'low';
  const table = terrainData.tables[tier] || terrainData.tables.low;
  if (!table) return { encountered: false, terrain };

  const tableRoll = roll(100);
  let encounter = table[table.length - 1]; // Default to last entry

  for (const entry of table) {
    if (tableRoll >= entry.roll[0] && tableRoll <= entry.roll[1]) {
      encounter = entry;
      break;
    }
  }

  // Roll creature count
  let count = 1;
  if (encounter.count) {
    const countMatch = encounter.count.match(/(\d+)d(\d+)(?:\+(\d+))?/);
    if (countMatch) {
      count = rollDice(parseInt(countMatch[1]), parseInt(countMatch[2])).total + (parseInt(countMatch[3]) || 0);
    } else {
      count = parseInt(encounter.count) || 1;
    }
  }

  return {
    encountered: true,
    roll: encounterRoll,
    chance: adjustedChance,
    terrain: terrainData.name,
    timeOfDay,
    creature: encounter.creature,
    count,
    cr: encounter.cr,
    tableRoll,
  };
}

/**
 * Run all four daily encounter checks.
 */
export function dailyEncounterChecks(terrain, modifiers = {}) {
  const times = worldData.randomEncounters.checkFrequency.times;
  return times.map(time => checkRandomEncounter(terrain, time, modifiers));
}

// ═══════════════════════════════════════════════════
// TREASURE GENERATION
// ═══════════════════════════════════════════════════

/**
 * Generate random treasure for an encounter of a given CR.
 * @param {number} cr - Encounter CR
 * @param {string} treasureType - 'A' through 'F' (optional, defaults based on CR)
 */
export function generateTreasure(cr, treasureType) {
  const baseValue = worldData.treasure.valueByEncounterCR[String(cr)] || 260;
  const type = treasureType
    ? worldData.treasure.randomTreasureType[treasureType]
    : autoTreasureType(cr);

  const result = { totalValue: 0, coins: null, gems: [], artObjects: [], magicItems: [] };

  // Coins
  if (roll(100) <= type.coinChance) {
    const coinValue = Math.round(baseValue * (0.3 + Math.random() * 0.4));
    result.coins = generateCoins(coinValue);
    result.totalValue += coinValue;
  }

  // Gems
  if (roll(100) <= type.gemChance) {
    const gemBudget = Math.round(baseValue * (0.1 + Math.random() * 0.2));
    result.gems = generateGems(gemBudget);
    result.totalValue += result.gems.reduce((s, g) => s + g.value, 0);
  }

  // Art objects
  if (roll(100) <= type.artChance) {
    const artBudget = Math.round(baseValue * (0.1 + Math.random() * 0.2));
    result.artObjects = generateArtObjects(artBudget);
    result.totalValue += result.artObjects.reduce((s, a) => s + a.value, 0);
  }

  // Magic items (if applicable)
  if (type.itemChance && roll(100) <= type.itemChance) {
    const itemBudget = Math.max(0, baseValue - result.totalValue);
    result.magicItems = generateMagicItemPlaceholders(itemBudget, type.itemTier || 'minor');
    result.totalValue += result.magicItems.reduce((s, i) => s + i.estimatedValue, 0);
  }

  return result;
}

function autoTreasureType(cr) {
  if (cr <= 3) return worldData.treasure.randomTreasureType.B;
  if (cr <= 7) return worldData.treasure.randomTreasureType.D;
  if (cr <= 12) return worldData.treasure.randomTreasureType.E;
  return worldData.treasure.randomTreasureType.F;
}

function generateCoins(totalGP) {
  // Split into coin denominations
  const platinum = Math.floor(totalGP * 0.05); // 5% in pp
  const gold = Math.floor(totalGP * 0.6); // 60% in gp
  const silver = Math.floor(totalGP * 0.25 * 10); // 25% in sp
  const copper = Math.floor(totalGP * 0.1 * 100); // 10% in cp

  return {
    pp: Math.floor(platinum / 10),
    gp: gold,
    sp: silver,
    cp: copper,
    totalGP: Math.round(totalGP),
  };
}

function generateGems(budget) {
  const gems = [];
  const gemTiers = worldData.treasure.gems;
  let remaining = budget;

  while (remaining > 5) {
    // Pick an appropriate tier
    const affordable = gemTiers.filter(t => t.value <= remaining);
    if (affordable.length === 0) break;

    // Weight toward middle tiers
    const tier = affordable[Math.floor(Math.random() * affordable.length)];
    const name = tier.examples[Math.floor(Math.random() * tier.examples.length)];
    gems.push({ name, value: tier.value });
    remaining -= tier.value;
  }
  return gems;
}

function generateArtObjects(budget) {
  const objects = [];
  const artTiers = worldData.treasure.artObjects;
  let remaining = budget;

  while (remaining > 5) {
    const affordable = artTiers.filter(t => t.value <= remaining);
    if (affordable.length === 0) break;

    const tier = affordable[Math.floor(Math.random() * affordable.length)];
    const name = tier.examples[Math.floor(Math.random() * tier.examples.length)];
    objects.push({ name, value: tier.value });
    remaining -= tier.value;
  }
  return objects;
}

function generateMagicItemPlaceholders(budget, tier) {
  const items = [];
  const tierRanges = {
    minor: { min: 50, max: 4000 },
    medium: { min: 4001, max: 16000 },
    major: { min: 16001, max: 50000 },
  };
  const range = tierRanges[tier] || tierRanges.minor;
  let remaining = budget;

  while (remaining >= range.min) {
    const value = Math.min(remaining, range.min + Math.floor(Math.random() * (range.max - range.min)));
    items.push({
      tier,
      estimatedValue: value,
      description: `Unidentified ${tier} magic item (worth ~${value} gp)`,
    });
    remaining -= value;
    if (items.length >= 3) break;
  }
  return items;
}

// ═══════════════════════════════════════════════════
// CHASE SCENE SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Initialize a chase scene.
 */
export function initializeChase(pursuer, quarry, terrain, startingGap) {
  const gap = startingGap || worldData.chaseScenes.chaseRules.startingDistance;

  return {
    pursuer,
    quarry,
    terrain,
    gap,
    round: 1,
    obstacles: [],
    log: [],
    resolved: false,
    result: null,
  };
}

/**
 * Generate a random obstacle for the current chase round.
 */
export function generateChaseObstacle(terrain) {
  const obstacles = worldData.chaseScenes.obstacleExamples.filter(o => o.terrain === terrain);
  if (obstacles.length === 0) {
    // Fall back to generic
    return worldData.chaseScenes.obstacleExamples[Math.floor(Math.random() * worldData.chaseScenes.obstacleExamples.length)];
  }
  return obstacles[Math.floor(Math.random() * obstacles.length)];
}

/**
 * Resolve a chase round.
 * Both pursuer and quarry face an obstacle and roll.
 */
export function resolveChaseRound(chase, pursuerSkillMod, quarrySkillMod) {
  const obstacle = generateChaseObstacle(chase.terrain);

  const pursuerRoll = roll(20) + pursuerSkillMod;
  const quarryRoll = roll(20) + quarrySkillMod;

  const pursuerSuccess = pursuerRoll >= obstacle.dc;
  const quarrySuccess = quarryRoll >= obstacle.dc;

  let gapChange = 0;
  if (pursuerSuccess && !quarrySuccess) gapChange = -1; // Pursuer gains
  else if (!pursuerSuccess && quarrySuccess) gapChange = 1; // Quarry gains
  // Both succeed or both fail: no change

  // Check for damage on bad failures
  const pursuerDamage = (!pursuerSuccess && obstacle.dc - pursuerRoll >= 5) ? rollDice(1, 6).total : 0;
  const quarryDamage = (!quarrySuccess && obstacle.dc - quarryRoll >= 5) ? rollDice(1, 6).total : 0;

  const newGap = chase.gap + gapChange;
  const rules = worldData.chaseScenes.chaseRules;
  const escaped = newGap >= rules.escapeDistance;
  const caught = newGap <= rules.captureDistance;

  return {
    round: chase.round,
    obstacle,
    pursuer: { roll: pursuerRoll, success: pursuerSuccess, damage: pursuerDamage },
    quarry: { roll: quarryRoll, success: quarrySuccess, damage: quarryDamage },
    gapChange,
    newGap,
    resolved: escaped || caught || chase.round >= rules.maxRounds,
    result: caught ? 'caught' : escaped ? 'escaped' : chase.round >= rules.maxRounds ? 'timeout' : null,
  };
}

// ═══════════════════════════════════════════════════
// NPC GENERATION
// ═══════════════════════════════════════════════════

/**
 * Generate a random NPC with appearance, personality, and motivation.
 * Uses seeded RNG for consistency.
 */
export function generateRandomNPC(seed, options = {}) {
  const rng = seededRandom(hashString(`npc-${seed}`));
  const gen = worldData.npcGeneration;

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const races = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Half-Elf', 'Half-Orc', 'Gnome'];
  const genders = ['male', 'female'];

  const race = options.race || pick(races);
  const gender = options.gender || pick(genders);
  const occupation = options.occupation || pick(gen.occupations);
  const motivation = pick(gen.motivations);
  const quirk = pick(gen.quirks);

  const hair = pick(gen.appearances.hair);
  const build = pick(gen.appearances.build);
  const distinguishing = pick(gen.appearances.distinguishing);

  // Generate ability scores using the specified array type
  const arrayType = options.arrayType || 'standard';
  const statArray = [...(gen.npcStatArrays[arrayType] || gen.npcStatArrays.standard)];
  // Shuffle for randomness
  for (let i = statArray.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [statArray[i], statArray[j]] = [statArray[j], statArray[i]];
  }

  const level = options.level || 1;
  const wealth = gen.npcWealthByLevel[String(level)] || 260;

  return {
    race,
    gender,
    occupation,
    motivation,
    quirk,
    appearance: { hair, build, distinguishing },
    abilities: {
      STR: statArray[0], DEX: statArray[1], CON: statArray[2],
      INT: statArray[3], WIS: statArray[4], CHA: statArray[5],
    },
    level,
    wealth,
    description: `A ${build} ${race.toLowerCase()} with ${hair} hair and ${distinguishing}`,
  };
}

// ═══════════════════════════════════════════════════
// ENVIRONMENTAL HAZARDS
// ═══════════════════════════════════════════════════

export function getEnvironmentalHazards() {
  return worldData.hazards.environmental;
}

/**
 * Resolve an environmental hazard against targets.
 */
export function resolveEnvironmentalHazard(hazardName, targets) {
  const hazard = worldData.hazards.environmental.find(h => h.name === hazardName);
  if (!hazard) return [];

  return targets.map(target => {
    let damage = 0;
    let saved = false;

    // Parse damage from hazard data
    const dmgField = hazard.buryDamage || hazard.contactDamage;
    if (dmgField) {
      const match = dmgField.match(/(\d+)d(\d+)/);
      if (match) damage = rollDice(parseInt(match[1]), parseInt(match[2])).total;
    }

    // Reflex save if applicable
    if (hazard.reflexDC) {
      const dexMod = Math.floor(((target.abilities?.DEX || 10) - 10) / 2);
      const refSave = roll(20) + dexMod + (target.saves?.ref || 0);
      saved = refSave >= hazard.reflexDC;
      if (saved) damage = Math.floor(damage / 2);
    }

    return {
      target: target.name,
      hazard: hazard.name,
      damage,
      saved,
    };
  });
}

// ═══════════════════════════════════════════════════
// DEFAULT EXPORT
// ═══════════════════════════════════════════════════

export default {
  // Weather
  generateWeather,
  applyWeatherEffects,
  // Traps
  getTrapTemplates,
  detectTrap,
  disableTrap,
  triggerTrap,
  // Haunts
  getHauntTemplates,
  resolveHaunt,
  damageHaunt,
  // Hazards
  getEnvironmentalHazards,
  resolveEnvironmentalHazard,
  // Afflictions
  getDiseases,
  getPoisons,
  getCurses,
  rollAfflictionSave,
  // Random Encounters
  checkRandomEncounter,
  dailyEncounterChecks,
  // Treasure
  generateTreasure,
  // Chase Scenes
  initializeChase,
  generateChaseObstacle,
  resolveChaseRound,
  // NPC Generation
  generateRandomNPC,
};
