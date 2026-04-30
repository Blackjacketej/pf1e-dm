import React, { useState, useMemo } from 'react';
import { mod, getMaxHP } from '../utils/dice';
import { getStartingGold } from '../utils/character';
import { validateFeatList } from '../utils/featPrereqs';
import { hydrateGearItem } from '../utils/gearHydrate';
import gearData from '../data/gear.json';
import equipmentData from '../data/equipment.json';
// Bug #2: template characters ship with a fixed, pre-written backstory in
// data/templates.json. No AI generation is offered here — the pregens are the
// canonical source.
// Bug #52: gearInventory is hydrated via hydrateGearItem so each backpack
// row carries weight (number), price, description, and category — not just
// a bare name. Without this, every row rendered as "0 lbs" with no tooltip.

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
  feats = [],
}) {
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState(null);

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

    // Add adventuring gear from template inventory.
    // Bug #52: hydrate each entry against gear.json + equipment.json so
    // weight/price/description/category flow through to the backpack UI.
    // parseQuantityFromName inside hydrateGearItem handles "Trail rations (5)"
    // → { name: "Trail rations", quantity: 5 }; "Rope (50 ft.)" stays one
    // entry at qty 1 because "50 ft." isn't a pure integer.
    const gearInventory = (template.inventory || []).map(item =>
      hydrateGearItem(item, gearData, equipmentData)
    );

    // Validate template feats against prerequisites
    const tempCharForFeats = {
      race: template.race,
      class: template.class,
      level: 1,
      abilities: template.abilities,
      skillRanks: template.skillRanks || {},
      feats: [],
    };
    const { valid: validFeats, invalid: invalidFeats } = validateFeatList(template.feats || [], tempCharForFeats, feats);
    if (invalidFeats.length > 0) {
      console.warn(`Template "${template.name}" had invalid feats removed:`, invalidFeats.map(f => `${f.name} (missing: ${f.missing.join(', ')})`));
    }

    return {
      id: Math.random().toString(36).slice(2, 9),
      name: template.name,
      race: template.race,
      class: template.class,
      alignment: template.alignment,
      level: 1,
      xp: 0,
      abilities: template.abilities,
      feats: validFeats,
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
      heritage: template.heritage || '',
      characterTraits: template.characterTraits || [],
      drawback: template.drawback || '',
      personality: template.personality || '',
      appearance: template.appearance || '',
      ethnicity: template.ethnicity || template.race,
      origin: template.origin || '',
      languages: template.languages || ['Common'],
      notes: '',
      // Extra class flavor fields
      ...(template.domains ? { domains: template.domains } : {}),
      ...(template.bloodline ? { bloodline: template.bloodline } : {}),
      ...(template.favoredEnemy ? { favoredEnemy: template.favoredEnemy } : {}),
      ...(template.animalCompanion ? { animalCompanion: template.animalCompanion } : {}),
      // Bug #2: always use the fixed pregen backstory; no AI regeneration path.
      backstory: template.backstory || '',
    };
  };

  // Bug #2: handleGenerateTemplateBackstory removed — templates are fixed.

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
                {(template.ethnicity || template.origin) && (
                  <div style={styles.detail}>
                    <span style={styles.detailLabel}>Origin:</span>{' '}
                    {template.ethnicity && template.ethnicity !== template.race ? `${template.ethnicity}, ` : ''}
                    {template.origin || 'Unknown'}
                    {template.languages?.length > 1 && ` (speaks ${template.languages.join(', ')})`}
                  </div>
                )}
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
                {template.heritage && template.heritage !== `Standard ${template.race}` && (
                  <div style={styles.detail}>
                    <span style={styles.detailLabel}>Heritage:</span> {template.heritage}
                  </div>
                )}
                {template.characterTraits && template.characterTraits.length > 0 && (
                  <div style={styles.detail}>
                    <span style={styles.detailLabel}>Traits:</span> {template.characterTraits.join(', ')}
                  </div>
                )}
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

                {/* Bug #2: pregens always have a fixed backstory — show it, never offer regen. */}
                {template.backstory && (
                  <div style={{ marginTop: '10px', padding: '8px', backgroundColor: 'rgba(147,130,220,0.1)', borderLeft: '3px solid #9382dc', borderRadius: '2px' }}>
                    <div style={{ fontSize: '11px', color: '#9382dc', fontWeight: 'bold', marginBottom: '4px' }}>Backstory</div>
                    <div style={{ fontSize: '11px', color: '#c4b998', lineHeight: '1.5', maxHeight: '120px', overflowY: 'auto' }}>{template.backstory}</div>
                  </div>
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
