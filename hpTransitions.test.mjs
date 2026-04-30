/**
 * hpTransitions — HP bucket classification + NWN-style state-crossing lines.
 *
 * Run: npx vite-node hpTransitions.test.mjs
 */
import { hpBucket, formatHpTransition } from './src/services/hpTransitions.js';

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

// ──────────────────────────────────────────────────────
// hpBucket
// ──────────────────────────────────────────────────────
section('hpBucket — PF1e semantics', () => {
  // healthy: HP > 50% max
  assert(hpBucket(20, 30, 12) === 'healthy', '20/30 (>50%) → healthy');
  assert(hpBucket(16, 30, 12) === 'healthy', '16/30 (~53%) → healthy');
  assert(hpBucket(30, 30, 12) === 'healthy', 'full HP → healthy');

  // bloodied: 0 < HP ≤ 50% max
  assert(hpBucket(15, 30, 12) === 'bloodied', '15/30 (exactly half) → bloodied');
  assert(hpBucket(1, 30, 12) === 'bloodied', '1 HP → bloodied');
  assert(hpBucket(5, 30, 12) === 'bloodied', 'low positive HP → bloodied');

  // disabled: HP === 0 (PF1e: staggered, standard OR move action)
  assert(hpBucket(0, 30, 12) === 'disabled', '0 HP → disabled');

  // dying: HP < 0 && HP > -CON
  assert(hpBucket(-1, 30, 12) === 'dying', '-1 HP, CON 12 → dying');
  assert(hpBucket(-11, 30, 12) === 'dying', '-11 HP, CON 12 → dying');

  // dead: HP <= -CON
  assert(hpBucket(-12, 30, 12) === 'dead', '-12 HP, CON 12 → dead (boundary)');
  assert(hpBucket(-20, 30, 12) === 'dead', '-20 HP, CON 12 → dead');

  // edge: CON default (10) when unset
  assert(hpBucket(-10, 30) === 'dead', 'CON defaults to 10 → -10 dead');
  assert(hpBucket(-9, 30) === 'dying', 'CON defaults to 10 → -9 dying');

  // edge: negative CON treated as positive (|con|)
  assert(hpBucket(-12, 30, -12) === 'dead', 'negative CON → abs applied');

  // edge: effMax=0 or missing → treats half as 1
  assert(hpBucket(1, 0, 10) === 'bloodied', 'effMax 0 guard → bloodied at 1 HP');
  assert(hpBucket(2, 0, 10) === 'healthy', 'effMax 0 guard → healthy at 2 HP');
});

// ──────────────────────────────────────────────────────
// formatHpTransition
// ──────────────────────────────────────────────────────
section('formatHpTransition — worsening crossings', () => {
  const t1 = formatHpTransition('Kyra', 'healthy', 'bloodied');
  assert(t1?.type === 'warning' && t1.text.includes('bloodied'), 'healthy→bloodied → warning bloodied line');

  const t2 = formatHpTransition('Kyra', 'bloodied', 'disabled');
  assert(t2?.type === 'danger' && t2.text.includes('unconscious'), 'bloodied→disabled → danger unconscious line');

  const t3 = formatHpTransition('Kyra', 'disabled', 'dying');
  assert(t3?.type === 'danger' && t3.text.includes('dying'), 'disabled→dying → danger dying line');

  const t4 = formatHpTransition('Kyra', 'dying', 'dead');
  assert(t4?.type === 'danger' && t4.text.toLowerCase().includes('perish'), 'dying→dead → danger perished line');

  // skip-ahead worsening: healthy→dying (big hit) still produces the "dying" line
  const t5 = formatHpTransition('Kyra', 'healthy', 'dying');
  assert(t5?.type === 'danger', 'healthy→dying (skip) still worsens');
});

section('formatHpTransition — recovering crossings', () => {
  const r1 = formatHpTransition('Kyra', 'bloodied', 'healthy');
  assert(r1?.type === 'success' && r1.text.toLowerCase().includes('feet'), 'bloodied→healthy → success back-on-feet');

  const r2 = formatHpTransition('Kyra', 'dying', 'healthy');
  assert(r2?.type === 'success' && r2.text.toLowerCase().includes('stabilized'),
    'dying→healthy → success stabilized+conscious');

  const r3 = formatHpTransition('Kyra', 'dying', 'bloodied');
  assert(r3?.type === 'success' && r3.text.toLowerCase().includes('stabilized'),
    'dying→bloodied → success stabilized-in-fight');

  const r4 = formatHpTransition('Kyra', 'dying', 'disabled');
  assert(r4?.type === 'success' && r4.text.includes('0 HP'),
    'dying→disabled → success stabilized-at-0-HP');
});

section('formatHpTransition — no-op and guards', () => {
  assert(formatHpTransition('Kyra', 'healthy', 'healthy') === null,
    'same bucket returns null (no line)');
  assert(formatHpTransition('', 'healthy', 'bloodied') === null, 'missing name returns null');
  assert(formatHpTransition('Kyra', null, 'bloodied') === null, 'missing prev bucket returns null');
  assert(formatHpTransition('Kyra', 'healthy', null) === null, 'missing new bucket returns null');

  // dead → dying (resurrection-ish) returns null rather than inventing a line
  assert(formatHpTransition('Kyra', 'dead', 'dying') === null,
    'recovering from dead → dying suppressed (DM-fiat / resurrection — stay quiet)');
});

// ──────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:');
  fails.forEach(f => console.error('  -', f));
  process.exit(1);
}
