/**
 * Monster Tactics & Utility AI System
 *
 * Advanced behavior system for Pathfinder 1e creatures using utility-based AI.
 * Each possible action is scored (0-100) based on context, and the highest-scoring
 * action is selected. Creature intelligence determines tactical sophistication.
 *
 * Architecture:
 * - Utility AI: Score-based action selection (responsive, varied behavior)
 * - Intelligence tiers: Scale tactical complexity with creature stats
 * - Condition awareness: React to and exploit status effects
 * - Spell AI: Intelligent spell selection for caster creatures
 * - Special abilities: Breath weapons, gaze attacks, auras, combat maneuvers
 * - Tactical coordination: Focus fire, flanking, protect allies
 */

import { roll, rollDice, mod } from '../utils/dice';
import { computeSave, getBluffFeintOpposed } from '../utils/rulesEngine';
import { applyEvasion } from '../utils/classAbilityResolver';

/**
 * Parse an enemy's skill bonus from any of the three storage formats:
 *  1. String: "Bluff +11, Perception +14"  (monsters.json default)
 *  2. Structured: { Bluff: { bonus: 11 } }
 *  3. Flat number: { Bluff: 11 }
 * Returns the numeric bonus or 0 if not found.
 */
export function getEnemySkillBonus(enemy, skillName) {
  const s = enemy?.skills;
  if (!s) return 0;
  // Format 1: entire skills field is a string
  if (typeof s === 'string') {
    const re = new RegExp(`${skillName}\\s+([+-]?\\d+)`, 'i');
    const m = s.match(re);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Format 2: structured object with .bonus
  if (s[skillName]?.bonus != null) return s[skillName].bonus;
  // Format 3: flat numeric value
  if (typeof s[skillName] === 'number') return s[skillName];
  return 0;
}

// ═══════════════════════════════════════════════════
// CONDITION SYSTEM
// ═══════════════════════════════════════════════════

export const CONDITIONS = {
  blinded:     { name: 'Blinded',     acPenalty: -2, atkPenalty: -2, dexToAC: false, moveHalved: true, duration: 0 },
  confused:    { name: 'Confused',    special: 'roll_behavior', duration: 0 },
  dazed:       { name: 'Dazed',       noActions: true, duration: 1 },
  deafened:    { name: 'Deafened',    initPenalty: -4, spellFailure: 20, duration: 0 },
  entangled:   { name: 'Entangled',   atkPenalty: -2, dexPenalty: -4, moveHalved: true, duration: 0 },
  exhausted:   { name: 'Exhausted',   strPenalty: -6, dexPenalty: -6, moveHalved: true, duration: 0 },
  fascinated:  { name: 'Fascinated',  noActions: true, breakOnThreat: true, duration: 0 },
  fatigued:    { name: 'Fatigued',    strPenalty: -2, dexPenalty: -2, noCharge: true, duration: 0 },
  frightened:  { name: 'Frightened',  atkPenalty: -2, savePenalty: -2, skillPenalty: -2, mustFlee: true, duration: 0 },
  grappled:    { name: 'Grappled',    noActions: false, atkPenalty: -2, dexPenalty: -4, cantMove: true, concentrationDC: 'cmd', duration: 0 },
  nauseated:   { name: 'Nauseated',   moveOnly: true, duration: 0 },
  panicked:    { name: 'Panicked',    atkPenalty: -2, savePenalty: -2, mustFlee: true, dropItems: true, duration: 0 },
  paralyzed:   { name: 'Paralyzed',   noActions: true, helpless: true, duration: 0 },
  prone:       { name: 'Prone',       meleePenalty: -4, acMelee: -4, acRanged: 4, standUpCost: 'move', duration: 0 },
  shaken:      { name: 'Shaken',      atkPenalty: -2, savePenalty: -2, skillPenalty: -2, duration: 0 },
  sickened:    { name: 'Sickened',    atkPenalty: -2, savePenalty: -2, skillPenalty: -2, dmgPenalty: -2, duration: 0 },
  staggered:   { name: 'Staggered',   singleActionOnly: true, duration: 0 },
  stunned:     { name: 'Stunned',     noActions: true, acPenalty: -2, dexToAC: false, duration: 0 },
};

/** Get total attack penalty from all active conditions */
export function getConditionAtkPenalty(conditions) {
  if (!conditions || conditions.length === 0) return 0;
  return conditions.reduce((pen, c) => {
    const def = CONDITIONS[c.id] || {};
    return pen + (def.atkPenalty || 0) + (def.meleePenalty || 0);
  }, 0);
}

/** Get total AC modifier from conditions */
export function getConditionACMod(conditions) {
  if (!conditions || conditions.length === 0) return 0;
  return conditions.reduce((m, c) => {
    const def = CONDITIONS[c.id] || {};
    return m + (def.acPenalty || 0) + (def.acMelee || 0);
  }, 0);
}

/** Check if creature can act at all */
export function canAct(conditions) {
  if (!conditions || conditions.length === 0) return true;
  return !conditions.some(c => {
    const def = CONDITIONS[c.id] || {};
    return def.noActions || def.helpless;
  });
}

/** Check if creature can only take a single action */
export function isSingleActionOnly(conditions) {
  if (!conditions) return false;
  return conditions.some(c => (CONDITIONS[c.id] || {}).singleActionOnly);
}

/** Check if creature must flee */
export function mustFlee(conditions) {
  if (!conditions) return false;
  return conditions.some(c => (CONDITIONS[c.id] || {}).mustFlee);
}

/** Tick down condition durations at start of turn. Returns remaining conditions.
 *  Duration semantics:
 *    null/undefined/0 = permanent (persists until explicitly removed)
 *    positive integer = rounds remaining (ticks down each turn, removed at 0)
 */
export function tickConditions(conditions) {
  if (!conditions) return [];
  return conditions
    .map(c => {
      // Permanent conditions (null, undefined, or 0 duration) don't tick
      if (!c.duration) return c;
      return { ...c, duration: c.duration - 1 };
    })
    .filter(c => c.duration === undefined || c.duration === null || c.duration === 0 || c.duration > 0);
}

// ═══════════════════════════════════════════════════
// SPECIAL ABILITY DETECTION & PARSING
// ═══════════════════════════════════════════════════

const ABILITY_PATTERNS = {
  breathWeapon:   /breath\s*weapon|breathes?\s+(fire|cold|acid|lightning|electricity|poison)/i,
  gaze:           /gaze\s*(attack)?/i,
  frightfulPresence: /frightful\s*presence/i,
  trip:           /\btrip\b/i,
  grab:           /\bgrab\b/i,
  constrict:      /\bconstrict\b/i,
  rend:           /\brend\b/i,
  rake:           /\brake\b/i,
  swallow:        /\bswallow\s*whole\b/i,
  trample:        /\btrample\b/i,
  web:            /\bweb\b/i,
  pull:           /\bpull\b/i,
  push:           /\bpush\b/i,
  bleed:          /\bbleed\b/i,
  energyDrain:    /\benergy\s*drain\b/i,
  abilityDamage:  /\bability\s*(damage|drain)\b/i,
  spellLike:      /spell-like\s*abilit/i,
  supernatural:   /\(Su\)/i,
  extraordinary:  /\(Ex\)/i,
  poison:         /\bpoison\b/i,
  disease:        /\bdisease\b/i,
  fear:           /\bfear\b|\baura\s*of\s*fear\b/i,
  regeneration:   /\bregenerat/i,
  damageReduction:/\bDR\b/i,
  spellResistance:/\bSR\b/i,
  changeShape:    /\bchange\s*shape\b/i,
  summon:         /\bsummon\b/i,
  teleport:       /\bteleport\b/i,
  invisibility:   /\binvisibil/i,
};

/** Detect all special abilities from a creature's data */
export function detectAbilities(enemy) {
  const special = (enemy.special || '') + ' ' + (enemy.special_attacks || '');
  const abilities = [];

  for (const [key, pattern] of Object.entries(ABILITY_PATTERNS)) {
    if (pattern.test(special)) {
      abilities.push(key);
    }
  }

  // Check for spells from the spells field
  if (enemy.spells && enemy.spells.length > 0) {
    abilities.push('spellcaster');
  }

  // Check for spell-like abilities in the creature data
  if (enemy.spell_like_abilities || /spell-like/i.test(special)) {
    abilities.push('spellLikeAbilities');
  }

  return abilities;
}

// ═══════════════════════════════════════════════════
// SPELL AI
// ═══════════════════════════════════════════════════

/** Known monster spell categories for AI decision-making */
const SPELL_CATEGORIES = {
  damage: {
    keywords: ['fireball', 'lightning bolt', 'magic missile', 'burning hands', 'cone of cold', 'flame strike',
      'scorching ray', 'acid arrow', 'ice storm', 'chain lightning', 'disintegrate', 'finger of death',
      'meteor swarm', 'polar ray', 'fire storm', 'harm', 'searing light', 'sound burst', 'holy smite',
      'unholy blight', 'acid splash', 'ray of frost', 'shocking grasp'],
    priority: 'offense',
  },
  control: {
    keywords: ['hold person', 'hold monster', 'dominate person', 'dominate monster', 'confusion', 'slow',
      'web', 'grease', 'black tentacles', 'wall of fire', 'wall of ice', 'wall of stone', 'wall of force',
      'entangle', 'stinking cloud', 'cloudkill', 'solid fog', 'force cage', 'maze', 'time stop',
      'prismatic wall', 'antimagic field'],
    priority: 'control',
  },
  debuff: {
    keywords: ['blindness', 'bestow curse', 'ray of enfeeblement', 'enervation', 'feeblemind', 'flesh to stone',
      'baleful polymorph', 'power word stun', 'power word kill', 'phantasmal killer', 'fear', 'cause fear',
      'scare', 'hideous laughter', 'deep slumber', 'sleep', 'color spray', 'glitterdust'],
    priority: 'debuff',
  },
  buff: {
    keywords: ['shield', 'mage armor', 'mirror image', 'displacement', 'stoneskin', 'haste', 'fly',
      'greater invisibility', 'blur', 'protection from energy', 'resist energy', 'barkskin',
      'bull\'s strength', 'bear\'s endurance', 'cat\'s grace', 'divine power', 'righteous might',
      'bless', 'prayer', 'divine favor', 'shield of faith', 'enlarge person'],
    priority: 'buff',
  },
  healing: {
    keywords: ['cure light wounds', 'cure moderate wounds', 'cure serious wounds', 'cure critical wounds',
      'heal', 'mass cure', 'breath of life', 'restoration', 'regenerate'],
    priority: 'healing',
  },
  summon: {
    keywords: ['summon monster', 'summon nature\'s ally', 'animate dead', 'create undead', 'gate',
      'planar binding', 'planar ally'],
    priority: 'summon',
  },
  utility: {
    keywords: ['invisibility', 'teleport', 'dimension door', 'gaseous form', 'ethereal jaunt',
      'true seeing', 'detect', 'dispel magic', 'greater dispel', 'antimagic', 'silence',
      'darkness', 'deeper darkness'],
    priority: 'utility',
  },
};

/** Categorize a spell name into a tactical category */
function categorizeSpell(spellName) {
  const name = spellName.toLowerCase();
  for (const [category, data] of Object.entries(SPELL_CATEGORIES)) {
    if (data.keywords.some(kw => name.includes(kw))) return category;
  }
  return 'utility';
}

/** Parse a creature's spells into usable format */
export function parseCreatureSpells(enemy) {
  if (!enemy.spells || enemy.spells.length === 0) return [];

  const parsed = [];
  for (const spellBlock of enemy.spells) {
    // PSRD format: spells can be nested objects with spell_list arrays
    if (spellBlock.spell_list) {
      for (const entry of spellBlock.spell_list) {
        if (entry.spells) {
          for (const sp of entry.spells) {
            const name = typeof sp === 'string' ? sp : (sp.name || sp);
            parsed.push({
              name: String(name).replace(/\s*\(.*?\)\s*$/, '').trim(),
              level: entry.level || 0,
              category: categorizeSpell(String(name)),
              dc: entry.dc || null,
              used: false,
            });
          }
        }
      }
    }
    // Simple array format
    else if (typeof spellBlock === 'string') {
      parsed.push({
        name: spellBlock.replace(/\s*\(.*?\)\s*$/, '').trim(),
        level: 0,
        category: categorizeSpell(spellBlock),
        dc: null,
        used: false,
      });
    }
  }

  return parsed;
}

/** Select best spell for current combat situation */
export function selectSpell(enemy, spells, alivePCs, allEnemies, tier) {
  if (!spells || spells.length === 0) return null;

  const hpPct = enemy.currentHP / enemy.hp;
  const aliveAllies = allEnemies.filter(e => e.id !== enemy.id && e.currentHP > 0);
  const avgPCHP = alivePCs.reduce((s, p) => s + (p.currentHP / p.maxHP), 0) / Math.max(alivePCs.length, 1);

  // Score each available spell
  const scored = spells
    .filter(s => !s.used)
    .map(s => {
      let score = 20; // base score for casting any spell

      switch (s.category) {
        case 'damage':
          score += 30;
          // Higher priority when multiple targets clustered (AoE)
          if (alivePCs.length >= 3) score += 15;
          // Higher level = more damage usually
          score += (s.level || 0) * 3;
          break;

        case 'control':
          score += 25;
          // Control is great when outnumbered
          if (alivePCs.length > aliveAllies.length + 1) score += 20;
          // Intelligent creatures value control more
          if (tier === 'genius') score += 15;
          break;

        case 'debuff':
          score += 25;
          // Target the strongest PC
          if (alivePCs.some(p => p.currentHP / p.maxHP > 0.8)) score += 10;
          break;

        case 'buff':
          // Buff at start of combat or when allies present
          if (aliveAllies.length > 0) score += 15;
          if (hpPct > 0.8) score += 15; // Buff early
          else score -= 10; // Don't buff when low
          break;

        case 'healing':
          // Only heal when hurt
          if (hpPct < 0.3) score += 50;
          else if (hpPct < 0.5) score += 30;
          else if (hpPct < 0.7) score += 10;
          else score -= 20; // Don't waste healing at high HP
          // Heal allies too
          if (aliveAllies.some(a => a.currentHP / a.hp < 0.3)) score += 20;
          break;

        case 'summon':
          // Summon when outnumbered or early in fight
          if (aliveAllies.length < alivePCs.length) score += 20;
          if (hpPct > 0.7) score += 10;
          break;

        case 'utility':
          // Escape spells when hurt
          if (hpPct < 0.25 && /teleport|dimension door|gaseous|ethereal/i.test(s.name)) score += 40;
          // Dispel if PCs have visible buffs
          if (/dispel/i.test(s.name)) score += 15;
          // Invisibility is good early
          if (/invisibil/i.test(s.name) && hpPct > 0.7) score += 25;
          break;
      }

      // Higher level spells are generally better
      score += (s.level || 0) * 2;

      // Randomness based on intelligence
      if (tier === 'mindless') score += Math.floor(Math.random() * 30) - 15;
      else if (tier === 'bestial') score += Math.floor(Math.random() * 20) - 10;
      else score += Math.floor(Math.random() * 10) - 5;

      return { spell: s, score };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.length > 0 ? scored[0].spell : null;
}

// ═══════════════════════════════════════════════════
// UTILITY AI — ACTION SCORING
// ═══════════════════════════════════════════════════

/**
 * Score all possible actions and return the best one.
 * This is the core of the monster AI system.
 *
 * @param {Object} enemy - The creature taking its turn
 * @param {Array} alivePCs - Party members still alive
 * @param {Array} allEnemies - All enemies (for coordination)
 * @param {Object} combatState - Current combat metadata
 * @returns {Object} { action, score, reasoning }
 */
export function scorePossibleActions(enemy, alivePCs, allEnemies, combatState = {}) {
  const tier = getIntelligenceTierEnhanced(enemy);
  const hpPct = enemy.currentHP / enemy.hp;
  const abilities = detectAbilities(enemy);
  const conditions = enemy.conditions || [];
  const round = combatState.round || 1;
  const aliveAllies = allEnemies.filter(e => e.id !== enemy.id && e.currentHP > 0);

  // Can't act at all?
  if (!canAct(conditions)) {
    return { action: 'skip', score: 0, reasoning: `${enemy.name} cannot act (incapacitated).` };
  }

  // Must flee?
  if (mustFlee(conditions)) {
    return { action: 'flee', score: 100, reasoning: `${enemy.name} is compelled to flee!` };
  }

  const singleAction = isSingleActionOnly(conditions);
  const candidates = [];

  // --- MELEE ATTACK (standard action) ---
  candidates.push(scoreMeleeAttack(enemy, alivePCs, tier, hpPct, conditions));

  // --- FULL ATTACK (full-round) ---
  if (!singleAction) {
    candidates.push(scoreFullAttack(enemy, alivePCs, tier, hpPct, conditions));
  }

  // --- CHARGE (full-round) ---
  if (!singleAction && !conditions.some(c => c.id === 'fatigued' || c.id === 'exhausted')) {
    candidates.push(scoreCharge(enemy, alivePCs, tier, hpPct));
  }

  // --- BREATH WEAPON (PF1e: recharges after 1d4 rounds, not once-per-combat) ---
  const breathReady = !enemy._breathRechargeRounds || enemy._breathRechargeRounds <= 0;
  if (abilities.includes('breathWeapon') && breathReady) {
    candidates.push(scoreBreathWeapon(enemy, alivePCs, tier, round));
  }

  // --- GAZE ATTACK ---
  if (abilities.includes('gaze')) {
    candidates.push(scoreGazeAttack(enemy, alivePCs, tier));
  }

  // --- FRIGHTFUL PRESENCE ---
  if (abilities.includes('frightfulPresence') && round <= 2) {
    candidates.push(scoreFrightfulPresence(enemy, alivePCs));
  }

  // --- COMBAT MANEUVERS (trip, grab, etc.) ---
  if (abilities.includes('trip')) {
    candidates.push(scoreTripAttack(enemy, alivePCs, tier));
  }
  if (abilities.includes('grab')) {
    candidates.push(scoreGrab(enemy, alivePCs, tier));
  }

  // --- SPELLCASTING ---
  if (abilities.includes('spellcaster') || abilities.includes('spellLikeAbilities')) {
    const spells = parseCreatureSpells(enemy);
    const spell = selectSpell(enemy, spells, alivePCs, allEnemies, tier);
    if (spell) {
      candidates.push(scoreSpellcast(enemy, spell, alivePCs, tier, hpPct, round));
    }
  }

  // --- FEINT (standard action, Bluff-based) ---
  if (tier === 'cunning' || tier === 'genius') {
    candidates.push(scoreFeint(enemy, alivePCs, allEnemies, tier));
  }

  // --- TACTICAL RETREAT / REPOSITION ---
  if (tier === 'cunning' || tier === 'genius') {
    candidates.push(scoreReposition(enemy, alivePCs, tier, hpPct));
  }

  // --- TOTAL DEFENSE ---
  candidates.push(scoreTotalDefense(enemy, hpPct, tier));

  // --- FLEE ---
  if (tier !== 'mindless' && tier !== 'fearless') {
    candidates.push(scoreFleeAction(enemy, hpPct, tier, aliveAllies));
  }

  // --- SUMMON ---
  if (abilities.includes('summon') && round <= 3) {
    candidates.push(scoreSummon(enemy, aliveAllies, alivePCs, tier));
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Add some intelligence-based variance
  if (tier === 'mindless' && candidates.length > 1) {
    // Mindless creatures might not pick the best action
    const idx = Math.floor(Math.random() * Math.min(3, candidates.length));
    return candidates[idx];
  }

  return candidates[0] || { action: 'attack', score: 50, reasoning: 'Default attack.' };
}

// ── Individual Action Scorers ──

function scoreMeleeAttack(enemy, alivePCs, tier, hpPct, conditions) {
  let score = 50; // Baseline for a standard attack
  const atkPenalty = getConditionAtkPenalty(conditions);

  // Heavily penalized if conditions make attacking hard
  if (atkPenalty <= -4) score -= 15;

  // Bonus for healthy creatures (aggressive)
  if (hpPct > 0.7) score += 5;

  // Cunning creatures prefer attack when they have advantage
  if (tier === 'cunning' || tier === 'genius') {
    // Check if any PC is prone, grappled, etc.
    const vulnerablePC = alivePCs.find(p =>
      (p.conditions || []).some(c => ['prone', 'stunned', 'grappled', 'blinded'].includes(c.id))
    );
    if (vulnerablePC) score += 15;
  }

  return {
    action: 'attack',
    score: Math.max(0, score),
    reasoning: 'Standard melee attack.',
    target: null, // Will be selected by target picker
  };
}

function scoreFullAttack(enemy, alivePCs, tier, hpPct, conditions) {
  let score = 45; // Slightly below single attack baseline

  // Full attack is MUCH better when you have multiple attacks
  const atkStr = enemy.atk || enemy.attack || '';
  const attackCount = (atkStr.match(/,/g) || []).length + 1;
  if (attackCount >= 3) score += 30;
  else if (attackCount >= 2) score += 20;
  else score -= 10; // No point in full attack with one attack

  // Full attack locks you in place — risky at low HP
  if (hpPct < 0.3) score -= 15;

  // Smart creatures know full attack is optimal DPR
  if (tier === 'cunning' || tier === 'genius') score += 10;

  return {
    action: 'full_attack',
    score: Math.max(0, score),
    reasoning: `Full attack (${attackCount} attacks).`,
  };
}

function scoreCharge(enemy, alivePCs, tier, hpPct) {
  let score = 35;

  // Charge is good in round 1 to close distance
  score += 15; // Assume distance makes charge relevant

  // +2 to hit is nice
  score += 5;

  // But -2 AC is risky at low HP
  if (hpPct < 0.4) score -= 15;

  // Bestial creatures love to charge
  if (tier === 'bestial') score += 10;

  return {
    action: 'charge',
    score: Math.max(0, score),
    reasoning: 'Charge attack (+2 hit, -2 AC).',
  };
}

function scoreBreathWeapon(enemy, alivePCs, tier, round) {
  let score = 60; // Breath weapons are powerful

  // More targets = more value
  score += alivePCs.length * 10;

  // Use it early for maximum impact
  if (round <= 2) score += 15;

  // Genius creatures save breath weapons strategically
  if (tier === 'genius' && alivePCs.length < 3) score -= 10;

  return {
    action: 'breath_weapon',
    score: Math.max(0, score),
    reasoning: `Breath weapon targeting ${alivePCs.length} creatures.`,
  };
}

function scoreGazeAttack(enemy, alivePCs, tier) {
  let score = 45;
  // Gaze is free action, always useful
  score += 10;
  // More targets = more potential hits
  score += alivePCs.length * 5;

  return {
    action: 'gaze',
    score: Math.max(0, score),
    reasoning: 'Gaze attack (free action).',
  };
}

function scoreFrightfulPresence(enemy, alivePCs) {
  let score = 55;
  score += alivePCs.length * 8;
  return {
    action: 'frightful_presence',
    score,
    reasoning: 'Frightful presence to demoralize enemies.',
  };
}

function scoreTripAttack(enemy, alivePCs, tier) {
  let score = 40;
  // Trip is great against melee fighters
  const meleeTargets = alivePCs.filter(p => {
    const cls = (p.class || p.className || '').toLowerCase();
    return ['fighter', 'barbarian', 'paladin', 'cavalier', 'ranger', 'monk'].includes(cls);
  });
  if (meleeTargets.length > 0) score += 15;
  // Smart creatures use trip to set up advantage
  if (tier === 'cunning' || tier === 'genius') score += 10;

  return {
    action: 'trip',
    score: Math.max(0, score),
    reasoning: 'Trip attack to knock target prone.',
  };
}

/**
 * Score feint action (CRB pp. 92, 201). Cunning/genius creatures with Bluff
 * skill may feint to deny a target's DEX bonus to AC, enabling sneak attacks
 * from rogue-type allies or just improving hit chance.
 */
function scoreFeint(enemy, alivePCs, allEnemies, tier) {
  // Only for creatures that could reasonably feint (have Bluff or Int 3+)
  const bluffBonus = getEnemySkillBonus(enemy, 'Bluff');
  const intelligence = enemy.intelligence ?? enemy.abilities?.INT ?? 10;
  if (intelligence <= 2 || bluffBonus <= 0) return { action: 'feint', score: 0, reasoning: 'No Bluff skill or too low Int.' };

  let score = 25; // Lower base than attack — feint is a setup move

  // Feint is much more valuable if there are allies who can exploit denied-Dex (rogues, etc.)
  const hasSnealAttacker = allEnemies.some(e =>
    e.id !== enemy.id && e.currentHP > 0 && (
      (e.type || '').toLowerCase().includes('rogue') ||
      e.sneakAttack || e.sneak_attack
    )
  );
  if (hasSnealAttacker) score += 25;

  // Higher Bluff = more likely to succeed = more valuable
  if (bluffBonus >= 10) score += 10;
  else if (bluffBonus >= 5) score += 5;

  // Genius creatures value tactical setups more
  if (tier === 'genius') score += 10;
  else if (tier === 'cunning') score += 5;

  // Don't feint if target is already denied Dex
  const primaryTarget = alivePCs[0]; // simplified — real targeting is done elsewhere
  if (primaryTarget?.conditions?.some(c => c.id === 'feinted' || c.modifiers?.loseDexToAC)) {
    score = 0;
  }

  return {
    action: 'feint',
    score: Math.max(0, score),
    target: primaryTarget?.id,
    reasoning: `Feint to deny target DEX to AC${hasSnealAttacker ? ' (enabling ally sneak attack!)' : ''}.`,
  };
}

function scoreGrab(enemy, alivePCs, tier) {
  let score = 40;
  // Grab is great against casters
  const casterTargets = alivePCs.filter(p => {
    const cls = (p.class || p.className || '').toLowerCase();
    return ['wizard', 'sorcerer', 'witch', 'cleric', 'oracle', 'druid', 'bard'].includes(cls);
  });
  if (casterTargets.length > 0) score += 20;
  if (tier === 'cunning' || tier === 'genius') score += 5;

  return {
    action: 'grab',
    score: Math.max(0, score),
    reasoning: 'Grab attack to grapple target.',
  };
}

function scoreSpellcast(enemy, spell, alivePCs, tier, hpPct, round) {
  let score = 55; // Spells are usually powerful

  switch (spell.category) {
    case 'damage':
      score += 15;
      if (alivePCs.length >= 3) score += 10; // AoE value
      break;
    case 'control':
      score += 20;
      if (round <= 2) score += 10; // Control early
      break;
    case 'debuff':
      score += 15;
      break;
    case 'buff':
      if (round === 1) score += 20;
      else score -= 10;
      break;
    case 'healing':
      if (hpPct < 0.3) score += 30;
      else if (hpPct < 0.5) score += 15;
      else score -= 20;
      break;
    case 'summon':
      if (round <= 2) score += 15;
      break;
    case 'utility':
      if (hpPct < 0.25 && /teleport|dimension|gaseous|ethereal/i.test(spell.name)) score += 30;
      break;
  }

  // Genius casters are more effective with spells
  if (tier === 'genius') score += 10;

  return {
    action: 'cast_spell',
    spell,
    score: Math.max(0, score),
    reasoning: `Cast ${spell.name} (${spell.category}).`,
  };
}

function scoreReposition(enemy, alivePCs, tier, hpPct) {
  let score = 20;
  // Reposition to avoid flanking or get range
  if (hpPct < 0.5) score += 15; // Defensive retreat
  if (tier === 'genius') score += 10; // Smart positioning
  // If multiple melee threats, repositioning is wise
  if (alivePCs.length >= 3) score += 10;

  return {
    action: 'reposition',
    score: Math.max(0, score),
    reasoning: 'Tactical repositioning.',
  };
}

function scoreTotalDefense(enemy, hpPct, tier) {
  let score = 15;
  // Total defense is a last resort
  if (hpPct < 0.15) score += 25;
  if (hpPct < 0.25) score += 15;
  // Mindless creatures never use total defense
  if (tier === 'mindless') score = 0;

  return {
    action: 'total_defense',
    score: Math.max(0, score),
    reasoning: 'Total defense (+4 dodge AC).',
  };
}

function scoreFleeAction(enemy, hpPct, tier, aliveAllies) {
  let score = 0;
  if (hpPct <= 0.15) score += 50;
  else if (hpPct <= 0.25) score += 30;
  else if (hpPct <= 0.4) score += 10;

  // Last one standing bonus to flee
  if (aliveAllies.length === 0) score += 20;

  // Intelligence modifiers
  if (tier === 'bestial') score *= 1.3;
  if (tier === 'cunning') score *= 0.8;
  if (tier === 'genius') score *= 0.5;

  return {
    action: 'flee',
    score: Math.max(0, score),
    reasoning: 'Attempting to flee the battle.',
  };
}

function scoreSummon(enemy, aliveAllies, alivePCs, tier) {
  let score = 40;
  // Summon when outnumbered
  if (aliveAllies.length < alivePCs.length) score += 20;
  // Smart creatures summon early
  if (tier === 'genius') score += 10;

  return {
    action: 'summon',
    score: Math.max(0, score),
    reasoning: 'Summon reinforcements.',
  };
}

// ═══════════════════════════════════════════════════
// ENHANCED INTELLIGENCE TIER
// ═══════════════════════════════════════════════════

/** Enhanced intelligence tier using actual INT score when available */
export function getIntelligenceTierEnhanced(enemy) {
  const intScore = enemy.int || enemy.intelligence;

  // If we have an actual INT score, use it for finer-grained tiers
  if (intScore != null && intScore !== '' && intScore !== '—') {
    const intVal = parseInt(intScore) || 0;
    if (intVal === 0 || intVal === null) return 'mindless';  // No INT score = mindless
    if (intVal <= 2) return 'bestial';   // Animal-level
    if (intVal <= 7) return 'bestial';   // Low intelligence
    if (intVal <= 11) return 'cunning';  // Average humanoid
    if (intVal <= 15) return 'cunning';  // Smart
    if (intVal <= 19) return 'genius';   // Very smart
    return 'genius';                     // Supernatural intelligence
  }

  // Fallback to type-based detection
  const type = (enemy.type || enemy.creature_type || '').toLowerCase();
  const name = (enemy.name || '').toLowerCase();

  if (type.includes('ooze') || type.includes('vermin') || type.includes('swarm')) return 'mindless';
  if (type.includes('construct') && !name.includes('clockwork') && !name.includes('robot') && !name.includes('golem')) return 'mindless';
  if (type.includes('animal')) return 'bestial';
  if (type.includes('magical beast')) return 'bestial';
  if (type.includes('dragon')) return 'genius';
  if (type.includes('outsider')) return 'cunning';
  if (type.includes('fey')) return 'cunning';
  if (type.includes('humanoid')) return 'cunning';
  if (type.includes('aberration')) return 'cunning';
  if (type.includes('undead')) {
    if (name.includes('lich') || name.includes('vampire') || name.includes('spectre')) return 'cunning';
    return 'fearless';
  }

  return 'bestial';
}

// ═══════════════════════════════════════════════════
// TACTICAL COORDINATION
// ═══════════════════════════════════════════════════

/**
 * Coordinate enemy group tactics.
 * Called once per round before individual enemy turns.
 * Returns tactical directives for each enemy.
 */
export function coordinateGroupTactics(allEnemies, alivePCs, combatState = {}) {
  const aliveEnemies = allEnemies.filter(e => e.currentHP > 0);
  if (aliveEnemies.length === 0 || alivePCs.length === 0) return {};

  const directives = {};

  // Determine group intelligence (highest tier creature leads)
  const tiers = aliveEnemies.map(e => getIntelligenceTierEnhanced(e));
  const tierOrder = ['mindless', 'fearless', 'bestial', 'cunning', 'genius'];
  const bestTier = tiers.reduce((best, t) => tierOrder.indexOf(t) > tierOrder.indexOf(best) ? t : best, 'mindless');

  // ── Focus Fire ──
  // Cunning+ groups pick a primary target and coordinate
  if (bestTier === 'cunning' || bestTier === 'genius') {
    // Score PCs for focus fire
    const pcScores = alivePCs.map(pc => {
      let score = 0;
      const cls = (pc.class || pc.className || '').toLowerCase();
      const hpPct = pc.currentHP / pc.maxHP;

      // Priority: casters > healers > low HP > low AC
      if (['wizard', 'sorcerer', 'witch', 'arcanist'].includes(cls)) score += 40;
      if (['cleric', 'oracle', 'druid', 'shaman'].includes(cls)) score += 30;
      if (hpPct < 0.3) score += 25; // Finish wounded
      if (hpPct < 0.5) score += 10;
      score += Math.max(0, 18 - (pc.ac || 10)); // Lower AC = easier

      return { pc, score };
    });
    pcScores.sort((a, b) => b.score - a.score);
    const primaryTarget = pcScores[0]?.pc;

    if (primaryTarget) {
      // 60% of enemies focus the primary target
      for (let i = 0; i < aliveEnemies.length; i++) {
        const e = aliveEnemies[i];
        const eTier = getIntelligenceTierEnhanced(e);
        if (eTier === 'mindless') continue; // Mindless don't coordinate

        directives[e.id] = directives[e.id] || {};
        if (i < Math.ceil(aliveEnemies.length * 0.6)) {
          directives[e.id].focusTarget = primaryTarget.id;
          directives[e.id].focusTargetName = primaryTarget.name;
        }
      }
    }
  }

  // ── Flanking Bonus ──
  // If 2+ melee enemies attack same target, they get +2 flanking
  // (Track this as a directive; actual bonus applied during attack resolution)
  const targetCounts = {};
  for (const [eId, d] of Object.entries(directives)) {
    if (d.focusTarget) {
      targetCounts[d.focusTarget] = (targetCounts[d.focusTarget] || 0) + 1;
    }
  }
  for (const [eId, d] of Object.entries(directives)) {
    if (d.focusTarget && targetCounts[d.focusTarget] >= 2) {
      d.flanking = true;
      d.flankingBonus = 2;
    }
  }

  // ── Protect Caster ──
  // If group has a spellcaster, melee creatures try to stay near it
  const casterEnemy = aliveEnemies.find(e => {
    const abilities = detectAbilities(e);
    return abilities.includes('spellcaster') || abilities.includes('spellLikeAbilities');
  });
  if (casterEnemy && bestTier === 'cunning') {
    const nonCasters = aliveEnemies.filter(e => e.id !== casterEnemy.id);
    if (nonCasters.length > 0) {
      // Assign one guard
      const guard = nonCasters[0];
      directives[guard.id] = directives[guard.id] || {};
      directives[guard.id].protectAlly = casterEnemy.id;
      directives[guard.id].protectAllyName = casterEnemy.name;
    }
  }

  return directives;
}

// ═══════════════════════════════════════════════════
// SPECIAL ABILITY RESOLUTION
// ═══════════════════════════════════════════════════

/**
 * Resolve a breath weapon attack.
 * Returns damage and affected targets.
 */
export function resolveBreathWeapon(enemy, alivePCs) {
  // Determine breath weapon damage based on CR
  const cr = enemy.cr || 1;
  const damageDice = Math.max(1, Math.ceil(cr));
  const damageSides = cr >= 10 ? 10 : cr >= 5 ? 8 : 6;
  const damage = rollDice(damageDice, damageSides).total;

  // DC = 10 + 1/2 CR + CON mod (approximate)
  const conMod = enemy.con ? mod(parseInt(enemy.con)) : 0;
  const dc = 10 + Math.floor(cr / 2) + conMod;

  // Each PC makes a Reflex save (uses full rules engine: base + ability + feats + racial bonuses)
  // Breath weapons are supernatural abilities, not spells — no conditional racial save bonuses apply
  const results = alivePCs.map(pc => {
    const d20 = roll(20);
    const saveData = computeSave(pc, 'Ref', {}, { isSpell: false });
    const total = d20 + saveData.total;
    const saved = d20 === 1 ? false : (d20 === 20 ? true : total >= dc);
    // Apply Evasion (Monk/Rogue/Ranger): Reflex half → 0 on pass, Improved Evasion: half on fail
    const evasionResult = applyEvasion(pc, saved, damage);
    return {
      target: pc,
      damage: evasionResult.finalDamage,
      saved,
      saveRoll: total,
      natural: d20,
      saveBonus: saveData.total,
      dc,
      evasionApplied: evasionResult.evasionApplied,
      evasionMessage: evasionResult.evasionApplied ? evasionResult.message : null,
    };
  });

  return {
    type: 'breath_weapon',
    totalDamage: damage,
    dc,
    damageDice: `${damageDice}d${damageSides}`,
    results,
  };
}

/**
 * Resolve a trip attempt.
 */
export function resolveTripAttempt(enemy, target) {
  const cmb = enemy.cmb || (enemy.bab || 0) + mod(parseInt(enemy.str || 10));
  let cmd = target.cmd || (10 + (target.bab || 0) + mod(parseInt(target.str || 10)) + mod(parseInt(target.dex || 10)));
  // Racial Stability bonus (Dwarf +4 CMD vs trip)
  const stability = target.racialCombatBonuses?.stability;
  if (stability && stability.vsManeuvers.includes('trip')) cmd += stability.cmdBonus;

  const cmbRoll = roll(20) + cmb;
  const success = cmbRoll >= cmd;

  return {
    type: 'trip',
    success,
    cmbRoll: cmbRoll - cmb,
    cmbTotal: cmbRoll,
    cmd,
    condition: success ? { id: 'prone', name: 'Prone', duration: -1 } : null,
  };
}

/**
 * Resolve a grab (grapple initiation) attempt.
 */
export function resolveGrabAttempt(enemy, target) {
  const cmb = enemy.cmb || (enemy.bab || 0) + mod(parseInt(enemy.str || 10));
  let cmd = target.cmd || (10 + (target.bab || 0) + mod(parseInt(target.str || 10)) + mod(parseInt(target.dex || 10)));
  // Racial Stability bonus — note: Stability is specifically vs bull rush and trip, NOT grapple per CRB
  // But we check anyway in case the data includes it

  const cmbRoll = roll(20) + cmb;
  const success = cmbRoll >= cmd;

  return {
    type: 'grab',
    success,
    cmbRoll: cmbRoll - cmb,
    cmbTotal: cmbRoll,
    cmd,
    condition: success ? { id: 'grappled', name: 'Grappled', duration: -1 } : null,
  };
}

/**
 * Resolve frightful presence.
 * All PCs within range must make Will saves or be shaken/frightened.
 */
export function resolveFrightfulPresence(enemy, alivePCs) {
  const cr = enemy.cr || 1;
  const dc = 10 + Math.floor(cr / 2) + mod(parseInt(enemy.cha || 10));

  // Frightful presence is a fear effect — Halfling Fearless (+2 vs fear) applies
  const results = alivePCs.map(pc => {
    const d20 = roll(20);
    const saveData = computeSave(pc, 'Will', {}, { descriptors: ['fear'] });
    const total = d20 + saveData.total;
    const saved = d20 === 1 ? false : (d20 === 20 ? true : total >= dc);
    return {
      target: pc,
      saved,
      saveRoll: total,
      natural: d20,
      saveBonus: saveData.total,
      dc,
      condition: saved ? null : { id: 'shaken', name: 'Shaken', duration: 3 + roll(4) },
    };
  });

  return { type: 'frightful_presence', dc, results };
}

// ═══════════════════════════════════════════════════
// ENCOUNTER DIFFICULTY ANALYSIS
// ═══════════════════════════════════════════════════

/**
 * Analyze encounter difficulty and suggest adjustments.
 * Returns a difficulty assessment with recommendations.
 */
export function analyzeEncounterDifficulty(enemies, party) {
  // Calculate total XP budget
  const totalEnemyXP = enemies.reduce((sum, e) => sum + (e.xp || 0), 0);

  // Average party level
  const avgLevel = party.reduce((sum, p) => sum + (p.level || 1), 0) / Math.max(party.length, 1);

  // Expected XP thresholds (PF1e guidelines)
  const easyXP = avgLevel * 300 * party.length;
  const averageXP = avgLevel * 600 * party.length;
  const challengingXP = avgLevel * 900 * party.length;
  const hardXP = avgLevel * 1200 * party.length;
  const epicXP = avgLevel * 1600 * party.length;

  let difficulty, color;
  if (totalEnemyXP <= easyXP) { difficulty = 'Easy'; color = '#4CAF50'; }
  else if (totalEnemyXP <= averageXP) { difficulty = 'Average'; color = '#8BC34A'; }
  else if (totalEnemyXP <= challengingXP) { difficulty = 'Challenging'; color = '#FF9800'; }
  else if (totalEnemyXP <= hardXP) { difficulty = 'Hard'; color = '#F44336'; }
  else { difficulty = 'Epic'; color = '#9C27B0'; }

  // Count special abilities across all enemies
  const allAbilities = enemies.flatMap(e => detectAbilities(e));
  const uniqueAbilities = [...new Set(allAbilities)];

  // Tactical threat assessment
  const hasSpellcasters = uniqueAbilities.includes('spellcaster') || uniqueAbilities.includes('spellLikeAbilities');
  const hasAoE = uniqueAbilities.includes('breathWeapon') || hasSpellcasters;
  const hasCrowdControl = uniqueAbilities.includes('grab') || uniqueAbilities.includes('trip') || uniqueAbilities.includes('web');
  const hasFear = uniqueAbilities.includes('frightfulPresence') || uniqueAbilities.includes('fear');

  const threats = [];
  if (hasSpellcasters) threats.push('Enemy spellcasters present');
  if (hasAoE) threats.push('AoE damage threats');
  if (hasCrowdControl) threats.push('Crowd control abilities');
  if (hasFear) threats.push('Fear effects');
  if (enemies.length > party.length * 2) threats.push('Outnumbered significantly');

  return {
    difficulty,
    color,
    totalEnemyXP,
    avgPartyLevel: avgLevel,
    partySize: party.length,
    enemyCount: enemies.length,
    specialAbilities: uniqueAbilities,
    threats,
    thresholds: { easy: easyXP, average: averageXP, challenging: challengingXP, hard: hardXP, epic: epicXP },
  };
}

// ═══════════════════════════════════════════════════
// ENCOUNTER BEHAVIOR PRESETS
// ═══════════════════════════════════════════════════

/**
 * Pre-built behavior profiles for common encounter types.
 * Applied to enemies at encounter start to give them personality.
 */
export const BEHAVIOR_PRESETS = {
  // Goblins: erratic, cowardly, pyromaniac
  goblin: {
    moraleModifier: 1.5,        // Flee more readily
    preferFire: true,            // Love fire
    erratic: true,               // Sometimes do random things
    packTactics: true,           // Bonus when allies nearby
    taunts: ['Goblin screams a war cry!', 'Goblin cackles maniacally!', 'Goblin hisses and lunges!'],
  },

  // Undead: relentless, fearless, target living
  undead: {
    moraleModifier: 0,          // Never flee (override)
    fearImmune: true,
    preferLiving: true,          // Target living creatures
    relentless: true,            // Always attack, no reposition
  },

  // Dragon: tactical genius, breath weapon priority, flyby
  dragon: {
    moraleModifier: 0.3,        // Very rarely flee
    breathFirst: true,           // Open with breath weapon
    flybyAttack: true,          // Hit and fly away
    targetCasters: true,         // Priority target spellcasters
    taunts: ['The dragon roars, shaking the very ground!', 'Ancient eyes gleam with predatory intelligence.'],
  },

  // Wolf pack: coordinated, trip attacks, surround
  pack: {
    moraleModifier: 1.0,
    tripAttacks: true,
    surroundTactics: true,       // Try to flank
    packBonus: true,             // +1 to hit per ally adjacent
  },

  // Bandit/thug: self-preserving, surrender when losing
  bandit: {
    moraleModifier: 1.2,
    surrenderThreshold: 0.3,     // Surrender at 30% HP
    preferWeakTargets: true,     // Go for easy kills
    looting: true,               // May try to loot mid-combat
  },

  // Boss monster: multi-phase, legendary actions
  boss: {
    moraleModifier: 0.2,        // Bosses don't flee easily
    multiPhase: true,            // Behavior changes at HP thresholds
    phase1Threshold: 0.75,       // Aggressive phase
    phase2Threshold: 0.4,        // Desperate phase
    legendaryActions: 1,         // Extra actions per round
  },

  // Guardian/sentry: defend position, don't pursue
  guardian: {
    moraleModifier: 0.5,
    defendPosition: true,        // Don't leave guard post
    noPursuit: true,            // Don't chase fleeing PCs
    alertAllies: true,           // Raise alarm
  },

  // Spellcaster enemy: stay at range, buff then blast
  spellcaster: {
    moraleModifier: 0.8,
    preferRange: true,           // Stay at distance
    buffFirst: true,             // Self-buff round 1
    focusDamageSpells: true,     // Prioritize damage over control
    retreatWhenEngaged: true,    // 5-foot step away from melee
  },
};

/**
 * Apply a behavior preset to an enemy.
 * Merges preset directives into the enemy's combat state.
 */
export function applyBehaviorPreset(enemy, presetName) {
  const preset = BEHAVIOR_PRESETS[presetName];
  if (!preset) return enemy;

  return {
    ...enemy,
    behaviorPreset: presetName,
    behavior: { ...preset },
  };
}

/**
 * Auto-detect the best behavior preset for a creature.
 */
export function detectBehaviorPreset(enemy) {
  const name = (enemy.name || '').toLowerCase();
  const type = (enemy.type || enemy.creature_type || '').toLowerCase();

  if (name.includes('goblin')) return 'goblin';
  if (type.includes('undead')) return 'undead';
  if (type.includes('dragon')) return 'dragon';
  if (name.includes('wolf') || name.includes('hyena') || name.includes('raptor')) return 'pack';
  if (name.includes('bandit') || name.includes('thug') || name.includes('pirate') || name.includes('brigand')) return 'bandit';
  if (name.includes('guardian') || name.includes('sentry') || name.includes('golem')) return 'guardian';

  // Check for spellcasting
  const abilities = detectAbilities(enemy);
  if (abilities.includes('spellcaster') || abilities.includes('spellLikeAbilities')) return 'spellcaster';

  // Pack animals
  if (type.includes('animal') && enemy.organization && /pack|herd|flock/i.test(enemy.organization)) return 'pack';

  return null; // No preset, use default AI
}

// ═══════════════════════════════════════════════════
// BOSS PHASE SYSTEM
// ═══════════════════════════════════════════════════

/**
 * Determine boss phase based on HP.
 * Returns phase number and any phase-change effects.
 */
export function getBossPhase(enemy) {
  if (!enemy.behavior?.multiPhase) return { phase: 1, changed: false };

  const hpPct = enemy.currentHP / enemy.hp;
  const prevPhase = enemy._currentPhase || 1;

  let phase = 1;
  if (hpPct <= (enemy.behavior.phase2Threshold || 0.4)) phase = 3;
  else if (hpPct <= (enemy.behavior.phase1Threshold || 0.75)) phase = 2;

  const changed = phase !== prevPhase;
  enemy._currentPhase = phase;

  return {
    phase,
    changed,
    effects: changed ? getPhaseTransitionEffects(phase) : [],
  };
}

function getPhaseTransitionEffects(phase) {
  switch (phase) {
    case 2:
      return [
        { type: 'narration', text: 'The creature snarls, shifting its stance — it fights with renewed ferocity!' },
        { type: 'buff', effect: 'atkBonus', value: 2 },
      ];
    case 3:
      return [
        { type: 'narration', text: 'Bloodied and desperate, the creature unleashes its full fury!' },
        { type: 'buff', effect: 'atkBonus', value: 4 },
        { type: 'buff', effect: 'dmgBonus', value: 2 },
        { type: 'buff', effect: 'acPenalty', value: -2 },
      ];
    default:
      return [];
  }
}
