/**
 * Save format migration helpers.
 *
 * Pure functions — no IndexedDB, no DOM, no dmEngine. Safe to import from
 * Node / vite-node test harnesses.
 *
 * Versions:
 *   v1 — legacy (pre-worldState)
 *   v2 — added worldState (Phase 6)
 *   v3 — Phase 7.7: character.familiar defaults to null, and
 *        worldState.familiarLocation defaults to {} so downstream code can
 *        assume the field exists without null-guarding.
 *   v4 — adventurer's journal is now snapshotted into the save under a
 *        `journal` field (journalNotes, encounteredCreatures,
 *        encounteredNpcs, encounteredFactions, encounteredLocations,
 *        areaItems). Loads of v1-v3 saves leave the journal untouched —
 *        they just don't restore it, because it wasn't captured.
 */

export const SAVE_FORMAT_VERSION = 4;

/**
 * Normalize a save payload to the current format.
 *
 * Idempotent. Returns a shallow-cloned, patched payload without mutating
 * the input. Callers should prefer this over hand-rolling defaults whenever
 * they accept legacy save data (IndexedDB loads, file imports, cloud pulls).
 */
export function migrateSaveData(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const from = raw.version || 1;
  if (from >= SAVE_FORMAT_VERSION) {
    // Already current — still ensure the familiar-field defaults exist in
    // case somebody constructed a v3 payload by hand without them.
    return applyFamiliarDefaults(raw);
  }

  const migrated = applyFamiliarDefaults({ ...raw, version: SAVE_FORMAT_VERSION });
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[Save] Migrated save from v${from} → v${SAVE_FORMAT_VERSION}`);
  }
  return migrated;
}

/**
 * Default character.familiar = null and worldState.familiarLocation = {}.
 *
 * Preserves every other field untouched. Returns a new object with shallow
 * clones of the mutated pieces; never mutates the input.
 */
export function applyFamiliarDefaults(save) {
  if (!save || typeof save !== 'object') return save;

  const party = Array.isArray(save.party)
    ? save.party.map(c => {
        if (!c || typeof c !== 'object') return c;
        // Preserve an already-valid familiar (null or object). Only the
        // "missing" and "explicit-undefined" cases fall through to default
        // to null, because `'familiar' in c` alone returns true for
        // `{ familiar: undefined }` which violates the v3 contract.
        if ('familiar' in c && c.familiar !== undefined) return c;
        return { ...c, familiar: null };
      })
    : save.party;

  let worldState = save.worldState;
  if (worldState && typeof worldState === 'object') {
    // `typeof [] === 'object'` so we must also reject arrays explicitly —
    // a malformed v1/v2 payload (or a hand-built test fixture) might carry an
    // array where an object is expected.
    const loc = worldState.familiarLocation;
    const locIsValidObject = loc && typeof loc === 'object' && !Array.isArray(loc);
    if (!locIsValidObject) {
      worldState = { ...worldState, familiarLocation: {} };
    }
  }
  // If worldState is null/undefined, leave it alone — brand-new sessions
  // initialize their own worldState at runtime.

  return { ...save, party, worldState };
}
