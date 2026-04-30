/**
 * Engine Trace — a lightweight, in-memory ring buffer of "what engine
 * entrypoints just fired" so bug reports can attach a last-N record of
 * *what the app was doing* rather than just the last rules roll.
 *
 * Motivation (bug #27):
 *   The existing playLog captures *rules* events (skill checks, attacks).
 *   But when a bug appears right after the player starts an adventure, or
 *   loads a save, or triggers an AI narration — the rules log is empty.
 *   Engine trace fills that gap by recording every call to a small set of
 *   high-level entrypoints (startAdventure, handleAction, narrate,
 *   loadGame, campaignStart) with the args + a short tag.
 *
 * Shape of each entry:
 *   { at, tag, detail, sessionId }
 *     - at       : ISO timestamp
 *     - tag      : short label like 'startAdventure' or 'narrate:custom'
 *     - detail   : optional small object with argument summary (kept tiny —
 *                  big strings are truncated so the bug record stays small)
 *     - sessionId: same per-tab session id as playLog, for grouping
 *
 * Consumers:
 *   - BugReportButton attaches getRecentTrace(20) to every bug record
 *   - BugQueueViewer renders the trace in the recent-events panel
 */

const RING_SIZE = 50;
const _ring = [];

let _enabled = true;
export function setEngineTraceEnabled(on) { _enabled = !!on; }
export function isEngineTraceEnabled() { return _enabled; }

// Reuse the playlog session id so trace + playlog can be correlated.
// Done lazily to avoid import cycles / sessionStorage access during tests.
let _sessionIdFn = null;
export function _setSessionIdProvider(fn) { _sessionIdFn = fn; }
function sid() {
  try { return _sessionIdFn ? _sessionIdFn() : null; } catch { return null; }
}

/**
 * Truncate long string values inside a detail object so the captured
 * trace stays compact (bug records go over the wire to the dev-server
 * plugin and get round-tripped through JSON). Objects are shallow-copied;
 * arrays are length-capped.
 */
function compactDetail(d, maxStr = 140, maxArr = 6) {
  if (d == null) return null;
  if (typeof d === 'string') {
    return d.length > maxStr ? d.slice(0, maxStr) + `…(+${d.length - maxStr})` : d;
  }
  if (Array.isArray(d)) {
    const head = d.slice(0, maxArr).map((x) => compactDetail(x, maxStr, maxArr));
    return d.length > maxArr ? [...head, `…(+${d.length - maxArr} more)`] : head;
  }
  if (typeof d === 'object') {
    const out = {};
    for (const k of Object.keys(d)) {
      out[k] = compactDetail(d[k], maxStr, maxArr);
    }
    return out;
  }
  return d;
}

/**
 * Push a new entry into the ring.
 *
 * @param {string} tag     — short label, e.g. 'startAdventure'
 * @param {object} [detail]— small context object (args summary)
 */
export function traceEngine(tag, detail = null) {
  if (!_enabled) return;
  const record = {
    at: new Date().toISOString(),
    tag: String(tag || 'unknown'),
    detail: compactDetail(detail),
    sessionId: sid(),
  };
  _ring.push(record);
  if (_ring.length > RING_SIZE) _ring.shift();
}

/**
 * Synchronous accessor — returns the most recent n entries (most recent last).
 * Defaults to the full ring since 50 entries is already tiny.
 */
export function getRecentTrace(n = RING_SIZE) {
  if (n <= 0) return [];
  return _ring.slice(-n);
}

/** Clear the ring (used by tests; operators can also trigger this from Settings). */
export function clearEngineTrace() {
  _ring.length = 0;
}
