// Bug #55 smoke test stub — the canonical copy lives at outputs/ in the
// Cowork session. This stray copy exists at project root only because the
// sandbox couldn't reach outputs/ during a bindfs-lagged verification pass;
// safe for Tom to delete. The real test imports relative paths that only
// work from the project root, so if you do want to re-run it in-tree:
//
//   node isPlausibleNPC-check.mjs
//
// Otherwise: delete this file.

import {
  isPlausibleNPCName,
  isAppearanceDescriptor,
} from './src/services/npcExtraction.js';

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; return; }
  fail++;
  console.error('FAIL:', label);
}

// Shape 1: proper names — accept, NOT descriptor.
assert(isPlausibleNPCName('Bertha'),                     'Accept: Bertha');
assert(isPlausibleNPCName('Bertha Cray'),                'Accept: Bertha Cray');
assert(isPlausibleNPCName('Sheriff Hemlock'),            'Accept: Sheriff Hemlock');
assert(isPlausibleNPCName('Father Zantus'),              'Accept: Father Zantus');
assert(isPlausibleNPCName('Ironforge'),                  'Accept: Ironforge');
assert(!isAppearanceDescriptor('Bertha'),                'Shape 1: Bertha not descriptor');
assert(!isAppearanceDescriptor('Sheriff Hemlock'),       'Shape 1: Sheriff Hemlock not descriptor');

// Shape 2: article-lead appearance — accept, IS descriptor.
assert(isPlausibleNPCName('a cloaked woman'),            'Accept: a cloaked woman');
assert(isPlausibleNPCName('the old dwarf blacksmith'),   'Accept: the old dwarf blacksmith');
assert(isPlausibleNPCName('some hooded figure'),         'Accept: some hooded figure');
assert(isPlausibleNPCName('an elderly gnome'),           'Accept: an elderly gnome');
assert(isAppearanceDescriptor('a cloaked woman'),        'Shape 2 descriptor');
assert(isAppearanceDescriptor('the old dwarf blacksmith'), 'Shape 2 descriptor');

// Shape 3: bare appearance — accept, IS descriptor.
assert(isPlausibleNPCName('tall woman'),                 'Accept: tall woman');
assert(isPlausibleNPCName('fat angry gnome'),            'Accept: fat angry gnome');
assert(isPlausibleNPCName('grizzled dwarf merchant'),    'Accept: grizzled dwarf merchant');
assert(isPlausibleNPCName('young halfling'),             'Accept: young halfling');
assert(isPlausibleNPCName('hooded figure'),              'Accept: hooded figure');
assert(isAppearanceDescriptor('tall woman'),             'Shape 3: tall woman descriptor');
assert(isAppearanceDescriptor('fat angry gnome'),        'Shape 3 descriptor');
assert(isAppearanceDescriptor('grizzled dwarf merchant'),'Shape 3 descriptor');

// Reject Tom's reported bad cases.
assert(!isPlausibleNPCName('research'),                  'Reject: research');
assert(!isPlausibleNPCName('what suits'),                'Reject: what suits');
assert(!isPlausibleNPCName('plans'),                     'Reject: plans');
assert(!isPlausibleNPCName('things'),                    'Reject: things');
assert(!isPlausibleNPCName('matters'),                   'Reject: matters');
assert(!isPlausibleNPCName('the research'),              'Reject: the research');
assert(!isPlausibleNPCName('a plan'),                    'Reject: a plan');

// Reject pronouns, stopwords, too-short.
assert(!isPlausibleNPCName('He'),                        'Reject: He');
assert(!isPlausibleNPCName('It'),                        'Reject: It');
assert(!isPlausibleNPCName('Anyway'),                    'Reject: Anyway');
assert(!isPlausibleNPCName('DC'),                        'Reject: DC');
assert(!isPlausibleNPCName('Li'),                        'Reject: Li (below min length)');
assert(!isPlausibleNPCName(''),                          'Reject: empty');
assert(!isPlausibleNPCName(null),                        'Reject: null');
assert(!isPlausibleNPCName(undefined),                   'Reject: undefined');
assert(!isPlausibleNPCName(42),                          'Reject: non-string');

// Whitespace normalization.
assert(isPlausibleNPCName('  Bertha  '),                 'Accept: whitespace-padded');
assert(isPlausibleNPCName('tall   woman'),               'Accept: multi-space');

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
