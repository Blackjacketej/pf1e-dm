import React, { useState, useMemo } from 'react';
import {
  promoteNovelFaction, mergeFactions, renameFaction, discardNovelFaction,
  listPendingNovelFactions, setFactionRelation,
} from '../services/campaign.js';
import { tickCampaign } from '../services/factionSimulation.js';
import { relationLabel } from '../services/factionLife.js';
import { auditCanonicalNPCFactionRefs } from '../services/sandpointHydrator.js';

const styles = {
  container: { backgroundColor: '#1a1a2e', border: '2px solid #ffd700', borderRadius: '8px', padding: '16px', color: '#d4c5a9', height: '100%', overflowY: 'auto' },
  section: { marginBottom: '16px', backgroundColor: '#2a2a4e', border: '1px solid rgba(255, 215, 0, 0.3)', borderRadius: '4px', padding: '12px' },
  title: { color: '#ffd700', fontWeight: 'bold', fontSize: '14px', marginBottom: '12px', textTransform: 'uppercase' },
  subtitle: { color: '#ffd700', fontSize: '12px', marginBottom: '8px' },
  btn: { padding: '6px 12px', border: '1px solid #ffd700', borderRadius: '4px', backgroundColor: '#2a2a4e', color: '#ffd700', cursor: 'pointer', fontSize: '12px', marginRight: '6px', marginBottom: '6px' },
  btnDanger: { padding: '6px 12px', border: '1px solid #ff6b6b', borderRadius: '4px', backgroundColor: '#2a2a4e', color: '#ff6b6b', cursor: 'pointer', fontSize: '12px', marginRight: '6px', marginBottom: '6px' },
  card: { backgroundColor: '#1a1a2e', border: '1px solid rgba(255, 215, 0, 0.2)', borderRadius: '4px', padding: '10px', fontSize: '12px', marginBottom: '8px' },
  pendingCard: { backgroundColor: '#2a1a2e', border: '1px dashed #ff9f43', borderRadius: '4px', padding: '10px', fontSize: '12px', marginBottom: '8px' },
  label: { color: '#8b949e', fontSize: '10px', textTransform: 'uppercase', marginRight: '4px' },
  resourceBar: { display: 'inline-block', width: '60px', height: '8px', border: '1px solid #ffd700', marginLeft: '4px', verticalAlign: 'middle' },
  resourceFill: { height: '100%', backgroundColor: '#ffd700' },
  input: { padding: '4px 8px', border: '1px solid #ffd700', borderRadius: '4px', backgroundColor: '#1a1a2e', color: '#ffd700', fontSize: '12px', marginRight: '8px' },
  relation: { display: 'inline-block', padding: '2px 6px', marginRight: '4px', fontSize: '10px', border: '1px solid #8b949e', borderRadius: '3px' },
  moodBadge: { display: 'inline-block', padding: '2px 8px', fontSize: '10px', textTransform: 'uppercase', borderRadius: '3px', border: '1px solid' },
};

const MOOD_COLORS = {
  triumphant:  { color: '#48dbfb', borderColor: '#48dbfb' },
  ascendant:   { color: '#1dd1a1', borderColor: '#1dd1a1' },
  confident:   { color: '#feca57', borderColor: '#feca57' },
  stable:      { color: '#d4c5a9', borderColor: '#8b949e' },
  wary:        { color: '#ff9f43', borderColor: '#ff9f43' },
  beleaguered: { color: '#ee5253', borderColor: '#ee5253' },
  desperate:   { color: '#c44569', borderColor: '#c44569' },
  rebuilding:  { color: '#a29bfe', borderColor: '#a29bfe' },
};

function ResourceRow({ label, value }) {
  return (
    <div style={{ marginBottom: '2px' }}>
      <span style={styles.label}>{label}</span>
      <span>{Math.round(value)}</span>
      <span style={styles.resourceBar}>
        <span style={{ ...styles.resourceFill, display: 'block', width: `${value}%` }} />
      </span>
    </div>
  );
}

function FactionCard({ faction, factionId, allFactions, onRename, onRelate }) {
  const [expanded, setExpanded] = useState(false);
  const [newName, setNewName] = useState(faction.name);
  const life = faction.life || {};
  const mood = life.mood || 'stable';
  const moodStyle = MOOD_COLORS[mood] || MOOD_COLORS.stable;

  return (
    <div style={faction.pending ? styles.pendingCard : styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div>
          <strong style={{ color: '#ffd700' }}>{faction.name}</strong>
          <span style={{ color: '#8b949e', marginLeft: '8px' }}>[{faction.archetype}]</span>
          {faction.pending && <span style={{ color: '#ff9f43', marginLeft: '8px', fontSize: '10px' }}>PENDING</span>}
        </div>
        <span style={{ ...styles.moodBadge, ...moodStyle }}>{mood}</span>
      </div>
      {life.mottoOrBelief && <div style={{ fontStyle: 'italic', color: '#8b949e', marginBottom: '4px' }}>"{life.mottoOrBelief}"</div>}
      <button style={styles.btn} onClick={() => setExpanded(e => !e)}>{expanded ? 'Collapse' : 'Details'}</button>

      {expanded && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,215,0,0.15)' }}>
          {life.leadership?.current && (
            <div><span style={styles.label}>Leader</span>{life.leadership.title} {life.leadership.current} <span style={styles.label}>Legit</span>{Math.round(life.leadership.legitimacy)}%</div>
          )}
          {life.resources && (
            <div style={{ marginTop: '6px' }}>
              <ResourceRow label="Wealth"    value={life.resources.wealth} />
              <ResourceRow label="Manpower"  value={life.resources.manpower} />
              <ResourceRow label="Influence" value={life.resources.influence} />
              <ResourceRow label="Secrecy"   value={life.resources.secrecy} />
              <ResourceRow label="Morale"    value={life.resources.morale} />
            </div>
          )}
          {life.goals && life.goals.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div style={styles.label}>Goals</div>
              {life.goals.map(g => (
                <div key={g.id} style={{ fontSize: '11px' }}>
                  • {g.narrative} ({g.type}) — {Math.round(g.progress)}% [{g.priority}]
                </div>
              ))}
            </div>
          )}
          {life.secrets && life.secrets.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div style={styles.label}>Secrets ({life.secrets.filter(s => !s.exposed).length} hidden / {life.secrets.filter(s => s.exposed).length} exposed)</div>
            </div>
          )}
          {faction.relations && Object.keys(faction.relations).length > 0 && (
            <div style={{ marginTop: '6px' }}>
              <div style={styles.label}>Relations</div>
              {Object.entries(faction.relations).map(([otherId, rel]) => (
                <span key={otherId} style={styles.relation}>
                  {allFactions[otherId]?.name || otherId}: {relationLabel(rel.score)} ({rel.score})
                </span>
              ))}
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            <input style={styles.input} value={newName} onChange={e => setNewName(e.target.value)} />
            <button style={styles.btn} onClick={() => onRename(factionId, newName)}>Rename</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NovelQueuePanel({ campaign, onPromote, onDiscard, onMerge }) {
  const pending = listPendingNovelFactions(campaign);
  const [mergeTargets, setMergeTargets] = useState({});
  if (pending.length === 0) return (
    <div style={styles.section}>
      <div style={styles.title}>Novel Faction Queue</div>
      <div style={{ color: '#8b949e', fontSize: '11px' }}>No pending factions — the AI hasn't invented anything new yet.</div>
    </div>
  );

  const canonicalOptions = Object.entries(campaign.factions || {})
    .filter(([id, f]) => !f.pending)
    .map(([id, f]) => ({ id, name: f.name }));

  return (
    <div style={styles.section}>
      <div style={styles.title}>Novel Faction Queue ({pending.length})</div>
      <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '8px' }}>
        The AI invented these factions on-the-fly. Review each: promote to canon, merge into an existing faction, or discard.
      </div>
      {pending.map(entry => (
        <div key={entry.id} style={styles.pendingCard}>
          <div><strong style={{ color: '#ff9f43' }}>{entry.suggestedName}</strong> <span style={{ color: '#8b949e' }}>[{entry.archetype}]</span></div>
          <div style={{ fontSize: '11px', color: '#8b949e' }}>
            Species: {entry.species || 'unknown'} · Region: {entry.region || 'unbound'} · First seen: {entry.firstSeenNpc || 'unknown'}
          </div>
          {entry.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '10px', color: '#feca57', marginTop: '4px' }}>⚠ {w}</div>
          ))}
          <div style={{ marginTop: '8px' }}>
            <button style={styles.btn} onClick={() => onPromote(entry.id, entry.suggestedName, entry.region)}>Promote to Canon</button>
            <select
              style={styles.input}
              value={mergeTargets[entry.id] || ''}
              onChange={e => setMergeTargets({ ...mergeTargets, [entry.id]: e.target.value })}
            >
              <option value="">Merge into...</option>
              {canonicalOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button
              style={styles.btn}
              disabled={!mergeTargets[entry.id]}
              onClick={() => onMerge(entry.id, mergeTargets[entry.id])}
            >
              Merge
            </button>
            <button style={styles.btnDanger} onClick={() => onDiscard(entry.id)}>Discard</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * CanonicalRefWarnings — surfaces NPC → faction refs that don't resolve in the
 * current campaign, plus factions with zero canonical members. Pulls fresh
 * data from auditCanonicalNPCFactionRefs rather than relying on the
 * non-enumerable __attachWarnings (which JSON.stringify drops on persist).
 * Collapsible and dismissable per session so it doesn't nag after review.
 */
function CanonicalRefWarnings({ campaign }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const audit = useMemo(() => auditCanonicalNPCFactionRefs(campaign), [campaign]);
  if (dismissed) return null;
  const { unresolved, orphanedFactions } = audit;
  if (unresolved.length === 0 && orphanedFactions.length === 0) return null;
  return (
    <div style={{
      ...styles.section,
      borderColor: '#ff9f43',
      backgroundColor: '#2a1f1a',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <div style={{ ...styles.title, color: '#ff9f43' }}>
          ⚠ Canonical Reference Gaps ({unresolved.length + orphanedFactions.length})
        </div>
        <div>
          <button style={styles.btn} onClick={() => setExpanded(e => !e)}>{expanded ? 'Hide' : 'Show'}</button>
          <button style={styles.btnDanger} onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      </div>
      {expanded && (
        <div style={{ fontSize: '11px', color: '#d4c5a9' }}>
          {unresolved.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={styles.label}>NPCs referencing missing factions ({unresolved.length})</div>
              {unresolved.slice(0, 12).map((w, i) => (
                <div key={i} style={{ color: '#feca57', marginLeft: '8px' }}>
                  • <strong>{w.npcId}</strong> → <code>{w.factionId}</code>
                  <span style={{ color: '#8b949e', marginLeft: '6px' }}>[{w.canonicalSource}]</span>
                </div>
              ))}
              {unresolved.length > 12 && (
                <div style={{ color: '#8b949e', marginLeft: '8px' }}>...and {unresolved.length - 12} more</div>
              )}
            </div>
          )}
          {orphanedFactions.length > 0 && (
            <div>
              <div style={styles.label}>Factions with no canonical NPC members ({orphanedFactions.length})</div>
              {orphanedFactions.slice(0, 12).map((fid, i) => (
                <div key={i} style={{ color: '#ff9f43', marginLeft: '8px' }}>
                  • <code>{fid}</code>
                  <span style={{ color: '#8b949e', marginLeft: '6px' }}>
                    ({campaign.factions?.[fid]?.name || 'unnamed'})
                  </span>
                </div>
              ))}
              {orphanedFactions.length > 12 && (
                <div style={{ color: '#8b949e', marginLeft: '8px' }}>...and {orphanedFactions.length - 12} more</div>
              )}
            </div>
          )}
          <div style={{ marginTop: '8px', fontSize: '10px', color: '#8b949e', fontStyle: 'italic' }}>
            Fix by adding the missing factions to the campaign, renaming the NPC's faction ref,
            or removing the stale roster bundle. Orphaned factions may indicate roster wiring gaps.
          </div>
        </div>
      )}
    </div>
  );
}

export default function FactionsTab({ campaign, setCampaign, npcs = [], setNpcs = () => {} }) {
  const [tickHours, setTickHours] = useState(24);
  const [lastEvents, setLastEvents] = useState([]);

  // Bug #17: useMemo runs before the !campaign guard below (rules-of-hooks
  // forces hook order). If campaign is undefined on first mount (save-restore
  // still racing), `campaign.factions` would throw. Null-guard with `?.` so the
  // memo is safe to compute even when campaign is temporarily undefined.
  const canonicalFactions = useMemo(
    () => Object.entries(campaign?.factions || {}).filter(([id, f]) => !f.pending),
    [campaign?.factions]
  );

  if (!campaign) {
    return <div style={styles.container}>No campaign loaded. Use Campaign Seed to initialize.</div>;
  }

  const handlePromote = (novelId, name, regionId) => {
    setCampaign(promoteNovelFaction(campaign, novelId, {
      name,
      regionId: regionId || undefined,
    }));
  };

  const handleMerge = (fromId, intoId) => {
    const res = mergeFactions(campaign, fromId, intoId, npcs);
    setCampaign(res.campaign);
    setNpcs(res.npcs);
  };

  const handleDiscard = (novelId) => {
    const res = discardNovelFaction(campaign, novelId, npcs);
    setCampaign(res.campaign);
    setNpcs(res.npcs);
  };

  const handleRename = (factionId, newName) => {
    const res = renameFaction(campaign, factionId, newName, npcs);
    setCampaign(res.campaign);
  };

  const handleTick = () => {
    const res = tickCampaign(campaign, tickHours);
    setCampaign(res.campaign);
    setLastEvents(res.events);
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <div style={styles.title}>{campaign.name}</div>
        <div style={{ fontSize: '11px', color: '#8b949e' }}>
          {/* bug #17: all three accessors were un-guarded, so a freshly seeded
              campaign that hadn't run a simulation tick yet (no worldTime, no
              factions, no regions) crashed FactionsTab on mount. */}
          Day {campaign.worldTime?.day ?? '—'}, hour {campaign.worldTime?.hourOfDay ?? '—'}
          {' · '}{Object.keys(campaign.factions || {}).length} factions
          {' · '}{(campaign.regions || []).length} regions
        </div>
        <div style={{ marginTop: '8px' }}>
          <label style={{ fontSize: '11px', marginRight: '6px' }}>Advance:</label>
          <input
            type="number"
            value={tickHours}
            onChange={e => setTickHours(Math.max(1, parseInt(e.target.value) || 1))}
            style={styles.input}
          /> hours
          <button style={styles.btn} onClick={handleTick}>Tick World</button>
        </div>
        {lastEvents.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '11px' }}>
            <div style={styles.label}>Events from last tick ({lastEvents.length})</div>
            {lastEvents.slice(0, 10).map((e, i) => (
              <div key={i} style={{ color: '#8b949e' }}>
                • {e.type}{e.narrative ? `: ${e.narrative}` : ''} {e.factionId ? `(${campaign.factions?.[e.factionId]?.name || e.factionId})` : ''}
              </div>
            ))}
            {lastEvents.length > 10 && <div style={{ color: '#8b949e' }}>...and {lastEvents.length - 10} more</div>}
          </div>
        )}
      </div>

      <CanonicalRefWarnings campaign={campaign} />

      <NovelQueuePanel
        campaign={campaign}
        onPromote={handlePromote}
        onMerge={handleMerge}
        onDiscard={handleDiscard}
      />

      <div style={styles.section}>
        <div style={styles.title}>Canonical Factions ({canonicalFactions.length})</div>
        {canonicalFactions.length === 0 && (
          <div style={{ fontSize: '11px', color: '#8b949e' }}>No factions yet — seed a campaign to populate.</div>
        )}
        {canonicalFactions.map(([id, f]) => (
          <FactionCard
            key={id}
            faction={f}
            factionId={id}
            allFactions={campaign.factions}
            onRename={handleRename}
            onRelate={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
