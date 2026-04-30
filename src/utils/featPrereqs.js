/**
 * Feat Prerequisite Parser & Checker for Pathfinder 1e
 *
 * Parses natural-language prerequisite strings from feats.json into structured
 * rules and checks them against a character's current stats.
 */

import classesData from '../data/classes.json';

const classesMap = {};
classesData.forEach(c => { classesMap[c.name] = c; });

// ── Parse a prerequisite string into structured requirements ──

const ABILITY_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ABILITY_PATTERN = /\b(STR|DEX|CON|INT|WIS|CHA|Str|Dex|Con|Int|Wis|Cha)\s+(\d+)/gi;
const BAB_PATTERN = /(?:base attack bonus|BAB)\s*\+?(\d+)/i;
const CASTER_LEVEL_PATTERN = /caster level\s*(\d+)(?:st|nd|rd|th)?/i;
const SKILL_RANK_PATTERN = /(\w[\w\s()]*?)\s+(\d+)\s+ranks?/gi;
const CLASS_LEVEL_PATTERN = /(\w[\w\s]*?)\s+level\s+(\d+)(?:st|nd|rd|th)?/i;
const RACE_NAMES = [
  'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Half-Orc', 'Halfling', 'Human',
  'Aasimar', 'Tiefling', 'Orc', 'Goblin', 'Catfolk', 'Kitsune', 'Tengu',
  'Ratfolk', 'Nagaji', 'Changeling', 'Dhampir', 'Fetchling', 'Ifrit',
  'Oread', 'Sylph', 'Undine', 'Duergar', 'Svirfneblin', 'Wayang', 'Kobold',
];
const RACE_PATTERN = new RegExp(`\\b(${RACE_NAMES.join('|')})\\b`, 'i');

// Known feat names that commonly appear as prerequisites
// We build this dynamically from the feats data, but keep a fallback set
const KNOWN_FEAT_PREREQS = new Set([
  'Alertness', 'Armor Proficiency', 'Blind-Fight', 'Cleave', 'Combat Expertise',
  'Combat Reflexes', 'Critical Focus', 'Dazzling Display', 'Deadly Aim',
  'Deflect Arrows', 'Dodge', 'Endurance', 'Exotic Weapon Proficiency',
  'Great Cleave', 'Great Fortitude', 'Greater Weapon Focus', 'Greater Weapon Specialization',
  'Improved Bull Rush', 'Improved Channel', 'Improved Critical', 'Improved Disarm',
  'Improved Feint', 'Improved Grapple', 'Improved Initiative', 'Improved Overrun',
  'Improved Sunder', 'Improved Trip', 'Improved Unarmed Strike', 'Iron Will',
  'Lightning Reflexes', 'Lunge', 'Martial Weapon Proficiency', 'Mobility',
  'Mounted Combat', 'Natural Spell', 'Nimble Moves', 'Penetrating Strike',
  'Persuasive', 'Point-Blank Shot', 'Power Attack', 'Precise Shot',
  'Quick Draw', 'Rapid Reload', 'Rapid Shot', 'Ride-By Attack',
  'Run', 'Shield Focus', 'Shield Proficiency', 'Shot on the Run',
  'Simple Weapon Proficiency', 'Skill Focus', 'Snatch Arrows',
  'Spell Focus', 'Spell Penetration', 'Spirited Charge', 'Spring Attack',
  'Stealthy', 'Step Up', 'Stunning Fist', 'Toughness', 'Trample',
  'Two-Weapon Fighting', 'Improved Two-Weapon Fighting', 'Greater Two-Weapon Fighting',
  'Vital Strike', 'Weapon Finesse', 'Weapon Focus', 'Weapon Specialization',
  'Whirlwind Attack', 'Wind Stance',
]);

/**
 * Parse a prerequisite string into a structured requirements object.
 * @param {string} prereqStr - Natural language prerequisite string
 * @returns {object} Parsed requirements
 */
export function parsePrerequisites(prereqStr) {
  if (!prereqStr || prereqStr === 'None' || prereqStr === 'none') {
    return { abilities: {}, bab: 0, feats: [], skills: {}, casterLevel: 0, classLevels: {}, races: [], classFeatures: [], gender: null, raw: prereqStr || '' };
  }

  const result = {
    abilities: {},    // e.g. { STR: 13, DEX: 15 }
    bab: 0,           // minimum BAB
    feats: [],        // required feat names
    skills: {},       // e.g. { "Acrobatics": 5, "Perception": 3 }
    casterLevel: 0,   // minimum caster level
    classLevels: {},   // e.g. { "Fighter": 4 }
    races: [],        // allowed races (empty = any)
    classFeatures: [], // required class features (strings)
    gender: null,     // required gender (e.g. 'Female' for Gray Maiden Initiate)
    raw: prereqStr,
  };

  // Parse gender requirement
  const genderMatch = /\b(Female|Male)\b/i.exec(prereqStr);
  if (genderMatch) {
    result.gender = genderMatch[1].charAt(0).toUpperCase() + genderMatch[1].slice(1).toLowerCase();
  }

  // Parse ability scores
  let match;
  const abilityRegex = /\b(STR|DEX|CON|INT|WIS|CHA|Str|Dex|Con|Int|Wis|Cha)\s+(\d+)/g;
  while ((match = abilityRegex.exec(prereqStr)) !== null) {
    result.abilities[match[1].toUpperCase()] = parseInt(match[2]);
  }

  // Parse BAB
  const babMatch = BAB_PATTERN.exec(prereqStr);
  if (babMatch) {
    result.bab = parseInt(babMatch[1]);
  }

  // Parse caster level
  const clMatch = CASTER_LEVEL_PATTERN.exec(prereqStr);
  if (clMatch) {
    result.casterLevel = parseInt(clMatch[1]);
  }

  // Parse skill ranks
  const skillRegex = /([\w\s()]+?)\s+(\d+)\s+ranks?/gi;
  while ((match = skillRegex.exec(prereqStr)) !== null) {
    const skillName = match[1].trim();
    // Exclude false positives like "base attack bonus"
    if (!/(base attack|caster|class)/i.test(skillName)) {
      result.skills[skillName] = parseInt(match[2]);
    }
  }

  // Parse class levels (e.g. "fighter level 4th", "ranger level 5th", "monk level 4th")
  const classLevelRegex = /(\w[\w\s]*?)\s+level\s+(\d+)(?:st|nd|rd|th)?/gi;
  while ((match = classLevelRegex.exec(prereqStr)) !== null) {
    const className = match[1].trim();
    // Exclude "caster level" — that's handled separately
    if (!/caster/i.test(className)) {
      // Capitalize first letter
      const normalized = className.charAt(0).toUpperCase() + className.slice(1).toLowerCase();
      result.classLevels[normalized] = parseInt(match[2]);
    }
  }

  // Parse race requirements
  const raceMatch = RACE_PATTERN.exec(prereqStr);
  if (raceMatch) {
    // Check context — make sure it's a requirement, not part of a feat name
    const beforeMatch = prereqStr.substring(0, raceMatch.index).trim();
    const isStandalone = !beforeMatch || beforeMatch.endsWith(',') || beforeMatch.endsWith(';') || beforeMatch === '';
    if (isStandalone || /\belf\b|\bhalf-elf\b|\bhalf-orc\b|\bdwarf\b|\bgnome\b|\bhalfling\b|\bhuman\b|\borc\b|\bgoblin\b/i.test(prereqStr)) {
      // Collect all race mentions (some feats allow "elf, half-elf, or gnome")
      const allRaces = [];
      for (const race of RACE_NAMES) {
        if (new RegExp(`\\b${race.replace('-', '[-\\s]?')}\\b`, 'i').test(prereqStr)) {
          allRaces.push(race);
        }
      }
      if (allRaces.length > 0) result.races = allRaces;
    }
  }

  // Parse class features
  const classFeatureRegex = /(\w[\w\s']*?)\s+class feature/gi;
  while ((match = classFeatureRegex.exec(prereqStr)) !== null) {
    result.classFeatures.push(match[1].trim().toLowerCase());
  }

  // Parse feat prerequisites — split on commas/semicolons and identify feat names
  const parts = prereqStr.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Skip parts we've already parsed
    if (ABILITY_PATTERN.test(part)) continue;
    if (BAB_PATTERN.test(part)) continue;
    if (CASTER_LEVEL_PATTERN.test(part)) continue;
    if (/\d+\s+ranks?/i.test(part)) continue;
    if (/level\s+\d/i.test(part)) continue;
    if (/class feature/i.test(part)) continue;
    if (/^None$/i.test(part)) continue;
    if (/proficien/i.test(part) && !/Exotic Weapon|Martial Weapon/i.test(part)) continue;
    if (/ability to/i.test(part)) continue;
    if (/size or/i.test(part)) continue;
    if (/no levels/i.test(part)) continue;
    if (/^\s*(Female|Male)\b/i.test(part)) continue;

    // Clean the part
    let cleaned = part.replace(/[†*]/g, '').replace(/\s+/g, ' ').trim();

    // Check if this looks like a feat name
    if (cleaned && /^[A-Z]/.test(cleaned) && cleaned.length > 2 && cleaned.length < 60) {
      // Additional check — filter out race names and ability scores
      if (!RACE_NAMES.some(r => cleaned.toLowerCase() === r.toLowerCase()) &&
          !ABILITY_NAMES.some(a => cleaned.toUpperCase().startsWith(a + ' ')) &&
          !/^\d/.test(cleaned)) {
        // Handle "or" alternatives — e.g. "Endurance or armor training class feature"
        const orParts = cleaned.split(/\s+or\s+/i);
        const featPart = orParts[0].trim();
        if (featPart.length > 2 && /^[A-Z]/.test(featPart)) {
          result.feats.push(featPart);
        }
      }
    }
  }

  // Reset regex lastIndex
  ABILITY_PATTERN.lastIndex = 0;

  return result;
}

// ── Pre-parse all feats for fast lookups ──
let _parsedCache = null;

/**
 * Parse all feats and cache the results.
 * @param {Array} featsArray - Array of feat objects from feats.json
 * @returns {Map} Map of feat name → parsed prerequisites
 */
export function parseAllFeats(featsArray) {
  if (_parsedCache) return _parsedCache;
  _parsedCache = new Map();
  for (const feat of featsArray) {
    _parsedCache.set(feat.name, parsePrerequisites(feat.prerequisites));
  }
  return _parsedCache;
}

/**
 * Clear the parsed cache (call if feats data changes).
 */
export function clearPrereqCache() {
  _parsedCache = null;
}

// ── Check prerequisites against a character ──

/**
 * Compute BAB for a character.
 */
function computeBAB(className, level) {
  const cls = classesMap[className];
  if (!cls) return Math.floor(level * 0.5); // fallback
  const progression = cls.bab || 'medium';
  if (progression === 'full') return level;
  if (progression === 'medium' || progression === '3/4') return Math.floor(level * 0.75);
  return Math.floor(level * 0.5); // slow
}

/**
 * Get class features for a class at a given level (simplified).
 * Returns lowercase feature names.
 */
function getClassFeatures(className, level) {
  const features = new Set();
  const cls = classesMap[className];
  const clsLower = (className || '').toLowerCase();

  // Universal class features by class name
  const CLASS_FEATURE_MAP = {
    barbarian: ['rage', 'fast movement', 'uncanny dodge'],
    bard: ['bardic performance', 'inspire courage', 'bardic knowledge', 'countersong', 'fascinate'],
    cleric: ['channel energy', 'domain', 'spontaneous casting'],
    druid: ['wild shape', 'nature bond', 'nature sense', 'woodland stride', 'wild empathy', 'animal companion'],
    fighter: ['armor training', 'weapon training', 'bravery', 'bonus feat'],
    monk: ['flurry of blows', 'stunning fist', 'unarmed strike', 'evasion', 'ki pool', 'fast movement'],
    paladin: ['smite evil', 'lay on hands', 'divine grace', 'aura of courage', 'divine bond', 'channel energy', 'mercy'],
    ranger: ['favored enemy', 'wild empathy', 'combat style', 'favored terrain', 'animal companion', 'hunters bond'],
    rogue: ['sneak attack', 'trapfinding', 'evasion', 'trap sense', 'uncanny dodge', 'rogue talent'],
    sorcerer: ['bloodline', 'bloodline power', 'eschew materials'],
    wizard: ['arcane bond', 'arcane school', 'scribe scroll'],
    alchemist: ['bomb', 'mutagen', 'brew potion', 'discovery', 'poison use', 'poison resistance'],
    witch: ['hex', 'patron', 'familiar'],
    cavalier: ['challenge', 'order', 'mount', 'tactician'],
    gunslinger: ['grit', 'deeds', 'gunsmith'],
    inquisitor: ['judgment', 'monster lore', 'stern gaze', 'domain'],
    magus: ['spell combat', 'spellstrike', 'arcane pool', 'magus arcana'],
    oracle: ['mystery', 'revelation', 'oracle curse'],
    summoner: ['eidolon', 'summon monster', 'bond senses'],
    bloodrager: ['bloodrage', 'bloodline', 'fast movement', 'uncanny dodge'],
  };

  const classFeatures = CLASS_FEATURE_MAP[clsLower] || [];
  classFeatures.forEach(f => features.add(f));

  // Level-gated features
  if (clsLower === 'druid' && level >= 4) features.add('wild shape');
  if (clsLower === 'monk' && level >= 4) features.add('ki pool');
  if (clsLower === 'barbarian' && level >= 2) features.add('uncanny dodge');
  if (clsLower === 'barbarian' && level >= 14) features.add('indomitable will');
  if (clsLower === 'rogue' && level >= 4) features.add('uncanny dodge');
  if (clsLower === 'fighter' && level >= 3) features.add('armor training');
  if (clsLower === 'fighter' && level >= 5) features.add('weapon training');
  if (clsLower === 'ranger' && level >= 3) features.add('favored terrain');

  return features;
}

/**
 * Check if a character meets the prerequisites for a specific feat.
 * @param {object} parsedPrereqs - Parsed prerequisites from parsePrerequisites()
 * @param {object} character - Character object with abilities, feats, class, level, race, skillRanks, etc.
 * @returns {object} { met: boolean, missing: string[] }
 */
export function checkPrerequisites(parsedPrereqs, character) {
  const missing = [];

  if (!parsedPrereqs || !character) return { met: true, missing: [] };

  // Check ability scores
  for (const [ability, minScore] of Object.entries(parsedPrereqs.abilities)) {
    const charScore = character.abilities?.[ability] || 10;
    if (charScore < minScore) {
      missing.push(`${ability} ${minScore} (have ${charScore})`);
    }
  }

  // Check BAB
  if (parsedPrereqs.bab > 0) {
    const charBAB = computeBAB(character.class, character.level || 1);
    if (charBAB < parsedPrereqs.bab) {
      missing.push(`BAB +${parsedPrereqs.bab} (have +${charBAB})`);
    }
  }

  // Check feat prerequisites
  const charFeats = new Set((character.feats || character.selectedFeats || []).map(f =>
    (typeof f === 'string' ? f : f.name || '').toLowerCase()
  ));
  for (const reqFeat of parsedPrereqs.feats) {
    if (!charFeats.has(reqFeat.toLowerCase())) {
      missing.push(`Feat: ${reqFeat}`);
    }
  }

  // Check skill ranks
  const charSkills = character.skillRanks || {};
  for (const [skill, minRanks] of Object.entries(parsedPrereqs.skills)) {
    const charRanks = charSkills[skill] || 0;
    if (charRanks < minRanks) {
      missing.push(`${skill} ${minRanks} ranks (have ${charRanks})`);
    }
  }

  // Check caster level
  if (parsedPrereqs.casterLevel > 0) {
    const isCaster = ['Wizard', 'Sorcerer', 'Cleric', 'Druid', 'Witch', 'Bard', 'Paladin', 'Ranger',
      'Alchemist', 'Inquisitor', 'Oracle', 'Magus', 'Summoner', 'Bloodrager', 'Adept'].includes(character.class);
    const effectiveCL = isCaster ? (character.level || 1) : 0;
    if (effectiveCL < parsedPrereqs.casterLevel) {
      missing.push(`Caster level ${parsedPrereqs.casterLevel}`);
    }
  }

  // Check class levels
  for (const [cls, minLevel] of Object.entries(parsedPrereqs.classLevels)) {
    if ((character.class || '').toLowerCase() !== cls.toLowerCase() || (character.level || 1) < minLevel) {
      missing.push(`${cls} level ${minLevel}`);
    }
  }

  // Check race
  if (parsedPrereqs.races.length > 0) {
    const charRace = (character.race || '').toLowerCase();
    const raceMatch = parsedPrereqs.races.some(r => r.toLowerCase() === charRace);
    if (!raceMatch) {
      missing.push(`Race: ${parsedPrereqs.races.join(' or ')}`);
    }
  }

  // Check gender
  if (parsedPrereqs.gender) {
    const charGender = (character.gender || '').toLowerCase();
    if (charGender !== parsedPrereqs.gender.toLowerCase()) {
      missing.push(`Gender: ${parsedPrereqs.gender}`);
    }
  }

  // Check class features (soft check — we check if the class generally provides them)
  if (parsedPrereqs.classFeatures.length > 0) {
    const features = getClassFeatures(character.class, character.level || 1);
    for (const reqFeature of parsedPrereqs.classFeatures) {
      if (!features.has(reqFeature.toLowerCase())) {
        missing.push(`Class feature: ${reqFeature}`);
      }
    }
  }

  return { met: missing.length === 0, missing };
}

/**
 * Convenience: check a feat by name against a character.
 * @param {string} featName - Name of the feat
 * @param {object} character - Character object
 * @param {Map} parsedMap - Pre-parsed feat map from parseAllFeats()
 * @returns {object} { met: boolean, missing: string[] }
 */
export function checkFeatPrereqs(featName, character, parsedMap) {
  const parsed = parsedMap?.get(featName);
  if (!parsed) return { met: true, missing: [] }; // Unknown feat — allow it
  return checkPrerequisites(parsed, character);
}

/**
 * Filter a feats array to only those the character qualifies for.
 * @param {Array} feats - Array of feat objects
 * @param {object} character - Character object
 * @param {Map} parsedMap - Pre-parsed feat map
 * @returns {Array} Feats with { ...feat, eligible: boolean, missing: string[] }
 */
export function annotateFeatsWithEligibility(feats, character, parsedMap) {
  return feats.map(feat => {
    const { met, missing } = checkFeatPrereqs(feat.name, character, parsedMap);
    return { ...feat, eligible: met, missing };
  });
}

/**
 * Validate a list of feat names and return only those the character qualifies for.
 * Used for AI-generated and template characters.
 * @param {string[]} featNames - Feat names to validate
 * @param {object} character - Partial character object (needs abilities, class, level, race, skillRanks)
 * @param {Array} allFeats - Full feats array for parsing
 * @returns {{ valid: string[], invalid: { name: string, missing: string[] }[] }}
 */
export function validateFeatList(featNames, character, allFeats) {
  const parsedMap = parseAllFeats(allFeats);
  const valid = [];
  const invalid = [];

  // Build a progressive character that gains feats as we validate
  const progressiveChar = { ...character, feats: [] };

  for (const name of featNames) {
    const { met, missing } = checkFeatPrereqs(name, progressiveChar, parsedMap);
    if (met) {
      valid.push(name);
      progressiveChar.feats.push(name); // Add to progressive check for chained prereqs
    } else {
      invalid.push({ name, missing });
    }
  }

  return { valid, invalid };
}

/**
 * For NPC generation — pick valid feats for an NPC given their stats.
 * @param {object} npcStats - { class, level, race, abilities, skillRanks }
 * @param {Array} allFeats - Full feats array
 * @param {number} count - How many feats to pick
 * @returns {string[]} Valid feat names
 */
export function pickValidNPCFeats(npcStats, allFeats, count = 1) {
  const parsedMap = parseAllFeats(allFeats);

  // Filter to eligible feats
  const eligible = allFeats.filter(feat => {
    if (!feat.prerequisites || feat.prerequisites === 'None') return true;
    const { met } = checkFeatPrereqs(feat.name, npcStats, parsedMap);
    return met;
  });

  // Weight by relevance to class
  const isWarrior = ['Fighter', 'Warrior', 'Ranger', 'Paladin', 'Monk', 'Barbarian', 'Cavalier'].includes(npcStats.class);
  const isCaster = ['Wizard', 'Sorcerer', 'Cleric', 'Druid', 'Witch', 'Bard', 'Oracle', 'Alchemist', 'Magus', 'Inquisitor', 'Summoner'].includes(npcStats.class);
  const isSkilled = ['Rogue', 'Bard', 'Expert', 'Ranger', 'Alchemist'].includes(npcStats.class);

  // Prefer combat feats for warriors, magic for casters, etc.
  const COMBAT_FEATS = new Set(['Power Attack', 'Cleave', 'Weapon Focus', 'Improved Initiative', 'Toughness', 'Dodge', 'Combat Reflexes', 'Iron Will', 'Great Fortitude', 'Lightning Reflexes', 'Improved Unarmed Strike', 'Point-Blank Shot', 'Precise Shot', 'Weapon Finesse', 'Two-Weapon Fighting', 'Shield Focus', 'Vital Strike', 'Lunge']);
  const CASTER_FEATS = new Set(['Spell Focus', 'Spell Penetration', 'Combat Casting', 'Improved Initiative', 'Toughness', 'Eschew Materials', 'Augment Summoning', 'Improved Familiar']);
  const SKILL_FEATS = new Set(['Skill Focus', 'Stealthy', 'Persuasive', 'Alertness', 'Deceitful', 'Nimble Moves', 'Acrobatic', 'Athletic']);

  const preferred = isWarrior ? COMBAT_FEATS : isCaster ? CASTER_FEATS : isSkilled ? SKILL_FEATS : COMBAT_FEATS;

  // Sort eligible: preferred feats first, then no-prereq feats, then random
  const sorted = eligible.sort((a, b) => {
    const aPreferred = preferred.has(a.name) ? 1 : 0;
    const bPreferred = preferred.has(b.name) ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    const aSimple = (!a.prerequisites || a.prerequisites === 'None') ? 1 : 0;
    const bSimple = (!b.prerequisites || b.prerequisites === 'None') ? 1 : 0;
    return bSimple - aSimple;
  });

  // Pick feats progressively (each picked feat enables more options)
  const picked = [];
  const progressiveChar = { ...npcStats, feats: [] };

  for (let i = 0; i < count && sorted.length > 0; i++) {
    // Re-check eligibility with progressive feats
    const stillEligible = sorted.filter(f => {
      if (picked.includes(f.name)) return false;
      const { met } = checkFeatPrereqs(f.name, progressiveChar, parsedMap);
      return met;
    });

    if (stillEligible.length === 0) break;

    // Weighted random — prefer top of sorted list
    const topN = Math.min(10, stillEligible.length);
    const selected = stillEligible[Math.floor(Math.random() * topN)];
    picked.push(selected.name);
    progressiveChar.feats.push(selected.name);
  }

  return picked;
}
