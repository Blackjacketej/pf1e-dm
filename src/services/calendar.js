/**
 * calendar.js — Golarion (Absalom Reckoning) calendar for the PF1e DM app.
 *
 * Single source of truth for in-world date/time math. Wraps the raw
 * `calendarAndTimekeeping.golarionMonths` data shipped in dmToolsData.json
 * and normalizes it against the app's worldState.currentDay / currentHour
 * fields.
 *
 * worldState shape (all fields optional — getDateInfo fills in sensible
 * defaults if a save predates this service):
 *   currentYear:   Absalom Reckoning year (integer, default 4716 AR — the
 *                  Rise of the Runelords campaign start year)
 *   currentMonth:  0-based month index (0 = Abadius, 11 = Kuthona)
 *   currentDay:    1-based day-of-month (1..daysInMonth)
 *   currentHour:   0..23
 *   currentMinute: 0..59 (optional; defaults to 0)
 *   currentSecond: 0..59 (optional; defaults to 0) — added by Task #79 so
 *                  combat rounds (6s) and tactical intra-building hops tick
 *                  at PF1e canonical resolution. Pre-#79 saves get 0-backfilled
 *                  by App.jsx; advanceWorldTime returns `currentSecond` in
 *                  every patch once the field is present.
 *
 * Related (pre-existing):
 *   - dmToolsService.advanceTime was broken: it read
 *     `calendarAndTimekeeping.months` but the data key is `golarionMonths`.
 *     Use advanceWorldTime() below as the authoritative forward-marching
 *     helper.
 *   - gameEventEngine.getSeasonFromDay(day) treats `day` as an absolute
 *     cumulative count. This module keeps month/day separate and derives
 *     season from the month, which matches the actual Golarion convention.
 */

import dmToolsData from '../data/dmToolsData.json';

const MONTHS = (dmToolsData?.calendarAndTimekeeping?.golarionMonths || []).slice();

// daysOfWeek in dmToolsData ships as objects: [{day: 'Moonday', association: '...'}, ...].
// Normalize to plain strings so consumers (JSX in particular) get a renderable
// value. Bug #39 — rendering the raw object exploded with "Objects are not
// valid as a React child (found: object with keys {day, association})".
const _RAW_DOW = dmToolsData?.calendarAndTimekeeping?.daysOfWeek;
// Exported for CalendarPanel's week-header row (Task #78, calendar popup).
export const DAYS_OF_WEEK = Array.isArray(_RAW_DOW) && _RAW_DOW.length > 0
  ? _RAW_DOW.map(d => (typeof d === 'string' ? d : (d && d.day) || 'Unknown'))
  : ['Moonday', 'Toilday', 'Wealday', 'Oathday', 'Fireday', 'Starday', 'Sunday'];

const MAJOR_HOLIDAYS = dmToolsData?.calendarAndTimekeeping?.majorHolidays || [];

// Rise of the Runelords campaign opens at the Swallowtail Festival:
// Rova 23, 4707 AR (per AP #1 Burnt Offerings). Sticking with 4716 AR as a
// generic default for non-AP campaigns. The campaign start hook can override
// these via campaign.startDate if needed.
//
// 2026-04-20 — hour bumped 8 → 10 per operator: open-world campaigns should
// open mid-morning (matches canonical AP openers like RotR's 10:00 Swallowtail
// start). Campaign-specific starts still override this via CAMPAIGN_START_DATES.
export const DEFAULT_START = Object.freeze({
  year: 4716,
  month: 0,   // Abadius
  day: 1,
  hour: 10,
  minute: 0,
  second: 0,
});

/**
 * Canonical in-world start dates by campaign id.
 *
 * Bug #44 (2026-04-17): worldState date fields weren't being seeded when a
 * campaign booted, so every save opened on the DEFAULT_START (Abadius 1,
 * 4716 AR) regardless of the AP's actual opening scene. CampaignSelector now
 * seeds currentYear/currentMonth/currentDay/currentHour/currentMinute from
 * this map; App.jsx runs a one-time silent migration on existing saves that
 * still show DEFAULT_START for a campaign with a known canonical date.
 *
 * month is 0-based (0 = Abadius, 8 = Rova, 11 = Kuthona).
 */
export const CAMPAIGN_START_DATES = Object.freeze({
  // Rise of the Runelords — Burnt Offerings opens during the Swallowtail
  // Festival in Sandpoint on Rova (9th month) 23, 4707 AR. Festival begins
  // mid-morning; seeding 10:00 so the party has a realistic window before
  // the goblin raid (afternoon).
  'rise-of-the-runelords': Object.freeze({
    year: 4707,
    month: 8,   // Rova
    day: 23,
    hour: 10,
    minute: 0,
    second: 0,
  }),
});

/**
 * Return the canonical start date for a campaign id, or DEFAULT_START if the
 * campaign isn't in CAMPAIGN_START_DATES. Never returns null — callers can
 * always spread it into worldState.
 */
export function getCampaignStartDate(campaignId) {
  if (campaignId && CAMPAIGN_START_DATES[campaignId]) {
    return { ...CAMPAIGN_START_DATES[campaignId] };
  }
  return { ...DEFAULT_START };
}

/**
 * True if a worldState date is identical to DEFAULT_START. Used by the #44
 * migration to decide whether a save is still on the unseeded default.
 */
export function isDefaultStartDate(worldState = {}) {
  const d = getDateInfo(worldState);
  return (
    d.year === DEFAULT_START.year &&
    d.month === DEFAULT_START.month &&
    d.day === DEFAULT_START.day &&
    d.hour === DEFAULT_START.hour &&
    d.minute === DEFAULT_START.minute
  );
}

export function getMonths() {
  return MONTHS.slice();
}

export function getMonth(monthIndex) {
  const idx = ((monthIndex % 12) + 12) % 12;
  const m = MONTHS[idx];
  if (!m) return { name: 'Unknown', number: idx + 1, season: 'Unknown', daysInMonth: 30 };
  return { ...m, monthIndex: idx };
}

export function getSeason(monthIndex) {
  return getMonth(monthIndex).season || 'Unknown';
}

/**
 * Extract a normalized date/time snapshot from worldState.
 * Missing fields fall back to DEFAULT_START so pre-calendar saves still
 * render a sensible display.
 */
export function getDateInfo(worldState = {}) {
  const year = Number.isFinite(worldState.currentYear) ? worldState.currentYear : DEFAULT_START.year;
  const month = Number.isFinite(worldState.currentMonth) ? worldState.currentMonth : DEFAULT_START.month;
  const day = Number.isFinite(worldState.currentDay) ? worldState.currentDay : DEFAULT_START.day;
  const hour = Number.isFinite(worldState.currentHour) ? worldState.currentHour : DEFAULT_START.hour;
  const minute = Number.isFinite(worldState.currentMinute) ? worldState.currentMinute : 0;
  // Task #79 — sub-minute tracking so combat rounds (6s) advance the clock
  // at PF1e canonical resolution instead of being rounded up to 1 minute.
  // Defaults to 0 for pre-#79 saves; App.jsx migration writes the field
  // explicitly once so `_minuteBackfilled`-style idempotence holds.
  const second = Number.isFinite(worldState.currentSecond) ? worldState.currentSecond : 0;

  const mInfo = getMonth(month);
  return {
    year, month, day, hour, minute, second,
    monthName: mInfo.name,
    season: mInfo.season,
    daysInMonth: mInfo.daysInMonth || 30,
    description: mInfo.description || '',
    dayOfWeek: getDayOfWeek(year, month, day),
  };
}

/**
 * Deterministic day-of-week based on cumulative day count since Year 0.
 * Golarion uses a 7-day week; treating Abadius 1 of year 0 as Moonday.
 */
export function getDayOfWeek(year, monthIndex, day) {
  let absDays = 0;
  for (let y = 0; y < year; y++) {
    for (let m = 0; m < MONTHS.length; m++) {
      absDays += MONTHS[m]?.daysInMonth || 30;
    }
  }
  for (let m = 0; m < monthIndex; m++) {
    absDays += MONTHS[m]?.daysInMonth || 30;
  }
  absDays += (day - 1);
  return DAYS_OF_WEEK[absDays % DAYS_OF_WEEK.length];
}

function pad2(n) { return String(n).padStart(2, '0'); }

export function formatDate(worldState = {}, { includeTime = true, includeSeconds = false } = {}) {
  const d = getDateInfo(worldState);
  const dateStr = `${d.monthName} ${d.day}, ${d.year} AR`;
  if (!includeTime) return dateStr;
  const timeStr = includeSeconds
    ? `${pad2(d.hour)}:${pad2(d.minute)}:${pad2(d.second)}`
    : `${pad2(d.hour)}:${pad2(d.minute)}`;
  return `${dateStr} — ${timeStr}`;
}

export function formatShort(worldState = {}, { includeSeconds = false } = {}) {
  const d = getDateInfo(worldState);
  const timeStr = includeSeconds
    ? `${pad2(d.hour)}:${pad2(d.minute)}:${pad2(d.second)}`
    : `${pad2(d.hour)}:${pad2(d.minute)}`;
  return `${d.monthName} ${d.day} · ${timeStr}`;
}

/**
 * Immutable forward-march of the world clock. Returns a partial worldState
 * update suitable for `setWorldState(prev => ({ ...prev, ...advanceWorldTime(prev, mins) }))`.
 *
 * Accepts either a minutes number OR an options object with seconds/minutes/
 * hours/days fields.
 *
 * Task #79 (2026-04-19) — sub-minute tracking. Previously `Math.ceil`-ed any
 * sub-minute increment up to 1 full minute, which silently inflated combat
 * rounds 10× (6s → 1min). Now seconds cascade cleanly through the existing
 * minute→hour→day chain using a new worldState.currentSecond field. A bare-
 * number argument is still interpreted as MINUTES for back-compat with the
 * dozen or so legacy call sites that predate the options-object form.
 */
export function advanceWorldTime(worldState = {}, durationOrOpts = 0) {
  let addSeconds = 0;
  if (typeof durationOrOpts === 'number') {
    // Legacy shorthand: bare number = minutes, for back-compat.
    addSeconds = durationOrOpts * 60;
  } else if (durationOrOpts && typeof durationOrOpts === 'object') {
    const {
      seconds = 0,
      rounds = 0,   // PF1e rounds — 6 seconds each. Convenience shorthand.
      minutes = 0,
      hours = 0,
      days = 0,
    } = durationOrOpts;
    addSeconds = seconds + rounds * 6 + minutes * 60 + hours * 3600 + days * 86400;
  }
  if (!Number.isFinite(addSeconds) || addSeconds <= 0) {
    return {}; // no-op
  }

  const cur = getDateInfo(worldState);
  let { year, month, day, hour, minute, second } = cur;

  // Integerize the incoming delta — sub-second precision isn't something
  // any call-site wants, and fractional accumulation would desync currentSecond
  // from the always-integer minute/hour/day fields.
  second += Math.round(addSeconds);
  minute += Math.floor(second / 60);
  second = second % 60;
  hour += Math.floor(minute / 60);
  minute = minute % 60;
  day += Math.floor(hour / 24);
  hour = hour % 24;

  // Cascade day → month → year using actual month lengths.
  // Guard against infinite loops on malformed data by capping at 10000
  // iterations (≈ 830 years of carry — handles deep time-skip GM jumps).
  let iter = 0;
  while (iter++ < 10000) {
    const daysThisMonth = (MONTHS[month]?.daysInMonth) || 30;
    if (day <= daysThisMonth) break;
    day -= daysThisMonth;
    month += 1;
    if (month >= 12) { month = 0; year += 1; }
  }

  return {
    currentYear: year,
    currentMonth: month,
    currentDay: day,
    currentHour: hour,
    currentMinute: minute,
    currentSecond: second,
  };
}

/**
 * Round-trip a combat round (6 seconds in PF1e). Caller still owns merging
 * the returned patch into worldState.
 *
 * Task #79 — rounds now cascade into currentSecond; pre-#79 this was ceil-
 * rounded to 1 minute per round (10× inflation).
 */
export function advanceCombatRound(worldState = {}, rounds = 1) {
  return advanceWorldTime(worldState, { rounds });
}

/**
 * Holidays active within +/- windowDays of the current date. The shipped
 * data stores holidays as {name, date: "Month DayOrRange", description};
 * parse defensively and return an empty array if the string doesn't match.
 */
export function getActiveHolidays(worldState = {}, windowDays = 2) {
  const { month, day } = getDateInfo(worldState);
  const monthName = (MONTHS[month]?.name || '').toLowerCase();
  const matches = [];
  for (const h of MAJOR_HOLIDAYS) {
    if (!h?.date || typeof h.date !== 'string') continue;
    const parts = h.date.split(/\s+/);
    if (parts.length < 2) continue;
    const holidayMonth = parts[0].toLowerCase();
    if (holidayMonth !== monthName) continue;
    // parts[1] might be "23" or "15-17" or "15" or "15 (approximate)"
    const dayTok = parts[1].replace(/[^0-9-]/g, '');
    let startDay, endDay;
    if (dayTok.includes('-')) {
      const [a, b] = dayTok.split('-').map(n => parseInt(n, 10));
      startDay = a; endDay = b;
    } else {
      startDay = parseInt(dayTok, 10);
      endDay = startDay;
    }
    if (!Number.isFinite(startDay)) continue;
    if (day >= startDay - windowDays && day <= (endDay || startDay) + windowDays) {
      matches.push({ ...h, daysAway: Math.max(0, startDay - day) });
    }
  }
  return matches;
}

/**
 * Holidays that fall inside a given month, parsed into structured
 * {name, dayStart, dayEnd, description} records for grid rendering.
 * Defensive: silently drops rows whose date string doesn't parse.
 * Called by CalendarPanel to mark holiday cells on the month grid.
 */
export function getHolidaysInMonth(monthIndex) {
  const monthName = (MONTHS[monthIndex]?.name || '').toLowerCase();
  if (!monthName) return [];
  const out = [];
  for (const h of MAJOR_HOLIDAYS) {
    if (!h?.date || typeof h.date !== 'string') continue;
    const parts = h.date.split(/\s+/);
    if (parts.length < 2) continue;
    if (parts[0].toLowerCase() !== monthName) continue;
    const dayTok = parts[1].replace(/[^0-9-]/g, '');
    let dayStart, dayEnd;
    if (dayTok.includes('-')) {
      const [a, b] = dayTok.split('-').map(n => parseInt(n, 10));
      dayStart = a; dayEnd = b;
    } else {
      dayStart = parseInt(dayTok, 10);
      dayEnd = dayStart;
    }
    if (!Number.isFinite(dayStart)) continue;
    out.push({
      name: h.name,
      dayStart,
      dayEnd: Number.isFinite(dayEnd) ? dayEnd : dayStart,
      description: h.description || '',
      approximate: /approximate/i.test(h.date),
    });
  }
  return out;
}

export default {
  DEFAULT_START,
  CAMPAIGN_START_DATES,
  DAYS_OF_WEEK,
  getCampaignStartDate,
  isDefaultStartDate,
  getMonths,
  getMonth,
  getSeason,
  getDateInfo,
  getDayOfWeek,
  formatDate,
  formatShort,
  advanceWorldTime,
  advanceCombatRound,
  getActiveHolidays,
  getHolidaysInMonth,
};
