// allyTargeting.test.mjs — Phase B (Ally-NPC) regression coverage.
//
// Inline-mirror of the production behavior per feedback_sandbox_mount_lag.md:
// the OneDrive mount's bindfs cache can serve truncated files in the Linux
// sandbox, so tests that import from src/ will fail intermittently. We copy
// the minimum logic under test (the pool-union line from creatureAI.js and
// the hpChanges routing from CombatTab.jsx) into this file and run it
// natively from outputs/.
//
// Coverage:
//   - pool union: empty/absent/dead allies → pre-Phase-B behavior
//   - pool union: enemy-only-vs-allies picks an ally
//   - pool union: mixed pool includes both sides
//   - damage routing: PC id routes to party-HP path
//   - damage routing: ally id routes to combat.allies mutation
//   - damage routing: negative damage (healing) both sides
//   - damage routing: unknown id is dropped silently
//
// Run with:  node allyTargeting.test.mjs

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  PASS', label); }
  else { fail++; console.log('  FAIL', label, '\n    actual  :', actual, '\n    expected:', expected); }
}
function truthy(v, label) {
  if (v) { pass++; console.log('  PASS', label); }
  else { fail++; console.log('  FAIL', label); }
}
function section(name) { console.log('\n── ' + name + ' ──'); }

// ── Inline-mirror: creatureAI.js target pool union ─────────────────────────
// Mirrors creatureAI.js:748 after Phase B. Keep this in lock-step with the
// production block — if that line changes, this mirror must change too.
function buildAliveTargets(party, combatState) {
  const alliesPool = Array.isArray(combatState?.allies) ? combatState.allies : [];
  return [...party, ...alliesPool].filter(t => t.currentHP > 0);
}

// ── Inline-mirror: CombatTab.jsx hpChanges routing ─────────────────────────
// Simulates the setCombat / updateCharHP dispatch so we can assert on the
// routing decision without a React tree. Returns the resulting
// party/allies/enemies plus a list of DR + damage log events.
//
// Phase C.1 extended the router to also handle enemy targets — when an
// ally acts, hpChanges keys point at enemies, and the same routing
// function needs to find them. `enemies` defaults to [] so pre-Phase-C
// tests (which only passed party + allies) keep working.
function applyHpChanges(party, allies, hpChanges, enemies = []) {
  const logs = [];
  let nextParty = party.map(p => ({ ...p }));
  let nextAllies = allies.map(a => ({ ...a }));
  let nextEnemies = enemies.map(e => ({ ...e }));
  for (const [targetId, damage] of Object.entries(hpChanges)) {
    const targetPC = nextParty.find(p => p.id === targetId);
    const targetAlly = !targetPC ? nextAllies.find(a => a.id === targetId) : null;
    const targetEnemy = (!targetPC && !targetAlly) ? nextEnemies.find(e => e.id === targetId) : null;

    if (damage < 0) {
      const heal = -damage;
      if (targetPC) {
        const con = targetPC.con ?? 10;
        const max = targetPC.maxHP;
        targetPC.currentHP = Math.max(-con, Math.min(max, targetPC.currentHP + heal));
      } else if (targetAlly) {
        const max = targetAlly.maxHP ?? targetAlly.hp ?? targetAlly.currentHP + heal;
        targetAlly.currentHP = Math.min(max, targetAlly.currentHP + heal);
      } else if (targetEnemy) {
        const max = targetEnemy.maxHP ?? targetEnemy.hp ?? targetEnemy.currentHP + heal;
        targetEnemy.currentHP = Math.min(max, targetEnemy.currentHP + heal);
      }
      continue;
    }

    if (targetPC) {
      let finalDmg = damage;
      if (targetPC.dr && targetPC.dr.amount > 0) {
        const drReduced = Math.min(targetPC.dr.amount, finalDmg);
        finalDmg = Math.max(0, finalDmg - drReduced);
        if (drReduced > 0) logs.push(`DR ${targetPC.dr.amount}/${targetPC.dr.type}: ${targetPC.name} absorbs ${drReduced} damage`);
      }
      if (finalDmg > 0) {
        targetPC.currentHP = Math.max(-(targetPC.con ?? 10), targetPC.currentHP - finalDmg);
      }
    } else if (targetAlly) {
      targetAlly.currentHP = Math.max(0, targetAlly.currentHP - damage);
      logs.push(`${targetAlly.name} takes ${damage} damage.`);
    } else if (targetEnemy) {
      targetEnemy.currentHP = Math.max(0, targetEnemy.currentHP - damage);
      logs.push(`${targetEnemy.name} takes ${damage} damage.`);
    }
  }
  return { party: nextParty, allies: nextAllies, enemies: nextEnemies, logs };
}

// ── Inline-mirror: handleAllyTurn's inverted target pool (Phase C.1) ───────
// When an ally acts via controlMode='ai', CombatTab calls
// executeEnemyTurn(activeAlly, aliveEnemies, aliveAllies, {round, directives})
// — note combatState.allies is absent. This mirror validates only the
// pool assembly, not the full executeEnemyTurn (which is exercised by
// its own unit tests). The assertion: when acting ally runs the
// pool-union line in creatureAI:757 it sees enemies, not teammates.
function buildAllyTargets(enemies, combatState) {
  const extraPool = Array.isArray(combatState?.allies) ? combatState.allies : [];
  return [...enemies, ...extraPool].filter(t => t.currentHP > 0);
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const party = [
  { id: 'pc1', name: 'Rogue',   currentHP: 20, maxHP: 24, ac: 16, class: 'rogue',   con: 12 },
  { id: 'pc2', name: 'Wizard',  currentHP: 12, maxHP: 14, ac: 12, class: 'wizard',  con: 10 },
];
const allyLive = { id: 'ally1', name: 'Bear',   currentHP: 30, maxHP: 40, ac: 14, class: '' };
const allyDown = { id: 'ally2', name: 'Raven',  currentHP:  0, maxHP:  8, ac: 13, class: '' };

// ── Tests ──────────────────────────────────────────────────────────────────
section('pool union');

eq(
  buildAliveTargets(party, {}).map(t => t.id),
  ['pc1', 'pc2'],
  'no combatState → party only (pre-Phase-B regression)'
);
eq(
  buildAliveTargets(party, { allies: [] }).map(t => t.id),
  ['pc1', 'pc2'],
  'empty allies → party only'
);
eq(
  buildAliveTargets(party, { allies: [allyLive] }).map(t => t.id),
  ['pc1', 'pc2', 'ally1'],
  'mixed pool picks both sides'
);
eq(
  buildAliveTargets([], { allies: [allyLive] }).map(t => t.id),
  ['ally1'],
  'ally-only (party wiped / summoned stand-in) still produces a pool'
);
eq(
  buildAliveTargets(party, { allies: [allyLive, allyDown] }).map(t => t.id),
  ['pc1', 'pc2', 'ally1'],
  'dead allies filtered out'
);
eq(
  buildAliveTargets(
    [{ ...party[0], currentHP: 0 }, party[1]],
    { allies: [allyLive] }
  ).map(t => t.id),
  ['pc2', 'ally1'],
  'dead PCs filtered out of mixed pool'
);
eq(
  buildAliveTargets(party, { allies: 'not-an-array' }).map(t => t.id),
  ['pc1', 'pc2'],
  'non-array allies defensively ignored'
);

section('damage routing');

{
  const out = applyHpChanges(party, [allyLive], { pc1: 5 });
  eq(out.party.find(p => p.id === 'pc1').currentHP, 15, 'PC id → party HP drops');
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 30, 'PC damage leaves ally untouched');
}
{
  const out = applyHpChanges(party, [allyLive], { ally1: 8 });
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 22, 'ally id → combat.allies HP drops');
  eq(out.party.find(p => p.id === 'pc1').currentHP, 20, 'ally damage leaves party untouched');
  truthy(out.logs.some(l => l.includes('Bear takes 8 damage')), 'ally damage log emitted');
}
{
  const out = applyHpChanges(party, [allyLive], { ally1: 50 });
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 0, 'ally HP floors at 0 (no bleeding-out)');
}
{
  const drParty = [{ ...party[0], dr: { amount: 3, type: '—' } }, party[1]];
  const out = applyHpChanges(drParty, [allyLive], { pc1: 5 });
  eq(out.party.find(p => p.id === 'pc1').currentHP, 18, 'PC DR still applies (3 absorbed, 2 through)');
  truthy(out.logs.some(l => l.includes('absorbs 3 damage')), 'DR log emitted');
}
{
  const drParty = [{ ...party[0], dr: { amount: 3, type: '—' } }, party[1]];
  const out = applyHpChanges(drParty, [allyLive], { ally1: 5 });
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 25, 'ally damage bypasses PC DR (DR is a class feature)');
  truthy(!out.logs.some(l => l.includes('absorbs')), 'no DR log for ally damage');
}

section('healing');

{
  const wounded = [{ ...party[0], currentHP: 5 }, party[1]];
  const out = applyHpChanges(wounded, [allyLive], { pc1: -10 });
  eq(out.party.find(p => p.id === 'pc1').currentHP, 15, 'PC heal caps at maxHP');
}
{
  const woundedAlly = { ...allyLive, currentHP: 10 };
  const out = applyHpChanges(party, [woundedAlly], { ally1: -8 });
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 18, 'ally heal adds HP');
}
{
  const overhealAlly = { ...allyLive, currentHP: 38 };
  const out = applyHpChanges(party, [overhealAlly], { ally1: -20 });
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 40, 'ally heal caps at maxHP');
}
{
  const nocapAlly = { id: 'ally9', name: 'Summon', currentHP: 5 };
  const out = applyHpChanges(party, [nocapAlly], { ally9: -3 });
  eq(out.allies.find(a => a.id === 'ally9').currentHP, 8, 'ally heal without maxHP still adds HP');
}

section('edge cases');

{
  const out = applyHpChanges(party, [allyLive], { unknown: 99 });
  eq(out.party.find(p => p.id === 'pc1').currentHP, 20, 'unknown target id drops damage silently (party unchanged)');
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 30, 'unknown target id drops damage silently (allies unchanged)');
}
{
  // PC id takes priority if it somehow collides with ally id. Production
  // should never emit duplicate ids, but the routing should be deterministic.
  const collided = [{ ...party[0], id: 'shared' }, party[1]];
  const collidedAlly = { ...allyLive, id: 'shared' };
  const out = applyHpChanges(collided, [collidedAlly], { shared: 4 });
  eq(out.party.find(p => p.id === 'shared').currentHP, 16, 'id collision: PC wins (deterministic fallthrough)');
  eq(out.allies.find(a => a.id === 'shared').currentHP, 30, 'id collision: ally untouched');
}

// ── Phase C.1 tests ────────────────────────────────────────────────────────

// Fixture: enemies for the acting-ally path.
const enemy1 = { id: 'en1', name: 'Goblin', currentHP: 7,  hp: 7,  maxHP: 7,  ac: 13, class: '' };
const enemy2 = { id: 'en2', name: 'Ogre',   currentHP: 30, hp: 35, maxHP: 35, ac: 14, class: '' };

section('Phase C.1 — inverted target pool (ally acts)');

eq(
  buildAllyTargets([enemy1, enemy2], { round: 1 }).map(t => t.id),
  ['en1', 'en2'],
  'ally sees only enemies when no combatState.allies key'
);
eq(
  buildAllyTargets([enemy1, enemy2], { round: 1, allies: [] }).map(t => t.id),
  ['en1', 'en2'],
  'ally sees only enemies when combatState.allies is explicitly empty'
);
eq(
  // Phase C.1 intentionally OMITS combatState.allies when calling
  // executeEnemyTurn from handleAllyTurn — this test pins that intent.
  // If someone later adds allies to combatState here, the ally would
  // see teammates as valid targets (friendly fire bug).
  buildAllyTargets([enemy1], { round: 1, allies: [{ id: 'teammate', currentHP: 10 }] }).map(t => t.id),
  ['en1', 'teammate'],
  'sanity: if caller accidentally passes combatState.allies, teammates ARE included (so omit them)'
);
eq(
  buildAllyTargets([{ ...enemy1, currentHP: 0 }, enemy2], { round: 1 }).map(t => t.id),
  ['en2'],
  'dead enemies filtered from ally target pool'
);
eq(
  buildAllyTargets([], { round: 1 }).map(t => t.id),
  [],
  'no enemies → empty pool (handleAllyTurn should short-circuit to pass)'
);

section('Phase C.1 — damage routing to enemies');

{
  // Ally attacks enemy — hpChanges keyed to enemy id routes correctly.
  const out = applyHpChanges(party, [allyLive], { en1: 5 }, [enemy1, enemy2]);
  eq(out.enemies.find(e => e.id === 'en1').currentHP, 2, 'ally damage → enemy HP drops');
  eq(out.enemies.find(e => e.id === 'en2').currentHP, 30, 'other enemy untouched');
  eq(out.party.find(p => p.id === 'pc1').currentHP, 20, 'party untouched by ally→enemy damage');
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 30, 'ally untouched by own damage output');
  truthy(out.logs.some(l => l.includes('Goblin takes 5 damage')), 'enemy damage log emitted');
}
{
  // Overkill floors at 0 (same semantics as ally-takes-damage in Phase B).
  const out = applyHpChanges(party, [], { en1: 999 }, [enemy1]);
  eq(out.enemies.find(e => e.id === 'en1').currentHP, 0, 'enemy HP floors at 0 on overkill');
}
{
  // Multi-target: ally's AoE emits hpChanges with multiple enemy keys.
  const out = applyHpChanges(party, [], { en1: 3, en2: 3 }, [enemy1, enemy2]);
  eq(out.enemies.find(e => e.id === 'en1').currentHP, 4, 'AoE hits en1');
  eq(out.enemies.find(e => e.id === 'en2').currentHP, 27, 'AoE hits en2');
}
{
  // No DR for enemies in this phase — DR is a PF1e class feature tracked
  // on PCs only. Enemies carrying DR on their stat block is tracked by a
  // different path inside resolveAttack (not the hpChanges router). This
  // assertion pins current behavior: the router does NOT apply class DR
  // to an enemy target even if one happens to be PC-shaped.
  const drEnemy = { id: 'enDr', name: 'Paladin', currentHP: 20, hp: 20, class: 'paladin', dr: { amount: 5, type: '—' } };
  const out = applyHpChanges(party, [], { enDr: 8 }, [drEnemy]);
  eq(out.enemies.find(e => e.id === 'enDr').currentHP, 12, 'enemy DR is NOT applied by router (class-DR is PC-only)');
  truthy(!out.logs.some(l => l.includes('absorbs')), 'no DR log for enemy damage');
}

section('Phase C.1 — healing enemies (symmetric)');

{
  // Enemy self-heal (e.g. Ogre's regen, or a cleric enemy healing
  // a minion) — damage<0 should route through the enemy heal branch.
  const woundedEnemy = { ...enemy2, currentHP: 10 };
  const out = applyHpChanges(party, [], { en2: -12 }, [woundedEnemy]);
  eq(out.enemies.find(e => e.id === 'en2').currentHP, 22, 'enemy heal adds HP');
}
{
  // Enemy heal caps at maxHP.
  const out = applyHpChanges(party, [], { en2: -999 }, [{ ...enemy2, currentHP: 20 }]);
  eq(out.enemies.find(e => e.id === 'en2').currentHP, 35, 'enemy heal caps at maxHP (35)');
}
{
  // Enemy with `hp` but no `maxHP` — common pre-Phase-C shape from
  // monsterTactics. Heal cap should fall back to `hp`.
  const hpOnlyEnemy = { id: 'enH', name: 'Kobold', currentHP: 2, hp: 6 };
  const out = applyHpChanges(party, [], { enH: -10 }, [hpOnlyEnemy]);
  eq(out.enemies.find(e => e.id === 'enH').currentHP, 6, 'enemy heal caps at `hp` when no maxHP field');
}
{
  // No-maxHP, no-hp enemy (shouldn't happen in production but defensive).
  const baseEnemy = { id: 'enB', name: 'Shade', currentHP: 5 };
  const out = applyHpChanges(party, [], { enB: -3 }, [baseEnemy]);
  eq(out.enemies.find(e => e.id === 'enB').currentHP, 8, 'enemy heal without hp/maxHP still adds');
}

section('Phase C.1 — ally heal cap uses hp when maxHP missing');

{
  // injectTestAlly writes `hp` (not maxHP) as max. The Phase B router
  // had `a.maxHP ?? a.currentHP + heal` which under-capped. Phase C.1
  // added `?? a.hp` to the chain so the intended max is respected.
  const hpOnlyAlly = { id: 'allyH', name: 'SummonedWolf', currentHP: 8, hp: 13 };
  const out = applyHpChanges(party, [hpOnlyAlly], { allyH: -20 });
  eq(out.allies.find(a => a.id === 'allyH').currentHP, 13, 'ally heal caps at `hp` when no maxHP field');
}

section('Phase C.1 — cross-collection routing (ally heals PC / buffs ally)');

{
  // Future-proofing: if an ally's action emits a heal keyed to a PC id
  // (ally-cleric casting Cure Light Wounds on a party member), it
  // should route through the PC heal path, not drop silently.
  const woundedParty = [{ ...party[0], currentHP: 4 }, party[1]];
  const out = applyHpChanges(woundedParty, [allyLive], { pc1: -10 }, [enemy1]);
  eq(out.party.find(p => p.id === 'pc1').currentHP, 14, 'ally-heal-PC routes through PC heal branch');
  eq(out.allies.find(a => a.id === 'ally1').currentHP, 30, 'healer-ally untouched');
  eq(out.enemies.find(e => e.id === 'en1').currentHP, 7, 'enemies untouched by heal');
}
{
  // Ally buffs another ally — Bless-style single-target heal.
  const woundedAlly2 = { id: 'ally2h', name: 'BearCub', currentHP: 5, hp: 12 };
  const out = applyHpChanges(party, [allyLive, woundedAlly2], { ally2h: -4 }, [enemy1]);
  eq(out.allies.find(a => a.id === 'ally2h').currentHP, 9, 'ally-heal-ally routes through ally heal branch');
}

section('Phase C.1 — id collision priority (PC > ally > enemy)');

{
  // If the same id exists across all three collections, PC wins first,
  // then ally, then enemy. Production guarantees unique ids, but the
  // router must be deterministic if they ever collide.
  const sharedPC = [{ ...party[0], id: 'shared' }, party[1]];
  const sharedAlly = [{ ...allyLive, id: 'shared' }];
  const sharedEnemy = [{ ...enemy1, id: 'shared' }];
  const out = applyHpChanges(sharedPC, sharedAlly, { shared: 4 }, sharedEnemy);
  eq(out.party.find(p => p.id === 'shared').currentHP, 16, 'collision: PC wins over ally and enemy');
  eq(out.allies.find(a => a.id === 'shared').currentHP, 30, 'collision: ally untouched');
  eq(out.enemies.find(e => e.id === 'shared').currentHP, 7, 'collision: enemy untouched');
}
{
  // Ally vs enemy collision (no matching PC) — ally wins.
  const sharedAlly = [{ ...allyLive, id: 'shared' }];
  const sharedEnemy = [{ ...enemy1, id: 'shared' }];
  const out = applyHpChanges(party, sharedAlly, { shared: 6 }, sharedEnemy);
  eq(out.allies.find(a => a.id === 'shared').currentHP, 24, 'ally-vs-enemy collision: ally wins');
  eq(out.enemies.find(e => e.id === 'shared').currentHP, 7, 'ally-vs-enemy collision: enemy untouched');
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
