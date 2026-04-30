/**
 * Campaign Container
 *
 * The top-level object that owns a campaign's living world:
 *
 *   - regions          : named areas, each with a list of declared faction ids
 *   - factions         : the full faction catalog (canonical + promoted-novel)
 *   - novelQueue       : on-the-fly factions awaiting GM review
 *   - reputation       : the party's fame/infamy record
 *   - deedLog          : chronological record of party deeds
 *   - worldTime        : in-game hours elapsed
 *
 * This module owns the promote / merge / rename / discard operations on
 * novel factions, and keeps NPCs in sync when faction ids change.
 *
 * Pure functions. Every mutation returns a new campaign object.
 *
 * Public API:
 *   createCampaign(cfg)
 *   addRegion, addFaction, getFaction, listFactionsByRegion
 *   enqueueNovelFaction(campaign, inference, context)
 *   promoteNovelFaction(campaign, novelId, regionId, opts)
 *   mergeFactions(campaign, fromId, intoId, npcs)
 *   renameFaction(campaign, factionId, newName, npcs)
 *   discardNovelFaction(campaign, novelId)
 *   listPendingNovelFactions(campaign)
 */

import { createFaction } from './factions.js';
import { enrichFactionWithLife } from './factionLife.js';

// ==============================================================================
// Construction
// ==============================================================================

export function createCampaign(cfg = {}) {
  return {
    name: cfg.name || 'Untitled Campaign',
    setting: cfg.setting || null,           // PF1e setting book, homebrew id, etc.
    regions: cfg.regions || [],             // array of region objects
    factions: {},                           // keyed by factionId (canonical store)
    novelQueue: [],                         // awaiting GM review
    reputation: cfg.reputation || null,     // from reputation.js::createReputation
    deedLog: [],                            // chronological deeds
    worldTime: { hoursElapsed: 0, day: 1, hourOfDay: 8 },
    factionRelations: cfg.factionRelations || {},  // id->id directed edges
  };
}

// ==============================================================================
// Region + faction registration
// ==============================================================================

export function addRegion(campaign, region) {
  return {
    ...campaign,
    regions: [...campaign.regions, region],
  };
}

/**
 * addFaction - register a faction in the campaign catalog. Enriches with
 * living-world state automatically.
 *
 * @param {object} campaign
 * @param {string} factionId - stable id, e.g. "bloodtusk-tribe"
 * @param {object} factionCfg - cfg for createFaction
 * @param {object} lifeCfg - cfg for enrichFactionWithLife (optional)
 */
export function addFaction(campaign, factionId, factionCfg = {}, lifeCfg = {}) {
  const base = createFaction(factionCfg);
  const withLife = enrichFactionWithLife(base, lifeCfg);
  return {
    ...campaign,
    factions: {
      ...campaign.factions,
      [factionId]: { ...withLife, id: factionId },
    },
  };
}

export function getFaction(campaign, factionId) {
  return campaign.factions[factionId] || null;
}

export function listFactionsByRegion(campaign, regionId) {
  const region = campaign.regions.find(r => r.id === regionId);
  if (!region) return [];
  return region.factions
    .map(f => campaign.factions[f.factionId])
    .filter(Boolean);
}

// ==============================================================================
// Novel faction queue
// ==============================================================================

/**
 * enqueueNovelFaction - when inferFactionForNPC returns a novel result,
 * call this to stash it for GM review. Returns { campaign, queueEntry }.
 *
 * A placeholder faction is still registered so reputation math works
 * immediately - it's just marked pending.
 */
export function enqueueNovelFaction(campaign, inference, context = {}) {
  const {
    factionId,
    archetype,
    source,
    warnings,
  } = inference;

  // Create a placeholder faction so reputation can operate
  let updated = campaign;
  if (!updated.factions[factionId]) {
    updated = addFaction(updated, factionId, {
      name: context.suggestedName || factionId,
      archetype,
    }, { mottoOrBelief: context.mottoOrBelief });
  }
  updated.factions[factionId].pending = true;
  updated.factions[factionId].pendingSource = source;

  const entry = {
    id: factionId,
    suggestedName: context.suggestedName || factionId,
    archetype,
    source,
    species: context.species || null,
    region: context.region?.id || null,
    firstSeenNpc: context.firstSeenNpc || null,
    warnings: warnings || [],
    createdAt: new Date().toISOString(),
  };

  return {
    campaign: {
      ...updated,
      novelQueue: [...(updated.novelQueue || []), entry],
    },
    queueEntry: entry,
  };
}

export function listPendingNovelFactions(campaign) {
  // Bug #28: pre-faction-system saves have no novelQueue field - spreading
  // undefined threw when opening FactionsTab. Null-safe fallback to [].
  return [...(campaign?.novelQueue || [])];
}

// ==============================================================================
// Promote / merge / rename / discard
// ==============================================================================

/**
 * promoteNovelFaction - accept a queued novel faction as canonical.
 * Optionally attaches it to a region and gives it a display name.
 */
export function promoteNovelFaction(campaign, novelId, opts = {}) {
  const entry = (campaign?.novelQueue || []).find(e => e.id === novelId);
  if (!entry) return campaign;

  const faction = campaign.factions[novelId];
  if (!faction) return campaign;

  const renamed = opts.name
    ? { ...faction, name: opts.name, id: novelId, pending: false }
    : { ...faction, pending: false };

  let updated = {
    ...campaign,
    factions: { ...campaign.factions, [novelId]: renamed },
    novelQueue: (campaign.novelQueue || []).filter(e => e.id !== novelId),
  };

  // Attach to region if requested
  if (opts.regionId) {
    updated = {
      ...updated,
      regions: updated.regions.map(r => {
        if (r.id !== opts.regionId) return r;
        if (r.factions.some(f => f.factionId === novelId)) return r;
        return {
          ...r,
          factions: [
            ...r.factions,
            {
              factionId: novelId,
              name: renamed.name,
              archetype: renamed.archetype,
              speciesHints: opts.speciesHints || (entry.species ? [entry.species] : []),
            },
          ],
        };
      }),
    };
  }

  return updated;
}

/**
 * mergeFactions - fold `fromId` into `intoId`. Re-tags every NPC carrying
 * the old id, merges event logs, preserves the target's name.
 *
 * @param {object} campaign
 * @param {string} fromId - faction to absorb (will be removed)
 * @param {string} intoId - faction to keep
 * @param {object[]} npcs - optional array of NPCs; returned updated
 * @returns { campaign, npcs: updatedNpcs }
 */
export function mergeFactions(campaign, fromId, intoId, npcs = []) {
  const from = campaign.factions[fromId];
  const into = campaign.factions[intoId];
  if (!from || !into) return { campaign, npcs };

  // Combine events + members
  const combinedEvents = [...(into.events || []), ...(from.events || [])];
  const combinedMembers = Array.from(new Set([...(into.members || []), ...(from.members || [])]));

  const updatedInto = {
    ...into,
    events: combinedEvents,
    members: combinedMembers,
    cachedReputation: null,
  };

  // Remove fromId from catalog + any region declarations + queue
  const { [fromId]: _, ...restFactions } = campaign.factions;
  const updatedRegions = campaign.regions.map(r => ({
    ...r,
    factions: r.factions.filter(f => f.factionId !== fromId),
  }));

  // Re-tag NPCs
  const updatedNpcs = npcs.map(npc => {
    if (!npc.factions || npc.factions.length === 0) return npc;
    const retagged = npc.factions.map(tag => {
      const tid = tag.factionId || tag;
      if (tid === fromId) {
        return typeof tag === 'string'
          ? intoId
          : { ...tag, factionId: intoId, mergedFrom: fromId };
      }
      return tag;
    });
    return { ...npc, factions: retagged };
  });

  return {
    campaign: {
      ...campaign,
      factions: { ...restFactions, [intoId]: updatedInto },
      regions: updatedRegions,
      novelQueue: (campaign.novelQueue || []).filter(e => e.id !== fromId),
    },
    npcs: updatedNpcs,
  };
}

export function renameFaction(campaign, factionId, newName, npcs = []) {
  const faction = campaign.factions[factionId];
  if (!faction) return { campaign, npcs };

  const updated = { ...faction, name: newName };
  // NPC tags reference factionId, not name - NPCs don't need updating here.
  // Still return npcs for API consistency.
  return {
    campaign: {
      ...campaign,
      factions: { ...campaign.factions, [factionId]: updated },
    },
    npcs,
  };
}

export function discardNovelFaction(campaign, novelId, npcs = []) {
  const { [novelId]: _, ...restFactions } = campaign.factions;
  const updatedNpcs = npcs.map(npc => {
    if (!npc.factions) return npc;
    return {
      ...npc,
      factions: npc.factions.filter(t => (t.factionId || t) !== novelId),
    };
  });
  return {
    campaign: {
      ...campaign,
      factions: restFactions,
      novelQueue: (campaign.novelQueue || []).filter(e => e.id !== novelId),
    },
    npcs: updatedNpcs,
  };
}

// ==============================================================================
// Inter-faction relations (campaign-level convenience)
// ==============================================================================

/**
 * setFactionRelation - directed relation (a->b). Pass mutual=true to set both.
 */
export function setFactionRelation(campaign, fromId, toId, score, opts = {}) {
  const edges = { ...(campaign.factionRelations || {}) };
  const key = `${fromId}->${toId}`;
  edges[key] = {
    score: Math.max(-100, Math.min(100, score)),
    reason: opts.reason || null,
    timestamp: opts.timestamp || new Date().toISOString(),
  };
  let updated = { ...campaign, factionRelations: edges };
  if (opts.mutual) {
    const revKey = `${toId}->${fromId}`;
    updated.factionRelations[revKey] = {
      score: Math.max(-100, Math.min(100, score)),
      reason: opts.reason || null,
      timestamp: opts.timestamp || new Date().toISOString(),
    };
  }
  return updated;
}

export function getFactionRelation(campaign, fromId, toId) {
  return (campaign?.factionRelations || {})[`${fromId}->${toId}`] || null;
}
