// Bug #58 smoke test: sceneExtractionLLM pure-logic helpers.
//
// The LLM call itself isn't testable without a live API key — this file
// covers the deterministic pieces: JSON parse defensiveness, result
// normalization, user-message construction, and the empty-result shape.
// Routing (present → nearbyNPCs, mentioned → elsewhere, historical →
// alive:false) is covered by manual playtest because it requires
// Dexie + React state.
//
// Run with: node sceneExtractionLLM-check.mjs

import { _internal } from './src/services/sceneExtractionLLM.js';

const { parseJSONResponse, normalizeResult, emptyResult, buildUserMessage } = _internal;

let pass = 0;
let fail = 0;

function assertEq(actual, expected, label) {
  const aj = JSON.stringify(actual);
  const ej = JSON.stringify(expected);
  if (aj === ej) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`FAIL ${label}\n  expected: ${ej}\n  got     : ${aj}`);
  }
}
function assertTrue(cond, label) { assertEq(!!cond, true, label); }
function assertFalse(cond, label) { assertEq(!!cond, false, label); }

// ---- parseJSONResponse ----
{
  const raw = '{"npcs":{"present":[{"name":"Dass"}],"mentioned":[],"historical":[]}}';
  const p = parseJSONResponse(raw);
  assertEq(p?.npcs?.present?.[0]?.name, 'Dass', 'parse: bare JSON');
}
{
  const raw = '```json\n{"factions":[{"name":"Scarnettis"}]}\n```';
  const p = parseJSONResponse(raw);
  assertEq(p?.factions?.[0]?.name, 'Scarnettis', 'parse: fenced json block');
}
{
  const raw = 'Here is the JSON: {"rumors":[{"content":"watch the road"}]} — that covers it.';
  const p = parseJSONResponse(raw);
  assertEq(p?.rumors?.[0]?.content, 'watch the road', 'parse: prose-wrapped payload');
}
{
  const raw = 'not json at all';
  const p = parseJSONResponse(raw);
  assertEq(p, null, 'parse: non-JSON returns null');
}
{
  const raw = '{"broken":}';
  const p = parseJSONResponse(raw);
  assertEq(p, null, 'parse: malformed JSON returns null');
}

// ---- emptyResult shape ----
{
  const e = emptyResult();
  assertTrue(Array.isArray(e.npcs.present), 'emptyResult: npcs.present is array');
  assertTrue(Array.isArray(e.npcs.mentioned), 'emptyResult: npcs.mentioned is array');
  assertTrue(Array.isArray(e.npcs.historical), 'emptyResult: npcs.historical is array');
  assertTrue(Array.isArray(e.items.present), 'emptyResult: items.present is array');
  assertTrue(Array.isArray(e.items.mentioned), 'emptyResult: items.mentioned is array');
  assertTrue(Array.isArray(e.locations.accessible), 'emptyResult: locations.accessible is array');
  assertTrue(Array.isArray(e.locations.mentioned), 'emptyResult: locations.mentioned is array');
  assertTrue(Array.isArray(e.factions), 'emptyResult: factions is array');
  assertTrue(Array.isArray(e.quests), 'emptyResult: quests is array');
  assertTrue(Array.isArray(e.rumors), 'emptyResult: rumors is array');
  assertTrue(Array.isArray(e.clues.revealed), 'emptyResult: clues.revealed is array');
  assertTrue(Array.isArray(e.clues.resolved), 'emptyResult: clues.resolved is array');
  assertTrue(Array.isArray(e.lore), 'emptyResult: lore is array');
}

// ---- normalizeResult: happy path ----
{
  const parsed = {
    npcs: {
      present: [
        { name: 'Dass Korvaski', race: 'human', occupation: 'fisherman',
          disposition: 'friendly', shortDesc: 'weathered, mending nets',
          evidence: 'The fisherman, a weathered human, nods slowly.' },
      ],
      mentioned: [
        { name: 'Father Zantus', relationship: 'priest of Desna',
          status: 'alive', evidence: 'Father Zantus is a good man' },
      ],
      historical: [
        { name: 'Father Tobyn', relationship: 'former priest',
          context: 'died in the fire', evidence: 'Fire took Father Tobyn' },
      ],
    },
    items: {
      present: [
        { name: 'fishing nets', description: 'being mended',
          interactable: false, evidence: 'mending his nets' },
      ],
      mentioned: [
        { name: 'old temple', description: 'burned down', context: 'the fire',
          evidence: 'saw it built proper again' },
      ],
    },
    locations: {
      accessible: [
        { name: 'the market square', kind: 'path', direction: '',
          evidence: 'Market Square' },
      ],
      mentioned: [
        { name: 'Sandpoint Cathedral', kind: 'building', context: 'rebuilt after the fire',
          evidence: 'saw it built proper again' },
      ],
    },
    factions: [
      { name: 'the Scarnettis', archetype: 'noble_family',
        disposition_signal: 'suspicious', evidence: 'dark years' },
    ],
    quests: [
      { title: 'help with a missing shipment', kind: 'hook',
        giver: 'Dass Korvaski', task: 'investigate the docks',
        reward: '', location: 'Sandpoint Docks', urgency: 'medium',
        evidence: 'if you could take a look' },
    ],
    rumors: [
      { content: 'goblins have been raiding the road', source: 'Dass',
        reliability: 'credible', evidence: 'goblins been moving around' },
    ],
    clues: {
      revealed: [
        { content: 'the fire was set intentionally', topic: 'Chopper arson',
          evidence: 'dark years, those were' },
      ],
      resolved: [
        { topic: 'identity of the late priest', resolution: 'Father Tobyn',
          evidence: 'Fire took Father Tobyn' },
      ],
    },
    lore: [
      { topic: 'Old Light', category: 'history',
        fact: 'The Old Light was built by giants long before Sandpoint',
        evidence: 'built by giants long before the town' },
      { topic: 'Desna worship', category: 'religion',
        fact: 'Desna\'s symbol is the butterfly',
        evidence: 'a butterfly etched in silver' },
    ],
  };
  const n = normalizeResult(parsed);
  assertEq(n.npcs.present.length, 1, 'norm: 1 present npc');
  assertEq(n.npcs.present[0].name, 'Dass Korvaski', 'norm: present name');
  assertEq(n.npcs.present[0].race, 'human', 'norm: present race preserved');
  assertEq(n.npcs.mentioned.length, 1, 'norm: 1 mentioned');
  assertEq(n.npcs.mentioned[0].status, 'alive', 'norm: mentioned status');
  assertEq(n.npcs.historical.length, 1, 'norm: 1 historical');
  assertEq(n.items.present.length, 1, 'norm: 1 item present');
  assertEq(n.items.present[0].interactable, false, 'norm: item interactable false');
  assertEq(n.items.mentioned.length, 1, 'norm: 1 item mentioned');
  assertEq(n.locations.accessible.length, 1, 'norm: 1 accessible location');
  assertEq(n.locations.accessible[0].kind, 'path', 'norm: location kind');
  assertEq(n.locations.mentioned.length, 1, 'norm: 1 mentioned location');
  assertEq(n.factions.length, 1, 'norm: 1 faction');
  assertEq(n.factions[0].archetype, 'noble_family', 'norm: faction archetype');
  assertEq(n.factions[0].disposition_signal, 'suspicious', 'norm: faction disposition');
  assertEq(n.quests.length, 1, 'norm: 1 quest');
  assertEq(n.quests[0].kind, 'hook', 'norm: quest kind');
  assertEq(n.quests[0].urgency, 'medium', 'norm: quest urgency');
  assertEq(n.rumors.length, 1, 'norm: 1 rumor');
  assertEq(n.rumors[0].reliability, 'credible', 'norm: rumor reliability');
  assertEq(n.clues.revealed.length, 1, 'norm: 1 clue revealed');
  assertEq(n.clues.resolved.length, 1, 'norm: 1 clue resolved');
  assertEq(n.lore.length, 2, 'norm: 2 lore entries');
  assertEq(n.lore[0].category, 'history', 'norm: lore category preserved');
  assertEq(n.lore[1].category, 'religion', 'norm: lore category preserved 2');
  assertEq(n.lore[0].topic, 'Old Light', 'norm: lore topic preserved');
}

// ---- normalizeResult: defensive ----
{
  // Totally empty / missing fields → all empty arrays.
  assertEq(normalizeResult({}).npcs.present.length, 0, 'norm: empty object → empty present');
  assertEq(normalizeResult(null).factions.length, 0, 'norm: null → empty factions');
  assertEq(normalizeResult(undefined).quests.length, 0, 'norm: undefined → empty quests');
}
{
  // Rows without names are dropped.
  const n = normalizeResult({ npcs: { present: [{ name: '' }, { name: 'Ameiko' }, {}] } });
  assertEq(n.npcs.present.length, 1, 'norm: drops nameless present rows');
  assertEq(n.npcs.present[0].name, 'Ameiko', 'norm: keeps named row');
}
{
  // Unknown location kind → coerced to 'other' / 'unknown'.
  const n = normalizeResult({
    locations: {
      accessible: [{ name: 'weird-exit', kind: 'portal', direction: '' }],
      mentioned: [{ name: 'strange-place', kind: 'extraplanar' }],
    },
  });
  assertEq(n.locations.accessible[0].kind, 'other', 'norm: coerces unknown accessible kind');
  assertEq(n.locations.mentioned[0].kind, 'unknown', 'norm: coerces unknown mentioned kind');
}
{
  // Unknown faction archetype / disposition → coerced.
  const n = normalizeResult({
    factions: [{ name: 'weird-faction', archetype: 'made-up', disposition_signal: 'spicy' }],
  });
  assertEq(n.factions[0].archetype, 'other', 'norm: coerces bad archetype');
  assertEq(n.factions[0].disposition_signal, 'unknown', 'norm: coerces bad disposition');
}
{
  // Quest missing title but has task → title derived from task.
  const n = normalizeResult({
    quests: [{ task: 'find the missing shipment', kind: 'banana', urgency: 'apocalyptic' }],
  });
  assertEq(n.quests.length, 1, 'norm: quest kept with task but no title');
  assertEq(n.quests[0].kind, 'hook', 'norm: bad kind coerced to hook (default)');
  assertEq(n.quests[0].urgency, 'medium', 'norm: bad urgency coerced to medium');
  assertTrue(n.quests[0].title.startsWith('find the missing shipment'), 'norm: title derived from task');
}
{
  // NPC present with only name → fills defaults.
  const n = normalizeResult({ npcs: { present: [{ name: 'Mystery' }] } });
  assertEq(n.npcs.present[0].race, 'Human', 'norm: default race');
  assertEq(n.npcs.present[0].occupation, 'unknown', 'norm: default occupation');
  assertEq(n.npcs.present[0].disposition, 'neutral', 'norm: default disposition');
}
{
  // Lore: unknown category → coerced to 'history'.
  const n = normalizeResult({
    lore: [
      { topic: 'weird', category: 'cosmology', fact: 'the stars sing on solstice' },
      { topic: 'empty', category: 'history', fact: '' },  // should drop (no fact)
    ],
  });
  assertEq(n.lore.length, 1, 'norm: drops lore with empty fact');
  assertEq(n.lore[0].category, 'history', 'norm: coerces bad lore category');
  assertEq(n.lore[0].fact, 'the stars sing on solstice', 'norm: lore fact preserved');
}
{
  // Lore: all 8 legal categories preserved.
  const cats = ['history', 'geography', 'religion', 'culture', 'creature', 'legend', 'politics', 'magic'];
  const n = normalizeResult({
    lore: cats.map((c, i) => ({ topic: `t${i}`, category: c, fact: `f${i}` })),
  });
  assertEq(n.lore.length, 8, 'norm: all 8 legal lore categories kept');
  for (let i = 0; i < cats.length; i += 1) {
    assertEq(n.lore[i].category, cats[i], `norm: lore category ${cats[i]} preserved`);
  }
}

// ---- buildUserMessage ----
{
  const msg = buildUserMessage({
    narrationText: 'The market bustles. A fisherman waves.',
    partyNames: ['Ironforge'],
    knownNpcNames: ['Dass Korvaski'],
    locationName: 'Sandpoint Market Square',
  });
  assertTrue(msg.includes('Location: Sandpoint Market Square'), 'msg: includes location');
  assertTrue(msg.includes('Party members'), 'msg: includes party label');
  assertTrue(msg.includes('Ironforge'), 'msg: includes party name');
  assertTrue(msg.includes('Dass Korvaski'), 'msg: includes known NPC');
  assertTrue(msg.includes('The market bustles'), 'msg: includes paragraph');
  assertTrue(msg.includes('JSON only'), 'msg: ends with JSON-only directive');
}
{
  // Empty context → no party/known lines.
  const msg = buildUserMessage({ narrationText: 'alone in the dark', partyNames: [], knownNpcNames: [] });
  assertFalse(msg.includes('Party members'), 'msg: no party line when empty');
  assertFalse(msg.includes('Already-known'), 'msg: no known line when empty');
  assertTrue(msg.includes('alone in the dark'), 'msg: paragraph present');
}
{
  // Long roster → truncated with count suffix.
  const names = Array.from({ length: 60 }, (_, i) => `NPC${i}`);
  const msg = buildUserMessage({ narrationText: 'x', partyNames: [], knownNpcNames: names });
  assertTrue(msg.includes('NPC0'), 'msg: first known listed');
  assertTrue(msg.includes('NPC39'), 'msg: 40th known listed');
  assertFalse(msg.includes('NPC40'), 'msg: 41st truncated');
  assertTrue(msg.includes('(20 more)'), 'msg: truncation suffix');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
