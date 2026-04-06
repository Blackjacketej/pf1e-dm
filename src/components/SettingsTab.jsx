import { useState, useEffect, useRef } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import dmEngine from '../services/dmEngine';
import { saveGame, loadGame, listSaves, deleteSave } from '../services/saveGame';
import { exportToFile, importFromFile, pickSaveFile, autoSaveToFile, hasFileHandle } from '../services/fileSave';
import { getSyncStatus, linkToken, unlinkSync, pushCurrentState, pullAndApply, fullSync } from '../services/gistSync';

export default function SettingsTab({ party, campaign, adventure, combat, gameLog, worldState, setWorldState, onLoadGame }) {
  const isMobile = useIsMobile();
  const [settings, setSettings] = useState(dmEngine.getSettings());
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saves, setSaves] = useState([]);
  const [saveName, setSaveName] = useState('');
  const [saveMsg, setSaveMsg] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const [fileMsg, setFileMsg] = useState(null);
  const [autoSaveFile, setAutoSaveFile] = useState(hasFileHandle() ? 'linked' : null);
  const importRef = useRef(null);

  // Cloud sync state
  const [syncStatus, setSyncStatus] = useState(() => getSyncStatus());
  const [syncToken, setSyncToken] = useState('');
  const [syncMsg, setSyncMsg] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [showSyncToken, setShowSyncToken] = useState(false);

  const handleLinkGist = async () => {
    if (!syncToken.trim()) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await linkToken(syncToken);
      setSyncStatus(getSyncStatus());
      setSyncToken('');
      setSyncMsg({ ok: true, text: `Linked as ${result.username}! Syncing...` });
      // Do initial full sync
      await fullSync();
      // Reload settings in case cloud had different ones
      setSettings(dmEngine.getSettings());
      setSyncMsg({ ok: true, text: `Synced! Connected as ${result.username}.` });
    } catch (err) {
      setSyncMsg({ ok: false, text: `Link failed: ${err.message}` });
    }
    setSyncing(false);
  };

  const handlePush = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await pushCurrentState();
      setSyncStatus(getSyncStatus());
      setSyncMsg({ ok: true, text: 'Settings & saves pushed to cloud.' });
    } catch (err) {
      setSyncMsg({ ok: false, text: `Push failed: ${err.message}` });
    }
    setSyncing(false);
  };

  const handlePull = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await pullAndApply();
      setSyncStatus(getSyncStatus());
      // Reload settings from localStorage since pull may have updated them
      const fresh = dmEngine.getSettings();
      setSettings(fresh);
      dmEngine.updateSettings(fresh);
      setSyncMsg({ ok: true, text: 'Settings pulled from cloud and applied.' });
    } catch (err) {
      setSyncMsg({ ok: false, text: `Pull failed: ${err.message}` });
    }
    setSyncing(false);
  };

  const handleUnlink = () => {
    unlinkSync();
    setSyncStatus(getSyncStatus());
    setSyncMsg({ ok: true, text: 'Unlinked. Your cloud data is still in your Gist.' });
  };

  const updateWorld = (key, value) => {
    setWorldState?.(prev => ({
      ...prev,
      [key]: typeof value === 'function' ? value(prev[key]) : value
    }));
  };

  const dmPrefs = worldState?.dmPreferences || { xpTrack: 'medium', autoLevelUp: false, encumbranceTracking: false, critConfirmation: true, heroPoints: false, abilityScoreMethod: '4d6-drop-lowest', sanitySys: false, alignmentTracking: true, weatherSystem: true, lightTracking: true, trapsAndHaunts: true };

  // Load saved games list
  useEffect(() => {
    listSaves().then(setSaves).catch(console.error);
  }, []);

  const handleSaveGame = async () => {
    try {
      const name = saveName.trim() || `Save - ${new Date().toLocaleString()}`;
      await saveGame(name, { party, campaign, adventure, combat, gameLog, worldState });
      setSaveName('');
      setSaveMsg({ ok: true, text: `Game saved as "${name}"` });
      const updated = await listSaves();
      setSaves(updated);
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg({ ok: false, text: `Save failed: ${err.message}` });
    }
  };

  const handleLoadGame = async (id) => {
    setLoadingId(id);
    try {
      const data = await loadGame(id);
      if (onLoadGame) onLoadGame(data);
      setSaveMsg({ ok: true, text: 'Game loaded!' });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg({ ok: false, text: `Load failed: ${err.message}` });
    }
    setLoadingId(null);
  };

  const handleDeleteSave = async (id) => {
    try {
      await deleteSave(id);
      const updated = await listSaves();
      setSaves(updated);
    } catch (err) {
      console.error('Delete save failed:', err);
    }
  };

  // ── File-based save/load ──
  const liveState = { party, campaign, adventure, combat, gameLog, worldState };

  const handleExportFile = async () => {
    try {
      const filename = await exportToFile(liveState);
      setFileMsg({ ok: true, text: `Exported to ${filename}` });
      setTimeout(() => setFileMsg(null), 4000);
    } catch (err) {
      setFileMsg({ ok: false, text: `Export failed: ${err.message}` });
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importFromFile(file);
      if (onLoadGame) onLoadGame(data);
      setFileMsg({ ok: true, text: `Imported from ${file.name}` });
      const updated = await listSaves();
      setSaves(updated);
      setTimeout(() => setFileMsg(null), 4000);
    } catch (err) {
      setFileMsg({ ok: false, text: `Import failed: ${err.message}` });
    }
    // Reset file input so the same file can be re-imported
    if (importRef.current) importRef.current.value = '';
  };

  const handlePickAutoSaveFile = async () => {
    try {
      const name = await pickSaveFile();
      if (name) {
        setAutoSaveFile(name);
        // Do an immediate save
        await autoSaveToFile(liveState);
        setFileMsg({ ok: true, text: `Auto-save linked to ${name}` });
        setTimeout(() => setFileMsg(null), 4000);
      }
    } catch (err) {
      setFileMsg({ ok: false, text: err.message });
    }
  };

  const handleSave = (key, value) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    dmEngine.updateSettings(updated);
    setTestStatus(null);
  };

  const testConnection = async () => {
    if (!settings.apiKey) {
      setTestStatus({ ok: false, msg: 'No API key configured' });
      return;
    }
    setTesting(true);
    setTestStatus(null);
    try {
      const result = await dmEngine.narrate('custom', {
        party: [{ name: 'Test Hero', level: 1, race: 'Human', className: 'Fighter', currentHP: 12, maxHP: 12, ac: 16, abilities: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 } }],
      }, 'I look around the tavern.');
      if (result.source === 'ai' && result.text) {
        setTestStatus({ ok: true, msg: 'AI DM is working! Response received.', preview: result.text });
      } else {
        const errorDetail = result.aiError ? `\n\nError: ${result.aiError}` : '';
        setTestStatus({ ok: false, msg: `Got a response but it came from the fallback engine, not the AI.${errorDetail}` });
      }
    } catch (err) {
      setTestStatus({ ok: false, msg: `Connection failed: ${err.message}` });
    }
    setTesting(false);
  };

  const styles = {
    container: { padding: isMobile ? '16px' : '24px', maxWidth: '700px', margin: '0 auto', overflowY: 'auto', height: '100%' },
    section: {
      backgroundColor: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '6px',
      padding: isMobile ? '16px' : '20px', marginBottom: '16px',
    },
    label: { display: 'block', color: '#ffd700', fontSize: '13px', fontWeight: 'bold', marginBottom: '6px' },
    sublabel: { color: '#8b949e', fontSize: '11px', marginBottom: '10px', display: 'block' },
    input: {
      width: '100%', padding: isMobile ? '12px' : '10px 12px', backgroundColor: '#0d1117', color: '#e0d6c8',
      border: '1px solid #4a3b2a', borderRadius: '4px', fontSize: '14px', fontFamily: 'monospace',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    select: {
      width: '100%', padding: isMobile ? '12px' : '10px 12px', backgroundColor: '#0d1117', color: '#e0d6c8',
      border: '1px solid #4a3b2a', borderRadius: '4px', fontSize: '14px',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    btn: {
      padding: isMobile ? '12px 16px' : '10px 20px', backgroundColor: '#3a3a6e', border: '1px solid #ffd700',
      color: '#ffd700', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
      minHeight: isMobile ? '44px' : 'auto',
      touchAction: 'manipulation',
    },
    status: (ok) => ({
      marginTop: '12px', padding: '10px', borderRadius: '4px',
      backgroundColor: ok ? 'rgba(127, 255, 0, 0.1)' : 'rgba(255, 107, 107, 0.1)',
      border: `1px solid ${ok ? '#7fff00' : '#ff6b6b'}`,
      color: ok ? '#7fff00' : '#ff6b6b', fontSize: '12px',
    }),
    indicator: {
      display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
      marginRight: '8px',
    },
  };

  const aiActive = dmEngine.isAIAvailable();

  return (
    <div style={styles.container}>
      <h2 style={{ color: '#ffd700', marginBottom: '4px', fontSize: '20px' }}>DM Settings</h2>
      <p style={{ color: '#8b949e', marginBottom: '24px', fontSize: '13px' }}>
        Configure the AI Dungeon Master. When an API key is set, the DM uses Claude for dynamic narration.
        Without a key, it falls back to procedural storytelling.
      </p>

      {/* Status */}
      <div style={{ ...styles.section, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px' }}>
        <div style={{ ...styles.indicator, backgroundColor: aiActive ? '#7fff00' : '#ff6b6b' }} />
        <div>
          <div style={{ color: aiActive ? '#7fff00' : '#ff6b6b', fontWeight: 'bold', fontSize: '13px' }}>
            {aiActive ? 'AI DM Active' : 'Procedural DM (Fallback Mode)'}
          </div>
          <div style={{ color: '#8b949e', fontSize: '11px' }}>
            {aiActive ? 'Claude API connected — dynamic narration enabled' : 'Add an API key below to enable AI-powered narration'}
          </div>
        </div>
      </div>

      {/* Cloud Sync */}
      <div style={styles.section}>
        <label style={styles.label}>Cloud Sync</label>
        <span style={styles.sublabel}>
          Sync your API key, settings, and saves across devices using a private GitHub Gist.
          {!syncStatus.configured && (
            <> Create a token at <a href="https://github.com/settings/tokens/new?scopes=gist&description=AI+Pathfinder+DM" target="_blank" rel="noopener" style={{ color: '#7b68ee' }}>github.com/settings/tokens</a> with only the <strong style={{ color: '#d4c5a9' }}>gist</strong> scope.</>
          )}
        </span>

        {syncStatus.configured ? (
          <div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
              backgroundColor: '#0d1117', borderRadius: '4px', border: '1px solid #30363d', marginBottom: '10px',
            }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#7fff00', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: '#7fff00', fontSize: '12px', fontWeight: 'bold' }}>
                  Linked to GitHub as {syncStatus.username}
                </div>
                <div style={{ color: '#8b949e', fontSize: '10px', marginTop: '2px' }}>
                  {syncStatus.lastSync
                    ? `Last sync: ${new Date(syncStatus.lastSync).toLocaleString()}`
                    : 'Not synced yet'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
              <button
                style={{ ...styles.btn, flex: isMobile ? 1 : 'auto', backgroundColor: '#1a2a3a', borderColor: '#4488cc', color: '#4488cc' }}
                onClick={handlePull}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Pull from Cloud'}
              </button>
              <button
                style={{ ...styles.btn, flex: isMobile ? 1 : 'auto', backgroundColor: '#1a3a1a', borderColor: '#7fff00', color: '#7fff00' }}
                onClick={handlePush}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Push to Cloud'}
              </button>
              <button
                style={{ ...styles.btn, flex: isMobile ? 1 : 'auto', backgroundColor: '#2a1a1a', borderColor: '#ff6b6b', color: '#ff6b6b', fontSize: '11px' }}
                onClick={handleUnlink}
                disabled={syncing}
              >
                Unlink
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '8px', flexDirection: isMobile ? 'column' : 'row' }}>
              <input
                type={showSyncToken ? 'text' : 'password'}
                style={{ ...styles.input, flex: 1 }}
                value={syncToken}
                onChange={e => setSyncToken(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleLinkGist(); }}
                placeholder="ghp_... (GitHub Personal Access Token)"
              />
              <button
                style={{ ...styles.btn, fontSize: '11px', padding: isMobile ? '12px' : '8px 12px', minWidth: isMobile ? 'auto' : 'fit-content' }}
                onClick={() => setShowSyncToken(!showSyncToken)}
              >
                {showSyncToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              style={{ ...styles.btn, marginTop: '8px', width: isMobile ? '100%' : 'auto' }}
              onClick={handleLinkGist}
              disabled={syncing || !syncToken.trim()}
            >
              {syncing ? 'Linking...' : 'Link GitHub & Sync'}
            </button>
          </div>
        )}

        {syncMsg && (
          <div style={styles.status(syncMsg.ok)}>
            {syncMsg.text}
          </div>
        )}
      </div>

      {/* API Key */}
      <div style={styles.section}>
        <label style={styles.label}>Anthropic API Key</label>
        <span style={styles.sublabel}>
          Get your key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style={{ color: '#7b68ee' }}>console.anthropic.com</a>. Your key is stored locally in your browser only.
        </span>
        <div style={{ display: 'flex', gap: '8px', flexDirection: isMobile ? 'column' : 'row' }}>
          <input
            type={showKey ? 'text' : 'password'}
            style={{ ...styles.input, flex: 1 }}
            value={settings.apiKey}
            onChange={e => handleSave('apiKey', e.target.value)}
            placeholder="sk-ant-..."
          />
          <button style={{ ...styles.btn, fontSize: '11px', padding: isMobile ? '12px' : '8px 12px', minWidth: isMobile ? 'auto' : 'fit-content' }}
            onClick={() => setShowKey(!showKey)}>
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Model Selection */}
      <div style={styles.section}>
        <label style={styles.label}>AI Model</label>
        <span style={styles.sublabel}>Choose which Claude model powers your DM. Sonnet is fast and affordable. Opus is more creative but slower.</span>
        <select style={styles.select} value={settings.model}
          onChange={e => handleSave('model', e.target.value)}>
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (Recommended — fast & smart)</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (Fastest, cheapest)</option>
          <option value="claude-opus-4-6">Claude Opus 4.6 (Most creative, slower)</option>
        </select>
      </div>

      {/* Test Connection */}
      <div style={styles.section}>
        <label style={styles.label}>Test Connection</label>
        <span style={styles.sublabel}>Send a test message to verify your API key works.</span>
        <button style={styles.btn} onClick={testConnection} disabled={testing}>
          {testing ? 'Testing...' : 'Test AI DM'}
        </button>
        {testStatus && (
          <div style={styles.status(testStatus.ok)}>
            <div>{testStatus.msg}</div>
            {testStatus.preview && (
              <div style={{ marginTop: '8px', padding: '8px', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '3px', fontSize: '12px', color: '#d4c5a9', fontStyle: 'italic', lineHeight: 1.5 }}>
                "{testStatus.preview.slice(0, 300)}{testStatus.preview.length > 300 ? '...' : ''}"
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save/Load Game */}
      <div style={styles.section}>
        <label style={styles.label}>Save Game</label>
        <span style={styles.sublabel}>Save your current party, campaign progress, and game log.</span>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexDirection: isMobile ? 'column' : 'row' }}>
          <input
            type="text"
            style={{ ...styles.input, flex: 1 }}
            placeholder="Save name (optional)"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveGame(); }}
          />
          <button style={{ ...styles.btn, minWidth: isMobile ? 'auto' : 'fit-content' }} onClick={handleSaveGame}>
            Save
          </button>
        </div>

        {saveMsg && (
          <div style={styles.status(saveMsg.ok)}>
            {saveMsg.text}
          </div>
        )}

        {saves.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <label style={{ ...styles.label, marginBottom: '10px' }}>Saved Games</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {saves.map(save => (
                <div key={save.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', backgroundColor: '#0d1117', borderRadius: '4px',
                  border: '1px solid #30363d',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#d4c5a9', fontSize: '13px', fontWeight: 'bold' }}>
                      {save.name}
                    </div>
                    <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '2px' }}>
                      {new Date(save.savedAt).toLocaleString()}
                      {save.partySize > 0 && ` · ${save.partySize} characters`}
                      {save.campaignName && ` · ${save.campaignName}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexDirection: isMobile ? 'column' : 'row' }}>
                    <button
                      style={{ ...styles.btn, fontSize: '11px', padding: isMobile ? '10px' : '6px 14px', backgroundColor: '#1a3a1a', borderColor: '#7fff00', color: '#7fff00', minWidth: isMobile ? 'auto' : 'fit-content' }}
                      onClick={() => handleLoadGame(save.id)}
                      disabled={loadingId === save.id}
                    >
                      {loadingId === save.id ? '...' : 'Load'}
                    </button>
                    <button
                      style={{ ...styles.btn, fontSize: '11px', padding: isMobile ? '10px' : '6px 10px', backgroundColor: '#2a1a1a', borderColor: '#ff6b6b', color: '#ff6b6b', minWidth: isMobile ? 'auto' : 'fit-content' }}
                      onClick={() => handleDeleteSave(save.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* File-Based Save (Export / Import) */}
      <div style={styles.section}>
        <label style={styles.label}>Save to File</label>
        <span style={styles.sublabel}>
          Export your entire game as a JSON file on your machine. Includes characters, campaign progress,
          GM map data, settings, and all saved games. Import to restore everything.
        </span>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row' }}>
          <button style={{ ...styles.btn, backgroundColor: '#1a2a3a', borderColor: '#4488cc', color: '#4488cc', flex: isMobile ? 1 : 'auto' }}
            onClick={handleExportFile}>
            Export Save File
          </button>
          <button style={{ ...styles.btn, backgroundColor: '#2a1a3a', borderColor: '#b070e0', color: '#b070e0', flex: isMobile ? 1 : 'auto' }}
            onClick={() => importRef.current?.click()}>
            Import Save File
          </button>
          <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={handleImportFile} />
        </div>

        {/* File System Access API — persistent auto-save to a specific file */}
        {window.showSaveFilePicker && (
          <div style={{ marginTop: '8px', padding: '10px', background: '#0d1117', borderRadius: '4px', border: '1px solid #30363d' }}>
            <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? '8px' : '0' }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#d4c5a9', fontSize: '12px', fontWeight: 'bold' }}>Auto-Save to File</div>
                <div style={{ color: '#8b949e', fontSize: '10px', marginTop: '2px' }}>
                  {autoSaveFile
                    ? `Linked: ${autoSaveFile} — saves automatically every 2 min`
                    : 'Link a file to auto-save your game state to disk'}
                </div>
              </div>
              <button
                style={{ ...styles.btn, fontSize: '11px', padding: isMobile ? '10px 12px' : '6px 12px',
                  backgroundColor: autoSaveFile ? '#1a3a1a' : '#3a3a6e',
                  borderColor: autoSaveFile ? '#7fff00' : '#ffd700',
                  color: autoSaveFile ? '#7fff00' : '#ffd700',
                  minWidth: isMobile ? 'auto' : 'fit-content',
                  width: isMobile ? '100%' : 'auto',
                }}
                onClick={handlePickAutoSaveFile}
              >
                {autoSaveFile ? 'Change File' : 'Link File'}
              </button>
            </div>
          </div>
        )}

        {fileMsg && (
          <div style={styles.status(fileMsg.ok)}>
            {fileMsg.text}
          </div>
        )}
      </div>

      {/* DM Preferences */}
      <div style={styles.section}>
        <label style={styles.label}>DM Preferences</label>
        <span style={styles.sublabel}>Configure gameplay rules and optional systems.</span>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ ...styles.label, fontSize: '12px' }}>XP Progression Track</label>
          <span style={styles.sublabel}>Controls how much XP is needed per level. Affects all party members.</span>
          <select style={styles.select} value={dmPrefs.xpTrack}
            onChange={e => updateWorld('dmPreferences', { ...dmPrefs, xpTrack: e.target.value })}>
            <option value="slow">Slow (High XP thresholds — longer campaigns)</option>
            <option value="medium">Medium (Standard PF1e progression)</option>
            <option value="fast">Fast (Low XP thresholds — quick leveling)</option>
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ ...styles.label, fontSize: '12px' }}>Ability Score Generation</label>
          <select style={styles.select} value={dmPrefs.abilityScoreMethod}
            onChange={e => updateWorld('dmPreferences', { ...dmPrefs, abilityScoreMethod: e.target.value })}>
            <option value="4d6-drop-lowest">4d6 Drop Lowest (Standard)</option>
            <option value="standard-array">Standard Array (15, 14, 13, 12, 10, 8)</option>
            <option value="point-buy-15">Point Buy (15 points — Low Fantasy)</option>
            <option value="point-buy-20">Point Buy (20 points — Standard Fantasy)</option>
            <option value="point-buy-25">Point Buy (25 points — High Fantasy)</option>
            <option value="heroic">Heroic (2d6+6)</option>
          </select>
        </div>

        <label style={{ ...styles.label, fontSize: '12px', marginBottom: '10px' }}>Optional Rule Systems</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { key: 'critConfirmation', label: 'Critical Hit Confirmation', desc: 'Require a confirmation roll for critical hits (standard PF1e)' },
            { key: 'heroPoints', label: 'Hero Points', desc: 'Grant hero points for dramatic moments (APG)' },
            { key: 'autoLevelUp', label: 'Auto Level-Up Notifications', desc: 'Show alerts when characters have enough XP to level up' },
            { key: 'encumbranceTracking', label: 'Encumbrance Tracking', desc: 'Track carry weight and movement speed penalties' },
            { key: 'backgroundSkills', label: 'Background Skills', desc: 'Use Unchained background skills (2 bonus ranks/level)' },
            { key: 'woundsVigor', label: 'Wounds & Vigor', desc: 'Replace HP with Wounds/Vigor (Unchained)' },
            { key: 'automaticBonusProgression', label: 'Automatic Bonus Progression', desc: 'Characters gain enhancement bonuses by level, not items (Unchained)' },
            { key: 'sanitySys', label: 'Sanity System', desc: 'Track sanity scores — aberrations, undead, and horrors trigger sanity checks (Horror Adventures)' },
            { key: 'alignmentTracking', label: 'Alignment Tracking', desc: 'Track alignment infractions — killing surrendered foes, evil acts shift alignment over time' },
            { key: 'weatherSystem', label: 'Dynamic Weather', desc: 'Auto-generate weather each travel day — affects visibility, movement, and combat' },
            { key: 'lightTracking', label: 'Light Source Tracking', desc: 'Track torch/lantern duration during dungeon exploration and overland travel' },
            { key: 'trapsAndHaunts', label: 'Trap & Haunt Detection', desc: 'Auto-roll Perception checks for traps and haunts when exploring dungeons (CR 3+)' },
          ].map(opt => (
            <div key={opt.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', backgroundColor: '#0d1117', borderRadius: '4px', border: '1px solid #30363d',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#d4c5a9', fontSize: '12px', fontWeight: 'bold' }}>{opt.label}</div>
                <div style={{ color: '#8b949e', fontSize: '10px' }}>{opt.desc}</div>
              </div>
              <div
                style={{
                  width: isMobile ? '48px' : '40px', height: isMobile ? '28px' : '22px', borderRadius: '11px', cursor: 'pointer',
                  backgroundColor: dmPrefs[opt.key] ? '#3a6a3a' : '#2a2a2e',
                  border: `1px solid ${dmPrefs[opt.key] ? '#7fff00' : '#4a3b2a'}`,
                  position: 'relative', transition: 'all 0.2s',
                  minWidth: isMobile ? '44px' : 'auto',
                  minHeight: isMobile ? '44px' : 'auto',
                  touchAction: 'manipulation',
                }}
                onClick={() => updateWorld('dmPreferences', { ...dmPrefs, [opt.key]: !dmPrefs[opt.key] })}
              >
                <div style={{
                  width: isMobile ? '20px' : '16px', height: isMobile ? '20px' : '16px', borderRadius: '50%',
                  backgroundColor: dmPrefs[opt.key] ? '#7fff00' : '#666',
                  position: 'absolute', top: isMobile ? '4px' : '2px',
                  left: dmPrefs[opt.key] ? (isMobile ? '24px' : '20px') : isMobile ? '4px' : '2px',
                  transition: 'all 0.2s',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div style={{ ...styles.section, backgroundColor: '#0d1117', borderColor: '#30363d' }}>
        <div style={{ color: '#8b949e', fontSize: '12px', lineHeight: 1.6 }}>
          <strong style={{ color: '#d4c5a9' }}>How the AI DM works:</strong><br />
          When running encounters, the AI receives the current campaign state, party info, encounter details, and recent game log. It uses this context plus its knowledge of Pathfinder 1e rules and the Rise of the Runelords storyline to generate immersive narration.<br /><br />
          <strong style={{ color: '#d4c5a9' }}>Without an API key:</strong><br />
          The procedural engine provides atmospheric narration using pre-written text pools and the encounter's built-in read-aloud text from the adventure book. It's less dynamic but fully functional offline.
        </div>
      </div>
    </div>
  );
}
