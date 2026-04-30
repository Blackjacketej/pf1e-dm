/**
 * NPC Deep Personality Engine
 *
 * A comprehensive personality simulation system for Pathfinder 1e NPCs.
 * Provides seven interlocking subsystems that make NPCs feel like people:
 *
 *   1. Emotional State   — Mood that shifts from events and decays over time
 *   2. Memory & Trust    — NPCs remember what the party did; trust accumulates
 *   3. Goals & Motives   — NPCs want things and act toward them
 *   4. Relationship Web  — NPCs have opinions about other NPCs
 *   5. Knowledge Model   — What NPCs know, including rumors and partial truths
 *   6. Behavioral Tells  — Observable cues tied to personality/emotion/deception
 *   7. Courage & Pressure — How NPCs react when threatened or caught
 *
 * All functions are pure (no side effects) so they can be tested deterministically.
 * State mutations happen in the caller (npcTracker / WorldTab).
 */

import { roll, rollDice } from '../utils/dice';

// ══════════════════════════════════════════════════════════════════════════════
// 1. EMOTIONAL STATE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Mood definitions. Each mood has an intensity (1–5), a half-life in hours
 * (how fast it fades), and modifiers that feed into other subsystems.
 */
export const MOODS = {
  calm:        { label: 'Calm',        baseIntensity: 1, halfLifeHours: Infinity, deceptionMod: 0,  trustMod: 0,  courageMod: 0  },
  happy:       { label: 'Happy',       baseIntensity: 2, halfLifeHours: 8,        deceptionMod: -5, trustMod: 5,  courageMod: 5  },
  angry:       { label: 'Angry',       baseIntensity: 3, halfLifeHours: 4,        deceptionMod: 10, trustMod: -10,courageMod: 10 },
  afraid:      { label: 'Afraid',      baseIntensity: 3, halfLifeHours: 6,        deceptionMod: 15, trustMod: -5, courageMod: -20},
  grief:       { label: 'Grief',       baseIntensity: 4, halfLifeHours: 24,       deceptionMod: -5, trustMod: 0,  courageMod: -10},
  desperate:   { label: 'Desperate',   baseIntensity: 4, halfLifeHours: 12,       deceptionMod: 20, trustMod: -10,courageMod: 5  },
  grateful:    { label: 'Grateful',    baseIntensity: 3, halfLifeHours: 12,       deceptionMod: -15,trustMod: 15, courageMod: 5  },
  suspicious:  { label: 'Suspicious',  baseIntensity: 3, halfLifeHours: 6,        deceptionMod: 10, trustMod: -15,courageMod: 0  },
  embarrassed: { label: 'Embarrassed', baseIntensity: 2, halfLifeHours: 2,        deceptionMod: 5,  trustMod: -5, courageMod: -5 },
  inspired:    { label: 'Inspired',    baseIntensity: 2, halfLifeHours: 8,        deceptionMod: -5, trustMod: 5,  courageMod: 15 },
};

/**
 * Events that trigger mood changes. Each maps to a mood + intensity delta.
 * Use applyEmotionalEvent() to apply these.
 */
export const EMOTIONAL_EVENTS = {
  // Positive
  party_saved_life:      { mood: 'grateful',    intensity: 5, trust: 25,  visibility: 'public',  gossipWeight: 5 },
  party_helped:          { mood: 'grateful',    intensity: 3, trust: 10,  visibility: 'local',   gossipWeight: 2 },
  party_complimented:    { mood: 'happy',       intensity: 2, trust: 5,   visibility: 'private', gossipWeight: 0 },
  party_kept_promise:    { mood: 'grateful',    intensity: 4, trust: 15,  visibility: 'local',   gossipWeight: 3 },
  received_good_news:    { mood: 'happy',       intensity: 3, trust: 0,   visibility: 'private', gossipWeight: 1 },
  inspired_by_speech:    { mood: 'inspired',    intensity: 3, trust: 5,   visibility: 'public',  gossipWeight: 2 },
  // Negative
  party_broke_promise:   { mood: 'angry',       intensity: 4, trust: -20, visibility: 'local',   gossipWeight: 4 },
  party_threatened:      { mood: 'afraid',      intensity: 4, trust: -15, visibility: 'local',   gossipWeight: 3 },
  party_insulted:        { mood: 'angry',       intensity: 3, trust: -10, visibility: 'local',   gossipWeight: 2 },
  party_stole:           { mood: 'angry',       intensity: 5, trust: -25, visibility: 'public',  gossipWeight: 5 },
  party_caught_lying:    { mood: 'suspicious',  intensity: 4, trust: -20, visibility: 'local',   gossipWeight: 4 },
  witnessed_violence:    { mood: 'afraid',      intensity: 4, trust: -10, visibility: 'public',  gossipWeight: 5 },
  lost_loved_one:        { mood: 'grief',       intensity: 5, trust: 0,   visibility: 'public',  gossipWeight: 4 },
  lost_property:         { mood: 'desperate',   intensity: 4, trust: 0,   visibility: 'local',   gossipWeight: 2 },
  was_embarrassed:       { mood: 'embarrassed', intensity: 3, trust: -5,  visibility: 'local',   gossipWeight: 1 },
  // Situational
  under_pressure:        { mood: 'desperate',   intensity: 3, trust: 0,   visibility: 'private', gossipWeight: 0 },
  discovered_betrayal:   { mood: 'angry',       intensity: 5, trust: -30, visibility: 'private', gossipWeight: 3 },
};

// ── Concealable Events ────────────────────────────────────────────────────
//
// Some events the party can do *to* an NPC without the NPC realizing it
// happened (theft, lying, breaking a promise the NPC hasn't checked on).
// These events are deferred until the NPC discovers them — at which point
// the impact may be amplified by `discovered_betrayal` for severe deceptions.
//
// Non-concealable events (party_threatened, party_saved_life, witnessed_*,
// etc.) are inherently noticed when they happen.

export const CONCEALABLE_EVENTS = new Set([
  'party_stole',
  'party_caught_lying',   // "caught" implies discovery already, but we still
                          // gate this so attempted-but-undetected lies defer
  'party_broke_promise',
  'lost_property',
]);

/**
 * Severity of betrayal upon discovery. Drives whether `discovered_betrayal`
 * piles on top of the original event's mood/trust impact.
 */
export const DISCOVERY_AMPLIFIERS = {
  party_stole:         { addBetrayalMood: true,  trustBonus: -5  },
  party_caught_lying:  { addBetrayalMood: true,  trustBonus: -10 },
  party_broke_promise: { addBetrayalMood: false, trustBonus: 0   },
  lost_property:       { addBetrayalMood: false, trustBonus: 0   },
};

// ── Awareness Scopes ──────────────────────────────────────────────────────
//
// How an NPC learns about an event determines emotional/trust impact:
//
//   direct     — NPC was the target (full impact)
//   witnessed  — NPC saw it happen to someone else (scaled by relationship to victim)
//   gossip     — NPC heard about it secondhand (reduced, delayed)
//   unaware    — NPC doesn't know (no impact until they learn)
//
// Visibility controls default propagation:
//   public   — anyone in the settlement hears within ~1 day
//   local    — witnesses + gossip to close contacts within ~3 days
//   private  — only direct participant + anyone they tell

export const AWARENESS_SCOPES = {
  direct:    { label: 'Direct',    intensityScale: 1.0, trustScale: 1.0  },
  witnessed: { label: 'Witnessed', intensityScale: 0.6, trustScale: 0.5  },
  gossip:    { label: 'Gossip',    intensityScale: 0.3, trustScale: 0.25 },
  unaware:   { label: 'Unaware',   intensityScale: 0,   trustScale: 0    },
};

/**
 * Propagation speed — how quickly events spread based on visibility
 * and settlement size. Returns max hops and delay per hop in game-hours.
 */
export const PROPAGATION_RATES = {
  village:  { public: { maxHops: 3, hoursPerHop: 2  }, local: { maxHops: 2, hoursPerHop: 4  }, private: { maxHops: 1, hoursPerHop: 12 } },
  town:     { public: { maxHops: 4, hoursPerHop: 6  }, local: { maxHops: 2, hoursPerHop: 12 }, private: { maxHops: 1, hoursPerHop: 24 } },
  city:     { public: { maxHops: 5, hoursPerHop: 12 }, local: { maxHops: 2, hoursPerHop: 24 }, private: { maxHops: 1, hoursPerHop: 48 } },
  metropolis:{ public:{ maxHops: 3, hoursPerHop: 24 }, local: { maxHops: 1, hoursPerHop: 48 }, private: { maxHops: 0, hoursPerHop: 0  } },
};

/**
 * Determine an NPC's awareness scope for an event.
 *
 * @param {object} npc         — the NPC being evaluated
 * @param {string} targetName  — who the event happened TO (NPC name or 'party')
 * @param {string} eventKey    — key from EMOTIONAL_EVENTS
 * @param {object} context     — { presentNPCNames: [], relationships: [], settlementSize, hoursElapsed }
 * @returns {object} { scope: 'direct'|'witnessed'|'gossip'|'unaware', reason, relationshipToTarget }
 */
export function determineAwareness(npc, targetName, eventKey, context = {}) {
  const event = EMOTIONAL_EVENTS[eventKey];
  if (!event) return { scope: 'unaware', reason: 'Unknown event.', relationshipToTarget: null };

  const npcName = npc.name || '';

  // ── Direct: NPC is the target ──
  if (npcName === targetName || targetName === npcName) {
    return { scope: 'direct', reason: `${npcName} was directly involved.`, relationshipToTarget: 'self' };
  }

  // ── Witnessed: NPC was present when it happened ──
  const present = context.presentNPCNames || [];
  if (present.includes(npcName)) {
    // Find relationship to target for scaling
    const rel = (context.relationships || []).find(r =>
      (r.sourceName === npcName && r.targetName === targetName) ||
      (r.sourceName === targetName && r.targetName === npcName)
    );
    return {
      scope: 'witnessed',
      reason: `${npcName} witnessed the event.`,
      relationshipToTarget: rel?.type || null,
    };
  }

  // ── Gossip: check if enough time has passed for news to spread ──
  const visibility = event.visibility || 'local';
  const size = context.settlementSize || 'town';
  const rate = (PROPAGATION_RATES[size] || PROPAGATION_RATES.town)[visibility];
  const hoursElapsed = context.hoursElapsed || 0;

  if (rate && rate.maxHops > 0 && hoursElapsed > 0) {
    // Check if this NPC is reachable via relationship hops within the time window
    const hopsAvailable = Math.floor(hoursElapsed / rate.hoursPerHop);

    if (hopsAvailable >= 1) {
      // Find shortest path from target to this NPC through relationships
      const hops = findRelationshipDistance(targetName, npcName, context.relationships || [], rate.maxHops);
      if (hops !== null && hops <= hopsAvailable) {
        return {
          scope: 'gossip',
          reason: `${npcName} heard about it through ${hops} hop${hops > 1 ? 's' : ''} of gossip (${visibility} event, ${hoursElapsed}h elapsed).`,
          relationshipToTarget: null,
          gossipHops: hops,
        };
      }
    }

    // Public events: even without relationship path, everyone hears eventually
    if (visibility === 'public' && hoursElapsed >= rate.hoursPerHop * rate.maxHops) {
      return {
        scope: 'gossip',
        reason: `${npcName} heard the public news after ${hoursElapsed}h.`,
        relationshipToTarget: null,
        gossipHops: rate.maxHops,
      };
    }
  }

  return { scope: 'unaware', reason: `${npcName} hasn't heard about this yet.`, relationshipToTarget: null };
}

/**
 * BFS to find shortest relationship path between two NPCs.
 * Returns hop count or null if unreachable within maxHops.
 */
function findRelationshipDistance(fromName, toName, relationships, maxHops) {
  if (!relationships || relationships.length === 0) return null;

  const visited = new Set([fromName]);
  let frontier = [fromName];
  let hops = 0;

  while (hops < maxHops && frontier.length > 0) {
    hops++;
    const nextFrontier = [];
    for (const current of frontier) {
      const neighbors = relationships
        .filter(r => r.sourceName === current || r.targetName === current)
        .map(r => r.sourceName === current ? r.targetName : r.sourceName)
        .filter(n => !visited.has(n));

      for (const neighbor of neighbors) {
        if (neighbor === toName) return hops;
        visited.add(neighbor);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

/**
 * Apply an event with awareness scaling. This is the full-featured version
 * that replaces direct calls to applyEmotionalEvent for multi-NPC scenarios.
 *
 * @param {object} npc          — NPC to apply to
 * @param {string} eventKey     — key from EMOTIONAL_EVENTS
 * @param {string} scope        — 'direct' | 'witnessed' | 'gossip' | 'unaware'
 * @param {object} opts         — { timestamp, relationshipToTarget, gossipHops,
 *                                  detected, discoveryDelayHours }
 * @returns {object} { emotionalState, trustDelta, applied, scope, reason,
 *                     deferred?, deferredEvent? }
 */
export function applyEventWithAwareness(npc, eventKey, scope, opts = {}) {
  // ── Discovery gate: concealable events directed AT this NPC may be deferred ──
  // If the party did something concealable (stole, lied) and the NPC hasn't
  // detected it, queue it on the NPC and return without applying impact.
  // The caller can later apply discoverDeferredEvent when the NPC notices.
  const detected = opts.detected !== false; // default true
  if (
    scope === 'direct' &&
    !detected &&
    CONCEALABLE_EVENTS.has(eventKey)
  ) {
    const now = opts.timestamp || new Date().toISOString();
    const state = { ...(npc.emotionalState || defaultEmotionalState()) };
    const deferredEvent = {
      eventKey,
      queuedAt: now,
      discoverableAfter: opts.discoveryDelayHours
        ? new Date(new Date(now).getTime() + opts.discoveryDelayHours * 3600 * 1000).toISOString()
        : null,
      relationshipToTarget: opts.relationshipToTarget || null,
    };
    state.deferredEvents = [...(state.deferredEvents || []), deferredEvent];
    return {
      emotionalState: state,
      trustDelta: 0,
      applied: false,
      deferred: true,
      deferredEvent,
      scope,
      reason: `Concealable event "${eventKey}" queued — NPC has not detected it yet.`,
    };
  }

  if (scope === 'unaware') {
    return {
      emotionalState: npc.emotionalState || defaultEmotionalState(),
      trustDelta: 0,
      applied: false,
      scope: 'unaware',
      reason: 'NPC is unaware of this event.',
    };
  }

  const event = EMOTIONAL_EVENTS[eventKey];
  if (!event) {
    return {
      emotionalState: npc.emotionalState || defaultEmotionalState(),
      trustDelta: 0,
      applied: false,
      scope,
      reason: 'Unknown event.',
    };
  }

  const scopeDef = AWARENESS_SCOPES[scope] || AWARENESS_SCOPES.direct;

  // Scale intensity and trust by awareness scope
  let intensityScale = scopeDef.intensityScale;
  let trustScale = scopeDef.trustScale;

  // Witnessed events: relationship to victim modifies impact
  if (scope === 'witnessed' && opts.relationshipToTarget) {
    const relType = RELATIONSHIP_TYPES[opts.relationshipToTarget];
    if (relType) {
      // Positive trust-transfer relationships amplify empathy; negative ones reduce it
      const empathyMod = relType.trustTransfer > 0 ? 1 + relType.trustTransfer : Math.max(0.1, 1 + relType.trustTransfer);
      intensityScale *= empathyMod;
      trustScale *= empathyMod;
    }
  }

  // Gossip events: further reduce per hop
  if (scope === 'gossip' && opts.gossipHops) {
    const hopDecay = Math.pow(0.7, opts.gossipHops - 1); // 30% reduction per hop
    intensityScale *= hopDecay;
    trustScale *= hopDecay;
  }

  // Apply scaled event
  const scaledIntensity = Math.max(1, Math.round(event.intensity * intensityScale));
  const scaledTrust = Math.round((event.trust || 0) * trustScale);

  const now = opts.timestamp || new Date().toISOString();
  const state = { ...(npc.emotionalState || defaultEmotionalState()) };

  const currentIntensity = state.intensity || 0;
  if (scaledIntensity >= currentIntensity || state.mood === 'calm') {
    state.mood = event.mood;
    state.intensity = Math.min(5, scaledIntensity);
    state.setAt = now;
  }

  state.recentEvents = [...(state.recentEvents || []).slice(-9), {
    event: eventKey,
    mood: event.mood,
    scope,
    timestamp: now,
  }];

  return {
    emotionalState: state,
    trustDelta: scaledTrust,
    applied: true,
    scope,
    scaledIntensity,
    scaledTrust,
    reason: `${scope} awareness: intensity ${event.intensity}→${scaledIntensity}, trust ${event.trust}→${scaledTrust}`,
  };
}

/**
 * Propagate an event across all NPCs in a settlement.
 * Returns an array of { npcName, scope, result } for every NPC affected.
 *
 * @param {Array}  allNPCs       — array of NPC objects
 * @param {string} targetName    — who the event happened to
 * @param {string} eventKey      — key from EMOTIONAL_EVENTS
 * @param {object} context       — { presentNPCNames, relationships, settlementSize, hoursElapsed, timestamp }
 * @returns {Array} [ { npcName, scope, reason, emotionalState, trustDelta, applied }, ... ]
 */
export function propagateEvent(allNPCs, targetName, eventKey, context = {}) {
  const results = [];
  const detected = context.detected !== false; // default true
  const concealable = CONCEALABLE_EVENTS.has(eventKey);

  for (const npc of allNPCs) {
    let awareness = determineAwareness(npc, targetName, eventKey, context);

    // ── Discovery gate: undetected concealable acts have no witnesses/gossip.
    // Only the target gets a deferred event.
    if (!detected && concealable && awareness.scope !== 'direct') {
      awareness = { scope: 'unaware', reason: 'Concealable act went unnoticed by others.', relationshipToTarget: null };
    }

    const result = applyEventWithAwareness(npc, eventKey, awareness.scope, {
      timestamp: context.timestamp,
      relationshipToTarget: awareness.relationshipToTarget,
      gossipHops: awareness.gossipHops,
      detected,
      discoveryDelayHours: context.discoveryDelayHours,
    });

    results.push({
      npcName: npc.name,
      scope: awareness.scope,
      reason: awareness.reason,
      ...result,
    });
  }

  return results;
}

/**
 * Discover a previously deferred concealable event. Applies the original
 * event's impact, and for severe deceptions piles `discovered_betrayal`
 * on top (extra trust loss, anger spike).
 *
 * @param {object} npc          — NPC with state.deferredEvents queued
 * @param {string} eventKey     — which deferred event to discover (first match)
 * @param {object} opts         — { timestamp }
 * @returns {object} { emotionalState, trustDelta, applied, discovered, reason }
 */
export function discoverDeferredEvent(npc, eventKey, opts = {}) {
  const state = { ...(npc.emotionalState || defaultEmotionalState()) };
  const queue = state.deferredEvents || [];
  const idx = queue.findIndex(d => d.eventKey === eventKey);
  if (idx < 0) {
    return {
      emotionalState: state,
      trustDelta: 0,
      applied: false,
      discovered: false,
      reason: `No deferred "${eventKey}" event on this NPC.`,
    };
  }

  const deferred = queue[idx];
  state.deferredEvents = queue.filter((_, i) => i !== idx);

  // Apply the original event with full direct impact
  const npcWithCleanedState = { ...npc, emotionalState: state };
  const baseResult = applyEventWithAwareness(npcWithCleanedState, eventKey, 'direct', {
    timestamp: opts.timestamp,
    detected: true, // we are explicitly discovering it now
  });

  let finalState = baseResult.emotionalState;
  let finalTrust = baseResult.trustDelta;
  let amplified = false;

  // Pile on `discovered_betrayal` for severe deceptions
  const amp = DISCOVERY_AMPLIFIERS[eventKey];
  if (amp?.addBetrayalMood) {
    const npcWithBaseState = { ...npc, emotionalState: finalState };
    const betrayalResult = applyEventWithAwareness(npcWithBaseState, 'discovered_betrayal', 'direct', {
      timestamp: opts.timestamp,
      detected: true,
    });
    finalState = betrayalResult.emotionalState;
    finalTrust += betrayalResult.trustDelta + (amp.trustBonus || 0);
    amplified = true;
  }

  return {
    emotionalState: finalState,
    trustDelta: finalTrust,
    applied: true,
    discovered: true,
    amplified,
    deferredAgeHours: opts.timestamp && deferred.queuedAt
      ? (new Date(opts.timestamp) - new Date(deferred.queuedAt)) / 3600000
      : null,
    reason: amplified
      ? `Discovered concealed "${eventKey}" — original impact + discovered_betrayal amplifier.`
      : `Discovered concealed "${eventKey}" — original impact applied.`,
  };
}

/**
 * Generate a knowledge entry from an event — events become things NPCs know about.
 *
 * @param {string} eventKey  — key from EMOTIONAL_EVENTS
 * @param {string} targetName — who it happened to
 * @param {string} scope     — how the NPC learned: direct/witnessed → fact, gossip → rumor
 * @param {string} detail    — optional free text
 * @returns {object} knowledge entry { topic, detail, accuracy, willShareAt }
 */
export function eventToKnowledge(eventKey, targetName, scope, detail = '') {
  const accuracy = scope === 'direct' || scope === 'witnessed' ? 'fact' : 'rumor';
  const topic = eventKey.replace(/_/g, ' ');
  const fullDetail = detail || `${topic} involving ${targetName}`;

  // Gossip may distort — 20% chance a gossip-sourced memory is inaccurate
  const finalAccuracy = (scope === 'gossip' && Math.random() < 0.2) ? 'partial' : accuracy;

  return {
    topic,
    detail: fullDetail,
    accuracy: finalAccuracy,
    willShareAt: accuracy === 'fact' ? 'neutral' : 'friendly',
    source: scope,
    eventKey,
    targetName,
  };
}

/**
 * Apply an emotional event to an NPC. Returns updated emotional state.
 *
 * @param {object} npc - NPC with emotionalState field
 * @param {string} eventKey - key from EMOTIONAL_EVENTS
 * @param {object} opts - { timestamp (ISO string) }
 * @returns {object} { emotionalState, trustDelta }
 */
export function applyEmotionalEvent(npc, eventKey, opts = {}) {
  const event = EMOTIONAL_EVENTS[eventKey];
  if (!event) return { emotionalState: npc.emotionalState || defaultEmotionalState(), trustDelta: 0 };

  const now = opts.timestamp || new Date().toISOString();
  const state = { ...(npc.emotionalState || defaultEmotionalState()) };

  // Set new mood — stronger emotions override weaker ones
  const currentIntensity = state.intensity || 0;
  if (event.intensity >= currentIntensity || state.mood === 'calm') {
    state.mood = event.mood;
    state.intensity = Math.min(5, event.intensity);
    state.setAt = now;
  } else {
    // Weaker event — blend intensity slightly upward
    state.intensity = Math.min(5, state.intensity + 1);
  }

  // Log the event
  state.recentEvents = [...(state.recentEvents || []).slice(-9), { event: eventKey, mood: event.mood, timestamp: now }];

  return { emotionalState: state, trustDelta: event.trust || 0 };
}

/**
 * Decay emotional state over time. Moods fade toward 'calm' based on half-life.
 *
 * @param {object} emotionalState
 * @param {string} currentTime - ISO string
 * @returns {object} updated emotionalState
 */
export function decayEmotion(emotionalState, currentTime) {
  if (!emotionalState || emotionalState.mood === 'calm') return emotionalState || defaultEmotionalState();

  const moodDef = MOODS[emotionalState.mood];
  if (!moodDef || moodDef.halfLifeHours === Infinity) return emotionalState;

  const setAt = new Date(emotionalState.setAt || currentTime);
  const now = new Date(currentTime);
  const hoursElapsed = (now - setAt) / (1000 * 60 * 60);

  // Exponential decay: intensity * (0.5 ^ (hours / halfLife))
  const decayFactor = Math.pow(0.5, hoursElapsed / moodDef.halfLifeHours);
  const newIntensity = Math.round(emotionalState.intensity * decayFactor);

  if (newIntensity <= 0) {
    // Mood fades to calm but preserve the event log and deferred queue —
    // those are history that outlives the flare-up.
    return {
      ...defaultEmotionalState(),
      recentEvents: emotionalState.recentEvents || [],
      deferredEvents: emotionalState.deferredEvents || [],
    };
  }
  return { ...emotionalState, intensity: newIntensity };
}

/**
 * Get current emotional modifiers for feeding into other subsystems.
 */
export function getEmotionalModifiers(emotionalState) {
  if (!emotionalState || emotionalState.mood === 'calm') {
    return { deceptionMod: 0, trustMod: 0, courageMod: 0, mood: 'calm', intensity: 0 };
  }
  const def = MOODS[emotionalState.mood] || MOODS.calm;
  const scale = (emotionalState.intensity || 1) / 3; // normalize around intensity 3
  return {
    deceptionMod: Math.round(def.deceptionMod * scale),
    trustMod: Math.round(def.trustMod * scale),
    courageMod: Math.round(def.courageMod * scale),
    mood: emotionalState.mood,
    intensity: emotionalState.intensity || 0,
  };
}

export function defaultEmotionalState() {
  return { mood: 'calm', intensity: 0, setAt: null, recentEvents: [] };
}


// ══════════════════════════════════════════════════════════════════════════════
// 2. MEMORY & TRUST
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Memory entry types. Each has a trust impact and decay behavior.
 */
export const MEMORY_TYPES = {
  promise_kept:    { baseTrust: 10,  decaysAfterDays: 30, label: 'Kept a promise'       },
  promise_broken:  { baseTrust: -20, decaysAfterDays: 60, label: 'Broke a promise'      },
  saved_life:      { baseTrust: 30,  decaysAfterDays: 90, label: 'Saved their life'     },
  helped:          { baseTrust: 8,   decaysAfterDays: 20, label: 'Helped them'           },
  gift_given:      { baseTrust: 5,   decaysAfterDays: 14, label: 'Gave a gift'           },
  insulted:        { baseTrust: -10, decaysAfterDays: 14, label: 'Insulted them'         },
  threatened:      { baseTrust: -15, decaysAfterDays: 30, label: 'Threatened them'       },
  stole_from:      { baseTrust: -25, decaysAfterDays: 60, label: 'Stole from them'       },
  caught_lying:    { baseTrust: -20, decaysAfterDays: 45, label: 'Caught lying to them'  },
  fought_together: { baseTrust: 15,  decaysAfterDays: 30, label: 'Fought alongside them' },
  shared_secret:   { baseTrust: 12,  decaysAfterDays: 45, label: 'Shared a secret'       },
  betrayed_secret: { baseTrust: -30, decaysAfterDays: 90, label: 'Betrayed their secret' },
  fair_trade:      { baseTrust: 3,   decaysAfterDays: 10, label: 'Fair dealing'           },
  overcharged:     { baseTrust: -8,  decaysAfterDays: 20, label: 'Tried to rip them off' },
};

/**
 * Record a memory for an NPC about the party.
 *
 * @param {object} npc - NPC with memories array
 * @param {string} memoryType - key from MEMORY_TYPES
 * @param {string} detail - free text describing the specific event
 * @param {object} opts - { timestamp, pcName }
 * @returns {object} { memory (the new entry), trustDelta }
 */
export function recordMemory(npc, memoryType, detail = '', opts = {}) {
  const def = MEMORY_TYPES[memoryType];
  if (!def) return { memory: null, trustDelta: 0 };

  const memory = {
    type: memoryType,
    label: def.label,
    detail,
    pcName: opts.pcName || 'the party',
    timestamp: opts.timestamp || new Date().toISOString(),
    trustImpact: def.baseTrust,
    decaysAfterDays: def.decaysAfterDays,
  };

  return { memory, trustDelta: def.baseTrust };
}

/**
 * Compute total trust score from memories, accounting for decay.
 *
 * @param {Array} memories - NPC's memory array
 * @param {string} currentDate - ISO date string
 * @returns {object} { trustScore, activeMemories, decayedCount }
 */
export function computeTrustScore(memories = [], currentDate) {
  const now = new Date(currentDate || Date.now());
  let trustScore = 0;
  let decayedCount = 0;
  const activeMemories = [];

  for (const mem of memories) {
    const created = new Date(mem.timestamp);
    const daysSince = (now - created) / (1000 * 60 * 60 * 24);

    if (daysSince > mem.decaysAfterDays) {
      // Memory has faded — reduced impact
      const fadeFactor = Math.max(0.1, 1 - ((daysSince - mem.decaysAfterDays) / mem.decaysAfterDays));
      trustScore += Math.round(mem.trustImpact * fadeFactor);
      if (fadeFactor <= 0.1) {
        decayedCount++;
        continue; // Effectively forgotten
      }
    } else {
      trustScore += mem.trustImpact;
    }
    activeMemories.push(mem);
  }

  return { trustScore, activeMemories, decayedCount };
}

/**
 * Get trust tier label and gameplay effects.
 */
export function getTrustTier(trustScore) {
  if (trustScore >= 50)  return { tier: 'devoted',    label: 'Devoted',     priceMod: -15, secretAccess: 'all',  questAccess: true,  vouchForParty: true  };
  if (trustScore >= 25)  return { tier: 'trusted',    label: 'Trusted',     priceMod: -10, secretAccess: 'high', questAccess: true,  vouchForParty: true  };
  if (trustScore >= 10)  return { tier: 'friendly',   label: 'Warm',        priceMod: -5,  secretAccess: 'medium',questAccess: true, vouchForParty: false };
  if (trustScore >= -10) return { tier: 'neutral',    label: 'Neutral',     priceMod: 0,   secretAccess: 'low',  questAccess: true,  vouchForParty: false };
  if (trustScore >= -25) return { tier: 'wary',       label: 'Wary',        priceMod: 10,  secretAccess: 'none', questAccess: false, vouchForParty: false };
  if (trustScore >= -50) return { tier: 'distrustful',label: 'Distrustful', priceMod: 25,  secretAccess: 'none', questAccess: false, vouchForParty: false };
  return                         { tier: 'hostile',    label: 'Hostile',     priceMod: 50,  secretAccess: 'none', questAccess: false, vouchForParty: false };
}


// ══════════════════════════════════════════════════════════════════════════════
// 3. GOALS & MOTIVATIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Goal categories with generation weights per occupation type.
 */
export const GOAL_CATEGORIES = {
  survival:   { label: 'Survival',   examples: ['flee the region before winter', 'find a cure for the plague', 'pay off a dangerous debt'] },
  wealth:     { label: 'Wealth',     examples: ['become the wealthiest merchant', 'find a legendary treasure', 'secure a trade monopoly'] },
  power:      { label: 'Power',      examples: ['become mayor', 'earn a noble title', 'control the thieves guild'] },
  knowledge:  { label: 'Knowledge',  examples: ['find a lost spellbook', 'uncover ancient ruins', 'learn the truth about their heritage'] },
  protection: { label: 'Protection', examples: ['keep family safe', 'defend the village', 'guard a sacred relic'] },
  revenge:    { label: 'Revenge',    examples: ['find the bandit who killed their partner', 'expose a corrupt official', 'reclaim stolen heirloom'] },
  love:       { label: 'Love',       examples: ['reunite with estranged child', 'win someone\'s affection', 'make amends with an old friend'] },
  freedom:    { label: 'Freedom',    examples: ['escape servitude', 'clear their name', 'break a curse'] },
  duty:       { label: 'Duty',       examples: ['fulfill an oath', 'complete a pilgrimage', 'deliver an urgent message'] },
  legacy:     { label: 'Legacy',     examples: ['build something that outlasts them', 'train an apprentice', 'write the definitive history'] },
};

/**
 * Occupation → likely goal category weights.
 */
const OCCUPATION_GOAL_WEIGHTS = {
  blacksmith:   { wealth: 30, protection: 25, legacy: 20, duty: 15, survival: 10 },
  merchant:     { wealth: 40, power: 20, protection: 15, survival: 15, freedom: 10 },
  innkeeper:    { wealth: 25, protection: 25, love: 20, survival: 15, legacy: 15 },
  guard:        { duty: 35, protection: 25, power: 15, survival: 15, revenge: 10 },
  priest:       { duty: 30, protection: 25, knowledge: 20, legacy: 15, love: 10 },
  farmer:       { survival: 35, protection: 25, wealth: 15, love: 15, legacy: 10 },
  noble:        { power: 35, wealth: 20, legacy: 20, love: 15, revenge: 10 },
  thief:        { wealth: 30, freedom: 25, survival: 20, revenge: 15, power: 10 },
  scholar:      { knowledge: 40, legacy: 25, duty: 15, freedom: 10, power: 10 },
  soldier:      { duty: 30, survival: 25, revenge: 15, protection: 15, power: 15 },
  beggar:       { survival: 40, freedom: 25, wealth: 15, love: 10, revenge: 10 },
  entertainer:  { wealth: 25, love: 25, freedom: 20, legacy: 15, knowledge: 15 },
};

/**
 * Generate a goal for an NPC based on occupation and personality.
 *
 * @param {string} occupation
 * @param {string} personality
 * @param {number} level - higher-level NPCs have grander ambitions
 * @returns {object} { category, description, urgency: 'low'|'medium'|'high'|'desperate', progress: 0-100 }
 */
export function generateGoal(occupation, personality, level = 1) {
  const weights = OCCUPATION_GOAL_WEIGHTS[(occupation || '').toLowerCase()] ||
    { survival: 20, wealth: 15, power: 10, knowledge: 10, protection: 15, revenge: 10, love: 10, freedom: 5, duty: 5 };

  // Personality nudges
  const adjusted = { ...weights };
  const p = (personality || '').toLowerCase();
  if (p === 'greedy') { adjusted.wealth = (adjusted.wealth || 0) + 20; }
  if (p === 'pious') { adjusted.duty = (adjusted.duty || 0) + 15; adjusted.knowledge = (adjusted.knowledge || 0) + 10; }
  if (p === 'paranoid') { adjusted.survival = (adjusted.survival || 0) + 15; adjusted.protection = (adjusted.protection || 0) + 10; }
  if (p === 'cunning') { adjusted.power = (adjusted.power || 0) + 15; adjusted.wealth = (adjusted.wealth || 0) + 10; }
  if (p === 'kind') { adjusted.protection = (adjusted.protection || 0) + 15; adjusted.love = (adjusted.love || 0) + 10; }
  if (p === 'noble') { adjusted.legacy = (adjusted.legacy || 0) + 15; adjusted.duty = (adjusted.duty || 0) + 10; }
  if (p === 'melancholy') { adjusted.love = (adjusted.love || 0) + 15; adjusted.revenge = (adjusted.revenge || 0) + 10; }
  if (p === 'nervous') { adjusted.survival = (adjusted.survival || 0) + 15; adjusted.freedom = (adjusted.freedom || 0) + 10; }

  // Weighted random selection
  const total = Object.values(adjusted).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let category = 'survival';
  for (const [cat, w] of Object.entries(adjusted)) {
    r -= w;
    if (r <= 0) { category = cat; break; }
  }

  const catDef = GOAL_CATEGORIES[category];
  const description = catDef.examples[Math.floor(Math.random() * catDef.examples.length)];

  // Higher-level NPCs are further along and more urgent
  const progress = Math.min(95, Math.floor(Math.random() * 30) + (level * 5));
  const urgencies = ['low', 'medium', 'high', 'desperate'];
  const urgencyIdx = Math.min(3, Math.floor(Math.random() * 2) + (level >= 5 ? 1 : 0) + (category === 'survival' ? 1 : 0));

  return { category, description, urgency: urgencies[urgencyIdx], progress };
}

/**
 * Check if a party action helps or hinders an NPC's goal.
 * Returns a modifier for trust and deception scoring.
 *
 * @param {object} goal - NPC's goal
 * @param {string} partyAction - free text describing what the party did
 * @returns {object} { alignment: 'helps'|'hinders'|'neutral', trustMod, deceptionMod, reason }
 */
export function evaluateGoalAlignment(goal, partyAction) {
  if (!goal || !partyAction) return { alignment: 'neutral', trustMod: 0, deceptionMod: 0, reason: 'No goal or action.' };

  const action = partyAction.toLowerCase();
  const goalDesc = (goal.description || '').toLowerCase();
  const cat = goal.category;

  // Simple keyword matching — a real AI DM would use NLP, but this is deterministic
  const helpsKeywords = {
    survival: ['heal', 'save', 'cure', 'protect', 'rescue', 'defend', 'food', 'shelter'],
    wealth:   ['gold', 'pay', 'reward', 'trade', 'treasure', 'profit', 'merchant'],
    power:    ['support', 'endorse', 'ally', 'promote', 'authority', 'influence'],
    knowledge:['book', 'scroll', 'lore', 'teach', 'discover', 'library', 'research'],
    protection:['defend', 'guard', 'save', 'protect', 'shield', 'safe', 'ward'],
    revenge:  ['justice', 'punish', 'find', 'track', 'capture', 'avenge'],
    love:     ['reunite', 'letter', 'message', 'reconcile', 'forgive', 'family'],
    freedom:  ['free', 'release', 'escape', 'pardon', 'clear', 'break'],
    duty:     ['deliver', 'complete', 'fulfill', 'oath', 'pilgrimage', 'mission'],
    legacy:   ['build', 'create', 'teach', 'write', 'apprentice', 'monument'],
  };
  const hindersKeywords = {
    survival: ['attack', 'poison', 'destroy', 'burn', 'kill', 'threaten'],
    wealth:   ['steal', 'stole', 'tax', 'destroy', 'bankrupt', 'confiscate', 'rob'],
    power:    ['undermine', 'expose', 'depose', 'rival', 'oppose', 'block'],
    knowledge:['burn', 'destroy', 'hide', 'censor', 'secret'],
    protection:['attack', 'threaten', 'endanger', 'kidnap', 'harm'],
    revenge:  ['protect the target', 'warn', 'ally with target', 'hide'],
    love:     ['insult', 'separate', 'kidnap', 'kill', 'exile'],
    freedom:  ['imprison', 'chain', 'arrest', 'trap', 'enslave'],
    duty:     ['block', 'delay', 'steal mission item', 'distract'],
    legacy:   ['destroy', 'discredit', 'steal credit', 'undermine'],
  };

  const helps = (helpsKeywords[cat] || []).some(kw => action.includes(kw));
  const hinders = (hindersKeywords[cat] || []).some(kw => action.includes(kw));

  if (helps && !hinders) {
    return { alignment: 'helps', trustMod: 10, deceptionMod: -10, reason: `Party action helps NPC's ${cat} goal.` };
  }
  if (hinders && !helps) {
    return { alignment: 'hinders', trustMod: -10, deceptionMod: 15, reason: `Party action hinders NPC's ${cat} goal.` };
  }
  return { alignment: 'neutral', trustMod: 0, deceptionMod: 0, reason: 'No clear alignment with goal.' };
}


// ══════════════════════════════════════════════════════════════════════════════
// 4. NPC RELATIONSHIP WEB
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Relationship types between NPCs.
 */
export const RELATIONSHIP_TYPES = {
  ally:       { label: 'Ally',       trustTransfer: 0.3,  description: 'Trusted friend or partner' },
  family:     { label: 'Family',     trustTransfer: 0.5,  description: 'Blood or marriage bond' },
  employer:   { label: 'Employer',   trustTransfer: 0.2,  description: 'Pays their wages' },
  employee:   { label: 'Employee',   trustTransfer: 0.15, description: 'Works for them' },
  rival:      { label: 'Rival',      trustTransfer: -0.3, description: 'Competes against them' },
  enemy:      { label: 'Enemy',      trustTransfer: -0.5, description: 'Actively hostile' },
  debtor:     { label: 'Debtor',     trustTransfer: 0.1,  description: 'Owes them something' },
  creditor:   { label: 'Creditor',   trustTransfer: -0.1, description: 'They owe this person' },
  romantic:   { label: 'Romantic',   trustTransfer: 0.4,  description: 'Romantic attachment' },
  mentor:     { label: 'Mentor',     trustTransfer: 0.3,  description: 'Teaches or guides them' },
  student:    { label: 'Student',    trustTransfer: 0.2,  description: 'Learns from them' },
  informant:  { label: 'Informant',  trustTransfer: 0.15, description: 'Passes them information' },
  conspirator:{ label: 'Conspirator',trustTransfer: 0.25, description: 'Shares a secret scheme' },
};

/**
 * Calculate trust transfer when the party's relationship with one NPC
 * affects how another NPC views the party.
 *
 * If the party is trusted by NPC-A, and NPC-A is an ally of NPC-B,
 * then NPC-B warms to the party proportionally.
 *
 * @param {number} partyTrustWithSource - trust score the party has with the source NPC
 * @param {string} relationshipType - key from RELATIONSHIP_TYPES
 * @returns {number} trust modifier to apply to the target NPC
 */
export function calculateTrustTransfer(partyTrustWithSource, relationshipType) {
  const rel = RELATIONSHIP_TYPES[relationshipType];
  if (!rel) return 0;
  return Math.round(partyTrustWithSource * rel.trustTransfer);
}

/**
 * Generate plausible NPC-to-NPC relationships for a settlement.
 *
 * @param {Array} npcs - array of NPC objects
 * @param {number} density - avg relationships per NPC (default 2)
 * @returns {Array} array of { sourceId, targetId, type, detail }
 */
export function generateRelationshipWeb(npcs, density = 2) {
  if (!npcs || npcs.length < 2) return [];

  const relationships = [];
  const typeKeys = Object.keys(RELATIONSHIP_TYPES);

  for (const npc of npcs) {
    const numRels = Math.max(1, Math.floor(density + (Math.random() - 0.5) * 2));
    const otherNPCs = npcs.filter(n => n.name !== npc.name);

    for (let i = 0; i < numRels && otherNPCs.length > 0; i++) {
      const targetIdx = Math.floor(Math.random() * otherNPCs.length);
      const target = otherNPCs[targetIdx];

      // Don't duplicate — check if this pair already has a relationship
      if (relationships.some(r =>
        (r.sourceName === npc.name && r.targetName === target.name) ||
        (r.sourceName === target.name && r.targetName === npc.name)
      )) continue;

      // Pick a type weighted by occupations and personalities
      let type;
      const npcOcc = (npc.occupation || '').toLowerCase();
      const tgtOcc = (target.occupation || '').toLowerCase();
      if (npcOcc === tgtOcc) {
        type = Math.random() < 0.5 ? 'rival' : 'ally';
      } else if (['guard', 'soldier'].includes(npcOcc) && ['thief', 'beggar'].includes(tgtOcc)) {
        type = 'enemy';
      } else if (['priest', 'scholar'].includes(npcOcc) && ['scholar', 'priest'].includes(tgtOcc)) {
        type = Math.random() < 0.6 ? 'ally' : 'rival';
      } else {
        // Random with some structure
        const familyChance = Math.random();
        if (familyChance < 0.15) type = 'family';
        else if (familyChance < 0.25) type = 'romantic';
        else type = typeKeys[Math.floor(Math.random() * typeKeys.length)];
      }

      relationships.push({
        sourceName: npc.name,
        targetName: target.name,
        type,
        detail: `${npc.name} → ${target.name}: ${RELATIONSHIP_TYPES[type].description}`,
      });

      otherNPCs.splice(targetIdx, 1);
    }
  }

  return relationships;
}


// ══════════════════════════════════════════════════════════════════════════════
// 5. KNOWLEDGE MODEL
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Knowledge entry: something an NPC knows (or thinks they know).
 *
 * accuracy:
 *   'fact'      — known to be true (guard knows patrol routes)
 *   'rumor'     — heard secondhand, may be wrong
 *   'lie'       — deliberately false knowledge planted by someone
 *   'outdated'  — was true but world has moved on
 *   'partial'   — true but incomplete (knows location but not the danger)
 */
export const KNOWLEDGE_ACCURACY = ['fact', 'rumor', 'lie', 'outdated', 'partial'];

/**
 * Generate knowledge entries based on NPC occupation and level.
 *
 * @param {string} occupation
 * @param {number} level
 * @param {string} location
 * @returns {Array} array of { topic, detail, accuracy, willShareAt }
 */
export function generateKnowledge(occupation, level, location = 'town') {
  const knowledge = [];
  const occ = (occupation || '').toLowerCase();

  // Occupation-specific knowledge
  const occupationKnowledge = {
    blacksmith:  [
      { topic: 'weapons',      detail: 'quality and availability of local arms', accuracy: 'fact' },
      { topic: 'adventurers',  detail: 'who bought weapons recently', accuracy: 'fact' },
    ],
    merchant:    [
      { topic: 'trade routes', detail: 'which roads are safe for commerce', accuracy: 'fact' },
      { topic: 'prices',       detail: 'current market prices and trends', accuracy: 'fact' },
      { topic: 'travelers',    detail: 'who has passed through recently', accuracy: 'partial' },
    ],
    innkeeper:   [
      { topic: 'travelers',    detail: 'who stayed recently and where they went', accuracy: 'fact' },
      { topic: 'local gossip', detail: 'rumors and social dynamics', accuracy: 'rumor' },
      { topic: 'local events', detail: 'recent happenings in the area', accuracy: 'partial' },
    ],
    guard:       [
      { topic: 'local threats', detail: 'known dangers and criminal activity', accuracy: 'fact' },
      { topic: 'patrol routes', detail: 'when and where guards patrol', accuracy: 'fact' },
      { topic: 'wanted persons',detail: 'bounties and fugitives', accuracy: 'fact' },
    ],
    priest:      [
      { topic: 'local history', detail: 'religious and cultural history of the area', accuracy: 'fact' },
      { topic: 'undead',        detail: 'reports of undead or dark magic', accuracy: 'rumor' },
      { topic: 'healing',       detail: 'available divine services and costs', accuracy: 'fact' },
    ],
    farmer:      [
      { topic: 'wilderness',    detail: 'terrain, wildlife, seasonal patterns', accuracy: 'fact' },
      { topic: 'strange sightings', detail: 'unusual creatures or events in the fields', accuracy: 'rumor' },
    ],
    noble:       [
      { topic: 'politics',      detail: 'power dynamics and factional alliances', accuracy: 'fact' },
      { topic: 'history',       detail: 'lineages, treaties, old grudges', accuracy: 'fact' },
      { topic: 'secrets',       detail: 'court scandals and hidden alliances', accuracy: 'partial' },
    ],
    thief:       [
      { topic: 'underworld',    detail: 'criminal organizations and fences', accuracy: 'fact' },
      { topic: 'security',      detail: 'guard weaknesses and patrol gaps', accuracy: 'fact' },
      { topic: 'hidden passages',detail: 'secret routes and escape paths', accuracy: 'partial' },
    ],
    scholar:     [
      { topic: 'arcane lore',   detail: 'magical theory and artifact identification', accuracy: 'fact' },
      { topic: 'ancient history',detail: 'ruins, old civilizations, forgotten lore', accuracy: 'partial' },
      { topic: 'monsters',      detail: 'creature weaknesses and behaviors', accuracy: 'fact' },
    ],
  };

  const baseKnowledge = occupationKnowledge[occ] || [
    { topic: 'local area', detail: 'general knowledge about the neighborhood', accuracy: 'partial' },
  ];

  for (const k of baseKnowledge) {
    // Trust tier needed to share — more sensitive knowledge needs higher trust
    const willShareAt = k.accuracy === 'fact' && !['security', 'hidden passages', 'underworld', 'patrol routes'].includes(k.topic)
      ? 'neutral'
      : 'friendly';
    knowledge.push({ ...k, location, willShareAt });
  }

  // Add 1-2 rumors at higher levels
  if (level >= 3) {
    const rumors = [
      { topic: 'dungeon nearby', detail: 'heard about old ruins outside town', accuracy: 'rumor' },
      { topic: 'missing persons', detail: 'people have been disappearing at night', accuracy: 'rumor' },
      { topic: 'hidden treasure', detail: 'an old map was found in a dead traveler\'s pack', accuracy: 'rumor' },
      { topic: 'strange magic',   detail: 'lights seen in the forest at midnight', accuracy: 'rumor' },
      { topic: 'political unrest', detail: 'the lord\'s advisor is plotting something', accuracy: 'rumor' },
    ];
    const numRumors = Math.min(rumors.length, 1 + (level >= 6 ? 1 : 0));
    for (let i = 0; i < numRumors; i++) {
      const rumor = rumors[Math.floor(Math.random() * rumors.length)];
      knowledge.push({ ...rumor, location, willShareAt: 'neutral' });
    }
  }

  return knowledge;
}

/**
 * Determine if an NPC will share a knowledge entry based on trust tier.
 *
 * @param {object} knowledgeEntry - { willShareAt, ... }
 * @param {string} trustTier - from getTrustTier()
 * @returns {boolean}
 */
export function willShareKnowledge(knowledgeEntry, trustTier) {
  const tierOrder = ['hostile', 'distrustful', 'wary', 'neutral', 'friendly', 'trusted', 'devoted'];
  const requiredIdx = tierOrder.indexOf(knowledgeEntry.willShareAt || 'neutral');
  const currentIdx = tierOrder.indexOf(trustTier);
  return currentIdx >= requiredIdx;
}


// ══════════════════════════════════════════════════════════════════════════════
// 6. BEHAVIORAL TELLS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate observable behavioral cues based on current NPC state.
 * These feed into narrative descriptions — the party sees these, not the
 * underlying numbers.
 *
 * @param {object} npc - full NPC object with emotionalState, deceptionTendency, etc.
 * @param {object} context - { isDeceiving, isUnderPressure, trustTier }
 * @returns {Array<string>} array of observable behavior strings
 */
export function getBehavioralTells(npc, context = {}) {
  const tells = [];
  const personality = (npc.personality || '').toLowerCase();
  const tendency = npc.deceptionTendency || 'honest';
  const mood = npc.emotionalState?.mood || 'calm';
  const intensity = npc.emotionalState?.intensity || 0;

  // Personality-based baseline tells
  const personalityTells = {
    nervous:    ['fidgets with their hands', 'glances toward the exits', 'speaks in a halting cadence'],
    gruff:      ['keeps their arms crossed', 'makes minimal eye contact', 'speaks in clipped sentences'],
    jovial:     ['gestures broadly while talking', 'laughs easily', 'leans forward with interest'],
    secretive:  ['speaks in a low voice', 'positions themselves with their back to the wall', 'pauses before answering'],
    paranoid:   ['keeps scanning the room', 'flinches at sudden sounds', 'watches the party\'s hands'],
    cunning:    ['studies the party with sharp eyes', 'chooses words carefully', 'smiles at odd moments'],
    pious:      ['touches a holy symbol absently', 'references the gods in conversation', 'maintains a serene expression'],
    kind:       ['offers a warm smile', 'asks how the party is doing', 'remembers small details from before'],
    boisterous: ['speaks louder than necessary', 'slaps the table for emphasis', 'dominates the conversation'],
    melancholy: ['stares into the middle distance', 'sighs between sentences', 'gives wan smiles that don\'t reach their eyes'],
    stern:      ['maintains unwavering eye contact', 'stands with rigid posture', 'rarely changes expression'],
    flirtatious:['leans in close', 'maintains lingering eye contact', 'finds reasons to touch the party member\'s arm'],
    sarcastic:  ['raises one eyebrow frequently', 'smirks while speaking', 'emphasizes words with dry irony'],
  };
  const baseTells = personalityTells[personality] || [];
  if (baseTells.length > 0) {
    tells.push(baseTells[Math.floor(Math.random() * baseTells.length)]);
  }

  // Mood-based tells
  const moodTells = {
    angry:      ['jaw is clenched tight', 'nostrils flare', 'voice has a sharp edge'],
    afraid:     ['pupils are dilated', 'breathing is shallow and quick', 'keeps a hand near an exit or weapon'],
    grief:      ['eyes are red-rimmed', 'voice cracks occasionally', 'stares at nothing'],
    desperate:  ['speaks too quickly', 'clutches at the party\'s sleeve', 'voice has a pleading undertone'],
    grateful:   ['eyes glisten with emotion', 'reaches out to clasp hands', 'voice is warm and earnest'],
    suspicious: ['narrows eyes at the party', 'positions body to guard belongings', 'asks pointed counter-questions'],
    embarrassed:['color rises in their cheeks', 'avoids eye contact', 'stumbles over words'],
    inspired:   ['eyes are bright and focused', 'speaks with unusual conviction', 'stands taller than usual'],
  };
  if (mood !== 'calm' && intensity >= 2 && moodTells[mood]) {
    tells.push(moodTells[mood][Math.floor(Math.random() * moodTells[mood].length)]);
  }

  // Deception tells — only visible when the NPC is actively lying
  if (context.isDeceiving) {
    const deceptionTells = {
      honest:       ['swallows hard before speaking', 'can\'t maintain eye contact', 'voice goes flat and rehearsed'],
      evasive:      ['changes the subject smoothly', 'answers a slightly different question', 'their smile doesn\'t quite reach their eyes'],
      manipulative: ['maintains perfect eye contact', 'mirrors the party\'s body language', 'their voice becomes unusually smooth'],
      compulsive:   ['adds unnecessary details', 'contradicts something they said earlier', 'fidgets with increasing energy'],
    };
    const decTells = deceptionTells[tendency] || deceptionTells.honest;
    tells.push(decTells[Math.floor(Math.random() * decTells.length)]);
  }

  // Pressure tells
  if (context.isUnderPressure) {
    const courage = npc.courage || 50;
    if (courage < 30) {
      tells.push('their hands are trembling');
    } else if (courage < 50) {
      tells.push('they shift their weight nervously');
    } else if (courage >= 70) {
      tells.push('they set their jaw and meet the party\'s gaze steadily');
    }
  }

  return tells;
}


// ══════════════════════════════════════════════════════════════════════════════
// 7. COURAGE & PRESSURE RESPONSE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Courage score (0–100) determines how an NPC handles threats and pressure.
 * Based on class, level, personality, and current emotional state.
 */
export function calculateCourage(npc) {
  let courage = 50; // baseline

  // Class modifier
  const cls = (npc.class || '').toLowerCase();
  const braveCls = ['fighter', 'warrior', 'paladin', 'ranger', 'monk', 'soldier'];
  const timidCls = ['commoner', 'expert', 'adept'];
  if (braveCls.some(c => cls.includes(c))) courage += 15;
  if (timidCls.some(c => cls.includes(c))) courage -= 10;

  // Level modifier — experienced NPCs are braver
  courage += Math.min(20, (npc.level || 1) * 2);

  // Personality modifier
  const p = (npc.personality || '').toLowerCase();
  const bravePersonalities = { stern: 10, gruff: 8, noble: 10, boisterous: 5 };
  const timidPersonalities = { nervous: -15, melancholy: -5, 'absent-minded': -5 };
  courage += bravePersonalities[p] || timidPersonalities[p] || 0;

  // Emotional state modifier
  const eMods = getEmotionalModifiers(npc.emotionalState);
  courage += eMods.courageMod;

  return Math.max(0, Math.min(100, courage));
}

/**
 * Pressure response types — what happens when the NPC is cornered.
 */
export const PRESSURE_RESPONSES = {
  fold:       { label: 'Fold',      description: 'Gives up information, cooperates, may cry or beg.' },
  flee:       { label: 'Flee',      description: 'Tries to escape the situation physically.' },
  double_down:{ label: 'Double Down',description: 'Doubles down on their lie, becomes more aggressive.' },
  deflect:    { label: 'Deflect',   description: 'Tries to redirect attention, change the subject.' },
  fight:      { label: 'Fight',     description: 'Becomes physically aggressive or threatening.' },
  bargain:    { label: 'Bargain',   description: 'Offers a deal — information for safety, money for silence.' },
  shutdown:   { label: 'Shut Down', description: 'Goes silent, refuses to speak further.' },
};

/**
 * Determine how an NPC responds when under pressure (caught lying,
 * being interrogated, cornered by combat, etc.)
 *
 * @param {object} npc - full NPC object
 * @param {string} pressureType - 'caught_lying' | 'interrogated' | 'combat_threat' | 'cornered'
 * @returns {object} { response, description, courage, breakdown }
 */
export function getPressureResponse(npc, pressureType = 'interrogated') {
  const courage = calculateCourage(npc);
  const tendency = npc.deceptionTendency || 'honest';
  const personality = (npc.personality || '').toLowerCase();

  let response;

  if (pressureType === 'caught_lying') {
    // Caught in a lie — personality determines reaction
    if (tendency === 'compulsive')       response = courage >= 40 ? 'double_down' : 'deflect';
    else if (tendency === 'manipulative') response = courage >= 50 ? 'bargain' : 'deflect';
    else if (tendency === 'evasive')      response = courage >= 30 ? 'deflect' : 'fold';
    else                                  response = 'fold'; // honest NPCs caught lying always fold
  } else if (pressureType === 'combat_threat') {
    // Physical danger
    if (courage >= 70)      response = 'fight';
    else if (courage >= 50) response = 'bargain';
    else if (courage >= 30) response = 'flee';
    else                    response = 'fold';
  } else if (pressureType === 'cornered') {
    // No escape possible
    if (courage >= 60) response = personality === 'cunning' ? 'bargain' : 'fight';
    else if (courage >= 40) response = 'bargain';
    else response = 'shutdown';
  } else {
    // General interrogation
    if (courage >= 60)      response = tendency === 'manipulative' ? 'deflect' : 'shutdown';
    else if (courage >= 40) response = 'bargain';
    else if (courage >= 20) response = 'fold';
    else                    response = 'fold';
  }

  const def = PRESSURE_RESPONSES[response];
  return {
    response,
    label: def.label,
    description: def.description,
    courage,
    breakdown: `Courage ${courage} + ${tendency} tendency + ${pressureType} → ${def.label}`,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
// PERSONALITY PROFILE — aggregate snapshot for the AI DM
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build a complete personality profile for narrative generation.
 * This is the single function the AI DM calls to understand an NPC
 * before generating dialogue or making social decisions.
 *
 * @param {object} npc - full NPC object
 * @param {string} currentDate - ISO string for trust/memory decay
 * @returns {object} comprehensive personality snapshot
 */
export function buildPersonalityProfile(npc, currentDate) {
  if (!npc) return null;

  const emotionalMods = getEmotionalModifiers(npc.emotionalState);
  const { trustScore, activeMemories } = computeTrustScore(npc.memories || [], currentDate);
  const trustTier = getTrustTier(trustScore);
  const courage = calculateCourage(npc);

  return {
    // Identity
    name: npc.name,
    occupation: npc.occupation,
    personality: npc.personality,
    deceptionTendency: npc.deceptionTendency,

    // Current state
    mood: emotionalMods.mood,
    moodIntensity: emotionalMods.intensity,
    emotionalModifiers: emotionalMods,

    // Trust
    trustScore,
    trustTier: trustTier.tier,
    trustLabel: trustTier.label,
    trustEffects: trustTier,
    memorySummary: activeMemories.slice(-5).map(m => `${m.label}: ${m.detail}`),

    // Goals
    goal: npc.goal || null,

    // Knowledge
    availableKnowledge: (npc.knowledge || []).filter(k => willShareKnowledge(k, trustTier.tier)),
    withheldKnowledge: (npc.knowledge || []).filter(k => !willShareKnowledge(k, trustTier.tier)),

    // Courage & pressure
    courage,
    likelyPressureResponse: getPressureResponse(npc, 'interrogated').response,

    // Secrets
    secrets: npc.secrets || [],
    secretCount: (npc.secrets || []).length,

    // Tells
    currentTells: getBehavioralTells(npc, { isDeceiving: false, isUnderPressure: false, trustTier: trustTier.tier }),
  };
}
