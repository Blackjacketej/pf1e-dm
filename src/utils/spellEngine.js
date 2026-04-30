/**
 * PF1e Spell Engine
 *
 * Enforces spell slot consumption, prepared vs spontaneous casting rules,
 * spell level access, and casting validation.
 */

import spellSlotData from '../data/spellSlots.json';
import spellsData from '../data/spells.json';
import classesData from '../data/classes.json';
import { mod, roll } from './dice';

const classesMap = {};
classesData.forEach(c => { classesMap[c.name] = c; });

// ─────────────────────────────────────────────────────
// SPELL SLOT DATA
// ─────────────────────────────────────────────────────

const CASTING_ABILITY = spellSlotData.castingAbility || {};
const CASTING_TYPE = spellSlotData.castingType || {};

// Spells known table for spontaneous casters
const SPELLS_KNOWN = spellSlotData.spellsKnown || {};

// Classes that get spells at reduced levels
const PARTIAL_CASTER_START = {
  Paladin: 4,     // Paladins begin casting at level 4
  Ranger: 4,      // Rangers begin casting at level 4
  Bloodrager: 4,  // Bloodragers begin casting at level 4
};

// ─────────────────────────────────────────────────────
// CASTING TYPE & ABILITY
// ─────────────────────────────────────────────────────

/**
 * Is this class a spellcaster?
 */
export function isSpellcaster(className) {
  return !!CASTING_ABILITY[className];
}

/**
 * Get the casting ability for a class.
 */
export function getCastingAbility(className) {
  return CASTING_ABILITY[className] || null;
}

/**
 * Is this class a prepared caster?
 */
export function isPreparedCaster(className) {
  return CASTING_TYPE[className] === 'prepared';
}

/**
 * Is this class a spontaneous caster?
 */
export function isSpontaneousCaster(className) {
  return CASTING_TYPE[className] === 'spontaneous';
}


// ─────────────────────────────────────────────────────
// SPELL SLOT COMPUTATION
// ─────────────────────────────────────────────────────

/**
 * Get spell slots per day for a character.
 * Includes bonus spells from high ability scores.
 * @returns {object|null} Map of spell level → total slots, or null if not a caster
 */
export function getSpellSlots(character) {
  const className = character.class;
  const level = character.level || 1;
  const castAbility = CASTING_ABILITY[className];
  if (!castAbility) return null;

  const abilityScore = character.abilities?.[castAbility] || 10;
  const perDay = spellSlotData.spellsPerDay?.[className]?.[String(level)];
  if (!perDay) return null;

  // Bonus spells from high ability
  const bonusTable = spellSlotData.bonusSpells?.table || {};
  const bonusSpells = {};
  for (const [score, bonuses] of Object.entries(bonusTable)) {
    if (abilityScore >= parseInt(score)) {
      for (const [spellLevel, bonus] of Object.entries(bonuses)) {
        bonusSpells[spellLevel] = Math.max(bonusSpells[spellLevel] || 0, bonus);
      }
    }
  }

  const result = {};
  for (const [spellLevel, baseSlots] of Object.entries(perDay)) {
    const lvl = parseInt(spellLevel);
    const bonus = lvl > 0 ? (bonusSpells[spellLevel] || 0) : 0;
    result[spellLevel] = baseSlots + bonus;
  }

  return result;
}


// ─────────────────────────────────────────────────────
// SPELL LEVEL ACCESS
// ─────────────────────────────────────────────────────

/**
 * What spell levels can this character access?
 * PF1e: You need a casting ability of 10 + spell level to cast a spell of that level.
 */
export function getAccessibleSpellLevels(character) {
  const className = character.class;
  const castAbility = CASTING_ABILITY[className];
  if (!castAbility) return [];

  const abilityScore = character.abilities?.[castAbility] || 10;
  const slots = getSpellSlots(character);
  if (!slots) return [];

  const accessible = [];
  for (const [level, count] of Object.entries(slots)) {
    const lvl = parseInt(level);
    // Must have the ability score to cast this level (10 + spell level)
    if (lvl === 0 || abilityScore >= 10 + lvl) {
      accessible.push(lvl);
    }
  }

  return accessible.sort((a, b) => a - b);
}


// ─────────────────────────────────────────────────────
// SPELLS KNOWN LIMITS (Spontaneous Casters)
// ─────────────────────────────────────────────────────

/**
 * Get the maximum number of spells known per level for a spontaneous caster.
 * @returns {object|null} Map of spell level → max known, or null if prepared/non-caster
 */
export function getSpellsKnownLimits(character) {
  const className = character.class;
  if (!isSpontaneousCaster(className)) return null;

  const level = character.level || 1;
  const table = SPELLS_KNOWN[className]?.[String(level)];
  return table || null;
}


// ─────────────────────────────────────────────────────
// CASTING VALIDATION
// ─────────────────────────────────────────────────────

/**
 * Validate whether a character can cast a specific spell.
 * Checks: is a caster, has the spell known/prepared, has a slot available,
 * has the ability score to cast at that level.
 *
 * @param {object} character - Full character object
 * @param {string} spellName - Name of spell to cast
 * @param {number} [castAtLevel] - Override spell level (for heightened spells)
 * @returns {{ canCast, reason, slotLevel, slotsRemaining }}
 */
export function validateCasting(character, spellName, castAtLevel) {
  const className = character.class;
  const castAbility = CASTING_ABILITY[className];

  // Not a caster
  if (!castAbility) {
    return { canCast: false, reason: `${className} is not a spellcasting class`, slotLevel: null, slotsRemaining: 0 };
  }

  // Find the spell
  const spell = spellsData.find(s => s.name.toLowerCase() === spellName.toLowerCase());
  if (!spell) {
    return { canCast: false, reason: `Unknown spell: ${spellName}`, slotLevel: null, slotsRemaining: 0 };
  }

  // Determine spell level for this class
  const spellLevel = castAtLevel ?? getSpellLevelForClass(spell, className);
  if (spellLevel === null || spellLevel === undefined) {
    return { canCast: false, reason: `${spellName} is not on the ${className} spell list`, slotLevel: null, slotsRemaining: 0 };
  }

  // Check ability score requirement (10 + spell level)
  const abilityScore = character.abilities?.[castAbility] || 10;
  if (spellLevel > 0 && abilityScore < 10 + spellLevel) {
    return {
      canCast: false,
      reason: `${castAbility} ${abilityScore} too low to cast level ${spellLevel} spells (need ${10 + spellLevel})`,
      slotLevel: spellLevel,
      slotsRemaining: 0,
    };
  }

  // Check if character knows/has prepared this spell
  const isPrepared = isPreparedCaster(className);
  const knownSpells = character.spellsKnown || [];
  const preparedSpells = character.spellsPrepared || [];

  if (isPrepared) {
    // Prepared casters must have the spell in their prepared list
    if (!preparedSpells.some(s => s.toLowerCase() === spellName.toLowerCase()) &&
        !knownSpells.some(s => s.toLowerCase() === spellName.toLowerCase())) {
      return {
        canCast: false,
        reason: `${spellName} is not prepared — prepare it during rest`,
        slotLevel: spellLevel,
        slotsRemaining: 0,
      };
    }
  } else {
    // Spontaneous casters must have the spell in their known list
    if (!knownSpells.some(s => s.toLowerCase() === spellName.toLowerCase())) {
      return {
        canCast: false,
        reason: `${spellName} is not in your spells known`,
        slotLevel: spellLevel,
        slotsRemaining: 0,
      };
    }
  }

  // Check spell slot availability
  const slots = getSpellSlots(character);
  if (!slots) {
    return { canCast: false, reason: 'No spell slots available', slotLevel: spellLevel, slotsRemaining: 0 };
  }

  const maxSlots = slots[String(spellLevel)] || 0;
  const usedSlots = character.spellSlotsUsed?.[String(spellLevel)] || 0;
  const remaining = maxSlots - usedSlots;

  if (remaining <= 0) {
    return {
      canCast: false,
      reason: `No level ${spellLevel} spell slots remaining (${usedSlots}/${maxSlots} used)`,
      slotLevel: spellLevel,
      slotsRemaining: 0,
    };
  }

  // Cantrips (level 0) are unlimited for most classes in PF1e
  // Actually PF1e cantrips ARE limited by slots per day but can be re-prepared
  // We'll still track them but won't block 0-level casting as harshly

  return {
    canCast: true,
    reason: '',
    slotLevel: spellLevel,
    slotsRemaining: remaining - 1, // After casting
    maxSlots,
    usedSlots: usedSlots + 1,
  };
}

/**
 * Consume a spell slot. Returns updated spellSlotsUsed object.
 */
export function consumeSpellSlot(character, spellLevel) {
  const used = character.spellSlotsUsed || {};
  const current = used[String(spellLevel)] || 0;
  return {
    ...used,
    [String(spellLevel)]: current + 1,
  };
}

/**
 * Reset all spell slots (after 8 hours rest).
 */
export function resetSpellSlots() {
  return {};
}


// ─────────────────────────────────────────────────────
// SPELL LEVEL LOOKUP
// ─────────────────────────────────────────────────────

/**
 * Determine what level a spell is for a given class.
 * Parses the spell's level field which may be like "Wizard 3, Sorcerer 3, Cleric 4"
 */
export function getSpellLevelForClass(spell, className) {
  if (!spell?.level) return null;

  const levelStr = String(spell.level);

  // Handle numeric-only levels
  if (/^\d+$/.test(levelStr.trim())) {
    return parseInt(levelStr.trim());
  }

  // Parse "ClassName N" pairs
  const pairs = levelStr.split(/[,;]/);
  for (const pair of pairs) {
    const match = pair.trim().match(/(\w[\w\s/]*?)\s+(\d+)/);
    if (match) {
      const cls = match[1].trim();
      const lvl = parseInt(match[2]);
      // Match class name (handle abbreviations and alternates)
      if (cls.toLowerCase() === className.toLowerCase() ||
          cls.toLowerCase().includes(className.toLowerCase().substring(0, 4))) {
        return lvl;
      }
      // Sor/Wiz shorthand
      if (cls.toLowerCase().includes('sor') && (className === 'Sorcerer' || className === 'Wizard')) return lvl;
      if (cls.toLowerCase().includes('wiz') && className === 'Wizard') return lvl;
      if (cls.toLowerCase().includes('clr') && className === 'Cleric') return lvl;
      if (cls.toLowerCase().includes('drd') && className === 'Druid') return lvl;
    }
  }

  return null;
}


// ─────────────────────────────────────────────────────
// PREPARED CASTER SPELL PREPARATION
// ─────────────────────────────────────────────────────

/**
 * Validate a prepared spell list against available slots.
 * For prepared casters (Wizard, Cleric, Druid, etc.)
 * @param {string[]} preparedList - Spells the caster wants to prepare
 * @param {object} character - Character object
 * @returns {{ valid, issues, preparedByLevel }}
 */
export function validatePreparedSpells(preparedList, character) {
  const slots = getSpellSlots(character);
  if (!slots) return { valid: false, issues: ['Not a spellcaster'], preparedByLevel: {} };

  const issues = [];
  const preparedByLevel = {};
  const countByLevel = {};

  for (const spellName of preparedList) {
    const spell = spellsData.find(s => s.name.toLowerCase() === spellName.toLowerCase());
    if (!spell) {
      issues.push(`Unknown spell: ${spellName}`);
      continue;
    }

    const spellLevel = getSpellLevelForClass(spell, character.class);
    if (spellLevel === null) {
      issues.push(`${spellName} is not on the ${character.class} spell list`);
      continue;
    }

    const lvlKey = String(spellLevel);
    countByLevel[lvlKey] = (countByLevel[lvlKey] || 0) + 1;

    if (!preparedByLevel[lvlKey]) preparedByLevel[lvlKey] = [];
    preparedByLevel[lvlKey].push(spellName);
  }

  // Check slot limits
  for (const [lvl, count] of Object.entries(countByLevel)) {
    const maxSlots = slots[lvl] || 0;
    if (count > maxSlots) {
      issues.push(`Too many level ${lvl} spells prepared: ${count}/${maxSlots}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    preparedByLevel,
  };
}


// ─────────────────────────────────────────────────────
// SPELL RESISTANCE
// ─────────────────────────────────────────────────────

/**
 * Check spell resistance.
 * Caster must roll d20 + caster level >= target's SR.
 */
export function checkSpellResistance(casterLevel, targetSR, d20Roll) {
  if (!targetSR || targetSR <= 0) return { applies: false, overcame: true };

  const total = d20Roll + casterLevel;
  return {
    applies: true,
    overcame: total >= targetSR,
    total,
    casterLevel,
    targetSR,
    breakdown: `${d20Roll} + ${casterLevel} CL = ${total} vs SR ${targetSR}`,
  };
}


// ─────────────────────────────────────────────────────
// ANTI-MAGIC / SPELL FAILURE
// ─────────────────────────────────────────────────────

/**
 * Arcane spell failure chance from armor.
 * Arcane casters wearing armor they're not specifically trained for suffer spell failure.
 */
export function getArcaneSpellFailure(character) {
  const arcaneClasses = ['Wizard', 'Sorcerer', 'Bard', 'Witch', 'Magus', 'Bloodrager', 'Summoner'];
  if (!arcaneClasses.includes(character.class)) return { chance: 0, applies: false };

  // Bard and Magus have special proficiency that negates spell failure for certain armors
  if (character.class === 'Bard' && isLightArmor(character.armor)) return { chance: 0, applies: false };
  if (character.class === 'Magus' && isLightArmor(character.armor)) return { chance: 0, applies: false };

  const armorFailure = getArmorSpellFailure(character.armor);
  const shieldFailure = getShieldSpellFailure(character.shield);
  const totalChance = armorFailure + shieldFailure;

  return {
    chance: totalChance,
    applies: totalChance > 0,
    armorFailure,
    shieldFailure,
  };
}

function isLightArmor(armorName) {
  if (!armorName || armorName === 'None') return true;
  const lightArmor = ['padded', 'leather', 'studded leather', 'chain shirt'];
  return lightArmor.some(a => (armorName || '').toLowerCase().includes(a));
}

function getArmorSpellFailure(armorName) {
  if (!armorName || armorName === 'None') return 0;
  const failureMap = {
    'padded': 5, 'leather': 10, 'studded leather': 15, 'chain shirt': 20,
    'hide': 20, 'scale mail': 25, 'chainmail': 30, 'breastplate': 25,
    'splint mail': 40, 'banded mail': 35, 'half-plate': 40, 'full plate': 35,
  };
  const aName = (armorName || '').toLowerCase();
  const entry = Object.entries(failureMap).find(([key]) => aName.includes(key));
  return entry ? entry[1] : 0;
}

function getShieldSpellFailure(shieldName) {
  if (!shieldName || shieldName === 'None') return 0;
  const failureMap = {
    'buckler': 5, 'light shield': 5, 'heavy shield': 15, 'tower shield': 50,
  };
  const sName = (shieldName || '').toLowerCase();
  const entry = Object.entries(failureMap).find(([key]) => sName.includes(key));
  return entry ? entry[1] : 0;
}

/**
 * Roll for arcane spell failure.
 * @param {number} failureChance - Percentage (0-100)
 * @param {number} d100Roll - The percentile roll
 * @returns {{ failed, roll, chance }}
 */
export function rollArcaneSpellFailure(failureChance, d100Roll) {
  return {
    failed: d100Roll <= failureChance,
    roll: d100Roll,
    chance: failureChance,
  };
}


// ─────────────────────────────────────────────────────
// SPELL COMPONENT VALIDATION
// ─────────────────────────────────────────────────────

/**
 * Parse spell components string into structured flags.
 * @param {string} componentsStr - e.g., "V, S, M (a pinch of sand)"
 * @returns {{ verbal: boolean, somatic: boolean, material: boolean, focus: boolean, divineFocus: boolean, materialDesc: string }}
 */
export function parseSpellComponents(componentsStr) {
  if (!componentsStr) return { verbal: false, somatic: false, material: false, focus: false, divineFocus: false, materialDesc: '' };
  const str = componentsStr.toUpperCase();
  const materialMatch = (componentsStr || '').match(/M\s*\(([^)]+)\)/i);
  return {
    verbal: /\bV\b/.test(str),
    somatic: /\bS\b/.test(str),
    material: /\bM\b/.test(str),
    focus: /\bF\b/.test(str),
    divineFocus: /\bDF\b/.test(str),
    materialDesc: materialMatch ? materialMatch[1] : '',
  };
}

/**
 * Check if spell components can be performed given active conditions.
 * @param {object} components - From parseSpellComponents()
 * @param {object} conditionMods - Aggregated condition modifiers
 * @param {string[]} conditionNames - List of active condition names (lowercase)
 * @returns {{ canCast: boolean, blocked: string[] }}
 */
export function validateSpellComponents(components, conditionMods = {}, conditionNames = []) {
  const blocked = [];

  // Verbal: blocked by silence, unconscious, or any condition that prevents speech
  if (components.verbal) {
    if (conditionNames.includes('silenced') || conditionNames.includes('silence')) {
      blocked.push('Cannot provide verbal component (silenced)');
    }
  }

  // Somatic: blocked by paralysis, grappled, pinned, bound, or if both hands occupied
  if (components.somatic) {
    if (conditionMods.cannotMove || conditionNames.includes('paralyzed') || conditionNames.includes('petrified')) {
      blocked.push('Cannot provide somatic component (paralyzed/petrified)');
    }
    if (conditionNames.includes('pinned')) {
      blocked.push('Cannot provide somatic component (pinned)');
    }
    // Grappled allows somatic but with concentration check — handled separately
  }

  // General blocks
  if (conditionMods.cannotAct) {
    blocked.push('Cannot cast — incapacitated');
  }
  if (conditionMods.cannotCast) {
    blocked.push('Cannot cast — condition prevents spellcasting');
  }

  return { canCast: blocked.length === 0, blocked };
}


// ─────────────────────────────────────────────────────
// CONCENTRATION CHECK TRIGGERS
// ─────────────────────────────────────────────────────

/**
 * Determine what concentration checks are needed given the casting situation.
 * @param {object} situation - { castingDefensively, damageTaken, grappled, entangled, vigorousMotion, violentMotion, spellLevel }
 * @returns {Array<{ type: string, dc: number, description: string }>}
 */
export function getRequiredConcentrationChecks(situation) {
  const checks = [];
  const sl = situation.spellLevel || 0;

  if (situation.castingDefensively) {
    checks.push({
      type: 'casting_defensively',
      dc: 15 + sl * 2,
      description: `Casting defensively (DC ${15 + sl * 2})`,
    });
  }

  if (situation.damageTaken > 0) {
    const dc = 10 + situation.damageTaken + sl;
    checks.push({
      type: 'damaged',
      dc,
      description: `Damaged while casting (DC ${dc}: 10 + ${situation.damageTaken} dmg + ${sl} spell level)`,
    });
  }

  if (situation.grappled) {
    const dc = 10 + sl + 5;
    checks.push({
      type: 'grappled',
      dc,
      description: `Grappled while casting (DC ${dc})`,
    });
  }

  if (situation.entangled) {
    const dc = 15 + sl;
    checks.push({
      type: 'entangled',
      dc,
      description: `Entangled while casting (DC ${dc})`,
    });
  }

  if (situation.vigorousMotion) {
    const dc = 10 + sl;
    checks.push({
      type: 'vigorous_motion',
      dc,
      description: `Vigorous motion while casting (DC ${dc})`,
    });
  }

  if (situation.violentMotion) {
    const dc = 15 + sl;
    checks.push({
      type: 'violent_motion',
      dc,
      description: `Violent motion while casting (DC ${dc})`,
    });
  }

  return checks;
}


// ─────────────────────────────────────────────────────
// FULL SPELL RESOLUTION PIPELINE
// ─────────────────────────────────────────────────────

/**
 * Complete spell casting resolution — runs ALL PF1e checks in order.
 *
 * Pipeline:
 * 1. Validate caster is a spellcaster with available slots
 * 2. Check conditions that prevent casting (cannotAct, cannotCast)
 * 3. Check spell components vs conditions (V/S/M)
 * 4. Check ability score minimum
 * 5. Roll arcane spell failure (if applicable)
 * 6. Roll concentration checks (if casting defensively, grappled, damaged, etc.)
 * 7. Check spell resistance (if target has SR and spell allows SR)
 * 8. Consume spell slot
 *
 * @param {object} caster - Character/creature object
 * @param {string} spellName - Name of spell being cast
 * @param {object} [options] - Optional parameters
 * @param {object} [options.target] - Target creature (for SR check)
 * @param {boolean} [options.castDefensively] - Casting defensively to avoid AoO
 * @param {number} [options.damageTaken] - Damage taken this round (triggers concentration)
 * @param {object} [options.conditionMods] - Aggregated condition modifiers
 * @param {string[]} [options.conditionNames] - Active condition names
 * @param {number} [options.castAtLevel] - Override spell level
 * @returns {object} Full resolution result
 */
export function resolveSpellCasting(caster, spellName, options = {}) {
  const result = {
    success: false,
    spellName,
    casterName: caster.name || 'Unknown',
    steps: [],         // Array of { step, passed, detail }
    slotConsumed: false,
    spellFizzled: false,
    concentrationFailed: false,
    srBlocked: false,
    reason: '',
  };

  // ── Step 1: Basic validation ──
  const validation = validateCasting(caster, spellName, options.castAtLevel);
  if (!validation.canCast) {
    result.steps.push({ step: 'Validation', passed: false, detail: validation.reason });
    result.reason = validation.reason;
    return result;
  }
  result.steps.push({ step: 'Validation', passed: true, detail: `Level ${validation.slotLevel} slot available (${validation.slotsRemaining} will remain)` });
  result.spellLevel = validation.slotLevel;

  // ── Step 2: Condition blocks ──
  const condMods = options.conditionMods || {};
  const condNames = (options.conditionNames || []).map(n => n.toLowerCase());

  if (condMods.cannotAct) {
    result.steps.push({ step: 'Conditions', passed: false, detail: 'Cannot act — incapacitated' });
    result.reason = 'Incapacitated — cannot cast';
    return result;
  }
  if (condMods.cannotCast) {
    result.steps.push({ step: 'Conditions', passed: false, detail: 'A condition prevents spellcasting' });
    result.reason = 'Condition prevents spellcasting';
    return result;
  }

  // ── Step 3: Spell component validation ──
  const spell = spellsData.find(s => s.name.toLowerCase() === spellName.toLowerCase());
  if (spell?.components) {
    const components = parseSpellComponents(spell.components);
    const componentCheck = validateSpellComponents(components, condMods, condNames);
    if (!componentCheck.canCast) {
      result.steps.push({ step: 'Components', passed: false, detail: componentCheck.blocked.join('; ') });
      result.reason = componentCheck.blocked[0];
      return result;
    }
    result.steps.push({ step: 'Components', passed: true, detail: `Components: ${spell.components}` });
  }

  // ── Step 4: Arcane spell failure ──
  const asf = getArcaneSpellFailure(caster);
  if (asf.applies && asf.chance > 0) {
    const failRoll = Math.floor(Math.random() * 100) + 1;
    if (failRoll <= asf.chance) {
      result.steps.push({ step: 'Arcane Spell Failure', passed: false, detail: `Rolled ${failRoll} vs ${asf.chance}% — spell fizzles` });
      result.spellFizzled = true;
      result.slotConsumed = true; // Slot is consumed even on fizzle
      result.reason = `Arcane spell failure (rolled ${failRoll} vs ${asf.chance}%)`;
      return result;
    }
    result.steps.push({ step: 'Arcane Spell Failure', passed: true, detail: `Rolled ${failRoll} vs ${asf.chance}% — passed` });
  }

  // ── Step 5: Concentration checks ──
  const situation = {
    spellLevel: validation.slotLevel,
    castingDefensively: options.castDefensively || false,
    damageTaken: options.damageTaken || 0,
    grappled: condNames.includes('grappled'),
    entangled: condNames.includes('entangled'),
    vigorousMotion: false,
    violentMotion: false,
  };

  const concChecks = getRequiredConcentrationChecks(situation);
  for (const check of concChecks) {
    const concRoll = roll(20);
    const castAbility = CASTING_ABILITY[caster.class] || 'INT';
    const abilityMod = mod(caster.abilities?.[castAbility] || 10);
    const casterLevel = caster.level || 1;
    const combatCasting = (caster.feats || []).some(f => typeof f === 'string' && f.toLowerCase().includes('combat casting')) ? 4 : 0;
    const concTotal = concRoll + casterLevel + abilityMod + combatCasting + (condMods.concentration || 0);

    if (concTotal >= check.dc) {
      result.steps.push({
        step: 'Concentration',
        passed: true,
        detail: `${check.description}: rolled ${concRoll}+${casterLevel}+${abilityMod}${combatCasting ? '+4 Combat Casting' : ''}=${concTotal} vs DC ${check.dc} — passed`,
      });
    } else {
      result.steps.push({
        step: 'Concentration',
        passed: false,
        detail: `${check.description}: rolled ${concRoll}+${casterLevel}+${abilityMod}${combatCasting ? '+4 Combat Casting' : ''}=${concTotal} vs DC ${check.dc} — FAILED`,
      });
      result.concentrationFailed = true;
      result.slotConsumed = true; // Slot consumed on concentration failure
      result.reason = `Concentration check failed (${concTotal} vs DC ${check.dc})`;
      return result;
    }
  }

  // ── Step 6: Spell Resistance ──
  if (options.target && spell) {
    // Check if spell allows SR
    const srApplies = spell.sr === true || spell.sr === 'yes' ||
      (typeof spell.sr === 'string' && spell.sr.toLowerCase().includes('yes'));

    if (srApplies && options.target.sr && options.target.sr > 0) {
      const srRoll = roll(20);
      const casterLevel = caster.level || 1;
      // Elven Magic: +2 racial bonus to caster level checks to overcome spell resistance
      const srPenetrationBonus = caster.racialCombatBonuses?.elvenMagic?.srPenetrationBonus || 0;
      const srResult = checkSpellResistance(casterLevel + srPenetrationBonus, options.target.sr, srRoll);

      if (srResult.overcame) {
        result.steps.push({
          step: 'Spell Resistance',
          passed: true,
          detail: `${srResult.breakdown} — overcame SR`,
        });
      } else {
        result.steps.push({
          step: 'Spell Resistance',
          passed: false,
          detail: `${srResult.breakdown} — blocked by SR`,
        });
        result.srBlocked = true;
        result.slotConsumed = true; // Slot consumed even when SR blocks
        result.reason = `Spell blocked by SR ${options.target.sr} (rolled ${srResult.total})`;
        return result;
      }
    }
  }

  // ── Step 7: Success — consume slot ──
  result.success = true;
  result.slotConsumed = true;
  result.steps.push({ step: 'Cast', passed: true, detail: `${spellName} cast successfully` });

  // Compute spell DC for the caller
  if (spell?.school) {
    const castAbility = CASTING_ABILITY[caster.class] || 'INT';
    const abilityMod = mod(caster.abilities?.[castAbility] || 10);
    let spellFocusBonus = 0;
    const feats = (caster.feats || []).map(f => typeof f === 'string' ? f.toLowerCase() : '');
    if (spell.school && feats.some(f => f.includes('spell focus') && f.includes(spell.school.toLowerCase()))) {
      spellFocusBonus += 1;
      if (feats.some(f => f.includes('greater spell focus') && f.includes(spell.school.toLowerCase()))) {
        spellFocusBonus += 1;
      }
    }
    // Gnome Magic: +1 DC to illusion spells (PF1e CRB racial trait)
    let racialDCBonus = 0;
    const gnomeMagic = caster.racialCombatBonuses?.gnomeMagic;
    if (gnomeMagic && spell.school && spell.school.toLowerCase() === 'illusion') {
      racialDCBonus = gnomeMagic.illusionDCBonus || 0;
    }

    result.spellDC = 10 + validation.slotLevel + abilityMod + spellFocusBonus + racialDCBonus;
  }

  // Include saving throw type from spell data
  if (spell?.savingThrow) {
    result.savingThrow = spell.savingThrow;
  }

  return result;
}


// ─────────────────────────────────────────────────────
// ENEMY SPELL SLOT TRACKING
// ─────────────────────────────────────────────────────

/**
 * Initialize spell slots for an enemy caster based on their level and class.
 * Call this when creating enemies that can cast spells.
 * @param {object} enemy - Enemy object with class and level
 * @returns {object|null} Spell slots object or null if not a caster
 */
export function initEnemySpellSlots(enemy) {
  const className = enemy.class || enemy.casterClass;
  if (!className || !CASTING_ABILITY[className]) return null;

  const slots = getSpellSlots({ class: className, level: enemy.level || 1, abilities: enemy.abilities || {} });
  return slots ? { ...slots } : null;
}

/**
 * Check if enemy can cast a spell at a given level.
 * @param {object} enemy - Enemy with spellSlots and spellSlotsUsed
 * @param {number} spellLevel - Level of spell to cast
 * @returns {{ canCast: boolean, remaining: number }}
 */
export function enemyCanCastSpell(enemy, spellLevel) {
  if (!enemy.spellSlots) return { canCast: true, remaining: 999 }; // Untracked = allow (backward compat)
  const max = enemy.spellSlots[String(spellLevel)] || 0;
  const used = enemy.spellSlotsUsed?.[String(spellLevel)] || 0;
  const remaining = max - used;
  return { canCast: remaining > 0, remaining };
}

/**
 * Consume an enemy spell slot.
 * @param {object} enemy - Enemy object (mutated in place)
 * @param {number} spellLevel - Level consumed
 */
export function consumeEnemySpellSlot(enemy, spellLevel) {
  if (!enemy.spellSlotsUsed) enemy.spellSlotsUsed = {};
  enemy.spellSlotsUsed[String(spellLevel)] = (enemy.spellSlotsUsed[String(spellLevel)] || 0) + 1;
}


// ─────────────────────────────────────────────────────
// SPELL DETAIL LOOKUP
// ─────────────────────────────────────────────────────

/**
 * Get comprehensive spell details for AI context or UI display.
 * @param {string} spellName - Name of the spell
 * @param {string} className - Caster's class name
 * @returns {object|null} Spell details or null if not found
 */
export function getSpellDetails(spellName, className) {
  const spell = spellsData.find(s => s.name.toLowerCase() === spellName.toLowerCase());
  if (!spell) return null;

  const spellLevel = getSpellLevelForClass(spell, className);
  const components = parseSpellComponents(spell.components);

  return {
    name: spell.name,
    school: spell.school || 'universal',
    subschool: spell.subschool || '',
    descriptor: spell.descriptor || '',
    level: spellLevel,
    castingTime: spell.castingTime || '1 standard action',
    components,
    componentsRaw: spell.components || '',
    range: spell.range || '',
    target: spell.target || spell.effect || '',
    duration: spell.duration || 'instantaneous',
    savingThrow: spell.savingThrow || 'none',
    spellResistance: spell.sr === true || spell.sr === 'yes' || (typeof spell.sr === 'string' && spell.sr.toLowerCase().includes('yes')),
    description: spell.description || spell.benefit || '',
  };
}
