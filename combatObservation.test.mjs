/**
 * combatObservation — pure helper tests.
 *
 * Run: npx vite-node combatObservation.test.mjs
 */
import {
  emptyObservation,
  narrowAcFromAttack,
  describeAcRange,
  hasAcObservation,
  hpDescriptor,
  hpDescriptorLabel,
  recordSeenAttack,
  recordSeenAbility,
  recordSaveOutcome,
  recordEnemySaveOutcome,
  applyObservationEvents,
  distillCombatObservations,
  ensureObservationShape,
  hasSaveObservations,
  describeSaveBucket,
} from './src/services/combatObservation.js';

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

section('emptyObservation', () => {
  const o = emptyObservation();
  assert(o.acLow === null, 'acLow starts null (JSON-safe sentinel)');
  assert(o.acHigh === null, 'acHigh starts null (JSON-safe sentinel)');
  // Round-trip through JSON should preserve shape (no NaN/null/undefined loss)
  const roundtrip = JSON.parse(JSON.stringify(o));
  assert(roundtrip.acLow === null && roundtrip.acHigh === null, 'JSON round-trip stable');
  assert(o.hpState === 'healthy', 'hpState healthy');
  assert(o.seenAttacks.length === 0, 'seenAttacks empty');
  assert(o.savesObserved.fort.passes === 0, 'fort passes 0');
  assert(o.enemySavesTaken.fort.passes === 0, 'enemy fort passes 0');
  assert(o.enemySavesTaken.ref.passes === 0 && o.enemySavesTaken.will.fails === 0,
    'enemySavesTaken fully initialized');
  assert(hasAcObservation(o) === false, 'empty obs has no AC data');
});

section('narrowAcFromAttack — hit tightens upper bound', () => {
  let o = emptyObservation();
  o = narrowAcFromAttack(o, 18, { hit: true });
  assert(o.acHigh === 18, 'hit at 18 → acHigh=18');
  // Another hit at 20 shouldn't loosen back up
  o = narrowAcFromAttack(o, 20, { hit: true });
  assert(o.acHigh === 18, 'later looser hit does not loosen acHigh');
  // Tighter hit at 16 should tighten further
  o = narrowAcFromAttack(o, 16, { hit: true });
  assert(o.acHigh === 16, 'tighter hit at 16 → acHigh=16');
});

section('narrowAcFromAttack — miss tightens lower bound', () => {
  let o = emptyObservation();
  o = narrowAcFromAttack(o, 12, { hit: false });
  assert(o.acLow === 13, 'miss at 12 → acLow=13 (AC>12)');
  // Looser miss (AC>8) shouldn't move acLow down
  o = narrowAcFromAttack(o, 8, { hit: false });
  assert(o.acLow === 13, 'looser miss does not loosen acLow');
  // Tighter miss at 15 bumps floor to 16
  o = narrowAcFromAttack(o, 15, { hit: false });
  assert(o.acLow === 16, 'tighter miss at 15 → acLow=16');
});

section('narrowAcFromAttack — nat 1/20 carry no info', () => {
  let o = emptyObservation();
  o = narrowAcFromAttack(o, 35, { hit: true, natural: 20 });
  assert(o.acHigh === null, 'nat 20 hit ignored (acHigh stays null)');
  o = narrowAcFromAttack(o, 2, { hit: false, natural: 1 });
  assert(o.acLow === null, 'nat 1 miss ignored (acLow stays null)');
  assert(hasAcObservation(o) === false, 'only nat-1/20 rolls → no observation');
});

section('narrowAcFromAttack — crit-on-threat-that-missed-AC is not evidence', () => {
  // PF1e: a natural threat roll (e.g. 19 on a 19-20 threat weapon) that
  // would otherwise miss AC is NOT an automatic hit. Only nat-20 auto-hits.
  // When the caller supplies targetAC, we ignore "hits" where totalAtk < AC.
  let o = emptyObservation();
  o = narrowAcFromAttack(o, 15, { hit: true, natural: 19, targetAC: 20 });
  assert(o.acHigh === null, 'hit with totalAtk<AC ignored (targetAC supplied)');
  // Same roll without targetAC — callers that only know "hit or miss" still work
  o = emptyObservation();
  o = narrowAcFromAttack(o, 15, { hit: true, natural: 19 });
  assert(o.acHigh === 15, 'hit without targetAC still narrows (backward-compat)');
  // Legitimate hit (totalAtk >= targetAC) narrows normally
  o = emptyObservation();
  o = narrowAcFromAttack(o, 22, { hit: true, natural: 19, targetAC: 20 });
  assert(o.acHigh === 22, 'hit with totalAtk>=AC narrows acHigh');
});

section('narrowAcFromAttack — converging to exact AC', () => {
  let o = emptyObservation();
  o = narrowAcFromAttack(o, 17, { hit: true });   // AC ≤ 17
  o = narrowAcFromAttack(o, 16, { hit: false });  // AC ≥ 17
  assert(o.acLow === 17 && o.acHigh === 17, 'bounds pin to 17');
  assert(describeAcRange(o) === 'AC 17', 'describe shows exact');
});

section('describeAcRange formatting', () => {
  assert(describeAcRange(emptyObservation()) === 'AC ?', 'no data → AC ?');
  assert(describeAcRange(null) === 'AC ?', 'null obs → AC ?');
  let o = emptyObservation();
  o.acHigh = 18;
  assert(describeAcRange(o) === 'AC ≤ 18', 'upper-only');
  assert(hasAcObservation(o) === true, 'upper-only → observed');
  o = emptyObservation();
  o.acLow = 14;
  assert(describeAcRange(o) === 'AC ≥ 14', 'lower-only');
  o = emptyObservation();
  o.acLow = 14; o.acHigh = 18;
  assert(describeAcRange(o) === 'AC 14–18', 'range');
});

section('hpDescriptor bands', () => {
  assert(hpDescriptor(100, 100) === 'healthy', '100% healthy');
  assert(hpDescriptor(76, 100) === 'healthy', '76% healthy');
  assert(hpDescriptor(75, 100) === 'lightly-wounded', '75% lightly-wounded');
  assert(hpDescriptor(51, 100) === 'lightly-wounded', '51% lightly-wounded');
  assert(hpDescriptor(50, 100) === 'bloodied', '50% bloodied');
  assert(hpDescriptor(26, 100) === 'bloodied', '26% bloodied');
  assert(hpDescriptor(25, 100) === 'near-death', '25% near-death');
  assert(hpDescriptor(1, 100) === 'near-death', '1hp near-death');
  assert(hpDescriptor(0, 100) === 'down', '0hp down');
  assert(hpDescriptor(-5, 100) === 'down', 'negative hp down');
  assert(hpDescriptor(null, 100) === 'healthy', 'missing hp defaults healthy');
  assert(hpDescriptor(50, 0) === 'healthy', 'zero max defaults healthy');
  assert(hpDescriptorLabel('near-death') === 'near death', 'label formats hyphen');
  assert(hpDescriptorLabel('lightly-wounded') === 'lightly wounded', 'label formats hyphen 2');
});

section('recordSeenAttack / recordSeenAbility set-union', () => {
  let o = emptyObservation();
  o = recordSeenAttack(o, 'longsword');
  o = recordSeenAttack(o, 'bite');
  o = recordSeenAttack(o, 'longsword'); // dup
  assert(o.seenAttacks.length === 2, 'dedup attacks');
  o = recordSeenAbility(o, 'breath weapon');
  assert(o.seenAbilities.includes('breath weapon'), 'ability recorded');
  // Null/empty inputs are no-ops (not crashes)
  const before = o;
  o = recordSeenAttack(o, '');
  assert(o === before, 'empty attack name is no-op');
});

section('recordSaveOutcome tallies', () => {
  let o = emptyObservation();
  o = recordSaveOutcome(o, 'fort', true);
  o = recordSaveOutcome(o, 'fort', false);
  o = recordSaveOutcome(o, 'will', true);
  assert(o.savesObserved.fort.passes === 1, 'fort pass tally');
  assert(o.savesObserved.fort.fails === 1, 'fort fail tally');
  assert(o.savesObserved.will.passes === 1, 'will pass tally');
  assert(o.savesObserved.ref.passes === 0, 'untouched save stays 0');
  // Invalid save is ignored
  const before = o;
  o = recordSaveOutcome(o, 'bogus', true);
  assert(o === before, 'invalid save key ignored');
});

section('recordEnemySaveOutcome tallies (enemy vs party DC)', () => {
  let o = emptyObservation();
  o = recordEnemySaveOutcome(o, 'ref', true);
  o = recordEnemySaveOutcome(o, 'ref', false);
  o = recordEnemySaveOutcome(o, 'will', false);
  assert(o.enemySavesTaken.ref.passes === 1, 'enemy ref pass tally');
  assert(o.enemySavesTaken.ref.fails === 1, 'enemy ref fail tally');
  assert(o.enemySavesTaken.will.fails === 1, 'enemy will fail tally');
  assert(o.savesObserved.ref.passes === 0 && o.savesObserved.will.fails === 0,
    'party bucket untouched by enemy recorder');
  const before = o;
  o = recordEnemySaveOutcome(o, 'bogus', true);
  assert(o === before, 'invalid save key ignored');
});

section('applyObservationEvents — folds a mixed batch', () => {
  let o = emptyObservation();
  o = applyObservationEvents(o, [
    { kind: 'attack', name: 'claw' },
    { kind: 'attack', name: 'claw' }, // dedup via set-union
    { kind: 'attack', name: 'bite' },
    { kind: 'ability', name: 'Breath Weapon' },
    { kind: 'save', save: 'ref', passed: false },
    { kind: 'save', save: 'ref', passed: true },
    { kind: 'save', save: 'will', passed: false },
    { kind: 'enemy-save', save: 'fort', passed: true },
    { kind: 'enemy-save', save: 'ref', passed: false },
    { kind: 'unknown', name: 'ignored' }, // unknown kinds silently skipped
  ]);
  assert(o.seenAttacks.length === 2 && o.seenAttacks.includes('claw') && o.seenAttacks.includes('bite'),
    'seenAttacks dedupes');
  assert(o.seenAbilities.length === 1 && o.seenAbilities[0] === 'Breath Weapon',
    'seenAbilities recorded');
  assert(o.savesObserved.ref.fails === 1 && o.savesObserved.ref.passes === 1,
    'reflex tally correct');
  assert(o.savesObserved.will.fails === 1 && o.savesObserved.will.passes === 0,
    'will tally correct');
  assert(o.savesObserved.fort.fails === 0 && o.savesObserved.fort.passes === 0,
    'party fort untouched (enemy-save went to other bucket)');
  assert(o.enemySavesTaken.fort.passes === 1 && o.enemySavesTaken.ref.fails === 1,
    'enemy-save events routed to enemySavesTaken');
  assert(o.enemySavesTaken.will.passes === 0 && o.enemySavesTaken.will.fails === 0,
    'enemySavesTaken untouched buckets stay zero');
});

section('applyObservationEvents — empty / no-op inputs', () => {
  const o = emptyObservation();
  assert(applyObservationEvents(o, []) === o, 'empty events returns same ref');
  assert(applyObservationEvents(o, null) === o, 'null events returns same ref');
  assert(applyObservationEvents(null, [{ kind: 'attack', name: 'x' }]) === null,
    'null observation returns null');
  // Malformed events don't throw
  const o2 = applyObservationEvents(o, [null, undefined, { kind: 'attack' }, { kind: 'save' }]);
  assert(o2.seenAttacks.length === 0, 'no-name attack ignored');
});

section('distillCombatObservations — enemy path', () => {
  // Defeated → combatStats + stats
  const defeated = distillCombatObservations(emptyObservation(), { role: 'enemy', outcome: 'defeated' });
  assert(defeated.includes('combatStats') && defeated.includes('stats'), 'defeated unlocks both');

  // Fled with few observations → nothing
  const fledLow = distillCombatObservations(emptyObservation(), { role: 'enemy', outcome: 'fled' });
  assert(fledLow === null, 'fled with no observation → null');

  // Fled with ≥3 attacks seen → combatStats only
  let o = emptyObservation();
  o = recordSeenAttack(o, 'longsword');
  o = recordSeenAttack(o, 'shield bash');
  o = recordSeenAttack(o, 'bite');
  const fledSeen = distillCombatObservations(o, { role: 'enemy', outcome: 'fled' });
  assert(fledSeen && fledSeen.includes('combatStats'), 'fled w/ 3+ attacks → combatStats');
  assert(!fledSeen.includes('stats'), 'fled does not unlock stats');
});

section('distillCombatObservations — ally path', () => {
  // Survived alongside party → full reveal
  const survived = distillCombatObservations(emptyObservation(), { role: 'ally', outcome: 'survived' });
  assert(survived.includes('combatStats') && survived.includes('stats'), 'ally survived unlocks both');
  // Fled ally (escape/incapacitated mid-fight) → combatStats only
  const fledAlly = distillCombatObservations(emptyObservation(), { role: 'ally', outcome: 'fled' });
  assert(fledAlly && fledAlly.includes('combatStats') && !fledAlly.includes('stats'), 'fled ally → combatStats only');
});

section('distillCombatObservations — summon path', () => {
  const s = distillCombatObservations(emptyObservation(), { role: 'summon', outcome: 'defeated' });
  assert(s === null, 'summon never persists');
});

section('distillCombatObservations — betrayer uses enemy rules', () => {
  const b = distillCombatObservations(emptyObservation(), { role: 'betrayer', outcome: 'defeated' });
  assert(b.includes('combatStats') && b.includes('stats'), 'betrayer defeated = enemy defeated');
});

section('hasSaveObservations', () => {
  const empty = emptyObservation();
  assert(hasSaveObservations(empty.savesObserved) === false, 'empty bucket → false');
  assert(hasSaveObservations(empty.enemySavesTaken) === false, 'empty enemy bucket → false');
  assert(hasSaveObservations(null) === false, 'null bucket → false');
  assert(hasSaveObservations(undefined) === false, 'undefined bucket → false');
  assert(hasSaveObservations({}) === false, 'empty object → false');

  const o = recordSaveOutcome(empty, 'ref', true);
  assert(hasSaveObservations(o.savesObserved) === true, 'one pass → true');
  assert(hasSaveObservations(o.enemySavesTaken) === false, 'other bucket still empty');
});

section('describeSaveBucket formatting', () => {
  assert(describeSaveBucket(null) === '', 'null → empty string');
  assert(describeSaveBucket({}) === '', 'empty object → empty string');
  assert(describeSaveBucket(emptyObservation().savesObserved) === '', 'all zero → empty string');

  let o = emptyObservation();
  o = recordSaveOutcome(o, 'fort', true);
  o = recordSaveOutcome(o, 'fort', true);
  o = recordSaveOutcome(o, 'ref', false);
  assert(describeSaveBucket(o.savesObserved) === 'Fort 2/0, Ref 0/1',
    'only populated saves appear, labels capitalized');

  // Zero-row saves stay hidden even if neighbors populated
  assert(!describeSaveBucket(o.savesObserved).includes('Will'),
    'will stays hidden when never observed');
});

section('ensureObservationShape — legacy fill', () => {
  // Null → fresh empty
  const fresh = ensureObservationShape(null);
  assert(fresh.savesObserved.fort.passes === 0, 'null → fresh empty obs');
  assert(fresh.enemySavesTaken.fort.fails === 0, 'null → enemy bucket zeroed');

  // Legacy pre-split observation (no enemySavesTaken at all)
  const legacy = {
    acLow: 14, acHigh: 18, hpState: 'wounded',
    seenAttacks: ['longsword'], seenAbilities: [],
    savesObserved: { fort: { passes: 1, fails: 0 }, ref: { passes: 0, fails: 0 }, will: { passes: 0, fails: 0 } },
    // enemySavesTaken intentionally missing
  };
  const filled = ensureObservationShape(legacy);
  assert(filled !== legacy, 'missing field → new object');
  assert(filled.enemySavesTaken.fort.passes === 0, 'enemy bucket filled');
  assert(filled.savesObserved.fort.passes === 1, 'existing data preserved');
  assert(filled.acLow === 14 && filled.hpState === 'wounded', 'other fields untouched');

  // Partial bucket (only fort present)
  const partial = {
    acLow: null, acHigh: null, hpState: 'healthy',
    seenAttacks: [], seenAbilities: [],
    savesObserved: { fort: { passes: 1, fails: 0 } }, // ref/will missing
    enemySavesTaken: { fort: { passes: 0, fails: 0 }, ref: { passes: 0, fails: 0 }, will: { passes: 0, fails: 0 } },
  };
  const filledPartial = ensureObservationShape(partial);
  assert(filledPartial.savesObserved.ref.passes === 0, 'partial bucket: missing ref filled');
  assert(filledPartial.savesObserved.will.fails === 0, 'partial bucket: missing will filled');
  assert(filledPartial.savesObserved.fort.passes === 1, 'partial bucket: existing fort preserved');

  // Already-complete observation → identity return (no wasted alloc)
  const complete = emptyObservation();
  assert(ensureObservationShape(complete) === complete, 'complete obs returned as-is');
});

console.log(`\n──── Results: ${passed} passed, ${failed} failed ────`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
