# Goals + Loops + Rosters — as-built implementation deep dive

Status: **as-built**, verified 2026-07-03 by direct source read (Rule Zero: every
path/symbol below was grepped/read in the actual checkouts, not carried over from
design docs). Base branch: `goals-b/03-desktop` (stacks `goals/phase-a` →
`goals-b/01-contract` → `goals-b/02-runtime` → `goals-b/03-desktop`). Sidecar
branches: `claude-agent-acp@activity/loop-roster-port`,
`codex-acp@activity/roster-port`.

Companions (context, not duplicated here): `codex/harness-runtime-mechanics.md`
(per-harness native mechanics — why goals/loops work the way they do inside
Claude/Codex), `codex/session-activity-architecture.md` (design of record — now
superseded for loops/rosters by this doc; still authoritative for
OpenCode/Cursor membranes and fleet/workflow consumption, which are unbuilt),
`codex/gate-a-report.md` / `codex/gate-bc-report.md` (the live protocol-layer
test evidence this doc's Testing section points at), `codex/workflows-architecture-current.md`
(the sibling goals+workflows deep dive — goals section there overlaps this one;
this doc is the canonical goals reference and workflows doc should be read as
the "goals + workflow orchestration" extension).

PRs: proliferate **#909** (goals/phase-a, native goals end-to-end), **#918**
(loops+rosters contract v1), **#919** (loops+rosters runtime), **#920**
(desktop loops/rosters/feed UI); claude-agent-acp **#24** (GoalPort/LoopPort +
idle pump + transcript tailer), **#25** (loop-fire attribution, deferred
loop/set, subagent usage wire shape fixes); codex-acp **#12** (GoalPort ext
methods), **#13** (read-only activity rosters + child feed demux). All five
main-repo PRs and both pairs of fork PRs are **OPEN** as of this writing
(918/919 in DRAFT). Merge order is fixed by the stack dependency graph — see
§5.

---

## 1. One-page overview

Three primitives, one pipeline:

- **Goals** — a mirror **with a write path**. Exactly one active goal per
  session. UI/API can set/edit/pause/clear; the mirror never invents state,
  it only reflects what the native harness round-trips back.
- **Loops** — a mirror with a write path, but the *execution* is either
  **native** (Claude: real session crons, harness fires them) or **emulated**
  (Codex: anyharness owns a scheduler that fires prompts into idle sessions,
  because Codex has no native recurring-prompt primitive at all).
- **Rosters** (`processes[]`, `agents[]`) — **read-only**. Never externally
  settable. Watchable via an opaque `FeedRef` for live content
  (`tail_file` / `acp_child_demux`); the client never learns the transport.

Pipeline, with real crate/package names:

```
harness process (claude CLI / codex-rs core)
   │  native events (task_*, ThreadGoalUpdated, CollabAgentToolCall, transcript rows)
   ▼
sidecar membrane — claude-agent-acp (src/acp-agent.ts) | codex-acp (src/thread.rs, src/goals.rs, src/activity.rs)
   │  normalizes into ACP session-update chunks tagged _meta.anyharness.transcriptEvent
   │  (goal_updated|goal_met|goal_cleared|loop_upserted|loop_removed|loop_fired|
   │   process_upserted|subagent_upserted) — vocabulary pinned in both forks AND
   │   anyharness's NON_TRANSCRIPT_CHUNK_EVENTS (must match verbatim on both sides)
   ▼
anyharness-lib ingest — live/sessions/sink/ingest.rs (is_non_transcript_chunk
   strips these tags out of the ordinary transcript before they reach observers)
   ▼
domain observers — domains/{goals,loops,activity}/session_observer.rs
   (GoalSessionObserver / LoopSessionObserver / ActivitySessionObserver — three
   instantiations of the same SessionEventObserver pattern used by domains/plans)
   ▼
domain service + store — {goals,loops,activity}/{service,store,model}.rs
   → sqlite (persistence/sql/0052_goals.sql, 0053_loops.sql, 0054_activity.sql,
     0055_loops_scheduler.sql)
   ▼
contract v1 — anyharness-contract/src/v1/{goals,loops,activity,events}.rs
   (Goal, Loop, ActivityProcess, ActivitySubagent, FeedRef, SessionEvent variants)
   ▼
HTTP/WS — api/http/{goals,loops}.rs, api/ws/{activity,feeds}.rs
   ▼
SDK — anyharness/sdk/src/reducer/transcript.ts (goal/loop/roster events are
   explicit no-ops here — they never become transcript items) +
   anyharness/sdk-react/src/hooks/sessions.ts (mutation + event hooks)
   ▼
desktop — apps/packages/product-domain/src/activity/ (pure derivations) →
   apps/packages/product-ui/src/activity/ (GoalBar, ActivityChips, LoopsPanel,
   AgentsRosterPanel, TerminalsRosterPanel) → apps/desktop (SessionActivityBar,
   LiveTerminalsRosterPanel, GoalTranscriptEventRow, playground fixtures)
```

The two harnesses embody opposite philosophies (detailed in
`harness-runtime-mechanics.md` §0-2): Codex holds turns open and chains new
turns via an internal engine; Claude ends turns fast and wakes via
timers/notifications re-entering the message queue. This single fact explains
almost every asymmetry documented below (confirmation timing, loop
native-vs-emulated split, why Claude needs a transcript tailer at all).

---

## 2. End-to-end flows

### 2a. Goal set

**Claude path:**

1. UI: `apps/packages/product-ui/src/activity/GoalBarObjectiveEditor.tsx` —
   auto-growing textarea (`MIN_ROWS=3`, `MAX_HEIGHT_PX=240`), Cmd/Ctrl+Enter
   commits, Esc cancels, plain Enter is a native newline.
2. `apps/desktop/src/hooks/activity/workflows/use-session-goal-actions.ts`
   calls `anyharness/sdk-react/src/hooks/sessions.ts`'s
   `useSetSessionGoalMutation` (lines 487-512), which invokes
   `client.sessions.setGoal` → `PUT /v1/sessions/{id}/goal`.
3. Server route: `anyharness/crates/anyharness-lib/src/api/router.rs:436-438`
   → `api/http/goals.rs::set_session_goal` (line 27) →
   `domains/goals/runtime.rs::GoalRuntime::set_goal` (line 95, async).
4. `set_goal` gets the live session handle and calls the sidecar's ext method
   `_anyharness/goal/set` over the ACP connection.
5. **claude-agent-acp** (`src/acp-agent.ts`): ext-method dispatch is
   `extMethod(method, params)` (line 1402) — it strips a leading
   underscore (line 1406: `_anyharness/goal/set` and `anyharness/goal/set`
   are equivalent on the wire), then switches to `anyharnessGoalSet` (goal
   set handler body at 1497). The handler injects a `/goal <objective>`
   message (a zero-token Claude Code local command, per
   `harness-runtime-mechanics.md` §2.2) — but only if `canInjectNow(session)`
   (lines 2153-2156: `!session.promptRunning &&
   !session.anyharness.turnActive`) is true. If a turn is streaming, the
   injection is queued via `enqueueInjectedInstruction`
   (lines 2146-2151, into `session.anyharness.deferredInjections`) and
   drained by `tryFlushDeferredInjections` (2163-2185) at the next turn
   boundary (`turnActive` flips false at the two boundary points, line 772
   end-of-`prompt()` and line 1365 end-of-idle-pump-iteration). This is the
   **goal-set-while-streaming deferral**: the HTTP call does **not** block
   on the boundary — it returns immediately (confirmed live in
   `gate-bc-report.md`: 6ms) with a provisional goal. **Correction**: the
   literal string `"pending_injection"` does not appear anywhere in
   claude-agent-acp's own source — it is purely an **anyharness-side**
   sentinel (`domains/goals/runtime.rs::GOAL_PENDING_INJECTION_NATIVE_STATUS`,
   line 45) that `GoalRuntime::set_goal` synthesizes when it detects the
   fork has accepted-but-not-yet-confirmed a mutation, not a value the fork
   itself emits on the wire. The fork's own timeout constants are
   `GOAL_SET_TIMEOUT_MS`/`GOAL_CLEAR_TIMEOUT_MS = 30_000` (acp-agent.ts:333-334),
   thrown as `RequestError.internalError` if a goal mutation never resolves
   at all (lines 1562-1568, 1603-1609) — a harder failure mode than the
   pending-injection soft state. The real confirmation arrives later as a
   `goal_updated` `SessionEvent` when the deferred `/goal` actually
   executes.
6. **codex-acp** (`src/thread.rs`, `src/codex_agent.rs`): the ext method is
   typed as `AnyharnessGoalRequest::Set` (`src/goals.rs:225-259`, dispatched
   via ACP's `JsonRpcMessage::matches_method`), handled in
   `CodexAgent::handle_goal_request` (`src/codex_agent.rs:920-971`) →
   `goal_set` → codex-rs core's `apply_external_goal_set` (external crate,
   not in this repo) which writes `~/.codex/goals_1.sqlite` and **starts a
   turn immediately** (no deferral needed — Codex's goal engine drives itself
   once armed).
7. Native confirmation crosses back as: Claude — a `goal_status` sentinel row
   the sidecar's transcript tailer observes (see 2b); Codex — a
   `ThreadGoalUpdated` event, re-emitted as a tagged chunk by
   `send_goal_transcript_event` (`src/thread.rs:3430`).
8. The tagged chunk (`_meta.anyharness.transcriptEvent = "goal_updated"`)
   arrives at anyharness's ingest layer; `is_non_transcript_chunk`
   (`live/sessions/sink/ingest.rs:245-250`) keeps it out of the ordinary
   transcript, and `GoalSessionObserver` (`domains/goals/session_observer.rs:47`)
   parses it, calls `GoalService::ingest_native_event`
   (`domains/goals/service.rs:115`), persists via `GoalStore::update_goal`
   (`store.rs:115`), and re-emits `SessionEvent::GoalUpdated`
   (`anyharness-contract/src/v1/events.rs:61`).
9. SDK: `anyharness/sdk/src/reducer/transcript.ts:265-267` — `goal_updated` /
   `goal_met` / `goal_cleared` are explicit no-op cases so they never become
   transcript items (locked by test `fa761f4ee`,
   `anyharness/sdk/src/reducer/__tests__/transcript.test.ts`, asserting
   `state.itemsById`/`turnOrder` stay `[]` after replaying them).
10. Desktop: `apps/desktop/src/lib/domain/sessions/stream-patch.ts:95-101`
    (`buildSessionStreamPatch`) sets `patch.activeGoal = event.goal` on
    `goal_updated`/`goal_met`, `null` on `goal_cleared` — **this is the sole
    writer of the mirror** (see §4 no-optimistic-state invariant).
    `use-session-goal.ts` derives the `GoalBarState` via
    `deriveGoalBarState` (`product-domain/src/activity/goal.ts:136-164`), and
    `GoalBar.tsx` (`product-ui/src/activity/GoalBar.tsx`) renders it.

**Confirmation-ordering asymmetry between the forks** (the task's
"notification-before/after-response" point): Codex's engine starts driving
*before* the HTTP call even returns in most cases (goal-test evidence:
`goal_updated` observed after the 200 in gate-a, i.e. response-then-event);
Claude's deferred-injection path can have the **event arrive well after** the
200 (the response carries the provisional `pending_injection` state, and the
real `goal_updated` streams only once the deferred `/goal` executes at the
next turn boundary) — the UI must not treat the mutation response body as
truth in either case; only the event stream is authoritative (§4).

### 2b. Goal met

**Claude — Stop-hook + transcript tailer path:**

1. Inside the Claude Code CLI itself (not fork code — confirmed no Stop-hook
   registration exists in `claude-agent-acp`; this is native `/goal`
   behavior per `harness-runtime-mechanics.md` §2.2): a Stop hook runs a
   Haiku evaluator against the transcript each time a turn tries to end.
2. Not met → hook blocks the stop, the same turn keeps running. Met → the
   goal auto-clears natively and a `goal_status` attachment
   (`{met: true, condition, reason}`) is written to the transcript `.jsonl`.
3. **claude-agent-acp**'s transcript tailer (`acp-agent.ts`, started around
   line 2244 doc-comment "Starts the transcript tailer that observes native
   goal_status attachments") reads this row via `extractGoalStatus` /
   `classifyGoalStatus` (imported from `anyharness.ts`) and logs it
   (`acp-agent.ts:2360`: `[anyharness] transcript goal_status row (...)`).
   This is the **only** way goal completion crosses to the sidecar — goal
   events never cross Claude's SDK/stream-json wire at all
   (`harness-runtime-mechanics.md` §2.2, "Observation gap").
4. The tailer re-emits a tagged `goal_met` chunk exactly like the set path
   (2a step 7-10); `GoalService::ingest_native_event` marks the goal record
   terminal (`met_reason` populated), `GoalBar.tsx`'s
   `deriveGoalBarState` flips to `{kind: "result"}`.

**Codex — `ThreadGoalUpdated`/`update_goal` tool path:** the model itself
calls its `update_goal` tool with `status: "complete"` (the only way out of
the loop per the two audits in `harness-runtime-mechanics.md` §2.1); codex
core writes the terminal sqlite row and emits `ThreadGoalUpdated`, forwarded
identically to 2a step 7.

**Sticky bar + transcript-row anchoring (causal model):** on the desktop
side, `GoalBar.tsx`'s collapsed result line shows the **objective**, never
the raw evaluator/tool-output reason (fixed in commit `3cbb443dd`, the
current HEAD — before that fix it showed `state.detail`, the raw reason,
which "quotes tool output and truncates uselessly" per the design doc's
rationale). The full reason lives in `GoalBarResultPopover.tsx`, expanded via
a chevron/`PopoverButton`, using `goalResultWhyLabel`/`goalResultStats`
helpers added to `product-domain/src/activity/goal.ts`. Dismissal state is
client-only, in `apps/desktop/src/stores/activity/goal-bar-store.ts`
(`dismissedResultKeyBySessionId`, keyed by `goalResultDismissKey(status,
updatedAtMs)`) — it clears automatically only when a *new* goal produces a
new `updatedAtMs`.

Transcript-row anchoring (the causal model, not raw event seq) lives in
`apps/packages/product-domain/src/chats/transcript/transcript-row-model.ts`:
`isStartAnchoredGoalEventKind` (lines 198-200: only `set`/`edited` are
start-anchored) and `bucketGoalEventRows` (232-283). The host turn for an
event is the last turn whose `range.minSeq <= event.seq`; `isMidTurn = event.seq
< host.range.maxSeq` (line 270) decides start-vs-end bucket for
start-anchorable kinds — everything else (met/cleared/status-change) always
anchors at the turn's end. Row assembly (lines 117-158) splices start rows
before a turn's `leadingSplitIndex` and end rows after all of that turn's
rows, which is what produces the invariant "turn N+1 content never renders
above a row anchored to turn N." Commit `67d4c413d` is exactly this
rewrite — verified as an ancestor of and unreverted at current HEAD
(`3cbb443dd`); before it, all goal rows were anchored to a single
`byTurnId` end-of-turn bucket regardless of causal position.

### 2c. Loop arm/fire

**Claude — native crons:**

1. `PUT /v1/sessions/{id}/loops` → `api/http/loops.rs::set_session_loop`
   (line 27) → `domains/loops/runtime.rs::LoopRuntime::set_loop` (line 136).
2. `LoopRuntime::support_for` (line 434) checks
   `domains/loops/runtime.rs::EMULATED_LOOP_AGENT_KINDS = &["codex"]` (line
   55) / `is_emulated_loop_agent_kind` (line 61) — Claude is **not** in that
   list, so this is the native path: the ext method `_anyharness/loop/set`
   reaches claude-agent-acp, which (like goal/set) is deferral-aware —
   `ensureTranscriptTailer` is started first (fix `69b89da`, see below), then
   `canInjectNow` gates a `/loop [interval] <prompt>` skill-expansion
   injection (a **model-mediated** action — the model reads the expanded
   skill text and calls the `CronCreate` tool itself, costing a small turn,
   unlike `/goal`'s zero-token local command — `harness-runtime-mechanics.md`
   §3). A fresh, never-prompted session used to strand this at
   `LOOP_NOT_CONFIRMED` (`api/http/loops.rs:173`, after the Rust-side
   `LOOP_CONFIRMATION_TIMEOUT = 15s`, `domains/loops/runtime.rs:50`) because
   `canInjectNow` read the session as non-idle before any turn ever ran
   (gate-bc-report.md Finding #5) — as of current `acp-agent.ts`,
   `canInjectNow` is simply `!promptRunning && !turnActive`, both
   default-false pre-turn, so this repro's root condition does not obviously
   reproduce against current HEAD; treat as **fix status unconfirmed without
   a fresh live re-run**, not verified fixed by static read alone.
3. Fire: the harness's in-process timer enqueues the cron's prompt as an
   ordinary user turn (`queue-operation: enqueue`,
   `harness-runtime-mechanics.md` §3). **Critical correction, live-verified
   twice** (gate-bc-report.md, `69b89da`): a cron wake does **not** replay
   its prompt as a user message on the SDK stream even with
   `--replay-user-messages` — the wake is a bare spontaneous assistant turn.
   So the original fire-attribution approach
   (`markSpontaneousTurn`/`matchLoopForWake` matching *wake text* on the
   live SDK stream) never had anything to match, and `fireCount` stayed
   frozen at 0 through real fires. Fix `69b89da` moved fire attribution to
   `handleTranscriptRow`'s `extractCronFirePrompt` (an `isMeta` user row in
   the transcript containing the dequeued prompt) →
   `recordLoopFireFromTranscript` → `matchLoopForWage`(sic:
   `matchLoopForWake`) → increments `fireCount`/`lastFiredAtMs`, emits
   `loop_fired`. This is now the **sole reliable native-fire signal** for
   Claude loops.
4. Resume seeding: `readArmedLoopsFromTranscript(filePath, now)`
   (`src/anyharness.ts:743`) replays `CronCreate`/`CronDelete` tool rows
   (and, per fix `c7eeb38`, the fire-prompt rows too) from transcript history
   to reconstruct the armed-loop set on resume — this exists because
   **`session_crons` never actually appears in any hook payload** (live-
   falsified per `harness-runtime-mechanics.md` §3 "CORRECTIONS"; the SDK
   type exists but the field is never populated) — "session_crons is a lie;
   the transcript is truth."

**Codex — emulated `LoopScheduler` (anyharness-owned, not in either fork):**

Codex has zero native loop/cron primitive (confirmed: no
`Feature::`-gated loop flag, no `SlashCommand` entry, and `codex-acp`'s own
test `initialize_capability_meta_advertises_goals_only_no_loops`,
`src/goals.rs:358-373`, explicitly asserts `_meta.anyharness.loops` is
absent). anyharness fully owns emulation:

- `domains/loops/scheduler.rs::LoopScheduler` (struct at line 80): `arm`
  (line 96), `disarm`/`disarm_session` (105/121), `notify()` (used at every
  turn-finish to nudge the busy→idle transition), `run_due_pass(now_ms)`
  (line 145, async) — the fire-eligibility loop, driven by a
  `LoopFireExecutor` trait's `liveness()` (line 54) and `fire()` (line 58)
  methods.
- Liveness gate: `enum LoopSessionLiveness { ..., Idle }` (line 30) —
  `FireOutcome::SkippedBusy` (line 74) is returned, not lost, when a due fire
  lands while a turn is running; the deferred fire lands on the next idle
  pass (confirmed live: gate-bc-report.md, deferred within an 18s window of
  turn-end).
- Wiring: `domains/loops/hooks.rs::LoopSessionHooks::on_turn_finished`
  (line 40) calls `scheduler().notify()` — the busy→idle wake-up; `on_session_started`
  (27) reconciles/re-arms; `on_session_closing` (44) disarms.
- Caps/floor: `schedule.rs::ensure_emulated_cadence_floor` (line 93, floors
  cadence at 1 minute) and a 20-active-loop-per-session cap (per commit
  `da68a218b` in the main repo), plus a persisted `next_fire_at_ms` column
  (migration `0055_loops_scheduler.sql`) so an armed emulated loop re-arms
  with the correct cadence on session attach — `LoopRuntime::rearm_emulated`
  (`runtime.rs:413`).
- **Known-stuck bug** (gate-bc-report.md Finding #4, not fixed as of the
  fix stack referenced by `c7eeb38`): after a SIGKILL+resume mid-turn, the
  top-level session `status` can stick at `"running"` even though
  `activity.turn.status` correctly reports `"idle"`, so
  `LoopSessionLiveness::liveness()` reads `Busy` forever and the scheduler
  never fires again — `DELETE` still works (doesn't gate on liveness) but no
  further fires happen. Documented as an out-of-scope follow-up.

### 2d. Roster + feed

**Claude:**

- Background bash: `Bash {run_in_background: true}` → `task_started` system
  event → **claude-agent-acp**'s `captureTaskIo` (`acp-agent.ts:2083`) parses
  the tool_result for the output-file path via
  `parseBackgroundOutputFile` (`src/anyharness.ts`) — fixed by `3fba2f5` to
  also match Claude Code 2.1.199's actual phrasing ("Output is being written
  to: <path>"), which the older `/output\s*(?:→|->|:)/` regex missed
  entirely (roster shipped `feed: null` until this fix). This is what opens
  the **live-tail `FeedRef`** while the process is still running, rather
  than waiting for the completion notification.
- Completion: `task_progress`/`task_notification` events (there is **no**
  `task_updated` subtype in this fork — a naming correction from the
  original design doc's vocabulary), handled in `handleTaskEvent`
  (`acp-agent.ts:1938-2074`, terminal-status branch at 2040-2070), flip
  `ActivityProcessUpserted`'s
  status to `Exited{exitCode}` — **exit_code is intentionally always
  `null`** for Claude background bash (documented + unit-tested in the fork:
  `anyharness.ts:111`, `acp-agent.ts:2010`, `anyharness.test.ts:1383` — not
  a bug). There is **no accompanying `turn_started` SSE event** for this
  transition by design: the completion notification is drained inline by
  whichever consumer is running `query.next()` (usually the idle pump), it's
  a bare system notification with no assistant text, so no turn boundary
  exists to key a "wake turn" off of. Flagged in gate-bc-report.md as a
  product-layer follow-up: UI logic waiting on a wake-turn signal should key
  off `process_upserted{exited}` directly, not a `turn_started` pair.
- Subagents: `task_started` with `task_type: "local_agent"` → roster upsert
  with a `Transcript` `FeedRef` pointed at
  `subagentFeedPath(parentTranscriptPath, sessionId, taskId)`
  (`src/anyharness.ts:497`) = `<projectDir>/<sessionId>/subagents/agent-<taskId>.jsonl`
  — Claude persists the subagent's own transcript there from spawn, and the
  task's `output_file` is a **symlink to this same file**, so the live feed
  opens immediately at `task_started`, before any completion event. Usage
  wire shape: fixed by `5974047` (in **claude-agent-acp**, not codex-acp —
  corrected below) to flatten `usage: {totalTokens, toolUses, durationMs}`
  into sibling `tokensUsed`/`toolCalls`/`durationSeconds` fields (seconds,
  not ms) matching `ActivitySubagentWire`'s `#[serde(default)]` flat fields
  on the runtime side — the nested shape silently deserialized as absent,
  so usage never populated pre-fix.
- Idle-pump refactor: the design doc's "structural item — nothing drains the
  SDK stream between prompts" is **resolved in current code**. `acp-agent.ts`
  has an explicit idle background pump (`drainTurn`, line 815; pump-owner
  logic threaded through lines 699-1387) that keeps `query.next()` draining
  between prompts specifically so injected goal/loop instructions and
  spontaneous cron/task wakes get classified and observed live — this is a
  **documented divergence from `harness-runtime-mechanics.md`'s "Known fork
  work items"**, which still lists the idle drain as unbuilt; it has since
  landed.

**Codex** (`codex-acp/src/activity.rs`, `src/thread.rs`):

- Foreground/in-turn commands: `commandExecution` items stream
  `terminal_info`/`terminal_output`/`terminal_exit` on `ToolCallUpdate`
  meta — current locations `src/thread.rs:~2690-2698` (`terminal_info`),
  `~2742-2749` and `~2853-2861` (`terminal_output`), `~2826-2834`
  (`terminal_exit`); the design doc's `2576-2613` citation is **stale** (the
  file grew ~1200 lines from goals+activity insertions since that doc was
  written — cite function names, not line numbers, going forward:
  `supports_terminal_output` gate, the exec-begin/exec-end handlers).
- Subagents ("collab agents"): `CollabAgentSpawnEnd`/`CollabWaitingEnd`/
  `CollabCloseEnd`/`CollabResumeEnd` events dispatched at `src/thread.rs:4575-4578`,
  handlers `collab_agent_spawn_end` (4631) / `..._waiting_end` (4676) /
  `..._close_end` (4692) / `..._resume_end` (4709, added specifically to fix
  stale terminal-status roster rows on reopen), shared upsert
  `upsert_subagent` (4750), identity cache `spawned_agents: HashMap<String,
  SpawnedAgentSnapshot>` (field at 3587).
- Child feed demux: there is **no function literally named
  `acp_child_demux`** — that string is only the tagged feed-kind value
  (`FeedTransportWire::AcpChildDemux`, `src/activity.rs:163-169`). The real
  mechanism is a per-child pump task: `start_child_feed_pump`
  (`src/thread.rs:4773`), tracked in `child_feed_pump_handles:
  HashMap<String, JoinHandle<()>>` (3579), torn down via
  `abort_child_feed_pumps` (3688, fixed in `be44a35` to actually run on
  actor teardown). The child's full event stream (turns, items, deltas)
  auto-arrives on the same ACP connection tagged with the child `threadId`
  — no extra subscription needed (`harness-runtime-mechanics.md` §7).
- `ChildThreadResolver` trait (`src/thread.rs:398-420` pre-refactor,
  `403-420` post-`6bcff35` clippy fix which extracted a named
  `ChildThreadFuture<'a>` type alias to de-inline a boxed-future return
  type — mechanical, no behavior change).
- `_anyharness/activity/list` handler (commit `537472f`, HEAD of the fork):
  `CodexAgent::handle_activity_request` (`src/codex_agent.rs:1201-1230`) →
  `activity_list` (1225-1230) — **always returns `processes: []`** for
  Codex (comment confirms: codex processes never survive across turns;
  only `agents` — the collab-subagent roster, served from
  `ThreadActor::subagent_roster` via `ThreadMessage::GetActivityRoster`,
  `src/thread.rs:451`/`3713`, `Thread::activity_roster()` at
  `554-558` — is meaningful).
- Reconcile-on-resume: `CollabResumeEnd` handling specifically closes the
  gap where a resumed session's roster showed stale terminal-status rows.

**anyharness side** (`domains/activity/`): `ActivitySessionObserver`
(`session_observer.rs:36`) ingests both forks' tagged chunks uniformly via
`ActivityService::ingest_process_upserted`/`ingest_subagent_upserted`
(`service.rs:109`/`125`); `FeedService` (`feeds.rs:119`) resolves transports
lazily — `open_tail_file`/`tail_file_loop` (193/212, a rotation-tolerant
poll loop) for Claude's process/subagent files, `ChildFeedBuffer`
(`feeds.rs:79`) as the ring buffer the sink appends codex child-thread
output into for `acp_child_demux`. **Fork-compat hardening** found while
wiring real fork output (PR #919): process start read as `startedAtMs`
epoch-ms not RFC3339 `startedAt` (fix `930fb25a8`), subagent roster read
under key `subagent`/`subagents` per-fork (`7351eb74a`), the claude feed
discriminator tolerated + unknown feeds degrade gracefully
(`75446791a`), the `acp_child_demux` producer now exits cleanly when an
idle watcher drops (`b870f44f1`), stale running subagents reset on attach
not just processes (`9fc9618c2`).

**Desktop rendering**: `apps/packages/product-domain/src/activity/chips.ts`
`deriveActivityChips` (lines 30-64) — loops chip counts only
`status==="active"`, terminals/agents chips split `count` (all) vs
`liveCount` (running); rendered by `ActivityChips.tsx` (icons are actual
lucide-react `RotateCw`/`SquareTerminal`/`GitFork`, not literal glyph
characters — the `⟳ ▸ ⑂` notation only appears in JSDoc). Desktop's own
`LiveTerminalsRosterPanel.tsx` (not the shared `TerminalsRosterPanel.tsx`,
which it supersedes) adds live click-to-expand streaming via
`use-feed-stream.ts`'s `useFeedStream` hook over the feed WS, buffered
through `feed-content-buffer.ts`'s `appendCappedFeedContent` (256 KiB
trailing-window cap, fix `870d7181c`). **Documented divergence from the
design doc**: agent terminal bytes currently render as raw un-parsed text in
a `<pre>`, not through the existing xterm-backed `TerminalViewport` the
design called for reusing — per PR #920's own gate verdict, this is an
explicit open follow-up, not a silent gap.

---

## 3. Per-repo file maps

### 3.1 anyharness (crate root: `anyharness/crates/anyharness-lib`; contract
types in sibling crate `anyharness/crates/anyharness-contract`)

**`domains/goals/`** (`mod.rs`: `hooks, model, runtime, service,
session_observer, session_ports (private), store, wire`):
- `model.rs` — `GoalRecord` (fields: id, workspace_id, session_id,
  objective, status: `GoalStatus`, native_status, token_budget,
  tokens_used, time_used_seconds, met_reason, iterations, native,
  pending_op: `GoalPendingOp{Set,Clear}`, revision, native_state_json,
  created_at, updated_at); `to_contract()` → `Goal`.
- `runtime.rs` — `GoalRuntime` (set_goal, clear_goal, reconcile_on_attach —
  the last calls `_anyharness/goal/get` and dispatches a `GoalReconcileOp`
  through `run_domain_op`); `GOAL_PENDING_INJECTION_NATIVE_STATUS = "pending_injection"`
  (line 45); `deferred_pending_injection()` (line 408); `GoalOpError`
  variants incl. `NotConfirmed`, `Rejected(String)`, `AgentUnavailable`.
- `service.rs` — `GoalService` (ingest_native_event, reconcile_native_state,
  mark_pending/clear_pending); `goal_to_contract()`.
- `store.rs` — `GoalStore` over sqlite (`find_current`, `insert_goal`,
  `update_goal`, `set_pending_op`).
- `session_observer.rs` — `GoalSessionObserver`, parses the tagged-chunk
  meta shape.
- `hooks.rs` — `GoalSessionHooks` (`SessionExtension::on_session_started`
  fires `reconcile_on_attach`).
- `wire.rs` — `GoalWire`, `GoalWireStatus`, `GoalWireEnvelope`.

**`domains/loops/`** (`mod.rs`: `hooks, model, runtime, schedule, scheduler,
service, session_observer, session_ports (private), store, wire`):
- `model.rs` — `LoopRecord` (keyed `(session_id, loop_id)` — **not** a
  single mirror row per session like goals, since multiple loops per
  session are legal); fields incl. `max_fires`, `next_fire_at_ms`.
- `scheduler.rs` — `LoopScheduler` (arm/disarm/notify/run_due_pass),
  `LoopSessionLiveness{..,Idle}`, `FireOutcome{..,SkippedBusy}`,
  `LoopFireExecutor` trait (`liveness`, `fire`) — this is the Codex-emulated
  engine; unit tests directly assert idle-only firing
  (`fires_only_when_idle_never_when_busy`, etc.).
- `schedule.rs` — cron/interval parsing, `ensure_emulated_cadence_floor`
  (1-minute floor), `CronExpr`.
- `runtime.rs` — `LoopRuntime` (set_loop, edit_loop, clear_loop, list_loops,
  reconcile_on_attach, rearm_emulated); `EMULATED_LOOP_AGENT_KINDS =
  &["codex"]`; `SessionLoopFireExecutor` (the executor object handed to
  `LoopScheduler::new`).
- `hooks.rs` — `LoopSessionHooks` (`on_session_started` reconcile,
  `on_turn_finished` → `scheduler().notify()`, `on_session_closing` →
  disarm).
- `wire.rs` — `LOOP_SET_EXT_METHOD`/`LOOP_CLEAR_EXT_METHOD`/`LOOP_LIST_EXT_METHOD`
  = `_anyharness/loop/{set,clear,list}`.

**`domains/activity/`** (`mod.rs`: `feeds, model, runtime, service,
session_observer, session_ports (private), store, wire`):
- `model.rs` — `ActivityProcessRecord`/`ProcessRunStatus`,
  `ActivitySubagentRecord`/`SubagentRunStatus`, `FeedOwnerKind`,
  `FeedTransport`, `FeedBindingRecord`.
- `feeds.rs` — `FeedService` (open/resolve/demux), `FeedDemux`,
  `ChildFeedBuffer` (the `acp_child_demux` ring buffer),
  `tail_file_loop()` (rotation-tolerant poll for Claude's process/subagent
  files). `FeedKind`/`FeedRef` themselves live in the **contract crate**
  (`anyharness-contract/src/v1/activity.rs`), not here.
- `service.rs` — `ActivityService` (ingest_process_upserted,
  ingest_subagent_upserted, reset_running_processes/subagents,
  reconcile_roster).
- `runtime.rs` — `ActivityRuntime::reconcile_on_attach` — best-effort:
  falls back to `ActivityListWireResult::default()` when a harness has no
  `activity/list` (Claude today has no such ext method — its roster is
  purely event-driven).

**Attach-reconcile — location correction**: there is **no**
`domains/sessions/runtime/attach_reconcile.rs` (that file does not exist;
`domains/sessions/runtime/` holds `config.rs, creation.rs, fork.rs,
interactions.rs, launch_env.rs, launch_policy.rs, lifecycle.rs, mod.rs,
pending_prompts.rs, prompt.rs, replay.rs, startup.rs, tests.rs, view.rs`).
Reconcile-on-attach is **not centralized** — each domain owns its own
`reconcile_on_attach`, wired independently through the generic
`SessionExtension::on_session_started` hook, in `domains/{goals,loops,activity}/hooks.rs`
respectively. This is a real divergence from the design doc's assumed
single `attach_reconcile.rs` file.

**Contract crate** (`anyharness-contract/src/v1/`):
- `goals.rs` — `GoalStatus{Active,Paused,Blocked,Met,Failed,Cleared}`
  (`is_terminal()`), `Goal` (objective, status, native_status, token_budget,
  tokens_used, time_used_seconds, met_reason, iterations, native, revision,
  timestamps), `SetSessionGoalRequest`, `SessionGoalResponse`,
  `ClearSessionGoalResponse`.
- `loops.rs` — `Loop` (loop_id, prompt, schedule: `LoopSchedule{kind,expr}`,
  recurring, status: `LoopStatus{Active,Cleared}`, native, last_fired_at_ms,
  fire_count, updated_at_ms), `SetSessionLoopRequest`,
  `SessionLoopResponse`, `SessionLoopsResponse`, `ClearSessionLoopsResponse`.
- `activity.rs` — `SessionActivity{turn,goal,loops,processes,agents}`,
  `TurnState`, `ActivityProcess{id,command,cwd,status,pid,started_at,
  ended_at,feed}`, `ProcessStatus`, `ActivitySubagent{id,agent_type,
  description,model,background,status,usage,feed}`, `SubagentStatus`,
  `ActivityUsage{tokens_used,tool_calls,duration_seconds}`,
  `FeedRef{feed_id,kind}`, `FeedKind`.
- `events.rs` — `SessionEvent` variants `GoalUpdated/GoalMet/GoalCleared/
  LoopUpserted/LoopRemoved/LoopFired/ActivityProcessUpserted/
  ActivitySubagentUpserted` (kind-string mapping at lines 106-113, e.g.
  `"goal_updated"`); payload structs at lines 712-759.

**HTTP/WS surfaces** — routes registered `api/router.rs:435-456`:
```
PUT/DELETE /v1/sessions/{id}/goal                 → api/http/goals.rs
GET/PUT/DELETE /v1/sessions/{id}/loops            → api/http/loops.rs
PUT/DELETE /v1/sessions/{id}/loops/{loop_id}      → api/http/loops.rs
GET  /v1/sessions/{id}/activity/watch  (WS)       → api/ws/activity.rs::activity_watch_ws
GET  /v1/feeds/{feed_id}  (WS)                    → api/ws/feeds.rs::feed_ws
```
**Divergence**: there is **no plain REST `GET /v1/sessions/{id}/activity`**
— the design doc's assumed synchronous read endpoint does not exist;
activity is exposed only via the WS watch route (`activity_watch_ws` builds
its snapshot from `ActivityService::current_roster`) plus per-item feed
WebSockets.

**Migrations (current, on this branch)**:
```
0051_gateway_model_probe.sql   (unrelated, pre-existing)
0052_goals.sql
0053_loops.sql
0054_activity.sql
0055_loops_scheduler.sql
```
Registered in `persistence/migrations.rs:193-201` via `include_str!`.

**Dev launcher / overrides**: `goals-dev.sh` (repo root) exports
`ANYHARNESS_CLAUDE_AGENT_PROGRAM=$HOME/code/claude-agent-acp/dist/index.js`
and `ANYHARNESS_CODEX_AGENT_PROGRAM=$HOME/code/codex-acp/target/debug/codex-acp`,
then execs `pdev` (a zsh function from `~/.zshrc` wrapping `make dev-init` +
`scripts/dev.mjs ensure-db` + `make rebuild dev`). The env vars are consumed
generically in `domains/agents/readiness/overrides.rs:13`
(`resolve_agent_process_override`: `format!("{prefix}_AGENT_PROGRAM")` where
`prefix = agent_override_prefix(kind)` — not literal per-kind string
matches). Dev-profile instance binding: `scripts/dev.mjs:174-189`
(`profilePaths`) writes `profile.env`, `launch.env`, `tauri.dev.json`,
**`instance.json`**, `run.lock` under `~/.proliferate-local/dev-profiles/<profile>/`,
plus a per-profile runtime home at `~/.proliferate-local/runtimes/<profile>`.

### 3.2 claude-agent-acp (`activity/loop-roster-port`)

Primary file `src/acp-agent.ts` (very large — houses `ClaudeAcpAgent`), plus
`src/anyharness.ts` (pure helpers/types shared with tests).

- Goal ext methods: handled inline in `acp-agent.ts` around the `/goal`
  injection sites (lines ~1538, 1581, 1644 all gate on `canInjectNow`).
- Deferral queue: `deferInjection` (~2149) pushes to
  `session.anyharness.deferredInjections`; `canInjectNow` (2154:
  `!session.promptRunning && !session.anyharness.turnActive`);
  `tryFlushDeferredInjections` (2162) flushes at the next idle boundary.
- Transcript tailer: started per `acp-agent.ts:2244`'s doc comment,
  `handleTranscriptRow` (2285+) dispatches on row shape — cron fires
  (`extractCronFirePrompt`) first, then goal status
  (`extractGoalStatus`/`classifyGoalStatus`, both from `anyharness.ts`).
- Loop fire attribution: `matchLoopForWake`, `activeLoops`,
  `recordLoopFireFromTranscript` (added in `69b89da`) — reads the dequeued
  cron-prompt `isMeta` transcript row, not the live SDK stream.
- Resume seeding: `readArmedLoopsFromTranscript(filePath, now)`
  (`src/anyharness.ts:743`) replays `CronCreate`/`CronDelete`/fire rows.
- Task/roster capture: `captureTaskIo` (2083), `handleTaskEvent` (1938),
  `parseBackgroundOutputFile` (`anyharness.ts`, fixed in `3fba2f5` for the
  real 2.1.199 phrasing "Output is being written to:"),
  `subagentFeedPath(parentTranscriptPath, sessionId, taskId)`
  (`anyharness.ts:497` → `<projectDir>/<sessionId>/subagents/agent-<taskId>.jsonl`,
  the task's `output_file` is a symlink to this same file).
- Subagent usage flattening: `5974047` (this fork, **not** codex-acp —
  correcting an earlier mis-citation), flattens `usage.{totalTokens,
  toolUses,durationMs}` into sibling `tokensUsed`/`toolCalls`/`durationSeconds`.
- Idle pump: `drainTurn` (815) plus pump-ownership logic (699-1387) —
  **now implemented**, the SDK query stream is drained continuously between
  prompts, not just inside `prompt()`.
- Terminal streaming: type declarations at lines 283-293 (design doc's
  `261-270` is stale); capability gate `supportsTerminalOutput =
  clientCapabilities?._meta?.["terminal_output"] === true` at line 3659;
  three-step emission (documented in a comment at 3832-3836) —
  `terminal_info` on the first Bash tool_call (3789-3803),
  `terminal_output` on a subsequent tool_call_update (3837-3851),
  `terminal_exit` on the final tool_call_update (3853-3859). Construction
  helpers live in `src/tools.ts`: `toolInfoFromToolUse` (121),
  `toolUpdateFromToolResult` (413, terminal fields ~470-510).
- Claude pause rejection: literal string
  `'status "paused" is not supported: Claude Code has no native goal pause'`
  at line 1510, surfaced as `GOAL_REJECTED` by the runtime.

### 3.3 codex-acp (`activity/roster-port`)

- `src/lib.rs` (87 lines) — `Feature::Goals` force-enable (58-63).
- `src/codex_agent.rs` (1383 lines) — `CodexAgent`: ACP handler
  registration (~200-350), `handle_goal_request` (920-971),
  `handle_activity_request`/`activity_list` (1201-1230), `load_session`
  (652-778) incl. the goal-continuation resume fix (759-767).
- `src/thread.rs` (7760 lines — the largest file, houses `PromptState`,
  `ThreadActor`, `SessionClient`, `Thread`): `send_goal_transcript_event`
  (3430), `ThreadActor::handle_event` (4565, the engine-turn forwarding
  fix), `replay_event_msg` (4254, the session-load replay fix), collab
  handlers (4631-4750), `start_child_feed_pump`/`abort_child_feed_pumps`
  (4773/3688), `ChildThreadResolver` trait (398-420), terminal streaming
  metas (~2690-2865), `ThreadMessage::GetActivityRoster` (451/3713).
- `src/goals.rs` (377 lines) — `GoalWire`, wire method constants
  (`_anyharness/goal/{set,get,clear}`, lines 24-26), `AnyharnessGoalRequest`
  enum + `JsonRpcMessage`/`JsonRpcRequest` impls (225-263).
- `src/activity.rs` (582 lines) — `ProcessWire`, `SubagentWire`,
  `FeedTransportWire{AcpChildDemux}` (163-169), notification builders,
  `AnyharnessActivityRequest`/`ActivityListParams`.

### 3.4 Desktop / product-domain / product-ui / SDK

**`anyharness/sdk/src/`**: `reducer/transcript.ts:265-273` — explicit no-op
cases for all 8 goal/loop/process/subagent event kinds (locked by
`reducer/__tests__/transcript.test.ts`). `client/sessions.ts` — HTTP client
methods for `/goal`, `/loops[...]`, `/events`.

**`anyharness/sdk-react/src/hooks/sessions.ts`** (this is the real
"sdk-react" package — **not** `apps/desktop`-local, and **not**
`cloud/sdk-react`, which is billing/org-only):
`useSetSessionGoalMutation` (487-512), `useClearSessionGoalMutation`
(514-538), `useSetSessionLoopMutation` (540-574),
`useClearSessionLoopMutation` (576-604), `useSessionEventsQuery` (136-183 —
the de facto activity/feed subscription hook; there is no separately-named
`useActivityFeed` or `useLoops`/`useGoal` read hook — goal/loop state rides
on the `Session` object plus the event stream).

**`apps/packages/product-domain/src/activity/`** (pure model/derivation
only — **no reducer lives here**, contrary to the design doc's assumption):
`goal.ts` (GoalWire parsing, `deriveGoalBarState`, `goalResultWhyLabel`/`goalResultStats`),
`goal-transcript-events.ts` (dedups envelopes into transcript lifecycle
events), `loop.ts`, `process.ts`, `subagent.ts`, `chips.ts`
(`deriveActivityChips`).

**`apps/packages/product-domain/src/chats/transcript/transcript-row-model.ts`**
— the causal anchoring model (`isStartAnchoredGoalEventKind`,
`bucketGoalEventRows`).

**`apps/packages/product-ui/src/activity/`**: `GoalBar.tsx`,
`GoalBarObjectiveEditor.tsx`, `GoalBarResultPopover.tsx`,
`GoalBarIconAction.tsx`, `ActivityChips.tsx`, `LoopsPanel.tsx`,
`AgentsRosterPanel.tsx` (explicit TODO to fold into delegated-work per the
design doc's intent — not yet done), `TerminalsRosterPanel.tsx` (superseded
in desktop), `SubagentRosterRow.tsx`, `TerminalRosterRow.tsx`.

**`apps/desktop/src/`**:
- `components/workspace/activity/SessionActivityBar.tsx` — the connected
  composer-dock bar; imports `GoalBar` from `@proliferate/product-ui/activity/GoalBar`
  (confirming GoalBar is **not** desktop-local, contradicting the design
  doc's guessed path) and composes chips via `deriveActivityChips`.
- `components/workspace/activity/LiveTerminalsRosterPanel.tsx` — desktop's
  actual terminals-chip panel (adds live feed-stream expand over the shared
  `TerminalRosterRow`).
- `components/workspace/chat/transcript/GoalTranscriptEventRow.tsx`,
  `TranscriptActivityBlock.tsx` — transcript-embedded rendering.
- `hooks/activity/derived/use-session-goal.ts`, `use-session-activity.ts`,
  `use-session-activity-chips.ts`, `use-activity-now-ms.ts`,
  `use-feed-stream.ts` (+ `feed-content-buffer.ts`, the 256 KiB cap).
- `hooks/activity/workflows/use-session-goal-actions.ts` (mutations, no
  optimistic writes — see §4), `use-session-loop-actions.ts`.
- `lib/domain/sessions/activity-fold.ts::foldActivityEvent` (pure fold of
  loop/process/subagent events), `activity-mirror.ts`, `goal-mirror.ts`
  (mirror→wire projection + `NATIVE_GOAL_PAUSE_BY_AGENT_KIND = {codex:
  true}` — the actual pause-capability gate, keyed by capability not a
  hardcoded "is this Claude" check at the UI layer), `stream-patch.ts::buildSessionStreamPatch`
  (top-level session-stream reducer; goal patch assembly at lines 95-101).
- `stores/activity/goal-bar-store.ts` — zustand, compose-mode +
  dismissed-result-key per session.
- `components/playground/activity/ActivityFixtures.tsx`,
  `GoalBarFixtures.tsx` (15 GoalBar scenario keys incl.
  `goal-pending-write` from `d7fedb303`) + a second fixture layer at
  `lib/domain/chat/__fixtures__/playground/{activity,goal}-fixtures.ts` (9
  roster scenario keys) — **playground fixtures are split across two
  directories**, not the single directory the design doc assumed.

---

## 4. Invariants & gotchas

1. **Strict mirror, no optimistic state.** The mirror is written **only**
   from `SessionEvent`s on the stream, never from a mutation's HTTP response
   body. Verified concretely: `use-session-goal-actions.ts`'s pre-fix
   (`62a832146`) code called `patchSessionRecord(..., {activeGoal:
   response.goal})` directly off the mutation promise; post-fix, that call
   is deleted entirely (zero `patchSessionRecord|activeGoal` references
   remain in the file) — all state flows through
   `stream-patch.ts::buildSessionStreamPatch` reacting to `goal_updated`/
   `goal_met`/`goal_cleared`. Mutation failures are now surfaced via
   `useToastStore` instead of silently swallowed.
2. **`NON_TRANSCRIPT_CHUNK_EVENTS` discipline.** Defined once,
   `live/sessions/sink/ingest.rs:232-243`:
   `["proposed_plan_delta","proposed_plan_completed","goal_updated","goal_met",
   "goal_cleared","loop_upserted","loop_removed","loop_fired","process_upserted",
   "subagent_upserted"]`. `is_non_transcript_chunk` (line 245) checks
   `meta.anyharness.transcriptEvent` against this list to strip these tags
   out of the ordinary transcript before they reach the SDK reducer. This
   list's string vocabulary must match **verbatim** across both forks and
   the SDK's `transcript.ts` no-op cases — referenced in doc comments in all
   three `domains/*/session_observer.rs` files and
   `anyharness-contract/src/v1/events.rs:69`.
3. **Lenient numeric wire parsing** (fractional seconds, epoch-ms vs
   RFC3339). Multiple fixes exist because the forks emit numbers Rust's
   strict deserializer would otherwise reject: Claude's `timeUsedSeconds`
   arrives as a float (`8c6bd415e`), subagent `durationSeconds` arrives
   fractional (`c073a3366`), process `startedAt` arrives as epoch-ms under
   the key `startedAtMs` rather than RFC3339 `startedAt` (`930fb25a8`). The
   contract fields are `#[serde(default)]` specifically so a shape mismatch
   silently reads as absent rather than hard-failing deserialization — which
   is *why* these bugs were silent (roster/usage fields just went missing,
   no error) rather than loud, and why the fix pattern is "widen the parser,"
   not "reject the input."
4. **Capability gating is initialize `_meta`, never the catalog.**
   Authoritative: `live/sessions/actor/startup.rs::supports_goals_from_init_meta`
   (line 522) / `loops_capability_from_init_meta` (551) — require
   `_meta.anyharness.schemaVersion==1` and `.goals.supported==true` (or
   `.loops.{supported,native}`), consumed by
   `action_capabilities_from_acp` (483-514) and persisted per-session.
   `ActiveCatalog::supports_goals` (`domains/agents/catalog/service.rs`) is
   a **separate**, declarative, pre-session-only flag (agent picker
   surfaces before a live handshake exists) — commit `a95336237` added an
   explicit doc block forbidding its use to gate a live mutation, because it
   "can legitimately drift ahead of the pinned sidecar" (declared before the
   fork ships the ext methods).
5. **Notification ordering asymmetry.** Codex generally confirms
   response-then-event (engine starts driving fast, often before the caller
   even reads the 200); Claude's deferred-injection path can have the real
   `goal_updated` land well after the 200, which itself carries only a
   provisional `pending_injection` state. Never trust the mutation response
   body as final truth on either fork — see invariant 1.
6. **Goal-set-while-streaming deferral.** `canInjectNow` (both goal and loop
   injection sites) gates on `!promptRunning && !turnActive`; a mid-turn
   `/goal`/`/loop` mutation queues into `deferredInjections` and flushes at
   the next turn boundary. HTTP calls return immediately with a provisional
   record (`nativeStatus: "pending_injection"` for goals) rather than
   blocking — verified live in gate-bc-report.md (6ms response, real
   confirmation ~20s later at the turn boundary). A fresh, never-prompted
   session's interaction with this gate was the subject of a known repro
   (`LOOP_NOT_CONFIRMED` after the 15s `LOOP_CONFIRMATION_TIMEOUT`,
   `domains/loops/runtime.rs:50`) — current `canInjectNow` logic reads as
   already idle-by-default pre-turn, so this may already be resolved, but it
   was **not re-verified live** in this pass; flag for a fresh repro before
   relying on it.
7. **`session_crons` is a lie; the transcript is truth.** Live-falsified
   twice: `session_crons` never appears in any Claude hook payload despite
   the SDK type existing for it. Both the armed-loop set (on resume,
   `readArmedLoopsFromTranscript`) and fire counting
   (`recordLoopFireFromTranscript`, fix `69b89da`) are derived from
   transcript history/rows, never from a hook snapshot.
8. **Migration renumbering vs runtime-home sqlite (the incident).**
   Confirmed directly: commit `7900e98eb`'s own message says "GoalRecord
   store (0051_goals.sql, ...)" but the file it actually added is
   `0052_goals.sql` — renumbered within the same commit before landing,
   because `0051` was already claimed by `0051_gateway_model_probe.sql`
   from an earlier commit. **A second, independent collision exists today**:
   the sibling `workflows/v1` branch (built on the same `goals/phase-a`
   base) uses `0052_goal_caps_provenance.sql` and
   `0053_workflow_runs.sql` for entirely different tables, while
   `goals-b/03-desktop` (this branch) uses `0052_goals.sql`/`0053_loops.sql`/
   `0054_activity.sql`/`0055_loops_scheduler.sql`. These two stacks **will
   collide on migration numbers at merge time** — whichever lands second
   must renumber, and `include_str!`'d migration files mean a stale binary
   with the wrong numbering baked in will silently diverge from a runtime
   home's already-applied migration ledger. Treat this as a hard landing-
   order dependency, not just a rebase nuisance.
9. **Dev profile binding.** `scripts/dev.mjs::profilePaths` (174-189) writes
   `instance.json` + `profile.env`/`launch.env`/`tauri.dev.json`/`run.lock`
   under `~/.proliferate-local/dev-profiles/<profile>/`, with a separate
   runtime home at `~/.proliferate-local/runtimes/<profile>`. `goals-dev.sh`
   layers `ANYHARNESS_CLAUDE_AGENT_PROGRAM`/`ANYHARNESS_CODEX_AGENT_PROGRAM`
   on top so `pdev goals` picks up the local fork checkouts instead of the
   Makefile's default resolution (stale `~/codex-acp` / packaged npm
   claude-agent-acp). The env vars are generically templated
   (`{prefix}_AGENT_PROGRAM` in `readiness/overrides.rs:13`), not hardcoded
   per-kind strings.
10. **Fork fetch-refspec gotcha.** (Carried from prior session context —
    not independently re-verified this pass, flagging for completeness):
    pulling PRs from the fork repos via a plain `git fetch origin
    pull/N/head` can silently fail to update if the local branch already
    tracks a same-named ref; use explicit refspecs when syncing fork PR
    branches into a local checkout.
11. **Known deferred items** (explicitly out of scope / unfixed per the gate
    reports): session-engine live-handle eviction never runs on agent-process
    death (`ensure_live_handle.reused` at `domains/sessions/runtime/startup.rs:190`
    keeps reusing a dead handle; a full server restart is required — this
    blocks literal in-place "kill→resume" for **any** harness, not just
    goals/loops); the ext-method transport (`_anyharness/{goal,loop}/set`)
    can fail post-resume even when ordinary prompts succeed on the same
    session (gate-bc Finding #3, reproduced twice, unfixed); Codex's
    emulated-loop scheduler can get permanently stuck reading `Busy` after a
    resume mid-turn (Finding #4, unfixed); terminals-pane byte routing
    (agent-terminal bytes render as raw `<pre>` text, not through the
    xterm-backed `TerminalViewport` — PR #920's own stated follow-up); no
    mutation-nonce/idempotency-key completion tracking was found on the
    goal/loop HTTP mutations (relying entirely on the deferred-injection +
    event-stream pattern for correctness under retries — not itself
    verified safe under a literal double-submit).

---

## 5. Testing & operations

**Running it locally**: from the worktree
(`/Users/pablohansen/proliferate-wt/goals`), `./goals-dev.sh goals` (or any
profile name) — requires the fork checkouts built at
`~/code/claude-agent-acp/dist/index.js` (npm build) and
`~/code/codex-acp/target/debug/codex-acp` (cargo build). This bypasses the
catalog's pinned fork commits entirely via `ANYHARNESS_{CLAUDE,CODEX}_AGENT_PROGRAM`
env overrides — necessary because the checked-in
`catalogs/agents/catalog.json` pins predate this work (claude-agent-acp
`gitRef 3ff484e...`, codex-acp `gitRef c66f9f3...` — both from before the
GoalPort/activity commits landed on the fork branches). **The pin bump is a
required, not-yet-done step before this ships**: after the fork PRs
(claude-agent-acp #24/#25, codex-acp #12/#13) merge, `catalog.json` must be
regenerated against the new fork commits, or production sessions will run
against sidecars that don't understand `_anyharness/goal/*` or
`_anyharness/loop/*` at all.

**Gate evidence**: `codex/gate-a-report.md` (goals protocol layer — PASS,
with 3 codex-acp fixes found+landed live during the gate:
`6ad56db`/`7ddfeea`/`628062c`, plus 2 documented-not-fixed findings around
resume/reconcile races) and `codex/gate-bc-report.md` (loops+rosters
protocol layer — extensive findings, most fixed in a follow-up 5-commit
stack: `3fba2f5`/`c073a3366`/`69b89da`/`c7eeb38` in claude-agent-acp plus
confirmation that `537472f` in codex-acp was already binary-current; 2
items remain open — the "wake turn" signal question and the post-resume
ext-method transport bug). Both reports were run against real harnesses
and real keys through anyharness's actual HTTP/WS surface, zero mocks, per
the phase-gate rules in `session-activity-architecture.md` §Phase gates.
No pdev/product-layer (UI) gate has been run for goals, loops, or rosters as
of this writing — both gate reports explicitly flag this as NOT covered.

**PR map and merge order** (fixed by stack dependency, confirmed live via
`gh pr view`):
```
claude-agent-acp #24 (GoalPort) ─┐
claude-agent-acp #25 (loop/roster fixes) ─┤
codex-acp #12 (GoalPort) ────────┤─► catalog pin bump ─► proliferate #909 (goals/phase-a)
codex-acp #13 (activity roster) ─┘                              │
                                                                  ▼
                                          proliferate #918 (loops+rosters contract, DRAFT)
                                                                  ▼
                                          proliferate #919 (loops+rosters runtime, DRAFT)
                                                                  ▼
                                          proliferate #920 (desktop loops/rosters/feed UI)
```
(`#921`, workflows v1, stacks separately on `#909` and is out of scope for
this doc — see `workflows-architecture-current.md`.) All five main-repo PRs
are currently OPEN; #918/#919 are DRAFT. Each PR's own description states
its gate verdict as **partial** with an identical NOT-covered list (Codex
collab-subagent wire mechanics not exercised at the time each PR was
opened — since closed by the gate-bc addendum re-run; OpenCode/Cursor
affordance checks out of scope for this phase; no pdev product-layer pass).

**Probe scripts / validation harness**: session-scratchpad locations
referenced by the gate reports (ephemeral, tied to the sessions that
produced them, not guaranteed to exist on disk now): `goal-test/` (original
protocol probes: `codex_goal_test.mjs`, `codex_goal_restart_probe.mjs`,
`loop_wake_probe.mjs`, `bg_bash_wire_probe.mjs`, `claude_stream_test.mjs`,
`sdk_goal_test.mjs`), `gate-a/evidence/` + `gate-a/server.log`, and
`gate-bc/lib.mjs` + `gate-bc/phase{1,1b,1c,1d,2,3,3b,3c,4,4b,5}*.mjs` +
`gate-bc/evidence/*.json` (re-run as `gate-bc-rerun/` for the fix-stack
addendum). None of these are checked into the repo — they are scratch
harnesses, not a promoted `repo live-test harness` (the design doc's stated
intent to promote them into one has not happened as of this writing).

---

## 6. Divergences from the design doc (`session-activity-architecture.md`) and stale paths found

- **No single `attach_reconcile.rs`.** Design doc's
  `domains/sessions/runtime/attach_reconcile.rs` doesn't exist; reconcile is
  three independent per-domain `reconcile_on_attach` methods wired through
  `SessionExtension::on_session_started`.
- **No plain `GET /v1/sessions/{id}/activity` REST route.** Only the WS
  `/activity/watch` + per-feed `/v1/feeds/{feed_id}` exist.
- **GoalBar lives in `product-ui`, not `apps/desktop`.** The design doc's
  guessed desktop-local path (`apps/desktop/src/components/workspace/activity/GoalBar.tsx`)
  is wrong; the actual component is `apps/packages/product-ui/src/activity/GoalBar.tsx`,
  imported by desktop's `SessionActivityBar.tsx`.
- **No literal `ActivityBar.tsx`.** The composer-docked surface is
  `SessionActivityBar.tsx`; chips render inside `GoalBar`'s own row via a
  `chips` prop, not a separate top-level bar component.
- **product-domain/activity is pure model, not a reducer.** The actual event
  fold lives split across desktop (`activity-fold.ts`, `stream-patch.ts`)
  and the SDK (`reducer/transcript.ts`) — product-domain's `activity/`
  directory only holds pure parsers/derivations.
- **Wire event names are snake_case strings** (`goal_updated`,
  `loop_fired`, etc.), not the PascalCase Rust enum names used
  conversationally in the design doc.
- **Playground fixtures are split across two directories**
  (`components/playground/activity/` and
  `lib/domain/chat/__fixtures__/playground/`), not the single directory the
  design doc named.
- **`5974047` is a claude-agent-acp commit, not codex-acp** — an
  easy-to-make mis-citation given both forks' subagent-usage fixes landed
  the same week; corrected in §2d/§3.2 above.
- **Terminal streaming meta line numbers are stale in both forks**: Claude's
  design-doc citation (`acp-agent.ts:261-270`) is off by ~20 lines (now
  284-291); Codex's (`thread.rs:2576-2613`) is off by ~110-250 lines (now
  spread ~2690-2865) — both forks' files grew substantially from the
  goals/activity work landing after those line numbers were recorded. Cite
  function/symbol names for these going forward, not raw line numbers.
- **The idle-drain refactor is done**, contradicting
  `harness-runtime-mechanics.md`'s "Known fork work items" list (which
  still describes it as the long-pole unbuilt item) — `acp-agent.ts` now
  has a working idle background pump (`drainTurn` + pump-ownership state
  machine).
- **`AgentsRosterPanel.tsx` in product-ui is not yet folded into the
  delegated-work surfaces** the design doc specified as the intended home
  for subagent rendering (`features/delegated-work.md`'s `DelegatedWorkItem`
  model) — it remains its own standalone panel with an explicit TODO.
- **Agent terminal bytes are not yet routed through the existing
  `TerminalViewport`** — they render as raw text in a `<pre>`, an explicit,
  self-reported gap in PR #920, contradicting the design doc's "reused, not
  rebuilt" intent.
