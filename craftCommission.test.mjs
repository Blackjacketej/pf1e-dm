// craftCommission.test.mjs
// Tests for commission flow — offers, acceptance, completion.
// Run: npx vite-node craftCommission.test.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  defaultCommissionFeeGP,
  buildCommissionOffer,
  acceptCommission,
  resolveCommissionCompletion,
} from './src/utils/commissioning.js';

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
section('defaultCommissionFeeGP — fee = max(1, round(price/3))');

assert('100 gp → 33 gp', defaultCommissionFeeGP(100) === 33);
assert('15 gp → 5 gp', defaultCommissionFeeGP(15) === 5);
assert('3 gp → 1 gp', defaultCommissionFeeGP(3) === 1);
assert('0 gp → 1 gp (min floor)', defaultCommissionFeeGP(0) === 1);
assert('undefined → 1 gp', defaultCommissionFeeGP(undefined) === 1);

// ──────────────────────────────────────────────────────────────────
section('buildCommissionOffer — basic flow');

const mockNpc = {
  id: 'npc-1',
  name: 'Blacksmith',
  skillRanks: { 'Craft (weapons)': 8 },
  abilities: { INT: 12 },
};

const offerWeapon = buildCommissionOffer({
  npc: mockNpc,
  registry: craftableItemsData,
  itemName: 'longsword',
  opts: {},
});

assert('weapon offer ok', offerWeapon.ok === true);
assert('offer.totalDueGP > 0', offerWeapon.offer?.totalDueGP > 0);
assert('offer.estimatedWeeks > 0', offerWeapon.offer?.estimatedWeeks > 0);
assert('offer.totalDueGP = materials + fee',
  Math.abs(offerWeapon.offer.totalDueGP - (offerWeapon.offer.materialsGP + offerWeapon.offer.feeGP)) < 0.001);
assert('offer has npcId', offerWeapon.offer?.npcId === mockNpc.id);
assert('offer has itemName', offerWeapon.offer?.itemName === 'longsword');
assert('offer has subSkill', offerWeapon.offer?.subSkill === 'Craft (weapons)');
assert('offer has npcSkillTotal (ranks 8 + INT mod 1 = 9)',
  offerWeapon.offer?.npcSkillTotal === 9);
assert('spec returned', offerWeapon.spec?.craftable === true);

// ──────────────────────────────────────────────────────────────────
section('buildCommissionOffer — accelerated adds DC+10');

const normal = buildCommissionOffer({
  npc: mockNpc, registry: craftableItemsData, itemName: 'longsword', opts: {},
});
const accel = buildCommissionOffer({
  npc: mockNpc, registry: craftableItemsData, itemName: 'longsword',
  opts: { accelerated: true },
});

assert('accelerated ok', accel.ok === true);
assert('accelerated flag preserved', accel.offer.accelerated === true);
assert('effectiveDc = dc + 10', accel.offer.effectiveDc === normal.offer.dc + 10);
assert('non-accelerated effectiveDc = dc', normal.offer.effectiveDc === normal.offer.dc);
// Weekly SP = check × effDc, so higher DC → more SP/week → fewer weeks (CRB formula)
assert('accelerated weeks ≤ normal weeks', accel.offer.estimatedWeeks <= normal.offer.estimatedWeeks);

// ──────────────────────────────────────────────────────────────────
section('buildCommissionOffer — fee override');

const offerFee = buildCommissionOffer({
  npc: mockNpc, registry: craftableItemsData, itemName: 'longsword',
  opts: { feeGP: 50 },
});
assert('fee override applied', offerFee.offer.feeGP === 50);

const offerZeroFee = buildCommissionOffer({
  npc: mockNpc, registry: craftableItemsData, itemName: 'longsword',
  opts: { feeGP: 0 },
});
assert('zero fee override respected', offerZeroFee.offer.feeGP === 0);

// ──────────────────────────────────────────────────────────────────
section('buildCommissionOffer — error paths');

const noNpc = buildCommissionOffer({
  npc: null, registry: craftableItemsData, itemName: 'longsword', opts: {},
});
assert('no NPC → ok=false', noNpc.ok === false);

const badItem = buildCommissionOffer({
  npc: mockNpc, registry: craftableItemsData, itemName: 'nonexistent_xyz', opts: {},
});
assert('bad item → ok=false', badItem.ok === false);

// ──────────────────────────────────────────────────────────────────
section('buildCommissionOffer — unskilled NPC → infinite weeks');

const dumbNpc = {
  id: 'dumb', name: 'Apprentice',
  skillRanks: {}, abilities: { INT: 8 },  // -1 int mod, 0 ranks → total -1
};
const hardItem = buildCommissionOffer({
  npc: dumbNpc, registry: craftableItemsData, itemName: 'longsword', opts: {},
});
// skillTotal = -1, take-10 = 9, vs DC ~15 → effCheck × effDc = 9 × 15 = 135sp/week > 0
// So finite — but weekly progress is positive. Check it stays reasonable.
assert('unskilled offer still ok', hardItem.ok === true);
assert('estimatedWeeks finite when eff check positive',
  Number.isFinite(hardItem.offer.estimatedWeeks));

// ──────────────────────────────────────────────────────────────────
section('acceptCommission — patches and state updates');

const npc2 = {
  id: 'npc-2', name: 'Armorer',
  skillRanks: { 'Craft (armor)': 6 }, abilities: { INT: 12 },
  craftProjects: [],
};

const offer2 = buildCommissionOffer({
  npc: npc2, registry: craftableItemsData, itemName: 'leather armor', opts: {},
});

assert('offer2 ok', offer2.ok === true);

const acceptance = acceptCommission({
  offer: offer2.offer,
  spec: offer2.spec,
  npc: npc2,
  payerCharacterId: 'pc-1',
  nowIso: '2026-04-15T00:00:00Z',
});

assert('acceptance ok', acceptance.ok === true);
assert('patches.npcUpdate.craftProjects is array',
  Array.isArray(acceptance.patches?.npcUpdate?.craftProjects));
assert('npcUpdate has 1 new project',
  acceptance.patches.npcUpdate.craftProjects.length === 1);
assert('queued project has itemName',
  acceptance.patches.npcUpdate.craftProjects[0].itemName === 'leather armor');
assert('queued project commissionedBy = payerId',
  acceptance.patches.npcUpdate.craftProjects[0].commissionedBy === 'pc-1');
assert('goldDelta is negative',
  acceptance.patches.goldDelta < 0);
assert('goldDelta equals -totalDueGP',
  acceptance.patches.goldDelta === -offer2.offer.totalDueGP);
assert('commissionRecord.id present', !!acceptance.patches.commissionRecord?.id);
assert('commissionRecord.npcId matches', acceptance.patches.commissionRecord.npcId === npc2.id);
assert('commissionRecord.payerCharacterId matches',
  acceptance.patches.commissionRecord.payerCharacterId === 'pc-1');
assert('commissionRecord.status = in-progress',
  acceptance.patches.commissionRecord.status === 'in-progress');
assert('record id matches project id',
  acceptance.patches.commissionRecord.id ===
  acceptance.patches.npcUpdate.craftProjects[0].id);

// ──────────────────────────────────────────────────────────────────
section('acceptCommission — error paths');

const noOffer = acceptCommission({ offer: null, spec: null, npc: npc2 });
assert('no offer → ok=false', noOffer.ok === false);

const noNpcAccept = acceptCommission({
  offer: offer2.offer, spec: offer2.spec, npc: null,
});
assert('no npc → ok=false', noNpcAccept.ok === false);

// ──────────────────────────────────────────────────────────────────
section('resolveCommissionCompletion');

const record = acceptance.patches.commissionRecord;
const completion = {
  projectId: record.id,
  commissionedBy: 'pc-1',
  itemName: 'leather armor',
  priceGP: record.priceGP,
  subSkill: record.subSkill,
  completedAt: '2026-05-01T00:00:00Z',
  masterwork: false,
};

const resolved = resolveCommissionCompletion(completion, [record]);
assert('resolveCompletion ok', resolved.ok === true);
assert('delivery.deliverToCharacterId matches payer',
  resolved.delivery.deliverToCharacterId === 'pc-1');
assert('delivery includes itemName',
  resolved.delivery.itemName === 'leather armor');
assert('updatedRecord.status = delivered',
  resolved.updatedRecord.status === 'delivered');
assert('updatedRecord has deliveredAt', !!resolved.updatedRecord.deliveredAt);

// Non-commissioned completion
const nonComm = resolveCommissionCompletion(
  { projectId: 'x', commissionedBy: null },
  [],
);
assert('non-commissioned → ok=false', nonComm.ok === false);

// Missing record
const missing = resolveCommissionCompletion(
  { projectId: 'unknown-id', commissionedBy: 'pc-1' },
  [record],
);
assert('missing record → ok=false', missing.ok === false);

// ──────────────────────────────────────────────────────────────────
console.log(`\n✓ Passed: ${pass}, ✗ Failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
