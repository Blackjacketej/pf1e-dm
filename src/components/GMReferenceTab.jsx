import React, { useState, useMemo } from 'react';
import BestiaryTab from './BestiaryTab';
import MythicTab from './MythicTab';
import GMMapPinEditor from './GMMapPinEditor';
import classesData from '../data/classes.json';
import featsData from '../data/feats.json';
import spellsData from '../data/spells.json';
import equipmentData from '../data/equipment.json';
import weaponsData from '../data/weapons.json';
import conditionsData from '../data/conditions.json';
import skillsData from '../data/skills.json';
import racesData from '../data/races.json';
import prestigeClassesData from '../data/prestigeClasses.json';

const SECTIONS = [
  { key: 'map-pins', label: 'Map Pins', icon: '\u{1F4CD}' },
  { key: 'bestiary', label: 'Bestiary', icon: '\u{1F409}' },
  { key: 'spells', label: 'Spells', icon: '\u2728' },
  { key: 'feats', label: 'Feats', icon: '\u{1F4AA}' },
  { key: 'classes', label: 'Classes', icon: '\u2694\uFE0F' },
  { key: 'races', label: 'Races', icon: '\u{1F9DD}' },
  { key: 'equipment', label: 'Equipment', icon: '\u{1F6E1}\uFE0F' },
  { key: 'conditions', label: 'Conditions', icon: '\u{1F480}' },
  { key: 'skills', label: 'Skills', icon: '\u{1F3AF}' },
  { key: 'mythic', label: 'Mythic GME', icon: '\u{1F52E}' },
];

const sty = {
  container: { display: 'flex', height: '100%' },
  sidebar: {
    width: 180, flexShrink: 0, backgroundColor: '#0d1117', borderRight: '1px solid #30363d',
    overflowY: 'auto', padding: '8px 0',
  },
  sidebarBtn: (active) => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px',
    background: active ? '#1a1a2e' : 'transparent',
    borderLeft: active ? '3px solid #ffd700' : '3px solid transparent',
    color: active ? '#ffd700' : '#8b949e',
    border: 'none', borderRight: 'none', borderTop: 'none', borderBottom: 'none',
    borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: active ? '#ffd700' : 'transparent',
    cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400, textAlign: 'left',
  }),
  content: { flex: 1, overflow: 'auto', padding: 16 },
  search: {
    width: '100%', maxWidth: 400, padding: '8px 12px', marginBottom: 12,
    background: '#0d1117', border: '1px solid #30363d', borderRadius: 4,
    color: '#e0d6c8', fontSize: 13,
  },
  card: {
    background: '#16213e', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 6,
    padding: 12, marginBottom: 8, fontSize: 12, color: '#d4c5a9',
  },
  cardTitle: { color: '#ffd700', fontWeight: 700, fontSize: 14, marginBottom: 4 },
  tag: (color) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10,
    background: color || '#2a2a4e', color: '#e0d6c8', marginRight: 4, marginBottom: 2,
  }),
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 8 },
  label: { color: '#8b949e', fontSize: 10, textTransform: 'uppercase' },
};

// Shared select style for filter/sort dropdowns
const selectSty = {
  padding: '6px 8px', background: '#0d1117', border: '1px solid #30363d',
  borderRadius: 4, color: '#e0d6c8', fontSize: 12, cursor: 'pointer',
};

// ── Searchable list helper ──
// sortOptions: [{ label, value, fn }]  — fn(a,b) comparator
// filterOptions: [{ key, label, options: [{ label, value }], filterFn(item, value) }]
function SearchableCards({ items, renderCard, placeholder = 'Search...', sortOptions, filterOptions }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(sortOptions?.[0]?.value || 'alpha');
  const [filters, setFilters] = useState({});
  const [expandedId, setExpandedId] = useState(null);

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  const filtered = useMemo(() => {
    let result = [...items];

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(item => {
        const name = (item.name || item.Name || '').toLowerCase();
        const desc = (item.description || item.desc || item.benefit || '').toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }

    // Apply dropdown filters
    if (filterOptions) {
      filterOptions.forEach(fo => {
        const val = filters[fo.key];
        if (val && val !== 'all' && fo.filterFn) {
          result = result.filter(item => fo.filterFn(item, val));
        }
      });
    }

    // Sort
    const sortOpt = sortOptions?.find(s => s.value === sortKey);
    if (sortOpt?.fn) {
      result.sort(sortOpt.fn);
    } else {
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return result.slice(0, 100);
  }, [items, search, sortKey, filters, sortOptions, filterOptions]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        <input
          style={{ ...sty.search, flex: 1, minWidth: 180, marginBottom: 0 }}
          placeholder={placeholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {filterOptions?.map(fo => (
          <select key={fo.key} style={selectSty}
            value={filters[fo.key] || 'all'}
            onChange={e => setFilters(prev => ({ ...prev, [fo.key]: e.target.value }))}>
            {fo.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {sortOptions && (
          <select style={selectSty} value={sortKey}
            onChange={e => setSortKey(e.target.value)}>
            {sortOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
      </div>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>
        Showing {filtered.length} of {items.length} entries
      </div>
      <div style={sty.grid}>
        {filtered.map((item, i) => renderCard(item, i, expandedId, toggleExpand))}
      </div>
    </>
  );
}

// Helper: render a labeled detail row
const DetailRow = ({ label, value }) => {
  if (value === undefined || value === null || value === '' || value === false) return null;
  const display = typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')
    : Array.isArray(value) ? value.join(', ') : String(value);
  return <div style={{ marginTop: 2 }}><span style={sty.label}>{label}: </span>{display}</div>;
};

// ── Section renderers ──

const SPELL_SCHOOLS = ['abjuration','conjuration','divination','enchantment','evocation','illusion','necromancy','transmutation','universal'];
const SPELL_CLASSES = ['alchemist','antipaladin','bard','bloodrager','cleric','druid','inquisitor','magus','oracle','paladin','psychic','ranger','shaman','skald','sorcerer','sorcerer/wizard','summoner','warpriest','witch','wizard'];
const FEAT_TYPES = ['Combat','Critical','General','Grit','Item Creation','Metamagic','Performance','Style','Teamwork'];
const EQUIP_CATEGORIES = [{ label: 'All Categories', value: 'all' },{ label: 'Melee Weapons', value: 'melee' },{ label: 'Ranged Weapons', value: 'ranged' },{ label: 'Ammo', value: 'ammo' },{ label: 'Armor', value: 'armor' },{ label: 'Gear', value: 'gear' },{ label: 'Potions', value: 'potion' },{ label: 'Rings', value: 'ring' },{ label: 'Rods', value: 'rod' },{ label: 'Scrolls', value: 'scroll' },{ label: 'Staves', value: 'staff' },{ label: 'Wands', value: 'wand' },{ label: 'Magic Weapons', value: 'magic_weapon' }];

function SpellsSection() {
  const spells = useMemo(() => {
    if (Array.isArray(spellsData)) return spellsData;
    if (spellsData && typeof spellsData === 'object') return Object.values(spellsData).flat();
    return [];
  }, []);

  return (
    <SearchableCards
      items={spells}
      placeholder="Search spells by name or description..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Z-A', value: 'alpha-desc', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
        { label: 'Lowest Level', value: 'level-asc', fn: (a, b) => {
          const aMin = a.level && typeof a.level === 'object' ? Math.min(...Object.values(a.level)) : 99;
          const bMin = b.level && typeof b.level === 'object' ? Math.min(...Object.values(b.level)) : 99;
          return aMin - bMin || (a.name || '').localeCompare(b.name || '');
        }},
        { label: 'Highest Level', value: 'level-desc', fn: (a, b) => {
          const aMax = a.level && typeof a.level === 'object' ? Math.max(...Object.values(a.level)) : 0;
          const bMax = b.level && typeof b.level === 'object' ? Math.max(...Object.values(b.level)) : 0;
          return bMax - aMax || (a.name || '').localeCompare(b.name || '');
        }},
        { label: 'School', value: 'school', fn: (a, b) => (a.school || '').localeCompare(b.school || '') || (a.name || '').localeCompare(b.name || '') },
      ]}
      filterOptions={[
        { key: 'school', label: 'School', options: [{ label: 'All Schools', value: 'all' }, ...SPELL_SCHOOLS.map(s => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s }))],
          filterFn: (item, val) => (item.school || '').toLowerCase().startsWith(val.toLowerCase()) },
        { key: 'class', label: 'Class', options: [{ label: 'All Classes', value: 'all' }, ...SPELL_CLASSES.map(c => ({ label: c.charAt(0).toUpperCase() + c.slice(1), value: c }))],
          filterFn: (item, val) => item.level && typeof item.level === 'object' && (val in item.level || Object.keys(item.level).some(k => k.toLowerCase() === val.toLowerCase())) },
      ]}
      renderCard={(spell, i, expandedId, toggleExpand) => {
        const id = spell.name || i;
        const open = expandedId === id;
        const desc = spell.description || spell.desc || '';
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{spell.name || spell.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {spell.school && <span style={sty.tag('#2a4a6e')}>{spell.school}</span>}
              {spell.subschool && <span style={sty.tag('#2a3a5e')}>{spell.subschool}</span>}
              {spell.descriptor && <span style={sty.tag('#3a2a4e')}>{spell.descriptor}</span>}
              {spell.level && typeof spell.level === 'object'
                ? (open
                    ? Object.entries(spell.level).map(([cls, lvl]) => (
                        <span key={cls} style={sty.tag('#4a2a4e')}>{cls} {lvl}</span>
                      ))
                    : <span style={sty.tag('#4a2a4e')}>Lvl {Math.min(...Object.values(spell.level))}-{Math.max(...Object.values(spell.level))}</span>
                  )
                : spell.level !== undefined && <span style={sty.tag('#4a2a4e')}>Level {spell.level}</span>
              }
              {spell.source && open && <span style={sty.tag('#3a3a2a')}>{spell.source}</span>}
            </div>
            <DetailRow label="Casting Time" value={spell.castingTime} />
            <DetailRow label="Components" value={spell.components} />
            <DetailRow label="Range" value={spell.range} />
            {open && <DetailRow label="Target" value={spell.target} />}
            <DetailRow label="Duration" value={spell.duration} />
            <DetailRow label="Save" value={spell.savingThrow} />
            {open && <DetailRow label="Spell Resistance" value={spell.sr === true ? 'Yes' : spell.sr === false ? 'No' : spell.sr} />}
            <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
              {open ? desc : (desc.substring(0, 200) + (desc.length > 200 ? '...' : ''))}
            </div>
          </div>
        );
      }}
    />
  );
}

function FeatsSection() {
  const feats = useMemo(() => {
    if (Array.isArray(featsData)) return featsData;
    return Object.values(featsData).flat();
  }, []);

  return (
    <SearchableCards
      items={feats}
      placeholder="Search feats by name or benefit..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Z-A', value: 'alpha-desc', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
        { label: 'Type', value: 'type', fn: (a, b) => (a.type || 'zzz').localeCompare(b.type || 'zzz') || (a.name || '').localeCompare(b.name || '') },
      ]}
      filterOptions={[
        { key: 'type', label: 'Type', options: [{ label: 'All Types', value: 'all' }, ...FEAT_TYPES.map(t => ({ label: t, value: t }))],
          filterFn: (item, val) => (item.type || '') === val },
      ]}
      renderCard={(feat, i, expandedId, toggleExpand) => {
        const id = feat.name || i;
        const open = expandedId === id;
        const desc = feat.benefit || feat.description || '';
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{feat.name || feat.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {feat.type && <span style={sty.tag('#4a3a1a')}>{feat.type}</span>}
              {feat.category && <span style={sty.tag('#2a4a3a')}>{feat.category}</span>}
              {feat.source && open && <span style={sty.tag('#3a3a2a')}>{feat.source}</span>}
            </div>
            <DetailRow label="Prerequisites" value={feat.prerequisites} />
            <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
              {open ? desc : (desc.substring(0, 250) + (desc.length > 250 ? '...' : ''))}
            </div>
          </div>
        );
      }}
    />
  );
}

function ClassesSection() {
  const classes = useMemo(() => {
    const base = Array.isArray(classesData) ? classesData : Object.values(classesData);
    const prestige = Array.isArray(prestigeClassesData) ? prestigeClassesData : Object.values(prestigeClassesData);
    return [...base, ...prestige.map(p => ({ ...p, _prestige: true }))];
  }, []);

  return (
    <SearchableCards
      items={classes}
      placeholder="Search classes..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Z-A', value: 'alpha-desc', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
        { label: 'Hit Die', value: 'hd', fn: (a, b) => (b.hd || 0) - (a.hd || 0) || (a.name || '').localeCompare(b.name || '') },
      ]}
      filterOptions={[
        { key: 'type', label: 'Type', options: [{ label: 'All Classes', value: 'all' }, { label: 'Base', value: 'base' }, { label: 'Prestige', value: 'prestige' }],
          filterFn: (item, val) => val === 'prestige' ? !!item._prestige : !item._prestige },
        { key: 'casting', label: 'Casting', options: [{ label: 'All', value: 'all' }, { label: 'Casters', value: 'caster' }, { label: 'Non-Casters', value: 'noncaster' }],
          filterFn: (item, val) => val === 'caster' ? !!(item.castingType || item.spellcasting) : !(item.castingType || item.spellcasting) },
      ]}
      renderCard={(cls, i, expandedId, toggleExpand) => {
        const id = cls.name || i;
        const open = expandedId === id;
        const desc = cls.description || '';
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{cls.name || cls.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {cls._prestige && <span style={sty.tag('#6b3a8a')}>Prestige</span>}
              {cls.hd && <span style={sty.tag('#4a1a1a')}>HD: d{cls.hd}</span>}
              {cls.bab && <span style={sty.tag('#2a4a1a')}>BAB: {cls.bab}</span>}
              {cls.skills && <span style={sty.tag('#1a2a4a')}>{cls.skills} + INT skills/lvl</span>}
              {cls.levels && <span style={sty.tag('#2a3a4e')}>{cls.levels} levels</span>}
              {cls.alignment && open && <span style={sty.tag('#3a3a2a')}>{cls.alignment}</span>}
            </div>
            <DetailRow label="Good Saves" value={cls.goodSaves} />
            {cls.saves && open && (
              <DetailRow label="Saves" value={Object.entries(cls.saves).map(([k, v]) => `${k}: ${v}`).join(', ')} />
            )}
            {open && <>
              {cls.requirements && <DetailRow label="Requirements" value={cls.requirements} />}
              <DetailRow label="Alignment" value={cls.alignment} />
              <DetailRow label="Casting" value={cls.castingType || cls.spellcasting
                ? `${cls.castingType || cls.spellcasting}${cls.castingAbility ? ' (' + cls.castingAbility + ')' : ''}`
                : null} />
              <DetailRow label="Proficiencies" value={cls.proficiencies} />
              <DetailRow label="Class Skills" value={cls.classSkills} />

              {/* Class progression table */}
              {cls.classFeatures && Array.isArray(cls.classFeatures) && (
                <div style={{ marginTop: 6, overflowX: 'auto' }}>
                  <span style={sty.label}>Class Progression:</span>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4, fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #30363d' }}>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: '#8b949e', fontWeight: 600 }}>Lvl</th>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: '#8b949e', fontWeight: 600 }}>Feature</th>
                        <th style={{ padding: '3px 6px', textAlign: 'left', color: '#8b949e', fontWeight: 600 }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cls.classFeatures.map((f, j) => (
                        <tr key={j} style={{ borderBottom: '1px solid #1a1a2e' }}>
                          <td style={{ padding: '3px 6px', color: '#ffd700', fontWeight: 600, whiteSpace: 'nowrap' }}>{f.level || '—'}</td>
                          <td style={{ padding: '3px 6px', color: '#d4c5a9', fontWeight: 600, whiteSpace: 'nowrap' }}>{f.name || f.Name || (typeof f === 'string' ? f : '')}</td>
                          <td style={{ padding: '3px 6px', color: '#b0a690' }}>{f.description || f.desc || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Alternate features list (some classes use this format) */}
              {cls.features && Array.isArray(cls.features) && !cls.classFeatures && (
                <div style={{ marginTop: 6 }}>
                  <span style={sty.label}>Features:</span>
                  {cls.features.map((f, j) => (
                    <div key={j} style={{ marginTop: 2, color: '#b0a690', fontSize: 11 }}>
                      {typeof f === 'string' ? f : <><strong style={{ color: '#d4c5a9' }}>{f.name}: </strong>{f.description || ''}</>}
                    </div>
                  ))}
                </div>
              )}
            </>}
            <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
              {open ? desc : (desc.substring(0, 200) + (desc.length > 200 ? '...' : ''))}
            </div>
          </div>
        );
      }}
    />
  );
}

function RacesSection() {
  const races = useMemo(() => {
    if (Array.isArray(racesData)) return racesData;
    return Object.values(racesData);
  }, []);

  return (
    <SearchableCards
      items={races}
      placeholder="Search races..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Z-A', value: 'alpha-desc', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
        { label: 'Speed', value: 'speed', fn: (a, b) => (b.speed || 0) - (a.speed || 0) },
      ]}
      filterOptions={[
        { key: 'size', label: 'Size', options: [{ label: 'All Sizes', value: 'all' }, ...['Small','Medium','Large'].map(s => ({ label: s, value: s }))],
          filterFn: (item, val) => (item.size || '').toLowerCase() === val.toLowerCase() },
      ]}
      renderCard={(race, i, expandedId, toggleExpand) => {
        const id = race.name || i;
        const open = expandedId === id;
        const traits = race.traits && Array.isArray(race.traits) ? race.traits : [];
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{race.name || race.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {race.size && <span style={sty.tag('#2a4a4e')}>{race.size}</span>}
              {race.speed && <span style={sty.tag('#4a4a2a')}>Speed: {race.speed} ft</span>}
              {race.type && <span style={sty.tag('#3a2a4a')}>{race.type}</span>}
            </div>
            <DetailRow label="Ability Bonuses" value={race.bonuses} />
            <DetailRow label="Languages" value={race.languages} />
            {traits.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <span style={sty.label}>Racial Traits:</span>
                {(open ? traits : traits.slice(0, 3)).map((t, j) => (
                  <div key={j} style={{ color: '#b0a690', fontSize: 11, marginTop: 2 }}>
                    {typeof t === 'string' ? t : <><strong style={{ color: '#d4c5a9' }}>{t.name}: </strong>{open ? (t.description || t.desc || '') : (t.description || t.desc || '').substring(0, 80) + ((t.description || t.desc || '').length > 80 ? '...' : '')}</>}
                  </div>
                ))}
                {!open && traits.length > 3 && <div style={{ color: '#8b949e', fontSize: 10, marginTop: 2 }}>+{traits.length - 3} more traits...</div>}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

function EquipmentSection() {
  const items = useMemo(() => {
    const all = [];
    const addItems = (data, source) => {
      if (Array.isArray(data)) {
        data.forEach(d => all.push({ ...d, _source: source }));
      } else if (data && typeof data === 'object') {
        Object.entries(data).forEach(([cat, arr]) => {
          if (Array.isArray(arr)) arr.forEach(d => all.push({ ...d, _source: source, _category: cat }));
        });
      }
    };
    addItems(weaponsData, 'Weapons');
    addItems(equipmentData, 'Equipment');
    return all;
  }, []);

  return (
    <SearchableCards
      items={items}
      placeholder="Search weapons, armor, gear..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Z-A', value: 'alpha-desc', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
        { label: 'Price (Low)', value: 'price-asc', fn: (a, b) => (a.priceGP || a.price || 0) - (b.priceGP || b.price || 0) },
        { label: 'Price (High)', value: 'price-desc', fn: (a, b) => (b.priceGP || b.price || 0) - (a.priceGP || a.price || 0) },
      ]}
      filterOptions={[
        { key: 'category', label: 'Category', options: EQUIP_CATEGORIES,
          filterFn: (item, val) => {
            if (val === 'melee' || val === 'ranged' || val === 'ammo') return item._source === 'Weapons' && item.category === val;
            if (val === 'magic_weapon') return item._source === 'Equipment' && item.category === 'weapon';
            return (item.category || item._category || '').toLowerCase() === val.toLowerCase();
          }},
        { key: 'proficiency', label: 'Proficiency', options: [{ label: 'All', value: 'all' }, { label: 'Simple', value: 'simple' }, { label: 'Martial', value: 'martial' }],
          filterFn: (item, val) => item.proficiency === val },
      ]}
      renderCard={(item, i, expandedId, toggleExpand) => {
        const id = `${item.name || item.Name}-${i}`;
        const open = expandedId === id;
        const desc = item.description || item.desc || '';
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{item.name || item.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {item._source && <span style={sty.tag('#2a3a4e')}>{item._source}</span>}
              {item._category && <span style={sty.tag('#4a3a2a')}>{item._category}</span>}
              {item.category && !item._category && <span style={sty.tag('#4a3a2a')}>{item.category}</span>}
              {item.proficiency && <span style={sty.tag('#2a4a2a')}>{item.proficiency}</span>}
              {item.type && <span style={sty.tag('#2a4a2a')}>Type: {item.type}</span>}
              {item.source && open && <span style={sty.tag('#3a3a2a')}>{item.source}</span>}
            </div>
            <DetailRow label="Price" value={item.price || item.cost || item.priceGP ? `${item.price || item.cost || (item.priceGP + ' gp')}` : null} />
            <DetailRow label="Weight" value={item.weight} />
            <DetailRow label="Damage" value={item.dmg || item.damage} />
            <DetailRow label="Critical" value={item.crit || item.critical} />
            <DetailRow label="Range" value={item.range ? `${item.range} ft` : null} />
            {item.reach && <DetailRow label="Reach" value="Yes" />}
            {item.twoHand && <DetailRow label="Two-Handed" value={item.twoHand} />}
            <DetailRow label="Slot" value={item.slot} />
            <DetailRow label="Armor Bonus" value={item.armorBonus !== undefined ? `+${item.armorBonus}` : null} />
            <DetailRow label="Max Dex" value={item.maxDex !== undefined ? `+${item.maxDex}` : null} />
            {open && <>
              <DetailRow label="Aura" value={item.aura} />
              <DetailRow label="Caster Level" value={item.cl} />
            </>}
            {desc && (
              <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
                {open ? desc : (desc.substring(0, 150) + (desc.length > 150 ? '...' : ''))}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

function ConditionsSection() {
  const conditions = useMemo(() => {
    if (Array.isArray(conditionsData)) return conditionsData;
    return Object.entries(conditionsData).map(([name, data]) =>
      typeof data === 'string' ? { name, description: data } : { name, ...data }
    );
  }, []);

  return (
    <SearchableCards
      items={conditions}
      placeholder="Search conditions..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Z-A', value: 'alpha-desc', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
      ]}
      renderCard={(cond, i, expandedId, toggleExpand) => {
        const id = cond.name || i;
        const open = expandedId === id;
        const desc = cond.description || cond.effect || cond.desc || '';
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{cond.name || cond.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            {cond.source && open && <DetailRow label="Source" value={cond.source} />}
            <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
              {open ? desc : (desc.substring(0, 300) + (desc.length > 300 ? '...' : ''))}
            </div>
          </div>
        );
      }}
    />
  );
}

function SkillsSection() {
  const skills = useMemo(() => {
    if (Array.isArray(skillsData)) return skillsData;
    return Object.entries(skillsData).map(([name, data]) =>
      typeof data === 'string' ? { name, description: data } : { name, ...data }
    );
  }, []);

  return (
    <SearchableCards
      items={skills}
      placeholder="Search skills..."
      sortOptions={[
        { label: 'A-Z', value: 'alpha', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
        { label: 'Ability', value: 'ability', fn: (a, b) => (a.ability || '').localeCompare(b.ability || '') || (a.name || '').localeCompare(b.name || '') },
      ]}
      filterOptions={[
        { key: 'ability', label: 'Ability', options: [{ label: 'All Abilities', value: 'all' }, ...['STR','DEX','CON','INT','WIS','CHA'].map(a => ({ label: a, value: a }))],
          filterFn: (item, val) => (item.ability || '').toUpperCase() === val },
        { key: 'trained', label: 'Training', options: [{ label: 'All', value: 'all' }, { label: 'Trained Only', value: 'trained' }, { label: 'Untrained OK', value: 'untrained' }],
          filterFn: (item, val) => val === 'trained' ? item.untrained === false : item.untrained !== false },
      ]}
      renderCard={(skill, i, expandedId, toggleExpand) => {
        const id = skill.name || i;
        const open = expandedId === id;
        const desc = skill.description || skill.desc || '';
        return (
          <div key={id} style={{ ...sty.card, cursor: 'pointer', borderColor: open ? 'rgba(255,215,0,0.4)' : undefined }}
            onClick={() => toggleExpand(id)}>
            <div style={sty.cardTitle}>{skill.name || skill.Name}
              <span style={{ float: 'right', fontSize: 10, color: '#8b949e' }}>{open ? '\u25B2' : '\u25BC'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 4 }}>
              {skill.ability && <span style={sty.tag('#2a4a4e')}>{skill.ability}</span>}
              {skill.untrained === false && <span style={sty.tag('#4a2a2a')}>Trained Only</span>}
              {skill.armorPenalty && <span style={sty.tag('#4a4a2a')}>ACP</span>}
            </div>
            {open && <>
              <DetailRow label="Check" value={skill.check} />
              <DetailRow label="Action" value={skill.action} />
              <DetailRow label="Retry" value={skill.retry} />
              <DetailRow label="Special" value={skill.special} />
              <DetailRow label="Synergy" value={skill.synergy} />
              <DetailRow label="Class Skill For" value={skill.classSkills} />
              {skill.dcTable && Array.isArray(skill.dcTable) && (
                <div style={{ marginTop: 4 }}>
                  <span style={sty.label}>DC Table:</span>
                  {skill.dcTable.map((row, j) => (
                    <div key={j} style={{ color: '#b0a690', fontSize: 11, marginTop: 1 }}>
                      DC {row.dc || row.DC}: {row.task || row.description || row.desc || ''}
                    </div>
                  ))}
                </div>
              )}
            </>}
            <div style={{ marginTop: 4, color: '#b0a690', lineHeight: 1.4 }}>
              {open ? desc : (desc.substring(0, 250) + (desc.length > 250 ? '...' : ''))}
            </div>
          </div>
        );
      }}
    />
  );
}

// ── Main GM Reference Tab ──

export default function GMReferenceTab({ party, addLog, setCombat, openCombatPanel, worldState, setWorldState }) {
  const [section, setSection] = useState('map-pins');

  // Map Pins section needs full height without padding
  const isFullHeight = section === 'map-pins';

  return (
    <div style={sty.container}>
      {/* Left sidebar — section navigation */}
      <div style={sty.sidebar}>
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            style={sty.sidebarBtn(section === s.key)}
          >
            <span style={{ fontSize: 16 }}>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Right content area */}
      <div style={{ ...sty.content, padding: isFullHeight ? 0 : 16 }}>
        {section === 'map-pins' && (
          <GMMapPinEditor worldState={worldState} setWorldState={setWorldState} addLog={addLog} />
        )}
        {section === 'bestiary' && (
          <BestiaryTab party={party} addLog={addLog} setCombat={setCombat} setTab={() => openCombatPanel?.()} />
        )}
        {section === 'spells' && <SpellsSection />}
        {section === 'feats' && <FeatsSection />}
        {section === 'classes' && <ClassesSection />}
        {section === 'races' && <RacesSection />}
        {section === 'equipment' && <EquipmentSection />}
        {section === 'conditions' && <ConditionsSection />}
        {section === 'skills' && <SkillsSection />}
        {section === 'mythic' && (
          <MythicTab addLog={addLog} worldState={worldState} setWorldState={setWorldState} party={party} />
        )}
      </div>
    </div>
  );
}
