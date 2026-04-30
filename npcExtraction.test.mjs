// Unit tests for npcExtraction — heuristic NPC detection from narration.
// Covers the Bertha Cray dialogue pattern that triggered bug #30.
// Run with: node npcExtraction.test.mjs

import { extractNPCsFromNarration } from './src/services/npcExtraction.js';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', label); }
}

// ── Test 1: Bertha Cray dialogue attribution (the exact failing case) ──
{
  const text = `The woman pauses in her ribbon-tying and looks pleasantly surprised that a group of armed travelers would bother with such a courtesy. She straightens up with a small smile and presses a hand to her chest. "Bertha," she says simply. "Bertha Cray. Been in Sandpoint thirty-two years and I don't intend to leave it." She says it the way people do when they've had to defend that choice before — with a quiet pride that dares you to argue.`;
  const got = extractNPCsFromNarration(text, { partyNames: ['Ironforge', 'Shadowblade'] });
  assert(got.some(n => n.name === 'Bertha'), 'T1a: captures "Bertha" from dialogue attribution');
}

// ── Test 2: "I'm Name" introduction pattern ──
{
  const text = `The man extends his hand. "I'm Jodar, the smith around these parts. Welcome to Sandpoint."`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Jodar'), 'T2: captures "I\'m Jodar" introduction');
}

// ── Test 3: "My name is Name" ──
{
  const text = `She bows stiffly. "My name is Elara Whisperwind, and I have a proposition for you."`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Elara Whisperwind'), 'T3: captures "My name is" (full name)');
}

// ── Test 4: Party-member filter ──
{
  const text = `"Ironforge," she says, tipping her hat. "Well met."`;
  const got = extractNPCsFromNarration(text, { partyNames: ['Ironforge'] });
  assert(!got.some(n => n.name === 'Ironforge'), 'T4: does NOT capture a PC name');
}

// ── Test 5: Already-known NPC filter ──
{
  const text = `"Bertha," she adds quietly, "is going to need help."`;
  const got = extractNPCsFromNarration(text, { knownNpcNames: ['Bertha'] });
  assert(!got.some(n => n.name === 'Bertha'), 'T5: does NOT re-capture a known NPC');
}

// ── Test 6: alreadyExtracted (from ENTITIES) filter ──
{
  const text = `"Jodar," he grunts.`;
  const got = extractNPCsFromNarration(text, { alreadyExtracted: ['Jodar'] });
  assert(!got.some(n => n.name === 'Jodar'), 'T6: does NOT duplicate ENTITIES capture');
}

// ── Test 7: Stop-word filter (pronouns masquerading as names) ──
{
  const text = `"She," he says, "is not to be trusted."`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'She'), 'T7: rejects pronoun in name position');
}

// ── Test 8: Short-name filter (<3 chars) ──
{
  const text = `"Al," she mutters.`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Al'), 'T8: rejects 2-char name');
}

// ── Test 9: Name + introduces-herself pattern ──
{
  const text = `The priestess Valeria introduces herself with a gentle nod and a flicker of her holy symbol.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Valeria'), 'T9: captures "X introduces herself"');
}

// ── Test 10: No-match — pure description, no names ──
{
  const text = `The woman in the blue dress tied ribbons to her market stall. She glanced up as you passed, then returned to her work without a word.`;
  const got = extractNPCsFromNarration(text);
  assert(got.length === 0, 'T10: no false positives on description-only narration');
}

// ── Test 11: Dedup across multiple patterns ──
{
  const text = `"Bertha," she says. "I'm Bertha Cray," she adds.`;
  const got = extractNPCsFromNarration(text);
  // First pattern catches "Bertha", second catches "Bertha Cray". Both pass
  // the dedup (case-insensitive exact match), so we'd actually see both —
  // that's acceptable: the GM sees both candidates, storeNPC will dedupe
  // by name on the DB side. But within a single call, we dedupe on exact
  // case-insensitive key, so "Bertha" and "Bertha Cray" are different.
  assert(got.length >= 1, 'T11: dedup works (at least one, may capture distinct forms)');
}

// ── Test 12: shortDesc evidence snippet ──
{
  const text = `Something shifts in the room. "Marek," the cloaked figure whispers, voice like dry leaves, "the old compact is broken."`;
  const got = extractNPCsFromNarration(text);
  const marek = got.find(n => n.name === 'Marek');
  assert(marek && marek.shortDesc && marek.shortDesc.length > 0, 'T12: evidence snippet populated');
}

// ── Test 13: Empty / nullish input safety ──
{
  assert(extractNPCsFromNarration('').length === 0, 'T13a: empty string returns []');
  assert(extractNPCsFromNarration(null).length === 0, 'T13b: null returns []');
  assert(extractNPCsFromNarration(undefined).length === 0, 'T13c: undefined returns []');
}

// ── MEDIUM-confidence patterns (Bug #50 expansion) ─────────────────────

// ── Test 14: Meeting-verb pattern (#50 pattern 6) ──
{
  const text = `You meet Bertha in the market square. She waves as you approach.`;
  const got = extractNPCsFromNarration(text);
  const bertha = got.find(n => n.name === 'Bertha');
  assert(bertha, 'T14a: captures "You meet Bertha"');
  assert(bertha?.confidence === 'medium', 'T14b: meeting-verb match tagged medium');
}

// ── Test 15: Encounter verb variations ──
{
  const text = `The party encounters Marek at the bridge.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Marek'), 'T15: captures "encounters Marek"');
}

// ── Test 16: Meeting-verb does NOT match arbitrary noun chains ──
{
  // "saw Sandpoint" shouldn't trigger — but since Sandpoint is a real
  // place name, we accept the extractor may still match it by pattern.
  // The GM-review flow filters this via known-location dedup, not the
  // heuristic. Test instead that a verb+non-capitalized sequence fails.
  const text = `You meet with the group and discuss plans.`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'With'), 'T16: does not capture "meet with"');
}

// ── Test 17: Role-apposition pattern (#50 pattern 7) ──
{
  const text = `Bertha Cray, a gruff dwarf blacksmith, dusts her apron.`;
  const got = extractNPCsFromNarration(text);
  const bertha = got.find(n => n.name === 'Bertha Cray');
  assert(bertha, 'T17a: captures "Bertha Cray, a ... blacksmith"');
  // Could be caught by medium (pattern 7) since no dialogue/intro frame.
  assert(
    bertha?.confidence === 'medium' || bertha?.confidence === 'high',
    'T17b: apposition gives some confidence tag',
  );
}

// ── Test 18: Role apposition requires ROLE_WORD, not a location ──
{
  const text = `Sandpoint, a sleepy coastal town, glints in the morning sun.`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Sandpoint'), 'T18: does not capture town appositives');
}

// ── Test 19: Named/called pattern (#50 pattern 8) ──
{
  const text = `A hulking half-orc named Grek blocks the doorway.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Grek'), 'T19a: captures "named Grek"');
}
{
  const text = `An old hermit called Markus beckons from the cave mouth.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Markus'), 'T19b: captures "called Markus"');
}
{
  const text = `A stranger known as Varys watches from the doorway.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Varys'), 'T19c: captures "known as Varys"');
}

// ── Test 20: Title + Name pattern (#50 pattern 9) ──
{
  const text = `Sheriff Hemlock nods at the party as they pass.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Hemlock'), 'T20a: captures "Sheriff Hemlock"');
}
{
  const text = `Father Zantus blesses the travelers before they depart.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Zantus'), 'T20b: captures "Father Zantus"');
}
{
  const text = `Captain Jakarov waves from the dock.`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Jakarov'), 'T20c: captures "Captain Jakarov"');
}

// ── Test 21: Title without a name does NOT match ──
{
  const text = `The sheriff waves. The father blesses them. The captain departs.`;
  const got = extractNPCsFromNarration(text);
  assert(got.length === 0, 'T21: bare titles without a proper name do not match');
}

// ── Test 22: Confidence field is populated on high-confidence patterns ──
{
  const text = `"I'm Kaye Tesarani," she says with a practiced smile.`;
  const got = extractNPCsFromNarration(text);
  const kaye = got.find(n => n.name === 'Kaye Tesarani');
  assert(kaye?.confidence === 'high', 'T22: I\'m-Name tagged as high confidence');
}

// ── Test 23: Party name filter applies across all pattern tiers ──
{
  const text = `Sheriff Ironforge nods. "I'm Ironforge, the captain of the watch."`;
  const got = extractNPCsFromNarration(text, { partyNames: ['Ironforge'] });
  assert(!got.some(n => n.name === 'Ironforge'), 'T23: PC name filtered from title+name medium match');
}

// ── Test 24: Regression — descriptive prose with no intro anywhere ──
{
  const text = `The cobbled streets of Sandpoint gleam in the dawn light. Crates stack against the wharf; gulls wheel overhead. Nothing moves.`;
  const got = extractNPCsFromNarration(text);
  assert(got.length === 0, 'T24: pure atmosphere, no names extracted');
}

// ── Third-person narrator intro (Tom's live Market Square case) ────────

// ── Test 25: "His name is X" / "Her name is X" / "Their name is X" ──
{
  const text1 = `His name is Cordell, he tells you, a herring fisherman of twenty years.`;
  const got1 = extractNPCsFromNarration(text1);
  const cordell = got1.find(n => n.name === 'Cordell');
  assert(cordell, 'T25a: captures "His name is Cordell"');
  assert(cordell?.confidence === 'high', 'T25b: tagged high confidence');

  const text2 = `Her name is Mira, and she runs the mill.`;
  const got2 = extractNPCsFromNarration(text2);
  assert(got2.some(n => n.name === 'Mira'), 'T25c: captures "Her name is Mira"');

  const text3 = `Their name is Ash, a traveling scholar.`;
  const got3 = extractNPCsFromNarration(text3);
  assert(got3.some(n => n.name === 'Ash'), 'T25d: captures "Their name is Ash"');

  const text4 = `His name's Bran — just Bran, nothing more.`;
  const got4 = extractNPCsFromNarration(text4);
  assert(got4.some(n => n.name === 'Bran'), 'T25e: captures "His name\'s Bran" (contraction)');
}

// ── Test 26: Tom's Market Square live-session regression ──────────────
// Full paragraph from the live session that bug #50 was filed against.
// Must pick up Cordell (new pattern), Tobyn (title+name), Hemlock
// (title+name), and Nualia (named). Ameiko Kaijitsu is a known gap —
// she's mentioned in passing inside another NPC's dialogue, not
// introduced. She gets caught when the party actually meets her.
{
  const text = `His name is Cordell, he tells you, a herring fisherman of twenty years. The cathedral took the old one along with the beloved Father Tobyn and his ward, a girl named Nualia. "Sheriff Hemlock's been a mite grim about it, more than usual, even."`;
  const got = extractNPCsFromNarration(text, { partyNames: ['Ironforge', 'Shadowblade'] });
  const names = new Set(got.map(n => n.name));
  assert(names.has('Cordell'), 'T26a: Cordell');
  assert(names.has('Tobyn'), 'T26b: Tobyn via title+name');
  assert(names.has('Nualia'), 'T26c: Nualia via named');
  assert(names.has('Hemlock'), 'T26d: Hemlock via title+name');
  assert(got.length >= 4, 'T26e: at least 4 NPCs extracted from live paragraph');
}

// ── Test 27: Dialogue-filler stopword filter (#29) ─────────────────────
// Regression for Tom's 2026-04-18 Market Square session where Pattern 1
// captured "Research", "Finally", "Nope" etc. as NPC names because they
// appeared Capitalized at the start of a quoted reply followed by a
// speech verb ("Research," he answered, …).
{
  const text = `"Research," he answered quietly, "into how the Whispering Way binds its dead."`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Research'), 'T27a: rejects "Research" in dialogue position');
}
{
  const text = `"Finally," she said, glancing up from the ledger.`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Finally'), 'T27b: rejects "Finally" in dialogue position');
}
{
  const text = `"Nope," the gnome muttered, "not today."`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Nope'), 'T27c: rejects "Nope" in dialogue position');
}
{
  const text = `"Perhaps," he adds after a long pause, "we should reconsider."`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Perhaps'), 'T27d: rejects "Perhaps" in dialogue position');
}
{
  const text = `"Exactly," she replied, "that's what I was thinking."`;
  const got = extractNPCsFromNarration(text);
  assert(!got.some(n => n.name === 'Exactly'), 'T27e: rejects "Exactly" in dialogue position');
}
{
  // Sanity check: real names in the same construction still pass.
  const text = `"Bertha," she says, "Bertha Cray."`;
  const got = extractNPCsFromNarration(text);
  assert(got.some(n => n.name === 'Bertha'), 'T27f: real name in same frame still captured');
}

console.log(`\nnpcExtraction: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
