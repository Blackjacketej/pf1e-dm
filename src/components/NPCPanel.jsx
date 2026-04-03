import React, { useState } from 'react';
import useIsMobile from '../hooks/useIsMobile';

// Helper: get the name to display based on whether party knows the NPC
function displayName(npc) {
  if (!npc) return 'someone';
  if (npc.knownToParty) return npc.name;
  if (npc.shortDesc) return `The ${npc.shortDesc}`;
  return 'A stranger';
}

// Helper: get short label for buttons
function shortLabel(npc) {
  if (npc.knownToParty) return npc.name.split(' ')[0];
  // Use a short descriptor: "the dwarf", "the woman", "them"
  if (npc.race && npc.race !== 'Human') return `the ${npc.race.toLowerCase()}`;
  if (npc.appearance?.gender) return `the ${npc.appearance.gender === 'female' ? 'woman' : 'man'}`;
  return 'them';
}

export default function NPCPanel({ npcs = [], onTalkTo, onRevealName }) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(null);

  if (npcs.length === 0) return null;

  const styles = {
    panel: {
      backgroundColor: '#2a2a4e',
      border: '1px solid #40e0d0',
      borderRadius: '6px',
      padding: '8px',
      marginBottom: '8px',
    },
    title: {
      color: '#40e0d0',
      fontSize: '11px',
      fontWeight: 'bold',
      textTransform: 'uppercase',
      marginBottom: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    npcRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: isMobile ? '8px' : '6px',
      backgroundColor: '#1a1a2e',
      borderRadius: '4px',
      marginBottom: '4px',
      cursor: 'pointer',
      border: '1px solid rgba(64, 224, 208, 0.2)',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    portrait: {
      width: isMobile ? '48px' : '40px',
      height: isMobile ? '56px' : '48px',
      borderRadius: '4px',
      overflow: 'hidden',
      flexShrink: 0,
      border: '1px solid rgba(64, 224, 208, 0.3)',
    },
    npcInfo: {
      flex: 1,
      minWidth: 0,
    },
    npcName: {
      color: '#40e0d0',
      fontWeight: 'bold',
      fontSize: isMobile ? '13px' : '12px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    unknownName: {
      color: '#8b949e',
      fontWeight: 'bold',
      fontSize: isMobile ? '13px' : '12px',
      fontStyle: 'italic',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    npcDetail: {
      color: '#8b949e',
      fontSize: isMobile ? '12px' : '10px',
    },
    disposition: {
      fontSize: '9px',
      padding: '1px 5px',
      borderRadius: '3px',
      fontWeight: 'bold',
      textTransform: 'uppercase',
    },
    expandedCard: {
      padding: isMobile ? '10px' : '8px',
      backgroundColor: '#1a1a2e',
      borderRadius: '4px',
      marginBottom: '4px',
      border: '1px solid rgba(64, 224, 208, 0.3)',
      fontSize: isMobile ? '12px' : '11px',
      color: '#d4c5a9',
    },
    statRow: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      marginTop: '4px',
    },
    stat: {
      fontSize: '10px',
      color: '#7eb8da',
      backgroundColor: '#1a1a3e',
      padding: '1px 4px',
      borderRadius: '2px',
    },
    button: {
      padding: isMobile ? '8px 12px' : '4px 8px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #40e0d0',
      color: '#40e0d0',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: isMobile ? '11px' : '10px',
      fontWeight: 'bold',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    unknownBadge: {
      fontSize: '9px',
      padding: '1px 5px',
      borderRadius: '3px',
      fontWeight: 'bold',
      backgroundColor: '#2a2a3a',
      color: '#8b949e',
      fontStyle: 'italic',
    },
  };

  const dispositionColors = {
    friendly: { bg: '#1a3a1a', color: '#7fff00' },
    neutral: { bg: '#2a2a3a', color: '#b0b0b0' },
    wary: { bg: '#3a3a1a', color: '#ffaa00' },
    hostile: { bg: '#3a1a1a', color: '#ff6b6b' },
    fearful: { bg: '#2a2a3a', color: '#7eb8da' },
    curious: { bg: '#1a2a3a', color: '#40e0d0' },
    amused: { bg: '#2a3a1a', color: '#da70d6' },
    suspicious: { bg: '#3a2a1a', color: '#ffaa00' },
  };

  return (
    <div style={styles.panel}>
      <div style={styles.title}>
        <span>👥</span>
        <span>Nearby NPCs ({npcs.length})</span>
      </div>
      {npcs.map((npc, idx) => {
        const isExpanded = expanded === idx;
        const dColors = dispositionColors[npc.disposition] || dispositionColors.neutral;
        const known = npc.knownToParty;
        const dName = displayName(npc);

        return (
          <div key={npc.id || idx}>
            <div
              style={styles.npcRow}
              onClick={() => setExpanded(isExpanded ? null : idx)}
            >
              {npc.portraitSvg && (
                <div
                  style={styles.portrait}
                  dangerouslySetInnerHTML={{ __html: npc.portraitSvg }}
                />
              )}
              <div style={styles.npcInfo}>
                <div style={known ? styles.npcName : styles.unknownName}>
                  {dName}
                </div>
                <div style={styles.npcDetail}>
                  {known
                    ? `${npc.race} ${npc.class} ${npc.level ? `Lv${npc.level}` : ''} — ${npc.occupation || npc.class}`
                    : npc.firstImpression || `Appears to be a ${npc.occupation || 'traveler'}`
                  }
                </div>
              </div>
              <span style={{ ...styles.disposition, backgroundColor: dColors.bg, color: dColors.color }}>
                {npc.disposition}
              </span>
            </div>
            {isExpanded && (
              <div style={styles.expandedCard}>
                {/* Appearance - always visible (PCs can see this) */}
                {npc.appearance && (
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#ffd700' }}>Appearance:</span>{' '}
                    {npc.appearance.build} build, {npc.appearance.hair} hair, {npc.appearance.eyes} eyes
                    {npc.appearance.distinguishing ? `, ${npc.appearance.distinguishing}` : ''}
                  </div>
                )}

                {/* Only show personality and stats if the party knows this NPC */}
                {known && (
                  <>
                    <div style={{ marginBottom: '4px' }}>
                      <span style={{ color: '#ffd700' }}>Personality:</span> {npc.personality}
                    </div>
                    {npc.abilities && (
                      <div style={styles.statRow}>
                        {Object.entries(npc.abilities).map(([k, v]) => (
                          <span key={k} style={styles.stat}>{k}: {v}</span>
                        ))}
                        <span style={styles.stat}>HP: {npc.hp}</span>
                        <span style={styles.stat}>AC: {npc.ac}</span>
                      </div>
                    )}
                  </>
                )}

                {/* If unknown, show hint that PCs need to interact to learn more */}
                {!known && (
                  <div style={{ marginTop: '4px', color: '#8b949e', fontStyle: 'italic', fontSize: '10px' }}>
                    You don't know this person's name yet. Try speaking with them.
                  </div>
                )}

                {npc.notes && (
                  <div style={{ marginTop: '4px', color: '#8b949e', fontStyle: 'italic' }}>{npc.notes}</div>
                )}
                <div style={{ ...styles.statRow, marginTop: '6px' }}>
                  {onTalkTo && (
                    <button style={styles.button} onClick={(e) => { e.stopPropagation(); onTalkTo(npc); }}>
                      Talk to {shortLabel(npc)}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
