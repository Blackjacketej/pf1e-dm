/**
 * Journal event bus — a tiny pub/sub so tracker services can notify the
 * narrative log (and anything else that cares) when a new entry lands in
 * the Adventurer's Journal, without the trackers having to know about
 * React / App.jsx / the gameLog shape.
 *
 * Design notes
 * ------------
 *  - Pure ES module singleton. No React dep, no Dexie dep. Works in tests.
 *  - Subscribers are called synchronously in registration order. A throwing
 *    subscriber is caught and logged so one bad listener can't break the
 *    chain for the others.
 *  - FIRST-TIME only: emit is only called when the tracker has decided
 *    this is a new-to-the-party entry. Re-encounters (bumping
 *    interactions / lastSeen / visits) must NOT emit — otherwise the log
 *    would spam a line every time a familiar NPC walks across the scene.
 *  - Intentionally NOT persisted. The journal tables themselves are the
 *    source of truth; this bus is a one-shot notification for the live
 *    session.
 *
 * Event shape
 * -----------
 *   {
 *     kind: 'clue' | 'npc' | 'faction' | 'location' | 'creature'
 *           | 'item' | 'note',
 *     label: string,        // short human-friendly label for the log line
 *     detail?: string,      // optional extra context ("met in Sandpoint")
 *     id?: number|string,   // Dexie row id, if relevant
 *   }
 *
 * App.jsx wires a single subscriber that calls addLog(..., 'journal') so
 * the narrative log picks these up with NWN-style 'JOURNAL' coloring.
 */

const listeners = new Set();

/**
 * Register a listener. Returns an unsubscribe function — callers should
 * store it and call it on component unmount to avoid leaking subscribers.
 */
export function onJournalAdd(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Emit a journal-add event. No-op when the payload is malformed so a
 * misfire inside a tracker can't cascade into a user-visible crash.
 */
export function emitJournalAdd(event) {
  if (!event || typeof event !== 'object' || !event.kind || !event.label) {
    return;
  }
  for (const fn of listeners) {
    try {
      fn(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[journalEvents] listener threw:', err);
    }
  }
}

/**
 * Format helper — the default "nice" line for a journal-add event. Kept
 * here so the log line shape is consistent across every tracker. App.jsx
 * uses this but callers can also pick their own format.
 *
 *   📔 new clue: "The barkeep mentioned caravans"
 *   📔 new NPC: Bertha Cray
 *   📔 new faction: Sandpoint Mercantile League
 *   📔 new location: Rusty Dragon Inn
 */
export function formatJournalAdd(event) {
  if (!event) return '';
  const kindLabel = {
    clue: 'clue',
    hint: 'hint',
    lead: 'lead',
    rumor: 'rumor',
    todo: 'to-do',
    npc: 'NPC',
    faction: 'faction',
    location: 'location',
    creature: 'creature',
    item: 'item',
    note: 'note',
  }[event.kind] || event.kind;
  const base = `📔 new ${kindLabel}: ${event.label}`;
  return event.detail ? `${base} — ${event.detail}` : base;
}

/**
 * Test-only: drop every registered listener. NOT exported from the
 * public barrel — reach in via module import for unit tests.
 */
export function _resetForTests() {
  listeners.clear();
}
