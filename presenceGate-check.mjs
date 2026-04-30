// Bug #57 smoke test: presence gate for NPC extractor.
// Verifies that title+name / meeting-verb / role-apposition matches INSIDE
// quoted dialogue are suppressed, while the same patterns in narration
// proper still fire.
//
// Live operator case (Sandpoint Market Square): Dass Korvaski is the present
// NPC. He speaks a line that references Father Tobyn (deceased), Father
// Zantus (alive, elsewhere), and Mayor Deverin (alive, elsewhere). None of
// them should land in Nearby NPCs from that speech alone.
//
// Run with: node presenceGate-check.mjs

import { extractNPCsFromNarration, _internal } from './src/services/npcExtraction.js';

let pass = 0;
let fail = 0;

function assertEq(actual, expected, label) {
  if (actual === expected) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, label) { assertEq(!!cond, true, label); }
function assertFalse(cond, label) { assertEq(!!cond, false, label); }

// ---- isInsideQuotedDialogue unit checks ----
const { isInsideQuotedDialogue } = _internal;

{
  const t = 'He said, "Hello, Bertha." Then left.';
  const insideIdx = t.indexOf('Bertha');
  assertTrue(isInsideQuotedDialogue(t, insideIdx), 'ascii: match inside "…"');
}
{
  const t = 'Sheriff Hemlock walked in, grim-faced.';
  const narrIdx = t.indexOf('Hemlock');
  assertFalse(isInsideQuotedDialogue(t, narrIdx), 'ascii: match in narration proper');
}
{
  const t = 'She muttered, \u201CFather Zantus is a good man,\u201D then walked away.';
  const idx = t.indexOf('Zantus');
  assertTrue(isInsideQuotedDialogue(t, idx), 'smart-quote: match inside \u201C…\u201D');
}
{
  const t = 'Before anything happened, Father Zantus entered.';
  const idx = t.indexOf('Zantus');
  assertFalse(isInsideQuotedDialogue(t, idx), 'smart-quote: no quotes at all → narration');
}
{
  const t = '"She knew Mayor Deverin." Later, another voice spoke: "Father Zantus will help."';
  const deverinIdx = t.indexOf('Deverin');
  const zantusIdx = t.indexOf('Zantus');
  assertTrue(isInsideQuotedDialogue(t, deverinIdx), 'two-pair ascii: 1st quote');
  assertTrue(isInsideQuotedDialogue(t, zantusIdx), 'two-pair ascii: 2nd quote');
}

// ---- full extractor regression: the live Market Square case ----

// Simulates Dass Korvaski speaking a single paragraph that references three
// other named NPCs. All three are medium-confidence TITLE+name hits inside
// his quoted dialogue. With the #57 gate, none should surface as extractions.
const dassParagraph = [
  'The fisherman, a weathered human, nods slowly.',
  '"Fire took Father Tobyn, took his ward, the poor girl. Dark years, those were.',
  'But Father Zantus is a good man, and Mayor Deverin saw it built proper again."',
  'He turns back to mending his nets.',
].join(' ');

{
  const out = extractNPCsFromNarration(dassParagraph, {
    partyNames: ['Ironforge'],
    knownNpcNames: ['Dass Korvaski'],
    alreadyExtracted: [],
  });
  const names = out.map((r) => r.name.toLowerCase());
  assertFalse(names.some((n) => n.includes('tobyn')), 'Market Square: Tobyn NOT extracted from dialogue');
  assertFalse(names.some((n) => n.includes('zantus')), 'Market Square: Zantus NOT extracted from dialogue');
  assertFalse(names.some((n) => n.includes('deverin')), 'Market Square: Deverin NOT extracted from dialogue');
  assertEq(out.length, 0, 'Market Square: no extractions from referential speech');
}

// ---- narration proper still fires ----

{
  // Title+name in narration (outside quotes) must still land. This is the
  // legitimate "Sheriff Hemlock walks in" case that the gate must NOT break.
  const narration = 'A heavy door swings open. Sheriff Hemlock strides in, sword at his hip, and surveys the room.';
  const out = extractNPCsFromNarration(narration, { partyNames: [], knownNpcNames: [], alreadyExtracted: [] });
  const names = out.map((r) => r.name.toLowerCase());
  assertTrue(names.includes('hemlock'), 'narration-proper: Sheriff Hemlock still extracted');
}

{
  // High-confidence self-intro inside dialogue must still land — that's the
  // bug #30 Bertha Cray case and must not regress.
  const narration = 'The blacksmith wipes her hands. "I\'m Bertha," she says. "Bertha Cray."';
  const out = extractNPCsFromNarration(narration, { partyNames: [], knownNpcNames: [], alreadyExtracted: [] });
  const names = out.map((r) => r.name.toLowerCase());
  assertTrue(names.some((n) => n.startsWith('bertha')), 'dialogue self-intro: Bertha still extracted');
}

{
  // Narrator "His name is X" should still land (the pattern-4 Cordell case
  // from #55's live session).
  const narration = 'The fisherman raises a hand. His name is Cordell, he tells you, a herring fisherman of twenty years.';
  const out = extractNPCsFromNarration(narration, { partyNames: [], knownNpcNames: [], alreadyExtracted: [] });
  const names = out.map((r) => r.name.toLowerCase());
  assertTrue(names.includes('cordell'), 'narrator intro: Cordell still extracted');
}

// ---- meeting-verb + name inside dialogue must be suppressed ----
{
  const t = 'The old woman laughs. "Yesterday we met Grazuul at the market. Strange one, that orc."';
  const out = extractNPCsFromNarration(t, { partyNames: [], knownNpcNames: [], alreadyExtracted: [] });
  const names = out.map((r) => r.name.toLowerCase());
  assertFalse(names.includes('grazuul'), 'meeting-verb in dialogue: Grazuul NOT extracted');
}

// ---- meeting-verb + name in narration still fires ----
{
  const t = 'The party turns a corner and meets Grazuul, a half-orc mercenary, waiting by the well.';
  const out = extractNPCsFromNarration(t, { partyNames: [], knownNpcNames: [], alreadyExtracted: [] });
  const names = out.map((r) => r.name.toLowerCase());
  assertTrue(names.includes('grazuul'), 'meeting-verb in narration: Grazuul IS extracted');
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
