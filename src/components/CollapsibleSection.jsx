import React, { useState, useEffect } from 'react';

// Bug #48 — collapse-only minimal default for the adventure UI crowding complaint.
// When a `persistKey` is supplied, the open/closed state is stored in localStorage
// under `pf-adventure-panel-state.<persistKey>` so the operator's minimize choice
// survives reloads. When `persistKey` is omitted, behavior is identical to
// pre-#48 (internal useState seeded from `defaultOpen`).
//
// Panel-layout per-campaign scoping (operator request after #48 shipped — "the
// format should be saved for the campaign specific"): when `campaignId` is
// also supplied the storage key becomes
//   `pf-adventure-panel-state.<campaignId>.<persistKey>`
// so each campaign has its own collapse layout. If the scoped key is missing
// we fall back to the legacy global key so pre-scoping preferences don't get
// wiped on the first mount after the upgrade.
const PANEL_STATE_PREFIX = 'pf-adventure-panel-state.';

function buildStorageKey(persistKey, campaignId) {
  if (!persistKey) return null;
  if (!campaignId) return PANEL_STATE_PREFIX + persistKey;
  return `${PANEL_STATE_PREFIX}${campaignId}.${persistKey}`;
}

function readPersistedOpen(persistKey, campaignId, fallback) {
  if (!persistKey || typeof window === 'undefined') return fallback;
  try {
    const scopedKey = buildStorageKey(persistKey, campaignId);
    const scoped = window.localStorage?.getItem(scopedKey);
    if (scoped != null) return scoped === '1' || scoped === 'true';
    // Legacy fallback: pre-scoping, state was stored under the un-scoped
    // key. Read it once so the operator's existing layout survives the
    // upgrade. The value is not migrated — the next toggle writes under
    // the scoped key which then takes precedence on subsequent reads.
    if (campaignId) {
      const legacy = window.localStorage?.getItem(PANEL_STATE_PREFIX + persistKey);
      if (legacy != null) return legacy === '1' || legacy === 'true';
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writePersistedOpen(persistKey, campaignId, open) {
  if (!persistKey || typeof window === 'undefined') return;
  try {
    const key = buildStorageKey(persistKey, campaignId);
    window.localStorage?.setItem(key, open ? '1' : '0');
  } catch { /* quota / private mode — ignore */ }
}

export default function CollapsibleSection({ title, icon, count, defaultOpen = false, color = '#ffd700', children, badge, persistKey, campaignId, dragHandleClassName = null }) {
  const [open, setOpen] = useState(() => readPersistedOpen(persistKey, campaignId, defaultOpen));

  // When campaignId changes (e.g. operator loads a different save) re-read
  // the persisted state for the new scope. Without this, the first-mount
  // useState value sticks even after the key changes, silently rendering
  // the previous campaign's layout until the user toggles a section.
  useEffect(() => {
    if (!persistKey || typeof window === 'undefined') return;
    const next = readPersistedOpen(persistKey, campaignId, defaultOpen);
    setOpen(next);
    // defaultOpen intentionally excluded — we only want to resync when the
    // scope key changes, not when a parent re-renders with a new default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey, campaignId]);

  useEffect(() => {
    writePersistedOpen(persistKey, campaignId, open);
  }, [persistKey, campaignId, open]);

  // Grid-tile mode: when `dragHandleClassName` is supplied the section is
  // rendered inside a react-grid-layout tile that provides its own bounded
  // height. In that case we need to fill the tile vertically and let the
  // body scroll, not let it balloon past the tile bottom. Without this the
  // body content spills past the tile's overflow:hidden boundary and is
  // clipped with no scrollbar (reported 2026-04-18).
  const inGridTile = !!dragHandleClassName;

  return (
    <div style={{
      backgroundColor: '#2a2a4e',
      border: `1px solid ${color}44`,
      borderRadius: '8px',
      marginBottom: inGridTile ? 0 : '6px',
      overflow: 'hidden',
      ...(inGridTile ? {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      } : {}),
    }}>
      <button
        onClick={() => setOpen(!open)}
        className={dragHandleClassName || undefined}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 14px',
          backgroundColor: open ? '#2a2a5e' : '#2a2a4e',
          border: 'none',
          borderBottom: open ? `1px solid ${color}33` : 'none',
          ...(inGridTile ? { flexShrink: 0 } : {}),
          color,
          // Bug #48 follow-up (grid spike): when rendered inside a
          // dockable grid tile, the header doubles as the drag handle.
          // Keep the pointer visible as a move cursor; click still
          // toggles open/close.
          cursor: dragHandleClassName ? 'move' : 'pointer',
          fontSize: '13px',
          fontWeight: 'bold',
          textAlign: 'left',
          transition: 'background-color 0.15s',
        }}
      >
        <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {count != null && (
          <span style={{
            fontSize: '11px',
            backgroundColor: `${color}22`,
            color,
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 'normal',
          }}>
            {count}
          </span>
        )}
        {badge && (
          <span style={{
            fontSize: '10px',
            backgroundColor: '#ff6b6b33',
            color: '#ff6b6b',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 'bold',
          }}>
            {badge}
          </span>
        )}
        <span style={{
          fontSize: '12px',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          opacity: 0.6,
        }}>
          ▼
        </span>
      </button>
      {open && (
        <div style={{
          padding: '10px 12px',
          ...(inGridTile ? {
            flex: '1 1 0',
            minHeight: 0,
            overflow: 'auto',
          } : {}),
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
