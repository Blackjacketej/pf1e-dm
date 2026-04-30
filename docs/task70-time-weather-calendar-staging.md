# Task #70 — Time + Weather + Calendar Epic: Staging Doc

**Status:** staging / plan-only (no code changes yet)
**Filed:** 2026-04-19
**Precedes:** implementation slices to be broken out as #70a / #70b / …

---

## Problem statement

Operator report: *"No time is elapsing in the game."*

The calendar plumbing exists (`src/services/calendar.js` owns the full Golarion
model — year/month/day/hour/minute with month-length cascade, DOW derivation,
holidays, `advanceWorldTime`, `advanceCombatRound`, `CAMPAIGN_START_DATES` seed,
Bug #44 one-time migration). `CalendarDisplay` renders the current date in the
AdventureTab header. But the clock only ticks from **two places**:

1. **Overland travel** (`AdventureTab.switchToNodePath` line ~2417) — calls
   `advanceWorldTime(prev, travelPlan.totalHours * 60)` when
   `travelPlan.totalHours > 0`.
2. **Rest** (`AdventureTab.handleRest` line 1713) — delegates to
   `gameEvents.onRest` which writes `worldUpdates.currentDay` /
   `currentHour` via the **older** `dmToolsService.advanceTime` path (not
   `calendar.advanceWorldTime`).

Everything else is a clock no-op. A full day of dialogue, shopping, skill
checks, and combat yields zero in-world time.

---

## Audit findings (call-site inventory)

### Gap (a) — Narrative actions don't tick the clock

Four handlers in `AdventureTab.jsx` call `dmEngine.narrate()` but never touch
`worldState`:

| Handler | Line | Action shape | Proposed duration |
|---|---|---|---|
| `handleCustomAction` | 1866 | Free-text player input; action vs. question | 5 min default, 1 min for questions/lookups |
| `handlePartyCompoundAction` | 1941 | Multi-character combined action | 10 min (parallel actions aggregate) |
| `handleTalkToNPC` | 2691 | Approach + converse with specific NPC | 5 min conversation baseline |
| `handleContextAction` | 2950 | Click suggested action chip (social/skill/combat/explore) | Depends on `action.type`: social=5, skill=3, combat=0 (combat enters CombatTab), explore=10 |

**Important:** `handleCustomAction` already has an `isQuestion` classifier
(line 1886) that distinguishes "What's the smith's name?" from "I break down
the door." Questions should be cheap (1 min passive perception / recall);
actions should be heavier (5 min default). Reuse this classifier for the
duration heuristic.

### Gap (b) — Combat rounds don't tick the clock

`CombatTab.nextTurn` (line 1567) increments `combat.round` but never calls
`setWorldState`. A 10-round fight = 0 world minutes today. PF1e round is 6s,
so a 10-round fight should be 60s which rounds up to 1 minute via
`advanceWorldTime`'s sub-minute ceiling.

**Where to tick:** inside the `if (nextIdx === 0 && newRound > round)` block
at line 1583 — the "start of new round" branch. One tick per round boundary.

`calendar.advanceCombatRound(worldState, 1)` already exists for this
(calendar.js line 232). Just wire it in.

### Gap (c) — Rest handlers use the old (broken) time path

`handleRest` (line 1713) calls `gameEvents.onRest({…restType})` which
internally calls `dmToolsService.advanceTime(currentDay, currentHour, hours)`.
That helper has a **latent bug**: `advanceTime` starts `month=0, year=0`
internally (dmToolsService.js:1421-1422) and never reads the incoming
month/year, so it returns bogus deltas disguised as absolutes. The rest
handler then writes *only* `currentDay` and `currentHour` back to worldUpdates,
which means:

- Cross-month rests break silently. Resting on **Rova 30** (last day, 30 days)
  increments currentDay to **31** — an invalid Rova date — without rolling
  the month.
- `currentMinute` is never written back, so if the party ended a combat at
  10:07, resting 8 hours produces 18:07 via the calendar helper but 18:**00**
  via this path — the minute drops.
- `currentYear`, `currentMonth` never advance.

**Fix proposal:** two options —
  - (c1) Swap `handleRest` to `advanceWorldTime(prev, { hours: restHours })`
    and keep the `gameEvents.onRest` call purely for healing/condition/
    encounter cascades (strip the time-advance portion from onRest, or leave
    it as dead overwrite — calendar.advanceWorldTime output takes precedence).
  - (c2) Fix `dmToolsService.advanceTime` to read the incoming month/year and
    cascade properly. Lower-impact but doesn't unify the two time systems.

Recommendation: **c1**. Unify on `calendar.advanceWorldTime` as the one writer,
leave `gameEvents.onRest` for event generation only. Same pattern that the
overland travel path already uses.

### Gap (d) — In-town sibling travel yields 0 hours

`overlandTravel.calculateTravelPlan` computes `hours = miles * (hoursPerDay /
effMiles)` per segment. For in-town sibling nodes (Main Road → Cathedral
Square), `estimateSegmentMiles(a, b)` returns 0 (shared hex/coords), every
segment yields `hours: 0`, total is 0, and the `if (travelPlan.totalHours >
0)` gate in `switchToNodePath` (line 2411) short-circuits — no clock advance.

**Fix proposal:** add a per-hop floor. Either:
  - (d1) Inside `calculateTravelPlan`, floor each non-zero-segment at
    `MIN_HOP_MINUTES / 60` hours (say 5 minutes).
  - (d2) In `switchToNodePath`, if the path crosses any sibling boundary but
    `totalHours === 0`, advance by `5 * pathLength` minutes as a floor.

Recommendation: **d2**. Keeps the pure overland-travel math clean. Siblings of
kind `town-district` / `town-building` / `town-room` get a floor; real
overland segments (has miles) keep their computed hours.

### Gap (e) — Weather only generates on overland/rest day-change

`gameEventEngine.onTravel` and `onRest` both call
`worldSvc.generateWeather(…)` when `dayChanged` — but these are the only
paths. A town-only campaign (party lingers in Sandpoint for 5 in-game days
doing shopping and rumor-gathering) will never roll weather. `worldState
.currentWeather` stays `null` and `CombatTab`'s weather badge (line 1657)
stays blank.

**Fix proposal:** after every `advanceWorldTime` patch is applied, check if
the day rolled over (compare `prev.currentDay/currentMonth/currentYear` vs.
the new values). If yes, generate weather using climate derived from the
active node's terrain (`activeNode?.terrain || 'temperate'`) and season from
`getSeason(currentMonth)`. Wrap this in a single helper (`tickClock` below)
so every call-site gets it for free.

### Gap (f) — Calendar-driven downstream consumers

Not behavioral bugs, but the next wave of things that become possible once
the clock ticks reliably:

- **NPC day/night availability.** `worldState.currentHour` is already read by
  `gameEventEngine.onTravel` (timeOfDay, line 62), but NPCs don't yet have
  schedules. Shops could be "closed 20:00–06:00", temples "morning service
  07:00–09:00", etc.
- **Shop hours / rumor decay.** Same mechanism.
- **Festival windows.** `calendar.getActiveHolidays(worldState, 2)` already
  returns holidays within +/- 2 days. `CalendarDisplay` shows them; narration
  should too (narrate() could inject "Today is the Swallowtail Festival" into
  the prompt context).
- **Time-bounded quests.** "You have three days before the wedding" —
  quest.js could stamp `dueAt: {year, month, day}` and compare.

All of these are deferred to follow-up tasks; they sit on top of the
foundation that #70a–e lay.

---

## Proposed architecture: `tickClock` helper

A single chokepoint for all time advances. Everything funnels through it so
day-rollover, weather regen, and future downstream hooks (NPC schedules,
quest timers) only need to be added in one place.

```js
// src/services/clockTick.js (new)
import { advanceWorldTime, getDateInfo, getSeason } from './calendar';
import { generateWeather } from './worldService';

/**
 * Advance the world clock and fire any derived side-effects.
 *
 * @param {object} worldState   current snapshot (pass prev from setWorldState)
 * @param {object} opts
 *   - minutes:   advance this many minutes (or use seconds/hours/days)
 *   - cause:     short string for logs ('combat-round', 'talk', 'rest', …)
 *   - terrain:   node terrain for weather regen ('forest','plains',…)
 *   - onDayChange: optional callback(prevDate, newDate) for day-rollover hook
 * @returns {object} { ...worldState patch, events: [{text, type}] }
 */
export function tickClock(worldState, opts = {}) {
  const prev = getDateInfo(worldState);
  const patch = advanceWorldTime(worldState, opts);
  if (!patch.currentYear) return { patch: {}, events: [] };  // no-op
  const next = getDateInfo({ ...worldState, ...patch });
  const events = [];

  const dayChanged = (
    prev.year !== next.year ||
    prev.month !== next.month ||
    prev.day !== next.day
  );

  if (dayChanged) {
    // regenerate weather
    const climate = opts.climate || 'temperate';
    const season = getSeason(next.month).toLowerCase();
    const weather = generateWeather(climate, season, next.day);
    patch.currentWeather = weather;
    events.push({ text: `Weather turns: ${weather.description}`, type: 'info' });
  }

  return { patch, events };
}
```

Call-site becomes one line per spot:
```js
const { patch, events } = tickClock(worldState, { minutes: 5, cause: 'talk' });
setWorldState(prev => ({ ...prev, ...patch }));
events.forEach(e => addLog?.(e.text, e.type));
```

---

## Slice-out into sub-tasks

Pick up as separate implementation tickets; each is independently shippable
and verify-able:

- **#70a — `clockTick` helper + unit tests.** Pure function, 6 tests
  (no-op, minute advance, day rollover fires weather, month rollover fires
  weather, year rollover fires weather, no-regen when weather-system pref
  disabled).
- **#70b — Narrative-action ticks.** Wire `tickClock` into handleCustomAction
  (5 min action / 1 min question), handleTalkToNPC (5 min), handleContext-
  Action (action.type-keyed), handlePartyCompoundAction (10 min). Single
  PR, 4 call-site edits.
- **#70c — Combat-round ticks.** `CombatTab.nextTurn` → `advanceCombatRound`
  on the round-boundary branch. One call site.
- **#70d — Unify rest on calendar.advanceWorldTime.** Rewire `handleRest` to
  call `tickClock({hours: 1})` / `tickClock({hours: 8})` and strip the time
  portion from `gameEvents.onRest` (or route through it without the
  `worldUpdates.currentDay/Hour` writes). Keep the healing/encounter cascade.
  One call site + one service edit.
- **#70e — In-town travel floor.** Post-totalHours check in
  `switchToNodePath`: if `totalHours === 0` and `path.length > 1`, tick
  `5 * (path.length - 1)` minutes. One call site.
- **#70f — Migration + CalendarDisplay polish (stretch).** Backfill
  `currentMinute = 0` on pre-#70 saves; confirm CalendarDisplay re-renders
  on minute-level advance; consider a `— now` timestamp delta in the
  tooltip ("1h 32m since last event"). Optional.

Suggested shipping order: **a → b → c → d → e**. Each unlocks the next
without dependency bootstrapping; (a) is pure and test-covered so the later
slices land with confidence.

---

## Non-goals for #70

- NPC schedules / shop hours / festival narration injection → future task.
- Time-bounded quest state → future task.
- Re-seeding CAMPAIGN_START_DATES for non-RotRL APs → add as new entries when
  those APs land.
- Audio narration (#4 stale), calendar/seasons sim beyond weather (#15
  partial) — these predate #70 and will fold into the downstream tasks.
- Reworking `dmToolsService.advanceTime` as a public API — it's used only
  inside `gameEventEngine`; once #70d removes that coupling, `advanceTime`
  can be deprecated in a later cleanup pass.

---

## Sanity checks before we ship any slice

- `npx vite build` on Windows (per `feedback_sandbox_mount_lag.md`).
- Smoke path: fresh RotRL save → open AdventureTab → confirm start date is
  Rova 23, 4707 AR, 10:00. Say "I ask Ameiko about the festival" — clock
  should tick to 10:05 after narrate resolves. Enter combat, advance 3
  rounds, leave — clock should read 10:06 (5 + ceil(18s)=1 min). Long rest
  — clock should read 18:06 and weather description should refresh.
- Regression: verify the existing overland-travel tick still fires with the
  new `tickClock` helper (the current direct `advanceWorldTime` call in
  switchToNodePath can migrate to `tickClock` in slice #70b or stay as-is
  until a later unification pass).
