// craftCatalog.test.mjs
// Tests for craft catalog utilities — sub-skill listing, item lookup, filtering.
// Run: npx vite-node craftCatalog.test.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listCraftSubSkills,
  getCraftSpecByName,
  listRegistryItemsBySubSkill,
  normalizeCraftSubSkill,
  filterCraftableBySubSkill,
  getCraftSpec,
} from './src/utils/craftCatalog.js';

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
section('normalizeCraftSubSkill — canonical form');

assert('lowercase "armor" → "Craft (armor)"',
  normalizeCraftSubSkill('armor') === 'Craft (armor)');
assert('uppercase "Armor" → "Craft (armor)"',
  normalizeCraftSubSkill('Armor') === 'Craft (armor)');
assert('mixed case "Craft (Armor)" → "Craft (armor)"',
  normalizeCraftSubSkill('Craft (Armor)') === 'Craft (armor)');
assert('undefined → null', normalizeCraftSubSkill(undefined) === null);
assert('empty → null', normalizeCraftSubSkill('') === null);
assert('"Craft (weapons)" passes through',
  normalizeCraftSubSkill('Craft (weapons)') === 'Craft (weapons)');
assert('unknown alias still canonicalizes',
  normalizeCraftSubSkill('Craft (pottery)') === 'Craft (pottery)');

// ──────────────────────────────────────────────────────────────────
section('listCraftSubSkills — returns array of 10');

const subSkills = listCraftSubSkills();
assert('returns array', Array.isArray(subSkills));
assert('returns 10 sub-skills', subSkills.length === 10);
assert('contains "Craft (armor)"', subSkills.includes('Craft (armor)'));
assert('contains "Craft (weapons)"', subSkills.includes('Craft (weapons)'));
assert('contains "Craft (bows)"', subSkills.includes('Craft (bows)'));
assert('contains "Craft (alchemy)"', subSkills.includes('Craft (alchemy)'));
assert('all strings', subSkills.every(s => typeof s === 'string'));
assert('sorted', JSON.stringify(subSkills) === JSON.stringify([...subSkills].sort()));

// ──────────────────────────────────────────────────────────────────
section('getCraftSpecByName — lookup by itemName in registry');

const leatherByName = getCraftSpecByName('leather armor', craftableItemsData);
assert('leather armor is craftable', leatherByName && leatherByName.craftable === true);
assert('leather armor has dc', leatherByName?.dc > 0);
assert('leather armor has priceGP', leatherByName?.priceGP > 0);
assert('leather armor has materialsGP', leatherByName?.materialsGP > 0);
assert('leather armor subSkill is canonical',
  leatherByName?.subSkill === 'Craft (armor)');

const longbowByName = getCraftSpecByName('longbow', craftableItemsData);
assert('longbow found', longbowByName && longbowByName.craftable === true);
assert('longbow is Craft (bows)', longbowByName?.subSkill === 'Craft (bows)');

const daggerByName = getCraftSpecByName('dagger', craftableItemsData);
assert('dagger found', daggerByName && daggerByName.craftable === true);
assert('dagger is Craft (weapons)', daggerByName?.subSkill === 'Craft (weapons)');

const notFound = getCraftSpecByName('nonexistent item xyz', craftableItemsData);
assert('nonexistent → not craftable', notFound?.craftable === false);

const caseInsens = getCraftSpecByName('LONGBOW', craftableItemsData);
assert('case-insensitive name lookup', caseInsens?.craftable === true);

// ──────────────────────────────────────────────────────────────────
section('listRegistryItemsBySubSkill — filter items by sub-skill');

const armorItems = listRegistryItemsBySubSkill(craftableItemsData, 'Craft (armor)');
assert('armor sub-skill returns array', Array.isArray(armorItems));
assert('armor has items', armorItems.length >= 1);
assert('armor array contains strings', armorItems.every(s => typeof s === 'string'));

const bowItems = listRegistryItemsBySubSkill(craftableItemsData, 'Craft (bows)');
assert('bows returns array', Array.isArray(bowItems));
assert('bows has items', bowItems.length >= 2);
assert('bows includes "longbow"', bowItems.includes('longbow'));

const weaponItems = listRegistryItemsBySubSkill(craftableItemsData, 'Craft (weapons)');
assert('weapons has ≥ 5 items', weaponItems.length >= 5);

const emptyItems = listRegistryItemsBySubSkill(craftableItemsData, 'Craft (nope)');
assert('unknown sub-skill → empty', Array.isArray(emptyItems) && emptyItems.length === 0);

// Short-form sub-skill works too (alias)
const armorShort = listRegistryItemsBySubSkill(craftableItemsData, 'armor');
assert('short "armor" form still matches', armorShort.length === armorItems.length);

// ──────────────────────────────────────────────────────────────────
section('filterCraftableBySubSkill — embedded-metadata form');

const items = [
  { name: 'x', priceGP: 10, craftable: { subSkill: 'Craft (weapons)', complexity: 'simple weapon' } },
  { name: 'y', priceGP: 10, craftable: { subSkill: 'Craft (armor)', acBonus: 2 } },
  { name: 'z', priceGP: 10 }, // not craftable
];
const weps = filterCraftableBySubSkill(items, 'Craft (weapons)');
assert('embedded filter returns array', Array.isArray(weps));
assert('embedded filter returns 1 weapon', weps.length === 1);
assert('weapon item has name', weps[0].name === 'x');

// ──────────────────────────────────────────────────────────────────
section('getCraftSpec — armor + bow routing');

const armorSpec = getCraftSpec({
  name: 'chainmail', priceGP: 150,
  craftable: { subSkill: 'Craft (armor)', acBonus: 6, masterworkable: true },
});
assert('armor routes via armor DC', armorSpec.craftable && armorSpec.dcFormula === 'armor');
assert('armor masterworkable sets MW DC', armorSpec.masterworkDC === 20);
assert('armor MW component default 150gp', armorSpec.masterworkComponentGP === 150);

const bowSpec = getCraftSpec({
  name: 'composite longbow (+2)', priceGP: 300,
  craftable: { subSkill: 'Craft (bows)', strRating: 2, masterworkable: true },
});
assert('bow routes via composite-bow DC', bowSpec.craftable && bowSpec.dcFormula === 'composite-bow');
assert('bow MW component default 300gp', bowSpec.masterworkComponentGP === 300);

const weaponSpec = getCraftSpec({
  name: 'dagger', priceGP: 2,
  craftable: { subSkill: 'Craft (weapons)', complexity: 'simple weapon' },
});
assert('weapon routes via flat DC', weaponSpec.craftable && weaponSpec.dcFormula === 'flat');

// ──────────────────────────────────────────────────────────────────
section('Cross-catalog consistency');

for (const subSkill of listCraftSubSkills()) {
  const regItems = listRegistryItemsBySubSkill(craftableItemsData, subSkill);
  // Not every sub-skill needs items in phase-1 registry — just check registry integrity
  for (const itemName of regItems.slice(0, 2)) {
    const spec = getCraftSpecByName(itemName, craftableItemsData);
    assert(`${itemName} (${subSkill}) has craftable spec`, spec?.craftable === true);
    assert(`${itemName} sub-skill matches filter`, spec?.subSkill === subSkill);
  }
}

// ──────────────────────────────────────────────────────────────────
console.log(`\n✓ Passed: ${pass}, ✗ Failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
