import { useState, useEffect, useRef, useCallback } from 'react';
import db from './db/database';
import { seedDatabase } from './db/seed';
import { uid, rollDice } from './utils/dice';
import dmEngine from './services/dmEngine';
import gameEvents from './services/gameEventEngine';
import { calculateEncounterXP, getXPForCR, checkLevelUp } from './services/dmToolsService';
import { autoSave } from './services/saveGame';
import { autoSaveToFile, hasFileHandle } from './services/fileSave';
import useIsMobile from './hooks/useIsMobile';

// ── Tab components ──
import CampaignSelector from './components/CampaignSelector';
import AdventureTab from './components/AdventureTab';
import PartyTab from './components/PartyTab';
import GMReferenceTab from './components/GMReferenceTab';
import SettingsTab from './components/SettingsTab';

// ── Slide-in panel content ──
import SlidePanel from './components/SlidePanel';
import CombatTab from './components/CombatTab';
import ShopTab from './components/ShopTab';
import DiceRoller from './components/DiceRoller';
import MapTab from './components/MapTab';

// Only 5 main tabs now
const TABS = ['Campaign', 'Adventure', 'Party', 'Settings'];

// Tab icons for mobile bottom nav
const TAB_ICONS = {
  Campaign: '\u{1F4DC}',
  Adventure: '\u2694\uFE0F',
  Party: '\u{1F9D9}',
  Settings: '\u2699\uFE0F',
  'GM Reference': '\u{1F4D6}',
};

function App() {
  const isMobile = useIsMobile();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('Campaign');
  const [campaign, setCampaign] = useState(null);    // restored async after DB seeds
  const [party, setParty] = useState(() => {
    try { const s = loadLiveState(); return s?.party || []; } catch { return []; }
  });
  const [gameLog, setGameLog] = useState(() => {
    try { const s = loadLiveState(); return s?.gameLog || []; } catch { return []; }
  });
  const [combat, setCombat] = useState(() => {
    try { const s = loadLiveState(); return s?.combat || null; } catch { return null; }
  });
  const [adventure, setAdventure] = useState(() => {
    try { const s = loadLiveState(); return s?.adventure || null; } catch { return null; }
  });
  const [classesMap, setClassesMap] = useState({});
  const [gmMode, setGmMode] = useState(false);

  // ── Slide panel state ──
  const [panels, setPanels] = useState({
    combat: false,
    shop: false,
    dice: false,
    map: false,
  });

  const openPanel = useCallback((name) => {
    setPanels(prev => ({ ...prev, [name]: true }));
  }, []);

  const closePanel = useCallback((name) => {
    setPanels(prev => ({ ...prev, [name]: false }));
  }, []);

  // Load persisted state from localStorage
  const loadGmMapData = () => {
    try {
      const raw = localStorage.getItem('pf-gm-map-data');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };

  const loadLiveState = () => {
    try {
      const raw = localStorage.getItem('pf-live-state');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };

  // Persistent world state — survives tab switches and is autosaved
  const gmSaved = loadGmMapData();
  const _savedLive = loadLiveState();
  const _savedWorld = _savedLive?.worldState;
  const defaultWorldState = {
    downtimeCapital: { goods: 0, influence: 0, labor: 0, magic: 0 },
    ownedBuildings: [],
    kingdom: null,
    organizations: [],
    armies: [],
    fame: 0,
    infamy: 0,
    honor: null,
    contacts: [],
    activeCases: [],
    foundClues: [],
    sanity: {},
    craftingQueue: [],
    tradeRoutes: [],
    caravans: [],
    spyNetworks: [],
    alignmentInfractions: {},
    retiredCharacters: [],
    currentWeather: null,
    currentDay: 1,
    currentHour: 8,
    afflictions: [],
    gamblingNet: 0,
    mythic: {
      chaosFactor: 5,
      threads: [],
      characters: [],
      sceneCount: 0,
    },
    revealedLocations: ['sandpoint'],
    partyPosition: { locationId: 'sandpoint', x: null, y: null },
    // Scene state (persisted so NPCs, items, and actions survive reloads)
    nearbyNPCs: [],
    areaItems: [],
    contextActions: [],
    // Hex crawl state
    partyHex: null,           // current hex key like "5,4"
    exploredHexes: [],        // array of hex keys the party has explored
    hexCrawlActive: false,    // whether hex crawl mode is on
    hexExploring: null,       // hex key currently being explored
    hexExplorationDaysLeft: 0,// days remaining to finish exploring current hex
    travelLog: [],            // hex crawl travel log entries
  };
  const [worldState, setWorldState] = useState({
    ...defaultWorldState,
    // Merge saved world state (if any)
    ...(_savedWorld || {}),
    // GM map data — always from its own localStorage key (canonical source)
    gmPins: gmSaved.gmPins || _savedWorld?.gmPins || {},
    gmPinOverrides: gmSaved.gmPinOverrides || _savedWorld?.gmPinOverrides || {},
    gmHiddenPins: gmSaved.gmHiddenPins || _savedWorld?.gmHiddenPins || {},
    gmRegions: gmSaved.gmRegions || _savedWorld?.gmRegions || {},
    gmHexTerrain: gmSaved.gmHexTerrain || _savedWorld?.gmHexTerrain || {},
  });
  const logRef = useRef(null);

  // Auto-persist GM map data to localStorage whenever it changes
  useEffect(() => {
    const data = {
      gmPins: worldState.gmPins,
      gmPinOverrides: worldState.gmPinOverrides,
      gmHiddenPins: worldState.gmHiddenPins,
      gmRegions: worldState.gmRegions,
      gmHexTerrain: worldState.gmHexTerrain,
    };
    // Only write if there's actual data
    if (data.gmPins || data.gmPinOverrides || data.gmHiddenPins || data.gmRegions || data.gmHexTerrain) {
      localStorage.setItem('pf-gm-map-data', JSON.stringify(data));
    }
  }, [worldState.gmPins, worldState.gmPinOverrides, worldState.gmHiddenPins, worldState.gmRegions, worldState.gmHexTerrain]);

  // Auto-persist ALL live game state to localStorage on every change
  // (debounced — writes at most once per second)
  const persistTimerRef = useRef(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        const state = {
          party,
          campaign: campaign ? {
            dataId: campaign.data?.id,
            currentChapter: campaign.currentChapter,
            currentPart: campaign.currentPart,
            completedEncounters: campaign.completedEncounters || [],
            partyLevel: campaign.partyLevel || 1,
            started: campaign.started,
          } : null,
          adventure,
          combat,
          gameLog: (gameLog || []).slice(-300),
          worldState,
        };
        localStorage.setItem('pf-live-state', JSON.stringify(state));
      } catch (e) {
        console.warn('[Persist] Failed to save live state:', e);
      }
    }, 1000);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [party, campaign, adventure, combat, gameLog, worldState]);

  useEffect(() => {
    (async () => {
      await seedDatabase();
      const classes = await db.classes.toArray();
      const map = {};
      classes.forEach(c => { map[c.name] = c; });
      setClassesMap(map);

      // Restore campaign from saved live state (needs DB to be seeded first)
      const saved = loadLiveState();
      if (saved?.campaign?.dataId) {
        try {
          const campaignData = await db.campaignData.get(saved.campaign.dataId);
          if (campaignData) {
            setCampaign({
              data: campaignData,
              currentChapter: saved.campaign.currentChapter,
              currentPart: saved.campaign.currentPart,
              completedEncounters: saved.campaign.completedEncounters || [],
              partyLevel: saved.campaign.partyLevel || 1,
              started: saved.campaign.started,
            });
          }
        } catch (e) {
          console.warn('[Restore] Failed to restore campaign:', e);
        }
      }

      // Restore tab to Adventure if there's an active game
      if (saved?.party?.length > 0 || saved?.campaign) {
        setTab(saved?.campaign ? 'Adventure' : 'Party');
      }

      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [gameLog]);

  const addLog = useCallback((text, type = 'narration') => {
    setGameLog(prev => [...prev, { id: uid(), text, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  const updateCharHP = useCallback((charId, delta) => {
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      const newHP = Math.max(-(c.abilities.CON || 10), Math.min(c.maxHP, c.currentHP + delta));
      return { ...c, currentHP: newHP };
    }));
  }, []);

  // Autosave every 2 minutes when game is active (IndexedDB + file if linked)
  useEffect(() => {
    if (!ready || (party.length === 0 && !campaign)) return;
    const liveState = { party, campaign, adventure, combat, gameLog, worldState };
    const timer = setInterval(() => {
      autoSave(liveState).catch(console.error);
      if (hasFileHandle()) {
        autoSaveToFile(liveState).catch(console.error);
      }
    }, 120000);
    return () => clearInterval(timer);
  }, [ready, party, campaign, adventure, combat, gameLog, worldState]);

  // Handle loading a saved game
  const handleLoadGame = useCallback((data) => {
    setParty(data.party || []);
    setCampaign(data.campaign || null);
    setAdventure(data.adventure || null);
    setCombat(data.combat || null);
    setGameLog(data.gameLog || []);
    if (data.worldState) setWorldState(prev => ({ ...prev, ...data.worldState }));
    addLog('Game loaded.', 'system');
    // Switch to most relevant tab; open combat panel if active
    if (data.combat?.active) {
      setTab('Adventure');
      openPanel('combat');
    } else if (data.campaign) {
      setTab('Adventure');
    } else if (data.adventure?.active) {
      setTab('Adventure');
    } else {
      setTab('Party');
    }
  }, [addLog, openPanel]);

  // ── Start combat (opens slide panel instead of switching tabs) ──
  const startCombat = useCallback((combatData) => {
    setCombat(combatData);
    openPanel('combat');
  }, [openPanel]);

  const endCombat = useCallback(async (victory) => {
    if (victory) {
      const victoryNarration = dmEngine.narrateCombatAction('victory', {});
      addLog(victoryNarration, 'success');

      const crList = (combat?.enemies || []).map(e => {
        if (e.fled || e.surrendered) return null;
        if (e.currentHP <= 0) return e.cr || 1;
        return null;
      }).filter(Boolean);
      const fledXP = (combat?.enemies || []).filter(e => e.fled || e.surrendered)
        .reduce((s, e) => s + Math.floor(getXPForCR(e.cr || 1) / 2), 0);

      const encounterResult = crList.length > 0
        ? calculateEncounterXP(crList, party.length || 1)
        : { totalXP: 0, perCharXP: 0, difficulty: 'None' };

      const totalXP = encounterResult.totalXP + fledXP;
      const xpEach = party.length > 0 ? Math.floor(totalXP / party.length) : 0;

      addLog(`Experience earned: ${totalXP} XP (${xpEach} each) — ${encounterResult.difficulty} encounter`, 'loot');
      setParty(prev => prev.map(c => {
        const newXP = (c.xp || 0) + xpEach;
        const currentLevel = c.level || 1;
        const xpTrack = c.xpTrack || worldState?.dmPreferences?.xpTrack || 'medium';
        const levelStatus = checkLevelUp(newXP, currentLevel, xpTrack);
        if (levelStatus.shouldLevel && currentLevel < 20) {
          addLog(`${c.name} has enough XP to reach level ${currentLevel + 1}! (${newXP}/${levelStatus.nextLevelXP} XP)`, 'success');
        }
        return { ...c, xp: newXP };
      }));

      if (!combat?.campaignEncounterId) {
        const avgCR = combat?.enemies?.reduce((s, e) => s + (e.cr || 1), 0) / (combat?.enemies?.length || 1);
        const goldReward = Math.floor((avgCR * 100 + rollDice(4, 10).total) * (combat?.enemies?.length || 1));
        if (goldReward > 0) {
          addLog(`Treasure found: ${goldReward} gold pieces!`, 'loot');
        }
      }

      if (combat?.campaignEncounterId) {
        setCampaign(prev => prev ? {
          ...prev,
          completedEncounters: [...(prev.completedEncounters || []), combat.campaignEncounterId],
        } : prev);

        if (combat.campaignRewards?.items) {
          addLog('Loot found:', 'loot');
          combat.campaignRewards.items.forEach(item => addLog(`  \u2022 ${item}`, 'loot'));
        }

        if (dmEngine.isAIAvailable() && combat.encounterData) {
          try {
            const result = await dmEngine.narrate('victory', {
              campaign, party, encounter: combat.encounterData, combat,
              recentLog: gameLog.slice(-10),
            });
            addLog(result.text, 'narration');
          } catch { /* fallback already handled above */ }
        }
      }

      const combatEffects = gameEvents.onCombatEnd({
        worldState, party, combat, victory: true, campaign,
      });
      if (Object.keys(combatEffects.worldUpdates).length > 0) {
        setWorldState(prev => gameEvents.applyWorldUpdates(prev, combatEffects.worldUpdates));
      }
      gameEvents.eventsToLog(combatEffects.events).forEach(e => addLog(e.text, e.type));

    } else {
      addLog('=== COMBAT ENDED ===', 'system');
      const defeatEffects = gameEvents.onCombatEnd({
        worldState, party, combat, victory: false, campaign,
      });
      if (Object.keys(defeatEffects.worldUpdates).length > 0) {
        setWorldState(prev => gameEvents.applyWorldUpdates(prev, defeatEffects.worldUpdates));
      }
      gameEvents.eventsToLog(defeatEffects.events).forEach(e => addLog(e.text, e.type));
    }
    setCombat(null);
    closePanel('combat');
  }, [combat, party.length, addLog, campaign, gameLog, worldState, closePanel]);

  // ── Auto-open combat panel when combat starts ──
  useEffect(() => {
    if (combat?.active && !panels.combat) {
      openPanel('combat');
    }
  }, [combat?.active]);

  if (!ready) {
    return (
      <div style={{ background: '#1a1a2e', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffd700', fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u2694\uFE0F'}</div>
          <div style={{ fontSize: 18 }}>Loading Pathfinder Database...</div>
        </div>
      </div>
    );
  }

  // Build tab list — inject GM Reference when gmMode is on
  const visibleTabs = gmMode
    ? ['Campaign', 'Adventure', 'Party', 'GM Reference', 'Settings']
    : TABS;

  return (
    <div style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', minHeight: '100vh', color: '#e0d6c8', fontFamily: "'Segoe UI',system-ui,sans-serif", display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header — compact on mobile */}
      <div style={{
        background: 'linear-gradient(90deg, #2d1b00, #4a2800 50%, #2d1b00)',
        borderBottom: '2px solid #8b6914',
        padding: isMobile ? '8px 12px' : '12px 20px',
        display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16,
        flexShrink: 0,
      }}>
        {!isMobile && <div style={{ fontSize: 28 }}>{'\u2694\uFE0F'}</div>}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 15 : 22, color: '#ffd700', fontWeight: 700, letterSpacing: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isMobile ? 'PF1e DM' : 'PATHFINDER DUNGEON MASTER'}
          </h1>
          {!isMobile && <div style={{ fontSize: 11, color: '#b8860b', letterSpacing: 2 }}>1ST EDITION &bull; AI GAME MASTER</div>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: isMobile ? 6 : 8, alignItems: 'center', flexShrink: 0 }}>
          {!isMobile && campaign && <span style={{ background: '#1a2a4e', padding: '4px 12px', borderRadius: 12, fontSize: 12, color: '#7b68ee' }}>{campaign.data?.name}</span>}
          {!isMobile && adventure && <span style={{ background: '#2d5016', padding: '4px 12px', borderRadius: 12, fontSize: 12, color: '#7fff00' }}>{adventure.location?.name || 'Exploring'}</span>}
          {combat?.active && <span style={{ background: '#5c1616', padding: isMobile ? '4px 8px' : '4px 12px', borderRadius: 12, fontSize: isMobile ? 10 : 12, color: '#ff6b6b', animation: 'pulse 2s infinite' }}>{isMobile ? `R${combat.round}` : `COMBAT \u2014 Round ${combat.round}`}</span>}

          {/* Quick-access buttons */}
          <button onClick={() => openPanel('dice')} title="Dice Roller"
            style={{ background: panels.dice ? '#ffd700' : '#2a2a4e', border: '1px solid #8b6914', color: panels.dice ? '#1a1a2e' : '#ffd700', cursor: 'pointer', borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px', fontSize: isMobile ? 18 : 16, minHeight: 36 }}
          >{'\u{1F3B2}'}</button>
          <button onClick={() => openPanel('map')} title="Overland Map"
            style={{ background: panels.map ? '#ffd700' : '#2a2a4e', border: '1px solid #8b6914', color: panels.map ? '#1a1a2e' : '#ffd700', cursor: 'pointer', borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px', fontSize: isMobile ? 18 : 16, minHeight: 36 }}
          >{'\u{1F5FA}\uFE0F'}</button>
          <button onClick={() => setGmMode(!gmMode)} title={gmMode ? 'GM Mode ON' : 'Enable GM Mode'}
            style={{ background: gmMode ? '#4a1a4a' : '#2a2a4e', border: `1px solid ${gmMode ? '#d946ef' : '#8b6914'}`, color: gmMode ? '#d946ef' : '#8b949e', cursor: 'pointer', borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px', fontSize: 12, fontWeight: gmMode ? 700 : 400, minHeight: 36 }}
          >GM</button>
        </div>
      </div>

      {/* Tabs — top bar on desktop, hidden on mobile (bottom nav instead) */}
      {!isMobile && (
        <div style={{ display: 'flex', background: '#0d1117', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
          {visibleTabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 24px', background: tab === t ? '#1a1a2e' : 'transparent',
              color: tab === t ? '#ffd700' : '#8b949e',
              border: 'none', borderBottom: tab === t ? '2px solid #ffd700' : '2px solid transparent',
              cursor: 'pointer', fontSize: 14, fontWeight: tab === t ? 600 : 400,
            }}>
              {t === 'Party' ? `Party (${party.length})` : t}
            </button>
          ))}
        </div>
      )}

      {/* Campaign banner — shown on non-Campaign tabs when a campaign is active */}
      {campaign && tab !== 'Campaign' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12,
          padding: isMobile ? '4px 10px' : '6px 20px',
          background: 'linear-gradient(90deg, rgba(45,27,0,0.9), rgba(74,40,0,0.7) 50%, rgba(45,27,0,0.9))',
          borderBottom: '1px solid #8b6914',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: isMobile ? 12 : 14 }}>{'\u{1F4DC}'}</span>
          <span style={{ color: '#ffd700', fontWeight: 600, fontSize: isMobile ? 11 : 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{campaign.data?.name}</span>
          {!isMobile && (() => {
            const ch = campaign.data?.chapters?.find(c => c.id === campaign.currentChapter);
            const pt = ch?.parts?.find(p => p.id === campaign.currentPart);
            return (
              <>
                {ch && <span style={{ color: '#8b949e', fontSize: 12 }}>&mdash; Ch. {ch.number}: {ch.name}</span>}
                {pt && <span style={{ color: '#6b7280', fontSize: 11 }}>&bull; {pt.name}</span>}
              </>
            );
          })()}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {(() => {
              const completed = campaign.completedEncounters?.length || 0;
              const total = campaign.data?.chapters?.reduce((s, c) => s + c.parts.reduce((s2, p) => s2 + (p.encounters?.length || 0), 0), 0) || 0;
              const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
              return (
                <>
                  <div style={{ width: isMobile ? 50 : 80, height: 4, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#ffd700', borderRadius: 2 }} />
                  </div>
                  <span style={{ color: '#8b949e', fontSize: 10 }}>{pct}%</span>
                </>
              );
            })()}
            {!isMobile && <button onClick={() => setTab('Campaign')}
              style={{ background: 'none', border: '1px solid #8b6914', borderRadius: 4, color: '#b8860b', cursor: 'pointer', fontSize: 10, padding: '2px 8px' }}
            >Manage</button>}
          </div>
        </div>
      )}

      {/* Content — flex-grow fills space between header and bottom nav */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {tab === 'Campaign' && (
          <CampaignSelector
            campaign={campaign}
            setCampaign={setCampaign}
            party={party}
            addLog={addLog}
            onStartAdventure={() => setTab('Adventure')}
          />
        )}
        {tab === 'Adventure' && (
          <AdventureTab
            adventure={adventure}
            party={party}
            combat={combat}
            addLog={addLog}
            gameLog={gameLog}
            logRef={logRef}
            setTab={setTab}
            setCombat={startCombat}
            setParty={setParty}
            setAdventure={setAdventure}
            classesMap={classesMap}
            updateCharHP={updateCharHP}
            worldState={worldState}
            setWorldState={setWorldState}
            campaign={campaign}
            setCampaign={setCampaign}
            openPanel={openPanel}
          />
        )}
        {tab === 'Party' && (
          <PartyTab
            party={party}
            setParty={setParty}
            addLog={addLog}
            updateCharHP={updateCharHP}
            classesMap={classesMap}
          />
        )}
        {tab === 'GM Reference' && gmMode && (
          <GMReferenceTab
            party={party}
            addLog={addLog}
            setCombat={startCombat}
            openCombatPanel={() => openPanel('combat')}
            worldState={worldState}
            setWorldState={setWorldState}
          />
        )}
        {tab === 'Settings' && (
          <SettingsTab
            party={party}
            campaign={campaign}
            adventure={adventure}
            combat={combat}
            gameLog={gameLog}
            worldState={worldState}
            setWorldState={setWorldState}
            onLoadGame={handleLoadGame}
          />
        )}
      </div>

      {/* ══ Slide-in panels ══ */}

      {/* Combat Panel */}
      <SlidePanel
        isOpen={panels.combat}
        onClose={() => closePanel('combat')}
        title={`Combat ${combat?.active ? `\u2014 Round ${combat.round}` : ''}`}
        width={isMobile ? '100%' : '65%'}
      >
        <CombatTab
          combat={combat}
          setCombat={setCombat}
          party={party}
          setParty={setParty}
          addLog={addLog}
          endCombat={endCombat}
          updateCharHP={updateCharHP}
          classesMap={classesMap}
          worldState={worldState}
        />
      </SlidePanel>

      {/* Shop Panel */}
      <SlidePanel
        isOpen={panels.shop}
        onClose={() => closePanel('shop')}
        title="Shop & Trading"
        width={isMobile ? '100%' : '55%'}
      >
        <ShopTab
          party={party}
          setParty={setParty}
          addLog={addLog}
          combat={combat}
          campaign={campaign}
          worldState={worldState}
          setWorldState={setWorldState}
        />
      </SlidePanel>

      {/* Dice Roller Panel */}
      <SlidePanel
        isOpen={panels.dice}
        onClose={() => closePanel('dice')}
        title="Dice Roller"
        width={isMobile ? '100%' : '350px'}
      >
        <DiceRoller addLog={addLog} />
      </SlidePanel>

      {/* Overland Map Panel */}
      <SlidePanel
        isOpen={panels.map}
        onClose={() => closePanel('map')}
        title="Overland Map"
        width={isMobile ? '100%' : '70%'}
      >
        <MapTab
          party={party}
          campaign={campaign}
          addLog={addLog}
          worldState={worldState}
          setWorldState={setWorldState}
          gmMode={gmMode}
        />
      </SlidePanel>

      {/* Mobile bottom navigation */}
      {isMobile && (
        <div style={{
          display: 'flex', justifyContent: 'space-around', alignItems: 'center',
          background: '#0d1117', borderTop: '1px solid #30363d',
          padding: '4px 0 env(safe-area-inset-bottom, 4px)', flexShrink: 0,
        }}>
          {visibleTabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t ? '#ffd700' : '#8b949e', minWidth: 54,
              borderTop: tab === t ? '2px solid #ffd700' : '2px solid transparent',
            }}>
              <span style={{ fontSize: 20 }}>{TAB_ICONS[t] || '\u{1F4C4}'}</span>
              <span style={{ fontSize: 9, fontWeight: tab === t ? 700 : 400 }}>
                {t === 'Party' ? `Party(${party.length})` : t === 'GM Reference' ? 'GM' : t}
              </span>
            </button>
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1a1a2e; }
        ::-webkit-scrollbar-thumb { background: #4a3b2a; border-radius: 4px; }
        input, select { background: #1a1a2e; color: #e0d6c8; border: 1px solid #4a3b2a; padding: 6px 10px; border-radius: 4px; }
        input:focus, select:focus { outline: none; border-color: #ffd700; }
        button { transition: all 0.15s; }
        button:hover { filter: brightness(1.15); }
      `}</style>
    </div>
  );
}

export default App;
