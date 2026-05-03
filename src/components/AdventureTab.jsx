import React, { useState, useRef, useEffect, useMemo } from 'react';
import GameLog from './GameLog';
import NPCPanel from './NPCPanel';
// AreaItemsPanel no longer rendered anywhere per
// feedback_items_narrative_first.md (2026-04-18). handleItemInteract /
// handleSurveyHoard survive as gameplay helpers wired into custom-action
// flows. If a future GM toggle reintroduces the shelf, re-import here:
//   import AreaItemsPanel from './AreaItemsPanel';
import CollapsibleSection from './CollapsibleSection';
// Bug #48 follow-up (grid spike) — dockable grid frame for the desktop
// Adventure layout. Each top-level side panel (Map, Places Here, Nearby
// NPCs) becomes a draggable/resizable tile alongside the Game Log. The
// mobile render path below stays on the legacy stacked CollapsibleSection
// list. See src/components/AdventureGrid.jsx for layout + persistence.
import AdventureGrid, { clearSavedLayout as clearAdventureGridLayout } from './AdventureGrid';
import ApiKeyBanner from './ApiKeyBanner';
import useIsMobile from '../hooks/useIsMobile';
import { rollDice, roll } from '../utils/dice';
import { db } from '../db/database';
import dmEngine from '../services/dmEngine';
import gameEvents from '../services/gameEventEngine';
import { generateNPC, storeNPC, generatePortrait, generateContextActions, generateAreaItems, getNPCDisplayName, revealNPCName, buildNPCDescription, getEncounteredNPCs, markNPCDead } from '../services/npcTracker';
// Bug #55 — isPlausibleNPCName gates both AI-emitted and heuristic NPC
// candidates before storeNPC fires; isAppearanceDescriptor widens the
// knownToParty detection from article-lead-only to also cover bare
// appearance descriptors ("tall woman", "fat angry gnome").
import { extractNPCsFromNarration, isPlausibleNPCName, isAppearanceDescriptor } from '../services/npcExtraction';
// Bug #58 — LLM-based scene extractor. Primary path for NPC identification
// with full present/mentioned/historical trichotomy + future routing for
// items, locations, factions, quests, rumors, clues, lore. Heuristic
// extractor above remains as belt-and-suspenders fallback when the API
// call fails (no key, network error, parse error).
import { extractSceneEntities } from '../services/sceneExtractionLLM';
import { recordEncounteredLocation } from '../services/locationTracker';
import { getActiveCampaignDataId } from '../services/campaignScope';
import { emitJournalAdd } from '../services/journalEvents';
// Bug #59 — route llmExtraction.items.mentioned into the rumor category
// of the clues tracker so the GM sees referenced-but-elsewhere items
// (legendary artifacts, "rare loot at the dungeon over the hill") in
// the journal as soft leads rather than as pickable areaItems. Bug #60
// adds locations.mentioned as category:'lead'. Bug #61 uses it for
// unmatched factions too.
import { addClue, getClues, resolveClue } from '../services/cluesTracker';
// Bug #61 — route llmExtraction.factions into the faction-discovery
// ledger when the extractor's name maps to a campaign.data.factions
// entry, otherwise fall back to addClue as a lead the GM can promote.
import { recordEncounteredFaction } from '../services/factionTracker';
// Bug #65 — route llmExtraction.lore into db.journalNotes with
// category:'lore' so the Journal's Notes view gets world history,
// geography, religion, etc. surfaced as first-class lore entries
// (bestiaryTracker also owns this helper — lore lives alongside
// creature knowledge in the same table, just a different category).
import { addJournalNote } from '../services/bestiaryTracker';
import { DungeonMap, SettlementMap, ParchmentFrame } from './MapAssets';
import InteractiveMap from './InteractiveMap';
import mapRegistry from '../services/mapRegistry';
import { traceEngine } from '../services/engineTrace';
import PartyActionBar from './PartyActionBar';
import CalendarDisplay from './CalendarDisplay';
import {
  NODE_KINDS, KIND_ICON, DEFAULT_PARTY_ID, isContainerKind,
  createChildNode, removeNode as removeTreeNode, renameNode,
  getNode, getNodeByPath, findNodePath, getBreadcrumb, getChildren,
  getActiveParty, getActivePath, getActiveNode, setActivePath,
  commitLiveStateIntoNode, loadNodeLiveState, appendNodeHistory,
  recordVisit, recordDeparture, snapshotWorldTime, getVisitedNodes, samePath,
  ensureAdventureTreeShape,
  resolveLandingPath,
  // Bug #49 revision — overland hex → axial helper for approach-direction
  parsePartyHexToAxial,
  // Task #63 — soft-mark narrative destruction support
  NODE_STATUS, getNodeStatus, isNodeTraversable, setNodeStatus,
  // Task #91 — travel-gate helper extracted from switchToNodePath
  findTravelBlocker,
  // Task #71 — narrative-mention location discovery
  findNodeByName,
} from '../services/worldTree';
import { migrateAdventureToWorldTree, needsWorldTreeMigration, resolveNamedPath } from '../services/worldTreeMigration';
import { ensureSeedInTree } from '../data/worldTreeSeeds';
import { tickArrivalCascade } from '../services/nodeTick';
import { registerDefaultTickHandlers } from '../services/tickHandlers';
import {
  calculateTravelPlan,
  rollEncountersForPlan,
  buildTravelBeats,
} from '../services/overlandTravel';
import { advanceWorldTime } from '../services/calendar';
import { tickClock } from '../services/clockTick';

// Register L3 handlers once (idempotent).
registerDefaultTickHandlers();

export default function AdventureTab({
  adventure,
  party = [],
  combat,
  addLog,
  gameLog = [],
  logRef,
  setTab,
  setCombat,
  setParty,
  setAdventure,
  classesMap = {},
  updateCharHP,
  worldState = {},
  setWorldState,
  campaign,
  setCampaign,
  openPanel,
  gmMode = false,
  // Bug #35 — undo plumbing from App.jsx. captureUndoSnapshot() pushes the
  // current live state onto the undo ring buffer; performUndo() pops and
  // restores; undoDepth mirrors the buffer depth for the button's enabled
  // state. All three are optional (AdventureTab is rendered in tests and
  // dev harnesses without them).
  captureUndoSnapshot,
  performUndo,
  undoDepth = 0,
  // Bug #38 follow-up (2026-04-18): one-shot flag consumer. When
  // CampaignSelector.startCampaign has just narrated a chapter_intro, the
  // next startAdventure() call should skip its arrival narrate + loc.desc
  // fallback so the operator doesn't see two stacked intro paragraphs.
  // Consumer returns true iff the flag was set, and clears it in the same
  // call. Safe to omit (tests/dev harnesses).
  consumePendingChapterIntro,
  // Bug #58 (2026-04-18): one-shot consumer for the full chapter_intro
  // narrate result (text + newEntities). Returns the stashed result or null,
  // clearing the ref in the same call. An internal useEffect below drains it
  // once `adventure` + worldTree + activeNode are ready, then runs
  // processNewEntities against it so the opening paragraph's NPCs / clues /
  // rumors / locations / lore hit the journal + Nearby NPCs at scene start
  // instead of waiting for the operator's first in-game action. Safe to omit
  // (tests/dev harnesses).
  consumePendingChapterIntroResult,
  // Bug #58 race fix: counter bumped in App.jsx every time
  // stashChapterIntroResult is called with a non-null payload. Paired into the
  // drain useEffect's dep list so the effect re-runs AFTER the narrate await
  // resolves and the ref has been populated — otherwise the effect fires once
  // on scene-context stabilization, finds the ref still null, and never gets
  // a second chance (refs don't trigger re-renders on their own).
  chapterIntroResultSeq,
}) {
  const isMobile = useIsMobile();
  const [customAction, setCustomAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [nearbyNPCs, setNearbyNPCs] = useState(() => worldState?.nearbyNPCs || []);
  const [areaItems, setAreaItems] = useState(() => worldState?.areaItems || []);
  const [contextActions, setContextActions] = useState(() => worldState?.contextActions || []);
  // 2026-04-20 — lifted from PartyActionBar so character-tagged context
  // suggestions ("Shadowblade — Investigate the still figure") can be
  // routed into the matching character's input rather than firing the
  // action immediately. The operator can then fill multiple characters'
  // rows from suggestions and Submit all to resolve them as one scene.
  const [partyPerChar, setPartyPerChar] = useState({});
  // Bug #45 — shared active-character selector for area-item actions.
  // Persisted via worldState so the choice survives reloads. Defaults to
  // null; UI components resolve null → first party member at render time.
  const [activeCharacterId, setActiveCharacterIdState] = useState(
    () => worldState?.activeCharacterId ?? null
  );

  // Sync local scene state back to worldState so it persists across reloads
  useEffect(() => {
    setWorldState(prev => {
      if (
        prev.nearbyNPCs === nearbyNPCs
        && prev.areaItems === areaItems
        && prev.contextActions === contextActions
        && prev.activeCharacterId === activeCharacterId
      ) return prev;
      return { ...prev, nearbyNPCs, areaItems, contextActions, activeCharacterId };
    });
  }, [nearbyNPCs, areaItems, contextActions, activeCharacterId, setWorldState]);

  // S1 (2026-04-20) — latest-value refs for the scene roster. `commitActiveNodeLive`
  // closes over `nearbyNPCs` / `areaItems` from the render-time closure, which can
  // be stale when async scene-extraction `setNearbyNPCs(prev => …)` lands between
  // renders but before the user hops to a sibling node. Symptom: NPCs that WERE
  // in the panel disappear on sibling-hop-and-back, because the commit froze an
  // empty/old list onto the departing node. These refs are updated by an effect
  // below so the commit path always freezes the current live roster.
  const nearbyNPCsRef = useRef(nearbyNPCs);
  const areaItemsRef = useRef(areaItems);
  useEffect(() => { nearbyNPCsRef.current = nearbyNPCs; }, [nearbyNPCs]);
  useEffect(() => { areaItemsRef.current = areaItems; }, [areaItems]);

  // When worldState is externally updated (e.g. handleLoadGame), sync local state
  const wsNPCRef = useRef(worldState?.nearbyNPCs);
  const wsItemsRef = useRef(worldState?.areaItems);
  const wsActionsRef = useRef(worldState?.contextActions);
  useEffect(() => {
    if (worldState?.nearbyNPCs !== wsNPCRef.current) {
      wsNPCRef.current = worldState.nearbyNPCs;
      setNearbyNPCs(worldState.nearbyNPCs || []);
    }
    if (worldState?.areaItems !== wsItemsRef.current) {
      wsItemsRef.current = worldState.areaItems;
      setAreaItems(worldState.areaItems || []);
    }
    if (worldState?.contextActions !== wsActionsRef.current) {
      wsActionsRef.current = worldState.contextActions;
      setContextActions(worldState.contextActions || []);
    }
  }, [worldState?.nearbyNPCs, worldState?.areaItems, worldState?.contextActions]);

  // Bug #58 — the NPC panel should only show NPCs who are physically in
  // the current scene. Mentioned (elsewhere) and historical (dead/past)
  // NPCs are still stored so the faction layer and lore journal can use
  // them, but they do NOT populate the Nearby / Talk-to UI. Filter at
  // the presentation layer instead of at setNearbyNPCs so upstream state
  // (save/load, worldState persistence) keeps the full roster and this
  // remains a pure display concern. `presence` defaults to 'here' on
  // generateNPC so pre-#58 records render correctly without migration.
  const visibleNearbyNPCs = useMemo(() => {
    if (!Array.isArray(nearbyNPCs)) return [];
    return nearbyNPCs.filter(n => (n?.presence || 'here') === 'here' && n?.alive !== false);
  }, [nearbyNPCs]);

  // Resolve active character — used by area-item handlers and any future
  // character-scoped action. Falls back to first party member if the
  // stored id no longer matches anyone (e.g. character was removed).
  const activeCharacter = useMemo(() => {
    if (!Array.isArray(party) || party.length === 0) return null;
    return party.find(p => p && p.id === activeCharacterId) || party[0];
  }, [party, activeCharacterId]);
  const setActiveCharacterId = (id) => {
    const valid = Array.isArray(party) && party.some(p => p && p.id === id);
    setActiveCharacterIdState(valid ? id : null);
  };

  const [lastEvent, setLastEvent] = useState(null);

  // Panel-layout per-campaign scoping. Follow-up to bug #48 — the operator
  // asked for resizable sidebar panels whose layout saves per-campaign.
  // campaignScopeKey is the id we use in the localStorage key namespace:
  //   - campaign.data.id when a campaign is active
  //   - '__default' sentinel when at the main menu / no campaign
  // Falling back to __default (rather than null) means a fresh boot still
  // gets a consistent saved width on day 1 before the first campaign load.
  const campaignScopeKey = useMemo(
    () => campaign?.data?.id || '__default',
    [campaign?.data?.id]
  );

  // Sidebar width + pointer-drag splitter were replaced by the
  // react-grid-layout dock (AdventureGrid). Removed 2026-04-18 as part of
  // the dead-code sweep (task #51) — localStorage keys under
  // `pf-adventure-layout.<scope>.sidebarWidth` are now orphan entries the
  // browser will age out; no migration needed.

  // Bug #48 follow-up (grid spike) — a monotonically increasing version
  // we bump when the operator hits "Reset layout" so the AdventureGrid
  // below remounts and re-reads DEFAULT_LAYOUT. Cheapest way to discard
  // the current in-memory layout without plumbing a ref-based reset.
  const [gridLayoutVersion, setGridLayoutVersion] = useState(0);

  // Process new entities extracted from AI narration — add NPCs and items to the scene.
  //
  // Bug #30 fix: the structured ENTITIES: metadata line from the DM prompt is
  // the primary source, but the model occasionally omits it for named NPCs
  // introduced mid-dialogue (the Bertha Cray incident — she introduced
  // herself by name but was never captured). When `narrativeText` is supplied
  // we run extractNPCsFromNarration as a heuristic fallback and merge any
  // newly-detected speakers into the same storeNPC pipeline.
  //
  // Bug #58 upgrade: narration now goes through an LLM reading-comprehension
  // pass (extractSceneEntities) that understands PRESENCE context — whether
  // a named figure is physically in the scene, alive-elsewhere, or dead/past.
  // The LLM result is authoritative when it succeeds; ENTITIES tail from
  // dmEngine serves as corroborating metadata, and the regex heuristic is
  // a final safety net when the LLM call fails (no key, network error,
  // parse error). The trichotomy lets us route mentioned/historical NPCs
  // to storage without polluting the Nearby NPCs panel.
  //
  // The LLM extractor also returns items, locations, factions, quests,
  // rumors, and clues for one-call-per-turn efficiency. Routing for those
  // domains lands incrementally under bugs #59-#64; unrouted domains log
  // to console so GM can see what the extractor found during playtest.
  const processNewEntities = async (entities, location, narrativeText = '') => {
    const normalizedEntities = entities && typeof entities === 'object'
      ? entities
      : { npcs: [], items: [] };
    const locationName = location || adventure?.location?.name || 'unknown';

    const entityNpcs = Array.isArray(normalizedEntities.npcs) ? [...normalizedEntities.npcs] : [];

    // Pull known roster + party names once — used by BOTH the LLM and
    // heuristic extractors for dedup/filtering. Scoped to the active
    // campaign so a legacy roster doesn't affect dedup for this game.
    const knownNpcRows = await getEncounteredNPCs().catch(() => []);
    const knownNames = knownNpcRows.map(n => n?.name).filter(Boolean);
    const partyNames = (party || []).map(p => p?.name).filter(Boolean);

    // --- Bug #58 — LLM scene-extraction primary path ---
    // The LLM returns structured NPCs (present/mentioned/historical) plus
    // the other Tier 1 domains (items, locations, factions, quests, rumors,
    // clues). `mentionedNpcs` / `historicalNpcs` are held aside for a
    // second storage loop after the main present-NPC loop — they use the
    // same generateNPC + storeNPC pipeline but with different presence
    // flags and skip the nearbyNPCs update.
    let llmExtraction = null;
    let mentionedNpcs = [];
    let historicalNpcs = [];
    if (narrativeText) {
      try {
        llmExtraction = await extractSceneEntities(narrativeText, {
          partyNames,
          knownNpcNames: knownNames,
          locationName,
        });
        if (llmExtraction?.source === 'llm') {
          // Merge LLM present NPCs into entityNpcs. Dedup against
          // ENTITIES-tail entries by case-insensitive name — if both sources
          // agree on "Dass Korvaski", the LLM row wins (richer classification
          // confidence) but we keep the ENTITIES row's fields as fallbacks
          // for any blanks.
          const existingByName = new Map(
            entityNpcs.map(n => [(n?.name || '').toLowerCase(), n])
          );
          for (const row of (llmExtraction.npcs?.present || [])) {
            const key = (row.name || '').toLowerCase();
            const existing = existingByName.get(key);
            if (existing) {
              existing.race = existing.race || row.race;
              existing.occupation = existing.occupation || row.occupation;
              existing.disposition = existing.disposition || row.disposition;
              existing.shortDesc = existing.shortDesc || row.shortDesc;
              existing._source = existing._source || 'llm+entities';
            } else {
              entityNpcs.push({
                name: row.name,
                race: row.race || 'Human',
                occupation: row.occupation || 'unknown',
                disposition: row.disposition || 'neutral',
                shortDesc: row.shortDesc || '',
                deceased: false,
                causeOfDeath: null,
                _source: 'llm',
              });
            }
          }
          mentionedNpcs = llmExtraction.npcs?.mentioned || [];
          historicalNpcs = llmExtraction.npcs?.historical || [];
        }
        // Devtools diagnostic for every call — success or skip. Routing for
        // non-NPC domains (items/locations/factions/quests/rumors/clues) is
        // pending, so we log counts here so the GM can see the extractor is
        // finding them even before their routers land.
        try {
          // eslint-disable-next-line no-console
          console.log('[sceneExtraction]',
            'source=' + (llmExtraction?.source || 'none'),
            'latency=' + (llmExtraction?.latencyMs || 0) + 'ms',
            'npcs:', {
              present: llmExtraction?.npcs?.present?.length || 0,
              mentioned: llmExtraction?.npcs?.mentioned?.length || 0,
              historical: llmExtraction?.npcs?.historical?.length || 0,
            },
            'items:', {
              present: llmExtraction?.items?.present?.length || 0,
              mentioned: llmExtraction?.items?.mentioned?.length || 0,
            },
            'locations:', {
              accessible: llmExtraction?.locations?.accessible?.length || 0,
              mentioned: llmExtraction?.locations?.mentioned?.length || 0,
            },
            'factions=' + (llmExtraction?.factions?.length || 0),
            'quests=' + (llmExtraction?.quests?.length || 0),
            'rumors=' + (llmExtraction?.rumors?.length || 0),
            'clues:', {
              revealed: llmExtraction?.clues?.revealed?.length || 0,
              resolved: llmExtraction?.clues?.resolved?.length || 0,
            },
            'lore=' + (llmExtraction?.lore?.length || 0),
            'destructions=' + (llmExtraction?.destructions?.length || 0),
            llmExtraction?.error ? ('error=' + llmExtraction.error) : ''
          );
        } catch { /* log never blocks */ }
        if (llmExtraction?.source === 'llm') {
          traceEngine('sceneExtraction:llm', {
            latencyMs: llmExtraction.latencyMs,
            counts: {
              npcsPresent: llmExtraction.npcs.present.length,
              npcsMentioned: llmExtraction.npcs.mentioned.length,
              npcsHistorical: llmExtraction.npcs.historical.length,
              items: llmExtraction.items.present.length + llmExtraction.items.mentioned.length,
              locations: llmExtraction.locations.accessible.length + llmExtraction.locations.mentioned.length,
              factions: llmExtraction.factions.length,
              quests: llmExtraction.quests.length,
              rumors: llmExtraction.rumors.length,
              clues: llmExtraction.clues.revealed.length + llmExtraction.clues.resolved.length,
              lore: llmExtraction.lore?.length || 0,
              destructions: llmExtraction.destructions?.length || 0,
            },
          });
        }
      } catch (err) {
        console.warn('[sceneExtraction] LLM pass threw:', err);
        llmExtraction = null;
      }
    }

    // --- Heuristic fallback ---
    // Only runs when the LLM pass didn't actually yield NPCs. A "successful"
    // LLM call (source=llm) that returned 0 NPCs — e.g. parse failure, empty
    // JSON shape, or rate-limit partial — still needs heuristic rescue, or
    // we drop every NPC on the floor. Bug #29 live repro: 11s LLM call with
    // zero yield across a rich intro paragraph because the model's JSON
    // didn't round-trip. Existing #55 + #57 gates inside
    // extractNPCsFromNarration continue to apply.
    const llmNpcCount =
      (llmExtraction?.npcs?.present?.length || 0) +
      (llmExtraction?.npcs?.mentioned?.length || 0) +
      (llmExtraction?.npcs?.historical?.length || 0);
    const llmYieldedNpcs = llmExtraction?.source === 'llm' && llmNpcCount > 0;
    if (narrativeText && !llmYieldedNpcs) {
      try {
        const alreadyExtracted = entityNpcs.map(n => n?.name).filter(Boolean);
        const candidates = extractNPCsFromNarration(narrativeText, {
          partyNames,
          knownNpcNames: knownNames,
          alreadyExtracted,
        });
        for (const cand of candidates) {
          entityNpcs.push({
            name: cand.name,
            race: 'Human',              // conservative default; GM can edit
            occupation: 'unknown',
            disposition: 'neutral',
            shortDesc: cand.shortDesc || '',
            // Bug #50 follow-up: carry the extractor's deceased flag
            // through so storeNPC → markNPCDead runs below. Tom's live
            // Market Square case: "the old Father Tobyn who died in it"
            // → Tobyn must land as Deceased, not Alive.
            deceased: cand.deceased === true,
            causeOfDeath: cand.causeOfDeath || null,
            _source: 'heuristic',       // internal marker; not persisted
          });
        }
        try {
          // eslint-disable-next-line no-console
          console.log('[npcExtraction] fallback narrative len=' + (narrativeText?.length || 0)
            + ' aiEntities=' + entityNpcs.filter(n => n._source !== 'heuristic').length
            + ' heuristic=' + candidates.length
            + ' partyFilter=' + partyNames.length
            + ' knownFilter=' + knownNames.length,
            candidates.map(c => ({ name: c.name, conf: c.confidence })));
        } catch { /* log never blocks */ }
        if (candidates.length > 0) {
          traceEngine('npcExtraction:fallback', { count: candidates.length, names: candidates.map(c => c.name) });
        }
      } catch (err) {
        console.warn('[Entity] Heuristic NPC extraction failed:', err);
      }
    }

    // Store new NPCs
    if (entityNpcs.length > 0) {
      let storedCount = 0;
      let rejectedCount = 0;
      for (const npcData of entityNpcs) {
        // Bug #55 — second-chance gate. The AI path (dmEngine.js ENTITIES
        // parser) already filters via isPlausibleNPCName, but the
        // heuristic extractor writes directly into entityNpcs and also
        // legacy call sites might still push unchecked data. Re-gate here
        // so nothing phantom reaches storeNPC.
        if (!isPlausibleNPCName(npcData?.name)) {
          // eslint-disable-next-line no-console
          console.warn('[Entity] rejecting implausible NPC:', npcData?.name);
          rejectedCount += 1;
          continue;
        }
        try {
          // Build a minimal NPC object compatible with storeNPC
          const npc = generateNPC({
            name: npcData.name,
            race: npcData.race || 'Human',
            occupation: npcData.occupation || 'unknown',
            disposition: npcData.disposition || 'neutral',
            location: locationName,
          });
          // Override with AI-provided description
          npc.shortDesc = npcData.shortDesc || npc.shortDesc;
          npc.firstImpression = npcData.shortDesc || '';
          npc.location = locationName;
          npc.metAt = new Date().toISOString();
          // Bug #55 — NPCs described by appearance (article-lead OR bare
          // adjective+head-noun) start as unknown until properly introduced.
          // Previously only article-lead was detected, so "tall woman" /
          // "fat angry gnome" were wrongly landing as knownToParty=true.
          const nameIsDescription = isAppearanceDescriptor(npcData.name);
          npc.knownToParty = !nameIsDescription;
          if (nameIsDescription) {
            npc.shortDesc = npcData.name; // "a cloaked woman" / "tall woman" becomes the shortDesc
          }
          npc.portraitSvg = generatePortrait(npc);
          let stored = await storeNPC(npc, { campaign });
          // If the narrative flagged this NPC as dead (e.g. "Father Tobyn
          // who died in it"), mark deceased right after storing. Done as
          // a post-store update so we don't duplicate the alive=false
          // field-write path; markNPCDead also advances knowledge-level
          // so the Journal can surface stats for a fallen NPC.
          if (npcData.deceased && stored?.id) {
            try {
              await markNPCDead(stored.id, npcData.causeOfDeath || '');
              stored = { ...stored, alive: false, causeOfDeath: npcData.causeOfDeath || '' };
            } catch (deadErr) {
              console.warn('[Entity] Failed to mark NPC deceased:', npcData.name, deadErr);
            }
          }
          // Add to nearbyNPCs if not already present. Skip deceased NPCs
          // — they belong in the Journal but not in the "nearby" sidebar,
          // which is for people the party can interact with right now.
          // Bug #27 — dedupe FIRST by id so a name-reveal reconcile (where
          // storeNPC promoted a placeholder row and returned the same id
          // with a new proper name) overwrites the sidebar entry in place
          // instead of spawning "Marta" alongside the stale "a farmer".
          if (!npcData.deceased) {
            setNearbyNPCs(prev => {
              if (stored?.id != null && prev.some(n => n.id === stored.id)) {
                return prev.map(n => n.id === stored.id ? { ...n, ...stored } : n);
              }
              if (prev.some(n => n.name === stored.name)) return prev;
              return [...prev, stored];
            });
          }
          storedCount += 1;
        } catch (err) {
          // #49 regression-surfacing (2026-04-18): the TDZ bug in
          // generateNPC (see project_backlog.md — npcTracker.js bond ref)
          // silently swallowed ReferenceErrors here for WEEKS, leaving
          // nearbyNPCs empty with only a console.warn trace. Promote to
          // an addLog 'warning' so the next silent swallow is visible in
          // the GameLog immediately, not buried in devtools.
          console.warn('[Entity] Failed to store NPC:', npcData.name, err);
          addLog?.(
            `NPC capture failed for "${npcData?.name || 'unknown'}" — check console for details.`,
            'warning'
          );
        }
      }
      // eslint-disable-next-line no-console
      try { console.log('[npcExtraction] stored=' + storedCount + '/' + entityNpcs.length
        + ' rejected=' + rejectedCount
        + ' names=' + entityNpcs.map(n => n.name).join(', ')); } catch {}
    }

    // --- Bug #58 — mentioned + historical NPC storage ---
    // People the paragraph references but who are NOT physically in the
    // scene. These flow through the same generateNPC + storeNPC pipeline
    // as present NPCs, but:
    //   - presence is tagged ('elsewhere' or 'historical')
    //   - they do NOT land in nearbyNPCs (no Talk-to button)
    //   - historical rows additionally run through markNPCDead
    // The #55 plausibility gate still applies so bare topic words or
    // spurious capitalized tokens don't leak in through the LLM path.
    // The known-NPC filter is enforced by the LLM prompt (it's told to
    // skip already-known NPCs unless classification changed), but we
    // defensive-dedup here too against the scoped known roster.
    const knownSet = new Set(knownNames.map(n => n.toLowerCase()));
    const processReferentialNPC = async (row, presence, markDead = false) => {
      if (!isPlausibleNPCName(row?.name)) {
        // eslint-disable-next-line no-console
        console.warn('[sceneExtraction] rejecting implausible ' + presence + ' NPC:', row?.name);
        return;
      }
      if (knownSet.has(row.name.toLowerCase())) return; // already on file
      try {
        const npc = generateNPC({
          name: row.name,
          race: 'Human',
          occupation: 'unknown',
          disposition: 'neutral',
          location: locationName,
          presence,
        });
        // shortDesc / firstImpression for mentioned+historical: the LLM
        // gives us relationship or context, which is better signal for
        // the journal than the default "stocky dwarven man" stub.
        const blurb = row.relationship || row.context || '';
        if (blurb) {
          npc.shortDesc = blurb.slice(0, 180);
          npc.firstImpression = blurb;
        }
        const nameIsDescription = isAppearanceDescriptor(row.name);
        npc.knownToParty = !nameIsDescription;
        npc.portraitSvg = generatePortrait(npc);
        let stored = await storeNPC(npc, { campaign });
        if (markDead && stored?.id) {
          try {
            await markNPCDead(stored.id, row.context || '');
            stored = { ...stored, alive: false, causeOfDeath: row.context || '' };
          } catch (deadErr) {
            console.warn('[sceneExtraction] mark-dead failed:', row.name, deadErr);
          }
        }
        // Intentionally NOT added to nearbyNPCs — these are elsewhere/past.
        knownSet.add(row.name.toLowerCase()); // avoid double-store this turn
      } catch (err) {
        // #49 regression-surfacing (2026-04-18): same TDZ-class hazard as
        // the ENTITIES-path catch above. Visible log so future silent
        // swallows surface in-game, not just in devtools.
        console.warn('[sceneExtraction] failed to store ' + presence + ' NPC:', row?.name, err);
        addLog?.(
          `Referential NPC capture failed for "${row?.name || 'unknown'}" (${presence}) — check console.`,
          'warning'
        );
      }
    };
    for (const row of mentionedNpcs) {
      await processReferentialNPC(row, 'elsewhere', false);
    }
    for (const row of historicalNpcs) {
      await processReferentialNPC(row, 'historical', true);
    }
    if (mentionedNpcs.length > 0 || historicalNpcs.length > 0) {
      try {
        // eslint-disable-next-line no-console
        console.log('[sceneExtraction] referential stored:',
          'mentioned=' + mentionedNpcs.length,
          'historical=' + historicalNpcs.length,
          mentionedNpcs.map(n => n.name).concat(historicalNpcs.map(n => n.name)).join(', '));
      } catch { /* log never blocks */ }
    }

    // --- Bug #59 — route LLM items.present → db.areaItems ---
    // Runs before the legacy ENTITIES items loop so the LLM rows land
    // first; the ENTITIES loop below still runs and its (campaign, name)
    // dedup keeps it from re-inserting anything the LLM already stored.
    // LLM rows carry `interactable` from the extractor; description
    // prefers the extractor's description then falls back to the evidence
    // span so the GM can trace which sentence in the narration surfaced
    // the item. `mundane:false` matches the legacy loop — the existing
    // pickup flow treats mundane items differently (no journal entry on
    // first-time-seen), and the extractor only surfaces specific
    // interactables, not ambient decor.
    const llmPresentItems = Array.isArray(llmExtraction?.items?.present)
      ? llmExtraction.items.present
      : [];
    if (llmPresentItems.length > 0) {
      const itemCampaignDataId = getActiveCampaignDataId() || 'orphan';
      for (const itemData of llmPresentItems) {
        const name = (itemData?.name || '').trim();
        if (!name) continue;
        try {
          const item = {
            campaignDataId: itemCampaignDataId,
            name,
            description: itemData.description || itemData.evidence || '',
            location: locationName,
            found: new Date().toISOString(),
            mundane: false,
            interactable: itemData.interactable !== false,
            loot: false,
            _source: 'llm',
          };
          const candidates = await db.areaItems.where('name').equals(name).toArray();
          const existing = candidates.find(c => c.campaignDataId === itemCampaignDataId);
          if (!existing) {
            await db.areaItems.add(item);
            // No journal notification emitted — per
            // feedback_items_narrative_first.md (2026-04-18), items
            // surface via narrative only. The areaItems row still
            // persists for scope/#59 extraction tracking and potential
            // future GM reference, it just doesn't announce itself.
          }
          setAreaItems(prev => {
            if (prev.some(i => i.name === name)) return prev;
            return [...prev, item];
          });
        } catch (err) {
          console.warn('[sceneExtraction] failed to store present item:', name, err);
        }
      }
    }

    // --- Bug #59 — route LLM items.mentioned → rumor in clues tracker ---
    // Items talked about but not in the scene (legendary artifacts, rare
    // loot, "the Dwarven relics they pulled from the Storval") become
    // rumors the party can follow up on. addClue is scope-guarded + no-ops
    // when no campaign is active; we don't need an extra guard here.
    const llmMentionedItems = Array.isArray(llmExtraction?.items?.mentioned)
      ? llmExtraction.items.mentioned
      : [];
    if (llmMentionedItems.length > 0) {
      for (const itemData of llmMentionedItems) {
        const name = (itemData?.name || '').trim();
        if (!name) continue;
        try {
          // Build a human-readable body: description + context + evidence,
          // with the verbatim evidence span last so the GM can always see
          // what the extractor read. Duplicates are fine — the operator
          // can prune / resolve / merge in the journal.
          const parts = [];
          if (itemData.description) parts.push(itemData.description);
          if (itemData.context) parts.push(`Context: ${itemData.context}`);
          if (itemData.evidence) parts.push(`Heard: "${itemData.evidence}"`);
          const text = parts.length ? parts.join(' — ') : `Mentioned: ${name}`;
          await addClue({
            title: name,
            text,
            category: 'rumor',
            source: 'ai',
          });
        } catch (err) {
          console.warn('[sceneExtraction] failed to store mentioned item rumor:', name, err);
        }
      }
    }

    // --- Bug #60 — route LLM locations.accessible → worldTree child nodes ---
    // Exits / doors / stairways / paths directly reachable from this scene
    // become known children of the active world-tree node so the travel
    // picker + Places Here panel surface them automatically. We do NOT
    // auto-descend — the party may or may not enter this turn. Dedup
    // against existing children + against earlier iterations of this same
    // loop (case-insensitive name match) so re-mentions of the same
    // stairway don't pile up duplicate rows. If there's no active world
    // tree yet (legacy pre-#37 save hasn't migrated) the whole block
    // skips harmlessly.
    const inferChildKindForAccessible = (parentKind, accessibleKind) => {
      // Direct kind signal from the extractor wins when it's specific.
      if (accessibleKind === 'room') return NODE_KINDS.ROOM;
      if (accessibleKind === 'stairway') return NODE_KINDS.FLOOR;
      if (accessibleKind === 'building') return NODE_KINDS.BUILDING;
      // Otherwise fall back to the parent-kind ladder used by
      // createChildAtActive — same intent, keeps kinds consistent.
      if (parentKind === NODE_KINDS.WORLD) return NODE_KINDS.COUNTRY;
      if (parentKind === NODE_KINDS.COUNTRY) return NODE_KINDS.REGION;
      if (parentKind === NODE_KINDS.REGION) return NODE_KINDS.TOWN;
      if ([NODE_KINDS.TOWN, NODE_KINDS.CITY, NODE_KINDS.VILLAGE].includes(parentKind)) return NODE_KINDS.BUILDING;
      if (parentKind === NODE_KINDS.BUILDING) return NODE_KINDS.FLOOR;
      if (parentKind === NODE_KINDS.FLOOR) return NODE_KINDS.ROOM;
      if (parentKind === NODE_KINDS.ROOM) return NODE_KINDS.AREA;
      if (parentKind === NODE_KINDS.DUNGEON) return NODE_KINDS.ROOM;
      if (parentKind === NODE_KINDS.WILDERNESS) return NODE_KINDS.LANDMARK;
      return NODE_KINDS.AREA;
    };
    const llmAccessibleLocations = Array.isArray(llmExtraction?.locations?.accessible)
      ? llmExtraction.locations.accessible
      : [];
    if (llmAccessibleLocations.length > 0 && worldTree && activeNode) {
      let mutatedTree = null; // lazy clone; only allocate if we actually add
      const addedThisTurn = new Set();
      const existingChildNames = new Set(
        (activeNode.childrenIds || [])
          .map(cid => (worldTree.nodes[cid]?.name || '').toLowerCase())
          .filter(Boolean)
      );
      for (const locData of llmAccessibleLocations) {
        const name = (locData?.name || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (existingChildNames.has(key) || addedThisTurn.has(key)) continue;
        try {
          if (mutatedTree === null) {
            mutatedTree = { rootId: worldTree.rootId, nodes: { ...worldTree.nodes } };
            for (const nid of Object.keys(mutatedTree.nodes)) {
              mutatedTree.nodes[nid] = { ...mutatedTree.nodes[nid] };
            }
          }
          const childKind = inferChildKindForAccessible(activeNode.kind, locData.kind);
          const newNode = createChildNode(mutatedTree, activeNode.id, {
            name,
            kind: childKind,
            desc: locData.direction ? `Direction: ${locData.direction}` : '',
          });
          // Task #71 — stamp firstMentionedAt so isNodeDiscovered lights
          // these "accessible from here" children up in the World Tree
          // view even before the party walks into them. Without this,
          // a newly-extracted stairway/door would only show once visited.
          newNode.firstMentionedAt = new Date().toISOString();
          addedThisTurn.add(key);
          emitJournalAdd({
            kind: 'location',
            label: name,
            detail: locationName ? `accessible from ${locationName}` : null,
            id: newNode.id,
          });
        } catch (err) {
          console.warn('[sceneExtraction] failed to add accessible location:', name, err);
        }
      }
      if (mutatedTree !== null) {
        setAdventure(prev => prev ? { ...prev, worldTree: mutatedTree } : prev);
      }
    }

    // --- Bug #60 + Task #71 — route LLM locations.mentioned → lead + discovery ---
    // Places talked about but not reachable from here — Temple of Desna
    // across town, a dungeon two regions over, "the old mill". Three
    // side effects per mention:
    //   (1) addClue('lead') — Journal → Clues tab for follow-up
    //   (2) recordEncounteredLocation — Journal → Places tab gets a
    //       visits=0 "heard about" row alongside visited ones. Idempotent
    //       (row either gets created or its visit-count gets bumped —
    //       the tracker is the one source of truth for that table).
    //   (3) firstMentionedAt stamp — if the name matches an existing
    //       world-tree node, flip the discovery bit so the Journal →
    //       World Tree tab lights the node up. Without this, only
    //       physically-visited nodes + their ancestors showed; this is
    //       what closes the #69 narrative-mention gap.
    // All three surfaces are scope-guarded and no-op cleanly when no
    // campaign is active.
    const llmMentionedLocations = Array.isArray(llmExtraction?.locations?.mentioned)
      ? llmExtraction.locations.mentioned
      : [];
    if (llmMentionedLocations.length > 0) {
      // Collect mention names first — we'll stamp the tree once at the end
      // via a functional setAdventure so we always mutate the freshest
      // worldTree (the accessible-locations loop above may have already
      // added children; if we cloned from the captured `worldTree` prop
      // here we'd clobber those additions).
      const mentionedNames = [];
      const nowIso = new Date().toISOString();
      for (const locData of llmMentionedLocations) {
        const name = (locData?.name || '').trim();
        if (!name) continue;
        try {
          // (1) Mentioned-location rumor body: kind + context + verbatim span.
          const parts = [];
          if (locData.kind && locData.kind !== 'unknown') parts.push(`Kind: ${locData.kind}`);
          if (locData.context) parts.push(`Context: ${locData.context}`);
          if (locData.evidence) parts.push(`Heard: "${locData.evidence}"`);
          const text = parts.length ? parts.join(' — ') : `Mentioned: ${name}`;
          await addClue({
            title: name,
            text,
            category: 'lead',
            source: 'ai',
          });
          // (2) Journal Places tab — "heard about" row.
          // mentionOnly:true keeps visits=0 so "heard about 5 times" doesn't
          // read as "visited 5 times"; tracker bumps the separate `mentions`
          // counter instead. A later physical visit bumps visits normally.
          try {
            await recordEncounteredLocation(name, {
              kind: locData.kind && locData.kind !== 'unknown' ? locData.kind : 'unknown',
              description: locData.context || locData.evidence || null,
              mentionOnly: true,
            });
          } catch (locErr) {
            console.warn('[sceneExtraction] failed to record mentioned location:', name, locErr);
          }
          // (3) queue name for tree-stamp below
          mentionedNames.push(name);
        } catch (err) {
          console.warn('[sceneExtraction] failed to store mentioned location lead:', name, err);
        }
      }
      // Stamp firstMentionedAt inside a functional updater so we read the
      // freshest tree (including any accessible-locations children the
      // loop above just added). Dedup: skip if already stamped or if
      // visitCount > 0 (already discovered by stronger signal).
      if (mentionedNames.length > 0) {
        setAdventure(prev => {
          const curTree = prev?.worldTree;
          if (!curTree || !curTree.nodes) return prev;
          let nextTree = null;
          for (const name of mentionedNames) {
            const match = findNodeByName(curTree, name);
            if (!match) continue;
            const live = (nextTree ? nextTree.nodes[match.id] : null) || match;
            if (live.firstMentionedAt || (live.visitCount || 0) > 0) continue;
            if (nextTree === null) {
              nextTree = { rootId: curTree.rootId, nodes: { ...curTree.nodes } };
              for (const nid of Object.keys(nextTree.nodes)) {
                nextTree.nodes[nid] = { ...nextTree.nodes[nid] };
              }
            }
            nextTree.nodes[match.id].firstMentionedAt = nowIso;
          }
          return nextTree ? { ...prev, worldTree: nextTree } : prev;
        });
      }
    }

    // --- Bug #61 — route LLM factions → faction-discovery ledger ---
    // For each extracted faction, try to name-match against the campaign's
    // canonical factions map (case-insensitive, loose match on display name
    // OR id). Matched → recordEncounteredFaction(method:'named') so the
    // Journal's Factions tab picks it up with the archetype + goals already
    // modeled in campaign.data.factions. Unmatched → fall back to addClue
    // as a 'lead' so the GM sees "party heard about an org we haven't
    // modeled yet" — operator can promote to a real campaign faction later.
    // Full archetype hydration from free-form LLM text is deliberately NOT
    // attempted here; that's a larger follow-up design (extractor output
    // alone is too thin to seed the life/resources/goals/relations the
    // FactionsTab + simulation ticks expect).
    const llmFactions = Array.isArray(llmExtraction?.factions)
      ? llmExtraction.factions
      : [];
    if (llmFactions.length > 0) {
      // Build a canonical-name → factionId lookup once. `campaign.data` is
      // the inner campaign object; `campaign.factions` is the legacy path.
      const factionMap = (campaign?.data?.factions || campaign?.factions || {});
      const canonicalByName = new Map();
      for (const [fid, fdata] of Object.entries(factionMap)) {
        const n = (fdata?.name || fid || '').trim().toLowerCase();
        if (n) canonicalByName.set(n, { fid, fdata });
      }
      for (const factionRow of llmFactions) {
        const name = (factionRow?.name || '').trim();
        if (!name) continue;
        try {
          const matched = canonicalByName.get(name.toLowerCase());
          if (matched) {
            // Canonical faction — ledger it with 'named' so knowledgeLevel
            // climbs. disposition_signal is informational only today; the
            // tracker doesn't persist it yet (follow-up: extend with a
            // sparse disposition history column).
            await recordEncounteredFaction(matched.fid, matched.fdata, {
              method: 'named',
              location: locationName || null,
            });
          } else {
            // Unknown faction — store as a 'lead' clue so the GM has the
            // evidence + archetype hint when deciding whether to model it.
            const parts = [];
            if (factionRow.archetype && factionRow.archetype !== 'other') parts.push(`Archetype: ${factionRow.archetype}`);
            if (factionRow.disposition_signal && factionRow.disposition_signal !== 'unknown') parts.push(`Disposition: ${factionRow.disposition_signal}`);
            if (factionRow.evidence) parts.push(`Heard: "${factionRow.evidence}"`);
            const text = parts.length ? parts.join(' — ') : `Mentioned faction: ${name}`;
            await addClue({
              title: name,
              text,
              category: 'lead',
              source: 'ai',
            });
          }
        } catch (err) {
          console.warn('[sceneExtraction] failed to route faction:', name, err);
        }
      }
    }

    // --- Bug #62 — route LLM quests → worldState.quests journal ---
    // Both job (explicit task with reward) and hook (softer invitation)
    // land in the same worldState.quests array that CampaignTab.addQuest
    // writes to — shape is intentionally compatible. Dedup by case-
    // insensitive title against the existing quest list. The extractor
    // returns no objectives (no reliable way to parse them out of
    // narrative), so each quest starts objective-less; the operator can
    // edit in CampaignTab's quest UI afterwards. Kind ('job'|'hook') and
    // urgency go onto the record as _llm* metadata for future UI
    // differentiation; core shape stays compatible with existing
    // updateQuestStatus / toggleObjective flows. We use setWorldState via
    // the prop; no-op cleanly if setWorldState isn't wired (shouldn't
    // happen in normal play).
    const llmQuests = Array.isArray(llmExtraction?.quests)
      ? llmExtraction.quests
      : [];
    if (llmQuests.length > 0 && typeof setWorldState === 'function') {
      // Snapshot current quest titles for dedup. Using worldState captured
      // at processNewEntities entry is fine — within a single turn, the
      // LLM won't emit the same quest twice, and across turns worldState
      // is already fresh by the time React re-renders.
      const existingTitles = new Set(
        (worldState?.quests || [])
          .map(q => (q?.title || '').toLowerCase().trim())
          .filter(Boolean)
      );
      const newQuests = [];
      const addedThisTurn = new Set();
      for (const questRow of llmQuests) {
        const title = (questRow?.title || '').trim();
        if (!title) continue;
        const key = title.toLowerCase();
        if (existingTitles.has(key) || addedThisTurn.has(key)) continue;
        addedThisTurn.add(key);
        // Build a human-readable description from task + giver + location
        // + reward — matches how CampaignTab's add-quest UI composes these.
        const descParts = [];
        if (questRow.task) descParts.push(questRow.task);
        if (questRow.giver) descParts.push(`Giver: ${questRow.giver}`);
        if (questRow.location) descParts.push(`Location: ${questRow.location}`);
        if (questRow.reward) descParts.push(`Reward: ${questRow.reward}`);
        if (questRow.evidence) descParts.push(`Heard: "${questRow.evidence}"`);
        newQuests.push({
          id: `quest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title,
          description: descParts.join('\n'),
          type: 'side',
          status: 'active',
          objectives: [],
          rewards: questRow.reward ? { description: questRow.reward } : null,
          chapter: null,
          addedDate: new Date().toISOString(),
          _source: 'llm',
          _llmKind: questRow.kind || 'job',   // 'job' or 'hook'
          _llmUrgency: questRow.urgency || 'low',
        });
      }
      if (newQuests.length > 0) {
        try {
          setWorldState(prev => ({
            ...(prev || {}),
            quests: [...((prev && prev.quests) || []), ...newQuests],
          }));
          for (const q of newQuests) {
            emitJournalAdd({
              kind: 'quest',
              label: q.title,
              detail: q._llmKind === 'hook' ? 'potential hook' : 'new job',
              id: q.id,
            });
          }
        } catch (err) {
          console.warn('[sceneExtraction] failed to commit LLM quests:', err);
        }
      }
    }

    // --- Bug #63 — route LLM rumors → clues tracker (category:'rumor') ---
    // Rumors are softer world info: gossip, practical tips, overheard
    // warnings. They land as category='rumor' so the Journal → Clues tab
    // can filter them alongside items.mentioned rumors from #59. Source
    // + reliability + verbatim evidence all stuffed into the body so the
    // GM has full context when deciding whether to promote. Short rumors
    // get their `content` used as the title (truncated); longer ones get
    // a synthesized "Rumor: first ~60 chars" title. addClue is scope-
    // guarded so outside an active campaign this no-ops.
    const llmRumors = Array.isArray(llmExtraction?.rumors)
      ? llmExtraction.rumors
      : [];
    if (llmRumors.length > 0) {
      for (const rumorRow of llmRumors) {
        const content = (rumorRow?.content || '').trim();
        if (!content) continue;
        try {
          const title = content.length <= 80
            ? content
            : `Rumor: ${content.slice(0, 60).trim()}…`;
          const parts = [content];
          if (rumorRow.source) parts.push(`Source: ${rumorRow.source}`);
          if (rumorRow.reliability) parts.push(`Reliability: ${rumorRow.reliability}`);
          if (rumorRow.evidence && rumorRow.evidence !== content) parts.push(`Heard: "${rumorRow.evidence}"`);
          await addClue({
            title,
            text: parts.join(' — '),
            category: 'rumor',
            source: 'ai',
          });
        } catch (err) {
          console.warn('[sceneExtraction] failed to store rumor:', content.slice(0, 40), err);
        }
      }
    }

    // --- Bug #64 — route LLM clues.{revealed, resolved} → clues tracker ---
    // `revealed` creates new clue rows (category:'clue', source:'ai') so
    // the investigative journal surfaces them alongside GM-typed leads.
    // `resolved` tries to find an existing clue by case-insensitive topic
    // match (against title, then text) and calls resolveClue on the row;
    // if no match exists we create a NEW clue already stamped resolvedAt,
    // so the journal still has a record that "the party learned X" even
    // if they never formally recorded the mystery first. Body includes
    // topic + resolution + evidence so later review has full context.
    const llmCluesRevealed = Array.isArray(llmExtraction?.clues?.revealed)
      ? llmExtraction.clues.revealed
      : [];
    if (llmCluesRevealed.length > 0) {
      for (const clueRow of llmCluesRevealed) {
        const content = (clueRow?.content || '').trim();
        if (!content) continue;
        try {
          const topic = (clueRow?.topic || '').trim();
          const title = topic || (content.length <= 80 ? content : `${content.slice(0, 60).trim()}…`);
          const parts = [content];
          if (topic && topic !== content) parts.push(`Topic: ${topic}`);
          if (clueRow.evidence && clueRow.evidence !== content) parts.push(`Heard: "${clueRow.evidence}"`);
          await addClue({
            title,
            text: parts.join(' — '),
            category: 'clue',
            source: 'ai',
          });
        } catch (err) {
          console.warn('[sceneExtraction] failed to store revealed clue:', content.slice(0, 40), err);
        }
      }
    }
    const llmCluesResolved = Array.isArray(llmExtraction?.clues?.resolved)
      ? llmExtraction.clues.resolved
      : [];
    if (llmCluesResolved.length > 0) {
      // Snapshot open clues once; resolve-by-topic match is O(existing *
      // resolved) but both sides are small (few resolved events per turn,
      // few open clues per campaign). getClues is scope-guarded so it
      // returns [] outside a campaign — the whole block is effectively
      // a no-op then.
      const openClues = await getClues().catch(() => []);
      for (const resolvedRow of llmCluesResolved) {
        const topic = (resolvedRow?.topic || '').trim();
        const resolution = (resolvedRow?.resolution || '').trim();
        if (!topic && !resolution) continue;
        try {
          const topicKey = topic.toLowerCase();
          const match = topicKey
            ? openClues.find(c => {
                if (c.resolvedAt) return false;
                const t = (c.title || '').toLowerCase();
                const tx = (c.text || '').toLowerCase();
                return t.includes(topicKey) || tx.includes(topicKey);
              })
            : null;
          if (match) {
            // Single-write resolve + append (#64 follow-up closed 2026-04-18):
            // resolveClue now stamps resolvedAt AND appends the closure
            // context in one updateClue call, so the resolved card shows
            // the reasoning without a second patch racing the first.
            await resolveClue(match.id, true, {
              noteSuffix: resolution || '(no detail)',
              evidence: resolvedRow?.evidence || null,
            });
          } else {
            // No matching open clue — create a resolved row so the topic
            // + resolution still land in the journal for later review.
            const parts = [];
            if (resolution) parts.push(`Resolution: ${resolution}`);
            if (resolvedRow.evidence) parts.push(`Heard: "${resolvedRow.evidence}"`);
            const text = parts.length
              ? parts.join(' — ')
              : `Resolved: ${topic || '(untitled)'}`;
            await addClue({
              title: topic || (resolution.slice(0, 60) + '…'),
              text,
              category: 'clue',
              source: 'ai',
              resolvedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.warn('[sceneExtraction] failed to route resolved clue:', topic || resolution.slice(0, 40), err);
        }
      }
    }

    // --- Bug #65 — route LLM lore → db.journalNotes (category:'lore') ---
    // World-fact knowledge (history / geography / religion / culture /
    // creature / legend / politics / magic) lands as a lore-categorized
    // journal note. The LLM already classifies into one of 8 sub-
    // categories; we tag the note with `lore:<subcat>` so the Journal's
    // Notes filter can break them out without us having to extend the
    // top-level category enum. Body format is `Topic — Fact — Heard: "…"`
    // so later review has topic grouping + verbatim evidence attached.
    // addJournalNote is scope-guarded (activeScope() handles missing
    // campaign) so the whole block no-ops outside an active campaign.
    const llmLore = Array.isArray(llmExtraction?.lore) ? llmExtraction.lore : [];
    if (llmLore.length > 0) {
      for (const loreRow of llmLore) {
        const fact = (loreRow?.fact || '').trim();
        const topic = (loreRow?.topic || '').trim();
        if (!fact && !topic) continue;
        try {
          const subCategory = loreRow?.category || 'history';
          const parts = [];
          if (topic) parts.push(topic);
          if (fact) parts.push(fact);
          if (loreRow.evidence && loreRow.evidence !== fact) {
            parts.push(`Heard: "${loreRow.evidence}"`);
          }
          const text = parts.join(' — ') || `Lore (${subCategory}): ${topic || fact}`;
          // Tag subcategory in the category string so Journal filter can
          // show all lore OR a specific subcat without a schema change.
          await addJournalNote(text, `lore:${subCategory}`);
        } catch (err) {
          console.warn('[sceneExtraction] failed to store lore entry:', (topic || fact).slice(0, 40), err);
        }
      }
    }

    // --- Task #64 — route llmExtraction.destructions → setNodeStatus ---
    // For each destruction row the LLM emitted, find the best-matching
    // worldTree node by case-insensitive name. Scan priority: activeNode
    // itself, then activeNode's siblings/descendants via ancestor subtrees
    // (closer-to-party wins), then a global findNodeByName fallback. Once
    // matched, flip the node's status via setNodeStatus (which handles
    // cascade + history append per Task #63) and emit a journal entry so
    // the party log shows the change.
    //
    // Enum-strict: normalizeResult() already dropped rows without a valid
    // destroyed/sealed status, so we can trust status at this point. Per-
    // row try/catch: one fouled row doesn't block the rest, and a "no
    // match" only logs a warn — no-op rather than throw.
    const llmDestructions = Array.isArray(llmExtraction?.destructions)
      ? llmExtraction.destructions
      : [];
    if (llmDestructions.length > 0 && worldTree && worldTree.nodes) {
      const findDestructionTarget = (tree, anchorId, targetName) => {
        if (!tree?.nodes || !targetName) return null;
        const needle = String(targetName).trim().toLowerCase();
        if (!needle) return null;
        // Ancestor-first expanding rings: at each ancestor, scan self + all
        // descendants for a name match, walking up from the party's node
        // to the root. The deepest ring is tried first so "the manor" when
        // the party is at Foxglove Manor resolves to the Foxglove node
        // rather than some other manor in the tree.
        if (anchorId && tree.nodes[anchorId]) {
          const ancestry = findNodePath(tree, anchorId);
          for (let i = ancestry.length - 1; i >= 0; i--) {
            const subRootId = ancestry[i];
            const subRoot = tree.nodes[subRootId];
            if (!subRoot) continue;
            if ((subRoot.name || '').trim().toLowerCase() === needle) return subRoot;
            const stack = [...(subRoot.childrenIds || [])];
            const seen = new Set();
            while (stack.length) {
              const cur = stack.pop();
              if (seen.has(cur)) continue;
              seen.add(cur);
              const node = tree.nodes[cur];
              if (!node) continue;
              if ((node.name || '').trim().toLowerCase() === needle) return node;
              for (const c of (node.childrenIds || [])) stack.push(c);
            }
          }
        }
        // Global fallback — catches cases where activeNode is null, or a
        // cross-region destruction ("Foxglove Manor burned") fires while
        // the party is outside the subtree that contains the match.
        return findNodeByName(tree, targetName);
      };

      const destructionUpdates = [];
      const nowIso = new Date().toISOString();
      for (const dRow of llmDestructions) {
        try {
          const match = findDestructionTarget(worldTree, activeNode?.id || null, dRow.target);
          if (!match) {
            console.warn('[sceneExtraction] destructions: no world-tree match for target:', dRow.target);
            continue;
          }
          destructionUpdates.push({
            id: match.id,
            name: match.name,
            status: dRow.status,
            reason: dRow.reason || '',
            at: nowIso,
          });
        } catch (err) {
          console.warn('[sceneExtraction] failed to resolve destruction target:', dRow?.target, err);
        }
      }

      if (destructionUpdates.length > 0) {
        // Mutate tree via functional setAdventure so we always stamp the
        // freshest tree (any earlier loop in this processNewEntities pass
        // — accessible-locations, mentioned-locations — may have already
        // cloned + added children).
        setAdventure(prev => {
          const curTree = prev?.worldTree;
          if (!curTree || !curTree.nodes) return prev;
          const nextTree = { rootId: curTree.rootId, nodes: { ...curTree.nodes } };
          for (const nid of Object.keys(nextTree.nodes)) {
            nextTree.nodes[nid] = { ...nextTree.nodes[nid] };
          }
          let anyTouched = false;
          for (const upd of destructionUpdates) {
            try {
              const touched = setNodeStatus(nextTree, upd.id, upd.status, {
                reason: upd.reason,
                at: upd.at,
                cascade: true,
              });
              if (touched && touched.length > 0) anyTouched = true;
            } catch (err) {
              console.warn('[sceneExtraction] setNodeStatus threw for', upd.name, err);
            }
          }
          return anyTouched ? { ...prev, worldTree: nextTree } : prev;
        });

        // Fire journal events outside the functional updater so they
        // aren't repeated if React re-invokes the updater (React may
        // double-invoke updaters in strict mode). Per-row try/catch in
        // emitJournalAdd already no-ops on malformed payloads.
        for (const upd of destructionUpdates) {
          try {
            emitJournalAdd({
              kind: 'location',
              label: upd.name,
              detail: upd.reason ? `${upd.status}: ${upd.reason}` : upd.status,
            });
          } catch (err) {
            console.warn('[sceneExtraction] journal emit failed for', upd.name, err);
          }
        }
      }
    }

    // Store new area items
    if (normalizedEntities.items && normalizedEntities.items.length > 0) {
      const campaignDataId = getActiveCampaignDataId() || 'orphan';
      for (const itemData of normalizedEntities.items) {
        try {
          const item = {
            campaignDataId,
            name: itemData.name,
            description: itemData.description || '',
            location: locationName,
            found: new Date().toISOString(),
            mundane: false,
            interactable: true,
            loot: false,
          };
          // v11 — dedup by (campaign, name) so a "Crumpled note" in campaign A
          // doesn't suppress the same-name pickup in campaign B.
          const candidates = await db.areaItems.where('name').equals(item.name).toArray();
          const existing = candidates.find(c => c.campaignDataId === campaignDataId);
          if (!existing) {
            await db.areaItems.add(item);
            // No journal notification — per
            // feedback_items_narrative_first.md (2026-04-18), items
            // surface via narrative only. Persistence stays for
            // scope/#59 extraction tracking.
          }
          setAreaItems(prev => {
            if (prev.some(i => i.name === item.name)) return prev;
            return [...prev, item];
          });
        } catch (err) {
          console.warn('[Entity] Failed to store item:', itemData.name, err);
        }
      }
    }
  };

  // Build merged pins for a given mapId: registry POIs (with overrides, minus hidden) + custom GM pins
  const getMergedPins = useMemo(() => {
    const overrides = worldState?.gmPinOverrides || {};
    const hidden = worldState?.gmHiddenPins || {};
    const customPins = worldState?.gmPins || {};
    return (mapId) => {
      const mapData = mapRegistry.getMap(mapId);
      const hiddenSet = new Set(hidden[mapId] || []);
      const mapOverrides = overrides[mapId] || {};
      const registryPins = (mapData?.poi || [])
        .filter(p => !hiddenSet.has(p.id))
        .map(p => ({
          id: p.id, label: p.label, type: p.type,
          xPct: mapOverrides[p.id]?.xPct ?? p.xPct,
          yPct: mapOverrides[p.id]?.yPct ?? p.yPct,
        }));
      const custom = (customPins[mapId] || []).map(p => ({
        id: p.id, label: p.label, type: p.type, xPct: p.xPct, yPct: p.yPct,
      }));
      return [...registryPins, ...custom];
    };
  }, [worldState?.gmPinOverrides, worldState?.gmHiddenPins, worldState?.gmPins]);

  const getRegions = useMemo(() => {
    const gmRegions = worldState?.gmRegions || {};
    return (mapId) => gmRegions[mapId] || [];
  }, [worldState?.gmRegions]);

  const TOWN_LOCATIONS = [
    { name: 'Sandpoint', terrain: 'town', desc: 'A sleepy coastal town on the Lost Coast of Varisia. The sound of gulls mixes with the bustle of the marketplace. Townsfolk go about their daily business under clear skies.' },
    { name: 'Magnimar', terrain: 'city', desc: 'The great city of monuments rises before you. Towering structures of ancient Thassilonian design loom overhead as merchants hawk their wares in crowded bazaars.' },
    { name: 'Riddleport', terrain: 'city', desc: 'This lawless port city stinks of brine and danger. The massive Cyphergate arches over the harbor, its ancient runes still undeciphered. Cutthroats and scholars alike walk these streets.' },
    { name: 'Korvosa', terrain: 'city', desc: 'The oldest human settlement in Varisia sprawls across the banks of the Jeggare River. Castle Korvosa looms atop its great pyramid, watching over the city below.' },
    { name: 'Kaer Maga', terrain: 'city', desc: 'The city of strangers sits atop the great cliff face. Within its ancient walls, every vice and virtue finds a home among the most diverse population in Varisia.' },
    { name: 'The Rusty Dragon Inn', terrain: 'tavern', desc: 'You push open the door to Sandpoint\'s most popular tavern. The warmth of the hearth and the smell of Ameiko\'s famous curry salmon greet you. Adventurers and locals share stories over mugs of ale.' },
    { name: 'The Fatman\'s Feedbag', terrain: 'tavern', desc: 'This rough-and-tumble tavern caters to sailors, dock workers, and those who prefer not to be asked questions. The ale is cheap and the company cheaper.' },
    { name: 'Turtleback Ferry', terrain: 'town', desc: 'A small lakeside community nestled in the shadow of the mountains. Fishing boats bob gently in the water, and the locals eye newcomers with cautious curiosity.' },
  ];

  const [adventureType, setAdventureType] = useState(null); // 'town', 'dungeon', or null

  const startAdventure = async (type = 'dungeon', specificLocation = null) => {
    traceEngine('startAdventure', {
      type,
      specificLocation: typeof specificLocation === 'string'
        ? specificLocation
        : specificLocation?.id || specificLocation?.name || null,
      partyLen: party?.length || 0,
      hasCampaign: !!campaign,
    });
    if (!party || party.length === 0) {
      addLog?.('You need at least one character in your party to start an adventure!', 'warning');
      return;
    }

    // --- Step 1: pick the location (authoritative — never clobbered by a catch) ---
    // Bug #9 used to be: any downstream async failure (NPC storeNPC, journal
    // record, etc.) triggered the outer catch, which hard-overrode the chosen
    // location to "The Crossroads". The user would see Sandpoint for a frame
    // then get yanked to Crossroads. Each fallible step now has its own
    // try/catch and degrades gracefully instead of blowing away the location.
    //
    // Bug #6: "Return to Town" used to pick a RANDOM town every time. We now
    // return to the most recently visited town (persisted on `adventure.lastTown`),
    // falling back to the campaign's home town (Sandpoint for RotRL) and only
    // then to a random pick.
    let loc;
    try {
      if (type === 'town') {
        if (specificLocation) {
          loc = specificLocation;
        } else if (adventure?.lastTown) {
          loc = adventure.lastTown;
        } else {
          // Default to the campaign's home town — Sandpoint for RotRL.
          const home = TOWN_LOCATIONS.find(t => t.name === 'Sandpoint') || TOWN_LOCATIONS[0];
          loc = home;
        }
      } else {
        const locations = await db.locations.toArray();
        loc = locations.length > 0
          ? locations[Math.floor(Math.random() * locations.length)]
          : { name: 'The Unknown Depths', desc: 'A dark and mysterious place awaits...', terrain: 'underground' };
      }
    } catch (err) {
      console.warn('[Adventure] Location lookup failed; using fallback:', err);
      loc = type === 'town'
        ? (specificLocation || adventure?.lastTown || TOWN_LOCATIONS.find(t => t.name === 'Sandpoint') || TOWN_LOCATIONS[0])
        : { name: 'The Unknown Depths', desc: 'A dark and mysterious place awaits...', terrain: 'underground' };
    }

    // Preserve lastTown across dungeon runs so "Return to Town" goes home.
    // If we're entering a town now, that town becomes the new lastTown.
    // If we're heading into a dungeon from a town, carry the current town over.
    const lastTown = type === 'town'
      ? loc
      : (adventure?.type === 'town' ? adventure.location : adventure?.lastTown);

    setAdventure({ active: true, location: loc, room: 0, explored: [], type, lastTown });
    setAdventureType(type);
    addLog?.(`=== ${loc.name.toUpperCase()} ===`, 'header');
    // Bug #38 (2026-04-17): previously we logged loc.desc here unconditionally
    // AND then fired the AI arrival narrate below, so the operator saw TWO
    // opening paragraphs ("A sleepy coastal town..." then "The salt-tinged
    // wind..."). The user asked for a single location-specific opener. We
    // now defer loc.desc to a post-narrate fallback — it logs only if the
    // AI scene-intro didn't produce text. See the `introLogged` guard below.

    // --- Step 2: side-effect work, each isolated so one failure doesn't kill the scene ---

    // Journal auto-record — idempotent, bumps visit count on repeat entries.
    try {
      await recordEncounteredLocation(loc.name, {
        kind: type === 'town' ? 'town' : type === 'dungeon' ? 'dungeon' : 'wilderness',
        description: loc.desc,
        region: loc.region || null,
      });
    } catch (err) {
      console.warn('[Journal] Failed to record location:', err);
    }

    // NPCs populate EXCLUSIVELY from narrative (the AI scene-intro below
    // + any subsequent action narration), extracted via processNewEntities.
    // Previously we pre-seeded 2-4 random NPCs from generateNearbyNPCs the
    // moment the party arrived, but that produced "phantom NPCs" that the
    // DM never actually mentioned — e.g. two random strangers in the Nearby
    // panel before the opening paragraph was written. Tom's rule: if the
    // narrative didn't name/describe them, they aren't in the scene.
    // Clear the panel on arrival so the prior scene's crowd doesn't linger.
    const avgLevel = party.reduce((s, c) => s + (c.level || 1), 0) / (party.length || 1);
    setNearbyNPCs([]);

    // Generate area items
    // Bug #31: loc.desc is the canonical scene description for the arrival
    // — feed it to the extractor so the initial panel reflects what the
    // operator just saw on-screen. The async AI intro happens after this
    // block; a follow-up refresh below merges those items in once the
    // intro paragraph lands.
    try {
      const items = generateAreaItems(loc, avgLevel, { narrative: loc?.desc || '' });
      setAreaItems(items);
    } catch (err) {
      console.warn('[Items] Failed to generate area items:', err);
      setAreaItems([]);
    }

    // Initial context actions
    try {
      const initEvent = { type: type === 'town' ? 'event' : 'explore', text: loc.desc };
      setContextActions(generateContextActions(initEvent, { type }, party));
      setLastEvent(initEvent);
    } catch (err) {
      console.warn('[Context] Failed to generate initial context actions:', err);
    }

    // Bug #13: the static loc.desc alone made scene starts feel sparse — the
    // user reported "there used to be an introductory paragraph when the
    // adventure starts." Fire an AI scene-intro so the scene opens with a
    // richer atmospheric beat (mood, sounds, what draws the eye).
    //
    // Bug #38 (2026-04-17): this used to ALSO be layered on top of an
    // unconditional loc.desc log, producing two paragraphs. We now log
    // loc.desc ONLY as a fallback when the AI narrate didn't land, gated
    // by the `introLogged` flag. One paragraph on arrival, always.
    // Non-blocking: degrades silently if AI is unavailable or slow.
    //
    // Bug #38 follow-up (2026-04-18): when CampaignSelector just fired a
    // `chapter_intro` narration (campaign opener), skip the arrival narrate
    // AND the loc.desc fallback entirely — the chapter_intro already set
    // the scene for THIS location, and stacking a second "party arrives"
    // paragraph on top is exactly what the operator flagged as "two intro
    // narrations". Flag is one-shot: consumed here, cleared for next time.
    const skipArrivalNarrate = consumePendingChapterIntro?.() === true;
    let introLogged = false;
    if (skipArrivalNarrate) {
      // chapter_intro already narrated this scene; don't stack another intro.
      // Mark introLogged so the loc.desc fallback below ALSO sits out —
      // chapter_intro fired the one paragraph the operator wanted.
      traceEngine('startAdventure:skipArrivalNarrate', { reason: 'chapter_intro_just_fired', loc: loc?.name });
      introLogged = true;
    } else {
      try {
        setNarrating(true);
        const arrivalAction =
          type === 'town'
            ? `The party arrives in ${loc.name}. Open the scene atmospherically — the sounds of the town, the light, the mood, what first catches their eye. Introduce no new named NPCs and do not start combat. Keep to a short paragraph (3–5 sentences).`
            : `The party arrives at ${loc.name}. Set the opening scene atmospherically — the approach, the air, what they see and hear, the feeling of the place. Do not spawn enemies yet. Keep to a short paragraph (3–5 sentences).`;
        const introResult = await dmEngine.narrate(
          'custom',
          {
            party,
            encounter: {
              name: loc.name,
              description: loc.desc,
              type: type === 'town' ? 'roleplay' : 'exploration',
            },
            recentLog: (gameLog || []).slice(-6),
          },
          arrivalAction,
        );
        if (introResult?.text) {
          addLog?.(introResult.text, 'narration');
          introLogged = true;
        }
        if (introResult) {
          // Always pass through the heuristic extractor, even if newEntities is
          // missing — the fallback will pick up named NPCs the AI forgot to
          // list in ENTITIES. See #30 (Bertha Cray).
          try {
            processNewEntities?.(introResult.newEntities, null, introResult.text || '');
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        console.warn('[Adventure] Scene intro narration failed; using base description only:', err);
      } finally {
        setNarrating(false);
      }
    }

    // Fallback: if the AI narrate produced nothing (no API key, network error,
    // empty text), log the static loc.desc so the arrival isn't completely
    // silent. This is the tail end of the #38 fix — loc.desc never stacks on
    // top of a successful AI narrate, but we still have a floor.
    if (!introLogged && loc?.desc) {
      addLog?.(loc.desc, 'narration');
    }

    // NOTE: the old "You notice X nearby" summary line was removed with the
    // pre-narrative seed block. NPCs now appear in the Nearby panel only
    // after the AI narration names them (processNewEntities above), so any
    // restatement here would either duplicate the intro paragraph or lie
    // about who is present.
  };

  // Town scenes — longer, more immersive descriptions that set up meaningful choices
  const TOWN_EVENTS = [
    { type: 'npc', text: 'As you pass through the market square, a grizzled dwarf merchant catches your eye from behind his cart. His wares are covered with a worn cloth, but you notice what appears to be Thassilonian script etched into the edge of something metallic. He watches you with keen, appraising eyes, as if sizing up whether you are worth his time.', log: 'npc' },
    { type: 'npc', text: 'A young woman in a plain dress hurries toward your group, glancing nervously over her shoulder. Her face is pale and drawn, dark circles under her eyes suggesting sleepless nights. She clutches a small holy symbol of Desna and seems to want to tell you something, but hesitates, biting her lip as she studies your faces.', log: 'npc' },
    { type: 'npc', text: 'The town crier reads from a fresh parchment near the garrison. A crowd has gathered — farmers mostly, their faces lined with worry. The notice describes a band of highwaymen that has been attacking trade caravans on the Lost Coast Road. The Sheriff is offering a bounty, but the locals seem skeptical that anyone will take the job.', log: 'info' },
    { type: 'npc', text: 'The sound of a lute drifts from the square where a traveling bard has gathered a small audience. His song tells of the ancient Runelords and their great monuments — the towering structures that still dot the Varisian landscape. As the melody reaches its crescendo, you notice several townsfolk exchanging uneasy glances. The subject matter seems to touch a nerve here.', log: 'narration' },
    { type: 'npc', text: 'You feel a brush against your hand as a hooded figure passes close in the crowd. When you look down, you find a folded scrap of parchment pressed into your palm. The figure has already disappeared into the press of bodies. The note, written in hasty script, reads simply: "The old mill. Midnight. Come alone." The paper smells faintly of seawater and something metallic.', log: 'danger' },
    { type: 'rumor', text: 'At a corner table in the tavern, two farmers speak in low voices over their cups. One leans forward: "Three more gone this month from the south farms. Sheriff Hemlock keeps saying wolves, but I found tracks out by the Hambley place — and wolves don\'t walk on two legs." His companion nods grimly, gripping his mug tighter.', log: 'info' },
    { type: 'rumor', text: 'The innkeeper pauses while wiping down the bar and glances around before leaning close. "I wouldn\'t go wandering near the Old Light after dark if I were you. Couple of fishermen swear they heard chanting coming from the ruins last new moon. And old Brodert — the scholar, you know — he\'s been muttering about \'Thassilonian resonance\' or some such." The innkeeper shakes their head and moves on.', log: 'info' },
    { type: 'rumor', text: 'Near the garrison, two town guards stand arguing. "It\'s just a few scouts, I\'m telling you," insists the younger one. The veteran guard crosses his arms. "That\'s what they said before the raid five years ago. You weren\'t here for that. I was." She pats the hilt of her sword. "Goblins don\'t just \'scout.\' They\'re planning something. Mark my words."', log: 'info' },
    { type: 'shop', text: 'The general store\'s door stands open, warm lantern light spilling onto the cobblestones. Inside, the shopkeeper is arranging a new shipment of goods on the shelves — rope, lanterns, rations, and what looks like a fine set of masterwork thieves\' tools still in their leather case. A few weapons hang on the far wall, gleaming under the light.', log: 'narration' },
    { type: 'shop', text: 'A weathered sign reading "Pillbug\'s Pantry" marks a small apothecary wedged between larger buildings. Through the window you see shelves lined with colorful vials and dried herbs. The elderly proprietor notices you looking and raises a hand in greeting, gesturing to a small display of healing potions near the door.', log: 'narration' },
    { type: 'event', text: 'A sharp crack splits the air as a cart axle snaps in the middle of the street. Barrels of salted fish tumble across the cobblestones, rolling in every direction. The carter curses loudly while a crowd gathers — some to help, others eyeing the spilled goods with opportunistic interest. A stray dog seizes the moment, snatching a fish and bolting into an alley.', log: 'narration' },
    { type: 'event', text: 'A Varisian performer has set up in the town square, juggling flaming torches while a younger woman plays a tambourine. The crowd watches in delight, tossing copper coins into an upturned hat. For a moment, the troubles of the world feel distant. You notice a couple of children mimicking the juggler with sticks, nearly hitting a passing merchant.', log: 'narration' },
    { type: 'event', text: 'A gaggle of children races past, waving stick swords and shouting battle cries. "I\'m the hero!" yells one. "And I\'m the goblin chief!" screams another, pulling a hideous face. They skid to a halt when they spot your party, eyes going wide. "Are you REAL adventurers?" the tallest one whispers, awestruck. The others crowd around, peppering you with questions.', log: 'narration' },
    { type: 'trouble', text: 'A deft hand brushes against your belt pouch. In the split second before the thief pulls away, something — instinct, training, or luck — makes you glance down. You catch a fleeting glimpse of nimble fingers retreating. The would-be pickpocket, a lean figure in a patched cloak, meets your eyes with a flash of alarm and starts pushing through the crowd.', log: 'danger' },
    { type: 'trouble', text: 'The sound of breaking glass erupts from the tavern ahead, followed by angry shouting. A body flies through the front window, landing hard on the street in a shower of splinters. Inside, chairs scrape and fists connect. A barmaid ducks behind the counter. Two dock workers square off against a thick-necked stranger covered in tattoos. No one has called the sheriff yet.', log: 'danger' },
  ];

  const handleExplore = async () => {
    if (!adventure || !party || party.length === 0) {
      addLog?.('No active adventure or party!', 'warning');
      return;
    }

    const isTown = adventure.type === 'town';
    setLoading(true);

    try {
      if (isTown) {
        // Town exploration — pick a scene seed, then let AI narrate or use the seed directly
        const event = TOWN_EVENTS[Math.floor(Math.random() * TOWN_EVENTS.length)];

        // Try AI narration for richer scene description
        let aiActions = [];
        // Bug #31: capture the actual narrated scene text so the area-items
        // refresh below can extract scene objects the DM just mentioned.
        // Falls back to the static event.text if AI narration failed.
        let lastNarration = event.text;
        try {
          const result = await dmEngine.narrate('custom', {
            party,
            encounter: { name: adventure.location?.name || 'Town', description: adventure.location?.desc || '', type: 'roleplay' },
            recentLog: (gameLog || []).slice(-10),
          }, `I walk around ${adventure.location?.name || 'town'} and explore. Scene seed (use as inspiration, don't repeat verbatim): ${event.text}`);
          addLog?.(result.text, event.log || 'narration');
          if (result.text) lastNarration = result.text;
          // Pass narrative text so heuristic extractor can pick up named
          // speakers even when the AI forgot the ENTITIES metadata line.
          processNewEntities(result.newEntities, null, result.text || '');
          if (result.suggestedActions && result.suggestedActions.length > 0) {
            aiActions = result.suggestedActions;
          }
        } catch {
          // Fallback to pre-written event
          addLog?.(event.text, event.log);
        }

        // Generate NPC if this is an NPC encounter event
        if (event.type === 'npc' || event.type === 'shop') {
          const avgLevel = party.reduce((s, c) => s + (c.level || 1), 0) / (party.length || 1);
          const npcOpts = { location: adventure.location?.name || 'Town' };
          if (event.type === 'shop') npcOpts.occupation = 'merchant';
          if (event.text.toLowerCase().includes('dwarf')) npcOpts.race = 'Dwarf';
          if (event.text.toLowerCase().includes('bard')) { npcOpts.class = 'Bard'; npcOpts.occupation = 'bard'; }
          if (event.text.toLowerCase().includes('hooded')) npcOpts.personality = 'secretive';
          if (event.text.toLowerCase().includes('nervous')) npcOpts.personality = 'nervous';
          npcOpts.level = Math.max(1, Math.floor(avgLevel) + Math.floor(Math.random() * 3) - 1);

          const npc = generateNPC(npcOpts);
          npc.portraitSvg = generatePortrait(npc);
          const stored = await storeNPC(npc, { campaign });
          // Bug #27 — dedupe by id first so a reconciled placeholder row
          // updates in place instead of producing a duplicate sidebar entry.
          setNearbyNPCs(prev => {
            if (stored?.id != null && prev.some(n => n.id === stored.id)) {
              return prev.map(n => n.id === stored.id ? { ...n, ...stored } : n);
            }
            if (prev.some(n => n.name === stored.name)) return prev;
            return [...prev, { ...npc, ...stored }];
          });
          const desc = npc.shortDesc || 'a stranger';
          const occDesc = npc.occupation ? ` who appears to be a ${npc.occupation}` : '';
          addLog?.(`You notice ${desc}${occDesc}. They seem ${npc.disposition}.`, 'npc');
        }

        // Use AI-suggested actions if available, otherwise generate from scene text
        if (aiActions.length > 0) {
          setContextActions(aiActions);
        } else {
          setContextActions(generateContextActions(event, adventure, party));
        }
        setLastEvent(event);

        // Refresh area items. Bug #31: use the AI narration text (if we
        // got one) as the extractor seed, so the panel reflects the scene
        // the DM just described instead of a random pool re-roll. Drop
        // the random-chance gate — a refresh after every explore beat
        // feels more responsive, and the extractor is deterministic
        // per-narration anyway.
        {
          const avgLvl = party.reduce((s, c) => s + (c.level || 1), 0) / (party.length || 1);
          // We don't want to lose already-taken loot references, so keep
          // existing loot items and merge the fresh extraction on top.
          setAreaItems(prev => {
            const kept = prev.filter(i => i.loot && !i.taken);
            // Bug #49: enrich location with world-tree node context so
            // the category resolver sees the leaf kind (e.g. tavern)
            // rather than falling back to the parent town. Extraction
            // is narrative-only, but category flows into tracing +
            // future opt-in GM seeds.
            const enrichedLoc = {
              ...(adventure.location || {}),
              node: activeNode || null,
              kind: activeNode?.kind,
              ancestryNames: (breadcrumb || []).map(b => b?.name).filter(Boolean),
              ancestryKinds: (breadcrumb || []).map(b => b?.kind).filter(Boolean),
            };
            const refreshed = generateAreaItems(
              enrichedLoc,
              avgLvl,
              {
                narrative: lastNarration || event?.text || '',
                existing: kept,
              }
            );
            return [...kept, ...refreshed].slice(0, 6);
          });
        }

        // Small chance of trouble escalating
        if (event.type === 'trouble' && Math.random() < 0.3) {
          const monsters = await db.monsters.toArray();
          const lowCr = monsters.filter(m => m.cr <= 2 && m.type?.toLowerCase().includes('humanoid'));
          if (lowCr.length > 0) {
            const thug = lowCr[Math.floor(Math.random() * lowCr.length)];
            const count = Math.max(1, Math.floor(Math.random() * 3) + 1);
            addLog?.(`Things escalate! ${count} ${thug.name}${count > 1 ? 's' : ''} draw weapons!`, 'danger');

            const enemies = Array(count).fill(null).map((_, i) => ({
              id: `enemy_${Date.now()}_${i}`,
              name: count > 1 ? `${thug.name} ${i + 1}` : thug.name,
              hp: thug.hp || 10, currentHP: thug.hp || 10,
              ac: thug.ac || 12, cr: thug.cr || 1,
              atk: thug.atk || '', dmg: thug.dmg || '',
              type: thug.type || '', special: thug.special || '',
              init: thug.init || 0,
            }));

            const order = [
              ...party.map(p => ({ id: p.id, name: p.name, init: roll(20) + Math.floor(((p.abilities?.DEX || 10) - 10) / 2) })),
              ...enemies.map(e => ({ id: e.id, name: e.name, init: roll(20) + (e.init || 0) })),
            ].sort((a, b) => b.init - a.init);

            setCombat?.({ active: true, round: 1, order: order.map(({ id, name }) => ({ id, name })), currentTurn: 0, enemies });
            // Combat panel opens automatically via setCombat
          }
        }

        // No random gold in town — unrealistic. Gold is earned through quests and work.
      } else {
        // Dungeon exploration — monsters, traps, treasure
        const monsters = await db.monsters.toArray();
        const locations = await db.locations.toArray();

        // Filter monsters by approximate party level
        const avgLevel = party.reduce((s, c) => s + (c.level || 1), 0) / party.length;
        const crRange = [Math.max(0.25, avgLevel - 2), avgLevel + 2];
        const levelAppropriate = monsters.filter(m => m.cr >= crRange[0] && m.cr <= crRange[1]);
        const monsterPool = levelAppropriate.length > 5 ? levelAppropriate : monsters.filter(m => m.cr <= 5);

        const encounter = Math.random();
        if (encounter < 0.35) {
          // Combat
          const monster = monsterPool[Math.floor(Math.random() * monsterPool.length)];
          if (monster) {
            const monsterCount = Math.max(1, Math.min(4, Math.floor(Math.random() * party.length) + 1));
            const enemies = Array(monsterCount).fill(null).map((_, i) => ({
              id: `enemy_${Date.now()}_${i}`,
              name: monsterCount > 1 ? `${monster.name} ${i + 1}` : monster.name,
              hp: monster.hp || 20, currentHP: monster.hp || 20,
              ac: monster.ac || 12, cr: monster.cr,
              xp: monster.xp || Math.floor(monster.cr * 300),
              atk: monster.atk || '', dmg: monster.dmg || '',
              type: monster.type || '', special: monster.special || '',
              init: monster.init || 0,
            }));

            addLog?.(`You encounter ${monsterCount > 1 ? monsterCount + ' ' : 'a '}${monster.name}${monsterCount > 1 ? 's' : ''}!`, 'event');

            const order = [
              ...party.map(p => ({ id: p.id, name: p.name, init: roll(20) + Math.floor(((p.abilities?.DEX || 10) - 10) / 2) })),
              ...enemies.map(e => ({ id: e.id, name: e.name, init: roll(20) + Math.floor((monster.init || 0)) })),
            ].sort((a, b) => b.init - a.init);

            setCombat?.({ active: true, round: 1, order: order.map(({ id, name }) => ({ id, name })), currentTurn: 0, enemies });
            // Combat panel opens automatically via setCombat
          }
        } else if (encounter < 0.55) {
          // Trap
          const traps = await db.traps.toArray();
          const trap = traps.length > 0 ? traps[Math.floor(Math.random() * traps.length)] : { name: 'Hidden Trap', effect: '2d6 damage' };
          const percCheck = roll(20) + Math.max(...party.map(p => Math.floor(((p.abilities?.WIS || 10) - 10) / 2)));
          if (percCheck >= (trap.perception || 15)) {
            addLog?.(`Your keen eyes spot a ${trap.name} ahead! You carefully disarm it.`, 'success');
          } else {
            const dmg = rollDice(2, 6).total;
            const victim = party[Math.floor(Math.random() * party.length)];
            if (victim) {
              updateCharHP?.(victim.id, -dmg);
              addLog?.(`${trap.name}! ${victim.name} takes ${dmg} damage! ${trap.effect || ''}`, 'danger');
            }
          }
        } else {
          // Treasure or discovery
          const treasureRoll = Math.random();
          if (treasureRoll < 0.4) {
            const gold = rollDice(4, 10).total * (Math.floor(avgLevel) || 1);
            addLog?.(`You find a cache of treasure: ${gold} gold pieces!`, 'loot');
          } else if (treasureRoll < 0.7) {
            const items = ['Potion of Cure Light Wounds', 'Scroll of Magic Missile', 'Masterwork Longsword', '+1 Cloak of Resistance', 'Wand of Magic Missile (12 charges)', 'Potion of Bull\'s Strength'];
            const found = items[Math.floor(Math.random() * items.length)];
            addLog?.(`You discover ${found} hidden in an alcove!`, 'loot');
          } else {
            addLog?.('You find old inscriptions on the walls — fragments of ancient Thassilonian text hint at deeper chambers beyond.', 'narration');
          }
        }

        const location = locations[Math.floor(Math.random() * locations.length)];
        if (location) {
          addLog?.(`You move deeper. Current area: ${location.name} — ${location.desc}`, 'narration');
        }

        // Update dungeon area items and context.
        // Bug #31: use the newly-picked sub-location's desc as the
        // narrative seed so the panel lists things the DM just mentioned
        // ("an iron-banded chest half-buried under rubble") rather than
        // re-rolling the generic dungeon pool.
        // Bug #49: thread world-tree node context so sub-locations
        // inside a dungeon (crypt room, cave chamber) get a more
        // specific category than the outer dungeon kind.
        const dungeonLoc = {
          ...(adventure.location || { terrain: 'dungeon' }),
          node: activeNode || null,
          kind: activeNode?.kind,
          ancestryNames: (breadcrumb || []).map(b => b?.name).filter(Boolean),
          ancestryKinds: (breadcrumb || []).map(b => b?.kind).filter(Boolean),
        };
        const dungeonItems = generateAreaItems(
          dungeonLoc,
          avgLevel,
          { narrative: location?.desc || '' }
        );
        setAreaItems(dungeonItems);
        const dungeonEvent = { type: 'explore', text: location?.desc || 'a dark chamber' };
        setContextActions(generateContextActions(dungeonEvent, adventure, party));
        setLastEvent(dungeonEvent);

        // ── Game Event Engine: dungeon exploration cascades ──
        const dungeonEffects = gameEvents.onDungeonExplore({
          worldState, party, room: adventure?.room || 0,
          dungeonLevel: Math.max(1, Math.floor(avgLevel)),
        });
        if (setWorldState && Object.keys(dungeonEffects.worldUpdates).length > 0) {
          setWorldState(prev => gameEvents.applyWorldUpdates(prev, dungeonEffects.worldUpdates));
        }
        gameEvents.eventsToLog(dungeonEffects.events).forEach(e => addLog?.(e.text, e.type));

        // Auto-trigger combat from trap or encounter
        if (dungeonEffects.encounter?.encountered && dungeonEffects.encounter.enemies?.length > 0) {
          addLog?.('Hostiles emerge from the shadows!', 'danger');
          const enemies = dungeonEffects.encounter.enemies.map((e, i) => ({
            id: `enemy_${Date.now()}_${i}`,
            name: e.name || `Monster ${i + 1}`,
            hp: e.hp || 15, currentHP: e.hp || 15,
            ac: e.ac || 14, cr: e.cr || 1,
            atk: e.atk || '', dmg: e.dmg || '',
            type: e.type || '', special: e.special || '',
            init: e.init || 0,
          }));
          const order = [
            ...party.map(p => ({ id: p.id, name: p.name, init: roll(20) + Math.floor(((p.abilities?.DEX || 10) - 10) / 2) })),
            ...enemies.map(e => ({ id: e.id, name: e.name, init: roll(20) + (e.init || 0) })),
          ].sort((a, b) => b.init - a.init);
          setCombat?.({ active: true, round: 1, order: order.map(({ id, name }) => ({ id, name })), currentTurn: 0, enemies });
          // Combat panel opens automatically via setCombat
        }
        if (dungeonEffects.trap?.triggered) {
          // Apply trap damage to a random party member
          const trapDmg = dungeonEffects.trap.damage || roll(6) + roll(6);
          const target = party[Math.floor(Math.random() * party.length)];
          if (target) {
            addLog?.(`The ${dungeonEffects.trap.name || 'trap'} strikes ${target.name} for ${trapDmg} damage!`, 'danger');
            if (setParty) {
              setParty(prev => prev.map(c => c.id !== target.id ? c : {
                ...c, currentHP: Math.max(-(c.abilities?.CON || 10), (c.currentHP || 0) - trapDmg)
              }));
            }
          }
        }
      }

      setAdventure(prev => prev ? { ...prev, room: (prev.room || 0) + 1 } : prev);
    } catch (err) {
      console.error('Explore error:', err);
      addLog?.('You press on through the unknown...', 'narration');
    } finally {
      setLoading(false);
    }
  };

  const [restType, setRestType] = useState(null); // null, 'short', 'full'

  const handleRest = (type = 'full') => {
    if (!party || party.length === 0) return;

    // Task #70d — rest ticks the clock through tickClock/advanceWorldTime
    // instead of gameEvents.onRest's legacy dmToolsService.advanceTime path.
    // The legacy path starts month=0/year=0 internally, drops currentMinute,
    // and skips the month/year cascade (e.g. rest on Rova 30 would roll to
    // Rova 31, which doesn't exist). We run the calendar tick ourselves for
    // the time write, then strip currentDay/currentHour/currentWeather from
    // onRest's worldUpdates + filter its 'time'/'weather' events so the
    // engine's broken writes never land. All other cascades (HP recovery,
    // spell slots, ability damage, sanity, affliction checks, night-watch
    // encounter) still come from onRest unchanged.
    const restHours = type === 'short' ? 1 : 8;
    const { patch: timePatch, events: clockEvents } = setWorldState
      ? tickClock(worldState, { hours: restHours, cause: type === 'short' ? 'rest-short' : 'rest-long' })
      : { patch: {}, events: [] };
    const stripTimeKeys = (updates) => {
      const out = { ...(updates || {}) };
      delete out.currentDay;
      delete out.currentHour;
      delete out.currentWeather;
      return out;
    };
    const isClockOwnedEvent = (ev) => ev && (ev.type === 'time' || ev.type === 'weather');

    if (type === 'short') {
      addLog?.('=== SHORT REST (1 hour) ===', 'header');
      addLog?.('The party takes a brief rest. You catch your breath, tend minor wounds, and review your surroundings. No natural healing occurs during a short rest, but you may use healing magic or potions.', 'narration');
      const shortResult = gameEvents.onRest({ worldState, party, restType: 'short', terrain: adventure?.location?.terrain || 'plains' });
      // Apply calendar-owned time patch first (year/month/day/hour/minute
      // cascade + optional weather regen on day-change) — then merge the
      // non-time bits of onRest's worldUpdates on top.
      if (setWorldState) {
        setWorldState(prev => gameEvents.applyWorldUpdates(
          { ...(prev || {}), ...timePatch },
          stripTimeKeys(shortResult.worldUpdates),
        ));
        clockEvents.forEach(e => addLog?.(e.text, e.type));
      }
      gameEvents.eventsToLog(shortResult.events.filter(e => !isClockOwnedEvent(e))).forEach(e => addLog?.(e.text, e.type));
      setContextActions(generateContextActions({ type: 'rest', text: 'The party finishes a short rest and prepares to continue.' }, adventure, party));
    } else {
      addLog?.('=== FULL REST (8 hours) ===', 'header');
      // Use game event engine for full rest cascades
      const restResult = gameEvents.onRest({ worldState, party, restType: 'long', terrain: adventure?.location?.terrain || (adventure?.type === 'dungeon' ? 'dungeon' : 'plains') });

      // Apply all partyUpdates from engine (HP, spells, ability damage, sanity)
      if (restResult.partyUpdates?.length > 0) {
        // HP changes via dedicated handler
        restResult.partyUpdates.forEach(upd => {
          const char = party.find(c => c.id === upd.id);
          if (char && upd.currentHP && upd.currentHP > char.currentHP) {
            updateCharHP?.(char.id, upd.currentHP - char.currentHP);
          }
        });
        // All other character state changes (spell slots, ability damage, sanity) via setParty
        setParty?.(prev => prev.map(c => {
          const upd = restResult.partyUpdates.filter(u => u.id === c.id);
          if (upd.length === 0) return c;
          let updated = { ...c };
          upd.forEach(u => {
            if (u.spellSlotsUsed !== undefined) updated.spellSlotsUsed = u.spellSlotsUsed;
            if (u.abilityDamage !== undefined) updated.abilityDamage = u.abilityDamage;
            if (u.sanity !== undefined) updated.sanity = u.sanity;
          });
          return updated;
        }));
      }

      // Apply calendar-owned time patch + non-time world updates from
      // onRest. Same split as the short-rest branch above.
      if (setWorldState) {
        setWorldState(prev => gameEvents.applyWorldUpdates(
          { ...(prev || {}), ...timePatch },
          stripTimeKeys(restResult.worldUpdates),
        ));
        clockEvents.forEach(e => addLog?.(e.text, e.type));
      }

      // Log all cascaded events (healing, conditions, encounters, crafting)
      // — time/weather filtered out because tickClock owns those now.
      gameEvents.eventsToLog(restResult.events.filter(e => !isClockOwnedEvent(e))).forEach(e => addLog?.(e.text, e.type));

      addLog?.('Spellcasters may prepare or recover their spells.', 'info');

      // Handle encounter during rest
      if (restResult.encounter) {
        addLog?.('Your rest is interrupted!', 'danger');
        // The encounter details are already logged by the engine
      }

      setContextActions(generateContextActions({ type: 'rest', text: 'The party wakes after a full night of rest, ready to continue their adventure.' }, adventure, party));
    }
    setRestType(null);
  };

  const handleForceEncounter = async () => {
    setLoading(true);
    try {
      const monsters = await db.monsters.toArray();
      if (monsters.length > 0) {
        const avgLevel = party.reduce((s, c) => s + (c.level || 1), 0) / party.length;
        const crRange = [Math.max(0.5, avgLevel - 1), avgLevel + 3];
        const eligible = monsters.filter(m => m.cr >= crRange[0] && m.cr <= crRange[1]);
        const boss = eligible.length > 0
          ? eligible[Math.floor(Math.random() * eligible.length)]
          : monsters[Math.floor(Math.random() * monsters.length)];
        const enemies = [
          {
            id: `boss_${Date.now()}`,
            name: boss.name,
            hp: boss.hp || 50,
            currentHP: boss.hp || 50,
            ac: boss.ac || 15,
            cr: boss.cr || 1,
            xp: boss.xp || Math.floor((boss.cr || 1) * 300),
            atk: boss.atk || '', dmg: boss.dmg || '',
            type: boss.type || '', special: boss.special || '',
            init: boss.init || 0,
          },
        ];

        addLog?.(`You encountered a formidable foe: ${boss.name} (CR ${boss.cr || '?'})!`, 'danger');

        const order = [
          ...party.map((p) => ({ id: p.id, name: p.name, init: roll(20) + Math.floor(((p.abilities?.DEX || 10) - 10) / 2) })),
          ...enemies.map((e) => ({ id: e.id, name: e.name, init: roll(20) + (e.init || 0) })),
        ].sort((a, b) => b.init - a.init);

        setCombat?.({
          active: true,
          round: 1,
          order: order.map(({ id, name }) => ({ id, name })),
          currentTurn: 0,
          enemies,
        });
        // Combat panel opens automatically via setCombat
      }
    } catch (err) {
      console.error('Force encounter error:', err);
    } finally {
      setLoading(false);
    }
  };

  const [narrating, setNarrating] = useState(false);

  // Bug #56 (2026-04-18) — NPC walk-away reaction. Track the most recent NPC
  // the party spoke with; when the next node change or non-talk action fires,
  // inject a one-sentence reaction beat (disposition-aware) so ignored NPCs
  // don't silently evaporate from the scene. v1 is fire-and-forget — no
  // persistent conversation state machine, no important-beat gating. Operator
  // can disable via Settings → "NPC Walk-Away Reactions" (dmPreferences flag).
  // See claude-notes #56-blocked for full scope discussion + parked
  // follow-ups (importance flag, delivery variants, disposition taxonomy).
  const lastConversationPartnerRef = useRef(null);
  const fireWalkAwayReaction = (excludeNpcId = null) => {
    const partner = lastConversationPartnerRef.current;
    if (!partner) return;
    // Same NPC still being interacted with — don't treat re-engagement as a
    // walk-away. The caller (handleTalkToNPC) passes the npc id so this
    // short-circuits cleanly without touching the stored partner record.
    if (excludeNpcId && partner.npcId === excludeNpcId) return;
    lastConversationPartnerRef.current = null;
    // Honor the global mute toggle. Default: reactions on. worldState is read
    // at call time (closure over the React render's value) — acceptable for a
    // best-effort narrative beat; operator flipping the toggle mid-turn will
    // take effect on the next conversation.
    const prefs = worldState?.dmPreferences || {};
    if (prefs.npcWalkAwayReactions === false) return;
    // Fire-and-forget narrate(). We don't want to block on this or swallow
    // the caller's own narration path; catch is silent because failure here
    // is a cosmetic loss, not a gameplay bug.
    const npcName = partner.npcName || 'the figure';
    const disposition = partner.disposition || 'indifferent';
    const prompt = `The party turned away from ${npcName} mid-conversation and ${partner.via === 'node' ? 'left the area' : 'turned their attention elsewhere'}. Write a one-sentence reaction beat consistent with their disposition (${disposition}). Keep it terse — a look, a muttered word, a gesture. No dialogue attribution or full quotations unless it fits in under twenty words.`;
    try {
      dmEngine.narrate('custom', {
        party,
        encounter: {
          name: npcName,
          description: `Walk-away reaction beat for ${npcName} (disposition: ${disposition}).`,
          type: 'roleplay',
        },
        recentLog: (gameLog || []).slice(-8),
      }, prompt).then(result => {
        if (result?.text) addLog?.(result.text, 'narration');
      }).catch(() => { /* silent — see comment above */ });
    } catch { /* silent — see comment above */ }
  };

  const handleCustomAction = async () => {
    if (!customAction.trim() || narrating) return;
    const action = customAction.trim();
    setCustomAction('');
    // Bug #56 — a custom action means the party is doing something other
    // than continuing the prior NPC conversation. Fire a walk-away reaction
    // before the new narrate() call so it lands as a preamble to the action.
    fireWalkAwayReaction(null);
    traceEngine('handleCustomAction', {
      action,
      location: adventure?.location?.name || null,
      partyLen: party?.length || 0,
    });

    // Bug #35 — snapshot BEFORE the action fires so "Undo" restores to
    // the pre-action world. Capture is cheap (structuredClone) and the
    // buffer self-caps at 5 entries.
    captureUndoSnapshot?.(`action: ${action.slice(0, 60)}`);

    // Detect if this is a question/inquiry vs a character action
    const isQuestion = /^(what|where|who|why|how|is |are |do |does |can |could |would |should |did |was |were |has |have |tell me|describe|explain|look at|examine|inspect|check|study|read|identify|recall|remember|know)\b/i.test(action) || action.endsWith('?');
    addLog?.(`> ${action}`, isQuestion ? 'info' : 'action');
    setNarrating(true);

    try {
      const narratePromise = dmEngine.narrate('custom', {
        party,
        encounter: adventure?.location ? { name: adventure.location.name, description: adventure.location.desc, type: adventure.type === 'town' ? 'roleplay' : 'exploration' } : null,
        recentLog: (gameLog || []).slice(-15),
      }, action);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out.')), 35000)
      );

      const result = await Promise.race([narratePromise, timeoutPromise]);
      addLog?.(result.text, 'narration');
      if (result.aiError) {
        addLog?.(`[DM Engine: ${result.aiError}]`, 'danger');
      }
      // Task #70b → #79 (2026-04-19): each operator input = 1 PF1e round
      // (6 seconds). Questions and actions are both single narrate beats
      // and cost a round; the ×10-to-×50 inflation we used to apply here
      // (1m / 5m) came from the ceil-to-minute bug in advanceWorldTime,
      // which is fixed now. For greater beats (rest, take-20, travel) the
      // operator uses the CalendarPanel GM Quick Advance or the rest
      // handler — those explicitly tick minutes or hours.
      if (setWorldState) {
        const { patch, events } = tickClock(worldState, {
          rounds: 1,
          cause: isQuestion ? 'narrate-question' : 'narrate-action',
        });
        if (Object.keys(patch).length > 0) {
          setWorldState(prev => ({ ...(prev || {}), ...patch }));
          events.forEach(e => addLog?.(e.text, e.type));
        }
      }
      // Process any new NPCs or items mentioned in the narration. Pass
      // narrative text so the heuristic extractor can catch named NPCs
      // when the AI omits the ENTITIES metadata (#30).
      processNewEntities(result.newEntities, null, result.text || '');
      // Update context actions from AI suggestions if available
      if (result.suggestedActions && result.suggestedActions.length > 0) {
        setContextActions(result.suggestedActions);
      } else {
        const evt = { type: 'custom', text: result.text };
        setContextActions(generateContextActions(evt, adventure, party));
      }
    } catch (err) {
      // Fallback: generate a simple procedural response
      const responses = adventure?.type === 'town' ? [
        `You ${action.toLowerCase()}. The townsfolk regard you curiously.`,
        `Your action draws a few glances from passersby, but nothing unusual happens.`,
        `You attempt to ${action.toLowerCase()}. The town continues its daily rhythm around you.`,
      ] : [
        `You ${action.toLowerCase()}. The dungeon echoes with an unsettling silence.`,
        `You attempt to ${action.toLowerCase()}. The shadows seem to shift in response.`,
        `Your action disturbs the dust of ages. Something stirs in the darkness ahead.`,
      ];
      addLog?.(responses[Math.floor(Math.random() * responses.length)], 'narration');
      if (err.message !== 'Request timed out.') {
        console.warn('[Adventure] Custom action error:', err.message);
      }
    }
    setNarrating(false);
  };

  /**
   * Submit a compound "party actions" string — one line per character who
   * filled an input in the PartyActionBar. Dispatches a single narrate()
   * call so the DM can resolve all actions together. (#10)
   */
  const handlePartyCompoundAction = async (combinedAction) => {
    if (!combinedAction || narrating) return;
    // Bug #56 — party-wide compound actions are non-talk actions for any
    // ongoing conversation; fire the walk-away reaction before the new beat.
    fireWalkAwayReaction(null);

    // 2026-04-20 — split-party context preservation. PartyActionBar joins
    // per-character inputs as "Name1: action1 | Name2: action2 | ...". When
    // 2+ characters submit at once we're in a split-party round, and the
    // raw narrate prompt has historically caused the AI to collapse the
    // four current sub-scenes (e.g. Ironforge at Chask's stall, Shadowblade
    // at the cathedral wall, Archmage at the appraise table, Healer with
    // Father Zantus) back to a single shared "festival square" scene —
    // dropping NPCs, in-flight checks, and continuity. The recent log
    // contains the per-character locations but the AI was defaulting to
    // the canonical adventure.location field.
    //
    // Fix: prepend a system-style reminder to the action string when split
    // is detected. The AI gets explicit instruction to honor the per-
    // character locations established in the prior narration. Single-
    // character submits skip the reminder so we don't waste tokens or
    // confuse non-split scenes.
    const splitSegments = combinedAction.split(' | ').filter(Boolean);
    const isSplitParty = splitSegments.length >= 2;
    const promptForAI = isSplitParty
      ? `[SPLIT PARTY — The party is currently distributed across multiple sub-locations established in the recent narration. Read the recent log CAREFULLY before responding. Each named character below may be at a DIFFERENT location, talking to a DIFFERENT NPC, or in the middle of a DIFFERENT in-flight check (Sense Motive, Appraise, Perception, Diplomacy, etc.). Resolve EACH character's action AT THEIR CURRENT SUB-LOCATION as established in the prior scene. Continue any check that was already requested for that specific character — do not substitute a different check or skill. Do NOT regroup the party at a single shared scene unless their actions explicitly state they are walking back to each other. Maintain the NPCs, atmosphere, and continuity already established for each sub-scene.]\n\n${combinedAction}`
      : combinedAction;

    traceEngine('handlePartyCompoundAction', {
      preview: combinedAction.length > 140
        ? combinedAction.slice(0, 140) + '…' : combinedAction,
      location: adventure?.location?.name || null,
      partyLen: party?.length || 0,
      isSplitParty,
      splitCount: splitSegments.length,
    });
    // Bug #35 — snapshot before the compound submit so Undo rolls back
    // the whole party-turn (multiple HP/log/NPC updates as one unit).
    captureUndoSnapshot?.(`party-action: ${combinedAction.slice(0, 60)}`);
    addLog?.(`> ${combinedAction}`, 'action');
    setNarrating(true);
    try {
      const narratePromise = dmEngine.narrate('custom', {
        party,
        encounter: adventure?.location ? {
          name: adventure.location.name,
          description: adventure.location.desc,
          type: adventure.type === 'town' ? 'roleplay' : 'exploration',
        } : null,
        recentLog: (gameLog || []).slice(-15),
      }, promptForAI);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out.')), 35000)
      );
      const result = await Promise.race([narratePromise, timeoutPromise]);
      addLog?.(result.text, 'narration');
      if (result.aiError) addLog?.(`[DM Engine: ${result.aiError}]`, 'danger');
      // Task #70b → #79 — compound party actions all resolve in a single
      // PF1e round. The party members act in initiative order within the
      // same 6-second window, not serially across 10 minutes. Previous
      // 10-minute tick was anchored on the ceil-to-minute inflation bug.
      if (setWorldState) {
        const { patch, events } = tickClock(worldState, {
          rounds: 1,
          cause: 'party-compound-action',
        });
        if (Object.keys(patch).length > 0) {
          setWorldState(prev => ({ ...(prev || {}), ...patch }));
          events.forEach(e => addLog?.(e.text, e.type));
        }
      }
      // #30 — pass narrative text for heuristic NPC fallback extraction.
      processNewEntities(result.newEntities, null, result.text || '');
      if (result.suggestedActions && result.suggestedActions.length > 0) {
        setContextActions(result.suggestedActions);
      } else {
        const evt = { type: 'custom', text: result.text };
        setContextActions(generateContextActions(evt, adventure, party));
      }
    } catch (err) {
      addLog?.(`Each character's action is noted, but the DM couldn't respond: ${err.message || 'unknown error'}`, 'danger');
      if (err.message !== 'Request timed out.') {
        console.warn('[Adventure] Party compound action error:', err.message);
      }
    }
    setNarrating(false);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#1a1a2e',
      borderRadius: '8px',
      overflow: 'hidden',
    },
    logContainer: {
      flex: '1 1 0',
      minHeight: 0,
      overflow: 'auto',
    },
    actionBar: {
      flexShrink: 0,
      backgroundColor: '#2a2a4e',
      border: '2px solid #ffd700',
      borderRadius: '8px',
      padding: isMobile ? '10px' : '12px',
      margin: isMobile ? '6px' : '8px',
      display: 'flex',
      gap: isMobile ? '6px' : '8px',
      flexWrap: 'wrap',
      flexDirection: isMobile ? 'column' : 'row',
    },
    button: {
      padding: isMobile ? '12px 14px' : '10px 12px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: isMobile ? '13px' : '12px',
      fontWeight: 'bold',
      minHeight: isMobile ? '40px' : 'auto',
      minWidth: isMobile ? '100%' : 'auto',
    },
    input: {
      flex: isMobile ? '1 1 100%' : 1,
      minWidth: isMobile ? '100%' : '200px',
      padding: isMobile ? '12px 14px' : '10px',
      backgroundColor: '#1a1a2e',
      border: '1px solid #ffd700',
      borderRadius: '4px',
      color: '#d4c5a9',
      fontSize: isMobile ? '14px' : 'inherit',
      minHeight: isMobile ? '40px' : 'auto',
    },
    mobileBtn: {
      padding: '12px 10px',
      backgroundColor: '#3a3a6e',
      border: '1px solid #ffd700',
      color: '#ffd700',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 'bold',
      touchAction: 'manipulation',
    },
    empty: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: '#666',
      padding: isMobile ? '16px' : '0',
    },
  };

  // Town selection submenu
  const [showTownPicker, setShowTownPicker] = useState(false);

  // #38 — "Leave Town" travel picker. Previously the Leave Town button called
  // startAdventure('dungeon') which picks a RANDOM dungeon every click, so the
  // party ended up in some random place the operator didn't choose. The new
  // UX opens a destination picker: other towns, known wilderness/dungeon
  // locations, or an opt-in random roll. Nothing moves until the operator
  // picks.
  const [showTravelPicker, setShowTravelPicker] = useState(false);
  const [travelDestinations, setTravelDestinations] = useState([]);
  const openTravelPicker = async () => {
    try {
      const locs = await db.locations.toArray();
      setTravelDestinations(Array.isArray(locs) ? locs : []);
    } catch (err) {
      console.warn('[AdventureTab] could not load travel destinations:', err);
      setTravelDestinations([]);
    }
    setShowTravelPicker(true);
  };

  // ─────────────────────────── #39 WORLD-TREE (nested locations, maps per node,
  //                                     visit history, L3 living-world ticks).
  //
  // Replaces the flat `adventure.subLocations` model from #37. Every location
  // is a node in a tree — world → country → region → town → building → floor
  // → room, unlimited depth. The active party's `currentPath` is an array of
  // node ids from root to leaf; the leaf is "where you are."
  //
  // See src/services/worldTree.js for the schema and helpers, and
  // project_world_tree memory for design rationale (maps auto+override,
  // tree-native travel, per-campaign root, parties stub for party-split).

  // Run migration from #37 flat subLocations → world tree on load. Idempotent.
  //
  // Bug #39 (2026-04-17): pass the active campaign's canonical startPath into
  // migration so a fresh campaign lands the party at the scripted opener
  // (RotR → Market Square for the Swallowtail Festival) instead of whatever
  // the town's generic defaultEntry cascade produces (Main Road hub). The
  // option is a no-op when startPath is absent or doesn't resolve in the tree.
  useEffect(() => {
    if (!adventure) return;
    if (!needsWorldTreeMigration(adventure)) return;
    const patch = migrateAdventureToWorldTree(adventure, {
      worldState,
      memberIds: (party || []).map(p => p?.id).filter(Boolean),
      rootSeed: { name: 'Golarion', kind: NODE_KINDS.WORLD, desc: 'The world of Pathfinder.' },
      startPath: Array.isArray(campaign?.data?.startPath) ? campaign.data.startPath : null,
    });
    if (!patch) return;
    setAdventure(prev => prev ? { ...prev, ...patch } : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adventure?.location?.name]);

  // Top-up pass (2026-04-17 — Tom: "stuck in Market Square, can't travel to
  // other Sandpoint locations"). The world-tree seed (data/worldTreeSeeds.js)
  // has grown over time — new canonical sub-locations get added (Rusty
  // Dragon, Cathedral, Garrison, etc. under Sandpoint). migrateAdventureToWorldTree
  // only runs when `needsWorldTreeMigration` is true (i.e. no tree at all),
  // so existing campaigns miss every subsequent seed addition — the tree is
  // frozen at whatever the seed looked like on that campaign's first load.
  //
  // Symptom: the travel picker's "↔ Nearby" (siblings) section was empty
  // when the party was inside Market Square, because Sandpoint's only child
  // in Tom's tree was Market Square itself. Fix: run ensureSeedInTree on
  // every mount so new canonical nodes are idempotently backfilled under
  // their canonical parents without touching operator-created nodes.
  //
  // Idempotent by name (case-insensitive). Only patches missing nodes; desc
  // top-ups only fill empty descs. Safe to run on every mount.
  useEffect(() => {
    if (!adventure || !adventure.worldTree) return;
    const { added } = ensureSeedInTree(adventure.worldTree, 'pf1e');
    if (added && added.length > 0) {
      // ensureSeedInTree mutates the tree in place; the trigger for a re-
      // render is to bump the parent object reference. Clone at the tree
      // level so the worldTree identity changes and downstream consumers
      // (activeNode, childrenHere, renderTravelPicker) re-run.
      setAdventure(prev => prev ? {
        ...prev,
        worldTree: {
          rootId: prev.worldTree.rootId,
          nodes: { ...prev.worldTree.nodes },
        },
      } : prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adventure?.worldTree?.rootId]);

  // Bug #49 — one-time sidecar auto-descend for pre-#49 saves. If the active
  // path terminates at a town-like node that has a canonical defaultEntry
  // (e.g. Sandpoint → Market Square for RotRL), extend the path to the
  // default entry sub-location so the party stands at a specific place,
  // not at the town as a whole. Only fires when the extension actually
  // changes the path, so no render-loop risk — once the path is deeper
  // than the town, resolveLandingPath is a no-op.
  //
  // Bug #39 follow-up (2026-04-20): honor campaign.data.startPath ahead of
  // the resolveLandingPath cascade. Two operator-reported cases this covers:
  //   (a) pre-#39 saves: migration ran before startPath support existed, so
  //       the party is parked at the town node with no sub-location. Curr-
  //       path is a strict PREFIX of the resolved startPath — extend to
  //       match. (e.g. [...,Sandpoint] → [...,Sandpoint,Cathedral Square].)
  //   (b) saves where the previous sidecar already routed to the wrong
  //       sub-location via resolveLandingPath's primary-entrance fallback
  //       (Turandarok Bridge for Sandpoint). curPath terminates at a SIBLING
  //       of the startPath's tail under the same parent — override to the
  //       campaign's canonical opener. (RotRL must open at Cathedral Square
  //       for the Swallowtail Festival, not an arbitrary town entrance.)
  // Diverged paths (party has meaningfully traveled elsewhere) are left
  // alone — we never revert player movement.
  useEffect(() => {
    // Bug #39 follow-up-2 (2026-04-20): VERBOSE telemetry on every branch
    // so a live repro pins exactly which exit path was taken.
    console.log('[sidecar-startPath] effect fired', {
      hasAdventure: !!adventure,
      hasTree: !!adventure?.worldTree,
      hasParties: !!adventure?.parties,
      startPathHonored: adventure?.startPathHonored,
      campaignStartPath: campaign?.data?.startPath,
    });
    if (!adventure) { console.log('[sidecar-startPath] exit: no adventure'); return; }
    const tree = adventure.worldTree;
    const activeId = adventure.activeParty || DEFAULT_PARTY_ID;
    const party0 = adventure.parties?.[activeId];
    const curPath = Array.isArray(party0?.currentPath) ? party0.currentPath : null;
    if (!tree || !curPath || curPath.length === 0) {
      console.log('[sidecar-startPath] exit: no tree/curPath', {
        hasTree: !!tree, curPath,
      });
      return;
    }

    // startPath arm is ONE-SHOT via `adventure.startPathHonored`. Without
    // this flag, once the operator navigates away from the campaign opener,
    // the sidecar would fire on the `parties` change and revert them. With
    // it, the arm runs on fresh loads (flag undefined) and stops the moment
    // a decision has been made (either "we rerouted you to startPath" or
    // "you're already diverged, leave alone" — both set the flag).
    if (!adventure.startPathHonored) {
      const startNames = Array.isArray(campaign?.data?.startPath) ? campaign.data.startPath : null;
      console.log('[sidecar-startPath] startNames', startNames);
      if (startNames && startNames.length > 0) {
        const resolvedStartPath = resolveNamedPath(tree, startNames);
        console.log('[sidecar-startPath] resolvedStartPath', resolvedStartPath);
        if (!resolvedStartPath || resolvedStartPath.length === 0) {
          console.log('[sidecar-startPath] startPath did NOT resolve in tree — marking honored to stop re-evaluating');
          setAdventure(prev => prev ? { ...prev, startPathHonored: true } : prev);
          return;
        }
        console.log('[sidecar-startPath] comparing', { curPath, resolvedStartPath });
        // Already there.
        if (samePath(resolvedStartPath, curPath)) {
          console.log('[sidecar-startPath] already at startPath, marking honored');
          setAdventure(prev => prev ? { ...prev, startPathHonored: true } : prev);
          return;
        }
        // Case (a): curPath is a strict prefix of resolvedStartPath
        // (pre-#39 saves parked at [...,Sandpoint] get extended).
        const isPrefix = curPath.length < resolvedStartPath.length
          && curPath.every((id, i) => id === resolvedStartPath[i]);
        // Case (b): startPath's parent-of-tail appears in curPath —
        // the party landed somewhere ELSE inside the same settlement
        // (Turandarok Bridge / Main Road / anywhere under Sandpoint)
        // instead of the canonical opener (Cathedral Square). Override.
        const startParentId = resolvedStartPath.length >= 2
          ? resolvedStartPath[resolvedStartPath.length - 2]
          : null;
        const startTailId = resolvedStartPath[resolvedStartPath.length - 1];
        const parentInCurPath = startParentId
          && curPath.includes(startParentId)
          && curPath[curPath.length - 1] !== startTailId;

        console.log('[sidecar-startPath] decision', {
          isPrefix,
          parentInCurPath,
          startParentId,
          startTailId,
          curTailId: curPath[curPath.length - 1],
          curPathIncludesStartParent: startParentId ? curPath.includes(startParentId) : null,
        });

        if (isPrefix || parentInCurPath) {
          console.log('[sidecar-startPath] REROUTING to startPath', resolvedStartPath);
          const nextParties = setActivePath(adventure, resolvedStartPath);
          setAdventure(prev => prev ? {
            ...prev,
            parties: nextParties,
            startPathHonored: true,
          } : prev);
          return;
        }
        // Genuinely diverged — honor flag so we don't keep evaluating.
        console.log('[sidecar-startPath] diverged, marking honored');
        setAdventure(prev => prev ? { ...prev, startPathHonored: true } : prev);
      } else {
        console.log('[sidecar-startPath] no startNames, skipping to landing-resolve');
      }
    } else {
      console.log('[sidecar-startPath] already honored, skipping to landing-resolve');
    }

    const resolved = resolveLandingPath(tree, curPath);
    if (resolved === curPath || samePath(resolved, curPath)) return;
    console.log('[sidecar-startPath] landing-resolve rerouting', { from: curPath, to: resolved });
    const nextParties = setActivePath(adventure, resolved);
    setAdventure(prev => prev ? { ...prev, parties: nextParties } : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adventure?.worldTree, adventure?.parties, campaign?.data?.startPath]);

  const worldTree = adventure?.worldTree || null;
  const activeParty = adventure ? getActiveParty(adventure) : null;
  const activePath = activeParty?.currentPath || [];
  const activeNode = worldTree ? getNodeByPath(worldTree, activePath) : null;
  const breadcrumb = worldTree ? getBreadcrumb(worldTree, activePath) : [];
  const childrenHere = worldTree && activeNode ? getChildren(worldTree, activeNode.id) : [];

  // Bug #58 (2026-04-18): drain the stashed chapter_intro narrate result and
  // run processNewEntities against it so the opening paragraph's NPCs / clues
  // / rumors / locations / lore hit the journal + Nearby NPCs at scene start
  // instead of waiting for the operator's first in-game action. Gated on
  // `adventure.active` + worldTree.rootId + activeNode — processNewEntities'
  // location-routing, faction-matching, and world-tree child-insert all need
  // the scene context to be stable, otherwise `locations.accessible` can't
  // find an activeNode to attach under and the routing falls on the floor.
  // consumePendingChapterIntroResult is one-shot: first successful drain
  // clears the ref, so subsequent re-renders (or re-mounts after tab-switch)
  // are no-ops. Runs fire-and-forget — await inside a useEffect would need a
  // wrapper, and extraction failures are already handled per-domain inside
  // processNewEntities with try/catch on each row.
  useEffect(() => {
    // Diagnostic: fires every time deps change so we can see whether the
    // effect is being entered at all during #59 live verification. The
    // counter bump should make this fire a second time after the narrate
    // await resolves and the ref has been populated.
    try {
      traceEngine('chapterIntro:drain-attempt', {
        active: !!adventure?.active,
        hasTree: !!worldTree,
        hasNode: !!activeNode,
        seq: chapterIntroResultSeq,
      });
    } catch (_) { /* trace best-effort */ }
    if (!adventure?.active || !worldTree || !activeNode) return;
    if (typeof consumePendingChapterIntroResult !== 'function') return;
    const result = consumePendingChapterIntroResult();
    try {
      // Include a verbatim preview of the first 200 chars so trace dumps
      // captured via BugReportButton carry enough of the LLM response to
      // diagnose "intro NPC extraction still skipping" (#29, 3rd report).
      // If the preview shows named NPCs but storage counts are 0, the
      // regression is on the extractor/storage side. If the preview is
      // empty / terse / missing names, the LLM prompt or model fallback
      // is the culprit.
      traceEngine('chapterIntro:drain-read', {
        gotResult: !!result,
        hasText: !!(result && result.text),
        textLen: (result && result.text && result.text.length) || 0,
        source: (result && result.source) || null,
        npcCount: (result && result.newEntities && result.newEntities.npcs && result.newEntities.npcs.length) || 0,
        hasEntitiesTail: !!(result && result.newEntities && Array.isArray(result.newEntities.npcs)),
        textPreview: (result && result.text && result.text.slice(0, 200)) || '',
      });
    } catch (_) { /* trace best-effort */ }
    if (!result || (!result.newEntities && !result.text)) return;
    try {
      traceEngine('chapterIntro:extract', {
        loc: adventure?.location?.name,
        textLen: (result.text || '').length,
        entityNpcCount: (result.newEntities?.npcs || []).length,
      });
      // Fire-and-forget — processNewEntities awaits an LLM extractor call
      // (1-2s). Wrap in an IIFE so we can emit a post-extract trace with
      // storage counts once the pipeline settles, which closes the
      // "did we actually land NPCs under this scope?" loop on #29.
      (async () => {
        try {
          await processNewEntities?.(
            result.newEntities,
            adventure?.location?.name || activeNode?.name || null,
            result.text || '',
          );
          try {
            const scoped = await getEncounteredNPCs().catch(() => []);
            traceEngine('chapterIntro:post-extract', {
              loc: adventure?.location?.name,
              scopedNpcCount: Array.isArray(scoped) ? scoped.length : 0,
            });
          } catch (_) { /* trace best-effort */ }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[AdventureTab] chapter_intro extraction failed:', err);
          try {
            traceEngine('chapterIntro:extract-error', {
              message: err?.message || String(err),
            });
          } catch (_) { /* trace best-effort */ }
        }
      })();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[AdventureTab] chapter_intro extraction failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adventure?.active, worldTree?.rootId, activeNode?.id, chapterIntroResultSeq]);

  // L3 arrival summary: events produced by tickArrivalCascade on the last
  // switch. Cleared when the operator dismisses the "Since you were last
  // here" callout.
  const [arrivalSummary, setArrivalSummary] = useState(null);

  // Hex-map anchor sync.
  //
  // MapTab's overland map is chosen via `mapRegistry.getOverlandMap(
  // worldState.partyPosition.locationId)`. That field was orphaned by the
  // #40 world-tree refactor — initialised to the hardcoded 'sandpoint'
  // default and never written anywhere, so the hex map always showed
  // Sandpoint Hinterlands regardless of where the party actually was.
  //
  // Fix (2026-04-18): re-derive the anchor from the current world-tree
  // path on every activePath change. Walk UP from the leaf to the nearest
  // TOWN / CITY / VILLAGE / DUNGEON ancestor (including self) and
  // normalize its name into the id `getOverlandMap` expects. Doing the
  // walk-up (rather than using the raw leaf) means moving inside a town
  // — into a building, floor, or room — does NOT flip the hex map; the
  // anchor is still the enclosing town. Entering a different town or a
  // dungeon flips it. Wilderness / region / higher tiers without a
  // town/dungeon on the path leave the id unchanged so the hex map
  // doesn't spuriously reset mid-travel.
  //
  // Runs in a useEffect rather than inline in switchToNodePath so the
  // same sync also covers save-load / rehydrate paths — legacy saves
  // carrying the stale 'sandpoint' default will self-heal on first
  // render after load. Short-circuits when the anchor already matches.
  useEffect(() => {
    if (!worldTree || !activePath || activePath.length === 0) return;
    if (typeof setWorldState !== 'function') return;
    const HEX_ANCHOR_KINDS = new Set([
      NODE_KINDS.TOWN, NODE_KINDS.CITY, NODE_KINDS.VILLAGE, NODE_KINDS.DUNGEON,
    ]);
    const crumbs = getBreadcrumb(worldTree, activePath);
    let anchor = null;
    for (let i = crumbs.length - 1; i >= 0; i--) {
      if (HEX_ANCHOR_KINDS.has(crumbs[i]?.kind)) { anchor = crumbs[i]; break; }
    }
    if (!anchor) return;
    const normalized = String(anchor.name || '')
      .toLowerCase()
      .trim()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!normalized) return;
    setWorldState(prev => {
      const prevPos = (prev && prev.partyPosition) || {};
      if (prevPos.locationId === normalized) return prev;
      return {
        ...(prev || {}),
        partyPosition: { ...prevPos, locationId: normalized },
      };
    });
    // activePath.join forces a proper re-run when path identity changes
    // without depending on a referentially-unstable array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTree, activePath.join('>')]);

  // Commit current nearby NPCs/area items into the active node. Used when
  // leaving — the node's frozen entity state will be reloaded on return.
  //
  // S1 (2026-04-20): read via refs, not closure. Previous code closed over
  // `nearbyNPCs`/`areaItems` from the render-time scope, which could be
  // stale when async scene-extraction updates landed after the render that
  // defined this function but before the user clicked a sibling node. The
  // stale commit then froze an empty/outdated roster onto the departing
  // node, so returning found nothing to thaw. Refs always point at the
  // latest live state.
  const commitActiveNodeLive = (tree) => {
    if (!tree || !activeNode) return;
    const latestNpcs = nearbyNPCsRef.current;
    const latestItems = areaItemsRef.current;
    commitLiveStateIntoNode(tree, activeNode.id, {
      npcs: Array.isArray(latestNpcs) ? latestNpcs : [],
      items: Array.isArray(latestItems) ? latestItems : [],
      combat: combat || null,
    });
    try {
      traceEngine('commitActiveNodeLive', {
        nodeId: activeNode.id,
        nodeName: activeNode.name,
        npcCount: Array.isArray(latestNpcs) ? latestNpcs.length : 0,
        npcNames: Array.isArray(latestNpcs)
          ? latestNpcs.map(n => n?.name || n?.shortDesc || '(?)').slice(0, 8)
          : [],
      });
    } catch (_) { /* trace best-effort */ }
    recordDeparture(tree, activeNode.id, worldState);
  };

  // Perform the node switch: commit live state → compute arrival cascade
  // (L3 ticks) → hydrate the destination's live state → update party path.
  // `target` is either a node id (sibling/ancestor/descendant by id) or a
  // fully-formed path array.
  const switchToNodePath = (targetPath, { logLabel, skipOverland = false, suppressNarrate = false, skipEntranceCascade = false } = {}) => {
    if (!adventure || !worldTree) return;
    let path = Array.isArray(targetPath) ? targetPath : null;
    if (!path || path.length === 0 || samePath(path, activePath)) return;
    // Snapshot the pre-switch node so the arrival narrate (below) can frame
    // the transition in terms of where the party is LEAVING. Has to happen
    // before we commit the new path so activePath closure still points old.
    const priorNode = (() => {
      try { return getNodeByPath(worldTree, activePath); } catch { return null; }
    })();
    // Bug #56 — a node change is the canonical "walk away" trigger. Fire the
    // reaction before we commit the switch so the beat lands in-scene before
    // the travel log line. Early-returns above (invalid path, same path) are
    // not walk-aways and deliberately skip this.
    if (lastConversationPartnerRef.current) {
      const partner = lastConversationPartnerRef.current;
      lastConversationPartnerRef.current = { ...partner, via: 'node' };
      fireWalkAwayReaction(null);
    }

    // Bug #49 — if the target terminates at a TOWN/CITY/VILLAGE node with
    // entrance-tagged children, auto-descend to the entrance that matches
    // the party's approach direction (Turandarok Bridge from the north,
    // Lost Coast Road from the south, Docks from the sea). Primary
    // entrance is the fallback. Otherwise cascades through defaultEntry
    // → first non-container child per #37 rules. The operator's intent:
    // the party always stands at a specific place inside a town, never
    // at the town-as-a-whole. The town node remains navigable via the
    // breadcrumb + picker; this just means it isn't a valid leaf resting
    // place. resolveLandingPath is a no-op when the tail isn't a
    // container/settlement with routable children, so non-town travel is
    // unaffected. Bug #49 revision: approach direction is sourced from
    // the party's overland hex (`worldState.partyHex`), NOT tree-ancestry
    // — the tree doesn't store geography, so "last node visited" is not
    // a valid proxy for "which direction are we arriving from". See
    // feedback_approach_direction_from_hex.md. When partyHex is null
    // (fresh campaign / narrative jump), the cascade falls through to
    // primary-tagged entrance (scripted) or random entrance (open-world).
    // 2026-04-20 — `skipEntranceCascade` is set when the operator clicked
    // the breadcrumb to ascend (via jumpToBreadcrumb). Going UP shouldn't
    // re-extend down through resolveLandingPath, because there's no
    // approach direction to resolve from (the party already IS in the
    // town, hex delta is zero). Without this guard, clicking the
    // "Sandpoint" breadcrumb from Cathedral Square triggers the entrance
    // cascade, which falls through to primary-or-random and dumps the
    // party at Turandarok Bridge — the operator-reported "I clicked
    // Sandpoint and got teleported to the bridge" trap.
    let resolved = path;
    if (!skipEntranceCascade) {
      const fromHex = parsePartyHexToAxial(worldState?.partyHex);
      resolved = resolveLandingPath(worldTree, path, fromHex ? { fromHex } : {});
    }
    if (resolved !== path) {
      path = resolved;
      if (samePath(path, activePath)) return;
    }

    // Task #63 — narrative destruction gate. A path that traverses (or
    // lands at) a destroyed/sealed node is refused. We scan the entire
    // resolved path because passing THROUGH a destroyed building to
    // reach a room inside it doesn't make narrative sense — if the
    // building burned, its rooms are unreachable too (and the cascade
    // in setNodeStatus will have marked them destroyed anyway). Sealed
    // is treated the same way for travel purposes; the GM/narrative
    // must clear the seal first.
    {
      const blocker = findTravelBlocker(worldTree, path);
      if (blocker) {
        const status = getNodeStatus(blocker);
        const verb = status === NODE_STATUS.DESTROYED ? 'destroyed' : 'sealed';
        try {
          addLog?.(`Cannot travel — ${blocker.name} is ${verb}.`, 'warning');
        } catch (_) { /* logging best-effort */ }
        try {
          traceEngine('travel:blockedByStatus', {
            blockerId: blocker.id, blockerName: blocker.name, status,
          });
        } catch (_) { /* trace best-effort */ }
        return;
      }
    }

    // Work on a deep-enough clone of the tree so the subsequent setAdventure
    // doesn't mutate stale React state.
    const nextTree = {
      rootId: worldTree.rootId,
      nodes: { ...worldTree.nodes },
    };
    for (const id of Object.keys(nextTree.nodes)) {
      nextTree.nodes[id] = { ...nextTree.nodes[id] };
    }

    commitActiveNodeLive(nextTree);

    // Bug #42 (2026-04-17) — PF1e overland travel slice. Calculate a travel
    // plan between the current position and the target, advance worldState by
    // the computed hours, and roll per-segment random-encounter checks. We
    // skip this when:
    //   (a) setWorldState is missing (caller didn't wire it — dev harness)
    //   (b) the caller passed skipOverland (e.g. creating a new sub-node,
    //       descending into a building — those are local-scale transitions)
    //   (c) the path stays within the same building/floor — totalHours will
    //       naturally be 0 per estimateSegmentMiles heuristics
    // See src/services/overlandTravel.js for CRB citations + scope boundaries.
    let travelPlan = null;
    let travelEncounters = [];
    if (!skipOverland && typeof setWorldState === 'function') {
      try {
        travelPlan = calculateTravelPlan({
          tree: nextTree,
          fromPath: activePath,
          toPath: path,
          party: Array.isArray(activeParty) ? activeParty : party,
        });
        if (travelPlan.totalHours > 0) {
          travelEncounters = rollEncountersForPlan(travelPlan, {
            seed: Math.floor(Math.random() * 0xFFFFFFFF),
          });
          // Advance the in-world clock. This will cascade day/month/year
          // via calendar.advanceWorldTime. Round to whole minutes.
          const addMinutes = Math.round(travelPlan.totalHours * 60);
          setWorldState(prev => ({
            ...(prev || {}),
            ...advanceWorldTime(prev, addMinutes),
          }));
        } else if (Array.isArray(travelPlan.passThroughIds) && travelPlan.passThroughIds.length > 1) {
          // Task #70e → #79 (2026-04-19) — LCA-keyed intra-location floor.
          // `estimateSegmentMiles` returns 0 for nodes inside a settlement
          // or building (no hex coords, kind-based heuristic zeroes
          // intra-structure), so these hops need an explicit floor to
          // keep NPC day/night availability + shop hours + festival-window
          // checks honest.
          //
          // PF1e canonically splits tactical time (rounds, 6 sec) from
          // strategic time (minutes+). The LCA node's kind tells us
          // which scale applies:
          //   - LCA = room:        0 (sub-tactical — nothing to tick)
          //   - LCA = floor:       1 round/hop  (6 sec — bar ↔ kitchen)
          //   - LCA = building:    2 rounds/hop (12 sec — up a staircase)
          //   - LCA = village/
          //     hamlet/thorp/area: 3 min/hop
          //   - LCA = town:        5 min/hop   (prior #70e default)
          //   - LCA = city:       10 min/hop
          //   - LCA = metropolis: 20 min/hop   (Magnimar, Absalom)
          //   - LCA = else:        5 min/hop   (conservative fallback)
          //
          // Route through `tickClock` so midnight crossings still fire
          // weather regen and the event log matches other tick sources.
          const fromPath = activePath || [];
          const toPath = path || [];
          let lcaIdx = -1;
          const lim = Math.min(fromPath.length, toPath.length);
          for (let i = 0; i < lim; i++) {
            if (fromPath[i] === toPath[i]) lcaIdx = i;
            else break;
          }
          const lcaId = lcaIdx >= 0 ? fromPath[lcaIdx] : null;
          const lcaNode = lcaId ? nextTree.nodes[lcaId] : null;
          const lcaKind = String(lcaNode?.kind || '').toLowerCase();
          const hops = travelPlan.passThroughIds.length - 1;
          let tickOpts = null;
          switch (lcaKind) {
            case 'room':
              // Sibling nodes inside a single room should be rare — usually
              // that's tactical positioning, not a tree transition. Skip.
              tickOpts = null;
              break;
            case 'floor':
              tickOpts = { rounds: 1 * hops, cause: 'intra-floor-travel' };
              break;
            case 'building':
              tickOpts = { rounds: 2 * hops, cause: 'intra-building-travel' };
              break;
            case 'area':
            case 'district':
            case 'square':
            case 'village':
            case 'hamlet':
            case 'thorp':
              tickOpts = { minutes: 3 * hops, cause: 'intra-village-travel' };
              break;
            case 'town':
            case 'small-town':
              tickOpts = { minutes: 5 * hops, cause: 'intra-town-travel' };
              break;
            case 'city':
            case 'large-town':
              tickOpts = { minutes: 10 * hops, cause: 'intra-city-travel' };
              break;
            case 'metropolis':
              tickOpts = { minutes: 20 * hops, cause: 'intra-metropolis-travel' };
              break;
            default:
              tickOpts = { minutes: 5 * hops, cause: 'in-town-travel' };
          }
          if (tickOpts) {
            const { patch, events: clockEvents } = tickClock(worldState, tickOpts);
            if (Object.keys(patch).length > 0) {
              setWorldState(prev => ({ ...(prev || {}), ...patch }));
              clockEvents.forEach(e => addLog?.(e.text, e.type));
            }
          }
        }
      } catch (err) {
        // Never let a travel-plan failure block the underlying node switch.
        console.warn('[AdventureTab] overland travel plan failed:', err);
        travelPlan = null;
        travelEncounters = [];
      }
    }

    // L3 — run the arrival cascade, capturing events for the "Since you were
    // last here" callout. Events are also pushed to each ancestor's history.
    const events = tickArrivalCascade(nextTree, path, {
      worldState, campaign, party: activeParty,
    }) || [];
    for (const ev of events) {
      appendNodeHistory(nextTree, ev.nodeId, {
        at: ev.at, kind: ev.kind, text: ev.text, data: ev.data,
      });
    }

    const targetNode = getNodeByPath(nextTree, path);
    const live = targetNode ? loadNodeLiveState(nextTree, targetNode.id) : { npcs: [], items: [], combat: null };

    if (targetNode) recordVisit(nextTree, targetNode.id, worldState);

    // Note: worldState.partyPosition.locationId (the hex-map anchor used by
    // MapTab → mapRegistry.getOverlandMap) is synced by a useEffect on
    // activePath earlier in this component — kept there so the same sync
    // also runs on save-load / rehydrate paths that don't go through
    // switchToNodePath. Walking UP to the nearest TOWN/CITY/VILLAGE/
    // DUNGEON ancestor (rather than using the raw leaf) is deliberate:
    // descending into a building/floor/room inside a town shouldn't flip
    // the hex map — per operator direction 2026-04-18.

    const nextParties = setActivePath(adventure, path);
    setAdventure(prev => prev ? {
      ...prev,
      worldTree: nextTree,
      parties: nextParties,
      activeParty: prev.activeParty || DEFAULT_PARTY_ID,
      // Clear #37 legacy fields once-and-for-all if they're still around.
      subLocations: null,
      currentSub: null,
    } : prev);

    setNearbyNPCs(live.npcs || []);
    setAreaItems(live.items || []);
    setContextActions([]);

    if (targetNode) {
      addLog?.(
        logLabel || `You travel to ${targetNode.name}.`,
        'action',
      );
      // Bug #42 — if there was a real overland journey, surface the beats in
      // the log so the operator sees the time that passed + any encounters
      // that rolled. Keep it terse; the full timeline lives in arrivalSummary.
      if (travelPlan && travelPlan.totalHours > 0) {
        const days = Math.floor(travelPlan.totalDays);
        const hours = Math.round(travelPlan.totalHours - days * 24);
        const timeStr = days > 0
          ? `${days} day${days === 1 ? '' : 's'}${hours > 0 ? `, ${hours}h` : ''}`
          : `${Math.round(travelPlan.totalHours)}h`;
        addLog?.(
          `The journey took ${timeStr} over ${travelPlan.totalMiles} miles.`,
          'narration',
        );
        if (travelEncounters.length > 0) {
          addLog?.(
            `You were waylaid ${travelEncounters.length} time${travelEncounters.length === 1 ? '' : 's'} along the road.`,
            'system',
          );
        }
      }
    }

    if (events.length > 0 || (travelPlan && travelPlan.totalHours > 0)) {
      setArrivalSummary({
        nodeName: targetNode?.name || 'here',
        events,
        // Bug #42 — attach travel plan + beats so a future modal can render
        // the per-segment timeline. The current "Since you were last here"
        // callout in the UI will just show the ticks; beats are here for
        // the follow-up travel-modal wire-up.
        travelPlan,
        travelEncounters,
        travelBeats: travelPlan ? buildTravelBeats(travelPlan) : [],
      });
    } else {
      setArrivalSummary(null);
    }

    // Bug #68 — arrival narrate. Before this block, switchToNodePath would
    // silently log "You travel to X" and end there. The DM engine was never
    // asked to describe the new scene — so sibling/descent travel inside a
    // town read as teleport-with-no-response. We now fire a narrate for any
    // meaningful node change, gated on:
    //   - suppressNarrate option (caller manages its own intro)
    //   - chapter_intro one-shot (if a chapter_intro just fired, don't
    //     stack a second arrival on top — startAdventure uses the same flag)
    //   - targetNode exists (path resolved cleanly)
    // We calibrate the prompt on travel scope: overland journeys get an
    // "arrived after travel" frame; intra-location steps get a shorter
    // "transition into a new room/district" frame. The narrate is fire-
    // and-forget so switchToNodePath keeps its synchronous contract (the
    // original walk-away reaction above is called the same way).
    if (targetNode && !suppressNarrate) {
      const chapterAlreadyFired = consumePendingChapterIntro?.() === true;
      if (chapterAlreadyFired) {
        try {
          traceEngine?.('switchToNodePath:skipArrivalNarrate', {
            reason: 'chapter_intro_just_fired',
            targetNode: targetNode.name,
          });
        } catch (_) { /* trace best-effort */ }
      } else {
        const hadOverlandJourney = !!(travelPlan && travelPlan.totalHours > 0);
        const fromClause = priorNode?.name ? ` from ${priorNode.name}` : '';
        const arrivalAction = hadOverlandJourney
          ? `The party has just arrived at ${targetNode.name}${fromClause}, their journey ending here. Paint the arrival atmospherically — what they see and hear as they step onto the scene, the light, the crowd (if any), the mood, what first catches their eye. Introduce no new named NPCs and do not start combat. Keep to a short paragraph (3–5 sentences).`
          : `The party moves${fromClause} to ${targetNode.name}. Paint the transition atmospherically — what changes around them, the new sounds, the new light, what first catches their eye in this new place. Introduce no new named NPCs and do not start combat. Keep to 2–4 sentences.`;
        (async () => {
          try {
            setNarrating?.(true);
            const result = await dmEngine.narrate(
              'custom',
              {
                party: activeParty || party,
                encounter: {
                  name: targetNode.name,
                  description: targetNode.desc || '',
                  type: 'exploration',
                },
                recentLog: (gameLog || []).slice(-6),
              },
              arrivalAction,
            );
            if (result?.text) {
              addLog?.(result.text, 'narration');
            }
            if (result) {
              try {
                processNewEntities?.(result.newEntities, null, result.text || '');
              } catch (_) { /* non-fatal */ }
            }
          } catch (err) {
            console.warn('[AdventureTab] arrival narrate (switchToNodePath) failed:', err);
          } finally {
            setNarrating?.(false);
          }
        })();
      }
    }
  };

  const createChildAtActive = () => {
    if (!adventure || !worldTree || !activeNode) return;
    const raw = typeof window !== 'undefined'
      ? window.prompt(`Name this place inside ${activeNode.name} (e.g. "Common Room", "2nd Floor", "Altar Chamber"):`)
      : null;
    const name = String(raw || '').trim();
    if (!name) return;

    // Infer a sensible default kind based on the parent.
    const parentKind = activeNode.kind;
    let childKind = NODE_KINDS.AREA;
    if (parentKind === NODE_KINDS.WORLD) childKind = NODE_KINDS.COUNTRY;
    else if (parentKind === NODE_KINDS.COUNTRY) childKind = NODE_KINDS.REGION;
    else if (parentKind === NODE_KINDS.REGION) childKind = NODE_KINDS.TOWN;
    else if ([NODE_KINDS.TOWN, NODE_KINDS.CITY, NODE_KINDS.VILLAGE].includes(parentKind)) childKind = NODE_KINDS.BUILDING;
    else if (parentKind === NODE_KINDS.BUILDING) childKind = NODE_KINDS.FLOOR;
    else if (parentKind === NODE_KINDS.FLOOR) childKind = NODE_KINDS.ROOM;
    else if (parentKind === NODE_KINDS.ROOM) childKind = NODE_KINDS.AREA;
    else if (parentKind === NODE_KINDS.DUNGEON) childKind = NODE_KINDS.ROOM;
    else if (parentKind === NODE_KINDS.WILDERNESS) childKind = NODE_KINDS.LANDMARK;

    const nextTree = {
      rootId: worldTree.rootId,
      nodes: { ...worldTree.nodes },
    };
    for (const id of Object.keys(nextTree.nodes)) {
      nextTree.nodes[id] = { ...nextTree.nodes[id] };
    }
    const newNode = createChildNode(nextTree, activeNode.id, { name, kind: childKind });

    setAdventure(prev => prev ? { ...prev, worldTree: nextTree } : prev);

    // Auto-descend into the new node so the operator can start populating it.
    setTimeout(() => switchToNodePath([...activePath, newNode.id], {
      logLabel: `You enter ${name}.`,
      // Bug #42 — stepping into a freshly-created sub-node (e.g. "you walk
      // into the back room") is a local-scale move, not an overland trip.
      // Skip the PF1e travel plan so we don't fast-forward the clock or
      // roll encounters on a 0-mile transition.
      skipOverland: true,
    }), 0);
  };

  const removeChildOfActive = (childId) => {
    if (!adventure || !worldTree || !activeNode) return;
    const child = getNode(worldTree, childId);
    if (!child) return;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Delete "${child.name}" and everything inside it? Any saved NPCs, items, and sub-places will be lost.`
      );
      if (!ok) return;
    }
    const nextTree = {
      rootId: worldTree.rootId,
      nodes: { ...worldTree.nodes },
    };
    for (const id of Object.keys(nextTree.nodes)) {
      nextTree.nodes[id] = { ...nextTree.nodes[id] };
    }
    // If the party is currently inside or beneath the node being removed,
    // pop them up to the active node (its parent) first.
    const removingOnActivePath = activePath.includes(childId);
    removeTreeNode(nextTree, childId);

    if (removingOnActivePath) {
      const truncated = activePath.slice(0, activePath.indexOf(childId));
      const nextParties = setActivePath(adventure, truncated);
      setAdventure(prev => prev ? { ...prev, worldTree: nextTree, parties: nextParties } : prev);
      const newActive = getNodeByPath(nextTree, truncated);
      const live = newActive ? loadNodeLiveState(nextTree, newActive.id) : { npcs: [], items: [] };
      setNearbyNPCs(live.npcs || []);
      setAreaItems(live.items || []);
      setContextActions([]);
      addLog?.(`You step out to ${newActive?.name || 'the outer area'}.`, 'action');
    } else {
      setAdventure(prev => prev ? { ...prev, worldTree: nextTree } : prev);
    }
  };

  const renameActiveChild = (childId) => {
    if (!adventure || !worldTree) return;
    const child = getNode(worldTree, childId);
    if (!child) return;
    const raw = typeof window !== 'undefined'
      ? window.prompt(`Rename "${child.name}":`, child.name)
      : null;
    const name = String(raw || '').trim();
    if (!name || name === child.name) return;
    const nextTree = {
      rootId: worldTree.rootId,
      nodes: { ...worldTree.nodes, [childId]: { ...worldTree.nodes[childId], name } },
    };
    setAdventure(prev => prev ? { ...prev, worldTree: nextTree } : prev);
  };

  // Convenience: jump to a specific breadcrumb index (0=root, length-1=active).
  // Bug #37 (2026-04-17) — strict adjacency: only one-step parent ascend is
  // allowed. Jumps to deeper ancestors (grandparent and above) are rejected
  // so callers can't bypass the breadcrumb UI guard. Container-tier targets
  // are also rejected — switchToNodePath's resolveLandingPath cascade would
  // bounce them anyway, but blocking here keeps the "You travel to …" log
  // line from firing for an invalid hop.
  const jumpToBreadcrumb = (idx) => {
    if (idx < 0 || idx >= activePath.length) return;
    if (idx === activePath.length - 1) return; // already there
    if (idx !== activePath.length - 2) return; // only immediate parent
    const targetId = activePath[idx];
    const targetNode = worldTree ? worldTree.nodes?.[targetId] : null;
    if (targetNode && isContainerKind(targetNode.kind)) return;
    // 2026-04-20 — pass skipEntranceCascade so an ascent to a town node
    // doesn't re-trigger the approach-direction routing that would
    // otherwise dump the party at a random entrance child. The party
    // wants to stand AT the town breadcrumb level so the picker can
    // surface its children and they can pick where to go next.
    switchToNodePath(activePath.slice(0, idx + 1), { skipEntranceCascade: true });
  };

  // Handle "Talk to NPC" from panel
  const handleTalkToNPC = async (npc) => {
    const displayLabel = getNPCDisplayName(npc);
    const action = `I approach ${displayLabel} and speak with them`;
    setCustomAction('');
    // Bug #56 — if the party was mid-conversation with a DIFFERENT NPC and
    // just pivoted to a new one, that's a walk-away. Passing npc.id excludes
    // re-engagement with the same NPC from the reaction, which is the common
    // case (tapping Talk To on an existing conversation partner).
    fireWalkAwayReaction(npc?.id || null);
    addLog?.(`> ${action}`, 'action');
    setNarrating(true);

    // Build a description for the AI prompt that includes the NPC's real name
    // so the AI can write narration where the NPC introduces themselves
    const npcDescription = buildNPCDescription(npc);
    const wasUnknown = !npc.knownToParty;
    const promptNote = wasUnknown
      ? `This NPC's name is ${npc.name}, but the party does NOT know this yet. Have the NPC introduce themselves naturally during conversation — mention their name as part of dialogue. Describe them by appearance until the introduction moment.`
      : `The party already knows this is ${npc.name}.`;

    try {
      const result = await dmEngine.narrate('custom', {
        party,
        encounter: {
          name: wasUnknown ? displayLabel : npc.name,
          description: `${npcDescription}. ${promptNote}`,
          type: 'roleplay',
        },
        recentLog: (gameLog || []).slice(-15),
      }, action);
      addLog?.(result.text, 'narration');
      // Task #70b → #79 — one exchange of dialogue = 1 round (6 sec).
      // Longer conversations accumulate naturally through multiple
      // narrate inputs. Previous 5-minute tick was anchored on the
      // ceil-to-minute bug + a misread of PF1e conversational time (a
      // "full beat" of canonical dialogue is 1 round; 10 rounds = 1 min
      // is the natural threshold where a conversation becomes a
      // "parley" scene and the operator would advance explicitly).
      if (setWorldState) {
        const { patch, events } = tickClock(worldState, {
          rounds: 1,
          cause: 'talk-to-npc',
        });
        if (Object.keys(patch).length > 0) {
          setWorldState(prev => ({ ...(prev || {}), ...patch }));
          events.forEach(e => addLog?.(e.text, e.type));
        }
      }
      // #30 — heuristic NPC fallback from raw narration.
      processNewEntities(result.newEntities, null, result.text || '');
      // Update context actions based on conversation
      if (result.suggestedActions && result.suggestedActions.length > 0) {
        setContextActions(result.suggestedActions);
      } else {
        setContextActions(generateContextActions({ type: 'npc', text: result.text }, adventure, party));
      }
    } catch {
      // Fallback narration — introduce the NPC by name through dialogue
      const greeting = npc.personality === 'gruff' ? 'What do you want?'
        : npc.personality === 'nervous' ? 'Oh! Can I... help you?'
        : npc.personality === 'secretive' ? 'You shouldn\'t be talking to me here...'
        : npc.personality === 'jovial' ? 'Ha! Welcome, welcome, friends!'
        : 'Well met, traveler.';

      if (wasUnknown) {
        addLog?.(`${displayLabel} regards you with a ${npc.disposition} expression. "${greeting} Name's ${npc.name}."`, 'dialogue');
      } else {
        addLog?.(`${npc.name} regards you with a ${npc.disposition} expression. "${greeting}"`, 'dialogue');
      }
    }

    // After talking, the NPC's name is now known to the party
    if (wasUnknown) {
      const updated = await revealNPCName(npc);
      setNearbyNPCs(prev => prev.map(n => n.id === npc.id ? { ...n, knownToParty: true } : n));
      addLog?.(`You learn that this is ${npc.name}.`, 'info');
    }

    // Bug #56 — record this NPC as the current conversation partner. The
    // next non-talk action (custom, compound, context) or node change will
    // fire a one-shot walk-away reaction beat via fireWalkAwayReaction. Stored
    // fields: npcId (dedupe against re-engagement), npcName (prefer real name
    // if revealed so the reaction addresses them correctly), disposition (for
    // the prompt's tone hint), nodePath (diagnostic — not currently gated on),
    // timestamp (diagnostic), importantFlag (v2 gate — off for v1).
    lastConversationPartnerRef.current = {
      npcId: npc?.id || null,
      npcName: npc?.name || displayLabel,
      disposition: npc?.disposition || 'indifferent',
      nodePath: Array.isArray(activePath) ? [...activePath] : [],
      timestamp: Date.now(),
      importantFlag: false,
      via: null,
    };

    setNarrating(false);
  };

  // Pick the party member most likely to succeed at an Appraise check.
  // Estimate = skill ranks + INT mod + class-skill bonus. This is a rough
  // rank; the real check is rolled inside dmEngine.inspectItem.
  const pickBestAppraiser = (party) => {
    if (!Array.isArray(party) || party.length === 0) return null;
    const score = (c) => {
      const ranks = c?.skillRanks?.Appraise || 0;
      const intMod = Math.floor(((c?.abilities?.INT || 10) - 10) / 2);
      // Assume Appraise is a class skill for anyone with any ranks in it
      // (close enough for UI ordering — the actual check uses proper logic).
      const classBonus = ranks > 0 ? 3 : 0;
      return ranks + intMod + classBonus;
    };
    return [...party].sort((a, b) => score(b) - score(a))[0];
  };

  // Handle area item interaction
  // Bug #46 — on Take, actually add the loot to a party member's
  // inventory/gold. Prior to that fix items were just spliced off
  // `areaItems` with a log line, and neither the gold nor the item
  // reached anyone's character record — they vanished.
  //
  // Bug #45 (layered on top of #46) — "Area item actions should be
  // character specific. 'Who does the action?'" The receiver is now
  // `activeCharacter` (driven by the AreaItemsPanel's actor picker and
  // persisted via worldState.activeCharacterId), not the hardcoded
  // `party[0]`. Falls back to party[0] when activeCharacterId is null
  // or stale — same behavior as before the #45 slice so nothing
  // regresses for single-PC games.
  const handleItemInteract = (item) => {
    if (item.loot && item.gold) {
      const receiver = activeCharacter;
      const who = receiver?.name || 'The party';
      addLog?.(`${who} picks up the ${item.name} and finds ${item.gold} gold inside!`, 'loot');
      if (receiver && setParty) {
        setParty(prev => prev.map(c => c.id !== receiver.id ? c : {
          ...c,
          gold: (c.gold || 0) + (item.gold || 0),
        }));
      }
      setAreaItems(prev => prev.filter(i => i !== item));
    } else if (item.loot && item.item) {
      const receiver = activeCharacter;
      const who = receiver?.name || 'You';
      const itemName = typeof item.item === 'string' ? item.item : (item.item?.name || item.name || 'item');
      const itemObj = typeof item.item === 'object' && item.item
        ? { ...item.item, quantity: item.item.quantity || 1 }
        : { name: itemName, quantity: 1 };
      addLog?.(`${who} takes the ${itemName}.`, 'loot');
      if (receiver && setParty) {
        setParty(prev => prev.map(c => {
          if (c.id !== receiver.id) return c;
          const inv = Array.isArray(c.inventory) ? c.inventory : [];
          const existing = inv.find(i => i.name === itemObj.name);
          if (existing) {
            return {
              ...c,
              inventory: inv.map(i => i.name === itemObj.name
                ? { ...i, quantity: (i.quantity || 1) + (itemObj.quantity || 1) }
                : i),
            };
          }
          return { ...c, inventory: [...inv, itemObj] };
        }));
      }
      setAreaItems(prev => prev.filter(i => i !== item));
    } else if (item.interactable) {
      // CRB Try Again rule: "Additional attempts to Appraise an item reveal
      // the same result." Once we've appraised, cache the result on the item
      // so the player can't re-roll for a better one.
      const alreadyAppraised = !!item.knownIdentity;
      const appraiser = pickBestAppraiser(party);

      // Roll the Appraise check (or reuse the cached identity).
      let inspect = null;
      try {
        if (alreadyAppraised) {
          inspect = item.knownIdentity;
        } else if (appraiser) {
          inspect = dmEngine.inspectItem(appraiser, item);
        }
      } catch (err) {
        inspect = null;
      }

      // Log the player-facing appraisal line if we have one.
      if (inspect && inspect.display && inspect.display.band !== 'unknown') {
        const { display } = inspect;
        const prefix = appraiser?.name ? `${appraiser.name}:` : 'You appraise:';
        let line = `${prefix} ${display.headline}`;
        if (display.valueText && display.valueText !== '—') {
          line += ` — ${display.valueText}.`;
        }
        if (display.magicHint) {
          line += ` ${display.magicHint}`;
        }
        addLog?.(line, alreadyAppraised ? 'info' : 'roll');

        // Cache the check result so repeat Examine is a no-op per CRB.
        if (!alreadyAppraised) {
          setAreaItems(prev => prev.map(i =>
            i === item ? { ...i, knownIdentity: inspect } : i
          ));
        }
      }

      const action = `I examine the ${item.name} closely`;
      addLog?.(`> ${action}`, 'action');
      setNarrating(true);
      dmEngine.narrate('custom', {
        party,
        encounter: adventure?.location ? { name: adventure.location.name, description: adventure.location.desc, type: adventure.type === 'town' ? 'roleplay' : 'exploration' } : null,
        recentLog: (gameLog || []).slice(-10),
        appraiseResult: inspect || null, // feed into narration prompt (Phase 4)
      }, action).then(result => {
        addLog?.(result.text, 'narration');
        // #30 — heuristic NPC fallback.
        processNewEntities(result.newEntities, null, result.text || '');
      }).catch(() => {
        addLog?.(`You examine the ${item.name}. ${item.description}`, 'narration');
      }).finally(() => setNarrating(false));
    }
  };

  // "Survey the hoard" — 1 full-round Appraise check that identifies the
  // most valuable visible item in a pile of 3+ loot items (CRB p.89-90).
  // Triggered by the Survey button in AreaItemsPanel, wired up whenever the
  // area has 3 or more loot items (the hoard threshold we picked).
  const handleSurveyHoard = () => {
    const loot = (areaItems || []).filter(i => i.loot || i.interactable);
    if (loot.length < 3) {
      addLog?.('Not enough items here to count as a hoard.', 'info');
      return;
    }
    const appraiser = pickBestAppraiser(party);
    if (!appraiser) {
      addLog?.('Nobody in the party can Appraise.', 'info');
      return;
    }
    let inspect = null;
    try {
      inspect = dmEngine.inspectHoard(appraiser, loot);
    } catch (err) {
      inspect = null;
    }
    if (!inspect || inspect.canUse === false) {
      addLog?.(inspect?.reason || 'You survey the pile but can\'t make sense of it.', 'info');
      return;
    }

    const { display, item: topPiece } = inspect;
    const prefix = appraiser?.name ? `${appraiser.name}:` : 'You survey the hoard:';
    let line = `${prefix} ${display.headline}`;
    if (display.valueText && display.valueText !== '—') {
      line += ` (${display.valueText})`;
    }
    if (display.magicHint) {
      line += ` ${display.magicHint}`;
    }
    addLog?.(`[1 full-round action] ${line}`, 'roll');

    // Cache the hoard result on the top piece so the player sees the value
    // tag on it directly in the panel.
    if (topPiece && display.band === 'hoard-success') {
      setAreaItems(prev => prev.map(i =>
        i.name === topPiece.name ? { ...i, knownIdentity: {
          ...inspect,
          display: {
            ...display,
            // Re-cast hoard display as single-item display for the panel tag.
            band: 'exact',
          },
        } } : i
      ));
    }
  };

  // 2026-04-20 — Parse a character-tagged suggestion like
  // "Shadowblade — Investigate the still figure" into { characterId, action }.
  // Returns null if the action text doesn't match a "<PartyMemberName> <sep>
  // ..." shape where the name resolves to a current party member. Sep can
  // be em-dash, en-dash, hyphen, or colon — the AI emits em-dash via the
  // suggestion templates but operators occasionally hand-write hyphen or
  // colon, so we accept all three. Match is case-insensitive on the name
  // so "shadowblade — ..." still works.
  const parseCharacterTaggedAction = (actionText) => {
    if (typeof actionText !== 'string' || !actionText.trim()) return null;
    if (!Array.isArray(party) || party.length === 0) return null;
    const m = actionText.match(/^\s*([^\s—–\-:][^—–\-:]*?)\s*[—–\-:]\s*(.+)$/);
    if (!m) return null;
    const tag = m[1].trim().toLowerCase();
    const rest = m[2].trim();
    if (!rest) return null;
    const matched = party.find(c => (c?.name || '').trim().toLowerCase() === tag);
    if (!matched) return null;
    return { characterId: matched.id, action: rest };
  };

  // Handle contextual action button
  const handleContextAction = (action) => {
    // 2026-04-20 — clicking a context-action suggestion no longer fires
    // the action immediately. Instead it SEEDS the relevant input so the
    // operator can edit/alter/expand before submitting. Routing rules:
    //   • Character-tagged ("Shadowblade — investigate ...") → that
    //     character's row in the Party Actions bar. Operator can stack
    //     multiple character-tagged suggestions to queue a split-party
    //     round, then Submit all to resolve as one scene.
    //   • Untagged ("Browse the festival stalls") → the shared
    //     Custom action text box. Operator hits Do (or Enter) to fire.
    // Either way the suggestion is removed from the list once queued so
    // it doesn't ghost-linger. The previous "click = immediate fire"
    // behavior was surprising for split parties and made it impossible
    // to edit a suggestion before committing.
    const tagged = parseCharacterTaggedAction(action.action || '');
    if (tagged) {
      setPartyPerChar(prev => ({ ...prev, [tagged.characterId]: tagged.action }));
      // 2026-04-20 follow-up — DON'T pull the suggestion off the list.
      // Earlier behavior removed the clicked suggestion immediately, but
      // that emptied the list after a few clicks, which then collapsed
      // the renderContextActions panel via its `length > 0` gate AND
      // hid the Refresh button (which lives inside that panel). Operator
      // got stuck with no suggestions and no way to ask for new ones.
      // Leaving suggestions in place lets the operator re-seed if they
      // accidentally cleared an input, and the Refresh button stays
      // reachable. Clicking the same suggestion twice just overwrites
      // the same row with the same text — idempotent, harmless.
      return;
    }
    // Untagged → populate the shared custom-action input.
    setCustomAction(action.action || '');
    return;
  };

  // Original immediate-fire path retained for callers that explicitly
  // want auto-execute (e.g. travel/menu actions that don't go through
  // the suggestion list). The user-facing suggestion buttons all go
  // through handleContextAction above, which seeds inputs instead.
  const fireContextActionImmediate = (action) => {
    setCustomAction('');
    // Bug #56 — a context action (skill / combat / explore / social button)
    // is a non-talk next-move; fire the walk-away reaction before narrating.
    fireWalkAwayReaction(null);
    addLog?.(`> ${action.action}`, action.type === 'skill' ? 'info' : 'action');
    setNarrating(true);
    dmEngine.narrate('custom', {
      party,
      encounter: adventure?.location ? { name: adventure.location.name, description: adventure.location.desc, type: adventure.type === 'town' ? 'roleplay' : 'exploration' } : null,
      recentLog: (gameLog || []).slice(-15),
    }, action.action).then(result => {
      addLog?.(result.text, 'narration');
      // Task #70b → #79 — every context action is 1 PF1e round (6 sec).
      // Combat still passes 0 here because CombatTab owns the per-round
      // tick via #70c (which now also advances 6 sec instead of 1 min,
      // fixing the 10× inflation). Skill/social/explore all collapse
      // onto the same round-atomic unit:
      //   - skill   = 1 round (standard-action check)
      //   - social  = 1 round (one exchange of dialogue; longer parley
      //               is multiple inputs)
      //   - explore = 1 round (quick look — a Take-20 thorough search
      //               is a separate escalation the operator triggers
      //               via GM Quick Advance or the future #79a Take-20
      //               preset on the narrate composer)
      const CONTEXT_TICK_ROUNDS = {
        social: 1,
        skill: 1,
        combat: 0,
        explore: 1,
      };
      const tickRounds = CONTEXT_TICK_ROUNDS[action?.type] ?? 1;
      if (setWorldState && tickRounds > 0) {
        const { patch, events } = tickClock(worldState, {
          rounds: tickRounds,
          cause: `context-${action?.type || 'neutral'}`,
        });
        if (Object.keys(patch).length > 0) {
          setWorldState(prev => ({ ...(prev || {}), ...patch }));
          events.forEach(e => addLog?.(e.text, e.type));
        }
      }
      // #30 — heuristic NPC fallback.
      processNewEntities(result.newEntities, null, result.text || '');
      // Update context actions from AI response
      if (result.suggestedActions && result.suggestedActions.length > 0) {
        setContextActions(result.suggestedActions);
      } else {
        const evt = { type: 'custom', text: result.text };
        setContextActions(generateContextActions(evt, adventure, party));
      }
    }).catch(() => {
      addLog?.(`You ${action.action.toLowerCase().replace(/^i /, '')}. The world responds in kind.`, 'narration');
    }).finally(() => setNarrating(false));
  };

  const contextBtnColors = {
    social: { border: '#40e0d0', color: '#40e0d0' },
    skill: { border: '#7eb8da', color: '#7eb8da' },
    combat: { border: '#ff6b6b', color: '#ff6b6b' },
    explore: { border: '#ffd700', color: '#ffd700' },
    neutral: { border: '#8b949e', color: '#8b949e' },
  };

  const hasParty = party && party.length > 0;

  // Determine campaign starting location if applicable
  const campaignLocation = (() => {
    if (!campaign) return null;
    const ch = campaign.data?.chapters?.find(c => c.id === campaign.currentChapter);
    const pt = ch?.parts?.find(p => p.id === campaign.currentPart);
    if (!pt?.location) return null;
    // Match to a town location by checking if the part location contains the town name
    const loc = pt.location.toLowerCase();
    return TOWN_LOCATIONS.find(t => loc.includes(t.name.toLowerCase())) || null;
  })();

  if (!adventure || !adventure.active) {
    return (
      <div style={styles.container}>
        <ApiKeyBanner onOpenSettings={() => setTab?.('Settings')} />
        <div style={styles.empty}>
          <div style={{ fontSize: isMobile ? '32px' : '48px', marginBottom: '16px' }}>{campaign ? '\u{1F4DC}' : '\u{1F5FA}\uFE0F'}</div>
          <div style={{ fontSize: isMobile ? '16px' : '18px', color: '#ffd700', marginBottom: '4px' }}>
            {campaign ? `${campaign.data?.name}` : 'Begin a Free Adventure'}
          </div>
          <div style={{ fontSize: isMobile ? '12px' : '13px', color: '#8b949e', marginBottom: '20px', maxWidth: isMobile ? '100%' : '500px', textAlign: 'center', lineHeight: 1.5 }}>
            {!hasParty
              ? 'You need to create at least one character in the Party tab before starting an adventure.'
              : campaign
                ? 'Choose where to begin. The campaign suggests a starting location, but you can start anywhere.'
                : 'Choose where your adventure starts. Town adventures let you roleplay, shop, and gather information. Dungeon crawls throw you into exploration and combat.'}
          </div>

          {!hasParty && (
            <button
              style={{ ...styles.button, padding: isMobile ? '14px 20px' : '12px 24px', fontSize: isMobile ? '13px' : '14px', minWidth: isMobile ? '100%' : 'auto' }}
              onClick={() => setTab?.('Party')}
            >
              Go to Party Tab
            </button>
          )}

          {hasParty && !showTownPicker && (
            <div style={{ display: 'flex', gap: isMobile ? '8px' : '16px', flexDirection: isMobile ? 'column' : 'row', width: isMobile ? '100%' : 'auto' }}>
              <button
                style={{ ...styles.button, padding: isMobile ? '14px 16px' : '16px 28px', fontSize: isMobile ? '13px' : '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', minWidth: isMobile ? '100%' : '140px' }}
                onClick={() => setShowTownPicker(true)}
              >
                <span style={{ fontSize: isMobile ? '28px' : '24px' }}>🏘️</span>
                <span>Start in Town</span>
                <span style={{ fontSize: isMobile ? '11px' : '10px', color: '#b8860b', fontWeight: 'normal' }}>Roleplay &amp; explore</span>
              </button>
              <button
                style={{ ...styles.button, padding: isMobile ? '14px 16px' : '16px 28px', fontSize: isMobile ? '13px' : '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', minWidth: isMobile ? '100%' : '140px' }}
                onClick={() => startAdventure('dungeon')}
              >
                <span style={{ fontSize: isMobile ? '28px' : '24px' }}>⚔️</span>
                <span>Dungeon Crawl</span>
                <span style={{ fontSize: isMobile ? '11px' : '10px', color: '#b8860b', fontWeight: 'normal' }}>Combat &amp; loot</span>
              </button>
            </div>
          )}
          {hasParty && showTownPicker && (
            <div style={{ width: '100%', maxWidth: isMobile ? '100%' : '600px', padding: isMobile ? '0 8px' : '0' }}>
              <div style={{ fontSize: isMobile ? '13px' : '14px', color: '#ffd700', marginBottom: '12px', textAlign: 'center' }}>Choose Your Starting Town</div>

              {/* Campaign-suggested location — shown prominently if a campaign is active */}
              {campaign && campaignLocation && (
                <button
                  style={{
                    width: '100%', padding: isMobile ? '12px 14px' : '14px 16px', marginBottom: '12px',
                    backgroundColor: '#2d1b00', border: '2px solid #ffd700',
                    borderRadius: '8px', cursor: 'pointer', textAlign: 'left', color: '#d4c5a9',
                  }}
                  onClick={() => { setShowTownPicker(false); startAdventure('town', campaignLocation); }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                    <span style={{ fontSize: isMobile ? '18px' : '20px' }}>{'\u{1F4DC}'}</span>
                    <span style={{ color: '#ffd700', fontWeight: 'bold', fontSize: isMobile ? '13px' : '14px' }}>{campaignLocation.name}</span>
                    <span style={{ fontSize: isMobile ? '9px' : '10px', color: '#b8860b', border: '1px solid #b8860b', borderRadius: 8, padding: '1px 8px' }}>Campaign Start</span>
                  </div>
                  <div style={{ fontSize: isMobile ? '11px' : '12px', color: '#b0a690', lineHeight: 1.4, paddingLeft: isMobile ? '0' : '28px' }}>
                    {campaignLocation.desc.substring(0, 150)}...
                  </div>
                </button>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: '8px' }}>
                {TOWN_LOCATIONS.map((town, idx) => {
                  const isCampaignTown = campaignLocation && town.name === campaignLocation.name;
                  return (
                    <button
                      key={idx}
                      style={{
                        padding: isMobile ? '12px' : '12px',
                        backgroundColor: isCampaignTown ? '#2d2b00' : '#2a2a4e',
                        border: isCampaignTown ? '1px solid #ffd700' : '1px solid rgba(255, 215, 0, 0.3)',
                        borderRadius: '6px', cursor: 'pointer', textAlign: 'left', color: '#d4c5a9',
                        minHeight: isMobile ? '80px' : 'auto',
                      }}
                      onClick={() => { setShowTownPicker(false); startAdventure('town', town); }}
                    >
                      <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: isMobile ? '12px' : '13px', marginBottom: '4px' }}>
                        {town.terrain === 'tavern' ? '\u{1F37A}' : town.terrain === 'city' ? '\u{1F3DB}\uFE0F' : '\u{1F3D8}\uFE0F'} {town.name}
                        {isCampaignTown && <span style={{ fontSize: isMobile ? '9px' : '10px', color: '#b8860b', marginLeft: 6 }}>{'\u2B50'}</span>}
                      </div>
                      <div style={{ fontSize: isMobile ? '10px' : '11px', color: '#8b949e', lineHeight: 1.4 }}>
                        {town.desc.substring(0, 100)}...
                      </div>
                    </button>
                  );
                })}
                <button
                  style={{
                    padding: isMobile ? '12px' : '12px', backgroundColor: '#2a2a4e', border: '1px solid rgba(255, 215, 0, 0.3)',
                    borderRadius: '6px', cursor: 'pointer', textAlign: 'left', color: '#d4c5a9',
                    minHeight: isMobile ? '80px' : 'auto',
                  }}
                  onClick={() => { setShowTownPicker(false); startAdventure('town'); }}
                >
                  <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: isMobile ? '12px' : '13px', marginBottom: '4px' }}>
                    🎲 Random Town
                  </div>
                  <div style={{ fontSize: isMobile ? '10px' : '11px', color: '#8b949e' }}>
                    Let fate decide your starting location
                  </div>
                </button>
              </div>
              <button
                style={{ ...styles.button, marginTop: '12px', borderColor: '#8b949e', color: '#8b949e', width: isMobile ? '100%' : 'auto' }}
                onClick={() => setShowTownPicker(false)}
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Map rendering helper
  // Bug #16: if adventure state is from before #9's startAdventure fix, the
  // type could be 'dungeon' while the location is actually a town (Sandpoint,
  // etc.). Normalise by preferring town rendering whenever the location
  // matches a known town, independent of the stale type.
  //
  // #39 — If a world-tree active node exists, it overrides the flat
  // adventure.type. Node.kind drives generator selection:
  //   world/country/region/continent → wide-area procedural (wildernessish)
  //   town/city/village → SettlementMap
  //   building/floor/room/area → DungeonMap (interior procedural)
  //   wilderness/dungeon → InteractiveMap lookup, then DungeonMap fallback
  // Operator override via node.map.{id,src} is honored first.
  const renderMap = () => {
    const nodeName = activeNode?.name || adventure?.location?.name || '';
    const nodeKind = activeNode?.kind || null;

    // #39 — operator override via node.map.src (uploaded) / node.map.id (registered).
    if (activeNode?.map) {
      if (activeNode.map.id && mapRegistry.hasMapImage(activeNode.map.id)) {
        return (
          <div style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,215,0,0.2)' }}>
            <InteractiveMap
              mapId={activeNode.map.id}
              pins={getMergedPins(activeNode.map.id)}
              regions={getRegions(activeNode.map.id)}
              skipRegistryPins={true}
              fogEnabled={nodeKind === NODE_KINDS.DUNGEON}
              width={isMobile ? '100%' : '244px'} height={isMobile ? '220px' : '200px'}
              addLog={addLog}
            />
          </div>
        );
      }
      if (activeNode.map.src) {
        return (
          <div style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,215,0,0.2)' }}>
            <img src={activeNode.map.src} alt={`Map of ${nodeName}`}
              style={{ display: 'block', width: isMobile ? '100%' : '244px', height: isMobile ? '220px' : '200px', objectFit: 'cover' }} />
          </div>
        );
      }
    }

    // #39 — node-kind-driven rendering.
    if (nodeKind) {
      const mapMatch = nodeName ? mapRegistry.findMapForLocation(nodeName) : null;
      if (mapMatch && mapRegistry.hasMapImage(mapMatch.id)) {
        const fog = nodeKind === NODE_KINDS.DUNGEON;
        return (
          <div style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,215,0,0.2)' }}>
            <InteractiveMap
              mapId={mapMatch.id}
              pins={getMergedPins(mapMatch.id)}
              regions={getRegions(mapMatch.id)}
              skipRegistryPins={true}
              fogEnabled={fog}
              width={isMobile ? '100%' : '244px'} height={isMobile ? '220px' : '200px'}
              showLegend={!fog}
              addLog={addLog}
            />
          </div>
        );
      }
      // Procedural fallback by kind.
      const seed = (nodeName || 'seed').charCodeAt(0) || 42;
      if ([NODE_KINDS.TOWN, NODE_KINDS.CITY, NODE_KINDS.VILLAGE].includes(nodeKind)) {
        return (
          <ParchmentFrame title={nodeName || 'Settlement'}>
            <SettlementMap
              name={nodeName}
              size={nodeKind === NODE_KINDS.CITY ? 'large_town' : nodeKind === NODE_KINDS.VILLAGE ? 'village' : 'large_town'}
              seed={seed}
              width={isMobile ? 300 : 230} height={isMobile ? 200 : 180}
            />
          </ParchmentFrame>
        );
      }
      if ([NODE_KINDS.BUILDING, NODE_KINDS.FLOOR, NODE_KINDS.ROOM, NODE_KINDS.AREA, NODE_KINDS.DUNGEON].includes(nodeKind)) {
        return (
          <ParchmentFrame title={`${KIND_ICON[nodeKind] || ''} ${nodeName || nodeKind}`.trim()}>
            <DungeonMap
              roomCount={Math.max(4, Math.min(9, 3 + (childrenHere.length || 0)))}
              seed={seed}
              currentRoom={0}
              width={isMobile ? 300 : 230} height={isMobile ? 200 : 180}
            />
          </ParchmentFrame>
        );
      }
      if ([NODE_KINDS.WILDERNESS, NODE_KINDS.LANDMARK].includes(nodeKind)) {
        return (
          <ParchmentFrame title={`${KIND_ICON[nodeKind] || ''} ${nodeName || 'Wilderness'}`.trim()}>
            <DungeonMap roomCount={5} seed={seed} currentRoom={0}
              width={isMobile ? 300 : 230} height={isMobile ? 200 : 180} />
          </ParchmentFrame>
        );
      }
      if ([NODE_KINDS.WORLD, NODE_KINDS.PLANE, NODE_KINDS.CONTINENT, NODE_KINDS.COUNTRY, NODE_KINDS.REGION].includes(nodeKind)) {
        // Wide-area placeholder: parchment frame listing visible children.
        return (
          <ParchmentFrame title={`${KIND_ICON[nodeKind] || '🌍'} ${nodeName || 'World'}`.trim()}>
            <div style={{ padding: '8px 10px', color: '#8b949e', fontSize: '11px', lineHeight: 1.5, minHeight: isMobile ? 180 : 160 }}>
              {childrenHere.length > 0 ? (
                <>
                  <div style={{ color: '#c792ea', marginBottom: '4px', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.5px' }}>Known places</div>
                  {childrenHere.slice(0, 8).map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{KIND_ICON[c.kind] || '📍'}</span>
                      <span style={{ color: '#c9bfae' }}>{c.name}</span>
                    </div>
                  ))}
                  {childrenHere.length > 8 && (
                    <div style={{ color: '#666', fontStyle: 'italic', marginTop: '4px' }}>+ {childrenHere.length - 8} more…</div>
                  )}
                </>
              ) : (
                <div style={{ fontStyle: 'italic' }}>A blank map. Add known places below.</div>
              )}
            </div>
          </ParchmentFrame>
        );
      }
    }

    // Legacy fallback: no world-tree node, use adventure.type.
    const locName = adventure?.location?.name || '';
    const looksLikeTown = TOWN_LOCATIONS.some(t => t.name === locName);
    const effectiveType = looksLikeTown ? 'town' : adventure?.type;

    if (effectiveType === 'dungeon') {
      const mapMatch = mapRegistry.findMapForLocation(adventure?.location?.name || '');
      if (mapMatch && mapRegistry.hasMapImage(mapMatch.id)) {
        return (
          <div style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,215,0,0.2)' }}>
            <InteractiveMap
              mapId={mapMatch.id}
              pins={getMergedPins(mapMatch.id)}
              regions={getRegions(mapMatch.id)}
              skipRegistryPins={true}
              currentRoom={adventure.room || 0}
              fogEnabled={true}
              width={isMobile ? '100%' : '244px'} height={isMobile ? '220px' : '200px'}
              addLog={addLog}
            />
          </div>
        );
      }
      return (
        <ParchmentFrame title="Dungeon Map">
          <DungeonMap
            roomCount={Math.max(5, 3 + (adventure.room || 0) * 2)}
            seed={adventure.location?.name?.charCodeAt(0) || 42}
            currentRoom={adventure.room || 0}
            width={isMobile ? 300 : 230} height={isMobile ? 200 : 180}
          />
        </ParchmentFrame>
      );
    }
    if (effectiveType === 'town' && adventure?.location) {
      const mapMatch = mapRegistry.findMapForLocation(adventure?.location?.name || '');
      if (mapMatch && mapRegistry.hasMapImage(mapMatch.id)) {
        return (
          <div style={{ borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,215,0,0.2)' }}>
            <InteractiveMap
              mapId={mapMatch.id}
              pins={getMergedPins(mapMatch.id)}
              regions={getRegions(mapMatch.id)}
              skipRegistryPins={true}
              fogEnabled={false}
              width={isMobile ? '100%' : '244px'} height={isMobile ? '220px' : '200px'}
              showLegend={false}
              addLog={addLog}
            />
          </div>
        );
      }
      return (
        <ParchmentFrame title={adventure.location.name || 'Settlement'}>
          <SettlementMap
            name={adventure.location.name}
            size={adventure.location.terrain === 'city' ? 'large_town' : 'village'}
            seed={adventure.location.name?.charCodeAt(0) || 42}
            width={isMobile ? 300 : 230} height={isMobile ? 200 : 180}
          />
        </ParchmentFrame>
      );
    }
    return null;
  };

  // 2026-04-20 — operator-driven refresh of the context-action suggestion
  // list. Asks the AI for a fresh batch based on the current scene state,
  // discarding any narration text the response carries (we only want the
  // ACTIONS: line). If the AI call fails or returns no suggestions, falls
  // back to the local heuristic so the operator always gets *something*.
  // Useful when the current set doesn't fit the moment — split party,
  // new NPC just walked in, scene tone changed, etc.
  const refreshContextActions = async () => {
    if (narrating || loading) return;
    setNarrating(true);
    try {
      const partyNames = (party || []).map(c => c?.name).filter(Boolean).join(', ');
      const refreshPrompt = `GM TOOL — refresh suggestions only. Do not narrate. Based on the current scene and the party (${partyNames}), produce 4–6 fresh, contextually relevant action suggestions a player might want to take next. When characters are split or doing different things, prefix individual suggestions with the character's name and an em-dash (e.g. "Shadowblade — investigate the still figure"). Output your suggestions on the standard ACTIONS: line, pipe-separated.`;
      const result = await dmEngine.narrate('custom', {
        party,
        encounter: adventure?.location ? {
          name: adventure.location.name,
          description: adventure.location.desc,
          type: adventure.type === 'town' ? 'roleplay' : 'exploration',
        } : null,
        recentLog: (gameLog || []).slice(-15),
      }, refreshPrompt);
      if (result?.suggestedActions && result.suggestedActions.length > 0) {
        setContextActions(result.suggestedActions);
      } else {
        const evt = lastEvent || { type: 'custom', text: '' };
        setContextActions(generateContextActions(evt, adventure, party));
      }
    } catch (_err) {
      const evt = lastEvent || { type: 'custom', text: '' };
      setContextActions(generateContextActions(evt, adventure, party));
    } finally {
      setNarrating(false);
    }
  };

  // Context action buttons renderer
  const renderContextActions = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
        <button
          onClick={refreshContextActions}
          disabled={narrating || loading}
          title="Ask the DM for a fresh set of suggestions based on the current scene"
          style={{
            background: 'transparent',
            color: narrating || loading ? '#4a4a5e' : '#8b949e',
            border: '1px solid #30363d',
            borderRadius: 4,
            padding: '3px 10px',
            fontSize: 11,
            cursor: narrating || loading ? 'not-allowed' : 'pointer',
            opacity: narrating || loading ? 0.5 : 1,
          }}
        >
          {narrating ? '…' : '↻ Refresh suggestions'}
        </button>
      </div>
      {contextActions.length === 0 && (
        <div style={{
          padding: '10px 12px', textAlign: 'center', color: '#6e7681',
          fontSize: 11, fontStyle: 'italic', border: '1px dashed #30363d',
          borderRadius: 4,
        }}>
          No suggestions yet — click ↻ Refresh, or type a custom action below.
        </div>
      )}
      {contextActions.map((ca, idx) => {
        const colors = contextBtnColors[ca.type] || contextBtnColors.neutral;
        const typeIcon = ca.type === 'social' ? '💬' : ca.type === 'skill' ? '🎯' : ca.type === 'combat' ? '⚔️' : ca.type === 'explore' ? '🔍' : '▸';
        return (
          <button
            key={idx}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: isMobile ? '12px 14px' : '7px 10px', backgroundColor: 'rgba(42, 42, 78, 0.6)',
              border: `1px solid ${colors.border}33`, borderLeft: `3px solid ${colors.border}`,
              borderRadius: '6px', cursor: narrating || loading ? 'not-allowed' : 'pointer',
              color: colors.color, fontSize: isMobile ? '14px' : '12px', lineHeight: '1.5',
              textAlign: 'left', width: '100%',
              opacity: narrating || loading ? 0.5 : 1,
              transition: 'background-color 0.15s',
            }}
            onClick={() => handleContextAction(ca)}
            disabled={narrating || loading}
            onMouseEnter={e => { if (!narrating && !loading) e.currentTarget.style.backgroundColor = 'rgba(58, 58, 110, 0.8)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(42, 42, 78, 0.6)'; }}
          >
            <span style={{ flexShrink: 0, fontSize: isMobile ? '16px' : '13px' }}>{typeIcon}</span>
            <span style={{ flex: 1 }}>{ca.action || ca.label}</span>
          </button>
        );
      })}
    </div>
  );

  // #39 — tree-native travel picker. Sections:
  //   1. Ancestors — every named parent up to the root (click to ascend).
  //   2. Siblings — other children of the parent (lateral movement).
  //   3. Children — descend into a known sub-node.
  //   4. Visited elsewhere — any node in the tree that has been visited
  //      (fast-travel across the entire tree).
  //   5. Legacy db.locations (towns, wilderness) — still available as a one-
  //      click fast-travel; picks a node by name if one exists, otherwise
  //      starts a new adventure via legacy startAdventure().
  //   6. Opt-in random roll (the old behavior).
  const renderTravelPicker = () => {
    if (!showTravelPicker) return null;
    const currentName = activeNode?.name || adventure?.location?.name || null;
    const ancestors = worldTree && activePath.length > 1
      ? getBreadcrumb(worldTree, activePath.slice(0, -1))
      : [];
    const siblingsHere = worldTree && activeNode && activeNode.parentId
      ? getChildren(worldTree, activeNode.parentId).filter(n => n.id !== activeNode.id)
      : [];
    const visitedElsewhere = worldTree
      ? getVisitedNodes(worldTree).filter(n => n && !activePath.includes(n.id))
      : [];
    const otherTowns = TOWN_LOCATIONS.filter(t => t.name !== currentName);
    const wilderness = travelDestinations;

    const closePicker = () => setShowTravelPicker(false);

    // Dispatch: if we can resolve the destination to a world-tree node, go
    // there. Otherwise fall back to the legacy adventure dispatch.
    const pickNode = (nodeId) => {
      closePicker();
      if (!worldTree || !nodeId) return;
      const path = findNodePath(worldTree, nodeId);
      if (path && path.length) switchToNodePath(path);
    };
    const pickAncestor = (idx) => {
      closePicker();
      jumpToBreadcrumb(idx);
    };
    const pickLegacy = (type, loc) => {
      closePicker();
      // If a node with the same name already exists, prefer that.
      if (worldTree && loc?.name) {
        const match = Object.values(worldTree.nodes || {}).find(
          n => (n.name || '').toLowerCase() === String(loc.name).toLowerCase()
        );
        if (match) {
          const path = findNodePath(worldTree, match.id);
          if (path && path.length) { switchToNodePath(path); return; }
        }
      }
      // Otherwise legacy adventure launch.
      startAdventure(type, loc || null);
    };
    const terrainIcon = (t) => {
      const s = String(t || '').toLowerCase();
      if (s === 'underground') return '\u{1F573}\uFE0F';
      if (s === 'forest') return '\u{1F332}';
      if (s === 'ruins') return '\u{1F3DB}\uFE0F';
      if (s === 'aquatic' || s === 'swamp' || s === 'coast') return '\u{1F30A}';
      if (s === 'mountain') return '\u{26F0}\uFE0F';
      if (s === 'interior') return '\u{1F3DA}\uFE0F';
      if (s === 'tavern') return '\u{1F37A}';
      if (s === 'city') return '\u{1F3DB}\uFE0F';
      return '\u{1F5FA}\uFE0F';
    };
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 300, padding: '16px',
        }}
        onClick={(e) => { if (e.target === e.currentTarget) closePicker(); }}
      >
        <div
          style={{
            width: '100%', maxWidth: '720px', maxHeight: '90vh',
            backgroundColor: '#12121f', border: '2px solid #7b68ee', borderRadius: '8px',
            color: '#e0d6c2', display: 'flex', flexDirection: 'column',
          }}
        >
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid #7b68ee',
            color: '#b8a8ff', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ fontSize: '18px' }}>{'\u{1F5FA}\uFE0F'}</span>
            <span style={{ flex: 1 }}>
              Where are you traveling to{currentName ? ` from ${currentName}` : ''}?
            </span>
            <button
              onClick={closePicker}
              aria-label="Close"
              style={{
                background: 'transparent', border: 'none', color: '#b8a8ff',
                fontSize: '20px', cursor: 'pointer', padding: '0 6px', lineHeight: 1,
              }}
              title="Cancel (Esc)"
            >
              ×
            </button>
          </div>
          <div style={{ padding: '16px', overflow: 'auto', flex: 1 }}>
            {/* Bug #43 Part A: siblings ("Nearby") come first so Leave Town
                surfaces the most likely destination (another nearby place) at
                the top. Ancestors ("Step out to") are still available, just
                second — stepping up the tree to a region/country is the rarer
                case when leaving a town. */}

            {/* Siblings — lateral movement within parent */}
            {siblingsHere.length > 0 && (
              <>
                <div style={{ color: '#c792ea', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  ↔ Nearby
                </div>
                <div style={{ display: 'grid', gap: '6px', marginBottom: '12px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {siblingsHere.map((sib) => {
                    // Task #63 — disable destroyed/sealed siblings in the picker
                    const sibStatus = getNodeStatus(sib);
                    const sibBlocked = !isNodeTraversable(sib);
                    return (
                      <button
                        key={`sib-${sib.id}`}
                        onClick={() => { if (!sibBlocked) pickNode(sib.id); }}
                        disabled={sibBlocked}
                        style={{
                          padding: '8px 10px', backgroundColor: '#1a1a2e',
                          border: '1px solid rgba(199, 146, 234, 0.3)', borderRadius: '6px',
                          color: '#e0d6c2', textAlign: 'left',
                          cursor: sibBlocked ? 'not-allowed' : 'pointer',
                          opacity: sibBlocked ? 0.5 : 1,
                          textDecoration: sibStatus === NODE_STATUS.DESTROYED ? 'line-through' : 'none',
                        }}
                        title={sibBlocked ? `${sib.name} is ${sibStatus}.` : ''}
                      >
                        <div style={{ color: '#c792ea', fontWeight: 'bold', fontSize: '12px' }}>
                          {KIND_ICON[sib.kind] || '📍'} {sib.name}
                          {sibStatus === NODE_STATUS.SEALED && (
                            <span style={{ color: '#ca8a04', fontSize: '10px', fontWeight: 600, marginLeft: 6 }}>[sealed]</span>
                          )}
                          {sibStatus === NODE_STATUS.DESTROYED && (
                            <span style={{ color: '#dc2626', fontSize: '10px', fontWeight: 600, marginLeft: 6 }}>[destroyed]</span>
                          )}
                        </div>
                        {sib.visitCount > 0 && (
                          <div style={{ fontSize: '10px', color: '#666' }}>visited {sib.visitCount}×</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Ancestors — ascend the tree */}
            {ancestors.length > 0 && (
              <>
                <div style={{ color: '#40e0d0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  ↑ Step out to
                </div>
                <div style={{ display: 'grid', gap: '6px', marginBottom: '12px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {ancestors.map((anc, idx) => (
                    <button
                      key={`anc-${anc.id}`}
                      onClick={() => pickAncestor(idx)}
                      style={{
                        padding: '8px 10px', backgroundColor: '#1a1a2e',
                        border: '1px solid rgba(64, 224, 208, 0.3)', borderRadius: '6px',
                        color: '#e0d6c2', textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <div style={{ color: '#40e0d0', fontWeight: 'bold', fontSize: '12px' }}>
                        {KIND_ICON[anc.kind] || '📍'} {anc.name}
                      </div>
                      {anc.desc && (
                        <div style={{ fontSize: '11px', color: '#8b949e', lineHeight: 1.3 }}>
                          {String(anc.desc).slice(0, 100)}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Visited elsewhere in the tree (fast travel) */}
            {visitedElsewhere.length > 0 && (
              <>
                <div style={{ color: '#7fff00', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Known Places
                </div>
                <div style={{ display: 'grid', gap: '6px', marginBottom: '12px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {visitedElsewhere.slice(0, 24).map((n) => {
                    const path = worldTree ? getBreadcrumb(worldTree, findNodePath(worldTree, n.id)) : [];
                    const crumbStr = path.slice(0, -1).map(p => p.name).join(' › ');
                    return (
                      <button
                        key={`vis-${n.id}`}
                        onClick={() => pickNode(n.id)}
                        style={{
                          padding: '8px 10px', backgroundColor: '#1a1a2e',
                          border: '1px solid rgba(127, 255, 0, 0.2)', borderRadius: '6px',
                          color: '#e0d6c2', textAlign: 'left', cursor: 'pointer',
                        }}
                      >
                        <div style={{ color: '#7fff00', fontWeight: 'bold', fontSize: '12px' }}>
                          {KIND_ICON[n.kind] || '📍'} {n.name}
                        </div>
                        {crumbStr && (
                          <div style={{ fontSize: '10px', color: '#666' }}>{crumbStr}</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Legacy town seeds + db.locations (fallback if not in tree yet) */}
            {otherTowns.length > 0 && (
              <>
                <div style={{ color: '#7fff00', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Known Towns (legacy)
                </div>
                <div style={{
                  display: 'grid', gap: '8px', marginBottom: '14px',
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
                }}>
                  {otherTowns.map((town, idx) => (
                    <button
                      key={`town-${idx}`}
                      onClick={() => pickLegacy('town', town)}
                      style={{
                        padding: '10px', backgroundColor: '#1a1a2e',
                        border: '1px solid rgba(127, 255, 0, 0.3)', borderRadius: '6px',
                        color: '#e0d6c2', textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <div style={{ color: '#7fff00', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>
                        {terrainIcon(town.terrain)} {town.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#8b949e', lineHeight: 1.4 }}>
                        {String(town.desc || '').slice(0, 110)}...
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {wilderness.length > 0 && (
              <>
                <div style={{ color: '#7b68ee', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Wilderness & Dungeons (legacy)
                </div>
                <div style={{
                  display: 'grid', gap: '8px', marginBottom: '14px',
                  gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
                }}>
                  {wilderness.map((loc, idx) => (
                    <button
                      key={`wild-${idx}`}
                      onClick={() => pickLegacy('dungeon', loc)}
                      style={{
                        padding: '10px', backgroundColor: '#1a1a2e',
                        border: '1px solid rgba(123, 104, 238, 0.3)', borderRadius: '6px',
                        color: '#e0d6c2', textAlign: 'left', cursor: 'pointer',
                      }}
                    >
                      <div style={{ color: '#b8a8ff', fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>
                        {terrainIcon(loc.terrain)} {loc.name}
                      </div>
                      <div style={{ fontSize: '11px', color: '#8b949e', lineHeight: 1.4 }}>
                        {String(loc.desc || '').slice(0, 110)}...
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Random fallback — kept but demoted from default */}
            <div style={{
              color: '#888', fontSize: '11px', textTransform: 'uppercase',
              letterSpacing: '0.5px', marginBottom: '6px',
            }}>
              No preference
            </div>
            <button
              onClick={() => pickLegacy('dungeon', null)}
              style={{
                width: '100%', padding: '10px',
                backgroundColor: '#1a1a2e', border: '1px dashed #555',
                borderRadius: '6px', color: '#bbb', textAlign: 'left', cursor: 'pointer',
              }}
              title="Pick a random wilderness/dungeon destination (the old Leave Town behavior)."
            >
              <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '3px' }}>
                🎲 Roll for a random destination
              </div>
              <div style={{ fontSize: '11px', color: '#8b949e' }}>
                Let fate choose — picks a random known location.
              </div>
            </button>
          </div>
          <div style={{
            padding: '10px 16px', borderTop: '1px solid #333',
            display: 'flex', justifyContent: 'flex-end', gap: '8px',
          }}>
            <button
              onClick={closePicker}
              style={{
                padding: '6px 14px', backgroundColor: 'transparent',
                border: '1px solid #555', borderRadius: '4px',
                color: '#aaa', cursor: 'pointer', fontSize: '12px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // #39 — World-tree breadcrumb + children panel. Top strip is the ancestry
  // path. Main card lists direct children of the active node with "+ Add"
  // and per-row rename/remove. Each row shows NPC+item counts (frozen state
  // from last visit) and a visit-count badge.
  //
  // Bug #37 (2026-04-17) — strict parent-child adjacency travel. Previously
  // every ancestor pill was clickable, letting the party teleport from
  // Sandpoint up through Hinterlands → Varisia → Avistan → Golarion in four
  // clicks and end up parked at the world root (a container tier that is
  // never a valid resting place). Fix: only the IMMEDIATE PARENT
  // (idx === breadcrumb.length - 2) is clickable for one-step ascension.
  // Every other ancestor renders as a read-only trail pill (span, not
  // button). Container-kind pills are also always read-only, even when
  // they happen to be the immediate parent — you can't travel TO a world
  // tier, only through it. switchToNodePath's resolveLandingPath cascade
  // is the backstop if a travel call slips past the UI guard.
  const renderBreadcrumbStrip = () => {
    if (!worldTree || breadcrumb.length === 0) return null;
    const lastIdx = breadcrumb.length - 1;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap',
        padding: '4px 8px', marginBottom: '6px',
        backgroundColor: '#1a1a2e',
        border: '1px solid rgba(199, 146, 234, 0.3)',
        borderRadius: '4px',
        fontSize: '11px',
      }}>
        {breadcrumb.map((node, idx) => {
          const isActive = idx === lastIdx;
          const isImmediateParent = idx === lastIdx - 1;
          const isContainer = isContainerKind(node.kind);
          // Only the immediate parent is clickable, and only if it isn't
          // a container tier.
          const clickable = isImmediateParent && !isContainer;
          const pillStyle = {
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '2px 6px',
            backgroundColor: isActive ? 'rgba(199, 146, 234, 0.2)' : 'transparent',
            border: `1px solid ${isActive ? '#c792ea' : '#333'}`,
            color: isActive ? '#e0d6c2' : (clickable ? '#c9bfae' : '#7a7366'),
            borderRadius: '3px',
            fontSize: '11px', lineHeight: 1.3,
          };
          const pillContent = (
            <>
              <span>{KIND_ICON[node.kind] || '📍'}</span>
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
            </>
          );
          let pill;
          if (clickable) {
            pill = (
              <button
                onClick={() => jumpToBreadcrumb(idx)}
                title={`Return to ${node.name}`}
                style={{ ...pillStyle, cursor: 'pointer' }}
              >
                {pillContent}
              </button>
            );
          } else {
            // Read-only trail pill. Ancestors beyond immediate parent and
            // container tiers render as non-interactive spans.
            const title = isActive
              ? 'You are here.'
              : isContainer
                ? `${node.name} (world-tier — not a travel target)`
                : `${node.name} (ascend step-by-step; use picker for other destinations)`;
            pill = (
              <span title={title} style={{ ...pillStyle, cursor: 'default', userSelect: 'none' }}>
                {pillContent}
              </span>
            );
          }
          return (
            <React.Fragment key={node.id}>
              {pill}
              {idx < lastIdx && (
                <span style={{ color: '#666', padding: '0 2px' }}>›</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  const renderWorldTreePanel = () => {
    if (!worldTree || !activeNode) return null;
    return (
      <div style={{
        backgroundColor: '#1a1a2e',
        border: '1px solid rgba(199, 146, 234, 0.3)',
        borderRadius: '4px',
        padding: '6px 8px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          color: '#c792ea', fontSize: '11px', textTransform: 'uppercase',
          letterSpacing: '0.5px', marginBottom: '4px',
        }}>
          <span>{'\u{1F3DB}\uFE0F'}</span>
          <span style={{ flex: 1 }}>Places Here</span>
          {(activeNode.visitCount || 0) > 1 && (
            <span style={{ color: '#888', fontSize: '10px', textTransform: 'none', letterSpacing: 0 }}>
              visit #{activeNode.visitCount}
            </span>
          )}
          {/* Bug #43 Part B: creating/renaming/removing world-tree nodes is
              now GM-only. Operator toggles gmMode (top-bar "GM" chip) to expose
              the edit controls. Infrastructure (createChildAtActive /
              renameActiveChild / removeChildOfActive) is unchanged — just
              hidden from the normal play flow so PCs can't mutate the map. */}
          {gmMode && (
            <button
              onClick={createChildAtActive}
              title={`Add a place inside ${activeNode.name} (room, shop, floor, etc.).`}
              style={{
                padding: '2px 8px', fontSize: '11px',
                backgroundColor: 'transparent', color: '#c792ea',
                border: '1px solid #c792ea', borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              + Add
            </button>
          )}
        </div>

        {/* Parent/back-out row */}
        {activeNode.parentId && (
          <button
            onClick={() => jumpToBreadcrumb(activePath.length - 2)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              width: '100%', padding: '5px 6px', marginBottom: '4px',
              backgroundColor: '#0a0a14',
              border: '1px solid #333',
              borderRadius: '3px',
              color: '#8b949e',
              fontSize: '11px', textAlign: 'left',
              cursor: 'pointer',
            }}
            title={`Step back out to ${worldTree.nodes[activeNode.parentId]?.name || 'the outer area'}`}
          >
            <span>↑</span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Back to {worldTree.nodes[activeNode.parentId]?.name || 'outer area'}
            </span>
          </button>
        )}

        {childrenHere.length === 0 && (
          <div style={{ color: '#666', fontSize: '10px', padding: '4px 2px', fontStyle: 'italic' }}>
            Nothing inside {activeNode.name} yet. Click "+ Add" to create a place (a room, floor, shop, landmark, etc.). Each remembers its own NPCs, items, and visit history.
          </div>
        )}
        {childrenHere.map((child) => {
          const count = (child.npcs?.length || 0) + (child.items?.length || 0);
          const visits = child.visitCount || 0;
          // Task #63 — non-traversable places render strikethrough + dim
          // and the descend button is disabled so the switchToNodePath
          // gate never fires a redundant warning log from Places Here.
          const childStatus = getNodeStatus(child);
          const childBlocked = !isNodeTraversable(child);
          return (
            <div
              key={child.id}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '3px 4px', marginBottom: '2px',
                backgroundColor: '#0a0a14',
                border: '1px solid #333',
                borderRadius: '3px',
                opacity: childBlocked ? 0.55 : 1,
              }}
            >
              <button
                onClick={() => { if (!childBlocked) switchToNodePath([...activePath, child.id]); }}
                disabled={childBlocked}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '2px 4px', backgroundColor: 'transparent', border: 'none',
                  color: childBlocked ? '#6b7280' : '#c9bfae',
                  fontSize: '11px', textAlign: 'left',
                  cursor: childBlocked ? 'not-allowed' : 'pointer',
                  textDecoration: childStatus === NODE_STATUS.DESTROYED ? 'line-through' : 'none',
                }}
                title={childBlocked
                  ? `${child.name} is ${childStatus}. ${childStatus === NODE_STATUS.SEALED ? 'Clear the seal to enter.' : 'This place no longer exists.'}`
                  : `Descend into ${child.name}`}
              >
                <span>{KIND_ICON[child.kind] || '📍'}</span>
                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {child.name}
                </span>
                {childStatus === NODE_STATUS.SEALED && (
                  <span style={{ color: '#ca8a04', fontSize: '9px', fontWeight: 600 }}>[sealed]</span>
                )}
                {childStatus === NODE_STATUS.DESTROYED && (
                  <span style={{ color: '#dc2626', fontSize: '9px', fontWeight: 600 }}>[destroyed]</span>
                )}
                {count > 0 && (
                  <span style={{ color: '#888', fontSize: '10px' }} title={`${child.npcs?.length || 0} NPCs · ${child.items?.length || 0} items (last visit)`}>{count}</span>
                )}
                {visits > 0 && (
                  <span style={{ color: '#666', fontSize: '10px' }} title={`Visited ${visits}×`}>·{visits}</span>
                )}
              </button>
              {/* Bug #43 Part B: rename/remove gated on gmMode — see the
                  "+ Add" button comment above for the scope rationale. */}
              {gmMode && (
                <button
                  onClick={() => renameActiveChild(child.id)}
                  title="Rename"
                  style={{
                    padding: '1px 5px', fontSize: '10px', lineHeight: 1,
                    backgroundColor: 'transparent', color: '#8b949e',
                    border: '1px solid #444', borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                >
                  ✎
                </button>
              )}
              {gmMode && (
                <button
                  onClick={() => removeChildOfActive(child.id)}
                  title="Remove this place (and everything inside)"
                  style={{
                    padding: '1px 6px', fontSize: '11px', lineHeight: 1,
                    backgroundColor: 'transparent', color: '#8b949e',
                    border: '1px solid #444', borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // L3 "Since you were last here" summary callout.
  const renderArrivalSummary = () => {
    if (!arrivalSummary || !Array.isArray(arrivalSummary.events) || arrivalSummary.events.length === 0) return null;
    return (
      <div style={{
        margin: '6px 0',
        padding: '8px 10px',
        backgroundColor: 'rgba(199, 146, 234, 0.08)',
        border: '1px solid rgba(199, 146, 234, 0.4)',
        borderRadius: '4px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          color: '#c792ea', fontSize: '11px', textTransform: 'uppercase',
          letterSpacing: '0.5px', marginBottom: '4px',
        }}>
          <span>⏳</span>
          <span style={{ flex: 1 }}>Since you were last at {arrivalSummary.nodeName}</span>
          <button
            onClick={() => setArrivalSummary(null)}
            title="Dismiss"
            style={{
              padding: '0 6px', fontSize: '12px', lineHeight: 1,
              backgroundColor: 'transparent', color: '#8b949e',
              border: '1px solid #444', borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>
        <ul style={{ margin: 0, paddingLeft: '18px', color: '#c9bfae', fontSize: '11px', lineHeight: 1.5 }}>
          {arrivalSummary.events.slice(0, 10).map((ev, i) => (
            <li key={i} style={{ marginBottom: '2px' }}>
              {ev.nodeName && ev.nodeName !== arrivalSummary.nodeName && (
                <span style={{ color: '#888' }}>({ev.nodeName}) </span>
              )}
              {ev.text}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  // --- MOBILE LAYOUT ---
  if (isMobile) {
    return (
      <div style={styles.container}>
        {/* API Key Banner */}
        <ApiKeyBanner onOpenSettings={() => setTab?.('Settings')} />

        {/* Location header */}
        <div style={{
          flexShrink: 0,
          padding: '10px 14px',
          backgroundColor: '#2a2a4e',
          borderBottom: '1px solid #ffd70033',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ color: '#ffd700', fontSize: '14px', fontWeight: 'bold' }}>
              {adventure?.type === 'town' ? '🏘️' : '⚔️'} {adventure?.location?.name || 'Unknown'}
            </div>
            <div style={{ color: '#8b949e', fontSize: '11px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{adventure?.type === 'town' ? 'Town Adventure' : 'Dungeon Crawl'}</span>
              <CalendarDisplay worldState={worldState} compact />
            </div>
          </div>
          <button
            style={{
              padding: '6px 12px',
              backgroundColor: '#3a1a1a',
              border: '1px solid #ff6b6b',
              color: '#ff6b6b',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
            }}
            onClick={() => { setAdventure(null); setNearbyNPCs([]); setAreaItems([]); setContextActions([]); addLog?.('Adventure ended.', 'system'); }}
          >
            End
          </button>
        </div>

        {/* Breadcrumb strip (#39 world tree) */}
        {worldTree && breadcrumb.length > 0 && (
          <div style={{ flexShrink: 0, padding: '4px 6px' }}>
            {renderBreadcrumbStrip()}
          </div>
        )}

        {/* Scrollable content area */}
        <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Game Log — always visible, takes most space */}
          <div style={{ padding: '6px', minHeight: '250px', maxHeight: '50vh' }}>
            <GameLog logs={gameLog} logRef={logRef} party={party} />
          </div>

          {/* Collapsible sections */}
          <div style={{ padding: '0 6px 6px' }}>
            {/* Context Actions — most important, default open.
                Bug #48: persistKey wires the collapse state through
                localStorage so minimize choices survive reloads. */}
            {contextActions.length > 0 && (
              <CollapsibleSection
                title="What do you do?"
                icon="🎭"
                count={contextActions.length}
                defaultOpen={true}
                persistKey="mobile.contextActions"
                campaignId={campaignScopeKey}
                color="#b8b8ff"
              >
                {renderContextActions()}
              </CollapsibleSection>
            )}

            {/* Map — renderMap() builds a non-trivial JSX tree so we
                compute it once and reuse for both the truthy-gate and
                the rendered child (mirror of the desktop panels IIFE
                from task #52). */}
            {(() => {
              const mapNode = renderMap();
              if (!mapNode) return null;
              return (
                <CollapsibleSection
                  title="Map"
                  icon="🗺️"
                  defaultOpen={false}
                  persistKey="mobile.map"
                  campaignId={campaignScopeKey}
                  color="#ffd700"
                >
                  {mapNode}
                </CollapsibleSection>
              );
            })()}

            {/* Bug #16: NPCs and Area Items were collapsed by default, which
                made the user ask "where are the NPCs on the GUI?" even though
                they existed in state. Open by default when there's anything
                to show — the collapsible chrome still lets the user hide it. */}
            {/* #39 — world tree (nested locations, unlimited depth). */}
            {adventure && worldTree && activeNode && (
              <CollapsibleSection
                title="Places Here"
                icon="🏛️"
                count={childrenHere.length}
                defaultOpen={childrenHere.length > 0 || activePath.length > 1}
                persistKey="mobile.worldTree"
                campaignId={campaignScopeKey}
                color="#c792ea"
              >
                {renderBreadcrumbStrip()}
                {renderWorldTreePanel()}
              </CollapsibleSection>
            )}
            {renderArrivalSummary()}

            {visibleNearbyNPCs.length > 0 && (
              <CollapsibleSection
                title="Nearby NPCs"
                icon="👥"
                count={visibleNearbyNPCs.length}
                defaultOpen={true}
                persistKey="mobile.npcs"
                campaignId={campaignScopeKey}
                color="#40e0d0"
              >
                <NPCPanel npcs={visibleNearbyNPCs} onTalkTo={narrating ? null : handleTalkToNPC} />
              </CollapsibleSection>
            )}

            {/* Area Items panel intentionally removed per
                feedback_items_narrative_first.md (2026-04-18): items
                surface via narrative, no standing shelf. Items still
                persist to `areaItems` via the #59 LLM router + legacy
                ENTITIES tail; the `handleItemInteract` / `handleSurveyHoard`
                paths stay wired for custom-action / PartyActionBar flows. */}
          </div>
        </div>

        {/* Mobile action bar — compact grid */}
        <div style={{
          flexShrink: 0,
          backgroundColor: '#2a2a4e',
          borderTop: '2px solid #ffd70066',
          padding: '8px',
        }}>
          {/* Quick action buttons row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px',
            marginBottom: '8px',
          }}>
            <button
              style={{ ...styles.mobileBtn }}
              onClick={handleExplore}
              disabled={loading || narrating || !party || party.length === 0}
            >
              {loading ? '...' : adventure?.type === 'town' ? '🚶 Walk' : '🔍 Explore'}
            </button>
            <div style={{ position: 'relative' }}>
              <button
                style={{ ...styles.mobileBtn, width: '100%' }}
                onClick={() => setRestType(restType ? null : 'pick')}
                disabled={narrating || !party || party.length === 0}
              >
                🛏️ Rest
              </button>
              {restType === 'pick' && (
                <div style={{
                  position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: '4px',
                  backgroundColor: '#2a2a4e', border: '1px solid #ffd700', borderRadius: '8px',
                  padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 10,
                }}>
                  <button
                    style={{ ...styles.mobileBtn, fontSize: '12px', textAlign: 'left' }}
                    onClick={() => handleRest('short')}
                  >
                    Short Rest (1 hr)
                  </button>
                  <button
                    style={{ ...styles.mobileBtn, fontSize: '12px', textAlign: 'left' }}
                    onClick={() => handleRest('full')}
                  >
                    Full Rest (8 hrs)
                  </button>
                </div>
              )}
            </div>
            {gmMode && (
              <button
                style={{ ...styles.mobileBtn }}
                onClick={handleForceEncounter}
                disabled={loading || narrating || !party || party.length === 0}
                title="GM tool: injects a random CR-appropriate monster into immediate combat. Not a player-facing action."
              >
                ⚔️ Fight (GM)
              </button>
            )}
          </div>
          {/* Travel button */}
          <div style={{ marginBottom: '8px' }}>
            {adventure?.type === 'town' ? (
              <button
                style={{ ...styles.mobileBtn, width: '100%', borderColor: '#7b68ee', color: '#7b68ee' }}
                onClick={openTravelPicker}
                title="Travel anywhere — another district in this town, up to the region/country/world, a known place elsewhere, or an explicit random roll."
              >
                🧭 Travel
              </button>
            ) : (
              <button
                style={{ ...styles.mobileBtn, width: '100%', borderColor: '#7fff00', color: '#7fff00' }}
                onClick={() => startAdventure('town')}
              >
                🏘️ Return to Town
              </button>
            )}
          </div>
          {/* Per-character actions + single Submit (#10) */}
          <PartyActionBar
            party={party}
            narrating={narrating}
            initiallyExpanded={false}
            onSubmitAll={handlePartyCompoundAction}
            perChar={partyPerChar}
            setPerChar={setPartyPerChar}
          />
          {/* Custom action input (single shared) */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              style={{
                flex: 1,
                padding: '12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #ffd70066',
                borderRadius: '8px',
                color: '#e0d6c2',
                fontSize: '14px',
              }}
              placeholder={narrating ? 'DM is speaking...' : 'What do you do?'}
              value={customAction}
              onChange={(e) => setCustomAction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomAction()}
              disabled={narrating}
            />
            <button
              style={{ ...styles.mobileBtn, minWidth: '60px' }}
              onClick={handleCustomAction}
              disabled={!customAction.trim() || narrating}
            >
              {narrating ? '...' : 'Go'}
            </button>
          </div>
          {/* Bug #35 — Undo last action on mobile. Full-width row so it's
              reachable with a thumb after the action submit. */}
          {performUndo && (
            <div style={{ marginTop: '6px' }}>
              <button
                style={{
                  ...styles.mobileBtn,
                  width: '100%',
                  borderColor: '#b0b8e0',
                  color: undoDepth > 0 && !narrating ? '#b0b8e0' : '#4a4a5e',
                  opacity: undoDepth > 0 && !narrating ? 1 : 0.55,
                  cursor: undoDepth > 0 && !narrating ? 'pointer' : 'not-allowed',
                }}
                onClick={performUndo}
                disabled={undoDepth === 0 || narrating}
                title={
                  undoDepth === 0
                    ? 'Nothing to undo'
                    : narrating
                    ? 'Wait for the DM to finish before undoing'
                    : `Undo last action (${undoDepth} step${undoDepth === 1 ? '' : 's'} available)`
                }
              >
                {`\u21B6 Undo Last Action${undoDepth > 0 ? ` (${undoDepth})` : ''}`}
              </button>
            </div>
          )}
        </div>
        {renderTravelPicker()}
      </div>
    );
  }

  // --- DESKTOP LAYOUT ---
  return (
    <div style={styles.container}>
      {/* API Key Banner */}
      <ApiKeyBanner onOpenSettings={() => setTab?.('Settings')} />

      {/* Calendar / world clock — Bug #15 first slice */}
      <div style={{ flexShrink: 0, padding: '4px 10px', display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid rgba(255,215,0,0.08)' }}>
        <CalendarDisplay worldState={worldState} />
      </div>

      {/* Breadcrumb strip (#39 world tree) */}
      {worldTree && breadcrumb.length > 0 && (
        <div style={{ flexShrink: 0, padding: '4px 10px', borderBottom: '1px solid rgba(199, 146, 234, 0.12)' }}>
          {renderBreadcrumbStrip()}
        </div>
      )}

      {/* Arrival summary callout (L3 "Since you were last here") */}
      <div style={{ flexShrink: 0, padding: arrivalSummary ? '0 10px' : 0 }}>
        {renderArrivalSummary()}
      </div>

      {/* Main content: dockable grid of Game Log + side panels.
          Bug #48 follow-up (grid spike, 2026-04-18) — the legacy fixed
          log + vertical-splitter + sidebar layout is replaced with a
          react-grid-layout grid. Each tile (log / map / worldTree /
          npcs) is draggable by its header (`.adv-grid-handle`) and
          resizable from its bottom-right corner. Layout persists per
          campaign under `pf-adventure-layout.<scopeKey>.gridLayout.v1`.
          Area Items intentionally omitted per
          feedback_items_narrative_first.md (2026-04-18): items should
          be acted on from the narrative, not listed in a standing shelf. */}
      {(() => {
        const panels = [];
        // Game Log tile — always present. The log has its own internal
        // scroll; the tile just provides the draggable frame + handle.
        panels.push({
          key: 'log',
          element: (
            <>
              <div
                className="adv-grid-handle"
                style={{
                  cursor: 'move',
                  padding: '8px 12px',
                  backgroundColor: '#2a2a5e',
                  borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
                  color: '#ffd700',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexShrink: 0,
                }}
              >
                <span>📜</span>
                <span>Game Log</span>
              </div>
              <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', padding: '6px' }}>
                <GameLog logs={gameLog} logRef={logRef} party={party} />
              </div>
            </>
          ),
        });
        // Compute once — renderMap() builds a non-trivial JSX tree
        // (InteractiveMap / DungeonMap / ParchmentFrame) and AdventureTab
        // re-renders on many state updates, so don't call it twice.
        const mapNode = renderMap();
        if (mapNode) {
          panels.push({
            key: 'map',
            element: (
              <CollapsibleSection
                title="Map"
                icon="🗺️"
                defaultOpen={true}
                persistKey="grid.map"
                campaignId={campaignScopeKey}
                color="#ffd700"
                dragHandleClassName="adv-grid-handle"
              >
                {mapNode}
              </CollapsibleSection>
            ),
          });
        }
        if (adventure && worldTree && activeNode) {
          panels.push({
            key: 'worldTree',
            element: (
              <CollapsibleSection
                title="Places Here"
                icon="🏛️"
                count={childrenHere.length}
                defaultOpen={true}
                persistKey="grid.worldTree"
                campaignId={campaignScopeKey}
                color="#c792ea"
                dragHandleClassName="adv-grid-handle"
              >
                {renderWorldTreePanel()}
              </CollapsibleSection>
            ),
          });
        }
        if (visibleNearbyNPCs.length > 0) {
          panels.push({
            key: 'npcs',
            element: (
              <CollapsibleSection
                title="Nearby NPCs"
                icon="👥"
                count={visibleNearbyNPCs.length}
                defaultOpen={true}
                persistKey="grid.npcs"
                campaignId={campaignScopeKey}
                color="#40e0d0"
                dragHandleClassName="adv-grid-handle"
              >
                <NPCPanel npcs={visibleNearbyNPCs} onTalkTo={narrating ? null : handleTalkToNPC} />
              </CollapsibleSection>
            ),
          });
        }
        return (
          <AdventureGrid
            scopeKey={campaignScopeKey || '__default'}
            panels={panels}
            onResetLayout={() => {
              clearAdventureGridLayout(campaignScopeKey || '__default');
              // Force a remount by bumping the grid's scopeKey via the
              // parent — cheapest path: full-page reload is overkill,
              // but in practice the user triggers Reset rarely and the
              // AdventureGrid's `useMemo([scopeKey, activeKeys])` already
              // picks up the new defaults on next render. A state kick
              // here keeps the behavior explicit.
              setGridLayoutVersion(v => v + 1);
            }}
            key={`advgrid-${campaignScopeKey || '__default'}-${gridLayoutVersion}`}
          />
        );
      })()}

      {/* Contextual action choices.
          2026-04-20: removed the `contextActions.length > 0` outer gate
          so the panel (and its Refresh button) stays visible even when
          the suggestion list is empty. Without this, the operator could
          end up with no suggestions and no way to ask for more — the
          previous gate hid the entire panel including the refresh
          control. renderContextActions handles the empty case
          gracefully with a placeholder. */}
      <div style={{ flexShrink: 0, padding: '6px 8px', borderTop: '1px solid rgba(255, 215, 0, 0.2)', maxHeight: '160px', overflowY: 'auto' }}>
        <div style={{ fontSize: '10px', color: '#8b949e', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>What do you do?</div>
        {renderContextActions()}
      </div>

      {/* Per-character actions + single Submit (#10) */}
      <div style={{ flexShrink: 0, padding: '0 8px' }}>
        <PartyActionBar
          party={party}
          narrating={narrating}
          initiallyExpanded={true}
          onSubmitAll={handlePartyCompoundAction}
          perChar={partyPerChar}
          setPerChar={setPartyPerChar}
        />
      </div>

      {/* Main action bar */}
      <div style={styles.actionBar}>
        <button
          style={styles.button}
          onClick={handleExplore}
          disabled={loading || narrating || !party || party.length === 0}
        >
          {loading ? '...' : adventure?.type === 'town' ? 'Walk Around' : 'Explore'}
        </button>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button
            style={styles.button}
            onClick={() => setRestType(restType ? null : 'pick')}
            disabled={narrating || !party || party.length === 0}
          >
            Rest
          </button>
          {restType === 'pick' && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
              backgroundColor: '#2a2a4e', border: '1px solid #ffd700', borderRadius: '6px',
              padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 10, minWidth: '160px',
            }}>
              <button
                style={{ ...styles.button, fontSize: '11px', padding: '8px', textAlign: 'left', width: '100%' }}
                onClick={() => handleRest('short')}
              >
                Short Rest (1 hr)
                <div style={{ fontSize: '9px', color: '#8b949e', fontWeight: 'normal', marginTop: '2px' }}>Catch breath, no HP recovery</div>
              </button>
              <button
                style={{ ...styles.button, fontSize: '11px', padding: '8px', textAlign: 'left', width: '100%' }}
                onClick={() => handleRest('full')}
              >
                Full Rest (8 hrs)
                <div style={{ fontSize: '9px', color: '#8b949e', fontWeight: 'normal', marginTop: '2px' }}>Heal 1 HP/level, recover spells</div>
              </button>
            </div>
          )}
        </div>
        {gmMode && (
          <button
            style={styles.button}
            onClick={handleForceEncounter}
            disabled={loading || narrating || !party || party.length === 0}
            title="GM tool: injects a random CR-appropriate monster into immediate combat. Not a player-facing action."
          >
            Force Encounter (GM)
          </button>
        )}
        {adventure?.type === 'town' && (
          <button
            style={{ ...styles.button, borderColor: '#7b68ee', color: '#7b68ee' }}
            onClick={openTravelPicker}
            title="Travel anywhere — another district in this town, up to the region/country/world, a known place elsewhere, or an explicit random roll."
          >
            Travel
          </button>
        )}
        {adventure?.type === 'dungeon' && (
          <button
            style={{ ...styles.button, borderColor: '#7fff00', color: '#7fff00' }}
            onClick={() => { startAdventure('town'); }}
          >
            Return to Town
          </button>
        )}
        <button
          style={{ ...styles.button, borderColor: '#ff6b6b', color: '#ff6b6b' }}
          onClick={() => { setAdventure(null); setNearbyNPCs([]); setAreaItems([]); setContextActions([]); addLog?.('Adventure ended.', 'system'); }}
        >
          End
        </button>
        {/* Bug #35 — Undo last action. Disabled when nothing to undo OR
            while a narrate is in flight (rolling back state mid-request
            would get clobbered when the pending narrate resolves). */}
        {performUndo && (
          <button
            style={{
              ...styles.button,
              borderColor: '#b0b8e0',
              color: undoDepth > 0 && !narrating ? '#b0b8e0' : '#4a4a5e',
              opacity: undoDepth > 0 && !narrating ? 1 : 0.55,
              cursor: undoDepth > 0 && !narrating ? 'pointer' : 'not-allowed',
            }}
            onClick={performUndo}
            disabled={undoDepth === 0 || narrating}
            title={
              undoDepth === 0
                ? 'Nothing to undo'
                : narrating
                ? 'Wait for the DM to finish before undoing'
                : `Undo last action (${undoDepth} step${undoDepth === 1 ? '' : 's'} available)`
            }
          >
            {`\u21B6 Undo${undoDepth > 0 ? ` (${undoDepth})` : ''}`}
          </button>
        )}
        <input
          type="text"
          style={styles.input}
          placeholder={narrating ? 'The DM is responding...' : 'Custom action...'}
          value={customAction}
          onChange={(e) => setCustomAction(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCustomAction()}
          disabled={narrating}
        />
        <button
          style={styles.button}
          onClick={handleCustomAction}
          disabled={!customAction.trim() || narrating}
        >
          {narrating ? '...' : 'Do'}
        </button>
      </div>

      {/* Floating note-for-Claude button moved to App.jsx so it's available on
          every screen (character creator, settings, etc.), not just Adventure. */}
      {renderTravelPicker()}
    </div>
  );
}
