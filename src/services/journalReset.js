/**
 * Journal reset — clears the per-party "what the characters have discovered"
 * tables for a given campaign so a fresh game starts with an empty adventurer's
 * journal.
 *
 * v11 context: all 6 journal tables (journalNotes, encounteredCreatures,
 * encounteredNpcs, encounteredFactions, encounteredLocations, areaItems) are
 * scoped by campaignDataId. Every operation in this module is also scoped —
 * we only ever read/clear/snapshot rows belonging to the active campaign.
 * This means two campaigns can coexist in the DB without their journals
 * bleeding across, and a "reset" or "save" only touches the current game.
 *
 * Legacy pre-v11 rows are tagged 'legacy' by the Dexie upgrade callback and
 * remain untouched by these helpers unless the caller explicitly targets
 * them.
 *
 * Safe to call: wraps each operation in a try/catch so a single missing table
 * (e.g. during an in-flight Dexie upgrade) can't block the whole pass.
 */

import db from '../db/database';
import { getActiveCampaignDataId } from './campaignScope';

// Tables to clear on new-game reset / snapshot on save. gameLog and
// campaignProgress are already campaignId-scoped via their own columns so we
// leave them alone; downstream reads filter by the current campaign id.
//
// v12 adds `encounteredClues` here so clues & hints follow the same
// save-snapshot / fresh-game-reset lifecycle as everything else in the
// journal.
const JOURNAL_TABLES = [
  'journalNotes',
  'encounteredCreatures',
  'encounteredNpcs',
  'encounteredFactions',
  'encounteredLocations',
  'areaItems',
  'encounteredClues',
];

/**
 * Resolve the scope to operate on. Accepts an explicit override (useful for
 * tests or cross-campaign admin ops); otherwise defaults to the active scope.
 * Returns null when no campaign is loaded AND no override is given — callers
 * should no-op in that case rather than accidentally touching the whole DB.
 */
function resolveScope(override) {
  if (override) return override;
  return getActiveCampaignDataId() || null;
}

/**
 * Count rows the active campaign currently owns in each journal table.
 * Returns `{ counts: { table: n }, total }`. Pre-v11 'legacy' rows are
 * excluded because we filter by the active campaignDataId.
 */
export async function countJournalEntries(campaignDataIdOverride = null) {
  const scope = resolveScope(campaignDataIdOverride);
  const counts = {};
  let total = 0;
  for (const name of JOURNAL_TABLES) {
    try {
      const table = db.table(name);
      const n = scope
        ? await table.where('campaignDataId').equals(scope).count()
        : 0;
      counts[name] = n;
      total += n;
    } catch {
      counts[name] = 0;
    }
  }
  return { counts, total };
}

/**
 * Clear all journal rows belonging to the active campaign. Leaves other
 * campaigns' rows and 'legacy' rows untouched.
 *
 * If no campaign is active this is a no-op (returns zero cleared) — we don't
 * want a stray reset call to nuke every campaign's journal because the scope
 * helper got cleared mid-flow.
 */
export async function resetJournalData(campaignDataIdOverride = null) {
  const scope = resolveScope(campaignDataIdOverride);
  if (!scope) {
    return { cleared: 0, errors: [], skipped: 'no-active-campaign' };
  }
  const errors = [];
  let cleared = 0;
  for (const name of JOURNAL_TABLES) {
    try {
      await db.table(name).where('campaignDataId').equals(scope).delete();
      cleared += 1;
    } catch (err) {
      errors.push({ table: name, message: err?.message || String(err) });
    }
  }
  return { cleared, errors };
}

/**
 * Snapshot the active campaign's journal into a plain object keyed by table.
 *
 * Used by saveGame() so a named save captures this campaign's adventurer's
 * journal alongside party/campaign/world state. Other campaigns' rows are
 * NEVER included in the snapshot — that way loading a save and re-tagging
 * the rows (see importJournalData) doesn't accidentally overwrite another
 * campaign's entries.
 *
 * Returns `{ journalNotes: [...], encounteredCreatures: [...], ... }` or
 * empty arrays when no campaign is active. Never throws.
 */
export async function exportJournalData(campaignDataIdOverride = null) {
  const scope = resolveScope(campaignDataIdOverride);
  const out = {};
  for (const name of JOURNAL_TABLES) {
    try {
      out[name] = scope
        ? await db.table(name).where('campaignDataId').equals(scope).toArray()
        : [];
    } catch {
      out[name] = [];
    }
  }
  return out;
}

/**
 * Restore journal tables from a snapshot produced by exportJournalData().
 *
 * v11 semantics: every incoming row is re-tagged with the active campaign's
 * id before it's written. This handles two cases cleanly:
 *   1. A save produced under the current campaign — the tags already match,
 *      re-tagging is a no-op.
 *   2. A save produced pre-v11 (no campaignDataId on any row) or moved from
 *      a different DB/campaign — the rows get reassigned to this campaign
 *      instead of lingering under a dead scope.
 *
 * Replace semantics: the current campaign's journal rows are wiped and
 * replaced with what's in `data`. Other campaigns' rows are untouched.
 *
 * If `data` is missing or not an object (legacy v3 saves), this is a no-op
 * and the current journal stays intact.
 */
export async function importJournalData(data, campaignDataIdOverride = null) {
  if (!data || typeof data !== 'object') return { restored: {}, skipped: true };
  const scope = resolveScope(campaignDataIdOverride);
  if (!scope) return { restored: {}, skipped: 'no-active-campaign' };
  const restored = {};
  for (const name of JOURNAL_TABLES) {
    const rows = Array.isArray(data[name]) ? data[name] : null;
    if (!rows) {
      // Key absent entirely — don't touch this table. Lets a partial
      // snapshot (future schema where only some journal tables are
      // persisted per-save) co-exist with older saves.
      restored[name] = null;
      continue;
    }
    try {
      const table = db.table(name);
      // Clear only THIS campaign's existing rows — other campaigns' rows
      // stay intact.
      await table.where('campaignDataId').equals(scope).delete();
      if (rows.length > 0) {
        // Re-tag every row with the active scope before inserting. This is
        // critical for cross-campaign / pre-v11 saves: without the stamp
        // the rows would come in tagged 'legacy' or missing the column
        // entirely and become invisible to scoped reads.
        const stamped = rows.map(r => ({ ...r, campaignDataId: scope }));
        await table.bulkPut(stamped);
      }
      restored[name] = rows.length;
    } catch (err) {
      restored[name] = { error: err?.message || String(err) };
    }
  }
  return { restored, skipped: false };
}
