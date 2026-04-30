/**
 * AI Dungeon Master Engine
 *
 * Provides narrative storytelling for the campaign using:
 * 1. Claude API (when API key is configured)
 * 2. Procedural narration fallback (offline/no key)
 */

import { buildNPCDescription, updateNPCAttitude } from './npcTracker';
import {
  generateRulesSummary,
  computeSpellDC,
  computeCasterLevel,
  getCharacterModifiers,
  computeAllSkillModifiers,
  computeSkillCheck,
  computeAidAnother,
  getCreatureIdentificationCheck,
  countCreatureFactsLearned,
  canTake10,
  canTake20,
  resolveDiplomacyAttitude,
  getDiplomacyFavorDC,
  resolveBluff,
  getBluffFeintOpposed,
  resolveDemoralize,
  resolveIntimidateInfluence,
  getStealthSituationalMod,
  getPerceptionSituationalMod,
  resolveStealthVsPerception,
  resolveFirstAid,
  resolveLongTermCare,
  resolveTreatDisease,
  resolveDisableDevice,
  LOCK_DCS,
  ATTITUDES,
  // Chapter 4 — per-skill mechanics (alphabetical)
  resolveAcrobaticsTumble,
  resolveAcrobaticsBalance,
  resolveLongJump,
  resolveHighJump,
  resolveStandFromProne,
  resolveSoftFall,
  getJumpSpeedMod,
  resolveAppraise,
  resolveClimb,
  CLIMB_SURFACE_DCS,
  getCraftItemDC,
  resolveCraftProgressWeekly,
  getDisguiseModifier,
  resolveDisguise,
  resolveEscapeArtist,
  resolveEscapeFromGrapple,
  ESCAPE_DCS,
  resolveFly,
  FLY_MANEUVERABILITY_MODS,
  FLY_DCS,
  resolveHandleAnimal,
  HANDLE_ANIMAL_DCS,
  resolveForgery,
  resolveDecipherScript,
  resolveProfessionIncome,
  resolveRide,
  RIDE_DCS,
  resolveSleightOfHand,
  resolveSpellcraftIdentifySpell,
  resolveSpellcraftIdentifyItem,
  resolveSpellcraftLearnFromScroll,
  getTrackingDC,
  resolveTracking,
  resolveForage,
  resolveWeatherPrediction,
  resolveNavigation,
  resolveSwim,
  getDrowningSaveDC,
  resolveUseMagicDevice,
  ACROBATICS_SURFACE_DCS,
  // Chapter 4 — general mechanics
  resolveAidAnother,
  takeTen,
  takeTwenty,
  resolveCooperativeCheck,
  // Chapter 4 — skill cleanup pass
  PERCEPTION_DCS,
  resolvePerception,
  resolveFeintInCombat,
  resolveSecretMessage,
  resolveSenseMotive,
  resolveGatherInformation,
  resolveTreatPoison,
  resolveTreatDiseaseLoop,
  KNOWLEDGE_LORE_DCS,
  resolveKnowledgeLore,
  resolveStealthAction,
  resolveGetAlongInWild,
  resolveEndureSevereWeather,
} from '../utils/rulesEngine';
import { withAppraiseMetadata, computeAppraiseMetadata } from '../utils/appraiseMetadata';
import { formatAppraiseForPlayer } from '../utils/appraiseDisplay';
import { getSpellSlots, validateCasting, getArcaneSpellFailure, getCastingAbility } from '../utils/spellEngine';
import { aggregateConditionModifiers, getConditionContextForAI } from '../utils/conditionTracker';
import { getEffectiveMaxHP } from '../utils/familiarEngine';
import { logRulesEvent } from './playLog';
import { traceEngine } from './engineTrace';
import { getOpenCluesForPrompt } from './cluesTracker';
// Bug #55 — gate ENTITIES-line NPC names through the plausibility check so
// bare topic words the AI hallucinates ("research", "what suits") don't
// become phantom NPCs. Validator lives alongside the heuristic extractor.
import { isPlausibleNPCName, nameAppearsInSceneNarration } from './npcExtraction.js';
import rotrlContext from '../data/rotrl-context.json';
import conditionsData from '../data/conditions.json';
import sandpointData from '../data/sandpoint.json';
import gameRulesData from '../data/gameRules.json';
import rotrlEncountersData from '../data/rotrl-encounters.json';
import skillsData from '../data/skills.json';
import classesData from '../data/classes.json';

const classesByName = {};
classesData.forEach(c => { classesByName[c.name] = c; });
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

CHARACTER IMMERSION:
- Use each character's personality, appearance, and backstory to enrich narration
- Describe how characters react to events based on their personality (a paranoid character might notice shadows, a jovial one might crack a joke under pressure)
- Reference character appearance in key moments — scars catching firelight, tattoos glowing, distinctive armor clanking
- Weave backstory threads into encounters when appropriate — a character from Cheliax might react differently to devil iconography
- Factor in character traits (PF1e APG traits) when relevant — e.g., Reactionary grants +2 init, Courageous gives +2 vs fear
- Use ethnicity and origin to add cultural flavor — a Shoanti warrior might invoke ancestor spirits, a Tian character might reference eastern philosophies
- When NPCs are present, use their full personality and appearance data to make them feel distinct and memorable

PATHFINDER 1E RULES REFERENCE:
- Attack: d20 + BAB + STR/DEX mod + other bonuses vs AC
- AC = 10 + armor + shield + DEX mod + size + natural + deflection + dodge
- Saving Throws: d20 + base save + ability mod vs DC
- Skill Checks: d20 + ranks + ability mod + 3 (if class skill with ≥1 rank) + misc vs DC
- Critical Hits: confirm with second attack roll, multiply damage
- Ability Scores: STR (melee/damage), DEX (ranged/AC/Ref), CON (HP/Fort), INT (skills/spells), WIS (Will/Perception), CHA (social/channel)

CHAPTER 4 — SKILLS (CRITICAL):
- Each character's "Skills:" line lists ONLY their actual modifiers — use these EXACT numbers when calling for or resolving a check.
- Skills with no listed modifier default to (ability mod) for trained-untrained skills, or are simply unavailable for trained-only skills.
- TRAINED-ONLY skills (require 1+ rank): Disable Device, Handle Animal, Knowledge (any DC > 10), Linguistics, Perform, Profession, Sleight of Hand, Spellcraft, Use Magic Device. If a character has 0 ranks, they cannot attempt these.
- KNOWLEDGE DC 10 RULE: An untrained Knowledge check can only attempt commonplace info (DC 10 or lower). Anything DC 11+ requires at least 1 rank in that specific Knowledge skill.
- TAKE 10: When NOT in combat, NOT threatened, and NOT distracted, a player may take 10 — replace the d20 roll with 10. Use this to resolve routine non-tense checks automatically (e.g., climbing a normal rope outside combat). Cannot Take 10 in combat or while frightened/stunned/dazed/confused/nauseated.
- TAKE 20: When the player has plenty of time, no threats, AND the skill carries no failure penalty, they may take 20 — replace the d20 with 20 (takes 20× normal time, usually 2 minutes). Common Take 20 uses: searching a room (Perception), picking a lock (Disable Device on a lock — NOT a trap), Escape Artist on bonds. NEVER allow Take 20 on Climb, Swim, Acrobatics jumps, Fly, Ride (failure means falling/being thrown), or on disarming a trap (failure springs it).
- AID ANOTHER: An ally can help with a skill check by rolling the same skill against DC 10. Success grants the primary character +2 on their check. The aider CANNOT take 10 to aid. Up to 2 helpers normally; the GM may allow more in unusual circumstances. Helpers can only aid tasks they could plausibly attempt themselves.
- ARMOR CHECK PENALTY: Armor and shield ACPs both apply (and stack) to STR and DEX based skills (Acrobatics, Climb, Disable Device, Escape Artist, Fly, Ride, Sleight of Hand, Stealth, Swim). The character's listed Skill mods already include this — do not double-apply.
- COMMON DC ANCHORS: Easy task DC 10, Average DC 15, Tough DC 20, Hard DC 25, Heroic DC 30. For opposed checks (Stealth vs Perception, Bluff vs Sense Motive, Disguise vs Perception), have both sides roll and compare totals.
- IDENTIFY CREATURES (Knowledge): When the party encounters a monster, allow a Knowledge check to identify it. DC = 10 + creature's CR. Skill depends on type: Arcana (constructs, dragons, magical beasts), Dungeoneering (aberrations, oozes, monstrous humanoids), Local (humanoids), Nature (animals, fey, plants, vermin), Planes (outsiders), Religion (undead). On success, reveal the creature's name and one notable trait (resistances, attacks, weaknesses). For every 5 by which the check exceeds the DC, reveal one additional fact.
- WHEN TO CALL FOR CHECKS: Don't ask for a roll on trivial actions or actions that have no meaningful failure. Do call for a check whenever the outcome is uncertain AND failure has interesting consequences. Stealth approach → Stealth vs enemy Perception. Lying to an NPC → Bluff vs Sense Motive. Climbing a wall → Climb vs DC. Spotting a hidden door → Perception. Recalling lore → Knowledge.

CHAPTER 4 — SOCIAL & SPECIAL SKILLS:
- DIPLOMACY (attitude shift): NPC attitudes are HOSTILE → UNFRIENDLY → INDIFFERENT → FRIENDLY → HELPFUL. To shift one step UP, the DC depends on the NPC's CURRENT attitude: Hostile→Unfriendly DC 25; Unfriendly→Indifferent DC 15; Indifferent→Friendly DC 15; Friendly→Helpful DC 10. Beat the DC by 5 to shift TWO steps. Failing by 5+ shifts attitude one step WORSE. A full Diplomacy interaction is at least 1 minute (longer for hostile targets). Diplomacy CANNOT be used as mind control — even helpful NPCs won't do anything wildly against their nature.
- DIPLOMACY (favor): Once an NPC's attitude is set, asking for a favor uses DC: helpful = 0 (auto), friendly = 10, indifferent = 20, unfriendly = 25, hostile = impossible. Add +5 for moderate favors, +10 for major favors, +15 for extreme favors.
- BLUFF: Opposed by the listener's Sense Motive. Modify the bluff total by plausibility: believable +5, unlikely +0, far-fetched -5, impossible -10. If the target wants to believe, +5; if they're already suspicious, -5. A bluff cannot make someone do something they would never do.
- BLUFF FEINT (combat): Standard action. Opposed by target's Sense Motive (or BAB + Wis if higher). Animals/non-intelligent creatures get +8 racial; non-humanoids +4. Success → target is denied DEX bonus to AC against your next melee attack before end of your next turn.
- INTIMIDATE (Demoralize): Standard action. DC = 10 + target HD + target Wis mod. Success → target is SHAKEN for 1 round, +1 round per 5 over DC. Cannot demoralize creatures with Int 0 or with no fear (mindless undead, constructs, etc.).
- INTIMIDATE (Coerce): 1 minute interaction. DC = 10 + HD + Wis. Success → target is "friendly" for 1d6×10 minutes BUT becomes UNFRIENDLY (or worse) afterward and may seek revenge. This is coercion, not persuasion — treat the resentment as real.
- STEALTH: Opposed by the observer's Perception. Penalties: moving over half speed -5; running or charging -20; sniping (after attacking from cover) -20. Larger creatures take size penalties (Large -4, Huge -8, Gargantuan -12, Colossal -16); smaller get bonuses (Small +4, Tiny +8, Diminutive +12, Fine +16). Cannot Stealth without cover/concealment unless a specific class feature allows it.
- PERCEPTION: Opposed by the target's Stealth, or vs DC for environment. Penalties: -1 per 10 ft of distance; -5 if distracted; -10 if asleep; weather and noise impose further penalties. Heavy rain/snow: -4 Perception. Use the listed Perception modifier in each character's "Skills:" line — do not invent values.
- HEAL (first aid): DC 15, standard action. Stabilizes a dying ally (no longer losing HP, but still at <0).
- HEAL (long-term care): DC 15, requires bed rest. On success, each patient recovers 2× normal HP per day and 2× ability damage. One healer can tend up to 6 patients.
- HEAL (treat disease): Standard action. DC = the disease's save DC. Success lets the patient substitute the Heal check for their next save vs that disease.
- DISABLE DEVICE (trap): Cannot Take 20 to disarm a trap (failure may spring it). Failing by 5+ on a trap may trigger it. Easy trap DC ~20, hard ~25-30, magical ~25+ trap CR.
- DISABLE DEVICE (lock): Locks: simple DC 20, average DC 25, good DC 30, superior DC 40. CAN Take 20 on a lock unless time-pressured. Trained-only.

CHAPTER 4 — REMAINING SKILL MECHANICS:
- ACROBATICS (balance): Base DC by surface WIDTH — >3 ft no check, 1-3 ft DC 5, 7-11 in DC 10, 2-6 in DC 15, <2 in DC 20. Default move is HALF speed; moving at full speed = -5 to the check (+5 DC). Modifiers (CRB): lightly obstructed/slippery +2 DC, severely obstructed/slippery +5 DC (light and severe DO NOT stack — severe wins), sloped +2 DC, severe weather +5 DC. If you take damage while balancing you must IMMEDIATELY make another Acrobatics check at the SAME DC (it is NOT a -2 modifier). On a surface narrower than 1 ft, failing by 5+ = FALL. While actively balancing on a precarious surface you are DENIED your DEX bonus to AC (suppressed if 5+ ranks in Acrobatics) — does NOT apply on surfaces wide enough that no check is needed.
- ACROBATICS (tumble): Move at half speed through threatened squares without provoking AoOs. Base DC 15 + 2 per additional enemy past the first. Moving at full speed instead of half = +10 to the DC (-10 to the check). Tumbling THROUGH an enemy's actual occupied square (not just a square they threaten) uses base DC 25 instead of 15 — that's a +10 base difference, NOT a flat +5 modifier on top of 15. Failing means you provoke the AoO normally.
- ACROBATICS (jump): Long jump DC = distance in feet (running start) or 2× distance (standing). Long jump distance is CAPPED at the character's base land speed in a single jump. If a long jump fails by 4 or less, the jumper may attempt a DC 20 Reflex save to grab the far edge. High jump DC = 4 × height in feet (running start) or 8 × height in feet (standing). The maximum height you actually clear is the inverse of that DC formula: check ÷ 4 with a running start, check ÷ 8 from a standing jump (since standing doubles the DC). There is no separate hard cap, so high-level characters can jump high. Speed adjustment: +4 per FULL 10 ft of base speed above 30, -4 per FULL 10 ft below (speed 25 = 0; speed 20 = -4).
- ACROBATICS (other): Stand from prone without provoking AoO — DC 35. Soft fall — DC 15 to treat a fall as 10 ft shorter for damage; characters with fewer than 5 ranks can only soft-fall from heights up to their base land speed. NEVER allow Take 20 on jumps, balance, or tumble (failure means falling, taking damage, or provoking AoOs).
- APPRAISE (CRB p.89-90, Int, untrained OK): Common items DC 20. Particularly rare or exotic items +5 or more (DC 25+), GM picks. Success by 5+ ALSO determines whether the item has magic properties — but NOT what they are; identifying specific magic abilities requires SPELLCRAFT. Failure by LESS THAN 5 = estimate the price within 20% of its actual value. Failure by 5 OR MORE = price is wildly inaccurate, GM discretion. There is NO 2d6+3 × 10% failure formula (that is D&D 3e, not PF1e). TREASURE HOARD mode (CRB canonical): determining the most valuable item visible in a hoard is DC 20 generally, up to DC 30 for a particularly large hoard, and takes 1 FULL-ROUND action (regular appraise is 1 standard action). Try Again: additional attempts reveal the same result. Equipment bonuses (all STACK): magnifying glass +2 on small or highly detailed items, merchant's scale +2 on items valued by weight, Diligent feat +2, raven familiar +3. Never let Appraise name the specific magic ability of an item.
- CLIMB (CRB p.90-91): Base DC by surface — slope-too-steep-to-walk/knotted-rope-with-wall 0; rope-with-wall-brace/knotted-rope-alone/rope-trick 5; surface-with-ledges or ship's-rigging 10; adequate-handholds-and-footholds (very rough rock, tree, unknotted rope, dangling-hands pull-up) 15; uneven-with-narrow-handholds (typical dungeon wall) 20; rough surface (natural rock wall, brick wall) 25; overhang or ceiling-with-handholds 30; perfectly smooth flat = CANNOT be climbed. Cumulative modifiers: chimney (brace against two opposite walls) -10, corner (brace against perpendicular walls) -5, slippery +5. Default climb speed is 1/4 land speed; accelerated climb is 1/2 speed at -5 to check. Climbers lose DEX bonus to AC and cannot use a shield. Failing by 4 or less = no progress, hold position; failing by 5+ = FALL from current height. Any failed check while TAKING DAMAGE while climbing = fall regardless of margin. Catch self falling: Climb DC = wall's DC +20 (slope's DC +10). Catch a falling adjacent character: melee touch attack, then Climb DC = wall's DC +10 AND fallen weight must not exceed catcher's heavy load. Creatures with a climb speed get +8 racial on Climb, may always take 10 even rushed, keep DEX to AC, and cannot run while climbing. NEVER allow Take 20 on Climb.
- CRAFT (CRB p.91-93, Table 4-4): Craft is a skill FAMILY — each sub-skill (alchemy, armor, bows, weapons, traps, carpentry, etc.) has its own ranks. Process: (1) find item price in sp (1 gp = 10 sp); (2) look up DC; (3) pay 1/3 of price for raw materials; (4) make weekly Craft check. On SUCCESS: progress = check × DC (in sp) added to cumulative progress. Item complete when progress ≥ item price in sp. On FAILURE by 4 or less: no progress this week. Failure by 5+: no progress AND half raw materials ruined (pay half raw cost again to continue). Table 4-4 DCs: Very simple (wooden spoon) 5; Typical (iron pot) 10; High-quality (bell) 15; Complex/superior (lock) 20. Weapons: simple 12, martial 15, exotic 18; crossbow/bolts 15. Bows: longbow/shortbow/arrows 12; composite 15; composite with STR rating = 15 + (2 × rating). Armor/shield: 10 + AC bonus (leather +2 → 12, chain shirt +4 → 14, full plate +9 → 19). Alchemy: acid 15; alchemist's fire / smokestick / tindertwig 20; antitoxin / sunrod / tanglefoot bag / thunderstone 25. Masterwork component: DC 20 on a separate progress track (weapons +300 gp, armor/shield +150 gp). Special: voluntary +10 DC for faster crafting. Tool modifiers: improvised tools -2 to check, masterwork artisan's tools +2, alchemist's lab +2 on Craft(alchemy) only. Repair: same DC, cost 1/5 item price. Practice-your-trade side income: half check result in gp per week. NEVER allow Take 20 in time-sensitive crafting (but Take 10 and take-your-time approaches are standard).
- DISGUISE: Opposed by viewers' Perception (ties go to disguiser). Modifiers: minor detail change +5; different gender/race/age category each -2; familiar to observer -4; intimate -8.
- ESCAPE ARTIST: DCs — rope 20 + binder's CMB; net 20; snare 23; manacles 30 (masterwork 35); tight space 30. Escape from grapple: opposed Escape Artist vs grappler's CMD.
- FLY: Maneuverability mods — clumsy -8, poor -4, average +0, good +4, perfect +8. Sample DCs — hover 15, turn >45° 15, fly straight up 15, turn 180° 20, severe wind 20. Failure may stall or fall.
- HANDLE ANIMAL: Handle known trick DC 10 (move action; standard if untrained). Push (known trick under duress) DC 25. Teach trick DC 15 (1 week per trick). Train for general purpose DC 15 (2 months). Animal must be trained to obey general commands.
- LINGUISTICS (forgery): Opposed Linguistics. Reader gets +2 if familiar with handwriting, +5 if familiar with the document's contents, -2 if just the type. New language gained at each rank.
- LINGUISTICS (decipher): DC 20 for related script, DC 25 for unfamiliar/magical writing.
- PROFESSION: Weekly downtime income = Take 10 check / 2 in gp.
- RIDE: DCs — guide with knees 5, stay in saddle 5, fight from cover 15, soft fall 15, leap 15, spur mount 15, control untrained mount 20, fast mount/dismount 20.
- SLEIGHT OF HAND: Palm coin-sized object DC 10, draw hidden weapon DC 10, conceal small weapon DC 20. Pickpocket: opposed by victim's Perception.
- SPELLCRAFT: Identify a spell as it's cast — DC 15 + spell level (free action, must see/hear casting). Identify magic item via detect magic — DC 15 + item caster level. Learn spell from scroll/spellbook — DC 15 + spell level.
- SURVIVAL (track): Base DC by surface — very soft 5, soft 10, firm 15, hard 20. Size mod (Small +1, Medium 0, Large -1, Huge -2). Larger groups: -1 per 3 creatures past first. Trail age: +1 per 24 hours. Failure by 5+ loses the trail.
- SURVIVAL (forage): DC 10 plentiful / 15 normal / 20 sparse. Success feeds (check result / 2) Medium creatures.
- SURVIVAL (predict weather): DC 15 for 24 hours; +5 per additional day.
- SURVIVAL (navigate): Plains 10, forest/desert 15, marsh 18, mountain/jungle 20. Failure = lost.
- SWIM: Calm DC 10, rough DC 15, stormy DC 20. Heavy load adds +5. Failure by 5+ = goes UNDER (drowning rules begin). Hold breath = CON rounds; after that, Con save DC 10 + 1 per round to keep holding. Failure begins drowning death sequence.
- USE MAGIC DEVICE: Activate blindly DC 25; emulate ability score DC 15 + score; emulate class feature DC 20; emulate race DC 25; emulate alignment DC 30; decipher written spell DC 25 + spell level. Failure by 10+ = cannot use that item again for 24 hours.

CHAPTER 4 — GENERAL SKILL MECHANICS:
- AID ANOTHER: Standard action. Roll the same skill the ally is using vs DC 10. Success = +2 circumstance bonus to ally's check (or +2 to their AC for defense). Multiple helpers can stack — each helper rolls separately.
- TAKE 10: When NOT threatened or distracted, treat the d20 as a 10. Cannot Take 10 in combat unless using a skill that explicitly allows it.
- TAKE 20: When NOT threatened AND failure has no penalty, assume eventual success. Takes 20× normal time (typically 2 minutes for a 1-round task). Cannot Take 20 on Disable Device traps that punish failure, on Use Magic Device, etc.
- COOPERATIVE CHECKS: Several PCs working together — one is primary, others Aid Another. Each successful helper adds +2 to the primary's roll.

CHAPTER 4 — PERCEPTION DCs (CRB pg 102):
- DC 0: notice obvious creature in clear line of sight
- DC 5: hear an army marching 1 mile away; detect faint odor
- DC 10: hear typical conversation through a door
- DC 15: hear a stealthy creature moving (when not opposed); find a simple secret door
- DC 20: notice a hidden object; find a typical trap (or use the trap's listed DC)
- DC 25: hear a well-trained sentry creep; find a well-hidden door
- DC 30+: notice an invisible creature trying to be silent
- Modifiers: +1 DC per 10 ft of distance; +5 through a closed door; +15 through a stone wall; +5 distracted; +10 asleep

CHAPTER 4 — BLUFF SUB-TASKS:
- FEINT IN COMBAT: Standard action. Bluff vs DC = 10 + target's BAB + Wis mod (or 10 + target's Sense Motive, whichever is higher). On success the target is denied their Dex bonus to AC against your next melee attack before the end of your next turn. Non-humanoid +4 DC, animal/non-int +8 DC, mindless impossible.
- SECRET MESSAGE: DC 15 (simple) or DC 20 (complex). Listener uses Sense Motive — if listener fails by 5+ they get the wrong message; failing by less = miss it entirely.

CHAPTER 4 — SENSE MOTIVE SUB-TASKS:
- HUNCH: DC 20 — get a feeling about a social situation (lying? trustworthy?).
- SENSE ENCHANTMENT: DC 25 normally; DC 15 if the target is acting noticeably oddly (compelled, charmed, possessed).
- DISCERN LIE: opposed by liar's Bluff. Resist a Bluff or read intent.

CHAPTER 4 — DIPLOMACY: GATHER INFORMATION:
- Spend 1d4 hours canvassing a settlement. DC: common knowledge 10, uncommon 15, obscure 20, secret 30. Settlement size mods: metropolis -2, city -1, town +0, village +2, hamlet +5. Dangerous topic +5.

CHAPTER 4 — HEAL: TREAT POISON & DISEASE LOOP:
- TREAT POISON: Standard action each time the victim must save. Heal vs the poison's save DC. Success = victim gains +4 on that save.
- TREAT DISEASE: Heal vs the disease's save DC. Success = victim gains +4 on saves against the disease. Disease is cured by passing TWO consecutive saves (the standard CRB cure rule).

CHAPTER 4 — KNOWLEDGE: LORE DC LADDER (non-creature questions):
- DC 10: common knowledge anyone in the field would know
- DC 15: basic apprentice-level knowledge
- DC 20: uncommon knowledge requiring focused study
- DC 25: obscure knowledge known only to specialists
- DC 30: extremely obscure / forbidden / secret lore
- Beating the DC by 5 grants one extra detail.

CHAPTER 4 — STEALTH ACTION MODIFIERS:
- Moving faster than half speed: -5 to Stealth
- Running or fighting: -20 to Stealth
- SNIPING: After making a ranged attack from concealment, take -20 to immediately re-hide (re-rolled Stealth) — full-round action that includes the attack and the re-hide attempt.
- Without cover or concealment, Stealth is impossible.

CHAPTER 4 — SURVIVAL: WILD & WEATHER:
- GET ALONG IN WILD: DC 10 to feed and shelter yourself + one other; +2 DC per additional party member.
- ENDURE SEVERE WEATHER: DC 15 mild/hot/cold, DC 20 severe, DC 25 extreme. Success = whole party gains +2 Fort vs that day's weather effects.

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

CHARACTER ACTION VALIDATION — STRICT RULES ENFORCEMENT:
The game state includes computed mechanical data for each character. You MUST respect these numbers — they are the ground truth.

EQUIPMENT:
- You are given each character's Equipment list. ALWAYS check before allowing equipment-dependent actions.
- If a character tries to use an item they don't have, narrate them reaching for it and finding nothing. Example: "Ironforge reaches for a greatsword — but his hand grasps empty air."
- Similarly validate armor, shields, potions, scrolls, tools, and any other gear.

SPELL ENFORCEMENT:
- Each caster's Spell Slots show remaining/total per level (e.g., "L1: 2/4" = 2 remaining).
- If a caster has 0 remaining slots at a spell level, they CANNOT cast a spell of that level. Narrate: "You feel the weave of magic slip through your fingers — your reserves of that power are spent."
- Only allow a caster to cast spells they know (listed in their Spells).
- Arcane Spell Failure: if shown (e.g., "Arcane Spell Failure: 30%"), arcane casters wearing armor must roll percentile. If the roll ≤ the failure chance, the spell fizzles. Announce this risk when they attempt to cast.
- Prepared casters (Wizard, Cleric, Druid) can only cast spells they have prepared. Spontaneous casters (Sorcerer, Bard) cast from their known list freely using any available slot.
- Ability score minimum: A caster needs their casting ability score ≥ 10 + spell level. A Wizard with INT 12 cannot cast level 3+ spells.
- SPELL COMPONENTS: Spells with V (verbal) components cannot be cast if the caster is silenced. Spells with S (somatic) components cannot be cast if paralyzed or pinned. Grappled casters can attempt somatic spells but must pass a concentration check.
- SPELL DC: When a spell allows a saving throw, the DC = 10 + spell level + casting ability modifier. If the caster has Spell Focus in the spell's school, add +1 (+2 with Greater Spell Focus). The Spell DC is provided in the character context when available.

CONCENTRATION CHECKS:
- Casting a spell provokes attacks of opportunity unless the caster uses "cast defensively" (DC 15 + 2x spell level).
- If a caster takes damage while casting, they must roll concentration: DC = 10 + damage taken + spell level. Failure = spell lost.
- Grappled casters: concentration DC = 10 + CMB + spell level to cast. Must also use spells with no somatic components or succeed.
- Entangled casters: concentration DC = 15 + spell level.
- Concentration = d20 + caster level + casting ability mod. Combat Casting feat adds +4.

SPELL RESISTANCE:
- Some creatures have Spell Resistance (SR). If a spell says "SR: Yes", the caster must roll d20 + caster level ≥ target's SR for the spell to affect them. If the caster fails, the spell has no effect but the slot is still consumed.
- Spell Penetration feat grants +2 to SR penetration rolls. Greater Spell Penetration grants +2 more.

SAVING THROWS:
- Each character's computed saves (Fort, Ref, Will) are provided. When an effect requires a save, use EXACTLY these numbers: d20 + save bonus vs the DC.
- Spell DCs: Use the caster's provided Spell DC if shown, otherwise compute: 10 + spell level + casting ability modifier.

PROFICIENCY:
- If a character has PROFICIENCY WARNINGS in their rules data, they suffer penalties. A non-proficient weapon user takes -4 to attack. A non-proficient armor wearer applies the armor check penalty to attacks and STR/DEX skill checks.

CONDITIONS:
- Active conditions are listed with their mechanical effects (e.g., "Shaken → Attack -2, Saves -2").
- ALWAYS apply these modifiers. A shaken character really does take -2 to attacks.
- If a character has "CANNOT ACT", "CANNOT ATTACK", or "CANNOT CAST" flags, ENFORCE THEM. Do not let the player ignore conditions.
- If a condition says "MUST FLEE", the character is compelled to run from the fear source.

FEATS:
- Only allow feat-dependent actions if the character actually has that feat.
- Power Attack: -1 attack per +4 BAB, +2 damage (+3 two-handed). Only melee.
- Cleave: After dropping a foe, one free attack on adjacent enemy. Standard action.
- Combat Expertise: -1 attack per +4 BAB, +1 dodge AC. Only melee.
- Spring Attack: Move, attack during move, continue moving. Requires Dodge + Mobility.

ACTION ECONOMY (per round):
- Standard + Move + Swift (or Full-Round + Swift). Characters cannot exceed this budget.
- Casting a spell is usually a standard action. Full attacks take a full-round action.
- Only ONE 5-foot step per round, and only if no other movement that round.

${MYTHIC_SYSTEM_PROMPT}

RESPONSE FORMAT:
Respond with narrative text as flowing prose (2-4 short paragraphs). No markdown headers or code blocks. Dialogue in quotes. If a roll is needed from the player, end with a clear prompt like "Roll [type] (DC [number])" or "Make a [skill] check."

After your narrative, include the following metadata lines (each on its own line):

ENTITIES: List any NEW NPCs or notable items introduced or discovered in this response. Use this format:
  NPC entries: NPC:name|race|occupation|disposition|short appearance description
  Item entries: ITEM:name|short description|location context
Only include entities that are NEW to this scene — do not re-list NPCs or items already established in the game context. If no new entities appear, omit the ENTITIES line entirely.

CRITICAL — only include NPCs who are PHYSICALLY PRESENT in the current scene, right now, and can be interacted with by the party. Do NOT list NPCs who are only mentioned, referenced, or talked about in dialogue or exposition. If an NPC is spoken of by another character ("Father Zantus is a good man", "Mayor Deverin saw it built"), is historical/deceased ("Father Tobyn, who died in the fire"), or is known to exist elsewhere ("the mayor is away in the capital"), DO NOT add them to ENTITIES — they are not new NPCs introduced to this scene, they are references. Only add an NPC to ENTITIES when the party can see, approach, or speak to them directly at this moment.

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
      // Phase 7.6 — LLM sees effective max HP (includes in-range familiar HP
      // bonus) so it doesn't misread a toad-buffed PC as near-death.
      const effMax = getEffectiveMaxHP(c, { worldState: state.worldState });
      const hpPct = effMax > 0 ? Math.round((c.currentHP / effMax) * 100) : 0;
      let charLine = `- ${c.name} (Level ${c.level || 1} ${c.gender ? c.gender + ' ' : ''}${c.race} ${c.className || c.class}): HP ${c.currentHP}/${effMax} (${hpPct}%), AC ${c.ac || '?'}, STR ${c.abilities?.STR || '?'}, DEX ${c.abilities?.DEX || '?'}, CON ${c.abilities?.CON || '?'}`;

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

      // Include character traits (PF1e APG traits) and drawback
      if (c.characterTraits && c.characterTraits.length > 0) {
        charLine += ` | Traits: ${c.characterTraits.join(', ')}`;
      }
      if (c.drawback) {
        charLine += ` | Drawback: ${c.drawback}`;
      }

      // Include alignment
      if (c.alignment) charLine += ` | Alignment: ${c.alignment}`;

      // Mechanical rules summary (saves, CMB/CMD, proficiency warnings, conditions).
      // Phase 7.6 — thread worldState so familiar range-gate reflects in the
      // LLM-facing party summary (out-of-range familiars don't inflate saves/skills).
      try {
        const condMods = getCharacterModifiers(c, state.worldState);
        const rulesSummary = generateRulesSummary(c, condMods, state.worldState);
        charLine += ` | ${rulesSummary.text}`;

        // Spell slot status for casters
        const slots = getSpellSlots(c);
        if (slots) {
          const slotStatus = Object.entries(slots).map(([lvl, max]) => {
            const used = c.spellSlotsUsed?.[lvl] || 0;
            return `L${lvl}: ${max - used}/${max}`;
          }).join(', ');
          charLine += ` | Spell Slots: ${slotStatus}`;

          // Arcane spell failure
          const asf = getArcaneSpellFailure(c);
          if (asf.applies) charLine += ` | Arcane Spell Failure: ${asf.chance}%`;

          // Spell DC and concentration bonus
          const castAbility = getCastingAbility(c.class);
          if (castAbility) {
            const castMod = Math.floor(((c.abilities?.[castAbility] || 10) - 10) / 2);
            const casterLvl = computeCasterLevel(c);
            const combatCastingBonus = (c.feats || []).some(f => (typeof f === 'string' ? f : f.name || '').toLowerCase().includes('combat casting')) ? 4 : 0;
            // Provide spell DCs for common spell levels
            const dcList = Object.keys(slots).filter(l => parseInt(l) > 0).map(l => `L${l}: DC ${10 + parseInt(l) + castMod}`).join(', ');
            charLine += ` | Spell DCs: ${dcList}`;
            charLine += ` | Concentration: +${casterLvl + castMod + combatCastingBonus}${combatCastingBonus ? ' (incl. Combat Casting)' : ''}`;
          }
        }

        // Racial combat bonuses (conditional — inform AI GM)
        const rcb = c.racialCombatBonuses;
        if (rcb) {
          const racialParts = [];
          if (rcb.hatred) racialParts.push(`Hatred: +${rcb.hatred.attackBonus} attack vs ${rcb.hatred.vsTypes.join('/')}`);
          if (rcb.defensiveTraining) racialParts.push(`Defensive Training: +${rcb.defensiveTraining.acBonus} AC vs ${rcb.defensiveTraining.vsTypes.join('/')}`);
          if (rcb.stability) racialParts.push(`Stability: +${rcb.stability.cmdBonus} CMD vs ${rcb.stability.vsManeuvers.join('/')}`);
          if (rcb.slingThrownBonus) racialParts.push(`+${rcb.slingThrownBonus.attackBonus} attack with slings/thrown`);
          if (rcb.elvenMagic) racialParts.push(`Elven Magic: +${rcb.elvenMagic.srPenetrationBonus} CL to overcome SR`);
          if (racialParts.length > 0) charLine += ` | Racial Combat: ${racialParts.join(', ')}`;
        }
        if (c.visionType && c.visionType !== 'normal') charLine += ` | Vision: ${c.visionType}`;

        // Racial skill bonuses
        if (c.racialSkillBonuses && Object.keys(c.racialSkillBonuses).length > 0) {
          const skillParts = Object.entries(c.racialSkillBonuses).map(([s, v]) => `${s} +${v}`);
          charLine += ` | Racial Skills: ${skillParts.join(', ')}`;
        }

        // Per-skill modifiers (CRB Chapter 4) — give the AI complete picture
        // so it can pick correct DCs and call for the right skill checks.
        try {
          const skillMods = computeAllSkillModifiers(c, skillsData, condMods);
          // Show only skills the character has ranks in OR Perception/Sense Motive (passive skills) OR a high mod
          const notable = Object.entries(skillMods)
            .filter(([name, m]) => m.canUse && (m.ranks > 0 || ['Perception','Sense Motive'].includes(name) || (m.total !== null && m.total >= 3)))
            .sort((a, b) => (b[1].total || 0) - (a[1].total || 0));
          if (notable.length > 0) {
            const skillStr = notable.slice(0, 18).map(([name, m]) => {
              const sign = m.total >= 0 ? '+' : '';
              return `${name} ${sign}${m.total}${m.ranks > 0 ? `(${m.ranks}r)` : ''}`;
            }).join(', ');
            charLine += ` | Skills: ${skillStr}${notable.length > 18 ? ` (+${notable.length - 18} more)` : ''}`;
          }
        } catch (e) {
          // Skip if skill computation fails
        }

        // Active conditions with effects
        if (c.activeConditions?.length > 0) {
          charLine += ` | Conditions: ${getConditionContextForAI(c.activeConditions)}`;
        }
      } catch (e) {
        // Graceful fallback if rules engine hits an edge case
      }

      parts.push(charLine);

      // Add personality, appearance, backstory context for richer narration
      if (c.personality) parts.push(`  Personality: ${c.personality}`);
      if (c.appearance) parts.push(`  Appearance: ${c.appearance}`);
      if (c.backstory) parts.push(`  Background: ${c.backstory.substring(0, 200)}${c.backstory.length > 200 ? '...' : ''}`);
      if (c.ethnicity && c.ethnicity !== c.race) parts.push(`  Ethnicity: ${c.ethnicity}${c.origin ? ` from ${c.origin}` : ''}`);
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
    if (state.encounter.npcs) {
      parts.push(`NPCs present:`);
      state.encounter.npcs.forEach(npc => {
        if (typeof npc === 'object' && npc.name) {
          const desc = buildNPCDescription(npc);
          parts.push(`- ${npc.knownToParty ? npc.name : npc.shortDesc || 'a stranger'}: ${desc}${npc.personality ? ` (personality: ${npc.personality})` : ''}`);
        } else {
          parts.push(`- ${npc}`);
        }
      });
    }
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

  // Resolve a skill check using the full rules engine (handles ranks, ACP, feats, racial bonuses).
  // Pass roll = number to roll naturally, 'take10' to take 10, 'take20' to take 20.
  // situation: { inCombat, threatened, distracted, timeLimit, failurePenalty, disarmingTrap }
  resolveSkillCheck(character, skillName, roll, situation = {}, worldState = undefined) {
    const condMods = getCharacterModifiers(character, worldState);
    const classObj = classesByName[character.class];
    const classSkillsList = classObj?.classSkills || [];
    let actualRoll = roll;
    if (roll === 'take10' || roll === 'take20') {
      actualRoll = roll;
    } else if (typeof roll !== 'number') {
      const r = this.rollDice('1d20');
      actualRoll = r.rolls[0];
    }
    const result = computeSkillCheck(character, skillName, actualRoll, skillsData, classSkillsList, condMods, situation);
    const wrapped = {
      character: character.name,
      skill: skillName,
      ...result,
      output: result.canUse
        ? `${character.name} ${skillName}: ${result.breakdown}`
        : `${character.name} cannot use ${skillName}: ${result.reason}`,
    };
    // Fire-and-forget play log emit. logRulesEvent is async, so a synchronous
    // try/catch only catches errors thrown BEFORE the implicit returned
    // promise. We need BOTH:
    //   - try/catch — catches sync throws (e.g. if the call expression itself
    //     somehow blows up)
    //   - .catch() on the returned promise — catches async rejections so they
    //     don't surface as unhandled-promise-rejection warnings in the console
    // Logging must never crash gameplay or pollute the console.
    try {
      const p = logRulesEvent({
        kind: 'skill-check',
        character: character.name,
        skill: skillName,
        input: { roll, situation, actualRoll },
        output: {
          canUse: result.canUse,
          total: result.total,
          dc: result.dc,
          success: result.success,
          breakdown: result.breakdown,
        },
        summary: wrapped.output,
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* swallow — logging must not crash gameplay */ }
    return wrapped;
  }

  // Aid Another on a skill check
  resolveAidAnother(aider, skillName, aiderD20Roll = null, worldState = undefined) {
    const condMods = getCharacterModifiers(aider, worldState);
    const classObj = classesByName[aider.class];
    const classSkillsList = classObj?.classSkills || [];
    if (aiderD20Roll === null) {
      aiderD20Roll = this.rollDice('1d20').rolls[0];
    }
    return computeAidAnother(aider, skillName, aiderD20Roll, skillsData, classSkillsList, condMods);
  }

  // Take 10 helper — returns the static result (no roll, no randomness).
  // Phase 7.6 — optional worldState flows the familiar range gate through
  // resolveSkillCheck → getCharacterModifiers.
  take10SkillCheck(character, skillName, situation = {}, worldState = undefined) {
    return this.resolveSkillCheck(character, skillName, 'take10', situation, worldState);
  }

  // Take 20 helper — returns 20-on-the-die result if allowed.
  take20SkillCheck(character, skillName, situation = {}, worldState = undefined) {
    return this.resolveSkillCheck(character, skillName, 'take20', situation, worldState);
  }

  // Get the raw number of ranks a character has invested in a skill.
  // Used by Acrobatics resolvers (5+ ranks suppresses denied-DEX while balancing,
  // and 5+ ranks lifts the soft-fall height cap).
  getSkillRanks(character, skillName) {
    if (!character) return 0;
    // PRIMARY shape (verified canonical): character.skillRanks is a flat
    // {SkillName: number} map. CharacterCreator.jsx populates it this way.
    if (character.skillRanks && typeof character.skillRanks[skillName] === 'number') {
      return character.skillRanks[skillName];
    }
    // Legacy shapes: character.skills as object {Acrobatics: {ranks}} or array [{name, ranks}]
    if (character.skills) {
      if (Array.isArray(character.skills)) {
        const entry = character.skills.find(s => s.name === skillName);
        return entry?.ranks || 0;
      }
      const entry = character.skills[skillName];
      if (entry && typeof entry === 'object') return entry.ranks || 0;
      if (typeof entry === 'number') return entry;
    }
    // Last-resort fallback: derive via the full skill mod computation.
    // Phase 7.6 — we only read `.ranks` here (a raw count), so the familiar
    // range gate is irrelevant; leaving worldState undefined is intentional.
    try {
      const condMods = getCharacterModifiers(character);
      const mods = computeAllSkillModifiers(character, skillsData, condMods);
      return mods[skillName]?.ranks || 0;
    } catch {
      return 0;
    }
  }

  // Identify a creature via Knowledge check (returns DC + which skill)
  identifyCreatureCheck(creatureType, cr) {
    return getCreatureIdentificationCheck(creatureType, cr);
  }

  // After a knowledge check is rolled, determine how many facts the party learns
  countCreatureFactsLearned(checkTotal, dc) {
    return countCreatureFactsLearned(checkTotal, dc);
  }

  // ── Social skills (CRB Ch. 4) ────────────────────────

  // Diplomacy: shift NPC attitude. Pass the diplomat's full check total + the NPC's current attitude.
  // If a full NPC object is supplied (with .id), the new attitude is persisted to encounteredNpcs.
  async resolveDiplomacyShift(character, npcOrAttitude, situation = {}) {
    const isNpcObject = npcOrAttitude && typeof npcOrAttitude === 'object';
    const currentAttitude = isNpcObject
      ? (npcOrAttitude.attitude || 'indifferent')
      : (npcOrAttitude || 'indifferent');
    const result = this.resolveSkillCheck(character, 'Diplomacy', null, situation);
    if (!result.canUse) return result;
    const shift = resolveDiplomacyAttitude(result.total, currentAttitude);
    if (isNpcObject && npcOrAttitude.id && shift.newAttitude && shift.newAttitude !== currentAttitude) {
      try {
        await updateNPCAttitude(
          npcOrAttitude,
          shift.newAttitude,
          `Diplomacy by ${character.name} (rolled ${result.total})`,
        );
      } catch (e) {
        console.warn('Failed to persist NPC attitude shift', e);
      }
    }
    return {
      ...shift,
      checkTotal: result.total,
      breakdown: `${character.name}: ${result.breakdown}\n→ ${shift.breakdown}`,
    };
  }

  // Diplomacy: cost (DC) to ask a favor of an NPC at a given attitude.
  diplomacyFavorDC(currentAttitude, favorDifficulty = 'simple') {
    return getDiplomacyFavorDC(currentAttitude, favorDifficulty);
  }

  // Bluff vs Sense Motive (opposed). Pass plausibility for honest DC adjustment.
  resolveBluffOpposed(bluffer, target, plausibility = 'unlikely', targetWantsToBelieve = 0) {
    const bluffRes = this.resolveSkillCheck(bluffer, 'Bluff');
    const senseRes = this.resolveSkillCheck(target, 'Sense Motive');
    if (!bluffRes.canUse) return bluffRes;
    if (!senseRes.canUse) return senseRes;
    return resolveBluff(bluffRes.total, senseRes.total, plausibility, targetWantsToBelieve);
  }

  // Bluff: feint in combat (denies DEX bonus to AC for next melee attack).
  resolveCombatFeint(bluffer, target) {
    const opposed = getBluffFeintOpposed(target);
    if (opposed.impossible) {
      return { success: false, canUse: true, dc: Infinity, breakdown: opposed.breakdown };
    }
    const bluffRes = this.resolveSkillCheck(bluffer, 'Bluff');
    if (!bluffRes.canUse) return bluffRes;
    const success = bluffRes.total >= opposed.dc;
    return {
      success,
      bluffTotal: bluffRes.total,
      dc: opposed.dc,
      effect: success ? `${target.name} is denied DEX to AC against the next melee attack ${bluffer.name} makes before end of next turn` : null,
      breakdown: `Feint: ${bluffer.name} Bluff ${bluffRes.total} ${opposed.breakdown} → ${success ? 'SUCCESS' : 'failed'}`,
    };
  }

  // Intimidate: Demoralize (standard action; shaken target).
  demoralize(intimidator, target) {
    const intRes = this.resolveSkillCheck(intimidator, 'Intimidate');
    if (!intRes.canUse) return intRes;
    return resolveDemoralize(intRes.total, target);
  }

  // Intimidate: longer-form coercion (1 minute). Cooperation is unwilling — has consequences.
  intimidateCoerce(intimidator, target) {
    const intRes = this.resolveSkillCheck(intimidator, 'Intimidate');
    if (!intRes.canUse) return intRes;
    return resolveIntimidateInfluence(intRes.total, target);
  }

  // ── Stealth & Perception ─────────────────────────────

  // Sneak: roll Stealth with situational mods. Returns the modified total + breakdown.
  rollStealth(character, situation = {}) {
    const res = this.resolveSkillCheck(character, 'Stealth', null, situation);
    if (!res.canUse) return res;
    const sitMod = getStealthSituationalMod(situation);
    return {
      ...res,
      total: res.total + sitMod,
      situationalMod: sitMod,
      breakdown: `${res.breakdown}${sitMod ? ` ${sitMod >= 0 ? '+' : ''}${sitMod} situational` : ''} = ${res.total + sitMod}`,
    };
  }

  // Perception with situational mods.
  rollPerception(character, situation = {}) {
    const res = this.resolveSkillCheck(character, 'Perception', null, situation);
    if (!res.canUse) return res;
    const sitMod = getPerceptionSituationalMod(situation);
    return {
      ...res,
      total: res.total + sitMod,
      situationalMod: sitMod,
      breakdown: `${res.breakdown}${sitMod ? ` ${sitMod >= 0 ? '+' : ''}${sitMod} situational` : ''} = ${res.total + sitMod}`,
    };
  }

  // Opposed Stealth vs Perception — pass two characters and a situation object.
  // Useful for "the assassin is sneaking past the guards" or "the goblin lurks in shadows".
  resolveSneakVsObserver(stealther, observer, sitStealth = {}, sitPerception = {}) {
    const s = this.rollStealth(stealther, sitStealth);
    const p = this.rollPerception(observer, sitPerception);
    if (!s.canUse) return s;
    if (!p.canUse) return p;
    return {
      ...resolveStealthVsPerception(s.total, p.total),
      stealtherBreakdown: s.breakdown,
      observerBreakdown: p.breakdown,
    };
  }

  // ── Heal ─────────────────────────────────────────────

  treatFirstAid(healer) {
    const res = this.resolveSkillCheck(healer, 'Heal');
    if (!res.canUse) return res;
    return resolveFirstAid(res.total);
  }

  treatLongTermCare(healer) {
    // Long-term care is the result of a daily check, so a real roll
    const res = this.resolveSkillCheck(healer, 'Heal');
    if (!res.canUse) return res;
    return resolveLongTermCare(res.total);
  }

  treatDisease(healer, diseaseSaveDC) {
    const res = this.resolveSkillCheck(healer, 'Heal');
    if (!res.canUse) return res;
    return resolveTreatDisease(res.total, diseaseSaveDC);
  }

  // ── Disable Device ───────────────────────────────────

  disarmTrap(rogue, trapDC) {
    // Trap-disarming is the canonical case where Take 20 is forbidden
    const res = this.resolveSkillCheck(rogue, 'Disable Device', null, { disarmingTrap: true });
    if (!res.canUse) return res;
    return resolveDisableDevice(res.total, trapDC);
  }

  pickLock(rogue, lockQuality = 'average', allowTake20 = false) {
    const dc = LOCK_DCS[lockQuality.toLowerCase()] || LOCK_DCS.average;
    const mode = allowTake20 ? 'take20' : 'roll';
    const res = mode === 'take20'
      ? this.take20SkillCheck(rogue, 'Disable Device', { timeLimit: false })
      : this.resolveSkillCheck(rogue, 'Disable Device');
    if (!res.canUse) return res;
    return {
      ...resolveDisableDevice(res.total, dc),
      lockQuality,
      mode,
      breakdown: `Pick ${lockQuality} lock (DC ${dc}): ${res.breakdown}`,
    };
  }

  // ── Chapter 4 — per-skill helpers (alphabetical) ────────────────

  // Acrobatics
  tumbleThroughEnemies(character, enemyCount = 1, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Acrobatics', null, { inCombat: true, threatened: true });
    if (!res.canUse) return res;
    return {
      ...resolveAcrobaticsTumble(res.total, {
        enemyCount,
        fullSpeed: !!opts.fullSpeed,
        throughEnemySquare: !!opts.throughEnemySquare,
      }),
      checkBreakdown: res.breakdown,
    };
  }
  balance(character, surfaceOrOpts = {}, maybeOpts) {
    // Normalize the two call signatures up front so we can safely read combat
    // flags. typeof null === 'object', so we have to guard nulls explicitly.
    const isObjectOpts = surfaceOrOpts !== null && typeof surfaceOrOpts === 'object';
    const isStringSurface = typeof surfaceOrOpts === 'string';
    const objectOpts = isObjectOpts ? surfaceOrOpts : {};
    const stringOpts = maybeOpts && typeof maybeOpts === 'object' ? maybeOpts : {};
    const combatFlags = isObjectOpts ? objectOpts : stringOpts;
    const res = this.resolveSkillCheck(character, 'Acrobatics', null, {
      inCombat: !!combatFlags.inCombat,
      threatened: !!combatFlags.threatened,
    });
    if (!res.canUse) return res;
    const acrobaticsRanks = this.getSkillRanks(character, 'Acrobatics');
    if (isStringSurface) {
      return {
        ...resolveAcrobaticsBalance(res.total, surfaceOrOpts, { ...stringOpts, acrobaticsRanks }),
        checkBreakdown: res.breakdown,
      };
    }
    return {
      ...resolveAcrobaticsBalance(res.total, { ...objectOpts, acrobaticsRanks }),
      checkBreakdown: res.breakdown,
    };
  }
  longJump(character, distanceFeet, runningStart = false) {
    const res = this.resolveSkillCheck(character, 'Acrobatics');
    if (!res.canUse) return res;
    // Nullish-coalesce so a paralyzed/held creature (speed 0) is treated as
    // immobile, not as a normal 30 ft walker.
    const baseSpeed = character.speed ?? 30;
    const speedMod = getJumpSpeedMod(baseSpeed);
    const adjusted = res.total + speedMod;
    return { ...resolveLongJump(adjusted, distanceFeet, { runningStart, baseSpeed }), speedMod, checkBreakdown: res.breakdown };
  }
  highJump(character, heightFeet, runningStart = false, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Acrobatics');
    if (!res.canUse) return res;
    const baseSpeed = character.speed ?? 30;
    const speedMod = getJumpSpeedMod(baseSpeed);
    const adjusted = res.total + speedMod;
    // No hard cap by default — max reachable height = check ÷ 4 (running)
    // or check ÷ 8 (standing), per CRB.
    return { ...resolveHighJump(adjusted, heightFeet, { runningStart, maxHeight: opts.maxHeight }), speedMod, checkBreakdown: res.breakdown };
  }
  // Stand from prone. Out of combat (or unthreatened), this is just a free
  // action — no Acrobatics check is needed and no AoO is provoked. The DC 35
  // Acrobatics rule only matters when the character is threatened by an enemy
  // and wants to avoid provoking, so we only roll in that case.
  standFromProne(character, opts = {}) {
    const inCombat = opts.inCombat !== false; // default: assume combat context
    const threatened = opts.threatened !== false;
    if (!inCombat || !threatened) {
      return {
        success: true,
        dc: null,
        noCheckNeeded: true,
        breakdown: 'Stands from prone as a move action — no AoO concern (not threatened)',
      };
    }
    const res = this.resolveSkillCheck(character, 'Acrobatics', null, { inCombat: true, threatened: true });
    if (!res.canUse) return res;
    return { ...resolveStandFromProne(res.total), checkBreakdown: res.breakdown };
  }
  softFall(character, fallDistanceFeet) {
    const res = this.resolveSkillCheck(character, 'Acrobatics');
    if (!res.canUse) return res;
    const acrobaticsRanks = this.getSkillRanks(character, 'Acrobatics');
    // Nullish-coalesce: a held/paralyzed character should not get the 30 ft
    // soft-fall cap of a normal walker — under 5 ranks they get cap = 0.
    const baseSpeed = character.speed ?? 30;
    return {
      ...resolveSoftFall(res.total, fallDistanceFeet, { acrobaticsRanks, baseSpeed }),
      checkBreakdown: res.breakdown,
    };
  }

  // Appraise
  // CRB p.89-90: DC 20 common item (1 standard action), or DC 20-30
  // determining the most valuable item in a treasure hoard (1 full-round
  // action). Cannot try again — further attempts reveal the same result.
  // Success by 5+ determines if the item has magic properties (not the
  // specific abilities — that's Spellcraft). Fail by <5 → estimate within
  // 20% of actual; fail by 5+ → wildly inaccurate. Magnifying glass +2,
  // merchant's scale +2, Diligent feat +2, raven familiar +3 (all stack).
  appraiseItem(character, rarity = 'common', opts = {}) {
    const res = this.resolveSkillCheck(character, 'Appraise');
    if (!res.canUse) return res;
    // Auto-detect Diligent feat from the character's feat list so callers
    // don't need to pass it manually. Tolerate both string-array and
    // {name}-object array shapes that exist in this codebase.
    let hasDiligent = !!opts.diligent;
    if (!hasDiligent && Array.isArray(character?.feats)) {
      hasDiligent = character.feats.some(f => {
        if (typeof f === 'string') return /^diligent$/i.test(f);
        if (f && typeof f === 'object') return /^diligent$/i.test(f.name || '');
        return false;
      });
    }
    // Raven familiar's +3 Appraise bonus is applied centrally by
    // aggregateFamiliarModifiers (Phase 7.3): it lands in merged.skills.Appraise
    // and is already baked into res.total via computeSkillCheck. Do NOT
    // auto-detect it here from character.familiar — that would double-apply
    // the bonus (+6 instead of +3) as soon as any save stores character.familiar
    // in a shape the regex matches. If a caller explicitly passes
    // opts.ravenFamiliar (e.g. a GM override, or a test fixture whose character
    // skips the aggregator), we honor it as a manual flag; the auto-detect
    // path is gone by design.
    return {
      ...resolveAppraise(res.total, {
        rarity,
        dc: opts.dc,
        hoard: !!opts.hoard,
        magnifyingGlass: !!opts.magnifyingGlass,
        smallOrDetailed: !!opts.smallOrDetailed,
        merchantScale: !!opts.merchantScale,
        valuedByWeight: !!opts.valuedByWeight,
        diligent: hasDiligent,
        ravenFamiliar: !!opts.ravenFamiliar,
      }),
      checkBreakdown: res.breakdown,
    };
  }

  // ─────────────────────────────────────────────
  // inspectItem — "the player is examining this thing".
  // ─────────────────────────────────────────────
  //
  // High-level wrapper that glues together:
  //   1. computeAppraiseMetadata  — derive Appraise-relevant fields from any
  //      item shape (works on equipment.json entries AND on runtime loot).
  //   2. character inventory scan — detect magnifying glass / merchant's scale
  //      so the caller doesn't have to pass them manually.
  //   3. appraiseItem             — rolls the Appraise check via the resolver.
  //   4. formatAppraiseForPlayer  — turns the resolver output into the exact
  //      strings the UI (AreaItemsPanel hover card, GM narration) will show.
  //
  // Returns:
  //   {
  //     item:            the item (augmented with appraise metadata),
  //     check:           raw resolver output (success, dc, detectsMagic, ...),
  //     display:         formatted player-facing object {band, headline, valueText, magicHint, ...},
  //     checkBreakdown:  "Appraise 17 vs DC 20 — ..."
  //   }
  //
  // If the character cannot make the check at all, returns { canUse: false, reason }.
  inspectItem(character, item, opts = {}) {
    // Hydrate the item with metadata if it wasn't back-filled yet. This
    // guarantees inspectItem works on runtime loot drops that bypassed the
    // equipment.json codemod.
    const hydrated = withAppraiseMetadata(item || {});

    // Auto-detect equipment bonuses from the character's inventory.
    // Inventory shapes in this codebase vary, so check the most common keys
    // permissively: character.inventory, character.items, character.gear.
    const invSources = [character?.inventory, character?.items, character?.gear];
    const invNames = [];
    for (const src of invSources) {
      if (!Array.isArray(src)) continue;
      for (const entry of src) {
        if (typeof entry === 'string') invNames.push(entry);
        else if (entry && typeof entry === 'object') invNames.push(entry.name || '');
      }
    }
    const hasMagnifyingGlass = opts.magnifyingGlass != null
      ? !!opts.magnifyingGlass
      : invNames.some(n => /magnifying\s*glass/i.test(n));
    const hasMerchantScale = opts.merchantScale != null
      ? !!opts.merchantScale
      : invNames.some(n => /merchant'?s?\s*scale/i.test(n));

    const check = this.appraiseItem(character, hydrated.rarity || 'common', {
      dc: opts.dc,
      hoard: !!opts.hoard,
      magnifyingGlass: hasMagnifyingGlass,
      smallOrDetailed: !!hydrated.smallOrDetailed,
      merchantScale: hasMerchantScale,
      valuedByWeight: !!hydrated.valuedByWeight,
      diligent: opts.diligent,
      ravenFamiliar: opts.ravenFamiliar,
    });

    if (check && check.canUse === false) {
      return check; // character can't Appraise at all; bubble up the reason
    }

    const display = formatAppraiseForPlayer(check, hydrated);

    return {
      item: hydrated,
      check,
      display,
      checkBreakdown: check?.checkBreakdown || check?.breakdown || null,
    };
  }

  // inspectHoard — convenience: "survey the pile" as a 1-full-round action.
  // Caller passes an array of items; we pick the max-actualValue piece and
  // run inspectItem in hoard mode against it. The check identifies the most
  // valuable visible item in the hoard (CRB p.89-90). DC defaults to 20 and
  // can rise to 30 for "particularly large" hoards — callers can override.
  inspectHoard(character, items, opts = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return { canUse: false, reason: 'No items in hoard' };
    }
    // Hydrate every item so we can pick the top piece by actualValue.
    const hydrated = items.map(i => withAppraiseMetadata(i || {}));
    const topPiece = hydrated.reduce((a, b) =>
      (b.actualValue || 0) > (a.actualValue || 0) ? b : a
    );
    return this.inspectItem(character, topPiece, { ...opts, hoard: true });
  }

  // Climb
  climb(character, dc, accelerated = false) {
    const res = this.resolveSkillCheck(character, 'Climb');
    if (!res.canUse) return res;
    return { ...resolveClimb(res.total, dc, { accelerated }), checkBreakdown: res.breakdown };
  }

  // Craft (downtime — no situational gating).
  // opts: { accelerated: bool, toolMods: {...}, dcOverride: number }
  // Pass dcOverride for armor (10 + AC bonus) or composite bows (15 + 2×rating)
  // where the flat itemType → DC lookup doesn't apply.
  craftProgressWeekly(crafter, itemType, itemPriceGP, opts = {}) {
    const res = this.take10SkillCheck(crafter, 'Craft', { timeLimit: false });
    if (!res.canUse) return res;
    const itemDC = Number.isFinite(opts.dcOverride) ? opts.dcOverride : getCraftItemDC(itemType);
    if (itemDC === null) {
      return { canUse: false, reason: `Unknown craft item type "${itemType}" — pass opts.dcOverride for armor/composite-bow/custom items.` };
    }
    return { ...resolveCraftProgressWeekly(res.total, itemDC, itemPriceGP, opts), itemType, itemDC, checkBreakdown: res.breakdown };
  }

  // Disguise
  disguiseAgainst(character, observers = [], disguiseOpts = {}) {
    const dRes = this.resolveSkillCheck(character, 'Disguise');
    if (!dRes.canUse) return dRes;
    const mod = getDisguiseModifier(disguiseOpts);
    const disguiseTotal = dRes.total + mod.mod;
    const perceptionTotals = observers.map(o => {
      const r = this.resolveSkillCheck(o, 'Perception');
      return r.canUse ? r.total : 0;
    });
    return {
      ...resolveDisguise(disguiseTotal, perceptionTotals),
      modifierBreakdown: mod.notes,
      adjustedTotal: disguiseTotal,
      checkBreakdown: dRes.breakdown,
    };
  }

  // Escape Artist
  escapeRestraint(character, restraint, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Escape Artist');
    if (!res.canUse) return res;
    return { ...resolveEscapeArtist(res.total, restraint, opts), checkBreakdown: res.breakdown };
  }
  escapeGrapple(character, grapplerCMD) {
    const res = this.resolveSkillCheck(character, 'Escape Artist', null, { inCombat: true, threatened: true });
    if (!res.canUse) return res;
    return { ...resolveEscapeFromGrapple(res.total, grapplerCMD), checkBreakdown: res.breakdown };
  }

  // Fly
  fly(character, maneuver, maneuverability = 'average') {
    const res = this.resolveSkillCheck(character, 'Fly');
    if (!res.canUse) return res;
    return { ...resolveFly(res.total, maneuver, maneuverability), checkBreakdown: res.breakdown };
  }

  // Handle Animal
  handleAnimal(character, task) {
    const res = this.resolveSkillCheck(character, 'Handle Animal');
    if (!res.canUse) return res;
    return { ...resolveHandleAnimal(res.total, task), checkBreakdown: res.breakdown };
  }

  // Linguistics
  attemptForgery(forger, reader, opts = {}) {
    const fRes = this.resolveSkillCheck(forger, 'Linguistics');
    const rRes = this.resolveSkillCheck(reader, 'Linguistics');
    if (!fRes.canUse) return fRes;
    if (!rRes.canUse) return rRes;
    return resolveForgery(fRes.total, rRes.total, opts);
  }
  decipherScript(character, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Linguistics');
    if (!res.canUse) return res;
    return { ...resolveDecipherScript(res.total, opts), checkBreakdown: res.breakdown };
  }

  // Profession (downtime)
  professionIncome(character) {
    const res = this.take10SkillCheck(character, 'Profession', { timeLimit: false });
    if (!res.canUse) return res;
    return { ...resolveProfessionIncome(res.total), checkBreakdown: res.breakdown };
  }

  // Ride
  ride(character, task) {
    const res = this.resolveSkillCheck(character, 'Ride');
    if (!res.canUse) return res;
    return { ...resolveRide(res.total, task), checkBreakdown: res.breakdown };
  }

  // Sleight of Hand
  sleightOfHand(character, action, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Sleight of Hand');
    if (!res.canUse) return res;
    return { ...resolveSleightOfHand(res.total, action, opts), checkBreakdown: res.breakdown };
  }

  // Spellcraft
  identifySpellBeingCast(character, spellLevel) {
    const res = this.resolveSkillCheck(character, 'Spellcraft', null, { inCombat: true });
    if (!res.canUse) return res;
    return { ...resolveSpellcraftIdentifySpell(res.total, spellLevel), checkBreakdown: res.breakdown };
  }
  identifyMagicItem(character, casterLevel) {
    const res = this.resolveSkillCheck(character, 'Spellcraft');
    if (!res.canUse) return res;
    return { ...resolveSpellcraftIdentifyItem(res.total, casterLevel), checkBreakdown: res.breakdown };
  }
  learnSpellFromScroll(character, spellLevel) {
    const res = this.resolveSkillCheck(character, 'Spellcraft');
    if (!res.canUse) return res;
    return { ...resolveSpellcraftLearnFromScroll(res.total, spellLevel), checkBreakdown: res.breakdown };
  }

  // Survival
  trackQuarry(character, surface, partySize, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Survival');
    if (!res.canUse) return res;
    const dc = getTrackingDC(surface, partySize, opts);
    return { ...resolveTracking(res.total, dc), checkBreakdown: res.breakdown };
  }
  forageForFood(character, terrain = 'normal') {
    const res = this.resolveSkillCheck(character, 'Survival');
    if (!res.canUse) return res;
    return { ...resolveForage(res.total, terrain), checkBreakdown: res.breakdown };
  }
  predictWeather(character, daysAhead = 1) {
    const res = this.resolveSkillCheck(character, 'Survival');
    if (!res.canUse) return res;
    return { ...resolveWeatherPrediction(res.total, daysAhead), checkBreakdown: res.breakdown };
  }
  navigateTerrain(character, terrain = 'forest') {
    const res = this.resolveSkillCheck(character, 'Survival');
    if (!res.canUse) return res;
    return { ...resolveNavigation(res.total, terrain), checkBreakdown: res.breakdown };
  }

  // Swim
  swim(character, waterCondition = 'calm', opts = {}) {
    const res = this.resolveSkillCheck(character, 'Swim');
    if (!res.canUse) return res;
    return { ...resolveSwim(res.total, waterCondition, opts), checkBreakdown: res.breakdown };
  }
  drowningSaveDC(roundsHeld) {
    return getDrowningSaveDC(roundsHeld);
  }

  // Use Magic Device
  useMagicDevice(character, action, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Use Magic Device');
    if (!res.canUse) return res;
    return { ...resolveUseMagicDevice(res.total, action, opts), checkBreakdown: res.breakdown };
  }

  // ── CHAPTER 4 — GENERAL SKILL MECHANICS ──

  // Aid Another: helper rolls the same skill the ally is using vs DC 10 (default).
  aidAnother(helper, skillName, opts = {}) {
    const res = this.resolveSkillCheck(helper, skillName);
    if (!res.canUse) return res;
    return { ...resolveAidAnother(res.total, opts), helperCheckBreakdown: res.breakdown };
  }

  // Take 10 — roll-replacement when not threatened/distracted
  takeTen(character, skillName, opts = {}) {
    const mods = computeAllSkillModifiers(character, skillsData);
    const skillMod = mods[skillName] || 0;
    return takeTen(skillMod, opts);
  }

  // Take 20 — roll-replacement when there's no consequence for failure and time
  takeTwenty(character, skillName, baseRoundsPerCheck = 1, opts = {}) {
    const mods = computeAllSkillModifiers(character, skillsData);
    const skillMod = mods[skillName] || 0;
    return takeTwenty(skillMod, baseRoundsPerCheck, opts);
  }

  // Cooperative skill check: primary character rolls, helpers roll Aid Another
  cooperativeCheck(primary, helpers, skillName, dc) {
    const primaryRes = this.resolveSkillCheck(primary, skillName);
    if (!primaryRes.canUse) return primaryRes;
    const helperRolls = helpers.map(h => {
      const r = this.resolveSkillCheck(h, skillName);
      return r.canUse ? r.total : 0;
    });
    return resolveCooperativeCheck(primaryRes.total, helperRolls, dc);
  }

  // ── CHAPTER 4 — PERCEPTION ──

  perceive(character, dc, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Perception');
    if (!res.canUse) return res;
    return { ...resolvePerception(res.total, dc, opts), checkBreakdown: res.breakdown };
  }

  // ── CHAPTER 4 — BLUFF SUB-TASKS ──

  feintInCombat(character, target = {}) {
    const res = this.resolveSkillCheck(character, 'Bluff');
    if (!res.canUse) return res;
    return { ...resolveFeintInCombat(res.total, target), checkBreakdown: res.breakdown };
  }

  sendSecretMessage(sender, listener, complexity = 'simple') {
    const senderRes = this.resolveSkillCheck(sender, 'Bluff');
    const listenerRes = this.resolveSkillCheck(listener, 'Sense Motive');
    if (!senderRes.canUse || !listenerRes.canUse) {
      return { canUse: false, breakdown: 'Bluff or Sense Motive unavailable' };
    }
    return resolveSecretMessage(senderRes.total, listenerRes.total, complexity);
  }

  // ── CHAPTER 4 — SENSE MOTIVE SUB-TASKS ──

  senseMotive(character, task = 'hunch', opts = {}) {
    const res = this.resolveSkillCheck(character, 'Sense Motive');
    if (!res.canUse) return res;
    return { ...resolveSenseMotive(res.total, task, opts), checkBreakdown: res.breakdown };
  }

  // ── CHAPTER 4 — DIPLOMACY: GATHER INFORMATION ──

  gatherInformation(character, opts = {}) {
    const res = this.resolveSkillCheck(character, 'Diplomacy');
    if (!res.canUse) return res;
    return { ...resolveGatherInformation(res.total, opts), checkBreakdown: res.breakdown };
  }

  // ── CHAPTER 4 — HEAL: TREAT POISON / DISEASE LOOP ──

  treatPoison(healer, poisonSaveDC) {
    const res = this.resolveSkillCheck(healer, 'Heal');
    if (!res.canUse) return res;
    return { ...resolveTreatPoison(res.total, poisonSaveDC), checkBreakdown: res.breakdown };
  }

  treatDiseaseLoop(healer, diseaseSaveDC, recentSaveResults = []) {
    const res = this.resolveSkillCheck(healer, 'Heal');
    if (!res.canUse) return res;
    return { ...resolveTreatDiseaseLoop(res.total, diseaseSaveDC, recentSaveResults), checkBreakdown: res.breakdown };
  }

  // ── CHAPTER 4 — KNOWLEDGE: LORE DC LADDER ──

  knowledgeLore(character, knowledgeSkill, obscurity = 'common') {
    const res = this.resolveSkillCheck(character, knowledgeSkill);
    if (!res.canUse) return res;
    return { ...resolveKnowledgeLore(res.total, obscurity), checkBreakdown: res.breakdown };
  }

  // ── CHAPTER 4 — STEALTH ACTION RESOLVER ──

  stealthAction(sneaker, observer, opts = {}) {
    const stealthRes = this.resolveSkillCheck(sneaker, 'Stealth');
    const perceptionRes = this.resolveSkillCheck(observer, 'Perception');
    if (!stealthRes.canUse || !perceptionRes.canUse) {
      return { canUse: false, breakdown: 'Stealth or Perception unavailable' };
    }
    return {
      ...resolveStealthAction(stealthRes.total, perceptionRes.total, opts),
      stealthBreakdown: stealthRes.breakdown,
      perceptionBreakdown: perceptionRes.breakdown,
    };
  }

  // ── CHAPTER 4 — SURVIVAL: WILD / WEATHER ──

  getAlongInWild(character, partySize = 1) {
    const res = this.resolveSkillCheck(character, 'Survival');
    if (!res.canUse) return res;
    return { ...resolveGetAlongInWild(res.total, partySize), checkBreakdown: res.breakdown };
  }

  endureSevereWeather(character, severity = 'severe') {
    const res = this.resolveSkillCheck(character, 'Survival');
    if (!res.canUse) return res;
    return { ...resolveEndureSevereWeather(res.total, severity), checkBreakdown: res.breakdown };
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
    // Trace this engine entrypoint so bug reports filed right after a
    // narration failure can show what was happening. (#27)
    traceEngine(`narrate:${type || 'unknown'}`, {
      userAction: userAction,
      location: gameState?.location || null,
      partyLen: Array.isArray(gameState?.party) ? gameState.party.length : null,
      combatActive: !!gameState?.combat?.active,
    });
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
    const baseContext = buildGameContext(stateWithMythic);

    // v12 follow-up — inject the party's unresolved clues so the AI can
    // weave callbacks. getOpenCluesForPrompt is scope-aware (returns empty
    // text when no campaign is active) and token-budgeted (top-N, clipped
    // titles/bodies). Failures here must not block narration, so we swallow
    // errors and continue with just the base context.
    let cluesBlock = '';
    try {
      const { text } = await getOpenCluesForPrompt();
      if (text) cluesBlock = `\n\n${text}`;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[narrate] clue injection failed:', err);
    }
    const context = cluesBlock ? `${baseContext}${cluesBlock}` : baseContext;

    // If the caller pre-ran an Appraise check (AdventureTab.handleItemInteract
    // passes it through as gameState.appraiseResult), format it as a brief
    // GM-only note the LLM can weave into its description. This grounds the
    // narration in the actual rules result instead of letting the LLM make
    // up values or magic flags.
    let appraiseNote = '';
    if (gameState && gameState.appraiseResult && gameState.appraiseResult.display) {
      const ap = gameState.appraiseResult;
      const d = ap.display;
      const band = d.band || 'unknown';
      const itemName = ap.item?.name || 'the item';
      const parts = [];
      parts.push(`APPRAISE CHECK RESULT (for GM narration only):`);
      parts.push(`- Item: ${itemName}`);
      parts.push(`- Outcome band: ${band}`);
      if (d.valueText && d.valueText !== '—') parts.push(`- Player-visible value: ${d.valueText}`);
      if (ap.check?.detectsMagic) parts.push(`- Detects magic presence: YES (do not reveal specific magic properties — that requires Spellcraft)`);
      if (d.gmDiscretion) parts.push(`- GM DISCRETION: the player is confident but wrong. Invent a plausible-but-incorrect price.`);
      if (ap.check?.breakdown) parts.push(`- Check breakdown: ${ap.check.breakdown}`);
      parts.push(`- Weave this result into your narration naturally. Do NOT list the mechanics; describe what the character SEES, NOTICES, or RECOGNIZES.`);
      appraiseNote = '\n\n' + parts.join('\n') + '\n';
    }

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
              prompt = `The player asks the DM: "${userAction}"\n\nAs the GM, answer this question in character. Provide useful information the characters would reasonably know or could discover based on their skills, knowledge, and the current situation. If it requires a skill check (Knowledge, Perception, etc.), narrate the check and its result. Stay in narrative voice — don't break character or use game mechanics jargon directly.\n\nGame State:\n${context}${appraiseNote}`;
            } else {
              prompt = `The player's character takes an action: "${userAction}"\n\nAs the GM, narrate the outcome of this action. Describe what happens when the character does this — the sights, sounds, NPC reactions, and consequences. If it requires a skill check or ability check, narrate the roll and the result. If it might trigger combat or a significant event, set that up dramatically. Stay in second person ("You reach for the door..." etc.).\n\nGame State:\n${context}${appraiseNote}`;
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
                // Bug #55 — drop implausible names (bare topic words the AI
                // sometimes emits: "research", "what suits", "plans"…). The
                // gate accepts proper names (Bertha, Sheriff Hemlock),
                // article-lead appearance descriptors (a cloaked woman),
                // and bare appearance descriptors (tall woman, fat angry
                // gnome) — rejects everything else with a console warn so
                // the drop is visible during live play triage.
                const candidate = parts[0] || '';
                if (!isPlausibleNPCName(candidate)) {
                  // eslint-disable-next-line no-console
                  console.warn('[dmEngine] rejecting implausible NPC from ENTITIES:', candidate);
                  continue;
                }
                // Bug #57 — presence gate. The prompt tells the AI not
                // to list NPCs who are only *mentioned* in dialogue, but
                // the AI still does it when an NPC conversation partner
                // talks about other people. Scan the scrubbed narrative
                // for the candidate name; if every occurrence lives
                // inside quoted dialogue (someone speaking about them),
                // the NPC isn't actually on-scene — drop them. Tom's
                // live Market Square case: Dass Korvaski (the fisherman
                // actually present) mentioned Father Tobyn, Father
                // Zantus, and Mayor Deverin inside a speech; without
                // this gate those three lit up Nearby NPCs with full
                // Talk-to buttons despite not being there.
                if (!nameAppearsInSceneNarration(candidate, narrativeText)) {
                  // eslint-disable-next-line no-console
                  console.warn('[dmEngine] rejecting NPC from ENTITIES (only referenced in dialogue):', candidate);
                  continue;
                }
                newEntities.npcs.push({
                  name: candidate || 'Unknown',
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
