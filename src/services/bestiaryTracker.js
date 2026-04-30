// ─────────────────────────────────────────────────────────────
// Bestiary Tracker — the party's earned knowledge of creatures.
//
// IMPORTANT DESIGN RULE (player-facing journal):
// Only information the characters have actually OBSERVED or
// SUCCESSFULLY IDENTIFIED is stored here. On first encounter we
// log what's visually obvious (size, broad type, count). Stats
// like HP, AC, attacks, special abilities, immunities, weaknesses
// only get added when a successful Knowledge check unlocks them
// (1 fact per 5 over the DC, per CRB Ch. 4).
// ─────────────────────────────────────────────────────────────

import { db } from '../db/database';
import { getActiveCampaignDataId } from './campaignScope';
import { emitJournalAdd } from './journalEvents';

// v11 — every read/write is scoped to the active campaign via campaignDataId.
// Pre-v11 rows were tagged 'legacy' by the upgrade callback and are filtered
// out of normal play.
function activeScope() {
  return getActiveCampaignDataId() || 'orphan';
}

// What "broad type" looks like to a character with no training
// (a wolf is obviously an animal; a wraith obviously isn't)
const BROAD_TYPE = {
  aberration: 'twisted aberration',
  animal: 'animal',
  construct: 'construct',
  dragon: 'dragon',
  fey: 'fey-touched creature',
  humanoid: 'humanoid',
  'magical beast': 'magical beast',
  'monstrous humanoid': 'monstrous humanoid',
  ooze: 'ooze',
  outsider: 'otherworldly being',
  plant: 'plant creature',
  undead: 'undead',
  vermin: 'vermin',
};

function broadType(rawType) {
  if (!rawType) return 'creature';
  const key = String(rawType).toLowerCase();
  return BROAD_TYPE[key] || 'creature';
}

// Strip variant suffixes ("Goblin #2" → "Goblin") so we dedup correctly
function baseNameOf(c) {
  return String(c.baseName || c.name || 'unknown').replace(/\s+#\d+\s*$/, '').trim();
}

// Build the visible-on-sight description (no name, no stats)
function buildAppearance(c) {
  const size = c.size || 'Medium';
  const type = broadType(c.type);
  return `${size} ${type}`.trim();
}

// ── Record that the party encountered some creatures ──
// Stores ONLY what's obvious at a glance — no stats, no true name in display.
export async function recordEncounteredCreatures(creatures = [], context = {}) {
  if (!Array.isArray(creatures) || creatures.length === 0) return;
  const now = new Date().toISOString();
  const location = context.location || 'Unknown';
  const campaignName = context.campaignName || null;
  const campaignDataId = activeScope();

  for (const c of creatures) {
    if (!c || !c.name) continue;
    const internalKey = baseNameOf(c);  // used for dedup; never displayed when not identified
    // v11 — dedup is scoped to the active campaign so a "Goblin" in campaign A
    // doesn't merge with a "Goblin" in campaign B.
    const candidates = await db.encounteredCreatures.where('name').equals(internalKey).toArray();
    const existing = candidates.find(r => r.campaignDataId === campaignDataId) || null;
    if (existing) {
      await db.encounteredCreatures.update(existing.id, {
        encounters: (existing.encounters || 1) + 1,
        lastSeenAt: now,
        lastSeenLocation: location,
      });
    } else {
      // Only store sense-obvious facts. No HP, no AC, no abilities.
      const id = await db.encounteredCreatures.add({
        campaignDataId,
        name: internalKey,           // dedup key, not for display until identified
        identified: false,           // becomes true once any Knowledge fact is unlocked
        factsLearned: 0,
        appearance: buildAppearance(c),
        sizeObserved: c.size || 'Medium',
        broadTypeObserved: broadType(c.type),
        encounters: 1,
        defeated: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        firstSeenLocation: location,
        lastSeenLocation: location,
        campaignName,
        // Knowledge-gated fields: filled in by unlockCreatureKnowledge()
        knownName: null,
        knownType: null,
        knownCR: null,
        knownHD: null,
        knownHP: null,
        knownAC: null,
        knownAttacks: null,
        knownSpecialAbilities: null,
        knownDefenses: null,
        knownWeaknesses: null,
        knownAlignment: null,
        knownEnvironment: null,
        knownNotes: [],
      });
      // First-time encounter — notify the narrative log. Prefer the
      // obvious-sense appearance label over the internal dedup key so
      // the log respects the "don't reveal true name before identified"
      // rule (knownName stays null until Knowledge succeeds).
      emitJournalAdd({
        kind: 'creature',
        label: buildAppearance(c) || internalKey,
        detail: location && location !== 'Unknown' ? `seen in ${location}` : null,
        id,
      });
    }
  }
}

// ── Tally creatures the party defeated this fight ──
// (Defeating a creature is "observed information" — fine to store.)
export async function recordCreaturesDefeated(creatures = []) {
  if (!Array.isArray(creatures) || creatures.length === 0) return;
  const counts = {};
  for (const c of creatures) {
    if (!c || !c.name) continue;
    if ((c.currentHP ?? 0) > 0) continue;
    const k = String(c.baseName || c.name).replace(/\s+#\d+\s*$/, '').trim();
    counts[k] = (counts[k] || 0) + 1;
  }
  const campaignDataId = activeScope();
  for (const [name, count] of Object.entries(counts)) {
    // v11 — only bump the kill counter for the active campaign's row.
    const candidates = await db.encounteredCreatures.where('name').equals(name).toArray();
    const existing = candidates.find(r => r.campaignDataId === campaignDataId);
    if (existing) {
      await db.encounteredCreatures.update(existing.id, {
        defeated: (existing.defeated || 0) + count,
      });
    }
  }
}

// ── Unlock knowledge based on a successful identify check ──
// `factsLearned` is the count from countCreatureFactsLearned (1 + (over/5)).
// `creatureData` is the live combat enemy object (used as the source of
// truth for stats — we copy fields out of it as facts are unlocked).
//
// CRB fact order (commonly used):
//   1: Name + creature type/subtype + general powers
//   2: HD/HP and AC
//   3: Primary attacks
//   4: Special abilities (DR, SR, immunities, resistances)
//   5: Weaknesses, vulnerabilities, alignment hints
//   6+: Tactics, environment, lore
export async function unlockCreatureKnowledge(creatureData, factsLearned = 1) {
  if (!creatureData) return;
  const internalKey = baseNameOf(creatureData);
  // v11 — knowledge unlocks apply to the active campaign's bestiary entry only.
  const campaignDataId = activeScope();
  const candidates = await db.encounteredCreatures.where('name').equals(internalKey).toArray();
  const existing = candidates.find(r => r.campaignDataId === campaignDataId);
  if (!existing) return;

  // Don't downgrade — only ever reveal MORE facts than before
  const totalFacts = Math.max(existing.factsLearned || 0, factsLearned);
  const updates = {
    identified: true,
    factsLearned: totalFacts,
  };

  // Fact 1: real name + creature type
  if (totalFacts >= 1) {
    updates.knownName = creatureData.name || internalKey;
    updates.knownType = creatureData.type || existing.broadTypeObserved;
    updates.knownCR = creatureData.cr ?? null;
  }
  // Fact 2: HD / HP / AC
  if (totalFacts >= 2) {
    updates.knownHD = creatureData.hd || creatureData.HD || null;
    updates.knownHP = creatureData.maxHP || creatureData.hp || null;
    updates.knownAC = creatureData.ac || creatureData.AC || null;
  }
  // Fact 3: primary attacks
  if (totalFacts >= 3) {
    updates.knownAttacks = creatureData.attacks || creatureData.primaryAttack || null;
  }
  // Fact 4: defenses / special abilities
  if (totalFacts >= 4) {
    updates.knownSpecialAbilities = creatureData.specialAbilities || creatureData.special || null;
    updates.knownDefenses = {
      DR: creatureData.DR || null,
      SR: creatureData.SR || null,
      immunities: creatureData.immunities || null,
      resistances: creatureData.resistances || null,
    };
  }
  // Fact 5: weaknesses, alignment hints
  if (totalFacts >= 5) {
    updates.knownWeaknesses = creatureData.vulnerabilities || creatureData.weaknesses || null;
    updates.knownAlignment = creatureData.alignment || null;
  }
  // Fact 6+: environment / lore
  if (totalFacts >= 6) {
    updates.knownEnvironment = creatureData.environment || null;
  }

  await db.encounteredCreatures.update(existing.id, updates);
}

// ── Read all encountered creatures for the active campaign (most recent first) ──
export async function getEncounteredCreatures() {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  const all = await db.encounteredCreatures
    .where('campaignDataId')
    .equals(campaignDataId)
    .toArray();
  return all.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
}

// ── Build the player-facing display object — strips internal-only fields ──
// Use this in the journal UI so unidentified creatures never leak their name.
export function publicCreatureView(record) {
  if (!record) return null;
  if (!record.identified) {
    return {
      id: record.id,
      displayName: `Unknown ${record.appearance}`,
      identified: false,
      encounters: record.encounters || 1,
      defeated: record.defeated || 0,
      firstSeenLocation: record.firstSeenLocation,
      lastSeenLocation: record.lastSeenLocation,
      firstSeenAt: record.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      appearance: record.appearance,
    };
  }
  return {
    id: record.id,
    displayName: record.knownName || record.appearance,
    identified: true,
    factsLearned: record.factsLearned || 1,
    encounters: record.encounters || 1,
    defeated: record.defeated || 0,
    type: record.knownType,
    cr: record.knownCR,
    hd: record.knownHD,
    hp: record.knownHP,
    ac: record.knownAC,
    attacks: record.knownAttacks,
    specialAbilities: record.knownSpecialAbilities,
    defenses: record.knownDefenses,
    weaknesses: record.knownWeaknesses,
    alignment: record.knownAlignment,
    environment: record.knownEnvironment,
    appearance: record.appearance,
    firstSeenLocation: record.firstSeenLocation,
    lastSeenLocation: record.lastSeenLocation,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
  };
}

// ── Player-authored journal notes (separate from gameLog auto-events) ──
export async function addJournalNote(text, category = 'general') {
  if (!text || !text.trim()) return null;
  const clean = text.trim();
  const id = await db.journalNotes.add({
    campaignDataId: activeScope(),
    text: clean,
    category,                         // 'general' | 'plot' | 'npc' | 'lore' | 'todo'
    createdAt: new Date().toISOString(),
    pinned: false,
  });
  // Player-authored notes are always new entries by definition — every
  // call is a first-time add, so every call should emit a log line.
  emitJournalAdd({
    kind: 'note',
    label: clean.length > 80 ? `${clue_safeSlice(clean, 77)}…` : clean,
    detail: category && category !== 'general' ? category : null,
    id,
  });
  return id;
}

// Shared truncation helper — kept local rather than importing a utils
// module since this is the only in-file consumer.
function clue_safeSlice(s, n) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

export async function getJournalNotes() {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  const all = await db.journalNotes
    .where('campaignDataId')
    .equals(campaignDataId)
    .toArray();
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function updateJournalNote(id, changes) {
  await db.journalNotes.update(id, changes);
}

export async function deleteJournalNote(id) {
  await db.journalNotes.delete(id);
}
