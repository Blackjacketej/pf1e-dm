/**
 * Campaign Source-Material Ingestion
 *
 * Declarative seeding for a campaign from source-book data. Feed this a
 * plain JSON-ish object describing a setting (regions, factions, relations,
 * goals, leaders, secrets) and get back a fully-populated campaign with
 * every faction enriched with living-world state.
 *
 * The format is designed to be human-authored (from a PF1e Adventure Path,
 * a homebrew setting doc, or LLM-generated) AND machine-producible — you
 * can scaffold a new campaign in one call.
 *
 * Source schema (all fields optional except name):
 *
 *   {
 *     name: "Rise of the Runelords",
 *     setting: "Golarion",
 *     regions: [
 *       {
 *         id: "varisia",
 *         name: "Varisia",
 *         factions: [
 *           {
 *             id: "sandpoint-garrison",
 *             name: "Sandpoint Garrison",
 *             archetype: "martial",
 *             speciesHints: ["human"],
 *             baseReputation: 10,
 *             leader: { name: "Sheriff Hemlock", title: "Sheriff", legitimacy: 85 },
 *             resources: { manpower: 40, influence: 60 },
 *             goals: [{ type: "survival", narrative: "defend Sandpoint" }],
 *             secrets: [{ narrative: "...", severity: "serious" }],
 *             motto: "The Light Shall Guard",
 *             mood: "wary"
 *           },
 *           ...
 *         ]
 *       }
 *     ],
 *     factionRelations: [
 *       { from: "sandpoint-garrison", to: "thistletop-goblins", score: -80, mutual: true, reason: "border raids" },
 *     ],
 *     initialReputation: { fame: 0, infamy: 0 }
 *   }
 */

import { createCampaign, addRegion, addFaction, setFactionRelation } from './campaign.js';
import { createRegion } from './factionInference.js';
import { setMood, createGoal, createSecret, createRumor, setRelation } from './factionLife.js';
import { createReputation } from './reputation.js';

/**
 * seedCampaignFromSource(source) → fully-populated campaign
 *
 * Validates, then builds regions/factions/relations in dependency order.
 * Returns { campaign, warnings } — warnings surface anything skipped or
 * fixed up during ingestion.
 */
export function seedCampaignFromSource(source) {
  const warnings = [];
  if (!source || typeof source !== 'object') {
    return { campaign: createCampaign(), warnings: ['Invalid source: not an object'] };
  }

  let campaign = createCampaign({
    name: source.name || 'Untitled Campaign',
    setting: source.setting || null,
    reputation: source.initialReputation
      ? { ...createReputation(), ...source.initialReputation }
      : createReputation(),
  });

  // Pass 1: declare regions + factions
  for (const regionDef of (source.regions || [])) {
    if (!regionDef.id) {
      warnings.push(`Skipped region without id: ${regionDef.name || '(unnamed)'}`);
      continue;
    }

    const regionFactionStubs = [];

    for (const f of (regionDef.factions || [])) {
      if (!f.id) {
        warnings.push(`Skipped faction without id in region ${regionDef.id}: ${f.name || '(unnamed)'}`);
        continue;
      }

      campaign = addFaction(campaign, f.id, {
        name: f.name || f.id,
        archetype: f.archetype || 'mercantile',
        settlement: f.settlement || regionDef.name || null,
        members: f.members || [],
        baseReputation: typeof f.baseReputation === 'number' ? f.baseReputation : 0,
        rivalFactions: f.rivalFactions || [],
        alliedFactions: f.alliedFactions || [],
      }, {
        mood: f.mood || 'stable',
        leadership: f.leader ? {
          current: f.leader.name || f.leader.id || null,
          title: f.leader.title || 'Leader',
          legitimacy: f.leader.legitimacy ?? 75,
          succession: f.leader.succession || [],
          challengers: f.leader.challengers || [],
        } : undefined,
        resources: f.resources ? { ...f.resources } : undefined,
        goals: (f.goals || []).map(g => ({ ...g })),
        secrets: (f.secrets || []).map(s => ({ ...s })),
        rumors: (f.rumors || []).map(r => ({ ...r })),
        mottoOrBelief: f.motto || f.mottoOrBelief || null,
        foundingDate: f.foundingDate || null,
        stanceTowardParty: f.stanceTowardParty || 'unknown',
      });

      // Partial resources: fill in unspecified fields with archetype defaults
      if (f.resources && Object.keys(f.resources).length < 5) {
        // Already handled — defaultResources isn't applied for partial; patch here
        const current = campaign.factions[f.id].life.resources;
        const defaults = defaultResourceValues(f.archetype || 'mercantile');
        campaign.factions[f.id].life.resources = { ...defaults, ...current, ...f.resources };
      }

      regionFactionStubs.push({
        factionId: f.id,
        name: f.name || f.id,
        archetype: f.archetype || 'mercantile',
        speciesHints: f.speciesHints || [],
      });
    }

    const region = createRegion(regionDef.id, {
      name: regionDef.name || regionDef.id,
      factions: regionFactionStubs,
    });
    campaign = addRegion(campaign, region);
  }

  // Pass 2: inter-faction relations (need factions to exist first)
  for (const rel of (source.factionRelations || [])) {
    if (!rel.from || !rel.to) {
      warnings.push(`Skipped relation missing from/to: ${JSON.stringify(rel)}`);
      continue;
    }
    if (!campaign.factions[rel.from]) {
      warnings.push(`Relation skipped — unknown faction: ${rel.from}`);
      continue;
    }
    if (!campaign.factions[rel.to]) {
      warnings.push(`Relation skipped — unknown faction: ${rel.to}`);
      continue;
    }
    campaign = setFactionRelation(campaign, rel.from, rel.to, rel.score ?? 0, {
      mutual: rel.mutual === true,
      reason: rel.reason || null,
    });
    // Also mirror onto faction.relations for local lookup
    campaign.factions[rel.from] = setRelation(
      campaign.factions[rel.from],
      rel.to,
      rel.score ?? 0,
      { reason: rel.reason || null }
    );
    if (rel.mutual) {
      campaign.factions[rel.to] = setRelation(
        campaign.factions[rel.to],
        rel.from,
        rel.score ?? 0,
        { reason: rel.reason || null }
      );
    }
  }

  return { campaign, warnings };
}

/**
 * Extend an existing campaign with additional source material (e.g. layer a
 * Rise of the Runelords volume on top of the Sandpoint base). Adds new
 * regions/factions/relations. Existing factions are *not* overwritten; a
 * warning is emitted for any conflict so the caller can decide how to handle
 * layered overrides.
 *
 * Cross-source relations (e.g. a RotR faction referencing a Sandpoint faction)
 * resolve cleanly as long as both sources have been seeded.
 *
 * Returns { campaign, warnings }.
 */
export function extendCampaignFromSource(campaign, source) {
  const warnings = [];
  if (!source || typeof source !== 'object') {
    return { campaign, warnings: ['Invalid source: not an object'] };
  }
  let next = campaign;

  // Pass 1: regions + factions (skip existing)
  for (const regionDef of (source.regions || [])) {
    if (!regionDef.id) {
      warnings.push(`Skipped region without id: ${regionDef.name || '(unnamed)'}`);
      continue;
    }
    const regionFactionStubs = [];
    for (const f of (regionDef.factions || [])) {
      if (!f.id) {
        warnings.push(`Skipped faction without id in region ${regionDef.id}: ${f.name || '(unnamed)'}`);
        continue;
      }
      if (next.factions[f.id]) {
        warnings.push(`Faction already exists, skipped: ${f.id}`);
        regionFactionStubs.push({
          factionId: f.id,
          name: next.factions[f.id].name,
          archetype: next.factions[f.id].archetype,
          speciesHints: f.speciesHints || [],
        });
        continue;
      }

      next = addFaction(next, f.id, {
        name: f.name || f.id,
        archetype: f.archetype || 'mercantile',
        settlement: f.settlement || regionDef.name || null,
        members: f.members || [],
        baseReputation: typeof f.baseReputation === 'number' ? f.baseReputation : 0,
        rivalFactions: f.rivalFactions || [],
        alliedFactions: f.alliedFactions || [],
      }, {
        mood: f.mood || 'stable',
        leadership: f.leader ? {
          current: f.leader.name || f.leader.id || null,
          title: f.leader.title || 'Leader',
          legitimacy: f.leader.legitimacy ?? 75,
          succession: f.leader.succession || [],
          challengers: f.leader.challengers || [],
        } : undefined,
        resources: f.resources ? { ...f.resources } : undefined,
        goals: (f.goals || []).map(g => ({ ...g })),
        secrets: (f.secrets || []).map(s => ({ ...s })),
        rumors: (f.rumors || []).map(r => ({ ...r })),
        mottoOrBelief: f.motto || f.mottoOrBelief || null,
        foundingDate: f.foundingDate || null,
        stanceTowardParty: f.stanceTowardParty || 'unknown',
      });

      if (f.resources && Object.keys(f.resources).length < 5) {
        const current = next.factions[f.id].life.resources;
        const defaults = defaultResourceValues(f.archetype || 'mercantile');
        next.factions[f.id].life.resources = { ...defaults, ...current, ...f.resources };
      }

      regionFactionStubs.push({
        factionId: f.id,
        name: f.name || f.id,
        archetype: f.archetype || 'mercantile',
        speciesHints: f.speciesHints || [],
      });
    }

    // If region already exists, merge faction stubs; otherwise create it
    const existingRegion = next.regions.find(r => r.id === regionDef.id);
    if (existingRegion) {
      const existingIds = new Set(existingRegion.factions.map(fs => fs.factionId));
      for (const stub of regionFactionStubs) {
        if (!existingIds.has(stub.factionId)) existingRegion.factions.push(stub);
      }
    } else {
      const region = createRegion(regionDef.id, {
        name: regionDef.name || regionDef.id,
        factions: regionFactionStubs,
      });
      next = addRegion(next, region);
    }
  }

  // Pass 2: relations
  for (const rel of (source.factionRelations || [])) {
    if (!rel.from || !rel.to) {
      warnings.push(`Skipped relation missing from/to: ${JSON.stringify(rel)}`);
      continue;
    }
    if (!next.factions[rel.from]) {
      warnings.push(`Relation skipped — unknown faction: ${rel.from}`);
      continue;
    }
    if (!next.factions[rel.to]) {
      warnings.push(`Relation skipped — unknown faction: ${rel.to}`);
      continue;
    }
    next = setFactionRelation(next, rel.from, rel.to, rel.score ?? 0, {
      mutual: rel.mutual === true,
      reason: rel.reason || null,
    });
    next.factions[rel.from] = setRelation(next.factions[rel.from], rel.to, rel.score ?? 0, { reason: rel.reason || null });
    if (rel.mutual) {
      next.factions[rel.to] = setRelation(next.factions[rel.to], rel.from, rel.score ?? 0, { reason: rel.reason || null });
    }
  }

  return { campaign: next, warnings };
}

/**
 * Export a campaign back to the source-material format. Useful for save files
 * or porting a campaign between installations.
 */
export function exportCampaignAsSource(campaign) {
  return {
    name: campaign.name,
    setting: campaign.setting,
    regions: campaign.regions.map(r => ({
      id: r.id,
      name: r.name,
      factions: r.factions.map(f => {
        const full = campaign.factions[f.factionId];
        if (!full) return { id: f.factionId, name: f.name, archetype: f.archetype };
        return {
          id: f.factionId,
          name: full.name,
          archetype: full.archetype,
          speciesHints: f.speciesHints,
          baseReputation: full.baseReputation,
          mood: full.life?.mood,
          leader: full.life?.leadership?.current ? {
            name: full.life.leadership.current,
            title: full.life.leadership.title,
            legitimacy: full.life.leadership.legitimacy,
          } : undefined,
          resources: full.life?.resources,
          goals: full.life?.goals,
          secrets: full.life?.secrets,
          motto: full.life?.mottoOrBelief,
        };
      }),
    })),
    factionRelations: Object.entries(campaign.factionRelations || {}).map(([key, rel]) => {
      const [from, to] = key.split('->');
      return { from, to, score: rel.score, reason: rel.reason };
    }),
    initialReputation: campaign.reputation
      ? { fame: campaign.reputation.fame, infamy: campaign.reputation.infamy }
      : undefined,
  };
}

// Internal — mirrors defaultResources from factionLife.js but without the import cycle concern
function defaultResourceValues(archetype) {
  const base = { wealth: 50, manpower: 50, influence: 50, secrecy: 50, morale: 70 };
  return base;
}
