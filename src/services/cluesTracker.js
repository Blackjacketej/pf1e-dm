/**
 * Clues & Hints tracker (claude-notes #34).
 *
 * The party's "did we follow up on that?" memory — clues, hints, leads,
 * rumors, and open to-dos the GM (or the AI narrator) wants the players
 * to be able to recall session-over-session.
 *
 * Per-campaign scoped via `campaignScope.js` — reads return only the
 * active campaign's rows, writes stamp them with the active scope.
 * Mirrors the bestiaryTracker / npcTracker / factionTracker pattern so
 * any tooling built for those tables (saveGame snapshot, journalReset
 * wipe, AdventurerJournal rendering) picks this up uniformly.
 *
 * Categories are soft — the UI uses them for filtering + coloring but
 * the app never enforces a finite set. Unknown categories render as
 * `'other'` in the filter row.
 */

import { db } from '../db/database';
import { getActiveCampaignDataId } from './campaignScope';
import { emitJournalAdd } from './journalEvents';

// Canonical category list. The UI renders in this order.
export const CLUE_CATEGORIES = ['clue', 'hint', 'lead', 'rumor', 'todo'];

// Recognized sources. 'ai' = pulled from DM narration, 'gm' = GM typed it,
// 'player' = added by a party member in the journal.
export const CLUE_SOURCES = ['ai', 'gm', 'player'];

/**
 * Normalize a raw clue payload to the on-disk shape. Accepts either a
 * string (treated as the `text`) or an object with any subset of fields.
 * Stamps createdAt + updatedAt. Does NOT attach campaignDataId — that's
 * added by the caller (addClue).
 */
function normalizeClueInput(input) {
  const now = new Date().toISOString();
  if (typeof input === 'string') {
    return {
      title: input.slice(0, 80),
      text: input,
      category: 'clue',
      source: 'gm',
      pinned: false,
      resolvedAt: null,
      relatedNpcIds: [],
      relatedFactionIds: [],
      relatedLocationIds: [],
      playerNotes: '',
      createdAt: now,
      updatedAt: now,
    };
  }
  const obj = input && typeof input === 'object' ? input : {};
  const text = typeof obj.text === 'string' ? obj.text : '';
  const title = typeof obj.title === 'string' && obj.title.length
    ? obj.title
    : text.slice(0, 80);
  const category = CLUE_CATEGORIES.includes(obj.category) ? obj.category : 'clue';
  const source = CLUE_SOURCES.includes(obj.source) ? obj.source : 'gm';
  return {
    title,
    text,
    category,
    source,
    pinned: Boolean(obj.pinned),
    resolvedAt: obj.resolvedAt || null,
    relatedNpcIds: Array.isArray(obj.relatedNpcIds) ? obj.relatedNpcIds.slice() : [],
    relatedFactionIds: Array.isArray(obj.relatedFactionIds) ? obj.relatedFactionIds.slice() : [],
    relatedLocationIds: Array.isArray(obj.relatedLocationIds) ? obj.relatedLocationIds.slice() : [],
    playerNotes: typeof obj.playerNotes === 'string' ? obj.playerNotes : '',
    createdAt: obj.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Add a new clue. Stamps the active campaign scope. Returns the full
 * stored row (with its new id).
 *
 * No-op when no campaign is active — returns null so the caller can
 * treat it as "nothing to do" instead of silently parking the row under
 * 'orphan'. (Unlike NPC auto-record, clue capture is almost always
 * user-initiated, so a missing scope is a real bug worth surfacing.)
 */
export async function addClue(input) {
  const scope = getActiveCampaignDataId();
  if (!scope) {
    // eslint-disable-next-line no-console
    console.warn('[cluesTracker] addClue called with no active campaign — skipping.');
    return null;
  }
  const row = { ...normalizeClueInput(input), campaignDataId: scope };
  const id = await db.encounteredClues.add(row);
  // Notify the narrative log. Category is emitted as `kind` so the log
  // line can distinguish clue vs hint vs lead vs rumor vs todo at a
  // glance, rather than a generic "clue" label for all five.
  emitJournalAdd({
    kind: row.category || 'clue',
    label: row.title || row.text || '(untitled)',
    id,
  });
  return { ...row, id };
}

/**
 * Fetch all clues for the active campaign, sorted newest-first with
 * pinned entries on top. Resolved clues are included — the UI filters
 * them out by default but a GM may want to review history.
 */
export async function getClues() {
  const scope = getActiveCampaignDataId();
  if (!scope) return [];
  const rows = await db.encounteredClues
    .where('campaignDataId')
    .equals(scope)
    .toArray();
  return rows.sort(compareClues);
}

/**
 * Fetch a single clue by primary key, scope-guarded. Returns null when
 * the row belongs to a different campaign or no campaign is loaded.
 */
export async function getClue(id) {
  if (id == null) return null;
  const scope = getActiveCampaignDataId();
  if (!scope) return null;
  const row = await db.encounteredClues.get(id);
  if (!row || row.campaignDataId !== scope) return null;
  return row;
}

/**
 * Patch an existing clue. Refuses to touch rows that don't belong to
 * the active campaign (cross-scope write protection). Returns the
 * updated row or null.
 */
export async function updateClue(id, patch) {
  const scope = getActiveCampaignDataId();
  if (!scope || id == null) return null;
  const existing = await db.encounteredClues.get(id);
  if (!existing || existing.campaignDataId !== scope) return null;
  const next = {
    ...existing,
    ...patch,
    // Preserve scope + id; bump updatedAt. Category / source coerced
    // back to the canonical vocabulary if the caller passed garbage.
    id: existing.id,
    campaignDataId: existing.campaignDataId,
    category: CLUE_CATEGORIES.includes(patch?.category) ? patch.category : existing.category,
    source: CLUE_SOURCES.includes(patch?.source) ? patch.source : existing.source,
    updatedAt: new Date().toISOString(),
  };
  await db.encounteredClues.put(next);
  return next;
}

/**
 * Mark a clue resolved (or unresolved if `resolved=false`). Resolved
 * clues stay in the table so the party can review what they followed
 * up on — the UI just filters them below the fold.
 *
 * Optional `opts` lets the caller attach closure context in the SAME
 * write (no second-updateClue race — see parked #64 follow-up). When
 * `resolved === true` and either `noteSuffix` or `evidence` is passed:
 *   - `noteSuffix` → appended as `Resolved: ${noteSuffix}` on its own line
 *   - `evidence`   → appended as `Heard: "${evidence}"` on its own line
 * The original `text` is preserved on top; the suffix is additive.
 * `opts` is ignored when unresolving (resolved=false).
 */
export async function resolveClue(id, resolved = true, opts = {}) {
  const patch = {
    resolvedAt: resolved ? new Date().toISOString() : null,
  };
  const { noteSuffix, evidence } = opts || {};
  if (resolved && (noteSuffix || evidence)) {
    const scope = getActiveCampaignDataId();
    if (scope && id != null) {
      const existing = await db.encounteredClues.get(id);
      if (existing && existing.campaignDataId === scope) {
        const parts = [existing.text || ''];
        if (noteSuffix) parts.push(`Resolved: ${noteSuffix}`);
        if (evidence) parts.push(`Heard: "${evidence}"`);
        patch.text = parts.filter(Boolean).join('\n');
      }
    }
  }
  return updateClue(id, patch);
}

/**
 * Toggle pinned state. Pinned clues float to the top of the list.
 */
export async function setCluePinned(id, pinned) {
  return updateClue(id, { pinned: Boolean(pinned) });
}

/**
 * Delete a clue. Scope-guarded — won't touch rows from a different
 * campaign even if the caller passed a stale id.
 */
export async function deleteClue(id) {
  const scope = getActiveCampaignDataId();
  if (!scope || id == null) return false;
  const existing = await db.encounteredClues.get(id);
  if (!existing || existing.campaignDataId !== scope) return false;
  await db.encounteredClues.delete(id);
  return true;
}

/**
 * Count the active campaign's clues, split by category + resolution
 * state. Used by the journal summary strip so players can see "3 open
 * leads, 1 rumor" at a glance without opening the full list.
 */
export async function summarizeClues() {
  const scope = getActiveCampaignDataId();
  const out = { total: 0, open: 0, resolved: 0, pinned: 0, byCategory: {} };
  if (!scope) return out;
  const rows = await db.encounteredClues
    .where('campaignDataId')
    .equals(scope)
    .toArray();
  for (const r of rows) {
    out.total += 1;
    if (r.resolvedAt) out.resolved += 1;
    else out.open += 1;
    if (r.pinned) out.pinned += 1;
    const cat = CLUE_CATEGORIES.includes(r.category) ? r.category : 'other';
    out.byCategory[cat] = (out.byCategory[cat] || 0) + 1;
  }
  return out;
}

/**
 * Fetch open clues pre-formatted for the AI narrator's prompt context.
 * Pinned-first, then newest-first; resolved clues filtered out.
 *
 * Returns `{ clues, text }`:
 *   - `clues` is the raw rows (truncated to `limit`) for debugging / tests
 *   - `text` is a ready-to-inject block ("PARTY'S CURRENT LEADS:\n- ...") or
 *     empty string when there's nothing to inject
 *
 * Token budget: each clue is clipped to `titleChars` + `textChars` so a
 * default call stays under ~2 KB even with a full queue. The narrator
 * prompt already carries the full campaign/party/scene context, so this
 * is a thin addition rather than a primary signal.
 *
 * Silent no-op (returns empty text) when no campaign is active — keeps
 * narrate() call sites free of scope-check clutter.
 */
export async function getOpenCluesForPrompt({
  limit = 10,
  titleChars = 60,
  textChars = 140,
} = {}) {
  const scope = getActiveCampaignDataId();
  if (!scope) return { clues: [], text: '' };
  const all = await db.encounteredClues
    .where('campaignDataId')
    .equals(scope)
    .toArray();
  const open = all
    .filter(c => !c.resolvedAt)
    .sort(compareClues)
    .slice(0, limit);
  if (open.length === 0) return { clues: [], text: '' };

  const lines = open.map(c => {
    const title = truncate(c.title || c.text || '(untitled)', titleChars);
    const body = truncate(c.text || '', textChars);
    const cat = c.category ? `[${c.category}]` : '[clue]';
    const pin = c.pinned ? '★ ' : '';
    // Only include body if it adds something beyond the title — titles
    // frequently are the first 80 chars of the text.
    const same = body.startsWith(title) || title.startsWith(body);
    return same
      ? `- ${pin}${cat} ${title}`
      : `- ${pin}${cat} ${title} — ${body}`;
  });
  const header = "PARTY'S CURRENT LEADS (unresolved clues, hints, rumors — weave callbacks naturally, don't dump them):";
  return { clues: open, text: `${header}\n${lines.join('\n')}` };
}

function truncate(s, n) {
  if (!s) return '';
  const clean = String(s).replace(/\s+/g, ' ').trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n - 1).trimEnd() + '…';
}

/**
 * Sort helper — pinned first, then newest-first by createdAt.
 * Resolved clues are NOT demoted here; the UI handles that via its
 * filter toggle so the GM can sort a historical list chronologically
 * without pinning churn.
 */
function compareClues(a, b) {
  const pa = a.pinned ? 1 : 0;
  const pb = b.pinned ? 1 : 0;
  if (pa !== pb) return pb - pa;
  const ta = a.createdAt || '';
  const tb = b.createdAt || '';
  if (ta === tb) return (b.id || 0) - (a.id || 0);
  return ta < tb ? 1 : -1;
}
