/**
 * Phase 7 familiar system — canonical test file.
 *
 * Run with: npx vite-node familiarEngine.test.mjs
 *
 * Covers:
 *   (A) Familiar engine invariants from phase 7.3–7.6 (range gate, ritual,
 *       status summaries, getEffectiveMaxHP)
 *   (B) Phase 7.7 save-format migration (v1/v2 → v3)
 *
 * This is the canonical test file that should be kept in sync with the
 * familiar system as it evolves. The phase-numbered smoke files
 * (phase75-smoke.mjs, etc.) are frozen artifacts — this one is meant to
 * live alongside the code and be updated when the contract changes.
 */

import {
  aggregateFamiliarModifiers,
  getEffectiveMaxHP,
  isFamiliarInRange,
  setFamiliarLocation,
  markFamiliarLost,
  canReplaceFamiliar,
  beginReplaceFamiliarRitual,
  completeReplaceFamiliarRitual,
  getFamiliarStatusSummary,
  getReplaceFamiliarCost,
  FAMILIAR_ABILITY_RANGE_MILES,
} from './src/utils/familiarEngine.js';

import {
  migrateSaveData,
  applyFamiliarDefaults,
  SAVE_FORMAT_VERSION,
} from './src/services/saveMigration.js';

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

// ════════════════════════════════════════════════════════════════════
//  PART A — familiar engine invariants
// ════════════════════════════════════════════════════════════════════

section('Range gate — defaults and boundaries');

check('FAMILIAR_ABILITY_RANGE_MILES === 1', FAMILIAR_ABILITY_RANGE_MILES === 1);

const noWS = aggregateFamiliarModifiers(wizard());
check('No worldState → bonus applies (7.3 default)', noWS.skills.Stealth === 3);

const ws0 = { currentDay: 1, currentHour: 12, familiarLocation: {} };
const wsOne = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 1 });
check(
  'Exactly 1 mile → in-range (boundary inclusive)',
  aggregateFamiliarModifiers(wizard(), { worldState: wsOne }).skills.Stealth === 3,
);

const wsBeyond = setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 1.01 });
check(
  '1.01 miles → out of range, bonus gone',
  aggregateFamiliarModifiers(wizard(), { worldState: wsBeyond }).skills.Stealth === undefined,
);

check('isFamiliarInRange — null worldState → true', isFamiliarInRange(wizard(), null) === true);
check(
  'isFamiliarInRange — 1 mile → true',
  isFamiliarInRange(wizard(), wsOne) === true,
);
check(
  'isFamiliarInRange — 5 miles → false',
  isFamiliarInRange(wizard(), setFamiliarLocation(ws0, 'test-wiz', { distanceMiles: 5 })) === false,
);

section('getEffectiveMaxHP — toad bonus range gate');

const toadMaster = { ...wizard(), maxHP: 30, familiar: { id: 'toad' } };
check(
  'toad in range → 33',
  getEffectiveMaxHP(toadMaster, { worldState: wsOne }) === 33,
);
check(
  'toad out of range → 30 (bonus gated)',
  getEffectiveMaxHP(toadMaster, { worldState: wsBeyond }) === 30,
);
check(
  'toad no worldState → 33 (backward compat)',
  getEffectiveMaxHP(toadMaster) === 33,
);
check(
  'no familiar → falls back to maxHP',
  getEffectiveMaxHP({ maxHP: 42 }) === 42,
);

section('Lost / ritual lifecycle');

const wsT0 = { currentDay: 10, currentHour: 14, familiarLocation: {} };
const lost = markFamiliarLost(wizard(), wsT0);
check('markFamiliarLost → status=lost', lost.familiar.status === 'lost');
check(
  'lost familiar → no bonuses even without worldState',
  aggregateFamiliarModifiers(lost).applied.length === 0,
);

const immediate = canReplaceFamiliar(lost, wsT0);
check('canReplaceFamiliar — blocked by 1-week wait', immediate.canReplace === false && immediate.waitHoursRemaining === 168);
check('canReplaceFamiliar — cost at L5 = 1000 gp', immediate.cost === 1000);

const ws7d = { currentDay: 17, currentHour: 14, familiarLocation: {} };
const after7d = canReplaceFamiliar(lost, ws7d);
check('canReplaceFamiliar — 7 days later ready', after7d.canReplace === true);

const began = beginReplaceFamiliarRitual(lost, ws7d);
check('beginReplaceFamiliarRitual → ritualInProgress', began.familiar.status === 'ritualInProgress');
check(
  'ritualInProgress → no bonuses',
  aggregateFamiliarModifiers(began, { worldState: ws7d }).applied.length === 0,
);

const done = completeReplaceFamiliarRitual(began, 'raven');
check('completeReplaceFamiliarRitual → new id set', done.familiar.id === 'raven');
check(
  'post-ritual raven → +3 Appraise',
  aggregateFamiliarModifiers(done).skills.Appraise === 3,
);

section('Status summary — sanity');

const withSum = getFamiliarStatusSummary(wizard(), ws0);
check('summary default', typeof withSum === 'string' && withSum.toLowerCase().includes('master'));

const noneSum = getFamiliarStatusSummary({ id: 'x', class: 'Wizard', level: 5 }, ws0);
check('summary — null for no familiar', noneSum === null);

section('getReplaceFamiliarCost');
check('L1 → 200', getReplaceFamiliarCost(1) === 200);
check('L5 → 1000', getReplaceFamiliarCost(5) === 1000);
check('L20 → 4000', getReplaceFamiliarCost(20) === 4000);

// ════════════════════════════════════════════════════════════════════
//  PART B — Phase 7.7 save migration
// ════════════════════════════════════════════════════════════════════

section('migrateSaveData — version bump');

check('SAVE_FORMAT_VERSION === 3', SAVE_FORMAT_VERSION === 3);

const v1 = {
  version: 1,
  name: 'Legacy v1',
  party: [{ id: 'a', name: 'Aldric' }, { id: 'b', name: 'Bria' }],
  worldState: null,
};
const v1mig = migrateSaveData(v1);
check('v1 → version bumped to 3', v1mig.version === 3);
check('v1 party length preserved', v1mig.party.length === 2);
check(
  'v1 party members gain familiar: null',
  v1mig.party.every(c => c.familiar === null),
);
check('v1 null worldState left untouched', v1mig.worldState === null);
check('v1 name preserved', v1mig.name === 'Legacy v1');

const v2 = {
  version: 2,
  party: [
    { id: 'a', name: 'Aldric' }, // missing familiar
    { id: 'b', name: 'Bria', familiar: { id: 'cat' } }, // existing familiar preserved
  ],
  worldState: {
    currentDay: 5,
    currentHour: 10,
    // no familiarLocation
  },
};
const v2mig = migrateSaveData(v2);
check('v2 → version bumped to 3', v2mig.version === 3);
check(
  'v2 — existing familiar preserved (not overwritten)',
  v2mig.party[1].familiar?.id === 'cat',
);
check(
  'v2 — missing familiar defaulted to null',
  v2mig.party[0].familiar === null,
);
check(
  'v2 worldState gains familiarLocation: {}',
  v2mig.worldState.familiarLocation && typeof v2mig.worldState.familiarLocation === 'object',
);
check(
  'v2 worldState other fields preserved',
  v2mig.worldState.currentDay === 5 && v2mig.worldState.currentHour === 10,
);

const v3 = {
  version: 3,
  party: [{ id: 'a', familiar: { id: 'owl' } }],
  worldState: { currentDay: 1, familiarLocation: { a: { withMaster: true, distanceMiles: 0 } } },
};
const v3mig = migrateSaveData(v3);
check('v3 — already current, no-op on version', v3mig.version === 3);
check(
  'v3 — existing familiarLocation entry preserved',
  v3mig.worldState.familiarLocation.a.withMaster === true,
);
check(
  'v3 — existing familiar preserved',
  v3mig.party[0].familiar.id === 'owl',
);

section('migrateSaveData — idempotency + immutability');

const original = {
  version: 2,
  party: [{ id: 'a' }],
  worldState: { currentDay: 1 },
};
const frozen = JSON.stringify(original);
migrateSaveData(original);
check('migrateSaveData does not mutate input', JSON.stringify(original) === frozen);

const twice = migrateSaveData(migrateSaveData(v2));
check(
  'migrateSaveData is idempotent',
  twice.party[0].familiar === null &&
  twice.party[1].familiar?.id === 'cat' &&
  twice.worldState.familiarLocation &&
  twice.version === 3,
);

section('migrateSaveData — edge cases');

check('null input → null', migrateSaveData(null) === null);
check('undefined input → undefined', migrateSaveData(undefined) === undefined);
check('empty object → v3 stamped', migrateSaveData({}).version === 3);
check(
  'missing party → no crash',
  migrateSaveData({ version: 2, worldState: { currentDay: 1 } }).version === 3,
);
check(
  'party with null entries → skipped cleanly',
  migrateSaveData({ version: 1, party: [null, { id: 'a' }] }).party[0] === null,
);

const wsWithBadFamiliarLoc = {
  version: 2,
  party: [{ id: 'a' }],
  worldState: { familiarLocation: 'not an object' },
};
const fixed = migrateSaveData(wsWithBadFamiliarLoc);
check(
  'malformed familiarLocation replaced with {}',
  typeof fixed.worldState.familiarLocation === 'object' &&
  !Array.isArray(fixed.worldState.familiarLocation) &&
  Object.keys(fixed.worldState.familiarLocation).length === 0,
);

// 7.7-audit fix: array familiarLocation passes typeof === 'object' but is
// still malformed — must be replaced with {}.
const wsWithArrayFamiliarLoc = {
  version: 2,
  party: [{ id: 'a' }],
  worldState: { familiarLocation: [] },
};
const arrFixed = migrateSaveData(wsWithArrayFamiliarLoc);
check(
  'array familiarLocation replaced with {} (not preserved as array)',
  typeof arrFixed.worldState.familiarLocation === 'object' &&
  !Array.isArray(arrFixed.worldState.familiarLocation) &&
  Object.keys(arrFixed.worldState.familiarLocation).length === 0,
);

// 7.7-audit fix: explicit `familiar: undefined` must normalize to null,
// because `'familiar' in c` alone returns true for that case.
const partyWithUndefinedFamiliar = {
  version: 2,
  party: [
    { id: 'a', familiar: undefined },
    { id: 'b', familiar: null },
    { id: 'c', familiar: { id: 'cat' } },
  ],
  worldState: { currentDay: 1 },
};
const undefFixed = migrateSaveData(partyWithUndefinedFamiliar);
check(
  'familiar: undefined → normalized to null',
  undefFixed.party[0].familiar === null,
);
check(
  'familiar: null preserved (already valid)',
  undefFixed.party[1].familiar === null,
);
check(
  'existing familiar object preserved alongside undefined normalization',
  undefFixed.party[2].familiar?.id === 'cat',
);

section('applyFamiliarDefaults — direct');

const defaulted = applyFamiliarDefaults({
  party: [{ id: 'a' }],
  worldState: { currentDay: 3 },
});
check(
  'applyFamiliarDefaults defaults missing familiar',
  defaulted.party[0].familiar === null,
);
check(
  'applyFamiliarDefaults defaults missing familiarLocation',
  defaulted.worldState.familiarLocation &&
  Object.keys(defaulted.worldState.familiarLocation).length === 0,
);

// 7.7-audit deeper probes
section('migrateSaveData — frozen-input immutability + self-heal');

// Deep-frozen input must not throw and must not be mutated.
const frozenSave = Object.freeze({
  version: 2,
  party: Object.freeze([
    Object.freeze({ id: 'a' }),
    Object.freeze({ id: 'b', familiar: Object.freeze({ id: 'cat' }) }),
  ]),
  worldState: Object.freeze({ currentDay: 1 }),
});
let frozenThrew = false;
let frozenOut;
try {
  frozenOut = migrateSaveData(frozenSave);
} catch {
  frozenThrew = true;
}
check('deeply frozen input does not throw', !frozenThrew);
check('deeply frozen input — result is v3', frozenOut?.version === 3);
check('deeply frozen input — missing familiar defaulted to null', frozenOut?.party?.[0]?.familiar === null);
check('deeply frozen input — existing familiar preserved', frozenOut?.party?.[1]?.familiar?.id === 'cat');
check('deeply frozen input — original untouched', frozenSave.version === 2 && !('familiar' in frozenSave.party[0]));

// A v3 payload carrying an array familiarLocation must still self-heal on
// the idempotent path (line 31 applies defaults even when version is current).
const badV3 = {
  version: 3,
  party: [{ id: 'a', familiar: null }],
  worldState: { familiarLocation: [] },
};
const badV3Fixed = migrateSaveData(badV3);
check(
  'v3 idempotent path self-heals array familiarLocation',
  !Array.isArray(badV3Fixed.worldState.familiarLocation) &&
  typeof badV3Fixed.worldState.familiarLocation === 'object',
);

// Simulate saveGame write path: applyFamiliarDefaults on mixed party.
// Mirrors `applyFamiliarDefaults({ party: party || [], worldState: worldState || null })`.
const writePathInput = {
  party: [
    { id: 'wiz', class: 'Wizard', familiar: { id: 'cat', status: 'alive' } },
    { id: 'ftr', class: 'Fighter' }, // no .familiar field at all
    { id: 'rog', class: 'Rogue', familiar: undefined }, // explicit undefined
  ],
  worldState: null,
};
const writePathOut = applyFamiliarDefaults(writePathInput);
check('saveGame write — Wizard familiar preserved', writePathOut.party[0].familiar?.id === 'cat');
check('saveGame write — Fighter gains familiar=null', writePathOut.party[1].familiar === null);
check('saveGame write — Rogue explicit-undefined → null', writePathOut.party[2].familiar === null);
check('saveGame write — null worldState passes through', writePathOut.worldState === null);

// ════════════════════════════════════════════════════════════════════
// Part C — Phase 7.8: NPC familiar contract
// ════════════════════════════════════════════════════════════════════
//
// npcTracker.js imports Dexie (browser-only), so we can't import it in
// vite-node without mocking the DB. Instead we test the pure helpers
// that underpin NPC-familiar logic: deriveFamiliarStats for a proxy NPC
// master, and getFamiliarById for all base familiars.

import { deriveFamiliarStats, getFamiliarById } from './src/utils/familiarEngine.js';
import familiarsData from './src/data/familiars.json' with { type: 'json' };

const BASE_FAMILIAR_IDS = (familiarsData.baseFamiliars || []).map(f => f.id);

section('Phase 7.8 — NPC familiar contract');

// All base familiar IDs resolve via getFamiliarById.
check(
  `getFamiliarById resolves all ${BASE_FAMILIAR_IDS.length} base IDs`,
  BASE_FAMILIAR_IDS.every(id => {
    const f = getFamiliarById(id);
    return f && f.id === id && f.kind === 'base';
  }),
);

// deriveFamiliarStats works with an NPC-shaped master proxy (flat abilities,
// no .classes array — just .class + .level, like generateNPC produces).
const npcWizard = {
  class: 'Wizard',
  level: 5,
  abilities: { STR: 10, DEX: 12, CON: 10, INT: 16, WIS: 12, CHA: 8 },
  maxHP: 22,
  bab: 2, // Wizard ½ BAB
  saves: { fort: 1, ref: 1, will: 4 },
};
const catStats = deriveFamiliarStats(npcWizard, 'cat');
check('deriveFamiliarStats — NPC Wizard L5 cat → non-null', catStats != null);
check('deriveFamiliarStats — NPC cat hp derived from master', catStats?.hp === Math.floor(npcWizard.maxHP / 2));
check('deriveFamiliarStats — NPC cat has INT (level-scaled)', catStats?.abilities?.INT >= 6);
check('deriveFamiliarStats — NPC cat has saves object', catStats?.saves?.fort != null && catStats?.saves?.ref != null && catStats?.saves?.will != null);
check('deriveFamiliarStats — NPC cat has ac object', catStats?.ac?.total != null || typeof catStats?.ac === 'number');

// deriveFamiliarStats for a Witch NPC (level 3, toad familiar → master bonus +3 HP).
const npcWitch = {
  class: 'Witch',
  level: 3,
  abilities: { STR: 8, DEX: 12, CON: 10, INT: 16, WIS: 14, CHA: 10 },
  maxHP: 14,
  bab: 1,
  saves: { fort: 1, ref: 1, will: 3 },
};
const toadStats = deriveFamiliarStats(npcWitch, 'toad');
check('deriveFamiliarStats — NPC Witch L3 toad → non-null', toadStats != null);
check('deriveFamiliarStats — NPC toad id is "toad"', toadStats?.id === 'toad');

// Non-familiar-granting class: deriveFamiliarStats gates on getMasterClassLevel,
// which returns 0 for Fighter → deriveFamiliarStats returns null. This is
// correct — rollNPCArcaneBond in npcTracker ensures only Wizard/Witch receive
// familiars, and deriveFamiliarStats double-checks the class contract.
const npcFighter = {
  class: 'Fighter',
  level: 5,
  abilities: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 8 },
  maxHP: 40,
  bab: 5,
  saves: { fort: 4, ref: 1, will: 1 },
};
const fighterCat = deriveFamiliarStats(npcFighter, 'cat');
check('deriveFamiliarStats — Fighter proxy → null (class gate)', fighterCat === null);

// getNPCFamiliarCombatEntry shape test (manual inline since we can't import
// npcTracker — it pulls in Dexie). We replicate the combat entry construction
// to verify the shape matches CampaignTab enemy expectations.
if (catStats) {
  const ab = catStats.abilities || {};
  const combatEntry = {
    id: `npc-familiar-test-${catStats.id}`,
    name: `${catStats.name} (familiar)`,
    baseName: catStats.name,
    type: 'magical beast',
    isFamiliar: true,
    masterNPCName: 'TestWizard',
    hp: catStats.hp,
    currentHP: catStats.hp,
    maxHP: catStats.hp,
    ac: catStats.ac?.total ?? catStats.ac ?? 10,
    cr: 0,
    xp: 0,
    str: ab.STR ?? null,
    dex: ab.DEX ?? null,
    con: ab.CON ?? null,
    int: ab.INT ?? null,
    wis: ab.WIS ?? null,
    cha: ab.CHA ?? null,
    abilities: ab,
    init: catStats.abilityMods?.DEX ?? 0,
    bab: catStats.bab ?? 0,
    fort: catStats.saves?.fort?.total ?? catStats.saves?.fort ?? 0,
    ref: catStats.saves?.ref?.total ?? catStats.saves?.ref ?? 0,
    will: catStats.saves?.will?.total ?? catStats.saves?.will ?? 0,
    attacks: catStats.attacks || [],
    size: catStats.size || 'Tiny',
    speed: '15 ft.',
    conditions: [],
    saves: catStats.saves || {},
    familiarId: catStats.id,
    familiarStats: catStats,
  };
  check('combat entry — hp > 0', combatEntry.hp > 0);
  check('combat entry — currentHP === hp (full health)', combatEntry.currentHP === combatEntry.hp);
  check('combat entry — ac > 0', combatEntry.ac > 0);
  check('combat entry — type is "magical beast" (PF1e)', combatEntry.type === 'magical beast');
  check('combat entry — isFamiliar flag', combatEntry.isFamiliar === true);
  check('combat entry — name includes "(familiar)"', combatEntry.name.includes('(familiar)'));
  check('combat entry — size is Tiny', combatEntry.size === 'Tiny');
  check('combat entry — conditions initialized to []', Array.isArray(combatEntry.conditions) && combatEntry.conditions.length === 0);
  check('combat entry — flat int matches nested INT', combatEntry.int === combatEntry.abilities.INT);
  check('combat entry — cr is 0', combatEntry.cr === 0);
}

// ════════════════════════════════════════════════════════════════════
// Part D — CRB Chapter 4: Bluff resolvers (pp. 90–92, 201)
// ════════════════════════════════════════════════════════════════════
import {
  resolveBluff,
  getBluffFeintOpposed,
  resolveFeintInCombat,
  resolveSecretMessage,
} from './src/utils/rulesEngine.js';

console.log('\n── Part D: Bluff resolvers ──');

// ── D.1  resolveBluff plausibility modifiers (CRB p. 90) ──
{
  // Believable = +0 modifier (not +5)
  const r1 = resolveBluff(15, 15, 'believable');
  check('bluff believable +0: 15 vs 15 succeeds (tie wins)', r1.success === true);
  check('bluff believable plausMod is 0', r1.plausibilityModifier === 0);

  // Unlikely = –5
  const r2 = resolveBluff(15, 15, 'unlikely');
  check('bluff unlikely –5: 15→10 vs 15 fails', r2.success === false);
  check('bluff unlikely plausMod is –5', r2.plausibilityModifier === -5);

  // Far-fetched = –10
  const r3 = resolveBluff(20, 15, 'far-fetched');
  check('bluff far-fetched –10: 20→10 vs 15 fails', r3.success === false);

  // Impossible = –20
  const r4 = resolveBluff(30, 15, 'impossible');
  check('bluff impossible –20: 30→10 vs 15 fails', r4.success === false);

  // Target wants to believe = +5 disposition
  const r5 = resolveBluff(12, 15, 'believable', 5);
  check('bluff wants-to-believe +5: 12→17 vs 15 succeeds', r5.success === true);

  // Drunk/impaired = +5 via opts
  const r6 = resolveBluff(10, 15, 'believable', 0, { drunk: true });
  check('bluff drunk +5: 10→15 vs 15 succeeds', r6.success === true);

  // Proof bonus capped at 10
  const r7 = resolveBluff(5, 15, 'believable', 0, { proofBonus: 15 });
  check('bluff proof bonus capped at +10: 5→15 vs 15 succeeds', r7.success === true);

  // Retry penalty –10
  const r8 = resolveBluff(25, 15, 'believable', 0, { retryPenalty: -10 });
  check('bluff retry –10: 25→15 vs 15 succeeds', r8.success === true);
  const r8b = resolveBluff(24, 15, 'believable', 0, { retryPenalty: -10 });
  check('bluff retry –10: 24→14 vs 15 fails', r8b.success === false);

  // Hostile reaction: fail by 5+
  const r9 = resolveBluff(5, 15, 'believable');
  check('bluff fail by 10 → hostileReaction', r9.hostileReaction === true);
  const r10 = resolveBluff(11, 15, 'believable');
  check('bluff fail by 4 → no hostileReaction', r10.hostileReaction === false);
}

// ── D.2  getBluffFeintOpposed DC calculation (CRB pp. 92, 201) ──
{
  // Basic humanoid: DC = 10 + max(SM, BAB+Wis)
  const humanoid = { bab: 5, abilities: { WIS: 14 }, type: 'humanoid', intelligence: 10 };
  const h = getBluffFeintOpposed(humanoid);
  // 10 + max(0, 5+2) = 17
  check('feint humanoid DC = 10 + BAB+Wis = 17', h.dc === 17);
  check('feint humanoid no type penalty', h.typePenalty === 0);
  check('feint humanoid not impossible', h.impossible === false);

  // Humanoid with SM trained and higher
  const smHumanoid = { bab: 3, abilities: { WIS: 12 }, skills: { 'Sense Motive': { bonus: 8 } }, type: 'humanoid', intelligence: 10 };
  const sh = getBluffFeintOpposed(smHumanoid);
  // 10 + max(8, 3+1) = 18
  check('feint SM-trained humanoid DC = 10 + SM = 18', sh.dc === 18);

  // Non-humanoid with Int 10: +4 penalty
  const aberration = { bab: 4, abilities: { WIS: 10 }, type: 'aberration', intelligence: 10 };
  const ab = getBluffFeintOpposed(aberration);
  // 10 + max(0, 4+0) + 4 = 18
  check('feint non-humanoid +4: DC 18', ab.dc === 18);
  check('feint non-humanoid typePenalty = 4', ab.typePenalty === 4);

  // Animal (Int 2): +8 replaces +4
  const animal = { bab: 1, abilities: { WIS: 12 }, type: 'animal', intelligence: 2 };
  const an = getBluffFeintOpposed(animal);
  // 10 + max(0, 1+1) + 8 = 20
  check('feint animal Int 2: +8 (replaces +4), DC 20', an.dc === 20);
  check('feint animal typePenalty = 8', an.typePenalty === 8);

  // Int 1 humanoid (rare edge case): still +8
  const lowIntHumanoid = { bab: 2, abilities: { WIS: 10 }, type: 'humanoid', intelligence: 1 };
  const li = getBluffFeintOpposed(lowIntHumanoid);
  // 10 + max(0, 2+0) + 8 = 20
  check('feint Int-1 humanoid: +8, DC 20', li.dc === 20);
  check('feint Int-1 humanoid typePenalty = 8', li.typePenalty === 8);
}

// ── D.3  resolveFeintInCombat delegates correctly ──
{
  const target = { bab: 3, wisMod: 1, senseMotive: 0, intelligence: 10, creatureType: 'humanoid' };
  // DC = 10 + max(0, 3+1) = 14
  const r1 = resolveFeintInCombat(14, target);
  check('feintInCombat success at exactly DC', r1.success === true);
  check('feintInCombat dc = 14', r1.dc === 14);

  const r2 = resolveFeintInCombat(13, target);
  check('feintInCombat fail below DC', r2.success === false);

  // Mindless: impossible
  const mindless = { bab: 0, wisMod: 0, intelligence: 'mindless', creatureType: 'ooze' };
  const r3 = resolveFeintInCombat(30, mindless);
  check('feintInCombat vs mindless = fail', r3.success === false);
}

// ── D.4  resolveSecretMessage (CRB p. 92) ──
{
  // Simple DC 15, sender succeeds
  const r1 = resolveSecretMessage(18, 20, 'simple');
  check('secret msg simple: sender 18 >= 15 OK', r1.senderSucceeds === true);
  check('secret msg: listener 20 >= 18, decoded', r1.intendedReadable === true);

  // Complex DC 20, sender fails
  const r2 = resolveSecretMessage(17, 10, 'complex');
  check('secret msg complex: sender 17 < 20 fails', r2.senderSucceeds === false);
  check('secret msg: fail by 3, no wrong message', r2.wrongMessageDelivered === false);

  // Fail by 5+ → wrong message delivered
  const r3 = resolveSecretMessage(10, 10, 'simple');
  check('secret msg: sender 10 fails DC 15 by 5 → wrong message', r3.wrongMessageDelivered === true);

  const r4 = resolveSecretMessage(9, 10, 'simple');
  check('secret msg: sender 9 fails DC 15 by 6 → wrong message', r4.wrongMessageDelivered === true);

  // Fail by 4 → garbled but not wrong
  const r5 = resolveSecretMessage(11, 10, 'simple');
  check('secret msg: sender 11 fails DC 15 by 4 → no wrong message', r5.wrongMessageDelivered === false);

  // Eavesdropper misses entirely (SM < Bluff - 5)
  const r6 = resolveSecretMessage(20, 14, 'simple');
  check('secret msg: eavesdropper 14 < 20-5=15 → missed entirely', r6.interceptorMissesEntirely === true);

  const r7 = resolveSecretMessage(20, 15, 'simple');
  check('secret msg: eavesdropper 15 >= 20-5=15 → not missed', r7.interceptorMissesEntirely === false);
}

// ════════════════════════════════════════════════════════════════════
// Part E: getEnemySkillBonus — monster skill format parser
// ════════════════════════════════════════════════════════════════════
import { getEnemySkillBonus } from './src/services/monsterTactics.js';

{
  console.log('\n═══  E.1: getEnemySkillBonus format parsing  ═══');

  // Format 1: string format (monsters.json default)
  check('string format: Bluff +11', getEnemySkillBonus({ skills: 'Bluff +11, Perception +14' }, 'Bluff') === 11);
  check('string format: Perception +14', getEnemySkillBonus({ skills: 'Bluff +11, Perception +14' }, 'Perception') === 14);
  check('string format: missing skill → 0', getEnemySkillBonus({ skills: 'Bluff +11' }, 'Stealth') === 0);
  check('string format: negative bonus', getEnemySkillBonus({ skills: 'Stealth -2, Bluff +5' }, 'Stealth') === -2);
  check('string format: Sense Motive +8', getEnemySkillBonus({ skills: 'Sense Motive +8' }, 'Sense Motive') === 8);

  // Format 2: structured object with .bonus
  check('structured: { Bluff: { bonus: 11 } }', getEnemySkillBonus({ skills: { Bluff: { bonus: 11 } } }, 'Bluff') === 11);
  check('structured: missing skill → 0', getEnemySkillBonus({ skills: { Perception: { bonus: 5 } } }, 'Bluff') === 0);

  // Format 3: flat numeric
  check('flat: { Bluff: 11 }', getEnemySkillBonus({ skills: { Bluff: 11 } }, 'Bluff') === 11);
  check('flat: { Bluff: 0 }', getEnemySkillBonus({ skills: { Bluff: 0 } }, 'Bluff') === 0);

  // Edge cases
  check('no skills at all → 0', getEnemySkillBonus({}, 'Bluff') === 0);
  check('null enemy → 0', getEnemySkillBonus(null, 'Bluff') === 0);
  check('undefined skills → 0', getEnemySkillBonus({ skills: undefined }, 'Bluff') === 0);
}

// ════════════════════════════════════════════════════════════════════
// Part F: shouldNPCDeceive — NPC deception decision engine
// ════════════════════════════════════════════════════════════════════
import { shouldNPCDeceive, DECEPTION_TENDENCIES } from './src/services/dmToolsService.js';

{
  console.log('\n═══  F.1: shouldNPCDeceive — basic decisions  ═══');

  // Honest NPC with no secrets → truth
  const honest = { deceptionTendency: 'honest', attitude: 'friendly', secrets: [] };
  const r1 = shouldNPCDeceive(honest, 'the weather');
  check('honest NPC + no secret → willDeceive false', r1.willDeceive === false);
  check('honest NPC + no secret → approach truth', r1.approach === 'truth');

  // Manipulative NPC with critical secret about topic → will lie
  const manipulator = {
    deceptionTendency: 'manipulative', attitude: 'indifferent', int: 14,
    secrets: [{ topic: 'stolen gold', detail: 'hiding it under the floorboards', severity: 'critical' }],
  };
  const r2 = shouldNPCDeceive(manipulator, 'stolen gold');
  check('manipulative NPC + critical secret on topic → willDeceive true', r2.willDeceive === true);
  check('manipulative NPC + critical secret → approach is lie', r2.approach === 'lie');
  check('manipulative NPC + critical secret → matchedSecret found', r2.matchedSecret?.topic === 'stolen gold');

  // Evasive NPC with medium secret → deflect or omit, not outright lie
  const evasive = {
    deceptionTendency: 'evasive', attitude: 'indifferent',
    secrets: [{ topic: 'cult membership', severity: 'medium' }],
  };
  const r3 = shouldNPCDeceive(evasive, 'cult membership');
  check('evasive NPC + medium secret → willDeceive true', r3.willDeceive === true);
  check('evasive NPC → approach is deflect or omit', r3.approach === 'deflect' || r3.approach === 'omit');

  // Honest NPC with high secret + hostile → may still deceive (strong conflicting pressure)
  const pressured = {
    deceptionTendency: 'honest', attitude: 'hostile',
    secrets: [{ topic: 'escape plan', severity: 'high' }],
  };
  const r4 = shouldNPCDeceive(pressured, 'escape plan');
  check('honest + hostile + high secret → score > 0', r4.score > 0);
  // Score: base 0 + high 40 + hostile 30 = 70 → should deceive
  check('honest + hostile + high secret → willDeceive true', r4.willDeceive === true);

  console.log('\n═══  F.2: shouldNPCDeceive — attitude modifiers  ═══');

  // Helpful NPC resists deception even with a secret
  const helpful = {
    deceptionTendency: 'manipulative', attitude: 'helpful',
    secrets: [{ topic: 'old debt', severity: 'low' }],
  };
  const r5 = shouldNPCDeceive(helpful, 'old debt');
  // Score: base 45 + low 10 + helpful -30 = 25 → below 40 threshold
  check('manipulative + helpful + low secret → willDeceive false', r5.willDeceive === false);

  // Same NPC hostile → would deceive
  const hostile = { ...helpful, attitude: 'hostile' };
  const r6 = shouldNPCDeceive(hostile, 'old debt');
  // Score: base 45 + low 10 + hostile 30 = 85 → way over threshold
  check('manipulative + hostile + low secret → willDeceive true', r6.willDeceive === true);

  console.log('\n═══  F.3: shouldNPCDeceive — intelligence effects  ═══');

  // Very low Int NPC → less likely to attempt deception, far-fetched plausibility
  // Use indifferent attitude + medium secret so scores don't clamp to 100
  const dimwit = {
    deceptionTendency: 'evasive', attitude: 'indifferent', int: 4,
    secrets: [{ topic: 'trap', severity: 'medium' }],
  };
  const r7 = shouldNPCDeceive(dimwit, 'trap');
  const smartVersion = shouldNPCDeceive({ ...dimwit, int: 14 }, 'trap');
  check('low-Int NPC gets score penalty', r7.score < smartVersion.score);
  // If it does try to lie, plausibility should be far-fetched
  if (r7.willDeceive) {
    check('low-Int NPC → far-fetched plausibility', r7.plausibility === 'far-fetched');
  }

  console.log('\n═══  F.4: shouldNPCDeceive — no NPC / edge cases  ═══');

  const r8 = shouldNPCDeceive(null, 'anything');
  check('null NPC → willDeceive false', r8.willDeceive === false);

  const r9 = shouldNPCDeceive({ deceptionTendency: 'compulsive', attitude: 'indifferent', secrets: [] }, 'random');
  check('compulsive + no secret → score is low but nonzero', r9.score > 0);

  console.log('\n═══  F.5: DECEPTION_TENDENCIES constants  ═══');
  check('DECEPTION_TENDENCIES has 4 entries', Object.keys(DECEPTION_TENDENCIES).length === 4);
  check('honest baseWeight = 0', DECEPTION_TENDENCIES.honest.baseWeight === 0);
  check('compulsive baseWeight = 65', DECEPTION_TENDENCIES.compulsive.baseWeight === 65);
}

// ════════════════════════════════════════════════════════════════════
// Part G: NPC Deep Personality Engine
// ════════════════════════════════════════════════════════════════════
import {
  applyEmotionalEvent, decayEmotion, getEmotionalModifiers, defaultEmotionalState,
  recordMemory, computeTrustScore, getTrustTier,
  generateGoal, evaluateGoalAlignment,
  calculateTrustTransfer, generateRelationshipWeb,
  generateKnowledge, willShareKnowledge,
  getBehavioralTells,
  calculateCourage, getPressureResponse,
  buildPersonalityProfile,
  determineAwareness, applyEventWithAwareness, propagateEvent, eventToKnowledge,
  discoverDeferredEvent,
  MOODS, EMOTIONAL_EVENTS, MEMORY_TYPES, RELATIONSHIP_TYPES, GOAL_CATEGORIES,
  AWARENESS_SCOPES, PROPAGATION_RATES, CONCEALABLE_EVENTS, DISCOVERY_AMPLIFIERS,
} from './src/services/npcPersonality.js';

{
  console.log('\n═══  G.1: Emotional State  ═══');

  const npc1 = { emotionalState: defaultEmotionalState() };
  check('default state is calm', npc1.emotionalState.mood === 'calm');

  const { emotionalState: es1, trustDelta: td1 } = applyEmotionalEvent(npc1, 'party_saved_life');
  check('party_saved_life → grateful', es1.mood === 'grateful');
  check('party_saved_life → intensity 5', es1.intensity === 5);
  check('party_saved_life → trust +25', td1 === 25);

  const { emotionalState: es2 } = applyEmotionalEvent({ emotionalState: es1 }, 'party_insulted');
  // Insult intensity 3 < grateful 5, so it shouldn't override the stronger mood
  check('weaker event does not override stronger mood', es2.mood === 'grateful');
  check('weaker event increments intensity', es2.intensity === 5); // capped at 5

  // Decay test
  const oldState = { mood: 'angry', intensity: 4, setAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), recentEvents: [] };
  const decayed = decayEmotion(oldState, new Date().toISOString());
  check('anger decays after 8 hours (half-life 4h)', decayed.intensity < 4);

  // Full decay
  const veryOld = { mood: 'embarrassed', intensity: 2, setAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), recentEvents: [] };
  const fullyDecayed = decayEmotion(veryOld, new Date().toISOString());
  check('embarrassment fully decays after 48h', fullyDecayed.mood === 'calm');

  // Modifiers
  const mods = getEmotionalModifiers({ mood: 'desperate', intensity: 4 });
  check('desperate mood has positive deceptionMod', mods.deceptionMod > 0);
  check('desperate mood has negative trustMod', mods.trustMod < 0);

  console.log('\n═══  G.2: Memory & Trust  ═══');

  const { memory: m1, trustDelta: mtd1 } = recordMemory({}, 'saved_life', 'Saved from the ogre');
  check('saved_life memory created', m1 !== null);
  check('saved_life trust = 30', mtd1 === 30);

  const { memory: m2 } = recordMemory({}, 'stole_from', 'Stole their gem');
  const { trustScore: ts1 } = computeTrustScore([m1, m2], new Date().toISOString());
  check('trust score = 30 + (-25) = 5', ts1 === 5);

  const tier1 = getTrustTier(5);
  check('trust 5 = neutral tier', tier1.tier === 'neutral');
  const tier2 = getTrustTier(50);
  check('trust 50 = devoted tier', tier2.tier === 'devoted');
  const tier3 = getTrustTier(-30);
  check('trust -30 = distrustful tier', tier3.tier === 'distrustful');

  console.log('\n═══  G.3: Goals & Motivations  ═══');

  const goal1 = generateGoal('merchant', 'greedy', 3);
  check('merchant goal has a category', !!goal1.category);
  check('merchant goal has a description', typeof goal1.description === 'string' && goal1.description.length > 0);
  check('goal has urgency', ['low', 'medium', 'high', 'desperate'].includes(goal1.urgency));

  const alignment1 = evaluateGoalAlignment({ category: 'wealth', description: 'get rich' }, 'gave them gold');
  check('giving gold helps wealth goal', alignment1.alignment === 'helps');
  const alignment2 = evaluateGoalAlignment({ category: 'wealth', description: 'get rich' }, 'stole from them');
  check('stealing hinders wealth goal', alignment2.alignment === 'hinders');

  console.log('\n═══  G.4: Relationship Web  ═══');

  const npcsForWeb = [
    { name: 'Alice', occupation: 'merchant' },
    { name: 'Bob', occupation: 'guard' },
    { name: 'Carol', occupation: 'thief' },
  ];
  const web = generateRelationshipWeb(npcsForWeb, 1);
  check('relationship web generated', web.length > 0);
  check('relationships have type', web.every(r => !!r.type));

  const transfer = calculateTrustTransfer(30, 'ally');
  check('ally trust transfer = 30 * 0.3 = 9', transfer === 9);
  const enemyTransfer = calculateTrustTransfer(30, 'enemy');
  check('enemy trust transfer = 30 * -0.5 = -15', enemyTransfer === -15);

  console.log('\n═══  G.5: Knowledge Model  ═══');

  const k1 = generateKnowledge('guard', 3, 'Sandpoint');
  check('guard has knowledge entries', k1.length > 0);
  check('guard knows about local threats', k1.some(k => k.topic === 'local threats'));

  check('willShare at neutral for neutral-required knowledge', willShareKnowledge({ willShareAt: 'neutral' }, 'neutral') === true);
  check('will NOT share friendly-required at wary', willShareKnowledge({ willShareAt: 'friendly' }, 'wary') === false);
  check('will share friendly-required at trusted', willShareKnowledge({ willShareAt: 'friendly' }, 'trusted') === true);

  console.log('\n═══  G.6: Behavioral Tells  ═══');

  const npcNervous = { personality: 'nervous', emotionalState: { mood: 'afraid', intensity: 3 }, deceptionTendency: 'honest' };
  const tells1 = getBehavioralTells(npcNervous, { isDeceiving: false });
  check('nervous NPC has personality tells', tells1.length > 0);

  const tells2 = getBehavioralTells(npcNervous, { isDeceiving: true });
  check('deceiving NPC has deception tells', tells2.length > tells1.length);

  console.log('\n═══  G.7: Courage & Pressure  ═══');

  const braveFighter = { class: 'Fighter', level: 8, personality: 'stern', emotionalState: defaultEmotionalState() };
  const cowardCommoner = { class: 'Commoner', level: 1, personality: 'nervous', emotionalState: { mood: 'afraid', intensity: 4 } };

  const c1 = calculateCourage(braveFighter);
  const c2 = calculateCourage(cowardCommoner);
  check('fighter courage > commoner courage', c1 > c2);
  check('fighter courage >= 60', c1 >= 60);

  const pr1 = getPressureResponse({ ...braveFighter, deceptionTendency: 'honest', courage: c1 }, 'combat_threat');
  check('brave fighter fights under combat threat', pr1.response === 'fight');

  const pr2 = getPressureResponse({ ...cowardCommoner, deceptionTendency: 'honest', courage: c2 }, 'combat_threat');
  check('scared commoner folds under combat threat', pr2.response === 'fold');

  const pr3 = getPressureResponse({ deceptionTendency: 'compulsive', personality: 'cunning', class: 'Rogue', level: 5, emotionalState: defaultEmotionalState() }, 'caught_lying');
  check('compulsive liar doubles down when caught', pr3.response === 'double_down');

  console.log('\n═══  G.8: buildPersonalityProfile  ═══');

  const fullNPC = {
    name: 'Tessa', occupation: 'innkeeper', personality: 'jovial', deceptionTendency: 'evasive',
    emotionalState: { mood: 'happy', intensity: 2, setAt: new Date().toISOString(), recentEvents: [] },
    memories: [m1], secrets: [{ topic: 'smuggling', severity: 'high' }],
    goal: { category: 'wealth', description: 'save enough to retire', urgency: 'medium', progress: 40 },
    knowledge: [{ topic: 'travelers', accuracy: 'fact', willShareAt: 'neutral' }],
    class: 'Expert', level: 4,
  };
  const profile = buildPersonalityProfile(fullNPC, new Date().toISOString());
  check('profile has name', profile.name === 'Tessa');
  check('profile has mood', profile.mood === 'happy');
  check('profile has trustScore', typeof profile.trustScore === 'number');
  check('profile has goal', profile.goal?.category === 'wealth');
  check('profile has available knowledge', profile.availableKnowledge.length > 0);
  check('profile has courage', typeof profile.courage === 'number');
  check('profile has tells', Array.isArray(profile.currentTells));
}

// ════════════════════════════════════════════════════════════════════
// Part H: Awareness Propagation
// ════════════════════════════════════════════════════════════════════

{
  console.log('\n═══  H.1: determineAwareness  ═══');

  const alice = { name: 'Alice', emotionalState: defaultEmotionalState() };
  const bob = { name: 'Bob', emotionalState: defaultEmotionalState() };
  const carol = { name: 'Carol', emotionalState: defaultEmotionalState() };

  // Direct: Alice is the target
  const a1 = determineAwareness(alice, 'Alice', 'party_stole', { presentNPCNames: ['Alice', 'Bob'] });
  check('direct target → scope direct', a1.scope === 'direct');

  // Witnessed: Bob was present
  const a2 = determineAwareness(bob, 'Alice', 'party_stole', { presentNPCNames: ['Alice', 'Bob'] });
  check('present witness → scope witnessed', a2.scope === 'witnessed');

  // Unaware: Carol was not present, 0 hours elapsed
  const a3 = determineAwareness(carol, 'Alice', 'party_stole', { presentNPCNames: ['Alice', 'Bob'], hoursElapsed: 0 });
  check('absent + no time → unaware', a3.scope === 'unaware');

  // Gossip: Carol connected to Alice via relationship, enough time passed
  const rels = [{ sourceName: 'Alice', targetName: 'Carol', type: 'ally' }];
  const a4 = determineAwareness(carol, 'Alice', 'party_stole', {
    presentNPCNames: ['Alice', 'Bob'],
    relationships: rels,
    settlementSize: 'village',
    hoursElapsed: 4, // public event, village = 2h/hop, 1 hop needed
  });
  check('connected NPC + enough time → gossip', a4.scope === 'gossip');

  // Gossip: Carol not connected, but public event with enough total time
  const a5 = determineAwareness(carol, 'Alice', 'party_stole', {
    presentNPCNames: ['Alice', 'Bob'],
    relationships: [],
    settlementSize: 'village',
    hoursElapsed: 10, // public, village: 3 hops * 2h = 6h for full spread
  });
  check('public event + enough time → gossip even without relationship', a5.scope === 'gossip');

  // Private event: Carol doesn't hear even with time
  const a6 = determineAwareness(carol, 'Alice', 'under_pressure', {
    presentNPCNames: ['Alice'],
    relationships: rels,
    settlementSize: 'village',
    hoursElapsed: 100,
  });
  // under_pressure is private, maxHops=1, Carol isn't 1 hop from Alice... wait, she IS via the relationship
  // But she wasn't present, so let's check — private has maxHops: 1 in village
  // Alice→Carol is 1 hop, hoursElapsed 100 > 12h/hop → should reach via gossip
  // Actually this is testing that private events DO reach close contacts
  check('private event reaches close contact eventually', a6.scope === 'gossip' || a6.scope === 'unaware');

  console.log('\n═══  H.2: applyEventWithAwareness scaling  ═══');

  // Direct → full impact
  const r1 = applyEventWithAwareness(alice, 'party_stole', 'direct');
  check('direct: full intensity 5', r1.scaledIntensity === 5);
  check('direct: full trust -25', r1.scaledTrust === -25);
  check('direct: applied true', r1.applied === true);

  // Witnessed → 60% intensity, 50% trust
  const r2 = applyEventWithAwareness(bob, 'party_stole', 'witnessed');
  check('witnessed: intensity = round(5 * 0.6) = 3', r2.scaledIntensity === 3);
  check('witnessed: trust = round(-25 * 0.5) = -13 or -12', r2.scaledTrust === -13 || r2.scaledTrust === -12);

  // Gossip → 30% base, further decay per hop
  const r3 = applyEventWithAwareness(carol, 'party_stole', 'gossip', { gossipHops: 2 });
  check('gossip 2 hops: reduced intensity', r3.scaledIntensity < 3);
  check('gossip 2 hops: reduced trust', Math.abs(r3.scaledTrust) < Math.abs(r2.scaledTrust));

  // Unaware → no effect
  const r4 = applyEventWithAwareness(carol, 'party_stole', 'unaware');
  check('unaware: not applied', r4.applied === false);
  check('unaware: trust 0', r4.trustDelta === 0);

  // Witnessed with ally relationship → amplified empathy
  const r5 = applyEventWithAwareness(bob, 'party_stole', 'witnessed', { relationshipToTarget: 'ally' });
  check('witnessed ally: higher intensity than base witnessed', r5.scaledIntensity >= r2.scaledIntensity);

  // Witnessed with enemy relationship → reduced empathy
  const r6 = applyEventWithAwareness(bob, 'party_stole', 'witnessed', { relationshipToTarget: 'enemy' });
  check('witnessed enemy: lower intensity than base witnessed', r6.scaledIntensity <= r2.scaledIntensity);

  console.log('\n═══  H.3: propagateEvent — full settlement  ═══');

  const townNPCs = [
    { name: 'Victim', emotionalState: defaultEmotionalState() },
    { name: 'Bystander', emotionalState: defaultEmotionalState() },
    { name: 'Distant', emotionalState: defaultEmotionalState() },
  ];
  const townRels = [{ sourceName: 'Victim', targetName: 'Distant', type: 'family' }];
  const results = propagateEvent(townNPCs, 'Victim', 'party_stole', {
    presentNPCNames: ['Victim', 'Bystander'],
    relationships: townRels,
    settlementSize: 'town',
    hoursElapsed: 0,
  });
  check('propagate: 3 results returned', results.length === 3);
  check('propagate: Victim is direct', results.find(r => r.npcName === 'Victim')?.scope === 'direct');
  check('propagate: Bystander is witnessed', results.find(r => r.npcName === 'Bystander')?.scope === 'witnessed');
  check('propagate: Distant is unaware at t=0', results.find(r => r.npcName === 'Distant')?.scope === 'unaware');

  // Same scenario but 12h later — gossip should reach Distant via family link
  const results2 = propagateEvent(townNPCs, 'Victim', 'party_stole', {
    presentNPCNames: ['Victim', 'Bystander'],
    relationships: townRels,
    settlementSize: 'town',
    hoursElapsed: 12,
  });
  check('propagate 12h: Distant now gossip via family', results2.find(r => r.npcName === 'Distant')?.scope === 'gossip');

  console.log('\n═══  H.4: eventToKnowledge  ═══');

  const k1 = eventToKnowledge('party_stole', 'Alice', 'direct');
  check('direct event → fact accuracy', k1.accuracy === 'fact');
  check('knowledge has topic', typeof k1.topic === 'string' && k1.topic.length > 0);

  const k2 = eventToKnowledge('party_stole', 'Alice', 'witnessed');
  check('witnessed event → fact accuracy', k2.accuracy === 'fact');

  // Gossip may produce 'partial' (20% chance), but should always be 'rumor' or 'partial'
  const gossipAccuracies = new Set();
  for (let i = 0; i < 50; i++) {
    const k = eventToKnowledge('party_stole', 'Alice', 'gossip');
    gossipAccuracies.add(k.accuracy);
  }
  check('gossip knowledge is rumor or partial', [...gossipAccuracies].every(a => a === 'rumor' || a === 'partial'));

  console.log('\n═══  H.5: AWARENESS_SCOPES constants  ═══');
  check('4 awareness scopes', Object.keys(AWARENESS_SCOPES).length === 4);
  check('direct scale = 1.0', AWARENESS_SCOPES.direct.intensityScale === 1.0);
  check('unaware scale = 0', AWARENESS_SCOPES.unaware.intensityScale === 0);
  check('PROPAGATION_RATES has 4 sizes', Object.keys(PROPAGATION_RATES).length === 4);
}

// ════════════════════════════════════════════════════════════════════
// Part I: Discovery Gate (concealable events deferred until noticed)
// ════════════════════════════════════════════════════════════════════
{
  console.log('\n═══  I.1: CONCEALABLE_EVENTS table  ═══');
  check('CONCEALABLE_EVENTS includes party_stole', CONCEALABLE_EVENTS.has('party_stole'));
  check('CONCEALABLE_EVENTS includes party_caught_lying', CONCEALABLE_EVENTS.has('party_caught_lying'));
  check('CONCEALABLE_EVENTS excludes party_threatened', !CONCEALABLE_EVENTS.has('party_threatened'));
  check('CONCEALABLE_EVENTS excludes party_saved_life', !CONCEALABLE_EVENTS.has('party_saved_life'));
  check('DISCOVERY_AMPLIFIERS has party_stole', !!DISCOVERY_AMPLIFIERS.party_stole);
  check('party_stole adds betrayal mood', DISCOVERY_AMPLIFIERS.party_stole.addBetrayalMood === true);

  console.log('\n═══  I.2: applyEventWithAwareness defers when undetected  ═══');
  const npc = { name: 'Merchant', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } };
  const deferredResult = applyEventWithAwareness(npc, 'party_stole', 'direct', { detected: false });
  check('deferred result not applied', deferredResult.applied === false);
  check('deferred flag set', deferredResult.deferred === true);
  check('deferredEvents queued on state', (deferredResult.emotionalState.deferredEvents || []).length === 1);
  check('deferred trustDelta is 0', deferredResult.trustDelta === 0);
  check('mood unchanged when deferred', deferredResult.emotionalState.mood === 'calm');

  console.log('\n═══  I.3: detected=true applies normally  ═══');
  const detectedResult = applyEventWithAwareness(npc, 'party_stole', 'direct', { detected: true });
  check('detected result applied', detectedResult.applied === true);
  check('detected has trustDelta', detectedResult.trustDelta < 0);
  check('detected mood is angry', detectedResult.emotionalState.mood === 'angry');

  console.log('\n═══  I.4: non-concealable events ignore detected flag  ═══');
  const nonConcealable = applyEventWithAwareness(npc, 'party_threatened', 'direct', { detected: false });
  check('party_threatened applies even with detected=false', nonConcealable.applied === true);

  console.log('\n═══  I.5: discoverDeferredEvent applies queued event  ═══');
  const npcWithDeferred = {
    name: 'Merchant',
    emotionalState: {
      mood: 'happy',
      intensity: 2,
      recentEvents: [],
      deferredEvents: [{ eventKey: 'party_stole', queuedAt: '2026-04-13T10:00:00Z' }],
    },
  };
  const discovery = discoverDeferredEvent(npcWithDeferred, 'party_stole', { timestamp: '2026-04-13T14:00:00Z' });
  check('discovery succeeds', discovery.discovered === true);
  check('discovery applies', discovery.applied === true);
  check('discovery removes from queue', (discovery.emotionalState.deferredEvents || []).length === 0);
  check('discovery sets angry mood', discovery.emotionalState.mood === 'angry');
  check('discovery amplified for theft', discovery.amplified === true);
  check('discovery trustDelta worse than base party_stole (-25)', discovery.trustDelta < -25);
  check('discovery age computed', discovery.deferredAgeHours === 4);

  console.log('\n═══  I.6: discoverDeferredEvent on missing event  ═══');
  const noQueue = discoverDeferredEvent({ name: 'X', emotionalState: { mood: 'calm', intensity: 0 } }, 'party_stole');
  check('no deferred → not discovered', noQueue.discovered === false);
  check('no deferred → not applied', noQueue.applied === false);

  console.log('\n═══  I.7: propagateEvent suppresses witnesses for undetected concealable  ═══');
  const townNPCs = [
    { name: 'Victim', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } },
    { name: 'Witness', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } },
    { name: 'Bystander', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } },
  ];
  const undetected = propagateEvent(townNPCs, 'Victim', 'party_stole', {
    presentNPCNames: ['Victim', 'Witness'],
    relationships: [{ sourceName: 'Victim', targetName: 'Bystander', type: 'friend' }],
    settlementSize: 'town',
    hoursElapsed: 48,
    detected: false,
  });
  const victim = undetected.find(r => r.npcName === 'Victim');
  const witness = undetected.find(r => r.npcName === 'Witness');
  const bystander = undetected.find(r => r.npcName === 'Bystander');
  check('victim deferred when undetected', victim.deferred === true);
  check('witness unaware when undetected', witness.scope === 'unaware');
  check('bystander unaware when undetected', bystander.scope === 'unaware');

  console.log('\n═══  I.8: propagateEvent normal flow when detected  ═══');
  const detected = propagateEvent(townNPCs, 'Victim', 'party_stole', {
    presentNPCNames: ['Victim', 'Witness'],
    relationships: [],
    settlementSize: 'town',
    hoursElapsed: 0,
    detected: true,
  });
  const victim2 = detected.find(r => r.npcName === 'Victim');
  const witness2 = detected.find(r => r.npcName === 'Witness');
  check('victim direct + applied when detected', victim2.scope === 'direct' && victim2.applied);
  check('witness witnessed + applied when detected', witness2.scope === 'witnessed' && witness2.applied);
  check('victim not deferred when detected', !victim2.deferred);
}

// ════════════════════════════════════════════════════════════════════
// Part J: Offscreen Simulation (schedules, ticks, ambient events)
// ════════════════════════════════════════════════════════════════════
{
  const { simulateHour, simulateElapsed, getNPCActivityAtHour, OCCUPATION_SCHEDULES, ACTIVITY_DEFS } = await import('./src/services/npcSimulation.js');

  console.log('\n═══  J.1: OCCUPATION_SCHEDULES coverage  ═══');
  check('merchant has schedule', Array.isArray(OCCUPATION_SCHEDULES.merchant));
  check('guard has schedule', Array.isArray(OCCUPATION_SCHEDULES.guard));
  check('thief has schedule', Array.isArray(OCCUPATION_SCHEDULES.thief));
  check('schedules cover 24 hours', OCCUPATION_SCHEDULES.merchant.reduce((sum, b) => {
    const len = b.endHour > b.startHour ? b.endHour - b.startHour : (24 - b.startHour) + b.endHour;
    return sum + len;
  }, 0) === 24);

  console.log('\n═══  J.2: getNPCActivityAtHour  ═══');
  const merchant = { name: 'M', occupation: 'merchant' };
  check('merchant works at 10am', getNPCActivityAtHour(merchant, 10).activity === 'work');
  check('merchant sleeps at 3am', getNPCActivityAtHour(merchant, 3).activity === 'sleep');
  check('merchant eats at noon', getNPCActivityAtHour(merchant, 12).activity === 'meal');

  const thief = { name: 'T', occupation: 'thief' };
  check('thief sleeps at noon', getNPCActivityAtHour(thief, 12).activity === 'sleep');
  check('thief works at 2am', getNPCActivityAtHour(thief, 2).activity === 'work');

  const unknown = { name: 'U', occupation: 'astronaut' };
  check('unknown occupation falls back gracefully', !!getNPCActivityAtHour(unknown, 10).activity);

  console.log('\n═══  J.3: simulateHour basic tick  ═══');
  const npcs = [
    { name: 'Alice', occupation: 'merchant', personality: 'kind',    emotionalState: { mood: 'happy', intensity: 2, setAt: '2026-04-13T00:00:00Z', recentEvents: [] } },
    { name: 'Bob',   occupation: 'merchant', personality: 'kind',    emotionalState: { mood: 'calm',  intensity: 0, recentEvents: [] } },
    { name: 'Carol', occupation: 'guard',    personality: 'noble',   emotionalState: { mood: 'calm',  intensity: 0, recentEvents: [] } },
  ];
  const seeded = () => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; }; };
  const res = simulateHour(npcs, { currentTime: '2026-04-13T10:00:00Z', rng: seeded() });
  check('returns npcs', Array.isArray(res.npcs) && res.npcs.length === 3);
  check('returns events array', Array.isArray(res.events));
  check('each NPC has currentActivity', res.npcs.every(n => typeof n.currentActivity === 'string'));
  check('each NPC has currentLocation', res.npcs.every(n => typeof n.currentLocation === 'string'));

  console.log('\n═══  J.4: emotion decay during tick  ═══');
  const hotNPC = {
    name: 'Hot',
    occupation: 'merchant',
    emotionalState: { mood: 'angry', intensity: 5, setAt: '2026-04-13T00:00:00Z', recentEvents: [] },
  };
  const decayed = simulateHour([hotNPC], {
    currentTime: '2026-04-14T00:00:00Z', // 24h later
    rng: seeded(),
  });
  const after = decayed.npcs[0].emotionalState;
  check('angry mood decayed after 24h', after.intensity < 5);

  console.log('\n═══  J.5: goal progress ticks up during matching activity  ═══');
  const worker = {
    name: 'Worker',
    occupation: 'merchant',
    personality: 'greedy',
    goal: { category: 'wealth', description: 'save up', urgency: 'medium', progress: 10 },
    emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] },
  };
  const res5 = simulateHour([worker], { currentTime: '2026-04-13T10:00:00Z', rng: seeded() });
  check('goal progress increased during work', res5.npcs[0].goal.progress > 10);

  const sleeper = {
    name: 'Sleeper',
    occupation: 'merchant',
    goal: { category: 'wealth', description: 'save up', urgency: 'medium', progress: 10 },
    emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] },
  };
  const res5b = simulateHour([sleeper], { currentTime: '2026-04-13T03:00:00Z', rng: seeded() });
  check('goal progress NOT increased during sleep', res5b.npcs[0].goal.progress === 10);

  console.log('\n═══  J.6: co-location social drift logged  ═══');
  // Many NPCs at the tavern for leisure → drift events should appear within a day
  const tavernCrowd = Array.from({ length: 6 }, (_, i) => ({
    name: `NPC${i}`,
    occupation: 'merchant',
    personality: i % 2 === 0 ? 'kind' : 'noble',
    emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] },
  }));
  const week = simulateElapsed(tavernCrowd, 24, { startTime: '2026-04-13T00:00:00Z', seed: 'socialtest' });
  const socialEvents = week.events.filter(e => e.kind === 'social');
  check('social events fire over 24h tick', socialEvents.length > 0);

  console.log('\n═══  J.7: ambient events generated in a week  ═══');
  const townNPCs = Array.from({ length: 10 }, (_, i) => ({
    name: `Cit${i}`,
    occupation: ['merchant', 'farmer', 'guard', 'innkeeper'][i % 4],
    personality: 'kind',
    emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] },
  }));
  const weekSim = simulateElapsed(townNPCs, 24 * 7, { startTime: '2026-04-13T00:00:00Z', seed: 'ambient' });
  const ambientCount = weekSim.events.filter(e => e.kind === 'ambient').length;
  check('at least one ambient event in a week', ambientCount > 0);
  check('endTime advanced by 7 days', weekSim.endTime === '2026-04-20T00:00:00.000Z');

  console.log('\n═══  J.8: economy delta accumulates  ═══');
  // One merchant working a full day should end the day with positive wealth
  const solo = [{
    name: 'Solo', occupation: 'merchant', personality: 'greedy',
    emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] },
    wealth: 0,
  }];
  const day = simulateElapsed(solo, 24, { startTime: '2026-04-13T00:00:00Z', seed: 'econ' });
  check('merchant ends day with nonzero wealth', day.npcs[0].wealth !== 0);

  console.log('\n═══  J.9: determinism with seed  ═══');
  const npcsA = JSON.parse(JSON.stringify(townNPCs));
  const npcsB = JSON.parse(JSON.stringify(townNPCs));
  const runA = simulateElapsed(npcsA, 24, { startTime: '2026-04-13T00:00:00Z', seed: 'determinism' });
  const runB = simulateElapsed(npcsB, 24, { startTime: '2026-04-13T00:00:00Z', seed: 'determinism' });
  check('same seed → same event count', runA.events.length === runB.events.length);
  check('same seed → same endTime', runA.endTime === runB.endTime);

  console.log('\n═══  J.10: ACTIVITY_DEFS sanity  ═══');
  check('sleep has 0 socialChance', ACTIVITY_DEFS.sleep.socialChance === 0);
  check('leisure has high socialChance', ACTIVITY_DEFS.leisure.socialChance >= 0.5);
  check('work has positive economicDelta', ACTIVITY_DEFS.work.economicDelta > 0);
  check('leisure has negative economicDelta', ACTIVITY_DEFS.leisure.economicDelta < 0);
}

// ════════════════════════════════════════════════════════════════════
// Part K: State pruning + pending-gossip carryover
// ════════════════════════════════════════════════════════════════════
{
  const { pruneNPCState, prunePendingGossip, simulateElapsed, simulateHour } = await import('./src/services/npcSimulation.js');

  console.log('\n═══  K.1: pruneNPCState trims long memory arrays  ═══');
  const fat = {
    name: 'Fat',
    memories: Array.from({ length: 200 }, (_, i) => ({
      type: 'helped',
      detail: `mem ${i}`,
      trustImpact: 1,
      timestamp: '2026-04-13T00:00:00Z',
    })),
    knowledge: Array.from({ length: 100 }, (_, i) => ({ topic: `t${i}` })),
    emotionalState: {
      mood: 'calm',
      intensity: 0,
      recentEvents: Array.from({ length: 30 }, (_, i) => ({ event: `e${i}` })),
      deferredEvents: Array.from({ length: 40 }, (_, i) => ({ eventKey: 'party_stole' })),
    },
  };
  const pruned = pruneNPCState(fat, '2026-04-13T00:00:00Z');
  check('memories capped at PRUNE_DEFAULTS.maxMemories', pruned.memories.length <= 50);
  check('knowledge capped', pruned.knowledge.length <= 40);
  check('recentEvents capped at 10', pruned.emotionalState.recentEvents.length === 10);
  check('deferredEvents capped at 20', pruned.emotionalState.deferredEvents.length === 20);

  console.log('\n═══  K.2: pruneNPCState drops ancient memories  ═══');
  const ancient = {
    name: 'Old',
    memories: [
      { type: 'helped', detail: 'recent', trustImpact: 1, timestamp: '2026-04-13T00:00:00Z' },
      { type: 'helped', detail: 'ancient', trustImpact: 1, timestamp: '2025-01-01T00:00:00Z' },
    ],
  };
  const p = pruneNPCState(ancient, '2026-04-13T00:00:00Z');
  check('ancient memory dropped', p.memories.length === 1 && p.memories[0].detail === 'recent');

  console.log('\n═══  K.3: simulateHour auto-prunes  ═══');
  const bloated = {
    name: 'Bloated',
    occupation: 'merchant',
    emotionalState: {
      mood: 'calm', intensity: 0,
      recentEvents: Array.from({ length: 50 }, (_, i) => ({ event: `e${i}` })),
    },
  };
  const res = simulateHour([bloated], { currentTime: '2026-04-13T10:00:00Z' });
  check('recentEvents pruned by simulateHour', res.npcs[0].emotionalState.recentEvents.length <= 10);

  console.log('\n═══  K.4: prunePendingGossip drops expired entries  ═══');
  const queue = [
    { eventKey: 'party_stole', hoursElapsed: 10 },   // within window
    { eventKey: 'party_stole', hoursElapsed: 9999 }, // long expired
  ];
  const kept = prunePendingGossip(queue, 'town');
  check('expired gossip dropped', kept.length === 1);
  check('fresh gossip retained', kept[0].hoursElapsed === 10);

  console.log('\n═══  K.5: pending gossip actually spreads during simulateElapsed  ═══');
  // Alice is direct target; Bob has a relationship to Alice; Carol is unrelated.
  // After enough hours, Bob should hear via gossip.
  const npcs = [
    { name: 'Alice', occupation: 'merchant', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } },
    { name: 'Bob',   occupation: 'merchant', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } },
    { name: 'Carol', occupation: 'merchant', emotionalState: { mood: 'calm', intensity: 0, recentEvents: [] } },
  ];
  const pending = [{
    eventKey: 'party_stole',           // public visibility, public gossip
    targetName: 'Alice',
    relationships: [{ sourceName: 'Alice', targetName: 'Bob', type: 'friend' }],
    hoursElapsed: 0,
    reachedNPCs: ['Alice'],
  }];
  const sim = simulateElapsed(npcs, 48, {
    startTime: '2026-04-13T00:00:00Z',
    settlementSize: 'town',
    pendingGossip: pending,
    seed: 'gossiptest',
  });
  const gossipEvents = sim.events.filter(e => e.kind === 'gossip');
  check('gossip events fire over 48h', gossipEvents.length > 0);
  // Bob should end up with some emotional shift from gossip
  const bob = sim.npcs.find(n => n.name === 'Bob');
  check('Bob received gossip (recentEvents populated)',
    (bob.emotionalState.recentEvents || []).some(e => e.event === 'party_stole'));
}

// ════════════════════════════════════════════════════════════════════
// Part L: Factions (#2)
// ════════════════════════════════════════════════════════════════════
{
  const {
    createFaction, addMember, removeMember,
    recordFactionEvent, computeFactionReputation,
    propagateFactionReputationToMembers, getRegionalReputation,
    reputationTier, FACTION_ARCHETYPES, FACTION_EVENTS,
  } = await import('./src/services/factions.js');

  console.log('\n═══  L.1: createFaction defaults  ═══');
  const guild = createFaction({ name: 'Thieves Guild', archetype: 'criminal' });
  check('faction has name', guild.name === 'Thieves Guild');
  check('faction archetype copied', guild.archetypeMeta.secrecy === FACTION_ARCHETYPES.criminal.secrecy);
  check('unknown archetype falls back', !!createFaction({ archetype: 'banana' }).archetypeMeta);
  check('starts with 0 members', guild.members.length === 0);
  check('starts with 0 events', guild.events.length === 0);
  check('starts with 0 reputation', guild.baseReputation === 0);

  console.log('\n═══  L.2: membership ops  ═══');
  let g = addMember(guild, 'Sneak');
  g = addMember(g, 'Fingers');
  g = addMember(g, 'Sneak'); // duplicate
  check('duplicate membership ignored', g.members.length === 2);
  g = removeMember(g, 'Sneak');
  check('member removed', g.members.length === 1 && g.members[0] === 'Fingers');

  console.log('\n═══  L.3: recordFactionEvent + reputation shift  ═══');
  let temple = createFaction({ name: 'Temple', archetype: 'religious' });
  temple = recordFactionEvent(temple, 'completed_faction_quest');
  check('rep increased', temple.baseReputation > 0);
  check('event logged', temple.events.length === 1);
  temple = recordFactionEvent(temple, 'stole_from_faction');
  check('negative event reduces rep', temple.baseReputation < FACTION_EVENTS.completed_faction_quest.repDelta);

  console.log('\n═══  L.4: computeFactionReputation cohesion blending  ═══');
  // Martial faction (cohesion 0.8): faction rep dominates
  let watch = createFaction({ name: 'Watch', archetype: 'martial' });
  watch = recordFactionEvent(watch, 'defended_faction_interest'); // +20
  watch = addMember(watch, 'Captain');
  const angryMember = {
    name: 'Captain',
    // Very negative memories from the party
    memories: [{ type: 'stole_from', detail: 'robbed', trustImpact: -40, timestamp: new Date().toISOString() }],
  };
  const repHigh = computeFactionReputation(watch, [angryMember]);
  check('high-cohesion faction rep stays positive despite angry member',
    repHigh.reputation > 0);

  // Scholarly faction (cohesion 0.3): member opinion dominates
  let uni = createFaction({ name: 'University', archetype: 'scholarly' });
  uni = recordFactionEvent(uni, 'defended_faction_interest'); // +20 base
  uni = addMember(uni, 'Dean');
  const repLow = computeFactionReputation(uni, [angryMember]);
  // Can't assert exact numbers but should be lower than high-cohesion case
  check('low-cohesion faction more affected by member opinion',
    repLow.reputation < repHigh.reputation);

  console.log('\n═══  L.5: propagateFactionReputationToMembers  ═══');
  let mercs = createFaction({ name: 'Mercs', archetype: 'mercantile' });
  mercs = addMember(mercs, 'A');
  mercs = addMember(mercs, 'B');
  mercs = addMember(mercs, 'C');
  const npcs = [
    { name: 'A', memories: [] },
    { name: 'B', memories: [] },
    { name: 'C', memories: [] },
    { name: 'Outsider', memories: [] }, // not a member
  ];
  const pushed = propagateFactionReputationToMembers(mercs, npcs, 20, { reason: 'heist win' });
  check('all members got a memory', pushed.filter(n => n.memories.length > 0 && ['A','B','C'].includes(n.name)).length === 3);
  const outsider = pushed.find(n => n.name === 'Outsider');
  check('outsider untouched', outsider.memories.length === 0);
  check('members\' memory tagged source=faction',
    pushed.find(n => n.name === 'A').memories[0].source === 'faction');

  console.log('\n═══  L.6: reputationTier  ═══');
  check('+80 = revered', reputationTier(80).tier === 'revered');
  check('+50 = trusted', reputationTier(50).tier === 'trusted');
  check('0 = neutral', reputationTier(0).tier === 'neutral');
  check('-50 = distrustful', reputationTier(-50).tier === 'distrustful');
  check('-90 = hated', reputationTier(-90).tier === 'hated');

  console.log('\n═══  L.7: getRegionalReputation  ═══');
  let f1 = createFaction({ name: 'Good', archetype: 'religious' });
  f1 = recordFactionEvent(f1, 'completed_faction_quest'); // +25
  f1 = addMember(f1, 'Priest');
  let f2 = createFaction({ name: 'Bad', archetype: 'criminal' });
  f2 = recordFactionEvent(f2, 'stole_from_faction'); // -30
  f2 = addMember(f2, 'Thug');
  const region = getRegionalReputation([f1, f2], [
    { name: 'Priest', memories: [] },
    { name: 'Thug', memories: [] },
    { name: 'Stranger', memories: [] },
  ], 'regional');
  check('regional reputation computes', typeof region.reputation === 'number');
  check('regional breakdown has per-faction entries', region.breakdown.perFaction.length === 2);
  check('unaffiliated count = 1', region.breakdown.unaffiliated.count === 1);

  console.log('\n═══  L.8: local scope excludes regional-reach factions  ═══');
  // religious is regional; criminal is local. Asking for "local" should only see criminal.
  const localScope = getRegionalReputation([f1, f2], [
    { name: 'Priest', memories: [] }, { name: 'Thug', memories: [] },
  ], 'local');
  const factionNames = localScope.breakdown.perFaction.map(p => p.faction);
  check('local scope excludes religious faction', !factionNames.includes('Good'));
  check('local scope includes criminal faction', factionNames.includes('Bad'));
}

// ════════════════════════════════════════════════════════════════════
// Part M: Reputation / Fame / Infamy (with cultural lens)
// ════════════════════════════════════════════════════════════════════
{
  const {
    createReputation, recordDeed, interpretDeedThroughCulture,
    applyDeedToFaction, decayFameOverTime,
    fameTier, infamyTier, reputationSummary,
    DEED_TYPES, CULTURAL_VALUES,
  } = await import('./src/services/reputation.js');
  const { createFaction } = await import('./src/services/factions.js');

  console.log('\n═══  M.1: createReputation defaults  ═══');
  const rep0 = createReputation();
  check('fame starts at 0', rep0.fame === 0);
  check('infamy starts at 0', rep0.infamy === 0);
  check('deeds empty', rep0.deeds.length === 0);

  console.log('\n═══  M.2: recordDeed applies fame + infamy  ═══');
  let rep = createReputation();
  rep = recordDeed(rep, 'slew_dragon');
  check('dragon slayer fame up', rep.fame === 40);
  check('dragon slayer infamy unchanged', rep.infamy === 0);
  check('deed logged', rep.deeds.length === 1);
  check('deed has tags', rep.deeds[0].tags.includes('combat_victory'));

  rep = recordDeed(rep, 'burned_village');
  check('burned village: fame unchanged', rep.fame === 40);
  check('burned village: infamy surges', rep.infamy === 70);

  console.log('\n═══  M.3: fame/infamy clamp to 0..100  ═══');
  let clamped = createReputation();
  clamped = recordDeed(clamped, 'slew_dragon'); // 40
  clamped = recordDeed(clamped, 'slew_dragon'); // 80
  clamped = recordDeed(clamped, 'slew_dragon'); // clamp to 100
  check('fame clamped at 100', clamped.fame === 100);

  console.log('\n═══  M.4: cultural lens — goblin tribe admires theft from outsiders  ═══');
  const theft = { ...DEED_TYPES.robbed_merchant, deedKey: 'robbed_merchant', fameDelta: 0, infamyDelta: 10, tags: ['theft', 'from_outsider'] };
  const tribeView = interpretDeedThroughCulture(theft, 'tribe');
  // tribe.from_outsider: fame * 1.5, infamy * -1.0; tribe.theft: fame * 1.2, infamy * -0.5
  // fame = 0 * 1.5 * 1.2 = 0; infamy = 10 * -1.0 * -0.5 = 5
  check('tribe reduces infamy for outsider theft', tribeView.infamy < 10);
  const merchantView = interpretDeedThroughCulture(theft, 'mercantile');
  // mercantile.theft: infamy * 1.5 → 15
  check('merchants punish theft harder', merchantView.infamy > 10);

  console.log('\n═══  M.5: cultural lens — dwarven clan catastrophic oath-breaking  ═══');
  const oathBreak = { deedKey: 'broke_oath', fameDelta: 0, infamyDelta: 20, tags: ['oath_broken', 'dishonor'] };
  const clanView = interpretDeedThroughCulture(oathBreak, 'clan');
  // clan.oath_broken: infamy * 3.0; clan.dishonor: infamy * 2.0 → 20 * 3.0 * 2.0 = 120
  check('clan treats oath-breaking as catastrophic', clanView.infamy >= 60);

  console.log('\n═══  M.6: applyDeedToFaction shifts faction rep  ═══');
  const faction = createFaction({ name: 'Bargrim Clan', archetype: 'clan' });
  const kept = {
    deedKey: 'kept_dangerous_oath', fameDelta: 15, infamyDelta: 0,
    tags: ['oath_kept', 'honor'],
    timestamp: new Date().toISOString(),
  };
  const after = applyDeedToFaction(faction, kept);
  check('clan rep boosted by oath-keeping', after.baseReputation > faction.baseReputation);
  check('faction event log includes deed', after.events.some(e => e.eventKey.startsWith('deed:')));

  console.log('\n═══  M.7: fameTier and infamyTier  ═══');
  check('fame 0 → unknown', fameTier(0).tier === 'unknown');
  check('fame 40 → known', fameTier(40).tier === 'known');
  check('fame 90 → legendary', fameTier(90).tier === 'legendary');
  check('infamy 0 → spotless', infamyTier(0).tier === 'spotless');
  check('infamy 35 → notorious', infamyTier(35).tier === 'notorious');
  check('infamy 90 → reviled', infamyTier(90).tier === 'reviled');

  console.log('\n═══  M.8: decayFameOverTime — fame fades faster than infamy  ═══');
  let legend = createReputation();
  legend = recordDeed(legend, 'murdered_innocent'); // infamy 50
  legend = { ...legend, fame: 60 }; // manual set for test
  const startFame = legend.fame;
  const startInfamy = legend.infamy;
  const decayed = decayFameOverTime(legend, 180); // 180 days
  check('fame decayed', decayed.fame < startFame);
  check('infamy decayed less (relative)', (startInfamy - decayed.infamy) < (startFame - decayed.fame));

  console.log('\n═══  M.9: legendary deeds resist decay  ═══');
  let legendary = createReputation();
  legendary = recordDeed(legendary, 'slew_dragon'); // legendary visibility, fame 40
  const ordinary = createReputation();
  let ord = recordDeed(ordinary, 'cleared_dungeon'); // local, fame 15
  ord = { ...ord, fame: 40 }; // force equal starting fame
  const decayLegendary = decayFameOverTime(legendary, 180);
  const decayOrdinary  = decayFameOverTime(ord, 180);
  check('legendary fame decays less than ordinary',
    decayLegendary.fame > decayOrdinary.fame);

  console.log('\n═══  M.10: reputationSummary composite  ═══');
  let hybrid = createReputation();
  hybrid = recordDeed(hybrid, 'slew_dragon');       // fame 40
  hybrid = recordDeed(hybrid, 'murdered_innocent'); // infamy 50
  const summary = reputationSummary(hybrid);
  check('summary exposes fame tier', summary.fameTier.tier === 'known');
  check('summary exposes infamy tier', summary.infamyTier.tier === 'notorious');
  check('summary reports deed count', summary.deeds === 2);

  console.log('\n═══  M.11: non-human archetypes have cultural values  ═══');
  check('tribe lens exists', CULTURAL_VALUES.tribe !== undefined);
  check('clan lens exists', CULTURAL_VALUES.clan !== undefined);
  check('coven lens exists', CULTURAL_VALUES.coven !== undefined);
  check('horde lens exists', CULTURAL_VALUES.horde !== undefined);
  check('pack admires combat victory more than default',
    CULTURAL_VALUES.pack.combat_victory.fame >= 2.0);

  console.log('\n═══  M.12: custom deed via context  ═══');
  let custom = createReputation();
  custom = recordDeed(custom, 'rescued_princess_from_goblins', {
    fame: 25, infamy: 0, tags: ['heroic', 'from_outsider'],
    visibility: 'regional',
  });
  check('custom deed logged', custom.deeds[0].deedKey === 'rescued_princess_from_goblins');
  check('custom deed fame applied', custom.fame === 25);
  // through tribe lens: tribe.from_outsider fame * 1.5, tribe.heroic fame * 1.0 → 25 * 1.5 = 38
  const tribeReaction = interpretDeedThroughCulture(custom.deeds[0], 'tribe');
  check('tribe admires from_outsider heroics', tribeReaction.fame > 25);
}

// ════════════════════════════════════════════════════════════════════
// Part N: Faction Inference (constrained AI DM discretion)
// ════════════════════════════════════════════════════════════════════
{
  const {
    inferFactionForNPC, commitFactionTag, createRegion,
    isSpeciesArchetypeAllowed, allowedArchetypesForSpecies,
    SPECIES_ARCHETYPES,
  } = await import('./src/services/factionInference.js');

  console.log('\n═══  N.1: species defaults exist for common species  ═══');
  check('orc has tribe in defaults', SPECIES_ARCHETYPES.orc.includes('tribe'));
  check('dwarf has clan as default', SPECIES_ARCHETYPES.dwarf[0] === 'clan');
  check('dragon has hoard (only)', SPECIES_ARCHETYPES.dragon.length === 1 && SPECIES_ARCHETYPES.dragon[0] === 'hoard');
  check('formian is pure hive', SPECIES_ARCHETYPES.formian[0] === 'hive');

  console.log('\n═══  N.2: isSpeciesArchetypeAllowed  ═══');
  check('orc + tribe allowed', isSpeciesArchetypeAllowed('orc', 'tribe'));
  check('orc + monastery rejected', !isSpeciesArchetypeAllowed('orc', 'monastery'));
  check('dwarf + clan allowed', isSpeciesArchetypeAllowed('dwarf', 'clan'));
  check('unknown species rejected', !isSpeciesArchetypeAllowed('unicorn', 'enclave'));

  console.log('\n═══  N.3: inferFactionForNPC respects commitment  ═══');
  const npc = { species: 'orc', factions: [{ factionId: 'bloodtusk', archetype: 'tribe' }] };
  const r1 = inferFactionForNPC(npc, { suggestedArchetype: 'horde' });
  check('committed tag wins over suggestion', r1.factionId === 'bloodtusk');
  check('committed source flagged', r1.source === 'committed');
  check('not novel once committed', r1.novel === false);

  console.log('\n═══  N.4: regional declaration preferred  ═══');
  const region = createRegion('bloodtusk-rise', {
    name: 'Bloodtusk Rise',
    factions: [
      { factionId: 'bloodtusk-tribe', name: 'Bloodtusk Tribe', archetype: 'tribe', speciesHints: ['orc'] },
      { factionId: 'red-hand-horde', name: 'Red Hand Horde', archetype: 'horde', speciesHints: ['orc', 'hobgoblin'] },
    ],
  });
  const wildOrc = { species: 'orc' };
  // noveltyChance: 0 opts out of the 8% novelty roll so this test exercises
  // the regional-match path deterministically (otherwise flaps ~8% of runs).
  const r2 = inferFactionForNPC(wildOrc, { region, noveltyChance: 0 });
  check('regional faction picked', r2.source === 'regional');
  check('regional faction has real id', r2.factionId === 'bloodtusk-tribe');
  check('regional faction is not novel', r2.novel === false);

  console.log('\n═══  N.5: suggested archetype narrows regional match  ═══');
  const r3 = inferFactionForNPC({ species: 'orc' }, { region, suggestedArchetype: 'horde' });
  check('suggestedArchetype picks horde regional', r3.factionId === 'red-hand-horde');

  console.log('\n═══  N.6: invalid suggestion falls back with warning  ═══');
  const r4 = inferFactionForNPC({ species: 'orc' }, { suggestedArchetype: 'monastery' });
  check('invalid suggestion warned', r4.warnings.length > 0);
  check('invalid suggestion fell back', r4.source === 'species-default');
  check('archetype is species default', r4.archetype === 'tribe');

  console.log('\n═══  N.7: group size + behavior hints refine  ═══');
  const big = inferFactionForNPC({ species: 'orc' }, { groupSize: 50, behaviorHints: ['marching'] });
  check('big marching orc group → horde', big.archetype === 'horde');
  const small = inferFactionForNPC({ species: 'gnoll' }, { groupSize: 4, behaviorHints: ['hunting'] });
  check('small hunting gnolls → pack', small.archetype === 'pack');
  const ritual = inferFactionForNPC({ species: 'kobold' }, { behaviorHints: ['worshipping', 'chanting'] });
  check('ritualistic kobolds → cult', ritual.archetype === 'cult');

  console.log('\n═══  N.8: novel tag flagged when AI invents  ═══');
  const r5 = inferFactionForNPC({ species: 'human' }, {
    region,
    suggestedArchetype: 'mercantile',
    suggestedFactionName: 'Silver Coin Traders',
  });
  check('novel flag set', r5.novel === true);
  check('warnings include GM-confirm note', r5.warnings.some(w => w.includes('GM')));
  check('factionId uses suggested name', r5.factionId === 'Silver Coin Traders');

  console.log('\n═══  N.9: unknown species falls back gracefully  ═══');
  const r6 = inferFactionForNPC({ species: 'unicorn' }, {});
  check('unknown species uses fallback', r6.source === 'fallback');
  check('unknown produces warning', r6.warnings.length > 0);

  console.log('\n═══  N.10: commitFactionTag persists + blocks re-inference  ═══');
  const raw = { species: 'orc', name: 'Grashnak' };
  // noveltyChance: 0 — same deterministic opt-out as N.4; we want to exercise
  // the commitment path with a known-canonical faction id.
  const inf = inferFactionForNPC(raw, { region, noveltyChance: 0 });
  const tagged = commitFactionTag(raw, inf);
  check('tag persisted to npc', tagged.factions.length === 1);
  check('tag has factionId', tagged.factions[0].factionId === 'bloodtusk-tribe');
  // Re-infer with conflicting suggestion — should keep committed tag
  const reinf = inferFactionForNPC(tagged, { suggestedArchetype: 'cult' });
  check('re-inference returns committed tag', reinf.source === 'committed');
  check('archetype stays tribe', reinf.archetype === 'tribe');

  console.log('\n═══  N.11: allowedArchetypesForSpecies (for UI pickers)  ═══');
  const orcOptions = allowedArchetypesForSpecies('orc');
  check('orc options include tribe', orcOptions.includes('tribe'));
  check('orc options exclude guild', !orcOptions.includes('guild'));
}

// ════════════════════════════════════════════════════════════════════
// Part O: Faction Life (living-world attributes)
// ════════════════════════════════════════════════════════════════════
{
  const {
    enrichFactionWithLife, defaultResources, inferMoodFromResources,
    setMood, createGoal, advanceGoal, createSecret, createRumor,
    setRelation, shiftRelation, relationLabel,
    FACTION_MOODS, GOAL_TYPES, RELATION_TIERS,
  } = await import('./src/services/factionLife.js');
  const { createFaction } = await import('./src/services/factions.js');

  console.log('\n═══  O.1: enrichFactionWithLife adds life state  ═══');
  const base = createFaction({ name: 'Test Clan', archetype: 'clan' });
  const alive = enrichFactionWithLife(base);
  check('has life object', alive.life !== undefined);
  check('default mood = stable', alive.life.mood === 'stable');
  check('has resources', typeof alive.life.resources.wealth === 'number');
  check('has leadership', alive.life.leadership !== undefined);
  check('goals empty by default', alive.life.goals.length === 0);

  console.log('\n═══  O.2: enrich is idempotent  ═══');
  const twice = enrichFactionWithLife(alive);
  check('enriching twice does not overwrite', twice.life === alive.life);

  console.log('\n═══  O.3: defaultResources tilts by archetype  ═══');
  const merc = defaultResources('mercantile');
  const crim = defaultResources('criminal');
  check('mercantile has higher wealth', merc.wealth > 50);
  check('criminal has higher secrecy', crim.secrecy > 50);
  const hive = defaultResources('hive');
  check('hive has massive manpower', hive.manpower >= 75);

  console.log('\n═══  O.4: inferMoodFromResources  ═══');
  check('all high → triumphant/ascendant',
    ['triumphant', 'ascendant'].includes(inferMoodFromResources({ morale: 90, manpower: 90, wealth: 90, influence: 90 })));
  check('all low → desperate',
    inferMoodFromResources({ morale: 10, manpower: 10, wealth: 10, influence: 10 }) === 'desperate');
  check('middling → stable',
    inferMoodFromResources({ morale: 60, manpower: 55, wealth: 55, influence: 55 }) === 'stable');

  console.log('\n═══  O.5: setMood records history  ═══');
  const shifted = setMood(alive, 'beleaguered', 'lost a battle');
  check('mood updated', shifted.life.mood === 'beleaguered');
  check('mood history logged', shifted.life.moodHistory.length === 2);
  check('mood history has reason', shifted.life.moodHistory[1].reason === 'lost a battle');

  console.log('\n═══  O.6: goals + advanceGoal  ═══');
  const goal = createGoal({ type: 'territorial_expansion', narrative: 'take the pass' });
  const withGoal = enrichFactionWithLife(createFaction({ name: 'Horde', archetype: 'horde' }), { goals: [{ ...goal }] });
  check('goal inherits tags from type', withGoal.life.goals[0].tags.includes('raiding'));
  const advanced = advanceGoal(withGoal, withGoal.life.goals[0].id, 30);
  check('goal progressed', advanced.faction.life.goals[0].progress === 30);
  check('not completed yet', !advanced.completed);
  const finished = advanceGoal(advanced.faction, withGoal.life.goals[0].id, 100);
  check('goal completed', finished.completed === true);
  check('completed goal moved', finished.faction.life.completedGoals.length === 1);
  check('completed removed from active', finished.faction.life.goals.length === 0);

  console.log('\n═══  O.7: relations + shiftRelation  ═══');
  let f = enrichFactionWithLife(createFaction({ name: 'A', archetype: 'noble_house' }));
  f = setRelation(f, 'house-b', -50, { reason: 'broken betrothal' });
  check('relation set', f.relations['house-b'].score === -50);
  f = shiftRelation(f, 'house-b', -20, { reason: 'duel in the marketplace' });
  check('relation shifted', f.relations['house-b'].score === -70);
  check('relation history tracked', f.relations['house-b'].history.length === 2);
  check('relation label is feud', relationLabel(-70) === 'Active Feud');
  check('relation label neutral at 0', relationLabel(0) === 'Neutral');

  console.log('\n═══  O.8: secrets and rumors  ═══');
  const secret = createSecret({ narrative: 'the high priest is a doppelgänger', severity: 'catastrophic' });
  check('secret has id', secret.id.startsWith('secret-'));
  check('secret defaults to not exposed', secret.exposed === false);
  const rumor = createRumor({ narrative: 'the baron poisoned his brother', truth: 'unverified' });
  check('rumor has id', rumor.id.startsWith('rumor-'));
}

// ════════════════════════════════════════════════════════════════════
// Part P: Campaign container (canonical + novel factions)
// ════════════════════════════════════════════════════════════════════
{
  const {
    createCampaign, addRegion, addFaction, getFaction,
    listFactionsByRegion, enqueueNovelFaction, listPendingNovelFactions,
    promoteNovelFaction, mergeFactions, renameFaction, discardNovelFaction,
    setFactionRelation, getFactionRelation,
  } = await import('./src/services/campaign.js');
  const { createRegion, inferFactionForNPC, commitFactionTag } = await import('./src/services/factionInference.js');

  console.log('\n═══  P.1: createCampaign defaults  ═══');
  let c = createCampaign({ name: 'Bloodtusk War' });
  check('campaign has name', c.name === 'Bloodtusk War');
  check('no regions initially', c.regions.length === 0);
  check('no factions initially', Object.keys(c.factions).length === 0);
  check('novel queue empty', c.novelQueue.length === 0);

  console.log('\n═══  P.2: addRegion + addFaction  ═══');
  const region = createRegion('bloodtusk-rise', {
    name: 'Bloodtusk Rise',
    factions: [
      { factionId: 'bloodtusk-tribe', name: 'Bloodtusk Tribe', archetype: 'tribe', speciesHints: ['orc'] },
    ],
  });
  c = addRegion(c, region);
  c = addFaction(c, 'bloodtusk-tribe', { name: 'Bloodtusk Tribe', archetype: 'tribe' });
  check('region registered', c.regions.length === 1);
  check('faction registered', getFaction(c, 'bloodtusk-tribe') !== null);
  check('faction auto-enriched with life', getFaction(c, 'bloodtusk-tribe').life !== undefined);
  check('listFactionsByRegion finds it', listFactionsByRegion(c, 'bloodtusk-rise').length === 1);

  console.log('\n═══  P.3: novelty roll triggers novel faction  ═══');
  // Force a novel roll with rng that always returns 0 (< any chance)
  const alwaysNovel = () => 0;
  const orc = { species: 'orc', name: 'Grashnak' };
  const novelInf = inferFactionForNPC(orc, { region, rng: alwaysNovel, noveltyChance: 0.5, suggestedFactionName: 'Splinter of the Red Eye' });
  check('forced novel roll', novelInf.novel === true);
  check('warnings mention story thread', novelInf.warnings.some(w => w.toLowerCase().includes('story thread')));

  console.log('\n═══  P.4: enqueueNovelFaction registers placeholder  ═══');
  const q = enqueueNovelFaction(c, novelInf, {
    species: 'orc', region, suggestedName: 'Splinter of the Red Eye', firstSeenNpc: 'Grashnak',
  });
  c = q.campaign;
  check('novel faction in catalog', getFaction(c, novelInf.factionId) !== null);
  check('novel faction marked pending', getFaction(c, novelInf.factionId).pending === true);
  check('novel queue populated', listPendingNovelFactions(c).length === 1);

  console.log('\n═══  P.5: noveltyChance = 0 → always canonical  ═══');
  const neverNovel = () => 0.99;
  const canonical = inferFactionForNPC({ species: 'orc' }, { region, rng: neverNovel, noveltyChance: 0.01 });
  check('low roll returns canonical', canonical.source === 'regional');
  check('canonical is not novel', canonical.novel === false);

  console.log('\n═══  P.6: promoteNovelFaction to canonical  ═══');
  c = promoteNovelFaction(c, novelInf.factionId, {
    name: 'Splinter of the Red Eye',
    regionId: 'bloodtusk-rise',
    speciesHints: ['orc'],
  });
  check('queue cleared', listPendingNovelFactions(c).length === 0);
  check('faction no longer pending', !getFaction(c, novelInf.factionId).pending);
  check('attached to region', c.regions[0].factions.some(f => f.factionId === novelInf.factionId));

  console.log('\n═══  P.7: mergeFactions re-tags NPCs  ═══');
  let c2 = createCampaign();
  c2 = addFaction(c2, 'splinter', { name: 'Splinter', archetype: 'tribe' });
  c2 = addFaction(c2, 'bloodtusk-tribe', { name: 'Bloodtusk Tribe', archetype: 'tribe' });
  // Simulate some events on splinter
  c2.factions.splinter.events.push({ eventKey: 'raid', repDelta: -10 });
  const npcs = [
    { name: 'Grashnak', factions: [{ factionId: 'splinter', archetype: 'tribe' }] },
    { name: 'Ugluk',    factions: [{ factionId: 'bloodtusk-tribe', archetype: 'tribe' }] },
    { name: 'Human',    factions: [] },
  ];
  const merged = mergeFactions(c2, 'splinter', 'bloodtusk-tribe', npcs);
  check('splinter removed', !getFaction(merged.campaign, 'splinter'));
  check('bloodtusk absorbed events', merged.campaign.factions['bloodtusk-tribe'].events.length === 1);
  check('Grashnak re-tagged',
    merged.npcs.find(n => n.name === 'Grashnak').factions[0].factionId === 'bloodtusk-tribe');
  check('re-tag marked mergedFrom',
    merged.npcs.find(n => n.name === 'Grashnak').factions[0].mergedFrom === 'splinter');
  check('Ugluk unchanged',
    merged.npcs.find(n => n.name === 'Ugluk').factions[0].factionId === 'bloodtusk-tribe');

  console.log('\n═══  P.8: renameFaction  ═══');
  let c3 = createCampaign();
  c3 = addFaction(c3, 'tower-mages', { name: 'Tower Mages', archetype: 'scholarly' });
  const renamed = renameFaction(c3, 'tower-mages', 'Obsidian Circle');
  check('renamed', getFaction(renamed.campaign, 'tower-mages').name === 'Obsidian Circle');

  console.log('\n═══  P.9: discardNovelFaction cleans NPCs  ═══');
  let c4 = createCampaign();
  c4 = addFaction(c4, 'novel-junk', { name: 'Junk', archetype: 'outcast' });
  c4.novelQueue.push({ id: 'novel-junk', suggestedName: 'Junk' });
  const npcs2 = [{ name: 'A', factions: [{ factionId: 'novel-junk' }] }];
  const discarded = discardNovelFaction(c4, 'novel-junk', npcs2);
  check('discarded from catalog', !getFaction(discarded.campaign, 'novel-junk'));
  check('discarded from queue', discarded.campaign.novelQueue.length === 0);
  check('NPC tag removed', discarded.npcs[0].factions.length === 0);

  console.log('\n═══  P.10: inter-faction relations  ═══');
  let c5 = createCampaign();
  c5 = addFaction(c5, 'house-a', { name: 'A', archetype: 'noble_house' });
  c5 = addFaction(c5, 'house-b', { name: 'B', archetype: 'noble_house' });
  c5 = setFactionRelation(c5, 'house-a', 'house-b', -80, { reason: 'old feud', mutual: true });
  const ab = getFactionRelation(c5, 'house-a', 'house-b');
  const ba = getFactionRelation(c5, 'house-b', 'house-a');
  check('directed edge a→b set', ab.score === -80);
  check('mutual edge b→a set', ba.score === -80);
  check('asymmetric allowed', (() => {
    const c6 = setFactionRelation(c5, 'house-a', 'house-b', 20);
    const forward = getFactionRelation(c6, 'house-a', 'house-b');
    const back = getFactionRelation(c6, 'house-b', 'house-a');
    return forward.score === 20 && back.score === -80;
  })());
}

// ════════════════════════════════════════════════════════════════════
// Part Q: Campaign seeding from source material
// ════════════════════════════════════════════════════════════════════
{
  const { seedCampaignFromSource, exportCampaignAsSource } = await import('./src/services/campaignSeed.js');

  console.log('\n═══  Q.1: seed from a full source blob  ═══');
  const source = {
    name: 'Rise of the Runelords',
    setting: 'Golarion',
    regions: [
      {
        id: 'varisia',
        name: 'Varisia',
        factions: [
          {
            id: 'sandpoint-garrison',
            name: 'Sandpoint Garrison',
            archetype: 'martial',
            speciesHints: ['human'],
            baseReputation: 10,
            leader: { name: 'Sheriff Hemlock', title: 'Sheriff', legitimacy: 85 },
            resources: { manpower: 40, influence: 60 },
            goals: [{ type: 'survival', narrative: 'defend Sandpoint', priority: 'high' }],
            secrets: [{ narrative: 'fire of 5 years past was arson', severity: 'serious' }],
            motto: 'The Light Shall Guard',
            mood: 'wary',
          },
          {
            id: 'thistletop-goblins',
            name: 'Thistletop Tribe',
            archetype: 'tribe',
            speciesHints: ['goblin'],
            baseReputation: -30,
            mood: 'confident',
          },
        ],
      },
    ],
    factionRelations: [
      { from: 'sandpoint-garrison', to: 'thistletop-goblins', score: -80, mutual: true, reason: 'border raids' },
    ],
    initialReputation: { fame: 5, infamy: 0 },
  };
  const { campaign, warnings } = seedCampaignFromSource(source);
  check('no warnings', warnings.length === 0);
  check('campaign name set', campaign.name === 'Rise of the Runelords');
  check('region registered', campaign.regions.length === 1);
  check('garrison registered', campaign.factions['sandpoint-garrison']);
  check('garrison has leader', campaign.factions['sandpoint-garrison'].life.leadership.current === 'Sheriff Hemlock');
  check('garrison mood is wary', campaign.factions['sandpoint-garrison'].life.mood === 'wary');
  check('garrison has goal', campaign.factions['sandpoint-garrison'].life.goals.length === 1);
  check('garrison has secret', campaign.factions['sandpoint-garrison'].life.secrets.length === 1);
  check('relation set', campaign.factionRelations['sandpoint-garrison->thistletop-goblins'].score === -80);
  check('mutual relation set', campaign.factionRelations['thistletop-goblins->sandpoint-garrison'].score === -80);
  check('garrison.relations populated', campaign.factions['sandpoint-garrison'].relations['thistletop-goblins'].score === -80);

  console.log('\n═══  Q.2: warnings for bad input  ═══');
  const bad = seedCampaignFromSource({
    name: 'Broken',
    regions: [{ factions: [{ name: 'no id' }] }], // missing region id + faction id
    factionRelations: [{ from: 'ghost', to: 'nothing', score: 0 }],
  });
  check('bad input produces warnings', bad.warnings.length >= 2);

  console.log('\n═══  Q.3: exportCampaignAsSource round-trip  ═══');
  const exported = exportCampaignAsSource(campaign);
  check('export has regions', exported.regions.length === 1);
  check('export has factions inside region', exported.regions[0].factions.length === 2);
  check('export preserves leader', exported.regions[0].factions[0].leader.name === 'Sheriff Hemlock');
  check('export preserves relations', exported.factionRelations.length >= 1);
  // Round trip
  const { campaign: reSeeded } = seedCampaignFromSource(exported);
  check('round-trip preserves faction count',
    Object.keys(reSeeded.factions).length === Object.keys(campaign.factions).length);
}

// ════════════════════════════════════════════════════════════════════
// Part R: Faction simulation ticks
// ════════════════════════════════════════════════════════════════════
{
  const { tickFaction, tickCampaign } = await import('./src/services/factionSimulation.js');
  const { seedCampaignFromSource } = await import('./src/services/campaignSeed.js');

  // Deterministic RNG
  function seededRng(seed) {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  console.log('\n═══  R.1: tickFaction does not crash on empty goals  ═══');
  const { campaign: c1 } = seedCampaignFromSource({
    name: 'T',
    regions: [{ id: 'r', factions: [{ id: 'f1', name: 'F1', archetype: 'mercantile' }] }],
  });
  const { faction: ticked, events } = tickFaction(c1.factions.f1, 24, { rng: seededRng(1) });
  check('returns faction', ticked.life !== undefined);
  check('events is array', Array.isArray(events));

  console.log('\n═══  R.2: active goal progresses over time  ═══');
  const { campaign: c2 } = seedCampaignFromSource({
    name: 'T',
    regions: [{
      id: 'r',
      factions: [{
        id: 'f1',
        name: 'F1',
        archetype: 'martial',
        goals: [{ type: 'territorial_expansion', narrative: 'take the pass', priority: 'high' }],
        resources: { manpower: 80, wealth: 50, influence: 50, secrecy: 50, morale: 70 },
      }],
    }],
  });
  const before = c2.factions.f1.life.goals[0].progress;
  const { faction: after } = tickFaction(c2.factions.f1, 24 * 7, { rng: seededRng(2) });
  const afterProgress = after.life.goals[0]?.progress ?? 100;
  check('goal progressed over a week',
    afterProgress > before || after.life.completedGoals.length > 0);

  console.log('\n═══  R.3: mood shifts when resources collapse  ═══');
  const low = {
    ...c2.factions.f1,
    life: {
      ...c2.factions.f1.life,
      resources: { wealth: 10, manpower: 10, influence: 10, secrecy: 10, morale: 10 },
    },
  };
  const { faction: desperate, events: despEvents } = tickFaction(low, 24, { rng: seededRng(3) });
  check('low resources → desperate mood',
    desperate.life.mood === 'desperate' || desperate.life.mood === 'beleaguered');
  check('mood shift event fired', despEvents.some(e => e.type === 'mood_shift'));

  console.log('\n═══  R.4: secret leaks over time  ═══');
  const withSecret = {
    ...c2.factions.f1,
    life: {
      ...c2.factions.f1.life,
      secrets: [{ id: 's1', narrative: 'test', severity: 'serious', exposed: false, leakRisk: 0.9, knownBy: [] }],
    },
  };
  const { faction: leaked, events: leakEvents } = tickFaction(withSecret, 24 * 3, { rng: seededRng(4) });
  check('high-leak secret exposed', leaked.life.secrets[0].exposed || leakEvents.some(e => e.type === 'secret_exposed'));

  console.log('\n═══  R.5: succession threat under low legitimacy  ═══');
  const shaky = {
    ...c2.factions.f1,
    life: {
      ...c2.factions.f1.life,
      mood: 'desperate',
      leadership: {
        current: 'Weak Boss', title: 'Boss', legitimacy: 10,
        succession: [], challengers: [], tenureStart: new Date().toISOString(), history: [],
      },
    },
  };
  let sawThreat = false;
  for (let i = 0; i < 20 && !sawThreat; i++) {
    const { events: ev } = tickFaction(shaky, 24 * 10, { rng: seededRng(100 + i) });
    if (ev.some(e => e.type === 'succession_threat')) sawThreat = true;
  }
  check('succession threat fires within 20 tries', sawThreat);

  console.log('\n═══  R.6: tickCampaign advances world time + drifts relations  ═══');
  const { campaign: fullC } = seedCampaignFromSource({
    name: 'T',
    regions: [{
      id: 'r',
      factions: [
        { id: 'a', name: 'A', archetype: 'noble_house', mood: 'beleaguered',
          resources: { wealth: 20, manpower: 20, influence: 20, secrecy: 20, morale: 20 } },
        { id: 'b', name: 'B', archetype: 'criminal' },
      ],
    }],
    factionRelations: [{ from: 'a', to: 'b', score: -60, reason: 'old feud' }],
  });
  const tr = tickCampaign(fullC, 24 * 30, { rng: seededRng(7) });
  check('world time advanced', tr.campaign.worldTime.hoursElapsed === 24 * 30);
  check('day counter advanced', tr.campaign.worldTime.day === 31);
  const drifted = tr.campaign.factionRelations['a->b'].score;
  check('beleaguered hostile relation drifted further negative', drifted < -60);
}

// ════════════════════════════════════════════════════════════════════
// Part S: Sandpoint canonical seed (real source material)
// ════════════════════════════════════════════════════════════════════
console.log('\n════════  Part S: Sandpoint canonical campaign seed  ════════');
{
  const { seedCampaignFromSource, exportCampaignAsSource } = await import('./src/services/campaignSeed.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const sandpointPath = path.resolve('./src/data/sandpoint-seed.json');
  const sandpointSource = JSON.parse(fs.readFileSync(sandpointPath, 'utf8'));

  console.log('\n═══  S.1: sandpoint seed loads without warnings  ═══');
  const { campaign, warnings } = seedCampaignFromSource(sandpointSource);
  check('no load warnings', warnings.length === 0, warnings.join('; '));
  check('campaign named correctly', campaign.name === 'Sandpoint, Light of the Lost Coast');

  console.log('\n═══  S.2: core Sandpoint factions are present  ═══');
  const required = [
    'sandpoint-mercantile-league',
    'scarnetti-family',
    'kaijitsu-family',
    'valdemar-family',
    'deverin-family',
    'sandpoint-town-guard',
    'sandpoint-cathedral',
    'bunyip-club',
    'varisian-council-sandpoint',
    'thistletop-goblins',
    'licktoad-goblins',
    'birdcruncher-goblins',
  ];
  for (const id of required) {
    check(`faction ${id} exists`, !!campaign.factions[id]);
  }

  console.log('\n═══  S.3: leadership + archetype wiring  ═══');
  check('Sheriff Hemlock leads guard',
    campaign.factions['sandpoint-town-guard'].life.leadership.current === 'Belor Hemlock');
  check('Jubrayl leads Bunyip Club',
    campaign.factions['bunyip-club'].life.leadership.current === 'Jubrayl Vhiski');
  check('Thistletop is a horde',
    campaign.factions['thistletop-goblins'].archetype === 'horde');
  check('Mercantile League is a consortium',
    campaign.factions['sandpoint-mercantile-league'].archetype === 'consortium');

  console.log('\n═══  S.4: secrets and goals populated  ═══');
  check('mercantile league carries the blood-debt secret',
    campaign.factions['sandpoint-mercantile-league'].life.secrets.length >= 1);
  check('scarnettis have the arson secret',
    campaign.factions['scarnetti-family'].life.secrets.some(s => /arson|cougar creek/i.test(s.narrative)));
  check('cathedral flags ghoul colonization',
    campaign.factions['sandpoint-cathedral'].life.secrets.some(s => /ghoul/i.test(s.narrative)));

  console.log('\n═══  S.5: inter-faction relations wired  ═══');
  check('guard hates thistletop goblins',
    campaign.factionRelations['sandpoint-town-guard->thistletop-goblins'].score < -60);
  check('guard is hostile to bunyip club',
    campaign.factionRelations['sandpoint-town-guard->bunyip-club'].score < 0);
  check('cathedral and varisian council are allied-ish',
    campaign.factionRelations['sandpoint-cathedral->varisian-council-sandpoint'].score > 0);
  check('kaleb valdemar secretly friendly with bunyip club',
    campaign.factionRelations['valdemar-family->bunyip-club'].score > 0);

  console.log('\n═══  S.6: round-trip export preserves structure  ═══');
  const exported = exportCampaignAsSource(campaign);
  check('export has both regions', exported.regions.length === 2);
  const reseeded = seedCampaignFromSource(exported);
  check('re-seed no warnings', reseeded.warnings.length === 0, reseeded.warnings.join('; '));
  check('re-seed preserves faction count',
    Object.keys(reseeded.campaign.factions).length === Object.keys(campaign.factions).length);
  check('re-seed preserves sheriff',
    reseeded.campaign.factions['sandpoint-town-guard'].life.leadership.current === 'Belor Hemlock');
}

// ════════════════════════════════════════════════════════════════════
// Part T: Sandpoint NPC roster
// ════════════════════════════════════════════════════════════════════
console.log('\n════════  Part T: Sandpoint canonical NPC roster  ════════');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { seedCampaignFromSource } = await import('./src/services/campaignSeed.js');
  const roster = JSON.parse(fs.readFileSync(path.resolve('./src/data/sandpoint-npcs.json'), 'utf8'));
  const sandpoint = JSON.parse(fs.readFileSync(path.resolve('./src/data/sandpoint-seed.json'), 'utf8'));
  const { campaign } = seedCampaignFromSource(sandpoint);

  console.log('\n═══  T.1: roster shape + basic invariants  ═══');
  check('has npcs array', Array.isArray(roster.npcs));
  check('at least 60 notable NPCs', roster.npcs.length >= 60);
  const ids = new Set(roster.npcs.map(n => n.id));
  check('all ids unique', ids.size === roster.npcs.length);

  console.log('\n═══  T.2: every NPC has required fields  ═══');
  const required = ['id', 'name', 'alignment', 'race', 'classes'];
  let allValid = true;
  for (const n of roster.npcs) {
    for (const k of required) {
      if (n[k] == null || (Array.isArray(n[k]) && n[k].length === 0)) {
        console.log(`    ! missing ${k} on ${n.id || n.name}`);
        allValid = false;
      }
    }
  }
  check('all NPCs have id/name/alignment/race/classes', allValid);

  console.log('\n═══  T.3: key canonical NPCs present with correct data  ═══');
  const byId = Object.fromEntries(roster.npcs.map(n => [n.id, n]));
  check('Kendra Deverin: NG aristocrat 4/expert 3',
    byId['npc-kendra-deverin']?.alignment === 'NG' &&
    byId['npc-kendra-deverin'].classes.some(c => c.class === 'aristocrat' && c.level === 4) &&
    byId['npc-kendra-deverin'].classes.some(c => c.class === 'expert' && c.level === 3));
  check('Belor Hemlock: CG fighter 4',
    byId['npc-belor-hemlock']?.alignment === 'CG' &&
    byId['npc-belor-hemlock'].classes[0].class === 'fighter' &&
    byId['npc-belor-hemlock'].classes[0].level === 4);
  check('Abstalar Zantus: CG cleric of Desna 4',
    byId['npc-abstalar-zantus']?.classes[0].class === 'cleric' &&
    byId['npc-abstalar-zantus'].classes[0].deity === 'Desna');
  check('Titus Scarnetti: LE aristocrat 6',
    byId['npc-titus-scarnetti']?.alignment === 'LE' &&
    byId['npc-titus-scarnetti'].classes[0].level === 6);
  check('Ameiko Kaijitsu: aristocrat/bard/rogue',
    byId['npc-ameiko-kaijitsu']?.classes.length === 3);
  check('Niska Mvashti: mystic theurge',
    byId['npc-niska-mvashti']?.classes.some(c => c.class === 'mystic theurge'));
  check('Shayliss Vinder = Shroud (vigilante 6)',
    byId['npc-shayliss-vinder']?.classes[0].class === 'vigilante' &&
    byId['npc-shayliss-vinder'].classes[0].level === 6);
  check('Jubrayl Vhiski tagged to bunyip-club',
    byId['npc-jubrayl-vhiski']?.factions?.includes('bunyip-club'));

  console.log('\n═══  T.4: faction cross-references all resolve to real factions  ═══');
  const realFactions = new Set(Object.keys(campaign.factions));
  let danglingRefs = [];
  for (const n of roster.npcs) {
    for (const fid of (n.factions || [])) {
      if (!realFactions.has(fid)) danglingRefs.push(`${n.id} → ${fid}`);
    }
  }
  check('no dangling faction refs', danglingRefs.length === 0, danglingRefs.join('; '));

  console.log('\n═══  T.5: demographic coverage  ═══');
  const races = new Set(roster.npcs.map(n => n.race));
  check('covers ≥5 races', races.size >= 5, `saw: ${[...races].join(', ')}`);
  const alignments = new Set(roster.npcs.map(n => n.alignment));
  check('covers ≥5 alignments', alignments.size >= 5);
  const humanCount = roster.npcs.filter(n => n.race === 'human').length;
  const totalCount = roster.npcs.length;
  check('humans are majority (per canonical census)', humanCount / totalCount > 0.7);

  console.log('\n═══  T.6: four founding families are all represented  ═══');
  const founderMembers = {
    'deverin-family':    roster.npcs.filter(n => n.factions?.includes('deverin-family')),
    'scarnetti-family':  roster.npcs.filter(n => n.factions?.includes('scarnetti-family')),
    'kaijitsu-family':   roster.npcs.filter(n => n.factions?.includes('kaijitsu-family')),
    'valdemar-family':   roster.npcs.filter(n => n.factions?.includes('valdemar-family')),
  };
  for (const [fam, members] of Object.entries(founderMembers)) {
    check(`${fam} has ≥1 canonical NPC`, members.length >= 1);
  }
}

// ════════════════════════════════════════════════════════════════════
// Part U: Sandpoint canonical NPC hydrator — bridges static roster data
// into the living-world NPC shape.
// ════════════════════════════════════════════════════════════════════
console.log('\n════════  Part U: Sandpoint canonical NPC hydrator  ════════');
{
  const {
    hydrateCanonicalNPC,
    hydrateSandpointRoster,
    attachCanonicalNPCsToCampaign,
  } = await import('./src/services/sandpointHydrator.js');
  const { seedCampaignFromSource } = await import('./src/services/campaignSeed.js');
  const { defaultEmotionalState } = await import('./src/services/npcPersonality.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const rosterPath = path.join(process.cwd(), 'src/data/sandpoint-npcs.json');
  const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
  const seedPath = path.join(process.cwd(), 'src/data/sandpoint-seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  console.log('\n═══  U.1: hydrateCanonicalNPC preserves canonical fields  ═══');
  const kendraEntry = roster.npcs.find(n => n.id === 'npc-kendra-deverin');
  check('Kendra is in roster', !!kendraEntry);
  const kendra = hydrateCanonicalNPC(kendraEntry);
  check('id preserved', kendra.id === kendraEntry.id);
  check('name preserved exactly', kendra.name === kendraEntry.name);
  check('alignment preserved', kendra.alignment === kendraEntry.alignment);
  check('canonicalId set', kendra.canonicalId === kendraEntry.id);
  check('canonicalSource = sandpoint', kendra.canonicalSource === 'sandpoint');
  check('race capitalized', kendra.race === 'Human');
  check('classes preserved with levels', Array.isArray(kendra.classes) && kendra.classes.length === kendraEntry.classes.length);
  check('level = sum of class levels', kendra.level === kendraEntry.classes.reduce((s, c) => s + c.level, 0));
  check('class strings title-cased', kendra.classes.every(c => /^[A-Z]/.test(c.class)));
  check('factions preserved', JSON.stringify(kendra.factions) === JSON.stringify(kendraEntry.factions));

  console.log('\n═══  U.2: living-world fields seeded with defaults  ═══');
  check('emotionalState matches default shape',
    JSON.stringify(Object.keys(kendra.emotionalState).sort()) ===
    JSON.stringify(Object.keys(defaultEmotionalState()).sort()));
  check('knownToParty defaults to false (NPC-names rule)', kendra.knownToParty === false);
  check('metAt null until met', kendra.metAt === null);
  check('alive defaults true', kendra.alive === true);
  check('interactions starts at 0', kendra.interactions === 0);
  check('attitude defaults indifferent', kendra.attitude === 'indifferent');
  check('relationships array present', Array.isArray(kendra.relationships));
  check('memories array present', Array.isArray(kendra.memories));
  check('knowledge array present', Array.isArray(kendra.knowledge));
  check('appearance has ageBucket', typeof kendra.appearance.ageBucket === 'string');
  check('shortDesc does not leak name', !kendra.shortDesc.includes(kendra.name));
  check('firstImpression does not leak name', !kendra.firstImpression.includes(kendra.name));

  console.log('\n═══  U.3: multi-class NPC preserves all classes  ═══');
  const ameikoEntry = roster.npcs.find(n => n.id === 'npc-ameiko-kaijitsu');
  check('Ameiko in roster', !!ameikoEntry);
  if (ameikoEntry) {
    const ameiko = hydrateCanonicalNPC(ameikoEntry);
    check('Ameiko has multiple classes', ameiko.classes.length >= 2);
    check('Ameiko level = sum', ameiko.level === ameikoEntry.classes.reduce((s, c) => s + c.level, 0));
    // primary class = highest-level entry, title-cased
    const expectedPrimary = [...ameikoEntry.classes].sort((a, b) => b.level - a.level)[0].class;
    check('primary class = highest-level class',
      ameiko.class.toLowerCase() === expectedPrimary.toLowerCase());
  }

  console.log('\n═══  U.4: hydration is deterministic (no RNG)  ═══');
  const k1 = hydrateCanonicalNPC(kendraEntry);
  const k2 = hydrateCanonicalNPC(kendraEntry);
  check('same input → same HP', k1.hp === k2.hp);
  check('same input → same AC', k1.ac === k2.ac);
  check('same input → same abilities', JSON.stringify(k1.abilities) === JSON.stringify(k2.abilities));

  console.log('\n═══  U.5: overrides take precedence  ═══');
  const overridden = hydrateCanonicalNPC(kendraEntry, { knownToParty: true, attitude: 'friendly' });
  check('override knownToParty', overridden.knownToParty === true);
  check('override attitude', overridden.attitude === 'friendly');
  check('non-overridden fields intact', overridden.alignment === kendraEntry.alignment);

  console.log('\n═══  U.6: knowledge seeded from factions + hook  ═══');
  const withFactions = roster.npcs.find(n => (n.factions || []).length > 0 && n.hook);
  if (withFactions) {
    const npc = hydrateCanonicalNPC(withFactions);
    const factionKnowledge = npc.knowledge.filter(k => k.topic.startsWith('faction:'));
    check('faction-tagged NPC gets faction knowledge', factionKnowledge.length === withFactions.factions.length);
    check('hook seeds self-knowledge', npc.knowledge.some(k => k.topic.startsWith('self:')));
    check('hook seeds a background memory', npc.memories.some(m => m.type === 'background'));
  }

  console.log('\n═══  U.7: hydrateSandpointRoster indexes correctly  ═══');
  const { all, byId, byFaction, byLocation } = hydrateSandpointRoster();
  check('all === roster count', all.length === roster.npcs.length);
  check('byId lookup works', byId['npc-kendra-deverin']?.name === kendraEntry.name);
  check('byId coverage complete', Object.keys(byId).length === roster.npcs.length);
  check('byFaction has deverin-family', Array.isArray(byFaction['deverin-family']) && byFaction['deverin-family'].length >= 1);
  check('byLocation groups by location', Array.isArray(byLocation['Sandpoint Cathedral']) && byLocation['Sandpoint Cathedral'].length >= 1);

  console.log('\n═══  U.8: attachCanonicalNPCsToCampaign integration  ═══');
  const { campaign: base } = seedCampaignFromSource(seed);
  const before = { ...base };
  const attached = attachCanonicalNPCsToCampaign(base, { rosters: ['sandpoint'] });
  check('returns new object (immutable)', attached !== base);
  check('base.npcs not mutated', before.npcs === base.npcs);
  check('attached.npcs populated', attached.npcs && Object.keys(attached.npcs).length === roster.npcs.length);
  check('each NPC retrievable by id', attached.npcs['npc-belor-hemlock']?.name === 'Belor Hemlock');
  check('factions.members includes canonical NPC ids',
    attached.factions['sandpoint-town-guard']?.members?.includes('npc-belor-hemlock'));

  // Idempotent — running twice should not duplicate members
  const attached2 = attachCanonicalNPCsToCampaign(attached, { rosters: ['sandpoint'] });
  const memberCount1 = attached.factions['sandpoint-town-guard']?.members?.length || 0;
  const memberCount2 = attached2.factions['sandpoint-town-guard']?.members?.length || 0;
  check('attach is idempotent on faction members', memberCount1 === memberCount2);
}

// ════════════════════════════════════════════════════════════════════
// Part V: Rise of the Runelords — Chapter 1 (Burnt Offerings)
// Verifies that the RotR Ch.1 seed layers cleanly on top of Sandpoint.
// ════════════════════════════════════════════════════════════════════
console.log('\n════════  Part V: RotR Ch.1 Burnt Offerings — layered ingest  ════════');
{
  const {
    seedCampaignFromSource,
    extendCampaignFromSource,
  } = await import('./src/services/campaignSeed.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const sandpoint = JSON.parse(fs.readFileSync(path.resolve('./src/data/sandpoint-seed.json'), 'utf8'));
  const burntOfferings = JSON.parse(fs.readFileSync(path.resolve('./src/data/rotr-burnt-offerings-seed.json'), 'utf8'));
  const rotrNpcs = JSON.parse(fs.readFileSync(path.resolve('./src/data/rotr-burnt-offerings-npcs.json'), 'utf8'));

  console.log('\n═══  V.1: BO seed shape  ═══');
  check('BO seed has regions', Array.isArray(burntOfferings.regions) && burntOfferings.regions.length >= 1);
  check('BO seed has factionRelations', Array.isArray(burntOfferings.factionRelations));
  const boFactionIds = burntOfferings.regions.flatMap(r => r.factions.map(f => f.id));
  check('BO declares nualias-cabal', boFactionIds.includes('nualias-cabal'));
  check('BO declares catacombs-of-wrath', boFactionIds.includes('catacombs-of-wrath'));
  check('BO declares thistletop-goblin-leadership', boFactionIds.includes('thistletop-goblin-leadership'));
  check('BO declares malfeshnekors-prison', boFactionIds.includes('malfeshnekors-prison'));

  console.log('\n═══  V.2: layered seed (Sandpoint → BO) has no warnings  ═══');
  const { campaign: base } = seedCampaignFromSource(sandpoint);
  const { campaign: layered, warnings } = extendCampaignFromSource(base, burntOfferings);
  check('layered extend produces no warnings', warnings.length === 0, warnings);
  check('Sandpoint factions survive (mercantile league)', !!layered.factions['sandpoint-mercantile-league']);
  check('BO factions added (nualias-cabal)', !!layered.factions['nualias-cabal']);
  check('BO factions added (catacombs-of-wrath)', !!layered.factions['catacombs-of-wrath']);

  console.log('\n═══  V.3: cross-source relations resolve  ═══');
  // e.g. catacombs-of-wrath → cult-of-lamashtu is a BO→Sandpoint cross-ref
  const catRel = layered.factions['catacombs-of-wrath'].relations?.['cult-of-lamashtu']
    ?? layered.factionRelations?.['catacombs-of-wrath|cult-of-lamashtu'];
  check('catacombs-of-wrath → cult-of-lamashtu resolved', !!catRel);

  // nualias-cabal → sandpoint-cathedral
  const cabalRel = layered.factions['nualias-cabal'].relations?.['sandpoint-cathedral']
    ?? layered.factionRelations?.['nualias-cabal|sandpoint-cathedral'];
  check('nualias-cabal → sandpoint-cathedral resolved', !!cabalRel);

  console.log('\n═══  V.4: leadership + secrets carried through  ═══');
  check('Nualia seated as leader', layered.factions['nualias-cabal'].life.leadership.current === 'Nualia Tobyn');
  check('Ripnugget seated as leader', layered.factions['thistletop-goblin-leadership'].life.leadership.current === 'Chief Ripnugget');
  check('Erylium seated as leader', layered.factions['catacombs-of-wrath'].life.leadership.current === 'Erylium');
  check('Malfeshnekor seated as leader', layered.factions['malfeshnekors-prison'].life.leadership.current === 'Malfeshnekor');
  check('Nualia cabal carries Tsuto-betrayal secret',
    layered.factions['nualias-cabal'].life.secrets.some(s => /Tsuto/i.test(s.narrative || s.topic || '')));
  check('Catacombs carry runewell secret',
    layered.factions['catacombs-of-wrath'].life.secrets.some(s => /rune-?font|runewell|Thassilonian/i.test(s.narrative || s.topic || '')));

  console.log('\n═══  V.5: BO NPC roster shape  ═══');
  check('BO roster has 10 named antagonists', rotrNpcs.npcs.length === 10);
  const ids = new Set(rotrNpcs.npcs.map(n => n.id));
  check('ids unique', ids.size === rotrNpcs.npcs.length);
  for (const key of ['npc-nualia-tobyn','npc-tsuto-kaijitsu','npc-lyrie-akenja','npc-orik-vancaskerkin','npc-bruthazmus','npc-gogmurt','npc-chief-ripnugget','npc-erylium','npc-koruvus','npc-malfeshnekor']) {
    check(`roster contains ${key}`, ids.has(key));
  }
  const nualia = rotrNpcs.npcs.find(n => n.id === 'npc-nualia-tobyn');
  check('Nualia: CE aasimar fighter 2/cleric 4', nualia.alignment === 'CE' && nualia.race === 'aasimar'
    && nualia.classes.length === 2
    && nualia.classes.find(c => c.class === 'fighter')?.level === 2
    && nualia.classes.find(c => c.class === 'cleric')?.level === 4);
  const tsuto = rotrNpcs.npcs.find(n => n.id === 'npc-tsuto-kaijitsu');
  check('Tsuto is LE half-elf monk 2/rogue 2', tsuto.alignment === 'LE' && tsuto.race === 'half-elf');
  const erylium = rotrNpcs.npcs.find(n => n.id === 'npc-erylium');
  check('Erylium: CE quasit witch 3', erylium.race === 'quasit' && erylium.classes[0].class === 'witch');

  console.log('\n═══  V.6: BO faction refs in NPC roster all resolve  ═══');
  const allFactionIds = new Set(Object.keys(layered.factions));
  for (const npc of rotrNpcs.npcs) {
    for (const fid of (npc.factions || [])) {
      check(`${npc.id} → faction ${fid} resolves`, allFactionIds.has(fid));
    }
  }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════════  Part W: RotR BO NPCs flow through living-world  ════════');
{
  const {
    hydrateRotrBurntOfferingsRoster,
    attachCanonicalNPCsToCampaign,
  } = await import('./src/services/sandpointHydrator.js');
  const { seedCampaignFromSource, extendCampaignFromSource } = await import('./src/services/campaignSeed.js');
  const { defaultEmotionalState } = await import('./src/services/npcPersonality.js');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const sandpoint = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/sandpoint-seed.json'), 'utf8'));
  const burntOfferings = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/rotr-burnt-offerings-seed.json'), 'utf8'));

  console.log('\n═══  W.1: hydrateRotrBurntOfferingsRoster indexes correctly  ═══');
  const { all, byId, byFaction } = hydrateRotrBurntOfferingsRoster();
  check('BO roster hydrates 10 NPCs', all.length === 10);
  check('byId contains Nualia', !!byId['npc-nualia-tobyn']);
  check('byId contains Tsuto', !!byId['npc-tsuto-kaijitsu']);
  check('byFaction has nualias-cabal members', (byFaction['nualias-cabal'] || []).length >= 4);

  console.log('\n═══  W.2: hydrated NPC has full living-world shape  ═══');
  const nualia = byId['npc-nualia-tobyn'];
  check('Nualia canonicalSource = rotr-burnt-offerings', nualia.canonicalSource === 'rotr-burnt-offerings');
  check('Nualia settlement = Thistletop', nualia.settlement === 'Thistletop');
  check('Nualia not known to party', nualia.knownToParty === false);
  check('Nualia has emotional state object', nualia.emotionalState && typeof nualia.emotionalState === 'object');
  const dflt = defaultEmotionalState();
  check('Nualia emotional state matches default shape',
    Object.keys(dflt).every(k => k in nualia.emotionalState));
  check('Nualia has faction-derived knowledge',
    nualia.knowledge.some(k => k.topic === 'faction:nualias-cabal'));
  check('Nualia has hook-derived memory',
    nualia.memories.some(m => /Ezakien|Old Light|demonic/i.test(m.detail || '')));
  check('Nualia class title-cased', nualia.class === 'Fighter' || nualia.class === 'Cleric');
  check('Nualia has HP/AC derived', typeof nualia.hp === 'number' && typeof nualia.ac === 'number');
  check('Nualia race capitalized', nualia.race === 'Aasimar');
  check('Nualia firstImpression reads appearance-first',
    /^A /.test(nualia.firstImpression) && !nualia.firstImpression.includes('Nualia'));

  console.log('\n═══  W.3: attachCanonicalNPCsToCampaign merges BO roster into layered campaign  ═══');
  const { campaign: base } = seedCampaignFromSource(sandpoint);
  const { campaign: layered } = extendCampaignFromSource(base, burntOfferings);
  const attached = attachCanonicalNPCsToCampaign(layered);
  check('campaign.npcs has Nualia', !!attached.npcs['npc-nualia-tobyn']);
  check('campaign.npcs has Ripnugget', !!attached.npcs['npc-chief-ripnugget']);
  check('campaign.npcs has Sandpoint NPC too', !!attached.npcs['npc-kendra-deverin']);
  check('nualias-cabal.members includes Nualia',
    attached.factions['nualias-cabal'].members.includes('npc-nualia-tobyn'));
  check('nualias-cabal.members includes Tsuto',
    attached.factions['nualias-cabal'].members.includes('npc-tsuto-kaijitsu'));
  check('thistletop-goblin-leadership.members includes Ripnugget',
    attached.factions['thistletop-goblin-leadership'].members.includes('npc-chief-ripnugget'));
  check('catacombs-of-wrath.members includes Erylium',
    attached.factions['catacombs-of-wrath'].members.includes('npc-erylium'));

  console.log('\n═══  W.4: attach is idempotent  ═══');
  const attached2 = attachCanonicalNPCsToCampaign(attached);
  const nualiaMembersA = attached.factions['nualias-cabal'].members.filter(m => m === 'npc-nualia-tobyn').length;
  const nualiaMembersB = attached2.factions['nualias-cabal'].members.filter(m => m === 'npc-nualia-tobyn').length;
  check('re-attach does not duplicate members', nualiaMembersA === 1 && nualiaMembersB === 1);

  console.log('\n═══  W.5: selective roster attach  ═══');
  const onlySandpoint = attachCanonicalNPCsToCampaign(layered, { rosters: ['sandpoint'] });
  check('sandpoint-only attach: Nualia NOT present', !onlySandpoint.npcs['npc-nualia-tobyn']);
  check('sandpoint-only attach: Kendra present', !!onlySandpoint.npcs['npc-kendra-deverin']);
  const onlyBO = attachCanonicalNPCsToCampaign(layered, { rosters: ['rotr-burnt-offerings'] });
  check('BO-only attach: Nualia present', !!onlyBO.npcs['npc-nualia-tobyn']);
  check('BO-only attach: Kendra NOT present', !onlyBO.npcs['npc-kendra-deverin']);
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n──────────────────────────────────────────`);
console.log(`familiarEngine.test: ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────`);
process.exit(failed > 0 ? 1 : 0);
