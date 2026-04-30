// craftSimulation.js
// Living-world NPC craft tick. Advances each NPC's craftProjects[] by the
// number of weeks elapsed, emitting events for downstream consumers
// (shop stocking, reputation, narrative log).
//
// Separation of concerns:
//   * This module mutates only project state on NPCs.
//   * Shop stocking side-effects belong to shopStocking.js.
//   * Reputation side-effects belong to reputation.js (via recordDeed).
//
// The caller wires the three together using the event list this produces.

import {
  advanceCraftProjectWeekly,
  getOngoingProjects,
} from '../utils/craftDowntime.js';

// --------------------------------------------------------------------
// Event → reputation deed mapping
// Used by tick consumers to convert craft events into recordDeed() calls.

/**
 * Map a single craft event to a reputation deed key + context.
 * Returns null if the event doesn't produce a deed.
 *
 * @param {object} ev — event from tickNpcCrafterProjects
 *                     { kind: 'complete' | 'material-loss' | 'progress',
 *                       projectId, npcId?, subSkill?, ...projectMeta }
 * @param {object} project — the source project (for commissionedBy + masterwork flag)
 */
export function craftEventToDeed(ev, project) {
  if (!ev) return null;
  if (ev.kind === 'material-loss') {
    return {
      deedKey: project?.commissionedBy ? 'botched_commission' : 'ruined_craft_materials',
      context: { tags: ['craftsmanship'] },
    };
  }
  if (ev.kind === 'complete') {
    if (project?.commissionedBy) {
      return { deedKey: 'completed_commission', context: { tags: ['craftsmanship', 'oath_kept'] } };
    }
    const isMasterwork = !!(project?.masterwork && project.masterwork.finished);
    return {
      deedKey: isMasterwork ? 'crafted_masterwork' : 'crafted_item',
      context: { tags: ['craftsmanship'] },
    };
  }
  return null;
}

// --------------------------------------------------------------------
// NPC skill resolution

/**
 * Return a Craft (subSkill) total for an NPC.
 * Looks up skillRanks[subSkill] (exact, case-insensitive), adds the NPC's
 * INT modifier if abilities present. Adds a generic skillBonuses[subSkill]
 * miscellaneous bonus if present. Does NOT currently apply class-skill bonuses
 * (NPCs typically don't store a full class-skill list).
 */
export function getNpcCraftTotal(npc, subSkill) {
  if (!npc || !subSkill) return 0;
  const want = String(subSkill).toLowerCase().trim();
  const ranks = findRanksCaseInsensitive(npc.skillRanks, want);
  const intMod = abilityMod(npc.abilities?.INT);
  const misc = findRanksCaseInsensitive(npc.skillBonuses, want);
  return ranks + intMod + misc;
}

function findRanksCaseInsensitive(obj, key) {
  if (!obj || typeof obj !== 'object') return 0;
  for (const k of Object.keys(obj)) {
    if (String(k).toLowerCase().trim() === key) {
      const v = obj[k];
      return typeof v === 'number' ? v : 0;
    }
  }
  return 0;
}

function abilityMod(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return Math.floor((s - 10) / 2);
}

// --------------------------------------------------------------------
// Single-NPC tick

/**
 * Advance one NPC's projects by N weeks.
 *
 * @param {object} npc
 * @param {number} weeks
 * @param {object} opts — { rng (optional), take10 (default true),
 *                          getSkillTotal (injectable for tests),
 *                          nowIso }
 * @returns {object} — { npc: updatedNpc, events: [...], completions: [...] }
 */
export function tickNpcCrafterProjects(npc, weeks = 1, opts = {}) {
  if (!npc || !Array.isArray(npc.craftProjects) || npc.craftProjects.length === 0) {
    return { npc: npc || null, events: [], completions: [] };
  }
  const w = Math.max(0, Math.floor(Number(weeks) || 0));
  if (w <= 0) {
    return { npc, events: [], completions: [] };
  }
  const now = opts.nowIso || new Date().toISOString();
  const getSkill = opts.getSkillTotal || getNpcCraftTotal;
  const take10 = opts.take10 !== false;
  const rng = opts.rng || Math.random;

  let projects = [...(npc.craftProjects || [])];
  const events = [];
  const completions = [];

  // Each project advances independently for `w` weeks or until completed.
  for (let i = 0; i < projects.length; i++) {
    let p = projects[i];
    if (!p || p.status !== 'in-progress') continue;

    for (let weekIdx = 0; weekIdx < w; weekIdx++) {
      if (p.status !== 'in-progress') break;
      const base = getSkill(npc, p.subSkill);
      const checkTotal = take10 ? base + 10 : base + 1 + Math.floor(rng() * 20);
      const advance = advanceCraftProjectWeekly(p, checkTotal, (p.history?.length || 0), {
        nowIso: now,
      });
      p = advance.project;
      for (const ev of advance.events) {
        events.push({ ...ev, npcId: npc.id, subSkill: p.subSkill });
        if (ev.kind === 'complete') {
          completions.push({
            projectId: p.id,
            npcId: npc.id,
            crafterNpcId: npc.id,
            itemName: p.itemName,
            priceGP: p.priceGP,
            subSkill: p.subSkill,
            masterwork: !!(p.masterwork && p.masterwork.finished),
            commissionedBy: p.commissionedBy || null,
            completedAt: now,
          });
        }
      }
    }
    projects[i] = p;
  }

  const updatedNpc = { ...npc, craftProjects: projects, craftLastTickAt: now };
  return { npc: updatedNpc, events, completions };
}

// --------------------------------------------------------------------
// Roster tick

/**
 * Advance every NPC in a roster. npcs can be an array or a map {id: npc}.
 *
 * @returns {object} — { npcs: updated (same shape), events, completions }
 */
export function tickNPCCrafters(npcs, weeks = 1, opts = {}) {
  if (!npcs) return { npcs, events: [], completions: [] };
  const events = [];
  const completions = [];

  if (Array.isArray(npcs)) {
    const next = npcs.map((n) => {
      const r = tickNpcCrafterProjects(n, weeks, opts);
      events.push(...r.events);
      completions.push(...r.completions);
      return r.npc;
    });
    return { npcs: next, events, completions };
  }
  if (typeof npcs === 'object') {
    const next = {};
    for (const [id, n] of Object.entries(npcs)) {
      const r = tickNpcCrafterProjects(n, weeks, opts);
      events.push(...r.events);
      completions.push(...r.completions);
      next[id] = r.npc;
    }
    return { npcs: next, events, completions };
  }
  return { npcs, events, completions };
}

// --------------------------------------------------------------------
// PC craft tick — parallel to NPC tick, for party members with craft projects.

/**
 * Get a PC's Craft (subSkill) total for downtime crafting.
 *
 * Computes: ranks + INT mod + class-skill +3 + racial bonus + Skill Focus
 *           + misc (skillBonuses).
 *
 * Class-skill note: Craft is a class skill for ALL 11 core classes (CRB Table
 * 4-2), so any PC with at least 1 rank gets the +3 trained class-skill bonus
 * unconditionally.  The caller can override this via opts.classSkillsList if a
 * non-core class lacks Craft, but the default is "always a class skill."
 *
 * Skill Focus: parsed from character.feats[] as a string containing both
 * "skill focus" and the sub-skill name (case-insensitive), following the same
 * loose-match pattern used elsewhere in the codebase (characterSkills.js).
 * Grants +3, or +6 if the character has 10+ ranks in the sub-skill.
 *
 * @param {object} character — PC character object
 * @param {string} subSkill  — e.g. "Craft (weapons)"
 * @param {object} [opts]    — { classSkillsList?: string[] }
 * @returns {number}
 */
export function getPCCraftTotal(character, subSkill, opts = {}) {
  if (!character || !subSkill) return 0;
  const want = String(subSkill).toLowerCase().trim();
  const ranks = findRanksCaseInsensitive(character.skillRanks, want);
  const intMod = abilityMod(character.abilities?.INT);
  const misc = findRanksCaseInsensitive(character.skillBonuses, want);

  // Class-skill +3: Craft is a class skill for every core class. Default true
  // unless the caller explicitly passes a classSkillsList that omits the PC's class.
  let classSkillBonus = 0;
  if (ranks > 0) {
    if (opts.classSkillsList) {
      // Caller provided an explicit list — check membership.
      const pcClass = character.class || '';
      if (opts.classSkillsList.some(c => c.toLowerCase() === pcClass.toLowerCase())) {
        classSkillBonus = 3;
      }
    } else {
      // Default: Craft is a class skill for all 11 CRB classes.
      classSkillBonus = 3;
    }
  }

  // Racial bonus (e.g. gnome +2 Craft chosen at creation)
  const racialBonus = findRanksCaseInsensitive(character.racialSkillBonuses, want);

  // Skill Focus feat: +3, or +6 at 10+ ranks
  const skillFocusBonus = getSkillFocusBonus(character, want, ranks);

  return ranks + intMod + classSkillBonus + racialBonus + skillFocusBonus + misc;
}

/**
 * Parse character.feats for Skill Focus matching a given skill name.
 * Returns 0 / 3 / 6.
 */
function getSkillFocusBonus(character, skillNameLower, ranks) {
  const feats = character?.feats;
  if (!Array.isArray(feats) || feats.length === 0) return 0;
  const hasMatch = feats.some(f => {
    if (f == null) return false;
    const lower = (typeof f === 'string' ? f : (f.name || '')).toLowerCase().trim();
    return lower.includes('skill focus') && lower.includes(skillNameLower);
  });
  if (!hasMatch) return 0;
  return ranks >= 10 ? 6 : 3;
}

/**
 * Advance all PC craft projects by N weeks. Same pattern as tickNPCCrafters
 * but operates on the party array.
 *
 * @param {Array} party — array of character objects
 * @param {number} weeks
 * @param {object} opts — { take10 (default true), nowIso }
 * @returns {object} — { party: updated array, events: [...], completions: [...] }
 */
export function tickPCCrafters(party, weeks = 1, opts = {}) {
  if (!Array.isArray(party)) return { party: party || [], events: [], completions: [] };
  const w = Math.max(0, Math.floor(Number(weeks) || 0));
  if (w <= 0) return { party, events: [], completions: [] };
  const now = opts.nowIso || new Date().toISOString();
  const take10 = opts.take10 !== false;
  const rng = opts.rng || Math.random;
  const events = [];
  const completions = [];

  const nextParty = party.map((char) => {
    if (!char || !Array.isArray(char.craftProjects) || char.craftProjects.length === 0) {
      return char;
    }
    let projects = [...char.craftProjects];
    for (let i = 0; i < projects.length; i++) {
      let p = projects[i];
      if (!p || p.status !== 'in-progress') continue;
      for (let weekIdx = 0; weekIdx < w; weekIdx++) {
        if (p.status !== 'in-progress') break;
        const base = getPCCraftTotal(char, p.subSkill);
        const checkTotal = take10 ? base + 10 : base + 1 + Math.floor(rng() * 20);
        const advance = advanceCraftProjectWeekly(p, checkTotal, (p.history?.length || 0), {
          nowIso: now,
        });
        p = advance.project;
        for (const ev of advance.events) {
          events.push({ ...ev, characterId: char.id, subSkill: p.subSkill });
          if (ev.kind === 'complete') {
            completions.push({
              projectId: p.id,
              characterId: char.id,
              itemName: p.itemName,
              priceGP: p.priceGP,
              subSkill: p.subSkill,
              masterwork: !!(p.masterwork && p.masterwork.finished),
              completedAt: now,
            });
          }
        }
      }
      projects[i] = p;
    }
    return { ...char, craftProjects: projects };
  });

  return { party: nextParty, events, completions };
}

// --------------------------------------------------------------------
// Helpers for caller composition

/**
 * Extract NPCs that are currently crafting (have in-progress projects).
 */
export function getActiveCrafters(npcs) {
  if (!npcs) return [];
  const arr = Array.isArray(npcs) ? npcs : Object.values(npcs);
  return arr.filter((n) => n && getOngoingProjects(n.craftProjects).length > 0);
}

/**
 * Compute hours → weeks conversion with a minimum boundary.
 */
export function hoursToWeeks(hours) {
  const h = Number(hours) || 0;
  return Math.floor(h / (24 * 7));
}
