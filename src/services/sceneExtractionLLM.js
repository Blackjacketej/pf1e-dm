/**
 * sceneExtractionLLM — one-pass LLM reading-comprehension extractor for
 * every structured signal we want to pull out of a narration paragraph.
 *
 * Bug #58 (primary: NPCs) + follow-ups #59-#65 (items, locations,
 * factions, quests, rumors, clues, lore).
 *
 * Motivation:
 *   - The ENTITIES-tail contract in dmEngine's narration prompt is brittle;
 *     the model occasionally forgets it entirely (Marta case) or emits
 *     referential mentions as present NPCs (Dass→Tobyn/Zantus/Deverin).
 *   - The regex heuristic in npcExtraction.js catches some misses but
 *     only knows NPCs and is whack-a-mole on edge cases.
 *   - We've been hand-building extractors per domain (items via ENTITIES,
 *     locations via operator typing into the world-tree, clues via
 *     cluesTracker calls embedded in narration logic…). One LLM sees
 *     the whole paragraph and can surface all of these at once.
 *
 * Design:
 *   - Single Claude-API call per turn (same pattern as dmEngine.callClaude).
 *   - Default to Haiku-class for cost (~$0.001/turn, ~1-2s latency).
 *   - Output: strict JSON with the Tier 1 trichotomy/dichotomy for each
 *     domain. Verbatim evidence spans required so routing can show the
 *     GM what the extractor saw.
 *   - Graceful failure: network/parse/auth errors return empty-for-all-
 *     domains + source:'error'; existing ENTITIES-tail + regex-heuristic
 *     paths remain as belt-and-suspenders fallbacks in processNewEntities.
 *
 * Routing lives in the caller (AdventureTab.processNewEntities). Each
 * domain has its own storage seam:
 *   npcs.present     → storeNPC(presence:'here')   + nearbyNPCs
 *   npcs.mentioned   → storeNPC(presence:'elsewhere')    (not nearby)
 *   npcs.historical  → storeNPC(presence:'historical', alive:false)
 *   items.present    → db.areaItems.add
 *   items.mentioned  → journal rumor-item note
 *   locations.accessible → worldTree child node (auto-discovered)
 *   locations.mentioned  → known-places registry (for later travel)
 *   factions         → faction-archetype hydration + reputation signal
 *   quests           → quest journal (both explicit jobs + softer hooks)
 *   rumors           → journal rumor entry with source/reliability
 *   clues.revealed   → cluesTracker.addClue
 *   clues.resolved   → cluesTracker.closeClue
 *   lore             → journal history category (bug #65)
 *   destructions     → worldTree.setNodeStatus + journal location entry (#64)
 *
 * The domains ship incrementally — this file always returns all nine,
 * but each routing hook lands on its own bug. Unrouted domains just log
 * to console until their consumer is wired.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// Extraction is smaller than narration but with a richer output schema,
// so 25s gives comfortable headroom on slow connections without leaving
// the UI stuck. On timeout the caller falls back to ENTITIES+heuristic.
const EXTRACTION_TIMEOUT_MS = 25000;

// Output budget. A paragraph with ~3 present NPCs, 2 mentioned NPCs,
// 1 historical, 2 items, 2 exits, 1 faction, 1 quest, 1 rumor fits in
// Bug #29 (2026-04-20): 2000 was too low for festival-crowd scenes.
// Live repro on Sandpoint/Swallowtail intro produced a 7357-char dense
// JSON response that got truncated mid-`clues` object — parse failed,
// zero NPCs extracted until the heuristic fallback rescued it. Dense
// 8-domain JSON is ≈1 token/3.5 chars, so a scene with many entities
// easily breaks 3000 tokens. 6000 gives comfortable headroom for the
// busiest scenes (festivals, tavern crowds, market squares) without
// blowing cost meaningfully — scene extraction still runs 1x per
// paragraph, not per turn.
const EXTRACTION_MAX_TOKENS = 6000;

// Minimum paragraph length to bother with an LLM call. Short combat
// banter ("The goblin falls.") or confirmations don't reward a call —
// the heuristic path is fine for them.
const MIN_NARRATION_LEN = 80;

function getExtractionSettings() {
  try {
    const saved = localStorage.getItem('pf-dm-settings');
    if (!saved) return { apiKey: '', model: 'claude-haiku-4-5-20251001' };
    const parsed = JSON.parse(saved);
    return {
      apiKey: parsed.apiKey || '',
      // Prefer dedicated extraction model if operator set one in Settings;
      // otherwise default to Haiku for cost. Extraction is simple JSON
      // classification — Sonnet is overkill. Operator can opt up via
      // parsed.extractionModel if precision drops in field testing.
      model: parsed.extractionModel || 'claude-haiku-4-5-20251001',
    };
  } catch {
    return { apiKey: '', model: 'claude-haiku-4-5-20251001' };
  }
}

// System prompt. Structured by domain with tight rules. No few-shot
// examples — they'd ~double the token cost and Haiku follows the rules
// without them in pilot testing. If field precision drops, the first
// tuning lever is adding 1-2 worked examples per domain here.
const SYSTEM_PROMPT = `You are a scene analyzer for a tabletop RPG session. Read ONE narration paragraph and extract every structured signal in it. Output strict JSON only — no prose, no markdown fences.

The paragraph is something the Game Master narrated to the party. Your job is to classify what happens/appears in it across nine domains.

========== DOMAIN 1: NPCS ==========
People in or referenced by the scene. Three buckets:

  PRESENT — physically in the scene right now. Speakers are present. People being directly addressed by the party are present. Clearly-visible people in the location are present.
  MENTIONED — alive (or presumed alive) but elsewhere. Talked ABOUT by someone in the scene, not by the narrator. A letter describing a distant figure counts here.
  HISTORICAL — dead, legendary, or long-past. Death verbs ("died", "killed", "perished", "fell in battle"), temporal markers ("years ago", "the old days"), or clear exposition about someone no longer living.

Unnamed NPCs are still extracted — use the appearance/role phrase as the name ("a weathered fisherman"). If a person has both an appearance and a proper name revealed in the same paragraph, use the proper name.

========== DOMAIN 2: ITEMS ==========
Physical objects or specific named things.

  PRESENT — physically in the scene, potentially pickable/interactable (a crumpled note on the desk, a rusted key in the lock, a leather-bound book).
  MENTIONED — referenced in speech or exposition, NOT in scene (legendary artifact, rare loot at a dungeon elsewhere, an item someone said they own).

Skip generic/environmental ambience (walls, floors, trees) unless they're a specific interactable.

========== DOMAIN 3: LOCATIONS ==========
Places.

  ACCESSIBLE — exits, doors, paths, stairways directly visible from this scene that the party could move toward. A door to the back room, an alley east, a stairway up.
  MENTIONED — named places talked about but not directly reachable from here. The Temple of Desna, the Mayor's Manor, a dungeon on another continent.

========== DOMAIN 4: FACTIONS ==========
Organizations, families, guilds, cults, military bodies mentioned or present. Include a disposition_signal hint if the paragraph conveys how the faction is regarded ("the Scarnettis have been squeezing out competitors" → suspicious/hostile signal toward Scarnettis).

========== DOMAIN 5: QUESTS ==========
Explicit player-directed tasks AND softer quest hooks. Both go in this bucket with a kind field.

  kind: "job" — explicit ask with a task, usually a reward ("Clear my basement for 200gp").
  kind: "hook" — softer setup or invitation that could become adventure (a rumor pointing at a specific locale, a missing-person plea, a mystery the NPC wants solved).

Not every quest has a reward; leave reward empty if unstated. Capture the giver (who offered it) and a task summary.

========== DOMAIN 6: RUMORS ==========
Softer world information that isn't itself a quest: gossip, practical tips ("don't take the coast road at night"), foreshadowing, warnings, overheard chatter. Attach the source (who said it) and a reliability signal.

========== DOMAIN 7: CLUES ==========
Investigative breadcrumbs.

  revealed — new information pointing at an unresolved mystery/question (who killed X, what's in the locked vault, why does the ritual require a silver moon).
  resolved — the party just confirmed/disproved a prior lead.

Clues usually appear in mystery/investigation scenes. Most paragraphs will have none — empty arrays are normal.

========== DOMAIN 8: LORE ==========
World facts presented as authoritative knowledge. Different from rumors (which are unverified chatter) and clues (which point at specific unresolved mysteries). Lore is general world-building: historical events, geography, religion, culture, creature knowledge, legends, politics, magical phenomena.

Examples: "The Old Light was built by giants long before the town" (history). "Desna's symbol is the butterfly" (religion). "Goblin raids increase on moonless nights" (creature). "The Scarnetti family has owned the mills for three generations" (politics/history).

Classify each lore entry with a category from: history, geography, religion, culture, creature, legend, politics, magic.

========== DOMAIN 9: DESTRUCTIONS ==========
Narratively-significant status changes to PLACES the party knows about. Only extract when the paragraph asserts a place has been fundamentally altered — not combat damage, not routine wear, but a change that should affect future travel or references to that place.

  status: "destroyed" — burned down, collapsed, caved in, sunk, razed, blown apart. The place is effectively gone or unreachable as itself.
  status: "sealed" — locked shut, barricaded, warded, magically closed, quarantined, walled off. The place exists but cannot be entered without intervention.

Ignore vague hints ("something happened at the cathedral") — those are rumors or clues, not destructions. Require a clear past-tense assertion or causal verb ("The manor burned to the ground last night", "The crypt door was sealed with silver bands", "The east wing of the keep collapsed in the storm").

Ignore combat damage to buildings/objects that doesn't amount to destruction of the whole place. A broken window, a cracked wall, a torn banner — none of these count.

target = the place name as it appears in the paragraph (e.g. "Foxglove Manor", "the Old Light", "Thistletop"). Use the most specific identifiable name. Do NOT use a generic descriptor like "the manor" if no proper name is given — prefer to emit nothing in that case.

reason = one-sentence account of what happened, drawn from the paragraph.

========== GLOBAL RULES ==========
1. Evidence spans are VERBATIM substrings of the paragraph, ≤120 chars each. No paraphrase.
2. PC names listed in the context are NEVER extracted — they are the party.
3. Known NPCs in the context are already on record; only include if classification changed.
4. Do not invent. Only extract what the paragraph contains.
5. Empty arrays are fine. Partial data is fine (e.g. no clues found → clues: { revealed: [], resolved: [] }).
6. Output is a single JSON object matching the shape below. No code fences. No trailing comment.

========== OUTPUT SHAPE ==========
{
  "npcs": {
    "present": [{ "name": string, "race": string, "occupation": string, "disposition": string, "shortDesc": string, "evidence": string }],
    "mentioned": [{ "name": string, "relationship": string, "status": "alive"|"unknown", "evidence": string }],
    "historical": [{ "name": string, "relationship": string, "context": string, "evidence": string }]
  },
  "items": {
    "present": [{ "name": string, "description": string, "interactable": boolean, "evidence": string }],
    "mentioned": [{ "name": string, "description": string, "context": string, "evidence": string }]
  },
  "locations": {
    "accessible": [{ "name": string, "kind": "door"|"stairway"|"path"|"passage"|"room"|"building"|"other", "direction": string, "evidence": string }],
    "mentioned": [{ "name": string, "kind": "town"|"building"|"region"|"wilderness"|"landmark"|"unknown", "context": string, "evidence": string }]
  },
  "factions": [{ "name": string, "archetype": "guild"|"criminal"|"religious"|"noble_family"|"military"|"merchant_house"|"government"|"cult"|"other", "disposition_signal": "friendly"|"neutral"|"suspicious"|"hostile"|"mixed"|"unknown", "evidence": string }],
  "quests": [{ "title": string, "kind": "job"|"hook", "giver": string, "task": string, "reward": string, "location": string, "urgency": "low"|"medium"|"high", "evidence": string }],
  "rumors": [{ "content": string, "source": string, "reliability": "credible"|"uncertain"|"dubious", "evidence": string }],
  "clues": {
    "revealed": [{ "content": string, "topic": string, "evidence": string }],
    "resolved": [{ "topic": string, "resolution": string, "evidence": string }]
  },
  "lore": [{ "topic": string, "category": "history"|"geography"|"religion"|"culture"|"creature"|"legend"|"politics"|"magic", "fact": string, "evidence": string }],
  "destructions": [{ "target": string, "status": "destroyed"|"sealed", "reason": string, "evidence": string }]
}

Field notes:
- NPC race: lowercase PF1e race if inferrable, else "Human".
- NPC occupation: one or two words, else "unknown".
- NPC disposition: "friendly"|"neutral"|"suspicious"|"hostile" from paragraph behavior, else "neutral".
- shortDesc ≤100 chars.
- Location direction: "north"|"south"|"east"|"west"|"up"|"down"|"in"|"out" or "" if unclear.
- Quest urgency: "high" if time-pressed or life-threatening; "low" if casual/hook-only; else "medium".
- Rumor reliability: "credible" (reliable source, firsthand), "uncertain" (secondhand, plausible), "dubious" (tavern gossip, superstition).`;

function buildUserMessage({ narrationText, partyNames, knownNpcNames, locationName }) {
  const lines = [];
  if (locationName) lines.push(`Location: ${locationName}`);
  if (Array.isArray(partyNames) && partyNames.length > 0) {
    lines.push(`Party members (NOT NPCs — never extract): ${partyNames.join(', ')}`);
  }
  if (Array.isArray(knownNpcNames) && knownNpcNames.length > 0) {
    // Truncate a long roster — 40 names is plenty for dedup. Extractor
    // seeing "Bertha Cray" in the known-list won't re-emit her unless
    // her classification changed (e.g. was mentioned, now present).
    const truncated = knownNpcNames.slice(0, 40);
    const suffix = knownNpcNames.length > 40 ? `, …(${knownNpcNames.length - 40} more)` : '';
    lines.push(`Already-known NPCs (skip unless classification changed): ${truncated.join(', ')}${suffix}`);
  }
  lines.push('');
  lines.push('Paragraph:');
  lines.push(narrationText);
  lines.push('');
  lines.push('Return the JSON object matching the 9-domain output shape. JSON only.');
  return lines.join('\n');
}

/**
 * Defensive JSON parse. Strips ```json fences and leading prose the
 * model sometimes prepends despite "JSON only" instructions. Returns
 * null on parse failure so the caller falls back to ENTITIES+heuristic.
 */
function parseJSONResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) text = fence[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  const sliced = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(sliced);
  } catch {
    return null;
  }
}

// Empty result used by all error paths. Every domain is always present
// so callers never need to null-check at routing time.
function emptyResult() {
  return {
    npcs: { present: [], mentioned: [], historical: [] },
    items: { present: [], mentioned: [] },
    locations: { accessible: [], mentioned: [] },
    factions: [],
    quests: [],
    rumors: [],
    clues: { revealed: [], resolved: [] },
    lore: [],
    destructions: [],
  };
}

const normStr = (v) => (typeof v === 'string' ? v.trim() : '');
const asArr = (v) => (Array.isArray(v) ? v : []);
const asBool = (v) => v === true || v === 'true';

function normalizeResult(parsed) {
  const out = emptyResult();
  if (!parsed || typeof parsed !== 'object') return out;

  // ---- npcs ----
  const npcs = parsed.npcs || {};
  for (const row of asArr(npcs.present)) {
    const name = normStr(row?.name);
    if (!name) continue;
    out.npcs.present.push({
      name,
      race: normStr(row?.race) || 'Human',
      occupation: normStr(row?.occupation) || 'unknown',
      disposition: normStr(row?.disposition) || 'neutral',
      shortDesc: normStr(row?.shortDesc),
      evidence: normStr(row?.evidence),
    });
  }
  for (const row of asArr(npcs.mentioned)) {
    const name = normStr(row?.name);
    if (!name) continue;
    out.npcs.mentioned.push({
      name,
      relationship: normStr(row?.relationship),
      status: normStr(row?.status) === 'unknown' ? 'unknown' : 'alive',
      evidence: normStr(row?.evidence),
    });
  }
  for (const row of asArr(npcs.historical)) {
    const name = normStr(row?.name);
    if (!name) continue;
    out.npcs.historical.push({
      name,
      relationship: normStr(row?.relationship),
      context: normStr(row?.context),
      evidence: normStr(row?.evidence),
    });
  }

  // ---- items ----
  const items = parsed.items || {};
  for (const row of asArr(items.present)) {
    const name = normStr(row?.name);
    if (!name) continue;
    out.items.present.push({
      name,
      description: normStr(row?.description),
      interactable: row?.interactable === undefined ? true : asBool(row.interactable),
      evidence: normStr(row?.evidence),
    });
  }
  for (const row of asArr(items.mentioned)) {
    const name = normStr(row?.name);
    if (!name) continue;
    out.items.mentioned.push({
      name,
      description: normStr(row?.description),
      context: normStr(row?.context),
      evidence: normStr(row?.evidence),
    });
  }

  // ---- locations ----
  const locations = parsed.locations || {};
  const ACCESSIBLE_KINDS = new Set(['door', 'stairway', 'path', 'passage', 'room', 'building', 'other']);
  const MENTIONED_KINDS = new Set(['town', 'building', 'region', 'wilderness', 'landmark', 'unknown']);
  for (const row of asArr(locations.accessible)) {
    const name = normStr(row?.name);
    if (!name) continue;
    const kind = normStr(row?.kind);
    out.locations.accessible.push({
      name,
      kind: ACCESSIBLE_KINDS.has(kind) ? kind : 'other',
      direction: normStr(row?.direction),
      evidence: normStr(row?.evidence),
    });
  }
  for (const row of asArr(locations.mentioned)) {
    const name = normStr(row?.name);
    if (!name) continue;
    const kind = normStr(row?.kind);
    out.locations.mentioned.push({
      name,
      kind: MENTIONED_KINDS.has(kind) ? kind : 'unknown',
      context: normStr(row?.context),
      evidence: normStr(row?.evidence),
    });
  }

  // ---- factions ----
  const FACTION_ARCHETYPES = new Set([
    'guild', 'criminal', 'religious', 'noble_family', 'military',
    'merchant_house', 'government', 'cult', 'other',
  ]);
  const DISPOSITIONS = new Set(['friendly', 'neutral', 'suspicious', 'hostile', 'mixed', 'unknown']);
  for (const row of asArr(parsed.factions)) {
    const name = normStr(row?.name);
    if (!name) continue;
    const archetype = normStr(row?.archetype);
    const dispo = normStr(row?.disposition_signal);
    out.factions.push({
      name,
      archetype: FACTION_ARCHETYPES.has(archetype) ? archetype : 'other',
      disposition_signal: DISPOSITIONS.has(dispo) ? dispo : 'unknown',
      evidence: normStr(row?.evidence),
    });
  }

  // ---- quests ----
  const URGENCIES = new Set(['low', 'medium', 'high']);
  for (const row of asArr(parsed.quests)) {
    const title = normStr(row?.title);
    const task = normStr(row?.task);
    if (!title && !task) continue; // need at least one of them
    const kind = normStr(row?.kind);
    const urgency = normStr(row?.urgency);
    out.quests.push({
      title: title || task.slice(0, 60),
      kind: kind === 'job' ? 'job' : 'hook',
      giver: normStr(row?.giver),
      task,
      reward: normStr(row?.reward),
      location: normStr(row?.location),
      urgency: URGENCIES.has(urgency) ? urgency : 'medium',
      evidence: normStr(row?.evidence),
    });
  }

  // ---- rumors ----
  const RELIABILITIES = new Set(['credible', 'uncertain', 'dubious']);
  for (const row of asArr(parsed.rumors)) {
    const content = normStr(row?.content);
    if (!content) continue;
    const reliability = normStr(row?.reliability);
    out.rumors.push({
      content,
      source: normStr(row?.source),
      reliability: RELIABILITIES.has(reliability) ? reliability : 'uncertain',
      evidence: normStr(row?.evidence),
    });
  }

  // ---- clues ----
  const clues = parsed.clues || {};
  for (const row of asArr(clues.revealed)) {
    const content = normStr(row?.content);
    if (!content) continue;
    out.clues.revealed.push({
      content,
      topic: normStr(row?.topic),
      evidence: normStr(row?.evidence),
    });
  }
  for (const row of asArr(clues.resolved)) {
    const topic = normStr(row?.topic);
    const resolution = normStr(row?.resolution);
    if (!topic && !resolution) continue;
    out.clues.resolved.push({
      topic,
      resolution,
      evidence: normStr(row?.evidence),
    });
  }

  // ---- lore ----
  const LORE_CATEGORIES = new Set([
    'history', 'geography', 'religion', 'culture',
    'creature', 'legend', 'politics', 'magic',
  ]);
  for (const row of asArr(parsed.lore)) {
    const fact = normStr(row?.fact);
    if (!fact) continue;
    const category = normStr(row?.category);
    out.lore.push({
      topic: normStr(row?.topic),
      category: LORE_CATEGORIES.has(category) ? category : 'history',
      fact,
      evidence: normStr(row?.evidence),
    });
  }

  // ---- destructions (Task #64) ----
  // Enum-strict on status: rows without a valid status are dropped, not
  // coerced to a default. A "destroyed or sealed" flag is load-bearing —
  // miscoercing "unknown" to "destroyed" would cause setNodeStatus to wipe
  // a location on every unreliable LLM emission.
  const DESTRUCTION_STATUSES = new Set(['destroyed', 'sealed']);
  for (const row of asArr(parsed.destructions)) {
    const target = normStr(row?.target);
    if (!target) continue;
    const status = normStr(row?.status);
    if (!DESTRUCTION_STATUSES.has(status)) continue;
    out.destructions.push({
      target,
      status,
      reason: normStr(row?.reason),
      evidence: normStr(row?.evidence),
    });
  }

  return out;
}

/**
 * Main entry point. Given a narration paragraph + scene context, return
 * all Tier 1 domains in a single structured response.
 *
 * @param {string} narrationText
 * @param {object} [opts]
 * @param {string[]} [opts.partyNames]
 * @param {string[]} [opts.knownNpcNames]
 * @param {string}   [opts.locationName]
 * @returns {Promise<ReturnType<typeof emptyResult> & { source: 'llm'|'skipped'|'error', latencyMs?: number, error?: string }>}
 */
export async function extractSceneEntities(narrationText, opts = {}) {
  if (!narrationText || typeof narrationText !== 'string') {
    return { ...emptyResult(), source: 'skipped', error: 'no-text' };
  }
  if (narrationText.trim().length < MIN_NARRATION_LEN) {
    return { ...emptyResult(), source: 'skipped', error: 'too-short' };
  }

  const settings = getExtractionSettings();
  if (!settings.apiKey || settings.apiKey.length < 10) {
    return { ...emptyResult(), source: 'skipped', error: 'no-api-key' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const userMessage = buildUserMessage({
      narrationText,
      partyNames: opts.partyNames || [],
      knownNpcNames: opts.knownNpcNames || [],
      locationName: opts.locationName || '',
    });

    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: EXTRACTION_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return {
        ...emptyResult(),
        source: 'error',
        error: `http-${response.status}: ${bodyText.slice(0, 200)}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    const data = await response.json();
    const rawText = data?.content?.[0]?.text || '';
    const parsed = parseJSONResponse(rawText);
    const normalized = normalizeResult(parsed);

    // Bug #29 diagnostic (2026-04-20): when parsing fails OR normalized is
    // suspiciously empty for rich narration, dump the raw LLM response
    // preview to console so we can see WHAT the model returned. Empty
    // zero-domain result on a long prompt is almost always a JSON-shape
    // regression or the LLM refusing to emit JSON.
    try {
      const totalExtracted =
        (normalized.npcs?.present?.length || 0) +
        (normalized.npcs?.mentioned?.length || 0) +
        (normalized.npcs?.historical?.length || 0) +
        (normalized.locations?.accessible?.length || 0) +
        (normalized.locations?.mentioned?.length || 0) +
        (normalized.factions?.length || 0) +
        (normalized.quests?.length || 0) +
        (normalized.rumors?.length || 0) +
        (normalized.clues?.revealed?.length || 0) +
        (normalized.clues?.resolved?.length || 0) +
        (normalized.lore?.length || 0);
      if (parsed === null || totalExtracted === 0) {
        // eslint-disable-next-line no-console
        console.warn('[sceneExtractionLLM] empty or unparseable response', {
          parsedOk: parsed !== null,
          rawTextLength: rawText.length,
          rawTextPreview: rawText.slice(0, 800),
          rawTextTail: rawText.length > 800 ? rawText.slice(-400) : '',
          narrationLength: narrationText.length,
          narrationPreview: narrationText.slice(0, 200),
        });
      }
    } catch { /* diagnostic never blocks return */ }

    return {
      ...normalized,
      source: 'llm',
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
    return {
      ...emptyResult(),
      source: 'error',
      error: msg,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Back-compat alias — earlier work named the service npcExtractionLLM
// with an extractNPCsLLM export. Nothing depends on it yet (#58 was
// still being wired when we expanded scope), but keep the alias so a
// stale import doesn't break the build.
export const extractNPCsLLM = extractSceneEntities;

// Exposed for unit testing of the pure-logic helpers. The actual API
// call is not testable without a live key — tests mock at the
// extractSceneEntities level.
export const _internal = {
  SYSTEM_PROMPT,
  MIN_NARRATION_LEN,
  buildUserMessage,
  parseJSONResponse,
  normalizeResult,
  emptyResult,
  getExtractionSettings,
};
