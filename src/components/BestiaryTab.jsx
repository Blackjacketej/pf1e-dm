import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import db from '../db/database';
import { getXPForCR, calculateEncounterXP, calculateAPL } from '../services/dmToolsService';
import { uid } from '../utils/dice';
import dmEngine from '../services/dmEngine';

const CR_OPTIONS = [
  { label: 'All CRs', value: 'all' },
  { label: 'CR 0-1', min: 0, max: 1 },
  { label: 'CR 2-5', min: 2, max: 5 },
  { label: 'CR 6-10', min: 6, max: 10 },
  { label: 'CR 11-15', min: 11, max: 15 },
  { label: 'CR 16-20', min: 16, max: 20 },
  { label: 'CR 21+', min: 21, max: 999 },
];

const TYPE_OPTIONS = [
  'All Types', 'Aberration', 'Animal', 'Construct', 'Dragon', 'Fey',
  'Humanoid', 'Magical Beast', 'Monstrous Humanoid', 'Ooze', 'Outsider',
  'Plant', 'Undead', 'Vermin',
];

const SIZE_OPTIONS = ['All Sizes', 'Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];
const ALIGNMENT_OPTIONS = ['All Alignments', 'LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE'];
const SORT_OPTIONS = [
  { label: 'CR (Low-High)', value: 'cr-asc' },
  { label: 'CR (High-Low)', value: 'cr-desc' },
  { label: 'Name A-Z', value: 'alpha' },
  { label: 'Name Z-A', value: 'alpha-desc' },
  { label: 'HP (High-Low)', value: 'hp-desc' },
  { label: 'AC (High-Low)', value: 'ac-desc' },
];

const PAGE_SIZE = 50;

export default function BestiaryTab({ party, addLog, setCombat, setTab }) {
  const [monsters, setMonsters] = useState([]);
  const [search, setSearch] = useState('');
  const [crFilter, setCrFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [sizeFilter, setSizeFilter] = useState('All Sizes');
  const [alignFilter, setAlignFilter] = useState('All Alignments');
  const [sortBy, setSortBy] = useState('cr-asc');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [encounterList, setEncounterList] = useState([]);
  const [showEncounterBuilder, setShowEncounterBuilder] = useState(false);
  const [loreCache, setLoreCache] = useState({});  // { monsterName: { text, loading, error } }

  const generateLore = useCallback(async (monster) => {
    const name = monster.name;
    if (loreCache[name]?.text || loreCache[name]?.loading) return;
    if (!dmEngine.settings?.apiKey) {
      setLoreCache(prev => ({ ...prev, [name]: { text: null, loading: false, error: 'No API key configured. Set it in Settings.' } }));
      return;
    }
    setLoreCache(prev => ({ ...prev, [name]: { text: null, loading: true, error: null } }));

    try {
      const statSummary = [
        `CR ${monster.cr}`, monster.type, monster.subtype ? `(${monster.subtype})` : '',
        monster.alignment, monster.size,
        `HP ${monster.hp}, AC ${monster.ac}`,
        monster.speed ? `Speed: ${monster.speed}` : '',
        monster.special ? `Special: ${monster.special}` : '',
        monster.environment ? `Environment: ${monster.environment}` : '',
      ].filter(Boolean).join(', ');

      const prompt = `You are writing a Pathfinder 1st Edition bestiary entry for "${name}".
Stats: ${statSummary}
${monster.description ? `Appearance: ${monster.description}` : ''}

Write a detailed monster manual entry covering:
1. Physical description and appearance (2-3 sentences)
2. Ecology and habitat (2-3 sentences)
3. Behavior, society, and culture if applicable (2-3 sentences)
4. Combat tactics and notable abilities (2-3 sentences)
5. Lore and role in Golarion/campaign settings (1-2 sentences)

Write in an authoritative, encyclopedic tone matching the Pathfinder Bestiary style. Be specific and vivid. 2-3 short paragraphs total, no headers or bullet points.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': dmEngine.settings.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: dmEngine.settings.model || 'claude-sonnet-4-6',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      setLoreCache(prev => ({ ...prev, [name]: { text, loading: false, error: null } }));
    } catch (err) {
      console.error('Lore generation failed:', err);
      setLoreCache(prev => ({ ...prev, [name]: { text: null, loading: false, error: err.message } }));
    }
  }, [loreCache]);

  const addToEncounter = (monster) => {
    setEncounterList(prev => [...prev, { ...monster, instanceId: uid() }]);
    setShowEncounterBuilder(true);
  };
  const removeFromEncounter = (instanceId) => {
    setEncounterList(prev => prev.filter(m => m.instanceId !== instanceId));
  };
  const launchEncounter = () => {
    if (encounterList.length === 0 || !party || party.length === 0) return;
    const enemies = encounterList.map(m => ({
      id: uid(),
      name: m.name,
      hp: m.hp || 10,
      currentHP: m.hp || 10,
      ac: m.ac || 10,
      cr: m.cr || 1,
      xp: m.xp || 0,
      str: m.str ?? null, dex: m.dex ?? null, con: m.con ?? null,
      int: m.int ?? null, wis: m.wis ?? null, cha: m.cha ?? null,
      init: m.init || 0, fort: m.fort || 0, ref: m.ref || 0, will: m.will || 0,
      cmb: m.cmb || 0, cmd: m.cmd || 0, bab: m.bab || 0,
      type: m.type || 'humanoid',
      special: m.special || '',
      atk: m.atk || '', dmg: m.dmg || '',
      speed: m.speed || '30 ft.', alignment: m.alignment || '',
      size: m.size || 'Medium', senses: m.senses || '',
      conditions: [],
    }));
    const roll20 = () => Math.floor(Math.random() * 20) + 1;
    const order = [
      ...party.map(p => ({
        id: p.id, name: p.name,
        init: roll20() + Math.floor(((p.abilities?.DEX || 10) - 10) / 2),
      })),
      ...enemies.map(e => ({
        id: e.id, name: e.name,
        init: roll20() + (e.init || 0),
      })),
    ].sort((a, b) => b.init - a.init);

    setCombat?.({
      active: true, round: 1,
      order: order.map(({ id, name }) => ({ id, name })),
      currentTurn: 0, enemies,
    });
    addLog?.(`Custom encounter launched: ${encounterList.length} monsters`, 'event');
    setEncounterList([]);
    // Combat panel opens automatically via setCombat
  };

  const encounterXP = encounterList.length > 0
    ? calculateEncounterXP(encounterList.map(m => m.cr || 1), party?.length || 4)
    : null;

  useEffect(() => {
    db.monsters.toArray().then(data => {
      setMonsters(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load monsters:', err);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    let result = monsters;

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(m =>
        m.name?.toLowerCase().includes(s) ||
        m.type?.toLowerCase().includes(s) ||
        m.special?.toLowerCase().includes(s)
      );
    }

    if (crFilter !== 'all') {
      const opt = CR_OPTIONS.find(o => o.label === crFilter);
      if (opt) result = result.filter(m => m.cr >= opt.min && m.cr <= opt.max);
    }

    if (typeFilter !== 'All Types') {
      result = result.filter(m => m.type?.toLowerCase().includes(typeFilter.toLowerCase()));
    }

    if (sizeFilter !== 'All Sizes') {
      result = result.filter(m => m.size === sizeFilter);
    }

    if (alignFilter !== 'All Alignments') {
      result = result.filter(m => (m.alignment || '').includes(alignFilter));
    }

    // Sort
    switch (sortBy) {
      case 'cr-asc': result.sort((a, b) => (a.cr || 0) - (b.cr || 0) || (a.name || '').localeCompare(b.name || '')); break;
      case 'cr-desc': result.sort((a, b) => (b.cr || 0) - (a.cr || 0) || (a.name || '').localeCompare(b.name || '')); break;
      case 'alpha': result.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
      case 'alpha-desc': result.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
      case 'hp-desc': result.sort((a, b) => (b.hp || 0) - (a.hp || 0) || (a.name || '').localeCompare(b.name || '')); break;
      case 'ac-desc': result.sort((a, b) => (b.ac || 0) - (a.ac || 0) || (a.name || '').localeCompare(b.name || '')); break;
      default: result.sort((a, b) => (a.cr || 0) - (b.cr || 0) || (a.name || '').localeCompare(b.name || ''));
    }

    return result;
  }, [monsters, search, crFilter, typeFilter, sizeFilter, alignFilter, sortBy]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, crFilter, typeFilter, sizeFilter, alignFilter, sortBy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const styles = {
    container: { padding: '16px', overflowY: 'auto', height: '100%' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
    title: { color: '#ffd700', fontSize: '18px', fontWeight: 'bold' },
    count: { color: '#b0b0b0', fontSize: '13px' },
    filters: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' },
    searchBar: {
      padding: '10px', backgroundColor: '#2a2a4e', border: '1px solid #ffd700',
      borderRadius: '4px', color: '#d4c5a9', flex: '1', minWidth: '200px', fontFamily: 'monospace',
    },
    select: {
      padding: '10px', backgroundColor: '#2a2a4e', border: '1px solid #ffd700',
      borderRadius: '4px', color: '#d4c5a9',
    },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' },
    card: {
      backgroundColor: '#2a2a4e', border: '1px solid rgba(255,215,0,0.4)',
      borderRadius: '6px', padding: '12px', cursor: 'pointer', transition: 'all 0.15s',
    },
    cardTitle: { color: '#ffd700', fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' },
    crBadge: {
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '11px', fontWeight: 'bold', marginLeft: '8px',
    },
    stat: { fontSize: '12px', color: '#b0b0b0', marginBottom: '2px' },
    statRow: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' },
    statBox: {
      backgroundColor: '#1a1a2e', padding: '4px 8px', borderRadius: '3px',
      border: '1px solid rgba(255,215,0,0.2)', fontSize: '11px', textAlign: 'center',
    },
    statLabel: { color: '#ffd700', fontWeight: 'bold', fontSize: '10px' },
    statValue: { color: '#d4c5a9' },
    special: { fontSize: '11px', color: '#87ceeb', marginTop: '6px', lineHeight: '1.4' },
    expandedSection: {
      marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,215,0,0.15)',
    },
    pagination: {
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      gap: '12px', marginTop: '16px', marginBottom: '8px',
    },
    pageBtn: {
      padding: '8px 16px', backgroundColor: '#3a3a6e', border: '1px solid #ffd700',
      color: '#ffd700', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px',
    },
    loading: { textAlign: 'center', padding: '40px', color: '#666' },
  };

  const getCrColor = (cr) => {
    if (cr <= 1) return '#44ff44';
    if (cr <= 5) return '#88ff44';
    if (cr <= 10) return '#ffaa00';
    if (cr <= 15) return '#ff6644';
    return '#ff4444';
  };

  if (loading) {
    return <div style={styles.container}><div style={styles.loading}>Loading Bestiary...</div></div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>Bestiary</div>
        <div style={styles.count}>{filtered.length} of {monsters.length} creatures</div>
      </div>

      <div style={styles.filters}>
        <input
          type="text" placeholder="Search monsters, types, or abilities..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={styles.searchBar}
        />
        <select style={styles.select} value={crFilter} onChange={(e) => setCrFilter(e.target.value)}>
          {CR_OPTIONS.map(o => <option key={o.label} value={o.label || o.value}>{o.label}</option>)}
        </select>
        <select style={styles.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={styles.select} value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)}>
          {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={styles.select} value={alignFilter} onChange={(e) => setAlignFilter(e.target.value)}>
          {ALIGNMENT_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={styles.select} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          {SORT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div style={styles.grid}>
        {paged.map((m, idx) => {
          const isExpanded = expanded === m.name;
          return (
            <div
              key={`${m.name}-${idx}`}
              style={{ ...styles.card, borderColor: isExpanded ? '#ffd700' : 'rgba(255,215,0,0.4)' }}
              onClick={() => setExpanded(isExpanded ? null : m.name)}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3a3a6e'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#2a2a4e'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={styles.cardTitle}>
                  {m.name}
                  <span style={{ ...styles.crBadge, backgroundColor: getCrColor(m.cr), color: '#000' }}>
                    CR {m.cr < 1 ? (m.cr === 0.5 ? '1/2' : m.cr === 0.33 ? '1/3' : m.cr === 0.25 ? '1/4' : m.cr === 0.125 ? '1/8' : m.cr) : m.cr}
                  </span>
                </div>
                <div style={{ fontSize: '10px', color: '#888' }}>{isExpanded ? '▼' : '▶'}</div>
              </div>
              <div style={styles.stat}>{m.type}</div>

              <div style={styles.statRow}>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>HP</div>
                  <div style={styles.statValue}>{m.hp}</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>AC</div>
                  <div style={styles.statValue}>{m.ac}</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>Init</div>
                  <div style={styles.statValue}>{m.init >= 0 ? '+' : ''}{m.init}</div>
                </div>
                <div style={styles.statBox}>
                  <div style={styles.statLabel}>XP</div>
                  <div style={styles.statValue}>{m.xp?.toLocaleString()}</div>
                </div>
              </div>

              {isExpanded && (
                <div style={styles.expandedSection}>
                  {/* Lore / Description */}
                  {(() => {
                    const lore = loreCache[m.name];
                    return (
                      <div style={{ marginBottom: 10 }}>
                        {m.description && (
                          <div style={{ color: '#b0a690', fontStyle: 'italic', marginBottom: 6, lineHeight: 1.4, fontSize: 12 }}
                            dangerouslySetInnerHTML={{ __html: m.description }} />
                        )}
                        {lore?.text && (
                          <div style={{ color: '#c8bda6', lineHeight: 1.5, fontSize: 12, marginBottom: 6, padding: '8px 10px',
                            background: 'rgba(255,215,0,0.04)', borderLeft: '2px solid rgba(255,215,0,0.25)', borderRadius: 2 }}>
                            {lore.text.split('\n').filter(Boolean).map((p, j) => <p key={j} style={{ margin: '0 0 6px 0' }}>{p}</p>)}
                          </div>
                        )}
                        {lore?.error && <div style={{ color: '#ff6b6b', fontSize: 11, marginBottom: 4 }}>{lore.error}</div>}
                        {!lore?.text && (
                          <button
                            style={{
                              padding: '4px 12px', fontSize: 11, fontWeight: 'bold', cursor: 'pointer',
                              background: lore?.loading ? '#2a2a4e' : '#1a3a5e', border: '1px solid #4488cc',
                              color: lore?.loading ? '#8b949e' : '#66aaff', borderRadius: 4,
                              opacity: lore?.loading ? 0.7 : 1, marginBottom: 6,
                            }}
                            disabled={lore?.loading}
                            onClick={(e) => { e.stopPropagation(); generateLore(m); }}>
                            {lore?.loading ? 'Generating lore...' : 'Generate Bestiary Lore'}
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Defense */}
                  <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 11, marginBottom: 2, marginTop: 4 }}>DEFENSE</div>
                  <div style={styles.statRow}>
                    <div style={styles.statBox}><div style={styles.statLabel}>Fort</div><div style={styles.statValue}>{m.fort >= 0 ? '+' : ''}{m.fort}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>Ref</div><div style={styles.statValue}>{m.ref >= 0 ? '+' : ''}{m.ref}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>Will</div><div style={styles.statValue}>{m.will >= 0 ? '+' : ''}{m.will}</div></div>
                  </div>
                  {m.dr && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>DR</strong> {m.dr}</div>}
                  {m.immune && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Immune</strong> {m.immune}</div>}
                  {m.resist && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Resist</strong> {m.resist}</div>}
                  {m.sr && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>SR</strong> {m.sr}</div>}

                  {/* Offense */}
                  <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 11, marginBottom: 2, marginTop: 8 }}>OFFENSE</div>
                  {m.speed && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Speed</strong> {m.speed}</div>}
                  {m.atk && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Melee</strong> {m.atk}</div>}
                  {m.fullAttack && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Full Attack</strong> {m.fullAttack}</div>}
                  {m.ranged && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Ranged</strong> {m.ranged}</div>}
                  {m.dmg && !m.atk && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Damage</strong> {m.dmg}</div>}
                  {m.space && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Space</strong> {m.space}{m.reach ? `, Reach ${m.reach}` : ''}</div>}
                  {!m.space && m.reach && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Reach</strong> {m.reach}</div>}
                  {m.special && <div style={styles.special}><strong style={{ color: '#87ceeb' }}>Special</strong> {m.special}</div>}
                  {m.spells && Array.isArray(m.spells) && m.spells.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {m.spells.map((s, j) => {
                        const entries = typeof s === 'object' ? Object.entries(s) : [];
                        return entries.map(([key, val]) => (
                          <div key={`${j}-${key}`} style={{ ...styles.stat, marginTop: 2 }}>
                            <strong style={{ color: '#87ceeb' }}>{key}: </strong>
                            <span dangerouslySetInnerHTML={{ __html: val }} />
                          </div>
                        ));
                      })}
                    </div>
                  )}

                  {/* Statistics */}
                  <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 11, marginBottom: 2, marginTop: 8 }}>STATISTICS</div>
                  <div style={styles.statRow}>
                    <div style={styles.statBox}><div style={styles.statLabel}>STR</div><div style={styles.statValue}>{m.str ?? '—'}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>DEX</div><div style={styles.statValue}>{m.dex ?? '—'}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>CON</div><div style={styles.statValue}>{m.con || '—'}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>INT</div><div style={styles.statValue}>{m.int ?? '—'}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>WIS</div><div style={styles.statValue}>{m.wis ?? '—'}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>CHA</div><div style={styles.statValue}>{m.cha ?? '—'}</div></div>
                  </div>
                  <div style={{ ...styles.statRow, marginTop: 4 }}>
                    <div style={styles.statBox}><div style={styles.statLabel}>BAB</div><div style={styles.statValue}>{m.bab >= 0 ? '+' : ''}{m.bab}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>CMB</div><div style={styles.statValue}>{m.cmb >= 0 ? '+' : ''}{m.cmb}</div></div>
                    <div style={styles.statBox}><div style={styles.statLabel}>CMD</div><div style={styles.statValue}>{m.cmd}</div></div>
                  </div>
                  {m.feats && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Feats</strong> {m.feats}</div>}
                  {m.skills && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Skills</strong> {m.skills}</div>}
                  {m.languages && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Languages</strong> {m.languages}</div>}
                  {m.senses && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Senses</strong> {m.senses}</div>}

                  {/* Ecology */}
                  {(m.environment || m.organization || m.treasure) && (
                    <>
                      <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 11, marginBottom: 2, marginTop: 8 }}>ECOLOGY</div>
                      {m.environment && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Environment</strong> {m.environment}</div>}
                      {m.organization && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Organization</strong> {m.organization}</div>}
                      {m.treasure && <div style={styles.stat}><strong style={{ color: '#87ceeb' }}>Treasure</strong> {m.treasure}</div>}
                    </>
                  )}

                  {m.source && <div style={{ ...styles.stat, marginTop: 6, fontStyle: 'italic' }}>Source: {m.source}</div>}

                  <button style={{
                    marginTop: '8px', padding: '5px 12px', backgroundColor: '#2d5016', border: '1px solid #7fff00',
                    color: '#7fff00', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
                  }} onClick={(e) => { e.stopPropagation(); addToEncounter(m); }}>
                    + Add to Encounter
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button style={styles.pageBtn} onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            Prev
          </button>
          <span style={{ color: '#d4c5a9', fontSize: '13px' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button style={styles.pageBtn} onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
            Next
          </button>
        </div>
      )}

      {/* Encounter Builder Panel */}
      {showEncounterBuilder && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: '#1a1a2e', borderTop: '2px solid #ffd700',
          padding: '12px 16px', zIndex: 100, maxHeight: '200px', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '14px' }}>
              Encounter Builder
              {encounterXP && (
                <span style={{ marginLeft: '12px', fontSize: '12px', color: '#d4c5a9', fontWeight: 'normal' }}>
                  {encounterXP.totalXP} XP total | {encounterXP.perCharXP} per char | {encounterXP.difficulty}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{
                padding: '6px 16px', backgroundColor: '#2d5016', border: '1px solid #7fff00',
                color: '#7fff00', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
              }} onClick={launchEncounter} disabled={encounterList.length === 0 || !party?.length}>
                Launch Combat
              </button>
              <button style={{
                padding: '6px 12px', backgroundColor: '#4a1a1a', border: '1px solid #ff6b6b',
                color: '#ff6b6b', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
              }} onClick={() => { setEncounterList([]); setShowEncounterBuilder(false); }}>
                Clear
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {encounterList.map(m => (
              <div key={m.instanceId} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                backgroundColor: '#2a2a4e', border: '1px solid rgba(255,215,0,0.3)',
                borderRadius: '4px', padding: '4px 8px', fontSize: '11px',
              }}>
                <span style={{ color: '#ffd700', fontWeight: 'bold' }}>{m.name}</span>
                <span style={{ color: '#8b949e' }}>CR {m.cr}</span>
                <span style={{ color: '#ff6b6b', cursor: 'pointer', fontWeight: 'bold' }}
                  onClick={() => removeFromEncounter(m.instanceId)}>✕</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
