// ============================================================================
// allyFactory.js — combat-ally shaping for Phase F spawn entrypoints
// ============================================================================
// Phase A-E built the plumbing for ally combatants (inverted pool, expiring
// summons, pickers, observation, defeat check). Phase F adds the spawn side:
// how do allies actually get INTO combat.allies in the first place?
//
// Two canonical sources:
//   1. A canonical NPC (e.g. Shalelu, Aldern) joining the party for a fight.
//      Shape their encounteredNpcs record into a combat-ally entry via
//      `npcToCombatAlly`. This is what the GM "Add NPC as ally" button uses.
//   2. A summon spell (Summon Monster I-IX, Summon Nature's Ally I-IX, etc.)
//      producing an ephemeral creature from a template. Shape it via
//      `summonToCombatAlly`, which stamps `expiresAtRound` so Phase C.2's
//      nextTurn expiry ticker removes them at the right round boundary.
//
// Both functions are PURE — no Dexie, no React — so the caller owns state
// and the semantics are unit-testable without a DB.
// ============================================================================

/**
 * Shape a canonical NPC record into a combat-ally entry suitable for
 * `combat.allies`. Preserves the npcId linkage (via `sourceNpcId`) so the
 * Phase D distillation pass can find the NPC on combat end. Does NOT
 * persist anything — the caller is responsible for pushing the returned
 * entry into `combat.allies` via setCombat.
 *
 * @param {Object} npc                     Canonical NPC record (encounteredNpcs row shape).
 * @param {Object} [opts]
 * @param {string} [opts.controlMode='ai'] 'ai' | 'gm' | 'player' (Phase C).
 * @param {number} [opts.expiresAtRound]   Optional round-based expiry (Phase C.2).
 * @param {string} [opts.idPrefix='ally']  Prefix for the synthetic combat id.
 * @param {number} [opts.now=Date.now()]   Timestamp seed for the id (test seam).
 * @returns {Object|null} Combat-ally entry, or null if the NPC is missing/invalid.
 */
export function npcToCombatAlly(npc, opts = {}) {
  if (!npc || !npc.id) return null;
  const {
    controlMode = 'ai',
    expiresAtRound = null,
    idPrefix = 'ally',
    now = Date.now(),
  } = opts;

  // Dex modifier for initiative — NPC abilities is { STR, DEX, CON, ... } with
  // the raw score, so mod = floor((score - 10) / 2). Fall back to +0 if missing.
  const dex = (npc.abilities && typeof npc.abilities.DEX === 'number')
    ? npc.abilities.DEX : 10;
  const dexMod = Math.floor((dex - 10) / 2);

  // Canonical max HP: prefer maxHP, fall back to hp. These are always set by
  // generateNPC but caller-supplied records (e.g. hand-crafted canonical NPCs)
  // sometimes only carry `hp` as max.
  const maxHP = Number.isFinite(npc.maxHP) ? npc.maxHP
    : Number.isFinite(npc.hp) ? npc.hp
    : 10;
  const currentHP = Number.isFinite(npc.currentHP) ? npc.currentHP : maxHP;

  const entry = {
    id: `${idPrefix}-${npc.id}-${now}`,
    sourceNpcId: npc.id,     // Phase F linkage — recovers the canonical record.
    npcId: npc.id,           // Phase D distillation reads this for advanceNpcKnowledge.
    name: npc.name || 'Unknown Ally',
    hp: maxHP,               // legacy: some code reads `hp` as max (matches enemy shape)
    maxHP,
    currentHP,
    ac: Number.isFinite(npc.ac) ? npc.ac : 10,
    init: dexMod,
    level: Number.isFinite(npc.level) ? npc.level : 1,
    hd: Number.isFinite(npc.hd) ? npc.hd : (npc.level || 1),
    controlMode,
    // Carry class/abilities/feats forward so creatureAI's target-scoring +
    // selectTarget can reason about the ally the same way it does for enemies.
    class: npc.class || '',
    abilities: npc.abilities || null,
    feats: Array.isArray(npc.feats) ? npc.feats : [],
    conditions: [],
  };
  if (Number.isFinite(expiresAtRound)) {
    entry.expiresAtRound = expiresAtRound;
  }
  return entry;
}

/**
 * Shape a summon-spell template into a combat-ally entry with `expiresAtRound`
 * stamped. Summon templates are plain objects describing the summoned creature
 * (name, hp, ac, init, etc.) — typically looked up from a spell data table.
 *
 * @param {Object} template                Summon template { name, hp, ac, init, ... }.
 * @param {Object} [opts]
 * @param {number} opts.currentRound       Current combat round (combat.round). REQUIRED.
 * @param {number} opts.durationRounds     Spell duration in rounds. REQUIRED.
 * @param {string} [opts.controlMode='ai'] 'ai' | 'gm' | 'player'.
 * @param {string} [opts.idPrefix='summon']
 * @param {number} [opts.now=Date.now()]
 * @returns {Object|null} Combat-ally entry with expiresAtRound, or null if inputs invalid.
 */
export function summonToCombatAlly(template, opts = {}) {
  if (!template || !template.name) return null;
  const {
    currentRound,
    durationRounds,
    controlMode = 'ai',
    idPrefix = 'summon',
    now = Date.now(),
  } = opts;
  if (!Number.isFinite(currentRound) || !Number.isFinite(durationRounds)) return null;
  if (durationRounds <= 0) return null;

  // PF1e spell-duration semantic: a summon cast on round N with duration D
  // lasts through round N + D, fading at the start of round N + D + 1.
  // Phase C.2's expiry ticker compares with `<= newRound`, so we stamp
  // expiresAtRound = currentRound + durationRounds + 1 so the fade fires
  // at the TOP of the round AFTER the last action round. This matches
  // "it lasts D full rounds after being cast".
  const expiresAtRound = currentRound + durationRounds + 1;

  const maxHP = Number.isFinite(template.hp) ? template.hp
    : Number.isFinite(template.maxHP) ? template.maxHP
    : 10;
  const currentHP = Number.isFinite(template.currentHP) ? template.currentHP : maxHP;

  const slug = String(template.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return {
    id: `${idPrefix}-${slug || 'creature'}-${now}`,
    sourceNpcId: null,       // summons aren't canonical NPCs — nothing to distill into.
    npcId: null,             // skipped by Phase D distill loop.
    name: template.name,
    hp: maxHP,
    maxHP,
    currentHP,
    ac: Number.isFinite(template.ac) ? template.ac : 10,
    init: Number.isFinite(template.init) ? template.init : 0,
    level: Number.isFinite(template.level) ? template.level : 1,
    hd: Number.isFinite(template.hd) ? template.hd : (template.level || 1),
    controlMode,
    class: template.class || '',
    abilities: template.abilities || null,
    feats: Array.isArray(template.feats) ? template.feats : [],
    conditions: [],
    expiresAtRound,
    isSummon: true,
  };
}

/**
 * Splice a new ally into an existing initiative order, preserving descending
 * initiative sort. Returns { order, currentTurn } with currentTurn bumped
 * if the splice happened before the active turn (so the acting combatant
 * doesn't shift under our feet).
 *
 * @param {Array}  order        Current combat.order ([{id, init, side, ...}, ...]).
 * @param {number} currentTurn  Current combat.currentTurn index.
 * @param {Object} entry        New order entry { id, name, init, side: 'ally' }.
 * @returns {{order: Array, currentTurn: number}}
 */
export function spliceIntoInitiative(order, currentTurn, entry) {
  const safeOrder = Array.isArray(order) ? order : [];
  const safeCurrent = Number.isFinite(currentTurn) ? currentTurn : 0;
  const entryInit = (entry && Number.isFinite(entry.init)) ? entry.init : 0;

  const insertAt = safeOrder.findIndex(o => (o && Number.isFinite(o.init) ? o.init : 0) < entryInit);
  const nextOrder = insertAt === -1
    ? [...safeOrder, entry]
    : [...safeOrder.slice(0, insertAt), entry, ...safeOrder.slice(insertAt)];
  const nextCurrentTurn = (insertAt !== -1 && insertAt <= safeCurrent)
    ? safeCurrent + 1
    : safeCurrent;
  return { order: nextOrder, currentTurn: nextCurrentTurn };
}
