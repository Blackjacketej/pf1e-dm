/**
 * Creature AI & Combat Action Economy
 *
 * Handles enemy decision-making in combat using Pathfinder 1e rules:
 * - Action economy: standard, move, full-round, swift, free actions
 * - Tactical behavior based on creature type and intelligence
 * - Morale system with fleeing
 * - Target selection with threat assessment
 * - Multi-attack and special ability support
 * - Utility AI scoring for complex tactical decisions
 * - Condition tracking and responses
 * - Special ability usage (breath weapons, gaze, combat maneuvers)
 * - Group coordination (focus fire, flanking, protect casters)
 * - Boss phase system with multi-phase behavior
 */

import { roll, rollDice } from '../utils/dice';
import {
  scorePossibleActions,
  coordinateGroupTactics,
  detectAbilities,
  detectBehaviorPreset,
  applyBehaviorPreset,
  getIntelligenceTierEnhanced,
  resolveBreathWeapon,
  resolveTripAttempt,
  resolveGrabAttempt,
  resolveFrightfulPresence,
  getBossPhase,
  CONDITIONS,
  canAct,
  tickConditions,
  analyzeEncounterDifficulty,
  BEHAVIOR_PRESETS,
  getEnemySkillBonus,
} from './monsterTactics.js';
import { aggregateConditionModifiers, createCondition } from '../utils/conditionTracker.js';
import { resolveFeintInCombat } from '../utils/rulesEngine.js';
import { enemyCanCastSpell, consumeEnemySpellSlot, initEnemySpellSlots } from '../utils/spellEngine.js';
import { resolveSpellEffect } from '../utils/spellEffectResolver.js';
import { createActiveEffect } from '../utils/activeEffectsTracker.js';
import { getCharacterModifiers } from '../utils/rulesEngine.js';
import { computeSneakAttackDamage, hasEvasion, applyEvasion, getPassiveClassModifiers } from '../utils/classAbilityResolver.js';

// Re-export for use by other components
export {
  coordinateGroupTactics,
  detectAbilities,
  detectBehaviorPreset,
  applyBehaviorPreset,
  getIntelligenceTierEnhanced,
  analyzeEncounterDifficulty,
  CONDITIONS,
  BEHAVIOR_PRESETS,
  tickConditions,
  initEnemySpellSlots,
  getBossPhase,
};

// ── Creature Intelligence Tiers ──
// Determines how smart the creature fights
function getIntelligenceTier(enemy) {
  const type = (enemy.type || '').toLowerCase();
  const name = (enemy.name || '').toLowerCase();

  // Mindless: oozes, most vermin, some constructs — no tactics, no morale
  if (type.includes('ooze') || type.includes('vermin') || type.includes('swarm'))
    return 'mindless';
  if (type.includes('construct') && !type.includes('clockwork') && !type.includes('robot'))
    return 'mindless';

  // Bestial: animals, low-int magical beasts — pack tactics, flee when hurt
  if (type.includes('animal')) return 'bestial';
  if (type.includes('magical beast')) return 'bestial';

  // Cunning: humanoids, fey, dragons, outsiders — real tactics
  if (type.includes('dragon')) return 'genius';
  if (type.includes('outsider')) return 'cunning';
  if (type.includes('fey')) return 'cunning';
  if (type.includes('humanoid')) return 'cunning';
  if (type.includes('monstrous humanoid')) return 'cunning';
  if (type.includes('aberration')) return 'cunning';

  // Undead: fearless, no morale checks, but may have tactics if intelligent
  if (type.includes('undead')) {
    if (name.includes('lich') || name.includes('vampire') || name.includes('spectre'))
      return 'cunning';
    return 'fearless';
  }

  // Default: basic tactics
  return 'bestial';
}

// ── Parse Attack Data ──
// Handles both structured attacks arrays (from encounters) and string format (from monster DB).
// Structured format: [{ name, bonus, damage, type, crit }]
// String format: "bite +6 (1d6+3)" or "2 claws +4 (1d4+2)"
function parseAttacks(atkString, dmgString, structuredAttacks) {
  // If we have structured attacks from encounter data, use those directly
  if (structuredAttacks && Array.isArray(structuredAttacks) && structuredAttacks.length > 0) {
    return structuredAttacks.map(sa => {
      const dmgMatch = (sa.damage || '1d6').match(/(\d+)d(\d+)(?:\s*([+-]\s*\d+))?/);
      const damageDice = dmgMatch ? parseInt(dmgMatch[1]) : 1;
      const damageSides = dmgMatch ? parseInt(dmgMatch[2]) : 6;
      const damageBonus = dmgMatch && dmgMatch[3] ? parseInt(dmgMatch[3].replace(/\s/g, '')) : 0;

      // Parse crit range
      let critRange = 20;
      if (sa.crit) {
        const critMatch = String(sa.crit).match(/(\d+)/);
        if (critMatch) critRange = parseInt(critMatch[1]);
      }

      return {
        name: sa.name || 'attack',
        bonus: sa.bonus || 0,
        damageDice,
        damageSides,
        damageBonus,
        count: sa.count || 1,
        type: sa.type || 'melee',
        critRange,
        critMultiplier: sa.critMultiplier || 2,
      };
    });
  }

  const attacks = [];
  if (!atkString) {
    attacks.push({ name: 'attack', bonus: 2, damageDice: 1, damageSides: 6, damageBonus: 0, count: 1 });
    return attacks;
  }

  // Try to parse structured attack like "bite +6" or "2 claws +4"
  const atkParts = atkString.split(/,\s*| and /i);
  for (const part of atkParts) {
    const match = part.trim().match(/(?:(\d+)\s+)?(.+?)\s+([+-]\d+)/);
    if (match) {
      const count = parseInt(match[1]) || 1;
      const name = match[2].trim();
      const bonus = parseInt(match[3]);

      // Parse damage from dmgString or guess from bonus
      let damageDice = 1, damageSides = 6, damageBonus = Math.max(0, Math.floor(bonus / 2));

      if (dmgString) {
        const dmgMatch = dmgString.match(/(\d+)d(\d+)(?:\s*([+-]\s*\d+))?/);
        if (dmgMatch) {
          damageDice = parseInt(dmgMatch[1]);
          damageSides = parseInt(dmgMatch[2]);
          damageBonus = dmgMatch[3] ? parseInt(dmgMatch[3].replace(/\s/g, '')) : 0;
        }
      }

      attacks.push({ name, bonus, damageDice, damageSides, damageBonus, count });
    }
  }

  if (attacks.length === 0) {
    const simpleMatch = atkString.match(/([+-]\d+)/);
    const bonus = simpleMatch ? parseInt(simpleMatch[1]) : 2;
    attacks.push({ name: 'attack', bonus, damageDice: 1, damageSides: 6, damageBonus: Math.max(0, Math.floor(bonus / 2)), count: 1 });
  }

  return attacks;
}

// ── Has Special Ability ──
function hasSpecial(enemy, keyword) {
  return (enemy.special || '').toLowerCase().includes(keyword.toLowerCase());
}

// ── Target Selection ──
function selectTarget(enemy, alivePCs, tier) {
  if (alivePCs.length === 0) return null;
  if (alivePCs.length === 1) return alivePCs[0];

  switch (tier) {
    case 'mindless':
      // Attack nearest/random — no intelligence to pick targets
      return alivePCs[Math.floor(Math.random() * alivePCs.length)];

    case 'bestial': {
      // Prefer weakened prey (lowest HP%) with some randomness
      const sorted = [...alivePCs].sort((a, b) =>
        (a.currentHP / a.maxHP) - (b.currentHP / b.maxHP)
      );
      return Math.random() < 0.6 ? sorted[0] : alivePCs[Math.floor(Math.random() * alivePCs.length)];
    }

    case 'cunning':
    case 'genius': {
      // Smart targeting: prioritize casters (low AC, high threat), then wounded
      const scored = alivePCs.map(pc => {
        let score = 0;
        const cls = (pc.class || '').toLowerCase();
        // Target casters first
        if (['wizard', 'sorcerer', 'witch', 'arcanist', 'cleric', 'oracle', 'druid', 'shaman'].includes(cls))
          score += 30;
        // Target healers
        if (['cleric', 'oracle', 'druid', 'shaman', 'paladin'].includes(cls))
          score += 20;
        // Low AC = easier target
        score += Math.max(0, 15 - (pc.ac || 10));
        // Wounded targets are appealing
        const hpPct = pc.currentHP / pc.maxHP;
        if (hpPct < 0.3) score += 25;
        else if (hpPct < 0.5) score += 10;
        // Genius creatures occasionally switch targets unpredictably
        if (tier === 'genius') score += Math.floor(Math.random() * 15);
        else score += Math.floor(Math.random() * 10);
        return { pc, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored[0].pc;
    }

    case 'fearless':
    default:
      // Undead: attack whoever is closest (random with slight preference for wounded)
      return Math.random() < 0.4
        ? [...alivePCs].sort((a, b) => (a.currentHP / a.maxHP) - (b.currentHP / b.maxHP))[0]
        : alivePCs[Math.floor(Math.random() * alivePCs.length)];
  }
}

// ── Morale Check ──
// Returns 'fight', 'flee', or 'surrender'
function checkMorale(enemy, allEnemies, tier) {
  // Mindless and fearless creatures never flee
  if (tier === 'mindless' || tier === 'fearless') return 'fight';

  const hpPct = enemy.currentHP / enemy.hp;
  const aliveAllies = allEnemies.filter(e => e.id !== enemy.id && e.currentHP > 0).length;
  const totalAllies = allEnemies.filter(e => e.id !== enemy.id).length;
  const alliesDead = totalAllies - aliveAllies;

  let fleeProbability = 0;

  // HP-based morale
  if (hpPct <= 0.15) fleeProbability += 0.5;
  else if (hpPct <= 0.25) fleeProbability += 0.3;
  else if (hpPct <= 0.4) fleeProbability += 0.1;

  // Allies falling raises fear
  if (totalAllies > 0) {
    if (aliveAllies === 0) fleeProbability += 0.4; // Last one standing
    else if (alliesDead >= 2) fleeProbability += 0.2;
  }

  // Intelligence modifies morale
  if (tier === 'bestial') fleeProbability *= 1.3; // Animals flee more readily
  if (tier === 'cunning') fleeProbability *= 0.8; // Smarter creatures hold longer
  if (tier === 'genius') fleeProbability *= 0.5;  // Dragons don't scare easy

  if (Math.random() < fleeProbability) {
    // Cunning creatures might surrender instead of flee
    if (tier === 'cunning' && hpPct > 0.1 && Math.random() < 0.3) return 'surrender';
    return 'flee';
  }

  return 'fight';
}

// ── Action Economy ──
// Pathfinder 1e: each round you get 1 standard + 1 move + 1 swift + free actions
// OR 1 full-round action + 1 swift + free actions
// Standard action = single attack, cast a spell, use ability
// Full-round action = full attack (all iterative attacks)
// Move action = move, draw weapon, stand up
export const ACTION_TYPES = {
  STANDARD: 'standard',   // Single attack, cast spell, use ability
  MOVE: 'move',           // Move, draw weapon, stand up
  FULL_ROUND: 'full-round', // Full attack (all natural attacks), charge
  SWIFT: 'swift',         // Quick abilities
  FREE: 'free',           // Drop item, speak
  IMMEDIATE: 'immediate', // Interrupt (uses swift)
};

// ── Decide Enemy Actions (Enhanced with Utility AI) ──
// Returns an array of action objects the enemy will take this turn
// Uses the utility AI scoring system for intelligent creatures with special abilities
export function decideEnemyActions(enemy, alivePCs, allEnemies, combatState = {}) {
  const tier = getIntelligenceTierEnhanced(enemy);
  const attacks = parseAttacks(enemy.atk || enemy.attack, enemy.dmg, enemy.attacks);
  const actions = [];

  // Tick conditions at start of turn
  if (enemy.conditions) {
    enemy.conditions = tickConditions(enemy.conditions);
  }

  // Can't act check (paralyzed, stunned, etc.)
  if (!canAct(enemy.conditions || [])) {
    return {
      actions: [{ type: ACTION_TYPES.FREE, action: 'incapacitated', description: `${enemy.name} is incapacitated and cannot act!` }],
      morale: 'fight',
      tier,
    };
  }

  // Check boss phase transitions
  const bossPhase = getBossPhase(enemy);
  if (bossPhase.changed) {
    for (const effect of bossPhase.effects) {
      if (effect.type === 'narration') {
        actions.push({ type: ACTION_TYPES.FREE, action: 'phase_change', description: effect.text });
      }
      if (effect.type === 'buff') {
        enemy[`_phase_${effect.effect}`] = effect.value;
      }
    }
  }

  // Check morale first
  const morale = checkMorale(enemy, allEnemies, tier);

  if (morale === 'flee') {
    actions.push({
      type: ACTION_TYPES.FULL_ROUND,
      action: 'flee',
      description: `${enemy.name} panics and attempts to flee the battle!`,
    });
    return { actions, morale: 'flee', tier };
  }

  if (morale === 'surrender') {
    actions.push({
      type: ACTION_TYPES.STANDARD,
      action: 'surrender',
      description: `${enemy.name} drops their weapon and begs for mercy!`,
    });
    return { actions, morale: 'surrender', tier };
  }

  // ── Use Utility AI for creatures with special abilities or high intelligence ──
  const abilities = detectAbilities(enemy);
  const useAdvancedAI = abilities.length > 0 || tier === 'cunning' || tier === 'genius';

  if (useAdvancedAI) {
    const directives = combatState.directives?.[enemy.id] || {};
    const bestAction = scorePossibleActions(enemy, alivePCs, allEnemies, combatState);

    // Apply focus fire directive from group tactics
    let target;
    if (directives.focusTarget) {
      target = alivePCs.find(p => p.id === directives.focusTarget) || selectTarget(enemy, alivePCs, tier);
    } else {
      target = selectTarget(enemy, alivePCs, tier);
    }
    if (!target) return { actions: [], morale: 'fight', tier };

    const flankBonus = directives.flanking ? directives.flankingBonus || 2 : 0;
    const phaseAtkBonus = enemy._phase_atkBonus || 0;
    const phaseDmgBonus = enemy._phase_dmgBonus || 0;

    switch (bestAction.action) {
      case 'breath_weapon': {
        const breathResult = resolveBreathWeapon(enemy, alivePCs);
        actions.push({
          type: ACTION_TYPES.STANDARD,
          action: 'breath_weapon',
          breathResult,
          description: `${enemy.name} unleashes a devastating breath weapon!`,
        });
        // PF1e: breath weapons recharge in 1d4 rounds
        enemy._breathRechargeRounds = Math.floor(Math.random() * 4) + 1;
        break;
      }

      case 'frightful_presence': {
        const fpResult = resolveFrightfulPresence(enemy, alivePCs);
        actions.push({
          type: ACTION_TYPES.FREE,
          action: 'frightful_presence',
          fpResult,
          description: `${enemy.name}'s terrifying presence washes over the battlefield!`,
        });
        // Still get a normal action after frightful presence
        actions.push(buildAttackAction(enemy, target, attacks, tier, flankBonus + phaseAtkBonus, phaseDmgBonus));
        break;
      }

      case 'trip': {
        const tripResult = resolveTripAttempt(enemy, target);
        actions.push({
          type: ACTION_TYPES.STANDARD,
          action: 'trip',
          target,
          tripResult,
          description: tripResult.success
            ? `${enemy.name} sweeps ${target.name}'s legs — they crash to the ground!`
            : `${enemy.name} attempts to trip ${target.name} but fails!`,
        });
        break;
      }

      case 'grab': {
        const grabResult = resolveGrabAttempt(enemy, target);
        actions.push({
          type: ACTION_TYPES.STANDARD,
          action: 'grab',
          target,
          grabResult,
          description: grabResult.success
            ? `${enemy.name} seizes ${target.name} in a crushing grip!`
            : `${enemy.name} tries to grab ${target.name} but can't get a hold!`,
        });
        break;
      }

      case 'gaze':
        actions.push({
          type: ACTION_TYPES.FREE,
          action: 'gaze',
          targets: alivePCs,
          description: `${enemy.name}'s terrible gaze sweeps across the party!`,
        });
        // Still get a normal action after gaze
        actions.push(buildAttackAction(enemy, target, attacks, tier, flankBonus + phaseAtkBonus, phaseDmgBonus));
        break;

      case 'cast_spell':
        actions.push({
          type: ACTION_TYPES.STANDARD,
          action: 'cast_spell',
          spell: bestAction.spell,
          target: bestAction.spell.category === 'buff' || bestAction.spell.category === 'healing' ? enemy : target,
          description: `${enemy.name} casts ${bestAction.spell.name}!`,
        });
        if (bestAction.spell) bestAction.spell.used = true;
        break;

      case 'summon':
        actions.push({
          type: ACTION_TYPES.FULL_ROUND,
          action: 'summon',
          description: `${enemy.name} begins a dark incantation, calling for reinforcements!`,
        });
        break;

      case 'reposition':
        actions.push({
          type: ACTION_TYPES.MOVE,
          action: 'reposition',
          description: directives.protectAlly
            ? `${enemy.name} moves to protect ${directives.protectAllyName || 'an ally'}.`
            : `${enemy.name} maneuvers for a better tactical position.`,
        });
        // Can still make a standard attack after repositioning
        if (target) {
          const bestAtk = attacks.reduce((a, b) => a.bonus > b.bonus ? a : b, attacks[0]);
          actions.push({
            type: ACTION_TYPES.STANDARD,
            action: 'attack',
            target,
            attack: { ...bestAtk, bonus: bestAtk.bonus + flankBonus + phaseAtkBonus },
            damageBonus: phaseDmgBonus,
            description: `${enemy.name} attacks ${target.name} with its ${bestAtk.name}!`,
          });
        }
        break;

      case 'feint': {
        // Enemy feints a PC — Bluff vs target's feint DC (CRB pp. 92, 201)
        const bluffBonus = getEnemySkillBonus(enemy, 'Bluff');
        const feintRoll = Math.floor(Math.random() * 20) + 1 + bluffBonus;
        const feintTarget = bestAction.target
          ? alivePCs.find(p => p.id === bestAction.target) || target
          : target;
        const feintResult = resolveFeintInCombat(feintRoll, {
          bab: feintTarget.bab || 0,
          wisMod: Math.floor(((feintTarget.abilities?.WIS || 10) - 10) / 2),
          senseMotive: feintTarget.skills?.['Sense Motive']?.bonus || 0,
          intelligence: feintTarget.abilities?.INT ?? 10,
          creatureType: 'humanoid',
        });
        actions.push({
          type: ACTION_TYPES.STANDARD,
          action: 'feint',
          feintResult,
          targetId: feintTarget.id,
          description: feintResult.success
            ? `${enemy.name} feints ${feintTarget.name}, denying their DEX bonus to AC!`
            : `${enemy.name} attempts to feint ${feintTarget.name} but fails.`,
          conditionToApply: feintResult.success ? {
            targetId: feintTarget.id,
            condition: 'feinted',
            duration: 1,
            source: `${enemy.name} feint`,
          } : null,
        });
        break;
      }

      case 'total_defense':
        actions.push({
          type: ACTION_TYPES.STANDARD,
          action: 'total_defense',
          acBonus: 4,
          description: `${enemy.name} hunkers down in a defensive stance (+4 AC).`,
        });
        break;

      case 'flee':
        actions.push({
          type: ACTION_TYPES.FULL_ROUND,
          action: 'flee',
          description: `${enemy.name} turns and flees the battle!`,
        });
        return { actions, morale: 'flee', tier };

      case 'full_attack':
      default:
        // Default to best attack action
        actions.push(buildAttackAction(enemy, target, attacks, tier, flankBonus + phaseAtkBonus, phaseDmgBonus));
        break;
    }

    // Flanking narration
    if (directives.flanking && actions.some(a => a.action === 'attack' || a.action === 'full_attack')) {
      actions.unshift({
        type: ACTION_TYPES.FREE,
        action: 'flanking',
        description: `${enemy.name} coordinates with allies to flank ${target.name} (+2 to hit)!`,
      });
    }

    // Behavior preset flavor (taunts, etc.)
    if (enemy.behavior?.taunts && Math.random() < 0.3) {
      const taunt = enemy.behavior.taunts[Math.floor(Math.random() * enemy.behavior.taunts.length)];
      actions.push({ type: ACTION_TYPES.FREE, action: 'taunt', description: taunt });
    }

    // Special abilities as bonus actions
    if (hasSpecial(enemy, 'poison') && actions.some(a => a.action === 'attack' || a.action === 'full_attack')) {
      actions.push({ type: ACTION_TYPES.FREE, action: 'special', special: 'poison', description: `${enemy.name}'s attack drips with venom!` });
    }

    return { actions, morale: 'fight', tier, reasoning: bestAction.reasoning };
  }

  // ── Fallback: Original simple AI for basic creatures ──
  const target = selectTarget(enemy, alivePCs, tier);
  if (!target) return { actions: [], morale: 'fight', tier };

  const hasMultipleAttacks = attacks.length > 1 || attacks.some(a => a.count > 1);
  const useFullAttack = hasMultipleAttacks && Math.random() < 0.7;

  if (useFullAttack) {
    const allAttacks = [];
    for (const atk of attacks) {
      for (let i = 0; i < atk.count; i++) {
        allAttacks.push({ ...atk });
      }
    }
    actions.push({
      type: ACTION_TYPES.FULL_ROUND,
      action: 'full_attack',
      target,
      attacks: allAttacks,
      description: `${enemy.name} unleashes a full attack against ${target.name}!`,
    });
  } else {
    const bestAtk = attacks.reduce((a, b) => a.bonus > b.bonus ? a : b, attacks[0]);
    actions.push({
      type: ACTION_TYPES.STANDARD,
      action: 'attack',
      target,
      attack: bestAtk,
      description: `${enemy.name} attacks ${target.name} with its ${bestAtk.name}!`,
    });
  }

  if (hasSpecial(enemy, 'poison') && Math.random() < 0.5) {
    actions.push({ type: ACTION_TYPES.FREE, action: 'special', special: 'poison', description: `${enemy.name}'s attack drips with venom!` });
  }

  if (hasSpecial(enemy, 'pounce') && !useFullAttack) {
    actions[0] = {
      ...actions[0],
      type: ACTION_TYPES.FULL_ROUND,
      action: 'pounce',
      attacks: attacks.flatMap(a => Array(a.count).fill({ ...a })),
      description: `${enemy.name} pounces on ${target.name} with a flurry of attacks!`,
    };
  }

  return { actions, morale: 'fight', tier };
}

// ── Build Attack Action Helper ──
function buildAttackAction(enemy, target, attacks, tier, atkBonus = 0, dmgBonus = 0) {
  const hasMultipleAttacks = attacks.length > 1 || attacks.some(a => a.count > 1);
  const useFullAttack = hasMultipleAttacks && (tier === 'cunning' || tier === 'genius' ? Math.random() < 0.8 : Math.random() < 0.6);

  if (useFullAttack) {
    const allAttacks = [];
    for (const atk of attacks) {
      for (let i = 0; i < atk.count; i++) {
        allAttacks.push({ ...atk, bonus: atk.bonus + atkBonus, damageBonus: (atk.damageBonus || 0) + dmgBonus });
      }
    }
    return {
      type: ACTION_TYPES.FULL_ROUND,
      action: 'full_attack',
      target,
      attacks: allAttacks,
      description: `${enemy.name} unleashes a full attack against ${target.name}!`,
    };
  }

  const bestAtk = attacks.reduce((a, b) => a.bonus > b.bonus ? a : b, attacks[0]);
  return {
    type: ACTION_TYPES.STANDARD,
    action: 'attack',
    target,
    attack: { ...bestAtk, bonus: bestAtk.bonus + atkBonus, damageBonus: (bestAtk.damageBonus || 0) + dmgBonus },
    description: `${enemy.name} attacks ${target.name} with its ${bestAtk.name}!`,
  };
}

// ── Get condition + active effect modifiers for an enemy ──
// Merges conditions AND active spell effects (buffs/debuffs) into one modifier object
function getEnemyConditionMods(enemy) {
  // Use the unified modifier system that merges conditions + active effects
  if ((enemy.activeConditions && enemy.activeConditions.length > 0) ||
      (enemy.activeEffects && enemy.activeEffects.length > 0)) {
    return getCharacterModifiers(enemy);
  }
  // Fallback: no modifiers
  return { attack: 0, damage: 0, ac: 0, saves: 0, skills: 0, concentration: 0,
           initiative: 0, cmb: 0, cmd: 0, speed: 0, missChance: 0,
           cannotAct: false, cannotAttack: false, cannotCast: false,
           cannotMove: false, cannotCharge: false, loseDexToAC: false };
}

// ── Resolve Attack Roll ──
// Now applies condition modifiers from the attacker (enemy) and checks target conditions
export function resolveAttack(attack, target, enemy = null) {
  // Get attacker condition modifiers
  const atkCondMods = enemy ? getEnemyConditionMods(enemy) : { attack: 0, damage: 0, missChance: 0, cannotAttack: false };

  // If attacker cannot attack due to conditions, auto-miss
  if (atkCondMods.cannotAttack) {
    return {
      attackRoll: 0, totalAtk: 0, targetAC: target.ac || 10,
      hit: false, isCrit: false, isFumble: false, critConfirmed: false,
      damage: 0, attackName: attack.name, critRange: attack.critRange || 20,
      conditionBlocked: true,
    };
  }

  // Check miss chance from attacker conditions (e.g., blinded = 50%)
  if (atkCondMods.missChance > 0) {
    const missRoll = Math.floor(Math.random() * 100) + 1;
    if (missRoll <= atkCondMods.missChance) {
      return {
        attackRoll: 0, totalAtk: 0, targetAC: target.ac || 10,
        hit: false, isCrit: false, isFumble: false, critConfirmed: false,
        damage: 0, attackName: attack.name, critRange: attack.critRange || 20,
        missedByChance: true, missChance: atkCondMods.missChance,
      };
    }
  }

  // Check if target loses DEX to AC (from target conditions like flat-footed, stunned, etc.)
  const targetCondMods = (target.activeConditions || target.activeEffects) ? getCharacterModifiers(target) : { loseDexToAC: false, ac: 0 };
  let targetAC = target.ac || 10;
  // If target loses DEX to AC, reduce AC by DEX modifier (minimum 10)
  if (targetCondMods.loseDexToAC && target.abilities?.DEX) {
    const dexMod = Math.floor((target.abilities.DEX - 10) / 2);
    if (dexMod > 0) targetAC = Math.max(10, targetAC - dexMod);
  }
  // Apply target's condition AC modifier (e.g., prone = -4 to AC vs melee)
  targetAC += (targetCondMods.ac || 0);

  // Racial Defensive Training (e.g., Dwarf +4 dodge AC vs Giants)
  const dt = target.racialCombatBonuses?.defensiveTraining;
  if (dt && enemy) {
    const enemyType = (enemy.type || '').toLowerCase();
    const enemySubtype = (enemy.subtype || '').toLowerCase();
    if (dt.vsTypes.some(vt => enemyType.includes(vt) || enemySubtype.includes(vt))) {
      targetAC += dt.acBonus;
    }
  }

  // Class passive AC bonuses (Monk WIS to AC, Swashbuckler Nimble, etc.)
  if (target.class) {
    try {
      const classPassives = getPassiveClassModifiers(target);
      if (classPassives.ac) targetAC += classPassives.ac;
    } catch (e) { /* safety net */ }
  }

  const attackRoll = roll(20);
  const conditionAtkMod = atkCondMods.attack || 0;
  const totalAtk = attackRoll + attack.bonus + conditionAtkMod;
  const critRange = attack.critRange || 20;
  const critMultiplier = attack.critMultiplier || 2;
  const isCritThreat = attackRoll >= critRange;
  const isFumble = attackRoll === 1;
  const hit = isFumble ? false : (isCritThreat || totalAtk >= targetAC);

  let damage = 0;
  let critConfirmed = false;
  const conditionDmgMod = atkCondMods.damage || 0;

  if (hit) {
    damage = Math.max(1, rollDice(attack.damageDice, attack.damageSides).total + (attack.damageBonus || 0) + conditionDmgMod);

    // Critical threat — confirm
    if (isCritThreat) {
      const confirmRoll = roll(20) + attack.bonus + conditionAtkMod;
      if (confirmRoll >= targetAC) {
        critConfirmed = true;
        damage *= critMultiplier;
      }
    }
  }

  return {
    attackRoll,
    totalAtk,
    targetAC,
    hit,
    isCrit: isCritThreat,
    isFumble,
    critConfirmed,
    damage,
    attackName: attack.name,
    critRange,
    conditionAtkMod,
    conditionDmgMod,
  };
}

// ── Execute Enemy Turn (Enhanced) ──
// Main function called by CombatTab — runs all enemy actions and returns log entries
// Now supports advanced actions: breath weapons, spells, combat maneuvers, conditions
export function executeEnemyTurn(enemy, party, allEnemies, combatState = {}) {
  // Tick down breath weapon recharge at start of each turn
  if (enemy._breathRechargeRounds > 0) {
    enemy._breathRechargeRounds--;
  }

  // Phase B (Ally-NPC) — enemies target both party and allies. Pool is
  // assembled once here and passed downstream as `alivePCs` (internal
  // naming kept for diff minimization; semantics are now "any alive
  // combatant on the party side"). Pre-Phase-B callers that don't pass
  // combatState.allies get identical behavior via the `|| []` fallback.
  // A monster ally with class='' safely scores lower on the cunning/genius
  // caster + healer bonuses, so a squishy bard ally still draws fire
  // before a bear ally — which matches the operator's expectation.
  const alliesPool = Array.isArray(combatState?.allies) ? combatState.allies : [];
  const alivePCs = [...party, ...alliesPool].filter(t => t.currentHP > 0);
  const { actions, morale, tier, reasoning } = decideEnemyActions(enemy, alivePCs, allEnemies, combatState);
  const results = [];
  let totalDamage = 0;
  const hpChanges = {}; // targetId -> damage
  const conditionsApplied = {}; // targetId -> [conditions]
  const activeEffectsToApply = []; // { targetId, effect } — for spell buffs/debuffs on PCs
  // Observation events — consumed by CombatTab to update combat.observed[enemy.id].
  // Shapes: {kind:'attack', name:string} | {kind:'ability', name:string}
  //       | {kind:'save', save:'fort'|'ref'|'will', passed:boolean}
  // Keyed to the acting enemy by caller (one executeEnemyTurn call = one enemy).
  const observationEvents = [];

  if (reasoning) {
    results.push({ text: `[AI: ${reasoning}]`, type: 'debug' });
  }

  for (const action of actions) {
    switch (action.action) {
      case 'flee':
        results.push({ text: action.description, type: 'warning', fled: true });
        break;

      case 'surrender':
        results.push({ text: action.description, type: 'npc', surrendered: true });
        break;

      case 'incapacitated':
        results.push({ text: action.description, type: 'info' });
        break;

      case 'phase_change':
        results.push({ text: action.description, type: 'danger' });
        break;

      case 'flanking':
      case 'taunt':
        results.push({ text: action.description, type: 'info' });
        break;

      case 'full_attack':
      case 'pounce': {
        results.push({ text: action.description, type: 'danger' });
        for (const atk of action.attacks) {
          const result = resolveAttack(atk, action.target, enemy);
          if (result.conditionBlocked) {
            results.push({ text: `${enemy.name} is unable to attack due to its condition!`, type: 'info' });
            break;
          }
          // Hit, miss, or fumble — the party saw the attack thrown.
          // (Skipped above on conditionBlocked: no swing actually happened.)
          const atkName = result.attackName || atk.name;
          if (atkName) observationEvents.push({ kind: 'attack', name: atkName });
          if (result.missedByChance) {
            results.push({ text: `${enemy.name}'s ${atk.name} misses ${action.target.name} (${result.missChance}% miss chance)!`, type: 'info' });
            continue;
          }
          // Announce the nat 20 threat in the critical color before damage line.
          if (result.isCrit) {
            results.push({
              text: `🎯 Natural ${result.attackRoll}! ${enemy.name}'s ${result.attackName} threatens a critical hit!`,
              type: 'critical',
            });
          }
          if (result.hit) {
            const dmg = result.damage + (action.damageBonus || 0);
            totalDamage += dmg;
            hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + dmg;

            if (result.critConfirmed) {
              results.push({
                text: `💥 CRITICAL HIT! ${enemy.name}'s ${result.attackName} devastates ${action.target.name} for ${dmg} damage!`,
                type: 'critical',
              });
            } else {
              results.push({
                text: `${enemy.name}'s ${result.attackName} hits ${action.target.name} for ${dmg} damage!`,
                type: 'danger',
              });
            }
            const modBreakdown = result.conditionAtkMod ? ` [cond ${result.conditionAtkMod >= 0 ? '+' : ''}${result.conditionAtkMod}]` : '';
            results.push({
              text: `(Roll: ${result.attackRoll}+${atk.bonus}${modBreakdown}=${result.totalAtk} vs AC ${result.targetAC}, ${dmg} dmg)`,
              type: 'info',
            });
          } else if (result.isFumble) {
            // A fumbling monster is a win for the party, but the color is still
            // the fumble red — the GameLog palette distinguishes fumble from
            // generic danger so NWN-style nat-1 cues pop visually.
            results.push({ text: `💢 Natural 1! ${enemy.name} fumbles with its ${result.attackName}!`, type: 'fumble' });
          } else {
            results.push({ text: `${enemy.name}'s ${result.attackName} misses ${action.target.name}.`, type: 'info' });
            results.push({ text: `(Roll: ${result.attackRoll}+${atk.bonus}=${result.totalAtk} vs AC ${result.targetAC})`, type: 'info' });
          }
        }
        break;
      }

      case 'charge': {
        results.push({ text: action.description, type: 'danger' });
        const result = resolveAttack(action.attack, action.target, enemy);
        if (result.conditionBlocked) {
          results.push({ text: `${enemy.name} is unable to attack due to its condition!`, type: 'info' });
          break;
        }
        // Charge swing happened (may still whiff to concealment) — record it.
        const chgName = result.attackName || action.attack?.name;
        if (chgName) observationEvents.push({ kind: 'attack', name: chgName });
        if (result.missedByChance) {
          results.push({ text: `${enemy.name}'s charge misses ${action.target.name} (${result.missChance}% miss chance)!`, type: 'info' });
          break;
        }
        if (result.isCrit) {
          results.push({
            text: `🎯 Natural ${result.attackRoll}! ${enemy.name}'s charge threatens a critical hit!`,
            type: 'critical',
          });
        }
        if (result.hit) {
          totalDamage += result.damage;
          hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + result.damage;
          if (result.critConfirmed) {
            results.push({ text: `💥 CRITICAL! The charge devastates ${action.target.name} for ${result.damage} damage!`, type: 'critical' });
          } else {
            results.push({ text: `The charge connects! ${action.target.name} takes ${result.damage} damage!`, type: 'danger' });
          }
          results.push({ text: `(Charge: ${result.attackRoll}+${action.attack.bonus}=${result.totalAtk} vs AC ${result.targetAC}, ${result.damage} dmg)`, type: 'info' });
        } else if (result.isFumble) {
          results.push({ text: `💢 Natural 1! ${enemy.name}'s charge goes wildly wide of ${action.target.name}!`, type: 'fumble' });
        } else {
          results.push({ text: `${enemy.name}'s charge misses ${action.target.name}!`, type: 'info' });
        }
        results.push({ text: `${enemy.name} is off-balance from the charge (-2 AC until next turn).`, type: 'info' });
        break;
      }

      case 'attack': {
        const result = resolveAttack(action.attack, action.target, enemy);
        if (result.conditionBlocked) {
          results.push({ text: `${enemy.name} is unable to attack due to its condition!`, type: 'info' });
          break;
        }
        // Swing happened — record before hit/miss branching.
        const sAtkName = result.attackName || action.attack?.name;
        if (sAtkName) observationEvents.push({ kind: 'attack', name: sAtkName });
        if (result.missedByChance) {
          results.push({ text: `${enemy.name}'s ${action.attack.name || 'attack'} misses ${action.target.name} (${result.missChance}% miss chance)!`, type: 'info' });
          break;
        }
        if (result.isCrit) {
          results.push({
            text: `🎯 Natural ${result.attackRoll}! ${enemy.name}'s ${result.attackName} threatens a critical hit!`,
            type: 'critical',
          });
        }
        if (result.hit) {
          const dmg = result.damage + (action.damageBonus || 0);
          totalDamage += dmg;
          hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + dmg;
          if (result.critConfirmed) {
            results.push({ text: `💥 CRITICAL HIT! ${enemy.name}'s ${result.attackName} devastates ${action.target.name} for ${dmg} damage!`, type: 'critical' });
          } else {
            results.push({ text: `${enemy.name}'s ${result.attackName} hits ${action.target.name} for ${dmg} damage.`, type: 'danger' });
          }
          const modBreakdown = result.conditionAtkMod ? ` [cond ${result.conditionAtkMod >= 0 ? '+' : ''}${result.conditionAtkMod}]` : '';
          results.push({ text: `(Roll: ${result.attackRoll}+${action.attack.bonus}${modBreakdown}=${result.totalAtk} vs AC ${result.targetAC}, ${dmg} dmg)`, type: 'info' });
        } else if (result.isFumble) {
          results.push({ text: `💢 Natural 1! ${enemy.name} fumbles with its ${result.attackName}!`, type: 'fumble' });
        } else {
          results.push({ text: `${enemy.name}'s ${result.attackName} misses ${action.target.name}.`, type: 'info' });
          results.push({ text: `(Roll: ${result.attackRoll}+${action.attack.bonus}=${result.totalAtk} vs AC ${result.targetAC})`, type: 'info' });
        }
        break;
      }

      // ── NEW: Breath Weapon ──
      case 'breath_weapon': {
        results.push({ text: action.description, type: 'danger' });
        observationEvents.push({ kind: 'ability', name: 'Breath Weapon' });
        if (action.breathResult) {
          results.push({ text: `(${action.breathResult.damageDice} damage, DC ${action.breathResult.dc} Reflex for half)`, type: 'info' });
          for (const r of action.breathResult.results) {
            observationEvents.push({ kind: 'save', save: 'ref', passed: !!r.saved });
            const dmg = r.damage;
            hpChanges[r.target.id] = (hpChanges[r.target.id] || 0) + dmg;
            totalDamage += dmg;
            results.push({
              text: r.saved
                ? `${r.target.name} dives aside! (Reflex ${r.saveRoll} vs DC ${r.dc}) Takes ${dmg} damage (halved).`
                : `${r.target.name} is caught in the blast! (Reflex ${r.saveRoll} vs DC ${r.dc}) Takes ${dmg} damage!`,
              type: r.saved ? 'warning' : 'danger',
            });
          }
        }
        break;
      }

      // ── NEW: Frightful Presence ──
      case 'frightful_presence': {
        results.push({ text: action.description, type: 'warning' });
        observationEvents.push({ kind: 'ability', name: 'Frightful Presence' });
        if (action.fpResult) {
          for (const r of action.fpResult.results) {
            observationEvents.push({ kind: 'save', save: 'will', passed: !!r.saved });
            if (r.saved) {
              results.push({ text: `${r.target.name} steels their resolve! (Will ${r.saveRoll} vs DC ${r.dc})`, type: 'success' });
            } else {
              results.push({ text: `${r.target.name} is shaken with fear! (Will ${r.saveRoll} vs DC ${r.dc})`, type: 'danger' });
              if (r.condition) {
                conditionsApplied[r.target.id] = conditionsApplied[r.target.id] || [];
                conditionsApplied[r.target.id].push(r.condition);
              }
            }
          }
        }
        break;
      }

      // ── NEW: Trip Attack ──
      case 'trip': {
        results.push({ text: action.description, type: action.tripResult?.success ? 'danger' : 'info' });
        observationEvents.push({ kind: 'ability', name: 'Trip' });
        if (action.tripResult) {
          results.push({
            text: `(CMB ${action.tripResult.cmbTotal} vs CMD ${action.tripResult.cmd})`,
            type: 'info',
          });
          if (action.tripResult.success && action.tripResult.condition) {
            conditionsApplied[action.target.id] = conditionsApplied[action.target.id] || [];
            conditionsApplied[action.target.id].push(action.tripResult.condition);
          }
        }
        break;
      }

      // ── NEW: Grab/Grapple ──
      case 'grab': {
        results.push({ text: action.description, type: action.grabResult?.success ? 'danger' : 'info' });
        observationEvents.push({ kind: 'ability', name: 'Grab' });
        if (action.grabResult) {
          results.push({
            text: `(CMB ${action.grabResult.cmbTotal} vs CMD ${action.grabResult.cmd})`,
            type: 'info',
          });
          if (action.grabResult.success && action.grabResult.condition) {
            conditionsApplied[action.target.id] = conditionsApplied[action.target.id] || [];
            conditionsApplied[action.target.id].push(action.grabResult.condition);
          }
        }
        break;
      }

      // ── NEW: Gaze Attack ──
      case 'gaze':
        results.push({ text: action.description, type: 'warning' });
        observationEvents.push({ kind: 'ability', name: 'Gaze' });
        break;

      // ── Spellcasting (with slot tracking, condition checks, SR) ──
      case 'cast_spell': {
        // Check conditions preventing casting
        const castCondMods = getEnemyConditionMods(enemy);
        if (castCondMods.cannotCast || castCondMods.cannotAct) {
          results.push({ text: `${enemy.name} tries to cast a spell but cannot — a condition prevents it!`, type: 'info' });
          break;
        }

        // Check spell slot availability (if tracked)
        const spellLevel = action.spell?.level || 1;
        if (enemy.spellSlots) {
          const slotCheck = enemyCanCastSpell(enemy, spellLevel);
          if (!slotCheck.canCast) {
            results.push({ text: `${enemy.name} has exhausted their level ${spellLevel} spell slots!`, type: 'info' });
            break;
          }
          consumeEnemySpellSlot(enemy, spellLevel);
          results.push({ text: `(${enemy.name} expends a level ${spellLevel} spell slot — ${slotCheck.remaining - 1} remaining)`, type: 'info' });
        }

        // Concentration check if grappled or entangled
        const enemyCondNames = (enemy.activeConditions || []).map(c => (c.name || c.type || '').toLowerCase());
        if (enemyCondNames.includes('grappled') || enemyCondNames.includes('entangled')) {
          const concDC = enemyCondNames.includes('grappled') ? (10 + spellLevel + 5) : (15 + spellLevel);
          const concRoll = roll(20);
          const clBonus = enemy.level || Math.floor((enemy.cr || 1) * 1); // Approximate caster level from CR
          const concTotal = concRoll + clBonus;
          if (concTotal < concDC) {
            results.push({ text: `${enemy.name}'s spell fizzles — failed concentration check (${concTotal} vs DC ${concDC})!`, type: 'success' });
            break;
          }
          results.push({ text: `(Concentration: ${concTotal} vs DC ${concDC} — passed)`, type: 'info' });
        }

        results.push({ text: action.description, type: 'warning' });
        if (action.spell?.name) {
          observationEvents.push({ kind: 'ability', name: action.spell.name });
        }

        if (action.spell) {
          const cat = action.spell.category;

          // Check spell resistance if targeting a PC
          const spellTarget = action.target;
          if (spellTarget && spellTarget.sr && spellTarget.sr > 0 && cat !== 'healing' && cat !== 'buff') {
            const srRoll = roll(20);
            const clSR = enemy.level || Math.floor((enemy.cr || 1));
            const srTotal = srRoll + clSR;
            if (srTotal < spellTarget.sr) {
              results.push({ text: `${spellTarget.name}'s spell resistance deflects the magic! (${srTotal} vs SR ${spellTarget.sr})`, type: 'success' });
              break;
            }
            results.push({ text: `(Overcame SR: ${srTotal} vs SR ${spellTarget.sr})`, type: 'info' });
          }

          // ── Resolve spell effects mechanically ──
          const spellTargets = cat === 'healing' || cat === 'buff' ? [enemy] : (spellTarget ? [spellTarget] : []);
          const cl = enemy.level || Math.floor((enemy.cr || 1));
          const castAbilityScore = enemy.abilities?.[enemy.castingAbility || 'CHA'] || 14;
          const castAbilityMod = Math.floor((castAbilityScore - 10) / 2);
          const spellDCCalc = 10 + spellLevel + castAbilityMod;

          const spellResult = resolveSpellEffect(
            action.spell.name || action.description,
            enemy,
            spellTargets,
            { spellDC: spellDCCalc, spellLevel, casterLevel: cl, school: action.spell.school || '', descriptors: action.spell.descriptors || [] }
          );

          if (spellResult.resolved) {
            // Surface save outcomes from the resolver as observation events.
            // saveType is 'Fort'|'Ref'|'Will'; we normalize to lowercase short keys.
            // Filter to PC targets only — savesObserved records PARTY saves vs
            // this enemy's DC. If an AOE catches an ally enemy or the spell is
            // self-targeted, that save outcome carries opposite semantics and
            // must not pollute the party-saves bucket (symmetric to the PC-cast
            // filter in CombatTab.recordEnemySavesFromSpellResult).
            for (const sr of (spellResult.saveResults || [])) {
              if (!sr?.targetId) continue;
              if (!party.some(p => p.id === sr.targetId)) continue;
              const key = String(sr.saveType || '').toLowerCase();
              const save = key.startsWith('fort') ? 'fort'
                : key.startsWith('ref') ? 'ref'
                : key.startsWith('will') ? 'will' : null;
              if (save) observationEvents.push({ kind: 'save', save, passed: !!sr.passed });
            }
            // Apply HP changes from resolved spell
            for (const [targetId, hpDelta] of Object.entries(spellResult.hpChanges)) {
              hpChanges[targetId] = (hpChanges[targetId] || 0) + hpDelta;
              if (hpDelta > 0) totalDamage += hpDelta;
            }

            // Apply conditions from resolved spell
            for (const condApp of spellResult.conditionsToApply) {
              if (!conditionsApplied[condApp.targetId]) conditionsApplied[condApp.targetId] = [];
              const cond = createCondition(condApp.condition, {
                duration: condApp.duration,
                source: condApp.source || action.spell.name,
                customMods: condApp.customMods,
              });
              if (cond) conditionsApplied[condApp.targetId].push(cond);
            }

            // Track active spell effects (buffs/debuffs not in PF1E_CONDITIONS)
            for (const eff of spellResult.activeEffects) {
              const activeEff = createActiveEffect(eff);
              // Store on the target — find if it's enemy or party member
              const isEnemy = eff.targetId === enemy.id;
              if (isEnemy) {
                if (!enemy.activeEffects) enemy.activeEffects = [];
                enemy.activeEffects.push(activeEff);
              }
              // Party member active effects are returned via result for CombatTab to apply
              if (!isEnemy) {
                activeEffectsToApply.push({ targetId: eff.targetId, effect: activeEff });
              }
            }

            // Add all messages from the resolver
            for (const msg of spellResult.messages) {
              results.push(msg);
            }
          } else {
            // Fallback: no structured data — use simplified categories like before
            if (cat === 'damage' && spellTarget) {
              const dmg = rollDice(Math.max(1, spellLevel), 6).total;
              hpChanges[spellTarget.id] = (hpChanges[spellTarget.id] || 0) + dmg;
              totalDamage += dmg;
              results.push({ text: `${spellTarget.name} takes ${dmg} damage from the spell!`, type: 'danger' });
            } else if (cat === 'healing') {
              const healAmt = rollDice(Math.max(1, spellLevel), 8).total + 5;
              hpChanges[enemy.id] = (hpChanges[enemy.id] || 0) - healAmt;
              results.push({ text: `${enemy.name} heals ${healAmt} hit points!`, type: 'success' });
            } else if (cat === 'buff') {
              results.push({ text: `${enemy.name} is enhanced by the spell!`, type: 'info' });
            } else if (cat === 'debuff' || cat === 'control') {
              results.push({ text: `The spell targets ${spellTarget?.name || 'the party'}!`, type: 'warning' });
            } else if (cat === 'summon') {
              results.push({ text: `Dark energy swirls as ${enemy.name} calls forth allies!`, type: 'warning' });
            }
          }
        }
        break;
      }

      // ── NEW: Summon ──
      case 'summon':
        results.push({ text: action.description, type: 'warning' });
        observationEvents.push({ kind: 'ability', name: 'Summon' });
        break;

      // ── Feint (Bluff standard action — CRB pp. 92, 201) ──
      case 'feint':
        results.push({ text: action.description, type: action.feintResult?.success ? 'warning' : 'info' });
        if (action.conditionToApply) {
          const { targetId: fTargetId, condition, duration, source } = action.conditionToApply;
          const cond = createCondition(condition, { duration, source });
          if (cond) {
            if (!conditionsApplied[fTargetId]) conditionsApplied[fTargetId] = [];
            conditionsApplied[fTargetId].push(cond);
          }
        }
        break;

      // ── NEW: Total Defense ──
      case 'total_defense':
        results.push({ text: action.description, type: 'info' });
        break;

      case 'reposition':
        results.push({ text: action.description, type: 'info' });
        break;

      case 'special':
        results.push({ text: action.description, type: 'warning' });
        break;

      default:
        if (action.description) {
          results.push({ text: action.description, type: 'info' });
        }
        break;
    }
  }

  return {
    results,
    hpChanges,
    totalDamage,
    morale,
    tier,
    fled: morale === 'flee',
    surrendered: morale === 'surrender',
    conditionsApplied,
    activeEffectsToApply,
    observationEvents,
    reasoning,
  };
}

// ── Player Action Types (for UI) ──
export const PLAYER_ACTIONS = {
  // Standard actions
  attack: { name: 'Attack', type: 'standard', description: 'Make a single melee or ranged attack' },
  castSpell: { name: 'Cast Spell', type: 'standard', description: 'Cast a spell (provokes AoO)' },
  totalDefense: { name: 'Total Defense', type: 'standard', description: '+4 dodge AC, no attacks this round' },
  useAbility: { name: 'Use Ability', type: 'standard', description: 'Use a class or racial ability' },

  // Full-round actions
  fullAttack: { name: 'Full Attack', type: 'full-round', description: 'Make all iterative attacks (no move)' },
  charge: { name: 'Charge', type: 'full-round', description: 'Move + attack: +2 hit, -2 AC' },
  withdraw: { name: 'Withdraw', type: 'full-round', description: 'Move without provoking AoO' },

  // Move actions
  move: { name: 'Move', type: 'move', description: 'Move up to your speed' },
  drawWeapon: { name: 'Draw Weapon', type: 'move', description: 'Draw or sheathe a weapon' },
  standUp: { name: 'Stand Up', type: 'move', description: 'Stand from prone (provokes AoO)' },

  // Swift actions
  swift: { name: 'Swift Action', type: 'swift', description: 'Use a swift ability (1/round)' },

  // Free actions
  speak: { name: 'Speak', type: 'free', description: 'Say something brief' },
  dropItem: { name: 'Drop Item', type: 'free', description: 'Drop a held item' },
  fiveFootStep: { name: '5-Foot Step', type: 'free', description: 'Move 5ft without provoking (no other movement)' },
};
