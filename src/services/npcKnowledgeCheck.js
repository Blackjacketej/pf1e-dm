// ============================================================================
// npcKnowledgeCheck.js — CRB-faithful Knowledge-check → NPC reveal mapping
// ============================================================================
// Bridges the Knowledge (X) skill system (rulesEngine.getCreatureIdentificationCheck)
// to our persistent NPC reveal layer (advanceNpcKnowledge / revealedFacts).
//
// CRB p. 99-100:
//   DC = 10 + creature's CR (or HD for humanoids)
//   Beat DC → identify the creature type and its most common abilities
//   Each 5 over DC → one additional fact
//   Wrong Knowledge skill → can still be used, but DC +5 (house rule varies;
//     we treat wrong skill as "not applicable" and surface that so the GM
//     can decide whether to allow a secondary skill)
//
// Reveal mapping (staircase based on margin over DC):
//   Beat by  0  → knowledgeLevel → 1  (name/species known)
//   Beat by  5  → unlock combatStats  (combat style + obvious offense/defense)
//   Beat by 10  → unlock stats        (full defensive/offensive statblock)
//   Beat by 15  → knowledgeLevel → 3  (deeper social context; who they are)
//   Beat by 20  → unlock secretFactions + trueAlignment
//
// Pure module — no Dexie. Returns a patch shape compatible with
// computeKnowledgeAdvance so callers can pipe through that helper.
// ============================================================================

import {
  getCreatureIdentificationCheck,
  countCreatureFactsLearned,
} from '../utils/rulesEngine';

/**
 * Normalize a skill string for comparison. Accepts any of:
 *   "Knowledge (Local)", "knowledge local", "Local", "local",
 *   "Knowledge(Local)", "Know. Local", etc.
 * Returns a lowercase canonical token (e.g. "local") or '' if unrecognized.
 */
export function normalizeKnowledgeSkill(skill) {
  if (!skill) return '';
  // Strip prefixes in longest-first order so "knowledge" isn't partially
  // eaten as "know" when there's no dot.
  const cleaned = String(skill)
    .toLowerCase()
    .replace(/^knowledge\s*[:(]?\s*/, '')
    .replace(/^know\.\s*/, '')
    .replace(/\)\s*$/, '')
    .trim();
  const knownSubskills = new Set([
    'arcana', 'dungeoneering', 'engineering', 'geography', 'history',
    'local', 'nature', 'nobility', 'planes', 'religion',
  ]);
  return knownSubskills.has(cleaned) ? cleaned : '';
}

/**
 * Extract the subskill token from "Knowledge (Local)" → "local".
 * Mirrors normalizeKnowledgeSkill but only for the canonical CRB label we
 * get back from getCreatureIdentificationCheck.
 */
function subskillOf(fullLabel) {
  const m = /Knowledge\s*\(([^)]+)\)/i.exec(String(fullLabel || ''));
  return m ? m[1].toLowerCase().trim() : '';
}

/**
 * Compute the reveal outcome of a Knowledge check made against an NPC.
 *
 * @param {Object} npc — expects any of: creatureType|type, cr|level|hitDice
 * @param {number} rollTotal — final d20 + modifiers total
 * @param {string} skill — e.g. "Knowledge (Local)" or "local"
 * @returns {null | {
 *   dc: number,
 *   margin: number,
 *   applicable: boolean,        // false if the skill doesn't fit the creature
 *   facts: number,              // CRB fact count (1 + floor(margin/5))
 *   toLevel: number | null,     // knowledgeLevel to advance to, if any
 *   unlock: string[] | null,    // revealedFacts to add, if any
 *   patch: Object | null,       // shorthand: { toLevel?, unlock? } for advanceNpcKnowledge
 * }}
 *
 * Returns `null` only for clearly invalid input (no npc, non-numeric roll).
 * When the skill is inapplicable or the roll fails, returns a populated
 * result with `applicable: false` or `toLevel/unlock: null` so callers
 * can render a "you learned nothing" outcome instead of guessing why.
 */
export function knowledgeCheckRevealNPC(npc, rollTotal, skill) {
  if (!npc || !Number.isFinite(rollTotal)) return null;

  // Use CR when present; fall back to HD/level. Ch. 4 examples use CR for
  // monsters and HD for humanoids — same number in most cases.
  const crLike = Number.isFinite(npc.cr) ? npc.cr
    : Number.isFinite(npc.hitDice) ? npc.hitDice
    : Number.isFinite(npc.level) ? npc.level
    : 1;
  const type = (npc.creatureType || npc.type || 'humanoid').toLowerCase();

  const { dc, skill: expectedSkill } = getCreatureIdentificationCheck(type, crLike);
  const expected = subskillOf(expectedSkill);
  const provided = normalizeKnowledgeSkill(skill);

  const margin = rollTotal - dc;
  const applicable = provided !== '' && provided === expected;

  // Wrong skill: surface the DC + expected skill but don't unlock anything.
  // GM can explicitly choose to accept a secondary skill via a different path.
  if (!applicable) {
    return {
      dc,
      margin,
      applicable: false,
      facts: 0,
      toLevel: null,
      unlock: null,
      patch: null,
      expectedSkill,
    };
  }

  // Failed check — still return the DC so UI can show what was needed.
  if (margin < 0) {
    return {
      dc, margin, applicable: true,
      facts: 0, toLevel: null, unlock: null, patch: null,
      expectedSkill,
    };
  }

  const facts = countCreatureFactsLearned(rollTotal, dc);

  // Staircase reveal. Each threshold is *cumulative* — higher margins grant
  // everything below. The patch is built to be one-way (never downgrade).
  const unlock = [];
  let toLevel = null;

  if (margin >= 0)  toLevel = 1;
  if (margin >= 5)  unlock.push('combatStats');
  if (margin >= 10) unlock.push('stats');
  if (margin >= 15) toLevel = 3;
  if (margin >= 20) {
    unlock.push('secretFactions');
    unlock.push('trueAlignment');
  }

  const patchHasContent = toLevel != null || unlock.length > 0;
  const patch = patchHasContent
    ? { ...(toLevel != null ? { toLevel } : {}), ...(unlock.length ? { unlock } : {}) }
    : null;

  return {
    dc, margin, applicable: true,
    facts,
    toLevel,
    unlock: unlock.length ? unlock : null,
    patch,
    expectedSkill,
  };
}
