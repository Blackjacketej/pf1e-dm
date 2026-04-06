import React, { useState, useRef, useEffect, useMemo } from 'react';
import GameLog from './GameLog';
import NPCPanel from './NPCPanel';
import AreaItemsPanel from './AreaItemsPanel';
import CollapsibleSection from './CollapsibleSection';
import ApiKeyBanner from './ApiKeyBanner';
import useIsMobile from '../hooks/useIsMobile';
import { rollDice, roll } from '../utils/dice';
import { db } from '../db/database';
import dmEngine from '../services/dmEngine';
import gameEvents from '../services/gameEventEngine';
import { generateNPC, storeNPC, generatePortrait, generateContextActions, generateAreaItems, getNPCDisplayName, revealNPCName, buildNPCDescription } from '../services/npcTracker';
import { DungeonMap, SettlementMap, ParchmentFrame } from './MapAssets';
import InteractiveMap from './InteractiveMap';
import mapRegistry from '../services/mapRegistry';

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
}) {
  const isMobile = useIsMobile();
  const [customAction, setCustomAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [nearbyNPCs, setNearbyNPCs] = useState(() => worldState?.nearbyNPCs || []);
  const [areaItems, setAreaItems] = useState(() => worldState?.areaItems || []);
  const [contextActions, setContextActions] = useState(() => worldState?.contextActions || []);

  // Sync local scene state back to worldState so it persists across reloads
  useEffect(() => {
    setWorldState(prev => {
      if (prev.nearbyNPCs === nearbyNPCs && prev.areaItems === areaItems && prev.contextActions === contextActions) return prev;
      return { ...prev, nearbyNPCs, areaItems, contextActions };
    });
  }, [nearbyNPCs, areaItems, contextActions, setWorldState]);

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

  const [lastEvent, setLastEvent] = useState(null);

  // Process new entities extracted from AI narration — add NPCs and items to the scene
  const processNewEntities = async (entities, location) => {
    if (!entities) return;
    const locationName = location || adventure?.location?.name || 'unknown';

    // Store new NPCs
    if (entities.npcs && entities.npcs.length > 0) {
      for (const npcData of entities.npcs) {
        try {
          // Build a minimal NPC object compatible with storeNPC
          const npc = generateNPC({
            name: npcData.name,
            race: npcData.race || 'Human',
            occupation: npcData.occupation || 'unknown',
            disposition: npcData.disposition || 'neutral',
          });
          // Override with AI-provided description
          npc.shortDesc = npcData.shortDesc || npc.shortDesc;
          npc.firstImpression = npcData.shortDesc || '';
          npc.location = locationName;
          npc.metAt = new Date().toISOString();
          // NPCs described by appearance start as unknown until properly introduced
          const nameIsDescription = /^(a |an |the |some )/i.test(npcData.name);
          npc.knownToParty = !nameIsDescription;
          if (nameIsDescription) {
            npc.shortDesc = npcData.name; // "a cloaked woman" becomes the shortDesc
          }
          npc.portraitSvg = generatePortrait(npc);
          const stored = await storeNPC(npc);
          // Add to nearbyNPCs if not already present
          setNearbyNPCs(prev => {
            if (prev.some(n => n.name === stored.name)) return prev;
            return [...prev, stored];
          });
        } catch (err) {
          console.warn('[Entity] Failed to store NPC:', npcData.name, err);
        }
      }
    }

    // Store new area items
    if (entities.items && entities.items.length > 0) {
      for (const itemData of entities.items) {
        try {
          const item = {
            name: itemData.name,
            description: itemData.description || '',
            location: locationName,
            found: new Date().toISOString(),
            mundane: false,
            interactable: true,
            loot: false,
          };
          // Check for duplicates
          const existing = await db.areaItems.where('name').equals(item.name).first();
          if (!existing) {
            await db.areaItems.add(item);
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
    if (!party || party.length === 0) {
      addLog?.('You need at least one character in your party to start an adventure!', 'system');
      return;
    }
    try {
      let loc;
      if (type === 'town') {
        loc = specificLocation || TOWN_LOCATIONS[Math.floor(Math.random() * TOWN_LOCATIONS.length)];
      } else {
        const locations = await db.locations.toArray();
        loc = locations.length > 0
          ? locations[Math.floor(Math.random() * locations.length)]
          : { name: 'The Unknown Depths', desc: 'A dark and mysterious place awaits...', terrain: 'underground' };
      }
      setAdventure({ active: true, location: loc, room: 0, explored: [], type });
      setAdventureType(type);
      addLog?.(`=== ${loc.name.toUpperCase()} ===`, 'header');
      addLog?.(loc.desc, 'narration');

      // Generate initial NPCs for this location
      const avgLevel = party.reduce((s, c) => s + (c.level || 1), 0) / (party.length || 1);
      const npcCount = type === 'town' ? 2 + Math.floor(Math.random() * 3) : Math.random() < 0.3 ? 1 : 0;
      const newNPCs = [];
      for (let i = 0; i < npcCount; i++) {
        const npc = generateNPC({ location: loc.name, level: Math.max(1, Math.floor(avgLevel) + Math.floor(Math.random() * 3) - 1) });
        npc.portraitSvg = generatePortrait(npc);
        const stored = await storeNPC(npc);
        newNPCs.push({ ...npc, id: stored.id });
      }
      setNearbyNPCs(newNPCs);

      // Generate area items
      const items = generateAreaItems(loc, avgLevel);
      setAreaItems(items);

      // Initial context actions
      const initEvent = { type: type === 'town' ? 'event' : 'explore', text: loc.desc };
      setContextActions(generateContextActions(initEvent, { type }, party));
      setLastEvent(initEvent);

      if (type === 'town') {
        if (newNPCs.length > 0) {
          const npcDescs = newNPCs.map(n => n.shortDesc || 'a stranger');
          addLog?.(`You notice ${npcDescs.join(', ')} nearby.`, 'npc');
        }
        addLog?.('You find yourselves in town. The streets bustle with activity. What would you like to do?', 'narration');
      } else {
        addLog?.('Your party stands at the entrance. The adventure begins...', 'narration');
      }
    } catch (err) {
      console.error('Start adventure error:', err);
      setAdventure({ active: true, location: { name: 'The Crossroads', desc: 'You stand at a dusty crossroads.' }, room: 0, explored: [], type: 'dungeon' });
      addLog?.('=== THE CROSSROADS ===', 'header');
      addLog?.('You stand at a dusty crossroads. The adventure begins...', 'narration');
    }
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
      addLog?.('No active adventure or party!', 'system');
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
        try {
          const result = await dmEngine.narrate('custom', {
            party,
            encounter: { name: adventure.location?.name || 'Town', description: adventure.location?.desc || '', type: 'roleplay' },
            recentLog: (gameLog || []).slice(-10),
          }, `I walk around ${adventure.location?.name || 'town'} and explore. Scene seed (use as inspiration, don't repeat verbatim): ${event.text}`);
          addLog?.(result.text, event.log || 'narration');
          if (result.newEntities) processNewEntities(result.newEntities);
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
          const stored = await storeNPC(npc);
          setNearbyNPCs(prev => {
            if (prev.some(n => n.name === npc.name)) return prev;
            return [...prev, { ...npc, id: stored.id }];
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

        // Occasionally refresh area items
        if (Math.random() < 0.25) {
          const newItems = generateAreaItems(adventure.location, party.reduce((s, c) => s + (c.level || 1), 0) / (party.length || 1));
          setAreaItems(prev => [...prev.filter(i => i.loot && !i.taken), ...newItems].slice(0, 8));
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

        // Update dungeon area items and context
        const dungeonItems = generateAreaItems(adventure.location || { terrain: 'dungeon' }, avgLevel);
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

    if (type === 'short') {
      addLog?.('=== SHORT REST (1 hour) ===', 'header');
      addLog?.('The party takes a brief rest. You catch your breath, tend minor wounds, and review your surroundings. No natural healing occurs during a short rest, but you may use healing magic or potions.', 'narration');
      // Advance time by 1 hour via engine
      const shortResult = gameEvents.onRest({ worldState, party, restType: 'short', terrain: adventure?.location?.terrain || 'plains' });
      if (setWorldState) setWorldState(prev => gameEvents.applyWorldUpdates(prev, shortResult.worldUpdates));
      gameEvents.eventsToLog(shortResult.events).forEach(e => addLog?.(e.text, e.type));
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

      // Apply world state updates (time, weather, etc.)
      if (setWorldState) setWorldState(prev => gameEvents.applyWorldUpdates(prev, restResult.worldUpdates));

      // Log all cascaded events (healing, conditions, encounters, weather, crafting)
      gameEvents.eventsToLog(restResult.events).forEach(e => addLog?.(e.text, e.type));

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

  const handleCustomAction = async () => {
    if (!customAction.trim() || narrating) return;
    const action = customAction.trim();
    setCustomAction('');

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
      // Process any new NPCs or items mentioned in the narration
      if (result.newEntities) {
        processNewEntities(result.newEntities);
      }
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

  // Handle "Talk to NPC" from panel
  const handleTalkToNPC = async (npc) => {
    const displayLabel = getNPCDisplayName(npc);
    const action = `I approach ${displayLabel} and speak with them`;
    setCustomAction('');
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
      if (result.newEntities) processNewEntities(result.newEntities);
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

    setNarrating(false);
  };

  // Handle area item interaction
  const handleItemInteract = (item) => {
    if (item.loot && item.gold) {
      addLog?.(`You pick up the ${item.name} and find ${item.gold} gold inside!`, 'loot');
      setAreaItems(prev => prev.filter(i => i !== item));
    } else if (item.loot && item.item) {
      addLog?.(`You take the ${item.item}!`, 'loot');
      setAreaItems(prev => prev.filter(i => i !== item));
    } else if (item.interactable) {
      const action = `I examine the ${item.name} closely`;
      addLog?.(`> ${action}`, 'action');
      setNarrating(true);
      dmEngine.narrate('custom', {
        party,
        encounter: adventure?.location ? { name: adventure.location.name, description: adventure.location.desc, type: adventure.type === 'town' ? 'roleplay' : 'exploration' } : null,
        recentLog: (gameLog || []).slice(-10),
      }, action).then(result => {
        addLog?.(result.text, 'narration');
        if (result.newEntities) processNewEntities(result.newEntities);
      }).catch(() => {
        addLog?.(`You examine the ${item.name}. ${item.description}`, 'narration');
      }).finally(() => setNarrating(false));
    }
  };

  // Handle contextual action button
  const handleContextAction = (action) => {
    setCustomAction('');
    addLog?.(`> ${action.action}`, action.type === 'skill' ? 'info' : 'action');
    setNarrating(true);
    dmEngine.narrate('custom', {
      party,
      encounter: adventure?.location ? { name: adventure.location.name, description: adventure.location.desc, type: adventure.type === 'town' ? 'roleplay' : 'exploration' } : null,
      recentLog: (gameLog || []).slice(-15),
    }, action.action).then(result => {
      addLog?.(result.text, 'narration');
      if (result.newEntities) processNewEntities(result.newEntities);
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
  const renderMap = () => {
    if (adventure?.type === 'dungeon') {
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
    if (adventure?.type === 'town' && adventure?.location) {
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

  // Context action buttons renderer
  const renderContextActions = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
            <div style={{ color: '#8b949e', fontSize: '11px' }}>
              {adventure?.type === 'town' ? 'Town Adventure' : 'Dungeon Crawl'}
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

        {/* Scrollable content area */}
        <div style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {/* Game Log — always visible, takes most space */}
          <div style={{ padding: '6px', minHeight: '250px', maxHeight: '50vh' }}>
            <GameLog logs={gameLog} logRef={logRef} />
          </div>

          {/* Collapsible sections */}
          <div style={{ padding: '0 6px 6px' }}>
            {/* Context Actions — most important, default open */}
            {contextActions.length > 0 && (
              <CollapsibleSection
                title="What do you do?"
                icon="🎭"
                count={contextActions.length}
                defaultOpen={true}
                color="#b8b8ff"
              >
                {renderContextActions()}
              </CollapsibleSection>
            )}

            {/* Map */}
            {renderMap() && (
              <CollapsibleSection
                title="Map"
                icon="🗺️"
                defaultOpen={false}
                color="#ffd700"
              >
                {renderMap()}
              </CollapsibleSection>
            )}

            {/* NPCs */}
            {nearbyNPCs.length > 0 && (
              <CollapsibleSection
                title="Nearby NPCs"
                icon="👥"
                count={nearbyNPCs.length}
                defaultOpen={false}
                color="#40e0d0"
              >
                <NPCPanel npcs={nearbyNPCs} onTalkTo={narrating ? null : handleTalkToNPC} />
              </CollapsibleSection>
            )}

            {/* Items */}
            {areaItems.length > 0 && (
              <CollapsibleSection
                title="Area Items"
                icon="🎒"
                count={areaItems.length}
                defaultOpen={false}
                color="#ffd700"
              >
                <AreaItemsPanel items={areaItems} onInteract={narrating ? null : handleItemInteract} />
              </CollapsibleSection>
            )}
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
            <button
              style={{ ...styles.mobileBtn }}
              onClick={handleForceEncounter}
              disabled={loading || narrating || !party || party.length === 0}
            >
              ⚔️ Fight
            </button>
          </div>
          {/* Travel button */}
          <div style={{ marginBottom: '8px' }}>
            {adventure?.type === 'town' ? (
              <button
                style={{ ...styles.mobileBtn, width: '100%', borderColor: '#7b68ee', color: '#7b68ee' }}
                onClick={() => startAdventure('dungeon')}
              >
                🏔️ Leave Town
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
          {/* Custom action input */}
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
        </div>
      </div>
    );
  }

  // --- DESKTOP LAYOUT ---
  return (
    <div style={styles.container}>
      {/* API Key Banner */}
      <ApiKeyBanner onOpenSettings={() => setTab?.('Settings')} />

      {/* Main content: log + side panels */}
      <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
        {/* Game log - main area */}
        <div style={{ ...styles.logContainer, flex: '1 1 0' }}>
          <GameLog logs={gameLog} logRef={logRef} />
        </div>

        {/* Side panel: Map + NPCs + Area Items */}
        <div style={{ width: '260px', flexShrink: 0, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {renderMap()}
          {nearbyNPCs.length > 0 && <NPCPanel npcs={nearbyNPCs} onTalkTo={narrating ? null : handleTalkToNPC} />}
          {areaItems.length > 0 && <AreaItemsPanel items={areaItems} onInteract={narrating ? null : handleItemInteract} />}
        </div>
      </div>

      {/* Contextual action choices */}
      {contextActions.length > 0 && (
        <div style={{ flexShrink: 0, padding: '6px 8px', borderTop: '1px solid rgba(255, 215, 0, 0.2)', maxHeight: '160px', overflowY: 'auto' }}>
          <div style={{ fontSize: '10px', color: '#8b949e', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>What do you do?</div>
          {renderContextActions()}
        </div>
      )}

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
        <button
          style={styles.button}
          onClick={handleForceEncounter}
          disabled={loading || narrating || !party || party.length === 0}
        >
          Force Encounter
        </button>
        {adventure?.type === 'town' && (
          <button
            style={{ ...styles.button, borderColor: '#7b68ee', color: '#7b68ee' }}
            onClick={() => { startAdventure('dungeon'); }}
          >
            Leave Town
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
    </div>
  );
}
