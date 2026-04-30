/**
 * nodeTick.js — L3 living-world tick engine.
 *
 * Runs elapsed-time simulation at a world-tree node when the party arrives
 * after being away. Handlers produce events + node updates that accumulate
 * into the node's history, so a return visit can narrate "Since you were
 * last here: …".
 *
 * Usage pattern (from AdventureTab):
 *
 *   const elapsed = hoursBetween(node.lastTickedAt, snapshotWorldTime(worldState));
 *   const { nodeUpdates, events } = tickNode(tree, node.id, elapsed, {
 *     worldState, campaign, party, randomSeed,
 *   });
 *   Object.assign(node, nodeUpdates);
 *   events.forEach(e => appendNodeHistory(tree, node.id, e));
 *   node.lastTickedAt = snapshotWorldTime(worldState);
 *   // Surface events to the operator via "Since you were last here:" callout.
 *
 * Handler signature: (node, hoursElapsed, context) → { nodeUpdates, events }
 *   - `node` is read-only to the handler; updates go through the return value.
 *   - `events` are { kind, text, data, at } — merged into node.history.
 *
 * Safety caps:
 *   - elapsed hours clamped to MAX_TICK_HOURS (default 30 days) so a months-
 *     old save doesn't stall on random-event rolls.
 *   - each handler wrapped in try/catch; one handler's failure never kills
 *     a sibling handler.
 */

import { snapshotWorldTime } from './worldTree';

const MAX_TICK_HOURS = 24 * 30; // 30 days

// ───────────────────────────────────────────────────────────── handler registry

const handlers = [];

/**
 * Register a handler. Handlers run in registration order.
 * @param {Object} handler
 * @param {string} handler.name — identifier for debugging.
 * @param {(node, hoursElapsed, context) => { nodeUpdates?, events? }} handler.run
 * @param {(node, context) => boolean} [handler.appliesTo] — optional filter;
 *   defaults to always-true.
 */
export function registerTickHandler(handler) {
  if (!handler || typeof handler.run !== 'function') return;
  // Replace any existing handler with the same name (hot-reload friendly).
  const idx = handlers.findIndex(h => h.name === handler.name);
  if (idx >= 0) handlers[idx] = handler;
  else handlers.push(handler);
}

export function unregisterTickHandler(name) {
  const idx = handlers.findIndex(h => h.name === name);
  if (idx >= 0) handlers.splice(idx, 1);
}

export function listTickHandlers() {
  return handlers.map(h => h.name);
}

// ───────────────────────────────────────────────────────────── core tick

/**
 * Run all handlers for a single node over an elapsed hours window.
 *
 * @param {Object} tree — The world tree (handlers may need ancestor lookup).
 * @param {string} nodeId
 * @param {number} hoursElapsed — clamped to [0, MAX_TICK_HOURS].
 * @param {Object} context — { worldState, campaign, party, randomSeed }.
 * @returns {{ nodeUpdates: Object, events: Array }}
 */
export function tickNode(tree, nodeId, hoursElapsed, context = {}) {
  const node = tree?.nodes?.[nodeId];
  if (!node) return { nodeUpdates: {}, events: [] };

  const elapsed = Math.min(Math.max(0, Number(hoursElapsed) || 0), MAX_TICK_HOURS);
  if (elapsed <= 0) return { nodeUpdates: {}, events: [] };

  const allEvents = [];
  const merged = {};

  for (const handler of handlers) {
    try {
      if (typeof handler.appliesTo === 'function' && !handler.appliesTo(node, context)) continue;
      const result = handler.run(node, elapsed, context) || {};
      if (result.nodeUpdates && typeof result.nodeUpdates === 'object') {
        Object.assign(merged, result.nodeUpdates);
      }
      if (Array.isArray(result.events)) {
        for (const evt of result.events) {
          if (!evt) continue;
          allEvents.push({
            at: evt.at || snapshotWorldTime(context.worldState),
            kind: String(evt.kind || 'tick'),
            text: String(evt.text || '').slice(0, 500),
            data: evt.data || null,
            source: handler.name,
          });
        }
      }
    } catch (err) {
      // Never let one handler nuke the others.
      // eslint-disable-next-line no-console
      console.warn(`[nodeTick] handler ${handler.name} threw`, err);
    }
  }

  return { nodeUpdates: merged, events: allEvents };
}

/**
 * Tick all ancestors + the target node as the party arrives. Ancestors get
 * a reduced tick (weather / faction events propagate; interior state does
 * not). Returns flattened events with node attribution.
 */
export function tickArrivalCascade(tree, path, context = {}) {
  if (!Array.isArray(path) || path.length === 0) return [];
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const nodeId = path[i];
    const node = tree?.nodes?.[nodeId];
    if (!node) continue;
    const isTarget = i === path.length - 1;
    const elapsed = computeElapsedHours(node, context.worldState);
    if (elapsed <= 0) continue;
    const { nodeUpdates, events } = tickNode(tree, nodeId, elapsed, {
      ...context,
      cascadeRole: isTarget ? 'target' : 'ancestor',
    });
    // Merge updates onto the node.
    Object.assign(node, nodeUpdates);
    for (const evt of events) {
      out.push({ ...evt, nodeId, nodeName: node.name });
    }
    // Stamp the tick watermark.
    node.lastTickedAt = snapshotWorldTime(context.worldState);
  }
  return out;
}

function computeElapsedHours(node, worldState) {
  const lastSnap = node?.lastTickedAt;
  if (!lastSnap) return 0;
  // Inline hoursBetween to avoid circular import.
  const a = absHours(lastSnap);
  const nowSnap = snapshotWorldTime(worldState);
  const b = absHours(nowSnap);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a);
}

function absHours(snap) {
  if (!snap) return null;
  const y = Number.isFinite(snap.year) ? snap.year : 0;
  const m = Number.isFinite(snap.month) ? snap.month : 0;
  const d = Number.isFinite(snap.day) ? snap.day : 1;
  const h = Number.isFinite(snap.hour) ? snap.hour : 0;
  const min = Number.isFinite(snap.minute) ? snap.minute : 0;
  const days = y * 360 + m * 30 + (d - 1);
  return days * 24 + h + min / 60;
}
