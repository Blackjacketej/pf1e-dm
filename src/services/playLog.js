/**
 * Playthrough Log — structured firehose of rules events
 *
 * Captures every rules resolution that happens during gameplay (skill checks,
 * combat rolls, etc.) into IndexedDB so we can later export the whole thing
 * and review it in Cowork for CRB-fidelity bugs.
 *
 * Difference vs gameLog:
 *   gameLog       — narrative/UI display, prose, used by GameLog.jsx
 *   playLogEvents — structured machine-readable data, kept for audit/replay
 *
 * Each event captures:
 *   - kind         (skill-check, attack, damage, save, etc.)
 *   - character    (name)
 *   - skill        (when applicable)
 *   - input        (the args passed in: situation, DC, modifiers)
 *   - output       (the resolver's return shape)
 *   - createdAt    (ISO timestamp)
 *   - sessionId    (a per-session uuid so we can split runs apart)
 *
 * The log is *append-only* during a session and survives reloads via Dexie.
 * Operators can clear it manually from the Bug Queue panel.
 */

import db from '../db/database';

// Per-tab session id — generated lazily, persisted to sessionStorage so
// reloads inside the same tab still group together.
let _sessionId = null;
// Exported so engineTrace (and other future subsystems) can correlate
// their records with the same per-tab id without re-deriving it.
export function getPlayLogSessionId() { return getSessionId(); }
function getSessionId() {
  if (_sessionId) return _sessionId;
  try {
    const cached = sessionStorage.getItem('pf_playlog_session');
    if (cached) {
      _sessionId = cached;
      return _sessionId;
    }
  } catch { /* no sessionStorage in some envs */ }
  _sessionId = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try { sessionStorage.setItem('pf_playlog_session', _sessionId); } catch { /* noop */ }
  return _sessionId;
}

// Globally-mutable enable flag. Defaults true. Tests can flip it off.
let _enabled = true;
export function setPlayLogEnabled(on) { _enabled = !!on; }
export function isPlayLogEnabled() { return _enabled; }

// In-memory ring of the most recent N events so the bug button can grab
// "what just happened" without an async DB call.
const RECENT_RING_SIZE = 50;
const _recentRing = [];

/**
 * Log a single rules event.
 *
 * @param {object} evt
 * @param {string} evt.kind        — 'skill-check' | 'attack' | 'damage' | 'save' | 'tumble' | etc.
 * @param {string} [evt.character] — character name
 * @param {string} [evt.skill]     — skill or ability name
 * @param {object} [evt.input]     — args passed to the resolver
 * @param {object} [evt.output]    — return value of the resolver
 * @param {string} [evt.summary]   — one-line human-readable summary (for fast scanning)
 */
export async function logRulesEvent(evt) {
  if (!_enabled) return;
  const record = {
    sessionId: getSessionId(),
    createdAt: new Date().toISOString(),
    kind: evt.kind || 'unknown',
    character: evt.character || null,
    skill: evt.skill || null,
    input: safeClone(evt.input),
    output: safeClone(evt.output),
    summary: evt.summary || null,
  };

  // Push to ring first (sync) so the bug button always sees fresh data
  // even if the DB write is still pending.
  _recentRing.push(record);
  if (_recentRing.length > RECENT_RING_SIZE) _recentRing.shift();

  try {
    await db.playLogEvents.add(record);
  } catch (e) {
    // Never let logging crash gameplay. Just warn.
    console.warn('[playLog] write failed:', e);
  }
}

/**
 * Synchronous accessor for the in-memory ring — used by BugReportButton
 * to grab "the last roll" without awaiting IndexedDB.
 */
export function getLastEvent() {
  return _recentRing.length ? _recentRing[_recentRing.length - 1] : null;
}

/**
 * Synchronous accessor for the recent N events (most recent last).
 *
 * Note: we explicitly handle n <= 0 because Array.prototype.slice(-0) is the
 * same as slice(0), which would return the WHOLE ring instead of an empty
 * array. Negative or zero counts return [].
 */
export function getRecentEvents(n = 10) {
  if (n <= 0) return [];
  return _recentRing.slice(-n);
}

/**
 * Pull all events for the current session from IndexedDB. Used by the
 * export workflow.
 */
export async function getCurrentSessionEvents() {
  const sid = getSessionId();
  return db.playLogEvents.where('sessionId').equals(sid).sortBy('createdAt');
}

/**
 * Pull every event ever logged. Used when reviewing across sessions.
 */
export async function getAllEvents() {
  return db.playLogEvents.orderBy('createdAt').toArray();
}

/**
 * Wipe the play log. Defaults to current session only.
 */
export async function clearPlayLog({ allSessions = false } = {}) {
  if (allSessions) {
    await db.playLogEvents.clear();
  } else {
    const sid = getSessionId();
    await db.playLogEvents.where('sessionId').equals(sid).delete();
  }
  _recentRing.length = 0;
}

/**
 * Render the play log as a markdown document suitable for review in Cowork.
 * Each event becomes a fenced JSON block under a header line.
 */
export async function exportLogAsMarkdown({ allSessions = false } = {}) {
  const events = allSessions ? await getAllEvents() : await getCurrentSessionEvents();
  if (!events.length) return '# Playthrough Log\n\n_(empty)_\n';

  const lines = [];
  lines.push('# Playthrough Log');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Events: ${events.length}`);
  lines.push(`Scope: ${allSessions ? 'all sessions' : `session ${getSessionId()}`}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const e of events) {
    const time = e.createdAt?.slice(11, 19) || '';
    const head = [time, e.kind, e.character, e.skill].filter(Boolean).join(' · ');
    lines.push(`## ${head}`);
    if (e.summary) {
      lines.push('');
      lines.push(`> ${e.summary}`);
    }
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({ input: e.input, output: e.output }, null, 2));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Defensive deep-clone via JSON. Drops functions, undefineds, and circular
 * refs. We never want a logging call to take a reference to a live game
 * object that later mutates.
 */
function safeClone(v) {
  if (v == null) return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

export default {
  logRulesEvent,
  getLastEvent,
  getRecentEvents,
  getCurrentSessionEvents,
  getAllEvents,
  clearPlayLog,
  exportLogAsMarkdown,
  setPlayLogEnabled,
  isPlayLogEnabled,
};
