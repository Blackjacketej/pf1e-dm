import { useState, useEffect } from 'react';
import {
  rollFateQuestion,
  rollMeaningPair,
  testScene,
  rollSceneAdjustment,
  generateRandomEvent,
  MEANING_TABLES,
} from '../data/mythicGME.js';
import dmEngine from '../services/dmEngine';

const ODDS = [
  { key: 'impossible', label: 'Impossible' },
  { key: 'nearlyImpossible', label: 'Nearly Impossible' },
  { key: 'veryUnlikely', label: 'Very Unlikely' },
  { key: 'unlikely', label: 'Unlikely' },
  { key: '5050', label: '50/50' },
  { key: 'likely', label: 'Likely' },
  { key: 'veryLikely', label: 'Very Likely' },
  { key: 'nearlyCertain', label: 'Nearly Certain' },
  { key: 'certain', label: 'Certain' },
];

const MEANING_TABLE_PAIRS = [
  { label: 'Action', t1: 'action1', t2: 'action2' },
  { label: 'Description', t1: 'descriptor1', t2: 'descriptor2' },
  { label: 'Action + Description', t1: 'action1', t2: 'descriptor1' },
];

export default function MythicTab({ addLog, worldState, setWorldState, party }) {
  const chaosFactor = worldState.mythic.chaosFactor;
  const threads = worldState.mythic.threads;
  const characters = worldState.mythic.characters;

  const [newThread, setNewThread] = useState('');
  const [newCharacter, setNewCharacter] = useState('');
  const [selectedOdds, setSelectedOdds] = useState('5050');
  const [fateResult, setFateResult] = useState(null);
  const [sceneResult, setSceneResult] = useState(null);
  const [meaningResult, setMeaningResult] = useState(null);
  const [eventResult, setEventResult] = useState(null);
  const [resultLog, setResultLog] = useState([]);

  // Sync worldState to dmEngine on mount and when mythic state changes
  useEffect(() => {
    dmEngine.chaosFactor = chaosFactor;
    dmEngine.threads = [...threads];
    dmEngine.characters = [...characters];
    dmEngine.saveMythicState();
  }, [chaosFactor, threads, characters]);

  // Helper to update mythic state in worldState
  const updateMythic = (key, value) => {
    setWorldState(prev => ({
      ...prev,
      mythic: {
        ...prev.mythic,
        [key]: typeof value === 'function' ? value(prev.mythic[key]) : value
      }
    }));
  };

  const logResult = (text) => {
    setResultLog(prev => [{ text, time: Date.now() }, ...prev].slice(0, 50));
    addLog?.(`[Mythic] ${text}`, 'system');
  };

  // ── Fate Question ──
  const askFate = () => {
    const result = dmEngine.askFateQuestion(selectedOdds);
    setFateResult(result);
    const oddsLabel = ODDS.find(o => o.key === selectedOdds)?.label || selectedOdds;
    let text = `Fate Check (${oddsLabel}, CF ${chaosFactor}): ${result.answer.toUpperCase()}`;
    if (result.exceptional) text += ' (EXCEPTIONAL!)';
    if (result.randomEvent) {
      text += ` + RANDOM EVENT!`;
      if (result.event) {
        text += ` Focus: ${result.event.focus}`;
      }
    }
    logResult(text);
  };

  // ── Scene Test ──
  const testNewScene = () => {
    const result = dmEngine.testNewScene();
    setSceneResult(result);
    setChaosFactor(dmEngine.chaosFactor);
    let text = `Scene Test (CF ${chaosFactor}): ${result.type.toUpperCase()}`;
    if (result.adjustment) text += ` — Adjustment: ${result.adjustment}`;
    if (result.event) text += ` — Event: ${result.event.focus}`;
    logResult(text);
  };

  // ── Meaning Tables ──
  const rollMeaning = (t1, t2, label) => {
    const result = rollMeaningPair(t1, t2);
    setMeaningResult({ ...result, label });
    logResult(`Meaning (${label}): "${result.word1}" + "${result.word2}"`);
  };

  // ── Random Event ──
  const triggerEvent = () => {
    const result = dmEngine.triggerRandomEvent();
    setEventResult(result);
    let text = `Random Event — Focus: ${result.focus}`;
    if (result.meaning) text += ` | Meaning: "${result.meaning.word1}" + "${result.meaning.word2}"`;
    logResult(text);
  };

  // ── Chaos Factor ──
  const adjustChaos = (playerInControl) => {
    const newCF = dmEngine.adjustChaos(playerInControl);
    updateMythic('chaosFactor', newCF);
    logResult(`Chaos Factor ${playerInControl ? 'decreased' : 'increased'} to ${newCF}`);
  };

  // ── Thread Management ──
  const addThread = () => {
    if (!newThread.trim()) return;
    dmEngine.addThread(newThread.trim());
    updateMythic('threads', [...threads, newThread.trim()]);
    setNewThread('');
  };

  const removeThread = (idx) => {
    dmEngine.removeThread(idx);
    updateMythic('threads', threads.filter((_, i) => i !== idx));
  };

  // ── Character Management ──
  const addCharacter = () => {
    if (!newCharacter.trim()) return;
    dmEngine.addCharacter(newCharacter.trim());
    updateMythic('characters', [...characters, newCharacter.trim()]);
    setNewCharacter('');
  };

  const removeCharacter = (idx) => {
    dmEngine.removeCharacter(idx);
    updateMythic('characters', characters.filter((_, i) => i !== idx));
  };

  const s = {
    container: { height: '100%', overflow: 'auto', padding: '16px', background: '#0d1117', color: '#e0d6c8', fontFamily: 'Georgia, serif' },
    grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
    panel: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px' },
    title: { fontSize: '14px', fontWeight: 600, color: '#ffd700', marginBottom: '10px', borderBottom: '1px solid #30363d', paddingBottom: '6px' },
    btn: { padding: '6px 14px', background: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '4px', color: '#ffd700', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' },
    btnSmall: { padding: '3px 8px', background: '#1a1a2e', border: '1px solid #30363d', borderRadius: '3px', color: '#8b949e', cursor: 'pointer', fontSize: '11px' },
    btnDanger: { padding: '3px 8px', background: '#2d0000', border: '1px solid #5c1616', borderRadius: '3px', color: '#ff6b6b', cursor: 'pointer', fontSize: '11px' },
    select: { padding: '5px 10px', background: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '4px', color: '#e0d6c8', fontSize: '12px' },
    input: { padding: '5px 10px', background: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '4px', color: '#e0d6c8', fontSize: '12px', flex: 1 },
    result: { padding: '10px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', marginTop: '8px', fontSize: '13px' },
    resultHighlight: { color: '#ffd700', fontWeight: 600, fontSize: '16px' },
    tag: { display: 'inline-block', padding: '3px 8px', background: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '12px', fontSize: '11px', margin: '2px' },
    chaosBar: { display: 'flex', gap: '4px', alignItems: 'center', margin: '8px 0' },
    chaosCell: (cf, active) => ({
      width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '4px', fontSize: '12px', fontWeight: active ? 700 : 400,
      background: active ? (cf <= 3 ? '#1a4731' : cf <= 6 ? '#4a3b2a' : '#5c1616') : '#161b22',
      color: active ? '#ffd700' : '#8b949e',
      border: active ? '2px solid #ffd700' : '1px solid #30363d',
    }),
    logEntry: { padding: '4px 8px', fontSize: '11px', borderBottom: '1px solid #1a1a2e', color: '#8b949e' },
  };

  return (
    <div style={s.container}>
      <div style={{ fontSize: '18px', fontWeight: 700, color: '#ffd700', marginBottom: '12px' }}>
        Mythic Game Master Emulator
        <span style={{ fontSize: '11px', color: '#8b949e', marginLeft: '12px' }}>2nd Edition</span>
      </div>

      <div style={s.grid}>
        {/* ── Left Column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Chaos Factor */}
          <div style={s.panel}>
            <div style={s.title}>Chaos Factor</div>
            <div style={s.chaosBar}>
              {[1,2,3,4,5,6,7,8,9].map(n => (
                <div key={n} style={s.chaosCell(n, n === chaosFactor)}>{n}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button style={s.btn} onClick={() => adjustChaos(true)}>Players In Control (-1)</button>
              <button style={s.btn} onClick={() => adjustChaos(false)}>GM In Control (+1)</button>
            </div>
          </div>

          {/* Party Integration */}
          <div style={s.panel}>
            <div style={s.title}>Party Integration</div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginBottom: '10px' }}>Auto-adjust chaos based on party events:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button style={{ ...s.btn, background: '#1a3a2a', borderColor: '#2d6b4a' }} onClick={() => {
                updateMythic('chaosFactor', Math.max(1, chaosFactor - 1));
                logResult('Chaos Factor decreased (-1): Combat Victory');
              }}>Combat Victory (-1 CF)</button>
              <button style={{ ...s.btn, background: '#5c2a2a', borderColor: '#7b4a4a' }} onClick={() => {
                updateMythic('chaosFactor', Math.min(9, chaosFactor + 1));
                logResult('Chaos Factor increased (+1): Party Defeated/Fled');
              }}>Party Defeated/Fled (+1 CF)</button>
              <button style={{ ...s.btn, background: '#4a3a1a', borderColor: '#7b6a2a' }} onClick={() => {
                updateMythic('chaosFactor', Math.min(9, chaosFactor + 1));
                logResult('Chaos Factor increased (+1): Random Event Occurred');
              }}>Random Event Occurred (+1 CF)</button>
            </div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '10px', marginBottom: '10px' }}>Integrate campaign data:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button style={s.btnSmall} onClick={() => {
                const partyNames = party.map(c => c.name);
                const contactNames = worldState.contacts.map(c => c.name || c);
                const allNames = [...new Set([...partyNames, ...contactNames])];
                const newChars = [...new Set([...characters, ...allNames])];
                updateMythic('characters', newChars);
                logResult(`Imported ${newChars.length} characters from party and contacts`);
              }}>Import Party NPCs</button>
              <button style={s.btnSmall} onClick={() => {
                const questThreads = worldState.activeCases ? worldState.activeCases.map(c => c.title || c.name || 'Unknown Quest') : [];
                const newThreads = [...new Set([...threads, ...questThreads])];
                updateMythic('threads', newThreads);
                logResult(`Imported ${newThreads.length} threads from active quests`);
              }}>Import Active Quests</button>
            </div>
          </div>

          {/* Fate Question */}
          <div style={s.panel}>
            <div style={s.title}>Fate Question</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select style={s.select} value={selectedOdds} onChange={e => setSelectedOdds(e.target.value)}>
                {ODDS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button style={{ ...s.btn, background: '#2d1b4e', borderColor: '#7b68ee' }} onClick={askFate}>Ask the Fates</button>
            </div>
            {fateResult && (
              <div style={s.result}>
                <div style={s.resultHighlight}>
                  {fateResult.answer.toUpperCase()}
                  {fateResult.exceptional && <span style={{ color: '#ff6b6b', marginLeft: '8px' }}>EXCEPTIONAL!</span>}
                </div>
                <div style={{ fontSize: '11px', color: '#8b949e', marginTop: '4px' }}>
                  Roll: {fateResult.roll} | Threshold: Yes {'\u2264'} {fateResult.threshold?.yes || '?'}
                  {fateResult.randomEvent && (
                    <span style={{ color: '#ff6b6b', marginLeft: '8px' }}>+ Random Event triggered!</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Scene Test */}
          <div style={s.panel}>
            <div style={s.title}>Scene Test</div>
            <button style={s.btn} onClick={testNewScene}>Test New Scene</button>
            {sceneResult && (
              <div style={s.result}>
                <div style={s.resultHighlight}>
                  {sceneResult.type === 'expected' ? 'Scene Proceeds as Expected' :
                   sceneResult.type === 'altered' ? 'Scene is ALTERED!' :
                   'Scene is INTERRUPTED!'}
                </div>
                {sceneResult.adjustment && (
                  <div style={{ fontSize: '12px', color: '#ffaa00', marginTop: '4px' }}>Adjustment: {sceneResult.adjustment}</div>
                )}
                {sceneResult.event && (
                  <div style={{ fontSize: '12px', color: '#ff6b6b', marginTop: '4px' }}>
                    Event Focus: {sceneResult.event.focus}
                    {sceneResult.event.meaning && ` | "${sceneResult.event.meaning.word1}" + "${sceneResult.event.meaning.word2}"`}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Meaning Tables */}
          <div style={s.panel}>
            <div style={s.title}>Meaning Tables</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {MEANING_TABLE_PAIRS.map(mp => (
                <button key={mp.label} style={s.btn} onClick={() => rollMeaning(mp.t1, mp.t2, mp.label)}>{mp.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              <button style={s.btnSmall} onClick={() => rollMeaning('action1', 'descriptor2', 'Action+Adj')}>Action+Adj</button>
              <button style={s.btnSmall} onClick={() => rollMeaning('descriptor1', 'action2', 'Adv+Subject')}>Adv+Subject</button>
            </div>
            {meaningResult && (
              <div style={s.result}>
                <div style={s.resultHighlight}>"{meaningResult.word1}" + "{meaningResult.word2}"</div>
                <div style={{ fontSize: '11px', color: '#8b949e' }}>{meaningResult.label}</div>
              </div>
            )}
          </div>

          {/* Random Event */}
          <div style={s.panel}>
            <div style={s.title}>Random Event</div>
            <button style={{ ...s.btn, background: '#5c1616', borderColor: '#ff4444' }} onClick={triggerEvent}>Generate Random Event</button>
            {eventResult && (
              <div style={s.result}>
                <div style={{ color: '#ff6b6b', fontWeight: 600 }}>Focus: {eventResult.focus}</div>
                {eventResult.meaning && (
                  <div style={{ color: '#ffaa00', marginTop: '4px' }}>
                    Meaning: "{eventResult.meaning.word1}" + "{eventResult.meaning.word2}"
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Threads */}
          <div style={s.panel}>
            <div style={s.title}>Active Threads ({threads.length})</div>
            {threads.length === 0 && <div style={{ fontSize: '11px', color: '#8b949e' }}>No active threads. Add storylines to track.</div>}
            {threads.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #1a1a2e' }}>
                <span style={{ fontSize: '12px' }}>{i + 1}. {t}</span>
                <button style={s.btnDanger} onClick={() => removeThread(i)}>x</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <input style={s.input} value={newThread} onChange={e => setNewThread(e.target.value)}
                placeholder="New thread..." onKeyDown={e => e.key === 'Enter' && addThread()} />
              <button style={s.btnSmall} onClick={addThread}>Add</button>
            </div>
          </div>

          {/* Characters */}
          <div style={s.panel}>
            <div style={s.title}>Tracked NPCs ({characters.length})</div>
            {characters.length === 0 && <div style={{ fontSize: '11px', color: '#8b949e' }}>No tracked NPCs. Add important characters.</div>}
            {characters.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #1a1a2e' }}>
                <span style={{ fontSize: '12px' }}>{c}</span>
                <button style={s.btnDanger} onClick={() => removeCharacter(i)}>x</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <input style={s.input} value={newCharacter} onChange={e => setNewCharacter(e.target.value)}
                placeholder="NPC name..." onKeyDown={e => e.key === 'Enter' && addCharacter()} />
              <button style={s.btnSmall} onClick={addCharacter}>Add</button>
            </div>
          </div>

          {/* Result Log */}
          <div style={s.panel}>
            <div style={s.title}>Mythic Log</div>
            <div style={{ maxHeight: '300px', overflow: 'auto' }}>
              {resultLog.length === 0 && <div style={{ fontSize: '11px', color: '#8b949e' }}>Results will appear here...</div>}
              {resultLog.map((entry, i) => (
                <div key={i} style={s.logEntry}>{entry.text}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
