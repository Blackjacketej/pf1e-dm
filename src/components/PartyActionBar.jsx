import React, { useState, useCallback, useEffect } from 'react';

/**
 * PartyActionBar — per-character action inputs with a single Submit button.
 *
 * Motivation (bug #10): the old Adventure screen only exposed a single
 * "What do you do?" box. During mixed rounds where each PC is doing
 * something different (Alice draws her sword, Bob casts a spell, Carol
 * readies an action) the operator had to narrate each separately, which
 * both fragmented the DM narration and made it awkward to describe an
 * *interaction* between the actions ("Bob's fireball catches Alice's
 * arrow mid-flight...").
 *
 * This component lets each character have its own input, collapsible so
 * screen space isn't wasted on PCs who are idle this round. One Submit
 * collects every filled input and fires a single compound-action payload
 * to dmEngine.narrate('custom', ...) so the DM can resolve all actions
 * as a coherent scene.
 *
 * Props:
 *   party:             Character[] (id + name required)
 *   narrating:         bool — disables inputs & submit while DM responds
 *   onSubmitAll:       (combinedAction: string, perChar: {[id]: string}) => void
 *   initiallyExpanded: bool — start expanded (mobile wants collapsed default)
 *   perChar / setPerChar: optional controlled-state pair. When provided,
 *                      the parent owns the per-character input state, which
 *                      lets it seed a row from outside (e.g. clicking a
 *                      character-tagged context-action suggestion routes
 *                      "Shadowblade — investigate the figure" into
 *                      Shadowblade's input rather than firing the action
 *                      immediately). When omitted, internal state is used
 *                      so existing call sites keep working unchanged.
 */
export default function PartyActionBar({
  party = [],
  narrating = false,
  onSubmitAll,
  initiallyExpanded = true,
  perChar: perCharProp,
  setPerChar: setPerCharProp,
}) {
  const [expanded, setExpanded] = useState(!!initiallyExpanded);
  const [perCharLocal, setPerCharLocal] = useState({}); // fallback when uncontrolled
  const isControlled = !!perCharProp && typeof setPerCharProp === 'function';
  const perChar = isControlled ? perCharProp : perCharLocal;
  const setPerChar = isControlled ? setPerCharProp : setPerCharLocal;

  const setOne = useCallback((id, value) => {
    setPerChar((prev) => ({ ...prev, [id]: value }));
  }, [setPerChar]);

  // Auto-expand when a row gets seeded from outside (e.g. operator clicked
  // a character-tagged suggestion while the bar was collapsed). Without
  // this, the seed would land invisibly and the operator wouldn't see the
  // populated input until they manually expanded the bar.
  useEffect(() => {
    if (!expanded) {
      const anyFilled = Object.values(perChar || {}).some(v => (v || '').trim().length > 0);
      if (anyFilled) setExpanded(true);
    }
  }, [perChar, expanded]);

  const nonEmpty = Object.entries(perChar).filter(([, v]) => (v || '').trim().length > 0);
  const filledCount = nonEmpty.length;

  const handleSubmit = useCallback(() => {
    if (narrating || filledCount === 0) return;
    // Build a compound action string. Order follows the party array so
    // readers (operator + AI) see actions in a consistent initiative-like
    // sequence rather than whatever order inputs were typed in.
    const parts = [];
    for (const c of party) {
      const t = (perChar[c.id] || '').trim();
      if (!t) continue;
      parts.push(`${c.name}: ${t}`);
    }
    const combined = parts.join(' | ');
    onSubmitAll?.(combined, { ...perChar });
    // Clear inputs after submit so the operator can type the next round.
    // setPerChar resolves to either the controlled prop setter or the
    // internal one above — same call shape works for both.
    setPerChar({});
  }, [narrating, filledCount, party, perChar, onSubmitAll, setPerChar]);

  if (!party || party.length === 0) return null;

  const rowStyle = {
    display: 'flex', gap: 6, alignItems: 'center',
    padding: '6px 8px', borderBottom: '1px solid rgba(255,215,0,0.08)',
  };

  return (
    <div style={{
      background: '#151528', border: '1px solid rgba(255,215,0,0.25)',
      borderRadius: 6, marginTop: 6,
    }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', cursor: 'pointer',
          background: 'rgba(255,215,0,0.06)',
          borderBottom: expanded ? '1px solid rgba(255,215,0,0.15)' : 'none',
        }}
        onClick={() => setExpanded((x) => !x)}
      >
        <span style={{ fontSize: 12, color: '#ffd700', fontWeight: 600 }}>
          Party actions
        </span>
        <span style={{ fontSize: 11, color: '#8b949e' }}>
          ({filledCount > 0 ? `${filledCount} filled` : `${party.length} character${party.length === 1 ? '' : 's'}`})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 14, color: '#8b949e' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {expanded && (
        <div>
          {party.map((c) => (
            <div key={c.id} style={rowStyle}>
              <div style={{
                minWidth: 110, maxWidth: 140, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: '#ffd700', fontSize: 12, fontWeight: 600,
              }}>
                {c.name}
              </div>
              <div style={{ color: '#888', fontSize: 11, minWidth: 60 }}>
                HP {c.currentHP ?? '?'}
              </div>
              <input
                type="text"
                value={perChar[c.id] || ''}
                onChange={(e) => setOne(c.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    handleSubmit();
                  }
                }}
                disabled={narrating}
                placeholder={narrating ? 'DM is responding...' : `What does ${c.name} do?`}
                style={{
                  flex: 1, minWidth: 120, padding: '6px 8px',
                  background: '#0a0a14', color: '#e6e6e6',
                  border: '1px solid #30363d', borderRadius: 4,
                  fontSize: 12, fontFamily: 'inherit',
                }}
              />
            </div>
          ))}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', padding: '6px 10px',
          }}>
            <span style={{ color: '#8b949e', fontSize: 11 }}>
              {filledCount > 0
                ? `${filledCount} of ${party.length} will act. Submit resolves all together.`
                : 'Fill one or more rows, then Submit.'}
            </span>
            <button
              style={{
                background: filledCount > 0 ? '#1a3a1a' : '#2a2a3e',
                border: `1px solid ${filledCount > 0 ? '#7fff00' : '#444'}`,
                color: filledCount > 0 ? '#7fff00' : '#666',
                padding: '6px 14px', borderRadius: 4,
                cursor: filledCount > 0 && !narrating ? 'pointer' : 'not-allowed',
                fontSize: 12, fontWeight: 600,
                opacity: narrating ? 0.5 : 1,
              }}
              disabled={filledCount === 0 || narrating}
              onClick={handleSubmit}
              title="Submit all filled actions together (Ctrl+Enter in any input)"
            >
              {narrating ? '…' : 'Submit all'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
