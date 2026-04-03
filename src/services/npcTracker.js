/**
 * NPC Tracker
 *
 * Generates, stores, and manages NPCs the party encounters.
 * Each NPC has stats, personality, appearance, and disposition.
 */

import { db } from '../db/database';
import { roll } from '../utils/dice';

// ── Name Pools ──
const FIRST_NAMES_M = ['Aldric','Belor','Caius','Dorian','Egan','Falk','Garret','Harsk','Ivar','Jasper','Kael','Lorian','Magnus','Nolam','Orik','Pavel','Quinlan','Roran','Shalelu','Toren','Ulric','Vosk','Warrel','Xander','Yorick','Zantus'];
const FIRST_NAMES_F = ['Ameiko','Brielle','Calista','Dara','Elara','Fiora','Gwynn','Hana','Ilsa','Jade','Kestra','Lini','Merisiel','Nadia','Oona','Penelope','Quinn','Roxanne','Seoni','Tanis','Uma','Valeria','Wren','Ximena','Yara','Zelara'];
const LAST_NAMES = ['Blackwood','Ironforge','Stoneheart','Ravenglass','Thornwall','Ashford','Brightwater','Coldmoor','Darkholme','Embervane','Foxglove','Greenhill','Hawkwind','Icemere','Jasperion','Kaijitsu','Longbottom','Moonwhisper','Nightingale','Oakshield','Proudfoot','Quillwright','Redthorn','Shadowmend','Truegold','Underhill','Valorian','Winterborn','Yarrow','Zoltan'];

const RACES = ['Human','Human','Human','Human','Elf','Half-Elf','Dwarf','Halfling','Gnome','Half-Orc','Tiefling','Aasimar'];
const NPC_CLASSES = ['Commoner','Expert','Warrior','Aristocrat','Adept','Fighter','Rogue','Cleric','Wizard','Ranger','Bard','Sorcerer','Monk','Paladin','Druid','Alchemist','Witch'];
const DISPOSITIONS = ['friendly','neutral','wary','hostile','fearful','curious','amused','suspicious'];
const PERSONALITY_TRAITS = ['gruff','jovial','nervous','cunning','pious','greedy','kind','secretive','boisterous','melancholy','stern','absent-minded','flirtatious','paranoid','noble','sarcastic'];
const OCCUPATIONS = ['merchant','blacksmith','innkeeper','guard','farmer','priest','scholar','thief','sailor','hunter','herbalist','bard','beggar','noble','fisherman','miner','carpenter','brewer','tailor','soldier'];

const HAIR_COLORS = ['black','brown','auburn','blonde','red','silver','white','gray'];
const HAIR_STYLES = ['long','short','braided','shaved','curly','straight','tied back','wild'];
const EYE_COLORS = ['brown','blue','green','gray','hazel','amber','violet','black'];
const BUILD = ['thin','stocky','muscular','heavyset','lean','average','willowy','broad-shouldered'];
const DISTINGUISHING = ['a scar across the cheek','a missing finger','a prominent tattoo','an eyepatch','unusually tall','remarkably short','a limp','a booming laugh','a quiet voice','freckles everywhere','a crooked nose','burn marks on the hands','an elaborate mustache','piercing gaze','calloused hands','a nervous tic'];

// ── Generate a Random NPC ──
export function generateNPC(options = {}) {
  const isFemale = Math.random() < 0.5;
  const firstName = options.name || (isFemale
    ? FIRST_NAMES_F[Math.floor(Math.random() * FIRST_NAMES_F.length)]
    : FIRST_NAMES_M[Math.floor(Math.random() * FIRST_NAMES_M.length)]);
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const name = options.name || `${firstName} ${lastName}`;

  const race = options.race || RACES[Math.floor(Math.random() * RACES.length)];
  const npcClass = options.class || NPC_CLASSES[Math.floor(Math.random() * NPC_CLASSES.length)];
  const level = options.level || Math.max(1, Math.min(10, Math.floor(Math.random() * 5) + 1));
  const occupation = options.occupation || OCCUPATIONS[Math.floor(Math.random() * OCCUPATIONS.length)];
  const disposition = options.disposition || DISPOSITIONS[Math.floor(Math.random() * DISPOSITIONS.length)];
  const personality = options.personality || PERSONALITY_TRAITS[Math.floor(Math.random() * PERSONALITY_TRAITS.length)];

  // Simple stats based on class
  const isWarrior = ['Fighter','Warrior','Ranger','Paladin','Monk','Soldier'].includes(npcClass);
  const isCaster = ['Wizard','Sorcerer','Cleric','Druid','Witch','Adept','Alchemist'].includes(npcClass);

  const str = isWarrior ? 12 + roll(4) : 8 + roll(6);
  const dex = ['Rogue','Ranger','Monk'].includes(npcClass) ? 12 + roll(4) : 8 + roll(6);
  const con = 8 + roll(6);
  const int = isCaster ? 12 + roll(4) : 8 + roll(6);
  const wis = ['Cleric','Druid','Monk'].includes(npcClass) ? 12 + roll(4) : 8 + roll(6);
  const cha = ['Bard','Sorcerer','Paladin'].includes(npcClass) ? 12 + roll(4) : 8 + roll(6);

  const conMod = Math.floor((con - 10) / 2);
  const hd = isWarrior ? 10 : isCaster ? 6 : 8;
  const hp = Math.max(1, hd + conMod + (level - 1) * Math.max(1, Math.floor(hd / 2) + conMod));
  const ac = isWarrior ? 14 + Math.floor(level / 3) : 10 + Math.floor((dex - 10) / 2);

  // Appearance
  const appearance = {
    gender: isFemale ? 'female' : 'male',
    hair: `${HAIR_STYLES[Math.floor(Math.random() * HAIR_STYLES.length)]} ${HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]}`,
    eyes: EYE_COLORS[Math.floor(Math.random() * EYE_COLORS.length)],
    build: BUILD[Math.floor(Math.random() * BUILD.length)],
    distinguishing: DISTINGUISHING[Math.floor(Math.random() * DISTINGUISHING.length)],
    age: npcClass === 'Commoner' ? 15 + Math.floor(Math.random() * 50) : 18 + Math.floor(Math.random() * 40),
  };

  // Build a description-based label for before the PCs learn the NPC's name
  const genderWord = isFemale ? 'woman' : 'man';
  const ageRange = appearance.age < 20 ? 'young' : appearance.age < 35 ? '' : appearance.age < 55 ? 'middle-aged' : 'elderly';
  const raceAdj = race === 'Human' ? '' : race.toLowerCase();
  const buildAdj = appearance.build !== 'average' ? appearance.build : '';
  const descParts = [ageRange, buildAdj, raceAdj, genderWord].filter(Boolean);
  const shortDesc = descParts.join(' ');
  // Longer first-impression text using distinguishing features
  const distinguishingText = appearance.distinguishing ? ` with ${appearance.distinguishing}` : '';
  const hairText = appearance.hair ? `, ${appearance.hair} hair` : '';
  const firstImpression = `A ${shortDesc}${hairText}${distinguishingText}. They look like a ${occupation}.`;

  return {
    name,
    race,
    class: npcClass,
    level,
    occupation,
    disposition,
    personality,
    hp, maxHP: hp, ac,
    abilities: { STR: str, DEX: dex, CON: con, INT: int, WIS: wis, CHA: cha },
    appearance,
    // Name/identity tracking
    knownToParty: options.knownToParty || false,  // PCs don't know their name yet
    shortDesc,            // e.g. "stocky dwarven man"
    firstImpression,      // e.g. "A stocky dwarven man, braided red hair, with a missing finger. They look like a blacksmith."
    notes: '',
    metAt: new Date().toISOString(),
    location: options.location || 'Unknown',
    alive: true,
    interactions: 0,
  };
}

// ── Get display name for NPC (description if unknown, name if known) ──
export function getNPCDisplayName(npc) {
  if (!npc) return 'someone';
  if (npc.knownToParty) return npc.name;
  // Use the short description as their "name" until revealed
  return npc.shortDesc ? `the ${npc.shortDesc}` : 'a stranger';
}

// ── Reveal NPC name to party (e.g. after introduction) ──
export async function revealNPCName(npcOrId) {
  const id = typeof npcOrId === 'object' ? npcOrId.id : npcOrId;
  if (id) {
    await db.encounteredNpcs.update(id, { knownToParty: true });
  }
  // Also return updated NPC for in-memory state
  if (typeof npcOrId === 'object') {
    return { ...npcOrId, knownToParty: true };
  }
  return db.encounteredNpcs.get(id);
}

// ── Build NPC description for DM narration prompt ──
export function buildNPCDescription(npc) {
  if (!npc) return '';
  const parts = [];
  const { appearance } = npc;
  if (appearance) {
    const gender = appearance.gender === 'female' ? 'woman' : 'man';
    const age = appearance.age < 20 ? 'young' : appearance.age < 35 ? '' : appearance.age < 55 ? 'middle-aged' : 'elderly';
    parts.push(`${age} ${npc.race.toLowerCase()} ${gender}`.trim());
    if (appearance.build && appearance.build !== 'average') parts.push(appearance.build + ' build');
    if (appearance.hair) parts.push(appearance.hair + ' hair');
    if (appearance.eyes) parts.push(appearance.eyes + ' eyes');
    if (appearance.distinguishing) parts.push(appearance.distinguishing);
  }
  parts.push(`appears to be a ${npc.occupation}`);
  parts.push(`seems ${npc.disposition}`);
  return parts.join(', ');
}

// ── Store an encountered NPC ──
export async function storeNPC(npc) {
  // Check for duplicates by name
  const existing = await db.encounteredNpcs.where('name').equals(npc.name).first();
  if (existing) {
    // Update interaction count and disposition
    await db.encounteredNpcs.update(existing.id, {
      interactions: (existing.interactions || 0) + 1,
      disposition: npc.disposition || existing.disposition,
      location: npc.location || existing.location,
    });
    return { ...existing, interactions: (existing.interactions || 0) + 1 };
  }
  const id = await db.encounteredNpcs.add(npc);
  return { ...npc, id };
}

// ── Get all encountered NPCs ──
export async function getEncounteredNPCs() {
  return db.encounteredNpcs.toArray();
}

// ── Get NPCs at a specific location ──
export async function getNPCsAtLocation(location) {
  return db.encounteredNpcs.where('location').equals(location).toArray();
}

// ── Update NPC ──
export async function updateNPC(id, changes) {
  await db.encounteredNpcs.update(id, changes);
}

// ── Generate NPC Portrait (SVG) ──
export function generatePortrait(npc) {
  const { appearance, race } = npc;
  const isFemale = appearance?.gender === 'female';

  // Color mapping
  const skinTones = {
    'Human': ['#F5D5B5', '#D4A574', '#C68642', '#8D5524', '#F0C8A0'],
    'Elf': ['#F5E6D3', '#E8D5C4', '#D4C5B5', '#F0E0D0', '#E5D0C0'],
    'Half-Elf': ['#F5D5B5', '#E8D0B5', '#D4B595', '#F0C8A0', '#E0C0A0'],
    'Dwarf': ['#E8C8A8', '#D4A574', '#C8A080', '#D0B090', '#C0A080'],
    'Halfling': ['#F5D5B5', '#F0D0A0', '#E8C898', '#F0C8A0', '#E5C090'],
    'Gnome': ['#F5E0C8', '#E8D0B8', '#F0D8C0', '#E5D0C0', '#F0E0D0'],
    'Half-Orc': ['#A8B87A', '#8FA068', '#7A9050', '#90A870', '#80A060'],
    'Tiefling': ['#D4A0A0', '#C89090', '#B88080', '#D09898', '#C08888'],
    'Aasimar': ['#F5E8D5', '#F0E5D0', '#F5F0E0', '#F0E8D8', '#F5E0D0'],
  };

  const hairColorMap = {
    'black': '#1a1a1a', 'brown': '#5C4033', 'auburn': '#922724', 'blonde': '#E8D44D',
    'red': '#C62828', 'silver': '#C0C0C0', 'white': '#F0F0F0', 'gray': '#808080',
  };

  const eyeColorMap = {
    'brown': '#5C3317', 'blue': '#2196F3', 'green': '#2E7D32', 'gray': '#757575',
    'hazel': '#8B7355', 'amber': '#FFA000', 'violet': '#7B1FA2', 'black': '#212121',
  };

  const tones = skinTones[race] || skinTones['Human'];
  const skinColor = tones[Math.floor(Math.random() * tones.length)];
  const hairRaw = (appearance?.hair || 'short brown').split(' ');
  const hairColor = hairColorMap[hairRaw[hairRaw.length - 1]] || '#5C4033';
  const eyeColor = eyeColorMap[appearance?.eyes] || '#5C3317';

  // Build type affects face shape
  const isWide = ['stocky', 'heavyset', 'broad-shouldered', 'muscular'].includes(appearance?.build);
  const faceW = isWide ? 38 : 32;
  const faceH = 42;

  // Ear shape for elves
  const isElf = race === 'Elf' || race === 'Half-Elf';
  const isOrc = race === 'Half-Orc';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120">
  <defs>
    <radialGradient id="skin_${npc.name?.replace(/\s/g, '')}" cx="50%" cy="40%" r="50%">
      <stop offset="0%" style="stop-color:${skinColor};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${skinColor};stop-opacity:0.85"/>
    </radialGradient>
  </defs>
  <!-- Background -->
  <rect width="100" height="120" rx="8" fill="#2a2a4e"/>
  <!-- Neck -->
  <rect x="42" y="78" width="16" height="14" rx="4" fill="${skinColor}" opacity="0.9"/>
  <!-- Shoulders/body hint -->
  <ellipse cx="50" cy="105" rx="30" ry="18" fill="#3a3a6e" stroke="#555" stroke-width="0.5"/>
  <!-- Face -->
  <ellipse cx="50" cy="52" rx="${faceW / 2}" ry="${faceH / 2}" fill="url(#skin_${npc.name?.replace(/\s/g, '')})" stroke="${skinColor}" stroke-width="0.5"/>
  ${isElf ? `<!-- Elf ears -->
  <polygon points="24,45 18,35 28,48" fill="${skinColor}"/>
  <polygon points="76,45 82,35 72,48" fill="${skinColor}"/>` : ''}
  ${isOrc ? `<!-- Orc tusks -->
  <line x1="40" y1="65" x2="39" y2="60" stroke="#F5F5DC" stroke-width="2" stroke-linecap="round"/>
  <line x1="60" y1="65" x2="61" y2="60" stroke="#F5F5DC" stroke-width="2" stroke-linecap="round"/>` : ''}
  <!-- Hair -->
  <ellipse cx="50" cy="${isFemale ? 36 : 38}" rx="${faceW / 2 + 3}" ry="${isFemale ? 22 : 18}" fill="${hairColor}" opacity="0.9"/>
  ${isFemale ? `<rect x="${50 - faceW / 2 - 2}" y="42" width="${faceW + 4}" height="35" rx="3" fill="${hairColor}" opacity="0.6"/>` : ''}
  <!-- Eyes -->
  <ellipse cx="40" cy="50" rx="5" ry="3.5" fill="white"/>
  <ellipse cx="60" cy="50" rx="5" ry="3.5" fill="white"/>
  <circle cx="40" cy="50" r="2.5" fill="${eyeColor}"/>
  <circle cx="60" cy="50" r="2.5" fill="${eyeColor}"/>
  <circle cx="40" cy="50" r="1" fill="#111"/>
  <circle cx="60" cy="50" r="1" fill="#111"/>
  <!-- Eyebrows -->
  <line x1="35" y1="${isOrc ? 44 : 45}" x2="45" y2="${isOrc ? 43 : 44}" stroke="${hairColor}" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="55" y1="${isOrc ? 43 : 44}" x2="65" y2="${isOrc ? 44 : 45}" stroke="${hairColor}" stroke-width="1.5" stroke-linecap="round"/>
  <!-- Nose -->
  <path d="M48,53 Q50,${isOrc ? 60 : 58} 52,53" fill="none" stroke="${skinColor}" stroke-width="1" opacity="0.6"/>
  <!-- Mouth -->
  <path d="M42,62 Q50,${isFemale ? 67 : 66} 58,62" fill="none" stroke="#8B4513" stroke-width="${isFemale ? 1.5 : 1}" opacity="0.7"/>
  <!-- Scar or distinguishing mark -->
  ${(appearance?.distinguishing || '').includes('scar') ? `<line x1="55" y1="45" x2="65" y2="58" stroke="#C0A080" stroke-width="1" opacity="0.6"/>` : ''}
  ${(appearance?.distinguishing || '').includes('eyepatch') ? `<ellipse cx="60" cy="50" rx="7" ry="5" fill="#222" stroke="#444" stroke-width="0.5"/>
  <line x1="53" y1="38" x2="67" y2="38" stroke="#444" stroke-width="1"/>` : ''}
</svg>`;

  return svg;
}

// ── Generate Contextual Actions from Events ──
/**
 * Generate scene-specific context actions based on the narrative text.
 * This is the procedural fallback — when AI is available, the AI generates
 * suggested actions directly. These should be specific to what's actually
 * described in the scene text, not generic.
 */
export function generateContextActions(event, adventure, party) {
  const actions = [];
  const type = event?.type || '';
  const text = (event?.text || '').toLowerCase();
  const isTown = adventure?.type === 'town';
  const isDungeon = adventure?.type === 'dungeon';
  const locationName = (adventure?.location?.name || '').toLowerCase();

  // ── Extract scene details from narrative text ──
  // Find specific nouns/subjects mentioned in the text
  const mentionsPerson = /\b(woman|man|merchant|figure|stranger|guard|priest|bard|innkeeper|shopkeeper|bartender|dwarf|elf|halfling|gnome|farmer|noble|beggar|child|crier|apothecary|smith|sailor)\b/i.test(text);
  const mentionsPlace = text.match(/\b(tavern|inn|shop|store|temple|church|market|square|dock|gate|bridge|tower|mill|manor|graveyard|lighthouse|garrison|academy|cathedral|harbor)\b/i);
  const mentionsThreat = /\b(fight|weapon|pickpocket|thief|thieves|bandit|scream|blood|body|attack|danger|threat|suspicious|shady|dark|shadow|growl|hiss)\b/i.test(text);
  const mentionsObject = text.match(/\b(note|letter|book|scroll|map|chest|barrel|crate|door|lock|key|symbol|rune|inscription|carving|altar|statue|lever|switch|trap|pit|web|bones)\b/i);
  const mentionsGoblin = /\b(goblin|raid|sighting)\b/i.test(text);
  const mentionsMagic = /\b(magic|arcane|glow|shimmer|enchant|aura|spell|rune|ward|sigil)\b/i.test(text);
  const mentionsRumor = /\b(rumor|heard|whisper|overheard|says|folk|people say|they say|word is)\b/i.test(text);
  const mentionsNature = /\b(forest|cave|cliff|river|sea|mountain|swamp|trail|path|road|bridge|camp)\b/i.test(text);

  // ── Build scene-specific actions ──

  if (mentionsPerson) {
    const personMatch = text.match(/\b(woman|man|merchant|figure|stranger|guard|priest|bard|innkeeper|shopkeeper|bartender|dwarf|elf|halfling|gnome|farmer|noble|beggar|apothecary|smith|sailor)\b/i);
    const person = personMatch ? personMatch[0] : 'stranger';
    actions.push({ label: `Approach the ${person}`, action: `I approach the ${person} and try to start a conversation`, type: 'social' });
    actions.push({ label: `Read their intent`, action: `I study the ${person}'s body language and demeanor (Sense Motive check)`, type: 'skill' });
  }

  if (mentionsThreat) {
    if (text.includes('pickpocket') || text.includes('thief')) {
      actions.push({ label: 'Grab the thief', action: 'I grab the pickpocket by the wrist before they can escape', type: 'combat' });
      actions.push({ label: 'Call the guard', action: 'I shout for the town guard to stop the thief', type: 'social' });
    } else if (text.includes('fight') || text.includes('weapon')) {
      actions.push({ label: 'Break it up', action: 'I step between the combatants and try to calm things down (Diplomacy check)', type: 'social' });
      actions.push({ label: 'Intimidate them', action: 'I crack my knuckles and tell them to stand down (Intimidate check)', type: 'social' });
      actions.push({ label: 'Stay back', action: 'I keep my distance but watch carefully for anyone who might need help', type: 'explore' });
    } else {
      actions.push({ label: 'Draw weapons', action: 'I draw my weapon and prepare for trouble', type: 'combat' });
      actions.push({ label: 'Stay alert', action: 'I keep my hand on my weapon and scan for the source of danger (Perception check)', type: 'skill' });
    }
  }

  if (mentionsRumor) {
    actions.push({ label: 'Press for details', action: 'I lean in and ask for specific details — names, locations, when it happened', type: 'social' });
    actions.push({ label: 'Cross-reference', action: 'What do I already know about this from local history or lore? (Knowledge Local check)', type: 'skill' });
  }

  if (mentionsPlace) {
    const place = mentionsPlace[0];
    if (place === 'shop' || place === 'store' || place === 'market') {
      actions.push({ label: `Enter the ${place}`, action: `I enter the ${place} and browse what they have for sale`, type: 'explore' });
      actions.push({ label: 'Appraise the goods', action: `I examine the ${place}'s wares with a critical eye (Appraise check)`, type: 'skill' });
    } else if (place === 'tavern' || place === 'inn') {
      actions.push({ label: 'Order a drink', action: 'I sit at the bar and order an ale, listening to the conversation around me', type: 'social' });
      actions.push({ label: 'Ask the innkeeper', action: 'I ask the innkeeper what news or rumors they have heard lately', type: 'social' });
    } else if (place === 'temple' || place === 'church' || place === 'cathedral') {
      actions.push({ label: `Visit the ${place}`, action: `I enter the ${place} and speak with whoever is attending`, type: 'social' });
    } else if (place === 'graveyard') {
      actions.push({ label: 'Investigate the graves', action: 'I carefully examine the graveyard for signs of disturbance (Perception check)', type: 'skill' });
    } else {
      actions.push({ label: `Head to the ${place}`, action: `I make my way toward the ${place} to see what is there`, type: 'explore' });
    }
  }

  if (mentionsObject) {
    const obj = mentionsObject[0];
    if (['note', 'letter', 'book', 'scroll', 'map'].includes(obj)) {
      actions.push({ label: `Read the ${obj}`, action: `I carefully read the ${obj}, looking for useful information (Linguistics check)`, type: 'skill' });
    } else if (['chest', 'door', 'lock'].includes(obj)) {
      actions.push({ label: `Open the ${obj}`, action: `I check the ${obj} for traps, then try to open it (Disable Device check)`, type: 'skill' });
      actions.push({ label: `Force it open`, action: `I put my shoulder into the ${obj} and try to force it (Strength check)`, type: 'combat' });
    } else if (['symbol', 'rune', 'inscription', 'carving'].includes(obj)) {
      actions.push({ label: `Study the ${obj}`, action: `I examine the ${obj} closely to determine its meaning (Knowledge Arcana/Spellcraft check)`, type: 'skill' });
    } else if (['lever', 'switch'].includes(obj)) {
      actions.push({ label: `Pull the ${obj}`, action: `I carefully pull the ${obj} while the party stands ready`, type: 'explore' });
    } else if (['altar', 'statue'].includes(obj)) {
      actions.push({ label: `Examine the ${obj}`, action: `I approach the ${obj} and examine it for religious or magical significance (Knowledge Religion check)`, type: 'skill' });
    } else if (['trap', 'pit', 'web'].includes(obj)) {
      actions.push({ label: 'Find a way around', action: `I look for an alternate path around the ${obj} (Perception check)`, type: 'skill' });
    }
  }

  if (mentionsGoblin) {
    actions.push({ label: 'Track the goblins', action: 'I search for goblin tracks or signs of their passage (Survival check)', type: 'skill' });
    actions.push({ label: 'Ask about goblins', action: 'I ask the locals what they know about recent goblin activity and where they were seen', type: 'social' });
  }

  if (mentionsMagic) {
    actions.push({ label: 'Detect Magic', action: 'I cast Detect Magic to identify any magical auras in the area', type: 'skill' });
    actions.push({ label: 'Identify the magic', action: 'I try to determine the school and strength of the magic (Spellcraft check)', type: 'skill' });
  }

  // ── Dungeon-specific based on scene ──
  if (isDungeon) {
    if (actions.length === 0) {
      // Only add generic dungeon actions if nothing scene-specific was found
      actions.push({ label: 'Check for traps', action: 'I carefully scan the floor and walls ahead for traps (Perception check)', type: 'skill' });
      actions.push({ label: 'Listen ahead', action: 'I press my ear to the wall and listen for movement beyond (Perception check)', type: 'skill' });
    }
    if (mentionsNature) {
      const terrain = text.match(/\b(cave|cliff|river|swamp|bridge)\b/i);
      if (terrain) {
        actions.push({ label: `Navigate the ${terrain[0]}`, action: `I carefully navigate the ${terrain[0]}, testing my footing (Acrobatics/Climb check)`, type: 'skill' });
      }
    }
  }

  // ── Town-specific based on scene ──
  if (isTown && actions.length === 0) {
    // Scene-appropriate town defaults based on location
    if (locationName.includes('rusty dragon') || locationName.includes('inn') || locationName.includes('tavern') || locationName.includes('feedbag')) {
      actions.push({ label: 'Listen to patrons', action: 'I eavesdrop on nearby conversations, hoping to hear something interesting (Perception check)', type: 'skill' });
      actions.push({ label: 'Buy a round', action: 'I buy a round of drinks for the locals to loosen their tongues (Diplomacy check)', type: 'social' });
    } else if (locationName.includes('sandpoint')) {
      actions.push({ label: 'Visit the market', action: 'I head toward the marketplace to see what goods are available today', type: 'explore' });
      actions.push({ label: 'Ask about work', action: 'I ask around town if anyone needs help with anything — bounties, odd jobs, or problems', type: 'social' });
    } else {
      actions.push({ label: 'Observe the area', action: 'I take a moment to observe my surroundings carefully, noting exits, people, and anything unusual (Perception check)', type: 'skill' });
      actions.push({ label: 'Talk to locals', action: 'I strike up a friendly conversation with someone nearby to learn about this place', type: 'social' });
    }
  }

  // Cap at 5 actions max
  return actions.slice(0, 5);
}

// ── Generate Area Items ──
// Each item includes a description of WHERE it is and WHAT it looks like.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const TOWN_ITEMS = [
  // Mundane scenery
  { name: 'Torch', descriptions: [
    'A sputtering tar-soaked torch wedged into a rusted iron sconce on the wall, casting flickering orange light across the cobblestones.',
    'Mounted high on a wooden post near the doorway, this torch is half-burned down, its flame dancing in the draft.',
    'A fresh torch leans in a barrel by the entrance, its wrapped head still dark with unlit pitch.',
  ], mundane: true },
  { name: 'Barrel of Ale', descriptions: [
    'A squat oak barrel sits behind the bar counter, its lid loosely set. A tin ladle hangs from a nail beside it, and the wood is stained dark from years of use.',
    'Tucked into the corner near the hearth, this dented copper-banded barrel has a small spigot and a puddle of amber liquid beneath it.',
    'A half-empty cask rests on a wooden cradle against the far wall. Someone has chalked "2 cp" on the side.',
  ], mundane: true },
  { name: 'Hanging Lantern', descriptions: [
    'A green-glass lantern dangles from a chain above the center table, swaying slightly and throwing colored shadows across the room.',
    'An oil lantern with a cracked chimney sits on a shelf near the window, its flame low and guttering.',
  ], mundane: true },
  { name: 'Worn Rug', descriptions: [
    'A threadbare Varisian rug covers the floor beneath the main table. Its once-bright geometric patterns have faded to muddy browns and dull reds.',
    'A rolled-up animal hide rug leans against the wall near the fireplace, too worn to lay flat anymore.',
  ], mundane: true },
  { name: 'Mounted Trophy', descriptions: [
    'A boar\'s head is mounted above the mantle, its glass eyes catching the firelight. A plaque beneath it reads something in faded script.',
    'A pair of antlers hangs over the door, draped with a faded garland of dried herbs.',
  ], mundane: true },
  // Loot
  { name: 'Discarded Coin Purse', descriptions: [
    'Kicked under a bench near the door, a small leather purse lies in the dust. Its drawstring is loose and a copper glints inside.',
    'Half-hidden beneath a crumpled napkin on an empty table, a worn velvet coin pouch with a broken clasp.',
    'Wedged between two floorboards near the bar, a tiny canvas pouch — someone must have dropped it in their cups.',
  ], loot: true, goldDice: 6 },
  { name: 'Silver Ring', descriptions: [
    'Sitting in a crack between two flagstones near the hearth, a tarnished silver ring catches the firelight.',
    'Resting on the windowsill behind a dusty curtain, a thin silver band with a tiny blue stone.',
  ], loot: true, goldDice: 10 },
  // Interactable
  { name: 'Notice Board', descriptions: [
    'A weathered cork board hangs beside the entrance, crowded with overlapping handbills, bounty notices, and a hand-drawn map pinned with a rusty nail.',
    'Near the town well, a tall wooden post is plastered with notices. Several are torn or rain-damaged, but a few fresh postings stand out.',
  ], interactable: true },
  { name: 'Suspicious Crate', descriptions: [
    'A nailed-shut wooden crate sits in the alley behind the building. Fresh scratches around the nails suggest someone tried to pry it open recently.',
    'Stacked near the back door, a crate marked with a merchant\'s seal you don\'t recognize. It\'s heavier than it looks.',
  ], interactable: true },
  { name: 'Old Well', descriptions: [
    'A stone well with a mossy wooden cover sits in the corner of the square. The rope is frayed and the bucket is missing.',
  ], interactable: true },
];

const TAVERN_ITEMS = [
  { name: 'Menu Board', descriptions: [
    'A slate chalkboard leans against the wall behind the bar. Today\'s specials are scrawled in uneven letters, with prices scratched out and rewritten.',
    'A wooden board hangs from two chains above the serving window. The day\'s meals are painted in white: stew, bread, and roast pheasant.',
  ], interactable: true },
  { name: 'Forgotten Journal', descriptions: [
    'On a corner table sticky with old ale, a leather-bound journal lies open. The handwriting inside is cramped and hurried, with several pages torn out.',
    'Tucked behind a cushion on the window seat, a small book bound in worn red leather. A quill is pressed between its pages as a bookmark.',
  ], interactable: true, loot: true },
  { name: 'Abandoned Mug', descriptions: [
    'A pewter tankard sits alone at an otherwise empty table. The ale inside is still faintly warm — whoever left it did so recently.',
  ], mundane: true },
  { name: 'Bard\'s Instrument Case', descriptions: [
    'Propped against a chair near the small stage, a battered lute case with peeling leather and a broken latch. Something rattles inside.',
  ], interactable: true },
];

const DUNGEON_ITEMS = [
  // Mundane
  { name: 'Scattered Bones', descriptions: [
    'A jumble of yellowed bones is heaped against the far wall — a cracked femur, several ribs, and what might be a jawbone. Cobwebs stretch between them.',
    'Crunching underfoot, small bones and bone fragments are scattered across the flagstones. Some are humanoid. Some are not.',
    'In an alcove to the left, a complete skeleton sits slumped against the stone, still wearing the tatters of a leather jerkin.',
  ], mundane: true },
  { name: 'Rusty Chain', descriptions: [
    'A heavy iron chain is bolted into the wall at shoulder height, its last three links dangling free over a dark stain on the floor.',
    'Coiled in the corner like a dead snake, a length of corroded chain. The wall bracket it was attached to has pulled free of the crumbling mortar.',
  ], mundane: true },
  { name: 'Dripping Water', descriptions: [
    'Water seeps through a crack in the ceiling and drips steadily into a shallow pool on the floor. The stone around it is stained green with mineral deposits.',
    'A thin stream of water runs down the wall, following a groove carved — or worn — into the stone over centuries.',
  ], mundane: true },
  { name: 'Toppled Statue', descriptions: [
    'A stone statue lies face-down on the floor, broken at the ankles. One outstretched hand still points toward the far doorway.',
    'The pedestal in the center of the room is empty. The statue that once stood there lies in three pieces nearby, its features worn smooth.',
  ], mundane: true },
  { name: 'Scorched Walls', descriptions: [
    'The walls here are blackened with old soot. The scorch pattern radiates outward from a point near the floor — something burned hot and fast here.',
  ], mundane: true },
  // Loot
  { name: 'Old Chest', descriptions: [
    'Shoved into a corner beneath a collapsed shelf, a wooden chest with corroded brass fittings. The wood is soft with rot, but the lock still holds.',
    'Half-buried under fallen rubble near the door, the corner of an iron-banded chest peeks out. Scratch marks on the stone suggest someone tried to drag it.',
    'Against the back wall, a small chest sits on a stone shelf. Its lid is slightly ajar, and something glints inside.',
  ], interactable: true, loot: true },
  { name: 'Potion Vial', descriptions: [
    'Nestled in a wall niche behind a loose stone, a small crystal vial filled with a pale blue liquid that shimmers when you tilt it.',
    'Rolling gently on a tilted flagstone, a stoppered glass vial containing a rosy liquid. The cork is sealed with wax stamped with an alchemist\'s mark.',
    'On a narrow shelf carved into the wall, three vials sit in a row — two are shattered, but one remains intact, glowing faintly green.',
  ], loot: true, item: 'Potion of Cure Light Wounds' },
  { name: 'Coins in Rubble', descriptions: [
    'Among the loose stones and dust, several coins catch the torchlight — old silver pieces, their edges worn smooth.',
  ], loot: true, goldDice: 8 },
  // Interactable
  { name: 'Glowing Runes', descriptions: [
    'Etched into the floor in a three-foot circle, runes pulse with a dim blue-white light. The air above them feels slightly warmer.',
    'Along the doorframe, angular runes are carved deep into the stone. They emit a faint amber glow that intensifies when you step closer.',
  ], interactable: true },
  { name: 'Enchanted Weapon Rack', descriptions: [
    'A wall-mounted weapon rack holds three rusted blades — but the fourth, a slender longsword, gleams as if freshly forged. A faint hum resonates from it.',
    'Bolted to the wall, an iron rack displays several broken weapons. One dagger at the end is untouched by rust, its pommel set with a dull red stone.',
  ], interactable: true, loot: true, minLevel: 3 },
  { name: 'Carved Stone Face', descriptions: [
    'Set into the wall at chest height, a grotesque stone face stares outward with empty eyes. Its mouth gapes open — wide enough to fit a hand inside.',
    'Above the archway, a weathered stone face is carved in bas-relief. Water trickles from one of its eyes like a tear, pooling on the lintel below.',
  ], interactable: true },
  { name: 'Strange Altar', descriptions: [
    'A low stone slab occupies the center of the room, its surface stained dark. Melted candle stubs ring its edges, and the air smells faintly of old incense.',
  ], interactable: true },
  { name: 'Torn Map', descriptions: [
    'Pinned to the wall with a dagger, a brittle piece of parchment shows a partial map. Several rooms are marked with X\'s, and a passage is circled in red ink.',
  ], interactable: true, loot: true },
];

export function generateAreaItems(location, avgLevel = 1) {
  const items = [];
  const terrain = (location?.terrain || '').toLowerCase();
  const locName = (location?.name || '').toLowerCase();
  const isTavern = locName.includes('tavern') || locName.includes('inn') || locName.includes('dragon') || locName.includes('feedbag') || locName.includes('ale');

  if (terrain === 'town' || terrain === 'city' || terrain === 'tavern' || isTavern) {
    // Town/city items — each picked randomly from its description pool
    for (const template of TOWN_ITEMS) {
      const chance = template.loot ? 0.2 : template.interactable ? 0.15 : 0.4;
      if (Math.random() < chance) {
        const desc = pick(template.descriptions);
        items.push({
          name: template.name,
          description: desc,
          mundane: template.mundane || false,
          interactable: template.interactable || false,
          loot: template.loot || false,
          gold: template.goldDice ? roll(template.goldDice) : undefined,
        });
      }
    }
    // Tavern-specific items
    if (isTavern) {
      for (const template of TAVERN_ITEMS) {
        const chance = template.loot ? 0.3 : 0.7;
        if (Math.random() < chance) {
          items.push({
            name: template.name,
            description: pick(template.descriptions),
            mundane: template.mundane || false,
            interactable: template.interactable || false,
            loot: template.loot || false,
          });
        }
      }
    }
  } else {
    // Dungeon/underground items
    for (const template of DUNGEON_ITEMS) {
      if (template.minLevel && avgLevel < template.minLevel) continue;
      const chance = template.loot ? 0.2 : template.interactable ? 0.2 : 0.35;
      if (Math.random() < chance) {
        items.push({
          name: template.name,
          description: pick(template.descriptions),
          mundane: template.mundane || false,
          interactable: template.interactable || false,
          loot: template.loot || false,
          gold: template.goldDice ? roll(template.goldDice) : undefined,
          item: template.item || undefined,
        });
      }
    }
  }

  return items.slice(0, 8); // Cap at 8 items
}
