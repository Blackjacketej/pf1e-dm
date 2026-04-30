/**
 * npcKnowledgeCheck — pure helper tests.
 *
 * Run: npx vite-node npcKnowledgeCheck.test.mjs
 */
import {
  knowledgeCheckRevealNPC,
  normalizeKnowledgeSkill,
} from './src/services/npcKnowledgeCheck.js';

let passed = 0;
let failed = 0;
const fails = [];
function assert(cond, label) {
  if (cond) { passed++; return; }
  failed++;
  fails.push(label);
  console.error('  ✗', label);
}
function section(name, fn) {
  console.log(`\n── ${name} ──`);
  fn();
}

section('normalizeKnowledgeSkill — input forms', () => {
  assert(normalizeKnowledgeSkill('Knowledge (Local)') === 'local', 'parenthesized form');
  assert(normalizeKnowledgeSkill('knowledge local') === 'local', 'space separator');
  assert(normalizeKnowledgeSkill('Local') === 'local', 'bare subskill');
  assert(normalizeKnowledgeSkill('local') === 'local', 'lowercase bare');
  assert(normalizeKnowledgeSkill('Know. Nature') === 'nature', 'abbreviated "Know."');
  assert(normalizeKnowledgeSkill('Knowledge(Planes)') === 'planes', 'no space before paren');
  assert(normalizeKnowledgeSkill('knowledge: arcana') === 'arcana', 'colon separator');
  assert(normalizeKnowledgeSkill('') === '', 'empty → empty');
  assert(normalizeKnowledgeSkill(null) === '', 'null → empty');
  assert(normalizeKnowledgeSkill('Bluff') === '', 'non-knowledge skill → empty');
  assert(normalizeKnowledgeSkill('Knowledge (Basketweaving)') === '', 'unknown subskill → empty');
});

section('knowledgeCheckRevealNPC — invalid input', () => {
  assert(knowledgeCheckRevealNPC(null, 15, 'local') === null, 'null npc → null');
  assert(knowledgeCheckRevealNPC({ type: 'humanoid' }, NaN, 'local') === null, 'NaN roll → null');
  assert(knowledgeCheckRevealNPC({ type: 'humanoid' }, 15, null) != null,
    'null skill → result with applicable=false, not null');
});

section('knowledgeCheckRevealNPC — wrong skill surfaces DC + expected', () => {
  const npc = { creatureType: 'humanoid', cr: 3 };
  const res = knowledgeCheckRevealNPC(npc, 25, 'Knowledge (Planes)');
  assert(res.applicable === false, 'wrong skill → not applicable');
  assert(res.dc === 13, 'DC still computed (10 + CR 3)');
  assert(res.expectedSkill === 'Knowledge (Local)', 'expected skill named for humanoid');
  assert(res.patch === null, 'no patch when inapplicable');
});

section('knowledgeCheckRevealNPC — failed roll', () => {
  const npc = { creatureType: 'humanoid', cr: 5 };
  const res = knowledgeCheckRevealNPC(npc, 10, 'local');
  assert(res.applicable === true, 'right skill applicable');
  assert(res.dc === 15, 'DC = 10 + CR 5');
  assert(res.margin === -5, 'margin negative');
  assert(res.patch === null, 'failed roll → no patch');
  assert(res.toLevel === null && res.unlock === null, 'no reveal for failed roll');
});

section('knowledgeCheckRevealNPC — staircase progression', () => {
  const npc = { creatureType: 'humanoid', cr: 2 }; // DC = 12

  // Barely beat DC (margin 0) → level 1 only
  const r0 = knowledgeCheckRevealNPC(npc, 12, 'local');
  assert(r0.toLevel === 1, 'margin 0 → level 1');
  assert(r0.unlock === null, 'margin 0 → no unlocks yet');
  assert(r0.patch.toLevel === 1 && !r0.patch.unlock, 'patch shape at margin 0');
  assert(r0.facts === 1, 'facts = 1 at margin 0');

  // Margin 5 → add combatStats
  const r5 = knowledgeCheckRevealNPC(npc, 17, 'local');
  assert(r5.unlock.includes('combatStats'), 'margin 5 unlocks combatStats');
  assert(!r5.unlock.includes('stats'), 'margin 5 does not unlock stats yet');
  assert(r5.toLevel === 1, 'level stays at 1 until margin 15');
  assert(r5.facts === 2, 'facts = 2 at margin 5');

  // Margin 10 → add stats
  const r10 = knowledgeCheckRevealNPC(npc, 22, 'local');
  assert(r10.unlock.includes('combatStats') && r10.unlock.includes('stats'),
    'margin 10 unlocks both combat and stats');
  assert(r10.toLevel === 1, 'level still 1 at margin 10');
  assert(r10.facts === 3, 'facts = 3 at margin 10');

  // Margin 15 → bump level to 3
  const r15 = knowledgeCheckRevealNPC(npc, 27, 'local');
  assert(r15.toLevel === 3, 'margin 15 → level 3');
  assert(r15.unlock.includes('stats'), 'margin 15 retains stats unlock');

  // Margin 20 → secret factions + trueAlignment
  const r20 = knowledgeCheckRevealNPC(npc, 32, 'local');
  assert(r20.unlock.includes('secretFactions'), 'margin 20 unlocks secretFactions');
  assert(r20.unlock.includes('trueAlignment'), 'margin 20 unlocks trueAlignment');
  assert(r20.toLevel === 3, 'level 3 retained');
});

section('knowledgeCheckRevealNPC — creature-type → skill mapping', () => {
  // Undead → Religion
  const undead = knowledgeCheckRevealNPC({ type: 'undead', cr: 4 }, 20, 'religion');
  assert(undead.applicable === true, 'undead + religion is applicable');

  // Undead + Local → wrong
  const undeadWrong = knowledgeCheckRevealNPC({ type: 'undead', cr: 4 }, 20, 'local');
  assert(undeadWrong.applicable === false, 'undead + local is not applicable');

  // Dragon → Arcana
  const dragon = knowledgeCheckRevealNPC({ type: 'dragon', cr: 10 }, 25, 'Knowledge (Arcana)');
  assert(dragon.applicable === true, 'dragon + arcana applicable');
  assert(dragon.dc === 20, 'dragon DC = 10 + CR 10');

  // Outsider → Planes
  const outsider = knowledgeCheckRevealNPC({ type: 'outsider', cr: 8 }, 22, 'planes');
  assert(outsider.applicable === true, 'outsider + planes applicable');
});

section('knowledgeCheckRevealNPC — HD/level fallbacks', () => {
  // No CR but hitDice → should use hitDice
  const byHd = knowledgeCheckRevealNPC(
    { type: 'humanoid', hitDice: 7 }, 18, 'local'
  );
  assert(byHd.dc === 17, 'DC = 10 + HD 7');

  // No CR or hitDice but level → use level
  const byLevel = knowledgeCheckRevealNPC(
    { type: 'humanoid', level: 4 }, 15, 'local'
  );
  assert(byLevel.dc === 14, 'DC = 10 + level 4');

  // Nothing at all → defaults to CR 1
  const bare = knowledgeCheckRevealNPC(
    { type: 'humanoid' }, 12, 'local'
  );
  assert(bare.dc === 11, 'defaults to 10 + 1');
});

section('knowledgeCheckRevealNPC — patch compatibility with computeKnowledgeAdvance', () => {
  // Patch shape should look like { toLevel?, unlock? } which is what
  // computeKnowledgeAdvance(npc, { toLevel, unlock }) expects.
  const npc = { type: 'humanoid', cr: 3 }; // DC 13
  const r = knowledgeCheckRevealNPC(npc, 28, 'local'); // margin 15 → level 3
  assert(r.patch && typeof r.patch.toLevel === 'number', 'patch.toLevel is numeric when present');
  assert(Array.isArray(r.patch.unlock), 'patch.unlock is an array when present');

  // Verify the contract shape matches what computeKnowledgeAdvance destructures
  const { toLevel, unlock } = r.patch;
  assert(toLevel === 3 && unlock.includes('combatStats') && unlock.includes('stats'),
    'patch destructures cleanly');
});

console.log(`\n──── Results: ${passed} passed, ${failed} failed ────`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
