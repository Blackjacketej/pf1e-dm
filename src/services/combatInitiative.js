// combatInitiative.js
//
// Pure helpers for building and manipulating combat initiative order.
// No Dexie, no React. Exists so that the ally-NPC combatant path (Phase A+)
// can fold allies into `combat.order` without touching the legacy inline
// sorts scattered across CampaignTab / AdventureTab / BestiaryTab.
//
// Initiative entry shape: { id, name, init, side? }
//   side ∈ { 'party', 'enemy', 'ally' }  — optional; derived when omitted.
//
// Roll contract: `rollFn(sides)` returns an integer 1..sides. Tests pass a
// deterministic stub; runtime uses the existing rules-engine `roll`.

/**
 * Compute an initiative bonus from an object that may be a PC, enemy, or ally.
 * - PCs: DEX mod from `abilities.DEX`
 * - Enemies/allies: explicit `init` field (already-rolled bonus, per existing
 *   combatant shape)
 */
export function initiativeBonus(combatant, side) {
  if (!combatant) return 0;
  if (side === 'party') {
    const dex = combatant.abilities?.DEX;
    if (!Number.isFinite(dex)) return 0;
    return Math.floor((dex - 10) / 2);
  }
  return Number.isFinite(combatant.init) ? combatant.init : 0;
}

/**
 * Build a sorted initiative order from party + enemies + allies.
 * Ties are broken by side priority (party > ally > enemy) then by name, so
 * order is fully deterministic given a deterministic `rollFn`.
 */
export function buildInitiativeOrder({ party = [], enemies = [], allies = [], rollFn = () => 10 } = {}) {
  const sidePriority = { party: 0, ally: 1, enemy: 2 };
  const entries = [];
  for (const p of party) {
    entries.push({
      id: p.id,
      name: p.name,
      init: rollFn(20) + initiativeBonus(p, 'party'),
      side: 'party',
    });
  }
  for (const a of allies) {
    entries.push({
      id: a.id,
      name: a.name,
      init: rollFn(20) + initiativeBonus(a, 'ally'),
      side: 'ally',
    });
  }
  for (const e of enemies) {
    entries.push({
      id: e.id,
      name: e.name,
      init: rollFn(20) + initiativeBonus(e, 'enemy'),
      side: 'enemy',
    });
  }
  return entries.sort((a, b) => {
    if (b.init !== a.init) return b.init - a.init;
    const sa = sidePriority[a.side] ?? 99;
    const sb = sidePriority[b.side] ?? 99;
    if (sa !== sb) return sa - sb;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Classify a combatant id against the current combat snapshot.
 * Returns 'party' | 'ally' | 'enemy' | null. Used by CombatTab to resolve
 * whose turn it is without repeating the `.find()` dance four times.
 */
export function classifyCombatant(id, { party = [], enemies = [], allies = [] } = {}) {
  if (party.some(p => p.id === id)) return 'party';
  if (allies.some(a => a.id === id)) return 'ally';
  if (enemies.some(e => e.id === id)) return 'enemy';
  return null;
}

/**
 * Is this combatant still able to act? Uses side-specific rules:
 *   - PCs: currentHP > 0 OR orcFerocityActive flag
 *   - Enemies: currentHP > 0 AND not fled AND not surrendered
 *   - Allies: currentHP > 0 (fled/surrendered not yet modeled for allies)
 * Returns false if combatant not found in any roster.
 */
export function isCombatantAlive(id, { party = [], enemies = [], allies = [] } = {}) {
  const pc = party.find(p => p.id === id);
  if (pc) return pc.currentHP > 0 || !!pc.orcFerocityActive;
  const ally = allies.find(a => a.id === id);
  if (ally) return ally.currentHP > 0;
  const enemy = enemies.find(e => e.id === id);
  if (enemy) return enemy.currentHP > 0 && !enemy.fled && !enemy.surrendered;
  return false;
}
