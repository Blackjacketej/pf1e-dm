// ─────────────────────────────────────────────────────────────
// Faction Tracker — the party's earned knowledge of factions.
//
// Mirrors bestiaryTracker.js for creatures and npcTracker for NPCs:
// only information the party has actually WITNESSED or LEARNED
// about a faction is stored. The DM-facing full state (mood,
// resources, secrets, private relations) stays on campaign.factions
// and is NEVER copied into this store.
//
// Discovery methods:
//   'member-met'   — party met a known member of this faction
//   'named'        — an NPC named the faction to the party
//   'research'     — Knowledge (local/nobility/religion) check passed
//   'observed'     — party witnessed an event attributable to the faction
//
// Each call to recordEncounteredFaction upserts + increments:
//   encounters   — count of distinct witness events
//   membersKnown — set of NPC ids the party knows belong to this faction
//   knowledgeLevel — 0..4, gating how much detail publicFactionView reveals
//     0: existence only ("there's some group operating here…")
//     1: name known + archetype (tribe, cult, mercantile, etc.)
//     2: broad goals + known members
//     3: known relations to other encountered factions
//     4: leader identified + public reputation
// ─────────────────────────────────────────────────────────────

import { db } from '../db/database';
import { getActiveCampaignDataId } from './campaignScope';
import { emitJournalAdd } from './journalEvents';

const VALID_METHODS = new Set(['member-met', 'named', 'research', 'observed']);

// v11 — encounteredFactions are scoped to the active campaign. The primary
// key is still `factionId` (a stable string), so within a single campaign a
// faction has at most one row. Across campaigns, the row would collide on
// the primary key — but in practice only one campaign is loaded at a time
// (snapshot/restore in saveGame handles cross-campaign transitions).

/**
 * Upsert a faction-encounter record.
 *
 * @param {string} factionId   Must match campaign.factions[id]
 * @param {object} factionData Live-state faction object (campaign.factions[id])
 * @param {object} context
 *   - method:        one of VALID_METHODS (default 'observed')
 *   - npcId:         id of the member that triggered this (for 'member-met')
 *   - location:      where the party learned about them
 *   - campaignName:  optional label
 *   - grantKnowledge: 0..4 bonus to knowledgeLevel (caller controls)
 */
export async function recordEncounteredFaction(factionId, factionData, context = {}) {
  if (!factionId || !factionData) return null;
  const method = VALID_METHODS.has(context.method) ? context.method : 'observed';
  const now = new Date().toISOString();
  const campaignDataId = getActiveCampaignDataId() || 'orphan';
  // v11 — the row is keyed by factionId (single-PK). If a different campaign
  // wrote a row under the same factionId, treat it as "no existing entry"
  // for this campaign and overwrite below. The reset-on-campaign-switch +
  // save snapshot pattern keeps this safe in practice.
  const existingRow = await db.encounteredFactions.get(factionId);
  const existing = existingRow && existingRow.campaignDataId === campaignDataId ? existingRow : null;

  if (!existing) {
    // Seed with minimum-knowledge view — name only revealed on 'named' or
    // 'research' discovery. 'member-met' or 'observed' starts at level 0.
    const baseKnowledge =
      method === 'named' || method === 'research' ? 1 :
      method === 'member-met' ? 1 :
      0;
    const knowledgeLevel = Math.min(4, baseKnowledge + (context.grantKnowledge || 0));
    const record = {
      factionId,
      campaignDataId,
      name: factionData.name || factionId,
      archetype: factionData.archetype || 'unknown',
      firstSeenAt: now,
      lastSeenAt: now,
      firstSeenLocation: context.location || null,
      lastSeenLocation: context.location || null,
      discoveryMethod: method,
      encounters: 1,
      membersKnown: context.npcId ? [context.npcId] : [],
      knowledgeLevel,
      publicGoals: Array.isArray(factionData.life?.goals)
        ? factionData.life.goals
            .filter(g => g.visibility !== 'hidden' && g.visibility !== 'secret')
            .map(g => g.narrative || g.topic || '')
            .filter(Boolean)
        : [],
      playerNotes: '',
    };
    await db.encounteredFactions.put(record);
    emitJournalAdd({
      kind: 'faction',
      label: record.name,
      detail: context.location ? `discovered in ${context.location}` : null,
      id: factionId,
    });
    return record;
  }

  // Update: bump encounters, freshen lastSeen, merge member, possibly
  // upgrade knowledgeLevel if the new method reveals more.
  const members = new Set(existing.membersKnown || []);
  if (context.npcId) members.add(context.npcId);
  const upgradeFor = {
    'member-met': 1,
    'named': 2,
    'observed': 1,
    'research': 3,
  };
  const newLevel = Math.max(
    existing.knowledgeLevel || 0,
    Math.min(4, (upgradeFor[method] || 0) + (context.grantKnowledge || 0))
  );
  const updates = {
    lastSeenAt: now,
    lastSeenLocation: context.location || existing.lastSeenLocation,
    encounters: (existing.encounters || 0) + 1,
    membersKnown: [...members],
    knowledgeLevel: newLevel,
    // Name comes in if it wasn't known before and this method reveals it
    name: existing.name === factionId && (method === 'named' || method === 'research')
      ? (factionData.name || existing.name)
      : existing.name,
    // Re-stamp scope so a row claimed from legacy/orphan moves under the
    // current campaign. No-op when already correctly scoped.
    campaignDataId,
  };
  await db.encounteredFactions.update(factionId, updates);
  return { ...existing, ...updates };
}

/**
 * Convenience: when the party meets an NPC, record every faction that NPC
 * belongs to as 'member-met'. Idempotent — safe to call repeatedly.
 */
export async function recordFactionsFromNPC(npc, campaign, context = {}) {
  if (!npc || !Array.isArray(npc.factions) || !campaign?.factions) return;
  for (const fid of npc.factions) {
    const faction = campaign.factions[fid];
    if (!faction) continue;
    await recordEncounteredFaction(fid, faction, {
      ...context,
      method: 'member-met',
      npcId: npc.id,
    });
  }
}

/** Unlock a knowledge level bump (e.g. after a successful Knowledge check). */
export async function unlockFactionKnowledge(factionId, grant = 1) {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return null;
  const existing = await db.encounteredFactions.get(factionId);
  if (!existing || existing.campaignDataId !== campaignDataId) return null;
  const newLevel = Math.min(4, (existing.knowledgeLevel || 0) + grant);
  if (newLevel === existing.knowledgeLevel) return existing;
  await db.encounteredFactions.update(factionId, { knowledgeLevel: newLevel });
  return { ...existing, knowledgeLevel: newLevel };
}

/** Free-form player note attached to the encountered faction. */
export async function setFactionPlayerNote(factionId, text) {
  // No-op if the row belongs to a different campaign — defends against UI
  // races where a stale faction id from another campaign somehow leaks.
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return;
  const existing = await db.encounteredFactions.get(factionId);
  if (!existing || existing.campaignDataId !== campaignDataId) return;
  await db.encounteredFactions.update(factionId, { playerNotes: text || '' });
}

/** All factions the party has discovered (current campaign only), most recent first. */
export async function getEncounteredFactions() {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  const all = await db.encounteredFactions
    .where('campaignDataId')
    .equals(campaignDataId)
    .toArray();
  return all.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
}

/**
 * Redact live-state faction data down to what the party has earned.
 *
 * NEVER exposes: life.mood, life.resources, life.secrets, life.leadership
 * (unless knowledgeLevel≥4), private relations, hidden goals.
 *
 * @param {object} record  row from encounteredFactions
 * @param {object} faction live campaign.factions[id]   (optional — used for
 *                         fresh public goals + public relations)
 * @param {object} opts    { encounteredFactionIds?: Set<string> } — used to
 *                         filter relations to other factions the party has
 *                         ALSO encountered (relations to unknown factions
 *                         are hidden).
 */
export function publicFactionView(record, faction = null, opts = {}) {
  if (!record) return null;
  const level = record.knowledgeLevel || 0;
  const identified = level >= 1;
  const displayName = identified ? record.name : `an unnamed ${record.archetype || 'group'}`;
  const view = {
    factionId: record.factionId,
    displayName,
    identified,
    archetype: level >= 1 ? record.archetype : null,
    encounters: record.encounters || 1,
    membersKnown: record.membersKnown || [],
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    firstSeenLocation: record.firstSeenLocation,
    lastSeenLocation: record.lastSeenLocation,
    discoveryMethod: record.discoveryMethod,
    knowledgeLevel: level,
    playerNotes: record.playerNotes || '',
    publicGoals: level >= 2 ? (record.publicGoals || []) : [],
    relations: null,
    leader: null,
    reputation: null,
  };

  if (!faction) return view;

  // Fresh pull of PUBLIC goals from live faction (in case they changed)
  if (level >= 2 && Array.isArray(faction.life?.goals)) {
    view.publicGoals = faction.life.goals
      .filter(g => g.visibility !== 'hidden' && g.visibility !== 'secret')
      .map(g => g.narrative || g.topic || '')
      .filter(Boolean);
  }

  // Relations — only to factions the party has also encountered, and only
  // relations that aren't marked secret.
  if (level >= 3 && faction.relations) {
    const known = opts.encounteredFactionIds || new Set();
    view.relations = {};
    for (const [otherId, rel] of Object.entries(faction.relations)) {
      if (!known.has(otherId)) continue;
      if (rel && rel.secret) continue;
      view.relations[otherId] = rel && typeof rel === 'object'
        ? { standing: rel.standing, label: rel.label }
        : rel;
    }
  }

  // Leader + public reputation unlock at highest tier
  if (level >= 4) {
    view.leader = faction.life?.leadership?.current || null;
    view.reputation = faction.life?.publicReputation || null;
  }

  return view;
}
