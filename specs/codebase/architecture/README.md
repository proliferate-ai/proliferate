# Goals / Loops / Rosters / Workflows — architecture index

This is the entry point. It answers "what is this system and where do I go
for depth" in one document. It does not re-derive anything the detail docs
already establish — every claim below links to the chapter that proves it.

Status as of 2026-07-03: **goals, loops, rosters, and workflows are all
as-built** (code exists, is unit-tested, and passed live protocol-layer
gates against real harnesses). **Nothing in this stack has merged to
`main`** — five main-repo PRs + five fork PRs are open, stacked, in various
draft states (§4). Treat this README as describing a coherent, working,
*unmerged* system.

Companions, not duplicates:

| doc | what it is | read it for |
|---|---|---|
| `specs/codebase/architecture/harness-runtime-mechanics.md` | verified native mechanics of all 4 harnesses | *why* Claude/Codex/OpenCode/Cursor behave the way they do underneath |
| `specs/codebase/architecture/session-activity-architecture.md` | design of record + locked product decisions | UX decisions (goal bar, chips), the parts still unbuilt (OpenCode/Cursor membranes, fleet) |
| `specs/codebase/architecture/goals-loops-rosters-implementation.md` | as-built deep dive, goals+loops+rosters | exact file/line/symbol references for that slice |
| `specs/codebase/architecture/workflows-architecture-current.md` | as-built deep dive, workflows | exact file/line/symbol references for the workflow engine + server |
| `specs/codebase/architecture/gate-a-report.md`, `specs/codebase/architecture/gate-bc-report.md` | live test evidence | what was actually verified working vs. broken, with repro steps |
| `specs/tbd/goals-and-workflows-v1.md` | product design layer, locked decisions | the original *why*, before "as-built" superseded parts of it |

---

## 1. What this system is

Four primitives, one pipeline.

- **Goals** — a mirror **with a write path**. Exactly one active goal per
  session. The UI/API can set, edit, pause, and clear a goal; the mirror
  never invents state, it only reflects what the native harness round-trips
  back. Codex has a real goal engine (`~/.codex/goals_1.sqlite`, self-driving
  turns); Claude Code has a native `/goal` + Stop-hook + Haiku evaluator.
  Both are **strict native mirrors** — this is the load-bearing design
  choice everything else inherits.
- **Loops** — a mirror with a write path, but *execution* differs by
  harness: **native** on Claude (real session crons — `CronCreate`, fired by
  the CLI's own timer) and **runtime-emulated** on Codex (anyharness owns a
  `LoopScheduler` that fires prompts into idle sessions, because Codex has
  zero native recurring-prompt primitive).
- **Activity rosters** (`processes[]`, `agents[]`) — **read-only**, never
  externally settable, watchable via an opaque `FeedRef` (`tail_file` for
  Claude's output files / subagent transcripts, `acp_child_demux` for
  Codex's full child threads). The client never learns the transport.
- **Workflows** — a deterministic program (`Session` = conversational
  context, `Run` = one execution, `Workflow` = the program, `Trigger` = only
  a thing that starts a run) advanced step-by-step by a `WorkflowRunActor`.
  Steps include `agent.config`, `agent.prompt` (optionally with a `goal`
  attachment — see §3 for why there is no `agent.goal` kind), `shell.run`,
  `scm.open_pr`, `notify`, `human.approval`. Workflows are **built on top of
  goals**, not a sibling primitive — an `agent.prompt` step with a `goal`
  attachment arms the exact same `GoalRuntime` a human uses from the chat UI.

**The one pipeline** all four primitives ride, with real crate/package
names:

```
harness process (claude CLI / codex-rs core)
   │  native events: task_*, ThreadGoalUpdated, CollabAgentToolCall, transcript rows
   ▼
sidecar membrane
   claude-agent-acp (src/acp-agent.ts, src/anyharness.ts)
   codex-acp        (src/thread.rs, src/goals.rs, src/activity.rs, src/codex_agent.rs)
   │  normalizes into ACP chunks tagged _meta.anyharness.transcriptEvent ∈
   │  {goal_updated, goal_met, goal_cleared, loop_upserted, loop_removed,
   │   loop_fired, process_upserted, subagent_upserted}
   ▼
anyharness-lib ingest — live/sessions/sink/ingest.rs::is_non_transcript_chunk
   (strips these tags out of the ordinary transcript before observers see them)
   ▼
domain observers — domains/{goals,loops,activity}/session_observer.rs
   (three instantiations of the SessionEventObserver pattern domains/plans pioneered)
   ▼
domain service + store — domains/{goals,loops,activity}/{service,store,model}.rs
   → SQLite: persistence/sql/0052_goals.sql, 0053_loops.sql, 0054_activity.sql,
     0055_loops_scheduler.sql (goals-b stack); 0053_workflow_runs.sql (workflows/v1 —
     these two branches currently collide on migration numbers, see §3 invariant 8)
   ▼
contract v1 — anyharness-contract/src/v1/{goals,loops,activity,events,workflows}.rs
   ▼
HTTP / WS — api/http/{goals,loops,workflow_runs}.rs, api/ws/{activity,feeds}.rs
   ▼
SDK — anyharness/sdk/src/reducer/transcript.ts (goal/loop/roster events are
   explicit no-ops — never become transcript items) + anyharness/sdk-react
   ▼
UI / workflow-consumers
   apps/packages/product-domain/src/activity/ + .../workflows/  (pure derivations)
   apps/packages/product-ui/src/activity/ + .../workflows/       (shared components)
   apps/desktop/src/components/workspace/activity/                (composer bar, panels)
   server/proliferate/server/cloud/workflows/                     (program + run ledger, Postgres)
```

Workflows plug into the *same* pipeline at the goal layer (an `agent.prompt`
step's `goal` attachment calls `GoalRuntime::set_goal` exactly like the UI's
goal bar) and add their own control-plane half on the server (Postgres owns
the program + durable run ledger; anyharness owns observed execution truth —
the same desired/observed split sessions already use).

Full end-to-end flows (goal set/met, loop arm/fire, roster+feed, workflow
run) are in `goals-loops-rosters-implementation.md` §2 and
`workflows-architecture.md` §1/§3.

---

## 2. Component map

### 2a. Sidecar forks (membrane layer)

| path | role | primitives |
|---|---|---|
| `claude-agent-acp/src/acp-agent.ts` | `ClaudeAcpAgent`: ext-method dispatch, deferred-injection queue, idle pump (`drainTurn`), transcript tailer, task/roster capture, terminal streaming | goals, loops, rosters |
| `claude-agent-acp/src/anyharness.ts` | pure helpers: `parseBackgroundOutputFile`, `subagentFeedPath`, `readArmedLoopsFromTranscript`, `extractGoalStatus`/`classifyGoalStatus` | goals, loops, rosters |
| `claude-agent-acp/src/tools.ts` | tool_use/tool_result → terminal-streaming meta construction | rosters |
| `codex-acp/src/thread.rs` | `ThreadActor`/`Thread`/`SessionClient` — the largest file (~7.7k lines); goal transcript emission, collab-agent handlers, child feed pumps, terminal streaming metas | goals, rosters |
| `codex-acp/src/goals.rs` | `GoalWire`, `_anyharness/goal/{set,get,clear}` wire constants, `AnyharnessGoalRequest` | goals |
| `codex-acp/src/activity.rs` | `ProcessWire`, `SubagentWire`, `FeedTransportWire::AcpChildDemux`, `_anyharness/activity/list` | rosters |
| `codex-acp/src/codex_agent.rs` | `CodexAgent` ACP handler registration, `handle_goal_request`, `handle_activity_request` | goals, rosters |

### 2b. anyharness domains (`anyharness/crates/anyharness-lib/src/`)

| path | role | primitives |
|---|---|---|
| `domains/goals/{model,runtime,service,store,session_observer,hooks,wire}.rs` | `GoalRuntime`/`GoalService`/`GoalStore`; one mirror row per session | goals |
| `domains/loops/{model,runtime,scheduler,schedule,service,store,session_observer,hooks,wire}.rs` | `LoopRuntime`; `LoopScheduler` is the Codex-emulated engine (idle-only firing, `SkippedBusy` deferral) | loops |
| `domains/activity/{model,runtime,service,store,feeds,session_observer}.rs` | `ActivityService`; `FeedService` resolves `tail_file`/`acp_child_demux` transports lazily | rosters |
| `domains/workflows/{model,plan,engine,service,templates,store}.rs` | durable truth: records, plan parsing, cursor, on-fail decision (`decide_after_step`), late-bind templating — no live state here | workflows |
| `live/workflows/{manager,actor,executor,exec_policy,commands}.rs` | one actor per run driving real sessions/goals/shells/PRs; `WorkflowRunManager`, `WorkflowStepExecutorImpl`, always-bypass policy | workflows |
| `api/http/{goals,loops,workflow_runs}.rs`, `api/ws/{activity,feeds}.rs` | HTTP/WS surface | all |
| `anyharness-contract/src/v1/{goals,loops,activity,events,workflows}.rs` | the typed wire contract (camelCase) | all |

Divergence from the design doc: there is **no single**
`domains/sessions/runtime/attach_reconcile.rs` — reconcile-on-attach is
three independent per-domain `reconcile_on_attach` methods, each wired
through the generic `SessionExtension::on_session_started` hook.

### 2c. Server, control plane (workflows only) — `server/proliferate/server/cloud/workflows/`

| path | role |
|---|---|
| `db/models/cloud/workflows.py` + `alembic/versions/e4f7a2b9c6d1_*`, `b2d4f6a8c0e1_*` | `workflow`, `workflow_version`, `workflow_run`, `workflow_trigger` tables |
| `domain/{definition,interpolation,run_status,policy}.py` | pure, unit-tested: strict definition parser, `{{args.*}}`/`{{steps[n].*}}` template grammar + injection guard, status-transition guard, free-plan cap |
| `service.py` | workflow/version/trigger CRUD, `start_run` (the *only* place a program is resolved into a self-contained plan) |
| `delivery.py` | cloud-lane delivery (`deliver_cloud_run`, `refresh_cloud_run`) — synchronous, in-request, gateway-direct |
| `scheduler.py` | independent asyncio beat: fire due schedule triggers, deliver pending cloud runs |
| `api.py` | `/v1/cloud/workflows/*` — the only server surface; no server-side cancel/pause |

Everything else (Goals, Loops, Rosters) has **no server/Postgres component**
— they are runtime-only, per the "no cloud sync" locked decision (§3).

### 2d. SDK layers

| path | role |
|---|---|
| `anyharness/sdk/src/reducer/transcript.ts` | explicit no-op cases for all 8 goal/loop/process/subagent event kinds (locked by test) |
| `anyharness/sdk/src/client/sessions.ts` | HTTP client for `/goal`, `/loops`, `/events` |
| `anyharness/sdk-react/src/hooks/sessions.ts` | `useSetSessionGoalMutation`, `useSetSessionLoopMutation`, `useSessionEventsQuery` (the de facto activity subscription — no separate `useActivityFeed`) |
| `lib/access/cloud/workflows.ts` (desktop) | typed wrappers over the *generated* OpenAPI client for the server's `/v1/cloud/workflows` surface |
| `lib/access/anyharness/workflow-runs.ts` (desktop) | plain `fetch` against the local runtime `/v1/workflow-runs` (the SDK has no workflow surface yet) |

### 2e. Desktop / product-ui / product-domain

| path | role |
|---|---|
| `product-domain/src/activity/{goal,loop,process,subagent,chips}.ts` | pure parsers/derivations only — **not a reducer**; the fold lives split across desktop's `activity-fold.ts`/`stream-patch.ts` and the SDK's `transcript.ts` |
| `product-domain/src/chats/transcript/transcript-row-model.ts` | the causal anchoring model (`isStartAnchoredGoalEventKind`, `bucketGoalEventRows`) |
| `product-ui/src/activity/{GoalBar,ActivityChips,LoopsPanel,AgentsRosterPanel,TerminalsRosterPanel}.tsx` | shared components — `GoalBar` lives here, **not** desktop-local |
| `product-domain/src/workflows/*.ts` | definition model + serializer, run-status derivation (`deriveStepRunViews`, incl. client-only `goal_iterating`/`cancelled`), templates |
| `product-ui/src/workflows/*.tsx` | `WorkflowStepGlyphStrip`, `WorkflowRunTimelineRow`, `WorkflowStepCard`, status pills |
| `apps/desktop/src/components/workspace/activity/SessionActivityBar.tsx` | the connected composer-dock bar (imports `GoalBar` from product-ui) |
| `apps/desktop/src/components/workspace/activity/LiveTerminalsRosterPanel.tsx` | desktop's actual terminals-chip panel (supersedes `TerminalsRosterPanel.tsx`) |
| `apps/desktop/src/hooks/activity/{derived,workflows}/*.ts` | derived state hooks + mutation hooks (no optimistic writes) |
| `apps/desktop/src/lib/domain/sessions/{stream-patch,activity-fold,goal-mirror}.ts` | the sole writers of the client-side mirror |
| `apps/desktop/src/pages/…` + `components/workflows/screen/*` | `WorkflowsHomeScreen`, `WorkflowEditorScreen`, `WorkflowRunScreen` |
| `apps/desktop/src/providers/WorkflowRelayProvider.tsx` + `stores/workflows/workflow-relay-store.ts` | local-lane relay: polls the local runtime, reports observed status up to the server (app-open-only) |

---

## 3. The invariants

Deduped across `harness-runtime-mechanics.md` §6, `session-activity-architecture.md`'s
locked decisions, and `goals-loops-rosters-implementation.md` §4. Each is
enforced somewhere concrete — that's the pointer.

1. **Strict mirror, no optimistic state.** The mirror is written *only* from
   `SessionEvent`s on the stream, never from a mutation's HTTP response body.
   *Why*: a mutation's 200 can arrive well before (Claude, deferred
   injection) or roughly together with (Codex) the real native
   confirmation — trusting the response body produces a UI that lies during
   that window. Enforced: `stream-patch.ts::buildSessionStreamPatch` is the
   sole writer; `use-session-goal-actions.ts` has zero
   `patchSessionRecord|activeGoal` references post-fix.
2. **Mutate via protocol, observe via protocol, tail files only where the
   wire is silent.** *Why*: harness dot-files (`goals_1.sqlite`, the
   transcript) are a live process's private, unversioned internal state —
   writing behind it is split-brain by construction; reading it is fine as
   read-only evidence. Enforced: every mutation goes through an ext method
   (`_anyharness/goal/set`, etc.); Claude goal completion is the one true
   silence (goal events never cross the SDK wire) so `acp-agent.ts` tails
   the transcript and immediately normalizes into a typed event — nothing
   downstream ever sees the file. `harness-runtime-mechanics.md` §6.
3. **`NON_TRANSCRIPT_CHUNK_EVENTS` discipline.** A fixed vocabulary of tag
   strings (`goal_updated`, `goal_met`, `goal_cleared`, `loop_upserted`,
   `loop_removed`, `loop_fired`, `process_upserted`, `subagent_upserted`)
   must match **verbatim** across both forks and the SDK's no-op cases.
   *Why*: any drift silently either leaks a roster event into the visible
   transcript or silently drops a real one. Enforced:
   `live/sessions/sink/ingest.rs:232-243` (`is_non_transcript_chunk`), one
   authoritative list, referenced in doc comments in all three
   `session_observer.rs` files.
4. **Capability gating is initialize `_meta`, never the catalog.** *Why*:
   the catalog's declarative `supports_goals` flag can legitimately drift
   ahead of the pinned sidecar (declared before a fork ships the ext
   methods) — gating a live mutation on it risks calling a method the
   running sidecar doesn't understand. Enforced:
   `live/sessions/actor/startup.rs::supports_goals_from_init_meta` /
   `loops_capability_from_init_meta`, requiring `_meta.anyharness.schemaVersion==1`
   from the live handshake.
5. **Lenient numeric wire parsing.** Contract fields are `#[serde(default)]`
   so a shape mismatch (fractional seconds, epoch-ms vs RFC3339, a
   `usage.totalTokens` nested object vs flat fields) reads as *absent*, not
   a hard deserialize error. *Why*: this is what made several real fork
   bugs *silent* (fields just went missing) rather than loud — the fix
   pattern is "widen the parser," not "reject the input." Multiple landed
   fixes: `8c6bd415e`, `c073a3366`, `930fb25a8`.
6. **Causal transcript anchoring, not raw event seq.** Goal-lifecycle rows
   interleaved into the transcript anchor to the *turn boundary that caused
   them* (set/edited → start of the pursuing turn; met/cleared/status-change
   → end of the turn), never a raw sequence-number bucket. *Why*: turn N+1
   content must never render above a row anchored to turn N — a raw-seq
   bucket produced exactly that bug before the fix. Enforced:
   `transcript-row-model.ts::isStartAnchoredGoalEventKind` /
   `bucketGoalEventRows` (rewrite `67d4c413d`).
7. **No cloud sync — read-from-source.** There is no server-side
   projection/sync of session activity. Desktop reads local anyharness over
   HTTP/WS; cloud clients reach the sandbox's anyharness through the
   runtime access gateway; fleet views fan out to live runtimes. *Why*:
   avoids a second, staler copy of fast-changing per-session state and the
   worker-upload plumbing that would require. Enforced: no activity
   projection tables exist; `cloud-dispatch.md`/`web-cloud-local-parity.md`
   predate this ruling and are explicitly noted stale for this purpose
   (`session-activity-architecture.md` §Spec alignment item 3).
8. **No synthetic harness behavior.** We never make a harness *behave* like
   Claude — no injected wake prompts, no fake notifications on harnesses
   that don't natively support a concept. Faithfully mirroring native
   evidence (e.g. Cursor's terminal file recording `exit_code`) is in
   scope; inventing that evidence is not. Enforced as a design constraint,
   checked at Gate D ("verify no synthetic prompt was sent").
9. **`session_crons` is a lie; the transcript is truth.** Live-falsified
   twice: the `session_crons` hook field never actually populates on
   Claude despite the SDK type existing. Both the armed-loop set (on
   resume) and fire counting are derived from transcript history rows
   (`CronCreate`/`CronDelete`/the dequeued fire-prompt `isMeta` row), never
   from a hook snapshot. Enforced: `readArmedLoopsFromTranscript`,
   `recordLoopFireFromTranscript` (fix `69b89da`).
10. **Deferral, not blocking, for mid-turn mutations.** `goal/set` and
    `loop/set` during an active streaming turn return **immediately**
    (verified 6ms) with a provisional record (`nativeStatus:
    "pending_injection"`), queue the actual `/goal`/`/loop` injection, and
    flush it at the next turn boundary — they do not block the HTTP call
    open. *Why*: blocking a request thread on an indeterminate-length agent
    turn is a resource leak and a bad UX (the UI must render "pending" and
    let the event stream carry the real confirmation). Enforced:
    `canInjectNow`/`deferredInjections`/`tryFlushDeferredInjections` in
    `acp-agent.ts`; verified live in `gate-bc-report.md`.
11. **Whole-plan delivery, workflows only.** `StartRun` is the *only* place
    a workflow program is resolved; the delivered plan is the entire
    self-contained JSON (version pinned, `{{args.*}}` eagerly interpolated).
    The actor never fetches a definition; agents/desktop/scheduler never
    see one either. *Why*: makes delivery idempotent on `run_id` alone (a
    re-POST after a network blip is safe) and keeps the runtime from ever
    needing a live connection back to Postgres mid-run. Enforced:
    `service._resolve_plan`, `WorkflowRunManager.deliver`,
    `create_run_idempotent`.
12. **Always-bypass for workflow sessions.** Every workflow-owned session
    opens in the harness's bypass-equivalent permission mode
    (`bypassPermissions`/`full-access`) plus an auto-approve advisor
    fallback that predecides without emitting a synthetic interaction
    event. *Why*: goal auto-continuation must never stall on a permission
    prompt with nobody watching; `human.approval` is the only sanctioned
    human-in-the-loop. Enforced: `exec_policy.rs::bypass_mode_for_kind`,
    `WorkflowAutoApproveAdvisor`.

---

## 4. Current state

### PR map and merge order

```
claude-agent-acp #24 (GoalPort + idle pump + tailer)  ─┐
claude-agent-acp #25 (loop/roster fixes)               ─┤
codex-acp #12 (GoalPort ext methods)                   ─┤─► catalog pin bump ─► proliferate #909 (goals/phase-a)
codex-acp #13 (activity roster + child feed demux)     ─┘                              │
                                                                                          ▼
                                                    proliferate #918 (loops+rosters contract, DRAFT)
                                                                                          ▼
                                                    proliferate #919 (loops+rosters runtime, DRAFT)
                                                                                          ▼
                                                    proliferate #920 (desktop loops/rosters/feed UI, DRAFT)

proliferate #921 (workflows/v1) stacks separately on #909 (goals/phase-a), independent of #918-920
```

Verified live via `gh pr view` (2026-07-03): all five main-repo PRs (#909,
#918, #919, #920, #921) and all five fork PRs (claude-agent-acp #24/#25,
codex-acp #12/#13) are **OPEN and DRAFT**. Branch tips confirmed against the
worktrees: `goals-b/03-desktop` @ `3cbb443dd`, `claude-agent-acp
activity/loop-roster-port` @ `c7eeb38`, `codex-acp activity/roster-port` @
`537472f`, `origin/workflows/v1` @ `2577b19cd` (the local `workflows/ui-round3`
tip `dfe38a81b` — 14 commits of UI polish + `agent.config` + live goal
progress — is ahead of what #921 currently shows, push pending). All match
what the deep-dive docs cite; no drift found during this pass.

**A second migration-number collision exists between the two stacks**: the
goals-b branch uses `0052_goals.sql`/`0053_loops.sql`/`0054_activity.sql`/
`0055_loops_scheduler.sql`; the workflows/v1 branch independently uses
`0052_goal_caps_provenance.sql`/`0053_workflow_runs.sql` for unrelated
tables. Whichever stack lands second must renumber before merge — see
invariant-adjacent note in `goals-loops-rosters-implementation.md` §4 item 8.

### Gate verdicts

| gate | scope | verdict |
|---|---|---|
| Gate A | Goals protocol layer (Claude + Codex + capability gating) | **PASS** — 3 codex-acp defects found and fixed live during the gate; 2 documented-not-fixed follow-ups (live-handle eviction, clear-during-drive race) |
| Gate B | Activity rosters protocol layer | Mixed → **mostly PASS after a 5-commit fix stack** (`3fba2f5`/`c073a3366`/`69b89da`/`c7eeb38` + confirmed-current `537472f`); remaining gaps: no "wake turn" SSE signal after Claude background-bash exit (roster itself is correct, by design there's no assistant turn to key off), and post-resume ext-method transport failures (unfixed, separate issue) |
| Gate C | Loops protocol layer (Claude native + Codex emulated) | **PASS after the same fix stack** for fire-attribution and resume-seeding; Codex emulated scheduler has an unfixed stuck-busy bug after resume-mid-turn (Finding #4) |
| Gate D | OpenCode/Cursor membranes | **not run** — those membranes are unbuilt (Phase D, below) |
| Gate E | Fleet + workflow consumption | **not run** — fleet views are unbuilt; workflow↔goal consumption is exercised implicitly by the workflow e2e runs, not as a dedicated gate |
| Workflows local e2e | 6 journeys incl. a real PR + crash-resume | **PASS**, validated live 2026-07-03 |
| Workflows cloud e2e | real e2b sandbox: delivery/wake, retry, schedule fire/skip/queue | **PASS**, validated live 2026-07-03 |

**No pdev/Playwright product-layer (UI) gate has been run for goals, loops,
or rosters as of this writing** — both gate reports explicitly flag this.
Workflows' local/cloud e2e runs did exercise real UI flows.

### Deferred items (unified across all docs)

- **Session-engine live-handle eviction never runs on agent-process death**
  (`ensure_live_handle.reused` keeps reusing a dead handle; a full server
  restart is required before `resume` respawns the agent). Blocks literal
  in-place "kill → resume" for **any** harness, not just goals/loops.
- **Ext-method transport can fail post-resume** even when ordinary prompts
  on the same session succeed (`_anyharness/{goal,loop}/set` → `-32603`).
  Reproduced twice, unfixed.
- **Codex's emulated-loop scheduler can get permanently stuck reading
  `Busy`** after a resume mid-turn, blocking all future fires (`DELETE`
  still works since it doesn't gate on liveness).
- **Terminals-pane byte routing**: agent-spawned background terminal bytes
  render as raw text in a `<pre>`, not through the existing xterm-backed
  `TerminalViewport` the design called for reusing. Self-reported gap in
  PR #920.
- **`AgentsRosterPanel.tsx` not yet folded into delegated-work.** The
  design's intent (`features/delegated-work.md`'s `DelegatedWorkItem`
  model) is unrealized; it remains a standalone panel with an explicit TODO.
- **OpenCode / Cursor membranes unbuilt** (Phase D) — no `integrations/opencode_activity`
  or `integrations/cursor_activity` modules exist yet; two open probes
  (Cursor ACP `loadSession` for child transcripts; OpenCode `acp` server
  port control).
- **Fleet views unbuilt** (Phase E) — no aggregate cross-session/cross-workspace
  read surface yet.
- **Server-side cloud cancel/pause gap.** The server has no cancel/pause
  route for workflow runs; cancel is a runtime-only endpoint
  (`POST /v1/workflow-runs/{id}/cancel`). Cloud cancel/pause of a running
  sandbox isn't wired through the control plane in v1.
- **No mutation-nonce/idempotency-key completion tracking** on the goal/loop
  HTTP mutations — correctness under a literal double-submit relies
  entirely on the deferred-injection + event-stream pattern, not itself
  verified safe under retry.
- **Local schedule triggers rejected at create** — scheduled workflow runs
  are cloud-only in v1 (no server→desktop claim protocol exists).
- **Relay is app-open-only** — local workflow-run observed state is only
  reported to the server while the desktop app is running.
- **`mid-chat`/`chat` workflow trigger not wired** — `trigger_kind='chat'`
  exists in the enum but the composer "run workflow" binding isn't built.

---

## 5. Operations

### Dev setup (goals/loops/rosters lane)

```bash
cd /Users/pablohansen/proliferate-wt/goals   # worktree on goals-b/03-desktop
./goals-dev.sh goals                          # or any profile name
```

Requires the fork checkouts built locally: `~/code/claude-agent-acp` (`npm
run build` → `dist/index.js`) and `~/code/codex-acp` (`cargo build` →
`target/debug/codex-acp`). `goals-dev.sh` exports
`ANYHARNESS_CLAUDE_AGENT_PROGRAM`/`ANYHARNESS_CODEX_AGENT_PROGRAM` pointing
at those paths, then execs `pdev` — this bypasses the checked-in
`catalogs/agents/catalog.json` pins entirely, which is necessary because
those pins predate the GoalPort/activity work on the fork branches. **The
pin bump is a required, not-yet-done step before any of this ships**: once
the fork PRs merge, `catalog.json` must be regenerated against the new fork
commits or production sessions will run sidecars that don't understand
`_anyharness/goal/*`/`_anyharness/loop/*` at all. The env vars are consumed
generically (`{prefix}_AGENT_PROGRAM` in
`domains/agents/readiness/overrides.rs`), not via per-kind hardcoding.

### Dev setup (workflows lane)

```bash
make setup PROFILE=<name>   # provision a named profile
make build                  # first clean worktree / after generated+Rust+frontend changes
make run PROFILE=<name>     # full stack; add STRIPE=1 for billing webhooks
```

Standalone (single worktree, default ports): `cargo run -- serve` (runtime);
`cd server && uv run pytest -q` (server tests — note `--extra dev` is
required for the async plugins: `uv run --extra dev pytest tests/unit/test_workflow_*.py -q`).
Runtime workflow unit tests: `cd anyharness && cargo test -p anyharness-lib workflows`.
Product-domain: `pnpm --filter @proliferate/product-domain test`. Workflow
playground: `/playground/workflows` (DEV-only route). e2b cloud-lane rebuild:
`make publish-cloud-template-env-local` then `make test-cloud-e2b`
(`RUN_CLOUD_E2E=1`).

### Dev-profile-per-branch + migration-renumbering rules

`scripts/dev.mjs::profilePaths` writes `instance.json` +
`profile.env`/`launch.env`/`tauri.dev.json`/`run.lock` under
`~/.proliferate-local/dev-profiles/<profile>/`, plus a separate runtime home
at `~/.proliferate-local/runtimes/<profile>/`. Each named profile gets its
own SQLite runtime state — this is what lets multiple worktrees (goals-b,
workflows/v1, self-hosting, …) run side by side without stepping on each
other's data. **Migration numbering is not automatically coordinated across
branches** — because `include_str!`'d migration files bake a fixed filename
into the binary, two branches independently claiming the same `NNNN_*.sql`
number will silently diverge from a runtime home's already-applied
migration ledger if the wrong one lands first. Whichever branch merges
second must renumber its migrations as part of the merge, not as an
afterthought (§4's migration collision is exactly this situation, twice).

### Probe / validation scripts

None of the live-test harnesses are checked into the repo — they are
scratch scripts tied to the sessions that produced them:
`goal-test/` (original protocol probes), `gate-a/evidence/` +
`gate-a/server.log`, `gate-bc/lib.mjs` + `gate-bc/phase*.mjs` +
`gate-bc/evidence/*.json` (plus the `gate-bc-rerun/` addendum). The design
doc's stated intent to promote these into a repo-checked-in live-test
harness has not happened as of this writing.

---

## 6. Doc index

| doc | read it when |
|---|---|
| `specs/codebase/architecture/README.md` (this file) | you need the map — start here |
| `specs/codebase/architecture/harness-runtime-mechanics.md` | you need to understand *why* a harness does something at the protocol level (turn model, goal engine internals, cron/task wake mechanics, capability matrix across all 4 harnesses) |
| `specs/codebase/architecture/session-activity-architecture.md` | you need the locked product/UX decisions (goal bar, chips, anchoring rules) or the design intent for the still-unbuilt parts (OpenCode/Cursor membranes, fleet) |
| `specs/codebase/architecture/goals-loops-rosters-implementation.md` | you need an exact file/line/symbol for goals, loops, or rosters, or the list of divergences from the design doc |
| `specs/codebase/architecture/workflows-architecture-current.md` | you need an exact file/line/symbol for the workflow engine, server control plane, or desktop workflow UI, or the drift-vs-spec appendix |
| `specs/codebase/architecture/gate-a-report.md` | you need to know exactly what was tested and found for goals, with repro steps |
| `specs/codebase/architecture/gate-bc-report.md` | you need to know exactly what was tested and found for loops/rosters, including the fix-stack re-verification addendum |
| `specs/tbd/goals-and-workflows-v1.md` | you need the original product rationale and locked decisions predating "as-built," or you're evaluating whether a divergence (§3 below) was intentional |

## Known doc discrepancies (material ones only — see report for the full list)

- **`agent.goal` step kind**: the spec proposes a distinct `agent.goal` step;
  the shipped code makes goal an **attachment** on `agent.prompt`
  (`AgentPromptStep.goal`). There is no `agent.goal` kind anywhere in the
  implementation. The as-built docs and this README follow the code.
- **Session-activity design doc vs. goals-loops-rosters as-built**: several
  assumed paths in the design doc do not exist as named
  (`attach_reconcile.rs`, a plain `GET /v1/sessions/{id}/activity` REST
  route, `ActivityBar.tsx`, desktop-local `GoalBar.tsx`) — the as-built doc
  logs each with the real path; this README uses the real paths throughout
  §2.
- **Event-naming convention**: the design doc talks in PascalCase Rust enum
  names (`GoalUpdated`); the actual wire vocabulary is snake_case strings
  (`goal_updated`). Not a contradiction in substance, just a notational one
  worth knowing before grepping.
