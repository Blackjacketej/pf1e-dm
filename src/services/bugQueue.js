/**
 * Bug Queue — manually-captured CRB-fidelity issues
 *
 * This is the operator-facing complement to playLog.js. The play log
 * captures *everything* (machine firehose); the bug queue captures
 * *what the operator noticed* (human signal).
 *
 * Workflow:
 *   1. Operator notices something wrong mid-game
 *   2. Clicks the floating bug button
 *   3. Modal pre-fills with the most recent rules event from playLog
 *   4. Operator edits, tags severity, submits
 *   5. Entry persists to IndexedDB
 *   6. Later, in Cowork: I read the queue, fix each entry, mark resolved
 */

import db from '../db/database';
import { getLastEvent, getRecentEvents } from './playLog';
import { getRecentTrace } from './engineTrace';

export const SEVERITIES = ['crit', 'major', 'minor', 'cosmetic'];

// Entry type: 'bug' is the original rules-issue flow; 'note' / 'design' / 'idea'
// widen the queue into a general-purpose "notes for Claude" channel so the
// operator can capture thoughts from any screen (char create, settings, etc.)
export const KINDS = ['bug', 'note', 'design', 'idea'];

/**
 * Append a bug report to the queue.
 *
 * @param {object} bug
 * @param {string} bug.text                — operator's description (required)
 * @param {string} [bug.kind]              — one of KINDS, default 'bug'
 * @param {string} [bug.severity]          — one of SEVERITIES, default 'minor'
 * @param {object} [bug.capturedContext]   — auto-captured rules-event snapshot
 * @param {string} [bug.scene]             — current location/scene name
 * @param {string} [bug.character]         — character involved
 * @param {Array}  [bug.attachments]       — operator-pasted/picked files as
 *                                          `[{ name, type, size, dataUrl }]`.
 *                                          Stored in IndexedDB as-is and also
 *                                          written to disk under
 *                                          claude-attachments/ by the dev plugin.
 * @returns {Promise<number>} — the new bug's id
 */
export async function appendBug(bug) {
  if (!bug?.text?.trim()) throw new Error('Bug report text is required');
  const severity = SEVERITIES.includes(bug.severity) ? bug.severity : 'minor';
  const kind = KINDS.includes(bug.kind) ? bug.kind : 'bug';
  // #36 — sanitize attachments list: only keep known fields, cap size defensively.
  const rawAtt = Array.isArray(bug.attachments) ? bug.attachments : [];
  const attachments = rawAtt
    .filter((a) => a && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:'))
    .map((a) => ({
      name: String(a.name || 'attachment').slice(0, 200),
      type: String(a.type || 'application/octet-stream').slice(0, 100),
      size: Number(a.size) || 0,
      dataUrl: a.dataUrl,
    }));
  // Bug #40 — floor the new id above any id that appears in the local DB
  // AND on disk (claude-resolutions.json + claude-notes.md). Dexie's
  // auto-increment restarts at 1 when IndexedDB is cleared, which would
  // otherwise collide with resolved ids already persisted on disk and
  // cause the scheduled bug-queue runner to silently skip the new entry
  // (it drops any id that appears in claude-resolutions.json).
  const nextId = await computeNextBugId();
  const record = {
    id: nextId,
    createdAt: new Date().toISOString(),
    kind,
    severity,
    status: 'open',
    text: bug.text.trim(),
    scene: bug.scene || null,
    character: bug.character || null,
    capturedContext: bug.capturedContext || null,
    // Snapshot the last few play-log events at capture time so we don't have
    // to re-query later (and so the context is frozen even if the user keeps
    // playing after submission).
    recentEvents: bug.recentEvents || getRecentEvents(5),
    // Snapshot recent engine-level entrypoints (startAdventure, narrate,
    // handleLoadGame, …) so bugs that fire right after navigation / load
    // without any rules events preceding them still carry useful context. (#27)
    engineTrace: bug.engineTrace || getRecentTrace(20),
    // #36 — attachments are stored on the IndexedDB record so they survive
    // a page reload; the disk-write below is what makes them readable from
    // Claude/Cowork sessions.
    attachments,
    resolvedAt: null,
    resolutionNote: null,
  };
  // `put` honors the explicit id; `add` would still auto-increment in some
  // edge cases even with id set.
  await db.bugReports.put(record);
  const id = nextId;

  // Fire-and-forget append to claude-notes.md via the Vite dev-server plugin.
  // Errors are logged but never block the DB write — the record is still in
  // IndexedDB and can be exported manually if the endpoint isn't reachable
  // (e.g. in a production/static build).
  appendToDiskFile({ id, ...record }).catch((e) => {
    console.warn('[bugQueue] disk append failed (entry still saved in DB):', e);
  });

  return id;
}

/**
 * Bug #40 — compute the next bug id as the max across EVERY source that
 * might hold an existing id:
 *   1. local IndexedDB  (db.bugReports)
 *   2. claude-resolutions.json  (via the /__claude-resolutions endpoint)
 *   3. claude-notes.md          (via the shared on-disk scan path)
 *
 * Without this, Dexie's auto-increment counter (which resets to 1 when
 * IndexedDB is cleared) would hand out an id already marked resolved on
 * disk. The scheduled bug-queue runner drops any id listed in
 * claude-resolutions.json, so the newly-filed bug would be silently
 * skipped every tick. All three lookups are best-effort — if any one
 * fails we fall back to the next. The final floor is `max + 1`.
 */
async function computeNextBugId() {
  const localRecords = await db.bugReports.toArray().catch(() => []);
  let max = 0;
  for (const r of localRecords) {
    if (Number.isFinite(r?.id) && r.id > max) max = r.id;
  }
  if (typeof fetch !== 'function') return max + 1;

  // Resolutions endpoint: fast, tiny JSON. Covers ids that were resolved
  // long ago and may have been purged from this browser's DB.
  try {
    const resp = await fetch('/__claude-resolutions', { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      const list = Array.isArray(data?.resolutions) ? data.resolutions : [];
      for (const r of list) {
        if (Number.isFinite(r?.id) && r.id > max) max = r.id;
      }
    }
  } catch {
    // non-fatal; fall through to notes scan.
  }

  // Notes-md scan: catches open-but-never-rehydrated ids (e.g. the operator
  // added an entry by hand-editing the markdown). Reuses the same fallback
  // chain rehydrate uses, so whichever middleware is up gets hit.
  try {
    const { entries } = await fetchEntriesFromDisk();
    if (Array.isArray(entries)) {
      for (const e of entries) {
        if (Number.isFinite(e?.id) && e.id > max) max = e.id;
      }
    }
  } catch {
    // non-fatal; local DB + resolutions alone are still a useful floor.
  }

  return max + 1;
}

async function appendToDiskFile(entry) {
  if (typeof fetch !== 'function') return;
  await fetch('/__claude-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: entry.id,
      kind: entry.kind,
      severity: entry.severity,
      scene: entry.scene,
      character: entry.character,
      text: entry.text,
      createdAt: entry.createdAt,
      // #36 — attachments are sent as `{ name, type, size, dataUrl }` objects.
      // The Vite plugin base64-decodes the dataUrl into claude-attachments/
      // and embeds the resulting relative paths in the markdown.
      attachments: Array.isArray(entry.attachments) ? entry.attachments : [],
    }),
  });
}

/**
 * List all bug reports.
 *
 * Sorting:
 *  - status='open' — operator-ranked importance first (priority asc, nulls
 *    sink to the bottom), then newest-first within each band. The drag-to-
 *    reorder UI writes priority values 1..N; unranked entries keep
 *    priority=null and sit below the ranked ones in createdAt-desc order.
 *  - any other filter (or no filter) — newest-first by createdAt. Resolved
 *    items have no useful "importance" so we keep the historical ordering.
 */
export async function listBugs({ status = null } = {}) {
  const all = await db.bugReports.toArray();
  const byCreatedDesc = (a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

  if (status === 'open') {
    const open = all.filter((b) => b.status === 'open');
    open.sort((a, b) => {
      const ap = Number.isFinite(a.priority) ? a.priority : Infinity;
      const bp = Number.isFinite(b.priority) ? b.priority : Infinity;
      if (ap !== bp) return ap - bp;
      return byCreatedDesc(a, b);
    });
    return open;
  }

  const sorted = all.slice().sort(byCreatedDesc);
  if (status) return sorted.filter((b) => b.status === status);
  return sorted;
}

/**
 * Set a single bug's importance rank. Lower priority number = higher in the
 * queue. `null` removes the rank (entry falls back to createdAt-desc order).
 */
export async function setBugPriority(id, priority) {
  const normalized = Number.isFinite(priority) ? Number(priority) : null;
  await db.bugReports.update(id, { priority: normalized });
}

/**
 * Persist a new open-queue ordering. Takes an array of bug ids in their
 * desired display order (top → bottom) and assigns priorities 1..N.
 *
 * Ids not present in the array are left alone — callers should pass the
 * complete open-queue order, not a partial slice. Non-numeric / unknown ids
 * are silently skipped.
 *
 * Also fires a write-through POST to /__claude-priority so the scheduled
 * `review-pf-dm-bug-queue` task (which runs outside the browser) can read
 * the rank order from disk. IndexedDB-only ranking is invisible to anything
 * that can't open the app.
 */
export async function reorderOpenBugs(orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
  const normalized = orderedIds.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  await db.transaction('rw', db.bugReports, async () => {
    for (let i = 0; i < normalized.length; i++) {
      await db.bugReports.update(normalized[i], { priority: i + 1 });
    }
  });
  // Fire-and-forget disk sync — errors don't block the local update.
  if (typeof fetch === 'function') {
    fetch('/__claude-priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: normalized }),
    }).catch((err) => {
      console.warn('[bugQueue] priority disk sync failed (local rank still applied):', err);
    });
  }
}

/**
 * Mark a bug as resolved with an optional note (e.g. the commit hash).
 * Status transitions: open → resolved. Claude flips items here after
 * shipping a fix; the operator then reviews and either Accepts (below)
 * or Reopens with a follow-up comment.
 */
export async function markResolved(id, note = null) {
  await db.bugReports.update(id, {
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolutionNote: note,
  });
}

/**
 * Apply an acceptance status pulled from claude-resolutions.json during the
 * sync-from-disk pass. Separate from acceptBug because we're READING from
 * disk here, so we must NOT fire the /__claude-accept write-through.
 */
export async function applyAcceptedFromSync(id, acceptedAt) {
  await db.bugReports.update(id, {
    status: 'accepted',
    acceptedAt: acceptedAt || new Date().toISOString(),
  });
}

/**
 * Operator signs off on a resolved bug — the fix is confirmed good.
 * Status transitions: resolved → accepted. Accepted items fall out of
 * the default 'open' view but are still retrievable via the 'accepted'
 * filter and can still be Reopened if the issue recurs later.
 *
 * Writes through to claude-resolutions.json via /__claude-accept so the
 * acceptance survives an IndexedDB wipe / folder move.
 */
export async function acceptBug(id) {
  const now = new Date().toISOString();
  await db.bugReports.update(id, {
    status: 'accepted',
    acceptedAt: now,
  });
  // Fire-and-forget disk sync — errors don't block the local update.
  if (typeof fetch === 'function') {
    fetch('/__claude-accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], acceptedAt: now }),
    }).catch((err) => {
      console.warn('[bugQueue] accept disk sync failed (local state still updated):', err);
    });
  }
}

/**
 * Re-open a previously-resolved or accepted bug with an optional follow-up
 * comment. The comment is appended to `reopenHistory` so the audit trail
 * survives subsequent Resolve → Reopen cycles — Claude can read the history
 * and see exactly what the operator flagged each time the fix came back.
 *
 * Bug #47 (note): operator can also attach screenshots / files when reopening,
 * mirroring the initial-submit flow. Attachments are stored on the history
 * entry itself (not the top-level bug) so each reopen round keeps its own
 * evidence and the UI can render them inline under the matching note.
 *
 * @param {number} id
 * @param {object} [opts]
 * @param {string} [opts.note]               — operator's reason for reopening
 * @param {Array}  [opts.attachments]        — { name, type, size, dataUrl }[]
 */
export async function reopen(id, { note = null, attachments = [] } = {}) {
  const existing = await db.bugReports.get(id);
  const prior = Array.isArray(existing?.reopenHistory) ? existing.reopenHistory : [];
  const cleanAttachments = Array.isArray(attachments)
    ? attachments.filter(a => a && a.dataUrl).map(a => ({
        name: a.name || 'attachment',
        type: a.type || 'application/octet-stream',
        size: typeof a.size === 'number' ? a.size : 0,
        dataUrl: a.dataUrl,
      }))
    : [];
  const entry = {
    at: new Date().toISOString(),
    note: note ? String(note).trim() : null,
    fromStatus: existing?.status || null,
    priorResolutionNote: existing?.resolutionNote || null,
    priorResolvedAt: existing?.resolvedAt || null,
    priorAcceptedAt: existing?.acceptedAt || null,
    ...(cleanAttachments.length ? { attachments: cleanAttachments } : {}),
  };
  await db.bugReports.update(id, {
    status: 'open',
    resolvedAt: null,
    resolutionNote: null,
    acceptedAt: null,
    // Sink reopened items to the bottom of the ranked block. Clearing
    // priority makes listBugs() treat this entry as unranked (Infinity)
    // so it sorts below all 1..N drag-ranked items — the operator can
    // re-rank it from the UI if they want it higher. We deliberately do
    // NOT renumber existing priorities here; the next drag-drop will
    // refresh the order atomically via reorderOpenBugs().
    priority: null,
    reopenHistory: [...prior, entry],
  });

  // Fire-and-forget disk sync — remove the entry from claude-resolutions.json
  // so syncClaudeResolutions on the next mount doesn't immediately re-apply
  // the stale resolved/accepted status and clobber this reopen. Without this,
  // reopens appear to "not stick": the IndexedDB flip succeeds, but the very
  // next refresh reads the disk file, sees the resolvedAt/acceptedAt entry,
  // and flips the bug right back to resolved. Errors don't block the local
  // update — the reopen still sticks in IndexedDB for this session.
  if (typeof fetch === 'function') {
    fetch('/__claude-reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    }).catch((err) => {
      console.warn('[bugQueue] reopen disk sync failed (local reopen still applied):', err);
    });
  }
}

/**
 * Edit an existing bug's text and/or severity. Used by the inline edit UI
 * in BugQueueViewer so the operator can fix typos, expand context, or
 * re-tag severity on an open item without having to delete + re-create
 * (which would break the id and drop any priority/reopen history).
 *
 * Only `text`, `severity`, and `kind` are editable — status, id, createdAt,
 * capturedContext, recentEvents, and resolution/reopen history are all
 * immutable via this path. Also fires a write-through POST to
 * /__claude-note-edit so the change lands in claude-notes.md and survives
 * a rehydrate; without that, a Restore-from-disk pass would revert the
 * edit to whatever the original submission captured.
 *
 * @param {number} id
 * @param {object} patch
 * @param {string} [patch.text]      — new body (trimmed, required if provided)
 * @param {string} [patch.severity]  — one of SEVERITIES
 * @param {string} [patch.kind]      — one of KINDS
 */
export async function updateBug(id, patch = {}) {
  const update = {};
  if (typeof patch.text === 'string') {
    const trimmed = patch.text.trim();
    if (!trimmed) throw new Error('Bug text cannot be empty');
    update.text = trimmed;
  }
  if (typeof patch.severity === 'string' && SEVERITIES.includes(patch.severity)) {
    update.severity = patch.severity;
  }
  if (typeof patch.kind === 'string' && KINDS.includes(patch.kind)) {
    update.kind = patch.kind;
  }
  if (Object.keys(update).length === 0) return;
  await db.bugReports.update(id, update);

  // Fire-and-forget disk sync — rewrite the matching entry in claude-notes.md
  // so the edit survives a rehydrate. Errors don't block the local update.
  if (typeof fetch === 'function') {
    fetch('/__claude-note-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...update }),
    }).catch((err) => {
      console.warn('[bugQueue] note edit disk sync failed (local edit still applied):', err);
    });
  }
}

/**
 * Hard-delete a bug report. Use sparingly — prefer markResolved so the
 * historical record is preserved.
 */
export async function deleteBug(id) {
  await db.bugReports.delete(id);
}

/**
 * Parse claude-notes.md into structured entries. Mirrors the server-side
 * parser in vite.config.js so the rehydrate path works even when the JSON
 * scan endpoint isn't wired up (e.g. dev server was started before the
 * plugin added that middleware and hasn't been restarted). Pure — no Node
 * deps, safe for browser use.
 */
export function parseClaudeNotesMarkdown(raw) {
  const entries = [];
  const headerRe = /^## \[([^\]]+)\]\s+([A-Za-z]+)([^\n#]*?)#(\d+)\s*$/gm;
  const headers = [];
  let hm;
  while ((hm = headerRe.exec(raw)) !== null) {
    headers.push({
      index: hm.index,
      end: hm.index + hm[0].length,
      ts: hm[1],
      kind: hm[2],
      midRaw: hm[3],
      idStr: hm[4],
    });
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h.kind === 'resolution') continue;
    const id = Number(h.idStr);
    if (!Number.isFinite(id)) continue;
    if (h.kind === 'note' && /re-/i.test(h.midRaw)) continue;

    const parts = h.midRaw.split(/[|\u00B7]/).map((s) => s.trim()).filter(Boolean);
    let severity = null;
    let status = 'open';
    if (parts.length >= 2) {
      severity = parts[0];
      status = parts[1];
    } else if (parts.length === 1) {
      if (/^(open|resolved|closed)$/i.test(parts[0])) status = parts[0];
      else severity = parts[0];
    }
    if (!/^(open|resolved|closed)$/i.test(status)) status = 'open';
    status = status.toLowerCase();

    const nextStart = i + 1 < headers.length ? headers[i + 1].index : raw.length;
    let body = raw.slice(h.end, nextStart);
    body = body.replace(/\n-{3,}\s*$/m, '');

    const sceneRe = /_Scene:\s*([^|\u00B7_]+)[|\u00B7]\s*Character:\s*([^_]+)_/;
    const sm = sceneRe.exec(body);
    const scene = sm ? sm[1].trim() : null;
    const character = sm ? sm[2].trim() : null;
    const bodyStart = sm ? body.indexOf(sm[0]) + sm[0].length : 0;
    const text = body.slice(bodyStart).replace(/^\s+|\s+$/g, '');
    if (!text) continue;

    entries.push({
      id, kind: h.kind, severity, status, scene, character, text,
      createdAt: parseNotesTimestampClient(h.ts),
    });
  }
  const byId = new Map();
  for (const e of entries) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function parseNotesTimestampClient(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(ts || '').trim());
  if (!m) return new Date().toISOString();
  const [, Y, M, D, h, mm, s] = m;
  return new Date(`${Y}-${M}-${D}T${h}:${mm}:${s || '00'}Z`).toISOString();
}

/**
 * Try a sequence of disk-access strategies. Returns as soon as one succeeds.
 * The three paths exist because a running dev server might have ANY subset
 * of the middlewares depending on when it was started relative to the plugin
 * edits. Whichever responds with real content first wins.
 */
async function fetchEntriesFromDisk() {
  const attempts = [
    { url: '/__claude-notes-scan', kind: 'json' },
    { url: '/__claude-notes-raw', kind: 'raw' },
    { url: '/claude-notes.md', kind: 'raw' },
  ];
  const failures = [];
  for (const { url, kind } of attempts) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        failures.push(`${url} → HTTP ${resp.status}`);
        continue;
      }
      if (kind === 'json') {
        const data = await resp.json().catch(() => null);
        const entries = Array.isArray(data?.entries) ? data.entries : null;
        if (entries) return { entries, source: url };
        failures.push(`${url} → non-JSON response`);
        continue;
      }
      const text = await resp.text();
      // Heuristic: Vite's dev server serves index.html for unknown routes
      // (SPA fallback). If we asked for markdown and got a full HTML doc,
      // the middleware isn't wired up — skip, don't parse junk.
      const trimmed = text.trim();
      if (/^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed)) {
        failures.push(`${url} → got HTML fallback, not markdown`);
        continue;
      }
      const entries = parseClaudeNotesMarkdown(text);
      return { entries, source: url };
    } catch (err) {
      failures.push(`${url} → ${err?.message || err}`);
    }
  }
  const msg = `Could not reach claude-notes.md via any of the known paths. Restart the Vite dev server (stop and re-run \`npm run dev\`) so the claude-notes plugin middleware is active. Attempts: ${failures.join('; ')}`;
  const e = new Error(msg);
  e.failures = failures;
  throw e;
}

/**
 * Rehydrate the IndexedDB queue from claude-notes.md (the on-disk source
 * of truth). Called when the operator's IndexedDB is empty (e.g. after a
 * browser reset, a folder move that changed the origin, or a fresh clone).
 *
 * Contract:
 *  - `onlyMissing: true` (default) — only inserts entries whose id is not
 *    already in IndexedDB. Safe to run repeatedly.
 *  - `onlyMissing: false` — upsert every entry from disk. Useful when the
 *    operator deliberately wants to overwrite local state with what's on
 *    disk (e.g. after hand-editing claude-notes.md).
 *
 * Returns { added, skipped, total, source }. Throws with an actionable
 * message if every disk-access path fails (usually: dev server needs
 * restarting after the claude-notes plugin was updated).
 */
export async function rehydrateFromMarkdown({ onlyMissing = true } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch unavailable — rehydrate needs a browser context');
  }
  const { entries, source } = await fetchEntriesFromDisk();

  const existing = await db.bugReports.toArray();
  const existingIds = new Set(existing.map((b) => b.id));

  let added = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!Number.isFinite(e?.id)) { skipped++; continue; }
    if (onlyMissing && existingIds.has(e.id)) { skipped++; continue; }
    const record = {
      id: e.id,
      createdAt: e.createdAt || new Date().toISOString(),
      kind: KINDS.includes(e.kind) ? e.kind : 'bug',
      severity: SEVERITIES.includes(e.severity) ? e.severity : 'minor',
      status: e.status === 'resolved' ? 'resolved' : 'open',
      text: String(e.text || '').trim() || '(no body)',
      scene: e.scene || null,
      character: e.character || null,
      capturedContext: null,
      recentEvents: [],
      engineTrace: [],
      resolvedAt: null,
      resolutionNote: null,
    };
    // `put` preserves the explicit id (Dexie honors the provided id even
    // when the schema uses `++id` auto-increment).
    await db.bugReports.put(record);
    added++;
  }
  return { added, skipped, total: entries.length, source };
}

/**
 * Helper for the bug button: snapshot whatever rules event happened most
 * recently, so the modal can pre-fill its editable context section.
 */
export function snapshotCurrentContext() {
  const last = getLastEvent();
  if (!last) return null;
  return {
    when: last.createdAt,
    kind: last.kind,
    character: last.character,
    skill: last.skill,
    summary: last.summary,
    input: last.input,
    output: last.output,
  };
}

/**
 * Defensive escape for operator-typed text rendered into markdown.
 */
function escapeMarkdownText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/^(\s*)#/gm, '$1\u200B#')
    .replace(/```/g, '`\u200B``');
}

/** Escape operator-typed values used in single-line contexts (header tags). */
function escapeMarkdownInline(s) {
  if (s == null) return '';
  return String(s).replace(/[\r\n]+/g, ' ').replace(/`/g, "'");
}

/**
 * Render the entire open queue as a markdown document.
 *
 * For the default (open-only) export we call listBugs with status='open' so
 * the output honors the operator's drag-to-rank priority order — otherwise
 * Claude reads the exported queue in chronological order instead of the
 * importance order the operator deliberately set.
 */
export async function exportQueueAsMarkdown({ includeResolved = false } = {}) {
  const all = await listBugs();
  const filtered = includeResolved
    ? all
    : await listBugs({ status: 'open' });
  if (!filtered.length) return '# Bug Queue\n\n_(empty)_\n';

  const openCount = all.filter((b) => b.status === 'open').length;
  const resolvedCount = all.filter((b) => b.status === 'resolved').length;
  const acceptedCount = all.filter((b) => b.status === 'accepted').length;

  const lines = [];
  lines.push('# Bug Queue');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Open: ${openCount}`);
  lines.push(`Resolved: ${resolvedCount}`);
  lines.push(`Accepted: ${acceptedCount}`);
  if (!includeResolved) {
    lines.push('');
    lines.push(
      '> **Ordering:** top → bottom is the operator\'s drag-ranked importance order. '
      + 'Work through open items from the top down unless explicitly told otherwise.'
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (let i = 0; i < filtered.length; i++) {
    const bug = filtered[i];
    const kindLabel = bug.kind || 'bug';
    const sevSuffix = kindLabel === 'bug' ? ` [${bug.severity}]` : '';
    const rankPrefix = !includeResolved ? `[#${i + 1}] ` : '';
    lines.push(`## ${rankPrefix}#${bug.id} — ${kindLabel}${sevSuffix} ${bug.status}`);
    lines.push('');
    if (!includeResolved && Number.isFinite(bug.priority)) {
      lines.push(`**Priority rank:** ${bug.priority}`);
    }
    lines.push(`**Captured:** ${bug.createdAt}`);
    if (bug.character) lines.push(`**Character:** ${escapeMarkdownInline(bug.character)}`);
    if (bug.scene) lines.push(`**Scene:** ${escapeMarkdownInline(bug.scene)}`);
    lines.push('');
    lines.push('**Report:**');
    lines.push('');
    lines.push(escapeMarkdownText(bug.text));
    lines.push('');
    if (bug.capturedContext) {
      lines.push('**Captured context:**');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(bug.capturedContext, null, 2));
      lines.push('```');
      lines.push('');
    }
    if (bug.recentEvents?.length) {
      lines.push('<details><summary>Recent rules events at capture time</summary>');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(bug.recentEvents, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (bug.engineTrace?.length) {
      lines.push('<details><summary>Recent engine trace at capture time</summary>');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(bug.engineTrace, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (bug.resolutionNote) {
      lines.push(`**Resolution:** ${escapeMarkdownInline(bug.resolutionNote)}`);
      if (bug.resolvedAt) {
        lines.push(`**Resolved at:** ${bug.resolvedAt}`);
      }
      lines.push('');
    }
    if (bug.status === 'accepted' && bug.acceptedAt) {
      lines.push(`**Accepted at:** ${bug.acceptedAt} (operator signed off)`);
      lines.push('');
    }
    if (Array.isArray(bug.reopenHistory) && bug.reopenHistory.length > 0) {
      lines.push('**Reopen history:**');
      lines.push('');
      for (const h of bug.reopenHistory) {
        const when = (h.at || '').slice(0, 16).replace('T', ' ');
        const fromStatus = h.fromStatus ? ` (was ${h.fromStatus})` : '';
        const noteLine = h.note
          ? `\n  > ${escapeMarkdownInline(h.note)}`
          : '\n  > _(no comment)_';
        lines.push(`- ${when}${fromStatus}${noteLine}`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

export default {
  appendBug,
  listBugs,
  markResolved,
  acceptBug,
  reopen,
  deleteBug,
  updateBug,
  rehydrateFromMarkdown,
  snapshotCurrentContext,
  exportQueueAsMarkdown,
  setBugPriority,
  reorderOpenBugs,
  applyAcceptedFromSync,
  SEVERITIES,
  KINDS,
};
