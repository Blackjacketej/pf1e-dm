import React, { useEffect, useMemo } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import { buildPartyColorMap, colorizeNarration } from '../utils/narrativeColors';

const typeColors = {
  narration: '#e8dcc8',
  header: '#ffd700',
  roll: '#7eb8da',
  success: '#7fff00',
  danger: '#ff6b6b',
  warning: '#ffaa00',
  npc: '#40e0d0',
  dialogue: '#a8d8ea',
  loot: '#ffd700',
  damage: '#ff4444',
  system: '#8b949e',
  heal: '#44ff44',
  info: '#c0c0c0',
  action: '#b8b8ff',
  event: '#da70d6',
  // Journal additions — anything the party commits to the Adventurer's
  // Journal (clues, NPCs met, factions discovered, locations visited,
  // creatures encountered, items found, journal notes). Teal-gold so it
  // reads as "in-character record keeping" distinct from system meta-lines.
  journal: '#d4af37',
  // Attack-roll extremes. Natural 20 → critical, natural 1 → fumble. Kept
  // distinct from plain success/danger so the log visually marks the
  // "big swing" moments you'd expect an NWN-style log to highlight.
  critical: '#ffeb3b',
  fumble: '#8b0000',
};

const typeLabels = {
  narration: null,
  header: null,
  roll: 'ROLL',
  success: 'SUCCESS',
  danger: 'DANGER',
  warning: 'WARNING',
  npc: 'NPC',
  dialogue: 'DIALOGUE',
  loot: 'LOOT',
  damage: 'DAMAGE',
  system: 'SYSTEM',
  heal: 'HEAL',
  info: 'INFO',
  action: 'ACTION',
  event: 'EVENT',
  journal: 'JOURNAL',
  critical: 'CRITICAL',
  fumble: 'FUMBLE',
};

export default function GameLog({ logs = [], logRef, party = [] }) {
  const isMobile = useIsMobile();
  // Memoize the party color lookup so we don't rebuild on every log update.
  // Recomputes only when the party roster changes (add / drop / rename / etc.).
  const partyColorMap = useMemo(() => buildPartyColorMap(party), [party]);
  useEffect(() => {
    if (logRef?.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, logRef]);

  const styles = {
    container: {
      height: '100%',
      backgroundColor: '#12121f',
      border: '2px solid #ffd70066',
      borderRadius: '8px',
      padding: isMobile ? '12px' : '14px',
      overflowY: 'auto',
      fontSize: isMobile ? '14px' : '14px',
      color: '#e0d6c2',
      boxSizing: 'border-box',
      lineHeight: '1.7',
      WebkitOverflowScrolling: 'touch',
    },
    entry: {
      marginBottom: '10px',
      paddingBottom: '10px',
      borderBottom: '1px solid rgba(255, 215, 0, 0.12)',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '4px',
    },
    time: {
      fontSize: isMobile ? '11px' : '11px',
      color: '#555',
    },
    label: {
      fontSize: '10px',
      fontWeight: 'bold',
      padding: '1px 6px',
      borderRadius: '3px',
      letterSpacing: '0.5px',
    },
    text: {
      lineHeight: '1.6',
      wordWrap: 'break-word',
    },
    empty: {
      textAlign: 'center',
      color: '#666',
      padding: '40px 20px',
      fontSize: '16px',
    },
  };

  if (!logs || logs.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏰</div>
          <div style={{ color: '#d4c5a9' }}>Welcome, Dungeon Master!</div>
          <div style={{ fontSize: '13px', marginTop: '8px', color: '#666' }}>
            Your adventure log awaits...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} ref={logRef}>
      {logs.map((log) => {
        const color = typeColors[log.type] || '#e0d6c2';
        const label = typeLabels[log.type];
        const isHeader = log.type === 'header';
        const isNarration = log.type === 'narration';
        const isAction = log.type === 'action';

        return (
          <div key={log.id} style={{
            ...styles.entry,
            ...(isHeader ? { borderBottom: '2px solid #ffd70044', paddingTop: '8px' } : {}),
          }}>
            {/* Label + time row — skip for narration/headers to keep them clean */}
            {label && (
              <div style={styles.header}>
                <span style={{
                  ...styles.label,
                  backgroundColor: `${color}22`,
                  color,
                }}>
                  {label}
                </span>
                <span style={styles.time}>{log.time || ''}</span>
              </div>
            )}

            {/* Main text */}
            <div style={{
              ...styles.text,
              color,
              ...(isHeader ? {
                fontSize: isMobile ? '16px' : '16px',
                fontWeight: 'bold',
                textAlign: 'center',
                letterSpacing: '2px',
                padding: '4px 0',
              } : {}),
              ...(isNarration ? {
                fontSize: isMobile ? '15px' : '14px',
                fontFamily: 'Georgia, "Times New Roman", serif',
                lineHeight: '1.8',
              } : {}),
              ...(isAction ? {
                fontStyle: 'italic',
                paddingLeft: '12px',
                borderLeft: `2px solid ${color}55`,
              } : {}),
            }}>
              {/* Option B (2026-04-20) — sentence-level color-coding for
                  split-party narration. Each sentence inherits its single
                  named PC's class color; sentences with 0 or 2+ named PCs
                  stay default. Only applied to `narration` entries — other
                  log types render plain. Skipped silently if there's no
                  party (legacy callers, log-only views). */}
              {isNarration && partyColorMap.size > 0
                ? colorizeNarration(log.text, partyColorMap).map((seg, i) => (
                  <span
                    key={i}
                    style={seg.color ? { color: seg.color } : undefined}
                  >
                    {seg.text}
                  </span>
                ))
                : log.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
