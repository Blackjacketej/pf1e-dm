import React, { useState, useMemo, useCallback } from 'react';
import {
  initTravel,
  travelOneHour,
  makeCamp,
  getPartySpeed,
  calculateTravelDistance,
  getTimeOfDay,
  getTerrainAtPosition,
  getRegionAtPosition,
  findLocation,
  findLocationByName,
  getLocations,
  getNearbyLocations,
  checkGettingLost,
  dailyEncounterChecks,
  getMountSpeeds,
} from '../services/overlandService';

/**
 * TravelPanel — slide-in panel for managing overland travel.
 * Shows current travel state, destination picker, day-by-day simulation,
 * travel log, and controls for march/rest/forage.
 *
 * Props:
 *   party       — current party array
 *   worldState  — global world state (for weather, day, hour)
 *   setWorldState — setter
 *   addLog      — game log callback
 *   onClose     — close panel callback
 */

const sty = {
  panel: { display: 'flex', flexDirection: 'column', height: '100%', color: '#d4c5a9', fontFamily: 'Georgia, serif' },
  header: { padding: '12px 16px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: '16px', fontWeight: 'bold', color: '#ffd700' },
  body: { flex: 1, overflowY: 'auto', padding: '12px 16px' },
  section: { marginBottom: '16px' },
  sectionTitle: { fontSize: '13px', fontWeight: 'bold', color: '#ffd700', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: '12px' },
  label: { color: '#8b949e' },
  value: { color: '#d4c5a9', fontWeight: 'bold' },
  select: { background: '#161b22', color: '#d4c5a9', border: '1px solid #30363d', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', width: '100%', marginTop: '4px' },
  btn: { background: '#161b22', color: '#ffd700', border: '1px solid rgba(255,215,0,0.3)', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', fontFamily: 'Georgia, serif' },
  btnPrimary: { background: 'rgba(255,215,0,0.15)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.4)', borderRadius: '4px', padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', fontFamily: 'Georgia, serif' },
  btnDanger: { background: 'rgba(255,60,60,0.15)', color: '#ff6060', border: '1px solid rgba(255,60,60,0.3)', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', fontFamily: 'Georgia, serif' },
  logEntry: { fontSize: '11px', padding: '3px 0', borderBottom: '1px solid rgba(48,54,61,0.4)' },
  logTime: { color: '#555', fontSize: '10px', marginRight: '6px' },
  logEvent: { color: '#d4c5a9' },
  logEncounter: { color: '#ff6040', fontWeight: 'bold' },
  logArrival: { color: '#44cc44', fontWeight: 'bold' },
  stat: { display: 'inline-block', padding: '3px 8px', margin: '2px', borderRadius: '3px', fontSize: '11px', background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.15)' },
  input: { background: '#161b22', color: '#d4c5a9', border: '1px solid #30363d', borderRadius: '4px', padding: '4px 8px', fontSize: '12px', width: '100%' },
};

export default function TravelPanel({ party, worldState, setWorldState, addLog, onClose }) {
  const [travelState, setTravelState] = useState(null);
  const [destinationId, setDestinationId] = useState('');
  const [destinationSearch, setDestinationSearch] = useState('');
  const [mounted, setMounted] = useState(false);
  const [mountType, setMountType] = useState('light_horse');
  const [simulationLog, setSimulationLog] = useState([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [showHexGrid, setShowHexGrid] = useState(true);

  const locations = useMemo(() => getLocations(), []);
  const mountSpeeds = useMemo(() => getMountSpeeds(), []);
  const partySpeed = useMemo(() => {
    if (mounted && mountSpeeds[mountType]) return mountSpeeds[mountType].speed;
    return getPartySpeed(party);
  }, [party, mounted, mountType, mountSpeeds]);

  // Filtered destination list
  const filteredLocations = useMemo(() => {
    if (!destinationSearch) return locations;
    const q = destinationSearch.toLowerCase();
    return locations.filter(l => l.name.toLowerCase().includes(q));
  }, [locations, destinationSearch]);

  const destination = useMemo(() => {
    return destinationId ? findLocation(Number(destinationId)) : null;
  }, [destinationId]);

  // Current terrain info
  const currentTerrain = useMemo(() => {
    if (!travelState) return null;
    return getTerrainAtPosition(travelState.partyX, travelState.partyY);
  }, [travelState]);

  const currentRegion = useMemo(() => {
    if (!travelState) return null;
    return getRegionAtPosition(travelState.partyX, travelState.partyY);
  }, [travelState]);

  const timeOfDay = useMemo(() => {
    const hour = travelState?.hour ?? worldState.currentHour ?? 8;
    return getTimeOfDay(hour);
  }, [travelState, worldState.currentHour]);

  // Start travel
  const handleStartTravel = useCallback(() => {
    if (!destination) return;
    // Find starting location — use current party position or default to Sandpoint
    const startId = worldState.partyPosition?.locationId === 'sandpoint' ? 1 : 1;
    const state = initTravel(party, startId);
    state.mounted = mounted;
    state.mountType = mounted ? mountType : null;
    setTravelState(state);
    setSimulationLog([{ time: 'Day 1, 8:00 AM', text: `Travel begins toward ${destination.name}`, type: 'info' }]);
    addLog(`The party sets out toward ${destination.name}.`, 'narration');
  }, [destination, party, mounted, mountType, worldState, addLog]);

  // Simulate one hour of travel
  const handleTravelHour = useCallback(() => {
    if (!travelState || !destination) return;
    const terrain = getTerrainAtPosition(travelState.partyX, travelState.partyY);
    const region = getRegionAtPosition(travelState.partyX, travelState.partyY);

    // Determine road type based on location
    let roadType = 'trackless';
    if (terrain === 'urban' || terrain === 'road') roadType = 'road';
    else if (region?.type === 'road') roadType = 'trail';

    const weatherPenalty = worldState.currentWeather?.speedPenalty || 0;
    const result = travelOneHour(travelState, party, destination, terrain, roadType, weatherPenalty);

    const hour = travelState.hour;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const timeStr = `Day ${travelState.dayNumber}, ${h12}:00 ${ampm}`;

    const newEntries = [
      { time: timeStr, text: `Traveled ${result.milesTraveled.toFixed(1)} mi through ${terrain}. ${result.distanceRemaining.toFixed(1)} mi remaining.`, type: 'info' },
      ...result.events.map(e => ({
        time: timeStr,
        text: e,
        type: e.includes('Encounter') ? 'encounter' : e.includes('Arrived') ? 'arrival' : 'info',
      })),
    ];

    setSimulationLog(prev => [...prev, ...newEntries]);
    setTravelState({ ...travelState }); // trigger re-render

    // Log encounters to game log
    result.events.forEach(e => {
      if (e.includes('Encounter')) addLog(e, 'danger');
      else if (e.includes('Arrived')) addLog(e, 'narration');
    });

    if (result.arrived) {
      addLog(`The party has arrived at ${destination.name}!`, 'narration');
    }
  }, [travelState, destination, party, worldState, addLog]);

  // Simulate a full day of travel (8 hours)
  const handleTravelDay = useCallback(() => {
    if (!travelState || !destination) return;
    setIsSimulating(true);

    const newEntries = [];
    for (let i = 0; i < 8; i++) {
      if (travelState.currentLocation?.id === destination.id) break;

      const terrain = getTerrainAtPosition(travelState.partyX, travelState.partyY);
      let roadType = 'trackless';
      if (terrain === 'urban' || terrain === 'road') roadType = 'road';
      const region = getRegionAtPosition(travelState.partyX, travelState.partyY);
      if (region?.type === 'road') roadType = 'trail';

      const weatherPenalty = worldState.currentWeather?.speedPenalty || 0;
      const result = travelOneHour(travelState, party, destination, terrain, roadType, weatherPenalty);

      const hour = travelState.hour;
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const timeStr = `Day ${travelState.dayNumber}, ${h12}:00 ${ampm}`;

      newEntries.push({ time: timeStr, text: `+${result.milesTraveled.toFixed(1)} mi (${terrain})`, type: 'info' });
      result.events.forEach(e => {
        newEntries.push({
          time: timeStr,
          text: e,
          type: e.includes('Encounter') ? 'encounter' : e.includes('Arrived') ? 'arrival' : 'info',
        });
        if (e.includes('Encounter')) addLog(e, 'danger');
        else if (e.includes('Arrived')) addLog(e, 'narration');
      });

      if (result.arrived) break;
    }

    // Navigation check for the day
    if (party.length > 0 && currentTerrain !== 'road' && currentTerrain !== 'urban') {
      const navigator = party[0]; // party leader navigates
      const lostCheck = checkGettingLost(navigator, currentTerrain || 'plains', []);
      newEntries.push({ time: `Day ${travelState.dayNumber}`, text: lostCheck.description, type: lostCheck.lost ? 'encounter' : 'info' });
      if (lostCheck.lost) {
        travelState.lost = true;
        travelState.lostDirection = lostCheck.deviation;
        addLog(lostCheck.description, 'danger');
      }
    }

    setSimulationLog(prev => [...prev, ...newEntries]);
    setTravelState({ ...travelState });
    setIsSimulating(false);
  }, [travelState, destination, party, worldState, currentTerrain, addLog]);

  // Make camp
  const handleMakeCamp = useCallback(() => {
    if (!travelState) return;
    const result = makeCamp(travelState, party);
    const campEntries = result.events.map(e => ({
      time: `Day ${travelState.dayNumber - 1} night`,
      text: e,
      type: e.includes('Encounter') ? 'encounter' : 'info',
    }));
    setSimulationLog(prev => [...prev, ...campEntries]);
    setTravelState({ ...travelState });

    result.events.forEach(e => {
      if (e.includes('Encounter')) addLog(e, 'danger');
    });
    addLog(`The party makes camp. Day ${travelState.dayNumber} dawns.`, 'narration');
  }, [travelState, party, addLog]);

  // End travel
  const handleEndTravel = useCallback(() => {
    setTravelState(null);
    setSimulationLog([]);
    setDestinationId('');
  }, []);

  // Calculate estimated travel time
  const estimate = useMemo(() => {
    if (!destination || !travelState) return null;
    const terrain = currentTerrain || 'plains';
    const info = calculateTravelDistance(partySpeed, terrain, 'trackless');
    const dx = destination.x - (travelState?.partyX || 500);
    const dy = destination.y - (travelState?.partyY || 370);
    const distPixels = Math.sqrt(dx * dx + dy * dy);
    const distMiles = distPixels / 10;
    const days = info.finalMiles > 0 ? Math.ceil(distMiles / info.finalMiles) : '?';
    return { miles: distMiles.toFixed(1), days, milesPerDay: info.finalMiles, terrain: info.terrain };
  }, [destination, travelState, partySpeed, currentTerrain]);

  return (
    <div style={sty.panel}>
      {/* Header */}
      <div style={sty.header}>
        <div style={sty.title}>⛺ Overland Travel</div>
        <button style={sty.btn} onClick={onClose}>✕</button>
      </div>

      <div style={sty.body}>
        {/* Party Stats */}
        <div style={sty.section}>
          <div style={sty.sectionTitle}>Party Status</div>
          <div>
            <span style={sty.stat}>🏃 Speed: {partySpeed} ft</span>
            <span style={sty.stat}>⏰ {timeOfDay?.name || 'Morning'}</span>
            <span style={sty.stat}>📅 Day {travelState?.dayNumber || worldState.currentDay || 1}</span>
            {travelState && <span style={sty.stat}>🎒 Rations: {travelState.rations}</span>}
            {travelState && <span style={sty.stat}>💧 Water: {travelState.waterSkins}</span>}
          </div>
          {currentRegion && (
            <div style={{ ...sty.row, marginTop: '6px' }}>
              <span style={sty.label}>Region:</span>
              <span style={sty.value}>{currentRegion.name} ({currentRegion.terrain})</span>
            </div>
          )}
        </div>

        {/* Mount Selection */}
        <div style={sty.section}>
          <div style={sty.sectionTitle}>Mount</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ fontSize: '12px', color: '#8b949e' }}>
              <input type="checkbox" checked={mounted} onChange={e => setMounted(e.target.checked)} />
              {' '}Mounted
            </label>
            {mounted && (
              <select style={sty.select} value={mountType} onChange={e => setMountType(e.target.value)}>
                {Object.entries(mountSpeeds).map(([k, v]) => (
                  <option key={k} value={k}>{v.name} ({v.speed} ft / {v.daily} mi/day)</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Hex Grid Toggle */}
        <div style={sty.section}>
          <label style={{ fontSize: '12px', color: '#8b949e', cursor: 'pointer' }}>
            <input type="checkbox" checked={showHexGrid} onChange={e => setShowHexGrid(e.target.checked)} />
            {' '}Show Hex Grid on Map
          </label>
        </div>

        {!travelState ? (
          <>
            {/* Destination Picker */}
            <div style={sty.section}>
              <div style={sty.sectionTitle}>Destination</div>
              <input
                style={sty.input}
                placeholder="Search locations..."
                value={destinationSearch}
                onChange={e => setDestinationSearch(e.target.value)}
              />
              <select
                style={{ ...sty.select, marginTop: '6px', height: '120px' }}
                size={6}
                value={destinationId}
                onChange={e => setDestinationId(e.target.value)}
              >
                {filteredLocations.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {l.category} ({l.region})
                  </option>
                ))}
              </select>
              {destination && (
                <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px', padding: '6px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>
                  <strong style={{ color: '#d4c5a9' }}>{destination.name}</strong>
                  <br />{destination.description}
                </div>
              )}
            </div>

            {/* Estimate */}
            {estimate && (
              <div style={sty.section}>
                <div style={sty.sectionTitle}>Estimate</div>
                <div style={sty.row}><span style={sty.label}>Distance:</span> <span style={sty.value}>~{estimate.miles} miles</span></div>
                <div style={sty.row}><span style={sty.label}>Daily rate:</span> <span style={sty.value}>{estimate.milesPerDay} mi/day</span></div>
                <div style={sty.row}><span style={sty.label}>Est. days:</span> <span style={sty.value}>{estimate.days}</span></div>
                <div style={sty.row}><span style={sty.label}>Terrain:</span> <span style={sty.value}>{estimate.terrain}</span></div>
              </div>
            )}

            {/* Start Button */}
            <button
              style={{ ...sty.btnPrimary, width: '100%', marginTop: '8px' }}
              disabled={!destination}
              onClick={handleStartTravel}
            >
              🗺️ Begin Journey{destination ? ` to ${destination.name}` : ''}
            </button>
          </>
        ) : (
          <>
            {/* Active Travel Controls */}
            <div style={sty.section}>
              <div style={sty.sectionTitle}>
                Traveling to: {destination?.name || 'Unknown'}
              </div>
              <div style={sty.row}>
                <span style={sty.label}>Miles traveled:</span>
                <span style={sty.value}>{travelState.totalMilesTraveled.toFixed(1)}</span>
              </div>
              <div style={sty.row}>
                <span style={sty.label}>Hours walked today:</span>
                <span style={sty.value}>{travelState.hoursWalked} / 8</span>
              </div>
              {travelState.lost && (
                <div style={{ color: '#ff6040', fontSize: '12px', fontWeight: 'bold', marginTop: '4px' }}>
                  ⚠ Party is lost! Drifting {travelState.lostDirection}.
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                <button style={sty.btnPrimary} onClick={handleTravelHour} disabled={isSimulating}>
                  🚶 March 1 Hour
                </button>
                <button style={sty.btnPrimary} onClick={handleTravelDay} disabled={isSimulating}>
                  🌄 March Full Day
                </button>
                <button style={sty.btn} onClick={handleMakeCamp}>
                  ⛺ Make Camp
                </button>
                <button style={sty.btnDanger} onClick={handleEndTravel}>
                  🛑 End Travel
                </button>
              </div>
            </div>

            {/* Travel Log */}
            <div style={sty.section}>
              <div style={sty.sectionTitle}>Travel Log</div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', padding: '6px' }}>
                {simulationLog.length === 0 && (
                  <div style={{ color: '#555', fontSize: '11px' }}>No entries yet.</div>
                )}
                {simulationLog.map((entry, i) => (
                  <div key={i} style={sty.logEntry}>
                    <span style={sty.logTime}>{entry.time}</span>
                    <span style={
                      entry.type === 'encounter' ? sty.logEncounter :
                      entry.type === 'arrival' ? sty.logArrival :
                      sty.logEvent
                    }>
                      {entry.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
