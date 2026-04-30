/**
 * npcExtraction — heuristic fallback for pulling NPC introductions out of
 * raw narration when the AI forgot (or malformed) the structured ENTITIES:
 * metadata line in dmEngine.narrate().
 *
 * Motivation (bug #30): the operator met an NPC named "Bertha Cray" during
 * a conversation with the narrator. She introduced herself by name in
 * dialogue, but the AI omitted the ENTITIES line, so the structured
 * NPC-capture path (processNewEntities in AdventureTab.jsx) never fired
 * and she never showed up in the sidebar or journal.
 *
 * The ENTITIES line is still the primary/preferred source — it has full
 * race/occupation/disposition metadata. This extractor is a best-effort
 * fallback that only activates when ENTITIES produced zero NPCs (or
 * missed an obviously-named speaker). It looks for unambiguous dialogue
 * attribution patterns and known-NPC-introduction phrases, then emits
 * minimal `{name, shortDesc}` records suitable for piping into
 * generateNPC + storeNPC with sensible defaults.
 *
 * Heuristic covers two tiers:
 *
 * HIGH-confidence (unambiguous dialogue / explicit self-intro):
 *   1. `"Name," she/he/they says/whispers/adds/mutters/answers`
 *   2. `"I'm Name"` / `"My name is Name"` / `"Call me Name"` / `"They call me Name"`
 *   3. `Name introduces herself/himself/themselves`
 *
 * MEDIUM-confidence (plain-narrative mentions that are still recognizable
 * as NPC introductions rather than places/spells/factions):
 *   4. Meeting-verb + Name:     `You meet Bertha` / `the party encounters Marek`
 *   5. Name + role apposition:  `Bertha Cray, a gruff dwarf blacksmith`
 *   6. Named/called phrasing:   `a half-orc named Grek`
 *   7. Title + Name:            `Sheriff Hemlock`, `Father Zantus`, `Captain Jakarov`
 *
 * Medium-confidence patterns 5-7 require corroborating context (a role
 * word, an "a/the ... named" frame, or a known title prefix) so random
 * capitalized words in narration don't silently become NPCs. Results
 * carry a `confidence` field so the GM can review medium-confidence
 * captures in the journal and delete false positives. storeNPC still
 * dedupes by name on subsequent encounters, so a missed false-positive
 * at the extractor layer can be cleaned up once without re-firing.
 *
 * All patterns require the name token to be a Capitalized Word (plus
 * optional second Capitalized Word for surnames), not a stop-word
 * (He/She/They/The/It/You etc.), and not a party-member name, and not
 * an already-known NPC name.
 */

// Stop-words that might legitimately appear in Capital position inside
// our regexes but are never a person's name. Keep this set small and
// explicit — over-filtering hides real NPCs.
const NAME_STOPWORDS = new Set([
  // Pronouns
  'He', 'She', 'They', 'We', 'You', 'It', 'I',
  // Articles / determiners
  'The', 'A', 'An', 'This', 'That', 'These', 'Those',
  // Sentence starters common in narration
  'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Her', 'His', 'Their', 'My', 'Our', 'Your', 'Its',
  'Then', 'Now', 'Here', 'There', 'Where', 'When',
  'But', 'And', 'Or', 'So', 'Yet', 'For', 'Nor',
  'What', 'Who', 'Why', 'How',
  // Narration-voice interjections
  'Yes', 'No', 'Okay', 'Alright', 'Well', 'Look',
  'Hey', 'Hi', 'Hello', 'Oh', 'Ah', 'Listen', 'Please',
  // Discourse markers that show up in Capital position inside quoted
  // dialogue ("Anyway," she says…) and used to slip through pattern 1
  // as fake NPC names. Tom's live Market Square session: Sable's
  // "Anyway," she says, just slightly brighter than before, "you'll
  // want to be in the square by noon" → was storing "Anyway" as an NPC.
  'Anyway', 'Anyways', 'Anyhow', 'Besides', 'However', 'Meanwhile',
  'Still', 'Regardless', 'Nonetheless', 'Moreover', 'Furthermore',
  'Actually', 'Honestly', 'Basically', 'Obviously', 'Clearly', 'Indeed',
  'Thus', 'Hence', 'Therefore', 'Frankly', 'Truly', 'Really',
  // Dialogue fillers / reaction words that show up Capitalized at the
  // start of a quoted reply and would otherwise be captured by Pattern 1's
  // "Word," she says… construction. Tom's 2026-04-18 Market Square log:
  // "Research," he answered, "into how the Whispering Way…" stored
  // "Research" as an NPC. Same family: one-word affirmations, negations,
  // discourse openers, and stock reactions.
  'Finally', 'Research', 'Perhaps', 'Maybe', 'Probably', 'Possibly',
  'Yeah', 'Yep', 'Yup', 'Nope', 'Nah', 'Sure', 'Fine',
  'Right', 'Wrong', 'Correct', 'Exactly', 'Precisely', 'Agreed',
  'Good', 'Great', 'Nice', 'Perfect', 'Excellent', 'Wonderful',
  'Amazing', 'Interesting', 'Fascinating', 'Curious', 'Strange', 'Odd',
  'Sorry', 'Thanks', 'Thank', 'Wait', 'Stop', 'Enough',
  // Game-mechanics words that sometimes appear Capitalized mid-sentence
  'DC', 'HP', 'AC', 'CR', 'GM', 'DM',
]);

// Minimum name length (in characters). "Li" is a valid name but we
// require at least 3 chars to suppress two-letter typos / abbreviations.
const MIN_NAME_LEN = 3;

// Role nouns that make a post-name apposition read as an NPC role. Kept
// as a separate export-testable constant because it's the most likely
// place to need tuning after field experience.
const ROLE_WORDS = [
  // Trades & crafts
  'blacksmith', 'smith', 'merchant', 'innkeeper', 'barkeep', 'bartender',
  'farmer', 'farmhand', 'hunter', 'fisherman', 'fisher', 'carpenter',
  'tailor', 'seamstress', 'jeweler', 'cobbler', 'mason', 'baker',
  'butcher', 'brewer', 'cook', 'miner', 'woodcutter', 'sailor',
  'alchemist', 'apothecary', 'herbalist', 'healer', 'midwife', 'scribe',
  // Religious
  'priest', 'priestess', 'acolyte', 'cleric', 'paladin', 'monk',
  'shaman', 'witch', 'warlock', 'druid',
  // Martial
  'soldier', 'guard', 'captain', 'lieutenant', 'sergeant', 'corporal',
  'sheriff', 'bard', 'wizard', 'ranger', 'rogue', 'fighter', 'sorcerer',
  'warrior', 'mage',
  // Social / political
  'mayor', 'noble', 'elder', 'lord', 'lady', 'owner', 'keeper', 'master',
  'mistress', 'head', 'leader', 'chief', 'chieftain', 'councilor',
  // Service
  'servant', 'maid', 'stablehand', 'groom', 'shepherd', 'scholar', 'clerk',
  // Catch-all that's common in fantasy narration
  'hermit', 'beggar', 'thief', 'adventurer', 'explorer', 'traveler',
  'traveller', 'child', 'youth', 'boy', 'girl', 'man', 'woman',
];

// Titles that prefix a proper name as a respected-form address.
const TITLE_WORDS = [
  'Sheriff', 'Captain', 'Lieutenant', 'Sergeant', 'Corporal', 'General',
  'Commander', 'Admiral', 'Father', 'Mother', 'Sister', 'Brother',
  'Priest', 'Priestess', 'Bishop', 'Reverend', 'Elder', 'Mayor', 'Lord',
  'Lady', 'Sir', 'Dame', 'Master', 'Mistress', 'Madam', 'Mister', 'Mr',
  'Mrs', 'Ms', 'Dr', 'Professor', 'King', 'Queen', 'Prince', 'Princess',
  'Duke', 'Duchess', 'Count', 'Countess', 'Baron', 'Baroness', 'Chief',
  'Chieftain', 'Shaman', 'Magister', 'Archmage',
];

// Verbs that frame the next capitalized token as a subject being met
// or introduced rather than acted upon abstractly.
const MEETING_VERBS = [
  'meet', 'meets', 'met', 'meeting',
  'greet', 'greets', 'greeted', 'greeting',
  'approach', 'approaches', 'approached', 'approaching',
  'encounter', 'encounters', 'encountered', 'encountering',
  'spot', 'spots', 'spotted', 'spotting',
  'find', 'finds', 'found', 'finding',
  'address', 'addresses', 'addressed', 'addressing',
  'recognize', 'recognizes', 'recognized', 'recognizing',
  'call', 'calls', 'called', 'calling',
  'summon', 'summons', 'summoned', 'summoning',
  'notice', 'notices', 'noticed', 'noticing',
  'see', 'sees', 'saw', 'seeing',
];

// Per-capture pattern list. Order matters: earlier = higher-confidence.
// HIGH-confidence patterns fire first and get priority on the dedupe
// set so their evidence snippet wins. MEDIUM-confidence patterns follow.
// Each entry returns a {name, shortDesc} where shortDesc is a trimmed
// snippet of ~150 chars around the match for GM review.
//
// Bug #57 — `presenceImplication` disambiguates "NPC is on-scene" from
// "NPC is merely referenced in exposition about someone elsewhere":
//   'present'    — pattern only fires when the NPC is the speaker or
//                  is being actively met / self-introduced. Skip the
//                  context classifier; these are always present.
//   'contextual' — pattern can fire for NPCs merely mentioned in
//                  exposition ("Father Tobyn who died in the fire").
//                  Run classifyPresenceFromContext to tag present /
//                  mentioned / historical.
const PATTERNS = [
  // ---- HIGH-confidence patterns ----
  {
    // "Bertha," she says simply. / "Jodar," he whispered. /
    //   "Marek," the cloaked figure whispers,
    re: /["\u201C]([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?["\u201D]?\s+(?:she|he|they|(?:the|a|an|[A-Z][a-z]+)(?:\s+\w+){0,3})\s+(?:says?|said|whispers?|whispered|adds?|added|mutters?|muttered|answers?|answered|replies|replied|calls?|called|explains?|explained|introduces?|introduced)/g,
    group: 1,
    confidence: 'high',
    presenceImplication: 'present',
  },
  {
    // "I'm Bertha" / "I am Bertha Cray"
    re: /["\u201C][^"\u201D]*?\bI(?:'m|\s+am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b[^"\u201D]*?["\u201D]/g,
    group: 1,
    confidence: 'high',
    presenceImplication: 'present',
  },
  {
    // "My name is Bertha" / "My name's Bertha Cray"
    re: /["\u201C][^"\u201D]*?\bMy\s+name(?:\s+is|'s)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b[^"\u201D]*?["\u201D]/g,
    group: 1,
    confidence: 'high',
    presenceImplication: 'present',
  },
  {
    // "His name is Cordell" / "Her name's Mira" / "Their name is Ash" —
    // third-person narrator intro. Mirrors the first-person "My name is"
    // pattern above and is equally unambiguous — a named subject is being
    // introduced to the party. This is NOT quoted dialogue: the narrator
    // is the one attributing the name ("His name is Cordell, he tells
    // you…"), so we don't require surrounding quotes. Caught Tom's live
    // Market Square session: "His name is Cordell, he tells you, a
    // herring fisherman of twenty years".
    re: /\b(?:His|Her|Their)\s+name(?:\s+is|'s)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    group: 1,
    confidence: 'high',
    presenceImplication: 'present',
  },
  {
    // "Call me Bertha" / "They call me Bertha"
    re: /["\u201C][^"\u201D]*?\b(?:call\s+me|they\s+call\s+me|people\s+call\s+me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b[^"\u201D]*?["\u201D]/gi,
    group: 1,
    confidence: 'high',
    presenceImplication: 'present',
  },
  {
    // Name introduces herself/himself/themselves
    re: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+introduces?\s+(?:herself|himself|themselves?|themself)\b/g,
    group: 1,
    confidence: 'high',
    presenceImplication: 'present',
  },
  // ---- MEDIUM-confidence patterns ----
  {
    // "You meet Bertha" / "the party encounters Marek" / "Ameiko greets
    // Sandru". Requires a meeting/greeting verb immediately before the
    // capitalized name so random subject-verb constructions like
    // "Sandpoint faded" don't match. Meeting verbs imply actively
    // engaging — always present.
    re: new RegExp(
      '\\b(?:' + MEETING_VERBS.join('|') + ')\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\b',
      'g'
    ),
    group: 1,
    confidence: 'medium',
    presenceImplication: 'present',
  },
  {
    // "Bertha Cray, a gruff dwarf blacksmith" / "Ameiko, the tavern owner".
    // Requires a role word in the apposition so "Sandpoint, the sleepy
    // town" and similar location appositives don't match (town isn't in
    // ROLE_WORDS). Up to 4 intervening adjective words allowed. The
    // apposition frame CAN appear inside exposition ("…Father Tobyn,
    // the old priest who died in the fire…") so run the context
    // classifier to downgrade referential matches.
    re: new RegExp(
      '\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?),\\s+(?:an?|the)\\s+(?:[a-z-]+\\s+){0,4}(?:' +
        ROLE_WORDS.join('|') +
        ')\\b',
      'g'
    ),
    group: 1,
    confidence: 'medium',
    presenceImplication: 'contextual',
  },
  {
    // "a half-orc named Grek" / "the old man called Markus" /
    // "a stranger known as Varys". The "named/called/known as" frame is
    // unambiguous enough that we don't need a role-word whitelist here.
    // Narrator is introducing a specific person who is in-scene.
    re: /\b(?:[Aa]n?|[Tt]he)\s+(?:[a-z-]+\s+){0,5}(?:named|called|known\s+as)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
    group: 1,
    confidence: 'medium',
    presenceImplication: 'present',
  },
  {
    // "Sheriff Hemlock" / "Father Zantus" / "Captain Jakarov".
    // Title whitelist prevents random capitalized-capitalized pairs
    // from matching (e.g. "Varisia Sandpoint" — neither is a title).
    // Bug #57 — this is the PRIMARY false-positive source: titles
    // routinely appear in exposition ("took Father Tobyn", "Mayor
    // Deverin saw it built", "Father Zantus is a good man"). Context
    // classifier disambiguates on-scene from mentioned-only matches.
    re: new RegExp(
      '\\b(?:' + TITLE_WORDS.join('|') + ')\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)?)\\b',
      'g'
    ),
    group: 1,
    confidence: 'medium',
    presenceImplication: 'contextual',
  },
];

function isStopName(name) {
  if (!name) return true;
  const first = name.split(/\s+/)[0];
  if (NAME_STOPWORDS.has(first)) return true;
  if (first.length < MIN_NAME_LEN) return true;
  return false;
}

function normalizeName(name) {
  return (name || '').trim().replace(/\s+/g, ' ');
}

// Death-context detection. When the narrative attributes a death to the
// captured name within a short window of the match, we want the NPC to
// land in the Journal as deceased rather than living. The regex covers
// the typical past-tense constructions that show up in DM prose:
//   "Father Tobyn who died in it"
//   "killed by the goblins last year"
//   "perished in the fire"
//   "slain years ago"
//   "is long dead"
//   "was murdered"
// False-positive resistance: we do NOT match bare "fell" (→ "fell in
// love") or bare "lost" (→ "lost the argument"). "Passed away" must be
// the two-word phrase; solo "passed" is too ambiguous.
const DEATH_PHRASES = /\b(?:died|dies|dying|deceased|dead|killed|slain|slew|murdered|perished|perishes|perishing|massacred|martyred|passed\s+away|passed\s+on|lost\s+(?:his|her|their)\s+life|gave\s+(?:his|her|their)\s+life|fell\s+in\s+battle|fell\s+in\s+the)\b/i;
const DEATH_WINDOW_BEFORE = 80;
const DEATH_WINDOW_AFTER = 120;

// Extract a cause-of-death clue from the death-phrase neighborhood so the
// Journal's "deceased" label can carry a little context ("died in the
// fire", "killed by goblins"). Best-effort; returns null when no obvious
// clause is attached.
function extractDeathCause(windowText) {
  if (!windowText) return null;
  const m = windowText.match(/\b(?:died|killed|perished|slain|murdered)\s+(?:in|by|during|at)\s+([a-z][a-z\s-]{2,60})(?:[.,;]|$)/i);
  if (m && m[1]) return m[1].trim().replace(/\s+/g, ' ');
  return null;
}

function detectDeceased(text, matchIndex, matchLength) {
  if (!text) return { deceased: false, cause: null };
  const start = Math.max(0, matchIndex - DEATH_WINDOW_BEFORE);
  const end = Math.min(text.length, matchIndex + matchLength + DEATH_WINDOW_AFTER);
  const window = text.slice(start, end);
  if (!DEATH_PHRASES.test(window)) return { deceased: false, cause: null };
  return { deceased: true, cause: extractDeathCause(window) };
}

/**
 * Bug #57 — for AI-emitted ENTITIES entries we only get a name, no match
 * context. Scan `text` for the name and check whether ANY occurrence
 * appears outside of quoted dialogue. If every occurrence is inside a
 * quoted span, the AI was following someone else's speech and emitted
 * an NPC who isn't actually on-scene (Tom's Market Square case: "took
 * Father Tobyn", "Father Zantus is a good man", "Mayor Deverin saw it
 * built" — all inside Dass Korvaski's monologue).
 *
 * Returns true if the name appears in narrator voice at least once, OR
 * if the name doesn't appear in the prose at all (conservative default:
 * the AI explicitly declared them in ENTITIES, so we don't drop based
 * on absence of textual evidence). Returns false only when we have
 * positive evidence the name is referenced *only* inside someone
 * else's dialogue.
 *
 * @param {string} name
 * @param {string} text
 * @returns {boolean}
 */
export function nameAppearsInSceneNarration(name, text) {
  if (!name || typeof name !== 'string') return true;
  if (!text || typeof text !== 'string') return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  // Escape regex metacharacters; appearance descriptors may contain spaces.
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\b' + escaped + '\\b', 'g');
  let m;
  let totalFound = 0;
  let outsideQuotes = 0;
  while ((m = re.exec(text)) !== null) {
    totalFound += 1;
    if (!isInsideQuotedDialogue(text, m.index)) outsideQuotes += 1;
  }
  if (totalFound === 0) return true; // no textual evidence either way
  return outsideQuotes > 0;
}

// Bug #57 — presence gate. When the extractor finds a title+name / meeting-verb /
// role-apposition match INSIDE a quoted dialogue block, the named subject is
// almost always being referred to (by the speaking NPC) rather than physically
// present. Tom's live Market Square case: Dass Korvaski (the present fisherman)
// spoke a line mentioning Father Tobyn, Father Zantus, and Mayor Deverin — only
// Tobyn even warranted deceased handling; Zantus and Deverin are alive but
// elsewhere. All three were wrongly surfacing as Nearby NPCs with Talk-to
// buttons because the medium-confidence patterns caught them in the speech.
//
// We detect "inside dialogue" with a simple quote-parity scan from 0..index:
// odd number of straight ASCII quotes before the match means we're inside a
// quoted span; smart-quote pairs \u201C/\u201D are tracked as a separate
// open/close counter (more reliable since smart quotes are directional).
// Either check tripping is sufficient — the AI mixes quote styles between
// responses.
//
// High-confidence patterns (self-intro, dialogue-attribution) deliberately
// remain ungated — they EXPECT to fire inside quotes ("I'm Bertha" / "Bertha,"
// she says) and that firing is the correct behavior. The gate only applies
// to the medium-confidence patterns where being inside someone else's speech
// is strong evidence the named subject is referential.
function isInsideQuotedDialogue(text, index) {
  if (!text || typeof index !== 'number' || index <= 0) return false;
  const before = text.slice(0, index);
  let smartOpen = 0;
  let smartClose = 0;
  let asciiCount = 0;
  for (let i = 0; i < before.length; i += 1) {
    const ch = before.charCodeAt(i);
    if (ch === 0x201C) smartOpen += 1;
    else if (ch === 0x201D) smartClose += 1;
    else if (ch === 0x22) asciiCount += 1;
  }
  if (smartOpen > smartClose) return true;
  if ((asciiCount % 2) === 1) return true;
  return false;
}

/**
 * Extract NPC candidates from narration text.
 *
 * @param {string} text - raw narration prose (no ENTITIES/ACTIONS tails)
 * @param {object} opts
 * @param {string[]} opts.partyNames   - names of PCs; these are always filtered
 * @param {string[]} opts.knownNpcNames - names already stored in encounteredNpcs; filtered
 * @param {string[]} opts.alreadyExtracted - names already captured from ENTITIES this turn
 * @returns {{ name: string, shortDesc: string, confidence: string }[]}
 */
export function extractNPCsFromNarration(text, opts = {}) {
  if (!text || typeof text !== 'string') return [];
  const partyNames = new Set((opts.partyNames || []).map(n => (n || '').trim().toLowerCase()));
  const knownNpcNames = new Set((opts.knownNpcNames || []).map(n => (n || '').trim().toLowerCase()));
  const alreadyExtracted = new Set((opts.alreadyExtracted || []).map(n => (n || '').trim().toLowerCase()));

  const seen = new Set();
  const results = [];

  for (const { re, group, confidence } of PATTERNS) {
    // Some regexes carry the 'g' flag; ensure we reset lastIndex per call.
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = normalizeName(m[group]);
      if (!raw || isStopName(raw)) continue;
      const key = raw.toLowerCase();
      if (partyNames.has(key)) continue;
      if (knownNpcNames.has(key)) continue;
      if (alreadyExtracted.has(key)) continue;
      if (seen.has(key)) continue;
      // Bug #57 — presence gate. Medium-confidence matches (meeting verb,
      // role apposition, title+name) that occur inside a quoted dialogue
      // span are almost always a speaker *referring* to someone off-scene,
      // not introducing a present NPC. Drop them here so the Nearby NPCs
      // panel stops populating with historical / referenced figures.
      // High-confidence patterns (self-intro, dialogue attribution) stay
      // ungated — they MEAN to fire inside quotes.
      if (confidence === 'medium' && isInsideQuotedDialogue(text, m.index)) {
        continue;
      }
      seen.add(key);

      // Build a short evidence snippet from the match neighborhood so a
      // GM can skim the journal and confirm the capture is real. Medium-
      // confidence matches get a slightly wider window because the match
      // anchor (a role word, a title) is often just before the name.
      const contextBefore = confidence === 'medium' ? 60 : 30;
      const start = Math.max(0, m.index - contextBefore);
      const end = Math.min(text.length, m.index + (m[0]?.length || 0) + 60);
      const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

      // Tom's live report: Father Tobyn was captured via title+name, but
      // the narrative said "Father Tobyn who died in it". He should land
      // in the Journal flagged deceased, not alive. Scan a small window
      // around the match for death-verbs and forward the flag.
      const { deceased, cause } = detectDeceased(text, m.index, m[0]?.length || 0);

      results.push({
        name: raw,
        shortDesc: snippet.length > 180 ? snippet.slice(0, 177) + '…' : snippet,
        confidence: confidence || 'high',
        deceased,
        causeOfDeath: cause || null,
      });
    }
  }

  return results;
}

// Bug #55 — person-head-noun set used by the plausibility gate below.
// Distinct from ROLE_WORDS (which frames "Name, a gruff dwarf blacksmith"
// role-apposition matches) because races and generic person words also
// need to count as head nouns for appearance descriptors like
// "tall woman" / "fat angry gnome" / "a cloaked figure".
const PERSON_HEAD_NOUNS = [
  // PF1e races (core + common ancestries)
  'gnome', 'elf', 'dwarf', 'halfling', 'half-orc', 'halforc',
  'half-elf', 'halfelf', 'tiefling', 'orc', 'goblin', 'hobgoblin',
  'kobold', 'gnoll', 'aasimar', 'human', 'drow', 'duergar',
  'kitsune', 'nagaji', 'ratfolk', 'suli', 'vanara', 'wayang',
  'catfolk', 'ifrit', 'oread', 'sylph', 'undine', 'changeling',
  'skinwalker', 'strix', 'tengu', 'grippli',
  // Generic person words (appearance-based descriptors)
  'man', 'woman', 'boy', 'girl', 'child', 'kid', 'youth', 'adult',
  'figure', 'fellow', 'stranger', 'lady', 'gentleman', 'individual',
  'person', 'soul', 'folk', 'villager', 'townsperson', 'local',
];

// Combined head-noun set the plausibility check scans against. ROLE_WORDS
// already covers trades/titles/religious/martial etc., so we union with
// PERSON_HEAD_NOUNS for the full coverage surface.
const HEAD_NOUN_SET = new Set(
  [...PERSON_HEAD_NOUNS, ...ROLE_WORDS].map((w) => w.toLowerCase())
);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
}

function hasPersonHeadNoun(text) {
  const tokens = tokenize(text);
  return tokens.some((t) => HEAD_NOUN_SET.has(t));
}

/**
 * Bug #55 — gate for "is this string plausibly a person?"
 *
 * Called at both NPC-creation entry points before storeNPC fires:
 *   - dmEngine.js ENTITIES: line parser (AI-emitted NPC:name|...)
 *   - AdventureTab.jsx processNewEntities (merged AI + heuristic list)
 *
 * Accepts three shapes and rejects everything else:
 *
 *   Shape 1 — Proper name: Capitalized first token, not a pronoun/article/
 *             discourse stopword. Examples: "Bertha", "Sheriff Hemlock",
 *             "Bertha Cray", "Ironforge".
 *
 *   Shape 2 — Article-lead appearance: /^(a|an|the|some)\s/ AND contains
 *             a person head noun somewhere in the remainder. Examples:
 *             "a cloaked woman", "the old dwarf blacksmith",
 *             "some hooded figure".
 *
 *   Shape 3 — Bare appearance: every token lowercase AND at least one
 *             token is a person head noun. Examples: "tall woman",
 *             "fat angry gnome", "grizzled dwarf merchant".
 *
 * Rejects: bare topic words the AI sometimes hallucinates onto the
 * ENTITIES line ("research", "what suits", "plans", "things", "matters",
 * "it") plus articled-but-no-person-noun phrases ("a plan",
 * "the research").
 *
 * Returns boolean.
 */
export function isPlausibleNPCName(rawName) {
  if (!rawName || typeof rawName !== 'string') return false;
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (name.length < MIN_NAME_LEN) return false;

  const tokens = name.split(/\s+/);
  const firstToken = tokens[0];

  // Shape 1: proper name — capital first letter, not a stopword.
  if (/^[A-Z][A-Za-z'-]+$/.test(firstToken) && !NAME_STOPWORDS.has(firstToken)) {
    return true;
  }

  // Shape 2: article-lead appearance — requires a person head noun in tail.
  const articleMatch = /^(?:a|an|the|some)\s+(.+)$/i.exec(name);
  if (articleMatch) {
    return hasPersonHeadNoun(articleMatch[1]);
  }

  // Shape 3: bare appearance — all tokens lowercase, at least one head noun.
  const allLowercase = tokens.every((t) => /^[a-z][a-z'-]*$/.test(t));
  if (allLowercase && hasPersonHeadNoun(name)) {
    return true;
  }

  return false;
}

/**
 * Bug #55 companion — returns true if the name is an appearance descriptor
 * (shapes 2 or 3), meaning the party hasn't been told the NPC's real name
 * yet and the record should land with knownToParty=false.
 *
 * Returns false for proper names (shape 1), for which knownToParty=true is
 * appropriate. Also returns false for implausible names — caller should
 * gate on isPlausibleNPCName first; this helper assumes the input already
 * passed validation.
 */
export function isAppearanceDescriptor(rawName) {
  if (!rawName || typeof rawName !== 'string') return false;
  const name = rawName.trim();
  if (!name) return false;
  // Article-lead is always a descriptor (shape 2).
  if (/^(?:a|an|the|some)\s+/i.test(name)) return true;
  // Otherwise, descriptor iff all-lowercase + has head noun (shape 3).
  const tokens = name.split(/\s+/);
  const allLowercase = tokens.every((t) => /^[a-z][a-z'-]*$/.test(t));
  if (allLowercase && hasPersonHeadNoun(name)) return true;
  return false;
}

// Exposed for targeted unit testing (patterns 1-10 incl. #50 expansion,
// plus #55 plausibility gate, plus #57 dialogue-presence gate +
// nameAppearsInSceneNarration for the AI-ENTITIES path).
export const _internal = {
  NAME_STOPWORDS,
  ROLE_WORDS,
  TITLE_WORDS,
  MEETING_VERBS,
  PERSON_HEAD_NOUNS,
  HEAD_NOUN_SET,
  PATTERNS,
  isStopName,
  normalizeName,
  hasPersonHeadNoun,
  isInsideQuotedDialogue,
  nameAppearsInSceneNarration,
};
