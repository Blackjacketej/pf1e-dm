/**
 * AI Dungeon Master Engine
 *
 * Provides narrative storytelling for the campaign using:
 * 1. Claude API (when API key is configured)
 * 2. Procedural narration fallback (offline/no key)
 */

import rotrlContext from '../data/rotrl-context.json';
import conditionsData from '../data/conditions.json';
import sandpointData from '../data/sandpoint.json';
import gameRulesData from '../data/gameRules.json';
import rotrlEncountersData from '../data/rotrl-encounters.json';
import {
  MYTHIC_SYSTEM_PROMPT,
  rollFateQuestion,
  rollRandomEventFocus,
  rollMeaningPair,
  testScene,
  rollSceneAdjustment,
  generateRandomEvent,
  rollD10,
  MEANING_TABLES
} from '../data/mythicGME.js';
import { DiceRoll } from '@dice-roller/rpg-dice-roller';

// Export data for other components to use
export { conditionsData, sandpointData, gameRulesData, rotrlEncountersData };

// Build campaign knowledge from extracted PDF data
function buildCampaignKnowledge() {
  const parts = [];
  if (rotrlContext.sandpoint) {
    const sp = rotrlContext.sandpoint;
    parts.push(`SANDPOINT: ${sp.description}`);
    if (sp.keyLocations) {
      parts.push('Key locations: ' + sp.keyLocations.map(l => `${l.name} (${l.type}) - ${l.description?.substring(0, 80)}`).join('; '));
    }
    if (sp.keyNpcs) {
      parts.push('Key NPCs: ' + sp.keyNpcs.map(n => `${n.name} (${n.role}) - ${n.personality?.substring(0, 60) || ''}`).join('; '));
    }
  }
  if (rotrlContext.lore) {
    const lore = rotrlContext.lore;
    if (typeof lore === 'object') {
      Object.entries(lore).forEach(([key, val]) => {
        if (typeof val === 'string') parts.push(`${key.toUpperCase()}: ${val.substring(0, 200)}`);
      });
    }
  }
  return parts.join('\n');
}

const CAMPAIGN_KNOWLEDGE = buildCampaignKnowledge();

const SYSTEM_PROMPT = `You are an expert Pathfinder 1st Edition Game Master running the "Rise of the Runelords" adventure path. You are dramatic, immersive, and knowledgeable about the rules.

ROLE & TONE:
- Narrate in second person ("You see...", "The party enters...")
- Be vivid and atmospheric — describe sights, sounds, smells, the feel of the environment
- Give NPCs distinct voices and personalities
- Build tension before combat, celebrate victories, make defeats feel meaningful
- Keep responses concise but evocative (2-4 paragraphs typically)
- Use Pathfinder 1e rules accurately (AC, attack rolls, saves, skill checks, etc.)
- Reference specific Golarion lore, deities, and locations when relevant

COMBAT NARRATION:
- Describe attacks cinematically, not just mechanically
- Reference the specific weapon/spell being used
- Describe near-misses differently from clean misses
- Make critical hits and fumbles dramatic
- Describe enemy reactions and tactics
- Track the flow of battle — who's winning, who's desperate

STORYTELLING:
- Follow the campaign's story beats but adapt to player choices
- Foreshadow future events subtly
- Give NPCs motivations and emotional reactions
- Make the world feel alive with ambient details
- Connect encounters to the larger narrative

PATHFINDER 1E RULES REFERENCE:
- Attack: d20 + BAB + STR/DEX mod + other bonuses vs AC
- AC = 10 + armor + shield + DEX mod + size + natural + deflection + dodge
- Saving Throws: d20 + base save + ability mod vs DC
- Skill Checks: d20 + ranks + ability mod + misc vs DC
- Critical Hits: confirm with second attack roll, multiply damage
- Ability Scores: STR (melee/damage), DEX (ranged/AC/Ref), CON (HP/Fort), INT (skills/spells), WIS (Will/Perception), CHA (social/channel)
- HP at level 1: max hit die + CON mod
- Dying: below 0 HP, dead at negative CON score
- Conditions: blinded, confused, dazed, deafened, entangled, exhausted, fatigued, frightened, nauseated, paralyzed, shaken, sickened, staggered, stunned
- Spell slots: Prepared casters (Wizard, Cleric, Druid) prepare spells; Spontaneous (Sorcerer, Bard) cast from known spells
- Size modifiers: Fine +8, Diminutive +4, Tiny +2, Small +1, Medium +0, Large -1, Huge -2, Gargantuan -4, Colossal -8
- Concentration check: d20 + caster level + casting ability mod vs DC
- Combat Maneuvers (CMB/CMD): CMB = BAB + STR + size, CMD = 10 + BAB + STR + DEX + size

PLAYER AGENCY & ROLLS:
- When an action requires a dice check (skill, attack, save, ability), you MUST classify it as MANDATORY or OPTIONAL:
  - MANDATORY rolls: combat attacks, saving throws, traps, and any check where failure has consequences. The player CANNOT proceed to other actions until they resolve this roll. Present the roll and WAIT — do NOT offer other action choices until the roll is resolved.
  - OPTIONAL rolls: passive observations, bonus information gathering, or checks where the player can choose to skip. Clearly mark these as optional: "You may attempt a Perception check (DC 15) if you wish, or continue on."
- When prompting for a mandatory roll, tell the player WHAT to roll and the DC/target. Example: "This requires a Perception check (DC 15). Roll d20 + your Perception modifier and tell me the result."
- NEVER decide outcomes that depend on dice — describe the situation up to the point where a roll is needed, then prompt the player.
- The player may roll in-game or at their physical table and report the number.
- Only narrate the outcome AFTER the player tells you the roll result.
- ROLL FOR ME option: If the player says "roll for me", "you roll it", "auto-roll", or similar, YOU should roll the dice on their behalf using their character's modifiers and narrate the full result immediately. This is the player giving you permission to resolve the check.
- For NPC/monster actions and environmental effects, you may roll those yourself since the player doesn't control them.
- In the ACTIONS suggestions, when a mandatory roll is pending, include "Roll for me (let the DM roll)" as one of the action choices so the player can delegate the roll.

CHARACTER ACTION VALIDATION:
- You are given each character's Equipment list in the game state. ALWAYS check a character's equipment before allowing equipment-dependent actions.
- If a player says their character draws, uses, or attacks with a weapon or item they DO NOT have in their equipment list, DO NOT allow it. Instead, narrate the character reaching for the item and realizing they don't have it. Example: "Ironforge reaches for a greatsword at his back — but his hand grasps empty air. He doesn't have a two-handed sword."
- Similarly validate armor, shields, potions, scrolls, tools, and any other gear. Characters can only use what they actually possess.
- If a character's equipment list shows "(none listed)", be cautious — they may have items not yet tracked. In that case, allow reasonable starting equipment for their class but note the uncertainty.
- Spells: only allow a caster to cast spells they know (listed in their Spells). If they try to cast an unknown spell, tell them their character doesn't know that spell.
- Feats: only allow feat-dependent actions (e.g., Power Attack, Cleave, Shield Bash) if the character actually has that feat.

${MYTHIC_SYSTEM_PROMPT}

RESPONSE FORMAT:
Respond with narrative text as flowing prose (2-4 short paragraphs). No markdown headers or code blocks. Dialogue in quotes. If a roll is needed from the player, end with a clear prompt like "Roll [type] (DC [number])" or "Make a [skill] check."

After your narrative, include the following metadata lines (each on its own line):

ENTITIES: List any NEW NPCs or notable items introduced or discovered in this response. Use this format:
  NPC entries: NPC:name|race|occupation|disposition|short appearance description
  Item entries: ITEM:name|short description|location context
Only include entities that are NEW to this scene — do not re-list NPCs or items already established in the game context. If no new entities appear, omit the ENTITIES line entirely.
Examples:
  ENTITIES: NPC:Jodar|dwarf|blacksmith|gruff|stocky with singed eyebrows and soot-stained apron;ITEM:ornate silver dagger|ceremonial blade with Desna's symbol|found on the altar
  ENTITIES: NPC:a cloaked woman|human|unknown|suspicious|tall and gaunt, face hidden beneath a deep hood
  ENTITIES: ITEM:crumpled note|water-stained parchment with a partial map|tucked behind the loose stone

ACTIONS: followed by 3-5 short suggested player actions separated by |. These should be specific to the current scene — things the characters would naturally consider doing right now based on what just happened. Include a mix of:
- Physical actions ("Search the merchant's cart for hidden compartments")
- Social actions ("Ask the innkeeper about the missing travelers")
- Skill-based actions ("Examine the strange symbol on the wall (Knowledge Arcana)")
- Tactical actions ("Take cover behind the overturned wagon")
Make each action specific and grounded in the scene — never generic like "Investigate" or "Look around".
Example: ACTIONS: Ask the nervous woman what she saw at the graveyard|Search the alley where the hooded figure disappeared|Check the note for hidden writing (Linguistics)|Head to the general store to stock up on supplies|Keep a low profile and observe the town square`;

// Valid model names
const VALID_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'];

// Store settings in localStorage
function getSettings() {
  try {
    const saved = localStorage.getItem('pf-dm-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate old model names to valid ones
      if (parsed.model && !VALID_MODELS.includes(parsed.model)) {
        console.warn('[DM Engine] Migrating invalid model name:', parsed.model, '→ claude-sonnet-4-6');
        parsed.model = 'claude-sonnet-4-6';
        localStorage.setItem('pf-dm-settings', JSON.stringify(parsed));
      }
      return parsed;
    }
    return { apiKey: '', provider: 'claude', model: 'claude-sonnet-4-6' };
  } catch {
    return { apiKey: '', provider: 'claude', model: 'claude-sonnet-4-6' };
  }
}

function saveSettings(settings) {
  localStorage.setItem('pf-dm-settings', JSON.stringify(settings));
}

// Build context about the current game state
function buildGameContext(state) {
  const parts = [];

  if (state.campaign) {
    const ch = state.campaign.data?.chapters?.find(c => c.id === state.campaign.currentChapter);
    const pt = ch?.parts?.find(p => p.id === state.campaign.currentPart);
    parts.push(`CURRENT CAMPAIGN STATE:`);
    parts.push(`Campaign: ${state.campaign.data?.name}`);
    if (ch) parts.push(`Chapter ${ch.number}: ${ch.name} (Levels ${ch.levelRange})`);
    if (pt) {
      parts.push(`Current Section: ${pt.name}`);
      parts.push(`Location: ${pt.location}`);
      parts.push(`Description: ${pt.description}`);
    }
    if (ch?.synopsis) {
      parts.push(`Chapter Synopsis: ${ch.synopsis}`);
    }
    if (ch?.npcs) {
      parts.push(`\nKEY NPCs THIS CHAPTER:`);
      ch.npcs.forEach(n => parts.push(`- ${n.name} (${n.role}): ${n.description}`));
    }
    if (pt?.events && pt.events.length > 0) {
      parts.push(`\nSCENE EVENTS:`);
      pt.events.forEach(ev => parts.push(`- ${ev.name} (${ev.type}): ${ev.description}`));
    }
    const completed = state.campaign.completedEncounters || [];
    if (completed.length > 0) {
      parts.push(`\nCompleted encounters: ${completed.length}`);
    }
  }

  // Direct chapter/part context (for chapter_intro and part_intro narration types)
  if (state.chapter && !state.campaign) {
    parts.push(`CHAPTER: ${state.chapter.number} - ${state.chapter.name}`);
    if (state.chapter.synopsis) parts.push(`Synopsis: ${state.chapter.synopsis}`);
  }
  if (state.part && !state.campaign) {
    parts.push(`SECTION: ${state.part.name} at ${state.part.location}`);
    if (state.part.description) parts.push(`Description: ${state.part.description}`);
  }

  if (state.party && state.party.length > 0) {
    parts.push(`\nPARTY (${state.party.length} members):`);
    state.party.forEach(c => {
      const hpPct = c.maxHP > 0 ? Math.round((c.currentHP / c.maxHP) * 100) : 0;
      let charLine = `- ${c.name} (Level ${c.level || 1} ${c.race} ${c.className || c.class}): HP ${c.currentHP}/${c.maxHP} (${hpPct}%), AC ${c.ac || '?'}, STR ${c.abilities?.STR || '?'}, DEX ${c.abilities?.DEX || '?'}, CON ${c.abilities?.CON || '?'}`;

      // Include inventory/equipment so the AI can validate player actions
      const equipment = c.equipment || c.inventory || [];
      if (equipment.length > 0) {
        const itemNames = equipment.map(item => {
          const name = item.name || item;
          const qty = item.quantity && item.quantity > 1 ? ` x${item.quantity}` : '';
          const equipped = item.equipped ? ' [equipped]' : '';
          return `${name}${qty}${equipped}`;
        });
        charLine += ` | Equipment: ${itemNames.join(', ')}`;
      } else {
        charLine += ` | Equipment: (none listed)`;
      }

      // Include known spells for casters
      if (c.knownSpells && c.knownSpells.length > 0) {
        const spellNames = c.knownSpells.slice(0, 15).map(s => s.name || s);
        charLine += ` | Spells: ${spellNames.join(', ')}${c.knownSpells.length > 15 ? ` (+${c.knownSpells.length - 15} more)` : ''}`;
      }

      // Include feats
      if (c.feats && c.feats.length > 0) {
        const featNames = c.feats.slice(0, 10).map(f => f.name || f);
        charLine += ` | Feats: ${featNames.join(', ')}${c.feats.length > 10 ? ` (+${c.feats.length - 10} more)` : ''}`;
      }

      parts.push(charLine);
    });
  }

  if (state.encounter) {
    parts.push(`\nCURRENT ENCOUNTER:`);
    parts.push(`Name: ${state.encounter.name}`);
    parts.push(`Type: ${state.encounter.type}, CR: ${state.encounter.cr}`);
    parts.push(`Description: ${state.encounter.description}`);
    if (state.encounter.readAloud) parts.push(`Read-Aloud Text: ${state.encounter.readAloud}`);
    if (state.encounter.tactics) parts.push(`Enemy Tactics: ${state.encounter.tactics}`);
    if (state.encounter.storyNote) parts.push(`Story Note: ${state.encounter.storyNote}`);
    if (state.encounter.enemies) {
      parts.push(`Enemies:`);
      state.encounter.enemies.forEach(e => {
        parts.push(`- ${e.count}x ${e.name} (CR ${e.cr}, HP ${e.hp}, AC ${e.ac}, Attack: ${e.attack?.name} +${e.attack?.bonus} ${e.attack?.damage}${e.special ? ', Special: ' + e.special : ''})`);
      });
    }
    if (state.encounter.npcs) parts.push(`NPCs present: ${state.encounter.npcs.join(', ')}`);
  }

  if (state.combat) {
    parts.push(`\nCOMBAT STATE:`);
    parts.push(`Round: ${state.combat.round || 1}`);
    if (state.combat.enemies) {
      parts.push(`Enemies in combat:`);
      state.combat.enemies.forEach(e => {
        parts.push(`- ${e.name}: HP ${e.currentHP}/${e.hp}, AC ${e.ac}${e.currentHP <= 0 ? ' [DEFEATED]' : ''}`);
      });
    }
  }

  if (state.recentLog && state.recentLog.length > 0) {
    parts.push(`\nRECENT EVENTS (last ${state.recentLog.length} entries):`);
    state.recentLog.forEach(l => parts.push(`[${l.type}] ${l.text}`));
  }

  // Include Mythic GME state for AI context
  if (state.mythic) {
    parts.push(`\nMYTHIC GME STATE:`);
    parts.push(`Chaos Factor: ${state.mythic.chaosFactor}/9`);
    if (state.mythic.threads && state.mythic.threads.length > 0) {
      parts.push(`Active Threads: ${state.mythic.threads.join(', ')}`);
    }
    if (state.mythic.characters && state.mythic.characters.length > 0) {
      parts.push(`Tracked NPCs: ${state.mythic.characters.join(', ')}`);
    }
    if (state.mythic.sceneTest) {
      parts.push(`Scene Test Result: ${state.mythic.sceneTest.type}`);
      if (state.mythic.sceneTest.adjustment) {
        parts.push(`Scene Adjustment: ${state.mythic.sceneTest.adjustment}`);
      }
      if (state.mythic.sceneTest.event) {
        const ev = state.mythic.sceneTest.event;
        parts.push(`Random Event: ${ev.focus} — "${ev.word1} ${ev.word2}"`);
      }
    }
    if (state.mythic.fateResult) {
      parts.push(`Fate Question Result: ${state.mythic.fateResult.result} (roll: ${state.mythic.fateResult.roll})`);
      if (state.mythic.fateResult.event) {
        const ev = state.mythic.fateResult.event;
        parts.push(`Triggered Random Event: ${ev.focus} — "${ev.word1} ${ev.word2}"`);
      }
    }
  }

  return parts.join('\n');
}

// Call Claude API with timeout
async function callClaude(messages, settings) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model || 'claude-sonnet-4-6',
        max_tokens: 800,
        system: SYSTEM_PROMPT + (CAMPAIGN_KNOWLEDGE ? '\n\nCAMPAIGN KNOWLEDGE:\n' + CAMPAIGN_KNOWLEDGE : ''),
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('API request timed out after 30 seconds. Try again or switch to a faster model.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ===== PROCEDURAL FALLBACK ENGINE =====

const ATMOSPHERE = {
  tension: [
    'A cold wind stirs, carrying with it the faint scent of danger.',
    'The shadows seem to deepen around you, as if the darkness itself holds its breath.',
    'An uneasy silence falls over the area. Something feels wrong.',
    'The hairs on the back of your neck stand on end. You are not alone.',
    'A distant sound echoes through the gloom—something between a whisper and a growl.',
  ],
  victory: [
    'The last enemy falls, and a heavy silence replaces the chaos of battle.',
    'With the threat vanquished, you take a moment to catch your breath. The air still tastes of iron and sweat.',
    'Victory is yours, though it came at a cost. The wounds of battle serve as reminders of your mortality.',
    'The dust settles, and the cries of combat fade. You stand triumphant among the fallen.',
  ],
  exploration: [
    'You press forward, your footsteps echoing in the uncertain darkness ahead.',
    'The passage opens before you, revealing secrets long hidden from mortal eyes.',
    'Every corner turned brings new wonders and new dangers. Such is the adventurer\'s lot.',
    'The air grows thick with age and forgotten history as you venture deeper.',
  ],
  rest: [
    'You find a defensible position and settle in to rest. Wounds are tended, weapons cleaned, and spells prepared anew.',
    'The party rests, sharing a quiet meal and tending to their injuries. For a brief moment, the weight of your quest feels lighter.',
    'Sleep comes uneasily, but it comes. When you wake, you feel renewed, ready to face whatever lies ahead.',
  ],
};

const COMBAT_HIT_DESCRIPTIONS = [
  (atk, def, wpn) => `${atk} lunges forward with ${wpn}, catching ${def} with a solid strike!`,
  (atk, def, wpn) => `${atk}'s ${wpn} finds its mark, biting deep into ${def}!`,
  (atk, def, wpn) => `With a fierce swing, ${atk} slams ${wpn} into ${def}, drawing blood!`,
  (atk, def, wpn) => `${atk} presses the attack, driving ${wpn} through ${def}'s defenses!`,
  (atk, def, wpn) => `A brutal strike from ${atk}'s ${wpn} connects solidly with ${def}!`,
];

const COMBAT_MISS_DESCRIPTIONS = [
  (atk, def, wpn) => `${atk} swings ${wpn} wide, and ${def} narrowly dodges the blow!`,
  (atk, def, wpn) => `${def} deflects ${atk}'s strike at the last moment!`,
  (atk, def, wpn) => `${atk}'s ${wpn} whistles through empty air as ${def} sidesteps!`,
  (atk, def, wpn) => `The attack goes wide! ${def} reads ${atk}'s movements and evades!`,
  (atk, def, wpn) => `${atk} overextends with ${wpn}, missing ${def} entirely!`,
];

const KILL_DESCRIPTIONS = [
  (atk, def) => `With a final, devastating blow, ${atk} fells ${def}! The creature crumples to the ground.`,
  (atk, def) => `${def} staggers, then collapses. ${atk} stands over the fallen foe, breathing hard.`,
  (atk, def) => `The killing strike lands true. ${def} lets out a final, rattling gasp and moves no more.`,
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function proceduralNarrate(type, context) {
  switch (type) {
    case 'encounter_intro': {
      const enc = context.encounter;
      const lines = [];
      if (enc?.readAloud) {
        lines.push(enc.readAloud);
      } else {
        lines.push(pickRandom(ATMOSPHERE.tension));
        lines.push(enc?.description || 'You face a new challenge.');
      }
      if (enc?.enemies) {
        const names = enc.enemies.map(e => e.count > 1 ? `${e.count} ${e.name}s` : `a ${e.name}`);
        lines.push(`Before you stand ${names.join(' and ')}. Roll for initiative!`);
      }
      return lines.join('\n\n');
    }

    case 'combat_hit':
      return pickRandom(COMBAT_HIT_DESCRIPTIONS)(
        context.attacker, context.defender, context.weapon || 'their weapon'
      ) + ` (${context.damage} damage!)`;

    case 'combat_miss':
      return pickRandom(COMBAT_MISS_DESCRIPTIONS)(
        context.attacker, context.defender, context.weapon || 'their weapon'
      );

    case 'combat_kill':
      return pickRandom(KILL_DESCRIPTIONS)(context.attacker, context.defender);

    case 'victory':
      return pickRandom(ATMOSPHERE.victory);

    case 'exploration':
      return pickRandom(ATMOSPHERE.exploration);

    case 'rest':
      return pickRandom(ATMOSPHERE.rest);

    case 'story': {
      const enc = context.encounter;
      const lines = [];
      if (enc?.readAloud) lines.push(enc.readAloud);
      else if (enc?.description) lines.push(enc.description);
      if (enc?.storyNote) lines.push(enc.storyNote);
      return lines.join('\n\n') || 'The story continues...';
    }

    case 'chapter_intro': {
      const ch = context.chapter;
      return `${ch?.synopsis || 'A new chapter begins.'}\n\nYour party must steel themselves for what lies ahead. The challenges will be greater, but so too will be the rewards.`;
    }

    case 'part_intro': {
      const pt = context.part;
      return `${pt?.description || 'You venture forth.'}\n\n${pickRandom(ATMOSPHERE.exploration)}`;
    }

    case 'npc_interaction': {
      const npc = context.npc;
      return `You encounter ${npc?.name || 'a mysterious figure'}. ${npc?.description || 'They regard you with interest.'}`;
    }

    default:
      return pickRandom(ATMOSPHERE.exploration);
  }
}

// ===== MAIN DM ENGINE =====

export class DMEngine {
  constructor() {
    this.settings = getSettings();
    this.conversationHistory = [];
    this.maxHistory = 20; // Keep last 20 exchanges for context

    // Mythic GME State
    this.chaosFactor = 5;
    this.threads = [];    // Active storyline threads
    this.characters = []; // Important NPCs tracked
    this.sceneCount = 0;
    this.lastSceneResult = null;

    // Try to restore Mythic state from localStorage
    try {
      const mythicState = JSON.parse(localStorage.getItem('pf-mythic-state') || 'null');
      if (mythicState) {
        this.chaosFactor = mythicState.chaosFactor ?? 5;
        this.threads = mythicState.threads ?? [];
        this.characters = mythicState.characters ?? [];
        this.sceneCount = mythicState.sceneCount ?? 0;
      }
    } catch { /* fresh state */ }
  }

  // === DICE ROLLER ===
  // Roll dice using standard notation: "1d20+5", "4d6kh3", "2d8+2d6+5", etc.
  rollDice(notation) {
    try {
      const roll = new DiceRoll(notation);
      return {
        notation,
        total: roll.total,
        output: roll.output,         // e.g. "1d20+5: [14]+5 = 19"
        rolls: roll.rolls,           // detailed roll breakdown
        minTotal: roll.minTotal,
        maxTotal: roll.maxTotal,
      };
    } catch (e) {
      console.warn(`[DM Engine] Dice roll error for "${notation}":`, e.message);
      // Fallback: simple d20 + modifier parse
      const m = notation.match(/1d20\s*([+-]\s*\d+)?/);
      if (m) {
        const mod = m[1] ? parseInt(m[1].replace(/\s/g, ''), 10) : 0;
        const die = Math.floor(Math.random() * 20) + 1;
        return { notation, total: die + mod, output: `1d20${mod >= 0 ? '+' : ''}${mod}: [${die}]${mod >= 0 ? '+' : ''}${mod} = ${die + mod}`, rolls: [die] };
      }
      return { notation, total: 0, output: `Error: ${e.message}`, rolls: [] };
    }
  }

  // Roll a skill check for a character
  rollSkillCheck(charName, skillName, modifier) {
    const result = this.rollDice('1d20');
    const total = result.rolls[0] + modifier;
    const nat = result.rolls[0];
    return {
      character: charName,
      skill: skillName,
      natural: nat,
      modifier,
      total,
      output: `${charName} rolls ${skillName}: [${nat}] + ${modifier} = ${total}`,
      critical: nat === 20,
      fumble: nat === 1,
    };
  }

  // Roll an attack for a character
  rollAttack(charName, weaponName, attackBonus, damageDice) {
    const atkRoll = this.rollDice('1d20');
    const nat = atkRoll.total;
    const totalAtk = nat + attackBonus;
    const dmgRoll = this.rollDice(damageDice);
    return {
      character: charName,
      weapon: weaponName,
      natural: nat,
      attackBonus,
      totalAttack: totalAtk,
      critical: nat === 20,
      fumble: nat === 1,
      damage: dmgRoll.total,
      damageOutput: dmgRoll.output,
      output: `${charName} attacks with ${weaponName}: [${nat}] + ${attackBonus} = ${totalAtk}${nat === 20 ? ' (CRITICAL THREAT!)' : nat === 1 ? ' (FUMBLE!)' : ''} | Damage: ${dmgRoll.output}`,
    };
  }

  // Roll a saving throw
  rollSave(charName, saveType, modifier) {
    const result = this.rollDice('1d20');
    const nat = result.total;
    const total = nat + modifier;
    return {
      character: charName,
      save: saveType,
      natural: nat,
      modifier,
      total,
      output: `${charName} ${saveType} save: [${nat}] + ${modifier} = ${total}`,
    };
  }

  // Persist Mythic state
  saveMythicState() {
    localStorage.setItem('pf-mythic-state', JSON.stringify({
      chaosFactor: this.chaosFactor,
      threads: this.threads,
      characters: this.characters,
      sceneCount: this.sceneCount,
    }));
  }

  // Adjust chaos factor at end of scene
  adjustChaos(playerInControl) {
    if (playerInControl && this.chaosFactor > 1) {
      this.chaosFactor--;
    } else if (!playerInControl && this.chaosFactor < 9) {
      this.chaosFactor++;
    }
    this.saveMythicState();
    return this.chaosFactor;
  }

  // Test a new scene against chaos factor
  testNewScene() {
    this.sceneCount++;
    const result = testScene(this.chaosFactor);
    this.lastSceneResult = result;
    let details = { type: result };

    if (result === 'altered') {
      details.adjustment = rollSceneAdjustment();
    } else if (result === 'interrupt') {
      details.event = generateRandomEvent(this.chaosFactor);
    }

    this.saveMythicState();
    return details;
  }

  // Ask a fate question
  askFateQuestion(odds = '5050') {
    const result = rollFateQuestion(odds, this.chaosFactor);
    if (result.randomEvent) {
      result.event = generateRandomEvent(this.chaosFactor);
    }
    return result;
  }

  // Generate a random event
  triggerRandomEvent() {
    return generateRandomEvent(this.chaosFactor);
  }

  // Get meaning pair for inspiration
  getMeaningPair(table1 = 'action1', table2 = 'action2') {
    return rollMeaningPair(table1, table2);
  }

  // Add/remove threads
  addThread(thread) {
    this.threads.push(thread);
    this.saveMythicState();
  }

  removeThread(index) {
    this.threads.splice(index, 1);
    this.saveMythicState();
  }

  // Add/remove tracked characters
  addCharacter(character) {
    this.characters.push(character);
    this.saveMythicState();
  }

  removeCharacter(index) {
    this.characters.splice(index, 1);
    this.saveMythicState();
  }

  // Called by other systems to auto-adjust chaos
  autoAdjustChaos(reason) {
    // reasons: 'combat_victory', 'combat_defeat', 'random_event', 'quest_complete', 'npc_death', 'kingdom_crisis', 'kingdom_prosperity'
    const adjustments = {
      'combat_victory': -1,
      'combat_defeat': 1,
      'random_event': 1,
      'quest_complete': -1,
      'npc_death': 1,
      'kingdom_crisis': 1,
      'kingdom_prosperity': -1,
    };
    const delta = adjustments[reason] || 0;
    this.chaosFactor = Math.max(1, Math.min(9, this.chaosFactor + delta));
    this.saveMythicState();
    return { newChaos: this.chaosFactor, reason, delta };
  }

  // Check if a "does this happen?" question should be answered via Mythic
  mythicCheck(odds = '5050', context = '') {
    const result = this.askFateQuestion(odds);
    return {
      ...result,
      context,
      chaosAtCheck: this.chaosFactor,
    };
  }

  getMythicState() {
    return {
      chaosFactor: this.chaosFactor,
      threads: [...this.threads],
      characters: [...this.characters],
      sceneCount: this.sceneCount,
      lastSceneResult: this.lastSceneResult,
    };
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    saveSettings(this.settings);
  }

  getSettings() {
    return { ...this.settings };
  }

  isAIAvailable() {
    return !!(this.settings.apiKey && this.settings.apiKey.length > 10);
  }

  // Add to conversation history for AI context
  addToHistory(role, content) {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > this.maxHistory * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistory * 2);
    }
  }

  // Main narration method — tries AI, falls back to procedural
  async narrate(type, gameState, userAction = null) {
    // Inject Mythic GME state into game state for context building
    const mythicContext = {
      chaosFactor: this.chaosFactor,
      threads: this.threads,
      characters: this.characters,
    };

    // Auto-test scene for scene-entry narration types
    const sceneEntryTypes = ['chapter_intro', 'part_intro', 'encounter_intro'];
    if (sceneEntryTypes.includes(type)) {
      const sceneTest = this.testNewScene();
      mythicContext.sceneTest = sceneTest;
    }

    const stateWithMythic = { ...gameState, mythic: mythicContext };
    const context = buildGameContext(stateWithMythic);

    if (this.isAIAvailable()) {
      try {
        // Build the user message
        let prompt = '';
        switch (type) {
          case 'encounter_intro':
            prompt = `The party is about to face a new encounter. Narrate the scene as the GM, setting the atmosphere and introducing the threat. Use the encounter details provided.\n\nGame State:\n${context}`;
            break;
          case 'combat_round':
            prompt = `Narrate what just happened in combat this round. Describe the action cinematically.\n\nGame State:\n${context}\n\nAction: ${userAction || 'The battle rages on.'}`;
            break;
          case 'combat_hit':
            prompt = `${userAction}\n\nDescribe this attack hitting in one vivid sentence.`;
            break;
          case 'combat_miss':
            prompt = `${userAction}\n\nDescribe this attack missing in one vivid sentence.`;
            break;
          case 'combat_kill':
            prompt = `${userAction}\n\nDescribe this killing blow in one dramatic sentence.`;
            break;
          case 'victory':
            prompt = `The party has won the battle! Narrate the victory, mention any loot or story developments, and set up what comes next.\n\nGame State:\n${context}`;
            break;
          case 'story':
            prompt = `Narrate this story/roleplay encounter. Give NPCs voices and make the scene come alive.\n\nGame State:\n${context}`;
            break;
          case 'chapter_intro':
            prompt = `The party is beginning a new chapter of the campaign. Set the scene and atmosphere — describe where they are, what they see and hear, the mood of the location. If the chapter begins in a town, describe the town life, NPCs they notice, and the general feel. Do NOT jump to combat or enemies yet. This is the opening narration to establish the setting.\n\nGame State:\n${context}`;
            break;
          case 'part_intro':
            prompt = `The party is moving to a new section of the adventure. Describe the transition and the new location.\n\nGame State:\n${context}`;
            break;
          case 'rest':
            prompt = `The party rests and recovers. Narrate a brief rest scene.\n\nGame State:\n${context}`;
            break;
          case 'custom': {
            // Detect whether this is a question/inquiry vs a character action
            const trimmed = (userAction || '').trim();
            const isQuestion = /^(what|where|who|why|how|is |are |do |does |can |could |would |should |did |was |were |has |have |tell me|describe|explain|look at|examine|inspect|check|study|read|identify|recall|remember|know)\b/i.test(trimmed) || trimmed.endsWith('?');
            const isRollForMe = /\b(roll for me|you roll|auto[- ]?roll|dm roll|let the dm roll|roll it for me)\b/i.test(trimmed);

            if (isRollForMe) {
              // Pre-roll dice and include results so the AI can narrate with real outcomes
              const preRolls = {
                d20: this.rollDice('1d20'),
                d20_2: this.rollDice('1d20'),  // second d20 for confirm/extra
                d8: this.rollDice('1d8'),
                d6: this.rollDice('1d6'),
                d4: this.rollDice('1d4'),
                d100: this.rollDice('1d100'),
              };
              prompt = `The player says: "${userAction}"\n\nThe player has asked you to roll the dice on their behalf. Here are pre-rolled dice results you MUST use (do NOT generate your own numbers):\n- d20 roll #1: ${preRolls.d20.total}\n- d20 roll #2: ${preRolls.d20_2.total}\n- d8: ${preRolls.d8.total}\n- d6: ${preRolls.d6.total}\n- d4: ${preRolls.d4.total}\n- d100 (percentile): ${preRolls.d100.total}\n\nUse the d20 roll #1 for the primary check/attack. Apply the appropriate character modifier from the game state. Narrate the full result including the die roll, modifier, and total. If the check succeeds or fails, narrate the outcome.\n\nGame State:\n${context}`;
            } else if (isQuestion) {
              prompt = `The player asks the DM: "${userAction}"\n\nAs the GM, answer this question in character. Provide useful information the characters would reasonably know or could discover based on their skills, knowledge, and the current situation. If it requires a skill check (Knowledge, Perception, etc.), narrate the check and its result. Stay in narrative voice — don't break character or use game mechanics jargon directly.\n\nGame State:\n${context}`;
            } else {
              prompt = `The player's character takes an action: "${userAction}"\n\nAs the GM, narrate the outcome of this action. Describe what happens when the character does this — the sights, sounds, NPC reactions, and consequences. If it requires a skill check or ability check, narrate the roll and the result. If it might trigger combat or a significant event, set that up dramatically. Stay in second person ("You reach for the door..." etc.).\n\nGame State:\n${context}`;
            }
            break;
          }
          default:
            prompt = `Continue narrating the adventure.\n\nGame State:\n${context}`;
        }

        this.addToHistory('user', prompt);

        const aiMessages = this.conversationHistory.slice(-10);
        const response = await callClaude(aiMessages, this.settings);

        this.addToHistory('assistant', response);

        // Parse out structured metadata from the AI response
        let narrativeText = response;
        let suggestedActions = [];
        let newEntities = { npcs: [], items: [] };

        // Strip ENTITIES: line (may appear before or after ACTIONS)
        const entityMatch = narrativeText.match(/\nENTITIES:\s*(.+)$/im);
        if (entityMatch) {
          narrativeText = narrativeText.substring(0, entityMatch.index) +
            narrativeText.substring(entityMatch.index + entityMatch[0].length);
          const raw = entityMatch[1].trim();
          // Entries separated by ;
          for (const entry of raw.split(';').map(s => s.trim()).filter(Boolean)) {
            if (entry.startsWith('NPC:')) {
              const parts = entry.slice(4).split('|').map(s => s.trim());
              if (parts.length >= 2) {
                newEntities.npcs.push({
                  name: parts[0] || 'Unknown',
                  race: parts[1] || 'Human',
                  occupation: parts[2] || 'unknown',
                  disposition: parts[3] || 'neutral',
                  shortDesc: parts[4] || '',
                });
              }
            } else if (entry.startsWith('ITEM:')) {
              const parts = entry.slice(5).split('|').map(s => s.trim());
              if (parts.length >= 1) {
                newEntities.items.push({
                  name: parts[0] || 'Unknown item',
                  description: parts[1] || '',
                  locationContext: parts[2] || '',
                });
              }
            }
          }
        }

        // Strip ACTIONS: line
        const actionMatch = narrativeText.match(/\nACTIONS:\s*(.+)$/im);
        if (actionMatch) {
          narrativeText = narrativeText.substring(0, actionMatch.index).trim();
          suggestedActions = actionMatch[1].split('|').map(a => a.trim()).filter(Boolean).map(a => {
            const isSkill = /\(.*(?:check|DC|Perception|Knowledge|Stealth|Diplomacy|Bluff|Intimidate|Sense Motive|Linguistics|Spellcraft|Appraise|Heal|Survival|Disable Device|Acrobatics|Climb|Swim)\)/i.test(a);
            const isSocial = /\b(ask|speak|talk|tell|persuade|convince|negotiate|greet|introduce|inquire|request|offer)\b/i.test(a);
            const isCombat = /\b(attack|fight|draw|weapon|charge|defend|flank|ready|ambush)\b/i.test(a);
            const type = isSkill ? 'skill' : isSocial ? 'social' : isCombat ? 'combat' : 'explore';
            return { label: a, action: a, type };
          });
        } else {
          narrativeText = narrativeText.trim();
        }

        return { text: narrativeText, source: 'ai', suggestedActions, newEntities };
      } catch (err) {
        console.warn('[DM Engine] AI narration failed, using fallback:', err.message);
        // Fall through to procedural, but include the error
        const text = proceduralNarrate(type, gameState);
        return { text, source: 'procedural', aiError: err.message, suggestedActions: [] };
      }
    }

    // Procedural fallback (no API key)
    const text = proceduralNarrate(type, gameState);
    return { text, source: 'procedural', suggestedActions: [] };
  }

  // Quick narration for combat actions (doesn't need full AI call)
  narrateCombatAction(type, context) {
    return proceduralNarrate(type, context);
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

// Singleton instance
export const dmEngine = new DMEngine();
export default dmEngine;
