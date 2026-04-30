import React, { useState, useMemo } from 'react';
import { mod, modStr, calcBAB, calcSave } from '../utils/dice';
import { calcFullAC, calcSkillMod, getCarryingCapacity, getEncumbranceLevel, calcTotalWeight, getSpellSlotsForLevel, EQUIPMENT_SLOTS, getEncumbranceEffects } from '../utils/character';
import { getAllProficiencyIssues, computeSave, getCharacterModifiers, computeSLADC } from '../utils/rulesEngine';
import { validateCasting, getArcaneSpellFailure } from '../utils/spellEngine';
import { PF1E_CONDITIONS, aggregateConditionModifiers } from '../utils/conditionTracker';
import { getEffectiveMaxHP, aggregateFamiliarModifiers } from '../utils/familiarEngine';
import useIsMobile from '../hooks/useIsMobile';
import skillsData from '../data/skills.json';
import featsData from '../data/feats.json';
import conditionsData from '../data/conditions.json';
import gearData from '../data/gear.json';
import magicItemsData from '../data/magicItems.json';
import equipmentData from '../data/equipment.json';
import shopsData from '../data/shops.json';
import sandpointData from '../data/sandpoint.json';
import sandpointMapData from '../data/sandpointMap.json';
import { hydrateGearItem, parseWeightLbs } from '../utils/gearHydrate';
import { collectFacilityIdsFromLocations } from '../utils/craftFacilities';
import CraftProjectPanel from './CraftProjectPanel';
import CraftItemModal from './CraftItemModal';

const SPELLCASTING_CLASSES = ['Wizard', 'Cleric', 'Druid', 'Sorcerer', 'Bard', 'Paladin', 'Ranger', 'Witch', 'Oracle', 'Inquisitor', 'Alchemist', 'Magus', 'Summoner', 'Warpriest', 'Bloodrager', 'Adept'];
const PREPARED_CASTERS = ['Wizard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Witch', 'Magus', 'Alchemist', 'Warpriest', 'Adept'];

const CharacterSheet = ({
  char,
  onUpdate,
  onClose,
  classesMap,
  spellsData,
  spellSlotData,
  armorList,
  shieldsList,
  weaponsList,
  worldState,
}) => {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState('Stats');
  const [showFeatPicker, setShowFeatPicker] = useState(false);
  const [featSearch, setFeatSearch] = useState('');
  const [showConditionPicker, setShowConditionPicker] = useState(false);
  const [conditionSearch, setConditionSearch] = useState('');
  const [showSpellPicker, setShowSpellPicker] = useState(false);
  const [spellSearch, setSpellSearch] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [slotPickerOpen, setSlotPickerOpen] = useState(null); // null | slotId — paperdoll equip picker
  const [showCraftModal, setShowCraftModal] = useState(false);

  // Resolve craft facilities available at the party's current settlement.
  // Union of all canonical craftFacilities[] in shops.json, sandpoint.json,
  // and sandpointMap.json for the current settlement. Sandpoint-specific for
  // now; other APs can extend this list as their data files are added.
  const locationFacilityIds = useMemo(() => {
    const rawName = worldState?.currentSettlement?.name;
    const settlementName = String(rawName || '').trim().toLowerCase();
    if (!settlementName) return [];

    const shopsInSettlement = Object.values(shopsData?.shops || {}).filter(
      (s) => String(s.settlement || '').trim().toLowerCase() === settlementName,
    );

    const extra = [];
    if (settlementName === 'sandpoint') {
      extra.push(...(sandpointData?.locations || []));
      extra.push(...(sandpointMapData?.locations || []));
    }

    return collectFacilityIdsFromLocations([...shopsInSettlement, ...extra]);
  }, [worldState?.currentSettlement?.name]);

  const className = char.className || char.class;
  const classData = classesMap?.[className];
  const isSpellcaster = SPELLCASTING_CLASSES.includes(className);
  const isPreparedCaster = PREPARED_CASTERS.includes(className);

  // Calculate ability modifiers
  const abilityMods = useMemo(() => {
    const mods = {};
    ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].forEach(ability => {
      mods[ability] = mod(char.abilities?.[ability] || 10);
    });
    return mods;
  }, [char.abilities]);

  // Find armor and shield data
  const armorData = useMemo(() => {
    if (!char.armor || !armorList) return null;
    return armorList.find(a => a.name === char.armor);
  }, [char.armor, armorList]);

  const shieldData = useMemo(() => {
    if (!char.shield || !shieldsList) return null;
    return shieldsList.find(s => s.name === char.shield);
  }, [char.shield, shieldsList]);

  // Calculate AC
  const acData = useMemo(() => {
    return calcFullAC(char, armorData, shieldData);
  }, [char, armorData, shieldData]);

  // Get class skills
  const classSkills = useMemo(() => {
    if (!className || !skillsData) return [];
    return skillsData.filter(skill => skill.classSkills?.includes(className)).map(s => s.name);
  }, [className]);

  // Get armor check penalty
  const armorCheckPenalty = useMemo(() => {
    return (armorData?.penalty || 0) + (shieldData?.penalty || 0);
  }, [armorData, shieldData]);

  // Calculate skill points
  const skillPointsInfo = useMemo(() => {
    if (!classData) return { available: 0, used: 0 };
    const intMod = abilityMods.INT;
    const isHuman = char.race === 'Human';
    const pointsPerLevel = (classData.skills || 2) + intMod + (isHuman ? 1 : 0);
    const usedSkillPoints = Object.values(char.skillRanks || {}).reduce((sum, ranks) => sum + ranks, 0);
    const available = pointsPerLevel * (char.level || 1) - usedSkillPoints;
    return { available, used: usedSkillPoints };
  }, [classData, abilityMods.INT, char.race, char.skillRanks, char.level]);

  // Get spell slots
  const spellSlots = useMemo(() => {
    if (!isSpellcaster || !spellSlotData) return {};
    const castingAbility = spellSlotData.castingAbility?.[className];
    const abilityScore = char.abilities?.[castingAbility] || 10;
    return getSpellSlotsForLevel(className, char.level, abilityScore, spellSlotData);
  }, [isSpellcaster, className, char.level, char.abilities, spellSlotData]);

  // Calculate total weight and encumbrance
  const totalWeight = useMemo(() => calcTotalWeight(char), [char]);
  const encumbranceLevel = useMemo(() => getEncumbranceLevel(totalWeight, char.abilities?.STR || 10), [totalWeight, char.abilities?.STR]);
  const encumbranceEffects = useMemo(() => getEncumbranceEffects(encumbranceLevel, char.race), [encumbranceLevel, char.race]);
  const carryingCapacity = useMemo(() => getCarryingCapacity(char.abilities?.STR || 10), [char.abilities?.STR]);

  // Update character
  const updateChar = (updates) => {
    onUpdate({ ...char, ...updates });
  };

  const updateAbility = (ability, delta) => {
    const current = char.abilities?.[ability] || 10;
    const newValue = Math.max(1, current + delta);
    updateChar({ abilities: { ...(char.abilities || {}), [ability]: newValue } });
  };

  const updateSkillRank = (skillName, delta) => {
    const current = char.skillRanks?.[skillName] || 0;
    const newRank = Math.max(0, current + delta);
    const newSkillRanks = { ...(char.skillRanks || {}), [skillName]: newRank };
    if (newRank === 0) delete newSkillRanks[skillName];
    updateChar({ skillRanks: newSkillRanks });
  };

  const castSpell = (spellLevel) => {
    const used = char.spellSlotsUsed?.[spellLevel] || 0;
    const max = spellSlots[spellLevel] || 0;
    if (used >= max) {
      // Slots exhausted — block casting
      return;
    }

    // Check conditions that prevent casting (silenced, paralyzed, stunned, etc.)
    const condMods = getCharacterModifiers(char, worldState);
    if (condMods.cannotCast) {
      updateChar({ lastCastResult: 'Cannot cast — a condition prevents spellcasting!' });
      return;
    }
    if (condMods.cannotAct) {
      updateChar({ lastCastResult: 'Cannot act — incapacitated!' });
      return;
    }

    // Check ability score minimum: need casting ability >= 10 + spell level
    const CASTING_ABILITY_MAP = {
      Wizard: 'INT', Magus: 'INT', Witch: 'INT', Alchemist: 'INT',
      Cleric: 'WIS', Druid: 'WIS', Ranger: 'WIS', Paladin: 'CHA',
      Inquisitor: 'WIS', Warpriest: 'WIS',
      Sorcerer: 'CHA', Bard: 'CHA', Oracle: 'CHA', Summoner: 'CHA', Bloodrager: 'CHA',
    };
    const castAbility = CASTING_ABILITY_MAP[char.class];
    if (castAbility && spellLevel > 0) {
      const abilityScore = char.abilities?.[castAbility] || 10;
      const minRequired = 10 + parseInt(spellLevel);
      if (abilityScore < minRequired) {
        updateChar({ lastCastResult: `${castAbility} ${abilityScore} too low for level ${spellLevel} spells (need ${minRequired})` });
        return;
      }
    }

    // Check arcane spell failure for armored arcane casters
    const asf = getArcaneSpellFailure(char);
    if (asf.applies && asf.chance > 0) {
      const failRoll = Math.floor(Math.random() * 100) + 1;
      if (failRoll <= asf.chance) {
        // Spell fizzles but still consumes the slot
        updateChar({
          spellSlotsUsed: { ...(char.spellSlotsUsed || {}), [spellLevel]: used + 1 },
          lastCastResult: `Arcane spell failure! Rolled ${failRoll} vs ${asf.chance}% — spell fizzles.`,
        });
        return;
      }
    }

    updateChar({
      spellSlotsUsed: { ...(char.spellSlotsUsed || {}), [spellLevel]: used + 1 },
      lastCastResult: null,
    });
  };

  const restSpells = () => {
    updateChar({ spellSlotsUsed: {} });
  };

  const addFeat = (featName) => {
    const feats = char.feats || [];
    if (!feats.includes(featName)) {
      updateChar({ feats: [...feats, featName] });
    }
    setShowFeatPicker(false);
    setFeatSearch('');
  };

  const removeFeat = (featName) => {
    updateChar({ feats: (char.feats || []).filter(f => f !== featName) });
  };

  const addCondition = (conditionName) => {
    // Use structured activeConditions system with mechanical modifiers
    const active = char.activeConditions || [];
    if (active.some(c => c.id === conditionName.toLowerCase().replace(/\s+/g, '_') || c.name === conditionName)) return;

    const condId = conditionName.toLowerCase().replace(/\s+/g, '_');
    const template = PF1E_CONDITIONS[condId];
    const newCondition = template ? {
      id: condId,
      name: template.name,
      severity: template.severity,
      description: template.description,
      modifiers: { ...template.modifiers },
      duration: null,
      roundsRemaining: null,
      source: 'manual',
    } : {
      id: condId,
      name: conditionName,
      severity: 'minor',
      description: conditionName,
      modifiers: {},
      duration: null,
      roundsRemaining: null,
      source: 'manual',
    };

    // Update both old and new systems for backward compatibility
    const conditions = char.conditions || [];
    updateChar({
      activeConditions: [...active, newCondition],
      conditions: conditions.includes(conditionName) ? conditions : [...conditions, conditionName],
    });
    setShowConditionPicker(false);
    setConditionSearch('');
  };

  const removeCondition = (conditionName) => {
    const condId = conditionName.toLowerCase().replace(/\s+/g, '_');
    updateChar({
      activeConditions: (char.activeConditions || []).filter(c => c.id !== condId && c.name !== conditionName),
      conditions: (char.conditions || []).filter(c => c !== conditionName),
    });
  };

  const addSpell = (spellName) => {
    if (isPreparedCaster) {
      const known = char.spellsKnown || [];
      if (!known.includes(spellName)) {
        updateChar({ spellsKnown: [...known, spellName] });
      }
    } else {
      const known = char.spellsKnown || [];
      if (!known.includes(spellName)) {
        updateChar({ spellsKnown: [...known, spellName] });
      }
    }
    setShowSpellPicker(false);
    setSpellSearch('');
  };

  const removeSpell = (spellName) => {
    const isKnown = isPreparedCaster ? 'spellsKnown' : 'spellsKnown';
    updateChar({ [isKnown]: (char[isKnown] || []).filter(s => s !== spellName) });
  };

  const addItem = (item) => {
    const inv = char.inventory || [];
    const existing = inv.find(i => i.name === item.name);
    if (existing) {
      existing.quantity = (existing.quantity || 1) + 1;
      updateChar({ inventory: [...inv] });
    } else {
      updateChar({ inventory: [...inv, { ...item, quantity: 1 }] });
    }
    setShowItemPicker(false);
    setItemSearch('');
  };

  const removeItem = (index) => {
    const inv = char.inventory || [];
    updateChar({ inventory: inv.filter((_, i) => i !== index) });
  };

  const updateItemQuantity = (index, delta) => {
    const inv = char.inventory || [];
    const newQty = Math.max(0, (inv[index]?.quantity || 1) + delta);
    if (newQty === 0) {
      removeItem(index);
    } else {
      inv[index].quantity = newQty;
      updateChar({ inventory: [...inv] });
    }
  };

  // ===== PAPERDOLL EQUIPMENT (BG-style) =====
  // Determine if an inventory item can occupy a paperdoll slot.
  // Bug #51 — widened weapon detection: the project has two weapon data
  // sources with incompatible category fields:
  //   * src/data/equipment.json → category: "weapon"
  //   * src/data/weapons.json   → category: "melee" | "ranged"  (also "thrown"
  //     in some Ultimate Equipment entries; `type` can also be "ranged"/"thrown")
  // Prior code only accepted `cat === 'weapon'`, so weapons coming from
  // weapons.json (which is what pregens/templates + most seeded characters
  // use) couldn't be re-equipped after ✕. `isWeaponLike` unifies both shapes.
  const isWeaponLike = (item) => {
    if (!item) return false;
    const cat = String(item.category || '').toLowerCase();
    const typ = String(item.type || '').toLowerCase();
    return (
      cat === 'weapon' || cat === 'melee' || cat === 'ranged' || cat === 'thrown' ||
      typ === 'weapon' || typ === 'ranged' || typ === 'thrown'
    );
  };
  const fitsSlot = (item, slotId) => {
    if (!item) return false;
    const cat = String(item.category || '').toLowerCase();
    const sl  = String(item.slot || '').toLowerCase();
    if (slotId === 'mainHand') return isWeaponLike(item);
    if (slotId === 'offHand')  return isWeaponLike(item) || cat === 'shield' || sl === 'shield';
    if (slotId === 'body')     return cat === 'armor'  || sl === 'body' || sl === 'armor';
    if (slotId === 'ringLeft' || slotId === 'ringRight') return cat === 'ring' || sl === 'ring';
    // Magic-item named slots: head, eyes, neck, shoulders, belt, wrists, hands, feet, chest
    return sl === String(slotId).toLowerCase();
  };

  // Synthesised view of equipped[]: backfills slots from legacy fields
  // (char.weapons[0]/[1], char.armor, char.shield) so existing characters
  // see their weapons/armor on the paperdoll without a destructive migration.
  const effectiveEquipped = useMemo(() => {
    const eq = { ...(char.equipped || {}) };
    const weapons = char.weapons || [];
    if (!eq.mainHand && weapons[0]) eq.mainHand = { ...weapons[0], _fromLegacy: 'weapons[0]' };
    if (!eq.offHand  && weapons[1]) eq.offHand  = { ...weapons[1], _fromLegacy: 'weapons[1]' };
    if (!eq.body && char.armor && armorList) {
      const a = armorList.find(x => x.name === char.armor);
      if (a) eq.body = { ...a, category: 'armor', _fromLegacy: 'armor' };
    }
    if (!eq.offHand && char.shield && shieldsList) {
      const s = shieldsList.find(x => x.name === char.shield);
      if (s) eq.offHand = { ...s, category: 'shield', _fromLegacy: 'shield' };
    }
    return eq;
  }, [char.equipped, char.weapons, char.armor, char.shield, armorList, shieldsList]);

  // Mirror equipped[] writes into the legacy fields the rest of the app reads.
  const syncLegacyFields = (nextEquipped) => {
    const updates = { equipped: nextEquipped };
    const main = nextEquipped.mainHand;
    const off  = nextEquipped.offHand;
    const body = nextEquipped.body;

    // Weapons array — preserve a 2-slot shape mirroring main/off.
    // Bug #51: use isWeaponLike (accepts weapons.json's melee/ranged/thrown
    // AND equipment.json's "weapon") so re-equipping a weapons.json-shape
    // item doesn't silently blank char.weapons[] — CombatTab/rulesEngine
    // still read char.weapons[0] for attack flow.
    const nextWeapons = [];
    if (main && isWeaponLike(main)) nextWeapons.push(main);
    if (off  && isWeaponLike(off))  nextWeapons.push(off);
    updates.weapons = nextWeapons;

    // Armor (string name)
    if (body && (body.category || '').toLowerCase() === 'armor') updates.armor = body.name;
    else updates.armor = '';

    // Shield (string name) — only if off-hand is a shield
    if (off && ((off.category || '').toLowerCase() === 'shield')) updates.shield = off.name;
    else updates.shield = '';

    return updates;
  };

  // Bug #47 — rebuild the "canonical equipped map" by promoting every
  // currently-effective slot (including legacy-sourced ones backfilled
  // from char.weapons/char.armor/char.shield) into a single plain
  // object, stripping the synth marker. Writes into `equipped` then
  // pass through `syncLegacyFields` to keep the flat fields in sync
  // WITHOUT clobbering legacy slots that were never promoted.
  //
  // Prior behavior: unequipSlot / equipFromInventory seeded nextEquipped
  // from `char.equipped` only. On pre-paperdoll saves `char.equipped`
  // is empty while weapons/armor/shield still carry the gear — so
  // touching one slot caused syncLegacyFields to rebuild weapons/armor/
  // shield from a map with only that one slot, silently unequipping
  // every other piece.
  const promoteEffectiveToEquipped = () => {
    const out = {};
    Object.entries(effectiveEquipped || {}).forEach(([slot, val]) => {
      if (!val) return;
      const { _fromLegacy, ...clean } = val;
      out[slot] = clean;
    });
    return out;
  };

  const equipFromInventory = (slotId, invIdx) => {
    const inv = [...(char.inventory || [])];
    const item = inv[invIdx];
    if (!item || !fitsSlot(item, slotId)) return;
    // Seed from the promoted effective map so legacy slots survive.
    const nextEquipped = promoteEffectiveToEquipped();
    const displaced = nextEquipped[slotId];

    // Take one copy out of inventory (decrement quantity or splice)
    if ((item.quantity || 1) > 1) {
      inv[invIdx] = { ...item, quantity: (item.quantity || 1) - 1 };
    } else {
      inv.splice(invIdx, 1);
    }
    // Equip the new item (single copy)
    const { quantity, ...itemNoQty } = item;
    nextEquipped[slotId] = itemNoQty;

    // Send displaced item back to inventory (if any)
    if (displaced) {
      const existingIdx = inv.findIndex(i => i.name === displaced.name);
      if (existingIdx >= 0) {
        const existing = inv[existingIdx];
        inv[existingIdx] = { ...existing, quantity: (existing.quantity || 1) + 1 };
      } else {
        inv.push({ ...displaced, quantity: 1 });
      }
    }
    updateChar({ ...syncLegacyFields(nextEquipped), inventory: inv });
    setSlotPickerOpen(null);
  };

  const unequipSlot = (slotId) => {
    const item = effectiveEquipped[slotId];
    if (!item) return;
    // Seed nextEquipped from the promoted effective map so unequipping
    // one slot doesn't silently wipe legacy-sourced slots — #47.
    const nextEquipped = promoteEffectiveToEquipped();
    delete nextEquipped[slotId];

    const inv = [...(char.inventory || [])];
    // Strip the synth marker before sending back to inventory
    const { _fromLegacy, ...clean } = item;
    const existingIdx = inv.findIndex(i => i.name === clean.name);
    if (existingIdx >= 0) {
      const existing = inv[existingIdx];
      inv[existingIdx] = { ...existing, quantity: (existing.quantity || 1) + 1 };
    } else {
      inv.push({ ...clean, quantity: 1 });
    }

    updateChar({ ...syncLegacyFields(nextEquipped), inventory: inv });
  };

  const getFeatSlots = () => {
    const base = 1 + Math.floor((char.level - 1) / 2);
    const human = char.race === 'Human' ? 1 : 0;
    const fighter = className === 'Fighter' ? Math.floor(char.level / 2) : 0;
    return { total: base + human + fighter, used: (char.feats || []).length };
  };

  const getConditionSeverity = (condName) => {
    const severe = ['Dead', 'Dying', 'Unconscious', 'Paralyzed', 'Petrified', 'Helpless', 'Poisoned', 'Diseased', 'Cursed', 'Ability Drained'];
    const moderate = ['Blinded', 'Deafened', 'Confused', 'Nauseated', 'Stunned', 'Energy Drained'];
    if (severe.includes(condName)) return 'severe';
    if (moderate.includes(condName)) return 'moderate';
    return 'minor';
  };

  const renderStats = () => {
    const bab = calcBAB(className, char.level, classesMap);
    const cmb = bab + abilityMods.STR + (char.size === 'Small' ? -1 : char.size === 'Large' ? 1 : 0);
    const cmd = 10 + bab + abilityMods.STR + abilityMods.DEX + (char.size === 'Small' ? -1 : char.size === 'Large' ? 1 : 0);

    // Use rules engine for saves (includes feat bonuses, conditions, and active spell effects)
    const condMods = getCharacterModifiers(char, worldState);
    const fortResult = computeSave(char, 'Fort', condMods);
    const refResult = computeSave(char, 'Ref', condMods);
    const willResult = computeSave(char, 'Will', condMods);
    const fortSave = fortResult.total;
    const refSave = refResult.total;
    const willSave = willResult.total;

    // Proficiency warnings
    const profIssues = getAllProficiencyIssues(char);

    // Iterative attacks
    const iterativeAttacks = [];
    for (let i = 0; i < bab; i += 5) {
      if (i === 0) iterativeAttacks.push(bab);
      else iterativeAttacks.push(bab - i);
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Abilities Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '15px' }}>
          {['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map(ability => (
            <div key={ability} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
              <div style={{ color: '#ffd700', fontSize: isMobile ? '11px' : '12px', marginBottom: '4px' }}>{ability}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <button
                  onClick={() => updateAbility(ability, -1)}
                  style={{ padding: '2px 6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', fontSize: isMobile ? '11px' : '10px', minHeight: '24px', minWidth: '24px' }}
                >
                  -
                </button>
                <div style={{ color: '#d4c5a9', fontSize: '20px', fontWeight: 'bold', minWidth: '40px', textAlign: 'center' }}>
                  {char.abilities?.[ability] || 10}
                </div>
                <button
                  onClick={() => updateAbility(ability, 1)}
                  style={{ padding: '2px 6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', fontSize: isMobile ? '11px' : '10px', minHeight: '24px', minWidth: '24px' }}
                >
                  +
                </button>
              </div>
              <div style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '12px' }}>
                ({modStr(abilityMods[ability])})
              </div>
            </div>
          ))}
        </div>

        {/* HP Bar */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Hit Points</div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              value={char.currentHP || 0}
              onChange={(e) => updateChar({ currentHP: parseInt(e.target.value) || 0 })}
              style={{ width: '60px', padding: '6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
            />
            {(() => {
              // Phase 7.6 — effective max HP folds in the familiar HP bonus
              // (e.g. toad +3) when in range; clamp to guard against currentHP
              // overflow and divide-by-zero.
              const effMax = getEffectiveMaxHP(char, { worldState });
              const famMods = aggregateFamiliarModifiers(char, { worldState });
              const famHpBonus = famMods.hpBonus || 0;
              const hpRatio = effMax > 0
                ? Math.min(1, Math.max(0, (char.currentHP || 0) / effMax))
                : 0;
              return (
                <>
                  <div style={{ color: '#d4c5a9' }}>
                    / {effMax}
                    {famHpBonus > 0 && (
                      <span
                        style={{ fontSize: '10px', marginLeft: 4, opacity: 0.8 }}
                        title={`+${famHpBonus} HP from familiar (CRB p. 82)`}
                      >
                        (+{famHpBonus} fam)
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1, height: '24px', background: '#1a1a2e', border: '1px solid #ffd700', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${hpRatio * 100}%`,
                        background: hpRatio > 0.5 ? '#4caf50' : '#ff9800',
                        transition: 'width 0.3s'
                      }}
                    />
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* AC Section */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Armor Class</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>Total</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{acData?.total || 10}</div>
            </div>
            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>Touch</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{acData?.touch || 10}</div>
            </div>
            <div style={{ background: '#1a1a2e', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
              <div style={{ color: '#8b949e', fontSize: '12px' }}>Flat-Footed</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{acData?.flatFooted || 10}</div>
            </div>
          </div>
          <details style={{ color: '#8b949e', fontSize: '12px' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>AC Breakdown (Editable)</summary>
            <div style={{ paddingLeft: '12px', color: '#d4c5a9', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>Armor: +{acData?.armor || 0}</div>
              <div>Shield: +{acData?.shield || 0}</div>
              <div>DEX: +{acData?.dex || 0}</div>
              <div>Size: {acData?.size > 0 ? '+' : ''}{acData?.size || 0}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Natural: +</span>
                <input
                  type="number"
                  value={char.naturalArmor || 0}
                  onChange={(e) => updateChar({ naturalArmor: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Deflection: +</span>
                <input
                  type="number"
                  value={char.deflectionBonus || 0}
                  onChange={(e) => updateChar({ deflectionBonus: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Dodge: +</span>
                <input
                  type="number"
                  value={char.dodgeBonus || 0}
                  onChange={(e) => updateChar({ dodgeBonus: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span>Misc: </span>
                <input
                  type="number"
                  value={char.miscACBonus || 0}
                  onChange={(e) => updateChar({ miscACBonus: parseInt(e.target.value) || 0 })}
                  style={{ width: '40px', padding: '4px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                />
              </div>
            </div>
          </details>
        </div>

        {/* Combat Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>BAB</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(bab)}</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>Initiative</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(abilityMods.DEX)}</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>CMB</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(cmb)}</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>CMD</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(cmd)}</div>
          </div>
        </div>

        {/* Iterative Attacks */}
        {iterativeAttacks.length > 0 && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '8px' }}>Iterative Attacks</div>
            <div style={{ color: '#d4c5a9', fontSize: '14px', fontFamily: 'monospace' }}>
              {iterativeAttacks.map((atk, i) => modStr(atk)).join(' / ')}
            </div>
          </div>
        )}

        {/* Saves */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(1, 1fr)' : 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            { label: 'Fortitude', result: fortResult, save: fortSave },
            { label: 'Reflex', result: refResult, save: refSave },
            { label: 'Will', result: willResult, save: willSave },
          ].map(({ label, result, save }) => (
            <div key={label} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
              <div style={{ color: '#ffd700', marginBottom: '4px' }}>{label}</div>
              <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{modStr(save)}</div>
              <details style={{ marginTop: '8px' }}>
                <summary style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '10px', cursor: 'pointer' }}>Details</summary>
                <div style={{ fontSize: isMobile ? '11px' : '10px', color: '#8b949e', paddingLeft: '8px', marginTop: '4px' }}>
                  <div>Base: +{result.base}</div>
                  <div>{result.abilityKey}: {modStr(result.ability)}</div>
                  {result.feat > 0 && <div style={{ color: '#4caf50' }}>Feat: +{result.feat}</div>}
                  {result.racialBonus > 0 && <div style={{ color: '#4caf50' }}>Racial: +{result.racialBonus}</div>}
                  {result.resistance > 0 && <div style={{ color: '#4caf50' }}>Resistance: +{result.resistance}</div>}
                  {result.conditionMod !== 0 && <div style={{ color: result.conditionMod < 0 ? '#ff6b6b' : '#4caf50' }}>Conditions: {modStr(result.conditionMod)}</div>}
                  {/* Show conditional racial save bonuses (Hardy, Fearless, etc.) */}
                  {(char.racialConditionalSaves || []).filter(c => c.saves.includes(label === 'Fortitude' ? 'Fort' : label === 'Reflex' ? 'Ref' : 'Will')).length > 0 && (
                    <div style={{ marginTop: '4px', borderTop: '1px solid #333', paddingTop: '4px' }}>
                      {(char.racialConditionalSaves || []).filter(c => c.saves.includes(label === 'Fortitude' ? 'Fort' : label === 'Reflex' ? 'Ref' : 'Will')).map((c, i) => (
                        <div key={i} style={{ color: '#7eb8da', fontSize: '9px' }}>+{c.bonus} vs {c.vs.join('/')} ({c.source})</div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>

        {/* Proficiency Warnings */}
        {profIssues.length > 0 && (
          <div style={{ background: '#3a1a1e', padding: '12px', border: '1px solid #cc4444', borderRadius: '4px' }}>
            <div style={{ color: '#ff6b6b', fontWeight: 'bold', marginBottom: '8px' }}>⚠ Proficiency Warnings</div>
            {profIssues.map((issue, idx) => (
              <div key={idx} style={{ color: '#ffaaaa', fontSize: '12px', marginBottom: '4px' }}>
                {issue.reason}
              </div>
            ))}
          </div>
        )}

        {/* Arcane Spell Failure */}
        {(() => {
          const asf = getArcaneSpellFailure(char);
          return asf.applies ? (
            <div style={{ background: '#2a1a3e', padding: '12px', border: '1px solid #9966cc', borderRadius: '4px' }}>
              <div style={{ color: '#cc99ff', fontSize: '12px' }}>
                ⚡ Arcane Spell Failure: <strong>{asf.chance}%</strong>
                {asf.armorFailure > 0 && <span> (Armor: {asf.armorFailure}%)</span>}
                {asf.shieldFailure > 0 && <span> (Shield: {asf.shieldFailure}%)</span>}
              </div>
            </div>
          ) : null;
        })()}

        {/* Racial Spell-Like Abilities */}
        {char.racialSpellLikeAbilities && char.racialSpellLikeAbilities.length > 0 && (
          <div style={{ background: '#1a2a3e', padding: '12px', border: '1px solid #3388aa', borderRadius: '4px' }}>
            <div style={{ color: '#66bbdd', fontWeight: 'bold', marginBottom: '8px', fontSize: '12px' }}>Racial Spell-Like Abilities</div>
            {char.racialSpellLikeAbilities.map((sla, idx) => {
              const dc = computeSLADC(char, sla);
              const cl = sla.casterLevel === 'character' ? (char.level || 1) : (sla.casterLevel || 1);
              return (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: idx < char.racialSpellLikeAbilities.length - 1 ? '1px solid #2a3a4e' : 'none' }}>
                  <div>
                    <span style={{ color: '#d4c5a9', fontSize: '12px' }}>{sla.name}</span>
                    <span style={{ color: '#8b949e', fontSize: '10px', marginLeft: '8px' }}>
                      ({sla.usesPerDay}/day, CL {cl}{dc ? `, DC ${dc}` : ''})
                    </span>
                  </div>
                  <span style={{ color: sla.usesRemaining > 0 ? '#4caf50' : '#ff6b6b', fontSize: '11px' }}>
                    {sla.usesRemaining}/{sla.usesPerDay}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Speed and Size */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>Speed</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{char.speed || 30} ft.</div>
          </div>
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '4px' }}>Size</div>
            <div style={{ color: '#d4c5a9', fontSize: '18px', fontWeight: 'bold' }}>{char.size || 'Medium'}</div>
          </div>
        </div>

        {/* Attacks */}
        {char.weapons && char.weapons.length > 0 && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '12px' }}>Attacks</div>
            {char.weapons.map((weapon, idx) => {
              const strMod = abilityMods.STR;
              const dexMod = abilityMods.DEX;
              const atkBonus = bab + (weapon.isFinesse ? Math.max(strMod, dexMod) : strMod);
              return (
                <div key={idx} style={{ marginBottom: '8px', color: '#d4c5a9' }}>
                  <div>{weapon.name}: {modStr(atkBonus)} ({weapon.dmg})</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Class Features */}
        {classData?.classFeatures && classData.classFeatures.length > 0 && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <div style={{ color: '#ffd700', marginBottom: '12px' }}>Class Features</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {classData.classFeatures.filter(f => f.level <= char.level).map((feature, idx) => (
                <div key={idx} style={{ background: '#1a1a2e', padding: '8px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px' }}>
                  <div style={{ color: '#ffd700', fontSize: '12px' }}>{feature.name}</div>
                  <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '4px' }}>Level {feature.level}</div>
                  {feature.description && (
                    <div style={{ color: '#d4c5a9', fontSize: '11px', marginTop: '4px' }}>{feature.description}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSkills = () => {
    const skills = skillsData || [];
    const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div>
        <div style={{ color: '#ffd700', marginBottom: '12px' }}>
          Skill Points: {skillPointsInfo.available} available ({skillPointsInfo.used} used)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: '#d4c5a9' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(255,215,0,0.3)' }}>
                <th style={{ textAlign: 'left', padding: '8px', color: '#ffd700' }}>Skill</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Ability</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Total</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Ranks</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Class?</th>
                <th style={{ textAlign: 'center', padding: '8px', color: '#ffd700' }}>Misc</th>
              </tr>
            </thead>
            <tbody>
              {sortedSkills.map((skill, idx) => {
                const ranks = char.skillRanks?.[skill.name] || 0;
                const abilityMod = abilityMods[skill.ability] || 0;
                const isClassSkill = classSkills.includes(skill.name);
                const classBonus = isClassSkill && ranks > 0 ? 3 : 0;
                const acp = skill.armorPenalty ? armorCheckPenalty : 0;
                const total = abilityMod + ranks + classBonus + acp;
                const miscMod = char.skillBonuses?.[skill.name] || 0;

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,215,0,0.1)' }}>
                    <td style={{ padding: '8px' }}>{skill.name}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{skill.ability}</td>
                    <td style={{ textAlign: 'center', padding: '8px', fontWeight: 'bold' }}>{modStr(total + miscMod)}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                        <button
                          onClick={() => updateSkillRank(skill.name, -1)}
                          style={{
                            padding: '2px 6px',
                            background: '#1a1a2e',
                            border: '1px solid #ffd700',
                            color: '#ffd700',
                            cursor: 'pointer'
                          }}
                        >
                          -
                        </button>
                        <span style={{ minWidth: '20px', textAlign: 'center' }}>{ranks}</span>
                        <button
                          onClick={() => updateSkillRank(skill.name, 1)}
                          style={{
                            padding: '2px 6px',
                            background: '#1a1a2e',
                            border: '1px solid #ffd700',
                            color: '#ffd700',
                            cursor: 'pointer'
                          }}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{isClassSkill ? 'Yes' : '-'}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{miscMod > 0 ? '+' : ''}{miscMod}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {armorCheckPenalty !== 0 && (
          <div style={{ marginTop: '12px', color: '#ff9800', fontSize: '12px' }}>
            Armor Check Penalty: {modStr(armorCheckPenalty)}
          </div>
        )}
      </div>
    );
  };

  const renderFeats = () => {
    const feats = featsData || [];
    const slots = getFeatSlots();
    const filteredFeats = feats.filter(f => f.name.toLowerCase().includes(featSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>
            Feat Slots: {slots.used} / {slots.total}
          </div>
          <button
            onClick={() => setShowFeatPicker(!showFeatPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Add Feat
          </button>
        </div>

        {showFeatPicker && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <input
              type="text"
              placeholder="Search feats..."
              value={featSearch}
              onChange={(e) => setFeatSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a2e',
                border: '1px solid #ffd700',
                color: '#d4c5a9',
                marginBottom: '12px',
                borderRadius: '4px'
              }}
            />
            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredFeats.slice(0, 20).map((feat, idx) => (
                <button
                  key={idx}
                  onClick={() => addFeat(feat.name)}
                  disabled={(char.feats || []).includes(feat.name)}
                  style={{
                    padding: '8px',
                    background: (char.feats || []).includes(feat.name) ? '#555' : '#1a1a2e',
                    border: '1px solid rgba(255,215,0,0.3)',
                    color: (char.feats || []).includes(feat.name) ? '#888' : '#d4c5a9',
                    cursor: (char.feats || []).includes(feat.name) ? 'default' : 'pointer',
                    textAlign: 'left',
                    borderRadius: '4px'
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{feat.name}</div>
                  {feat.prerequisites && (
                    <div style={{ fontSize: '11px', color: '#8b949e' }}>Prereq: {feat.prerequisites}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {char.feats?.map((featName, idx) => {
            const featData = feats.find(f => f.name === featName);
            return (
              <div key={idx} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ color: '#ffd700' }}>{featName}</div>
                  <button
                    onClick={() => removeFeat(featName)}
                    style={{
                      padding: '4px 8px',
                      background: '#8b5a00',
                      border: '1px solid #ffd700',
                      color: '#ffd700',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    Remove
                  </button>
                </div>
                {featData?.prerequisites && (
                  <div style={{ color: '#8b949e', fontSize: '11px', marginBottom: '4px' }}>
                    Prerequisites: {featData.prerequisites}
                  </div>
                )}
                {featData?.benefit && (
                  <div style={{ color: '#d4c5a9', fontSize: '12px' }}>{featData.benefit}</div>
                )}
              </div>
            );
          })}
          {(!char.feats || char.feats.length === 0) && (
            <div style={{ color: '#8b949e' }}>No feats selected.</div>
          )}
        </div>
      </div>
    );
  };

  const renderSpells = () => {
    if (!isSpellcaster) {
      return <div style={{ color: '#8b949e' }}>{className} is not a spellcasting class.</div>;
    }

    const castingAbility = spellSlotData?.castingAbility?.[className];
    const castingType = spellSlotData?.castingType?.[className];
    const spells = spellsData || [];
    const filteredSpells = spells.filter(s => s.name.toLowerCase().includes(spellSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Casting Ability: {castingAbility}</div>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Type: {castingType}</div>
          <button
            onClick={restSpells}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '2px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Rest & Recover Spells
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
          {Object.entries(spellSlots).map(([level, max]) => {
            const used = char.spellSlotsUsed?.[level] || 0;
            return (
              <div key={level} style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
                <div style={{ color: '#ffd700', marginBottom: '8px' }}>Level {level}</div>
                <div style={{ color: '#d4c5a9', marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }}>
                  {used} / {max}
                </div>
                <button
                  onClick={() => castSpell(level)}
                  disabled={used >= max}
                  style={{
                    width: '100%',
                    padding: '6px',
                    background: used >= max ? '#555' : '#1a1a2e',
                    border: '1px solid #ffd700',
                    color: used >= max ? '#888' : '#ffd700',
                    cursor: used >= max ? 'default' : 'pointer',
                    borderRadius: '4px'
                  }}
                >
                  Cast
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Add Spell Known</div>
          <button
            onClick={() => setShowSpellPicker(!showSpellPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px',
              marginBottom: '12px'
            }}
          >
            Browse Spells
          </button>

          {showSpellPicker && (
            <div style={{ background: '#1a1a2e', padding: '12px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Search spells..."
                value={spellSearch}
                onChange={(e) => setSpellSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#2a2a4e',
                  border: '1px solid #ffd700',
                  color: '#d4c5a9',
                  marginBottom: '12px',
                  borderRadius: '4px'
                }}
              />
              <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredSpells.slice(0, 20).map((spell, idx) => (
                  <button
                    key={idx}
                    onClick={() => addSpell(spell.name)}
                    disabled={(char.spellsKnown || []).includes(spell.name)}
                    style={{
                      padding: '8px',
                      background: (char.spellsKnown || []).includes(spell.name) ? '#555' : '#2a2a4e',
                      border: '1px solid rgba(255,215,0,0.3)',
                      color: (char.spellsKnown || []).includes(spell.name) ? '#888' : '#d4c5a9',
                      cursor: (char.spellsKnown || []).includes(spell.name) ? 'default' : 'pointer',
                      textAlign: 'left',
                      borderRadius: '4px'
                    }}
                  >
                    {spell.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>
            {castingType === 'prepared' ? 'Spells Prepared' : 'Spells Known'}
          </div>
          {(char.spellsKnown || [])?.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(1, 1fr)' : 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
              {(char.spellsKnown || []).map((spellName, idx) => (
                <div key={idx} style={{ background: '#1a1a2e', padding: '8px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', color: '#d4c5a9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{spellName}</span>
                  <button
                    onClick={() => removeSpell(spellName)}
                    style={{ padding: '2px 6px', background: '#8b5a00', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', fontSize: isMobile ? '11px' : '10px', borderRadius: '2px', minHeight: '24px', minWidth: '24px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#8b949e' }}>None selected.</div>
          )}
        </div>
      </div>
    );
  };

  const renderInventory = () => {
    const inventory = char.inventory || [];
    const gold = char.gold || 0;
    const allItems = [...gearData, ...magicItemsData];
    const filteredItems = allItems.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()));

    // Paperdoll layout: 3 columns. Left side carries head→feet+mainHand,
    // center holds the figure (rowSpan), right side carries eyes→rings+offHand.
    // Order matches BG-style: head/armor/weapon-down-the-left, accessories on the right.
    const LEFT_COL  = ['head',      'shoulders', 'body',  'chest', 'belt',     'feet',      'mainHand'];
    const RIGHT_COL = ['eyes',      'neck',      'wrists', 'hands', 'ringLeft', 'ringRight', 'offHand'];
    const slotById = Object.fromEntries(EQUIPMENT_SLOTS.map(s => [s.id, s]));
    const totalRows = Math.max(LEFT_COL.length, RIGHT_COL.length);

    const PaperdollSlot = ({ slotId, gridColumn, gridRow }) => {
      const slot = slotById[slotId];
      if (!slot) return null;
      const item = effectiveEquipped[slotId];
      const isLegacy = !!item?._fromLegacy;
      const isOpen = slotPickerOpen === slotId;
      const eligible = (char.inventory || [])
        .map((it, idx) => ({ it, idx }))
        .filter(({ it }) => fitsSlot(it, slotId));

      return (
        <div
          style={{
            gridColumn, gridRow,
            background: item ? '#1a1a2e' : '#15152a',
            padding: '8px',
            border: `1px solid ${item ? 'rgba(255,215,0,0.55)' : 'rgba(255,215,0,0.18)'}`,
            borderRadius: '4px',
            cursor: 'pointer',
            position: 'relative',
            minHeight: '52px',
          }}
          onClick={() => setSlotPickerOpen(isOpen ? null : slotId)}
          title={item ? `${item.name}${isLegacy ? ' (from legacy field — click to manage)' : ''}` : `Empty — click to equip ${slot.label}`}
        >
          <div style={{ color: '#ffd700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
            {slot.label}
          </div>
          <div style={{ color: item ? '#d4c5a9' : '#5a5a7a', fontSize: '12px', fontStyle: item ? 'normal' : 'italic' }}>
            {item ? item.name : '— empty —'}
          </div>
          {item && (
            <button
              onClick={(e) => { e.stopPropagation(); unequipSlot(slotId); }}
              style={{ position: 'absolute', top: '4px', right: '4px', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '12px' }}
              title="Unequip"
            >
              ✕
            </button>
          )}
          {isOpen && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 10,
                marginTop: '4px', minWidth: '220px', maxHeight: '240px', overflowY: 'auto',
                background: '#0d0d1a', border: '1px solid #ffd700', borderRadius: '4px',
                padding: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ color: '#ffd700', fontSize: '11px', marginBottom: '4px' }}>
                Equip → {slot.label}
              </div>
              {eligible.length === 0 ? (
                <div style={{ color: '#8b949e', fontSize: '11px', padding: '4px' }}>
                  No matching items in backpack.
                </div>
              ) : eligible.map(({ it, idx }) => (
                <button
                  key={idx}
                  onClick={() => equipFromInventory(slotId, idx)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px', marginBottom: '2px',
                    background: '#1a1a2e', border: '1px solid rgba(255,215,0,0.3)',
                    color: '#d4c5a9', cursor: 'pointer', borderRadius: '3px', fontSize: '11px',
                  }}
                >
                  {it.name}{(it.quantity || 1) > 1 ? ` ×${it.quantity}` : ''}
                </button>
              ))}
              <button
                onClick={() => setSlotPickerOpen(null)}
                style={{ marginTop: '4px', padding: '4px 8px', background: 'transparent', border: '1px solid #8b949e', color: '#8b949e', cursor: 'pointer', borderRadius: '3px', fontSize: '11px' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Paperdoll */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Equipment (Paperdoll)</span>
            <span style={{ color: '#8b949e', fontSize: '10px', fontWeight: 'normal' }}>click a slot to equip from backpack · ✕ to unequip</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '8px' }}>
            {LEFT_COL.map((id, i) => (
              <PaperdollSlot key={id} slotId={id} gridColumn={1} gridRow={i + 1} />
            ))}

            {/* Center: figure / portrait */}
            <div
              style={{
                gridColumn: 2,
                gridRow: `1 / span ${totalRows}`,
                background: 'linear-gradient(180deg, #1a1a2e 0%, #2a2a4e 100%)',
                border: '1px solid rgba(255,215,0,0.35)',
                borderRadius: '6px',
                padding: '12px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '8px',
                minHeight: '320px',
              }}
            >
              <div style={{ fontSize: '64px', lineHeight: 1, opacity: 0.7 }}>🛡️</div>
              <div style={{ color: '#ffd700', fontSize: '14px', fontWeight: 'bold', textAlign: 'center' }}>
                {char.name || 'Unnamed'}
              </div>
              <div style={{ color: '#d4c5a9', fontSize: '11px', textAlign: 'center' }}>
                Lv {char.level || 1} {char.race || ''} {char.class || ''}
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#8b949e', fontSize: '10px' }}>AC</div>
                  <div style={{ color: '#ffd700', fontSize: '18px', fontWeight: 'bold' }}>{acData?.total ?? 10}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: '#8b949e', fontSize: '10px' }}>HP</div>
                  <div style={{ color: '#ffd700', fontSize: '18px', fontWeight: 'bold' }}>
                    {char.currentHP ?? char.maxHP ?? '—'}/{char.maxHP ?? '—'}
                  </div>
                </div>
              </div>
              {armorCheckPenalty !== 0 && (
                <div style={{ color: '#ff9800', fontSize: '10px', marginTop: '4px' }}>
                  ACP {modStr(armorCheckPenalty)}
                </div>
              )}
            </div>

            {RIGHT_COL.map((id, i) => (
              <PaperdollSlot key={id} slotId={id} gridColumn={3} gridRow={i + 1} />
            ))}
          </div>
        </div>

        {/* Gold */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Gold</div>
          <input
            type="number"
            value={gold}
            onChange={(e) => updateChar({ gold: parseInt(e.target.value) || 0 })}
            style={{ padding: '6px', background: '#1a1a2e', border: '1px solid #ffd700', color: '#d4c5a9', width: '100px' }}
          />
          <span style={{ color: '#d4c5a9', marginLeft: '8px' }}>gp</span>
        </div>

        {/* Encumbrance */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Encumbrance</div>
          <div style={{ color: '#d4c5a9', marginBottom: '8px' }}>
            Total Weight: {totalWeight} / {carryingCapacity?.heavy || 0} lbs
          </div>
          <div style={{ background: '#1a1a2e', height: '24px', borderRadius: '4px', overflow: 'hidden', border: '1px solid #ffd700', marginBottom: '8px' }}>
            <div
              style={{
                height: '100%',
                width: `${(totalWeight / (carryingCapacity?.heavy || 1)) * 100}%`,
                background: encumbranceLevel === 'light' ? '#4caf50' : encumbranceLevel === 'medium' ? '#ff9800' : '#f44336'
              }}
            />
          </div>
          <div style={{ color: encumbranceLevel === 'light' ? '#4caf50' : encumbranceLevel === 'medium' ? '#ff9800' : '#f44336', marginBottom: '8px' }}>
            Status: {encumbranceLevel?.toUpperCase()}
          </div>
          {encumbranceEffects && encumbranceLevel !== 'light' && (
            <div style={{ color: '#8b949e', fontSize: '12px' }}>
              Max DEX: +{encumbranceEffects.maxDex} | Check Penalty: {encumbranceEffects.checkPenalty} | Run: x{encumbranceEffects.runMult}
            </div>
          )}
        </div>

        {/* Add Item */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '8px' }}>Add Item</div>
          <button
            onClick={() => setShowItemPicker(!showItemPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Browse Items
          </button>

          {showItemPicker && (
            <div style={{ background: '#1a1a2e', padding: '12px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', marginTop: '12px' }}>
              <input
                type="text"
                placeholder="Search items..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#2a2a4e',
                  border: '1px solid #ffd700',
                  color: '#d4c5a9',
                  marginBottom: '12px',
                  borderRadius: '4px'
                }}
              />
              <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {filteredItems.slice(0, 25).map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => addItem(item)}
                    style={{
                      padding: '8px',
                      background: '#2a2a4e',
                      border: '1px solid rgba(255,215,0,0.3)',
                      color: '#d4c5a9',
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderRadius: '4px'
                    }}
                  >
                    <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                    <div style={{ fontSize: '11px', color: '#8b949e' }}>{item.price || '-'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Backpack */}
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <div style={{ color: '#ffd700', marginBottom: '12px' }}>Backpack</div>
          {inventory.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {inventory.map((item, idx) => {
                // Bug #52: render-time hydration fallback for pre-#52 saves
                // whose gearInventory was stored as bare {name, quantity, type}
                // with no weight/price/description. New characters land
                // pre-hydrated from TemplateSelector, but existing characters
                // need the lookup here to show real weight and tooltip.
                const needsHydration =
                  item.weight == null ||
                  (typeof item.weight !== 'number') ||
                  !item.description;
                const display = needsHydration
                  ? hydrateGearItem(item, gearData, equipmentData, magicItemsData)
                  : { ...item, weight: parseWeightLbs(item.weight) };
                const tooltipBits = [];
                if (display.category && display.category !== 'gear') tooltipBits.push(display.category);
                if (display.price) tooltipBits.push(String(display.price));
                if (display.description) tooltipBits.push(display.description);
                const tooltip = tooltipBits.join(' · ');
                return (
                <div
                  key={idx}
                  title={tooltip || display.name}
                  style={{ background: '#1a1a2e', padding: '8px', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', color: '#d4c5a9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <div>{display.name}</div>
                    <div style={{ color: '#8b949e', fontSize: '11px' }}>
                      {display.weight || 0} lbs{display.price ? ` · ${display.price}` : ''} | x<input
                        type="number"
                        value={item.quantity || 1}
                        onChange={(e) => {
                          const inv = [...inventory];
                          inv[idx].quantity = parseInt(e.target.value) || 1;
                          updateChar({ inventory: inv });
                        }}
                        style={{ width: '30px', padding: '2px', background: '#2a2a4e', border: '1px solid #ffd700', color: '#d4c5a9' }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(idx)}
                    style={{ padding: '4px 8px', background: '#8b5a00', border: '1px solid #ffd700', color: '#ffd700', cursor: 'pointer', borderRadius: '4px', fontSize: '11px' }}
                  >
                    Remove
                  </button>
                </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: '#8b949e' }}>Empty</div>
          )}
        </div>
      </div>
    );
  };

  const renderConditions = () => {
    const filteredConditions = conditionsData.filter(c => c.name.toLowerCase().includes(conditionSearch.toLowerCase()));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
          <button
            onClick={() => setShowConditionPicker(!showConditionPicker)}
            style={{
              padding: '8px 16px',
              background: '#1a1a2e',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            Add Condition
          </button>
        </div>

        {showConditionPicker && (
          <div style={{ background: '#2a2a4e', padding: '12px', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px' }}>
            <input
              type="text"
              placeholder="Search conditions..."
              value={conditionSearch}
              onChange={(e) => setConditionSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#1a1a2e',
                border: '1px solid #ffd700',
                color: '#d4c5a9',
                marginBottom: '12px',
                borderRadius: '4px'
              }}
            />
            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredConditions.map((condition, idx) => (
                <button
                  key={idx}
                  onClick={() => addCondition(condition.name)}
                  disabled={(char.conditions || []).includes(condition.name)}
                  style={{
                    padding: '8px',
                    background: (char.conditions || []).includes(condition.name) ? '#555' : '#1a1a2e',
                    border: '1px solid rgba(255,215,0,0.3)',
                    color: (char.conditions || []).includes(condition.name) ? '#888' : '#d4c5a9',
                    cursor: (char.conditions || []).includes(condition.name) ? 'default' : 'pointer',
                    textAlign: 'left',
                    borderRadius: '4px'
                  }}
                >
                  {condition.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {char.conditions?.map((condName, idx) => {
            const condData = conditionsData.find(c => c.name === condName);
            const severity = getConditionSeverity(condName);
            const severityColor = severity === 'severe' ? '#f44336' : severity === 'moderate' ? '#ff9800' : '#ffeb3b';

            return (
              <div key={idx} style={{ background: '#2a2a4e', padding: '12px', border: `2px solid ${severityColor}`, borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ color: severityColor, fontWeight: 'bold' }}>{condName}</div>
                  <button
                    onClick={() => removeCondition(condName)}
                    style={{
                      padding: '4px 8px',
                      background: '#8b5a00',
                      border: '1px solid #ffd700',
                      color: '#ffd700',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontSize: '11px'
                    }}
                  >
                    Remove
                  </button>
                </div>
                {condData?.description && (
                  <div style={{ color: '#d4c5a9', fontSize: '12px' }}>{condData.description}</div>
                )}
              </div>
            );
          })}
          {(!char.conditions || char.conditions.length === 0) && (
            <div style={{ color: '#8b949e' }}>No active conditions.</div>
          )}
        </div>
      </div>
    );
  };

  const renderNotes = () => {
    return (
      <div>
        {/* Backstory section */}
        {char.backstory && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '14px', color: '#9382dc', fontWeight: 'bold', marginBottom: '8px' }}>Backstory</div>
            <div style={{
              padding: '12px',
              background: 'rgba(147,130,220,0.08)',
              borderLeft: '3px solid #9382dc',
              borderRadius: '4px',
              color: '#c4b998',
              fontSize: '13px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}>
              {char.backstory}
            </div>
          </div>
        )}
        {(char.characterTraits?.length > 0 || char.drawback) && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: '#ffd700', fontWeight: 'bold', marginBottom: '6px' }}>Character Traits</div>
            {char.characterTraits?.map((tName, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#d4c5a9', marginBottom: '4px', paddingLeft: '8px', borderLeft: '2px solid #ffd700' }}>
                {tName}
              </div>
            ))}
            {char.drawback && (
              <div style={{ fontSize: '12px', color: '#cc6644', marginBottom: '4px', paddingLeft: '8px', borderLeft: '2px solid #cc6644' }}>
                Drawback: {char.drawback}
              </div>
            )}
          </div>
        )}
        {char.personality && (
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#a0926b', fontStyle: 'italic' }}>
            <strong style={{ color: '#ffd700' }}>Personality:</strong> {char.personality}
          </div>
        )}
        {char.appearance && (
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#a0926b', fontStyle: 'italic' }}>
            <strong style={{ color: '#ffd700' }}>Appearance:</strong> {char.appearance}
          </div>
        )}
        <div style={{ fontSize: '14px', color: '#ffd700', fontWeight: 'bold', marginBottom: '8px' }}>Notes</div>
        <textarea
          value={char.notes || ''}
          onChange={(e) => updateChar({ notes: e.target.value })}
          style={{
            width: '100%',
            height: char.backstory ? '250px' : '400px',
            padding: '12px',
            background: '#1a1a2e',
            border: '1px solid #ffd700',
            color: '#d4c5a9',
            fontFamily: 'monospace',
            borderRadius: '4px',
            resize: 'vertical'
          }}
          placeholder="Add character notes..."
        />
      </div>
    );
  };

  const renderCraft = () => {
    return (
      <div>
        <CraftProjectPanel
          character={char}
          onUpdateCharacter={updateChar}
          onOpenCraftModal={() => setShowCraftModal(true)}
        />
      </div>
    );
  };

  const tabContent = {
    Stats: renderStats(),
    Skills: renderSkills(),
    Feats: renderFeats(),
    Spells: renderSpells(),
    Inventory: renderInventory(),
    Conditions: renderConditions(),
    Craft: renderCraft(),
    Notes: renderNotes(),
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: isMobile ? 0 : '20px'
    }}>
      <div style={{
        maxWidth: isMobile ? 'none' : '900px',
        maxHeight: isMobile ? '100%' : '90vh',
        width: isMobile ? '100%' : '100%',
        height: isMobile ? '100%' : 'auto',
        margin: isMobile ? 0 : undefined,
        background: '#1a1a2e',
        border: '2px solid #ffd700',
        borderRadius: isMobile ? 0 : '8px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: isMobile ? '12px' : '20px',
          borderBottom: '2px solid rgba(255,215,0,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          gap: isMobile ? '8px' : '0'
        }}>
          <div>
            <h2 style={{ color: '#ffd700', margin: 0, marginBottom: '4px', fontSize: isMobile ? '16px' : '20px' }}>{char.name}</h2>
            <div style={{ color: '#8b949e', fontSize: isMobile ? '11px' : '12px' }}>
              Level {char.level} {char.gender ? `${char.gender} ` : ''}{char.race} {className}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              background: '#8b5a00',
              border: '1px solid #ffd700',
              color: '#ffd700',
              cursor: 'pointer',
              borderRadius: '4px',
              minHeight: '44px',
              minWidth: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,215,0,0.2)',
          flexShrink: 0,
          overflowX: isMobile ? 'auto' : 'visible',
          flexWrap: isMobile ? 'nowrap' : 'wrap'
        }}>
          {['Stats', 'Skills', 'Feats', 'Spells', 'Inventory', 'Conditions', 'Craft', 'Notes'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: isMobile ? '10px 12px' : '12px 20px',
                background: activeTab === tab ? '#2a2a4e' : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #ffd700' : '2px solid transparent',
                color: activeTab === tab ? '#ffd700' : '#8b949e',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                fontSize: isMobile ? '12px' : '14px'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          padding: isMobile ? '12px' : '20px',
          overflowY: 'auto',
          flex: 1
        }}>
          {tabContent[activeTab]}
        </div>
      </div>

      {/* Craft Item Modal */}
      {showCraftModal && (
        <CraftItemModal
          character={char}
          onUpdateCharacter={updateChar}
          onClose={() => setShowCraftModal(false)}
          locationFacilityIds={locationFacilityIds}
        />
      )}
    </div>
  );
};

export default CharacterSheet;
