// ─────────────────────────────────────────────────────────────
// Location Tracker — the party's earned knowledge of places.
//
// Mirrors factionTracker / bestiaryTracker. One row per location,
// keyed by a slug derived from the name. Stores only what the party
// has earned: first-seen timestamp, visit count, kind (town/dungeon/
// wilderness/landmark), plus free-form player notes.
//
// Cross-references (NPCs met here, factions active here, creatures
// encountered here) are NOT duplicated on the row — they're derived
// at render time by filtering the other stores on `location === name`.
// This avoids the sync problems that would come with mirroring.
// ─────────────────────────────────────────────────────────────

import { db } from '../db/database';
import { resolveMapPoiForLocation } from './mapRegistry';
import { getActiveCampaignDataId } from './campaignScope';
import { emitJournalAdd } from './journalEvents';

const VALID_KINDS = new Set(['town', 'wilderness', 'dungeon', 'landmark', 'unknown']);

// v11 — journal scope. All reads/writes are stamped + filtered by the active
// campaignDataId. 'legacy' is the sentinel for pre-v11 rows; 'orphan' is the
// fallback when a write happens without an active campaign (shouldn't occur
// in normal play but we preserve the data either way).

/** Deterministic slug so lookups are stable across calls. */
export function locationSlug(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Upsert a location visit. Idempotent; call every time the party enters
 * the location — first call creates, subsequent calls bump `visits` and
 * freshen `lastSeenAt`.
 *
 * @param {string} name     Human-readable location name (required)
 * @param {object} context
 *   - kind:        one of VALID_KINDS (default 'unknown')
 *   - description: short descriptor, stored as firstImpression on first visit
 *   - region:      optional parent region / area
 */
export async function recordEncounteredLocation(name, context = {}) {
  if (!name) return null;
  const id = locationSlug(name);
  if (!id) return null;
  const campaignDataId = getActiveCampaignDataId() || 'orphan';
  const kind = VALID_KINDS.has(context.kind) ? context.kind : 'unknown';
  const now = new Date().toISOString();
  // v11 — lookup is still by primary key (slug). The active campaign acts
  // as a filter on the result: a row keyed by 'sandpoint' that belongs to
  // a different campaign should not be treated as "existing" for the
  // current campaign — we'd want to overwrite it with this campaign's
  // first-visit metadata. Until compound PKs land in v12, in practice only
  // one campaign runs at a time so this collision is rare; the snapshot/
  // restore in saveGame handles the cross-save case.
  const existingRow = await db.encounteredLocations.get(id);
  const existing = existingRow && existingRow.campaignDataId === campaignDataId ? existingRow : null;

  // Try to link this location to a map POI. Safe if the bridge can't
  // find a match — mapId/poiId just stay null.
  let mapId = null;
  let poiId = null;
  try {
    const resolved = resolveMapPoiForLocation(name);
    if (resolved) { mapId = resolved.mapId; poiId = resolved.poiId; }
  } catch { /* map registry optional */ }

  // Task #71 — mentionOnly: true means "the party heard about this place
  // but hasn't been there." We record the row so the Journal's Places
  // tab can surface it, but we don't inflate the visit counter. A later
  // physical visit will still bump visits normally. `mentions` tracks
  // how many times narration name-dropped the place.
  const mentionOnly = context.mentionOnly === true;

  if (!existing) {
    const record = {
      locationId: id,
      campaignDataId,
      name,
      kind,
      region: context.region || null,
      firstImpression: context.description || null,
      firstSeenAt: now,
      lastSeenAt: now,
      visits: mentionOnly ? 0 : 1,
      mentions: mentionOnly ? 1 : 0,
      playerNotes: '',
      mapId,
      poiId,
    };
    await db.encounteredLocations.put(record);
    // Bug #71 (2026-04-20): "heard about" records (mentionOnly:true) used to
    // fire `new location: X` into the game log, but the mentioned-path in
    // AdventureTab also fires `addClue({category:'lead'})` for the same name
    // → operator saw `new lead: Cathedral Square` immediately followed by
    // `new location: Cathedral Square`. The clue/lead entry is the real
    // narrative signal for a mention; the Places row is a quiet bookkeeping
    // entry. Only announce physical discoveries, not mentions.
    if (!mentionOnly) {
      emitJournalAdd({
        kind: 'location',
        label: name,
        detail: context.region || null,
        id,
      });
    }
    return record;
  }

  const updates = {
    lastSeenAt: now,
    visits: mentionOnly ? (existing.visits || 0) : (existing.visits || 0) + 1,
    mentions: mentionOnly ? (existing.mentions || 0) + 1 : (existing.mentions || 0),
    // Upgrade kind if it was unknown and we now have better info
    kind: existing.kind === 'unknown' && kind !== 'unknown' ? kind : existing.kind,
    region: existing.region || context.region || null,
    // Back-fill map linkage if it wasn't known on the original record
    mapId: existing.mapId || mapId,
    poiId: existing.poiId || poiId,
    // Re-stamp scope in case a legacy/orphan row is being claimed by the
    // current campaign for the first time.
    campaignDataId,
  };
  await db.encounteredLocations.update(id, updates);
  return { ...existing, ...updates };
}

/** Free-form player note attached to the location. */
export async function setLocationPlayerNote(locationId, text) {
  await db.encounteredLocations.update(locationId, { playerNotes: text || '' });
}

/** All locations the party has visited (current campaign only), most recent first. */
export async function getEncounteredLocations() {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  const all = await db.encounteredLocations
    .where('campaignDataId')
    .equals(campaignDataId)
    .toArray();
  return all.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
}

/** Lookup by slug — returns the row only if it belongs to the active campaign. */
export async function getEncounteredLocation(locationId) {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return null;
  const row = await db.encounteredLocations.get(locationId);
  if (!row) return null;
  if (row.campaignDataId !== campaignDataId) return null;
  return row;
}

/**
 * Resolve the cross-refs for a location page. Callers pass in the
 * already-loaded shared state (so we don't hit the DB three extra
 * times per render).
 *
 * @returns {{ npcs: [], factions: [], creatures: [] }}
 */
export function deriveLocationRefs(locationName, { npcs = [], encounteredFactions = [], creatures = [], campaign = null } = {}) {
  const needle = (locationName || '').toLowerCase();
  const npcsHere = npcs.filter(n => (n.location || '').toLowerCase() === needle);
  const creaturesHere = creatures.filter(c => {
    const locs = Array.isArray(c.locationsSeen) ? c.locationsSeen : [];
    if (locs.some(l => (l || '').toLowerCase() === needle)) return true;
    return (c.lastSeenLocation || c.location || '').toLowerCase() === needle;
  });
  // Faction presence at a location is inferred: a faction is "active here"
  // if one of its known members has been met at this location.
  const npcIdsHere = new Set(npcsHere.map(n => n.id));
  const factionsHere = encounteredFactions.filter(f => {
    const members = f.membersKnown || [];
    return members.some(nid => npcIdsHere.has(nid));
  });
  return { npcs: npcsHere, factions: factionsHere, creatures: creaturesHere };
}

/**
 * Redact a location row for player-facing display. Today this just
 * passes the row through (locations don't have GM secrets the way
 * factions do), but having the shape in place means future gating
 * (e.g. "hidden rooms discovered") has a home.
 */
export function publicLocationView(record) {
  if (!record) return null;
  return {
    locationId: record.locationId,
    name: record.name,
    kind: record.kind || 'unknown',
    region: record.region || null,
    firstImpression: record.firstImpression || null,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    visits: record.visits || 1,
    playerNotes: record.playerNotes || '',
    mapId: record.mapId || null,
    poiId: record.poiId || null,
  };
}

/**
 * Build a set of visited POI ids for a given map. Used by InteractiveMap
 * to render visited-state highlights on pins. Scoped to the active campaign.
 */
export async function getVisitedPoisForMap(mapId) {
  if (!mapId) return new Set();
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return new Set();
  const all = await db.encounteredLocations
    .where('campaignDataId')
    .equals(campaignDataId)
    .toArray();
  return new Set(all.filter(r => r.mapId === mapId && r.poiId).map(r => r.poiId));
}
