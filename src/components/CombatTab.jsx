import React, { useState, useEffect, useRef } from 'react';
import { roll, rollDice } from '../utils/dice';
import dmEngine from '../services/dmEngine';
import { unlockCreatureKnowledge } from '../services/bestiaryTracker';
import {
  emptyObservation,
  narrowAcFromAttack,
  hpDescriptor,
  hpDescriptorLabel,
  describeAcRange,
  hasAcObservation,
  applyObservationEvents,
  ensureObservationShape,
  hasSaveObservations,
  describeSaveBucket,
} from '../services/combatObservation';
import { classifyCombatant, isCombatantAlive } from '../services/combatInitiative';
import {
  checkWeaponProficiency,
  checkArmorProficiency,
  resolveSave,
  computeSpellDC,
  computeSLADC,
  getCharacterModifiers,
  mergeAllModifiers,
} from '../utils/rulesEngine';
import skillsData from '../data/skills.json';
import { aggregateConditionModifiers } from '../utils/conditionTracker';
import { validateCasting, consumeSpellSlot, getArcaneSpellFailure, resolveSpellCasting, getSpellLevelForClass, getCastingAbility } from '../utils/spellEngine';
import { resolveSpellEffect } from '../utils/spellEffectResolver';
import { tickActiveEffects, createActiveEffect } from '../utils/activeEffectsTracker';
import { createCondition } from '../utils/conditionTracker';
import spellsData from '../data/spells.json';
import {
  computeSneakAttackDamage,
  resolveChannelEnergy,
  resolveLayOnHands,
  resolveSmiteEvil,
  resolveBardicPerformance,
  resolveClassAbility,
  getPassiveClassModifiers,
  hasEvasion,
  hasUncannyDodge,
  applyEvasion,
  getFlurryAttacks,
  getMonkUnarmedDamage,
} from '../utils/classAbilityResolver';
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
import {
  getFamiliarById,
  isFamiliarInRange,
  getEffectiveMaxHP,
} from '../utils/familiarEngine';
import { tickClock } from '../services/clockTick';
import {
  npcToCombatAlly,
  summonToCombatAlly,
  spliceIntoInitiative,
} from '../services/allyFactory';

// PF1e finesse weapon list
const FINESSE_WEAPONS = [
  'Rapier', 'Dagger', 'Short Sword', 'Whip', 'Spiked Chain',
  'Elven Curve Blade', 'Starknife',
];

// ── Observation merge helper ──────────────────────────────────────────
// Returns a new combat state with combat.observed[targetId] updated via
// the supplied mutator. Safe against missing observed slot (seeds one on
// the fly — covers enemies added mid-combat).
function mergeObservation(prev, targetId, mutator) {
  if (!prev || targetId == null) return prev;
  const existing = prev.observed?.[targetId] || emptyObservation();
  const next = mutator(existing);
  if (next === existing) return prev;
  return { ...prev, observed: { ...(prev.observed || {}), [targetId]: next } };
}

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

// Compute racial attack bonuses (Hatred, Halfling sling/thrown)
function getRacialAttackBonuses(attacker, weapon, target) {
  let hatredBonus = 0;
  let racialWeaponBonus = 0;

  // Hatred (e.g., Dwarf +1 vs orc/goblinoid, Gnome +1 vs reptilian/goblinoid)
  const hatred = attacker.racialCombatBonuses?.hatred;
  if (hatred) {
    const enemyType = (target.type || target.creatureType || '').toLowerCase();
    const enemySubtype = (target.subtype || '').toLowerCase();
    if (hatred.vsTypes.some(vt => enemyType.includes(vt) || enemySubtype.includes(vt))) {
      hatredBonus = hatred.attackBonus;
    }
  }

  // Halfling +1 racial bonus with slings and thrown weapons
  const slingBonus = attacker.racialCombatBonuses?.slingThrownBonus;
  if (slingBonus) {
    const wLower = (weapon?.name || '').toLowerCase();
    const isThrown = weapon?.category === 'thrown' || weapon?.type === 'thrown';
    if (wLower.includes('sling') || isThrown) {
      racialWeaponBonus = slingBonus.attackBonus;
    }
  }

  return { hatredBonus, racialWeaponBonus, total: hatredBonus + racialWeaponBonus };
}

// Compute target AC including Defensive Training if the target is a player being attacked by typed enemies
function getDefensiveTrainingAC(defender, attackerType) {
  const dt = defender.racialCombatBonuses?.defensiveTraining;
  if (!dt || !attackerType) return 0;
  const atkType = attackerType.toLowerCase();
  if (dt.vsTypes.some(vt => atkType.includes(vt))) return dt.acBonus;
  return 0;
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
  setWorldState,
}) {
  const [selectedEnemy, setSelectedEnemy] = useState(null);
  // Track what the player has spent this turn
  const [turnActions, setTurnActions] = useState({ standard: false, move: false, fullRound: false, swift: false });
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showSpellMenu, setShowSpellMenu] = useState(false);
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [selectedSpellTarget, setSelectedSpellTarget] = useState(null);
  // Phase 7.6 — "Deliver Touch Spells via Familiar" toggle (CRB p. 83).
  // When ON and the attacker has an in-range familiar, handleCastSpell
  // narrates the familiar carrying the touch to the target. Does not
  // alter the mechanical pipeline (save/SR/effect resolution) — it's a
  // delivery-method flavor tag for now.
  const [deliverTouchViaFamiliar, setDeliverTouchViaFamiliar] = useState(false);
  const enemyTurnTimer = useRef(null);
  // Tracks whether we've already run the identify-creature flow for this combat instance
  const lastCombatActiveRef = useRef(false);

  // ── Auto-identify creatures when combat starts (CRB Ch. 4 Knowledge check) ──
  useEffect(() => {
    if (!combat?.active) {
      lastCombatActiveRef.current = false;
      return;
    }
    if (lastCombatActiveRef.current) return;
    lastCombatActiveRef.current = true;

    const enemiesList = combat.enemies || [];
    if (enemiesList.length === 0 || !party || party.length === 0) return;

    // One identify attempt per unique baseName (so the bestiary unlock matches by name)
    const seen = new Set();
    enemiesList.forEach((enemy) => {
      const baseName = String(enemy.baseName || enemy.name || '').replace(/\s+#\d+\s*$/, '').trim();
      if (!baseName || seen.has(baseName)) return;
      seen.add(baseName);

      const idCheck = dmEngine.identifyCreatureCheck(enemy.type || 'humanoid', enemy.cr || 0);
      if (!idCheck || !idCheck.skill) return;

      // Find the party member with the best modifier in this Knowledge skill
      let bestChecker = null;
      let bestMod = -Infinity;
      party.forEach((p) => {
        if ((p.currentHP || 0) <= 0) return;
        const t10 = dmEngine.take10SkillCheck(p, idCheck.skill, { inCombat: true, threatened: true }, worldState);
        if (t10 && t10.canUse && typeof t10.total === 'number') {
          const staticMod = t10.total - 10;
          if (staticMod > bestMod) {
            bestMod = staticMod;
            bestChecker = p;
          }
        }
      });

      if (!bestChecker) {
        addLog?.(
          `📖 No one in the party can attempt ${idCheck.skill} to identify the ${enemy.name} (DC ${idCheck.dc}).`,
          'warning'
        );
        return;
      }

      // Roll a real check (not Take 10) — combat is fast and surprising
      const result = dmEngine.resolveSkillCheck(bestChecker, idCheck.skill, null, { inCombat: true, threatened: true }, worldState);
      if (!result.canUse) {
        addLog?.(
          `📖 ${bestChecker.name} cannot identify the ${enemy.name}: ${result.reason}`,
          'warning'
        );
        return;
      }
      if (result.total >= idCheck.dc) {
        const facts = dmEngine.countCreatureFactsLearned(result.total, idCheck.dc);
        const extra = Math.max(0, facts - 1);
        addLog?.(
          `📖 ${bestChecker.name} recognizes the ${enemy.name}! ${idCheck.skill} ${result.total} vs DC ${idCheck.dc} — recalls its name${extra > 0 ? ` and ${extra} additional fact${extra === 1 ? '' : 's'} (type, weaknesses, or special abilities)` : ''}.`,
          'success'
        );
        // Unlock the creature in the Adventurer's Journal bestiary
        unlockCreatureKnowledge(enemy, facts).catch(() => {});
      } else {
        addLog?.(
          `📖 ${bestChecker.name} can't quite place the ${enemy.name}: ${idCheck.skill} ${result.total} vs DC ${idCheck.dc} — no useful lore recalled.`,
          'danger'
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combat?.active]);

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
  const allies = combat.allies || [];
  // Orc Ferocity: PC at 0 HP with orcFerocityActive can still act (disabled = 1 standard action only)
  const isPlayerTurn = currentCombatant && party.some((p) => p.id === currentCombatant.id && (p.currentHP > 0 || p.orcFerocityActive));
  const isEnemyTurn = currentCombatant && enemies.some((e) => e.id === currentCombatant.id && e.currentHP > 0);
  // Phase A: ally turns are inert — they occupy an initiative slot and auto-pass.
  // Future phases: AI / GM-controlled / player-controlled turn execution.
  const isAllyTurn = currentCombatant && allies.some((a) => a.id === currentCombatant.id && a.currentHP > 0);

  // Phase C.3/C.4: identify the active ally + its controlMode once so render +
  // auto-advance effect both read the same source of truth. 'ai' is the
  // default when controlMode is missing (fresh/legacy allies).
  //
  // "Interactive" ally turns (gm or player) share the same picker UI and
  // handlers — the only difference is who's clicking and the header label.
  // The mechanics (Attack delegates to handleAllyTurn, Defend stamps
  // total_defense, Pass holds action) are identical. A future Phase C.5
  // can diverge player-mode with explicit target selection once allies
  // carry PC-shaped attack stats (Phase F).
  const activeAlly = isAllyTurn ? allies.find(a => a.id === currentCombatant.id) : null;
  const activeAllyMode = activeAlly?.controlMode || 'ai';
  const isGMAllyTurn = isAllyTurn && activeAllyMode === 'gm';
  const isPlayerAllyTurn = isAllyTurn && activeAllyMode === 'player';
  const isInteractiveAllyTurn = isGMAllyTurn || isPlayerAllyTurn;

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

    // Check conditions + active spell effects that prevent attacking
    const condMods = getCharacterModifiers(attacker, worldState);
    if (condMods.cannotAct) {
      addLog?.(`${attacker.name} cannot act — incapacitated!`, 'danger');
      return;
    }
    if (condMods.cannotAttack) {
      addLog?.(`${attacker.name} cannot attack this round!`, 'danger');
      return;
    }

    const weapon = getActiveWeapon(attacker);
    const { dice, sides } = parseWeaponDamage(weapon.dmg);
    const { threatRange, multiplier } = parseCritical(weapon.crit);
    const { mod: atkMod } = getAttackAbilityMod(attacker, weapon);
    const dmgMod = getDamageMod(attacker, weapon);

    // Proficiency check
    const profCheck = checkWeaponProficiency(attacker, weapon.name);
    const profPenalty = profCheck.penalty;
    if (!profCheck.proficient) {
      addLog?.(`⚠️ ${attacker.name} is not proficient with ${weapon.name} (${profPenalty} to attack)`, 'warning');
    }

    // Armor proficiency penalty applies to attacks too
    const armorProf = checkArmorProficiency(attacker, attacker.armor);
    const armorAtkPenalty = armorProf.proficient ? 0 : armorProf.penalty;
    if (!armorProf.proficient) {
      addLog?.(`⚠️ Not proficient with ${attacker.armor} (${armorAtkPenalty} ACP to attacks)`, 'warning');
    }

    // Condition attack modifier
    const condAtkMod = condMods.attack || 0;

    // Miss chance from conditions (e.g., blinded)
    if (condMods.missChance > 0) {
      const missRoll = roll(100);
      if (missRoll <= condMods.missChance) {
        addLog?.(`${attacker.name} misses due to ${condMods.missChance}% miss chance! (rolled ${missRoll})`, 'danger');
        setTurnActions(prev => ({ ...prev, standard: true }));
        return;
      }
    }

    // Racial attack bonuses (Hatred, Halfling sling/thrown)
    const racialAtk = getRacialAttackBonuses(attacker, weapon, target);
    if (racialAtk.hatredBonus) addLog?.(`⚔️ Hatred: +${racialAtk.hatredBonus} attack vs ${(target.type || 'enemy').toLowerCase()}`, 'success');
    if (racialAtk.racialWeaponBonus) addLog?.(`🎯 Racial weapon bonus: +${racialAtk.racialWeaponBonus} attack`, 'success');

    // Class passive bonuses (Fighter Weapon Training/Mastery, Paladin, Monk, etc.)
    const classPassives = getPassiveClassModifiers(attacker);
    const classAtkBonus = classPassives.attack || 0;
    const classDmgBonus = classPassives.damage || 0;
    if (classAtkBonus) addLog?.(`Class bonus: +${classAtkBonus} attack`, 'success');
    if (classDmgBonus) addLog?.(`Class bonus: +${classDmgBonus} damage`, 'success');

    const attackRoll = roll(20);
    const atkBonus = attacker.bab || 0;
    const totalAtk = attackRoll + atkBonus + atkMod + profPenalty + armorAtkPenalty + condAtkMod + racialAtk.total + classAtkBonus;
    let targetAC = target.ac || 12;

    const isCrit = attackRoll >= threatRange;
    const isFumble = attackRoll === 1;
    const hit = isFumble ? false : (isCrit || totalAtk >= targetAC);

    // NWN-style: announce the natural-20 threat before resolving damage
    // so the critical color stands out even if the confirm roll misses.
    if (isCrit) {
      addLog?.(`🎯 Natural ${attackRoll}! ${attacker.name} threatens a critical hit!`, 'critical');
    }

    if (hit) {
      let dmg = Math.max(1, rollDice(dice, sides).total + dmgMod + classDmgBonus);

      // Crit confirmation (PF1e: must confirm with another attack roll — same bonuses as attack)
      let critConfirmed = false;
      if (isCrit) {
        const confirmRoll = roll(20) + atkBonus + atkMod + profPenalty + armorAtkPenalty + condAtkMod + racialAtk.total + classAtkBonus;
        if (confirmRoll >= targetAC) {
          critConfirmed = true;
          dmg = Math.max(1, rollDice(dice * multiplier, sides).total + (dmgMod + classDmgBonus) * multiplier);
        }
      }

      // Sneak Attack — check if flanking or target denied DEX to AC
      // Check conditions on target for loseDexToAC (e.g., feinted, blinded, stunned)
      const targetCondMods = aggregateConditionModifiers(target.conditions || []);
      const sneakCtx = {
        isFlanking: attacker.isFlanking || condMods.flanking,
        targetDeniedDex: target.flatFooted || target.deniedDex || targetCondMods.loseDexToAC,
        targetType: target.type || target.creatureType || '',
        isRanged: weapon?.type === 'ranged' || weapon?.category === 'ranged',
      };
      const sneakResult = computeSneakAttackDamage(attacker, sneakCtx);
      if (sneakResult.applies) {
        dmg += sneakResult.damage;
        addLog?.(`🗡️ ${sneakResult.reason}: +${sneakResult.damage} damage!`, 'damage');
      }

      const newHP = Math.max(0, target.currentHP - dmg);
      // Clear 'feinted' condition after the attack (it only applies to one attack)
      const updatedConditions = (target.conditions || []).filter(c => c.id !== 'feinted');
      const feintCleared = updatedConditions.length < (target.conditions || []).length;
      setCombat?.((prev) => {
        const withEnemy = {
          ...prev,
          enemies: prev.enemies.map((e) =>
            e.id === targetId ? { ...e, currentHP: newHP, conditions: updatedConditions } : e
          ),
        };
        // Observation: a hit at totalAtk narrows acHigh down.
        return mergeObservation(withEnemy, targetId, (o) =>
          narrowAcFromAttack(o, totalAtk, { hit: true, natural: attackRoll, targetAC }));
      });
      if (feintCleared) addLog?.(`${target.name} is no longer feinted`, 'info');

      if (critConfirmed) {
        addLog?.(`💥 CRITICAL HIT! ${attacker.name} devastates ${target.name} for ${dmg} damage with ${weapon.name}!`, 'critical');
      } else {
        const hitNarration = dmEngine.narrateCombatAction('combat_hit', {
          attacker: attacker.name, defender: target.name,
          weapon: weapon.name || 'their weapon',
          damage: dmg,
        });
        addLog?.(hitNarration, 'damage');
      }
      const modBreakdown = [
        `${atkBonus} BAB`,
        `${atkMod >= 0 ? '+' : ''}${atkMod} ability`,
        profPenalty ? `${profPenalty} non-prof` : '',
        armorAtkPenalty ? `${armorAtkPenalty} armor` : '',
        condAtkMod ? `${condAtkMod > 0 ? '+' : ''}${condAtkMod} cond` : '',
        racialAtk.hatredBonus ? `+${racialAtk.hatredBonus} hatred` : '',
        racialAtk.racialWeaponBonus ? `+${racialAtk.racialWeaponBonus} racial` : '',
        classAtkBonus ? `+${classAtkBonus} class` : '',
      ].filter(Boolean).join(', ');
      addLog?.(
        `(Roll: ${attackRoll} + [${modBreakdown}] = ${totalAtk} vs AC ${targetAC}, ${dice}d${sides}+${dmgMod}=${dmg} dmg)`,
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
        addLog?.(`💢 Natural 1! ${attacker.name} fumbles their attack!`, 'fumble');
      } else {
        const missNarration = dmEngine.narrateCombatAction('combat_miss', {
          attacker: attacker.name, defender: target.name,
          weapon: weapon.name || 'their weapon',
        });
        addLog?.(missNarration, 'danger');
      }
      // Observation: a miss at totalAtk narrows acLow up (AC > totalAtk).
      setCombat?.((prev) => mergeObservation(prev, targetId, (o) =>
        narrowAcFromAttack(o, totalAtk, { hit: false, natural: attackRoll })));
      const missBreakdown = [
        `${atkBonus} BAB`,
        `${atkMod >= 0 ? '+' : ''}${atkMod} ability`,
        profPenalty ? `${profPenalty} non-prof` : '',
        armorAtkPenalty ? `${armorAtkPenalty} armor` : '',
        condAtkMod ? `${condAtkMod > 0 ? '+' : ''}${condAtkMod} cond` : '',
        racialAtk.total ? `+${racialAtk.total} racial` : '',
        classAtkBonus ? `+${classAtkBonus} class` : '',
      ].filter(Boolean).join(', ');
      addLog?.(`(Roll: ${attackRoll} + [${missBreakdown}] = ${totalAtk} vs AC ${targetAC})`, 'info');
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

    // Condition + active effect checks
    const condMods = getCharacterModifiers(attacker, worldState);
    if (condMods.cannotAct) { addLog?.(`${attacker.name} cannot act — incapacitated!`, 'danger'); return; }
    if (condMods.cannotAttack) { addLog?.(`${attacker.name} cannot attack this round!`, 'danger'); return; }

    const weapon = getActiveWeapon(attacker);
    const { dice, sides } = parseWeaponDamage(weapon.dmg);
    const { threatRange, multiplier } = parseCritical(weapon.crit);
    const { mod: atkMod } = getAttackAbilityMod(attacker, weapon);
    const dmgMod = getDamageMod(attacker, weapon);

    // Proficiency penalties
    const profCheck = checkWeaponProficiency(attacker, weapon.name);
    const profPenalty = profCheck.penalty;
    const armorProf = checkArmorProficiency(attacker, attacker.armor);
    const armorAtkPenalty = armorProf.proficient ? 0 : armorProf.penalty;
    const condAtkMod = condMods.attack || 0;

    if (!profCheck.proficient) addLog?.(`⚠️ Not proficient with ${weapon.name} (${profPenalty} to attack)`, 'warning');

    // Racial attack bonuses
    const racialAtk = getRacialAttackBonuses(attacker, weapon, target);
    if (racialAtk.hatredBonus) addLog?.(`⚔️ Hatred: +${racialAtk.hatredBonus} attack vs ${(target.type || 'enemy').toLowerCase()}`, 'info');
    if (racialAtk.racialWeaponBonus) addLog?.(`🎯 Racial weapon bonus: +${racialAtk.racialWeaponBonus} attack`, 'info');

    // Class passive bonuses (Fighter Weapon Training/Mastery, etc.)
    const classPassives = getPassiveClassModifiers(attacker);
    const classAtkBonus = classPassives.attack || 0;
    const classDmgBonus = classPassives.damage || 0;
    if (classAtkBonus) addLog?.(`Class bonus: +${classAtkBonus} attack`, 'info');
    if (classDmgBonus) addLog?.(`Class bonus: +${classDmgBonus} damage`, 'info');

    const bab = attacker.bab || 0;
    let numAttacks = Math.max(1, Math.min(4, 1 + Math.floor((bab - 1) / 5))); // CRB: iteratives at +6/+11/+16
    // Haste grants an extra attack at highest BAB
    if (condMods.extraAttack) numAttacks += 1;

    addLog?.(`${attacker.name} makes a full attack with ${weapon.name}!`, 'action');

    let currentTarget = target;
    for (let i = 0; i < numAttacks; i++) {
      const refreshedTarget = i === 0 ? target : enemies.find(e => e.id === currentTarget.id);
      if (!refreshedTarget || refreshedTarget.currentHP <= 0) {
        const nextTarget = enemies.find(e => e.currentHP > 0 && e.id !== currentTarget.id);
        if (!nextTarget) break;
        currentTarget = nextTarget;
      }

      // Miss chance check
      if (condMods.missChance > 0) {
        const missRoll = roll(100);
        if (missRoll <= condMods.missChance) {
          addLog?.(`Attack ${i + 1} misses (${condMods.missChance}% miss chance, rolled ${missRoll})`, 'danger');
          continue;
        }
      }

      // Haste extra attack has no iterative penalty; normal iteratives do
      const isHasteAttack = condMods.extraAttack && i === numAttacks - 1;
      const iterativePenalty = isHasteAttack ? 0 : (i * -5);
      // Recalculate racial bonuses per-target (hatred may change if switching targets)
      const iterRacialAtk = getRacialAttackBonuses(attacker, weapon, currentTarget);
      const attackRoll = roll(20);
      const totalAtk = attackRoll + bab + atkMod + iterativePenalty + profPenalty + armorAtkPenalty + condAtkMod + iterRacialAtk.total + classAtkBonus;
      const targetAC = currentTarget.ac || 12;
      const isCrit = attackRoll >= threatRange;
      const isFumble = attackRoll === 1;
      const hit = isFumble ? false : (isCrit || totalAtk >= targetAC);

      if (isCrit) {
        addLog?.(`🎯 Natural ${attackRoll}! Attack ${i + 1} threatens a critical hit!`, 'critical');
      }

      if (hit) {
        let dmg = Math.max(1, rollDice(dice, sides).total + dmgMod + classDmgBonus);
        let critConfirmed = false;
        if (isCrit) {
          const confirmRoll = roll(20) + bab + atkMod + iterativePenalty + profPenalty + armorAtkPenalty + condAtkMod + iterRacialAtk.total + classAtkBonus;
          if (confirmRoll >= targetAC) {
            critConfirmed = true;
            dmg = Math.max(1, rollDice(dice * multiplier, sides).total + (dmgMod + classDmgBonus) * multiplier);
          }
        }

        // Sneak attack — check conditions on target for denied DEX (feinted, blinded, etc.)
        const tgtCondMods = aggregateConditionModifiers(currentTarget.conditions || []);
        const faSneakCtx = {
          isFlanking: attacker.isFlanking || condMods.flanking,
          targetDeniedDex: currentTarget.flatFooted || currentTarget.deniedDex || tgtCondMods.loseDexToAC,
          targetType: currentTarget.type || currentTarget.creatureType || '',
          isRanged: weapon?.type === 'ranged' || weapon?.category === 'ranged',
        };
        const faSneakResult = computeSneakAttackDamage(attacker, faSneakCtx);
        if (faSneakResult.applies) {
          dmg += faSneakResult.damage;
          addLog?.(`🗡️ ${faSneakResult.reason}: +${faSneakResult.damage} damage!`, 'damage');
        }

        // Clear 'feinted' condition after the first hit (it only applies to one attack)
        const preFightConds = currentTarget.conditions || [];
        const postHitConds = preFightConds.filter(c => c.id !== 'feinted');
        const feintConsumed = postHitConds.length < preFightConds.length;

        const newHP = Math.max(0, currentTarget.currentHP - dmg);
        setCombat?.((prev) => {
          const withEnemy = {
            ...prev,
            enemies: prev.enemies.map((e) =>
              e.id === currentTarget.id ? { ...e, currentHP: newHP, conditions: postHitConds } : e
            ),
          };
          return mergeObservation(withEnemy, currentTarget.id, (o) =>
            narrowAcFromAttack(o, totalAtk, { hit: true, natural: attackRoll, targetAC }));
        });
        currentTarget = { ...currentTarget, currentHP: newHP, conditions: postHitConds };
        if (feintConsumed) addLog?.(`${currentTarget.name} is no longer feinted`, 'info');

        const prefix = critConfirmed ? '💥 CRITICAL! ' : '';
        addLog?.(`${prefix}Attack ${i + 1} hits ${currentTarget.name} for ${dmg} dmg!`, critConfirmed ? 'critical' : 'damage');
        addLog?.(`(${attackRoll}+${bab + atkMod + iterativePenalty + profPenalty + armorAtkPenalty + condAtkMod + iterRacialAtk.total + classAtkBonus}=${totalAtk} vs AC ${targetAC})`, 'info');

        if (newHP <= 0) {
          addLog?.(`${currentTarget.name} falls!`, 'success');
          const remaining = enemies.filter(e => e.id !== currentTarget.id && e.currentHP > 0);
          if (remaining.length === 0) { endCombat?.(true); return; }
        }
      } else {
        addLog?.(
          `${isFumble ? '💢 Natural 1! ' : ''}Attack ${i + 1} ${isFumble ? 'fumbles!' : 'misses.'}`,
          isFumble ? 'fumble' : 'danger'
        );
        addLog?.(`(${attackRoll}+${bab + atkMod + iterativePenalty + profPenalty + armorAtkPenalty + condAtkMod + iterRacialAtk.total + classAtkBonus}=${totalAtk} vs AC ${targetAC})`, 'info');
        setCombat?.((prev) => mergeObservation(prev, currentTarget.id, (o) =>
          narrowAcFromAttack(o, totalAtk, { hit: false, natural: attackRoll })));
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

    // Condition + active effect checks
    const condMods = getCharacterModifiers(attacker, worldState);
    if (condMods.cannotAct) { addLog?.(`${attacker.name} cannot act — incapacitated!`, 'danger'); return; }
    if (condMods.cannotAttack) { addLog?.(`${attacker.name} cannot attack this round!`, 'danger'); return; }
    if (condMods.cannotCharge) { addLog?.(`${attacker.name} cannot charge in this condition!`, 'danger'); return; }

    const weapon = getActiveWeapon(attacker);
    const { dice, sides } = parseWeaponDamage(weapon.dmg);
    const { threatRange, multiplier } = parseCritical(weapon.crit);
    const { mod: atkMod } = getAttackAbilityMod(attacker, weapon);
    const dmgMod = getDamageMod(attacker, weapon);

    // Proficiency penalties
    const profCheck = checkWeaponProficiency(attacker, weapon.name);
    const profPenalty = profCheck.penalty;
    const armorProf = checkArmorProficiency(attacker, attacker.armor);
    const armorAtkPenalty = armorProf.proficient ? 0 : armorProf.penalty;
    const condAtkMod = condMods.attack || 0;

    // Miss chance
    if (condMods.missChance > 0) {
      const missRoll = roll(100);
      if (missRoll <= condMods.missChance) {
        addLog?.(`${attacker.name} charges but misses (${condMods.missChance}% miss chance, rolled ${missRoll})!`, 'danger');
        setTurnActions({ standard: true, move: true, fullRound: true, swift: turnActions.swift });
        endPlayerTurn();
        return;
      }
    }

    // Racial attack bonuses
    const racialAtk = getRacialAttackBonuses(attacker, weapon, target);
    if (racialAtk.hatredBonus) addLog?.(`⚔️ Hatred: +${racialAtk.hatredBonus} attack vs ${(target.type || 'enemy').toLowerCase()}`, 'info');

    // Class passive bonuses
    const classPassives = getPassiveClassModifiers(attacker);
    const classAtkBonus = classPassives.attack || 0;
    const classDmgBonus = classPassives.damage || 0;

    const attackRoll = roll(20);
    const bab = attacker.bab || 0;
    const chargeBonus = 2;
    const totalAtk = attackRoll + bab + atkMod + chargeBonus + profPenalty + armorAtkPenalty + condAtkMod + racialAtk.total + classAtkBonus;
    const targetAC = target.ac || 12;

    addLog?.(`${attacker.name} charges at ${target.name} with ${weapon.name}! (+2 attack, -2 AC until next turn)`, 'action');

    const isCrit = attackRoll >= threatRange;
    const isFumble = attackRoll === 1;
    const hit = isFumble ? false : (isCrit || totalAtk >= targetAC);

    if (isCrit) {
      addLog?.(`🎯 Natural ${attackRoll}! Charge threatens a critical hit!`, 'critical');
    }

    if (hit) {
      let dmg = Math.max(1, rollDice(dice, sides).total + dmgMod + classDmgBonus);
      let chargeCritConfirmed = false;
      if (isCrit) {
        const confirmRoll = roll(20) + bab + atkMod + chargeBonus + profPenalty + armorAtkPenalty + condAtkMod + racialAtk.total + classAtkBonus;
        if (confirmRoll >= targetAC) {
          chargeCritConfirmed = true;
          dmg = Math.max(1, rollDice(dice * multiplier, sides).total + (dmgMod + classDmgBonus) * multiplier);
        }
      }
      // Sneak attack — check conditions on target for denied DEX (feinted, blinded, etc.)
      const chgTargetCondMods = aggregateConditionModifiers(target.conditions || []);
      const chgSneakCtx = {
        isFlanking: attacker.isFlanking || condMods.flanking,
        targetDeniedDex: target.flatFooted || target.deniedDex || chgTargetCondMods.loseDexToAC,
        targetType: target.type || target.creatureType || '',
        isRanged: false, // Charge is always melee
      };
      const chgSneakResult = computeSneakAttackDamage(attacker, chgSneakCtx);
      if (chgSneakResult.applies) {
        dmg += chgSneakResult.damage;
        addLog?.(`🗡️ ${chgSneakResult.reason}: +${chgSneakResult.damage} damage!`, 'damage');
      }
      // Clear 'feinted' condition after hit (one attack only)
      const chgUpdatedConds = (target.conditions || []).filter(c => c.id !== 'feinted');
      const chgFeintCleared = chgUpdatedConds.length < (target.conditions || []).length;
      const newHP = Math.max(0, target.currentHP - dmg);
      setCombat?.((prev) => {
        const withEnemy = {
          ...prev,
          enemies: prev.enemies.map((e) =>
            e.id === targetId ? { ...e, currentHP: newHP, conditions: chgUpdatedConds } : e
          ),
        };
        return mergeObservation(withEnemy, targetId, (o) =>
          narrowAcFromAttack(o, totalAtk, { hit: true, natural: attackRoll, targetAC }));
      });
      if (chgFeintCleared) addLog?.(`${target.name} is no longer feinted`, 'info');
      addLog?.(
        `${chargeCritConfirmed ? '💥 CRITICAL! ' : ''}The charge connects! ${dmg} damage!`,
        chargeCritConfirmed ? 'critical' : 'damage'
      );
      addLog?.(`(${attackRoll}+${bab + atkMod + chargeBonus + profPenalty + armorAtkPenalty + condAtkMod + racialAtk.total + classAtkBonus}=${totalAtk} vs AC ${targetAC})`, 'info');
      if (newHP <= 0) {
        addLog?.(`${target.name} is destroyed by the charge!`, 'success');
        if (enemies.filter(e => e.id !== targetId && e.currentHP > 0).length === 0) { endCombat?.(true); return; }
      }
    } else {
      addLog?.(
        `${isFumble ? '💢 Natural 1! ' : ''}The charge ${isFumble ? 'goes wildly off course!' : 'misses!'}`,
        isFumble ? 'fumble' : 'danger'
      );
      addLog?.(`(${attackRoll}+${bab + atkMod + chargeBonus + profPenalty + armorAtkPenalty + condAtkMod + racialAtk.total + classAtkBonus}=${totalAtk} vs AC ${targetAC})`, 'info');
      setCombat?.((prev) => mergeObservation(prev, targetId, (o) =>
        narrowAcFromAttack(o, totalAtk, { hit: false, natural: attackRoll })));
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

  // ── Player Skill Check (CRB Ch. 4) ──
  // mode: 'roll' | 'take10' | 'take20'
  const handleSkillCheckRoll = (skillName, mode) => {
    const pc = party.find(p => p.id === currentCombatant?.id);
    if (!pc) return;
    const aliveEnemies = (combat.enemies || []).filter(e => e.currentHP > 0);
    const situation = {
      inCombat: true,
      threatened: aliveEnemies.length > 0,
      // In real combat, time is short — Take 20 should fail unless the player explicitly says otherwise
      timeLimit: true,
    };
    let result;
    if (mode === 'take10') {
      result = dmEngine.take10SkillCheck(pc, skillName, situation, worldState);
    } else if (mode === 'take20') {
      result = dmEngine.take20SkillCheck(pc, skillName, situation, worldState);
    } else {
      result = dmEngine.resolveSkillCheck(pc, skillName, null, situation, worldState);
    }
    if (!result || result.canUse === false) {
      const reason = result?.reason || 'check not allowed';
      const label = mode === 'take10' ? 'Take 10' : mode === 'take20' ? 'Take 20' : 'roll';
      addLog?.(`${pc.name} cannot ${label} on ${skillName}: ${reason}`, 'warning');
      return;
    }
    const tag = mode === 'take10' ? ' (Take 10)' : mode === 'take20' ? ' (Take 20)' : '';
    // NWN-style outcome coloring: green on success, red on failure.
    // Unopposed / DC-less checks fall back to 'roll' so they don't look like
    // a failure.
    const hasDC = typeof result.dc === 'number';
    const rollType = hasDC ? (result.success ? 'success' : 'danger') : 'roll';
    addLog?.(`🎲 ${pc.name} ${skillName}${tag}: ${result.breakdown}`, rollType);
    setShowSkillMenu(false);
  };

  // ── Feint (Bluff, standard action) — CRB pp. 92, 201 ──
  const handleFeint = (targetId) => {
    const pc = party.find(p => p.id === currentCombatant?.id);
    if (!pc) return;
    const target = (combat.enemies || []).find(e => e.id === targetId);
    if (!target) return;

    const result = dmEngine.resolveCombatFeint(pc, target);
    if (result.canUse === false) {
      addLog?.(`${pc.name} cannot feint: ${result.breakdown || 'check not allowed'}`, 'warning');
      return;
    }
    addLog?.(`🎭 ${result.breakdown}`, result.success ? 'success' : 'danger');

    if (result.success) {
      // Apply 'feinted' condition to target (denied Dex to AC, duration 1 round)
      const cond = createCondition('feinted', {
        duration: 1,
        source: `${pc.name} feint`,
      });
      if (cond) {
        setCombat?.(prev => ({
          ...prev,
          enemies: prev.enemies.map(e => {
            if (e.id !== targetId) return e;
            return { ...e, conditions: [...(e.conditions || []), cond] };
          }),
        }));
        addLog?.(`${target.name} is denied DEX bonus to AC until ${pc.name}'s next attack`, 'success');
      }
    }

    // Improved Feint: feint as a move action (CRB). Otherwise standard action.
    const hasImprovedFeint = pc.feats?.some(f =>
      (f.name || f) === 'Improved Feint' || (f.name || f) === 'improved feint'
    );
    if (hasImprovedFeint) {
      setTurnActions(prev => ({ ...prev, move: true }));
      if (turnActions.standard) endPlayerTurn();
    } else {
      setTurnActions(prev => ({ ...prev, standard: true }));
      if (turnActions.move) endPlayerTurn();
    }
  };

  // ── Helper: fold PC-forced saves against enemies into combat.observed ──
  // saveResults come from resolveSpellEffect; any whose targetId is an enemy
  // tells the party something about that enemy's effective save at this DC.
  // We group by enemy id so a single mergeObservation per enemy suffices.
  const recordEnemySavesFromSpellResult = (saveResults) => {
    if (!Array.isArray(saveResults) || saveResults.length === 0) return;
    const eventsByEnemy = new Map();
    for (const sr of saveResults) {
      if (!sr?.targetId) continue;
      // Skip PC targets — this helper only records observations about enemies.
      if (party.some(p => p.id === sr.targetId)) continue;
      const key = String(sr.saveType || '').toLowerCase();
      const save = key.startsWith('fort') ? 'fort'
        : key.startsWith('ref') ? 'ref'
        : key.startsWith('will') ? 'will' : null;
      if (!save) continue;
      const list = eventsByEnemy.get(sr.targetId) || [];
      // 'enemy-save' kind — this enemy's save result vs a PC DC. Distinct
      // bucket from party-side saves (which go to 'save' from enemy turns).
      list.push({ kind: 'enemy-save', save, passed: !!sr.passed });
      eventsByEnemy.set(sr.targetId, list);
    }
    if (eventsByEnemy.size === 0) return;
    setCombat?.((prev) => {
      let next = prev;
      for (const [enemyId, events] of eventsByEnemy) {
        next = mergeObservation(next, enemyId, (o) => applyObservationEvents(o, events));
      }
      return next;
    });
  };

  // ── Player Spell Casting ──
  const handleCastSpell = (spellName, targetEntity) => {
    const pc = party.find(p => p.id === currentCombatant?.id);
    if (!pc) return;

    const className = pc.class;
    const castAbility = getCastingAbility(className);
    if (!castAbility) {
      addLog?.(`${pc.name} is not a spellcaster!`, 'warning');
      return;
    }

    // Find the spell in DB
    const spell = spellsData.find(s => s.name.toLowerCase() === spellName.toLowerCase());
    if (!spell) {
      addLog?.(`Unknown spell: ${spellName}`, 'warning');
      return;
    }

    const spellLevel = getSpellLevelForClass(spell, className);
    if (spellLevel === null) {
      addLog?.(`${spellName} is not on the ${className} spell list!`, 'warning');
      return;
    }

    // Run the full validation pipeline (conditions + active spell effects)
    const condMods = getCharacterModifiers(pc, worldState);
    const condNames = (pc.conditions || []).map(c => (c.name || c.id || '').toLowerCase());

    // Phase 7.6 — familiar touch-delivery narration (CRB p. 83).
    // Applies only when the caster has a living, in-range familiar, the
    // toggle is on, and the spell actually has a touch range.
    const spellIsTouch = (spell.range || '').toLowerCase().includes('touch');
    const famEntry = pc.familiar && pc.familiar.id && pc.familiar.status !== 'lost' && pc.familiar.status !== 'ritualInProgress'
      ? getFamiliarById(pc.familiar.id)
      : null;
    const famInRange = famEntry && isFamiliarInRange(pc, worldState);
    const willDeliverViaFamiliar = deliverTouchViaFamiliar && spellIsTouch && famInRange;
    if (deliverTouchViaFamiliar && spellIsTouch && !famInRange) {
      addLog?.(`${pc.name}'s ${famEntry?.name || 'familiar'} is out of range — touch delivery unavailable.`, 'warning');
    }

    const castResult = resolveSpellCasting(pc, spellName, {
      target: targetEntity,
      conditionMods: condMods,
      conditionNames: condNames,
      castDefensively: false, // Could add a toggle for this
    });

    // Log all pipeline steps
    for (const step of castResult.steps) {
      addLog?.(
        `[${step.step}] ${step.detail}`,
        step.passed ? 'info' : 'danger'
      );
    }

    // Consume the spell slot if needed
    if (castResult.slotConsumed) {
      setParty?.(prev => prev.map(p => {
        if (p.id !== pc.id) return p;
        return {
          ...p,
          spellSlotsUsed: {
            ...(p.spellSlotsUsed || {}),
            [String(castResult.spellLevel)]: (p.spellSlotsUsed?.[String(castResult.spellLevel)] || 0) + 1,
          },
        };
      }));
    }

    // If the spell didn't succeed (fizzle, concentration fail, SR block), stop here
    if (!castResult.success) {
      addLog?.(`${pc.name}'s ${spellName} fails: ${castResult.reason}`, 'danger');
      setTurnActions(prev => ({ ...prev, standard: true }));
      setShowSpellMenu(false);
      return;
    }

    // Phase 7.6 — narrate familiar delivery if applicable. The mechanical
    // touch attack is still resolved in resolveSpellEffect; this is the
    // flavor line that signals the familiar is the point of contact.
    if (willDeliverViaFamiliar) {
      addLog?.(`${famEntry.name} scurries forth and delivers ${spellName} to ${targetEntity?.name || 'the target'}.`, 'success');
    }

    // Spell succeeded — resolve effects
    const targets = targetEntity ? [targetEntity] : [];
    const effectResult = resolveSpellEffect(spellName, pc, targets, {
      spellDC: castResult.spellDC || 15,
      spellLevel: castResult.spellLevel,
      casterLevel: pc.level || 1,
      school: spell.school || '',
      descriptors: spell.descriptors || [],
    });

    // Log effect messages
    for (const msg of effectResult.messages) {
      addLog?.(msg.text, msg.type);
    }

    // Record save outcomes on enemy observations — a PC's spell that forces
    // an enemy's save teaches the party about that enemy's effective saves.
    recordEnemySavesFromSpellResult(effectResult.saveResults);

    // Apply HP changes
    for (const [targetId, hpDelta] of Object.entries(effectResult.hpChanges)) {
      updateCharHP?.(targetId, -hpDelta); // Positive hpDelta = damage, negative = healing
    }

    // Apply conditions
    for (const condApp of effectResult.conditionsToApply) {
      const cond = createCondition(condApp.condition, {
        duration: condApp.duration,
        source: condApp.source || spellName,
        customMods: condApp.customMods,
      });
      if (!cond) continue;

      // Check if target is a party member or enemy
      const isPC = party.some(p => p.id === condApp.targetId);
      if (isPC) {
        setParty?.(prev => prev.map(p => {
          if (p.id !== condApp.targetId) return p;
          return { ...p, conditions: [...(p.conditions || []), cond] };
        }));
      } else {
        setCombat?.(prev => ({
          ...prev,
          enemies: prev.enemies.map(e => {
            if (e.id !== condApp.targetId) return e;
            return { ...e, conditions: [...(e.conditions || []), cond] };
          }),
        }));
      }
    }

    // Remove conditions (e.g., Heal removes exhausted, etc.)
    for (const condRem of effectResult.conditionsToRemove) {
      const isPC = party.some(p => p.id === condRem.targetId);
      if (isPC) {
        setParty?.(prev => prev.map(p => {
          if (p.id !== condRem.targetId) return p;
          return {
            ...p,
            conditions: (p.conditions || []).filter(c =>
              c.id !== condRem.conditionId && c.name?.toLowerCase() !== condRem.conditionId.toLowerCase()
            ),
          };
        }));
      }
    }

    // Apply active effects (buffs/debuffs that aren't named conditions)
    for (const eff of effectResult.activeEffects) {
      const activeEff = createActiveEffect(eff);
      const isPC = party.some(p => p.id === eff.targetId);
      if (isPC) {
        setParty?.(prev => prev.map(p => {
          if (p.id !== eff.targetId) return p;
          return { ...p, activeEffects: [...(p.activeEffects || []), activeEff] };
        }));
      } else {
        setCombat?.(prev => ({
          ...prev,
          enemies: prev.enemies.map(e => {
            if (e.id !== eff.targetId) return e;
            return { ...e, activeEffects: [...(e.activeEffects || []), activeEff] };
          }),
        }));
      }
    }

    // If the spell had no structured data, note it for the AI DM
    if (!effectResult.resolved) {
      addLog?.(`(${spellName} effects will be narrated by the DM)`, 'info');
    }

    // Spend the standard action
    setTurnActions(prev => ({ ...prev, standard: true }));
    setShowSpellMenu(false);
  };

  // ── Cast Racial Spell-Like Ability ──
  const handleCastSLA = (slaIndex, targetEntity) => {
    const pc = party.find(p => p.id === currentCombatant?.id);
    if (!pc) return;
    const slaList = pc.racialSpellLikeAbilities || [];
    const sla = slaList[slaIndex];
    if (!sla) return;

    if (sla.usesRemaining <= 0) {
      addLog?.(`${pc.name} has already used ${sla.name} today!`, 'warning');
      return;
    }

    // Deduct use
    setParty?.(prev => prev.map(p => {
      if (p.id !== pc.id) return p;
      const updatedSLAs = [...(p.racialSpellLikeAbilities || [])];
      updatedSLAs[slaIndex] = { ...updatedSLAs[slaIndex], usesRemaining: updatedSLAs[slaIndex].usesRemaining - 1 };
      return { ...p, racialSpellLikeAbilities: updatedSLAs };
    }));

    const dc = computeSLADC(pc, sla);
    const cl = sla.casterLevel === 'character' ? (pc.level || 1) : (sla.casterLevel || 1);

    addLog?.(`${pc.name} uses ${sla.name} (CL ${cl}${dc ? `, DC ${dc}` : ''})!`, 'action');

    // Try to resolve the SLA through the spell effect system
    const targets = targetEntity ? [targetEntity] : [];
    const effectResult = resolveSpellEffect(sla.name, pc, targets, {
      spellDC: dc || 15,
      spellLevel: sla.spellLevel || 0,
      casterLevel: cl,
      school: sla.school || '',
    });

    for (const msg of effectResult.messages) {
      addLog?.(msg.text, msg.type);
    }

    // Record save outcomes on enemy observations — same pattern as handleCastSpell.
    recordEnemySavesFromSpellResult(effectResult.saveResults);

    // Apply HP changes
    // Phase 7.6 — route PC updates through updateCharHP so heals cap at
    // getEffectiveMaxHP (base + in-range familiar bonus). Enemy heals cap
    // at the enemy's own max HP so SLA self-heals don't overshoot.
    for (const [targetId, hpDelta] of Object.entries(effectResult.hpChanges)) {
      const isPC = party.some(p => p.id === targetId);
      if (isPC) {
        updateCharHP?.(targetId, -hpDelta); // Positive hpDelta = damage, negative = healing
      } else {
        setCombat?.(prev => ({
          ...prev,
          enemies: prev.enemies.map(e => {
            if (e.id !== targetId) return e;
            const enemyMax = e.maxHP || e.hp || e.currentHP || 0;
            const raw = (e.currentHP ?? e.hp ?? 0) - hpDelta;
            const clamped = Math.max(0, Math.min(enemyMax, raw));
            return { ...e, currentHP: clamped };
          }),
        }));
      }
    }

    // Apply conditions
    for (const condApp of effectResult.conditionsToApply) {
      const cond = createCondition(condApp.condition, condApp.duration, condApp.source);
      const isPC = party.some(p => p.id === condApp.targetId);
      if (isPC) {
        setParty?.(prev => prev.map(p => p.id === condApp.targetId ? { ...p, conditions: [...(p.conditions || []), cond] } : p));
      } else {
        setCombat?.(prev => ({
          ...prev,
          enemies: prev.enemies.map(e => e.id === condApp.targetId ? { ...e, activeConditions: [...(e.activeConditions || []), cond] } : e),
        }));
      }
    }

    if (!effectResult.resolved) {
      addLog?.(`(${sla.name} effects will be narrated by the DM)`, 'info');
    }

    setTurnActions(prev => ({ ...prev, standard: true }));
    setShowSpellMenu(false);
  };

  // ── End Player Turn ──
  const endPlayerTurn = () => {
    // Orc Ferocity: if active, PC drops to -1 HP and is dying at end of their turn (PF1e CRB)
    const attacker = party.find(p => p.id === currentCombatant?.id);
    if (attacker?.orcFerocityActive) {
      addLog?.(`💀 ${attacker.name}'s Orc Ferocity ends — they collapse to -1 HP and are dying!`, 'danger');
      setParty?.(prev => prev.map(p => {
        if (p.id !== attacker.id) return p;
        return {
          ...p,
          currentHP: -1,
          orcFerocityActive: false,
          conditions: [...(p.conditions || []).filter(c => c.id !== 'disabled'),
            { id: 'dying', name: 'Dying', duration: -1 }],
        };
      }));
    }
    setTurnActions({ standard: false, move: false, fullRound: false, swift: false });
    setShowActionMenu(false);
    nextTurn();
  };

  // ── Shared HP-change router (Phase C.1) ──
  // Acting-side-agnostic: routes a single {targetId, damage} entry from an
  // executeEnemyTurn result to whichever collection contains the target id.
  // - PCs keep the full updateCharHP path (class-feature DR + -CON floor +
  //   HP-bucket narration via App.jsx's prev-snapshot effect).
  // - Allies route through setCombat + combat.allies; floor at 0 HP because
  //   monster-shaped ally entries don't carry PF1e bleeding-out mechanics
  //   (Phase E will revisit KO handling + narrative ally-KO logs).
  // - Enemies route through setCombat + combat.enemies; same 0-HP floor.
  //   This branch is load-bearing for Phase C.1 — an ally's attack emits
  //   hpChanges keyed to an enemy id, and we need to actually apply it.
  //
  // Damage sign convention (matches executeEnemyTurn output):
  //   damage > 0 → deal damage | damage < 0 → heal (|-damage| HP)
  //
  // Unknown target ids are dropped silently — same behavior as pre-Phase-B
  // when an enemy somehow targeted a stale id. Keep this permissive: a
  // noisy branch here would mask upstream id-mismatch bugs but also block
  // legit late-turn removals (e.g. fled enemies whose ids stayed in
  // hpChanges from the same-turn attack resolver).
  const applyHpChange = (targetId, damage) => {
    const targetPC = party.find(p => p.id === targetId);
    const targetAlly = !targetPC ? allies.find(a => a.id === targetId) : null;
    const targetEnemy = (!targetPC && !targetAlly) ? enemies.find(e => e.id === targetId) : null;

    if (damage < 0) {
      // Heal path — symmetric across all three collections.
      const heal = -damage;
      if (targetPC) {
        updateCharHP?.(targetId, heal);
      } else if (targetAlly) {
        setCombat?.(prev => ({
          ...prev,
          allies: (prev.allies || []).map(a =>
            a.id === targetId
              // Cap: prefer a.maxHP, fall back to a.hp (injectTestAlly
              // shape uses `hp` as max), finally fall back to current+heal
              // (summon-shape without either field still heals cleanly).
              ? { ...a, currentHP: Math.min(a.maxHP ?? a.hp ?? a.currentHP + heal, a.currentHP + heal) }
              : a
          ),
        }));
      } else if (targetEnemy) {
        setCombat?.(prev => ({
          ...prev,
          enemies: prev.enemies.map(e =>
            e.id === targetId
              ? { ...e, currentHP: Math.min(e.maxHP ?? e.hp ?? e.currentHP + heal, e.currentHP + heal) }
              : e
          ),
        }));
      }
      return;
    }

    // Damage path.
    if (targetPC) {
      // PF1e class-feature DR — PCs only. Monsters have DR on the stat
      // block (tracked differently); allies spawned from an NPC may be
      // class-shaped in Phase F but for now DR is exclusively a PC path.
      let finalDmg = damage;
      if (targetPC.class) {
        try {
          const pcPassives = getPassiveClassModifiers(targetPC);
          if (pcPassives.dr && pcPassives.dr.amount > 0) {
            const drReduced = Math.min(pcPassives.dr.amount, finalDmg);
            finalDmg = Math.max(0, finalDmg - drReduced);
            if (drReduced > 0) {
              addLog?.(`DR ${pcPassives.dr.amount}${pcPassives.dr.type}: ${targetPC.name} absorbs ${drReduced} damage`, 'success');
            }
          }
        } catch (e) { /* safety net — class-feature resolution should never block a hit */ }
      }
      if (finalDmg > 0) {
        updateCharHP?.(targetId, -finalDmg);
      }
    } else if (targetAlly) {
      // Phase E: emit narrative ally-KO log when an ally transitions from
      // alive to 0 HP. Ally NPCs don't carry PF1e bleeding-out (no dying /
      // disabled / -CON floor) — they drop at 0 and stay there until healed
      // or combat ends. The log line gives the table the same narrative
      // beat enemies get when they fall. Check uses pre-damage currentHP
      // read from the closure so it's correct even under batched setCombat.
      const preHP = targetAlly.currentHP ?? 0;
      const postHP = Math.max(0, preHP - damage);
      if (preHP > 0 && postHP <= 0) {
        addLog?.(`${targetAlly.name} falls!`, 'danger');
      }
      setCombat?.(prev => ({
        ...prev,
        allies: (prev.allies || []).map(a =>
          a.id === targetId ? { ...a, currentHP: Math.max(0, a.currentHP - damage) } : a
        ),
      }));
    } else if (targetEnemy) {
      setCombat?.(prev => ({
        ...prev,
        enemies: prev.enemies.map(e =>
          e.id === targetId ? { ...e, currentHP: Math.max(0, e.currentHP - damage) } : e
        ),
      }));
    }
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

    // Build combat state for the AI.
    // Phase B (Ally-NPC): pass `allies` so creatureAI's target pool unions
    // party + allies and enemies can actually engage ally combatants. The
    // downstream code (creatureAI.executeEnemyTurn:748) normalizes to
    // `[]` when the key is absent, so pre-Phase-B builds stay green.
    const combatState = {
      round: combat.round || 1,
      directives,
      allies,
    };

    const result = executeEnemyTurn(activeEnemy, party, aliveEnemies, combatState);

    // Fold the turn's observation events into combat.observed[activeEnemy.id].
    // All events from one executeEnemyTurn call belong to the acting enemy.
    if (result.observationEvents?.length) {
      setCombat?.((prev) => mergeObservation(prev, activeEnemy.id, (o) =>
        applyObservationEvents(o, result.observationEvents)));
    }

    // Log all results (skip debug entries in production)
    for (const entry of result.results) {
      if (entry.type === 'debug') continue; // Hide AI reasoning from player
      addLog?.(entry.text, entry.type);
    }

    // Apply HP changes via the shared applyHpChange helper (Phase C.1).
    // Enemy targets hit PCs + allies; healing applied symmetrically.
    // Phase C.1 made this acting-side-agnostic so the same loop serves
    // handleAllyTurn without duplication.
    for (const [targetId, damage] of Object.entries(result.hpChanges)) {
      applyHpChange(targetId, damage);
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
            addLog?.(`${target.name} is now ${cond.name}!`, 'danger');
          }
        }
      }
    }

    // Apply active spell effects to party members (from enemy spells like debuffs/buffs)
    if (result.activeEffectsToApply?.length > 0) {
      setParty?.(prev => prev.map(p => {
        const effects = result.activeEffectsToApply.filter(e => e.targetId === p.id);
        if (effects.length === 0) return p;
        const existing = p.activeEffects || [];
        return { ...p, activeEffects: [...existing, ...effects.map(e => e.effect)] };
      }));
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

    // Orc Ferocity (PF1e CRB): Half-Orc/Orc at 0 or below HP can fight 1 more round, 1/day
    for (const pc of party) {
      const dmgTaken = result.hpChanges[pc.id] || 0;
      if (dmgTaken > 0) {
        const effectiveHP = pc.currentHP - dmgTaken;
        const hasFerocity = (pc.traits || []).some(t => /Orc Ferocity/i.test(t));
        const con = pc.abilities?.CON || 10;
        // Triggers at 0 or below but not dead (below -CON)
        if (hasFerocity && !pc.orcFerocityUsed && effectiveHP <= 0 && effectiveHP > -con) {
          addLog?.(`🔥 ${pc.name} activates Orc Ferocity! They fight on at 0 HP for one more round!`, 'warning');
          // Set HP to 0 (disabled but alive), mark ferocity used, add disabled condition
          setParty?.(prev => prev.map(p => {
            if (p.id !== pc.id) return p;
            return {
              ...p,
              currentHP: 0,
              orcFerocityUsed: true,
              orcFerocityActive: true, // will drop to -1 and dying at end of their next turn
              conditions: [...(p.conditions || []), { id: 'disabled', name: 'Disabled (Orc Ferocity)', duration: 1 }],
            };
          }));
        }
      }
    }

    // Check if all PCs are down
    const remainingPCs = party.filter(p => p.currentHP > 0);
    // Need to account for damage just dealt — also account for Orc Ferocity keeping PCs at 0
    const pcsStillUp = party.filter(p => {
      const dmgTaken = result.hpChanges[p.id] || 0;
      const effectiveHP = p.currentHP - dmgTaken;
      const hasFerocity = (p.traits || []).some(t => /Orc Ferocity/i.test(t));
      // PC is still up if: HP > 0, OR Orc Ferocity just triggered (at 0 but fighting)
      if (effectiveHP > 0) return true;
      if (hasFerocity && !p.orcFerocityUsed && effectiveHP <= 0 && effectiveHP > -(p.abilities?.CON || 10)) return true;
      return false;
    });
    if (pcsStillUp.length === 0) {
      // Phase E: defeat check now accounts for allies. If PCs are all down
      // but allies are still standing, the fight isn't over — the ally (or
      // allies) can still act on their own turns. Only trigger the loss
      // end-state when BOTH the party AND its allies are fully down.
      // alliesStillUp accounts for damage applied this turn to any ally by
      // checking the combat.allies snapshot post-hpChanges application.
      const alliesStillUp = (allies || []).filter(a => {
        // Enemy's hpChanges may include ally damage (enemy targeted ally
        // via Phase B pool union). Subtract the pending damage from the
        // pre-turn snapshot to get the effective state.
        const dmgTaken = result.hpChanges[a.id] || 0;
        const effectiveHP = (a.currentHP ?? 0) - Math.max(0, dmgTaken);
        return effectiveHP > 0;
      });
      if (alliesStillUp.length === 0) {
        addLog?.('The party has fallen...', 'danger');
        endCombat?.(false);
        return;
      }
      // PCs down, allies up — narrative beat + continue combat.
      const allyNames = alliesStillUp.map(a => a.name).join(', ');
      addLog?.(`The party has fallen, but ${allyNames} fights on!`, 'warning');
    }

    nextTurn();
  };

  // ── Ally Turn (Phase C.1 — controlMode='ai' branch) ──
  // Ally acts AS IF it were an enemy — calls executeEnemyTurn with the
  // target pool inverted:
  //   - `party` param     → alive enemies (the ally's targets)
  //   - `allEnemies` param → alive allies (the ally's teammates, used by
  //     coordinateGroupTactics for flanking/focus-fire directives)
  //   - `combatState.allies` → [] (ally should NOT target its own side;
  //     the pool-union line in creatureAI.js:757 would otherwise fold
  //     teammates back into the target list)
  //
  // Why re-use executeEnemyTurn instead of writing a parallel allyTurn:
  // the Utility AI's utility math (morale, cunning, tier, target scoring,
  // breath-weapon recharge, full-attack iteratives, spell routing) is
  // exactly what an NPC ally should do. Allies are just enemy-shaped
  // actors on the opposite side; the only real difference is which
  // collection their attacks land in, which is what applyHpChange
  // already abstracts.
  //
  // Scope exclusions (tracked in Phase C.3/C.4/D/E):
  //   - controlMode='gm' / 'player' still auto-pass (wired below)
  //   - observation events skipped for now — Phase D will integrate
  //     role='ally' so the party distills ally stats on combat start/end
  //   - fled/surrendered skipped: allies don't flee the party
  //   - no Orc Ferocity check (PC-only path)
  const handleAllyTurn = () => {
    const activeAlly = allies.find(a => a.id === currentCombatant?.id && a.currentHP > 0);
    if (!activeAlly) {
      nextTurn();
      return;
    }

    const aliveEnemies = enemies.filter(e => e.currentHP > 0);
    const aliveAllies = allies.filter(a => a.currentHP > 0);

    // No enemies left — ally holds action (shouldn't happen in practice
    // because nextTurn's defeat check would have fired, but guard anyway).
    if (aliveEnemies.length === 0) {
      addLog?.(`${activeAlly.name} has no valid targets.`, 'info');
      nextTurn();
      return;
    }

    // Auto-detect and apply behavior preset if not already set (same
    // seam as handleEnemyTurn; the preset library is side-agnostic).
    if (!activeAlly.behaviorPreset) {
      const preset = detectBehaviorPreset(activeAlly);
      if (preset) {
        const enhanced = applyBehaviorPreset(activeAlly, preset);
        Object.assign(activeAlly, enhanced);
      }
    }

    // Coordinate group tactics: allies vs enemies. The utility AI reads
    // `aliveAllies` as the "attacking team" and uses aliveEnemies as the
    // "target pool" for focus-fire directives.
    const directives = coordinateGroupTactics(aliveAllies, aliveEnemies, {
      round: combat.round || 1,
    });

    // Inverted combatState — no `allies` key so creatureAI:757 doesn't
    // re-add the ally's own team to the target pool.
    const combatState = {
      round: combat.round || 1,
      directives,
    };

    const result = executeEnemyTurn(activeAlly, aliveEnemies, aliveAllies, combatState);

    // Log results (skip debug entries — AI reasoning is noise to the
    // player just like on the enemy side).
    for (const entry of result.results) {
      if (entry.type === 'debug') continue;
      addLog?.(entry.text, entry.type);
    }

    // Apply HP changes — same shared router. Enemy branch inside
    // applyHpChange is the load-bearing new path; PC + ally branches
    // also still work (e.g. a healer-ally casting on a PC or another
    // ally would route through the heal path correctly).
    for (const [targetId, damage] of Object.entries(result.hpChanges)) {
      applyHpChange(targetId, damage);
    }

    // Apply conditions emitted by the ally's actions. These are nearly
    // always aimed at enemies (debuffs/immobilizes), but we route to
    // all three sides for symmetry in case an ally cleric casts Bless
    // on a PC in a later pass.
    if (result.conditionsApplied) {
      for (const [targetId, conditionList] of Object.entries(result.conditionsApplied)) {
        const targetEnemy = enemies.find(e => e.id === targetId);
        const targetPC = !targetEnemy ? party.find(p => p.id === targetId) : null;
        const targetAllyCond = (!targetEnemy && !targetPC) ? allies.find(a => a.id === targetId) : null;
        if (targetEnemy) {
          setCombat?.(prev => ({
            ...prev,
            enemies: prev.enemies.map(e => {
              if (e.id !== targetId) return e;
              return { ...e, conditions: [...(e.conditions || []), ...conditionList] };
            }),
          }));
          for (const cond of conditionList) {
            addLog?.(`${targetEnemy.name} is now ${cond.name}!`, 'success');
          }
        } else if (targetPC) {
          setParty?.(prev => prev.map(p => {
            if (p.id !== targetId) return p;
            return { ...p, conditions: [...(p.conditions || []), ...conditionList] };
          }));
          for (const cond of conditionList) {
            addLog?.(`${targetPC.name} is now ${cond.name}!`, 'info');
          }
        } else if (targetAllyCond) {
          setCombat?.(prev => ({
            ...prev,
            allies: (prev.allies || []).map(a => {
              if (a.id !== targetId) return a;
              return { ...a, conditions: [...(a.conditions || []), ...conditionList] };
            }),
          }));
          for (const cond of conditionList) {
            addLog?.(`${targetAllyCond.name} is now ${cond.name}!`, 'info');
          }
        }
      }
    }

    // Check if the ally cleared the last enemy — end combat as victory.
    // Mirror of the handleEnemyTurn defeat check but inverted: we're
    // looking for zero surviving enemies after the turn's damage lands.
    const enemiesStillUp = enemies.filter(e => {
      const dmgTaken = result.hpChanges[e.id] || 0;
      return (e.currentHP - dmgTaken) > 0;
    });
    if (enemiesStillUp.length === 0) {
      endCombat?.(true);
      return;
    }

    nextTurn();
  };

  // ── Phase C.3/C.4: interactive ally actions (Attack / Defend / Pass) ──
  // Handlers invoked from the picker UI when the active ally has
  // controlMode='gm' (Phase C.3) or 'player' (Phase C.4). Each handler
  // advances the turn when done; the auto-advance useEffect is
  // intentionally quiet for gm/player-mode allies so the human's click
  // is the source of truth for turn progression.
  //
  // The gate is `isInteractiveAllyTurn` (union of isGMAllyTurn |
  // isPlayerAllyTurn) — mechanics are identical for both modes. The
  // picker header reflects who's driving (GM vs player) via
  // activeAllyMode.
  //
  // Design notes:
  //   - Attack reuses handleAllyTurn so the utility AI picks targets /
  //     iteratives / action economy exactly as in 'ai' mode. Later phases
  //     (Phase C.5, dependent on Phase F ally stat-block shaper) can add
  //     explicit target selection. For Phase C.3/C.4, the human clicks
  //     Attack and the ally takes its best swing.
  //   - Defend stamps the canonical `total_defense` condition (+4 dodge
  //     AC, cannotAttack) via createCondition — same path PCs use for
  //     their Total Defense action, so AC math benefits immediately.
  //     Duration=1 so tickConditions expires it at the ally's next turn.
  //   - Pass mirrors the prior "holds their action" behavior for the
  //     case when the operator wants the ally idle (e.g., reserving for
  //     a readied-action narrative beat).
  const handleInteractiveAllyAttack = () => {
    if (!isInteractiveAllyTurn) return;
    handleAllyTurn();
  };

  const handleInteractiveAllyDefend = () => {
    if (!isInteractiveAllyTurn || !activeAlly) return;
    const cond = createCondition('total_defense', {
      duration: 1,
      source: activeAllyMode === 'player' ? 'player-ally-defend' : 'gm-ally-defend',
    });
    if (cond) {
      setCombat?.(prev => ({
        ...prev,
        allies: (prev.allies || []).map(a => {
          if (a.id !== activeAlly.id) return a;
          return { ...a, conditions: [...(a.conditions || []), cond] };
        }),
      }));
    }
    addLog?.(`${activeAlly.name} takes total defense (+4 dodge AC until next turn).`, 'action');
    nextTurn();
  };

  const handleInteractiveAllyPass = () => {
    if (!isInteractiveAllyTurn || !activeAlly) return;
    addLog?.(`${activeAlly.name} holds their action.`, 'info');
    nextTurn();
  };

  // ── Auto-advance enemy + ally turns ──
  useEffect(() => {
    if (isEnemyTurn && !isPlayerTurn) {
      enemyTurnTimer.current = setTimeout(() => {
        handleEnemyTurn();
      }, 1200); // 1.2s delay so you can read what's happening
    } else if (isAllyTurn && !isPlayerTurn && !isEnemyTurn) {
      // Phase C.1/C.3/C.4: branch on the ally's controlMode.
      //   'ai'     → runs handleAllyTurn (executeEnemyTurn with inverted pool)
      //   'gm'     → Phase C.3 shipped: picker UI renders; no auto-advance
      //              (GM clicks Attack/Defend/Pass — handlers call nextTurn)
      //   'player' → Phase C.4 shipped: same picker UI renders, header
      //              relabeled "Player control" so the player knows it's
      //              their click; no auto-advance (player drives the turn).
      //              Future Phase C.5 can diverge with explicit target
      //              selection once Phase F wires ally attack stats.
      // Default is 'ai' when controlMode is missing (fresh allies before
      // Phase F's NPC-shaper lands, or pre-Phase-A saves with bare allies).
      const activeAllyEff = allies.find(a => a.id === currentCombatant?.id);
      const mode = activeAllyEff?.controlMode || 'ai';
      if (mode === 'ai') {
        enemyTurnTimer.current = setTimeout(() => {
          handleAllyTurn();
        }, 1200);
      } else if (mode === 'gm' || mode === 'player') {
        // Interactive picker renders in place of the enemy-turn narration.
        // Do NOT set a timeout — the turn advances when the GM or player
        // clicks a button (Attack / Defend / Pass). Leaving auto-advance
        // off here is load-bearing: a fallthrough timer would race the
        // human decision-maker.
      } else {
        // Unknown controlMode — fall through to auto-pass so the turn
        // doesn't wedge. (Current possibilities are ai/gm/player; any
        // future mode should be wired explicitly above.)
        enemyTurnTimer.current = setTimeout(() => {
          addLog?.(`${currentCombatant.name} holds their action.`, 'info');
          nextTurn();
        }, 600);
      }
    }
    return () => {
      if (enemyTurnTimer.current) clearTimeout(enemyTurnTimer.current);
    };
  }, [combat?.currentTurn, combat?.round]);

  // ── GM Debug: inject a test ally into active combat ──
  // Phase A verification hook. Creates a pre-shaped ally object (summoned wolf)
  // and splices it into combat.order at the correct initiative position.
  //
  // Canonical ally shape (locks Finding D from Phase A audit):
  //   id, name, hp (max), currentHP, ac, init, controlMode
  // Matches enemy shape so existing targeting/HP math works without a branch.
  // Phase F: shared ally-spawn helper. Pushes a pre-shaped combat-ally entry
  // into combat.allies and splices the init-order entry via spliceIntoInitiative.
  // Callers build the ally via npcToCombatAlly() or summonToCombatAlly() from
  // ../services/allyFactory. Returns the rolled init so the caller can log it.
  const spawnAllyEntry = (ally, { initBonus = 0, logPrefix = '[GM]' } = {}) => {
    if (!ally || !ally.id) return null;
    const initRoll = roll(20) + (Number.isFinite(initBonus) ? initBonus : 0);
    setCombat?.((prev) => {
      if (!prev) return prev;
      const nextAllies = [...(prev.allies || []), ally];
      const entry = { id: ally.id, name: ally.name, init: initRoll, side: 'ally' };
      const { order: nextOrder, currentTurn: nextCurrentTurn } =
        spliceIntoInitiative(prev.order || [], prev.currentTurn || 0, entry);
      return { ...prev, allies: nextAllies, order: nextOrder, currentTurn: nextCurrentTurn };
    });
    addLog?.(`${logPrefix} ${ally.name} joins the fight (init ${initRoll}).`, 'system');
    return initRoll;
  };

  const injectTestAlly = () => {
    // Phase F: now uses summonToCombatAlly so test allies exercise the
    // same shaping code path production summons take.
    const ally = summonToCombatAlly(
      { name: 'Summoned Wolf', hp: 13, ac: 14, init: 2 },
      {
        currentRound: combat?.round || 1,
        durationRounds: 5,   // Summon Monster I baseline, 1 rnd/level, CL 5 proxy
        controlMode: 'ai',
      },
    );
    if (!ally) return;
    spawnAllyEntry(ally, { initBonus: 2, logPrefix: '[GM test]' });
  };

  /**
   * Phase F: spawn a canonical NPC as a combat ally. Takes the NPC record
   * (encounteredNpcs row shape) plus options for controlMode and optional
   * round-based expiry. No-op if npc is null or missing an id.
   */
  const addNPCAsAlly = (npc, { controlMode = 'ai', expiresAtRound = null } = {}) => {
    const ally = npcToCombatAlly(npc, { controlMode, expiresAtRound });
    if (!ally) return null;
    // NPC init bonus derives from DEX mod on the ally entry.
    return spawnAllyEntry(ally, { initBonus: ally.init || 0, logPrefix: '[GM]' });
  };

  /**
   * Phase F: spawn a summon-spell creature as a combat ally. Wraps
   * summonToCombatAlly and spawnAllyEntry. Duration is in rounds.
   */
  const spawnSummonAlly = (template, { durationRounds, controlMode = 'ai' } = {}) => {
    if (!Number.isFinite(durationRounds) || durationRounds <= 0) return null;
    const ally = summonToCombatAlly(template, {
      currentRound: combat?.round || 1,
      durationRounds,
      controlMode,
    });
    if (!ally) return null;
    return spawnAllyEntry(ally, { initBonus: ally.init || 0, logPrefix: '[Summon]' });
  };

  const nextTurn = () => {
    const order = combat.order || [];
    if (order.length === 0) return;
    let nextIdx = (combat.currentTurn + 1) % order.length;
    const round = combat.round || 1;
    const newRound = nextIdx <= combat.currentTurn ? round + 1 : round;

    // Skip dead combatants (includes allies — Phase A scaffold)
    let checks = 0;
    while (checks < order.length) {
      const c = order[nextIdx];
      if (c && isCombatantAlive(c.id, { party, enemies, allies })) break;
      nextIdx = (nextIdx + 1) % order.length;
      checks++;
    }

    // Phase C.2 — compute expiring allies (summons) at round boundary.
    // Scanned before we update combat state so the filter can be applied
    // atomically in the final setCombat call below. An ally with
    // expiresAtRound <= newRound (finite number) fades when that round
    // begins. Non-summon allies (no expiresAtRound) never expire.
    const expiredAllyIds = (nextIdx === 0 && newRound > round)
      ? (allies || [])
          .filter(a => Number.isFinite(a?.expiresAtRound) && a.expiresAtRound <= newRound)
          .map(a => a.id)
      : [];

    if (nextIdx === 0 && newRound > round) {
      addLog?.(`— Round ${newRound} —`, 'system');

      // Emit a fade-away line per expiring ally before tick effects so the
      // log reads "Round N →  X fades  →  conditions tick" in order.
      for (const expId of expiredAllyIds) {
        const expAlly = (allies || []).find(a => a.id === expId);
        if (expAlly) {
          addLog?.(`${expAlly.name} fades away as the summoning ends.`, 'info');
        }
      }

      // Tick conditions AND active effects on all party members at start of new round
      setParty?.(prev => prev.map(p => {
        let updated = p;

        // Tick conditions
        if (p.conditions?.length > 0) {
          const remaining = tickConditions(p.conditions);
          const expired = p.conditions.filter(c => !remaining.some(r => r.id === c.id && r.name === c.name));
          for (const exp of expired) {
            addLog?.(`${p.name} is no longer ${exp.name}.`, 'success');
          }
          updated = { ...updated, conditions: remaining };
        }

        // Tick active spell effects
        if (p.activeEffects?.length > 0) {
          const { effects: remainingEffects, expired: expiredEffects } = tickActiveEffects(p.activeEffects);
          for (const exp of expiredEffects) {
            addLog?.(`${p.name}'s ${exp.name} effect has ended.`, 'info');
          }
          updated = { ...updated, activeEffects: remainingEffects };
        }

        return updated;
      }));

      // Tick conditions AND active effects on enemies
      setCombat?.(prev => ({
        ...prev,
        enemies: prev.enemies.map(e => {
          let updated = e;

          if (e.conditions?.length > 0) {
            const remaining = tickConditions(e.conditions);
            const expired = e.conditions.filter(c => !remaining.some(r => r.id === c.id && r.name === c.name));
            for (const exp of expired) {
              addLog?.(`${e.name} is no longer ${exp.name}.`, 'info');
            }
            updated = { ...updated, conditions: remaining };
          }

          if (e.activeEffects?.length > 0) {
            const { effects: remainingEffects, expired: expiredEffects } = tickActiveEffects(e.activeEffects);
            for (const exp of expiredEffects) {
              addLog?.(`${e.name}'s ${exp.name} effect has ended.`, 'info');
            }
            updated = { ...updated, activeEffects: remainingEffects };
          }

          return updated;
        }),
      }));

      // Task #70c → #79 — advance the world clock by one combat round
      // (6 seconds) at each round boundary, PF1e canonical. Before #79
      // this was ceil-rounded to 1 full minute per round (10× inflation)
      // because advanceWorldTime's old sub-minute handling had a
      // Math.ceil(seconds/60) step. #79 added currentSecond to
      // worldState and lets seconds cascade cleanly into minutes, so a
      // 10-round skirmish now takes 60 sec of world time (not 10 min).
      // Day-change weather regen still fires if a marathon combat
      // straddles midnight.
      if (setWorldState) {
        const { patch, events } = tickClock(worldState, {
          rounds: 1,
          cause: 'combat-round',
        });
        if (Object.keys(patch).length > 0) {
          setWorldState(prev => ({ ...(prev || {}), ...patch }));
          events.forEach(e => addLog?.(e.text, e.type));
        }
      }
    }

    setCombat?.((prev) => {
      const base = { ...prev, currentTurn: nextIdx, round: newRound };
      if (expiredAllyIds.length > 0) {
        const filteredAllies = (prev.allies || []).filter(a => !expiredAllyIds.includes(a.id));
        const filteredOrder = (prev.order || []).filter(o => !(o?.side === 'ally' && expiredAllyIds.includes(o.id)));
        // At round boundary nextIdx === 0, so removing entries from order
        // doesn't shift the pointer — position 0 of the filtered array is
        // still the first combatant to act this round. Defensive clamp in
        // case a future caller expires mid-round.
        const clampedTurn = filteredOrder.length === 0
          ? 0
          : Math.min(nextIdx, filteredOrder.length - 1);
        return { ...base, allies: filteredAllies, order: filteredOrder, currentTurn: clampedTurn };
      }
      return base;
    });
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
          {worldState?.currentWeather && (() => {
            // wind/precipitation may be strings OR objects like { name, ... } — normalize before .includes()
            const w = worldState.currentWeather.wind;
            const p = worldState.currentWeather.precipitation;
            const windStr = (typeof w === 'string' ? w : w?.name || '').toLowerCase();
            const precipStr = (typeof p === 'string' ? p : p?.name || '').toLowerCase();
            const windPenalty = windStr.includes('strong') || windStr.includes('severe') ? ' (ranged -2)' : '';
            const precipPenalty = precipStr.includes('heavy')
              ? ' (Perception -4, ranged -4)'
              : precipStr.includes('rain') || precipStr.includes('snow')
              ? ' (Perception -2, ranged -2)'
              : '';
            return (
              <span style={{ fontSize: '10px', color: '#87ceeb', marginLeft: '12px' }}>
                {worldState.currentWeather.description || 'Clear'}
                {windPenalty}
                {precipPenalty}
              </span>
            );
          })()}
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

        {/* Feint (Bluff check — CRB pp. 92, 201; Improved Feint = move action) */}
        {(() => {
          const pcForFeint = party.find(p => p.id === currentCombatant?.id);
          const improvedFeint = pcForFeint?.feats?.some(f => (f.name || f) === 'Improved Feint' || (f.name || f) === 'improved feint');
          const canFeint = improvedFeint ? canMove : canStandard;
          return canFeint && aliveEnemies.length > 0 ? (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#c9a0dc', marginBottom: '4px' }}>
              Feint (Bluff) {renderActionTag(improvedFeint ? 'move' : 'standard')}
            </div>
            <div style={styles.buttonRow}>
              {aliveEnemies.map((enemy) => (
                <button
                  key={'feint_' + enemy.id}
                  style={{ ...styles.button, borderColor: '#c9a0dc', color: '#c9a0dc' }}
                  onClick={() => handleFeint(enemy.id)}
                >
                  Feint {enemy.name}
                </button>
              ))}
            </div>
          </div>
          ) : null;
        })()}

        {/* Full-round actions */}
        {canFullRound && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#ff6b6b', marginBottom: '4px' }}>
              Full Attack {hasIteratives ? `(${1 + Math.floor((bab - 1) / 5)} attacks)` : '(1 attack)'} {renderActionTag('full-round')}
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

        {/* Spell Casting */}
        {canStandard && getCastingAbility(attacker?.class) && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: '#da70d6', marginBottom: '4px' }}>
              Cast Spell {renderActionTag('standard')}
            </div>
            {!showSpellMenu ? (
              <button
                style={{ ...styles.button, borderColor: '#da70d6', color: '#da70d6' }}
                onClick={() => setShowSpellMenu(true)}
              >
                Open Spellbook
              </button>
            ) : (
              <div style={{ backgroundColor: '#2a1a3e', border: '1px solid #da70d6', borderRadius: '4px', padding: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '10px', color: '#da70d6' }}>Select a spell:</span>
                  <button
                    style={{ fontSize: '9px', background: 'none', border: '1px solid #666', color: '#666', borderRadius: '2px', cursor: 'pointer', padding: '1px 4px' }}
                    onClick={() => setShowSpellMenu(false)}
                  >
                    Close
                  </button>
                </div>
                {/* Phase 7.6 — Deliver Touch Spells via Familiar toggle */}
                {(() => {
                  const famId = attacker?.familiar?.id;
                  const famStatus = attacker?.familiar?.status;
                  const famIsUsable = famId && famStatus !== 'lost' && famStatus !== 'ritualInProgress';
                  if (!famIsUsable) return null;
                  const famEntry = getFamiliarById(famId);
                  const inRange = isFamiliarInRange(attacker, worldState);
                  return (
                    <div style={{ marginBottom: '6px', paddingBottom: '6px', borderBottom: '1px solid #444', fontSize: '10px' }}>
                      <label style={{ cursor: inRange ? 'pointer' : 'not-allowed', color: inRange ? '#9ecc9e' : '#6a6a6a' }}>
                        <input
                          type="checkbox"
                          style={{ marginRight: 6 }}
                          checked={deliverTouchViaFamiliar && inRange}
                          disabled={!inRange}
                          onChange={(e) => setDeliverTouchViaFamiliar(e.target.checked)}
                        />
                        Deliver Touch Spells via {famEntry?.name || 'familiar'}
                        {!inRange && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>(out of range)</span>}
                      </label>
                    </div>
                  );
                })()}
                {/* Racial Spell-Like Abilities */}
                {(() => {
                  const slaList = attacker?.racialSpellLikeAbilities || [];
                  if (slaList.length === 0) return null;
                  return (
                    <div style={{ marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #444' }}>
                      <div style={{ fontSize: '10px', color: '#66bbdd', marginBottom: '4px' }}>Spell-Like Abilities</div>
                      {slaList.map((sla, idx) => {
                        const dc = computeSLADC(attacker, sla);
                        const hasUses = sla.usesRemaining > 0;
                        return (
                          <div key={idx} style={{ marginBottom: '4px', opacity: hasUses ? 1 : 0.4 }}>
                            <div style={{ fontSize: '10px', color: '#ccc', marginBottom: '2px' }}>
                              <span style={{ color: '#66bbdd' }}>SLA</span> {sla.name}
                              <span style={{ color: '#666', marginLeft: '6px' }}>{sla.usesRemaining}/{sla.usesPerDay}/day{dc ? ` DC ${dc}` : ''}</span>
                            </div>
                            {hasUses && sla.save !== 'none' ? (
                              <div style={styles.buttonRow}>
                                {combat.enemies.filter(e => (e.currentHP || e.hp) > 0).map(enemy => (
                                  <button
                                    key={`sla_${idx}_${enemy.id}`}
                                    style={{ ...styles.button, borderColor: '#66bbdd', color: '#66bbdd', fontSize: '9px', padding: '2px 6px' }}
                                    onClick={() => handleCastSLA(idx, enemy)}
                                  >
                                    → {enemy.name}
                                  </button>
                                ))}
                              </div>
                            ) : hasUses ? (
                              <button
                                style={{ ...styles.button, borderColor: '#66bbdd', color: '#66bbdd', fontSize: '9px', padding: '2px 6px' }}
                                onClick={() => handleCastSLA(idx, null)}
                              >
                                Use
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {(() => {
                  const knownSpells = [...(attacker?.spellsKnown || []), ...(attacker?.spellsPrepared || [])];
                  const uniqueSpells = [...new Set(knownSpells.map(s => s.toLowerCase()))];
                  if (uniqueSpells.length === 0) return <div style={{ fontSize: '10px', color: '#666' }}>No spells known/prepared</div>;

                  return uniqueSpells.map(spellNameLower => {
                    const spell = spellsData.find(s => s.name.toLowerCase() === spellNameLower);
                    if (!spell) return null;
                    const spellLevel = getSpellLevelForClass(spell, attacker.class);
                    if (spellLevel === null) return null;
                    const used = attacker.spellSlotsUsed?.[String(spellLevel)] || 0;
                    const slots = null; // Will show in the button
                    const isBuff = spell.range?.toLowerCase().includes('touch') || spell.target?.toLowerCase().includes('you') || spell.range?.toLowerCase() === 'personal';
                    const isHeal = spell.name.toLowerCase().includes('cure') || spell.name.toLowerCase().includes('heal');
                    const targetsAlly = isBuff || isHeal;

                    return (
                      <div key={spell.name} style={{ marginBottom: '4px' }}>
                        <div style={{ fontSize: '10px', color: '#ccc', marginBottom: '2px' }}>
                          <span style={{ color: '#da70d6' }}>L{spellLevel}</span> {spell.name}
                          <span style={{ color: '#666', marginLeft: '6px' }}>{spell.school}</span>
                        </div>
                        <div style={styles.buttonRow}>
                          {targetsAlly ? (
                            // Target allies
                            party.filter(p => p.currentHP > 0).map(ally => (
                              <button
                                key={`spell_${spell.name}_${ally.id}`}
                                style={{ ...styles.button, borderColor: '#44ff44', color: '#44ff44', fontSize: '9px', padding: '2px 6px' }}
                                onClick={() => handleCastSpell(spell.name, ally)}
                              >
                                → {ally.name}
                              </button>
                            ))
                          ) : (
                            // Target enemies
                            aliveEnemies.map(enemy => (
                              <button
                                key={`spell_${spell.name}_${enemy.id}`}
                                style={{ ...styles.button, borderColor: '#ff6b6b', color: '#ff6b6b', fontSize: '9px', padding: '2px 6px' }}
                                onClick={() => handleCastSpell(spell.name, enemy)}
                              >
                                → {enemy.name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        )}

        {/* Skill Check (CRB Ch. 4) */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '11px', color: '#9bb59b', marginBottom: '4px' }}>
            Skill Check {renderActionTag('move')}
          </div>
          {!showSkillMenu ? (
            <button
              style={{ ...styles.button, borderColor: '#9bb59b', color: '#9bb59b' }}
              onClick={() => setShowSkillMenu(true)}
            >
              Open Skills
            </button>
          ) : (
            <div style={{ backgroundColor: '#1f2e1f', border: '1px solid #9bb59b', borderRadius: '4px', padding: '8px', maxHeight: '260px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', color: '#9bb59b' }}>
                  Pick a skill (Take 20 is usually blocked in combat)
                </span>
                <button
                  style={{ fontSize: '9px', background: 'none', border: '1px solid #666', color: '#666', borderRadius: '2px', cursor: 'pointer', padding: '1px 4px' }}
                  onClick={() => setShowSkillMenu(false)}
                >
                  Close
                </button>
              </div>
              {(() => {
                if (!attacker) return null;
                // Compute static modifier for each usable skill via Take 10 (then subtract 10)
                const enriched = skillsData.map((skill) => {
                  const t10 = dmEngine.take10SkillCheck(attacker, skill.name, { inCombat: true, threatened: true }, worldState);
                  const usable = !!(t10 && t10.canUse);
                  const mod = usable ? t10.total - 10 : null;
                  const ranks = (attacker.skills?.[skill.name]?.ranks) || 0;
                  return { name: skill.name, ability: skill.ability, ranks, mod, usable };
                });
                // Sort: usable first by mod desc, then unusable
                enriched.sort((a, b) => {
                  if (a.usable !== b.usable) return a.usable ? -1 : 1;
                  return (b.mod ?? -99) - (a.mod ?? -99);
                });
                return enriched.map((s) => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', padding: '2px 4px', borderRadius: '3px', background: s.usable ? 'transparent' : '#2a1f1f' }}>
                    <div style={{ flex: 1, fontSize: '10px', color: s.usable ? '#d4c5a9' : '#7a6a6a' }}>
                      <span style={{ color: '#9bb59b' }}>{s.name}</span>
                      <span style={{ color: '#666', marginLeft: '4px' }}>({s.ability})</span>
                      {s.ranks > 0 && <span style={{ color: '#888', marginLeft: '4px' }}>{s.ranks}r</span>}
                      <span style={{ marginLeft: '6px', color: s.mod >= 0 ? '#7fff00' : '#ff6b6b' }}>
                        {s.usable ? `${s.mod >= 0 ? '+' : ''}${s.mod}` : 'untrained'}
                      </span>
                    </div>
                    <button
                      style={{ ...styles.button, fontSize: '9px', padding: '2px 6px', minWidth: 'auto' }}
                      disabled={!s.usable}
                      onClick={() => handleSkillCheckRoll(s.name, 'roll')}
                    >
                      Roll
                    </button>
                    <button
                      style={{ ...styles.button, fontSize: '9px', padding: '2px 6px', minWidth: 'auto', borderColor: '#ffaa00', color: '#ffaa00' }}
                      disabled={!s.usable}
                      onClick={() => handleSkillCheckRoll(s.name, 'take10')}
                    >
                      Take 10
                    </button>
                    <button
                      style={{ ...styles.button, fontSize: '9px', padding: '2px 6px', minWidth: 'auto', borderColor: '#7eb8da', color: '#7eb8da' }}
                      disabled={!s.usable}
                      onClick={() => handleSkillCheckRoll(s.name, 'take20')}
                    >
                      Take 20
                    </button>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>

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

  // ── Render: Interactive Ally Picker (Phase C.3 GM / Phase C.4 Player) ──
  // Shown when the active ally has controlMode='gm' or 'player'. Three-button
  // picker — Attack / Defend / Pass — mirrors the PC action-button visual
  // style (uses styles.button) so interactions feel continuous with PC turns.
  //
  // Header label + accent color diverge by mode so operators + players see
  // at a glance who's driving:
  //   - 'gm'     → green #44cc88 accent, "GM control"
  //   - 'player' → blue  #7eb8da accent, "Player control"
  // The mechanics behind each button are identical (same handlers).
  const renderAllyActionPicker = () => {
    const isPlayerMode = activeAllyMode === 'player';
    const accentColor = isPlayerMode ? '#7eb8da' : '#44cc88';
    const modeLabel = isPlayerMode ? 'Player control' : 'GM control';
    const promptText = isPlayerMode
      ? 'Choose an action — you are driving this ally.'
      : 'Choose an action for this ally.';
    return (
      <div>
        <div style={{ fontSize: '12px', color: accentColor, marginBottom: '4px' }}>
          🤝 {activeAlly?.name}'s TURN ({modeLabel})
          <span style={{ color: '#8b949e', marginLeft: '12px', fontSize: '10px' }}>
            Round {combat.round || 1}
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#8b949e', fontStyle: 'italic', marginBottom: '8px' }}>
          {promptText}
        </div>
        <div style={styles.buttonRow}>
          <button
            style={{ ...styles.button, borderColor: '#ff6b6b', color: '#ff6b6b' }}
            onClick={handleInteractiveAllyAttack}
            title="Ally attacks the best available enemy using the utility AI (same logic as 'ai' control mode)"
          >
            ⚔️ Attack
          </button>
          <button
            style={{ ...styles.button, borderColor: '#44aaff', color: '#44aaff' }}
            onClick={handleInteractiveAllyDefend}
            title="Total Defense: +4 dodge AC until this ally's next turn. Cannot attack this round."
          >
            🛡️ Defend
          </button>
          <button
            style={{ ...styles.button, borderColor: '#b0b0b0', color: '#b0b0b0' }}
            onClick={handleInteractiveAllyPass}
            title="Hold action — ally does nothing this round."
          >
            Pass
          </button>
        </div>
      </div>
    );
  };

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
            {isPlayerTurn
              ? renderPlayerActions()
              : isInteractiveAllyTurn
              ? renderAllyActionPicker()
              : renderEnemyTurn()}
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
            const ally = allies.find(a => a.id === combatant.id);
            const isDead = (pc && pc.currentHP <= 0 && !pc.orcFerocityActive)
              || (enemy && enemy.currentHP <= 0)
              || (ally && ally.currentHP <= 0);
            // Phase 7.6 — effective max HP includes range-gated familiar HP bonus
            const pcEffMax = pc ? getEffectiveMaxHP(pc, { worldState }) : 0;
            const pcHpPct = pc && pcEffMax > 0
              ? Math.min(100, Math.max(0, (pc.currentHP / pcEffMax) * 100))
              : 0;
            const allyHpPct = ally && (ally.hp || ally.maxHP) > 0
              ? Math.min(100, Math.max(0, (ally.currentHP / (ally.hp || ally.maxHP)) * 100))
              : 0;

            // Ally-specific accent (green) so players can tell allies from PCs at a glance.
            const allyBorder = ally ? { borderLeft: '3px solid #44cc88' } : {};

            return (
              <div
                key={combatant.id}
                style={{
                  ...styles.combatant,
                  ...allyBorder,
                  ...(isActive ? styles.combatantActive : {}),
                  opacity: isDead ? 0.4 : 1,
                }}
              >
                <div style={{ ...styles.combatantName, fontSize: '11px' }}>
                  {isDead ? '💀 ' : ''}{ally ? '🤝 ' : ''}{combatant.name}
                </div>
                {pc && (
                  <div style={styles.hpBar}>
                    <div
                      style={{
                        ...styles.hpFill,
                        width: `${Math.max(0, pcHpPct)}%`,
                        backgroundColor:
                          pcHpPct > 50 ? '#44ff44' : pcHpPct > 25 ? '#ffaa00' : '#ff4444',
                      }}
                    />
                  </div>
                )}
                {ally && (
                  <div style={styles.hpBar}>
                    <div
                      style={{
                        ...styles.hpFill,
                        width: `${Math.max(0, allyHpPct)}%`,
                        backgroundColor:
                          allyHpPct > 50 ? '#44cc88' : allyHpPct > 25 ? '#ffaa00' : '#ff4444',
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {worldState?.gmMode && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={injectTestAlly}
              title="GM debug: splice a Summoned Wolf ally (5-rnd summon) into combat via allyFactory."
              style={{
                padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                background: '#1f2e1f', color: '#44cc88',
                border: '1px dashed #44cc88', borderRadius: 3,
              }}
            >
              🤝 Inject Test Ally (GM)
            </button>
            <button
              onClick={() => spawnSummonAlly(
                { name: 'Celestial Hawk', hp: 6, ac: 14, init: 3 },
                { durationRounds: 3, controlMode: 'ai' },
              )}
              title="Phase F: spawn a 3-round summon to verify expiry ticker + spawn entrypoint."
              style={{
                padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                background: '#1f2940', color: '#7eb8da',
                border: '1px dashed #7eb8da', borderRadius: 3,
              }}
            >
              ✨ Spawn 3-rnd Summon (GM)
            </button>
          </div>
        )}
      </div>

      {/* Enemies */}
      <div style={styles.section}>
        <div style={styles.title}>Enemies</div>
        {enemies.map((enemy) => {
          const hpPercent = enemy.hp > 0 ? (enemy.currentHP / enemy.hp) * 100 : 0;
          // ── Observation-based reveal (CRB-faithful default) ──
          // exact mode: DM preference OR the enemy is down (party can examine
          // the body) OR GM debug mode.
          const showExact = !!(
            worldState?.dmPreferences?.showExactHPInCombat ||
            enemy.currentHP <= 0 ||
            worldState?.gmMode
          );
          const obs = ensureObservationShape(combat?.observed?.[enemy.id] || emptyObservation());
          const acLabel = showExact
            ? (enemy.ac ? `AC ${enemy.ac}` : '')
            : (hasAcObservation(obs) ? describeAcRange(obs) : '');
          const hpState = hpDescriptor(enemy.currentHP, enemy.hp);
          const seen = [...(obs.seenAttacks || []), ...(obs.seenAbilities || [])];
          const partySavesLine = hasSaveObservations(obs.savesObserved)
            ? describeSaveBucket(obs.savesObserved) : '';
          const enemySavesLine = hasSaveObservations(obs.enemySavesTaken)
            ? describeSaveBucket(obs.enemySavesTaken) : '';
          return (
            <div key={enemy.id} style={{ ...styles.combatant, opacity: enemy.currentHP <= 0 ? 0.4 : 1 }}>
              <div style={styles.combatantName}>
                {enemy.currentHP <= 0 ? '💀 ' : ''}{enemy.fled ? '🏃 ' : ''}{enemy.surrendered ? '🏳️ ' : ''}
                {enemy.name} {acLabel ? `(${acLabel})` : ''}
                {enemy.cr ? <span style={{ fontSize: '10px', color: '#8b949e', marginLeft: '8px' }}>CR {enemy.cr}</span> : null}
                {enemy.behaviorPreset ? <span style={{ fontSize: '9px', color: '#7b68ee', marginLeft: '6px' }}>[{enemy.behaviorPreset}]</span> : null}
              </div>
              <div style={styles.hp}>
                {showExact
                  ? `${Math.max(0, enemy.currentHP)}/${enemy.hp}`
                  : <span style={{ fontStyle: 'italic', color: '#b8c4d0' }}>{hpDescriptorLabel(hpState)}</span>}
                {enemy.type ? <span style={{ marginLeft: '8px', fontSize: '10px', color: '#666' }}>{enemy.type}</span> : null}
                {enemy.int != null ? <span style={{ marginLeft: '6px', fontSize: '9px', color: '#58a6ff' }}>INT {enemy.int}</span> : null}
              </div>
              {seen.length > 0 && (
                <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px' }}>
                  Seen: {seen.join(', ')}
                </div>
              )}
              {(partySavesLine || enemySavesLine) && (
                <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px' }}>
                  {partySavesLine && <span>PC saves vs DCs: {partySavesLine}</span>}
                  {partySavesLine && enemySavesLine && <span style={{ margin: '0 6px', color: '#555' }}>·</span>}
                  {enemySavesLine && <span>Its saves vs ours: {enemySavesLine}</span>}
                </div>
              )}
              {enemy.conditions && enemy.conditions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                  {enemy.conditions.map((c, ci) => (
                    <span key={ci} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: '#8b0000', color: '#ffcccc' }}>
                      {c.name}{c.roundsRemaining > 0 ? ` (${c.roundsRemaining}r)` : c.duration > 0 ? ` (${c.duration}r)` : ''}
                    </span>
                  ))}
                </div>
              )}
              {enemy.activeEffects && enemy.activeEffects.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                  {enemy.activeEffects.map((eff, ei) => (
                    <span key={ei} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: '#1a1a4a', color: '#aaaaff' }}>
                      {eff.name}{eff.roundsRemaining > 0 ? ` (${eff.roundsRemaining}r)` : ''}
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
          // Phase 7.6 — effective max HP includes range-gated familiar HP bonus
          const effMax = getEffectiveMaxHP(char, { worldState });
          const hpPercent = effMax > 0
            ? Math.min(100, Math.max(0, (char.currentHP / effMax) * 100))
            : 0;
          return (
            <div key={char.id} style={styles.combatant}>
              <div style={styles.combatantName}>
                {char.currentHP <= 0 ? '💀 ' : ''}{char.name}
                {char.class ? <span style={{ fontSize: '10px', color: '#8b949e', marginLeft: '8px' }}>{char.class} {char.level}</span> : null}
              </div>
              <div style={styles.hp}>
                {char.currentHP}/{effMax}
              </div>
              {char.conditions && char.conditions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                  {char.conditions.map((c, ci) => (
                    <span key={ci} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: '#8b4513', color: '#ffd700' }}>
                      {c.name}{c.roundsRemaining > 0 ? ` (${c.roundsRemaining}r)` : c.duration > 0 ? ` (${c.duration}r)` : ''}
                    </span>
                  ))}
                </div>
              )}
              {char.activeEffects && char.activeEffects.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                  {char.activeEffects.map((eff, ei) => (
                    <span key={ei} style={{ fontSize: '9px', padding: '1px 4px', borderRadius: '3px', background: eff.isDebuff ? '#4a1a1a' : '#1a3a1a', color: eff.isDebuff ? '#ff9999' : '#99ff99' }}>
                      {eff.name}{eff.roundsRemaining > 0 ? ` (${eff.roundsRemaining}r)` : ''}
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
