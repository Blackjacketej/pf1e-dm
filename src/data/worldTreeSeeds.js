/**
 * worldTreeSeeds.js — Canonical tree seeds per campaign setting.
 *
 * When a campaign is created (or migrated) without a world tree, we seed one
 * that matches the campaign's canonical geography. This gives the operator a
 * populated breadcrumb out of the box ("Golarion › Varisia › Sandpoint
 * Hinterlands › Sandpoint") and lets the travel picker work immediately.
 *
 * The seeds are intentionally shallow — just enough to orient the party. The
 * operator fills in buildings, rooms, and sub-locations as they're played.
 *
 * Usage:
 *   const tree = buildSeedTree('pf1e');
 *   // adventure.worldTree = tree;
 *
 * Extending: add a new key under SEEDS (e.g. 'dnd5e', 'homebrew', 'root') with
 * the same shape. If no matching seed is found, a generic single-node 'World'
 * tree is produced.
 */

import { NODE_KINDS, createChildNode, createTree } from '../services/worldTree';

// ───────────────────────────────────────────────────────────── PF1e / Golarion

const GOLARION_SEED = {
  root: {
    name: 'Golarion',
    kind: NODE_KINDS.WORLD,
    desc: 'The world of Pathfinder — a planet of many continents, kingdoms, and mysteries. The Inner Sea region and Avistan dominate most campaigns.',
  },
  children: [
    {
      name: 'Avistan',
      kind: NODE_KINDS.CONTINENT,
      desc: 'The northern continent of the Inner Sea region, home to most canonical Pathfinder campaigns.',
      children: [
        {
          name: 'Varisia',
          kind: NODE_KINDS.COUNTRY,
          desc: 'A frontier land of sprawling wilderness, ancient Thassilonian ruins, coastal towns, and proud native Shoanti and Varisian peoples. Setting of Rise of the Runelords.',
          // Task #85 — overland travel across Varisia uses the regional
          // 12-mi hex map (matches HEX_CONFIGS.varisia_region). Descendants
          // that declare their own hexSizeMiles (e.g. Sandpoint Hinterlands
          // at 1mi) override this via getHexSizeMilesForNode ancestor walk.
          hexSizeMiles: 12,
          children: [
            {
              name: 'Sandpoint Hinterlands',
              kind: NODE_KINDS.REGION,
              desc: 'Rolling farmland, forested hills, and rugged coast surrounding the town of Sandpoint. Bordered by the Varisian Gulf to the west, the Mushfens to the southeast, and the Lost Coast to the north.',
              // Task #85 — local detail map uses 1-mi hexes (matches
              // HEX_CONFIGS.sandpoint_hinterlands). AP canon for the
              // Hinterlands gazetteer.
              hexSizeMiles: 1,
              children: [
                {
                  name: 'Sandpoint',
                  kind: NODE_KINDS.TOWN,
                  desc: 'A small coastal town in western Varisia, often called "the Light of the Lost Coast". Population ~1,200. Famous for its Swallowtail Festival, the cliffside Old Light, and the troubled Sandpoint Cathedral.',
                  // Task #56 — axial hex coords on the 1-mi Sandpoint
                  // Hinterlands map. Derived from mapRegistry POI xPct/yPct
                  // (50,28) via pixelToHex on the 1200×900 canvas. Matches
                  // the "8,3" pin the renderer drops for Sandpoint.
                  hexQ: 8,
                  hexR: -1,
                  // Bug #49: arriving at a TOWN without a specific sub-location
                  // auto-descends here. Phase 1 seed expansion (2026-04-17)
                  // flipped the default from 'Market Square' to 'Main Road' —
                  // Main Road is the neutral hub where hex-crawl travellers
                  // arrive; Cathedral Square is now a sibling of Main Road
                  // (reached canonically during RotR's Swallowtail Festival
                  // via narration, not via tree default). If the operator
                  // wants a different default, edit this field. Named by
                  // child name (case-insensitive); if the child is
                  // renamed/removed this falls back gracefully.
                  //
                  // Bug #68 (2026-04-18) — Renamed 'Market Square' to
                  // 'Cathedral Square' to match Paizo canon for RotR. In
                  // the Anniversary Edition the Swallowtail Festival opens
                  // in the plaza directly in front of the new cathedral,
                  // which Paizo calls "Cathedral Square". The prior name
                  // caused the narrative ("You stand at the center of
                  // Cathedral Square…") and the tree node ("Market Square")
                  // to disagree, which in turn let the scene extractor
                  // spawn a duplicate ghost node on first play. Ref: Tom
                  // live RotR session, 2026-04-18.
                  defaultEntry: 'Main Road',
                  children: [
                    // ── Entrance nodes (Bug #49) ───────────────────────────
                    // Tagged entrance: true so resolveTownEntrance picks one
                    // based on the party's approach direction. primary: true
                    // on Turandarok Bridge is the no-match fallback (AP
                    // canonical entry for parties coming from the north via
                    // Windsong Abbey or from the Hinterlands road that loops
                    // back across the river).
                    {
                      name: 'Turandarok Bridge',
                      kind: NODE_KINDS.AREA,
                      desc: "The wooden bridge over the Turandarok River at Sandpoint's north edge. Travelers from the north cross here to reach Main Road; the bridge is wide enough for a pair of wagons to pass, with weathered planking and iron-reinforced pilings sunk into the river stones.",
                      entrance: true,
                      approachFrom: 'north',
                      primary: true,
                    },
                    {
                      name: 'Lost Coast Road (South)',
                      kind: NODE_KINDS.AREA,
                      desc: "The southern end of Main Road where it leaves Sandpoint and becomes the Lost Coast Road heading toward Magnimar. A worn guidepost marks the town boundary; cart ruts deepen past the last house.",
                      entrance: true,
                      approachFrom: 'south',
                    },
                    // ── Hub + outdoor areas ────────────────────────────────
                    {
                      name: 'Main Road',
                      kind: NODE_KINDS.AREA,
                      desc: "The packed-dirt road running north-south through the heart of Sandpoint. The Turandarok bridge crosses into town from the north; the road continues south toward Junker's Edge. Most of the town's notable buildings open onto Main Road or the streets that branch from it (Church, Market, Tower, and Cliff). From here you can head to any district in town, or back out to the Hinterlands.",
                    },
                    {
                      name: 'Cathedral Square',
                      kind: NODE_KINDS.AREA,
                      desc: 'The paved plaza directly in front of the new Sandpoint Cathedral, off Main Road. Broad enough to host the Swallowtail Festival crowds on dedication day — vendor stalls, a performance platform, and clear sightlines to the cathedral steps. Canonical opening scene of the Rise of the Runelords campaign.',
                    },
                    {
                      name: 'The Docks',
                      kind: NODE_KINDS.AREA,
                      desc: 'Sandpoint Harbor at the south end of town — wooden piers stepping out over the Varisian Gulf, the fishmarket bustling at dawn, and the Valdemar shipyard hammering out new hulls. Gulls wheel overhead; the air smells of salt, tar, and gutted fish.',
                      entrance: true,
                      approachFrom: 'sea',
                      children: [
                        {
                          name: 'The Piers',
                          kind: NODE_KINDS.AREA,
                          desc: 'A row of weather-greyed wooden piers jutting into the harbor, tied off with fishing boats, trading skiffs, and the occasional deeper-draught vessel stopping over on the Magnimar run.',
                        },
                        {
                          name: 'Valdemar Fishmarket',
                          kind: NODE_KINDS.BUILDING,
                          desc: 'An open-sided stone-and-timber market on the dockside where the morning catch is sold before noon. Slabs of ice, gutting knives, and loud arguments over prices.',
                        },
                        {
                          name: 'Sandpoint Shipyard',
                          kind: NODE_KINDS.BUILDING,
                          desc: 'The Valdemar-owned shipyard. Dry-docks, saw-pits, and timber-racks where Sandpoint builds and repairs fishing boats and coasters. Belven Valdemar runs day-to-day operations.',
                        },
                      ],
                    },
                    {
                      name: 'Sandpoint Boneyard',
                      kind: NODE_KINDS.LANDMARK,
                      desc: 'The town cemetery behind the cathedral, kept by the acolyte Naffer Vosk. Rows of weathered markers for generations of Sandpointers; a low stone wall and an iron gate.',
                    },
                    {
                      name: 'The Old Light',
                      kind: NODE_KINDS.LANDMARK,
                      desc: 'A massive, ruined stone lighthouse of ancient Thassilonian construction, standing sentinel on the cliffs at the edge of town. Its original purpose is unknown.',
                    },
                    {
                      name: "Junker's Edge",
                      kind: NODE_KINDS.LANDMARK,
                      desc: 'A cliff-side dump at the south edge of town where Sandpointers throw refuse into the sea. The half-orc street cleaner Gorvi keeps its shack nearby.',
                    },

                    // ── Major civic buildings (with interiors) ─────────────
                    {
                      name: 'The Rusty Dragon',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sandpoint's oldest and most popular inn, owned and run by Ameiko Kaijitsu. A three-story wooden building at 80 Market Street, topped by an iron dragon statue that doubles as a lightning rod. The common room is the town's social hub; adventurers are particularly welcomed.",
                      defaultEntry: 'Ground Floor',
                      children: [
                        {
                          name: 'Ground Floor',
                          kind: NODE_KINDS.FLOOR,
                          desc: 'The tavern level: common room with a performance stage, kitchen behind, and a back door to the alley. Ameiko often works the room; Bethana Corwin handles lodging inquiries.',
                          defaultEntry: 'Main Tavern Room',
                          children: [
                            {
                              name: 'Main Tavern Room',
                              kind: NODE_KINDS.ROOM,
                              desc: "The Rusty Dragon's common room: long bar, scattered tables, and an open stage where any traveler with a story is welcome to perform. Specialties on the menu include curried salmon and cheese-curd-stuffed artichoke hearts; raspberry mead is the house drink.",
                            },
                            {
                              name: 'Kitchen',
                              kind: NODE_KINDS.ROOM,
                              desc: "The inn's kitchen — stone hearth, iron pots, and Ameiko's private stash of Minkai-style spices. Rarely empty; Bethana keeps the fires burning almost around the clock.",
                            },
                          ],
                        },
                        {
                          name: 'Upper Floor',
                          kind: NODE_KINDS.FLOOR,
                          desc: "The inn's lodging level. A single central hallway runs between guest rooms of three tiers plus Ameiko's own suite.",
                          children: [
                            {
                              name: 'The Bronze Room',
                              kind: NODE_KINDS.ROOM,
                              desc: "Ameiko Kaijitsu's private suite and the inn's finest room, offered free at her discretion. A heavy bronze dragon door-knocker marks the entrance.",
                            },
                            {
                              name: 'Luxury Rooms',
                              kind: NODE_KINDS.ROOM,
                              desc: 'Four appointed guest rooms at 2 gp/night — feather beds, shuttered windows, private washstands.',
                            },
                            {
                              name: 'Single Rooms',
                              kind: NODE_KINDS.ROOM,
                              desc: 'Seven smaller guest rooms at 5 sp/night — clean, functional, and well-kept.',
                            },
                            {
                              name: 'Lodging Common Room',
                              kind: NODE_KINDS.ROOM,
                              desc: 'A shared bunkroom at 5 cp/night for travelers without coin to spare. Cots, a shared hearth, and surprisingly good company.',
                            },
                          ],
                        },
                        {
                          name: 'Basement',
                          kind: NODE_KINDS.FLOOR,
                          desc: "The inn's cellar — cool stone walls, racks of casks, barrels of salted fish, and crates of dry goods. Rarely visited except by Bethana and the kitchen staff.",
                        },
                      ],
                    },
                    {
                      name: 'Sandpoint Cathedral',
                      kind: NODE_KINDS.BUILDING,
                      desc: "The largest building in Sandpoint and its newest — a six-faith cathedral at 60 Church Street. Built after the Late Unpleasantness fire that killed Father Tobyn. Now tended by Father Abstalar Zantus (Desna) and four acolytes. Worship is divided among six deities: Abadar, Desna, Erastil, Gozreh, Sarenrae, and Shelyn.",
                      defaultEntry: 'Stone Circle Courtyard',
                      children: [
                        {
                          name: 'Stone Circle Courtyard',
                          kind: NODE_KINDS.AREA,
                          desc: 'An open-air courtyard at the cathedral\'s core, surrounding seven ancient standing stones that themselves ring a circular stone altar. Predates the town by centuries; Varisian tradition calls them Desna\'s palace towers (the older Thassilonian truth is lost to all but scholars).',
                        },
                        {
                          name: 'Shrine of Erastil',
                          kind: NODE_KINDS.ROOM,
                          desc: 'South-facing shrine to Erastil, Old Deadeye. Popular with Sandpoint\'s farmers and hunters. Simple wooden benches and a stag-horn altar.',
                        },
                        {
                          name: 'Shrine of Abadar',
                          kind: NODE_KINDS.ROOM,
                          desc: 'South-facing shrine to Abadar, god of cities and commerce. A counting-table altar; the Mercantile League often makes offerings here.',
                        },
                        {
                          name: 'Shrine of Shelyn',
                          kind: NODE_KINDS.ROOM,
                          desc: 'West-facing shrine to Shelyn, goddess of beauty and art. Carved songbirds, fresh flowers, and a view of the Old Light beyond.',
                        },
                        {
                          name: 'Shrine of Gozreh',
                          kind: NODE_KINDS.ROOM,
                          desc: 'West-facing shrine to Gozreh, lord of sea and sky. A driftwood-and-brass altar; fishermen stop here before long voyages.',
                        },
                        {
                          name: 'Shrine of Sarenrae',
                          kind: NODE_KINDS.ROOM,
                          desc: 'East-facing shrine to Sarenrae, the Dawnflower. Gilded sunburst above the altar; morning light floods the chapel at sunrise.',
                        },
                        {
                          name: 'Shrine of Desna',
                          kind: NODE_KINDS.ROOM,
                          desc: 'East-facing shrine to Desna, goddess of travelers, dreams, and stars. Father Zantus\'s home shrine. A mosaic butterfly on the floor; the altar is set beside a wide window that faces the boneyard.',
                        },
                      ],
                    },
                    {
                      name: 'Sandpoint Garrison',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sheriff Belor Hemlock's stone fortress at 210 Main Street — the town's guardpost and jail in one building. The town watch (about a dozen regulars plus a 62-strong militia) trains and beds down here. The northeastern basement wing was collapsed in a recent sinkhole and remains unrepaired.",
                      defaultEntry: 'Guard Barracks',
                      children: [
                        {
                          name: 'Guard Barracks',
                          kind: NODE_KINDS.ROOM,
                          desc: 'The main hall of the garrison ground floor — rows of cots, a rack of weapons, and a long table where off-duty guards eat and play cards. Usually three or four regulars on duty.',
                        },
                        {
                          name: "Sheriff's Office",
                          kind: NODE_KINDS.ROOM,
                          desc: "Sheriff Belor Hemlock's office — a desk heaped with patrol logs, a rack of Sandpoint's limited documentation, and a cork board of current concerns. Window faces Main Street.",
                        },
                        {
                          name: 'Militia Training Hall',
                          kind: NODE_KINDS.ROOM,
                          desc: 'A broad flagged-stone hall where the 62-strong militia drills once a week. Wooden training weapons line one wall; pell-posts and straw dummies fill the center.',
                        },
                        {
                          name: 'Basement Jail',
                          kind: NODE_KINDS.FLOOR,
                          desc: "The underground jail — reduced to two serviceable cells along the western wall since the recent sinkhole collapsed the northeastern wing. The jailer Vachedi, a scarred Shoanti barbarian, keeps watch. Hardened criminals rarely stay long; an escort from Magnimar hauls them to trial.",
                        },
                      ],
                    },
                    {
                      name: 'Sandpoint Town Hall',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'The civic building at 140 Main Street where Mayor Kendra Deverin and the seven-member Town Council conduct business. Modest but well-appointed.',
                      defaultEntry: 'Council Chamber',
                      children: [
                        {
                          name: 'Council Chamber',
                          kind: NODE_KINDS.ROOM,
                          desc: 'A vaulted hall with a long oval table and seven chairs — one per council member. The town\'s founding charter hangs framed on the east wall; portraits of past mayors flank the entrance.',
                        },
                        {
                          name: "Mayor's Office",
                          kind: NODE_KINDS.ROOM,
                          desc: "Mayor Kendra Deverin's office — cluttered desk, shelves of correspondence with Magnimar, and a well-used teapot that's always warm.",
                        },
                        {
                          name: "Clerk's Office",
                          kind: NODE_KINDS.ROOM,
                          desc: 'Where the town clerk keeps records of deeds, marriages, births, and court proceedings. Strangers who want to look through the records sign in here first.',
                        },
                        {
                          name: 'Basement Vault',
                          kind: NODE_KINDS.ROOM,
                          desc: "The town hall's basement vault — a thick iron-bound door behind which the town treasury, reserve coin, and sensitive records are kept. Only the mayor and sheriff hold keys.",
                        },
                      ],
                    },

                    // ── Taverns + inns (sibling buildings, interiors TBD) ──
                    {
                      name: 'The White Deer',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sandpoint's upscale inn — two-story wood-and-stone, commanding a view of the Varisian Gulf. Run by Garridan Viskalai (Sheriff Hemlock's estranged brother). Quieter and more refined than the Rusty Dragon.",
                    },
                    {
                      name: 'The Hagfish',
                      kind: NODE_KINDS.BUILDING,
                      desc: "A rowdy waterfront tavern popular with fishermen and gamblers. Famous for Norah's Hagfish Challenge — drink from the tank with the old hagfish in it and win the evening's pot.",
                    },
                    {
                      name: "Cracktooth's Tavern",
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A working-class bar with a broad performance stage; amateur nights often end in uproar or applause with equal frequency. Run by Jubrayl Vhiski\'s associates.',
                    },
                    {
                      name: "Risa's Place",
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A quiet tavern at the east edge of town, run by an ancient Varisian sorceress named Risa Magravi. Locals come for the stew and the silence.',
                    },
                    {
                      name: "Fatman's Feedbag",
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A rough tavern on the south end of town known for brawls, cheap ale, and sawdust-covered floors.',
                    },
                    {
                      name: "The Pixie's Kitten",
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sandpoint's one establishment of ill repute, run discreetly by Kaye Tesarani. Polished, surprisingly respectable, and — rumor has it — a decent source of information.",
                    },

                    // ── Shops + crafters ───────────────────────────────────
                    {
                      name: "Savah's Armory",
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sandpoint's primary weapon and armor shop at 20 Tower Street. Proprietor Savah Bevaniky keeps a wide selection including masterwork and exotic weapons; she can special-order anything nonmagical from Magnimar on a 2–3 day turnaround.",
                    },
                    {
                      name: 'Red Dog Smithy',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A foul-tempered but highly skilled blacksmith shop. Takes metalwork commissions and repairs.',
                    },
                    {
                      name: "The Pillbug's Pantry",
                      kind: NODE_KINDS.BUILDING,
                      desc: 'Herbalist and apothecary. Dried herbs hang from every rafter; sells cure potions, antitoxins, and common alchemical supplies.',
                    },
                    {
                      name: 'Bottled Solutions',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'An alchemist shop with unpredictable wares — what\'s on the shelves rotates week to week depending on what the proprietor is brewing.',
                    },
                    {
                      name: 'Sandpoint Glassworks',
                      kind: NODE_KINDS.BUILDING,
                      desc: "The Kaijitsu family's glass factory and forge on the south edge of town. Recently closed following the murder of its owner Lonjiku Kaijitsu. Key location in Burnt Offerings (AP #1).",
                    },
                    {
                      name: 'Scarnetti Mill',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'The Scarnetti family\'s lumber mill on the Turandarok River. One of three competing mills in town, and the largest.',
                    },
                    {
                      name: 'Sandpoint Lumber Mill',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'An independent lumber mill run by Ibor Thorn — a Scarnetti rival.',
                    },
                    {
                      name: 'Two Knight Brewery',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sandpoint's brewery, producing the seasonal ales served in every tavern in town.",
                    },
                    {
                      name: 'Goblin Squash Stables',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Daviren Hosk's stable on the east edge of town. Retired goblin hunter; the scalps on the wall are real. Boards mounts and occasionally sells horses.",
                    },
                    {
                      name: 'Rovanky Tannery',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A leather-tanning operation on the east end of town. Smells terrible; does excellent work.',
                    },
                    {
                      name: 'The Way North',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A shop dealing in maps and sea charts — the closest thing Sandpoint has to a library for geographic lore.',
                    },
                    {
                      name: 'The Curious Goblin',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A surprisingly well-stocked bookshop — carries scrolls, common texts, and the occasional obscure find.',
                    },
                    {
                      name: 'The Feathered Serpent',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A shop dealing in oddities and curiosities — and, quietly, in magic items. The best source in Sandpoint for enchanted goods.',
                    },
                    {
                      name: 'General Store',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Ven Vinder's general store — the oldest and best-stocked in town. Stocks everything from rope to rations to replacement lantern glass.",
                    },

                    // ── Other civic + religious buildings ──────────────────
                    {
                      name: 'Turandarok Academy',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Sandpoint's school and orphanage, run by Ilsoari Gandethus. Where the town's children learn their letters; also where Nualia grew up.",
                    },
                    {
                      name: 'House of Blue Stones',
                      kind: NODE_KINDS.BUILDING,
                      desc: "A small monastery dedicated to Irori, run by the monk Sabyl Sorn. A place of study and quiet discipline; worshippers of knowledge and perfection meditate among blue-lacquered stones.",
                    },
                    {
                      name: 'Sandpoint Theater',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Cyrdak Drokkus's theater — the town's cultural center for plays and performances. The recurring rivalry with Ameiko at the Rusty Dragon is common gossip.",
                    },

                    // ── Noble manors ──────────────────────────────────────
                    {
                      name: 'Kaijitsu Manor',
                      kind: NODE_KINDS.BUILDING,
                      desc: "The Kaijitsu estate on Schooner Gulch Road. Ameiko has largely abandoned it after her father's death; only the groundskeeper remains.",
                    },
                    {
                      name: 'Deverin Manor',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Mayor Kendra Deverin's family estate — the Deverins are one of Sandpoint's four founding families.",
                    },
                    {
                      name: 'Scarnetti Manor',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Titus Scarnetti's estate — loggers, millers, and the most politically aggressive of the founding families.",
                    },
                    {
                      name: 'Valdemar Manor',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'The Valdemar estate — shipbuilders and carpenters, recently in mourning after the death of patriarch Ethram Valdemar.',
                    },

                    // ── Cultural + specialist residences ──────────────────
                    // Added 2026-04-18 per operator request for canonical
                    // Sandpoint Gazetteer completeness. Each of these is a
                    // named Gazetteer location with a specific NPC
                    // owner/operator — all RotRL-relevant.
                    {
                      name: "Madame Mvashti's House",
                      kind: NODE_KINDS.BUILDING,
                      desc: "A quiet, shuttered cottage on the east side of town belonging to Niska Mvashti — an ancient Varisian fortune-teller and seer said to be over a century old. Her adopted daughter Koya Mvashti lives with her and tends the household. Visiting Sandpointers come here when they want a harrow reading or to ask after Varisian lore.",
                    },
                    {
                      name: 'Sandpoint Boutique',
                      kind: NODE_KINDS.BUILDING,
                      desc: "A clothier and light-armor shop run by Vorvashali Voon — a half-elf with an eye for both Magnimar fashion and practical travel gear. Sells fine clothing, traveler's outfits, padded / leather / studded-leather armor, and custom tailoring on a few days' notice.",
                    },
                    {
                      name: 'Sandpoint Savories',
                      kind: NODE_KINDS.BUILDING,
                      desc: "Alma Avertin's bakery — the smell of bread, cinnamon, and Desna-festival sweets reaches halfway down Main Street most mornings. Pastries, cakes, and the moon-cookies served at every Swallowtail Festival all come from her ovens.",
                    },
                    {
                      name: "Hannah's Market",
                      kind: NODE_KINDS.BUILDING,
                      desc: "A healer's market and herbal shop run by Hannah Velerin, a half-elf midwife and folk-healer. Stocks curative teas, poultices, minor healing potions, and practical first-aid supplies. Distinct from Pillbug's Pantry — Hannah treats patients directly, Pillbug only sells ingredients.",
                    },
                    {
                      name: 'Sandpoint Meat Market',
                      kind: NODE_KINDS.BUILDING,
                      desc: 'A butcher shop at the south end of town — sides of pork, smoked fish, sausages hanging in the window. Supplies most of the local taverns and the festival food-stalls.',
                    },
                    {
                      name: 'Sandpoint Mercantile League',
                      kind: NODE_KINDS.BUILDING,
                      desc: "The merchants' guildhall — a sturdy two-story building where Sandpoint's shopkeepers meet to settle trade disputes, set festival prices, and negotiate bulk orders from Magnimar caravans. The League is informally run by the four founding families but any licensed merchant can petition for a hearing.",
                    },
                    {
                      name: "Brodert Quink's Residence",
                      kind: NODE_KINDS.BUILDING,
                      desc: "A cluttered, book-choked cottage near the Old Light belonging to Brodert Quink, Sandpoint's resident Thassilonian scholar and self-styled antiquarian. Piles of rubbings, sketched cross-sections of the Old Light, and maps of Varisian ruins cover every surface. Brodert will happily lecture any visitor willing to listen — and, once properly motivated, is the single best source in town for Thassilonian lore.",
                    },
                  ],
                },
                // Hinterlands POIs are each stamped with axial hexQ/hexR on
                // the 1-mi Sandpoint Hinterlands detail map (see Task #56,
                // 2026-04-19). Coords match mapRegistry.poi pins via
                // HexGridOverlay::pixelToHex on the 1200×900 canvas so the
                // travel engine's hex-distance math (overlandTravel.js) lines
                // up with the rendered pin positions — e.g. Sandpoint→
                // Thistletop is ~5 mi, Sandpoint→Foxglove Manor ~6 mi,
                // matching AP canon. Tickwood is AP-canonical but not on the
                // map, so it's left unstamped and falls through to the
                // kind-based heuristic.
                {
                  name: 'Tickwood',
                  kind: NODE_KINDS.WILDERNESS,
                  desc: 'A thick patch of old-growth forest southeast of Sandpoint. Home to tribes of goblins and the occasional traveler who never comes back.',
                },
                {
                  name: 'Devil\u2019s Platter',
                  kind: NODE_KINDS.WILDERNESS,
                  desc: 'A rocky plateau of broken ground and hidden Thassilonian ruins north of Sandpoint.',
                  hexQ: 6,
                  hexR: 3,
                },
                {
                  name: 'Brinestump Marsh',
                  kind: NODE_KINDS.WILDERNESS,
                  desc: 'A fetid coastal swamp south of Sandpoint, home to the Licktoad goblins.',
                  hexQ: 10,
                  hexR: 1,
                },
                {
                  name: 'Thistletop',
                  kind: NODE_KINDS.DUNGEON,
                  desc: "A thorny islet off the Lost Coast holding Nualia's goblin fortress and an ancient Thassilonian sub-structure beneath it.",
                  hexQ: 3,
                  hexR: 0,
                },
                {
                  name: 'Foxglove Manor',
                  kind: NODE_KINDS.DUNGEON,
                  desc: "The haunted manor on the cliffs east of Sandpoint, long empty since the deaths of Vorel, Cyralie, and Traver Foxglove. Locals call it 'the Misgivings'. A RotR chapter 2 location.",
                  hexQ: 14,
                  hexR: -2,
                },
                {
                  name: 'Nettlewood',
                  kind: NODE_KINDS.WILDERNESS,
                  desc: "A dense tangle of sharp-thorned brush and stunted trees northwest of Sandpoint, pressing up against the coast toward Thistletop. Travelers stick to the road; goblins and worse lair inside.",
                  hexQ: 4,
                  hexR: 1,
                },
                {
                  name: 'Farmlands',
                  kind: NODE_KINDS.WILDERNESS,
                  desc: "Fields and scattered farmsteads east of Sandpoint along the Lost Coast Road — the Hambley, Grump, and Red Iron holdings among them. Staples of the town's larder and the most settled patch of the Hinterlands.",
                  hexQ: 10,
                  hexR: -1,
                },
                {
                  name: 'Mosswood',
                  kind: NODE_KINDS.WILDERNESS,
                  desc: "A quiet stretch of moss-hung forest south of Sandpoint, between Brinestump Marsh and the Lost Coast Road. Home to scattered Shoanti and Varisian families as well as the occasional hermit.",
                  hexQ: 8,
                  hexR: 3,
                },
              ],
            },
            {
              name: 'Magnimar',
              kind: NODE_KINDS.CITY,
              desc: 'The City of Monuments, Varisia\u2019s largest coastal city, dominated by the massive Irespan ruin arch. Home to the Pathfinder Society\u2019s Heidmarch Manor.',
            },
            {
              name: 'Korvosa',
              kind: NODE_KINDS.CITY,
              desc: 'A Chelish-descended river city ruled by queen Ileosa Arabasti. Rigid, ordered, and ambitious.',
            },
            {
              name: 'Riddleport',
              kind: NODE_KINDS.CITY,
              desc: 'A notorious pirate port on Varisia\u2019s northern coast. No law but what you buy.',
            },
          ],
        },
      ],
    },
  ],
};

// ───────────────────────────────────────────────────────────── builders

/**
 * Build a seeded tree for a given campaign setting key.
 * Falls back to a blank single-node 'World' tree if the key is unknown.
 */
export function buildSeedTree(settingKey = 'pf1e') {
  const seed = SEEDS[String(settingKey).toLowerCase()] || null;
  if (!seed) {
    return createTree({ name: 'World', kind: NODE_KINDS.WORLD });
  }
  const tree = createTree({
    name: seed.root.name,
    kind: seed.root.kind,
    desc: seed.root.desc,
  });
  const planted = seedChildren(tree, tree.rootId, seed.children || []);
  return { tree, planted };
}

/**
 * Idempotently merge a seed into an existing tree. For each seed node, we
 * find an existing child of the same name (case-insensitive) under the
 * expected parent; if not present, we create it. Returns { tree, added[] }.
 *
 * Use this when migrating an existing campaign — it guarantees the Golarion
 * > Varisia > … backbone exists without trashing operator-created nodes.
 */
export function ensureSeedInTree(tree, settingKey = 'pf1e') {
  const seed = SEEDS[String(settingKey).toLowerCase()] || null;
  if (!tree || !seed) return { tree, added: [] };

  const added = [];
  // Ensure root name/kind match (we don't rename, just top up desc if empty).
  const root = tree.nodes[tree.rootId];
  if (root && !root.desc && seed.root?.desc) root.desc = seed.root.desc;

  const addBelow = (parentId, entries) => {
    for (const entry of entries) {
      const parent = tree.nodes[parentId];
      if (!parent) continue;
      const existing = (parent.childrenIds || [])
        .map(cid => tree.nodes[cid])
        .find(n => n && (n.name || '').toLowerCase() === entry.name.toLowerCase());
      let nodeId;
      if (existing) {
        nodeId = existing.id;
        if (!existing.desc && entry.desc) existing.desc = entry.desc;
        if (!existing.kind && entry.kind) existing.kind = entry.kind;
        // Bug #49 — top up defaultEntry on existing seeds so pre-#49 trees
        // pick up the new field on next boot without a destructive migration.
        if (!existing.defaultEntry && entry.defaultEntry) {
          existing.defaultEntry = entry.defaultEntry;
        }
        // Task #85 — backfill hexSizeMiles on existing region/country seeds
        // so pre-#85 trees pick up the per-region scale without a destructive
        // migration. Only writes when the node doesn't already have a finite
        // value so operator overrides survive.
        if (
          Number.isFinite(entry.hexSizeMiles) &&
          !Number.isFinite(existing.hexSizeMiles)
        ) {
          existing.hexSizeMiles = entry.hexSizeMiles;
        }
        // Task #56 — backfill hexQ/hexR on existing Hinterlands POI seeds so
        // pre-#56 saves pick up the per-POI hex position without destroying
        // any operator-placed coords. Only writes when the node lacks finite
        // values so hand-nudged pins survive migration.
        if (
          Number.isFinite(entry.hexQ) &&
          !Number.isFinite(existing.hexQ)
        ) {
          existing.hexQ = entry.hexQ;
        }
        if (
          Number.isFinite(entry.hexR) &&
          !Number.isFinite(existing.hexR)
        ) {
          existing.hexR = entry.hexR;
        }
        // Bug #49 multi-entrance — backfill entrance tagging on pre-#49
        // seeds so existing Sandpoint saves pick up gate routing without a
        // destructive migration. Writes only when the field is missing so
        // operator changes survive.
        if (entry.entrance === true && existing.entrance !== true) {
          existing.entrance = true;
        }
        if (entry.approachFrom && !existing.approachFrom) {
          existing.approachFrom = entry.approachFrom;
        }
        if (entry.primary === true && existing.primary !== true) {
          existing.primary = true;
        }
      } else {
        const newNode = createChildNode(tree, parentId, {
          name: entry.name, kind: entry.kind, desc: entry.desc,
        });
        if (entry.defaultEntry) newNode.defaultEntry = entry.defaultEntry;
        if (Number.isFinite(entry.hexSizeMiles)) newNode.hexSizeMiles = entry.hexSizeMiles;
        // Task #56 — new seed nodes inherit their canonical hex position.
        if (Number.isFinite(entry.hexQ)) newNode.hexQ = entry.hexQ;
        if (Number.isFinite(entry.hexR)) newNode.hexR = entry.hexR;
        // Bug #49 multi-entrance — tag entrance nodes so resolveTownEntrance
        // can route arrivals by approach direction.
        if (entry.entrance === true) newNode.entrance = true;
        if (entry.approachFrom) newNode.approachFrom = entry.approachFrom;
        if (entry.primary === true) newNode.primary = true;
        nodeId = newNode.id;
        added.push(newNode.id);
      }
      if (Array.isArray(entry.children) && entry.children.length) {
        addBelow(nodeId, entry.children);
      }
    }
  };
  addBelow(tree.rootId, seed.children || []);
  return { tree, added };
}

function seedChildren(tree, parentId, entries) {
  const planted = [];
  for (const entry of entries) {
    const n = createChildNode(tree, parentId, {
      name: entry.name, kind: entry.kind, desc: entry.desc,
    });
    // Bug #49 — stamp the optional defaultEntry from the seed onto the live
    // node so arrival-time auto-descend can resolve it to a child by name.
    if (entry.defaultEntry) n.defaultEntry = entry.defaultEntry;
    // Task #85 — stamp optional hexSizeMiles so region/country nodes carry
    // their map scale (Hinterlands 1mi, Varisia 12mi). Read by
    // getHexSizeMilesForNode via ancestor walk.
    if (Number.isFinite(entry.hexSizeMiles)) n.hexSizeMiles = entry.hexSizeMiles;
    // Task #56 — stamp optional axial hex coords so Hinterlands POIs carry
    // their pin positions into the travel engine (estimateSegmentMiles reads
    // node.hexQ / node.hexR directly).
    if (Number.isFinite(entry.hexQ)) n.hexQ = entry.hexQ;
    if (Number.isFinite(entry.hexR)) n.hexR = entry.hexR;
    // Bug #49 multi-entrance — copy entrance tagging from seed to node so
    // resolveTownEntrance can route arrivals by approach direction.
    if (entry.entrance === true) n.entrance = true;
    if (entry.approachFrom) n.approachFrom = entry.approachFrom;
    if (entry.primary === true) n.primary = true;
    planted.push(n.id);
    if (Array.isArray(entry.children) && entry.children.length) {
      planted.push(...seedChildren(tree, n.id, entry.children));
    }
  }
  return planted;
}

// ───────────────────────────────────────────────────────────── registry

const SEEDS = {
  pf1e: GOLARION_SEED,
  golarion: GOLARION_SEED,
  pathfinder: GOLARION_SEED,
};

export { GOLARION_SEED };
