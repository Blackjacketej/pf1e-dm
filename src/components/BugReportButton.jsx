/**
 * BugReportButton — floating note/bug/design/idea button.
 *
 * Operator-facing companion to the playLog firehose. Click (< 5px movement)
 * opens a modal; drag (>= 5px) repositions the FAB. Position persists in
 * localStorage. All entries are stored in IndexedDB AND appended to
 * claude-notes.md at the project root via the Vite dev-server plugin so
 * Claude can parse them in the next Cowork session.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  appendBug,
  listBugs,
  markResolved,
  acceptBug,
  reopen,
  deleteBug,
  updateBug,
  rehydrateFromMarkdown,
  exportQueueAsMarkdown,
  snapshotCurrentContext,
  reorderOpenBugs,
  applyAcceptedFromSync,
  SEVERITIES,
  KINDS,
} from '../services/bugQueue';
import {
  exportLogAsMarkdown,
  getRecentEvents,
  clearPlayLog,
} from '../services/playLog';
import { getRecentTrace } from '../services/engineTrace';

// Per-kind modal config: icon, title, placeholder, color accent.
// Single source of truth for all copy changes so adding a kind is a one-line diff.
const KIND_CONFIG = {
  bug: {
    label: 'bug',
    icon: '\u{1F41E}',
    color: '#ff6b6b',
    title: 'Report a rules issue',
    placeholder: "e.g. Tumble through enemy used DC 15 instead of 25, or feat bonus didn't apply, or ACP wasn't deducted...",
    showSeverity: true,
    showContext: true,
  },
  note: {
    label: 'note',
    icon: '\u{1F4DD}',
    color: '#7eb8da',
    title: 'Note for Claude',
    placeholder: 'Any thought about the game for Claude to parse later - UX, copy, data gaps, behavior you want changed...',
    showSeverity: false,
    showContext: false,
  },
  design: {
    label: 'design',
    icon: '\u{1F3A8}',
    color: '#c792ea',
    title: 'Design note',
    placeholder: 'e.g. "Backstory should be pre-generated for template characters", "Commission modal needs a price breakdown"...',
    showSeverity: false,
    showContext: false,
  },
  idea: {
    label: 'idea',
    icon: '\u{1F4A1}',
    color: '#ffd700',
    title: 'Idea',
    placeholder: 'Something new to build, or a direction to explore - no commitment, just a seed...',
    showSeverity: false,
    showContext: false,
  },
};

// Drag-to-reposition constants.
const FAB_SIZE = 46;
const FAB_MARGIN = 16;
const POS_STORAGE_KEY = 'claudeNotesFabPos';
// ~5px threshold distinguishes a click (open modal) from a drag (reposition).
const DRAG_THRESHOLD_PX = 5;

// Attachment constants — shared between the initial-submit modal (#36) and
// the reopen panel (#47). Hoisted to module scope so both components can
// reuse the limits without redeclaring them.
const ATTACH_MAX_FILES = 5;
const ATTACH_MAX_FILE_BYTES = 5 * 1024 * 1024;
const ATTACH_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ATTACH_ACCEPT_TYPES = /^(image\/|application\/pdf$|text\/)/;

// Module-scope helper so the reopen panel in BugQueueViewer can read pasted/
// picked files into data URLs without duplicating the FileReader wrapper.
const readFileAsDataUrlModule = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error('read failed'));
  reader.onload = () => resolve(reader.result);
  reader.readAsDataURL(file);
});

const loadSavedPos = () => {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
  } catch { /* noop */ }
  return null;
};

const defaultPos = () => {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: window.innerWidth - FAB_SIZE - FAB_MARGIN,
    y: window.innerHeight - FAB_SIZE - FAB_MARGIN,
  };
};

const clampPos = (p) => {
  if (typeof window === 'undefined') return p;
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - FAB_SIZE)),
    y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - FAB_SIZE)),
  };
};

// Bug #26: the entry form and queue viewer used to be centered modals locked
// in place by a backdrop overlay. They now render as freely-positionable
// windows with a drag handle title bar, independent close button, and
// per-window persisted position. No backdrop — the operator can keep the game
// visible underneath while moving the window out of the way.
const WIN_POS_KEYS = {
  entry: 'claudeNotesEntryWinPos',
  viewer: 'claudeNotesViewerWinPos',
};

const loadWinPos = (key) => {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
  } catch { /* noop */ }
  return null;
};

const defaultWinPos = (width) => {
  if (typeof window === 'undefined') return { x: 40, y: 40 };
  return {
    x: Math.max(16, Math.floor((window.innerWidth - width) / 2)),
    y: Math.max(16, Math.floor(window.innerHeight * 0.08)),
  };
};

// Keep at least 80px of the title bar on-screen so a window can't be dragged
// past the edge and become unreachable.
const clampWinPos = (p, width) => {
  if (typeof window === 'undefined') return p;
  const minX = -width + 80;
  const maxX = window.innerWidth - 80;
  const minY = 0;
  const maxY = Math.max(0, window.innerHeight - 40);
  return {
    x: Math.min(Math.max(minX, p.x), maxX),
    y: Math.min(Math.max(minY, p.y), maxY),
  };
};

function DraggableWindow({
  storageKey,
  title,
  titleColor = '#ffd700',
  onClose,
  width = 640,
  maxHeight = '85vh',
  zIndex = 200,
  children,
}) {
  const [pos, setPos] = useState(() => clampWinPos(loadWinPos(storageKey) || defaultWinPos(width), width));
  const dragRef = useRef({
    active: false, pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0,
  });

  useEffect(() => {
    const onResize = () => setPos((prev) => clampWinPos(prev, width));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    // Don't start a drag if the pointer is on the close button or any
    // interactive descendant that wants the click.
    if (e.target.closest('[data-win-nodrag]')) return;
    dragRef.current = {
      active: true, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      originX: pos.x, originY: pos.y,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPos(clampWinPos({ x: d.originX + dx, y: d.originY + dy }, width));
  }, [width]);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    d.active = false;
    setPos((prev) => {
      try { localStorage.setItem(storageKey, JSON.stringify(prev)); } catch { /* noop */ }
      return prev;
    });
  }, [storageKey]);

  return (
    <div
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: `${width}px`,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight,
        backgroundColor: '#12121f',
        border: `2px solid ${titleColor}`,
        borderRadius: '8px',
        color: '#e0d6c2',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        zIndex,
        boxShadow: '0 6px 24px rgba(0,0,0,0.6)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: `1px solid ${titleColor}`,
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          color: titleColor,
          fontWeight: 'bold',
          fontSize: '13px',
          borderRadius: '6px 6px 0 0',
          backgroundColor: `${titleColor}14`,
        }}
        title="Drag to move"
      >
        <span style={{ flex: 1 }}>{title}</span>
        <button
          data-win-nodrag
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            color: titleColor,
            fontSize: '18px',
            cursor: 'pointer',
            padding: '0 6px',
            lineHeight: 1,
          }}
          title="Close (Esc)"
        >
          ×
        </button>
      </div>
      <div style={{ padding: '16px', overflow: 'auto', flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export default function BugReportButton({ scene = null, currentCharacter = null }) {
  const [open, setOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('note');
  const [severity, setSeverity] = useState('minor');
  const [contextJson, setContextJson] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [submitError, setSubmitError] = useState(null);
  const [saveFlash, setSaveFlash] = useState(null);
  // #36: attachments — in-memory list of { name, type, size, dataUrl } before submit.
  const [attachments, setAttachments] = useState([]);
  const [attachError, setAttachError] = useState(null);
  const fileInputRef = useRef(null);

  const cfg = KIND_CONFIG[kind] || KIND_CONFIG.note;

  // Drag state.
  const [fabPos, setFabPos] = useState(() => clampPos(loadSavedPos() || defaultPos()));
  const dragRef = useRef({
    active: false, pointerId: null, startX: 0, startY: 0,
    originX: 0, originY: 0, moved: false,
  });
  // Textarea ref for Save-and-stay refocus.
  const textareaRef = useRef(null);

  useEffect(() => {
    const onResize = () => setFabPos((prev) => clampPos(prev));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragRef.current = {
      active: true, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      originX: fabPos.x, originY: fabPos.y, moved: false,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [fabPos.x, fabPos.y]);

  const handlePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    setFabPos(clampPos({ x: d.originX + dx, y: d.originY + dy }));
  }, []);

  const handlePointerUp = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    d.active = false;
    if (d.moved) {
      setFabPos((prev) => {
        try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(prev)); } catch { /* noop */ }
        return prev;
      });
    }
  }, []);

  const refreshCount = useCallback(async () => {
    try {
      const bugs = await listBugs({ status: 'open' });
      setOpenCount(bugs.length);
    } catch { /* noop */ }
  }, []);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  const openModal = () => {
    const ctx = snapshotCurrentContext();
    setContextJson(ctx ? JSON.stringify(ctx, null, 2) : '(no recent rules event)');
    setText('');
    setKind('note');
    setSeverity('minor');
    setSubmitError(null);
    setSaveFlash(null);
    setAttachments([]);
    setAttachError(null);
    setOpen(true);
  };

  // #36 — attachment helpers.
  // Cap per-file at 5 MB and the whole report at 5 files / 20 MB total so a
  // paste-heavy operator can't accidentally write gigabytes to IndexedDB.
  const MAX_FILES = 5;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  const ACCEPT_TYPES = /^(image\/|application\/pdf$|text\/)/;

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  const onPickFiles = async (fileList) => {
    setAttachError(null);
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const existingTotal = attachments.reduce((n, a) => n + (a.size || 0), 0);
    const next = [...attachments];
    for (const f of files) {
      if (next.length >= MAX_FILES) { setAttachError(`Max ${MAX_FILES} files per report.`); break; }
      if (!ACCEPT_TYPES.test(f.type || '')) { setAttachError(`"${f.name}" is not an image/pdf/text.`); continue; }
      if (f.size > MAX_FILE_BYTES) { setAttachError(`"${f.name}" exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB.`); continue; }
      const running = next.reduce((n, a) => n + (a.size || 0), existingTotal);
      if (running + f.size > MAX_TOTAL_BYTES) { setAttachError('Total attachments exceed 20 MB.'); break; }
      try {
        const dataUrl = await readFileAsDataUrl(f);
        next.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl });
      } catch (e) {
        setAttachError(`Failed to read "${f.name}": ${e?.message || e}`);
      }
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onPasteCapture = async (e) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const picked = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) picked.push(f);
      }
    }
    if (picked.length) {
      e.preventDefault();
      await onPickFiles(picked);
    }
  };

  const removeAttachment = (idx) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
    setAttachError(null);
  };

  const closeModal = useCallback((force = false) => {
    if (!force && text.trim().length > 0) {
      const ok = window.confirm('Discard this draft? Your text will be lost.');
      if (!ok) return;
    }
    setOpen(false);
    setSubmitError(null);
    setSaveFlash(null);
  }, [text]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeModal]);

  /**
   * Core submit. `closeAfter` distinguishes the two buttons:
   *   - false -> Save: persist, clear the field, keep modal open for another entry
   *   - true  -> Save & Close: persist and close the modal
   */
  const submit = async (closeAfter) => {
    if (!text.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    let parsedContext = null;
    if (cfg.showContext && contextJson && contextJson !== '(no recent rules event)') {
      try { parsedContext = JSON.parse(contextJson); } catch { parsedContext = { raw: contextJson }; }
    }
    try {
      await appendBug({
        text, kind, severity,
        scene, character: currentCharacter,
        capturedContext: parsedContext,
        recentEvents: cfg.showContext ? getRecentEvents(5) : [],
        // Always attach the engine trace — it's tiny, costs nothing, and
        // is the main signal when the report arrives without any recent
        // rules event (e.g. "app crashed on load"). (#27)
        engineTrace: getRecentTrace(20),
        // #36 — operator-pasted/picked attachments (images, pdfs, text).
        attachments,
      });
      setSubmitError(null);
      await refreshCount();
      if (closeAfter) {
        setOpen(false);
      } else {
        // Save-and-stay: clear text, refresh context, keep kind/severity
        // so consecutive notes of the same type don't require re-picking.
        setText('');
        setAttachments([]);
        setAttachError(null);
        if (cfg.showContext) {
          const ctx = snapshotCurrentContext();
          setContextJson(ctx ? JSON.stringify(ctx, null, 2) : '(no recent rules event)');
        }
        setSaveFlash(`Saved ${cfg.label}. Type another or close.`);
        setTimeout(() => setSaveFlash(null), 2000);
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    } catch (e) {
      console.warn('[BugReportButton] save failed:', e);
      setSubmitError(e?.message || 'Failed to save; your text is preserved, please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const fabAccent = KIND_CONFIG.note.color;

  const styles = {
    fab: {
      position: 'fixed',
      left: `${fabPos.x}px`,
      top: `${fabPos.y}px`,
      width: `${FAB_SIZE}px`,
      height: `${FAB_SIZE}px`,
      borderRadius: '50%',
      backgroundColor: '#1a1a2e',
      border: `2px solid ${fabAccent}`,
      color: fabAccent,
      cursor: 'grab',
      fontSize: '20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      zIndex: 100,
      touchAction: 'none',
      userSelect: 'none',
    },
    fabBadge: {
      position: 'absolute',
      top: '-4px', right: '-4px',
      minWidth: '18px', height: '18px',
      borderRadius: '9px',
      backgroundColor: fabAccent, color: '#1a1a2e',
      fontSize: '11px', fontWeight: 'bold',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 5px',
    },
    overlay: {
      position: 'fixed', inset: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: '16px',
    },
    modal: {
      backgroundColor: '#12121f',
      border: '2px solid #ffd700', borderRadius: '8px',
      width: '100%', maxWidth: '640px', maxHeight: '90vh',
      overflow: 'auto', padding: '20px',
      color: '#e0d6c2', fontSize: '13px',
    },
    title: { color: '#ffd700', fontSize: '16px', marginTop: 0, marginBottom: '12px' },
    label: {
      display: 'block', color: '#8b949e',
      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px',
      marginTop: '12px', marginBottom: '4px',
    },
    textarea: {
      width: '100%',
      backgroundColor: '#0a0a14', border: '1px solid #444', borderRadius: '4px',
      color: '#e0d6c2', padding: '8px',
      fontFamily: 'inherit', fontSize: '13px',
      boxSizing: 'border-box', resize: 'vertical',
    },
    contextArea: {
      width: '100%',
      backgroundColor: '#0a0a14', border: '1px solid #444', borderRadius: '4px',
      color: '#a8d8ea', padding: '8px',
      fontFamily: 'monospace', fontSize: '11px',
      boxSizing: 'border-box', resize: 'vertical',
    },
    sevRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' },
    sevPill: (active, color) => ({
      padding: '4px 10px', borderRadius: '12px',
      border: `1px solid ${color}`,
      backgroundColor: active ? `${color}33` : 'transparent',
      color, cursor: 'pointer',
      fontSize: '11px', fontWeight: active ? 'bold' : 'normal',
    }),
    actionRow: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', flexWrap: 'wrap' },
    button: {
      backgroundColor: '#1a1a2e',
      border: '1px solid #ffd700', color: '#ffd700',
      padding: '8px 16px', borderRadius: '4px',
      cursor: 'pointer', fontSize: '12px',
    },
    buttonGhost: {
      backgroundColor: 'transparent',
      border: '1px solid #555', color: '#8b949e',
      padding: '8px 16px', borderRadius: '4px',
      cursor: 'pointer', fontSize: '12px',
    },
    buttonDanger: {
      backgroundColor: '#1a1a2e',
      border: '1px solid #ff6b6b', color: '#ff6b6b',
      padding: '8px 16px', borderRadius: '4px',
      cursor: 'pointer', fontSize: '12px',
    },
  };

  const sevColor = (s) => ({
    crit: '#ff4444', major: '#ffaa00', minor: '#7eb8da', cosmetic: '#8b949e',
  }[s] || '#8b949e');

  return (
    <>
      <button
        style={styles.fab}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => {
          if (dragRef.current.moved) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          openModal();
        }}
        title="Notes / bugs / ideas for Claude (drag to move)"
        aria-label="Open note-for-Claude modal"
      >
        {/* Bug #1/#5: user asked for the old bug icon back on the FAB.
            Lady beetle = 🐞 (U+1F41E). The modal itself still routes to
            bug / design / note based on the selected kind; the FAB is just
            the shared entry point. */}
        {'\u{1F41E}'}
        {openCount > 0 && <span style={styles.fabBadge}>{openCount}</span>}
      </button>

      {open && (
        <DraggableWindow
          storageKey={WIN_POS_KEYS.entry}
          title={`${cfg.icon} ${cfg.title}`}
          titleColor={cfg.color}
          onClose={() => closeModal()}
          width={640}
        >
            <label style={styles.label}>Kind</label>
            <div style={styles.sevRow}>
              {KINDS.map((k) => {
                const kcfg = KIND_CONFIG[k];
                return (
                  <button
                    key={k}
                    style={styles.sevPill(kind === k, kcfg.color)}
                    onClick={() => setKind(k)}
                  >
                    {kcfg.icon} {kcfg.label}
                  </button>
                );
              })}
            </div>

            <label style={styles.label}>{cfg.showContext ? 'What went wrong?' : 'Your note'}</label>
            <textarea
              ref={textareaRef}
              style={styles.textarea}
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={onPasteCapture}
              placeholder={cfg.placeholder}
              autoFocus
            />

            {/* #36 — file attachments: paste, pick, or drop. Thumbnails render below. */}
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...styles.buttonGhost, padding: '6px 12px', fontSize: '11px' }}
                onClick={() => fileInputRef.current?.click()}
                title="Attach images, PDFs, or text files (≤5 MB each, ≤5 files total)"
              >
                📎 Attach files
              </button>
              <span style={{ color: '#666', fontSize: '11px', fontStyle: 'italic' }}>
                or paste a screenshot into the textarea above. Images, PDFs, text files — 5 MB each, 5 files max.
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,text/*"
                style={{ display: 'none' }}
                onChange={(e) => onPickFiles(e.target.files)}
              />
            </div>

            {attachError && (
              <div
                role="alert"
                style={{
                  marginTop: '8px', padding: '6px 10px',
                  border: '1px solid #ff6b6b', borderRadius: '4px',
                  backgroundColor: 'rgba(255, 107, 107, 0.1)',
                  color: '#ff6b6b', fontSize: '11px',
                }}
              >
                {attachError}
              </div>
            )}

            {attachments.length > 0 && (
              <div style={{
                marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px',
                padding: '6px', border: '1px dashed #444', borderRadius: '4px',
                backgroundColor: 'rgba(255,255,255,0.02)',
              }}>
                {attachments.map((a, i) => {
                  const isImg = a.type?.startsWith('image/');
                  const sizeKb = Math.round(a.size / 1024);
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'relative',
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        width: '88px', padding: '4px',
                        backgroundColor: '#0a0a14', border: '1px solid #333', borderRadius: '3px',
                      }}
                      title={`${a.name} (${sizeKb} KB)`}
                    >
                      {isImg ? (
                        <img
                          src={a.dataUrl}
                          alt={a.name}
                          style={{ width: '72px', height: '54px', objectFit: 'cover', borderRadius: '2px' }}
                        />
                      ) : (
                        <div style={{
                          width: '72px', height: '54px', borderRadius: '2px',
                          backgroundColor: '#1a1a2e', color: '#8b949e',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '10px', fontFamily: 'monospace',
                        }}>
                          {a.type === 'application/pdf' ? 'PDF' : 'TXT'}
                        </div>
                      )}
                      <div style={{
                        marginTop: '3px', width: '80px',
                        fontSize: '10px', color: '#aaa', textAlign: 'center',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {a.name}
                      </div>
                      <div style={{ fontSize: '9px', color: '#666' }}>{sizeKb} KB</div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(i)}
                        title="Remove attachment"
                        style={{
                          position: 'absolute', top: '-6px', right: '-6px',
                          width: '18px', height: '18px', borderRadius: '50%',
                          backgroundColor: '#1a1a2e', border: '1px solid #ff6b6b',
                          color: '#ff6b6b', fontSize: '12px', lineHeight: 1,
                          cursor: 'pointer', padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {cfg.showSeverity && (
              <>
                <label style={styles.label}>Severity</label>
                <div style={styles.sevRow}>
                  {SEVERITIES.map((s) => (
                    <button
                      key={s}
                      style={styles.sevPill(severity === s, sevColor(s))}
                      onClick={() => setSeverity(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            {cfg.showContext && (
              <>
                <label style={styles.label}>
                  Captured context (auto-snapshot of last rules event - edit if needed)
                </label>
                <textarea
                  style={styles.contextArea}
                  rows={10}
                  value={contextJson}
                  onChange={(e) => setContextJson(e.target.value)}
                />
              </>
            )}

            {submitError && (
              <div
                role="alert"
                style={{
                  marginTop: '12px', padding: '8px 10px',
                  border: '1px solid #ff6b6b', borderRadius: '4px',
                  backgroundColor: 'rgba(255, 107, 107, 0.1)',
                  color: '#ff6b6b', fontSize: '12px',
                }}
              >
                {submitError}
              </div>
            )}

            {saveFlash && (
              <div
                role="status"
                style={{
                  marginTop: '12px', padding: '8px 10px',
                  border: `1px solid ${cfg.color}`, borderRadius: '4px',
                  backgroundColor: `${cfg.color}22`,
                  color: cfg.color, fontSize: '12px',
                }}
              >
                {saveFlash}
              </div>
            )}

            <div style={styles.actionRow}>
              <button style={styles.buttonGhost} onClick={() => { closeModal(true); setViewerOpen(true); }}>
                View queue ({openCount})
              </button>
              <button style={styles.buttonGhost} onClick={() => closeModal()}>
                Close
              </button>
              <button
                style={{ ...styles.button, borderColor: cfg.color, color: cfg.color }}
                onClick={() => submit(false)}
                disabled={!text.trim() || submitting}
                title="Save this entry and clear the field so you can write another"
              >
                {submitting ? 'Saving...' : `Save ${cfg.label}`}
              </button>
              <button
                style={{ ...styles.button, borderColor: cfg.color, color: cfg.color, fontWeight: 'bold' }}
                onClick={() => submit(true)}
                disabled={!text.trim() || submitting}
                title="Save this entry and close the modal"
              >
                Save & Close
              </button>
            </div>
        </DraggableWindow>
      )}

      {viewerOpen && (
        <BugQueueViewer
          onClose={() => { setViewerOpen(false); refreshCount(); }}
          styles={styles}
          sevColor={sevColor}
        />
      )}
    </>
  );
}

/* -------------- Bug queue viewer: list, resolve, delete, export --------------- */

function BugQueueViewer({ onClose, styles, sevColor }) {
  const [bugs, setBugs] = useState([]);
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);

  // Pull Claude's "fixed between sessions" list from the Vite dev endpoint and
  // apply it to any open bugs in IndexedDB that match by id. This is how the
  // operator sees resolutions Claude made outside the app (e.g. during a
  // Cowork coding session) automatically reflected in the queue. Silent on
  // error: if the endpoint isn't reachable (production build), the queue just
  // keeps whatever statuses IndexedDB already has.
  const syncClaudeResolutions = useCallback(async () => {
    try {
      const resp = await fetch('/__claude-resolutions');
      if (!resp.ok) return;
      const data = await resp.json().catch(() => null);
      const entries = Array.isArray(data?.resolutions) ? data.resolutions : [];
      if (!entries.length) return;
      // Pull everything so we can upgrade resolved → accepted when the JSON
      // says so, not just flip open → resolved.
      const all = await listBugs();
      const byId = new Map(all.map((b) => [b.id, b]));
      for (const e of entries) {
        if (!e || !Number.isFinite(e.id)) continue;
        const bug = byId.get(e.id);
        if (!bug) continue;
        // Operator acceptance is a strictly later transition than resolution,
        // so apply it last — otherwise markResolved here would clobber it.
        if (bug.status === 'open' && e.resolvedAt) {
          await markResolved(e.id, e.note || 'Fixed by Claude between sessions');
          bug.status = 'resolved';
        }
        if (e.acceptedAt && bug.status !== 'accepted') {
          await applyAcceptedFromSync(e.id, e.acceptedAt);
        }
      }
    } catch (err) {
      console.warn('[BugQueueViewer] resolution sync skipped:', err);
    }
  }, []);

  // Pass the filter through to listBugs so the open view gets priority-aware
  // sorting from the service layer. 'all' and 'resolved' retain createdAt-desc.
  const refresh = useCallback(async () => {
    if (filter === 'all') {
      setBugs(await listBugs());
    } else {
      setBugs(await listBugs({ status: filter }));
    }
  }, [filter]);

  // Rehydrate IndexedDB from claude-notes.md. The on-disk markdown is the
  // source of truth; IndexedDB is just a per-browser cache that can evaporate
  // when the project folder moves, the dev port changes, or the browser
  // clears site data. Triggered automatically on empty queue; also exposed
  // via the "Restore from disk" button for manual re-pulls after hand edits.
  // Sticky diagnostic state for rehydrate failures. The short-lived exportMsg
  // toast isn't enough when the queue is empty and the rehydrate silently
  // fails — the operator needs to see WHY so they can act (usually: restart
  // the Vite dev server so the claude-notes plugin middleware is active).
  const [restoreError, setRestoreError] = useState(null);

  const rehydrateQueue = useCallback(async ({ silent = false } = {}) => {
    try {
      const result = await rehydrateFromMarkdown();
      setRestoreError(null);
      if (!silent) {
        const src = result.source ? ` via ${result.source}` : '';
        const msg = result.added > 0
          ? `Restored ${result.added} entr${result.added === 1 ? 'y' : 'ies'} from claude-notes.md${src}.`
          : `Already in sync with claude-notes.md (${result.total} total, ${result.skipped} skipped)${src}.`;
        setExportMsg(msg);
        setTimeout(() => setExportMsg(null), 4000);
      }
      return result;
    } catch (err) {
      console.warn('[BugQueueViewer] rehydrate failed:', err);
      const failures = Array.isArray(err?.failures) ? err.failures : null;
      setRestoreError({
        message: err?.message || String(err),
        failures,
      });
      if (!silent) {
        setExportMsg(`Restore failed — see diagnostic panel below.`);
        setTimeout(() => setExportMsg(null), 5000);
      }
      return { added: 0, skipped: 0, total: 0 };
    }
  }, []);

  // On mount (and whenever the filter changes), restore order is:
  //  1. If IndexedDB is empty, pull the whole queue from claude-notes.md.
  //     This is the folder-move / fresh-browser recovery path — without it
  //     the operator sees an empty queue even though every bug they ever
  //     reported is still on disk.
  //  2. Pull Claude's resolution file so fixed ids flip to 'resolved'.
  //  3. Refresh the view.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await listBugs();
      if (existing.length === 0) {
        await rehydrateQueue({ silent: false });
      }
      if (cancelled) return;
      await syncClaudeResolutions();
      if (!cancelled) refresh();
    })();
    return () => { cancelled = true; };
  }, [syncClaudeResolutions, refresh, rehydrateQueue]);

  const onResolve = async (id) => { await markResolved(id); refresh(); };
  const onAccept = async (id) => { await acceptBug(id); refresh(); };
  const onDelete = async (id) => {
    if (!window.confirm('Delete this entry? Prefer marking resolved.')) return;
    await deleteBug(id);
    refresh();
  };

  // Reopen flow — we collect an optional follow-up comment inline rather than
  // using window.prompt (single-line only) or a separate modal (heavier UX).
  // When `reopeningId === bug.id`, the row renders a textarea + Submit/Cancel
  // below its normal body. Submit writes the comment to reopenHistory and
  // flips the bug back to status='open'.
  //
  // Bug #47 (note): the operator can now paste / attach screenshots when
  // reopening, mirroring the initial-submit modal's flow. Attachments live
  // on each reopenHistory entry so multiple reopen rounds keep their own
  // evidence and the UI can render them inline next to the matching note.
  const [reopeningId, setReopeningId] = useState(null);
  const [reopenDraft, setReopenDraft] = useState('');
  const [reopenAttachments, setReopenAttachments] = useState([]);
  const [reopenAttachError, setReopenAttachError] = useState(null);
  const reopenFileInputRef = useRef(null);

  const addReopenFiles = useCallback(async (fileList) => {
    setReopenAttachError(null);
    const files = Array.from(fileList || []);
    if (!files.length) return;
    // Snapshot the current attachments closure-side; the FileReader awaits
    // below would race against React's state updater if we tried to do this
    // inside setReopenAttachments(prev => …) (no async setters).
    const nextList = [...reopenAttachments];
    const existingTotal = nextList.reduce((n, a) => n + (a.size || 0), 0);
    let running = existingTotal;
    for (const f of files) {
      if (nextList.length >= ATTACH_MAX_FILES) {
        setReopenAttachError(`Max ${ATTACH_MAX_FILES} files per reopen.`);
        break;
      }
      if (!ATTACH_ACCEPT_TYPES.test(f.type || '')) {
        setReopenAttachError(`"${f.name}" is not an image/pdf/text.`);
        continue;
      }
      if (f.size > ATTACH_MAX_FILE_BYTES) {
        setReopenAttachError(`"${f.name}" exceeds ${ATTACH_MAX_FILE_BYTES / 1024 / 1024} MB.`);
        continue;
      }
      if (running + f.size > ATTACH_MAX_TOTAL_BYTES) {
        setReopenAttachError('Total attachments exceed 20 MB.');
        break;
      }
      try {
        const dataUrl = await readFileAsDataUrlModule(f);
        nextList.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl });
        running += f.size;
      } catch (e) {
        setReopenAttachError(`Failed to read "${f.name}": ${e?.message || e}`);
      }
    }
    setReopenAttachments(nextList);
    if (reopenFileInputRef.current) reopenFileInputRef.current.value = '';
  }, [reopenAttachments]);

  const onReopenPasteCapture = useCallback(async (e) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const picked = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) picked.push(f);
      }
    }
    if (picked.length) {
      e.preventDefault();
      await addReopenFiles(picked);
    }
  }, [addReopenFiles]);

  const removeReopenAttachment = (idx) => {
    setReopenAttachments(prev => prev.filter((_, i) => i !== idx));
    setReopenAttachError(null);
  };

  const startReopen = (id) => {
    setReopeningId(id);
    setReopenDraft('');
    setReopenAttachments([]);
    setReopenAttachError(null);
  };
  const cancelReopen = () => {
    setReopeningId(null);
    setReopenDraft('');
    setReopenAttachments([]);
    setReopenAttachError(null);
  };
  const confirmReopen = async (id) => {
    const note = reopenDraft.trim() || null;
    const attachments = reopenAttachments;
    setReopeningId(null);
    setReopenDraft('');
    setReopenAttachments([]);
    setReopenAttachError(null);
    await reopen(id, { note, attachments });
    // Flip the viewer to the 'open' filter so the operator sees the item
    // land in its new home, rather than having it silently vanish from the
    // resolved/accepted list they were just looking at. The refresh that
    // follows the setFilter will re-read with the new filter.
    setFilter('open');
    setExportMsg(`Reopened #${id} — moved back to the open queue.`);
    setTimeout(() => setExportMsg(null), 3500);
  };

  // Edit flow — inline text (+ severity for bugs) editor for open queue items.
  // When `editingId === bug.id`, the row renders a textarea + severity pills
  // + Save/Cancel below its normal body. Save persists via updateBug which
  // writes through to claude-notes.md so the edit survives a rehydrate.
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSeverity, setEditSeverity] = useState('minor');
  const [editKind, setEditKind] = useState('bug');

  const startEdit = (bug) => {
    setEditingId(bug.id);
    setEditDraft(bug.text || '');
    setEditSeverity(bug.severity || 'minor');
    setEditKind(bug.kind || 'bug');
    // Cancel any in-progress reopen on the same row — two inline panels at
    // once would be confusing and the textareas would fight for autofocus.
    if (reopeningId === bug.id) setReopeningId(null);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
  };
  const confirmEdit = async (id) => {
    const trimmed = editDraft.trim();
    if (!trimmed) {
      setExportMsg('Edit rejected — text cannot be empty.');
      setTimeout(() => setExportMsg(null), 3000);
      return;
    }
    const targetId = id;
    setEditingId(null);
    try {
      await updateBug(targetId, {
        text: trimmed,
        severity: editSeverity,
        kind: editKind,
      });
      setExportMsg(`Saved #${targetId}.`);
      setTimeout(() => setExportMsg(null), 2500);
      await refresh();
    } catch (err) {
      console.warn('[BugQueueViewer] edit failed:', err);
      setExportMsg(`Edit failed: ${err?.message || err}`);
      setTimeout(() => setExportMsg(null), 4000);
    }
  };

  // Write export to claude-exports/ via Vite dev plugin; fall back to browser
  // download if the endpoint isn't reachable (production build).
  const writeExport = async (filename, content) => {
    try {
      const resp = await fetch('/__claude-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content }),
      });
      if (!resp.ok) throw new Error(`export endpoint returned ${resp.status}`);
      const data = await resp.json().catch(() => ({}));
      setExportMsg(`Wrote ${data.path || `claude-exports/${filename}`} in project folder.`);
      setTimeout(() => setExportMsg(null), 4000);
    } catch (err) {
      console.warn('[BugQueueViewer] project-folder export failed, falling back to download:', err);
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMsg(`Dev endpoint unavailable; downloaded ${filename} to your Downloads folder instead.`);
      setTimeout(() => setExportMsg(null), 5000);
    }
  };

  const exportBugs = async () => {
    setBusy(true);
    try {
      const md = await exportQueueAsMarkdown({ includeResolved: filter === 'all' });
      await writeExport(`bug-queue-${new Date().toISOString().slice(0, 10)}.md`, md);
    } finally { setBusy(false); }
  };

  const exportPlayLog = async (allSessions) => {
    setBusy(true);
    try {
      const md = await exportLogAsMarkdown({ allSessions });
      await writeExport(
        `playlog-${allSessions ? 'all' : 'session'}-${new Date().toISOString().slice(0, 10)}.md`,
        md,
      );
    } finally { setBusy(false); }
  };

  const onClearPlayLog = async () => {
    if (!window.confirm('Clear the play log for the current session?')) return;
    await clearPlayLog({ allSessions: false });
  };

  // Drag-to-reorder state. Only active when filter === 'open' — we don't
  // let resolved items be re-ranked since they've already left the queue.
  // `dragId` is the bug currently being dragged; `dragOverId` is the row
  // it's hovering over so we can draw a target indicator.
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const reorderable = filter === 'open';

  // --- drag handlers (HTML5 DnD, no extra deps) ---
  const handleDragStart = (e, id) => {
    if (!reorderable) return;
    setDragId(id);
    // Firefox requires dataTransfer.setData to actually initiate a drag.
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(id));
    } catch { /* noop */ }
  };

  const handleDragOver = (e, id) => {
    if (!reorderable || dragId == null) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ }
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleDragLeaveRow = (id) => {
    if (dragOverId === id) setDragOverId(null);
  };

  const handleDrop = async (e, targetId) => {
    if (!reorderable || dragId == null) return;
    e.preventDefault();
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (sourceId === targetId) return;

    // Compute the new order from the currently-rendered bug list so we're
    // always reordering exactly what the operator sees, regardless of what
    // listBugs returned (priority-sorted, createdAt tie-breaks, etc.).
    const currentIds = bugs.map((b) => b.id);
    const fromIdx = currentIds.indexOf(sourceId);
    const toIdx = currentIds.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = currentIds.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);

    // Optimistic local swap so the drop feels instant, then persist and
    // re-query so we pick up any concurrent edits + canonical priorities.
    const idToBug = new Map(bugs.map((b) => [b.id, b]));
    setBugs(next.map((id) => idToBug.get(id)).filter(Boolean));
    try {
      await reorderOpenBugs(next);
    } catch (err) {
      console.warn('[BugQueueViewer] reorder failed:', err);
    }
    await refresh();
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <DraggableWindow
      storageKey={WIN_POS_KEYS.viewer}
      title="Bug queue"
      titleColor="#ffd700"
      onClose={onClose}
      width={780}
      zIndex={201}
    >
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {['open', 'resolved', 'accepted', 'all'].map((f) => (
            <button
              key={f}
              style={{
                ...styles.buttonGhost,
                ...(filter === f ? { color: '#ffd700', borderColor: '#ffd700' } : {}),
              }}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            style={styles.buttonGhost}
            onClick={async () => {
              setBusy(true);
              try {
                await rehydrateQueue({ silent: false });
                await syncClaudeResolutions();
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            title="Re-read claude-notes.md and pull any entries missing from this browser's IndexedDB cache. Safe to click after moving the project folder or clearing site data."
          >
            Restore from disk
          </button>
          <button style={styles.buttonGhost} onClick={exportBugs} disabled={busy}
            title="Write the current queue to claude-exports/ in your project folder">
            Export queue.md
          </button>
          <button style={styles.buttonGhost} onClick={() => exportPlayLog(false)} disabled={busy}
            title="Write this session's rules events to claude-exports/">
            Export session log
          </button>
          <button style={styles.buttonGhost} onClick={() => exportPlayLog(true)} disabled={busy}
            title="Write every session's rules events to claude-exports/">
            Export full log
          </button>
          <button style={styles.buttonGhost} onClick={onClearPlayLog} disabled={busy}
            title="Wipe the rules-event firehose for this session (the bug queue is untouched)">
            Clear play log
          </button>
        </div>

        {exportMsg && (
          <div
            role="status"
            style={{
              marginBottom: '10px', padding: '6px 10px',
              border: '1px solid #7eb8da', borderRadius: '4px',
              backgroundColor: 'rgba(126, 184, 218, 0.12)',
              color: '#a8d8ea', fontSize: '11px',
            }}
          >
            {exportMsg}
          </div>
        )}

        {restoreError && (
          <div
            role="alert"
            style={{
              marginBottom: '10px', padding: '10px 12px',
              border: '1px solid #d97a7a', borderRadius: '4px',
              backgroundColor: 'rgba(217, 122, 122, 0.10)',
              color: '#f2c0c0', fontSize: '11px', lineHeight: 1.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <strong style={{ color: '#ffb0b0', flex: 1 }}>
                Could not restore from claude-notes.md
              </strong>
              <button
                onClick={() => setRestoreError(null)}
                style={{
                  background: 'transparent', color: '#f2c0c0',
                  border: '1px solid #d97a7a', borderRadius: '3px',
                  fontSize: '10px', padding: '2px 6px', cursor: 'pointer',
                }}
              >
                dismiss
              </button>
            </div>
            <div style={{ marginTop: '6px' }}>
              The bug queue cache lives in IndexedDB (per-browser-origin), but
              the on-disk <code>claude-notes.md</code> is the source of truth.
              The rehydrate path couldn't reach it through any of the known
              endpoints.
            </div>
            <div style={{ marginTop: '6px' }}>
              <strong style={{ color: '#ffd7a8' }}>Most likely fix:</strong>{' '}
              stop your Vite dev server and restart it (<code>npm run dev</code>).
              The <code>/__claude-notes-scan</code> and <code>/__claude-notes-raw</code>{' '}
              middlewares are only active when the server is started after
              those plugin edits were saved — a running server won't pick them
              up from a config change.
            </div>
            {restoreError.failures && restoreError.failures.length > 0 && (
              <details style={{ marginTop: '8px' }}>
                <summary style={{ cursor: 'pointer', color: '#d8a8a8' }}>
                  Attempted paths ({restoreError.failures.length})
                </summary>
                <ul style={{ margin: '4px 0 0 18px', padding: 0, color: '#c8a0a0' }}>
                  {restoreError.failures.map((f, i) => (
                    <li key={i} style={{ fontFamily: 'monospace', fontSize: '10px' }}>
                      {f}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {reorderable && bugs.length > 1 && (
          <div style={{
            marginBottom: '8px', padding: '4px 8px',
            color: '#888', fontSize: '10px', fontStyle: 'italic',
            borderLeft: '2px solid #444',
          }}>
            Drag rows to rank by importance — top = highest priority.
          </div>
        )}
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {bugs.length === 0 && (
            <div style={{ color: '#888', padding: '24px', textAlign: 'center', fontSize: '12px', lineHeight: 1.5 }}>
              <div style={{ marginBottom: 6 }}>No entries in this view.</div>
              <div style={{ color: '#666' }}>
                If you just moved the project folder or reset your browser and expected to see prior bugs,
                click <strong style={{ color: '#a8d8ea' }}>Restore from disk</strong> above — it rebuilds this cache from claude-notes.md.
              </div>
            </div>
          )}
          {bugs.map((bug) => {
            const isDragging = reorderable && dragId === bug.id;
            const isDropTarget = reorderable && dragOverId === bug.id && dragId !== bug.id;
            return (
            <div
              key={bug.id}
              draggable={reorderable}
              onDragStart={(e) => handleDragStart(e, bug.id)}
              onDragOver={(e) => handleDragOver(e, bug.id)}
              onDragLeave={() => handleDragLeaveRow(bug.id)}
              onDrop={(e) => handleDrop(e, bug.id)}
              onDragEnd={handleDragEnd}
              style={{
                border: isDropTarget ? '1px dashed #ffd700' : '1px solid #333',
                borderRadius: '4px',
                padding: '10px', marginBottom: '8px',
                backgroundColor: isDropTarget ? 'rgba(255, 215, 0, 0.06)' : '#0a0a14',
                opacity: isDragging ? 0.45 : 1,
                cursor: reorderable ? 'grab' : 'default',
                transition: 'border-color 120ms, background-color 120ms, opacity 120ms',
              }}
              title={reorderable ? 'Drag to rank by importance' : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {reorderable && (
                  <span
                    aria-hidden="true"
                    style={{
                      color: '#555', fontSize: '14px', lineHeight: 1,
                      cursor: 'grab', userSelect: 'none',
                      fontFamily: 'monospace',
                    }}
                    title="Drag to rank by importance"
                  >
                    {'\u2630'}
                  </span>
                )}
                <span style={{ color: '#666', fontSize: '11px' }}>#{bug.id}</span>
                {bug.kind && bug.kind !== 'bug' && (
                  <span style={{
                    ...styles.sevPill(true, (KIND_CONFIG[bug.kind] || KIND_CONFIG.note).color),
                    cursor: 'default',
                  }}>
                    {(KIND_CONFIG[bug.kind] || KIND_CONFIG.note).icon} {bug.kind}
                  </span>
                )}
                {(!bug.kind || bug.kind === 'bug') && (
                  <span style={{
                    ...styles.sevPill(true, sevColor(bug.severity)),
                    cursor: 'default',
                  }}>
                    {bug.severity}
                  </span>
                )}
                <span style={{
                  color: bug.status === 'open' ? '#ffaa00'
                    : bug.status === 'accepted' ? '#58d7ff'
                    : '#7fff00',
                  fontSize: '11px',
                }}>
                  {bug.status}
                </span>
                <span style={{ color: '#555', fontSize: '11px', flex: 1 }}>
                  {bug.createdAt?.slice(0, 16).replace('T', ' ')}
                </span>
                {bug.status === 'open' && (
                  <button
                    style={{
                      ...styles.buttonGhost, padding: '4px 10px',
                      color: editingId === bug.id ? '#ffd700' : undefined,
                      borderColor: editingId === bug.id ? '#ffd700' : undefined,
                    }}
                    onClick={() => (editingId === bug.id ? cancelEdit() : startEdit(bug))}
                    title="Edit this entry's text, severity, or kind. Writes through to claude-notes.md."
                  >
                    {editingId === bug.id ? 'Cancel edit' : 'Edit'}
                  </button>
                )}
                {bug.status === 'open' && (
                  <button
                    style={{ ...styles.buttonGhost, padding: '4px 10px' }}
                    onClick={() => onResolve(bug.id)}
                    title="Mark this entry as handled. Moves it to the 'resolved' list where you can review and Accept."
                  >
                    Resolve
                  </button>
                )}
                {bug.status === 'resolved' && (
                  <button
                    style={{ ...styles.buttonGhost, padding: '4px 10px', color: '#58d7ff', borderColor: '#58d7ff' }}
                    onClick={() => onAccept(bug.id)}
                    title="Sign off on this fix. Moves the item to the 'accepted' list — it's out of active work but still Reopen-able if the issue comes back."
                  >
                    Accept
                  </button>
                )}
                {(bug.status === 'resolved' || bug.status === 'accepted') && (
                  <button
                    style={{ ...styles.buttonGhost, padding: '4px 10px', color: '#ffaa00', borderColor: '#ffaa00' }}
                    onClick={() => startReopen(bug.id)}
                    title="Push this back to the open queue with a follow-up comment. Use if the fix didn't land or the issue came back."
                  >
                    Reopen
                  </button>
                )}
                <button
                  style={{ ...styles.buttonDanger, padding: '4px 10px' }}
                  onClick={() => onDelete(bug.id)}
                  title="Delete forever. Prefer Resolve so there is a record of what was fixed."
                  >
                  Delete
                </button>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginBottom: '4px' }}>{bug.text}</div>
              {(bug.character || bug.scene) && (
                <div style={{ color: '#666', fontSize: '11px' }}>
                  {bug.character && `${bug.character} | `}{bug.scene}
                </div>
              )}
              {/* #36 — attachments thumbnail strip. Images render inline; other
                  types show a typed chip. Clicking opens the data URL in a
                  new tab so the operator can verify what Claude will see. */}
              {Array.isArray(bug.attachments) && bug.attachments.length > 0 && (
                <div style={{
                  marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px',
                  padding: '4px',
                  borderLeft: '2px solid #c792ea',
                  backgroundColor: 'rgba(199, 146, 234, 0.05)',
                }}>
                  {bug.attachments.map((a, i) => {
                    const isImg = a.type?.startsWith('image/');
                    const sizeKb = Math.round((a.size || 0) / 1024);
                    const href = a.dataUrl || null;
                    return (
                      <a
                        key={i}
                        href={href || '#'}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => { if (!href) e.preventDefault(); }}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          width: '76px', padding: '3px', textDecoration: 'none',
                          backgroundColor: '#0a0a14', border: '1px solid #333', borderRadius: '3px',
                          color: '#aaa',
                        }}
                        title={`${a.name || 'attachment'} (${sizeKb} KB)`}
                      >
                        {isImg && href ? (
                          <img
                            src={href}
                            alt={a.name || 'attachment'}
                            style={{ width: '64px', height: '48px', objectFit: 'cover', borderRadius: '2px' }}
                          />
                        ) : (
                          <div style={{
                            width: '64px', height: '48px', borderRadius: '2px',
                            backgroundColor: '#1a1a2e', color: '#8b949e',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px', fontFamily: 'monospace',
                          }}>
                            {a.type === 'application/pdf' ? 'PDF'
                              : a.type?.startsWith('text/') ? 'TXT'
                              : 'FILE'}
                          </div>
                        )}
                        <div style={{
                          marginTop: '2px', width: '70px',
                          fontSize: '9px', color: '#aaa', textAlign: 'center',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {a.name || `#${i + 1}`}
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
              {(bug.status === 'resolved' || bug.status === 'accepted') && bug.resolutionNote && (
                <div style={{
                  marginTop: '6px', padding: '6px 8px',
                  borderLeft: '2px solid #7fff00',
                  backgroundColor: 'rgba(127, 255, 0, 0.06)',
                  color: '#a8d8a8', fontSize: '11px', whiteSpace: 'pre-wrap',
                }}>
                  <span style={{ color: '#7fff00' }}>Fix:</span> {bug.resolutionNote}
                  {bug.resolvedAt && (
                    <span style={{ color: '#555', marginLeft: '8px' }}>
                      ({bug.resolvedAt.slice(0, 16).replace('T', ' ')})
                    </span>
                  )}
                </div>
              )}
              {bug.status === 'accepted' && bug.acceptedAt && (
                <div style={{
                  marginTop: '6px', padding: '6px 8px',
                  borderLeft: '2px solid #58d7ff',
                  backgroundColor: 'rgba(88, 215, 255, 0.06)',
                  color: '#a8d4e8', fontSize: '11px',
                }}>
                  <span style={{ color: '#58d7ff' }}>Accepted:</span>{' '}
                  {bug.acceptedAt.slice(0, 16).replace('T', ' ')}
                </div>
              )}
              {Array.isArray(bug.reopenHistory) && bug.reopenHistory.length > 0 && (
                <details style={{
                  marginTop: '6px', padding: '4px 8px',
                  borderLeft: '2px solid #ffaa00',
                  backgroundColor: 'rgba(255, 170, 0, 0.06)',
                }}>
                  <summary style={{
                    cursor: 'pointer', color: '#ffc766', fontSize: '11px',
                  }}>
                    Reopen history ({bug.reopenHistory.length})
                  </summary>
                  <div style={{ marginTop: '4px' }}>
                    {bug.reopenHistory.map((h, idx) => (
                      <div key={idx} style={{
                        padding: '4px 0', borderTop: idx > 0 ? '1px dotted #444' : 'none',
                        color: '#d8b88a', fontSize: '11px', whiteSpace: 'pre-wrap',
                      }}>
                        <span style={{ color: '#888' }}>
                          {(h.at || '').slice(0, 16).replace('T', ' ')}
                        </span>
                        {h.fromStatus && (
                          <span style={{ color: '#666', marginLeft: '8px' }}>
                            (was {h.fromStatus})
                          </span>
                        )}
                        {h.note
                          ? <div style={{ marginTop: '2px' }}>{h.note}</div>
                          : <div style={{ marginTop: '2px', color: '#666', fontStyle: 'italic' }}>
                              (no comment)
                            </div>
                        }
                        {/* #47 (note) — render attachments captured on this reopen round, if any. */}
                        {Array.isArray(h.attachments) && h.attachments.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                            {h.attachments.map((a, ai) => {
                              const isImg = (a?.type || '').startsWith('image/');
                              return (
                                <a
                                  key={ai}
                                  href={a.dataUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={a.name}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '2px 6px', background: '#0a0a14',
                                    border: '1px solid #444', borderRadius: '3px',
                                    fontSize: '10px', color: '#d8b88a', textDecoration: 'none',
                                  }}
                                >
                                  {isImg
                                    ? <img src={a.dataUrl} alt={a.name} style={{ maxHeight: '28px', maxWidth: '44px', display: 'block' }} />
                                    : <span style={{ color: '#8ab4f8' }}>📎</span>}
                                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {a.name}
                                  </span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {Array.isArray(bug.engineTrace) && bug.engineTrace.length > 0 && (
                <details style={{
                  marginTop: '6px', padding: '4px 8px',
                  borderLeft: '2px solid #8ab4f8',
                  backgroundColor: 'rgba(138, 180, 248, 0.05)',
                }}>
                  <summary style={{
                    cursor: 'pointer', color: '#8ab4f8', fontSize: '11px',
                  }}>
                    Recent engine trace ({bug.engineTrace.length})
                  </summary>
                  <div style={{
                    marginTop: '4px', maxHeight: '160px', overflow: 'auto',
                    fontFamily: 'monospace', fontSize: '10px', color: '#c8d4e8',
                  }}>
                    {bug.engineTrace.map((t, idx) => (
                      <div key={idx} style={{
                        padding: '2px 0',
                        borderTop: idx > 0 ? '1px dotted #333' : 'none',
                      }}>
                        <span style={{ color: '#666' }}>
                          {(t.at || '').slice(11, 19)}
                        </span>
                        <span style={{ color: '#8ab4f8', marginLeft: '6px' }}>
                          {t.tag}
                        </span>
                        {t.detail && (
                          <span style={{ color: '#888', marginLeft: '6px' }}>
                            {(() => {
                              try {
                                const s = JSON.stringify(t.detail);
                                return s.length > 120 ? s.slice(0, 120) + '…' : s;
                              } catch { return ''; }
                            })()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {editingId === bug.id && (
                <div style={{
                  marginTop: '8px', padding: '8px',
                  border: '1px solid #ffd700', borderRadius: '4px',
                  backgroundColor: 'rgba(255, 215, 0, 0.06)',
                }}>
                  <div style={{ color: '#ffe066', fontSize: '11px', marginBottom: '4px' }}>
                    Edit entry (writes through to claude-notes.md):
                  </div>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={Math.min(12, Math.max(4, (editDraft.match(/\n/g) || []).length + 2))}
                    autoFocus
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      backgroundColor: '#0a0a14', color: '#e6e6e6',
                      border: '1px solid #444', borderRadius: '3px',
                      padding: '6px', fontSize: '12px',
                      fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />
                  <div style={{
                    display: 'flex', gap: '8px', marginTop: '6px',
                    alignItems: 'center', flexWrap: 'wrap',
                  }}>
                    <span style={{ color: '#888', fontSize: '11px' }}>Kind:</span>
                    {KINDS.map((k) => (
                      <button
                        key={k}
                        onClick={() => setEditKind(k)}
                        style={{
                          ...styles.buttonGhost, padding: '2px 8px', fontSize: '11px',
                          color: editKind === k ? '#ffd700' : '#888',
                          borderColor: editKind === k ? '#ffd700' : '#333',
                        }}
                      >
                        {k}
                      </button>
                    ))}
                    {editKind === 'bug' && (
                      <>
                        <span style={{ color: '#888', fontSize: '11px', marginLeft: '6px' }}>
                          Severity:
                        </span>
                        {SEVERITIES.map((s) => (
                          <button
                            key={s}
                            onClick={() => setEditSeverity(s)}
                            style={{
                              ...styles.buttonGhost, padding: '2px 8px', fontSize: '11px',
                              color: editSeverity === s ? sevColor(s) : '#888',
                              borderColor: editSeverity === s ? sevColor(s) : '#333',
                            }}
                          >
                            {s}
                          </button>
                        ))}
                      </>
                    )}
                    <span style={{ flex: 1 }} />
                    <button
                      style={{ ...styles.buttonGhost, padding: '4px 10px' }}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                    <button
                      style={{
                        ...styles.buttonGhost, padding: '4px 10px',
                        color: '#ffd700', borderColor: '#ffd700',
                      }}
                      onClick={() => confirmEdit(bug.id)}
                      disabled={!editDraft.trim()}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
              {reopeningId === bug.id && (
                <div style={{
                  marginTop: '8px', padding: '8px',
                  border: '1px solid #ffaa00', borderRadius: '4px',
                  backgroundColor: 'rgba(255, 170, 0, 0.06)',
                }}>
                  <div style={{ color: '#ffc766', fontSize: '11px', marginBottom: '4px' }}>
                    Reopen comment (optional — tell Claude why it's coming back):
                  </div>
                  <textarea
                    value={reopenDraft}
                    onChange={(e) => setReopenDraft(e.target.value)}
                    onPaste={onReopenPasteCapture}
                    rows={3}
                    autoFocus
                    placeholder="e.g. Fix applied but the check still used 1d20+rank instead of 1d20+rank+ability. Paste a screenshot here or use Add files."
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      backgroundColor: '#0a0a14', color: '#e6e6e6',
                      border: '1px solid #444', borderRadius: '3px',
                      padding: '6px', fontSize: '11px',
                      fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />

                  {/* #47 (note) — attachments: paste, pick, or drop on the textarea. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <input
                      ref={reopenFileInputRef}
                      type="file"
                      multiple
                      accept="image/*,application/pdf,text/*"
                      style={{ display: 'none' }}
                      onChange={(e) => addReopenFiles(e.target.files)}
                    />
                    <button
                      style={{ ...styles.buttonGhost, padding: '4px 10px' }}
                      onClick={() => reopenFileInputRef.current?.click()}
                      type="button"
                    >
                      Add files
                    </button>
                    <span style={{ color: '#8a8a8a', fontSize: '10px' }}>
                      or paste a screenshot into the box above
                    </span>
                    {reopenAttachError && (
                      <span style={{ color: '#ff6b6b', fontSize: '10px' }}>
                        {reopenAttachError}
                      </span>
                    )}
                  </div>

                  {reopenAttachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {reopenAttachments.map((a, i) => {
                        const isImg = (a.type || '').startsWith('image/');
                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '3px 6px',
                            background: '#0a0a14', border: '1px solid #444',
                            borderRadius: '3px', fontSize: '10px', color: '#d8b88a',
                          }}>
                            {isImg
                              ? <img src={a.dataUrl} alt={a.name} style={{ maxHeight: '32px', maxWidth: '48px', display: 'block' }} />
                              : <span style={{ color: '#8ab4f8' }}>📎</span>}
                            <span title={a.name} style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeReopenAttachment(i)}
                              title="Remove attachment"
                              style={{ background: 'transparent', border: 'none', color: '#8a8a8a', cursor: 'pointer', fontSize: '11px' }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
                    <button
                      style={{ ...styles.buttonGhost, padding: '4px 10px' }}
                      onClick={cancelReopen}
                    >
                      Cancel
                    </button>
                    <button
                      style={{
                        ...styles.buttonGhost, padding: '4px 10px',
                        color: '#ffaa00', borderColor: '#ffaa00',
                      }}
                      onClick={() => confirmReopen(bug.id)}
                    >
                      Reopen
                    </button>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>

        <div style={styles.actionRow}>
          <button style={styles.button} onClick={onClose}>Close</button>
        </div>
    </DraggableWindow>
  );
}
            