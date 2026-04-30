# AI Pathfinder DM — Content Addition & Enforcement Workflows

Complete step-by-step workflows for adding any content type to the game, including full mechanical enforcement and scripting. Designed to be followed when implementing new sourcebooks.

---

## Master Sourcebook Implementation Workflow

When a new sourcebook is presented for implementation, follow this ordered checklist. Each item references the detailed workflow section below.

### Phase 1: Data Entry (Add raw content to JSON files)
- [ ] New **Races** → `races.json` (Section 1)
- [ ] New **Subraces / Heritages** → `heritages.json` (Section 2)
- [ ] New **Ethnicities / Origins** → `ethnicities.json` (Section 3)
- [ ] New **Classes** → `classes.json` + `spellSlots.json` (Section 4)
- [ ] New **Prestige Classes** → `prestigeClasses.json` (Section 5)
- [ ] New **Archetypes** → `archetypes.json` (Section 6)
- [ ] New **Class Abilities** that create new conditions → `conditionTracker.js` (Section 19)
- [ ] New **Spells** → `spells.json` (Section 7)
- [ ] New **Feats** → `feats.json` (Section 8)
- [ ] New **Skills** → `skills.json` (Section 9)
- [ ] New **Traits / Drawbacks** → `traits.json` (Section 10)
- [ ] New **Conditions** → `conditionTracker.js` (Section 19)
- [ ] New **Monsters** → `monsters.json` (Section 11)
- [ ] New **NPCs** → `npcs.json` or campaign file (Section 12)
- [ ] New **Equipment / Magic Items** → `equipment.json`, `magicItems.json` (Section 13)
- [ ] New **Locations** → campaign location file (Section 14)
- [ ] New **Settlements** → `settlements.json` (Section 15)
- [ ] New **Dungeons / Encounters** → encounter file (Section 16)
- [ ] New **Maps** → map data file (Section 17)

### Phase 2: Mechanical Enforcement (Wire up game rules)
- [ ] **Spell Effects** — add structured effect data for all new spells to `spellEffects.js` (Section 18)
- [ ] **Conditions** — add modifier definitions to `PF1E_CONDITIONS` in `conditionTracker.js` for any new conditions (Section 19)
- [ ] **Condition aggregation** — ensure `aggregateConditionModifiers()` handles any new modifier keys
- [ ] **Feat prerequisites** — verify `featPrereqs.js` parser handles new prerequisite patterns
- [ ] **Spell validation** — if new casting classes, update `spellSlots.json` + `spellEngine.js`
- [ ] **Enemy AI** — add new spell keywords to `SPELL_CATEGORIES` in `monsterTactics.js`
- [ ] **Rules engine** — if new feats modify saves/attacks/skills, update `rulesEngine.js`
- [ ] **Active effects** — if new spells create non-condition buffs/debuffs, test `activeEffectsTracker.js` handles them

### Phase 3: AI / Scripting Integration
- [ ] **DM system prompt** — update `dmEngine.js` if new rules need AI enforcement (e.g., new concentration triggers, new casting types)
- [ ] **Monster tactics** — update `monsterTactics.js` if new creature abilities need tactical AI support
- [ ] **Creature AI** — update `creatureAI.js` if new action types are needed (new combat maneuvers, new special abilities)
- [ ] **Character context** — ensure new character data (new class features, new conditions) is passed to the AI in `dmEngine.js`

### Phase 4: UI Integration
- [ ] **Character creation** — new races/classes/traits appear in selection UI
- [ ] **Character sheet** — new conditions/effects display correctly
- [ ] **Combat tab** — new spells can be cast, new conditions show on combatants, active effects display
- [ ] **Encyclopedia** — new feats appear in feat tree, new classes/spells/items in reference tabs
- [ ] **Level-up wizard** — new feats/spells/class features selectable during level-up

### Phase 5: Validation
- [ ] `npm run build` — no compilation errors
- [ ] Browser console — no runtime errors
- [ ] **Combat test** — cast new spells, verify damage/healing/conditions/durations
- [ ] **Character test** — create character with new class/race/feats, verify stats
- [ ] **Prerequisite test** — feat tree shows new feats with correct chains
- [ ] **AI test** — DM narrates new content correctly, enemies use new abilities

---

## Table of Contents

1. [Races](#1-races)
2. [Subraces / Heritages](#2-subraces--heritages)
3. [Ethnicities / Origins](#3-ethnicities--origins)
4. [Classes](#4-classes)
5. [Prestige Classes](#5-prestige-classes)
6. [Class Abilities / Archetypes](#6-class-abilities--archetypes)
7. [Spells](#7-spells)
8. [Feats](#8-feats)
9. [Skills](#9-skills)
10. [Traits & Drawbacks](#10-traits--drawbacks)
11. [Monsters / Creatures](#11-monsters--creatures)
12. [NPCs](#12-npcs)
13. [Equipment & Magic Items](#13-equipment--magic-items)
14. [Locations](#14-locations)
15. [Settlements](#15-settlements)
16. [Dungeons / Encounters](#16-dungeons--encounters)
17. [Maps](#17-maps)
18. [Spell Effects (Mechanical)](#18-spell-effects-mechanical)
19. [Conditions](#19-conditions)

---

## 1. Races

**File:** `src/data/races.json`

### Schema
```json
{
  "name": "Race Name",
  "bonuses": { "STR": 2, "CHA": 2, "WIS": -2 },
  "speed": 30,
  "size": "Medium",
  "traits": [
    "Darkvision 60ft",
    "Keen Senses (+2 Perception)",
    "Spell-Like Ability (dancing lights 1/day)"
  ],
  "languages": ["Common", "Elven"]
}
```

### Data Entry
1. Add entry to `src/data/races.json`
2. Required fields: `name`, `bonuses`, `speed`, `size`, `traits`, `languages`
3. Ability bonuses use abbreviations (STR, DEX, CON, INT, WIS, CHA). Negative = penalty.
4. Size: "Small", "Medium", "Large"
5. Traits: array of strings. Include mechanical values in parentheses.

### Enforcement Checklist
- [ ] If race has **ability score overrides** (e.g., +2 to any one), ensure character creation handles flexible bonuses
- [ ] If race has **spell-like abilities**, verify the spells exist in `spells.json`
- [ ] If race grants **weapon familiarity**, ensure those weapons exist in `equipment.json` or `weapons.json`
- [ ] If race modifies **speed** (e.g., dwarves not reduced by armor), add logic to `rulesEngine.js` or note in traits
- [ ] If race has **natural attacks** (bite, claws), format must work with `creatureAI.js` attack parsing
- [ ] If race has **resistances/immunities**, format as text in traits for AI DM to enforce

### Integration Points
- `src/components/CharacterCreation.jsx` — creation dropdown
- `src/utils/character.js` — applies racial ability bonuses
- Consider adding matching **heritages** (Section 2) and **ethnicities** (Section 3)

---

## 2. Subraces / Heritages

**File:** `src/data/heritages.json`

### Schema
```json
{
  "ParentRaceName": [
    {
      "name": "Heritage Name",
      "description": "Brief lore description",
      "bonuses": { "WIS": 2, "CHA": 2 },
      "penalty": { "CON": -2 },
      "replaceTraits": ["Trait being replaced"],
      "addTraits": ["New trait gained instead"],
      "spellLike": "daylight 1/day"
    }
  ]
}
```

### Data Entry
1. Find parent race key in `heritages.json` or create new top-level key
2. Add new object to that race's array
3. Required: `name`, `description`, `bonuses`
4. Optional: `penalty`, `replaceTraits`, `addTraits`, `spellLike`

### Enforcement Checklist
- [ ] `replaceTraits` entries match exact trait strings from the parent race in `races.json`
- [ ] `addTraits` use the same format as parent race traits (mechanical values in parentheses)
- [ ] If `spellLike` references a spell, verify it exists in `spells.json`
- [ ] If heritage changes **ability scores** differently from parent, ensure creation UI overrides correctly

### Integration Points
- Character creation shows heritages as sub-options after race selection
- `replaceTraits` / `addTraits` modify the base race's trait list at creation time

---

## 3. Ethnicities / Origins

**File:** `src/data/ethnicities.json`

### Schema
```json
{
  "humanEthnicities": [
    {
      "name": "Ethnicity Name",
      "description": "Physical and cultural description",
      "homeland": "Primary region",
      "region": "Broader area",
      "languages": ["Common", "Regional"],
      "commonClasses": ["Fighter", "Wizard"],
      "traits": ["Trait Name (Type)"],
      "culturalNotes": "Cultural flavor text"
    }
  ],
  "nonHumanOrigins": {
    "Dwarf": [
      { "name": "Origin Name", "region": "Region", "description": "...", "languages": ["Common", "Dwarven"], "culturalNotes": "..." }
    ]
  }
}
```

### Data Entry
1. Human ethnicities: add to `humanEthnicities` array
2. Non-human origins: add under `nonHumanOrigins.RaceName`
3. Required: `name`, `description`, `homeland`/`region`

### Enforcement Checklist
- [ ] Languages listed exist in the game's language system
- [ ] `commonClasses` reference valid class names from `classes.json`
- [ ] `traits` reference valid trait names from `traits.json` (if mechanical traits)
- [ ] `culturalNotes` gives the AI DM enough context for accurate narration

### Integration Points
- AI DM uses ethnicity data for NPC descriptions and dialogue
- Character creation offers ethnicity as background flavor selection

---

## 4. Classes

**File:** `src/data/classes.json`

### Schema
```json
{
  "name": "Class Name",
  "hd": 8,
  "bab": "3/4",
  "goodSaves": ["Fort", "Ref"],
  "skills": 4,
  "castingAbility": "INT",
  "castingType": "arcane",
  "description": "Class description",
  "alignment": "Any",
  "classSkills": ["Acrobatics", "Appraise", "Craft"],
  "proficiencies": {
    "weapons": ["Simple weapons"],
    "armor": ["Light armor"]
  },
  "classFeatures": [
    { "level": 1, "name": "Feature Name", "description": "What it does" }
  ]
}
```

### Data Entry
1. Add entry to `src/data/classes.json`
2. Required: `name`, `hd`, `bab`, `goodSaves`, `skills`, `description`, `classSkills`, `proficiencies`, `classFeatures`
3. BAB: `"full"` (Fighter), `"3/4"` (Cleric), `"1/2"` (Wizard)
4. Good saves: array of "Fort", "Ref", "Will" — unlisted = poor

### Enforcement Checklist (Spellcasting)
If the class casts spells:
- [ ] Add `castingAbility` and `castingType` to the class entry
- [ ] Add `spellsPerDay.ClassName` to `src/data/spellSlots.json` (levels 1-20, each level's spell slots)
- [ ] Add `castingAbility.ClassName` to `spellSlots.json` (e.g., "INT")
- [ ] Add `castingType.ClassName` to `spellSlots.json` ("prepared" or "spontaneous")
- [ ] If **spontaneous**, add `spellsKnown.ClassName` table to `spellSlots.json`
- [ ] If **partial caster** (casting starts at level 4+), add to `PARTIAL_CASTER_START` in `src/utils/spellEngine.js`
- [ ] If **arcane caster**, verify class is in `arcaneClasses` array in `getArcaneSpellFailure()` in `spellEngine.js`

### Enforcement Checklist (Combat)
- [ ] BAB progression matches PF1e: `"full"` = level, `"3/4"` = floor(level*3/4), `"1/2"` = floor(level/2)
- [ ] `goodSaves` accurately lists which saves use the good progression (+2 + level/2)
- [ ] Hit die (`hd`) is correct: d6/d8/d10/d12
- [ ] Skill points per level correct (before INT modifier)
- [ ] Proficiencies are accurate — `rulesEngine.js` checks these for penalties

### Enforcement Checklist (Class Features)
- [ ] Class features that grant **conditions or buffs** (e.g., Rage, Smite Evil) have matching entries in `conditionTracker.js` `PF1E_CONDITIONS` (Section 19)
- [ ] Class features that grant **bonus feats** — ensure those feats exist in `feats.json`
- [ ] Class features that grant **special attacks** (sneak attack, channel energy) — describe mechanics in `description` for AI DM enforcement
- [ ] Class features referenced by **feat prerequisites** — use exact name strings that `featPrereqs.js` can parse

### Integration Points
- `src/utils/rulesEngine.js` — saves, BAB, proficiency
- `src/utils/spellEngine.js` — spell slots, casting validation
- `src/components/LevelUpWizard.jsx` — level-up flow
- `src/components/CharacterSheet.jsx` — display
- `src/services/dmEngine.js` — AI references class abilities

---

## 5. Prestige Classes

**File:** `src/data/prestigeClasses.json`

### Schema
```json
{
  "name": "Prestige Class Name",
  "hd": 10,
  "bab": "full",
  "goodSaves": ["Fort", "Ref"],
  "skills": 4,
  "alignment": "Any",
  "castingType": null,
  "castingAbility": null,
  "prestige": true,
  "levels": 10,
  "description": "Class description",
  "requirements": "BAB +6, Point Blank Shot, Precise Shot, ability to cast 1st-level arcane spells",
  "classSkills": ["Perception", "Ride", "Stealth"],
  "proficiencies": { "weapons": ["All simple and martial weapons"], "armor": ["Light armor", "Medium armor", "Shields"] },
  "classFeatures": [
    { "level": 1, "name": "Feature Name", "description": "What it does" }
  ]
}
```

### Data Entry
1. Add entry to `src/data/prestigeClasses.json`
2. Same as base class plus: `prestige: true`, `levels` (max class levels), `requirements` (prerequisite string)

### Enforcement Checklist
- [ ] All **required feats** in `requirements` exist in `feats.json`
- [ ] All **required skills** in `requirements` exist in `skills.json`
- [ ] If prestige class **advances spellcasting**, note in classFeatures — currently AI-enforced, not mechanical
- [ ] If prestige class grants **unique abilities that act as conditions**, add to `conditionTracker.js` (Section 19)
- [ ] Same combat enforcement checklist as base classes (BAB, saves, HD, proficiencies)

### Integration Points
- `src/components/GMReferenceTab.jsx` — encyclopedia display
- `src/components/LevelUpWizard.jsx` — would check prerequisites for multiclassing

---

## 6. Class Abilities / Archetypes

**Files:**
- `src/data/archetypes.json` — archetype data
- `src/data/classAbilities.js` — structured mechanical data for class features
- `src/utils/classAbilityResolver.js` — resolution engine for class abilities

### Archetype Schema
```json
{
  "name": "ARCHETYPE NAME",
  "class": "Base Class Name",
  "source": "Source Abbreviation",
  "description": "What this archetype is about",
  "replacedFeatures": ["mutagen", "poison resistance"],
  "newFeatures": [
    { "name": "New Feature", "level": 1, "description": "What it does" }
  ]
}
```

### Class Ability Schema (classAbilities.js)
```javascript
{
  name: 'Ability Name',
  classes: ['Rogue', 'Ninja'],        // Which classes get this
  type: 'extra_damage|area_heal_or_damage|self_buff|passive|party_buff',
  trigger: 'flanking_or_denied_dex',   // When it activates (if active)
  action: 'standard|swift|free',       // Action cost (if active)
  scaling: {
    dicePerLevel: (level) => Math.ceil(level / 2),
    sides: 6,
  },
  modifiers: (level, abilityMod) => ({ attack: X, damage: X, ... }),
  usesPerDay: (level, abilityMod) => N, // If limited use
  minLevel: 1 | { ClassName: N },      // Level requirement
  restrictions: { ... },
}
```

### Data Entry
1. Add archetype to `src/data/archetypes.json`
2. Add mechanical data to `src/data/classAbilities.js`:
   - Define scaling formula, modifiers, action cost, uses/day
   - Add to `CLASS_ABILITIES` registry at bottom of file
3. Add resolver in `src/utils/classAbilityResolver.js`:
   - Create `resolveAbilityName()` function with dice rolling, targeting
   - Add case to `resolveClassAbility()` master switch
   - Export the resolver function

### Enforcement Checklist
- [ ] `class` matches an exact class name in `classes.json`
- [ ] `replacedFeatures` match exact `name` strings in the base class's `classFeatures`
- [ ] **Scaling formulas** match RAW (verify dice, level thresholds, caps)
- [ ] **Uses/day formulas** match RAW (verify ability modifier used, base count)
- [ ] **Save DCs** follow PF1e formula (10 + 1/2 level + ability mod)
- [ ] **Passive modifiers** added to `getPassiveClassModifiers()` in resolver
- [ ] **Active abilities** have resolver in `resolveClassAbility()` switch
- [ ] If ability grants **conditions/buffs**, create via `conditionTracker.js` or `activeEffectsTracker.js`
- [ ] If ability grants **spell-like abilities**, verify spells in `spells.json` and `spellEffects.js`
- [ ] Ability wired into `CombatTab.jsx` (player use) and/or `creatureAI.js` (enemy use)
- [ ] Daily use tracking: character object stores `{ abilityName: { used: N, max: N } }`

### Scripted Classes (Complete)

**CRB (11 classes — ALL features scripted):**
Barbarian (11), Bard (18), Cleric (8), Druid (14), Fighter (9), Monk (18), Paladin (15), Ranger (16), Rogue (13), Sorcerer (10 + 6 bloodlines), Wizard (10 + 9 schools)

**APG (6 classes):**
Alchemist (Bomb, Mutagen, Alchemy, Poison Use), Cavalier (Order, Mounted Bond, Charge), Inquisitor (Monster Lore, Judgment), Oracle (Curse, Mystery), Summoner (Eidolon, Summoning), Witch (Familiar, Hexes)

**ACG + Other (10 classes):**
Arcanist (Arcane Reservoir, Exploits), Bloodrager (Bloodrage, Bloodline), Brawler (Martial Flexibility, Unarmed), Hunter (Animal Companion, Animal Focus), Investigator (Inspiration, Talents), Shaman (Spirit, Hex, Spirit Animal), Skald (Raging Song), Slayer (Studied Target, Sneak Attack), Swashbuckler (Panache, Deeds, Weapon Training), Warpriest (Sacred Weapon, Blessings, Fervor)

### Adding a New Class — Step-by-Step Workflow

1. **Add class data** to `src/data/classes.json`:
   - `name`, `hitDie`, `bab` (full/3-4/half), `goodSaves`, `skillsPerLevel`, `classSkills`
   - `proficiencies` (weapons, armor)
   - `classFeatures[]` with `{ level, name, description }` for every feature at every level
   - `castingAbility` (if spellcaster)

2. **Add ability data** to `src/data/classAbilities.js`:
   - For EACH feature in `classFeatures`:
     - Create an exported constant (e.g., `export const NEWCLASS_ABILITY_NAME = { ... }`)
     - Set `name`, `classes`, `type`, `minLevel`, `description`
     - For active abilities: `action`, `usesPerDay`, `scaling`, `modifiers`, `saveDC`, `saveType`
     - For passive abilities: `modifiers`, `effect`
     - For resource pools: `poolSize`, `abilities` sub-object
   - Add ALL entries to `CLASS_ABILITIES` registry at bottom of file
   - Verify scaling formulas match the RAW source material

3. **Add resolvers** to `src/utils/classAbilityResolver.js`:
   - For active abilities: create `resolveAbilityName(character, context)` function
   - For passives: add to `getPassiveClassModifiers()` if they affect stats
   - Add case to `resolveClassAbility()` master switch
   - Add uses to `getDailyAbilityUses()` if limited
   - Add summary to `getClassAbilitiesContextForAI()`
   - Export all new resolver functions

4. **Wire into combat** (if combat-relevant):
   - `CombatTab.jsx` — add UI buttons for active abilities, auto-apply passives
   - `creatureAI.js` — add enemy AI logic for using the ability
   - Import new functions at top of each file

5. **Verify**:
   - `npm run build` passes clean
   - `getClassAbilitiesForLevel('NewClass', 20)` returns all expected abilities
   - `getDailyAbilityUses({ class: 'NewClass', level: 10, abilities: {...} })` returns correct limits
   - Passive modifiers appear in `getPassiveClassModifiers()` output
   - Each active ability resolves via `resolveClassAbility()`

### Integration Points
- `src/data/classAbilities.js` — all class ability data + CLASS_ABILITIES registry
- `src/utils/classAbilityResolver.js` — all resolvers + passive mod computation
- `src/components/CombatTab.jsx` — player ability buttons, sneak attack auto-check
- `src/services/creatureAI.js` — enemy class ability use
- `src/utils/rulesEngine.js` — `getCharacterModifiers()` merges passive class mods
- `src/components/GMReferenceTab.jsx` — encyclopedia display
- `src/services/dmEngine.js` — AI DM context includes class abilities

---

## 7. Spells

**File:** `src/data/spells.json`

### Schema
```json
{
  "name": "Spell Name",
  "school": "evocation",
  "subschool": "fire",
  "descriptor": "fire",
  "level": { "sorcerer": 3, "wizard": 3, "magus": 3 },
  "source": "CRB",
  "castingTime": "1 standard action",
  "components": "V, S, M (bat guano and sulfur)",
  "range": "long (400 ft. + 40 ft./level)",
  "target": "",
  "area": "20-ft.-radius spread",
  "duration": "instantaneous",
  "savingThrow": "Reflex half",
  "sr": true,
  "description": "Full spell description"
}
```

### Data Entry
1. Add entry to `src/data/spells.json`
2. Required: `name`, `school`, `level`, `castingTime`, `components`, `range`, `duration`, `savingThrow`, `sr`, `description`
3. Level: object mapping class names → spell levels
4. Schools: abjuration, conjuration, divination, enchantment, evocation, illusion, necromancy, transmutation, universal
5. Components: V (verbal), S (somatic), M (material), F (focus), DF (divine focus)
6. SR: boolean

### Enforcement Checklist — CRITICAL
Every new spell should go through ALL of these:
- [ ] **Spell effect data** → add structured entry to `src/data/spellEffects.js` (Section 18):
  - Damage spells: exact damage formula (dice, sides, perLevel, maxDice, damageType)
  - Healing spells: exact healing formula (dice, sides, bonusPerLevel, maxBonus)
  - Buff spells: exact modifiers (armorBonus, attack, saves, speedBonus, etc.) + duration
  - Debuff/Control spells: save type, condition applied, duration, savePerRound
- [ ] **Condition enforcement** — if spell inflicts a condition (blinded, paralyzed, etc.), verify condition exists in `conditionTracker.js` `PF1E_CONDITIONS` with correct modifiers (Section 19)
- [ ] **Component validation** — `spellEngine.js` `parseSpellComponents()` and `validateSpellComponents()` will auto-handle V/S/M parsing if the components string uses standard format
- [ ] **Spell resistance** — `sr` field (boolean) controls whether `resolveSpellCasting()` checks SR
- [ ] **Saving throw** — `savingThrow` field must use parseable format: "Will negates", "Fort half", "Ref partial", "none"
- [ ] **Duration** — must be parseable by `durationToRounds()` in `spellEffectResolver.js`: "instantaneous", "X rounds", "1 round/level", "1 min/level", "Xd4 rounds", "permanent"
- [ ] **Enemy AI** — if the spell fits an existing category, add keyword to `SPELL_CATEGORIES` in `monsterTactics.js` (damage/control/debuff/buff/healing/summon/utility)
- [ ] **Special damage formulas** — if the spell has a unique damage formula (like Magic Missile or Scorching Ray), add a `special` handler in `computeSpecialDamage()` in `spellEffectResolver.js`

### Integration Points
- `src/utils/spellEngine.js` — casting validation, component checks
- `src/data/spellEffects.js` — mechanical effect data
- `src/utils/spellEffectResolver.js` — resolves effects in combat
- `src/utils/activeEffectsTracker.js` — tracks ongoing durations
- `src/services/monsterTactics.js` — enemy AI spell selection
- `src/services/creatureAI.js` — enemy spell casting in combat
- `src/components/CombatTab.jsx` — player spell casting in combat
- `src/components/CharacterSheet.jsx` — out-of-combat casting
- `src/services/dmEngine.js` — AI narration

---

## 8. Feats

**File:** `src/data/feats.json`

### Schema
```json
{
  "name": "Feat Name",
  "type": "Combat",
  "category": "Combat",
  "prerequisites": "Dex 13, Dodge, base attack bonus +1",
  "benefit": "What the feat does",
  "normal": "Without this feat",
  "special": "Special rules",
  "source": "CRB"
}
```

### Data Entry
1. Add entry to `src/data/feats.json`
2. Required: `name`, `prerequisites`, `benefit`, `source`
3. Types: "General", "Combat", "Metamagic", "Item Creation", "Critical", "Teamwork", "Performance", "Style", "Grit", "Panache", "Story", "Mythic"

### Enforcement Checklist
- [ ] **Prerequisite string format** — `featPrereqs.js` parser recognizes these patterns:
  - Ability scores: "Str 13", "Dex 15", "Int 13"
  - BAB: "base attack bonus +6", "BAB +6"
  - Other feats: exact feat names, comma-separated
  - Class features: "sneak attack +3d6", "rage class feature"
  - Caster level: "caster level 5th"
  - Skills: "Acrobatics 5 ranks", "Knowledge (arcana) 3 ranks"
  - Class level: "fighter level 4th"
- [ ] **Prerequisite feats exist** — all feats referenced in prerequisites must exist in `feats.json`
- [ ] **Feat tree** — verify new feat appears correctly in the interactive feat tree with proper parent/child connections
- [ ] **Mechanical effects** — if feat modifies saves, attack, damage, AC, or skill checks:
  - Update `rulesEngine.js` if it has specific feat checks (like Great Fortitude, Iron Will)
  - Update `spellEngine.js` if it affects spellcasting (Spell Focus, Combat Casting)
  - Update `conditionTracker.js` if it creates a new combat state (Fighting Defensively already exists as an example)
- [ ] **Combat Feats** that modify attack sequences (Power Attack, Cleave, Vital Strike): document in benefit text for AI DM enforcement; consider adding mechanical checks to `CombatTab.jsx` attack handlers
- [ ] **Metamagic Feats** — note spell level adjustment in benefit text

### Integration Points
- `src/utils/featPrereqs.js` — prerequisite parsing and eligibility
- `src/components/FeatTree.jsx` — tree visualization
- `src/components/LevelUpWizard.jsx` — feat selection with eligibility
- `src/components/GMReferenceTab.jsx` — encyclopedia
- `src/utils/rulesEngine.js` — feat-based save/attack bonuses
- `src/utils/spellEngine.js` — Combat Casting, Spell Focus

---

## 9. Skills

**File:** `src/data/skills.json`

### Schema
```json
{
  "name": "Skill Name",
  "ability": "DEX",
  "untrained": true,
  "armorPenalty": true,
  "description": "What this skill covers",
  "check": "Details on checks",
  "action": "Standard action",
  "retry": "Yes",
  "special": "Special rules",
  "dcTable": [
    { "dc": 5, "task": "Easy task" },
    { "dc": 15, "task": "Moderate task" }
  ],
  "synergy": "Related skills",
  "classSkills": ["Rogue", "Bard", "Ranger"]
}
```

### Data Entry
1. Add entry to `src/data/skills.json`
2. Required: `name`, `ability`, `untrained`, `description`
3. Ability: "STR", "DEX", "CON", "INT", "WIS", "CHA"

### Enforcement Checklist
- [ ] **Class skill lists** — update `classSkills` arrays in `classes.json` for any class that should have this skill
- [ ] **Feat prerequisites** — if any feat requires ranks in this skill, ensure `featPrereqs.js` can parse it (skill name must match exactly)
- [ ] **Armor check penalty** — if `armorPenalty: true`, armor penalties apply to this skill
- [ ] **DC table** — include common DCs for AI DM reference

### Integration Points
- `src/components/LevelUpWizard.jsx` — skill rank allocation
- `src/components/CharacterSheet.jsx` — skill display
- `src/utils/featPrereqs.js` — skill rank prerequisite checking

---

## 10. Traits & Drawbacks

**File:** `src/data/traits.json`

### Schema
```json
{
  "name": "Trait Name",
  "type": "combat",
  "benefit": "+2 trait bonus on initiative checks.",
  "source": "APG"
}
```

### Data Entry
1. Add entry to `src/data/traits.json`
2. Required: `name`, `type`, `benefit`
3. Types: "combat", "magic", "social", "faith", "regional", "race", "campaign", "equipment", "drawback"

### Enforcement Checklist
- [ ] **Mechanical effects in benefit text** — include exact bonus values (+2, +1, etc.) so AI DM can enforce
- [ ] If trait modifies **initiative**, note "+X trait bonus on initiative checks"
- [ ] If trait modifies **saves**, note "+X trait bonus on [save type] saves"
- [ ] If trait modifies **skills**, note "+X trait bonus on [skill] checks" and whether it becomes a class skill
- [ ] **Drawbacks** — use `"type": "drawback"` and describe penalty clearly
- [ ] Traits are currently AI-enforced (text-based). If a trait has strong mechanical impact, consider adding it as an active effect in `activeEffectsTracker.js`

### Integration Points
- Character creation trait selection
- AI DM interprets trait text for mechanical enforcement

---

## 11. Monsters / Creatures

**File:** `src/data/monsters.json`

### Schema
```json
{
  "name": "Creature Name",
  "cr": 5, "xp": 1600,
  "type": "Magical Beast", "subtype": "",
  "alignment": "N", "size": "Large",
  "hp": 57, "ac": 17, "init": 6,
  "speed": "30 ft., fly 60 ft. (poor)",
  "str": 17, "dex": 15, "con": 13, "int": 2, "wis": 13, "cha": 8,
  "fort": 6, "ref": 7, "will": 3,
  "bab": 6, "cmb": 10, "cmd": 22,
  "atk": "2 claws +8 (1d6+3), bite +8 (1d8+3)",
  "dmg": "see attacks",
  "senses": "darkvision 60 ft., low-light vision, scent; Perception +12",
  "feats": "Flyby Attack, Improved Initiative",
  "skills": "Fly +5, Perception +12",
  "languages": "",
  "environment": "temperate hills",
  "special": "Pounce (Ex): Full attack after charge.",
  "resist": "", "immune": "", "sr": 0,
  "source": "Bestiary",
  "spells": []
}
```

### Data Entry
1. Add entry to `src/data/monsters.json`
2. Required: `name`, `cr`, `hp`, `ac`, `type`, `size`, `alignment`, all six ability scores, all three saves, `atk`
3. Attack string: "weapon +bonus (damage), weapon +bonus (damage)"
4. CR: numeric (0.5 for CR 1/2, 0.25 for CR 1/4)

### Enforcement Checklist
- [ ] **Attack parsing** — `creatureAI.js` parses the `atk` string. Verify format: "2 claws +8 (1d6+3), bite +8 (1d8+3)" — count + weapon + bonus + (damage)
- [ ] **Special abilities** — all abilities in `special` field:
  - Abilities that `monsterTactics.js` `detectAbilities()` should recognize: pounce, grab, trip, breath weapon, frightful presence, spell-like abilities, rend, constrict, swallow whole
  - New ability types may need detection patterns added to `monsterTactics.js`
- [ ] **Spellcasting creatures** — `spells` array format for `parseCreatureSpells()`:
  ```json
  "spells": [{ "spell_list": [
    { "level": 3, "dc": 16, "spells": ["fireball", "lightning bolt"] }
  ]}]
  ```
  - All spell names must match entries in `spells.json`
  - Spells should have entries in `spellEffects.js` for mechanical resolution
- [ ] **Spell resistance** — `sr` field (numeric or 0). Enemy SR checked by `resolveSpellCasting()`
- [ ] **Resistances/immunities** — text in `resist` and `immune` fields. Currently AI-enforced.
- [ ] **Condition immunities** — note in `special` or `immune` for AI DM to enforce
- [ ] **Combat maneuvers** — `cmb` and `cmd` used by grab/trip mechanics in `monsterTactics.js`

### Integration Points
- `src/services/creatureAI.js` — AI combat decisions
- `src/services/monsterTactics.js` — tactical AI, ability detection, spell selection
- `src/components/CombatTab.jsx` — combat display
- `src/services/dmEngine.js` — narrative descriptions

---

## 12. NPCs

**File:** `src/data/npcs.json`

### Schema
```json
{
  "name": "NPC Name",
  "cr": 3,
  "class": "Fighter 4",
  "race": "Human",
  "alignment": "LN",
  "hp": 34, "ac": 18,
  "base_atk": 4,
  "fort": 6, "ref": 2, "will": 1,
  "str": 16, "dex": 13, "con": 14, "int": 10, "wis": 10, "cha": 8
}
```

### Data Entry
1. Add to `npcs.json` for generic NPCs, or campaign file for story NPCs
2. Required: `name`, `cr`, `class`, `race`, `hp`, `ac`, ability scores

### Enforcement Checklist
- [ ] Same as Monsters for combat purposes
- [ ] `class` field format: "ClassName Level" or "Class1 X/Class2 Y" for multiclass
- [ ] If NPC casts spells, add `spells` array (same format as monsters)
- [ ] If NPC has special equipment, note in a `gear` or `equipment` field
- [ ] **Per project memory:** NPCs should be described by appearance, not named, until the party learns their name through interaction

### Integration Points
- Same combat integration as monsters
- `src/services/dmEngine.js` — roleplay and dialogue

---

## 13. Equipment & Magic Items

### Standard Equipment: `src/data/equipment.json`
```json
{
  "name": "Item Name",
  "category": "weapon",
  "price": "315 gp", "priceGP": 315,
  "weight": "4 lbs.",
  "source": "UE",
  "description": "Full description",
  "aura": "", "cl": "",
  "slot": "none"
}
```

### Magic Items: `src/data/magicItems.json`
```json
{
  "name": "+1 Longsword",
  "price": "2,315 gp",
  "aura": "faint evocation", "cl": 3,
  "slot": "none",
  "description": "Enhancement bonus description",
  "type": "weapon"
}
```

### Enforcement Checklist
- [ ] **Weapons** — if new weapon type, consider adding to `weapons.json` for simplified stats
- [ ] **Armor** — if new armor, add to armor spell failure table in `spellEngine.js` `getArmorSpellFailure()` and `isLightArmor()`
- [ ] **Shields** — if new shield, add to `getShieldSpellFailure()` in `spellEngine.js`
- [ ] **Proficiency** — ensure weapon/armor is covered by class proficiency lists. `rulesEngine.js` `checkWeaponProficiency()` / `checkArmorProficiency()` must recognize it
- [ ] **`priceGP`** — numeric gold value required for shop inventory calculations
- [ ] **Magic item effects** — describe in text for AI enforcement. If item grants a condition (e.g., Cloak of Displacement = blur), reference the condition name
- [ ] **Slot** — correct body slot for wondrous items. Prevents equipping multiple items in same slot.

### Integration Points
- `src/data/settlements.json` — shop inventory generation
- `src/components/CharacterSheet.jsx` — equipped items
- `src/utils/spellEngine.js` — armor/shield spell failure
- `src/utils/rulesEngine.js` — proficiency checks

---

## 14. Locations

**File:** Campaign location file (e.g., `src/data/sandpoint.json`)

### Schema
```json
{
  "name": "Location Name",
  "title": "Subtitle",
  "population": 1240,
  "government": "Mayor",
  "alignment": "NG",
  "description": "Overview",
  "notable_features": ["Feature 1", "Feature 2"],
  "locations": [
    {
      "id": 1, "name": "Building Name", "type": "temple",
      "description": "Description",
      "npcs": ["NPC Name"],
      "services": ["Healing"],
      "quests": ["Quest hook"]
    }
  ]
}
```

### Enforcement Checklist
- [ ] NPCs referenced exist in `npcs.json` or campaign file
- [ ] Services listed are mechanically supported (healing = HP restoration, shopping = links to settlement merchants)
- [ ] Quest hooks give AI DM enough context to introduce naturally
- [ ] Location `id` values are unique within the file
- [ ] If location has a map, create matching map data (Section 17)

---

## 15. Settlements

**File:** `src/data/settlements.json`

### Schema
```json
{
  "settlements": {
    "settlement_id": {
      "name": "Name", "type": "smallTown", "population": 1240, "baseValue": 1300,
      "purchaseLimit": 5000, "spellcasting": 4,
      "qualities": ["prosperous"],
      "merchants": [
        { "id": "unique", "name": "Shop Name", "shopType": "blacksmith", "npc": "NPC Name", "specialties": ["masterwork weapons"], "priceModifier": 1.0 }
      ]
    }
  }
}
```

### Enforcement Checklist
- [ ] Settlement type matches `settlementTypes` definitions (thorp/hamlet/village/smallTown/largeTown/smallCity/largeCity/metropolis)
- [ ] `baseValue` and `purchaseLimit` match PF1e settlement rules for that type
- [ ] `spellcasting` = max spell level available for purchase
- [ ] `shopType` matches `shopTypes` keys in settlements.json
- [ ] Merchant `npc` names should have NPC entries for roleplay
- [ ] `priceModifier` adjusts item prices (1.0 = standard, 1.1 = 10% markup, etc.)

---

## 16. Dungeons / Encounters

**File:** Campaign encounter file (e.g., `src/data/rotrl-encounters.json`)

### Schema
```json
{
  "encounters": [{
    "id": "unique_id", "name": "Encounter Name",
    "location": "Where", "cr": 4, "xpReward": 1200,
    "description": "Read-aloud text",
    "enemies": [
      { "name": "Goblin Warrior", "count": 4, "cr": 0.33 }
    ],
    "tactics": "AI DM behavior guidance",
    "treasure": "Loot",
    "development": "What happens after",
    "terrain": "Battlefield features",
    "traps": [
      { "name": "Pit Trap", "cr": 1, "perception": 20, "disable": 20, "effect": "2d6 fall damage", "reset": "manual" }
    ]
  }]
}
```

### Enforcement Checklist
- [ ] Enemy `name` values match entries in `monsters.json` or `npcs.json`
- [ ] Total encounter CR is correctly calculated from enemy CRs
- [ ] XP reward matches PF1e standard for that CR
- [ ] If enemies have spells, those spells have entries in `spellEffects.js`
- [ ] Trap DCs use PF1e standard ranges (DC 20 = moderate, DC 25 = difficult, DC 30 = very hard)
- [ ] Tactics text gives `creatureAI.js` useful behavioral guidance

---

## 17. Maps

**File:** Map data file (e.g., `src/data/sandpointMap.json`)

### Schema
```json
{
  "mapId": "unique_id", "name": "Map Name",
  "imageUrl": "path/to/image",
  "width": 1000, "height": 800,
  "pins": [
    { "id": 1, "x": 450, "y": 320, "label": "Location", "description": "Brief", "locationRef": "location_id" }
  ],
  "hexGrid": { "enabled": false, "hexSize": 30, "terrain": "encoded_string" }
}
```

### Enforcement Checklist
- [ ] Map image placed in `public/` folder or accessible URL
- [ ] Pin `locationRef` values match location IDs from settlement/campaign data
- [ ] Pin coordinates accurately placed on the map image
- [ ] If hex grid enabled, terrain encoding follows `HexGridOverlay.jsx` format

---

## 18. Spell Effects (Mechanical)

**File:** `src/data/spellEffects.js`

This is the enforcement layer for spells. Every spell in `spells.json` should ideally have a matching entry here. Spells without entries fall back to AI narration with no mechanical enforcement.

### Damage Spell
```javascript
'Spell Name': {
  type: 'damage', damageType: 'fire',
  damage: { dice: 1, sides: 6, perLevel: true, maxDice: 10 },
  range: 'long', target: 'area',
  save: 'Ref half', sr: true,
  onFailedSave: { condition: 'stunned', duration: '1 round' },
}
```

### Healing Spell
```javascript
'Spell Name': {
  type: 'healing',
  healing: { dice: 2, sides: 8, bonusPerLevel: 1, maxBonus: 10 },
  range: 'touch', target: 'single',
  removesConditions: ['sickened', 'nauseated'],
}
```

### Buff Spell
```javascript
'Spell Name': {
  type: 'buff',
  condition: 'haste',  // or null if not a PF1E_CONDITIONS entry
  modifiers: { attack: 1, ac: 1, speedBonus: 30 },
  modifierScaling: { attack: { base: 1, perLevels: 3, startAt: 1, max: 3 } },
  duration: '1 round/level',
  range: 'close', target: 'allies',
}
```

### Debuff/Control Spell
```javascript
'Spell Name': {
  type: 'control',
  save: 'Will negates', sr: true,
  condition: 'paralyzed',
  duration: '1 round/level',
  savePerRound: true,
  onSave: { condition: 'shaken', duration: '1 round' },
}
```

### Enforcement Checklist
- [ ] Key name **exactly matches** spell name in `spells.json`
- [ ] `condition` value matches a key in `PF1E_CONDITIONS` (Section 19)
- [ ] `save` string is parseable: "Will negates", "Fort half", "Ref partial", "none"
- [ ] `duration` string is parseable by `durationToRounds()`: "instantaneous", "X rounds", "1 round/level", "1 min/level", "XdY rounds", "permanent"
- [ ] Damage `perLevel: true` means dice = casterLevel (capped at `maxDice`)
- [ ] Healing `bonusPerLevel` means +CL bonus (capped at `maxBonus`)
- [ ] If spell needs a **unique damage formula**, add handler to `computeSpecialDamage()` in `spellEffectResolver.js`
- [ ] If spell targets **enemies**, verify the enemy AI keyword is in `SPELL_CATEGORIES` in `monsterTactics.js`
- [ ] Test: cast spell in combat, verify damage/healing/condition/duration applies correctly

---

## 19. Conditions

**File:** `src/utils/conditionTracker.js` — `PF1E_CONDITIONS` object

This is the core mechanical enforcement layer for all status effects in the game. Every condition that can be applied to a character or enemy must be defined here with its exact mechanical modifiers.

### Schema
```javascript
condition_key: {
  name: 'Display Name',
  severity: 'severe',       // 'severe', 'moderate', 'minor', 'buff'
  description: 'Full PF1e rules text',
  modifiers: {
    // ── Numeric modifiers (aggregated by aggregateConditionModifiers) ──
    ac: -2,                  // AC bonus/penalty
    attack: -4,              // Attack roll bonus/penalty
    damage: -2,              // Damage bonus/penalty
    initiative: -4,          // Initiative modifier
    cmb: -2,                 // Combat maneuver bonus
    naturalArmor: 2,         // Natural armor bonus
    missChance: 50,          // Miss chance percentage (0-100)
    speed: 0.5,              // Speed multiplier (0.5 = half speed)
    speedBonus: 30,          // Flat speed addition

    // ── Save modifiers ──
    saves: { all: -2 },      // Or specific: { Fort: 2, Ref: 1, Will: -2, fear: 1 }

    // ── Skill modifiers ──
    skills: { all: -2 },     // Or specific: { Perception: -4, Stealth: 20 }

    // ── Ability score modifiers ──
    strBonus: 4,             // Enhancement bonus to STR
    dexBonus: 4,             // Enhancement bonus to DEX
    conBonus: 4,             // Enhancement bonus to CON
    strPenalty: -6,          // Penalty to STR
    dexPenalty: -6,          // Penalty to DEX
    strOverride: 0,          // Override STR to this value (paralyzed)
    dexOverride: 0,          // Override DEX to this value (paralyzed)

    // ── Boolean flags ──
    cannotAct: true,         // Cannot take any actions
    cannotAttack: true,      // Cannot make attacks
    cannotCast: true,        // Cannot cast spells
    cannotMove: true,        // Cannot move
    cannotCharge: true,      // Cannot charge
    cannotRun: true,         // Cannot run
    singleAction: true,      // Can only take one action per turn
    moveOnly: true,          // Can only take move actions
    loseDexToAC: true,       // Loses DEX bonus to AC
    mustFlee: true,          // Must flee from source
    extraAttack: true,       // Gets one extra attack
    smiteActive: true,       // Smite evil active
    dropsHeld: true,         // Drops held items
    unconscious: true,       // Is unconscious
    actsRandomly: true,      // Acts randomly (confused)
    cannotConcentrate: true, // Cannot use concentration skills

    // ── Per-round effects ──
    hpLossPerRound: 1,       // Loses HP each round (dying)
    hpRegenPerRound: 5,      // Gains HP each round (regeneration)

    // ── Spell-specific ──
    spellFailure: 20,        // Additional arcane spell failure %
    concentrationDC: 15,     // DC for concentration checks to cast
  },
}
```

### Workflow for Adding a New Condition
1. **Add the condition definition** to `PF1E_CONDITIONS` in `conditionTracker.js`
2. **Choose the key** — lowercase, no spaces (e.g., `blinded`, `haste`, `fighting_defensively`)
3. **Set severity** — determines display color/priority:
   - `"severe"` — cannot act or major incapacitation (paralyzed, stunned, dead)
   - `"moderate"` — significant penalty (entangled, frightened, grappled)
   - `"minor"` — small penalty (shaken, fatigued, dazzled)
   - `"buff"` — beneficial effect (haste, bless, rage)
4. **Define ALL mechanical modifiers** — this is the critical step. Every PF1e mechanical effect must be represented:
   - Check the PF1e SRD for the complete condition definition
   - Include ALL numeric modifiers (attack, AC, saves, skills, speed)
   - Include ALL boolean flags (cannotAct, cannotCast, loseDexToAC, etc.)
   - Include ability score changes (bonuses, penalties, overrides)

### Enforcement Checklist — CRITICAL
After adding the condition definition:
- [ ] **aggregateConditionModifiers()** — verify it handles every modifier key you used. If you added a NEW modifier key that doesn't exist yet:
  - Add it to the `result` object initialization in `aggregateConditionModifiers()`
  - Add aggregation logic in the loop body
  - This is the function that ALL combat systems read from
- [ ] **creatureAI.js** — if the condition affects enemy behavior:
  - `cannotAct` / `cannotCast` / `cannotAttack` → already checked in `executeEnemyTurn()`
  - `cannotMove` → already checked in movement decisions
  - `mustFlee` → already handled in morale system
  - New behavioral flags may need new checks in the enemy turn logic
- [ ] **CombatTab.jsx** — the condition will auto-display if it has `name` and `roundsRemaining`. Verify:
  - Condition tags show in party status and enemy status
  - Condition ticks at round start via `tickConditions()`
  - Duration decrements correctly
- [ ] **CharacterSheet.jsx** — conditions show in character sheet condition list. `aggregateConditionModifiers()` applies penalties/bonuses to displayed stats.
- [ ] **spellEngine.js** — if condition blocks spellcasting:
  - `cannotCast: true` → blocks in `resolveSpellCasting()` step 2
  - `cannotAct: true` → blocks in step 2
  - Specific component blocks (silenced blocks verbal) → checked in `validateSpellComponents()`
- [ ] **spellEffects.js** — if a spell applies this condition, verify the spell's `condition` field matches your key name exactly
- [ ] **spellEffectResolver.js** — `resolveDebuffSpell()` calls `createCondition()` with the condition key. Verify it creates correctly.
- [ ] **dmEngine.js** — `getConditionContextForAI()` auto-summarizes conditions for the AI DM. If new modifier flags need to appear, add them to that function.
- [ ] **rulesEngine.js** — if condition affects saves, attacks, or AC, verify `computeSave()` and other functions read condition modifiers correctly

### Quick Reference: Existing Modifier Keys and Where They're Consumed

| Modifier Key | Consumed By |
|---|---|
| `attack` | `creatureAI.js` resolveAttack(), CombatTab attack handlers |
| `damage` | `creatureAI.js` resolveAttack() |
| `ac` | `creatureAI.js` target selection, AI DM context |
| `saves.all/Fort/Ref/Will` | `rulesEngine.js` computeSave() |
| `cannotAct` | `creatureAI.js`, `spellEngine.js`, `CombatTab.jsx` |
| `cannotCast` | `spellEngine.js` resolveSpellCasting(), `creatureAI.js` |
| `cannotAttack` | `creatureAI.js` executeEnemyTurn() |
| `cannotMove` | `creatureAI.js` movement decisions |
| `loseDexToAC` | `creatureAI.js` resolveAttack() |
| `missChance` | `creatureAI.js` resolveAttack() |
| `mustFlee` | `creatureAI.js` morale system |
| `extraAttack` | `creatureAI.js` full attack counting |
| `speed` / `speedBonus` | AI DM context, movement calculations |
| `strBonus/dexBonus/conBonus` | `aggregateConditionModifiers()` → character stat display |
| `hpLossPerRound` | `conditionTracker.js` getPerRoundHPChange() |
| `concentration` / `concentrationDC` | `spellEngine.js` concentration checks |
| `spellFailure` | `spellEngine.js` arcane failure checks |

---

## Source Book Abbreviations

| Code | Full Name |
|------|-----------|
| CRB | Core Rulebook |
| APG | Advanced Player's Guide |
| UM | Ultimate Magic |
| UC | Ultimate Combat |
| UE | Ultimate Equipment |
| UI | Ultimate Intrigue |
| ACG | Advanced Class Guide |
| AG | Adventurer's Guide |
| ARG | Advanced Race Guide |
| B1-B6 | Bestiary 1-6 |
| RotRL | Rise of the Runelords |

---

## General Validation Steps

After adding any content from a sourcebook:

### Build Verification
1. `npm run build` — no compilation errors
2. Browser console — no runtime errors when viewing new content

### Mechanical Verification
3. **Spell test** — cast every new spell in combat. Verify: damage dice match formula, saving throw fires, condition applies with correct duration, duration ticks down each round, effect expires correctly
4. **Condition test** — apply every new condition manually. Verify: modifier tags display, attack/AC/save penalties apply, boolean flags block actions, condition expires after duration
5. **Character test** — create character with new class/race/feats. Verify: ability scores, saves, BAB, HP, skill points, spell slots all compute correctly
6. **Feat test** — view feat tree. Verify: new feats appear with correct prerequisite connections, eligibility checking works during level-up
7. **Combat test** — fight new monsters. Verify: attacks parse correctly, special abilities trigger, spells resolve mechanically, AI makes reasonable tactical decisions
8. **AI test** — explore new locations, interact with NPCs. Verify: AI DM narrates accurately using new content

### Cross-Reference Verification
9. Spell names in monster `spells` arrays match `spells.json` entries
10. Spell condition effects match `PF1E_CONDITIONS` keys
11. Feat prerequisites reference existing feats/skills
12. NPC names in locations match NPC data entries
13. Equipment in NPC/monster loadouts exists in equipment files
