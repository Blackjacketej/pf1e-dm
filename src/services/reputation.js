/**
 * Reputation / Fame / Infamy Layer
 *
 * Sits on top of factions. Tracks the party's reputation as TWO independent
 * axes — fame (how widely known, admired, heroic) and infamy (how feared,
 * reviled, notorious). You can be both (a dragon-slayer who also burned a
 * village), neither (anonymous), or lopsided.
 *
 * Deeds are filtered through cultural lenses: the same act produces different
 * rep deltas depending on who's hearing about it. A goblin tribe doesn't care
 * that you robbed a merchant — they may admire it. A dwarven clan will
 * disinherit you for breaking an oath but shrug at a bar fight.
 *
 * Fame decays (people forget heroes); infamy sticks (people remember monsters).
 *
 * Pure functions. Consumers own persistence.
 *
 * Public API:
 *   createReputation()                    — fresh party reputation record
 *   recordDeed(rep, deedKey, context)     — log a deed, update fame/infamy
 *   interpretDeedThroughCulture(deed, archetype)  — cultural lens
 *   applyDeedToFaction(faction, deed)     — apply a deed's cultural delta to a faction
 *   decayFameOverTime(rep, daysElapsed)   — gradual drift toward obscurity
 *   fameTier / infamyTier                 — human-readable tiers
 *   reputationSummary(rep)                — composite description
 */

// ══════════════════════════════════════════════════════════════════════════════
// Deeds
// ══════════════════════════════════════════════════════════════════════════════
//
// Each deed has:
//   fame     — raw fame delta (how impressive/heroic in a generic sense)
//   infamy   — raw infamy delta (how monstrous/feared)
//   visibility — 'local' | 'regional' | 'legendary' (how far it spreads)
//   tags     — used by cultural lens to reinterpret

export const DEED_TYPES = {
  // Heroic
  slew_dragon:           { fame:  40, infamy:  0,  visibility: 'legendary', tags: ['combat_victory', 'protected_innocents'] },
  saved_town:            { fame:  30, infamy:  0,  visibility: 'regional',  tags: ['protected_innocents', 'heroic'] },
  cleared_dungeon:       { fame:  15, infamy:  0,  visibility: 'local',     tags: ['combat_victory', 'exploration'] },
  rescued_hostages:      { fame:  20, infamy:  0,  visibility: 'regional',  tags: ['protected_innocents', 'heroic'] },
  broke_siege:           { fame:  35, infamy:  0,  visibility: 'regional',  tags: ['combat_victory', 'heroic'] },
  exposed_corruption:    { fame:  20, infamy:  5,  visibility: 'regional',  tags: ['truth_told', 'defied_authority'] },
  healed_plague:         { fame:  30, infamy:  0,  visibility: 'regional',  tags: ['protected_innocents', 'divine_favor'] },

  // Monstrous
  murdered_innocent:     { fame:   0, infamy: 50,  visibility: 'regional',  tags: ['killed_innocent', 'atrocity'] },
  burned_village:        { fame:   0, infamy: 70,  visibility: 'legendary', tags: ['killed_innocent', 'atrocity', 'desecration'] },
  necromancy:            { fame:   0, infamy: 40,  visibility: 'regional',  tags: ['desecration', 'forbidden_magic'] },
  consorted_with_devil:  { fame:   0, infamy: 45,  visibility: 'regional',  tags: ['forbidden_magic', 'oath_broken'] },
  cannibalism:           { fame:   0, infamy: 60,  visibility: 'local',     tags: ['atrocity', 'taboo'] },

  // Ambiguous
  stole_artifact:        { fame:  10, infamy: 15,  visibility: 'regional',  tags: ['theft', 'cunning'] },
  robbed_merchant:       { fame:   0, infamy: 10,  visibility: 'local',     tags: ['theft', 'from_outsider'] },
  robbed_temple:         { fame:   5, infamy: 30,  visibility: 'regional',  tags: ['theft', 'desecration'] },
  assassinated_noble:    { fame:  15, infamy: 35,  visibility: 'regional',  tags: ['killing', 'defied_authority', 'cunning'] },
  won_tournament:        { fame:  15, infamy:  0,  visibility: 'local',     tags: ['combat_victory', 'honor'] },
  dueled_champion:       { fame:  20, infamy:  0,  visibility: 'local',     tags: ['combat_victory', 'honor'] },
  made_oath:             { fame:   2, infamy:  0,  visibility: 'local',     tags: ['oath_made'] },
  broke_oath:            { fame:   0, infamy: 20,  visibility: 'local',     tags: ['oath_broken', 'dishonor'] },
  kept_dangerous_oath:   { fame:  15, infamy:  0,  visibility: 'regional',  tags: ['oath_kept', 'honor'] },

  // Social
  funded_festival:       { fame:  10, infamy:  0,  visibility: 'local',     tags: ['generous', 'community'] },
  built_shrine:          { fame:  12, infamy:  0,  visibility: 'local',     tags: ['generous', 'divine_favor'] },
  insulted_king:         { fame:   5, infamy: 10,  visibility: 'regional',  tags: ['defied_authority'] },

  // Craft / craftsmanship (living-world crafter loop; small magnitudes so
  // weekly craft drift doesn't dominate quest-driven fame).
  crafted_item:          { fame:   1, infamy:  0,  visibility: 'local',     tags: ['craftsmanship', 'community'] },
  crafted_masterwork:    { fame:   3, infamy:  0,  visibility: 'local',     tags: ['craftsmanship', 'honor'] },
  ruined_craft_materials:{ fame:   0, infamy:  1,  visibility: 'local',     tags: ['craftsmanship', 'dishonor'] },
  completed_commission:  { fame:   2, infamy:  0,  visibility: 'local',     tags: ['craftsmanship', 'oath_kept', 'generous'] },
  botched_commission:    { fame:   0, infamy:  3,  visibility: 'local',     tags: ['craftsmanship', 'oath_broken'] },
};

// Visibility → which factions hear about it
export const VISIBILITY_REACH = {
  local:     ['local'],
  regional:  ['local', 'regional'],
  legendary: ['local', 'regional'],
};

// ══════════════════════════════════════════════════════════════════════════════
// Cultural values — how each faction archetype reinterprets tagged deeds
// ══════════════════════════════════════════════════════════════════════════════
//
// Multipliers applied to fame/infamy deltas when a deed carrying that tag is
// filtered through a faction's cultural lens. A value > 1 amplifies; < 1
// dampens; negative flips the axis (fame becomes infamy or vice versa).
//
// fame_mult / infamy_mult are independent, so you can make something boost
// one axis and suppress the other (e.g., for a goblin tribe, theft from an
// outsider increases fame AND decreases infamy).

export const CULTURAL_VALUES = {
  religious: {
    desecration:        { fame: -0.5, infamy: 2.0 },
    divine_favor:       { fame:  2.0, infamy: -0.5 },
    forbidden_magic:    { fame: -1.0, infamy: 2.0 },
    oath_broken:        { fame: -0.5, infamy: 1.5 },
    oath_kept:          { fame:  1.5, infamy: -0.3 },
    heroic:             { fame:  1.2, infamy:  1.0 },
    protected_innocents:{ fame:  1.3, infamy:  1.0 },
  },
  mercantile: {
    theft:              { fame:  0.5, infamy: 1.5 },
    generous:           { fame:  1.3, infamy:  1.0 },
    cunning:            { fame:  1.1, infamy:  0.8 },
    combat_victory:     { fame:  1.0, infamy:  1.0 },
  },
  martial: {
    combat_victory:     { fame:  1.5, infamy:  1.0 },
    combat_defeat:      { fame: -0.5, infamy:  0.5 },
    honor:              { fame:  1.5, infamy: -0.5 },
    dishonor:           { fame: -0.5, infamy: 1.5 },
    heroic:             { fame:  1.3, infamy:  1.0 },
  },
  criminal: {
    theft:              { fame:  1.3, infamy: -0.5 }, // theft is admired
    cunning:            { fame:  1.5, infamy: -0.3 },
    defied_authority:   { fame:  1.5, infamy: -0.5 },
    oath_broken:        { fame: -0.3, infamy: 1.2 }, // even thieves honor the code
    oath_kept:          { fame:  1.2, infamy: -0.3 },
    killed_innocent:    { fame:  0.5, infamy:  1.0 }, // less squeamish
  },
  noble_house: {
    honor:              { fame:  2.0, infamy: -0.5 },
    dishonor:           { fame: -1.0, infamy: 2.0 },
    oath_broken:        { fame: -1.0, infamy: 2.5 },
    oath_kept:          { fame:  1.8, infamy: -0.5 },
    defied_authority:   { fame: -0.5, infamy: 2.0 },
    heroic:             { fame:  1.3, infamy:  1.0 },
  },
  scholarly: {
    truth_told:         { fame:  1.8, infamy: -0.5 },
    forbidden_magic:    { fame:  0.5, infamy:  1.2 }, // ambivalent — curiosity
    exploration:        { fame:  1.5, infamy: -0.3 },
    desecration:        { fame: -0.5, infamy: 1.3 },
  },
  artisan: {
    generous:           { fame:  1.3, infamy: -0.3 },
    community:          { fame:  1.5, infamy: -0.5 },
    killed_innocent:    { fame: -0.3, infamy: 1.5 },
  },
  outcast: {
    defied_authority:   { fame:  1.5, infamy: -0.5 },
    atrocity:           { fame:  0.5, infamy:  1.0 },
  },

  // Non-human / tribal
  tribe: {
    // Goblinoid/orcish tribes admire raiding from outsiders, hate betrayal within
    from_outsider:      { fame:  1.5, infamy: -1.0 },
    theft:              { fame:  1.2, infamy: -0.5 }, // raiding is honorable
    combat_victory:     { fame:  2.0, infamy: -0.5 },
    combat_defeat:      { fame: -1.0, infamy:  0.8 },
    cunning:            { fame:  1.3, infamy: -0.3 },
    heroic:             { fame:  1.0, infamy:  1.0 },
    killed_innocent:    { fame:  0.3, infamy:  0.5 }, // less absolute taboo
    protected_innocents:{ fame:  0.8, infamy:  1.0 }, // if they're ours
  },
  clan: {
    // Dwarven/highland — oath and blood
    oath_broken:        { fame: -2.0, infamy: 3.0 }, // catastrophic
    oath_kept:          { fame:  2.0, infamy: -0.5 },
    honor:              { fame:  2.0, infamy: -0.5 },
    dishonor:           { fame: -1.0, infamy: 2.0 },
    combat_victory:     { fame:  1.5, infamy:  0.8 },
    generous:           { fame:  1.3, infamy: -0.3 },
    desecration:        { fame: -1.0, infamy: 2.0 }, // ancestral sites
  },
  hive: {
    // Collective intelligence — individual deeds barely register unless they
    // threaten the hive. Everything gets dampened except existential threats.
    atrocity:           { fame:  0.2, infamy:  0.3 },
    killed_innocent:    { fame:  0.2, infamy:  0.3 },
    combat_victory:     { fame:  0.5, infamy:  0.5 },
    heroic:             { fame:  0.2, infamy:  0.3 },
  },
  pack: {
    // Gnolls, worgs — strength and dominance
    combat_victory:     { fame:  2.0, infamy:  0.5 },
    combat_defeat:      { fame: -1.5, infamy:  1.0 },
    honor:              { fame:  0.5, infamy:  0.8 }, // indifferent to notions of honor
    cunning:            { fame:  1.3, infamy:  0.8 },
    protected_innocents:{ fame:  0.3, infamy:  0.5 }, // weakness, more than virtue
  },
  coven: {
    // Hags, witches — ritual, secrecy, old pacts
    forbidden_magic:    { fame:  1.5, infamy: -0.5 }, // admired
    desecration:        { fame:  0.8, infamy:  0.5 },
    oath_broken:        { fame: -2.0, infamy: 3.0 }, // pacts are sacred
    oath_kept:          { fame:  2.0, infamy: -0.5 },
    cunning:            { fame:  1.5, infamy: -0.3 },
    truth_told:         { fame:  0.3, infamy:  0.8 }, // honesty is suspect
  },
  enclave: {
    // Elves, druidic circles — long memory, nature
    desecration:        { fame: -1.5, infamy: 2.5 }, // groves, relics
    protected_innocents:{ fame:  1.3, infamy:  1.0 },
    exploration:        { fame:  0.8, infamy:  1.2 }, // can be intrusion
    oath_broken:        { fame: -1.5, infamy: 2.5 },
    oath_kept:          { fame:  2.0, infamy: -0.5 },
    divine_favor:       { fame:  1.5, infamy: -0.3 },
  },
  horde: {
    // Loose large forces — might makes right
    combat_victory:     { fame:  2.5, infamy:  0.5 },
    combat_defeat:      { fame: -2.0, infamy:  0.5 },
    cunning:            { fame:  1.2, infamy:  0.8 },
    atrocity:           { fame:  1.0, infamy:  0.5 }, // spoils of war
    oath_broken:        { fame: -0.3, infamy:  0.8 },
  },
  cult: {
    // Fanatics — tied to their dogma (caller defines dogma via context tags)
    divine_favor:       { fame:  2.0, infamy: -0.5 },
    desecration:        { fame: -1.5, infamy: 2.5 },
    forbidden_magic:    { fame:  1.5, infamy: -0.5 }, // if it aligns
    oath_broken:        { fame: -2.0, infamy: 3.0 },
    oath_kept:          { fame:  2.0, infamy: -0.5 },
  },
  monastery: {
    // Contemplatives — slow, absolute judgment
    honor:              { fame:  1.8, infamy: -0.5 },
    dishonor:           { fame: -0.8, infamy: 1.8 },
    oath_broken:        { fame: -1.0, infamy: 2.0 },
    oath_kept:          { fame:  1.8, infamy: -0.3 },
    truth_told:         { fame:  1.5, infamy: -0.5 },
    desecration:        { fame: -1.0, infamy: 2.0 },
    atrocity:           { fame: -0.5, infamy: 2.0 },
  },
  caravan: {
    // Mobile, pragmatic — they carry stories farther than anyone
    generous:           { fame:  1.5, infamy: -0.3 },
    theft:              { fame:  0.5, infamy: 1.5 }, // robbery scares caravans
    protected_innocents:{ fame:  1.5, infamy: -0.3 }, // escorts value safety
    honor:              { fame:  1.2, infamy: -0.3 },
  },
  court: {
    // Fey/drow/Byzantine — public face vs private dagger; appearance is everything
    cunning:            { fame:  2.0, infamy: -0.5 }, // admired
    truth_told:         { fame:  0.3, infamy:  1.0 }, // bluntness is gauche
    dishonor:           { fame: -1.5, infamy: 2.0 }, // public humiliation is catastrophic
    honor:              { fame:  1.5, infamy: -0.3 },
    defied_authority:   { fame:  0.5, infamy: 1.8 }, // overt defiance offends
    oath_broken:        { fame: -0.3, infamy: 1.5 }, // broken covertly is fine, publicly is not
    theft:              { fame:  1.2, infamy: -0.3 }, // cleverly done, admired
    atrocity:           { fame:  0.3, infamy: 1.5 }, // unless elegant
  },
  hoard: {
    // Solitary dragon/lich — a faction of one. Wealth and respect are everything.
    theft:              { fame: -2.0, infamy: 3.0 }, // taking from the hoard is unforgivable
    honor:              { fame:  1.5, infamy: -0.5 },
    dishonor:           { fame: -0.5, infamy: 1.5 },
    combat_victory:     { fame:  1.8, infamy:  1.0 }, // respected if survived
    cunning:            { fame:  1.8, infamy: -0.3 },
    oath_broken:        { fame: -1.0, infamy: 2.5 }, // pacts with dragons/liches are binding
    oath_kept:          { fame:  2.0, infamy: -0.5 },
    generous:           { fame:  1.5, infamy: -0.5 }, // tribute is respected
    desecration:        { fame: -0.5, infamy: 2.0 }, // if aimed at the hoard's interests
  },
  consortium: {
    // Lich councils, undead cabals — cold calculation, the long game
    cunning:            { fame:  1.8, infamy: -0.3 },
    forbidden_magic:    { fame:  1.5, infamy: -0.5 }, // valued tool
    desecration:        { fame:  0.5, infamy:  0.8 }, // they're undead — ambivalent
    killed_innocent:    { fame:  0.3, infamy:  0.5 }, // individual deaths rarely matter
    oath_broken:        { fame: -1.0, infamy: 2.0 }, // agreements are leverage
    oath_kept:          { fame:  1.5, infamy: -0.3 },
    heroic:             { fame:  0.8, infamy:  1.0 }, // heroism is a threat
    protected_innocents:{ fame:  0.5, infamy:  1.0 }, // also a threat
  },
  guild: {
    // Formal craft/trade bodies — contracts, standards, credentials
    honor:              { fame:  1.5, infamy: -0.3 },
    dishonor:           { fame: -1.0, infamy: 1.8 },
    oath_broken:        { fame: -1.5, infamy: 2.5 }, // contracts are sacred
    oath_kept:          { fame:  1.8, infamy: -0.3 },
    theft:              { fame: -0.3, infamy: 2.0 }, // especially of trade secrets
    community:          { fame:  1.5, infamy: -0.3 },
    generous:           { fame:  1.3, infamy: -0.3 },
    truth_told:         { fame:  1.3, infamy: -0.3 }, // transparency in dealings
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// Construction
// ══════════════════════════════════════════════════════════════════════════════

export function createReputation() {
  return {
    fame: 0,         // 0..100
    infamy: 0,       // 0..100
    deeds: [],       // { deedKey, timestamp, region, fameDelta, infamyDelta, tags }
  };
}

/**
 * Record a deed. Updates global fame/infamy (using base deed values) and
 * appends to the deed log. To see how a deed lands within a specific faction
 * or culture, pass it through interpretDeedThroughCulture or applyDeedToFaction.
 *
 * @param {object} rep
 * @param {string} deedKey — key in DEED_TYPES, or use context.fame/infamy for custom
 * @param {object} context — { timestamp, region, witnesses, fame?, infamy?, tags?, visibility? }
 */
export function recordDeed(rep, deedKey, context = {}) {
  const def = DEED_TYPES[deedKey] || {};
  const fameDelta   = typeof context.fame   === 'number' ? context.fame   : (def.fame   || 0);
  const infamyDelta = typeof context.infamy === 'number' ? context.infamy : (def.infamy || 0);
  const tags        = context.tags       || def.tags       || [];
  const visibility  = context.visibility || def.visibility || 'local';

  const entry = {
    deedKey,
    fameDelta,
    infamyDelta,
    tags: [...tags],
    visibility,
    region: context.region || null,
    witnesses: context.witnesses || 0,
    timestamp: context.timestamp || new Date().toISOString(),
  };

  return {
    ...rep,
    fame:   clamp(rep.fame   + fameDelta,   0, 100),
    infamy: clamp(rep.infamy + infamyDelta, 0, 100),
    deeds: [...rep.deeds, entry],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Cultural interpretation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Reinterpret a deed through a faction archetype's cultural lens.
 * Returns { fame, infamy } deltas as this group would perceive it.
 *
 * When multiple tags apply, multipliers compound (multiplicative blend).
 * Missing tag entries default to multiplier 1.0 (neutral).
 */
export function interpretDeedThroughCulture(deed, archetype) {
  const lens = CULTURAL_VALUES[archetype] || {};
  const tags = deed.tags || [];

  let fameMult = 1.0;
  let infamyMult = 1.0;
  for (const tag of tags) {
    const entry = lens[tag];
    if (!entry) continue;
    fameMult *= entry.fame;
    infamyMult *= entry.infamy;
  }

  return {
    fame:   Math.round((deed.fameDelta   || 0) * fameMult),
    infamy: Math.round((deed.infamyDelta || 0) * infamyMult),
    fameMult,
    infamyMult,
  };
}

/**
 * Apply a deed to a faction's reputation using the cultural lens. The faction's
 * base reputation toward the party shifts by (fame - infamy) / 4, clamped.
 *
 * Returns a new faction record.
 */
export function applyDeedToFaction(faction, deed) {
  const archetype = faction.archetype || 'mercantile';
  const { fame, infamy } = interpretDeedThroughCulture(deed, archetype);
  const repShift = Math.round((fame - infamy) / 4);

  if (repShift === 0) return faction;

  return {
    ...faction,
    baseReputation: clamp(faction.baseReputation + repShift, -100, 100),
    events: [
      ...faction.events,
      {
        eventKey: `deed:${deed.deedKey}`,
        repDelta: repShift,
        narrative: `reacted to deed (${deed.deedKey})`,
        timestamp: deed.timestamp,
      },
    ],
    cachedReputation: null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Decay
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Fame is gloss — it fades. Infamy is stain — it lingers.
 *
 * Fame half-life: ~180 days
 * Infamy half-life: ~720 days
 *
 * Legendary-visibility deeds decay ~4x more slowly (people don't forget the
 * dragon-slayer or the village-burner).
 */
export function decayFameOverTime(rep, daysElapsed) {
  if (!daysElapsed || daysElapsed <= 0) return rep;

  // Legendary deeds slow decay dramatically
  const hasLegendary = rep.deeds.some(d => d.visibility === 'legendary');
  const fameHalfLife   = hasLegendary ? 720  : 180;
  const infamyHalfLife = hasLegendary ? 2880 : 720;

  const fameFactor   = Math.pow(0.5, daysElapsed / fameHalfLife);
  const infamyFactor = Math.pow(0.5, daysElapsed / infamyHalfLife);

  return {
    ...rep,
    fame:   Math.round(rep.fame   * fameFactor),
    infamy: Math.round(rep.infamy * infamyFactor),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Tiers + summary
// ══════════════════════════════════════════════════════════════════════════════

export function fameTier(fame) {
  if (fame >= 80) return { tier: 'legendary', label: 'Legendary' };
  if (fame >= 55) return { tier: 'renowned',  label: 'Renowned'  };
  if (fame >= 30) return { tier: 'known',     label: 'Known'     };
  if (fame >= 10) return { tier: 'whispered', label: 'Whispered About' };
  return { tier: 'unknown', label: 'Unknown' };
}

export function infamyTier(infamy) {
  if (infamy >= 80) return { tier: 'reviled',    label: 'Reviled'    };
  if (infamy >= 55) return { tier: 'dreaded',    label: 'Dreaded'    };
  if (infamy >= 30) return { tier: 'notorious',  label: 'Notorious'  };
  if (infamy >= 10) return { tier: 'suspicious', label: 'Suspect'    };
  return { tier: 'spotless', label: 'Spotless' };
}

/**
 * Human-readable composite. "A renowned hero, but also notorious for dark deeds."
 */
export function reputationSummary(rep) {
  const f = fameTier(rep.fame);
  const i = infamyTier(rep.infamy);
  return {
    fame: rep.fame,
    infamy: rep.infamy,
    fameTier: f,
    infamyTier: i,
    deeds: rep.deeds.length,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
