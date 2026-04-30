// Bug #4 — audioNarration service smoke tests.
//
// The service wraps window.speechSynthesis, so we stub that globally before
// importing the module. Covers toggle, persistence, subscriber fire, sanitize,
// log-entry dedupe, and isSupported() null-safety when SpeechSynthesis is
// unavailable.

import assert from 'node:assert/strict';

// ── Minimal window / localStorage / SpeechSynthesis stubs ────────────────
const spoken = [];
const localStoreBacking = new Map();

globalThis.localStorage = {
  getItem: (k) => (localStoreBacking.has(k) ? localStoreBacking.get(k) : null),
  setItem: (k, v) => { localStoreBacking.set(k, String(v)); },
  removeItem: (k) => { localStoreBacking.delete(k); },
  clear: () => { localStoreBacking.clear(); },
};

class FakeUtterance {
  constructor(text) { this.text = text; }
}

globalThis.window = {
  speechSynthesis: {
    speak: (u) => { spoken.push(u.text); },
    cancel: () => {},
    getVoices: () => [],
  },
  SpeechSynthesisUtterance: FakeUtterance,
  localStorage: globalThis.localStorage,
};

const audioNarration = (await import('./src/services/audioNarration.js')).default;

let assertions = 0;
const ok = (cond, msg) => { assert(cond, msg); assertions++; };

// ── isSupported() ────────────────────────────────────────────────────────
ok(audioNarration.isSupported() === true, 'isSupported returns true when window.speechSynthesis is present');

// ── default enabled state is false ───────────────────────────────────────
audioNarration._resetForTests?.();
ok(audioNarration.isEnabled() === false, 'isEnabled defaults to false with no persisted value');

// ── toggle flips state, persists, and speak() works only when on ─────────
spoken.length = 0;
audioNarration.toggle();
ok(audioNarration.isEnabled() === true, 'toggle turns narration on');
ok(localStoreBacking.get('pf-audio-narration-enabled') === '1', 'toggle persists enabled=1');

audioNarration.speak('hello world');
ok(spoken.length === 1 && spoken[0] === 'hello world', 'speak reaches speechSynthesis when enabled');

audioNarration.setEnabled(false);
ok(audioNarration.isEnabled() === false, 'setEnabled(false) disables');
ok(localStoreBacking.get('pf-audio-narration-enabled') === '0', 'setEnabled(false) persists =0');

audioNarration.speak('muted speech');
ok(spoken.length === 1, 'speak no-ops when disabled');

// ── sanitizeForSpeech strips markdown noise but preserves punctuation ────
const clean = audioNarration.sanitizeForSpeech('**bold** and _italic_ and `code` — em-dash.');
ok(clean === 'bold and italic and code — em-dash.', 'sanitize strips markdown, keeps punctuation');

const linkStripped = audioNarration.sanitizeForSpeech('see [the docs](https://example.com) now');
ok(linkStripped === 'see the docs now', 'sanitize replaces [label](url) with label');

ok(audioNarration.sanitizeForSpeech('') === '', 'sanitize handles empty');
ok(audioNarration.sanitizeForSpeech(null) === '', 'sanitize handles null');

// ── subscriber fires on subscribe and on toggle ─────────────────────────
let received = [];
const unsub = audioNarration.subscribe((v) => received.push(v));
ok(received.length === 1 && received[0] === false, 'subscriber fires once on subscribe with current state');
audioNarration.toggle();
ok(received.length === 2 && received[1] === true, 'subscriber fires on toggle');
unsub();
audioNarration.toggle();
ok(received.length === 2, 'unsubscribed listener does not fire again');

// ── speakLogEntry dedupes on entry.id ────────────────────────────────────
audioNarration.setEnabled(true);
spoken.length = 0;
const entry = { id: 'log-1', text: 'The tavern is warm.', type: 'narration' };
audioNarration.speakLogEntry(entry);
audioNarration.speakLogEntry(entry); // same id — should not re-speak
ok(spoken.length === 1, 'speakLogEntry dedupes on id');

// ── speakLogEntry skips non-speakable types ──────────────────────────────
spoken.length = 0;
audioNarration.speakLogEntry({ id: 'log-2', text: 'system msg', type: 'system' });
audioNarration.speakLogEntry({ id: 'log-3', text: 'loot!', type: 'loot' });
ok(spoken.length === 0, 'speakLogEntry skips system/loot types');
audioNarration.speakLogEntry({ id: 'log-4', text: 'success!', type: 'success' });
ok(spoken.length === 1, 'speakLogEntry speaks success type');

// ── seedLastSpoken suppresses the next speak of that id ──────────────────
spoken.length = 0;
const seed = { id: 'log-5', text: 'baseline', type: 'narration' };
audioNarration.seedLastSpoken(seed);
audioNarration.speakLogEntry(seed);
ok(spoken.length === 0, 'seedLastSpoken prevents the seeded entry from being spoken');
audioNarration.speakLogEntry({ id: 'log-6', text: 'next', type: 'narration' });
ok(spoken.length === 1 && spoken[0] === 'next', 'subsequent entry speaks normally after seed');

// ── persistence round-trips ──────────────────────────────────────────────
audioNarration.setEnabled(true);
audioNarration._resetForTests?.();                  // wipe in-memory but also the key
localStoreBacking.set('pf-audio-narration-enabled', '1'); // simulate persisted on from a prior session
ok(audioNarration.isEnabled() === true, 'isEnabled picks up persisted =1 on first call');

console.log(`audioNarration tests: ${assertions} assertions passed`);
