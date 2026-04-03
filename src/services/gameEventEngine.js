/**
 * Game Event Engine — Reactive system that cascades gameplay actions across all subsystems.
 *
 * Instead of requiring manual button clicks for weather, time, encounters, attitudes, etc.,
 * this engine listens to high-level game events (travel, combat end, rest, settlement arrival)
 * and automatically triggers the appropriate subsystem responses.
 *
 * Usage: import gameEvents from './gameEventEngine';
 *        const effects = gameEvents.onTravel(context);
 *        // effects.weatherGenerated, effects.encounterRolled, effects.timeAdvanced, etc.
 */

import * as dmTools from './dmToolsService';
import * as overland from './overlandService';
import * as worldSvc from './worldService';
import advancedService from './advancedService';
import downtimeService from './downtimeService';
import { roll, rollDice } from '../utils/dice';
import { getEncumbranceLevel, getEncumbranceEffects, getCarryingCapacity } from '../utils/character';

// ══════════════════════════════════════════════════════════════════════════════
// TRAVEL EVENTS — Fired each time the party moves overland
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process one hour of travel. Advances time, generates weather if needed,
 * checks for encounters, applies terrain effects, tracks rations.
 *
 * @param {object} ctx - { worldState, party, terrain, climate, season, travelMode }
 * @returns {object} { events[], worldUpdates{}, encounter?, weatherGenerated? }
 */
export function onTravelHour(ctx) {
  const { worldState, party, terrain, climate, season } = ctx;
  const events = [];
  const worldUpdates = {};
  let encounter = null;

  // 1. Advance time by 1 hour
  const currentDay = worldState?.currentDay || 1;
  const currentHour = worldState?.currentHour || 8;
  const timeResult = dmTools.advanceTime(currentDay, currentHour, 1);
  worldUpdates.currentDay = timeResult.newDay;
  worldUpdates.currentHour = timeResult.newHour;

  // 2. Generate weather at dawn or if none exists
  const travelPrefs = worldState?.dmPreferences || {};
  const dayChanged = timeResult.newDay !== currentDay;
  if (travelPrefs.weatherSystem !== false && (dayChanged || !worldState?.currentWeather)) {
    const weather = worldSvc.generateWeather(
      climate || 'temperate',
      season || getSeasonFromDay(timeResult.newDay),
      timeResult.newDay
    );
    worldUpdates.currentWeather = weather;
    if (dayChanged) {
      events.push({ type: 'weather', text: `Day ${timeResult.newDay}: ${weather.description} (${weather.temperatureF}°F)`, severity: 'info' });
    }
  }

  // 3. Check for random encounter (terrain-based)
  const timeOfDay = overland.getTimeOfDay(timeResult.newHour);
  const encounterCheck = overland.checkEncounter(terrain || 'plains', timeOfDay);
  if (encounterCheck.encountered) {
    encounter = encounterCheck;
    events.push({ type: 'encounter', text: encounterCheck.description, severity: 'danger' });
  }

  // 4. Rations consumption at evening (hour 19)
  if (timeResult.newHour === 19) {
    events.push({ type: 'rations', text: 'The party consumes rations for the day.', severity: 'info' });
  }

  // 5. Visibility check for night travel
  if (timeResult.newHour >= 21 || timeResult.newHour <= 5) {
    events.push({ type: 'visibility', text: 'Traveling in darkness. Perception checks at -4 without darkvision.', severity: 'warning' });
  }

  // 6. Fatigue check if traveling more than 8 hours
  const hoursToday = worldState?._travelHoursToday || 0;
  if (hoursToday >= 8) {
    const extraHours = hoursToday - 8;
    events.push({ type: 'fatigue', text: `Forced march! ${extraHours + 1} extra hours — DC ${10 + extraHours * 2} Constitution check or fatigued.`, severity: 'warning' });
  }
  worldUpdates._travelHoursToday = (worldState?._travelHoursToday || 0) + 1;

  // 7. Encumbrance check — flag overloaded characters with speed penalties
  party.forEach(c => {
    const totalWeight = calculateCharacterWeight(c);
    const str = c.abilities?.STR || 10;
    const encLevel = getEncumbranceLevel(totalWeight, str);
    if (encLevel === 'heavy' || encLevel === 'overloaded') {
      const effects = getEncumbranceEffects(encLevel);
      events.push({ type: 'encumbrance', text: `${c.name} is ${encLevel} (${totalWeight} lbs). Speed ×${effects.speedMult}, check penalty ${effects.checkPenalty}.`, severity: 'warning' });
    }
  });

  // 8. Light source tracking — consume torch/lantern duration
  const prefs = worldState?.dmPreferences || {};
  const lightSources = worldState?.activeLightSources || [];
  if (prefs.lightTracking !== false && lightSources.length > 0 && (timeResult.newHour >= 21 || timeResult.newHour <= 5)) {
    const updatedLights = lightSources.map(ls => ({ ...ls, hoursLeft: (ls.hoursLeft || 1) - 1 }));
    const expired = updatedLights.filter(ls => ls.hoursLeft <= 0);
    const remaining = updatedLights.filter(ls => ls.hoursLeft > 0);
    expired.forEach(ls => events.push({ type: 'light', text: `${ls.name || 'Light source'} has burned out!`, severity: 'warning' }));
    if (remaining.length === 0 && expired.length > 0) {
      events.push({ type: 'light', text: 'All light sources exhausted! The party is in darkness. Perception -4, melee -2 (miss chance 50%).', severity: 'danger' });
    }
    worldUpdates.activeLightSources = remaining;
  }

  return { events, worldUpdates, encounter };
}

/**
 * Process a full day of travel (8 hours + checks).
 * Convenience wrapper that calls onTravelHour 8 times.
 */
export function onTravelDay(ctx) {
  const allEvents = [];
  let currentCtx = { ...ctx };
  let encounter = null;
  const allUpdates = {};

  for (let hour = 0; hour < 8; hour++) {
    const result = onTravelHour(currentCtx);
    allEvents.push(...result.events);
    Object.assign(allUpdates, result.worldUpdates);
    currentCtx = { ...currentCtx, worldState: { ...currentCtx.worldState, ...allUpdates } };

    if (result.encounter && !encounter) {
      encounter = result.encounter;
      allEvents.push({ type: 'travel_halt', text: 'Travel interrupted by encounter!', severity: 'danger' });
      break; // Stop travel on encounter
    }
  }

  // Reset travel hours counter at end of day
  allUpdates._travelHoursToday = 0;

  return { events: allEvents, worldUpdates: allUpdates, encounter };
}


// ══════════════════════════════════════════════════════════════════════════════
// COMBAT RESOLUTION — Fired when combat ends
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process all post-combat effects: XP, loot, fame, mythic chaos, NPC reactions.
 *
 * @param {object} ctx - { worldState, party, combat, victory, campaign }
 * @returns {object} { events[], worldUpdates{}, partyUpdates[] }
 */
export function onCombatEnd(ctx) {
  const { worldState, party, combat, victory, campaign } = ctx;
  const events = [];
  const worldUpdates = {};

  if (!victory) {
    // Defeat: increase mythic chaos, potential fame loss
    if (worldState?.mythic) {
      const newChaos = Math.min(9, (worldState.mythic.chaosFactor || 5) + 1);
      worldUpdates.mythic = { ...worldState.mythic, chaosFactor: newChaos };
      events.push({ type: 'mythic', text: `Defeat increases chaos factor to ${newChaos}.`, severity: 'warning' });
    }
    return { events, worldUpdates };
  }

  // Victory effects:

  // 1. Mythic chaos adjustment (victory lowers chaos)
  if (worldState?.mythic) {
    const newChaos = Math.max(1, (worldState.mythic.chaosFactor || 5) - 1);
    worldUpdates.mythic = { ...worldState.mythic, chaosFactor: newChaos };
    events.push({ type: 'mythic', text: `Victory lowers chaos factor to ${newChaos}.`, severity: 'info' });
  }

  // 2. Fame gain for public/significant battles
  const totalCR = (combat?.enemies || []).reduce((s, e) => s + (e.cr || 1), 0);
  const apl = party.length > 0 ? dmTools.calculateAPL(party) : 1;
  if (totalCR >= apl * 1.5 && (worldState?.fame !== undefined)) {
    const fameGain = totalCR >= apl * 3 ? 2 : 1;
    worldUpdates.fame = (worldState.fame || 0) + fameGain;
    events.push({ type: 'fame', text: `Impressive victory! Fame increased by ${fameGain}.`, severity: 'success' });
  }

  // 3. Advance time (combat takes ~1 minute per round, plus post-combat cleanup)
  const combatRounds = combat?.round || 3;
  const minutesSpent = combatRounds + 10; // Combat + looting/healing time
  const hoursSpent = Math.max(1, Math.floor(minutesSpent / 60));
  const timeResult = dmTools.advanceTime(
    worldState?.currentDay || 1,
    worldState?.currentHour || 8,
    hoursSpent
  );
  worldUpdates.currentDay = timeResult.newDay;
  worldUpdates.currentHour = timeResult.newHour;

  // 4. Contact trust boost — if any contacts are associated with defeating these enemies
  const contacts = worldState?.contacts || [];
  if (contacts.length > 0 && totalCR >= apl) {
    events.push({ type: 'contacts', text: 'Your contacts take note of your combat prowess.', severity: 'info' });
  }

  // 5. Honor gain for honorable combat
  if (worldState?.honor && combat?.enemies?.length > 0) {
    const allDefeated = combat.enemies.every(e => e.currentHP <= 0 || e.fled || e.surrendered);
    const noFleeing = !combat.enemies.some(e => e.surrendered && e.currentHP <= 0); // Didn't kill surrendered
    if (allDefeated && noFleeing) {
      events.push({ type: 'honor', text: 'Honorable combat — no dishonor incurred.', severity: 'info' });
    }
  }

  // 6. Kingdom stability (combat near kingdom lands)
  if (worldState?.kingdom) {
    events.push({ type: 'kingdom', text: 'Threats near kingdom borders eliminated.', severity: 'info' });
  }

  // 7. Sanity check for horrific enemies (aberrations, undead, outsiders)
  if (worldState?.dmPreferences?.sanitySys) {
    const horrorTypes = ['aberration', 'undead', 'outsider', 'ooze'];
    const horrificEnemies = (combat?.enemies || []).filter(e =>
      horrorTypes.some(h => (e.type || '').toLowerCase().includes(h))
    );
    if (horrificEnemies.length > 0) {
      const worstCR = Math.max(...horrificEnemies.map(e => e.cr || 1));
      const sanityDC = 10 + Math.floor(worstCR * 1.5);
      events.push({ type: 'sanity', text: `Horrific encounter! All party members must make Will saves (DC ${sanityDC}) or lose 1d4 sanity.`, severity: 'warning' });
    }
  }

  // 8. Alignment tracking — killing helpless/surrendered enemies
  if (worldState?.dmPreferences?.alignmentTracking) {
    const killed = (combat?.enemies || []).filter(e => e.currentHP <= 0);
    const surrendered = killed.filter(e => e.surrendered);
    if (surrendered.length > 0) {
      events.push({ type: 'alignment', text: `Killing ${surrendered.length} surrendered foe(s) — potential alignment shift toward Evil.`, severity: 'warning' });
    }
  }

  return { events, worldUpdates };
}


// ══════════════════════════════════════════════════════════════════════════════
// REST & CAMP — Fired when the party rests
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process resting: time advance, HP recovery, condition durations, encounter checks.
 *
 * @param {object} ctx - { worldState, party, restType, terrain }
 *   restType: 'short' (1 hour), 'long' (8 hours), 'full_day' (24 hours)
 * @returns {object} { events[], worldUpdates{}, partyUpdates[], encounter? }
 */
export function onRest(ctx) {
  const { worldState, party, restType = 'long', terrain = 'plains' } = ctx;
  const events = [];
  const worldUpdates = {};
  const partyUpdates = [];
  let encounter = null;

  const hours = restType === 'short' ? 1 : restType === 'full_day' ? 24 : 8;

  // 1. Advance time
  const timeResult = dmTools.advanceTime(
    worldState?.currentDay || 1,
    worldState?.currentHour || 8,
    hours
  );
  worldUpdates.currentDay = timeResult.newDay;
  worldUpdates.currentHour = timeResult.newHour;
  events.push({ type: 'time', text: `${hours} hours pass. Now day ${timeResult.newDay}, ${timeResult.newHour}:00.`, severity: 'info' });

  // 2. Generate new weather if day changed
  if (timeResult.newDay !== (worldState?.currentDay || 1)) {
    const season = getSeasonFromDay(timeResult.newDay);
    const weather = worldSvc.generateWeather('temperate', season, timeResult.newDay);
    worldUpdates.currentWeather = weather;
    events.push({ type: 'weather', text: `New day: ${weather.description}`, severity: 'info' });
  }

  // 3. HP recovery
  if (restType === 'long' || restType === 'full_day') {
    const hpPerNight = restType === 'full_day' ? 2 : 1; // 1 HP/level per night, 2 for full day
    party.forEach(c => {
      const level = c.level || 1;
      const recovery = level * hpPerNight;
      const newHP = Math.min((c.maxHP || c.hp || 10), (c.currentHP || 0) + recovery);
      if (newHP > (c.currentHP || 0)) {
        partyUpdates.push({ id: c.id, currentHP: newHP });
        events.push({ type: 'heal', text: `${c.name} recovers ${recovery} HP (now ${newHP}/${c.maxHP || c.hp}).`, severity: 'heal' });
      }
    });
  }

  // 4. Condition duration ticks
  party.forEach(c => {
    if (c.conditions?.length > 0) {
      const expiring = c.conditions.filter(cond => cond.duration && cond.duration <= hours);
      if (expiring.length > 0) {
        events.push({ type: 'condition', text: `${c.name}: ${expiring.map(c2 => c2.name).join(', ')} expired.`, severity: 'info' });
      }
    }
  });

  // 5. Affliction progression (poison, disease)
  const afflictions = worldState?.afflictions || [];
  afflictions.forEach(aff => {
    if (aff.nextCheck && aff.nextCheck <= timeResult.newDay) {
      events.push({ type: 'affliction', text: `${aff.target} must make a saving throw against ${aff.name} (DC ${aff.dc}).`, severity: 'warning' });
    }
  });

  // 6. Random encounter during rest (night watch)
  if (restType === 'long' && terrain !== 'urban') {
    // 3 watch shifts, each has encounter chance
    for (let watch = 0; watch < 3; watch++) {
      const watchHour = (worldState?.currentHour || 20) + watch * 3;
      const tod = overland.getTimeOfDay(watchHour % 24);
      const check = overland.checkEncounter(terrain, tod);
      if (check.encountered) {
        encounter = check;
        events.push({ type: 'encounter', text: `Watch ${watch + 1}: ${check.description}`, severity: 'danger' });
        break; // Only one encounter per rest
      }
    }
    if (!encounter) {
      events.push({ type: 'rest', text: 'The night passes uneventfully.', severity: 'info' });
    }
  }

  // 7. Crafting progress (downtime during rest)
  const craftingQueue = worldState?.craftingQueue || [];
  if (craftingQueue.length > 0 && restType !== 'short') {
    const craftHours = restType === 'full_day' ? 8 : 2; // Can craft during some of rest time
    events.push({ type: 'crafting', text: `${craftHours} hours of crafting progress on ${craftingQueue[0]?.name || 'current project'}.`, severity: 'info' });
  }

  // 8. Spell slot recovery (PF1e: full rest recovers all spell slots)
  if (restType === 'long' || restType === 'full_day') {
    party.forEach(c => {
      const usedSlots = c.spellSlotsUsed || {};
      const hasUsedSlots = Object.values(usedSlots).some(v => v > 0);
      if (hasUsedSlots) {
        partyUpdates.push({ id: c.id, spellSlotsUsed: {} });
        events.push({ type: 'spells', text: `${c.name}'s spell slots are restored. Prepared casters may change their spell selection.`, severity: 'info' });
      }
    });
  }

  // 9. Ability damage recovery (PF1e: 1 point per ability per night, 2 with full day bed rest)
  if (restType === 'long' || restType === 'full_day') {
    const recoveryPerAbility = restType === 'full_day' ? 2 : 1;
    party.forEach(c => {
      const damage = c.abilityDamage || {};
      const hasDamage = Object.values(damage).some(v => v > 0);
      if (hasDamage) {
        const newDamage = {};
        const recovered = [];
        Object.entries(damage).forEach(([ability, amt]) => {
          if (amt > 0) {
            const newAmt = Math.max(0, amt - recoveryPerAbility);
            newDamage[ability] = newAmt;
            recovered.push(`${ability} ${recoveryPerAbility} (now ${newAmt} damage)`);
          }
        });
        partyUpdates.push({ id: c.id, abilityDamage: newDamage });
        events.push({ type: 'recovery', text: `${c.name} recovers ability damage: ${recovered.join(', ')}.`, severity: 'heal' });
      }
    });
  }

  // 10. Sanity recovery check (if sanity system is active)
  if ((restType === 'long' || restType === 'full_day') && worldState?.dmPreferences?.sanitySys) {
    party.forEach(c => {
      const sanity = c.sanity || {};
      if (sanity.current !== undefined && sanity.current < (sanity.max || 100)) {
        // Small passive recovery on restful nights (no encounter)
        if (!encounter) {
          const recovery = restType === 'full_day' ? 2 : 1;
          const newSanity = Math.min(sanity.max || 100, sanity.current + recovery);
          partyUpdates.push({ id: c.id, sanity: { ...sanity, current: newSanity } });
          events.push({ type: 'sanity', text: `${c.name} recovers ${recovery} sanity in peaceful rest (now ${newSanity}/${sanity.max}).`, severity: 'info' });
        }
      }
    });
  }

  // 11. Reset daily travel hours
  worldUpdates._travelHoursToday = 0;

  return { events, worldUpdates, partyUpdates, encounter };
}


// ══════════════════════════════════════════════════════════════════════════════
// SETTLEMENT ARRIVAL — Fired when party enters a town/city
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process arriving at a settlement: apply settlement stats to shop,
 * set available services, adjust NPC attitudes based on fame.
 *
 * @param {object} ctx - { worldState, party, settlementId, settlementData }
 * @returns {object} { events[], worldUpdates{}, settlementInfo }
 */
export function onSettlementArrival(ctx) {
  const { worldState, party, settlementId, settlementData } = ctx;
  const events = [];
  const worldUpdates = {};

  // 1. Get or generate settlement stats
  let settlement = settlementData;
  if (!settlement && settlementId) {
    settlement = dmTools.generateSettlement(null); // Generate based on location data
  }
  if (!settlement) {
    settlement = { name: 'Unknown Settlement', size: 'village', baseValue: 500, purchaseLimit: 2500, spellcasting: 3 };
  }

  events.push({ type: 'arrival', text: `Arrived at ${settlement.name} (${settlement.size}).`, severity: 'info' });

  // 2. Available services based on settlement size
  const spellcasting = settlement.spellcasting || dmTools.getAvailableSpellcasting(settlement)?.maxLevel || 0;
  if (spellcasting > 0) {
    events.push({ type: 'services', text: `Spellcasting services available up to level ${spellcasting}.`, severity: 'info' });
  }

  // 3. Base value and purchase limit
  events.push({ type: 'shop', text: `Base value: ${settlement.baseValue || 0} gp. Purchase limit: ${settlement.purchaseLimit || 0} gp.`, severity: 'info' });

  // 4. NPC attitudes based on party fame
  const fame = worldState?.fame || 0;
  let defaultAttitude = 'indifferent';
  if (fame >= 30) defaultAttitude = 'friendly';
  else if (fame >= 15) defaultAttitude = 'indifferent';
  else if (fame < -10) defaultAttitude = 'unfriendly';

  const infamy = worldState?.infamy || 0;
  if (infamy > fame) {
    defaultAttitude = infamy > 20 ? 'hostile' : 'unfriendly';
    events.push({ type: 'reputation', text: `Your infamy precedes you. Townsfolk are ${defaultAttitude}.`, severity: 'warning' });
  } else if (fame >= 15) {
    events.push({ type: 'reputation', text: `Your fame is known here. Townsfolk are ${defaultAttitude}.`, severity: 'success' });
  }

  // 5. Settlement danger level — chance of crime/events
  if (settlement.danger && settlement.danger > 5) {
    events.push({ type: 'danger', text: `This settlement has a danger rating of ${settlement.danger}. Watch your purses.`, severity: 'warning' });
  }

  // 6. Store current settlement in worldState for shop/service integration
  worldUpdates.currentSettlement = {
    ...settlement,
    arrivedDay: worldState?.currentDay || 1,
    defaultAttitude,
  };

  // 7. Calendar-based events (holidays, festivals)
  const currentMonth = Math.floor(((worldState?.currentDay || 1) - 1) / 30);
  const holidays = dmTools.getHolidaysForMonth(currentMonth);
  const currentDayOfMonth = ((worldState?.currentDay || 1) - 1) % 30 + 1;
  const activeHolidays = (holidays || []).filter(h => h.day && Math.abs(h.day - currentDayOfMonth) <= 2);
  if (activeHolidays.length > 0) {
    activeHolidays.forEach(h => {
      events.push({ type: 'holiday', text: `${h.name} is being celebrated! ${h.description || ''}`, severity: 'info' });
    });
  }

  return { events, worldUpdates, settlement };
}


// ══════════════════════════════════════════════════════════════════════════════
// CAMPAIGN PROGRESSION — Fired when chapters/encounters complete
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process campaign milestone: auto-generate quests, adjust difficulty, narrative hooks.
 *
 * @param {object} ctx - { worldState, party, campaign, completedEncounter, chapter, part }
 * @returns {object} { events[], worldUpdates{}, autoQuests[] }
 */
export function onCampaignMilestone(ctx) {
  const { worldState, party, campaign, completedEncounter, chapter, part } = ctx;
  const events = [];
  const worldUpdates = {};
  const autoQuests = [];

  // 1. Check if all encounters in current part are done
  const partEncounters = part?.encounters || [];
  const completed = campaign?.completedEncounters || [];
  const partComplete = partEncounters.every(e => completed.includes(e.id));

  if (partComplete) {
    events.push({ type: 'milestone', text: `Section complete: ${part?.name}!`, severity: 'success' });

    // Generate story award XP
    const apl = party.length > 0 ? dmTools.calculateAPL(party) : 1;
    const storyAward = dmTools.calculateStoryAward('minorQuest', apl, party.length);
    events.push({ type: 'xp', text: `Story award: ${storyAward.totalXP} XP for completing ${part?.name}.`, severity: 'loot' });
  }

  // 2. Check if entire chapter is done
  const chapterParts = chapter?.parts || [];
  const chapterComplete = chapterParts.every(p =>
    p.encounters.every(e => completed.includes(e.id) || e.id === completedEncounter?.id)
  );

  if (chapterComplete) {
    events.push({ type: 'milestone', text: `Chapter complete: ${chapter?.name}!`, severity: 'success' });

    // Major quest completion XP
    const apl = party.length > 0 ? dmTools.calculateAPL(party) : 1;
    const majorAward = dmTools.calculateStoryAward('majorQuest', apl, party.length);
    events.push({ type: 'xp', text: `Major milestone: ${majorAward.totalXP} XP for completing ${chapter?.name}!`, severity: 'loot' });

    // Fame increase for chapter completion
    worldUpdates.fame = (worldState?.fame || 0) + 3;
    events.push({ type: 'fame', text: 'Your deeds are becoming legendary. Fame +3.', severity: 'success' });
  }

  // 3. Auto-generate quests from upcoming encounters
  if (part?.encounters) {
    const nextIncomplete = part.encounters.filter(e => !completed.includes(e.id));
    nextIncomplete.forEach(enc => {
      if (enc.type === 'combat' && enc.cr >= (party[0]?.level || 1)) {
        autoQuests.push({
          title: enc.name,
          description: enc.description || `Defeat ${enc.enemies?.map(e => e.name).join(', ') || 'the enemies'}.`,
          type: 'main',
          objectives: enc.enemies ? enc.enemies.map(e => ({ text: `Defeat ${e.name}`, done: false })) : [{ text: 'Complete encounter', done: false }],
        });
      }
    });
  }

  // 4. Plot twist injection (random chance on milestone)
  if (partComplete && Math.random() < 0.15) {
    const twist = dmTools.generatePlotTwist();
    events.push({ type: 'plot', text: `Plot development: ${twist.twist}`, severity: 'info' });
  }

  return { events, worldUpdates, autoQuests };
}


// ══════════════════════════════════════════════════════════════════════════════
// DOWNTIME — Fired during extended downtime periods
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process a downtime day: building progress, crafting, organization income,
 * trade route profits, contact interactions, kingdom turns.
 *
 * @param {object} ctx - { worldState, party, daysToProcess }
 * @returns {object} { events[], worldUpdates{} }
 */
export function onDowntimeDay(ctx) {
  const { worldState, party, daysToProcess = 1 } = ctx;
  const events = [];
  const worldUpdates = {};

  for (let day = 0; day < daysToProcess; day++) {
    // 1. Advance calendar
    const timeResult = dmTools.advanceTime(
      (worldState?.currentDay || 1) + day,
      8, // Start at 8 AM
      24
    );

    // 2. Building income
    const buildings = worldState?.ownedBuildings || [];
    if (buildings.length > 0) {
      let dailyIncome = 0;
      buildings.forEach(b => {
        dailyIncome += b.income || 0;
      });
      if (dailyIncome > 0 && day === daysToProcess - 1) {
        events.push({ type: 'income', text: `Buildings generate ${dailyIncome * daysToProcess} gp over ${daysToProcess} days.`, severity: 'loot' });
      }
    }

    // 3. Trade route profits
    const routes = worldState?.tradeRoutes || [];
    if (routes.length > 0 && day === daysToProcess - 1) {
      let tradeProfits = 0;
      routes.forEach(r => {
        tradeProfits += r.dailyProfit || 0;
      });
      if (tradeProfits > 0) {
        events.push({ type: 'trade', text: `Trade routes earn ${tradeProfits * daysToProcess} gp over ${daysToProcess} days.`, severity: 'loot' });
      }
    }

    // 4. Organization checks (once per week)
    if (((worldState?.currentDay || 1) + day) % 7 === 0) {
      const orgs = worldState?.organizations || [];
      orgs.forEach(org => {
        events.push({ type: 'org', text: `${org.name}: Weekly check due. Current loyalty: ${org.loyalty || 0}.`, severity: 'info' });
      });
    }

    // 5. Kingdom turn (once per month / 30 days)
    if (((worldState?.currentDay || 1) + day) % 30 === 0 && worldState?.kingdom) {
      events.push({ type: 'kingdom', text: `Kingdom turn! ${worldState.kingdom.name || 'Your kingdom'} requires attention — Upkeep, Edict, Income, and Event phases.`, severity: 'warning' });
    }

    // 6. Contact maintenance — contacts may drift if not maintained
    if (((worldState?.currentDay || 1) + day) % 14 === 0) {
      const contacts = worldState?.contacts || [];
      contacts.forEach(c => {
        if ((c.trust || 0) > 1) {
          events.push({ type: 'contact', text: `Contact ${c.name} hasn't heard from you — trust may decrease without interaction.`, severity: 'warning' });
        }
      });
    }
  }

  // Update final day
  worldUpdates.currentDay = (worldState?.currentDay || 1) + daysToProcess;
  worldUpdates.currentHour = 8;

  return { events, worldUpdates };
}


// ══════════════════════════════════════════════════════════════════════════════
// LEVEL UP — Fired when a character has enough XP
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process level-up effects: HP increase, new abilities, class features.
 *
 * @param {object} ctx - { character, newLevel, worldState }
 * @returns {object} { events[], characterUpdates{} }
 */
export function onLevelUp(ctx) {
  const { character, newLevel, worldState } = ctx;
  const events = [];
  const characterUpdates = { level: newLevel };

  events.push({ type: 'levelup', text: `${character.name} reaches level ${newLevel}!`, severity: 'success' });

  // HP increase (roll hit die + CON mod)
  const conMod = Math.floor(((character.abilities?.CON || 10) - 10) / 2);
  const hitDice = { 'Barbarian': 12, 'Fighter': 10, 'Paladin': 10, 'Ranger': 10, 'Cleric': 8, 'Rogue': 8, 'Monk': 8, 'Druid': 8, 'Bard': 8, 'Wizard': 6, 'Sorcerer': 6 };
  const die = hitDice[character.className] || 8;
  const hpRoll = Math.max(1, roll(die) + conMod);
  characterUpdates.maxHP = (character.maxHP || character.hp || 10) + hpRoll;
  characterUpdates.currentHP = (character.currentHP || character.hp || 10) + hpRoll;
  events.push({ type: 'hp', text: `${character.name} gains ${hpRoll} HP (${die > 0 ? `d${die}` : '?'}+${conMod} CON).`, severity: 'info' });

  // Ability score increase at 4, 8, 12, 16, 20
  if (newLevel % 4 === 0) {
    events.push({ type: 'ability', text: `${character.name} gains +1 to an ability score!`, severity: 'success' });
  }

  // Feat at odd levels (PF1e: 1, 3, 5, 7...)
  if (newLevel % 2 === 1) {
    events.push({ type: 'feat', text: `${character.name} gains a new feat!`, severity: 'success' });
  }

  // Skill ranks
  events.push({ type: 'skills', text: `${character.name} gains skill ranks to assign.`, severity: 'info' });

  // NPC gear budget reference
  const gearBudget = dmTools.getNPCGearBudget(newLevel);
  if (gearBudget) {
    events.push({ type: 'gear', text: `Expected wealth at level ${newLevel}: ${gearBudget.total || gearBudget} gp.`, severity: 'info' });
  }

  return { events, characterUpdates };
}


// ══════════════════════════════════════════════════════════════════════════════
// SHOP TRANSACTION — Fired when buying/selling
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Validate and process a purchase against settlement limits.
 *
 * @param {object} ctx - { worldState, item, settlement }
 * @returns {object} { allowed, reason, events[] }
 */
export function onShopTransaction(ctx) {
  const { worldState, item, settlement } = ctx;
  const events = [];
  const currentSettlement = settlement || worldState?.currentSettlement;

  if (!currentSettlement) {
    return { allowed: true, reason: 'No settlement restrictions.', events: [] };
  }

  // Check against base value
  const baseValue = currentSettlement.baseValue || 200;
  if (item.price > baseValue) {
    const availability = dmTools.checkItemAvailability(item.price, currentSettlement);
    if (!availability.available) {
      events.push({ type: 'shop', text: `${item.name} (${item.price} gp) exceeds ${currentSettlement.name}'s base value. ${availability.chance}% chance of availability.`, severity: 'warning' });
      // Roll for availability
      if (roll(100) > availability.chance) {
        return { allowed: false, reason: `${item.name} is not available in ${currentSettlement.name}.`, events };
      }
    }
  }

  // Check purchase limit
  if (item.price > (currentSettlement.purchaseLimit || 10000)) {
    return { allowed: false, reason: `${item.name} exceeds ${currentSettlement.name}'s purchase limit of ${currentSettlement.purchaseLimit} gp.`, events };
  }

  return { allowed: true, reason: 'Item available.', events };
}


// ══════════════════════════════════════════════════════════════════════════════
// DUNGEON EXPLORATION — Fired each time the party enters a new room/area
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process entering a new dungeon room: trap detection, haunt detection,
 * perception checks, light source management.
 *
 * @param {object} ctx - { worldState, party, room, dungeonLevel }
 * @returns {object} { events[], worldUpdates{}, trap?, haunt?, encounter? }
 */
export function onDungeonExplore(ctx) {
  const { worldState, party, room = 0, dungeonLevel = 1 } = ctx;
  const events = [];
  const worldUpdates = {};
  let trap = null, haunt = null, encounter = null;

  // 1. Advance time by 10 minutes (1 turn per room, PF1e standard)
  const currentDay = worldState?.currentDay || 1;
  const currentHour = worldState?.currentHour || 8;
  const minutesPassed = (worldState?._dungeonMinutes || 0) + 10;
  if (minutesPassed >= 60) {
    const timeResult = dmTools.advanceTime(currentDay, currentHour, 1);
    worldUpdates.currentDay = timeResult.newDay;
    worldUpdates.currentHour = timeResult.newHour;
    worldUpdates._dungeonMinutes = minutesPassed - 60;
  } else {
    worldUpdates._dungeonMinutes = minutesPassed;
  }

  // 2. Trap detection — auto-roll Perception for the party's best searcher
  const dPrefs = worldState?.dmPreferences || {};
  const trapChance = 0.15 + dungeonLevel * 0.03; // Higher level dungeons = more traps
  if (dPrefs.trapsAndHaunts !== false && Math.random() < trapChance) {
    const trapTemplates = worldSvc.getTrapTemplates?.() || [];
    if (trapTemplates.length > 0) {
      const eligibleTraps = trapTemplates.filter(t => (t.cr || 1) <= dungeonLevel + 2);
      const trapTemplate = eligibleTraps.length > 0
        ? eligibleTraps[Math.floor(Math.random() * eligibleTraps.length)]
        : trapTemplates[0];

      // Best Perception check in party
      const bestPerceiver = party.reduce((best, c) => {
        const percMod = (c.skillRanks?.Perception || 0) + Math.floor(((c.abilities?.WIS || 10) - 10) / 2);
        return percMod > (best.mod || -99) ? { char: c, mod: percMod } : best;
      }, { mod: -99 });

      if (bestPerceiver.char) {
        const percRoll = roll(20) + bestPerceiver.mod;
        const detected = percRoll >= (trapTemplate.perceptionDC || 20);
        if (detected) {
          events.push({ type: 'trap', text: `${bestPerceiver.char.name} spots a trap! ${trapTemplate.name} (CR ${trapTemplate.cr || '?'}, Disable DC ${trapTemplate.disableDC || '?'}).`, severity: 'warning' });
          trap = { ...trapTemplate, detected: true };
        } else {
          // Trap triggers!
          events.push({ type: 'trap', text: `A ${trapTemplate.name} triggers! ${trapTemplate.effect || 'The trap activates.'}`, severity: 'danger' });
          trap = { ...trapTemplate, detected: false, triggered: true };
        }
      }
    }
  }

  // 3. Haunt detection (undead/cursed areas)
  const hauntChance = dungeonLevel >= 3 ? 0.08 + dungeonLevel * 0.02 : 0;
  if (dPrefs.trapsAndHaunts !== false && !trap && Math.random() < hauntChance) {
    const hauntTemplates = worldSvc.getHauntTemplates?.() || [];
    if (hauntTemplates.length > 0) {
      const hauntTemplate = hauntTemplates[Math.floor(Math.random() * hauntTemplates.length)];
      events.push({ type: 'haunt', text: `The air grows deathly cold. ${hauntTemplate.name || 'A haunt'} manifests! (Notice DC ${hauntTemplate.noticeDC || 20}, HP ${hauntTemplate.hp || 'varies'}).`, severity: 'danger' });
      haunt = hauntTemplate;

      // Sanity check for haunts
      if (worldState?.dmPreferences?.sanitySys) {
        events.push({ type: 'sanity', text: `Supernatural horror! Will save DC ${12 + dungeonLevel} or lose 1d4 sanity.`, severity: 'warning' });
      }
    }
  }

  // 4. Random dungeon encounter (separate from traps/haunts)
  if (!trap && !haunt && Math.random() < 0.12) {
    const encounterResult = overland.checkEncounter('dungeon', 'underground');
    if (encounterResult.encountered) {
      encounter = encounterResult;
      events.push({ type: 'encounter', text: `Room ${room + 1}: ${encounterResult.description}`, severity: 'danger' });
    }
  }

  // 5. Light source consumption (torches burn 1 hour, lanterns 6 hours)
  const dungeonLights = worldState?.activeLightSources || [];
  if (dPrefs.lightTracking !== false && dungeonLights.length > 0) {
    // Every 6 rooms (1 hour of exploration), tick down
    if ((room + 1) % 6 === 0) {
      const updatedLights = dungeonLights.map(ls => ({ ...ls, hoursLeft: (ls.hoursLeft || 1) - 1 }));
      const expired = updatedLights.filter(ls => ls.hoursLeft <= 0);
      const remaining = updatedLights.filter(ls => ls.hoursLeft > 0);
      expired.forEach(ls => events.push({ type: 'light', text: `${ls.name || 'Light source'} has burned out!`, severity: 'warning' }));
      worldUpdates.activeLightSources = remaining;
    }
  }

  // 6. Passive room description if nothing happened
  if (!trap && !haunt && !encounter && events.length === 0) {
    events.push({ type: 'explore', text: `Room ${room + 1}: The party enters cautiously. No immediate threats detected.`, severity: 'info' });
  }

  return { events, worldUpdates, trap, haunt, encounter };
}


// ══════════════════════════════════════════════════════════════════════════════
// DOWNTIME AUTO-PROCESSING — Fires kingdom/org/contact mechanics automatically
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Enhanced downtime processing that auto-runs kingdom turns, org checks,
 * and contact maintenance instead of just logging warnings.
 */
export function onDowntimeDayFull(ctx) {
  const { worldState, party, daysToProcess = 1 } = ctx;
  // Start with base downtime processing
  const base = onDowntimeDay(ctx);
  const events = [...base.events];
  const worldUpdates = { ...base.worldUpdates };

  const startDay = worldState?.currentDay || 1;

  // Auto-process kingdom turns when monthly boundary is crossed
  if (worldState?.kingdom) {
    for (let day = 0; day < daysToProcess; day++) {
      if ((startDay + day) % 30 === 0) {
        try {
          const kingdom = { ...worldState.kingdom };
          const result = downtimeService.processKingdomTurn(kingdom);
          worldUpdates.kingdom = kingdom;
          result.phases.forEach(p => {
            events.push({ type: 'kingdom', text: `[Kingdom Turn] ${p.phase}: ${p.description}`, severity: p.phase === 'Event' ? 'warning' : 'info' });
          });
        } catch (e) {
          events.push({ type: 'kingdom', text: `Kingdom turn processing error: ${e.message}`, severity: 'danger' });
        }
      }
    }
  }

  // Auto-process organization loyalty checks (weekly)
  const orgs = worldState?.organizations || [];
  if (orgs.length > 0) {
    for (let day = 0; day < daysToProcess; day++) {
      if ((startDay + day) % 7 === 0) {
        orgs.forEach(org => {
          const loyaltyRoll = roll(20);
          const dc = 10 + Math.floor(org.size || 1);
          const success = loyaltyRoll >= dc;
          if (!success) {
            events.push({ type: 'org', text: `${org.name} loyalty check failed (${loyaltyRoll} vs DC ${dc}). Loyalty decreases by 1.`, severity: 'warning' });
          } else {
            events.push({ type: 'org', text: `${org.name} remains loyal (${loyaltyRoll} vs DC ${dc}).`, severity: 'info' });
          }
        });
      }
    }
  }

  // Auto-process contact trust decay (biweekly)
  const contacts = worldState?.contacts || [];
  if (contacts.length > 0) {
    const updatedContacts = [...contacts];
    let contactsChanged = false;
    for (let day = 0; day < daysToProcess; day++) {
      if ((startDay + day) % 14 === 0) {
        updatedContacts.forEach((c, i) => {
          if ((c.trust || 0) > 1) {
            updatedContacts[i] = { ...c, trust: c.trust - 1 };
            contactsChanged = true;
            events.push({ type: 'contact', text: `Contact ${c.name}'s trust decreased to ${c.trust - 1} (no interaction for 2 weeks).`, severity: 'warning' });
          }
        });
      }
    }
    if (contactsChanged) {
      worldUpdates.contacts = updatedContacts;
    }
  }

  // Auto-tick building construction progress
  const buildings = worldState?.ownedBuildings || [];
  if (buildings.length > 0) {
    const updatedBuildings = buildings.map(b => {
      if (!b.completed && b.daysLeft > 0) {
        const newDays = Math.max(0, b.daysLeft - daysToProcess);
        if (newDays === 0 && b.daysLeft > 0) {
          events.push({ type: 'income', text: `Construction complete: ${b.name} is now operational!`, severity: 'success' });
        }
        return { ...b, daysLeft: newDays, completed: newDays === 0 };
      }
      return b;
    });
    worldUpdates.ownedBuildings = updatedBuildings;
  }

  return { events, worldUpdates };
}


// ══════════════════════════════════════════════════════════════════════════════
// ENCOUNTER TYPE DETECTION — Auto-routes to verbal duel, skill challenge, etc.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Analyzes an encounter and determines if it should route to a specialty system
 * (verbal duel, skill challenge, chase) instead of standard combat.
 *
 * @param {object} ctx - { encounter, party, worldState }
 * @returns {object} { encounterType, events[], setup? }
 */
export function onEncounterStart(ctx) {
  const { encounter, party, worldState } = ctx;
  const events = [];
  let encounterType = 'combat'; // default
  let setup = null;

  if (!encounter) return { encounterType, events, setup };

  const encType = (encounter.type || '').toLowerCase();
  const encName = (encounter.name || '').toLowerCase();
  const encDesc = (encounter.description || '').toLowerCase();

  // Detect verbal duel scenarios
  if (encType === 'social' || encType === 'verbal_duel' ||
      encDesc.includes('debate') || encDesc.includes('negotiate') || encDesc.includes('verbal duel') ||
      encDesc.includes('court') || encDesc.includes('trial') || encDesc.includes('argument')) {
    encounterType = 'verbal_duel';
    const determination = party.reduce((best, c) => {
      const cha = Math.floor(((c.abilities?.CHA || 10) - 10) / 2);
      const sen = Math.floor(((c.abilities?.WIS || 10) - 10) / 2);
      const det = cha + sen + (c.level || 1);
      return det > best.det ? { char: c, det } : best;
    }, { det: -99 });
    events.push({ type: 'encounter', text: `This is a verbal duel! ${determination.char?.name || 'A party member'} will represent the group (Determination: ${determination.det}).`, severity: 'info' });
    setup = { type: 'verbal_duel', champion: determination.char, determination: determination.det };
  }

  // Detect skill challenge scenarios
  else if (encType === 'skill_challenge' || encType === 'puzzle' ||
           encDesc.includes('skill challenge') || encDesc.includes('puzzle') ||
           encDesc.includes('collapsing') || encDesc.includes('ritual') || encDesc.includes('disable') ||
           encDesc.includes('defuse') || encDesc.includes('escape room')) {
    encounterType = 'skill_challenge';
    const complexity = encounter.cr >= 10 ? 5 : encounter.cr >= 5 ? 3 : 2;
    const successesNeeded = complexity * 2;
    events.push({ type: 'encounter', text: `Skill challenge! Need ${successesNeeded} successes before 3 failures. Complexity ${complexity}.`, severity: 'info' });
    setup = { type: 'skill_challenge', complexity, successesNeeded, failuresAllowed: 3 };
  }

  // Detect chase scenarios
  else if (encType === 'chase' ||
           encDesc.includes('chase') || encDesc.includes('fleeing') || encDesc.includes('pursuit') ||
           encDesc.includes('running away') || encDesc.includes('escape')) {
    encounterType = 'chase';
    const cards = 8 + Math.floor(Math.random() * 5); // 8-12 cards
    events.push({ type: 'encounter', text: `A chase begins! ${cards} obstacle cards to overcome.`, severity: 'info' });
    setup = { type: 'chase', cards, currentCard: 0, partyPosition: 0, quarryPosition: 2 };
  }

  // Standard combat
  else {
    events.push({ type: 'encounter', text: `Combat encounter: ${encounter.name || 'Unknown threat'}!`, severity: 'danger' });
  }

  return { encounterType, events, setup };
}


// ══════════════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Calculate total carried weight for a character */
function calculateCharacterWeight(character) {
  let total = 0;
  // Equipment weight
  (character.equipment || []).forEach(item => {
    if (item?.weight) total += item.weight * (item.quantity || 1);
  });
  // Inventory weight
  (character.inventory || []).forEach(item => {
    total += (item.weight || 0) * (item.quantity || 1);
  });
  // Gold weight (50 coins = 1 lb)
  total += Math.floor((character.gold || 0) / 50);
  return total;
}

function getSeasonFromDay(day) {
  const month = Math.floor((day - 1) / 30);
  if (month <= 1 || month >= 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'fall';
}

/**
 * Apply worldUpdates to worldState immutably.
 * Convenience for components calling setWorldState.
 */
export function applyWorldUpdates(prevState, updates) {
  const newState = { ...prevState };
  for (const [key, value] of Object.entries(updates)) {
    if (key.startsWith('_')) continue; // Skip internal keys
    if (typeof value === 'object' && !Array.isArray(value) && value !== null && prevState[key]) {
      newState[key] = { ...prevState[key], ...value };
    } else {
      newState[key] = value;
    }
  }
  return newState;
}

/**
 * Process events into log entries for addLog.
 * Maps event types to log categories.
 */
export function eventsToLog(events) {
  const typeMap = {
    weather: 'info', encounter: 'danger', rations: 'info', visibility: 'warning',
    fatigue: 'warning', travel_halt: 'danger', mythic: 'info', fame: 'success',
    time: 'info', contacts: 'info', honor: 'info', kingdom: 'info',
    heal: 'heal', condition: 'info', affliction: 'warning', rest: 'info',
    crafting: 'info', arrival: 'system', services: 'info', shop: 'info',
    reputation: 'info', danger: 'warning', holiday: 'info', milestone: 'success',
    xp: 'loot', plot: 'info', income: 'loot', trade: 'loot', org: 'info',
    contact: 'warning', levelup: 'success', hp: 'info', ability: 'success',
    feat: 'success', skills: 'info', gear: 'info',
    // New system types
    encumbrance: 'warning', light: 'warning', spells: 'info', recovery: 'heal',
    sanity: 'warning', alignment: 'warning', trap: 'danger', haunt: 'danger',
    explore: 'info',
  };
  return events.map(e => ({
    text: e.text,
    type: typeMap[e.type] || 'info',
  }));
}


export default {
  onTravelHour,
  onTravelDay,
  onCombatEnd,
  onRest,
  onSettlementArrival,
  onCampaignMilestone,
  onDowntimeDay,
  onDowntimeDayFull,
  onLevelUp,
  onShopTransaction,
  onDungeonExplore,
  onEncounterStart,
  applyWorldUpdates,
  eventsToLog,
};
