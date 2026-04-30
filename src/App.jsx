import { useState, useEffect, useRef, useCallback } from 'react';
import db from './db/database';
import { seedDatabase } from './db/seed';
import { uid, rollDice } from './utils/dice';
import dmEngine from './services/dmEngine';
import gameEvents from './services/gameEventEngine';
import { calculateEncounterXP, getXPForCR, checkLevelUp } from './services/dmToolsService';
import { autoSave } from './services/saveGame';
import { autoSaveToFile, hasFileHandle } from './services/fileSave';
import { isSyncConfigured, pullAndApply } from './services/gistSync';
import { recordEncounteredCreatures, recordCreaturesDefeated } from './services/bestiaryTracker';
import { emptyObservation, distillCombatObservations } from './services/combatObservation';
import { advanceNpcKnowledge } from './services/npcTracker';
import { getEffectiveMaxHP } from './utils/familiarEngine';
import useIsMobile from './hooks/useIsMobile';
import { traceEngine } from './services/engineTrace';
import { resetJournalData } from './services/journalReset';
import { setActiveCampaignDataId } from './services/campaignScope';
import { onJournalAdd, formatJournalAdd, emitJournalAdd } from './services/journalEvents';
import { setNodeStatus as setWorldNodeStatus, NODE_STATUS } from './services/worldTree';
import { hpBucket, formatHpTransition } from './services/hpTransitions';
import { getCampaignStartDate, isDefaultStartDate, CAMPAIGN_START_DATES } from './services/calendar';
import {
  pushUndoSnapshot,
  popUndoSnapshot,
  clearUndoBuffer,
  subscribeUndoDepth,
} from './services/undoBuffer';
// Bug #4 — audio narration (browser-native TTS). Minimal slice: toggle +
// speak new narration/success/journal log entries. See audioNarration.js
// for parked follow-ups (per-character voices, external TTS providers).
import audioNarration from './services/audioNarration';

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
import AdventurerJournal from './components/AdventurerJournal';
import FactionsTab from './components/FactionsTab';
import BugReportButton from './components/BugReportButton';
import MainMenu from './components/MainMenu';

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

// Bug #32: these helpers MUST be declared before any useState initializer
// that references them. Previously they were defined mid-component (after
// the useState block), so the initializer closures hit the TDZ and every
// refresh silently swallowed a ReferenceError — resulting in party/adventure/
// combat/gameLog resetting to their empty defaults even though localStorage
// held the data. Moving them to module scope (above App) removes any chance
// of a TDZ recurrence; they don't close over component-local state anyway.
function loadGmMapData() {
  try {
    const raw = localStorage.getItem('pf-gm-map-data');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function loadLiveState() {
  try {
    const raw = localStorage.getItem('pf-live-state');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function App() {
  const isMobile = useIsMobile();
  const [ready, setReady] = useState(false);
  // Bug #29: full-screen landing menu gates the main app. Auto-load is
  // suppressed — the user explicitly picks New Game / Continue / Load /
  // Settings / GM Designer from the menu before any game state is surfaced.
  const [view, setView] = useState('menu'); // 'menu' | 'app'
  const [tab, setTab] = useState('Campaign');
  const [campaign, setCampaign] = useState(null);    // restored async after DB seeds

  // v11 — keep the journal-tracker scope helper synced with whichever
  // campaign is currently loaded. Every read/write in the journal trackers
  // (locationTracker, npcTracker, bestiaryTracker, factionTracker) filters
  // by getActiveCampaignDataId(); without this effect, reads would always
  // come back empty and writes would all land under the 'orphan' sentinel —
  // i.e. the entire per-campaign journal feature would silently no-op.
  // Doing this in a single effect (rather than at every setCampaign call
  // site) covers boot rehydrate, New Game, Load Game, the CampaignSelector,
  // and the inner-state updaters used by AdventureTab / FactionsTab.
  // setActiveCampaignDataId is idempotent — same-id calls are no-ops.
  const activeCampaignDataId = campaign?.data?.id || campaign?.id || null;
  useEffect(() => {
    setActiveCampaignDataId(activeCampaignDataId);
  }, [activeCampaignDataId]);
  const [party, setParty] = useState(() => {
    try { const s = loadLiveState(); return s?.party || []; } catch { return []; }
  });
  const [gameLog, setGameLog] = useState(() => {
    try { const s = loadLiveState(); return s?.gameLog || []; } catch { return []; }
  });
  const [combat, _setCombat] = useState(() => {
    try { const s = loadLiveState(); return s?.combat || null; } catch { return null; }
  });
  // Mirror of `combat` for same-tick reads — endCombat fires from inside the
  // same event that applies a killing-blow setCombat, so any closure-based
  // read of `combat` lags by one render. Every setCombat also updates the
  // ref synchronously so endCombat can read the post-update observations.
  const combatRef = useRef(combat);
  const setCombat = useCallback((next) => {
    _setCombat((prev) => {
      const value = typeof next === 'function' ? next(prev) : next;
      combatRef.current = value;
      return value;
    });
  }, []);
  const [adventure, setAdventure] = useState(() => {
    try { const s = loadLiveState(); return s?.adventure || null; } catch { return null; }
  });
  const [classesMap, setClassesMap] = useState({});
  const [gmMode, setGmMode] = useState(false);

  // Bug #35 — live mirror of the undo ring-buffer depth. Drives the enabled
  // state of the "Undo" button in AdventureTab (disabled at depth 0). The
  // undoBuffer service is module-scoped so it survives re-renders; this
  // state just ferries the current depth into React's render cycle.
  const [undoDepth, setUndoDepth] = useState(0);
  useEffect(() => subscribeUndoDepth(setUndoDepth), []);

  // Bug #4 — audio narration toggle. Mirror service state into React so the
  // header button re-renders on toggle. subscribe() fires once on mount with
  // the persisted localStorage value, so the toggle survives refreshes.
  const [audioOn, setAudioOn] = useState(() => audioNarration.isEnabled());
  useEffect(() => audioNarration.subscribe(setAudioOn), []);

  // Bug #38 follow-up (2026-04-18): second-paragraph suppression signal.
  // CampaignSelector.startCampaign fires `chapter_intro` (campaign opener —
  // Swallowtail Festival for RotRL). The operator then lands on the
  // Adventure tab and has to pick a starting town, which calls
  // AdventureTab.startAdventure — which, by default, fires its OWN AI
  // arrival-narrate paragraph ("party arrives in Sandpoint..."). That's two
  // intro narrations back-to-back, which the operator reported as bad UX
  // (2026-04-18).
  //
  // Ref (not state): one-shot signal; CampaignSelector flips it true right
  // after `chapter_intro` logs, and the NEXT `startAdventure` call consumes
  // the flag to skip its arrival narrate + loc.desc fallback, then clears
  // it. We use a ref so the flip doesn't cause an unrelated re-render.
  const pendingChapterIntroRef = useRef(false);
  const markChapterIntroFired = useCallback(() => {
    pendingChapterIntroRef.current = true;
  }, []);
  const consumePendingChapterIntro = useCallback(() => {
    if (pendingChapterIntroRef.current) {
      pendingChapterIntroRef.current = false;
      return true;
    }
    return false;
  }, []);

  // Bug #58 (2026-04-18): chapter_intro narrate result used to be logged via
  // CampaignSelector.addLog only — no extraction ran against it, so any NPCs
  // / rumors / clues / locations / lore mentioned in the opening paragraph
  // stayed invisible to the journal + Nearby NPCs panel until the operator's
  // first in-game action (which runs its OWN narrate through processNewEntities
  // and picks up the scene by side effect). Fix: stash the full narrate result
  // in a ref here, drain it from AdventureTab once `adventure` + worldTree +
  // activeNode are stable, and run processNewEntities(result.newEntities,
  // loc.name, result.text) locally. Mirrors the consumePendingChapterIntro
  // one-shot pattern above — stash is written by CampaignSelector right after
  // the awaited narrate resolves, and the AdventureTab consumer clears the ref
  // after a single run so re-renders don't re-process.
  const pendingChapterIntroResultRef = useRef(null);
  // Counter paired with the ref above: refs don't trigger re-renders, so a
  // naive drain-useEffect in AdventureTab fires once when adventure.active +
  // worldTree + activeNode stabilize and finds the ref still null (narrate is
  // still in-flight for ~2-3s). Bumping this counter on stash forces the
  // consumer's effect to re-run AFTER the payload has landed. Consumer still
  // drains the ref (one-shot) — the counter is a pure trigger.
  const [chapterIntroResultSeq, setChapterIntroResultSeq] = useState(0);
  const stashChapterIntroResult = useCallback((result) => {
    pendingChapterIntroResultRef.current = result || null;
    if (result) setChapterIntroResultSeq(s => s + 1);
    // Diagnostic so #59 verification can tell at a glance whether the stash
    // even fired. If this trace is missing, CampaignSelector never reached
    // the stash call (narrate threw → catch branch has no stash by design).
    try {
      traceEngine('chapterIntro:stash', {
        hasResult: !!result,
        hasText: !!(result && result.text),
        textLen: (result && result.text && result.text.length) || 0,
        npcCount: (result && result.newEntities && result.newEntities.npcs && result.newEntities.npcs.length) || 0,
        source: (result && result.source) || 'unknown',
        // #29 3rd-report telemetry: capture the first 200 chars of the
        // chapter_intro paragraph at stash-time. Pairs with the matching
        // preview in AdventureTab's chapterIntro:drain-read trace so we
        // can confirm the same text made it through the ref one-shot
        // without being clipped / re-stashed by a cross-campaign switch.
        textPreview: (result && result.text && result.text.slice(0, 200)) || '',
      });
    } catch (_) { /* trace best-effort */ }
  }, []);
  const consumePendingChapterIntroResult = useCallback(() => {
    const r = pendingChapterIntroResultRef.current;
    pendingChapterIntroResultRef.current = null;
    return r;
  }, []);

  // ── Slide panel state ──
  const [panels, setPanels] = useState({
    combat: false,
    shop: false,
    dice: false,
    map: false,
    journal: false,
    factions: false,
  });

  const openPanel = useCallback((name) => {
    setPanels(prev => ({ ...prev, [name]: true }));
  }, []);

  const closePanel = useCallback((name) => {
    setPanels(prev => ({ ...prev, [name]: false }));
  }, []);

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
    // Calendar (Bug #15) — Golarion / Absalom Reckoning. Defaults open the
    // game on Abadius 1, 4716 AR @ 08:00. See src/services/calendar.js for
    // formatting / advancement helpers. Old saves missing currentMonth /
    // currentYear / currentMinute fall back to these via getDateInfo().
    currentDay: 1,
    currentMonth: 0,
    currentYear: 4716,
    currentHour: 8,
    currentMinute: 0,
    currentSecond: 0,   // Task #79 — PF1e combat rounds (6s) tick this field
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
    // Phase 7.5 — familiar location, keyed by character.id.
    // Shape per entry: { withMaster: bool, distanceMiles: number, note: string }.
    // Missing entries are treated as "with master" so pre-7.5 saves keep working.
    familiarLocation: {},
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

      // Auto-pull from cloud sync if configured (updates settings/API key).
      // Safe to run before the user picks from the main menu — it only
      // hydrates Settings/API state, not active game state.
      if (isSyncConfigured()) {
        try {
          await pullAndApply();
          console.log('[Sync] Auto-pulled settings from cloud');
        } catch (e) {
          console.warn('[Sync] Auto-pull failed (offline?):', e.message);
        }
      }

      // Bug #29: DO NOT auto-load campaign/adventure here. The MainMenu
      // gates which state actually becomes visible. The user-initiated
      // "Continue" handler does the same work this block used to do.
      setReady(true);
    })();
  }, []);

  /**
   * Continue handler — restores the campaign record from the dataId stored
   * in localStorage live-state (same logic the old boot-time restore used
   * to run unconditionally). Split out so New Game / Load Game can bypass it.
   */
  const restoreFromLiveState = useCallback(async () => {
    const saved = loadLiveState();
    if (!saved) return { campaignTab: null };
    if (saved?.campaign?.dataId || saved?.adventure || saved?.party?.length > 0) {
      try {
        let campaignData = saved?.campaign?.dataId
          ? await db.campaignData.get(saved.campaign.dataId)
          : null;
        if (!campaignData) {
          const all = await db.campaignData.toArray();
          campaignData = all[0] || null;
          if (campaignData && saved?.campaign?.dataId) {
            console.warn(
              `[Restore] Saved campaign dataId "${saved.campaign.dataId}" missing; ` +
              `falling back to "${campaignData.id}".`,
            );
          }
        }
        if (campaignData) {
          setCampaign({
            data: campaignData,
            currentChapter: saved?.campaign?.currentChapter,
            currentPart: saved?.campaign?.currentPart,
            completedEncounters: saved?.campaign?.completedEncounters || [],
            partyLevel: saved?.campaign?.partyLevel || 1,
            started: saved?.campaign?.started,
          });
        }
      } catch (e) {
        console.warn('[Restore] Failed to restore campaign:', e);
      }
    }
    return {
      campaignTab: saved?.campaign ? 'Adventure' : (saved?.party?.length > 0 ? 'Party' : null),
    };
  }, []);

  const hasSavedGame = (() => {
    const saved = loadLiveState();
    return !!(saved?.campaign?.dataId || saved?.adventure || (saved?.party?.length > 0));
  })();

  const handleMenuNewGame = useCallback(async () => {
    // Wipe the live preloaded state so the new-game flow starts clean.
    //
    // Flow ordering (per operator): New Game → Party → Campaign → Adventure.
    // Land on the Party tab first so the operator builds a party before
    // picking an adventure path. PartyTab surfaces a "Next: Choose Campaign
    // Path" CTA once party.length > 0 that flips to the Campaign tab.
    //
    // Bug #18: clicking "New Game" is an unambiguous fresh-slate signal, so
    // wipe the shared tracker tables (journalNotes, encounteredCreatures,
    // encounteredNpcs, encounteredFactions, encounteredLocations, areaItems)
    // here unconditionally. Previously this was only prompted in
    // CampaignSelector.startCampaign, which missed the open-world path and
    // the "create party then jump into adventure" flow — the new party saw
    // the prior game's NPCs/creatures/notes. Existing saves retain their
    // own journal snapshot via saveGame.exportJournalData, so this wipe
    // only affects the live working copy; loading a save still restores
    // that save's journal intact.
    traceEngine('menu:newGame');
    try {
      await resetJournalData();
    } catch (err) {
      console.warn('[menu:newGame] journal reset failed (continuing):', err);
    }
    dmEngine.clearHistory();
    // Bug #35 — wipe any prior-session undo history so a new game doesn't
    // inherit rollback targets that point at a different campaign's state.
    clearUndoBuffer();
    setParty([]);
    setCampaign(null);
    setAdventure(null);
    setCombat(null);
    setGameLog([]);
    // Bug #54 (reassigned from #52 — id collision with the resolved paperdoll
    // backpack weight bug) — reset worldState to defaults on New Game so
    // prior-session play state (partyHex, partyPosition, revealedLocations,
    // exploredHexes, calendar seed, etc.) does not carry over into the fresh
    // game. Without this, MapTab's fresh-game hex init short-circuits on
    // stale partyHex (see MapTab.jsx line 363: `if (!needsInit.current ||
    // partyHex) return;`) and the party token renders at the previous game's
    // coordinates instead of auto-initialising on the Sandpoint pin — which
    // is exactly what the 22:03 #52 report showed. GM authoring data
    // (gmPins / gmPinOverrides / gmHiddenPins / gmRegions / gmHexTerrain)
    // lives in its own localStorage key (`pf-gm-map-data`) and is
    // campaign-agnostic, so we preserve those fields across the reset.
    setWorldState(prev => ({
      ...defaultWorldState,
      gmPins: prev?.gmPins || {},
      gmPinOverrides: prev?.gmPinOverrides || {},
      gmHiddenPins: prev?.gmHiddenPins || {},
      gmRegions: prev?.gmRegions || {},
      gmHexTerrain: prev?.gmHexTerrain || {},
    }));
    setTab('Party');
    setView('app');
  }, [setCombat]);

  const handleMenuContinue = useCallback(async () => {
    traceEngine('menu:continue');
    const { campaignTab } = await restoreFromLiveState();
    if (campaignTab) setTab(campaignTab);
    else setTab('Adventure');
    setView('app');
  }, [restoreFromLiveState]);

  const handleMenuSettings = useCallback(() => {
    traceEngine('menu:settings');
    setTab('Settings');
    setView('app');
  }, []);

  const handleMenuGMDesigner = useCallback(() => {
    traceEngine('menu:gmDesigner');
    setGmMode(true);
    setTab('GM Reference');
    setView('app');
  }, []);

  // Return to the main menu from inside the app. Deliberately NON-destructive:
  // we do NOT null out campaign/adventure/combat/party/gameLog — the debounced
  // localStorage save (pf-live-state, see effect below) is the authoritative
  // record, so flipping view='menu' back to view='app' via Continue picks up
  // exactly where the operator left off. If they want a fresh start, that's
  // what "New Game" on the menu is for.
  //
  // We DO close all slide panels and drop combat highlighting — otherwise a
  // Continue would pop the user right back into a stacked combat/shop/map
  // overlay state they may not remember, which is disorienting.
  const handleQuitToMenu = useCallback(() => {
    if (!window.confirm(
      'Return to the main menu? Your game is auto-saved — use "Continue" to resume where you left off.'
    )) return;
    traceEngine('menu:quitToMenu');
    setPanels({
      combat: false, shop: false, dice: false,
      map: false, journal: false, factions: false,
    });
    setView('menu');
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [gameLog]);

  // Bug #4 — speak the most recent gameLog entry when audio narration is on.
  // speakLogEntry() dedupes on entry.id, so state-restore replays and
  // re-renders that retain the same tail entry won't re-speak. Skips when
  // the feature is off (isEnabled() gate lives inside the service).
  useEffect(() => {
    if (!gameLog || gameLog.length === 0) return;
    audioNarration.speakLogEntry(gameLog[gameLog.length - 1]);
  }, [gameLog]);

  // Bug #4 — when the user toggles audio ON, seed lastSpokenId to the current
  // tail so the service doesn't retroactively speak the visible gameLog the
  // moment narration is enabled. Next appended entry is the first spoken.
  useEffect(() => {
    if (audioOn) {
      audioNarration.seedLastSpoken(gameLog?.[gameLog.length - 1]);
    }
    // Intentionally only triggers on audioOn flips (not gameLog updates) so
    // mid-session enables start clean from "now".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOn]);

  const addLog = useCallback((text, type = 'narration') => {
    setGameLog(prev => [...prev, { id: uid(), text, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  // Bug #35 — snapshot current live state onto the undo ring buffer. Called
  // by action paths (custom action submit, party compound action submit)
  // BEFORE they fire their narrate() call so an undo restores the pre-action
  // world. Deep-clones happen inside undoBuffer.pushUndoSnapshot, so passing
  // the live refs is safe.
  const captureUndoSnapshot = useCallback((label) => {
    pushUndoSnapshot({ party, gameLog, adventure, combat, worldState, label });
  }, [party, gameLog, adventure, combat, worldState]);

  // Bug #35 — restore the most recent snapshot. Pops one entry off the
  // buffer and splats each slice back onto its setter. Slide panels and
  // transient UI (narrating, loading, customAction text) are intentionally
  // NOT in the snapshot — they settle on their own.
  //
  // Caller (AdventureTab) is expected to gate this behind `!narrating` so
  // an in-flight narrate can't stomp the restored state after it resolves.
  //
  // HP-transition baseline ref is declared up here (rather than next to its
  // consumer effect below) so performUndo and handleLoadGame can clear it
  // before swapping the party. Resetting to null forces the diff watcher
  // to silently re-baseline on the next render rather than announce
  // transitions caused by the state swap itself.
  const prevHpRef = useRef(null);
  const performUndo = useCallback(() => {
    const snap = popUndoSnapshot();
    if (!snap) return false;
    try {
      // Reset HP-transition baseline so the diff watcher re-baselines
      // silently on restore — otherwise we'd announce "X is back on
      // their feet!" or "X is bloodied!" purely as an artifact of undo.
      prevHpRef.current = null;
      setParty(snap.party || []);
      setGameLog(snap.gameLog || []);
      setAdventure(snap.adventure || null);
      setCombat(snap.combat || null);
      setWorldState(prev => ({ ...prev, ...(snap.worldState || {}) }));
      addLog('[Undo] Last action reverted.', 'system');
    } catch (e) {
      console.warn('[Undo] Failed to restore snapshot:', e);
      addLog('[Undo] Failed to restore previous state.', 'danger');
      return false;
    }
    return true;
  }, [addLog, setCombat]);

  // Bridge journal-add events from tracker services into the narrative
  // log. Every clue, NPC first-meet, faction discovery, location visit,
  // new creature sighting, item find, and player note emits through the
  // pub/sub in services/journalEvents; we turn each one into a gameLog
  // entry with the dedicated 'journal' log type (NWN-style 'JOURNAL'
  // coloring). Single subscription for the lifetime of <App/>.
  useEffect(() => {
    const unsubscribe = onJournalAdd((event) => {
      const text = formatJournalAdd(event);
      if (text) addLog(text, 'journal');
    });
    return unsubscribe;
  }, [addLog]);

  // HP-state transition notifications — NWN-style cues when a PC crosses a
  // health bucket (healthy → bloodied → disabled/dying → dead, or the
  // reverse via healing). Implemented as a prev-HP diff rather than inside
  // updateCharHP so ALL code paths that mutate party HP (setParty calls,
  // spells, conditions ticking down, save-load) are covered — and we don't
  // have to worry about React strict-mode double-invoking an updater.
  // First mount: prevHpRef is null (declared above), no logs fire.
  useEffect(() => {
    const snapshot = party.map(c => ({
      id: c.id,
      name: c.name,
      hp: c.currentHP,
      effMax: getEffectiveMaxHP(c, { worldState }),
      con: c.abilities?.CON || 10,
    }));
    const prev = prevHpRef.current;
    if (prev) {
      for (const now of snapshot) {
        const old = prev.find(p => p.id === now.id);
        if (!old) continue; // new PC just joined mid-session — establish baseline silently
        const prevBucket = hpBucket(old.hp, old.effMax, old.con);
        const newBucket = hpBucket(now.hp, now.effMax, now.con);
        if (prevBucket !== newBucket) {
          const line = formatHpTransition(now.name, prevBucket, newBucket);
          if (line) addLog(line.text, line.type);
        }
      }
    }
    prevHpRef.current = snapshot;
  }, [party, worldState, addLog]);

  const updateCharHP = useCallback((charId, delta) => {
    setParty(prev => prev.map(c => {
      if (c.id !== charId) return c;
      // Phase 7.6 — heals cap at effectiveMaxHP (base + in-range familiar HP
      // bonus); death threshold still uses -CON. Depending on worldState here
      // is correct: if the familiar drops out of range, future heals will
      // respect the lower cap.
      const effMax = getEffectiveMaxHP(c, { worldState });
      const newHP = Math.max(-(c.abilities.CON || 10), Math.min(effMax, c.currentHP + delta));
      return { ...c, currentHP: newHP };
    }));
  }, [worldState]);

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

  // Bug #44 (2026-04-17) — one-time silent migration. Older saves (and the
  // brief window where CampaignSelector started campaigns without seeding a
  // date) landed on DEFAULT_START (Abadius 1, 4716 AR) regardless of the AP.
  // When we observe an existing save whose campaign has a canonical start in
  // CAMPAIGN_START_DATES AND the worldState date is still DEFAULT_START AND
  // we haven't already seeded this save, silently rewrite to the canonical
  // date and set _dateSeededFromCampaign so we never re-migrate — even if
  // the operator manually rewinds the in-world clock to DEFAULT_START later.
  // Gate on `ready` so we don't run before the bootstrap restore finishes.
  useEffect(() => {
    if (!ready) return;
    if (!campaign?.data?.id) return;
    if (worldState?._dateSeededFromCampaign) return;
    const canonical = CAMPAIGN_START_DATES[campaign.data.id];
    if (!canonical) return;
    if (!isDefaultStartDate(worldState)) {
      // The operator has already moved time forward — don't clobber their
      // progress. Mark the flag so we stop checking on every dependency tick.
      setWorldState(prev => ({ ...(prev || {}), _dateSeededFromCampaign: true }));
      return;
    }
    const seed = getCampaignStartDate(campaign.data.id);
    traceEngine('calendar:migrateSeed', {
      source: 'App.#44-migration',
      campaignId: campaign.data.id,
      seed,
    });
    setWorldState(prev => ({
      ...(prev || {}),
      currentYear: seed.year,
      currentMonth: seed.month,
      currentDay: seed.day,
      currentHour: seed.hour,
      currentMinute: seed.minute,
      // Task #79 — seed.second present on new DEFAULT_START / CAMPAIGN_START_DATES;
      // fall back to 0 for any legacy campaign-seed that predates the field.
      currentSecond: Number.isFinite(seed.second) ? seed.second : 0,
      _dateSeededFromCampaign: true,
    }));
  }, [ready, campaign?.data?.id, worldState?._dateSeededFromCampaign]);

  // Task #70f (2026-04-19) — one-time silent backfill for currentMinute.
  // The defaultWorldState spread at the `useState` init already covers the
  // normal boot path, but two edge cases can still produce a persisted save
  // where `currentMinute` is literally `undefined`:
  //   1) very old pre-currentMinute saves that predate the field and were
  //      ingested through a handleLoadGame path that didn't splat defaults;
  //   2) external JSON save files hand-edited by the operator.
  // getDateInfo() already coerces a missing minute to 0 at *read* time, but
  // tickClock / advanceWorldTime write `currentMinute` back into the patch —
  // which means a save with `currentMinute: undefined` would display fine
  // until the first tick and then suddenly "snap" forward by whatever offset
  // getDateInfo computed. Silent backfill on boot keeps the transition
  // invisible. Gate on `_minuteBackfilled` so this never runs twice.
  useEffect(() => {
    if (!ready) return;
    if (worldState?._minuteBackfilled) return;
    if (Number.isFinite(worldState?.currentMinute)) {
      // Already a real number — just mark the flag so we stop checking.
      setWorldState(prev => ({ ...(prev || {}), _minuteBackfilled: true }));
      return;
    }
    traceEngine('calendar:minuteBackfill', {
      source: 'App.#70f-migration',
      priorMinute: worldState?.currentMinute,
    });
    setWorldState(prev => ({
      ...(prev || {}),
      currentMinute: 0,
      _minuteBackfilled: true,
    }));
  }, [ready, worldState?._minuteBackfilled, worldState?.currentMinute]);

  // Task #79 (2026-04-19) — companion backfill for currentSecond. Mirrors
  // the #70f minute migration one-for-one: getDateInfo coerces a missing
  // second to 0 at read time, but advanceWorldTime now writes
  // `currentSecond` back on every tick, so we need to surface a real 0 in
  // persisted worldState to keep combat-round timestamps monotonic after
  // load. Gate on `_secondBackfilled` for idempotence; writes once per
  // save, never re-runs.
  useEffect(() => {
    if (!ready) return;
    if (worldState?._secondBackfilled) return;
    if (Number.isFinite(worldState?.currentSecond)) {
      setWorldState(prev => ({ ...(prev || {}), _secondBackfilled: true }));
      return;
    }
    traceEngine('calendar:secondBackfill', {
      source: 'App.#79-migration',
      priorSecond: worldState?.currentSecond,
    });
    setWorldState(prev => ({
      ...(prev || {}),
      currentSecond: 0,
      _secondBackfilled: true,
    }));
  }, [ready, worldState?._secondBackfilled, worldState?.currentSecond]);

  // Handle loading a saved game
  const handleLoadGame = useCallback((data) => {
    traceEngine('handleLoadGame', {
      partyLen: data?.party?.length || 0,
      hasCampaign: !!data?.campaign,
      hasAdventure: !!data?.adventure,
      combatActive: !!data?.combat?.active,
    });
    // Reset HP-transition baseline BEFORE setParty so the diff watcher
    // doesn't spuriously announce "X is dying" on load just because the
    // loaded character happens to be in worse shape than the pre-load
    // in-memory party. Next effect run will re-baseline silently.
    prevHpRef.current = null;
    setParty(data.party || []);
    setCampaign(data.campaign || null);
    setAdventure(data.adventure || null);
    setCombat(data.combat || null);
    setGameLog(data.gameLog || []);
    if (data.worldState) setWorldState(prev => ({ ...prev, ...data.worldState }));
    // Bug #35 — loading a save replaces the working state wholesale;
    // prior undo snapshots would point back at the previous session's
    // world. Drop them so "Undo" doesn't teleport the operator back.
    clearUndoBuffer();
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
    // #29 — coming from the main-menu Load Game flow, we also need to
    // flip the view out of the menu. Safe to call unconditionally; if
    // the app is already in 'app' view this is a no-op.
    setView('app');
  }, [addLog, openPanel]);

  // ── Start combat (opens slide panel instead of switching tabs) ──
  const startCombat = useCallback((combatData) => {
    // Seed per-enemy observation slots so AC narrowing / HP descriptor /
    // seen-attacks can accrue without every hook needing to handle
    // undefined. Cleared at combat end alongside `combat`.
    const observed = {};
    if (Array.isArray(combatData?.enemies)) {
      for (const e of combatData.enemies) {
        if (e?.id != null) observed[e.id] = emptyObservation();
      }
    }
    // Phase D: allies also get observation slots so mergeObservation +
    // applyObservationEvents can write against them uniformly (e.g. if a
    // betrayer subplot later flips an ally to enemy mid-combat, the record
    // is already in place to preserve prior observation state).
    if (Array.isArray(combatData?.allies)) {
      for (const a of combatData.allies) {
        if (a?.id != null) observed[a.id] = emptyObservation();
      }
    }
    setCombat({ ...combatData, observed });
    openPanel('combat');
    // Record encountered creatures into the party's bestiary (Adventurer's Journal)
    if (combatData?.enemies?.length) {
      recordEncounteredCreatures(combatData.enemies, {
        location: adventure?.location?.name || 'Unknown',
        campaignName: campaign?.data?.name || null,
      }).catch(err => console.warn('Failed to record encountered creatures', err));
      // NB: starting combat does NOT unlock enemy statblocks — that would be
      // too generous vs CRB. Observations accrue on combat.observed and are
      // distilled on endCombat via distillCombatObservations.
    }
    // Phase D: allies voluntarily coordinate with the party, so their
    // fighting style is legible from the moment they join — unlock
    // `combatStats` for any ally with an npcId. `stats` still requires
    // the fight to play out (handled by distillCombatObservations at end).
    if (combatData?.allies?.length) {
      for (const a of combatData.allies) {
        if (!a?.npcId) continue;
        advanceNpcKnowledge(a.npcId, { unlock: ['combatStats'] })
          .catch(err => console.warn('[ally distill:start] unlock failed:', err));
      }
    }
  }, [openPanel, adventure, campaign]);

  const endCombat = useCallback(async (victory) => {
    // Read from ref, not closure — a killing-blow setCombat fires immediately
    // before endCombat within the same tick, so the closure `combat` is stale.
    const combat = combatRef.current;
    // Tally defeated creatures into the bestiary regardless of outcome
    if (combat?.enemies?.length) {
      recordCreaturesDefeated(combat.enemies)
        .catch(err => console.warn('Failed to record defeated creatures', err));
    }
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
    // Distill per-enemy combat observations into persistent revealedFacts
    // for any NPC combatants. Enemies without an npcId are creatures — they
    // flow to the bestiary instead (see recordCreaturesDefeated above).
    if (combat?.enemies?.length && combat?.observed) {
      for (const e of combat.enemies) {
        if (!e?.npcId) continue;
        const outcome = e.fled ? 'fled'
          : e.surrendered ? 'surrendered'
          : (e.currentHP ?? 1) <= 0 ? 'defeated'
          : 'survived';
        const role = e.role || 'enemy'; // forward-compat: 'ally' | 'betrayer' | 'summon'
        const unlock = distillCombatObservations(combat.observed[e.id], { role, outcome });
        if (unlock?.length) {
          advanceNpcKnowledge(e.npcId, { unlock })
            .catch(err => console.warn('[combat distill] unlock failed:', err));
        }
      }
    }
    // Phase D: mirror distillation for allies. Allies that survived a fight
    // with the party earn `stats` in addition to the `combatStats` they got
    // on combat start. Allies that fell (currentHP ≤ 0) also unlock both —
    // the party saw enough to piece together the statblock either way.
    // `surrendered` isn't meaningful for an ally (you wouldn't surrender TO
    // your own side), so the ternary intentionally omits it.
    if (combat?.allies?.length && combat?.observed) {
      for (const a of combat.allies) {
        if (!a?.npcId) continue;
        const outcome = a.fled ? 'fled'
          : (a.currentHP ?? 1) <= 0 ? 'defeated'
          : 'survived';
        const unlock = distillCombatObservations(combat.observed[a.id], { role: 'ally', outcome });
        if (unlock?.length) {
          advanceNpcKnowledge(a.npcId, { unlock })
            .catch(err => console.warn('[ally distill:end] unlock failed:', err));
        }
      }
    }
    setCombat(null);
    closePanel('combat');
    // `combat` intentionally NOT in deps: we read via combatRef to avoid a
    // closure-lag bug (killing-blow setCombat fires in the same tick).
  }, [party.length, addLog, setCombat, campaign, gameLog, worldState, closePanel]);

  // ── Auto-open combat panel when combat starts ──
  useEffect(() => {
    if (combat?.active && !panels.combat) {
      openPanel('combat');
    }
  }, [combat?.active]);

  // ── Force-close campaign-gated panels if no active campaign ──
  useEffect(() => {
    if (!campaign && (panels.map || panels.journal)) {
      setPanels(prev => ({ ...prev, map: false, journal: false }));
    }
  }, [campaign]);

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

  // #29 — full-screen main menu. Nothing else is rendered until the user
  // picks an action. This replaces the old auto-load-on-boot behavior.
  if (view === 'menu') {
    return (
      <MainMenu
        hasSavedGame={hasSavedGame}
        onNewGame={handleMenuNewGame}
        onContinue={handleMenuContinue}
        onLoadGame={handleLoadGame}
        onSettings={handleMenuSettings}
        onGMDesigner={handleMenuGMDesigner}
      />
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
          {/* Return-to-menu lives first in the button group so it sits closest
              to the campaign/adventure badges — spatially, "you're in this
              game, here's the exit". Confirm dialog in handleQuitToMenu
              prevents accidental clicks. */}
          <button onClick={handleQuitToMenu} title="Return to Main Menu (your game is auto-saved)"
            style={{ background: '#2a2a4e', border: '1px solid #8b6914', color: '#ffd700', cursor: 'pointer', borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px', fontSize: isMobile ? 18 : 16, minHeight: 36 }}
          >{'\u{1F3E0}'}</button>
          <button onClick={() => openPanel('dice')} title="Dice Roller"
            style={{ background: panels.dice ? '#ffd700' : '#2a2a4e', border: '1px solid #8b6914', color: panels.dice ? '#1a1a2e' : '#ffd700', cursor: 'pointer', borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px', fontSize: isMobile ? 18 : 16, minHeight: 36 }}
          >{'\u{1F3B2}'}</button>
          {/* Bug #12: the header buttons gated on `!campaign` alone, which made
              them grey out for the brief window on reload where adventure is
              restored (from localStorage, sync) before campaign is restored
              (from IndexedDB, async). If adventure is active we know a
              campaign exists — let the buttons stay clickable in that window. */}
          <button
            onClick={() => (campaign || adventure) && openPanel('map')}
            disabled={!campaign && !adventure}
            title={(campaign || adventure) ? 'Overland Map' : 'Load a campaign to use the Overland Map'}
            style={{
              background: panels.map ? '#ffd700' : '#2a2a4e',
              border: '1px solid #8b6914',
              color: (!campaign && !adventure) ? '#4a4a5e' : (panels.map ? '#1a1a2e' : '#ffd700'),
              cursor: (campaign || adventure) ? 'pointer' : 'not-allowed',
              opacity: (campaign || adventure) ? 1 : 0.45,
              borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px',
              fontSize: isMobile ? 18 : 16, minHeight: 36,
            }}
          >{'\u{1F5FA}\uFE0F'}</button>
          <button
            onClick={() => (campaign || adventure) && openPanel('journal')}
            disabled={!campaign && !adventure}
            title={(campaign || adventure) ? "Adventurer's Journal" : "Load a campaign to open the Adventurer's Journal"}
            style={{
              background: panels.journal ? '#ffd700' : '#2a2a4e',
              border: '1px solid #8b6914',
              color: (!campaign && !adventure) ? '#4a4a5e' : (panels.journal ? '#1a1a2e' : '#ffd700'),
              cursor: (campaign || adventure) ? 'pointer' : 'not-allowed',
              opacity: (campaign || adventure) ? 1 : 0.45,
              borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px',
              fontSize: isMobile ? 18 : 16, minHeight: 36,
            }}
          >{'\u{1F4D6}'}</button>
          {/* Factions & Living World — GM-only. Exposes faction internals
              (moods, secret leakRisk, leadership stress, schism risk),
              simulation tick controls, novel-faction queue, tracked-NPC
              offscreen state — metagame info players shouldn't see. The
              Adventurer's Journal already serves the player view filtered
              to known knowledge. Hidden entirely (not just disabled) in
              non-GM mode. Active style is magenta to read as "GM tool"
              alongside the GM-toggle's existing magenta accent. */}
          {gmMode && (
          <button
            onClick={() => (campaign || adventure) && openPanel('factions')}
            disabled={!campaign && !adventure}
            title={(campaign || adventure) ? 'Factions & Living World (GM)' : 'Load a campaign to view factions'}
            style={{
              background: panels.factions ? '#d946ef' : '#2a2a4e',
              border: `1px solid ${panels.factions ? '#d946ef' : '#8b6914'}`,
              color: (!campaign && !adventure) ? '#4a4a5e' : (panels.factions ? '#1a1a2e' : '#d946ef'),
              cursor: (campaign || adventure) ? 'pointer' : 'not-allowed',
              opacity: (campaign || adventure) ? 1 : 0.45,
              borderRadius: 6, padding: isMobile ? '6px 10px' : '4px 10px',
              fontSize: isMobile ? 18 : 16, minHeight: 36,
            }}
          >{'\u{1F6E1}\uFE0F'}</button>
          )}
          {/* Bug #4 — audio narration toggle. Disabled when speechSynthesis
              isn't available (e.g. non-browser env) so the button doesn't
              mislead the user. Click cancels any in-flight utterance as a
              side effect via the service. */}
          <button onClick={() => audioNarration.toggle()}
            disabled={!audioNarration.isSupported()}
            title={audioNarration.isSupported()
              ? (audioOn ? 'Audio narration ON — click to silence' : 'Audio narration OFF — click to enable')
              : 'Audio narration not supported in this browser'}
            style={{
              background: audioOn ? '#1a3a1a' : '#2a2a4e',
              border: `1px solid ${audioOn ? '#22c55e' : '#8b6914'}`,
              color: !audioNarration.isSupported() ? '#4a4a5e' : (audioOn ? '#22c55e' : '#8b949e'),
              cursor: audioNarration.isSupported() ? 'pointer' : 'not-allowed',
              borderRadius: 6,
              padding: isMobile ? '6px 10px' : '4px 10px',
              fontSize: isMobile ? 18 : 16,
              minHeight: 36,
            }}
          >{audioOn ? '\u{1F50A}' : '\u{1F507}'}</button>
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
            setWorldState={setWorldState}    /* Bug #44: seed currentYear/Month/Day/Hour from CAMPAIGN_START_DATES */
            party={party}
            addLog={addLog}
            onStartAdventure={() => setTab('Adventure')}
            onChapterIntroFired={markChapterIntroFired}  /* Bug #38 follow-up: suppress next arrival narrate */
            stashChapterIntroResult={stashChapterIntroResult}  /* Bug #58: stash narrate result for AdventureTab extraction */
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
            gmMode={gmMode}
            captureUndoSnapshot={captureUndoSnapshot}
            performUndo={performUndo}
            undoDepth={undoDepth}
            consumePendingChapterIntro={consumePendingChapterIntro}  /* Bug #38 follow-up: skip arrival narrate when chapter_intro just fired */
            consumePendingChapterIntroResult={consumePendingChapterIntroResult}  /* Bug #58: drain + extract chapter_intro narrate result */
            chapterIntroResultSeq={chapterIntroResultSeq}  /* Bug #58 race fix: force drain-effect re-run after stash lands */
          />
        )}
        {tab === 'Party' && (
          <PartyTab
            party={party}
            setParty={setParty}
            addLog={addLog}
            updateCharHP={updateCharHP}
            classesMap={classesMap}
            worldState={worldState}
            setWorldState={setWorldState}
            campaign={campaign}
            onContinueToCampaign={() => setTab('Campaign')}
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
          setWorldState={setWorldState}
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
      {/* Bug #41: gate matched to the header button's onClick guard
          (`campaign || adventure`). Previously `!!campaign` alone, which meant
          the button click during the save-restore race (adventure restored from
          localStorage sync before campaign restores async from IndexedDB)
          succeeded but the panel never actually opened. Inner `{campaign && …}`
          still guards the content from rendering against a missing campaign. */}
      <SlidePanel
        isOpen={panels.map && !!(campaign || adventure)}
        onClose={() => closePanel('map')}
        title="Overland Map"
        width={isMobile ? '100%' : '70%'}
      >
        {campaign && (
          <MapTab
            party={party}
            campaign={campaign}
            adventure={adventure}
            addLog={addLog}
            worldState={worldState}
            setWorldState={setWorldState}
            gmMode={gmMode}
            onOpenJournalLocation={(locationId) => {
              setWorldState(ws => ({ ...ws, journalFocus: { type: 'location', id: locationId, at: Date.now() } }));
              openPanel('journal');
            }}
          />
        )}
      </SlidePanel>

      {/* Adventurer's Journal Panel */}
      {/* Bug #41: see the Overland Map comment above — same race-window fix. */}
      <SlidePanel
        isOpen={panels.journal && !!(campaign || adventure)}
        onClose={() => closePanel('journal')}
        title="Adventurer's Journal"
        width={isMobile ? '100%' : '55%'}
      >
        {campaign && (
          <AdventurerJournal
            gameLog={gameLog}
            campaign={campaign}
            adventure={adventure}
            gmMode={gmMode}
            focusHint={worldState?.journalFocus || null}
            addLog={addLog}
            onOpenMap={(mapId, poiId) => {
              setWorldState(ws => ({ ...ws, mapFocus: { mapId, poiId, at: Date.now() } }));
              openPanel('map');
            }}
            onSetNodeStatus={(id, status, opts = {}) => {
              // Task #65 — GM-facing status change surface. Clones the tree,
              // flips status via worldTree.setNodeStatus (which owns cascade
              // + history append per Task #63), fires addLog so the party
              // log mirrors the change, and emitJournalAdd so the journal's
              // "📔 new location" line lands too. Gate on gmMode is enforced
              // in the caller (WorldTreeSection hides the icons otherwise);
              // this callback still re-validates status because an older
              // SlidePanel snapshot might fire stale events.
              if (!id || !status) return;
              const normStatus = String(status).toLowerCase();
              if (![NODE_STATUS.ACTIVE, NODE_STATUS.SEALED, NODE_STATUS.DESTROYED].includes(normStatus)) return;
              const { reason = '', cascade = true } = opts;
              const nowIso = new Date().toISOString();
              let applied = null;
              setAdventure(prev => {
                const curTree = prev?.worldTree;
                if (!curTree || !curTree.nodes || !curTree.nodes[id]) return prev;
                const nextTree = { rootId: curTree.rootId, nodes: { ...curTree.nodes } };
                for (const nid of Object.keys(nextTree.nodes)) {
                  nextTree.nodes[nid] = { ...nextTree.nodes[nid] };
                }
                let touched = [];
                try {
                  touched = setWorldNodeStatus(nextTree, id, normStatus, { reason, at: nowIso, cascade });
                } catch (err) {
                  console.warn('[App] setNodeStatus threw:', err);
                  return prev;
                }
                if (!touched || touched.length === 0) return prev;
                applied = {
                  name: nextTree.nodes[id]?.name || 'location',
                  status: normStatus,
                  reason,
                  touchedCount: touched.length,
                };
                return { ...prev, worldTree: nextTree };
              });
              // Fire log + journal outside the functional updater so React
              // strict-mode double-invocation doesn't double-log. The
              // `applied` capture is null when the updater short-circuited
              // (no-op status, unknown node, or setNodeStatus threw).
              if (applied) {
                const { name, status: s, reason: r, touchedCount } = applied;
                const cascadeNote = touchedCount > 1 ? ` (+${touchedCount - 1} nested location${touchedCount === 2 ? '' : 's'})` : '';
                const verb = s === 'active' ? 'restored' : s;  // "sealed", "destroyed", "restored"
                const line = r
                  ? `[GM] ${name} ${verb}${cascadeNote}: ${r}`
                  : `[GM] ${name} ${verb}${cascadeNote}`;
                try { addLog?.(line, s === 'destroyed' ? 'failure' : s === 'sealed' ? 'warning' : 'journal'); } catch { /* log never throws upstream */ }
                try {
                  emitJournalAdd({
                    kind: 'location',
                    label: name,
                    detail: r ? `${verb}: ${r}` : verb,
                  });
                } catch { /* journal bus never throws */ }
              }
            }}
          />
        )}
      </SlidePanel>

      {/* Factions & Living-World Panel */}
      {/* Bug #41: see the Overland Map comment above — same race-window fix. */}
      <SlidePanel
        isOpen={panels.factions && !!(campaign || adventure)}
        onClose={() => closePanel('factions')}
        title="Factions & Living World"
        width={isMobile ? '100%' : '65%'}
      >
        {campaign && (
          <FactionsTab
            campaign={campaign.data || campaign}
            setCampaign={(updater) => {
              setCampaign(prev => {
                if (!prev) return prev;
                const currentInner = prev.data || prev;
                const nextInner = typeof updater === 'function' ? updater(currentInner) : updater;
                return prev.data ? { ...prev, data: nextInner } : nextInner;
              });
            }}
            npcs={Object.values((campaign.data || campaign).npcs || {})}
          />
        )}
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

      {/* Floating "Note for Claude" button — available on every screen so the
          operator can capture bugs / notes / design thoughts from anywhere
          (char create, settings, adventure, …). Passes best-available scene
          + character context; the button gracefully handles nulls. */}
      <BugReportButton
        scene={adventure?.location?.name || tab || null}
        currentCharacter={party?.[0]?.name || null}
      />
    </div>
  );
}

export default App;
