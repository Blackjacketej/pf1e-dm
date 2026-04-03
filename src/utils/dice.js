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
  if (c.saves[type] === 'good') return 2 + Math.floor(level / 2);
  return Math.floor(level / 3);
}

export function getMaxHP(cls, level, conMod, classesMap) {
  const c = classesMap?.[cls];
  if (!c) return 10;
  let hp = c.hd + conMod;
  for (let i = 1; i < level; i++) hp += Math.max(1, Math.floor(c.hd / 2) + 1 + conMod);
  return Math.max(hp, level);
}
