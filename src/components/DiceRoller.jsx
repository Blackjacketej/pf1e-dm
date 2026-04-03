import React, { useState } from 'react';
import { roll, rollDice } from '../utils/dice';
import useIsMobile from '../hooks/useIsMobile';

export default function DiceRoller({ addLog }) {
  const isMobile = useIsMobile();
  const [history, setHistory] = useState([]);
  const [customDice, setCustomDice] = useState('1d20');
  const [modifier, setModifier] = useState(0);

  const performRoll = (diceStr, mod = 0) => {
    const m = diceStr.match(/(\d+)d(\d+)/);
    if (!m) return;

    const count = parseInt(m[1]);
    const sides = parseInt(m[2]);
    const result = rollDice(count, sides);
    const total = result.total + mod;

    const entry = {
      id: Math.random().toString(36).slice(2, 9),
      dice: diceStr,
      rolls: result.rolls,
      modifier: mod,
      total,
      timestamp: new Date().toLocaleTimeString(),
    };

    setHistory([entry, ...history].slice(0, 20));

    if (addLog) {
      addLog(
        `[${diceStr}${mod > 0 ? '+' + mod : mod < 0 ? mod : ''}] = ${result.rolls.join('+')}${mod > 0 ? '+' + mod : mod < 0 ? mod : ''} = ${total}`,
        'roll'
      );
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
    section: {
      marginBottom: '24px',
    },
    title: {
      fontSize: '14px',
      fontWeight: 'bold',
      color: '#ffd700',
      marginBottom: '12px',
      textTransform: 'uppercase',
      letterSpacing: '1px',
    },
    buttonGrid: {
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)',
      gap: '8px',
      marginBottom: '12px',
    },
    button: {
      padding: isMobile ? '14px 10px' : '10px 8px',
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: isMobile ? '13px' : '12px',
      fontWeight: 'bold',
      transition: 'all 0.2s',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    customRow: {
      display: 'flex',
      gap: '8px',
      marginBottom: '12px',
    },
    input: {
      flex: 1,
      padding: '8px',
      backgroundColor: '#2a2a4e',
      border: '1px solid #ffd700',
      color: '#d4c5a9',
      borderRadius: '4px',
      fontFamily: 'monospace',
    },
    history: {
      maxHeight: '200px',
      overflowY: 'auto',
      backgroundColor: '#0f0f1e',
      border: '1px solid #ffd700',
      borderRadius: '4px',
      padding: '8px',
    },
    historyEntry: {
      fontSize: '12px',
      padding: '4px 0',
      borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
      color: '#7eb8da',
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.title}>Quick Rolls</div>
        <div style={styles.buttonGrid}>
          {['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '1d100', '2d6', '3d6', '4d6'].map(
            (dice) => (
              <button
                key={dice}
                style={styles.button}
                onClick={() => performRoll(dice)}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#3a3a6e';
                  e.target.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#2a2a4e';
                  e.target.style.color = '#ffd700';
                }}
              >
                {dice}
              </button>
            )
          )}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.title}>Custom Roll</div>
        <div style={styles.customRow}>
          <input
            type="text"
            style={styles.input}
            value={customDice}
            onChange={(e) => setCustomDice(e.target.value)}
            placeholder="e.g. 3d8"
          />
          <input
            type="number"
            style={{ ...styles.input, width: '80px' }}
            value={modifier}
            onChange={(e) => setModifier(parseInt(e.target.value) || 0)}
            placeholder="+0"
          />
          <button
            style={{ ...styles.button, width: '100px' }}
            onClick={() => performRoll(customDice, modifier)}
          >
            Roll
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div style={styles.section}>
          <div style={styles.title}>Roll History</div>
          <div style={styles.history}>
            {history.map((entry) => (
              <div key={entry.id} style={styles.historyEntry}>
                <strong>{entry.dice}</strong>: {entry.rolls.join(', ')}
                {entry.modifier !== 0 && ` ${entry.modifier > 0 ? '+' : ''}${entry.modifier}`} =
                <span style={{ color: '#ffd700', marginLeft: '4px' }}>{entry.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
