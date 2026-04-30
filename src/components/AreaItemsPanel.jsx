import React from 'react';
import useIsMobile from '../hooks/useIsMobile';

// Bug #45 — area-item actions should be character-specific ("who does the
// action?"). Minimal first slice per the #45-blocked recommendation:
//   (1c) a shared active-character concept — sourced from AdventureTab via
//        `activeCharacterId` + `onChangeActor` props, persisted on
//        worldState so the choice survives reloads,
//   (2)  default actor = first party member (AdventureTab's resolution),
//   (3)  applies to Take/Examine on area items; hoard survey stays on the
//        best appraiser for now (skills-driven, not actor-driven).
// Future slices can expand the picker into a global "active character" row
// shared with the action bar / PartyActionBar — see #45-blocked for the
// five questions that were deferred for this minimal landing.
export default function AreaItemsPanel({
  items = [],
  onInteract,
  onSurveyHoard,
  party = [],
  activeCharacterId = null,
  onChangeActor,
}) {
  const isMobile = useIsMobile();
  if (items.length === 0) return null;

  const actorOptions = Array.isArray(party) ? party.filter(p => p && p.id) : [];
  const resolvedActorId = actorOptions.find(p => p.id === activeCharacterId)?.id
    || actorOptions[0]?.id
    || null;
  const resolvedActor = actorOptions.find(p => p.id === resolvedActorId) || null;
  const showActorPicker = actorOptions.length > 1 && typeof onChangeActor === 'function';

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
    magicHint: {
      fontSize: '10px',
      marginLeft: '4px',
      color: '#b8a0ff',
    },
    appraiseTag: {
      fontSize: '9px',
      marginLeft: '6px',
      color: '#c9b37a',
      fontStyle: 'italic',
    },
    surveyBtn: {
      width: '100%',
      padding: isMobile ? '8px' : '4px 6px',
      marginBottom: '6px',
      backgroundColor: '#3a3a1a',
      border: '1px dashed #ffd700',
      color: '#ffd700',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: isMobile ? '11px' : '10px',
      fontStyle: 'italic',
      touchAction: 'manipulation',
      minHeight: isMobile ? '44px' : 'auto',
    },
    actorRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginBottom: '6px',
      padding: isMobile ? '4px 6px' : '2px 4px',
      backgroundColor: '#1a1a2e',
      borderRadius: '3px',
      border: '1px solid rgba(255, 215, 0, 0.15)',
    },
    actorLabel: {
      color: '#8b949e',
      fontSize: isMobile ? '10px' : '9px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      flexShrink: 0,
    },
    actorSelect: {
      flex: 1,
      padding: isMobile ? '4px 6px' : '2px 4px',
      backgroundColor: '#2a2a4e',
      color: '#ffd700',
      border: '1px solid rgba(255, 215, 0, 0.3)',
      borderRadius: '2px',
      fontSize: isMobile ? '11px' : '10px',
      cursor: 'pointer',
      minWidth: 0,
    },
    actorStatic: {
      color: '#d4c5a9',
      fontSize: isMobile ? '11px' : '10px',
      fontWeight: 'bold',
      flex: 1,
    },
  };

  // Hoard threshold: CRB mentions "a treasure hoard" as a distinct mode
  // for Appraise (1 full-round action instead of standard). We trigger it
  // at 3+ loot items in the panel — matches the user's design choice.
  const lootCount = items.filter(i => i.loot || i.interactable).length;
  const showSurveyButton = lootCount >= 3 && typeof onSurveyHoard === 'function';

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
      {(showActorPicker || resolvedActor) && (
        <div style={styles.actorRow} title="Who performs Take/Examine on area items">
          <span style={styles.actorLabel}>Actor</span>
          {showActorPicker ? (
            <select
              style={styles.actorSelect}
              value={resolvedActorId || ''}
              onChange={(e) => onChangeActor(e.target.value || null)}
            >
              {actorOptions.map(p => (
                <option key={p.id} value={p.id}>{p.name || 'Unnamed'}</option>
              ))}
            </select>
          ) : (
            <span style={styles.actorStatic}>{resolvedActor?.name || 'The party'}</span>
          )}
        </div>
      )}
      {showSurveyButton && (
        <button
          type="button"
          style={styles.surveyBtn}
          onClick={onSurveyHoard}
          title="1 full-round action: identify the most valuable item in the hoard"
        >
          🔎 Survey the hoard ({lootCount} pieces)
        </button>
      )}
      {items.map((item, idx) => {
        // Once the party has appraised this item, surface a condensed line
        // under the description and a ✨ hint if it reads as magical.
        const known = item.knownIdentity && item.knownIdentity.display;
        const detectsMagic = !!(known && known.magicHint);
        return (
          <div key={idx} style={styles.item}>
            <span style={styles.icon}>{getIcon(item)}</span>
            <div style={styles.itemInfo}>
              <div style={styles.itemName}>
                {item.name}
                {item.loot && <span style={styles.lootTag}>LOOT</span>}
                {detectsMagic && <span style={styles.magicHint} title="Magical aura detected">✨</span>}
                {known && known.valueText && known.valueText !== '—' && (
                  <span style={styles.appraiseTag} title={known.headline || ''}>
                    ~{known.valueText}
                  </span>
                )}
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
        );
      })}
    </div>
  );
}
