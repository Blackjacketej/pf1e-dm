# pf1e-source-scrape — Locations → world tree subsection (paste-ready patch)

Drop this subsection into `skills/pf1e-source-scrape/SKILL.md` alongside the existing target-format routing table. It codifies the Phase 1 Sandpoint seed-expansion workflow shipped 2026-04-17 so future location-scraping runs follow the same pattern.

---

## Locations → world tree

Location scraping is when you extract place data from a PF1e source (AP book, gazetteer, Ultimate Campaign region notes) and land it in the world tree at `src/data/worldTreeSeeds.js`. This is distinct from rules/feats/NPCs — locations carry a structural contract (parent-child adjacency, hub routing, interior depth) that the travel system depends on.

### Source hierarchy

Prefer sources in this order when they overlap:

1. **Focused gazetteer** when it exists (e.g. *Sandpoint, Light of the Lost Coast.pdf* for Sandpoint). Deepest interior detail, most canonical NPC pinning.
2. **AP book** (*Rise of the Runelords Anniversary Edition.pdf*) for cross-location coverage — the town gazetteer usually only covers one settlement; the AP carries the region, the neighboring towns, the dungeons, and the Chapter-N adventure sites.
3. **Existing project data** (`src/data/sandpointMap.json`, `src/data/shops.json`, `src/data/sandpoint.json`) for breadth cross-check. These are pre-hydrated canonical rosters with NPCs + services attached, useful as a checklist to confirm you haven't dropped a named building.
4. **Ultimate Campaign** only for mechanical scaffolding (downtime phase, organization mechanics) — not a source of canonical places.

Canonical content verification follows the same PDF-over-memory rule as the CRB audit (see `feedback_crb_pdf_source.md`). Use `pdftotext -layout pdfs/<source>.pdf /tmp/<name>.txt` and grep for the location by name before writing structure.

### Node-kind taxonomy (enforced by `NODE_KINDS` in `worldTree.js`)

Use the correct `kind` field on every node — it drives the default map generator, the travel picker's iconography, and the child-kind inference in `createChildAtActive`:

- **WORLD / CONTINENT / COUNTRY / REGION / PLANE** — geographic container tiers. Match the AP's own geographic slicing.
- **TOWN / CITY / VILLAGE** — settlement tiers. Sandpoint = TOWN; Magnimar = CITY; Galduria = VILLAGE. Settlements MUST have a `defaultEntry` hub child (see below).
- **WILDERNESS / LANDMARK** — outdoor-without-structure (forests, roads, hex-travel waypoints).
- **DUNGEON** — adventure site with interior structure.
- **BUILDING** — named discrete structure inside a settlement. Gets seeded with interior children only if canonical (see scope rule below).
- **FLOOR** — named floor of a multi-level building. Use sparingly; only when the source calls out distinct floors with distinct contents (Rusty Dragon Ground / Upper / Basement qualifies).
- **ROOM** — named room inside a building/floor. Seed only when the source names it.
- **AREA** — open sub-zone. Use for town hubs (`Main Road`), town plazas (`Market Square`), outdoor courtyards (`Stone Circle Courtyard`), dock zones (`The Docks`).

### Hub + defaultEntry pattern (CRITICAL for travel)

Every town/city/village node MUST have a `defaultEntry` string pointing to an AREA-kind hub child. The travel model is:

```
World map hex → town (auto-descend to hub) → siblings-from-hub → building interiors
```

When the party crosses into a town from hex travel they land at the hub, not the town-container itself. The hub is the "go back to hex travel" staging area — backing out ascends to the town, ascending again ascends to the region.

For Sandpoint that's:

```javascript
{
  name: 'Sandpoint',
  kind: NODE_KINDS.TOWN,
  defaultEntry: 'Main Road',  // auto-descend target
  children: [
    { name: 'Main Road', kind: NODE_KINDS.AREA, desc: "..." },  // the hub
    { name: 'Market Square', kind: NODE_KINDS.AREA, ... },
    { name: 'The Docks', kind: NODE_KINDS.AREA, children: [...] },
    { name: 'The Rusty Dragon', kind: NODE_KINDS.BUILDING, defaultEntry: 'Ground Floor', children: [...] },
    // ...30+ more siblings
  ]
}
```

Multi-level buildings also use `defaultEntry` to pick the ground floor / main floor on entry, and floors use it to pick the most-trafficked room. Omit `defaultEntry` for buildings/areas without an obvious entry point — the party just lands at the container.

The `defaultEntry` string is matched case-insensitively against child `name` fields (same resolver as `addBelow`). Misspelling the target is silent; test it.

### Seed scope — canonical interiors only

**DO** seed interior structure for:
- Locations the AP treats as recurring scene spaces across multiple chapters (Sandpoint: Rusty Dragon, Cathedral, Garrison, Town Hall all qualify).
- Locations with named NPCs living/working at specific sub-locations the party will routinely visit.
- Multi-level buildings where the source explicitly describes floor-by-floor contents.

**DO NOT** seed interior structure for:
- Named buildings the AP mentions once or only in passing (most manors, most shops, most guildhalls).
- Generic building types (inns, smithies, general stores) that aren't differentiated from their peers in the source.
- Anything the party might enter but the source doesn't enumerate — interiors will spawn via Phase 2 narrative-driven auto-spawn when the DM actually narrates the party entering them.

Rule of thumb: if the source has a paragraph or more of interior detail (room names, layout diagram, NPC pinning per room), seed the interior. If it's a single-line gazetteer entry ("Savah's Armory is a well-stocked weapon shop"), seed the BUILDING with no children.

This keeps the seed tree tight (the travel picker's sibling list shouldn't overwhelm), while leaving headroom for narrative-driven spawn to fill in the rest organically.

### ensureSeedInTree is an unconditional mount-time backfill

Per the #30 fix, `ensureSeedInTree(tree, settingKey)` now runs on every AdventureTab mount + worldTree-swap — not only during first-time migration from #37 subLocations. This means:

- **Existing campaigns inherit seed expansions automatically.** When you land a new location in `worldTreeSeeds.js`, Tom's current saves get the new nodes on next load without any migration step.
- **Idempotent.** Case-insensitive name match in `addBelow` prevents duplicates; second-pass is a no-op.
- **Case-sensitive display, case-insensitive match.** A node saved as "Rusty Dragon" (from an older seed) won't duplicate against seed-defined "The Rusty Dragon" — but the display name stays whatever the existing save has. Prefer seed names that match the canonical source exactly; old saves will display the old name until manually cleaned up.

If you need to rename an existing node in the seed, you can't rely on `ensureSeedInTree` alone — it only adds, never modifies. Plan a separate migration step.

### Regression test contract

Every seed expansion extends `worldTreeSeeds.test.mjs` at project root. Required coverage:

1. **Backbone integrity** — the full path (World → Country → Region → Town) resolves and each node has the expected `kind`.
2. **defaultEntry wiring** — the town's `defaultEntry` string matches a real child node name (case-insensitive).
3. **Sibling count** — assert ≥ N children under the settlement (guards against accidental deletion).
4. **Canonical interior structure** — for each seeded canonical building, assert its floor/room children exist with expected kinds.
5. **Outdoor sub-area children** — for AREA nodes with children (e.g. The Docks), assert the children exist.
6. **ensureSeedInTree backfill** — build a minimal pre-expansion tree (just the town container + one canonical child), run `ensureSeedInTree`, assert the full expected depth was backfilled. This is the single most important test because it catches the actual shipping scenario: existing saves updating after a seed expansion.
7. **Second-pass no-op** — run `ensureSeedInTree` twice, assert the second call adds zero nodes.
8. **Key sibling visibility** — pick a few representative siblings (Market Square, The Docks, The Rusty Dragon) and assert they're reachable via `getChildren(townNode)` — this is what the travel picker reads.

Run with `npx vite-node worldTreeSeeds.test.mjs`. Sandbox may hit bindfs mount lag per `feedback_sandbox_mount_lag.md` — if `bash cat` disagrees with the Read tool, trust Read and defer build-verify to Windows.

### Workflow summary

1. Extract source content: `pdftotext -layout pdfs/<source>.pdf > /tmp/src.txt`, grep for the location.
2. Cross-reference `src/data/sandpointMap.json` / `shops.json` / `sandpoint.json` for breadth (don't miss a named building).
3. Draft the node structure on paper: what's the hub? which buildings get canonical interiors? which are bare BUILDINGs?
4. Edit `src/data/worldTreeSeeds.js`, landing new children in alphabetical or thematic order.
5. Extend `worldTreeSeeds.test.mjs` with the 8-point checklist above for the new content.
6. Update `project_world_tree.md` if you changed the hub pattern, depth policy, or `ensureSeedInTree` semantics. Location content itself doesn't need a memory entry — `git log worldTreeSeeds.js` carries that.
7. Log the expansion in `project_backlog.md` under "Shipped this arc" with the canonical-source citation.

---

**Reference implementation:** the Phase 1 Sandpoint expansion (2026-04-17) — expanded from 6 children to 37+, canonical interiors for Rusty Dragon/Cathedral/Garrison/Town Hall, Main Road hub, 25+ bare buildings. See backlog entry + `worldTreeSeeds.test.mjs` for the shape to copy.
