/**
 * generateNPC smoke + TDZ regression tests.
 *
 * Run with: npx vite-node generateNPC.test.mjs
 *
 * Motivation (2026-04-18, task #49): the `bond` variable inside
 * `generateNPC` was once declared ~60 lines BELOW its first use in the
 * `famFlavorText` IIFE, causing every call to throw `ReferenceError:
 * Cannot access 'bond' before initialization` via the temporal dead zone.
 * The error was swallowed by `try/catch` in AdventureTab.processNewEntities
 * so the bug hid for WEEKS — `nearbyNPCs` stayed empty with only a
 * console.warn trace nobody was watching.
 *
 * These tests are cheap insurance: any future reordering / rewrite that
 * reintroduces a TDZ-shaped hazard will trip T1 or T4 immediately.
 *
 * The test is an ESM module — vite-node resolves the Dexie + data-file
 * imports npcTracker pulls in. Standalone `node` cannot run it.
 */

import { generateNPC } from './src/services/npcTracker.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', label); }
}

// ── T1: TDZ regression — bare call with no options ────────────────────
{
  let threw = null;
  let npc = null;
  try {
    npc = generateNPC();
  } catch (err) {
    threw = err;
  }
  assert(threw === null, `T1a: generateNPC() must not throw (got: ${threw?.message || threw})`);
  assert(npc && typeof npc === 'object', 'T1b: returns an object');
  assert(typeof npc?.name === 'string' && npc.name.length > 0, 'T1c: populates a name');
  assert(typeof npc?.class === 'string', 'T1d: populates a class');
  assert(Number.isFinite(npc?.hp) && npc.hp > 0, 'T1e: populates positive HP');
}

// ── T2: Named NPC path (Tom's live-session reproducer) ────────────────
{
  let threw = null;
  let npc = null;
  try {
    npc = generateNPC({ name: 'Bertha Cray' });
  } catch (err) {
    threw = err;
  }
  assert(threw === null, `T2a: generateNPC({name}) must not throw (got: ${threw?.message || threw})`);
  assert(npc?.name === 'Bertha Cray', 'T2b: preserves operator-supplied name');
}

// ── T3: Presence option plumbed through without error ─────────────────
// Bug #58 introduced `presence: 'here' | 'elsewhere' | 'historical'`.
// Guard against a regression where an unknown presence value trips a
// defaulting path.
{
  for (const presence of ['here', 'elsewhere', 'historical', undefined, null, 'garbage']) {
    let threw = null;
    try {
      generateNPC({ name: 'Test', presence });
    } catch (err) {
      threw = err;
    }
    assert(threw === null, `T3[${String(presence)}]: accepts presence=${String(presence)} without throwing`);
  }
}

// ── T4: Wizard / Witch paths — the CLASS-specific TDZ trigger ─────────
// The original TDZ bug was triggered whenever `famFlavorText`'s IIFE
// read `bond.familiar?.id`, which happens for every call regardless of
// class (the IIFE just returns '' for non-casters). Still, explicitly
// hitting the Wizard + Witch branches proves the familiar hydration
// path itself is wired end-to-end.
{
  for (const npcClass of ['Wizard', 'Witch', 'Sorcerer', 'Fighter', 'Commoner']) {
    let threw = null;
    let npc = null;
    try {
      npc = generateNPC({ name: 'Cordell', class: npcClass, level: 3 });
    } catch (err) {
      threw = err;
    }
    assert(threw === null, `T4[${npcClass}]: class-specific generation must not throw (got: ${threw?.message || threw})`);
    assert(npc?.class === npcClass, `T4[${npcClass}]: class preserved`);
  }
}

// ── T5: Repeated calls — stress the RNG + ensure no shared mutable bug ─
{
  let threw = null;
  const names = new Set();
  try {
    for (let i = 0; i < 20; i++) {
      const npc = generateNPC();
      names.add(npc?.name || '');
    }
  } catch (err) {
    threw = err;
  }
  assert(threw === null, `T5a: 20 repeated calls must not throw (got: ${threw?.message || threw})`);
  assert(names.size > 1, 'T5b: random name pool produces more than one distinct result');
}

console.log(`\ngenerateNPC: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
