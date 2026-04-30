// ─────────────────────────────────────────────────────
// Character skill helpers
// ─────────────────────────────────────────────────────
//
// Party characters store *ranks only* in `character.skillRanks`
// (canonical keys like "Diplomacy", "Intimidate", "Sense Motive").
// The real skill **total** used for d20 rolls is:
//
//   total = ranks + ability mod + class-skill bonus + misc + feats + ACP
//
// and the authoritative implementation lives in rulesEngine's
// `computeSkillCheck` / `computeAllSkillModifiers`.
//
// Historically, several callers (ShopTab, WorldTab, advancedService)
// reached for a non-existent `character.skills.diplomacy` field and
// silently defaulted to zero. That made every PC bargain/intimidate
// check a raw d20 roll. This helper replaces those reads with a real
// skill-total lookup that understands all three storage shapes:
//
//   1. `character.skillRanks` — the canonical shape (CharacterCreator
//      + LevelUpWizard both write here). We run the full rulesEngine
//      computation so feats, class skill bonus, ACP, and condition
//      mods are all folded in.
//   2. `character.skills` as an object, e.g. { diplomacy: 4 } — legacy
//      shape used by some test fixtures and imported HeroLab data.
//      We treat the value as the already-computed total.
//   3. `character.skills` as an array, e.g. [{ name: 'Diplomacy',
//      total: 7 }] — legacy shape from pre-skillRanks saves.
//
// All three shapes map to a single number.

import skillsData from '../data/skills.json';
import {
  computeSkillCheck,
  getCharacterModifiers,
} from './rulesEngine';
import classesData from '../data/classes.json';

// Build a cheap lookup from class name → class-skill list. `classesData` is
// an array in the repo shape, but we guard against an object just in case a
// future import reshapes it. Note: we intentionally match on `name` only —
// classes.json entries don't carry an `id` field.
function getClassSkillList(character) {
  if (!character?.class) return [];
  const list = Array.isArray(classesData) ? classesData : Object.values(classesData || {});
  const cls = list.find(c => c?.name === character.class);
  return cls?.classSkills || [];
}

// Shared ability mod helper — PF1e floor((score - 10) / 2).
function abilityMod(score) {
  return Math.floor(((score ?? 10) - 10) / 2);
}

// Case-insensitive canonical lookup: find the skill entry in skills.json
// matching `name`. Accepts 'Diplomacy', 'diplomacy', 'DIPLOMACY'.
function findCanonicalSkill(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  return (skillsData || []).find(s => s?.name && s.name.toLowerCase() === lower) || null;
}

// Detect sub-skill syntax like "Profession (gambler)" / "Craft (weapons)" /
// "Perform (oratory)". Knowledge sub-skills are NOT handled here because
// skills.json has a separate entry per Knowledge (X), so findCanonicalSkill
// picks them up directly. Returns { base, subtype } or null.
const SUBSKILL_BASES = new Set(['profession', 'craft', 'perform']);
function parseSubSkill(name) {
  const m = /^(\w+)\s*\(([^)]+)\)\s*$/.exec(String(name || ''));
  if (!m) return null;
  const base = m[1];
  if (!SUBSKILL_BASES.has(base.toLowerCase())) return null;
  // Return canonical-cased base so downstream lookups match skills.json.
  const canonBase = findCanonicalSkill(base);
  if (!canonBase) return null;
  return { base: canonBase, subtype: m[2].trim() };
}

// Read ranks for a sub-skill regardless of punctuation/spacing drift.
// "Profession (gambler)", "Profession(gambler)", and "profession (gambler)"
// all resolve to the same entry.
function readSubSkillRanks(skillRanks, baseName, subtype) {
  if (!skillRanks || typeof skillRanks !== 'object') return 0;
  const target = `${baseName} (${subtype})`.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const key of Object.keys(skillRanks)) {
    const norm = String(key).toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm === target) {
      const v = skillRanks[key];
      return typeof v === 'number' ? v : 0;
    }
  }
  return 0;
}

/**
 * Return the full skill-check total for a character on a given skill.
 * Returns 0 if the character or skill is unknown.
 *
 * @param {object} character  Party character object
 * @param {string} skillName  Skill name (case-insensitive)
 * @returns {number}
 */
export function getCharacterSkillTotal(character, skillName, worldState = undefined) {
  if (!character || !skillName) return 0;

  // 1. Canonical shape via skillRanks → full rulesEngine computation.
  if (character.skillRanks && typeof character.skillRanks === 'object') {
    const canon = findCanonicalSkill(skillName);
    if (canon) {
      try {
        const classSkills = getClassSkillList(character);
        // Phase 7.6 — accept optional worldState so familiar range gate applies.
        const condMods = getCharacterModifiers ? getCharacterModifiers(character, worldState) : {};
        // computeSkillCheck with d20Roll = 0 yields total = 0 + modifiers,
        // which is exactly the "flat skill bonus" we want to add to a d20
        // outside this function.
        const result = computeSkillCheck(character, canon.name, 0, skillsData, classSkills, condMods);
        if (result && typeof result.total === 'number') return result.total;
      } catch (err) {
        // Fall through to legacy shapes on any failure
      }
    }

    // 1b. Sub-skill path: 'Profession (gambler)', 'Craft (weapons)',
    // 'Perform (oratory)'. skills.json only has the base entry, so
    // computeSkillCheck can't resolve these directly. Compute manually using
    // the base entry's ability and check whether the class grants the
    // sub-skill via either the exact name or the catch-all "Base (all)".
    const sub = parseSubSkill(skillName);
    if (sub) {
      const ranks = readSubSkillRanks(character.skillRanks, sub.base.name, sub.subtype);
      const ability = sub.base.ability;
      const abilityScore = character.abilities?.[ability];
      const abMod = abilityMod(abilityScore);
      const exactName = `${sub.base.name} (${sub.subtype})`;
      const allName = `${sub.base.name} (all)`;
      const classSkills = getClassSkillList(character);
      const isClassSkill = classSkills.includes(exactName) || classSkills.includes(allName);
      const classSkillBonus = (ranks > 0 && isClassSkill) ? 3 : 0;
      let armorPen = 0;
      if (sub.base.armorPenalty) {
        const ac = character?.equippedArmor?.armorCheckPenalty || 0;
        const sh = character?.equippedShield?.armorCheckPenalty || 0;
        armorPen = ac + sh;
      }
      // Skill Focus on the exact sub-skill (case-insensitive substring on
      // the lowercased feat label, mirroring computeSkillCheck's loose match).
      let featBonus = 0;
      const feats = (character.feats || [])
        .filter(f => f != null)
        .map(f => (typeof f === 'string' ? f : (f.name || '')).toLowerCase().trim());
      if (feats.some(f => f.includes('skill focus') && f.includes(exactName.toLowerCase()))) {
        featBonus = ranks >= 10 ? 6 : 3;
      }
      return ranks + abMod + classSkillBonus + featBonus + armorPen;
    }
  }

  // 2. Legacy object shape: character.skills = { diplomacy: 4, ... }
  if (character.skills && !Array.isArray(character.skills) && typeof character.skills === 'object') {
    const lower = String(skillName).toLowerCase();
    const variants = [
      skillName,
      lower,
      lower.replace(/\s+/g, ''),
      lower.replace(/\s+(.)/g, (_, c) => c.toUpperCase()),
    ];
    for (const v of variants) {
      const raw = character.skills[v];
      if (typeof raw === 'number') return raw;
      if (raw && typeof raw === 'object') {
        return raw.total || raw.bonus || raw.ranks || 0;
      }
    }
  }

  // 3. Legacy array shape: character.skills = [{ name: 'Diplomacy', total: 7 }]
  if (Array.isArray(character.skills)) {
    const lower = String(skillName).toLowerCase();
    const entry = character.skills.find(
      s => s && (s.name === skillName || (s.name && s.name.toLowerCase() === lower))
    );
    if (entry) return entry.total || entry.bonus || entry.ranks || 0;
  }

  return 0;
}

/**
 * Return just the ranks invested in a skill (without ability mod or
 * class skill bonus). Used when a caller needs to know whether the
 * character is "trained" in a trained-only skill.
 */
export function getCharacterSkillRanks(character, skillName) {
  if (!character || !skillName) return 0;
  if (character.skillRanks) {
    const canon = findCanonicalSkill(skillName);
    if (canon && typeof character.skillRanks[canon.name] === 'number') {
      return character.skillRanks[canon.name];
    }
    // Also try the raw name in case callers passed an already-canonical label
    if (typeof character.skillRanks[skillName] === 'number') {
      return character.skillRanks[skillName];
    }
  }
  return 0;
}
