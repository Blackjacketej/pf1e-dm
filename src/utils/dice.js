export const roll = (sides) => Math.floor(Math.random() * sides) + 1;

export const rollDice = (count, sides) => {
  let total = 0;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    const v = roll(sides);
    rolls.push(v);
    total += v;
  }
  return { total, rolls };
};

export const d20 = () => roll(20);
export const mod = (score) => Math.floor((score - 10) / 2);
export const modStr = (v) => (v >= 0 ? `+${v}` : `${v}`);
export const uid = () => Math.random().toString(36).slice(2, 9);

export function rollAbilityScore() {
  const rolls = [roll(6), roll(6), roll(6), roll(6)];
  rolls.sort((a, b) => b - a);
  return { total: rolls[0] + rolls[1] + rolls[2], rolls };
}

/** Roll 3d6 (classic PF1e method) */
export function rollClassic3d6() {
  return rollDice(3, 6).total;
}

/** Roll 2d6+6 (heroic PF1e method) */
export function rollHeroic() {
  return rollDice(2, 6).total + 6;
}

/** Roll 24d6 dice pool (PF1e method) — returns array of 24 individual d6 results sorted high to low */
export function rollDicePool() {
  const dice = [];
  for (let i = 0; i < 24; i++) dice.push(roll(6));
  return dice.sort((a, b) => b - a);
}

export function parseDamage(dmgStr) {
  const m = dmgStr.match(/(\d+)d(\d+)/);
  if (!m) return roll(4);
  return rollDice(parseInt(m[1]), parseInt(m[2])).total;
}

export function calcBAB(cls, level, classesMap) {
  const c = classesMap?.[cls];
  if (!c) return 0;
  if (c.bab === 'full') return level;
  if (c.bab === '3/4') return Math.floor(level * 3 / 4);
  return Math.floor(level / 2);
}

export function calcSave(type, cls, level, classesMap) {
  const c = classesMap?.[cls];
  if (!c) return 0;
  // Support both formats: goodSaves array (preferred) and old saves object (fallback)
  let isGood = false;
  if (c.goodSaves && c.goodSaves.length > 0) {
    // Map display-format type to goodSaves format: 'fort'/'Fort' -> 'Fort', etc.
    const normalized = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    const saveKey = normalized === 'Fort' ? 'Fort' : normalized === 'Ref' ? 'Ref' : 'Will';
    isGood = c.goodSaves.includes(saveKey);
  } else if (c.saves) {
    const key = type.toLowerCase();
    isGood = c.saves[key] === 'good';
  }
  if (isGood) return 2 + Math.floor(level / 2);
  return Math.floor(level / 3);
}

export function getMaxHP(cls, level, conMod, classesMap) {
  const c = classesMap?.[cls];
  if (!c) return 10;
  let hp = c.hd + conMod;
  for (let i = 1; i < level; i++) hp += Math.max(1, Math.floor(c.hd / 2) + 1 + conMod);
  return Math.max(hp, level);
}
