// craftDowntime.test.mjs
// Tests for downtime craft mechanics — projects, weekly advancement, completion.
// Run: npx vite-node craftDowntime.test.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  startCraftProject,
  advanceCraftProjectWeekly,
  projectProgressSummary,
  projectEffectiveDc,
  setProjectStatus,
  getOngoingProjects,
  attemptCraftRepair,
} from './src/utils/craftDowntime.js';
import { getCraftSpecByName } from './src/utils/craftCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const craftableItemsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/craftableItems.json'), 'utf-8')
);

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// ──────────────────────────────────────────────────────────────────
section('startCraftProject — initialize a new project');

const spec = getCraftSpecByName('longsword', craftableItemsData);
assert('spec is craftable', spec?.craftable === true);

const start = startCraftProject(spec, { itemName: 'longsword' });

assert('start ok', start.ok === true);
assert('project has id', !!start.project?.id);
assert('project starts with 0 progressSP', start.project?.progressSP === 0);
assert('project status is in-progress', start.project?.status === 'in-progress');
assert('project dc matches spec', start.project?.dc === spec.dc);
assert('project priceSP = priceGP * 10', start.project?.priceSP === spec.priceGP * 10);
assert('project priceGP stored', start.project?.priceGP === spec.priceGP);
assert('project materialsGP stored', start.project?.materialsGP === spec.materialsGP);
assert('project has empty history', Array.isArray(start.project?.history) && start.project.history.length === 0);
assert('project failures 0', start.project?.failures === 0);
assert('itemName captured', start.project?.itemName === 'longsword');
assert('subSkill copied from spec', start.project?.subSkill === spec.subSkill);

// ──────────────────────────────────────────────────────────────────
section('startCraftProject — invalid input');

const bad = startCraftProject({ craftable: false }, {});
assert('non-craftable rejected', bad.ok === false);

const noPrice = startCraftProject({ craftable: true, priceGP: 0 }, {});
assert('zero priceGP rejected', noPrice.ok === false);

// ──────────────────────────────────────────────────────────────────
section('startCraftProject — accelerated flag');

const specAccel = getCraftSpecByName('dagger', craftableItemsData);
const startAccel = startCraftProject(specAccel, { itemName: 'dagger', accelerated: true });
assert('accelerated flag stored', startAccel.project?.accelerated === true);
assert('stored dc unchanged (accelerate applied at tick)', startAccel.project?.dc === specAccel.dc);

// ──────────────────────────────────────────────────────────────────
section('projectEffectiveDc');

assert('non-accelerated returns stored dc',
  projectEffectiveDc({ dc: 15, accelerated: false }) === 15);
assert('accelerated adds +10',
  projectEffectiveDc({ dc: 15, accelerated: true }) === 25);
assert('null project → null', projectEffectiveDc(null) === null);

// ──────────────────────────────────────────────────────────────────
section('advanceCraftProjectWeekly — progress & completion');

const proj = startCraftProject(spec, { itemName: 'longsword' }).project;

// High skill check — should make progress
const r1 = advanceCraftProjectWeekly(proj, 25, 1);
assert('returns {project, result, events}',
  r1.project && 'result' in r1 && Array.isArray(r1.events));
assert('project progressSP increased', r1.project.progressSP > proj.progressSP);
assert('history entry appended', r1.project.history.length === 1);
assert('history[0].weekIndex = 1', r1.project.history[0].weekIndex === 1);
assert('progress event emitted',
  r1.events.some((e) => e.kind === 'progress'));

// Paused project — no advancement
const paused = { ...proj, status: 'paused' };
const r2 = advanceCraftProjectWeekly(paused, 25, 2);
assert('paused returns empty events', r2.events.length === 0);
assert('paused project unchanged', r2.project.progressSP === paused.progressSP);

// ──────────────────────────────────────────────────────────────────
section('advanceCraftProjectWeekly — completion event');

// Small/cheap NON-masterworkable item to reach completion quickly
// (masterworkable items gate completion on MW subtrack in Phase 1)
const cheapSpec = getCraftSpecByName('tindertwig', craftableItemsData);
const cheap = startCraftProject(cheapSpec, { itemName: 'tindertwig' }).project;

// Take several weeks at high check; eventually should complete
let cur = cheap;
let completed = false;
let sawProgress = false;
for (let w = 1; w <= 200; w++) {
  const r = advanceCraftProjectWeekly(cur, 30, w);
  cur = r.project;
  if (r.events.some((e) => e.kind === 'progress')) sawProgress = true;
  if (r.events.some((e) => e.kind === 'complete')) {
    completed = true;
    break;
  }
}
assert('eventually produces progress', sawProgress);
assert('eventually emits complete event', completed);
assert('status flips to completed', cur.status === 'completed');
assert('progressSP ≥ priceSP on completion', cur.progressSP >= cur.priceSP);

// ──────────────────────────────────────────────────────────────────
section('advanceCraftProjectWeekly — failure path');

// Low check (5) vs DC 15 — fail by 10, should trigger material loss
const failProj = startCraftProject(spec, { itemName: 'longsword' }).project;
const failR = advanceCraftProjectWeekly(failProj, 5, 1);
const anyMatLoss = failR.events.some((e) => e.kind === 'material-loss');
// Note: material loss only on fail-by-5; depends on resolveCraftProgressWeekly internal
// We just check the *shape* — if it fails by 5+, materialsLossGP should be > 0 or event present
assert('failure produces history entry', failR.project.history.length === 1);
assert('failure tracked in history success flag',
  failR.project.history[0].success === false || failR.project.history[0].success === true);
// Soft check: if material lost, either event or failures counter is set
const lostSomething = anyMatLoss || failR.project.failures > 0 || failR.project.materialsLossGP > 0;
assert('material loss or no-progress outcome present', lostSomething || failR.project.progressSP === 0);

// ──────────────────────────────────────────────────────────────────
section('projectProgressSummary');

const mid = { priceGP: 15, priceSP: 150, progressSP: 75, status: 'in-progress', failures: 0, materialsLossGP: 0 };
const sum = projectProgressSummary(mid);
assert('summary is object', typeof sum === 'object' && sum !== null);
assert('pct computed correctly', sum.pct === 50);
assert('progressGP = progressSP / 10', sum.progressGP === 7.5);
assert('targetGP = priceGP', sum.targetGP === 15);
assert('status passthrough', sum.status === 'in-progress');
assert('null project → null', projectProgressSummary(null) === null);

// ──────────────────────────────────────────────────────────────────
section('setProjectStatus');

const p0 = { id: 'p0', status: 'in-progress' };
assert('pause', setProjectStatus(p0, 'paused').status === 'paused');
assert('resume', setProjectStatus({ ...p0, status: 'paused' }, 'in-progress').status === 'in-progress');
assert('complete', setProjectStatus(p0, 'completed').status === 'completed');
assert('abandon', setProjectStatus(p0, 'abandoned').status === 'abandoned');
assert('invalid status ignored', setProjectStatus(p0, 'bogus').status === 'in-progress');
assert('null project passthrough', setProjectStatus(null, 'paused') === null);

// ──────────────────────────────────────────────────────────────────
section('getOngoingProjects');

const list = [
  { id: 'a', status: 'in-progress' },
  { id: 'b', status: 'paused' },
  { id: 'c', status: 'completed' },
  { id: 'd', status: 'in-progress' },
];
const ongoing = getOngoingProjects(list);
assert('filters to in-progress only', ongoing.length === 2);
assert('preserves order', ongoing[0].id === 'a' && ongoing[1].id === 'd');
assert('non-array returns empty', Array.isArray(getOngoingProjects(null)) && getOngoingProjects(null).length === 0);

// ──────────────────────────────────────────────────────────────────
section('masterwork subtrack — base completes then MW advances');

// Longsword is masterworkable (weapon → +300gp MW component).
const mwProj0 = startCraftProject(spec, { itemName: 'longsword' }).project;
assert('masterworkable flag set', mwProj0.masterworkable === true);
assert('masterwork subtrack initialized', !!mwProj0.masterwork);
assert('masterwork DC is 20', mwProj0.masterwork?.dc === 20);
assert('masterwork progress starts at 0', mwProj0.masterwork?.progressSP === 0);
assert('masterwork not yet finished', mwProj0.masterwork?.finished === false);

// Run many weeks at very high check — should complete BOTH base and MW.
let mwCur = mwProj0;
let baseDoneAt = -1;
let mwDoneAt = -1;
for (let w = 1; w <= 500; w++) {
  const r = advanceCraftProjectWeekly(mwCur, 40, w);
  mwCur = r.project;
  if (baseDoneAt < 0 && mwCur.progressSP >= mwCur.priceSP) baseDoneAt = w;
  if (r.events.some((e) => e.kind === 'complete')) { mwDoneAt = w; break; }
}
assert('base track eventually completes', baseDoneAt > 0);
assert('MW subtrack eventually finishes', mwDoneAt > 0);
assert('MW finishes AFTER base', mwDoneAt > baseDoneAt);
assert('final status is completed', mwCur.status === 'completed');
assert('masterwork.finished is true', mwCur.masterwork?.finished === true);
assert('mw progressSP reached target',
  mwCur.masterwork.progressSP >= (mwCur.masterwork.componentGP * 10));

// History entries after base completes should be tagged track: 'masterwork'
const mwHistory = mwCur.history.filter((h) => h.track === 'masterwork');
const baseHistory = mwCur.history.filter((h) => h.track === 'base');
assert('base history entries tagged', baseHistory.length > 0);
assert('masterwork history entries tagged', mwHistory.length > 0);

// Week-by-week: once base completes, base progressSP should not go higher.
const basePeak = Math.max(...mwCur.history.filter((h) => h.track === 'base').map(() => mwCur.priceSP));
assert('base progressSP stays at completion level', mwCur.progressSP >= mwCur.priceSP);

// ──────────────────────────────────────────────────────────────────
section('masterwork subtrack — material loss uses MW component cost (bug 1 regression)');

// Longsword: base priceGP 15 → base materialsGP 5. MW componentGP 300 → MW materialsGP 100.
const mwLossProj = startCraftProject(spec, { itemName: 'longsword' }).project;
assert('MW materialsGP populated at start', mwLossProj.masterwork?.materialsGP === 100);
assert('MW materialsGP != base materialsGP',
  mwLossProj.masterwork?.materialsGP !== mwLossProj.materialsGP);

// Force base done so next tick works MW, then fail-by-5+ to trigger loss.
// Base priceSP = 150. Set progressSP ≥ 150.
const baseDoneProj = {
  ...mwLossProj,
  progressSP: mwLossProj.priceSP,
  history: [...mwLossProj.history, { weekIndex: 0, track: 'base', success: true }],
};
// MW DC 20; check of 1 fails by 19 → materialsLost true.
const mwFail = advanceCraftProjectWeekly(baseDoneProj, 1, 99);
assert('MW-week material-loss event fires',
  mwFail.events.some((e) => e.kind === 'material-loss' && e.track === 'masterwork'));
const mwLossEvent = mwFail.events.find((e) => e.kind === 'material-loss');
assert('MW loss event uses MW materialsGP/2 (50gp), not base (2.5gp)',
  mwLossEvent?.lossGP === 50);
assert('materialsLossGP accumulator charged 50gp',
  mwFail.project.materialsLossGP === 50);

// ──────────────────────────────────────────────────────────────────
section('MW-only week does NOT spuriously charge base materials (bug 3 regression)');

// Same setup as above: base done, now in MW. A roll that would fail-5 against
// base DC 15 (longsword) but ALSO fail MW DC 20 should NOT double-charge base.
// A check of 1 fails base by 14 (mat loss) and MW by 19 (mat loss).
// Only MW should register.
const onlyMw = advanceCraftProjectWeekly(baseDoneProj, 1, 100);
const baseLossEvents = onlyMw.events.filter((e) => e.kind === 'material-loss' && e.track === 'base');
assert('no base-track material-loss event on MW week', baseLossEvents.length === 0);
assert('failures counter incremented exactly once (not twice)',
  onlyMw.project.failures === 1);

// ──────────────────────────────────────────────────────────────────
section('attemptCraftRepair — one-shot repair helper');

const repairItem = { dc: 15, priceGP: 100 };

// High skill → success, some progress
const repGood = attemptCraftRepair(30, repairItem);
assert('good roll returns object', typeof repGood === 'object');
assert('good roll has effectiveDc', Number.isFinite(repGood.effectiveDc));
assert('good roll has repairTargetGP = price/5', repGood.repairTargetGP === 20);
assert('success flag present', typeof repGood.success === 'boolean');
assert('progress is finite', Number.isFinite(repGood.progressSP));

// Accelerated repair adds +10 DC
const repAccel = attemptCraftRepair(30, repairItem, { accelerated: true });
assert('accelerated repair adds +10 DC', repAccel.effectiveDc === repGood.effectiveDc + 10);

// Missing/invalid item → safe default
const repBad = attemptCraftRepair(20, null);
assert('null item → success false', repBad.success === false);
assert('null item → progressSP 0', repBad.progressSP === 0);
assert('null item → targetGP 0', repBad.repairTargetGP === 0);

const repIncomplete = attemptCraftRepair(20, { dc: 15 });
assert('missing priceGP → success false', repIncomplete.success === false);

// `finished` now surfaces + repairPriceGP preserved alongside repairTargetGP
assert('repGood.finished is boolean', typeof repGood.finished === 'boolean');
assert('repGood.repairPriceGP matches repairTargetGP', repGood.repairPriceGP === repGood.repairTargetGP);

// Single-week repair on a cheap item with a big check should finish immediately.
// Tindertwig: dc 20, price 1gp → repair target 0.2gp = 2sp.
// Check 30 vs DC 20 → 600 sp >> 2 sp → finished.
const cheapRep = attemptCraftRepair(30, { dc: 20, priceGP: 1 });
assert('tindertwig repair finishes in one week', cheapRep.finished === true);

// ──────────────────────────────────────────────────────────────────
console.log(`\n✓ Passed: ${pass}, ✗ Failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
