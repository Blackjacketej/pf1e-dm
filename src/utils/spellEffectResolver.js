/**
 * PF1e Spell Effect Resolver
 *
 * Given a successfully cast spell, resolves its actual mechanical effects:
 *   - Rolls damage/healing dice per RAW formulas
 *   - Determines saving throw results
 *   - Applies conditions, buffs, debuffs with correct durations
 *   - Returns a structured result that the combat system can apply to game state
 *
 * This does NOT validate casting (that's spellEngine.resolveSpellCasting).
 * This resolves WHAT HAPPENS after the spell succeeds.
 */

import { roll, rollDice, mod } from './dice';
import { getSpellEffect } from '../data/spellEffects';
import { resolveSave, computeSave } from './rulesEngine';
import { createCondition } from './conditionTracker';
import { applyEvasion } from './classAbilityResolver';

// ─────────────────────────────────────────────────────
// DURATION PARSER
// ─────────────────────────────────────────────────────

/**
 * Parse a duration string into rounds for combat tracking.
 * @param {string} durationStr — e.g. "1 round/level", "1 min/level", "1d4 rounds"
 * @param {number} casterLevel — caster's effective level
 * @returns {number|null} Rounds, or null for permanent/non-trackable
 */
export function durationToRounds(durationStr, casterLevel = 1) {
  if (!durationStr) return null;
  const d = durationStr.toLowerCase().trim();

  if (d === 'instantaneous' || d === 'instant') return 0;
  if (d === 'permanent') return null; // No auto-expiry
  if (d === 'concentration') return null; // Manual tracking

  // "X round(s)"
  const fixedRounds = d.match(/^(\d+)\s*rounds?$/);
  if (fixedRounds) return parseInt(fixedRounds[1]);

  // "1 round/level"
  if (d.includes('round/level') || d.includes('rounds/level') || d.includes('round per level')) {
    return Math.max(1, casterLevel);
  }

  // "1 min/level"
  if (d.includes('min/level') || d.includes('minute/level') || d.includes('minutes/level') || d.includes('min per level')) {
    return Math.max(1, casterLevel * 10);
  }

  // "10 min/level"
  if (d.includes('10 min/level') || d.includes('10 minutes/level')) {
    return Math.max(1, casterLevel * 100);
  }

  // "1 hour/level"
  if (d.includes('hour/level') || d.includes('hours/level') || d.includes('hour per level')) {
    // In combat this is effectively permanent; track as 600 rounds/level but cap at 1000
    return Math.min(casterLevel * 600, 1000);
  }

  // "1 min" (flat)
  const flatMin = d.match(/^(\d+)\s*min(?:utes?)?$/);
  if (flatMin) return parseInt(flatMin[1]) * 10;

  // "Xd4 rounds", "Xd6 rounds", etc.
  const diceRounds = d.match(/(\d+)d(\d+)\s*rounds?/);
  if (diceRounds) return rollDice(parseInt(diceRounds[1]), parseInt(diceRounds[2])).total;

  // "Xd4+Y rounds"
  const diceBonus = d.match(/(\d+)d(\d+)\s*\+\s*(\d+)\s*rounds?/);
  if (diceBonus) return rollDice(parseInt(diceBonus[1]), parseInt(diceBonus[2])).total + parseInt(diceBonus[3]);

  // Fallback: try to extract any number
  const anyNum = d.match(/(\d+)/);
  if (anyNum) return parseInt(anyNum[1]);

  return null; // Can't parse — manual tracking
}


// ─────────────────────────────────────────────────────
// DAMAGE COMPUTATION
// ─────────────────────────────────────────────────────

/**
 * Compute damage for a damage spell based on its formula and caster level.
 * @param {object} damageData — from SPELL_EFFECTS[spell].damage
 * @param {number} casterLevel
 * @param {string} spellName — for special-case handling
 * @returns {{ total: number, rolls: number[], formula: string }}
 */
export function computeSpellDamage(damageData, casterLevel, spellName = '') {
  if (!damageData) return { total: 0, rolls: [], formula: 'none' };

  // Special-case spells
  if (damageData.special) {
    return computeSpecialDamage(damageData.special, casterLevel);
  }

  // Standard: XdY per level (capped at maxDice) or flat XdY
  let numDice = damageData.dice;
  if (damageData.perLevel) {
    numDice = Math.min(casterLevel, damageData.maxDice || 20);
  }

  const result = rollDice(numDice, damageData.sides);
  return {
    total: result.total,
    rolls: result.rolls || [result.total],
    formula: `${numDice}d${damageData.sides}`,
  };
}

/**
 * Handle spells with unique damage formulas.
 */
function computeSpecialDamage(specialType, casterLevel) {
  switch (specialType) {
    case 'magic_missile': {
      // 1 missile at 1st, +1 per 2 levels above 1st, max 5
      const missiles = Math.min(5, 1 + Math.floor((casterLevel - 1) / 2));
      let total = 0;
      const rolls = [];
      for (let i = 0; i < missiles; i++) {
        const r = roll(4) + 1; // 1d4+1 per missile
        rolls.push(r);
        total += r;
      }
      return { total, rolls, formula: `${missiles} missiles × (1d4+1)` };
    }

    case 'scorching_ray': {
      // 1 ray, +1 at 7th, +1 at 11th (max 3)
      const rays = casterLevel >= 11 ? 3 : casterLevel >= 7 ? 2 : 1;
      let total = 0;
      const rolls = [];
      for (let i = 0; i < rays; i++) {
        const r = rollDice(4, 6);
        rolls.push(r.total);
        total += r.total;
      }
      return { total, rolls, formula: `${rays} rays × 4d6 fire` };
    }

    case 'ice_storm': {
      const bludg = rollDice(3, 6);
      const cold = rollDice(2, 6);
      return {
        total: bludg.total + cold.total,
        rolls: [...(bludg.rolls || []), ...(cold.rolls || [])],
        formula: '3d6 bludgeoning + 2d6 cold',
      };
    }

    case 'harm': {
      const total = Math.min(casterLevel * 10, 150);
      return { total, rolls: [], formula: `${casterLevel} × 10 HP (max 150)` };
    }

    case 'heal': {
      const total = Math.min(casterLevel * 10, 150);
      return { total, rolls: [], formula: `${casterLevel} × 10 HP (max 150)` };
    }

    case 'finger_of_death': {
      // On failed save: 10 HP/CL. On success: 3d6 + CL
      // Caller handles which one to use based on save result
      const total = Math.min(casterLevel * 10, 200);
      return { total, rolls: [], formula: `${casterLevel} × 10 HP` };
    }

    case 'searing_light': {
      // 1d8/2CL, max 5d8 (or 1d6/CL vs undead max 10d6, or 1d8/CL vs constructs max 10d8)
      const dice = Math.min(Math.floor(casterLevel / 2), 5);
      const result = rollDice(Math.max(1, dice), 8);
      return { total: result.total, rolls: result.rolls || [], formula: `${dice}d8` };
    }

    case 'holy_smite': {
      const dice = Math.min(Math.floor(casterLevel / 2), 5);
      const result = rollDice(Math.max(1, dice), 8);
      return { total: result.total, rolls: result.rolls || [], formula: `${dice}d8 (vs evil)` };
    }

    case 'unholy_blight': {
      const dice = Math.min(Math.floor(casterLevel / 2), 5);
      const result = rollDice(Math.max(1, dice), 8);
      return { total: result.total, rolls: result.rolls || [], formula: `${dice}d8 (vs good)` };
    }

    case 'channel': {
      // 1d6 per 2 cleric levels
      const dice = Math.max(1, Math.floor(casterLevel / 2));
      const result = rollDice(dice, 6);
      return { total: result.total, rolls: result.rolls || [], formula: `${dice}d6` };
    }

    case 'meteor_swarm': {
      // 4 meteors: each 2d6 bludgeoning + 6d6 fire
      let total = 0;
      const rolls = [];
      for (let i = 0; i < 4; i++) {
        const bludg = rollDice(2, 6);
        const fire = rollDice(6, 6);
        total += bludg.total + fire.total;
        rolls.push(bludg.total + fire.total);
      }
      return { total, rolls, formula: '4 × (2d6 bludgeoning + 6d6 fire)' };
    }

    case 'phantasmal_killer': {
      // Death on failed Fort save, 3d6 on success
      const result = rollDice(3, 6);
      return { total: result.total, rolls: result.rolls || [], formula: '3d6 (on successful Fort)' };
    }

    case 'power_word_stun': {
      // Duration varies by HP: ≤50 = 4d4, 51-100 = 2d4, 101-150 = 1d4
      return { total: 0, rolls: [], formula: 'stun (no damage)' };
    }

    default:
      return { total: 0, rolls: [], formula: 'unknown' };
  }
}


// ─────────────────────────────────────────────────────
// HEALING COMPUTATION
// ─────────────────────────────────────────────────────

/**
 * Compute healing for a healing spell.
 * @param {object} healData — from SPELL_EFFECTS[spell].healing
 * @param {number} casterLevel
 * @returns {{ total: number, formula: string }}
 */
export function computeSpellHealing(healData, casterLevel) {
  if (!healData) return { total: 0, formula: 'none' };

  if (healData.special === 'heal') {
    const total = Math.min(casterLevel * 10, 150);
    return { total, formula: `${casterLevel} × 10 (max 150)` };
  }

  if (healData.special === 'channel') {
    return computeSpecialDamage('channel', casterLevel);
  }

  const result = rollDice(healData.dice, healData.sides);
  const bonus = Math.min(casterLevel * (healData.bonusPerLevel || 0), healData.maxBonus || 999);
  return {
    total: result.total + bonus,
    formula: `${healData.dice}d${healData.sides}+${bonus}`,
  };
}


// ─────────────────────────────────────────────────────
// MODIFIER SCALING
// ─────────────────────────────────────────────────────

/**
 * Apply caster-level scaling to modifier values.
 * E.g., Shield of Faith: +2 deflection, +1 per 6 CL above 1st, max +5
 */
function applyModifierScaling(modifiers, scaling, casterLevel) {
  if (!scaling) return { ...modifiers };
  const result = { ...modifiers };

  for (const [key, rule] of Object.entries(scaling)) {
    if (rule.thresholds) {
      // Threshold-based: specific values at specific levels
      let val = rule.base;
      for (const [lvl, newVal] of rule.thresholds) {
        if (casterLevel >= lvl) val = newVal;
      }
      result[key] = val;
    } else {
      // Linear scaling: base + 1 per perLevels above startAt, max cap
      const extra = Math.max(0, Math.floor((casterLevel - rule.startAt) / rule.perLevels));
      result[key] = Math.min(rule.base + extra, rule.max);
    }
  }

  return result;
}


// ─────────────────────────────────────────────────────
// MAIN RESOLVER
// ─────────────────────────────────────────────────────

/**
 * Resolve the mechanical effects of a successfully cast spell.
 *
 * @param {string} spellName — Name of the spell
 * @param {object} caster — Caster object { name, level, class, abilities, feats, ... }
 * @param {object|object[]} targets — Target(s) { name, id, currentHP, maxHP, abilities, conditions, ... }
 * @param {object} options — { spellDC, spellLevel, casterLevel }
 * @returns {object} Resolution result:
 *   {
 *     resolved: boolean,       // true if we have structured data, false = fallback to narration
 *     type: string,            // 'damage'|'healing'|'buff'|'debuff'|'control'
 *     hpChanges: { [id]: number },  // Positive = damage taken, negative = healed
 *     conditionsToApply: [ { targetId, condition, duration, source } ],
 *     conditionsToRemove: [ { targetId, conditionId } ],
 *     activeEffects: [ { targetId, name, modifiers, duration, source } ],
 *     messages: [ { text, type } ],
 *     saveResults: [ { targetId, targetName, saveType, passed, total, dc } ],
 *   }
 */
export function resolveSpellEffect(spellName, caster, targets, options = {}) {
  const effect = getSpellEffect(spellName);

  // No structured data — fall back to AI narration
  if (!effect) {
    return {
      resolved: false,
      type: 'unknown',
      hpChanges: {},
      conditionsToApply: [],
      conditionsToRemove: [],
      activeEffects: [],
      messages: [{ text: `${caster.name} casts ${spellName}!`, type: 'action' }],
      saveResults: [],
    };
  }

  const casterLevel = options.casterLevel || caster.level || 1;
  const spellDC = options.spellDC || 15;
  const targetList = Array.isArray(targets) ? targets : (targets ? [targets] : []);

  // Build save context for conditional racial bonuses (PF1e CRB: Hardy, Fearless, etc.)
  const saveContext = {
    isSpell: true,
    school: options.school || effect.school || '',
    descriptors: options.descriptors || effect.descriptors || [],
  };

  const result = {
    resolved: true,
    type: effect.type,
    hpChanges: {},
    conditionsToApply: [],
    conditionsToRemove: [],
    activeEffects: [],
    messages: [],
    saveResults: [],
  };

  switch (effect.type) {
    case 'damage':
      resolveDamageSpell(effect, caster, targetList, casterLevel, spellDC, result, saveContext);
      break;
    case 'healing':
      resolveHealingSpell(effect, caster, targetList, casterLevel, result);
      break;
    case 'buff':
      resolveBuffSpell(effect, caster, targetList, casterLevel, result, spellName);
      break;
    case 'debuff':
    case 'control':
      resolveDebuffSpell(effect, caster, targetList, casterLevel, spellDC, result, spellName, saveContext);
      break;
    default:
      result.resolved = false;
      result.messages.push({ text: `${caster.name} casts ${spellName}!`, type: 'action' });
  }

  // ── Racial Immunities Filter (PF1e CRB) ──
  // Elven Immunities: Elf/Half-Elf immune to magic sleep effects
  // Also respects class immunities (Paladin disease, Monk poison, etc.)
  if (result.conditionsToApply.length > 0) {
    result.conditionsToApply = result.conditionsToApply.filter(condApp => {
      const target = targetList.find(t => t.id === condApp.targetId);
      if (!target) return true;
      const immunities = [...(target.racialImmunities || []), ...(target.immunities || [])];
      const condLower = (condApp.condition || '').toLowerCase();
      if (immunities.some(imm => condLower.includes(imm))) {
        result.messages.push({
          text: `${target.name} is immune to ${condApp.condition}!`,
          type: 'success',
        });
        return false; // Filter out this condition
      }
      return true;
    });
  }

  return result;
}


// ─────────────────────────────────────────────────────
// TYPE-SPECIFIC RESOLVERS
// ─────────────────────────────────────────────────────

function resolveDamageSpell(effect, caster, targets, casterLevel, spellDC, result, saveContext = {}) {
  const dmg = computeSpellDamage(effect.damage, casterLevel, effect.name);

  for (const target of targets) {
    let finalDamage = dmg.total;
    let saveResult = null;

    // Saving throw for half damage (e.g., "Ref half")
    if (effect.save && effect.save !== 'none') {
      const saveType = parseSaveType(effect.save);
      if (saveType && target.abilities) {
        const d20 = roll(20);
        saveResult = resolveSave(target, saveType, spellDC, d20, {}, saveContext);
        result.saveResults.push({
          targetId: target.id,
          targetName: target.name,
          saveType,
          passed: saveResult.passed,
          total: saveResult.total,
          dc: spellDC,
          natural: d20,
        });

        if (effect.save.includes('half')) {
          // Evasion: Reflex half → 0 on pass, Improved Evasion: half on fail
          const saveType = parseSaveType(effect.save);
          if (saveType === 'Ref') {
            const evasionResult = applyEvasion(target, saveResult.passed, finalDamage);
            finalDamage = evasionResult.finalDamage;
            if (evasionResult.evasionApplied) {
              result.messages.push({ text: evasionResult.message, type: 'success' });
            }
          } else {
            finalDamage = saveResult.passed ? Math.floor(finalDamage / 2) : finalDamage;
          }
        } else if (saveResult.passed && effect.save.includes('negates')) {
          finalDamage = 0;
        }
      }
    }

    if (finalDamage > 0) {
      result.hpChanges[target.id] = (result.hpChanges[target.id] || 0) + finalDamage;
      result.messages.push({
        text: `${target.name} takes ${finalDamage} ${effect.damageType || ''} damage${saveResult ? (saveResult.passed ? ' (save for half)' : ' (failed save)') : ''}! [${dmg.formula}]`,
        type: 'danger',
      });
    } else if (saveResult?.passed) {
      result.messages.push({
        text: `${target.name} evades the spell! (${saveResult.total} vs DC ${spellDC})`,
        type: 'success',
      });
    }

    // Condition on failed save (e.g., Snowball → staggered, Sound Burst → stunned)
    if (effect.onFailedSave && saveResult && !saveResult.passed) {
      const condDuration = durationToRounds(effect.onFailedSave.duration, casterLevel);
      if (effect.onFailedSave.condition) {
        result.conditionsToApply.push({
          targetId: target.id,
          condition: effect.onFailedSave.condition,
          duration: condDuration,
          source: effect.name || caster.name,
        });
        result.messages.push({
          text: `${target.name} is ${effect.onFailedSave.condition}!`,
          type: 'danger',
        });
      }
    }
  }
}

function resolveHealingSpell(effect, caster, targets, casterLevel, result) {
  const heal = computeSpellHealing(effect.healing, casterLevel);

  for (const target of targets) {
    const healAmount = heal.total;
    // Healing is negative HP change (reduces damage)
    result.hpChanges[target.id] = (result.hpChanges[target.id] || 0) - healAmount;
    result.messages.push({
      text: `${target.name} is healed for ${healAmount} HP! [${heal.formula}]`,
      type: 'success',
    });

    // Heal spell removes certain conditions
    if (effect.removesConditions && target.conditions) {
      for (const condId of effect.removesConditions) {
        const hasCond = target.conditions?.some(c =>
          c.id === condId || c.name?.toLowerCase() === condId.toLowerCase()
        );
        if (hasCond) {
          result.conditionsToRemove.push({ targetId: target.id, conditionId: condId });
          result.messages.push({
            text: `${target.name} is no longer ${condId}!`,
            type: 'success',
          });
        }
      }
    }
  }
}

function resolveBuffSpell(effect, caster, targets, casterLevel, result, spellName) {
  const duration = durationToRounds(effect.duration, casterLevel);
  const scaledMods = applyModifierScaling(effect.modifiers || {}, effect.modifierScaling, casterLevel);

  // Determine actual targets
  const buffTargets = effect.target === 'self' ? [caster] :
    effect.target === 'allies' ? targets : targets;

  for (const target of buffTargets) {
    // If this maps to an existing condition (e.g., haste, enlarged)
    if (effect.condition) {
      result.conditionsToApply.push({
        targetId: target.id,
        condition: effect.condition,
        duration,
        source: spellName,
        customMods: scaledMods,
      });
      result.messages.push({
        text: `${target.name} gains ${effect.condition}${duration ? ` (${duration} rounds)` : ''}!`,
        type: 'success',
      });
    } else {
      // Generic active effect (not a PF1E_CONDITIONS entry)
      result.activeEffects.push({
        targetId: target.id,
        name: spellName,
        modifiers: scaledMods,
        duration,
        source: caster.name,
        spellName,
      });
      result.messages.push({
        text: `${target.name} is affected by ${spellName}${duration ? ` (${duration} rounds)` : ''}!`,
        type: 'success',
      });
    }
  }
}

function resolveDebuffSpell(effect, caster, targets, casterLevel, spellDC, result, spellName, saveContext = {}) {
  const duration = durationToRounds(effect.duration, casterLevel);

  for (const target of targets) {
    let saveResult = null;
    let conditionApplied = false;

    // HD limit check (e.g., Sleep only affects <= 4 HD)
    if (effect.hdLimit && target.level && target.level >= effect.hdLimit) {
      result.messages.push({
        text: `${target.name} is unaffected — too powerful for ${spellName}! (HD ${target.level} ≥ ${effect.hdLimit})`,
        type: 'info',
      });
      continue;
    }

    // HP threshold check (e.g., Power Word Kill only affects <= 100 HP)
    if (effect.hpThreshold && target.currentHP > effect.hpThreshold) {
      result.messages.push({
        text: `${target.name} is unaffected — HP too high for ${spellName}! (${target.currentHP} > ${effect.hpThreshold})`,
        type: 'info',
      });
      continue;
    }

    // Saving throw
    if (effect.save && effect.save !== 'none') {
      const saveType = parseSaveType(effect.save);
      if (saveType && target.abilities) {
        const d20 = roll(20);
        saveResult = resolveSave(target, saveType, spellDC, d20, {}, saveContext);
        result.saveResults.push({
          targetId: target.id,
          targetName: target.name,
          saveType,
          passed: saveResult.passed,
          total: saveResult.total,
          dc: spellDC,
          natural: d20,
        });
      }
    }

    // Apply based on save result
    if (saveResult && saveResult.passed) {
      // Save succeeded
      if (effect.save.includes('partial') || effect.save.includes('half')) {
        // Partial effect on save
        if (effect.onSave) {
          const partialDuration = durationToRounds(effect.onSave.duration || '1 round', casterLevel);
          if (effect.onSave.condition) {
            result.conditionsToApply.push({
              targetId: target.id,
              condition: effect.onSave.condition,
              duration: partialDuration,
              source: spellName,
            });
            result.messages.push({
              text: `${target.name} partially resists ${spellName} (${saveResult.total} vs DC ${spellDC}) — ${effect.onSave.condition} for ${partialDuration} round(s)!`,
              type: 'warning',
            });
          }
        } else {
          result.messages.push({
            text: `${target.name} partially resists ${spellName}! (${saveResult.total} vs DC ${spellDC})`,
            type: 'success',
          });
        }
      } else {
        // Full negate
        result.messages.push({
          text: `${target.name} resists ${spellName}! (${saveResult.total} vs DC ${spellDC})`,
          type: 'success',
        });
      }
      continue;
    }

    // Save failed or no save — apply full effect
    if (effect.special === 'instant_death') {
      result.hpChanges[target.id] = (result.hpChanges[target.id] || 0) + 9999;
      result.messages.push({
        text: `${target.name} is slain by ${spellName}!`,
        type: 'danger',
      });
      conditionApplied = true;
    }

    if (effect.condition && !conditionApplied) {
      result.conditionsToApply.push({
        targetId: target.id,
        condition: effect.condition,
        duration,
        source: spellName,
        savePerRound: effect.savePerRound || false,
        saveDC: spellDC,
        saveType: parseSaveType(effect.save),
      });
      result.messages.push({
        text: `${target.name} is ${effect.condition}${duration ? ` (${duration} rounds)` : ''}!${saveResult ? ` (failed save: ${saveResult.total} vs DC ${spellDC})` : ''}`,
        type: 'danger',
      });
    }

    // Modifier-based debuffs without named conditions (e.g., Ray of Enfeeblement, Slow)
    if (effect.modifiers && !effect.condition) {
      const mods = typeof effect.modifiers === 'object' ? { ...effect.modifiers } : {};
      // Handle rolling modifiers like "1d6+CL/2"
      if (typeof mods.strPenalty === 'string' && mods.strPenalty.includes('d')) {
        const dMatch = mods.strPenalty.match(/(\d+)d(\d+)/);
        if (dMatch) {
          const rolled = rollDice(parseInt(dMatch[1]), parseInt(dMatch[2])).total;
          const clBonus = Math.min(Math.floor(casterLevel / 2), 5);
          mods.strPenalty = -(rolled + clBonus); // Negative for penalty
        }
      }

      result.activeEffects.push({
        targetId: target.id,
        name: spellName,
        modifiers: mods,
        duration,
        source: caster.name,
        spellName,
        isDebuff: true,
      });
      result.messages.push({
        text: `${target.name} is affected by ${spellName}${duration ? ` (${duration} rounds)` : ''}!${saveResult ? ` (failed save: ${saveResult.total} vs DC ${spellDC})` : ''}`,
        type: 'danger',
      });
    }
  }
}


// ─────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────

/**
 * Parse save type from strings like "Will negates", "Ref half", "Fort partial".
 */
function parseSaveType(saveStr) {
  if (!saveStr) return null;
  const s = saveStr.toLowerCase();
  if (s.includes('will')) return 'Will';
  if (s.includes('fort')) return 'Fort';
  if (s.includes('ref')) return 'Ref';
  return null;
}
