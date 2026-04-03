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
} from './monsterTactics.js';

// Re-export monsterTactics for use by other components
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

// ── Resolve Attack Roll ──
export function resolveAttack(attack, target) {
  const attackRoll = roll(20);
  const totalAtk = attackRoll + attack.bonus;
  const targetAC = target.ac || 10;
  const critRange = attack.critRange || 20;
  const critMultiplier = attack.critMultiplier || 2;
  const isCritThreat = attackRoll >= critRange;
  const isFumble = attackRoll === 1;
  const hit = isFumble ? false : (isCritThreat || totalAtk >= targetAC);

  let damage = 0;
  let critConfirmed = false;

  if (hit) {
    damage = Math.max(1, rollDice(attack.damageDice, attack.damageSides).total + (attack.damageBonus || 0));

    // Critical threat — confirm
    if (isCritThreat) {
      const confirmRoll = roll(20) + attack.bonus;
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

  const alivePCs = party.filter(p => p.currentHP > 0);
  const { actions, morale, tier, reasoning } = decideEnemyActions(enemy, alivePCs, allEnemies, combatState);
  const results = [];
  let totalDamage = 0;
  const hpChanges = {}; // targetId -> damage
  const conditionsApplied = {}; // targetId -> [conditions]

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
          const result = resolveAttack(atk, action.target);
          if (result.hit) {
            const dmg = result.damage + (action.damageBonus || 0);
            totalDamage += dmg;
            hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + dmg;

            if (result.critConfirmed) {
              results.push({
                text: `CRITICAL HIT! ${enemy.name}'s ${result.attackName} devastates ${action.target.name} for ${dmg} damage!`,
                type: 'danger',
              });
            } else {
              results.push({
                text: `${enemy.name}'s ${result.attackName} hits ${action.target.name} for ${dmg} damage!`,
                type: 'danger',
              });
            }
            results.push({
              text: `(Roll: ${result.attackRoll}+${atk.bonus}=${result.totalAtk} vs AC ${result.targetAC}, ${dmg} dmg)`,
              type: 'info',
            });
          } else if (result.isFumble) {
            results.push({ text: `${enemy.name} fumbles with its ${result.attackName}!`, type: 'success' });
          } else {
            results.push({ text: `${enemy.name}'s ${result.attackName} misses ${action.target.name}.`, type: 'info' });
            results.push({ text: `(Roll: ${result.attackRoll}+${atk.bonus}=${result.totalAtk} vs AC ${result.targetAC})`, type: 'info' });
          }
        }
        break;
      }

      case 'charge': {
        results.push({ text: action.description, type: 'danger' });
        const result = resolveAttack(action.attack, action.target);
        if (result.hit) {
          totalDamage += result.damage;
          hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + result.damage;
          results.push({ text: `The charge connects! ${action.target.name} takes ${result.damage} damage!`, type: 'danger' });
          results.push({ text: `(Charge: ${result.attackRoll}+${action.attack.bonus}=${result.totalAtk} vs AC ${result.targetAC}, ${result.damage} dmg)`, type: 'info' });
        } else {
          results.push({ text: `${enemy.name}'s charge misses ${action.target.name}!`, type: 'info' });
        }
        results.push({ text: `${enemy.name} is off-balance from the charge (-2 AC until next turn).`, type: 'info' });
        break;
      }

      case 'attack': {
        const result = resolveAttack(action.attack, action.target);
        if (result.hit) {
          const dmg = result.damage + (action.damageBonus || 0);
          totalDamage += dmg;
          hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + dmg;
          if (result.critConfirmed) {
            results.push({ text: `CRITICAL HIT! ${enemy.name}'s ${result.attackName} devastates ${action.target.name} for ${dmg} damage!`, type: 'danger' });
          } else {
            results.push({ text: `${enemy.name}'s ${result.attackName} hits ${action.target.name} for ${dmg} damage.`, type: 'danger' });
          }
          results.push({ text: `(Roll: ${result.attackRoll}+${action.attack.bonus}=${result.totalAtk} vs AC ${result.targetAC}, ${dmg} dmg)`, type: 'info' });
        } else if (result.isFumble) {
          results.push({ text: `${enemy.name} fumbles with its ${result.attackName}!`, type: 'success' });
        } else {
          results.push({ text: `${enemy.name}'s ${result.attackName} misses ${action.target.name}.`, type: 'info' });
          results.push({ text: `(Roll: ${result.attackRoll}+${action.attack.bonus}=${result.totalAtk} vs AC ${result.targetAC})`, type: 'info' });
        }
        break;
      }

      // ── NEW: Breath Weapon ──
      case 'breath_weapon': {
        results.push({ text: action.description, type: 'danger' });
        if (action.breathResult) {
          results.push({ text: `(${action.breathResult.damageDice} damage, DC ${action.breathResult.dc} Reflex for half)`, type: 'info' });
          for (const r of action.breathResult.results) {
            const dmg = r.damage;
            hpChanges[r.target.id] = (hpChanges[r.target.id] || 0) + dmg;
            totalDamage += dmg;
            results.push({
              text: r.saved
                ? `${r.target.name} dives aside! (Reflex ${r.saveRoll} vs DC ${r.dc}) Takes ${dmg} damage (halved).`
                : `${r.target.name} is caught in the blast! (Reflex ${r.saveRoll} vs DC ${r.dc}) Takes ${dmg} damage!`,
              type: r.saved ? 'info' : 'danger',
            });
          }
        }
        break;
      }

      // ── NEW: Frightful Presence ──
      case 'frightful_presence': {
        results.push({ text: action.description, type: 'warning' });
        if (action.fpResult) {
          for (const r of action.fpResult.results) {
            if (r.saved) {
              results.push({ text: `${r.target.name} steels their resolve! (Will ${r.saveRoll} vs DC ${r.dc})`, type: 'success' });
            } else {
              results.push({ text: `${r.target.name} is shaken with fear! (Will ${r.saveRoll} vs DC ${r.dc})`, type: 'warning' });
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
        break;

      // ── NEW: Spellcasting ──
      case 'cast_spell': {
        results.push({ text: action.description, type: 'warning' });
        if (action.spell) {
          const cat = action.spell.category;
          if (cat === 'damage' && action.target) {
            // Resolve spell damage (approximate based on spell level)
            const spellLevel = action.spell.level || 1;
            const dmg = rollDice(Math.max(1, spellLevel), 6).total;
            hpChanges[action.target.id] = (hpChanges[action.target.id] || 0) + dmg;
            totalDamage += dmg;
            results.push({ text: `${action.target.name} takes ${dmg} damage from the spell!`, type: 'danger' });
          } else if (cat === 'healing') {
            const healAmt = rollDice(Math.max(1, action.spell.level || 1), 8).total + 5;
            hpChanges[enemy.id] = (hpChanges[enemy.id] || 0) - healAmt; // Negative damage = healing
            results.push({ text: `${enemy.name} heals ${healAmt} hit points!`, type: 'success' });
          } else if (cat === 'buff') {
            results.push({ text: `${enemy.name} is enhanced by the spell!`, type: 'info' });
          } else if (cat === 'debuff' || cat === 'control') {
            results.push({ text: `The spell targets ${action.target?.name || 'the party'}!`, type: 'warning' });
          } else if (cat === 'summon') {
            results.push({ text: `Dark energy swirls as ${enemy.name} calls forth allies!`, type: 'warning' });
          }
        }
        break;
      }

      // ── NEW: Summon ──
      case 'summon':
        results.push({ text: action.description, type: 'warning' });
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
