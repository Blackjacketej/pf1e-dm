// campaignStartPath.test.mjs — Bug #39 (2026-04-17) coverage.
//
// Verifies that `migrateAdventureToWorldTree` honors an optional
// `opts.startPath` — an ordered list of node names — and uses it verbatim
// as the active party's currentPath, overriding the defaultEntry cascade.
//
// Motivation: Rise of the Runelords opens at the Swallowtail Festival in
// Sandpoint's Market Square, NOT the town's generic Main Road hub. The
// startPath field on campaign data lets the migration plant the party at
// the canonical opener on a fresh campaign start.
//
// Run: npx vite-node campaignStartPath.test.mjs

import { migrateAdventureToWorldTree } from './src/services/worldTreeMigration.js';

let passed = 0;
let failed = 0;
const fails = [];

function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`\u2713 ${name}`);
  } catch (err) {
    failed += 1;
    fails.push({ name, err });
    console.error(`\u2717 ${name}\n  ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'expected equal'}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// ─────────────────────────── minimal adventure fixture ───────────────────────
// The migration auto-seeds a full Golarion tree when the adventure has no
// worldTree yet. We provide an adventure record with a `location` object so
// migration finds Sandpoint in the seed and runs the full currentPath build.

function makeFreshAdventure(locationName = 'Sandpoint', type = 'town') {
  return {
    active: true,
    type,
    location: { name: locationName, desc: '', terrain: type },
    parties: null,
    worldTree: null,
  };
}

// ─────────────────────────── T1: startPath verbatim override ─────────────────

t('T1 — startPath lands party at Market Square (canonical RotR opener)', () => {
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, {
    memberIds: ['c1'],
    startPath: ['Golarion', 'Avistan', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Market Square'],
  });
  assert(patch, 'migration should produce a patch on first run');
  const path = patch.parties.main.currentPath;
  assert(Array.isArray(path) && path.length === 6,
    `expected 6-deep path, got ${path?.length}: ${JSON.stringify(path)}`);
  const leaf = patch.worldTree.nodes[path[path.length - 1]];
  assertEq((leaf?.name || '').toLowerCase(), 'market square',
    'leaf node should be Market Square');
});

t('T1b — startPath override means no Main Road cascade', () => {
  // Without startPath, Sandpoint's defaultEntry='Main Road' would add Main
  // Road as the leaf. With startPath ending at Market Square, the cascade
  // should NOT run (Market Square is the explicit leaf).
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, {
    memberIds: ['c1'],
    startPath: ['Golarion', 'Avistan', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Market Square'],
  });
  const path = patch.parties.main.currentPath;
  const names = path.map(id => patch.worldTree.nodes[id].name.toLowerCase());
  assert(!names.includes('main road'),
    `startPath should NOT trigger Main Road cascade; got names ${JSON.stringify(names)}`);
});

t('T1c — startPath is case-insensitive against tree node names', () => {
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, {
    memberIds: ['c1'],
    startPath: ['GOLARION', 'avistan', 'VARISIA', 'sandpoint hinterlands', 'SANDPOINT', 'market square'],
  });
  const path = patch.parties.main.currentPath;
  assertEq(path.length, 6, 'case-mismatched startPath still resolves');
  const leaf = patch.worldTree.nodes[path[path.length - 1]];
  assertEq((leaf?.name || '').toLowerCase(), 'market square');
});

// ─────────────────────────── T2: fallback behavior ───────────────────────────

t('T2 — no startPath → Main Road defaultEntry cascade (legacy behavior)', () => {
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, { memberIds: ['c1'] });
  const path = patch.parties.main.currentPath;
  const leaf = patch.worldTree.nodes[path[path.length - 1]];
  assertEq((leaf?.name || '').toLowerCase(), 'main road',
    'without startPath, defaultEntry cascade lands on Main Road hub');
});

t('T2b — malformed startPath (unknown leaf) → falls back to cascade', () => {
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, {
    memberIds: ['c1'],
    // "Nowhere Square" doesn't exist under Sandpoint — migration must not
    // ship a broken path; it falls back to the standard defaultEntry cascade.
    startPath: ['Golarion', 'Avistan', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Nowhere Square'],
  });
  const path = patch.parties.main.currentPath;
  const leaf = patch.worldTree.nodes[path[path.length - 1]];
  assertEq((leaf?.name || '').toLowerCase(), 'main road',
    'unresolvable startPath falls back to Main Road cascade');
});

t('T2c — startPath with mis-cased root (no Golarion prefix) still resolves', () => {
  // The resolver accepts either "name starts at root" or "name starts at
  // root's first child" — lenient prefix handling for campaigns that don't
  // want to bother spelling out Golarion.
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, {
    memberIds: ['c1'],
    startPath: ['Avistan', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'Market Square'],
  });
  const path = patch.parties.main.currentPath;
  const leaf = patch.worldTree.nodes[path[path.length - 1]];
  assertEq((leaf?.name || '').toLowerCase(), 'market square',
    'prefix-less startPath (skipping Golarion) still resolves to Market Square');
});

// ─────────────────────────── T3: other canonical targets ─────────────────────

t('T3 — startPath can land inside a canonical building interior', () => {
  // Phase 1 seeded The Rusty Dragon with defaultEntry='Ground Floor' →
  // 'Main Tavern Room'. A campaign that wants to open the party seated
  // at the tavern can land them directly there.
  const adv = makeFreshAdventure();
  const patch = migrateAdventureToWorldTree(adv, {
    memberIds: ['c1'],
    startPath: ['Golarion', 'Avistan', 'Varisia', 'Sandpoint Hinterlands', 'Sandpoint', 'The Rusty Dragon', 'Ground Floor', 'Main Tavern Room'],
  });
  const path = patch.parties.main.currentPath;
  const leaf = patch.worldTree.nodes[path[path.length - 1]];
  assertEq((leaf?.name || '').toLowerCase(), 'main tavern room',
    'building-interior startPath resolves to the specified room');
});

// ─────────────────────────── summary ────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of fails) console.error(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
