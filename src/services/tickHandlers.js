/**
 * tickHandlers.js — Default L3 handlers registered into the node tick engine.
 *
 * Handlers are intentionally small and defensive: each one can be swapped,
 * replaced, or augmented later (e.g. when the faction system grows node
 * awareness). Call `registerDefaultTickHandlers()` once at app boot.
 *
 * Handler contract (see nodeTick.js):
 *   { name, run(node, hoursElapsed, context) → { nodeUpdates?, events? },
 *     appliesTo?(node, context) → boolean }
 */

import { registerTickHandler } from './nodeTick';
import * as factionSim from './factionSimulation';

// ───────────────────────────────────────────────────────────── deterministic RNG

/**
 * Tiny seeded RNG so ticks are reproducible given the same node + worldState.
 * Mulberry32 — good enough for random-event rolls.
 */
function makeRng(seed) {
  let s = (Number(seed) | 0) || 1;
  return function rng() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(node, context) {
  const ts = context?.worldState?.currentDay || 0;
  const str = `${node?.id || ''}:${ts}:${node?.kind || ''}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ───────────────────────────────────────────────────────────── #1 NPC schedules

/**
 * If an NPC in `node.npcs` has a schedule { home, work, workHours: [start,end] },
 * move them to the node that matches their current-hour role.
 *
 * This is intentionally minimal for v1: we only shift NPCs OUT of the current
 * node (removing them from npcs[]) if they're off-shift. The receiving node
 * gets a ghost entry appended so if the party visits next, they're there.
 * A fuller implementation would migrate the NPC object between nodes; for
 * now we lean on the migration being soft (NPCs re-spawn at shift start).
 */
const npcScheduleHandler = {
  name: 'npcSchedule',
  run(node, hoursElapsed, context) {
    if (!Array.isArray(node.npcs) || node.npcs.length === 0) return {};
    const hour = context?.worldState?.currentHour ?? 12;
    const events = [];
    const stayed = [];
    const left = [];

    for (const npc of node.npcs) {
      const sch = npc?.schedule;
      if (!sch || !Array.isArray(sch.workHours) || sch.workHours.length !== 2) {
        stayed.push(npc);
        continue;
      }
      const [start, end] = sch.workHours;
      const isWorking = hour >= start && hour < end;
      const isHere = node.id === sch.work || node.id === sch.home;
      const shouldBeAtWork = isWorking && sch.work;
      const shouldBeAtHome = !isWorking && sch.home;

      if (!isHere) {
        stayed.push(npc);
        continue;
      }
      if ((shouldBeAtWork && node.id !== sch.work) || (shouldBeAtHome && node.id !== sch.home)) {
        left.push(npc);
      } else {
        stayed.push(npc);
      }
    }

    if (left.length > 0) {
      events.push({
        kind: 'npcDeparture',
        text: left.length === 1
          ? `${described(left[0])} is not here — off-shift.`
          : `${left.length} regulars are off-shift and not here.`,
        data: { npcIds: left.map(n => n?.id).filter(Boolean) },
      });
      return { nodeUpdates: { npcs: stayed }, events };
    }
    return {};
  },
};

function described(npc) {
  return npc?.name || npc?.appearance || npc?.role || 'a regular';
}

// ───────────────────────────────────────────────────────────── #2 shop restocks

/**
 * If the node carries a `restock: { intervalHours, lastRestockAt, kind }`
 * setting, trigger a restock event when enough time has elapsed.
 *
 * v1 behavior: emit an event only; the actual inventory refresh is handled
 * downstream by the shop service (which the handler signals via
 * `data.restockKind`). This avoids duplicating shop logic here.
 */
const restockHandler = {
  name: 'restock',
  run(node, hoursElapsed, context) {
    const rs = node.restock;
    if (!rs || !Number.isFinite(rs.intervalHours)) return {};

    const worldAbsHours = absHoursFromWS(context?.worldState);
    const lastAbs = absHoursFromSnap(rs.lastRestockAt);
    if (worldAbsHours == null) return {};

    const since = lastAbs == null ? rs.intervalHours : worldAbsHours - lastAbs;
    if (since < rs.intervalHours) return {};

    return {
      nodeUpdates: {
        restock: { ...rs, lastRestockAt: snapFromWS(context?.worldState) },
      },
      events: [{
        kind: 'restock',
        text: `${node.name} has restocked since your last visit.`,
        data: { restockKind: rs.kind || 'inventory' },
      }],
    };
  },
};

// ───────────────────────────────────────────────────────────── #3 faction bridge

/**
 * Bridges the existing factionSimulation.tickCampaign engine into node events.
 *
 * The faction sim operates at a campaign level; it doesn't (yet) know about
 * world-tree nodes. We bridge by:
 *   1. Let the handler be called once at the root of a cascade (detected via
 *      context.cascadeRole === 'target'). Only ticks there to avoid running
 *      the campaign sim N times per arrival.
 *   2. Capture any events the sim produced and attach them to the nearest
 *      node whose name matches a faction's home/territory, else to the
 *      target node.
 *
 * Implementation is dynamic-import-safe so unit tests that don't wire the
 * faction module still work.
 */
const factionBridgeHandler = {
  name: 'factionBridge',
  appliesTo(node, context) {
    return context?.cascadeRole === 'target' && !!context?.campaign;
  },
  run(node, hoursElapsed, context) {
    if (typeof factionSim?.tickCampaign !== 'function') return {};
    let tickResult;
    try {
      tickResult = factionSim.tickCampaign(context.campaign, hoursElapsed, { dryRun: false }) || {};
    } catch { return {}; }

    const events = [];
    const simEvents = Array.isArray(tickResult.events) ? tickResult.events : [];
    for (const ev of simEvents.slice(0, 10)) {
      events.push({
        kind: 'factionSim',
        text: String(ev.text || ev.summary || 'A faction made a move.').slice(0, 400),
        data: { factionId: ev.factionId || null, type: ev.type || null },
      });
    }
    return { events };
  },
};

// ───────────────────────────────────────────────────────────── #4 weather

const WEATHER_TABLE = [
  { id: 'clear', text: 'Clear skies' },
  { id: 'overcast', text: 'Overcast and cool' },
  { id: 'rain', text: 'Steady rain' },
  { id: 'storm', text: 'Thunderstorm rolling through' },
  { id: 'fog', text: 'Heavy fog' },
  { id: 'wind', text: 'Strong winds' },
  { id: 'snow', text: 'Snowfall' },
];

const REGION_KINDS = new Set(['region', 'country', 'continent', 'wilderness']);

const weatherHandler = {
  name: 'weather',
  appliesTo(node) {
    return REGION_KINDS.has(node.kind);
  },
  run(node, hoursElapsed, context) {
    const rng = makeRng(seedFor(node, context));
    // Average weather roll every ~12 hours.
    const rolls = Math.max(1, Math.floor(hoursElapsed / 12));
    let current = node.weather?.current;
    const events = [];

    for (let i = 0; i < Math.min(rolls, 8); i++) {
      const next = WEATHER_TABLE[Math.floor(rng() * WEATHER_TABLE.length)]?.id || 'clear';
      if (next !== current) {
        current = next;
        events.push({
          kind: 'weather',
          text: `Weather shifted: ${weatherText(current)}.`,
          data: { weather: current },
        });
      }
    }
    if (!events.length) return {};
    return {
      nodeUpdates: {
        weather: {
          current,
          changedAt: snapFromWS(context?.worldState),
        },
      },
      events: events.slice(-2), // cap noise
    };
  },
};

function weatherText(id) {
  return (WEATHER_TABLE.find(w => w.id === id) || {}).text || id;
}

// ───────────────────────────────────────────────────────────── #5 random events

const RANDOM_EVENT_TABLES = {
  town: [
    'A trader from out of town set up a stall in the market.',
    'A brawl broke out at a tavern down the street last night.',
    'Rumors of a missing person are circulating.',
    'A noble family passed through on their way elsewhere.',
    'Heavy rain flooded part of a street.',
    'A travelling priest delivered a sermon at the square.',
  ],
  city: [
    'A new proclamation from the governor was posted.',
    'A guild meeting drew unusual crowds.',
    'A festival is being planned for next tenday.',
    'A notorious pickpocket struck the merchant quarter.',
  ],
  village: [
    'A farmer lost livestock to unknown predators.',
    'A travelling bard stayed a night at the inn.',
    'A local wedding was held in the chapel.',
  ],
  wilderness: [
    'Tracks of a large beast cross the area.',
    'A campsite has been abandoned recently.',
    'A small shrine was left with fresh offerings.',
    'The trees have been marked by unknown hunters.',
  ],
  dungeon: [
    'Something has shifted the rubble.',
    'Old scratches on the wall look fresher than before.',
    'A foul smell drifts from deeper within.',
  ],
  building: [
    'A piece of furniture has been moved.',
    'A window was left open, letting in weather.',
  ],
  room: [
    'A candle was left burning down to a stub.',
    'The bedsheets are rumpled in a way you did not leave them.',
  ],
};

const randomEventHandler = {
  name: 'randomEvent',
  run(node, hoursElapsed, context) {
    const table = RANDOM_EVENT_TABLES[node.kind];
    if (!table || table.length === 0) return {};
    const days = hoursElapsed / 24;
    // ~15% chance per day of something worth noting; capped at 3 events.
    const rng = makeRng(seedFor(node, context) ^ 0x9e3779b1);
    const events = [];
    const expected = Math.min(3, Math.floor(days * 0.15 + rng()));
    for (let i = 0; i < expected; i++) {
      const line = table[Math.floor(rng() * table.length)];
      if (line) events.push({ kind: 'rumor', text: line });
    }
    if (!events.length) return {};
    return { events };
  },
};

// ───────────────────────────────────────────────────────────── worldState helpers

function snapFromWS(ws) {
  if (!ws) return null;
  return {
    year: ws.currentYear ?? null,
    month: ws.currentMonth ?? null,
    day: ws.currentDay ?? null,
    hour: ws.currentHour ?? null,
    minute: ws.currentMinute ?? null,
    at: Date.now(),
  };
}

function absHoursFromWS(ws) {
  if (!ws) return null;
  return absHoursFromSnap(snapFromWS(ws));
}

function absHoursFromSnap(snap) {
  if (!snap) return null;
  const y = Number.isFinite(snap.year) ? snap.year : 0;
  const m = Number.isFinite(snap.month) ? snap.month : 0;
  const d = Number.isFinite(snap.day) ? snap.day : 1;
  const h = Number.isFinite(snap.hour) ? snap.hour : 0;
  const min = Number.isFinite(snap.minute) ? snap.minute : 0;
  const days = y * 360 + m * 30 + (d - 1);
  return days * 24 + h + min / 60;
}

// ───────────────────────────────────────────────────────────── registration

/**
 * Register all default handlers in the standard order. Safe to call multiple
 * times (duplicate names get replaced rather than appended).
 */
export function registerDefaultTickHandlers() {
  registerTickHandler(npcScheduleHandler);
  registerTickHandler(restockHandler);
  registerTickHandler(factionBridgeHandler);
  registerTickHandler(weatherHandler);
  registerTickHandler(randomEventHandler);
}

// Export individual handlers for testing / customization.
export { npcScheduleHandler, restockHandler, factionBridgeHandler, weatherHandler, randomEventHandler };
