/**
 * Faction Inference
 *
 * When the AI DM encounters an NPC (or a group of NPCs), it has to decide
 * which faction they belong to AND which archetype lens applies. Left
 * unconstrained, the AI will drift — the same orc band gets tagged "tribe"
 * in scene 1, "pack" in scene 3, and a made-up faction in scene 5.
 *
 * This module constrains the discretion:
 *
 *   1. SPECIES DEFAULTS — each species has a plausible archetype set.
 *      An orc can be tribe/horde/pack/cult, but never guild or monastery.
 *
 *   2. REGIONAL DECLARATIONS — a campaign setting pre-declares the factions
 *      that exist in each region. Encountered NPCs prefer to be tagged with
 *      a declared regional faction before inventing a new one.
 *
 *   3. COMMITMENT — once an NPC is tagged, the tag is persisted. Future
 *      interactions with that NPC do not re-infer; they read state.
 *
 *   4. NOVEL FLAG — if the AI tags an NPC with an invented faction (no
 *      regional declaration matches and no existing faction fits), the
 *      result is marked `novel: true` so the GM can confirm or rename
 *      before the tag locks.
 *
 * Pure functions. Consumers own persistence.
 */

// ══════════════════════════════════════════════════════════════════════════════
// Species → allowed archetypes
// ══════════════════════════════════════════════════════════════════════════════
//
// Ordering matters: the first archetype listed is the DEFAULT if nothing else
// disambiguates. Subsequent entries are acceptable alternatives the AI may
// pick given context (location, group size, behavioral cues).

export const SPECIES_ARCHETYPES = {
  // Humanoid civilized
  human:        ['mercantile', 'martial', 'noble_house', 'criminal', 'religious', 'scholarly', 'artisan', 'guild', 'monastery', 'outcast'],
  halfling:     ['mercantile', 'artisan', 'caravan', 'criminal', 'outcast'],
  gnome:        ['scholarly', 'artisan', 'mercantile', 'enclave'],
  dwarf:        ['clan', 'guild', 'martial', 'artisan', 'monastery'],
  elf:          ['enclave', 'noble_house', 'scholarly', 'court'],
  'half-elf':   ['outcast', 'mercantile', 'scholarly'],
  'half-orc':   ['outcast', 'martial', 'tribe', 'mercantile'],

  // Goblinoid / orcish
  goblin:       ['tribe', 'pack', 'horde', 'cult'],
  hobgoblin:    ['martial', 'horde', 'tribe'],
  bugbear:      ['pack', 'tribe', 'horde'],
  orc:          ['tribe', 'horde', 'pack', 'cult'],

  // Beastfolk / savage
  gnoll:        ['pack', 'horde', 'cult'],
  kobold:       ['tribe', 'cult', 'pack'],
  lizardfolk:   ['tribe', 'enclave'],
  catfolk:      ['tribe', 'caravan'],

  // Giantkin
  ogre:         ['pack', 'horde', 'tribe'],
  giant:        ['clan', 'tribe', 'horde'],
  troll:        ['pack'],

  // Fey / magical
  drow:         ['court', 'noble_house', 'criminal', 'coven'],
  fey:          ['court', 'enclave', 'coven'],
  sylph:        ['enclave', 'court'],

  // Monstrous / planar
  dragon:       ['hoard'],
  lich:         ['consortium', 'hoard', 'cult'],
  vampire:      ['court', 'noble_house', 'consortium'],
  undead:       ['consortium', 'cult', 'horde'],
  aberration:   ['hive', 'cult', 'consortium'],
  devil:        ['court', 'consortium', 'cult'],
  demon:        ['horde', 'cult', 'pack'],
  formian:      ['hive'],

  // Hags / witches
  hag:          ['coven'],
  witch:        ['coven', 'cult'],
};

// Fallback order when species is unknown
const UNKNOWN_SPECIES_FALLBACK = ['mercantile', 'outcast', 'martial'];

// ══════════════════════════════════════════════════════════════════════════════
// Regional declarations
// ══════════════════════════════════════════════════════════════════════════════
//
// A region is a campaign-defined area (a kingdom, forest, city, dungeon).
// Each region pre-declares the named factions that exist there. The AI
// should prefer to tag encountered NPCs with one of these before inventing.

/**
 * createRegion — used by campaign setup to declare a region's factions.
 *
 * @param {string} id — stable region id, e.g. "bloodtusk-rise"
 * @param {object} opts
 *   - name: display name
 *   - factions: array of { factionId, name, archetype, speciesHints?: [...] }
 */
export function createRegion(id, opts = {}) {
  return {
    id,
    name: opts.name || id,
    factions: (opts.factions || []).map(f => ({
      factionId: f.factionId,
      name: f.name,
      archetype: f.archetype,
      speciesHints: f.speciesHints || [], // which species typically belong
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Inference
// ══════════════════════════════════════════════════════════════════════════════

/**
 * inferFactionForNPC — decides (or confirms) the faction/archetype for an NPC.
 *
 * Resolution order:
 *   1. If the NPC already carries a faction tag → return it (COMMITMENT).
 *   2. If a regional faction exists whose speciesHints include this species
 *      → use that faction (REGIONAL DECLARATION).
 *   3. If the AI DM suggested an archetype, validate it's allowed for the
 *      species → if yes, use it; if no, fall through.
 *   4. Pick the species default → create a novel faction.
 *   5. If species is unknown → pick fallback.
 *
 * @param {object} npc — must have at least { species, factions? }
 * @param {object} context
 *   - region: a region object from createRegion
 *   - suggestedArchetype?: what the AI wants to tag (optional)
 *   - suggestedFactionName?: narrative faction name for novel factions
 *   - groupSize?: number — influences pack vs horde vs tribe
 *   - behaviorHints?: array of tags the AI observed ('raiding', 'worshipping', 'organized')
 *
 * @returns {object} {
 *   factionId: string,
 *   archetype: string,
 *   source: 'committed' | 'regional' | 'suggested' | 'species-default' | 'fallback',
 *   novel: boolean,   // true if we invented a faction that isn't in the region yet
 *   warnings: string[],
 * }
 */
export function inferFactionForNPC(npc, context = {}) {
  const species = (npc.species || '').toLowerCase();
  const warnings = [];

  // 1. COMMITMENT — NPC already carries a tag
  if (npc.factions && npc.factions.length > 0) {
    const tag = npc.factions[0];
    return {
      factionId: tag.factionId || tag,
      archetype: tag.archetype || null,
      source: 'committed',
      novel: false,
      warnings: [],
    };
  }

  const allowed = SPECIES_ARCHETYPES[species];
  const allowedSet = new Set(allowed || UNKNOWN_SPECIES_FALLBACK);

  // 2. REGIONAL DECLARATION — prefer an existing regional faction,
  //    BUT roll a small chance to spawn a brand-new faction instead.
  //    This is the "story-thread generator" — even in a canonical region,
  //    the AI may discover that these particular orcs are not the Bloodtusk
  //    Tribe but a splinter, a refugee cell, a secret cult, or something
  //    entirely new. Makes the world feel alive and surprising.
  if (context.region && context.region.factions) {
    const speciesMatch = context.region.factions.filter(
      f => f.speciesHints.includes(species)
    );
    if (speciesMatch.length > 0) {
      const noveltyChance = typeof context.noveltyChance === 'number'
        ? context.noveltyChance
        : 0.08; // 8% default — rare but non-zero
      const rng = context.rng || Math.random;
      const rollNovel = rng() < noveltyChance;

      if (!rollNovel) {
        let chosen = speciesMatch[0];
        if (context.suggestedArchetype) {
          const refined = speciesMatch.find(f => f.archetype === context.suggestedArchetype);
          if (refined) chosen = refined;
        }
        return {
          factionId: chosen.factionId,
          archetype: chosen.archetype,
          source: 'regional',
          novel: false,
          warnings: [],
        };
      }
      // Fell through to novel generation — mark it
      warnings.push(
        `Novelty roll triggered: instead of using a canonical regional faction for ` +
        `species "${species}", inference is spawning a new faction. This opens a ` +
        `potential story thread — GM should review and shape it.`
      );
    }
  }

  // 3. SUGGESTED ARCHETYPE — validate against species
  if (context.suggestedArchetype) {
    if (allowedSet.has(context.suggestedArchetype)) {
      return {
        factionId: context.suggestedFactionName || `novel:${species}:${context.suggestedArchetype}`,
        archetype: context.suggestedArchetype,
        source: 'suggested',
        novel: true,
        warnings: context.region
          ? [`Novel faction invented for region "${context.region.id}" — GM should confirm or merge with existing faction.`]
          : [],
      };
    }
    warnings.push(
      `Suggested archetype "${context.suggestedArchetype}" is not typical for species "${species}". Falling back to species default.`
    );
  }

  // 4. SPECIES DEFAULT — pick the first allowed, possibly refined by groupSize/behavior
  if (allowed && allowed.length > 0) {
    const chosen = refineBySpeciesContext(allowed, context);
    return {
      factionId: context.suggestedFactionName || `novel:${species}:${chosen}`,
      archetype: chosen,
      source: 'species-default',
      novel: true,
      warnings,
    };
  }

  // 5. FALLBACK — unknown species
  warnings.push(`Unknown species "${species}"; using fallback archetype.`);
  return {
    factionId: context.suggestedFactionName || `novel:unknown:${UNKNOWN_SPECIES_FALLBACK[0]}`,
    archetype: UNKNOWN_SPECIES_FALLBACK[0],
    source: 'fallback',
    novel: true,
    warnings,
  };
}

/**
 * Light disambiguation based on context. Keeps decisions stable — same
 * inputs always produce the same output.
 */
function refineBySpeciesContext(allowed, ctx) {
  const groupSize = ctx.groupSize || 0;
  const hints = new Set((ctx.behaviorHints || []).map(h => h.toLowerCase()));

  // Huge group and mass-action behavior → horde
  if (allowed.includes('horde') && (groupSize >= 30 || hints.has('marching') || hints.has('invading'))) {
    return 'horde';
  }
  // Small aggressive group → pack
  if (allowed.includes('pack') && groupSize > 0 && groupSize <= 6 && hints.has('hunting')) {
    return 'pack';
  }
  // Ritual or religious behavior → cult
  if (allowed.includes('cult') && (hints.has('worshipping') || hints.has('ritual') || hints.has('chanting'))) {
    return 'cult';
  }
  // Settled or organized behavior → tribe (over pack/horde)
  if (allowed.includes('tribe') && (hints.has('settled') || hints.has('village') || hints.has('children-present'))) {
    return 'tribe';
  }
  return allowed[0];
}

/**
 * commitFactionTag — persists an inference result onto an NPC. Once committed,
 * future inferFactionForNPC calls for this NPC short-circuit at step 1.
 */
export function commitFactionTag(npc, inference) {
  const tag = {
    factionId: inference.factionId,
    archetype: inference.archetype,
    committedAt: new Date().toISOString(),
    source: inference.source,
  };
  return {
    ...npc,
    factions: [...(npc.factions || []), tag],
  };
}

/**
 * isSpeciesArchetypeAllowed — utility for the AI DM to check before suggesting
 */
export function isSpeciesArchetypeAllowed(species, archetype) {
  const allowed = SPECIES_ARCHETYPES[(species || '').toLowerCase()];
  if (!allowed) return false;
  return allowed.includes(archetype);
}

/**
 * allowedArchetypesForSpecies — return the list (for UI pickers, etc.)
 */
export function allowedArchetypesForSpecies(species) {
  return SPECIES_ARCHETYPES[(species || '').toLowerCase()] || UNKNOWN_SPECIES_FALLBACK.slice();
}
