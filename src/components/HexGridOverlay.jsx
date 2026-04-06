import React, { useMemo } from 'react';

/**
 * HexGridOverlay — flat-top hex grid SVG overlay.
 *
 * Terrain data per hex: { terrain, terrain2?, tags?, locations[] }
 *   terrain  — primary terrain ("forest")
 *   terrain2 — optional secondary terrain for hybrid hexes ("coastal")
 *   tags     — optional Set of tags: "road", "farmland", "haunted", etc.
 *
 * Stored string format (for localStorage):
 *   "forest"                    — single terrain
 *   "forest/coastal"            — hybrid terrain
 *   "forest|road,farmland"      — terrain + tags
 *   "forest/coastal|road"       — hybrid + tags
 */

// ── Hex geometry ──

function hexCorner(cx, cy, size, i) {
  const angleDeg = 60 * i;
  const angleRad = (Math.PI / 180) * angleDeg;
  return { x: cx + size * Math.cos(angleRad), y: cy + size * Math.sin(angleRad) };
}

function hexPoints(cx, cy, size) {
  return Array.from({ length: 6 }, (_, i) => hexCorner(cx, cy, size, i))
    .map(p => `${p.x},${p.y}`).join(' ');
}

function hexCenter(col, row, size) {
  const w = size * 2;
  const h = Math.sqrt(3) * size;
  // No +size / +h/2 offset — hex (0,0) center sits at pixel origin,
  // consistent with pixelToHex which maps pixel (0,0) → hex (0,0).
  const x = col * (w * 0.75);
  const y = row * h + (col % 2 === 1 ? h / 2 : 0);
  return { x, y };
}

// ── Terrain colors ──

const TERRAIN_COLORS = {
  plains:   '#8fbc3a',
  forest:   '#2d6b1a',
  hills:    '#b8860b',
  mountain: '#808080',
  swamp:    '#556b2f',
  desert:   '#deb887',
  water:    '#1a5276',
  coastal:  '#2e86c1',
  urban:    '#c0a060',
  river:    '#2471a3',
  default:  '#888888',
};

// Terrain types available for painting (no road — that's a feature now)
const TERRAIN_TYPES = [
  'plains', 'forest', 'hills', 'mountain', 'swamp',
  'desert', 'water', 'coastal', 'river', 'urban',
];

// ── Hex tags — flexible overlays applied on top of terrain ──
// Each tag has: key (stored), label, icon, color, desc (PF1e rule note), category
const HEX_TAGS = [
  // Travel
  { key: 'road',      label: 'Road',      icon: '\u{1F6E4}\uFE0F', color: '#c0a878', cat: 'travel',  desc: 'Full speed, no getting lost' },
  { key: 'trail',     label: 'Trail',     icon: '\u{1F43E}',       color: '#8b7355', cat: 'travel',  desc: 'Half road bonus, DC 14 Survival to follow' },
  { key: 'bridge',    label: 'Bridge',    icon: '\u{1F309}',       color: '#a0522d', cat: 'travel',  desc: 'Crosses water/river without swim check' },
  // Water
  { key: 'river',     label: 'River',     icon: '\u{1F30A}',       color: '#2471a3', cat: 'water',   desc: 'Crosses hex — swim/ford DC varies by depth' },
  { key: 'ford',      label: 'Ford',      icon: '\u{1FA7C}',       color: '#5dade2', cat: 'water',   desc: 'Shallow crossing, DC 10 Swim or wade' },
  // Land use
  { key: 'farmland',  label: 'Farmland',  icon: '\u{1F33E}',       color: '#d4a017', cat: 'land',    desc: 'Cultivated — plains movement, rural encounters' },
  { key: 'vineyard',  label: 'Vineyard',  icon: '\u{1F347}',       color: '#8e44ad', cat: 'land',    desc: 'Cultivated — plains movement' },
  { key: 'quarry',    label: 'Quarry',    icon: '\u26CF\uFE0F',    color: '#95a5a6', cat: 'land',    desc: 'Active or abandoned mining site' },
  { key: 'logging',   label: 'Logging',   icon: '\u{1FA93}',       color: '#6e4b1a', cat: 'land',    desc: 'Active logging — forest movement, workers present' },
  // Narrative
  { key: 'haunted',   label: 'Haunted',   icon: '\u{1F47B}',       color: '#9b59b6', cat: 'narrative', desc: 'Undead or haunt encounters likely' },
  { key: 'cursed',    label: 'Cursed',    icon: '\u{1F480}',       color: '#8b0000', cat: 'narrative', desc: 'Magical hazard — Will save or effect' },
  { key: 'sacred',    label: 'Sacred',    icon: '\u2728',          color: '#f1c40f', cat: 'narrative', desc: 'Holy ground — undead weakened, rest bonus' },
  { key: 'dangerous', label: 'Dangerous', icon: '\u26A0\uFE0F',    color: '#e74c3c', cat: 'narrative', desc: 'High CR encounters, proceed with caution' },
  { key: 'ruins',     label: 'Ruins',     icon: '\u{1F3DA}\uFE0F', color: '#b0a090', cat: 'narrative', desc: 'Explorable ruins — treasure and traps' },
  // Fortification
  { key: 'watchtower', label: 'Watchtower', icon: '\u{1F3F0}', color: '#7f8c8d', cat: 'fort', desc: 'Guarded — reduces surprise chance' },
  // Terrain modifiers
  { key: 'plateau',    label: 'Plateau',    icon: '\u{1F3D4}\uFE0F', color: '#a0926b', cat: 'terrain', desc: 'Elevated — cliffs/climbs possible, ×0.5 speed near edges' },
];

// Lookup map for tag metadata (including unknown/custom tags)
const HEX_TAG_MAP = Object.fromEntries(HEX_TAGS.map(t => [t.key, t]));
const DEFAULT_TAG = { icon: '\u{1F3F7}\uFE0F', color: '#aaa', cat: 'custom', desc: '' };
function getTagInfo(key) { return HEX_TAG_MAP[key] || { ...DEFAULT_TAG, key, label: key }; }

// Tag categories for UI grouping
const TAG_CATEGORIES = [
  { key: 'travel',    label: 'Travel' },
  { key: 'water',     label: 'Water' },
  { key: 'land',      label: 'Land Use' },
  { key: 'terrain',   label: 'Terrain' },
  { key: 'narrative', label: 'Narrative' },
  { key: 'fort',      label: 'Fortification' },
];


// ── Parsing ──

/** Parse stored hex value string → { terrain, terrain2, tags } */
function parseHexValue(str) {
  if (!str) return { terrain: null, terrain2: null, tags: new Set() };
  let terrainPart = str;
  let tagsPart = '';
  if (str.includes('|')) {
    [terrainPart, tagsPart] = str.split('|');
  }
  let terrain = terrainPart;
  let terrain2 = null;
  if (terrainPart.includes('/')) {
    [terrain, terrain2] = terrainPart.split('/');
  }
  const tags = new Set(tagsPart ? tagsPart.split(',').filter(Boolean) : []);
  return { terrain, terrain2, tags };
}

/** Encode hex data back to stored string */
function encodeHexValue(terrain, terrain2, tags) {
  let s = terrain || '';
  if (terrain2 && terrain2 !== terrain) s += `/${terrain2}`;
  const tagArr = tags instanceof Set ? [...tags] : (tags || []);
  if (tagArr.length > 0) s += `|${tagArr.join(',')}`;
  return s;
}

function stripePatternId(t1, t2) {
  return `stripe_${t1}_${t2}`;
}

// ── Tag rendering helpers ──

// Tags with custom SVG rendering (roads, rivers, etc.)
const TAG_RENDERERS = {
  road: (hex, s) => (
    <line key="road"
      x1={hex.cx - s * 0.7} y1={hex.cy}
      x2={hex.cx + s * 0.7} y2={hex.cy}
      stroke="#c0a878" strokeWidth={Math.max(2, s * 0.06)}
      strokeDasharray={`${s * 0.1} ${s * 0.05}`}
      strokeLinecap="round" strokeOpacity={0.85}
      style={{ pointerEvents: 'none' }}
    />
  ),
  trail: (hex, s) => (
    <line key="trail"
      x1={hex.cx - s * 0.6} y1={hex.cy + s * 0.15}
      x2={hex.cx + s * 0.6} y2={hex.cy + s * 0.15}
      stroke="#8b7355" strokeWidth={Math.max(1.5, s * 0.04)}
      strokeDasharray={`${s * 0.04} ${s * 0.06}`}
      strokeLinecap="round" strokeOpacity={0.8}
      style={{ pointerEvents: 'none' }}
    />
  ),
  river: (hex, s) => {
    const amp = s * 0.08;
    const steps = 6;
    let d = `M ${hex.cx - s * 0.6} ${hex.cy - s * 0.3}`;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const x = hex.cx - s * 0.6 + t * s * 1.2;
      const y = hex.cy - s * 0.3 + t * s * 0.6 + Math.sin(t * Math.PI * 3) * amp;
      d += ` L ${x} ${y}`;
    }
    return (
      <path key="river" d={d}
        fill="none" stroke="#2471a3"
        strokeWidth={Math.max(2, s * 0.05)}
        strokeLinecap="round" strokeOpacity={0.85}
        style={{ pointerEvents: 'none' }}
      />
    );
  },
  bridge: (hex, s) => {
    const bx = hex.cx + s * 0.35;
    const by = hex.cy - s * 0.25;
    const bw = s * 0.25;
    return (
      <g key="bridge" style={{ pointerEvents: 'none' }}>
        <line x1={bx - bw} y1={by - bw * 0.3} x2={bx + bw} y2={by - bw * 0.3}
          stroke="#a0522d" strokeWidth={Math.max(1.5, s * 0.03)} strokeOpacity={0.9} />
        <line x1={bx - bw} y1={by + bw * 0.3} x2={bx + bw} y2={by + bw * 0.3}
          stroke="#a0522d" strokeWidth={Math.max(1.5, s * 0.03)} strokeOpacity={0.9} />
        {[-0.6, -0.2, 0.2, 0.6].map(f => (
          <line key={f} x1={bx + bw * f} y1={by - bw * 0.3} x2={bx + bw * f} y2={by + bw * 0.3}
            stroke="#a0522d" strokeWidth={Math.max(1, s * 0.02)} strokeOpacity={0.7} />
        ))}
      </g>
    );
  },
};

/** Render tag indicators on a hex — custom SVG for known tags, icon badge for others */
function tagIndicators(hex, hexSizePx) {
  const tags = hex.tags;
  if (!tags || tags.size === 0) return null;
  const indicators = [];
  const s = hexSizePx;
  const iconSize = Math.max(7, s * 0.15);
  let badgeIdx = 0;

  for (const tag of tags) {
    // Custom SVG renderer?
    if (TAG_RENDERERS[tag]) {
      indicators.push(TAG_RENDERERS[tag](hex, s));
    } else {
      // Generic icon badge — position in a row along the bottom of the hex
      const info = getTagInfo(tag);
      const bx = hex.cx + (badgeIdx - 1) * iconSize * 1.4;
      const by = hex.cy + s * 0.55;
      indicators.push(
        <text key={tag} x={bx} y={by}
          textAnchor="middle" fontSize={iconSize}
          fillOpacity={0.85}
          style={{ pointerEvents: 'none' }}
        >{info.icon}</text>
      );
      badgeIdx++;
    }
  }

  return indicators.length > 0 ? <>{indicators}</> : null;
}


// ── Adjacency helper for fog of war ──

function getAdjacentHexKeys(col, row) {
  const evenOffsets = [[1,0],[-1,0],[0,-1],[0,1],[1,-1],[1,1]];
  const oddOffsets = [[1,0],[-1,0],[0,-1],[0,1],[-1,-1],[-1,1]];
  const offsets = col % 2 === 0 ? evenOffsets : oddOffsets;
  return offsets.map(([dc, dr]) => `${col+dc},${row+dr}`);
}

export default function HexGridOverlay({
  imgW, imgH,
  hexSizeMiles = 12, mapWidthMiles = 50,
  visible = true, terrainData = null,
  highlightedHex = null, routeHexes = [],
  onHexClick, opacity = 0.45,
  partyHex = null,
  exploredHexes = null,
  showFogOfWar = false,
  exploringHex = null,
}) {
  const hexSizePx = useMemo(() => {
    return (hexSizeMiles / mapWidthMiles) * imgW;
  }, [hexSizeMiles, mapWidthMiles, imgW]);

  // Generate grid cells
  const hexes = useMemo(() => {
    if (!imgW || !imgH || !hexSizePx) return [];
    const w = hexSizePx * 2;
    const h = Math.sqrt(3) * hexSizePx;
    const cols = Math.ceil(imgW / (w * 0.75)) + 2;
    const rows = Math.ceil(imgH / h) + 2;
    const cells = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const center = hexCenter(c, r, hexSizePx);
        if (center.x > -hexSizePx * 1.5 && center.x < imgW + hexSizePx * 1.5 &&
            center.y > -hexSizePx * 1.5 && center.y < imgH + hexSizePx * 1.5) {
          const key = `${c},${r}`;
          const td = terrainData?.get?.(key);
          let terrain = td?.terrain || null;
          let terrain2 = td?.terrain2 || null;
          let tags = td?.tags || new Set();
          // Also parse from terrain string if needed
          if (terrain && !terrain2 && typeof terrain === 'string' && (terrain.includes('/') || terrain.includes('|'))) {
            const parsed = parseHexValue(terrain);
            terrain = parsed.terrain;
            terrain2 = parsed.terrain2;
            tags = parsed.tags;
          }
          // Ensure tags is a Set
          if (!(tags instanceof Set)) tags = new Set(tags);
          cells.push({
            col: c, row: r, cx: center.x, cy: center.y,
            terrain, terrain2, tags,
            label: td?.label,
            locations: td?.locations || [],
            key,
          });
        }
      }
    }
    return cells;
  }, [imgW, imgH, hexSizePx, terrainData]);

  // Collect unique hybrid terrain pairs for stripe pattern defs
  const hybridPairs = useMemo(() => {
    const pairs = new Map();
    for (const hex of hexes) {
      if (hex.terrain && hex.terrain2 && hex.terrain !== hex.terrain2) {
        const id = stripePatternId(hex.terrain, hex.terrain2);
        if (!pairs.has(id)) pairs.set(id, { t1: hex.terrain, t2: hex.terrain2 });
      }
    }
    return pairs;
  }, [hexes]);

  // Route path
  const routePath = useMemo(() => {
    if (!routeHexes || routeHexes.length < 2) return null;
    const points = routeHexes.map(key => {
      const [c, r] = key.split(',').map(Number);
      return hexCenter(c, r, hexSizePx);
    });
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  }, [routeHexes, hexSizePx]);
  const routeSet = useMemo(() => new Set(routeHexes), [routeHexes]);

  // Compute adjacent hex keys for fog of war
  const adjacentHexKeys = useMemo(() => {
    if (!partyHex) return new Set();
    const [pc, pr] = partyHex.split(',').map(Number);
    return new Set(getAdjacentHexKeys(pc, pr));
  }, [partyHex]);

  if (!visible || !imgW || !imgH) return null;

  const stripeW = Math.max(4, hexSizePx * 0.18);

  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox={`0 0 ${imgW} ${imgH}`}
      overflow="visible"
    >
      <defs>
        {[...hybridPairs.entries()].map(([id, { t1, t2 }]) => {
          const c1 = TERRAIN_COLORS[t1] || TERRAIN_COLORS.default;
          const c2 = TERRAIN_COLORS[t2] || TERRAIN_COLORS.default;
          return (
            <pattern key={id} id={id}
              width={stripeW * 2} height={stripeW * 2}
              patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect x="0" y="0" width={stripeW} height={stripeW * 2} fill={c1} />
              <rect x={stripeW} y="0" width={stripeW} height={stripeW * 2} fill={c2} />
            </pattern>
          );
        })}
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#ff8c00" />
        </marker>
        <style>{`
          @keyframes pulse-border {
            0% { stroke-width: 2; stroke-opacity: 0.9; }
            50% { stroke-width: 3; stroke-opacity: 1; }
            100% { stroke-width: 2; stroke-opacity: 0.9; }
          }
          @keyframes pulse-text {
            0% { fill-opacity: 0.7; }
            50% { fill-opacity: 1; }
            100% { fill-opacity: 0.7; }
          }
        `}</style>
      </defs>

      {hexes.map(hex => {
        const isHighlighted = highlightedHex === hex.key;
        const isRoute = routeSet.has(hex.key);
        const isHybrid = hex.terrain && hex.terrain2 && hex.terrain !== hex.terrain2;
        const color1 = hex.terrain ? (TERRAIN_COLORS[hex.terrain] || TERRAIN_COLORS.default) : 'transparent';
        const hasTerrain = !!hex.terrain;
        const fillOp = hasTerrain ? opacity : 0;

        const clickHandler = onHexClick ? (e) => {
          e.stopPropagation();
          onHexClick({
            col: hex.col, row: hex.row,
            xPct: (hex.cx / imgW) * 100, yPct: (hex.cy / imgH) * 100,
            terrain: hex.terrain, terrain2: hex.terrain2,
            tags: hex.tags,
            locations: hex.locations,
          });
        } : undefined;
        const pStyle = { pointerEvents: onHexClick ? 'auto' : 'none', cursor: onHexClick ? 'pointer' : 'default' };

        const strokeColor = isHighlighted ? '#ffd700' : isRoute ? '#ff8c00' : 'rgba(255,215,0,0.45)';
        const strokeW = isHighlighted ? 2.5 : isRoute ? 1.5 : 1;
        const strokeOp = isHighlighted ? 0.9 : isRoute ? 0.7 : 0.7;

        let fill, useFillOp;
        if (isHighlighted) { fill = '#ffd700'; useFillOp = 0.5; }
        else if (isRoute) { fill = '#ff8c00'; useFillOp = 0.35; }
        else if (isHybrid) { fill = `url(#${stripePatternId(hex.terrain, hex.terrain2)})`; useFillOp = opacity; }
        else { fill = color1; useFillOp = fillOp; }

        // Determine fog of war state
        const isPartyHex = partyHex === hex.key;
        const isAdjacentToParty = adjacentHexKeys.has(hex.key);
        const isExplored = exploredHexes?.has(hex.key) || false;
        const isFoggedOut = showFogOfWar && !isExplored && !isPartyHex && !isAdjacentToParty;
        const isDimmed = showFogOfWar && !isExplored && isAdjacentToParty && !isPartyHex;
        const isExploring = exploringHex === hex.key;

        return (
          <g key={hex.key}>
            <polygon
              points={hexPoints(hex.cx, hex.cy, hexSizePx)}
              fill={fill} fillOpacity={useFillOp}
              stroke={strokeColor} strokeWidth={strokeW} strokeOpacity={strokeOp}
              style={pStyle} onClick={clickHandler}
            />

            {/* Tag overlays (road, trail, river, farmland, etc.) */}
            {tagIndicators(hex, hexSizePx)}

            {/* Fog of war overlay for unexplored hexes */}
            {isFoggedOut && (
              <polygon
                points={hexPoints(hex.cx, hex.cy, hexSizePx)}
                fill="black" fillOpacity={0.6}
                stroke="none" pointerEvents="none"
              />
            )}

            {/* Dimmed overlay for adjacent unexplored hexes */}
            {isDimmed && (
              <polygon
                points={hexPoints(hex.cx, hex.cy, hexSizePx)}
                fill="black" fillOpacity={0.3}
                stroke="none" pointerEvents="none"
              />
            )}

            {/* Exploring hex indicator */}
            {isExploring && (
              <g pointerEvents="none">
                <polygon
                  points={hexPoints(hex.cx, hex.cy, hexSizePx)}
                  fill="none" stroke="#ffd700" strokeWidth={2.5} strokeOpacity={0.9}
                  style={{ animation: 'pulse-border 1.5s ease-in-out infinite' }}
                />
                <text x={hex.cx} y={hex.cy + hexSizePx * 0.15}
                  textAnchor="middle" fontSize={hexSizePx * 0.4}
                  fill="#ffd700" fillOpacity={0.8}
                  style={{ animation: 'pulse-text 1.5s ease-in-out infinite', pointerEvents: 'none' }}
                >
                  🔍
                </text>
              </g>
            )}
          </g>
        );
      })}

      {routePath && (
        <path d={routePath} fill="none" stroke="#ff8c00" strokeWidth={3}
          strokeOpacity={0.8} strokeDasharray="8 4" strokeLinecap="round"
          strokeLinejoin="round" markerEnd="url(#arrowhead)" />
      )}

      {/* Party position marker */}
      {partyHex && (() => {
        const [pc, pr] = partyHex.split(',').map(Number);
        const center = hexCenter(pc, pr, hexSizePx);
        return (
          <g pointerEvents="none">
            {/* Pulsing gold circle */}
            <circle cx={center.x} cy={center.y} r={hexSizePx * 0.28}
              fill="#ffd700" fillOpacity={0.8} stroke="#b8860b" strokeWidth={2}
            >
              <animate attributeName="r"
                values={`${hexSizePx*0.28};${hexSizePx*0.33};${hexSizePx*0.28}`}
                dur="2s" repeatCount="indefinite"
              />
              <animate attributeName="fillOpacity"
                values="0.8;0.95;0.8"
                dur="2s" repeatCount="indefinite"
              />
            </circle>
            {/* Shield/sword icon in center */}
            <text x={center.x} y={center.y + hexSizePx * 0.12}
              textAnchor="middle" fontSize={hexSizePx * 0.35}
              fill="#1a1a2e" fillOpacity={0.95}
            >
              ⚔
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── Exports ──

export function pixelToHex(px, py, hexSizePx) {
  const q = (2/3 * px) / hexSizePx;
  const r = (-1/3 * px + Math.sqrt(3)/3 * py) / hexSizePx;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  const col = rq;
  const row = rr + Math.floor((rq + (rq & 1)) / 2);
  return { col, row, key: `${col},${row}` };
}

export function hexToPercent(col, row, hexSizePx, imgW, imgH) {
  const center = hexCenter(col, row, hexSizePx);
  return { xPct: (center.x / imgW) * 100, yPct: (center.y / imgH) * 100 };
}

export { hexCenter, TERRAIN_COLORS, TERRAIN_TYPES, HEX_TAGS, TAG_CATEGORIES, getTagInfo, parseHexValue, encodeHexValue, getAdjacentHexKeys };
