/**
 * AI-powered character builder for Pathfinder 1e.
 * Sends a natural-language concept to Claude and gets back a complete character sheet.
 */
import { uid, mod, getMaxHP } from '../utils/dice';
import { getStartingGold } from '../utils/character';
import classesData from '../data/classes.json';
import racesData from '../data/races.json';

const classesMap = {};
classesData.forEach(c => { classesMap[c.name] = c; });

const racesMap = {};
racesData.forEach(r => { racesMap[r.name] = r; });

function getSettings() {
  try {
    const saved = localStorage.getItem('pf-dm-settings');
    return saved ? JSON.parse(saved) : { apiKey: '', model: 'claude-sonnet-4-6' };
  } catch { return { apiKey: '', model: 'claude-sonnet-4-6' }; }
}

const VALID_RACES = racesData.map(r => r.name);
const VALID_CLASSES = classesData.map(c => c.name);

const CHARACTER_BUILD_PROMPT = `You are a Pathfinder 1st Edition character builder. Given a player's concept, create a COMPLETE, rules-legal character.

AVAILABLE RACES: ${VALID_RACES.join(', ')}
AVAILABLE CLASSES: ${VALID_CLASSES.join(', ')}

RULES:
- Ability scores use 20-point buy. Base 10 costs 0. Costs: 10=0,11=1,12=2,13=3,14=5,15=7,16=10,17=13,18=17. Points cannot go negative.
- Apply racial ability modifiers AFTER point buy (e.g., Dwarf gets +2 CON, +2 WIS, -2 CHA).
- Choose feats the character qualifies for at their level. Fighters get bonus combat feats. Humans get a bonus feat at 1st level.
- Skill ranks per level = class skill ranks + INT modifier (minimum 1). Humans get +1/level. Pick appropriate skills.
- For casters, pick level-appropriate spells they would know/prepare.
- Choose equipment appropriate to their class, fighting style, and level.
- Create a rich backstory (2-3 paragraphs) with personality traits, motivations, a key event, and a connection hook for adventuring.
- Pick an alignment that fits the concept.

GOLARION ETHNICITIES (for humans): Chelaxian (Cheliax — pale, dark hair, disciplined), Garundi (Osirion — dark skin, scholarly), Keleshite (Qadira — olive skin, traders), Kellid (Numeria — tanned, tribal warriors), Mwangi (Mwangi Expanse — dark skin, diverse cultures), Shoanti (Varisia Storval Plateau — bronze, tattooed warriors), Taldan (Taldor — fair, refined nobility), Tian (Tian Xia — East Asian, honor/martial arts), Ulfen (Linnorm Kings — fair/blond, Viking raiders), Varisian (Varisia — olive skin, nomadic storytellers), Vudrani (Vudra — brown skin, philosophical).

NON-HUMAN ORIGINS: Dwarves from Janderhoff/Highhelm/Kraggodan, Elves from Kyonin/Mierani Forest/Ekujae/Forlorn, Gnomes from Brastlewark/Wanderer, Half-Elves from Absalom/Varisia, Half-Orcs from Hold of Belkzen/Magnimar, Halflings from Cheliax/Andoran/Varisian Caravans.

Respond with ONLY a JSON object (no markdown fences, no explanation) with these exact fields:
{
  "name": "string",
  "race": "one of the available races",
  "class": "one of the available classes",
  "alignment": "e.g. Chaotic Good",
  "ethnicity": "for humans: one of the Golarion ethnicities; for others: race name",
  "origin": "homeland or settlement name from Golarion",
  "languages": ["Common", "other appropriate languages"],
  "level": number,
  "abilities": { "STR": n, "DEX": n, "CON": n, "INT": n, "WIS": n, "CHA": n },
  "feats": ["feat names"],
  "weaponNames": ["weapon names from PF1e equipment"],
  "armorName": "armor name or None",
  "shieldName": "shield name or None",
  "skillRanks": { "Skill Name": ranks },
  "spellsKnown": ["spell names"] or [],
  "spellsPrepared": ["spell names"] or [],
  "domains": ["domain names"] or [],
  "favoredEnemy": "creature type" or null,
  "bloodline": "bloodline name" or null,
  "backstory": "2-3 paragraph backstory that incorporates their ethnicity and homeland",
  "personality": "one-line personality summary",
  "appearance": "brief physical description reflecting their ethnicity",
  "inventory": ["gear item names"]
}`;

/**
 * Call Claude to generate a character from a concept prompt.
 * @param {string} concept - e.g. "I am a dwarf ranger who fights with a crossbow at level 2"
 * @returns {Promise<object>} Complete character object ready for the party
 */
export async function aiQuickCreate(concept) {
  const settings = getSettings();
  if (!settings.apiKey) {
    throw new Error('No API key configured. Go to Settings and add your Claude API key.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model || 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: CHARACTER_BUILD_PROMPT,
        messages: [{ role: 'user', content: `Create a character from this concept: "${concept}"` }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    // Extract JSON from response (handle possible markdown fences)
    let jsonStr = rawText.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr);
    return buildCharacterFromAI(parsed);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Character generation timed out. Try again or use a faster model.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate a backstory for an existing character/template via AI.
 * @param {object} char - Character with name, race, class, alignment, desc
 * @returns {Promise<string>} Generated backstory
 */
export async function generateBackstory(char) {
  const settings = getSettings();
  if (!settings.apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model || 'claude-sonnet-4-6',
        max_tokens: 600,
        system: 'You are a creative writer for Pathfinder 1st Edition RPG. Write rich, immersive character backstories set in Golarion (the Pathfinder setting). Include personality traits, a formative event, motivations, and a reason they became an adventurer. Keep it 2-3 paragraphs. Write ONLY the backstory text, no headers or labels.',
        messages: [{
          role: 'user',
          content: `Write a backstory for: ${char.name}, a ${char.alignment} ${char.race} ${char.class}. ${char.desc || ''} ${char.roleTip || ''}`
        }],
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert AI-generated character data into a full game-ready character object.
 */
function buildCharacterFromAI(ai) {
  // Validate and normalize race/class
  const race = VALID_RACES.find(r => r.toLowerCase() === (ai.race || '').toLowerCase()) || 'Human';
  const cls = VALID_CLASSES.find(c => c.toLowerCase() === (ai.class || '').toLowerCase()) || 'Fighter';
  const level = Math.max(1, Math.min(20, ai.level || 1));
  const classInfo = classesMap[cls];

  // Abilities (with sanity bounds)
  const abilities = {};
  ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(a => {
    abilities[a] = Math.max(3, Math.min(30, ai.abilities?.[a] || 10));
  });

  // Compute HP
  const maxHP = getMaxHP(cls, level, mod(abilities.CON), classesMap);

  // Build weapon objects
  const weaponNames = ai.weaponNames || [];
  const weapons = weaponNames.map(name => ({ name, dmg: guessWeaponDamage(name) }));

  // Build equipment list
  const equipment = [];
  weaponNames.forEach(w => equipment.push({ name: w, equipped: true, type: 'weapon' }));
  if (ai.armorName && ai.armorName !== 'None') {
    equipment.push({ name: ai.armorName, equipped: true, type: 'armor' });
  }
  if (ai.shieldName && ai.shieldName !== 'None') {
    equipment.push({ name: ai.shieldName, equipped: true, type: 'shield' });
  }

  // Compute AC (simplified)
  const armorBonus = guessArmorBonus(ai.armorName);
  const shieldBonus = guessShieldBonus(ai.shieldName);
  const maxDex = guessMaxDex(ai.armorName);
  const dexMod = Math.min(mod(abilities.DEX), maxDex);
  const ac = 10 + dexMod + armorBonus + shieldBonus;

  // Build inventory
  const inventory = (ai.inventory || []).map(item => {
    const qtyMatch = item.match(/\((\d+)\)$/);
    return {
      name: qtyMatch ? item.replace(/\s*\(\d+\)$/, '') : item,
      quantity: qtyMatch ? parseInt(qtyMatch[1]) : 1,
      type: 'gear',
    };
  });

  // Toughness bonus
  const hasToughness = (ai.feats || []).some(f => f.toLowerCase() === 'toughness');
  const toughnessHP = hasToughness ? Math.max(3, level) : 0;

  const char = {
    id: uid(),
    name: ai.name || 'Unnamed Hero',
    race,
    class: cls,
    alignment: ai.alignment || 'True Neutral',
    level,
    xp: 0,
    abilities,
    feats: ai.feats || [],
    weapons,
    armor: ai.armorName || 'None',
    shield: ai.shieldName || 'None',
    conditions: [],
    equipment,
    inventory,
    maxHP: maxHP + toughnessHP,
    currentHP: maxHP + toughnessHP,
    ac,
    gold: getStartingGold(cls),
    skillRanks: ai.skillRanks || {},
    spellsKnown: ai.spellsKnown || [],
    spellsPrepared: ai.spellsPrepared || [],
    spellSlotsUsed: {},
    ethnicity: ai.ethnicity || race,
    origin: ai.origin || '',
    languages: ai.languages || ['Common'],
    backstory: ai.backstory || '',
    personality: ai.personality || '',
    appearance: ai.appearance || '',
    notes: '',
  };

  // Optional class-specific fields
  if (ai.domains?.length) char.domains = ai.domains;
  if (ai.favoredEnemy) char.favoredEnemy = ai.favoredEnemy;
  if (ai.bloodline) char.bloodline = ai.bloodline;

  return char;
}

// ─── Simple lookup tables for AC computation ───

function guessWeaponDamage(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('greatsword') || n.includes('greataxe')) return '2d6';
  if (n.includes('longsword') || n.includes('battleaxe') || n.includes('rapier') || n.includes('scimitar') || n.includes('warhammer')) return '1d8';
  if (n.includes('short sword') || n.includes('shortsword')) return '1d6';
  if (n.includes('dagger') || n.includes('sickle')) return '1d4';
  if (n.includes('longbow') || n.includes('heavy crossbow') || n.includes('mace, heavy') || n.includes('heavy mace')) return '1d8';
  if (n.includes('shortbow') || n.includes('light crossbow') || n.includes('mace, light') || n.includes('light mace')) return '1d6';
  if (n.includes('quarterstaff') || n.includes('spear') || n.includes('morningstar')) return '1d6';
  if (n.includes('greatclub') || n.includes('falchion')) return '2d4';
  if (n.includes('halberd') || n.includes('glaive') || n.includes('guisarme')) return '1d10';
  if (n.includes('javelin')) return '1d6';
  if (n.includes('sling')) return '1d4';
  return '1d6';
}

function guessArmorBonus(name) {
  const n = (name || '').toLowerCase();
  if (n === 'none' || !n) return 0;
  if (n.includes('full plate')) return 9;
  if (n.includes('half-plate') || n.includes('half plate')) return 8;
  if (n.includes('banded') || n.includes('splint')) return 7;
  if (n.includes('breastplate') && !n.includes('agile')) return 6;
  if (n.includes('chainmail') || n.includes('chain mail')) return 6;
  if (n.includes('scale mail') || n.includes('scale')) return 5;
  if (n.includes('chain shirt')) return 4;
  if (n.includes('hide')) return 4;
  if (n.includes('studded leather') || n.includes('studded')) return 3;
  if (n.includes('leather')) return 2;
  if (n.includes('padded')) return 1;
  return 0;
}

function guessShieldBonus(name) {
  const n = (name || '').toLowerCase();
  if (n === 'none' || !n) return 0;
  if (n.includes('tower')) return 4;
  if (n.includes('heavy')) return 2;
  if (n.includes('light')) return 1;
  if (n.includes('buckler')) return 1;
  return 1;
}

function guessMaxDex(name) {
  const n = (name || '').toLowerCase();
  if (n === 'none' || !n) return 99;
  if (n.includes('full plate')) return 1;
  if (n.includes('half-plate') || n.includes('half plate')) return 0;
  if (n.includes('banded') || n.includes('splint')) return 1;
  if (n.includes('breastplate')) return 3;
  if (n.includes('chainmail') || n.includes('chain mail')) return 2;
  if (n.includes('scale')) return 3;
  if (n.includes('chain shirt')) return 4;
  if (n.includes('hide')) return 4;
  if (n.includes('studded')) return 5;
  if (n.includes('leather')) return 6;
  if (n.includes('padded')) return 8;
  return 99;
}
