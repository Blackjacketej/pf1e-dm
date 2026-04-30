import React, { useState } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import { publicNpcView } from '../services/npcKnowledge';

// Label used on the "Talk to X" button. When identified we pick the first
// name ("Mira" rather than "Mira Darkbrook"); otherwise we use the view's
// own unknown-descriptor ("the dwarf woman" / "a stranger").
function talkLabel(view) {
  if (view.identified && view.displayName) {
    return view.displayName.split(' ')[0];
  }
  return view.displayName || 'them';
}

// Second-line descriptor that grows richer as knowledge increases.
//  L0 unidentified -> firstImpression / generic
//  L1+  race
//  stats unlock  -> + class + classLevel
//  L3+  powerLevelHint (only if no class revealed yet)
//  L2+  occupation
function roleLine(view) {
  if (!view.identified) {
    return view.firstImpression || 'Appears to be a traveler';
  }
  const chunks = [];
  if (view.race) chunks.push(view.race);
  if (view.class) {
    chunks.push(view.classLevel ? `${view.class} Lv${view.classLevel}` : view.class);
  } else if (view.powerLevelHint) {
    chunks.push(`(${view.powerLevelHint})`);
  }
  if (view.occupation) chunks.push(`— ${view.occupation}`);
  const line = chunks.filter(Boolean).join(' ');
  return line || 'someone you know';
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
    // Scrollable list container — Tom's live Market Square session hit 7+
    // nearby NPCs and the list was getting clipped because the enclosing
    // collapsible just rendered every row without any vertical bound.
    // Cap at ~6 desktop rows / ~5 mobile rows before a scrollbar appears
    // so the panel doesn't swallow the whole sidebar when the party is
    // standing in a crowded festival square. The sidebar itself is
    // resizable (drag the splitter on the left edge) so power users can
    // open it wider instead of scrolling.
    listScroll: {
      maxHeight: isMobile ? '360px' : '440px',
      overflowY: 'auto',
      overflowX: 'hidden',
      paddingRight: '2px', // reserve a sliver so scrollbar doesn't overlap text
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
      <div style={styles.listScroll}>
      {npcs.map((npc, idx) => {
        // One projection per NPC — same gate the Journal uses, so neither
        // surface can leak more than the party has earned. Raw npc is kept
        // for callback handlers (onTalkTo) that still expect the real object.
        const view = publicNpcView(npc);
        const isExpanded = expanded === idx;
        // Disposition chip: publicNpcView maps npc.disposition -> demeanor at
        // L2+ and -> disposition at L3+. Below L2 we show nothing so a
        // five-second glance doesn't telegraph friendliness.
        const dispLabel = view.disposition || view.demeanor || null;
        const dColors = dispLabel
          ? (dispositionColors[dispLabel] || dispositionColors.neutral)
          : null;

        return (
          <div key={view.id || idx}>
            <div
              style={styles.npcRow}
              onClick={() => setExpanded(isExpanded ? null : idx)}
            >
              {view.portraitSvg && (
                <div
                  style={styles.portrait}
                  dangerouslySetInnerHTML={{ __html: view.portraitSvg }}
                />
              )}
              <div style={styles.npcInfo}>
                <div style={view.identified ? styles.npcName : styles.unknownName}>
                  {view.displayName}
                </div>
                <div style={styles.npcDetail}>
                  {roleLine(view)}
                </div>
              </div>
              {dispLabel && dColors && (
                <span style={{ ...styles.disposition, backgroundColor: dColors.bg, color: dColors.color }}>
                  {dispLabel}
                </span>
              )}
            </div>
            {isExpanded && (
              <div style={styles.expandedCard}>
                {/* Appearance — always visible (you can see someone the moment
                    you lay eyes on them, no knowledge required). */}
                {view.appearance && (
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#ffd700' }}>Appearance:</span>{' '}
                    {[
                      view.appearance.build && `${view.appearance.build} build`,
                      view.appearance.hair && `${view.appearance.hair} hair`,
                      view.appearance.eyes && `${view.appearance.eyes} eyes`,
                      view.appearance.distinguishing,
                    ].filter(Boolean).join(', ')}
                  </div>
                )}

                {/* Mood unlocks at L2+ (short conversation lets you read a mood). */}
                {view.emotionalState && (
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#ffd700' }}>Mood:</span> {view.emotionalState}
                  </div>
                )}

                {/* Personality unlocks at L2+ (acquainted). */}
                {view.personality && (
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#ffd700' }}>Personality:</span> {view.personality}
                  </div>
                )}

                {/* Long-term goal unlocks at L3+ (genuinely known). */}
                {view.goal && (
                  <div style={{ marginBottom: '4px' }}>
                    <span style={{ color: '#ffd700' }}>Goal:</span> {view.goal}
                  </div>
                )}

                {/* Stat block unlocks behind stats/combatStats facts or L4. */}
                {view.abilities && (
                  <div style={styles.statRow}>
                    {Object.entries(view.abilities).map(([k, v]) => (
                      <span key={k} style={styles.stat}>{k}: {v}</span>
                    ))}
                    {view.hp != null && <span style={styles.stat}>HP: {view.hp}</span>}
                    {view.ac != null && <span style={styles.stat}>AC: {view.ac}</span>}
                  </div>
                )}

                {/* Gentle hint about how to learn more, tuned to the tier. */}
                {!view.identified && (
                  <div style={{ marginTop: '4px', color: '#8b949e', fontStyle: 'italic', fontSize: '10px' }}>
                    You don't know this person's name yet. Try speaking with them.
                  </div>
                )}
                {view.identified && view.knowledgeLevel < 3 && !view.abilities && (
                  <div style={{ marginTop: '4px', color: '#8b949e', fontStyle: 'italic', fontSize: '10px' }}>
                    You'd need more time together — or to see them in action — to know more.
                  </div>
                )}

                <div style={{ ...styles.statRow, marginTop: '6px' }}>
                  {onTalkTo && (
                    <button style={styles.button} onClick={(e) => { e.stopPropagation(); onTalkTo(npc); }}>
                      Talk to {talkLabel(view)}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
