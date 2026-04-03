import React, { useState } from 'react';
import { mod, modStr, calcBAB, calcSave, getMaxHP } from '../utils/dice';
import useIsMobile from '../hooks/useIsMobile';

export default function CharacterCard({
  char,
  onRemove,
  onHeal,
  onDamage,
  onLevelUp,
  onOpenSheet,
  onGenerateBackstory,
  classesMap,
}) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);

  if (!char) return null;

  const hpPercent = Math.max(0, (char.currentHP / char.maxHP) * 100);
  const hpColor =
    hpPercent > 50 ? '#44ff44' : hpPercent > 25 ? '#ffaa00' : '#ff4444';

  const styles = {
    container: {
      backgroundColor: '#2a2a4e',
      border: '2px solid #ffd700',
      borderRadius: '8px',
      padding: '12px',
      color: '#d4c5a9',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
      marginBottom: '8px',
    },
    title: {
      color: '#ffd700',
      fontWeight: 'bold',
      fontSize: '16px',
    },
    subTitle: {
      fontSize: '12px',
      color: '#b0b0b0',
      marginTop: '4px',
    },
    hpBar: {
      width: '100%',
      height: '20px',
      backgroundColor: '#1a1a2e',
      border: '1px solid #ffd700',
      borderRadius: '4px',
      overflow: 'hidden',
      marginBottom: '8px',
    },
    hpFill: {
      height: '100%',
      backgroundColor: hpColor,
      width: `${hpPercent}%`,
      transition: 'width 0.3s',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      color: '#000',
      fontWeight: 'bold',
    },
    statGrid: {
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)',
      gap: '8px',
      marginBottom: '12px',
      fontSize: '11px',
    },
    stat: {
      backgroundColor: '#1a1a2e',
      padding: '6px',
      borderRadius: '3px',
      border: '1px solid rgba(255, 215, 0, 0.3)',
      textAlign: 'center',
    },
    statLabel: {
      color: '#ffd700',
      fontWeight: 'bold',
    },
    statValue: {
      color: '#d4c5a9',
    },
    buttonRow: {
      display: 'flex',
      gap: '4px',
      marginTop: '8px',
      flexWrap: 'wrap',
    },
    button: {
      flex: 1,
      minWidth: '60px',
      padding: isMobile ? '10px 8px' : '6px 8px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: isMobile ? '12px' : '11px',
      fontWeight: 'bold',
      minHeight: '40px',
    },
    expandedSection: {
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(255, 215, 0, 0.2)',
    },
    sectionTitle: {
      color: '#ffd700',
      fontSize: '12px',
      fontWeight: 'bold',
      marginTop: '8px',
      marginBottom: '4px',
    },
    itemList: {
      fontSize: '12px',
      color: '#b0b0b0',
      marginLeft: '12px',
    },
  };

  const abilities = char.abilities || {};
  const abilityMods = {
    STR: mod(abilities.STR || 10),
    DEX: mod(abilities.DEX || 10),
    CON: mod(abilities.CON || 10),
    INT: mod(abilities.INT || 10),
    WIS: mod(abilities.WIS || 10),
    CHA: mod(abilities.CHA || 10),
  };

  const bab = calcBAB(char.class, char.level, classesMap);
  const fortSave = calcSave('fort', char.class, char.level, classesMap);
  const refSave = calcSave('ref', char.class, char.level, classesMap);
  const willSave = calcSave('will', char.class, char.level, classesMap);

  return (
    <div style={styles.container}>
      <div style={styles.header} onClick={() => setExpanded(!expanded)}>
        <div>
          <div style={styles.title}>{char.name}</div>
          <div style={styles.subTitle}>
            {char.race} {char.class} Level {char.level}
          </div>
        </div>
        <div style={{ fontSize: '16px' }}>{expanded ? '▼' : '▶'}</div>
      </div>

      <div style={styles.hpBar}>
        <div style={styles.hpFill}>
          {char.currentHP}/{char.maxHP}
        </div>
      </div>

      <div style={styles.statGrid}>
        {Object.entries(abilityMods).map(([name, value]) => (
          <div key={name} style={styles.stat}>
            <div style={styles.statLabel}>{name}</div>
            <div style={styles.statValue}>
              {abilities[name] || 10} ({modStr(value)})
            </div>
          </div>
        ))}
      </div>

      <div style={styles.statGrid}>
        <div style={styles.stat}>
          <div style={styles.statLabel}>BAB</div>
          <div style={styles.statValue}>{modStr(bab)}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Fort</div>
          <div style={styles.statValue}>{modStr(fortSave)}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Ref</div>
          <div style={styles.statValue}>{modStr(refSave)}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Will</div>
          <div style={styles.statValue}>{modStr(willSave)}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>AC</div>
          <div style={styles.statValue}>{char.ac || 10}</div>
        </div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>Init</div>
          <div style={styles.statValue}>{modStr(abilityMods.DEX)}</div>
        </div>
      </div>

      {/* Gold display */}
      {char.gold !== undefined && (
        <div style={{ fontSize: '12px', marginBottom: '8px', textAlign: 'center', color: '#ffd700' }}>
          {char.gold} gp
        </div>
      )}

      <div style={styles.buttonRow}>
        <button style={{ ...styles.button, borderColor: '#7b68ee', color: '#7b68ee' }} onClick={() => onOpenSheet?.()}>
          Sheet
        </button>
        <button style={styles.button} onClick={() => onHeal?.(char.id, 5)}>
          Heal 5
        </button>
        <button style={styles.button} onClick={() => onDamage?.(char.id, 5)}>
          Damage 5
        </button>
        <button style={styles.button} onClick={() => onLevelUp?.(char.id)}>
          Level Up
        </button>
        <button style={{ ...styles.button, borderColor: '#ff4444', color: '#ff4444' }}
                onClick={() => onRemove?.(char.id)}>
          Remove
        </button>
      </div>

      {expanded && (
        <div style={styles.expandedSection}>
          {char.feats && char.feats.length > 0 && (
            <div>
              <div style={styles.sectionTitle}>Feats</div>
              <div style={styles.itemList}>
                {char.feats.map((feat, i) => (
                  <div key={i}>• {feat}</div>
                ))}
              </div>
            </div>
          )}

          {char.weapons && char.weapons.length > 0 && (
            <div>
              <div style={styles.sectionTitle}>Weapons</div>
              <div style={styles.itemList}>
                {char.weapons.map((w, i) => (
                  <div key={i}>• {w.name || w} ({w.dmg || '1d8'})</div>
                ))}
              </div>
            </div>
          )}

          {char.conditions && char.conditions.length > 0 && (
            <div>
              <div style={styles.sectionTitle}>Conditions</div>
              <div style={styles.itemList}>
                {char.conditions.map((cond, i) => (
                  <div key={i} style={{ color: '#ff6b6b' }}>
                    • {cond}
                  </div>
                ))}
              </div>
            </div>
          )}

          {char.backstory ? (
            <div>
              <div style={styles.sectionTitle}>Backstory</div>
              <div style={{ fontSize: '11px', color: '#c4b998', lineHeight: '1.5', maxHeight: '100px', overflowY: 'auto' }}>{char.backstory}</div>
            </div>
          ) : onGenerateBackstory && (
            <button
              style={{ ...styles.button, marginTop: '6px', borderColor: '#9382dc', color: '#9382dc', width: '100%' }}
              onClick={() => onGenerateBackstory(char.id)}
            >
              Generate Backstory
            </button>
          )}
        </div>
      )}
    </div>
  );
}
