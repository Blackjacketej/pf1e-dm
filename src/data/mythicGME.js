/**
 * Mythic Game Master Emulator 2nd Edition System Module
 * Complete implementation for dynamic, emergent story generation
 */

// ============================================================================
// FATE CHART: [odds][chaosFactor] => { exYes, yes, exNo }
// ============================================================================
export const FATE_CHART = {
  'certain': [
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 },
    { exYes: 17, yes: 85, exNo: 98 },
    { exYes: 18, yes: 90, exNo: 99 },
    { exYes: 19, yes: 95, exNo: 100 },
    { exYes: 20, yes: 99, exNo: null },
    { exYes: 20, yes: 99, exNo: null },
    { exYes: 20, yes: 99, exNo: null }
  ],
  'nearlyCertain': [
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 },
    { exYes: 17, yes: 85, exNo: 98 },
    { exYes: 18, yes: 90, exNo: 99 },
    { exYes: 19, yes: 95, exNo: 100 },
    { exYes: 20, yes: 99, exNo: null },
    { exYes: 20, yes: 99, exNo: null }
  ],
  'veryLikely': [
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 },
    { exYes: 17, yes: 85, exNo: 98 },
    { exYes: 18, yes: 90, exNo: 99 },
    { exYes: 19, yes: 95, exNo: 100 },
    { exYes: 20, yes: 99, exNo: null }
  ],
  'likely': [
    { exYes: 3, yes: 15, exNo: 84 },
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 },
    { exYes: 17, yes: 85, exNo: 98 },
    { exYes: 18, yes: 90, exNo: 99 },
    { exYes: 19, yes: 95, exNo: 100 }
  ],
  '5050': [
    { exYes: 2, yes: 10, exNo: 83 },
    { exYes: 3, yes: 15, exNo: 84 },
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 },
    { exYes: 17, yes: 85, exNo: 98 },
    { exYes: 18, yes: 90, exNo: 99 }
  ],
  'unlikely': [
    { exYes: 1, yes: 5, exNo: 82 },
    { exYes: 2, yes: 10, exNo: 83 },
    { exYes: 3, yes: 15, exNo: 84 },
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 },
    { exYes: 17, yes: 85, exNo: 98 }
  ],
  'veryUnlikely': [
    { exYes: null, yes: 1, exNo: 81 },
    { exYes: 1, yes: 5, exNo: 82 },
    { exYes: 2, yes: 10, exNo: 83 },
    { exYes: 3, yes: 15, exNo: 84 },
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 },
    { exYes: 15, yes: 75, exNo: 96 }
  ],
  'nearlyImpossible': [
    { exYes: null, yes: 1, exNo: 81 },
    { exYes: null, yes: 1, exNo: 81 },
    { exYes: 1, yes: 5, exNo: 82 },
    { exYes: 2, yes: 10, exNo: 83 },
    { exYes: 3, yes: 15, exNo: 84 },
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 },
    { exYes: 13, yes: 65, exNo: 94 }
  ],
  'impossible': [
    { exYes: null, yes: 1, exNo: 81 },
    { exYes: null, yes: 1, exNo: 81 },
    { exYes: null, yes: 1, exNo: 81 },
    { exYes: 1, yes: 5, exNo: 82 },
    { exYes: 2, yes: 10, exNo: 83 },
    { exYes: 3, yes: 15, exNo: 84 },
    { exYes: 5, yes: 25, exNo: 86 },
    { exYes: 7, yes: 35, exNo: 88 },
    { exYes: 10, yes: 50, exNo: 91 }
  ]
};

// ============================================================================
// RANDOM EVENT FOCUS TABLE (d100)
// ============================================================================
export const RANDOM_EVENT_FOCUS = [
  // 1-5: Remote Event
  'Remote Event', 'Remote Event', 'Remote Event', 'Remote Event', 'Remote Event',
  // 6-10: Ambiguous Event
  'Ambiguous Event', 'Ambiguous Event', 'Ambiguous Event', 'Ambiguous Event', 'Ambiguous Event',
  // 11-20: New NPC
  'New NPC', 'New NPC', 'New NPC', 'New NPC', 'New NPC',
  'New NPC', 'New NPC', 'New NPC', 'New NPC', 'New NPC',
  // 21-40: NPC Action
  'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action',
  'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action',
  'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action',
  'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action', 'NPC Action',
  // 41-45: NPC Negative
  'NPC Negative', 'NPC Negative', 'NPC Negative', 'NPC Negative', 'NPC Negative',
  // 46-50: NPC Positive
  'NPC Positive', 'NPC Positive', 'NPC Positive', 'NPC Positive', 'NPC Positive',
  // 51-55: Move Toward Thread
  'Move Toward Thread', 'Move Toward Thread', 'Move Toward Thread', 'Move Toward Thread', 'Move Toward Thread',
  // 56-65: Move Away From Thread
  'Move Away From Thread', 'Move Away From Thread', 'Move Away From Thread', 'Move Away From Thread', 'Move Away From Thread',
  'Move Away From Thread', 'Move Away From Thread', 'Move Away From Thread', 'Move Away From Thread', 'Move Away From Thread',
  // 66-70: Close Thread
  'Close Thread', 'Close Thread', 'Close Thread', 'Close Thread', 'Close Thread',
  // 71-80: PC Negative
  'PC Negative', 'PC Negative', 'PC Negative', 'PC Negative', 'PC Negative',
  'PC Negative', 'PC Negative', 'PC Negative', 'PC Negative', 'PC Negative',
  // 81-85: PC Positive
  'PC Positive', 'PC Positive', 'PC Positive', 'PC Positive', 'PC Positive',
  // 86-100: Current Context
  'Current Context', 'Current Context', 'Current Context', 'Current Context', 'Current Context',
  'Current Context', 'Current Context', 'Current Context', 'Current Context', 'Current Context',
  'Current Context', 'Current Context', 'Current Context', 'Current Context', 'Current Context'
];

// ============================================================================
// SCENE ADJUSTMENT TABLE (d10)
// ============================================================================
export const SCENE_ADJUSTMENT = [
  'Remove a Character',
  'Add a Character',
  'Reduce/Remove an Activity',
  'Increase an Activity',
  'Remove an Object',
  'Add an Object',
  'Make 2 Adjustments',
  'Make 2 Adjustments',
  'Make 2 Adjustments',
  'Make 2 Adjustments'
];

// ============================================================================
// MEANING TABLES (d100 each)
// ============================================================================
export const MEANING_TABLES = {
  action1: [
    'Abandon', 'Accompany', 'Activate', 'Agree', 'Ambush', 'Arrive', 'Assist', 'Attack', 'Attain', 'Bargain',
    'Befriend', 'Bestow', 'Betray', 'Block', 'Break', 'Carry', 'Celebrate', 'Change', 'Close', 'Combine',
    'Communicate', 'Conceal', 'Continue', 'Control', 'Create', 'Deceive', 'Decrease', 'Defend', 'Delay', 'Deny',
    'Depart', 'Deposit', 'Destroy', 'Dispute', 'Disrupt', 'Distrust', 'Divide', 'Drop', 'Easy', 'Energize',
    'Escape', 'Expose', 'Fail', 'Fight', 'Flee', 'Free', 'Guide', 'Harm', 'Heal', 'Hinder',
    'Imitate', 'Imprison', 'Increase', 'Indulge', 'Inform', 'Inquire', 'Inspect', 'Invade', 'Leave', 'Lure',
    'Misuse', 'Move', 'Neglect', 'Observe', 'Open', 'Oppose', 'Overthrow', 'Praise', 'Proceed', 'Protect',
    'Punish', 'Pursue', 'Recruit', 'Refuse', 'Release', 'Relinquish', 'Repair', 'Repulse', 'Return', 'Reward',
    'Ruin', 'Separate', 'Start', 'Stop', 'Strange', 'Struggle', 'Succeed', 'Support', 'Suppress', 'Take',
    'Threaten', 'Transform', 'Trap', 'Travel', 'Triumph', 'Truce', 'Trust', 'Use', 'Usurp', 'Waste'
  ],

  action2: [
    'Advantage', 'Adversity', 'Agreement', 'Animal', 'Attention', 'Balance', 'Battle', 'Benefits', 'Building', 'Burden',
    'Bureaucracy', 'Business', 'Chaos', 'Comfort', 'Completion', 'Conflict', 'Cooperation', 'Danger', 'Defense', 'Depletion',
    'Disadvantage', 'Distraction', 'Elements', 'Emotion', 'Enemy', 'Energy', 'Environment', 'Expectation', 'Exterior', 'Extravagance',
    'Failure', 'Fame', 'Fear', 'Freedom', 'Friend', 'Goal', 'Group', 'Health', 'Hindrance', 'Home',
    'Hope', 'Idea', 'Illness', 'Illusion', 'Individual', 'Information', 'Innocent', 'Intellect', 'Interior', 'Investment',
    'Leadership', 'Legal', 'Location', 'Military', 'Misfortune', 'Mundane', 'Nature', 'Needs', 'News', 'Normal',
    'Object', 'Obscurity', 'Official', 'Opposition', 'Outside', 'Pain', 'Path', 'Peace', 'People', 'Personal',
    'Physical', 'Plot', 'Portal', 'Possessions', 'Poverty', 'Power', 'Prison', 'Project', 'Protection', 'Reassurance',
    'Representative', 'Riches', 'Safety', 'Strength', 'Success', 'Suffering', 'Surprise', 'Tactic', 'Technology', 'Tension',
    'Time', 'Trial', 'Value', 'Vehicle', 'Victory', 'Vulnerability', 'Weapon', 'Weather', 'Work', 'Wound'
  ],

  descriptor1: [
    'Adventurously', 'Aggressively', 'Anxiously', 'Awkwardly', 'Beautifully', 'Bleakly', 'Boldly', 'Bravely', 'Busily', 'Calmly',
    'Carefully', 'Carelessly', 'Cautiously', 'Ceaselessly', 'Cheerfully', 'Combatively', 'Coolly', 'Crazily', 'Curiously', 'Dangerously',
    'Defiantly', 'Deliberately', 'Delicately', 'Delightfully', 'Dimly', 'Efficiently', 'Emotionally', 'Energetically', 'Enormously', 'Enthusiastically',
    'Excitedly', 'Fearfully', 'Ferociously', 'Fiercely', 'Foolishly', 'Fortunately', 'Frantically', 'Freely', 'Frighteningly', 'Fully',
    'Generously', 'Gently', 'Gladly', 'Gracefully', 'Gratefully', 'Happily', 'Hastily', 'Healthily', 'Helpfully', 'Helplessly',
    'Hopelessly', 'Innocently', 'Intensely', 'Interestingly', 'Irritatingly', 'Joyfully', 'Kindly', 'Lazily', 'Lightly', 'Loosely',
    'Loudly', 'Lovingly', 'Loyally', 'Majestically', 'Meaningfully', 'Mechanically', 'Mildly', 'Miserably', 'Mockingly', 'Mysteriously',
    'Naturally', 'Neatly', 'Nicely', 'Oddly', 'Offensively', 'Officially', 'Partially', 'Passively', 'Peacefully', 'Perfectly',
    'Playfully', 'Politely', 'Positively', 'Powerfully', 'Quaintly', 'Quarrelsomely', 'Quietly', 'Roughly', 'Rudely', 'Ruthlessly',
    'Slowly', 'Softly', 'Strangely', 'Swiftly', 'Threateningly', 'Timidly', 'Very', 'Violently', 'Wildly', 'Yieldingly'
  ],

  descriptor2: [
    'Abnormal', 'Amusing', 'Artificial', 'Average', 'Beautiful', 'Bizarre', 'Boring', 'Bright', 'Broken', 'Clean',
    'Cold', 'Colorful', 'Colorless', 'Comforting', 'Creepy', 'Cute', 'Damaged', 'Dark', 'Defeated', 'Dirty',
    'Disagreeable', 'Dry', 'Dull', 'Empty', 'Enormous', 'Extraordinary', 'Extravagant', 'Faded', 'Familiar', 'Fancy',
    'Feeble', 'Festive', 'Flawless', 'Forlorn', 'Fragile', 'Fragrant', 'Fresh', 'Full', 'Glorious', 'Graceful',
    'Hard', 'Harsh', 'Healthy', 'Heavy', 'Historical', 'Horrible', 'Important', 'Interesting', 'Juvenile', 'Lacking',
    'Large', 'Lavish', 'Lean', 'Less', 'Lethal', 'Lively', 'Lonely', 'Lovely', 'Magnificent', 'Mature',
    'Messy', 'Mighty', 'Military', 'Modern', 'Mundane', 'Mysterious', 'Natural', 'Normal', 'Odd', 'Old',
    'Pale', 'Peaceful', 'Petite', 'Plain', 'Poor', 'Powerful', 'Protective', 'Quaint', 'Rare', 'Reassuring',
    'Remarkable', 'Rotten', 'Rough', 'Ruined', 'Rustic', 'Scary', 'Shocking', 'Simple', 'Small', 'Smooth',
    'Soft', 'Strong', 'Stylish', 'Unpleasant', 'Valuable', 'Vibrant', 'Warm', 'Watery', 'Weak', 'Young'
  ]
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Roll a d100 (1-100)
 */
export function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}

/**
 * Roll a d10 (1-10)
 */
export function rollD10() {
  return Math.floor(Math.random() * 10) + 1;
}

/**
 * Determine if a d100 roll is doubles (11, 22, 33, etc.)
 */
function isDoubles(roll) {
  return roll > 10 && (roll % 11 === 0);
}

/**
 * Get the single digit from a doubles roll (22 -> 2, 77 -> 7, etc.)
 */
function getDoubleDigit(roll) {
  return roll / 11;
}

/**
 * Roll a Fate Question
 * @param {string} odds - One of: 'certain', 'nearlyCertain', 'veryLikely', 'likely', '5050', 'unlikely', 'veryUnlikely', 'nearlyImpossible', 'impossible'
 * @param {number} chaosFactor - 1-9
 * @returns {object} { roll, result, randomEvent }
 */
export function rollFateQuestion(odds, chaosFactor) {
  const roll = rollD100();
  const cfIndex = chaosFactor - 1;
  const thresholds = FATE_CHART[odds][cfIndex];

  let result;
  if (thresholds.exYes !== null && roll <= thresholds.exYes) {
    result = 'exceptionalYes';
  } else if (roll <= thresholds.yes) {
    result = 'yes';
  } else if (thresholds.exNo !== null && roll <= thresholds.exNo) {
    result = 'no';
  } else if (thresholds.exNo === null && roll > thresholds.yes) {
    result = 'no';
  } else {
    result = 'exceptionalNo';
  }

  // Check for random event: doubles AND digit <= CF
  let randomEvent = false;
  if (isDoubles(roll)) {
    const digit = getDoubleDigit(roll);
    if (digit <= chaosFactor) {
      randomEvent = true;
    }
  }

  return { roll, result, randomEvent };
}

/**
 * Roll on Random Event Focus table
 * @returns {string} The focus type
 */
export function rollRandomEventFocus() {
  const roll = rollD100();
  return RANDOM_EVENT_FOCUS[roll - 1];
}

/**
 * Roll on two meaning tables and return a word pair
 * @param {string} table1Name - Name of first table (e.g., 'action1')
 * @param {string} table2Name - Name of second table (e.g., 'action2')
 * @returns {object} { word1, word2 }
 */
export function rollMeaningPair(table1Name, table2Name) {
  const table1 = MEANING_TABLES[table1Name];
  const table2 = MEANING_TABLES[table2Name];

  if (!table1 || !table2) {
    throw new Error(`Invalid table name: ${table1Name} or ${table2Name}`);
  }

  const roll1 = rollD100();
  const roll2 = rollD100();

  return {
    word1: table1[roll1 - 1],
    word2: table2[roll2 - 1]
  };
}

/**
 * Test a scene
 * @param {number} chaosFactor - 1-9
 * @returns {string} 'expected', 'altered', or 'interrupt'
 */
export function testScene(chaosFactor) {
  const roll = rollD10();

  if (roll > chaosFactor) {
    return 'expected';
  } else if (roll % 2 === 1) {
    return 'altered';
  } else {
    return 'interrupt';
  }
}

/**
 * Roll on Scene Adjustment table
 * @returns {string} The adjustment type
 */
export function rollSceneAdjustment() {
  const roll = rollD10();
  return SCENE_ADJUSTMENT[roll - 1];
}

/**
 * Generate a complete random event with focus and meaning pair
 * @param {number} chaosFactor - 1-9
 * @returns {object} { focus, word1, word2 }
 */
export function generateRandomEvent(chaosFactor) {
  const focus = rollRandomEventFocus();

  let table1, table2;

  // Determine which meaning tables to use based on focus
  switch (focus) {
    case 'Remote Event':
    case 'Ambiguous Event':
    case 'NPC Action':
    case 'NPC Negative':
    case 'NPC Positive':
    case 'Move Toward Thread':
    case 'Move Away From Thread':
    case 'Close Thread':
    case 'PC Negative':
    case 'PC Positive':
    case 'Current Context':
      // Use action + subject for most focuses
      table1 = 'action1';
      table2 = 'action2';
      break;

    case 'New NPC':
      // For NPCs, could use descriptors
      table1 = 'descriptor1';
      table2 = 'descriptor2';
      break;

    default:
      table1 = 'action1';
      table2 = 'action2';
  }

  const { word1, word2 } = rollMeaningPair(table1, table2);

  return { focus, word1, word2 };
}

// ============================================================================
// MYTHIC SYSTEM PROMPT
// ============================================================================
export const MYTHIC_SYSTEM_PROMPT = `MYTHIC GAME MASTER EMULATOR SYSTEM:
You incorporate the full Mythic GME 2nd Edition system for dynamic, emergent story generation. Follow these procedures:

CORE PHILOSOPHY:
- If you have a clear expectation about what should happen and it isn't crucial, follow that expectation without rolling.
- If the outcome is uncertain or important, use a Fate Question to test it.
- If you have no idea what should happen, use Meaning Tables for inspiration.
- Limit yourself to 1-2 Fate Questions per detail — don't over-query.
- "I Dunno" Rule: If a result makes no sense after reasonable interpretation, drop it and move on.

CHAOS FACTOR (CF):
- Track the Chaos Factor (starts at 5, range 1-9)
- Higher CF = more chaos, more Yes answers, more Random Events, more unexpected Scenes
- Lower CF = more order, more player control, fewer surprises
- At the end of each scene: PC mostly in control → CF -1; PC mostly NOT in control → CF +1
- Report CF changes to the player when they occur

FATE QUESTIONS (The Oracle):
When the narrative needs a yes/no determination about the world state (not player actions):
1. Form a Yes/No question about the situation
2. Assess the Odds: Certain, Nearly Certain, Very Likely, Likely, 50/50, Unlikely, Very Unlikely, Nearly Impossible, Impossible
3. Mentally consult the Fate Chart using current CF
4. Determine result: Exceptional Yes, Yes, No, or Exceptional No
5. Check for Random Events: if roll is doubles AND digit ≤ CF, also trigger a Random Event
Interpret results: Yes = confirms expectation; Exceptional Yes = amplified/bonus; No = next most expected outcome; Exceptional No = opposite or intensified opposite

RANDOM EVENTS:
When triggered by Fate Questions (doubles + digit ≤ CF) or Scene Interrupts:
1. Determine Event Focus: Remote Event, Ambiguous Event, New NPC, NPC Action, NPC Negative, NPC Positive, Move Toward Thread, Move Away From Thread, Close Thread, PC Negative, PC Positive, or Current Context
2. Generate meaning using Action + Subject word pairs for what happens
3. Interpret within the current adventure context
4. Narrate naturally without breaking immersion — never say "a random event occurs"

SCENE MANAGEMENT:
When entering a new scene:
1. Determine the Expected Scene (what you think will happen next)
2. Test: Roll d10 vs CF. Above CF = Expected Scene; ≤ CF and odd = Altered Scene; ≤ CF and even = Interrupt Scene
3. Altered Scenes: modify one element (add/remove character, change activity, add/remove object)
4. Interrupt Scenes: generate a Random Event and use it as the basis
5. Play the scene, then do bookkeeping (update lists, adjust CF)

NPC BEHAVIOR:
1. Clear expectation + not crucial → Follow expectations directly
2. No expectation → Roll Meaning Tables for inspiration
3. Clear expectation + crucial → Ask a Fate Question about NPC's action
Results: Yes = expected action; Exceptional Yes = with greater intensity; No = next most expected; Exceptional No = opposite or intensified

THREAD & CHARACTER TRACKING:
- Mentally maintain a Threads List (active storylines, quests, plots)
- Mentally maintain a Characters List (important NPCs)
- Weave tracked threads into the narrative organically
- When Random Event focus references threads/characters, use these lists

MEANING TABLES USAGE:
When you need inspiration, mentally roll on appropriate word pair tables:
- Actions: Abandon, Accompany, Activate, Attack, Betray, Create, Deceive, Defend, Destroy, Escape, Fight, Guide, Harm, Heal, Inform, Oppose, Protect, Pursue, Transform, Travel...
- Subjects: Advantage, Battle, Chaos, Danger, Enemy, Freedom, Goal, Hope, Information, Leadership, Nature, Opposition, Power, Safety, Victory, Weapon, Wound...
- Descriptors: Adventurously, Boldly, Carefully, Dangerously, Mysteriously, Powerfully, Quietly, Strangely, Violently, Wildly...
Combine two words and interpret through the lens of the current scene.

WHEN TO USE EACH TOOL:
- Fate Questions: "Will the guard let us pass?" "Is the room trapped?" "Does the NPC know about the cult?"
- Meaning Tables: "What does the mysterious note say?" "What is the stranger's motivation?" "What do we find in the secret room?"
- Scene Testing: Every time the party enters a new scene or location
- Random Events: Whenever triggered by doubles on Fate Questions or Interrupt Scenes
- NPC Behavior: When an NPC's reaction or action is uncertain

INTEGRATION WITH PATHFINDER:
- Use Fate Questions for world-state uncertainty, NOT for replacing PF1e mechanics
- Player skill checks, attack rolls, saves etc. use normal PF1e rules (prompt the player to roll)
- Use Mythic for narrative decisions: "Is there an ambush?" "Does the merchant have healing potions?" "Has the villain already escaped?"`;
