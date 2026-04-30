// Unit tests for undoBuffer (bug #35).
// Covers: push/pop FIFO, 5-depth cap, deep-clone isolation, subscriber
// notifications, clearUndoBuffer idempotency.
// Run with: node undoBuffer.test.mjs

import {
  pushUndoSnapshot,
  popUndoSnapshot,
  peekUndoDepth,
  clearUndoBuffer,
  subscribeUndoDepth,
  UNDO_MAX_DEPTH,
} from './src/services/undoBuffer.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', label); }
}

// Clean slate between test blocks. (The module is shared module state.)
const resetBuffer = () => clearUndoBuffer();

// ── T1: MAX_DEPTH exported and equals 5 ──
{
  assert(UNDO_MAX_DEPTH === 5, 'T1: UNDO_MAX_DEPTH exports 5');
}

// ── T2: empty buffer peeks 0, pop returns null ──
{
  resetBuffer();
  assert(peekUndoDepth() === 0, 'T2a: empty buffer reports depth 0');
  assert(popUndoSnapshot() === null, 'T2b: empty pop returns null');
}

// ── T3: push increments depth, pop decrements ──
{
  resetBuffer();
  pushUndoSnapshot({ party: [{ name: 'A' }] });
  assert(peekUndoDepth() === 1, 'T3a: one push → depth 1');
  pushUndoSnapshot({ party: [{ name: 'B' }] });
  assert(peekUndoDepth() === 2, 'T3b: two pushes → depth 2');
  const top = popUndoSnapshot();
  assert(top?.party?.[0]?.name === 'B', 'T3c: LIFO — pop returns most recent');
  assert(peekUndoDepth() === 1, 'T3d: pop decrements depth');
}

// ── T4: ring buffer capped at 5, oldest evicted ──
{
  resetBuffer();
  for (let i = 0; i < 8; i++) {
    pushUndoSnapshot({ party: [{ name: `step-${i}` }] });
  }
  assert(peekUndoDepth() === 5, 'T4a: buffer caps at 5 entries');
  // Pop all five — oldest remaining should be step-3 (step-0/1/2 evicted)
  const last = popUndoSnapshot(); // step-7
  assert(last?.party?.[0]?.name === 'step-7', 'T4b: most recent is step-7');
  for (let i = 0; i < 3; i++) popUndoSnapshot();
  const oldest = popUndoSnapshot(); // step-3
  assert(oldest?.party?.[0]?.name === 'step-3', 'T4c: oldest survivor is step-3 (0/1/2 evicted)');
  assert(peekUndoDepth() === 0, 'T4d: buffer drained');
}

// ── T5: snapshot is deep-cloned (mutating the original doesn't leak) ──
{
  resetBuffer();
  const original = { party: [{ name: 'Original', hp: 10 }], gameLog: [{ text: 'before' }] };
  pushUndoSnapshot(original);
  // Mutate the source
  original.party[0].hp = 99;
  original.party[0].name = 'Mutated';
  original.gameLog.push({ text: 'after' });
  const snap = popUndoSnapshot();
  assert(snap.party[0].name === 'Original', 'T5a: party name preserved against external mutation');
  assert(snap.party[0].hp === 10, 'T5b: party hp preserved');
  assert(snap.gameLog.length === 1, 'T5c: gameLog length preserved');
}

// ── T6: subscribers fire once on subscribe + on each mutation ──
{
  resetBuffer();
  const calls = [];
  const unsub = subscribeUndoDepth((d) => calls.push(d));
  // Initial fire
  assert(calls[0] === 0, 'T6a: subscriber fires once on subscribe with current depth');
  pushUndoSnapshot({ party: [] });
  assert(calls.at(-1) === 1, 'T6b: subscriber notified on push');
  popUndoSnapshot();
  assert(calls.at(-1) === 0, 'T6c: subscriber notified on pop');
  unsub();
  pushUndoSnapshot({ party: [] });
  assert(calls.at(-1) === 0, 'T6d: subscriber silent after unsubscribe');
  resetBuffer();
}

// ── T7: clear drops everything in one shot ──
{
  resetBuffer();
  pushUndoSnapshot({ party: [{ name: '1' }] });
  pushUndoSnapshot({ party: [{ name: '2' }] });
  pushUndoSnapshot({ party: [{ name: '3' }] });
  clearUndoBuffer();
  assert(peekUndoDepth() === 0, 'T7a: clearUndoBuffer drops all entries');
}

// ── T8: pushUndoSnapshot with non-object arg is a no-op ──
{
  resetBuffer();
  pushUndoSnapshot(null);
  pushUndoSnapshot(undefined);
  pushUndoSnapshot('oops');
  pushUndoSnapshot(42);
  assert(peekUndoDepth() === 0, 'T8: non-object pushes are no-ops');
}

// ── T9: label passthrough for engine trace / debug ──
{
  resetBuffer();
  pushUndoSnapshot({ party: [], label: 'action: look at the door' });
  const snap = popUndoSnapshot();
  assert(snap.label === 'action: look at the door', 'T9: label passthrough');
}

// ── T10: capturedAt stamp present ──
{
  resetBuffer();
  pushUndoSnapshot({ party: [] });
  const snap = popUndoSnapshot();
  assert(typeof snap.capturedAt === 'string' && snap.capturedAt.length > 0, 'T10: capturedAt stamped');
}

// ── T11: missing slices default to sensible empties ──
{
  resetBuffer();
  pushUndoSnapshot({}); // empty but non-null object
  const snap = popUndoSnapshot();
  assert(Array.isArray(snap.party) && snap.party.length === 0, 'T11a: missing party → []');
  assert(Array.isArray(snap.gameLog) && snap.gameLog.length === 0, 'T11b: missing gameLog → []');
  assert(snap.adventure === null, 'T11c: missing adventure → null');
  assert(snap.combat === null, 'T11d: missing combat → null');
  assert(typeof snap.worldState === 'object' && snap.worldState !== null, 'T11e: missing worldState → {}');
}

console.log(`\nundoBuffer: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
