// ─────────────────────────────────────────────────────────────
// NPC Knowledge — tiered reveal system for player-facing NPC data.
//
// Mirrors the faction knowledge-level pattern. Each encounteredNpcs
// row carries:
//   knowledgeLevel (0..4)   — overall social knowledge
//   revealedFacts  (Set)    — specific facets unlocked independently
//     'combatStats'   : seen in combat / scouted by familiar
//     'secretFactions': infiltration / research tied them to a hidden org
//     'trueAlignment' : detected / confessed / clearly revealed by action
//     'stats'         : full stat block available
//
// Knowledge levels (social — what casual interaction teaches you):
//   0: Observed     — descriptor only, no name
//   1: Named        — name, apparent race/sex/age, first-seen location
//   2: Acquainted   — role/occupation, location of residence, demeanor
//   3: Known        — public faction ties, disposition, rough power level
//   4: Deeply Known — stats + alignment + secret faction ties (with facts)
//
// publicNpcView(npc) returns a redacted object safe for the Journal UI.
// ─────────────────────────────────────────────────────────────

export const NPC_KNOWLEDGE_LABELS = {
  0: 'observed',
  1: 'named',
  2: 'acquainted',
  3: 'known',
  4: 'deeply known',
};

export function deriveNpcKnowledgeLevel(npc) {
  if (!npc) return 0;
  // Explicit override wins
  if (Number.isFinite(npc.knowledgeLevel)) return Math.max(0, Math.min(4, npc.knowledgeLevel));
  // Legacy inference from existing fields
  if (!npc.knownToParty) return 0;
  const interactions = npc.interactions || 0;
  if (interactions >= 3) return 3;
  if (interactions >= 1) return 2;
  return 1;
}

/**
 * Return ONLY the NPC facets the party has earned. Never leaks stats,
 * true alignment, or secret faction ties unless the corresponding fact
 * is in `revealedFacts`.
 *
 * Callers can pass a set of knownFactionIds to filter the faction
 * chip list to ones the party has also encountered (so a named NPC
 * doesn't leak the existence of a faction the party has never heard
 * of just because their row happened to reference it).
 */
export function publicNpcView(npc, opts = {}) {
  if (!npc) return null;
  const level = deriveNpcKnowledgeLevel(npc);
  const facts = new Set(npc.revealedFacts || []);
  const known = opts.encounteredFactionIds || null; // null = no filter

  const base = {
    id: npc.id,
    knowledgeLevel: level,
    knowledgeLabel: NPC_KNOWLEDGE_LABELS[level],
    identified: level >= 1,
    displayName: level >= 1
      ? (npc.name || 'someone')
      : (npc.shortDesc ? `the ${npc.shortDesc}` : 'a stranger'),
    metAt: npc.metAt || null,
    // Visible to anyone with working eyes — the party can see what someone
    // looks like the moment they lay eyes on them, even at level 0.
    appearance: npc.appearance || null,
    portraitSvg: npc.portraitSvg || null,
    location: null,
    race: null,
    sex: null,
    ageBracket: null,
    occupation: null,
    demeanor: null,
    attitude: null,
    personality: null,      // L2+ — you've spoken with them enough to get a read
    factions: [],           // array of { id, secret: boolean } — public only unless 'secretFactions'
    disposition: null,
    powerLevelHint: null,   // rough — "clearly seasoned" rather than CR
    alignment: null,
    alive: npc.alive !== false,
    causeOfDeath: npc.alive === false ? (npc.causeOfDeath || null) : null,
    interactions: npc.interactions || 0,
    attitudeHistory: npc.attitudeHistory || [],
    firstImpression: npc.firstImpression || null,
    shortDesc: npc.shortDesc || null,
    // Mechanical fields — gated behind stats/combatStats/L4 (see below)
    class: null,
    classLevel: null,       // NPC's character level; renamed to avoid clash with knowledgeLevel
    hp: null,
    ac: null,
    abilities: null,
    stats: null,
    revealedFacts: [...facts],
    // Detail-view fields below are gated by level — stay null unless earned.
    playerNotes: npc.playerNotes || '',   // player-authored; always visible
    lastSeen: npc.lastSeen || null,       // always visible if we have it
    familiar: null,
    relationships: [],                    // [{ targetName, type, detail }]
    goal: null,
    emotionalState: null,
  };

  if (level >= 1) {
    base.race = npc.race || null;
    base.sex = npc.appearance?.gender || npc.sex || null;
    if (npc.appearance?.age != null) {
      const a = npc.appearance.age;
      base.ageBracket = a < 20 ? 'young' : a < 35 ? 'adult' : a < 55 ? 'middle-aged' : 'elderly';
    }
    base.location = npc.location || null;
  }

  if (level >= 2) {
    base.occupation = npc.occupation || null;
    base.demeanor = npc.disposition || null;
    base.attitude = npc.attitude || null;
    // A familiar is visible to anyone who's spent real time with the NPC —
    // identified by type/label only, never by its internal id.
    if (npc.familiar?.id) {
      base.familiar = { id: npc.familiar.id };
    }
    base.emotionalState = npc.emotionalState || null;
  }

  if (level >= 3) {
    // Relationships and long-term goal unlock once the NPC is genuinely
    // "known" — casual acquaintances don't share aspirations or enemies.
    base.relationships = Array.isArray(npc.relationships) ? npc.relationships : [];
    base.goal = npc.goal || null;
    // Public faction ties only, filtered to ones the party has encountered
    const publicFactions = Array.isArray(npc.factions)
      ? npc.factions.filter(fid => typeof fid === 'string')
      : [];
    base.factions = publicFactions
      .filter(fid => !known || known.has(fid))
      .map(fid => ({ id: fid, secret: false }));
    base.disposition = npc.disposition || null;
    if (Number.isFinite(npc.cr)) {
      const cr = npc.cr;
      base.powerLevelHint = cr < 3 ? 'unremarkable'
        : cr < 6 ? 'capable'
        : cr < 10 ? 'clearly seasoned'
        : cr < 14 ? 'formidable'
        : 'legendary';
    }
  }

  // 'secretFactions' fact can unlock hidden ties independently of level
  if (facts.has('secretFactions') && Array.isArray(npc.secretFactions)) {
    const hidden = npc.secretFactions
      .filter(fid => !known || known.has(fid))
      .map(fid => ({ id: fid, secret: true }));
    base.factions = [...base.factions, ...hidden];
  }

  if (level >= 4 || facts.has('trueAlignment')) {
    base.alignment = npc.alignment || null;
  }

  if (facts.has('stats') || facts.has('combatStats') || level >= 4) {
    base.stats = npc.stats || null;
  }

  return base;
}

/**
 * Compute a fuzzy "how big is this faction" hint based on the total
 * roster size and the party's knowledge level. Never commits to an
 * exact number unless knowledge is high AND the faction is small.
 *
 * @param {number} totalMembers   full size of campaign.factions[x].members
 * @param {number} level          party's knowledgeLevel 0..4
 * @returns {string|null}         human-readable hint or null
 */
export function factionSizeHint(totalMembers, level) {
  if (!Number.isFinite(totalMembers) || totalMembers <= 0) return null;
  if (level < 2) return null; // scope unknown below level 2
  if (level >= 3 && totalMembers <= 8) return `${totalMembers} members known to exist`;
  if (level >= 4) {
    if (totalMembers <= 12) return `about a dozen members`;
    if (totalMembers <= 30) return `roughly ${Math.round(totalMembers / 5) * 5} operatives`;
    return 'a widespread network';
  }
  // level 2: qualitative only
  if (totalMembers <= 5) return 'a handful of members';
  if (totalMembers <= 12) return 'more than a few members';
  if (totalMembers <= 30) return 'a sizable network';
  return 'widespread';
}
