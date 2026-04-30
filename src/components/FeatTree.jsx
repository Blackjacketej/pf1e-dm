import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import featsData from '../data/feats.json';
import { parseAllFeats } from '../utils/featPrereqs';

// ── Theme consistent with GMReferenceTab ──
const THEME = {
  bg: '#0d1117',
  panel: '#16213e',
  gold: '#ffd700',
  text: '#d4c5a9',
  muted: '#8b949e',
  border: '#30363d',
  success: '#4CAF50',
  danger: '#f44336',
  link: '#58a6ff',
};

// ── Feat type colors ──
const TYPE_COLORS = {
  Combat: '#8b4513',
  General: '#2a4a3a',
  Critical: '#6a1a1a',
  Metamagic: '#3a2a6a',
  'Item Creation': '#2a5a3a',
  Teamwork: '#4a3a1a',
  Achievement: '#5a3a2a',
  Story: '#3a4a5a',
  Style: '#5a2a4a',
  default: '#2a2a4e',
};

// ── Build feat graph from prerequisite parsing ──
function buildFeatGraph(feats) {
  const parsedMap = parseAllFeats(feats);
  const featMap = new Map(); // name (lowercase) -> feat object
  const children = new Map(); // parent name (lowercase) -> Set of child names (lowercase)
  const parents = new Map(); // child name (lowercase) -> Set of parent names (lowercase)

  feats.forEach(f => {
    const key = f.name.toLowerCase();
    featMap.set(key, f);
    if (!children.has(key)) children.set(key, new Set());
    if (!parents.has(key)) parents.set(key, new Set());
  });

  // Parse prerequisites and build edges
  feats.forEach(f => {
    const key = f.name.toLowerCase();
    const parsed = parsedMap.get(f.name);
    if (!parsed) return;

    // Connect feat prerequisites as parent -> child edges
    for (const prereqFeatName of parsed.feats) {
      const parentKey = prereqFeatName.toLowerCase();
      if (featMap.has(parentKey) && parentKey !== key) {
        if (!children.has(parentKey)) children.set(parentKey, new Set());
        children.get(parentKey).add(key);
        parents.get(key).add(parentKey);
      }
    }
  });

  return { featMap, children, parents };
}

// ── Identify feat chains (connected components of feats with prerequisites) ──
function identifyChains(featMap, children, parents) {
  const visited = new Set();
  const chains = []; // Each chain: { roots: [], members: Set, name: string }

  // Find all roots (feats that are parents but have no feat parents themselves, or
  // feats with children where they form the top of a chain)
  const rootCandidates = [];
  for (const [key] of featMap) {
    const parentSet = parents.get(key) || new Set();
    const childSet = children.get(key) || new Set();
    if (parentSet.size === 0 && childSet.size > 0) {
      rootCandidates.push(key);
    }
  }

  // BFS from each root to find chain members
  for (const root of rootCandidates) {
    if (visited.has(root)) continue;

    const members = new Set();
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (members.has(current)) continue;
      members.add(current);
      visited.add(current);

      const childSet = children.get(current) || new Set();
      for (const child of childSet) {
        if (!members.has(child)) queue.push(child);
      }
    }

    if (members.size > 1) {
      const feat = featMap.get(root);
      chains.push({
        roots: [root],
        members,
        name: feat?.name || root,
        size: members.size,
      });
    }
  }

  // Sort chains: largest first, then alphabetically
  chains.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

  return chains;
}

// ── Group chains by type/family ──
const CHAIN_FAMILIES = {
  'Combat Maneuvers': ['improved bull rush', 'improved disarm', 'improved grapple', 'improved overrun', 'improved sunder', 'improved trip', 'improved feint', 'improved dirty trick', 'improved drag', 'improved reposition', 'improved steal'],
  'Two-Weapon Fighting': ['two-weapon fighting'],
  'Power Attack': ['power attack'],
  'Point-Blank Shot': ['point-blank shot'],
  'Weapon Focus': ['weapon focus'],
  'Dodge': ['dodge'],
  'Combat Expertise': ['combat expertise'],
  'Vital Strike': ['vital strike'],
  'Spell Focus': ['spell focus'],
  'Channel Energy': ['channel smite', 'improved channel', 'selective channeling', 'extra channel'],
  'Mounted Combat': ['mounted combat'],
  'Critical Focus': ['critical focus'],
  'Natural Spell': ['natural spell'],
};

// ── Tree Node Component ──
function TreeNode({ featKey, featMap, children: childrenMap, depth, expanded, toggleExpand, highlightedFeat, onFeatClick, maxDepth = 8 }) {
  const feat = featMap.get(featKey);
  if (!feat || depth > maxDepth) return null;

  const childSet = childrenMap.get(featKey) || new Set();
  const hasChildren = childSet.size > 0;
  const isExpanded = expanded.has(featKey);
  const isHighlighted = highlightedFeat === featKey;
  const typeColor = TYPE_COLORS[feat.type] || TYPE_COLORS.default;

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          padding: '5px 8px',
          marginBottom: 2,
          borderRadius: 4,
          background: isHighlighted ? 'rgba(255,215,0,0.15)' : depth === 0 ? 'rgba(255,215,0,0.06)' : 'transparent',
          border: isHighlighted ? `1px solid ${THEME.gold}` : '1px solid transparent',
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onClick={() => onFeatClick(featKey)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,215,0,0.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = isHighlighted ? 'rgba(255,215,0,0.15)' : depth === 0 ? 'rgba(255,215,0,0.06)' : 'transparent'; }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); toggleExpand(featKey); }}
            style={{
              width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: THEME.gold, flexShrink: 0, marginTop: 1,
              background: 'rgba(255,215,0,0.1)', borderRadius: 3,
            }}
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span style={{ width: 18, flexShrink: 0 }} />
        )}

        {/* Connector line for non-root nodes */}
        {depth > 0 && (
          <span style={{ color: THEME.border, fontSize: 12, flexShrink: 0, marginTop: 2 }}>
            {hasChildren ? '\u251C' : '\u2514'}\u2500
          </span>
        )}

        {/* Feat info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              color: depth === 0 ? THEME.gold : THEME.text,
              fontWeight: depth === 0 ? 700 : hasChildren ? 600 : 400,
              fontSize: depth === 0 ? 14 : 13,
            }}>
              {feat.name}
            </span>
            {feat.type && (
              <span style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 9,
                background: typeColor, color: '#e0d6c8',
              }}>
                {feat.type}
              </span>
            )}
            {hasChildren && (
              <span style={{ fontSize: 9, color: THEME.muted }}>
                ({childSet.size} {childSet.size === 1 ? 'child' : 'children'})
              </span>
            )}
          </div>

          {/* Show prerequisites for non-root feats */}
          {depth > 0 && feat.prerequisites && feat.prerequisites !== 'None' && (
            <div style={{ fontSize: 10, color: THEME.muted, marginTop: 2, lineHeight: 1.3 }}>
              {feat.prerequisites}
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div style={{ borderLeft: `1px dashed ${THEME.border}`, marginLeft: 9, paddingLeft: 0 }}>
          {[...childSet]
            .sort((a, b) => {
              const fa = featMap.get(a);
              const fb = featMap.get(b);
              return (fa?.name || a).localeCompare(fb?.name || b);
            })
            .map(childKey => (
              <TreeNode
                key={childKey}
                featKey={childKey}
                featMap={featMap}
                children={childrenMap}
                depth={depth + 1}
                expanded={expanded}
                toggleExpand={toggleExpand}
                highlightedFeat={highlightedFeat}
                onFeatClick={onFeatClick}
                maxDepth={maxDepth}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── Feat Detail Panel ──
function FeatDetailPanel({ featKey, featMap, parents, children: childrenMap, onClose, onNavigate }) {
  const feat = featMap.get(featKey);
  if (!feat) return null;

  const parentSet = parents.get(featKey) || new Set();
  const childSet = childrenMap.get(featKey) || new Set();
  const typeColor = TYPE_COLORS[feat.type] || TYPE_COLORS.default;

  return (
    <div style={{
      position: 'sticky', top: 0, background: THEME.panel, border: `1px solid ${THEME.gold}`,
      borderRadius: 6, padding: 16, marginBottom: 16, maxHeight: '50vh', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ color: THEME.gold, fontSize: 18, fontWeight: 700 }}>{feat.name}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {feat.type && <span style={{ ...typeTag(typeColor) }}>{feat.type}</span>}
            {feat.category && <span style={{ ...typeTag('#2a4a3a') }}>{feat.category}</span>}
            {feat.source && <span style={{ ...typeTag('#3a3a2a') }}>{feat.source}</span>}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: THEME.muted, fontSize: 20,
          cursor: 'pointer', padding: '0 4px',
        }}>
          \u00D7
        </button>
      </div>

      {feat.prerequisites && feat.prerequisites !== 'None' && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', marginBottom: 3 }}>Prerequisites</div>
          <div style={{ fontSize: 12, color: THEME.text }}>{feat.prerequisites}</div>
        </div>
      )}

      {(feat.benefit || feat.description) && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', marginBottom: 3 }}>Benefit</div>
          <div style={{ fontSize: 12, color: '#b0a690', lineHeight: 1.5 }}>
            {(feat.benefit || feat.description || '').substring(0, 600)}
            {(feat.benefit || feat.description || '').length > 600 ? '...' : ''}
          </div>
        </div>
      )}

      {feat.special && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', marginBottom: 3 }}>Special</div>
          <div style={{ fontSize: 12, color: '#b0a690', lineHeight: 1.5 }}>{feat.special}</div>
        </div>
      )}

      {/* Parent feats (prerequisites) */}
      {parentSet.size > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', marginBottom: 3 }}>Requires</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[...parentSet].map(pk => {
              const pf = featMap.get(pk);
              return (
                <button
                  key={pk}
                  onClick={() => onNavigate(pk)}
                  style={{
                    background: 'rgba(255,215,0,0.1)', border: `1px solid ${THEME.gold}`,
                    color: THEME.gold, padding: '3px 8px', borderRadius: 4, fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  \u2191 {pf?.name || pk}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Child feats (unlocks) */}
      {childSet.size > 0 && (
        <div>
          <div style={{ fontSize: 10, color: THEME.muted, textTransform: 'uppercase', marginBottom: 3 }}>
            Unlocks ({childSet.size})
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[...childSet].sort().map(ck => {
              const cf = featMap.get(ck);
              return (
                <button
                  key={ck}
                  onClick={() => onNavigate(ck)}
                  style={{
                    background: 'rgba(76,175,80,0.1)', border: `1px solid ${THEME.success}`,
                    color: THEME.success, padding: '3px 8px', borderRadius: 4, fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  \u2193 {cf?.name || ck}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const typeTag = (bg) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10,
  background: bg, color: '#e0d6c8',
});

// ── Main FeatTree Component ──
export default function FeatTree() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [selectedFeat, setSelectedFeat] = useState(null);
  const [viewMode, setViewMode] = useState('chains'); // 'chains' | 'all-roots' | 'search'
  const [showOrphans, setShowOrphans] = useState(false);
  const treeRef = useRef(null);

  // Build the graph once
  const { featMap, children, parents, chains, stats } = useMemo(() => {
    const feats = Array.isArray(featsData) ? featsData : Object.values(featsData).flat();
    const { featMap, children, parents } = buildFeatGraph(feats);
    const chains = identifyChains(featMap, children, parents);

    // Stats
    let inChain = 0;
    let totalEdges = 0;
    for (const [, childSet] of children) {
      totalEdges += childSet.size;
      if (childSet.size > 0) inChain++;
    }
    // Count feats that are children too
    for (const [, parentSet] of parents) {
      if (parentSet.size > 0) inChain++;
    }
    const uniqueInChains = new Set();
    chains.forEach(c => c.members.forEach(m => uniqueInChains.add(m)));

    return {
      featMap, children, parents, chains,
      stats: {
        total: featMap.size,
        chains: chains.length,
        inChains: uniqueInChains.size,
        orphans: featMap.size - uniqueInChains.size,
        edges: totalEdges,
      },
    };
  }, []);

  const toggleExpand = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set();
    for (const [key, childSet] of children) {
      if (childSet.size > 0) all.add(key);
    }
    setExpanded(all);
  }, [children]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  const handleFeatClick = useCallback((key) => {
    setSelectedFeat(prev => prev === key ? null : key);
  }, []);

  const navigateToFeat = useCallback((key) => {
    setSelectedFeat(key);
    // Auto-expand parents so the feat is visible
    const parentsToExpand = new Set();
    let current = key;
    const parentSet = parents.get(current);
    if (parentSet) {
      for (const p of parentSet) {
        parentsToExpand.add(p);
        // Go up further
        const grandParents = parents.get(p);
        if (grandParents) grandParents.forEach(gp => parentsToExpand.add(gp));
      }
    }
    if (parentsToExpand.size > 0) {
      setExpanded(prev => {
        const next = new Set(prev);
        parentsToExpand.forEach(p => next.add(p));
        return next;
      });
    }
  }, [parents]);

  // Search results
  const searchResults = useMemo(() => {
    if (!search || search.length < 2) return [];
    const term = search.toLowerCase();
    const results = [];
    for (const [key, feat] of featMap) {
      if (feat.name.toLowerCase().includes(term) ||
          (feat.prerequisites || '').toLowerCase().includes(term) ||
          (feat.benefit || '').toLowerCase().includes(term)) {
        const parentSet = parents.get(key) || new Set();
        const childSet = children.get(key) || new Set();
        results.push({ key, feat, parents: parentSet.size, children: childSet.size });
      }
    }
    return results.sort((a, b) => {
      // Prioritize exact name matches
      const aExact = a.feat.name.toLowerCase() === term ? 1 : 0;
      const bExact = b.feat.name.toLowerCase() === term ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      // Then by most connected
      return (b.parents + b.children) - (a.parents + a.children);
    }).slice(0, 50);
  }, [search, featMap, parents, children]);

  // Get root feats for each chain
  const chainRoots = useMemo(() => {
    return chains.map(chain => {
      const roots = [...chain.members].filter(m => {
        const p = parents.get(m) || new Set();
        // A root within this chain = no parents that are also in this chain
        return [...p].every(parent => !chain.members.has(parent));
      });
      return { ...chain, roots };
    });
  }, [chains, parents]);

  // Orphan feats (no connections)
  const orphanFeats = useMemo(() => {
    const inChains = new Set();
    chains.forEach(c => c.members.forEach(m => inChains.add(m)));
    return [...featMap.entries()]
      .filter(([key]) => !inChains.has(key))
      .map(([key, feat]) => ({ key, feat }))
      .sort((a, b) => a.feat.name.localeCompare(b.feat.name));
  }, [featMap, chains]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header with stats */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 0', marginBottom: 8, borderBottom: `1px solid ${THEME.border}`,
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: THEME.gold, fontWeight: 700, fontSize: 16 }}>Feat Trees</span>
          <span style={{ fontSize: 11, color: THEME.muted }}>
            {stats.total} feats \u00B7 {stats.chains} chains \u00B7 {stats.inChains} connected \u00B7 {stats.edges} prerequisite links
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={expandAll} style={toolBtn}>Expand All</button>
          <button onClick={collapseAll} style={toolBtn}>Collapse All</button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search feats by name, prerequisite, or benefit..."
          value={search}
          onChange={e => { setSearch(e.target.value); if (e.target.value.length >= 2) setViewMode('search'); else setViewMode('chains'); }}
          style={{
            flex: 1, minWidth: 250, padding: '8px 12px', background: THEME.bg,
            border: `1px solid ${THEME.border}`, borderRadius: 4, color: THEME.text, fontSize: 13,
          }}
        />
        <label style={{ fontSize: 11, color: THEME.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} />
          Show standalone feats ({stats.orphans})
        </label>
      </div>

      {/* Content area */}
      <div ref={treeRef} style={{ flex: 1, overflowY: 'auto' }}>
        {/* Detail panel */}
        {selectedFeat && (
          <FeatDetailPanel
            featKey={selectedFeat}
            featMap={featMap}
            parents={parents}
            children={children}
            onClose={() => setSelectedFeat(null)}
            onNavigate={navigateToFeat}
          />
        )}

        {/* Search results mode */}
        {viewMode === 'search' && search.length >= 2 && (
          <div>
            <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 8 }}>
              {searchResults.length} results for "{search}"
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
              {searchResults.map(({ key, feat, parents: pCount, children: cCount }) => (
                <div
                  key={key}
                  onClick={() => { handleFeatClick(key); navigateToFeat(key); setViewMode('chains'); }}
                  style={{
                    background: THEME.panel, border: `1px solid ${THEME.border}`, borderRadius: 4,
                    padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                  }}
                >
                  <div style={{ color: THEME.gold, fontWeight: 600, marginBottom: 2 }}>{feat.name}</div>
                  <div style={{ color: THEME.muted, fontSize: 10 }}>
                    {pCount > 0 && <span>{pCount} prerequisite{pCount > 1 ? 's' : ''}</span>}
                    {pCount > 0 && cCount > 0 && <span> \u00B7 </span>}
                    {cCount > 0 && <span>unlocks {cCount}</span>}
                    {pCount === 0 && cCount === 0 && <span>Standalone feat</span>}
                  </div>
                  {feat.prerequisites && feat.prerequisites !== 'None' && (
                    <div style={{ fontSize: 10, color: '#b0a690', marginTop: 3 }}>
                      Prereq: {feat.prerequisites.substring(0, 120)}{feat.prerequisites.length > 120 ? '...' : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chain tree view */}
        {(viewMode === 'chains' || (viewMode === 'search' && search.length < 2)) && (
          <div>
            {chainRoots.map((chain, ci) => (
              <div key={ci} style={{
                marginBottom: 16, background: 'rgba(22,33,62,0.5)', border: `1px solid ${THEME.border}`,
                borderRadius: 6, padding: 12,
              }}>
                {/* Chain header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 8, cursor: 'pointer',
                  }}
                  onClick={() => {
                    // Toggle expand all roots in this chain
                    const allExpanded = chain.roots.every(r => expanded.has(r));
                    setExpanded(prev => {
                      const next = new Set(prev);
                      chain.roots.forEach(r => {
                        if (allExpanded) next.delete(r);
                        else next.add(r);
                      });
                      return next;
                    });
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: THEME.gold, fontWeight: 700, fontSize: 14 }}>
                      {chain.name} Tree
                    </span>
                    <span style={{
                      background: 'rgba(255,215,0,0.15)', color: THEME.gold, padding: '2px 8px',
                      borderRadius: 10, fontSize: 10,
                    }}>
                      {chain.members.size} feats
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: THEME.muted }}>
                    {chain.roots.every(r => expanded.has(r)) ? 'Click to collapse' : 'Click to expand'}
                  </span>
                </div>

                {/* Tree nodes */}
                {chain.roots.map(rootKey => (
                  <TreeNode
                    key={rootKey}
                    featKey={rootKey}
                    featMap={featMap}
                    children={children}
                    depth={0}
                    expanded={expanded}
                    toggleExpand={toggleExpand}
                    highlightedFeat={selectedFeat}
                    onFeatClick={handleFeatClick}
                  />
                ))}
              </div>
            ))}

            {/* Standalone feats */}
            {showOrphans && (
              <div style={{
                marginTop: 20, background: 'rgba(22,33,62,0.3)', border: `1px solid ${THEME.border}`,
                borderRadius: 6, padding: 12,
              }}>
                <div style={{ color: THEME.muted, fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                  Standalone Feats ({orphanFeats.length})
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                  gap: 4, maxHeight: 400, overflowY: 'auto',
                }}>
                  {orphanFeats.map(({ key, feat }) => (
                    <div
                      key={key}
                      onClick={() => handleFeatClick(key)}
                      style={{
                        padding: '4px 8px', fontSize: 12, color: selectedFeat === key ? THEME.gold : THEME.text,
                        cursor: 'pointer', borderRadius: 3,
                        background: selectedFeat === key ? 'rgba(255,215,0,0.1)' : 'transparent',
                      }}
                    >
                      {feat.name}
                      {feat.type && <span style={{ fontSize: 9, color: THEME.muted, marginLeft: 6 }}>{feat.type}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const toolBtn = {
  background: 'rgba(255,215,0,0.1)', border: `1px solid ${THEME.border}`, color: THEME.text,
  padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
};
