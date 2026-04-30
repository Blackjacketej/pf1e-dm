// CommissionItemModal.jsx
// Party → NPC crafter commission flow.
//   1. Pre-selected NPC (the crafter the party is talking to)
//   2. Pick a sub-skill the NPC actually has ranks in
//   3. Pick an item from the craftable registry filtered by sub-skill
//   4. Preview DC, materials + fee, estimated weeks (take-10 on NPC skill)
//   5. Accept — deducts totalDueGP from payer, queues project on NPC,
//      returns a commissionRecord the caller persists to worldState.commissions.

import React, { useMemo, useState } from 'react';
import craftableItemsData from '../data/craftableItems.json';
import {
  listCraftSubSkills,
  listRegistryItemsBySubSkill,
  getCraftSpecByName,
} from '../utils/craftCatalog.js';
import {
  buildCommissionOffer,
  acceptCommission,
  defaultCommissionFeeGP,
} from '../utils/commissioning.js';
import { getNpcCraftTotal } from '../services/craftSimulation.js';
import {
  applyFacilityToToolMods,
  resolveFacilityBonus,
  getFacilitiesForSubSkill,
} from '../utils/craftFacilities.js';

export default function CommissionItemModal({
  npc,
  payerCharacter,
  onUpdateNpc,
  onUpdatePayer,
  onRecordCommission,
  onClose,
  locationFacilityIds = [],
}) {
  const allSubSkills = useMemo(() => listCraftSubSkills(), []);

  // Sub-skills the NPC actually has non-zero ranks in (fall back to all).
  const npcSubSkills = useMemo(() => {
    const ranks = npc?.skillRanks || {};
    const keys = Object.keys(ranks)
      .filter((k) => /^craft\s*\(/i.test(k) && Number(ranks[k]) > 0)
      .map((k) => canonicalCraftKey(k));
    const filtered = allSubSkills.filter((s) => keys.includes(s.toLowerCase()));
    return filtered.length > 0 ? filtered : allSubSkills;
  }, [npc, allSubSkills]);

  const [subSkill, setSubSkill] = useState(npcSubSkills[0]);
  const [itemName, setItemName] = useState(null);
  const [accelerated, setAccelerated] = useState(false);
  const [feeOverride, setFeeOverride] = useState('');

  const items = useMemo(
    () => listRegistryItemsBySubSkill(craftableItemsData, subSkill),
    [subSkill],
  );

  const preview = useMemo(() => {
    if (!itemName || !npc) return null;
    const feeGP =
      feeOverride !== '' && Number.isFinite(Number(feeOverride))
        ? Number(feeOverride)
        : undefined;
    return buildCommissionOffer({
      npc,
      registry: craftableItemsData,
      itemName,
      opts: { accelerated, feeGP },
    });
  }, [itemName, npc, accelerated, feeOverride]);

  const offer = preview?.ok ? preview.offer : null;
  const spec = preview?.spec;
  const payerGold = Number(payerCharacter?.gold) || 0;
  const canAfford = offer && payerGold >= offer.totalDueGP;

  // Facility bonus: if the NPC's location has a matching facility for the
  // selected sub-skill, auto-derive masterwork-tools / alchemist-lab toolMods.
  const facilityMatch = useMemo(
    () => resolveFacilityBonus(subSkill, locationFacilityIds || []),
    [subSkill, locationFacilityIds],
  );
  const availableFacilities = useMemo(
    () => getFacilitiesForSubSkill(subSkill),
    [subSkill],
  );
  const derivedToolMods = useMemo(
    () => applyFacilityToToolMods(subSkill, locationFacilityIds || [], {}),
    [subSkill, locationFacilityIds],
  );

  const handleAccept = () => {
    if (!offer || !spec) return;
    if (!canAfford) return;
    const res = acceptCommission({
      offer,
      spec,
      npc,
      payerCharacterId: payerCharacter?.id,
      nowIso: new Date().toISOString(),
      toolMods: derivedToolMods,
    });
    if (!res.ok) return;
    onUpdateNpc?.(res.patches.npcUpdate);
    onUpdatePayer?.({
      ...payerCharacter,
      gold: payerGold + res.patches.goldDelta,
    });
    onRecordCommission?.(res.patches.commissionRecord);
    onClose?.();
  };

  const defaultFee = spec ? defaultCommissionFeeGP(spec.priceGP) : 0;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Commission from {npc?.name || 'NPC'}</div>
            <div style={styles.subtitle}>
              {npc?.profession || 'crafter'}
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Sub-skill</label>
          <select
            style={styles.select}
            value={subSkill}
            onChange={(e) => {
              setSubSkill(e.target.value);
              setItemName(null);
            }}
          >
            {npcSubSkills.map((s) => (
              <option key={s} value={s}>
                {s}
                {' '}
                (skill +{getNpcCraftTotal(npc, s)})
              </option>
            ))}
          </select>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Item</label>
          <select
            style={styles.select}
            value={itemName || ''}
            onChange={(e) => setItemName(e.target.value || null)}
          >
            <option value="">— select an item —</option>
            {items.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div style={styles.row}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={accelerated}
              onChange={(e) => setAccelerated(e.target.checked)}
            />
            <span>Rush order (+10 DC — higher risk, faster on success)</span>
          </label>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Fee (gp)</label>
          <input
            type="number"
            min={0}
            style={styles.input}
            value={feeOverride}
            placeholder={`default ${defaultFee}`}
            onChange={(e) => setFeeOverride(e.target.value)}
          />
        </div>

        {offer && (
          <div style={styles.offerPanel}>
            <div style={styles.offerRow}>
              <span>List price:</span>
              <b>{offer.priceGP} gp</b>
            </div>
            <div style={styles.offerRow}>
              <span>Raw materials:</span>
              <b>{offer.materialsGP.toFixed(1)} gp</b>
            </div>
            <div style={styles.offerRow}>
              <span>Crafter's fee:</span>
              <b>{offer.feeGP.toFixed(1)} gp</b>
            </div>
            <div style={{ ...styles.offerRow, borderTop: '1px solid rgba(255,215,0,0.2)', paddingTop: 4 }}>
              <span>Total due now:</span>
              <b style={{ color: canAfford ? '#ffd700' : '#ff9080' }}>
                {offer.totalDueGP.toFixed(1)} gp
              </b>
            </div>
            <div style={styles.offerRow}>
              <span>DC:</span>
              <b>
                {offer.effectiveDc}
                {offer.accelerated ? ' (accel)' : ''}
              </b>
            </div>
            <div style={styles.offerRow}>
              <span>Estimated completion:</span>
              <b>
                {Number.isFinite(offer.estimatedWeeks)
                  ? `~${offer.estimatedWeeks} week${offer.estimatedWeeks === 1 ? '' : 's'}`
                  : 'unable to complete (skill too low)'}
              </b>
            </div>
            <div style={{ ...styles.offerRow, fontSize: 11, color: '#a69a80' }}>
              <span>NPC skill total:</span>
              <span>+{offer.npcSkillTotal} (take-10 = {offer.npcSkillTotal + 10})</span>
            </div>
          </div>
        )}

        {/* Facility hint — NPC's workshop bonus applied automatically */}
        {availableFacilities.length > 0 && (
          <div style={{ fontSize: 11, marginTop: 6, color: facilityMatch ? '#80d080' : '#a09070' }}>
            {facilityMatch ? (
              <>
                <b>{facilityMatch.facility.name}</b>
                {' '}at {npc?.location || "the crafter's workshop"} — +{facilityMatch.toolBonus} to check (auto-applied)
              </>
            ) : (
              <>
                Facility needed: {availableFacilities.map(f => f.name).join(' or ')}
                <span style={{ color: '#807060' }}> (NPC's location lacks it — no bonus)</span>
              </>
            )}
          </div>
        )}

        {preview && !preview.ok && (
          <div style={styles.warn}>Cannot commission: {preview.reason}</div>
        )}

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...styles.acceptBtn,
              opacity: canAfford && Number.isFinite(offer?.estimatedWeeks) ? 1 : 0.5,
              cursor: canAfford && Number.isFinite(offer?.estimatedWeeks) ? 'pointer' : 'not-allowed',
            }}
            disabled={!canAfford || !Number.isFinite(offer?.estimatedWeeks)}
            onClick={handleAccept}
          >
            Pay {offer ? offer.totalDueGP.toFixed(1) : 0} gp &amp; Commission
          </button>
        </div>

        {offer && !canAfford && (
          <div style={styles.warn}>
            Not enough gold ({payerGold} gp available).
          </div>
        )}
      </div>
    </div>
  );
}

function canonicalCraftKey(s) {
  // "Craft (Weapons)" → "craft (weapons)"
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5000,
  },
  modal: {
    background: 'linear-gradient(145deg, #1a1208, #2a1d10)',
    border: '2px solid #ffd700',
    borderRadius: 12,
    padding: 24,
    minWidth: 500,
    maxWidth: 580,
    color: '#d4c5a9',
    boxShadow: '0 0 40px rgba(255, 215, 0, 0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid rgba(255, 215, 0, 0.3)',
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: {
    color: '#ffd700',
    fontWeight: 'bold',
    fontSize: 16,
  },
  subtitle: {
    color: '#a69a80',
    fontSize: 11,
    fontStyle: 'italic',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#ffd700',
    fontSize: 24,
    cursor: 'pointer',
    lineHeight: 1,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  label: {
    color: '#ffd700',
    fontSize: 12,
    minWidth: 100,
  },
  select: {
    flex: 1,
    background: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 215, 0, 0.3)',
    color: '#d4c5a9',
    padding: '6px 10px',
    borderRadius: 4,
  },
  input: {
    flex: 1,
    background: 'rgba(0, 0, 0, 0.4)',
    border: '1px solid rgba(255, 215, 0, 0.3)',
    color: '#d4c5a9',
    padding: '6px 10px',
    borderRadius: 4,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    cursor: 'pointer',
  },
  offerPanel: {
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 215, 0, 0.2)',
    borderRadius: 6,
    padding: 10,
    margin: '10px 0',
  },
  offerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '3px 0',
    fontSize: 13,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
    borderTop: '1px solid rgba(255, 215, 0, 0.2)',
    paddingTop: 12,
  },
  cancelBtn: {
    background: 'rgba(100, 100, 100, 0.2)',
    border: '1px solid rgba(200, 200, 200, 0.3)',
    color: '#d4c5a9',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
  },
  acceptBtn: {
    background: 'rgba(255, 215, 0, 0.2)',
    border: '1px solid #ffd700',
    color: '#ffd700',
    padding: '6px 14px',
    borderRadius: 4,
    fontWeight: 'bold',
  },
  warn: {
    color: '#ff9080',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
};
