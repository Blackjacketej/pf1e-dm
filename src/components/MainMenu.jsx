import React, { useEffect, useState } from 'react';
import { listSaves, loadGame } from '../services/saveGame';

/**
 * MainMenu — full-screen landing shown before any campaign/adventure state
 * is surfaced. Five actions, matching the operator's design brief for #29:
 *
 *   New Game      → wipes the current live state, drops into Campaign tab
 *   Continue      → restores the most recent autosave / persisted state and
 *                   jumps into Adventure (or Party, if no campaign is active)
 *   Load Game     → inline save list; pick → loadGame + hand off to App
 *   Settings      → Settings tab (no live game required)
 *   GM Designer   → GM Reference tab (alias per operator) with gmMode on
 *
 * The menu is its own screen — the main app chrome (header, tabs, slide
 * panels) is not rendered until the user exits the menu. This prevents the
 * bug-#29 "restore race" where the header banners & buttons flashed active
 * before state had finished loading.
 */
export default function MainMenu({
  onNewGame,
  onContinue,
  onLoadGame,
  onSettings,
  onGMDesigner,
  hasSavedGame,
}) {
  const [showLoadList, setShowLoadList] = useState(false);
  const [saves, setSaves] = useState([]);
  const [loadingSaves, setLoadingSaves] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!showLoadList) return;
    let cancelled = false;
    setLoadingSaves(true);
    setLoadError(null);
    listSaves()
      .then((list) => { if (!cancelled) setSaves(list); })
      .catch((e) => { if (!cancelled) setLoadError(e?.message || 'Failed to list saves'); })
      .finally(() => { if (!cancelled) setLoadingSaves(false); });
    return () => { cancelled = true; };
  }, [showLoadList]);

  const handlePickSave = async (id) => {
    try {
      const data = await loadGame(id);
      onLoadGame(data);
    } catch (e) {
      setLoadError(e?.message || 'Failed to load save');
    }
  };

  const buttonStyle = (accent = '#ffd700') => ({
    background: 'linear-gradient(135deg, #2d1b00 0%, #4a2800 100%)',
    border: `2px solid ${accent}`,
    color: accent,
    padding: '18px 28px',
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: 1,
    borderRadius: 10,
    cursor: 'pointer',
    minWidth: 260,
    textAlign: 'center',
    fontFamily: "'Segoe UI',system-ui,sans-serif",
    transition: 'transform 0.1s, box-shadow 0.1s',
  });

  const disabledButtonStyle = (accent = '#555') => ({
    ...buttonStyle(accent),
    cursor: 'not-allowed',
    opacity: 0.5,
  });

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      color: '#e0d6c8',
      fontFamily: "'Segoe UI',system-ui,sans-serif",
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24, boxSizing: 'border-box',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 72, marginBottom: 8 }}>{'\u2694\uFE0F'}</div>
        <h1 style={{
          margin: 0, fontSize: 40, color: '#ffd700',
          fontWeight: 700, letterSpacing: 2,
        }}>
          PATHFINDER
        </h1>
        <div style={{ fontSize: 16, color: '#b8860b', letterSpacing: 4, marginTop: 4 }}>
          1ST EDITION &bull; AI DUNGEON MASTER
        </div>
      </div>

      {!showLoadList ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button
            style={buttonStyle('#ffd700')}
            onClick={onNewGame}
          >
            New Game
          </button>
          <button
            style={hasSavedGame ? buttonStyle('#7fff00') : disabledButtonStyle()}
            onClick={hasSavedGame ? onContinue : undefined}
            disabled={!hasSavedGame}
            title={hasSavedGame ? 'Resume your most recent session' : 'No saved game found'}
          >
            Continue
          </button>
          <button
            style={buttonStyle('#58d7ff')}
            onClick={() => setShowLoadList(true)}
          >
            Load Game
          </button>
          <button
            style={buttonStyle('#b8860b')}
            onClick={onSettings}
          >
            Settings
          </button>
          <button
            style={buttonStyle('#d946ef')}
            onClick={onGMDesigner}
          >
            GM Designer
          </button>
        </div>
      ) : (
        <div style={{
          width: 'min(540px, 92vw)',
          background: 'rgba(10, 10, 20, 0.85)',
          border: '1px solid #8b6914',
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 14,
          }}>
            <h2 style={{ margin: 0, color: '#58d7ff', fontSize: 22 }}>Load Game</h2>
            <button
              style={{
                background: 'transparent', border: '1px solid #444',
                color: '#888', padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
              }}
              onClick={() => setShowLoadList(false)}
            >
              Back
            </button>
          </div>
          {loadError && (
            <div style={{ color: '#ff6b6b', marginBottom: 10, fontSize: 13 }}>{loadError}</div>
          )}
          {loadingSaves ? (
            <div style={{ color: '#888', fontSize: 13 }}>Loading saves…</div>
          ) : saves.length === 0 ? (
            <div style={{ color: '#888', fontSize: 13, padding: 12, textAlign: 'center' }}>
              No saved games yet.
            </div>
          ) : (
            <div style={{
              maxHeight: '50vh', overflow: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {saves.map((s) => (
                <button
                  key={s.id}
                  style={{
                    background: '#1a1a2e',
                    border: '1px solid #30363d',
                    color: '#e0d6c8',
                    padding: '10px 14px',
                    borderRadius: 6, cursor: 'pointer',
                    textAlign: 'left', fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                  onClick={() => handlePickSave(s.id)}
                >
                  <div style={{ color: '#ffd700', fontWeight: 600, marginBottom: 2 }}>
                    {s.name}
                  </div>
                  <div style={{ color: '#888', fontSize: 11 }}>
                    {s.savedAt?.slice(0, 16).replace('T', ' ')}
                    {' · '}party: {s.partySize}
                    {s.campaignName ? ` · ${s.campaignName}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 40, color: '#666', fontSize: 11, letterSpacing: 1 }}>
        Claude-powered AI game master &bull; Local save, no cloud required
      </div>
    </div>
  );
}
