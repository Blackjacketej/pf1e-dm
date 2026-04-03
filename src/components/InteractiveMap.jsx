import React, { useState, useRef, useCallback, useMemo, useEffect, useImperativeHandle, forwardRef } from 'react';
import useIsMobile from '../hooks/useIsMobile';
import mapRegistry from '../services/mapRegistry';
import HexGridOverlay from './HexGridOverlay';

/**
 * InteractiveMap — renders an official map image with interactive overlays:
 *   - Fog of war (dark tiles that reveal as rooms are explored)
 *   - Party position token (draggable)
 *   - Clickable POI pins (NPCs, traps, loot, doors)
 *   - Zoom and pan controls
 *
 * Props:
 *   mapId        — ID from mapRegistry (e.g. 'foxglove_manor')
 *   mapUrl       — direct image URL (alternative to mapId)
 *   revealedRooms — Set or array of room IDs that have been explored
 *   partyPosition — { xPct, yPct } party token position (percentage of map)
 *   onPartyMove   — callback({ xPct, yPct }) when party token is dragged
 *   pins          — [{ id, label, xPct, yPct, type, onClick }] additional pins
 *   regions       — [{ id, label, xPct, yPct, radiusPct, color, type }] area enclosures
 *   onPinClick    — callback(pin) when a pin is clicked
 *   fogEnabled    — whether fog of war is active (default true)
 *   width         — container width (default '100%')
 *   height        — container height (default '100%')
 *   showLegend    — show map legend panel (default false)
 */
const InteractiveMap = forwardRef(function InteractiveMap({
  mapId,
  mapUrl: directUrl,
  revealedRooms = [],
  partyPosition,
  onPartyMove,
  pins: externalPins = [],
  regions: externalRegions = [],
  onPinClick,
  onPinDrag,        // callback(pinId, { xPct, yPct }) — fired when a pin is dragged to a new position
  draggablePins = false, // enable pin dragging (GM editor mode)
  skipRegistryPins = false, // when true, don't merge mapData.poi — caller provides all pins via `pins`
  fogEnabled = true,
  width = '100%',
  height = '100%',
  showLegend = false,
  currentRoom,
  addLog,
  // Hex grid overlay props
  showHexGrid = false,
  hexTerrainData = null,     // Map<"col,row", { terrain, label }>
  highlightedHex = null,     // "col,row"
  hexRoute = [],             // ["col,row", ...]
  onHexClick = null,
  hexSizeMiles = 12,
  mapWidthMiles = 50,
}, ref) {
  const isMobile = useIsMobile();
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(null); // 'pan' | 'party' | null
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [hoveredPin, setHoveredPin] = useState(null);

  // Expose focusPin method to parent via ref
  useImperativeHandle(ref, () => ({
    focusPin(xPct, yPct, targetZoom = 2.5) {
      if (!containerRef.current || !imgSize.w) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Calculate the pan needed to center the given percentage point
      const imgW = imgSize.w * targetZoom;
      const imgH = imgSize.h * targetZoom;
      const pinPxX = (xPct / 100) * imgW;
      const pinPxY = (yPct / 100) * imgH;
      const newPanX = rect.width / 2 - pinPxX;  // offset so pin is at container center
      const newPanY = rect.height / 2 - pinPxY;
      // The map is positioned with transform: translate(-50%, -50%) translate(pan) scale(zoom)
      // So pan needs to account for the centered origin
      const offsetX = (rect.width - imgW) / 2;
      const offsetY = (rect.height - imgH) / 2;
      setPan({ x: newPanX - offsetX, y: newPanY - offsetY });
      setZoom(targetZoom);
    },
  }), [imgSize]);

  // Resolve map data
  const mapData = useMemo(() => {
    if (mapId) return mapRegistry.getMap(mapId);
    return null;
  }, [mapId]);

  const imageUrl = directUrl || (mapData ? mapRegistry.getMapUrl(mapData.id) : null);

  // Combine registry POIs with external pins (unless caller provides all pins)
  const allPins = useMemo(() => {
    if (skipRegistryPins) return externalPins;
    const registryPins = mapData?.poi || [];
    return [...registryPins, ...externalPins];
  }, [mapData, externalPins, skipRegistryPins]);

  // Revealed rooms as a Set for fast lookup
  const revealedSet = useMemo(() => {
    return new Set(Array.isArray(revealedRooms) ? revealedRooms : []);
  }, [revealedRooms]);

  // Handle image load
  const handleImgLoad = useCallback((e) => {
    setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    setImgLoaded(true);
  }, []);

  // Zoom controls
  const handleZoomIn = () => setZoom(z => Math.min(4, z + 0.25));
  const handleZoomOut = () => setZoom(z => Math.max(0.25, z - 0.25));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom(z => Math.max(0.25, Math.min(4, z + delta)));
  }, []);

  const [dragPinId, setDragPinId] = useState(null);

  // Pan and drag handling
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDragStart({ x: e.clientX, y: e.clientY });
    setDragging('pan');
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!dragging) return;

    if (dragging === 'pan') {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setDragStart({ x: e.clientX, y: e.clientY });
    }

    if (dragging === 'pin' && dragPinId && onPinDrag && containerRef.current) {
      // Calculate pin position from mouse position
      const img = containerRef.current.querySelector('img');
      if (!img) return;
      const imgRect = img.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(100, ((e.clientX - imgRect.left) / imgRect.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((e.clientY - imgRect.top) / imgRect.height) * 100));
      onPinDrag(dragPinId, {
        xPct: Math.round(xPct * 10) / 10,
        yPct: Math.round(yPct * 10) / 10,
      });
    }
  }, [dragging, dragStart, dragPinId, onPinDrag]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setDragPinId(null);
  }, []);

  // Party token drag
  const handlePartyDragStart = useCallback((e) => {
    e.stopPropagation();
    setDragging('party');
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  // Click on map to move party
  const handleMapClick = useCallback((e) => {
    if (!onPartyMove || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mapW = imgSize.w * zoom;
    const mapH = imgSize.h * zoom;
    const offsetX = (rect.width - mapW) / 2 + pan.x;
    const offsetY = (rect.height - mapH) / 2 + pan.y;

    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;

    if (clickX >= 0 && clickY >= 0 && clickX <= mapW && clickY <= mapH) {
      const xPct = (clickX / mapW) * 100;
      const yPct = (clickY / mapH) * 100;
      onPartyMove({ xPct, yPct });
    }
  }, [onPartyMove, imgSize, zoom, pan]);

  // Pin type styling
  const pinStyles = {
    town: { color: '#ffd700', icon: '\u{1F3F0}', size: 22 },
    city: { color: '#ff6428', icon: '\u{1F3DB}', size: 24 },
    tavern: { color: '#d4a574', icon: '\u{1F37A}', size: 18 },
    temple: { color: '#87ceeb', icon: '\u2720', size: 18 },
    shop: { color: '#7fff00', icon: '\u{1F6CD}', size: 18 },
    dungeon: { color: '#ff4040', icon: '\u{1F480}', size: 20 },
    ruin: { color: '#b090d0', icon: '\u{1F5FC}', size: 20 },
    building: { color: '#d4c5a9', icon: '\u{1F3E0}', size: 16 },
    government: { color: '#4488cc', icon: '\u{1F6E1}', size: 18 },
    npc: { color: '#ff88cc', icon: '\u{1F464}', size: 16 },
    trap: { color: '#ff0000', icon: '\u26A0', size: 18 },
    loot: { color: '#ffd700', icon: '\u{1F4B0}', size: 18 },
    door: { color: '#8b7355', icon: '\u{1F6AA}', size: 16 },
    encounter: { color: '#ff4040', icon: '\u2694', size: 20 },
    default: { color: '#d4c5a9', icon: '\u{1F4CD}', size: 16 },
  };

  if (!imageUrl) {
    return (
      <div style={{
        width, height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#0d1117', color: '#555', fontFamily: 'inherit', fontSize: '13px',
        border: '1px solid #30363d', borderRadius: '4px',
      }}>
        {mapId ? `No map found for: ${mapId}` : 'No map selected'}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width, height, position: 'relative', overflow: 'hidden',
        backgroundColor: '#0d1117', cursor: dragging === 'pan' ? 'grabbing' : 'grab',
        border: '1px solid #30363d', borderRadius: '4px',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onDoubleClick={handleMapClick}
    >
      {/* Map Image Layer */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%',
        transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'center center',
        transition: dragging ? 'none' : 'transform 0.1s ease',
      }}>
        <img
          src={imageUrl}
          alt={mapData?.name || 'Map'}
          onLoad={handleImgLoad}
          style={{
            display: 'block',
            maxWidth: 'none',
            imageRendering: zoom > 2 ? 'pixelated' : 'auto',
          }}
          draggable={false}
        />

        {/* Fog of War Overlay */}
        {fogEnabled && imgLoaded && (
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
          >
            <defs>
              <radialGradient id="fogReveal">
                <stop offset="0%" stopColor="black" />
                <stop offset="70%" stopColor="black" />
                <stop offset="100%" stopColor="white" />
              </radialGradient>
              {partyPosition && (
                <mask id="fogMask">
                  <rect width={imgSize.w} height={imgSize.h} fill="white" />
                  {/* Reveal around party position */}
                  <circle
                    cx={partyPosition.xPct / 100 * imgSize.w}
                    cy={partyPosition.yPct / 100 * imgSize.h}
                    r={imgSize.w * 0.08}
                    fill="black"
                  />
                  {/* Reveal explored rooms */}
                  {Array.from(revealedSet).map((roomId, i) => {
                    const pin = allPins.find(p => p.id === roomId);
                    if (!pin) return null;
                    return (
                      <circle
                        key={roomId}
                        cx={pin.xPct / 100 * imgSize.w}
                        cy={pin.yPct / 100 * imgSize.h}
                        r={imgSize.w * 0.06}
                        fill="black"
                      />
                    );
                  })}
                </mask>
              )}
            </defs>
            {partyPosition && (
              <rect
                width={imgSize.w} height={imgSize.h}
                fill="rgba(0,0,0,0.7)"
                mask="url(#fogMask)"
              />
            )}
          </svg>
        )}

        {/* Region Enclosures (polygon-based) */}
        {imgLoaded && externalRegions.length > 0 && (
          <svg
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
          >
            {externalRegions.map(region => {
              const points = region.points;
              if (!points || points.length < 2) return null;
              const color = region.color || '#ffd700';
              const isDrawing = region.id === '__drawing__';
              // Convert percentage points to pixel coordinates
              const pixelPoints = points.map(p => ({
                x: (p.xPct / 100) * imgSize.w,
                y: (p.yPct / 100) * imgSize.h,
              }));
              const pathData = pixelPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
                + (points.length >= 3 && !isDrawing ? ' Z' : '');
              // Compute centroid for label placement
              const cx = pixelPoints.reduce((s, p) => s + p.x, 0) / pixelPoints.length;
              const cy = pixelPoints.reduce((s, p) => s + p.y, 0) / pixelPoints.length;
              // Compute rough bounding size for font scaling
              const minY = Math.min(...pixelPoints.map(p => p.y));

              return (
                <g key={region.id}>
                  <path
                    d={pathData}
                    fill={points.length >= 3 && !isDrawing ? color : 'none'}
                    fillOpacity={0.08}
                    stroke={color}
                    strokeOpacity={isDrawing ? 0.8 : 0.5}
                    strokeWidth={isDrawing ? 2.5 : 2}
                    strokeDasharray={region.dashed ? '8 4' : 'none'}
                    strokeLinejoin="round"
                  />
                  {/* Vertex dots */}
                  {isDrawing && pixelPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4}
                      fill={i === 0 ? '#44cc44' : color} fillOpacity={0.9}
                      stroke="#000" strokeWidth={1} />
                  ))}
                  {/* Label */}
                  {points.length >= 3 && region.showLabel !== false && (
                    <text
                      x={cx} y={minY - 8}
                      textAnchor="middle"
                      fill={color} fillOpacity={0.7}
                      fontSize={14}
                      fontFamily="Georgia, serif"
                      fontWeight="bold"
                      style={{ pointerEvents: 'none' }}
                    >
                      {region.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Hex Grid Overlay */}
        {imgLoaded && showHexGrid && (
          <HexGridOverlay
            imgW={imgSize.w}
            imgH={imgSize.h}
            hexSizeMiles={hexSizeMiles}
            mapWidthMiles={mapWidthMiles}
            visible={true}
            terrainData={hexTerrainData}
            highlightedHex={highlightedHex}
            routeHexes={hexRoute}
            onHexClick={onHexClick}
          />
        )}

        {/* POI Pins */}
        {imgLoaded && allPins.map(pin => {
          const style = pinStyles[pin.type] || pinStyles.default;
          const isHovered = hoveredPin === pin.id;
          const isDraggingThis = dragPinId === pin.id;
          const canDrag = draggablePins && onPinDrag;
          // Counter-scale so pin icons stay a consistent visual size regardless of zoom
          const pinScale = (1 / zoom) * (isDraggingThis ? 1.4 : isHovered ? 1.3 : 1);
          return (
            <div
              key={pin.id}
              style={{
                position: 'absolute',
                left: `${pin.xPct}%`, top: `${pin.yPct}%`,
                transform: `translate(-50%, -50%) scale(${pinScale})`,
                cursor: canDrag ? (isDraggingThis ? 'grabbing' : 'grab') : 'pointer',
                fontSize: `${style.size}px`,
                filter: `drop-shadow(0 0 3px ${style.color})${isDraggingThis ? ' drop-shadow(0 0 8px #ff8c00)' : ''}`,
                transition: isDraggingThis ? 'none' : 'transform 0.15s',
                zIndex: isDraggingThis ? 200 : isHovered ? 100 : 10,
                pointerEvents: 'auto',
              }}
              onMouseEnter={() => setHoveredPin(pin.id)}
              onMouseLeave={() => { if (!isDraggingThis) setHoveredPin(null); }}
              onMouseDown={(e) => {
                if (canDrag) {
                  e.stopPropagation();
                  e.preventDefault();
                  setDragging('pin');
                  setDragPinId(pin.id);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!isDraggingThis) onPinClick?.(pin);
              }}
              title={canDrag ? `${pin.label} (drag to move)` : pin.label}
            >
              {style.icon}
              {/* Label on hover */}
              {(isHovered || isDraggingThis) && (
                <div style={{
                  position: 'absolute', top: '-24px', left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(0,0,0,0.9)',
                  color: isDraggingThis ? '#ff8c00' : style.color,
                  padding: '2px 8px',
                  borderRadius: '3px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  border: `1px solid ${isDraggingThis ? '#ff8c00' : style.color}`,
                  pointerEvents: 'none',
                }}>
                  {pin.label}{isDraggingThis ? ` (${pin.xPct}%, ${pin.yPct}%)` : ''}
                </div>
              )}
            </div>
          );
        })}

        {/* Party Token */}
        {imgLoaded && partyPosition && (
          <div
            style={{
              position: 'absolute',
              left: `${partyPosition.xPct}%`,
              top: `${partyPosition.yPct}%`,
              transform: 'translate(-50%, -50%)',
              width: '28px', height: '28px',
              borderRadius: '50%',
              backgroundColor: '#ffd700',
              border: '3px solid #1a1a2e',
              boxShadow: '0 0 12px rgba(255,215,0,0.8), 0 0 4px rgba(255,215,0,0.4)',
              cursor: 'grab',
              zIndex: 50,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px',
              pointerEvents: 'auto',
            }}
            onMouseDown={handlePartyDragStart}
            title="Party Position"
          >
            \u2694
          </div>
        )}
      </div>

      {/* Zoom Controls */}
      <div style={{
        position: 'absolute', bottom: isMobile ? '60px' : '10px', right: '10px',
        display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 200,
      }}>
        <button onClick={handleZoomIn} style={{ ...btnStyle, width: isMobile ? '44px' : '32px', height: isMobile ? '44px' : '32px' }} title="Zoom In">+</button>
        <button onClick={handleZoomReset} style={{ ...btnStyle, width: isMobile ? '44px' : '32px', height: isMobile ? '44px' : '32px', fontSize: isMobile ? '12px' : '14px' }} title="Reset View">
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={handleZoomOut} style={{ ...btnStyle, width: isMobile ? '44px' : '32px', height: isMobile ? '44px' : '32px' }} title="Zoom Out">−</button>
      </div>

      {/* Map Name Banner */}
      {mapData && (
        <div style={{
          position: 'absolute', top: '8px', left: '8px',
          backgroundColor: 'rgba(0,0,0,0.85)',
          color: '#ffd700',
          padding: '4px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 'bold',
          fontFamily: 'Georgia, serif',
          border: '1px solid rgba(255,215,0,0.3)',
          zIndex: 200,
          letterSpacing: '0.5px',
        }}>
          {mapData.name}
          {mapData.chapter !== undefined && (
            <span style={{ color: '#8b949e', fontSize: '10px', marginLeft: '8px' }}>
              {typeof mapData.chapter === 'number' ? `Ch. ${mapData.chapter}` : mapData.chapter}
            </span>
          )}
        </div>
      )}

      {/* Legend Panel */}
      {showLegend && (
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          backgroundColor: 'rgba(0,0,0,0.9)',
          border: '1px solid #30363d',
          borderRadius: '4px',
          padding: '8px',
          zIndex: 200,
          maxHeight: '200px',
          overflowY: 'auto',
          fontSize: '10px',
          color: '#d4c5a9',
        }}>
          <div style={{ color: '#ffd700', fontWeight: 'bold', marginBottom: '4px' }}>Legend</div>
          {Object.entries(pinStyles).filter(([k]) => k !== 'default').map(([type, style]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '1px 0' }}>
              <span style={{ fontSize: `${style.size - 4}px` }}>{style.icon}</span>
              <span style={{ color: style.color, textTransform: 'capitalize' }}>{type}</span>
            </div>
          ))}
          <div style={{ borderTop: '1px solid #30363d', marginTop: '4px', paddingTop: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '14px' }}>\u2694</span>
              <span style={{ color: '#ffd700' }}>Party</span>
            </div>
            <div style={{ color: '#555', marginTop: '2px' }}>Double-click to move party</div>
            <div style={{ color: '#555' }}>Scroll to zoom, drag to pan</div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {!imgLoaded && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#555', fontSize: '13px',
        }}>
          Loading map...
        </div>
      )}
    </div>
  );
});

export default InteractiveMap;

const btnStyle = {
  width: '32px', height: '32px',
  backgroundColor: 'rgba(0,0,0,0.85)',
  color: '#ffd700',
  border: '1px solid rgba(255,215,0,0.3)',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 'bold',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  touchAction: 'manipulation',
};
