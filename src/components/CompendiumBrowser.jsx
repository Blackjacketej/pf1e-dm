import React, { useState, useMemo, useCallback } from 'react';

// ── Data imports ──
import classesData from '../data/classes.json';
import prestigeClassesData from '../data/prestigeClasses.json';
import racesData from '../data/races.json';
import featsData from '../data/feats.json';
import spellsData from '../data/spells.json';
import skillsData from '../data/skills.json';
import equipmentData from '../data/equipment.json';
import weaponsData from '../data/weapons.json';
import conditionsData from '../data/conditions.json';
import traitsData from '../data/traits.json';
import heritagesData from '../data/heritages.json';
import ethnicitiesData from '../data/ethnicities.json';
import archetypesData from '../data/archetypes.json';
import magicItemsData from '../data/magicItems.json';
import templatesData from '../data/templates.json';
import gearData from '../data/gear.json';
import npcsData from '../data/npcs.json';
import monstersData from '../data/monsters.json';
import domainsData from '../data/domains.json';
import bloodlinesData from '../data/bloodlines.json';
import deitiesData from '../data/deities.json';
import schoolsOfMagicData from '../data/schoolsOfMagic.json';

// ── Styles ──
const sty = {
  container: { display: 'flex', height: '100%', gap: 0 },
  treePanel: {
    width: 220, flexShrink: 0, backgroundColor: '#0a0e18', borderRight: '1px solid #1e2a3a',
    overflowY: 'auto', padding: '8px 0', fontSize: 12,
  },
  contentPanel: { flex: 1, overflow: 'auto', padding: 16 },
  categoryHeader: (open) => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', cursor: 'pointer',
    color: '#ffd700', fontWeight: 600, fontSize: 12, userSelect: 'none',
    background: open ? '#111827' : 'transparent',
  }),
  subItem: (active) => ({
    padding: '4px 12px 4px 32px', cursor: 'pointer', fontSize: 11,
    color: active ? '#ffd700' : '#8b949e', fontWeight: active ? 600 : 400,
    background: active ? '#1a1a2e' : 'transparent',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }),
  allBtn: (active) => ({
    padding: '4px 12px 4px 32px', cursor: 'pointer', fontSize: 11, fontStyle: 'italic',
    color: active ? '#ffd700' : '#6b7b8e',
    background: active ? '#1a1a2e' : 'transparent',
  }),
  searchBar: {
    width: '100%', padding: '8px 12px', marginBottom: 10,
    background: '#0d1117', border: '1px solid #30363d', borderRadius: 4,
    color: '#e0d6c8', fontSize: 13,
  },
  card: {
    background: '#16213e', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 6,
    padding: 12, marginBottom: 8, fontSize: 12, color: '#d4c5a9', cursor: 'pointer',
  },
  cardTitle: { color: '#ffd700', fontWeight: 700, fontSize: 14, marginBottom: 4 },
  tag: (color) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10,
    background: color || '#2a2a4e', color: '#e0d6c8', marginRight: 4, marginBottom: 2,
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 8 },
  label: { color: '#8b949e', fontSize: 10, textTransform: 'uppercase' },
  badge: {
    fontSize: 9, color: '#6b7b8e', marginLeft: 'auto', minWidth: 20, textAlign: 'right',
  },
  statsBar: {
    display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, padding: '8px 12px',
    background: '#0d1117', borderRadius: 6, border: '1px solid #1e2a3a', fontSize: 11, color: '#6b7b8e',
  },
};

const DetailRow = ({ label, value }) => {
  if (value === undefined || value === null || value === '' || value === false) return null;
  const display = typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')
    : Array.isArray(value) ? value.join(', ') : String(value);
  return <div style={{ marginTop: 2 }}><span style={sty.label}>{label}: </span>{display}</div>;
};

// ── Normalize data arrays ──
function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data).flat();
  return [];
}

// ── Category Tree Definition ──
// Each category: { key, label, icon, color, data, subcategoryFn?, renderCard }
// subcategoryFn(items) => [{key, label, filterFn}]

function buildCategories() {
  const classes = toArray(classesData);
  const prestige = toArray(prestigeClassesData).map(c => ({ ...c, _prestige: true }));
  const allClasses = [...classes, ...prestige];
  const races = toArray(racesData);
  const feats = toArray(featsData);
  const spells = toArray(spellsData);
  const skills = toArray(skillsData);
  const equipment = toArray(equipmentData);
  const weapons = toArray(weaponsData);
  const conditions = toArray(conditionsData);
  const traits = toArray(traitsData);
  const heritages = toArray(heritagesData);
  const ethnicities = toArray(ethnicitiesData);
  const archetypes = toArray(archetypesData);
  const magicItems = toArray(magicItemsData);
  const templates = toArray(templatesData);
  const gear = toArray(gearData);
  const npcs = toArray(npcsData);
  const monsters = toArray(monstersData);
  const domains = toArray(domainsData);
  const bloodlines = toArray(bloodlinesData);
  const deities = toArray(deitiesData);
  const schoolsOfMagic = toArray(schoolsOfMagicData);

  return [
    {
      key: 'classes', label: 'Classes', icon: '\u2694\uFE0F', color: '#c9a23a',
      data: allClasses,
      subcategoryFn: () => {
        const baseNames = classes.map(c => c.name).sort();
        const prestigeNames = prestige.map(c => c.name).sort();
        return [
          ...baseNames.map(n => ({ key: `cls-${n}`, label: n, filterFn: item => item.name === n })),
          { key: 'sep-prestige', label: '── Prestige ──', separator: true },
          ...prestigeNames.map(n => ({ key: `prs-${n}`, label: n, filterFn: item => item.name === n })),
        ];
      },
      renderCard: renderClassCard,
    },
    {
      key: 'archetypes', label: 'Archetypes', icon: '\u{1F3AD}', color: '#a67bc5',
      data: archetypes,
      subcategoryFn: (items) => {
        const classNames = [...new Set(items.map(a => a.class || a.className || 'Unknown'))].sort();
        return classNames.map(c => ({ key: `arc-${c}`, label: c, filterFn: item => (item.class || item.className) === c }));
      },
      renderCard: renderArchetypeCard,
    },
    {
      key: 'races', label: 'Races', icon: '\u{1F9DD}', color: '#5ab5a0',
      data: races,
      subcategoryFn: () => {
        const raceNames = races.map(r => r.name).sort();
        return raceNames.map(n => ({ key: `race-${n}`, label: n, filterFn: item => item.name === n }));
      },
      renderCard: renderRaceCard,
    },
    {
      key: 'heritages', label: 'Heritages', icon: '\u{1F451}', color: '#d4a65a',
      data: heritages,
      subcategoryFn: (items) => {
        const types = [...new Set(items.map(h => h.race || h.type || 'General'))].sort();
        return types.map(t => ({ key: `her-${t}`, label: t, filterFn: item => (item.race || item.type) === t }));
      },
      renderCard: renderGenericCard,
    },
    {
      key: 'ethnicities', label: 'Ethnicities', icon: '\u{1F30D}', color: '#6ba5c9',
      data: ethnicities,
      renderCard: renderGenericCard,
    },
    {
      key: 'feats', label: 'Feats', icon: '\u{1F4AA}', color: '#c95a5a',
      data: feats,
      subcategoryFn: (items) => {
        const types = [...new Set(items.map(f => f.type || f.category || 'General').filter(Boolean))].sort();
        return types.map(t => ({ key: `ft-${t}`, label: t, filterFn: item => (item.type || item.category) === t }));
      },
      renderCard: renderFeatCard,
    },
    {
      key: 'spells', label: 'Spells', icon: '\u2728', color: '#7b7be0',
      data: spells,
      subcategoryFn: () => {
        const schools = ['Abjuration','Conjuration','Divination','Enchantment','Evocation','Illusion','Necromancy','Transmutation','Universal'];
        return schools.map(s => ({ key: `sp-${s}`, label: s, filterFn: item => (item.school || '').toLowerCase() === s.toLowerCase() }));
      },
      renderCard: renderSpellCard,
    },
    {
      key: 'skills', label: 'Skills', icon: '\u{1F3AF}', color: '#5ac98a',
      data: skills,
      renderCard: renderSkillCard,
    },
    {
      key: 'equipment', label: 'Equipment', icon: '\u{1F6E1}\uFE0F', color: '#9a9a5a',
      data: equipment,
      subcategoryFn: (items) => {
        const cats = [...new Set(items.map(e => e.category || e.type || 'Misc').filter(Boolean))].sort();
        return cats.map(c => ({ key: `eq-${c}`, label: c, filterFn: item => (item.category || item.type) === c }));
      },
      renderCard: renderEquipmentCard,
    },
    {
      key: 'weapons', label: 'Weapons', icon: '\u{1F5E1}\uFE0F', color: '#c97a5a',
      data: weapons,
      renderCard: renderWeaponCard,
    },
    {
      key: 'gear', label: 'Adventuring Gear', icon: '\u{1F392}', color: '#8a7a6a',
      data: gear,
      subcategoryFn: (items) => {
        const types = [...new Set(items.map(g => g.type || 'Misc').filter(Boolean))].sort();
        return types.map(t => ({ key: `gr-${t}`, label: t, filterFn: item => (item.type || 'Misc') === t }));
      },
      renderCard: renderGearCard,
    },
    {
      key: 'magicItems', label: 'Magic Items', icon: '\u{1F48E}', color: '#b05ac9',
      data: magicItems,
      subcategoryFn: (items) => {
        const slots = [...new Set(items.map(m => m.slot || m.type || 'Misc').filter(Boolean))].sort();
        return slots.map(s => ({ key: `mi-${s}`, label: s, filterFn: item => (item.slot || item.type) === s }));
      },
      renderCard: renderMagicItemCard,
    },
    {
      key: 'conditions', label: 'Conditions', icon: '\u{1F480}', color: '#5a8ac9',
      data: conditions,
      renderCard: renderGenericCard,
    },
    {
      key: 'traits', label: 'Traits', icon: '\u{1F3AD}', color: '#c9a55a',
      data: traits,
      subcategoryFn: (items) => {
        const types = [...new Set(items.map(t => t.type || 'General').filter(Boolean))].sort();
        return types.map(t => ({ key: `tr-${t}`, label: t, filterFn: item => (item.type || 'General') === t }));
      },
      renderCard: renderTraitCard,
    },
    {
      key: 'templates', label: 'Templates', icon: '\u{1F9EC}', color: '#7ac95a',
      data: templates,
      renderCard: renderGenericCard,
    },
    {
      key: 'monsters', label: 'Bestiary', icon: '\u{1F409}', color: '#c95a7b',
      data: monsters,
      subcategoryFn: (items) => {
        const types = [...new Set(items.map(m => m.type || m.creature_type || 'Unknown').filter(Boolean))].sort();
        return types.map(t => ({ key: `mon-${t}`, label: t, filterFn: item => (item.type || item.creature_type) === t }));
      },
      renderCard: renderMonsterCard,
    },
    {
      key: 'npcs', label: 'NPCs', icon: '\u{1F464}', color: '#c9c95a',
      data: npcs,
      renderCard: renderNPCCard,
    },
    {
      key: 'domains', label: 'Domains', icon: '\u{1F54A}\uFE0F', color: '#5a9ac9',
      data: domains,
      subcategoryFn: (items) => {
        const names = items.map(d => d.name).sort();
        return names.map(n => ({ key: `dom-${n}`, label: n, filterFn: item => item.name === n }));
      },
      renderCard: renderDomainCard,
    },
    {
      key: 'bloodlines', label: 'Bloodlines', icon: '\u{1FA78}', color: '#c95a6b',
      data: bloodlines,
      subcategoryFn: (items) => {
        const classes = [...new Set(items.map(b => b.class || 'Sorcerer'))].sort();
        if (classes.length > 1) {
          return classes.flatMap(cls => [
            { key: `bl-sep-${cls}`, label: `── ${cls} ──`, separator: true },
            ...items.filter(b => (b.class || 'Sorcerer') === cls).sort((a,b) => a.name.localeCompare(b.name))
              .map(b => ({ key: `bl-${b.name}`, label: b.name, filterFn: item => item.name === b.name })),
          ]);
        }
        return items.sort((a,b) => a.name.localeCompare(b.name))
          .map(b => ({ key: `bl-${b.name}`, label: b.name, filterFn: item => item.name === b.name }));
      },
      renderCard: renderBloodlineCard,
    },
    {
      key: 'deities', label: 'Deities', icon: '\u{2604}\uFE0F', color: '#e0c05a',
      data: deities,
      subcategoryFn: (items) => {
        const cats = ['Core Twenty', 'Other Deities', 'Empyreal Lords', 'Archdevils', 'Demon Lords', 'Horsemen', 'Eldest', 'Philosophy'];
        return cats.filter(c => items.some(d => d.category === c)).flatMap(c => [
          { key: `dei-sep-${c}`, label: `── ${c} ──`, separator: true },
          ...items.filter(d => d.category === c).sort((a,b) => a.name.localeCompare(b.name))
            .map(d => ({ key: `dei-${d.name}`, label: d.name, filterFn: item => item.name === d.name })),
        ]);
      },
      renderCard: renderDeityCard,
    },
    {
      key: 'schools', label: 'Schools of Magic', icon: '\u{1F4D6}', color: '#9b7bdf',
      data: schoolsOfMagic,
      renderCard: renderSchoolCard,
    },
  ];
}

// ── Card Renderers ──

function renderClassCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item._prestige && <span style={sty.tag('#6b3a8a')}>Prestige</span>}
        {item.hd && <span style={sty.tag('#4a1a1a')}>HD d{item.hd}</span>}
        {item.bab && <span style={sty.tag('#2a4a1a')}>BAB: {item.bab}</span>}
        {item.skills && <span style={sty.tag('#1a2a4a')}>{item.skills}+INT/lvl</span>}
      </div>
      <DetailRow label="Good Saves" value={item.goodSaves} />
      {expanded && <>
        <DetailRow label="Alignment" value={item.alignment} />
        <DetailRow label="Casting" value={item.castingType ? `${item.castingType}${item.castingAbility ? ' (' + item.castingAbility + ')' : ''}` : null} />
        <DetailRow label="Class Skills" value={item.classSkills} />
        <DetailRow label="Requirements" value={item.requirements} />
        {item.description && <div style={{ marginTop: 6, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderArchetypeCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={sty.tag('#2a4a6e')}>{item.class || item.className}</span>
        {item.source && <span style={sty.tag('#3a3a2a')}>{item.source}</span>}
      </div>
      {expanded && <>
        <DetailRow label="Replaced Features" value={item.replacedFeatures} />
        <DetailRow label="New Features" value={item.newFeatures} />
        {item.description && <div style={{ marginTop: 6, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderRaceCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.size && <span style={sty.tag('#2a4a2e')}>{item.size}</span>}
        {item.speed && <span style={sty.tag('#4a3a1a')}>Speed {item.speed}</span>}
        {item.type && <span style={sty.tag('#2a2a4e')}>{item.type}</span>}
      </div>
      <DetailRow label="Ability Bonuses" value={item.bonuses} />
      {expanded && <>
        <DetailRow label="Languages" value={item.languages} />
        <DetailRow label="Racial Traits" value={item.traits} />
        <DetailRow label="Vision" value={item.vision || item.senses} />
        {item.description && <div style={{ marginTop: 6, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderFeatCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {(item.type || item.category) && <span style={sty.tag('#4a2a2e')}>{item.type || item.category}</span>}
        {item.source && <span style={sty.tag('#3a3a2a')}>{item.source}</span>}
      </div>
      <DetailRow label="Prerequisites" value={item.prerequisites} />
      {expanded && <>
        <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.benefit || item.description}</div>
        <DetailRow label="Special" value={item.special} />
      </>}
      {!expanded && item.benefit && (
        <div style={{ marginTop: 2, color: '#8b949e', fontSize: 11 }}>
          {(item.benefit || '').substring(0, 120)}{(item.benefit || '').length > 120 ? '...' : ''}
        </div>
      )}
    </>
  );
}

function renderSpellCard(item, expanded) {
  const desc = item.description || item.desc || '';
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.school && <span style={sty.tag('#2a4a6e')}>{item.school}</span>}
        {item.subschool && <span style={sty.tag('#2a3a5e')}>{item.subschool}</span>}
        {item.level && typeof item.level === 'object'
          ? (expanded
              ? Object.entries(item.level).map(([cls, lvl]) => <span key={cls} style={sty.tag('#4a2a4e')}>{cls} {lvl}</span>)
              : <span style={sty.tag('#4a2a4e')}>Lvl {Math.min(...Object.values(item.level))}-{Math.max(...Object.values(item.level))}</span>
            )
          : item.level !== undefined && <span style={sty.tag('#4a2a4e')}>Level {item.level}</span>
        }
      </div>
      <DetailRow label="Casting Time" value={item.castingTime} />
      <DetailRow label="Range" value={item.range} />
      <DetailRow label="Duration" value={item.duration} />
      <DetailRow label="Save" value={item.savingThrow} />
      {expanded && <>
        <DetailRow label="Components" value={item.components} />
        <DetailRow label="Target" value={item.target} />
        <DetailRow label="Spell Resistance" value={item.sr === true ? 'Yes' : item.sr === false ? 'No' : item.sr} />
      </>}
      <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
        {expanded ? desc : (desc.substring(0, 180) + (desc.length > 180 ? '...' : ''))}
      </div>
    </>
  );
}

function renderSkillCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.ability && <span style={sty.tag('#2a4a2e')}>{item.ability}</span>}
        {item.untrained && <span style={sty.tag('#4a4a2a')}>Untrained OK</span>}
        {item.armorPenalty && <span style={sty.tag('#4a2a2a')}>Armor Penalty</span>}
      </div>
      {expanded && item.description && (
        <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>
      )}
    </>
  );
}

function renderEquipmentCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {(item.category || item.type) && <span style={sty.tag('#3a3a2e')}>{item.category || item.type}</span>}
        {item.priceGP != null && <span style={sty.tag('#4a4a1a')}>{item.priceGP} gp</span>}
        {item.weight && <span style={sty.tag('#2a3a4e')}>{item.weight} lbs</span>}
      </div>
      {expanded && <>
        <DetailRow label="Price" value={item.price} />
        <DetailRow label="Aura" value={item.aura} />
        <DetailRow label="CL" value={item.cl} />
        {item.description && <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderWeaponCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.category && <span style={sty.tag('#4a2a1a')}>{item.category}</span>}
        {item.dmg && <span style={sty.tag('#4a1a1a')}>{item.dmg}</span>}
        {item.crit && <span style={sty.tag('#1a4a4a')}>{item.crit}</span>}
        {item.type && <span style={sty.tag('#2a2a4e')}>{item.type}</span>}
      </div>
      {expanded && <>
        <DetailRow label="Weight" value={item.weight} />
        <DetailRow label="Special" value={item.special} />
      </>}
    </>
  );
}

function renderGearCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.type && <span style={sty.tag('#3a3a2e')}>{item.type}</span>}
        {item.price && <span style={sty.tag('#4a4a1a')}>{item.price}</span>}
        {item.weight && <span style={sty.tag('#2a3a4e')}>{item.weight} lbs</span>}
      </div>
      {expanded && item.description && (
        <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>
      )}
    </>
  );
}

function renderMagicItemCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {(item.slot || item.type) && <span style={sty.tag('#6b2a8a')}>{item.slot || item.type}</span>}
        {item.price && <span style={sty.tag('#4a4a1a')}>{item.price}</span>}
        {item.cl && <span style={sty.tag('#2a4a6e')}>CL {item.cl}</span>}
      </div>
      {expanded && <>
        <DetailRow label="Aura" value={item.aura} />
        {item.description && <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderTraitCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.type && <span style={sty.tag('#4a3a2e')}>{item.type}</span>}
        {item.source && <span style={sty.tag('#3a3a2a')}>{item.source}</span>}
      </div>
      <div style={{ marginTop: 2, color: '#b0a690', lineHeight: 1.4, fontSize: 12 }}>
        {item.benefit || item.description}
      </div>
    </>
  );
}

function renderMonsterCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {(item.type || item.creature_type) && <span style={sty.tag('#4a1a2e')}>{item.type || item.creature_type}</span>}
        {item.cr != null && <span style={sty.tag('#2a4a1a')}>CR {item.cr}</span>}
        {item.alignment && <span style={sty.tag('#2a2a4e')}>{item.alignment}</span>}
        {item.size && <span style={sty.tag('#3a3a2e')}>{item.size}</span>}
      </div>
      {expanded && <>
        <DetailRow label="HP" value={item.hp} />
        <DetailRow label="AC" value={item.ac} />
        <DetailRow label="Speed" value={item.speed} />
        <DetailRow label="Attacks" value={item.attacks || item.melee} />
        <DetailRow label="Special" value={item.special_abilities || item.specialAbilities} />
        {item.description && <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderNPCCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.class && <span style={sty.tag('#2a4a6e')}>{item.class}</span>}
        {item.race && <span style={sty.tag('#2a4a2e')}>{item.race}</span>}
        {item.cr != null && <span style={sty.tag('#4a4a1a')}>CR {item.cr}</span>}
        {item.alignment && <span style={sty.tag('#2a2a4e')}>{item.alignment}</span>}
      </div>
      {expanded && <>
        <DetailRow label="HP" value={item.hp} />
        <DetailRow label="Role" value={item.role} />
        {item.description && <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderDomainCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.deities && item.deities.slice(0, expanded ? 99 : 4).map(d => (
          <span key={d} style={sty.tag('#2a3a5e')}>{d}</span>
        ))}
        {!expanded && item.deities && item.deities.length > 4 && <span style={sty.tag('#1a2a3e')}>+{item.deities.length - 4}</span>}
      </div>
      {item.description && <div style={{ marginTop: 2, color: '#b0a690', fontSize: 11, lineHeight: 1.4 }}>{item.description}</div>}
      {expanded && <>
        {item.grantedPowers && item.grantedPowers.map((p, i) => (
          <div key={i} style={{ marginTop: 6 }}>
            <span style={{ color: '#ffd700', fontSize: 11, fontWeight: 600 }}>{p.name}</span>
            <span style={sty.tag('#2a4a2e')}>{p.type}</span>
            <div style={{ color: '#b0a690', fontSize: 11, marginTop: 2 }}>{p.description}</div>
          </div>
        ))}
        {item.domainSpells && (
          <div style={{ marginTop: 6 }}>
            <span style={sty.label}>Domain Spells: </span>
            <span style={{ color: '#b0a690', fontSize: 11 }}>
              {Object.entries(item.domainSpells).map(([lvl, spell]) => `${lvl}: ${spell}`).join(', ')}
            </span>
          </div>
        )}
        {item.subdomains && item.subdomains.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <span style={sty.label}>Subdomains: </span>
            {item.subdomains.map((sd, i) => (
              <div key={i} style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid #2a3a4e' }}>
                <span style={{ color: '#c9a55a', fontSize: 11, fontWeight: 600 }}>{sd.name}</span>
                {sd.newPower && <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2 }}>Replaces: {sd.replacedPower} → {sd.newPower.name} ({sd.newPower.type})</div>}
              </div>
            ))}
          </div>
        )}
      </>}
    </>
  );
}

function renderBloodlineCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={sty.tag('#4a2a4e')}>{item.class || 'Sorcerer'}</span>
        {item.source && <span style={sty.tag('#3a3a2a')}>{item.source}</span>}
        {item.classSkill && <span style={sty.tag('#2a4a2e')}>+{item.classSkill}</span>}
      </div>
      {item.bloodlineArcana && <div style={{ marginTop: 2, color: '#b0a690', fontSize: 11 }}><span style={sty.label}>Arcana: </span>{item.bloodlineArcana}</div>}
      {expanded && <>
        {item.bloodlinePowers && item.bloodlinePowers.map((p, i) => (
          <div key={i} style={{ marginTop: 6 }}>
            <span style={{ color: '#ffd700', fontSize: 11, fontWeight: 600 }}>{p.name}</span>
            <span style={sty.tag('#2a4a6e')}>Lv {p.level}</span>
            <span style={sty.tag('#2a4a2e')}>{p.type}</span>
            <div style={{ color: '#b0a690', fontSize: 11, marginTop: 2 }}>{p.description}</div>
          </div>
        ))}
        {item.bonusSpells && (
          <div style={{ marginTop: 6 }}>
            <span style={sty.label}>Bonus Spells: </span>
            <span style={{ color: '#b0a690', fontSize: 11 }}>
              {Object.entries(item.bonusSpells).map(([lvl, spell]) => `${lvl}: ${spell}`).join(', ')}
            </span>
          </div>
        )}
        {item.bonusFeats && (
          <div style={{ marginTop: 4 }}>
            <span style={sty.label}>Bonus Feats: </span>
            <span style={{ color: '#b0a690', fontSize: 11 }}>{item.bonusFeats.join(', ')}</span>
          </div>
        )}
      </>}
      {!expanded && item.description && <div style={{ marginTop: 2, color: '#8b949e', fontSize: 11 }}>{item.description}</div>}
    </>
  );
}

function renderDeityCard(item, expanded) {
  const alignColors = {
    LG: '#4a8a4a', NG: '#5a9a5a', CG: '#3a8a6a',
    LN: '#5a5a8a', N: '#6a6a6a', CN: '#7a5a7a',
    LE: '#8a3a3a', NE: '#7a4a3a', CE: '#8a2a2a',
  };
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={sty.tag(alignColors[item.alignment] || '#3a3a3a')}>{item.alignment}</span>
        {item.category && <span style={sty.tag('#2a3a4e')}>{item.category}</span>}
        {item.title && <span style={{ color: '#8b949e', fontSize: 11, fontStyle: 'italic', marginLeft: 4 }}>{item.title}</span>}
      </div>
      {item.portfolios && <div style={{ marginTop: 2 }}><span style={sty.label}>Portfolios: </span><span style={{ color: '#b0a690', fontSize: 11 }}>{item.portfolios.join(', ')}</span></div>}
      <DetailRow label="Favored Weapon" value={item.favoredWeapon} />
      {expanded && <>
        {item.domains && <div style={{ marginTop: 4 }}><span style={sty.label}>Domains: </span>{item.domains.map(d => <span key={d} style={sty.tag('#2a4a6e')}>{d}</span>)}</div>}
        {item.subdomains && <div style={{ marginTop: 4 }}><span style={sty.label}>Subdomains: </span>{item.subdomains.map(s => <span key={s} style={sty.tag('#2a3a5e')}>{s}</span>)}</div>}
        <DetailRow label="Symbol" value={item.symbol} />
        <DetailRow label="Sacred Animal" value={item.sacredAnimal} />
        <DetailRow label="Sacred Colors" value={item.sacredColors} />
        <DetailRow label="Cleric Alignments" value={item.clericAlignments} />
        {item.worshipers && <DetailRow label="Worshipers" value={item.worshipers} />}
        {item.description && <div style={{ marginTop: 6, color: '#b0a690', lineHeight: 1.4, fontSize: 12 }}>{item.description}</div>}
      </>}
    </>
  );
}

function renderSchoolCard(item, expanded) {
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.subschools?.map(s => <span key={s} style={sty.tag('#3a2a6e')}>{s}</span>)}
        {item.specialists?.map(s => <span key={s} style={sty.tag('#2a4a2e')}>{s}</span>)}
      </div>
      {item.description && <div style={{ marginTop: 2, color: '#b0a690', fontSize: 11, lineHeight: 1.4 }}>{item.description}</div>}
      {expanded && <>
        {item.schoolPowers?.map((p, i) => (
          <div key={i} style={{ marginTop: 6 }}>
            <span style={{ color: '#ffd700', fontSize: 11, fontWeight: 600 }}>{p.name}</span>
            <span style={sty.tag('#2a4a6e')}>Lv {p.level}</span>
            <span style={sty.tag('#2a4a2e')}>{p.type}</span>
            <div style={{ color: '#b0a690', fontSize: 11, marginTop: 2 }}>{p.description}</div>
          </div>
        ))}
        {item.bonusSlot && <div style={{ marginTop: 4 }}><span style={sty.label}>Bonus Slot: </span><span style={{ color: '#b0a690', fontSize: 11 }}>{item.bonusSlot}</span></div>}
        {item.opposedRestriction && <div style={{ marginTop: 4 }}><span style={sty.label}>Opposed Schools: </span><span style={{ color: '#b0a690', fontSize: 11 }}>{item.opposedRestriction}</span></div>}
        {item.exampleSpells && (
          <div style={{ marginTop: 4 }}>
            <span style={sty.label}>Iconic Spells: </span>
            {item.exampleSpells.map(s => <span key={s.name} style={sty.tag('#4a2a4e')}>{s.name} (Lv{s.level})</span>)}
          </div>
        )}
      </>}
    </>
  );
}

function renderGenericCard(item, expanded) {
  const desc = item.description || item.benefit || item.desc || '';
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
        {item.type && <span style={sty.tag('#2a2a4e')}>{item.type}</span>}
        {item.source && <span style={sty.tag('#3a3a2a')}>{item.source}</span>}
      </div>
      {desc && (
        <div style={{ marginTop: 2, color: '#b0a690', lineHeight: 1.4 }}>
          {expanded ? desc : (desc.substring(0, 200) + (desc.length > 200 ? '...' : ''))}
        </div>
      )}
    </>
  );
}

// ── Main Compendium Browser ──

export default function CompendiumBrowser() {
  const categories = useMemo(() => buildCategories(), []);

  // State: which category is selected, which subcategory, which tree nodes are open
  const [activeCat, setActiveCat] = useState(null); // category key or null = all
  const [activeSub, setActiveSub] = useState(null); // subcategory key or null = all in category
  const [openNodes, setOpenNodes] = useState({}); // which tree categories are expanded
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const toggleExpand = useCallback((id) => setExpandedId(prev => prev === id ? null : id), []);

  // Build unified search index
  const allItems = useMemo(() => {
    const items = [];
    categories.forEach(cat => {
      cat.data.forEach(item => {
        items.push({ ...item, _catKey: cat.key, _catLabel: cat.label, _catColor: cat.color, _renderCard: cat.renderCard });
      });
    });
    return items;
  }, [categories]);

  // Total stats
  const totalCount = allItems.length;
  const catCounts = useMemo(() => {
    const counts = {};
    categories.forEach(cat => { counts[cat.key] = cat.data.length; });
    return counts;
  }, [categories]);

  // Subcategories for current category
  const currentCat = categories.find(c => c.key === activeCat);
  const subcategories = useMemo(() => {
    if (!currentCat?.subcategoryFn) return null;
    return currentCat.subcategoryFn(currentCat.data);
  }, [currentCat]);

  // Filtered items for display
  const filteredItems = useMemo(() => {
    let pool;

    if (search.trim()) {
      // Global search across everything
      const q = search.toLowerCase();
      pool = allItems.filter(item => {
        const name = (item.name || item.Name || '').toLowerCase();
        const desc = (item.description || item.desc || item.benefit || '').toLowerCase();
        const cls = (item.class || item.className || '').toLowerCase();
        return name.includes(q) || desc.includes(q) || cls.includes(q);
      });
    } else if (activeCat) {
      pool = allItems.filter(item => item._catKey === activeCat);
      if (activeSub && subcategories) {
        const subDef = subcategories.find(s => s.key === activeSub);
        if (subDef?.filterFn) {
          pool = pool.filter(subDef.filterFn);
        }
      }
    } else {
      // No category selected, no search — show nothing (prompt to browse or search)
      return [];
    }

    // Sort alphabetically
    pool.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return pool.slice(0, 150);
  }, [allItems, search, activeCat, activeSub, subcategories]);

  const toggleNode = (key) => {
    setOpenNodes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectCategory = (key) => {
    setActiveCat(key);
    setActiveSub(null);
    setSearch('');
    setExpandedId(null);
  };

  const selectSubcategory = (catKey, subKey) => {
    setActiveCat(catKey);
    setActiveSub(subKey);
    setSearch('');
    setExpandedId(null);
  };

  return (
    <div style={sty.container}>
      {/* Category tree */}
      <div style={sty.treePanel}>
        <div style={{ padding: '4px 12px 8px', color: '#ffd700', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #1e2a3a', marginBottom: 4 }}>
          Compendium
        </div>
        <div style={{ padding: '2px 12px 6px', fontSize: 10, color: '#6b7b8e' }}>
          {totalCount.toLocaleString()} total entries
        </div>

        {categories.map(cat => {
          const isOpen = openNodes[cat.key];
          const isActive = activeCat === cat.key;
          const subs = isOpen && cat.subcategoryFn ? cat.subcategoryFn(cat.data) : null;

          return (
            <div key={cat.key}>
              <div
                style={sty.categoryHeader(isActive && !activeSub)}
                onClick={() => {
                  if (cat.subcategoryFn) {
                    toggleNode(cat.key);
                  }
                  selectCategory(cat.key);
                }}
              >
                <span>{cat.subcategoryFn ? (isOpen ? '\u25BE' : '\u25B8') : '\u25AA'}</span>
                <span>{cat.icon}</span>
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={sty.badge}>{catCounts[cat.key]}</span>
              </div>

              {subs && subs.map(sub => {
                if (sub.separator) {
                  return <div key={sub.key} style={{ padding: '4px 12px 2px 28px', fontSize: 9, color: '#4a5a6e', fontWeight: 600 }}>{sub.label}</div>;
                }
                return (
                  <div
                    key={sub.key}
                    style={sty.subItem(activeSub === sub.key)}
                    onClick={() => selectSubcategory(cat.key, sub.key)}
                  >
                    {sub.label}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Content area */}
      <div style={sty.contentPanel}>
        {/* Search bar */}
        <input
          style={sty.searchBar}
          placeholder="Search all categories by name, description, class..."
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            if (e.target.value.trim()) {
              setActiveCat(null);
              setActiveSub(null);
            }
          }}
        />

        {/* Breadcrumb / context */}
        <div style={{ fontSize: 11, color: '#6b7b8e', marginBottom: 10 }}>
          {search.trim()
            ? `Searching all categories \u2014 ${filteredItems.length} results`
            : activeCat
              ? `${currentCat?.icon || ''} ${currentCat?.label || activeCat}${activeSub ? ' \u203A ' + (subcategories?.find(s => s.key === activeSub)?.label || '') : ''} \u2014 ${filteredItems.length} entries`
              : 'Select a category from the tree, or search across everything.'
          }
          {filteredItems.length >= 150 && <span style={{ color: '#c9a55a' }}> (showing first 150)</span>}
        </div>

        {/* Results grid */}
        {filteredItems.length > 0 ? (
          <div style={sty.grid}>
            {filteredItems.map((item, i) => {
              const id = `${item._catKey}-${item.name || i}`;
              const open = expandedId === id;
              const RenderFn = item._renderCard || renderGenericCard;
              return (
                <div
                  key={id}
                  style={{ ...sty.card, borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
                  onClick={() => toggleExpand(id)}
                >
                  <div style={sty.cardTitle}>
                    {item.name || item.Name || 'Unnamed'}
                    <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
                  </div>
                  {/* Category badge when in global search */}
                  {search.trim() && (
                    <span style={{ ...sty.tag(item._catColor || '#2a2a4e'), marginBottom: 4 }}>{item._catLabel}</span>
                  )}
                  {RenderFn(item, open)}
                </div>
              );
            })}
          </div>
        ) : (
          !search.trim() && !activeCat && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#4a5a6e' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u{1F4DA}'}</div>
              <div style={{ fontSize: 16, color: '#8b949e', marginBottom: 8 }}>Game Compendium</div>
              <div style={{ fontSize: 12, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                Browse the category tree on the left to explore classes, races, spells, feats, equipment, and more.
                Or type in the search bar to find anything across all {totalCount.toLocaleString()} entries.
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
