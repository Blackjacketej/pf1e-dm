// CraftItemModal.jsx
// Modal for a PC to start a new craft project.
//   1. Pick a sub-skill (list of 10 Craft (x) variants)
//   2. Pick an item from the craftable registry filtered by sub-skill
//   3. Preview DC, raw material cost, and accelerate toggle
//   4. Start — deducts materials cost, queues the project on the character

import React, { useMemo, useState } from 'react';
import craftableItemsData from '../data/craftableItems.json';
import {
  listCraftSubSkills,
  listRegistryItemsBySubSkill,
  getCraftSpecByName,
} from '../utils/craftCatalog.js';
import { startCraftProject } from '../utils/craftDowntime.js';
import {
  getFacilitiesForSubSkill,
  resolveFacilityBonus,
} from '../utils/craftFacilities.js';

/**
 * @param {object} props
 * @param {object}   props.character
 * @param {Function} props.onUpdateCharacter
 * @param {Function} props.onClose
 * @param {string[]} [props.locationFacilityIds] — facility IDs at the party's
 *   current location (e.g. ['forge', 'alchemy-lab']). Drives the auto-detect
 *   of masterwork-tool / alchemist-lab bonuses from UC rooms.
 */
export default function CraftItemModal({ character, onUpdateCharacter, onClose, locationFacilityIds }) {
  const subSkills = useMemo(() => listCraftSubSkills(), []);
  const [subSkill, setSubSkill] = useState(subSkills[0]);
  const [itemName, setItemName] = useState(null);
  const [accelerated, setAccelerated] = useState(false);
  const [toolMods, setToolMods] = useState({
    improvisedTools: false,
    masterworkTools: false,
    alchemistLab: false,
  });

  // Resolve facility bonus for the current sub-skill + location.
  const facilityMatch = useMemo(
    () => resolveFacilityBonus(subSkill, locationFacilityIds || []),
    [subSkill, locationFacilityIds],
  );
  const availableFacilities = useMemo(
    () => getFacilitiesForSubSkill(subSkill),
    [subSkill],
  );

  const items = useMemo(
    () => listRegistryItemsBySubSkill(craftableItemsData, subSkill),
    [subSkill],
  );
  const spec = itemName ? getCraftSpecByName(itemName, craftableItemsData) : null;

  const effDc = spec?.dc != null ? (accelerated ? spec.dc + 10 : spec.dc) : null;
  const charGold = Number(character?.gold) || 0;
  const canAfford = spec?.craftable && charGold >= (spec.materialsGP || 0);

  const handleStart = () => {
    if (!spec?.craftable) return;
    if (!canAfford) return;
    const start = startCraftProject(spec, {
      itemName,
      accelerated,
      toolMods,
      commissionedBy: null,
    });
    if (!start.ok) return;
    const nextChar = {
      ...character,
      gold: charGold - (spec.materialsGP || 0),
      craftProjects: [...(character.craftProjects || []), start.project],
    };
    onUpdateCharacter?.(nextChar);
    onClose?.();
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.title}>New Craft Project</div>
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
            {subSkills.map((s) => (
              <option key={s} value={s}>{s}</option>
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

        {spec?.craftable && (
          <div style={styles.specPanel}>
            <div style={styles.specRow}>
              <span>Price:</span>
              <b>{spec.priceGP} gp</b>
            </div>
            <div style={styles.specRow}>
              <span>Raw materials (due now):</span>
              <b style={{ color: canAfford ? '#ffd700' : '#ff9080' }}>
                {spec.materialsGP.toFixed(1)} gp
              </b>
            </div>
            <div style={styles.specRow}>
              <span>DC:</span>
              <b>{effDc}</b>
            </div>
            {spec.masterworkable && (
              <div style={{ ...styles.specRow, fontSize: 11, color: '#a69a80' }}>
                <span>Masterwork component (Phase 2):</span>
                <span>DC 20 · +{spec.masterworkComponentGP} gp</span>
              </div>
            )}
          </div>
        )}

        <div style={styles.row}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={accelerated}
              onChange={(e) => setAccelerated(e.target.checked)}
            />
            <span>Accelerated crafting (+10 DC — higher risk, faster on success)</span>
          </label>
        </div>

        <div style={styles.toolRow}>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={toolMods.masterworkTools}
              onChange={(e) =>
                setToolMods({ ...toolMods, masterworkTools: e.target.checked })
              }
            />
            <span>Masterwork tools (+2)</span>
          </label>
          <label style={styles.checkLabel}>
            <input
              type="checkbox"
              checked={toolMods.improvisedTools}
              onChange={(e) =>
                setToolMods({ ...toolMods, improvisedTools: e.target.checked })
              }
            />
            <span>Improvised tools (-2)</span>
          </label>
          {subSkill === 'Craft (alchemy)' && (
            <label style={styles.checkLabel}>
              <input
                type="checkbox"
                checked={toolMods.alchemistLab}
                onChange={(e) =>
                  setToolMods({ ...toolMods, alchemistLab: e.target.checked })
                }
              />
              <span>Alchemist's lab (+2)</span>
            </label>
          )}
        </div>

        {/* Facility / location info */}
        {availableFacilities.length > 0 && (
          <div style={styles.facilityRow}>
            {facilityMatch ? (
              <div style={styles.facilityActive}>
                <span style={{ color: '#80d080', fontWeight: 'bold', fontSize: 11 }}>
                  {facilityMatch.facility.name}
                </span>
                <span style={{ fontSize: 11, color: '#a0c090' }}>
                  {' '}— {facilityMatch.facility.toolBonusNote} (+{facilityMatch.toolBonus})
                </span>
                {!toolMods.masterworkTools && facilityMatch.facility.id !== 'alchemy-lab' && (
                  <button
                    style={styles.applyFacilityBtn}
                    onClick={() => setToolMods({ ...toolMods, masterworkTools: true })}
                  >
                    Apply
                  </button>
                )}
                {!toolMods.alchemistLab && facilityMatch.facility.id === 'alchemy-lab' && (
                  <button
                    style={styles.applyFacilityBtn}
                    onClick={() => setToolMods({ ...toolMods, alchemistLab: true })}
                  >
                    Apply
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#a09070' }}>
                Facility needed: {availableFacilities.map(f => f.name).join(' or ')}
                <span style={{ color: '#807060' }}> (not available at current location)</span>
              </div>
            )}
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...styles.startBtn,
              opacity: canAfford ? 1 : 0.5,
              cursor: canAfford ? 'pointer' : 'not-allowed',
            }}
            disabled={!canAfford}
            onClick={handleStart}
          >
            Start Project ({spec?.materialsGP?.toFixed(1) || 0} gp)
          </button>
        </div>

        {!canAfford && spec?.craftable && (
          <div style={styles.warn}>
            Not enough gold ({charGold} gp available).
          </div>
        )}
      </div>
    </div>
  );
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
    minWidth: 480,
    maxWidth: 560,
    color: '#d4c5a9',
    boxShadow: '0 0 40px rgba(255, 215, 0, 0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255, 215, 0, 0.3)',
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: {
    color: '#ffd700',
    fontWeight: 'bold',
    fontSize: 16,
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
  specPanel: {
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 215, 0, 0.2)',
    borderRadius: 6,
    padding: 10,
    margin: '10px 0',
  },
  specRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '3px 0',
    fontSize: 13,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    cursor: 'pointer',
  },
  toolRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    padding: '6px 0',
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
  startBtn: {
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
  facilityRow: {
    padding: '6px 0',
    borderTop: '1px solid rgba(255, 215, 0, 0.1)',
    marginTop: 4,
  },
  facilityActive: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  applyFacilityBtn: {
    background: 'rgba(100, 200, 100, 0.15)',
    border: '1px solid rgba(100, 200, 100, 0.4)',
    color: '#80d080',
    padding: '2px 8px',
    borderRadius: 3,
    fontSize: 10,
    cursor: 'pointer',
    marginLeft: 6,
  },
};
