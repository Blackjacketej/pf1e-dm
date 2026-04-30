// combatInitiative.test.mjs
// Pure unit tests for the Phase A ally-combatant initiative scaffold.
// Run: npx vite-node combatInitiative.test.mjs

import {
  initiativeBonus,
  buildInitiativeOrder,
  classifyCombatant,
  isCombatantAlive,
} from './src/services/combatInitiative.js';

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// ──────────────────────────────────────────────────────────────────
section('initiativeBonus — side-specific math');

const pc = { id: 'pc1', name: 'Valeros', abilities: { DEX: 14 } };
const pcLowDex = { id: 'pc2', name: 'Kyra', abilities: { DEX: 8 } };
const pcNoDex = { id: 'pc3', name: 'Lem' };
const enemy = { id: 'e1', name: 'Goblin', init: 4 };
const ally = { id: 'a1', name: 'Wolf Companion', init: 2 };

assert('PC DEX 14 → +2', initiativeBonus(pc, 'party') === 2);
assert('PC DEX 8 → -1', initiativeBonus(pcLowDex, 'party') === -1);
assert('PC with no abilities.DEX → 0', initiativeBonus(pcNoDex, 'party') === 0);
assert('Enemy with init:4 → 4', initiativeBonus(enemy, 'enemy') === 4);
assert('Ally with init:2 → 2', initiativeBonus(ally, 'ally') === 2);
assert('null combatant → 0', initiativeBonus(null, 'party') === 0);

// ──────────────────────────────────────────────────────────────────
section('buildInitiativeOrder — deterministic sort');

// rollFn always returns 10 → ties broken by side (party > ally > enemy) then name
const fixed = () => 10;
const order1 = buildInitiativeOrder({
  party: [pc, pcLowDex],
  enemies: [enemy],
  allies: [ally],
  rollFn: fixed,
});

// pc: 10+2 = 12, pcLowDex: 10-1 = 9, enemy: 10+4 = 14, ally: 10+2 = 12
// Sort: enemy(14) > pc(12, party beats ally) > ally(12) > pcLowDex(9)
assert('enemy first with init 14', order1[0].id === 'e1' && order1[0].init === 14);
assert('PC second (party tiebreak over ally)', order1[1].id === 'pc1' && order1[1].init === 12);
assert('ally third (loses tiebreak to party)', order1[2].id === 'a1' && order1[2].init === 12);
assert('PC with DEX 8 last', order1[3].id === 'pc2' && order1[3].init === 9);

assert('side tagged: party', order1[1].side === 'party');
assert('side tagged: ally', order1[2].side === 'ally');
assert('side tagged: enemy', order1[0].side === 'enemy');

// Alphabetical tiebreak within same side + same init
const twoAllies = buildInitiativeOrder({
  party: [],
  enemies: [],
  allies: [{ id: 'z', name: 'Zebra', init: 0 }, { id: 'a', name: 'Aardvark', init: 0 }],
  rollFn: fixed,
});
assert('Aardvark before Zebra on name tiebreak', twoAllies[0].name === 'Aardvark');

// Empty inputs
const empty = buildInitiativeOrder({});
assert('no inputs → empty array', Array.isArray(empty) && empty.length === 0);

// Backward compat: party-only call (legacy) works
const legacy = buildInitiativeOrder({ party: [pc], enemies: [enemy], rollFn: fixed });
assert('omit allies → still works', legacy.length === 2);

// ──────────────────────────────────────────────────────────────────
section('classifyCombatant — side resolution');

const snapshot = {
  party: [pc],
  enemies: [enemy],
  allies: [ally],
};

assert('PC id → "party"', classifyCombatant('pc1', snapshot) === 'party');
assert('enemy id → "enemy"', classifyCombatant('e1', snapshot) === 'enemy');
assert('ally id → "ally"', classifyCombatant('a1', snapshot) === 'ally');
assert('unknown id → null', classifyCombatant('nobody', snapshot) === null);
assert('empty snapshot → null', classifyCombatant('x', {}) === null);

// ──────────────────────────────────────────────────────────────────
section('isCombatantAlive — side-specific rules');

const alive = {
  party: [{ id: 'p', name: 'Hero', currentHP: 10 }],
  allies: [{ id: 'a', name: 'Wolf', currentHP: 5 }],
  enemies: [{ id: 'e', name: 'Orc', currentHP: 8, fled: false, surrendered: false }],
};
assert('PC with HP > 0 → alive', isCombatantAlive('p', alive));
assert('ally with HP > 0 → alive', isCombatantAlive('a', alive));
assert('enemy with HP > 0, not fled → alive', isCombatantAlive('e', alive));

const dead = {
  party: [{ id: 'p', name: 'Hero', currentHP: 0 }],
  allies: [{ id: 'a', name: 'Wolf', currentHP: 0 }],
  enemies: [{ id: 'e', name: 'Orc', currentHP: 0 }],
};
assert('PC at 0 HP → not alive', !isCombatantAlive('p', dead));
assert('ally at 0 HP → not alive', !isCombatantAlive('a', dead));
assert('enemy at 0 HP → not alive', !isCombatantAlive('e', dead));

// Orc ferocity special case
const ferocity = {
  party: [{ id: 'p', name: 'HalfOrc', currentHP: 0, orcFerocityActive: true }],
};
assert('PC at 0 HP with orcFerocity → still alive', isCombatantAlive('p', ferocity));

// Fled / surrendered enemies treated as dead for turn-skip purposes
const fled = {
  enemies: [{ id: 'e', currentHP: 5, fled: true }],
};
assert('fled enemy → not alive for turn-skip', !isCombatantAlive('e', fled));

const surrendered = {
  enemies: [{ id: 'e', currentHP: 5, surrendered: true }],
};
assert('surrendered enemy → not alive', !isCombatantAlive('e', surrendered));

assert('unknown id → not alive', !isCombatantAlive('nobody', alive));

// ──────────────────────────────────────────────────────────────────
console.log(`\n──── Results: ${pass} passed, ${fail} failed ────`);
if (fail > 0) process.exit(1);
