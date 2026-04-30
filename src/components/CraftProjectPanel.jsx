// CraftProjectPanel.jsx
// Displays a character's ongoing craft projects as a compact ledger with
// progress bars, current status, and quick controls (pause/resume/abandon).

import React from 'react';
import {
  projectProgressSummary,
  projectEffectiveDc,
  setProjectStatus,
} from '../utils/craftDowntime.js';

export default function CraftProjectPanel({
  character,
  onUpdateCharacter,
  onOpenCraftModal,
  readOnly = false,
}) {
  const projects = Array.isArray(character?.craftProjects) ? character.craftProjects : [];

  const updateProject = (projectId, updater) => {
    if (!onUpdateCharacter) return;
    const next = projects.map((p) => (p.id === projectId ? updater(p) : p));
    onUpdateCharacter({ ...character, craftProjects: next });
  };

  const pauseResume = (p) => {
    updateProject(p.id, (prev) =>
      setProjectStatus(prev, prev.status === 'paused' ? 'in-progress' : 'paused'),
    );
  };

  const abandonProject = (p) => {
    if (!confirm?.(`Abandon "${p.itemName}"? Progress will be lost.`)) return;
    updateProject(p.id, (prev) => setProjectStatus(prev, 'abandoned'));
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>Ongoing Craft Projects</div>
        {!readOnly && onOpenCraftModal && (
          <button style={styles.newBtn} onClick={onOpenCraftModal}>
            + New Project
          </button>
        )}
      </div>

      {projects.length === 0 && (
        <div style={styles.empty}>No active craft projects.</div>
      )}

      {projects.map((p) => {
        const sum = projectProgressSummary(p);
        const effDc = projectEffectiveDc(p);
        return (
          <div key={p.id} style={styles.projectCard}>
            <div style={styles.projectHeader}>
              <div style={styles.projectName}>{p.itemName}</div>
              <div style={styles.projectMeta}>
                {p.subSkill} · DC {effDc}
                {p.accelerated ? ' (accelerated)' : ''}
              </div>
            </div>
            <div style={styles.progressRow}>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${sum.pct}%` }} />
              </div>
              <div style={styles.progressLabel}>
                {sum.hasMasterwork
                  ? `Base ${sum.basePct}% · MW ${sum.mwPct}% · Overall ${sum.pct}%`
                  : `${sum.progressGP.toFixed(1)} / ${sum.targetGP} gp · ${sum.pct}%`
                }
              </div>
            </div>
            {sum.hasMasterwork && (
              <div style={styles.progressRow}>
                <div style={{ ...styles.progressTrack, height: 6 }}>
                  <div style={{
                    ...styles.progressFill,
                    width: `${sum.mwPct}%`,
                    background: sum.mwFinished
                      ? 'linear-gradient(90deg, #80b4ff, #60f0ff)'
                      : 'linear-gradient(90deg, #c0a0ff, #8060ff)',
                  }} />
                </div>
                <div style={{ ...styles.progressLabel, fontSize: 10, color: '#b0a0d0' }}>
                  MW: {sum.mwProgressGP.toFixed(1)} / {sum.mwTargetGP} gp
                  {sum.mwFinished ? ' ✓' : ''}
                </div>
              </div>
            )}
            <div style={styles.statusRow}>
              <span
                style={{
                  ...styles.statusPill,
                  background: statusColor(sum.status),
                }}
              >
                {sum.status}
              </span>
              {sum.failures > 0 && (
                <span style={styles.warnPill}>
                  {sum.failures} fail{sum.failures > 1 ? 's' : ''} ·{' '}
                  {sum.materialsLossGP.toFixed(1)} gp materials lost
                </span>
              )}
              {p.commissionedBy && (
                <span style={styles.commissionPill}>commissioned</span>
              )}
              {!readOnly && sum.status !== 'completed' && sum.status !== 'abandoned' && (
                <>
                  <button style={styles.smallBtn} onClick={() => pauseResume(p)}>
                    {sum.status === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <button style={styles.dangerBtn} onClick={() => abandonProject(p)}>
                    Abandon
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function statusColor(status) {
  switch (status) {
    case 'in-progress': return 'rgba(100, 200, 100, 0.3)';
    case 'paused': return 'rgba(255, 180, 60, 0.3)';
    case 'completed': return 'rgba(100, 140, 255, 0.3)';
    case 'abandoned': return 'rgba(180, 80, 80, 0.3)';
    default: return 'rgba(140, 140, 140, 0.3)';
  }
}

const styles = {
  container: {
    background: 'rgba(40, 28, 18, 0.6)',
    border: '1px solid rgba(255, 215, 0, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    color: '#d4c5a9',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#ffd700',
    fontWeight: 'bold',
    fontSize: 14,
  },
  newBtn: {
    background: 'rgba(255, 215, 0, 0.2)',
    border: '1px solid #ffd700',
    color: '#ffd700',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  empty: {
    color: '#8a7d66',
    fontSize: 12,
    fontStyle: 'italic',
  },
  projectCard: {
    background: 'rgba(20, 14, 8, 0.5)',
    border: '1px solid rgba(255, 215, 0, 0.15)',
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  projectHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  projectName: {
    color: '#ffd700',
    fontWeight: 'bold',
    fontSize: 13,
  },
  projectMeta: {
    color: '#a69a80',
    fontSize: 11,
  },
  progressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  progressTrack: {
    flex: 1,
    height: 10,
    background: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #ffd700, #ffa500)',
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: 11,
    color: '#d4c5a9',
    whiteSpace: 'nowrap',
  },
  statusRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  statusPill: {
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  warnPill: {
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    background: 'rgba(255, 100, 100, 0.2)',
    color: '#ff9080',
  },
  commissionPill: {
    padding: '2px 8px',
    borderRadius: 12,
    fontSize: 10,
    background: 'rgba(100, 180, 255, 0.2)',
    color: '#80b4ff',
  },
  smallBtn: {
    background: 'rgba(255, 215, 0, 0.15)',
    border: '1px solid rgba(255, 215, 0, 0.4)',
    color: '#ffd700',
    padding: '2px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
  },
  dangerBtn: {
    background: 'rgba(180, 80, 80, 0.2)',
    border: '1px solid rgba(180, 80, 80, 0.5)',
    color: '#ff9080',
    padding: '2px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
  },
};
