// craftSimulation.test.mjs
// Tests for NPC crafter simulation — weekly tick, project completion, roster handling.
// Run: npx vite-node craftSimulation.test.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getNpcCraftTotal,
  tickNpcCrafterProjects,
  tickNPCCrafters,
  tickPCCrafters,
  getPCCraftTotal,
  getActiveCrafters,
  hoursToWeeks,
} from './src/services/craftSimulation.js';
import { applyCraftDeedsToNpcs } from './src/services/factionSimulation.js';
import { createReputation } from './src/services/reputation.js';
import { startCraftProject } from './src/utils/craftDowntime.js';
import { getCraftSpecByName } from './src/utils/craftCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const craftableItemsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'src/data/craftableItems.json'), 'utf-8')
);

let pass = 0, fail = 0;
function section(name) { console.log(`\n── ${name} ──`); }
function assert(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${desc}`); }
}

// ──────────────────────────────────────────────────────────────────
section('getNpcCraftTotal — skill lookup + INT mod');

const npcA = {
  id: 'a', abilities: { INT: 12 },
  skillRanks: { 'Craft (weapons)': 8 },
};
assert('ranks 8 + INT mod 1 = 9',
  getNpcCraftTotal(npcA, 'Craft (weapons)') === 9);
assert('case-insensitive sub-skill lookup',
  getNpcCraftTotal(npcA, 'CRAFT (weapons)') === 9);
assert('short-form lookup also works (case-insens match)',
  getNpcCraftTotal(npcA, 'craft (weapons)') === 9);

const npcB = { id: 'b', abilities: { INT: 10 }, skillRanks: { 'Craft (armor)': 5 } };
assert('INT 10 → no mod',
  getNpcCraftTotal(npcB, 'Craft (armor)') === 5);

const npcC = { id: 'c', abilities: { INT: 8 }, skillRanks: {} };
assert('no ranks + INT -1 = -1',
  getNpcCraftTotal(npcC, 'Craft (weapons)') === -1);

const npcD = { id: 'd' };
assert('missing everything → 0',
  getNpcCraftTotal(npcD, 'Craft (weapons)') === 0);

assert('null npc → 0', getNpcCraftTotal(null, 'Craft (weapons)') === 0);
assert('null subSkill → 0', getNpcCraftTotal(npcA, null) === 0);

// With skillBonuses
const npcE = {
  id: 'e', abilities: { INT: 10 },
  skillRanks: { 'Craft (weapons)': 4 },
  skillBonuses: { 'Craft (weapons)': 2 },
};
assert('skillBonuses added in',
  getNpcCraftTotal(npcE, 'Craft (weapons)') === 6);

// ──────────────────────────────────────────────────────────────────
section('tickNpcCrafterProjects — deterministic take-10');

const spec = getCraftSpecByName('tindertwig', craftableItemsData);
const startRes = startCraftProject(spec, { itemName: 'tindertwig' });
assert('setup: project starts', startRes.ok === true);

// Alchemy DC is typically 20 — need enough skill for take-10 to succeed
const crafter = {
  id: 'smith-1', name: 'Smith', abilities: { INT: 14 },
  skillRanks: { [spec.subSkill]: 12 },
  craftProjects: [startRes.project],
};

const tick1 = tickNpcCrafterProjects(crafter, 1, { take10: true });
assert('returns {npc, events, completions}',
  tick1.npc && Array.isArray(tick1.events) && Array.isArray(tick1.completions));
assert('project list preserved length',
  tick1.npc.craftProjects.length === 1);
const p1 = tick1.npc.craftProjects[0];
assert('progress advanced', p1.progressSP > 0);
assert('history grew', p1.history.length === 1);
assert('lastTickAt set', !!tick1.npc.craftLastTickAt);

// ──────────────────────────────────────────────────────────────────
section('tickNpcCrafterProjects — multi-week advance completes cheap item');

const cheap = startCraftProject(spec, { itemName: 'tindertwig' }).project;
const crafter2 = { ...crafter, craftProjects: [cheap] };
const many = tickNpcCrafterProjects(crafter2, 20, { take10: true });
const completed = many.npc.craftProjects[0];
assert('multi-week tick runs', many.npc.craftProjects.length === 1);
assert('tindertwig eventually completes',
  completed.status === 'completed' || completed.progressSP >= completed.priceSP);
assert('completion event emitted',
  many.events.some((e) => e.kind === 'complete'));
assert('completions array populated',
  many.completions.length >= 1);
assert('completion record has crafterNpcId',
  many.completions[0].crafterNpcId === 'smith-1');
assert('completion record has itemName',
  many.completions[0].itemName === 'tindertwig');

// ──────────────────────────────────────────────────────────────────
section('tickNpcCrafterProjects — commission flag propagated');

const commProject = startCraftProject(spec, {
  itemName: 'tindertwig', commissionedBy: 'pc-7',
}).project;
const commCrafter = { ...crafter, craftProjects: [commProject] };
const commTick = tickNpcCrafterProjects(commCrafter, 20, { take10: true });
const commComplete = commTick.completions[0];
assert('commissionedBy passthrough in completion',
  commComplete?.commissionedBy === 'pc-7');

// ──────────────────────────────────────────────────────────────────
section('tickNpcCrafterProjects — guard clauses');

const noProj = tickNpcCrafterProjects({ id: 'x' }, 1);
assert('no craftProjects → empty events',
  noProj.events.length === 0 && noProj.completions.length === 0);

const zeroWeeks = tickNpcCrafterProjects(crafter, 0);
assert('0 weeks → no-op', zeroWeeks.events.length === 0);

const pausedProj = { ...startCraftProject(spec, { itemName: 'tindertwig' }).project, status: 'paused' };
const pausedTick = tickNpcCrafterProjects(
  { ...crafter, craftProjects: [pausedProj] }, 5, { take10: true },
);
assert('paused project does not advance',
  pausedTick.npc.craftProjects[0].progressSP === 0);

// ──────────────────────────────────────────────────────────────────
section('tickNPCCrafters — array roster');

const roster = [
  { ...crafter, id: 'c1', craftProjects: [startCraftProject(spec, { itemName: 'tindertwig' }).project] },
  { ...crafter, id: 'c2', craftProjects: [startCraftProject(spec, { itemName: 'tindertwig' }).project] },
];
const rosterTick = tickNPCCrafters(roster, 1, { take10: true });
assert('array roster preserves array shape', Array.isArray(rosterTick.npcs));
assert('array length preserved', rosterTick.npcs.length === 2);
assert('events aggregated', rosterTick.events.length >= 2);
assert('both crafters advanced',
  rosterTick.npcs.every((n) => n.craftProjects[0].progressSP > 0));

// ──────────────────────────────────────────────────────────────────
section('tickNPCCrafters — map roster');

const mapRoster = {
  'c1': { ...crafter, id: 'c1', craftProjects: [startCraftProject(spec, { itemName: 'tindertwig' }).project] },
  'c2': { ...crafter, id: 'c2', craftProjects: [startCraftProject(spec, { itemName: 'tindertwig' }).project] },
};
const mapTick = tickNPCCrafters(mapRoster, 1, { take10: true });
assert('map roster returns map', typeof mapTick.npcs === 'object' && !Array.isArray(mapTick.npcs));
assert('map roster preserves keys',
  'c1' in mapTick.npcs && 'c2' in mapTick.npcs);
assert('map values progressed',
  mapTick.npcs.c1.craftProjects[0].progressSP > 0);

// ──────────────────────────────────────────────────────────────────
section('tickNPCCrafters — null input');

const nullTick = tickNPCCrafters(null, 1);
assert('null → no-op with empty events',
  nullTick.events.length === 0);

// ──────────────────────────────────────────────────────────────────
section('getActiveCrafters + hoursToWeeks');

assert('getActiveCrafters filters to npcs with in-progress projects',
  getActiveCrafters(roster).length === 2);
assert('getActiveCrafters handles map',
  getActiveCrafters(mapRoster).length === 2);
assert('hoursToWeeks: 168h = 1 week',
  hoursToWeeks(168) === 1);
assert('hoursToWeeks: 336h = 2 weeks',
  hoursToWeeks(336) === 2);
assert('hoursToWeeks: 100h = 0 weeks (floor)',
  hoursToWeeks(100) === 0);

// ──────────────────────────────────────────────────────────────────
section('applyCraftDeedsToNpcs — multiple events on same NPC accumulate (bug 2 regression)');

// An NPC with two events in one tick: material-loss then complete.
// Before fix: second setNpc spread the ORIGINAL npc, wiping the first deed.
// After fix: deeds accumulate via evolving `next`.
const rep0 = createReputation();
const deedNpc = {
  id: 'smith-01',
  reputation: rep0,
  craftProjects: [
    {
      id: 'proj-1',
      itemName: 'longsword',
      commissionedBy: null,
      masterworkable: false,
      masterwork: null,
      status: 'completed',
    },
  ],
};
const npcsIn = [deedNpc];
const events = [
  { kind: 'material-loss', npcId: 'smith-01', projectId: 'proj-1' },
  { kind: 'complete', npcId: 'smith-01', projectId: 'proj-1' },
];
const npcsOut = applyCraftDeedsToNpcs(npcsIn, events);
const smith = Array.isArray(npcsOut) ? npcsOut.find((n) => n.id === 'smith-01') : npcsOut['smith-01'];
assert('smith found in output', !!smith);
const deedCount = Array.isArray(smith?.reputation?.deeds)
  ? smith.reputation.deeds.length
  : 0;
assert('smith has 2 deeds after 2 events (was 1 before fix)', deedCount === 2);
const deedKeys = (smith?.reputation?.deeds || []).map((d) => d.key || d.deedKey || d);
assert('deeds include both material-loss and completion keys',
  deedKeys.length === 2);

// ──────────────────────────────────────────────────────────────────
section('tickPCCrafters — advances PC craft projects');

const tindSpec = getCraftSpecByName('tindertwig', craftableItemsData);
const tindProj = startCraftProject(tindSpec, { itemName: 'tindertwig' }).project;
const pcChar = {
  id: 'pc-1',
  name: 'Lem',
  abilities: { INT: 14 },
  skillRanks: { 'Craft (alchemy)': 5 },
  craftProjects: [tindProj],
};
// PC total = 5 ranks + 2 INT = 7; take-10 = 17. DC 20 → fail.
// Bump ranks to make it succeed.
const pcCharGood = { ...pcChar, skillRanks: { 'Craft (alchemy)': 12 } };
// PC total = 12 + 2 = 14; take-10 = 24 ≥ DC 20. Progress = 24×20 = 480sp.
// Tindertwig priceSP = 10sp → completes week 1.
const pcResult = tickPCCrafters([pcCharGood], 1, { take10: true });
assert('tickPCCrafters returns party array', Array.isArray(pcResult.party));
assert('PC project advanced', pcResult.party[0].craftProjects[0].progressSP > 0);
assert('PC project completed', pcResult.party[0].craftProjects[0].status === 'completed');
assert('completion event emitted', pcResult.completions.length === 1);
assert('completion has characterId', pcResult.completions[0].characterId === 'pc-1');

// getPCCraftTotal — basic (now includes class-skill +3)
// 12 ranks + 2 INT + 3 class-skill = 17
assert('getPCCraftTotal basic (ranks+INT+classSkill)',
  getPCCraftTotal(pcCharGood, 'Craft (alchemy)') === 17);
assert('getPCCraftTotal null char', getPCCraftTotal(null, 'Craft (alchemy)') === 0);

// ──────────────────────────────────────────────────────────────────
section('getPCCraftTotal — class-skill +3');

const pcNoRanks = { id: 'pc-z', abilities: { INT: 14 }, skillRanks: {} };
assert('0 ranks → no class-skill bonus (untrained)',
  getPCCraftTotal(pcNoRanks, 'Craft (weapons)') === 2); // just INT mod

const pc1Rank = { id: 'pc-r', abilities: { INT: 10 }, skillRanks: { 'Craft (armor)': 1 } };
assert('1 rank → class-skill +3 (Craft is class skill for all core classes)',
  getPCCraftTotal(pc1Rank, 'Craft (armor)') === 4); // 1 + 0 + 3

// With explicit classSkillsList override that EXCLUDES the PC's class
const pcFighter = { id: 'pc-f', class: 'Fighter', abilities: { INT: 10 }, skillRanks: { 'Craft (weapons)': 3 } };
assert('explicit classSkillsList including class → +3',
  getPCCraftTotal(pcFighter, 'Craft (weapons)', { classSkillsList: ['Fighter', 'Rogue'] }) === 6); // 3+0+3
assert('explicit classSkillsList excluding class → no +3',
  getPCCraftTotal(pcFighter, 'Craft (weapons)', { classSkillsList: ['Wizard'] }) === 3); // 3+0+0

// ──────────────────────────────────────────────────────────────────
section('getPCCraftTotal — racial bonus');

const pcGnome = {
  id: 'pc-g', abilities: { INT: 12 },
  skillRanks: { 'Craft (alchemy)': 4 },
  racialSkillBonuses: { 'Craft (alchemy)': 2 },
};
// 4 ranks + 1 INT + 3 class-skill + 2 racial = 10
assert('gnome +2 racial on Craft (alchemy)',
  getPCCraftTotal(pcGnome, 'Craft (alchemy)') === 10);

const pcGnomeNoRanks = {
  id: 'pc-g2', abilities: { INT: 10 },
  skillRanks: {},
  racialSkillBonuses: { 'Craft (jewelry)': 2 },
};
// 0 ranks + 0 INT + 0 class-skill + 2 racial = 2
assert('racial bonus applies even untrained',
  getPCCraftTotal(pcGnomeNoRanks, 'Craft (jewelry)') === 2);

// ──────────────────────────────────────────────────────────────────
section('getPCCraftTotal — Skill Focus feat');

const pcSF = {
  id: 'pc-sf', abilities: { INT: 10 },
  skillRanks: { 'Craft (weapons)': 5 },
  feats: ['Power Attack', 'Skill Focus (Craft (weapons))'],
};
// 5 ranks + 0 INT + 3 class-skill + 3 Skill Focus = 11
assert('Skill Focus +3 (under 10 ranks)',
  getPCCraftTotal(pcSF, 'Craft (weapons)') === 11);

const pcSF10 = {
  id: 'pc-sf10', abilities: { INT: 10 },
  skillRanks: { 'Craft (weapons)': 12 },
  feats: ['Skill Focus (Craft (weapons))'],
};
// 12 ranks + 0 INT + 3 class-skill + 6 Skill Focus = 21
assert('Skill Focus +6 (10+ ranks)',
  getPCCraftTotal(pcSF10, 'Craft (weapons)') === 21);

const pcSFWrongSkill = {
  id: 'pc-sf-w', abilities: { INT: 10 },
  skillRanks: { 'Craft (armor)': 5 },
  feats: ['Skill Focus (Craft (weapons))'],
};
// 5 ranks + 0 INT + 3 class-skill + 0 (wrong sub-skill) = 8
assert('Skill Focus on different sub-skill → no bonus',
  getPCCraftTotal(pcSFWrongSkill, 'Craft (armor)') === 8);

const pcNoFeats = {
  id: 'pc-nf', abilities: { INT: 10 },
  skillRanks: { 'Craft (weapons)': 5 },
  feats: [],
};
assert('empty feats → no Skill Focus bonus',
  getPCCraftTotal(pcNoFeats, 'Craft (weapons)') === 8); // 5+0+3

const pcNullFeats = {
  id: 'pc-nuf', abilities: { INT: 10 },
  skillRanks: { 'Craft (weapons)': 5 },
};
assert('undefined feats → no crash',
  getPCCraftTotal(pcNullFeats, 'Craft (weapons)') === 8);

// ──────────────────────────────────────────────────────────────────
section('getPCCraftTotal — all bonuses stacking');

const pcFullStack = {
  id: 'pc-all', class: 'Fighter', abilities: { INT: 14 },
  skillRanks: { 'Craft (weapons)': 8 },
  racialSkillBonuses: { 'Craft (weapons)': 2 },
  skillBonuses: { 'Craft (weapons)': 1 },
  feats: ['Skill Focus (Craft (weapons))'],
};
// 8 ranks + 2 INT + 3 class-skill + 2 racial + 3 Skill Focus + 1 misc = 19
assert('full stack: ranks+INT+classSkill+racial+skillFocus+misc',
  getPCCraftTotal(pcFullStack, 'Craft (weapons)') === 19);

// Null/empty party → safe passthrough
const emptyResult = tickPCCrafters([], 1);
assert('empty party → empty', emptyResult.party.length === 0 && emptyResult.events.length === 0);
const nullResult = tickPCCrafters(null, 1);
assert('null party → safe', Array.isArray(nullResult.party));

// ──────────────────────────────────────────────────────────────────
section('falchion is martial (CRB audit data fix)');

const falchSpec = getCraftSpecByName('falchion', craftableItemsData);
assert('falchion craftable', falchSpec?.craftable === true);
assert('falchion DC is 15 (martial), not 18 (exotic)', falchSpec?.dc === 15);

// ──────────────────────────────────────────────────────────────────
console.log(`\n✓ Passed: ${pass}, ✗ Failed: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
