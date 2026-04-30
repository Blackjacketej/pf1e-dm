/**
 * FamiliarPanel — Phase 7.5 familiar management UI.
 *
 * One panel per character that has (or had) a familiar. Surfaces:
 *   - Current status summary (with master / separated / out-of-range / lost / ritual)
 *   - Range control: a "with master" checkbox + distance input + GM note
 *   - Mark-lost control (for when a familiar is killed/dismissed mid-adventure)
 *   - Begin / complete replacement ritual flow (CRB p. 82 — 1 week wait,
 *     200 gp × master level, 8 hours) with a picker for the new familiar
 *
 * Engine imports only — all rules logic lives in familiarEngine.js. This
 * component only glues the state wiring (setParty / setWorldState) to the
 * helper functions.
 */
import React, { useState, useMemo } from 'react';
import {
  getFamiliarById,
  getFamiliarLocation,
  setFamiliarLocation,
  getFamiliarStatusSummary,
  isFamiliarInRange,
  markFamiliarLost,
  canReplaceFamiliar,
  beginReplaceFamiliarRitual,
  completeReplaceFamiliarRitual,
  listFamiliarOptions,
  getReplaceFamiliarCost,
  getMasterClassLevel,
  deriveFamiliarStats,
  aggregateFamiliarModifiers,
  FAMILIAR_ABILITY_RANGE_MILES,
} from '../utils/familiarEngine';

const sty = {
  panel: {
    marginTop: 12,
    padding: 14,
    background: '#16213e',
    border: '1px solid rgba(255,215,0,0.25)',
    borderRadius: 8,
    color: '#e0d6c8',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  title: { color: '#ffd700', fontWeight: 700, fontSize: 15 },
  subtitle: { color: '#8b949e', fontSize: 11, marginTop: 2 },
  status: (inRange) => ({
    fontSize: 12,
    padding: '6px 10px',
    borderRadius: 4,
    background: inRange ? '#142a1e' : '#2e1a1a',
    border: `1px solid ${inRange ? '#2d5a3d' : '#5a2d2d'}`,
    color: inRange ? '#9ecc9e' : '#e89393',
    marginBottom: 10,
  }),
  row: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
  label: { fontSize: 11, color: '#b0a690', minWidth: 70 },
  input: {
    flex: 1, minWidth: 80, padding: '6px 8px',
    background: '#0d1117', border: '1px solid #30363d',
    borderRadius: 4, color: '#e0d6c8', fontSize: 12,
  },
  checkbox: { marginRight: 6 },
  button: (disabled, danger) => ({
    padding: '6px 12px',
    background: disabled ? '#2a2a3e' : danger ? '#4a1a1a' : '#1a2e4e',
    border: `1px solid ${disabled ? '#30363d' : danger ? '#8b2d2d' : '#ffd700'}`,
    borderRadius: 4,
    color: disabled ? '#555' : danger ? '#e89393' : '#ffd700',
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }),
  statsBox: {
    marginTop: 10,
    padding: 10,
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
  },
  statsTitle: {
    color: '#ffd700',
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
    gap: '6px 10px',
    fontSize: 11,
  },
  statCell: { display: 'flex', flexDirection: 'column' },
  statLabel: { color: '#8b949e', fontSize: 10, textTransform: 'uppercase' },
  statValue: { color: '#e0d6c8', fontSize: 12, fontWeight: 600 },
  bonusLine: {
    marginTop: 6,
    fontSize: 11,
    color: '#9ecc9e',
    lineHeight: 1.5,
  },
  bonusLineDim: {
    marginTop: 6,
    fontSize: 11,
    color: '#6a6a6a',
    fontStyle: 'italic',
    lineHeight: 1.5,
  },
  ritualBox: {
    marginTop: 10,
    padding: 10,
    background: '#0d1117',
    border: '1px dashed #ffd700',
    borderRadius: 4,
  },
  ritualTitle: { color: '#ffd700', fontSize: 12, fontWeight: 700, marginBottom: 6 },
  ritualInfo: { color: '#b0a690', fontSize: 11, lineHeight: 1.5, marginBottom: 8 },
  ritualError: { color: '#f85149', fontSize: 11, marginTop: 4 },
  select: {
    flex: 1, padding: '6px 8px',
    background: '#0d1117', border: '1px solid #30363d',
    borderRadius: 4, color: '#e0d6c8', fontSize: 12,
  },
};

export default function FamiliarPanel({ char, worldState, setWorldState, setParty, addLog }) {
  // All hooks must run unconditionally before any early return (rules of
  // hooks). These helpers are all pure and cheap, and short-circuit
  // cleanly when char has no familiar, so it's safe to call them always.
  const [newFamId, setNewFamId] = useState('');
  const ritualCheck = useMemo(
    () => canReplaceFamiliar(char, worldState),
    [char, worldState]
  );
  const replacementOptions = useMemo(() => {
    if (!char?.familiar?.id) return [];
    const status = char.familiar.status;
    if (status !== 'lost' && status !== 'ritualInProgress') return [];
    return listFamiliarOptions(char).filter((o) => o.eligible);
  }, [char]);

  // Gate: only render if the character has (or had) a familiar-granting
  // class. The engine-layer getMasterClassLevel returns 0 for everyone
  // else, so this matches the aggregateFamiliarModifiers gate.
  const masterLevel = getMasterClassLevel(char);
  const hasFam = !!char?.familiar?.id;
  if (masterLevel < 1 || !hasFam) return null;

  const fam = char.familiar;
  const entry = getFamiliarById(fam.id);
  const loc = getFamiliarLocation(char, worldState);
  const inRange = isFamiliarInRange(char, worldState);
  const summary = getFamiliarStatusSummary(char, worldState);
  const isLost = fam.status === 'lost';
  const isRitual = fam.status === 'ritualInProgress';

  // Phase 7.6 — derived stats + master-bonus rollup for display
  const stats = (!isLost && !isRitual) ? deriveFamiliarStats(char, fam.id) : null;
  const mods = aggregateFamiliarModifiers(char, { worldState });
  const bonusApplied = mods.applied && mods.applied.length > 0;

  // ─── Handlers ────────────────────────────────────────────────────

  const updateChar = (patch) => {
    setParty((prev) => prev.map((c) => (c.id === char.id ? { ...c, ...patch } : c)));
  };

  const handleWithMasterToggle = (checked) => {
    setWorldState((prev) => setFamiliarLocation(prev, char.id, {
      withMaster: checked,
      ...(checked ? { distanceMiles: 0 } : {}),
    }));
  };

  const handleDistanceChange = (value) => {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return;
    setWorldState((prev) => setFamiliarLocation(prev, char.id, { distanceMiles: num }));
  };

  const handleNoteChange = (value) => {
    setWorldState((prev) => setFamiliarLocation(prev, char.id, { note: value }));
  };

  const handleMarkLost = () => {
    const next = markFamiliarLost(char, worldState);
    setParty((prev) => prev.map((c) => (c.id === char.id ? next : c)));
    if (addLog) {
      addLog(`${char.name}'s ${entry?.name || 'familiar'} has been lost. The replacement ritual may begin in 1 week.`, 'danger');
    }
  };

  const handleBeginRitual = () => {
    if (!ritualCheck.canReplace) return;
    const cost = ritualCheck.cost;
    const nextChar = beginReplaceFamiliarRitual(char, worldState);
    // Deduct gp. Support both .gp and .gold field conventions.
    if (Number.isFinite(nextChar.gp)) nextChar.gp = Math.max(0, (nextChar.gp || 0) - cost);
    else if (Number.isFinite(nextChar.gold)) nextChar.gold = Math.max(0, (nextChar.gold || 0) - cost);
    setParty((prev) => prev.map((c) => (c.id === char.id ? nextChar : c)));
    if (addLog) {
      addLog(`${char.name} begins the familiar replacement ritual (${cost} gp, 8 hours).`, 'action');
    }
  };

  const handleCompleteRitual = () => {
    if (!newFamId) return;
    const next = completeReplaceFamiliarRitual(char, newFamId);
    setParty((prev) => prev.map((c) => (c.id === char.id ? next : c)));
    // Reset the location for the new familiar (with master by default).
    setWorldState((prev) => setFamiliarLocation(prev, char.id, {
      withMaster: true, distanceMiles: 0, note: '',
    }));
    setNewFamId('');
    if (addLog) {
      const newEntry = getFamiliarById(newFamId);
      addLog(`${char.name}'s new familiar — ${newEntry?.name || newFamId} — appears and binds itself to her.`, 'success');
    }
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div style={sty.panel}>
      <div style={sty.header}>
        <div>
          <div style={sty.title}>
            {char.name} — {entry?.name || fam.id}
          </div>
          <div style={sty.subtitle}>
            {char.class} {masterLevel} · Replace cost: {getReplaceFamiliarCost(masterLevel)} gp
          </div>
        </div>
      </div>

      <div style={sty.status(inRange && !isLost && !isRitual)}>{summary}</div>

      {/* Derived stat block — only while the familiar is bound */}
      {stats && (
        <div style={sty.statsBox}>
          <div style={sty.statsTitle}>
            {stats.size} {entry?.kind === 'improved' ? 'improved familiar' : 'familiar'}
            {stats.alignment ? ` · ${stats.alignment}` : ''}
          </div>
          <div style={sty.statsGrid}>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>HP</div>
              <div style={sty.statValue}>{stats.hp}</div>
            </div>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>AC</div>
              <div style={sty.statValue}>{stats.ac}{stats.naturalArmorAdj ? ` (+${stats.naturalArmorAdj} NA)` : ''}</div>
            </div>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>Attack</div>
              <div style={sty.statValue}>
                {stats.attacks.attackBonus >= 0 ? `+${stats.attacks.attackBonus}` : stats.attacks.attackBonus}
                {stats.attacks.damage ? ` (${stats.attacks.damage})` : ''}
              </div>
            </div>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>Fort</div>
              <div style={sty.statValue}>{stats.saves.fort >= 0 ? `+${stats.saves.fort}` : stats.saves.fort}</div>
            </div>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>Ref</div>
              <div style={sty.statValue}>{stats.saves.ref >= 0 ? `+${stats.saves.ref}` : stats.saves.ref}</div>
            </div>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>Will</div>
              <div style={sty.statValue}>{stats.saves.will >= 0 ? `+${stats.saves.will}` : stats.saves.will}</div>
            </div>
            <div style={sty.statCell}>
              <div style={sty.statLabel}>INT</div>
              <div style={sty.statValue}>{stats.abilities.INT}</div>
            </div>
            {stats.sr != null && (
              <div style={sty.statCell}>
                <div style={sty.statLabel}>SR</div>
                <div style={sty.statValue}>{stats.sr}</div>
              </div>
            )}
          </div>
          {stats.sharedAbilityLabels.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#8b949e' }}>
              <strong style={{ color: '#b0a690' }}>Shared:</strong>{' '}
              {stats.sharedAbilityLabels.join(', ')}
            </div>
          )}
          {/* Master bonus line — gated by range + status via aggregator */}
          {stats.masterBonus && (
            bonusApplied ? (
              <div style={sty.bonusLine}>
                <strong>Master bonus:</strong>{' '}
                {mods.applied.map((a) => a.text).join('; ')}
              </div>
            ) : (
              <div style={sty.bonusLineDim}>
                Master bonus inactive — out of {FAMILIAR_ABILITY_RANGE_MILES}-mile range (CRB p. 82).
              </div>
            )
          )}
        </div>
      )}

      {/* Range controls — hidden during lost/ritual */}
      {!isLost && !isRitual && (
        <>
          <div style={sty.row}>
            <label style={{ ...sty.label, minWidth: 'auto', cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={sty.checkbox}
                checked={!!loc.withMaster}
                onChange={(e) => handleWithMasterToggle(e.target.checked)}
              />
              With master
            </label>
          </div>
          {!loc.withMaster && (
            <div style={sty.row}>
              <span style={sty.label}>Distance</span>
              <input
                type="number"
                step="0.1"
                min="0"
                style={{ ...sty.input, maxWidth: 100 }}
                value={loc.distanceMiles}
                onChange={(e) => handleDistanceChange(e.target.value)}
              />
              <span style={{ fontSize: 11, color: '#8b949e' }}>
                miles (range limit: {FAMILIAR_ABILITY_RANGE_MILES} mi — CRB p. 82)
              </span>
            </div>
          )}
          <div style={sty.row}>
            <span style={sty.label}>Note</span>
            <input
              type="text"
              style={sty.input}
              placeholder="e.g. scouting the tavern roof"
              value={loc.note || ''}
              onChange={(e) => handleNoteChange(e.target.value)}
            />
          </div>
          <div style={sty.row}>
            <button style={sty.button(false, true)} onClick={handleMarkLost}>
              Mark Lost / Dismissed
            </button>
          </div>
        </>
      )}

      {/* Ritual — lost state */}
      {isLost && (
        <div style={sty.ritualBox}>
          <div style={sty.ritualTitle}>Replacement Ritual</div>
          <div style={sty.ritualInfo}>
            Per CRB p. 82, the ritual costs {ritualCheck.cost} gp and takes 8 hours
            to complete, but cannot begin until 1 week has passed since the
            familiar was lost.
          </div>
          <button
            style={sty.button(!ritualCheck.canReplace)}
            disabled={!ritualCheck.canReplace}
            onClick={handleBeginRitual}
            title={ritualCheck.canReplace ? 'Begin the 8-hour ritual' : ritualCheck.reason}
          >
            Begin Ritual
          </button>
          {!ritualCheck.canReplace && (
            <div style={sty.ritualError}>{ritualCheck.reason}</div>
          )}
        </div>
      )}

      {/* Ritual — in progress */}
      {isRitual && (
        <div style={sty.ritualBox}>
          <div style={sty.ritualTitle}>Ritual In Progress</div>
          <div style={sty.ritualInfo}>
            Choose the creature that will answer the summons. When the ritual
            completes, your new familiar appears.
          </div>
          <div style={sty.row}>
            <select
              style={sty.select}
              value={newFamId}
              onChange={(e) => setNewFamId(e.target.value)}
            >
              <option value="">— Select new familiar —</option>
              {replacementOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
            <button
              style={sty.button(!newFamId)}
              disabled={!newFamId}
              onClick={handleCompleteRitual}
            >
              Complete Ritual
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
