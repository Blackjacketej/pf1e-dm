import React, { useState, useEffect } from 'react';
import dmEngine from '../services/dmEngine';

export default function ApiKeyBanner({ onOpenSettings }) {
  const [hasKey, setHasKey] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const settings = dmEngine.getSettings();
    setHasKey(!!settings?.apiKey);
  }, []);

  if (hasKey || dismissed) return null;

  const handleSave = async () => {
    if (!keyValue.trim()) return;
    setSaving(true);
    setError('');
    try {
      dmEngine.updateSettings({ apiKey: keyValue.trim() });
      setHasKey(true);
    } catch (err) {
      setError('Failed to save. Try again.');
    }
    setSaving(false);
  };

  return (
    <div style={{
      backgroundColor: '#3a2a00',
      border: '1px solid #ffa500',
      borderRadius: '8px',
      padding: '12px 14px',
      margin: '8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <span style={{ fontSize: '18px' }}>🔑</span>
          <div>
            <div style={{ color: '#ffa500', fontWeight: 'bold', fontSize: '13px' }}>
              API Key Required
            </div>
            <div style={{ color: '#d4a060', fontSize: '12px', lineHeight: 1.4 }}>
              Set your Claude API key to enable AI narration. Without it, the game uses basic fallback text.
            </div>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#8b949e',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '4px',
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {!showInput ? (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowInput(true)}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#4a3a10',
              border: '1px solid #ffa500',
              color: '#ffa500',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
            }}
          >
            Enter API Key
          </button>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              style={{
                padding: '10px 14px',
                backgroundColor: 'transparent',
                border: '1px solid #8b949e',
                color: '#8b949e',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Settings
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <input
            type="password"
            value={keyValue}
            onChange={e => setKeyValue(e.target.value)}
            placeholder="sk-ant-..."
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#1a1a2e',
              border: '1px solid #ffa500',
              borderRadius: '6px',
              color: '#d4c5a9',
              fontSize: '13px',
              boxSizing: 'border-box',
            }}
            autoFocus
          />
          {error && <div style={{ color: '#ff6b6b', fontSize: '11px' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSave}
              disabled={saving || !keyValue.trim()}
              style={{
                flex: 1,
                padding: '10px',
                backgroundColor: '#2a4a2a',
                border: '1px solid #7fff00',
                color: '#7fff00',
                borderRadius: '6px',
                cursor: saving ? 'wait' : 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                opacity: saving || !keyValue.trim() ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Key'}
            </button>
            <button
              onClick={() => { setShowInput(false); setKeyValue(''); setError(''); }}
              style={{
                padding: '10px 14px',
                backgroundColor: 'transparent',
                border: '1px solid #8b949e',
                color: '#8b949e',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
