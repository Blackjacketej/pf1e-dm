/**
 * MapAssets.jsx — SVG terrain hex tiles, compass rose, atmospheric UI elements,
 * and procedural settlement/dungeon map generators for the Pathfinder DM app.
 *
 * All assets are pure SVG React components with no external dependencies.
 */
import React, { useMemo } from 'react';

// ════════════════════════════════════════════════════════════════════════════
// TERRAIN HEX TILES — Pointy-top hexagons with detailed terrain fill patterns
// ════════════════════════════════════════════════════════════════════════════

const HEX_SIZE = 40;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = 2 * HEX_SIZE;

function hexPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

// Seeded pseudo-random for deterministic placement
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

/** Individual terrain features drawn inside a hex */
function TerrainDetails({ terrain, cx, cy, seed }) {
  const rand = seededRand(seed);
  const r = () => rand();

  switch (terrain) {
    case 'forest': {
      const trees = Array.from({ length: 6 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.2,
        y: cy + (r() - 0.5) * HEX_SIZE * 1.0,
        s: 4 + r() * 5,
      }));
      return <g>
        {trees.map((t, i) => <g key={i}>
          <polygon points={`${t.x},${t.y - t.s * 2.2} ${t.x - t.s},${t.y} ${t.x + t.s},${t.y}`}
            fill={r() > 0.5 ? '#1a5c1a' : '#0d4a0d'} opacity={0.85} />
          <rect x={t.x - 1} y={t.y} width={2} height={t.s * 0.6} fill="#4a3520" opacity={0.7} />
        </g>)}
      </g>;
    }
    case 'hills': {
      const mounds = Array.from({ length: 3 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.1,
        y: cy + (r() - 0.3) * HEX_SIZE * 0.8,
        w: 12 + r() * 14,
        h: 6 + r() * 8,
      }));
      return <g>
        {mounds.map((m, i) => <ellipse key={i} cx={m.x} cy={m.y} rx={m.w} ry={m.h}
          fill={i === 0 ? '#5a6b3a' : '#4a5a2a'} opacity={0.7} />)}
        {mounds.map((m, i) => <ellipse key={`t${i}`} cx={m.x} cy={m.y - m.h * 0.3} rx={m.w * 0.7} ry={m.h * 0.5}
          fill="#6a7b4a" opacity={0.4} />)}
      </g>;
    }
    case 'mountains': {
      const peaks = Array.from({ length: 3 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.0,
        y: cy + (r() - 0.3) * HEX_SIZE * 0.7,
        w: 8 + r() * 10,
        h: 14 + r() * 12,
      }));
      return <g>
        {peaks.map((p, i) => <g key={i}>
          <polygon points={`${p.x},${p.y - p.h} ${p.x - p.w},${p.y + 4} ${p.x + p.w},${p.y + 4}`}
            fill={i === 0 ? '#6a6a7a' : '#5a5a6a'} opacity={0.85} />
          <polygon points={`${p.x},${p.y - p.h} ${p.x - p.w * 0.3},${p.y - p.h * 0.5} ${p.x + p.w * 0.35},${p.y - p.h * 0.45}`}
            fill="#e0e8f0" opacity={0.7} />
        </g>)}
      </g>;
    }
    case 'desert': {
      const dunes = Array.from({ length: 4 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.2,
        y: cy + (r() - 0.5) * HEX_SIZE * 0.8,
        w: 10 + r() * 14,
      }));
      return <g>
        {dunes.map((d, i) => <path key={i}
          d={`M${d.x - d.w},${d.y + 3} Q${d.x},${d.y - 6} ${d.x + d.w},${d.y + 3}`}
          fill="none" stroke="#c4a050" strokeWidth={1.5} opacity={0.6} />)}
        {r() > 0.5 && <circle cx={cx + 8} cy={cy - 10} r={2} fill="#d4a520" opacity={0.4} />}
      </g>;
    }
    case 'swamp': {
      const pools = Array.from({ length: 3 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.0,
        y: cy + (r() - 0.5) * HEX_SIZE * 0.8,
        rx: 5 + r() * 8, ry: 3 + r() * 5,
      }));
      const reeds = Array.from({ length: 5 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.0,
        y: cy + (r() - 0.5) * HEX_SIZE * 0.9,
      }));
      return <g>
        {pools.map((p, i) => <ellipse key={i} cx={p.x} cy={p.y} rx={p.rx} ry={p.ry}
          fill="#2a4a4a" opacity={0.6} />)}
        {reeds.map((re, i) => <line key={`r${i}`} x1={re.x} y1={re.y} x2={re.x + (r() - 0.5) * 4} y2={re.y - 6 - r() * 6}
          stroke="#3a5a2a" strokeWidth={1} opacity={0.7} />)}
      </g>;
    }
    case 'water': {
      const waves = Array.from({ length: 4 }, (_, i) => ({
        y: cy - HEX_SIZE * 0.4 + i * HEX_SIZE * 0.25,
      }));
      return <g>
        {waves.map((w, i) => <path key={i}
          d={`M${cx - HEX_SIZE * 0.6},${w.y} Q${cx - HEX_SIZE * 0.2},${w.y - 3} ${cx},${w.y} Q${cx + HEX_SIZE * 0.2},${w.y + 3} ${cx + HEX_SIZE * 0.6},${w.y}`}
          fill="none" stroke="#4a7aaa" strokeWidth={1} opacity={0.4 + i * 0.1} />)}
      </g>;
    }
    case 'plains': {
      const grass = Array.from({ length: 8 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 1.2,
        y: cy + (r() - 0.5) * HEX_SIZE * 0.9,
      }));
      return <g>
        {grass.map((g2, i) => <path key={i}
          d={`M${g2.x},${g2.y} Q${g2.x + (r() - 0.5) * 4},${g2.y - 4 - r() * 4} ${g2.x + (r() - 0.5) * 2},${g2.y - 6 - r() * 5}`}
          fill="none" stroke="#5a7a3a" strokeWidth={0.8} opacity={0.5} />)}
      </g>;
    }
    case 'urban': {
      const bldgs = Array.from({ length: 4 }, () => ({
        x: cx + (r() - 0.5) * HEX_SIZE * 0.9,
        y: cy + (r() - 0.5) * HEX_SIZE * 0.7,
        w: 5 + r() * 8, h: 6 + r() * 10,
      }));
      return <g>
        {bldgs.map((b, i) => <g key={i}>
          <rect x={b.x - b.w / 2} y={b.y - b.h} width={b.w} height={b.h}
            fill={r() > 0.5 ? '#5a4a3a' : '#4a3a2a'} opacity={0.7} />
          <polygon points={`${b.x - b.w / 2 - 1},${b.y - b.h} ${b.x},${b.y - b.h - 4} ${b.x + b.w / 2 + 1},${b.y - b.h}`}
            fill="#6a5a4a" opacity={0.7} />
        </g>)}
      </g>;
    }
    case 'coastal': {
      return <g>
        <path d={`M${cx - HEX_SIZE * 0.6},${cy} Q${cx - HEX_SIZE * 0.2},${cy - 6} ${cx + HEX_SIZE * 0.1},${cy - 2} Q${cx + HEX_SIZE * 0.4},${cy + 4} ${cx + HEX_SIZE * 0.6},${cy}`}
          fill="none" stroke="#4a7aaa" strokeWidth={2} opacity={0.5} />
        <path d={`M${cx - HEX_SIZE * 0.5},${cy + 6} Q${cx},${cy + 2} ${cx + HEX_SIZE * 0.5},${cy + 6}`}
          fill="none" stroke="#c4a870" strokeWidth={1.5} opacity={0.4} />
      </g>;
    }
    default:
      return null;
  }
}

const TERRAIN_BASE_COLORS = {
  forest: '#1a3a1a', hills: '#3a4a2a', mountains: '#3a3a4a', desert: '#6a5a30',
  swamp: '#1a2a2a', water: '#0a1a3a', plains: '#2a3a20', urban: '#2a2a3e',
  coastal: '#1a2a3a', road: '#3a3a2a', cavern: '#1a1a2a', tundra: '#4a5a6a',
};

/** A single hex tile with terrain art */
export function TerrainHex({ terrain, col, row, size = HEX_SIZE, selected, onClick, label, partyHere }) {
  const cx = col * HEX_W + (row % 2 === 1 ? HEX_W / 2 : 0);
  const cy = row * HEX_H * 0.75;
  const seed = col * 1000 + row * 7 + (terrain?.charCodeAt(0) || 0) * 31;

  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <polygon points={hexPoints(cx, cy, size)}
        fill={TERRAIN_BASE_COLORS[terrain] || '#2a2a2a'}
        stroke={selected ? '#ffd700' : 'rgba(255,215,0,0.15)'}
        strokeWidth={selected ? 2 : 0.5}
        opacity={0.9} />
      <TerrainDetails terrain={terrain} cx={cx} cy={cy} seed={seed} />
      {label && (
        <text x={cx} y={cy + size + 10} textAnchor="middle" fill="#d4c5a9" fontSize={8}
          stroke="#0a0a1a" strokeWidth={2} paintOrder="stroke" fontFamily="serif">{label}</text>
      )}
      {partyHere && (
        <g>
          <circle cx={cx} cy={cy} r={6} fill="#ffd700" stroke="#000" strokeWidth={1.5}>
            <animate attributeName="r" from="5" to="8" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="1" to="0.5" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <text x={cx} y={cy + 3.5} textAnchor="middle" fill="#000" fontSize={8} fontWeight="bold">{'\u2694'}</text>
        </g>
      )}
    </g>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// COMPASS ROSE — Ornate SVG compass for map overlays
// ════════════════════════════════════════════════════════════════════════════

export function CompassRose({ x = 0, y = 0, size = 60 }) {
  const s = size;
  const r1 = s * 0.48; // outer point length
  const r2 = s * 0.3;  // inner point length
  const r3 = s * 0.15; // decorative ring
  const dirs = [
    { angle: -90, label: 'N', primary: true },
    { angle: 0, label: 'E', primary: true },
    { angle: 90, label: 'S', primary: true },
    { angle: 180, label: 'W', primary: true },
    { angle: -45, label: 'NE', primary: false },
    { angle: 45, label: 'SE', primary: false },
    { angle: 135, label: 'SW', primary: false },
    { angle: -135, label: 'NW', primary: false },
  ];

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Outer decorative circles */}
      <circle r={s * 0.5} fill="rgba(10,10,26,0.8)" stroke="rgba(255,215,0,0.4)" strokeWidth={1.5} />
      <circle r={s * 0.42} fill="none" stroke="rgba(255,215,0,0.2)" strokeWidth={0.5} />
      <circle r={r3} fill="none" stroke="rgba(255,215,0,0.5)" strokeWidth={1} />

      {/* Cardinal direction points (large) */}
      {dirs.filter(d => d.primary).map(d => {
        const rad = d.angle * Math.PI / 180;
        const tip = { x: Math.cos(rad) * r1, y: Math.sin(rad) * r1 };
        const left = { x: Math.cos(rad - 0.3) * r3, y: Math.sin(rad - 0.3) * r3 };
        const right = { x: Math.cos(rad + 0.3) * r3, y: Math.sin(rad + 0.3) * r3 };
        return (
          <g key={d.label}>
            <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
              fill={d.label === 'N' ? '#ffd700' : '#8a7a5a'} opacity={0.9} />
            <text x={Math.cos(rad) * (r1 + 8)} y={Math.sin(rad) * (r1 + 8) + 3}
              textAnchor="middle" fill={d.label === 'N' ? '#ffd700' : '#d4c5a9'}
              fontSize={d.label === 'N' ? 11 : 9} fontWeight="bold" fontFamily="serif">
              {d.label}
            </text>
          </g>
        );
      })}

      {/* Intercardinal direction points (smaller) */}
      {dirs.filter(d => !d.primary).map(d => {
        const rad = d.angle * Math.PI / 180;
        const tip = { x: Math.cos(rad) * r2, y: Math.sin(rad) * r2 };
        const left = { x: Math.cos(rad - 0.25) * r3 * 0.7, y: Math.sin(rad - 0.25) * r3 * 0.7 };
        const right = { x: Math.cos(rad + 0.25) * r3 * 0.7, y: Math.sin(rad + 0.25) * r3 * 0.7 };
        return (
          <polygon key={d.label}
            points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
            fill="#5a4a3a" opacity={0.7} />
        );
      })}

      {/* Center ornament */}
      <circle r={4} fill="#ffd700" opacity={0.8} />
      <circle r={2} fill="#1a1a2e" />
    </g>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// PARCHMENT FRAME — Decorative border for panels
// ════════════════════════════════════════════════════════════════════════════

export function ParchmentFrame({ width, height, children, title, style = {} }) {
  const cornerSize = 16;
  const borderColor = 'rgba(255,215,0,0.4)';
  const bgColor = 'rgba(26,26,46,0.95)';

  return (
    <div style={{
      position: 'relative',
      width, minHeight: height,
      background: bgColor,
      border: `2px solid ${borderColor}`,
      borderRadius: '4px',
      overflow: 'hidden',
      ...style,
    }}>
      {/* Corner ornaments */}
      <svg style={{ position: 'absolute', top: 0, left: 0 }} width={cornerSize * 2} height={cornerSize * 2}>
        <path d={`M0,${cornerSize} Q0,0 ${cornerSize},0`} fill="none" stroke="#ffd700" strokeWidth={2} opacity={0.6} />
        <circle cx={2} cy={2} r={2} fill="#ffd700" opacity={0.5} />
      </svg>
      <svg style={{ position: 'absolute', top: 0, right: 0 }} width={cornerSize * 2} height={cornerSize * 2}>
        <path d={`M${cornerSize},0 Q${cornerSize * 2},0 ${cornerSize * 2},${cornerSize}`} fill="none" stroke="#ffd700" strokeWidth={2} opacity={0.6} />
        <circle cx={cornerSize * 2 - 2} cy={2} r={2} fill="#ffd700" opacity={0.5} />
      </svg>
      <svg style={{ position: 'absolute', bottom: 0, left: 0 }} width={cornerSize * 2} height={cornerSize * 2}>
        <path d={`M0,${cornerSize} Q0,${cornerSize * 2} ${cornerSize},${cornerSize * 2}`} fill="none" stroke="#ffd700" strokeWidth={2} opacity={0.6} />
        <circle cx={2} cy={cornerSize * 2 - 2} r={2} fill="#ffd700" opacity={0.5} />
      </svg>
      <svg style={{ position: 'absolute', bottom: 0, right: 0 }} width={cornerSize * 2} height={cornerSize * 2}>
        <path d={`M${cornerSize},${cornerSize * 2} Q${cornerSize * 2},${cornerSize * 2} ${cornerSize * 2},${cornerSize}`} fill="none" stroke="#ffd700" strokeWidth={2} opacity={0.6} />
        <circle cx={cornerSize * 2 - 2} cy={cornerSize * 2 - 2} r={2} fill="#ffd700" opacity={0.5} />
      </svg>

      {/* Top decorative line */}
      {title && (
        <div style={{
          textAlign: 'center', padding: '8px 16px 4px',
          color: '#ffd700', fontFamily: 'serif', fontSize: '13px',
          fontWeight: 'bold', textTransform: 'uppercase',
          letterSpacing: '2px', borderBottom: '1px solid rgba(255,215,0,0.2)',
        }}>
          {title}
        </div>
      )}

      <div style={{ padding: title ? '8px 12px 12px' : '12px' }}>
        {children}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// PROCEDURAL HEX MAP — Generates a hex grid from terrain data
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_TERRAIN_MAP = [
  ['mountains','mountains','hills','forest','forest','forest','hills','mountains'],
  ['mountains','hills','hills','forest','forest','plains','hills','mountains'],
  ['hills','hills','forest','forest','plains','plains','coastal','water'],
  ['forest','forest','plains','urban','plains','plains','coastal','water'],
  ['forest','plains','plains','plains','plains','swamp','water','water'],
  ['hills','plains','plains','plains','swamp','swamp','coastal','water'],
  ['mountains','hills','forest','plains','forest','hills','hills','mountains'],
];

export function HexMap({ terrainGrid, partyCol, partyRow, selectedHex, onHexClick, width = 600, height = 400, labels }) {
  const grid = terrainGrid || DEFAULT_TERRAIN_MAP;
  const rows = grid.length;
  const cols = grid[0]?.length || 8;

  // Calculate viewBox to fit all hexes
  const totalW = cols * HEX_W + HEX_W / 2 + 20;
  const totalH = rows * HEX_H * 0.75 + HEX_H * 0.25 + 20;

  return (
    <svg width={width} height={height} viewBox={`-10 -${HEX_SIZE} ${totalW} ${totalH}`}
      style={{ background: '#0a0a1a', borderRadius: '4px', border: '1px solid rgba(255,215,0,0.2)' }}>
      <defs>
        <radialGradient id="hexMapGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#1a2a3a" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#0a0a1a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-10} y={-HEX_SIZE} width={totalW} height={totalH} fill="url(#hexMapGlow)" />

      {grid.map((rowData, row) =>
        rowData.map((terrain, col) => (
          <TerrainHex
            key={`${row}-${col}`}
            terrain={terrain}
            col={col} row={row}
            selected={selectedHex && selectedHex[0] === col && selectedHex[1] === row}
            onClick={onHexClick ? () => onHexClick(col, row, terrain) : undefined}
            label={labels?.[`${col},${row}`]}
            partyHere={partyCol === col && partyRow === row}
          />
        ))
      )}

      {/* Compass in top-right corner */}
      <CompassRose x={totalW - 50} y={10} size={36} />
    </svg>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// SETTLEMENT MAP — Procedural town/city visualization
// ════════════════════════════════════════════════════════════════════════════

const BUILDING_TYPES = {
  temple: { color: '#6a5acd', icon: '\u2720', h: 18 },
  tavern: { color: '#8b4513', icon: '\uD83C\uDF7A', h: 12 },
  shop: { color: '#daa520', icon: '\uD83D\uDECD', h: 10 },
  house: { color: '#5a4a3a', icon: '', h: 8 },
  tower: { color: '#4a4a6a', icon: '\uD83D\uDDFC', h: 22 },
  barracks: { color: '#3a3a2a', icon: '\u2694', h: 14 },
  guild: { color: '#4a3a5a', icon: '\u2699', h: 13 },
  castle: { color: '#6a6a7a', icon: '\uD83C\uDFF0', h: 24 },
  market: { color: '#8a7a3a', icon: '\u2B50', h: 6 },
  wall: { color: '#4a4a4a', icon: '', h: 0 },
};

function generateSettlementBuildings(size, seed) {
  const rand = seededRand(seed);
  const r = () => rand();
  const counts = {
    thorp: { house: 4, shop: 1 },
    hamlet: { house: 8, shop: 2, tavern: 1, temple: 1 },
    village: { house: 14, shop: 3, tavern: 2, temple: 1, guild: 1 },
    small_town: { house: 20, shop: 5, tavern: 3, temple: 2, guild: 2, barracks: 1, market: 1 },
    large_town: { house: 30, shop: 8, tavern: 4, temple: 3, guild: 3, barracks: 2, market: 2, tower: 1 },
    small_city: { house: 40, shop: 12, tavern: 6, temple: 4, guild: 4, barracks: 3, market: 3, tower: 2, castle: 1 },
    large_city: { house: 55, shop: 16, tavern: 8, temple: 5, guild: 5, barracks: 4, market: 4, tower: 3, castle: 1 },
    metropolis: { house: 70, shop: 20, tavern: 10, temple: 7, guild: 6, barracks: 5, market: 5, tower: 4, castle: 2 },
  };

  const bldgCounts = counts[size] || counts.village;
  const buildings = [];
  const radius = Object.values(bldgCounts).reduce((s, v) => s + v, 0) * 1.8;

  Object.entries(bldgCounts).forEach(([type, count]) => {
    for (let i = 0; i < count; i++) {
      const angle = r() * Math.PI * 2;
      const dist = r() * radius * (type === 'castle' ? 0.15 : type === 'temple' ? 0.4 : type === 'house' ? 0.9 : 0.5);
      buildings.push({
        type,
        x: Math.cos(angle) * dist + (r() - 0.5) * 10,
        y: Math.sin(angle) * dist + (r() - 0.5) * 10,
        w: 6 + r() * (type === 'castle' ? 14 : type === 'house' ? 4 : 8),
        h: (BUILDING_TYPES[type]?.h || 10) + r() * 4,
        rotation: (r() - 0.5) * 20,
      });
    }
  });

  return { buildings, radius };
}

export function SettlementMap({ name, size = 'village', seed = 42, width = 500, height = 400, style = {} }) {
  const { buildings, radius } = useMemo(
    () => generateSettlementBuildings(size, seed),
    [size, seed]
  );

  const viewPad = 40;
  const viewSize = radius * 2 + viewPad * 2;
  const hasWalls = ['small_city', 'large_city', 'metropolis'].includes(size);
  const wallRadius = radius * 0.85;

  return (
    <svg width={width} height={height} viewBox={`${-viewSize / 2} ${-viewSize / 2} ${viewSize} ${viewSize}`}
      style={{ background: '#0d1117', borderRadius: '4px', border: '1px solid rgba(255,215,0,0.2)', ...style }}>
      <defs>
        <radialGradient id="settlementGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2a3a20" stopOpacity="0.4" />
          <stop offset="70%" stopColor="#1a2a1a" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#0d1117" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ground */}
      <circle r={radius * 1.1} fill="url(#settlementGlow)" />

      {/* Roads (simple radial pattern) */}
      {[0, 60, 120, 200, 290].map((angle, i) => {
        const rad = angle * Math.PI / 180;
        return <line key={i} x1={0} y1={0}
          x2={Math.cos(rad) * radius * 1.1} y2={Math.sin(rad) * radius * 1.1}
          stroke="#4a3a2a" strokeWidth={3} opacity={0.4} />;
      })}

      {/* City walls */}
      {hasWalls && (
        <g>
          <circle r={wallRadius} fill="none" stroke="#5a5a5a" strokeWidth={3} opacity={0.7} />
          {[0, 90, 180, 270].map(angle => {
            const rad = angle * Math.PI / 180;
            return <rect key={angle}
              x={Math.cos(rad) * wallRadius - 5} y={Math.sin(rad) * wallRadius - 5}
              width={10} height={10} fill="#5a5a5a" stroke="#6a6a6a"
              strokeWidth={1} opacity={0.8} rx={1}
              transform={`rotate(${angle}, ${Math.cos(rad) * wallRadius}, ${Math.sin(rad) * wallRadius})`} />;
          })}
        </g>
      )}

      {/* Buildings */}
      {buildings.map((b, i) => {
        const bt = BUILDING_TYPES[b.type] || BUILDING_TYPES.house;
        return (
          <g key={i} transform={`translate(${b.x}, ${b.y}) rotate(${b.rotation})`}>
            {/* Shadow */}
            <rect x={-b.w / 2 + 2} y={-bt.h / 2 + 2} width={b.w} height={b.h}
              fill="rgba(0,0,0,0.3)" rx={1} />
            {/* Building body */}
            <rect x={-b.w / 2} y={-bt.h / 2} width={b.w} height={b.h}
              fill={bt.color} stroke="rgba(255,215,0,0.15)" strokeWidth={0.5} rx={1} opacity={0.85} />
            {/* Roof highlight */}
            <rect x={-b.w / 2} y={-bt.h / 2} width={b.w} height={2}
              fill="rgba(255,255,255,0.1)" rx={1} />
            {bt.icon && b.type !== 'house' && (
              <text x={0} y={3} textAnchor="middle" fontSize={Math.min(b.w, b.h) * 0.6} opacity={0.7}>{bt.icon}</text>
            )}
          </g>
        );
      })}

      {/* Settlement name */}
      <text x={0} y={radius + 20} textAnchor="middle" fill="#ffd700" fontSize={12}
        fontWeight="bold" fontFamily="serif" letterSpacing="1"
        stroke="#0d1117" strokeWidth={3} paintOrder="stroke">
        {name || size.replace('_', ' ').toUpperCase()}
      </text>
    </svg>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// DUNGEON MAP — Procedural dungeon floor plan
// ════════════════════════════════════════════════════════════════════════════

function generateDungeonRooms(roomCount, seed) {
  const rand = seededRand(seed);
  const r = () => rand();
  const rooms = [];
  const corridors = [];

  for (let i = 0; i < roomCount; i++) {
    const w = 30 + r() * 50;
    const h = 25 + r() * 40;
    let x, y, attempts = 0;
    do {
      x = (r() - 0.5) * roomCount * 30;
      y = (r() - 0.5) * roomCount * 25;
      attempts++;
    } while (attempts < 20 && rooms.some(rm =>
      Math.abs(rm.x - x) < (rm.w + w) / 2 + 8 && Math.abs(rm.y - y) < (rm.h + h) / 2 + 8
    ));

    const features = [];
    if (r() > 0.6) features.push('pillar');
    if (r() > 0.7) features.push('water');
    if (r() > 0.8) features.push('altar');
    if (i === 0) features.push('entrance');
    if (i === roomCount - 1) features.push('boss');

    rooms.push({ x, y, w, h, features, id: i });
  }

  // Connect rooms with corridors
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i], b = rooms[i + 1];
    corridors.push({ x1: a.x, y1: a.y, x2: b.x, y2: a.y }); // horizontal
    corridors.push({ x1: b.x, y1: a.y, x2: b.x, y2: b.y }); // vertical
  }
  // Add some random connections
  for (let i = 0; i < Math.floor(roomCount / 3); i++) {
    const a = rooms[Math.floor(r() * rooms.length)];
    const b = rooms[Math.floor(r() * rooms.length)];
    if (a.id !== b.id) {
      corridors.push({ x1: a.x, y1: a.y, x2: a.x, y2: b.y });
      corridors.push({ x1: a.x, y1: b.y, x2: b.x, y2: b.y });
    }
  }

  return { rooms, corridors };
}

export function DungeonMap({ roomCount = 8, seed = 99, currentRoom = 0, width = 500, height = 400, onRoomClick, style = {} }) {
  const { rooms, corridors } = useMemo(
    () => generateDungeonRooms(roomCount, seed),
    [roomCount, seed]
  );

  // Calculate viewBox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  rooms.forEach(rm => {
    minX = Math.min(minX, rm.x - rm.w / 2 - 20);
    minY = Math.min(minY, rm.y - rm.h / 2 - 20);
    maxX = Math.max(maxX, rm.x + rm.w / 2 + 20);
    maxY = Math.max(maxY, rm.y + rm.h / 2 + 20);
  });
  const vw = maxX - minX + 40;
  const vh = maxY - minY + 40;

  return (
    <svg width={width} height={height} viewBox={`${minX - 20} ${minY - 20} ${vw} ${vh}`}
      style={{ background: '#0a0a0a', borderRadius: '4px', border: '1px solid rgba(255,215,0,0.2)', ...style }}>

      {/* Corridors */}
      {corridors.map((c, i) => (
        <line key={`c${i}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
          stroke="#2a2a3e" strokeWidth={10} strokeLinecap="round" />
      ))}
      {corridors.map((c, i) => (
        <line key={`cw${i}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
          stroke="#1a1a2e" strokeWidth={8} strokeLinecap="round" />
      ))}

      {/* Rooms */}
      {rooms.map((rm) => {
        const isCurrent = rm.id === currentRoom;
        const isVisited = rm.id < currentRoom;
        const isUnknown = rm.id > currentRoom;
        return (
          <g key={rm.id} onClick={onRoomClick ? () => onRoomClick(rm.id) : undefined}
            style={{ cursor: onRoomClick ? 'pointer' : 'default' }}>
            {/* Room outline */}
            <rect x={rm.x - rm.w / 2} y={rm.y - rm.h / 2} width={rm.w} height={rm.h}
              fill={isUnknown ? '#0a0a0a' : isCurrent ? '#1a1a3e' : '#151520'}
              stroke={isCurrent ? '#ffd700' : isVisited ? '#3a3a5e' : '#1a1a2e'}
              strokeWidth={isCurrent ? 2 : 1} rx={2} />

            {/* Fog of war */}
            {isUnknown && (
              <rect x={rm.x - rm.w / 2} y={rm.y - rm.h / 2} width={rm.w} height={rm.h}
                fill="rgba(0,0,0,0.7)" rx={2} />
            )}

            {/* Room features */}
            {!isUnknown && rm.features.includes('pillar') && (
              <g>
                {[[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].map(([fx, fy], i) => (
                  <circle key={i} cx={rm.x + fx * rm.w * 0.35} cy={rm.y + fy * rm.h * 0.35}
                    r={3} fill="#3a3a4a" stroke="#4a4a5a" strokeWidth={0.5} />
                ))}
              </g>
            )}
            {!isUnknown && rm.features.includes('water') && (
              <ellipse cx={rm.x} cy={rm.y + rm.h * 0.15} rx={rm.w * 0.25} ry={rm.h * 0.15}
                fill="#0a2a4a" stroke="#1a3a5a" strokeWidth={0.5} opacity={0.7} />
            )}
            {!isUnknown && rm.features.includes('altar') && (
              <rect x={rm.x - 4} y={rm.y - 3} width={8} height={6}
                fill="#4a2a4a" stroke="#6a3a6a" strokeWidth={0.5} />
            )}
            {!isUnknown && rm.features.includes('entrance') && (
              <text x={rm.x} y={rm.y + 4} textAnchor="middle" fill="#51cf66" fontSize={12}>{'\u25B2'}</text>
            )}
            {!isUnknown && rm.features.includes('boss') && (
              <text x={rm.x} y={rm.y + 5} textAnchor="middle" fill="#ff4444" fontSize={14}>{'\u2620'}</text>
            )}

            {/* Room number */}
            {!isUnknown && (
              <text x={rm.x - rm.w / 2 + 4} y={rm.y - rm.h / 2 + 10}
                fill={isCurrent ? '#ffd700' : '#4a4a6a'} fontSize={8} fontWeight="bold">
                {rm.id + 1}
              </text>
            )}

            {/* Party marker in current room */}
            {isCurrent && (
              <g>
                <circle cx={rm.x} cy={rm.y} r={5} fill="#ffd700" opacity={0.9}>
                  <animate attributeName="opacity" from="1" to="0.4" dur="1.5s" repeatCount="indefinite" />
                </circle>
                <text x={rm.x} y={rm.y + 3} textAnchor="middle" fill="#000" fontSize={7} fontWeight="bold">{'\u2694'}</text>
              </g>
            )}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${minX + 5}, ${maxY + 10})`}>
        <text fill="#4a4a6a" fontSize={7}>
          {'\u25B2'} Entrance {'  '} {'\u2620'} Boss {'  '} {'\u2694'} Party
        </text>
      </g>
    </svg>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// DECORATIVE DIVIDER — Horizontal separator for panels
// ════════════════════════════════════════════════════════════════════════════

export function Divider({ width = 200, color = '#ffd700', opacity = 0.4 }) {
  return (
    <svg width={width} height={12} viewBox={`0 0 ${width} 12`} style={{ display: 'block', margin: '8px auto' }}>
      <line x1={10} y1={6} x2={width - 10} y2={6} stroke={color} strokeWidth={0.5} opacity={opacity} />
      <circle cx={width / 2} cy={6} r={3} fill="none" stroke={color} strokeWidth={1} opacity={opacity} />
      <circle cx={width / 2} cy={6} r={1} fill={color} opacity={opacity} />
      <line x1={width / 2 - 20} y1={6} x2={width / 2 - 8} y2={6} stroke={color} strokeWidth={1.5} opacity={opacity} />
      <line x1={width / 2 + 8} y1={6} x2={width / 2 + 20} y2={6} stroke={color} strokeWidth={1.5} opacity={opacity} />
    </svg>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// TERRAIN ICON — Small standalone terrain symbol
// ════════════════════════════════════════════════════════════════════════════

export function TerrainIcon({ terrain, size = 24 }) {
  const s = size;
  const half = s / 2;
  const c = TERRAIN_BASE_COLORS[terrain] || '#2a2a2a';

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <rect width={s} height={s} fill={c} rx={3} opacity={0.8} />
      <TerrainDetails terrain={terrain} cx={half} cy={half} seed={terrain?.charCodeAt(0) || 0} />
    </svg>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// MAP LEGEND — Shows terrain types with icons
// ════════════════════════════════════════════════════════════════════════════

export function MapLegend({ terrains, style = {} }) {
  const allTerrains = terrains || Object.keys(TERRAIN_BASE_COLORS);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '10px', color: '#8b949e', ...style }}>
      {allTerrains.map(t => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <TerrainIcon terrain={t} size={16} />
          <span style={{ textTransform: 'capitalize' }}>{t}</span>
        </div>
      ))}
    </div>
  );
}
