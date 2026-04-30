/**
 * PF1e Condition Tracker
 *
 * Tracks active conditions on characters with mechanical modifiers and durations.
 * Each condition has defined mechanical effects that are consumed by rulesEngine.js.
 */

// ─────────────────────────────────────────────────────
// CONDITION DEFINITIONS
// Full PF1e condition rules with all mechanical modifiers.
// ─────────────────────────────────────────────────────

export const PF1E_CONDITIONS = {
  // ── Major Debuffs ──
  blinded: {
    name: 'Blinded',
    severity: 'severe',
    description: 'Cannot see. -2 AC, loses DEX bonus to AC, -4 on most STR/DEX checks, opponents get +2 to hit.',
    modifiers: {
      ac: -2,
      loseDexToAC: true,
      attack: -4,    // Actually -2 to attack + possible miss chance, simplified
      skills: { all_str: -4, all_dex: -4 },
      saves: {},
      speed: 0.5,    // Half speed
      missChance: 50, // 50% miss chance on all attacks
    },
  },
  confused: {
    name: 'Confused',
    severity: 'severe',
    description: 'Acts randomly. 01-25: act normally, 26-50: babble, 51-75: deal 1d8+STR to self, 76-100: attack nearest.',
    modifiers: {
      actsRandomly: true,
    },
  },
  cowering: {
    name: 'Cowering',
    severity: 'severe',
    description: 'Frozen in fear. Loses DEX bonus to AC, -2 AC, cannot act.',
    modifiers: {
      ac: -2,
      loseDexToAC: true,
      cannotAct: true,
    },
  },
  dazed: {
    name: 'Dazed',
    severity: 'severe',
    description: 'Unable to act. Can take no actions but is not helpless.',
    modifiers: {
      cannotAct: true,
    },
  },
  dead: {
    name: 'Dead',
    severity: 'severe',
    description: 'HP reduced to negative CON score or killed outright.',
    modifiers: {
      cannotAct: true,
    },
  },
  dying: {
    name: 'Dying',
    severity: 'severe',
    description: 'Unconscious and near death. Loses 1 HP per round unless stabilized.',
    modifiers: {
      cannotAct: true,
      unconscious: true,
      hpLossPerRound: 1,
    },
  },
  helpless: {
    name: 'Helpless',
    severity: 'severe',
    description: 'Paralyzed, asleep, bound, or unconscious. DEX = 0, melee attacks get +4, subject to coup de grace.',
    modifiers: {
      cannotAct: true,
      dexOverride: 0,
      attackBonusAgainst: 4,
    },
  },
  nauseated: {
    name: 'Nauseated',
    severity: 'severe',
    description: 'Can only take a single move action per turn. Cannot attack, cast spells, or concentrate.',
    modifiers: {
      moveOnly: true,
      cannotAttack: true,
      cannotCast: true,
    },
  },
  paralyzed: {
    name: 'Paralyzed',
    severity: 'severe',
    description: 'Frozen, cannot move or act. STR and DEX = 0. Helpless.',
    modifiers: {
      cannotAct: true,
      strOverride: 0,
      dexOverride: 0,
    },
  },
  petrified: {
    name: 'Petrified',
    severity: 'severe',
    description: 'Turned to stone. Considered unconscious. If broken while petrified, similar breaks appear on restoration.',
    modifiers: {
      cannotAct: true,
      unconscious: true,
    },
  },
  stunned: {
    name: 'Stunned',
    severity: 'severe',
    description: 'Drops everything held, cannot act, -2 AC, loses DEX bonus to AC.',
    modifiers: {
      ac: -2,
      loseDexToAC: true,
      cannotAct: true,
      dropsHeld: true,
    },
  },
  unconscious: {
    name: 'Unconscious',
    severity: 'severe',
    description: 'Knocked out and helpless.',
    modifiers: {
      cannotAct: true,
      dexOverride: 0,
    },
  },

  // ── Moderate Debuffs ──
  deafened: {
    name: 'Deafened',
    severity: 'moderate',
    description: 'Cannot hear. -4 Initiative, auto-fail sound-based Perception, 20% spell failure for verbal spells.',
    modifiers: {
      initiative: -4,
      spellFailure: 20, // Additional spell failure for verbal spells
    },
  },
  entangled: {
    name: 'Entangled',
    severity: 'moderate',
    description: 'Hampered movement. -2 attack, -4 DEX, half speed, concentration check to cast (DC 15 + spell level).',
    modifiers: {
      attack: -2,
      dexPenalty: -4,
      speed: 0.5,
      concentrationDC: 15,
    },
  },
  exhausted: {
    name: 'Exhausted',
    severity: 'moderate',
    description: 'Greatly fatigued. -6 STR, -6 DEX, moves at half speed. Cannot run or charge.',
    modifiers: {
      strPenalty: -6,
      dexPenalty: -6,
      speed: 0.5,
      cannotRun: true,
      cannotCharge: true,
    },
  },
  frightened: {
    name: 'Frightened',
    severity: 'moderate',
    description: 'Fearful of source. -2 attack, saves, skills, ability checks. Must flee from source.',
    modifiers: {
      attack: -2,
      saves: { all: -2 },
      skills: { all: -2 },
      abilityChecks: -2,
      mustFlee: true,
    },
  },
  grappled: {
    name: 'Grappled',
    severity: 'moderate',
    description: 'Held by opponent. Cannot move, -4 DEX, -2 attack/CMB (except to escape). Cannot take actions requiring two hands.',
    modifiers: {
      cannotMove: true,
      dexPenalty: -4,
      attack: -2,
      cmb: -2,
    },
  },
  pinned: {
    name: 'Pinned',
    severity: 'moderate',
    description: 'Tightly held in grapple. Cannot move, flat-footed. Limited to verbal/mental actions. Cannot cast spells with somatic components.',
    modifiers: {
      cannotMove: true,
      cannotCast: true,
      loseDexToAC: true,
      ac: -4,
    },
  },
  silenced: {
    name: 'Silenced',
    severity: 'moderate',
    description: 'Cannot speak or cast spells with verbal components. Immune to language-dependent effects.',
    modifiers: {
      cannotCast: true, // Blocks verbal component spells (most spells)
    },
  },
  prone: {
    name: 'Prone',
    severity: 'moderate',
    description: 'Lying on ground. -4 melee attack, cannot use ranged weapons (except crossbow). +4 AC vs ranged, -4 AC vs melee.',
    modifiers: {
      meleeAttack: -4,
      rangedACBonus: 4,
      meleeACPenalty: -4,
      cannotUseRanged: true,
    },
  },
  sickened: {
    name: 'Sickened',
    severity: 'moderate',
    description: 'Feeling ill. -2 attack, weapon damage, saves, skills, ability checks.',
    modifiers: {
      attack: -2,
      damage: -2,
      saves: { all: -2 },
      skills: { all: -2 },
      abilityChecks: -2,
    },
  },
  staggered: {
    name: 'Staggered',
    severity: 'moderate',
    description: 'Can only take a single move or standard action per turn (not both). Can still take swift/free actions.',
    modifiers: {
      singleAction: true,
    },
  },

  // ── Minor Debuffs ──
  dazzled: {
    name: 'Dazzled',
    severity: 'minor',
    description: 'Excess light. -1 attack, sight-based Perception checks.',
    modifiers: {
      attack: -1,
      skills: { 'Perception': -1 },
    },
  },
  fatigued: {
    name: 'Fatigued',
    severity: 'minor',
    description: 'Tired. -2 STR, -2 DEX. Cannot run or charge. Becomes exhausted if fatigued again.',
    modifiers: {
      strPenalty: -2,
      dexPenalty: -2,
      cannotRun: true,
      cannotCharge: true,
    },
  },
  shaken: {
    name: 'Shaken',
    severity: 'minor',
    description: 'Minor fear. -2 attack, saves, skills, ability checks.',
    modifiers: {
      attack: -2,
      saves: { all: -2 },
      skills: { all: -2 },
      abilityChecks: -2,
    },
  },

  // ── Combat Maneuver Results ──
  feinted: {
    name: 'Feinted',
    severity: 'minor',
    description: 'Denied DEX bonus to AC against feinter\'s next melee attack (CRB p. 92).',
    modifiers: {
      loseDexToAC: true,
    },
  },

  // ── Buffs ──
  haste: {
    name: 'Haste',
    severity: 'buff',
    description: '+1 attack, +1 AC (dodge), +1 Reflex, +30 ft speed. Extra attack at highest BAB during full attack.',
    modifiers: {
      attack: 1,
      ac: 1,
      saves: { Ref: 1 },
      speedBonus: 30,
      extraAttack: true,
    },
  },
  bless: {
    name: 'Bless',
    severity: 'buff',
    description: '+1 morale bonus on attack rolls and saves vs fear.',
    modifiers: {
      attack: 1,
      saves: { fear: 1 },
    },
  },
  invisible: {
    name: 'Invisible',
    severity: 'buff',
    description: 'Cannot be seen. +2 attack, +20 on Stealth, opponents flat-footed against your attacks.',
    modifiers: {
      attack: 2,
      skills: { 'Stealth': 20 },
    },
  },
  enlarged: {
    name: 'Enlarged',
    severity: 'buff',
    description: 'Size increases one step. +2 STR, -2 DEX, -1 attack, -1 AC, reach increases.',
    modifiers: {
      strBonus: 2,
      dexPenalty: -2,
      attack: -1,
      ac: -1,
    },
  },
  barkskin: {
    name: 'Barkskin',
    severity: 'buff',
    description: '+2 natural armor (increases by 1 per 3 caster levels above 3, max +5).',
    modifiers: {
      naturalArmor: 2, // Base; can be overridden per cast
    },
  },
  rage: {
    name: 'Rage',
    severity: 'buff',
    description: '+4 STR, +4 CON, +2 Will saves, -2 AC. Cannot use skills requiring patience/concentration.',
    modifiers: {
      strBonus: 4,
      conBonus: 4,
      saves: { Will: 2 },
      ac: -2,
      cannotConcentrate: true,
    },
  },
  smiteEvil: {
    name: 'Smite Evil',
    severity: 'buff',
    description: '+CHA to attack, +paladin level to damage vs evil target. +CHA deflection to AC vs target.',
    modifiers: {
      // These are dynamic and depend on target — computed at runtime
      smiteActive: true,
    },
  },
  flanking: {
    name: 'Flanking',
    severity: 'buff',
    description: '+2 melee attack from flanking position.',
    modifiers: {
      attack: 2,
    },
  },
  fighting_defensively: {
    name: 'Fighting Defensively',
    severity: 'buff',
    description: '-4 attack, +2 AC (or +3 with 3+ ranks in Acrobatics).',
    modifiers: {
      attack: -4,
      ac: 2,
    },
  },
  charging: {
    name: 'Charging',
    severity: 'buff',
    description: '+2 melee attack, -2 AC until next turn.',
    modifiers: {
      attack: 2,
      ac: -2,
    },
  },
  total_defense: {
    name: 'Total Defense',
    severity: 'buff',
    description: '+4 AC (or +6 with 3+ ranks in Acrobatics). Cannot attack.',
    modifiers: {
      ac: 4,
      cannotAttack: true,
    },
  },
};


// ─────────────────────────────────────────────────────
// CONDITION APPLICATION & TRACKING
// ─────────────────────────────────────────────────────

/**
 * Create an active condition instance with duration tracking.
 * @param {string} conditionId - Key from PF1E_CONDITIONS
 * @param {object} [options] - { duration, source, customMods }
 * @returns {object} Active condition instance
 */
export function createCondition(conditionId, options = {}) {
  const template = PF1E_CONDITIONS[conditionId];
  if (!template) return null;

  return {
    id: conditionId,
    name: template.name,
    severity: template.severity,
    description: template.description,
    modifiers: { ...template.modifiers, ...(options.customMods || {}) },
    duration: options.duration || null,    // null = permanent/manual, number = rounds remaining
    source: options.source || 'unknown',
    appliedAt: Date.now(),
    roundsRemaining: options.duration || null,
  };
}

/**
 * Tick all conditions at round start. Decrements durations, removes expired.
 * @param {object[]} activeConditions - Array of active condition instances
 * @returns {{ conditions: object[], expired: object[] }}
 */
export function tickConditions(activeConditions) {
  if (!activeConditions?.length) return { conditions: [], expired: [] };

  const remaining = [];
  const expired = [];

  for (const cond of activeConditions) {
    if (cond.roundsRemaining !== null && cond.roundsRemaining !== undefined) {
      const newRounds = cond.roundsRemaining - 1;
      if (newRounds <= 0) {
        expired.push(cond);
      } else {
        remaining.push({ ...cond, roundsRemaining: newRounds });
      }
    } else {
      remaining.push(cond); // Permanent condition
    }
  }

  return { conditions: remaining, expired };
}

/**
 * Add HP loss per round from conditions (e.g., dying loses 1 HP/round).
 */
export function getPerRoundHPChange(activeConditions) {
  let hpChange = 0;
  for (const cond of activeConditions || []) {
    if (cond.modifiers?.hpLossPerRound) {
      hpChange -= cond.modifiers.hpLossPerRound;
    }
    if (cond.modifiers?.hpRegenPerRound) {
      hpChange += cond.modifiers.hpRegenPerRound;
    }
  }
  return hpChange;
}


// ─────────────────────────────────────────────────────
// AGGREGATE CONDITION MODIFIERS
// ─────────────────────────────────────────────────────

/**
 * Aggregate all active condition modifiers into a single modifier object.
 * This is what rulesEngine.js consumes to apply penalties/bonuses.
 * @param {object[]} activeConditions - Array of active condition instances
 * @returns {object} Aggregated modifiers
 */
export function aggregateConditionModifiers(activeConditions) {
  const result = {
    attack: 0,
    damage: 0,
    ac: 0,
    saves: { all: 0, Fort: 0, Ref: 0, Will: 0 },
    skills: { all: 0 },
    concentration: 0,
    initiative: 0,
    cmb: 0,
    cmd: 0,
    speed: 1, // multiplier
    speedBonus: 0, // flat addition
    missChance: 0,

    // Boolean flags
    cannotAct: false,
    cannotAttack: false,
    cannotCast: false,
    cannotMove: false,
    cannotCharge: false,
    cannotRun: false,
    singleAction: false,
    moveOnly: false,
    loseDexToAC: false,
    mustFlee: false,
    extraAttack: false,
    smiteActive: false,

    // Ability modifications
    strBonus: 0,
    dexBonus: 0,
    conBonus: 0,
    strPenalty: 0,
    dexPenalty: 0,
    naturalArmor: 0,
  };

  if (!activeConditions?.length) return result;

  for (const cond of activeConditions) {
    const m = cond.modifiers;
    if (!m) continue;

    // Numeric aggregation (stacking — PF1e handles stacking types but we simplify)
    if (m.attack) result.attack += m.attack;
    if (m.meleeAttack) result.attack += m.meleeAttack; // Specific melee penalty
    if (m.damage) result.damage += m.damage;
    if (m.ac) result.ac += m.ac;
    if (m.initiative) result.initiative += m.initiative;
    if (m.cmb) result.cmb += m.cmb;
    if (m.naturalArmor) result.naturalArmor = Math.max(result.naturalArmor, m.naturalArmor);

    // Saves
    if (m.saves) {
      if (m.saves.all) result.saves.all += m.saves.all;
      if (m.saves.Fort) result.saves.Fort += m.saves.Fort;
      if (m.saves.Ref) result.saves.Ref += m.saves.Ref;
      if (m.saves.Will) result.saves.Will += m.saves.Will;
    }

    // Skills (aggregate all-skill penalties)
    if (m.skills) {
      if (m.skills.all) result.skills.all += m.skills.all;
      for (const [skill, val] of Object.entries(m.skills)) {
        if (skill !== 'all') {
          result.skills[skill] = (result.skills[skill] || 0) + val;
        }
      }
    }

    // Speed — use the worst multiplier
    if (m.speed && m.speed < result.speed) result.speed = m.speed;
    if (m.speedBonus) result.speedBonus += m.speedBonus;
    if (m.missChance) result.missChance = Math.max(result.missChance, m.missChance);

    // Ability mods
    if (m.strBonus) result.strBonus += m.strBonus;
    if (m.dexBonus) result.dexBonus += m.dexBonus;
    if (m.conBonus) result.conBonus += m.conBonus;
    if (m.strPenalty) result.strPenalty += m.strPenalty;
    if (m.dexPenalty) result.dexPenalty += m.dexPenalty;

    // Concentration penalty from conditions like entangled
    if (m.concentrationDC) result.concentration += m.concentrationDC;

    // Boolean flags (any one true condition sets the flag)
    if (m.cannotAct) result.cannotAct = true;
    if (m.cannotAttack) result.cannotAttack = true;
    if (m.cannotCast) result.cannotCast = true;
    if (m.cannotMove) result.cannotMove = true;
    if (m.cannotCharge) result.cannotCharge = true;
    if (m.cannotRun) result.cannotRun = true;
    if (m.singleAction) result.singleAction = true;
    if (m.moveOnly) result.moveOnly = true;
    if (m.loseDexToAC) result.loseDexToAC = true;
    if (m.mustFlee) result.mustFlee = true;
    if (m.extraAttack) result.extraAttack = true;
    if (m.smiteActive) result.smiteActive = true;
  }

  return result;
}

/**
 * Get a human-readable summary of all active conditions and their effects.
 */
export function getConditionSummary(activeConditions) {
  if (!activeConditions?.length) return 'No active conditions.';

  return activeConditions.map(c => {
    const duration = c.roundsRemaining !== null ? ` (${c.roundsRemaining} rounds)` : '';
    return `${c.name}${duration}: ${c.description}`;
  }).join('\n');
}

/**
 * Get condition effects as a compact string for AI DM context.
 */
export function getConditionContextForAI(activeConditions) {
  if (!activeConditions?.length) return '';

  const mods = aggregateConditionModifiers(activeConditions);
  const parts = [];

  if (mods.attack) parts.push(`Attack ${mods.attack > 0 ? '+' : ''}${mods.attack}`);
  if (mods.ac) parts.push(`AC ${mods.ac > 0 ? '+' : ''}${mods.ac}`);
  if (mods.damage) parts.push(`Damage ${mods.damage > 0 ? '+' : ''}${mods.damage}`);
  if (mods.saves.all) parts.push(`Saves ${mods.saves.all > 0 ? '+' : ''}${mods.saves.all}`);
  if (mods.cannotAct) parts.push('CANNOT ACT');
  if (mods.cannotAttack) parts.push('CANNOT ATTACK');
  if (mods.cannotCast) parts.push('CANNOT CAST');
  if (mods.missChance) parts.push(`${mods.missChance}% miss chance`);
  if (mods.mustFlee) parts.push('MUST FLEE');

  const names = activeConditions.map(c => {
    const dur = c.roundsRemaining !== null ? ` ${c.roundsRemaining}rd` : '';
    return `${c.name}${dur}`;
  }).join(', ');

  return `[${names}] ${parts.length > 0 ? '→ ' + parts.join(', ') : ''}`;
}
