/**
 * CLASS FEATURE REGISTRY — Data-driven rule engine for PF1e character creation.
 *
 * HOW IT WORKS:
 * 1. Each class declares what "feature selections" it needs (domains, bloodline, deity, school, etc.)
 * 2. Each feature type defines: data source, selection UI type, how to apply bonuses, and validation rules.
 * 3. CharacterCreator reads this registry and auto-generates the "Class Features" step.
 * 4. When the character is finalized, all selected features are resolved and applied automatically.
 *
 * TO ADD A NEW FEATURE:
 * 1. Add the data file to /src/data/
 * 2. Import it below and add a FEATURE_TYPES entry
 * 3. Add the class(es) that use it to CLASS_FEATURES
 * That's it — the UI and enforcement are automatic.
 */

import domainsData from '../data/domains.json';
import bloodlinesData from '../data/bloodlines.json';
import deitiesData from '../data/deities.json';
import spellsData from '../data/spells.json';
import { listFamiliarOptions } from './familiarEngine';

// Bonded Object types per CRB p. 78. Choosing one of these instead of a
// familiar grants the wizard a bonus spell slot per day (any spell from his
// spellbook) at the cost of having to make a concentration check (DC 20 +
// spell level) to cast spells without the bonded object on his person.
const BONDED_OBJECT_TYPES = [
  { type: 'amulet', label: 'Amulet',
    description: 'Hangs around the neck. Hard to remove in combat; protected by the wearer\'s body.' },
  { type: 'ring', label: 'Ring',
    description: 'Worn on a finger. Vulnerable to sundering and disarm.' },
  { type: 'staff', label: 'Staff',
    description: 'A focus that can also be wielded as a quarterstaff. Recommended for melee-leaning wizards.' },
  { type: 'wand', label: 'Wand',
    description: 'Slim and easy to conceal. No combat utility on its own.' },
  { type: 'weapon', label: 'Weapon',
    description: 'A specific weapon (sword, dagger, etc.). The wizard must be wielding it to cast prepared spells freely.' },
];

// ── Utility ──
const toArray = (d) => Array.isArray(d) ? d : (d && typeof d === 'object' ? Object.values(d).flat() : []);

// ══════════════════════════════════════════════════════════
// FEATURE TYPE DEFINITIONS
// Each type describes HOW to select and apply a feature.
// ══════════════════════════════════════════════════════════

export const FEATURE_TYPES = {
  /**
   * DEITY — select a god/philosophy. Constrains alignment & available domains.
   */
  deity: {
    label: 'Deity',
    description: 'Choose your patron deity or philosophy',
    selectType: 'single',          // single dropdown/list pick
    dataKey: 'deity',              // field name on the character object
    getOptions: (char) => {
      const deities = toArray(deitiesData);
      // Filter to deities whose clericAlignments include char's alignment (if set)
      if (char.alignment) {
        return deities.filter(d =>
          !d.clericAlignments || d.clericAlignments.length === 0 || d.clericAlignments.includes(char.alignment)
        );
      }
      return deities;
    },
    getOptionLabel: (d) => `${d.name}${d.title ? ' — ' + d.title : ''} (${d.alignment})`,
    getOptionValue: (d) => d.name,
    getOptionDetail: (d) => {
      const parts = [];
      if (d.portfolios) parts.push(`Portfolios: ${d.portfolios.join(', ')}`);
      if (d.domains) parts.push(`Domains: ${d.domains.join(', ')}`);
      if (d.favoredWeapon) parts.push(`Favored Weapon: ${d.favoredWeapon}`);
      return parts.join(' | ');
    },
    validate: (value, char) => {
      if (!value) return 'A deity must be selected';
      const deity = toArray(deitiesData).find(d => d.name === value);
      if (!deity) return null;
      if (char.alignment && deity.clericAlignments?.length > 0 && !deity.clericAlignments.includes(char.alignment)) {
        return `${deity.name} does not accept ${char.alignment} worshipers`;
      }
      return null;
    },
    apply: (char, value) => {
      // Store deity and its favored weapon for later reference
      const deity = toArray(deitiesData).find(d => d.name === value);
      return {
        deity: value,
        deityData: deity || null,
      };
    },
  },

  /**
   * DOMAINS — Clerics pick 2 (or 1 for some classes). Must be from deity's list.
   */
  domains: {
    label: 'Domains',
    description: 'Choose your divine domains',
    selectType: 'multi',            // pick multiple from list
    dataKey: 'domains',
    count: 2,                       // default count; overridden per-class in CLASS_FEATURES
    getOptions: (char) => {
      const allDomains = toArray(domainsData);
      // If deity is selected, filter to that deity's domains
      if (char.deity) {
        const deity = toArray(deitiesData).find(d => d.name === char.deity);
        if (deity?.domains?.length) {
          return allDomains.filter(d => deity.domains.includes(d.name));
        }
      }
      return allDomains;
    },
    getOptionLabel: (d) => d.name,
    getOptionValue: (d) => d.name,
    getOptionDetail: (d) => {
      if (!d.domainSpells) return d.description || '';
      return `Spells: ${Object.values(d.domainSpells).slice(0, 3).join(', ')}...`;
    },
    validate: (value, char, featureDef) => {
      const count = featureDef?.count || 2;
      if (!value || !Array.isArray(value) || value.length < count) {
        return `Select ${count} domain${count > 1 ? 's' : ''}`;
      }
      return null;
    },
    apply: (char, value) => {
      // Grant domain spells as bonus spells
      const allDomains = toArray(domainsData);
      const bonusSpells = [];
      (value || []).forEach(domainName => {
        const domain = allDomains.find(d => d.name === domainName);
        if (domain?.domainSpells) {
          Object.entries(domain.domainSpells).forEach(([level, spellName]) => {
            bonusSpells.push({ name: spellName, level: parseInt(level), source: `${domainName} Domain`, type: 'domain' });
          });
        }
      });
      return {
        domains: value,
        bonusDomainSpells: bonusSpells,
      };
    },
  },

  /**
   * BLOODLINE — Sorcerers/Bloodragers pick one.
   */
  bloodline: {
    label: 'Bloodline',
    description: 'Choose your sorcerous bloodline',
    selectType: 'single',
    dataKey: 'bloodline',
    getOptions: (char) => {
      const all = toArray(bloodlinesData);
      // Filter by class if bloodlines have a class field
      const cls = char.class || '';
      if (cls === 'Bloodrager') {
        return all.filter(b => b.class === 'Bloodrager' || !b.class);
      }
      return all.filter(b => b.class === 'Sorcerer' || !b.class);
    },
    getOptionLabel: (b) => `${b.name}${b.source ? ' (' + b.source + ')' : ''}`,
    getOptionValue: (b) => b.name,
    getOptionDetail: (b) => {
      const parts = [];
      if (b.bloodlineArcana) parts.push(`Arcana: ${b.bloodlineArcana}`);
      if (b.classSkill) parts.push(`+Class Skill: ${b.classSkill}`);
      return parts.join(' | ');
    },
    validate: (value) => {
      if (!value) return 'A bloodline must be selected';
      return null;
    },
    apply: (char, value) => {
      const bl = toArray(bloodlinesData).find(b => b.name === value);
      if (!bl) return { bloodline: value };

      // Bonus spells at sorcerer levels 3,5,7,9,11,13,15,17,19
      const bonusSpells = [];
      if (bl.bonusSpells) {
        Object.entries(bl.bonusSpells).forEach(([level, spellName]) => {
          bonusSpells.push({ name: spellName, level: parseInt(level), source: `${value} Bloodline`, type: 'bloodline' });
        });
      }

      // Bloodline powers
      const powers = (bl.bloodlinePowers || []).filter(p => p.level <= (char.level || 1));

      return {
        bloodline: value,
        bloodlineData: bl,
        bonusBloodlineSpells: bonusSpells,
        bloodlinePowers: powers,
        bloodlineBonusFeats: bl.bonusFeats || [],
        bloodlineClassSkill: bl.classSkill || null,
      };
    },
  },

  /**
   * ARCANE SCHOOL — Wizards pick a school (or Universalist). Specialists also pick 2 opposed schools.
   */
  arcaneSchool: {
    label: 'Arcane School',
    description: 'Choose your school of specialization (or Universalist)',
    selectType: 'single',
    dataKey: 'arcaneSchool',
    getOptions: () => {
      return [
        { name: 'Universalist', description: 'No specialization. Access all schools equally.', opposed: false },
        { name: 'Abjuration', description: 'Protective magic. Grants Resistance and Energy Absorption.', opposed: true },
        { name: 'Conjuration', description: 'Summoning and creation. Grants Acid Dart and Dimensional Steps.', opposed: true },
        { name: 'Divination', description: 'Knowledge and foresight. Grants Forewarned and Scrying Adept.', opposed: true },
        { name: 'Enchantment', description: 'Mind-affecting magic. Grants Enchanting Smile and Aura of Despair.', opposed: true },
        { name: 'Evocation', description: 'Energy and damage. Grants Force Missile and Elemental Wall.', opposed: true },
        { name: 'Illusion', description: 'Deception and trickery. Grants Blinding Ray and Invisibility Field.', opposed: true },
        { name: 'Necromancy', description: 'Death and undeath. Grants Power over Undead and Life Sight.', opposed: true },
        { name: 'Transmutation', description: 'Transformation. Grants Telekinetic Fist and Change Shape.', opposed: true },
      ];
    },
    getOptionLabel: (s) => s.name,
    getOptionValue: (s) => s.name,
    getOptionDetail: (s) => s.description,
    validate: (value) => {
      if (!value) return 'An arcane school must be selected';
      return null;
    },
    apply: (char, value) => {
      return {
        arcaneSchool: value,
        // If not Universalist, they'll need to pick opposed schools
        needsOpposedSchools: value !== 'Universalist',
      };
    },
  },

  /**
   * OPPOSED SCHOOLS — Wizard specialists pick 2 schools they can't cast easily.
   */
  opposedSchools: {
    label: 'Opposed Schools',
    description: 'Choose 2 opposed schools (spells from these cost an extra slot)',
    selectType: 'multi',
    dataKey: 'opposedSchools',
    count: 2,
    getOptions: (char) => {
      const allSchools = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
      // Exclude selected school
      return allSchools
        .filter(s => s !== char.arcaneSchool)
        .map(s => ({ name: s }));
    },
    getOptionLabel: (s) => s.name || s,
    getOptionValue: (s) => s.name || s,
    getOptionDetail: () => '',
    // Only required if school is not Universalist
    condition: (char) => char.arcaneSchool && char.arcaneSchool !== 'Universalist',
    validate: (value) => {
      if (!value || !Array.isArray(value) || value.length < 2) {
        return 'Select 2 opposed schools';
      }
      return null;
    },
    apply: (char, value) => ({
      opposedSchools: value,
    }),
  },

  // ─────────────────────────────────────────────────────────
  // ARCANE BOND — Wizards pick one of two flavors at level 1.
  // CRB p. 78. The choice between Familiar and Bonded Object is
  // mutually exclusive — picking one rules out the other for the
  // life of the character (without retraining).
  // ─────────────────────────────────────────────────────────
  arcaneBond: {
    label: 'Arcane Bond',
    description: 'Wizards form a magical bond with either a familiar (an animal companion that grants you a small persistent bonus) OR a bonded object (a magical item that grants you one extra spell slot per day, with the catch that casting without it requires a concentration check). CRB p. 78.',
    selectType: 'single',
    dataKey: 'arcaneBond',
    getOptions: () => [
      { id: 'familiar', label: 'Familiar' },
      { id: 'bondedObject', label: 'Bonded Object' },
    ],
    getOptionLabel: (o) => o.label,
    getOptionValue: (o) => o.id,
    getOptionDetail: (o) => o.id === 'familiar'
      ? 'A loyal animal magically linked to you. You gain a small permanent bonus depending on the species (Cat: +3 Stealth; Toad: +3 max HP; Hawk: +3 Perception in bright light; etc.). The familiar shares your spells and grows with your wizard level.'
      : 'A magical item bound to your soul. You can cast one extra spell per day from your spellbook through it. To cast any spell while NOT in possession of the bonded object, you must succeed at a concentration check (DC 20 + spell level).',
    validate: (value) => value ? null : 'Choose Familiar or Bonded Object',
    apply: (char, value) => {
      // Clear BOTH the authoritative shapes AND the raw-selection scratch
      // fields on the inactive side. Two reasons:
      //   1. Stale `character.familiar` on a Bonded-Object wizard would be
      //      picked up by the Phase 7.3 aggregator and silently grant a
      //      familiar bonus the character isn't entitled to.
      //   2. Stale `familiarChoice` / `bondedObjectType` scratch fields on
      //      the final character clutter the save file and could mislead a
      //      future save migration or edit-mode. They're meant to live only
      //      during creation-step UI state.
      if (value === 'familiar') {
        return {
          arcaneBond: value,
          familiar: char.familiar,
          bondedObject: null,
          bondedObjectType: '',
        };
      }
      if (value === 'bondedObject') {
        return {
          arcaneBond: value,
          bondedObject: char.bondedObject,
          familiar: null,
          familiarChoice: '',
        };
      }
      // No value picked yet — clear both sides entirely.
      return {
        arcaneBond: value,
        familiar: null,
        bondedObject: null,
        familiarChoice: '',
        bondedObjectType: '',
      };
    },
  },

  // ─────────────────────────────────────────────────────────
  // FAMILIAR — pick which creature serves as the master's familiar.
  // Used by both Wizards (when arcaneBond === 'familiar') and Witches
  // (whose patron familiar is mandatory and serves as her spellbook).
  //
  // The option list comes from familiarEngine.listFamiliarOptions, which
  // returns base familiars + improved familiars annotated with eligibility.
  // We filter to eligible-only so the dropdown stays clean. Improved
  // familiars require the Improved Familiar feat (CRB p. 127); during
  // character creation user-selected feats live in selectedFeats, not
  // feats, so we synthesize a merged view before calling the eligibility
  // check.
  // ─────────────────────────────────────────────────────────
  familiar: {
    label: 'Familiar',
    description: 'Pick which creature serves as your familiar. Each grants a small but persistent bonus to its master.',
    selectType: 'single',
    dataKey: 'familiarChoice', // raw id during selection; finalized below
    getOptions: (char) => {
      // CharacterCreator stores user-selected feats in `selectedFeats`
      // (line ~125 of CharacterCreator.jsx) and only flattens them into
      // `feats` at finalization. isFamiliarEligible reads `feats`, so we
      // synthesize a merged view here. This makes Improved Familiar
      // entries appear in the dropdown the moment the user picks the
      // feat on the Feats step and returns to Class Features.
      const view = {
        ...char,
        feats: [
          ...((char && Array.isArray(char.feats)) ? char.feats : []),
          ...((char && Array.isArray(char.selectedFeats)) ? char.selectedFeats : []),
        ],
      };
      return listFamiliarOptions(view).filter((o) => o.eligible);
    },
    getOptionLabel: (o) => `${o.name}${o.kind === 'improved' ? ' (improved)' : ''}`,
    getOptionValue: (o) => o.id,
    getOptionDetail: (o) => {
      const parts = [];
      if (o.masterBonus) {
        const mb = o.masterBonus;
        if (mb.kind === 'skill') {
          parts.push(`Master bonus: +${mb.value} ${mb.skill}${mb.condition ? ' (' + mb.condition + ')' : ''}`);
        } else if (mb.kind === 'save') {
          const saveLabel = String(mb.save || '').replace(/^./, (c) => c.toUpperCase());
          parts.push(`Master bonus: +${mb.value} ${saveLabel} saves`);
        } else if (mb.kind === 'hp') {
          parts.push(`Master bonus: +${mb.value} max HP`);
        }
      }
      if (o.description) parts.push(o.description);
      return parts.join(' — ');
    },
    validate: (value) => value ? null : 'Pick a familiar',
    apply: (char, value) => ({
      familiarChoice: value,
      // Phase 7.3 aggregator contract: character.familiar = { id: <string> }.
      // No other fields — the live stat block is recomputed by
      // deriveFamiliarStats at display time, never persisted.
      familiar: value ? { id: value } : null,
    }),
  },

  // ─────────────────────────────────────────────────────────
  // BONDED OBJECT — picked when arcaneBond === 'bondedObject'.
  // The mechanical effects (bonus spell slot, concentration check
  // when separated) are reserved for the spellcasting layer in a
  // later phase; for Phase 7.4 we just persist the type so the
  // character sheet can display it and the GM can adjudicate.
  // ─────────────────────────────────────────────────────────
  bondedObject: {
    label: 'Bonded Object',
    description: 'Choose what kind of object holds your magical bond.',
    selectType: 'single',
    dataKey: 'bondedObjectType',
    getOptions: () => BONDED_OBJECT_TYPES,
    getOptionLabel: (o) => o.label,
    getOptionValue: (o) => o.type,
    getOptionDetail: (o) => o.description,
    validate: (value) => value ? null : 'Pick an object type',
    apply: (char, value) => ({
      bondedObjectType: value,
      bondedObject: value ? { type: value } : null,
    }),
  },
};

// ══════════════════════════════════════════════════════════
// CLASS → FEATURE MAPPING
// Defines which features each class needs.
// order: determines the UI rendering order (deity before domains, etc.)
// ══════════════════════════════════════════════════════════

export const CLASS_FEATURES = {
  Cleric:      { features: [
    { type: 'deity', required: true },
    { type: 'domains', required: true, count: 2 },
  ]},
  Druid:       { features: [
    // Druids don't pick a deity in all campaigns, but do pick a domain (Nature Bond)
    { type: 'deity', required: false },
    { type: 'domains', required: false, count: 1, label: 'Nature Bond (Domain)', description: 'Choose a domain for Nature Bond (or select Animal Companion instead)' },
  ]},
  Inquisitor:  { features: [
    { type: 'deity', required: true },
    { type: 'domains', required: true, count: 1, label: 'Inquisition/Domain' },
  ]},
  Warpriest:   { features: [
    { type: 'deity', required: true },
    { type: 'domains', required: false, count: 1, label: 'Blessing (from Domain)', description: 'Your blessings come from your deity\'s domains' },
  ]},
  Paladin:     { features: [
    { type: 'deity', required: false },
  ]},
  Oracle:      { features: [
    // Oracle picks a mystery, not a deity — future feature type
  ]},
  Sorcerer:    { features: [
    { type: 'bloodline', required: true },
  ]},
  Bloodrager:  { features: [
    { type: 'bloodline', required: true },
  ]},
  Wizard:      { features: [
    { type: 'arcaneSchool', required: true },
    { type: 'opposedSchools', required: false },
    { type: 'arcaneBond', required: true },
    { type: 'familiar', required: true, condition: (c) => c.arcaneBond === 'familiar' },
    { type: 'bondedObject', required: true, condition: (c) => c.arcaneBond === 'bondedObject' },
  ]},
  Witch:       { features: [
    { type: 'familiar', required: true,
      label: 'Patron Familiar',
      description: "Your patron's familiar serves you as both companion and spellbook. Pick which creature embodies it. CRB p. 65 (APG)." },
  ]},
  // Arcanist uses arcane exploits — future feature type
  // Shaman uses spirits — future feature type
};

// ══════════════════════════════════════════════════════════
// API: Get features needed for a class
// ══════════════════════════════════════════════════════════

/**
 * Returns array of feature definitions for a given class.
 * Each entry: { type, required, count?, label?, description?, ...FEATURE_TYPES[type] }
 */
export function getClassFeatures(className) {
  const classDef = CLASS_FEATURES[className];
  if (!classDef) return [];

  return classDef.features.map(f => {
    const typeDef = FEATURE_TYPES[f.type];
    if (!typeDef) return null;
    return {
      ...typeDef,
      ...f,
      label: f.label || typeDef.label,
      description: f.description || typeDef.description,
    };
  }).filter(Boolean);
}

/**
 * Check if a class has any features that need selection.
 */
export function classHasFeatures(className) {
  return getClassFeatures(className).length > 0;
}

/**
 * Validate all feature selections for a character.
 * Returns array of error strings, or empty array if valid.
 */
export function validateClassFeatures(char) {
  const features = getClassFeatures(char.class);
  const errors = [];

  features.forEach(f => {
    // Check condition (e.g., opposed schools only if specialist)
    if (f.condition && !f.condition(char)) return;
    if (!f.required) return;

    const value = f.selectType === 'multi' ? char[f.dataKey] : char[f.dataKey];
    const error = f.validate?.(value, char, f);
    if (error) errors.push(error);
  });

  return errors;
}

/**
 * Apply all feature selections to a character object.
 * Returns a new char object with all bonuses applied.
 */
export function applyClassFeatures(char) {
  const features = getClassFeatures(char.class);
  let applied = { ...char };

  features.forEach(f => {
    if (f.condition && !f.condition(applied)) return;
    const value = applied[f.dataKey];
    if (value !== undefined && value !== null && value !== '') {
      const result = f.apply?.(applied, value);
      if (result) {
        applied = { ...applied, ...result };
      }
    }
  });

  return applied;
}

// ══════════════════════════════════════════════════════════
// HERITAGE RULES — applies heritage bonuses to ability scores
// ══════════════════════════════════════════════════════════

import heritagesData from '../data/heritages.json';

/**
 * Get the heritage definition for a character's race + heritage selection.
 */
export function getHeritage(race, heritageName) {
  const raceHeritages = heritagesData[race];
  if (!raceHeritages) return null;
  return raceHeritages.find(h => h.name === heritageName) || null;
}

/**
 * Determine what ability bonuses a heritage provides.
 * Returns: { fixed: {STR: 2, ...}, choices: [{count, bonus}], penalties: {CHA: -2, ...} }
 */
export function getHeritageBonuses(race, heritageName) {
  const heritage = getHeritage(race, heritageName);
  if (!heritage) return { fixed: {}, choices: [], penalties: {} };

  const fixed = {};
  const choices = [];
  const penalties = heritage.penalty || {};

  Object.entries(heritage.bonuses || {}).forEach(([key, value]) => {
    if (key === 'choice') {
      choices.push({ count: 1, bonus: value, label: 'Choose one ability score' });
    } else if (key === 'choice2') {
      choices.push({ count: 2, bonus: value, label: 'Choose two different ability scores' });
    } else if (['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(key)) {
      fixed[key] = value;
    }
  });

  return { fixed, choices, penalties };
}

/**
 * Apply heritage bonuses to ability scores.
 * @param abilities - base abilities {STR: 10, ...}
 * @param race - race name
 * @param heritageName - heritage name
 * @param racialChoices - array of ability names chosen for "choice"/"choice2" bonuses
 * @returns modified abilities object
 */
export function applyHeritageBonuses(abilities, race, heritageName, racialChoices = []) {
  const { fixed, choices, penalties } = getHeritageBonuses(race, heritageName);
  const result = { ...abilities };

  // Apply fixed bonuses
  Object.entries(fixed).forEach(([ability, bonus]) => {
    result[ability] = (result[ability] || 10) + bonus;
  });

  // Apply choice bonuses
  let choiceIdx = 0;
  choices.forEach(choice => {
    for (let i = 0; i < choice.count; i++) {
      const chosen = racialChoices[choiceIdx];
      if (chosen && result[chosen] !== undefined) {
        result[chosen] += choice.bonus;
      }
      choiceIdx++;
    }
  });

  // Apply penalties
  Object.entries(penalties).forEach(([ability, penalty]) => {
    result[ability] = (result[ability] || 10) + penalty;
  });

  return result;
}

/**
 * Get what traits a heritage replaces and adds.
 */
export function getHeritageTraitChanges(race, heritageName) {
  const heritage = getHeritage(race, heritageName);
  if (!heritage) return { replaced: [], added: [], spellLike: null };
  return {
    replaced: heritage.replaceTraits || [],
    added: heritage.addTraits || [],
    spellLike: heritage.spellLike || null,
  };
}
