import React, { useState } from 'react';
import { mod, getMaxHP } from '../utils/dice';
import { getStartingGold } from '../utils/character';
import { generateBackstory } from '../services/aiCharacterBuilder';

const portraitEmojis = {
  axes: '⚒️',
  dagger: '🗡️',
  staff: '🔮',
  cross: '✨',
  bow: '🏹',
  sword: '⚔️',
  shield: '🛡️',
  lute: '🎵',
  sparkle: '✨',
  leaf: '🌿',
};

export default function TemplateSelector({
  onSelect,
  onCancel,
  templates = [],
  races = [],
  classesMap = {},
  armorList = [],
  shields = [],
  weapons = [],
}) {
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [generatingBackstory, setGeneratingBackstory] = useState(null); // template name
  const [backstories, setBackstories] = useState({}); // { templateName: backstoryText }

  const findEquipment = (name, list) => {
    return list.find((item) => item.name === name) || { name };
  };

  const buildCharFromTemplate = (template) => {
    const armor = findEquipment(template.armorName, armorList);
    const shield = findEquipment(template.shieldName, shields);
    const weaponList = template.weaponNames.map((name) =>
      findEquipment(name, weapons)
    );

    const conMod = mod(template.abilities.CON);
    const maxHp = getMaxHP(template.class, 1, conMod, classesMap);

    // Calculate proper AC with armor and shield
    const dexMod = mod(template.abilities.DEX);
    const effectiveDex = Math.min(dexMod, armor.maxDex ?? 99);
    const totalAC = 10 + effectiveDex + (armor.ac || 0) + (shield.ac || 0);

    // Build equipment list from weapons + armor + shield for the inventory display
    const equipment = [];
    weaponList.forEach(w => equipment.push({ name: w.name || w, equipped: true, type: 'weapon' }));
    if (armor.name && armor.name !== 'None') equipment.push({ name: armor.name, equipped: true, type: 'armor' });
    if (shield.name && shield.name !== 'None') equipment.push({ name: shield.name, equipped: true, type: 'shield' });

    // Add adventuring gear from template inventory
    const gearInventory = (template.inventory || []).map(item => ({
      name: typeof item === 'string' ? item : item.name,
      quantity: typeof item === 'string' ? 1 : (item.quantity || 1),
      type: 'gear',
    }));

    return {
      id: Math.random().toString(36).slice(2, 9),
      name: template.name,
      race: template.race,
      class: template.class,
      alignment: template.alignment,
      level: 1,
      xp: 0,
      abilities: template.abilities,
      feats: template.feats || [],
      weapons: weaponList,
      armor: armor.name,
      shield: shield.name,
      conditions: [],
      equipment,
      inventory: gearInventory,
      maxHP: maxHp,
      currentHP: maxHp,
      ac: totalAC,
      gold: getStartingGold(template.class),
      skillRanks: template.skillRanks || {},
      spellsKnown: template.spellsKnown || [],
      spellsPrepared: template.spellsPrepared || [],
      spellSlotsUsed: {},
      equipped: {},
      notes: '',
      // Extra class flavor fields
      ...(template.domains ? { domains: template.domains } : {}),
      ...(template.bloodline ? { bloodline: template.bloodline } : {}),
      ...(template.favoredEnemy ? { favoredEnemy: template.favoredEnemy } : {}),
      ...(template.animalCompanion ? { animalCompanion: template.animalCompanion } : {}),
      backstory: backstories[template.name] || '',
    };
  };

  const handleGenerateTemplateBackstory = async (template) => {
    setGeneratingBackstory(template.name);
    try {
      const backstory = await generateBackstory({
        name: template.name,
        race: template.race,
        class: template.class,
        alignment: template.alignment,
        desc: template.desc,
        roleTip: template.roleTip,
      });
      if (backstory) {
        setBackstories(prev => ({ ...prev, [template.name]: backstory }));
      }
    } catch (err) {
      console.warn('Backstory generation failed:', err);
    } finally {
      setGeneratingBackstory(null);
    }
  };

  const styles = {
    container: {
      backgroundColor: '#1a1a2e',
      border: '2px solid #ffd700',
      borderRadius: '8px',
      padding: '16px',
      color: '#d4c5a9',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
    },
    title: {
      color: '#ffd700',
      fontSize: '18px',
      fontWeight: 'bold',
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: '12px',
    },
    card: {
      backgroundColor: '#2a2a4e',
      border: '2px solid #ffd700',
      borderRadius: '4px',
      padding: '12px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    cardSelected: {
      borderColor: '#fff',
      backgroundColor: '#3a3a6e',
    },
    portrait: {
      fontSize: '32px',
      textAlign: 'center',
      marginBottom: '8px',
    },
    name: {
      color: '#ffd700',
      fontWeight: 'bold',
      marginBottom: '4px',
      fontSize: '13px',
    },
    stat: {
      fontSize: '11px',
      color: '#b0b0b0',
      marginBottom: '2px',
    },
    buttonRow: {
      display: 'flex',
      gap: '8px',
      marginTop: '12px',
    },
    button: {
      flex: 1,
      padding: '8px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
    },
    expandedSection: {
      marginTop: '12px',
      padding: '12px',
      backgroundColor: '#1a1a2e',
      borderRadius: '4px',
      fontSize: '12px',
      color: '#d4c5a9',
    },
    detail: {
      marginBottom: '8px',
      lineHeight: '1.4',
    },
    detailLabel: {
      color: '#ffd700',
      fontWeight: 'bold',
    },
    roleTip: {
      marginTop: '8px',
      padding: '8px',
      backgroundColor: '#3a3a6e',
      borderLeft: '3px solid #40e0d0',
      fontSize: '11px',
      color: '#40e0d0',
      fontStyle: 'italic',
    },
    footer: {
      display: 'flex',
      gap: '8px',
      marginTop: '16px',
      paddingTop: '16px',
      borderTop: '1px solid rgba(255, 215, 0, 0.2)',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>Select Template</div>
        <button style={{ ...styles.button, width: '80px' }} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div style={styles.grid}>
        {templates.map((template) => (
          <div
            key={template.name}
            style={{
              ...styles.card,
              ...(expanded === template.name ? styles.cardSelected : {}),
            }}
            onClick={() => setExpanded(expanded === template.name ? null : template.name)}
          >
            <div style={styles.portrait}>
              {portraitEmojis[template.portrait] || '🧙'}
            </div>
            <div style={styles.name}>{template.name}</div>
            <div style={styles.stat}>{template.race}</div>
            <div style={styles.stat}>{template.class}</div>
            <div style={{ ...styles.stat, color: '#ffd700', marginTop: '4px' }}>
              HP: {getMaxHP(template.class, 1, mod(template.abilities.CON), classesMap)} AC:{' '}
              {10 + mod(template.abilities.DEX)}
            </div>

            {expanded === template.name && (
              <div style={styles.expandedSection}>
                <div style={styles.detail}>
                  <span style={styles.detailLabel}>Alignment:</span> {template.alignment}
                </div>
                <div style={styles.detail}>
                  <span style={styles.detailLabel}>Abilities:</span> STR {template.abilities.STR}{' '}
                  DEX {template.abilities.DEX} CON {template.abilities.CON} INT{' '}
                  {template.abilities.INT} WIS {template.abilities.WIS} CHA{' '}
                  {template.abilities.CHA}
                </div>
                {template.feats && template.feats.length > 0 && (
                  <div style={styles.detail}>
                    <span style={styles.detailLabel}>Feats:</span> {template.feats.join(', ')}
                  </div>
                )}
                <div style={styles.detail}>
                  <span style={styles.detailLabel}>Weapons:</span> {template.weaponNames.join(', ')}
                </div>
                <div style={styles.detail}>
                  <span style={styles.detailLabel}>Armor:</span> {template.armorName}
                </div>
                {template.desc && (
                  <div style={styles.detail}>
                    <span style={styles.detailLabel}>Description:</span>
                    <br />
                    {template.desc}
                  </div>
                )}
                {template.roleTip && (
                  <div style={styles.roleTip}>{template.roleTip}</div>
                )}

                {/* Backstory section */}
                {backstories[template.name] ? (
                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(147,130,220,0.1)', borderLeft: '3px solid #9382dc', borderRadius: '2px' }}>
                    <div style={{ fontSize: '11px', color: '#9382dc', fontWeight: 'bold', marginBottom: '4px' }}>Backstory</div>
                    <div style={{ fontSize: '11px', color: '#c4b998', lineHeight: '1.5', maxHeight: '120px', overflowY: 'auto' }}>{backstories[template.name]}</div>
                  </div>
                ) : (
                  <button
                    style={{ ...styles.button, marginTop: '8px', borderColor: '#9382dc', color: '#9382dc', backgroundColor: 'transparent', width: '100%', opacity: generatingBackstory === template.name ? 0.6 : 1 }}
                    onClick={(e) => { e.stopPropagation(); handleGenerateTemplateBackstory(template); }}
                    disabled={generatingBackstory === template.name}
                  >
                    {generatingBackstory === template.name ? 'Generating backstory...' : 'Generate Backstory'}
                  </button>
                )}

                <div style={styles.buttonRow}>
                  <button
                    style={styles.button}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(buildCharFromTemplate(template));
                    }}
                  >
                    Add to Party
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
