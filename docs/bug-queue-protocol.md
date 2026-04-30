# Bug Queue & Playthrough Log Protocol

This document describes the in-game rules-audit infrastructure: how bugs get
captured during play, how the playthrough log records every rules event, and
the workflow for reviewing them in Cowork.

## Two complementary capture channels

| Channel | What it captures | Signal | Recall |
|---|---|---|---|
| **Bug button** (manual) | What *the operator notices* | High | Bounded by attention |
| **Playthrough log** (automatic) | *Every* rules resolution | Lower | Complete |

The bug button is great for "this looks wrong, freeze it now." The playthrough
log is great for "let me re-read the whole session and find what I missed."
Together they cover both halves of the bug-finding problem.

## Architecture

```
gameplay action
   |
   v
dmEngine.resolveSkillCheck(...)            <-- choke point
   |
   +--> rulesEngine.computeSkillCheck      <-- pure resolver
   |
   +--> playLog.logRulesEvent {            <-- fire-and-forget
           kind, character, skill,
           input, output, summary
        }
            |
            v
         IndexedDB (playLogEvents table)
            +
         in-memory ring (last 50)
                  |
                  v
       BugReportButton snapshot
            (reads getLastEvent / getRecentEvents)
                  |
                  v
       bugQueue.appendBug
                  |
                  v
       IndexedDB (bugReports table)
```

## Files

| File | Role |
|---|---|
| `src/db/database.js` | Dexie v8 schema — adds `bugReports` and `playLogEvents` tables |
| `src/services/playLog.js` | Append-only firehose — `logRulesEvent`, `getLastEvent`, `exportLogAsMarkdown`, `clearPlayLog` |
| `src/services/bugQueue.js` | Manual queue — `appendBug`, `listBugs`, `markResolved`, `exportQueueAsMarkdown` |
| `src/services/dmEngine.js` | Wires `logRulesEvent` into `resolveSkillCheck` |
| `src/components/BugReportButton.jsx` | Floating bug icon + capture modal + queue viewer |
| `src/components/AdventureTab.jsx` | Mounts the bug button |

## Capture workflow (during play)

1. Operator notices something off ("hmm, that tumble through enemy felt wrong")
2. Clicks the floating 🐞 button (bottom-right of Adventure tab)
3. Modal opens with the **last rules event auto-snapshotted** into the
   "captured context" textarea — operator can edit if the snapshot is wrong
4. Operator types description, picks severity (`crit` / `major` / `minor` / `cosmetic`)
5. Submit → entry persists to IndexedDB
6. Badge on the bug button shows the count of open bugs

The operator can also click "View queue" from inside the modal (or after
clicking the button when there's nothing to report) to see the current queue
and export it.

## Drain workflow (in Cowork)

When the user asks me to drain the bug queue or review the playthrough log,
I should:

### A. Drain the bug queue

1. Read every entry currently marked `open` (use the "Export queue.md" button
   in-app, or read directly from IndexedDB if automated).
2. For each entry, in order of severity (`crit` → `major` → `minor` → `cosmetic`):
   1. Read the `text` and `capturedContext`
   2. Find the relevant code in `src/utils/rulesEngine.js` or
      `src/services/dmEngine.js`
   3. Determine whether the bug is real, by reading the CRB rules and
      checking the resolver against them
   4. If real: write a fix
   5. Add or extend a unit test that catches the bug
   6. After the test passes, mark the entry resolved with a one-line
      `resolutionNote` (e.g. the commit hash or a brief description)
   7. If not real: mark resolved with `resolutionNote: "not a bug — <reason>"`
3. Build the project to verify clean compilation
4. Report a summary back: how many resolved, how many real bugs, links to fixes

### B. Review the playthrough log

1. Read the exported log (export from app via "Export session log" or
   "Export full log")
2. Scan event-by-event for CRB-fidelity issues:
   - Wrong DC for the situation
   - Wrong base bonus
   - Missing feat/racial/class bonus
   - Stale GM-prompt advice (compare against `dmEngine.js` system prompt text)
   - Modifier double-counting
   - Take 10/Take 20 used in a forbidden situation
3. For each suspicious event, decide whether it's:
   - **Definitely a bug** → file directly into the bug queue (with the
     event JSON as captured context)
   - **Possibly a bug** → flag and ask the user
   - **Working as intended** → skip
4. Hand the queue back to the user for confirmation, then drain (workflow A)

## Severity guidelines

| Severity | Meaning | Examples |
|---|---|---|
| `crit` | Game-breaking or character-deleting | wrong save type kills the wizard, infinite loot loop |
| `major` | Wrong number that affects play outcome | DC off by 5, damage off by half, missing condition penalty |
| `minor` | Small numeric or logic drift | breakdown formatting wrong, modifier listed twice, GM prompt advice stale |
| `cosmetic` | UI/text only — no rules impact | color is hard to read, label truncated, wrong icon |

When in doubt, pick the higher severity — the queue is for *triaging*, not
for downplaying.

## Privacy / hygiene notes

- Both the play log and the bug queue live in IndexedDB **on the user's
  machine only**. Nothing is sent anywhere automatically.
- The play log can grow unbounded. Operators should clear it via the
  "Clear play log" button periodically, or after each session.
- Exports go to the user's Downloads folder via standard browser download.
- Logging is fail-soft: if IndexedDB is broken or full, gameplay continues
  and a `console.warn` is emitted but no error reaches the player.
