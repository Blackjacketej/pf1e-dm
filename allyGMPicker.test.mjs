// allyGMPicker.test.mjs -- Phase C.3 (GM ally picker) + Phase C.4 (Player
// ally picker) regression coverage. File name is historical -- the picker
// was generalized in Phase C.4 to cover both 'gm' and 'player' control
// modes under one UI + one set of handlers.
//
// Inline-mirror of the production behavior per feedback_sandbox_mount_lag.md:
// OneDrive bindfs cache can serve truncated files under the Linux sandbox,
// so tests that import from src/ will fail intermittently. We copy the
// minimum logic under test into this file and run it natively via plain
// `node allyGMPicker.test.mjs`.
//
// What Phase C.3 shipped in CombatTab.jsx:
//   1. An auto-advance useEffect branching on ally.controlMode:
//        'ai'     -> handleAllyTurn (same as Phase C.1)
//        'gm'     -> NO auto-advance -- GM picker renders, turn advances
//                    when GM clicks a button
//        'player' -> auto-pass (Phase C.4 will replace)
//        missing  -> treated as 'ai' (default for pre-Phase-A saves)
//   2. Three GM handlers: Attack / Defend / Pass
//        - handleGMAllyAttack -> delegates to handleAllyTurn
//        - handleGMAllyDefend -> stamps total_defense condition (dur 1)
//                                + logs + advances turn
//        - handleGMAllyPass   -> logs + advances turn
//   3. A gate: all three handlers no-op when !isGMAllyTurn (prevents a
//      stale click from firing mid-transition).
//
// Coverage:
//   (a) Auto-advance routing: 4 cases (ai / gm / player / missing)
//   (b) handleGMAllyDefend applies the correct condition shape
//   (c) handleGMAllyPass advances turn without side effects
//   (d) handleGMAllyAttack calls the AI ally handler
//   (e) Gating: non-GM-turn clicks are ignored
//   (f) isGMAllyTurn derivation: ally present + controlMode='gm' only
//
// Run with:  node allyGMPicker.test.mjs

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  PASS', label); }
  else { fail++; console.log('  FAIL', label, '\n    actual  :', JSON.stringify(actual), '\n    expected:', JSON.stringify(expected)); }
}
function truthy(v, label) {
  if (v) { pass++; console.log('  PASS', label); }
  else { fail++; console.log('  FAIL', label); }
}
function falsy(v, label) {
  if (!v) { pass++; console.log('  PASS', label); }
  else { fail++; console.log('  FAIL', label, '\n    actual  :', JSON.stringify(v)); }
}
function section(name) { console.log('\n-- ' + name + ' --'); }

// -- Inline-mirror: auto-advance branch selector --------------------------
// Mirrors the useEffect at CombatTab.jsx auto-advance block. Returns a
// symbolic action tag so the test doesn't need real timers / state.
// Keep this in lock-step with the production useEffect block.
//
// Phase C.4: both 'gm' and 'player' modes now skip auto-advance (picker
// drives turn progression for both). Unknown/future modes fall through
// to auto-pass so the turn order never wedges.
function pickAllyAutoAdvance(ally) {
  const mode = ally?.controlMode || 'ai';
  if (mode === 'ai') return 'handleAllyTurn';
  if (mode === 'gm' || mode === 'player') return 'no-auto-advance';
  return 'auto-pass';  // unknown modes fall through
}

// -- Inline-mirror: isGMAllyTurn / isPlayerAllyTurn / isInteractiveAllyTurn
// Mirrors the three derivations in CombatTab.jsx:
//   isGMAllyTurn          = isAllyTurn && controlMode === 'gm'
//   isPlayerAllyTurn      = isAllyTurn && controlMode === 'player'
//   isInteractiveAllyTurn = isGMAllyTurn || isPlayerAllyTurn
// isAllyTurn requires a matching id + positive currentHP.
function deriveIsGMAllyTurn(currentCombatant, allies) {
  if (!currentCombatant) return false;
  const a = allies.find(x => x.id === currentCombatant.id && x.currentHP > 0);
  if (!a) return false;
  return (a.controlMode || 'ai') === 'gm';
}
function deriveIsPlayerAllyTurn(currentCombatant, allies) {
  if (!currentCombatant) return false;
  const a = allies.find(x => x.id === currentCombatant.id && x.currentHP > 0);
  if (!a) return false;
  return (a.controlMode || 'ai') === 'player';
}
function deriveIsInteractiveAllyTurn(currentCombatant, allies) {
  return deriveIsGMAllyTurn(currentCombatant, allies)
      || deriveIsPlayerAllyTurn(currentCombatant, allies);
}

// -- Inline-mirror: total_defense condition template ---------------------
// Mirrors conditionTracker.js PF1E_CONDITIONS.total_defense.
const TOTAL_DEFENSE_TEMPLATE = {
  name: 'Total Defense',
  severity: 'buff',
  description: '+4 AC (or +6 with 3+ ranks in Acrobatics). Cannot attack.',
  modifiers: { ac: 4, cannotAttack: true },
};

// Mirrors createCondition('total_defense', { duration: 1, source: '...' }).
// Returned object shape must match what the setCombat call stamps onto
// ally.conditions[]. appliedAt is best-effort — we zero it for test
// determinism.
function createCondition(conditionId, options = {}) {
  if (conditionId !== 'total_defense') return null;  // only what we need
  const t = TOTAL_DEFENSE_TEMPLATE;
  return {
    id: conditionId,
    name: t.name,
    severity: t.severity,
    description: t.description,
    modifiers: { ...t.modifiers, ...(options.customMods || {}) },
    duration: options.duration || null,
    source: options.source || 'unknown',
    appliedAt: 0,
    roundsRemaining: options.duration || null,
  };
}

// -- Inline-mirror: interactive handlers (Phase C.3 gm + Phase C.4 player) --
// The handlers mutate an ephemeral world state we pass in, record log
// entries, and return a 'next-turn' flag. Matches handleInteractive*
// in CombatTab.jsx -- shared by both 'gm' and 'player' modes.
//
// The gate `isInteractiveAllyTurn` covers both modes. Defend's `source`
// tag is mode-aware so live-play telemetry distinguishes player-triggered
// total_defense from GM-triggered.
//
// The legacy runGMAlly* wrappers below delegate to runInteractive* so the
// old Phase C.3 tests keep passing under the new gate.
function runInteractiveAllyDefend(state) {
  if (!state.isInteractiveAllyTurn || !state.activeAlly) return state;
  const mode = state.activeAllyMode || 'gm';
  const cond = createCondition('total_defense', {
    duration: 1,
    source: mode === 'player' ? 'player-ally-defend' : 'gm-ally-defend',
  });
  const nextAllies = state.allies.map(a => {
    if (a.id !== state.activeAlly.id) return a;
    return { ...a, conditions: [...(a.conditions || []), cond] };
  });
  return {
    ...state,
    allies: nextAllies,
    logs: [...(state.logs || []), { text: `${state.activeAlly.name} takes total defense (+4 dodge AC until next turn).`, kind: 'action' }],
    turnAdvanced: true,
  };
}

function runInteractiveAllyPass(state) {
  if (!state.isInteractiveAllyTurn || !state.activeAlly) return state;
  return {
    ...state,
    logs: [...(state.logs || []), { text: `${state.activeAlly.name} holds their action.`, kind: 'info' }],
    turnAdvanced: true,
  };
}

function runInteractiveAllyAttack(state) {
  if (!state.isInteractiveAllyTurn) return state;
  return {
    ...state,
    delegatedTo: 'handleAllyTurn',
    turnAdvanced: true,
  };
}

// Legacy wrappers -- earlier Phase C.3 tests were written against these.
// They just lift the old gate onto the new one.
function runGMAllyDefend(state) {
  if (!state.isGMAllyTurn) return state;
  return runInteractiveAllyDefend({ ...state, isInteractiveAllyTurn: true, activeAllyMode: 'gm' });
}
function runGMAllyPass(state) {
  if (!state.isGMAllyTurn) return state;
  return runInteractiveAllyPass({ ...state, isInteractiveAllyTurn: true, activeAllyMode: 'gm' });
}
function runGMAllyAttack(state) {
  if (!state.isGMAllyTurn) return state;
  return runInteractiveAllyAttack({ ...state, isInteractiveAllyTurn: true, activeAllyMode: 'gm' });
}

// =========================================================================
// (a) Auto-advance routing
// =========================================================================
section('(a) Auto-advance routing by controlMode');

eq(pickAllyAutoAdvance({ controlMode: 'ai' }), 'handleAllyTurn',
  'ai mode -> handleAllyTurn');
eq(pickAllyAutoAdvance({ controlMode: 'gm' }), 'no-auto-advance',
  'gm mode -> no auto-advance (Phase C.3 picker takes over)');
eq(pickAllyAutoAdvance({ controlMode: 'player' }), 'no-auto-advance',
  'player mode -> no auto-advance (Phase C.4 picker takes over)');
eq(pickAllyAutoAdvance({ controlMode: 'future-mode-xyz' }), 'auto-pass',
  'unknown mode -> auto-pass (defensive fallback so turns do not wedge)');
eq(pickAllyAutoAdvance({}), 'handleAllyTurn',
  'missing controlMode defaults to ai');
eq(pickAllyAutoAdvance(null), 'handleAllyTurn',
  'null ally defaults to ai (pre-Phase-A safety)');

// =========================================================================
// (b) handleGMAllyDefend applies the correct condition
// =========================================================================
section('(b) handleGMAllyDefend stamps total_defense condition');

{
  const ally = { id: 'a1', name: 'Summoned Wolf', currentHP: 13, controlMode: 'gm', conditions: [] };
  const state0 = {
    allies: [ally],
    activeAlly: ally,
    isGMAllyTurn: true,
    logs: [],
  };
  const state1 = runGMAllyDefend(state0);

  truthy(state1.turnAdvanced, 'Defend advances turn');
  eq(state1.allies[0].conditions.length, 1, 'Defend adds one condition');

  const cond = state1.allies[0].conditions[0];
  eq(cond.id, 'total_defense', 'Condition id is total_defense');
  eq(cond.name, 'Total Defense', 'Condition name matches template');
  eq(cond.severity, 'buff', 'Condition severity is buff');
  eq(cond.modifiers.ac, 4, 'Condition grants +4 AC');
  eq(cond.modifiers.cannotAttack, true, 'Condition sets cannotAttack flag');
  eq(cond.duration, 1, 'Condition duration is 1 round');
  eq(cond.roundsRemaining, 1, 'Condition roundsRemaining is 1');
  eq(cond.source, 'gm-ally-defend', 'Condition source tag is gm-ally-defend');

  eq(state1.logs.length, 1, 'Defend emits exactly one log entry');
  eq(state1.logs[0].kind, 'action', 'Defend log kind is "action"');
  truthy(state1.logs[0].text.includes('total defense'),
    'Defend log mentions "total defense"');
}

// Pre-existing conditions are preserved.
{
  const existing = { id: 'frightened', name: 'Frightened', severity: 'debuff', modifiers: {} };
  const ally = { id: 'a2', name: 'Brave Dog', currentHP: 9, controlMode: 'gm', conditions: [existing] };
  const state0 = { allies: [ally], activeAlly: ally, isGMAllyTurn: true, logs: [] };
  const state1 = runGMAllyDefend(state0);
  eq(state1.allies[0].conditions.length, 2, 'Defend preserves pre-existing conditions');
  eq(state1.allies[0].conditions[0].id, 'frightened', 'Existing condition kept at head of array');
  eq(state1.allies[0].conditions[1].id, 'total_defense', 'New condition appended at tail');
}

// =========================================================================
// (c) handleGMAllyPass advances turn without side effects
// =========================================================================
section('(c) handleGMAllyPass');

{
  const ally = { id: 'a3', name: 'Lazy Cat', currentHP: 6, controlMode: 'gm', conditions: [] };
  const state0 = { allies: [ally], activeAlly: ally, isGMAllyTurn: true, logs: [] };
  const state1 = runGMAllyPass(state0);

  truthy(state1.turnAdvanced, 'Pass advances turn');
  eq(state1.allies[0].conditions.length, 0, 'Pass does not add conditions');
  eq(state1.logs.length, 1, 'Pass emits exactly one log entry');
  eq(state1.logs[0].kind, 'info', 'Pass log kind is "info"');
  truthy(state1.logs[0].text.includes('holds their action'),
    'Pass log mentions "holds their action"');
}

// =========================================================================
// (d) handleGMAllyAttack delegates to the AI ally handler
// =========================================================================
section('(d) handleGMAllyAttack delegates to handleAllyTurn');

{
  const ally = { id: 'a4', name: 'Fighter Ally', currentHP: 20, controlMode: 'gm' };
  const state0 = { allies: [ally], activeAlly: ally, isGMAllyTurn: true };
  const state1 = runGMAllyAttack(state0);

  eq(state1.delegatedTo, 'handleAllyTurn',
    'Attack delegates to handleAllyTurn (re-uses utility AI)');
  truthy(state1.turnAdvanced, 'Attack advances turn (via handleAllyTurn)');
}

// =========================================================================
// (e) Gating: non-GM-turn clicks are ignored
// =========================================================================
section('(e) Handlers no-op when !isGMAllyTurn');

{
  const ally = { id: 'a5', name: 'Not GM Ally', currentHP: 10, controlMode: 'ai', conditions: [] };
  const state0 = { allies: [ally], activeAlly: ally, isGMAllyTurn: false, logs: [] };

  const afterDefend = runGMAllyDefend(state0);
  falsy(afterDefend.turnAdvanced, 'Defend no-ops when !isGMAllyTurn');
  eq(afterDefend.allies[0].conditions.length, 0, 'Defend does not stamp condition when gated');

  const afterPass = runGMAllyPass(state0);
  falsy(afterPass.turnAdvanced, 'Pass no-ops when !isGMAllyTurn');
  eq(afterPass.logs.length, 0, 'Pass does not log when gated');

  const afterAttack = runGMAllyAttack(state0);
  falsy(afterAttack.turnAdvanced, 'Attack no-ops when !isGMAllyTurn');
  eq(afterAttack.delegatedTo, undefined, 'Attack does not delegate when gated');
}

// activeAlly missing (e.g., currentCombatant points at a dead or absent id)
{
  const state0 = { allies: [], activeAlly: null, isGMAllyTurn: true, logs: [] };
  const afterDefend = runGMAllyDefend(state0);
  falsy(afterDefend.turnAdvanced, 'Defend no-ops when activeAlly is null');
  const afterPass = runGMAllyPass(state0);
  falsy(afterPass.turnAdvanced, 'Pass no-ops when activeAlly is null');
}

// =========================================================================
// (f) isGMAllyTurn derivation
// =========================================================================
section('(f) isGMAllyTurn derivation');

{
  const gmAlly = { id: 'g1', name: 'GM Ally', currentHP: 10, controlMode: 'gm' };
  const aiAlly = { id: 'a1', name: 'AI Ally', currentHP: 10, controlMode: 'ai' };
  const playerAlly = { id: 'p1', name: 'Player Ally', currentHP: 10, controlMode: 'player' };
  const deadGmAlly = { id: 'dg1', name: 'Dead GM Ally', currentHP: 0, controlMode: 'gm' };
  const bareAlly = { id: 'b1', name: 'Bare Ally', currentHP: 10 };  // no controlMode

  const allies = [gmAlly, aiAlly, playerAlly, deadGmAlly, bareAlly];

  truthy(deriveIsGMAllyTurn({ id: 'g1' }, allies),
    'GM ally with positive HP -> isGMAllyTurn=true');
  falsy(deriveIsGMAllyTurn({ id: 'a1' }, allies),
    'AI ally -> isGMAllyTurn=false');
  falsy(deriveIsGMAllyTurn({ id: 'p1' }, allies),
    'Player-mode ally -> isGMAllyTurn=false');
  falsy(deriveIsGMAllyTurn({ id: 'dg1' }, allies),
    'Dead GM ally -> isGMAllyTurn=false (isAllyTurn gates on HP>0)');
  falsy(deriveIsGMAllyTurn({ id: 'b1' }, allies),
    'Ally without controlMode -> isGMAllyTurn=false (default ai)');
  falsy(deriveIsGMAllyTurn({ id: 'nonexistent' }, allies),
    'Current combatant not in allies -> isGMAllyTurn=false');
  falsy(deriveIsGMAllyTurn(null, allies),
    'null currentCombatant -> isGMAllyTurn=false');
}

// =========================================================================
// PHASE C.4 COVERAGE
// =========================================================================
// The generalized handlers (runInteractiveAllyAttack/Defend/Pass) work
// for both 'gm' and 'player' modes. These tests exercise the player
// path explicitly so we know both modes stay in lock-step going forward.

section('(g) Phase C.4: player-mode auto-advance + handler behavior');

{
  // Player mode -> picker takes over (no auto-advance), same as gm.
  eq(pickAllyAutoAdvance({ controlMode: 'player' }), 'no-auto-advance',
    'player mode skips auto-advance (picker drives turn)');

  // Player-mode Defend stamps condition with player-ally-defend source tag.
  const ally = { id: 'pa1', name: 'Ulfen Ranger', currentHP: 22, controlMode: 'player', conditions: [] };
  const state0 = {
    allies: [ally],
    activeAlly: ally,
    activeAllyMode: 'player',
    isInteractiveAllyTurn: true,
    logs: [],
  };
  const state1 = runInteractiveAllyDefend(state0);
  truthy(state1.turnAdvanced, 'player Defend advances turn');
  eq(state1.allies[0].conditions.length, 1, 'player Defend adds one condition');
  eq(state1.allies[0].conditions[0].id, 'total_defense',
    'player Defend stamps total_defense (same template as GM)');
  eq(state1.allies[0].conditions[0].source, 'player-ally-defend',
    'player Defend source tag distinguishes from GM for telemetry');

  // Player-mode Pass behaves like GM Pass.
  const state2 = runInteractiveAllyPass(state0);
  truthy(state2.turnAdvanced, 'player Pass advances turn');
  eq(state2.logs.length, 1, 'player Pass emits exactly one log entry');
  truthy(state2.logs[0].text.includes('holds their action'),
    'player Pass log mentions "holds their action"');

  // Player-mode Attack delegates to handleAllyTurn.
  const state3 = runInteractiveAllyAttack(state0);
  eq(state3.delegatedTo, 'handleAllyTurn',
    'player Attack delegates to handleAllyTurn (reuses utility AI)');
  truthy(state3.turnAdvanced, 'player Attack advances turn');
}

section('(h) Phase C.4: GM mode still source-tagged distinctly');

{
  const ally = { id: 'gm1', name: 'GM Ally', currentHP: 15, controlMode: 'gm', conditions: [] };
  const state0 = {
    allies: [ally],
    activeAlly: ally,
    activeAllyMode: 'gm',
    isInteractiveAllyTurn: true,
    logs: [],
  };
  const state1 = runInteractiveAllyDefend(state0);
  eq(state1.allies[0].conditions[0].source, 'gm-ally-defend',
    'gm Defend source tag preserved under generalized handler');
}

section('(i) Phase C.4: isInteractiveAllyTurn derivation union');

{
  const gmAlly = { id: 'g1', name: 'GM Ally', currentHP: 10, controlMode: 'gm' };
  const playerAlly = { id: 'p1', name: 'Player Ally', currentHP: 10, controlMode: 'player' };
  const aiAlly = { id: 'a1', name: 'AI Ally', currentHP: 10, controlMode: 'ai' };
  const allies = [gmAlly, playerAlly, aiAlly];

  truthy(deriveIsInteractiveAllyTurn({ id: 'g1' }, allies),
    'gm ally -> isInteractiveAllyTurn=true');
  truthy(deriveIsInteractiveAllyTurn({ id: 'p1' }, allies),
    'player ally -> isInteractiveAllyTurn=true');
  falsy(deriveIsInteractiveAllyTurn({ id: 'a1' }, allies),
    'ai ally -> isInteractiveAllyTurn=false');
  falsy(deriveIsInteractiveAllyTurn({ id: 'nonexistent' }, allies),
    'unknown id -> isInteractiveAllyTurn=false');
  falsy(deriveIsInteractiveAllyTurn(null, allies),
    'null currentCombatant -> isInteractiveAllyTurn=false');
  falsy(deriveIsPlayerAllyTurn({ id: 'g1' }, allies),
    'gm ally -> isPlayerAllyTurn=false (mode-specific check)');
  falsy(deriveIsGMAllyTurn({ id: 'p1' }, allies),
    'player ally -> isGMAllyTurn=false (mode-specific check)');
}

section('(j) Phase C.4: gating prevents stale player-mode clicks');

{
  // Player clicked during a state-transition; isInteractiveAllyTurn is now
  // false (ally died, turn advanced, etc.) -- handlers must no-op.
  const ally = { id: 'stale1', name: 'Stale Player Ally', currentHP: 10, controlMode: 'player', conditions: [] };
  const state0 = {
    allies: [ally],
    activeAlly: ally,
    activeAllyMode: 'player',
    isInteractiveAllyTurn: false,  // race-condition guard
    logs: [],
  };
  const afterAttack = runInteractiveAllyAttack(state0);
  falsy(afterAttack.turnAdvanced, 'stale player Attack no-ops');
  eq(afterAttack.delegatedTo, undefined, 'stale player Attack does not delegate');
  const afterDefend = runInteractiveAllyDefend(state0);
  falsy(afterDefend.turnAdvanced, 'stale player Defend no-ops');
  eq(afterDefend.allies[0].conditions.length, 0, 'stale player Defend does not stamp');
  const afterPass = runInteractiveAllyPass(state0);
  falsy(afterPass.turnAdvanced, 'stale player Pass no-ops');
  eq(afterPass.logs.length, 0, 'stale player Pass does not log');
}

// =========================================================================
// Summary
// =========================================================================
console.log('\n' + '='.repeat(60));
console.log(`Passed: ${pass}  Failed: ${fail}`);
console.log('='.repeat(60));
if (fail > 0) process.exit(1);
