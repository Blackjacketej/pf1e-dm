import React from 'react';
import useIsMobile from '../hooks/useIsMobile';

export default function AreaItemsPanel({ items = [], onInteract }) {
  const isMobile = useIsMobile();
  if (items.length === 0) return null;

  const styles = {
    panel: {
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      borderRadius: '6px',
      padding: '8px',
      marginBottom: '8px',
    },
    title: {
      color: '#ffd700',
      fontSize: '11px',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      marginBottom: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    item: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: isMobile ? '8px' : '5px 8px',
      backgroundColor: '#1a1a2e',
      borderRadius: '4px',
      marginBottom: '3px',
      border: '1px solid rgba(255, 215, 0, 0.15)',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    icon: {
      fontSize: '14px',
      flexShrink: 0,
    },
    itemInfo: {
      flex: 1,
    },
    itemName: {
      color: '#d4c5a9',
      fontSize: isMobile ? '12px' : '11px',
      fontWeight: 'bold',
    },
    itemDesc: {
      color: '#8b949e',
      fontSize: isMobile ? '11px' : '10px',
    },
    interactBtn: {
      padding: isMobile ? '8px 12px' : '3px 8px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: isMobile ? '10px' : '9px',
      fontWeight: 'bold',
      flexShrink: 0,
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    lootTag: {
      fontSize: '8px',
      padding: '1px 4px',
      borderRadius: '2px',
      backgroundColor: '#3a3a1a',
      color: '#ffd700',
      fontWeight: 'bold',
      marginLeft: '6px',
    },
  };

  const getIcon = (item) => {
    if (item.loot) return '💰';
    if (item.interactable) return '🔍';
    if (item.name?.toLowerCase().includes('chest')) return '📦';
    if (item.name?.toLowerCase().includes('potion') || item.name?.toLowerCase().includes('vial')) return '🧪';
    if (item.name?.toLowerCase().includes('weapon') || item.name?.toLowerCase().includes('sword')) return '⚔️';
    if (item.name?.toLowerCase().includes('rune') || item.name?.toLowerCase().includes('glow')) return '✨';
    if (item.name?.toLowerCase().includes('book') || item.name?.toLowerCase().includes('journal')) return '📖';
    if (item.name?.toLowerCase().includes('torch')) return '🔥';
    if (item.name?.toLowerCase().includes('bone')) return '🦴';
    if (item.name?.toLowerCase().includes('board') || item.name?.toLowerCase().includes('notice')) return '📋';
    return '📦';
  };

  return (
    <div style={styles.panel}>
      <div style={styles.title}>
        <span>🎒</span>
        <span>Area Items ({items.length})</span>
      </div>
      {items.map((item, idx) => (
        <div key={idx} style={styles.item}>
          <span style={styles.icon}>{getIcon(item)}</span>
          <div style={styles.itemInfo}>
            <div style={styles.itemName}>
              {item.name}
              {item.loot && <span style={styles.lootTag}>LOOT</span>}
            </div>
            <div style={styles.itemDesc}>{item.description}</div>
          </div>
          {(item.interactable || item.loot) && onInteract && (
            <button
              style={styles.interactBtn}
              onClick={() => onInteract(item)}
            >
              {item.loot ? 'Take' : 'Examine'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
