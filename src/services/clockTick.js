/**
 * clockTick.js — single chokepoint for advancing the in-world clock.
 *
 * Every call-site that wants to move time forward should go through
 * `tickClock(worldState, opts)` instead of calling `advanceWorldTime` directly.
 * Centralizing lets us attach derived side-effects (day-change weather regen,
 * future NPC-schedule notifications, quest-timer checks) in one place.
 *
 * Returns a `{patch, events}` pair:
 *   - `patch` is the partial worldState to merge via `setWorldState(prev =>
 *     ({...prev, ...patch}))`. Empty object means no-op.
 *   - `events` is an array of `{text, type}` log entries the caller can pipe
 *     into `addLog`. Empty array when nothing narration-worthy happened.
 *
 * Intentionally NOT a React hook: this is a pure helper so the same logic can
 * run from tests, services, and reducers.
 *
 * Task #70a (2026-04-19) — foundation for the Time + Weather + Calendar epic.
 * See docs/task70-time-weather-calendar-staging.md for the full design.
 */

import { advanceWorldTime, getDateInfo, getSeason } from './calendar';
import { generateWeather } from './worldService';

// worldMechanics.json uses lowercase season keys with 'fall' instead of
// 'autumn'. calendar.getSeason returns capitalized values from dmToolsData
// ('Winter' | 'Spring' | 'Summer' | 'Autumn'). Normalize here so the
// weather-generator lookup doesn't silently fall through to default temps.
const SEASON_NORMALIZE = {
  winter: 'winter',
  spring: 'spring',
  summer: 'summer',
  autumn: 'fall',
  fall: 'fall',
};

function normalizeSeason(seasonLabel) {
  const key = String(seasonLabel || '').trim().toLowerCase();
  return SEASON_NORMALIZE[key] || 'summer';
}

/**
 * Advance the world clock and collect any derived events.
 *
 * @param {object} worldState  Current snapshot — pass `prev` from the setter.
 * @param {object} opts
 *   - rounds / seconds / minutes / hours / days: duration to advance. At least
 *     one required (zero or missing → no-op). `rounds` is PF1e convenience
 *     shorthand for 6 seconds each (Task #79).
 *   - cause:    optional short string ('combat-round','talk','rest',...) —
 *     currently unused but reserved for future logging hooks.
 *   - climate:  climate zone key for weather regen ('temperate' default).
 *   - weatherEnabled: override for `worldState.dmPreferences.weatherSystem`.
 *     Default behavior: regen weather on day-change UNLESS the pref is
 *     explicitly `false`.
 * @returns {{patch: object, events: Array<{text:string,type:string}>}}
 */
export function tickClock(worldState = {}, opts = {}) {
  // Extract duration — support either a bare minutes number or the
  // calendar.advanceWorldTime options object, so callers can write
  // `tickClock(ws, 5)` or `tickClock(ws, {rounds: 1})` or {minutes: 5}.
  let advanceArg;
  if (typeof opts === 'number') {
    advanceArg = opts;
  } else {
    const { rounds = 0, seconds = 0, minutes = 0, hours = 0, days = 0 } = opts || {};
    if (!rounds && !seconds && !minutes && !hours && !days) {
      // caller passed something like {cause:'foo'} but no duration — no-op
      return { patch: {}, events: [] };
    }
    advanceArg = { rounds, seconds, minutes, hours, days };
  }

  const prev = getDateInfo(worldState);
  const patch = advanceWorldTime(worldState, advanceArg);

  // advanceWorldTime returns {} only when the duration is zero/invalid.
  // Bail out cleanly — no time passed, nothing derived should fire.
  if (!patch || !('currentYear' in patch)) {
    return { patch: {}, events: [] };
  }

  const next = getDateInfo({ ...worldState, ...patch });
  const events = [];

  const dayChanged = (
    prev.year !== next.year ||
    prev.month !== next.month ||
    prev.day !== next.day
  );

  // Weather regen on day-change. Respects the per-campaign preference flag
  // that existing gameEventEngine.onTravel already honors, so toggling
  // "weather system" off in Settings mutes both old and new paths.
  const prefWeather = worldState?.dmPreferences?.weatherSystem;
  const weatherEnabled = (opts && opts.weatherEnabled !== undefined)
    ? Boolean(opts.weatherEnabled)
    : prefWeather !== false;

  if (dayChanged && weatherEnabled) {
    const climate = (opts && opts.climate) || 'temperate';
    const season = normalizeSeason(getSeason(next.month));
    const weather = generateWeather(climate, season, next.day);
    if (weather) {
      patch.currentWeather = weather;
      events.push({
        text: `Weather: ${weather.description || 'clear skies'}`,
        type: 'info',
      });
    }
  }

  return { patch, events };
}

export default { tickClock };
