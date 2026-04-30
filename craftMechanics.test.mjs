// craftMechanics.test.mjs
// CRB p. 91-93 Craft skill mechanics — pure unit tests.
// Run: npx vite-node craftMechanics.test.mjs

import {
  CRAFT_ITEM_DCS,
  getCraftItemDC,
  getCraftArmorDC,
  getCraftCompositeBowDC,
  getCraftRawMaterialCost,
  applyCraftToolModifiers,
  applyCraftAccelerate,
  resolveCraftProgressWeekly,
  resolveCraftProgressDaily,
  resolveCraftRepair,
  resolveCraftPracticeIncome,
} from './src/utils/rulesEngine.js';

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// ──────────────────────────────────────────────────────────────────
section('CRAFT_ITEM_DCS — Table 4-4 values');

assert('very simple item → 5', CRAFT_ITEM_DCS['very simple item'] === 5);
assert('typical item → 10', CRAFT_ITEM_DCS['typical item'] === 10);
assert('high-quality item → 15', CRAFT_ITEM_DCS['high-quality item'] === 15);
assert('complex item → 20 (NOT 15)', CRAFT_ITEM_DCS['complex item'] === 20);
assert('superior item → 20 (CRB alias)', CRAFT_ITEM_DCS['superior item'] === 20);
assert('removed fabricated "very complex item" tier', CRAFT_ITEM_DCS['very complex item'] === undefined);
assert('removed misleading "simple item" tier', CRAFT_ITEM_DCS['simple item'] === undefined);

assert('simple weapon → 12', CRAFT_ITEM_DCS['simple weapon'] === 12);
assert('martial weapon → 15', CRAFT_ITEM_DCS['martial weapon'] === 15);
assert('exotic weapon → 18', CRAFT_ITEM_DCS['exotic weapon'] === 18);
assert('crossbow → 15', CRAFT_ITEM_DCS['crossbow'] === 15);
assert('bolts → 15', CRAFT_ITEM_DCS['bolts'] === 15);

assert('longbow → 12', CRAFT_ITEM_DCS['longbow'] === 12);
assert('shortbow → 12', CRAFT_ITEM_DCS['shortbow'] === 12);
assert('arrows → 12', CRAFT_ITEM_DCS['arrows'] === 12);
assert('composite longbow → 15', CRAFT_ITEM_DCS['composite longbow'] === 15);
assert('composite shortbow → 15', CRAFT_ITEM_DCS['composite shortbow'] === 15);

assert('acid → 15', CRAFT_ITEM_DCS['acid'] === 15);
assert("alchemist's fire → 20", CRAFT_ITEM_DCS["alchemist's fire"] === 20);
assert('smokestick → 20', CRAFT_ITEM_DCS['smokestick'] === 20);
assert('tindertwig → 20', CRAFT_ITEM_DCS['tindertwig'] === 20);
assert('antitoxin → 25', CRAFT_ITEM_DCS['antitoxin'] === 25);
assert('sunrod → 25', CRAFT_ITEM_DCS['sunrod'] === 25);
assert('tanglefoot bag → 25', CRAFT_ITEM_DCS['tanglefoot bag'] === 25);
assert('thunderstone → 25', CRAFT_ITEM_DCS['thunderstone'] === 25);
assert('blanket "alchemical item" entry removed', CRAFT_ITEM_DCS['alchemical item'] === undefined);

assert('masterwork component → 20', CRAFT_ITEM_DCS['masterwork component'] === 20);

// Armor should NOT be hardcoded in the table — must use getCraftArmorDC
assert('leather armor NOT hardcoded in table', CRAFT_ITEM_DCS['leather armor'] === undefined);
assert('full plate NOT hardcoded in table', CRAFT_ITEM_DCS['full plate'] === undefined);

// ──────────────────────────────────────────────────────────────────
section('getCraftItemDC — lookup with null fallback');

assert('known key returns DC', getCraftItemDC('martial weapon') === 15);
assert('uppercase input case-insensitive', getCraftItemDC('Martial Weapon') === 15);
assert('unknown key returns null (not silent 15)', getCraftItemDC('blaster rifle') === null);
assert('undefined input returns null', getCraftItemDC(undefined) === null);
assert('empty string returns null', getCraftItemDC('') === null);

// ──────────────────────────────────────────────────────────────────
section('getCraftArmorDC — CRB formula 10 + AC bonus');

assert('leather (+2) → 12', getCraftArmorDC(2) === 12);
assert('studded leather (+3) → 13', getCraftArmorDC(3) === 13);
assert('chain shirt (+4) → 14', getCraftArmorDC(4) === 14);
assert('breastplate (+6) → 16', getCraftArmorDC(6) === 16);
assert('half-plate (+8) → 18', getCraftArmorDC(8) === 18);
assert('full plate (+9) → 19 (NOT 17 as old hardcoded table claimed)', getCraftArmorDC(9) === 19);
assert('buckler (+1) → 11', getCraftArmorDC(1) === 11);
assert('tower shield (+4) → 14', getCraftArmorDC(4) === 14);
assert('invalid (negative) → null', getCraftArmorDC(-1) === null);
assert('invalid (NaN) → null', getCraftArmorDC(NaN) === null);

// ──────────────────────────────────────────────────────────────────
section('getCraftCompositeBowDC — CRB formula 15 + (2 × rating)');

assert('rating 0 → 15', getCraftCompositeBowDC(0) === 15);
assert('rating 1 → 17', getCraftCompositeBowDC(1) === 17);
assert('rating 3 → 21', getCraftCompositeBowDC(3) === 21);
assert('rating 5 → 25', getCraftCompositeBowDC(5) === 25);
assert('default arg → 15', getCraftCompositeBowDC() === 15);

// ──────────────────────────────────────────────────────────────────
section('getCraftRawMaterialCost — 1/3 of item price');

assert('10 gp item → ~3.33 gp raw materials', Math.abs(getCraftRawMaterialCost(10) - 10 / 3) < 1e-9);
assert('300 gp sword → 100 gp raw materials', getCraftRawMaterialCost(300) === 100);
assert('0 / undefined → 0', getCraftRawMaterialCost(undefined) === 0);

// ──────────────────────────────────────────────────────────────────
section('applyCraftToolModifiers — check modifiers (not DC)');

assert('no opts → passthrough', applyCraftToolModifiers(10, {}).total === 10);
assert('improvised tools → -2', applyCraftToolModifiers(10, { improvisedTools: true }).total === 8);
assert('masterwork tools → +2', applyCraftToolModifiers(10, { masterworkTools: true }).total === 12);
assert("alchemist's lab → +2", applyCraftToolModifiers(10, { alchemistLab: true }).total === 12);
assert('mw tools + lab stack → +4', applyCraftToolModifiers(10, { masterworkTools: true, alchemistLab: true }).total === 14);
assert('improvised + lab net 0', applyCraftToolModifiers(10, { improvisedTools: true, alchemistLab: true }).total === 10);
assert('notes list captures active mods', applyCraftToolModifiers(10, { improvisedTools: true, masterworkTools: true }).notes.length === 2);

// ──────────────────────────────────────────────────────────────────
section('applyCraftAccelerate — voluntary +10 DC');

assert('no accelerate → baseDc passthrough', applyCraftAccelerate(15, false) === 15);
assert('accelerate → +10', applyCraftAccelerate(15, true) === 25);
assert('undefined opt → baseDc', applyCraftAccelerate(20) === 20);

// ──────────────────────────────────────────────────────────────────
section('resolveCraftProgressWeekly — success/failure branching');

// Typical item DC 10, price 5 gp = 50 sp
// Check 15 × DC 10 = 150 sp → finishes in 1 week
const finishFast = resolveCraftProgressWeekly(15, 10, 5);
assert('check 15 × DC 10 = 150 sp ≥ 50 sp → complete', finishFast.finished === true);
assert('successful → progress = 150 sp', finishFast.progressSP === 150);
assert('successful → materialsLost=false', finishFast.materialsLost === false);

// Check 11 × DC 10 = 110 sp → not finished for expensive item (price 300 gp = 3000 sp)
const partialProgress = resolveCraftProgressWeekly(11, 10, 300);
assert('partial-progress check passes DC → success=true', partialProgress.success === true);
assert('partial progress → finished=false', partialProgress.finished === false);
assert('partial progress → progress = 110 sp', partialProgress.progressSP === 110);

// Check 9 < DC 10 by 1 → fail-by-1
const failBy1 = resolveCraftProgressWeekly(9, 10, 300);
assert('check 9 vs DC 10 → success=false', failBy1.success === false);
assert('fail by 1 → NO progress (not check × DC)', failBy1.progressSP === 0);
assert('fail by 1 → materialsLost=false', failBy1.materialsLost === false);
assert('fail by 1 → finished=false', failBy1.finished === false);

// Check 5 vs DC 10 → fail by 5
const failBy5 = resolveCraftProgressWeekly(5, 10, 300);
assert('fail by 5 → success=false', failBy5.success === false);
assert('fail by 5 → zero progress', failBy5.progressSP === 0);
assert('fail by 5 → materialsLost=true', failBy5.materialsLost === true);
assert('fail by 5 → failedByFive=true', failBy5.failedByFive === true);

// Accelerated: DC 10 → effective DC 20
const accelSuccess = resolveCraftProgressWeekly(20, 10, 5, { accelerated: true });
assert('accel effective DC = 20', accelSuccess.effectiveDc === 20);
assert('accel success → progress = 20 × 20 = 400 sp', accelSuccess.progressSP === 400);
assert('accel success → finished', accelSuccess.finished === true);

// Accelerated failure: check 19 < effective DC 20
const accelFail = resolveCraftProgressWeekly(19, 10, 5, { accelerated: true });
assert('accel fail by 1 → no progress', accelFail.progressSP === 0);
assert('accel fail by 1 → no material loss', accelFail.materialsLost === false);

// Tool modifiers flow through to effectiveCheck
const withMwTools = resolveCraftProgressWeekly(8, 10, 5, { toolMods: { masterworkTools: true } });
assert('check 8 + mw tools +2 = effective 10, passes DC 10', withMwTools.success === true);
assert('effectiveCheck echoed = 10', withMwTools.effectiveCheck === 10);

const withImprovised = resolveCraftProgressWeekly(11, 10, 5, { toolMods: { improvisedTools: true } });
assert('check 11 - improvised 2 = 9 < DC 10 → fail', withImprovised.success === false);

// ──────────────────────────────────────────────────────────────────
section('resolveCraftProgressDaily — weekly / 7');

const daily = resolveCraftProgressDaily(15, 10, 5);
// weekly progress = 15 × 10 = 150 sp; daily = floor(150/7) = 21 sp
assert('daily progress = floor(weekly / 7) = 21 sp', daily.progressSP === 21);
assert('daily success mirrored', daily.success === true);

const dailyFail = resolveCraftProgressDaily(5, 10, 5);
assert('daily fail-by-5 → no progress', dailyFail.progressSP === 0);
assert('daily fail-by-5 → materialsLost', dailyFail.materialsLost === true);

// ──────────────────────────────────────────────────────────────────
section('resolveCraftRepair — 1/5 price, same DC');

// Item price 100 gp → repair "price" = 20 gp = 200 sp
// Check 15 × DC 10 = 150 sp < 200 sp → not yet repaired
const repairProgress = resolveCraftRepair(15, 10, 100);
assert('repair uses 1/5 price = 20 gp = 200 sp', repairProgress.itemPriceSP === 200);
assert('repair progress this week = 150 sp', repairProgress.progressSP === 150);
assert('repair not yet done → finished=false', repairProgress.finished === false);
assert('repairPriceGP = 20', repairProgress.repairPriceGP === 20);

// Bigger check to finish repair
const repairDone = resolveCraftRepair(20, 10, 100);
// 20 × 10 = 200 sp ≥ 200 sp repair price → done
assert('check 20 × DC 10 = 200 sp → repair complete', repairDone.finished === true);

// Repair failure
const repairFail = resolveCraftRepair(5, 10, 100);
assert('repair fail by 5 → no progress, materials lost', repairFail.progressSP === 0 && repairFail.materialsLost === true);

// ──────────────────────────────────────────────────────────────────
section('resolveCraftPracticeIncome — half check in gp/week');

assert('check 10 → 5 gp/week', resolveCraftPracticeIncome(10).gpPerWeek === 5);
assert('check 11 → 5 gp/week (floor)', resolveCraftPracticeIncome(11).gpPerWeek === 5);
assert('check 20 → 10 gp/week', resolveCraftPracticeIncome(20).gpPerWeek === 10);
assert('check 1 → 0 gp/week (floor)', resolveCraftPracticeIncome(1).gpPerWeek === 0);
assert('negative check → 0 (clamped)', resolveCraftPracticeIncome(-5).gpPerWeek === 0);

// ──────────────────────────────────────────────────────────────────
console.log(`\n──── Results: ${pass} passed, ${fail} failed ────`);
if (fail > 0) process.exit(1);
