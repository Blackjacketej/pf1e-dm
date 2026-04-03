import React, { useState, useMemo } from 'react';
import { mod, modStr, calcBAB, calcSave } from '../utils/dice';
import { calcFullAC, calcSkillMod, getCarryingCapacity, getEncumbranceLevel, calcTotalWeight, getSpellSlotsForLevel, EQUIPMENT_SLOTS, getEncumbranceEffects } from '../utils/character';
import useIsMobile from '../hooks/useIsMobile';
import skillsData from '../data/skills.json';
import featsData from '../data/feats.json';
import conditionsData from '../data/conditions.json';
import gearData from '../data/gear.json';
import magicItemsData from '../data/magicItems.json';

const SPELLCASTING_CLASSES = ['Wizard', 'Cleric', 'Druid', 'Sorcerer', 'Bard', 'Paladin', 'Ranger'];
const PREPARED_CASTERS = ['Wizard', 'Cleric', 'Druid'];

const CharacterSheet = ({
  char,
  onUpdate,
  onClose,
  classesMap,
  spellsData,
  spellSlotData,
  armorList,
  shieldsList,
  weaponsList,
}) => {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('Stats');
  const [showFeatPicker, setShowFeatPicker] = useState(false);
  const [featSearch, setFeatSearch] = useState('');
  const [showConditionPicker, setShowConditionPicker] = useState(false);
  const [conditionSearch, setConditionSearch] = useState('');
  const [showSpellPicker, setShowSpellPicker] = useState(false);
  const [spellSearch, setSpellSearch] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [itemSearch, setItemSearch] = useState('');

  const className = char.className || char.class;
  const classData = classesMap?.[className];
  const isSpellcaster = SPELLCASTING_CLASSES.includes(className);
  const isPreparedCaster = PREPARED_CASTERS.includes(className);

  // Calculate ability modifiers
  const abilityMods = useMemo(() => {
    const mods = {};
    ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(ability => {
      mods[ability] = mod(char.abilities?.[ability] || 10);
    });
    return mods;
  }, [char.abilities]);

  // Find armor and shield data
  const armorData = useMemo(() => {
    if (!char.armor || !armorList) return null;
    return armorList.find(a => a.name === char.armor);
  }, [char.armor, armorList]);

  const shieldData = useMemo(() => {
    if (!char.shield || !shieldsList) return null;
    return shieldsList.find(s => s.name === char.shield);
  }, [char.shield, shieldsList]);

  // Calculate AC
  const acData = useMemo(() => {
    return calcFullAC(char, armorData, shieldData);
  }, [char, armorData, shieldData]);

  // Get class skills
  const classSkills = useMemo(() => {
    if (!className || !skillsData) return [];
    return skillsData.filter(skill => skill.classSkills?.includes(className)).map(s => s.name);
  }, [className]);

  // Get armor check penalty
  const armorCheckPenalty = useMemo(() => {
    return (armorData?.penalty || 0) + (shieldData?.penalty || 0);
  }, [armorData, shieldData]);

  // Calculate skill points
  const skillPointsInfo = useMemo(() => {
    if (!classData) return { available: 0, used: 0 };
    const intMod = abilityMods.INT;
    const isHuman = char.race === 'Human';
    const pointsPerLevel = (classData.skills || 2) + intMod + (isHuman ? 1 : 0);
    const usedSkillPoints = Object.values(char.skillRanks || {}).reduce((sum, ranks) => sum + ranks, 0);
    const available = pointsPerLevel * (char.level || 1) - usedSkillPoints;
    return { available, used: usedSkillPoints };
  }, [classData, abilityMods.INT, char.race, char.skillRanks, char.level]);

  // Get spell slots
  const spellSlots = useMemo(() => {
    if (!isSpellcaster || !spellSlotData) return {};
    const castingAbility = spellSlotData.castingAbility?.[className];
    const abilityScore = char.abilities?.[castingAbility] || 10;
    return getSpellSlotsForLevel(className, char.level, abilityScore, spellSlotData);
  }, [isSpellcaster, className, char.level, char.abilities, spellSlotData]);

  // Calculate total weight and encumbrance
  const totalWeight = useMemo(() => calcTotalWeight(char), [char]);
  const encumbranceLevel = useMemo(() => getEncumbranceLevel(totalWeight, char.abilities?.STR || 10), [totalWeight, char.abilities?.STR]);
  const encumbranceEffects = useMemo(() => getEncumbranceEffects(encumbranceLevel), [encumbranceLevel]);
  const carryingCapacity = useMemo(() => getCarryingCapacity(char.abilities?.STR || 10), [char.abilities?.STR]);

  // Update character
  const updateChar = (updates) => {
    onUpdate({ ...char, ...updates });
  };

  const updateAbility = (ability, delta) => {
    const current = char.abilities?.[ability] || 10;
    const newValue = Math.max(1, current + delta);
    updateChar({ abilities: { ...(char.abilities || {}), [ability]: newValue } });
  };

  const updateSkillRank = (skillName, delta) => {
    const current = char.skillRanks?.[skillName] || 0;
    const newRank = Math.max(0, current + delta);
    const newSkillRanks = { ...(char.skillRanks || {}), [skillName]: newRank };
    if (newRank === 0) delete newSkillRanks[skillName];
    updateChar({ skillRanks: newSkillRanks });
  };

  const castSpell = (spellLevel) => {
    const used = char.spellSlotsUsed?.[spellLevel] || 0;
    const max = spellSlots[spellLevel] || 0;
    if (used < max) {
      updateChar({
        spellSlotsUsed: { ...(char.spellSlotsUsed || {}), [spellLevel]: used + 1 }
      });
    }
  };

  const restSpells = () => {
    updateChar({ spellSlotsUsed: {} });
  };

  const addFeat = (featName) => {
    const feats = char.feats || [];
    if (!feats.includes(featName)) {
      updateChar({ feats: [...feats, featName] });
    }
    setShowFeatPicker(false);
    setFeatSearch('');
  };

  const removeFeat = (featName) => {
    updateChar({ feats: (char.feats || []).filter(f => f !== featName) });
  };

  const addCondition = (conditionName) => {
    const conditions = char.conditions || [];
    if (!conditions.includes(conditionName)) {
      updateChar({ conditions: [...conditions, conditionName] });
    }
    setShowConditionPicker(false);
    setConditionSearch('');
  };

  const removeCondition = (conditionName) => {
    updateChar({ conditions: (char.conditions || []).filter(c => c !== conditionName) });
  };

  const addSpell = (spellName) => {
    if (isPreparedCaster) {
      const known = char.spellsKnown || [];
      if (!known.includes(spellName)) {
        updateChar({ spellsKnown: [...known, spellName] });
      }
    } else {
      const known = char.spellsKnown || [];
      if (!known.includes(spellName)) {
        updateChar({ spellsKnown: [...known, spellName] });
      }
    }
    setShowSpellPicker(false);
    setSpellSearch('');
  };

  const removeSpell = (spellName) => {
    const isKnown = isPreparedCaster ? 'spellsKnown' : 'spellsKnown';
    updateChar({ [isKnown]: (char[isKnown] || []).filter(s => s !== spellName) });
  };

  const addItem = (item) => {
    const inv = char.inventory || [];
    const existing = inv.find(i => i.name === item.name);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
      updateChar({ inventory: [...inv] });
    } else {
      updateChar({ inventory: [...inv, { ...item, quantity: 1 }] });
    }
    setShowItemPicker(false);
    setItemSearch('');
  };

  const removeItem = (index) => {
    const inv = char.inventory || [];
    updateChar({ inventory: inv.filter((_, i) => i !== index) });
  };

  const updateItemQuantity = (index, delta) => {
    const inv = char.inventory || [];
    const newQty = Math.max(0, (inv[index]?.quantity || 1) + delta);
    if (newQty === 0) {
      removeItem(index);
    } else {
      inv[index].quantity = newQty;
      updateChar({ inventory: [...inv] });
    }
  };

  const getFeatSlots = () => {
    const base = 1 + Math.floor((char.level - 1) / 2);
    const human = char.race === 'Human' ? 1 : 0;
    const fighter = className === 'Fighter' ? Math.floor(char.level / 2) : 0;
    return { total: base + human + fighter, used: (char.feats || []).length };
  };

  const getConditionSeverity = (condName) => {
    const severe = ['Dead', 'Dying', 'Unconscious', 'Paralyzed', 'Petrified', 'Helpless', 'Poisoned', 'Diseased', 'Cursed', 'Ability Drained'];
    const moderate = ['Blinded', 'Deafened', 'Confused', 'Nauseated', 'Stunned', 'Energy Drained'];
    if (severe.includes(condName)) return 'severe';
    if (moderate.includes(condName)) return 'moderate';
    return 'minor';
  };

  const renderStats = () => {
    const bab = calcBAB(className, char.level, classesMap);
    const cmb = bab + abilityMods.STR + (char.size === 'Small' ? -1 : char.size === 'Large' ? 1 : 0);
    const cmd = 10 + bab + abilityMods.STR + abilityMods.DEX + (char.size === 'Small' ? -1 : char.size === 'Large' ? 1 : 0);

    const fortSave = calcSave('fort', className, char.level, classesMap) + abilityMods.CON;
    const refSave = calcSave('ref', className, char.level, classesMap) + abilityMods.DEX;
    const willSave = calcSave('will', className, char.level, classesMap) + abilityMods.WIS;

    // Iterative attacks
    const iterativeAttacks = [];
    for (let i = 0; i < bab; i += 5) {
      if (i === 0) iterativeAttacks.push(bab);
      else iterativeAttacks.push(bab - i);
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Abilities Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '15px' }}>
          {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
            <div key={ability} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
              <div style={{ color: '#ffd700', fontSize: isMobile ? '11px' : '12px', marginBottom: '4px' }}>{ability}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <button
                  onClick={() => updateAbility(ability, -1)}
                  style={{ padding: '2px 6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', fontSize: isMobile ? '11px' : '10px', minHeight: '24px', minWidth: '24px' }}
                >
                  -
                </button>
                <div style={{ color: '#d4c5a9', fontSize: '20px', fontWeight: 'bold', minWidth: '40px', textAlign: 'center' }}>
                  {char.abilities?.[ability] || 10}
                </div>
                <button
                  onClick={() => updateAbility(ability, 1)}
                  style={{ padding: '2px 6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', fontSize: isMobile ? '11px' : '10px', minHeight: '24px', minWidth: '24px' }}
                >
                  +
                </button>
              </div>
              <div style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '12px' }}>
                ({modStr(abilityMods[ability])})
              </div>
            </div>
          ))}
        </div>

        {/* HP Bar */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Hit Points</div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              value={char.currentHP || 0}
              onChange={(e) => updateChar({ currentHP: parseInt(e.target.value) || 0 })}
              style={{ width: '60px', padding: '6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
            />
            <div style={{ color: '#d4c5a9' }}>/ {char.maxHP || 0}</div>
            <div style={{ flex: 1, height: '24px', background: '#1a1a2e', border: '1px solid #ffd700', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${((char.currentHP || 0) / (char.maxHP || 1)) * 100}%`,
                  background: (char.currentHP || 0) > (char.maxHP || 0) * 0.5 ? '#4caf50' : '#ff9800',
                  transition: 'width 0.3s'
                }}
              />
            </div>
          </div>
        </div>

        {/* AC Section */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Armor Class</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>Total</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{acData?.total || 10}</div>
            </div>
            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>Touch</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{acData?.touch || 10}</div>
            </div>
            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>Flat-Footed</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{acData?.flatFooted || 10}</div>
            </div>
          </div>
          <details style={{ color: '#8b949e', fontSize: '12px' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>AC Breakdown (Editable)</summary>
            <div style={{ paddingLeft: '12px', color: '#d4c5a9', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>Armor: +{acData?.armor || 0}</div>
              <div>Shield: +{acData?.shield || 0}</div>
              <div>DEX: +{acData?.dex || 0}</div>
              <div>Size: {acData?.size > 0 ? '+' : ''}{acData?.size || 0}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Natural: +</span>
                <input
                  type="number"
                  value={char.naturalArmor || 0}
                  onChange={(e) => updateChar({ naturalArmor: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Deflection: +</span>
                <input
                  type="number"
                  value={char.deflectionBonus || 0}
                  onChange={(e) => updateChar({ deflectionBonus: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Dodge: +</span>
                <input
                  type="number"
                  value={char.dodgeBonus || 0}
                  onChange={(e) => updateChar({ dodgeBonus: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Misc: </span>
                <input
                  type="number"
                  value={char.miscACBonus || 0}
                  onChange={(e) => updateChar({ miscACBonus: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
            </div>
          </details>
        </div>

        {/* Combat Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>BAB</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(bab)}</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>Initiative</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(abilityMods.DEX)}</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>CMB</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(cmb)}</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>CMD</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(cmd)}</div>
          </div>
        </div>

        {/* Iterative Attacks */}
        {iterativeAttacks.length > 0 && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '8px' }}>Iterative Attacks</div>
            <div style={{ color: '#d4c5a9', fontSize: '14px', fontFamily: 'monospace' }}>
              {iterativeAttacks.map((atk, i) => modStr(atk)).join(' / ')}
            </div>
          </div>
        )}

        {/* Saves */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(1, 1fr)' : 'repeat(3, 1fr)', gap: '12px' }}>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '4px' }}>Fortitude</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(fortSave)}</div>
            <details style={{ marginTop: '8px' }}>
              <summary style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '10px', cursor: 'pointer' }}>Details</summary>
              <div style={{ fontSize: isMobile ? '11px' : '10px', color: '#8b949e', paddingLeft: '8px', marginTop: '4px' }}>
                <div>Base: +{calcSave('fort', className, char.level, classesMap)}</div>
                <div>CON: {modStr(abilityMods.CON)}</div>
              </div>
            </details>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '4px' }}>Reflex</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(refSave)}</div>
            <details style={{ marginTop: '8px' }}>
              <summary style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '10px', cursor: 'pointer' }}>Details</summary>
              <div style={{ fontSize: isMobile ? '11px' : '10px', color: '#8b949e', paddingLeft: '8px', marginTop: '4px' }}>
                <div>Base: +{calcSave('ref', className, char.level, classesMap)}</div>
                <div>DEX: {modStr(abilityMods.DEX)}</div>
              </div>
            </details>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '4px' }}>Will</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(willSave)}</div>
            <details style={{ marginTop: '8px' }}>
              <summary style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '10px', cursor: 'pointer' }}>Details</summary>
              <div style={{ fontSize: isMobile ? '11px' : '10px', color: '#8b949e', paddingLeft: '8px', marginTop: '4px' }}>
                <div>Base: +{calcSave('will', className, char.level, classesMap)}</div>
                <div>WIS: {modStr(abilityMods.WIS)}</div>
              </div>
            </details>
          </div>
        </div>

        {/* Speed and Size */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>Speed</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{char.speed || 30} ft.</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>Size</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{char.size || 'Medium'}</div>
          </div>
        </div>

        {/* Attacks */}
        {char.weapons && char.weapons.length > 0 && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '12px' }}>Attacks</div>
            {char.weapons.map((weapon, idx) => {
              const strMod = abilityMods.STR;
              const dexMod = abilityMods.DEX;
              const atkBonus = bab + (weapon.isFinesse ? Math.max(strMod, dexMod) : strMod);
              return (
                <div key={idx} style={{ marginBottom: '8px', color: '#d4c5a9' }}>
                  <div>{weapon.name}: {modStr(atkBonus)} ({weapon.dmg})</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Class Features */}
        {classData?.classFeatures && classData.classFeatures.length > 0 && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '12px' }}>Class Features</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {classData.classFeatures.filter(f => f.level <= char.level).map((feature, idx) => (
                <div key={idx} style={{ background: '#1a1a2e', padding: '8px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px' }}>
                  <div style={{ color: '#ffd700', fontSize: '12px' }}>{feature.name}</div>
                  <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '4px' }}>Level {feature.level}</div>
                  {feature.description && (
                    <div style={{ color: '#d4c5a9', fontSize: '11px', marginTop: '4px' }}>{feature.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSkills = () => {
    const skills = skillsData || [];
    const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div>
        <div style={{ color: '#ffd700', marginBottom: '12px' }}>
          Skill Points: {skillPointsInfo.available} available ({skillPointsInfo.used} used)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: '#d4c5a9' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(255,215,0,0.3)' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#ffd700' }}>Skill</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Ability</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Total</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Ranks</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Class?</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Misc</th>
              </tr>
            </thead>
            <tbody>
              {sortedSkills.map((skill, idx) => {
                const ranks = char.skillRanks?.[skill.name] || 0;
                const abilityMod = abilityMods[skill.ability] || 0;
                const isClassSkill = classSkills.includes(skill.name);
                const classBonus = isClassSkill && ranks > 0 ? 3 : 0;
                const acp = skill.armorPenalty ? armorCheckPenalty : 0;
                const total = abilityMod + ranks + classBonus + acp;
                const miscMod = char.skillBonuses?.[skill.name] || 0;

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,215,0,0.1)' }}>
                    <td style={{ padding: '8px' }}>{skill.name}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{skill.ability}</td>
                    <td style={{ textAlign: 'center', padding: '8px', fontWeight: 'bold' }}>{modStr(total + miscMod)}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                        <button
                          onClick={() => updateSkillRank(skill.name, -1)}
                          style={{
                            padding: '2px 6px',
                            background: '#1a1a2e',
                            border: '1px solid #ffd700',
                            color: '#ffd700',
                            cursor: 'pointer'
                          }}
                        >
                          -
                        </button>
                        <span style={{ minWidth: '20px', textAlign: 'center' }}>{ranks}</span>
                        <button
                          onClick={() => updateSkillRank(skill.name, 1)}
                          style={{
                            padding: '2px 6px',
                            background: '#1a1a2e',
                            border: '1px solid #ffd700',
                            color: '#ffd700',
                            cursor: 'pointer'
                          }}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{isClassSkill ? 'Yes' : '-'}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{miscMod > 0 ? '+' : ''}{miscMod}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {armorCheckPenalty !== 0 && (
          <div style={{ marginTop: '12px', color: '#ff9800', fontSize: '12px' }}>
            Armor Check Penalty: {modStr(armorCheckPenalty)}
          </div>
        )}
      </div>
    );
  };

  const renderFeats = () => {
    const feats = featsData || [];
    const slots = getFeatSlots();
    const filteredFeats = feats.filter(f => f.name.toLowerCase().includes(featSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>
            Feat Slots: {slots.used} / {slots.total}
          </div>
          <button
            onClick={() => setShowFeatPicker(!showFeatPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Add Feat
          </button>
        </div>

        {showFeatPicker && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <input
              type="text"
              placeholder="Search feats..."
              value={featSearch}
              onChange={(e) => setFeatSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a2e',
                border: '1px solid #ffd700',
                color: '#d4c5a9',
                marginBottom: '12px',
                borderRadius: '4px'
              }}
            />
            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredFeats.slice(0, 20).map((feat, idx) => (
                <button
                  key={idx}
                  onClick={() => addFeat(feat.name)}
                  disabled={(char.feats || []).includes(feat.name)}
                  style={{
                    padding: '8px',
                    background: (char.feats || []).includes(feat.name) ? '#555' : '#1a1a2e',
                    border: '1px solid rgba(255,215,0,0.3)',
                    color: (char.feats || []).includes(feat.name) ? '#888' : '#d4c5a9',
                    cursor: (char.feats || []).includes(feat.name) ? 'default' : 'pointer',
                    textAlign: 'left',
                    borderRadius: '4px'
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{feat.name}</div>
                  {feat.prerequisites && (
                    <div style={{ fontSize: '11px', color: '#8b949e' }}>Prereq: {feat.prerequisites}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {char.feats?.map((featName, idx) => {
            const featData = feats.find(f => f.name === featName);
            return (
              <div key={idx} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ color: '#ffd700' }}>{featName}</div>
                  <button
                    onClick={() => removeFeat(featName)}
                    style={{
                      padding: '4px 8px',
                      background: '#8b5a00',
                      border: '1px solid #ffd700',
                      color: '#ffd700',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    Remove
                  </button>
                </div>
                {featData?.prerequisites && (
                  <div style={{ color: '#8b949e', fontSize: '11px', marginBottom: '4px' }}>
                    Prerequisites: {featData.prerequisites}
                  </div>
                )}
                {featData?.benefit && (
                  <div style={{ color: '#d4c5a9', fontSize: '12px' }}>{featData.benefit}</div>
                )}
              </div>
            );
          })}
          {(!char.feats || char.feats.length === 0) && (
            <div style={{ color: '#8b949e' }}>No feats selected.</div>
          )}
        </div>
      </div>
    );
  };

  const renderSpells = () => {
    if (!isSpellcaster) {
      return <div style={{ color: '#8b949e' }}>{className} is not a spellcasting class.</div>;
    }

    const castingAbility = spellSlotData?.castingAbility?.[className];
    const castingType = spellSlotData?.castingType?.[className];
    const spells = spellsData || [];
    const filteredSpells = spells.filter(s => s.name.toLowerCase().includes(spellSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Casting Ability: {castingAbility}</div>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Type: {castingType}</div>
          <button
            onClick={restSpells}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '2px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Rest & Recover Spells
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
          {Object.entries(spellSlots).map(([level, max]) => {
            const used = char.spellSlotsUsed?.[level] || 0;
            return (
              <div key={level} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
                <div style={{ color: '#ffd700', marginBottom: '8px' }}>Level {level}</div>
                <div style={{ color: '#d4c5a9', marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }}>
                  {used} / {max}
                </div>
                <button
                  onClick={() => castSpell(level)}
                  disabled={used >= max}
                  style={{
                    width: '100%',
                    padding: '6px',
                    background: used >= max ? '#555' : '#1a1a2e',
                    border: '1px solid #ffd700',
                    color: used >= max ? '#888' : '#ffd700',
                    cursor: used >= max ? 'default' : 'pointer',
                    borderRadius: '4px'
                  }}
                >
                  Cast
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Add Spell Known</div>
          <button
            onClick={() => setShowSpellPicker(!showSpellPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px',
              marginBottom: '12px'
            }}
          >
            Browse Spells
          </button>

          {showSpellPicker && (
            <div style={{ background: '#1a1a2e', padding: '12px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Search spells..."
                value={spellSearch}
                onChange={(e) => setSpellSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#2a2a4e',
                  border: '1px solid #ffd700',
                  color: '#d4c5a9',
                  marginBottom: '12px',
                  borderRadius: '4px'
                }}
              />
              <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredSpells.slice(0, 20).map((spell, idx) => (
                  <button
                    key={idx}
                    onClick={() => addSpell(spell.name)}
                    disabled={(char.spellsKnown || []).includes(spell.name)}
                    style={{
                      padding: '8px',
                      background: (char.spellsKnown || []).includes(spell.name) ? '#555' : '#2a2a4e',
                      border: '1px solid rgba(255,215,0,0.3)',
                      color: (char.spellsKnown || []).includes(spell.name) ? '#888' : '#d4c5a9',
                      cursor: (char.spellsKnown || []).includes(spell.name) ? 'default' : 'pointer',
                      textAlign: 'left',
                      borderRadius: '4px'
                    }}
                  >
                    {spell.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>
            {castingType === 'prepared' ? 'Spells Prepared' : 'Spells Known'}
          </div>
          {(char.spellsKnown || [])?.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(1, 1fr)' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
              {(char.spellsKnown || []).map((spellName, idx) => (
                <div key={idx} style={{ background: '#1a1a2e', padding: '8px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', color: '#d4c5a9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{spellName}</span>
                  <button
                    onClick={() => removeSpell(spellName)}
                    style={{ padding: '2px 6px', background: '#8b5a00', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', fontSize: isMobile ? '11px' : '10px', borderRadius: '2px', minHeight: '24px', minWidth: '24px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#8b949e' }}>None selected.</div>
          )}
        </div>
      </div>
    );
  };

  const renderInventory = () => {
    const equipped = char.equipped || {};
    const inventory = char.inventory || [];
    const gold = char.gold || 0;
    const allItems = [...gearData, ...magicItemsData];
    const filteredItems = allItems.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Equipment Slots */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Equipment</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            {EQUIPMENT_SLOTS?.map(slot => {
              const item = equipped[slot.id];
              return (
                <div key={slot.id} style={{ background: '#1a1a2e', padding: '12px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px' }}>
                  <div style={{ color: '#ffd700', fontSize: '12px', marginBottom: '4px' }}>{slot.label}</div>
                  <div style={{ color: '#d4c5a9' }}>{item?.name || '-'}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Gold */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Gold</div>
          <input
            type="number"
            value={gold}
            onChange={(e) => updateChar({ gold: parseInt(e.target.value) || 0 })}
            style={{ padding: '6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9', width: '100px' }}
          />
          <span style={{ color: '#d4c5a9', marginLeft: '8px' }}>gp</span>
        </div>

        {/* Encumbrance */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Encumbrance</div>
          <div style={{ color: '#d4c5a9', marginBottom: '8px' }}>
            Total Weight: {totalWeight} / {carryingCapacity?.heavy || 0} lbs
          </div>
          <div style={{ background: '#1a1a2e', height: '24px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #ffd700', marginBottom: '8px' }}>
            <div
              style={{
                height: '100%',
                width: `${(totalWeight / (carryingCapacity?.heavy || 1)) * 100}%`,
                background: encumbranceLevel === 'light' ? '#4caf50' : encumbranceLevel === 'medium' ? '#ff9800' : '#f44336'
              }}
            />
          </div>
          <div style={{ color: encumbranceLevel === 'light' ? '#4caf50' : encumbranceLevel === 'medium' ? '#ff9800' : '#f44336', marginBottom: '8px' }}>
            Status: {encumbranceLevel?.toUpperCase()}
          </div>
          {encumbranceEffects && encumbranceLevel !== 'light' && (
            <div style={{ color: '#8b949e', fontSize: '12px' }}>
              Max DEX: +{encumbranceEffects.maxDex} | Check Penalty: {encumbranceEffects.checkPenalty} | Run: x{encumbranceEffects.runMult}
            </div>
          )}
        </div>

        {/* Add Item */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Add Item</div>
          <button
            onClick={() => setShowItemPicker(!showItemPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Browse Items
          </button>

          {showItemPicker && (
            <div style={{ background: '#1a1a2e', padding: '12px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', marginTop: '12px' }}>
              <input
                type="text"
                placeholder="Search items..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#2a2a4e',
                  border: '1px solid #ffd700',
                  color: '#d4c5a9',
                  marginBottom: '12px',
                  borderRadius: '4px'
                }}
              />
              <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredItems.slice(0, 25).map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => addItem(item)}
                    style={{
                      padding: '8px',
                      background: '#2a2a4e',
                      border: '1px solid rgba(255,215,0,0.3)',
                      color: '#d4c5a9',
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderRadius: '4px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                    <div style={{ fontSize: '11px', color: '#8b949e' }}>{item.price || '-'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Backpack */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Backpack</div>
          {inventory.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {inventory.map((item, idx) => (
                <div key={idx} style={{ background: '#1a1a2e', padding: '8px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', color: '#d4c5a9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div>{item.name}</div>
                    <div style={{ color: '#8b949e', fontSize: '11px' }}>
                      {item.weight || 0} lbs | x<input
                        type="number"
                        value={item.quantity || 1}
                        onChange={(e) => {
                          const inv = [...inventory];
                          inv[idx].quantity = parseInt(e.target.value) || 1;
                          updateChar({ inventory: inv });
                        }}
                        style={{ width: '30px', padding: '2px', background: '#2a2a4e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    style={{ padding: '4px 8px', background: '#8b5a00', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', borderRadius: '4px', fontSize: '11px' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#8b949e' }}>Empty</div>
          )}
        </div>
      </div>
    );
  };

  const renderConditions = () => {
    const filteredConditions = conditionsData.filter(c => c.name.toLowerCase().includes(conditionSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <button
            onClick={() => setShowConditionPicker(!showConditionPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Add Condition
          </button>
        </div>

        {showConditionPicker && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <input
              type="text"
              placeholder="Search conditions..."
              value={conditionSearch}
              onChange={(e) => setConditionSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a2e',
                border: '1px solid #ffd700',
                color: '#d4c5a9',
                marginBottom: '12px',
                borderRadius: '4px'
              }}
            />
            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredConditions.map((condition, idx) => (
                <button
                  key={idx}
                  onClick={() => addCondition(condition.name)}
                  disabled={(char.conditions || []).includes(condition.name)}
                  style={{
                    padding: '8px',
                    background: (char.conditions || []).includes(condition.name) ? '#555' : '#1a1a2e',
                    border: '1px solid rgba(255,215,0,0.3)',
                    color: (char.conditions || []).includes(condition.name) ? '#888' : '#d4c5a9',
                    cursor: (char.conditions || []).includes(condition.name) ? 'default' : 'pointer',
                    textAlign: 'left',
                    borderRadius: '4px'
                  }}
                >
                  {condition.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {char.conditions?.map((condName, idx) => {
            const condData = conditionsData.find(c => c.name === condName);
            const severity = getConditionSeverity(condName);
            const severityColor = severity === 'severe' ? '#f44336' : severity === 'moderate' ? '#ff9800' : '#ffeb3b';

            return (
              <div key={idx} style={{ background: '#2a2a4e', padding: '12px', border: `2px solid ${severityColor}`, borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ color: severityColor, fontWeight: 'bold' }}>{condName}</div>
                  <button
                    onClick={() => removeCondition(condName)}
                    style={{
                      padding: '4px 8px',
                      background: '#8b5a00',
                      border: '1px solid #ffd700',
                      color: '#ffd700',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    Remove
                  </button>
                </div>
                {condData?.description && (
                  <div style={{ color: '#d4c5a9', fontSize: '12px' }}>{condData.description}</div>
                )}
              </div>
            );
          })}
          {(!char.conditions || char.conditions.length === 0) && (
            <div style={{ color: '#8b949e' }}>No active conditions.</div>
          )}
        </div>
      </div>
    );
  };

  const renderNotes = () => {
    return (
      <div>
        {/* Backstory section */}
        {char.backstory && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '14px', color: '#9382dc', fontWeight: 'bold', marginBottom: '8px' }}>Backstory</div>
            <div style={{
              padding: '12px',
              background: 'rgba(147,130,220,0.08)',
              borderLeft: '3px solid #9382dc',
              borderRadius: '4px',
              color: '#c4b998',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}>
              {char.backstory}
            </div>
          </div>
        )}
        {char.personality && (
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#a0926b', fontStyle: 'italic' }}>
            <strong style={{ color: '#ffd700' }}>Personality:</strong> {char.personality}
          </div>
        )}
        {char.appearance && (
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#a0926b', fontStyle: 'italic' }}>
            <strong style={{ color: '#ffd700' }}>Appearance:</strong> {char.appearance}
          </div>
        )}
        <div style={{ fontSize: '14px', color: '#ffd700', fontWeight: 'bold', marginBottom: '8px' }}>Notes</div>
        <textarea
          value={char.notes || ''}
          onChange={(e) => updateChar({ notes: e.target.value })}
          style={{
            width: '100%',
            height: char.backstory ? '250px' : '400px',
            padding: '12px',
            background: '#1a1a2e',
            border: '1px solid #ffd700',
            color: '#d4c5a9',
            fontFamily: 'monospace',
            borderRadius: '4px',
            resize: 'vertical'
          }}
          placeholder="Add character notes..."
        />
      </div>
    );
  };

  const tabContent = {
    Stats: renderStats(),
    Skills: renderSkills(),
    Feats: renderFeats(),
    Spells: renderSpells(),
    Inventory: renderInventory(),
    Conditions: renderConditions(),
    Notes: renderNotes(),
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: isMobile ? 0 : '20px'
    }}>
      <div style={{
        maxWidth: isMobile ? 'none' : '900px',
        maxHeight: isMobile ? '100%' : '90vh',
        width: isMobile ? '100%' : '100%',
        height: isMobile ? '100%' : 'auto',
        margin: isMobile ? 0 : undefined,
        background: '#1a1a2e',
        border: '2px solid #ffd700',
        borderRadius: isMobile ? 0 : '8px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: isMobile ? '12px' : '20px',
          borderBottom: '2px solid rgba(255,215,0,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          gap: isMobile ? '8px' : '0'
        }}>
          <div>
            <h2 style={{ color: '#ffd700', margin: 0, marginBottom: '4px', fontSize: isMobile ? '16px' : '20px' }}>{char.name}</h2>
            <div style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '12px' }}>
              Level {char.level} {char.race} {className}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: '#8b5a00',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px',
              minHeight: '44px',
              minWidth: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,215,0,0.2)',
          flexShrink: 0,
          overflowX: isMobile ? 'auto' : 'visible',
          flexWrap: isMobile ? 'nowrap' : 'wrap'
        }}>
          {['Stats', 'Skills', 'Feats', 'Spells', 'Inventory', 'Conditions', 'Notes'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: isMobile ? '10px 12px' : '12px 20px',
                background: activeTab === tab ? '#2a2a4e' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #ffd700' : '2px solid transparent',
                color: activeTab === tab ? '#ffd700' : '#8b949e',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                fontSize: isMobile ? '12px' : '14px'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          padding: isMobile ? '12px' : '20px',
          overflowY: 'auto',
          flex: 1
        }}>
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  );
};

export default CharacterSheet;
