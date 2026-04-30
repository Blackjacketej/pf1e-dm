/**
 * Journal redaction tests — publicNpcView + publicFactionView.
 *
 * Run with: npx vite-node journalRedaction.test.mjs
 *
 * These guardrails exist because the Journal shows player-facing data.
 * A regression that leaks mood/resources/secrets/true-alignment would
 * break the core GM/player trust boundary.
 */

import { publicNpcView, factionSizeHint } from './src/services/npcKnowledge.js';
import { publicFactionView } from './src/services/factionTracker.js';
import { locationSlug, publicLocationView, deriveLocationRefs } from './src/services/locationTracker.js';

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

// ═══════════════════════════════════════════════════════════
// publicNpcView — level gating
// ═══════════════════════════════════════════════════════════
section('publicNpcView — level 0 (observed)', () => {
  const raw = {
    id: 'npc-1',
    name: 'Red Bishop',
    race: 'mothman',
    alignment: 'CN',
    cr: 15,
    stats: { hp: 120, ac: 24 },
    factions: ['cult-of-pazuzu'],
    knowledgeLevel: 0,
    shortDesc: 'hooded figure',
  };
  const view = publicNpcView(raw);
  assert(view.identified === false, 'not identified at level 0');
  assert(view.displayName.includes('hooded figure'), 'shows descriptor only');
  assert(view.displayName !== 'Red Bishop', 'does NOT leak name');
  assert(view.race === null, 'race hidden at level 0');
  assert(view.stats === null, 'stats hidden');
  assert(view.alignment === null, 'alignment hidden');
  assert(view.factions.length === 0, 'factions hidden at level 0');
  assert(view.powerLevelHint === null, 'power level hidden');
});

section('publicNpcView — level 1 (named)', () => {
  const raw = {
    id: 'npc-1',
    name: 'Red Bishop',
    race: 'mothman',
    alignment: 'CN',
    cr: 15,
    stats: { hp: 120 },
    factions: ['cult-of-pazuzu'],
    knowledgeLevel: 1,
  };
  const view = publicNpcView(raw);
  assert(view.displayName === 'Red Bishop', 'name revealed at level 1');
  assert(view.race === 'mothman', 'race revealed at level 1');
  assert(view.occupation === null, 'occupation still hidden');
  assert(view.factions.length === 0, 'factions still hidden at level 1');
  assert(view.alignment === null, 'alignment still hidden');
  assert(view.stats === null, 'stats still hidden');
});

section('publicNpcView — level 3 (known) reveals public factions', () => {
  const raw = {
    id: 'npc-1',
    name: 'Red Bishop',
    race: 'mothman',
    cr: 15,
    alignment: 'CN',
    factions: ['cult-of-pazuzu'],
    secretFactions: ['hidden-cabal'],
    knowledgeLevel: 3,
    occupation: 'cleric',
  };
  const known = new Set(['cult-of-pazuzu', 'hidden-cabal']);
  const view = publicNpcView(raw, { encounteredFactionIds: known });
  assert(view.occupation === 'cleric', 'occupation revealed');
  assert(view.factions.some(f => f.id === 'cult-of-pazuzu' && !f.secret), 'public faction shown');
  assert(!view.factions.some(f => f.id === 'hidden-cabal'), 'secret faction still hidden at level 3');
  assert(view.alignment === null, 'alignment still hidden at level 3');
  assert(view.powerLevelHint === 'legendary', 'CR 15 → legendary hint');
  assert(view.stats === null, 'stats still hidden at level 3');
});

section('publicNpcView — secretFactions fact unlocks hidden ties', () => {
  const raw = {
    name: 'Erin Habe',
    knowledgeLevel: 3,
    factions: ['sanatorium'],
    secretFactions: ['cult-of-pazuzu'],
    revealedFacts: ['secretFactions'],
  };
  const known = new Set(['sanatorium', 'cult-of-pazuzu']);
  const view = publicNpcView(raw, { encounteredFactionIds: known });
  const hidden = view.factions.find(f => f.id === 'cult-of-pazuzu');
  assert(hidden && hidden.secret === true, 'secret faction tie marked secret');
});

section('publicNpcView — factions filtered to encountered only', () => {
  const raw = {
    name: 'Ameiko',
    knowledgeLevel: 3,
    factions: ['rusty-dragon', 'sandpoint-council'],
  };
  // Party only knows about rusty-dragon
  const known = new Set(['rusty-dragon']);
  const view = publicNpcView(raw, { encounteredFactionIds: known });
  assert(view.factions.length === 1, 'only encountered factions shown');
  assert(view.factions[0].id === 'rusty-dragon', 'correct faction kept');
});

section('publicNpcView — level 4 reveals everything', () => {
  const raw = {
    name: 'Red Bishop',
    knowledgeLevel: 4,
    alignment: 'CE',
    cr: 15,
    stats: { hp: 120, ac: 24 },
  };
  const view = publicNpcView(raw);
  assert(view.alignment === 'CE', 'alignment revealed at level 4');
  assert(view.stats !== null, 'stats revealed at level 4');
});

// Detail-view specific gating
section('publicNpcView — detail fields gated by level', () => {
  const raw = {
    name: 'Brother Aldric',
    knowledgeLevel: 1,
    playerNotes: 'Spoke to us at the temple.',
    familiar: { id: 'raven' },
    relationships: [{ targetName: 'Sister Mara', type: 'mentor' }],
    goal: 'Recover the relic of St. Ossian',
    emotionalState: { mood: 'anxious' },
  };
  const v1 = publicNpcView(raw);
  assert(v1.playerNotes === 'Spoke to us at the temple.', 'player notes always visible');
  assert(v1.familiar === null, 'familiar hidden at level 1');
  assert(v1.relationships.length === 0, 'relationships hidden at level 1');
  assert(v1.goal === null, 'goal hidden at level 1');
  assert(v1.emotionalState === null, 'emotionalState hidden at level 1');

  const v2 = publicNpcView({ ...raw, knowledgeLevel: 2 });
  assert(v2.familiar && v2.familiar.id === 'raven', 'familiar revealed at level 2');
  assert(v2.emotionalState !== null, 'emotionalState revealed at level 2');
  assert(v2.goal === null, 'goal still hidden at level 2');
  assert(v2.relationships.length === 0, 'relationships still hidden at level 2');

  const v3 = publicNpcView({ ...raw, knowledgeLevel: 3 });
  assert(v3.goal === 'Recover the relic of St. Ossian', 'goal revealed at level 3');
  assert(v3.relationships.length === 1, 'relationships revealed at level 3');
});

// ═══════════════════════════════════════════════════════════
// publicFactionView — level gating + redaction
// ═══════════════════════════════════════════════════════════
section('publicFactionView — level 0 hides name/archetype', () => {
  const record = {
    factionId: 'cult-of-pazuzu',
    name: 'Cult of Pazuzu',
    archetype: 'cult',
    knowledgeLevel: 0,
    encounters: 1,
    membersKnown: [],
  };
  const view = publicFactionView(record);
  assert(view.identified === false, 'not identified');
  assert(view.displayName.includes('unnamed'), 'name redacted');
  assert(view.archetype === null, 'archetype hidden at level 0');
  assert(view.publicGoals.length === 0, 'goals hidden at level 0');
});

section('publicFactionView — live faction secrets stay hidden', () => {
  const record = {
    factionId: 'cult-of-pazuzu',
    name: 'Cult of Pazuzu',
    archetype: 'cult',
    knowledgeLevel: 3,
    encounters: 5,
    membersKnown: ['npc-red-bishop'],
  };
  const faction = {
    name: 'Cult of Pazuzu',
    life: {
      mood: 'emboldened',
      resources: { gold: 50000, arcane: ['portal-key'] },
      secrets: ['plans to summon Uvaglor'],
      leadership: { current: 'Red Bishop' },
      goals: [
        { narrative: 'Spread chaos in the region', visibility: 'public' },
        { narrative: 'Open a portal to Uvaglor', visibility: 'secret' },
      ],
      publicReputation: 'feared cult',
    },
    relations: {
      'sandpoint-council': { standing: -80, label: 'hated' },
      'secret-ally': { standing: 90, label: 'allied', secret: true },
    },
  };
  const known = new Set(['cult-of-pazuzu', 'sandpoint-council', 'secret-ally']);
  const view = publicFactionView(record, faction, { encounteredFactionIds: known });

  assert(!('mood' in view), 'mood never exposed');
  assert(!('resources' in view), 'resources never exposed');
  assert(!('secrets' in view), 'secrets never exposed');
  assert(view.leader === null, 'leader hidden at level 3');
  assert(view.reputation === null, 'reputation hidden at level 3');
  assert(view.publicGoals.length === 1, 'only public goal exposed');
  assert(view.publicGoals[0].includes('Spread chaos'), 'public goal present');
  assert(!view.publicGoals.some(g => g.includes('Uvaglor')), 'secret goal REDACTED');
  assert(view.relations && view.relations['sandpoint-council'], 'public relation exposed');
  assert(view.relations && !view.relations['secret-ally'], 'secret relation REDACTED');
});

section('publicFactionView — level 4 unlocks leader + reputation', () => {
  const record = {
    factionId: 'f1', name: 'Cult', archetype: 'cult',
    knowledgeLevel: 4, encounters: 1, membersKnown: [],
  };
  const faction = {
    life: {
      leadership: { current: 'Red Bishop' },
      publicReputation: 'feared cult',
      mood: 'smug',
      secrets: ['plot-x'],
      goals: [],
    },
  };
  const view = publicFactionView(record, faction);
  assert(view.leader === 'Red Bishop', 'leader exposed at level 4');
  assert(view.reputation === 'feared cult', 'reputation exposed at level 4');
  assert(!('mood' in view), 'mood STILL never exposed');
  assert(!('secrets' in view), 'secrets STILL never exposed');
});

// ═══════════════════════════════════════════════════════════
// factionSizeHint — fuzzy counts
// ═══════════════════════════════════════════════════════════
section('factionSizeHint — gating by knowledge level', () => {
  assert(factionSizeHint(20, 0) === null, 'level 0 → no hint');
  assert(factionSizeHint(20, 1) === null, 'level 1 → no hint');
  assert(factionSizeHint(3, 2) === 'a handful of members', 'small @L2 qualitative');
  assert(factionSizeHint(3, 3) === '3 members known to exist', 'small @L3 exact');
  assert(factionSizeHint(25, 3) === 'a sizable network', 'medium @L3 still fuzzy');
  assert(factionSizeHint(25, 4).includes('operatives'), 'medium @L4 tighter');
  assert(factionSizeHint(100, 4) === 'a widespread network', 'huge @L4 still vague');
  assert(factionSizeHint(0, 4) === null, 'empty faction → null');
});

// ═══════════════════════════════════════════════════════════
// locationTracker — slug stability + cross-ref derivation
// ═══════════════════════════════════════════════════════════
section('locationSlug — deterministic + idempotent', () => {
  assert(locationSlug('Sandpoint') === 'sandpoint', 'basic slug');
  assert(locationSlug("Rusty Dragon") === 'rusty-dragon', 'spaces to hyphens');
  assert(locationSlug("Grubber's Hermitage") === 'grubber-s-hermitage', 'apostrophe stripped');
  assert(locationSlug('  Old Light  ') === 'old-light', 'trims whitespace');
  assert(locationSlug('') === '', 'empty safe');
  assert(locationSlug('Sandpoint') === locationSlug('SANDPOINT'), 'case-insensitive');
});

section('publicLocationView — pass-through shape', () => {
  const view = publicLocationView({
    locationId: 'sandpoint', name: 'Sandpoint', kind: 'town',
    visits: 3, firstImpression: 'A bustling coastal town',
    playerNotes: 'smell fish', firstSeenAt: 't1', lastSeenAt: 't2',
    region: 'Varisia',
  });
  assert(view.name === 'Sandpoint', 'name passed');
  assert(view.kind === 'town', 'kind passed');
  assert(view.visits === 3, 'visits passed');
  assert(view.region === 'Varisia', 'region passed');
});

section('deriveLocationRefs — faction inferred from member presence', () => {
  const refs = deriveLocationRefs('Sandpoint', {
    npcs: [
      { id: 'npc-a', name: 'Ameiko', location: 'Sandpoint', knownToParty: true },
      { id: 'npc-b', name: 'RedB', location: 'Grubber\'s Hermitage' },
    ],
    encounteredFactions: [
      { factionId: 'rusty', name: 'Rusty Dragon Crew', membersKnown: ['npc-a'] },
      { factionId: 'cult', name: 'Cult', membersKnown: ['npc-b'] },
    ],
    creatures: [],
  });
  assert(refs.npcs.length === 1, 'only Sandpoint NPCs');
  assert(refs.npcs[0].id === 'npc-a', 'correct NPC');
  assert(refs.factions.length === 1, 'only factions with members here');
  assert(refs.factions[0].factionId === 'rusty', 'Rusty Dragon inferred');
  assert(!refs.factions.some(f => f.factionId === 'cult'), 'Cult NOT inferred');
});

section('deriveLocationRefs — case-insensitive match', () => {
  const refs = deriveLocationRefs('Sandpoint', {
    npcs: [{ id: 'x', location: 'sandpoint' }, { id: 'y', location: 'SANDPOINT' }],
    encounteredFactions: [],
    creatures: [],
  });
  assert(refs.npcs.length === 2, 'matches regardless of casing');
});

// ═══════════════════════════════════════════════════════════
console.log(`\n──── Results: ${passed} passed, ${failed} failed ────`);
if (failed > 0) {
  console.error('Failures:');
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
