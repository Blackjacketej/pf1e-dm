import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import overlandService from '../services/overlandService';
import { ParchmentFrame, TerrainIcon } from './MapAssets';
import InteractiveMap from './InteractiveMap';
import mapRegistry from '../services/mapRegistry';
import { pixelToHex, hexCenter, TERRAIN_COLORS, HEX_TAGS, getTagInfo, parseHexValue, getAdjacentHexKeys } from './HexGridOverlay';
import { checkForaging, checkHunting, waterCollection, getHexExplorationTime, exploreCurrentHex } from '../services/overlandService';
import { generateDailyWeather, generateEncounter, advanceHexCrawlDay } from '../services/hexCrawlService';
import { getVisitedPoisForMap, locationSlug } from '../services/locationTracker';
import { findSettlementAncestor, DEFAULT_PARTY_ID } from '../services/worldTree';
import { getHexConfig } from '../services/hexConfig';

const catIcons = {
  temple: '\u2720', tavern: '\u{1F37A}', shop: '\u{1F6CD}', government: '\u{1F6E1}', craft: '\u{1F528}',
  industry: '\u2699', noble: '\u{1F451}', residence: '\u{1F3E0}', entertainment: '\u2B50', school: '\u{1F4DA}',
  landmark: '\u{1F6A9}', ruin: '\u{1F5FC}', dungeon: '\u{1F480}', encounter: '\u2694', camp: '\u{1F525}', city: '\u{1F3F0}'
};

// Per-map hex configuration moved to src/services/hexConfig.js as part of
// Task #84 (2026-04-19) so MapTab + GMMapPinEditor + overlandTravel share a
// single source of truth. Call getHexConfig(mapId) below — values match the
// prior inline copy (Sandpoint Hinterlands: 1mi/hex × 25mi, Varisia region:
// 12mi/hex × 350mi, fallback: 2mi/hex × 25mi).

const styles = {
  container: { display: 'flex', height: '100%', color: '#d4c5a9', fontFamily: 'inherit' },
  mapArea: { flex: 1, position: 'relative', overflow: 'hidden', background: '#0d1117' },
  sidebar: (isOpen, isMobile) => ({
    width: isMobile ? '100%' : '300px',
    backgroundColor: '#1a1a2e',
    borderLeft: '2px solid #ffd700',
    overflowY: 'auto',
    padding: '12px',
    flexShrink: 0,
    position: isMobile ? 'absolute' : 'relative',
    height: isMobile ? '100%' : 'auto',
    zIndex: isMobile ? 100 : 'auto',
    display: isMobile && !isOpen ? 'none' : 'flex',
    flexDirection: 'column',
  }),
  title: { color: '#ffd700', fontWeight: 'bold', fontSize: '13px', textTransform: 'uppercase', marginBottom: '8px' },
  subtitle: { color: '#ffd700', fontSize: '11px', marginBottom: '6px', fontWeight: '600' },
  btn: { padding: '5px 10px', border: '1px solid #ffd700', borderRadius: '4px', backgroundColor: '#2a2a4e', color: '#ffd700', cursor: 'pointer', fontSize: '11px', marginRight: '4px', marginBottom: '4px' },
  btnActive: { backgroundColor: '#ffd700', color: '#1a1a2e' },
  card: { backgroundColor: '#2a2a4e', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '4px', padding: '8px', marginBottom: '6px', fontSize: '11px' },
  label: { color: '#8b949e', fontSize: '10px', textTransform: 'uppercase' },
  value: { color: '#d4c5a9', fontWeight: 'bold' },
  statRow: { display: 'flex', justifyContent: 'space-between', padding: '2px 0' },
};

export default function MapTab({ party, campaign, adventure = null, addLog, worldState, setWorldState, gmMode, onOpenJournalLocation = null }) {
  const isMobile = useIsMobile();

  // Bug #66 (2026-04-18) — overland/hex interactions are locked when the
  // party is physically inside a town, city, village, building, floor, or
  // room in the world tree. Live session report: operator was in Sandpoint
  // and could still pan+click the regional hex map (moving worldState.partyHex
  // around) while Adventure chat state stayed in Sandpoint — a disconnect
  // between the settlement scope and the overland scope. Rule: hex travel
  // only works once the party has left the settlement (via "Leave Town" in
  // AdventureTab). While inside, the map is browsable (pan/zoom/pin info)
  // but movement + exploration + foraging/hunting/water are all blocked.
  const settlementGate = useMemo(() => {
    if (!adventure || !adventure.worldTree) return null;
    const activeId = adventure.activeParty || DEFAULT_PARTY_ID;
    const path = adventure.parties?.[activeId]?.currentPath || [];
    const ancestor = findSettlementAncestor(adventure.worldTree, path);
    if (!ancestor) return null;
    return { active: true, node: ancestor, locationName: ancestor.name || 'this settlement' };
  }, [adventure]);
  const isGated = !!settlementGate?.active;
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showHexGrid, setShowHexGrid] = useState(true);
  const [selectedHex, setSelectedHex] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [hexTravelLog, setHexTravelLog] = useState([]);
  const [currentWeatherLocal, setCurrentWeatherLocal] = useState(null);
  const [lastEncounter, setLastEncounter] = useState(null);
  const [visitedPoiIds, setVisitedPoiIds] = useState(new Set());
  const mapRef = useRef(null);

  // Get the party hex from worldState
  const partyHex = worldState?.partyHex || null;
  const exploredHexes = useMemo(() => new Set(worldState?.exploredHexes || []), [worldState?.exploredHexes]);
  const hexExploring = worldState?.hexExploring || null;

  // Ref so callbacks defined before the useMemo can access hexTerrainData safely
  const hexTerrainDataRef = useRef(null);

  // Auto-initialize party hex if not set (computed after hexTerrainData is available)
  const needsInit = useRef(!partyHex);

  // Internal hex-placement helper — positions the party marker + records
  // weather/explored state without logging a "party moves" narration. Used
  // by the auto-init useEffect (first-mount placement) and by the gated
  // movePartyToHex below. Silent=true skips the move narration, which is
  // what init wants (there's no player-initiated movement to narrate).
  const setPartyHexInternal = useCallback((hexKey, { silent = false } = {}) => {
    setWorldState(prev => {
      const newExplored = new Set(prev.exploredHexes || []);
      newExplored.add(hexKey);
      return {
        ...prev,
        partyHex: hexKey,
        exploredHexes: [...newExplored],
      };
    });
    const hexData = hexTerrainDataRef.current?.get(hexKey);
    const terrain = hexData?.terrain || 'plains';
    if (!silent) {
      const logEntry = { time: `Day ${worldState?.currentDay || 1}`, text: `Party enters hex ${hexKey} (${terrain})`, type: 'move' };
      setHexTravelLog(prev => [...prev, logEntry]);
      addLog?.(`Party moves to hex ${hexKey} — ${terrain} terrain`, 'narration');
    }
    // Generate weather for current day when entering new hex
    const w = generateDailyWeather(terrain, worldState?.currentDay || 1);
    setCurrentWeatherLocal(w);
    setWorldState(prev => ({ ...prev, currentWeather: w }));
  }, [setWorldState, worldState?.currentDay, addLog]);

  // Move party to a hex. Bug #66 — short-circuits when inside a settlement.
  const movePartyToHex = useCallback((hexKey) => {
    if (isGated) {
      addLog?.(`Your party is inside ${settlementGate.locationName}. Leave town before traveling the hex map.`, 'warning');
      return;
    }
    setPartyHexInternal(hexKey);
  }, [setPartyHexInternal, addLog, isGated, settlementGate]);

  // Start exploring current hex
  const startExploreHex = useCallback(() => {
    if (isGated) {
      addLog?.(`Your party is inside ${settlementGate.locationName}. Leave town before exploring the wilderness.`, 'warning');
      return;
    }
    if (!partyHex) return;
    const hexData = hexTerrainDataRef.current?.get(partyHex);
    const terrain = hexData?.terrain || 'plains';
    const speed = party.length > 0 ? overlandService.getPartySpeed(party) : 30;
    const explTime = getHexExplorationTime(terrain, speed);

    setWorldState(prev => ({
      ...prev,
      hexExploring: partyHex,
      hexExplorationDaysLeft: explTime.adjustedDays,
    }));
    const logEntry = { time: `Day ${worldState?.currentDay || 1}`, text: `Begin exploring hex ${partyHex} (${terrain}) — ${explTime.adjustedDays} days needed`, type: 'explore' };
    setHexTravelLog(prev => [...prev, logEntry]);
    addLog?.(`Party begins exploring this hex. Estimated ${explTime.adjustedDays} day(s) to fully explore.`, 'narration');
  }, [partyHex, party, setWorldState, worldState?.currentDay, addLog, isGated, settlementGate]);

  // Advance one day of exploration
  const advanceExploreDay = useCallback(() => {
    if (!hexExploring) return;
    const hexData = hexTerrainDataRef.current?.get(hexExploring);
    const terrain = hexData?.terrain || 'plains';
    const daysLeft = (worldState?.hexExplorationDaysLeft || 1) - 1;
    const newEntries = [];

    // Advance day counter
    const newDay = (worldState?.currentDay || 1) + 1;

    // Generate daily weather
    const weather = generateDailyWeather(terrain, newDay);
    setCurrentWeatherLocal(weather);
    setWorldState(prev => ({ ...prev, currentWeather: weather }));
    newEntries.push({ time: `Day ${newDay}`, text: weather.description + ` (${weather.temperatureF}°F)`, type: 'weather' });

    if (daysLeft <= 0) {
      // Exploration complete
      newEntries.push({ time: `Day ${newDay}`, text: `Exploration of hex ${hexExploring} complete!`, type: 'explore' });
      addLog?.(`Hex ${hexExploring} fully explored! All points of interest discovered.`, 'narration');
      setWorldState(prev => ({
        ...prev,
        hexExploring: null,
        hexExplorationDaysLeft: 0,
        currentDay: newDay,
      }));
    } else {
      newEntries.push({ time: `Day ${newDay}`, text: `Exploring ${hexExploring}... ${daysLeft} day(s) remaining`, type: 'explore' });
      setWorldState(prev => ({
        ...prev,
        hexExplorationDaysLeft: daysLeft,
        currentDay: newDay,
      }));
    }

    // CR-appropriate encounter check from monster database
    const partyLevel = Math.max(1, ...party.map(c => c.level || 1));
    generateEncounter(terrain, partyLevel).then(enc => {
      if (enc.encountered) {
        setLastEncounter(enc);
        const encEntry = { time: `Day ${newDay}`, text: enc.description, type: 'encounter' };
        setHexTravelLog(prev => [...prev, encEntry]);
        addLog?.(enc.description, 'danger');
      }
    });

    setHexTravelLog(prev => [...prev, ...newEntries]);
  }, [hexExploring, worldState, setWorldState, party, addLog]);

  // Forage in current hex
  const handleForage = useCallback(() => {
    if (isGated) {
      addLog?.(`Your party is inside ${settlementGate.locationName}. Leave town before foraging the wilds.`, 'warning');
      return;
    }
    if (!partyHex || party.length === 0) return;
    const hexData = hexTerrainDataRef.current?.get(partyHex);
    const terrain = hexData?.terrain || 'plains';
    const forager = party[0]; // party leader forages
    const result = checkForaging(forager, terrain);
    const entry = { time: `Day ${worldState?.currentDay || 1}`, text: result.description, type: result.success ? 'info' : 'encounter' };
    setHexTravelLog(prev => [...prev, entry]);
    addLog?.(result.description, result.success ? 'success' : 'danger');
  }, [partyHex, party, worldState?.currentDay, addLog, isGated, settlementGate]);

  // Hunt in current hex
  const handleHunt = useCallback(() => {
    if (isGated) {
      addLog?.(`Your party is inside ${settlementGate.locationName}. Leave town before hunting the wilds.`, 'warning');
      return;
    }
    if (!partyHex || party.length === 0) return;
    const hexData = hexTerrainDataRef.current?.get(partyHex);
    const terrain = hexData?.terrain || 'plains';
    const hunter = party[0];
    const result = checkHunting(hunter, terrain);
    const entry = { time: `Day ${worldState?.currentDay || 1}`, text: result.description, type: result.success ? 'info' : 'encounter' };
    setHexTravelLog(prev => [...prev, entry]);
    addLog?.(result.description, result.success ? 'success' : 'danger');
  }, [partyHex, party, worldState?.currentDay, addLog, isGated, settlementGate]);

  // Find water
  const handleFindWater = useCallback(() => {
    if (isGated) {
      addLog?.(`Your party is inside ${settlementGate.locationName}. Leave town before gathering water in the wilds.`, 'warning');
      return;
    }
    if (!partyHex || party.length === 0) return;
    const hexData = hexTerrainDataRef.current?.get(partyHex);
    const terrain = hexData?.terrain || 'plains';
    const searcher = party[0];
    const result = waterCollection(searcher, terrain);
    const entry = { time: `Day ${worldState?.currentDay || 1}`, text: result.description, type: result.success ? 'info' : 'encounter' };
    setHexTravelLog(prev => [...prev, entry]);
    addLog?.(result.description, result.success ? 'success' : 'danger');
  }, [partyHex, party, worldState?.currentDay, addLog, isGated, settlementGate]);

  const locations = useMemo(() => overlandService.getLocations(), []);
  const mapSettings = useMemo(() => overlandService.getMapSettings(), []);

  // Determine which map to show (Journal "View on map" can override via mapFocus)
  const partyLocId = worldState?.partyPosition?.locationId;
  const mapFocus = worldState?.mapFocus || null;
  const activeMapId = useMemo(() => {
    if (mapFocus?.mapId) return mapFocus.mapId;
    const mapEntry = mapRegistry.getOverlandMap(partyLocId ? String(partyLocId) : 'sandpoint');
    return mapEntry?.id || 'sandpoint_hinterlands';
  }, [partyLocId, mapFocus?.mapId]);

  // Load visited POI set whenever the active map changes. Refreshes also when
  // party position changes (which is how a new visit typically gets recorded).
  useEffect(() => {
    let cancelled = false;
    getVisitedPoisForMap(activeMapId).then(set => { if (!cancelled) setVisitedPoiIds(set); });
    return () => { cancelled = true; };
  }, [activeMapId, partyLocId]);

  // When Journal requests a focus, resolve + select that pin once.
  const lastFocusRef = useRef(null);
  useEffect(() => {
    if (!mapFocus?.at || mapFocus.at === lastFocusRef.current) return;
    lastFocusRef.current = mapFocus.at;
    if (!mapFocus.poiId) return;
    const pin = (mapRegistry.getMap(mapFocus.mapId)?.poi || []).find(p => p.id === mapFocus.poiId);
    if (pin) {
      const loc = locations.find(l => String(l.id) === pin.id || l.name === pin.label);
      if (loc) setSelectedLocation(loc);
      // Pan/zoom to the pin — defer so InteractiveMap has had a render with the
      // (possibly new) mapId. Without the delay, the ref may still point at a
      // map whose image hasn't loaded and focusPin silently no-ops.
      setTimeout(() => { mapRef.current?.focusPin?.(pin.xPct, pin.yPct, 2.2); }, 150);
      addLog?.(`Focusing map on ${pin.label}`, 'info');
    }
  }, [mapFocus, locations, addLog]);

  // Per-map hex config (Task #84 — shared service).
  const hexConfig = getHexConfig(activeMapId);
  const HEX_SIZE_MILES = hexConfig.hexSizeMiles;
  const MAP_WIDTH_MILES = hexConfig.mapWidthMiles;

  // Build merged pins (registry + GM custom + overrides - hidden)
  const mergedPins = useMemo(() => {
    const overrides = worldState?.gmPinOverrides || {};
    const hidden = new Set((worldState?.gmHiddenPins || {})[activeMapId] || []);
    const customPins = (worldState?.gmPins || {})[activeMapId] || [];
    const mapData = mapRegistry.getMap(activeMapId);
    const mapOverrides = overrides[activeMapId] || {};
    const registryPins = (mapData?.poi || [])
      .filter(p => !hidden.has(p.id))
      .map(p => ({
        id: p.id, label: p.label, type: p.type,
        xPct: mapOverrides[p.id]?.xPct ?? p.xPct,
        yPct: mapOverrides[p.id]?.yPct ?? p.yPct,
      }));
    const custom = customPins.map(p => ({
      id: p.id, label: p.label, type: p.type, xPct: p.xPct, yPct: p.yPct,
    }));
    return [...registryPins, ...custom];
  }, [activeMapId, worldState?.gmPinOverrides, worldState?.gmHiddenPins, worldState?.gmPins]);

  const mapRegions = useMemo(() => {
    return (worldState?.gmRegions || {})[activeMapId] || [];
  }, [activeMapId, worldState?.gmRegions]);

  // GM hex terrain overrides
  const gmHexTerrain = (worldState?.gmHexTerrain || {})[activeMapId] || {};

  // Build hex terrain data (region auto-detect + GM overrides + location mapping)
  const hexTerrainData = useMemo(() => {
    if (!showHexGrid) return null;
    const data = new Map();
    const regions = overlandService.getRegions();
    const allLocations = overlandService.getLocations();
    const imgW = mapSettings.bounds?.width || 1200;
    const imgH = mapSettings.bounds?.height || 900;
    const hexSizePx = (HEX_SIZE_MILES / MAP_WIDTH_MILES) * imgW;
    const w = hexSizePx * 2;
    const h = Math.sqrt(3) * hexSizePx;
    const cols = Math.ceil(imgW / (w * 0.75)) + 2;
    const rows = Math.ceil(imgH / h) + 2;

    const locationsByHex = {};
    for (const loc of allLocations) {
      const hexInfo = pixelToHex(loc.x, loc.y, hexSizePx);
      if (!locationsByHex[hexInfo.key]) locationsByHex[hexInfo.key] = [];
      locationsByHex[hexInfo.key].push(loc);
    }

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const key = `${c},${r}`;
        const center = hexCenter(c, r, hexSizePx);
        const hexLocations = locationsByHex[key] || [];

        // GM override — may be "forest", "forest/coastal", or "forest/coastal|road,river"
        if (gmHexTerrain[key]) {
          const parsed = parseHexValue(gmHexTerrain[key]);
          const label = parsed.terrain2 ? `${parsed.terrain}/${parsed.terrain2}` : parsed.terrain;
          data.set(key, {
            terrain: parsed.terrain,
            terrain2: parsed.terrain2,
            tags: parsed.tags,
            label,
            locations: hexLocations,
          });
          continue;
        }

        const region = regions.find(reg =>
          center.x >= reg.bounds.x && center.x <= reg.bounds.x + reg.bounds.w &&
          center.y >= reg.bounds.y && center.y <= reg.bounds.y + reg.bounds.h
        );

        let terrain = region?.terrain || null;
        let label = region?.name || null;
        const hasSettlement = hexLocations.some(l =>
          ['government', 'tavern', 'shop', 'temple', 'noble', 'residence', 'craft', 'industry', 'school', 'entertainment'].includes(l.category)
        );

        if (hasSettlement && hexLocations.length >= 3) {
          terrain = 'urban';
          label = hexLocations[0].name;
        } else if (hexLocations.length > 0 && !terrain) {
          terrain = 'plains';
          label = hexLocations[0].name;
        }

        if (terrain) {
          data.set(key, { terrain, label, locations: hexLocations });
        } else if (hexLocations.length > 0) {
          data.set(key, { terrain: 'plains', label: hexLocations[0].name, locations: hexLocations });
        }
      }
    }
    return data;
  }, [showHexGrid, mapSettings, gmHexTerrain, activeMapId]);

  // Keep ref in sync so callbacks defined earlier can access hexTerrainData
  hexTerrainDataRef.current = hexTerrainData;

  // Resolve which hex SHOULD contain the party's current top-level location.
  // Centralized so auto-init AND the inside-town heal effect agree on what
  // the "correct" hex is. Returns null when we don't have enough info to
  // pick (no terrain data, no resolvable pin, etc.) — callers must no-op.
  const resolveCurrentLocationHex = useCallback(() => {
    if (!hexTerrainData || hexTerrainData.size === 0) return null;
    const imgW = mapSettings.bounds?.width || 1200;
    const imgH = mapSettings.bounds?.height || 900;
    const hexSizePx = (HEX_SIZE_MILES / MAP_WIDTH_MILES) * imgW;

    // Pin resolution priority:
    //   1. Exact id match against worldState.partyPosition.locationId
    //   2. Fuzzy 'sandpoint' match (RotRL campaign home fallback)
    //   3. First pin of type 'town' / 'city' on the active map
    //   4. Map center
    const targetId = partyLocId ? String(partyLocId) : 'sandpoint';
    let pin = mergedPins.find(p => String(p.id) === targetId);
    if (!pin) {
      pin = mergedPins.find(p =>
        /sandpoint/i.test(String(p.id || '')) || /sandpoint/i.test(String(p.label || ''))
      );
    }
    if (!pin) {
      pin = mergedPins.find(p => p.type === 'town' || p.type === 'city');
    }

    let px, py;
    if (pin && typeof pin.xPct === 'number' && typeof pin.yPct === 'number') {
      px = (pin.xPct / 100) * imgW;
      py = (pin.yPct / 100) * imgH;
    } else {
      px = imgW / 2;
      py = imgH / 2;
    }

    return pixelToHex(px, py, hexSizePx);
  }, [hexTerrainData, mapSettings, HEX_SIZE_MILES, MAP_WIDTH_MILES, mergedPins, partyLocId]);

  // Auto-initialize party hex when map first loads and no position is set.
  // Bug #53: the old hardcoded (500, 370) was for sandpointMap.json's LOCAL
  // coordinate system (the Cathedral pixel), but the default active map on
  // game boot is `sandpoint_hinterlands`, whose Sandpoint pin sits at
  // xPct=50, yPct=28 = pixel (600, 252) on the same 1200×900 canvas. Result:
  // the party token rendered in a hex ~150px away from the Sandpoint pin.
  useEffect(() => {
    if (!needsInit.current || partyHex) return;
    const startHex = resolveCurrentLocationHex();
    if (!startHex) return;
    setPartyHexInternal(startHex.key, { silent: true });
    needsInit.current = false;
  }, [resolveCurrentLocationHex, partyHex, setPartyHexInternal]);

  // 2026-04-20 — heal stale `partyHex` when gated inside a settlement.
  // Background: the auto-init effect only runs when partyHex is null.
  // Operators with saves from before the pixelToHex/hexCenter convention fix
  // (or from earlier auto-init logic) have a persisted `partyHex` that
  // doesn't correspond to the town's actual POI hex — symptom is the marker
  // floating in a wrong hex while the breadcrumb says "Sandpoint." When the
  // party is gated inside a settlement (locationId === a town POI), the
  // marker should categorically be on that town's hex, so we resnap to
  // heal the persisted value. Once the party leaves town, gating turns off
  // and this effect stops triggering — overland movement is then the only
  // thing that mutates partyHex.
  useEffect(() => {
    if (!isGated || !partyHex) return;
    const target = resolveCurrentLocationHex();
    if (!target) return;
    if (target.key === partyHex) return;
    setPartyHexInternal(target.key, { silent: true });
  }, [isGated, partyHex, resolveCurrentLocationHex, setPartyHexInternal]);

  // Hex click — show info about the hex, or move party
  const handleHexClick = useCallback((hex) => {
    const key = `${hex.col},${hex.row}`;
    setSelectedHex(key);
    const hexData = hexTerrainData?.get?.(key);
    const locs = hexData?.locations || hex.locations || [];
    const t1 = hex.terrain || hexData?.terrain || 'uncharted';
    const t2 = hex.terrain2 || hexData?.terrain2;
    const terrainStr = t2 ? `${t1}/${t2}` : t1;
    const tags = hex.tags || hexData?.tags;
    const featStr = tags && tags.size > 0 ? ` [${[...tags].join(', ')}]` : '';
    const locNames = locs.map(l => l.name).join(', ');

    // Clicking an adjacent hex moves the party — unless gated inside a
    // settlement, in which case we fall through to the info-only display
    // below. Bug #66: no overland movement while in town.
    if (partyHex && !isGated) {
      const [pc, pr] = partyHex.split(',').map(Number);
      const adjacent = getAdjacentHexKeys(pc, pr);
      if (adjacent.includes(key)) {
        movePartyToHex(key);
        // Advance time by terrain movement cost
        setWorldState(prev => ({
          ...prev,
          currentHour: Math.min(23, (prev.currentHour || 8) + 2),
        }));
        return;
      }
    }

    const msg = locNames
      ? `Hex (${hex.col},${hex.row}): ${terrainStr}${featStr} — ${locNames}`
      : `Hex (${hex.col},${hex.row}): ${terrainStr}${featStr}`;
    addLog?.(msg, 'info');
    if (locs.length === 1) setSelectedLocation(locs[0]);
  }, [hexTerrainData, addLog, partyHex, movePartyToHex, setWorldState, isGated]);

  // Pin click
  const handlePinClick = useCallback((pin) => {
    const loc = locations.find(l => String(l.id) === pin.id || l.name === pin.label);
    if (loc) setSelectedLocation(loc);
    addLog?.(`Selected: ${pin.label}`, 'info');
  }, [locations, addLog]);

  // Derived values
  const currentHour = worldState?.currentHour ?? 8;
  const dayNumber = worldState?.currentDay ?? 1;
  const todInfo = overlandService.getTimeOfDay(currentHour);
  const currentWeather = worldState?.currentWeather || null;

  return (
    <div style={styles.container}>
      {/* MAP AREA */}
      <div style={styles.mapArea}>
        {/* Bug #66 — Locked-out banner when party is inside a settlement.
            Map is still browsable; movement/exploration/gathering handlers
            short-circuit. Operator must Leave Town from the Adventure tab
            to re-enable overland travel. */}
        {isGated && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 220,
              background: 'rgba(60, 20, 20, 0.92)',
              border: '1px solid #b85c5c',
              borderRadius: '6px',
              padding: '8px 14px',
              color: '#ffd7a0',
              fontSize: '12px',
              fontWeight: 'bold',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              maxWidth: '80%',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{ color: '#ffb060' }}>🔒 Inside {settlementGate.locationName}</span>
            <span style={{ color: '#d4c5a9', fontWeight: 'normal', marginLeft: '8px' }}>
              Hex travel locked — leave town to explore the wilderness.
            </span>
          </div>
        )}
        {/* Mobile sidebar toggle button */}
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              zIndex: 210,
              padding: '10px 12px',
              backgroundColor: 'rgba(0,0,0,0.85)',
              border: '1px solid rgba(255,215,0,0.3)',
              borderRadius: '4px',
              color: '#ffd700',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 'bold',
              minHeight: '44px',
              touchAction: 'manipulation',
            }}
          >
            {sidebarOpen ? '\u2190 Hide' : '\u2192 Info'}
          </button>
        )}
        <InteractiveMap
          ref={mapRef}
          visitedPoiIds={visitedPoiIds}
          focusedPoiId={mapFocus?.poiId || null}
          mapId={activeMapId}
          pins={mergedPins}
          regions={mapRegions}
          skipRegistryPins={true}
          onPinClick={handlePinClick}
          fogEnabled={false}
          showLegend={true}
          width="100%"
          height="100%"
          addLog={addLog}
          showHexGrid={showHexGrid}
          hexTerrainData={hexTerrainData}
          hexSizeMiles={HEX_SIZE_MILES}
          mapWidthMiles={MAP_WIDTH_MILES}
          onHexClick={handleHexClick}
          highlightedHex={selectedHex}
          partyHex={partyHex}
          exploredHexes={exploredHexes}
          showFogOfWar={true}
          exploringHex={hexExploring}
        />

        {/* Time of Day Display */}
        <div style={{ position: 'absolute', top: 8, right: 310, background: 'rgba(0,0,0,0.85)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(255,215,0,0.3)', zIndex: 200 }}>
          <span style={{ color: '#ffd700', fontSize: '12px', fontWeight: 'bold' }}>Day {dayNumber} </span>
          <span style={{ color: '#d4c5a9', fontSize: '11px' }}>
            {String(currentHour).padStart(2, '0')}:00 — {todInfo?.name}
          </span>
          <span style={{ color: todInfo?.lightLevel === 'dark' ? '#4040ff' : todInfo?.lightLevel === 'dim' ? '#8080aa' : '#ffd700', fontSize: '10px', marginLeft: '6px' }}>
            ({todInfo?.lightLevel})
          </span>
        </div>

        {/* Top-left map controls */}
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 200, display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setShowHexGrid(!showHexGrid)}
            title="Toggle hex grid overlay"
            style={{ ...styles.btn, ...(showHexGrid ? styles.btnActive : {}), fontSize: '12px' }}
          >
            {'\u2B21'} Hex Grid
          </button>
          {showHexGrid && (
            <span style={{ fontSize: '10px', color: '#8b949e', alignSelf: 'center', background: 'rgba(0,0,0,0.7)', padding: '3px 8px', borderRadius: '3px' }}>
              {HEX_SIZE_MILES} mi/hex &bull; {MAP_WIDTH_MILES} mi
            </span>
          )}
        </div>
      </div>

      {/* SIDEBAR */}
      <div style={styles.sidebar(sidebarOpen, isMobile)}>
        {/* Close button for mobile */}
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              alignSelf: 'flex-end',
              padding: '6px 8px',
              backgroundColor: 'transparent',
              border: 'none',
              color: '#ffd700',
              cursor: 'pointer',
              fontSize: '16px',
              marginBottom: '8px',
            }}
          >
            ✕
          </button>
        )}
        {/* Party location summary */}
        <div style={styles.title}>Party Location</div>
        <div style={styles.card}>
          <div style={styles.statRow}>
            <span style={styles.label}>Position</span>
            <span style={styles.value}>{worldState?.partyPosition?.locationId || 'Sandpoint'}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.label}>Day / Time</span>
            <span style={{ color: '#d4c5a9' }}>Day {dayNumber}, {String(currentHour).padStart(2, '0')}:00</span>
          </div>
          {currentWeather && (
            <div style={styles.statRow}>
              <span style={styles.label}>Weather</span>
              <span style={{ color: '#8b949e' }}>{currentWeather.description || 'Clear'}</span>
            </div>
          )}
        </div>

        {/* Hex Crawl Controls — always active */}
        <div style={{ ...styles.card, borderColor: '#ffd700' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={styles.subtitle}>Hex Crawl</span>
            <span style={{ fontSize: 10, color: '#51cf66' }}>Active</span>
          </div>

              {partyHex && (
                <div style={{ fontSize: '11px', marginBottom: '6px' }}>
                  <div style={styles.statRow}>
                    <span style={styles.label}>Party Hex</span>
                    <span style={styles.value}>{partyHex}</span>
                  </div>
                  <div style={styles.statRow}>
                    <span style={styles.label}>Terrain</span>
                    <span style={{ color: '#d4c5a9', textTransform: 'capitalize' }}>
                      {hexTerrainData?.get(partyHex)?.terrain || 'Unknown'}
                    </span>
                  </div>
                  <div style={styles.statRow}>
                    <span style={styles.label}>Explored</span>
                    <span style={styles.value}>{exploredHexes.size} hexes</span>
                  </div>
                </div>
              )}

              {/* Current Weather */}
              {currentWeatherLocal && (
                <div style={{ marginBottom: '8px', padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '11px' }}>
                  <div style={{ color: '#87ceeb', fontWeight: 'bold', marginBottom: '2px' }}>
                    {currentWeatherLocal.precipitation?.isStorm ? '⛈️' : currentWeatherLocal.precipitation ? '🌧️' : currentWeatherLocal.temperatureF > 85 ? '☀️' : '🌤️'} Weather
                  </div>
                  <div style={{ color: '#d4c5a9' }}>{currentWeatherLocal.description}</div>
                  <div style={styles.statRow}>
                    <span style={styles.label}>Temp</span>
                    <span style={{ color: currentWeatherLocal.temperatureF < 40 ? '#87ceeb' : currentWeatherLocal.temperatureF > 90 ? '#ff6040' : '#d4c5a9' }}>
                      {currentWeatherLocal.temperatureF}°F
                    </span>
                  </div>
                  {currentWeatherLocal.wind && (
                    <div style={styles.statRow}>
                      <span style={styles.label}>Wind</span>
                      <span style={styles.value}>{currentWeatherLocal.wind.name}</span>
                    </div>
                  )}
                  {currentWeatherLocal.speedPenalty > 0 && (
                    <div style={{ color: '#ff6040', fontSize: '10px' }}>
                      Speed reduced by {Math.round(currentWeatherLocal.speedPenalty * 100)}%
                    </div>
                  )}
                </div>
              )}

              {/* Last Encounter */}
              {lastEncounter && lastEncounter.encountered && (
                <div style={{ marginBottom: '8px', padding: '6px', background: 'rgba(255,60,40,0.1)', border: '1px solid rgba(255,60,40,0.3)', borderRadius: '4px', fontSize: '11px' }}>
                  <div style={{ color: '#ff6040', fontWeight: 'bold', marginBottom: '2px' }}>⚔️ Encounter</div>
                  <div style={{ color: '#d4c5a9' }}>
                    {lastEncounter.count > 1 ? `${lastEncounter.count}x ` : ''}{lastEncounter.monster?.name || 'Unknown'} (CR {lastEncounter.monster?.cr || '?'})
                  </div>
                  {lastEncounter.monster && (
                    <div style={{ color: '#8b949e', fontSize: '10px', marginTop: '2px' }}>
                      HP {lastEncounter.monster.hp} | AC {lastEncounter.monster.ac} | {lastEncounter.monster.type}
                    </div>
                  )}
                  <button style={{ ...styles.btn, marginTop: '4px', fontSize: '10px' }} onClick={() => setLastEncounter(null)}>
                    Dismiss
                  </button>
                </div>
              )}

              {/* Exploration */}
              {hexExploring ? (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#ffd700', marginBottom: '4px' }}>
                    Exploring hex {hexExploring}... ({worldState?.hexExplorationDaysLeft || 0} days left)
                  </div>
                  <button style={{ ...styles.btn, width: '100%' }} onClick={advanceExploreDay}>
                    Advance 1 Day
                  </button>
                </div>
              ) : partyHex && (
                <button
                  style={{
                    ...styles.btn,
                    width: '100%',
                    marginBottom: '4px',
                    opacity: isGated ? 0.45 : 1,
                    cursor: isGated ? 'not-allowed' : 'pointer',
                  }}
                  onClick={startExploreHex}
                  disabled={isGated}
                  title={isGated ? `Leave ${settlementGate.locationName} first.` : undefined}
                >
                  Explore This Hex
                </button>
              )}

              {/* Advance Day (without exploring) — Bug #67 (2026-04-20):
                  Day-advance is overland-scale: it rolls hex-random encounters
                  and bumps weather on the party's current hex terrain. That's
                  nonsense while the party is sitting in a town — a day spent
                  in Sandpoint is not "a day of wilderness travel." Gate on
                  `isGated` (same settlement-ancestor check as Forage/Hunt/
                  Explore-This-Hex) so the button is visible-but-disabled
                  with the standard "Leave <settlement> first" tooltip when
                  the party is inside a settlement/building/floor/room. The
                  button stays free to click once they leave town via the
                  AdventureTab "Leave Town" flow. */}
              {!hexExploring && partyHex && (
                <button
                  style={{
                    ...styles.btn,
                    width: '100%',
                    marginBottom: '4px',
                    opacity: isGated ? 0.45 : 1,
                    cursor: isGated ? 'not-allowed' : 'pointer',
                  }}
                  disabled={isGated}
                  title={isGated ? `Leave ${settlementGate.locationName} first.` : undefined}
                  onClick={async () => {
                    if (isGated) return;
                    const hexData = hexTerrainData?.get(partyHex);
                    const terrain = hexData?.terrain || 'plains';
                    const partyLevel = Math.max(1, ...party.map(c => c.level || 1));
                    const newDay = (worldState?.currentDay || 1) + 1;

                    // Weather
                    const w = generateDailyWeather(terrain, newDay);
                    setCurrentWeatherLocal(w);

                    // Encounter
                    const enc = await generateEncounter(terrain, partyLevel);
                    if (enc.encountered) {
                      setLastEncounter(enc);
                      setHexTravelLog(prev => [...prev, { time: `Day ${newDay}`, text: enc.description, type: 'encounter' }]);
                      addLog?.(enc.description, 'danger');
                    }

                    setWorldState(prev => ({ ...prev, currentDay: newDay, currentWeather: w }));
                    setHexTravelLog(prev => [...prev, { time: `Day ${newDay}`, text: `${w.description} (${w.temperatureF}°F)`, type: 'weather' }]);
                    addLog?.(`Day ${newDay} — ${w.description}`, 'narration');
                  }}
                >
                  ⏩ Advance Day
                </button>
              )}

              {/* Survival Actions — Bug #66: disabled while inside a settlement */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                <button
                  style={{
                    ...styles.btn,
                    opacity: isGated ? 0.45 : 1,
                    cursor: isGated ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleForage}
                  disabled={party.length === 0 || isGated}
                  title={isGated ? `Leave ${settlementGate.locationName} first.` : undefined}
                >
                  Forage
                </button>
                <button
                  style={{
                    ...styles.btn,
                    opacity: isGated ? 0.45 : 1,
                    cursor: isGated ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleHunt}
                  disabled={party.length === 0 || isGated}
                  title={isGated ? `Leave ${settlementGate.locationName} first.` : undefined}
                >
                  Hunt
                </button>
                <button
                  style={{
                    ...styles.btn,
                    opacity: isGated ? 0.45 : 1,
                    cursor: isGated ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleFindWater}
                  disabled={party.length === 0 || isGated}
                  title={isGated ? `Leave ${settlementGate.locationName} first.` : undefined}
                >
                  Find Water
                </button>
              </div>

              {/* Movement hint */}
              <div style={{ fontSize: '10px', color: '#8b949e', marginBottom: '8px' }}>
                {isGated
                  ? `Inside ${settlementGate.locationName}. Leave town (Adventure tab) to resume hex travel.`
                  : 'Click an adjacent hex on the map to move the party.'}
              </div>

              {/* Travel Log */}
              {hexTravelLog.length > 0 && (
                <div>
                  <div style={styles.subtitle}>Travel Log</div>
                  <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', padding: '4px' }}>
                    {hexTravelLog.slice(-20).reverse().map((entry, i) => (
                      <div key={i} style={{ fontSize: '10px', padding: '2px 0', borderBottom: '1px solid rgba(48,54,61,0.3)' }}>
                        <span style={{ color: '#555', marginRight: '4px' }}>{entry.time}</span>
                        <span style={{ color: entry.type === 'weather' ? '#87ceeb' : entry.type === 'encounter' ? '#ff6040' : entry.type === 'explore' ? '#ffd700' : '#d4c5a9' }}>
                          {entry.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
        </div>

        {/* Selected hex info */}
        {selectedHex && hexTerrainData?.get(selectedHex) && (() => {
          const hd = hexTerrainData.get(selectedHex);
          const isHybrid = hd.terrain2 && hd.terrain2 !== hd.terrain;
          return (
            <div style={{ ...styles.card, borderColor: TERRAIN_COLORS[hd.terrain] || '#555' }}>
              <div style={{ ...styles.subtitle, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <TerrainIcon terrain={hd.terrain} size={16} />
                <span style={{ textTransform: 'capitalize' }}>{hd.terrain}</span>
                {isHybrid && (
                  <>
                    <span style={{ color: '#6b7280' }}>/</span>
                    <TerrainIcon terrain={hd.terrain2} size={16} />
                    <span style={{ textTransform: 'capitalize' }}>{hd.terrain2}</span>
                  </>
                )}
                <span style={{ color: '#6b7280', fontSize: '10px', fontWeight: 'normal' }}>({selectedHex})</span>
              </div>
              {hd.tags && hd.tags.size > 0 && (
                <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {[...hd.tags].map(tagKey => {
                    const info = getTagInfo(tagKey);
                    return (
                      <span key={tagKey} title={info.desc} style={{ fontSize: '10px', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)', borderRadius: '3px', padding: '1px 5px', color: info.color }}>
                        {info.icon} {info.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {hd.locations.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  {hd.locations.map((loc, i) => (
                    <div key={i}
                      style={{ fontSize: '11px', cursor: 'pointer', padding: '2px 0', color: selectedLocation?.id === loc.id ? '#ffd700' : '#d4c5a9' }}
                      onClick={() => setSelectedLocation(loc)}
                    >
                      {catIcons[loc.category] || '\u{1F4CD}'} {loc.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Location filter & list */}
        <div style={styles.title}>Locations</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px' }}>
          <button style={{ ...styles.btn, fontSize: '10px', ...(categoryFilter === 'all' ? styles.btnActive : {}) }}
            onClick={() => setCategoryFilter('all')}>All</button>
          {['tavern', 'shop', 'temple', 'government', 'dungeon', 'encounter', 'noble', 'landmark'].map(cat => (
            <button key={cat} style={{ ...styles.btn, fontSize: '10px', ...(categoryFilter === cat ? styles.btnActive : {}) }}
              onClick={() => setCategoryFilter(cat)}>{catIcons[cat]} {cat}</button>
          ))}
        </div>

        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          {locations.filter(l => categoryFilter === 'all' || l.category === categoryFilter).map(loc => (
            <div key={loc.id}
              style={{
                ...styles.card, cursor: 'pointer',
                borderColor: selectedLocation?.id === loc.id ? '#ffd700' : 'rgba(255,215,0,0.2)',
              }}
              onClick={() => setSelectedLocation(loc)}
            >
              <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#d4c5a9' }}>
                {catIcons[loc.category]} {loc.name}
              </div>
              <div style={{ fontSize: '9px', color: '#8b949e', textTransform: 'capitalize' }}>{loc.category} — {loc.region}</div>
            </div>
          ))}
        </div>

        {/* Selected location detail */}
        {selectedLocation && (
          <div style={{ ...styles.card, marginTop: '8px' }}>
            <div style={{ ...styles.subtitle, fontSize: '13px' }}>
              {catIcons[selectedLocation.category]} {selectedLocation.name}
            </div>
            <div style={{ fontSize: '11px', marginBottom: '6px' }}>{selectedLocation.description}</div>
            {selectedLocation.npc && <div style={{ fontSize: '11px', color: '#c0a0ff' }}>NPC: {selectedLocation.npc}</div>}
            {selectedLocation.services && (
              <div style={{ fontSize: '10px', color: '#40c0ff', marginTop: '2px' }}>
                Services: {selectedLocation.services.join(', ')}
              </div>
            )}
            {onOpenJournalLocation && (
              <button
                type="button"
                onClick={() => onOpenJournalLocation(locationSlug(selectedLocation.name))}
                style={{
                  marginTop: 8, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                  background: '#1a2a4a', color: '#ffd700',
                  border: '1px solid #4a3818', borderRadius: 3,
                }}
                title="Open this place's journal entry"
              >
                📓 Open in journal
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
