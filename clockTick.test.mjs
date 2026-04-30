// clockTick.test.mjs — Task #70a (2026-04-19) coverage.
//
// Verifies the src/services/clockTick.js foundation helper: pure forward-
// march of the in-world clock plus derived side-effects (day-change weather
// regen, preference-gated mute). Blocks #70b/c/d/e so keep these tests
// authoritative about the patch shape consumers will rely on.
//
// Covers:
//   - No-op when duration is zero or missing.
//   - Minute-level advance with no day rollover produces a time patch but
//     no weather event.
//   - Day rollover (same month/year) fires weather regen + a log event.
//   - Month rollover (last day of Abadius → Calistril 1) fires weather.
//   - Year rollover (Kuthona 31, 4716 → Abadius 1, 4717) fires weather.
//   - dmPreferences.weatherSystem === false mutes the regen entirely, even
//     on a day-change, so operators can turn weather off campaign-wide.
//
// Run: npx vite-node clockTick.test.mjs

import { tickClock } from './src/services/clockTick.js';

let passed = 0;
let failed = 0;
const fails = [];

function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`\u2713 ${name}`);
  } catch (err) {
    failed += 1;
    fails.push({ name, err });
    console.error(`\u2717 ${name}\n  ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'expected equal'}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// ─────────────────────────────────────── fixtures

// Rova 23, 4707 AR 10:00 — matches CAMPAIGN_START_DATES['rise-of-the-runelords']
// so the tests track a real-world save shape, not a synthetic one.
const ROTRL_START = {
  currentYear: 4707,
  currentMonth: 8,   // Rova
  currentDay: 23,
  currentHour: 10,
  currentMinute: 0,
};

// Abadius 31, 4716 AR 23:30 — one minute before month rollover to Calistril 1.
const MONTH_EDGE = {
  currentYear: 4716,
  currentMonth: 0,   // Abadius (31 days)
  currentDay: 31,
  currentHour: 23,
  currentMinute: 30,
};

// Kuthona 31, 4716 AR 23:30 — last minute of the year. +60 min → Abadius 1, 4717.
const YEAR_EDGE = {
  currentYear: 4716,
  currentMonth: 11,  // Kuthona (31 days)
  currentDay: 31,
  currentHour: 23,
  currentMinute: 30,
};

// ─────────────────────────────────────── tests

t('T1 no-op: duration missing returns empty patch + empty events', () => {
  const { patch, events } = tickClock(ROTRL_START, {});
  assertEq(Object.keys(patch).length, 0, 'patch should be empty');
  assertEq(events.length, 0, 'events should be empty');
});

t('T1b no-op: zero minutes returns empty patch + empty events', () => {
  const { patch, events } = tickClock(ROTRL_START, { minutes: 0 });
  assertEq(Object.keys(patch).length, 0, 'patch should be empty');
  assertEq(events.length, 0, 'events should be empty');
});

t('T2 minute advance with no day change: time ticks, no weather event', () => {
  const { patch, events } = tickClock(ROTRL_START, { minutes: 5 });
  assertEq(patch.currentYear, 4707, 'year unchanged');
  assertEq(patch.currentMonth, 8, 'month unchanged');
  assertEq(patch.currentDay, 23, 'day unchanged');
  assertEq(patch.currentHour, 10, 'hour unchanged');
  assertEq(patch.currentMinute, 5, 'minute advanced by 5');
  assert(!('currentWeather' in patch), 'no weather in patch on same-day tick');
  assertEq(events.length, 0, 'no events on same-day tick');
});

t('T3 day rollover fires weather regen + log event', () => {
  // 23:30 + 60 min = 00:30 next day, same month, same year.
  const start = { ...ROTRL_START, currentHour: 23, currentMinute: 30 };
  const { patch, events } = tickClock(start, { minutes: 60 });
  assertEq(patch.currentDay, 24, 'day rolled to 24');
  assertEq(patch.currentHour, 0, 'hour wrapped to 0');
  assertEq(patch.currentMinute, 30, 'minute carried');
  assert('currentWeather' in patch, 'weather regenerated on day change');
  assert(patch.currentWeather !== null, 'weather non-null');
  assertEq(events.length, 1, 'one weather event');
  assertEq(events[0].type, 'info', 'weather event is info-type');
  assert(events[0].text.toLowerCase().startsWith('weather'), 'event mentions weather');
});

t('T4 month rollover (Abadius 31 → Calistril 1) fires weather', () => {
  const { patch, events } = tickClock(MONTH_EDGE, { minutes: 60 });
  assertEq(patch.currentMonth, 1, 'month rolled to Calistril (1)');
  assertEq(patch.currentDay, 1, 'day reset to 1');
  assertEq(patch.currentYear, 4716, 'year unchanged within the same year');
  assert('currentWeather' in patch, 'weather regenerated on month rollover');
  assertEq(events.length, 1, 'one weather event on month rollover');
});

t('T5 year rollover (Kuthona 31, 4716 → Abadius 1, 4717) fires weather', () => {
  const { patch, events } = tickClock(YEAR_EDGE, { minutes: 60 });
  assertEq(patch.currentYear, 4717, 'year rolled to 4717');
  assertEq(patch.currentMonth, 0, 'month reset to Abadius (0)');
  assertEq(patch.currentDay, 1, 'day reset to 1');
  assert('currentWeather' in patch, 'weather regenerated on year rollover');
  assertEq(events.length, 1, 'one weather event on year rollover');
});

t('T5b combat round (seconds: 6) rounds up to 1 minute, no day change → no weather', () => {
  // Task #70c sanity check — `tickClock(ws, {seconds:6})` is the path
  // CombatTab.nextTurn uses at each round boundary. advanceWorldTime
  // applies a sub-minute ceiling so 6s rounds up to +1min, which is
  // the behavior we want for CalendarDisplay to visibly tick forward.
  const { patch, events } = tickClock(ROTRL_START, { seconds: 6 });
  assertEq(patch.currentYear, 4707, 'year unchanged');
  assertEq(patch.currentMonth, 8, 'month unchanged');
  assertEq(patch.currentDay, 23, 'day unchanged');
  assertEq(patch.currentHour, 10, 'hour unchanged');
  assertEq(patch.currentMinute, 1, 'minute advanced by 1 (ceil of 6s)');
  assert(!('currentWeather' in patch), 'no weather on same-day round tick');
  assertEq(events.length, 0, 'no events on same-day round tick');
});

t('T6 weatherSystem pref = false mutes regen on day-change', () => {
  const start = {
    ...ROTRL_START,
    currentHour: 23,
    currentMinute: 30,
    dmPreferences: { weatherSystem: false },
  };
  const { patch, events } = tickClock(start, { minutes: 60 });
  assertEq(patch.currentDay, 24, 'day still rolls');
  assert(!('currentWeather' in patch), 'weather NOT regenerated when pref disabled');
  assertEq(events.length, 0, 'no weather event when pref disabled');
});

// ─────────────────────────────────────── summary

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of fails) {
    console.error(`  - ${f.name}: ${f.err.message}`);
  }
  process.exit(1);
}
