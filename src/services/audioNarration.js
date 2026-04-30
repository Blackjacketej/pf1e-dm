// Bug #4 — Audio narration service.
//
// Minimal first slice per operator autonomy pattern (cf. #45/#46 resolutions):
// ship a recommended-default baseline, leave follow-up UX decisions for later.
//
// SCOPE: Toggle-able text-to-speech for new `narration` / `success` / `journal`
// log entries using the browser-native Web Speech API (window.speechSynthesis).
// No external TTS provider — zero API keys, zero cost, works offline.
//
// PARKED (requires operator decisions on next pass):
//   - Per-character voice mapping ("voice actors for characters" from the note).
//     Needs a voice-picker UI and a character→voice assignment persisted on
//     the character record. Default voice works fine for single-narrator MVP.
//   - External higher-quality TTS (ElevenLabs / OpenAI / Google Cloud).
//     Trades free+offline for better voices + API key management.
//   - Per-log-type speak gating (e.g. speak narration but not system messages).
//     Current behaviour: speak `narration`, `success`, `journal`; skip system /
//     danger / loot / event (too spammy) — revisit with operator.
//   - Playback controls (skip, queue view, volume slider, rate/pitch sliders).
//     Currently: toggle on/off + cancel-on-disable. Rate/pitch use neutral
//     defaults (1.0 / 1.0 / 1.0 volume).
//
// CROSS-REFERENCES:
//   - App.jsx wires a gameLog-watcher useEffect that calls speakLogEntry().
//   - Header toggle button flips isEnabled(); disabling cancels any in-flight
//     utterance so the voice doesn't keep reading after the user silences it.
//   - localStorage key 'pf-audio-narration-enabled' persists the toggle.

const STORAGE_KEY = 'pf-audio-narration-enabled';

// Log-entry types that are read aloud when narration is on.
const SPEAKABLE_TYPES = new Set(['narration', 'success', 'journal']);

// Narration voice/prosody defaults. Kept conservative; future follow-up will
// expose per-character overrides and a settings panel.
const DEFAULTS = Object.freeze({
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
});

// ── Runtime state ─────────────────────────────────────────────────────────

let enabled = false;
let initialised = false;

// Subscriber set for the toggle's enabled state so UI can re-render without
// prop-drilling. Same pattern as undoBuffer.subscribeUndoDepth.
const subscribers = new Set();

// Track the id of the last log entry we spoke so a state-restore that replays
// the gameLog doesn't re-speak everything from the start. App.jsx seeds this
// when the user enables narration — only entries appended AFTER enable speak.
let lastSpokenId = null;

function hasSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

function loadPersistedEnabled() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === '1' || raw === 'true';
  } catch { return false; }
}

function persistEnabled(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch { /* noop */ }
}

function notify() {
  for (const fn of subscribers) {
    try { fn(enabled); } catch (err) { console.warn('[audioNarration] subscriber threw:', err); }
  }
}

function ensureInit() {
  if (initialised) return;
  initialised = true;
  if (typeof window === 'undefined') return;
  enabled = loadPersistedEnabled();
  // Some browsers load voices asynchronously; warm the list so speak() hits
  // a populated list on first use. Best-effort; ignore failures.
  try {
    if (hasSpeechSynthesis()) window.speechSynthesis.getVoices();
  } catch { /* noop */ }
}

// ── Public API ────────────────────────────────────────────────────────────

export function isSupported() {
  return hasSpeechSynthesis();
}

export function isEnabled() {
  ensureInit();
  return enabled && hasSpeechSynthesis();
}

export function setEnabled(value) {
  ensureInit();
  const next = !!value;
  if (next === enabled) return enabled;
  enabled = next;
  persistEnabled(enabled);
  if (!enabled) {
    cancel();
  }
  notify();
  return enabled;
}

export function toggle() {
  ensureInit();
  return setEnabled(!enabled);
}

export function subscribe(fn) {
  ensureInit();
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  // Fire once on subscribe so the caller gets current state without a
  // separate isEnabled() call. Same pattern as subscribeUndoDepth.
  try { fn(enabled); } catch { /* noop */ }
  return () => { subscribers.delete(fn); };
}

// Strip markdown-ish punctuation and spoken-awkward characters before speech
// so utterances read cleanly. Intentionally conservative — we don't want to
// strip meaningful punctuation (commas, periods, em-dashes, question marks).
export function sanitizeForSpeech(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[*_`~]+/g, '')            // markdown emphasis / code ticks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [label](url) → label
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text) {
  ensureInit();
  if (!enabled || !hasSpeechSynthesis()) return false;
  const clean = sanitizeForSpeech(text);
  if (!clean) return false;
  try {
    const u = new window.SpeechSynthesisUtterance(clean);
    u.rate = DEFAULTS.rate;
    u.pitch = DEFAULTS.pitch;
    u.volume = DEFAULTS.volume;
    window.speechSynthesis.speak(u);
    return true;
  } catch (err) {
    console.warn('[audioNarration] speak failed:', err);
    return false;
  }
}

export function cancel() {
  if (!hasSpeechSynthesis()) return;
  try { window.speechSynthesis.cancel(); } catch { /* noop */ }
}

// Speak a single gameLog entry if narration is on and the entry's type is
// in the speak-list. Returns true if the entry was spoken. App.jsx calls
// this from a useEffect that tracks the last gameLog entry's id so the same
// entry is never spoken twice (guard for state-restore replay).
export function speakLogEntry(entry) {
  if (!entry || !isEnabled()) return false;
  if (!SPEAKABLE_TYPES.has(entry.type)) return false;
  if (entry.id && entry.id === lastSpokenId) return false;
  if (entry.id) lastSpokenId = entry.id;
  return speak(entry.text);
}

// Seed lastSpokenId without actually speaking — used by the App.jsx wire-up
// on enable so the NEXT appended narration is the first thing to speak,
// not the whole recent gameLog getting read aloud on toggle.
export function seedLastSpoken(entry) {
  if (entry && entry.id) {
    lastSpokenId = entry.id;
  } else {
    lastSpokenId = null;
  }
}

export function _resetForTests() {
  enabled = false;
  initialised = false;
  lastSpokenId = null;
  subscribers.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export default {
  isSupported,
  isEnabled,
  setEnabled,
  toggle,
  subscribe,
  speak,
  cancel,
  speakLogEntry,
  seedLastSpoken,
  sanitizeForSpeech,
};
