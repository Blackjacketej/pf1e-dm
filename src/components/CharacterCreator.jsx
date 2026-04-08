import React, { useState, useMemo } from 'react';
import { rollAbilityScore, mod, calcBAB, calcSave, getMaxHP, uid, rollDice } from '../utils/dice';
import { getStartingGold, getSkillPointsPerLevel, calcFullAC } from '../utils/character';
import skillsData from '../data/skills.json';
import spellsData from '../data/spells.json';
import gearData from '../data/gear.json';
import equipmentData from '../data/equipment.json';
import ethnicitiesData from '../data/ethnicities.json';

const POINT_BUY_TABLE = {
  7: -4, 8: -2, 9: -1, 10: 0, 11: 1, 12: 2, 13: 3,
  14: 5, 15: 7, 16: 10, 17: 13, 18: 17,
};

const POINT_BUY_COST = {
  10: 0, 11: 1, 12: 2, 13: 3, 14: 5, 15: 7, 16: 10, 17: 13, 18: 17,
};

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
}) {
  const [step, setStep] = useState(0);
  const [pointBuyMode, setPointBuyMode] = useState(false);
  const [pointBuyPoints, setPointBuyPoints] = useState(20);
  const [selectedRacialBonus, setSelectedRacialBonus] = useState(null);
  const [skillFilter, setSkillFilter] = useState('');
  const [spellFilter, setSpellFilter] = useState('');
  const [spellLevelFilter, setSpellLevelFilter] = useState('all');
  const [featFilter, setFeatFilter] = useState('');

  const [char, setChar] = useState({
    id: uid(),
    name: '',
    race: '',
    class: '',
    alignment: '',
    ethnicity: '',
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
    inventory: [],
    notes: '',
  });

  const [rollAbilities, setRollAbilities] = useState({
    STR: null, DEX: null, CON: null, INT: null, WIS: null, CHA: null,
  });

  const [pointBuyAbilities, setPointBuyAbilities] = useState({
    STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10,
  });

  const steps = ['Basics', 'Abilities', 'Skills', 'Feats', 'Spells', 'Equipment', 'Review'];

  const classesMap = useMemo(() => {
    const map = {};
    classes.forEach(c => { map[c.name] = c; });
    return map;
  }, [classes]);

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

  const getAbilityScore = (ability) => {
    const base = pointBuyMode ? pointBuyAbilities[ability] : char.abilities[ability];
    let bonus = 0;
    if (selectedRace?.bonuses) {
      if (selectedRace.bonuses[ability]) {
        bonus += selectedRace.bonuses[ability];
      }
      if (selectedRace.bonuses.choice && selectedRacialBonus === ability) {
        bonus += 2;
      }
    }
    return base + bonus;
  };

  const getPointBuySpent = () => {
    let spent = 0;
    Object.entries(pointBuyAbilities).forEach(([ability, score]) => {
      if (score >= 10 && score <= 18) {
        spent += POINT_BUY_COST[score] || 0;
      }
    });
    if (selectedRace?.bonuses?.choice && selectedRacialBonus) {
      const bonusScore = pointBuyAbilities[selectedRacialBonus] + 2;
      if (bonusScore >= 10 && bonusScore <= 18) {
        spent -= (POINT_BUY_COST[pointBuyAbilities[selectedRacialBonus]] || 0);
        spent += (POINT_BUY_COST[bonusScore] || 0);
      }
    }
    return spent;
  };

  const handlePointBuyChange = (ability, amount) => {
    const newValue = pointBuyAbilities[ability] + amount;
    if (newValue >= 7 && newValue <= 18) {
      setPointBuyAbilities({ ...pointBuyAbilities, [ability]: newValue });
    }
  };

  const applyPointBuyToChar = () => {
    setChar({
      ...char,
      abilities: { ...pointBuyAbilities },
    });
  };

  const rollAllAbilities = () => {
    const newAbilities = {};
    Object.keys(rollAbilities).forEach(ability => {
      const result = rollAbilityScore();
      newAbilities[ability] = result.total;
    });
    setRollAbilities(newAbilities);
  };

  const assignRolledAbility = (ability, rollIndex) => {
    const rolls = Object.values(rollAbilities).filter(v => v !== null).sort((a, b) => b - a);
    if (rollIndex < rolls.length) {
      setChar({
        ...char,
        abilities: { ...char.abilities, [ability]: rolls[rollIndex] },
      });
    }
  };

  const getSkillPointsAvailable = () => {
    if (!selectedClass) return 0;
    const intMod = mod(char.abilities.INT);
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
    if (char.race === 'Human') count++;
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

  const nextStep = () => {
    if (step === 1 && !pointBuyMode) {
      applyPointBuyToChar();
    }
    if (step < steps.length - 1) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleComplete = () => {
    const armorObj = equipmentData.armor.find(a => a.name === char.armor) || { ac: 0, maxDex: 99 };
    const shieldObj = equipmentData.shields.find(s => s.name === char.shield) || { ac: 0 };
    const maxHp = getMaxHP(char.class, char.level, mod(char.abilities.CON), classesMap);
    const acCalc = calcFullAC(char, armorObj, shieldObj);

    const finalChar = {
      ...char,
      maxHP: maxHp,
      currentHP: maxHp,
      ac: acCalc.total,
      acBreakdown: acCalc,
      gold: getStartingGold(char.class),
      size: selectedRace?.size || 'Medium',
      speed: selectedRace?.speed || 30,
      equipped: {},
      spellSlotsUsed: {},
      favoredClassBonus: null,
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
            onClick={() => setStep(i)}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      <div style={styles.form}>
        {/* STEP 0: BASICS */}
        {step === 0 && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>Character Name</label>
              <input
                style={styles.input}
                value={char.name}
                onChange={(e) => setChar({ ...char, name: e.target.value })}
                placeholder="Enter character name"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Race</label>
              <select
                style={styles.select}
                value={char.race}
                onChange={(e) => {
                  setChar({ ...char, race: e.target.value });
                  setSelectedRacialBonus(null);
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
                  {selectedRace.bonuses && (
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
                  {selectedRace.traits && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Traits:</strong> {selectedRace.traits.join(', ')}
                    </div>
                  )}
                  {selectedRace.languages && (
                    <div style={{ marginTop: '8px' }}>
                      <strong>Languages:</strong> {selectedRace.languages.join(', ')}
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
                  value={char.origin}
                  onChange={(e) => setChar({ ...char, origin: e.target.value })}
                >
                  <option value={char.origin}>{char.origin || 'Custom / Not Set'}</option>
                  {ethnicitiesData.homelands
                    .filter(h => h.name !== char.origin)
                    .map(h => (
                      <option key={h.name} value={h.name}>{h.name} — {h.description}</option>
                    ))
                  }
                </select>
                <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '4px' }}>
                  Override with any Golarion homeland, or leave the default from your ethnicity/origin.
                </div>
              </div>
            )}
          </>
        )}

        {/* STEP 1: ABILITIES */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <button
                style={{
                  ...styles.toggleButton,
                  ...(pointBuyMode ? styles.toggleButtonActive : {}),
                }}
                onClick={() => setPointBuyMode(true)}
              >
                Point Buy
              </button>
              <button
                style={{
                  ...styles.toggleButton,
                  ...(pointBuyMode ? {} : styles.toggleButtonActive),
                  marginLeft: '8px',
                }}
                onClick={() => setPointBuyMode(false)}
              >
                Roll (4d6)
              </button>
            </div>

            {pointBuyMode ? (
              <>
                <div style={{ ...styles.infoPanel, backgroundColor: '#2a3a4e' }}>
                  Points Spent: {getPointBuySpent()} / 20
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
                      width: `${(getPointBuySpent() / 20) * 100}%`,
                      backgroundColor: '#ffd700',
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
                          {getAbilityScore(ability)}
                        </div>
                        <button
                          style={styles.buttonSmall}
                          onClick={() => handlePointBuyChange(ability, 1)}
                        >
                          +
                        </button>
                      </div>
                      <div style={{ fontSize: '10px', color: '#8b949e', textAlign: 'center' }}>
                        (Base: {pointBuyAbilities[ability]})
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button style={styles.button} onClick={rollAllAbilities}>
                  Roll All Abilities (4d6 Drop Lowest)
                </button>
                {Object.keys(rollAbilities).some(a => rollAbilities[a] !== null) && (
                  <div style={styles.infoPanel}>
                    <div style={{ marginBottom: '12px' }}>
                      Click a score to assign it to an ability:
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
                        <div key={ability}>
                          <div style={{ ...styles.abilityBox, marginBottom: '8px' }}>
                            <div style={{ color: '#ffd700', fontSize: '14px', fontWeight: 'bold' }}>
                              {ability}
                            </div>
                            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold', marginTop: '4px' }}>
                              {char.abilities[ability]}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {Object.values(rollAbilities).some(v => v !== null) && (
                      <>
                        <div style={{ marginTop: '16px', marginBottom: '12px', borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                          Available Rolls:
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                          {Object.values(rollAbilities).filter(v => v !== null).sort((a, b) => b - a).map((roll, idx) => (
                            <button
                              key={idx}
                              style={{
                                padding: '8px',
                                backgroundColor: '#3a3a6e',
                                border: '1px solid #ffd700',
                                borderRadius: '4px',
                                color: '#ffd700',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                              }}
                              onClick={() => {
                                const unassignedAbilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].filter(
                                  a => !Object.values(char.abilities).includes(roll)
                                );
                                if (unassignedAbilities.length > 0) {
                                  assignRolledAbility(unassignedAbilities[0], idx);
                                }
                              }}
                            >
                              {roll}
                            </button>
                          ))}
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
        {step === 2 && (
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
                const isClassSkill = selectedClass?.classSkills?.includes(skill.name);
                const ranks = char.skillRanks[skill.name] || 0;
                const abilityMod = mod(char.abilities[skill.ability] || 10);
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
        {step === 3 && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                Feats: {char.selectedFeats.length} / {getMaxFeats()}
              </label>
              <input
                style={styles.input}
                type="text"
                placeholder="Search feats..."
                value={featFilter}
                onChange={(e) => setFeatFilter(e.target.value)}
              />
            </div>

            <div style={styles.listContainer}>
              {getFilteredFeats().map((feat, idx) => {
                const isSelected = char.selectedFeats.includes(feat.name);
                const canSelect = !isSelected && char.selectedFeats.length < getMaxFeats();

                return (
                  <label
                    key={idx}
                    style={{
                      ...styles.listItem,
                      cursor: canSelect || isSelected ? 'pointer' : 'not-allowed',
                      opacity: !canSelect && !isSelected ? 0.5 : 1,
                      backgroundColor: isSelected ? '#3a5a4e' : '#1a1a2e',
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
                      <span style={{ fontWeight: isSelected ? 'bold' : 'normal', color: '#d4c5a9' }}>
                        {feat.name}
                      </span>
                      {feat.category && (
                        <span style={{ marginLeft: '8px', ...styles.iconBadge }}>
                          {feat.category}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {/* STEP 4: SPELLS */}
        {step === 4 && (
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
        {step === 5 && (
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

            <div style={styles.infoPanel}>
              Starting Gold: {getStartingGold(char.class)} gp
            </div>
          </>
        )}

        {/* STEP 6: REVIEW */}
        {step === 6 && (
          <>
            <div style={{ ...styles.infoPanel, backgroundColor: '#2a3a4e' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffd700', marginBottom: '12px' }}>
                {char.name || 'Unnamed Character'}
              </div>
              <div style={{ marginBottom: '4px' }}>
                <strong>{char.race || 'Unknown'} {char.class || 'Unknown'}</strong> ({char.alignment || 'No alignment'})
              </div>
              {(char.ethnicity || char.origin) && (
                <div style={{ fontSize: '12px', color: '#8b949e', marginBottom: '12px' }}>
                  {char.ethnicity && char.ethnicity !== char.race ? `${char.ethnicity} ` : ''}
                  {char.origin ? `from ${char.origin}` : ''}
                  {char.languages?.length > 1 && ` — speaks ${char.languages.join(', ')}`}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
                  <div key={ability}>
                    <div style={{ color: '#ffd700', fontSize: '11px', fontWeight: 'bold' }}>{ability}</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#d4c5a9' }}>
                      {char.abilities[ability]}
                    </div>
                    <div style={{ fontSize: '10px', color: '#8b949e' }}>
                      ({mod(char.abilities[ability]) > 0 ? '+' : ''}{mod(char.abilities[ability])})
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid #3a3a6e', paddingTop: '12px' }}>
                <div><strong>HP:</strong> {getMaxHP(char.class, char.level, mod(char.abilities.CON), classesMap)}</div>
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
            </div>
          </>
        )}
      </div>

      <div style={styles.buttonRow}>
        <button
          style={{
            ...styles.button,
            opacity: step === 0 ? 0.5 : 1,
            cursor: step === 0 ? 'not-allowed' : 'pointer',
          }}
          onClick={prevStep}
          disabled={step === 0}
        >
          Back
        </button>
        {step < steps.length - 1 ? (
          <button style={styles.button} onClick={nextStep}>
            Next
          </button>
        ) : (
          <button style={styles.button} onClick={handleComplete}>
            Create Character
          </button>
        )}
      </div>
    </div>
  );
}
