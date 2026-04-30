// commissioning.js
// Pure helpers for the commission flow:
//   party → NPC crafter: "Make me this item for X gp"
//
// Side-effects (gold deduction, inventory insertion, NPC state updates) are
// returned as intents/patches for the caller to apply; this module mutates
// nothing directly.

import { startCraftProject } from './craftDowntime.js';
import { getCraftSpec, getCraftSpecByName } from './craftCatalog.js';
import { getNpcCraftTotal } from '../services/craftSimulation.js';

/**
 * Standard commission fee on top of raw materials.
 * CRB doesn't prescribe a fee; we use 1/3 of priceGP as a reasonable default
 * (matching raw material cost). Callers may override via opts.feeGP.
 */
export function defaultCommissionFeeGP(priceGP) {
  return Math.max(1, Math.round((Number(priceGP) || 0) / 3));
}

/**
 * Build a commission "offer" — a previewable summary the UI can confirm.
 *
 * @param {object} args
 *   npc: the NPC crafter (must have skillRanks for the sub-skill)
 *   item: { name, priceGP, craftable } OR pass registry + itemName
 *   registry: optional craftableItems registry; if given, itemName is looked up
 *   itemName: used with registry lookup
 *   opts: { accelerated?, feeGP? (override), deliverTo? }
 */
export function buildCommissionOffer({ npc, item, registry, itemName, opts = {} }) {
  const spec = item
    ? getCraftSpec(item)
    : getCraftSpecByName(itemName, registry);
  if (!spec || !spec.craftable) {
    return { ok: false, reason: spec?.reason || 'item not craftable' };
  }
  if (!npc || !npc.id) {
    return { ok: false, reason: 'no npc' };
  }
  const feeGP = Number.isFinite(opts.feeGP) ? opts.feeGP : defaultCommissionFeeGP(spec.priceGP);
  const materialsGP = spec.materialsGP;
  const totalDueGP = materialsGP + feeGP;

  // Estimate weeks using take-10 on NPC's Craft (subSkill) + 10 vs DC.
  // Progress per week = effectiveCheck × effectiveDc silver pieces.
  const npcSkill = getNpcCraftTotal(npc, spec.subSkill);
  const effCheck = npcSkill + 10;
  const effDc = opts.accelerated ? spec.dc + 10 : spec.dc;
  const weeklySP = Math.max(0, effCheck * effDc);
  const targetSP = spec.priceGP * 10;
  const estWeeks = weeklySP > 0 ? Math.ceil(targetSP / weeklySP) : Infinity;

  return {
    ok: true,
    offer: {
      npcId: npc.id,
      npcName: npc.name || 'Unknown',
      itemName: item?.name || itemName,
      subSkill: spec.subSkill,
      dc: spec.dc,
      effectiveDc: effDc,
      priceGP: spec.priceGP,
      materialsGP,
      feeGP,
      totalDueGP,
      npcSkillTotal: npcSkill,
      estimatedWeeks: estWeeks,
      masterworkable: spec.masterworkable,
      accelerated: !!opts.accelerated,
      deliverTo: opts.deliverTo || 'party-inventory',
    },
    spec,
  };
}

/**
 * Accept a commission offer. Produces patches the caller must apply:
 *   patches.goldDelta       — negative; deduct from paying character
 *   patches.npcUpdate       — new NPC object with the project queued
 *   patches.commissionRecord — persistable record for worldState.commissions
 *
 * @param {object} args
 *   offer: from buildCommissionOffer
 *   spec: the matching CraftSpec
 *   npc: crafter
 *   payerCharacterId: who pays (and who receives delivery by default)
 *   nowIso: optional timestamp
 *   toolMods: optional { masterworkTools, alchemistLab, improvisedTools }
 *            — typically derived from the NPC's location via
 *            craftFacilities.applyFacilityToToolMods(). If omitted, no
 *            tool modifiers are applied.
 */
export function acceptCommission({ offer, spec, npc, payerCharacterId, nowIso, toolMods }) {
  if (!offer || !offer.itemName) {
    return { ok: false, reason: 'no offer' };
  }
  if (!npc || !npc.id) {
    return { ok: false, reason: 'no npc' };
  }
  const start = startCraftProject(spec, {
    itemName: offer.itemName,
    accelerated: offer.accelerated,
    commissionedBy: payerCharacterId,
    toolMods: toolMods || {},
    nowIso,
  });
  if (!start.ok) return { ok: false, reason: start.reason };

  const nextNpc = {
    ...npc,
    profession: npc.profession || 'crafter',
    craftProjects: [...(npc.craftProjects || []), start.project],
  };

  const record = {
    id: start.project.id,
    npcId: npc.id,
    itemName: offer.itemName,
    priceGP: offer.priceGP,
    materialsGP: offer.materialsGP,
    feeGP: offer.feeGP,
    totalDueGP: offer.totalDueGP,
    subSkill: offer.subSkill,
    dc: offer.dc,
    payerCharacterId,
    deliverTo: offer.deliverTo,
    estimatedWeeks: offer.estimatedWeeks,
    createdAt: nowIso || new Date().toISOString(),
    status: 'in-progress',
  };

  return {
    ok: true,
    patches: {
      goldDelta: -offer.totalDueGP,
      npcUpdate: nextNpc,
      commissionRecord: record,
    },
  };
}

/**
 * Apply a completion (from craftSimulation). Returns delivery intents.
 *   { deliverToCharacterId, itemName, priceGP, masterwork } for inventory insert.
 */
export function resolveCommissionCompletion(completion, commissionRecords) {
  if (!completion || !completion.commissionedBy) {
    return { ok: false, reason: 'not commissioned' };
  }
  const rec = (commissionRecords || []).find(
    (r) => r.id === completion.projectId,
  );
  if (!rec) return { ok: false, reason: 'no matching commission record' };
  return {
    ok: true,
    delivery: {
      deliverToCharacterId: rec.payerCharacterId,
      itemName: completion.itemName,
      priceGP: completion.priceGP,
      masterwork: !!completion.masterwork,
      subSkill: completion.subSkill,
    },
    updatedRecord: { ...rec, status: 'delivered', deliveredAt: completion.completedAt },
  };
}
