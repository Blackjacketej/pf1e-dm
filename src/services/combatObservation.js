// ============================================================================
// combatObservation.js — per-encounter in-combat reveal layer
// ============================================================================
// In PF1e, merely fighting someone doesn't hand you their statblock — that's
// earned via Knowledge checks (CRB Ch. 4) or post-defeat examination. What
// fighting DOES give you is observed behavior: rough AC from which attacks
// connect, an HP descriptor from damage dealt, the attacks/abilities they've
// chosen to use, etc.
//
// This module models that ephemeral layer. Observations live on the active
// `combat.observed[enemyId]` record; they are cleared when combat ends, and
// optionally distilled into persistent `revealedFacts` via
// distillCombatObservations().
//
// All functions here are PURE — no Dexie, no React — so the caller owns state
// and the semantics are unit-testable without a DB.
// ============================================================================

// ── Shape / defaults ────────────────────────────────────────────────────────

/**
 * Build a fresh observation record for a combatant.
 * acLow/acHigh start as null (unknown); they narrow as attacks land/miss.
 * Null rather than ±Infinity so the record survives JSON serialization
 * if combat state ever gets persisted (save/resume mid-fight).
 */
export function emptyObservation() {
  return {
    acLow: null,
    acHigh: null,
    hpState: 'healthy',
    seenAttacks: [],
    seenAbilities: [],
    // savesObserved — PARTY member saves against THIS ENEMY's DCs.
    // Reflects how often PCs pass/fail vs the enemy's offensive DCs
    // (breath, frightful presence, caster spells). Informative about
    // the enemy's effective DCs.
    savesObserved: {
      fort: { passes: 0, fails: 0 },
      ref: { passes: 0, fails: 0 },
      will: { passes: 0, fails: 0 },
    },
    // enemySavesTaken — THIS ENEMY's saves against PARTY DCs.
    // Reflects how often the enemy passes/fails saves vs PC spells.
    // Informative about the enemy's defensive save bonuses. Kept in a
    // separate bucket from savesObserved because the two carry opposite
    // semantics — conflating them would make the tally meaningless.
    enemySavesTaken: {
      fort: { passes: 0, fails: 0 },
      ref: { passes: 0, fails: 0 },
      will: { passes: 0, fails: 0 },
    },
  };
}

// ── AC narrowing ────────────────────────────────────────────────────────────
// A hit at total T means AC ≤ T → upper bound can tighten to T.
// A miss at total T means AC > T → lower bound can tighten to T+1.
// Natural 1s always miss and natural 20s always hit regardless of AC, so they
// carry no information. The caller should pass `{natural: 1|20}` to opt out.
//
// Bounds are only tightened, never loosened — a subsequent looser result
// doesn't overwrite a stricter earlier one.

export function narrowAcFromAttack(observation, attackTotal, { hit, natural = null, targetAC = null } = {}) {
  if (!observation) return observation;
  if (natural === 1 || natural === 20) return observation;
  if (!Number.isFinite(attackTotal)) return observation;
  // PF1e faithfulness guard: a "hit" only narrows acHigh if the hit was
  // earned (totalAtk ≥ AC). The host combat engine's current logic treats
  // any threat roll as an auto-hit regardless of totalAtk, which would
  // wrongly record acHigh ≤ totalAtk on a crit-on-threat-that-missed-AC.
  // When targetAC is supplied, we gate the hit narrowing on it. targetAC
  // stays optional so callers that truly only know "hit or miss" (e.g.
  // imported logs) aren't broken.
  if (hit && targetAC != null && Number.isFinite(targetAC) && attackTotal < targetAC) {
    return observation;
  }
  const next = { ...observation };
  if (hit) {
    // AC ≤ attackTotal. Null means "no upper bound known yet".
    if (next.acHigh == null || attackTotal < next.acHigh) next.acHigh = attackTotal;
  } else {
    // AC > attackTotal → AC ≥ attackTotal + 1. Null means "no lower bound known yet".
    const floor = attackTotal + 1;
    if (next.acLow == null || floor > next.acLow) next.acLow = floor;
  }
  // Guard: if bounds have crossed (shouldn't in a sane game), clamp to equality.
  // Only meaningful when both bounds are numeric.
  if (next.acLow != null && next.acHigh != null && next.acLow > next.acHigh) {
    // Prefer the hit's upper bound when inconsistent — hits are stronger evidence
    next.acLow = next.acHigh;
  }
  return next;
}

/**
 * Format the narrowed AC for display. Returns:
 *   - "AC X"           when bounds pin a single value
 *   - "AC X–Y"         when narrowed to a finite range
 *   - "AC ≥ X" / "≤ Y" when one bound is still open
 *   - "AC ?"           when nothing has been observed
 */
export function describeAcRange(observation) {
  if (!observation) return 'AC ?';
  const { acLow, acHigh } = observation;
  // A numeric bound is "known"; null (or non-finite, for legacy records) is open.
  const lowKnown = Number.isFinite(acLow);
  const highKnown = Number.isFinite(acHigh);
  if (!lowKnown && !highKnown) return 'AC ?';
  if (!lowKnown) return `AC ≤ ${acHigh}`;
  if (!highKnown) return `AC ≥ ${acLow}`;
  if (acLow === acHigh) return `AC ${acLow}`;
  return `AC ${acLow}–${acHigh}`;
}

/** True iff any AC observation has accrued (any bound is numeric). */
export function hasAcObservation(observation) {
  if (!observation) return false;
  return Number.isFinite(observation.acLow) || Number.isFinite(observation.acHigh);
}

// ── HP descriptor ───────────────────────────────────────────────────────────
// CRB-faithful default: describe enemy condition rather than exposing numbers.
// Thresholds mirror the "bloodied" convention plus a near-death band.

export function hpDescriptor(currentHP, maxHP) {
  if (!Number.isFinite(currentHP) || !Number.isFinite(maxHP) || maxHP <= 0) {
    return 'healthy';
  }
  if (currentHP <= 0) return 'down';
  const ratio = currentHP / maxHP;
  if (ratio <= 0.25) return 'near-death';
  if (ratio <= 0.5) return 'bloodied';
  if (ratio <= 0.75) return 'lightly-wounded';
  return 'healthy';
}

/** Human-friendly label for the descriptor enum. */
export function hpDescriptorLabel(state) {
  switch (state) {
    case 'down': return 'down';
    case 'near-death': return 'near death';
    case 'bloodied': return 'bloodied';
    case 'lightly-wounded': return 'lightly wounded';
    case 'healthy': return 'healthy';
    default: return 'healthy';
  }
}

// ── Seen attacks / abilities ────────────────────────────────────────────────
// Set-union on a plain array (Dexie/React-friendly).

export function recordSeenAttack(observation, attackName) {
  if (!observation || !attackName) return observation;
  if (observation.seenAttacks.includes(attackName)) return observation;
  return { ...observation, seenAttacks: [...observation.seenAttacks, attackName] };
}

export function recordSeenAbility(observation, abilityName) {
  if (!observation || !abilityName) return observation;
  if (observation.seenAbilities.includes(abilityName)) return observation;
  return { ...observation, seenAbilities: [...observation.seenAbilities, abilityName] };
}

// ── Saves tally ─────────────────────────────────────────────────────────────

/**
 * Record a PARTY save outcome vs this enemy's DC — e.g. PC rolled Reflex
 * save vs dragon's breath. Writes to `savesObserved`.
 */
export function recordSaveOutcome(observation, save, passed) {
  if (!observation) return observation;
  const key = String(save || '').toLowerCase();
  if (!['fort', 'ref', 'will'].includes(key)) return observation;
  const prev = observation.savesObserved?.[key] || { passes: 0, fails: 0 };
  const next = passed
    ? { passes: prev.passes + 1, fails: prev.fails }
    : { passes: prev.passes, fails: prev.fails + 1 };
  return {
    ...observation,
    savesObserved: { ...(observation.savesObserved || {}), [key]: next },
  };
}

/**
 * Record THIS ENEMY's save outcome vs a party DC — e.g. dragon rolled
 * Reflex save vs wizard's fireball. Writes to `enemySavesTaken`.
 */
export function recordEnemySaveOutcome(observation, save, passed) {
  if (!observation) return observation;
  const key = String(save || '').toLowerCase();
  if (!['fort', 'ref', 'will'].includes(key)) return observation;
  const prev = observation.enemySavesTaken?.[key] || { passes: 0, fails: 0 };
  const next = passed
    ? { passes: prev.passes + 1, fails: prev.fails }
    : { passes: prev.passes, fails: prev.fails + 1 };
  return {
    ...observation,
    enemySavesTaken: { ...(observation.enemySavesTaken || {}), [key]: next },
  };
}

// ── Event folding ───────────────────────────────────────────────────────────
// Consumers (e.g. CombatTab after executeEnemyTurn) get a flat array of events
// describing what the party observed this turn. This helper folds them into
// one observation record so the caller doesn't have to carry a switch.
//
// Event shapes:
//   { kind: 'attack',     name: string }
//   { kind: 'ability',    name: string }
//   { kind: 'save',       save: 'fort'|'ref'|'will', passed: boolean }
//     → PARTY member's save vs this enemy's DC (legacy/default).
//   { kind: 'enemy-save', save: 'fort'|'ref'|'will', passed: boolean }
//     → THIS ENEMY's save vs a party DC. Distinct bucket.
// Unknown event kinds are silently ignored so the emitter can grow without
// coordinating with every consumer.

export function applyObservationEvents(observation, events) {
  if (!observation || !Array.isArray(events) || events.length === 0) {
    return observation;
  }
  let next = observation;
  for (const ev of events) {
    if (!ev) continue;
    if (ev.kind === 'attack') next = recordSeenAttack(next, ev.name);
    else if (ev.kind === 'ability') next = recordSeenAbility(next, ev.name);
    else if (ev.kind === 'save') next = recordSaveOutcome(next, ev.save, !!ev.passed);
    else if (ev.kind === 'enemy-save') next = recordEnemySaveOutcome(next, ev.save, !!ev.passed);
  }
  return next;
}

// ── Shape normalization (migration-safe reads) ──────────────────────────────
// Observation objects created before the savesObserved/enemySavesTaken split
// (or from older saved state) may be missing fields we now expect. This helper
// back-fills any missing top-level fields with their default shape so readers
// can assume the full record. Returns the same object unchanged when nothing
// is missing (cheap to call in render paths).
export function ensureObservationShape(observation) {
  if (!observation) return emptyObservation();
  const base = emptyObservation();
  let changed = false;
  const out = { ...observation };
  for (const k of Object.keys(base)) {
    if (out[k] === undefined) {
      out[k] = base[k];
      changed = true;
    }
  }
  // Sub-key fill for the two save buckets (handle partial buckets from
  // pre-split writes that only populated one key).
  for (const bucketKey of ['savesObserved', 'enemySavesTaken']) {
    const bucket = out[bucketKey];
    if (!bucket || typeof bucket !== 'object') {
      out[bucketKey] = base[bucketKey];
      changed = true;
      continue;
    }
    let bucketChanged = false;
    const nextBucket = { ...bucket };
    for (const save of ['fort', 'ref', 'will']) {
      if (!nextBucket[save] || typeof nextBucket[save] !== 'object') {
        nextBucket[save] = { passes: 0, fails: 0 };
        bucketChanged = true;
      }
    }
    if (bucketChanged) {
      out[bucketKey] = nextBucket;
      changed = true;
    }
  }
  return changed ? out : observation;
}

// ── Save-bucket read helpers ────────────────────────────────────────────────
// Tiny pure formatters for UI consumers. Kept here so the shape contract
// (pass/fail per save) lives next to the writers, and the UI stays dumb.

/**
 * True iff any save in the bucket has at least one observed outcome. Used to
 * suppress the UI row entirely when there's nothing to show.
 */
export function hasSaveObservations(bucket) {
  if (!bucket || typeof bucket !== 'object') return false;
  for (const save of ['fort', 'ref', 'will']) {
    const s = bucket[save];
    if (!s) continue;
    if ((s.passes | 0) > 0 || (s.fails | 0) > 0) return true;
  }
  return false;
}

/**
 * Format a save bucket as "Fort P/F, Ref P/F, Will P/F", omitting saves that
 * have no observed outcomes. Returns '' if nothing to show.
 * Label map: fort→Fort, ref→Ref, will→Will.
 */
export function describeSaveBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return '';
  const labels = { fort: 'Fort', ref: 'Ref', will: 'Will' };
  const parts = [];
  for (const save of ['fort', 'ref', 'will']) {
    const s = bucket[save];
    if (!s) continue;
    const p = s.passes | 0;
    const f = s.fails | 0;
    if (p === 0 && f === 0) continue;
    parts.push(`${labels[save]} ${p}/${f}`);
  }
  return parts.join(', ');
}

// ── Distillation into persistent revealedFacts ──────────────────────────────
// Called at endCombat. Returns an `unlock` array suitable for
// advanceNpcKnowledge(id, { unlock }), or null if nothing should persist.
//
// Role seam (forward-looking for ally-NPC combatants):
//   'enemy'    — default. Observation-based: ≥3 attacks seen → combatStats;
//                defeated → combatStats + stats; fled/survived → nothing new.
//   'ally'     — allies voluntarily coordinate. Unlock combatStats on start
//                (handled elsewhere) and stats on end if survived.
//   'betrayer' — treated as enemy for new observations; caller preserves any
//                prior reveals independently.
//   'summon'   — ephemeral helper; nothing persists.
//
// `outcome` is one of 'defeated' | 'fled' | 'surrendered' | 'survived'.

export function distillCombatObservations(observation, { role = 'enemy', outcome = 'defeated' } = {}) {
  if (role === 'summon') return null;
  if (!observation) observation = emptyObservation();

  const unlock = new Set();

  if (role === 'ally') {
    // Ally survived the fight with the party: full reveal earned.
    if (outcome === 'defeated' || outcome === 'survived') {
      unlock.add('combatStats');
      unlock.add('stats');
    } else if (outcome === 'fled' || outcome === 'surrendered') {
      unlock.add('combatStats');
    }
  } else {
    // 'enemy' or 'betrayer'
    if (outcome === 'defeated') {
      unlock.add('combatStats');
      unlock.add('stats');
    } else if (observation.seenAttacks.length >= 3) {
      // Party watched them fight long enough to learn their combat style,
      // even if they got away. CRB-spirit: you'd recognize them next time.
      unlock.add('combatStats');
    }
  }

  return unlock.size ? [...unlock] : null;
}
