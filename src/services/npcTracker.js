/**
 * NPC Tracker
 *
 * Generates, stores, and manages NPCs the party encounters.
 * Each NPC has stats, personality, appearance, and disposition.
 */

import { db } from '../db/database';
import { roll } from '../utils/dice';
import { pickValidNPCFeats } from '../utils/featPrereqs';
import { deriveFamiliarStats, getFamiliarById } from '../utils/familiarEngine';
import { recordFactionsFromNPC } from './factionTracker';
import { getActiveCampaignDataId } from './campaignScope';
import { emitJournalAdd } from './journalEvents';
import {
  defaultEmotionalState,
  generateGoal,
  generateKnowledge,
  calculateCourage,
} from './npcPersonality.js';
// Bug #31: narrative-driven area items. When we have a DM narration in
// hand, the extractor pulls scene objects the DM actually mentioned and
// we prefer those over the random-pool templates below.
import { extractAreaItemsFromNarrative } from './areaItemExtraction.js';
// Bug #50: narrative-driven NPC population mirrors the areaItems path. When
// the DM just mentioned a named speaker, we pull their NPC record off the
// same narration chunk the area-items extractor is reading.
import { extractNPCsFromNarration, isAppearanceDescriptor } from './npcExtraction.js';
import { traceEngine } from './engineTrace.js';

// Deception tendency weights per personality — mirrors dmToolsService.PERSONALITY_DECEPTION_MAP
const DECEPTION_WEIGHTS = {
  cunning:      { honest: 5,  evasive: 25, manipulative: 55, compulsive: 15 },
  secretive:    { honest: 10, evasive: 50, manipulative: 30, compulsive: 10 },
  greedy:       { honest: 10, evasive: 20, manipulative: 55, compulsive: 15 },
  paranoid:     { honest: 15, evasive: 45, manipulative: 25, compulsive: 15 },
  kind:         { honest: 65, evasive: 25, manipulative: 5,  compulsive: 5  },
  pious:        { honest: 55, evasive: 30, manipulative: 10, compulsive: 5  },
  noble:        { honest: 50, evasive: 30, manipulative: 15, compulsive: 5  },
  jovial:       { honest: 40, evasive: 30, manipulative: 15, compulsive: 15 },
  gruff:        { honest: 40, evasive: 35, manipulative: 15, compulsive: 10 },
  nervous:      { honest: 30, evasive: 40, manipulative: 10, compulsive: 20 },
  boisterous:   { honest: 35, evasive: 15, manipulative: 20, compulsive: 30 },
  melancholy:   { honest: 40, evasive: 40, manipulative: 10, compulsive: 10 },
  stern:        { honest: 45, evasive: 35, manipulative: 15, compulsive: 5  },
  'absent-minded': { honest: 50, evasive: 20, manipulative: 5, compulsive: 25 },
  flirtatious:  { honest: 20, evasive: 25, manipulative: 35, compulsive: 20 },
  sarcastic:    { honest: 30, evasive: 35, manipulative: 20, compulsive: 15 },
  suspicious:   { honest: 25, evasive: 45, manipulative: 20, compulsive: 10 },
};
function rollDeceptionTendency(personality) {
  const weights = DECEPTION_WEIGHTS[(personality || '').toLowerCase()]
    || { honest: 30, evasive: 30, manipulative: 25, compulsive: 15 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [tendency, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return tendency;
  }
  return 'honest';
}
import ethnicitiesData from '../data/ethnicities.json';
import heritagesData from '../data/heritages.json';
import featsData from '../data/feats.json';
import familiarsData from '../data/familiars.json';
import traitsData from '../data/traits.json';

// ── Phase 7.8: NPC Familiar Assignment ──
// Base familiar IDs — no Improved Familiars for NPCs unless feats justify it.
const BASE_FAMILIAR_IDS = (familiarsData.baseFamiliars || []).map(f => f.id);

/**
 * Roll an arcane bond for a Wizard or Witch NPC.
 *
 * PF1e CRB p. 78: Wizard may choose either a familiar OR a bonded object.
 * Witch (APG): always receives a patron familiar.
 *
 * Returns { arcaneBond: 'familiar'|'bondedObject', familiar: {id}|null }
 */
function rollNPCArcaneBond(npcClass) {
  if (npcClass === 'Witch') {
    // Witches always have a familiar.
    const id = BASE_FAMILIAR_IDS[Math.floor(Math.random() * BASE_FAMILIAR_IDS.length)];
    return { arcaneBond: 'familiar', familiar: { id } };
  }
  if (npcClass === 'Wizard') {
    // ~60% familiar / ~40% bonded object (both RAW-legal Arcane Bond).
    if (Math.random() < 0.6) {
      const id = BASE_FAMILIAR_IDS[Math.floor(Math.random() * BASE_FAMILIAR_IDS.length)];
      return { arcaneBond: 'familiar', familiar: { id } };
    }
    return { arcaneBond: 'bondedObject', familiar: null };
  }
  // Not a familiar-granting class.
  return { arcaneBond: null, familiar: null };
}

// ── Name Pools ──
const FIRST_NAMES_M = ['Aldric','Belor','Caius','Dorian','Egan','Falk','Garret','Harsk','Ivar','Jasper','Kael','Lorian','Magnus','Nolam','Orik','Pavel','Quinlan','Roran','Shalelu','Toren','Ulric','Vosk','Warrel','Xander','Yorick','Zantus'];
const FIRST_NAMES_F = ['Ameiko','Brielle','Calista','Dara','Elara','Fiora','Gwynn','Hana','Ilsa','Jade','Kestra','Lini','Merisiel','Nadia','Oona','Penelope','Quinn','Roxanne','Seoni','Tanis','Uma','Valeria','Wren','Ximena','Yara','Zelara'];
const LAST_NAMES = ['Blackwood','Ironforge','Stoneheart','Ravenglass','Thornwall','Ashford','Brightwater','Coldmoor','Darkholme','Embervane','Foxglove','Greenhill','Hawkwind','Icemere','Jasperion','Kaijitsu','Longbottom','Moonwhisper','Nightingale','Oakshield','Proudfoot','Quillwright','Redthorn','Shadowmend','Truegold','Underhill','Valorian','Winterborn','Yarrow','Zoltan'];

const RACES = ['Human','Human','Human','Human','Elf','Half-Elf','Dwarf','Halfling','Gnome','Half-Orc','Tiefling','Aasimar'];
const NPC_CLASSES = ['Commoner','Expert','Warrior','Aristocrat','Adept','Fighter','Rogue','Cleric','Wizard','Ranger','Bard','Sorcerer','Monk','Paladin','Druid','Alchemist','Witch'];
const DISPOSITIONS = ['friendly','neutral','wary','hostile','fearful','curious','amused','suspicious'];
const PERSONALITY_TRAITS = ['gruff','jovial','nervous','cunning','pious','greedy','kind','secretive','boisterous','melancholy','stern','absent-minded','flirtatious','paranoid','noble','sarcastic'];
const OCCUPATIONS = ['merchant','blacksmith','innkeeper','guard','farmer','priest','scholar','thief','sailor','hunter','herbalist','bard','beggar','noble','fisherman','miner','carpenter','brewer','tailor','soldier'];

const HAIR_COLORS = ['black','brown','auburn','blonde','red','silver','white','gray'];
const HAIR_STYLES = ['long','short','braided','shaved','curly','straight','tied back','wild'];
const EYE_COLORS = ['brown','blue','green','gray','hazel','amber','violet','black'];
const BUILD = ['thin','stocky','muscular','heavyset','lean','average','willowy','broad-shouldered'];
const DISTINGUISHING = ['a scar across the cheek','a missing finger','a prominent tattoo','an eyepatch','unusually tall','remarkably short','a limp','a booming laugh','a quiet voice','freckles everywhere','a crooked nose','burn marks on the hands','an elaborate mustache','piercing gaze','calloused hands','a nervous tic'];

// ── Regional Ethnicity Weights ──
// Maps location keywords to weighted ethnicity distributions.
// Higher number = more common in that area. Unlisted ethnicities get weight 1 (rare traveler).
const REGIONAL_ETHNICITY_WEIGHTS = {
  // Varisia (Sandpoint, Magnimar, Riddleport, Korvosa)
  'sandpoint': { Varisian: 30, Chelaxian: 25, Shoanti: 15, Tian: 5, Ulfen: 5, Taldan: 3, Garundi: 2, Keleshite: 2, Vudrani: 2 },
  'magnimar': { Varisian: 25, Chelaxian: 20, Shoanti: 10, Taldan: 10, Tian: 5, Ulfen: 5, Garundi: 3, Keleshite: 3, Vudrani: 3, Mwangi: 2 },
  'riddleport': { Varisian: 20, Chelaxian: 15, Ulfen: 15, Shoanti: 8, Tian: 5, Taldan: 5, Keleshite: 5, Garundi: 3 },
  'korvosa': { Chelaxian: 35, Varisian: 20, Shoanti: 10, Taldan: 8, Garundi: 3, Keleshite: 3, Tian: 2 },
  'varisia': { Varisian: 30, Chelaxian: 20, Shoanti: 15, Taldan: 5, Ulfen: 5, Tian: 4, Garundi: 2, Keleshite: 2 },

  // Cheliax and neighbors
  'cheliax': { Chelaxian: 50, Taldan: 10, Nidalese: 5, Garundi: 3, Keleshite: 3, Varisian: 3 },
  'nidal': { Nidalese: 45, Chelaxian: 15, Varisian: 5, Taldan: 3, Kellid: 2 },
  'isger': { Chelaxian: 30, Taldan: 15, Kellid: 10, Varisian: 5, Garundi: 3 },

  // Northern regions
  'irrisen': { Jadwiga: 30, Ulfen: 30, Kellid: 10, Varki: 5, Taldan: 2 },
  'linnorm': { Ulfen: 50, Kellid: 10, Varki: 5, Shoanti: 3, Jadwiga: 3 },
  'numeria': { Kellid: 45, Ulfen: 10, Shoanti: 5, Taldan: 3, Garundi: 2 },
  'mendev': { Kellid: 25, Taldan: 15, Chelaxian: 10, Garundi: 5, Ulfen: 5, Mwangi: 3 },

  // Southern and central Avistan
  'taldor': { Taldan: 45, Chelaxian: 15, Keleshite: 8, Garundi: 5, Varisian: 3 },
  'andoran': { Chelaxian: 25, Taldan: 25, Keleshite: 5, Garundi: 5, Varisian: 3, Mwangi: 3 },
  'absalom': { Taldan: 15, Chelaxian: 15, Keleshite: 12, Garundi: 12, Varisian: 8, Tian: 5, Mwangi: 5, Vudrani: 5, Ulfen: 3, Azlanti: 2 },
  'lastwall': { Taldan: 25, Chelaxian: 15, Kellid: 10, Garundi: 5, Ulfen: 5 },
  'ustalav': { Varisian: 20, Kellid: 20, Chelaxian: 15, Taldan: 10, Nidalese: 5 },

  // Garund
  'osirion': { Garundi: 50, Keleshite: 15, Mwangi: 5, Taldan: 5, Vudrani: 3 },
  'katapesh': { Keleshite: 30, Garundi: 20, Mwangi: 10, Vudrani: 5, Taldan: 5 },
  'mwangi': { Mwangi: 25, Zenj: 20, Bekyar: 15, Bonuwat: 10, Garundi: 5, Keleshite: 3 },
  'shackles': { Bonuwat: 20, Mwangi: 15, Chelaxian: 10, Varisian: 10, Garundi: 8, Ulfen: 5, Keleshite: 5 },
  'thuvia': { Garundi: 35, Keleshite: 20, Mwangi: 10, Taldan: 5, Vudrani: 3 },

  // Eastern
  'qadira': { Keleshite: 50, Garundi: 10, Taldan: 8, Vudrani: 8, Mwangi: 3 },
  'vudra': { Vudrani: 55, Keleshite: 10, Tian: 5, Garundi: 3 },
  'tian xia': { Tian: 55, Vudrani: 5, Keleshite: 3 },

  // Underground
  'darklands': { Kellid: 10, Shoanti: 5, Garundi: 3 },

  // Worldwound
  'worldwound': { Kellid: 30, Mendevian: 15, Taldan: 10, Chelaxian: 5, Garundi: 5 },

  // Default for unknown locations — cosmopolitan mix
  '_default': { Chelaxian: 12, Varisian: 12, Taldan: 10, Shoanti: 8, Garundi: 6, Keleshite: 6, Ulfen: 5, Kellid: 5, Tian: 4, Mwangi: 4, Vudrani: 3, Nidalese: 2, Jadwiga: 1, Varki: 1, Bonuwat: 1, Bekyar: 1, Zenj: 1, Azlanti: 1 },
};

// Non-human race weights by region — determines which non-human races appear more commonly
const REGIONAL_RACE_WEIGHTS = {
  'sandpoint': { Human: 65, Halfling: 8, 'Half-Elf': 6, Elf: 5, Dwarf: 4, Gnome: 3, 'Half-Orc': 3, Goblin: 2, Aasimar: 1, Tiefling: 1, Kitsune: 1, Tengu: 1 },
  'magnimar': { Human: 55, Halfling: 8, 'Half-Elf': 8, Elf: 6, Dwarf: 5, Gnome: 4, 'Half-Orc': 4, Aasimar: 2, Tiefling: 2, Tian: 2, Tengu: 2, Catfolk: 1, Ratfolk: 1 },
  'korvosa': { Human: 60, Halfling: 8, 'Half-Elf': 6, Elf: 5, Dwarf: 5, Gnome: 4, 'Half-Orc': 3, Tiefling: 3, Aasimar: 2 },
  'cheliax': { Human: 60, Halfling: 10, Tiefling: 8, 'Half-Orc': 4, Gnome: 4, Dwarf: 3, 'Half-Elf': 3, Elf: 2, Aasimar: 2, Changeling: 1, Dhampir: 1 },
  'absalom': { Human: 45, Halfling: 8, 'Half-Elf': 8, Elf: 7, Dwarf: 6, Gnome: 5, 'Half-Orc': 5, Aasimar: 3, Tiefling: 3, Tengu: 2, Ratfolk: 2, Catfolk: 2, Kitsune: 1, Fetchling: 1, Undine: 1, Ifrit: 1 },
  'darklands': { Dwarf: 15, Duergar: 15, Svirfneblin: 15, Orc: 12, Kobold: 10, Goblin: 8, 'Half-Orc': 5, Ratfolk: 5, Fetchling: 5, Wayang: 5, Human: 5 },
  'irrisen': { Human: 55, Changeling: 10, Dwarf: 5, Elf: 5, 'Half-Orc': 5, Gnome: 5, Halfling: 5, Dhampir: 3, Fetchling: 3, Sylph: 2, Oread: 2 },
  'mwangi': { Human: 50, Catfolk: 10, Elf: 8, 'Half-Orc': 6, Halfling: 5, Gnome: 4, 'Half-Elf': 4, Nagaji: 3, Aasimar: 2, Tengu: 2, Tiefling: 2, Changeling: 2, Goblin: 2 },
  'tian xia': { Human: 50, Kitsune: 10, Tengu: 8, Nagaji: 8, Wayang: 5, 'Half-Elf': 4, Elf: 3, Aasimar: 3, Tiefling: 2, Catfolk: 2, Ratfolk: 2, Dhampir: 1, Samsaran: 1, Changeling: 1 },
  'qadira': { Human: 60, Halfling: 8, Gnome: 5, 'Half-Orc': 5, 'Half-Elf': 4, Dwarf: 3, Elf: 3, Ifrit: 3, Catfolk: 2, Aasimar: 2, Tiefling: 2, Ratfolk: 2, Undine: 1 },
  '_default': { Human: 60, Halfling: 7, 'Half-Elf': 6, Elf: 5, Dwarf: 5, Gnome: 4, 'Half-Orc': 4, Aasimar: 2, Tiefling: 2, Goblin: 1, Tengu: 1, Catfolk: 1, Kitsune: 1, Ratfolk: 1 },
};

/**
 * Pick a random item from a weighted distribution.
 * @param {Object} weights - e.g. { Varisian: 30, Chelaxian: 25, ... }
 * @returns {string} The selected key
 */
function weightedRandom(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/**
 * Find the best matching regional weights for a given location string.
 * Prefers data-driven demographics from homelands in ethnicities.json.
 * Falls back to hardcoded REGIONAL_*_WEIGHTS tables, then to _default.
 * @param {string} location - Location string (e.g. "Sandpoint", "near Magnimar")
 * @param {string} type - 'ethnicities' or 'races'
 * @returns {Object} Weight map e.g. { Varisian: 30, Chelaxian: 25, ... }
 */
function getRegionalWeightsFromData(location, type) {
  if (!location) return null;
  const loc = location.toLowerCase();
  // Search homelands in ethnicities.json for a match
  const homelands = ethnicitiesData.homelands || [];
  for (const homeland of homelands) {
    if (homeland.demographics && homeland.demographics[type]) {
      const name = (homeland.name || '').toLowerCase();
      if (loc.includes(name) || name.includes(loc)) {
        return homeland.demographics[type];
      }
    }
  }
  // Also try matching by region
  for (const homeland of homelands) {
    if (homeland.demographics && homeland.demographics[type]) {
      const region = (homeland.region || '').toLowerCase();
      if (loc.includes(region) || region.includes(loc)) {
        return homeland.demographics[type];
      }
    }
  }
  return null;
}

/**
 * Find the best matching regional weights for a given location string.
 * Tries data-driven homelands first, then hardcoded tables, then _default.
 */
function getRegionalWeights(location, weightMap) {
  if (!location) return weightMap['_default'] || {};
  const loc = location.toLowerCase();

  // Try hardcoded key match
  for (const key of Object.keys(weightMap)) {
    if (key === '_default') continue;
    if (loc.includes(key)) return weightMap[key];
  }
  // Try broader region matches
  if (loc.includes('varis') || loc.includes('lost coast')) return weightMap['varisia'] || weightMap['_default'];
  if (loc.includes('chelax') || loc.includes('egorian')) return weightMap['cheliax'] || weightMap['_default'];
  if (loc.includes('osiri') || loc.includes('sothis')) return weightMap['osirion'] || weightMap['_default'];
  if (loc.includes('linnorm') || loc.includes('kalsgard')) return weightMap['linnorm'] || weightMap['_default'];
  if (loc.includes('taldor') || loc.includes('oppara')) return weightMap['taldor'] || weightMap['_default'];
  if (loc.includes('andor') || loc.includes('almas')) return weightMap['andoran'] || weightMap['_default'];
  if (loc.includes('ustala') || loc.includes('caliphas')) return weightMap['ustalav'] || weightMap['_default'];
  if (loc.includes('qadira') || loc.includes('katheer')) return weightMap['qadira'] || weightMap['_default'];
  return weightMap['_default'] || {};
}

// ── NPC Trait/Drawback Generation ──
// Trait categories available for NPC selection (exclude regional — those are PC-specific adventure path traits)
const NPC_TRAIT_CATEGORIES = ['combat', 'magic', 'social', 'faith'];
const NPC_DRAWBACK_LIST = traitsData.filter(t => t.type === 'drawback');
const NPC_TRAIT_LIST = traitsData.filter(t => NPC_TRAIT_CATEGORIES.includes(t.type));

// Class-to-trait-category affinities: which categories an NPC class tends toward
const CLASS_TRAIT_AFFINITIES = {
  Fighter: ['combat', 'combat'], Warrior: ['combat', 'combat'], Ranger: ['combat', 'faith'],
  Paladin: ['faith', 'combat'], Monk: ['faith', 'combat'], Barbarian: ['combat', 'social'],
  Rogue: ['social', 'combat'], Bard: ['social', 'magic'], Sorcerer: ['magic', 'social'],
  Wizard: ['magic', 'magic'], Cleric: ['faith', 'magic'], Druid: ['faith', 'magic'],
  Witch: ['magic', 'social'], Alchemist: ['magic', 'combat'], Adept: ['faith', 'magic'],
  Commoner: ['social', 'faith'], Expert: ['social', 'magic'], Aristocrat: ['social', 'social'],
  Soldier: ['combat', 'combat'],
};

/**
 * Pick NPC traits weighted by class affinity. Returns { characterTraits: string[], drawback: string }
 */
function generateNPCTraits(npcClass, level) {
  // Higher-level NPCs are more likely to have traits — commoners below lvl 2 rarely do
  const traitChance = npcClass === 'Commoner' ? 0.2 : npcClass === 'Expert' ? 0.5 : 0.7;
  if (Math.random() > traitChance) return { characterTraits: [], drawback: '' };

  const affinities = CLASS_TRAIT_AFFINITIES[npcClass] || ['social', 'combat'];
  const traits = [];
  const usedCategories = new Set();

  // Pick 2 traits from different categories, preferring affinity categories
  for (let i = 0; i < 2; i++) {
    // 60% chance to use affinity category, 40% random
    let targetCat = Math.random() < 0.6 ? affinities[i] : NPC_TRAIT_CATEGORIES[Math.floor(Math.random() * NPC_TRAIT_CATEGORIES.length)];
    if (usedCategories.has(targetCat)) {
      // Pick a different category
      const available = NPC_TRAIT_CATEGORIES.filter(c => !usedCategories.has(c));
      if (available.length === 0) break;
      targetCat = available[Math.floor(Math.random() * available.length)];
    }
    const pool = NPC_TRAIT_LIST.filter(t => t.type === targetCat);
    if (pool.length > 0) {
      const trait = pool[Math.floor(Math.random() * pool.length)];
      traits.push(trait.name);
      usedCategories.add(targetCat);
    }
  }

  // 20% chance of having a drawback (and thus potentially a 3rd trait)
  let drawback = '';
  if (traits.length >= 2 && Math.random() < 0.2) {
    const db = NPC_DRAWBACK_LIST[Math.floor(Math.random() * NPC_DRAWBACK_LIST.length)];
    drawback = db.name;
    // Add a 3rd trait from an unused category
    const availableCats = NPC_TRAIT_CATEGORIES.filter(c => !usedCategories.has(c));
    if (availableCats.length > 0) {
      const thirdCat = availableCats[Math.floor(Math.random() * availableCats.length)];
      const pool = NPC_TRAIT_LIST.filter(t => t.type === thirdCat);
      if (pool.length > 0) {
        traits.push(pool[Math.floor(Math.random() * pool.length)].name);
      }
    }
  }

  return { characterTraits: traits, drawback };
}

// ── Generate a Random NPC ──
export function generateNPC(options = {}) {
  const isFemale = Math.random() < 0.5;
  const firstName = options.name || (isFemale
    ? FIRST_NAMES_F[Math.floor(Math.random() * FIRST_NAMES_F.length)]
    : FIRST_NAMES_M[Math.floor(Math.random() * FIRST_NAMES_M.length)]);
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const name = options.name || `${firstName} ${lastName}`;

  // Use location-weighted race selection — try data-driven first, then hardcoded fallback
  const locationForWeights = options.location || '';
  const race = options.race || (() => {
    // Try data-driven demographics from homelands
    const dataWeights = getRegionalWeightsFromData(locationForWeights, 'races');
    if (dataWeights && Object.keys(dataWeights).length > 0) return weightedRandom(dataWeights);
    // Fall back to hardcoded tables
    const raceWeights = getRegionalWeights(locationForWeights, REGIONAL_RACE_WEIGHTS);
    return Object.keys(raceWeights).length > 0 ? weightedRandom(raceWeights) : RACES[Math.floor(Math.random() * RACES.length)];
  })();
  const npcClass = options.class || NPC_CLASSES[Math.floor(Math.random() * NPC_CLASSES.length)];
  const level = options.level || Math.max(1, Math.min(10, Math.floor(Math.random() * 5) + 1));
  const occupation = options.occupation || OCCUPATIONS[Math.floor(Math.random() * OCCUPATIONS.length)];
  const disposition = options.disposition || DISPOSITIONS[Math.floor(Math.random() * DISPOSITIONS.length)];
  const personality = options.personality || PERSONALITY_TRAITS[Math.floor(Math.random() * PERSONALITY_TRAITS.length)];

  // Simple stats based on class
  const isWarrior = ['Fighter','Warrior','Ranger','Paladin','Monk','Soldier'].includes(npcClass);
  const isCaster = ['Wizard','Sorcerer','Cleric','Druid','Witch','Adept','Alchemist'].includes(npcClass);

  const str = isWarrior ? 12 + roll(4) : 8 + roll(6);
  const dex = ['Rogue','Ranger','Monk'].includes(npcClass) ? 12 + roll(4) : 8 + roll(6);
  const con = 8 + roll(6);
  const int = isCaster ? 12 + roll(4) : 8 + roll(6);
  const wis = ['Cleric','Druid','Monk'].includes(npcClass) ? 12 + roll(4) : 8 + roll(6);
  const cha = ['Bard','Sorcerer','Paladin'].includes(npcClass) ? 12 + roll(4) : 8 + roll(6);

  const conMod = Math.floor((con - 10) / 2);
  const hd = isWarrior ? 10 : isCaster ? 6 : 8;
  const hp = Math.max(1, hd + conMod + (level - 1) * Math.max(1, Math.floor(hd / 2) + conMod));
  const ac = isWarrior ? 14 + Math.floor(level / 3) : 10 + Math.floor((dex - 10) / 2);

  // Appearance
  const appearance = {
    gender: isFemale ? 'female' : 'male',
    hair: `${HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)]} ${HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]}`,
    eyes: EYE_COLORS[Math.floor(Math.random() * EYE_COLORS.length)],
    build: BUILD[Math.floor(Math.random() * BUILD.length)],
    distinguishing: DISTINGUISHING[Math.floor(Math.random() * DISTINGUISHING.length)],
    age: npcClass === 'Commoner' ? 15 + Math.floor(Math.random() * 50) : 18 + Math.floor(Math.random() * 40),
  };

  // Build a description-based label for before the PCs learn the NPC's name
  const genderWord = isFemale ? 'woman' : 'man';
  const ageRange = appearance.age < 20 ? 'young' : appearance.age < 35 ? '' : appearance.age < 55 ? 'middle-aged' : 'elderly';
  const raceAdj = race === 'Human' ? '' : race.toLowerCase();
  const buildAdj = appearance.build !== 'average' ? appearance.build : '';
  const descParts = [ageRange, buildAdj, raceAdj, genderWord].filter(Boolean);
  const shortDesc = descParts.join(' ');
  // Longer first-impression text using distinguishing features
  const distinguishingText = appearance.distinguishing ? ` with ${appearance.distinguishing}` : '';
  const hairText = appearance.hair ? `, ${appearance.hair} hair` : '';
  // Phase 7.8 — Arcane Bond / familiar assignment for Wizard + Witch NPCs.
  // Bug #50 root cause: this was previously declared ~60 lines below, but
  // `bond` is already referenced inside `famFlavorText` right here — which
  // meant every generateNPC() call threw `ReferenceError: Cannot access
  // 'bond' before initialization` via the temporal dead zone. The throw
  // was swallowed by the try/catch in AdventureTab.processNewEntities,
  // leaving `nearbyNPCs` permanently empty and the Journal at 0 even when
  // the heuristic successfully extracted Cordell / Hemlock / Deverin /
  // Tobyn / etc. Declaration must land before the first reference.
  const bond = rollNPCArcaneBond(npcClass);
  // Phase 7.8 — weave familiar flavor into the first impression.
  const famFlavorText = (() => {
    if (!bond.familiar?.id) return '';
    const famEntry = getFamiliarById(bond.familiar.id);
    if (!famEntry) return '';
    // Describe by appearance, not name — per the NPC-names rule.
    const n = famEntry.name.toLowerCase();
    const article = /^[aeiou]/.test(n) ? 'an' : 'a';
    return ` ${article.charAt(0).toUpperCase() + article.slice(1)} ${n} perches nearby.`;
  })();
  const firstImpression = `A ${shortDesc}${hairText}${distinguishingText}. They look like a ${occupation}.${famFlavorText}`;

  // Ethnicity / Origin / Heritage
  let ethnicity = options.ethnicity || '';
  let origin = options.origin || '';
  let heritage = options.heritage || '';

  if (!ethnicity) {
    if (race === 'Human' && ethnicitiesData.humanEthnicities?.length > 0) {
      // Use location-weighted ethnicity selection — try data-driven first
      const dataEthWeights = getRegionalWeightsFromData(locationForWeights, 'ethnicities');
      const ethWeights = (dataEthWeights && Object.keys(dataEthWeights).length > 0) ? dataEthWeights : getRegionalWeights(locationForWeights, REGIONAL_ETHNICITY_WEIGHTS);
      if (Object.keys(ethWeights).length > 0) {
        const selectedEthName = weightedRandom(ethWeights);
        const eth = ethnicitiesData.humanEthnicities.find(e => e.name === selectedEthName);
        if (eth) {
          ethnicity = eth.name;
          if (!origin && eth.homeland) origin = eth.homeland;
        }
      }
      // Fallback to random if weighted selection didn't find a match
      if (!ethnicity) {
        const eth = ethnicitiesData.humanEthnicities[Math.floor(Math.random() * ethnicitiesData.humanEthnicities.length)];
        ethnicity = eth.name;
        if (!origin && eth.homeland) origin = eth.homeland;
      }
    } else if (ethnicitiesData.nonHumanOrigins?.[race]) {
      const origins = ethnicitiesData.nonHumanOrigins[race];
      if (origins.length > 0) {
        // Prefer origins that match or are near the current location
        const locLower = locationForWeights.toLowerCase();
        const localOrigins = origins.filter(o =>
          locLower && (o.region?.toLowerCase().includes(locLower) || locLower.includes(o.region?.toLowerCase()) || locLower.includes(o.name?.toLowerCase()))
        );
        const orig = localOrigins.length > 0
          ? localOrigins[Math.floor(Math.random() * localOrigins.length)]
          : origins[Math.floor(Math.random() * origins.length)];
        ethnicity = race;
        if (!origin) origin = orig.name;
      }
    }
  }

  if (!heritage && heritagesData[race]) {
    const raceHeritages = heritagesData[race];
    if (raceHeritages.length > 0 && Math.random() < 0.3) {
      // 30% chance of non-standard heritage
      heritage = raceHeritages[Math.floor(Math.random() * raceHeritages.length)].name;
    }
  }

  // Generate PF1e traits and optional drawback for this NPC
  const npcTraitData = generateNPCTraits(npcClass, level);

  // Generate feats using prerequisite-validated selection
  // PF1e: 1 feat at level 1, then 1 every odd level. Fighters get bonus combat feats.
  // For simplicity, NPC classes get 1 feat per 2 levels (minimum 1). Fighters/Warriors get +1.
  const baseFeatCount = Math.max(1, Math.ceil(level / 2));
  const bonusFeats = ['Fighter', 'Warrior'].includes(npcClass) ? Math.floor(level / 2) : 0;
  const totalFeatCount = baseFeatCount + bonusFeats;
  const npcStatsForFeats = {
    class: npcClass,
    level,
    race,
    abilities: { STR: str, DEX: dex, CON: con, INT: int, WIS: wis, CHA: cha },
    skillRanks: {},
    feats: [],
  };
  const npcFeats = pickValidNPCFeats(npcStatsForFeats, featsData, totalFeatCount);

  return {
    name,
    race,
    class: npcClass,
    level,
    hd: level,  // Hit Dice = NPC level (used for Demoralize / Intimidate DC = 10 + HD + Wis)
    occupation,
    disposition,
    personality,
    hp, maxHP: hp, ac,
    abilities: { STR: str, DEX: dex, CON: con, INT: int, WIS: wis, CHA: cha },
    feats: npcFeats,
    appearance,
    ethnicity,
    origin,
    heritage,
    characterTraits: npcTraitData.characterTraits,
    drawback: npcTraitData.drawback,
    // Phase 7.8 — Arcane Bond + familiar sub-field.
    // Wizard: arcaneBond = 'familiar' | 'bondedObject'; Witch: 'familiar' always.
    // Other classes: both null.
    arcaneBond: bond.arcaneBond,
    familiar: bond.familiar,
    // ── Deep Personality System ──
    deceptionTendency: options.deceptionTendency || rollDeceptionTendency(personality),
    secrets: options.secrets || [],   // Array of { topic, detail, severity: 'low'|'medium'|'high'|'critical' }
    emotionalState: options.emotionalState || defaultEmotionalState(),
    memories: options.memories || [],  // Array of { type, label, detail, pcName, timestamp, trustImpact, decaysAfterDays }
    goal: options.goal || generateGoal(occupation, personality, level),
    knowledge: options.knowledge || generateKnowledge(occupation, level, options.location || 'town'),
    courage: options.courage || null,  // Computed on-demand by calculateCourage(); null = use dynamic calc
    relationships: options.relationships || [],  // Array of { targetName, type, detail }
    // Name/identity tracking
    knownToParty: options.knownToParty || false,  // PCs don't know their name yet
    shortDesc,            // e.g. "stocky dwarven man"
    firstImpression,      // e.g. "A stocky dwarven man, braided red hair, with a missing finger. They look like a blacksmith."
    notes: '',
    metAt: new Date().toISOString(),
    location: options.location || 'Unknown',
    alive: true,
    // Bug #58 — presence tracks whether the NPC is physically in the
    // party's current scene, alive-but-elsewhere, or historical/dead.
    //   'here'       — in scene; populates nearbyNPCs panel + Talk-to.
    //   'elsewhere'  — mentioned in speech; known to party but not present.
    //   'historical' — dead or long-past; surfaces in lore journal only.
    // Default 'here' preserves legacy behavior: all existing storeNPC
    // call sites (intros, manual additions, faction hydration) assume
    // the NPC is being introduced into the current scene. The LLM
    // extractor (sceneExtractionLLM) overrides this for mentioned /
    // historical buckets so referential figures don't pollute the panel.
    presence: options.presence || 'here',
    interactions: 0,
    // CRB Ch. 4 attitude (Hostile/Unfriendly/Indifferent/Friendly/Helpful) — persists across sessions
    attitude: options.attitude || 'indifferent',
    attitudeHistory: [],  // log of past Diplomacy/Intimidate shifts
  };
}

// ── Get display name for NPC (description if unknown, name if known) ──
export function getNPCDisplayName(npc) {
  if (!npc) return 'someone';
  if (npc.knownToParty) return npc.name;
  // Use the short description as their "name" until revealed
  return npc.shortDesc ? `the ${npc.shortDesc}` : 'a stranger';
}

// ── Reveal NPC name to party (e.g. after introduction) ──
export async function revealNPCName(npcOrId) {
  const id = typeof npcOrId === 'object' ? npcOrId.id : npcOrId;
  if (id) {
    await db.encounteredNpcs.update(id, { knownToParty: true });
    // Auto-progression: learning a name is the level 0→1 trigger.
    await advanceNpcKnowledge(id, { toLevel: 1 });
  }
  // Also return updated NPC for in-memory state
  if (typeof npcOrId === 'object') {
    return { ...npcOrId, knownToParty: true };
  }
  return db.encounteredNpcs.get(id);
}

// ── Build NPC description for DM narration prompt ──
export function buildNPCDescription(npc) {
  if (!npc) return '';
  const parts = [];
  const { appearance } = npc;
  if (appearance) {
    const gender = appearance.gender === 'female' ? 'woman' : 'man';
    const age = appearance.age < 20 ? 'young' : appearance.age < 35 ? '' : appearance.age < 55 ? 'middle-aged' : 'elderly';
    parts.push(`${age} ${npc.race.toLowerCase()} ${gender}`.trim());
    if (appearance.build && appearance.build !== 'average') parts.push(appearance.build + ' build');
    if (appearance.hair) parts.push(appearance.hair + ' hair');
    if (appearance.eyes) parts.push(appearance.eyes + ' eyes');
    if (appearance.distinguishing) parts.push(appearance.distinguishing);
  }
  if (npc.ethnicity && npc.ethnicity !== npc.race) parts.push(`${npc.ethnicity}`);
  if (npc.heritage && !npc.heritage.startsWith('Standard')) parts.push(`${npc.heritage} heritage`);
  parts.push(`appears to be a ${npc.occupation}`);
  // Phase 7.8 — familiar flavor (describe by appearance, not name).
  if (npc.familiar?.id) {
    const famEntry = getFamiliarById(npc.familiar.id);
    if (famEntry) {
      parts.push(`accompanied by a small ${famEntry.name.toLowerCase()}`);
    }
  }
  if (npc.origin) parts.push(`from ${npc.origin}`);
  parts.push(`seems ${npc.disposition}`);
  if (npc.attitude) parts.push(`current attitude toward party: ${npc.attitude}`);
  if (npc.characterTraits?.length > 0) parts.push(`traits: ${npc.characterTraits.join(', ')}`);
  if (npc.drawback) parts.push(`drawback: ${npc.drawback}`);
  if (npc.alive === false) parts.push(`(deceased${npc.causeOfDeath ? ': ' + npc.causeOfDeath : ''})`);
  return parts.join(', ');
}

// ── Bug #27 — Placeholder-NPC reconciliation ──
// When a proper-named NPC is first extracted (e.g. "Marta, the farmer"),
// the party has almost certainly already met them under a placeholder name
// ("a farmer", "middle-aged human woman", etc.) that the extractor laid
// down on a previous turn. Exact-name dedupe misses the overlap because
// "a farmer" ≠ "Marta", so the placeholder sticks around and the Journal
// ends up with TWO rows for the same NPC — one unknown, one named.
//
// We bridge the gap with a descriptor-overlap score: for every placeholder
// row at the same location, tally the structured-field matches (race,
// ethnicity, gender, occupation, hair/eyes/build) plus shared tokens
// between the placeholder's name and the newcomer's shortDesc +
// firstImpression + occupation. A unique strong match (score ≥ 3 AND
// next-best score lags by ≥ 2) triggers a name-reveal UPDATE on the
// placeholder row. Ambiguous ties or zero matches fall through to the
// normal add-new path so we never clobber the wrong row.
//
// Deliberately conservative: random-roll appearance fields (hair colour,
// eye colour) are noisy because the placeholder and the name-reveal turn
// each run generateNPC() independently with fresh dice. The strongest
// signals are STRUCTURED+SPECIFIC (same occupation other than "unknown",
// same non-default race/ethnicity) plus SHARED TOKENS in the placeholder's
// literal name that also appear in the newcomer's description.
const GENERIC_DESC_STOPWORDS = new Set([
  'the', 'and', 'with', 'who', 'that', 'this', 'these', 'those',
  'they', 'she', 'her', 'his', 'him', 'their', 'them', 'you', 'your',
  'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'for',
  'appears', 'appear', 'looks', 'look', 'seems', 'seem', 'like',
  'some', 'very', 'quite', 'rather', 'person', 'people', 'someone',
  'somewhere', 'from', 'into', 'about', 'over', 'under', 'around',
  'here', 'there', 'then', 'now', 'next', 'nearby', 'close', 'away',
  'one', 'two', 'three', 'a', 'an',
]);

function tokenizeDesc(str) {
  if (!str || typeof str !== 'string') return new Set();
  const out = new Set();
  const matches = str.toLowerCase().match(/[a-z][a-z'-]+/g) || [];
  for (const t of matches) {
    if (t.length >= 3 && !GENERIC_DESC_STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

/**
 * Score how well a proper-named NPC (newNpc) matches a placeholder-named
 * row (placeholder). Higher = more likely the same person. Zero means
 * structurally different (different location, etc.) and should be skipped.
 *
 * Exported for unit testing — the inline-mirror test in outputs/ rebuilds
 * the same scoring table and feeds fixtures through it.
 */
export function scorePlaceholderOverlap(newNpc, placeholder) {
  if (!newNpc || !placeholder) return 0;
  // Must share a location. A proper-named NPC in the Rusty Dragon is not
  // the same person as "a farmer" out on the road.
  if (!newNpc.location || !placeholder.location) return 0;
  if (newNpc.location !== placeholder.location) return 0;
  let score = 0;
  // Occupation — strongest single signal when both are specific.
  if (placeholder.occupation && newNpc.occupation
      && placeholder.occupation !== 'unknown'
      && newNpc.occupation !== 'unknown'
      && placeholder.occupation.toLowerCase() === newNpc.occupation.toLowerCase()) {
    score += 3;
  }
  // Race — noisy (everything defaults to Human) so worth less.
  if (placeholder.race && newNpc.race && placeholder.race === newNpc.race) {
    score += 1;
  }
  // Ethnicity — strong when both specified (specific cultural token).
  if (placeholder.ethnicity && newNpc.ethnicity
      && placeholder.ethnicity === newNpc.ethnicity) {
    score += 2;
  }
  // Gender — mild signal; rules out obvious mismatches.
  const pGender = placeholder.appearance?.gender;
  const nGender = newNpc.appearance?.gender;
  if (pGender && nGender && pGender === nGender) score += 1;
  if (pGender && nGender && pGender !== nGender) return 0; // hard veto
  // Token overlap between the placeholder's descriptor-name and the new
  // NPC's shortDesc / firstImpression / occupation. This is the bridge
  // that catches "a farmer" ↔ "Marta … looks like a farmer" even when
  // the appearance fields are unrelated random rolls.
  const placeholderTokens = tokenizeDesc(placeholder.name);
  const newTokens = new Set([
    ...tokenizeDesc(newNpc.shortDesc),
    ...tokenizeDesc(newNpc.firstImpression),
    ...tokenizeDesc(newNpc.occupation),
  ]);
  for (const t of placeholderTokens) {
    if (newTokens.has(t)) score += 1;
  }
  return score;
}

/**
 * From a pool of placeholder-named NPC rows, pick the unique strong match
 * for a newly-named NPC, or return null if ambiguous / no viable candidate.
 *
 * Rules:
 *   - top candidate must score ≥ 3
 *   - top must beat the runner-up by ≥ 2 (clean uniqueness)
 *
 * Exported for unit testing.
 */
export function pickPlaceholderMatch(newNpc, placeholders) {
  if (!Array.isArray(placeholders) || placeholders.length === 0) return null;
  const scored = placeholders
    .map(p => ({ placeholder: p, score: scorePlaceholderOverlap(newNpc, p) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored[0].score < 3) return null;
  if (scored.length > 1 && (scored[0].score - scored[1].score) < 2) return null;
  return scored[0].placeholder;
}

// ── Store an encountered NPC ──
// Optional context allows auto-hydrating the Journal faction layer when
// the party meets someone tied to one or more factions. Pass `campaign`
// from the caller (e.g. AdventureTab) so we can look up live faction
// state for each affiliation the NPC declares.
export async function storeNPC(npc, context = {}) {
  const campaignDataId = getActiveCampaignDataId() || 'orphan';
  // Bug #28 instrumentation (2026-04-20) — trace every storeNPC entry so
  // cross-campaign leaks are attributable to a specific write. The next
  // reproduction will show which NPC was written under which scope, so we
  // can tell whether the leak is a mis-scoped write or a mis-scoped read.
  try {
    traceEngine('storeNPC:enter', {
      name: npc?.name || null,
      knownToParty: npc?.knownToParty !== false,
      location: npc?.location || null,
      scope: campaignDataId,
      callerLocation: context?.location || null,
      callerCampaignId: context?.campaign?.data?.id || context?.campaign?.id || null,
    });
  } catch (_) { /* trace best-effort */ }
  // v11 — dedup by name WITHIN the active campaign. Two campaigns can both
  // have an NPC named "Bertha Cray" without one stepping on the other. We
  // query by the indexed `name` column and filter by scope in JS — npcs
  // tend to have unique names per campaign so the candidate set is tiny.
  const candidates = await db.encounteredNpcs.where('name').equals(npc.name).toArray();
  let existing = candidates.find(c => c.campaignDataId === campaignDataId) || null;

  // Bug #27 — if there's no exact-name row and the newcomer is a PROPER-NAMED
  // NPC (knownToParty=true and the name is not a descriptor), try to locate
  // a placeholder row at the same location that this person has already
  // been seen as. Catches "Marta" after "a farmer" already exists on file.
  let reconciledFromPlaceholder = false;
  const incomingIsProperName = npc.knownToParty !== false
    && !!npc.name
    && !isAppearanceDescriptor(npc.name);
  if (!existing && incomingIsProperName) {
    try {
      const allInScope = await db.encounteredNpcs
        .where('campaignDataId').equals(campaignDataId).toArray();
      const placeholders = allInScope.filter(row =>
        row.knownToParty === false
        || (row.name && isAppearanceDescriptor(row.name))
      );
      const match = pickPlaceholderMatch(npc, placeholders);
      if (match) {
        existing = match;
        reconciledFromPlaceholder = true;
      }
    } catch (err) {
      // Reconciliation is strictly additive. If the lookup blows up (e.g.
      // Dexie offline in tests) we fall through to the normal add path.
      console.warn('[NPC reconcile] placeholder scan failed:', err);
    }
  }

  let stored;
  if (existing) {
    // Update interaction count and disposition (preserve attitude/alive/journal fields)
    const updateFields = {
      interactions: (existing.interactions || 0) + 1,
      disposition: npc.disposition || existing.disposition,
      location: npc.location || existing.location,
      lastSeen: new Date().toISOString(),
    };
    if (reconciledFromPlaceholder) {
      // Promote the placeholder: carry the newcomer's proper name, flip
      // knownToParty=true, stash the old descriptor into previousNames
      // for journal provenance, and prefer the newcomer's metadata where
      // it's more specific than the random roll we laid down earlier.
      updateFields.name = npc.name;
      updateFields.knownToParty = true;
      updateFields.previousNames = [
        ...(Array.isArray(existing.previousNames) ? existing.previousNames : []),
        existing.name,
      ].filter(Boolean);
      if (npc.shortDesc) updateFields.shortDesc = npc.shortDesc;
      if (npc.firstImpression) updateFields.firstImpression = npc.firstImpression;
      if (npc.occupation && npc.occupation !== 'unknown') {
        updateFields.occupation = npc.occupation;
      }
      if (npc.portraitSvg) updateFields.portraitSvg = npc.portraitSvg;
      if (Array.isArray(npc.factions) && npc.factions.length) {
        updateFields.factions = npc.factions;
      }
    }
    await db.encounteredNpcs.update(existing.id, updateFields);
    stored = { ...existing, ...updateFields };
    // Auto-progression milestones driven by interaction count.
    // 1+ interactions → "met" (level 2); 3+ → "known" (level 3).
    const newCount = stored.interactions;
    if (newCount >= 3) {
      await advanceNpcKnowledge(existing.id, { toLevel: 3 });
    } else if (newCount >= 1) {
      await advanceNpcKnowledge(existing.id, { toLevel: 2 });
    }
    if (reconciledFromPlaceholder) {
      // One journal line so the GM can see that the placeholder row got
      // promoted — invaluable for debugging false-positive reconciliations.
      try {
        emitJournalAdd({
          kind: 'npc',
          label: npc.name,
          detail: existing.name ? `name revealed (was ${existing.name})` : 'name revealed',
          id: existing.id,
        });
      } catch { /* journal never blocks storeNPC */ }
    }
  } else {
    // v11 — stamp campaignDataId so the row sorts into the active campaign's
    // journal. Without this, the row is invisible to read-side filters.
    const id = await db.encounteredNpcs.add({ ...npc, campaignDataId });
    // Bug #28 instrumentation — pairs with storeNPC:enter so a reproduction
    // log shows scope mismatch (context.campaign.data.id vs module scope).
    try {
      traceEngine('storeNPC:add', {
        id,
        name: npc?.name || null,
        scope: campaignDataId,
        callerCampaignId: context?.campaign?.data?.id || context?.campaign?.id || null,
      });
    } catch (_) { /* trace best-effort */ }
    stored = { ...npc, id, campaignDataId };
    // First-time encounter — notify the narrative log. Re-meets (the
    // `existing` branch above) stay silent to avoid spam. Prefer the
    // NPC's known display name; fall back to their physical label when
    // the party hasn't learned the name yet (respects the "don't name
    // NPCs before they're introduced" rule from feedback_npc_names.md).
    const displayName = getNPCDisplayName(stored) || stored.description || 'someone new';
    emitJournalAdd({
      kind: 'npc',
      label: displayName,
      detail: stored.location ? `met in ${stored.location}` : null,
      id,
    });
  }

  // Auto-record faction discoveries if caller supplied campaign context.
  // Idempotent — safe even if this NPC has been met before.
  const campaign = context.campaign;
  const inner = campaign?.data || campaign;
  if (inner && Array.isArray(stored.factions) && stored.factions.length > 0) {
    try {
      await recordFactionsFromNPC(stored, inner, {
        location: stored.location || context.location || null,
      });
    } catch (err) {
      console.warn('[NPC→Faction] auto-record failed:', err);
    }
  }

  return stored;
}

// ── Get all encountered NPCs (current campaign only) ──
export async function getEncounteredNPCs() {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  return db.encounteredNpcs.where('campaignDataId').equals(campaignDataId).toArray();
}

// ── Get a single encountered NPC by primary key, scope-guarded ──
// Returns null if the row belongs to a different campaign or no scope is set.
// Use this anywhere the UI or a service might hold a stale npcId that could
// cross campaign boundaries (e.g. deep-link focusId, persisted selection).
export async function getEncounteredNPC(id) {
  if (id == null) return null;
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return null;
  const row = await db.encounteredNpcs.get(id);
  if (!row || row.campaignDataId !== campaignDataId) return null;
  return row;
}

// ── Get NPCs at a specific location (current campaign only) ──
export async function getNPCsAtLocation(location) {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  const all = await db.encounteredNpcs.where('location').equals(location).toArray();
  return all.filter(n => n.campaignDataId === campaignDataId);
}

// ── Update NPC ──
export async function updateNPC(id, changes) {
  await db.encounteredNpcs.update(id, changes);
}

// ── Update NPC attitude (CRB Ch. 4 — persists through sessions) ──
// Logs the shift in attitudeHistory so the journal can show the relationship arc.
export async function updateNPCAttitude(npcOrId, newAttitude, reason = '') {
  const id = typeof npcOrId === 'object' ? npcOrId.id : npcOrId;
  if (!id) return null;
  const npc = await db.encounteredNpcs.get(id);
  if (!npc) return null;
  const prev = npc.attitude || 'indifferent';
  if (prev === newAttitude) return npc;
  const history = Array.isArray(npc.attitudeHistory) ? [...npc.attitudeHistory] : [];
  history.push({
    from: prev,
    to: newAttitude,
    reason,
    at: new Date().toISOString(),
  });
  await db.encounteredNpcs.update(id, {
    attitude: newAttitude,
    attitudeHistory: history,
  });
  return { ...npc, attitude: newAttitude, attitudeHistory: history };
}

// ── Mark an NPC as deceased (so they're not re-encountered) ──
export async function markNPCDead(npcOrId, cause = '') {
  const id = typeof npcOrId === 'object' ? npcOrId.id : npcOrId;
  if (!id) return null;
  await db.encounteredNpcs.update(id, {
    alive: false,
    causeOfDeath: cause,
    diedAt: new Date().toISOString(),
  });
  // Auto-progression: a defeated foe has been fully measured in combat.
  // Unlock combatStats (and stats) so the Journal can surface HP/AC/CR.
  await advanceNpcKnowledge(id, { unlock: ['combatStats', 'stats'] });
  return db.encounteredNpcs.get(id);
}

// ── Get only living NPCs (current campaign only, for encounter selection) ──
export async function getLivingNPCs() {
  const campaignDataId = getActiveCampaignDataId();
  if (!campaignDataId) return [];
  const all = await db.encounteredNpcs
    .where('campaignDataId')
    .equals(campaignDataId)
    .toArray();
  return all.filter(n => n.alive !== false);
}

// ── Player-facing journal note (author: the party, not the GM) ──
// Kept separate from npc.notes (which is GM-authored free-text) via a
// dedicated playerNotes field so the two audiences don't overwrite one
// another. Creates the field lazily.
export async function setNpcPlayerNote(id, text) {
  if (!id) return null;
  await db.encounteredNpcs.update(id, { playerNotes: text || '' });
  return db.encounteredNpcs.get(id);
}

// ── GM-facing knowledge-level override (0..4) ──
// The GM can bump what the party "knows" about an NPC without waiting for
// organic triggers. Clamped; `null` clears the override and falls back to
// the interactions-based inference in deriveNpcKnowledgeLevel.
export async function setNpcKnowledgeLevel(id, level) {
  if (!id) return null;
  if (level == null) {
    await db.encounteredNpcs.update(id, { knowledgeLevel: null });
  } else {
    const clamped = Math.max(0, Math.min(4, Math.floor(level)));
    await db.encounteredNpcs.update(id, { knowledgeLevel: clamped });
  }
  return db.encounteredNpcs.get(id);
}

// ── GM-facing toggle for a single revealedFact ──
// factKey ∈ { 'combatStats', 'secretFactions', 'trueAlignment', 'stats' }
// Idempotent — stores the result back as a plain array (Dexie-friendly).
export async function toggleNpcRevealedFact(id, factKey) {
  if (!id || !factKey) return null;
  const npc = await db.encounteredNpcs.get(id);
  if (!npc) return null;
  const current = Array.isArray(npc.revealedFacts) ? [...npc.revealedFacts] : [];
  const idx = current.indexOf(factKey);
  if (idx >= 0) current.splice(idx, 1);
  else current.push(factKey);
  await db.encounteredNpcs.update(id, { revealedFacts: current });
  return { ...npc, revealedFacts: current };
}

// ── Advance NPC knowledge (never regresses) ─────────────────────────
// Used by automatic progression hooks (name reveal, interactions, combat).
// `toLevel` bumps the explicit knowledgeLevel up to the requested value
// only if it's higher than the current explicit/derived level. `unlock`
// is a revealedFacts key or array of keys to add (set-union, no removal).
//
// Idempotent and one-way: GMs use the manual ± / toggle buttons for
// anything that needs to walk backward. Returns the updated row, or null
// if the NPC doesn't exist.
// Pure helper — computes a Dexie patch given an existing NPC row and the
// requested advancement. Exposed so unit tests can exercise the semantics
// without spinning up IndexedDB. Returns `null` when nothing should change.
export function computeKnowledgeAdvance(npc, { toLevel = null, unlock = null } = {}) {
  if (!npc) return null;
  const patch = {};
  let touched = false;

  if (toLevel != null) {
    const clamped = Math.max(0, Math.min(4, Math.floor(toLevel)));
    const currentExplicit = Number.isFinite(npc.knowledgeLevel) ? npc.knowledgeLevel : null;
    const currentDerived = currentExplicit != null
      ? currentExplicit
      : (!npc.knownToParty ? 0
         : (npc.interactions || 0) >= 3 ? 3
         : (npc.interactions || 0) >= 1 ? 2
         : 1);
    if (clamped > currentDerived) {
      patch.knowledgeLevel = clamped;
      touched = true;
    }
  }

  if (unlock) {
    const adds = Array.isArray(unlock) ? unlock : [unlock];
    const valid = new Set(['combatStats', 'secretFactions', 'trueAlignment', 'stats']);
    const filtered = adds.filter(k => valid.has(k));
    if (filtered.length) {
      const current = new Set(Array.isArray(npc.revealedFacts) ? npc.revealedFacts : []);
      const before = current.size;
      filtered.forEach(k => current.add(k));
      if (current.size !== before) {
        patch.revealedFacts = [...current];
        touched = true;
      }
    }
  }

  return touched ? patch : null;
}

export async function advanceNpcKnowledge(id, { toLevel = null, unlock = null } = {}) {
  if (!id) return null;
  const npc = await db.encounteredNpcs.get(id);
  if (!npc) return null;
  const patch = computeKnowledgeAdvance(npc, { toLevel, unlock });
  if (!patch) return npc;
  await db.encounteredNpcs.update(id, patch);
  return { ...npc, ...patch };
}

// ── Phase 7.8: NPC familiar combat spawn helper ──
/**
 * Build a combat-ready familiar entry for a hostile NPC.
 *
 * Returns an enemy-shaped object (id, name, hp, ac, attacks, etc.) that
 * can be appended to combat.enemies when the NPC enters combat.
 * Returns `null` when the NPC doesn't qualify:
 *   • no familiar
 *   • NPC level < 3 (avoids flooding low-level tavern brawls)
 *   • NPC isn't hostile
 *
 * The caller (CampaignTab / dmEngine) decides when to inject the entry.
 */
export function getNPCFamiliarCombatEntry(npc) {
  if (!npc?.familiar?.id) return null;
  if ((npc.level || 1) < 3) return null;
  // Require the NPC to be hostile — friendly Wizard's cat shouldn't fight.
  if (npc.disposition !== 'hostile' && npc.attitude !== 'hostile') return null;

  // Build a pseudo-character to feed into deriveFamiliarStats.
  // NPC records carry flat ability scores + level, which is enough.
  const masterProxy = {
    class: npc.class,
    level: npc.level,
    abilities: npc.abilities,
    maxHP: npc.maxHP || npc.hp,
    bab: npc.class === 'Wizard' || npc.class === 'Witch'
      ? Math.floor(npc.level / 2)       // d6 caster BAB (½ level)
      : Math.floor(npc.level * 3 / 4),  // ¾ BAB fallback
    // Ability modifier: (score - 10) / 2, floored.  Use ?? 10 so a
    // missing score defaults to 10 (+0 mod) rather than the broken
    // `|| 10 - 10` which silently evaluates to `|| 0`.
    saves: {
      fort: Math.floor(((npc.abilities?.CON ?? 10) - 10) / 2),
      ref: Math.floor(((npc.abilities?.DEX ?? 10) - 10) / 2),
      will: Math.floor(((npc.abilities?.WIS ?? 10) - 10) / 2),
    },
  };

  const stats = deriveFamiliarStats(masterProxy, npc.familiar.id);
  if (!stats) return null;

  // Shape it like a CampaignTab combat.enemies entry (see CampaignTab.jsx
  // ~248-300 for the canonical enemy shape). CombatTab reads `currentHP`,
  // `conditions`, `type` (creature type for identify checks), `cr`, and
  // flat ability scores alongside any nested `abilities` object.
  const ab = stats.abilities || {};
  return {
    id: `npc-familiar-${npc.name || 'unknown'}-${stats.id}`,
    name: `${stats.name} (familiar)`,
    baseName: stats.name,
    // PF1e creature type — familiars are magical beasts (CRB p. 82).
    type: 'magical beast',
    isFamiliar: true,
    masterNPCName: npc.name,
    hp: stats.hp,
    currentHP: stats.hp,
    maxHP: stats.hp,
    ac: stats.ac?.total ?? stats.ac ?? 10,
    cr: 0,  // base familiars have no meaningful CR on their own
    xp: 0,
    // Flat ability scores (CombatTab reads e.g. `enemy.int` for display)
    str: ab.STR ?? null,
    dex: ab.DEX ?? null,
    con: ab.CON ?? null,
    int: ab.INT ?? null,
    wis: ab.WIS ?? null,
    cha: ab.CHA ?? null,
    // Nested abilities for creatureAI (reads `enemy.abilities?.DEX`)
    abilities: ab,
    // Combat stats
    init: stats.abilityMods?.DEX ?? 0,
    bab: stats.bab ?? 0,
    fort: stats.saves?.fort?.total ?? stats.saves?.fort ?? 0,
    ref: stats.saves?.ref?.total ?? stats.saves?.ref ?? 0,
    will: stats.saves?.will?.total ?? stats.saves?.will ?? 0,
    attacks: stats.attacks || [],
    size: stats.size || 'Tiny',
    speed: '15 ft.',  // most Tiny familiars
    conditions: [],
    // Nested saves + original familiar data for lookups
    saves: stats.saves || {},
    familiarId: stats.id,
    familiarStats: stats,
  };
}

// ── Generate NPC Portrait (SVG) ──
export function generatePortrait(npc) {
  const { appearance, race } = npc;
  const isFemale = appearance?.gender === 'female';

  // Color mapping
  const skinTones = {
    'Human': ['#F5D5B5', '#D4A574', '#C68642', '#8D5524', '#F0C8A0'],
    'Elf': ['#F5E6D3', '#E8D5C4', '#D4C5B5', '#F0E0D0', '#E5D0C0'],
    'Half-Elf': ['#F5D5B5', '#E8D0B5', '#D4B595', '#F0C8A0', '#E0C0A0'],
    'Dwarf': ['#E8C8A8', '#D4A574', '#C8A080', '#D0B090', '#C0A080'],
    'Halfling': ['#F5D5B5', '#F0D0A0', '#E8C898', '#F0C8A0', '#E5C090'],
    'Gnome': ['#F5E0C8', '#E8D0B8', '#F0D8C0', '#E5D0C0', '#F0E0D0'],
    'Half-Orc': ['#A8B87A', '#8FA068', '#7A9050', '#90A870', '#80A060'],
    'Tiefling': ['#D4A0A0', '#C89090', '#B88080', '#D09898', '#C08888'],
    'Aasimar': ['#F5E8D5', '#F0E5D0', '#F5F0E0', '#F0E8D8', '#F5E0D0'],
  };

  const hairColorMap = {
    'black': '#1a1a1a', 'brown': '#5C4033', 'auburn': '#922724', 'blonde': '#E8D44D',
    'red': '#C62828', 'silver': '#C0C0C0', 'white': '#F0F0F0', 'gray': '#808080',
  };

  const eyeColorMap = {
    'brown': '#5C3317', 'blue': '#2196F3', 'green': '#2E7D32', 'gray': '#757575',
    'hazel': '#8B7355', 'amber': '#FFA000', 'violet': '#7B1FA2', 'black': '#212121',
  };

  const tones = skinTones[race] || skinTones['Human'];
  const skinColor = tones[Math.floor(Math.random() * tones.length)];
  const hairRaw = (appearance?.hair || 'short brown').split(' ');
  const hairColor = hairColorMap[hairRaw[hairRaw.length - 1]] || '#5C4033';
  const eyeColor = eyeColorMap[appearance?.eyes] || '#5C3317';

  // Build type affects face shape
  const isWide = ['stocky', 'heavyset', 'broad-shouldered', 'muscular'].includes(appearance?.build);
  const faceW = isWide ? 38 : 32;
  const faceH = 42;

  // Ear shape for elves
  const isElf = race === 'Elf' || race === 'Half-Elf';
  const isOrc = race === 'Half-Orc';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120">
  <defs>
    <radialGradient id="skin_${npc.name?.replace(/\s/g, '')}" cx="50%" cy="40%" r="50%">
      <stop offset="0%" style="stop-color:${skinColor};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${skinColor};stop-opacity:0.85"/>
    </radialGradient>
  </defs>
  <!-- Background -->
  <rect width="100" height="120" rx="8" fill="#2a2a4e"/>
  <!-- Neck -->
  <rect x="42" y="78" width="16" height="14" rx="4" fill="${skinColor}" opacity="0.9"/>
  <!-- Shoulders/body hint -->
  <ellipse cx="50" cy="105" rx="30" ry="18" fill="#3a3a6e" stroke="#555" stroke-width="0.5"/>
  <!-- Face -->
  <ellipse cx="50" cy="52" rx="${faceW / 2}" ry="${faceH / 2}" fill="url(#skin_${npc.name?.replace(/\s/g, '')})" stroke="${skinColor}" stroke-width="0.5"/>
  ${isElf ? `<!-- Elf ears -->
  <polygon points="24,45 18,35 28,48" fill="${skinColor}"/>
  <polygon points="76,45 82,35 72,48" fill="${skinColor}"/>` : ''}
  ${isOrc ? `<!-- Orc tusks -->
  <line x1="40" y1="65" x2="39" y2="60" stroke="#F5F5DC" stroke-width="2" stroke-linecap="round"/>
  <line x1="60" y1="65" x2="61" y2="60" stroke="#F5F5DC" stroke-width="2" stroke-linecap="round"/>` : ''}
  <!-- Hair -->
  <ellipse cx="50" cy="${isFemale ? 36 : 38}" rx="${faceW / 2 + 3}" ry="${isFemale ? 22 : 18}" fill="${hairColor}" opacity="0.9"/>
  ${isFemale ? `<rect x="${50 - faceW / 2 - 2}" y="42" width="${faceW + 4}" height="35" rx="3" fill="${hairColor}" opacity="0.6"/>` : ''}
  <!-- Eyes -->
  <ellipse cx="40" cy="50" rx="5" ry="3.5" fill="white"/>
  <ellipse cx="60" cy="50" rx="5" ry="3.5" fill="white"/>
  <circle cx="40" cy="50" r="2.5" fill="${eyeColor}"/>
  <circle cx="60" cy="50" r="2.5" fill="${eyeColor}"/>
  <circle cx="40" cy="50" r="1" fill="#111"/>
  <circle cx="60" cy="50" r="1" fill="#111"/>
  <!-- Eyebrows -->
  <line x1="35" y1="${isOrc ? 44 : 45}" x2="45" y2="${isOrc ? 43 : 44}" stroke="${hairColor}" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="55" y1="${isOrc ? 43 : 44}" x2="65" y2="${isOrc ? 44 : 45}" stroke="${hairColor}" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Nose -->
  <path d="M48,53 Q50,${isOrc ? 60 : 58} 52,53" fill="none" stroke="${skinColor}" stroke-width="1" opacity="0.6"/>
  <!-- Mouth -->
  <path d="M42,62 Q50,${isFemale ? 67 : 66} 58,62" fill="none" stroke="#8B4513" stroke-width="${isFemale ? 1.5 : 1}" opacity="0.7"/>
  <!-- Scar or distinguishing mark -->
  ${(appearance?.distinguishing || '').includes('scar') ? `<line x1="55" y1="45" x2="65" y2="58" stroke="#C0A080" stroke-width="1" opacity="0.6"/>` : ''}
  ${(appearance?.distinguishing || '').includes('eyepatch') ? `<ellipse cx="60" cy="50" rx="7" ry="5" fill="#222" stroke="#444" stroke-width="0.5"/>
  <line x1="53" y1="38" x2="67" y2="38" stroke="#444" stroke-width="1"/>` : ''}
</svg>`;

  return svg;
}

// ── Generate Contextual Actions from Events ──
/**
 * Generate scene-specific context actions based on the narrative text.
 * This is the procedural fallback — when AI is available, the AI generates
 * suggested actions directly. These should be specific to what's actually
 * described in the scene text, not generic.
 */
export function generateContextActions(event, adventure, party) {
  const actions = [];
  const type = event?.type || '';
  const text = (event?.text || '').toLowerCase();
  const isTown = adventure?.type === 'town';
  const isDungeon = adventure?.type === 'dungeon';
  const locationName = (adventure?.location?.name || '').toLowerCase();

  // ── Extract scene details from narrative text ──
  // Find specific nouns/subjects mentioned in the text
  const mentionsPerson = /\b(woman|man|merchant|figure|stranger|guard|priest|bard|innkeeper|shopkeeper|bartender|dwarf|elf|halfling|gnome|farmer|noble|beggar|child|crier|apothecary|smith|sailor)\b/i.test(text);
  const mentionsPlace = text.match(/\b(tavern|inn|shop|store|temple|church|market|square|dock|gate|bridge|tower|mill|manor|graveyard|lighthouse|garrison|academy|cathedral|harbor)\b/i);
  const mentionsThreat = /\b(fight|weapon|pickpocket|thief|thieves|bandit|scream|blood|body|attack|danger|threat|suspicious|shady|dark|shadow|growl|hiss)\b/i.test(text);
  const mentionsObject = text.match(/\b(note|letter|book|scroll|map|chest|barrel|crate|door|lock|key|symbol|rune|inscription|carving|altar|statue|lever|switch|trap|pit|web|bones)\b/i);
  const mentionsGoblin = /\b(goblin|raid|sighting)\b/i.test(text);
  const mentionsMagic = /\b(magic|arcane|glow|shimmer|enchant|aura|spell|rune|ward|sigil)\b/i.test(text);
  const mentionsRumor = /\b(rumor|heard|whisper|overheard|says|folk|people say|they say|word is)\b/i.test(text);
  const mentionsNature = /\b(forest|cave|cliff|river|sea|mountain|swamp|trail|path|road|bridge|camp)\b/i.test(text);

  // ── Build scene-specific actions ──

  if (mentionsPerson) {
    const personMatch = text.match(/\b(woman|man|merchant|figure|stranger|guard|priest|bard|innkeeper|shopkeeper|bartender|dwarf|elf|halfling|gnome|farmer|noble|beggar|apothecary|smith|sailor)\b/i);
    const person = personMatch ? personMatch[0] : 'stranger';
    actions.push({ label: `Approach the ${person}`, action: `I approach the ${person} and try to start a conversation`, type: 'social' });
    actions.push({ label: `Read their intent`, action: `I study the ${person}'s body language and demeanor (Sense Motive check)`, type: 'skill' });
  }

  if (mentionsThreat) {
    if (text.includes('pickpocket') || text.includes('thief')) {
      actions.push({ label: 'Grab the thief', action: 'I grab the pickpocket by the wrist before they can escape', type: 'combat' });
      actions.push({ label: 'Call the guard', action: 'I shout for the town guard to stop the thief', type: 'social' });
    } else if (text.includes('fight') || text.includes('weapon')) {
      actions.push({ label: 'Break it up', action: 'I step between the combatants and try to calm things down (Diplomacy check)', type: 'social' });
      actions.push({ label: 'Intimidate them', action: 'I crack my knuckles and tell them to stand down (Intimidate check)', type: 'social' });
      actions.push({ label: 'Stay back', action: 'I keep my distance but watch carefully for anyone who might need help', type: 'explore' });
    } else {
      actions.push({ label: 'Draw weapons', action: 'I draw my weapon and prepare for trouble', type: 'combat' });
      actions.push({ label: 'Stay alert', action: 'I keep my hand on my weapon and scan for the source of danger (Perception check)', type: 'skill' });
    }
  }

  if (mentionsRumor) {
    actions.push({ label: 'Press for details', action: 'I lean in and ask for specific details — names, locations, when it happened', type: 'social' });
    actions.push({ label: 'Cross-reference', action: 'What do I already know about this from local history or lore? (Knowledge Local check)', type: 'skill' });
  }

  if (mentionsPlace) {
    const place = mentionsPlace[0];
    if (place === 'shop' || place === 'store' || place === 'market') {
      actions.push({ label: `Enter the ${place}`, action: `I enter the ${place} and browse what they have for sale`, type: 'explore' });
      actions.push({ label: 'Appraise the goods', action: `I examine the ${place}'s wares with a critical eye (Appraise check)`, type: 'skill' });
    } else if (place === 'tavern' || place === 'inn') {
      actions.push({ label: 'Order a drink', action: 'I sit at the bar and order an ale, listening to the conversation around me', type: 'social' });
      actions.push({ label: 'Ask the innkeeper', action: 'I ask the innkeeper what news or rumors they have heard lately', type: 'social' });
    } else if (place === 'temple' || place === 'church' || place === 'cathedral') {
      actions.push({ label: `Visit the ${place}`, action: `I enter the ${place} and speak with whoever is attending`, type: 'social' });
    } else if (place === 'graveyard') {
      actions.push({ label: 'Investigate the graves', action: 'I carefully examine the graveyard for signs of disturbance (Perception check)', type: 'skill' });
    } else {
      actions.push({ label: `Head to the ${place}`, action: `I make my way toward the ${place} to see what is there`, type: 'explore' });
    }
  }

  if (mentionsObject) {
    const obj = mentionsObject[0];
    if (['note', 'letter', 'book', 'scroll', 'map'].includes(obj)) {
      actions.push({ label: `Read the ${obj}`, action: `I carefully read the ${obj}, looking for useful information (Linguistics check)`, type: 'skill' });
    } else if (['chest', 'door', 'lock'].includes(obj)) {
      actions.push({ label: `Open the ${obj}`, action: `I check the ${obj} for traps, then try to open it (Disable Device check)`, type: 'skill' });
      actions.push({ label: `Force it open`, action: `I put my shoulder into the ${obj} and try to force it (Strength check)`, type: 'combat' });
    } else if (['symbol', 'rune', 'inscription', 'carving'].includes(obj)) {
      actions.push({ label: `Study the ${obj}`, action: `I examine the ${obj} closely to determine its meaning (Knowledge Arcana/Spellcraft check)`, type: 'skill' });
    } else if (['lever', 'switch'].includes(obj)) {
      actions.push({ label: `Pull the ${obj}`, action: `I carefully pull the ${obj} while the party stands ready`, type: 'explore' });
    } else if (['altar', 'statue'].includes(obj)) {
      actions.push({ label: `Examine the ${obj}`, action: `I approach the ${obj} and examine it for religious or magical significance (Knowledge Religion check)`, type: 'skill' });
    } else if (['trap', 'pit', 'web'].includes(obj)) {
      actions.push({ label: 'Find a way around', action: `I look for an alternate path around the ${obj} (Perception check)`, type: 'skill' });
    }
  }

  if (mentionsGoblin) {
    actions.push({ label: 'Track the goblins', action: 'I search for goblin tracks or signs of their passage (Survival check)', type: 'skill' });
    actions.push({ label: 'Ask about goblins', action: 'I ask the locals what they know about recent goblin activity and where they were seen', type: 'social' });
  }

  if (mentionsMagic) {
    actions.push({ label: 'Detect Magic', action: 'I cast Detect Magic to identify any magical auras in the area', type: 'skill' });
    actions.push({ label: 'Identify the magic', action: 'I try to determine the school and strength of the magic (Spellcraft check)', type: 'skill' });
  }

  // ── Dungeon-specific based on scene ──
  if (isDungeon) {
    if (actions.length === 0) {
      // Only add generic dungeon actions if nothing scene-specific was found
      actions.push({ label: 'Check for traps', action: 'I carefully scan the floor and walls ahead for traps (Perception check)', type: 'skill' });
      actions.push({ label: 'Listen ahead', action: 'I press my ear to the wall and listen for movement beyond (Perception check)', type: 'skill' });
    }
    if (mentionsNature) {
      const terrain = text.match(/\b(cave|cliff|river|swamp|bridge)\b/i);
      if (terrain) {
        actions.push({ label: `Navigate the ${terrain[0]}`, action: `I carefully navigate the ${terrain[0]}, testing my footing (Acrobatics/Climb check)`, type: 'skill' });
      }
    }
  }

  // ── Town-specific based on scene ──
  if (isTown && actions.length === 0) {
    // Scene-appropriate town defaults based on location
    if (locationName.includes('rusty dragon') || locationName.includes('inn') || locationName.includes('tavern') || locationName.includes('feedbag')) {
      actions.push({ label: 'Listen to patrons', action: 'I eavesdrop on nearby conversations, hoping to hear something interesting (Perception check)', type: 'skill' });
      actions.push({ label: 'Buy a round', action: 'I buy a round of drinks for the locals to loosen their tongues (Diplomacy check)', type: 'social' });
    } else if (locationName.includes('sandpoint')) {
      actions.push({ label: 'Visit the market', action: 'I head toward the marketplace to see what goods are available today', type: 'explore' });
      actions.push({ label: 'Ask about work', action: 'I ask around town if anyone needs help with anything — bounties, odd jobs, or problems', type: 'social' });
    } else {
      actions.push({ label: 'Observe the area', action: 'I take a moment to observe my surroundings carefully, noting exits, people, and anything unusual (Perception check)', type: 'skill' });
      actions.push({ label: 'Talk to locals', action: 'I strike up a friendly conversation with someone nearby to learn about this place', type: 'social' });
    }
  }

  // Cap at 5 actions max
  return actions.slice(0, 5);
}

// ── Generate Area Items ──
// Each item includes a description of WHERE it is and WHAT it looks like.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const TOWN_ITEMS = [
  // Mundane scenery
  { name: 'Torch', descriptions: [
    'A sputtering tar-soaked torch wedged into a rusted iron sconce on the wall, casting flickering orange light across the cobblestones.',
    'Mounted high on a wooden post near the doorway, this torch is half-burned down, its flame dancing in the draft.',
    'A fresh torch leans in a barrel by the entrance, its wrapped head still dark with unlit pitch.',
  ], mundane: true },
  { name: 'Barrel of Ale', descriptions: [
    'A squat oak barrel sits behind the bar counter, its lid loosely set. A tin ladle hangs from a nail beside it, and the wood is stained dark from years of use.',
    'Tucked into the corner near the hearth, this dented copper-banded barrel has a small spigot and a puddle of amber liquid beneath it.',
    'A half-empty cask rests on a wooden cradle against the far wall. Someone has chalked "2 cp" on the side.',
  ], mundane: true },
  { name: 'Hanging Lantern', descriptions: [
    'A green-glass lantern dangles from a chain above the center table, swaying slightly and throwing colored shadows across the room.',
    'An oil lantern with a cracked chimney sits on a shelf near the window, its flame low and guttering.',
  ], mundane: true },
  { name: 'Worn Rug', descriptions: [
    'A threadbare Varisian rug covers the floor beneath the main table. Its once-bright geometric patterns have faded to muddy browns and dull reds.',
    'A rolled-up animal hide rug leans against the wall near the fireplace, too worn to lay flat anymore.',
  ], mundane: true },
  { name: 'Mounted Trophy', descriptions: [
    'A boar\'s head is mounted above the mantle, its glass eyes catching the firelight. A plaque beneath it reads something in faded script.',
    'A pair of antlers hangs over the door, draped with a faded garland of dried herbs.',
  ], mundane: true },
  // Loot
  { name: 'Discarded Coin Purse', descriptions: [
    'Kicked under a bench near the door, a small leather purse lies in the dust. Its drawstring is loose and a copper glints inside.',
    'Half-hidden beneath a crumpled napkin on an empty table, a worn velvet coin pouch with a broken clasp.',
    'Wedged between two floorboards near the bar, a tiny canvas pouch — someone must have dropped it in their cups.',
  ], loot: true, goldDice: 6 },
  { name: 'Silver Ring', descriptions: [
    'Sitting in a crack between two flagstones near the hearth, a tarnished silver ring catches the firelight.',
    'Resting on the windowsill behind a dusty curtain, a thin silver band with a tiny blue stone.',
  ], loot: true, goldDice: 10 },
  // Interactable
  { name: 'Notice Board', descriptions: [
    'A weathered cork board hangs beside the entrance, crowded with overlapping handbills, bounty notices, and a hand-drawn map pinned with a rusty nail.',
    'Near the town well, a tall wooden post is plastered with notices. Several are torn or rain-damaged, but a few fresh postings stand out.',
  ], interactable: true },
  { name: 'Suspicious Crate', descriptions: [
    'A nailed-shut wooden crate sits in the alley behind the building. Fresh scratches around the nails suggest someone tried to pry it open recently.',
    'Stacked near the back door, a crate marked with a merchant\'s seal you don\'t recognize. It\'s heavier than it looks.',
  ], interactable: true },
  { name: 'Old Well', descriptions: [
    'A stone well with a mossy wooden cover sits in the corner of the square. The rope is frayed and the bucket is missing.',
  ], interactable: true },
];

const TAVERN_ITEMS = [
  { name: 'Menu Board', descriptions: [
    'A slate chalkboard leans against the wall behind the bar. Today\'s specials are scrawled in uneven letters, with prices scratched out and rewritten.',
    'A wooden board hangs from two chains above the serving window. The day\'s meals are painted in white: stew, bread, and roast pheasant.',
  ], interactable: true },
  { name: 'Forgotten Journal', descriptions: [
    'On a corner table sticky with old ale, a leather-bound journal lies open. The handwriting inside is cramped and hurried, with several pages torn out.',
    'Tucked behind a cushion on the window seat, a small book bound in worn red leather. A quill is pressed between its pages as a bookmark.',
  ], interactable: true, loot: true },
  { name: 'Abandoned Mug', descriptions: [
    'A pewter tankard sits alone at an otherwise empty table. The ale inside is still faintly warm — whoever left it did so recently.',
  ], mundane: true },
  { name: 'Bard\'s Instrument Case', descriptions: [
    'Propped against a chair near the small stage, a battered lute case with peeling leather and a broken latch. Something rattles inside.',
  ], interactable: true },
];

const DUNGEON_ITEMS = [
  // Mundane
  { name: 'Scattered Bones', descriptions: [
    'A jumble of yellowed bones is heaped against the far wall — a cracked femur, several ribs, and what might be a jawbone. Cobwebs stretch between them.',
    'Crunching underfoot, small bones and bone fragments are scattered across the flagstones. Some are humanoid. Some are not.',
    'In an alcove to the left, a complete skeleton sits slumped against the stone, still wearing the tatters of a leather jerkin.',
  ], mundane: true },
  { name: 'Rusty Chain', descriptions: [
    'A heavy iron chain is bolted into the wall at shoulder height, its last three links dangling free over a dark stain on the floor.',
    'Coiled in the corner like a dead snake, a length of corroded chain. The wall bracket it was attached to has pulled free of the crumbling mortar.',
  ], mundane: true },
  { name: 'Dripping Water', descriptions: [
    'Water seeps through a crack in the ceiling and drips steadily into a shallow pool on the floor. The stone around it is stained green with mineral deposits.',
    'A thin stream of water runs down the wall, following a groove carved — or worn — into the stone over centuries.',
  ], mundane: true },
  { name: 'Toppled Statue', descriptions: [
    'A stone statue lies face-down on the floor, broken at the ankles. One outstretched hand still points toward the far doorway.',
    'The pedestal in the center of the room is empty. The statue that once stood there lies in three pieces nearby, its features worn smooth.',
  ], mundane: true },
  { name: 'Scorched Walls', descriptions: [
    'The walls here are blackened with old soot. The scorch pattern radiates outward from a point near the floor — something burned hot and fast here.',
  ], mundane: true },
  // Loot
  { name: 'Old Chest', descriptions: [
    'Shoved into a corner beneath a collapsed shelf, a wooden chest with corroded brass fittings. The wood is soft with rot, but the lock still holds.',
    'Half-buried under fallen rubble near the door, the corner of an iron-banded chest peeks out. Scratch marks on the stone suggest someone tried to drag it.',
    'Against the back wall, a small chest sits on a stone shelf. Its lid is slightly ajar, and something glints inside.',
  ], interactable: true, loot: true },
  { name: 'Potion Vial', descriptions: [
    'Nestled in a wall niche behind a loose stone, a small crystal vial filled with a pale blue liquid that shimmers when you tilt it.',
    'Rolling gently on a tilted flagstone, a stoppered glass vial containing a rosy liquid. The cork is sealed with wax stamped with an alchemist\'s mark.',
    'On a narrow shelf carved into the wall, three vials sit in a row — two are shattered, but one remains intact, glowing faintly green.',
  ], loot: true, item: 'Potion of Cure Light Wounds' },
  { name: 'Coins in Rubble', descriptions: [
    'Among the loose stones and dust, several coins catch the torchlight — old silver pieces, their edges worn smooth.',
  ], loot: true, goldDice: 8 },
  // Interactable
  { name: 'Glowing Runes', descriptions: [
    'Etched into the floor in a three-foot circle, runes pulse with a dim blue-white light. The air above them feels slightly warmer.',
    'Along the doorframe, angular runes are carved deep into the stone. They emit a faint amber glow that intensifies when you step closer.',
  ], interactable: true },
  { name: 'Enchanted Weapon Rack', descriptions: [
    'A wall-mounted weapon rack holds three rusted blades — but the fourth, a slender longsword, gleams as if freshly forged. A faint hum resonates from it.',
    'Bolted to the wall, an iron rack displays several broken weapons. One dagger at the end is untouched by rust, its pommel set with a dull red stone.',
  ], interactable: true, loot: true, minLevel: 3 },
  { name: 'Carved Stone Face', descriptions: [
    'Set into the wall at chest height, a grotesque stone face stares outward with empty eyes. Its mouth gapes open — wide enough to fit a hand inside.',
    'Above the archway, a weathered stone face is carved in bas-relief. Water trickles from one of its eyes like a tear, pooling on the lintel below.',
  ], interactable: true },
  { name: 'Strange Altar', descriptions: [
    'A low stone slab occupies the center of the room, its surface stained dark. Melted candle stubs ring its edges, and the air smells faintly of old incense.',
  ], interactable: true },
  { name: 'Torn Map', descriptions: [
    'Pinned to the wall with a dagger, a brittle piece of parchment shows a partial map. Several rooms are marked with X\'s, and a passage is circled in red ink.',
  ], interactable: true, loot: true },
];

// ── Bug #31 additions: themed location pools ──────────────────────────
// Before #31 we had only TOWN_ITEMS / TAVERN_ITEMS / DUNGEON_ITEMS, and
// everything else (temples, graveyards, shops, smithies, caves) fell into
// the "town" bucket with items like "Barrel of Ale" showing up in a
// cathedral. Each pool below is a small themed set used by the category
// fallback when narrative extraction does not yield enough items.

const TEMPLE_ITEMS = [
  { name: 'Stone Altar', descriptions: [
    'A broad stone altar occupies the dais, its surface worn smooth by centuries of offerings. Wax residue mottles the edges.',
    'The altar is plain granite, draped in a faded cloth. A holy symbol is chiseled into its front face.',
  ], interactable: true },
  { name: 'Prayer Candles', descriptions: [
    'Rows of iron candle-stands hold hundreds of small tapers. Most are unlit; a few burn for recent petitions.',
    'A rack of prayer candles flickers near the door. The wax has pooled into a thick, tallow-stained mat below.',
  ], mundane: true, interactable: true },
  { name: 'Offering Bowl', descriptions: [
    'A small bronze bowl sits at the foot of the altar, half-filled with copper coins and pressed flowers.',
  ], loot: true, interactable: true, goldDice: 4 },
  { name: 'Tattered Banner', descriptions: [
    'A faded banner hangs above the doorway, its sigil too worn to read at a glance.',
    'A silk banner embroidered with the faith\'s crest is pinned to the chancel wall. The gold thread has tarnished black.',
  ], mundane: true },
  { name: 'Reliquary', descriptions: [
    'A small silver box sits in a wall niche behind a latticed screen. Through the slats, something glints.',
  ], interactable: true, loot: true, minLevel: 2 },
  { name: 'Holy Water Font', descriptions: [
    'A carved stone basin stands by the entrance, its water disturbed by a single ripple.',
  ], interactable: true },
];

const GRAVEYARD_ITEMS = [
  { name: 'Weathered Tombstone', descriptions: [
    'A leaning headstone pokes crookedly from the grass. The epitaph is nearly worn away — you can only make out a name and a date.',
    'A tombstone split by a tree root. The crack runs diagonally across the carved face.',
  ], interactable: true },
  { name: 'Withered Flowers', descriptions: [
    'A bundle of dried flowers lies on a grave, tied with a faded ribbon. They were fresh not so long ago.',
  ], mundane: true },
  { name: 'Funerary Urn', descriptions: [
    'A ceramic urn rests on a short stone plinth. One side is chipped, revealing something pale inside.',
  ], interactable: true },
  { name: 'Sunken Grave', descriptions: [
    'A grave has subsided into a low depression. The soil is dark and loose at the center.',
  ], interactable: true },
  { name: 'Crow on a Branch', descriptions: [
    'A single crow watches from a low branch, head tilted with unnerving intelligence.',
  ], mundane: true },
  { name: 'Mausoleum Door', descriptions: [
    'A stone mausoleum stands at the graveyard\'s edge, its iron-banded door hanging slightly ajar.',
  ], interactable: true },
];

const SMITHY_ITEMS = [
  { name: 'Anvil', descriptions: [
    'A massive iron anvil sits at the center of the forge, its face polished mirror-bright from years of strikes.',
  ], interactable: true },
  { name: 'Forge', descriptions: [
    'Coals glow orange in a stone forge, exhaling heat in waves. Tongs and hammers hang on hooks within arm\'s reach.',
  ], interactable: true },
  { name: 'Quench Barrel', descriptions: [
    'A wide oak barrel squats beside the anvil, its water black with forge-scale and half-skinned with oil.',
  ], mundane: true },
  { name: 'Weapon Rack', descriptions: [
    'A rack against the back wall holds finished blades — several daggers, a well-made longsword, a pair of handaxes.',
  ], interactable: true, loot: true, minLevel: 1 },
  { name: 'Bellows', descriptions: [
    'A great leather bellows hangs from a wooden frame, its nozzle pointed at the forge\'s heart.',
  ], mundane: true },
  { name: 'Horseshoes on a Hook', descriptions: [
    'A string of horseshoes dangles from a nail, ready for the next farrier job.',
  ], mundane: true },
];

const MARKET_ITEMS = [
  { name: 'Produce Stall', descriptions: [
    'A wooden stall sags under baskets of late-season apples, cabbages, and a few glistening fish on ice.',
  ], interactable: true },
  { name: 'Fabric Bolts', descriptions: [
    'Bolts of cloth in muted dyes lean against a merchant\'s table — linen, wool, a single roll of bright red silk.',
  ], interactable: true },
  { name: 'Merchant\'s Scale', descriptions: [
    'A brass scale sits on the counter, its pans gently swaying each time a customer brushes past.',
  ], interactable: true },
  { name: 'Haggling Customers', descriptions: [
    'Two locals argue over the price of a copper pot, the stallkeeper waiting patiently with arms crossed.',
  ], mundane: true },
  { name: 'Notice Board', descriptions: [
    'A weathered board beside the market well is plastered with overlapping handbills and bounty notices.',
  ], interactable: true },
];

// ── Location-category resolver ────────────────────────────────────────
// Looks at (in order of authority):
//   1. location.node.kind / location.kind    — world-tree node kind
//   2. location.ancestryNames / location.ancestryKinds — breadcrumb walk
//      (lets a "Common Room" inside a "building" whose ancestor is "The
//      Rusty Dragon Inn" resolve as `tavern`, not fall through to `town`)
//   3. location.name, location.terrain, location.tags — legacy keys
// and returns a semantic category. The legacy terrain split
// (town/dungeon) is the last-resort fallback.
//
// Bug #49 — we used to squash "PCs are in the Rusty Dragon common room"
// down to the parent town; now the nested node kind wins so DM narration
// + category-scoped helpers see the right granularity.
function resolveLocationCategory(location) {
  const name = (location?.name || '').toLowerCase();
  const terrain = (location?.terrain || '').toLowerCase();
  const tags = Array.isArray(location?.tags)
    ? location.tags.map(t => String(t).toLowerCase())
    : [];
  // World-tree hints (optional — callers that thread node + breadcrumb).
  const nodeKind = String(
    location?.node?.kind || location?.kind || ''
  ).toLowerCase();
  const ancestryNames = Array.isArray(location?.ancestryNames)
    ? location.ancestryNames.map(n => String(n || '').toLowerCase())
    : [];
  const ancestryKinds = Array.isArray(location?.ancestryKinds)
    ? location.ancestryKinds.map(k => String(k || '').toLowerCase())
    : [];

  const hit = (...needles) =>
    needles.some(n =>
      name.includes(n) ||
      tags.includes(n) ||
      ancestryNames.some(a => a.includes(n))
    );

  // Direct node-kind signal wins when we recognize it.
  if (nodeKind === 'tavern') return 'tavern';
  if (nodeKind === 'temple') return 'temple';
  if (nodeKind === 'graveyard') return 'graveyard';
  if (nodeKind === 'smithy') return 'smithy';
  if (nodeKind === 'market') return 'market';
  if (nodeKind === 'crypt') return 'crypt';
  if (nodeKind === 'cave') return 'cave';
  if (nodeKind === 'dungeon' || ancestryKinds.includes('dungeon')) return 'dungeon';

  // Name/tag/ancestry-name pattern match.
  if (hit('tavern', 'inn', 'alehouse', 'feedbag', 'dragon', 'pub')) return 'tavern';
  if (hit('temple', 'cathedral', 'chapel', 'shrine', 'sanctuary', 'church')) return 'temple';
  if (hit('graveyard', 'cemetery', 'boneyard', 'tomb yard')) return 'graveyard';
  if (hit('smithy', 'forge', 'blacksmith')) return 'smithy';
  if (hit('market', 'bazaar', 'plaza', 'square', 'commons')) return 'market';
  if (hit('crypt', 'mausoleum', 'ossuary', 'catacomb')) return 'crypt';
  if (hit('cave', 'cavern', 'grotto')) return 'cave';

  if (terrain === 'town' || terrain === 'city') return 'town';
  if (terrain === 'tavern') return 'tavern';
  if (terrain === 'temple') return 'temple';
  if (terrain === 'dungeon' || terrain === 'underground') return 'dungeon';

  // Town-ish node kinds fall through to 'town'.
  if (nodeKind === 'town' || nodeKind === 'city' || nodeKind === 'village') return 'town';
  if (ancestryKinds.includes('town') || ancestryKinds.includes('city') || ancestryKinds.includes('village')) {
    return 'town';
  }

  return 'town';
}

function pickFromPool(pool, { avgLevel = 1, lootChance = 0.25, interactChance = 0.2, mundaneChance = 0.35 } = {}) {
  const out = [];
  for (const template of pool) {
    if (template.minLevel && avgLevel < template.minLevel) continue;
    const chance = template.loot ? lootChance : template.interactable ? interactChance : mundaneChance;
    if (Math.random() < chance) {
      out.push({
        name: template.name,
        description: pick(template.descriptions),
        mundane: template.mundane || false,
        interactable: template.interactable || false,
        loot: template.loot || false,
        gold: template.goldDice ? roll(template.goldDice) : undefined,
        item: template.item || undefined,
        _source: 'themed',
      });
    }
  }
  return out;
}

// ── Themed NPC archetype pools ───────────────────────────────────────
// Bug #50 — NPCs should populate with the same narrative + themed-fallback
// pattern area items use. Each entry is a partial `generateNPC` option
// bundle: the theme-appropriate occupation (required), plus optional
// class / disposition / personality hints. Keep presets small so the
// generator can still vary race/stats/appearance.
const THEMED_NPC_POOLS = {
  tavern: [
    { occupation: 'innkeeper', personality: 'jovial', disposition: 'friendly' },
    { occupation: 'bard', class: 'Bard', personality: 'boisterous' },
    { occupation: 'sailor', personality: 'gruff', disposition: 'neutral' },
    { occupation: 'merchant', disposition: 'neutral' },
    { occupation: 'hunter', personality: 'gruff' },
    { occupation: 'beggar', disposition: 'wary' },
  ],
  temple: [
    { occupation: 'priest', class: 'Cleric', personality: 'pious', disposition: 'friendly' },
    { occupation: 'priest', class: 'Adept', personality: 'pious' },
    { occupation: 'scholar', class: 'Expert', personality: 'pious' },
    { occupation: 'beggar', personality: 'melancholy' },
  ],
  graveyard: [
    { occupation: 'priest', class: 'Cleric', personality: 'melancholy', disposition: 'neutral' },
    { occupation: 'farmer', personality: 'melancholy' },
    { occupation: 'beggar', personality: 'melancholy' },
  ],
  smithy: [
    { occupation: 'blacksmith', class: 'Expert', personality: 'gruff', disposition: 'neutral' },
    { occupation: 'blacksmith', class: 'Warrior', personality: 'stern' },
    { occupation: 'soldier', class: 'Fighter', personality: 'stern' },
  ],
  market: [
    { occupation: 'merchant', class: 'Expert', personality: 'jovial', disposition: 'friendly' },
    { occupation: 'merchant', class: 'Expert', personality: 'cunning' },
    { occupation: 'farmer', personality: 'jovial' },
    { occupation: 'guard', class: 'Warrior', personality: 'stern' },
    { occupation: 'beggar', disposition: 'wary' },
  ],
  crypt: [
    { occupation: 'priest', class: 'Cleric', personality: 'secretive' },
    { occupation: 'thief', class: 'Rogue', personality: 'cunning', disposition: 'wary' },
  ],
  cave: [
    { occupation: 'hunter', class: 'Ranger', personality: 'gruff', disposition: 'wary' },
    { occupation: 'miner', class: 'Commoner', personality: 'gruff' },
    { occupation: 'thief', class: 'Rogue', personality: 'secretive', disposition: 'wary' },
  ],
  dungeon: [
    { occupation: 'thief', class: 'Rogue', personality: 'cunning', disposition: 'wary' },
    { occupation: 'soldier', class: 'Fighter', personality: 'stern', disposition: 'hostile' },
    { occupation: 'scholar', class: 'Wizard', personality: 'secretive' },
  ],
  town: [
    { occupation: 'merchant', disposition: 'friendly' },
    { occupation: 'guard', class: 'Warrior', personality: 'stern' },
    { occupation: 'innkeeper', personality: 'jovial' },
    { occupation: 'farmer', personality: 'jovial' },
    { occupation: 'priest', class: 'Cleric', personality: 'pious' },
    { occupation: 'bard', class: 'Bard', personality: 'boisterous' },
    { occupation: 'beggar', disposition: 'wary' },
    { occupation: 'noble', class: 'Aristocrat', personality: 'noble' },
  ],
};

// Default NPC count targets by category. Town-like scenes feel populated;
// dungeons are usually empty (enemies come through combat, not the NPC
// panel). Overridable via opts.targetCount.
const DEFAULT_NPC_COUNT_BY_CATEGORY = {
  tavern: 3,
  temple: 2,
  graveyard: 1,
  smithy: 2,
  market: 3,
  town: 3,
  crypt: 0,
  cave: 0,
  dungeon: 0,
};

function pickThemedNPCPreset(category) {
  const pool = THEMED_NPC_POOLS[category] || THEMED_NPC_POOLS.town;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate the initial set of "nearby" NPCs for a location.
 *
 * Bug #50: mirrors the generateAreaItems pattern — narrative extraction
 * first (so a named speaker in loc.desc/AI intro lands as an NPC record),
 * then a location-themed pool fallback so the NPC's occupation/class
 * reflect the scene (temple → priest, smithy → blacksmith, tavern →
 * innkeeper/bard, etc.). Previously AdventureTab.startAdventure spawned
 * 2-4 purely random NPCs per town with no theming and no narrative link,
 * so area items and NPCs felt wired to different worlds.
 *
 * Returns NPC records produced by generateNPC() — caller still owns
 * persistence (storeNPC) and portrait generation so async callers aren't
 * forced through here.
 *
 * @param {object} location         - location object (name, terrain, tags).
 * @param {number} [avgLevel]       - party avg level (drives NPC level roll).
 * @param {object} [opts]
 * @param {string} [opts.narrative] - most recent DM narration (loc.desc + AI intro).
 * @param {string[]} [opts.partyNames]    - forwarded to extractor so PCs aren't captured.
 * @param {string[]} [opts.knownNpcNames] - forwarded so dupes aren't re-spawned.
 * @param {number} [opts.targetCount]     - override default-by-category.
 * @returns {object[]} NPC records (NOT yet stored).
 */
export function generateNearbyNPCs(location, avgLevel = 1, opts = {}) {
  const category = resolveLocationCategory(location);
  const narrative = typeof opts.narrative === 'string' ? opts.narrative : '';
  const partyNames = Array.isArray(opts.partyNames) ? opts.partyNames : [];
  const knownNpcNames = Array.isArray(opts.knownNpcNames) ? opts.knownNpcNames : [];
  const targetCount = typeof opts.targetCount === 'number'
    ? Math.max(0, opts.targetCount)
    : DEFAULT_NPC_COUNT_BY_CATEGORY[category] ?? 2;

  const out = [];
  const seenNames = new Set([
    ...partyNames.map(n => (n || '').toLowerCase()),
    ...knownNpcNames.map(n => (n || '').toLowerCase()),
  ]);

  // ── Pass 1: narrative extraction ────────────────────────────────────
  let narrativeHits = [];
  if (narrative) {
    try {
      narrativeHits = extractNPCsFromNarration(narrative, {
        partyNames,
        knownNpcNames,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[nearbyNPCs] narrative extraction failed:', err);
    }
  }
  for (const hit of narrativeHits) {
    const key = (hit.name || '').toLowerCase();
    if (!key || seenNames.has(key)) continue;
    seenNames.add(key);
    const preset = pickThemedNPCPreset(category);
    const npc = generateNPC({
      name: hit.name,
      location: location?.name || '',
      level: Math.max(
        1,
        Math.floor(avgLevel) + Math.floor(Math.random() * 3) - 1,
      ),
      ...preset,
    });
    // Preserve the evidence snippet as shortDesc / firstImpression so the
    // panel reads like the DM-described figure, not a random line.
    if (hit.shortDesc) {
      npc.shortDesc = hit.shortDesc;
      npc.firstImpression = hit.shortDesc;
    }
    // A named introduction means the party learned the name in-scene.
    npc.knownToParty = true;
    npc._source = 'narrative';
    out.push(npc);
  }

  // ── Pass 2: themed-pool fallback ────────────────────────────────────
  const needed = Math.max(0, targetCount - out.length);
  for (let i = 0; i < needed; i++) {
    const preset = pickThemedNPCPreset(category);
    const npc = generateNPC({
      location: location?.name || '',
      level: Math.max(
        1,
        Math.floor(avgLevel) + Math.floor(Math.random() * 3) - 1,
      ),
      ...preset,
    });
    // These NPCs are seen from a distance — name stays hidden until the
    // party interacts (per NPC-names feedback memory).
    npc.knownToParty = false;
    npc._source = 'themed';
    // Dedup by name (generated names can collide across a town seed).
    const key = (npc.name || '').toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push(npc);
  }

  try {
    traceEngine('npcs:generate', {
      category,
      narrative: !!narrative,
      narrativeCount: out.filter(n => n._source === 'narrative').length,
      fallbackCount: out.filter(n => n._source === 'themed').length,
      total: out.length,
      target: targetCount,
      location: location?.name,
    });
  } catch { /* trace never blocks */ }

  return out;
}

/**
 * Generate area items for a location.
 *
 * Bug #31 fix (narrative-only): items are extracted from DM narration
 * exclusively. The themed-pool fallback (bar items in bars, crates in
 * alleys, etc.) has been removed because it spawned mismatched props —
 * carpets on docks, braziers in caves — and violated the
 * narrative-authoritative principle. If the narration doesn't mention
 * an object, the area surfaces nothing. The category resolver and the
 * TOWN_ITEMS / TAVERN_ITEMS / etc. pools are preserved for a possible
 * future opt-in GM seed button, but they no longer run automatically.
 *
 * @param {object} location         - location object (name, terrain, tags).
 * @param {number} [avgLevel]       - party avg level (reserved; unused post-#31).
 * @param {object} [opts]
 * @param {string} [opts.narrative] - most recent DM narration for extraction.
 * @param {Array}  [opts.existing]  - currently-visible items (dedup target).
 * @param {number} [opts.cap]       - final cap (default 6).
 */
export function generateAreaItems(location, avgLevel = 1, opts = {}) {
  const cap = typeof opts.cap === 'number' ? opts.cap : 6;
  const narrative = typeof opts.narrative === 'string' ? opts.narrative : '';
  const existing = Array.isArray(opts.existing) ? opts.existing : [];
  const category = resolveLocationCategory(location);

  // ── Narrative extraction (sole source) ──────────────────────────────
  // Per bug #31 fix: area items are narrative-only. If the DM just
  // narrated "a bronze brazier in the corner," the panel surfaces that
  // and nothing else. If narration mentions no objects, the area stays
  // empty — no themed-pool auto-fill, no random torches, no mismatched
  // crates in the middle of a temple. A future opt-in GM seed button
  // may reintroduce themed pools (TOWN_ITEMS, TAVERN_ITEMS, etc. are
  // preserved above for that purpose), but they no longer run
  // automatically.
  let narrativeItems = [];
  if (narrative) {
    try {
      narrativeItems = extractAreaItemsFromNarrative(narrative, {
        existing,
        max: cap,
      });
    } catch (err) {
      // Non-fatal — heuristics shouldn't block scene generation.
      // eslint-disable-next-line no-console
      console.warn('[areaItems] narrative extraction failed:', err);
    }
  }

  const items = narrativeItems.slice(0, cap);

  try {
    traceEngine('areaItems:generate', {
      category,
      narrative: !!narrative,
      narrativeCount: narrativeItems.length,
      fallbackCount: 0,
      total: items.length,
      location: location?.name,
      mode: 'narrative-only',
    });
  } catch { /* trace never blocks */ }

  return items;
}
