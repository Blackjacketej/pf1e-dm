import db from './database';
import racesData from '../data/races.json';
import classesData from '../data/classes.json';
import monstersData from '../data/monsters.json';
import weaponsData from '../data/weapons.json';
import equipmentData from '../data/equipment.json';
import spellsData from '../data/spells.json';
import featsData from '../data/feats.json';
import npcsData from '../data/npcs.json';
import gearData from '../data/gear.json';
import magicItemsData from '../data/magicItems.json';
import conditionsData from '../data/conditions.json';
import traitsData from '../data/traits.json';
import campaignRotrl from '../data/campaign-rotrl.json';
import archetypesData from '../data/archetypes.json';
import skillsRefData from '../data/skills.json';
import gameRulesData from '../data/gameRules.json';
import rotrlEncountersData from '../data/rotrl-encounters.json';

// Expected counts for auto-upgrade detection
const EXPECTED = {
  monsters: 1300,
  spells: 1000,
  feats: 800,
  races: 20,
  classes: 20,
};

export async function seedDatabase() {
  const monsterCount = await db.monsters.count();

  // Check for upgrade opportunities
  if (monsterCount > 0) {
    let upgraded = false;

    // Auto-upgrade monsters (re-seed if count doesn't match source data)
    if (monsterCount !== monstersData.length) {
      console.log(`[DB] Upgrading monsters: ${monsterCount} → ${monstersData.length}`);
      await db.monsters.clear();
      await db.monsters.bulkAdd(monstersData);
      upgraded = true;
    }

    // Auto-upgrade spells (we went from 319 to 1315)
    const spellCount = await db.spells.count();
    if (spellCount < EXPECTED.spells) {
      console.log(`[DB] Upgrading spells: ${spellCount} → ${spellsData.length}`);
      await db.spells.clear();
      await db.spells.bulkAdd(spellsData);
      upgraded = true;
    }

    // Auto-upgrade feats (we went from ~35 to 903)
    const featCount = await db.feats.count();
    if (featCount < EXPECTED.feats) {
      console.log(`[DB] Upgrading feats: ${featCount} → ${featsData.length}`);
      await db.feats.clear();
      await db.feats.bulkAdd(featsData);
      upgraded = true;
    }

    // Auto-upgrade races
    const raceCount = await db.races.count();
    if (raceCount < EXPECTED.races) {
      console.log(`[DB] Upgrading races: ${raceCount} → ${racesData.length}`);
      await db.races.clear();
      await db.races.bulkPut(racesData);
      upgraded = true;
    }

    // Auto-upgrade classes
    const classCount = await db.classes.count();
    if (classCount < EXPECTED.classes) {
      console.log(`[DB] Upgrading classes: ${classCount} → ${classesData.length}`);
      await db.classes.clear();
      await db.classes.bulkPut(classesData);
      upgraded = true;
    }

    // Auto-upgrade archetypes
    const archetypeCount = await db.archetypes.count().catch(() => 0);
    if (archetypeCount < 300 && archetypesData.length > 0) {
      console.log(`[DB] Upgrading archetypes: ${archetypeCount} → ${archetypesData.length}`);
      await db.archetypes.clear();
      await db.archetypes.bulkAdd(archetypesData);
      upgraded = true;
    }

    // Auto-upgrade skills reference
    const skillsRefCount = await db.skillsRef.count().catch(() => 0);
    if (skillsRefCount < 30 && skillsRefData.length > 0) {
      console.log(`[DB] Upgrading skills reference: ${skillsRefCount} → ${skillsRefData.length}`);
      await db.skillsRef.clear();
      await db.skillsRef.bulkAdd(skillsRefData);
      upgraded = true;
    }

    // Always ensure campaign data is seeded
    const campaignCount = await db.campaignData.count();
    if (campaignCount === 0) {
      console.log('[DB] Seeding campaign data...');
      await db.campaignData.put(campaignRotrl);
    }

    if (upgraded) {
      console.log('[DB] Upgrade complete.');
    }

    // If all counts already meet expectations, we're done
    if (!upgraded && monsterCount >= EXPECTED.monsters) {
      return;
    }
  }

  // Fresh seed - no data exists
  if (monsterCount === 0) {
    console.log('[DB] Seeding Pathfinder database...');
    await db.transaction('rw', [db.races, db.classes, db.monsters, db.weapons, db.armor, db.shields, db.spells, db.feats, db.traps, db.treasure, db.locations, db.npcs, db.campaignData, db.archetypes, db.skillsRef], async () => {
      await db.races.bulkPut(racesData);
      await db.classes.bulkPut(classesData);
      await db.monsters.bulkAdd(monstersData);
      await db.weapons.bulkAdd(weaponsData);
      await db.armor.bulkAdd(equipmentData.armor);
      await db.shields.bulkAdd(equipmentData.shields);
      await db.spells.bulkAdd(spellsData);
      await db.feats.bulkAdd(featsData);

      await db.traps.bulkAdd([
        {name:"Pit Trap",cr:1,perception:20,disable:20,effect:"10ft pit, 1d6 falling damage",save:"Reflex DC 20"},
        {name:"Poisoned Dart Trap",cr:1,perception:20,disable:20,effect:"+10 attack, 1d3 + poison",save:"Fort DC 13"},
        {name:"Swinging Blade Trap",cr:2,perception:22,disable:22,effect:"+10 attack, 2d6 slashing",save:"Reflex DC 18"},
        {name:"Burning Hands Trap",cr:3,perception:26,disable:26,effect:"2d4 fire in 15ft cone",save:"Reflex DC 11 half"},
        {name:"Falling Block Trap",cr:2,perception:20,disable:20,effect:"+10 attack, 2d6 bludgeoning",save:"Reflex DC 15"},
        {name:"Spiked Pit Trap",cr:3,perception:21,disable:20,effect:"20ft pit + spikes",save:"Reflex DC 20"},
        {name:"Sleep Gas Trap",cr:2,perception:22,disable:22,effect:"10ft radius, sleep 1d4 rounds",save:"Will DC 14"},
        {name:"Lightning Bolt Trap",cr:4,perception:28,disable:28,effect:"5d6 electricity in line",save:"Reflex DC 14 half"},
        {name:"Acid Spray Trap",cr:5,perception:25,disable:25,effect:"4d6 acid in 30ft cone",save:"Reflex DC 17 half"},
        {name:"Symbol of Pain Trap",cr:6,perception:30,disable:30,effect:"Pain effect, -4 on attacks/checks/saves",save:"Fort DC 17"},
        {name:"Fusillade of Darts",cr:5,perception:25,disable:25,effect:"1d4+1 darts, +10 attack, 1d4+1 each",save:"None"},
        {name:"Crushing Wall Trap",cr:10,perception:20,disable:22,effect:"16d6 bludgeoning",save:"Reflex DC 20 half"},
      ]);

      await db.treasure.bulkAdd([
        {name:"Potion of Cure Light Wounds",type:"potion",value:"50 gp",effect:"Heals 1d8+1 HP"},
        {name:"Potion of Bull's Strength",type:"potion",value:"300 gp",effect:"+4 STR for 3 min"},
        {name:"Potion of Cat's Grace",type:"potion",value:"300 gp",effect:"+4 DEX for 3 min"},
        {name:"Potion of Bear's Endurance",type:"potion",value:"300 gp",effect:"+4 CON for 3 min"},
        {name:"Potion of Cure Moderate Wounds",type:"potion",value:"300 gp",effect:"Heals 2d8+3 HP"},
        {name:"Potion of Invisibility",type:"potion",value:"300 gp",effect:"Invisible for 3 minutes"},
        {name:"Potion of Fly",type:"potion",value:"750 gp",effect:"Fly 60ft for 5 min"},
        {name:"Scroll of Magic Missile",type:"scroll",value:"25 gp",effect:"1d4+1 force damage"},
        {name:"Scroll of Fireball",type:"scroll",value:"375 gp",effect:"5d6 fire damage"},
        {name:"Scroll of Cure Serious Wounds",type:"scroll",value:"375 gp",effect:"Heals 3d8+5 HP"},
        {name:"Scroll of Haste",type:"scroll",value:"375 gp",effect:"+1 attack, +1 AC, +30ft speed"},
        {name:"Masterwork Longsword",type:"weapon",value:"315 gp",effect:"+1 to attack rolls"},
        {name:"Masterwork Composite Longbow",type:"weapon",value:"400 gp",effect:"+1 to attack rolls"},
        {name:"+1 Longsword",type:"weapon",value:"2315 gp",effect:"+1 attack and damage"},
        {name:"+1 Chain Shirt",type:"armor",value:"1250 gp",effect:"+5 AC total"},
        {name:"+1 Breastplate",type:"armor",value:"1350 gp",effect:"+7 AC total"},
        {name:"Cloak of Resistance +1",type:"wondrous",value:"1000 gp",effect:"+1 all saves"},
        {name:"Cloak of Resistance +2",type:"wondrous",value:"4000 gp",effect:"+2 all saves"},
        {name:"Ring of Protection +1",type:"ring",value:"2000 gp",effect:"+1 deflection AC"},
        {name:"Amulet of Natural Armor +1",type:"wondrous",value:"2000 gp",effect:"+1 natural armor AC"},
        {name:"Headband of Vast Intelligence +2",type:"wondrous",value:"4000 gp",effect:"+2 INT"},
        {name:"Belt of Giant Strength +2",type:"wondrous",value:"4000 gp",effect:"+2 STR"},
        {name:"Wand of CLW (50 charges)",type:"wand",value:"750 gp",effect:"Heals 1d8+1 per charge"},
        {name:"Wand of Magic Missile (50 charges)",type:"wand",value:"750 gp",effect:"1d4+1 force per charge"},
        {name:"Bag of Holding (Type I)",type:"wondrous",value:"2500 gp",effect:"Holds 250 lbs"},
        {name:"Boots of Speed",type:"wondrous",value:"12000 gp",effect:"Haste 10 rounds/day"},
        {name:"Handy Haversack",type:"wondrous",value:"2000 gp",effect:"Move action to retrieve any item"},
        {name:"Pearl of Power (1st)",type:"wondrous",value:"1000 gp",effect:"Recall one 1st-level spell/day"},
      ]);

      await db.locations.bulkAdd([
        {name:"The Whispering Caverns",terrain:"underground",desc:"Damp stone walls echo with unsettling whispers. Phosphorescent fungi provide dim light."},
        {name:"The Blighted Forest",terrain:"forest",desc:"Twisted trees with blackened bark. The ground is soft with rotting leaves and an unnatural silence."},
        {name:"The Ruins of Thornkeep",terrain:"ruins",desc:"Crumbling stone walls and collapsed archways. Vines cover ancient carvings."},
        {name:"The Crimson Mines",terrain:"underground",desc:"Narrow tunnels of red-veined stone. Rusty mine cart tracks lead into darkness."},
        {name:"The Sunken Temple",terrain:"aquatic",desc:"Half-submerged ancient temple. Algae-covered steps lead to flooded chambers."},
        {name:"The Goblin Warrens",terrain:"underground",desc:"A maze of crude tunnels in soft earth. The stench of refuse and cooking fires."},
        {name:"The Haunted Manor",terrain:"interior",desc:"A decrepit mansion in perpetual gloom. Dusty portraits and moth-eaten sheets."},
        {name:"The Dragon's Spine Mountains",terrain:"mountain",desc:"Treacherous mountain pass between jagged peaks. Icy winds and loose scree."},
        {name:"The Fetid Swamp",terrain:"swamp",desc:"Thick mist on stagnant pools. Gnarled mangrove roots and unseen splashing."},
        {name:"The Wizard's Tower",terrain:"interior",desc:"Spiraling stone tower with arcane apparatus. Glowing runes and dusty tomes."},
        {name:"The Thieves' Den",terrain:"underground",desc:"Hidden cellar beneath a burned-out warehouse. Crates and stolen goods stacked high."},
        {name:"The Crypt of the Fallen Knight",terrain:"underground",desc:"Ancient burial chambers with marble sarcophagi. Faded heraldry on crumbling walls."},
        {name:"The Fey Glade",terrain:"forest",desc:"A clearing bathed in eternal twilight. Mushroom rings and will-o'-wisps dance."},
        {name:"The Abandoned Mill",terrain:"interior",desc:"Creaking water wheel and rotting grain. Something rustles in the shadows above."},
        {name:"The Coastal Cliffs",terrain:"coast",desc:"Salt-sprayed cliff faces with nesting seabirds. Hidden sea caves at the base."},
      ]);

      // Seed NPCs
      if (npcsData && npcsData.length > 0) {
        await db.npcs.bulkAdd(npcsData);
      }

      // Seed archetypes
      if (archetypesData && archetypesData.length > 0) {
        await db.archetypes.bulkAdd(archetypesData);
      }

      // Seed skills reference
      if (skillsRefData && skillsRefData.length > 0) {
        await db.skillsRef.bulkAdd(skillsRefData);
      }

      // Seed campaign data
      await db.campaignData.put(campaignRotrl);
    });
    console.log('[DB] Seed complete.');
  }
}
