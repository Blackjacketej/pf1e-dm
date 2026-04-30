// Tests for generateAreaItems narrative-only behavior (bug #31).
// (a) Functional tests on the underlying narrative extractor.
// (b) Structural assertions against npcTracker.js source — skipped
//     when the sandbox mount is stale (SKIP_STRUCTURAL=1).
// Run: node areaItems.test.mjs

import {
  extractAreaItemsFromNarrative,
  narrativeHasExtractableObjects,
} from './src/services/areaItemExtraction.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', label); }
}

// ── (a) Functional tests on the narrative extractor ───────────────────

// T1 — empty/nullish narrative → no items
{
  assert(extractAreaItemsFromNarrative('').length === 0, 'T1a: empty string');
  assert(extractAreaItemsFromNarrative(null).length === 0, 'T1b: null');
  assert(extractAreaItemsFromNarrative(undefined).length === 0, 'T1c: undefined');
}

// T2 — narrative with NO scene objects → zero items (the core #31 fix).
//   In the old flow, an empty/atmosphere-only narrative triggered a
//   themed-pool fallback that spawned mismatched props (carpets on
//   docks, etc.). After #31 the function returns [] instead.
{
  const text = 'The cobbled streets gleam in the dawn light. Nothing moves.';
  const got = extractAreaItemsFromNarrative(text);
  assert(got.length === 0, 'T2a: atmosphere-only narrative yields zero items');
  assert(narrativeHasExtractableObjects(text) === false, 'T2b: helper agrees no extractables');
}

// T3 — narrative with objects → items produced, all _source=narrative.
{
  const text = 'A bronze brazier crackles in the corner. A wooden table sits against the wall.';
  const got = extractAreaItemsFromNarrative(text);
  assert(got.length >= 1, 'T3a: at least one item extracted');
  assert(got.every(i => i._source === 'narrative'), 'T3b: every item tagged _source=narrative');
  assert(got.some(i => /brazier/i.test(i.name)), 'T3c: brazier captured');
}

// T4 — existing-items dedup
{
  const text = 'A wooden crate sits in the corner.';
  const got = extractAreaItemsFromNarrative(text, { existing: [{ name: 'Wooden Crate' }] });
  assert(!got.some(i => /wooden crate/i.test(i.name)), 'T4: existing-item dedup');
}

// T5 — cap respected
{
  const text = 'A chair. A table. A shelf. A barrel. A crate. A chest. A lantern. A rug.';
  const got = extractAreaItemsFromNarrative(text, { max: 3 });
  assert(got.length <= 3, 'T5: max cap respected');
}

// T6 — classification flags
{
  const text = 'A treasure chest glimmers in the corner.';
  const got = extractAreaItemsFromNarrative(text);
  const chest = got.find(i => /chest/i.test(i.name));
  assert(!!chest, 'T6a: chest found');
  assert(chest?.loot === true || chest?.interactable === true, 'T6b: chest tagged loot/interactable');
}

// ── (b) Structural assertions on generateAreaItems ───────────────────
// Catches future regressions like "someone re-added pickThemedItems to
// generateAreaItems". If the sandbox mount view lags behind the file
// tool view (see memory: feedback_sandbox_mount_lag), set
// SKIP_STRUCTURAL=1 and verify via grep manually.
if (!process.env.SKIP_STRUCTURAL) {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcPath = join(here, 'src/services/npcTracker.js');
  const src = readFileSync(srcPath, 'utf8');

  const startMarker = 'export function generateAreaItems(';
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) {
    console.warn('[structural] generateAreaItems not found — file may be stale. Re-run with SKIP_STRUCTURAL=1.');
  } else {
    const tail = src.slice(startIdx);
    const nextExport = tail.indexOf('\nexport ', 1);
    const body = nextExport > 0 ? tail.slice(0, nextExport) : tail;

    assert(/extractAreaItemsFromNarrative\s*\(/.test(body),    'T7a: body calls extractAreaItemsFromNarrative');
    assert(!/pickThemedItems\s*\(/.test(body),                  'T7b: no pickThemedItems() call inside generateAreaItems');
    assert(!/TOWN_ITEMS\b/.test(body),                          'T7c: no TOWN_ITEMS reference inside generateAreaItems');
    assert(!/TAVERN_ITEMS\b/.test(body),                        'T7d: no TAVERN_ITEMS reference inside generateAreaItems');
    assert(!/DUNGEON_ITEMS\b/.test(body),                       'T7e: no DUNGEON_ITEMS reference inside generateAreaItems');
    assert(/narrativeItems/.test(body),                         'T7f: references narrativeItems variable');
    assert(/mode:\s*['"]narrative-only['"]/.test(body),         'T7g: trace tag confirms narrative-only mode');
    assert(/fallbackCount:\s*0\b/.test(body),                   'T7h: fallbackCount hardcoded to 0 in trace');
  }
}

console.log('\nareaItems: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
