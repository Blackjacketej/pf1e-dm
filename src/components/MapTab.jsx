import React, { useState, useCallback, useMemo } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import overlandService from '../services/overlandService';
import { ParchmentFrame, TerrainIcon } from './MapAssets';
import InteractiveMap from './InteractiveMap';
import mapRegistry from '../services/mapRegistry';
import { pixelToHex, hexCenter, TERRAIN_COLORS, HEX_TAGS, getTagInfo, parseHexValue } from './HexGridOverlay';

const catIcons = {
  temple: '\u2720', tavern: '\u{1F37A}', shop: '\u{1F6CD}', government: '\u{1F6E1}', craft: '\u{1F528}',
  industry: '\u2699', noble: '\u{1F451}', residence: '\u{1F3E0}', entertainment: '\u2B50', school: '\u{1F4DA}',
  landmark: '\u{1F6A9}', ruin: '\u{1F5FC}', dungeon: '\u{1F480}', encounter: '\u2694', camp: '\u{1F525}', city: '\u{1F3F0}'
};

/*
 * Per-map hex configuration.
 *   Sandpoint Hinterlands: 1-mile hexes across a ~25-mile local map  (~25 hexes across)
 *   Varisia region:        12-mile hexes across a ~350-mile regional map (~29 hexes across)
 *   Fallback:              2-mile hexes / 25-mile span
 */
const HEX_CONFIG = {
  sandpoint_hinterlands: { hexSizeMiles: 1, mapWidthMiles: 25 },
  varisia_region:        { hexSizeMiles: 12, mapWidthMiles: 350 },
};
const DEFAULT_HEX_CONFIG = { hexSizeMiles: 2, mapWidthMiles: 25 };

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

export default function MapTab({ party, campaign, addLog, worldState, setWorldState, gmMode }) {
  const isMobile = useIsMobile();
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [partyMapPos, setPartyMapPos] = useState({ xPct: 50, yPct: 28 });
  const [showHexGrid, setShowHexGrid] = useState(true);
  const [selectedHex, setSelectedHex] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  const locations = useMemo(() => overlandService.getLocations(), []);
  const mapSettings = useMemo(() => overlandService.getMapSettings(), []);

  // Determine which map to show
  const partyLocId = worldState?.partyPosition?.locationId;
  const activeMapId = useMemo(() => {
    const mapEntry = mapRegistry.getOverlandMap(partyLocId ? String(partyLocId) : 'sandpoint');
    return mapEntry?.id || 'sandpoint_hinterlands';
  }, [partyLocId]);

  // Per-map hex config
  const hexConfig = HEX_CONFIG[activeMapId] || DEFAULT_HEX_CONFIG;
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

  // Hex click — show info about the hex
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
    const msg = locNames
      ? `Hex (${hex.col},${hex.row}): ${terrainStr}${featStr} — ${locNames}`
      : `Hex (${hex.col},${hex.row}): ${terrainStr}${featStr}`;
    addLog?.(msg, 'info');
    if (locs.length === 1) setSelectedLocation(locs[0]);
  }, [hexTerrainData, addLog]);

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
          mapId={activeMapId}
          pins={mergedPins}
          regions={mapRegions}
          skipRegistryPins={true}
          partyPosition={partyMapPos}
          onPartyMove={setPartyMapPos}
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
          </div>
        )}
      </div>
    </div>
  );
}
