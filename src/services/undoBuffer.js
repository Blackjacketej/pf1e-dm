// Bug #35 — Undo last action.
//
// A module-scoped ring buffer of live-state snapshots. Each snapshot holds
// the five slices that can be rolled back safely:
//   - party       (characters + HP + XP + inventory)
//   - gameLog     (narration / action / journal / system entries)
//   - adventure   (current location + worldTree + sub-state)
//   - combat      (active combat state or null)
//   - worldState  (calendar, weather, nearbyNPCs, areaItems, contextActions,
//                  GM pins, partyPosition, etc.)
//
// Deliberately excluded from the snapshot (per the #35-blocked note):
//   - IndexedDB-backed long-term tables (encounteredNpcs, journalNotes,
//     factions, encounteredClues, bestiary, locations). Rolling those back
//     risks breaking faction.members consistency and cross-session scope.
//   - Component-local UI state (narrating, loading, slide-panel open/close,
//     text-input buffers). These are transient and should settle on their own.
//
// Defaults: 5-deep ring buffer, FIFO eviction when full. A subscribe()
// surface lets the UI keep a live depth counter so the "Undo" button can
// disable itself when the buffer is empty.

const MAX_DEPTH = 5;

// Ring buffer of snapshots. The most recent snapshot is always at [length-1].
const _buffer = [];
// Subscribers called with the current depth whenever push/pop/clear fires.
const _subscribers = new Set();

function _deepClone(value) {
  // structuredClone is available in all modern browsers and preserves
  // ES object types better than JSON round-tripping. Fall back to JSON
  // in environments that don't have it (older test runners, Node <17).
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fall through */ }
  }
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function _notify() {
  const depth = _buffer.length;
  for (const cb of _subscribers) {
    try { cb(depth); } catch (e) { console.warn('[undoBuffer] subscriber error:', e); }
  }
}

/**
 * Push a live-state snapshot onto the ring buffer. Shallow-spreads so the
 * caller can pass { party, gameLog, adventure, combat, worldState } without
 * extra ceremony. Each slice is deep-cloned so later mutations of the live
 * state don't leak back into the stored snapshot.
 *
 * Returns the new buffer depth (useful for tests / telemetry).
 */
export function pushUndoSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return _buffer.length;
  const cloned = {
    party: _deepClone(snapshot.party ?? []),
    gameLog: _deepClone(snapshot.gameLog ?? []),
    adventure: _deepClone(snapshot.adventure ?? null),
    combat: _deepClone(snapshot.combat ?? null),
    worldState: _deepClone(snapshot.worldState ?? {}),
    capturedAt: new Date().toISOString(),
    label: typeof snapshot.label === 'string' ? snapshot.label : null,
  };
  _buffer.push(cloned);
  while (_buffer.length > MAX_DEPTH) _buffer.shift();
  _notify();
  return _buffer.length;
}

/**
 * Pop and return the most recent snapshot. Caller is responsible for
 * applying the slices back onto their setState hooks. Returns null when
 * the buffer is empty.
 */
export function popUndoSnapshot() {
  if (_buffer.length === 0) return null;
  const snap = _buffer.pop();
  _notify();
  return snap;
}

/** Non-destructive depth read. */
export function peekUndoDepth() {
  return _buffer.length;
}

/** Drop the entire buffer (used on New Game / Load Game / Continue). */
export function clearUndoBuffer() {
  if (_buffer.length === 0) return;
  _buffer.length = 0;
  _notify();
}

/**
 * Subscribe to depth changes. Returns an unsubscribe function. Fires once
 * immediately with the current depth so subscribers can seed state without
 * a second read.
 */
export function subscribeUndoDepth(callback) {
  if (typeof callback !== 'function') return () => {};
  _subscribers.add(callback);
  try { callback(_buffer.length); } catch (e) { console.warn('[undoBuffer] initial callback error:', e); }
  return () => { _subscribers.delete(callback); };
}

/** Config knob used by tests — not used in production. */
export const UNDO_MAX_DEPTH = MAX_DEPTH;
