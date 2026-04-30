import Dexie from 'dexie';

export const db = new Dexie('PathfinderDM');

db.version(1).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  gameLog: '++id, campaignId, text, type, time',
});

db.version(2).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  gameLog: '++id, campaignId, text, type, time',
});

db.version(3).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  gameLog: '++id, campaignId, text, type, time',
});

db.version(4).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
});

db.version(5).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  // v5: encountered NPCs and area items
  encounteredNpcs: '++id, name, location, disposition, metAt',
  areaItems: '++id, name, location, found',
});

db.version(6).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  encounteredNpcs: '++id, name, location, disposition, metAt',
  areaItems: '++id, name, location, found',
  // v6: archetypes, skills reference, game rules
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
});

db.version(7).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  encounteredNpcs: '++id, name, location, disposition, metAt',
  areaItems: '++id, name, location, found',
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
  // v7: Adventurer's Journal — encountered creatures (party bestiary) and player notes
  encounteredCreatures: '++id, name, cr, type, firstSeenAt',
  journalNotes: '++id, createdAt, category',
});

db.version(8).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  encounteredNpcs: '++id, name, location, disposition, metAt',
  areaItems: '++id, name, location, found',
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
  encounteredCreatures: '++id, name, cr, type, firstSeenAt',
  journalNotes: '++id, createdAt, category',
  // v8: rules-audit infrastructure
  // bugReports — manually-captured issues from the in-game bug button
  // playLogEvents — structured firehose of every rules resolution (skill check, attack, damage, etc.)
  //                 used for after-the-fact CRB-fidelity review in Cowork
  bugReports: '++id, createdAt, severity, status',
  playLogEvents: '++id, sessionId, createdAt, kind, character, skill',
});

db.version(9).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  encounteredNpcs: '++id, name, location, disposition, metAt',
  areaItems: '++id, name, location, found',
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
  encounteredCreatures: '++id, name, cr, type, firstSeenAt',
  journalNotes: '++id, createdAt, category',
  bugReports: '++id, createdAt, severity, status',
  playLogEvents: '++id, sessionId, createdAt, kind, character, skill',
  // v9: encountered factions — player-facing record of factions the party has
  // discovered. factionId is primary — one row per faction. Stores ONLY what
  // the party has earned (discovery source, attitude, members met, public
  // intel). Internal mood/resources/secrets stay on campaign.factions.
  encounteredFactions: 'factionId, name, firstSeenAt, lastSeenAt, discoveryMethod',
});

db.version(10).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  encounteredNpcs: '++id, name, location, disposition, metAt',
  areaItems: '++id, name, location, found',
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
  encounteredCreatures: '++id, name, cr, type, firstSeenAt',
  journalNotes: '++id, createdAt, category',
  bugReports: '++id, createdAt, severity, status',
  playLogEvents: '++id, sessionId, createdAt, kind, character, skill',
  encounteredFactions: 'factionId, name, firstSeenAt, lastSeenAt, discoveryMethod',
  // v10: encountered locations — player-facing record of places the party has
  // visited. locationId is primary (slug of name). Stores visit count, first
  // impression, and player notes. Cross-references to NPCs / creatures /
  // factions live as derived views, not duplicated here.
  encounteredLocations: 'locationId, name, firstSeenAt, lastSeenAt, kind',
});

// v11 — Adventurer's Journal becomes per-campaign.
//
// Each of the six journal tables (encounteredNpcs, areaItems,
// encounteredCreatures, journalNotes, encounteredFactions,
// encounteredLocations) gains an indexed `campaignDataId` column so reads can
// filter to "the active campaign's journal" without a fullscan.
//
// Primary keys are deliberately unchanged in this version — a compound-PK
// migration is risky on the user's existing data and not strictly required
// while only one campaign is loaded at a time. The read-side scope filter
// (services/campaignScope.js + per-tracker `where('campaignDataId').equals(...)`)
// provides the practical isolation: each campaign sees only its own journal,
// and switching campaigns no longer requires the brittle "wipe all rows"
// dance journalReset used to perform.
//
// Cross-campaign primary-key collision (same locationId/factionId reused by
// a second active campaign) is a theoretical concern, but in practice only
// one campaign is loaded at runtime — so stamping campaignDataId on writes
// + filtering on reads is enough. If multi-campaign concurrency ever lands,
// upgrade to compound PKs in v12.
//
// Legacy rows (v10 and earlier) carry no campaignDataId. The upgrade
// callback tags them with the sentinel string 'legacy' so they survive the
// migration but are filtered out of normal play. The operator can pull them
// back in via a future "import legacy journal" tool if they ever miss the
// data — for now, they're effectively archived.
db.version(11).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
  bugReports: '++id, createdAt, severity, status',
  playLogEvents: '++id, sessionId, createdAt, kind, character, skill',
  // v11 journal tables — campaignDataId added as secondary index.
  encounteredNpcs: '++id, campaignDataId, name, location, disposition, metAt',
  areaItems: '++id, campaignDataId, name, location, found',
  encounteredCreatures: '++id, campaignDataId, name, cr, type, firstSeenAt',
  journalNotes: '++id, campaignDataId, createdAt, category',
  encounteredFactions: 'factionId, campaignDataId, name, firstSeenAt, lastSeenAt, discoveryMethod',
  encounteredLocations: 'locationId, campaignDataId, name, firstSeenAt, lastSeenAt, kind',
}).upgrade(async (tx) => {
  // Tag every pre-v11 row with campaignDataId='legacy' so the new indexed
  // column is populated and the row sorts into the "archived" bucket. We
  // do this for ALL six journal tables in parallel; per-table failures are
  // logged and don't abort the upgrade (a partially-tagged table just shows
  // its untagged rows as orphans, which the read-side filter ignores).
  const TABLES = [
    'encounteredNpcs',
    'areaItems',
    'encounteredCreatures',
    'journalNotes',
    'encounteredFactions',
    'encounteredLocations',
  ];
  const tagged = {};
  for (const name of TABLES) {
    try {
      let count = 0;
      await tx.table(name).toCollection().modify((row) => {
        if (!row.campaignDataId) {
          row.campaignDataId = 'legacy';
          count += 1;
        }
      });
      tagged[name] = count;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[Dexie v11] Failed to tag legacy rows in ${name}:`, err);
      tagged[name] = { error: err?.message || String(err) };
    }
  }
  // eslint-disable-next-line no-console
  console.log('[Dexie v11] Migration complete. Legacy rows tagged:', tagged);
});

// v12 — Clues & Hints memory (claude-notes #34).
//
// The party needs a place to remember "important topics encountered" —
// clues, hints, leads, rumors, and open questions — that can be called
// back up later in play. Previously these had to live in free-form
// journalNotes and weren't categorizable / pinnable / linkable.
//
// Table is per-campaign scoped (campaignDataId indexed) matching the v11
// pattern for every other journal table. Fields:
//   - campaignDataId: scope (indexed; null never written, 'orphan' fallback)
//   - title: short label shown in the list
//   - category: one of 'clue' | 'hint' | 'lead' | 'rumor' | 'todo'
//   - source: one of 'ai' | 'gm' | 'player' — where the entry originated
//   - pinned: boolean, sticks to top of the list
//   - resolvedAt: ISO string once the clue is "followed up" (null otherwise)
//   - createdAt / updatedAt: ISO strings
//
// relatedNpcIds / relatedFactionIds / relatedLocationIds are stored on the
// row (plain arrays) for cross-linking, but NOT indexed — lookup volume
// is tiny so a full-scan filter inside the active-campaign partition is
// fine, and Dexie's multi-entry index gymnastics aren't worth the
// complexity for <100 clues per campaign.
db.version(12).stores({
  races: 'name, size',
  classes: 'name, hd, bab',
  monsters: '++id, name, cr, type',
  spells: '++id, name, level, school, type',
  weapons: '++id, name, category, type',
  armor: '++id, name, type',
  shields: '++id, name',
  feats: '++id, name, category',
  traps: '++id, name, cr',
  treasure: '++id, name, type',
  locations: '++id, name, terrain',
  characters: '++id, name, race, class',
  campaigns: '++id, name, createdAt',
  campaignData: 'id, name',
  campaignProgress: '++id, campaignId, chapterId, partId, encounterId, status',
  npcs: '++id, name, cr, class, race',
  savedGames: '++id, name, savedAt',
  gameLog: '++id, campaignId, text, type, time',
  archetypes: '++id, name, class, source',
  skillsRef: '++id, name, ability',
  bugReports: '++id, createdAt, severity, status',
  playLogEvents: '++id, sessionId, createdAt, kind, character, skill',
  encounteredNpcs: '++id, campaignDataId, name, location, disposition, metAt',
  areaItems: '++id, campaignDataId, name, location, found',
  encounteredCreatures: '++id, campaignDataId, name, cr, type, firstSeenAt',
  journalNotes: '++id, campaignDataId, createdAt, category',
  encounteredFactions: 'factionId, campaignDataId, name, firstSeenAt, lastSeenAt, discoveryMethod',
  encounteredLocations: 'locationId, campaignDataId, name, firstSeenAt, lastSeenAt, kind',
  // v12 additions: per-campaign clues & hints tracker.
  encounteredClues: '++id, campaignDataId, category, source, pinned, createdAt, resolvedAt',
});

export default db;
