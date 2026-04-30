import React, { useState, useMemo } from 'react';
import { mod, modStr, roll, rollDice, calcBAB, calcSave, getMaxHP } from '../utils/dice';
import { getSkillPointsPerLevel } from '../utils/character';
import { parseAllFeats, checkFeatPrereqs } from '../utils/featPrereqs';
import { getAccessibleSpellLevels } from '../utils/spellEngine';
import skillsData from '../data/skills.json';
import featsData from '../data/feats.json';
import spellsData from '../data/spells.json';

const THEME = {
  bg: '#1a1a2e',
  panel: '#2a2a4e',
  gold: '#ffd700',
  text: '#d4c5a9',
  muted: '#8b949e',
  border: '#404060',
  success: '#4CAF50',
  danger: '#f44336',
};

const FEAT_LEVELS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const ABILITY_INCREASE_LEVELS = [4, 8, 12, 16, 20];

export default function LevelUpWizard({
  char,
  onComplete,
  onCancel,
  classesMap,
  spellSlotData,
}) {
  const classData = classesMap?.[char.class];
  const newLevel = char.level + 1;
  const conMod = mod(char.abilities?.CON || 10);
  const intMod = mod(char.abilities?.INT || 10);
  const isHuman = char.race === 'Human';

  // Determine which steps apply
  const hasAbilityIncrease = ABILITY_INCREASE_LEVELS.includes(newLevel);
  const hasFeat = FEAT_LEVELS.includes(newLevel) || (char.class === 'Fighter' && newLevel % 2 === 0);
  const hasSpellcasting = ['Wizard', 'Sorcerer', 'Bard', 'Cleric', 'Druid'].includes(char.class);
  const hasClassFeatures = classData?.classFeatures?.some(f => f.level === newLevel);

  // State management
  const [step, setStep] = useState('summary');
  const [useAverage, setUseAverage] = useState(true);
  const [hpRoll, setHpRoll] = useState(null);
  const [selectedAbility, setSelectedAbility] = useState(null);
  const [skillRanksAllocation, setSkillRanksAllocation] = useState({});
  const [selectedFeats, setSelectedFeats] = useState([]);
  const [selectedSpells, setSelectedSpells] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showIneligibleFeats, setShowIneligibleFeats] = useState(false);

  // Calculate new HP
  const hdSize = classData?.hd || 8;
  const avgHP = Math.floor(hdSize / 2) + 1 + conMod;
  const newHP = useAverage ? avgHP : (hpRoll?.total || 0) + conMod;
  const maxHPAfterLevel = getMaxHP(char.class, newLevel, conMod, classesMap);

  // Calculate skill ranks available
  const skillPointsPerLevel = getSkillPointsPerLevel(classData, intMod, isHuman);
  const allocatedRanks = Object.values(skillRanksAllocation).reduce((s, v) => s + v, 0);
  const remainingRanks = skillPointsPerLevel - allocatedRanks;

  // New BAB and saves
  const oldBAB = calcBAB(char.class, char.level, classesMap);
  const newBAB = calcBAB(char.class, newLevel, classesMap);
  const oldFort = calcSave('fort', char.class, char.level, classesMap);
  const newFort = calcSave('fort', char.class, newLevel, classesMap);
  const oldRef = calcSave('ref', char.class, char.level, classesMap);
  const newRef = calcSave('ref', char.class, newLevel, classesMap);
  const oldWill = calcSave('will', char.class, char.level, classesMap);
  const newWill = calcSave('will', char.class, newLevel, classesMap);

  // New class features for this level
  const newClassFeatures = classData?.classFeatures?.filter(f => f.level === newLevel) || [];

  // Feat count
  const baseFeatCount = FEAT_LEVELS.includes(newLevel) ? 1 : 0;
  const fighterBonusFeats = char.class === 'Fighter' && newLevel % 2 === 0 ? 1 : 0;
  const totalFeatsToSelect = baseFeatCount + fighterBonusFeats;

  // Parse all feat prerequisites once
  const parsedFeatMap = useMemo(() => parseAllFeats(featsData), []);

  // Build a virtual character at the NEW level for prerequisite checking
  // Includes ability increase if already selected, and progressively includes selected feats
  const levelUpChar = useMemo(() => {
    const virtual = {
      ...char,
      level: newLevel,
      abilities: { ...(char.abilities || {}) },
      feats: [...(char.feats || []), ...selectedFeats],
      skillRanks: { ...(char.skillRanks || {}) },
    };
    // Apply ability increase if selected
    if (selectedAbility && hasAbilityIncrease) {
      virtual.abilities[selectedAbility] = (virtual.abilities[selectedAbility] || 10) + 1;
    }
    // Apply skill ranks from this level-up
    Object.entries(skillRanksAllocation).forEach(([skill, ranks]) => {
      virtual.skillRanks[skill] = (virtual.skillRanks[skill] || 0) + ranks;
    });
    return virtual;
  }, [char, newLevel, selectedAbility, hasAbilityIncrease, selectedFeats, skillRanksAllocation]);

  // Filter and annotate feats with prerequisite eligibility
  const availableFeats = useMemo(() => {
    return featsData
      .filter(feat => {
        const searchMatch = feat.name.toLowerCase().includes(searchTerm.toLowerCase());
        // Don't show feats the character already has
        const alreadyHas = (char.feats || []).some(f =>
          (typeof f === 'string' ? f : f.name || '').toLowerCase() === feat.name.toLowerCase()
        );
        return searchMatch && !alreadyHas;
      })
      .map(feat => {
        const { met, missing } = checkFeatPrereqs(feat.name, levelUpChar, parsedFeatMap);
        return { ...feat, eligible: met, missing };
      })
      .sort((a, b) => {
        // Eligible feats first
        if (a.eligible && !b.eligible) return -1;
        if (!a.eligible && b.eligible) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [searchTerm, levelUpChar, parsedFeatMap, char.feats]);

  // Determine accessible spell levels at the new level
  const accessibleSpellLevels = useMemo(() => {
    try {
      return getAccessibleSpellLevels(char.class, newLevel, char.abilities);
    } catch {
      // Fallback: allow spell levels 0 through floor(newLevel/2)
      return Array.from({ length: Math.min(10, Math.floor(newLevel / 2) + 1) }, (_, i) => i);
    }
  }, [char.class, newLevel, char.abilities]);

  // Filter spells — only show spells the character can actually access at this level
  const availableSpells = useMemo(() => {
    const classKey = char.class.toLowerCase();
    return spellsData
      .filter(spell => {
        const matchesSearch = spell.name.toLowerCase().includes(searchTerm.toLowerCase());
        const spellLevel = spell.level?.[classKey];
        const hasClass = spellLevel !== undefined;
        // Only show spells the character can actually cast at this level
        const canAccess = hasClass && accessibleSpellLevels.includes(spellLevel);
        // Don't show spells already known
        const alreadyKnown = (char.spellsKnown || []).includes(spell.name);
        return matchesSearch && canAccess && !alreadyKnown;
      })
      .sort((a, b) => {
        const aLevel = a.level?.[classKey] || 0;
        const bLevel = b.level?.[classKey] || 0;
        if (aLevel !== bLevel) return aLevel - bLevel;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 50);
  }, [char.class, searchTerm, accessibleSpellLevels, char.spellsKnown]);

  // Build updated character
  const buildUpdatedChar = () => {
    const updated = { ...char };
    updated.level = newLevel;
    updated.maxHP = maxHPAfterLevel;
    updated.currentHP = maxHPAfterLevel;
    updated.xp = updated.xp || 0;

    // Add XP to reach next level
    const nextLevelXP = (newLevel + 1) * (newLevel + 1) * 1000;
    updated.xp = nextLevelXP - 1;

    // Apply ability increase
    if (selectedAbility && hasAbilityIncrease) {
      updated.abilities = { ...updated.abilities };
      updated.abilities[selectedAbility]++;
    }

    // Apply skill ranks
    updated.skillRanks = { ...updated.skillRanks };
    Object.entries(skillRanksAllocation).forEach(([skill, ranks]) => {
      updated.skillRanks[skill] = (updated.skillRanks[skill] || 0) + ranks;
    });

    // Apply feats
    updated.feats = [...(updated.feats || [])];
    selectedFeats.forEach(feat => {
      if (!updated.feats.includes(feat)) {
        updated.feats.push(feat);
      }
    });

    // Apply spells
    if (hasSpellcasting) {
      updated.spellsKnown = [...(updated.spellsKnown || [])];
      selectedSpells.forEach(spell => {
        if (!updated.spellsKnown.includes(spell)) {
          updated.spellsKnown.push(spell);
        }
      });
    }

    return updated;
  };

  const handleNextStep = () => {
    const steps = ['summary'];
    if (hasAbilityIncrease) steps.push('ability');
    steps.push('skills');
    if (hasFeat) steps.push('feats');
    if (hasSpellcasting) steps.push('spells');
    if (hasClassFeatures) steps.push('features');
    steps.push('review');

    const currentIdx = steps.indexOf(step);
    if (currentIdx < steps.length - 1) {
      setStep(steps[currentIdx + 1]);
    }
  };

  const handlePrevStep = () => {
    const steps = ['summary'];
    if (hasAbilityIncrease) steps.push('ability');
    steps.push('skills');
    if (hasFeat) steps.push('feats');
    if (hasSpellcasting) steps.push('spells');
    if (hasClassFeatures) steps.push('features');
    steps.push('review');

    const currentIdx = steps.indexOf(step);
    if (currentIdx > 0) {
      setStep(steps[currentIdx - 1]);
    }
  };

  const handleRollHP = () => {
    const result = rollDice(1, hdSize);
    setHpRoll(result);
    setUseAverage(false);
  };

  const handleSkillChange = (skillName, value) => {
    const maxRanks = newLevel;
    const newValue = Math.min(Math.max(0, value), maxRanks);
    setSkillRanksAllocation(prev => {
      const updated = { ...prev };
      if (newValue === 0) {
        delete updated[skillName];
      } else {
        updated[skillName] = newValue;
      }
      return updated;
    });
  };

  const toggleFeatSelection = (featName) => {
    setSelectedFeats(prev => {
      if (prev.includes(featName)) {
        return prev.filter(f => f !== featName);
      }
      // Only allow selecting if eligible and under the limit
      const feat = availableFeats.find(f => f.name === featName);
      if (feat && feat.eligible && prev.length < totalFeatsToSelect) {
        return [...prev, featName];
      }
      return prev;
    });
  };

  const toggleSpellSelection = (spellName) => {
    setSelectedSpells(prev => {
      if (prev.includes(spellName)) {
        return prev.filter(s => s !== spellName);
      }
      if (char.class === 'Wizard' && prev.length < 2) {
        return [...prev, spellName];
      }
      if (char.class !== 'Wizard' && prev.length < 1) {
        return [...prev, spellName];
      }
      return prev;
    });
  };

  // ===== RENDER STEPS =====
  const renderSummary = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ color: THEME.gold, marginBottom: '20px' }}>
        Level {char.level} → Level {newLevel}
      </h2>

      <div style={{
        background: THEME.border,
        padding: '15px',
        borderRadius: '4px',
        marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span>Hit Points:</span>
          <span style={{ color: THEME.gold }}>+{newHP}</span>
        </div>
        <div style={{ fontSize: '12px', color: THEME.muted }}>
          d{hdSize} {useAverage ? `(avg: ${avgHP})` : `(rolled: ${hpRoll?.total || '—'})`}
        </div>
        <button
          onClick={handleRollHP}
          style={{
            marginTop: '10px',
            background: THEME.gold,
            color: THEME.bg,
            border: 'none',
            padding: '6px 12px',
            borderRadius: '3px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '12px',
          }}
        >
          Roll HP
        </button>
        <label style={{ marginLeft: '15px', fontSize: '12px', color: THEME.muted }}>
          <input
            type="checkbox"
            checked={useAverage}
            onChange={e => setUseAverage(e.target.checked)}
          />
          {' '}Use Average
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' }}>
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px' }}>
          <div style={{ fontSize: '12px', color: THEME.muted }}>Base Attack Bonus</div>
          <div style={{ fontSize: '18px', color: THEME.gold }}>
            {oldBAB} → {newBAB}
          </div>
        </div>
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px' }}>
          <div style={{ fontSize: '12px', color: THEME.muted }}>Saves (Fort/Ref/Will)</div>
          <div style={{ fontSize: '12px' }}>
            <span style={{ color: THEME.text }}>{oldFort}/{oldRef}/{oldWill}</span>
            {' '}→{' '}
            <span style={{ color: THEME.gold }}>{newFort}/{newRef}/{newWill}</span>
          </div>
        </div>
      </div>

      {hasAbilityIncrease && (
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px', marginBottom: '20px' }}>
          <div style={{ color: THEME.gold, fontWeight: 'bold' }}>✓ Ability Score Increase</div>
          <div style={{ fontSize: '12px', color: THEME.muted }}>You may increase one ability by 1</div>
        </div>
      )}

      {FEAT_LEVELS.includes(newLevel) && (
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px', marginBottom: '10px' }}>
          <div style={{ color: THEME.gold, fontWeight: 'bold' }}>✓ Feat Granted</div>
        </div>
      )}

      {char.class === 'Fighter' && newLevel % 2 === 0 && (
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px', marginBottom: '10px' }}>
          <div style={{ color: THEME.gold, fontWeight: 'bold' }}>✓ Bonus Fighter Feat</div>
        </div>
      )}

      {newClassFeatures.length > 0 && (
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px', marginBottom: '10px' }}>
          <div style={{ color: THEME.gold, fontWeight: 'bold' }}>✓ New Class Features</div>
          <div style={{ fontSize: '12px', color: THEME.text }}>
            {newClassFeatures.map(f => f.name).join(', ')}
          </div>
        </div>
      )}

      {hasSpellcasting && (
        <div style={{ background: THEME.border, padding: '12px', borderRadius: '4px', marginBottom: '10px' }}>
          <div style={{ color: THEME.gold, fontWeight: 'bold' }}>✓ New Spells</div>
          <div style={{ fontSize: '12px', color: THEME.text }}>
            {char.class === 'Wizard' ? '2 free spells to spellbook' : 'New spells known'}
          </div>
        </div>
      )}
    </div>
  );

  const renderAbility = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ color: THEME.gold, marginBottom: '20px' }}>Ability Score Increase</h2>
      <p style={{ color: THEME.muted, marginBottom: '15px' }}>Select one ability to increase by +1:</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
          <button
            key={ability}
            onClick={() => setSelectedAbility(ability)}
            style={{
              background: selectedAbility === ability ? THEME.gold : THEME.border,
              color: selectedAbility === ability ? THEME.bg : THEME.text,
              border: `2px solid ${selectedAbility === ability ? THEME.gold : 'transparent'}`,
              padding: '15px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '14px',
            }}
          >
            <div>{ability}</div>
            <div style={{ fontSize: '12px', fontWeight: 'normal', marginTop: '5px' }}>
              {char.abilities[ability]} → {char.abilities[ability] + 1}
              <div style={{ fontSize: '10px', marginTop: '3px' }}>
                mod {modStr(mod(char.abilities[ability]))} → {modStr(mod(char.abilities[ability] + 1))}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const renderSkills = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ color: THEME.gold, marginBottom: '10px' }}>Skill Ranks</h2>
      <div style={{
        background: THEME.border,
        padding: '10px',
        marginBottom: '20px',
        borderRadius: '4px',
        fontSize: '13px',
      }}>
        <strong>Available:</strong> {remainingRanks} / {skillPointsPerLevel}
        <div style={{ fontSize: '11px', color: THEME.muted, marginTop: '5px' }}>
          ({classData?.skills} class + {intMod > 0 ? `+${intMod}` : intMod} INT {isHuman ? '+ 1 Human' : ''})
        </div>
      </div>

      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {skillsData.map(skill => {
          const current = skillRanksAllocation[skill.name] || 0;
          const max = newLevel;
          return (
            <div key={skill.name} style={{
              background: THEME.panel,
              padding: '10px',
              marginBottom: '10px',
              borderRadius: '4px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ color: THEME.text, fontWeight: '500' }}>{skill.name}</div>
                <div style={{ fontSize: '11px', color: THEME.muted }}>{skill.ability}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min="0"
                  max={max}
                  value={current}
                  onChange={e => handleSkillChange(skill.name, parseInt(e.target.value) || 0)}
                  style={{
                    width: '50px',
                    padding: '5px',
                    background: THEME.bg,
                    color: THEME.text,
                    border: `1px solid ${THEME.border}`,
                    borderRadius: '3px',
                  }}
                />
                <span style={{ fontSize: '11px', color: THEME.muted }}>/{max}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderFeats = () => {
    const eligibleCount = availableFeats.filter(f => f.eligible).length;
    const displayedFeats = showIneligibleFeats ? availableFeats : availableFeats.filter(f => f.eligible);

    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: THEME.gold, marginBottom: '10px' }}>Select Feats</h2>
        <div style={{
          background: THEME.border,
          padding: '10px',
          marginBottom: '15px',
          borderRadius: '4px',
          fontSize: '13px',
        }}>
          <strong>Select {totalFeatsToSelect}:</strong> {selectedFeats.length} / {totalFeatsToSelect}
          <div style={{ fontSize: '11px', color: THEME.muted, marginTop: '4px' }}>
            {eligibleCount} feats available (prerequisites met)
          </div>
        </div>

        <input
          type="text"
          placeholder="Search feats..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: '10px',
            background: THEME.bg,
            color: THEME.text,
            border: `1px solid ${THEME.border}`,
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />

        <label style={{ display: 'block', marginBottom: '15px', fontSize: '12px', color: THEME.muted, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showIneligibleFeats}
            onChange={e => setShowIneligibleFeats(e.target.checked)}
          />
          {' '}Show ineligible feats ({availableFeats.length - eligibleCount} hidden)
        </label>

        <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
          {displayedFeats.map(feat => {
            const isSelected = selectedFeats.includes(feat.name);
            const isDisabled = (!isSelected && selectedFeats.length >= totalFeatsToSelect) || (!isSelected && !feat.eligible);

            return (
              <button
                key={feat.name}
                onClick={() => toggleFeatSelection(feat.name)}
                disabled={isDisabled}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: isSelected ? THEME.gold : !feat.eligible ? '#2a1a1a' : THEME.panel,
                  color: isSelected ? THEME.bg : !feat.eligible ? '#aa6666' : THEME.text,
                  border: `1px solid ${!feat.eligible ? '#663333' : THEME.border}`,
                  padding: '10px',
                  marginBottom: '8px',
                  borderRadius: '4px',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.6 : 1,
                }}
              >
                <div style={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{feat.name}</span>
                  {feat.eligible && <span style={{ fontSize: '10px', color: isSelected ? THEME.bg : THEME.success }}>✓ Eligible</span>}
                  {!feat.eligible && <span style={{ fontSize: '10px', color: THEME.danger }}>✗ Ineligible</span>}
                </div>
                {feat.prerequisites && (
                  <div style={{ fontSize: '11px', marginTop: '4px' }}>
                    Prereq: {feat.prerequisites}
                  </div>
                )}
                {!feat.eligible && feat.missing && feat.missing.length > 0 && (
                  <div style={{ fontSize: '10px', marginTop: '4px', color: THEME.danger }}>
                    Missing: {feat.missing.join(', ')}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSpells = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ color: THEME.gold, marginBottom: '10px' }}>New Spells</h2>
      <div style={{
        background: THEME.border,
        padding: '10px',
        marginBottom: '15px',
        borderRadius: '4px',
        fontSize: '13px',
      }}>
        <strong>Select {char.class === 'Wizard' ? '2' : '1'}:</strong> {selectedSpells.length} / {char.class === 'Wizard' ? '2' : '1'}
        <div style={{ fontSize: '11px', color: THEME.muted, marginTop: '4px' }}>
          {char.class === 'Wizard' ? 'Add to spellbook' : 'Add to known spells'}
        </div>
      </div>

      <input
        type="text"
        placeholder="Search spells..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        style={{
          width: '100%',
          padding: '10px',
          marginBottom: '15px',
          background: THEME.bg,
          color: THEME.text,
          border: `1px solid ${THEME.border}`,
          borderRadius: '4px',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
        {availableSpells.map(spell => {
          const spellLevel = spell.level?.[char.class.toLowerCase()];
          return (
            <button
              key={spell.name}
              onClick={() => toggleSpellSelection(spell.name)}
              disabled={!selectedSpells.includes(spell.name) && selectedSpells.length >= (char.class === 'Wizard' ? 2 : 1)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                background: selectedSpells.includes(spell.name) ? THEME.gold : THEME.panel,
                color: selectedSpells.includes(spell.name) ? THEME.bg : THEME.text,
                border: `1px solid ${THEME.border}`,
                padding: '10px',
                marginBottom: '8px',
                borderRadius: '4px',
                cursor: 'pointer',
                opacity: !selectedSpells.includes(spell.name) && selectedSpells.length >= (char.class === 'Wizard' ? 2 : 1) ? 0.5 : 1,
              }}
            >
              <div style={{ fontWeight: 'bold' }}>
                {spell.name}
                <span style={{ fontSize: '11px', marginLeft: '10px' }}>Level {spellLevel}</span>
              </div>
              {spell.school && (
                <div style={{ fontSize: '11px', marginTop: '4px' }}>
                  {spell.school}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderFeatures = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ color: THEME.gold, marginBottom: '20px' }}>New Class Features</h2>
      <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {newClassFeatures.map(feature => (
          <div key={feature.name} style={{
            background: THEME.panel,
            padding: '15px',
            marginBottom: '15px',
            borderRadius: '4px',
            borderLeft: `3px solid ${THEME.gold}`,
          }}>
            <div style={{ color: THEME.gold, fontWeight: 'bold', marginBottom: '8px' }}>
              {feature.name}
            </div>
            <div style={{ fontSize: '13px', color: THEME.text, lineHeight: '1.5' }}>
              {feature.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderReview = () => {
    const updated = buildUpdatedChar();
    return (
      <div style={{ padding: '20px' }}>
        <h2 style={{ color: THEME.gold, marginBottom: '20px' }}>Confirm Level Up</h2>

        <div style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '20px' }}>
          <div style={{ background: THEME.border, padding: '12px', marginBottom: '10px', borderRadius: '4px' }}>
            <strong style={{ color: THEME.gold }}>Level:</strong> {char.level} → {newLevel}
          </div>

          <div style={{ background: THEME.border, padding: '12px', marginBottom: '10px', borderRadius: '4px' }}>
            <strong style={{ color: THEME.gold }}>Max HP:</strong> {char.maxHP} → {updated.maxHP}
          </div>

          {selectedAbility && (
            <div style={{ background: THEME.border, padding: '12px', marginBottom: '10px', borderRadius: '4px' }}>
              <strong style={{ color: THEME.gold }}>Ability Increase:</strong> {selectedAbility} +1
            </div>
          )}

          {Object.keys(skillRanksAllocation).length > 0 && (
            <div style={{ background: THEME.border, padding: '12px', marginBottom: '10px', borderRadius: '4px' }}>
              <strong style={{ color: THEME.gold }}>Skill Ranks:</strong>
              {Object.entries(skillRanksAllocation).map(([skill, ranks]) => (
                <div key={skill} style={{ fontSize: '12px', marginTop: '4px' }}>
                  {skill}: +{ranks}
                </div>
              ))}
            </div>
          )}

          {selectedFeats.length > 0 && (
            <div style={{ background: THEME.border, padding: '12px', marginBottom: '10px', borderRadius: '4px' }}>
              <strong style={{ color: THEME.gold }}>New Feats:</strong>
              {selectedFeats.map(feat => (
                <div key={feat} style={{ fontSize: '12px', marginTop: '4px' }}>
                  • {feat}
                </div>
              ))}
            </div>
          )}

          {selectedSpells.length > 0 && (
            <div style={{ background: THEME.border, padding: '12px', marginBottom: '10px', borderRadius: '4px' }}>
              <strong style={{ color: THEME.gold }}>New Spells:</strong>
              {selectedSpells.map(spell => (
                <div key={spell} style={{ fontSize: '12px', marginTop: '4px' }}>
                  • {spell}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => onComplete(updated)}
          style={{
            width: '100%',
            padding: '12px',
            background: THEME.success,
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '10px',
            fontSize: '14px',
          }}
        >
          Confirm Level Up
        </button>
      </div>
    );
  };

  // ===== MAIN RENDER =====
  const renderContent = () => {
    switch (step) {
      case 'summary':
        return renderSummary();
      case 'ability':
        return renderAbility();
      case 'skills':
        return renderSkills();
      case 'feats':
        return renderFeats();
      case 'spells':
        return renderSpells();
      case 'features':
        return renderFeatures();
      case 'review':
        return renderReview();
      default:
        return renderSummary();
    }
  };

  const steps = ['summary'];
  if (hasAbilityIncrease) steps.push('ability');
  steps.push('skills');
  if (hasFeat) steps.push('feats');
  if (hasSpellcasting) steps.push('spells');
  if (hasClassFeatures) steps.push('features');
  steps.push('review');

  const stepLabels = {
    summary: 'Level Summary',
    ability: 'Ability Score',
    skills: 'Skill Ranks',
    feats: 'Feats',
    spells: 'New Spells',
    features: 'Class Features',
    review: 'Review',
  };

  const currentStepIdx = steps.indexOf(step);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: THEME.panel,
        border: `2px solid ${THEME.gold}`,
        borderRadius: '8px',
        width: '90%',
        maxWidth: '600px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header with step indicator */}
        <div style={{
          background: THEME.bg,
          borderBottom: `1px solid ${THEME.border}`,
          padding: '15px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ fontSize: '12px', color: THEME.muted }}>
            Step {currentStepIdx + 1} of {steps.length}
          </div>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              color: THEME.muted,
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Step breadcrumbs */}
        <div style={{
          padding: '10px 20px',
          display: 'flex',
          gap: '8px',
          background: THEME.bg,
          borderBottom: `1px solid ${THEME.border}`,
          flexWrap: 'wrap',
        }}>
          {steps.map((s, idx) => (
            <div key={s} style={{
              fontSize: '11px',
              padding: '4px 8px',
              background: step === s ? THEME.gold : THEME.border,
              color: step === s ? THEME.bg : THEME.muted,
              borderRadius: '3px',
              cursor: idx <= currentStepIdx ? 'pointer' : 'default',
            }}>
              {stepLabels[s]}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {renderContent()}
        </div>

        {/* Footer with navigation */}
        <div style={{
          background: THEME.bg,
          borderTop: `1px solid ${THEME.border}`,
          padding: '15px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '10px',
        }}>
          <button
            onClick={handlePrevStep}
            disabled={currentStepIdx === 0}
            style={{
              padding: '10px 20px',
              background: currentStepIdx === 0 ? THEME.border : THEME.panel,
              color: THEME.text,
              border: `1px solid ${THEME.border}`,
              borderRadius: '4px',
              cursor: currentStepIdx === 0 ? 'not-allowed' : 'pointer',
              opacity: currentStepIdx === 0 ? 0.5 : 1,
            }}
          >
            ← Back
          </button>

          <button
            onClick={handleNextStep}
            disabled={step === 'ability' && !selectedAbility}
            style={{
              padding: '10px 20px',
              background: THEME.gold,
              color: THEME.bg,
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: (step === 'ability' && !selectedAbility) ? 'not-allowed' : 'pointer',
              opacity: (step === 'ability' && !selectedAbility) ? 0.5 : 1,
            }}
          >
            {step === 'review' ? 'Finalize' : 'Next →'}
          </button>

          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              background: THEME.danger,
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
