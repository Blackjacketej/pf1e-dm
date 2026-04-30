import React, { useState, useMemo } from 'react';
import { rollAbilityScore, rollClassic3d6, rollHeroic, rollDicePool, mod, calcBAB, calcSave, getMaxHP, uid, rollDice } from '../utils/dice';
import { getStartingGold, getSkillPointsPerLevel, calcFullAC } from '../utils/character';
import { parseAllFeats, checkFeatPrereqs } from '../utils/featPrereqs';
import { classHasFeatures, applyClassFeatures, validateClassFeatures, getHeritageBonuses, applyHeritageBonuses, getHeritageTraitChanges } from '../utils/classFeatureRegistry';
import { getFamiliarById, getMasterFamiliarBonus } from '../utils/familiarEngine';
import ClassFeatureStep from './ClassFeatureStep';
import skillsData from '../data/skills.json';
import spellsData from '../data/spells.json';
import gearData from '../data/gear.json';
// Base PF1e armor and shield tables for character creation
const BASE_ARMOR = [
  { name: 'None', ac: 0, maxDex: 99, acp: 0, type: 'none' },
  { name: 'Padded', ac: 1, maxDex: 8, acp: 0, type: 'light' },
  { name: 'Leather', ac: 2, maxDex: 6, acp: 0, type: 'light' },
  { name: 'Studded Leather', ac: 3, maxDex: 5, acp: -1, type: 'light' },
  { name: 'Chain Shirt', ac: 4, maxDex: 4, acp: -2, type: 'light' },
  { name: 'Hide', ac: 4, maxDex: 4, acp: -3, type: 'medium' },
  { name: 'Scale Mail', ac: 5, maxDex: 3, acp: -4, type: 'medium' },
  { name: 'Chainmail', ac: 6, maxDex: 2, acp: -5, type: 'medium' },
  { name: 'Breastplate', ac: 6, maxDex: 3, acp: -4, type: 'medium' },
  { name: 'Splint Mail', ac: 7, maxDex: 0, acp: -7, type: 'heavy' },
  { name: 'Banded Mail', ac: 7, maxDex: 1, acp: -6, type: 'heavy' },
  { name: 'Half-Plate', ac: 8, maxDex: 0, acp: -7, type: 'heavy' },
  { name: 'Full Plate', ac: 9, maxDex: 1, acp: -6, type: 'heavy' },
];
const BASE_SHIELDS = [
  { name: 'None', ac: 0, acp: 0 },
  { name: 'Buckler', ac: 1, acp: -1 },
  { name: 'Light Shield (Wood)', ac: 1, acp: -1 },
  { name: 'Light Shield (Steel)', ac: 1, acp: -1 },
  { name: 'Heavy Shield (Wood)', ac: 2, acp: -2 },
  { name: 'Heavy Shield (Steel)', ac: 2, acp: -2 },
  { name: 'Tower Shield', ac: 4, acp: -10 },
];
const equipmentData = { armor: BASE_ARMOR, shields: BASE_SHIELDS };
import ethnicitiesData from '../data/ethnicities.json';
import heritagesData from '../data/heritages.json';
import alternateRacialTraitsData from '../data/alternateRacialTraits.json';
import traitsData from '../data/traits.json';
import { generateRandomName, ETHNICITIES } from '../utils/nameGenerator';
import {
  rollRandomAge,
  rollRandomHeightWeight,
  pickRandomDeity,
  getDeityNote,
  getAgeBracket,
  RACE_DEITIES,
} from '../utils/raceDemographics';
import deitiesData from '../data/deities.json';

// PF1e point buy costs: 7-9 give points BACK (negative cost), 10 is baseline, 11+ costs points
const POINT_BUY_COST = {
  7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3,
  14: 5, 15: 7, 16: 10, 17: 13, 18: 17,
};

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

const ALLOWED_ALIGNMENTS = {
  'Paladin': ['Lawful Good'],
  'Barbarian': ['Chaotic Good', 'Chaotic Neutral', 'Chaotic Evil'],
  'Monk': ['Lawful Good', 'Lawful Neutral', 'Lawful Evil'],
};

const SPELLCASTING_CLASSES = {
  'Alchemist': 'INT', 'Arcanist': 'INT', 'Bard': 'CHA', 'Cleric': 'WIS',
  'Druid': 'WIS', 'Magus': 'INT', 'Oracle': 'CHA', 'Paladin': 'CHA',
  'Ranger': 'WIS', 'Sorcerer': 'CHA', 'Wizard': 'INT', 'Witch': 'INT',
};

const SPELLCASTER_TYPES = {
  'Wizard': 'prepared', 'Cleric': 'prepared', 'Druid': 'prepared', 'Paladin': 'prepared',
  'Ranger': 'prepared', 'Sorcerer': 'spontaneous', 'Bard': 'spontaneous', 'Oracle': 'spontaneous',
};

export default function CharacterCreator({
  onComplete,
  onCancel,
  races = [],
  classes = [],
  weapons = [],
  armorList = [],
  shields = [],
  feats = [],
  dmPreferences = {},
}) {
  const [step, setStep] = useState(0);
  const defaultMethod = dmPreferences?.abilityScoreMethod || 'point-buy-20';
  const defaultBudget = defaultMethod.startsWith('point-buy-')
    ? parseInt(defaultMethod.split('-').pop()) || 20
    : 20;
  const [pointBuyMode, setPointBuyMode] = useState(
    !defaultMethod || defaultMethod.startsWith('point-buy') || defaultMethod === 'standard-array'
  );
  const [pointBuyPoints, setPointBuyPoints] = useState(defaultBudget);
  const [abilityMethod, setAbilityMethod] = useState(defaultMethod);
  const [selectedRacialBonus, setSelectedRacialBonus] = useState(null);
  const [gnomeObsessiveSkill, setGnomeObsessiveSkill] = useState('');
  const [skillFilter, setSkillFilter] = useState('');
  const [spellFilter, setSpellFilter] = useState('');
  const [spellLevelFilter, setSpellLevelFilter] = useState('all');
  const [featFilter, setFeatFilter] = useState('');
  const [traitCategoryFilter, setTraitCategoryFilter] = useState('all');
  const [gearSearch, setGearSearch] = useState('');
  const [originIsCustom, setOriginIsCustom] = useState(false);
  const [showIneligibleFeats, setShowIneligibleFeats] = useState(false);

  const [char, setChar] = useState({
    id: uid(),
    name: '',
    race: '',
    class: '',
    alignment: '',
    gender: '',
    ethnicity: '',
    heritage: '',
    alternateRacialTraits: [],
    origin: '',
    languages: ['Common'],
    level: 1,
    xp: 0,
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    skillRanks: {},
    feats: [],
    selectedFeats: [],
    weapons: [],
    armor: 'None',
    shield: 'None',
    spellsKnown: [],
    spellsPrepared: [],
    equipment: [],
    conditions: [],
    activeConditions: [],
    inventory: [],
    notes: '',
    characterTraits: [],   // PF1e character traits (2 from different categories, 3 with drawback)
    drawback: '',          // Optional PF1e drawback — take one to gain a 3rd trait
    personality: '',
    appearance: '',
    backstory: '',
    // Vital Statistics — CRB Tables 7-1 / 7-2 / 7-3 (page 168-170)
    age: '',          // numeric years
    heightInches: '', // total inches; display as feet/inches
    weightLbs: '',    // pounds
    deity: '',        // deity name (optional except for clerics)
    // Phase 7.4 — Arcane Bond / Familiar (Wizard, Witch). Bonded object reserved
    // for Wizards. familiar shape: { id: <string> } per Phase 7.3 contract.
    arcaneBond: '',          // 'familiar' | 'bondedObject' (Wizard only)
    familiarChoice: '',      // raw familiar id during creation
    familiar: null,          // { id } once chosen, else null
    bondedObjectType: '',    // 'amulet' | 'ring' | 'staff' | 'wand' | 'weapon'
    bondedObject: null,      // { type } once chosen, else null
  });

  const [rollAbilities, setRollAbilities] = useState({
    STR: null, DEX: null, CON: null, INT: null, WIS: null, CHA: null,
  });

  const [pointBuyAbilities, setPointBuyAbilities] = useState({
    STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10,
  });

  // Track roll assignment: which ability is selected, which rolls have been used
  const [selectedAbilityForRoll, setSelectedAbilityForRoll] = useState(null);
  const [assignedAbilities, setAssignedAbilities] = useState(new Set());
  const [usedRollIndices, setUsedRollIndices] = useState(new Set());

  // Dice Pool (24d6) state — pool of individual dice, user assigns groups of 3+ to each ability
  const [dicePool, setDicePool] = useState([]);           // array of 24 d6 values
  const [dicePoolAssignments, setDicePoolAssignments] = useState({ STR: [], DEX: [], CON: [], INT: [], WIS: [], CHA: [] });
  const [selectedPoolAbility, setSelectedPoolAbility] = useState('STR');

  // Heritage racial ability choices (for heritage bonuses like Dual Talent's choice2)
  const [racialChoices, setRacialChoices] = useState([]);

  // Build steps dynamically — insert "Class Features" after Basics if the class needs it
  const hasClassFeats = classHasFeatures(char.class);
  const steps = useMemo(() => {
    const base = ['Basics'];
    if (hasClassFeats) base.push('Class Features');
    base.push('Abilities', 'Skills', 'Feats', 'Spells', 'Equipment', 'Traits & Details', 'Review');
    return base;
  }, [hasClassFeats]);

  const classesMap = useMemo(() => {
    const map = {};
    classes.forEach(c => { map[c.name] = c; });
    return map;
  }, [classes]);

  // Pre-parse all feat prerequisites for fast eligibility checking
  const featPrereqMap = useMemo(() => parseAllFeats(feats), [feats]);

  const racesMap = useMemo(() => {
    const map = {};
    races.forEach(r => { map[r.name] = r; });
    return map;
  }, [races]);

  const selectedRace = racesMap[char.race];
  const selectedClass = classesMap[char.class];

  const styles = {
    container: {
      backgroundColor: '#1a1a2e',
      border: '2px solid #ffd700',
      borderRadius: '8px',
      padding: '24px',
      color: '#d4c5a9',
      maxHeight: '85vh',
      overflowY: 'auto',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '24px',
    },
    title: {
      color: '#ffd700',
      fontSize: '20px',
      fontWeight: 'bold',
    },
    stepContainer: {
      display: 'flex',
      gap: '8px',
      marginBottom: '24px',
      overflowX: 'auto',
      flexWrap: 'wrap',
    },
    stepButton: {
      padding: '8px 12px',
      borderRadius: '4px',
      border: '1px solid #ffd700',
      color: '#d4c5a9',
      backgroundColor: '#2a2a4e',
      cursor: 'pointer',
      fontSize: '11px',
      whiteSpace: 'nowrap',
    },
    stepButtonActive: {
      backgroundColor: '#ffd700',
      color: '#1a1a2e',
      fontWeight: 'bold',
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    },
    label: {
      color: '#ffd700',
      fontSize: '12px',
      fontWeight: 'bold',
    },
    input: {
      padding: '10px',
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      borderRadius: '4px',
      color: '#d4c5a9',
      fontFamily: 'monospace',
      fontSize: '12px',
    },
    select: {
      padding: '10px',
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      borderRadius: '4px',
      color: '#d4c5a9',
      fontSize: '12px',
    },
    infoPanel: {
      backgroundColor: '#2a2a4e',
      border: '1px solid #8b949e',
      borderRadius: '4px',
      padding: '12px',
      marginTop: '12px',
      fontSize: '12px',
      color: '#d4c5a9',
      lineHeight: '1.6',
    },
    gridRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px',
    },
    abilityBox: {
      backgroundColor: '#2a2a4e',
      border: '2px solid #ffd700',
      borderRadius: '4px',
      padding: '12px',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    skillRow: {
      display: 'grid',
      gridTemplateColumns: '180px 1fr 80px 60px',
      gap: '12px',
      alignItems: 'center',
      padding: '8px',
      borderBottom: '1px solid #3a3a6e',
    },
    skillLabel: {
      fontSize: '11px',
      color: '#d4c5a9',
    },
    skillRanksInput: {
      width: '60px',
      padding: '4px',
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      borderRadius: '4px',
      color: '#d4c5a9',
      fontSize: '11px',
      textAlign: 'center',
    },
    button: {
      flex: 1,
      padding: '12px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '4px',
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '12px',
    },
    buttonSmall: {
      padding: '6px 12px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #8b949e',
      color: '#d4c5a9',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '11px',
    },
    buttonRow: {
      display: 'flex',
      gap: '12px',
      marginTop: '24px',
    },
    toggleButton: {
      padding: '8px 16px',
      backgroundColor: '#3a3a6e',
      border: '2px solid #8b949e',
      color: '#d4c5a9',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
    },
    toggleButtonActive: {
      borderColor: '#ffd700',
      color: '#ffd700',
      fontWeight: 'bold',
    },
    listContainer: {
      maxHeight: '400px',
      overflowY: 'auto',
      border: '1px solid #3a3a6e',
      borderRadius: '4px',
      backgroundColor: '#1a1a2e',
    },
    listItem: {
      padding: '8px 12px',
      borderBottom: '1px solid #2a2a4e',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: '11px',
    },
    iconBadge: {
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      borderRadius: '3px',
      padding: '2px 6px',
      fontSize: '10px',
      color: '#ffd700',
    },
  };

  const getFilteredFeats = () => {
    let filtered = feats;
    if (featFilter) {
      filtered = filtered.filter(f =>
        f.name.toLowerCase().includes(featFilter.toLowerCase()) ||
        (f.category && f.category.toLowerCase().includes(featFilter.toLowerCase()))
      );
    }
    // Annotate with eligibility — build a temp char for checking
    const tempChar = {
      ...char,
      feats: char.selectedFeats || [],
      level: char.level || 1,
    };
    filtered = filtered.map(f => {
      const { met, missing } = checkFeatPrereqs(f.name, tempChar, featPrereqMap);
      return { ...f, eligible: met, missing };
    });
    // Sort: eligible first, then ineligible
    filtered.sort((a, b) => (b.eligible ? 1 : 0) - (a.eligible ? 1 : 0));
    // Optionally hide ineligible
    if (!showIneligibleFeats) {
      filtered = filtered.filter(f => f.eligible);
    }
    return filtered;
  };

  const getFilteredSpells = () => {
    let filtered = spellsData;
    if (spellFilter) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(spellFilter.toLowerCase())
      );
    }
    if (spellLevelFilter !== 'all') {
      const level = parseInt(spellLevelFilter);
      filtered = filtered.filter(s => {
        const spellLevel = s.level?.[char.class] ?? s.level?.wizard ?? null;
        return spellLevel === level;
      });
    }
    return filtered;
  };

  const getFilteredSkills = () => {
    return skillsData.filter(s =>
      s.name.toLowerCase().includes(skillFilter.toLowerCase()) ||
      s.ability.toLowerCase().includes(skillFilter.toLowerCase())
    );
  };

  // Check if an alternate racial trait that overrides ability bonuses is active (e.g., Dual Talent)
  const activeAbilityTrait = useMemo(() => {
    if (!char.race || !char.alternateRacialTraits?.length) return null;
    const traits = alternateRacialTraitsData[char.race] || [];
    return traits.find(t =>
      char.alternateRacialTraits.includes(t.name) && (t.bonuses?.choice2 || t.bonuses?.choice)
    ) || null;
  }, [char.race, char.alternateRacialTraits]);

  const getAbilityScore = (ability) => {
    const base = pointBuyMode ? pointBuyAbilities[ability] : char.abilities[ability];
    let bonus = 0;

    // If heritage (subrace) is selected, use heritage bonuses instead of base race bonuses
    if (char.heritage && char.race) {
      const hb = getHeritageBonuses(char.race, char.heritage);
      if (hb.fixed[ability]) bonus += hb.fixed[ability];
      if (hb.penalties[ability]) bonus += hb.penalties[ability];
      racialChoices.forEach(chosen => {
        if (chosen === ability) {
          const choiceBonus = hb.choices.length > 0 ? hb.choices[0].bonus : 2;
          bonus += choiceBonus;
        }
      });
    } else if (activeAbilityTrait) {
      // An alternate racial trait overrides default ability bonuses (e.g., Dual Talent)
      // Apply fixed bonuses from the race that aren't choice-based
      if (selectedRace?.bonuses) {
        Object.entries(selectedRace.bonuses).forEach(([k, v]) => {
          if (k !== 'choice' && ['STR','DEX','CON','INT','WIS','CHA'].includes(k)) bonus += v;
        });
      }
      // Apply the trait's ability choices
      if (activeAbilityTrait.bonuses.choice2) {
        racialChoices.forEach(chosen => {
          if (chosen === ability) bonus += 2;
        });
      }
    } else if (selectedRace?.bonuses) {
      // Default: use base race bonuses
      if (selectedRace.bonuses[ability]) bonus += selectedRace.bonuses[ability];
      if (selectedRace.bonuses.choice && selectedRacialBonus === ability) bonus += 2;
    }
    return base + bonus;
  };

  // Get just the racial bonus for an ability (for display breakdown)
  const getRacialBonus = (ability) => {
    let bonus = 0;
    if (char.heritage && char.race) {
      const hb = getHeritageBonuses(char.race, char.heritage);
      if (hb.fixed[ability]) bonus += hb.fixed[ability];
      if (hb.penalties[ability]) bonus += hb.penalties[ability];
      racialChoices.forEach(chosen => {
        if (chosen === ability) {
          const choiceBonus = hb.choices.length > 0 ? hb.choices[0].bonus : 2;
          bonus += choiceBonus;
        }
      });
    } else if (activeAbilityTrait) {
      if (selectedRace?.bonuses) {
        Object.entries(selectedRace.bonuses).forEach(([k, v]) => {
          if (k !== 'choice' && ['STR','DEX','CON','INT','WIS','CHA'].includes(k)) bonus += v;
        });
      }
      if (activeAbilityTrait.bonuses.choice2) {
        racialChoices.forEach(chosen => {
          if (chosen === ability) bonus += 2;
        });
      }
    } else if (selectedRace?.bonuses) {
      if (selectedRace.bonuses[ability]) bonus += selectedRace.bonuses[ability];
      if (selectedRace.bonuses.choice && selectedRacialBonus === ability) bonus += 2;
    }
    return bonus;
  };

  const getPointBuySpent = () => {
    let spent = 0;
    Object.entries(pointBuyAbilities).forEach(([ability, score]) => {
      if (score >= 7 && score <= 18) {
        spent += POINT_BUY_COST[score] || 0;
      }
    });
    // NOTE: Racial modifiers do NOT change point buy cost in PF1e.
    // You buy the base score; racial bonuses/penalties are applied on top for free.
    return spent;
  };

  const handlePointBuyChange = (ability, amount) => {
    const newValue = pointBuyAbilities[ability] + amount;
    if (newValue < 7 || newValue > 18) return;

    // Check point budget before allowing increase
    if (amount > 0) {
      const newCost = POINT_BUY_COST[newValue] || 0;
      const oldCost = POINT_BUY_COST[pointBuyAbilities[ability]] || 0;
      const delta = newCost - oldCost;
      if (getPointBuySpent() + delta > pointBuyPoints) return; // over budget
    }

    setPointBuyAbilities({ ...pointBuyAbilities, [ability]: newValue });
  };

  const applyPointBuyToChar = () => {
    setChar({
      ...char,
      abilities: { ...pointBuyAbilities },
    });
  };

  const rollAllAbilities = () => {
    const abilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    if (abilityMethod === 'classic-3d6') {
      // Classic: 3d6 in order, assigned directly
      const newAbilities = {};
      abilities.forEach(a => { newAbilities[a] = rollClassic3d6(); });
      setChar({ ...char, abilities: newAbilities });
      setRollAbilities(newAbilities);
      setAssignedAbilities(new Set(abilities));
      setUsedRollIndices(new Set([0, 1, 2, 3, 4, 5]));
      setSelectedAbilityForRoll(null);
      return; // Skip the shared cleanup below — classic is fully assigned
    } else {
      // 4d6-drop-lowest or heroic: roll pool, user assigns
      const rolls = abilities.map(() => {
        if (abilityMethod === 'heroic') return rollHeroic();
        const result = rollAbilityScore();
        return result.total;
      });
      const sorted = rolls.sort((a, b) => b - a);
      // Store in rollAbilities keyed by ability name so the assignment UI can read them
      const rollObj = {};
      abilities.forEach((a, i) => { rollObj[a] = sorted[i]; });
      setRollAbilities(rollObj);
      setAssignedAbilities(new Set());
      setChar(prev => ({
        ...prev,
        abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      }));
    }
    setSelectedAbilityForRoll(null);
    setUsedRollIndices(new Set());
  };

  const assignRolledAbility = (ability, sortedIdx) => {
    // sortedIdx is the direct index in the sorted rolls array
    const rolls = Object.values(rollAbilities).filter(v => v !== null).sort((a, b) => b - a);
    if (sortedIdx < 0 || sortedIdx >= rolls.length || usedRollIndices.has(sortedIdx)) return;

    setChar(prev => ({
      ...prev,
      abilities: { ...prev.abilities, [ability]: rolls[sortedIdx] },
    }));
    setAssignedAbilities(prev => new Set([...prev, ability]));
    setUsedRollIndices(prev => new Set([...prev, sortedIdx]));
    setSelectedAbilityForRoll(null);
  };

  // Undo a single roll assignment — click an assigned ability to free it
  const unassignAbility = (ability) => {
    const currentVal = char.abilities[ability];
    const rolls = Object.values(rollAbilities).filter(v => v !== null).sort((a, b) => b - a);
    // Find which sorted index this value was assigned from
    const sortedIdx = rolls.findIndex((roll, idx) => usedRollIndices.has(idx) && roll === currentVal);
    if (sortedIdx === -1) return;

    setChar(prev => ({
      ...prev,
      abilities: { ...prev.abilities, [ability]: 10 },
    }));
    setAssignedAbilities(prev => {
      const next = new Set(prev);
      next.delete(ability);
      return next;
    });
    setUsedRollIndices(prev => {
      const next = new Set(prev);
      next.delete(sortedIdx);
      return next;
    });
    setSelectedAbilityForRoll(null);
  };

  // Reset all roll assignments but keep the rolled values
  const resetRollAssignments = () => {
    setSelectedAbilityForRoll(null);
    setAssignedAbilities(new Set());
    setUsedRollIndices(new Set());
    setChar(prev => ({
      ...prev,
      abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    }));
  };

  const getSkillPointsAvailable = () => {
    if (!selectedClass) return 0;
    // Use getAbilityScore so racial INT bonuses (e.g., +2 Int from Elf/Gnome/Half-Elf) count
    const intMod = mod(getAbilityScore('INT'));
    const isHuman = char.race === 'Human';
    const base = selectedClass.skills || 2;
    return Math.max(1, base + intMod + (isHuman ? 1 : 0));
  };

  const getUsedSkillPoints = () => {
    return Object.values(char.skillRanks || {}).reduce((sum, v) => sum + v, 0);
  };

  const handleSkillRankChange = (skillName, newRank) => {
    const pointsAvailable = getSkillPointsAvailable();
    const usedExcludingThis = getUsedSkillPoints() - (char.skillRanks[skillName] || 0);
    if (newRank >= 0 && newRank <= char.level && (usedExcludingThis + newRank) <= pointsAvailable) {
      setChar({
        ...char,
        skillRanks: { ...char.skillRanks, [skillName]: newRank || 0 },
      });
    }
  };

  const getMaxFeats = () => {
    let count = 1;
    if (char.race === 'Human') count++; // Human Bonus Feat (PF1e CRB)
    if (char.race === 'Half-Elf') count++; // Half-Elf Adaptability grants Skill Focus (PF1e CRB)
    if (char.class === 'Fighter') count++;
    return count;
  };

  const validateAlignment = (alignment) => {
    const allowed = ALLOWED_ALIGNMENTS[char.class];
    if (!allowed) return true;
    return allowed.includes(alignment);
  };

  const isSpellcaster = () => {
    return char.class && SPELLCASTING_CLASSES[char.class];
  };

  const getSpellLevelsAvailable = () => {
    const levels = [0];
    if (char.level >= 1) levels.push(1);
    if (char.level >= 3) levels.push(2);
    if (char.level >= 5) levels.push(3);
    if (char.level >= 7) levels.push(4);
    if (char.level >= 9) levels.push(5);
    return levels;
  };

  // Current step name for name-based rendering
  const currentStepName = steps[step] || '';

  // Phase 7.4 — memoized validation for the Class Features step. Used both
  // to block the Next button and to render a summary at the bottom of the
  // step. ClassFeatureStep already shows per-feature errors inline, so this
  // is really a "don't let the user click past the step with errors" guard.
  const classFeatureErrors = useMemo(() => {
    if (!classHasFeatures(char.class)) return [];
    return validateClassFeatures(char);
  }, [char]);

  const nextStep = () => {
    if (currentStepName === 'Abilities' && pointBuyMode) {
      applyPointBuyToChar();
    }
    // Gate: don't advance past Class Features with unresolved required picks.
    // Without this, a Wizard could skip picking an arcane school / arcane
    // bond, or a Witch could skip picking her patron familiar, and still
    // finalize into a hollow character.
    if (currentStepName === 'Class Features' && classFeatureErrors.length > 0) {
      return;
    }
    if (step < steps.length - 1) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleComplete = () => {
    // Phase 7.4 — final safety net. nextStep() already blocks advancing out
    // of the Class Features step with errors, but a user who rewinds to a
    // pre-features step and edits something that un-picks a conditional
    // feature (e.g. flips arcaneBond) could slip past. Re-validate here.
    if (classFeatureErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[CharacterCreator] refusing to finalize — class feature errors:', classFeatureErrors);
      return;
    }
    // For point buy / standard array, use pointBuyAbilities as the base (they may not have been synced to char.abilities)
    let finalAbilities = pointBuyMode ? { ...pointBuyAbilities } : { ...char.abilities };
    if (char.heritage && char.race) {
      finalAbilities = applyHeritageBonuses(finalAbilities, char.race, char.heritage, racialChoices);
    } else if (activeAbilityTrait) {
      // An alternate racial trait overrides default ability choices (e.g., Dual Talent)
      // Apply non-choice fixed racial bonuses
      if (selectedRace?.bonuses) {
        Object.entries(selectedRace.bonuses).forEach(([k, v]) => {
          if (k !== 'choice' && ['STR','DEX','CON','INT','WIS','CHA'].includes(k)) {
            finalAbilities[k] = (finalAbilities[k] || 10) + v;
          }
        });
      }
      // Apply the trait's ability choices (e.g., Dual Talent +2 to 2 abilities)
      if (activeAbilityTrait.bonuses.choice2) {
        racialChoices.forEach(abil => {
          finalAbilities[abil] = (finalAbilities[abil] || 10) + 2;
        });
      }
    } else if (selectedRace?.bonuses) {
      // Default: apply base race bonuses
      Object.entries(selectedRace.bonuses).forEach(([k, v]) => {
        if (k === 'choice') {
          if (selectedRacialBonus) finalAbilities[selectedRacialBonus] = (finalAbilities[selectedRacialBonus] || 10) + v;
        } else if (['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].includes(k)) {
          finalAbilities[k] = (finalAbilities[k] || 10) + v;
        }
      });
    }

    // Apply class features (domains, bloodline, deity, school)
    let charWithFeatures = applyClassFeatures({ ...char, abilities: finalAbilities });

    // Phase 7.4 — scrub creation-UI scratch fields. `familiarChoice` and
    // `bondedObjectType` are raw selection strings used only during the
    // ClassFeatureStep; the authoritative shapes are `character.familiar`
    // and `character.bondedObject`, which apply() has already populated.
    // Leaving the scratch fields on the saved character would clutter the
    // save file and could mislead a future save migration.
    delete charWithFeatures.familiarChoice;
    delete charWithFeatures.bondedObjectType;

    // Merge bonus spells from class features into spellsKnown
    const bonusSpells = [
      ...(charWithFeatures.bonusDomainSpells || []),
      ...(charWithFeatures.bonusBloodlineSpells || []),
    ];
    if (bonusSpells.length > 0) {
      charWithFeatures.bonusSpells = bonusSpells;
    }

    // Heritage trait changes
    if (char.heritage && char.race) {
      const traitChanges = getHeritageTraitChanges(char.race, char.heritage);
      charWithFeatures.heritageTraits = traitChanges;
    }

    const armorObj = equipmentData.armor.find(a => a.name === charWithFeatures.armor) || { ac: 0, maxDex: 99 };
    const shieldObj = equipmentData.shields.find(s => s.name === charWithFeatures.shield) || { ac: 0 };
    const maxHp = getMaxHP(charWithFeatures.class, charWithFeatures.level, mod(charWithFeatures.abilities.CON), classesMap);
    const acCalc = calcFullAC(charWithFeatures, armorObj, shieldObj);

    // Check if Rich Parents trait is selected — override starting gold
    const hasRichParents = (charWithFeatures.characterTraits || []).includes('Rich Parents');
    const startingGold = hasRichParents ? 900 : getStartingGold(charWithFeatures.class);

    // ── Build racial skill bonuses from trait text ──
    const racialSkillBonuses = {};
    const traitList = selectedRace?.traits || [];
    // Heritage may replace/add traits
    const heritageTraitChanges = charWithFeatures.heritageTraits || {};
    const removedTraits = (heritageTraitChanges.replaced || []).map(t => t.toLowerCase());
    const addedTraits = heritageTraitChanges.added || [];
    const effectiveTraits = [
      ...traitList.filter(t => !removedTraits.includes(t.toLowerCase())),
      ...addedTraits,
    ];
    // Parse known racial skill bonus patterns from trait text
    const skillBonusPatterns = [
      { pattern: /Keen Senses/i, bonuses: { 'Perception': 2 } },
      { pattern: /Stonecunning/i, bonuses: { 'Perception': 2 } }, // +2 Perception vs unusual stonework (simplified to general)
      { pattern: /Surefooted/i, bonuses: { 'Acrobatics': 2, 'Climb': 2 } },
      { pattern: /Sure-Footed/i, bonuses: { 'Acrobatics': 2, 'Climb': 2 } },
      { pattern: /Greed.*Appraise/i, bonuses: { 'Appraise': 2 } },
      { pattern: /Intimidating.*Intimidate/i, bonuses: { 'Intimidate': 2 } },
      { pattern: /Sneaky/i, bonuses: { 'Stealth': 4 } },
      { pattern: /Stalker/i, bonuses: { 'Stealth': 2, 'Perception': 2 } },
      { pattern: /Sprinter/i, bonuses: {} }, // speed bonus, not skill
      { pattern: /Natural Hunter/i, bonuses: { 'Perception': 2 } },
      { pattern: /Craftsman/i, bonuses: {} },
      { pattern: /Climb.*\+(\d+)/i, bonuses: { 'Climb': 8 } }, // e.g., racial climb speed
    ];
    for (const trait of effectiveTraits) {
      for (const { pattern, bonuses } of skillBonusPatterns) {
        if (pattern.test(trait)) {
          for (const [skill, val] of Object.entries(bonuses)) {
            racialSkillBonuses[skill] = (racialSkillBonuses[skill] || 0) + val;
          }
        }
      }
    }

    // Gnome Obsessive: +2 racial bonus to one Craft or Profession (player's choice from UI)
    if (gnomeObsessiveSkill && char.race === 'Gnome') {
      racialSkillBonuses[gnomeObsessiveSkill] = (racialSkillBonuses[gnomeObsessiveSkill] || 0) + 2;
    }

    // ── Build racial save bonuses ──
    // Unconditional bonuses apply to every save of that type.
    // Conditional bonuses only apply when saveContext matches (enforced in computeSave).
    const racialSaveBonuses = { Fort: 0, Ref: 0, Will: 0 };
    const racialConditionalSaves = [];
    for (const trait of effectiveTraits) {
      // Halfling Luck: +1 all saves (unconditional — PF1e CRB)
      if (/Halfling Luck/i.test(trait)) {
        racialSaveBonuses.Fort += 1;
        racialSaveBonuses.Ref += 1;
        racialSaveBonuses.Will += 1;
      }
      // Hardy: +2 racial bonus vs poison, spells, and spell-like abilities (Dwarf CRB)
      if (/Hardy/i.test(trait)) {
        racialConditionalSaves.push({
          bonus: 2, saves: ['Fort', 'Ref', 'Will'],
          vs: ['poison', 'spell', 'spell-like'],
          source: 'Hardy',
        });
      }
      // Fearless: +2 racial bonus on ALL saving throws vs fear (stacks with Halfling Luck) (Halfling CRB)
      if (/Fearless/i.test(trait)) {
        racialConditionalSaves.push({
          bonus: 2, saves: ['Fort', 'Ref', 'Will'],
          vs: ['fear'],
          source: 'Fearless',
        });
      }
      // Illusion Resistance: +2 racial saving throw bonus vs illusion spells/effects (Gnome CRB)
      if (/Illusion Resistance/i.test(trait)) {
        racialConditionalSaves.push({
          bonus: 2, saves: ['Fort', 'Ref', 'Will'],
          vs: ['illusion'],
          source: 'Illusion Resistance',
        });
      }
      // Elven Immunities: +2 racial saving throw bonus vs enchantment spells/effects (Elf/Half-Elf CRB)
      if (/Elven Immunities/i.test(trait)) {
        racialConditionalSaves.push({
          bonus: 2, saves: ['Fort', 'Ref', 'Will'],
          vs: ['enchantment'],
          source: 'Elven Immunities',
        });
      }
    }

    // ── Racial combat data for conditional bonuses ──
    const racialCombatBonuses = {};
    for (const trait of effectiveTraits) {
      if (/Defensive Training.*Giants/i.test(trait)) {
        racialCombatBonuses.defensiveTraining = { acBonus: 4, vsTypes: ['giant'] };
      }
      if (/Hatred.*orcs?.*goblinoids?/i.test(trait)) {
        racialCombatBonuses.hatred = { attackBonus: 1, vsTypes: ['orc', 'goblinoid'] };
      }
      if (/Hatred.*reptilian.*goblinoids?/i.test(trait)) {
        racialCombatBonuses.hatred = { attackBonus: 1, vsTypes: ['reptilian', 'goblinoid'] };
      }
      if (/Stability/i.test(trait)) {
        racialCombatBonuses.stability = { cmdBonus: 4, vsManeuvers: ['bull rush', 'trip'] };
      }
      // Note: CRB Halfling Weapon Familiarity grants proficiency with slings, NOT an attack bonus.
      // The +1 with slings/thrown was removed — it is not a CRB racial trait.
      // Elven Magic: +2 racial bonus on caster level checks to overcome spell resistance
      if (/Elven Magic/i.test(trait)) {
        racialCombatBonuses.elvenMagic = { srPenetrationBonus: 2 };
      }
      // Gnome Magic: +1 to the DC of illusion spells cast, plus spell-like abilities (PF1e CRB)
      if (/Gnome Magic/i.test(trait)) {
        racialCombatBonuses.gnomeMagic = { illusionDCBonus: 1 };
      }
    }

    // ── Weapon Familiarity — extra proficiencies from race ──
    const racialWeaponProficiencies = [];
    for (const trait of effectiveTraits) {
      const wfMatch = trait.match(/Weapon Familiarity\s*\(([^)]+)\)/i);
      if (wfMatch) {
        // Parse weapon names from the trait text
        const weapons = wfMatch[1].split(',').map(w => w.trim().toLowerCase())
          .filter(w => !w.startsWith('+') && !w.includes('weapons')); // skip "+ elven weapons" generic
        racialWeaponProficiencies.push(...weapons);
        // Also add the "racial weapons treated as martial" category
        const racialMatch = wfMatch[1].match(/\+\s*(\w+)\s+weapons/i);
        if (racialMatch) {
          racialWeaponProficiencies.push(`${racialMatch[1].toLowerCase()} weapons`);
        }
      }
    }

    // ── Vision type ──
    let visionType = 'normal';
    for (const trait of effectiveTraits) {
      if (/Darkvision/i.test(trait)) visionType = 'darkvision';
      else if (/Low-Light Vision/i.test(trait)) {
        if (visionType !== 'darkvision') visionType = 'low-light';
      }
    }

    // ── Languages: merge race starting languages with ethnicity/origin picks ──
    const raceLanguages = selectedRace?.languages || ['Common'];
    const existingLanguages = charWithFeatures.languages || ['Common'];
    // Merge without duplicates — race languages always present
    const mergedLanguages = [...new Set([...raceLanguages, ...existingLanguages])];
    // Store bonus language options for the AI GM to use during play
    const availableBonusLanguages = selectedRace?.bonusLanguages || [];

    // ── Elven Immunities: actual sleep immunity (not just save bonus) ──
    const racialImmunities = [];
    for (const trait of effectiveTraits) {
      if (/Elven Immunities/i.test(trait)) {
        racialImmunities.push('sleep'); // Immune to magic sleep effects (PF1e CRB)
      }
    }

    // ── Racial Spell-Like Abilities ──
    // PF1e CRB: Gnome Magic grants dancing lights, ghost sound, prestidigitation, speak with animals
    // (1/day each, CL = character level, requires CHA ≥ 11)
    const racialSpellLikeAbilities = [];
    for (const trait of effectiveTraits) {
      if (/Gnome Magic/i.test(trait)) {
        const cha = finalAbilities.CHA || 10;
        if (cha >= 11) {
          // DC stored as formula: 10 + spellLevel + current CHA mod (computed at cast time, not creation)
          // Ghost Sound is level 0, Speak with Animals is level 1
          racialSpellLikeAbilities.push(
            { name: 'Dancing Lights', usesPerDay: 1, usesRemaining: 1, casterLevel: 'character', school: 'evocation', spellLevel: 0, save: 'none' },
            { name: 'Ghost Sound', usesPerDay: 1, usesRemaining: 1, casterLevel: 'character', school: 'illusion', spellLevel: 0, save: 'Will disbelief', dcAbility: 'CHA' },
            { name: 'Prestidigitation', usesPerDay: 1, usesRemaining: 1, casterLevel: 'character', school: 'universal', spellLevel: 0, save: 'none' },
            { name: 'Speak with Animals', usesPerDay: 1, usesRemaining: 1, casterLevel: 'character', school: 'divination', spellLevel: 1, save: 'none' },
          );
        }
      }
    }

    // ── Merge selectedFeats into feats so the rules engine can see them ──
    // The rules engine checks character.feats for Weapon Focus, Skill Focus, Power Attack, etc.
    const mergedFeats = [...new Set([
      ...(charWithFeatures.feats || []),
      ...(charWithFeatures.selectedFeats || []),
    ])];

    const finalChar = {
      ...charWithFeatures,
      feats: mergedFeats,
      maxHP: maxHp,
      currentHP: maxHp,
      ac: acCalc.total,
      acBreakdown: acCalc,
      gold: startingGold,
      size: selectedRace?.size || 'Medium',
      speed: selectedRace?.speed || 30,
      languages: mergedLanguages,
      availableBonusLanguages,
      traits: effectiveTraits,
      racialSkillBonuses,
      racialSaveBonuses,
      racialConditionalSaves,
      racialCombatBonuses,
      racialWeaponProficiencies,
      racialImmunities,
      racialSpellLikeAbilities,
      gnomeObsessiveSkill: gnomeObsessiveSkill || null,
      visionType,
      equipped: {},
      spellSlotsUsed: {},
      favoredClassBonus: null,
      // Half-Elf Multitalented: 2 favored classes instead of 1 (PF1e CRB)
      favoredClassCount: char.race === 'Half-Elf' ? 2 : 1,
      favoredClasses: [charWithFeatures.class], // Start with current class; Half-Elf picks 2nd at multiclass
    };

    onComplete(finalChar);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>Hero Lab-Style Character Builder</div>
        <button style={{ ...styles.button, width: '80px' }} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div style={styles.stepContainer}>
        {steps.map((s, i) => (
          <button
            key={i}
            style={{
              ...styles.stepButton,
              ...(i === step ? styles.stepButtonActive : {}),
            }}
            onClick={() => {
              // Sync point buy abilities to char when leaving the Abilities step via direct tab click
              if (currentStepName === 'Abilities' && (pointBuyMode || abilityMethod === 'standard-array')) {
                applyPointBuyToChar();
              }
              setStep(i);
            }}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div style={styles.form}>
        {/* STEP 0: BASICS */}
        {currentStepName === 'Basics' && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>Character Name</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  style={{ ...styles.input, flex: 1, marginBottom: 0 }}
                  value={char.name}
                  onChange={(e) => setChar({ ...char, name: e.target.value })}
                  placeholder="Enter character name"
                />
                <button
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#3a3a6e',
                    border: '1px solid #ffd700',
                    borderRadius: '6px',
                    color: '#ffd700',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                  }}
                  title="Generate a random name"
                  onClick={() => setChar({ ...char, name: generateRandomName(char.race || 'Human', char.ethnicity || undefined, char.gender || undefined) })}
                >
                  Random
                </button>
                <button
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#5e3a3a',
                    border: '1px solid #ffd700',
                    borderRadius: '6px',
                    color: '#ffd700',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                  }}
                  title="Randomize name, age, height, weight, and deity (CRB Tables 7-1 / 7-2 / 7-3 + Chapter 2 race deities). Requires race + class to be selected."
                  disabled={!char.race || !char.class}
                  onClick={() => {
                    const race = char.race;
                    const cls = char.class;
                    const gender = char.gender || (Math.random() < 0.5 ? 'Male' : 'Female');
                    const ethnicity = char.ethnicity || undefined;
                    const newName = generateRandomName(race, ethnicity, gender);
                    const newAge = rollRandomAge(race, cls);
                    const hw = rollRandomHeightWeight(race, gender);
                    const newDeity = pickRandomDeity(race, char.alignment, deitiesData) || '';
                    setChar({
                      ...char,
                      gender: char.gender || gender,
                      name: newName,
                      age: newAge,
                      heightInches: hw.heightInches,
                      weightLbs: hw.weightLbs,
                      deity: newDeity,
                    });
                  }}
                >
                  🎲 All Vitals
                </button>
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Gender</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {['Male', 'Female', 'Non-Binary'].map(g => (
                  <button
                    key={g}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: char.gender === g ? '#ffd700' : '#2a2a4e',
                      color: char.gender === g ? '#0d1117' : '#e0d6c8',
                      border: `1px solid ${char.gender === g ? '#ffd700' : '#444'}`,
                      borderRadius: '16px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: char.gender === g ? 'bold' : 'normal',
                      transition: 'all 0.15s',
                    }}
                    onClick={() => setChar({ ...char, gender: char.gender === g ? '' : g })}
                  >
                    {g}
                  </button>
                ))}
                <input
                  style={{
                    ...styles.input,
                    flex: 1,
                    minWidth: '100px',
                    marginBottom: 0,
                    fontSize: '12px',
                    padding: '6px 10px',
                  }}
                  value={!['Male', 'Female', 'Non-Binary', ''].includes(char.gender) ? char.gender : ''}
                  onChange={(e) => setChar({ ...char, gender: e.target.value })}
                  placeholder="Other..."
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Race</label>
              <select
                style={styles.select}
                value={char.race}
                onChange={(e) => {
                  setChar({ ...char, race: e.target.value, heritage: '', alternateRacialTraits: [] });
                  setSelectedRacialBonus(null);
                  setRacialChoices([]);
                }}
              >
                <option value="">Select Race</option>
                {races.map(r => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
              {selectedRace && (
                <div style={styles.infoPanel}>
                  <div><strong>Speed:</strong> {selectedRace.speed} ft</div>
                  <div><strong>Size:</strong> {selectedRace.size}</div>
                  {/* Show base race bonuses ONLY if no heritage selected (heritage overrides them) */}
                  {selectedRace.bonuses && !char.heritage && !activeAbilityTrait && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Ability Bonuses:</strong>
                      <div>
                        {Object.entries(selectedRace.bonuses).filter(([k]) => k !== 'choice').map(([k, v]) => (
                          <div key={k}>{k}: {v > 0 ? '+' : ''}{v}</div>
                        ))}
                        {selectedRace.bonuses.choice && (
                          <div style={{ marginTop: '8px' }}>
                            +2 to (choose one):
                            {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(abil => (
                              <label key={abil} style={{ display: 'block', marginTop: '4px', fontSize: '11px' }}>
                                <input
                                  type="radio"
                                  name="racialBonus"
                                  checked={selectedRacialBonus === abil}
                                  onChange={() => setSelectedRacialBonus(abil)}
                                />
                                {' '}{abil}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {char.heritage && (
                    <div style={{ marginTop: '8px', padding: '6px 8px', background: '#1a2e1a', borderRadius: '4px', fontSize: '11px', color: '#51cf66' }}>
                      Ability bonuses overridden by heritage — see Heritage/Subrace section below.
                    </div>
                  )}
                  {activeAbilityTrait && (
                    <div style={{ marginTop: '8px', padding: '6px 8px', background: '#1a2e1a', borderRadius: '4px', fontSize: '11px', color: '#51cf66' }}>
                      Ability bonuses overridden by {activeAbilityTrait.name} — see Alternate Racial Traits below.
                    </div>
                  )}
                  {selectedRace.traits && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Traits:</strong> {selectedRace.traits.join(', ')}
                    </div>
                  )}
                  {/* Gnome Obsessive: player picks one Craft or Profession for +2 racial bonus */}
                  {char.race === 'Gnome' && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Obsessive (+2 racial):</strong>
                      <select
                        style={{ ...styles.select, marginTop: '4px', fontSize: '11px' }}
                        value={gnomeObsessiveSkill}
                        onChange={(e) => setGnomeObsessiveSkill(e.target.value)}
                      >
                        <option value="">Choose Craft or Profession...</option>
                        <optgroup label="Craft">
                          {['Alchemy', 'Armor', 'Baskets', 'Books', 'Bows', 'Calligraphy', 'Carpentry', 'Cloth', 'Clothing', 'Glass', 'Jewelry', 'Leather', 'Locks', 'Paintings', 'Pottery', 'Sculptures', 'Ships', 'Shoes', 'Stonemasonry', 'Traps', 'Weapons'].map(s => (
                            <option key={`craft-${s}`} value={`Craft (${s})`}>Craft ({s})</option>
                          ))}
                        </optgroup>
                        <optgroup label="Profession">
                          {['Architect', 'Baker', 'Barrister', 'Brewer', 'Butcher', 'Clerk', 'Cook', 'Courtesan', 'Driver', 'Engineer', 'Farmer', 'Fisherman', 'Gambler', 'Gardener', 'Herbalist', 'Innkeeper', 'Librarian', 'Merchant', 'Midwife', 'Miller', 'Miner', 'Porter', 'Sailor', 'Scribe', 'Shepherd', 'Soldier', 'Stable Master', 'Tanner', 'Trapper', 'Woodcutter'].map(s => (
                            <option key={`prof-${s}`} value={`Profession (${s})`}>Profession ({s})</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  )}
                  {selectedRace.languages && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Languages:</strong> {selectedRace.languages.join(', ')}
                      {selectedRace.bonusLanguages && (
                        <span style={{ color: '#8b949e', fontSize: '11px' }}>
                          {' '}(Bonus: {selectedRace.bonusLanguages.join(', ')})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Class</label>
              <select
                style={styles.select}
                value={char.class}
                onChange={(e) => setChar({ ...char, class: e.target.value, alignment: '' })}
              >
                <option value="">Select Class</option>
                {classes.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              {selectedClass && (
                <div style={styles.infoPanel}>
                  <div><strong>Hit Die:</strong> d{selectedClass.hd}</div>
                  <div><strong>Base Attack Bonus:</strong> {selectedClass.bab}</div>
                  <div><strong>Skills/Level:</strong> {selectedClass.skills}</div>
                  <div style={{ marginTop: '8px' }}>
                    <strong>Good Saves:</strong> {selectedClass.goodSaves?.join(', ') || 'None'}
                  </div>
                  {selectedClass.classSkills && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Class Skills:</strong> {selectedClass.classSkills.slice(0, 5).join(', ')}...
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Alignment</label>
              <select
                style={styles.select}
                value={char.alignment}
                onChange={(e) => setChar({ ...char, alignment: e.target.value })}
              >
                <option value="">Select Alignment</option>
                {['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral',
                  'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'].map(a => {
                  const isAllowed = validateAlignment(a);
                  return (
                    <option key={a} value={a} disabled={!isAllowed}>
                      {a} {!isAllowed ? '(restricted)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Vital Statistics — CRB Tables 7-1 / 7-2 / 7-3 (page 168-170) */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Vital Statistics
                <span style={{ fontSize: '10px', color: '#8b949e', fontWeight: 'normal', marginLeft: '8px' }}>
                  (CRB Tables 7-1 / 7-2 / 7-3)
                </span>
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {/* Age */}
                <div style={{ flex: '1 1 120px', minWidth: '110px' }}>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '3px' }}>Age (years)</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="number"
                      style={{ ...styles.input, marginBottom: 0, flex: 1, fontSize: '12px', padding: '6px 8px' }}
                      value={char.age}
                      onChange={(e) => setChar({ ...char, age: e.target.value })}
                      placeholder="—"
                    />
                    <button
                      style={{
                        padding: '6px 8px',
                        backgroundColor: '#3a3a6e',
                        border: '1px solid #ffd700',
                        borderRadius: '4px',
                        color: '#ffd700',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                      title="Roll random age (CRB Table 7-1)"
                      disabled={!char.race || !char.class}
                      onClick={() => setChar({ ...char, age: rollRandomAge(char.race, char.class) })}
                    >🎲</button>
                  </div>
                  {char.age && char.race && (
                    <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px' }}>
                      {getAgeBracket(char.race, parseInt(char.age))}
                    </div>
                  )}
                </div>
                {/* Height */}
                <div style={{ flex: '1 1 120px', minWidth: '110px' }}>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '3px' }}>Height (inches)</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="number"
                      style={{ ...styles.input, marginBottom: 0, flex: 1, fontSize: '12px', padding: '6px 8px' }}
                      value={char.heightInches}
                      onChange={(e) => setChar({ ...char, heightInches: e.target.value })}
                      placeholder="—"
                    />
                    <button
                      style={{
                        padding: '6px 8px',
                        backgroundColor: '#3a3a6e',
                        border: '1px solid #ffd700',
                        borderRadius: '4px',
                        color: '#ffd700',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                      title="Roll random height + weight (CRB Table 7-3)"
                      disabled={!char.race}
                      onClick={() => {
                        const hw = rollRandomHeightWeight(char.race, char.gender);
                        setChar({ ...char, heightInches: hw.heightInches, weightLbs: hw.weightLbs });
                      }}
                    >🎲</button>
                  </div>
                  {char.heightInches && (
                    <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '2px' }}>
                      {Math.floor(parseInt(char.heightInches) / 12)}'{parseInt(char.heightInches) % 12}"
                    </div>
                  )}
                </div>
                {/* Weight */}
                <div style={{ flex: '1 1 120px', minWidth: '110px' }}>
                  <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '3px' }}>Weight (lbs)</div>
                  <input
                    type="number"
                    style={{ ...styles.input, marginBottom: 0, fontSize: '12px', padding: '6px 8px' }}
                    value={char.weightLbs}
                    onChange={(e) => setChar({ ...char, weightLbs: e.target.value })}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>

            {/* Deity — race-suggested, all CRB deities selectable */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Deity
                <span style={{ fontSize: '10px', color: '#8b949e', fontWeight: 'normal', marginLeft: '8px' }}>
                  {char.class === 'Cleric' ? '(required for Cleric)' : '(optional)'}
                </span>
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <select
                  style={{ ...styles.select, flex: 1 }}
                  value={char.deity}
                  onChange={(e) => setChar({ ...char, deity: e.target.value })}
                >
                  <option value="">— No deity —</option>
                  {char.race && RACE_DEITIES[char.race] && (
                    <optgroup label={`Suggested for ${char.race}`}>
                      {RACE_DEITIES[char.race].common.map(d => (
                        <option key={`sug-${d}`} value={d}>{d}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="All deities">
                    {deitiesData.map(d => (
                      <option key={d.name} value={d.name}>{d.name} ({d.alignment})</option>
                    ))}
                  </optgroup>
                </select>
                <button
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#3a3a6e',
                    border: '1px solid #ffd700',
                    borderRadius: '6px',
                    color: '#ffd700',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                  }}
                  title="Pick a random race-suggested deity (filtered by your alignment)"
                  disabled={!char.race}
                  onClick={() => {
                    const d = pickRandomDeity(char.race, char.alignment, deitiesData);
                    if (d) setChar({ ...char, deity: d });
                  }}
                >🎲 Random</button>
              </div>
              {char.race && RACE_DEITIES[char.race] && (
                <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '4px', fontStyle: 'italic' }}>
                  {getDeityNote(char.race)}
                </div>
              )}
            </div>

            {/* Heritage / Subrace — only for races with true subraces (Aasimar, Tiefling, etc.) */}
            {char.race && heritagesData[char.race] && heritagesData[char.race].length > 1 && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Heritage / Subrace</label>
                <select
                  style={styles.select}
                  value={char.heritage}
                  onChange={(e) => {
                    setChar({ ...char, heritage: e.target.value });
                    setSelectedRacialBonus(null);
                    setRacialChoices([]);
                  }}
                >
                  <option value="">Select Heritage (optional)</option>
                  {heritagesData[char.race].map(h => (
                    <option key={h.name} value={h.name}>{h.name}</option>
                  ))}
                </select>
                {char.heritage && (() => {
                  const h = heritagesData[char.race]?.find(x => x.name === char.heritage);
                  if (!h) return null;
                  const hb = getHeritageBonuses(char.race, char.heritage);
                  const fixedStr = Object.entries(hb.fixed).map(([k,v]) => `${k} +${v}`).join(', ');
                  const penaltyStr = Object.entries(hb.penalties).filter(([,v]) => v !== 0).map(([k,v]) => `${k} ${v}`).join(', ');
                  return (
                    <div style={styles.infoPanel}>
                      <div style={{ color: '#d4c5a9', marginBottom: '4px' }}>{h.description}</div>
                      {fixedStr && <div><strong>Fixed Bonuses:</strong> {fixedStr}</div>}
                      {penaltyStr && <div><strong>Penalties:</strong> {penaltyStr}</div>}
                      {h.replaceTraits?.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <strong style={{ color: '#ff6040' }}>Replaces:</strong>{' '}
                          <span style={{ color: '#8b949e' }}>{h.replaceTraits.join(', ')}</span>
                        </div>
                      )}
                      {h.addTraits?.length > 0 && (
                        <div>
                          <strong style={{ color: '#51cf66' }}>Gains:</strong>{' '}
                          <span style={{ color: '#d4c5a9' }}>{h.addTraits.join(', ')}</span>
                        </div>
                      )}
                      {h.spellLike && <div><strong>Spell-Like:</strong> {h.spellLike}</div>}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Alternate Racial Traits — multi-select with conflict detection */}
            {char.race && alternateRacialTraitsData[char.race] && alternateRacialTraitsData[char.race].length > 0 && (
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Alternate Racial Traits
                  <span style={{ fontSize: '10px', color: '#8b949e', fontWeight: 'normal', marginLeft: '8px' }}>
                    (swap default traits for alternatives)
                  </span>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {alternateRacialTraitsData[char.race].map(trait => {
                    const isSelected = (char.alternateRacialTraits || []).includes(trait.name);
                    // Check for conflicts: is any trait this one replaces already consumed by another selected trait?
                    const selectedOthers = (char.alternateRacialTraits || []).filter(t => t !== trait.name);
                    const otherTraits = selectedOthers.map(name => alternateRacialTraitsData[char.race].find(t => t.name === name)).filter(Boolean);
                    const usedSlots = otherTraits.flatMap(t => t.replaces || []);
                    const mySlots = trait.replaces || [];
                    const conflictSlot = mySlots.find(slot => usedSlots.some(used => used === slot || used.startsWith(slot) || slot.startsWith(used)));
                    const isConflicted = !isSelected && !!conflictSlot;
                    const conflictingTrait = isConflicted ? otherTraits.find(t => (t.replaces || []).some(r => r === conflictSlot || r.startsWith(conflictSlot) || conflictSlot.startsWith(r)))?.name : null;

                    return (
                      <div
                        key={trait.name}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: isSelected ? '#1a3a2e' : isConflicted ? '#2a1a1a' : '#1a1a2e',
                          border: `1px solid ${isSelected ? '#2ea043' : isConflicted ? '#4a2a2a' : '#333'}`,
                          borderRadius: '6px',
                          opacity: isConflicted ? 0.5 : 1,
                          cursor: isConflicted ? 'not-allowed' : 'pointer',
                        }}
                        onClick={() => {
                          if (isConflicted) return;
                          const current = char.alternateRacialTraits || [];
                          if (isSelected) {
                            setChar({ ...char, alternateRacialTraits: current.filter(t => t !== trait.name) });
                            // If this trait had ability choices (like Dual Talent), reset them
                            if (trait.bonuses?.choice2 || trait.bonuses?.choice) {
                              setRacialChoices([]);
                            }
                          } else {
                            setChar({ ...char, alternateRacialTraits: [...current, trait.name] });
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '16px', height: '16px', borderRadius: '3px',
                            border: `2px solid ${isSelected ? '#2ea043' : '#555'}`,
                            backgroundColor: isSelected ? '#2ea043' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px', color: '#fff', flexShrink: 0,
                          }}>
                            {isSelected ? '✓' : ''}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px', color: isSelected ? '#51cf66' : '#e0d6c8' }}>
                              {trait.name}
                              {trait.source && <span style={{ fontSize: '9px', color: '#6b7b8e', marginLeft: '6px' }}>[{trait.source}]</span>}
                            </div>
                            <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '2px' }}>{trait.description}</div>
                            <div style={{ fontSize: '10px', marginTop: '3px' }}>
                              <span style={{ color: '#ff6040' }}>Replaces: </span>
                              <span style={{ color: '#8b949e' }}>{(trait.replaces || []).join(', ')}</span>
                              {trait.grants && (
                                <span style={{ marginLeft: '8px' }}>
                                  <span style={{ color: '#51cf66' }}>Grants: </span>
                                  <span style={{ color: '#d4c5a9' }}>{trait.grants}</span>
                                </span>
                              )}
                            </div>
                            {isConflicted && (
                              <div style={{ fontSize: '10px', color: '#ff6040', marginTop: '2px' }}>
                                Conflicts with {conflictingTrait} (both replace {conflictSlot})
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Ability score choices for traits like Dual Talent */}
                        {isSelected && trait.bonuses?.choice2 && (
                          <div style={{ marginTop: '8px', padding: '8px', background: '#0d1117', borderRadius: '4px' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ fontWeight: 600, color: '#ffd700', marginBottom: '6px', fontSize: '11px' }}>
                              Choose {trait.bonuses.choice2 === 2 ? '2' : trait.bonuses.choice2} ability scores (+{trait.bonuses.choice2} each):
                            </div>
                            {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(abil => {
                              const isChosen = racialChoices.includes(abil);
                              const choicesFull = racialChoices.length >= 2;
                              return (
                                <label key={abil} style={{ display: 'inline-block', marginRight: '12px', fontSize: '12px', opacity: (!isChosen && choicesFull) ? 0.4 : 1 }}>
                                  <input
                                    type="checkbox"
                                    checked={isChosen}
                                    disabled={!isChosen && choicesFull}
                                    onChange={() => {
                                      setRacialChoices(prev => {
                                        if (prev.includes(abil)) return prev.filter(a => a !== abil);
                                        if (prev.length < 2) return [...prev, abil];
                                        return prev;
                                      });
                                    }}
                                  />
                                  {' '}{abil}
                                </label>
                              );
                            })}
                            <div style={{ fontSize: '10px', color: '#6b7b8e', marginTop: '4px' }}>
                              {racialChoices.length}/2 selected
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ethnicity / Origin */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                {char.race === 'Human' ? 'Ethnicity' : 'Origin'}
              </label>
              {char.race === 'Human' ? (
                <>
                  <select
                    style={styles.select}
                    value={char.ethnicity}
                    onChange={(e) => {
                      const eth = ethnicitiesData.humanEthnicities.find(x => x.name === e.target.value);
                      setChar({
                        ...char,
                        ethnicity: e.target.value,
                        origin: eth?.homeland || char.origin,
                        languages: eth?.languages || ['Common'],
                      });
                    }}
                  >
                    <option value="">Select Ethnicity (optional)</option>
                    {ethnicitiesData.humanEthnicities.map(eth => (
                      <option key={eth.name} value={eth.name}>{eth.name}</option>
                    ))}
                  </select>
                  {char.ethnicity && (() => {
                    const eth = ethnicitiesData.humanEthnicities.find(x => x.name === char.ethnicity);
                    return eth ? (
                      <div style={styles.infoPanel}>
                        <div style={{ color: '#d4c5a9', marginBottom: '4px' }}>{eth.description}</div>
                        <div><strong>Homeland:</strong> {eth.homeland} ({eth.region})</div>
                        <div><strong>Languages:</strong> {eth.languages.join(', ')}</div>
                        <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px', fontStyle: 'italic' }}>{eth.culturalNotes}</div>
                      </div>
                    ) : null;
                  })()}
                </>
              ) : char.race && ethnicitiesData.nonHumanOrigins[char.race] ? (
                <>
                  <select
                    style={styles.select}
                    value={char.origin}
                    onChange={(e) => {
                      const orig = ethnicitiesData.nonHumanOrigins[char.race]?.find(x => x.name === e.target.value);
                      setChar({
                        ...char,
                        ethnicity: char.race,
                        origin: e.target.value,
                        languages: orig?.languages || ['Common'],
                      });
                    }}
                  >
                    <option value="">Select Origin (optional)</option>
                    {ethnicitiesData.nonHumanOrigins[char.race].map(orig => (
                      <option key={orig.name} value={orig.name}>{orig.name} — {orig.region}</option>
                    ))}
                  </select>
                  {char.origin && (() => {
                    const orig = ethnicitiesData.nonHumanOrigins[char.race]?.find(x => x.name === char.origin);
                    return orig ? (
                      <div style={styles.infoPanel}>
                        <div style={{ color: '#d4c5a9', marginBottom: '4px' }}>{orig.description}</div>
                        <div><strong>Region:</strong> {orig.region}</div>
                        <div><strong>Languages:</strong> {orig.languages.join(', ')}</div>
                      </div>
                    ) : null;
                  })()}
                </>
              ) : (
                <input
                  style={styles.input}
                  value={char.origin}
                  onChange={(e) => setChar({ ...char, origin: e.target.value, ethnicity: char.race || '' })}
                  placeholder="Where are they from? (optional)"
                />
              )}
            </div>

            {/* Homeland override */}
            {(char.ethnicity || char.race) && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Homeland</label>
                <select
                  style={styles.select}
                  value={originIsCustom ? '__custom__' : char.origin}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setOriginIsCustom(true);
                      setChar({ ...char, origin: '' });
                    } else {
                      setOriginIsCustom(false);
                      setChar({ ...char, origin: e.target.value });
                    }
                  }}
                >
                  <option value="">— Default from ethnicity/origin —</option>
                  {ethnicitiesData.homelands.map(h => (
                    <option key={h.name} value={h.name}>{h.name} — {h.description}</option>
                  ))}
                  <option value="__custom__">Other (custom)...</option>
                </select>
                {originIsCustom && (
                  <input
                    style={{ ...styles.input, marginTop: '6px' }}
                    value={char.origin}
                    onChange={(e) => setChar({ ...char, origin: e.target.value })}
                    placeholder="Enter custom homeland..."
                    autoFocus
                  />
                )}
                <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '4px' }}>
                  Select a Golarion homeland from the list, or choose "Other" for a custom origin.
                </div>
              </div>
            )}
          </>
        )}

        {/* CLASS FEATURES (auto-generated from registry) */}
        {currentStepName === 'Class Features' && (
          <ClassFeatureStep char={char} setChar={setChar} styles={styles} />
        )}

        {/* ABILITIES */}
        {currentStepName === 'Abilities' && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
              <label style={{ fontSize: '11px', color: '#8b949e', whiteSpace: 'nowrap' }}>Method:</label>
              <select
                style={{ ...styles.select, marginBottom: 0, flex: 1 }}
                value={abilityMethod}
                onChange={(e) => {
                  setAbilityMethod(e.target.value);
                  const m = e.target.value;
                  if (m.startsWith('point-buy')) {
                    setPointBuyMode(true);
                    setPointBuyPoints(parseInt(m.split('-').pop()) || 20);
                    setPointBuyAbilities({ STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 });
                  } else if (m === 'standard-array') {
                    setPointBuyMode(true);
                    setPointBuyAbilities({ STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 });
                  } else {
                    setPointBuyMode(false);
                  }
                  // Reset dice pool state when switching away
                  if (m !== 'dice-pool') {
                    setDicePool([]);
                    setDicePoolAssignments({ STR: [], DEX: [], CON: [], INT: [], WIS: [], CHA: [] });
                    setSelectedPoolAbility('STR');
                  }
                }}
              >
                <option value="point-buy-10">Point Buy — 10 pts (Low Fantasy)</option>
                <option value="point-buy-15">Point Buy — 15 pts (Standard Fantasy)</option>
                <option value="point-buy-20">Point Buy — 20 pts (High Fantasy)</option>
                <option value="point-buy-25">Point Buy — 25 pts (Epic Fantasy)</option>
                <option value="standard-array">Standard Array (15, 14, 13, 12, 10, 8)</option>
                <option value="4d6-drop-lowest">Roll 4d6 Drop Lowest</option>
                <option value="classic-3d6">Classic 3d6 (In Order)</option>
                <option value="heroic">Heroic 2d6+6</option>
                <option value="dice-pool">Dice Pool (24d6)</option>
              </select>
            </div>

            {/* ── DICE POOL (24d6) ── */}
            {abilityMethod === 'dice-pool' ? (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <button style={styles.button} onClick={() => {
                    const pool = rollDicePool();
                    setDicePool(pool);
                    setDicePoolAssignments({ STR: [], DEX: [], CON: [], INT: [], WIS: [], CHA: [] });
                    setSelectedPoolAbility('STR');
                    setChar(prev => ({ ...prev, abilities: { STR: 3, DEX: 3, CON: 3, INT: 3, WIS: 3, CHA: 3 } }));
                  }}>
                    Roll 24d6
                  </button>
                  {dicePool.length > 0 && (
                    <button
                      style={{ ...styles.button, backgroundColor: '#4a2a2a', borderColor: '#ff6040' }}
                      onClick={() => {
                        setDicePoolAssignments({ STR: [], DEX: [], CON: [], INT: [], WIS: [], CHA: [] });
                        setSelectedPoolAbility('STR');
                        setChar(prev => ({ ...prev, abilities: { STR: 3, DEX: 3, CON: 3, INT: 3, WIS: 3, CHA: 3 } }));
                      }}
                    >
                      Reset Assignments
                    </button>
                  )}
                </div>
                {dicePool.length > 0 && (() => {
                  const totalAssigned = Object.values(dicePoolAssignments).reduce((s, arr) => s + arr.length, 0);
                  // Build a set of assigned indices for quick lookup
                  const assignedIdxSet = new Set();
                  Object.values(dicePoolAssignments).forEach(arr => arr.forEach(i => assignedIdxSet.add(i)));

                  return (
                    <div style={styles.infoPanel}>
                      <div style={{ marginBottom: '10px', fontSize: '11px' }}>
                        <strong style={{ color: '#ffd700' }}>Dice Pool:</strong> Assign dice to abilities (min 3 per ability, must use all 24).
                        Select an ability tab, then click dice to assign. Each ability's score = sum of its assigned dice.
                      </div>
                      <div style={{ marginBottom: '8px', fontSize: '10px', color: '#8b949e' }}>
                        Assigned: {totalAssigned}/24 dice
                      </div>

                      {/* Ability tabs */}
                      <div style={{ display: 'flex', gap: '4px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ab => {
                          const count = dicePoolAssignments[ab].length;
                          const sum = dicePoolAssignments[ab].reduce((s, i) => s + dicePool[i], 0);
                          const isActive = selectedPoolAbility === ab;
                          return (
                            <button
                              key={ab}
                              onClick={() => setSelectedPoolAbility(ab)}
                              style={{
                                padding: '6px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                                cursor: 'pointer', border: isActive ? '2px solid #ffd700' : '1px solid #3a3a6e',
                                backgroundColor: isActive ? '#2a2a5e' : count >= 3 ? '#1a2e1a' : '#1a1a2e',
                                color: isActive ? '#ffd700' : count >= 3 ? '#2ea043' : '#d4c5a9',
                              }}
                            >
                              {ab}: {sum} ({count}d)
                            </button>
                          );
                        })}
                      </div>

                      {/* Unassigned dice */}
                      <div style={{ marginBottom: '6px', fontSize: '10px', color: '#ffd700' }}>
                        Unassigned dice — click to add to {selectedPoolAbility}:
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        {dicePool.map((val, i) => {
                          if (assignedIdxSet.has(i)) return null;
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                const ab = selectedPoolAbility;
                                setDicePoolAssignments(prev => {
                                  const next = { ...prev, [ab]: [...prev[ab], i] };
                                  // Update char abilities with new sum
                                  const newAbilities = {};
                                  ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(a => {
                                    newAbilities[a] = next[a].reduce((s, idx) => s + dicePool[idx], 0) || 3;
                                  });
                                  setChar(prev2 => ({ ...prev2, abilities: newAbilities }));
                                  return next;
                                });
                              }}
                              style={{
                                width: '32px', height: '32px', borderRadius: '4px', fontWeight: 'bold',
                                fontSize: '14px', cursor: 'pointer',
                                backgroundColor: '#3a3a6e', border: '1px solid #ffd700', color: '#ffd700',
                              }}
                            >
                              {val}
                            </button>
                          );
                        })}
                      </div>

                      {/* Dice assigned to current ability — click to unassign */}
                      {dicePoolAssignments[selectedPoolAbility].length > 0 && (
                        <>
                          <div style={{ fontSize: '10px', color: '#8b949e', marginBottom: '4px' }}>
                            {selectedPoolAbility} dice (click to remove):
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {dicePoolAssignments[selectedPoolAbility].map((poolIdx, j) => (
                              <button
                                key={j}
                                onClick={() => {
                                  const ab = selectedPoolAbility;
                                  setDicePoolAssignments(prev => {
                                    const next = { ...prev, [ab]: prev[ab].filter((_, k) => k !== j) };
                                    const newAbilities = {};
                                    ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(a => {
                                      newAbilities[a] = next[a].reduce((s, idx) => s + dicePool[idx], 0) || 3;
                                    });
                                    setChar(prev2 => ({ ...prev2, abilities: newAbilities }));
                                    return next;
                                  });
                                }}
                                style={{
                                  width: '32px', height: '32px', borderRadius: '4px', fontWeight: 'bold',
                                  fontSize: '14px', cursor: 'pointer',
                                  backgroundColor: '#2ea043', border: '1px solid #7fff00', color: '#fff',
                                }}
                              >
                                {dicePool[poolIdx]}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {/* Validation warning */}
                      {totalAssigned === 24 && ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].some(a => dicePoolAssignments[a].length < 3) && (
                        <div style={{ marginTop: '8px', fontSize: '10px', color: '#f85149' }}>
                          Each ability must have at least 3 dice assigned.
                        </div>
                      )}
                      {totalAssigned === 24 && ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].every(a => dicePoolAssignments[a].length >= 3) && (
                        <div style={{ marginTop: '8px', fontSize: '10px', color: '#2ea043' }}>
                          All 24 dice assigned! Ability scores are set.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </>

            ) : abilityMethod === 'standard-array' ? (
              <>
                <div style={{ ...styles.infoPanel, backgroundColor: '#2a3a4e', marginBottom: '12px' }}>
                  <span style={{ color: '#ffd700' }}>Standard Array: Use the dropdowns to assign each value to an ability.</span>
                </div>
                <div style={styles.gridRow}>
                  {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => {
                    const currentVal = pointBuyAbilities[ability];
                    // Show all standard array values — selecting one swaps with whatever ability currently has it
                    const availableValues = [...new Set(STANDARD_ARRAY)];
                    return (
                      <div key={ability} style={styles.formGroup}>
                        <label style={styles.label}>{ability}</label>
                        <select
                          style={{ ...styles.select, textAlign: 'center', fontWeight: 'bold', fontSize: '14px' }}
                          value={currentVal}
                          onChange={(e) => {
                            const newVal = parseInt(e.target.value);
                            // Swap: find which other ability has the value we want, and give it our current value
                            const otherAbility = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].find(
                              a => a !== ability && pointBuyAbilities[a] === newVal
                            );
                            if (otherAbility) {
                              setPointBuyAbilities(prev => ({
                                ...prev,
                                [ability]: newVal,
                                [otherAbility]: currentVal,
                              }));
                            } else {
                              setPointBuyAbilities(prev => ({ ...prev, [ability]: newVal }));
                            }
                          }}
                        >
                          {availableValues.sort((a, b) => b - a).map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                        {getRacialBonus(ability) !== 0 && (
                          <div style={{ fontSize: '10px', color: getRacialBonus(ability) > 0 ? '#2ea043' : '#f85149', textAlign: 'center' }}>
                            Racial: {getRacialBonus(ability) > 0 ? '+' : ''}{getRacialBonus(ability)} → Total: {getAbilityScore(ability)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>

            ) : pointBuyMode ? (
              <>
                <div style={{ ...styles.infoPanel, backgroundColor: '#2a3a4e' }}>
                  <span style={{ color: getPointBuySpent() >= pointBuyPoints ? '#2ea043' : '#e0d6c8' }}>
                    Points Spent: {getPointBuySpent()} / {pointBuyPoints}
                    {getPointBuySpent() >= pointBuyPoints && ' (Max)'}
                  </span>
                  <div style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#1a1a2e',
                    borderRadius: '4px',
                    marginTop: '6px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(0, Math.min(100, (getPointBuySpent() / pointBuyPoints) * 100))}%`,
                      backgroundColor: getPointBuySpent() >= pointBuyPoints ? '#2ea043' : '#ffd700',
                      transition: 'width 0.2s',
                    }} />
                  </div>
                </div>
                <div style={styles.gridRow}>
                  {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
                    <div key={ability} style={styles.formGroup}>
                      <label style={styles.label}>{ability}</label>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <button
                          style={styles.buttonSmall}
                          onClick={() => handlePointBuyChange(ability, -1)}
                        >
                          −
                        </button>
                        <div style={{
                          flex: 1,
                          textAlign: 'center',
                          padding: '6px',
                          backgroundColor: '#2a2a4e',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          color: '#ffd700',
                        }}>
                          {pointBuyAbilities[ability]}
                        </div>
                        <button
                          style={styles.buttonSmall}
                          onClick={() => handlePointBuyChange(ability, 1)}
                        >
                          +
                        </button>
                      </div>
                      {getRacialBonus(ability) !== 0 && (
                        <div style={{ fontSize: '10px', color: getRacialBonus(ability) > 0 ? '#2ea043' : '#f85149', textAlign: 'center' }}>
                          Racial: {getRacialBonus(ability) > 0 ? '+' : ''}{getRacialBonus(ability)} → Total: {getAbilityScore(ability)}
                        </div>
                      )}
                      <div style={{ fontSize: '9px', color: '#6b7b8e', textAlign: 'center' }}>
                        Cost: {POINT_BUY_COST[pointBuyAbilities[ability]] || 0} pts
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <button style={styles.button} onClick={rollAllAbilities}>
                    {abilityMethod === 'classic-3d6' ? 'Roll 3d6 In Order' : abilityMethod === 'heroic' ? 'Roll 2d6+6 (Heroic)' : 'Roll 4d6 Drop Lowest'}
                  </button>
                  {assignedAbilities.size > 0 && abilityMethod !== 'classic-3d6' && (
                    <button
                      style={{ ...styles.button, backgroundColor: '#4a2a2a', borderColor: '#ff6040' }}
                      onClick={resetRollAssignments}
                    >
                      Reset All Picks
                    </button>
                  )}
                </div>
                {/* Classic 3d6: locked display — scores assigned in order, no rearranging */}
                {abilityMethod === 'classic-3d6' && Object.keys(rollAbilities).some(a => rollAbilities[a] !== null) && (
                  <div style={styles.infoPanel}>
                    <div style={{ marginBottom: '12px', fontSize: '11px' }}>
                      <strong style={{ color: '#ffd700' }}>Classic 3d6:</strong> Scores are rolled and assigned in order (STR → CHA). No rearranging allowed.
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
                        <div
                          key={ability}
                          style={{
                            ...styles.abilityBox,
                            marginBottom: '8px',
                            border: '2px solid #2ea043',
                            backgroundColor: '#1a2e1a',
                            cursor: 'default',
                          }}
                        >
                          <div style={{ color: '#2ea043', fontSize: '14px', fontWeight: 'bold' }}>
                            {ability}
                          </div>
                          <div style={{ color: '#2ea043', fontSize: '18px', fontWeight: 'bold', marginTop: '4px' }}>
                            {char.abilities[ability]}
                          </div>
                          {getRacialBonus(ability) !== 0 && (
                            <div style={{ fontSize: '9px', color: getRacialBonus(ability) > 0 ? '#2ea043' : '#f85149', marginTop: '2px' }}>
                              Racial: {getRacialBonus(ability) > 0 ? '+' : ''}{getRacialBonus(ability)} → {getAbilityScore(ability)}
                            </div>
                          )}
                          <div style={{ fontSize: '9px', color: '#6b7b8e', marginTop: '2px' }}>
                            Mod: {mod(getAbilityScore(ability)) >= 0 ? '+' : ''}{mod(getAbilityScore(ability))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 4d6 / Heroic: interactive assignment UI */}
                {abilityMethod !== 'classic-3d6' && Object.keys(rollAbilities).some(a => rollAbilities[a] !== null) && (
                  <div style={styles.infoPanel}>
                    <div style={{ marginBottom: '12px' }}>
                      1. Click an ability to select it, then 2. Click a roll to assign.
                      <span style={{ color: '#8b949e', display: 'block', fontSize: '10px', marginTop: '4px' }}>
                        Click an assigned (green) ability to undo it.
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => {
                        const isAssigned = assignedAbilities.has(ability);
                        const isSelected = selectedAbilityForRoll === ability;
                        return (
                          <div
                            key={ability}
                            onClick={() => {
                              if (isAssigned) {
                                unassignAbility(ability);
                              } else {
                                setSelectedAbilityForRoll(ability);
                              }
                            }}
                            style={{
                              ...styles.abilityBox,
                              marginBottom: '8px',
                              cursor: 'pointer',
                              border: isSelected ? '2px solid #ffd700' : isAssigned ? '2px solid #2ea043' : '2px solid #3a3a6e',
                              backgroundColor: isSelected ? '#2a2a5e' : isAssigned ? '#1a2e1a' : undefined,
                            }}
                          >
                            <div style={{ color: isSelected ? '#ffd700' : isAssigned ? '#2ea043' : '#8b949e', fontSize: '14px', fontWeight: 'bold' }}>
                              {ability}
                            </div>
                            <div style={{ color: isAssigned ? '#2ea043' : '#d4c5a9', fontSize: '18px', fontWeight: 'bold', marginTop: '4px' }}>
                              {isAssigned ? char.abilities[ability] : '—'}
                            </div>
                            {isAssigned && (
                              <div style={{ fontSize: '9px', color: '#6b7b8e', marginTop: '2px' }}>click to undo</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {Object.values(rollAbilities).some(v => v !== null) && (
                      <>
                        <div style={{ marginTop: '16px', marginBottom: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                          Available Rolls{selectedAbilityForRoll ? ` (assigning to ${selectedAbilityForRoll})` : ' — select an ability first'}:
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                          {Object.values(rollAbilities).filter(v => v !== null).sort((a, b) => b - a).map((roll, idx) => {
                            if (usedRollIndices.has(idx)) return null;
                            const canAssign = selectedAbilityForRoll && !assignedAbilities.has(selectedAbilityForRoll);
                            return (
                              <button
                                key={idx}
                                disabled={!canAssign}
                                style={{
                                  padding: '8px',
                                  backgroundColor: canAssign ? '#3a3a6e' : '#1a1a2e',
                                  border: canAssign ? '1px solid #ffd700' : '1px solid #3a3a6e',
                                  borderRadius: '4px',
                                  color: canAssign ? '#ffd700' : '#555',
                                  fontWeight: 'bold',
                                  cursor: canAssign ? 'pointer' : 'not-allowed',
                                  opacity: canAssign ? 1 : 0.5,
                                }}
                                onClick={() => {
                                  if (canAssign) {
                                    assignRolledAbility(selectedAbilityForRoll, idx);
                                  }
                                }}
                              >
                                {roll}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* STEP 2: SKILLS */}
        {currentStepName === 'Skills' && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Skill Points: {getUsedSkillPoints()} / {getSkillPointsAvailable()}
              </label>
              <input
                style={styles.input}
                type="text"
                placeholder="Search skills..."
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
              />
            </div>

            <div style={styles.listContainer}>
              {getFilteredSkills().map((skill, idx) => {
                const isClassSkill = selectedClass?.classSkills?.includes(skill.name)
                  || (selectedClass?.classSkills?.includes('Knowledge (all)') && skill.name.startsWith('Knowledge ('))
                  || (selectedClass?.classSkills?.includes('Craft (all)') && skill.name.startsWith('Craft ('))
                  || (selectedClass?.classSkills?.includes('Perform (all)') && skill.name.startsWith('Perform ('))
                  || (selectedClass?.classSkills?.includes('Profession (all)') && skill.name.startsWith('Profession ('));
                const ranks = char.skillRanks[skill.name] || 0;
                // Use getAbilityScore so racial bonuses count toward skill modifiers
                const abilityMod = mod(getAbilityScore(skill.ability) || 10);
                const classBonus = (ranks > 0 && isClassSkill) ? 3 : 0;
                const total = abilityMod + ranks + classBonus;

                return (
                  <div
                    key={idx}
                    style={{
                      ...styles.listItem,
                      backgroundColor: isClassSkill ? '#2a3a4e' : '#1a1a2e',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', color: isClassSkill ? '#ffd700' : '#d4c5a9' }}>
                        {skill.name}
                      </div>
                      <div style={{ fontSize: '10px', color: '#8b949e' }}>
                        {skill.ability} {isClassSkill ? '[Class Skill]' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#d4c5a9', minWidth: '35px', textAlign: 'center' }}>
                        {total > 0 ? '+' : ''}{total}
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={char.level}
                        value={ranks}
                        onChange={(e) => handleSkillRankChange(skill.name, parseInt(e.target.value) || 0)}
                        style={styles.skillRanksInput}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* STEP 3: FEATS */}
        {currentStepName === 'Feats' && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Feats: {char.selectedFeats.length} / {getMaxFeats()}
                {char.race === 'Half-Elf' && <span style={{ fontSize: '10px', color: '#7eb8da', marginLeft: '8px' }}>(includes Adaptability — pick Skill Focus)</span>}
                {char.race === 'Human' && <span style={{ fontSize: '10px', color: '#7eb8da', marginLeft: '8px' }}>(includes Human Bonus Feat)</span>}
              </label>
              <input
                style={styles.input}
                type="text"
                placeholder="Search feats..."
                value={featFilter}
                onChange={(e) => setFeatFilter(e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '11px', color: '#8b949e', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showIneligibleFeats}
                  onChange={(e) => setShowIneligibleFeats(e.target.checked)}
                />
                Show feats you don't qualify for
              </label>
            </div>

            <div style={styles.listContainer}>
              {getFilteredFeats().map((feat, idx) => {
                const isSelected = char.selectedFeats.includes(feat.name);
                const slotsAvailable = char.selectedFeats.length < getMaxFeats();
                const canSelect = !isSelected && slotsAvailable && feat.eligible;

                return (
                  <label
                    key={idx}
                    style={{
                      ...styles.listItem,
                      cursor: canSelect || isSelected ? 'pointer' : 'not-allowed',
                      opacity: (!feat.eligible && !isSelected) ? 0.35 : (!slotsAvailable && !isSelected) ? 0.5 : 1,
                      backgroundColor: isSelected ? '#3a5a4e' : !feat.eligible ? '#2a1a1e' : '#1a1a2e',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked && canSelect) {
                            setChar({
                              ...char,
                              selectedFeats: [...char.selectedFeats, feat.name],
                            });
                          } else if (!e.target.checked) {
                            setChar({
                              ...char,
                              selectedFeats: char.selectedFeats.filter(f => f !== feat.name),
                            });
                          }
                        }}
                        disabled={!canSelect && !isSelected}
                        style={{ marginRight: '8px' }}
                      />
                      <span style={{ fontWeight: isSelected ? 'bold' : 'normal', color: feat.eligible ? '#d4c5a9' : '#886666' }}>
                        {feat.name}
                      </span>
                      {feat.category && (
                        <span style={{ marginLeft: '8px', ...styles.iconBadge }}>
                          {feat.category}
                        </span>
                      )}
                      {!feat.eligible && feat.missing?.length > 0 && (
                        <div style={{ fontSize: '9px', color: '#cc6644', marginTop: '2px', paddingLeft: '24px' }}>
                          Missing: {feat.missing.join(', ')}
                        </div>
                      )}
                      {feat.prerequisites && feat.prerequisites !== 'None' && feat.eligible && (
                        <div style={{ fontSize: '9px', color: '#51cf66', marginTop: '2px', paddingLeft: '24px' }}>
                          Prerequisites met
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {/* STEP 4: SPELLS */}
        {currentStepName === 'Spells' && (
          <>
            {isSpellcaster() ? (
              <>
                <div style={styles.infoPanel}>
                  <strong>{char.class}</strong> is a spellcaster (uses {SPELLCASTING_CLASSES[char.class]} for spell DCs)
                  <br />
                  Type: {SPELLCASTER_TYPES[char.class] === 'prepared' ? 'Prepared' : 'Spontaneous'} caster
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Search Spells</label>
                  <input
                    style={styles.input}
                    type="text"
                    placeholder="Search spell name..."
                    value={spellFilter}
                    onChange={(e) => setSpellFilter(e.target.value)}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Filter by Level</label>
                  <select
                    style={styles.select}
                    value={spellLevelFilter}
                    onChange={(e) => setSpellLevelFilter(e.target.value)}
                  >
                    <option value="all">All Levels</option>
                    {getSpellLevelsAvailable().map(level => (
                      <option key={level} value={level}>Level {level}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.listContainer}>
                  {getFilteredSpells().slice(0, 30).map((spell, idx) => {
                    const spellLevel = spell.level?.[char.class] ?? spell.level?.wizard ?? null;
                    if (spellLevel === null) return null;
                    if (!getSpellLevelsAvailable().includes(spellLevel)) return null;

                    const isSelected = char.spellsKnown.includes(spell.name);

                    return (
                      <label
                        key={idx}
                        style={{
                          ...styles.listItem,
                          backgroundColor: isSelected ? '#3a5a4e' : '#1a1a2e',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setChar({
                                  ...char,
                                  spellsKnown: [...char.spellsKnown, spell.name],
                                });
                              } else {
                                setChar({
                                  ...char,
                                  spellsKnown: char.spellsKnown.filter(s => s !== spell.name),
                                });
                              }
                            }}
                            style={{ marginRight: '8px' }}
                          />
                          <span style={{ fontWeight: isSelected ? 'bold' : 'normal', color: '#d4c5a9' }}>
                            {spell.name}
                          </span>
                        </div>
                        <span style={styles.iconBadge}>L{spellLevel}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              <div style={styles.infoPanel}>
                {char.class ? `${char.class} is not a spellcasting class.` : 'Select a class first.'}
              </div>
            )}
          </>
        )}

        {/* STEP 5: EQUIPMENT */}
        {currentStepName === 'Equipment' && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>Armor</label>
              <select
                style={styles.select}
                value={char.armor}
                onChange={(e) => setChar({ ...char, armor: e.target.value })}
              >
                {equipmentData.armor.map(a => (
                  <option key={a.name} value={a.name}>
                    {a.name} (AC +{a.ac}, Dex {a.maxDex > 90 ? '∞' : a.maxDex})
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Shield</label>
              <select
                style={styles.select}
                value={char.shield}
                onChange={(e) => setChar({ ...char, shield: e.target.value })}
              >
                {equipmentData.shields.map(s => (
                  <option key={s.name} value={s.name}>
                    {s.name} (AC +{s.ac})
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Weapons</label>
              <div style={styles.listContainer}>
                {weapons.slice(0, 15).map(weapon => {
                  const isSelected = char.weapons.some(w => w.name === weapon.name);
                  return (
                    <label
                      key={weapon.name}
                      style={{
                        ...styles.listItem,
                        cursor: 'pointer',
                        backgroundColor: isSelected ? '#3a5a4e' : '#1a1a2e',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setChar({
                              ...char,
                              weapons: [...char.weapons, weapon],
                            });
                          } else {
                            setChar({
                              ...char,
                              weapons: char.weapons.filter(w => w.name !== weapon.name),
                            });
                          }
                        }}
                        style={{ marginRight: '8px' }}
                      />
                      <span style={{ color: '#d4c5a9' }}>{weapon.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Adventuring Gear */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Adventuring Gear</label>
              <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '6px' }}>
                Search and add gear to your inventory. Track cost against your starting gold.
              </div>
              <input
                style={{ ...styles.input, marginBottom: '6px' }}
                placeholder="Search gear... (rope, torch, bedroll, etc.)"
                value={gearSearch}
                onChange={(e) => setGearSearch(e.target.value)}
              />

              {/* Selected inventory */}
              {char.inventory.length > 0 && (
                <div style={{ marginBottom: '8px', padding: '8px', backgroundColor: '#2a3a4e', borderRadius: '4px', border: '1px solid #ffd700' }}>
                  <div style={{ fontSize: '11px', color: '#ffd700', fontWeight: 'bold', marginBottom: '4px' }}>
                    Inventory ({char.inventory.length} items):
                  </div>
                  {char.inventory.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px', fontSize: '11px' }}>
                      <span style={{ color: '#d4c5a9' }}>
                        {item.quantity > 1 ? `${item.name} (${item.quantity})` : item.name}
                        {item.price ? ` — ${item.price}` : ''}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          style={{ ...styles.buttonSmall, padding: '1px 6px', fontSize: '10px', color: '#40e0d0', borderColor: '#40e0d0' }}
                          onClick={() => {
                            const updated = [...char.inventory];
                            updated[i] = { ...updated[i], quantity: (updated[i].quantity || 1) + 1 };
                            setChar({ ...char, inventory: updated });
                          }}
                        >+</button>
                        <button
                          style={{ ...styles.buttonSmall, padding: '1px 6px', fontSize: '10px', color: '#ff4444', borderColor: '#ff4444' }}
                          onClick={() => {
                            const item = char.inventory[i];
                            if ((item.quantity || 1) > 1) {
                              const updated = [...char.inventory];
                              updated[i] = { ...updated[i], quantity: updated[i].quantity - 1 };
                              setChar({ ...char, inventory: updated });
                            } else {
                              setChar({ ...char, inventory: char.inventory.filter((_, idx) => idx !== i) });
                            }
                          }}
                        >{(char.inventory[i].quantity || 1) > 1 ? '−' : '✕'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Gear search results */}
              <div style={{ ...styles.listContainer, maxHeight: '200px' }}>
                {gearData
                  .filter(g => (g.type === 'gear' || g.category === 'gear' || g.category === 'alchemical' || g.type === 'alchemical'))
                  .filter(g => !gearSearch || g.name.toLowerCase().includes(gearSearch.toLowerCase()))
                  .slice(0, 40)
                  .map(g => {
                    const alreadyAdded = char.inventory.some(inv => inv.name === g.name);
                    return (
                      <div key={g.name} style={{
                        ...styles.listItem,
                        cursor: 'pointer',
                        backgroundColor: alreadyAdded ? '#2a3a2e' : '#1a1a2e',
                      }}
                        onClick={() => {
                          if (alreadyAdded) {
                            // Increment quantity
                            setChar({
                              ...char,
                              inventory: char.inventory.map(inv =>
                                inv.name === g.name ? { ...inv, quantity: (inv.quantity || 1) + 1 } : inv
                              ),
                            });
                          } else {
                            setChar({
                              ...char,
                              inventory: [...char.inventory, { name: g.name, quantity: 1, type: 'gear', price: g.price }],
                            });
                          }
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <span style={{ color: '#d4c5a9', fontWeight: 'bold' }}>{g.name}</span>
                          {g.description && <div style={{ fontSize: '10px', color: '#8b949e' }}>{g.description}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: '#ffd700' }}>{g.price || '—'}</span>
                          <span style={{ fontSize: '10px', color: '#8b949e' }}>{g.weight || ''}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div style={styles.infoPanel}>
              Starting Gold: {getStartingGold(char.class)} gp
            </div>
          </>
        )}

        {/* STEP 6: TRAITS & DETAILS */}
        {currentStepName === 'Traits & Details' && (
          <>
            {/* PF1e Character Traits — pick 2 from different categories (3 with a drawback) */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Character Traits (choose up to {char.drawback ? 3 : 2} from different categories)
              </label>
              <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '8px' }}>
                Each character selects two traits at creation from different categories. Optionally, take a drawback to gain a third trait.
              </div>

              {/* Category filter buttons */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {['all', 'combat', 'magic', 'social', 'faith', 'regional'].map(cat => (
                  <button
                    key={cat}
                    style={{
                      ...styles.buttonSmall,
                      ...(traitCategoryFilter === cat ? { borderColor: '#ffd700', color: '#ffd700', fontWeight: 'bold' } : {}),
                    }}
                    onClick={() => setTraitCategoryFilter(cat)}
                  >
                    {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>

              {/* Selected traits panel */}
              {char.characterTraits.length > 0 && (
                <div style={{ marginBottom: '10px', padding: '8px', backgroundColor: '#2a3a4e', borderRadius: '4px', border: '1px solid #ffd700' }}>
                  <div style={{ fontSize: '11px', color: '#ffd700', fontWeight: 'bold', marginBottom: '4px' }}>Selected Traits:</div>
                  {char.characterTraits.map((tName, i) => {
                    const t = traitsData.find(x => x.name === tName);
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div>
                          <span style={{ color: '#d4c5a9', fontSize: '12px', fontWeight: 'bold' }}>{tName}</span>
                          <span style={{ color: '#8b949e', fontSize: '10px', marginLeft: '6px' }}>({t?.type})</span>
                          <div style={{ fontSize: '10px', color: '#8b949e' }}>{t?.benefit}</div>
                        </div>
                        <button
                          style={{ ...styles.buttonSmall, color: '#ff4444', borderColor: '#ff4444', padding: '2px 8px', fontSize: '10px' }}
                          onClick={() => setChar({ ...char, characterTraits: char.characterTraits.filter(x => x !== tName) })}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Trait list */}
              <div style={styles.listContainer}>
                {traitsData
                  .filter(t => t.type !== 'drawback')
                  .filter(t => traitCategoryFilter === 'all' || t.type === traitCategoryFilter)
                  .filter(t => !char.characterTraits.includes(t.name))
                  .map(t => {
                    const maxTraits = char.drawback ? 3 : 2;
                    const selectedCategories = char.characterTraits.map(name => traitsData.find(x => x.name === name)?.type);
                    const categoryBlocked = char.characterTraits.length >= maxTraits || (char.characterTraits.length >= 1 && selectedCategories.includes(t.type));
                    return (
                      <div key={t.name} style={{
                        ...styles.listItem,
                        opacity: categoryBlocked ? 0.4 : 1,
                        cursor: categoryBlocked ? 'not-allowed' : 'pointer',
                      }}
                        onClick={() => {
                          if (!categoryBlocked) {
                            setChar({ ...char, characterTraits: [...char.characterTraits, t.name] });
                          }
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#d4c5a9', fontWeight: 'bold' }}>{t.name}</div>
                          <div style={{ fontSize: '10px', color: '#8b949e' }}>{t.benefit}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span style={styles.iconBadge}>{t.type}</span>
                          <span style={{ fontSize: '9px', color: '#8b949e' }}>{t.source}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Drawback (optional) — take one to gain a 3rd trait */}
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Drawback <span style={{ fontSize: '11px', color: '#8b949e', fontWeight: 'normal' }}>(optional — take one to gain a 3rd trait)</span>
              </label>

              {char.drawback ? (
                <div style={{ marginBottom: '10px', padding: '8px', backgroundColor: '#3a2020', borderRadius: '4px', border: '1px solid #cc6644' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ color: '#cc6644', fontSize: '12px', fontWeight: 'bold' }}>{char.drawback}</span>
                      <div style={{ fontSize: '10px', color: '#8b949e' }}>
                        {traitsData.find(x => x.name === char.drawback)?.benefit}
                      </div>
                    </div>
                    <button
                      style={{ ...styles.buttonSmall, color: '#ff4444', borderColor: '#ff4444', padding: '2px 8px', fontSize: '10px' }}
                      onClick={() => {
                        // Remove drawback and trim traits back to 2 if needed
                        const trimmedTraits = char.characterTraits.slice(0, 2);
                        setChar({ ...char, drawback: '', characterTraits: trimmedTraits });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ ...styles.listContainer, maxHeight: '180px' }}>
                  {traitsData
                    .filter(t => t.type === 'drawback')
                    .map(t => (
                      <div key={t.name} style={{ ...styles.listItem, cursor: 'pointer' }}
                        onClick={() => setChar({ ...char, drawback: t.name })}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#cc6644', fontWeight: 'bold' }}>{t.name}</div>
                          <div style={{ fontSize: '10px', color: '#8b949e' }}>{t.benefit}</div>
                        </div>
                        <span style={{ fontSize: '9px', color: '#8b949e' }}>{t.source}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Personality */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Personality</label>
              <textarea
                style={{ ...styles.input, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={char.personality}
                onChange={(e) => setChar({ ...char, personality: e.target.value })}
                placeholder="Describe your character's personality — temperament, quirks, values, habits..."
              />
            </div>

            {/* Appearance */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Appearance</label>
              <textarea
                style={{ ...styles.input, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={char.appearance}
                onChange={(e) => setChar({ ...char, appearance: e.target.value })}
                placeholder="Physical appearance — build, hair, eyes, notable features, clothing style..."
              />
            </div>

            {/* Backstory */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Backstory</label>
              <textarea
                style={{ ...styles.input, minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' }}
                value={char.backstory}
                onChange={(e) => setChar({ ...char, backstory: e.target.value })}
                placeholder="Your character's history — upbringing, formative events, why they became an adventurer..."
              />
            </div>
          </>
        )}

        {/* STEP 7: REVIEW */}
        {currentStepName === 'Review' && (
          <>
            <div style={{ ...styles.infoPanel, backgroundColor: '#2a3a4e' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffd700', marginBottom: '12px' }}>
                {char.name || 'Unnamed Character'}
              </div>
              <div style={{ marginBottom: '4px' }}>
                <strong>{char.gender ? `${char.gender} ` : ''}{char.race || 'Unknown'} {char.class || 'Unknown'}</strong> ({char.alignment || 'No alignment'})
              </div>
              {(char.ethnicity || char.origin || char.heritage) && (
                <div style={{ fontSize: '12px', color: '#8b949e', marginBottom: '12px' }}>
                  {char.heritage && char.heritage !== `Standard ${char.race}` ? <span style={{ color: '#c4a0ff' }}>{char.heritage} </span> : null}
                  {char.ethnicity && char.ethnicity !== char.race ? `${char.ethnicity} ` : ''}
                  {char.origin ? `from ${char.origin}` : ''}
                  {char.languages?.length > 1 && ` — speaks ${char.languages.join(', ')}`}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => {
                  const finalScore = getAbilityScore(ability);
                  const racial = getRacialBonus(ability);
                  const baseScore = finalScore - racial;
                  return (
                    <div key={ability}>
                      <div style={{ color: '#ffd700', fontSize: '11px', fontWeight: 'bold' }}>{ability}</div>
                      <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#d4c5a9' }}>
                        {finalScore}
                      </div>
                      <div style={{ fontSize: '10px', color: '#8b949e' }}>
                        ({mod(finalScore) > 0 ? '+' : ''}{mod(finalScore)})
                      </div>
                      {racial !== 0 && (
                        <div style={{ fontSize: '9px', color: '#9bb59b', marginTop: '2px' }}>
                          {baseScore}{racial > 0 ? ` +${racial}` : ` ${racial}`} race
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                <div><strong>HP:</strong> {getMaxHP(char.class, char.level, mod(getAbilityScore('CON')), classesMap)}</div>
                <div><strong>BAB:</strong> +{calcBAB(char.class, char.level, classesMap)}</div>
                <div><strong>Fort Save:</strong> +{calcSave('Fort', char.class, char.level, classesMap)}</div>
                <div><strong>Ref Save:</strong> +{calcSave('Ref', char.class, char.level, classesMap)}</div>
                <div><strong>Will Save:</strong> +{calcSave('Will', char.class, char.level, classesMap)}</div>
              </div>

              {char.selectedFeats.length > 0 && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                  <strong>Feats ({char.selectedFeats.length}):</strong>
                  <div style={{ fontSize: '11px', marginTop: '6px' }}>
                    {char.selectedFeats.join(', ')}
                  </div>
                </div>
              )}

              {char.spellsKnown.length > 0 && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                  <strong>Spells ({char.spellsKnown.length}):</strong>
                  <div style={{ fontSize: '11px', marginTop: '6px' }}>
                    {char.spellsKnown.join(', ')}
                  </div>
                </div>
              )}

              {(() => {
                // Phase 7.4 — show the chosen familiar or bonded object on the
                // review step. NOTE: applyClassFeatures has NOT yet run at
                // this point in the lifecycle (it only runs in handleComplete),
                // so `char.familiar` / `char.bondedObject` are still their
                // init-state nulls. We must read the raw-selection fields
                // (familiarChoice / bondedObjectType / arcaneBond) that
                // ClassFeatureStep writes directly via setChar, and gate on
                // class + arcaneBond to decide which side is active.
                const isWitch = char.class === 'Witch';
                const isWizFam = char.class === 'Wizard' && char.arcaneBond === 'familiar';
                const isWizBond = char.class === 'Wizard' && char.arcaneBond === 'bondedObject';
                const showFamiliar = (isWitch || isWizFam) && !!char.familiarChoice;
                const showBond = isWizBond && !!char.bondedObjectType;
                if (!showFamiliar && !showBond) return null;
                const fam = showFamiliar ? getFamiliarById(char.familiarChoice) : null;
                const bond = showBond ? char.bondedObjectType : null;
                const bondLabels = {
                  amulet: 'Amulet', ring: 'Ring', staff: 'Staff', wand: 'Wand', weapon: 'Weapon',
                };
                // Use getMasterFamiliarBonus so improved familiars with an
                // inheritsMasterBonusFrom link (e.g. celestial_hawk → hawk)
                // render the inherited bonus, not a blank line.
                const mb = showFamiliar ? getMasterFamiliarBonus(char.familiarChoice) : null;
                let bonusLine = '';
                if (mb) {
                  if (mb.kind === 'skill') {
                    bonusLine = `+${mb.value} ${mb.skill}${mb.condition ? ' (' + mb.condition + ')' : ''}`;
                  } else if (mb.kind === 'save') {
                    const saveLabel = String(mb.save || '').replace(/^./, (c) => c.toUpperCase());
                    bonusLine = `+${mb.value} ${saveLabel} saves`;
                  } else if (mb.kind === 'hp') {
                    bonusLine = `+${mb.value} max HP`;
                  }
                }
                return (
                  <div style={{ marginTop: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                    <strong>{char.class === 'Witch' ? 'Patron Familiar' : 'Arcane Bond'}:</strong>
                    {fam && (
                      <div style={{ fontSize: '11px', marginTop: '4px' }}>
                        <span style={{ color: '#ffd700' }}>{fam.name}</span>
                        {fam.kind === 'improved' && <span style={{ color: '#8b949e' }}> (improved)</span>}
                        {bonusLine && <span style={{ color: '#9bb59b' }}> — {bonusLine}</span>}
                      </div>
                    )}
                    {bond && (
                      <div style={{ fontSize: '11px', marginTop: '4px' }}>
                        <span style={{ color: '#ffd700' }}>Bonded {bondLabels[bond] || bond}</span>
                        <span style={{ color: '#8b949e' }}> — +1 spell slot/day; concentration check (DC 20 + spell level) when not in possession</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {(char.characterTraits?.length > 0 || char.drawback) && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                  <strong>Character Traits:</strong>
                  {char.characterTraits.map((tName, i) => {
                    const t = traitsData.find(x => x.name === tName);
                    return (
                      <div key={i} style={{ fontSize: '11px', marginTop: '4px' }}>
                        <span style={{ color: '#ffd700' }}>{tName}</span>
                        <span style={{ color: '#8b949e' }}> ({t?.type})</span>
                        <span style={{ color: '#d4c5a9' }}> — {t?.benefit}</span>
                      </div>
                    );
                  })}
                  {char.drawback && (
                    <div style={{ fontSize: '11px', marginTop: '6px' }}>
                      <strong style={{ color: '#cc6644' }}>Drawback:</strong>{' '}
                      <span style={{ color: '#cc6644' }}>{char.drawback}</span>
                      <span style={{ color: '#d4c5a9' }}> — {traitsData.find(x => x.name === char.drawback)?.benefit}</span>
                    </div>
                  )}
                </div>
              )}

              {(char.personality || char.appearance || char.backstory) && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                  {char.personality && (
                    <div style={{ marginBottom: '6px' }}>
                      <strong>Personality:</strong>
                      <div style={{ fontSize: '11px', color: '#c4b998' }}>{char.personality}</div>
                    </div>
                  )}
                  {char.appearance && (
                    <div style={{ marginBottom: '6px' }}>
                      <strong>Appearance:</strong>
                      <div style={{ fontSize: '11px', color: '#c4b998' }}>{char.appearance}</div>
                    </div>
                  )}
                  {char.backstory && (
                    <div>
                      <strong>Backstory:</strong>
                      <div style={{ fontSize: '11px', color: '#c4b998', maxHeight: '100px', overflowY: 'auto' }}>{char.backstory}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div style={styles.buttonRow}>
        <button
          style={{
            ...styles.button,
            opacity: currentStepName === 'Basics' ? 0.5 : 1,
            cursor: currentStepName === 'Basics' ? 'not-allowed' : 'pointer',
          }}
          onClick={prevStep}
          disabled={currentStepName === 'Basics'}
        >
          Back
        </button>
        {step < steps.length - 1 ? (() => {
          // Phase 7.4 — grey out Next when the Class Features step has
          // unresolved required picks (e.g. Wizard with no arcaneBond, Witch
          // with no patron familiar). Inline errors are rendered by
          // ClassFeatureStep, so the user can see why.
          const blocked = currentStepName === 'Class Features' && classFeatureErrors.length > 0;
          return (
            <button
              style={{
                ...styles.button,
                opacity: blocked ? 0.5 : 1,
                cursor: blocked ? 'not-allowed' : 'pointer',
              }}
              onClick={nextStep}
              disabled={blocked}
              title={blocked ? classFeatureErrors.join('; ') : undefined}
            >
              Next
            </button>
          );
        })() : (() => {
          // Phase 7.4 — also gate Create Character against pending class
          // feature errors, in case the user rewound to an earlier step
          // and invalidated their selections.
          const blocked = classFeatureErrors.length > 0;
          return (
            <button
              style={{
                ...styles.button,
                opacity: blocked ? 0.5 : 1,
                cursor: blocked ? 'not-allowed' : 'pointer',
              }}
              onClick={handleComplete}
              disabled={blocked}
              title={blocked ? classFeatureErrors.join('; ') : undefined}
            >
              Create Character
            </button>
          );
        })()}
      </div>
    </div>
  );
}
