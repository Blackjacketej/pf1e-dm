import React, { useState } from 'react';
import worldService from '../services/worldService';
import downtimeService from '../services/downtimeService';
import advancedService from '../services/advancedService';
import * as dmTools from '../services/dmToolsService';
import gameEvents from '../services/gameEventEngine';
import { SettlementMap, ParchmentFrame, Divider, TerrainIcon, HexMap, MapLegend } from './MapAssets';

const styles = {
  container: { backgroundColor: '#1a1a2e', border: '2px solid #ffd700', borderRadius: '8px', padding: '16px', color: '#d4c5a9', height: '100%', overflowY: 'auto' },
  section: { marginBottom: '16px', backgroundColor: '#2a2a4e', border: '1px solid rgba(255, 215, 0, 0.3)', borderRadius: '4px', padding: '12px' },
  title: { color: '#ffd700', fontWeight: 'bold', fontSize: '14px', marginBottom: '12px', textTransform: 'uppercase' },
  subtitle: { color: '#ffd700', fontSize: '12px', marginBottom: '8px' },
  btn: { padding: '6px 12px', border: '1px solid #ffd700', borderRadius: '4px', backgroundColor: '#2a2a4e', color: '#ffd700', cursor: 'pointer', fontSize: '12px', marginRight: '8px', marginBottom: '6px' },
  btnActive: { backgroundColor: '#ffd700', color: '#1a1a2e' },
  select: { padding: '4px 8px', border: '1px solid #ffd700', borderRadius: '4px', backgroundColor: '#1a1a2e', color: '#ffd700', fontSize: '12px', marginRight: '8px' },
  result: { backgroundColor: '#1a1a2e', border: '1px solid rgba(255, 215, 0, 0.2)', borderRadius: '4px', padding: '8px', marginTop: '8px', fontSize: '12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
  card: { backgroundColor: '#1a1a2e', border: '1px solid rgba(255, 215, 0, 0.2)', borderRadius: '4px', padding: '8px', fontSize: '11px' },
  label: { color: '#8b949e', fontSize: '10px', textTransform: 'uppercase' },
  value: { color: '#d4c5a9', fontWeight: 'bold' },
  danger: { color: '#ff6b6b' },
  success: { color: '#51cf66' },
  warning: { color: '#ffd700' },
  nav: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' },
};

// Panels tagged override:true are manual GM tools hidden behind the GM Override toggle.
// Non-override panels are always visible as core gameplay dashboards.
const PANELS = [
  // ── Always-visible gameplay panels ──
  { id: 'partyProgress', label: 'Party Progress', icon: '📈' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
  { id: 'xpCalc', label: 'XP Calculator', icon: '📊' },
  { id: 'encounterBuilder', label: 'Encounter Builder', icon: '🎯' },
  { id: 'npcAttitudes', label: 'NPC Attitudes', icon: '😊' },
  { id: 'kingdom', label: 'Kingdom', icon: '🏰' },
  { id: 'downtime', label: 'Downtime', icon: '🏠' },
  { id: 'contacts', label: 'Contacts', icon: '📇' },
  { id: 'crafting', label: 'Crafting', icon: '🔨' },
  { id: 'massCombat', label: 'Mass Combat', icon: '⚔️' },
  { id: 'investigations', label: 'Investigations', icon: '🔍' },
  { id: 'verbalDuels', label: 'Verbal Duels', icon: '🗣️' },
  { id: 'skillChallenges', label: 'Skill Challenges', icon: '🎯' },
  // ── GM Override panels (manual tools, hidden by default) ──
  { id: 'weather', label: 'Weather', icon: '🌤️', override: true },
  { id: 'encounters', label: 'Encounters', icon: '⚔️', override: true },
  { id: 'traps', label: 'Traps', icon: '🪤', override: true },
  { id: 'haunts', label: 'Haunts', icon: '👻', override: true },
  { id: 'hazards', label: 'Hazards', icon: '☠️', override: true },
  { id: 'treasure', label: 'Treasure', icon: '💰', override: true },
  { id: 'chase', label: 'Chase', icon: '🏃', override: true },
  { id: 'npc', label: 'NPC Gen', icon: '🧑', override: true },
  { id: 'settlementGen', label: 'Settlements', icon: '🏘️', override: true },
  { id: 'campaignPacing', label: 'Campaign', icon: '📜', override: true },
  { id: 'planes', label: 'Planes', icon: '🌌', override: true },
  { id: 'orgs', label: 'Organizations', icon: '🤝', override: true },
  { id: 'retraining', label: 'Retraining', icon: '📖', override: true },
  { id: 'reputation', label: 'Reputation', icon: '🏅', override: true },
  { id: 'honor', label: 'Honor', icon: '🛡️', override: true },
  { id: 'sanity', label: 'Sanity', icon: '🧠', override: true },
  { id: 'gambling', label: 'Gambling', icon: '🎲', override: true },
  { id: 'disasters', label: 'Disasters', icon: '🌋', override: true },
  { id: 'tradeRoutes', label: 'Trade', icon: '🚢', override: true },
  { id: 'espionage', label: 'Espionage', icon: '🕵️', override: true },
  { id: 'alignment', label: 'Alignment', icon: '⚖️', override: true },
  { id: 'lineage', label: 'Lineage', icon: '🧬', override: true },
  { id: 'retirement', label: 'Retirement', icon: '🏡', override: true },
];

export default function WorldTab({ campaign, party, setParty, addLog, worldState, setWorldState, setCombat, setTab }) {
  const [activePanel, setActivePanel] = useState('partyProgress');
  const [showGMOverrides, setShowGMOverrides] = useState(false);
  const [weatherResult, setWeatherResult] = useState(null);
  const [encounterResults, setEncounterResults] = useState(null);
  const [treasureResult, setTreasureResult] = useState(null);
  const [chaseState, setChaseState] = useState(null);
  const [npcResult, setNpcResult] = useState(null);
  const [trapResult, setTrapResult] = useState(null);
  const [hauntResult, setHauntResult] = useState(null);

  // Form state (local UI only)
  const [climate, setClimate] = useState('temperate');
  const [season, setSeason] = useState('summer');
  const [terrain, setTerrain] = useState('forest');
  const [treasureCR, setTreasureCR] = useState(3);
  const [npcSeed, setNpcSeed] = useState(1);

  // Log state (UI-only, ephemeral)
  const [downtimeLog, setDowntimeLog] = useState([]);
  const [kingdomLog, setKingdomLog] = useState([]);
  const [orgLog, setOrgLog] = useState([]);
  const [massCombatLog, setMassCombatLog] = useState([]);
  const [reputationLog, setReputationLog] = useState([]);
  const [honorLog, setHonorLog] = useState([]);
  const [contactLog, setContactLog] = useState([]);
  const [investigationLog, setInvestigationLog] = useState([]);
  const [sanityLog, setSanityLog] = useState([]);
  const [craftingLog, setCraftingLog] = useState([]);
  const [gamblingLog, setGamblingLog] = useState([]);
  const [disasterLog, setDisasterLog] = useState([]);
  const [tradeLog, setTradeLog] = useState([]);
  const [espionageLog, setEspionageLog] = useState([]);
  const [alignmentLog, setAlignmentLog] = useState([]);
  const [downtimeDays, setDowntimeDays] = useState(1);

  // Form inputs (local UI only)
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [newKingdomName, setNewKingdomName] = useState('');
  const [newCityName, setNewCityName] = useState('');
  const [selectedKTerrain, setSelectedKTerrain] = useState('plains');
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgType, setNewOrgType] = useState('mercantile');
  const [newArmyName, setNewArmyName] = useState('');
  const [newArmyACR, setNewArmyACR] = useState(1);
  const [newArmySize, setNewArmySize] = useState('Medium');
  const [newArmyType, setNewArmyType] = useState('infantry');
  const [newContactName, setNewContactName] = useState('');
  const [newContactType, setNewContactType] = useState('sage');
  const [newContactTrust, setNewContactTrust] = useState(1);
  const [selectedGame, setSelectedGame] = useState('dice');
  const [betAmount, setBetAmount] = useState(10);
  const [craftItemName, setCraftItemName] = useState('');
  const [craftItemPrice, setCraftItemPrice] = useState(1000);
  const [craftItemCL, setCraftItemCL] = useState(3);
  const [retrainResults, setRetrainResults] = useState(null);

  // DM Tools state
  const [encounterBuilderState, setEncounterBuilderState] = useState({ difficulty: 'Average', crList: [], result: null });
  const [xpCalcState, setXpCalcState] = useState({ track: worldState?.dmPreferences?.xpTrack || 'medium', selectedChar: null });
  const [npcAttitudeState, setNpcAttitudeState] = useState({ trackedNPCs: [], selectedNPC: null });
  const [settlementState, setSettlementState] = useState({ generated: null, sizeType: null });
  const [campaignPacingState, setCampaignPacingState] = useState({ framework: null, hook: null, twist: null });
  const [verbalDuelState, setVerbalDuelState] = useState(null);
  const [skillChallengeState, setSkillChallengeState] = useState(null);
  const [planesState, setPlanesState] = useState({ selected: null, allPlanes: [] });
  const [calendarState, setCalendarState] = useState({ currentMonth: 0 });

  // NPC Attitudes form state (component-level to avoid hook violations)
  const [npcName, setNPCName] = useState('');
  const [npcAttitude, setNPCAttitude] = useState('indifferent');
  const [npcLevel, setNPCLevel] = useState(1);
  const [npcWis, setNPCWis] = useState(10);

  // Helper to update worldState
  const updateWorld = (key, value) => {
    setWorldState(prev => ({
      ...prev,
      [key]: typeof value === 'function' ? value(prev[key]) : value
    }));
  };

  // Extract values from worldState
  const downtimeCapital = worldState.downtimeCapital || { goods: 0, influence: 0, labor: 0, magic: 0 };
  const ownedBuildings = worldState.ownedBuildings || [];
  const kingdom = worldState.kingdom || null;
  const organizations = worldState.organizations || [];
  const armies = worldState.armies || [];
  const partyFame = worldState.fame || 0;
  const partyInfamy = worldState.infamy || 0;
  const partyHonor = worldState.honor || null;
  const contacts = worldState.contacts || [];
  const investigationClues = worldState.foundClues || [];
  const sanityCurrent = worldState.sanity || {};
  const tradeRoutes = worldState.tradeRoutes || [];
  const caravans = worldState.caravans || [];
  const spyNetworks = worldState.spyNetworks || [];
  const alignmentInfractions = worldState.alignmentInfractions || {};
  const retiredCharacters = worldState.retiredCharacters || [];

  // ── Weather Panel ──
  const renderWeather = () => {
    const handleGenerate = () => {
      const daySeed = campaign?.currentDay || Math.floor(Math.random() * 365);
      const w = worldService.generateWeather(climate, season, daySeed);
      setWeatherResult(w);
      updateWorld('currentWeather', w);
      addLog?.(`Weather: ${w.description} (${w.temperatureF}°F)`, 'info');
    };

    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <select style={styles.select} value={climate} onChange={e => setClimate(e.target.value)}>
            <option value="cold">Cold/Arctic</option>
            <option value="temperate">Temperate</option>
            <option value="tropical">Tropical</option>
            <option value="desert">Desert</option>
          </select>
          <select style={styles.select} value={season} onChange={e => setSeason(e.target.value)}>
            <option value="spring">Spring</option>
            <option value="summer">Summer</option>
            <option value="fall">Fall</option>
            <option value="winter">Winter</option>
          </select>
          <button style={styles.btn} onClick={handleGenerate}>Generate Weather</button>
        </div>

        {weatherResult && (
          <div style={styles.result}>
            <div style={{ fontSize: '16px', marginBottom: '8px', color: '#ffd700' }}>{weatherResult.description}</div>
            <div style={styles.grid}>
              <div style={styles.card}>
                <div style={styles.label}>Temperature</div>
                <div style={styles.value}>{weatherResult.temperatureF}°F / {weatherResult.temperatureC}°C</div>
              </div>
              <div style={styles.card}>
                <div style={styles.label}>Wind</div>
                <div style={styles.value}>{weatherResult.wind?.name || 'Calm'} ({weatherResult.wind?.mph || 0} mph)</div>
              </div>
              {weatherResult.precipitation && (
                <div style={styles.card}>
                  <div style={styles.label}>Precipitation</div>
                  <div style={styles.value}>{weatherResult.precipitation.name}</div>
                  {weatherResult.precipitation.perceptionPenalty && (
                    <div style={styles.danger}>Perception {weatherResult.precipitation.perceptionPenalty}</div>
                  )}
                </div>
              )}
              {weatherResult.tempEffect && weatherResult.tempEffect.range !== 'comfortable' && (
                <div style={styles.card}>
                  <div style={styles.label}>Temperature Hazard</div>
                  <div style={styles.danger}>{weatherResult.tempEffect.effect}</div>
                  {weatherResult.tempEffect.fortDC && (
                    <div style={{ color: '#8b949e' }}>Fort DC {weatherResult.tempEffect.fortDC}, every {weatherResult.tempEffect.frequency}</div>
                  )}
                </div>
              )}
            </div>
            {weatherResult.wind?.rangedPenalty < 0 && (
              <div style={{ ...styles.danger, marginTop: '8px', fontSize: '11px' }}>
                Ranged attacks: {weatherResult.wind.rangedPenalty} penalty | Fly checks: {weatherResult.wind.flyPenalty}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Random Encounters Panel ──
  const renderEncounters = () => {
    const handleCheck = () => {
      const results = worldService.dailyEncounterChecks(terrain);
      setEncounterResults(results);
      results.forEach(r => {
        if (r.encountered) {
          addLog?.(`Encounter at ${r.timeOfDay}: ${r.count}x ${r.creature} (CR ${r.cr})`, 'danger');
        }
      });
    };

    return (
      <div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <select style={styles.select} value={terrain} onChange={e => setTerrain(e.target.value)}>
            {Object.keys(worldService.checkRandomEncounter('forest', 'dawn').terrain ? {} : {}).length === 0 && (
              <>
                <option value="forest">Forest</option>
                <option value="plains">Plains</option>
                <option value="hills">Hills</option>
                <option value="mountain">Mountains</option>
                <option value="swamp">Swamp</option>
                <option value="underground">Underground</option>
                <option value="urban">Urban</option>
                <option value="desert">Desert</option>
                <option value="aquatic">Aquatic</option>
              </>
            )}
          </select>
          <button style={styles.btn} onClick={handleCheck}>Roll Daily Encounters (4 checks)</button>
        </div>

        {encounterResults && (
          <div>
            {encounterResults.map((r, i) => (
              <div key={i} style={{ ...styles.result, borderLeftColor: r.encountered ? '#ff6b6b' : '#51cf66', borderLeftWidth: '3px', borderLeftStyle: 'solid', marginBottom: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={styles.warning}>{r.timeOfDay?.toUpperCase()}</span>
                  <span style={{ color: '#8b949e' }}>Roll: {r.roll}/{r.chance}%</span>
                </div>
                {r.encountered ? (
                  <div style={{ marginTop: '4px' }}>
                    <span style={styles.danger}>{r.count}x {r.creature}</span>
                    <span style={{ color: '#8b949e', marginLeft: '8px' }}>CR {r.cr}</span>
                  </div>
                ) : (
                  <div style={{ color: '#51cf66', marginTop: '4px' }}>No encounter</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Traps Panel ──
  const renderTraps = () => {
    const traps = worldService.getTrapTemplates();
    const [selectedTrap, setSelected] = useState(null);

    return (
      <div>
        <div style={styles.subtitle}>Sample Traps (click to view details)</div>
        <div style={styles.grid}>
          {traps.map((trap, i) => (
            <div
              key={i}
              style={{ ...styles.card, cursor: 'pointer', borderColor: selectedTrap === i ? '#ffd700' : 'rgba(255,215,0,0.2)' }}
              onClick={() => { setSelected(i); setTrapResult(null); }}
            >
              <div style={styles.warning}>{trap.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={styles.label}>CR {trap.cr}</span>
                <span style={styles.label}>{trap.type}</span>
              </div>
              <div style={{ color: '#8b949e', marginTop: '4px', fontSize: '10px' }}>
                Perception DC {trap.perceptionDC} | Disable DC {trap.disableDC}
              </div>
            </div>
          ))}
        </div>

        {selectedTrap !== null && (
          <div style={{ ...styles.result, marginTop: '12px' }}>
            <div style={styles.warning}>{traps[selectedTrap].name} (CR {traps[selectedTrap].cr})</div>
            <div style={{ color: '#8b949e', marginTop: '4px' }}>
              <div>Type: {traps[selectedTrap].type} | Trigger: {traps[selectedTrap].trigger} | Reset: {traps[selectedTrap].reset}</div>
              <div style={{ marginTop: '4px' }}>Effect: {traps[selectedTrap].effect}</div>
            </div>
            {party?.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <button style={styles.btn} onClick={() => {
                  const pc = party[0];
                  const detect = worldService.detectTrap(traps[selectedTrap], pc);
                  setTrapResult(detect);
                  addLog?.(`${pc.name} ${detect.detected ? 'spots' : 'misses'} the ${traps[selectedTrap].name} (${detect.total} vs DC ${detect.dc})`, detect.detected ? 'success' : 'info');
                }}>
                  Perception Check ({party[0]?.name})
                </button>
              </div>
            )}
            {trapResult && (
              <div style={{ marginTop: '8px', color: trapResult.detected ? '#51cf66' : '#ff6b6b' }}>
                {trapResult.detected ? 'DETECTED!' : 'Not detected.'} Roll: {trapResult.roll}+{trapResult.modifier}={trapResult.total} vs DC {trapResult.dc}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Haunts Panel ──
  const renderHaunts = () => {
    const haunts = worldService.getHauntTemplates();

    return (
      <div>
        <div style={styles.subtitle}>Haunt Templates</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {haunts.map((haunt, i) => (
            <div key={i} style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={styles.warning}>{haunt.name}</span>
                <span style={styles.label}>CR {haunt.cr} | HP {haunt.hp}{haunt.persistent ? ' (persistent)' : ''}</span>
              </div>
              <div style={{ color: '#8b949e', marginTop: '4px', fontSize: '10px' }}>
                Notice DC {haunt.noticeDC} | Area: {haunt.area} | Trigger: {haunt.trigger}
              </div>
              <div style={{ color: '#d4c5a9', marginTop: '4px', fontSize: '11px' }}>Effect: {haunt.effect}</div>
              <div style={{ color: '#51cf66', marginTop: '4px', fontSize: '10px' }}>Destruction: {haunt.destruction}</div>
              {party?.length > 0 && (
                <button style={{ ...styles.btn, marginTop: '6px' }} onClick={() => {
                  const results = worldService.resolveHaunt(haunt, party.filter(p => p.currentHP > 0));
                  setHauntResult({ haunt: haunt.name, results });
                  results.forEach(r => {
                    addLog?.(`${r.target} ${r.saved ? 'resists' : 'is affected by'} ${haunt.name}${r.damage > 0 ? ` (${r.damage} dmg)` : ''}`, r.saved ? 'info' : 'danger');
                  });
                }}>
                  Trigger on Party
                </button>
              )}
            </div>
          ))}
        </div>

        {hauntResult && (
          <div style={{ ...styles.result, marginTop: '12px' }}>
            <div style={styles.warning}>{hauntResult.haunt} triggered!</div>
            {hauntResult.results.map((r, i) => (
              <div key={i} style={{ marginTop: '4px', color: r.saved ? '#51cf66' : '#ff6b6b' }}>
                {r.target}: {r.saved ? 'Saved!' : `${r.damage} damage`}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Hazards Panel (Diseases, Poisons, Curses) ──
  const renderHazards = () => {
    const [subPanel, setSubPanel] = useState('diseases');
    const diseases = worldService.getDiseases();
    const poisons = worldService.getPoisons();
    const curses = worldService.getCurses();
    const hazards = worldService.getEnvironmentalHazards();

    return (
      <div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          {['diseases', 'poisons', 'curses', 'environmental'].map(sub => (
            <button key={sub} style={{ ...styles.btn, ...(subPanel === sub ? styles.btnActive : {}) }} onClick={() => setSubPanel(sub)}>
              {sub.charAt(0).toUpperCase() + sub.slice(1)}
            </button>
          ))}
        </div>

        {subPanel === 'diseases' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {diseases.map((d, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.warning}>{d.name}</div>
                <div style={{ color: '#8b949e', fontSize: '10px' }}>
                  Type: {d.type} | Fort DC {d.fortDC} | Onset: {d.onset} | Freq: {d.frequency}
                </div>
                <div style={{ color: '#ff6b6b', fontSize: '11px', marginTop: '2px' }}>{d.effect}</div>
                <div style={{ color: '#51cf66', fontSize: '10px' }}>Cure: {d.cure}</div>
              </div>
            ))}
          </div>
        )}

        {subPanel === 'poisons' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {poisons.map((p, i) => (
              <div key={i} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={styles.warning}>{p.name}</span>
                  <span style={{ color: '#8b949e', fontSize: '10px' }}>{p.price} gp</span>
                </div>
                <div style={{ color: '#8b949e', fontSize: '10px' }}>
                  Type: {p.type} | Fort DC {p.fortDC} | Freq: {p.frequency}
                </div>
                <div style={{ color: '#ff6b6b', fontSize: '11px', marginTop: '2px' }}>{p.effect}</div>
              </div>
            ))}
          </div>
        )}

        {subPanel === 'curses' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {curses.map((c, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.warning}>{c.name} <span style={{ color: '#8b949e', fontSize: '10px' }}>Remove DC {c.removeDC}</span></div>
                {c.effects.map((e, j) => (
                  <div key={j} style={{ color: '#ff6b6b', fontSize: '11px' }}>- {e}</div>
                ))}
                {c.special && <div style={{ color: '#51cf66', fontSize: '10px', marginTop: '2px' }}>{c.special}</div>}
              </div>
            ))}
          </div>
        )}

        {subPanel === 'environmental' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {hazards.map((h, i) => (
              <div key={i} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={styles.warning}>{h.name}</span>
                  <span style={styles.label}>CR {h.cr}</span>
                </div>
                {h.buryDamage && <div style={{ color: '#ff6b6b', fontSize: '11px' }}>Damage: {h.buryDamage} (Reflex DC {h.reflexDC} half)</div>}
                {h.contactDamage && <div style={{ color: '#ff6b6b', fontSize: '11px' }}>Contact: {h.contactDamage}/round</div>}
                {h.note && <div style={{ color: '#8b949e', fontSize: '10px' }}>{h.note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Treasure Panel ──
  const renderTreasure = () => {
    const handleGenerate = () => {
      const t = worldService.generateTreasure(treasureCR);
      setTreasureResult(t);
      addLog?.(`Treasure generated: ${t.totalValue} gp total value`, 'success');
    };

    return (
      <div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <span style={{ color: '#8b949e', fontSize: '12px' }}>Encounter CR:</span>
          <input
            type="number" min="1" max="20" value={treasureCR}
            onChange={e => setTreasureCR(parseInt(e.target.value) || 1)}
            style={{ ...styles.select, width: '60px' }}
          />
          <button style={styles.btn} onClick={handleGenerate}>Generate Treasure</button>
        </div>

        {treasureResult && (
          <div style={styles.result}>
            <div style={{ fontSize: '14px', color: '#ffd700', marginBottom: '8px' }}>
              Total Value: {treasureResult.totalValue.toLocaleString()} gp
            </div>

            {treasureResult.coins && (
              <div style={styles.card}>
                <div style={styles.subtitle}>Coins</div>
                <div style={{ color: '#d4c5a9' }}>
                  {treasureResult.coins.pp > 0 && `${treasureResult.coins.pp} pp, `}
                  {treasureResult.coins.gp} gp, {treasureResult.coins.sp} sp, {treasureResult.coins.cp} cp
                </div>
              </div>
            )}

            {treasureResult.gems.length > 0 && (
              <div style={{ ...styles.card, marginTop: '6px' }}>
                <div style={styles.subtitle}>Gems</div>
                {treasureResult.gems.map((g, i) => (
                  <div key={i} style={{ color: '#d4c5a9' }}>{g.name} ({g.value} gp)</div>
                ))}
              </div>
            )}

            {treasureResult.artObjects.length > 0 && (
              <div style={{ ...styles.card, marginTop: '6px' }}>
                <div style={styles.subtitle}>Art Objects</div>
                {treasureResult.artObjects.map((a, i) => (
                  <div key={i} style={{ color: '#d4c5a9' }}>{a.name} ({a.value} gp)</div>
                ))}
              </div>
            )}

            {treasureResult.magicItems.length > 0 && (
              <div style={{ ...styles.card, marginTop: '6px' }}>
                <div style={styles.subtitle}>Magic Items</div>
                {treasureResult.magicItems.map((item, i) => (
                  <div key={i} style={{ color: '#c084fc' }}>{item.description}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Chase Scene Panel ──
  const renderChase = () => {
    const handleStartChase = () => {
      const chase = worldService.initializeChase('Party', 'Quarry', terrain, 4);
      setChaseState({ ...chase, log: ['Chase initiated! Gap: 4 positions.'] });
      addLog?.('Chase scene started!', 'action');
    };

    const handleChaseRound = () => {
      if (!chaseState || chaseState.resolved) return;
      const pc = party?.[0];
      const pursuerMod = pc ? Math.floor(((pc.abilities?.DEX || 10) - 10) / 2) + (pc.skillRanks?.Acrobatics || 0) : 5;
      const quarryMod = 5 + Math.floor(chaseState.round / 3);

      const result = worldService.resolveChaseRound(chaseState, pursuerMod, quarryMod);
      const newLog = [...chaseState.log];
      newLog.push(`Round ${result.round}: ${result.obstacle.name} (DC ${result.obstacle.dc})`);
      newLog.push(`  Pursuer: ${result.pursuer.roll} ${result.pursuer.success ? '(pass)' : '(fail)'}${result.pursuer.damage > 0 ? ` - ${result.pursuer.damage} dmg` : ''}`);
      newLog.push(`  Quarry: ${result.quarry.roll} ${result.quarry.success ? '(pass)' : '(fail)'}${result.quarry.damage > 0 ? ` - ${result.quarry.damage} dmg` : ''}`);
      newLog.push(`  Gap: ${result.newGap} (${result.gapChange > 0 ? '+' : ''}${result.gapChange})`);

      if (result.result) {
        newLog.push(`CHASE ENDED: ${result.result.toUpperCase()}`);
        addLog?.(`Chase ended: ${result.result}!`, result.result === 'caught' ? 'success' : 'danger');
      }

      setChaseState(prev => ({
        ...prev,
        gap: result.newGap,
        round: prev.round + 1,
        resolved: result.resolved,
        result: result.result,
        log: newLog,
      }));
    };

    return (
      <div>
        {!chaseState && (
          <div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              <select style={styles.select} value={terrain} onChange={e => setTerrain(e.target.value)}>
                <option value="urban">Urban</option>
                <option value="forest">Forest</option>
                <option value="dungeon">Dungeon</option>
                <option value="mountain">Mountain</option>
                <option value="swamp">Swamp</option>
              </select>
              <button style={styles.btn} onClick={handleStartChase}>Start Chase Scene</button>
            </div>
          </div>
        )}

        {chaseState && (
          <div style={styles.result}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={styles.warning}>Round {chaseState.round} | Gap: {chaseState.gap}</span>
              {!chaseState.resolved && <button style={styles.btn} onClick={handleChaseRound}>Next Round</button>}
              <button style={{ ...styles.btn, borderColor: '#ff6b6b', color: '#ff6b6b' }} onClick={() => setChaseState(null)}>End Chase</button>
            </div>

            <div style={{ display: 'flex', gap: '2px', marginBottom: '8px', alignItems: 'center' }}>
              <span style={{ color: '#51cf66', fontSize: '14px' }}>🏃</span>
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} style={{
                  width: '20px', height: '8px', borderRadius: '2px',
                  backgroundColor: i < chaseState.gap ? 'rgba(255,215,0,0.3)' : '#ffd700',
                }} />
              ))}
              <span style={{ color: '#ff6b6b', fontSize: '14px' }}>🏃</span>
            </div>

            <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '11px', fontFamily: 'monospace' }}>
              {chaseState.log.map((line, i) => (
                <div key={i} style={{ color: line.includes('ENDED') ? '#ffd700' : '#d4c5a9', marginBottom: '2px' }}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── NPC Generator Panel ──
  const renderNPC = () => {
    const handleGenerate = () => {
      const npc = worldService.generateRandomNPC(npcSeed);
      setNpcResult(npc);
      setNpcSeed(prev => prev + 1);
      addLog?.(`NPC generated: ${npc.description}`, 'info');
    };

    return (
      <div>
        <button style={styles.btn} onClick={handleGenerate}>Generate Random NPC</button>

        {npcResult && (
          <div style={{ ...styles.result, marginTop: '12px' }}>
            <div style={{ fontSize: '14px', color: '#ffd700', marginBottom: '8px' }}>{npcResult.description}</div>
            <div style={styles.grid}>
              <div style={styles.card}>
                <div style={styles.label}>Race / Gender</div>
                <div style={styles.value}>{npcResult.race} ({npcResult.gender})</div>
              </div>
              <div style={styles.card}>
                <div style={styles.label}>Occupation</div>
                <div style={styles.value}>{npcResult.occupation}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.label}>Motivation</div>
                <div style={styles.value}>{npcResult.motivation}</div>
              </div>
              <div style={styles.card}>
                <div style={styles.label}>Quirk</div>
                <div style={styles.value}>{npcResult.quirk}</div>
              </div>
            </div>
            <div style={{ ...styles.card, marginTop: '8px' }}>
              <div style={styles.label}>Ability Scores</div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                {Object.entries(npcResult.abilities).map(([ab, val]) => (
                  <span key={ab} style={{ color: '#d4c5a9' }}>{ab}: <strong>{val}</strong></span>
                ))}
              </div>
            </div>
            <div style={{ ...styles.card, marginTop: '8px' }}>
              <div style={styles.label}>Appearance</div>
              <div style={{ color: '#d4c5a9' }}>
                Hair: {npcResult.appearance.hair} | Build: {npcResult.appearance.build}
              </div>
              <div style={{ color: '#d4c5a9' }}>Distinguishing: {npcResult.appearance.distinguishing}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Downtime Panel ──
  const renderDowntime = () => {
    const buildings = downtimeService.getBuildings();
    const rooms = downtimeService.getRooms();
    const teams = downtimeService.getTeams();
    const income = downtimeService.calculateDailyIncome(ownedBuildings);

    const handleEarnCapital = (capType) => {
      const char = party?.[0];
      if (!char) return;
      const skills = downtimeService.getEarnSkills(capType);
      const skill = skills[0] || 'Profession';
      const result = downtimeService.earnCapital(char, capType, skill);
      if (result.success) {
        updateWorld('downtimeCapital', prev => ({ ...prev, [capType]: prev[capType] + result.earned }));
        setDowntimeLog(prev => [result.description, ...prev].slice(0, 20));
        addLog?.(result.description, 'info');
      }
    };

    const handleBuild = (bldg) => {
      const result = downtimeService.startConstruction(bldg.id);
      if (result.success) {
        updateWorld('ownedBuildings', prev => [...prev, { templateId: bldg.id, name: bldg.name, rooms: bldg.rooms, completed: false, daysLeft: result.cost.time }]);
        setDowntimeLog(prev => [result.description, ...prev].slice(0, 20));
        addLog?.(result.description, 'info');
      }
    };

    const handleEvent = () => {
      const result = downtimeService.rollDowntimeEvent();
      setDowntimeLog(prev => [`[Event d100=${result.roll}] ${result.event.name}: ${result.event.effect}`, ...prev].slice(0, 20));
      addLog?.(`Downtime Event: ${result.event.name} — ${result.event.effect}`, result.event.type === 'harmful' ? 'danger' : 'info');
    };

    return (
      <div>
        <div style={{ ...styles.subtitle, marginBottom: '8px' }}>Capital Reserves</div>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {Object.entries(downtimeCapital).map(([type, amt]) => (
            <div key={type} style={styles.card}>
              <span style={styles.label}>{type}</span>
              <div style={{ ...styles.value, fontSize: '16px' }}>{amt}</div>
              <button style={{ ...styles.btn, marginTop: '4px', fontSize: '10px' }} onClick={() => handleEarnCapital(type)}>Earn</button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={styles.btn} onClick={handleEvent}>Roll Downtime Event</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="number" min={1} max={30} value={downtimeDays} onChange={e => setDowntimeDays(Math.max(1, Math.min(30, +e.target.value || 1)))} style={{ ...styles.select, width: '50px' }} />
            <button style={{ ...styles.btn, background: '#2d5016', borderColor: '#51cf66' }} onClick={() => {
              const result = gameEvents.onDowntimeDayFull({ worldState, party, daysToProcess: downtimeDays });
              setWorldState(prev => gameEvents.applyWorldUpdates(prev, result.worldUpdates));
              const logEntries = gameEvents.eventsToLog(result.events);
              logEntries.forEach(e => addLog?.(e.text, e.type));
              setDowntimeLog(prev => [...logEntries.map(e => e.text), ...prev].slice(0, 30));
              addLog?.(`Processed ${downtimeDays} day${downtimeDays > 1 ? 's' : ''} of downtime. Now day ${result.worldUpdates.currentDay || worldState.currentDay}.`, 'system');
            }}>Process {downtimeDays} Day{downtimeDays > 1 ? 's' : ''}</button>
          </div>
        </div>

        {income && (Object.values(income).some(v => v > 0)) && (
          <div style={{ ...styles.result, marginBottom: '12px' }}>
            <span style={styles.label}>Daily Income from Buildings: </span>
            {Object.entries(income).filter(([,v]) => v > 0).map(([k,v]) => `${v} ${k}`).join(', ')}
          </div>
        )}

        <div style={{ ...styles.subtitle, marginBottom: '8px' }}>Buildings ({ownedBuildings.length})</div>
        {ownedBuildings.length > 0 && (
          <div style={{ ...styles.grid, marginBottom: '12px' }}>
            {ownedBuildings.map((b, i) => (
              <div key={i} style={styles.card}>
                <span style={styles.value}>{b.name}</span>
                <div style={{ fontSize: '10px', color: b.completed ? '#51cf66' : '#ffd700' }}>{b.completed ? 'Complete' : `${b.daysLeft} days left`}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ ...styles.subtitle, marginBottom: '8px' }}>Available Buildings</div>
        <div style={styles.grid}>
          {buildings.map(b => (
            <div key={b.id} style={{ ...styles.card, cursor: 'pointer', border: selectedBuilding === b.id ? '1px solid #ffd700' : '1px solid rgba(255,215,0,0.2)' }}
              onClick={() => setSelectedBuilding(selectedBuilding === b.id ? null : b.id)}>
              <div style={styles.value}>{b.name}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>Earns: {b.earn.amount} {b.earn.type}/day</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{b.benefit}</div>
              {selectedBuilding === b.id && (
                <button style={{ ...styles.btn, marginTop: '6px' }} onClick={() => handleBuild(b)}>Build</button>
              )}
            </div>
          ))}
        </div>

        {downtimeLog.length > 0 && (
          <div style={{ ...styles.result, marginTop: '12px', maxHeight: '120px', overflowY: 'auto' }}>
            {downtimeLog.map((l, i) => <div key={i} style={{ marginBottom: '4px', fontSize: '11px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Kingdom Panel ──
  const renderKingdom = () => {
    const terrainTypes = downtimeService.getTerrainTypes();
    const edicts = downtimeService.getEdicts();
    const roles = downtimeService.getLeadershipRoles();
    const cityBuildings = downtimeService.getCityBuildings();

    const handleFoundKingdom = () => {
      if (!newKingdomName.trim()) return;
      const k = downtimeService.createKingdom(newKingdomName.trim());
      k.bp = 50;
      updateWorld('kingdom', k);
      setKingdomLog([`The kingdom of ${k.name} has been founded with 50 BP!`]);
      addLog?.(`Kingdom founded: ${k.name}`, 'info');
    };

    const handleClaimHex = () => {
      if (!kingdom) return;
      const result = downtimeService.claimHex(kingdom, selectedKTerrain);
      if (result.success) {
        updateWorld('kingdom', { ...kingdom });
        setKingdomLog(prev => [result.description, ...prev].slice(0, 30));
        addLog?.(result.description, 'info');
      } else {
        setKingdomLog(prev => [result.error, ...prev].slice(0, 30));
      }
    };

    const handleFoundCity = () => {
      if (!kingdom || !newCityName.trim() || kingdom.hexes.length === 0) return;
      const result = downtimeService.foundCity(kingdom, kingdom.hexes.length - 1, newCityName.trim());
      if (result.success) {
        updateWorld('kingdom', { ...kingdom });
        setKingdomLog(prev => [result.description, ...prev].slice(0, 30));
        addLog?.(result.description, 'info');
        setNewCityName('');
      }
    };

    const handleProcessTurn = () => {
      if (!kingdom) return;
      const result = downtimeService.processKingdomTurn(kingdom);
      updateWorld('kingdom', { ...kingdom });
      const entries = result.phases.map(p => `[${p.phase}] ${p.description}`);
      setKingdomLog(prev => [...entries, ...prev].slice(0, 40));
      entries.forEach(e => addLog?.(e, 'info'));
    };

    const handleSetEdict = (edictType, level) => {
      if (!kingdom) return;
      kingdom.edicts[edictType] = level;
      updateWorld('kingdom', { ...kingdom });
    };

    if (!kingdom) {
      return (
        <div>
          <div style={{ fontSize: '12px', marginBottom: '12px', color: '#8b949e' }}>
            Found a kingdom to manage hexes, cities, edicts, and leadership. Based on the PF1e Ultimate Campaign kingdom building rules.
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input style={{ ...styles.select, flex: 1 }} placeholder="Kingdom name..." value={newKingdomName} onChange={e => setNewKingdomName(e.target.value)} />
            <button style={styles.btn} onClick={handleFoundKingdom}>Found Kingdom</button>
          </div>
        </div>
      );
    }

    const stats = downtimeService.calculateKingdomStats(kingdom);

    return (
      <div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div style={styles.card}><span style={styles.label}>Economy</span><div style={styles.value}>{stats.economy}</div></div>
          <div style={styles.card}><span style={styles.label}>Loyalty</span><div style={styles.value}>{stats.loyalty}</div></div>
          <div style={styles.card}><span style={styles.label}>Stability</span><div style={styles.value}>{stats.stability}</div></div>
          <div style={styles.card}><span style={styles.label}>Unrest</span><div style={{ ...styles.value, color: stats.unrest > 5 ? '#ff6b6b' : '#d4c5a9' }}>{stats.unrest}</div></div>
          <div style={styles.card}><span style={styles.label}>Treasury</span><div style={{ ...styles.value, color: '#ffd700' }}>{stats.bp} BP</div></div>
          <div style={styles.card}><span style={styles.label}>Size</span><div style={styles.value}>{stats.size} hexes</div></div>
          <div style={styles.card}><span style={styles.label}>Control DC</span><div style={styles.value}>{stats.controlDC}</div></div>
          <div style={styles.card}><span style={styles.label}>Turn</span><div style={styles.value}>{kingdom.turn}</div></div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <button style={{ ...styles.btn, ...styles.btnActive }} onClick={handleProcessTurn}>Process Kingdom Turn</button>
          <select style={styles.select} value={selectedKTerrain} onChange={e => setSelectedKTerrain(e.target.value)}>
            {Object.entries(terrainTypes).map(([k, v]) => <option key={k} value={k}>{v.name} ({v.preparationCost} BP)</option>)}
          </select>
          <button style={styles.btn} onClick={handleClaimHex}>Claim Hex</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <input style={{ ...styles.select, width: '140px' }} placeholder="City name..." value={newCityName} onChange={e => setNewCityName(e.target.value)} />
          <button style={styles.btn} onClick={handleFoundCity}>Found City</button>
        </div>

        <div style={{ ...styles.subtitle }}>Edicts</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {Object.entries(edicts).map(([edictType, options]) => (
            <div key={edictType} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ ...styles.label, textTransform: 'capitalize' }}>{edictType}:</span>
              <select style={styles.select} value={kingdom.edicts[edictType]} onChange={e => handleSetEdict(edictType, e.target.value)}>
                {options.map(o => <option key={o.level} value={o.level}>{o.level}</option>)}
              </select>
            </div>
          ))}
        </div>

        {/* Kingdom Hex Map */}
        {kingdom.hexes.length > 0 && (() => {
          const cols = Math.max(4, Math.ceil(Math.sqrt(kingdom.hexes.length * 2)));
          const rows = Math.max(3, Math.ceil(kingdom.hexes.length / cols) + 1);
          const grid = Array.from({ length: rows }, () => Array(cols).fill('plains'));
          kingdom.hexes.forEach((h, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            if (r < rows && c < cols) grid[r][c] = h.terrain || 'plains';
          });
          const labels = {};
          kingdom.cities.forEach((city, i) => {
            const r = Math.floor(i / cols);
            const c = i % cols;
            labels[`${c},${r}`] = city.name;
          });
          return (
            <div style={{ marginBottom: '12px' }}>
              <div style={styles.subtitle}>Kingdom Territory</div>
              <HexMap terrainGrid={grid} labels={labels} width={400} height={220} />
            </div>
          );
        })()}

        {kingdom.cities.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={styles.subtitle}>Cities</div>
            <div style={styles.grid}>
              {kingdom.cities.map((c, i) => (
                <div key={i} style={styles.card}>
                  <div style={styles.value}>{c.name}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>{c.districts[0]?.buildings?.length || 0} buildings, {c.districts[0]?.lotsUsed || 0}/36 lots</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={styles.subtitle}>Leadership Roles</div>
        <div style={{ ...styles.grid, marginBottom: '12px' }}>
          {roles.map(r => (
            <div key={r.id} style={styles.card}>
              <div style={styles.value}>{r.name}</div>
              <div style={{ fontSize: '10px', color: '#51cf66' }}>{r.bonus}</div>
              <div style={{ fontSize: '10px', color: kingdom.leaders[r.id] ? '#51cf66' : '#ff6b6b' }}>{kingdom.leaders[r.id] || 'Vacant'}</div>
            </div>
          ))}
        </div>

        {kingdomLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto' }}>
            {kingdomLog.map((l, i) => <div key={i} style={{ marginBottom: '4px', fontSize: '11px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Organizations Panel ──
  const renderOrgs = () => {
    const orgTypes = [
      { id: 'adventuring', name: 'Adventuring Company' },
      { id: 'arcane', name: 'Arcane Order' },
      { id: 'criminal', name: 'Criminal Enterprise' },
      { id: 'faith', name: 'Religious Order' },
      { id: 'mercantile', name: 'Trade Consortium' },
      { id: 'military', name: 'Mercenary Company' },
      { id: 'scholarly', name: 'Scholarly Guild' },
      { id: 'espionage', name: 'Shadow Network' },
    ];

    const handleCreateOrg = () => {
      if (!newOrgName.trim()) return;
      const org = advancedService.createOrganization(newOrgName, newOrgType);
      updateWorld('organizations', prev => [...prev, org]);
      setOrgLog(prev => [org.description, ...prev].slice(0, 20));
      addLog?.(`Organization created: ${org.name}`, 'info');
      setNewOrgName('');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Create Organization</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <input style={{ ...styles.select, width: '140px' }} placeholder="Organization name" value={newOrgName} onChange={e => setNewOrgName(e.target.value)} />
            <select style={styles.select} value={newOrgType} onChange={e => setNewOrgType(e.target.value)}>
              {orgTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button style={styles.btn} onClick={handleCreateOrg}>Create</button>
          </div>
        </div>

        {organizations.length > 0 && (
          <div style={styles.grid}>
            {organizations.map((org, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.value}>{org.name}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>{org.type} | Power {org.power}</div>
                <div style={{ fontSize: '10px', color: '#ffd700', marginTop: '4px' }}>Members: {org.members} | Treasury: {org.treasury} gp</div>
                <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => updateWorld('organizations', prev => prev.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {orgLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {orgLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Retraining Panel ──
  const renderRetraining = () => {
    const options = advancedService.getRetrainingOptions();

    return (
      <div>
        <div style={styles.subtitle}>Character Retraining</div>
        <div style={{ fontSize: '12px', color: '#8b949e', marginBottom: '12px' }}>
          Retrain class features, feats, skill ranks, or spells learned. Requires 1 day per level of the character.
        </div>

        <div style={styles.grid}>
          {party.map((c, i) => (
            <div key={c.id} style={styles.card}>
              <div style={styles.value}>{c.name}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{c.class} Level {c.level}</div>
              <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => {
                const result = advancedService.performRetraining(c);
                setRetrainResults(result);
                addLog?.(result.description, 'info');
              }}>Retrain</button>
            </div>
          ))}
        </div>

        {retrainResults && (
          <div style={{ ...styles.result, marginTop: '12px' }}>
            <div style={styles.warning}>Retraining Result</div>
            <div style={{ color: '#d4c5a9', marginTop: '4px' }}>{retrainResults.description}</div>
          </div>
        )}

        <div style={{ ...styles.subtitle, marginTop: '16px' }}>Retraining Options</div>
        <div style={styles.grid}>
          {options.map((opt, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.value}>{opt.type}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{opt.description}</div>
              <div style={{ fontSize: '10px', color: '#51cf66', marginTop: '2px' }}>Time: {opt.time}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Mass Combat Panel ──
  const renderMassCombat = () => {
    const sizes = advancedService.getArmySizes();
    const types = advancedService.getArmyTypes();
    const tactics = advancedService.getArmyTactics();

    const handleCreateArmy = () => {
      if (!newArmyName.trim()) return;
      const commander = party.length > 0 ? party[0] : null;
      const army = advancedService.createArmy(newArmyName, newArmyACR, newArmySize, newArmyType, commander);
      updateWorld('armies', prev => [...prev, army]);
      setMassCombatLog(prev => [...prev, `Created army: ${army.name} (ACR ${newArmyACR}, ${army.type}, OM +${army.om}, DV ${army.dv}, HP ${army.hp})`]);
      addLog?.(`Army created: ${army.name}`, 'system');
      setNewArmyName('');
    };

    const handleBattle = () => {
      if (armies.length < 2) return;
      const result = advancedService.resolveMassCombatRound({ ...armies[0] }, { ...armies[1] });
      updateWorld('armies', prev => prev.map((a, i) => i === 0 ? result.attackArmy : i === 1 ? result.defenseArmy : a));
      setMassCombatLog(prev => [...prev, ...result.results]);
      result.results.forEach(r => addLog?.(r, r.includes('DESTROY') || r.includes('ROUT') ? 'danger' : 'combat'));

      if (result.attackArmy.hp <= 0 || result.defenseArmy.hp <= 0) {
        const destroyed = result.attackArmy.hp <= 0 ? armies[0]?.name : armies[1]?.name;
        if (kingdom) {
          addLog?.(`Army ${destroyed} destroyed! Kingdom stability may be affected.`, 'danger');
        }
      }
    };

    const handleSetTactic = (idx, tacticId) => {
      updateWorld('armies', prev => prev.map((a, i) => i === idx ? { ...a, tactics: tacticId } : a));
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Create Army</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <input style={{ ...styles.select, width: '140px' }} placeholder="Army name" value={newArmyName} onChange={e => setNewArmyName(e.target.value)} />
            <label style={styles.label}>ACR</label>
            <input type="number" style={{ ...styles.select, width: '60px' }} min={1} max={20} value={newArmyACR} onChange={e => setNewArmyACR(Number(e.target.value))} />
            <select style={styles.select} value={newArmySize} onChange={e => setNewArmySize(e.target.value)}>
              {sizes.map(s => <option key={s.size} value={s.size}>{s.size} ({s.creatures})</option>)}
            </select>
            <select style={styles.select} value={newArmyType} onChange={e => setNewArmyType(e.target.value)}>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button style={styles.btn} onClick={handleCreateArmy}>Create</button>
          </div>
        </div>

        {armies.length > 0 && (
          <div style={styles.grid}>
            {armies.map((army, i) => (
              <div key={i} style={{ ...styles.card, borderColor: army.hp <= 0 ? '#ff6b6b' : army.routed ? '#ffd700' : 'rgba(255,215,0,0.2)' }}>
                <div style={styles.value}>{army.name}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>{army.type} | {army.size}</div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '11px' }}>
                  <span>HP: <span style={army.hp <= army.maxHp / 2 ? styles.danger : styles.success}>{army.hp}/{army.maxHp}</span></span>
                  <span>OM: +{army.om}</span>
                  <span>DV: {army.dv}</span>
                  <span>Morale: {army.morale}</span>
                </div>
                <div style={{ marginTop: '4px' }}>
                  <select style={{ ...styles.select, fontSize: '10px' }} value={army.tactics} onChange={e => handleSetTactic(i, e.target.value)}>
                    {tactics.map(t => <option key={t.id} value={t.id}>{t.name} (OM {t.omMod >= 0 ? '+' : ''}{t.omMod}, DV {t.dvMod >= 0 ? '+' : ''}{t.dvMod})</option>)}
                  </select>
                </div>
                {army.routed && <div style={styles.danger}>ROUTED</div>}
                {army.hp <= 0 && <div style={styles.danger}>DESTROYED</div>}
                <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => updateWorld('armies', prev => prev.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {armies.length >= 2 && (
          <div style={{ marginTop: '12px' }}>
            <button style={{ ...styles.btn, ...styles.btnActive }} onClick={handleBattle}>Resolve Combat Round ({armies[0]?.name} vs {armies[1]?.name})</button>
          </div>
        )}

        {massCombatLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '200px', overflowY: 'auto', marginTop: '12px' }}>
            {massCombatLog.map((l, i) => (
              <div key={i} style={{ fontSize: '11px', color: l.includes('DESTROY') || l.includes('ROUT') ? '#ff6b6b' : l.includes('hits') ? '#ffd700' : '#d4c5a9', marginBottom: '2px' }}>{l}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Reputation Panel ──
  const renderReputation = () => {
    const repData = advancedService.getReputationData();
    const fameTier = advancedService.getFameTier(partyFame);
    const infamyTier = advancedService.getInfamyTier(partyInfamy);

    const adjustFame = (delta) => {
      updateWorld('fame', prev => Math.max(0, prev + delta));
      const action = delta > 0 ? 'gained' : 'lost';
      setReputationLog(prev => [...prev, `Party ${action} ${Math.abs(delta)} Fame (now ${Math.max(0, partyFame + delta)})`]);
      addLog?.(`Party ${action} ${Math.abs(delta)} Fame`, delta > 0 ? 'success' : 'danger');
    };
    const adjustInfamy = (delta) => {
      updateWorld('infamy', prev => Math.max(0, prev + delta));
      const action = delta > 0 ? 'gained' : 'lost';
      setReputationLog(prev => [...prev, `Party ${action} ${Math.abs(delta)} Infamy (now ${Math.max(0, partyInfamy + delta)})`]);
    };

    return (
      <div>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ ...styles.card, flex: 1 }}>
            <div style={styles.subtitle}>Fame: {partyFame}</div>
            <div style={{ ...styles.value, color: '#51cf66' }}>Tier: {fameTier.name}</div>
            <div style={{ fontSize: '10px', color: '#8b949e' }}>{fameTier.benefit}</div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              <button style={styles.btn} onClick={() => adjustFame(1)}>+1</button>
              <button style={styles.btn} onClick={() => adjustFame(5)}>+5</button>
              <button style={styles.btn} onClick={() => adjustFame(-1)}>-1</button>
            </div>
          </div>
          <div style={{ ...styles.card, flex: 1 }}>
            <div style={styles.subtitle}>Infamy: {partyInfamy}</div>
            <div style={{ ...styles.value, color: '#ff6b6b' }}>Tier: {infamyTier.name}</div>
            <div style={{ fontSize: '10px', color: '#8b949e' }}>{infamyTier.benefit}</div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              <button style={styles.btn} onClick={() => adjustInfamy(1)}>+1</button>
              <button style={styles.btn} onClick={() => adjustInfamy(5)}>+5</button>
              <button style={styles.btn} onClick={() => adjustInfamy(-1)}>-1</button>
            </div>
          </div>
        </div>

        <div style={styles.subtitle}>Fame Actions</div>
        <div style={styles.grid}>
          {repData.earnFame?.map((a, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.value}>{a.action}</div>
              <div style={{ fontSize: '10px', color: '#51cf66' }}>+{a.fame} Fame</div>
            </div>
          ))}
        </div>

        {reputationLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {reputationLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Honor Panel ──
  const renderHonor = () => {
    const honorData = advancedService.getHonorData();
    const honorEvents = advancedService.getHonorEvents();

    const initHonor = () => {
      if (party.length === 0) return;
      const char = party[0];
      const chaMod = Math.floor(((char?.abilities?.CHA || 10) - 10) / 2);
      const starting = advancedService.calculateStartingHonor(chaMod);
      updateWorld('honor', starting);
      setHonorLog(prev => [...prev, `Honor initialized at ${starting} (CHA mod ${chaMod >= 0 ? '+' : ''}${chaMod})`]);
    };

    const adjustHonor = (delta) => {
      updateWorld('honor', prev => Math.max(0, (prev || 0) + delta));
    };

    const benefits = partyHonor !== null ? advancedService.getHonorBenefit(partyHonor) : [];

    return (
      <div>
        <div style={{ ...styles.card, marginBottom: '16px' }}>
          <div style={styles.subtitle}>Party Honor: {partyHonor !== null ? partyHonor : 'Not initialized'}</div>
          {partyHonor === null ? (
            <button style={styles.btn} onClick={initHonor}>Initialize Honor (from party leader CHA)</button>
          ) : (
            <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
              <button style={styles.btn} onClick={() => adjustHonor(1)}>+1</button>
              <button style={styles.btn} onClick={() => adjustHonor(5)}>+5</button>
              <button style={styles.btn} onClick={() => adjustHonor(-1)}>-1</button>
              <button style={styles.btn} onClick={() => adjustHonor(-5)}>-5</button>
            </div>
          )}
          {benefits.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={styles.label}>Active Benefits</div>
              {benefits.map((b, i) => <div key={i} style={{ fontSize: '11px', color: '#51cf66' }}>{b.benefit}</div>)}
            </div>
          )}
        </div>

        <div style={styles.subtitle}>Honor Events</div>
        <div style={styles.grid}>
          {honorEvents.map((e, i) => (
            <div key={i} style={{ ...styles.card, cursor: 'pointer' }} onClick={() => { adjustHonor(e.modifier); setHonorLog(prev => [...prev, `${e.event}: ${e.modifier >= 0 ? '+' : ''}${e.modifier} honor`]); addLog?.(`Honor ${e.modifier >= 0 ? '+' : ''}${e.modifier}: ${e.event}`, e.modifier >= 0 ? 'success' : 'danger'); }}>
              <div style={styles.value}>{e.event}</div>
              <div style={{ fontSize: '11px', color: e.modifier >= 0 ? '#51cf66' : '#ff6b6b' }}>{e.modifier >= 0 ? '+' : ''}{e.modifier}</div>
            </div>
          ))}
        </div>

        {honorLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {honorLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Contacts Panel ──
  const renderContacts = () => {
    const contactTypes = advancedService.getContactTypes();
    const trustLevels = advancedService.getTrustLevels();

    const handleAddContact = () => {
      if (!newContactName.trim()) return;
      const type = contactTypes.find(t => t.id === newContactType) || contactTypes[0];
      updateWorld('contacts', prev => [...prev, { name: newContactName, type: type.name, typeId: newContactType, trust: newContactTrust, diplomacyMod: 0, favorsAsked: 0 }]);
      setContactLog(prev => [...prev, `New contact: ${newContactName} (${type.name}, Trust ${newContactTrust})`]);
      addLog?.(`New contact: ${newContactName}`, 'info');
      setNewContactName('');
    };

    const handleAskFavor = (contactIdx, difficulty) => {
      const char = party[0];
      if (!char) return;
      const contact = contacts[contactIdx];
      const result = advancedService.askContactFavor(contact, difficulty);
      setContactLog(prev => [...prev, result.description]);
      addLog?.(result.description, result.success ? 'success' : 'danger');
      if (!result.success) {
        updateWorld('contacts', prev => prev.map((c, i) => i === contactIdx ? { ...c, trust: Math.max(0, c.trust - 1) } : c));
      }
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Add Contact</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <input style={{ ...styles.select, width: '140px' }} placeholder="Contact name" value={newContactName} onChange={e => setNewContactName(e.target.value)} />
            <select style={styles.select} value={newContactType} onChange={e => setNewContactType(e.target.value)}>
              {contactTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label style={styles.label}>Trust</label>
            <input type="number" style={{ ...styles.select, width: '50px' }} min={0} max={5} value={newContactTrust} onChange={e => setNewContactTrust(Number(e.target.value))} />
            <button style={styles.btn} onClick={handleAddContact}>Add</button>
          </div>
        </div>

        <div style={styles.subtitle}>Trust Levels</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {trustLevels.map(t => (
            <div key={t.level} style={{ ...styles.card, minWidth: '100px' }}>
              <div style={styles.value}>{t.level} - {t.name}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>DC mod: {t.dcModifier >= 0 ? '+' : ''}{t.dcModifier}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{t.reliability}</div>
            </div>
          ))}
        </div>

        {contacts.length > 0 && (
          <div style={styles.grid}>
            {contacts.map((c, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.value}>{c.name}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>{c.type} | Trust: {c.trust}</div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                  {['simple', 'moderate', 'difficult', 'dangerous'].map(d => (
                    <button key={d} style={{ ...styles.btn, fontSize: '9px', padding: '2px 6px' }} onClick={() => handleAskFavor(i, d)}>{d}</button>
                  ))}
                </div>
                <button style={{ ...styles.btn, fontSize: '9px', padding: '2px 6px', marginTop: '4px' }} onClick={() => updateWorld('contacts', prev => prev.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        )}

        {contactLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {contactLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Investigations Panel ──
  const renderInvestigations = () => {
    const clueTypes = advancedService.getClueTypes();
    const dcs = advancedService.getInvestigationDCs();

    const [investChar, setInvestChar] = useState(0);
    const [investClueType, setInvestClueType] = useState(clueTypes[0]?.id || 'physical');
    const [investDifficulty, setInvestDifficulty] = useState('average');

    const handleSearch = () => {
      const char = party[investChar];
      if (!char) return;
      const result = advancedService.searchForClue(char, investClueType, investDifficulty);
      setInvestigationLog(prev => [...prev, result.description]);
      addLog?.(result.description, result.success ? 'success' : 'info');
      if (result.success) {
        updateWorld('foundClues', prev => [...prev, { type: result.clueType, skill: result.skill, difficulty: investDifficulty, time: new Date().toLocaleTimeString() }]);
      }
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Search for Clues</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <select style={styles.select} value={investChar} onChange={e => setInvestChar(Number(e.target.value))}>
              {party.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
            </select>
            <select style={styles.select} value={investClueType} onChange={e => setInvestClueType(e.target.value)}>
              {clueTypes.map(c => <option key={c.id} value={c.id}>{c.name} ({c.skills.join(', ')})</option>)}
            </select>
            <select style={styles.select} value={investDifficulty} onChange={e => setInvestDifficulty(e.target.value)}>
              {Object.entries(dcs).map(([k, v]) => <option key={k} value={k}>{k} (DC {v})</option>)}
            </select>
            <button style={styles.btn} onClick={handleSearch}>Search</button>
          </div>
        </div>

        {investigationClues.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={styles.subtitle}>Found Clues ({investigationClues.length})</div>
            <div style={styles.grid}>
              {investigationClues.map((c, i) => (
                <div key={i} style={{ ...styles.card, borderLeft: '3px solid #51cf66' }}>
                  <div style={styles.value}>{c.type}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>Skill: {c.skill} | {c.difficulty} | {c.time}</div>
                </div>
              ))}
            </div>
            <button style={{ ...styles.btn, marginTop: '8px' }} onClick={() => updateWorld('foundClues', [])}>Clear Clues</button>
          </div>
        )}

        {investigationLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '200px', overflowY: 'auto' }}>
            {investigationLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px', color: l.includes('finds') ? '#51cf66' : '#d4c5a9' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Sanity Panel ──
  const renderSanity = () => {
    const triggers = advancedService.getSanityTriggers();
    const madnessEffects = advancedService.getMadnessEffects();
    const recovery = advancedService.getSanityRecovery();

    const initSanity = () => {
      const updated = {};
      party.forEach(c => {
        const score = advancedService.calculateSanityScore(c);
        updated[c.id] = { current: score, max: score };
      });
      updateWorld('sanity', updated);
      setSanityLog(prev => [...prev, 'Sanity scores initialized for party']);
    };

    const handleTrigger = (charIdx, triggerIdx) => {
      const char = party[charIdx];
      if (!char || !sanityCurrent[char.id]) return;
      const result = advancedService.checkSanityDamage(char, triggerIdx);
      updateWorld('sanity', prev => ({
        ...prev,
        [char.id]: { ...prev[char.id], current: Math.max(0, prev[char.id].current - result.finalDamage) }
      }));
      setSanityLog(prev => [...prev, `${char.name}: ${result.description}`]);
      addLog?.(`${char.name}: ${result.description}`, 'danger');

      if ((sanityCurrent[char.id]?.current || 0) - result.finalDamage <= 0) {
        const madness = advancedService.rollMadnessEffect();
        setSanityLog(prev => [...prev, `${char.name} suffers madness: ${madness.effect} (${madness.duration})`]);
        addLog?.(`${char.name} suffers madness: ${madness.effect}`, 'danger');
      }
    };

    return (
      <div>
        {Object.keys(sanityCurrent).length === 0 ? (
          <div style={styles.section}>
            <div>Sanity tracks mental stability. Score = WIS x 2 + CHA.</div>
            <button style={{ ...styles.btn, marginTop: '8px' }} onClick={initSanity}>Initialize Party Sanity</button>
          </div>
        ) : (
          <div>
            <div style={styles.grid}>
              {party.map((c, ci) => {
                const s = sanityCurrent[c.id];
                if (!s) return null;
                const pct = s.max > 0 ? (s.current / s.max) * 100 : 0;
                return (
                  <div key={c.id} style={styles.card}>
                    <div style={styles.value}>{c.name}</div>
                    <div style={{ background: '#1a1a2e', borderRadius: '4px', height: '8px', marginTop: '4px' }}>
                      <div style={{ background: pct > 50 ? '#51cf66' : pct > 25 ? '#ffd700' : '#ff6b6b', height: '8px', borderRadius: '4px', width: `${pct}%` }} />
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '4px' }}>Sanity: {s.current} / {s.max}</div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                      {triggers.map((t, ti) => (
                        <button key={ti} style={{ ...styles.btn, fontSize: '9px', padding: '2px 6px' }} onClick={() => handleTrigger(ci, ti)} title={t.damage}>{t.trigger.substring(0, 15)}</button>
                      ))}
                    </div>
                    <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => updateWorld('sanity', prev => ({ ...prev, [c.id]: { ...prev[c.id], current: Math.min(prev[c.id].max, prev[c.id].current + 1) } }))}>Restore +1</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: '12px' }}>
          <div style={styles.subtitle}>Madness Effects Reference</div>
          <div style={styles.grid}>
            {madnessEffects.map((m, i) => (
              <div key={i} style={styles.card}>
                <div style={{ ...styles.value, color: '#ff6b6b' }}>{m.effect}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>{m.duration}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '12px' }}>
          <div style={styles.subtitle}>Recovery Methods</div>
          <div style={styles.grid}>
            {recovery.map((r, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.value}>{r.method}</div>
                <div style={{ fontSize: '10px', color: '#51cf66' }}>{r.recovery}</div>
              </div>
            ))}
          </div>
        </div>

        {sanityLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {sanityLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Crafting Panel ──
  const renderCrafting = () => {
    const itemTypes = advancedService.getCraftingItemTypes();
    const baseCost = advancedService.calculateCraftingCost(craftItemPrice);
    const craftDays = advancedService.calculateCraftingTime(baseCost);

    const handleCraft = () => {
      const char = party[0];
      if (!char) return;
      const result = advancedService.attemptCrafting(char, craftItemCL, baseCost);
      setCraftingLog(prev => [...prev, `${char.name} attempts to craft "${craftItemName || 'item'}": ${result.description}`]);
      addLog?.(result.description, result.success ? 'success' : 'danger');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Craft Magic Item</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <input style={{ ...styles.select, width: '160px' }} placeholder="Item name" value={craftItemName} onChange={e => setCraftItemName(e.target.value)} />
            <label style={styles.label}>Market Price (gp)</label>
            <input type="number" style={{ ...styles.select, width: '80px' }} min={1} value={craftItemPrice} onChange={e => setCraftItemPrice(Number(e.target.value))} />
            <label style={styles.label}>Caster Level</label>
            <input type="number" style={{ ...styles.select, width: '50px' }} min={1} max={20} value={craftItemCL} onChange={e => setCraftItemCL(Number(e.target.value))} />
            <button style={styles.btn} onClick={handleCraft}>Attempt Craft</button>
          </div>
          <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '8px' }}>
            Crafting cost: {baseCost} gp | Time: {craftDays} day{craftDays !== 1 ? 's' : ''} | DC: {5 + craftItemCL}
          </div>
        </div>

        <div style={styles.subtitle}>Item Types & Requirements</div>
        <div style={styles.grid}>
          {itemTypes.map((t, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.value}>{t.type}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>Feat: {t.feat}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>Min CL: {t.casterLevel}</div>
            </div>
          ))}
        </div>

        {craftingLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '200px', overflowY: 'auto', marginTop: '12px' }}>
            {craftingLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px', color: l.includes('Success') ? '#51cf66' : l.includes('Natural 1') ? '#ff6b6b' : '#d4c5a9' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Gambling Panel ──
  const renderGambling = () => {
    const games = advancedService.getGames();

    const [gamblingChar, setGamblingChar] = useState(0);
    const [cheating, setCheating] = useState(false);

    const handleGamble = () => {
      const char = party[gamblingChar];
      if (!char) return;
      const result = advancedService.resolveGamble(char, selectedGame, betAmount, cheating);
      setGamblingLog(prev => [...prev, result.description || result.error]);
      addLog?.(result.description || result.error, result.success ? 'loot' : result.caught ? 'danger' : 'info');

      if (result.success) {
        const net = result.winnings - betAmount;
        updateWorld('gamblingNet', prev => prev + net);
      }
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Place a Bet</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <select style={styles.select} value={gamblingChar} onChange={e => setGamblingChar(Number(e.target.value))}>
              {party.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
            </select>
            <select style={styles.select} value={selectedGame} onChange={e => setSelectedGame(e.target.value)}>
              {games.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <label style={styles.label}>Bet (gp)</label>
            <input type="number" style={{ ...styles.select, width: '70px' }} min={1} value={betAmount} onChange={e => setBetAmount(Number(e.target.value))} />
            <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: '#ff6b6b' }}>
              <input type="checkbox" checked={cheating} onChange={e => setCheating(e.target.checked)} /> Cheat
            </label>
            <button style={{ ...styles.btn, ...styles.btnActive }} onClick={handleGamble}>Gamble!</button>
          </div>
        </div>

        <div style={styles.subtitle}>Games</div>
        <div style={styles.grid}>
          {games.map(g => (
            <div key={g.id} style={styles.card}>
              <div style={styles.value}>{g.name}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>Skill: {g.skillCheck}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{g.description}</div>
            </div>
          ))}
        </div>

        {gamblingLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '200px', overflowY: 'auto', marginTop: '12px' }}>
            {gamblingLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px', color: l.includes('Won') ? '#51cf66' : l.includes('caught') ? '#ff6b6b' : l.includes('Lost') ? '#ffd700' : '#d4c5a9' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Disasters Panel ──
  const renderDisasters = () => {
    const disasters = advancedService.getDisasters();
    const drugs = advancedService.getDrugs();
    const addictionSeverity = advancedService.getAddictionSeverity();
    const boons = advancedService.getNpcBoons();

    const handleRollDisaster = () => {
      const d = advancedService.rollDisaster();
      setDisasterLog(prev => [...prev, `DISASTER: ${d.name} — ${d.effect}. DC ${d.dc} (${d.skill}).`]);
      addLog?.(`Disaster: ${d.name} — ${d.effect}`, 'danger');
    };

    const handleUseDrug = (drugId) => {
      const char = party[0];
      if (!char) return;
      const result = advancedService.useDrug(char, drugId);
      setDisasterLog(prev => [...prev, result.description]);
      addLog?.(result.description, result.addicted ? 'danger' : 'info');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Roll Random Disaster</div>
          <button style={{ ...styles.btn, ...styles.btnActive }} onClick={handleRollDisaster}>Roll Disaster</button>
        </div>

        <div style={styles.subtitle}>Disaster Types</div>
        <div style={styles.grid}>
          {disasters.map((d, i) => (
            <div key={i} style={styles.card}>
              <div style={{ ...styles.value, color: '#ff6b6b' }}>{d.name}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{d.effect}</div>
              <div style={{ fontSize: '10px', color: '#ffd700' }}>DC {d.dc} {d.skill}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '16px' }}>
          <div style={styles.subtitle}>Drugs & Addiction</div>
          <div style={styles.grid}>
            {drugs.map(d => (
              <div key={d.id} style={styles.card}>
                <div style={styles.value}>{d.name}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>Effect: {d.effect}</div>
                <div style={{ fontSize: '10px', color: '#ffd700' }}>Fort DC {d.fortDC} | Addiction DC {d.addictionDC}</div>
                <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => handleUseDrug(d.id)}>Use</button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '8px' }}>
            <div style={styles.label}>Addiction Severity</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {addictionSeverity.map((s, i) => (
                <div key={i} style={{ ...styles.card, minWidth: '120px' }}>
                  <div style={{ ...styles.value, color: '#ff6b6b' }}>{s.severity}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>{s.penalty}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>Save DC: {s.saveDC}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: '16px' }}>
          <div style={styles.subtitle}>NPC Boons</div>
          <div style={styles.grid}>
            {boons.map((b, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.value}>{b.type}</div>
                <div style={{ fontSize: '10px', color: '#51cf66' }}>{b.boon}</div>
              </div>
            ))}
          </div>
        </div>

        {disasterLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '200px', overflowY: 'auto', marginTop: '12px' }}>
            {disasterLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px', color: l.includes('DISASTER') ? '#ff6b6b' : l.includes('ADDICTED') ? '#ff6b6b' : '#d4c5a9' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Trade Routes Panel ──
  const renderTradeRoutes = () => {
    const [selectedOrigin, setSelectedOrigin] = useState('');
    const [selectedDest, setSelectedDest] = useState('');
    const [selectedGoods, setSelectedGoods] = useState('silk');
    const [newRouteName, setNewRouteName] = useState('');

    const tradeGoods = advancedService.getTradeGoods();
    const settlements = ['Waterdeep', 'Neverwinter', 'Baldur\'s Gate', 'Candlekeep', 'Silverymoon'];

    const handleCreateRoute = () => {
      if (!selectedOrigin || !selectedDest || selectedOrigin === selectedDest) return;
      const route = advancedService.createTradeRoute(selectedOrigin, selectedDest, selectedGoods);
      updateWorld('tradeRoutes', prev => [...prev, route]);
      setTradeLog(prev => [...prev, `Trade route created: ${selectedOrigin} to ${selectedDest} (${selectedGoods})`]);
      addLog?.(`Trade route established: ${selectedOrigin} -> ${selectedDest}`, 'info');
    };

    const handleRollBandits = (routeIdx) => {
      const route = tradeRoutes[routeIdx];
      const result = advancedService.rollTradeRouteBandits(route);
      setTradeLog(prev => [...prev, result.description]);
      addLog?.(result.description, result.encountered ? 'danger' : 'success');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Create Trade Route</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <select style={styles.select} value={selectedOrigin} onChange={e => setSelectedOrigin(e.target.value)}>
              <option value="">Origin...</option>
              {settlements.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={styles.select} value={selectedDest} onChange={e => setSelectedDest(e.target.value)}>
              <option value="">Destination...</option>
              {settlements.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={styles.select} value={selectedGoods} onChange={e => setSelectedGoods(e.target.value)}>
              {tradeGoods.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button style={styles.btn} onClick={handleCreateRoute}>Create Route</button>
          </div>
        </div>

        {tradeRoutes.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            <div style={styles.subtitle}>Active Routes</div>
            <div style={styles.grid}>
              {tradeRoutes.map((route, i) => (
                <div key={i} style={styles.card}>
                  <div style={styles.value}>{route.origin} → {route.destination}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>Goods: {route.goods}</div>
                  <div style={{ fontSize: '10px', color: '#51cf66' }}>Profit/month: {route.monthlyProfit} gp</div>
                  <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => handleRollBandits(i)}>Roll Bandits</button>
                  <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => updateWorld('tradeRoutes', prev => prev.filter((_, j) => j !== i))}>Close</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={styles.subtitle}>Trade Goods</div>
        <div style={styles.grid}>
          {tradeGoods.map((g, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.value}>{g.name}</div>
              <div style={{ fontSize: '10px', color: '#51cf66' }}>Profit: {g.profitMargin}%</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{g.rarity}</div>
            </div>
          ))}
        </div>

        {tradeLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {tradeLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Espionage Panel ──
  const renderEspionage = () => {
    const [espionageChar, setEspionageChar] = useState(0);
    const [spySettlement, setSpySettlement] = useState('');
    const [spyObjective, setSpyObjective] = useState('gather_info');

    const settlements = ['Waterdeep', 'Neverwinter', 'Baldur\'s Gate', 'Candlekeep', 'Silverymoon'];
    const objectives = [
      { id: 'gather_info', name: 'Gather Information', dc: 15 },
      { id: 'sabotage', name: 'Sabotage', dc: 20 },
      { id: 'infiltrate', name: 'Infiltrate', dc: 18 },
      { id: 'assassinate', name: 'Assassinate Target', dc: 25 },
    ];

    const handleGatherIntel = () => {
      const char = party[espionageChar];
      if (!char || !spySettlement) return;
      const result = advancedService.gatherIntelligence(char, spySettlement);
      setEspionageLog(prev => [...prev, result.description]);
      addLog?.(result.description, result.success ? 'success' : 'danger');
    };

    const handleCreateSpyNetwork = () => {
      if (!spySettlement) return;
      const network = advancedService.createSpyNetwork(spySettlement, 100);
      updateWorld('spyNetworks', prev => [...prev, network]);
      setEspionageLog(prev => [...prev, `Spy network established in ${spySettlement}`]);
      addLog?.(`Spy network established in ${spySettlement}`, 'info');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Gather Intelligence</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <select style={styles.select} value={espionageChar} onChange={e => setEspionageChar(Number(e.target.value))}>
              {party.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
            </select>
            <select style={styles.select} value={spySettlement} onChange={e => setSpySettlement(e.target.value)}>
              <option value="">Settlement...</option>
              {settlements.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select style={styles.select} value={spyObjective} onChange={e => setSpyObjective(e.target.value)}>
              {objectives.map(o => <option key={o.id} value={o.id}>{o.name} (DC {o.dc})</option>)}
            </select>
            <button style={styles.btn} onClick={handleGatherIntel}>Execute</button>
          </div>
        </div>

        <div style={{ ...styles.section, marginTop: '12px' }}>
          <div style={styles.subtitle}>Spy Networks</div>
          <button style={styles.btn} onClick={handleCreateSpyNetwork}>Create Network in {spySettlement || 'Selected Settlement'}</button>
        </div>

        {spyNetworks.length > 0 && (
          <div style={styles.grid}>
            {spyNetworks.map((network, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.value}>{network.settlement}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>Agents: {network.agentCount}</div>
                <div style={{ fontSize: '10px', color: '#ffd700' }}>Upkeep: {network.monthlyUpkeep} gp</div>
                <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => updateWorld('spyNetworks', prev => prev.filter((_, j) => j !== i))}>Dismantle</button>
              </div>
            ))}
          </div>
        )}

        {espionageLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {espionageLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Alignment Panel ──
  const renderAlignment = () => {
    const [selectedCharIdx, setSelectedCharIdx] = useState(0);
    const [infractionType, setInfractionType] = useState('minor');
    const [infractionSeverity, setInfractionSeverity] = useState('minor');

    const infractionTypes = ['betrayal', 'cruelty', 'cowardice', 'theft', 'deception', 'minor'];
    const severities = ['minor', 'moderate', 'major'];

    const handleLogInfraction = () => {
      const char = party[selectedCharIdx];
      if (!char) return;
      const result = advancedService.logAlignmentInfraction(char, infractionType, infractionSeverity);
      updateWorld('alignmentInfractions', prev => ({
        ...prev,
        [char.id]: [...(prev[char.id] || []), { type: infractionType, severity: infractionSeverity, date: new Date().toLocaleString() }]
      }));
      setAlignmentLog(prev => [...prev, result.description]);
      addLog?.(result.description, 'danger');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Log Alignment Infraction</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <select style={styles.select} value={selectedCharIdx} onChange={e => setSelectedCharIdx(Number(e.target.value))}>
              {party.map((c, i) => <option key={i} value={i}>{c.name} ({c.alignment})</option>)}
            </select>
            <select style={styles.select} value={infractionType} onChange={e => setInfractionType(e.target.value)}>
              {infractionTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select style={styles.select} value={infractionSeverity} onChange={e => setInfractionSeverity(e.target.value)}>
              {severities.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button style={styles.btn} onClick={handleLogInfraction}>Log</button>
          </div>
        </div>

        <div style={styles.subtitle}>Party Alignments</div>
        <div style={styles.grid}>
          {party.map((c, i) => {
            const infractions = alignmentInfractions[c.id] || [];
            return (
              <div key={c.id} style={styles.card}>
                <div style={styles.value}>{c.name}</div>
                <div style={{ fontSize: '10px', color: '#ffd700' }}>{c.alignment}</div>
                <div style={{ fontSize: '10px', color: infractions.length > 0 ? '#ff6b6b' : '#51cf66' }}>Infractions: {infractions.length}</div>
                {infractions.length > 0 && infractions.slice(-1).map((inf, j) => (
                  <div key={j} style={{ fontSize: '9px', color: '#ff6b6b', marginTop: '4px' }}>{inf.type} ({inf.severity})</div>
                ))}
              </div>
            );
          })}
        </div>

        {alignmentLog.length > 0 && (
          <div style={{ ...styles.result, maxHeight: '150px', overflowY: 'auto', marginTop: '12px' }}>
            {alignmentLog.map((l, i) => <div key={i} style={{ fontSize: '11px', marginBottom: '2px' }}>{l}</div>)}
          </div>
        )}
      </div>
    );
  };

  // ── Lineage Panel ──
  const renderLineage = () => {
    const [selectedCharIdx, setSelectedCharIdx] = useState(0);

    const bloodlines = advancedService.getBloodlines();

    const handleAssignBloodline = (bloodlineId) => {
      const char = party[selectedCharIdx];
      if (!char) return;
      const result = advancedService.assignBloodline(char, bloodlineId);
      setParty(prev => prev.map((c, i) => i === selectedCharIdx ? { ...c, bloodline: bloodlineId } : c));
      addLog?.(result.description, 'info');
    };

    return (
      <div>
        <div style={styles.section}>
          <div style={styles.subtitle}>Assign Bloodline</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select style={styles.select} value={selectedCharIdx} onChange={e => setSelectedCharIdx(Number(e.target.value))}>
              {party.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
            </select>
            {party[selectedCharIdx]?.bloodline && (
              <span style={{ ...styles.value, fontSize: '11px' }}>Current: {party[selectedCharIdx].bloodline}</span>
            )}
          </div>
        </div>

        <div style={styles.subtitle}>Available Bloodlines</div>
        <div style={styles.grid}>
          {bloodlines.map((bloodline, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.value}>{bloodline.name}</div>
              <div style={{ fontSize: '10px', color: '#8b949e' }}>{bloodline.type}</div>
              <div style={{ fontSize: '10px', color: '#51cf66', marginTop: '4px' }}>Benefit: {bloodline.baseAbility}</div>
              <button style={{ ...styles.btn, fontSize: '10px', marginTop: '4px' }} onClick={() => handleAssignBloodline(bloodline.id)}>Assign</button>
            </div>
          ))}
        </div>

        {party[selectedCharIdx]?.bloodline && (
          <div style={{ ...styles.result, marginTop: '12px' }}>
            <div style={styles.warning}>Bloodline: {party[selectedCharIdx].bloodline}</div>
            <div style={{ fontSize: '11px', color: '#d4c5a9', marginTop: '8px' }}>
              Bloodline powers scale with character level and provide supernatural or spell-like abilities.
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Retirement Panel ──
  const renderRetirement = () => {
    const [selectedCharIdx, setSelectedCharIdx] = useState(0);
    const [retirementNote, setRetirementNote] = useState('');

    const handleRetireCharacter = () => {
      const char = party[selectedCharIdx];
      if (!char) return;
      const legacyBonus = advancedService.calculateLegacyBonus(char);
      const retired = {
        name: char.name,
        class: char.class,
        level: char.level,
        legacyBonus,
        retirementNote,
        retirementDate: new Date().toLocaleString()
      };
      updateWorld('retiredCharacters', prev => [...prev, retired]);
      setParty(prev => prev.filter((_, i) => i !== selectedCharIdx));
      addLog?.(`${char.name} has retired and left a legacy bonus of +${legacyBonus}!`, 'success');
      setRetirementNote('');
    };

    return (
      <div>
        {party.length > 0 ? (
          <>
            <div style={styles.section}>
              <div style={styles.subtitle}>Retire Character</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <select style={styles.select} value={selectedCharIdx} onChange={e => setSelectedCharIdx(Number(e.target.value))}>
                  {party.map((c, i) => <option key={i} value={i}>{c.name} (Level {c.level})</option>)}
                </select>
              </div>
              <div style={{ marginTop: '8px' }}>
                <textarea
                  placeholder="Retirement note (optional)..."
                  value={retirementNote}
                  onChange={e => setRetirementNote(e.target.value)}
                  style={{ ...styles.select, width: '100%', minHeight: '60px', padding: '6px' }}
                />
              </div>
              <button style={{ ...styles.btn, ...styles.btnActive, marginTop: '8px' }} onClick={handleRetireCharacter}>Retire Character</button>
            </div>

            {party[selectedCharIdx] && (
              <div style={{ ...styles.result, marginTop: '12px' }}>
                <div style={styles.warning}>{party[selectedCharIdx].name}</div>
                <div style={{ fontSize: '11px', color: '#d4c5a9' }}>Level {party[selectedCharIdx].level} {party[selectedCharIdx].class}</div>
                <div style={{ fontSize: '11px', color: '#51cf66', marginTop: '8px' }}>Legacy Bonus: +{advancedService.calculateLegacyBonus(party[selectedCharIdx])}</div>
              </div>
            )}
          </>
        ) : (
          <div style={styles.section}>
            <div>No active characters to retire.</div>
          </div>
        )}

        {retiredCharacters.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={styles.subtitle}>Hall of Fame ({retiredCharacters.length})</div>
            <div style={styles.grid}>
              {retiredCharacters.map((char, i) => (
                <div key={i} style={styles.card}>
                  <div style={styles.value}>{char.name}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>{char.class} {char.level}</div>
                  <div style={{ fontSize: '10px', color: '#ffd700' }}>Legacy: +{char.legacyBonus}</div>
                  <div style={{ fontSize: '9px', color: '#d4c5a9', marginTop: '4px' }}>{char.retirementDate}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Encounter Builder Panel ──
  const renderEncounterBuilder = () => {
    const apl = party.length > 0 ? dmTools.calculateAPL(party) : 1;
    const handleBuild = () => {
      const result = dmTools.buildEncounter(apl, party.length || 4, encounterBuilderState.difficulty);
      setEncounterBuilderState(prev => ({ ...prev, result }));
      addLog?.(`Encounter built: ${result.description}`, 'info');
    };
    const handleCalcXP = () => {
      if (encounterBuilderState.crList.length === 0) return;
      const result = dmTools.calculateEncounterXP(encounterBuilderState.crList, party.length || 4);
      setEncounterBuilderState(prev => ({ ...prev, result }));
      addLog?.(`Encounter XP: ${result.description}`, 'info');
    };
    const addCR = (cr) => {
      setEncounterBuilderState(prev => ({ ...prev, crList: [...prev.crList, cr] }));
    };
    const removeCR = (idx) => {
      setEncounterBuilderState(prev => ({ ...prev, crList: prev.crList.filter((_, i) => i !== idx) }));
    };
    return (
      <div>
        <div style={{ marginBottom: '12px' }}>
          <span style={styles.label}>Average Party Level: </span>
          <span style={styles.value}>{apl}</span>
          <span style={{ ...styles.label, marginLeft: '16px' }}>Party Size: </span>
          <span style={styles.value}>{party.length || 0}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <select style={styles.select} value={encounterBuilderState.difficulty} onChange={e => setEncounterBuilderState(prev => ({ ...prev, difficulty: e.target.value }))}>
            {['Easy', 'Average', 'Medium', 'Hard', 'Deadly'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button style={styles.btn} onClick={handleBuild}>Build Encounter</button>
        </div>
        <div style={{ ...styles.subtitle, marginTop: '12px' }}>CR Calculator</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px', alignItems: 'center' }}>
          {['1/8', '1/4', '1/2', 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map(cr => (
            <button key={cr} style={{ ...styles.btn, padding: '4px 8px', fontSize: '11px' }} onClick={() => addCR(cr)}>CR {cr}</button>
          ))}
        </div>
        {encounterBuilderState.crList.length > 0 && (
          <div style={styles.result}>
            <div style={styles.label}>Monsters in encounter:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
              {encounterBuilderState.crList.map((cr, i) => (
                <span key={i} style={{ background: '#3a2a1e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', cursor: 'pointer' }} onClick={() => removeCR(i)}>
                  CR {cr} ✕
                </span>
              ))}
            </div>
            <button style={{ ...styles.btn, marginTop: '8px' }} onClick={handleCalcXP}>Calculate XP</button>
            <button style={{ ...styles.btn, marginTop: '8px' }} onClick={() => setEncounterBuilderState(prev => ({ ...prev, crList: [] }))}>Clear</button>
          </div>
        )}
        {encounterBuilderState.result && (
          <div style={{ ...styles.result, marginTop: '8px' }}>
            <div style={styles.value}>{encounterBuilderState.result.difficulty || 'Encounter'}</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>{encounterBuilderState.result.description}</div>
            {encounterBuilderState.result.totalXP && (
              <div style={{ marginTop: '4px' }}>
                <span style={styles.label}>Total XP: </span><span style={styles.value}>{encounterBuilderState.result.totalXP}</span>
                <span style={{ ...styles.label, marginLeft: '12px' }}>Per Character: </span><span style={styles.value}>{encounterBuilderState.result.perCharXP}</span>
              </div>
            )}
            {encounterBuilderState.result.suggestedMonsters && (
              <div style={{ marginTop: '4px' }}>
                <span style={styles.label}>Suggested CRs: </span>
                {encounterBuilderState.result.suggestedMonsters.map((m, i) => (
                  <span key={i} style={{ ...styles.value, marginRight: '8px' }}>CR {m.cr} ({m.xp} XP)</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── XP Calculator Panel ──
  const renderXPCalc = () => {
    const tracks = ['slow', 'medium', 'fast'];
    return (
      <div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <span style={styles.label}>Track:</span>
          {tracks.map(t => (
            <button key={t} style={{ ...styles.btn, ...(xpCalcState.track === t ? styles.btnActive : {}) }}
              onClick={() => setXpCalcState(prev => ({ ...prev, track: t }))}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <div style={styles.subtitle}>Party XP Status</div>
        {party.length === 0 ? (
          <div style={{ color: '#8b949e', fontStyle: 'italic' }}>No party members. Add characters in the Party tab.</div>
        ) : (
          <div style={styles.grid}>
            {party.map(c => {
              const progress = dmTools.getXPToNextLevel(c.xp || 0, c.level || 1, xpCalcState.track);
              const levelUp = dmTools.checkLevelUp(c.xp || 0, c.level || 1, xpCalcState.track);
              const pacing = dmTools.encountersToLevelUp(c.level || 1, c.xp || 0, xpCalcState.track);
              const pct = progress.nextLevelXP > 0 ? Math.min(100, Math.floor(((c.xp || 0) / progress.nextLevelXP) * 100)) : 100;
              return (
                <div key={c.id} style={styles.card}>
                  <div style={styles.value}>{c.name}</div>
                  <div>Level {c.level || 1} — {c.xp || 0} XP</div>
                  <div style={{ background: '#333', borderRadius: '4px', height: '8px', marginTop: '4px' }}>
                    <div style={{ background: levelUp.shouldLevel ? '#51cf66' : '#ffd700', width: `${pct}%`, height: '100%', borderRadius: '4px' }} />
                  </div>
                  <div style={{ fontSize: '10px', marginTop: '2px' }}>
                    {progress.xpNeeded > 0 ? `${progress.xpNeeded} XP to level ${(c.level || 1) + 1}` : 'Ready to level up!'}
                  </div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>~{pacing.encountersNeeded} encounters to next level</div>
                  {levelUp.shouldLevel && <div style={styles.success}>LEVEL UP AVAILABLE!</div>}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ ...styles.subtitle, marginTop: '16px' }}>Story Awards</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {['majorQuest', 'minorQuest', 'roleplay', 'diplomacy', 'exploration', 'puzzle'].map(type => (
            <button key={type} style={styles.btn} onClick={() => {
              const apl = party.length > 0 ? dmTools.calculateAPL(party) : 1;
              const award = dmTools.calculateStoryAward(type, apl, party.length || 4);
              addLog?.(`Story Award (${type}): ${award.totalXP} XP (${award.perCharXP} each) — ${award.description}`, 'loot');
            }}>{type}</button>
          ))}
        </div>
      </div>
    );
  };

  // ── NPC Attitudes Panel ──
  const renderNPCAttitudes = () => {
    const handleAddNPC = () => {
      if (!npcName) return;
      const npc = dmTools.createTrackedNPC(npcName, npcAttitude, npcLevel, npcWis);
      setNpcAttitudeState(prev => ({ ...prev, trackedNPCs: [...prev.trackedNPCs, npc] }));
      setNPCName('');
    };
    const handleDiplomacy = (npcIdx) => {
      if (party.length === 0) return;
      const char = party[0]; // Use first party member
      const npc = npcAttitudeState.trackedNPCs[npcIdx];
      const result = dmTools.attemptDiplomacy(
        { name: char.name, diplomacy: (char.skills?.diplomacy || 0), cha: char.abilities?.CHA || 10 },
        npc
      );
      const updated = [...npcAttitudeState.trackedNPCs];
      if (result.success) updated[npcIdx] = { ...npc, attitude: result.newAttitude };
      setNpcAttitudeState(prev => ({ ...prev, trackedNPCs: updated }));
      addLog?.(`Diplomacy: ${result.description}`, result.success ? 'success' : 'info');
    };
    const handleIntimidate = (npcIdx) => {
      if (party.length === 0) return;
      const char = party[0];
      const npc = npcAttitudeState.trackedNPCs[npcIdx];
      const result = dmTools.attemptIntimidate(
        { name: char.name, intimidate: (char.skills?.intimidate || 0), str: char.abilities?.STR || 10 },
        npc
      );
      const updated = [...npcAttitudeState.trackedNPCs];
      if (result.success) updated[npcIdx] = { ...npc, attitude: result.newAttitude };
      setNpcAttitudeState(prev => ({ ...prev, trackedNPCs: updated }));
      addLog?.(`Intimidate: ${result.description}`, result.success ? 'success' : 'info');
    };
    const attitudeColors = { hostile: '#ff6b6b', unfriendly: '#ff9966', indifferent: '#8b949e', friendly: '#51cf66', helpful: '#ffd700' };
    return (
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <input style={{ ...styles.select, width: '120px' }} placeholder="NPC Name" value={npcName} onChange={e => setNPCName(e.target.value)} />
          <select style={styles.select} value={npcAttitude} onChange={e => setNPCAttitude(e.target.value)}>
            {['hostile', 'unfriendly', 'indifferent', 'friendly', 'helpful'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input style={{ ...styles.select, width: '50px' }} type="number" value={npcLevel} onChange={e => setNPCLevel(+e.target.value)} placeholder="Lvl" />
          <input style={{ ...styles.select, width: '50px' }} type="number" value={npcWis} onChange={e => setNPCWis(+e.target.value)} placeholder="WIS" />
          <button style={styles.btn} onClick={handleAddNPC}>Add NPC</button>
        </div>
        {npcAttitudeState.trackedNPCs.length === 0 ? (
          <div style={{ color: '#8b949e', fontStyle: 'italic' }}>No tracked NPCs. Add one above.</div>
        ) : (
          <div style={styles.grid}>
            {npcAttitudeState.trackedNPCs.map((npc, i) => (
              <div key={i} style={styles.card}>
                <div style={styles.value}>{npc.name}</div>
                <div style={{ color: attitudeColors[npc.attitude] || '#8b949e', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '11px' }}>{npc.attitude}</div>
                <div style={{ fontSize: '10px' }}>Level {npc.level} | WIS {npc.wis}</div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                  <button style={{ ...styles.btn, fontSize: '10px', padding: '2px 6px' }} onClick={() => handleDiplomacy(i)}>Diplomacy</button>
                  <button style={{ ...styles.btn, fontSize: '10px', padding: '2px 6px' }} onClick={() => handleIntimidate(i)}>Intimidate</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ ...styles.subtitle, marginTop: '12px' }}>Attitude Reference</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {['hostile', 'unfriendly', 'indifferent', 'friendly', 'helpful'].map(a => {
            const data = dmTools.getAttitude(a);
            return (
              <div key={a} style={{ ...styles.card, minWidth: '120px' }}>
                <div style={{ color: attitudeColors[a], fontWeight: 'bold', fontSize: '11px' }}>{a.toUpperCase()}</div>
                <div style={{ fontSize: '10px' }}>{data?.description || a}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Settlement Generator Panel ──
  const renderSettlementGen = () => {
    const sizeTypes = ['thorp', 'hamlet', 'village', 'small_town', 'large_town', 'small_city', 'large_city', 'metropolis'];
    const handleGenerate = (size) => {
      const settlement = dmTools.generateSettlement(size);
      setSettlementState({ generated: settlement, sizeType: size });
      addLog?.(`Settlement generated: ${settlement.name} (${settlement.size || size})`, 'info');
    };
    return (
      <div>
        <div style={styles.subtitle}>Generate Settlement</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
          <button style={styles.btn} onClick={() => handleGenerate(null)}>Random</button>
          {sizeTypes.map(s => (
            <button key={s} style={styles.btn} onClick={() => handleGenerate(s)}>{s.replace('_', ' ')}</button>
          ))}
        </div>
        {settlementState.generated && (
          <div style={styles.result}>
            <div style={styles.value}>{settlementState.generated.name}</div>
            <div style={{ fontSize: '12px', textTransform: 'capitalize' }}>{settlementState.generated.size || settlementState.sizeType} — {settlementState.generated.government || 'Council'}</div>
            {settlementState.generated.population && <div><span style={styles.label}>Population: </span>{settlementState.generated.population}</div>}
            {settlementState.generated.baseValue && <div><span style={styles.label}>Base Value: </span>{settlementState.generated.baseValue} gp</div>}
            {settlementState.generated.purchaseLimit && <div><span style={styles.label}>Purchase Limit: </span>{settlementState.generated.purchaseLimit} gp</div>}
            {settlementState.generated.spellcasting && <div><span style={styles.label}>Spellcasting: </span>Up to level {settlementState.generated.spellcasting}</div>}
            {settlementState.generated.qualities && (
              <div style={{ marginTop: '4px' }}>
                <span style={styles.label}>Qualities: </span>
                {settlementState.generated.qualities.map((q, i) => (
                  <span key={i} style={{ background: '#3a2a1e', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', marginRight: '4px' }}>{typeof q === 'string' ? q : q.name}</span>
                ))}
              </div>
            )}
            {settlementState.generated.modifiers && (
              <div style={{ marginTop: '4px' }}>
                <span style={styles.label}>Modifiers: </span>
                {Object.entries(settlementState.generated.modifiers || {}).map(([k, v]) => (
                  <span key={k} style={{ marginRight: '8px', fontSize: '11px' }}>{k}: <span style={v >= 0 ? styles.success : styles.danger}>{v >= 0 ? '+' : ''}{v}</span></span>
                ))}
              </div>
            )}
            <div style={{ marginTop: '8px' }}>
              <div style={styles.subtitle}>Item Availability Check</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[100, 500, 1000, 2500, 5000, 10000].map(price => {
                  const avail = dmTools.checkItemAvailability(price, settlementState.generated);
                  return (
                    <span key={price} style={{ ...styles.card, color: avail.available ? '#51cf66' : '#ff6b6b', fontSize: '10px' }}>
                      {price}gp: {avail.available ? '✓' : `${avail.chance}%`}
                    </span>
                  );
                })}
              </div>
            </div>
            <Divider width={280} />
            <div style={{ marginTop: '8px' }}>
              <div style={styles.subtitle}>Settlement Map</div>
              <SettlementMap
                name={settlementState.generated.name}
                size={settlementState.generated.size || settlementState.sizeType || 'village'}
                seed={(settlementState.generated.name || '').charCodeAt(0) || 42}
                width={320} height={260}
                style={{ marginTop: '4px' }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Campaign Pacing Panel ──
  const renderCampaignPacing = () => {
    const frameworks = dmTools.getAllFrameworks();
    return (
      <div>
        <div style={styles.subtitle}>Campaign Frameworks</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
          {frameworks.map(f => (
            <button key={f.id} style={{ ...styles.btn, ...(campaignPacingState.framework?.id === f.id ? styles.btnActive : {}) }}
              onClick={() => setCampaignPacingState(prev => ({ ...prev, framework: f }))}>{f.name || f.id}</button>
          ))}
        </div>
        {campaignPacingState.framework && (
          <div style={styles.result}>
            <div style={styles.value}>{campaignPacingState.framework.name}</div>
            <div style={{ fontSize: '12px' }}>{campaignPacingState.framework.description}</div>
            {campaignPacingState.framework.themes && (
              <div style={{ marginTop: '4px' }}><span style={styles.label}>Themes: </span>{campaignPacingState.framework.themes.join(', ')}</div>
            )}
            {campaignPacingState.framework.levels && (
              <div><span style={styles.label}>Levels: </span>{campaignPacingState.framework.levels}</div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button style={styles.btn} onClick={() => {
            const hook = dmTools.generateAdventureHook();
            setCampaignPacingState(prev => ({ ...prev, hook }));
            addLog?.(`Adventure Hook: ${hook.hook}`, 'info');
          }}>Generate Adventure Hook</button>
          <button style={styles.btn} onClick={() => {
            const twist = dmTools.generatePlotTwist();
            setCampaignPacingState(prev => ({ ...prev, twist }));
            addLog?.(`Plot Twist: ${twist.twist}`, 'info');
          }}>Generate Plot Twist</button>
        </div>
        {campaignPacingState.hook && (
          <div style={{ ...styles.result, marginTop: '8px' }}>
            <div style={styles.label}>Adventure Hook ({campaignPacingState.hook.type})</div>
            <div>{campaignPacingState.hook.hook}</div>
          </div>
        )}
        {campaignPacingState.twist && (
          <div style={{ ...styles.result, marginTop: '8px' }}>
            <div style={styles.label}>Plot Twist ({campaignPacingState.twist.category})</div>
            <div>{campaignPacingState.twist.twist}</div>
          </div>
        )}
        <div style={{ ...styles.subtitle, marginTop: '12px' }}>Story Arc Pacing</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {[6, 12, 18, 24, 36].map(n => {
            const pacing = dmTools.getStoryArcPacing(n);
            return (
              <div key={n} style={styles.card}>
                <div style={styles.value}>{n} encounters</div>
                <div style={{ fontSize: '10px' }}>{pacing.phase}</div>
                <div style={{ fontSize: '10px', color: '#8b949e' }}>Act I: {pacing.act1Encounters} | Act II: {pacing.act2Encounters} | Act III: {pacing.act3Encounters}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Verbal Duels Panel ──
  const renderVerbalDuels = () => {
    const tactics = dmTools.getVerbalTactics();
    const handleInit = () => {
      if (party.length === 0) return;
      const char = party[0];
      const duel = dmTools.initVerbalDuel(
        { name: char.name, cha: char.abilities?.CHA || 10, level: char.level || 1 },
        { name: 'Opponent', cha: 14, level: 5 }
      );
      setVerbalDuelState(duel);
      addLog?.(`Verbal duel: ${duel.description}`, 'info');
    };
    const handleExchange = (tactic) => {
      if (!verbalDuelState || verbalDuelState.resolved) return;
      const defenderTactic = tactics[Math.floor(Math.random() * tactics.length)].name;
      const result = dmTools.resolveVerbalExchange(verbalDuelState, tactic, defenderTactic);
      setVerbalDuelState(result);
      if (result.lastExchange) {
        addLog?.(`Verbal duel: ${result.lastExchange.description || `Used ${tactic} vs ${defenderTactic}`}`, 'info');
      }
      if (result.resolved) {
        addLog?.(`Verbal duel won by ${result.winner}!`, 'success');
      }
    };
    return (
      <div>
        {!verbalDuelState ? (
          <div>
            <div style={{ color: '#8b949e', marginBottom: '12px' }}>Verbal duels are contests of rhetoric where opponents use tactics to reduce each other's determination.</div>
            <button style={styles.btn} onClick={handleInit}>Start Verbal Duel</button>
            <div style={{ ...styles.subtitle, marginTop: '12px' }}>Available Tactics</div>
            <div style={styles.grid}>
              {tactics.map(t => (
                <div key={t.name} style={styles.card}>
                  <div style={styles.value}>{t.name}</div>
                  <div style={{ fontSize: '10px' }}>Impact: {t.impact}</div>
                  <div style={{ fontSize: '10px', color: '#8b949e' }}>{t.description}</div>
                  {t.counters?.length > 0 && <div style={{ fontSize: '10px', color: '#ff9966' }}>Counters: {t.counters.join(', ')}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <div style={styles.value}>{verbalDuelState.participant1?.name}</div>
                <div>Determination: <span style={verbalDuelState.participant1?.determination > 0 ? styles.success : styles.danger}>{verbalDuelState.participant1?.determination}/{verbalDuelState.participant1?.startDetermination}</span></div>
              </div>
              <div style={{ textAlign: 'center', color: '#ffd700' }}>VS<br />Exchange {verbalDuelState.exchanges}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={styles.value}>{verbalDuelState.participant2?.name}</div>
                <div>Determination: <span style={verbalDuelState.participant2?.determination > 0 ? styles.success : styles.danger}>{verbalDuelState.participant2?.determination}/{verbalDuelState.participant2?.startDetermination}</span></div>
              </div>
            </div>
            {verbalDuelState.resolved ? (
              <div style={{ textAlign: 'center', padding: '12px', background: '#1a3a1e', borderRadius: '4px' }}>
                <div style={{ ...styles.value, fontSize: '16px' }}>{verbalDuelState.winner} wins!</div>
                <button style={{ ...styles.btn, marginTop: '8px' }} onClick={() => setVerbalDuelState(null)}>New Duel</button>
              </div>
            ) : (
              <div>
                <div style={styles.subtitle}>Choose Your Tactic</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {tactics.map(t => (
                    <button key={t.name} style={styles.btn} onClick={() => handleExchange(t.name)}>{t.name} ({t.impact})</button>
                  ))}
                </div>
              </div>
            )}
            <button style={{ ...styles.btn, marginTop: '8px' }} onClick={() => setVerbalDuelState(null)}>End Duel</button>
          </div>
        )}
      </div>
    );
  };

  // ── Skill Challenges Panel ──
  const renderSkillChallenges = () => {
    const apl = party.length > 0 ? dmTools.calculateAPL(party) : 1;
    const handleInit = (complexity) => {
      const challenge = dmTools.initSkillChallenge(complexity, apl);
      setSkillChallengeState(challenge);
      addLog?.(`Skill challenge started: ${challenge.description}`, 'info');
    };
    const handleCheck = (charIdx, skillName, isPrimary) => {
      if (!skillChallengeState || skillChallengeState.resolved) return;
      const char = party[charIdx];
      const result = dmTools.attemptSkillCheck(
        { ...skillChallengeState },
        { name: char.name, skill_bonus: char.skills?.[skillName.toLowerCase()] || 0 },
        skillName,
        isPrimary
      );
      setSkillChallengeState(result.challenge);
      addLog?.(`Skill Check: ${result.check.description}`, result.check.success ? 'success' : 'info');
      if (result.challenge.resolved) {
        addLog?.(`Skill challenge ${result.challenge.result}!`, result.challenge.result === 'success' ? 'success' : 'danger');
      }
    };
    const commonSkills = ['Diplomacy', 'Perception', 'Stealth', 'Knowledge', 'Bluff', 'Intimidate', 'Survival', 'Disable Device', 'Acrobatics'];
    return (
      <div>
        {!skillChallengeState ? (
          <div>
            <div style={{ color: '#8b949e', marginBottom: '12px' }}>Skill challenges are extended tasks requiring multiple successes before accumulating too many failures.</div>
            <div style={styles.subtitle}>Start Challenge (Complexity 1-5)</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {[1, 2, 3, 4, 5].map(c => (
                <button key={c} style={styles.btn} onClick={() => handleInit(c)}>
                  Complexity {c}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <span style={styles.label}>Successes: </span>
                <span style={styles.success}>{skillChallengeState.successes}/{skillChallengeState.successesNeeded}</span>
              </div>
              <div>
                <span style={styles.label}>Failures: </span>
                <span style={styles.danger}>{skillChallengeState.failures}/{skillChallengeState.failuresAllowed}</span>
              </div>
              <div>
                <span style={styles.label}>Primary DC: </span><span style={styles.value}>{skillChallengeState.primaryDC}</span>
                <span style={{ ...styles.label, marginLeft: '8px' }}>Secondary DC: </span><span style={styles.value}>{skillChallengeState.secondaryDC}</span>
              </div>
            </div>
            {skillChallengeState.resolved ? (
              <div style={{ textAlign: 'center', padding: '12px', background: skillChallengeState.result === 'success' ? '#1a3a1e' : '#3a1a1e', borderRadius: '4px' }}>
                <div style={{ ...styles.value, fontSize: '16px', color: skillChallengeState.result === 'success' ? '#51cf66' : '#ff6b6b' }}>
                  Challenge {skillChallengeState.result === 'success' ? 'Succeeded!' : 'Failed!'}
                </div>
                <button style={{ ...styles.btn, marginTop: '8px' }} onClick={() => setSkillChallengeState(null)}>New Challenge</button>
              </div>
            ) : (
              <div>
                {party.length > 0 && (
                  <div>
                    <div style={styles.subtitle}>Select Character & Skill</div>
                    {party.map((c, ci) => (
                      <div key={c.id} style={{ marginBottom: '8px' }}>
                        <div style={{ ...styles.value, marginBottom: '4px' }}>{c.name}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                          {commonSkills.map(s => (
                            <button key={s} style={{ ...styles.btn, fontSize: '10px', padding: '2px 6px' }} onClick={() => handleCheck(ci, s, true)}>{s}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {skillChallengeState.checks?.length > 0 && (
              <div style={{ ...styles.result, marginTop: '8px', maxHeight: '120px', overflowY: 'auto' }}>
                <div style={styles.label}>Check History</div>
                {skillChallengeState.checks.map((ch, i) => (
                  <div key={i} style={{ fontSize: '10px', color: ch.success ? '#51cf66' : '#ff6b6b' }}>
                    {ch.character}: {ch.skill} — {ch.total} vs DC {ch.dc} ({ch.success ? 'Success' : 'Failure'})
                  </div>
                ))}
              </div>
            )}
            <button style={{ ...styles.btn, marginTop: '8px' }} onClick={() => setSkillChallengeState(null)}>End Challenge</button>
          </div>
        )}
      </div>
    );
  };

  // ── Planes Panel ──
  const renderPlanes = () => {
    const allPlanes = dmTools.getAllPlanes();
    return (
      <div>
        <div style={styles.subtitle}>Planes of Existence</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
          {allPlanes.map(p => (
            <button key={p.name} style={{ ...styles.btn, ...(planesState.selected?.name === p.name ? styles.btnActive : {}) }}
              onClick={() => setPlanesState(prev => ({ ...prev, selected: p }))}>{p.name}</button>
          ))}
        </div>
        {planesState.selected && (
          <div style={styles.result}>
            <div style={styles.value}>{planesState.selected.name}</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>{planesState.selected.description}</div>
            {planesState.selected.gravity && <div><span style={styles.label}>Gravity: </span>{planesState.selected.gravity}</div>}
            {planesState.selected.time && <div><span style={styles.label}>Time: </span>{planesState.selected.time}</div>}
            {planesState.selected.magic && <div><span style={styles.label}>Magic: </span>{planesState.selected.magic}</div>}
            {planesState.selected.alignment && <div><span style={styles.label}>Alignment: </span>{planesState.selected.alignment}</div>}
            {planesState.selected.hazards && (
              <div style={{ marginTop: '8px' }}>
                <div style={styles.subtitle}>Hazards</div>
                {planesState.selected.hazards.map((h, i) => (
                  <div key={i} style={{ ...styles.card, marginTop: '4px' }}>
                    <div style={styles.danger}>{h.name || `Hazard ${i + 1}`}</div>
                    <div style={{ fontSize: '10px' }}>{h.description}</div>
                    {h.dc && <div style={{ fontSize: '10px' }}>DC: {h.dc}</div>}
                    {h.damage && <div style={{ fontSize: '10px' }}>Damage: {h.damage}</div>}
                  </div>
                ))}
              </div>
            )}
            {party.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <button style={styles.btn} onClick={() => {
                  const char = party[0];
                  const effect = dmTools.getPlanarHazardEffects(planesState.selected.name, char);
                  addLog?.(`Planar hazard on ${planesState.selected.name}: ${effect.description}`, 'danger');
                }}>Roll Planar Hazard</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Calendar Panel ──
  const renderCalendar = () => {
    const month = dmTools.getMonth(calendarState.currentMonth);
    const holidays = dmTools.getHolidaysForMonth(calendarState.currentMonth);
    const season = dmTools.getSeasonForMonth(calendarState.currentMonth);
    const currentDay = worldState.currentDay || 1;
    const currentHour = worldState.currentHour || 8;
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <button style={styles.btn} onClick={() => setCalendarState(prev => ({ ...prev, currentMonth: (prev.currentMonth + 11) % 12 }))}>◀ Prev</button>
          <div>
            <span style={styles.value}>{month?.name || `Month ${calendarState.currentMonth + 1}`}</span>
            <span style={{ ...styles.label, marginLeft: '8px' }}>({season})</span>
          </div>
          <button style={styles.btn} onClick={() => setCalendarState(prev => ({ ...prev, currentMonth: (prev.currentMonth + 1) % 12 }))}>Next ▶</button>
        </div>
        {month?.description && <div style={{ fontSize: '12px', marginBottom: '8px' }}>{month.description}</div>}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
          <div><span style={styles.label}>Current Day: </span><span style={styles.value}>{currentDay}</span></div>
          <div><span style={styles.label}>Current Hour: </span><span style={styles.value}>{currentHour}:00</span></div>
        </div>
        <div style={styles.subtitle}>Advance Time</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
          {[1, 4, 8, 12, 24, 168].map(hours => (
            <button key={hours} style={styles.btn} onClick={() => {
              const result = dmTools.advanceTime(currentDay, currentHour, hours);
              updateWorld('currentDay', result.newDay);
              updateWorld('currentHour', result.newHour);
              addLog?.(`Time advanced: ${hours < 24 ? hours + ' hours' : Math.floor(hours / 24) + ' days'}. Now day ${result.newDay}, ${result.newHour}:00`, 'system');
            }}>
              {hours < 24 ? `+${hours}h` : `+${Math.floor(hours / 24)}d`}
            </button>
          ))}
        </div>
        {holidays && holidays.length > 0 && (
          <div>
            <div style={styles.subtitle}>Holidays & Events</div>
            {holidays.map((h, i) => (
              <div key={i} style={{ ...styles.card, marginTop: '4px' }}>
                <div style={styles.warning}>{h.name || `Holiday ${i + 1}`}</div>
                {h.day && <div style={{ fontSize: '10px' }}>Day: {h.day}</div>}
                <div style={{ fontSize: '10px' }}>{h.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Party Progression Dashboard ──
  const renderPartyProgress = () => {
    const apl = party.length > 0 ? dmTools.calculateAPL(party) : 0;
    const globalTrack = worldState?.dmPreferences?.xpTrack || 'medium';
    const totalPartyXP = party.reduce((s, c) => s + (c.xp || 0), 0);
    const avgXP = party.length > 0 ? Math.floor(totalPartyXP / party.length) : 0;
    const minLevel = party.length > 0 ? Math.min(...party.map(c => c.level || 1)) : 0;
    const maxLevel = party.length > 0 ? Math.max(...party.map(c => c.level || 1)) : 0;
    const questsCompleted = (worldState?.quests || []).filter(q => q.status === 'completed').length;
    const questsActive = (worldState?.quests || []).filter(q => q.status === 'active').length;

    return (
      <div>
        {/* Party Summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', marginBottom: '16px' }}>
          {[
            { label: 'Party Size', value: party.length, color: '#ffd700' },
            { label: 'Avg Party Level', value: apl, color: '#ffd700' },
            { label: 'Level Range', value: party.length > 0 ? (minLevel === maxLevel ? `${minLevel}` : `${minLevel}-${maxLevel}`) : '—', color: '#87ceeb' },
            { label: 'Total Party XP', value: totalPartyXP.toLocaleString(), color: '#51cf66' },
            { label: 'XP Track', value: globalTrack.charAt(0).toUpperCase() + globalTrack.slice(1), color: '#ffa500' },
            { label: 'Quests Active', value: questsActive, color: '#7b68ee' },
            { label: 'Quests Done', value: questsCompleted, color: '#51cf66' },
            { label: 'Day', value: worldState?.currentDay || 1, color: '#87ceeb' },
          ].map((stat, i) => (
            <div key={i} style={{ ...styles.card, textAlign: 'center' }}>
              <div style={{ ...styles.label, marginBottom: '4px' }}>{stat.label}</div>
              <div style={{ color: stat.color, fontSize: '18px', fontWeight: 'bold' }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Character Progress */}
        <div style={styles.subtitle}>Character Progression</div>
        {party.length === 0 ? (
          <div style={{ color: '#8b949e', fontStyle: 'italic' }}>No party members yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {party.map(c => {
              const track = c.xpTrack || globalTrack;
              const progress = dmTools.getXPToNextLevel(c.xp || 0, c.level || 1, track);
              const levelUp = dmTools.checkLevelUp(c.xp || 0, c.level || 1, track);
              const pct = progress.nextLevelXP > 0 ? Math.min(100, Math.floor(((c.xp || 0) / progress.nextLevelXP) * 100)) : 100;
              return (
                <div key={c.id} style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ minWidth: '100px' }}>
                    <div style={styles.value}>{c.name}</div>
                    <div style={{ fontSize: '10px', color: '#8b949e' }}>
                      {c.race || '?'} {c.className || '?'} {c.level || 1}
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
                      <span>{c.xp || 0} XP</span>
                      <span>{progress.xpNeeded > 0 ? `${progress.xpNeeded} to lvl ${(c.level || 1) + 1}` : 'MAX'}</span>
                    </div>
                    <div style={{ background: '#333', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                      <div style={{ background: levelUp.shouldLevel ? '#51cf66' : '#ffd700', width: `${pct}%`, height: '100%', borderRadius: '4px', transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: '9px', color: '#8b949e', marginTop: '2px' }}>
                      {track} track | HP: {c.currentHP || 0}/{c.maxHP || 0} | AC: {c.ac || 10}
                    </div>
                  </div>
                  {levelUp.shouldLevel && (
                    <div style={{ ...styles.success, fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>LEVEL UP!</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Regional Hex Map */}
        <div style={styles.subtitle}>Regional Overview</div>
        <div style={{ marginBottom: '16px' }}>
          <HexMap width={560} height={280} />
          <MapLegend terrains={['forest','plains','hills','mountains','swamp','water','urban','coastal','desert']} style={{ marginTop: '6px' }} />
        </div>
        <Divider width={400} />

        {/* World State Summary */}
        <div style={styles.subtitle}>World State</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px' }}>
          {worldState?.kingdom && (
            <div style={styles.card}>
              <div style={styles.label}>Kingdom</div>
              <div style={styles.value}>{worldState.kingdom.name || 'Unnamed'}</div>
            </div>
          )}
          {(worldState?.fame || 0) > 0 && (
            <div style={styles.card}>
              <div style={styles.label}>Fame / Infamy</div>
              <div style={styles.value}>{worldState.fame || 0} / {worldState.infamy || 0}</div>
            </div>
          )}
          {(worldState?.armies || []).length > 0 && (
            <div style={styles.card}>
              <div style={styles.label}>Armies</div>
              <div style={styles.value}>{worldState.armies.length}</div>
            </div>
          )}
          {(worldState?.contacts || []).length > 0 && (
            <div style={styles.card}>
              <div style={styles.label}>Contacts</div>
              <div style={styles.value}>{worldState.contacts.length}</div>
            </div>
          )}
          {(worldState?.tradeRoutes || []).length > 0 && (
            <div style={styles.card}>
              <div style={styles.label}>Trade Routes</div>
              <div style={styles.value}>{worldState.tradeRoutes.length}</div>
            </div>
          )}
          {(worldState?.ownedBuildings || []).length > 0 && (
            <div style={styles.card}>
              <div style={styles.label}>Buildings</div>
              <div style={styles.value}>{worldState.ownedBuildings.length}</div>
            </div>
          )}
          {worldState?.currentWeather && (
            <div style={styles.card}>
              <div style={styles.label}>Weather</div>
              <div style={{ fontSize: '11px' }}>{worldState.currentWeather.description || 'Clear'}</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const panelRenderers = {
    weather: renderWeather,
    encounters: renderEncounters,
    traps: renderTraps,
    haunts: renderHaunts,
    hazards: renderHazards,
    treasure: renderTreasure,
    chase: renderChase,
    npc: renderNPC,
    downtime: renderDowntime,
    kingdom: renderKingdom,
    orgs: renderOrgs,
    retraining: renderRetraining,
    massCombat: renderMassCombat,
    reputation: renderReputation,
    honor: renderHonor,
    contacts: renderContacts,
    investigations: renderInvestigations,
    sanity: renderSanity,
    crafting: renderCrafting,
    gambling: renderGambling,
    disasters: renderDisasters,
    tradeRoutes: renderTradeRoutes,
    espionage: renderEspionage,
    alignment: renderAlignment,
    lineage: renderLineage,
    retirement: renderRetirement,
    encounterBuilder: renderEncounterBuilder,
    xpCalc: renderXPCalc,
    npcAttitudes: renderNPCAttitudes,
    settlementGen: renderSettlementGen,
    campaignPacing: renderCampaignPacing,
    verbalDuels: renderVerbalDuels,
    skillChallenges: renderSkillChallenges,
    planes: renderPlanes,
    calendar: renderCalendar,
    partyProgress: renderPartyProgress,
  };

  const visiblePanels = PANELS.filter(p => !p.override || showGMOverrides);
  const activeInfo = PANELS.find(p => p.id === activePanel);

  return (
    <div style={styles.container}>
      {/* GM Override Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={styles.nav}>
          {visiblePanels.map(p => (
            <button
              key={p.id}
              style={{ ...styles.btn, ...(activePanel === p.id ? styles.btnActive : {}), ...(p.override ? { borderStyle: 'dashed', opacity: 0.85 } : {}) }}
              onClick={() => setActivePanel(p.id)}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* GM Override Switch */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', padding: '8px 12px', backgroundColor: showGMOverrides ? 'rgba(255, 165, 0, 0.1)' : 'rgba(255, 255, 255, 0.03)', border: `1px solid ${showGMOverrides ? 'rgba(255, 165, 0, 0.3)' : 'rgba(255, 215, 0, 0.1)'}`, borderRadius: '4px' }}>
        <div
          style={{
            width: '40px', height: '22px', borderRadius: '11px', cursor: 'pointer',
            backgroundColor: showGMOverrides ? '#5a3a00' : '#2a2a2e',
            border: `1px solid ${showGMOverrides ? '#ffa500' : '#4a3b2a'}`,
            position: 'relative', transition: 'all 0.2s', flexShrink: 0,
          }}
          onClick={() => {
            setShowGMOverrides(!showGMOverrides);
            // If active panel is an override panel being hidden, switch to partyProgress
            if (showGMOverrides && PANELS.find(p => p.id === activePanel)?.override) {
              setActivePanel('partyProgress');
            }
          }}
        >
          <div style={{
            width: '16px', height: '16px', borderRadius: '50%',
            backgroundColor: showGMOverrides ? '#ffa500' : '#666',
            position: 'absolute', top: '2px',
            left: showGMOverrides ? '20px' : '2px',
            transition: 'all 0.2s',
          }} />
        </div>
        <div>
          <div style={{ color: showGMOverrides ? '#ffa500' : '#8b949e', fontSize: '12px', fontWeight: 'bold' }}>
            GM Manual Overrides {showGMOverrides ? 'ON' : 'OFF'}
          </div>
          <div style={{ color: '#8b949e', fontSize: '10px' }}>
            {showGMOverrides ? 'Manual tools visible — weather, encounters, settlements, treasure, etc.' : 'These systems run automatically via the Game Event Engine. Toggle on for manual control.'}
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.title}>{activeInfo?.icon} {activeInfo?.label}</div>
        {panelRenderers[activePanel]?.()}
      </div>
    </div>
  );
}
