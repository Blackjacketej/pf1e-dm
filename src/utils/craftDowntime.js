// craftDowntime.js
// Pure helpers for PC craft-project downtime loop.
// Starts, advances, and resolves `character.craftProjects[]` entries.
//
// A craft project's canonical shape:
// {
//   id: string (uuid),
//   itemName: string,
//   subSkill: string,          // "Craft (weapons)"
//   dc: number,
//   priceGP: number,
//   priceSP: number,           // priceGP × 10 (target)
//   materialsGP: number,       // 1/3 priceGP
//   progressSP: number,
//   masterworkable: boolean,
//   masterwork?: {             // Phase 2 subtrack — stubbed; not advanced in Phase 1
//     dc: 20,
//     componentGP: number,
//     progressSP: number,
//     finished: boolean,
//   },
//   status: 'in-progress' | 'paused' | 'completed' | 'abandoned',
//   failures: number,          // count of fail-by-5+ events (materials lost)
//   materialsLossGP: number,   // cumulative extra materials lost
//   accelerated: boolean,      // voluntary +10 DC
//   toolMods: { improvisedTools?: boolean, masterworkTools?: boolean, alchemistLab?: boolean },
//   commissionedBy?: string,   // partyId / characterId when the party commissioned it
//   startedAt: string,         // ISO
//   lastTickAt?: string,
//   history: [{ weekIndex, checkTotal, effectiveDc, progressSP, materialsLost, success }],
// }

import {
  resolveCraftProgressWeekly,
  resolveCraftRepair,
  getCraftRawMaterialCost,
  applyCraftAccelerate,
} from './rulesEngine.js';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `craft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start a new craft project from a resolved CraftSpec.
 * Does NOT deduct gold — callers handle wallet side-effects.
 *
 * @param {object} spec — from getCraftSpec()
 * @param {object} opts — { itemName, accelerated, toolMods, commissionedBy, nowIso }
 */
export function startCraftProject(spec, opts = {}) {
  if (!spec || !spec.craftable) {
    return { ok: false, reason: 'spec not craftable' };
  }
  const priceGP = Number(spec.priceGP);
  if (!Number.isFinite(priceGP) || priceGP <= 0) {
    return { ok: false, reason: 'invalid priceGP' };
  }
  const materialsGP = spec.materialsGP ?? getCraftRawMaterialCost(priceGP);
  const now = opts.nowIso || new Date().toISOString();
  const project = {
    id: uuid(),
    itemName: opts.itemName || 'unknown item',
    subSkill: spec.subSkill,
    dc: spec.dc,
    priceGP,
    priceSP: priceGP * 10,
    materialsGP,
    progressSP: 0,
    masterworkable: !!spec.masterworkable,
    status: 'in-progress',
    failures: 0,
    materialsLossGP: 0,
    accelerated: !!opts.accelerated,
    toolMods: opts.toolMods || {},
    commissionedBy: opts.commissionedBy || null,
    startedAt: now,
    lastTickAt: null,
    history: [],
  };
  if (spec.masterworkable) {
    const mwComponentGP = spec.masterworkComponentGP || 0;
    project.masterwork = {
      dc: 20,
      componentGP: mwComponentGP,
      // CRB p.94: raw material cost of the MW component is 1/3 of its price,
      // just like base raw materials. Used for fail-by-5 loss accounting on
      // the MW track.
      materialsGP: getCraftRawMaterialCost(mwComponentGP),
      progressSP: 0,
      finished: false,
    };
  }
  return { ok: true, project };
}

/**
 * Advance one project by one week. Mutates a COPY and returns it.
 *
 * @param {object} project — existing project object
 * @param {number} checkTotal — crafter's Craft (subSkill) total this week
 * @param {number} weekIndex — opaque index for history
 * @param {object} opts — { nowIso, dcOverride }
 * @returns {object} — { project, result, events }
 *    events: [{ kind: 'progress' | 'complete' | 'material-loss', ... }]
 */
export function advanceCraftProjectWeekly(project, checkTotal, weekIndex, opts = {}) {
  if (!project || project.status !== 'in-progress') {
    return { project, result: null, events: [] };
  }
  const now = opts.nowIso || new Date().toISOString();
  const dc = Number.isFinite(opts.dcOverride) ? opts.dcOverride : project.dc;

  const events = [];
  const baseDone = project.progressSP >= project.priceSP;
  const hasMw = !!(project.masterworkable && project.masterwork && !project.masterwork.finished);

  // Phase 2: once the base track is complete, weekly checks advance the
  // masterwork subtrack (DC 20, target = componentGP * 10 SP). We run this
  // SEQUENTIALLY — one check per week, base first, then MW. CRB p.94 is
  // ambiguous ("both the standard component and the masterwork component...
  // completed"); PFSRD convention is often concurrent. Sequential is chosen
  // here to keep one Craft check per week, matching weekly cadence elsewhere.
  // The PC's accelerated flag still applies (+10 DC); MW effective DC can
  // thus be 30.
  let result = null;
  let mwResult = null;
  let mwProgressDelta = 0;
  let mwMaterialsLost = false;
  if (baseDone && hasMw) {
    const mwDc = project.masterwork.dc || 20;
    const mwTargetGP = project.masterwork.componentGP || 0;
    if (mwTargetGP > 0) {
      mwResult = resolveCraftProgressWeekly(checkTotal, mwDc, mwTargetGP, {
        accelerated: project.accelerated,
        toolMods: project.toolMods,
      });
      mwProgressDelta = mwResult.progressSP || 0;
      mwMaterialsLost = !!mwResult.materialsLost;
    }
  } else {
    // Only run the base-track check when the base track is still active.
    // (Previously this always ran, allowing spurious base material losses on
    //  MW-only weeks.)
    result = resolveCraftProgressWeekly(checkTotal, dc, project.priceGP, {
      accelerated: project.accelerated,
      toolMods: project.toolMods,
    });
  }

  // Compute materials loss against the track that was actually worked.
  // CRB p.94: MW component raw materials = componentGP / 3 (separate from
  // base materialsGP).
  const mwMaterialsGP =
    (project.masterwork && Number.isFinite(project.masterwork.materialsGP))
      ? project.masterwork.materialsGP
      : (project.masterwork ? getCraftRawMaterialCost(project.masterwork.componentGP || 0) : 0);
  const baseLossThisWeek =
    !mwResult && result && result.materialsLost ? project.materialsGP / 2 : 0;
  const mwLossThisWeek =
    mwResult && mwMaterialsLost ? mwMaterialsGP / 2 : 0;

  const nextProject = {
    ...project,
    progressSP: baseDone
      ? project.progressSP
      : project.progressSP + (result?.progressSP || 0),
    failures: project.failures + ((baseLossThisWeek || mwLossThisWeek) ? 1 : 0),
    materialsLossGP: project.materialsLossGP + baseLossThisWeek + mwLossThisWeek,
    lastTickAt: now,
    history: [
      ...project.history,
      {
        weekIndex,
        checkTotal,
        effectiveDc: mwResult ? mwResult.effectiveDc : result?.effectiveDc,
        progressSP: mwResult ? mwProgressDelta : (result?.progressSP || 0),
        materialsLost: !!(mwResult ? mwMaterialsLost : result?.materialsLost),
        success: !!(mwResult ? mwResult.success : result?.success),
        track: mwResult ? 'masterwork' : 'base',
      },
    ],
  };

  // Emit events for whichever track was worked this week.
  if (mwResult) {
    if (mwMaterialsLost) {
      events.push({
        kind: 'material-loss',
        projectId: project.id,
        track: 'masterwork',
        lossGP: mwLossThisWeek,
      });
    }
    if (mwProgressDelta > 0) {
      events.push({
        kind: 'progress',
        projectId: project.id,
        track: 'masterwork',
        progressSP: mwProgressDelta,
      });
    }
    // Advance masterwork subtrack
    const mwNewProgress = project.masterwork.progressSP + mwProgressDelta;
    const mwTargetSP = (project.masterwork.componentGP || 0) * 10;
    const mwFinished = mwNewProgress >= mwTargetSP;
    nextProject.masterwork = {
      ...project.masterwork,
      progressSP: mwFinished ? mwTargetSP : mwNewProgress,
      finished: mwFinished,
    };
    if (mwFinished) {
      nextProject.status = 'completed';
      events.push({ kind: 'complete', projectId: project.id });
    }
  } else {
    if (result.materialsLost) {
      events.push({
        kind: 'material-loss',
        projectId: project.id,
        track: 'base',
        lossGP: project.materialsGP / 2,
      });
    }
    if (result.progressSP > 0) {
      events.push({
        kind: 'progress',
        projectId: project.id,
        track: 'base',
        progressSP: result.progressSP,
      });
    }
    if (nextProject.progressSP >= nextProject.priceSP) {
      if (hasMw) {
        // Base just finished — MW subtrack kicks in next week. Stay in-progress.
        nextProject.status = 'in-progress';
      } else {
        nextProject.status = 'completed';
        events.push({ kind: 'complete', projectId: project.id });
      }
    }
  }

  return { project: nextProject, result: mwResult || result, events };
}

/**
 * Helper: return the ongoing (in-progress) projects from a list.
 */
export function getOngoingProjects(projects) {
  if (!Array.isArray(projects)) return [];
  return projects.filter((p) => p && p.status === 'in-progress');
}

/**
 * Pause or resume a project.
 */
export function setProjectStatus(project, status) {
  if (!project) return project;
  const valid = new Set(['in-progress', 'paused', 'completed', 'abandoned']);
  if (!valid.has(status)) return project;
  return { ...project, status };
}

/**
 * Format effective DC given project opts (display helper).
 */
export function projectEffectiveDc(project) {
  if (!project) return null;
  return applyCraftAccelerate(project.dc, !!project.accelerated);
}

/**
 * Resolve a one-week craft repair attempt.
 * CRB: repair uses the same DC as the item, weekly progress, with the
 * materials target being 1/5 of item price (not 1/3 as with fresh crafting).
 *
 * Unlike crafting, repair is typically resolved in one or two weeks, so this
 * returns a simple result rather than mutating a project object.
 *
 * @param {number} checkTotal — crafter's Craft (subSkill) total
 * @param {object} item — { dc, priceGP } (or full project — both have these)
 * @param {object} opts — { accelerated, toolMods }
 * @returns {object} — { success, progressSP, effectiveDc, materialsLost, repairTargetGP }
 */
export function attemptCraftRepair(checkTotal, item, opts = {}) {
  if (!item || !Number.isFinite(item.dc) || !Number.isFinite(item.priceGP)) {
    return {
      success: false,
      finished: false,
      progressSP: 0,
      effectiveDc: null,
      materialsLost: false,
      repairPriceGP: 0,
      repairTargetGP: 0,
    };
  }
  const res = resolveCraftRepair(checkTotal, item.dc, item.priceGP, {
    accelerated: !!opts.accelerated,
    toolMods: opts.toolMods || {},
  });
  const repairPriceGP = res.repairPriceGP;
  return {
    success: !!res.success,
    finished: !!res.finished,
    progressSP: res.progressSP || 0,
    effectiveDc: res.effectiveDc,
    materialsLost: !!res.materialsLost,
    repairPriceGP,
    // Back-compat alias — same value, kept from Phase 2 initial shipment.
    repairTargetGP: repairPriceGP,
  };
}

/**
 * Quick progress summary for UI.
 */
export function projectProgressSummary(project) {
  if (!project) return null;
  const target = project.priceSP;
  const basePct = target > 0 ? Math.min(100, Math.round((project.progressSP / target) * 100)) : 0;

  // Masterwork subtrack progress (Phase 2).
  const hasMw = !!(project.masterworkable && project.masterwork);
  const mwTargetSP = hasMw ? (project.masterwork.componentGP || 0) * 10 : 0;
  const mwProgressSP = hasMw ? (project.masterwork.progressSP || 0) : 0;
  const mwPct = mwTargetSP > 0 ? Math.min(100, Math.round((mwProgressSP / mwTargetSP) * 100)) : 0;
  const mwFinished = hasMw ? !!project.masterwork.finished : false;

  // Overall pct: if MW subtrack exists, combine base (weight by price) + MW (weight by component).
  // For display: "base 100% + MW 45% = ~73% overall" kind of thing.
  let overallPct = basePct;
  if (hasMw && mwTargetSP > 0) {
    const totalTargetSP = target + mwTargetSP;
    const totalProgressSP = Math.min(project.progressSP, target) + mwProgressSP;
    overallPct = totalTargetSP > 0 ? Math.min(100, Math.round((totalProgressSP / totalTargetSP) * 100)) : 0;
  }

  return {
    progressSP: project.progressSP,
    targetSP: target,
    progressGP: project.progressSP / 10,
    targetGP: project.priceGP,
    pct: overallPct,
    basePct,
    status: project.status,
    failures: project.failures,
    materialsLossGP: project.materialsLossGP,
    // Masterwork subtrack
    hasMasterwork: hasMw,
    mwProgressSP,
    mwTargetSP,
    mwProgressGP: mwProgressSP / 10,
    mwTargetGP: mwTargetSP / 10,
    mwPct,
    mwFinished,
  };
}
