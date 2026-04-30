import { useState, useEffect, useRef } from 'react';
import db from '../db/database';
import { roll, rollDice, uid } from '../utils/dice';
import dmEngine from '../services/dmEngine';
import gameEvents from '../services/gameEventEngine';
import monstersData from '../data/monsters.json';
import {
  detectBehaviorPreset,
  applyBehaviorPreset,
  analyzeEncounterDifficulty,
  getIntelligenceTierEnhanced,
} from '../services/creatureAI';

// Build a lookup map for fast monster search by name
const monsterLookup = {};
for (const m of monstersData) {
  monsterLookup[m.name.toLowerCase()] = m;
}

/** Look up full monster stats by name, with fuzzy matching */
function lookupMonster(name) {
  const key = name.toLowerCase().trim();
  // Exact match
  if (monsterLookup[key]) return monsterLookup[key];
  // Try without numbering: "Goblin Warrior 1" → "Goblin Warrior" → "Goblin"
  const withoutNum = key.replace(/\s+\d+$/, '');
  if (monsterLookup[withoutNum]) return monsterLookup[withoutNum];
  // Try shorter name
  const parts = withoutNum.split(/\s+/);
  for (let i = parts.length; i > 0; i--) {
    const partial = parts.slice(0, i).join(' ');
    if (monsterLookup[partial]) return monsterLookup[partial];
  }
  // Fuzzy: find first monster whose name contains the search term
  const found = monstersData.find(m => m.name.toLowerCase().includes(key) || key.includes(m.name.toLowerCase()));
  return found || null;
}

export default function CampaignTab({
  party,
  addLog,
  setCombat,
  setTab,
  updateCharHP,
  campaign,
  setCampaign,
  gameLog,
  logRef,
  worldState,
  setWorldState,
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedChapter, setExpandedChapter] = useState(null);
  const [expandedPart, setExpandedPart] = useState(null);
  const [narrating, setNarrating] = useState(false);
  const [customAction, setCustomAction] = useState('');
  const inputRef = useRef(null);
  const [showQuestLog, setShowQuestLog] = useState(false);

  // Quest tracker helpers
  const quests = worldState?.quests || [];
  const updateQuests = (newQuests) => {
    setWorldState?.(prev => ({ ...prev, quests: newQuests }));
  };
  const addQuest = (quest) => {
    updateQuests([...quests, {
      id: `quest_${Date.now()}`,
      title: quest.title,
      description: quest.description || '',
      type: quest.type || 'main', // main, side, personal
      status: 'active', // active, completed, failed
      objectives: quest.objectives || [],
      rewards: quest.rewards || null,
      chapter: campaign?.currentChapter || null,
      addedDate: new Date().toISOString(),
    }]);
    addLog(`New quest: ${quest.title}`, 'journal');
  };
  const updateQuestStatus = (questId, status) => {
    updateQuests(quests.map(q => q.id === questId ? { ...q, status, completedDate: status !== 'active' ? new Date().toISOString() : null } : q));
    const quest = quests.find(q => q.id === questId);
    if (quest) addLog(`Quest ${status}: ${quest.title}`, status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'system');
  };
  const toggleObjective = (questId, objIdx) => {
    updateQuests(quests.map(q => {
      if (q.id !== questId) return q;
      const objectives = [...q.objectives];
      objectives[objIdx] = { ...objectives[objIdx], done: !objectives[objIdx].done };
      // Auto-complete quest if all objectives done
      const allDone = objectives.every(o => o.done);
      return { ...q, objectives, status: allDone ? 'completed' : q.status, completedDate: allDone ? new Date().toISOString() : q.completedDate };
    }));
  };

  // New quest form state
  const [newQuestTitle, setNewQuestTitle] = useState('');
  const [newQuestDesc, setNewQuestDesc] = useState('');
  const [newQuestType, setNewQuestType] = useState('main');
  const [newQuestObjectives, setNewQuestObjectives] = useState('');

  useEffect(() => {
    (async () => {
      const data = await db.campaignData.toArray();
      setCampaigns(data);
      setLoading(false);
    })();
  }, []);

  // When campaign is active, auto-expand current chapter
  useEffect(() => {
    if (campaign?.currentChapter && !expandedChapter) {
      setExpandedChapter(campaign.currentChapter);
    }
  }, [campaign]);

  const startCampaign = async (campaignData) => {
    const firstChapter = campaignData.chapters[0];
    const firstPart = firstChapter.parts[0];
    const newCampaign = {
      data: campaignData,
      currentChapter: firstChapter.id,
      currentPart: firstPart.id,
      completedEncounters: [],
      partyLevel: 1,
      started: new Date().toISOString(),
    };
    setCampaign(newCampaign);
    setExpandedChapter(firstChapter.id);
    setExpandedPart(firstPart.id);
    addLog(`=== ${campaignData.name} ===`, 'system');
    addLog(`Chapter ${firstChapter.number}: ${firstChapter.name}`, 'system');

    // AI narration for campaign start — provide chapter/part context, NOT the first combat encounter
    // The AI should set the scene (e.g., the Swallowtail Festival), not jump to combat
    setNarrating(true);
    dmEngine.clearHistory();
    try {
      // Find the first roleplay/story event if there is one (e.g., Swallowtail Festival)
      const firstEvent = firstPart.events?.[0] || firstPart.encounters?.find(e => e.type === 'roleplay' || e.type === 'story');
      const result = await dmEngine.narrate('chapter_intro', {
        campaign: newCampaign,
        party,
        chapter: firstChapter,
        part: firstPart,
        // Pass the scene-setting event, not a combat encounter
        encounter: firstEvent || { name: firstPart.name, description: firstPart.description, type: 'story' },
      });
      addLog(result.text, 'narration');
    } catch (err) {
      addLog(firstChapter.synopsis, 'narration');
      addLog(firstPart.description, 'narration');
    }
    setNarrating(false);
  };

  const runEncounter = async (encounter) => {
    if (!party || party.length === 0) {
      addLog('You need a party before running encounters! Go to the Party tab first.', 'warning');
      return;
    }

    setNarrating(true);

    if (encounter.type === 'story' || encounter.type === 'roleplay') {
      addLog(`--- ${encounter.name} ---`, 'system');

      // AI narration for story encounters
      try {
        const result = await dmEngine.narrate('story', {
          campaign, party, encounter,
          recentLog: (gameLog || []).slice(-10),
        });
        addLog(result.text, 'narration');
      } catch {
        addLog(encounter.description, 'narration');
        if (encounter.readAloud) addLog(encounter.readAloud, 'narration');
      }

      if (encounter.storyNote) addLog(`DM Note: ${encounter.storyNote}`, 'system');

      setCampaign(prev => ({
        ...prev,
        completedEncounters: [...(prev.completedEncounters || []), encounter.id],
      }));
      if (encounter.rewards?.xp) {
        const xpEach = Math.floor(encounter.rewards.xp / party.length);
        addLog(`Story Award: ${encounter.rewards.xp} XP (${xpEach} each)`, 'loot');
      }

      // ── Game Event Engine: milestone cascades ──
      if (worldState && campaign?.data) {
        const chapter = campaign.data.chapters.find(ch => ch.id === campaign.currentChapter);
        const part = chapter?.parts.find(p => p.id === campaign.currentPart);
        const milestoneEffects = gameEvents.onCampaignMilestone({
          worldState, party, campaign: { ...campaign, completedEncounters: [...(campaign.completedEncounters || []), encounter.id] },
          completedEncounter: encounter, chapter, part,
        });
        if (Object.keys(milestoneEffects.worldUpdates).length > 0) {
          setWorldState?.(prev => gameEvents.applyWorldUpdates(prev, milestoneEffects.worldUpdates));
        }
        milestoneEffects.events.forEach(e => addLog(e.text, e.severity === 'success' ? 'success' : e.severity === 'loot' ? 'loot' : e.severity === 'danger' ? 'danger' : e.severity === 'warning' ? 'warning' : 'info'));
        // Auto-generate quests
        if (milestoneEffects.autoQuests?.length > 0 && setWorldState) {
          setWorldState(prev => ({
            ...prev,
            quests: [...(prev.quests || []), ...milestoneEffects.autoQuests.map(q => ({
              id: `quest_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              ...q, status: 'active', addedDate: new Date().toISOString(),
              chapter: campaign.currentChapter,
            }))],
          }));
          milestoneEffects.autoQuests.forEach(q => addLog(`New quest: ${q.title}`, 'journal'));
        }
      }

      setNarrating(false);
      return;
    }

    if (encounter.type === 'combat' || encounter.type === 'exploration') {
      addLog(`--- ${encounter.name} (CR ${encounter.cr}) ---`, 'system');

      // AI narration for encounter intro
      try {
        const result = await dmEngine.narrate('encounter_intro', {
          campaign, party, encounter,
          recentLog: (gameLog || []).slice(-10),
        });
        addLog(result.text, 'narration');
      } catch {
        if (encounter.readAloud) addLog(encounter.readAloud, 'narration');
        else addLog(encounter.description, 'narration');
      }

      // Build enemies from encounter data, enriched with full monster stats
      const enemies = [];
      for (const enemyTemplate of encounter.enemies) {
        // Look up full monster stats from our 2200+ monster database
        const monsterStats = lookupMonster(enemyTemplate.name);

        for (let i = 0; i < enemyTemplate.count; i++) {
          const baseName = enemyTemplate.count > 1
            ? `${enemyTemplate.name} ${i + 1}`
            : enemyTemplate.name;

          // Merge: encounter template overrides monster DB (encounter has correct HP/AC for the AP)
          const enemy = {
            id: uid(),
            name: baseName,
            // Core stats from encounter template (authoritative for this AP)
            hp: enemyTemplate.hp || monsterStats?.hp || 10,
            currentHP: enemyTemplate.hp || monsterStats?.hp || 10,
            ac: enemyTemplate.ac || monsterStats?.ac || 10,
            cr: enemyTemplate.cr || monsterStats?.cr || 0,
            xp: enemyTemplate.xp || monsterStats?.xp || 0,
            // Attack data — prefer encounter's structured attacks, fall back to monster DB
            attacks: enemyTemplate.attacks || null,
            atk: monsterStats?.atk || '',
            dmg: monsterStats?.dmg || '',
            attack: enemyTemplate.attack,
            // Ability scores from monster DB (critical for AI intelligence)
            str: monsterStats?.str ?? null,
            dex: monsterStats?.dex ?? null,
            con: monsterStats?.con ?? null,
            int: monsterStats?.int ?? null,
            wis: monsterStats?.wis ?? null,
            cha: monsterStats?.cha ?? null,
            // Combat stats from monster DB
            init: monsterStats?.init || 0,
            fort: monsterStats?.fort || 0,
            ref: monsterStats?.ref || 0,
            will: monsterStats?.will || 0,
            cmb: monsterStats?.cmb || 0,
            cmd: monsterStats?.cmd || 0,
            bab: monsterStats?.bab || 0,
            // Type and special abilities
            type: monsterStats?.type || enemyTemplate.type || 'humanoid',
            subtype: monsterStats?.subtype || '',
            special: enemyTemplate.specialAbilities?.join(', ') || monsterStats?.special || '',
            special_attacks: monsterStats?.special_attacks || '',
            // Rich data for AI
            speed: monsterStats?.speed || '30 ft.',
            alignment: monsterStats?.alignment || '',
            size: monsterStats?.size || 'Medium',
            senses: monsterStats?.senses || '',
            skills: monsterStats?.skills || '',
            feats: monsterStats?.feats || '',
            languages: monsterStats?.languages || '',
            spells: monsterStats?.spells || null,
            resist: monsterStats?.resist || '',
            dr: monsterStats?.dr || '',
            sr: monsterStats?.sr || 0,
            immune: monsterStats?.immune || '',
            organization: monsterStats?.organization || '',
            // Encounter-specific tactical notes
            tactics: encounter.tactics || '',
            // Conditions tracking
            conditions: [],
          };

          // Auto-detect and apply behavior preset
          const preset = detectBehaviorPreset(enemy);
          if (preset) {
            Object.assign(enemy, applyBehaviorPreset(enemy, preset));
          }

          enemies.push(enemy);
        }
      }

      // Analyze encounter difficulty
      const difficulty = analyzeEncounterDifficulty(enemies, party);
      addLog(`Encounter Difficulty: ${difficulty.difficulty} (${difficulty.totalEnemyXP} XP)`, 'system');
      if (difficulty.threats.length > 0) {
        addLog(`Threats: ${difficulty.threats.join(', ')}`, 'warning');
      }

      // Build initiative order using proper initiative bonuses
      const order = [
        ...party.map(p => ({
          id: p.id,
          name: p.name,
          init: roll(20) + (Math.floor(((p.abilities?.DEX || 10) - 10) / 2)),
        })),
        ...enemies.map(e => ({
          id: e.id,
          name: e.name,
          init: roll(20) + (e.init || 0),
        })),
      ].sort((a, b) => b.init - a.init);

      // Log initiative
      addLog('Roll for initiative!', 'action');
      order.forEach((c, i) => {
        addLog(`  ${i + 1}. ${c.name} (${c.init})`, 'roll');
      });

      // Check encounter type and route to appropriate pipeline
      const encounterStartResult = gameEvents.onEncounterStart({
        encounter,
        worldState,
        party,
        enemies,
      });

      // Log any encounter events
      if (encounterStartResult.events?.length > 0) {
        encounterStartResult.events.forEach(e => {
          addLog(e.text, e.severity === 'success' ? 'success' : e.severity === 'warning' ? 'warning' : e.severity === 'danger' ? 'danger' : 'info');
        });
      }

      // Check if this is a specialty encounter type
      if (encounter.type === 'verbal_duel' || encounter.type === 'skill_challenge' || encounter.type === 'chase') {
        addLog(`Encounter Type: ${encounter.type.toUpperCase().replace(/_/g, ' ')}`, 'system');
        // These specialty types would have their own specialized handlers
        // For now, log that they're detected
      }

      setCombat({
        active: true,
        round: 1,
        order: order.map(({ id, name }) => ({ id, name })),
        currentTurn: 0,
        enemies,
        campaignEncounterId: encounter.id,
        campaignRewards: encounter.rewards,
        encounterData: encounter,
      });

      setNarrating(false);
      setTab('Combat');
    }
  };

  // Handle custom player actions via the DM
  const handleCustomAction = async () => {
    if (!customAction.trim() || narrating) return;
    const action = customAction.trim();
    setCustomAction('');
    addLog(`> ${action}`, 'action');
    setNarrating(true);

    try {
      // Race against a 35s safety timeout so the UI never gets permanently stuck
      const narratePromise = dmEngine.narrate('custom', {
        campaign, party,
        encounter: getCurrentEncounter(),
        recentLog: (gameLog || []).slice(-15),
      }, action);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out. The AI DM took too long to respond.')), 35000)
      );

      const result = await Promise.race([narratePromise, timeoutPromise]);
      addLog(result.text, 'narration');
      if (result.aiError) {
        addLog(`[DM Engine: ${result.aiError}]`, 'danger');
      }
    } catch (err) {
      addLog(`The DM stumbles... (${err.message})`, 'danger');
    }
    setNarrating(false);
  };

  const getCurrentEncounter = () => {
    if (!campaign?.data) return null;
    const chapter = getCurrentChapter();
    if (!chapter) return null;
    const part = chapter.parts.find(p => p.id === campaign.currentPart);
    if (!part) return null;
    // Find first incomplete encounter
    return part.encounters.find(e => !isEncounterComplete(e.id)) || null;
  };

  const isEncounterComplete = (encounterId) => {
    return campaign?.completedEncounters?.includes(encounterId);
  };

  const getCurrentChapter = () => {
    if (!campaign?.data) return null;
    return campaign.data.chapters.find(ch => ch.id === campaign.currentChapter);
  };

  const advanceToNextPart = async () => {
    if (!campaign?.data) return;
    const chapter = getCurrentChapter();
    if (!chapter) return;

    setNarrating(true);
    const currentPartIdx = chapter.parts.findIndex(p => p.id === campaign.currentPart);

    if (currentPartIdx < chapter.parts.length - 1) {
      const nextPart = chapter.parts[currentPartIdx + 1];
      setCampaign(prev => ({ ...prev, currentPart: nextPart.id }));

      // Auto-complete any quests matching completed part
      if (setWorldState) {
        setWorldState(prev => {
          const quests = (prev.quests || []).map(q => {
            if (q.status === 'active' && q.chapter === campaign.currentChapter) {
              const allObjDone = q.objectives.length > 0 && q.objectives.every(o => o.done);
              if (allObjDone) return { ...q, status: 'completed', completedDate: new Date().toISOString() };
            }
            return q;
          });
          return { ...prev, quests };
        });
      }

      setExpandedPart(nextPart.id);
      addLog(`--- ${nextPart.name} ---`, 'system');

      try {
        const result = await dmEngine.narrate('part_intro', {
          campaign: { ...campaign, currentPart: nextPart.id },
          party,
          part: nextPart,
          recentLog: (gameLog || []).slice(-10),
        });
        addLog(result.text, 'narration');
      } catch {
        addLog(nextPart.description, 'narration');
      }
    } else {
      const chapterIdx = campaign.data.chapters.findIndex(ch => ch.id === campaign.currentChapter);
      if (chapterIdx < campaign.data.chapters.length - 1) {
        const nextChapter = campaign.data.chapters[chapterIdx + 1];
        const nextPart = nextChapter.parts[0];
        const updatedCampaign = {
          ...campaign,
          currentChapter: nextChapter.id,
          currentPart: nextPart.id,
        };
        setCampaign(prev => ({
          ...prev,
          currentChapter: nextChapter.id,
          currentPart: nextPart.id,
        }));
        setExpandedChapter(nextChapter.id);
        setExpandedPart(nextPart.id);
        addLog(`=== Chapter ${nextChapter.number}: ${nextChapter.name} ===`, 'system');

        try {
          const result = await dmEngine.narrate('chapter_intro', {
            campaign: updatedCampaign,
            party,
            chapter: nextChapter,
          });
          addLog(result.text, 'narration');
        } catch {
          addLog(nextChapter.synopsis, 'narration');
        }
      } else {
        addLog('=== CAMPAIGN COMPLETE! ===', 'success');
        addLog('Congratulations! You have completed Rise of the Runelords. The Runelord Karzoug is defeated, and Varisia is saved!', 'narration');
      }
    }
    setNarrating(false);
  };

  const styles = {
    container: { display: 'flex', height: '100%', overflow: 'hidden' },
    sidebar: {
      width: '340px', minWidth: '340px', borderRight: '2px solid #4a3b2a',
      backgroundColor: '#0d1117', overflowY: 'auto', padding: '12px',
    },
    main: { flex: 1, overflowY: 'auto', padding: '16px' },
    card: {
      backgroundColor: '#1a1a2e', border: '1px solid #4a3b2a', borderRadius: '6px',
      padding: '12px', marginBottom: '8px', cursor: 'pointer',
    },
    cardActive: { borderColor: '#ffd700', boxShadow: '0 0 8px rgba(255, 215, 0, 0.2)' },
    chapterHeader: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 12px', backgroundColor: '#2a2a4e', borderRadius: '4px',
      cursor: 'pointer', marginBottom: '4px', border: '1px solid rgba(255, 215, 0, 0.2)',
    },
    partHeader: {
      padding: '8px 12px', backgroundColor: '#1a1a2e', borderRadius: '3px',
      cursor: 'pointer', marginBottom: '2px', marginLeft: '12px',
      border: '1px solid rgba(255, 215, 0, 0.1)',
    },
    encounter: {
      padding: '8px 12px', marginLeft: '24px', marginBottom: '2px',
      backgroundColor: '#0d1117', borderRadius: '3px',
      border: '1px solid rgba(255, 215, 0, 0.05)', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center', gap: '8px',
    },
    btn: {
      padding: '6px 14px', backgroundColor: '#3a3a6e', border: '1px solid #ffd700',
      color: '#ffd700', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
      fontWeight: 'bold', whiteSpace: 'nowrap',
    },
    btnDanger: { borderColor: '#ff6b6b', color: '#ff6b6b', backgroundColor: '#2a1a1a' },
    btnSuccess: { borderColor: '#7fff00', color: '#7fff00', backgroundColor: '#1a2a1a' },
    logPanel: {
      flex: 1, overflowY: 'auto', padding: '8px', backgroundColor: '#0d1117',
      borderRadius: '4px', border: '1px solid #30363d', maxHeight: '300px',
    },
    tag: {
      display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
      fontSize: '10px', fontWeight: 'bold', marginLeft: '6px',
    },
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading campaigns...</div>;
  }

  // Campaign selection screen
  if (!campaign) {
    return (
      <div style={{ padding: '24px', overflowY: 'auto', height: '100%' }}>
        <h2 style={{ color: '#ffd700', marginBottom: '8px', fontSize: '20px' }}>Select a Campaign</h2>
        <p style={{ color: '#8b949e', marginBottom: '24px', fontSize: '14px' }}>
          Choose an adventure path to begin your journey.
        </p>
        {campaigns.length === 0 ? (
          <div style={styles.card}>
            <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
              No campaigns available. Campaign data may still be loading.
            </div>
          </div>
        ) : (
          campaigns.map(c => (
            <div key={c.id} style={{ ...styles.card, padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <h3 style={{ color: '#ffd700', margin: 0, fontSize: '18px' }}>{c.name}</h3>
                  <div style={{ color: '#b8860b', fontSize: '12px', marginBottom: '8px' }}>{c.subtitle}</div>
                  <p style={{ color: '#d4c5a9', fontSize: '13px', lineHeight: 1.5, margin: '0 0 12px' }}>
                    {c.description}
                  </p>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px', color: '#8b949e' }}>
                    <span>Levels {c.levelRange}</span>
                    <span>{c.chapters.length} Chapters</span>
                    <span>{c.chapters.reduce((s, ch) => s + ch.parts.reduce((ps, p) => ps + p.encounters.length, 0), 0)} Encounters</span>
                  </div>
                </div>
                <button style={{ ...styles.btn, padding: '10px 24px', fontSize: '14px' }}
                  onClick={() => startCampaign(c)}>
                  Begin Campaign
                </button>
              </div>
              <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {c.chapters.map(ch => (
                  <span key={ch.id} style={{
                    ...styles.tag,
                    backgroundColor: 'rgba(255, 215, 0, 0.1)',
                    color: '#b8860b', border: '1px solid rgba(255, 215, 0, 0.2)',
                    fontSize: '11px', padding: '4px 10px',
                  }}>
                    Ch{ch.number}: {ch.name} ({ch.levelRange})
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  // Active campaign view
  const currentChapter = getCurrentChapter();
  const currentPart = currentChapter?.parts.find(p => p.id === campaign.currentPart);

  return (
    <div style={styles.container}>
      {/* Campaign Navigation Sidebar */}
      <div style={styles.sidebar}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ color: '#ffd700', margin: 0, fontSize: '14px' }}>
            {campaign.data.name}
          </h3>
          <button style={{ ...styles.btn, ...styles.btnDanger, fontSize: '10px', padding: '3px 8px' }}
            onClick={() => {
              setCampaign(null);
              addLog('Campaign ended.', 'system');
            }}>
            End
          </button>
        </div>

        {campaign.data.chapters.map(chapter => {
          const isCurrentChapter = chapter.id === campaign.currentChapter;
          const isExpanded = expandedChapter === chapter.id;
          const chapterEncounters = chapter.parts.flatMap(p => p.encounters);
          const completedCount = chapterEncounters.filter(e => isEncounterComplete(e.id)).length;

          return (
            <div key={chapter.id} style={{ marginBottom: '4px' }}>
              <div
                style={{
                  ...styles.chapterHeader,
                  ...(isCurrentChapter ? { borderColor: '#ffd700', backgroundColor: '#3a3a6e' } : {}),
                }}
                onClick={() => setExpandedChapter(isExpanded ? null : chapter.id)}
              >
                <div>
                  <div style={{ color: isCurrentChapter ? '#ffd700' : '#d4c5a9', fontWeight: 'bold', fontSize: '12px' }}>
                    {isExpanded ? '▾' : '▸'} Ch{chapter.number}: {chapter.name}
                  </div>
                  <div style={{ color: '#8b949e', fontSize: '10px' }}>
                    Levels {chapter.levelRange} &middot; {completedCount}/{chapterEncounters.length} encounters
                  </div>
                </div>
                {isCurrentChapter && (
                  <span style={{ ...styles.tag, backgroundColor: '#2d5016', color: '#7fff00' }}>ACTIVE</span>
                )}
              </div>

              {isExpanded && chapter.parts.map(part => {
                const isCurrentPart = part.id === campaign.currentPart;
                const isPartExpanded = expandedPart === part.id;
                const partComplete = part.encounters.every(e => isEncounterComplete(e.id));

                return (
                  <div key={part.id}>
                    <div
                      style={{
                        ...styles.partHeader,
                        ...(isCurrentPart ? { borderColor: '#ffd700' } : {}),
                      }}
                      onClick={() => setExpandedPart(isPartExpanded ? null : part.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: isCurrentPart ? '#ffd700' : '#8b949e', fontSize: '11px' }}>
                          {isPartExpanded ? '▾' : '▸'} {part.name}
                        </span>
                        {partComplete && (
                          <span style={{ color: '#7fff00', fontSize: '10px' }}>✓</span>
                        )}
                        {isCurrentPart && !partComplete && (
                          <span style={{ ...styles.tag, backgroundColor: '#5c4b00', color: '#ffd700', fontSize: '9px' }}>CURRENT</span>
                        )}
                      </div>
                    </div>

                    {isPartExpanded && part.encounters.map(enc => {
                      const done = isEncounterComplete(enc.id);
                      const typeColors = {
                        combat: '#ff6b6b', roleplay: '#7b68ee', story: '#7fff00', exploration: '#ffa500',
                      };
                      return (
                        <div key={enc.id} style={{ ...styles.encounter, opacity: done ? 0.5 : 1 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ color: done ? '#666' : '#d4c5a9', fontSize: '11px', fontWeight: 'bold' }}>
                              {done ? '✓ ' : ''}{enc.name}
                            </div>
                            <div style={{ fontSize: '10px', color: '#8b949e' }}>
                              <span style={{ color: typeColors[enc.type] || '#888' }}>
                                {enc.type.toUpperCase()}
                              </span>
                              {enc.cr > 0 ? ` · CR ${enc.cr}` : ''}
                            </div>
                          </div>
                          {!done && (
                            <button
                              style={{ ...styles.btn, fontSize: '10px', padding: '4px 10px' }}
                              onClick={() => runEncounter(enc)}
                            >
                              Run
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Advance button */}
        {currentPart && currentPart.encounters.every(e => isEncounterComplete(e.id)) && (
          <button style={{ ...styles.btn, ...styles.btnSuccess, width: '100%', marginTop: '12px', padding: '10px' }}
            onClick={advanceToNextPart}>
            Advance to Next Section ▸
          </button>
        )}

        {/* Quest Log Toggle */}
        <button style={{ ...styles.btn, width: '100%', marginTop: '12px', padding: '8px', backgroundColor: showQuestLog ? '#ffd700' : '#3a3a6e', color: showQuestLog ? '#1a1a2e' : '#ffd700' }}
          onClick={() => setShowQuestLog(!showQuestLog)}>
          📜 Quest Log ({quests.filter(q => q.status === 'active').length} active)
        </button>

        {showQuestLog && (
          <div style={{ marginTop: '8px' }}>
            {/* Add Quest Form */}
            <div style={{ ...styles.card, padding: '8px', cursor: 'default' }}>
              <input type="text" placeholder="Quest title..." value={newQuestTitle}
                onChange={e => setNewQuestTitle(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '3px', fontSize: '11px', marginBottom: '4px', boxSizing: 'border-box' }} />
              <input type="text" placeholder="Description..." value={newQuestDesc}
                onChange={e => setNewQuestDesc(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '3px', fontSize: '11px', marginBottom: '4px', boxSizing: 'border-box' }} />
              <input type="text" placeholder="Objectives (comma-separated)" value={newQuestObjectives}
                onChange={e => setNewQuestObjectives(e.target.value)}
                style={{ width: '100%', padding: '4px 8px', backgroundColor: '#0d1117', color: '#e0d6c8', border: '1px solid #4a3b2a', borderRadius: '3px', fontSize: '11px', marginBottom: '4px', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <select value={newQuestType} onChange={e => setNewQuestType(e.target.value)}
                  style={{ padding: '3px 6px', backgroundColor: '#0d1117', color: '#ffd700', border: '1px solid #4a3b2a', borderRadius: '3px', fontSize: '10px' }}>
                  <option value="main">Main</option>
                  <option value="side">Side</option>
                  <option value="personal">Personal</option>
                </select>
                <button style={{ ...styles.btn, fontSize: '10px', padding: '3px 10px' }} onClick={() => {
                  if (!newQuestTitle.trim()) return;
                  addQuest({
                    title: newQuestTitle.trim(),
                    description: newQuestDesc.trim(),
                    type: newQuestType,
                    objectives: newQuestObjectives.split(',').filter(o => o.trim()).map(o => ({ text: o.trim(), done: false })),
                  });
                  setNewQuestTitle(''); setNewQuestDesc(''); setNewQuestObjectives('');
                }}>Add Quest</button>
              </div>
            </div>

            {/* Active Quests */}
            {quests.filter(q => q.status === 'active').length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ color: '#ffd700', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Active Quests</div>
                {quests.filter(q => q.status === 'active').map(q => {
                  const typeColors = { main: '#ffd700', side: '#7b68ee', personal: '#87ceeb' };
                  return (
                    <div key={q.id} style={{ ...styles.card, padding: '8px', cursor: 'default', borderColor: typeColors[q.type] || '#4a3b2a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '11px' }}>{q.title}</div>
                        <span style={{ ...styles.tag, backgroundColor: 'rgba(255,215,0,0.1)', color: typeColors[q.type], fontSize: '9px' }}>{q.type.toUpperCase()}</span>
                      </div>
                      {q.description && <div style={{ color: '#8b949e', fontSize: '10px', marginTop: '2px' }}>{q.description}</div>}
                      {q.objectives.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          {q.objectives.map((obj, oi) => (
                            <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', cursor: 'pointer', color: obj.done ? '#51cf66' : '#d4c5a9' }}
                              onClick={() => toggleObjective(q.id, oi)}>
                              <span>{obj.done ? '☑' : '☐'}</span>
                              <span style={{ textDecoration: obj.done ? 'line-through' : 'none' }}>{obj.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                        <button style={{ ...styles.btn, ...styles.btnSuccess, fontSize: '9px', padding: '2px 6px' }}
                          onClick={() => updateQuestStatus(q.id, 'completed')}>Complete</button>
                        <button style={{ ...styles.btn, ...styles.btnDanger, fontSize: '9px', padding: '2px 6px' }}
                          onClick={() => updateQuestStatus(q.id, 'failed')}>Fail</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Completed Quests */}
            {quests.filter(q => q.status === 'completed').length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ color: '#51cf66', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Completed ({quests.filter(q => q.status === 'completed').length})</div>
                {quests.filter(q => q.status === 'completed').slice(-5).map(q => (
                  <div key={q.id} style={{ ...styles.card, padding: '6px 8px', opacity: 0.6, cursor: 'default' }}>
                    <div style={{ color: '#51cf66', fontSize: '10px' }}>✓ {q.title}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Failed Quests */}
            {quests.filter(q => q.status === 'failed').length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ color: '#ff6b6b', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Failed ({quests.filter(q => q.status === 'failed').length})</div>
                {quests.filter(q => q.status === 'failed').slice(-5).map(q => (
                  <div key={q.id} style={{ ...styles.card, padding: '6px 8px', opacity: 0.6, cursor: 'default' }}>
                    <div style={{ color: '#ff6b6b', fontSize: '10px' }}>✗ {q.title}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div style={styles.main}>
        {currentChapter && currentPart && (
          <>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ color: '#ffd700', margin: 0, fontSize: '18px' }}>
                Chapter {currentChapter.number}: {currentChapter.name}
              </h2>
              <div style={{ color: '#b8860b', fontSize: '12px', marginBottom: '8px' }}>
                {currentPart.name} &middot; {currentPart.location}
              </div>
              <p style={{ color: '#d4c5a9', fontSize: '13px', lineHeight: 1.5, margin: 0 }}>
                {currentPart.description}
              </p>
            </div>

            {/* NPCs for current chapter */}
            {currentChapter.npcs && currentChapter.npcs.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ color: '#ffd700', fontSize: '14px', marginBottom: '8px' }}>Key NPCs</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '8px' }}>
                  {currentChapter.npcs.map(npc => (
                    <div key={npc.name} style={{
                      ...styles.card, padding: '10px', margin: 0, cursor: 'default',
                      borderColor: npc.role.includes('Villain') ? '#ff6b6b' : npc.role.includes('Ally') ? '#7fff00' : '#4a3b2a',
                    }}>
                      <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '12px' }}>{npc.name}</div>
                      <div style={{ color: npc.role.includes('Villain') ? '#ff6b6b' : '#7fff00', fontSize: '10px' }}>{npc.role}</div>
                      <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '4px' }}>{npc.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Locations for current chapter */}
            {currentChapter.locations && currentChapter.locations.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ color: '#ffd700', fontSize: '14px', marginBottom: '8px' }}>Locations</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {currentChapter.locations.map(loc => (
                    <div key={loc.name} style={{
                      ...styles.card, padding: '10px', margin: 0, cursor: 'default', flex: '1 1 250px',
                    }}>
                      <div style={{ color: '#ffd700', fontWeight: 'bold', fontSize: '12px' }}>{loc.name}</div>
                      <div style={{ color: '#b8860b', fontSize: '10px', textTransform: 'uppercase' }}>{loc.type}</div>
                      <div style={{ color: '#8b949e', fontSize: '11px', marginTop: '4px' }}>{loc.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Game Log */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h3 style={{ color: '#ffd700', fontSize: '14px', margin: 0 }}>Adventure Log</h3>
                {narrating && (
                  <span style={{
                    color: '#7b68ee', fontSize: '11px', fontStyle: 'italic',
                    animation: 'pulse 1.5s infinite',
                  }}>
                    The DM is narrating...
                  </span>
                )}
                <span style={{
                  fontSize: '10px', padding: '2px 8px', borderRadius: '10px',
                  backgroundColor: dmEngine.isAIAvailable() ? 'rgba(127, 255, 0, 0.1)' : 'rgba(255, 165, 0, 0.1)',
                  color: dmEngine.isAIAvailable() ? '#7fff00' : '#ffa500',
                  border: `1px solid ${dmEngine.isAIAvailable() ? 'rgba(127, 255, 0, 0.3)' : 'rgba(255, 165, 0, 0.3)'}`,
                }}>
                  {dmEngine.isAIAvailable() ? 'AI DM' : 'Procedural DM'}
                </span>
              </div>
              <div ref={logRef} style={{ ...styles.logPanel, flex: 1, maxHeight: 'none', minHeight: '250px' }}>
                {(gameLog || []).slice(-80).map(entry => {
                  const colors = {
                    narration: '#d4c5a9', system: '#ffd700', danger: '#ff6b6b',
                    damage: '#ff4444', success: '#7fff00', loot: '#ffa500',
                    info: '#7b68ee', heal: '#44ff44', action: '#87ceeb',
                  };
                  return (
                    <div key={entry.id} style={{
                      padding: '6px 10px', fontSize: '13px', lineHeight: 1.6,
                      color: colors[entry.type] || '#d4c5a9',
                      borderBottom: '1px solid rgba(255, 215, 0, 0.05)',
                      whiteSpace: 'pre-wrap',
                    }}>
                      <span style={{ color: '#555', fontSize: '10px', marginRight: '6px' }}>{entry.time}</span>
                      {entry.text}
                    </div>
                  );
                })}
              </div>

              {/* Player Action Input */}
              <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                <input
                  ref={inputRef}
                  type="text"
                  style={{
                    flex: 1, padding: '10px 14px', backgroundColor: '#0d1117', color: '#e0d6c8',
                    border: '1px solid #4a3b2a', borderRadius: '4px', fontSize: '13px',
                  }}
                  placeholder="What do you do? (e.g., 'I search the room', 'I talk to the innkeeper'...)"
                  value={customAction}
                  onChange={e => setCustomAction(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCustomAction(); }}
                  disabled={narrating}
                />
                <button
                  style={{ ...styles.btn, padding: '10px 20px', opacity: narrating ? 0.5 : 1 }}
                  onClick={handleCustomAction}
                  disabled={narrating || !customAction.trim()}
                >
                  {narrating ? 'Thinking...' : 'Act'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
