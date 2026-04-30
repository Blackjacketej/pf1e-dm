/**
 * computeKnowledgeAdvance — pure helper tests.
 *
 * Run: npx vite-node npcKnowledgeAdvance.test.mjs
 *
 * These cover the progression-trigger semantics: name-reveal, interaction
 * milestones, combat-start/defeat unlocks, and the never-regress rule.
 */
import { computeKnowledgeAdvance } from './src/services/npcTracker.js';

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

section('no-op cases', () => {
  assert(computeKnowledgeAdvance(null, { toLevel: 2 }) === null, 'null npc → null');
  assert(computeKnowledgeAdvance({ knownToParty: true }, {}) === null, 'no request → null');
  assert(
    computeKnowledgeAdvance({ knownToParty: true, interactions: 3 }, { toLevel: 3 }) === null,
    'derived already at target → null',
  );
});

section('toLevel — union upward only', () => {
  // Stranger (level 0) → reveal name (level 1)
  const p1 = computeKnowledgeAdvance({ knownToParty: false }, { toLevel: 1 });
  assert(p1 && p1.knowledgeLevel === 1, 'stranger → level 1 via name reveal');

  // First re-encounter (interactions=1 ⇒ derived 2) → bump to 2 if explicit below
  const p2 = computeKnowledgeAdvance(
    { knownToParty: true, interactions: 1, knowledgeLevel: 1 },
    { toLevel: 2 },
  );
  assert(p2 && p2.knowledgeLevel === 2, 'explicit 1 → bump to 2');

  // Bump to 3 on third interaction
  const p3 = computeKnowledgeAdvance(
    { knownToParty: true, interactions: 3, knowledgeLevel: 2 },
    { toLevel: 3 },
  );
  assert(p3 && p3.knowledgeLevel === 3, 'explicit 2 → bump to 3');

  // Never regress: asking for 1 when already at 4 is a no-op
  const noRegress = computeKnowledgeAdvance(
    { knownToParty: true, knowledgeLevel: 4 },
    { toLevel: 1 },
  );
  assert(noRegress === null, 'never regress from 4 → 1');

  // Clamps to 0..4
  const clamp = computeKnowledgeAdvance({ knownToParty: false }, { toLevel: 99 });
  assert(clamp && clamp.knowledgeLevel === 4, 'clamps above 4');
});

section('unlock — set-union, never removes', () => {
  const p = computeKnowledgeAdvance(
    { knownToParty: true, revealedFacts: [] },
    { unlock: 'combatStats' },
  );
  assert(p && p.revealedFacts.includes('combatStats'), 'combatStats unlocked');

  // Idempotent — re-unlocking already-present key is no-op
  const p2 = computeKnowledgeAdvance(
    { revealedFacts: ['combatStats'] },
    { unlock: 'combatStats' },
  );
  assert(p2 === null, 'idempotent unlock → null');

  // Multi-unlock as array; invalid keys filtered
  const p3 = computeKnowledgeAdvance(
    { revealedFacts: [] },
    { unlock: ['combatStats', 'stats', 'bogus'] },
  );
  assert(p3 && p3.revealedFacts.length === 2, 'array unlock filters invalid');
  assert(p3.revealedFacts.includes('stats') && p3.revealedFacts.includes('combatStats'), 'both valid kept');

  // Preserves existing revealedFacts (never removes)
  const p4 = computeKnowledgeAdvance(
    { revealedFacts: ['secretFactions'] },
    { unlock: 'combatStats' },
  );
  assert(p4 && p4.revealedFacts.includes('secretFactions'), 'preserves prior unlocks');
  assert(p4.revealedFacts.includes('combatStats'), 'adds new unlock');
});

section('combined toLevel + unlock', () => {
  const p = computeKnowledgeAdvance(
    { knownToParty: false, revealedFacts: [] },
    { toLevel: 3, unlock: 'combatStats' },
  );
  assert(p && p.knowledgeLevel === 3, 'level set');
  assert(p.revealedFacts.includes('combatStats'), 'unlock set');
});

console.log(`\n──── Results: ${passed} passed, ${failed} failed ────`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
