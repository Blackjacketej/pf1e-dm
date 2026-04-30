import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { db } from '../db/database';
import {
  getEncounteredCreatures,
  publicCreatureView,
  getJournalNotes,
  addJournalNote,
  deleteJournalNote,
  updateJournalNote,
} from '../services/bestiaryTracker';
import {
  getEncounteredFactions,
  publicFactionView,
  setFactionPlayerNote,
} from '../services/factionTracker';
import {
  publicNpcView,
  factionSizeHint,
  NPC_KNOWLEDGE_LABELS,
} from '../services/npcKnowledge';
import {
  setNpcPlayerNote,
  setNpcKnowledgeLevel,
  toggleNpcRevealedFact,
  advanceNpcKnowledge,
  getEncounteredNPCs,
  getEncounteredNPC,
} from '../services/npcTracker';
import { knowledgeCheckRevealNPC } from '../services/npcKnowledgeCheck';
import {
  getEncounteredLocations,
  setLocationPlayerNote,
  publicLocationView,
  deriveLocationRefs,
  locationSlug,
} from '../services/locationTracker';
import {
  getClues,
  addClue,
  updateClue,
  deleteClue,
  resolveClue,
  setCluePinned,
  CLUE_CATEGORIES,
} from '../services/cluesTracker';
import CommissionItemModal from './CommissionItemModal';
import shopsData from '../data/shops.json';
import sandpointData from '../data/sandpoint.json';
import sandpointMapData from '../data/sandpointMap.json';
import { resolveNpcFacilityIds } from '../utils/craftFacilities';
import {
  KIND_ICON,
  DEFAULT_PARTY_ID,
  isNodeDiscovered,
  computeVisitedAncestorIds,
} from '../services/worldTree';

// ─────────────────────────────────────────────────────────
// Adventurer's Journal
// A player-facing record of everything the party has discovered:
//   • NPCs encountered (only what they've learned about each)
//   • Bestiary (creatures fought, gated by identify checks)
//   • Adventure Log (auto-recorded narration / events)
//   • Notes (free-form player journal entries)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// Journal Router — one shared nav state for wiki-style links.
// A link pushes { tab, focusId } onto the history stack so that
// any section can jump to another section's detail view, and the
// back button unwinds one step at a time.
// ─────────────────────────────────────────────────────────
const JournalRouterContext = React.createContext({
  view: { tab: 'npcs', focusId: null },
  history: [],
  go: () => {},
  back: () => {},
});

function useJournalRouter() {
  return React.useContext(JournalRouterContext);
}

/**
 * <JournalLink type="npc" id="npc-red-bishop" disabled={!known}>label</JournalLink>
 *
 * Clicking routes the journal to the target entity's detail view.
 * When `disabled` is true (e.g. unnamed member), renders as plain
 * muted text with no interactivity — the party hasn't earned the
 * link yet.
 */
function JournalLink({ type, id, disabled = false, title, children }) {
  const { go } = useJournalRouter();
  if (disabled) {
    return (
      <span style={{ color: '#6b7280', fontStyle: 'italic' }} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); go(type, id); }}
      title={title}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        color: '#ffd700',
        cursor: 'pointer',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

const TAB_TO_TYPE = { npcs: 'npc', factions: 'faction', bestiary: 'creature', locations: 'location' };
const TYPE_TO_TAB = { npc: 'npcs', faction: 'factions', creature: 'bestiary', location: 'locations' };

// Bug #72 (2026-04-20) — unnamed NPCs render as `the ${shortDesc}`, but
// shortDesc itself frequently leads with an article ("a cheerful half-elf
// apprentice", "a tall woman"), producing "the a cheerful half-elf apprentice".
// Strip a single leading a/an/the (case-insensitive, whole word) before
// prepending "the". Returns shortDesc untouched if it has no article.
function stripLeadingArticle(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/^\s*(?:a|an|the)\s+/i, '');
}

// Format an unknown-name NPC's display label. Used by faction members,
// location "people met here", and anywhere else the journal shows an NPC
// the party has seen but not learned the name of.
function unknownNpcLabel(shortDesc, fallback = 'a stranger') {
  if (typeof shortDesc !== 'string' || !shortDesc.trim()) return fallback;
  return `the ${stripLeadingArticle(shortDesc).trim()}`;
}

// Bug #73 (2026-04-20) — `causeOfDeath` from the LLM frequently leads with
// the word "died" ("Died in the fire", "died protecting his daughter") and
// the journal already labels the field "Died:", so the rendered line came
// out as "Died: Died in the fire…". Strip a leading "died"/"died:" /
// "killed by" verb so the label + value composes cleanly. Also lowercases
// the resulting first letter so "Died: in the fire" reads naturally rather
// than "Died: In the fire".
function formatCauseOfDeath(text) {
  if (typeof text !== 'string') return '';
  const stripped = text
    .replace(/^\s*(?:died|killed|murdered|slain|perished|fell)\s*[:,—-]?\s*/i, '')
    .trim();
  if (!stripped) return text.trim(); // never collapse a legitimate-but-short reason
  // Lowercase the new leading letter only if the source wasn't a proper noun
  // (heuristic: skip if the first surviving word already starts with a capital
  // followed by a lowercase letter, e.g. a name like "Tsuto"). This keeps
  // "by goblin raiders" / "in the fire" reading naturally.
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

const TAB_STYLE = (active) => ({
  flex: 1,
  padding: '10px 8px',
  background: active ? '#1a1a2e' : 'transparent',
  color: active ? '#ffd700' : '#8b949e',
  border: 'none',
  borderBottom: active ? '2px solid #ffd700' : '2px solid transparent',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 700 : 500,
  letterSpacing: 0.5,
});

const SECTION_HEADER = {
  color: '#ffd700',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  marginBottom: 8,
  paddingBottom: 4,
  borderBottom: '1px solid #4a3818',
};

// Task #65 — GM-mode status-change buttons (seal / destroy / restore) rendered
// on hover in WorldTreeSection. Kept minimal (icon-only, unstyled <button>
// chassis) so they fade into the row when not hovered and don't fight the
// existing row typography.
const GM_ICON_BTN = {
  background: 'transparent',
  border: 'none',
  padding: '0 2px',
  fontSize: 12,
  cursor: 'pointer',
  lineHeight: 1,
};

const GM_APPLY_BTN = {
  background: '#4a3818',
  color: '#ffd700',
  border: '1px solid #ca8a04',
  borderRadius: 3,
  padding: '2px 10px',
  fontSize: 11,
  cursor: 'pointer',
};

const GM_CANCEL_BTN = {
  background: 'transparent',
  color: '#8b949e',
  border: '1px solid #2d3748',
  borderRadius: 3,
  padding: '2px 10px',
  fontSize: 11,
  cursor: 'pointer',
};

const CARD = {
  background: '#0f1729',
  border: '1px solid #2d3748',
  borderRadius: 6,
  padding: 12,
  marginBottom: 10,
};

// Shared filter-bar control styles
const FILTER_ROW = {
  display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center',
};
const PILL = (active) => ({
  padding: '4px 10px', fontSize: 11, borderRadius: 4,
  background: active ? '#4a2800' : '#1a1a2e',
  color: active ? '#ffd700' : '#8b949e',
  border: '1px solid #4a3818', cursor: 'pointer',
  textTransform: 'capitalize',
});
const SELECT_STYLE = {
  background: '#1a1a2e', color: '#e0d6c8',
  border: '1px solid #4a3818', borderRadius: 4,
  padding: '4px 8px', fontSize: 11, minHeight: 26,
};
const INPUT_STYLE = {
  flex: 1, padding: '4px 8px', fontSize: 11, borderRadius: 4,
  background: '#0f1729', color: '#e0d6c8',
  border: '1px solid #4a3818', minWidth: 120,
};

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const ATTITUDE_COLOR = {
  hostile: '#7f1d1d',
  unfriendly: '#9a3412',
  indifferent: '#374151',
  friendly: '#166534',
  helpful: '#1e40af',
};

const ATTITUDE_RANK = {
  hostile: 0, unfriendly: 1, indifferent: 2, friendly: 3, helpful: 4,
};

// ─── NPCS TAB ───────────────────────────────────────────
// ── Attitude timeline — tiny inline chart of relationship shifts ──────
function AttitudeTimeline({ history = [], currentAttitude = 'indifferent' }) {
  // Build a synthetic series: starting attitude (before first shift) → each shift → current.
  const points = useMemo(() => {
    if (!history.length) return [{ at: null, attitude: currentAttitude }];
    const start = { at: history[0].at, attitude: history[0].from };
    const mids = history.map(h => ({ at: h.at, attitude: h.to, reason: h.reason }));
    return [start, ...mids];
  }, [history, currentAttitude]);
  if (points.length < 2) {
    // Nothing to chart — one stable attitude.
    return (
      <div style={{ color: '#8b949e', fontSize: 11, fontStyle: 'italic' }}>
        Attitude has been <span style={{ color: ATTITUDE_COLOR[currentAttitude] || '#9ca3af', fontWeight: 600 }}>{currentAttitude}</span> throughout.
      </div>
    );
  }
  const W = 280, H = 60, PAD_X = 8, PAD_Y = 8;
  const stepX = (W - PAD_X * 2) / (points.length - 1);
  const yFor = (att) => {
    const rank = ATTITUDE_RANK[att] ?? 2;
    return H - PAD_Y - (rank / 4) * (H - PAD_Y * 2);
  };
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${PAD_X + i * stepX} ${yFor(p.attitude)}`).join(' ');
  return (
    <div>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {[0, 1, 2, 3, 4].map(r => (
          <line
            key={r}
            x1={PAD_X} x2={W - PAD_X}
            y1={H - PAD_Y - (r / 4) * (H - PAD_Y * 2)}
            y2={H - PAD_Y - (r / 4) * (H - PAD_Y * 2)}
            stroke="#2d3748" strokeWidth={0.5} strokeDasharray="2 3"
          />
        ))}
        <path d={path} stroke="#ffd700" strokeWidth={1.5} fill="none" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={PAD_X + i * stepX}
            cy={yFor(p.attitude)}
            r={3}
            fill={ATTITUDE_COLOR[p.attitude] || '#6b7280'}
            stroke="#0f1729" strokeWidth={1}
          >
            <title>{`${formatRelativeDate(p.at) || 'start'}: ${p.attitude}${p.reason ? ' — ' + p.reason : ''}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6b7280', marginTop: 2 }}>
        <span>hostile</span><span>unfriendly</span><span>indifferent</span><span>friendly</span><span>helpful</span>
      </div>
    </div>
  );
}

// ── NpcDetailView — full wiki page for a focused NPC ────────────────────
// Shown when the journal router focuses on a specific NPC. Falls back to
// publicNpcView for all gated fields; raw stats and GM-only fields only
// appear when `gmMode` is true AND the caller wires the toggle UI.
function NpcDetailView({ npcId, encounteredFactionIds, campaign, gmMode = false, onRefresh, activeCharacter = null, onUpdateCharacter = null, onUpdateCampaign = null }) {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [kcSkill, setKcSkill] = useState('local');
  const [kcRoll, setKcRoll] = useState('');
  const [kcResult, setKcResult] = useState(null);
  const [showCommissionModal, setShowCommissionModal] = useState(false);

  const reload = useCallback(() => {
    // v11 — scope-guarded so a stale npcId from a prior campaign can't leak
    // another campaign's NPC row into this journal view.
    getEncounteredNPC(npcId).then(row => {
      setRaw(row || null);
      setLoading(false);
    });
  }, [npcId]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;
  if (!raw) {
    return (
      <div style={{ ...CARD, color: '#8b949e', fontStyle: 'italic' }}>
        The party has no memory of anyone matching this entry.
      </div>
    );
  }

  const npc = publicNpcView(raw, { encounteredFactionIds }) || {};
  const factionsMap = {};
  const innerCampaign = campaign?.data || campaign;
  (innerCampaign?.factions || []).forEach(f => { factionsMap[f.id] = f; });

  // Resolve craft facilities available at the NPC's workshop/location. Checks
  // shops.json first (operatorNpc id match, with or without "npc-" prefix),
  // then falls back to matching npc.location against canonical Sandpoint data.
  const commissionFacilityIds = useMemo(() => {
    if (!raw) return [];
    const allLocations = [
      ...Object.values(shopsData?.shops || {}),
      ...(sandpointMapData?.locations || []),
      ...(sandpointData?.locations || []),
    ];
    return resolveNpcFacilityIds(raw, allLocations);
  }, [raw]);

  const saveNote = async () => {
    await setNpcPlayerNote(raw.id, noteDraft);
    setEditingNote(false);
    reload();
    onRefresh?.();
  };

  const bumpKnowledge = async (delta) => {
    const cur = Number.isFinite(raw.knowledgeLevel) ? raw.knowledgeLevel : npc.knowledgeLevel;
    const next = Math.max(0, Math.min(4, cur + delta));
    await setNpcKnowledgeLevel(raw.id, next);
    reload();
    onRefresh?.();
  };

  const flipFact = async (key) => {
    await toggleNpcRevealedFact(raw.id, key);
    reload();
    onRefresh?.();
  };

  const runKnowledgeCheck = async () => {
    const total = Number(kcRoll);
    if (!Number.isFinite(total)) {
      setKcResult({ error: 'Enter a numeric roll total' });
      return;
    }
    const res = knowledgeCheckRevealNPC(raw, total, kcSkill);
    if (!res) {
      setKcResult({ error: 'Invalid input' });
      return;
    }
    setKcResult(res);
    if (res.applicable && res.patch) {
      await advanceNpcKnowledge(raw.id, res.patch);
      reload();
      onRefresh?.();
    }
  };

  const handleUpdateNpc = (npcUpdate) => {
    setRaw({ ...raw, ...npcUpdate });
    // Persist NPC change (craftProjects queue) back to campaign if setter provided
    if (typeof onUpdateCampaign === 'function') {
      onUpdateCampaign((prev) => {
        if (!prev) return prev;
        const npcs = prev.npcs;
        if (!npcs) return prev;
        // npcs can be a map {id: npc} or an array — support both
        if (Array.isArray(npcs)) {
          return {
            ...prev,
            npcs: npcs.map((n) =>
              n && n.id === raw.id ? { ...n, ...npcUpdate } : n,
            ),
          };
        }
        const cur = npcs[raw.id];
        if (!cur) return prev;
        return {
          ...prev,
          npcs: { ...npcs, [raw.id]: { ...cur, ...npcUpdate } },
        };
      });
    }
  };

  const handleRecordCommission = (commissionRecord) => {
    if (typeof onUpdateCampaign !== 'function' || !commissionRecord) return;
    onUpdateCampaign((prev) => {
      if (!prev) return prev;
      const ws = prev.worldState || {};
      const existing = Array.isArray(ws.commissions) ? ws.commissions : [];
      return {
        ...prev,
        worldState: {
          ...ws,
          commissions: [...existing, commissionRecord],
        },
      };
    });
  };

  const FACT_LABELS = {
    combatStats:    'Combat stats',
    secretFactions: 'Secret faction ties',
    trueAlignment: 'True alignment',
    stats:          'Full stat block',
  };

  return (
    <div>
      {/* Header */}
      <div style={{ ...CARD, borderLeft: '3px solid #ffd700' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ color: '#ffd700', fontWeight: 700, fontSize: 18 }}>
            {npc.displayName}
            {npc.alive === false && <span style={{ color: '#dc2626', marginLeft: 8, fontSize: 12 }}>† deceased</span>}
          </div>
          <div style={{ color: '#8b949e', fontSize: 10, fontStyle: 'italic' }}>
            {npc.knowledgeLabel}
          </div>
        </div>
        {npc.firstImpression && (
          <div style={{ color: '#a0826d', fontSize: 12, fontStyle: 'italic', marginTop: 4 }}>
            "{npc.firstImpression}"
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#8b949e', marginTop: 8 }}>
          {npc.race && <span>{[npc.ageBracket, npc.race, npc.sex].filter(Boolean).join(' ')}</span>}
          {npc.occupation && <span>· {npc.occupation}</span>}
          {npc.location && (
            <span>· 📍 <JournalLink type="location" id={locationSlug(npc.location)}>{npc.location}</JournalLink></span>
          )}
          {npc.attitude && (
            <span style={{
              padding: '1px 6px', borderRadius: 3,
              background: ATTITUDE_COLOR[npc.attitude] || '#374151',
              color: '#fff', fontSize: 10, fontWeight: 600,
            }}>{npc.attitude}</span>
          )}
          {(npc.interactions || 0) > 0 && <span>· {npc.interactions} interactions</span>}
          {npc.metAt && <span>· met {formatRelativeDate(npc.metAt)}</span>}
          {npc.lastSeen && <span>· last seen {formatRelativeDate(npc.lastSeen)}</span>}
        </div>
        {npc.powerLevelHint && (
          <div style={{ fontSize: 10, color: '#a0826d', marginTop: 4, fontStyle: 'italic' }}>
            {npc.powerLevelHint}
          </div>
        )}
        {npc.alignment && (
          <div style={{ fontSize: 10, color: '#8b6914', marginTop: 2 }}>
            Alignment: {npc.alignment}
          </div>
        )}
        {npc.alive === false && npc.causeOfDeath && (
          <div style={{ color: '#dc2626', fontSize: 11, marginTop: 4 }}>
            Died: {formatCauseOfDeath(npc.causeOfDeath)}
          </div>
        )}

        {/* Commission Button */}
        {activeCharacter && !npc.alive === false && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowCommissionModal(true)}
              style={{
                padding: '6px 12px',
                backgroundColor: '#8b6914',
                border: '1px solid #ffd700',
                color: '#ffd700',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              Commission Item
            </button>
          </div>
        )}
      </div>

      {/* Factions */}
      {npc.factions && npc.factions.length > 0 && (
        <div style={CARD}>
          <div style={{ color: '#8b6914', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Affiliations
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
            {npc.factions.map(f => {
              const canon = factionsMap[f.id];
              const label = canon?.name || f.id;
              return (
                <JournalLink
                  key={f.id}
                  type="faction"
                  id={f.id}
                  title={f.secret ? 'Hidden affiliation discovered' : 'Known affiliation'}
                >
                  {f.secret ? `⚠ ${label}` : label}
                </JournalLink>
              );
            })}
          </div>
        </div>
      )}

      {/* Familiar / relationships */}
      {(npc.familiar || (npc.relationships && npc.relationships.length > 0)) && (
        <div style={CARD}>
          <div style={{ color: '#8b6914', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Connections
          </div>
          {npc.familiar && (
            <div style={{ fontSize: 11, color: '#c0a0ff', marginBottom: 4 }}>
              Accompanied by a {String(npc.familiar.id).toLowerCase()}
            </div>
          )}
          {npc.relationships && npc.relationships.map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: '#a0826d' }}>
              · {r.type ? `${r.type}: ` : ''}{r.targetName}{r.detail ? ` — ${r.detail}` : ''}
            </div>
          ))}
        </div>
      )}

      {/* Goal — level 3+ */}
      {npc.goal && (
        <div style={CARD}>
          <div style={{ color: '#8b6914', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Apparent Goal
          </div>
          <div style={{ fontSize: 12, color: '#e0d6c8', fontStyle: 'italic' }}>
            {typeof npc.goal === 'string' ? npc.goal : npc.goal.description || JSON.stringify(npc.goal)}
          </div>
        </div>
      )}

      {/* Attitude timeline */}
      <div style={CARD}>
        <div style={{ color: '#8b6914', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Attitude Timeline
        </div>
        <AttitudeTimeline history={npc.attitudeHistory || []} currentAttitude={npc.attitude || 'indifferent'} />
        {Array.isArray(npc.attitudeHistory) && npc.attitudeHistory.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ color: '#8b949e', fontSize: 11, cursor: 'pointer' }}>Shift log</summary>
            <div style={{ paddingLeft: 12, marginTop: 4 }}>
              {npc.attitudeHistory.map((h, i) => (
                <div key={i} style={{ fontSize: 10, color: '#a0826d', marginBottom: 2 }}>
                  {formatRelativeDate(h.at)}: {h.from} → {h.to}{h.reason ? ` (${h.reason})` : ''}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Player note editor */}
      <div style={CARD}>
        <div style={{ color: '#8b6914', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Your Notes
        </div>
        {editingNote ? (
          <div>
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              rows={4}
              style={{
                width: '100%', padding: 6, fontSize: 12,
                background: '#0a0e1a', color: '#e0d6c8',
                border: '1px solid #4a3818', borderRadius: 3,
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button onClick={saveNote} style={{
                padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                background: '#4a2800', color: '#ffd700',
                border: '1px solid #8b6914', borderRadius: 3,
              }}>Save</button>
              <button onClick={() => { setEditingNote(false); setNoteDraft(''); }} style={{
                padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                background: 'none', color: '#8b949e',
                border: '1px solid #374151', borderRadius: 3,
              }}>Cancel</button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => { setEditingNote(true); setNoteDraft(npc.playerNotes || ''); }}
            style={{
              cursor: 'pointer', fontSize: 12,
              color: npc.playerNotes ? '#e0d6c8' : '#6b7280',
              fontStyle: npc.playerNotes ? 'normal' : 'italic',
              whiteSpace: 'pre-wrap',
            }}
          >
            {npc.playerNotes || '+ Add note…'}
          </div>
        )}
      </div>

      {/* GM panel — only rendered when gmMode is on */}
      {gmMode && (
        <div style={{ ...CARD, border: '1px dashed #d946ef', background: '#1a0e2e' }}>
          <div style={{ color: '#d946ef', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            GM Controls
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#d946ef' }}>Knowledge level: {npc.knowledgeLevel} ({npc.knowledgeLabel})</span>
            <button onClick={() => bumpKnowledge(-1)} disabled={npc.knowledgeLevel <= 0} style={{
              padding: '2px 8px', fontSize: 11, cursor: 'pointer',
              background: '#2a0e3e', color: '#d946ef',
              border: '1px solid #d946ef', borderRadius: 3,
              opacity: npc.knowledgeLevel <= 0 ? 0.4 : 1,
            }}>−</button>
            <button onClick={() => bumpKnowledge(+1)} disabled={npc.knowledgeLevel >= 4} style={{
              padding: '2px 8px', fontSize: 11, cursor: 'pointer',
              background: '#2a0e3e', color: '#d946ef',
              border: '1px solid #d946ef', borderRadius: 3,
              opacity: npc.knowledgeLevel >= 4 ? 0.4 : 1,
            }}>+</button>
          </div>
          <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 4 }}>Revealed facts (unlock independently of level):</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(FACT_LABELS).map(([key, label]) => {
              const on = (raw.revealedFacts || []).includes(key);
              return (
                <button key={key} onClick={() => flipFact(key)} style={{
                  padding: '3px 8px', fontSize: 11, cursor: 'pointer',
                  background: on ? '#4a1a4a' : '#1a1a2e',
                  color: on ? '#d946ef' : '#8b949e',
                  border: `1px solid ${on ? '#d946ef' : '#374151'}`,
                  borderRadius: 3,
                }}>
                  {on ? '✓' : '○'} {label}
                </button>
              );
            })}
          </div>

          {/* Knowledge check roll — CRB-faithful reveal */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #4a1a4a' }}>
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 6 }}>
              Knowledge check (CRB p. 99) — DC = 10 + CR/HD; each 5 over = +1 reveal tier:
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={kcSkill}
                onChange={e => setKcSkill(e.target.value)}
                style={{ padding: '2px 6px', fontSize: 11, background: '#1a1a2e', color: '#d946ef', border: '1px solid #374151', borderRadius: 3 }}
              >
                {['arcana','dungeoneering','engineering','geography','history','local','nature','nobility','planes','religion'].map(s => (
                  <option key={s} value={s}>Know. {s[0].toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <input
                type="number"
                placeholder="d20 total"
                value={kcRoll}
                onChange={e => setKcRoll(e.target.value)}
                style={{ padding: '2px 6px', fontSize: 11, width: 80, background: '#1a1a2e', color: '#d946ef', border: '1px solid #374151', borderRadius: 3 }}
              />
              <button
                onClick={runKnowledgeCheck}
                style={{ padding: '3px 10px', fontSize: 11, cursor: 'pointer', background: '#4a1a4a', color: '#d946ef', border: '1px solid #d946ef', borderRadius: 3 }}
              >
                Roll
              </button>
            </div>
            {kcResult && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#c0a0ff' }}>
                {kcResult.error ? (
                  <span style={{ color: '#dc2626' }}>{kcResult.error}</span>
                ) : !kcResult.applicable ? (
                  <>
                    Wrong skill — DC {kcResult.dc}, expected <strong>{kcResult.expectedSkill}</strong> (margin {kcResult.margin}). No reveal.
                  </>
                ) : kcResult.margin < 0 ? (
                  <>
                    Failed — DC {kcResult.dc}, missed by {-kcResult.margin}. No reveal.
                  </>
                ) : (
                  <>
                    Beat DC {kcResult.dc} by {kcResult.margin} → {kcResult.facts} fact{kcResult.facts === 1 ? '' : 's'}.
                    {kcResult.toLevel != null && <> Knowledge level → <strong>{kcResult.toLevel}</strong>.</>}
                    {kcResult.unlock && kcResult.unlock.length > 0 && <> Unlocked: <strong>{kcResult.unlock.join(', ')}</strong>.</>}
                    {!kcResult.patch && <> (Already at this tier.)</>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Commission Modal */}
      {showCommissionModal && activeCharacter && (
        <CommissionItemModal
          npc={raw}
          payerCharacter={activeCharacter}
          onUpdateNpc={handleUpdateNpc}
          onUpdatePayer={onUpdateCharacter}
          onRecordCommission={handleRecordCommission}
          onClose={() => setShowCommissionModal(false)}
          locationFacilityIds={commissionFacilityIds}
        />
      )}
    </div>
  );
}

function NPCsSection({ npcs: npcsProp, encounteredFactionIds, focusId, campaign = null, gmMode = false, onRefresh = null, activeCharacter = null, onUpdateCharacter = null, onUpdateCampaign = null }) {
  const [filter, setFilter] = useState('all'); // all | alive | deceased
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // recent | oldest | name | attitude | interactions
  const npcs = npcsProp || [];
  const loading = !npcsProp;

  const visible = useMemo(() => {
    // If focused on a specific NPC id, show only that row
    const base = focusId ? npcs.filter(n => n.id === focusId) : npcs;
    const filtered = base.filter(n => {
      if (filter === 'alive' && n.alive === false) return false;
      if (filter === 'deceased' && n.alive !== false) return false;
      if (!focusId && searchTerm) {
        const q = searchTerm.toLowerCase();
        const inName = (n.knownToParty ? n.name : n.shortDesc || '').toLowerCase().includes(q);
        const inLoc = (n.location || '').toLowerCase().includes(q);
        const inOcc = (n.occupation || '').toLowerCase().includes(q);
        if (!inName && !inLoc && !inOcc) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return (a.metAt || '').localeCompare(b.metAt || '');
        case 'name': {
          const an = (a.knownToParty ? a.name : a.shortDesc || '~') || '~';
          const bn = (b.knownToParty ? b.name : b.shortDesc || '~') || '~';
          return an.localeCompare(bn);
        }
        case 'attitude': {
          const ar = ATTITUDE_RANK[a.attitude] ?? 2;
          const br = ATTITUDE_RANK[b.attitude] ?? 2;
          return br - ar; // helpful first
        }
        case 'interactions':
          return (b.interactions || 0) - (a.interactions || 0);
        case 'recent':
        default:
          return (b.metAt || '').localeCompare(a.metAt || '');
      }
    });
    return sorted;
  }, [npcs, filter, searchTerm, sortBy, focusId]);

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;

  // When focused on a single NPC, render the full detail page.
  if (focusId) {
    return (
      <NpcDetailView
        npcId={focusId}
        encounteredFactionIds={encounteredFactionIds}
        campaign={campaign}
        gmMode={gmMode}
        onRefresh={onRefresh}
        activeCharacter={activeCharacter}
        onUpdateCharacter={onUpdateCharacter}
        onUpdateCampaign={onUpdateCampaign}
      />
    );
  }

  return (
    <div>
      <div style={SECTION_HEADER}>People We've Met ({visible.length})</div>
      <div style={FILTER_ROW}>
        {['all', 'alive', 'deceased'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={PILL(filter === f)}>{f}</button>
        ))}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={SELECT_STYLE} title="Sort by">
          <option value="recent">Most Recent</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name (A→Z)</option>
          <option value="attitude">Attitude (helpful → hostile)</option>
          <option value="interactions">Most Interactions</option>
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name, place, role…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          The party has not yet met anyone of note.
        </div>
      )}
      {visible.map(rawNpc => {
        const npc = publicNpcView(rawNpc, { encounteredFactionIds }) || {};
        const displayName = npc.displayName;
        return (
          <div key={rawNpc.id} style={CARD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <div style={{ color: '#ffd700', fontWeight: 700, fontSize: 14 }}>
                {displayName}
                {npc.alive === false && <span style={{ color: '#dc2626', marginLeft: 6, fontSize: 11 }}>† deceased</span>}
              </div>
              <div style={{ color: '#6b7280', fontSize: 10 }}>{formatRelativeDate(npc.metAt)}</div>
            </div>
            {npc.firstImpression && (
              <div style={{ color: '#a0826d', fontSize: 12, fontStyle: 'italic', marginBottom: 6 }}>
                {npc.firstImpression}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#8b949e' }}>
              {npc.location && (
                <span>📍 <JournalLink type="location" id={locationSlug(npc.location)}>{npc.location}</JournalLink></span>
              )}
              {npc.occupation && <span>· {npc.occupation}</span>}
              {npc.attitude && (
                <span style={{
                  padding: '1px 6px', borderRadius: 3,
                  background: ATTITUDE_COLOR[npc.attitude] || '#374151',
                  color: '#fff', fontSize: 10, fontWeight: 600,
                }}>{npc.attitude}</span>
              )}
              {(npc.interactions || 0) > 0 && <span>· {npc.interactions} interactions</span>}
              <span style={{ fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>
                · {npc.knowledgeLabel}
              </span>
            </div>
            {npc.factions && npc.factions.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
                <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Ties:
                </span>
                {npc.factions.map(f => (
                  <JournalLink
                    key={f.id}
                    type="faction"
                    id={f.id}
                    title={f.secret ? 'Hidden affiliation discovered' : 'Known affiliation'}
                  >
                    {f.secret ? `⚠ ${f.id}` : f.id}
                  </JournalLink>
                ))}
              </div>
            )}
            {npc.powerLevelHint && (
              <div style={{ fontSize: 10, color: '#a0826d', marginTop: 4, fontStyle: 'italic' }}>
                {npc.powerLevelHint}
              </div>
            )}
            {npc.alignment && (
              <div style={{ fontSize: 10, color: '#8b6914', marginTop: 2 }}>
                Alignment: {npc.alignment}
              </div>
            )}
            {npc.alive === false && npc.causeOfDeath && (
              <div style={{ color: '#dc2626', fontSize: 11, marginTop: 4 }}>
                Died: {formatCauseOfDeath(npc.causeOfDeath)}
              </div>
            )}
            {Array.isArray(npc.attitudeHistory) && npc.attitudeHistory.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ color: '#8b949e', fontSize: 11, cursor: 'pointer' }}>
                  Relationship history
                </summary>
                <div style={{ paddingLeft: 12, marginTop: 4 }}>
                  {npc.attitudeHistory.map((h, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#a0826d', marginBottom: 2 }}>
                      {formatRelativeDate(h.at)}: {h.from} → {h.to} ({h.reason})
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── BESTIARY TAB ───────────────────────────────────────
function BestiarySection() {
  const [creatures, setCreatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | identified | unknown
  const [sortBy, setSortBy] = useState('recent'); // recent | oldest | name | cr | encounters | defeated
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let mounted = true;
    getEncounteredCreatures().then(rows => {
      if (mounted) {
        setCreatures(rows.map(publicCreatureView).filter(Boolean));
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const visible = useMemo(() => {
    const filtered = creatures.filter(c => {
      if (filter === 'identified' && !c.identified) return false;
      if (filter === 'unknown' && c.identified) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const inName = (c.displayName || '').toLowerCase().includes(q);
        const inLoc = (c.lastSeenLocation || '').toLowerCase().includes(q);
        const inType = (c.type || '').toLowerCase().includes(q);
        if (!inName && !inLoc && !inType) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return (a.firstSeenAt || a.lastSeenAt || '').localeCompare(b.firstSeenAt || b.lastSeenAt || '');
        case 'name':
          return (a.displayName || '').localeCompare(b.displayName || '');
        case 'cr': {
          const ac = a.cr == null ? -Infinity : Number(a.cr);
          const bc = b.cr == null ? -Infinity : Number(b.cr);
          return bc - ac;
        }
        case 'encounters':
          return (b.encounters || 0) - (a.encounters || 0);
        case 'defeated':
          return (b.defeated || 0) - (a.defeated || 0);
        case 'recent':
        default:
          return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
      }
    });
    return sorted;
  }, [creatures, filter, sortBy, searchTerm]);

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div style={SECTION_HEADER}>Field Bestiary ({visible.length})</div>
      <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 10, fontStyle: 'italic' }}>
        Only creatures the party has personally encountered are recorded here.
        Stats are unlocked by passing Knowledge checks during combat.
      </div>
      <div style={FILTER_ROW}>
        {['all', 'identified', 'unknown'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={PILL(filter === f)}>{f}</button>
        ))}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={SELECT_STYLE} title="Sort by">
          <option value="recent">Most Recent</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name (A→Z)</option>
          <option value="cr">CR (high → low)</option>
          <option value="encounters">Most Encountered</option>
          <option value="defeated">Most Defeated</option>
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name, type, place…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          The party has not yet faced any creatures.
        </div>
      )}
      {visible.map(c => (
        <div key={c.id} style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <div style={{ color: c.identified ? '#ffd700' : '#8b949e', fontWeight: 700, fontSize: 14 }}>
              {c.displayName}
            </div>
            <div style={{ color: '#6b7280', fontSize: 10 }}>{formatRelativeDate(c.lastSeenAt)}</div>
          </div>
          {!c.identified && (
            <div style={{ color: '#a0826d', fontSize: 11, fontStyle: 'italic' }}>
              Not yet identified — pass a Knowledge check in combat to learn its name and abilities.
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#8b949e', marginTop: 4 }}>
            <span>👁 Encountered ×{c.encounters}</span>
            {(c.defeated || 0) > 0 && <span>⚔ Defeated ×{c.defeated}</span>}
            {c.lastSeenLocation && <span>📍 {c.lastSeenLocation}</span>}
          </div>
          {c.identified && c.factsLearned >= 1 && (
            <div style={{ marginTop: 8, padding: 8, background: '#1a1a2e', borderRadius: 4 }}>
              {c.cr != null && <Stat label="CR" value={c.cr} />}
              {c.type && <Stat label="Type" value={c.type} />}
              {c.factsLearned >= 2 && c.hp != null && <Stat label="HP" value={c.hp} />}
              {c.factsLearned >= 2 && c.ac != null && <Stat label="AC" value={c.ac} />}
              {c.factsLearned >= 2 && c.hd != null && <Stat label="HD" value={c.hd} />}
              {c.factsLearned >= 3 && c.attacks && <Stat label="Attacks" value={String(c.attacks)} />}
              {c.factsLearned >= 4 && c.specialAbilities && (
                <Stat label="Special" value={String(c.specialAbilities)} />
              )}
              {c.factsLearned >= 4 && c.defenses && (c.defenses.DR || c.defenses.SR || c.defenses.immunities || c.defenses.resistances) && (
                <Stat
                  label="Defenses"
                  value={[
                    c.defenses.DR && `DR ${c.defenses.DR}`,
                    c.defenses.SR && `SR ${c.defenses.SR}`,
                    c.defenses.immunities && `Immune: ${c.defenses.immunities}`,
                    c.defenses.resistances && `Resist: ${c.defenses.resistances}`,
                  ].filter(Boolean).join(' · ')}
                />
              )}
              {c.factsLearned >= 5 && c.weaknesses && <Stat label="Weakness" value={String(c.weaknesses)} />}
              {c.factsLearned >= 5 && c.alignment && <Stat label="Alignment" value={c.alignment} />}
              {c.factsLearned >= 6 && c.environment && <Stat label="Found" value={c.environment} />}
              <div style={{ color: '#6b7280', fontSize: 10, marginTop: 4, fontStyle: 'italic' }}>
                {c.factsLearned} fact{c.factsLearned === 1 ? '' : 's'} learned
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 2 }}>
      <span style={{ color: '#8b6914', fontWeight: 600, minWidth: 70 }}>{label}:</span>
      <span style={{ color: '#e0d6c8' }}>{value}</span>
    </div>
  );
}

// ─── ADVENTURE LOG TAB ──────────────────────────────────
const LOG_TYPES = ['narration', 'success', 'loot', 'event'];

function AdventureLogSection({ gameLog }) {
  const [typeFilter, setTypeFilter] = useState('all'); // all | narration | success | loot | event
  const [sortBy, setSortBy] = useState('newest'); // newest | oldest
  const [searchTerm, setSearchTerm] = useState('');

  const visible = useMemo(() => {
    let filtered = (gameLog || []).filter(e => LOG_TYPES.includes(e.type));
    if (typeFilter !== 'all') filtered = filtered.filter(e => e.type === typeFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(e => (e.text || '').toLowerCase().includes(q));
    }
    // gameLog is naturally chronological — preserve original order then optionally reverse
    if (sortBy === 'newest') return [...filtered].reverse();
    return filtered;
  }, [gameLog, typeFilter, sortBy, searchTerm]);

  return (
    <div>
      <div style={SECTION_HEADER}>Adventure Log ({visible.length})</div>
      <div style={FILTER_ROW}>
        {['all', ...LOG_TYPES].map(f => (
          <button key={f} onClick={() => setTypeFilter(f)} style={PILL(typeFilter === f)}>{f}</button>
        ))}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={SELECT_STYLE} title="Sort by">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search log…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          No notable events have occurred yet.
        </div>
      )}
      {visible.map(entry => (
        <div key={entry.id} style={{
          ...CARD,
          borderLeft: `3px solid ${
            entry.type === 'success' ? '#16a34a'
            : entry.type === 'loot' ? '#ca8a04'
            : entry.type === 'event' ? '#7c3aed'
            : '#4a3818'
          }`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              {entry.type}
            </span>
            <span style={{ color: '#6b7280', fontSize: 10 }}>{entry.time}</span>
          </div>
          <div style={{ color: '#e0d6c8', fontSize: 13, lineHeight: 1.5 }}>{entry.text}</div>
        </div>
      ))}
    </div>
  );
}

// ─── NOTES TAB ──────────────────────────────────────────
const NOTE_CATEGORIES = ['general', 'plot', 'npc', 'lore', 'todo'];

function NotesSection() {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState('general');
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('pinned'); // pinned | newest | oldest | category
  const [searchTerm, setSearchTerm] = useState('');

  const refresh = useCallback(() => {
    getJournalNotes().then(rows => {
      setNotes(rows);
      setLoading(false);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!draft.trim()) return;
    await addJournalNote(draft, category);
    setDraft('');
    refresh();
  };

  const handleDelete = async (id) => {
    await deleteJournalNote(id);
    refresh();
  };

  const handleTogglePin = async (note) => {
    await updateJournalNote(note.id, { pinned: !note.pinned });
    refresh();
  };

  const visible = useMemo(() => {
    let filtered = notes;
    if (categoryFilter !== 'all') filtered = filtered.filter(n => n.category === categoryFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(n => (n.text || '').toLowerCase().includes(q));
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === 'pinned') {
        const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        if (pinDiff !== 0) return pinDiff;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }
      if (sortBy === 'newest') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (sortBy === 'oldest') return (a.createdAt || '').localeCompare(b.createdAt || '');
      if (sortBy === 'category') {
        const c = (a.category || '').localeCompare(b.category || '');
        if (c !== 0) return c;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      }
      return 0;
    });
    return sorted;
  }, [notes, categoryFilter, sortBy, searchTerm]);

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div style={SECTION_HEADER}>Personal Notes ({visible.length})</div>
      <div style={{ ...CARD, marginBottom: 12 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Write a note about what just happened, a clue, a plot thread, or something to remember…"
          rows={3}
          style={{
            width: '100%', padding: 8, fontSize: 12,
            background: '#0a0e1a', color: '#e0d6c8',
            border: '1px solid #4a3818', borderRadius: 4, resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <select value={category} onChange={e => setCategory(e.target.value)} style={SELECT_STYLE}>
            {NOTE_CATEGORIES.map(c => (
              <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button onClick={handleAdd} disabled={!draft.trim()} style={{
            marginLeft: 'auto', padding: '6px 14px', fontSize: 12,
            background: draft.trim() ? '#4a2800' : '#1a1a2e',
            color: draft.trim() ? '#ffd700' : '#6b7280',
            border: '1px solid #8b6914', borderRadius: 4,
            cursor: draft.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}>Add Note</button>
        </div>
      </div>
      <div style={FILTER_ROW}>
        {['all', ...NOTE_CATEGORIES].map(f => (
          <button key={f} onClick={() => setCategoryFilter(f)} style={PILL(categoryFilter === f)}>{f}</button>
        ))}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={SELECT_STYLE} title="Sort by">
          <option value="pinned">Pinned first</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="category">By category</option>
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search notes…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          No notes match your filters. Use this space to track plot threads, clues, or anything you want to remember.
        </div>
      )}
      {visible.map(note => (
        <div key={note.id} style={{
          ...CARD,
          borderLeft: note.pinned ? '3px solid #ffd700' : CARD.border,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <span style={{
                  fontSize: 9, padding: '1px 6px', borderRadius: 3,
                  background: '#374151', color: '#a0826d', textTransform: 'uppercase',
                  letterSpacing: 1,
                }}>{note.category}</span>
                <span style={{ color: '#6b7280', fontSize: 10 }}>
                  {formatRelativeDate(note.createdAt)}
                </span>
              </div>
              <div style={{ color: '#e0d6c8', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {note.text}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={() => handleTogglePin(note)} title={note.pinned ? 'Unpin' : 'Pin'} style={{
                background: 'none', border: '1px solid #4a3818',
                color: note.pinned ? '#ffd700' : '#6b7280',
                borderRadius: 3, cursor: 'pointer', padding: '2px 6px', fontSize: 11,
              }}>{note.pinned ? '★' : '☆'}</button>
              <button onClick={() => handleDelete(note.id)} title="Delete" style={{
                background: 'none', border: '1px solid #4a1a1a',
                color: '#dc2626', borderRadius: 3, cursor: 'pointer',
                padding: '2px 6px', fontSize: 11,
              }}>×</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── FACTIONS TAB ───────────────────────────────────────
const ARCHETYPE_COLOR = {
  mercantile:   '#ca8a04',
  consortium:   '#ca8a04',
  martial:      '#b45309',
  criminal:     '#7f1d1d',
  cult:         '#6b21a8',
  religious:    '#1e3a8a',
  tribe:        '#166534',
  horde:        '#b91c1c',
  strike_team:  '#9a3412',
  entity:       '#581c87',
  unknown:      '#374151',
};

const KNOWLEDGE_LABELS = {
  0: 'existence only',
  1: 'named',
  2: 'goals known',
  3: 'relations known',
  4: 'leader identified',
};

function FactionsSection({ campaign, sharedNpcs = [], focusId = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [editingNote, setEditingNote] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  // Fast NPC lookup by id: who-is-this for each member chip
  const npcById = useMemo(() => {
    const m = new Map();
    for (const n of sharedNpcs) m.set(n.id, n);
    return m;
  }, [sharedNpcs]);

  const refresh = useCallback(() => {
    getEncounteredFactions().then(all => {
      setRows(all);
      setLoading(false);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const factionsMap = campaign?.factions || {};

  const visible = useMemo(() => {
    const encounteredIds = new Set(rows.map(r => r.factionId));
    const views = rows
      .map(r => publicFactionView(r, factionsMap[r.factionId], { encounteredFactionIds: encounteredIds }))
      .filter(Boolean);
    const focused = focusId ? views.filter(v => v.factionId === focusId) : views;
    const filtered = focused.filter(v => {
      if (!focusId && searchTerm) {
        const q = searchTerm.toLowerCase();
        const inName = (v.displayName || '').toLowerCase().includes(q);
        const inLoc = (v.lastSeenLocation || '').toLowerCase().includes(q);
        const inArch = (v.archetype || '').toLowerCase().includes(q);
        if (!inName && !inLoc && !inArch) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return (a.firstSeenAt || '').localeCompare(b.firstSeenAt || '');
        case 'name':   return (a.displayName || '').localeCompare(b.displayName || '');
        case 'knowledge': return (b.knowledgeLevel || 0) - (a.knowledgeLevel || 0);
        case 'encounters': return (b.encounters || 0) - (a.encounters || 0);
        case 'recent':
        default: return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
      }
    });
    return sorted;
  }, [rows, factionsMap, searchTerm, sortBy, focusId]);

  const saveNote = async (factionId) => {
    await setFactionPlayerNote(factionId, noteDraft);
    setEditingNote(null);
    setNoteDraft('');
    refresh();
  };

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div style={SECTION_HEADER}>Factions Encountered ({visible.length})</div>
      <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 10, fontStyle: 'italic' }}>
        Organizations the party has discovered. Knowledge deepens by meeting members,
        naming them in conversation, passing Knowledge checks, or witnessing their deeds.
      </div>
      <div style={FILTER_ROW}>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={SELECT_STYLE} title="Sort by">
          <option value="recent">Most Recent</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name (A→Z)</option>
          <option value="knowledge">Most Known</option>
          <option value="encounters">Most Encountered</option>
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name, place, archetype…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          The party has not yet learned of any factions at work in the region.
        </div>
      )}
      {visible.map(f => {
        const color = ARCHETYPE_COLOR[f.archetype] || ARCHETYPE_COLOR.unknown;
        const isEditing = editingNote === f.factionId;
        return (
          <div key={f.factionId} style={{ ...CARD, borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <div style={{ color: f.identified ? '#ffd700' : '#8b949e', fontWeight: 700, fontSize: 14 }}>
                {f.displayName}
              </div>
              <div style={{ color: '#6b7280', fontSize: 10 }}>{formatRelativeDate(f.lastSeenAt)}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
              {f.archetype && (
                <span style={{
                  padding: '1px 6px', borderRadius: 3,
                  background: color, color: '#fff', fontSize: 10, fontWeight: 600,
                  textTransform: 'capitalize',
                }}>{f.archetype.replace('_', ' ')}</span>
              )}
              <span>👁 ×{f.encounters}</span>
              {f.lastSeenLocation && (
                <span>📍 <JournalLink type="location" id={locationSlug(f.lastSeenLocation)}>{f.lastSeenLocation}</JournalLink></span>
              )}
              <span style={{ fontStyle: 'italic' }}>
                lvl {f.knowledgeLevel} — {KNOWLEDGE_LABELS[f.knowledgeLevel]}
              </span>
            </div>
            {(() => {
              const liveFaction = factionsMap[f.factionId];
              const totalMembers = Array.isArray(liveFaction?.members) ? liveFaction.members.length : 0;
              const knownIds = f.membersKnown || [];
              const hint = factionSizeHint(totalMembers, f.knowledgeLevel);
              const othersRemain = totalMembers > knownIds.length;
              if (knownIds.length === 0 && !hint) return null;
              return (
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Members
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, fontSize: 11 }}>
                    {knownIds.map(nid => {
                      const npc = npcById.get(nid);
                      const known = npc && npc.knownToParty;
                      const label = known ? npc.name : unknownNpcLabel(npc?.shortDesc, 'a member');
                      return (
                        <JournalLink
                          key={nid}
                          type="npc"
                          id={nid}
                          disabled={!known}
                          title={known ? 'Open journal entry' : 'Name not yet known'}
                        >
                          {label}
                        </JournalLink>
                      );
                    })}
                    {othersRemain && (
                      <span style={{ color: '#6b7280', fontStyle: 'italic' }}>
                        {knownIds.length > 0 ? 'and others' : 'members unknown'}
                      </span>
                    )}
                  </div>
                  {hint && (
                    <div style={{ fontSize: 10, color: '#a0826d', marginTop: 4, fontStyle: 'italic' }}>
                      {hint}
                    </div>
                  )}
                </div>
              );
            })()}
            {f.publicGoals && f.publicGoals.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Public Goals
                </span>
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: '#e0d6c8', fontSize: 11 }}>
                  {f.publicGoals.map((g, i) => (
                    <li key={i} style={{ marginBottom: 2 }}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {f.relations && Object.keys(f.relations).length > 0 && (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Known Relations
                </span>
                <div style={{ marginTop: 4, fontSize: 11, color: '#a0826d' }}>
                  {Object.entries(f.relations).map(([otherId, rel]) => (
                    <div key={otherId} style={{ marginBottom: 2 }}>
                      →{' '}
                      <JournalLink type="faction" id={otherId}>{otherId}</JournalLink>
                      : {rel?.label || rel?.standing || String(rel)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {f.leader && (
              <div style={{ fontSize: 11, color: '#ffd700', marginTop: 4 }}>
                <span style={{ color: '#8b6914', fontWeight: 600 }}>Leader: </span>
                {f.leader}
              </div>
            )}
            {/* Player note */}
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed #2d3748' }}>
              {isEditing ? (
                <div>
                  <textarea
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    rows={2}
                    style={{
                      width: '100%', padding: 6, fontSize: 11,
                      background: '#0a0e1a', color: '#e0d6c8',
                      border: '1px solid #4a3818', borderRadius: 3,
                      fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button onClick={() => saveNote(f.factionId)} style={{
                      padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                      background: '#4a2800', color: '#ffd700',
                      border: '1px solid #8b6914', borderRadius: 3,
                    }}>Save</button>
                    <button onClick={() => { setEditingNote(null); setNoteDraft(''); }} style={{
                      padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                      background: 'none', color: '#8b949e',
                      border: '1px solid #374151', borderRadius: 3,
                    }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { setEditingNote(f.factionId); setNoteDraft(f.playerNotes || ''); }}
                  style={{
                    cursor: 'pointer', fontSize: 11,
                    color: f.playerNotes ? '#e0d6c8' : '#6b7280',
                    fontStyle: f.playerNotes ? 'normal' : 'italic',
                  }}
                >
                  {f.playerNotes || '+ Add note…'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── LOCATIONS TAB ──────────────────────────────────────
const KIND_COLOR = {
  town: '#1e40af',
  wilderness: '#166534',
  dungeon: '#7f1d1d',
  landmark: '#8b6914',
  unknown: '#374151',
};

// ─── WORLD TREE TAB ─────────────────────────────────────
// Visual diagram of the nested location tree (world → country → region →
// town → building → floor → room). Read-only by design — per the
// no-fast-travel rule, we deliberately do not make nodes clickable for
// navigation. The party travels via the Travel button on the Adventure
// tab, which routes long-distance moves through the overland engine so
// random encounters fire along the way. This panel is purely a
// visualization: where you are, what you've visited, what's out there.
//
// Forward-compat with Task #63 (narrative destruction): nodes with
// `status: 'destroyed'` render strikethrough + grayed; 'sealed' gets a
// tag. Neither is set anywhere yet but rendering is idempotent when
// the field is absent.
function WorldTreeSection({ adventure, gmMode = false, onSetNodeStatus = null }) {
  const tree = adventure?.worldTree;
  const activeId = adventure?.activeParty || DEFAULT_PARTY_ID;
  const activeParty = adventure?.parties?.[activeId];
  const activePath = Array.isArray(activeParty?.currentPath) ? activeParty.currentPath : [];
  const activeNodeId = activePath[activePath.length - 1] || null;
  const ancestorSet = useMemo(() => new Set(activePath.slice(0, -1)), [activePath]);

  // Task #65 — GM-mode inline status editor. Only one row is edited at a time;
  // hover reveals the action icons but the inline editor only opens on click.
  // `pendingAction` encodes which icon was clicked ('sealed' | 'destroyed' |
  // 'active' for restore). Reason is optional; cascade defaults to true to
  // match the LLM-driven path in AdventureTab.processNewEntities.
  const [hoverNodeId, setHoverNodeId] = useState(null);
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [cascadeChecked, setCascadeChecked] = useState(true);

  const closeEditor = () => {
    setEditingNodeId(null);
    setPendingAction(null);
    setReasonDraft('');
    setCascadeChecked(true);
  };

  const openEditor = (nodeId, action) => {
    setEditingNodeId(nodeId);
    setPendingAction(action);
    setReasonDraft('');
    setCascadeChecked(true);
  };

  const applyEdit = () => {
    if (!editingNodeId || !pendingAction) { closeEditor(); return; }
    if (typeof onSetNodeStatus === 'function') {
      try {
        onSetNodeStatus(editingNodeId, pendingAction, {
          reason: reasonDraft.trim(),
          cascade: cascadeChecked,
        });
      } catch (err) {
        console.warn('[WorldTreeSection] onSetNodeStatus threw:', err);
      }
    }
    closeEditor();
  };

  // Task #69 (2026-04-19) — unified discovery rule with Locations tab.
  // Precompute the set of node ids whose subtree has at least one visited
  // node (so their structural ancestors render). Combined with
  // isNodeDiscovered, we hide any seeded branch the party hasn't reached or
  // heard of. Matches "Known-to-party" semantics.
  const visitedDescendantIds = useMemo(
    () => computeVisitedAncestorIds(tree),
    [tree],
  );

  // Flatten the tree via DFS so we can render a single vertical list with
  // CSS padding-left standing in for depth. Pushing children in reverse
  // onto the LIFO stack keeps sibling order stable (matches seed order).
  // Undiscovered nodes are skipped entirely (and their subtrees don't
  // recurse) so the operator never sees a list of places the party
  // couldn't know existed yet.
  const rows = useMemo(() => {
    if (!tree || !tree.rootId || !tree.nodes || !tree.nodes[tree.rootId]) return [];
    const out = [];
    const safety = new Set();
    const stack = [{ id: tree.rootId, depth: 0 }];
    while (stack.length) {
      const { id, depth } = stack.pop();
      if (safety.has(id)) continue;
      safety.add(id);
      const node = tree.nodes[id];
      if (!node) continue;
      if (!isNodeDiscovered(tree, id, {
        currentPath: activePath,
        visitedDescendantIds,
      })) continue;
      out.push({ node, depth });
      const children = Array.isArray(node.childrenIds) ? [...node.childrenIds].reverse() : [];
      for (const cid of children) stack.push({ id: cid, depth: depth + 1 });
    }
    return out;
  }, [tree, activePath, visitedDescendantIds]);

  const visitedCount = useMemo(
    () => rows.reduce((n, r) => n + ((r.node.visitCount || 0) > 0 ? 1 : 0), 0),
    [rows],
  );
  // Count of seeded-but-not-yet-discovered nodes (shown as a footer hint so
  // the operator can see the world has more to reveal).
  const hiddenCount = useMemo(() => {
    if (!tree?.nodes) return 0;
    const visibleIds = new Set(rows.map(r => r.node.id));
    let n = 0;
    for (const id of Object.keys(tree.nodes)) {
      if (!visibleIds.has(id)) n += 1;
    }
    return n;
  }, [tree, rows]);

  if (!tree || !tree.rootId || !tree.nodes || !tree.nodes[tree.rootId]) {
    return (
      <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
        The world tree has not been seeded yet. Start an adventure to populate it.
      </div>
    );
  }

  return (
    <div>
      <div style={SECTION_HEADER}>
        World Tree — {rows.length} place{rows.length === 1 ? '' : 's'} known
        {' '}({visitedCount} visited)
      </div>
      <div style={{ marginBottom: 10, color: '#8b949e', fontSize: 11, fontStyle: 'italic' }}>
        Places the party has reached or heard of. Your current location is highlighted in gold;
        ancestors up the chain are dimly marked. Unvisited branches stay hidden until you travel or
        the story reveals them.
      </div>
      <div style={{
        background: '#0a0e1a',
        border: '1px solid #2d3748',
        borderRadius: 4,
        padding: '6px 0',
      }}>
        {rows.map(({ node, depth }) => {
          const isCurrent = node.id === activeNodeId;
          const isAncestor = ancestorSet.has(node.id);
          const isDestroyed = node.status === 'destroyed';
          const isSealed = node.status === 'sealed';
          const icon = KIND_ICON[node.kind] || '📍';
          const visited = (node.visitCount || 0) > 0;
          const isHovered = hoverNodeId === node.id;
          const isEditing = editingNodeId === node.id;
          const showGmControls = gmMode && typeof onSetNodeStatus === 'function';

          // Color priority: destroyed → current → ancestor → visited → unvisited.
          const nameColor = isDestroyed ? '#6b7280'
            : isCurrent ? '#ffd700'
            : isAncestor ? '#e0d6c8'
            : visited ? '#a0826d'
            : '#8b949e';
          const weight = isCurrent ? 700 : (isAncestor ? 600 : 400);

          return (
            <div key={node.id}>
              <div
                onMouseEnter={() => showGmControls && setHoverNodeId(node.id)}
                onMouseLeave={() => showGmControls && setHoverNodeId(h => h === node.id ? null : h)}
                title={node.desc ? `${node.name} — ${node.desc}` : node.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: `2px 8px 2px ${depth * 18 + 6}px`,
                  background: isCurrent ? 'rgba(255, 215, 0, 0.10)' : 'transparent',
                  borderLeft: isCurrent ? '3px solid #ffd700'
                    : isAncestor ? '3px solid #4a3818'
                    : '3px solid transparent',
                  fontSize: 12,
                  lineHeight: 1.55,
                  opacity: isDestroyed ? 0.55 : 1,
                }}
              >
                <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
                <span style={{
                  color: nameColor,
                  fontWeight: weight,
                  textDecoration: isDestroyed ? 'line-through' : 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {node.name}
                </span>
                <span style={{ fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>
                  {node.kind}
                </span>
                {isCurrent && (
                  <span style={{ fontSize: 10, color: '#ffd700', fontStyle: 'italic' }}>
                    ← you are here
                  </span>
                )}
                {isSealed && !isDestroyed && (
                  <span style={{ fontSize: 10, color: '#ca8a04', fontWeight: 600 }}>[sealed]</span>
                )}
                {isDestroyed && (
                  <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>[destroyed]</span>
                )}
                {visited && !isCurrent && !showGmControls && (
                  <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto', flexShrink: 0 }}>
                    👣×{node.visitCount}
                  </span>
                )}
                {showGmControls && (
                  <span style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                    opacity: isHovered || isEditing ? 1 : 0.0,
                    transition: 'opacity 0.12s ease',
                  }}>
                    {visited && !isCurrent && (
                      <span style={{ fontSize: 10, color: '#6b7280', marginRight: 4 }}>
                        👣×{node.visitCount}
                      </span>
                    )}
                    {!isSealed && !isDestroyed && (
                      <button
                        type="button"
                        title="Seal this location"
                        onClick={(e) => { e.stopPropagation(); openEditor(node.id, 'sealed'); }}
                        style={GM_ICON_BTN}
                      >🔒</button>
                    )}
                    {!isDestroyed && (
                      <button
                        type="button"
                        title="Destroy this location"
                        onClick={(e) => { e.stopPropagation(); openEditor(node.id, 'destroyed'); }}
                        style={GM_ICON_BTN}
                      >💥</button>
                    )}
                    {(isSealed || isDestroyed) && (
                      <button
                        type="button"
                        title="Restore (mark active)"
                        onClick={(e) => { e.stopPropagation(); openEditor(node.id, 'active'); }}
                        style={GM_ICON_BTN}
                      >♻️</button>
                    )}
                  </span>
                )}
              </div>
              {isEditing && showGmControls && (
                <div style={{
                  padding: `4px 8px 8px ${depth * 18 + 28}px`,
                  background: 'rgba(255, 215, 0, 0.06)',
                  borderLeft: '3px solid #ca8a04',
                  fontSize: 11,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  <div style={{ color: '#e0d6c8', fontStyle: 'italic' }}>
                    {pendingAction === 'sealed' ? `🔒 Seal ${node.name}?`
                      : pendingAction === 'destroyed' ? `💥 Destroy ${node.name}?`
                      : `♻️ Restore ${node.name} to active?`}
                  </div>
                  <input
                    type="text"
                    value={reasonDraft}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    placeholder="Reason (optional — shown in journal)"
                    style={{
                      background: '#0a0e1a',
                      color: '#e0d6c8',
                      border: '1px solid #2d3748',
                      borderRadius: 3,
                      padding: '3px 6px',
                      fontSize: 11,
                    }}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyEdit();
                      else if (e.key === 'Escape') closeEditor();
                    }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8b949e', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={cascadeChecked}
                      onChange={(e) => setCascadeChecked(e.target.checked)}
                    />
                    Cascade to nested locations
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={applyEdit} style={GM_APPLY_BTN}>Apply</button>
                    <button type="button" onClick={closeEditor} style={GM_CANCEL_BTN}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, color: '#6b7280', fontSize: 10, fontStyle: 'italic' }}>
        To travel, use the Travel button on the Adventure screen — long-distance moves route through
        overland travel so random encounters can fire en route.
        {hiddenCount > 0 && (
          <>
            {' '}{hiddenCount} place{hiddenCount === 1 ? ' remains' : 's remain'} undiscovered in this
            region.
          </>
        )}
      </div>
    </div>
  );
}

function LocationsSection({ sharedNpcs = [], encounteredFactions = [], focusId = null, onOpenMap = null }) {
  const [rows, setRows] = useState([]);
  const [creatures, setCreatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [editingNote, setEditingNote] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const refresh = useCallback(() => {
    Promise.all([
      getEncounteredLocations(),
      getEncounteredCreatures(),
    ]).then(([locs, crs]) => {
      setRows(locs);
      setCreatures(crs);
      setLoading(false);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = useMemo(() => {
    const views = rows.map(publicLocationView).filter(Boolean);
    const focused = focusId ? views.filter(v => v.locationId === focusId) : views;
    const filtered = focused.filter(v => {
      if (!focusId && searchTerm) {
        const q = searchTerm.toLowerCase();
        const inName = (v.name || '').toLowerCase().includes(q);
        const inRegion = (v.region || '').toLowerCase().includes(q);
        const inKind = (v.kind || '').toLowerCase().includes(q);
        if (!inName && !inRegion && !inKind) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return (a.firstSeenAt || '').localeCompare(b.firstSeenAt || '');
        case 'name':   return (a.name || '').localeCompare(b.name || '');
        case 'visits': return (b.visits || 0) - (a.visits || 0);
        case 'recent':
        default: return (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
      }
    });
    return sorted;
  }, [rows, searchTerm, sortBy, focusId]);

  const saveNote = async (locationId) => {
    await setLocationPlayerNote(locationId, noteDraft);
    setEditingNote(null);
    setNoteDraft('');
    refresh();
  };

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div style={SECTION_HEADER}>Places Visited ({visible.length})</div>
      <div style={FILTER_ROW}>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={SELECT_STYLE} title="Sort by">
          <option value="recent">Most Recent</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name (A→Z)</option>
          <option value="visits">Most Visited</option>
        </select>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by name, region, kind…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          The party has not yet set foot anywhere notable.
        </div>
      )}
      {visible.map(loc => {
        const color = KIND_COLOR[loc.kind] || KIND_COLOR.unknown;
        const isEditing = editingNote === loc.locationId;
        const refs = deriveLocationRefs(loc.name, {
          npcs: sharedNpcs,
          encounteredFactions,
          creatures,
        });
        return (
          <div key={loc.locationId} style={{ ...CARD, borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <div style={{ color: '#ffd700', fontWeight: 700, fontSize: 14 }}>
                {loc.name}
              </div>
              <div style={{ color: '#6b7280', fontSize: 10 }}>{formatRelativeDate(loc.lastSeenAt)}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
              <span style={{
                padding: '1px 6px', borderRadius: 3,
                background: color, color: '#fff', fontSize: 10, fontWeight: 600,
                textTransform: 'capitalize',
              }}>{loc.kind}</span>
              {loc.region && <span>· {loc.region}</span>}
              <span>👣 ×{loc.visits}</span>
              {loc.mapId && onOpenMap && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenMap(loc.mapId, loc.poiId); }}
                  title={loc.poiId ? 'Show this place on the map' : 'Open the map for this region'}
                  style={{
                    padding: '1px 6px', fontSize: 10, cursor: 'pointer',
                    background: 'none', color: '#ffd700',
                    border: '1px solid #4a3818', borderRadius: 3,
                  }}
                >
                  📍 View on map
                </button>
              )}
            </div>
            {loc.firstImpression && (
              <div style={{ color: '#a0826d', fontSize: 12, fontStyle: 'italic', marginBottom: 6 }}>
                {loc.firstImpression}
              </div>
            )}
            {refs.npcs.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
                <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  People met here:
                </span>
                {refs.npcs.map(n => {
                  const label = n.knownToParty ? n.name : unknownNpcLabel(n.shortDesc, 'a stranger');
                  return (
                    <JournalLink
                      key={n.id}
                      type="npc"
                      id={n.id}
                      disabled={!n.knownToParty}
                      title={n.knownToParty ? 'Open journal entry' : 'Name not yet known'}
                    >
                      {label}
                    </JournalLink>
                  );
                })}
              </div>
            )}
            {refs.factions.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
                <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Factions active:
                </span>
                {refs.factions.map(f => (
                  <JournalLink key={f.factionId} type="faction" id={f.factionId}>
                    {f.name || f.factionId}
                  </JournalLink>
                ))}
              </div>
            )}
            {refs.creatures.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#a0826d' }}>
                <span style={{ color: '#8b6914', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Creatures encountered:
                </span>
                {' '}{refs.creatures.map(c => c.displayName || c.name).join(', ')}
              </div>
            )}
            {/* Player note */}
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed #2d3748' }}>
              {isEditing ? (
                <div>
                  <textarea
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    rows={2}
                    style={{
                      width: '100%', padding: 6, fontSize: 11,
                      background: '#0a0e1a', color: '#e0d6c8',
                      border: '1px solid #4a3818', borderRadius: 3,
                      fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button onClick={() => saveNote(loc.locationId)} style={{
                      padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                      background: '#4a2800', color: '#ffd700',
                      border: '1px solid #8b6914', borderRadius: 3,
                    }}>Save</button>
                    <button onClick={() => { setEditingNote(null); setNoteDraft(''); }} style={{
                      padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                      background: 'none', color: '#8b949e',
                      border: '1px solid #374151', borderRadius: 3,
                    }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { setEditingNote(loc.locationId); setNoteDraft(loc.playerNotes || ''); }}
                  style={{
                    cursor: 'pointer', fontSize: 11,
                    color: loc.playerNotes ? '#e0d6c8' : '#6b7280',
                    fontStyle: loc.playerNotes ? 'normal' : 'italic',
                  }}
                >
                  {loc.playerNotes || '+ Add note…'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── CLUES & HINTS TAB ──────────────────────────────────
// Per-campaign memory of "important topics the party has encountered" —
// clues, hints, leads, rumors, open to-dos. Categorized + pinnable +
// resolvable. Stored in encounteredClues (Dexie v12) via cluesTracker.
const CLUE_CATEGORY_COLOR = {
  clue:  '#7c3aed', // violet — something discovered
  hint:  '#0891b2', // cyan — something suggested
  lead:  '#ca8a04', // amber — someone/somewhere to chase
  rumor: '#9333ea', // purple — unverified talk
  todo:  '#16a34a', // green — an open action
};

function CluesSection({ sharedNpcs = [], sharedFactions = [], addLog = null }) {
  const [clues, setClues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');
  const [draftCategory, setDraftCategory] = useState('clue');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showResolved, setShowResolved] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const refresh = useCallback(() => {
    getClues().then(rows => {
      setClues(rows);
      setLoading(false);
    });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    const text = draftText.trim();
    if (!text) return;
    const title = draftTitle.trim() || text.slice(0, 80);
    // addClue emits a journalEvents bus event internally — App.jsx's
    // subscriber forwards that to the narrative log, so we don't need
    // to call addLog directly here.
    await addClue({ title, text, category: draftCategory, source: 'player' });
    setDraftTitle('');
    setDraftText('');
    setDraftCategory('clue');
    refresh();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this clue permanently?')) return;
    await deleteClue(id);
    if (expandedId === id) setExpandedId(null);
    refresh();
  };
  const handleTogglePin = async (clue) => {
    await setCluePinned(clue.id, !clue.pinned);
    refresh();
  };
  const handleToggleResolved = async (clue) => {
    await resolveClue(clue.id, !clue.resolvedAt);
    refresh();
  };
  const handleEditNotes = async (clue, nextNotes) => {
    await updateClue(clue.id, { playerNotes: nextNotes });
    refresh();
  };

  const visible = useMemo(() => {
    let filtered = clues;
    if (!showResolved) filtered = filtered.filter(c => !c.resolvedAt);
    if (categoryFilter !== 'all') filtered = filtered.filter(c => c.category === categoryFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(c =>
        (c.title || '').toLowerCase().includes(q) ||
        (c.text || '').toLowerCase().includes(q) ||
        (c.playerNotes || '').toLowerCase().includes(q)
      );
    }
    return filtered; // already sorted pinned-then-newest by the tracker
  }, [clues, categoryFilter, showResolved, searchTerm]);

  const openCount = useMemo(
    () => clues.filter(c => !c.resolvedAt).length,
    [clues]
  );

  if (loading) return <div style={{ color: '#8b949e', padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div style={SECTION_HEADER}>
        Clues &amp; Hints ({openCount} open{clues.length !== openCount ? ` · ${clues.length - openCount} resolved` : ''})
      </div>
      <div style={{ ...CARD, marginBottom: 12 }}>
        <input
          type="text"
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          placeholder="Short title (optional — defaults to first line)"
          style={{ ...INPUT_STYLE, width: '100%', marginBottom: 6 }}
        />
        <textarea
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
          placeholder="What did the party learn? A hint from an NPC, a lead to chase, a rumor overheard in the tavern…"
          rows={3}
          style={{
            width: '100%', padding: 8, fontSize: 12,
            background: '#0a0e1a', color: '#e0d6c8',
            border: '1px solid #4a3818', borderRadius: 4, resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <select value={draftCategory} onChange={e => setDraftCategory(e.target.value)} style={SELECT_STYLE}>
            {CLUE_CATEGORIES.map(c => (
              <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button onClick={handleAdd} disabled={!draftText.trim()} style={{
            marginLeft: 'auto', padding: '6px 14px', fontSize: 12,
            background: draftText.trim() ? '#4a2800' : '#1a1a2e',
            color: draftText.trim() ? '#ffd700' : '#6b7280',
            border: '1px solid #8b6914', borderRadius: 4,
            cursor: draftText.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}>Add Clue</button>
        </div>
      </div>
      <div style={FILTER_ROW}>
        {['all', ...CLUE_CATEGORIES].map(f => (
          <button key={f} onClick={() => setCategoryFilter(f)} style={PILL(categoryFilter === f)}>{f}</button>
        ))}
        <button
          onClick={() => setShowResolved(v => !v)}
          style={PILL(showResolved)}
          title="Show clues the party has already followed up on"
        >{showResolved ? '✓ Show resolved' : 'Hide resolved'}</button>
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search clues…"
          style={INPUT_STYLE}
        />
      </div>
      {visible.length === 0 && (
        <div style={{ color: '#6b7280', padding: 20, textAlign: 'center', fontStyle: 'italic' }}>
          {clues.length === 0
            ? 'No clues yet. Add one to start tracking leads, hints, and open threads.'
            : 'No clues match your filters.'}
        </div>
      )}
      {visible.map(clue => {
        const color = CLUE_CATEGORY_COLOR[clue.category] || '#6b7280';
        const expanded = expandedId === clue.id;
        const resolved = Boolean(clue.resolvedAt);
        return (
          <div key={clue.id} style={{
            ...CARD,
            borderLeft: clue.pinned
              ? '3px solid #ffd700'
              : `3px solid ${color}`,
            opacity: resolved ? 0.55 : 1,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
              <div
                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                onClick={() => setExpandedId(expanded ? null : clue.id)}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                    background: color, color: '#0a0e1a', textTransform: 'uppercase',
                    letterSpacing: 1, fontWeight: 700,
                  }}>{clue.category}</span>
                  {resolved && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3,
                      background: '#374151', color: '#9ca3af', textTransform: 'uppercase',
                      letterSpacing: 1,
                    }}>resolved</span>
                  )}
                  {clue.source && clue.source !== 'gm' && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3,
                      background: 'none', color: '#6b7280', border: '1px solid #374151',
                    }}>{clue.source}</span>
                  )}
                  <span style={{ color: '#6b7280', fontSize: 10 }}>
                    {formatRelativeDate(clue.createdAt)}
                  </span>
                </div>
                <div style={{
                  color: resolved ? '#8b949e' : '#ffd700',
                  fontSize: 13, fontWeight: 600, marginBottom: 2,
                  textDecoration: resolved ? 'line-through' : 'none',
                }}>{clue.title || clue.text.slice(0, 80)}</div>
                {expanded && (
                  <div style={{ color: '#e0d6c8', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginTop: 6 }}>
                    {clue.text}
                  </div>
                )}
                {expanded && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ color: '#8b949e', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
                      Party notes
                    </div>
                    <textarea
                      value={clue.playerNotes || ''}
                      onChange={e => handleEditNotes(clue, e.target.value)}
                      placeholder="What did the party do about this? Who followed up?"
                      rows={2}
                      onClick={e => e.stopPropagation()}
                      style={{
                        width: '100%', padding: 6, fontSize: 11,
                        background: '#0a0e1a', color: '#e0d6c8',
                        border: '1px solid #4a3818', borderRadius: 4, resize: 'vertical',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={() => handleTogglePin(clue)} title={clue.pinned ? 'Unpin' : 'Pin'} style={{
                  background: 'none', border: '1px solid #4a3818',
                  color: clue.pinned ? '#ffd700' : '#6b7280',
                  borderRadius: 3, cursor: 'pointer', padding: '2px 6px', fontSize: 11,
                }}>{clue.pinned ? '★' : '☆'}</button>
                <button onClick={() => handleToggleResolved(clue)} title={resolved ? 'Mark open' : 'Mark resolved'} style={{
                  background: 'none', border: '1px solid #4a3818',
                  color: resolved ? '#16a34a' : '#6b7280',
                  borderRadius: 3, cursor: 'pointer', padding: '2px 6px', fontSize: 11,
                }}>✓</button>
                <button onClick={() => handleDelete(clue.id)} title="Delete" style={{
                  background: 'none', border: '1px solid #4a1a1a',
                  color: '#dc2626', borderRadius: 3, cursor: 'pointer',
                  padding: '2px 6px', fontSize: 11,
                }}>×</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────
export default function AdventurerJournal({ gameLog = [], campaign = null, adventure = null, onOpenMap = null, focusHint = null, gmMode = false, activeCharacter = null, onUpdateCharacter = null, onUpdateCampaign = null, addLog = null, onSetNodeStatus = null }) {
  const [view, setView] = useState({ tab: 'npcs', focusId: null });
  const [history, setHistory] = useState([]);
  // React to a parent-supplied focus request (e.g. MapTab "Open in journal").
  // `at` makes each request a fresh event so re-clicking the same target re-navigates.
  const lastFocusHintRef = useRef(null);
  useEffect(() => {
    if (!focusHint?.at || focusHint.at === lastFocusHintRef.current) return;
    lastFocusHintRef.current = focusHint.at;
    const nextTab = TYPE_TO_TAB[focusHint.type] || focusHint.type;
    if (!nextTab) return;
    setHistory(h => [...h, { tab: nextTab, focusId: null }]);
    setView({ tab: nextTab, focusId: focusHint.id || null });
  }, [focusHint]);
  const [sharedNpcs, setSharedNpcs] = useState([]);
  const [encounteredFactionIds, setEncounteredFactionIds] = useState(() => new Set());
  const [sharedFactions, setSharedFactions] = useState([]);

  // Load shared NPC + faction-discovery state so all sections can cross-link.
  // v11 — read through getEncounteredNPCs() so we only ever see THIS
  // campaign's people; legacy/orphan rows from earlier games stay hidden.
  useEffect(() => {
    let mounted = true;
    getEncounteredNPCs().then(rows => { if (mounted) setSharedNpcs(rows); });
    getEncounteredFactions().then(rows => {
      if (mounted) {
        setEncounteredFactionIds(new Set(rows.map(r => r.factionId)));
        setSharedFactions(rows);
      }
    });
    return () => { mounted = false; };
  }, [view]); // re-fetch after nav so newly-recorded entries appear

  const router = React.useMemo(() => ({
    view,
    history,
    go: (type, id) => {
      const nextTab = TYPE_TO_TAB[type] || type;
      setHistory(h => [...h, view]);
      setView({ tab: nextTab, focusId: id || null });
    },
    back: () => {
      // Read the closed-over history snapshot; don't chain setters.
      if (history.length === 0) return;
      const prev = history[history.length - 1];
      setHistory(history.slice(0, -1));
      setView(prev);
    },
  }), [view, history]);

  // Defense in depth — App.jsx already gates this panel, but if a parent
  // ever forgets to pass campaign, refuse to render any saved data.
  if (!campaign) {
    return (
      <div style={{ padding: 24, color: '#8b949e', textAlign: 'center', fontStyle: 'italic' }}>
        Load or start a campaign to access the Adventurer's Journal.
      </div>
    );
  }

  const inner = campaign.data || campaign;
  const setTab = (t) => { setHistory([]); setView({ tab: t, focusId: null }); };

  return (
    <JournalRouterContext.Provider value={router}>
      <div style={{ padding: 16, color: '#e0d6c8', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #4a3818', marginBottom: 12, flexShrink: 0 }}>
          <button onClick={() => setTab('npcs')} style={TAB_STYLE(view.tab === 'npcs')}>People</button>
          <button onClick={() => setTab('factions')} style={TAB_STYLE(view.tab === 'factions')}>Factions</button>
          <button onClick={() => setTab('bestiary')} style={TAB_STYLE(view.tab === 'bestiary')}>Bestiary</button>
          <button onClick={() => setTab('locations')} style={TAB_STYLE(view.tab === 'locations')}>Locations</button>
          <button onClick={() => setTab('worldtree')} style={TAB_STYLE(view.tab === 'worldtree')}>World</button>
          <button onClick={() => setTab('clues')} style={TAB_STYLE(view.tab === 'clues')}>Clues</button>
          <button onClick={() => setTab('log')} style={TAB_STYLE(view.tab === 'log')}>Adventure Log</button>
          <button onClick={() => setTab('notes')} style={TAB_STYLE(view.tab === 'notes')}>Notes</button>
        </div>
        {(history.length > 0 || view.focusId) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {history.length > 0 && (
              <button
                onClick={router.back}
                style={{
                  padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                  background: '#1a1a2e', color: '#ffd700',
                  border: '1px solid #4a3818', borderRadius: 3,
                }}
              >← Back</button>
            )}
            {view.focusId && (
              <>
                <button
                  onClick={() => setView({ tab: view.tab, focusId: null })}
                  style={{
                    padding: '3px 10px', fontSize: 11, cursor: 'pointer',
                    background: 'none', color: '#8b949e',
                    border: '1px solid #374151', borderRadius: 3,
                  }}
                  title="Exit focus and see all entries on this tab"
                >✕ Clear focus</button>
                <span style={{ fontSize: 11, color: '#8b949e', fontStyle: 'italic' }}>
                  Focused on {view.focusId}
                </span>
              </>
            )}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', paddingRight: 4 }}>
          {view.tab === 'npcs' && (
            <NPCsSection
              npcs={sharedNpcs}
              encounteredFactionIds={encounteredFactionIds}
              focusId={view.focusId}
              campaign={inner}
              gmMode={gmMode}
              onRefresh={() => getEncounteredNPCs().then(setSharedNpcs)}
              activeCharacter={activeCharacter}
              onUpdateCharacter={onUpdateCharacter}
              onUpdateCampaign={onUpdateCampaign}
            />
          )}
          {view.tab === 'factions' && (
            <FactionsSection
              campaign={inner}
              sharedNpcs={sharedNpcs}
              focusId={view.focusId}
            />
          )}
          {view.tab === 'bestiary' && <BestiarySection />}
          {view.tab === 'locations' && (
            <LocationsSection
              sharedNpcs={sharedNpcs}
              encounteredFactions={sharedFactions}
              focusId={view.focusId}
              onOpenMap={onOpenMap}
            />
          )}
          {view.tab === 'worldtree' && (
            <WorldTreeSection
              adventure={adventure}
              gmMode={gmMode}
              onSetNodeStatus={onSetNodeStatus}
            />
          )}
          {view.tab === 'clues' && (
            <CluesSection
              sharedNpcs={sharedNpcs}
              sharedFactions={sharedFactions}
              addLog={addLog}
            />
          )}
          {view.tab === 'log' && <AdventureLogSection gameLog={gameLog} />}
          {view.tab === 'notes' && <NotesSection />}
        </div>
      </div>
    </JournalRouterContext.Provider>
  );
}
