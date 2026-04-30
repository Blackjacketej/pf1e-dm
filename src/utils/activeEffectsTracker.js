/**
 * PF1e Active Effects Tracker
 *
 * Manages ongoing spell effects (buffs, debuffs) that have durations.
 * Integrates with the condition system and combat round ticking.
 *
 * Active effects differ from conditions:
 *   - Conditions (haste, blinded, etc.) are in PF1E_CONDITIONS and live on character.conditions[]
 *   - Active effects are spell-specific modifiers that don't map to named conditions
 *     (e.g., Mage Armor's +4 armor bonus, Bull's Strength's +4 STR)
 *
 * Both are ticked together at round start and aggregated for modifier computation.
 */

// ─────────────────────────────────────────────────────
// ACTIVE EFFECT CREATION
// ─────────────────────────────────────────────────────

/**
 * Create an active spell effect instance.
 * @param {object} params
 * @param {string} params.name — Display name (usually spell name)
 * @param {string} params.spellName — Canonical spell name
 * @param {object} params.modifiers — { armorBonus, shieldBonus, strBonus, etc. }
 * @param {number|null} params.duration — Rounds remaining, or null for permanent
 * @param {string} params.source — Who cast it
 * @param {boolean} [params.isDebuff] — Whether this is harmful
 * @param {boolean} [params.endsOnAttack] — Ends when target attacks (e.g., Invisibility)
 * @param {boolean} [params.savePerRound] — Target gets new save each round
 * @param {number} [params.saveDC] — DC for per-round saves
 * @param {string} [params.saveType] — 'Will'/'Fort'/'Ref' for per-round saves
 * @returns {object} Active effect instance
 */
export function createActiveEffect({
  name,
  spellName,
  modifiers = {},
  duration = null,
  source = 'unknown',
  isDebuff = false,
  endsOnAttack = false,
  savePerRound = false,
  saveDC = 0,
  saveType = null,
}) {
  return {
    id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    spellName: spellName || name,
    modifiers: { ...modifiers },
    duration,
    roundsRemaining: duration,
    source,
    isDebuff,
    endsOnAttack,
    savePerRound,
    saveDC,
    saveType,
    appliedAt: Date.now(),
  };
}


// ─────────────────────────────────────────────────────
// TICK / EXPIRATION
// ─────────────────────────────────────────────────────

/**
 * Tick all active effects at round start. Decrements durations, removes expired.
 * @param {object[]} activeEffects — Array of active effect instances
 * @returns {{ effects: object[], expired: object[] }}
 */
export function tickActiveEffects(activeEffects) {
  if (!activeEffects?.length) return { effects: [], expired: [] };

  const remaining = [];
  const expired = [];

  for (const effect of activeEffects) {
    if (effect.roundsRemaining !== null && effect.roundsRemaining !== undefined) {
      const newRounds = effect.roundsRemaining - 1;
      if (newRounds <= 0) {
        expired.push(effect);
      } else {
        remaining.push({ ...effect, roundsRemaining: newRounds });
      }
    } else {
      remaining.push(effect); // Permanent or manual tracking
    }
  }

  return { effects: remaining, expired };
}

/**
 * Remove an active effect by its spell name (e.g., when dispelled).
 * @param {object[]} activeEffects
 * @param {string} spellName — Spell to remove
 * @returns {object[]} Updated effects array
 */
export function removeEffectBySpell(activeEffects, spellName) {
  if (!activeEffects?.length) return [];
  return activeEffects.filter(e => e.spellName?.toLowerCase() !== spellName.toLowerCase());
}

/**
 * Remove an active effect by ID.
 */
export function removeEffectById(activeEffects, effectId) {
  if (!activeEffects?.length) return [];
  return activeEffects.filter(e => e.id !== effectId);
}

/**
 * Remove effects that end on attack (e.g., standard Invisibility).
 * Call this when the character makes an attack.
 */
export function removeOnAttackEffects(activeEffects) {
  if (!activeEffects?.length) return { effects: [], removed: [] };
  const remaining = [];
  const removed = [];
  for (const effect of activeEffects) {
    if (effect.endsOnAttack) {
      removed.push(effect);
    } else {
      remaining.push(effect);
    }
  }
  return { effects: remaining, removed };
}


// ─────────────────────────────────────────────────────
// MODIFIER AGGREGATION
// ─────────────────────────────────────────────────────

/**
 * Aggregate modifiers from all active effects into a single modifier object.
 * Follows PF1e stacking rules (same type doesn't stack, take highest).
 *
 * @param {object[]} activeEffects
 * @returns {object} Aggregated modifiers matching conditionTracker format
 */
export function aggregateActiveEffectModifiers(activeEffects) {
  const result = {
    // Typed bonuses (don't stack — take highest of each type)
    armorBonus: 0,
    shieldBonus: 0,
    naturalArmor: 0,
    deflectionBonus: 0,
    // Untyped/enhancement bonuses (do stack)
    attack: 0,
    damage: 0,
    ac: 0, // dodge or untyped
    saves: { all: 0, Fort: 0, Ref: 0, Will: 0 },
    skills: { all: 0 },
    // Ability bonuses (enhancement type — don't stack)
    strBonus: 0,
    dexBonus: 0,
    conBonus: 0,
    intBonus: 0,
    wisBonus: 0,
    chaBonus: 0,
    // Penalties (do stack)
    strPenalty: 0,
    dexPenalty: 0,
    // Speed
    speedBonus: 0,
    speed: 1,
    flySpeed: 0,
    // Special
    missChance: 0,
    dr: null,
    extraAttack: false,
    cannotCast: false,
    singleAction: false,
    tempHP: 0,
  };

  if (!activeEffects?.length) return result;

  for (const effect of activeEffects) {
    const m = effect.modifiers;
    if (!m) continue;

    // Typed bonuses: take highest (PF1e stacking rules)
    if (m.armorBonus) result.armorBonus = Math.max(result.armorBonus, m.armorBonus);
    if (m.shieldBonus) result.shieldBonus = Math.max(result.shieldBonus, m.shieldBonus);
    if (m.naturalArmor) result.naturalArmor = Math.max(result.naturalArmor, m.naturalArmor);
    if (m.deflectionBonus) result.deflectionBonus = Math.max(result.deflectionBonus, m.deflectionBonus);

    // Untyped bonuses / dodge bonuses: stack
    if (m.attack) result.attack += m.attack;
    if (m.damage) result.damage += m.damage;
    if (m.ac) result.ac += m.ac;

    // Saves
    if (m.saves) {
      if (m.saves.all) result.saves.all += m.saves.all;
      if (m.saves.Fort) result.saves.Fort += m.saves.Fort;
      if (m.saves.Ref) result.saves.Ref += m.saves.Ref;
      if (m.saves.Will) result.saves.Will += m.saves.Will;
      if (m.saves.fear) result.saves.fear = (result.saves.fear || 0) + m.saves.fear;
    }

    // Skills
    if (m.skills) {
      if (m.skills.all) result.skills.all += m.skills.all;
      for (const [skill, val] of Object.entries(m.skills)) {
        if (skill !== 'all') result.skills[skill] = (result.skills[skill] || 0) + val;
      }
    }

    // Ability bonuses: enhancement type, take highest
    if (m.strBonus) result.strBonus = Math.max(result.strBonus, m.strBonus);
    if (m.dexBonus) result.dexBonus = Math.max(result.dexBonus, m.dexBonus);
    if (m.conBonus) result.conBonus = Math.max(result.conBonus, m.conBonus);
    if (m.intBonus) result.intBonus = Math.max(result.intBonus, m.intBonus);
    if (m.wisBonus) result.wisBonus = Math.max(result.wisBonus, m.wisBonus);
    if (m.chaBonus) result.chaBonus = Math.max(result.chaBonus, m.chaBonus);

    // Penalties always stack
    if (m.strPenalty) result.strPenalty += m.strPenalty;
    if (m.dexPenalty) result.dexPenalty += m.dexPenalty;

    // Speed
    if (m.speedBonus) result.speedBonus += m.speedBonus;
    if (m.speed && m.speed < result.speed) result.speed = m.speed;
    if (m.flySpeed) result.flySpeed = Math.max(result.flySpeed, m.flySpeed);

    // Special
    if (m.missChance) result.missChance = Math.max(result.missChance, m.missChance);
    if (m.dr) result.dr = m.dr; // Last one wins for simplicity
    if (m.extraAttack) result.extraAttack = true;
    if (m.cannotCast) result.cannotCast = true;
    if (m.singleAction) result.singleAction = true;
    if (m.tempHP) result.tempHP += (typeof m.tempHP === 'number' ? m.tempHP : 0);
  }

  return result;
}


// ─────────────────────────────────────────────────────
// DISPLAY
// ─────────────────────────────────────────────────────

/**
 * Get a readable summary of active effects for UI display.
 */
export function getActiveEffectsSummary(activeEffects) {
  if (!activeEffects?.length) return '';
  return activeEffects.map(e => {
    const dur = e.roundsRemaining !== null ? ` (${e.roundsRemaining}rd)` : '';
    const modStr = formatModifiers(e.modifiers);
    return `${e.name}${dur}${modStr ? ': ' + modStr : ''}`;
  }).join(', ');
}

/**
 * Get active effects formatted for AI DM context.
 */
export function getActiveEffectsContextForAI(activeEffects) {
  if (!activeEffects?.length) return '';
  const parts = activeEffects.map(e => {
    const dur = e.roundsRemaining !== null ? ` ${e.roundsRemaining}rd` : '';
    return `${e.name}${dur}`;
  });
  return `[Active Spells: ${parts.join(', ')}]`;
}

function formatModifiers(mods) {
  if (!mods) return '';
  const parts = [];
  if (mods.armorBonus) parts.push(`+${mods.armorBonus} armor AC`);
  if (mods.shieldBonus) parts.push(`+${mods.shieldBonus} shield AC`);
  if (mods.naturalArmor) parts.push(`+${mods.naturalArmor} natural AC`);
  if (mods.deflectionBonus) parts.push(`+${mods.deflectionBonus} deflection AC`);
  if (mods.strBonus) parts.push(`+${mods.strBonus} STR`);
  if (mods.dexBonus) parts.push(`+${mods.dexBonus} DEX`);
  if (mods.conBonus) parts.push(`+${mods.conBonus} CON`);
  if (mods.attack) parts.push(`${mods.attack > 0 ? '+' : ''}${mods.attack} attack`);
  if (mods.damage) parts.push(`${mods.damage > 0 ? '+' : ''}${mods.damage} damage`);
  if (mods.missChance) parts.push(`${mods.missChance}% miss`);
  return parts.join(', ');
}
