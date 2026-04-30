import { mod } from './dice';

// ===== ENCUMBRANCE =====
// PF1e carrying capacity table based on STR score
export function getCarryingCapacity(str) {
  // Returns { light, medium, heavy } thresholds in lbs
  // STR 1: 3/6/10, STR 10: 33/66/100, STR 20: 133/266/400, etc.
  // Use the standard PF1e table
  const table = [
    0, 3, 6, 10, 13, 16, 20, 23, 26, 30, // STR 0-9
    33, 38, 43, 50, 58, 66, 76, 86, 100, 116, // STR 10-19
    133, 153, 173, 200, 233, 266, 306, 346, 400, 466, // STR 20-29
  ];
  const heavy = str >= 0 && str < table.length ? table[str] : Math.round(400 * Math.pow(2, (str - 20) / 5));
  return {
    light: Math.floor(heavy / 3),
    medium: Math.floor(heavy * 2 / 3),
    heavy,
    liftOverHead: heavy,
    liftOffGround: heavy * 2,
    dragOrPush: heavy * 5,
  };
}

export function getEncumbranceLevel(totalWeight, str) {
  const cap = getCarryingCapacity(str);
  if (totalWeight <= cap.light) return 'light';
  if (totalWeight <= cap.medium) return 'medium';
  if (totalWeight <= cap.heavy) return 'heavy';
  return 'overloaded';
}

// Encumbrance effects
// PF1e CRB: Dwarves have "Slow and Steady" — their speed is never modified by armor or encumbrance
export function getEncumbranceEffects(level, raceName) {
  const isDwarf = raceName && (raceName === 'Dwarf' || raceName === 'Duergar');
  switch (level) {
    case 'light': return { maxDex: 99, checkPenalty: 0, speedMult: 1, runMult: 4 };
    case 'medium': return { maxDex: 3, checkPenalty: -3, speedMult: isDwarf ? 1 : 0.75, runMult: 4 };
    case 'heavy': return { maxDex: 1, checkPenalty: -6, speedMult: isDwarf ? 1 : 0.75, runMult: 3 };
    case 'overloaded': return { maxDex: 0, checkPenalty: -6, speedMult: 0, runMult: 0 };
    default: return { maxDex: 99, checkPenalty: 0, speedMult: 1, runMult: 4 };
  }
}

// ===== EQUIPMENT SLOTS =====
export const EQUIPMENT_SLOTS = [
  { id: 'head', label: 'Head', accepts: ['head'] },
  { id: 'eyes', label: 'Eyes', accepts: ['eyes'] },
  { id: 'shoulders', label: 'Shoulders', accepts: ['shoulders'] },
  { id: 'neck', label: 'Neck', accepts: ['neck'] },
  { id: 'chest', label: 'Chest', accepts: ['chest'] },
  { id: 'body', label: 'Body/Armor', accepts: ['body', 'armor'] },
  { id: 'belt', label: 'Belt', accepts: ['belt'] },
  { id: 'wrists', label: 'Wrists', accepts: ['wrists'] },
  { id: 'hands', label: 'Hands', accepts: ['hands'] },
  { id: 'ringLeft', label: 'Ring (L)', accepts: ['ring'] },
  { id: 'ringRight', label: 'Ring (R)', accepts: ['ring'] },
  { id: 'feet', label: 'Feet', accepts: ['feet'] },
  { id: 'mainHand', label: 'Main Hand', accepts: ['weapon'] },
  { id: 'offHand', label: 'Off Hand', accepts: ['weapon', 'shield'] },
];

// ===== AC CALCULATION =====
export function calcFullAC(char, armorData, shieldData, enemyTypes = []) {
  const dexMod = mod(char.abilities?.DEX || 10);
  const armor = armorData || { ac: 0, maxDex: 99 };
  const shield = shieldData || { ac: 0 };

  const effectiveDex = Math.min(dexMod, armor.maxDex ?? 99);

  const sizeBonus = char.size === 'Small' ? 1 : char.size === 'Large' ? -1 : 0;
  const naturalArmor = char.naturalArmor || 0;
  const deflection = char.deflectionBonus || 0;
  const dodge = char.dodgeBonus || 0;
  const misc = char.miscACBonus || 0;

  // Monk/similar WIS to AC
  const wisBonus = char.class === 'Monk' ? Math.max(0, mod(char.abilities?.WIS || 10)) : 0;

  // Racial Defensive Training (e.g., Dwarf +4 dodge AC vs Giants)
  let defensiveTrainingBonus = 0;
  const dt = char.racialCombatBonuses?.defensiveTraining;
  if (dt && enemyTypes.length > 0) {
    const enemyLower = enemyTypes.map(t => t.toLowerCase());
    if (dt.vsTypes.some(vt => enemyLower.includes(vt))) {
      defensiveTrainingBonus = dt.acBonus;
    }
  }

  const total = 10 + (armor.ac || 0) + (shield.ac || 0) + effectiveDex + sizeBonus + naturalArmor + deflection + dodge + wisBonus + misc + defensiveTrainingBonus;

  return {
    total,
    base: 10,
    armor: armor.ac || 0,
    shield: shield.ac || 0,
    dex: effectiveDex,
    size: sizeBonus,
    natural: naturalArmor,
    deflection,
    dodge,
    wisdom: wisBonus,
    misc,
    defensiveTraining: defensiveTrainingBonus,
    touch: 10 + effectiveDex + sizeBonus + deflection + dodge + wisBonus + misc + defensiveTrainingBonus,
    flatFooted: total - effectiveDex - dodge,
  };
}

// ===== SKILL CALCULATION =====
export function calcSkillMod(skill, char, classSkillsList, armorPenalty = 0) {
  const abilityMod = mod(char.abilities?.[skill.ability] || 10);
  const ranks = char.skillRanks?.[skill.name] || 0;
  const isClassSkill = classSkillsList?.includes(skill.name);
  const classSkillBonus = (ranks > 0 && isClassSkill) ? 3 : 0;
  const armorPen = skill.armorPenalty ? armorPenalty : 0;
  const miscBonus = char.skillBonuses?.[skill.name] || 0;
  // Racial bonuses
  const racialBonus = char.racialSkillBonuses?.[skill.name] || 0;

  return {
    total: abilityMod + ranks + classSkillBonus + armorPen + miscBonus + racialBonus,
    abilityMod,
    ranks,
    classSkillBonus,
    armorPenalty: armorPen,
    misc: miscBonus + racialBonus,
    isClassSkill,
    canUse: skill.untrained || ranks > 0,
  };
}

// How many skill points per level
export function getSkillPointsPerLevel(cls, intMod, isHuman) {
  const classSkills = cls?.skills || 2;
  return Math.max(1, classSkills + intMod + (isHuman ? 1 : 0));
}

// ===== SPELL SLOTS =====
export function getSpellSlotsForLevel(className, charLevel, castingAbilityScore, spellSlotData) {
  if (!spellSlotData?.spellsPerDay?.[className]) return null;

  const classSlots = spellSlotData.spellsPerDay[className][String(charLevel)];
  if (!classSlots) return null;

  // Add bonus spells from ability score
  const bonusTable = spellSlotData.bonusSpells?.table || {};
  const bonusSpells = {};

  // Find the highest applicable bonus entry
  for (const [score, bonuses] of Object.entries(bonusTable)) {
    if (castingAbilityScore >= parseInt(score)) {
      for (const [spellLevel, bonus] of Object.entries(bonuses)) {
        bonusSpells[spellLevel] = (bonusSpells[spellLevel] || 0);
        bonusSpells[spellLevel] = Math.max(bonusSpells[spellLevel], bonus);
      }
    }
  }

  const result = {};
  for (const [spellLevel, baseSlots] of Object.entries(classSlots)) {
    const lvl = parseInt(spellLevel);
    const bonus = lvl > 0 ? (bonusSpells[spellLevel] || 0) : 0; // No bonus for cantrips
    result[spellLevel] = baseSlots + bonus;
  }

  return result;
}

// ===== GOLD / WEALTH =====
export function getStartingGold(className) {
  // Average starting gold by class in PF1e
  const table = {
    Barbarian: 105, Bard: 105, Cleric: 140, Druid: 70,
    Fighter: 175, Monk: 35, Paladin: 175, Ranger: 175,
    Rogue: 140, Sorcerer: 70, Wizard: 70,
  };
  return table[className] || 105;
}

// ===== TOTAL WEIGHT =====
// Bug #52: weight fields in the project are a mix of numbers (weapons.json,
// some gear.json) and strings like "2 lbs." / "1 lb." (equipment.json, most
// gear.json). Coerce to number before arithmetic or the running total ends
// up as a string like "02 lbs." via implicit concatenation.
function toPounds(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const m = String(raw).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}
export function calcTotalWeight(char) {
  let total = 0;
  // Equipped items
  if (char.equipped) {
    Object.values(char.equipped).forEach(item => {
      total += toPounds(item?.weight);
    });
  }
  // Backpack contents
  if (char.inventory) {
    char.inventory.forEach(item => {
      total += toPounds(item.weight) * (item.quantity || 1);
    });
  }
  return Math.round(total * 10) / 10;
}

// ===== CHARACTER CREATION HELPER =====
export function buildFullCharacter(baseChar, raceData, classData, armorData, shieldData) {
  const race = raceData || {};
  const cls = classData || {};

  // Apply racial ability bonuses
  const abilities = { ...baseChar.abilities };
  if (race.bonuses) {
    Object.entries(race.bonuses).forEach(([key, val]) => {
      if (key !== 'choice' && abilities[key] !== undefined) {
        abilities[key] += val;
      }
    });
  }

  const conMod = mod(abilities.CON);
  const dexMod = mod(abilities.DEX);
  const intMod = mod(abilities.INT);
  const level = baseChar.level || 1;

  // HP
  let maxHP = cls.hd + conMod;
  for (let i = 1; i < level; i++) {
    maxHP += Math.max(1, Math.floor(cls.hd / 2) + 1 + conMod);
  }
  maxHP = Math.max(maxHP, level);

  // Size from race
  const size = race.size || 'Medium';

  // AC
  const ac = calcFullAC({ ...baseChar, abilities, size, class: baseChar.class }, armorData, shieldData);

  // Speed
  const baseSpeed = race.speed || 30;

  // Skill points
  const skillPointsPerLevel = getSkillPointsPerLevel(cls, intMod, race.name === 'Human');
  const totalSkillPoints = skillPointsPerLevel * level;

  return {
    ...baseChar,
    abilities,
    maxHP,
    currentHP: maxHP,
    ac: ac.total,
    acBreakdown: ac,
    size,
    speed: baseSpeed,
    skillPointsPerLevel,
    totalSkillPoints,
    usedSkillPoints: Object.values(baseChar.skillRanks || {}).reduce((s, v) => s + v, 0),
    gold: baseChar.gold ?? getStartingGold(baseChar.class),
    equipped: baseChar.equipped || {},
    inventory: baseChar.inventory || [],
    skillRanks: baseChar.skillRanks || {},
    spellsKnown: baseChar.spellsKnown || [],
    spellsPrepared: baseChar.spellsPrepared || [],
    spellSlotsUsed: baseChar.spellSlotsUsed || {},
    conditions: baseChar.conditions || [],
  };
}
