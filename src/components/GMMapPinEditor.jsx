import React, { useState, useMemo, useCallback, useRef } from 'react';
import InteractiveMap from './InteractiveMap';
import { getAvailableMaps, getMap } from '../services/mapRegistry';
import dmEngine from '../services/dmEngine';
import overlandService from '../services/overlandService';
import { pixelToHex, hexCenter, TERRAIN_COLORS, TERRAIN_TYPES, HEX_TAGS, TAG_CATEGORIES, getTagInfo, parseHexValue, encodeHexValue } from './HexGridOverlay';
import { getHexConfig } from '../services/hexConfig';

// Per-map hex configuration moved to src/services/hexConfig.js (Task #84,
// 2026-04-19) so MapTab + GMMapPinEditor + overlandTravel share a single
// source of truth. Call getHexConfig(mapId) below.

const PIN_TYPES = [
  { key: 'town', label: 'Town', color: '#ffd700', icon: '\u{1F3D8}\uFE0F' },
  { key: 'city', label: 'City', color: '#7b68ee', icon: '\u{1F3DB}\uFE0F' },
  { key: 'dungeon', label: 'Dungeon', color: '#ff4444', icon: '\u{1F480}' },
  { key: 'ruin', label: 'Ruin', color: '#8b4513', icon: '\u{1F5FC}' },
  { key: 'temple', label: 'Temple', color: '#40e0d0', icon: '\u2720' },
  { key: 'camp', label: 'Camp', color: '#ff8c00', icon: '\u{1F525}' },
  { key: 'encounter', label: 'Encounter', color: '#ff6b6b', icon: '\u2694\uFE0F' },
  { key: 'shop', label: 'Shop', color: '#7fff00', icon: '\u{1F6CD}\uFE0F' },
  { key: 'landmark', label: 'Landmark', color: '#daa520', icon: '\u{1F6A9}' },
  { key: 'custom', label: 'Custom', color: '#e0d6c8', icon: '\u{1F4CD}' },
];

const sty = {
  container: { display: 'flex', height: '100%', gap: 0 },
  sidebar: {
    width: 280, flexShrink: 0, backgroundColor: '#0d1117', borderRight: '1px solid #30363d',
    overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
  },
  mapArea: { flex: 1, position: 'relative', overflow: 'hidden' },
  heading: { color: '#ffd700', fontWeight: 700, fontSize: 13, textTransform: 'uppercase', marginBottom: 4 },
  subheading: { color: '#8b949e', fontSize: 10, marginBottom: 8 },
  select: {
    width: '100%', padding: '6px 8px', background: '#1a1a2e', border: '1px solid #30363d',
    borderRadius: 4, color: '#e0d6c8', fontSize: 12,
  },
  input: {
    width: '100%', padding: '6px 8px', background: '#1a1a2e', border: '1px solid #30363d',
    borderRadius: 4, color: '#e0d6c8', fontSize: 12, boxSizing: 'border-box',
  },
  btn: (active) => ({
    padding: '5px 10px', border: `1px solid ${active ? '#ffd700' : '#30363d'}`,
    borderRadius: 4, background: active ? '#2d1b00' : '#1a1a2e',
    color: active ? '#ffd700' : '#8b949e', cursor: 'pointer', fontSize: 11,
  }),
  pinCard: (selected) => ({
    padding: '8px 10px', background: selected ? '#2d1b00' : '#16213e',
    border: `1px solid ${selected ? '#ffd700' : 'rgba(255,215,0,0.15)'}`,
    borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#d4c5a9',
    display: 'flex', alignItems: 'center', gap: 8,
  }),
  deleteBtn: {
    background: 'none', border: 'none', color: '#ff4444', cursor: 'pointer',
    fontSize: 14, padding: '0 4px', marginLeft: 'auto',
  },
  coords: { color: '#6b7280', fontSize: 10, fontFamily: 'monospace' },
  badge: (color) => ({
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    background: color, flexShrink: 0,
  }),
};

const REGION_COLORS = [
  { key: '#ffd700', label: 'Gold' },
  { key: '#4488ff', label: 'Blue' },
  { key: '#44cc44', label: 'Green' },
  { key: '#ff4444', label: 'Red' },
  { key: '#cc66ff', label: 'Purple' },
  { key: '#ff8c00', label: 'Orange' },
  { key: '#40e0d0', label: 'Teal' },
  { key: '#ff66aa', label: 'Pink' },
];

export default function GMMapPinEditor({ worldState, setWorldState, addLog }) {
  const [selectedMapId, setSelectedMapId] = useState('varisia_region');
  // Pin state
  const [placingPin, setPlacingPin] = useState(false);
  const [newPinType, setNewPinType] = useState('landmark');
  const [newPinLabel, setNewPinLabel] = useState('');
  const [newPinNotes, setNewPinNotes] = useState('');
  const [selectedPinId, setSelectedPinId] = useState(null);
  const [editingPin, setEditingPin] = useState(null);
  const [movingPinId, setMovingPinId] = useState(null); // pin ID being click-to-moved
  // Pin list filter/sort
  const [pinFilter, setPinFilter] = useState('all'); // 'all' | pin type key | 'registry' | 'custom'
  const [pinSort, setPinSort] = useState('default'); // 'default' | 'alpha' | 'alpha-desc' | 'type'
  const [pinSearch, setPinSearch] = useState('');
  // Mode & region state
  const [editorMode, setEditorMode] = useState('pins'); // 'pins' | 'regions' | 'hexes'
  const [drawingRegion, setDrawingRegion] = useState(null); // { label, color, dashed, points: [{xPct,yPct}] } while drawing
  const [newRegionLabel, setNewRegionLabel] = useState('');
  const [newRegionColor, setNewRegionColor] = useState('#4488ff');
  const [newRegionDashed, setNewRegionDashed] = useState(true);
  const [newRegionShowLabel, setNewRegionShowLabel] = useState(true);
  const [editingRegion, setEditingRegion] = useState(null);
  const [redrawingRegionId, setRedrawingRegionId] = useState(null); // existing region being redrawn
  const [locatingPinId, setLocatingPinId] = useState(null); // pin currently being AI-located
  const [pinMovePrompt, setPinMovePrompt] = useState(null); // { pinLabel, newHexKey } when party should maybe follow

  const mapRef = useRef(null);

  const availableMaps = useMemo(() => getAvailableMaps(), []);
  const currentMap = useMemo(() => getMap(selectedMapId), [selectedMapId]);

  // Per-map hex config (Task #84 — shared service).
  const hexConfig = getHexConfig(selectedMapId);
  const HEX_SIZE_MILES = hexConfig.hexSizeMiles;
  const MAP_WIDTH_MILES = hexConfig.mapWidthMiles;

  // ── Pin data ──
  const customPins = worldState?.gmPins || {};
  const customPinsForMap = customPins[selectedMapId] || [];
  const pinOverrides = worldState?.gmPinOverrides || {};
  const overridesForMap = pinOverrides[selectedMapId] || {};
  // Hidden registry pin IDs
  const hiddenPins = worldState?.gmHiddenPins || {};
  const hiddenPinsForMap = useMemo(() => new Set(hiddenPins[selectedMapId] || []), [hiddenPins, selectedMapId]);

  // Merge registry POIs (minus hidden) with overrides, then append custom pins
  const pinsForMap = useMemo(() => {
    const registryPois = (currentMap?.poi || [])
      .filter(p => !hiddenPinsForMap.has(p.id))
      .map(p => ({
        ...p,
        xPct: overridesForMap[p.id]?.xPct ?? p.xPct,
        yPct: overridesForMap[p.id]?.yPct ?? p.yPct,
        _registry: true,
      }));
    return [...registryPois, ...customPinsForMap];
  }, [currentMap, overridesForMap, customPinsForMap, hiddenPinsForMap]);

  // Count of hidden registry pins for UI
  const hiddenCount = hiddenPinsForMap.size;

  const updateCustomPins = useCallback((mapId, pins) => {
    setWorldState?.(prev => ({
      ...prev,
      gmPins: { ...(prev.gmPins || {}), [mapId]: pins },
    }));
  }, [setWorldState]);

  const updatePinOverride = useCallback((mapId, pinId, pos) => {
    setWorldState?.(prev => ({
      ...prev,
      gmPinOverrides: {
        ...(prev.gmPinOverrides || {}),
        [mapId]: {
          ...((prev.gmPinOverrides || {})[mapId] || {}),
          [pinId]: pos,
        },
      },
    }));
  }, [setWorldState]);

  const hidePin = useCallback((pinId) => {
    setWorldState?.(prev => {
      const hidden = { ...(prev.gmHiddenPins || {}) };
      const mapHidden = [...(hidden[selectedMapId] || [])];
      if (!mapHidden.includes(pinId)) mapHidden.push(pinId);
      hidden[selectedMapId] = mapHidden;
      return { ...prev, gmHiddenPins: hidden };
    });
    if (selectedPinId === pinId) setSelectedPinId(null);
    if (editingPin === pinId) setEditingPin(null);
  }, [selectedMapId, selectedPinId, editingPin, setWorldState]);

  const unhidePin = useCallback((pinId) => {
    setWorldState?.(prev => {
      const hidden = { ...(prev.gmHiddenPins || {}) };
      hidden[selectedMapId] = (hidden[selectedMapId] || []).filter(id => id !== pinId);
      return { ...prev, gmHiddenPins: hidden };
    });
  }, [selectedMapId, setWorldState]);

  const restoreAllPins = useCallback(() => {
    setWorldState?.(prev => {
      const hidden = { ...(prev.gmHiddenPins || {}) };
      delete hidden[selectedMapId];
      return { ...prev, gmHiddenPins: hidden };
    });
  }, [selectedMapId, setWorldState]);

  // ── Region data (polygon-based) ──
  const gmRegions = worldState?.gmRegions || {};
  const regionsForMap = gmRegions[selectedMapId] || [];

  const updateRegions = useCallback((mapId, regions) => {
    setWorldState?.(prev => ({
      ...prev,
      gmRegions: { ...(prev.gmRegions || {}), [mapId]: regions },
    }));
  }, [setWorldState]);

  const deleteRegion = useCallback((regionId) => {
    updateRegions(selectedMapId, regionsForMap.filter(r => r.id !== regionId));
    if (editingRegion === regionId) setEditingRegion(null);
  }, [selectedMapId, regionsForMap, updateRegions, editingRegion]);

  const updateRegion = useCallback((regionId, updates) => {
    updateRegions(selectedMapId, regionsForMap.map(r => r.id === regionId ? { ...r, ...updates } : r));
    setEditingRegion(null);
  }, [selectedMapId, regionsForMap, updateRegions]);

  // ── Hex editor state ──
  const [hexPaintTerrain, setHexPaintTerrain] = useState('forest');
  const [hexSecondaryTerrain, setHexSecondaryTerrain] = useState(null); // null = single terrain, string = hybrid
  const [hexPaintTags, setHexPaintTags] = useState(new Set()); // active tag overlays to paint

  // GM hex terrain overrides for the current map
  const gmHexTerrain = (worldState?.gmHexTerrain || {})[selectedMapId] || {};
  const gmHexCount = Object.keys(gmHexTerrain).length;

  // Build merged hex terrain data (region auto-detect + GM overrides + locations)
  const hexTerrainData = useMemo(() => {
    if (editorMode !== 'hexes') return null;
    const data = new Map();
    const regions = overlandService.getRegions();
    const allLocations = overlandService.getLocations();
    const mapSettings = overlandService.getMapSettings();
    const imgW = mapSettings.bounds?.width || 1200;
    const imgH = mapSettings.bounds?.height || 900;
    const hexSizePx = (HEX_SIZE_MILES / MAP_WIDTH_MILES) * imgW;
    const w = hexSizePx * 2;
    const h = Math.sqrt(3) * hexSizePx;
    const cols = Math.ceil(imgW / (w * 0.75)) + 2;
    const rows = Math.ceil(imgH / h) + 2;

    // Pre-compute which hex each location falls into
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

        // Check GM override first (may be "forest", "forest/coastal", "forest|road", etc.)
        if (gmHexTerrain[key]) {
          const parsed = parseHexValue(gmHexTerrain[key]);
          data.set(key, {
            terrain: parsed.terrain, terrain2: parsed.terrain2,
            tags: parsed.tags,
            label: parsed.terrain2 ? `${parsed.terrain}/${parsed.terrain2}` : parsed.terrain,
            locations: hexLocations,
          });
          continue;
        }

        // Fall back to sandpointMap region data
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
  }, [editorMode, gmHexTerrain, selectedMapId]);

  // Handle hex click: paint terrain + features in hex mode
  const handleHexClick = useCallback((hex) => {
    if (editorMode !== 'hexes') return;
    const key = `${hex.col},${hex.row}`;
    if (hexPaintTerrain === 'clear') {
      // Clear the hex entirely
      setWorldState?.(prev => {
        const mapTerrain = { ...((prev.gmHexTerrain || {})[selectedMapId] || {}) };
        delete mapTerrain[key];
        return { ...prev, gmHexTerrain: { ...(prev.gmHexTerrain || {}), [selectedMapId]: mapTerrain } };
      });
      addLog?.(`Hex (${hex.col},${hex.row}) cleared`, 'system');
      return;
    }
    // Encode terrain + secondary + features into compound string
    const secondary = (hexSecondaryTerrain && hexSecondaryTerrain !== hexPaintTerrain) ? hexSecondaryTerrain : null;
    const encoded = encodeHexValue(hexPaintTerrain, secondary, hexPaintTags);
    setWorldState?.(prev => {
      const mapTerrain = { ...((prev.gmHexTerrain || {})[selectedMapId] || {}) };
      mapTerrain[key] = encoded;
      return { ...prev, gmHexTerrain: { ...(prev.gmHexTerrain || {}), [selectedMapId]: mapTerrain } };
    });
    addLog?.(`Hex (${hex.col},${hex.row}) set to ${encoded}`, 'system');
  }, [editorMode, hexPaintTerrain, hexSecondaryTerrain, hexPaintTags, selectedMapId, setWorldState, addLog]);

  // ── Map click: place pin or add region vertex ──
  const getClickPct = useCallback((e) => {
    const img = e.currentTarget.querySelector('img');
    if (!img) return null;
    const imgRect = img.getBoundingClientRect();
    const xPct = ((e.clientX - imgRect.left) / imgRect.width) * 100;
    const yPct = ((e.clientY - imgRect.top) / imgRect.height) * 100;
    if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return null;
    return { xPct: Math.round(xPct * 10) / 10, yPct: Math.round(yPct * 10) / 10 };
  }, []);

  const handleMapClick = useCallback((e) => {
    // Click-to-move: reposition an existing pin precisely
    if (movingPinId) {
      const pos = getClickPct(e);
      if (!pos) return;
      const pin = pinsForMap.find(p => p.id === movingPinId);
      if (pin?._registry) {
        updatePinOverride(selectedMapId, movingPinId, pos);
      } else {
        updateCustomPins(selectedMapId, customPinsForMap.map(p => p.id === movingPinId ? { ...p, ...pos } : p));
      }
      addLog?.(`Pin moved to (${pos.xPct}%, ${pos.yPct}%)`, 'system');
      setMovingPinId(null);
      return;
    }

    if (placingPin && newPinLabel.trim()) {
      const pos = getClickPct(e);
      if (!pos) return;
      const pin = {
        id: `gm_pin_${Date.now()}`,
        label: newPinLabel.trim(),
        xPct: pos.xPct, yPct: pos.yPct,
        type: newPinType,
        notes: newPinNotes.trim(),
        createdAt: new Date().toISOString(),
      };
      updateCustomPins(selectedMapId, [...customPinsForMap, pin]);
      addLog?.(`GM pin placed: ${pin.label} at (${pin.xPct}%, ${pin.yPct}%)`, 'system');
      setNewPinLabel('');
      setNewPinNotes('');
      setPlacingPin(false);
      return;
    }

    if (drawingRegion) {
      const pos = getClickPct(e);
      if (!pos) return;
      setDrawingRegion(prev => ({ ...prev, points: [...prev.points, pos] }));
      return;
    }
  }, [movingPinId, placingPin, newPinLabel, newPinType, newPinNotes, drawingRegion, selectedMapId, pinsForMap, customPinsForMap, updateCustomPins, updatePinOverride, addLog, getClickPct]);

  const startDrawingRegion = useCallback(() => {
    if (!newRegionLabel.trim()) return;
    setPlacingPin(false);
    setDrawingRegion({
      label: newRegionLabel.trim(),
      color: newRegionColor,
      dashed: newRegionDashed,
      showLabel: newRegionShowLabel,
      points: [],
    });
  }, [newRegionLabel, newRegionColor, newRegionDashed, newRegionShowLabel]);

  const finishRegion = useCallback(() => {
    if (!drawingRegion || drawingRegion.points.length < 3) return;
    if (redrawingRegionId) {
      // Replace points on existing region
      updateRegions(selectedMapId, regionsForMap.map(r =>
        r.id === redrawingRegionId ? { ...r, points: drawingRegion.points } : r
      ));
      addLog?.(`Region redrawn: ${drawingRegion.label} (${drawingRegion.points.length} vertices)`, 'system');
      setRedrawingRegionId(null);
    } else {
      const region = {
        id: `region_${Date.now()}`,
        label: drawingRegion.label,
        color: drawingRegion.color,
        dashed: drawingRegion.dashed,
        showLabel: drawingRegion.showLabel ?? true,
        points: drawingRegion.points,
      };
      updateRegions(selectedMapId, [...regionsForMap, region]);
      addLog?.(`Region drawn: ${region.label} (${region.points.length} vertices)`, 'system');
      setNewRegionLabel('');
    }
    setDrawingRegion(null);
    setEditingRegion(null);
  }, [drawingRegion, redrawingRegionId, selectedMapId, regionsForMap, updateRegions, addLog]);

  const startRedrawRegion = useCallback((region) => {
    setPlacingPin(false);
    setMovingPinId(null);
    setRedrawingRegionId(region.id);
    setDrawingRegion({
      label: region.label,
      color: region.color,
      dashed: region.dashed,
      showLabel: region.showLabel,
      points: [],
    });
  }, []);

  const cancelDrawingRegion = useCallback(() => {
    setDrawingRegion(null);
    setRedrawingRegionId(null);
  }, []);

  const undoLastVertex = useCallback(() => {
    if (!drawingRegion) return;
    setDrawingRegion(prev => ({ ...prev, points: prev.points.slice(0, -1) }));
  }, [drawingRegion]);

  // ── Pin operations ──
  const deletePin = useCallback((pinId) => {
    const pin = pinsForMap.find(p => p.id === pinId);
    if (pin?._registry) {
      hidePin(pinId);
    } else {
      updateCustomPins(selectedMapId, customPinsForMap.filter(p => p.id !== pinId));
      if (selectedPinId === pinId) setSelectedPinId(null);
      if (editingPin === pinId) setEditingPin(null);
    }
  }, [selectedMapId, pinsForMap, customPinsForMap, selectedPinId, editingPin, updateCustomPins, hidePin]);

  const updatePin = useCallback((pinId, updates) => {
    const pin = pinsForMap.find(p => p.id === pinId);
    if (pin?._registry) {
      if (updates.xPct !== undefined || updates.yPct !== undefined) {
        updatePinOverride(selectedMapId, pinId, {
          xPct: updates.xPct ?? pin.xPct,
          yPct: updates.yPct ?? pin.yPct,
        });
      }
    } else {
      updateCustomPins(selectedMapId, customPinsForMap.map(p => p.id === pinId ? { ...p, ...updates } : p));
    }
    setEditingPin(null);
  }, [selectedMapId, pinsForMap, customPinsForMap, updateCustomPins, updatePinOverride]);

  const handlePinDrag = useCallback((pinId, { xPct, yPct }) => {
    const pin = pinsForMap.find(p => p.id === pinId);
    if (pin?._registry) {
      updatePinOverride(selectedMapId, pinId, { xPct, yPct });
    } else {
      updateCustomPins(selectedMapId, customPinsForMap.map(p => p.id === pinId ? { ...p, xPct, yPct } : p));
    }

    // Check if the party was at this pin's old hex — show prompt to move party
    const partyHex = worldState?.partyHex;
    if (partyHex && pin) {
      const mapSettings = overlandService.getMapSettings();
      const imgW = mapSettings.bounds?.width || 1200;
      const hexSizePx = (HEX_SIZE_MILES / MAP_WIDTH_MILES) * imgW;
      const oldHex = pixelToHex((pin.xPct / 100) * imgW, (pin.yPct / 100) * (mapSettings.bounds?.height || 900), hexSizePx);
      const newHex = pixelToHex((xPct / 100) * imgW, (yPct / 100) * (mapSettings.bounds?.height || 900), hexSizePx);
      if (oldHex.key === partyHex && newHex.key !== partyHex) {
        setPinMovePrompt({ pinLabel: pin.label, newHexKey: newHex.key });
      }
    }
  }, [selectedMapId, pinsForMap, customPinsForMap, updateCustomPins, updatePinOverride, worldState?.partyHex, HEX_SIZE_MILES, MAP_WIDTH_MILES]);

  // AI auto-locate: ask Claude to estimate pin position on the map
  const aiLocatePin = useCallback(async (pinId) => {
    if (!dmEngine.isAIAvailable()) {
      addLog?.('API key not set — configure in Settings to use AI locate.', 'warning');
      return;
    }
    const pin = pinsForMap.find(p => p.id === pinId);
    if (!pin) return;
    setLocatingPinId(pinId);
    try {
      const otherPins = pinsForMap.filter(p => p.id !== pinId).map(p => `${p.label}: (${p.xPct}%, ${p.yPct}%)`).join(', ');
      const prompt = `You are helping position locations on a Pathfinder/Golarion map.
Map: "${currentMap?.name || selectedMapId}" (type: ${currentMap?.type || 'unknown'})
Known pin positions on this map: ${otherPins || 'none'}

Where should "${pin.label}" (type: ${pin.type}) be placed on this map?
Respond with ONLY a JSON object: {"xPct": number, "yPct": number}
where xPct is percentage from left edge (0-100) and yPct is percentage from top edge (0-100).
Use your knowledge of Golarion geography and the relative positions of the other pins to estimate accurately.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': dmEngine.settings.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: dmEngine.settings.model || 'claude-sonnet-4-6',
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*?"xPct"\s*:\s*([\d.]+)[\s\S]*?"yPct"\s*:\s*([\d.]+)[\s\S]*?\}/);
      if (!match) throw new Error('Could not parse AI response');

      const newX = Math.round(parseFloat(match[1]) * 10) / 10;
      const newY = Math.round(parseFloat(match[2]) * 10) / 10;

      if (pin._registry) {
        updatePinOverride(selectedMapId, pinId, { xPct: newX, yPct: newY });
      } else {
        updateCustomPins(selectedMapId, customPinsForMap.map(p => p.id === pinId ? { ...p, xPct: newX, yPct: newY } : p));
      }
      addLog?.(`AI positioned "${pin.label}" at (${newX}%, ${newY}%)`, 'system');
      mapRef.current?.focusPin(newX, newY);
    } catch (err) {
      addLog?.(`AI locate failed: ${err.message}`, 'danger');
    } finally {
      setLocatingPinId(null);
    }
  }, [pinsForMap, currentMap, selectedMapId, customPinsForMap, updateCustomPins, updatePinOverride, addLog]);

  // AI auto-draw region: ask Claude to estimate polygon boundary
  const aiDrawRegion = useCallback(async (regionId) => {
    if (!dmEngine.isAIAvailable()) {
      addLog?.('API key not set — configure in Settings to use AI draw.', 'warning');
      return;
    }
    const region = regionsForMap.find(r => r.id === regionId);
    if (!region) return;
    setLocatingPinId(regionId); // reuse loading state
    try {
      const knownPins = pinsForMap.map(p => `${p.label}: (${p.xPct}%, ${p.yPct}%)`).join(', ');
      const prompt = `You are helping draw region boundaries on a Pathfinder/Golarion map.
Map: "${currentMap?.name || selectedMapId}" (type: ${currentMap?.type || 'unknown'})
Known pin positions: ${knownPins || 'none'}

Draw the boundary of the region "${region.label}" as a polygon on this map.
Respond with ONLY a JSON array of points: [{"xPct": number, "yPct": number}, ...]
Use 6-12 vertices to outline the region. xPct is percentage from left (0-100), yPct from top (0-100).
Use your knowledge of Golarion geography and the reference pins to estimate accurately.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': dmEngine.settings.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: dmEngine.settings.model || 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Could not parse AI response');

      const points = JSON.parse(match[0]).map(p => ({
        xPct: Math.round(parseFloat(p.xPct) * 10) / 10,
        yPct: Math.round(parseFloat(p.yPct) * 10) / 10,
      }));

      if (points.length < 3) throw new Error('AI returned too few points');

      updateRegions(selectedMapId, regionsForMap.map(r => r.id === regionId ? { ...r, points } : r));
      addLog?.(`AI drew boundary for "${region.label}" (${points.length} vertices)`, 'system');
    } catch (err) {
      addLog?.(`AI draw failed: ${err.message}`, 'danger');
    } finally {
      setLocatingPinId(null);
    }
  }, [regionsForMap, pinsForMap, currentMap, selectedMapId, updateRegions, addLog]);

  // Strip internal flags for InteractiveMap
  const mapPins = useMemo(() => {
    return pinsForMap.map(p => ({ id: p.id, label: p.label, xPct: p.xPct, yPct: p.yPct, type: p.type }));
  }, [pinsForMap]);

  // Build region data for InteractiveMap (saved + in-progress drawing)
  const mapRegions = useMemo(() => {
    const saved = regionsForMap;
    if (drawingRegion && drawingRegion.points.length >= 2) {
      return [...saved, { id: '__drawing__', ...drawingRegion }];
    }
    return saved;
  }, [regionsForMap, drawingRegion]);

  const typeInfo = (key) => PIN_TYPES.find(t => t.key === key) || PIN_TYPES[PIN_TYPES.length - 1];

  // Filtered and sorted pin list
  const filteredPins = useMemo(() => {
    let list = [...pinsForMap];
    // Text search
    if (pinSearch.trim()) {
      const q = pinSearch.trim().toLowerCase();
      list = list.filter(p => p.label.toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q));
    }
    // Type / source filter
    if (pinFilter === 'registry') {
      list = list.filter(p => !!p._registry);
    } else if (pinFilter === 'custom') {
      list = list.filter(p => !p._registry);
    } else if (pinFilter !== 'all') {
      list = list.filter(p => p.type === pinFilter);
    }
    // Sort
    if (pinSort === 'alpha') {
      list.sort((a, b) => a.label.localeCompare(b.label));
    } else if (pinSort === 'alpha-desc') {
      list.sort((a, b) => b.label.localeCompare(a.label));
    } else if (pinSort === 'type') {
      list.sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.label.localeCompare(b.label));
    }
    return list;
  }, [pinsForMap, pinFilter, pinSort, pinSearch]);
  const isPlacing = placingPin || !!drawingRegion || !!movingPinId;
  const movingPinLabel = movingPinId ? pinsForMap.find(p => p.id === movingPinId)?.label : null;

  // Hidden registry pins list for restore UI
  const hiddenRegistryPins = useMemo(() => {
    if (!hiddenPinsForMap.size) return [];
    const allRegistry = currentMap?.poi || [];
    return allRegistry.filter(p => hiddenPinsForMap.has(p.id));
  }, [currentMap, hiddenPinsForMap]);

  return (
    <div style={sty.container}>
      {/* Pin-move party follow prompt */}
      {pinMovePrompt && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            backgroundColor: '#1a1a2e', border: '2px solid #ffd700', borderRadius: 8,
            padding: 20, maxWidth: 400, textAlign: 'center', color: '#d4c5a9',
          }}>
            <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: 14, marginBottom: 12 }}>
              Move Party?
            </div>
            <div style={{ fontSize: 12, marginBottom: 16 }}>
              You moved <strong style={{ color: '#ffd700' }}>{pinMovePrompt.pinLabel}</strong> to a new location.
              The party was at this pin. Should the party move with it?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                style={{ ...sty.btn(true), padding: '8px 16px' }}
                onClick={() => {
                  setWorldState(prev => {
                    const newExplored = new Set(prev.exploredHexes || []);
                    newExplored.add(pinMovePrompt.newHexKey);
                    return { ...prev, partyHex: pinMovePrompt.newHexKey, exploredHexes: [...newExplored] };
                  });
                  addLog?.(`Party moved to hex ${pinMovePrompt.newHexKey} (following ${pinMovePrompt.pinLabel})`, 'narration');
                  setPinMovePrompt(null);
                }}
              >
                Yes, move party
              </button>
              <button
                style={{ ...sty.btn(false), padding: '8px 16px' }}
                onClick={() => setPinMovePrompt(null)}
              >
                No, stay put
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <div style={sty.sidebar}>
        <div>
          <div style={sty.heading}>Map Editor</div>
          <div style={sty.subheading}>Place pins and draw region boundaries on maps.</div>
        </div>

        {/* Map selector */}
        <div>
          <label style={{ color: '#8b949e', fontSize: 10, display: 'block', marginBottom: 3 }}>Map</label>
          <select
            style={sty.select}
            value={selectedMapId}
            onChange={e => { setSelectedMapId(e.target.value); setSelectedPinId(null); setDrawingRegion(null); }}
          >
            {availableMaps.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.type})</option>
            ))}
          </select>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => { setEditorMode('pins'); setDrawingRegion(null); }}
            style={{
              ...sty.btn(editorMode === 'pins'), flex: 1, padding: '6px 0',
              fontWeight: editorMode === 'pins' ? 700 : 400,
            }}
          >
            Pins ({pinsForMap.length})
          </button>
          <button
            onClick={() => { setEditorMode('regions'); setPlacingPin(false); }}
            style={{
              ...sty.btn(editorMode === 'regions'), flex: 1, padding: '6px 0',
              fontWeight: editorMode === 'regions' ? 700 : 400,
            }}
          >
            Regions ({regionsForMap.length})
          </button>
          <button
            onClick={() => { setEditorMode('hexes'); setPlacingPin(false); setDrawingRegion(null); }}
            style={{
              ...sty.btn(editorMode === 'hexes'), flex: 1, padding: '6px 0',
              fontWeight: editorMode === 'hexes' ? 700 : 400,
              borderColor: editorMode === 'hexes' ? '#d946ef' : '#30363d',
              color: editorMode === 'hexes' ? '#d946ef' : '#8b949e',
              background: editorMode === 'hexes' ? 'rgba(217,70,239,0.15)' : '#1a1a2e',
            }}
          >
            Hexes
          </button>
        </div>

        {/* ═══ PINS MODE ═══ */}
        {editorMode === 'pins' && (
          <>
            <div style={{ background: '#16213e', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 6, padding: 10 }}>
              <div style={{ color: '#ffd700', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                {placingPin ? '\u{1F4CD} Click on the map to place pin' : 'New Pin'}
              </div>

              <label style={{ color: '#8b949e', fontSize: 10, display: 'block', marginBottom: 2 }}>Label *</label>
              <input style={sty.input} placeholder="e.g. Goblin Camp" value={newPinLabel} onChange={e => setNewPinLabel(e.target.value)} />

              <label style={{ color: '#8b949e', fontSize: 10, display: 'block', marginTop: 6, marginBottom: 2 }}>Type</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {PIN_TYPES.map(t => (
                  <button key={t.key} onClick={() => setNewPinType(t.key)}
                    style={{ ...sty.btn(newPinType === t.key), display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}>
                    <span style={{ fontSize: 12 }}>{t.icon}</span><span>{t.label}</span>
                  </button>
                ))}
              </div>

              <label style={{ color: '#8b949e', fontSize: 10, display: 'block', marginTop: 6, marginBottom: 2 }}>Notes (optional)</label>
              <textarea style={{ ...sty.input, height: 40, resize: 'vertical', fontFamily: 'inherit' }}
                placeholder="GM notes about this location..." value={newPinNotes} onChange={e => setNewPinNotes(e.target.value)} />

              <button
                onClick={() => { if (newPinLabel.trim()) { setPlacingPin(!placingPin); setDrawingRegion(null); } }}
                disabled={!newPinLabel.trim()}
                style={{
                  ...sty.btn(placingPin), width: '100%', marginTop: 8, padding: '8px 0',
                  opacity: newPinLabel.trim() ? 1 : 0.4,
                  background: placingPin ? '#4a2800' : '#2d1b00',
                  borderColor: placingPin ? '#ff8c00' : '#ffd700',
                  color: placingPin ? '#ff8c00' : '#ffd700', fontWeight: 600,
                }}
              >
                {placingPin ? 'Cancel Placement' : '\u{1F4CD} Place on Map'}
              </button>
            </div>

            {/* Pin list with filter/sort */}
            <div>
              <div style={{ color: '#ffd700', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Pins on this map ({pinsForMap.length})
              </div>

              {/* Search */}
              <input
                style={{ ...sty.input, marginBottom: 6, fontSize: 11 }}
                placeholder="Search pins..."
                value={pinSearch}
                onChange={e => setPinSearch(e.target.value)}
              />

              {/* Filter + Sort row */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                <select style={{ ...sty.select, flex: 1, fontSize: 10 }} value={pinFilter} onChange={e => setPinFilter(e.target.value)}>
                  <option value="all">All types</option>
                  <option value="registry">Registry only</option>
                  <option value="custom">Custom only</option>
                  {PIN_TYPES.map(t => (
                    <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                  ))}
                </select>
                <select style={{ ...sty.select, flex: 1, fontSize: 10 }} value={pinSort} onChange={e => setPinSort(e.target.value)}>
                  <option value="default">Default order</option>
                  <option value="alpha">A → Z</option>
                  <option value="alpha-desc">Z → A</option>
                  <option value="type">By type</option>
                </select>
              </div>

              {filteredPins.length === 0 && pinsForMap.length > 0 && (
                <div style={{ color: '#6b7280', fontSize: 11, fontStyle: 'italic' }}>No pins match filter.</div>
              )}
              {pinsForMap.length === 0 && (
                <div style={{ color: '#6b7280', fontSize: 11, fontStyle: 'italic' }}>No pins on this map.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredPins.map(pin => {
                  const ti = typeInfo(pin.type);
                  const isEditing = editingPin === pin.id;
                  const isRegistry = !!pin._registry;
                  return (
                    <div key={pin.id}>
                      <div style={sty.pinCard(selectedPinId === pin.id)}
                        onClick={() => setSelectedPinId(pin.id === selectedPinId ? null : pin.id)}
                        onDoubleClick={() => mapRef.current?.focusPin(pin.xPct, pin.yPct)}>
                        <span style={sty.badge(ti.color)} />
                        <span style={{ fontSize: 12 }}>{ti.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: '#e0d6c8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {pin.label}
                            {isRegistry && (
                              <span style={{ fontSize: 8, background: '#30363d', color: '#8b949e', padding: '1px 4px', borderRadius: 3, fontWeight: 400 }}>Registry</span>
                            )}
                          </div>
                          <div style={sty.coords}>({pin.xPct}%, {pin.yPct}%)</div>
                        </div>
                        <button style={{ ...sty.btn(movingPinId === pin.id), fontSize: 10, padding: '2px 6px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMovingPinId(movingPinId === pin.id ? null : pin.id);
                            setPlacingPin(false); setDrawingRegion(null);
                          }}
                          title="Click map to reposition this pin">
                          {movingPinId === pin.id ? 'Cancel' : 'Move'}
                        </button>
                        <button
                          style={{ ...sty.btn(false), fontSize: 10, padding: '2px 6px', color: '#40e0d0', borderColor: locatingPinId === pin.id ? '#40e0d0' : '#30363d' }}
                          onClick={(e) => { e.stopPropagation(); aiLocatePin(pin.id); }}
                          disabled={!!locatingPinId}
                          title="AI auto-locate this pin on the map">
                          {locatingPinId === pin.id ? '...' : 'AI'}
                        </button>
                        <button style={{ ...sty.btn(false), fontSize: 10, padding: '2px 6px' }}
                          onClick={(e) => { e.stopPropagation(); setEditingPin(isEditing ? null : pin.id); }}>
                          {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                        <button style={sty.deleteBtn}
                          onClick={(e) => { e.stopPropagation(); deletePin(pin.id); }}
                          title={isRegistry ? 'Hide pin' : 'Delete pin'}>
                          &times;
                        </button>
                      </div>
                      {isEditing && (
                        <PinEditor pin={pin} isRegistry={isRegistry}
                          onSave={(updates) => updatePin(pin.id, updates)}
                          onCancel={() => setEditingPin(null)} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Hidden pins restore */}
              {hiddenCount > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#1a1a2e', border: '1px solid #30363d', borderRadius: 6 }}>
                  <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 4 }}>
                    {hiddenCount} hidden pin{hiddenCount > 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {hiddenRegistryPins.map(pin => (
                      <div key={pin.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7280' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pin.label}</span>
                        <button
                          style={{ ...sty.btn(false), fontSize: 9, padding: '1px 6px', color: '#44cc44', borderColor: '#44cc44' }}
                          onClick={() => unhidePin(pin.id)}>
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                  {hiddenCount > 1 && (
                    <button
                      style={{ ...sty.btn(false), width: '100%', marginTop: 6, fontSize: 10, color: '#44cc44', borderColor: '#44cc44' }}
                      onClick={restoreAllPins}>
                      Restore All
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ REGIONS MODE ═══ */}
        {editorMode === 'regions' && (
          <>
            <div style={{ background: '#16213e', border: '1px solid rgba(68,136,255,0.25)', borderRadius: 6, padding: 10 }}>
              {!drawingRegion ? (
                <>
                  <div style={{ color: '#4488ff', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>New Region</div>

                  <label style={{ color: '#8b949e', fontSize: 10, display: 'block', marginBottom: 2 }}>Label *</label>
                  <input style={sty.input} placeholder="e.g. Mosswood, Devil's Platter"
                    value={newRegionLabel} onChange={e => setNewRegionLabel(e.target.value)} />

                  <label style={{ color: '#8b949e', fontSize: 10, display: 'block', marginTop: 6, marginBottom: 2 }}>Color</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {REGION_COLORS.map(c => (
                      <button key={c.key} onClick={() => setNewRegionColor(c.key)}
                        style={{
                          width: 24, height: 24, borderRadius: '50%', background: c.key,
                          border: `2px solid ${newRegionColor === c.key ? '#fff' : 'transparent'}`,
                          cursor: 'pointer', opacity: newRegionColor === c.key ? 1 : 0.6,
                        }} title={c.label} />
                    ))}
                  </div>

                  <label style={{ color: '#8b949e', fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <input type="checkbox" checked={newRegionDashed} onChange={e => setNewRegionDashed(e.target.checked)} />
                    Dashed border
                  </label>
                  <label style={{ color: '#8b949e', fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <input type="checkbox" checked={newRegionShowLabel} onChange={e => setNewRegionShowLabel(e.target.checked)} />
                    Show label on map
                  </label>

                  <button onClick={startDrawingRegion} disabled={!newRegionLabel.trim()}
                    style={{
                      ...sty.btn(false), width: '100%', marginTop: 8, padding: '8px 0',
                      opacity: newRegionLabel.trim() ? 1 : 0.4,
                      background: '#0a1e3d', borderColor: '#4488ff', color: '#4488ff', fontWeight: 600,
                    }}>
                    Start Drawing Boundary
                  </button>
                </>
              ) : (
                <>
                  <div style={{ color: '#66aaff', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Drawing: {drawingRegion.label}
                  </div>
                  <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 8 }}>
                    Click on the map to add vertices. At least 3 points needed to close the shape.
                  </div>
                  <div style={{ color: '#4488ff', fontSize: 11, marginBottom: 8 }}>
                    {drawingRegion.points.length} point{drawingRegion.points.length !== 1 ? 's' : ''} placed
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={finishRegion} disabled={drawingRegion.points.length < 3}
                      style={{
                        ...sty.btn(true), flex: 1, padding: '6px 0',
                        opacity: drawingRegion.points.length >= 3 ? 1 : 0.4,
                        background: '#0a3d1e', borderColor: '#44cc44', color: '#44cc44',
                      }}>
                      Finish ({drawingRegion.points.length >= 3 ? 'close shape' : 'need ' + (3 - drawingRegion.points.length) + ' more'})
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button onClick={undoLastVertex} disabled={drawingRegion.points.length === 0}
                      style={{ ...sty.btn(false), flex: 1, padding: '4px 0', opacity: drawingRegion.points.length > 0 ? 1 : 0.4 }}>
                      Undo Last
                    </button>
                    <button onClick={cancelDrawingRegion}
                      style={{ ...sty.btn(false), flex: 1, padding: '4px 0', color: '#ff4444', borderColor: '#ff4444' }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Region list */}
            <div>
              <div style={{ color: '#4488ff', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Regions on this map ({regionsForMap.length})
              </div>
              {regionsForMap.length === 0 && (
                <div style={{ color: '#6b7280', fontSize: 11, fontStyle: 'italic' }}>No regions yet. Draw a boundary by clicking map points.</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {regionsForMap.map(region => {
                  const isEditing = editingRegion === region.id;
                  return (
                    <div key={region.id}>
                      <div style={sty.pinCard(false)}>
                        <span style={{ ...sty.badge(region.color), width: 12, height: 12, border: `2px solid ${region.color}`, background: 'transparent' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: '#e0d6c8' }}>{region.label}</div>
                          <div style={sty.coords}>{region.points?.length || 0} vertices</div>
                        </div>
                        <button
                          style={{ ...sty.btn(false), fontSize: 10, padding: '2px 6px', color: '#40e0d0', borderColor: locatingPinId === region.id ? '#40e0d0' : '#30363d' }}
                          onClick={(e) => { e.stopPropagation(); aiDrawRegion(region.id); }}
                          disabled={!!locatingPinId}
                          title="AI auto-draw region boundary">
                          {locatingPinId === region.id ? '...' : 'AI'}
                        </button>
                        <button style={{ ...sty.btn(false), fontSize: 10, padding: '2px 6px' }}
                          onClick={(e) => { e.stopPropagation(); setEditingRegion(isEditing ? null : region.id); }}>
                          {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                        <button style={sty.deleteBtn}
                          onClick={(e) => { e.stopPropagation(); deleteRegion(region.id); }} title="Delete region">
                          &times;
                        </button>
                      </div>
                      {isEditing && (
                        <RegionEditor region={region}
                          onSave={(updates) => updateRegion(region.id, updates)}
                          onCancel={() => setEditingRegion(null)}
                          onRedraw={() => startRedrawRegion(region)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ═══ HEXES MODE ═══ */}
        {editorMode === 'hexes' && (
          <>
            <div style={{ background: '#16213e', border: '1px solid rgba(217,70,239,0.3)', borderRadius: 6, padding: 10 }}>
              <div style={{ color: '#d946ef', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Hex Terrain Editor
              </div>
              <div style={{ fontSize: 11, marginBottom: 4, color: '#8b949e' }}>
                Click hexes to paint terrain. {HEX_SIZE_MILES} mi/hex ({MAP_WIDTH_MILES} mi map).
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>
                Set a secondary brush for hybrid split hexes (e.g. forest + coastal).
              </div>
            </div>

            {/* Active Brush Preview */}
            <div>
              <div style={{ color: '#d946ef', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Active Brush</div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                background: '#16213e',
                border: `1px solid ${hexPaintTerrain === 'clear' ? '#ff6060' : (TERRAIN_COLORS[hexPaintTerrain] || '#555')}`,
                borderRadius: 4, marginBottom: 4,
              }}>
                {hexPaintTerrain !== 'clear' && hexSecondaryTerrain && hexSecondaryTerrain !== hexPaintTerrain ? (
                  /* Hybrid brush preview — striped swatch */
                  <div style={{ position: 'relative', width: 24, height: 24, borderRadius: 3, overflow: 'hidden', border: '2px solid #fff', flexShrink: 0 }}>
                    <div style={{
                      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      background: `repeating-linear-gradient(45deg, ${TERRAIN_COLORS[hexPaintTerrain] || '#555'}, ${TERRAIN_COLORS[hexPaintTerrain] || '#555'} 4px, ${TERRAIN_COLORS[hexSecondaryTerrain] || '#555'} 4px, ${TERRAIN_COLORS[hexSecondaryTerrain] || '#555'} 8px)`,
                    }} />
                  </div>
                ) : (
                  <div style={{
                    width: 24, height: 24, borderRadius: 3, flexShrink: 0,
                    backgroundColor: hexPaintTerrain === 'clear' ? '#333' : (TERRAIN_COLORS[hexPaintTerrain] || '#555'),
                    border: '2px solid #fff',
                  }} />
                )}
                <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: 12, color: '#d4c5a9' }}>
                  {hexPaintTerrain === 'clear' ? 'Eraser' : hexPaintTerrain}
                  {hexSecondaryTerrain && hexSecondaryTerrain !== hexPaintTerrain && hexPaintTerrain !== 'clear'
                    ? ` / ${hexSecondaryTerrain}` : ''}
                </span>
                {hexSecondaryTerrain && hexPaintTerrain !== 'clear' && (
                  <span style={{ fontSize: 9, color: '#d946ef', marginLeft: 'auto' }}>HYBRID</span>
                )}
              </div>
            </div>

            {/* Primary Terrain */}
            <div>
              <div style={{ color: '#d946ef', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Primary Terrain</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {TERRAIN_TYPES.map(t => (
                  <button
                    key={t}
                    onClick={() => { setHexPaintTerrain(t); if (hexSecondaryTerrain === t) setHexSecondaryTerrain(null); }}
                    style={{
                      padding: '4px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                      border: hexPaintTerrain === t ? '2px solid #fff' : '1px solid rgba(255,215,0,0.3)',
                      backgroundColor: TERRAIN_COLORS[t] || '#555',
                      color: '#fff', fontWeight: hexPaintTerrain === t ? 'bold' : 'normal',
                      textTransform: 'capitalize', textShadow: '0 0 3px #000',
                      minWidth: 55, textAlign: 'center',
                    }}
                  >
                    {t}
                  </button>
                ))}
                <button
                  onClick={() => { setHexPaintTerrain('clear'); setHexSecondaryTerrain(null); }}
                  style={{
                    padding: '4px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                    border: hexPaintTerrain === 'clear' ? '2px solid #fff' : '1px solid rgba(255,60,60,0.3)',
                    backgroundColor: '#333', color: '#ff6060', minWidth: 55, textAlign: 'center',
                  }}
                >
                  Erase
                </button>
              </div>
            </div>

            {/* Secondary Terrain (for hybrid) */}
            {hexPaintTerrain !== 'clear' && (
              <div>
                <div style={{ color: '#d946ef', fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Secondary Terrain
                  <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 400 }}>(hybrid split)</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  <button
                    onClick={() => setHexSecondaryTerrain(null)}
                    style={{
                      padding: '4px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                      border: !hexSecondaryTerrain ? '2px solid #fff' : '1px solid rgba(255,215,0,0.3)',
                      backgroundColor: '#1a1a2e', color: !hexSecondaryTerrain ? '#fff' : '#8b949e',
                      fontWeight: !hexSecondaryTerrain ? 'bold' : 'normal',
                      minWidth: 55, textAlign: 'center',
                    }}
                  >
                    None
                  </button>
                  {TERRAIN_TYPES.filter(t => t !== hexPaintTerrain).map(t => (
                    <button
                      key={t}
                      onClick={() => setHexSecondaryTerrain(t)}
                      style={{
                        padding: '4px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer',
                        border: hexSecondaryTerrain === t ? '2px solid #fff' : '1px solid rgba(255,215,0,0.3)',
                        backgroundColor: TERRAIN_COLORS[t] || '#555',
                        color: '#fff', fontWeight: hexSecondaryTerrain === t ? 'bold' : 'normal',
                        textTransform: 'capitalize', textShadow: '0 0 3px #000',
                        minWidth: 55, textAlign: 'center',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Hex tags (overlays) */}
            {hexPaintTerrain !== 'clear' && (
              <div>
                <div style={{ color: '#d946ef', fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Hex Tags
                  <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 400 }}>(overlays)</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {TAG_CATEGORIES.map(cat => {
                    const catTags = HEX_TAGS.filter(t => t.cat === cat.key);
                    if (catTags.length === 0) return null;
                    return (
                      <div key={cat.key}>
                        <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{cat.label}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {catTags.map(f => {
                            const active = hexPaintTags.has(f.key);
                            return (
                              <button key={f.key}
                                onClick={() => {
                                  setHexPaintTags(prev => {
                                    const next = new Set(prev);
                                    if (next.has(f.key)) next.delete(f.key); else next.add(f.key);
                                    return next;
                                  });
                                }}
                                title={f.desc}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  padding: '3px 7px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                                  border: active ? '2px solid #d946ef' : '1px solid #30363d',
                                  background: active ? 'rgba(217,70,239,0.15)' : '#1a1a2e',
                                  color: active ? '#d4c5a9' : '#8b949e',
                                }}
                              >
                                <span style={{ fontSize: 12 }}>{f.icon}</span>
                                <span style={{ fontWeight: active ? 600 : 400 }}>{f.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Stats */}
            <div style={{ padding: '6px 8px', background: '#16213e', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 4, fontSize: 11, marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: '#8b949e' }}>GM Hex Edits</span>
                <span style={{ color: '#d4c5a9', fontWeight: 600 }}>{gmHexCount}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b949e' }}>Map</span>
                <span style={{ color: '#8b949e' }}>{selectedMapId}</span>
              </div>
            </div>

            {gmHexCount > 0 && (
              <button
                style={{
                  ...sty.btn(false), width: '100%', textAlign: 'center',
                  color: '#ff4444', borderColor: '#ff4444', background: '#1a1a2e',
                }}
                onClick={() => {
                  if (confirm('Clear all GM hex edits for this map?')) {
                    setWorldState?.(prev => {
                      const updated = { ...(prev.gmHexTerrain || {}) };
                      delete updated[selectedMapId];
                      return { ...prev, gmHexTerrain: updated };
                    });
                  }
                }}
              >
                Clear All Hex Edits ({gmHexCount})
              </button>
            )}

            {/* Terrain reference */}
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#8b949e', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>TERRAIN REFERENCE (PF1e)</div>
              <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.6 }}>
                <div><strong style={{ color: '#8fbc3a' }}>Plains</strong> — ×0.75 speed, DC 12</div>
                <div><strong style={{ color: '#2d6b1a' }}>Forest</strong> — ×0.5 speed, DC 15</div>
                <div><strong style={{ color: '#b8860b' }}>Hills</strong> — ×0.5 speed, DC 14</div>
                <div><strong style={{ color: '#808080' }}>Mountain</strong> — ×0.33 speed, DC 16</div>
                <div><strong style={{ color: '#556b2f' }}>Swamp</strong> — ×0.33 speed, DC 16</div>
                <div><strong style={{ color: '#deb887' }}>Desert</strong> — ×0.5 speed, DC 16</div>
                <div><strong style={{ color: '#c0a060' }}>Urban</strong> — Full speed, DC 5</div>
              </div>
              <div style={{ color: '#8b949e', fontSize: 10, fontWeight: 600, marginTop: 6, marginBottom: 2 }}>TAG EFFECTS</div>
              <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.6 }}>
                <div><strong style={{ color: '#c0a878' }}>Road</strong> — Full speed, can't get lost</div>
                <div><strong style={{ color: '#8b7355' }}>Trail</strong> — Half road bonus, DC 14</div>
                <div><strong style={{ color: '#d4a017' }}>Farmland</strong> — Plains speed, rural encounters</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Map area ── */}
      <div
        style={{ ...sty.mapArea, cursor: (isPlacing || editorMode === 'hexes') ? 'crosshair' : 'default' }}
        onClick={handleMapClick}
      >
        {currentMap?.file ? (
          <InteractiveMap
            ref={mapRef}
            mapId={selectedMapId}
            pins={mapPins}
            regions={mapRegions}
            skipRegistryPins={true}
            onPinClick={(pin) => setSelectedPinId(pin.id)}
            onPinDrag={handlePinDrag}
            draggablePins={true}
            fogEnabled={false}
            width="100%"
            height="100%"
            showHexGrid={editorMode === 'hexes'}
            hexTerrainData={hexTerrainData}
            hexSizeMiles={HEX_SIZE_MILES}
            mapWidthMiles={MAP_WIDTH_MILES}
            onHexClick={handleHexClick}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{'\u{1F5FA}\uFE0F'}</div>
              <div>No map image available for "{currentMap?.name || selectedMapId}"</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Add a map image to /public/maps/ and update mapRegistry.js</div>
            </div>
          </div>
        )}

        {/* Placement mode indicator */}
        {isPlacing && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: movingPinId ? 'rgba(0,50,20,0.9)' : drawingRegion ? 'rgba(0,26,74,0.9)' : 'rgba(74,40,0,0.9)',
            border: `1px solid ${movingPinId ? '#44cc44' : drawingRegion ? '#4488ff' : '#ff8c00'}`,
            borderRadius: 8, padding: '8px 16px',
            color: movingPinId ? '#44cc44' : drawingRegion ? '#66aaff' : '#ff8c00',
            fontSize: 13, fontWeight: 600, zIndex: 10, pointerEvents: 'none',
          }}>
            {movingPinId
              ? `Click exact position for "${movingPinLabel}"`
              : drawingRegion
                ? `Click to add vertex for "${drawingRegion.label}" (${drawingRegion.points.length} placed)`
                : `\u{1F4CD} Click anywhere to place "${newPinLabel}"`
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline Pin Editor ──
function PinEditor({ pin, isRegistry, onSave, onCancel }) {
  const [label, setLabel] = useState(pin.label);
  const [type, setType] = useState(pin.type);
  const [notes, setNotes] = useState(pin.notes || '');
  const [xPct, setXPct] = useState(pin.xPct);
  const [yPct, setYPct] = useState(pin.yPct);

  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: 8, marginTop: 2, fontSize: 11 }}>
      {isRegistry && (
        <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 6, fontStyle: 'italic' }}>
          Registry pin — drag on map or edit coordinates below
        </div>
      )}
      {!isRegistry && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input style={{ ...sty.input, flex: 1 }} value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" />
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <input style={{ ...sty.input, width: 60 }} type="number" step="0.1" value={xPct} onChange={e => setXPct(parseFloat(e.target.value) || 0)} />
        <span style={{ color: '#6b7280', lineHeight: '28px' }}>% x</span>
        <input style={{ ...sty.input, width: 60 }} type="number" step="0.1" value={yPct} onChange={e => setYPct(parseFloat(e.target.value) || 0)} />
        <span style={{ color: '#6b7280', lineHeight: '28px' }}>% y</span>
      </div>
      {!isRegistry && (
        <>
          <select style={{ ...sty.select, marginBottom: 4 }} value={type} onChange={e => setType(e.target.value)}>
            {PIN_TYPES.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
          </select>
          <textarea style={{ ...sty.input, height: 36, resize: 'vertical', fontFamily: 'inherit', marginBottom: 4 }}
            value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes..." />
        </>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <button style={{ ...sty.btn(true), flex: 1 }}
          onClick={() => isRegistry ? onSave({ xPct, yPct }) : onSave({ label, type, notes, xPct, yPct })}>Save</button>
        <button style={{ ...sty.btn(false), flex: 1 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Inline Region Editor (polygon) ──
function RegionEditor({ region, onSave, onCancel, onRedraw }) {
  const [label, setLabel] = useState(region.label);
  const [color, setColor] = useState(region.color || '#4488ff');
  const [dashed, setDashed] = useState(region.dashed ?? true);
  const [showLabel, setShowLabel] = useState(region.showLabel !== false);

  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: 8, marginTop: 2, fontSize: 11 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <input style={{ ...sty.input, flex: 1 }} value={label} onChange={e => setLabel(e.target.value)} placeholder="Region label" />
      </div>

      <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{region.points?.length || 0} vertices</span>
        <button onClick={onRedraw}
          style={{ ...sty.btn(false), fontSize: 9, padding: '1px 6px', color: '#ff8c00', borderColor: '#ff8c00' }}>
          Redraw border
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {REGION_COLORS.map(c => (
          <button key={c.key} onClick={() => setColor(c.key)}
            style={{
              width: 20, height: 20, borderRadius: '50%', background: c.key,
              border: `2px solid ${color === c.key ? '#fff' : 'transparent'}`,
              cursor: 'pointer', opacity: color === c.key ? 1 : 0.5,
            }} />
        ))}
      </div>

      <label style={{ color: '#8b949e', fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <input type="checkbox" checked={dashed} onChange={e => setDashed(e.target.checked)} />
        Dashed border
      </label>

      <label style={{ color: '#8b949e', fontSize: 10, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <input type="checkbox" checked={showLabel} onChange={e => setShowLabel(e.target.checked)} />
        Show label on map
      </label>

      <div style={{ display: 'flex', gap: 4 }}>
        <button style={{ ...sty.btn(true), flex: 1 }} onClick={() => onSave({ label, color, dashed, showLabel })}>Save</button>
        <button style={{ ...sty.btn(false), flex: 1 }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
