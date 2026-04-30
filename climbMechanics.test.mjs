// climbMechanics.test.mjs
// CRB p. 90-91 Climb skill mechanics — pure unit tests.
// Run: npx vite-node climbMechanics.test.mjs

import {
  CLIMB_SURFACE_DCS,
  CLIMB_DC_MODIFIERS,
  applyClimbModifiers,
  resolveClimb,
  resolveDamageWhileClimbing,
  resolveCatchSelfFalling,
  resolveCatchFallingCharacter,
} from './src/utils/rulesEngine.js';

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// ──────────────────────────────────────────────────────────────────
section('CLIMB_SURFACE_DCS — CRB-faithful values');

assert('slope → 0', CLIMB_SURFACE_DCS['slope'] === 0);
assert('knotted rope with wall → 0', CLIMB_SURFACE_DCS['knotted rope with wall'] === 0);
assert('knotted rope → 5', CLIMB_SURFACE_DCS['knotted rope'] === 5);
assert('rope trick spell → 5', CLIMB_SURFACE_DCS['rope trick spell'] === 5);
assert('surface with ledges → 10', CLIMB_SURFACE_DCS['surface with ledges'] === 10);
assert('ship rigging → 10', CLIMB_SURFACE_DCS['ship rigging'] === 10);
assert('tree → 15 (NOT 10)', CLIMB_SURFACE_DCS['tree'] === 15);
assert('unknotted rope → 15 (NOT 10)', CLIMB_SURFACE_DCS['unknotted rope'] === 15);
assert('dangling hands pull-up → 15', CLIMB_SURFACE_DCS['dangling hands pull-up'] === 15);
assert('dungeon wall → 20', CLIMB_SURFACE_DCS['dungeon wall'] === 20);
assert('natural rock wall → 25 (NOT 20)', CLIMB_SURFACE_DCS['natural rock wall'] === 25);
assert('brick wall → 25', CLIMB_SURFACE_DCS['brick wall'] === 25);
assert('overhang → 30 (NOT 25)', CLIMB_SURFACE_DCS['overhang'] === 30);
assert('ceiling (with handholds) → 30', CLIMB_SURFACE_DCS['ceiling (with handholds)'] === 30);
assert('perfectly smooth flat surface → null (impossible)', CLIMB_SURFACE_DCS['perfectly smooth flat surface'] === null);
assert('removed fabricated "plain rope" entry', CLIMB_SURFACE_DCS['plain rope'] === undefined);
assert('removed fabricated "smooth wall (with cracks)" entry', CLIMB_SURFACE_DCS['smooth wall (with cracks)'] === undefined);

// ──────────────────────────────────────────────────────────────────
section('CLIMB_DC_MODIFIERS — CRB p. 91');

assert('chimney → -10', CLIMB_DC_MODIFIERS.chimney === -10);
assert('corner → -5', CLIMB_DC_MODIFIERS.corner === -5);
assert('slippery → +5', CLIMB_DC_MODIFIERS.slippery === 5);

// ──────────────────────────────────────────────────────────────────
section('applyClimbModifiers — cumulative math + null short-circuit');

assert('no modifiers → baseDc passthrough', applyClimbModifiers(20, null) === 20);
assert('empty array → baseDc passthrough', applyClimbModifiers(20, []) === 20);
assert('chimney on wall 20 → 10', applyClimbModifiers(20, ['chimney']) === 10);
assert('corner on wall 20 → 15', applyClimbModifiers(20, ['corner']) === 15);
assert('slippery on wall 20 → 25', applyClimbModifiers(20, ['slippery']) === 25);
assert('chimney + slippery on 20 → 15 (cumulative)', applyClimbModifiers(20, ['chimney', 'slippery']) === 15);
assert('corner + slippery on 20 → 20 (net zero)', applyClimbModifiers(20, ['corner', 'slippery']) === 20);
assert('object-form modifiers work', applyClimbModifiers(20, { chimney: true, slippery: true }) === 15);
assert('object-form with falsy keys ignored', applyClimbModifiers(20, { chimney: true, slippery: false }) === 10);
assert('unknown key ignored', applyClimbModifiers(20, ['bogus']) === 20);
assert('null baseDc → null (impossible stays impossible)', applyClimbModifiers(null, ['chimney']) === null);
assert('undefined baseDc → null', applyClimbModifiers(undefined, ['chimney']) === null);

// ──────────────────────────────────────────────────────────────────
section('resolveClimb — impossible surfaces + modifier application');

const imp = resolveClimb(30, null);
assert('null DC → impossible=true', imp.impossible === true);
assert('null DC → success=false', imp.success === false);
assert('null DC → fell=false (nothing to fall from)', imp.fell === false);
assert('null DC → dc=null', imp.dc === null);

const normal = resolveClimb(22, 20);
assert('check 22 vs DC 20 → success', normal.success === true);
assert('check 22 vs DC 20 → not fallen', normal.fell === false);
assert('normal result → impossible=false', normal.impossible === false);
assert('normal result → dc=20', normal.dc === 20);

const failNoFall = resolveClimb(17, 20);
assert('check 17 vs DC 20 (fail by 3) → no progress, no fall', failNoFall.success === false && failNoFall.fell === false);

const failFall = resolveClimb(15, 20);
assert('check 15 vs DC 20 (fail by 5) → fell', failFall.success === false && failFall.fell === true);

const failWayFall = resolveClimb(10, 20);
assert('check 10 vs DC 20 (fail by 10) → fell', failWayFall.fell === true);

// Accelerated applies -5
const accel = resolveClimb(20, 20, { accelerated: true });
assert('accelerated check 20 vs DC 20 → effective 15 < 20, fail by 5, fell', accel.success === false && accel.fell === true);

const accelPass = resolveClimb(26, 20, { accelerated: true });
assert('accelerated 26 vs DC 20 → effective 21, pass', accelPass.success === true);

// Modifiers flow through
const chimneyPass = resolveClimb(12, 20, { modifiers: ['chimney'] });
assert('chimney reduces DC 20 → 10; check 12 passes', chimneyPass.success === true && chimneyPass.dc === 10);

const slipperyFail = resolveClimb(22, 20, { modifiers: ['slippery'] });
assert('slippery raises DC 20 → 25; check 22 fails (margin -3, no fall)', slipperyFail.success === false && slipperyFail.fell === false && slipperyFail.dc === 25);

const impWithMods = resolveClimb(40, null, { modifiers: ['chimney'] });
assert('modifiers on null baseDc → still impossible', impWithMods.impossible === true);

// hasClimbSpeed flag echoed
const climbSpd = resolveClimb(30, 20, { hasClimbSpeed: true });
assert('hasClimbSpeed echoed in result', climbSpd.hasClimbSpeed === true);

// ──────────────────────────────────────────────────────────────────
section('resolveDamageWhileClimbing — any-failure-means-fall');

const dmgPass = resolveDamageWhileClimbing(20, 20);
assert('check 20 vs DC 20 → held', dmgPass.success === true && dmgPass.fell === false);

const dmgFailBy1 = resolveDamageWhileClimbing(19, 20);
assert('check 19 vs DC 20 (fail by 1) → FELL (not the normal -5 rule)', dmgFailBy1.success === false && dmgFailBy1.fell === true);

const dmgFailBig = resolveDamageWhileClimbing(5, 25);
assert('check 5 vs DC 25 → fell', dmgFailBig.fell === true);

// ──────────────────────────────────────────────────────────────────
section('resolveCatchSelfFalling — wall +20 vs slope +10');

const wallCatch = resolveCatchSelfFalling(40, 20); // DC = 20+20 = 40
assert('wall DC 20: check 40 vs DC 40 → catches', wallCatch.success === true && wallCatch.dc === 40);

const wallMiss = resolveCatchSelfFalling(39, 20);
assert('wall DC 20: check 39 vs DC 40 → misses', wallMiss.success === false);

const slopeCatch = resolveCatchSelfFalling(15, 5); // DC = 5+10 = 15
assert('slope DC 5 with isSlope=true: check 15 vs DC 15 → catches', resolveCatchSelfFalling(15, 5, { isSlope: true }).success === true);
assert('slope DC 5 with isSlope=true: DC computed as 15', resolveCatchSelfFalling(15, 5, { isSlope: true }).dc === 15);

// Without isSlope flag, assumes wall branch (+20)
assert('without isSlope flag → +20 branch used', resolveCatchSelfFalling(25, 5).dc === 25);

// ──────────────────────────────────────────────────────────────────
section('resolveCatchFallingCharacter — compound resolution');

const touchMiss = resolveCatchFallingCharacter({
  touchAttackHit: false,
  climbCheckTotal: 50,
  wallDc: 20,
});
assert('touch miss → success=false', touchMiss.success === false);
assert('touch miss → catcherFalls=false', touchMiss.catcherFalls === false);
assert('touch miss → reason string present', typeof touchMiss.reason === 'string');

const catchOK = resolveCatchFallingCharacter({
  touchAttackHit: true,
  climbCheckTotal: 30,
  wallDc: 20, // DC = 30
});
assert('hit + climb 30 vs DC 30 → caught', catchOK.success === true);
assert('caught → catcherFalls=false', catchOK.catcherFalls === false);
assert('caught → dc=30', catchOK.dc === 30);

const catchFailNoFall = resolveCatchFallingCharacter({
  touchAttackHit: true,
  climbCheckTotal: 27,
  wallDc: 20, // DC = 30, margin -3
});
assert('hit + climb 27 vs DC 30 → missed but kept grip', catchFailNoFall.success === false && catchFailNoFall.catcherFalls === false);

const catchFailFall = resolveCatchFallingCharacter({
  touchAttackHit: true,
  climbCheckTotal: 24,
  wallDc: 20, // DC = 30, margin -6
});
assert('hit + climb 24 vs DC 30 (fail by 6) → catcher also falls', catchFailFall.success === false && catchFailFall.catcherFalls === true);

// Edge: exactly -5 margin triggers catcher falling
const catchExactlyFall = resolveCatchFallingCharacter({
  touchAttackHit: true,
  climbCheckTotal: 25,
  wallDc: 20, // DC 30, margin -5
});
assert('fail by exactly 5 → catcher falls', catchExactlyFall.catcherFalls === true);

// Weight overload: successful catch but fallen weight > heavy load → catcher falls
const overloaded = resolveCatchFallingCharacter({
  touchAttackHit: true,
  climbCheckTotal: 40,
  wallDc: 20,
  catcherHeavyLoad: 200,
  fallenWeight: 250,
});
assert('overloaded catch → success=false', overloaded.success === false);
assert('overloaded catch → catcherFalls=true', overloaded.catcherFalls === true);
assert('overloaded catch → overloaded=true flag', overloaded.overloaded === true);

const underLoad = resolveCatchFallingCharacter({
  touchAttackHit: true,
  climbCheckTotal: 40,
  wallDc: 20,
  catcherHeavyLoad: 200,
  fallenWeight: 150,
});
assert('under heavy load → success=true', underLoad.success === true);
assert('under heavy load → overloaded=false', underLoad.overloaded === false);

// ──────────────────────────────────────────────────────────────────
console.log(`\n──── Results: ${pass} passed, ${fail} failed ────`);
if (fail > 0) process.exit(1);
