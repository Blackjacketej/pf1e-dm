/**
 * eventsToLog — severity passthrough + type-map fallback.
 *
 * Regression guard: prior to 2026-04-17 the consumer ignored the per-event
 * `severity` field and used only the category `typeMap`, so a caller that
 * marked a light-out event as severity:'danger' was silently downgraded to
 * 'warning' (typeMap['light']). This suite pins the passthrough contract.
 *
 * Run: node eventsToLog.test.mjs
 */
import { eventsToLog } from './src/services/gameEventEngine.js';

let passed = 0;
let failed = 0;
const fails = [];
function assert(cond, label) {
  if (cond) { passed++; return; }
  failed++;
  fails.push(label);
  console.error('  ✗', label);
}
function section(name, fn) {
  console.log(`\n── ${name} ──`);
  fn();
}

section('severity passthrough overrides typeMap', () => {
  // typeMap['light'] === 'warning', but severity:'danger' must win
  const [r] = eventsToLog([{ type: 'light', text: 'All lights out!', severity: 'danger' }]);
  assert(r.type === 'danger', 'light/danger passes through as danger (not downgraded to warning)');
  assert(r.text === 'All lights out!', 'text preserved');

  // typeMap['visibility'] === 'warning'; a neutral report should not dye as warning
  const [r2] = eventsToLog([{ type: 'visibility', text: 'Party has darkvision', severity: 'info' }]);
  assert(r2.type === 'info', 'visibility/info passes through (not forced to warning)');

  // typeMap['reputation'] === 'info'; a positive fame event should elevate to success
  const [r3] = eventsToLog([{ type: 'reputation', text: 'Revered', severity: 'success' }]);
  assert(r3.type === 'success', 'reputation/success passes through (not flattened to info)');
});

section('typeMap fallback when severity absent', () => {
  const [r] = eventsToLog([{ type: 'encounter', text: 'Wolves!' }]);
  assert(r.type === 'danger', 'no severity → typeMap[encounter] = danger');

  const [r2] = eventsToLog([{ type: 'rations', text: 'Ate rations' }]);
  assert(r2.type === 'info', 'no severity → typeMap[rations] = info');

  const [r3] = eventsToLog([{ type: 'levelup', text: 'Ding!' }]);
  assert(r3.type === 'success', 'no severity → typeMap[levelup] = success');
});

section('unknown type + missing severity → info default', () => {
  const [r] = eventsToLog([{ type: 'not-a-real-type', text: '?' }]);
  assert(r.type === 'info', 'unknown type falls to info');
});

section('invalid severity is rejected (falls to typeMap)', () => {
  // A caller that mistypes a severity ('critical-oops') should not leak an
  // invalid log type into the rendered stream; we want the typeMap fallback.
  const [r] = eventsToLog([{ type: 'encounter', text: 'Wolves', severity: 'nonsense-value' }]);
  assert(r.type === 'danger', 'invalid severity → typeMap[encounter] = danger');
});

section('empty input', () => {
  assert(JSON.stringify(eventsToLog([])) === '[]', 'empty array in → empty array out');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  fails.forEach(f => console.error('  -', f));
  process.exit(1);
}
