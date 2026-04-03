import React, { useState, useEffect, useRef } from 'react';
import { roll, rollDice } from '../utils/dice';
import dmEngine from '../services/dmEngine';
import {
  executeEnemyTurn,
  PLAYER_ACTIONS,
  coordinateGroupTactics,
  detectBehaviorPreset,
  applyBehaviorPreset,
  analyzeEncounterDifficulty,
  CONDITIONS,
  tickConditions,
} from '../services/creatureAI';

// PF1e finesse weapon list
const FINESSE_WEAPONS = [
  'Rapier', 'Dagger', 'Short Sword', 'Whip', 'Spiked Chain',
  'Elven Curve Blade', 'Starknife',
];

// Parse a weapon damage string like "1d8", "2d6", "1d6/1d6" into rollable components
function parseWeaponDamage(dmgStr) {
  if (!dmgStr || dmgStr === '-') return { dice: 1, sides: 8 }; // Fallback: 1d8
  // Take only the first damage expression (for double weapons like quarterstaff "1d6/1d6")
  const primary = dmgStr.split('/')[0].trim();
  const match = primary.match(/(\d+)d(\d+)/);
  if (!match) return { dice: 1, sides: 8 };
  return { dice: parseInt(match[1]), sides: parseInt(match[2]) };
}

// Parse a crit string like "19-20/x2", "x3", "18-20/x2" into threat range and multiplier
function parseCritical(critStr) {
  if (!critStr) return { threatRange: 20, multiplier: 2 };
  const multMatch = critStr.match(/x(\d+)/);
  const rangeMatch = critStr.match(/(\d+)-20/);
  return {
    threatRange: rangeMatch ? parseInt(rangeMatch[1]) : 20,
    multiplier: multMatch ? parseInt(multMatch[1]) : 2,
  };
}

// Get the active weapon for an attacker, checking equipped mainHand or first weapon
function getActiveWeapon(attacker) {
  // Check equipped mainHand slot first
  if (attacker.equipped?.mainHand) return attacker.equipped.mainHand;
  // Fall back to first weapon in weapons array
  if (attacker.weapons?.length > 0) return attacker.weapons[0];
  // Default unarmed strike
  return { name: 'Unarmed Strike', dmg: '1d3', crit: 'x2', category: 'melee' };
}

// Determine whether to use DEX or STR for attack rolls (PF1e Weapon Finesse)
function getAttackAbilityMod(attacker, weapon) {
  const strMod = Math.floor(((attacker.abilities?.STR || 10) - 10) / 2);
  const dexMod = Math.floor(((attacker.abilities?.DEX || 10) - 10) / 2);
  const isFinesse = attacker.feats?.some(f => f.name === 'Weapon Finesse' || f === 'Weapon Finesse');
  const isRanged = weapon?.category === 'ranged';
  const isFinesseWeapon = FINESSE_WEAPONS.some(w =>
    weapon?.name?.toLowerCase().includes(w.toLowerCase())
  );
  // Small characters can finesse additional weapons
  const isSmallFinesse = attacker.size === 'Small' && isFinesseWeapon;

  if (isRanged) return { mod: dexMod, label: 'DEX' };
  if (isFinesse && (isFinesseWeapon || isSmallFinesse)) return { mod: Math.max(strMod, dexMod), label: dexMod > strMod ? 'DEX' : 'STR' };
  return { mod: strMod, label: 'STR' };
}

// Get STR mod for damage (PF1e: STR always applies to melee damage, not DEX)
function getDamageMod(attacker, weapon) {
  const strMod = Math.floor(((attacker.abilities?.STR || 10) - 10) / 2);
  if (weapon?.category === 'ranged' && !weapon?.name?.includes('Composite')) return 0;
  if (weapon?.twoHand) return Math.floor(strMod * 1.5); // 1.5x STR for two-handed
  return strMod;
}

export default function CombatTab({
  combat,
  setCombat,
  party = [],
  setParty,
  addLog,
  endCombat,
  updateCharHP,
  classesMap,
  worldState,
}) {
  const [selectedEnemy, setSelectedEnemy] = useState(null);
  // Track what the player has spent this turn
  const [turnActions, setTurnActions] = useState({ standard: false, move: false, fullRound: false, swift: false });
  const [showActionMenu, setShowActionMenu] = useState(false);
  const enemyTurnTimer = useRef(null);

  if (!combat || !combat.active) {
    return (
      <div
        style={{
          backgroundColor: '#1a1a2e',
          border: '2px solid #ffd700',
          borderRadius: '8px',
          padding: '40px',
          textAlign: 'center',
          color: '#666',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '16px' }}>⚔️</div>
        <div>No active combat</div>
      </div>
    );
  }

  const currentCombatant = combat.order?.[combat.currentTurn];
  const enemies = combat.enemies || [];
  const isPlayerTurn = currentCombatant && party.some((p) => p.id === currentCombatant.id && p.currentHP > 0);
  const isEnemyTurn = currentCombatant && enemies.some((e) => e.id === currentCombatant.id && e.currentHP > 0);

  // Can the player still act?
  const canStandard = !turnActions.standard && !turnActions.fullRound;
  const canMove = !turnActions.move && !turnActions.fullRound;
  const canFullRound = !turnActions.standard && !turnActions.move && !turnActions.fullRound;
  const canSwift = !turnActions.swift;

  const styles = {
    container: {
      backgroundColor: '#1a1a2e',
      border: '2px solid #ffd700',
      borderRadius: '8px',
      padding: '16px',
      color: '#d4c5a9',
      height: '100%',
      overflowY: 'auto',
    },
    section: {
      marginBottom: '16px',
      backgroundColor: '#2a2a4e',
      border: '1px solid rgba(255, 215, 0, 0.3)',
      borderRadius: '4px',
      padding: '12px',
    },
    title: {
      color: '#ffd700',
      fontWeight: 'bold',
      fontSize: '14px',
      marginBottom: '12px',
      textTransform: 'uppercase',
    },
    combatant: {
      marginBottom: '8px',
      padding: '8px',
      backgroundColor: '#1a1a2e',
      borderRadius: '3px',
      border: '1px solid rgba(255, 215, 0, 0.2)',
    },
    combatantActive: {
      borderColor: '#ffd700',
      backgroundColor: '#3a3a6e',
    },
    combatantName: {
      color: '#ffd700',
      fontWeight: 'bold',
      marginBottom: '4px',
    },
    hp: {
      fontSize: '12px',
      color: '#b0b0b0',
      marginBottom: '4px',
    },
    hpBar: {
      height: '12px',
      backgroundColor: '#0f0f1e',
      borderRadius: '2px',
      overflow: 'hidden',
      marginBottom: '4px',
    },
    hpFill: {
      height: '100%',
      backgroundColor: '#44ff44',
    },
    buttonRow: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      marginTop: '8px',
    },
    button: {
      minWidth: '80px',
      padding: '8px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
    },
    buttonDisabled: {
      minWidth: '80px',
      padding: '8px',
      backgroundColor: '#2a2a3e',
      border: '1px solid #555',
      color: '#555',
      borderRadius: '3px',
      cursor: 'not-allowed',
      fontSize: '11px',
      fontWeight: 'bold',
    },
    actionTag: {
      display: 'inline-block',
      padding: '2px 6px',
      borderRadius: '3px',
      fontSize: '9px',
      fontWeight: 'bold',
      marginLeft: '6px',
      textTransform: 'uppercase',
    },
    initiativeOrder: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gap: '8px',
    },
  };

  const actionTagColors = {
    standard: { bg: '#2a4a2a', color: '#7fff00' },
    'full-round': { bg: '#4a2a2a', color: '#ff6b6b' },
    move: { bg: '#2a2a4a', color: '#7eb8da' },
    swift: { bg: '#4a4a2a', color: '#ffd700' },
    free: { bg: '#3a3a3a', color: '#b0b0b0' },
  };

  const renderActionTag = (type) => {
    const colors = actionTagColors[type] || actionTagColors.free;
    return (
      <span style={{ ...styles.actionTag, backgroundColor: colors.bg, color: colors.color }}>
        {type}
      </span>
    );
  };

  // ── Player Attack (Standard Action) ──
  const handleAttack = (targetId) => {
    if (!canStandard) return;
    const attacker = party.find((p) => p.id === currentCombatant?.id);
    const target = enemies.find((e) => e.id === targetId);
    if (!attacker || !target) return;

    const weapon = getActiveWeapon(attacker);
    const { dice, sides } = parseWeaponDamage(weapon.dmg);
    const { threatRange, multiplier } = parseCritical(weapon.crit);
    const { mod: atkMod } = getAttackAbilityMod(attacker, weapon);
    const dmgMod = getDamageMod(attacker, weapon);

    const attackRoll = roll(20);
    const atkBonus = attacker.bab || 0;
    const totalAtk = attackRoll + atkBonus + atkMod;
    const targetAC = target.ac || 12;

    const isCrit = attackRoll >= threatRange;
    const isFumble = attackRoll === 1;
    const hit = isFumble ? false : (isCrit || totalAtk >= targetAC);

    if (hit) {
      let dmg = Math.max(1, rollDice(dice, sides).total + dmgMod);

      // Crit confirmation (PF1e: must confirm with another attack roll)
      let critConfirmed = false;
      if (isCrit) {
        const confirmRoll = roll(20) + atkBonus + atkMod;
        if (confirmRoll >= targetAC) {
          critConfirmed = true;
          dmg = Math.max(1, rollDice(dice * multiplier, sides).total + dmgMod * multiplier);
        }
      }

      const newHP = Math.max(0, target.currentHP - dmg);
      setCombat?.((prev) => ({
        ...prev,
        enemies: prev.enemies.map((e) =>
          e.id === targetId ? { ...e, currentHP: newHP } : e
        ),
      }));

      if (critConfirmed) {
        addLog?.(`CRITICAL HIT! ${attacker.name} devastates ${target.name} for ${dmg} damage with ${weapon.name}!`, 'damage');
      } else {
        const hitNarration = dmEngine.narrateCombatAction('combat_hit', {
          attacker: attacker.name, defender: target.name,
          weapon: weapon.name || 'their weapon',
          damage: dmg,
        });
        addLog?.(hitNarration, 'damage');
      }
      addLog?.(
        `(Roll: ${attackRoll}+${atkBonus + atkMod}=${totalAtk} vs AC ${targetAC}, ${dice}d${sides}+${dmgMod}=${dmg} dmg)`,
        'info'
      );

      if (newHP <= 0) {
        const killNarration = dmEngine.narrateCombatAction('combat_kill', {
          attacker: attacker.name, defender: target.name,
        });
        addLog?.(killNarration, 'success');
        const remainingEnemies = enemies.filter(
          (e) => e.id !== targetId && e.currentHP > 0
        );
        if (remainingEnemies.length === 0) {
          endCombat?.(true);
          return;
        }
      }
    } else {
      if (isFumble) {
        addLog?.(`${attacker.name} fumbles their attack!`, 'danger');
      } else {
        const missNarration = dmEngine.narrateCombatAction('combat_miss', {
          attacker: attacker.name, defender: target.name,
          weapon: weapon.name || 'their weapon',
        });
        addLog?.(missNarration, 'danger');
      }
      addLog?.(`(Roll: ${attackRoll}+${atkBonus + atkMod}=${totalAtk} vs AC ${targetAC})`, 'info');
    }

    setTurnActions(prev => ({ ...prev, standard: true }));
    // If move is also spent, auto-end turn
    if (turnActions.move) {
      endPlayerTurn();
    }
  };

  // ── Player Full Attack (Full-Round Action) ──
  const handleFullAttack = (targetId) => {
    if (!canFullRound) return;
    const attacker = party.find((p) => p.id === currentCombatant?.id);
    const target = enemies.find((e) => e.id === targetId);
    if (!attacker || !target) return;

    const weapon = getActiveWeapon(attacker);
    const { dice, sides } = parseWeaponDamage(weapon.dmg);
    const { threatRange, multiplier } = parseCritical(weapon.crit);
    const { mod: atkMod } = getAttackAbilityMod(attacker, weapon);
    const dmgMod = getDamageMod(attacker, weapon);

    const bab = attacker.bab || 0;
    // Iterative attacks: BAB +6 gets 2 attacks, +11 gets 3, +16 gets 4
    const numAttacks = Math.max(1, Math.min(4, 1 + Math.floor(bab / 5)));

    addLog?.(`${attacker.name} makes a full attack with ${weapon.name}!`, 'action');

    let currentTarget = target;
    for (let i = 0; i < numAttacks; i++) {
      // Refresh target in case it died
      const refreshedTarget = i === 0 ? target : enemies.find(e => e.id === currentTarget.id);
      if (!refreshedTarget || refreshedTarget.currentHP <= 0) {
        // Switch to next alive enemy
        const nextTarget = enemies.find(e => e.currentHP > 0 && e.id !== currentTarget.id);
        if (!nextTarget) break;
        currentTarget = nextTarget;
      }

      const iterativePenalty = i * -5;
      const attackRoll = roll(20);
      const totalAtk = attackRoll + bab + atkMod + iterativePenalty;
      const targetAC = currentTarget.ac || 12;
      const isCrit = attackRoll >= threatRange;
      const isFumble = attackRoll === 1;
      const hit = isFumble ? false : (isCrit || totalAtk >= targetAC);

      if (hit) {
        let dmg = Math.max(1, rollDice(dice, sides).total + dmgMod);
        let critConfirmed = false;
        if (isCrit) {
          const confirmRoll = roll(20) + bab + atkMod + iterativePenalty;
          if (confirmRoll >= targetAC) {
            critConfirmed = true;
            dmg = Math.max(1, rollDice(dice * multiplier, sides).total + dmgMod * multiplier);
          }
        }

        const newHP = Math.max(0, currentTarget.currentHP - dmg);
        setCombat?.((prev) => ({
          ...prev,
          enemies: prev.enemies.map((e) =>
            e.id === currentTarget.id ? { ...e, currentHP: newHP } : e
          ),
        }));
        // Update our local reference
        currentTarget = { ...currentTarget, currentHP: newHP };

        const prefix = critConfirmed ? 'CRITICAL! ' : '';
        addLog?.(`${prefix}Attack ${i + 1} hits ${currentTarget.name} for ${dmg} dmg!`, critConfirmed ? 'damage' : 'danger');
        addLog?.(`(${attackRoll}+${bab + atkMod + iterativePenalty}=${totalAtk} vs AC ${targetAC})`, 'info');

        if (newHP <= 0) {
          addLog?.(`${currentTarget.name} falls!`, 'success');
          const remaining = enemies.filter(e => e.id !== currentTarget.id && e.currentHP > 0);
          if (remaining.length === 0) {
            endCombat?.(true);
            return;
          }
        }
      } else {
        addLog?.(`Attack ${i + 1} ${isFumble ? 'fumbles!' : 'misses.'}`, isFumble ? 'danger' : 'info');
        addLog?.(`(${attackRoll}+${bab + atkMod + iterativePenalty}=${totalAtk} vs AC ${targetAC})`, 'info');
      }
    }

    setTurnActions({ standard: true, move: true, fullRound: true, swift: turnActions.swift });
    endPlayerTurn();
  };

  // ── Player Charge (Full-Round) ──
  const handleCharge = (targetId) => {
    if (!canFullRound) return;
    const attacker = party.find((p) => p.id === currentCombatant?.id);
    const target = enemies.find((e) => e.id === targetId);
    if (!attacker || !target) return;

    const weapon = getActiveWeapon(attacker);
    const { dice, sides } = parseWeaponDamage(weapon.dmg);
    const { threatRange, multiplier } = parseCritical(weapon.crit);
    const { mod: atkMod } = getAttackAbilityMod(attacker, weapon);
    const dmgMod = getDamageMod(attacker, weapon);

    const attackRoll = roll(20);
    const bab = attacker.bab || 0;
    const totalAtk = attackRoll + bab + atkMod + 2; // +2 charge bonus
    const targetAC = target.ac || 12;

    addLog?.(`${attacker.name} charges at ${target.name} with ${weapon.name}! (+2 attack, -2 AC until next turn)`, 'action');

    const isCrit = attackRoll >= threatRange;
    const isFumble = attackRoll === 1;
    const hit = isFumble ? false : (isCrit || totalAtk >= targetAC);

    if (hit) {
      let dmg = Math.max(1, rollDice(dice, sides).total + dmgMod);
      if (isCrit) {
        const confirmRoll = roll(20) + bab + atkMod + 2;
        if (confirmRoll >= targetAC) {
          dmg = Math.max(1, rollDice(dice * multiplier, sides).total + dmgMod * multiplier);
        }
      }
      const newHP = Math.max(0, target.currentHP - dmg);
      setCombat?.((prev) => ({
        ...prev,
        enemies: prev.enemies.map((e) =>
          e.id === targetId ? { ...e, currentHP: newHP } : e
        ),
      }));
      addLog?.(`The charge connects! ${dmg} damage!`, 'damage');
      addLog?.(`(${attackRoll}+${bab + atkMod + 2}=${totalAtk} vs AC ${targetAC})`, 'info');
      if (newHP <= 0) {
        addLog?.(`${target.name} is destroyed by the charge!`, 'success');
        if (enemies.filter(e => e.id !== targetId && e.currentHP > 0).length === 0) {
          endCombat?.(true);
          return;
        }
      }
    } else {
      addLog?.(`The charge ${isFumble ? 'goes wildly off course!' : 'misses!'}`, 'info');
      addLog?.(`(${attackRoll}+${bab + atkMod + 2}=${totalAtk} vs AC ${targetAC})`, 'info');
    }

    setTurnActions({ standard: true, move: true, fullRound: true, swift: turnActions.swift });
    endPlayerTurn();
  };

  // ── Player Total Defense (Standard) ──
  const handleTotalDefense = () => {
    if (!canStandard) return;
    const defender = party.find(p => p.id === currentCombatant?.id);
    if (!defender) return;
    addLog?.(`${defender.name} takes total defense (+4 dodge bonus to AC this round).`, 'action');
    setTurnActions(prev => ({ ...prev, standard: true }));
    if (turnActions.move) endPlayerTurn();
  };

  // ── Player 5-Foot Step (Free, but no other movement) ──
  const handleFiveFootStep = () => {
    const pc = party.find(p => p.id === currentCombatant?.id);
    if (!pc) return;
    addLog?.(`${pc.name} takes a careful 5-foot step.`, 'info');
  };

  // ── End Player Turn ──
  const endPlayerTurn = () => {
    setTurnActions({ standard: false, move: false, fullRound: false, swift: false });
    setShowActionMenu(false);
    nextTurn();
  };

  // ── Enemy Turn (AI-driven with Utility AI) ──
  const handleEnemyTurn = () => {
    const activeEnemy = enemies.find((e) => e.id === currentCombatant?.id && e.currentHP > 0);
    if (!activeEnemy) {
      nextTurn();
      return;
    }

    const aliveEnemies = enemies.filter(e => e.currentHP > 0);
    const alivePCs = party.filter(p => p.currentHP > 0);

    // Auto-detect and apply behavior preset if not already set
    if (!activeEnemy.behaviorPreset) {
      const preset = detectBehaviorPreset(activeEnemy);
      if (preset) {
        const enhanced = applyBehaviorPreset(activeEnemy, preset);
        Object.assign(activeEnemy, enhanced);
      }
    }

    // Coordinate group tactics (focus fire, flanking, protect casters)
    const directives = coordinateGroupTactics(aliveEnemies, alivePCs, {
      round: combat.round || 1,
    });

    // Build combat state for the AI
    const combatState = {
      round: combat.round || 1,
      directives,
    };

    const result = executeEnemyTurn(activeEnemy, party, aliveEnemies, combatState);

    // Log all results (skip debug entries in production)
    for (const entry of result.results) {
      if (entry.type === 'debug') continue; // Hide AI reasoning from player
      addLog?.(entry.text, entry.type);
    }

    // Apply HP changes
    for (const [targetId, damage] of Object.entries(result.hpChanges)) {
      if (damage < 0) {
        // Negative damage = healing (for enemy self-healing)
        updateCharHP?.(targetId, -damage); // This adds HP
      } else {
        updateCharHP?.(targetId, -damage);
      }
    }

    // Apply conditions to targets
    if (result.conditionsApplied) {
      for (const [targetId, conditionList] of Object.entries(result.conditionsApplied)) {
        // Apply conditions to party members
        setParty?.(prev => prev.map(p => {
          if (p.id === targetId) {
            const existing = p.conditions || [];
            return { ...p, conditions: [...existing, ...conditionList] };
          }
          return p;
        }));
        // Log conditions
        for (const cond of conditionList) {
          const target = party.find(p => p.id === targetId);
          if (target) {
            addLog?.(`${target.name} is now ${cond.name}!`, 'warning');
          }
        }
      }
    }

    // Handle fleeing — remove enemy from combat
    if (result.fled) {
      setCombat?.(prev => ({
        ...prev,
        enemies: prev.enemies.map(e =>
          e.id === activeEnemy.id ? { ...e, currentHP: 0, fled: true } : e
        ),
        order: prev.order.filter(o => o.id !== activeEnemy.id),
      }));
      addLog?.(`${activeEnemy.name} flees the battlefield!`, 'warning');
    }

    // Handle surrender
    if (result.surrendered) {
      setCombat?.(prev => ({
        ...prev,
        enemies: prev.enemies.map(e =>
          e.id === activeEnemy.id ? { ...e, surrendered: true } : e
        ),
        order: prev.order.filter(o => o.id !== activeEnemy.id),
      }));
      addLog?.(`${activeEnemy.name} surrenders!`, 'npc');
    }

    // Check if all enemies are gone
    const remainingEnemies = aliveEnemies.filter(
      e => e.id !== activeEnemy.id || (!result.fled && !result.surrendered)
    );
    const stillFighting = result.fled || result.surrendered
      ? remainingEnemies.filter(e => e.currentHP > 0)
      : remainingEnemies;

    if (stillFighting.length === 0 || (result.fled && aliveEnemies.length <= 1)) {
      // Check if any enemies with HP remain
      const anyLeft = enemies.filter(e => e.currentHP > 0 && e.id !== activeEnemy.id);
      if (anyLeft.length === 0) {
        endCombat?.(true);
        return;
      }
    }

    // Check if all PCs are down
    const remainingPCs = party.filter(p => p.currentHP > 0);
    // Need to account for damage just dealt
    const pcsStillUp = remainingPCs.filter(p => {
      const dmgTaken = result.hpChanges[p.id] || 0;
      return (p.currentHP - dmgTaken) > 0;
    });
    if (pcsStillUp.length === 0) {
      addLog?.('The party has fallen...', 'danger');
      endCombat?.(false);
      return;
    }

    nextTurn();
  };

  // ── Auto-advance enemy turns ──
  useEffect(() => {
    if (isEnemyTurn && !isPlayerTurn) {
      enemyTurnTimer.current = setTimeout(() => {
        handleEnemyTurn();
      }, 1200); // 1.2s delay so you can read what's happening
    }
    return () => {
      if (enemyTurnTimer.current) clearTimeout(enemyTurnTimer.current);
    };
  }, [combat?.currentTurn, combat?.round]);

  const nextTurn = () => {
    const order = combat.order || [];
    if (order.length === 0) return;
    let nextIdx = (combat.currentTurn + 1) % order.length;
    const round = combat.round || 1;
    const newRound = nextIdx <= combat.currentTurn ? round + 1 : round;

    // Skip dead combatants
    let checks = 0;
    while (checks < order.length) {
      const c = order[nextIdx];
      const isAlivePC = party.some((p) => p.id === c?.id && p.currentHP > 0);
      const isAliveEnemy = enemies.some((e) => e.id === c?.id && e.currentHP > 0 && !e.fled && !e.surrendered);

      if (isAlivePC || isAliveEnemy) break;
      nextIdx = (nextIdx + 1) % order.length;
      checks++;
    }

    if (nextIdx === 0 && newRound > round) {
      addLog?.(`— Round ${newRound} —`, 'system');

      // Tick conditions on all party members at start of new round
      setParty?.(prev => prev.map(p => {
        if (!p.conditions || p.conditions.length === 0) return p;
        const remaining = tickConditions(p.conditions);
        const expired = p.conditions.filter(c => !remaining.some(r => r.id === c.id && r.name === c.name));
        for (const exp of expired) {
          addLog?.(`${p.name} is no longer ${exp.name}.`, 'success');
        }
        return { ...p, conditions: remaining };
      }));

      // Tick conditions on enemies
      setCombat?.(prev => ({
        ...prev,
        enemies: prev.enemies.map(e => {
          if (!e.conditions || e.conditions.length === 0) return e;
          const remaining = tickConditions(e.conditions);
          const expired = e.conditions.filter(c => !remaining.some(r => r.id === c.id && r.name === c.name));
          for (const exp of expired) {
            addLog?.(`${e.name} is no longer ${exp.name}.`, 'info');
          }
          return { ...e, conditions: remaining };
        }),
      }));
    }

    setCombat?.((prev) => ({ ...prev, currentTurn: nextIdx, round: newRound }));
  };

  // ── Render: Player Turn Actions ──
  const renderPlayerActions = () => {
    const aliveEnemies = enemies.filter(e => e.currentHP > 0);
    const attacker = party.find(p => p.id === currentCombatant?.id);
    const bab = attacker?.bab || 0;
    const hasIteratives = bab >= 6;

    return (
      <div>
        <div style={{ fontSize: '12px', color: '#7fff00', marginBottom: '8px' }}>
          🎯 {currentCombatant?.name}'s TURN
          <span style={{ color: '#8b949e', marginLeft: '12px', fontSize: '10px' }}>
            Round {combat.round || 1}
          </span>
          {worldState?.currentWeather && (
            <span style={{ fontSize: '10px', color: '#87ceeb', marginLeft: '12px' }}>
              {worldState.currentWeather.description || 'Clear'}
              {worldState.currentWeather.wind?.includes('strong') || worldState.currentWeather.wind?.includes('severe') ? ' (ranged -2)' : ''}
              {worldState.currentWeather.precipitation?.includes('heavy') ? ' (Perception -4, ranged -4)' :
               worldState.currentWeather.precipitation?.includes('rain') || worldState.currentWeather.precipitation?.includes('snow') ? ' (Perception -2, ranged -2)' : ''}
            </span>
          )}
        </div>

        {/* Action budget display */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <span style={{
            padding: '2px 8px', borderRadius: '3px', fontSize: '10px', fontWeight: 'bold',
            backgroundColor: canStandard ? '#2a4a2a' : '#3a2a2a',
            color: canStandard ? '#7fff00' : '#666',
          }}>
            Standard: {canStandard ? 'Available' : 'Spent'}
          </span>
          <span style={{
            padding: '2px 8px', borderRadius: '3px', fontSize: '10px', fontWeight: 'bold',
            backgroundColor: canMove ? '#2a2a4a' : '#3a2a2a',
            color: canMove ? '#7eb8da' : '#666',
          }}>
            Move: {canMove ? 'Available' : 'Spent'}
          </span>
          <span style={{
            padding: '2px 8px', borderRadius: '3px', fontSize: '10px', fontWeight: 'bold',
            backgroundColor: canSwift ? '#4a4a2a' : '#3a2a2a',
            color: canSwift ? '#ffd700' : '#666',
          }}>
            Swift: {canSwift ? 'Available' : 'Spent'}
          </span>
        </div>

        {/* Standard action: single attack */}
        {canStandard && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#7fff00', marginBottom: '4px' }}>
              Attack {renderActionTag('standard')}
            </div>
            <div style={styles.buttonRow}>
              {aliveEnemies.map((enemy) => (
                <button
                  key={enemy.id}
                  style={styles.button}
                  onClick={() => handleAttack(enemy.id)}
                >
                  {enemy.name} ({enemy.currentHP}/{enemy.hp})
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Full-round actions */}
        {canFullRound && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#ff6b6b', marginBottom: '4px' }}>
              Full Attack {hasIteratives ? `(${1 + Math.floor(bab / 5)} attacks)` : '(1 attack)'} {renderActionTag('full-round')}
            </div>
            <div style={styles.buttonRow}>
              {aliveEnemies.map((enemy) => (
                <button
                  key={'fa_' + enemy.id}
                  style={{ ...styles.button, borderColor: '#ff6b6b', color: '#ff6b6b' }}
                  onClick={() => handleFullAttack(enemy.id)}
                >
                  Full Atk: {enemy.name}
                </button>
              ))}
            </div>
            <div style={styles.buttonRow}>
              {aliveEnemies.map((enemy) => (
                <button
                  key={'ch_' + enemy.id}
                  style={{ ...styles.button, borderColor: '#ffaa00', color: '#ffaa00' }}
                  onClick={() => handleCharge(enemy.id)}
                >
                  Charge: {enemy.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Other actions */}
        <div style={styles.buttonRow}>
          {canStandard && (
            <button
              style={{ ...styles.button, borderColor: '#7eb8da', color: '#7eb8da' }}
              onClick={handleTotalDefense}
            >
              Total Defense {renderActionTag('standard')}
            </button>
          )}
          <button
            style={{ ...styles.button, borderColor: '#b0b0b0', color: '#b0b0b0' }}
            onClick={handleFiveFootStep}
          >
            5ft Step {renderActionTag('free')}
          </button>
          <button
            style={{ ...styles.button, borderColor: '#7fff00', color: '#7fff00' }}
            onClick={endPlayerTurn}
          >
            End Turn
          </button>
        </div>
      </div>
    );
  };

  // ── Render: Enemy Turn ──
  const renderEnemyTurn = () => (
    <div>
      <div style={{ fontSize: '12px', color: '#ff6b6b', marginBottom: '4px' }}>
        👿 {currentCombatant?.name}'s TURN
        <span style={{ color: '#8b949e', marginLeft: '12px', fontSize: '10px' }}>
          Round {combat.round || 1}
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#8b949e', fontStyle: 'italic' }}>
        The enemy is deciding their action...
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      {/* Current Turn */}
      <div style={styles.section}>
        <div style={styles.title}>
          Combat — Round {combat.round || 1}
        </div>
        {currentCombatant && (
          <div style={{ ...styles.combatant, ...styles.combatantActive }}>
            <div style={styles.combatantName}>{currentCombatant.name}</div>
            {isPlayerTurn ? renderPlayerActions() : renderEnemyTurn()}
          </div>
        )}
      </div>

      {/* Initiative Order */}
      <div style={styles.section}>
        <div style={styles.title}>Initiative Order</div>
        <div style={styles.initiativeOrder}>
          {combat.order?.map((combatant, idx) => {
            const isActive = idx === combat.currentTurn;
            const pc = party.find((p) => p.id === combatant.id);
            const enemy = enemies.find(e => e.id === combatant.id);
            const isDead = (pc && pc.currentHP <= 0) || (enemy && enemy.currentHP <= 0);
            const hpPercent = pc ? (pc.currentHP / pc.maxHP) * 100 : 0;

            return (
              <div
                key={combatant.id}
                style={{
                  ...styles.combatant,
                  ...(isActive ? styles.combatantActive : {}),
                  opacity: isDead ? 0.4 : 1,
                }}
              >
                <div style={{ ...styles.combatantName, fontSize: '11px' }}>
                  {isDead ? '💀 ' : ''}{combatant.name}
                </div>
                {pc && (
                  <div style={styles.hpBar}>
                    <div
                      style={{
                        ...styles.hpFill,
                        width: `${Math.max(0, hpPercent)}%`,
                        backgroundColor:
                          hpPercent > 50 ? '#44ff44' : hpPercent > 25 ? '#ffaa00' : '#ff4444',
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Enemies */}
      <div style={styles.section}>
        <div style={styles.title}>Enemies</div>
        {enemies.map((enemy) => {
          const hpPercent = enemy.hp > 0 ? (enemy.currentHP / enemy.hp) * 100 : 0;
          return (
            <div key={enemy.id} style={{ ...styles.combatant, opacity: enemy.currentHP <= 0 ? 0.4 : 1 }}>
              <div style={styles.combatantName}>
                {enemy.currentHP <= 0 ? '💀 ' : ''}{enemy.fled ? '🏃 ' : ''}{enemy.surrendered ? '🏳️ ' : ''}
                {enemy.name} {enemy.ac ? `(AC ${enemy.ac})` : ''}
                {enemy.cr ? <span style={{ fontSize: '10px', color: '#8b949e', marginLeft: '8px' }}>CR {enemy.cr}</span> : null}
                {enemy.behaviorPreset ? <span style={{ fontSize: '9px', color: '#7b68ee', marginLeft: '6px' }}>[{enemy.behaviorPreset}]</span> : null}
              </div>
              <div style={styles.hp}>
                {Math.max(0, enemy.currentHP)}/{enemy.hp}
                {enemy.type ? <span style={{ marginLeft: '8px', fontSize: '10px', color: '#666' }}>{enemy.type}</span> : null}
                {enemy.int != null ? <span style={{ marginLeft: '6px', fontSize: '9px', color: '#58a6ff' }}>INT {enemy.int}</span> : null}
              </div>
              {enemy.conditions && enemy.conditions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                  {enemy.conditions.map((c, ci) => (
                    <span key={ci} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: '#8b0000', color: '#ffcccc' }}>
                      {c.name}{c.duration > 0 ? ` (${c.duration}r)` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div style={styles.hpBar}>
                <div
                  style={{
                    ...styles.hpFill,
                    width: `${Math.max(0, hpPercent)}%`,
                    backgroundColor:
                      hpPercent > 50 ? '#ff6b6b' : hpPercent > 25 ? '#ff4444' : '#8b0000',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Party Status */}
      <div style={styles.section}>
        <div style={styles.title}>Party Status</div>
        {party.map((char) => {
          const hpPercent = (char.currentHP / char.maxHP) * 100;
          return (
            <div key={char.id} style={styles.combatant}>
              <div style={styles.combatantName}>
                {char.currentHP <= 0 ? '💀 ' : ''}{char.name}
                {char.class ? <span style={{ fontSize: '10px', color: '#8b949e', marginLeft: '8px' }}>{char.class} {char.level}</span> : null}
              </div>
              <div style={styles.hp}>
                {char.currentHP}/{char.maxHP}
              </div>
              {char.conditions && char.conditions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                  {char.conditions.map((c, ci) => (
                    <span key={ci} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: '#8b4513', color: '#ffd700' }}>
                      {c.name}{c.duration > 0 ? ` (${c.duration}r)` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div style={styles.hpBar}>
                <div
                  style={{
                    ...styles.hpFill,
                    width: `${Math.max(0, hpPercent)}%`,
                    backgroundColor:
                      hpPercent > 50 ? '#44ff44' : hpPercent > 25 ? '#ffaa00' : '#ff4444',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Combat-wide actions */}
      <div style={styles.buttonRow}>
        <button
          style={{ ...styles.button, borderColor: '#ff4444', color: '#ff4444' }}
          onClick={endCombat}
        >
          End Combat
        </button>
        <button
          style={{ ...styles.button, borderColor: '#ffaa00', color: '#ffaa00' }}
          onClick={() => {
            addLog?.('The party flees from combat!', 'action');
            endCombat?.();
          }}
        >
          Party Flees
        </button>
      </div>
    </div>
  );
}
