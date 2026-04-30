/**
 * familiarEngine.js — PF1e Familiar Rules (CRB pp. 82-83, 127)
 *
 * Phase 7.1: data layer + ability ladder + master-level helper.
 * Phase 7.2: deriveFamiliarStats — full stat-block computation taking
 *            a master character + familiar choice, applying CRB p.83's
 *            "whichever is better" rules for saves and skills.
 * Phase 7.3: aggregateFamiliarModifiers + getEffectiveMaxHP — fold the
 *            master-granted familiar bonus into rulesEngine's mods
 *            aggregator so skill and save bonuses flow through every
 *            downstream computation (ShopTab bargain, WorldTab skill
 *            checks, computeSave, computeSkillCheck, AI DM summaries).
 *
 * Note on circular imports: this file imports { getBaseSave } from
 * rulesEngine, and rulesEngine imports { aggregateFamiliarModifiers }
 * from this file. The cycle is safe because both symbols are consumed
 * only inside function bodies, never at module-load time. ES module
 * bindings resolve lazily, so by the time either function is actually
 * called, both modules have finished initializing.
 *
 * All page references in this file are to pdfs/Core Rulebook (5th Printing).pdf.
 */
import familiarsData from '../data/familiars.json';
import classesData from '../data/classes.json';
import monstersData from '../data/monsters.json';
import { getBaseSave } from './rulesEngine';

// ─────────────────────────────────────────────────────────────────
// Shared ability ladder (CRB p. 83 "Familiar Ability Descriptions" table)
//
// Index 0 == "master class levels 1-2". Each row stacks with all previous
// rows (the CRB explicitly notes "The abilities are cumulative").
// ─────────────────────────────────────────────────────────────────
export const FAMILIAR_ABILITY_LADDER = [
  {
    minLevel: 1,
    maxLevel: 2,
    naturalArmorAdj: 1,
    int: 6,
    newAbilities: ['alertness', 'improvedEvasion', 'shareSpells', 'empathicLink'],
  },
  {
    minLevel: 3,
    maxLevel: 4,
    naturalArmorAdj: 2,
    int: 7,
    newAbilities: ['deliverTouchSpells'],
  },
  {
    minLevel: 5,
    maxLevel: 6,
    naturalArmorAdj: 3,
    int: 8,
    newAbilities: ['speakWithMaster'],
  },
  {
    minLevel: 7,
    maxLevel: 8,
    naturalArmorAdj: 4,
    int: 9,
    newAbilities: ['speakWithAnimalsOfItsKind'],
  },
  {
    minLevel: 9,
    maxLevel: 10,
    naturalArmorAdj: 5,
    int: 10,
    newAbilities: [],
  },
  {
    minLevel: 11,
    maxLevel: 12,
    naturalArmorAdj: 6,
    int: 11,
    newAbilities: ['spellResistance'],
  },
  {
    minLevel: 13,
    maxLevel: 14,
    naturalArmorAdj: 7,
    int: 12,
    newAbilities: ['scryOnFamiliar'],
  },
  {
    minLevel: 15,
    maxLevel: 16,
    naturalArmorAdj: 8,
    int: 13,
    newAbilities: [],
  },
  {
    minLevel: 17,
    maxLevel: 18,
    naturalArmorAdj: 9,
    int: 14,
    newAbilities: [],
  },
  {
    minLevel: 19,
    maxLevel: 20,
    naturalArmorAdj: 10,
    int: 15,
    newAbilities: [],
  },
];

// Human-readable labels for the shared abilities, used in the UI chips.
// Keys mirror newAbilities strings above.
export const FAMILIAR_ABILITY_LABELS = {
  alertness: 'Alertness',
  improvedEvasion: 'Improved Evasion',
  shareSpells: 'Share Spells',
  empathicLink: 'Empathic Link',
  deliverTouchSpells: 'Deliver Touch Spells',
  speakWithMaster: 'Speak with Master',
  speakWithAnimalsOfItsKind: 'Speak with Animals of Its Kind',
  spellResistance: 'Spell Resistance (master level + 5)',
  scryOnFamiliar: 'Scry on Familiar (1/day)',
};

// ─────────────────────────────────────────────────────────────────
// Classes that grant familiars — keyed off a `grantsFamiliar` tag rather
// than hardcoding so the multi-system work (D&D 3.5, 5e, AD&D 2e, etc.)
// can tag their own classes when they land.
//
// For the CRB-only Phase 7 scope, the Wizard always grants a familiar
// (as the familiar branch of Arcane Bond), and the Witch class is also
// tagged here per the user's Phase 7 answers (the Witch's patron
// familiar serves as her spellbook). Sorcerer's Arcane bloodline
// familiar and Eldritch Knight variants land in a later sub-phase.
// ─────────────────────────────────────────────────────────────────
const FAMILIAR_GRANTING_CLASSES = new Set([
  'Wizard',
  'Witch',
]);

// Sum the character's levels in classes that grant familiars. This is
// what CRB p. 82 means when it says "Levels of different classes that
// are entitled to familiars stack for the purpose of determining any
// familiar abilities that depend on the master's level."
export function getMasterClassLevel(character) {
  if (!character) return 0;
  // Multiclass-shaped data (the long-term goal per project_multi_system)
  // would be an array of { class, level }. The current single-class
  // shape is { class: 'Wizard', level: 5 }. Support both.
  if (Array.isArray(character.classes) && character.classes.length > 0) {
    return character.classes
      .filter((c) => c && FAMILIAR_GRANTING_CLASSES.has(c.class || c.name))
      .reduce((sum, c) => sum + (c.level || 0), 0);
  }
  if (character.class && FAMILIAR_GRANTING_CLASSES.has(character.class)) {
    return character.level || 0;
  }
  return 0;
}

// Return { naturalArmorAdj, int, abilities: { alertness: true, ... } }
// for a given master class level. Cumulative — level 11 master has
// everything up through spellResistance.
export function getFamiliarSharedAbilities(masterClassLevel) {
  const level = Math.max(0, Math.min(20, masterClassLevel || 0));
  if (level < 1) {
    return {
      naturalArmorAdj: 0,
      int: 0,
      abilities: {},
    };
  }
  let naturalArmorAdj = 0;
  let int = 0;
  const abilities = {};
  for (const row of FAMILIAR_ABILITY_LADDER) {
    if (level < row.minLevel) break;
    naturalArmorAdj = row.naturalArmorAdj;
    int = row.int;
    for (const a of row.newAbilities) abilities[a] = true;
  }
  return { naturalArmorAdj, int, abilities };
}

// Return the structured master bonus granted by a particular familiar
// choice. Used by the character-sheet aggregator to fold the bonus into
// skill/save totals. Phase 7.3 will call this from getCharacterModifiers.
//
// The `familiarChoice` parameter is either a familiar id ('cat', 'raven')
// or a full familiar object with an `id` field.
export function getMasterFamiliarBonus(familiarChoice) {
  if (!familiarChoice) return null;
  const id = typeof familiarChoice === 'string' ? familiarChoice : familiarChoice.id;
  if (!id) return null;

  // Direct lookup in base familiars first.
  const base = (familiarsData.baseFamiliars || []).find((f) => f.id === id);
  if (base) return base.masterBonus || null;

  // Improved familiars may inherit the master bonus from their base
  // animal (e.g. celestial_hawk inherits from hawk). Any improved
  // familiar without an inheritance link grants no base-creature skill
  // bonus — its value comes from its own abilities.
  const imp = (familiarsData.improvedFamiliars || []).find((f) => f.id === id);
  if (imp && imp.inheritsMasterBonusFrom) {
    const parent = (familiarsData.baseFamiliars || []).find(
      (f) => f.id === imp.inheritsMasterBonusFrom
    );
    return parent?.masterBonus || null;
  }
  return null;
}

// Full lookup by id across both base and improved tables. Used by the UI
// and the stat-block derivation code.
export function getFamiliarById(id) {
  if (!id) return null;
  const base = (familiarsData.baseFamiliars || []).find((f) => f.id === id);
  if (base) return { ...base, kind: 'base' };
  const imp = (familiarsData.improvedFamiliars || []).find((f) => f.id === id);
  if (imp) return { ...imp, kind: 'improved' };
  return null;
}

// Alignment-step check used by the Improved Familiar gate (CRB p. 127:
// "You may choose a familiar with an alignment up to one step away on
// each alignment axis"). Returns true if the master's alignment is
// within one step of the familiar's required alignment on both axes.
//
// Alignments are encoded as 2-letter strings: 'LG','NG','CG','LN','N',
// 'CN','LE','NE','CE'. A familiar alignment of 'any' always passes.
// 'N' (true neutral) is treated as 'NN' for axis comparison.
export function alignmentWithinOneStep(masterAlignment, familiarAlignment) {
  if (!familiarAlignment || familiarAlignment === 'any') return true;
  if (!masterAlignment) return false;

  const normalize = (a) => {
    const u = (a || '').toUpperCase().replace(/\s+/g, '');
    if (u === 'N' || u === 'TN') return ['N', 'N'];
    if (u.length !== 2) return null;
    return [u[0], u[1]];
  };

  const m = normalize(masterAlignment);
  const f = normalize(familiarAlignment);
  if (!m || !f) return false;

  // Law ↔ Chaos axis: L, N, C are positions 0, 1, 2.
  const lcOrder = { L: 0, N: 1, C: 2 };
  // Good ↔ Evil axis: G, N, E are positions 0, 1, 2.
  const geOrder = { G: 0, N: 1, E: 2 };

  const mLC = lcOrder[m[0]];
  const fLC = lcOrder[f[0]];
  const mGE = geOrder[m[1]];
  const fGE = geOrder[f[1]];
  if (mLC == null || fLC == null || mGE == null || fGE == null) return false;

  return Math.abs(mLC - fLC) <= 1 && Math.abs(mGE - fGE) <= 1;
}

// Eligibility check for a familiar choice, given the master character.
// Returns { eligible: bool, reason?: string } so the UI can explain why
// an option is greyed out. Pulls master class level, feats (for
// Improved Familiar), and alignment.
export function isFamiliarEligible(character, familiarId) {
  const entry = getFamiliarById(familiarId);
  if (!entry) return { eligible: false, reason: 'Unknown familiar.' };

  const masterLevel = getMasterClassLevel(character);
  if (masterLevel < 1) {
    return {
      eligible: false,
      reason: 'Only classes that grant familiars (e.g. Wizard, Witch) can choose one.',
    };
  }

  if (entry.kind === 'base') return { eligible: true };

  // Improved familiar branch
  const feats = (character?.feats || [])
    .filter((f) => f != null)
    .map((f) => (typeof f === 'string' ? f : (f.name || '')).toLowerCase().trim());
  if (!feats.some((f) => f.startsWith('improved familiar'))) {
    return {
      eligible: false,
      reason: 'Requires the Improved Familiar feat.',
    };
  }
  if (entry.minMasterLevel && masterLevel < entry.minMasterLevel) {
    return {
      eligible: false,
      reason: `Requires master class level ${entry.minMasterLevel}+.`,
    };
  }
  if (!alignmentWithinOneStep(character?.alignment, entry.alignment)) {
    return {
      eligible: false,
      reason: `Master alignment must be within one step of ${entry.alignment}.`,
    };
  }
  if (entry.prerequisite) {
    // CRB homunculus note: "The master must first create the homunculus."
    // We can't programmatically verify a homunculus has been crafted, so
    // we surface the requirement as a soft warning (eligible: true with
    // a warning field), not a hard block.
    return { eligible: true, warning: entry.prerequisite };
  }
  return { eligible: true };
}

// Debug/introspection: list every base + improved familiar's eligibility
// for a given character. Used by the CharacterCreator picker.
export function listFamiliarOptions(character) {
  const out = [];
  for (const f of familiarsData.baseFamiliars || []) {
    out.push({ ...f, kind: 'base', ...isFamiliarEligible(character, f.id) });
  }
  for (const f of familiarsData.improvedFamiliars || []) {
    out.push({ ...f, kind: 'improved', ...isFamiliarEligible(character, f.id) });
  }
  return out;
}

// Used by the replacement ritual flow (Phase 7.5). Returns the cost in
// gp for a given master class level (CRB p. 82: 200 gp × wizard level).
export function getReplaceFamiliarCost(masterClassLevel) {
  return 200 * Math.max(1, masterClassLevel || 1);
}

// A reference to classesData is kept so we can light up the "which of my
// classes grants a familiar" UI without duplicating the list elsewhere.
// Re-exported for consumers that want to enumerate granting classes.
export function getFamiliarGrantingClassNames() {
  const all = Array.isArray(classesData) ? classesData : Object.values(classesData || {});
  return all
    .map((c) => c?.name)
    .filter((n) => n && FAMILIAR_GRANTING_CLASSES.has(n));
}

// ═════════════════════════════════════════════════════════════════
// Phase 7.2 — deriveFamiliarStats
// ─────────────────────────────────────────────────────────────────
// Compute the live familiar stat block from a master character + a
// familiar choice. Pure function. Applies CRB p. 83 "Familiar Basics"
// rules: half master HP, max(master level, normal HD), master BAB,
// max(Str, Dex) for natural weapon to-hit, max(familiar base, master
// base) for each save, Int from the ladder, cumulative shared
// abilities, and SR = master level + 5 at 11+.
// ═════════════════════════════════════════════════════════════════

// PF1e size bonus to attack rolls (and AC). The stored monster AC in
// monsters.json already bakes in size, so we only apply this when
// recomputing the to-hit with master BAB.
const SIZE_MOD_TO_HIT = {
  Fine: 8,
  Diminutive: 4,
  Tiny: 2,
  Small: 1,
  Medium: 0,
  Large: -1,
  Huge: -2,
  Gargantuan: -4,
  Colossal: -8,
};

function abilityModFromScore(score) {
  return Math.floor(((score ?? 10) - 10) / 2);
}

// Look up the base monster row for a familiar by its canonical name.
function findMonsterRow(monsterRef) {
  if (!monsterRef || !Array.isArray(monstersData)) return null;
  return monstersData.find((m) => m && m.name === monsterRef) || null;
}

// Parse a monsters.json skills string like
//   "Climb +6, Perception +5, Stealth +14"
// into { Climb: 6, Perception: 5, Stealth: 14 }.
// Skill names may contain parens (e.g. "Knowledge (arcana)"). The regex
// captures everything before the final signed number.
function parseSkillsString(skillsStr) {
  if (!skillsStr || typeof skillsStr !== 'string') return {};
  const out = {};
  for (const chunk of skillsStr.split(',')) {
    const m = /^\s*(.+?)\s+([+-]?\d+)\s*$/.exec(chunk);
    if (!m) continue;
    out[m[1].trim()] = parseInt(m[2], 10);
  }
  return out;
}

// Compute master's total base save across all familiar-granting classes
// (per CRB p. 83: "as calculated from all his classes"). For the current
// single-class shape this collapses to one getBaseSave call.
function getMasterBaseSave(character, saveType) {
  if (!character) return 0;
  if (Array.isArray(character.classes) && character.classes.length > 0) {
    // Multiclass — sum base saves (PF1e stacks base saves from each class)
    return character.classes.reduce((sum, c) => {
      const name = c?.class || c?.name;
      const lv = c?.level || 0;
      if (!name || lv < 1) return sum;
      return sum + getBaseSave(name, lv, saveType);
    }, 0);
  }
  if (character.class && character.level) {
    return getBaseSave(character.class, character.level, saveType);
  }
  return 0;
}

// Familiar class skills per CRB p. 83 "Skills" paragraph.
export const FAMILIAR_CLASS_SKILLS = [
  'Acrobatics', 'Climb', 'Fly', 'Perception', 'Stealth', 'Swim',
];

/**
 * deriveFamiliarStats(character, familiarChoice)
 *
 * Compute the live familiar stat block for display and combat use.
 *
 * @param {object} character — the master character. Must have .class /
 *                             .classes, .level, .abilities, .maxHP,
 *                             .bab, and .saves (base values).
 * @param {string|object} familiarChoice — either a familiar id ('cat',
 *                                          'imp') or a familiar entry
 *                                          object (from getFamiliarById).
 * @returns {object|null} stat block, or null if the master can't have
 *                        this familiar (no levels in a granting class,
 *                        missing monster row, bad id).
 *
 * Rules applied (CRB p. 83 Familiar Basics):
 *   - HP = floor(master.maxHP / 2), not including temp HP
 *   - HD = max(master level, familiar normal HD) — for effects only
 *   - BAB = master BAB
 *   - Melee to-hit = master BAB + max(Str, Dex) mod + size mod
 *   - Damage = unchanged from normal animal (passed through)
 *   - Saves = max(familiar base, master base) + familiar ability mod
 *   - Int = ladder value (replaces native Int)
 *   - Natural Armor Adj = ladder value, in addition to native NA
 *   - Class skills = Acrobatics/Climb/Fly/Perception/Stealth/Swim
 *   - SR = master level + 5 if master class level ≥ 11
 *   - Shared abilities: cumulative per the ladder
 */
export function deriveFamiliarStats(character, familiarChoice) {
  if (!character) return null;

  const entry = typeof familiarChoice === 'string'
    ? getFamiliarById(familiarChoice)
    : (familiarChoice && familiarChoice.id ? getFamiliarById(familiarChoice.id) : null);
  if (!entry || !entry.monsterRef) return null;

  const masterLevel = getMasterClassLevel(character);
  if (masterLevel < 1) return null;

  const row = findMonsterRow(entry.monsterRef);
  if (!row) return null;

  // ─── Ability scores ─────────────────────────────────────────────
  // Familiar keeps its native Str/Dex/Con/Wis/Cha. Int is replaced by
  // the ladder value (falling back to the native Int only if we're
  // somehow at level 0, which the guard above should prevent).
  const shared = getFamiliarSharedAbilities(masterLevel);
  const familiarAbilities = {
    STR: row.str ?? 10,
    DEX: row.dex ?? 10,
    CON: row.con ?? 10,
    INT: shared.int || row.int || 2,
    WIS: row.wis ?? 10,
    CHA: row.cha ?? 10,
  };

  const strMod = abilityModFromScore(familiarAbilities.STR);
  const dexMod = abilityModFromScore(familiarAbilities.DEX);
  const conMod = abilityModFromScore(familiarAbilities.CON);
  const wisMod = abilityModFromScore(familiarAbilities.WIS);

  // ─── HP (half master HP, floor, no temp HP) ─────────────────────
  const masterHP = character.maxHP ?? character.hp ?? 0;
  const hp = Math.floor(Math.max(0, masterHP) / 2);

  // ─── HD (max of master level and familiar normal HD) ────────────
  // monsters.json doesn't store HD explicitly; we use a floor of 1 for
  // Tiny-animal familiars (which typically have 1/2 HD normally).
  const familiarNormalHD = row.hd || 1;
  const effectiveHD = Math.max(masterLevel, familiarNormalHD);

  // ─── BAB (from master) ──────────────────────────────────────────
  const bab = character.bab ?? 0;

  // ─── Saves ──────────────────────────────────────────────────────
  // Back out the familiar's own ability mods from its stored save
  // totals to recover the base save bonuses. Compared with the
  // master's base saves; higher wins; then the familiar ability mod
  // is reapplied.
  const rowConMod = abilityModFromScore(row.con ?? 10);
  const rowDexMod = abilityModFromScore(row.dex ?? 10);
  const rowWisMod = abilityModFromScore(row.wis ?? 10);

  const familiarBaseFort = (row.fort ?? 0) - rowConMod;
  const familiarBaseRef = (row.ref ?? 0) - rowDexMod;
  const familiarBaseWill = (row.will ?? 0) - rowWisMod;

  const masterBaseFort = getMasterBaseSave(character, 'Fort');
  const masterBaseRef = getMasterBaseSave(character, 'Ref');
  const masterBaseWill = getMasterBaseSave(character, 'Will');

  const chosenBaseFort = Math.max(familiarBaseFort, masterBaseFort);
  const chosenBaseRef = Math.max(familiarBaseRef, masterBaseRef);
  const chosenBaseWill = Math.max(familiarBaseWill, masterBaseWill);

  const saves = {
    fort: chosenBaseFort + conMod,
    ref: chosenBaseRef + dexMod,
    will: chosenBaseWill + wisMod,
    base: {
      fort: chosenBaseFort,
      ref: chosenBaseRef,
      will: chosenBaseWill,
    },
    source: {
      fort: familiarBaseFort >= masterBaseFort ? 'familiar' : 'master',
      ref: familiarBaseRef >= masterBaseRef ? 'familiar' : 'master',
      will: familiarBaseWill >= masterBaseWill ? 'familiar' : 'master',
    },
  };

  // ─── Attacks ────────────────────────────────────────────────────
  // Natural-weapon to-hit: master BAB + max(Str, Dex) mod + size mod.
  // Damage passes through from the monster row unchanged.
  const sizeMod = SIZE_MOD_TO_HIT[row.size] ?? 0;
  const effectiveAbilityMod = Math.max(strMod, dexMod);
  const attackBonus = bab + effectiveAbilityMod + sizeMod;

  // ─── Natural Armor ──────────────────────────────────────────────
  // Ladder value adds to the familiar's existing NA. monsters.json
  // doesn't expose the base NA separately (it's baked into row.ac),
  // so we surface the ladder delta alongside the stored AC and let
  // the UI add them for display.
  const naturalArmorAdj = shared.naturalArmorAdj;

  // ─── Skills ─────────────────────────────────────────────────────
  // Parse the animal's base skill totals from the freeform string.
  // Master-ranks substitution (per CRB "whichever is better") is
  // deferred to Phase 7.6 because it requires per-skill rank vs.
  // total reconciliation against the character sheet; for now the
  // familiar uses its animal totals, and the 7.6 UI layer will apply
  // master ranks when displaying.
  const baseSkills = parseSkillsString(row.skills);

  // ─── SR (master level + 5 at 11+) ───────────────────────────────
  const sr = shared.abilities.spellResistance ? masterLevel + 5 : null;

  // ─── Master-granted bonus (pass-through for 7.3 aggregator) ─────
  const masterBonus = getMasterFamiliarBonus(entry.id);

  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind, // 'base' | 'improved'
    monsterRef: entry.monsterRef,
    source: entry.source || row.source || null,

    // Core numbers
    size: row.size,
    alignment: entry.alignment || row.alignment,
    speed: row.speed,
    hp,
    effectiveHD,
    bab,

    // Abilities & derived mods
    abilities: familiarAbilities,
    abilityMods: {
      STR: strMod,
      DEX: dexMod,
      CON: conMod,
      INT: abilityModFromScore(familiarAbilities.INT),
      WIS: wisMod,
      CHA: abilityModFromScore(familiarAbilities.CHA),
    },

    // Saves (with base and source tracking for UI tooltip transparency)
    saves,

    // Attacks
    attacks: {
      primary: row.atk || null,
      full: row.fullAttack || null,
      damage: row.dmg || null,
      attackBonus, // computed natural-weapon to-hit
      sizeMod,
    },

    // Defense
    ac: row.ac ?? 10,
    naturalArmorAdj,

    // Skills (animal baseline — 7.6 applies master ranks)
    skills: baseSkills,
    classSkills: [...FAMILIAR_CLASS_SKILLS],

    // Shared familiar abilities (Alertness, Share Spells, etc.)
    sharedAbilities: shared.abilities,
    sharedAbilityLabels: Object.keys(shared.abilities)
      .filter((k) => shared.abilities[k])
      .map((k) => FAMILIAR_ABILITY_LABELS[k] || k),
    sr,

    // Master-granted skill/save/HP bonus (from familiars.json, pass-through)
    masterBonus,

    // For 7.3 aggregator transparency
    masterLevel,
  };
}

// ═════════════════════════════════════════════════════════════════
// Phase 7.3 — Master-modifier aggregator
// ─────────────────────────────────────────────────────────────────
// Translate the familiar's master bonus (from familiars.json) into
// the shape that rulesEngine.mergeAllModifiers produces, so skill and
// save bonuses flow through computeSkillCheck, computeSave, the AI DM
// rules summary, ShopTab bargain, WorldTab checks, etc. without any
// of those call sites needing to know about familiars.
//
// HP bonuses (toad) cannot flow through `tempHP` because temp HP gets
// consumed by damage first. They are returned separately in hpBonus
// and should be read via getEffectiveMaxHP() at display time.
// ═════════════════════════════════════════════════════════════════

// Normalize the save-key capitalization. familiars.json stores
// masterBonus.save as lowercase 'fort'/'ref'/'will' (or the long form
// 'fortitude'/'reflex'); mergeAllModifiers expects 'Fort'/'Ref'/'Will'.
const SAVE_KEY_NORMALIZE = {
  fort: 'Fort',
  fortitude: 'Fort',
  ref: 'Ref',
  reflex: 'Ref',
  will: 'Will',
};

/**
 * aggregateFamiliarModifiers(character, options?)
 *
 * Return the master-granted bonus from the character's active familiar
 * in the same shape as rulesEngine.mergeAllModifiers output, ready to
 * fold into getCharacterModifiers.
 *
 * Contract:
 *   - Returns an empty (all-zero) object when the character has no
 *     familiar, the familiar id is unknown, the familiar has no
 *     structured masterBonus, the familiar is lost/awaiting replacement
 *     (Phase 7.5), or the familiar is beyond 1 mile from its master
 *     (Phase 7.5, CRB p. 82).
 *   - `skills[skillName]` contains the flat bonus to that skill.
 *   - `saves[saveType]` contains the flat bonus to that save
 *     ('Fort'/'Ref'/'Will' capitalization).
 *   - `hpBonus` is the permanent max-HP bonus (toad's +3). HP bonuses
 *     do NOT flow through tempHP — read them via getEffectiveMaxHP.
 *   - `applied[]` lists every bonus that was actually applied, with
 *     kind/target/value and an optional `condition` string (e.g.,
 *     "in bright light" for hawk). The UI layer uses this to footnote
 *     conditional bonuses. Per 7.1 review decision: apply the bonus
 *     always, surface the condition as a footnote — matching
 *     Pathbuilder and Hero Lab behavior.
 *
 * @param {object} character
 * @param {object} [options]
 * @param {object} [options.worldState] — optional worldState to read
 *        familiar-location from. When omitted (existing 7.3 callers),
 *        the familiar is assumed to be with its master (backward-
 *        compatible default). Phase 7.6 will progressively migrate
 *        callers to pass worldState.
 * @returns {{saves: object, skills: object, hpBonus: number, applied: Array}}
 */
export function aggregateFamiliarModifiers(character, options = {}) {
  const empty = { saves: {}, skills: {}, hpBonus: 0, applied: [] };
  const famId = character?.familiar?.id;
  if (!famId) return empty;

  // Phase 7.5 — Lost/awaiting-replacement guard. If the familiar has
  // been lost/dismissed/killed, no bonuses apply even though the id is
  // retained on the character for ritual bookkeeping.
  const status = character.familiar.status;
  if (status === 'lost' || status === 'ritualInProgress') return empty;

  // Master-level guard: only characters with at least one level in a
  // familiar-granting class should receive the bonus. This matches the 7.2
  // deriveFamiliarStats contract and protects against corrupt saves or
  // misclassed imports that stashed a familiar id on a Fighter. Without
  // this guard, a Fighter with `character.familiar = { id: 'cat' }` would
  // silently get +3 Stealth, divorced from any actual class ability.
  if (getMasterClassLevel(character) < 1) return empty;

  // Phase 7.5 — Range gate. Per CRB p. 82: "These special abilities
  // apply only when the master and familiar are within 1 mile of each
  // other." If worldState is provided and contains a familiarLocation
  // entry for this character, honor it. Missing/malformed entries
  // default to in-range so existing 7.3 callers are unaffected.
  if (options.worldState && !isFamiliarInRange(character, options.worldState)) {
    return empty;
  }

  const bonus = getMasterFamiliarBonus(famId);
  if (!bonus || !bonus.kind) return empty;

  const result = { saves: {}, skills: {}, hpBonus: 0, applied: [] };

  switch (bonus.kind) {
    case 'skill': {
      const skill = bonus.skill;
      const value = bonus.value || 0;
      if (skill && value) {
        result.skills[skill] = value;
        result.applied.push({
          kind: 'skill',
          target: skill,
          value,
          familiarId: famId,
          condition: bonus.condition || null,
        });
      }
      break;
    }
    case 'save': {
      const key = String(bonus.save || '').toLowerCase();
      const target = SAVE_KEY_NORMALIZE[key];
      const value = bonus.value || 0;
      if (target && value) {
        result.saves[target] = value;
        result.applied.push({
          kind: 'save',
          target,
          value,
          familiarId: famId,
          condition: bonus.condition || null,
        });
      }
      break;
    }
    case 'hp': {
      const value = bonus.value || 0;
      if (value) {
        result.hpBonus = value;
        result.applied.push({
          kind: 'hp',
          target: 'maxHP',
          value,
          familiarId: famId,
          condition: bonus.condition || null,
        });
      }
      break;
    }
    default:
      break;
  }

  return result;
}

/**
 * getEffectiveMaxHP(character, options?)
 *
 * The character's maxHP with any familiar HP bonus folded in (toad
 * grants +3 permanent max HP). Callers that currently read
 * `character.maxHP` for display or damage-cap purposes should migrate
 * to this helper in Phase 7.6.
 *
 * Phase 7.5: accepts the same `options` as aggregateFamiliarModifiers
 * so the HP bonus can be gated by range/status when worldState is
 * available. Omitting options keeps backward-compatible behavior.
 *
 * @param {object} character
 * @param {object} [options]
 * @returns {number}
 */
export function getEffectiveMaxHP(character, options = {}) {
  const base = character?.maxHP ?? 0;
  const mods = aggregateFamiliarModifiers(character, options);
  return base + (mods.hpBonus || 0);
}

// ═════════════════════════════════════════════════════════════════
// Phase 7.5 — Range gating + replace-familiar ritual
// ─────────────────────────────────────────────────────────────────
// Location model (stored on worldState, keyed by character.id):
//
//   worldState.familiarLocation = {
//     [characterId]: {
//       withMaster: true,       // quick flag — equivalent to distance 0
//       distanceMiles: 0,       // 0 when with master; >0 when separated
//       note: '',               // optional GM note e.g. "scouting the attic"
//     }
//   }
//
// Missing entries are treated as "with master" so existing 7.3 saves
// and mid-game data loads continue to work without a migration. The
// 7.7 save-migration sub-phase will backfill explicit entries for any
// character with a familiar.
//
// Range gate:
//   CRB p. 82: "These special abilities apply only when the master and
//   familiar are within 1 mile of each other." We treat distance <= 1
//   mile as "in range" and > 1 mile as "out of range".
//
// Replace ritual:
//   CRB p. 82: "If a familiar is dismissed, lost, or dies, it can be
//   replaced 1 week later through a specialized ritual that costs 200
//   gp per wizard level. The ritual takes 8 hours to complete."
//
// Status model (on character.familiar):
//   - status undefined / null ........... normal, live familiar
//   - status 'lost' ..................... familiar is dead/dismissed;
//                                          awaiting 1-week cooldown
//   - status 'ritualInProgress' ......... ritual has started; waiting
//                                          for the 8 hours to elapse
//
// Timing model:
//   `lostAt` and `ritualStartedAt` are stored as { day, hour } using
//   the same worldState.currentDay / currentHour clock the rest of the
//   app uses. Keeping them as discrete day/hour values avoids tying
//   ritual bookkeeping to a real-world clock.
// ═════════════════════════════════════════════════════════════════

// Per CRB p. 82: shared abilities apply only within 1 mile of each
// other. Values higher than this disable the bonus entirely.
export const FAMILIAR_ABILITY_RANGE_MILES = 1;

/**
 * getFamiliarLocation(character, worldState)
 *
 * Look up the familiar location entry for a given character. Returns
 * the stored entry, or a default "with master" object if none is set.
 *
 * @param {object} character
 * @param {object} worldState
 * @returns {{withMaster: boolean, distanceMiles: number, note: string}}
 */
export function getFamiliarLocation(character, worldState) {
  const id = character?.id;
  const map = worldState?.familiarLocation || null;
  if (!id || !map) {
    return { withMaster: true, distanceMiles: 0, note: '' };
  }
  const entry = map[id];
  if (!entry) return { withMaster: true, distanceMiles: 0, note: '' };
  // Normalize legacy or partial entries.
  const distanceMiles = Number.isFinite(entry.distanceMiles)
    ? Math.max(0, entry.distanceMiles)
    : 0;
  const withMaster = entry.withMaster !== undefined
    ? !!entry.withMaster
    : distanceMiles === 0;
  return {
    withMaster,
    distanceMiles,
    note: typeof entry.note === 'string' ? entry.note : '',
  };
}

/**
 * isFamiliarInRange(character, worldState)
 *
 * True if the character's familiar is close enough to benefit from the
 * CRB "special abilities apply only when within 1 mile" rule. Returns
 * true when worldState has no entry for this character (backward-
 * compatible default).
 *
 * @param {object} character
 * @param {object} worldState
 * @returns {boolean}
 */
export function isFamiliarInRange(character, worldState) {
  if (!worldState) return true;
  const loc = getFamiliarLocation(character, worldState);
  if (loc.withMaster) return true;
  return loc.distanceMiles <= FAMILIAR_ABILITY_RANGE_MILES;
}

/**
 * setFamiliarLocation(worldState, characterId, patch)
 *
 * Return a new worldState with the given character's familiar location
 * updated. Pure — callers should wrap in setWorldState(prev => ...).
 * `patch` is merged over the current entry. Setting `withMaster: true`
 * automatically zeroes the distance.
 *
 * @param {object} worldState
 * @param {string} characterId
 * @param {object} patch
 * @returns {object} next worldState
 */
export function setFamiliarLocation(worldState, characterId, patch) {
  if (!characterId) return worldState;
  const prevMap = worldState?.familiarLocation || {};
  const prevEntry = prevMap[characterId] || { withMaster: true, distanceMiles: 0, note: '' };
  const next = { ...prevEntry, ...patch };
  // withMaster and distance are coupled — keep them consistent.
  if (patch.withMaster === true) {
    next.distanceMiles = 0;
  } else if (Number.isFinite(patch.distanceMiles)) {
    next.distanceMiles = Math.max(0, patch.distanceMiles);
    next.withMaster = next.distanceMiles === 0;
  }
  return {
    ...worldState,
    familiarLocation: { ...prevMap, [characterId]: next },
  };
}

// ─────────────────────────────────────────────────────────────────
// Replace-familiar ritual (CRB p. 82)
// ─────────────────────────────────────────────────────────────────

// Convert a { day, hour } worldState timestamp to an absolute hour
// count for comparisons. Uses the 24-hour day the rest of the app
// assumes (worldState.currentHour is 0-23).
function wsTimestampToHours(ts) {
  if (!ts || typeof ts !== 'object') return 0;
  const d = Number.isFinite(ts.day) ? ts.day : 0;
  const h = Number.isFinite(ts.hour) ? ts.hour : 0;
  return d * 24 + h;
}

// Read the current world clock as a { day, hour } timestamp.
function currentWorldTimestamp(worldState) {
  return {
    day: Number.isFinite(worldState?.currentDay) ? worldState.currentDay : 1,
    hour: Number.isFinite(worldState?.currentHour) ? worldState.currentHour : 0,
  };
}

/**
 * markFamiliarLost(character, worldState)
 *
 * Transition a character's familiar into the "lost" state following a
 * death, dismissal, or loss event. Preserves the old id on the
 * character so UI can reference what was lost ("your raven"), but
 * bonuses stop applying immediately (status === 'lost' short-circuits
 * aggregateFamiliarModifiers). Stamps `lostAt` with the current world
 * time so the 1-week cooldown can be evaluated later.
 *
 * @param {object} character
 * @param {object} worldState
 * @returns {object} a new character with the updated familiar entry
 */
export function markFamiliarLost(character, worldState) {
  if (!character?.familiar?.id) return character;
  return {
    ...character,
    familiar: {
      ...character.familiar,
      status: 'lost',
      lostAt: currentWorldTimestamp(worldState),
      ritualStartedAt: null,
    },
  };
}

/**
 * canReplaceFamiliar(character, worldState, options?)
 *
 * Decide whether the character may begin the replace-familiar ritual
 * right now. Returns a decision object so the UI can display a helpful
 * reason when blocked.
 *
 * Rules (CRB p. 82):
 *   - Must be a class that grants a familiar (master class level ≥ 1).
 *   - Must have a familiar currently in the 'lost' state (CRB requires
 *     a dismissal/death/loss to trigger the ritual; a character with a
 *     living familiar cannot replace it on a whim).
 *   - At least 1 week (168 hours) must have passed since `lostAt`.
 *   - The character must have at least 200 gp × master class level on
 *     hand. `options.gold` lets callers override the auto-detected gp
 *     total if their character shape stores currency elsewhere.
 *
 * @param {object} character
 * @param {object} worldState
 * @param {object} [options]
 * @param {number} [options.gold] override auto-detected gp
 * @returns {{canReplace: boolean, reason?: string, cost: number, waitHoursRemaining: number}}
 */
export function canReplaceFamiliar(character, worldState, options = {}) {
  const masterLevel = getMasterClassLevel(character);
  const cost = getReplaceFamiliarCost(masterLevel);

  if (masterLevel < 1) {
    return {
      canReplace: false,
      reason: 'Only classes that grant familiars (e.g. Wizard, Witch) may perform the ritual.',
      cost,
      waitHoursRemaining: 0,
    };
  }
  const fam = character?.familiar;
  if (!fam || fam.status !== 'lost') {
    return {
      canReplace: false,
      reason: 'The ritual can only replace a familiar that has been dismissed, lost, or killed.',
      cost,
      waitHoursRemaining: 0,
    };
  }

  const lostAtHours = wsTimestampToHours(fam.lostAt);
  const nowHours = wsTimestampToHours(currentWorldTimestamp(worldState));
  const oneWeekHours = 7 * 24;
  const waitHoursRemaining = Math.max(0, oneWeekHours - (nowHours - lostAtHours));
  if (waitHoursRemaining > 0) {
    return {
      canReplace: false,
      reason: `The ritual requires 1 week after the loss; ${Math.ceil(waitHoursRemaining / 24)} day(s) remain.`,
      cost,
      waitHoursRemaining,
    };
  }

  const gold = Number.isFinite(options.gold)
    ? options.gold
    : Number.isFinite(character?.gp)
      ? character.gp
      : Number.isFinite(character?.gold)
        ? character.gold
        : null;
  if (gold != null && gold < cost) {
    return {
      canReplace: false,
      reason: `The ritual costs ${cost} gp (200 gp × master class level); you have ${gold} gp.`,
      cost,
      waitHoursRemaining: 0,
    };
  }

  return { canReplace: true, cost, waitHoursRemaining: 0 };
}

/**
 * beginReplaceFamiliarRitual(character, worldState)
 *
 * Start the 8-hour ritual. Stamps `ritualStartedAt` on the familiar
 * and transitions status to 'ritualInProgress'. Does NOT deduct gp or
 * change the familiar id — the id is rewritten only when the ritual
 * completes (so an aborted ritual leaves the character in the lost
 * state). Callers are responsible for deducting the gp cost and
 * advancing the world clock by the 8 hours afterward.
 *
 * @param {object} character
 * @param {object} worldState
 * @returns {object} a new character with the updated familiar entry
 */
export function beginReplaceFamiliarRitual(character, worldState) {
  if (!character?.familiar || character.familiar.status !== 'lost') {
    return character;
  }
  return {
    ...character,
    familiar: {
      ...character.familiar,
      status: 'ritualInProgress',
      ritualStartedAt: currentWorldTimestamp(worldState),
    },
  };
}

/**
 * completeReplaceFamiliarRitual(character, newFamiliarId)
 *
 * Finish the ritual by setting the new familiar id and clearing the
 * ritual bookkeeping. Resets status to undefined (normal). The new id
 * must be validated by the caller — this helper only writes the
 * decision. On success, the character's familiar shape returns to the
 * Phase 7.3 contract (`{ id }`) with no status/lostAt/ritualStartedAt.
 *
 * @param {object} character
 * @param {string} newFamiliarId
 * @returns {object} a new character with the updated familiar entry
 */
export function completeReplaceFamiliarRitual(character, newFamiliarId) {
  if (!character || !newFamiliarId) return character;
  return {
    ...character,
    familiar: { id: newFamiliarId },
  };
}

/**
 * getFamiliarStatusSummary(character, worldState)
 *
 * Produce a short, human-readable one-liner about the familiar's
 * current situation, suitable for PartyTab sub-rows and GM displays.
 * Examples:
 *   "Perched on master's shoulder."
 *   "Scouting (0.25 mi) — in range."
 *   "Out of range (2 mi) — shared abilities inactive."
 *   "Lost — awaiting 3 day(s) before the ritual can begin."
 *   "Ritual in progress."
 *
 * Returns null when the character has no familiar to summarize.
 *
 * @param {object} character
 * @param {object} worldState
 * @returns {string|null}
 */
export function getFamiliarStatusSummary(character, worldState) {
  const fam = character?.familiar;
  if (!fam || !fam.id) return null;
  if (fam.status === 'lost') {
    const { waitHoursRemaining } = canReplaceFamiliar(character, worldState);
    if (waitHoursRemaining > 0) {
      return `Lost — ${Math.ceil(waitHoursRemaining / 24)} day(s) before the replacement ritual can begin.`;
    }
    return 'Lost — ready for the replacement ritual.';
  }
  if (fam.status === 'ritualInProgress') {
    return 'Replacement ritual in progress (8 hours).';
  }
  const loc = getFamiliarLocation(character, worldState);
  if (loc.withMaster) return loc.note || "With master.";
  const inRange = loc.distanceMiles <= FAMILIAR_ABILITY_RANGE_MILES;
  const dist = loc.distanceMiles === Math.floor(loc.distanceMiles)
    ? String(loc.distanceMiles)
    : loc.distanceMiles.toFixed(2);
  const noteTail = loc.note ? ` — ${loc.note}` : '';
  if (inRange) return `Separated (${dist} mi) — in range${noteTail}.`;
  return `Out of range (${dist} mi) — shared abilities inactive${noteTail}.`;
}
