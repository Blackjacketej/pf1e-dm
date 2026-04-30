// craftFacilities.test.mjs — tests for UC-style craft facility helpers.
// Run: npx vite-node craftFacilities.test.mjs

import {
  getAllFacilities,
  getFacilityById,
  getFacilitiesForSubSkill,
  resolveFacilityBonus,
  applyFacilityToToolMods,
  getLocationFacilityIds,
  collectFacilityIdsFromLocations,
  resolveNpcFacilityIds,
} from './src/utils/craftFacilities.js';

import sandpointData from './src/data/sandpoint.json' with { type: 'json' };
import sandpointMapData from './src/data/sandpointMap.json' with { type: 'json' };
import shopsData from './src/data/shops.json' with { type: 'json' };

let passed = 0;
let failed = 0;
function assert(label, ok) {
  if (ok) { passed++; }
  else { failed++; console.error(`✗ ${label}`); }
}
function section(label) { console.log(`\n── ${label} ──`); }

// ──────────────────────────────────────────────────────────────────
section('getAllFacilities + getFacilityById');

const all = getAllFacilities();
assert('getAllFacilities returns array', Array.isArray(all));
assert('at least 5 facilities', all.length >= 5);

const forge = getFacilityById('forge');
assert('forge exists', forge !== null);
assert('forge name', forge.name === 'Forge');
assert('forge toolBonus is 2', forge.toolBonus === 2);
assert('forge covers Craft (armor)', forge.craftSubSkills.includes('Craft (armor)'));
assert('forge covers Craft (weapons)', forge.craftSubSkills.includes('Craft (weapons)'));

const alchLab = getFacilityById('alchemy-lab');
assert('alchemy-lab exists', alchLab !== null);
assert('alchemy-lab covers Craft (alchemy)', alchLab.craftSubSkills.includes('Craft (alchemy)'));

assert('unknown facility returns null', getFacilityById('does-not-exist') === null);

// ──────────────────────────────────────────────────────────────────
section('getFacilitiesForSubSkill');

const forWeapons = getFacilitiesForSubSkill('Craft (weapons)');
assert('weapons → includes forge', forWeapons.some(f => f.id === 'forge'));

const forAlchemy = getFacilitiesForSubSkill('Craft (alchemy)');
assert('alchemy → includes alchemy-lab', forAlchemy.some(f => f.id === 'alchemy-lab'));

const forLeather = getFacilitiesForSubSkill('Craft (leather)');
assert('leather → includes leather-workshop', forLeather.some(f => f.id === 'leather-workshop'));

const forBows = getFacilitiesForSubSkill('Craft (bows)');
assert('bows → includes bowyer-workshop', forBows.some(f => f.id === 'bowyer-workshop'));

const forJewelry = getFacilitiesForSubSkill('Craft (jewelry)');
assert('jewelry → includes artisan-workshop', forJewelry.some(f => f.id === 'artisan-workshop'));

assert('case insensitive', getFacilitiesForSubSkill('craft (weapons)').length > 0);
assert('null subSkill → empty', getFacilitiesForSubSkill(null).length === 0);
assert('unknown subSkill → empty', getFacilitiesForSubSkill('Craft (underwater baskets)').length === 0);

// ──────────────────────────────────────────────────────────────────
section('resolveFacilityBonus');

const r1 = resolveFacilityBonus('Craft (weapons)', ['forge', 'alchemy-lab']);
assert('weapons + forge → match', r1 !== null);
assert('weapons + forge → toolBonus 2', r1.toolBonus === 2);
assert('weapons + forge → facility is forge', r1.facility.id === 'forge');

const r2 = resolveFacilityBonus('Craft (weapons)', ['alchemy-lab']);
assert('weapons + no forge → null', r2 === null);

const r3 = resolveFacilityBonus('Craft (alchemy)', ['alchemy-lab']);
assert('alchemy + alchemy-lab → match', r3 !== null);
assert('alchemy + alchemy-lab → id', r3.facility.id === 'alchemy-lab');

assert('null subSkill → null', resolveFacilityBonus(null, ['forge']) === null);
assert('empty facilities → null', resolveFacilityBonus('Craft (weapons)', []) === null);
assert('null facilities → null', resolveFacilityBonus('Craft (weapons)', null) === null);

// ──────────────────────────────────────────────────────────────────
section('applyFacilityToToolMods');

const tm1 = applyFacilityToToolMods('Craft (weapons)', ['forge']);
assert('forge → masterworkTools true', tm1.masterworkTools === true);
assert('forge → alchemistLab untouched', tm1.alchemistLab === undefined);

const tm2 = applyFacilityToToolMods('Craft (alchemy)', ['alchemy-lab']);
assert('alchemy-lab → alchemistLab true', tm2.alchemistLab === true);
assert('alchemy-lab → masterworkTools untouched', tm2.masterworkTools === undefined);

const tm3 = applyFacilityToToolMods('Craft (weapons)', ['forge'], { improvisedTools: true });
assert('preserves existing improvisedTools', tm3.improvisedTools === true);
assert('also sets masterworkTools', tm3.masterworkTools === true);

const tm4 = applyFacilityToToolMods('Craft (weapons)', []);
assert('no facility → returns copy of existing', Object.keys(tm4).length === 0);

const tm5 = applyFacilityToToolMods('Craft (weapons)', [], { improvisedTools: true });
assert('no facility → preserves existing', tm5.improvisedTools === true);

// ──────────────────────────────────────────────────────────────────
section('getLocationFacilityIds');

// Explicit craftFacilities list
assert('explicit craftFacilities', JSON.stringify(
  getLocationFacilityIds({ craftFacilities: ['forge', 'alchemy-lab'] })
) === '["forge","alchemy-lab"]');

// Inferred from type/name for backward-compat
const savah = { name: "Savah's Armory", type: 'shop' };
assert('armory → infers forge', getLocationFacilityIds(savah).includes('forge'));

const blacksmith = { name: 'Town Blacksmith', type: 'blacksmith' };
assert('blacksmith type → infers forge', getLocationFacilityIds(blacksmith).includes('forge'));

const glassworks = { name: 'Kaijitsu Glassworks', type: 'factory' };
assert('factory + glasswork → infers artisan-workshop',
  getLocationFacilityIds(glassworks).includes('artisan-workshop'));

const tannery = { name: 'Tannery', type: 'tannery' };
assert('tannery → infers leather-workshop',
  getLocationFacilityIds(tannery).includes('leather-workshop'));

const apothecary = { name: "Pillbug's Apothecary", type: 'shop' };
assert('apothecary → infers alchemy-lab',
  getLocationFacilityIds(apothecary).includes('alchemy-lab'));

const bowyer = { name: "Fletcher and Bowyer", type: 'shop' };
assert('bowyer → infers bowyer-workshop',
  getLocationFacilityIds(bowyer).includes('bowyer-workshop'));

const inn = { name: 'Rusty Dragon', type: 'inn' };
assert('inn → no facilities', getLocationFacilityIds(inn).length === 0);

assert('null location → empty', getLocationFacilityIds(null).length === 0);

// ──────────────────────────────────────────────────────────────────
section('canonical Sandpoint data — explicit craftFacilities resolve');

// Helpers
function findInArray(arr, name) {
  return arr.find(x => x.name === name) || null;
}

// shops.json — 3 entries with explicit craftFacilities
const redDog = shopsData.shops['red-dog-smithy'];
assert('shops.json red-dog-smithy has explicit craftFacilities',
  Array.isArray(redDog?.craftFacilities) && redDog.craftFacilities.includes('forge'));
assert('shops.json red-dog-smithy resolves to forge via getLocationFacilityIds',
  getLocationFacilityIds(redDog).includes('forge'));

const pillbug = shopsData.shops['pillbugs-pantry'];
assert('shops.json pillbugs-pantry has explicit craftFacilities',
  Array.isArray(pillbug?.craftFacilities) && pillbug.craftFacilities.includes('alchemy-lab'));
assert('shops.json pillbugs-pantry resolves to alchemy-lab',
  getLocationFacilityIds(pillbug).includes('alchemy-lab'));

const curios = shopsData.shops['sandpoint-curios'];
assert('shops.json sandpoint-curios has explicit craftFacilities',
  Array.isArray(curios?.craftFacilities) && curios.craftFacilities.includes('artisan-workshop'));
assert('shops.json sandpoint-curios resolves to artisan-workshop',
  getLocationFacilityIds(curios).includes('artisan-workshop'));

// Non-craft shop should still have no facilities
const generalStore = shopsData.shops['sandpoint-general-store'];
assert('shops.json sandpoint-general-store has no craftFacilities',
  !generalStore.craftFacilities || generalStore.craftFacilities.length === 0);

// sandpoint.json — 5 entries with explicit craftFacilities
const sandpointLocs = sandpointData.locations || [];

const sj_savah = findInArray(sandpointLocs, "Savah's Armory");
assert('sandpoint.json Savah\'s Armory has explicit craftFacilities',
  Array.isArray(sj_savah?.craftFacilities) && sj_savah.craftFacilities.includes('forge'));
assert('sandpoint.json Savah\'s Armory resolves to forge',
  getLocationFacilityIds(sj_savah).includes('forge'));

const sj_bottled = findInArray(sandpointLocs, 'Bottled Solutions');
assert('sandpoint.json Bottled Solutions has explicit craftFacilities',
  Array.isArray(sj_bottled?.craftFacilities) && sj_bottled.craftFacilities.includes('alchemy-lab'));
assert('sandpoint.json Bottled Solutions resolves to alchemy-lab',
  getLocationFacilityIds(sj_bottled).includes('alchemy-lab'));

const sj_glassworks = findInArray(sandpointLocs, 'Kaijitsu Glassworks');
assert('sandpoint.json Kaijitsu Glassworks has explicit craftFacilities',
  Array.isArray(sj_glassworks?.craftFacilities) && sj_glassworks.craftFacilities.includes('artisan-workshop'));
assert('sandpoint.json Kaijitsu Glassworks resolves to artisan-workshop',
  getLocationFacilityIds(sj_glassworks).includes('artisan-workshop'));

const lumberMill = findInArray(sandpointLocs, 'Sandpoint Lumber Mill');
assert('sandpoint.json Sandpoint Lumber Mill has explicit craftFacilities',
  Array.isArray(lumberMill?.craftFacilities) && lumberMill.craftFacilities.includes('artisan-workshop'));
assert('sandpoint.json Sandpoint Lumber Mill resolves to artisan-workshop (carpentry)',
  getLocationFacilityIds(lumberMill).includes('artisan-workshop'));

const shipyard = findInArray(sandpointLocs, 'Sandpoint Shipyard');
assert('sandpoint.json Sandpoint Shipyard has explicit craftFacilities',
  Array.isArray(shipyard?.craftFacilities) && shipyard.craftFacilities.includes('artisan-workshop'));
assert('sandpoint.json Sandpoint Shipyard resolves to artisan-workshop',
  getLocationFacilityIds(shipyard).includes('artisan-workshop'));

// Non-craft sandpoint.json location still resolves cleanly
const cathedral = findInArray(sandpointLocs, 'Sandpoint Cathedral');
assert('sandpoint.json Cathedral has no craftFacilities',
  !cathedral.craftFacilities || cathedral.craftFacilities.length === 0);
assert('sandpoint.json Cathedral resolves to empty',
  getLocationFacilityIds(cathedral).length === 0);

// sandpointMap.json — 12 entries with explicit craftFacilities
const mapLocs = sandpointMapData.locations || [];

const expectedMap = [
  ['Jeweler', 'artisan-workshop'],
  ['Locksmith', 'artisan-workshop'],
  ["Savah's Armory", 'forge'],
  ['Rovanky Tannery', 'leather-workshop'],
  ['Red Dog Smithy', 'forge'],
  ["The Pillbug's Pantry", 'alchemy-lab'],
  ['Bottled Solutions', 'alchemy-lab'],
  ['Sandpoint Glassworks', 'artisan-workshop'],
  ["Carpenter's Guild", 'artisan-workshop'],
  ['Sandpoint Lumber Mill', 'artisan-workshop'],
  ['Scarnetti Mill', 'artisan-workshop'],
  ['Sandpoint Shipyard', 'artisan-workshop'],
];

for (const [name, facilityId] of expectedMap) {
  const loc = findInArray(mapLocs, name);
  assert(`sandpointMap.json "${name}" has explicit craftFacilities=[${facilityId}]`,
    Array.isArray(loc?.craftFacilities) && loc.craftFacilities.includes(facilityId));
  assert(`sandpointMap.json "${name}" resolves via getLocationFacilityIds`,
    getLocationFacilityIds(loc).includes(facilityId));
}

// A non-craft map location (tavern) should resolve to empty
const rustyDragon = findInArray(mapLocs, 'The Rusty Dragon');
assert('sandpointMap.json The Rusty Dragon resolves to empty',
  getLocationFacilityIds(rustyDragon).length === 0);

// Explicit data takes priority over inference: pre-Phase-4, Savah's Armory
// resolved to ['forge'] purely via name inference. Now it should resolve to
// ['forge'] via the explicit array (single id, not duplicated).
const savahMap = findInArray(mapLocs, "Savah's Armory");
const savahIds = getLocationFacilityIds(savahMap);
assert('explicit array used as-is (no inference duplication)',
  savahIds.length === 1 && savahIds[0] === 'forge');

// End-to-end: PC at Red Dog Smithy crafting weapons gets toolMods.masterworkTools
const redDogMap = findInArray(mapLocs, 'Red Dog Smithy');
const redDogFacIds = getLocationFacilityIds(redDogMap);
const weaponMods = applyFacilityToToolMods('Craft (weapons)', redDogFacIds);
assert('end-to-end: weapons at Red Dog Smithy → masterworkTools true',
  weaponMods.masterworkTools === true);

const pillbugMap = findInArray(mapLocs, "The Pillbug's Pantry");
const pillbugFacIds = getLocationFacilityIds(pillbugMap);
const alchemyMods = applyFacilityToToolMods('Craft (alchemy)', pillbugFacIds);
assert('end-to-end: alchemy at Pillbug\'s Pantry → alchemistLab true',
  alchemyMods.alchemistLab === true);

// ──────────────────────────────────────────────────────────────────
section('collectFacilityIdsFromLocations');

const collected1 = collectFacilityIdsFromLocations([
  { craftFacilities: ['forge'] },
  { craftFacilities: ['alchemy-lab'] },
  { craftFacilities: ['forge', 'artisan-workshop'] },
]);
assert('collects union of explicit ids', collected1.length === 3
  && collected1.includes('forge')
  && collected1.includes('alchemy-lab')
  && collected1.includes('artisan-workshop'));

assert('collects nothing from empty array',
  collectFacilityIdsFromLocations([]).length === 0);

assert('collects nothing from non-array',
  collectFacilityIdsFromLocations(null).length === 0);

// Mixed explicit + inferred — duplicate forge is deduped
const collected2 = collectFacilityIdsFromLocations([
  { craftFacilities: ['forge'] },
  { name: 'The Red Forge', type: 'blacksmith' }, // infers forge
]);
assert('mixed explicit + inferred picks up forge twice → deduped to once',
  collected2.filter(id => id === 'forge').length === 1);

// Sandpoint-level union test: all shops in Sandpoint produce a craft-facility
// union that includes forge, alchemy-lab, and artisan-workshop.
const sandpointShops = Object.values(shopsData.shops || {}).filter(
  s => String(s.settlement || '').toLowerCase() === 'sandpoint'
);
const shopUnion = collectFacilityIdsFromLocations(sandpointShops);
assert('Sandpoint shops union includes forge', shopUnion.includes('forge'));
assert('Sandpoint shops union includes alchemy-lab', shopUnion.includes('alchemy-lab'));
assert('Sandpoint shops union includes artisan-workshop', shopUnion.includes('artisan-workshop'));

// Full Sandpoint union (shops + sandpoint.json + sandpointMap.json)
const fullSandpointUnion = collectFacilityIdsFromLocations([
  ...sandpointShops,
  ...(sandpointData.locations || []),
  ...(sandpointMapData.locations || []),
]);
assert('full Sandpoint union includes leather-workshop (tannery)',
  fullSandpointUnion.includes('leather-workshop'));
assert('full Sandpoint union includes forge',
  fullSandpointUnion.includes('forge'));
assert('full Sandpoint union includes alchemy-lab',
  fullSandpointUnion.includes('alchemy-lab'));
assert('full Sandpoint union includes artisan-workshop',
  fullSandpointUnion.includes('artisan-workshop'));

// ──────────────────────────────────────────────────────────────────
section('resolveNpcFacilityIds');

// Full canonical location pool used in production paths
const npcLocationPool = [
  ...Object.values(shopsData.shops || {}),
  ...(sandpointMapData.locations || []),
  ...(sandpointData.locations || []),
];

// Strategy 1 — operator match via bare id (shops.json uses short form)
const dasKorvutShort = { id: 'das-korvut', name: 'Das Korvut', location: 'Red Dog Smithy' };
const dasKorvutFac1 = resolveNpcFacilityIds(dasKorvutShort, npcLocationPool);
assert('NPC with short id "das-korvut" → forge (via operatorNpc match)',
  dasKorvutFac1.includes('forge'));

// Strategy 1 — operator match via "npc-" prefixed id (living-world NPCs use prefix)
const dasKorvutPrefix = { id: 'npc-das-korvut', name: 'Das Korvut', location: 'Red Dog Smithy' };
const dasKorvutFac2 = resolveNpcFacilityIds(dasKorvutPrefix, npcLocationPool);
assert('NPC with prefixed id "npc-das-korvut" → forge (strips npc- prefix for match)',
  dasKorvutFac2.includes('forge'));

// Pillbug (alchemist) → alchemy-lab
const pillbugNpc = { id: 'npc-pillbug-podiker', name: 'Pillbug Podiker', location: "The Pillbug's Pantry" };
const pillbugFac = resolveNpcFacilityIds(pillbugNpc, npcLocationPool);
assert('Pillbug Podiker → alchemy-lab',
  pillbugFac.includes('alchemy-lab'));

// Vorvashali Voon (jeweler/curio) → artisan-workshop
const vorvashaliNpc = { id: 'npc-vorvashali-voon', name: 'Vorvashali Voon', location: 'Sandpoint Curios' };
const vorvashaliFac = resolveNpcFacilityIds(vorvashaliNpc, npcLocationPool);
assert('Vorvashali Voon → artisan-workshop',
  vorvashaliFac.includes('artisan-workshop'));

// Strategy 2 — no operatorNpc match, but .location matches a canonical name
const unknownArmorer = { id: 'npc-random-smith', name: 'Random Smith', location: "Savah's Armory" };
const unknownFac = resolveNpcFacilityIds(unknownArmorer, npcLocationPool);
assert('NPC at Savah\'s Armory (location match) → forge',
  unknownFac.includes('forge'));

// NPC at non-craft location — returns empty
const innNpc = { id: 'npc-ameiko', name: 'Ameiko', location: 'The Rusty Dragon' };
const innFac = resolveNpcFacilityIds(innNpc, npcLocationPool);
assert('NPC at The Rusty Dragon → empty (inn, no facilities)',
  innFac.length === 0);

// NPC with no location and no operator match
const floater = { id: 'npc-unknown', name: 'Unknown' };
assert('NPC with no location and no match → empty',
  resolveNpcFacilityIds(floater, npcLocationPool).length === 0);

// Edge cases
assert('null npc → empty', resolveNpcFacilityIds(null, npcLocationPool).length === 0);
assert('empty pool → empty', resolveNpcFacilityIds(dasKorvutShort, []).length === 0);
assert('null pool → empty', resolveNpcFacilityIds(dasKorvutShort, null).length === 0);

// End-to-end: NPC commission toolMods derivation
const npcFacIds = resolveNpcFacilityIds(dasKorvutShort, npcLocationPool);
const weaponCommissionMods = applyFacilityToToolMods('Craft (weapons)', npcFacIds, {});
assert('end-to-end: commission Das Korvut for weapons → masterworkTools true',
  weaponCommissionMods.masterworkTools === true);

const pillbugFacIdsE2E = resolveNpcFacilityIds(pillbugNpc, npcLocationPool);
const alchemyCommissionMods = applyFacilityToToolMods('Craft (alchemy)', pillbugFacIdsE2E, {});
assert('end-to-end: commission Pillbug for alchemy → alchemistLab true',
  alchemyCommissionMods.alchemistLab === true);

// ──────────────────────────────────────────────────────────────────
console.log(`\n✓ Passed: ${passed}, ✗ Failed: ${failed}`);
if (failed > 0) process.exit(1);
