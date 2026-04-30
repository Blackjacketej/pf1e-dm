/**
 * Faction Living-World State
 *
 * Factions aren't static sheets — they're living entities. They have moods
 * that shift with fortune, leaders who rise and fall, goals they pursue,
 * secrets they guard, rumors they spread, and complicated relationships
 * with each other.
 *
 * This layer attaches rich state to a faction in the same shape that NPCs
 * carry personality. Over time (in simulation ticks) factions can:
 *
 *   - Shift mood (confident → beleaguered → desperate → rebuilding)
 *   - Progress or fail on goals
 *   - Gain or lose resources (wealth, manpower, influence, secrecy)
 *   - Have internal factions form (schisms, successions)
 *   - Propagate and discover rumors
 *   - Shift stance toward other factions (rivalry → feud, alliance → betrayal)
 *   - Remember party deeds differently based on the mood they were in
 *
 * Pure functions. Consumers own persistence.
 */

// ══════════════════════════════════════════════════════════════════════════════
// Mood — faction-level emotional state
// ══════════════════════════════════════════════════════════════════════════════
//
// Factions don't have feelings, but they have a *tenor*. A prosperous guild
// recruits boldly and forgives small slights; a beleaguered one becomes
// paranoid and vindictive. Mood modulates how events land.

export const FACTION_MOODS = {
  ascendant:    { eventGainMult: 1.3, eventLossMult: 0.7, recruitmentBoost:  1.5, paranoia: 0.2 },
  confident:    { eventGainMult: 1.1, eventLossMult: 0.9, recruitmentBoost:  1.1, paranoia: 0.4 },
  stable:       { eventGainMult: 1.0, eventLossMult: 1.0, recruitmentBoost:  1.0, paranoia: 0.5 },
  wary:         { eventGainMult: 0.9, eventLossMult: 1.2, recruitmentBoost:  0.8, paranoia: 0.7 },
  beleaguered:  { eventGainMult: 0.7, eventLossMult: 1.4, recruitmentBoost:  0.5, paranoia: 0.9 },
  desperate:    { eventGainMult: 0.5, eventLossMult: 1.8, recruitmentBoost:  0.3, paranoia: 1.2 },
  rebuilding:   { eventGainMult: 1.2, eventLossMult: 1.0, recruitmentBoost:  1.3, paranoia: 0.6 },
  triumphant:   { eventGainMult: 1.5, eventLossMult: 0.5, recruitmentBoost:  2.0, paranoia: 0.1 },
};

// ══════════════════════════════════════════════════════════════════════════════
// Goals — what the faction is trying to do
// ══════════════════════════════════════════════════════════════════════════════
//
// Each goal has progress 0..100, priority, and tags that let ambient activity
// tick it up. When a goal completes, it fires an event that may shift mood
// and trigger reactions from rival factions.

export const GOAL_TYPES = {
  territorial_expansion: { tags: ['raiding', 'conquest', 'scouting'],           difficulty: 'hard'   },
  wealth_accumulation:   { tags: ['trading', 'extortion', 'theft'],             difficulty: 'medium' },
  political_influence:   { tags: ['diplomacy', 'intrigue', 'bribery'],          difficulty: 'hard'   },
  religious_conversion:  { tags: ['preaching', 'ritual', 'pilgrimage'],         difficulty: 'medium' },
  knowledge_pursuit:     { tags: ['research', 'exploration', 'archaeology'],   difficulty: 'medium' },
  revenge:               { tags: ['assassination', 'sabotage', 'warfare'],      difficulty: 'varies' },
  survival:              { tags: ['hiding', 'fortifying', 'recruiting'],        difficulty: 'easy'   },
  legacy_building:       { tags: ['founding', 'building', 'crafting'],          difficulty: 'hard'   },
  ritual_completion:     { tags: ['ritual', 'sacrifice', 'gathering'],          difficulty: 'medium' },
  prophecy_fulfillment:  { tags: ['signs', 'pilgrimage', 'omens'],              difficulty: 'hard'   },
};

export function createGoal(cfg = {}) {
  const def = GOAL_TYPES[cfg.type] || {};
  return {
    id: cfg.id || `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: cfg.type || 'survival',
    narrative: cfg.narrative || cfg.type || 'survive',
    progress: cfg.progress || 0,            // 0..100
    priority: cfg.priority || 'normal',     // low | normal | high | critical
    tags: def.tags || cfg.tags || [],
    blockedBy: cfg.blockedBy || [],         // faction ids that oppose
    createdAt: cfg.createdAt || new Date().toISOString(),
    completedAt: null,
    failedAt: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Resources — what the faction has
// ══════════════════════════════════════════════════════════════════════════════

export function defaultResources(archetype) {
  const base = { wealth: 50, manpower: 50, influence: 50, secrecy: 50, morale: 70 };
  // Archetype tilts the defaults
  const tilts = {
    mercantile:  { wealth: +20, influence: +10 },
    martial:     { manpower: +20, morale: +10 },
    religious:   { influence: +15, morale: +15 },
    criminal:    { secrecy: +25, wealth: +10 },
    noble_house: { wealth: +20, influence: +25 },
    scholarly:   { influence: +10, secrecy: +10 },
    artisan:     { wealth: +10 },
    outcast:     { wealth: -20, secrecy: +15, morale: -10 },
    tribe:       { manpower: +15, wealth: -10 },
    clan:        { manpower: +10, influence: +10 },
    hive:        { manpower: +30, morale: +20, wealth: -20 },
    pack:        { manpower: -10, morale: +10 },
    coven:       { secrecy: +35, influence: +10 },
    enclave:     { secrecy: +15, influence: +5 },
    horde:       { manpower: +30, secrecy: -20, morale: +15 },
    cult:        { manpower: +5, secrecy: +20, morale: +15 },
    monastery:   { influence: +10, wealth: -10, morale: +15 },
    caravan:     { wealth: +15, influence: +15, manpower: -15 },
    court:       { influence: +30, secrecy: +25 },
    hoard:       { wealth: +40, manpower: -40, influence: +10 },
    consortium:  { influence: +20, secrecy: +20 },
    guild:       { wealth: +15, influence: +15 },
  };
  const tilt = tilts[archetype] || {};
  return {
    wealth:    clamp(base.wealth    + (tilt.wealth    || 0), 0, 100),
    manpower:  clamp(base.manpower  + (tilt.manpower  || 0), 0, 100),
    influence: clamp(base.influence + (tilt.influence || 0), 0, 100),
    secrecy:   clamp(base.secrecy   + (tilt.secrecy   || 0), 0, 100),
    morale:    clamp(base.morale    + (tilt.morale    || 0), 0, 100),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Leadership — who runs the faction
// ══════════════════════════════════════════════════════════════════════════════

export function createLeadership(cfg = {}) {
  return {
    current: cfg.current || null,           // NPC name/id of leader
    title: cfg.title || 'Leader',           // Chieftain, Abbot, Archmage, etc.
    legitimacy: cfg.legitimacy || 75,       // 0..100; low legitimacy invites succession
    succession: cfg.succession || [],       // ordered list of potential successors
    challengers: cfg.challengers || [],     // NPCs plotting against current
    tenureStart: cfg.tenureStart || new Date().toISOString(),
    history: cfg.history || [],             // { leaderId, title, start, end, reason }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Inter-faction relations
// ══════════════════════════════════════════════════════════════════════════════

export const RELATION_TIERS = {
  vassal:      { score:  90, label: 'Sworn Vassal'      },
  allied:      { score:  60, label: 'Allied'            },
  friendly:    { score:  30, label: 'Friendly'          },
  neutral:     { score:   0, label: 'Neutral'           },
  wary:        { score: -20, label: 'Wary'              },
  rival:       { score: -50, label: 'Rival'             },
  feud:        { score: -75, label: 'Active Feud'       },
  sworn_enemy: { score: -95, label: 'Sworn Enemy'       },
};

export function relationLabel(score) {
  if (score >=  80) return RELATION_TIERS.vassal.label;
  if (score >=  50) return RELATION_TIERS.allied.label;
  if (score >=  20) return RELATION_TIERS.friendly.label;
  if (score >= -10) return RELATION_TIERS.neutral.label;
  if (score >= -35) return RELATION_TIERS.wary.label;
  if (score >= -65) return RELATION_TIERS.rival.label;
  if (score >= -85) return RELATION_TIERS.feud.label;
  return RELATION_TIERS.sworn_enemy.label;
}

/**
 * setRelation(faction, otherFactionId, score, opts)
 *   Records a directed relation (faction → other). Mutual feelings need two calls.
 *   If `mutual` is true, caller should set both sides.
 */
export function setRelation(faction, otherFactionId, score, opts = {}) {
  const relations = { ...(faction.relations || {}) };
  relations[otherFactionId] = {
    score: clamp(score, -100, 100),
    history: [
      ...(relations[otherFactionId]?.history || []),
      {
        delta: opts.delta || null,
        absolute: score,
        reason: opts.reason || null,
        timestamp: opts.timestamp || new Date().toISOString(),
      },
    ].slice(-20), // keep last 20 shifts
  };
  return { ...faction, relations };
}

export function shiftRelation(faction, otherFactionId, delta, opts = {}) {
  const current = faction.relations?.[otherFactionId]?.score || 0;
  return setRelation(faction, otherFactionId, current + delta, { ...opts, delta });
}

// ══════════════════════════════════════════════════════════════════════════════
// Secrets & rumors
// ══════════════════════════════════════════════════════════════════════════════

export function createSecret(cfg = {}) {
  return {
    id: cfg.id || `secret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    narrative: cfg.narrative || '',
    severity: cfg.severity || 'minor',   // minor | serious | catastrophic
    exposed: false,
    exposedAt: null,
    knownBy: cfg.knownBy || [],          // NPC names who know
    leakRisk: cfg.leakRisk || 0.05,      // per-tick chance of spreading
  };
}

export function createRumor(cfg = {}) {
  return {
    id: cfg.id || `rumor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    narrative: cfg.narrative || '',
    truth: cfg.truth || 'unverified',   // true | false | partially_true | unverified
    target: cfg.target || null,          // who the rumor is about
    spreadTo: cfg.spreadTo || [],        // factionIds that have picked it up
    createdAt: cfg.createdAt || new Date().toISOString(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Construction — enrich a base faction with living-world state
// ══════════════════════════════════════════════════════════════════════════════

/**
 * enrichFactionWithLife — takes a base faction from factions.js::createFaction
 * and attaches full living-world state. Idempotent: calling twice won't
 * overwrite existing life state.
 */
export function enrichFactionWithLife(faction, cfg = {}) {
  if (faction.life) return faction; // already enriched

  return {
    ...faction,
    life: {
      mood: cfg.mood || 'stable',
      moodHistory: [{ mood: cfg.mood || 'stable', reason: 'initialized', timestamp: new Date().toISOString() }],
      leadership: createLeadership(cfg.leadership || {}),
      resources: cfg.resources || defaultResources(faction.archetype),
      goals: (cfg.goals || []).map(g => createGoal(g)),
      completedGoals: [],
      failedGoals: [],
      secrets: (cfg.secrets || []).map(s => createSecret(s)),
      rumors: (cfg.rumors || []).map(r => createRumor(r)),
      // relations: key is other faction id, value is { score, history }
      // (kept at root level for easier lookup, mirrored here for clarity)
      schisms: [],             // internal sub-factions that may break away
      stanceTowardParty: cfg.stanceTowardParty || 'unknown', // unknown | watching | courting | hostile | devoted
      lastInteraction: null,   // { timestamp, event, partyVisible: bool }
      foundingDate: cfg.foundingDate || null,
      mottoOrBelief: cfg.mottoOrBelief || null,
    },
    // Ensure relations exists at root for easy access
    relations: faction.relations || {},
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Mood shifts
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Given current resources, infer a probable mood. This is advisory — the
 * GM / simulation can override with narrative context.
 */
export function inferMoodFromResources(resources) {
  const { morale, manpower, wealth, influence } = resources;
  const avg = (morale + manpower + wealth + influence) / 4;
  if (avg >= 85) return 'triumphant';
  if (avg >= 70) return morale >= 75 ? 'ascendant' : 'confident';
  if (avg >= 55) return 'stable';
  if (avg >= 40) return 'wary';
  if (avg >= 25) return 'beleaguered';
  if (avg >= 10) return 'desperate';
  return 'desperate';
}

export function setMood(faction, newMood, reason = null) {
  if (!faction.life) return faction;
  if (faction.life.mood === newMood) return faction;
  return {
    ...faction,
    life: {
      ...faction.life,
      mood: newMood,
      moodHistory: [
        ...(faction.life.moodHistory || []),
        { mood: newMood, reason, timestamp: new Date().toISOString() },
      ].slice(-30),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Goal progression
// ══════════════════════════════════════════════════════════════════════════════

/**
 * advanceGoal — move a goal's progress by `amount`. Completes at 100+.
 * Returns { faction, completed: bool, failed: bool }.
 */
export function advanceGoal(faction, goalId, amount, opts = {}) {
  if (!faction.life) return { faction, completed: false, failed: false };
  const goal = faction.life.goals.find(g => g.id === goalId);
  if (!goal) return { faction, completed: false, failed: false };

  const newProgress = clamp(goal.progress + amount, 0, 100);
  const completed = newProgress >= 100;
  const updatedGoal = { ...goal, progress: newProgress };

  if (completed) {
    updatedGoal.completedAt = opts.timestamp || new Date().toISOString();
    return {
      faction: {
        ...faction,
        life: {
          ...faction.life,
          goals: faction.life.goals.filter(g => g.id !== goalId),
          completedGoals: [...faction.life.completedGoals, updatedGoal],
        },
      },
      completed: true,
      failed: false,
    };
  }

  return {
    faction: {
      ...faction,
      life: {
        ...faction.life,
        goals: faction.life.goals.map(g => g.id === goalId ? updatedGoal : g),
      },
    },
    completed: false,
    failed: false,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
