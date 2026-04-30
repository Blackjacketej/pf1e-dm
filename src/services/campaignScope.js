/**
 * Campaign scope — single-source-of-truth for "what campaign is currently
 * active" so journal trackers can stamp + filter rows by campaignDataId
 * without every call site having to thread the campaign object through.
 *
 * Wired in App.jsx: setActiveCampaignDataId(campaign.data?.id || null)
 * runs on every campaign load/swap (including save-restore and the menu
 * "New Game" path).
 *
 * Sentinels:
 *   null     — no campaign loaded (boot, main menu). Reads return [].
 *   'legacy' — Dexie v10 rows that pre-date the per-campaign migration.
 *              Never written by app code; only set by the v11 .upgrade()
 *              callback. Read-side filters ignore these unless the operator
 *              explicitly opts in (e.g. a future "restore archived journal"
 *              tool).
 *   'orphan' — a write happened with no active campaign. Should not occur
 *              in normal play; if it does we still want the row preserved
 *              so it can be reattached after-the-fact.
 *
 * The "no journal without a campaign" semantic is intentional: the
 * adventurer's journal is the party's record of what they've discovered —
 * if there's no active party/campaign, there's nothing to record into.
 */

let currentCampaignDataId = null;

/**
 * Set (or clear) the active campaign id. Pass null/undefined to clear.
 * Idempotent — calling with the same id twice is a no-op.
 */
export function setActiveCampaignDataId(id) {
  const next = id || null;
  if (next === currentCampaignDataId) return;
  currentCampaignDataId = next;
  // eslint-disable-next-line no-console
  console.log('[CampaignScope] active campaignDataId =', next);
}

/**
 * Read the active campaign id. Returns null when no campaign is loaded.
 * Trackers should treat null as "no journal access" and return empty
 * results from reads / no-op on writes.
 */
export function getActiveCampaignDataId() {
  return currentCampaignDataId;
}

/**
 * Stamp a row with the active campaignDataId on write. If no campaign is
 * loaded we use the 'orphan' sentinel so the row is still captured (a
 * write without scope is almost certainly a bug, but losing the data is
 * worse than parking it under 'orphan' for later recovery).
 *
 * Helper exists so trackers don't have to repeat the null-coalesce.
 */
export function stampWithCampaignScope(row) {
  if (!row || typeof row !== 'object') return row;
  if (row.campaignDataId) return row;
  return { ...row, campaignDataId: currentCampaignDataId || 'orphan' };
}
