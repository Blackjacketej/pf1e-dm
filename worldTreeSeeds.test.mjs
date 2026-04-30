// worldTreeSeeds.test.mjs
// Regression tests for the Phase 1 Sandpoint seed expansion (2026-04-17).
// Covers: Main Road hub, Docks + children, Rusty Dragon interior (3 floors,
// inner rooms), Cathedral interior (stone circle + 6 shrines), Garrison
// interior (barracks/sheriff's office/training hall/basement jail), Town
// Hall interior (council/mayor/clerk/vault), plus ensureSeedInTree
// idempotent backfill from an old minimal tree.
//
// Run: npx vite-node worldTreeSeeds.test.mjs
//      (or Windows-side node if vite-node not installed)

import { buildSeedTree, ensureSeedInTree } from './src/data/worldTreeSeeds.js';
import { createTree, createChildNode, NODE_KINDS } from './src/services/worldTree.js';

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// Helpers -------------------------------------------------------------

function find(tree, name) {
  return Object.values(tree.nodes).find(n => n.name === name);
}
function childrenOf(tree, node) {
  if (!node) return [];
  return (node.childrenIds || []).map(id => tree.nodes[id]).filter(Boolean);
}
function childNames(tree, node) {
  return childrenOf(tree, node).map(n => n.name);
}
function findUnder(tree, parent, name) {
  return childrenOf(tree, parent).find(n => n.name === name);
}

// ──────────────────────────────────────────────────────────────────────
section('T1 — buildSeedTree backbone still intact');

{
  const { tree } = buildSeedTree('pf1e');
  assert('root is Golarion', tree.nodes[tree.rootId]?.name === 'Golarion');
  const avistan = find(tree, 'Avistan');
  const varisia = find(tree, 'Varisia');
  const hinterlands = find(tree, 'Sandpoint Hinterlands');
  const sandpoint = find(tree, 'Sandpoint');
  assert('Avistan present', !!avistan);
  assert('Varisia present', !!varisia);
  assert('Sandpoint Hinterlands present', !!hinterlands);
  assert('Sandpoint present', !!sandpoint);
  assert('Sandpoint kind = town', sandpoint?.kind === NODE_KINDS.TOWN);
}

// ──────────────────────────────────────────────────────────────────────
section('T2 — Sandpoint default entry is "Main Road" (not Market Square)');

{
  const { tree } = buildSeedTree('pf1e');
  const sandpoint = find(tree, 'Sandpoint');
  assert('Sandpoint.defaultEntry = Main Road', sandpoint?.defaultEntry === 'Main Road');
  const mainRoad = findUnder(tree, sandpoint, 'Main Road');
  assert('Main Road exists as a child', !!mainRoad);
  assert('Main Road kind = area', mainRoad?.kind === NODE_KINDS.AREA);
  const marketSquare = findUnder(tree, sandpoint, 'Market Square');
  assert('Market Square still exists (as sibling of Main Road)', !!marketSquare);
}

// ──────────────────────────────────────────────────────────────────────
section('T3 — Sandpoint has all expected top-level siblings');

{
  const { tree } = buildSeedTree('pf1e');
  const sandpoint = find(tree, 'Sandpoint');
  const names = childNames(tree, sandpoint);
  const expected = [
    'Main Road', 'Market Square', 'The Docks',
    'The Rusty Dragon', 'Sandpoint Cathedral',
    'Sandpoint Garrison', 'Sandpoint Town Hall',
    'The Old Light', 'Sandpoint Boneyard', "Junker's Edge",
    'The White Deer', 'The Hagfish', "Cracktooth's Tavern",
    "Risa's Place", "Fatman's Feedbag", "The Pixie's Kitten",
    "Savah's Armory", 'Red Dog Smithy', "The Pillbug's Pantry",
    'Bottled Solutions', 'Sandpoint Glassworks', 'Scarnetti Mill',
    'Sandpoint Lumber Mill', 'Two Knight Brewery', 'Goblin Squash Stables',
    'Rovanky Tannery', 'The Way North', 'The Curious Goblin',
    'The Feathered Serpent', 'General Store',
    'Turandarok Academy', 'House of Blue Stones', 'Sandpoint Theater',
    'Kaijitsu Manor', 'Deverin Manor', 'Scarnetti Manor', 'Valdemar Manor',
  ];
  for (const name of expected) {
    assert(`Sandpoint has child "${name}"`, names.includes(name));
  }
  assert('at least 37 Sandpoint children', names.length >= expected.length);
}

// ──────────────────────────────────────────────────────────────────────
section('T4 — The Docks has its own sub-locations');

{
  const { tree } = buildSeedTree('pf1e');
  const docks = find(tree, 'The Docks');
  assert('The Docks exists', !!docks);
  assert('The Docks kind = area', docks?.kind === NODE_KINDS.AREA);
  const names = childNames(tree, docks);
  assert('Docks → The Piers', names.includes('The Piers'));
  assert('Docks → Valdemar Fishmarket', names.includes('Valdemar Fishmarket'));
  assert('Docks → Sandpoint Shipyard', names.includes('Sandpoint Shipyard'));
}

// ──────────────────────────────────────────────────────────────────────
section('T5 — Rusty Dragon interior: 3 floors with rooms inside');

{
  const { tree } = buildSeedTree('pf1e');
  const rusty = find(tree, 'The Rusty Dragon');
  assert('Rusty Dragon exists', !!rusty);
  assert('Rusty Dragon kind = building', rusty?.kind === NODE_KINDS.BUILDING);
  assert('Rusty Dragon defaultEntry = Ground Floor', rusty?.defaultEntry === 'Ground Floor');
  const floors = childNames(tree, rusty);
  assert('has Ground Floor', floors.includes('Ground Floor'));
  assert('has Upper Floor', floors.includes('Upper Floor'));
  assert('has Basement', floors.includes('Basement'));

  const ground = findUnder(tree, rusty, 'Ground Floor');
  assert('Ground Floor kind = floor', ground?.kind === NODE_KINDS.FLOOR);
  assert('Ground Floor defaultEntry = Main Tavern Room', ground?.defaultEntry === 'Main Tavern Room');
  const groundNames = childNames(tree, ground);
  assert('Ground Floor → Main Tavern Room', groundNames.includes('Main Tavern Room'));
  assert('Ground Floor → Kitchen', groundNames.includes('Kitchen'));

  const upper = findUnder(tree, rusty, 'Upper Floor');
  const upperNames = childNames(tree, upper);
  assert('Upper Floor → The Bronze Room', upperNames.includes('The Bronze Room'));
  assert('Upper Floor → Luxury Rooms', upperNames.includes('Luxury Rooms'));
  assert('Upper Floor → Single Rooms', upperNames.includes('Single Rooms'));
  assert('Upper Floor → Lodging Common Room', upperNames.includes('Lodging Common Room'));
}

// ──────────────────────────────────────────────────────────────────────
section('T6 — Cathedral interior: stone circle + 6 shrines');

{
  const { tree } = buildSeedTree('pf1e');
  const cath = find(tree, 'Sandpoint Cathedral');
  assert('Cathedral exists', !!cath);
  assert('Cathedral defaultEntry = Stone Circle Courtyard', cath?.defaultEntry === 'Stone Circle Courtyard');
  const names = childNames(tree, cath);
  assert('Cathedral → Stone Circle Courtyard', names.includes('Stone Circle Courtyard'));
  const expectedShrines = ['Erastil', 'Abadar', 'Shelyn', 'Gozreh', 'Sarenrae', 'Desna'];
  for (const deity of expectedShrines) {
    assert(`Cathedral has Shrine of ${deity}`, names.includes(`Shrine of ${deity}`));
  }
}

// ──────────────────────────────────────────────────────────────────────
section('T7 — Garrison + Town Hall interiors');

{
  const { tree } = buildSeedTree('pf1e');
  const garrison = find(tree, 'Sandpoint Garrison');
  const gNames = childNames(tree, garrison);
  assert('Garrison → Guard Barracks', gNames.includes('Guard Barracks'));
  assert("Garrison → Sheriff's Office", gNames.includes("Sheriff's Office"));
  assert('Garrison → Militia Training Hall', gNames.includes('Militia Training Hall'));
  assert('Garrison → Basement Jail', gNames.includes('Basement Jail'));

  const hall = find(tree, 'Sandpoint Town Hall');
  const hNames = childNames(tree, hall);
  assert('Town Hall → Council Chamber', hNames.includes('Council Chamber'));
  assert("Town Hall → Mayor's Office", hNames.includes("Mayor's Office"));
  assert("Town Hall → Clerk's Office", hNames.includes("Clerk's Office"));
  assert('Town Hall → Basement Vault', hNames.includes('Basement Vault'));
}

// ──────────────────────────────────────────────────────────────────────
section('T8 — ensureSeedInTree idempotently backfills old trees');

{
  // Simulate a pre-expansion tree that only has Sandpoint + Market Square
  // (the shape Tom's live save was in at the start of the session).
  const tree = createTree({ name: 'Golarion', kind: NODE_KINDS.WORLD });
  const avistan = createChildNode(tree, tree.rootId, { name: 'Avistan', kind: NODE_KINDS.CONTINENT });
  const varisia = createChildNode(tree, avistan.id, { name: 'Varisia', kind: NODE_KINDS.COUNTRY });
  const hinterlands = createChildNode(tree, varisia.id, { name: 'Sandpoint Hinterlands', kind: NODE_KINDS.REGION });
  const sandpoint = createChildNode(tree, hinterlands.id, { name: 'Sandpoint', kind: NODE_KINDS.TOWN });
  createChildNode(tree, sandpoint.id, { name: 'Market Square', kind: NODE_KINDS.AREA });

  const beforeKids = (sandpoint.childrenIds || []).map(id => tree.nodes[id].name);
  assert('before — only Market Square under Sandpoint', beforeKids.length === 1 && beforeKids[0] === 'Market Square');

  const { added } = ensureSeedInTree(tree, 'pf1e');
  assert('ensureSeedInTree added new nodes', added.length > 30);

  const afterNames = (sandpoint.childrenIds || []).map(id => tree.nodes[id].name);
  assert('post-backfill: Main Road present', afterNames.includes('Main Road'));
  assert('post-backfill: The Docks present', afterNames.includes('The Docks'));
  assert('post-backfill: The Rusty Dragon present', afterNames.includes('The Rusty Dragon'));
  assert('post-backfill: Sandpoint Cathedral present', afterNames.includes('Sandpoint Cathedral'));
  assert('post-backfill: Market Square NOT duplicated',
    afterNames.filter(n => n === 'Market Square').length === 1);

  // Check a deep interior backfilled correctly too
  const rusty = find(tree, 'The Rusty Dragon');
  const ground = findUnder(tree, rusty, 'Ground Floor');
  const mainTavern = findUnder(tree, ground, 'Main Tavern Room');
  assert('deep backfill — Rusty Dragon → Ground Floor → Main Tavern Room exists', !!mainTavern);

  // Sandpoint defaultEntry should be filled in by ensureSeedInTree too
  // (via the "top up defaultEntry on existing seeds" branch)
  assert('backfilled Sandpoint.defaultEntry = Main Road',
    tree.nodes[sandpoint.id].defaultEntry === 'Main Road');
}

// ──────────────────────────────────────────────────────────────────────
section('T9 — second ensureSeedInTree pass is a no-op (idempotent)');

{
  const tree = createTree({ name: 'Golarion', kind: NODE_KINDS.WORLD });
  const avistan = createChildNode(tree, tree.rootId, { name: 'Avistan', kind: NODE_KINDS.CONTINENT });
  const varisia = createChildNode(tree, avistan.id, { name: 'Varisia', kind: NODE_KINDS.COUNTRY });
  const hinterlands = createChildNode(tree, varisia.id, { name: 'Sandpoint Hinterlands', kind: NODE_KINDS.REGION });
  createChildNode(tree, hinterlands.id, { name: 'Sandpoint', kind: NODE_KINDS.TOWN });

  ensureSeedInTree(tree, 'pf1e');
  const { added: added2 } = ensureSeedInTree(tree, 'pf1e');
  assert('second pass adds 0 nodes', added2.length === 0);
}

// ──────────────────────────────────────────────────────────────────────
section('T10 — travel picker sibling-of-Market-Square shows new hubs');

{
  // Simulate what Tom sees when standing in Market Square after the fix.
  const { tree } = buildSeedTree('pf1e');
  const marketSquare = find(tree, 'Market Square');
  assert('Market Square present', !!marketSquare);
  const parent = tree.nodes[marketSquare.parentId];
  const siblings = (parent.childrenIds || [])
    .map(id => tree.nodes[id])
    .filter(n => n && n.id !== marketSquare.id)
    .map(n => n.name);
  assert('Market Square has at least 30 siblings', siblings.length >= 30);
  assert('siblings include Main Road', siblings.includes('Main Road'));
  assert('siblings include The Docks', siblings.includes('The Docks'));
  assert('siblings include The Rusty Dragon', siblings.includes('The Rusty Dragon'));
  assert('siblings include Sandpoint Cathedral', siblings.includes('Sandpoint Cathedral'));
}

// ──────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
