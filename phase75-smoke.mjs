/**
 * Phase 7.5 smoke test — range gating + replace-familiar ritual.
 *
 * Run with: npx vite-node phase75-smoke.mjs
 */
import {
  aggregateFamiliarModifiers,
  getEffectiveMaxHP,
  isFamiliarInRange,
  getFamiliarLocation,
  setFamiliarLocation,
  markFamiliarLost,
  canReplaceFamiliar,
  beginReplaceFamiliarRitual,
  completeReplaceFamiliarRitual,
  getFamiliarStatusSummary,
  getReplaceFamiliarCost,
  FAMILIAR_ABILITY_RANGE_MILES,
} from './src/utils/familiarEngine.js';

let passed = 0;
let failed = 0;
function check(name, cond, actual) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (actual !== undefined) console.log(`      actual: ${JSON.stringify(actual)}`);
  }
}
function section(name) { console.log(`\n── ${name} ──`); }

// Baseline master: Wizard 5 with a cat familiar (cat grants +3 Stealth)
const wizard = () => ({
  id: 'test-wiz',
  name: 'Test Wizard',
  class: 'Wizard',
  level: 5,
  abilities: { STR: 10, DEX: 14, CON: 12, INT: 18, WIS: 10, CHA: 8 },
  maxHP: 30,
  bab: 2,
  gp: 5000,
  familiar: { id: 'cat' },
});

// ═════════════════════════════════════════════════════════════════
section('Range gate — default / in-range / out-of-range');
// ═════════════════════════════════════════════════════════════════

// (1) No worldState → 7.3 default behavior: bonus applies.
const modsNoWS = aggregateFamiliarModifiers(wizard());
check(
  'No worldState → +3 Stealth (default in-range)',
  modsNoWS.skills.Stealth === 3,
  modsNoWS.skills
);

// (2) worldState with no familiarLocation entry → in-range default.
const ws0 = { currentDay: 1, currentHour: 12, familiarLocation: {} };
const modsEmptyWS = aggregateFamiliarModifiers(wizard(), { worldState: ws0 });
check(
  'Empty familiarLocation → still in-range',
  modsEmptyWS.skills.Stealth === 3,
  modsEmptyWS.skills
);

// (3) With master (distance 0) → in-range.
const wsWith = setFamiliarLocation(ws0, 'test-wiz', { withMaster: true });
const modsWith = aggregateFamiliarModifiers(wizard(), { worldState: wsWith });
check(
  'withMaster: true → in-range, bonus applies',
  modsWith.skills.Stealth === 3,
  modsWith.skills
);

// (4) 0.5 mile away → still in-range (≤ 1 mi).
const wsHalf = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 0.5 });
const modsHalf = aggregateFamiliarModifiers(wizard(), { worldState: wsHalf });
check(
  '0.5 mile → still in-range',
  modsHalf.skills.Stealth === 3,
  modsHalf.skills
);

// (5) Exactly 1 mile → in-range (boundary inclusive per CRB wording).
const wsOne = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 1 });
const modsOne = aggregateFamiliarModifiers(wizard(), { worldState: wsOne });
check(
  'Exactly 1 mile → in-range (boundary)',
  modsOne.skills.Stealth === 3,
  modsOne.skills
);

// (6) 1.01 miles → out of range, bonus gone.
const wsBeyond = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 1.01 });
const modsBeyond = aggregateFamiliarModifiers(wizard(), { worldState: wsBeyond });
check(
  '1.01 miles → OUT of range, no stealth bonus',
  modsBeyond.skills.Stealth === undefined,
  modsBeyond.skills
);

// (7) 5 miles → out of range, empty applied array.
const wsFar = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 5, note: 'exploring downtown' });
const modsFar = aggregateFamiliarModifiers(wizard(), { worldState: wsFar });
check(
  '5 miles → no bonuses at all',
  modsFar.applied.length === 0,
  modsFar.applied
);

// (8) isFamiliarInRange helper agrees.
check(
  'isFamiliarInRange — with master',
  isFamiliarInRange(wizard(), wsWith) === true
);
check(
  'isFamiliarInRange — 1 mile',
  isFamiliarInRange(wizard(), wsOne) === true
);
check(
  'isFamiliarInRange — 5 miles',
  isFamiliarInRange(wizard(), wsFar) === false
);
check(
  'isFamiliarInRange — no worldState',
  isFamiliarInRange(wizard(), null) === true
);

// (9) FAMILIAR_ABILITY_RANGE_MILES constant is 1 per CRB.
check(
  'FAMILIAR_ABILITY_RANGE_MILES === 1',
  FAMILIAR_ABILITY_RANGE_MILES === 1
);

// ═════════════════════════════════════════════════════════════════
section('getFamiliarLocation — normalization');
// ═════════════════════════════════════════════════════════════════

const locDefault = getFamiliarLocation(wizard(), ws0);
check(
  'getFamiliarLocation defaults to with master',
  locDefault.withMaster === true && locDefault.distanceMiles === 0
);

const locFar = getFamiliarLocation(wizard(), wsFar);
check(
  'getFamiliarLocation returns stored distance',
  locFar.distanceMiles === 5 && locFar.withMaster === false && locFar.note === 'exploring downtown'
);

// Legacy partial entry — only distanceMiles set.
const wsPartial = {
  ...ws0,
  familiarLocation: { 'test-wiz': { distanceMiles: 2 } },
};
const locPartial = getFamiliarLocation(wizard(), wsPartial);
check(
  'Partial entry — withMaster derived from distance',
  locPartial.withMaster === false && locPartial.distanceMiles === 2
);

// Negative distance → clamped to 0.
const wsNeg = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: -3 });
check(
  'Negative distance clamped to 0',
  getFamiliarLocation(wizard(), wsNeg).distanceMiles === 0
);

// ═════════════════════════════════════════════════════════════════
section('setFamiliarLocation — immutable updates');
// ═════════════════════════════════════════════════════════════════

const wsA = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 0.5, note: 'scouting' });
check(
  'setFamiliarLocation — original untouched',
  Object.keys(ws0.familiarLocation).length === 0
);
check(
  'setFamiliarLocation — new entry written',
  wsA.familiarLocation['test-wiz'].distanceMiles === 0.5 &&
  wsA.familiarLocation['test-wiz'].note === 'scouting'
);

// withMaster patch zeros the distance automatically.
const wsB = setFamiliarLocation(wsA, 'test-wiz', { withMaster: true });
check(
  'withMaster: true auto-zeros distance',
  wsB.familiarLocation['test-wiz'].distanceMiles === 0 &&
  wsB.familiarLocation['test-wiz'].withMaster === true
);

// distanceMiles > 0 automatically flips withMaster to false.
const wsC = setFamiliarLocation(wsB, 'test-wiz', { distanceMiles: 3 });
check(
  'distance>0 auto-flips withMaster false',
  wsC.familiarLocation['test-wiz'].withMaster === false
);

// Setting on an unknown character is a no-op.
const wsNoId = setFamiliarLocation(ws0, null, { distanceMiles: 1 });
check(
  'setFamiliarLocation with null id → no-op',
  wsNoId === ws0
);

// ═════════════════════════════════════════════════════════════════
section('Lost / ritual status — lifecycle');
// ═════════════════════════════════════════════════════════════════

// Mark lost at day 10, hour 14.
const wsT0 = { currentDay: 10, currentHour: 14, familiarLocation: {} };
const lost = markFamiliarLost(wizard(), wsT0);
check(
  'markFamiliarLost — status=lost',
  lost.familiar.status === 'lost'
);
check(
  'markFamiliarLost — lostAt stamped',
  lost.familiar.lostAt.day === 10 && lost.familiar.lostAt.hour === 14
);
check(
  'markFamiliarLost — preserves id',
  lost.familiar.id === 'cat'
);

// Bonus is gone immediately after loss, even without range gate.
const lostMods = aggregateFamiliarModifiers(lost);
check(
  'lost familiar → no bonuses (no worldState)',
  lostMods.applied.length === 0
);
const lostModsWS = aggregateFamiliarModifiers(lost, { worldState: wsT0 });
check(
  'lost familiar → no bonuses (with worldState)',
  lostModsWS.applied.length === 0
);

// Immediately after loss — ritual cannot begin.
const immediate = canReplaceFamiliar(lost, wsT0);
check(
  'canReplaceFamiliar — blocked by 1-week wait',
  immediate.canReplace === false &&
  immediate.waitHoursRemaining === 7 * 24
);
check(
  'canReplaceFamiliar — reason mentions week',
  immediate.reason.includes('week')
);
check(
  'canReplaceFamiliar — cost scales with level (5 * 200 = 1000)',
  immediate.cost === 1000
);

// 3 days later — still not enough.
const ws3d = { currentDay: 13, currentHour: 14, familiarLocation: {} };
const after3d = canReplaceFamiliar(lost, ws3d);
check(
  'canReplaceFamiliar — 3 days later still blocked',
  after3d.canReplace === false &&
  after3d.waitHoursRemaining === 4 * 24
);

// 7 days later — ready.
const ws7d = { currentDay: 17, currentHour: 14, familiarLocation: {} };
const after7d = canReplaceFamiliar(lost, ws7d);
check(
  'canReplaceFamiliar — 7 days later ready',
  after7d.canReplace === true &&
  after7d.waitHoursRemaining === 0
);

// Not enough gold → blocked.
const broke = { ...lost, gp: 500 };
const brokeCheck = canReplaceFamiliar(broke, ws7d);
check(
  'canReplaceFamiliar — blocked by insufficient gold',
  brokeCheck.canReplace === false && brokeCheck.reason.includes('1000 gp')
);

// Explicit gold override.
const overrideOK = canReplaceFamiliar({ ...lost, gp: 0 }, ws7d, { gold: 2000 });
check(
  'canReplaceFamiliar — gold override unblocks',
  overrideOK.canReplace === true
);

// Non-lost familiar blocked.
const living = wizard();
const livingCheck = canReplaceFamiliar(living, ws7d);
check(
  'canReplaceFamiliar — living familiar blocked',
  livingCheck.canReplace === false && livingCheck.reason.includes('dismissed')
);

// Non-caster class blocked.
const fighter = { ...wizard(), class: 'Fighter', familiar: { id: 'cat', status: 'lost', lostAt: { day: 1, hour: 0 } } };
const fighterCheck = canReplaceFamiliar(fighter, ws7d);
check(
  'canReplaceFamiliar — fighter blocked (no master levels)',
  fighterCheck.canReplace === false && fighterCheck.reason.includes('Wizard')
);

// ═════════════════════════════════════════════════════════════════
section('Replace ritual — begin/complete');
// ═════════════════════════════════════════════════════════════════

const began = beginReplaceFamiliarRitual(lost, ws7d);
check(
  'beginReplaceFamiliarRitual — status=ritualInProgress',
  began.familiar.status === 'ritualInProgress'
);
check(
  'beginReplaceFamiliarRitual — ritualStartedAt stamped',
  began.familiar.ritualStartedAt.day === 17
);

// Aggregator: ritualInProgress also yields no bonuses.
const ripMods = aggregateFamiliarModifiers(began, { worldState: ws7d });
check(
  'ritualInProgress → no bonuses',
  ripMods.applied.length === 0
);

// begin is a no-op on a living familiar (defensive).
const noOp = beginReplaceFamiliarRitual(wizard(), ws7d);
check(
  'beginReplaceFamiliarRitual — no-op on living familiar',
  noOp.familiar.id === 'cat' && noOp.familiar.status === undefined
);

// Complete with a new id.
const done = completeReplaceFamiliarRitual(began, 'raven');
check(
  'completeReplaceFamiliarRitual — new id set',
  done.familiar.id === 'raven'
);
check(
  'completeReplaceFamiliarRitual — status cleared',
  done.familiar.status === undefined &&
  done.familiar.lostAt === undefined &&
  done.familiar.ritualStartedAt === undefined
);

// Bonus flows again after completion (raven → +3 Appraise per CRB p.82).
const doneMods = aggregateFamiliarModifiers(done);
check(
  'post-ritual raven → +3 Appraise',
  doneMods.skills.Appraise === 3,
  doneMods.skills
);

// ═════════════════════════════════════════════════════════════════
section('Status summary strings');
// ═════════════════════════════════════════════════════════════════

const withSum = getFamiliarStatusSummary(wizard(), ws0);
check(
  'summary — default in-range',
  typeof withSum === 'string' && withSum.toLowerCase().includes('master')
);

const farSum = getFamiliarStatusSummary(wizard(), wsFar);
check(
  'summary — out of range mentions distance + inactive',
  farSum.includes('5') && farSum.toLowerCase().includes('out of range')
);

const halfSum = getFamiliarStatusSummary(wizard(), wsHalf);
check(
  'summary — in-range but separated',
  halfSum.includes('0.5') && halfSum.toLowerCase().includes('in range')
);

const lostSum = getFamiliarStatusSummary(lost, wsT0);
check(
  'summary — lost with countdown',
  lostSum.toLowerCase().includes('lost') && lostSum.includes('day')
);

const readySum = getFamiliarStatusSummary(lost, ws7d);
check(
  'summary — lost, ready for ritual',
  readySum.toLowerCase().includes('ready')
);

const ripSum = getFamiliarStatusSummary(began, ws7d);
check(
  'summary — ritual in progress',
  ripSum.toLowerCase().includes('ritual') && ripSum.includes('8')
);

const noneSum = getFamiliarStatusSummary({ id: 'x', class: 'Wizard', level: 5 }, ws0);
check(
  'summary — null for no familiar',
  noneSum === null
);

// ═════════════════════════════════════════════════════════════════
section('getEffectiveMaxHP — range gating');
// ═════════════════════════════════════════════════════════════════

// Toad grants +3 max HP. Test that going out of range removes it.
const toadMaster = { ...wizard(), maxHP: 30, familiar: { id: 'toad' } };
const hpIn = getEffectiveMaxHP(toadMaster, { worldState: wsWith });
check(
  'toad + in range → maxHP 33',
  hpIn === 33
);
const wsToadFar = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 10 });
const hpOut = getEffectiveMaxHP(toadMaster, { worldState: wsToadFar });
check(
  'toad + out of range → maxHP 30 (bonus gated)',
  hpOut === 30
);
// 7.3 default (no worldState) still delivers the bonus.
check(
  'toad no worldState → still +3 (backward compat)',
  getEffectiveMaxHP(toadMaster) === 33
);

// ═════════════════════════════════════════════════════════════════
section('getReplaceFamiliarCost — sanity (already shipped in 7.1)');
// ═════════════════════════════════════════════════════════════════
check('cost at level 1 = 200', getReplaceFamiliarCost(1) === 200);
check('cost at level 5 = 1000', getReplaceFamiliarCost(5) === 1000);
check('cost at level 0 = 200 (floor at 1)', getReplaceFamiliarCost(0) === 200);
check('cost at level 20 = 4000', getReplaceFamiliarCost(20) === 4000);

// ═════════════════════════════════════════════════════════════════
console.log(`\n──────────────────────────────────────────`);
console.log(`Phase 7.5 smoke: ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────`);
process.exit(failed > 0 ? 1 : 0);
