// AdventureGrid.jsx — Bug #48 follow-up spike (2026-04-18).
//
// Dockable grid frame for the Adventure tab's main gameplay surface.
// Replaces the fixed log + sidebar-with-splitter layout on desktop. Each
// top-level panel (Game Log, Map, Places Here, Nearby NPCs, Area Items)
// is a draggable + resizable grid tile. Layout is saved per-campaign to
// localStorage under `pf-adventure-layout.<campaignId>.gridLayout.v1`.
//
// This is a SPIKE — intentionally minimal. Mobile path (isMobile=true in
// AdventureTab) still renders the legacy stacked CollapsibleSection list.
// If the grid proves out we'll fold in Context Actions + Party HP +
// Calendar as additional tiles; right now those stay in the fixed bars
// above/below the grid.
//
// Drag handle: each panel's header element carries the .adv-grid-handle
// class so clicks inside panel bodies don't accidentally drag. Corners
// resize; the bottom-right visual handle is provided by react-grid-layout
// default CSS.

import React, { useMemo, useEffect, useRef, useState } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './AdventureGrid.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

// Grid constants. 12 columns is react-grid-layout's default — keeps the
// layout math familiar. rowHeight at 30 (px) + 6px margin gives a
// reasonable granularity: a 10-row-tall tile reads ~340px. We set the
// breakpoints so below `md` the grid collapses to a single column
// (shouldn't happen on desktop — AdventureTab routes mobile users to the
// legacy stacked render — but guards the edge case of a desktop window
// squeezed down to tablet width).
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };

// Default layouts. Tuned by eye: Game Log takes the left half + full
// height; the right half stacks Map on top, Places Here in the middle,
// and Nearby NPCs at the bottom. Operator can rearrange from here —
// saved positions override these defaults on subsequent loads.
//
// Items-as-panel intentionally NOT included. Per operator rule
// (feedback_items_narrative_first.md, 2026-04-18): items should be
// acted on from the narrative, not listed in a separate panel. Items
// still persist to the areaItems tracker for journal scope + #59
// extraction, they just don't get a grid tile.
//
// Tile i keys must match the children's `key` props (and React's key
// warning will shout if they don't).
const DEFAULT_LAYOUT = {
  lg: [
    { i: 'log',        x: 0, y: 0,  w: 7, h: 20, minW: 3, minH: 6 },
    { i: 'map',        x: 7, y: 0,  w: 5, h: 7,  minW: 3, minH: 4 },
    { i: 'worldTree',  x: 7, y: 7,  w: 5, h: 6,  minW: 3, minH: 3 },
    { i: 'npcs',       x: 7, y: 13, w: 5, h: 7,  minW: 3, minH: 3 },
  ],
  md: [
    { i: 'log',        x: 0, y: 0,  w: 6, h: 20, minW: 3, minH: 6 },
    { i: 'map',        x: 6, y: 0,  w: 4, h: 7,  minW: 3, minH: 4 },
    { i: 'worldTree',  x: 6, y: 7,  w: 4, h: 6,  minW: 3, minH: 3 },
    { i: 'npcs',       x: 6, y: 13, w: 4, h: 7,  minW: 3, minH: 3 },
  ],
};

const LAYOUT_STORAGE_PREFIX = 'pf-adventure-layout.';
const LAYOUT_VERSION_SUFFIX = '.gridLayout.v1';

function storageKey(scopeKey) {
  return `${LAYOUT_STORAGE_PREFIX}${scopeKey}${LAYOUT_VERSION_SUFFIX}`;
}

function readSavedLayout(scopeKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(storageKey(scopeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Shape guard — must be an object with at least one breakpoint key
    // mapping to an array. If anything is off, fall back to defaults
    // (a corrupted layout shouldn't brick the Adventure tab).
    if (!parsed || typeof parsed !== 'object') return null;
    for (const bp of Object.keys(COLS)) {
      if (parsed[bp] && !Array.isArray(parsed[bp])) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSavedLayout(scopeKey, layouts) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(storageKey(scopeKey), JSON.stringify(layouts));
  } catch { /* quota / private mode — ignore */ }
}

/**
 * AdventureGrid — draggable/resizable grid of the Adventure tab panels.
 *
 * Props:
 *   scopeKey   string   per-campaign layout scope (AdventureTab passes
 *                       campaignScopeKey which is campaign.data.id or
 *                       '__default')
 *   panels     Array<{key, element}>  panel nodes in render order. `key`
 *                       must match one of the DEFAULT_LAYOUT entries
 *                       (log / map / worldTree / npcs / areaItems). A
 *                       caller may omit panels conditionally — a missing
 *                       key simply drops that tile from the grid.
 */
// Vertical grid row budget. Default layouts top out at y+h = 20, so we
// ask the grid to divvy the available pixel height into ~20 row units.
// When the operator drags a tile taller than that, the grid gets a
// scrollbar (wrapper has overflow:auto) — better than letting tiles
// shrink below usability.
const TARGET_GRID_ROWS = 20;
const MIN_ROW_HEIGHT = 20;
const MAX_ROW_HEIGHT = 60;
const ROW_MARGIN_PX = 6;

export default function AdventureGrid({ scopeKey, panels, onResetLayout }) {
  // Filter layouts down to only the panels actually being rendered this
  // tick. react-grid-layout will throw if a layout entry references a
  // missing child, and vice versa for a child without a layout entry.
  const activeKeys = useMemo(
    () => (panels || []).map(p => p.key).filter(Boolean),
    [panels]
  );

  // Measure the grid wrapper so we can size rowHeight to fill. Default
  // rowHeight=30 made the grid shorter than the viewport, leaving a
  // large black gap below the tiles (reported 2026-04-18). We watch the
  // wrapper with a ResizeObserver and recompute rowHeight whenever the
  // tab is resized.
  const wrapperRef = useRef(null);
  const [rowHeight, setRowHeight] = useState(30);

  useEffect(() => {
    if (!wrapperRef.current || typeof ResizeObserver === 'undefined') return;
    const el = wrapperRef.current;
    const recompute = () => {
      const h = el.clientHeight;
      if (!h || h <= 0) return;
      // Subtract the grid's top+bottom padding (~0 here) + inter-row margins.
      const usable = h - ROW_MARGIN_PX * (TARGET_GRID_ROWS + 1);
      const raw = usable / TARGET_GRID_ROWS;
      const clamped = Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.floor(raw)));
      setRowHeight(clamped);
    };
    recompute();
    const obs = new ResizeObserver(recompute);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const initialLayouts = useMemo(() => {
    const saved = readSavedLayout(scopeKey);
    const base = saved || DEFAULT_LAYOUT;
    const out = {};
    for (const bp of Object.keys(COLS)) {
      const src = Array.isArray(base[bp]) && base[bp].length
        ? base[bp]
        : DEFAULT_LAYOUT[bp] || DEFAULT_LAYOUT.lg;
      out[bp] = src.filter(item => activeKeys.includes(item.i));
      // Add entries for any active keys missing from the saved layout
      // — e.g. Area Items was hidden last session (items.length===0)
      // so wasn't persisted; now it's back.
      const presentInLayout = new Set(out[bp].map(it => it.i));
      const defaults = DEFAULT_LAYOUT[bp] || DEFAULT_LAYOUT.lg;
      for (const def of defaults) {
        if (activeKeys.includes(def.i) && !presentInLayout.has(def.i)) {
          out[bp].push(def);
        }
      }
    }
    return out;
    // scopeKey changes when campaign switches — recompute layout against
    // that campaign's saved positions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, activeKeys.join('|')]);

  const lastPersistedRef = useRef(null);

  const handleLayoutChange = (_currentLayout, allLayouts) => {
    // Debounce the persist by comparing serialized strings — the grid
    // fires onLayoutChange on every render, not just on drag/resize end.
    try {
      const serialized = JSON.stringify(allLayouts);
      if (lastPersistedRef.current === serialized) return;
      lastPersistedRef.current = serialized;
      writeSavedLayout(scopeKey, allLayouts);
    } catch { /* ignore */ }
  };

  // When scopeKey flips (campaign switch), reset the persist-dedup ref
  // so the next layout emission for the new campaign actually writes.
  useEffect(() => {
    lastPersistedRef.current = null;
  }, [scopeKey]);

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'auto' }}
    >
      {onResetLayout && (
        <button
          type="button"
          onClick={onResetLayout}
          title="Restore the default panel layout for this campaign"
          style={{
            position: 'absolute',
            top: 4,
            right: 8,
            zIndex: 3,
            padding: '3px 10px',
            fontSize: '10px',
            backgroundColor: 'rgba(42, 42, 78, 0.85)',
            color: '#ffd700',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Reset layout
        </button>
      )}
      <ResponsiveGridLayout
        className="adv-grid"
        layouts={initialLayouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={rowHeight}
        margin={[ROW_MARGIN_PX, ROW_MARGIN_PX]}
        draggableHandle=".adv-grid-handle"
        compactType="vertical"
        preventCollision={false}
        onLayoutChange={handleLayoutChange}
        isResizable={true}
        resizeHandles={['se']}
      >
        {(panels || []).map(({ key, element }) => (
          <div
            key={key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#1a1a2e',
              border: '1px solid rgba(255, 215, 0, 0.18)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            {element}
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}

// Exposed for callers that want to blow away a campaign's saved layout
// — e.g. a future "Reset layout" button that calls this then forces a
// remount via `key` bump. Safe to call when nothing is persisted.
export function clearSavedLayout(scopeKey) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(storageKey(scopeKey));
  } catch { /* ignore */ }
}
