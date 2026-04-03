import React, { useEffect } from 'react';
import useIsMobile from '../hooks/useIsMobile';

const typeColors = {
  narration: '#d4c5a9',
  header: '#ffd700',
  roll: '#7eb8da',
  success: '#7fff00',
  danger: '#ff6b6b',
  warning: '#ffaa00',
  npc: '#40e0d0',
  dialogue: '#87ceeb',
  loot: '#ffd700',
  damage: '#ff4444',
  system: '#8b949e',
  heal: '#44ff44',
  info: '#b0b0b0',
  action: '#aaaaff',
  event: '#da70d6',
};

export default function GameLog({ logs = [], logRef }) {
  const isMobile = useIsMobile();
  useEffect(() => {
    if (logRef?.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, logRef]);

  const styles = {
    container: {
      height: '100%',
      backgroundColor: '#1a1a2e',
      border: '2px solid #ffd700',
      borderRadius: '8px',
      padding: isMobile ? '10px' : '12px',
      overflowY: 'auto',
      fontFamily: 'monospace',
      fontSize: isMobile ? '13px' : '14px',
      color: '#d4c5a9',
      boxSizing: 'border-box',
      lineHeight: '1.6',
    },
    entry: {
      marginBottom: '8px',
      paddingBottom: '8px',
      borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
    },
    time: {
      fontSize: '12px',
      color: '#666',
      marginRight: '8px',
    },
    text: {
      marginTop: '4px',
      lineHeight: '1.4',
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
          <div>Welcome, Dungeon Master!</div>
          <div style={{ fontSize: '12px', marginTop: '8px', color: '#555' }}>
            Your adventure log awaits...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} ref={logRef}>
      {logs.map((log) => (
        <div key={log.id} style={styles.entry}>
          <div>
            <span style={styles.time}>[{log.time || '00:00'}]</span>
            <span style={{ color: typeColors[log.type] || '#d4c5a9' }}>
              [{log.type?.toUpperCase() || 'INFO'}]
            </span>
          </div>
          <div style={{ ...styles.text, color: typeColors[log.type] || '#d4c5a9' }}>
            {log.text}
          </div>
        </div>
      ))}
    </div>
  );
}
