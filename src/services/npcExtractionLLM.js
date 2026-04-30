/**
 * DEPRECATED — this file is now a shim. The extractor was renamed and
 * its scope expanded from NPCs-only to the full Tier 1 scene schema
 * (NPCs, items, locations, factions, quests, rumors, clues) in the
 * same bug arc (#58). See src/services/sceneExtractionLLM.js for the
 * implementation.
 *
 * Nothing in the codebase should import from this file going forward.
 * The re-export is preserved so a stale import that slipped in during
 * the rename window doesn't break the build. Remove once verified
 * unused.
 */
export { extractSceneEntities, extractNPCsLLM, _internal } from './sceneExtractionLLM.js';
