/**
 * heroLabService.js — Hero Lab Classic Import/Export for PF1e
 * Supports XML parsing and stat block text parsing
 */

import { uid, mod, calcBAB, calcSave, getMaxHP } from '../utils/dice';
import classesData from '../data/classes.json';

const classesMap = {};
classesData.forEach(c => { classesMap[c.name] = c; });

/**
 * Parse Hero Lab XML export into our character format
 * Handles partial data gracefully - missing fields use defaults
 */
export function parseHeroLabXML(xmlString) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'application/xml');

    // Check for parsing errors
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Invalid XML: Unable to parse document');
    }

    // Find the character element
    const charElem = doc.querySelector('character') || doc.querySelector('public character');
    if (!charElem) {
      throw new Error('No character element found in XML');
    }

    // Basic info
    const name = charElem.getAttribute('name') || 'Imported Character';
    const race = getXMLValue(doc, 'race', 'name') || 'Human';
    const alignment = getXMLValue(doc, 'alignment', 'name') || 'Neutral';
    const size = getXMLValue(doc, 'size', 'name') || 'Medium';

    // Class and level
    const className = getXMLValue(doc, 'class', 'name') || 'Fighter';
    const level = parseInt(getXMLValue(doc, 'class', 'level')) || 1;
    const xp = parseInt(getXMLValue(doc, 'experience', 'value')) || 0;

    // Ability scores
    const abilities = {
      STR: parseInt(getXMLModifiedValue(doc, 'STR')) || 10,
      DEX: parseInt(getXMLModifiedValue(doc, 'DEX')) || 10,
      CON: parseInt(getXMLModifiedValue(doc, 'CON')) || 10,
      INT: parseInt(getXMLModifiedValue(doc, 'INT')) || 10,
      WIS: parseInt(getXMLModifiedValue(doc, 'WIS')) || 10,
      CHA: parseInt(getXMLModifiedValue(doc, 'CHA')) || 10,
    };

    // Hit points
    const hpElem = doc.querySelector('hitpoints');
    const maxHP = hpElem ? parseInt(hpElem.getAttribute('total')) || 0 : 0;
    const currentHP = hpElem ? parseInt(hpElem.getAttribute('current')) || maxHP : maxHP;

    // AC
    const acElem = doc.querySelector('ac');
    const ac = acElem ? parseInt(acElem.getAttribute('total')) || 10 : 10;

    // Speed
    const speedElem = doc.querySelector('speed');
    const speed = speedElem ? parseInt(speedElem.getAttribute('value')) || 30 : 30;

    // Saving throws (Hero Lab often stores these)
    const saves = {
      fort: parseInt(getXMLValue(doc, 'savingthrow[name="Fortitude"]', 'base')) || 0,
      ref: parseInt(getXMLValue(doc, 'savingthrow[name="Reflex"]', 'base')) || 0,
      will: parseInt(getXMLValue(doc, 'savingthrow[name="Will"]', 'base')) || 0,
    };

    // Initiative
    const initElem = doc.querySelector('initiative');
    const initiative = initElem ? parseInt(initElem.getAttribute('total')) || 0 : 0;

    // Money - Hero Lab stores in platinum, gold, silver, copper
    const moneyElem = doc.querySelector('money');
    let gold = 0;
    if (moneyElem) {
      const pp = parseInt(moneyElem.getAttribute('pp')) || 0;
      gold = parseInt(moneyElem.getAttribute('gp')) || 0;
      const sp = parseInt(moneyElem.getAttribute('sp')) || 0;
      const cp = parseInt(moneyElem.getAttribute('cp')) || 0;
      gold = pp * 10 + gold + sp * 0.1 + cp * 0.01;
    }
    gold = Math.max(0, gold);

    // Parse feats
    const feats = [];
    doc.querySelectorAll('feat').forEach(featElem => {
      const featName = featElem.getAttribute('name');
      if (featName && !feats.includes(featName)) {
        feats.push(featName);
      }
    });

    // Parse skills
    const skillRanks = {};
    doc.querySelectorAll('skill').forEach(skillElem => {
      const skillName = skillElem.getAttribute('name');
      const ranks = parseInt(skillElem.getAttribute('ranks')) || 0;
      if (skillName && ranks > 0) {
        skillRanks[skillName] = ranks;
      }
    });

    // Parse weapons
    const weapons = [];
    doc.querySelectorAll('attack').forEach(atkElem => {
      const name = atkElem.getAttribute('name');
      const dmg = atkElem.getAttribute('damage');
      if (name) {
        weapons.push({ name, dmg: dmg || '1d4' });
      }
    });

    // Parse armor/shield
    const armorElem = doc.querySelector('armor');
    const armor = armorElem ? armorElem.getAttribute('name') || 'None' : 'None';

    const shieldElem = doc.querySelector('shield');
    const shield = shieldElem ? shieldElem.getAttribute('name') || 'None' : 'None';

    // Parse equipment
    const equipment = [];
    doc.querySelectorAll('item').forEach(itemElem => {
      const itemName = itemElem.getAttribute('name');
      const equipped = itemElem.getAttribute('equipped') === 'true';
      const type = itemElem.getAttribute('type') || 'gear';
      if (itemName) {
        equipment.push({ name: itemName, equipped, type });
      }
    });

    // Parse inventory
    const inventory = [];
    doc.querySelectorAll('carried').forEach(carryElem => {
      const itemName = carryElem.getAttribute('name');
      const quantity = parseInt(carryElem.getAttribute('quantity')) || 1;
      const type = carryElem.getAttribute('type') || 'gear';
      if (itemName) {
        inventory.push({ name: itemName, quantity, type });
      }
    });

    // Parse special traits/class abilities
    const conditions = [];
    doc.querySelectorAll('special').forEach(specialElem => {
      const specialName = specialElem.getAttribute('name');
      if (specialName && !conditions.includes(specialName)) {
        conditions.push(specialName);
      }
    });

    // Build character object matching our schema
    const character = {
      id: uid(),
      name,
      race,
      class: className,
      alignment,
      size,
      level,
      xp,
      abilities,
      maxHP: maxHP || 1,
      currentHP: currentHP || 1,
      ac,
      speed,
      saves,
      initiative,
      gold,
      feats,
      skillRanks,
      weapons,
      armor,
      shield,
      equipment,
      inventory,
      conditions,
      spellsKnown: [],
      spellsPrepared: [],
      spellSlotsUsed: {},
      notes: `Imported from Hero Lab Classic`,
    };

    return validateCharacter(character);
  } catch (error) {
    throw new Error(`XML parsing failed: ${error.message}`);
  }
}

/**
 * Helper to get XML attribute value
 */
function getXMLValue(doc, selector, attrName) {
  try {
    const elem = doc.querySelector(selector);
    return elem ? elem.getAttribute(attrName) : null;
  } catch {
    return null;
  }
}

/**
 * Helper to get modified ability score from Hero Lab
 * Hero Lab stores both base and modified values
 */
function getXMLModifiedValue(doc, abilityShort) {
  try {
    // Full names for ability scores
    const abilityMap = {
      STR: 'Strength',
      DEX: 'Dexterity',
      CON: 'Constitution',
      INT: 'Intelligence',
      WIS: 'Wisdom',
      CHA: 'Charisma',
    };

    const fullName = abilityMap[abilityShort];
    const elem = doc.querySelector(`abilityscore[name="${fullName}"]`);

    if (!elem) return null;

    // Prefer modified over base
    const modified = elem.getAttribute('modified');
    if (modified) return modified;

    return elem.getAttribute('base');
  } catch {
    return null;
  }
}

/**
 * Parse a text stat block (common copy-paste format from d20pfsrd or Hero Lab text export)
 * Handles formats like:
 *   Name CR X
 *   XP X
 *   Race Class Level
 *   Alignment Size Type
 *   Init +X; Senses ...; Perception +X
 *   DEFENSE
 *   AC X, touch X, flat-footed X
 *   hp X (XdX+X)
 *   Fort +X, Ref +X, Will +X
 *   OFFENSE
 *   Speed X ft.
 *   Melee weapon +X (XdX+X)
 *   STATISTICS
 *   Str X, Dex X, Con X, Int X, Wis X, Cha X
 *   Base Atk +X; CMB +X; CMD X
 *   Feats ...
 *   Skills ...
 */
export function parseStatBlock(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    throw new Error('Empty stat block');
  }

  const character = {
    id: uid(),
    name: 'Imported Character',
    race: 'Human',
    class: 'Fighter',
    alignment: 'Neutral',
    size: 'Medium',
    level: 1,
    xp: 0,
    abilities: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    maxHP: 1,
    currentHP: 1,
    ac: 10,
    speed: 30,
    saves: { fort: 0, ref: 0, will: 0 },
    initiative: 0,
    gold: 0,
    feats: [],
    skillRanks: {},
    weapons: [],
    armor: 'None',
    shield: 'None',
    equipment: [],
    inventory: [],
    conditions: [],
    spellsKnown: [],
    spellsPrepared: [],
    spellSlotsUsed: {},
    notes: 'Imported from stat block',
  };

  let i = 0;

  // Parse name (first line is usually Name CR X)
  const firstLine = lines[i];
  const nameMatch = firstLine.match(/^(.+?)\s+CR\s+(\d+)/i);
  if (nameMatch) {
    character.name = nameMatch[1].trim();
    i++;
  } else {
    character.name = firstLine;
    i++;
  }

  // Parse XP line if present
  if (i < lines.length && lines[i].match(/^XP\s+\d+/i)) {
    i++;
  }

  // Parse race/class/level line (e.g., "Human Fighter 5")
  if (i < lines.length) {
    const raceClassMatch = lines[i].match(/^(.+?)\s+(\w+)\s+(\d+)$/);
    if (raceClassMatch) {
      character.race = raceClassMatch[1].trim();
      character.class = raceClassMatch[2].trim();
      character.level = parseInt(raceClassMatch[3]);
      i++;
    }
  }

  // Parse alignment/size/type line
  if (i < lines.length) {
    const alignMatch = lines[i].match(/^(\w+\s+\w+)\s+(\w+)\s+/);
    if (alignMatch) {
      character.alignment = alignMatch[1];
      character.size = alignMatch[2];
      i++;
    }
  }

  // Parse Initiative/Senses/Perception
  if (i < lines.length && lines[i].includes('Init')) {
    const initMatch = lines[i].match(/Init\s+([+-]\d+)/);
    if (initMatch) {
      character.initiative = parseInt(initMatch[1]);
    }
    i++;
  }

  // Skip to DEFENSE section
  while (i < lines.length && !lines[i].toUpperCase().includes('DEFENSE')) {
    i++;
  }
  i++; // Skip DEFENSE header

  // Parse AC
  if (i < lines.length && lines[i].includes('AC')) {
    const acMatch = lines[i].match(/AC\s+(\d+)/);
    if (acMatch) {
      character.ac = parseInt(acMatch[1]);
    }
    i++;
  }

  // Parse HP
  if (i < lines.length && lines[i].includes('hp')) {
    const hpMatch = lines[i].match(/hp\s+(\d+)/);
    if (hpMatch) {
      character.maxHP = parseInt(hpMatch[1]);
      character.currentHP = character.maxHP;
    }
    i++;
  }

  // Parse saving throws
  if (i < lines.length && (lines[i].includes('Fort') || lines[i].includes('Ref'))) {
    const fortMatch = lines[i].match(/Fort\s+([+-]\d+)/);
    const refMatch = lines[i].match(/Ref\s+([+-]\d+)/);
    const willMatch = lines[i].match(/Will\s+([+-]\d+)/);

    if (fortMatch) character.saves.fort = parseInt(fortMatch[1]);
    if (refMatch) character.saves.ref = parseInt(refMatch[1]);
    if (willMatch) character.saves.will = parseInt(willMatch[1]);
    i++;
  }

  // Skip to OFFENSE section
  while (i < lines.length && !lines[i].toUpperCase().includes('OFFENSE')) {
    i++;
  }
  i++; // Skip OFFENSE header

  // Parse Speed
  if (i < lines.length && lines[i].includes('Speed')) {
    const speedMatch = lines[i].match(/Speed\s+(\d+)\s*ft/);
    if (speedMatch) {
      character.speed = parseInt(speedMatch[1]);
    }
    i++;
  }

  // Parse weapons (Melee/Ranged lines)
  while (i < lines.length && (lines[i].includes('Melee') || lines[i].includes('Ranged'))) {
    const weaponMatch = lines[i].match(/(?:Melee|Ranged)\s+(.+?)\s+([+-]\d+)\s+\(([^)]+)\)/);
    if (weaponMatch) {
      character.weapons.push({
        name: weaponMatch[1].trim(),
        dmg: weaponMatch[3].trim(),
      });
    }
    i++;
  }

  // Skip to STATISTICS section
  while (i < lines.length && !lines[i].toUpperCase().includes('STATISTICS')) {
    i++;
  }
  i++; // Skip STATISTICS header

  // Parse ability scores
  if (i < lines.length) {
    const abilityLine = lines[i];
    const strMatch = abilityLine.match(/Str\s+(\d+)/);
    const dexMatch = abilityLine.match(/Dex\s+(\d+)/);
    const conMatch = abilityLine.match(/Con\s+(\d+)/);
    const intMatch = abilityLine.match(/Int\s+(\d+)/);
    const wisMatch = abilityLine.match(/Wis\s+(\d+)/);
    const chaMatch = abilityLine.match(/Cha\s+(\d+)/);

    if (strMatch) character.abilities.STR = parseInt(strMatch[1]);
    if (dexMatch) character.abilities.DEX = parseInt(dexMatch[1]);
    if (conMatch) character.abilities.CON = parseInt(conMatch[1]);
    if (intMatch) character.abilities.INT = parseInt(intMatch[1]);
    if (wisMatch) character.abilities.WIS = parseInt(wisMatch[1]);
    if (chaMatch) character.abilities.CHA = parseInt(chaMatch[1]);
    i++;
  }

  // Parse feats line
  while (i < lines.length) {
    if (lines[i].toUpperCase().startsWith('FEATS')) {
      const featLine = lines[i].substring(5).trim();
      if (featLine) {
        character.feats = featLine.split(',').map(f => f.trim()).filter(f => f.length > 0);
      }
      break;
    }
    i++;
  }

  // Parse skills - typically come after feats
  while (i < lines.length) {
    if (lines[i].toUpperCase().startsWith('SKILLS')) {
      const skillLine = lines[i].substring(6).trim();
      if (skillLine) {
        // Parse "Skill +X" format
        const skillMatches = skillLine.match(/(\w+(?:\s+\w+)*)\s+[+-]\d+/g);
        if (skillMatches) {
          skillMatches.forEach(match => {
            const skillMatch = match.match(/^(.+?)\s+[+-](\d+)$/);
            if (skillMatch) {
              character.skillRanks[skillMatch[1].trim()] = parseInt(skillMatch[2]);
            }
          });
        }
      }
      break;
    }
    i++;
  }

  return validateCharacter(character);
}

/**
 * Export our character to Hero Lab XML format
 * Generates XML that can be imported into Hero Lab Classic
 */
export function exportToHeroLabXML(character) {
  const escapeXML = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const abilities = character.abilities || {};
  const saves = character.saves || {};

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<document>\n';
  xml += '  <public>\n';
  xml += `    <character name="${escapeXML(character.name)}">\n`;

  // Basic info
  xml += `      <race name="${escapeXML(character.race || 'Human')}"/>\n`;
  xml += `      <alignment name="${escapeXML(character.alignment || 'Neutral')}"/>\n`;
  xml += `      <size name="${escapeXML(character.size || 'Medium')}"/>\n`;
  xml += `      <class name="${escapeXML(character.class || 'Fighter')}" level="${character.level || 1}"/>\n`;

  // Ability scores
  const abilityNames = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' };
  Object.entries(abilityNames).forEach(([short, full]) => {
    const val = abilities[short] || 10;
    xml += `      <abilityscore name="${full}" base="${val}" modified="${val}"/>\n`;
  });

  // Saving throws
  const saveNames = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
  Object.entries(saveNames).forEach(([key, name]) => {
    const val = saves[key] || 0;
    xml += `      <savingthrow name="${name}" base="${val}" fromattr="0" fromresist="0" frommisc="0"/>\n`;
  });

  // Skills
  const skillRanks = character.skillRanks || {};
  Object.entries(skillRanks).forEach(([name, ranks]) => {
    xml += `      <skill name="${escapeXML(name)}" ranks="${ranks}" attrbonus="0" classbonus="0" armorpenalty="0"/>\n`;
  });

  // Weapons
  const weapons = character.weapons || [];
  weapons.forEach(w => {
    xml += `      <attack name="${escapeXML(w.name)}" attack="+0" damage="${escapeXML(w.dmg || '1d4')}" crit="20/x2"/>\n`;
  });

  // Armor
  xml += `      <armor name="${escapeXML(character.armor || 'None')}" ac="0" maxdex="99" penalty="0"/>\n`;
  xml += `      <shield name="${escapeXML(character.shield || 'None')}" ac="0"/>\n`;

  // Equipment
  const equipment = character.equipment || [];
  equipment.forEach(e => {
    xml += `      <item name="${escapeXML(e.name)}" equipped="${e.equipped ? 'true' : 'false'}" type="${escapeXML(e.type || 'gear')}"/>\n`;
  });

  // Inventory
  const inventory = character.inventory || [];
  inventory.forEach(i => {
    xml += `      <carried name="${escapeXML(i.name)}" quantity="${i.quantity || 1}" type="${escapeXML(i.type || 'gear')}"/>\n`;
  });

  // Feats
  const feats = character.feats || [];
  feats.forEach(feat => {
    xml += `      <feat name="${escapeXML(feat)}"/>\n`;
  });

  // Hit points
  xml += `      <hitpoints total="${character.maxHP || 1}" current="${character.currentHP || 1}"/>\n`;

  // Initiative and speed
  xml += `      <initiative total="${character.initiative || 0}"/>\n`;
  xml += `      <speed value="${character.speed || 30}"/>\n`;

  // AC
  xml += `      <ac total="${character.ac || 10}"/>\n`;

  // Experience and gold
  xml += `      <experience value="${character.xp || 0}"/>\n`;
  const goldPp = Math.floor(character.gold / 10);
  const goldRemaining = Math.floor(character.gold % 10);
  xml += `      <money pp="${goldPp}" gp="${goldRemaining}" sp="0" cp="0"/>\n`;

  xml += '    </character>\n';
  xml += '  </public>\n';
  xml += '</document>\n';

  return xml;
}

/**
 * Export character to a readable text stat block
 * Generates PF1e standard stat block format
 */
export function exportStatBlock(character) {
  const abilities = character.abilities || {};
  const saves = character.saves || {};
  const skills = character.skillRanks || {};

  let block = '';

  // Name and CR
  block += `${character.name || 'Unnamed'} CR ${character.level || 1}\n`;
  block += `XP ${character.xp || 0}\n\n`;

  // Race/Class/Level
  block += `${character.race || 'Human'} ${character.class || 'Fighter'} ${character.level || 1}\n`;

  // Alignment/Size/Type
  block += `${character.alignment || 'Neutral'} ${character.size || 'Medium'} humanoid\n\n`;

  // Initiative and senses
  block += `Init ${character.initiative >= 0 ? '+' : ''}${character.initiative || 0}; Perception ${abilities.WIS ? (mod(abilities.WIS) >= 0 ? '+' : '') + mod(abilities.WIS) : '+0'}\n\n`;

  // DEFENSE
  block += 'DEFENSE\n';
  block += `AC ${character.ac || 10}, touch 10, flat-footed ${Math.max(10, (character.ac || 10) - 2)}\n`;
  block += `hp ${character.maxHP || 1} (${character.level || 1}d${character.class === 'Rogue' ? 8 : 10})\n`;
  block += `Fort ${saves.fort >= 0 ? '+' : ''}${saves.fort || 0}, Ref ${saves.ref >= 0 ? '+' : ''}${saves.ref || 0}, Will ${saves.will >= 0 ? '+' : ''}${saves.will || 0}\n\n`;

  // OFFENSE
  block += 'OFFENSE\n';
  block += `Speed ${character.speed || 30} ft.\n`;

  // Melee attacks
  const weapons = character.weapons || [];
  if (weapons.length > 0) {
    weapons.forEach(w => {
      block += `Melee ${w.name} +${Math.max(0, mod(abilities.STR || 10))} (${w.dmg || '1d4'})\n`;
    });
  }
  block += '\n';

  // STATISTICS
  block += 'STATISTICS\n';
  block += `Str ${abilities.STR || 10}, Dex ${abilities.DEX || 10}, Con ${abilities.CON || 10}, Int ${abilities.INT || 10}, Wis ${abilities.WIS || 10}, Cha ${abilities.CHA || 10}\n`;

  // Combat stats
  const bab = calcBAB(character.class, character.level || 1, classesMap);
  const cmb = bab + mod(abilities.STR || 10);
  const cmd = 10 + bab + mod(abilities.STR || 10) + mod(abilities.DEX || 10);
  block += `Base Atk +${bab}; CMB +${cmb}; CMD ${cmd}\n`;

  // Feats
  const feats = character.feats || [];
  if (feats.length > 0) {
    block += `Feats ${feats.join(', ')}\n`;
  }

  // Skills
  if (Object.keys(skills).length > 0) {
    const skillLines = Object.entries(skills)
      .map(([name, ranks]) => `${name} +${ranks}`)
      .join(', ');
    block += `Skills ${skillLines}\n`;
  }

  // Languages and equipment
  block += `Languages Common\n`;

  const equipment = character.equipment || [];
  const equippedItems = equipment.filter(e => e.equipped);
  if (equippedItems.length > 0) {
    block += `Equipment ${equippedItems.map(e => e.name).join(', ')}\n`;
  }

  block += `Gold ${Math.floor(character.gold || 0)} gp\n`;

  return block;
}

/**
 * Validate parsed character data
 * Checks required fields and flags issues
 * Returns validated character with defaults for missing fields
 */
export function validateCharacter(charData) {
  if (!charData || typeof charData !== 'object') {
    throw new Error('Invalid character data');
  }

  // Ensure required fields exist
  const validated = {
    id: charData.id || uid(),
    name: String(charData.name || 'Unnamed').slice(0, 100),
    race: String(charData.race || 'Human').slice(0, 50),
    class: String(charData.class || 'Fighter').slice(0, 50),
    alignment: String(charData.alignment || 'Neutral').slice(0, 50),
    size: ['Fine', 'Diminutive', 'Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'].includes(charData.size) ? charData.size : 'Medium',
    level: Math.max(1, Math.min(20, Math.floor(charData.level || 1))),
    xp: Math.max(0, Math.floor(charData.xp || 0)),

    // Abilities - clamp to 3-20 range
    abilities: {
      STR: Math.max(3, Math.min(20, Math.floor(charData.abilities?.STR || 10))),
      DEX: Math.max(3, Math.min(20, Math.floor(charData.abilities?.DEX || 10))),
      CON: Math.max(3, Math.min(20, Math.floor(charData.abilities?.CON || 10))),
      INT: Math.max(3, Math.min(20, Math.floor(charData.abilities?.INT || 10))),
      WIS: Math.max(3, Math.min(20, Math.floor(charData.abilities?.WIS || 10))),
      CHA: Math.max(3, Math.min(20, Math.floor(charData.abilities?.CHA || 10))),
    },

    // HP
    maxHP: Math.max(1, Math.floor(charData.maxHP || 1)),
    currentHP: Math.max(0, Math.floor(charData.currentHP || charData.maxHP || 1)),

    // AC and combat
    ac: Math.max(0, Math.floor(charData.ac || 10)),
    speed: Math.max(0, Math.floor(charData.speed || 30)),
    initiative: Math.floor(charData.initiative || 0),

    // Saves
    saves: {
      fort: Math.floor(charData.saves?.fort || 0),
      ref: Math.floor(charData.saves?.ref || 0),
      will: Math.floor(charData.saves?.will || 0),
    },

    // Money
    gold: Math.max(0, parseFloat(charData.gold || 0)),

    // Arrays with validation
    feats: Array.isArray(charData.feats) ? charData.feats.filter(f => f && typeof f === 'string').slice(0, 50) : [],
    skillRanks: typeof charData.skillRanks === 'object' ? Object.entries(charData.skillRanks || {})
      .filter(([k, v]) => k && v && typeof v === 'number' && v > 0)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: Math.max(0, Math.min(20, Math.floor(v))) }), {}) : {},

    weapons: Array.isArray(charData.weapons) ? charData.weapons.filter(w => w && w.name).slice(0, 20) : [],
    armor: String(charData.armor || 'None').slice(0, 50),
    shield: String(charData.shield || 'None').slice(0, 50),

    equipment: Array.isArray(charData.equipment) ? charData.equipment.filter(e => e && e.name).slice(0, 100) : [],
    inventory: Array.isArray(charData.inventory) ? charData.inventory.filter(i => i && i.name).slice(0, 100) : [],

    conditions: Array.isArray(charData.conditions) ? charData.conditions.filter(c => c && typeof c === 'string').slice(0, 50) : [],

    // Spells
    spellsKnown: Array.isArray(charData.spellsKnown) ? charData.spellsKnown.filter(s => s) : [],
    spellsPrepared: Array.isArray(charData.spellsPrepared) ? charData.spellsPrepared.filter(s => s) : [],
    spellSlotsUsed: typeof charData.spellSlotsUsed === 'object' ? charData.spellSlotsUsed : {},

    notes: String(charData.notes || '').slice(0, 1000),
  };

  // Clamp currentHP to valid range
  validated.currentHP = Math.min(validated.currentHP, validated.maxHP);

  return validated;
}

/**
 * Validation result helper - returns issues found
 */
export function validateCharacterDetailed(charData) {
  const issues = [];

  if (!charData.name || charData.name.length === 0) {
    issues.push({ level: 'warning', field: 'name', message: 'Character name is empty' });
  }

  if (!charData.class) {
    issues.push({ level: 'error', field: 'class', message: 'Class is required' });
  }

  if (charData.currentHP > charData.maxHP) {
    issues.push({ level: 'warning', field: 'currentHP', message: `Current HP (${charData.currentHP}) exceeds max HP (${charData.maxHP})` });
  }

  if (charData.ac < 10) {
    issues.push({ level: 'warning', field: 'ac', message: `AC ${charData.ac} is very low (unarmored default is 10)` });
  }

  Object.entries(charData.abilities || {}).forEach(([ability, score]) => {
    if (score < 3 || score > 20) {
      issues.push({ level: 'warning', field: `abilities.${ability}`, message: `${ability} score ${score} is outside typical range (3-20)` });
    }
  });

  return issues;
}
