import React, { useState, useEffect } from 'react';
import CharacterCard from './CharacterCard';
import CharacterCreator from './CharacterCreator';
import CharacterSheet from './CharacterSheet';
import LevelUpWizard from './LevelUpWizard';
import TemplateSelector from './TemplateSelector';
import { getMaxHP, mod, uid } from '../utils/dice';
import { getStartingGold } from '../utils/character';
import templates from '../data/templates.json';
import races from '../data/races.json';
import classesData from '../data/classes.json';
import weapons from '../data/weapons.json';
import equipmentData from '../data/equipment.json';
import spellsData from '../data/spells.json';
import spellSlotData from '../data/spellSlots.json';
import db from '../db/database';
import { parseHeroLabXML, parseStatBlock, exportStatBlock, validateCharacter } from '../services/heroLabService';
import { aiQuickCreate, generateBackstory } from '../services/aiCharacterBuilder';
import gameEvents from '../services/gameEventEngine';
import useIsMobile from '../hooks/useIsMobile';

export default function PartyTab({ party = [], setParty, addLog, updateCharHP }) {
  const isMobile = useIsMobile();
  const [view, setView] = useState('party'); // 'party', 'creator', 'templates', 'import'
  const [feats, setFeats] = useState([]);
  const [sheetCharId, setSheetCharId] = useState(null);
  const [levelUpCharId, setLevelUpCharId] = useState(null);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState('xml'); // 'xml' or 'statblock'
  const [importError, setImportError] = useState(null);
  const [importPreview, setImportPreview] = useState(null);

  // Quick-create via AI
  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState(null);
  const [quickPreview, setQuickPreview] = useState(null);

  useEffect(() => {
    db.feats.toArray().then(f => setFeats(f.length > 0 ? f : [
      {name:'Power Attack'},{name:'Weapon Finesse'},{name:'Improved Initiative'},{name:'Dodge'},
      {name:'Toughness'},{name:'Cleave'},{name:'Combat Reflexes'},{name:'Spell Focus'},{name:'Scribe Scroll'},
    ]));
  }, []);

  const classesMap = {};
  classesData.forEach((c) => {
    classesMap[c.name] = c;
  });

  const handleQuickParty = () => {
    const quickParty = [
      {
        id: uid(), name: 'Ironforge', race: 'Dwarf', class: 'Fighter', alignment: 'Lawful Good', level: 1, xp: 0,
        abilities: { STR: 16, DEX: 12, CON: 15, INT: 10, WIS: 13, CHA: 8 },
        feats: ['Power Attack'], weapons: [{ name: 'Battleaxe', dmg: '1d8' }, { name: 'Light Crossbow', dmg: '1d8' }],
        armor: 'Scale Mail', shield: 'Heavy Shield', conditions: [],
        equipment: [
          { name: 'Battleaxe', equipped: true, type: 'weapon' },
          { name: 'Light Crossbow', equipped: true, type: 'weapon' },
          { name: 'Scale Mail', equipped: true, type: 'armor' },
          { name: 'Heavy Shield', equipped: true, type: 'shield' },
        ],
        inventory: [
          { name: 'Backpack', quantity: 1, type: 'gear' },
          { name: 'Bedroll', quantity: 1, type: 'gear' },
          { name: 'Flint and steel', quantity: 1, type: 'gear' },
          { name: 'Torch', quantity: 3, type: 'gear' },
          { name: 'Trail rations', quantity: 5, type: 'gear' },
          { name: 'Waterskin', quantity: 1, type: 'gear' },
          { name: 'Rope (50 ft.)', quantity: 1, type: 'gear' },
          { name: 'Bolts (10)', quantity: 1, type: 'gear' },
        ],
        maxHP: getMaxHP('Fighter', 1, mod(15), classesMap), currentHP: getMaxHP('Fighter', 1, mod(15), classesMap),
        ac: 10 + Math.min(mod(12), 3) + 5 + 2, // DEX capped by Scale Mail maxDex, + armor + shield
        gold: getStartingGold('Fighter'),
        skillRanks: { Perception: 1, Intimidate: 1, Climb: 1 },
        spellsKnown: [], spellsPrepared: [], spellSlotsUsed: {},
      },
      {
        id: uid(), name: 'Shadowblade', race: 'Elf', class: 'Rogue', alignment: 'Chaotic Good', level: 1, xp: 0,
        abilities: { STR: 10, DEX: 17, CON: 10, INT: 14, WIS: 12, CHA: 13 },
        feats: ['Weapon Finesse'], weapons: [{ name: 'Rapier', dmg: '1d6' }, { name: 'Dagger', dmg: '1d4' }],
        armor: 'Leather', shield: 'None', conditions: [],
        equipment: [
          { name: 'Rapier', equipped: true, type: 'weapon' },
          { name: 'Dagger', equipped: true, type: 'weapon' },
          { name: 'Leather', equipped: true, type: 'armor' },
        ],
        inventory: [
          { name: 'Backpack', quantity: 1, type: 'gear' },
          { name: "Thieves' tools", quantity: 1, type: 'gear' },
          { name: 'Rope (50 ft.)', quantity: 1, type: 'gear' },
          { name: 'Grappling hook', quantity: 1, type: 'gear' },
          { name: 'Torch', quantity: 2, type: 'gear' },
          { name: 'Trail rations', quantity: 5, type: 'gear' },
          { name: 'Waterskin', quantity: 1, type: 'gear' },
        ],
        maxHP: getMaxHP('Rogue', 1, mod(10), classesMap), currentHP: getMaxHP('Rogue', 1, mod(10), classesMap),
        ac: 10 + mod(17) + 2, // leather +2
        gold: getStartingGold('Rogue'),
        skillRanks: { Acrobatics: 1, 'Disable Device': 1, Perception: 1, Stealth: 1, Bluff: 1, Diplomacy: 1, 'Sense Motive': 1, 'Sleight of Hand': 1, Climb: 1, 'Knowledge (local)': 1 },
        spellsKnown: [], spellsPrepared: [], spellSlotsUsed: {},
      },
      {
        id: uid(), name: 'Archmage', race: 'Human', class: 'Wizard', alignment: 'Neutral Good', level: 1, xp: 0,
        abilities: { STR: 8, DEX: 14, CON: 12, INT: 17, WIS: 13, CHA: 10 },
        feats: ['Spell Focus', 'Scribe Scroll', 'Improved Initiative'], weapons: [{ name: 'Quarterstaff', dmg: '1d6' }],
        armor: 'None', shield: 'None', conditions: [],
        equipment: [
          { name: 'Quarterstaff', equipped: true, type: 'weapon' },
        ],
        inventory: [
          { name: 'Backpack', quantity: 1, type: 'gear' },
          { name: 'Spellbook', quantity: 1, type: 'gear' },
          { name: 'Spell component pouch', quantity: 1, type: 'gear' },
          { name: 'Ink and quill', quantity: 1, type: 'gear' },
          { name: 'Parchment', quantity: 10, type: 'gear' },
          { name: 'Bedroll', quantity: 1, type: 'gear' },
          { name: 'Trail rations', quantity: 5, type: 'gear' },
          { name: 'Waterskin', quantity: 1, type: 'gear' },
        ],
        maxHP: getMaxHP('Wizard', 1, mod(12), classesMap), currentHP: getMaxHP('Wizard', 1, mod(12), classesMap),
        ac: 10 + mod(14),
        gold: getStartingGold('Wizard'),
        skillRanks: { Spellcraft: 1, 'Knowledge (arcana)': 1, 'Knowledge (dungeoneering)': 1, Perception: 1, Linguistics: 1, Appraise: 1 },
        spellsKnown: ['Detect Magic', 'Read Magic', 'Light', 'Mage Hand', 'Prestidigitation', 'Magic Missile', 'Sleep', 'Grease', 'Color Spray', 'Mage Armor', 'Shield', 'Burning Hands', 'Identify'],
        spellsPrepared: ['Mage Armor', 'Sleep', 'Color Spray'], spellSlotsUsed: {},
      },
      {
        id: uid(), name: 'Healer', race: 'Human', class: 'Cleric', alignment: 'Neutral Good', level: 1, xp: 0,
        abilities: { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 16, CHA: 12 },
        feats: ['Toughness', 'Combat Casting'], weapons: [{ name: 'Mace, Heavy', dmg: '1d8' }],
        armor: 'Chain Shirt', shield: 'Heavy Shield', conditions: [],
        equipment: [
          { name: 'Mace, Heavy', equipped: true, type: 'weapon' },
          { name: 'Chain Shirt', equipped: true, type: 'armor' },
          { name: 'Heavy Shield', equipped: true, type: 'shield' },
        ],
        inventory: [
          { name: 'Backpack', quantity: 1, type: 'gear' },
          { name: 'Holy symbol (silver)', quantity: 1, type: 'gear' },
          { name: "Healer's kit", quantity: 1, type: 'gear' },
          { name: 'Bedroll', quantity: 1, type: 'gear' },
          { name: 'Trail rations', quantity: 5, type: 'gear' },
          { name: 'Waterskin', quantity: 1, type: 'gear' },
          { name: 'Torch', quantity: 3, type: 'gear' },
        ],
        maxHP: getMaxHP('Cleric', 1, mod(14), classesMap) + 1, // +1 from Toughness
        currentHP: getMaxHP('Cleric', 1, mod(14), classesMap) + 1,
        ac: 10 + Math.min(mod(10), 4) + 4 + 2, // chain shirt + heavy shield
        gold: getStartingGold('Cleric'),
        skillRanks: { Heal: 1, 'Knowledge (religion)': 1, Spellcraft: 1, Diplomacy: 1, Perception: 1 },
        spellsKnown: ['Detect Magic', 'Guidance', 'Light', 'Create Water', 'Resistance', 'Stabilize', 'Bless', 'Cure Light Wounds', 'Shield of Faith', 'Command', 'Protection from Evil', 'Detect Evil'],
        spellsPrepared: ['Bless', 'Cure Light Wounds', 'Shield of Faith'], spellSlotsUsed: {},
        domains: ['Good', 'Healing'],
      },
    ];
    setParty(quickParty);
    setView('party');
    addLog?.('Quick party assembled!', 'info');
  };

  const handleRemoveCharacter = (id) => {
    const char = party.find((c) => c.id === id);
    setParty(party.filter((c) => c.id !== id));
    addLog?.(`${char.name} has left the party.`, 'system');
  };

  const handleHeal = (id, amount) => {
    const char = party.find((c) => c.id === id);
    if (char) {
      const delta = Math.min(amount, char.maxHP - char.currentHP);
      if (delta > 0) updateCharHP?.(id, delta);
    }
  };

  const handleDamage = (id, amount) => {
    updateCharHP?.(id, -amount);
  };

  const handleLevelUp = (id) => {
    // Open the LevelUpWizard instead of auto-leveling
    setLevelUpCharId(id);
  };

  const handleLevelUpComplete = (updatedChar) => {
    // Fire game event engine for level-up cascades
    const levelResult = gameEvents.onLevelUp({ character: updatedChar, newLevel: updatedChar.level });

    // Apply any character updates from the engine (HP increase, etc.)
    const finalChar = { ...updatedChar, ...levelResult.characterUpdates };

    setParty(prev => prev.map(c => c.id === finalChar.id ? finalChar : c));

    // Log all level-up events (HP gain, feat grants, ability score increases, etc.)
    gameEvents.eventsToLog(levelResult.events).forEach(e => addLog?.(e.text, e.type));

    setLevelUpCharId(null);
  };

  const handleAddCharacter = (char) => {
    // Ensure new characters have the expanded fields
    const fullChar = {
      ...char,
      gold: char.gold ?? getStartingGold(char.class),
      skillRanks: char.skillRanks || {},
      inventory: char.inventory || [],
      spellsKnown: char.spellsKnown || [],
      spellsPrepared: char.spellsPrepared || [],
      spellSlotsUsed: char.spellSlotsUsed || {},
      equipped: char.equipped || {},
      conditions: char.conditions || [],
      notes: char.notes || '',
    };
    setParty([...party, fullChar]);
    setView('party');
    addLog?.(`${fullChar.name} joined the party!`, 'event');
  };

  const handleUpdateCharacter = (updatedChar) => {
    setParty(prev => prev.map(c => c.id === updatedChar.id ? updatedChar : c));
  };

  // AI Quick-Create handler
  const handleQuickCreate = async () => {
    if (!quickPrompt.trim()) return;
    setQuickLoading(true);
    setQuickError(null);
    setQuickPreview(null);
    try {
      const char = await aiQuickCreate(quickPrompt.trim());
      setQuickPreview(char);
    } catch (err) {
      setQuickError(err.message);
    } finally {
      setQuickLoading(false);
    }
  };

  const handleConfirmQuickCreate = () => {
    if (!quickPreview) return;
    handleAddCharacter(quickPreview);
    setQuickPrompt('');
    setQuickPreview(null);
    setQuickError(null);
    setView('party');
  };

  // Generate backstory for a character that doesn't have one
  const handleGenerateBackstory = async (charId) => {
    const char = party.find(c => c.id === charId);
    if (!char) return;
    addLog?.(`Generating backstory for ${char.name}...`, 'system');
    const backstory = await generateBackstory(char);
    if (backstory) {
      setParty(prev => prev.map(c => c.id === charId ? { ...c, backstory } : c));
      addLog?.(`Backstory generated for ${char.name}.`, 'success');
    } else {
      addLog?.('Could not generate backstory. Check your API key in Settings.', 'error');
    }
  };

  const styles = {
    container: { padding: isMobile ? '12px' : '16px', overflowY: 'auto', height: '100%' },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
    title: { color: '#ffd700', fontSize: isMobile ? '16px' : '18px', fontWeight: 'bold' },
    buttonRow: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' },
    button: { padding: isMobile ? '10px 8px' : '10px 12px', backgroundColor: '#3a3a6e', border: '1px solid #ffd700', color: '#ffd700', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', minHeight: '40px' },
    grid: { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' },
    empty: { textAlign: 'center', padding: isMobile ? '20px' : '40px', color: '#666' },
  };

  if (view === 'creator') {
    return (
      <CharacterCreator
        onComplete={handleAddCharacter} onCancel={() => setView('party')}
        races={races} classes={classesData} weapons={weapons}
        armorList={equipmentData.armor} shields={equipmentData.shields} feats={feats}
      />
    );
  }

  if (view === 'templates') {
    return (
      <TemplateSelector
        onSelect={handleAddCharacter} onCancel={() => setView('party')}
        templates={templates} races={races} classesMap={classesMap}
        armorList={equipmentData.armor} shields={equipmentData.shields} weapons={weapons}
      />
    );
  }

  if (view === 'import') {
    const handleParseImport = () => {
      setImportError(null);
      setImportPreview(null);
      try {
        let parsed;
        if (importFormat === 'xml') {
          const chars = parseHeroLabXML(importText);
          parsed = chars.length > 0 ? chars : null;
        } else {
          const char = parseStatBlock(importText);
          parsed = char ? [char] : null;
        }
        if (!parsed || parsed.length === 0) {
          setImportError('Could not parse any characters from the input. Check the format and try again.');
          return;
        }
        const validated = parsed.map(c => validateCharacter(c));
        setImportPreview(validated);
      } catch (e) {
        setImportError(`Parse error: ${e.message}`);
      }
    };

    const handleConfirmImport = () => {
      if (!importPreview) return;
      importPreview.forEach(char => {
        setParty(prev => [...prev, char]);
        addLog?.(`Imported ${char.name} (${char.race} ${char.class} ${char.level})`, 'success');
      });
      setImportText('');
      setImportPreview(null);
      setView('party');
    };

    return (
      <div style={{ padding: '16px', backgroundColor: '#1a1a2e', minHeight: '100%', color: '#d4c5a9', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ fontSize: '18px', color: '#ffd700', fontWeight: 'bold' }}>Import Character</div>
          <button style={styles.button} onClick={() => { setView('party'); setImportPreview(null); setImportError(null); }}>Cancel</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button style={{ ...styles.button, ...(importFormat === 'xml' ? { backgroundColor: '#ffd700', color: '#1a1a2e' } : {}) }}
            onClick={() => setImportFormat('xml')}>Hero Lab XML</button>
          <button style={{ ...styles.button, ...(importFormat === 'statblock' ? { backgroundColor: '#ffd700', color: '#1a1a2e' } : {}) }}
            onClick={() => setImportFormat('statblock')}>Stat Block (Text)</button>
        </div>

        <div style={{ fontSize: '11px', color: '#8b949e', marginBottom: '8px' }}>
          {importFormat === 'xml'
            ? 'Paste Hero Lab XML export below. Supports <character> elements with ability scores, skills, feats, equipment.'
            : 'Paste a PF1e stat block (d20pfsrd format). Include DEFENSE, OFFENSE, and STATISTICS sections.'}
        </div>

        <textarea
          style={{ width: '100%', height: '250px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '4px', padding: '8px', fontSize: '12px', fontFamily: 'monospace', resize: 'vertical' }}
          value={importText}
          onChange={e => setImportText(e.target.value)}
          placeholder={importFormat === 'xml' ? '<document>\n  <public>\n    <character name="...">\n      ...\n    </character>\n  </public>\n</document>' : 'Character Name CR X\nRace Class Level\n...\nDEFENSE\nAC 18, touch 12, flat-footed 16\nhp 45 (5d10+15)\nFort +7, Ref +3, Will +1\n...\nSTATISTICS\nStr 18, Dex 14, Con 16, Int 10, Wis 12, Cha 8'}
        />

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button style={{ ...styles.button, backgroundColor: '#2d5016', borderColor: '#7fff00' }} onClick={handleParseImport} disabled={!importText.trim()}>Parse</button>
        </div>

        {importError && (
          <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#2d0000', border: '1px solid #ff6b6b', borderRadius: '4px', color: '#ff6b6b', fontSize: '12px' }}>{importError}</div>
        )}

        {importPreview && importPreview.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '14px', color: '#ffd700', marginBottom: '8px' }}>Preview ({importPreview.length} character{importPreview.length > 1 ? 's' : ''})</div>
            {importPreview.map((c, i) => (
              <div key={i} style={{ backgroundColor: '#2a2a4e', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', padding: '10px', marginBottom: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffd700' }}>{c.name}</div>
                <div style={{ fontSize: '12px', color: '#8b949e' }}>{c.race} {c.class} {c.level} | {c.alignment}</div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px' }}>
                  <span>STR {c.abilities?.STR}</span><span>DEX {c.abilities?.DEX}</span><span>CON {c.abilities?.CON}</span>
                  <span>INT {c.abilities?.INT}</span><span>WIS {c.abilities?.WIS}</span><span>CHA {c.abilities?.CHA}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>HP: {c.maxHP} | AC: {c.ac} | Fort +{c.saves?.fort} Ref +{c.saves?.ref} Will +{c.saves?.will}</div>
                {c.feats?.length > 0 && <div style={{ fontSize: '10px', color: '#8b949e', marginTop: '4px' }}>Feats: {c.feats.join(', ')}</div>}
              </div>
            ))}
            <button style={{ ...styles.button, backgroundColor: '#ffd700', color: '#1a1a2e', fontWeight: 'bold', marginTop: '8px' }} onClick={handleConfirmImport}>
              Add {importPreview.length} Character{importPreview.length > 1 ? 's' : ''} to Party
            </button>
          </div>
        )}
      </div>
    );
  }

  const sheetChar = sheetCharId ? party.find(c => c.id === sheetCharId) : null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>Party ({party.length}/6)</div>
      </div>

      <div style={styles.buttonRow}>
        <button style={styles.button} onClick={() => setView('templates')}>Templates</button>
        <button style={styles.button} onClick={handleQuickParty}>Quick Party</button>
        <button style={styles.button} onClick={() => setView('creator')}>Create Custom</button>
        <button style={{ ...styles.button, borderColor: '#7b68ee', color: '#7b68ee' }} onClick={() => setView('import')}>Import (Hero Lab / Stat Block)</button>
        {party.length > 0 && (
          <button style={{ ...styles.button, borderColor: '#51cf66', color: '#51cf66' }} onClick={() => {
            const blocks = party.map(c => exportStatBlock(c)).join('\n\n' + '='.repeat(60) + '\n\n');
            navigator.clipboard?.writeText(blocks).then(() => addLog?.('Party stat blocks copied to clipboard', 'system'));
          }}>Export Stat Blocks</button>
        )}
      </div>

      {/* AI Quick Create */}
      <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#1e1e3a', border: '1px solid rgba(147,130,220,0.4)', borderRadius: '6px' }}>
        <div style={{ fontSize: '13px', color: '#9382dc', fontWeight: 'bold', marginBottom: '8px' }}>AI Quick Create</div>
        <div style={{ display: 'flex', gap: '8px', flexDirection: isMobile ? 'column' : 'row' }}>
          <input
            type="text"
            value={quickPrompt}
            onChange={e => setQuickPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !quickLoading && handleQuickCreate()}
            placeholder='e.g. "I am a dwarf ranger who fights with a crossbow at level 2"'
            style={{ flex: 1, padding: '10px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '4px', fontSize: '13px', minHeight: isMobile ? '44px' : 'auto' }}
            disabled={quickLoading}
          />
          <button
            style={{ ...styles.button, backgroundColor: quickLoading ? '#333' : '#2d1f5e', borderColor: '#9382dc', color: '#9382dc', minWidth: isMobile ? '100%' : '90px', opacity: quickLoading ? 0.6 : 1 }}
            onClick={handleQuickCreate}
            disabled={quickLoading || !quickPrompt.trim()}
          >
            {quickLoading ? 'Creating...' : 'Generate'}
          </button>
        </div>
        {quickError && (
          <div style={{ marginTop: '8px', padding: '6px 10px', backgroundColor: '#2d0000', border: '1px solid #ff6b6b', borderRadius: '4px', color: '#ff6b6b', fontSize: '12px' }}>{quickError}</div>
        )}
        {quickPreview && (
          <div style={{ marginTop: '10px', backgroundColor: '#2a2a4e', border: '1px solid rgba(255,215,0,0.4)', borderRadius: '6px', padding: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#ffd700' }}>{quickPreview.name}</div>
                <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '2px' }}>
                  {quickPreview.race} {quickPreview.class} {quickPreview.level} | {quickPreview.alignment}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={{ ...styles.button, backgroundColor: '#ffd700', color: '#1a1a2e', fontWeight: 'bold', fontSize: '11px', padding: '6px 12px' }} onClick={handleConfirmQuickCreate}>Add to Party</button>
                <button style={{ ...styles.button, fontSize: '11px', padding: '6px 12px' }} onClick={() => setQuickPreview(null)}>Dismiss</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '11px', color: '#c4b998' }}>
              <span>STR {quickPreview.abilities?.STR}</span><span>DEX {quickPreview.abilities?.DEX}</span><span>CON {quickPreview.abilities?.CON}</span>
              <span>INT {quickPreview.abilities?.INT}</span><span>WIS {quickPreview.abilities?.WIS}</span><span>CHA {quickPreview.abilities?.CHA}</span>
            </div>
            <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>
              HP: {quickPreview.maxHP} | AC: {quickPreview.ac} | Feats: {(quickPreview.feats || []).join(', ') || 'None'}
            </div>
            {quickPreview.appearance && (
              <div style={{ fontSize: '11px', color: '#a0926b', marginTop: '6px', fontStyle: 'italic' }}>{quickPreview.appearance}</div>
            )}
            {quickPreview.backstory && (
              <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '6px', maxHeight: '120px', overflowY: 'auto', lineHeight: '1.5' }}>{quickPreview.backstory}</div>
            )}
          </div>
        )}
      </div>

      {party.length === 0 ? (
        <div style={styles.empty}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>No party members yet</div>
          <div style={{ fontSize: '12px', color: '#555' }}>Use templates, quick party, or create custom characters</div>
        </div>
      ) : (
        <div style={styles.grid}>
          {party.map((char) => (
            <CharacterCard
              key={char.id} char={char}
              onRemove={handleRemoveCharacter}
              onHeal={handleHeal}
              onDamage={handleDamage}
              onLevelUp={handleLevelUp}
              onOpenSheet={() => setSheetCharId(char.id)}
              onGenerateBackstory={handleGenerateBackstory}
              classesMap={classesMap}
            />
          ))}
        </div>
      )}

      {/* Character Sheet Modal */}
      {sheetChar && (
        <CharacterSheet
          char={sheetChar}
          onUpdate={handleUpdateCharacter}
          onClose={() => setSheetCharId(null)}
          classesMap={classesMap}
          spellsData={spellsData}
          spellSlotData={spellSlotData}
          armorList={equipmentData.armor}
          shieldsList={equipmentData.shields}
          weaponsList={weapons}
        />
      )}

      {/* Level Up Wizard Modal */}
      {levelUpCharId && party.find(c => c.id === levelUpCharId) && (
        <LevelUpWizard
          char={party.find(c => c.id === levelUpCharId)}
          onComplete={handleLevelUpComplete}
          onCancel={() => setLevelUpCharId(null)}
          classesMap={classesMap}
          spellSlotData={spellSlotData}
        />
      )}
    </div>
  );
}
