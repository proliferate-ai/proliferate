# Goals & Workflows — v1 design of record

Status: proposed design, pending review.
Date: 2026-07-02.
Inputs: vault architecture docs (`Again synthesis of the architecture.md`,
`SS.md` §13, `Architecture Pass.md` §16, `Launch/IDE Launch Content.md`
lines 113–138), live protocol probes against Codex app-server 0.142.0 and
Claude Code 2.1.198, and the current codebase (plans domain, automations
stack, session engine).

Locked product decisions (from Pablo, 2026-07-02):

- A **Goal is the native harness goal** (Codex `ThreadGoal`, Claude Code
  `/goal`): a long-lived, session-scoped objective the agent iterates
  toward. Not a cross-session "coworker objective" (that layers later).
- Goals are **strict mirrors of native harness state** — never a
  Proliferate-owned abstraction projected down. Our UI edits them cleanly,
  but a write is shown as saved only after the native notification
  round-trips. The `GoalRecord` below is a normalized *mirror*, not a
  source of truth.
- **Loops are a distinct third primitive** (see §2.7): editable in the
  composer like goals, mirroring native state where it exists (Claude
  session crons); emulated by a runtime-owned scheduler where it doesn't
  (Codex).
- **No token budget in the v1 UI** (Codex-only concept; revisit later).
- v1 implementation scope: **goals + loops**. Workflows are spec-only in
  the first pass (§3 is that spec's starting point).
- Engine placement for workflows: my judgment call (made below: the
  deterministic step engine lives in anyharness).

Vault mental model this design implements:

> Session = conversational context / Run = execution / Workflow = program /
> Automation = trigger. An automation is only a trigger. The deterministic
> WorkflowRunActor advances the step cursor; the LLM performs agent steps
> but does not interpret the workflow.

---

## 1. Validated harness facts (live probes, 2026-07-02)

### Codex (app-server v2, ≥0.133 default-on)

- `thread/goal/set {threadId, objective, status, tokenBudget?}` — creates
  or **edits** (partial patch: sending only `tokenBudget` preserves
  objective/status). `thread/goal/get`, `thread/goal/clear`.
- `ThreadGoal {objective, status: active|paused|blocked|usageLimited|
  budgetLimited|complete, tokenBudget, tokensUsed, timeUsedSeconds}` —
  persisted harness-side in `~/.codex/goals_1.sqlite`, survives restarts.
- Every mutation emits `thread/goal/updated` with the full `ThreadGoal`;
  clear emits `thread/goal/cleared`. Zero tokens, no model turn.
- Setting with `status:"paused"` avoids the auto-continuation turn;
  flipping to `"active"` arms the native iterate loop. Editing an objective
  mid-turn natively injects an `objective_updated` steering prompt.
- The harness self-drives the loop (auto-continuation turns with an
  anti-reward-hacking audit prompt); the model can only mark itself
  `complete` or `blocked` via its `update_goal` tool — `blocked` is a
  first-class, externally observable "needs a human" signal.
- Wrinkle: goals live in the **app-server protocol layer**, and codex-acp
  embeds codex core — so the goal API is not on our ACP wire today. We own
  the fork: the ext methods below wire directly to the same internal goal
  service.
- Codex *automations* (`~/.codex/automations/<id>/automation.toml`) have
  **no API surface** in the app-server schema — desktop-app-layer only. We
  deliberately do not build on them; our Workflows supersede.
- **No in-session native loop** (verified 2026-07-02): the TUI slash
  command set (`tui/src/slash_command.rs`) has `/goal` ("set or view the
  goal for a long-running task") but no loop/automation/heartbeat
  command; no `Feature::` flag and no app-server methods exist for
  recurring in-session prompts. Codex loops are therefore
  runtime-emulated (§2.7).

### Claude Code (≥2.1.139)

- Set: send `/goal <condition>` as a plain user message (works over
  stream-json and the Agent SDK). Re-sending `/goal <new>` **replaces**
  (the CLI removes existing goal Stop hooks first). Bare `/goal` is a free,
  zero-token, zero-turn status poll. Goals survive `--resume`/`--continue`.
- Completion: a Haiku Stop-hook evaluator judges the condition each turn;
  the goal auto-clears when met, with a `reason` string.
- **Observation gap:** `active_goal`/`goal_status` events do NOT appear on
  the SDK wire. They persist only in the session transcript `.jsonl` as
  attachment messages: `{type:"goal_status", met, condition, reason?}`.
  Since we own claude-acp, the adapter tails the transcript (it knows the
  path from `system:init`) and forwards these as tagged ACP notifications.
- **Native loops exist**: `/loop <interval> <prompt>` arms session-scoped
  crons via first-class tools — `CronCreate` (crontab `cron` expr,
  `recurring: bool` ("False for one-shot wakeups whose cron field encodes
  a single fire time; true for tasks that re-fire on every match"),
  `prompt`), `CronDelete`, `CronList`, plus one-shot `ScheduleWakeup`.
  Multiple crons per session are legal. Armed crons surface in hook
  payloads (`session_crons`: "Session-scoped cron tasks (CronCreate,
  ScheduleWakeup, /loop) that will wake this session later") and — unlike
  goal events — as ordinary `tool_use` items that DO cross the SDK wire,
  so both set and observe work over our channel. **Wake semantics
  verified live (2026-07-02): crons fire in SDK-driven mode.** With the
  CLI under `--input-format stream-json` and stdin held open, `/loop 1m
  <prompt>` → the skill called `CronCreate {cron:"*/1 * * * *",
  recurring:true}`, and the session then woke itself at ~+30s/+90s/+150s
  — each wake a full spontaneous turn on the same stdout stream
  (re-emitted `system:init`, tool calls, `result`). No emulation
  fallback needed for Claude. Two follow-on facts: crons live only as
  long as the CLI process (they die with it — cloud sessions must keep
  the process alive), and **crons re-arm across `--resume`** (verified
  live: resuming the session restarted the minute-boundary wakes with
  no re-arm — loop state persists with the session).

### Gemini / OpenCode

No native goals. v1 is capability-gated (see §2.6); the `agent.goal`
workflow step gets an emulated loop in phase C so workflows are uniform.

---

## 2. Goals

### 2.1 Shape

One new anyharness domain, `domains/goals/`, mirroring `domains/plans/`
(the proven "native harness concept → first-class Proliferate object"
pattern), plus a uniform sidecar extension contract so anyharness sees one
goal protocol regardless of harness.

```
GoalRecord {
  id, workspace_id, session_id,
  objective: String,               // the condition / objective text
  status: active | paused | blocked | met | failed | cleared,
  source_kind: user | workflow | agent,   // provenance, like plans
  source_run_id: Option<String>,          // workflow run that armed it
  token_budget / max_turns / max_wall_secs: Option<...>,  // caps
  tokens_used / time_used_secs: Option<...>,  // live progress where native
  met_reason: Option<String>,      // evaluator's reason (claude) / final state
  native_state_json: String,       // raw native payload for fidelity/debug
  revision: i64,                   // bumped on every edit (cf. plans decision_version)
  created_at, updated_at, met_at
}
```

Normalized status mapping: Codex `complete` → `met`; Codex
`usageLimited|budgetLimited` → `failed` with a typed reason; Codex
`blocked` → `blocked` (kept distinct — it is the "agent needs a human"
signal and the fleet pane's most actionable state). Claude has only
set/met/cleared natively; `blocked`/budget states come from our guard
extension (§2.4).

Invariant: **at most one non-terminal goal per session** (matches both
harnesses' native semantics — set replaces). Edits update the row and bump
`revision`; history is the event stream, not extra rows.

### 2.2 GoalPort — uniform ACP extension across sidecars

We already ship anyharness-targeted ACP extensions through the sidecars
(`has_anyharness_targeted_fork_extension` in
`live/sessions/driver/native_session.rs`). Goals use the same channel.
Every sidecar we own implements the same surface:

Down (client → agent ext methods):

- `_anyharness/goal/set {objective, status?, tokenBudget?}`
- `_anyharness/goal/clear`
- `_anyharness/goal/get`

Up (agent → client, tagged notification chunks, kept out of the
transcript by the dispatcher exactly like Codex plan chunks):

- `meta.anyharness.transcript_event = "goal_updated"` (full goal state)
- `meta.anyharness.transcript_event = "goal_cleared"`
- `meta.anyharness.transcript_event = "goal_met"` (with reason)

Per-sidecar adaptation:

- **codex-acp**: `goal/set|get|clear` → `thread/goal/*` verbatim;
  subscribes `thread/goal/updated|cleared` → tagged chunks. Set uses
  `status:"paused"` by default and flips to `"active"` in the same call
  the runtime requests — arming is explicit, never a surprise turn.
- **claude-acp**: `goal/set` writes a `/goal <objective>` user message to
  the CLI (native path — it also appears in the transcript, which is
  correct: that IS the native UX); `goal/clear` sends `/goal` clear form;
  `goal/get` answered from adapter state. The adapter tails the session
  `.jsonl` and forwards `goal_status`/`active_goal` attachments as tagged
  chunks. Caps beyond what `/goal` supports (turns/time) are enforced
  runtime-side (§2.4).
- **gemini/opencode sidecars**: not implemented in v1; capability flag off.

Why an ext method for Claude instead of anyharness just calling
`send_prompt("/goal …")`: the runtime stays harness-agnostic — one code
path for "set a goal on this session," and the sidecar owns every
harness-specific quirk. Same reason the fork extension lives there.

### 2.3 anyharness goals domain

- `model.rs`, `service.rs` (`GoalService`: set/edit/clear idempotency,
  single-active invariant, cap validation), `store.rs` + sqlite migration
  `NNNN_goals.sql`.
- `session_observer.rs` — `GoalSessionObserver` registered in the ordered
  observer pass (like `PlanSessionObserver`): ingests the tagged chunks,
  transitions `GoalRecord`, persists + returns envelopes that become
  contract `SessionEvent`s.
- `runtime.rs` — runtime ops surfaced on `SessionRuntime`: `set_goal`,
  `clear_goal` (and `pause`/`resume` where native, i.e. Codex). These call
  the driver ext methods and record only a *pending* marker — the mirror
  transitions (and the UI shows "saved") when the observer ingests the
  native notification round-trip. No optimistic state.
- HTTP/WS surface in `api/`: `PUT/DELETE /v1/sessions/{id}/goal`, goal
  included in `SessionView`, goal events on the existing event stream.

### 2.4 Caps and the runtime loop guard

Native loops can run away. Every goal — however set — carries caps
(`max_turns`, `max_wall_secs`, `token_budget` where native). A small
`GoalGuardExtension` (`SessionExtension::on_turn_finished`) decrements
turn/time budgets and force-clears + marks `failed` (`reason:
"budget_exhausted"`) when exceeded. This is also the seam where phase-C
**emulated goals** for gemini/opencode plug in: on_turn_finished → if
emulated goal active and not met (verifier prompt via a cheap model) and
budget remains → re-prompt. The vault's rule — "Every agent goal has turn,
time, tool-call and cost limits" — is enforced here, uniformly.

### 2.5 Contract, SDKs, cloud projection

- `anyharness-contract v1`: `Goal`, `GoalStatus`, `SessionEvent` variants
  `GoalUpdated | GoalMet | GoalCleared`; `Session.active_goal:
  Option<Goal>`. Regenerate `anyharness/sdk` + `sdk-react`.
- Cloud: goal events ride the existing worker event tail; add a
  `cloud_session_goal` projection (session_id, objective, status,
  met_reason, updated_at) in `db/store/cloud_sync/projections.py` so the
  fleet view is one indexed query, not a transcript scan.
- Catalog: `supports_goals` capability per harness/version in
  `catalogs/agents/v1/catalog.json` (claude ≥2.1.139, codex ≥0.133).
  NB: catalog changes are gated by BOTH the JS validator and
  `cargo test` (Rust tests hardcode catalog values).

### 2.6 UI

Per-session (desktop, `components/workspace/chat/`):

- **Goal chip** in the composer header area: empty state = subtle "Set a
  goal" affordance (hidden for harnesses without `supports_goals`); active
  = objective (truncated) + live status dot; met = brief success state
  with the evaluator's reason, then collapses. (No token budget in v1 —
  locked.)
- **GoalCard** transcript item (sibling of `ProposedPlanCard`) rendered on
  set/edit/met — objective, status timeline, met_reason, provenance
  ("set by you" / "set by workflow X"). Edit and clear inline.

Fleet ("a place to set goals for a lot of them"):

- **Goals pane** — one screen listing every session with a goal across
  the fleet: session, harness, objective, status, last evaluation, elapsed,
  budget/usage where native (Codex `tokensUsed`/`timeUsedSeconds`); plus
  set/edit/clear on any running session directly from the list. `blocked`
  goals sort to the top — that row IS the "check in now and then" moment. v1 home: a top-level `Goals` route next to Workflows (it can
  fold into a mission-control view later; as a route it's independently
  shippable). Data: local sessions from anyharness SDK, cloud sessions
  from the `cloud_session_goal` projection.
- Playground fixtures for every GoalCard/chip state
  (`components/playground/`) before wiring live data.

### 2.7 Loops — the sibling primitive

A **Loop** is a recurring in-session prompt on a schedule. Same
architecture as Goals at every layer: mirror of native state where it
exists (Claude session crons), runtime-emulated where it doesn't (Codex,
verified §1), edited in the composer, faithful to internal harness state.

```
LoopRecord {
  id, workspace_id, session_id,
  prompt: String,
  schedule: { kind: interval | cron, expr },   // "5m" sugar → cron expr
  recurring: bool,                             // one-shot wakeup vs repeating
  status: active | paused | cleared,
  native: bool,                                // claude cron vs runtime-emulated
  last_fired_at, next_fire_at, fire_count,
  max_fires / max_wall_secs: Option<...>,      // caps (guard-enforced)
  source_kind: user | workflow | agent,
  native_state_json: String, revision: i64,
  created_at, updated_at
}
```

Unlike goals, **multiple loops per session are allowed** — that is the
native Claude shape (`CronList` returns a list) and the mirror stays
faithful. The composer chip summarizes (count + next fire); a popover
lists them.

**LoopPort** (same sidecar ext channel as §2.2):

- Down: `_anyharness/loop/set {prompt, schedule, recurring}` → loop id;
  `_anyharness/loop/clear {loopId?}` (all when omitted);
  `_anyharness/loop/list`.
- Up (tagged chunks): `loop_updated`, `loop_fired` (fire timestamp +
  turn id), `loop_cleared`.

Per-sidecar adaptation:

- **claude-acp** (`native: true`): `loop/set` sends the native
  `/loop <interval> <prompt>` user message; state is observed from the
  `CronCreate`/`CronDelete`/`CronList` `tool_use` items already on the
  wire plus `session_crons` hook payloads — no transcript tailing needed
  for loops. Exact clear form (`/loop` management vs a `CronDelete`
  round-trip) is an implementation-time detail behind `loop/clear`.
- **codex-acp** (`native: false`): no native substrate — the sidecar
  stores loop state and anyharness's `LoopSchedulerExtension` fires
  `send_prompt` on schedule, **only at idle** (never mid-turn; missed
  fires coalesce to one). UI copy shows "managed by Proliferate" for
  emulated loops so the mirror-of-native promise stays honest.
- **gemini/opencode**: off in v1 (capability flag).

Caps ride the same guard seam as §2.4 (`max_fires`, `max_wall_secs`;
exceeded → `cleared` with a typed reason). Catalog capability is
tri-state — `loops: native | emulated | none` — because emulated loops
are still real loops, but the UI badges them differently.

Contract additions: `Loop`, `LoopStatus`, `SessionEvent` variants
`LoopUpdated | LoopFired | LoopCleared`; `Session.loops: Vec<Loop>`.
UI: **Loop chip** beside the goal chip (recurrence glyph + next-fire
countdown), **LoopCard** transcript item on set/fire/clear, loop badge
column in the fleet Goals pane. Goals and loops stay orthogonal
primitives — "check every 5m until the goal is met" is a workflow
composition, not a merged object.

---

## 3. Workflows

### 3.1 Placement — the judgment call

**The deterministic step engine (`WorkflowRunActor`) lives in anyharness.**
The control plane (server) owns definitions, versions, triggers, and the
durable run ledger; it never interprets steps. Rationale:

1. **Run anywhere.** Same engine binary local (desktop) and cloud
   (sandbox) — the vault's core-primitive rule. Local runs make tomorrow's
   iteration loop fast: no cloud deploy to test a workflow.
2. **The current Celery pipeline is a launcher, not an interpreter.** It
   ends at `dispatch_prompt` and marks the run `dispatched`. Extending it
   into a step interpreter builds exactly the thing the vault deprecates
   ("no server-side automation step interpreter remains").
3. **Steps are session-coupled.** Goal waits, turn boundaries, config
   changes, approvals, forced tool calls — all of that machinery
   (SessionExtension hooks, InteractionRendezvous, turn queue, delegation
   slices) already lives inside anyharness. Driving it remotely from the
   server would re-invent the worker protocol step by step.
4. **Clean desired/observed split.** Server keeps desired state
   (running|paused|cancelled) and the audit ledger; anyharness reports
   observed state via the existing event tail. Same split sessions already
   use.

What we do NOT build yet from the vault target: the full
`RuntimeDispatch` outbox reshape and team/service-account sandboxes.
Existing trigger plumbing (automations scheduler, command queue) calls the
new engine — the vault's "hybrid" stepping stone.

### 3.2 Entities

Server (Postgres, source of truth for programs + ledger):

```
workflow          id, scope (personal|organization), name, description,
                  current_version_id, created_by, archived_at
workflow_version  id, workflow_id, version_n, definition_json, created_by,
                  created_at            -- immutable, append-only
workflow_run      id, workflow_version_id, trigger_kind (manual|chat|
                  schedule|webhook|api|agent|parent), initiator, executor
                  ("run as" identity), args_json, target (local|cloud +
                  workspace/session binding), desired_state, observed_state,
                  step_cursor, cost_totals, error, timestamps
```

`Automation` becomes what the vault says it is — **only a trigger**: it
gains `workflow_id` (+ pin policy: `latest | pinned_version`) and its
schedule/RRULE/executor-lease/preflight machinery is unchanged. Existing
single-prompt automations migrate by auto-wrapping their prompt into a
one-step workflow (`agent.prompt`) — no behavior change, no data loss.

anyharness (SQLite, observed execution truth):

```
workflow_run        local mirror: run id, resolved plan hash, cursor, state
workflow_step_run   run_id, step_index, step_kind, status, started/ended,
                    output_json (exit codes, PR url, session/turn ids, …)
```

**Plan acquisition rule (vault-exact):** only `StartRun` resolves a
program. The control plane pins the immutable version and hands the
**fully-resolved plan JSON in the StartRun payload**; the actor never
fetches definitions, and neither do agents, the desktop client, or the
scheduler.

**Delivery (locked 2026-07-03) — the payload is the entire contract:**

- Desktop/local: client calls server `StartRun` → receives the resolved
  plan → hands it to local anyharness (`POST /v1/workflow-runs`). The
  laptop owns execution from there.
- Cloud: the server delivers the payload **directly to sandbox
  anyharness through the runtime access gateway** (the same
  authenticated path clients use). No step traffic through a queue, no
  server-side interpreter. The server's only holding pattern is **wake
  orchestration**: scheduled trigger fires → ensure sandbox running →
  deliver; a pending-delivery record bridges the gap, not a work queue.
- Idempotent delivery: the run id travels in the payload; anyharness
  dedupes, so retries after network blips are safe.
- After handoff, the desired/observed split holds: control plane writes
  only desired state (pause/cancel) via the gateway and reads observed
  state from source like any client. Crash-resume is runtime-local
  (actor reloads its cursor from sqlite; no server involvement).

### 3.3 Step vocabulary (v1)

Linear sequence, deterministic cursor. Control flow = per-step `on_fail:
abort | continue | retry{n}`. No branching/DAG in v1; loops exist only as
`agent.goal`. Every template field interpolates `{{args.*}}` and
`{{steps[i].output.*}}`.

| kind | does | waits on | notes |
|---|---|---|---|
| `agent.prompt` | send templated prompt to the bound session | end of turn | optional `config` (model/mode/effort) applied first via live-config ops |
| `agent.goal` | `agent.prompt` + arm goal via GoalPort | goal met / budget exhausted | caps mandatory; native on claude/codex, extension loop later for others |
| `shell.run` | run command in the workspace (process adapter / terminals domain) | exit | captures exit code + tail of output into step output |
| `tool.call` | invoke an MCP tool from the session's bindings with exact params | tool result | deterministic — no model in the loop (see below) |
| `notify` | deterministic `tool.call` to a configured integration channel (Slack v1) with a templated message; always also recorded in-app + run history | delivery | channel list gated on configured integrations; email post-v1; in-app record is the floor, not the feature |
| `scm.open_pr` | open PR from the workspace branch | PR created | via GitHub integration (cloud) / gh (local); output = PR url |
| `human.approval` | durable pause for approve/deny | resolution | rides InteractionRendezvous; cloud runs may pause the sandbox |
| `workflow.call` | child run via StartRun | child terminal state | phase C |

On "make the agent do a tool call with specific params": v1 executes
`tool.call` **deterministically** — exact params, no LLM — rendered in the
transcript as a workflow step. Two reasons: workflows "must be STABEL AS
FUCK" (vault), and the RTK lesson — never let an agent observe a mismatch
between requested and executed. An agent-composed variant is just
`agent.prompt` with instructions; it needs no step kind.

Session binding per run: `current_session | new_session | headless`
(headless = new session, no UI focus). `no_session` (pure shell/tool
pipelines) is allowed but v1 UI only exposes the first three.

`agent.goal` step knobs (locked 2026-07-03, after the harness probes):

- **Native iteration is the engine.** On goals-capable harnesses the
  step is: arm native goal → send prompt → `await GoalMet | GoalBlocked
  | GoalFailed` from the goals mirror. The harness self-enforces the
  loop (Codex engine / Claude stop-hook); the workflow actor only
  monitors events. `iterate: native | reprompt` — `native` default
  where supported; `reprompt` (actor re-sends the templated prompt per
  round, goal as exit condition) is the fallback for harnesses without
  native goals (phase C emulation).
- **`verify` (optional, recommended for unattended runs)**: a
  deterministic gate run when GoalMet fires, e.g. `{ shell: "make
  test", expect_exit: 0 }`. Verify fails → re-arm with feedback,
  still counting against caps. Goal-met is model judgment; verify is
  ground truth.
- **Goal attachment is capability-gated**: offered only when the
  workflow's harness advertises `supports_goals` (Claude/Codex today) —
  same gate as the goal bar.
- **Exec policy (locked 2026-07-03): always bypass.** Every
  workflow-owned session runs in the harness's bypass-equivalent — no
  per-workflow policy selector, no plan-mode or mode changes inside
  workflows at all (model overrides are the only agent-config knob a
  step gets). Rationale: goal turns verifiably stall on permission
  prompts, and workflows must be unattended-safe by construction.
  `human.approval` remains the explicit way to put a human in the
  loop. The step also owns "hold the session hot until the goal
  reaches a terminal state" — neither harness iterates while its
  process is down.
- **Per-step harness switch (locked 2026-07-03)**: an `agent.prompt`
  step may override the harness, which opens a **new session with that
  harness in the same run workspace**; subsequent agent steps continue
  in the most recent session unless they switch again. This enables
  cross-agent chains (Claude fixes → Codex reviews). The goal
  attachment gates on the *effective harness of that step*.
- **`agent.compact` (candidate step, post-v1 unless cheap)**: run the
  session's native compaction and persist the compaction summary as a
  workspace artifact (`{{steps[n].output.compaction_file}}`) that later
  steps — especially a new-harness session — can consume as handoff
  context. This is the context-handoff mechanism between sessions in
  one run.

### 3.4 WorkflowRunActor (anyharness `live/workflows/`)

- One actor per run. Owns the cursor; advances only on completion events
  (turn finished, goal met, process exit, interaction resolved). Persists
  `workflow_step_run` before/after each step → crash/restart resumes at
  the cursor with idempotent step re-entry (agent steps carry a step-run
  id so a re-sent prompt is detectable and skipped if the turn landed).
- Agent steps go through `SessionRuntime` (send_prompt, set_goal, live
  config) — the actor is a *client* of the session engine, not a fork of
  it. Goal waits subscribe to the goal events from §2.
- **Turn serialization:** while a workflow owns a session, workflow turns
  and free-form user prompts are serialized through the existing prompt
  queue; user prompts interleave only at step boundaries (vault
  requirement).
- Emits `WorkflowRunEvent`s (contract v1) → desktop timeline live; worker
  uploads the same events → server updates `workflow_run` observed state
  (identical to session lifecycle sync today).
- Run-level budgets (wall time, cost) enforced by the actor; exceeded →
  fail the run with a typed error, clear any armed goal.

### 3.5 Triggers (all funnel to one server `StartRun`)

v1: **manual** (UI), **chat** (composer attach / `/workflow`; runs bound
`current_session`), **schedule** (existing automations scheduler tick →
StartRun instead of dispatch_prompt), **agent** (Product MCP
`workflows.list` / `workflows.run` — the tool calls StartRun; it never
sees the definition). Phase C: **webhook** (GitHub events plumbing already
exists server-side) and **developer API**.

Executor identity (locked 2026-07-03): **no "Run as" in v1** — every
run executes as the workflow owner, locally and in cloud; there are no
team constructs yet, so a picker would be dead weight. In cloud, MCP/
integration credentials resolve against the owner's connected
integrations (standard availability gate: org enabled + owner
authenticated). `workflow_run.executor` stays in the data model
(always = owner today) so team/service-account executors — the vault's
"unattended runs must outlive people" — arrive later without a
migration.

### 3.6 UI (UX locked with Pablo 2026-07-03; Ona automation editor used
as the shape reference, departures noted)

**Workflows home** (`/workflows`, the existing route becomes real). Two
tabs: **Workflows** | **Runs**. Workflow card: name · step-glyph strip
(`◇ $ ⇈ 🔔`) · trigger chips · last-run dot + time · Run button (opens
args form when the workflow has args) · overflow. Runs tab: global run
table (workflow, trigger kind, run-as, status, duration, cost,
started). Empty state IS the templates gallery — 5 curated starters
(fix-until-green, Sentry triage, PR QA, changelog, weekly digest),
"start from template / from scratch". Free-plan cap (1
workflow/person) enforced here + server-side.

**Editor** (`/workflows/:id/edit`) — **two-pane full page**: left rail
= the program (vertical step chain, dotted-canvas background), right =
slide-in add/edit panel for the selected card. Rail order: Meta →
Setup → Triggers → Steps → `+`.

- **Meta**: name, description (no agent picker here — that's Setup).
- **Setup** (collapsed one-line summary when unselected): agent
  (harness + default model, `AgentHarnessModelSelector`) · target
  (`AutomationTargetPicker`) · session (`fresh (visible) | headless`;
  current-chat binding is implicit via mid-chat attach, never
  configured here) · *(no Run as in v1 — runs execute as the owner)* ·
  args schema rows (`name · type string|number|boolean|enum · default ·
  required`) feeding `{{args.*}}`/`{{steps[n].output.*}}` autocomplete
  everywhere · MCP/integration access (default: inherit target). No
  exec-policy selector: a fixed caption states "workflow runs use the
  agent's bypass mode" (locked: always bypass, no mode changes in
  workflows).
- **Triggers**: `▶ Manual` always-on + `+ Add schedule` (existing RRULE
  calendar). **Concurrency: simple toggle** — "if still running when
  triggered again: `skip | queue`" (one dropdown; no batch/parallel
  controls in v1). Webhook/API shown as disabled "soon" chips.
- **Step cards**: drag handle · kind badge · content preview ·
  kebab (duplicate/delete) · **on-fail select in the card footer**
  (`stop | retry ×1 | continue`). Panel editors per kind:
  Prompt (textarea w/ var autocomplete · **per-step model override**,
  `inherit ▾` default · **per-step harness switch**, `inherit ▾`,
  captioned "opens a new session in this workspace" · goal attachment
  below — no mode overrides, workflows always run bypass); Script
  (`$`-gutter mono editor · timeout · named output capture); Open PR
  (base branch · title/body templates · draft toggle); Notify
  (channel picker gated on configured integrations — Slack v1, email
  "soon" · templated message · always recorded in-app/run history);
  Approval (message · on-timeout `fail | continue`; approver = the
  workflow owner in v1).
- **Goal attachment** (the differentiator): inside the Prompt panel, a
  bordered `◎ Iterate until` section with enable toggle — rendered
  **only when the Setup harness advertises `supports_goals`**
  (Claude/Codex today); otherwise a quiet caption ("Goal iteration:
  not supported by <harness>"). Fields: objective textarea · caps row
  (max turns · max time · max tokens; required; defaults 25/90m/400k) ·
  `when blocked: notify | pause for approval | fail` · optional Verify
  (`shell command, expect exit 0` — "runs when the agent claims the
  goal is met; failure sends it back to work"). Rail card renders the
  distinct two-line treatment: `◇ Prompt — "…"` / `◎ until "…" · 25t ·
  90m`.

**Run view** (`/workflows/:id/runs/:runId`) — primary observability
(extends `AutomationRunTimeline`). Header: status pill · trigger +
run-as · args chips · duration · cost. Step timeline rows: status dot ·
badge · duration · typed output chips (`exit 0`, `PR #912 ↗`,
notification receipt). Goal-step rows carry the live goal line
(objective · iterations · tokens) + **Open session →** deep link into
the normal session view (goal bar iterating, activity chips — Phase
A/B surfaces are the drill-down; no duplicate viewer built here).
Approval rows resolve inline (approve/deny in the timeline).

**Sessions list integration (locked 2026-07-03): hidden.**
Workflow-run workspaces/sessions do NOT appear in the normal
workspace/session list. Their home is the run view (Open session →
deep link); a "show automation runs" toggle can come later if wanted.
Mid-chat runs are the exception by construction — they live in the
session you ran them from.

**Mid-chat**: composer `+` menu → "Run workflow" (or `/workflow
<name>`) → inline args mini-form → runs bound `current_session`; steps
render as compact transcript step items (timeline-row components,
transcript-sized); a goal step simply sets the session's goal bar.

Playground fixtures first for: step cards (all kinds + goal
attachment states), editor panels, run timeline states, transcript
step items.

Shared code goes to `apps/packages/product-domain/src/workflows/`
(definition model, template interpolation, validation — pure) and
`product-ui/src/workflows/` (blocks, timeline), following the automations
extraction precedent.

---

## 4. How the two features meet

- `agent.goal` is the bridge: the step arms the *same* Goal object via the
  *same* GoalService; the run timeline and the session UI show the *same*
  GoalCard; the Goals fleet pane lists workflow-armed goals with
  provenance (`source_kind = workflow`, link to the run).
- A goal met/failed event is the step's completion signal — no separate
  polling loop in the workflow engine.
- Long-term ("coworker" framing): a standing objective becomes a workflow
  with a schedule trigger + `agent.goal` step. No new primitive needed —
  that's the composition argument for this design.

## 5. Build order

Phase A — Goals + Loops end-to-end (small, high polish, independently
shippable; branches from `agent-auth/15-agents-ui` per locked decision):
1. codex-acp + claude-acp GoalPort + LoopPort (ext methods + tagged
   notifications; claude transcript tailing for goals, tool_use parsing
   for loops). Sidecar pin bumps.
2. anyharness `domains/goals/` + `domains/loops/` (model/service/store/
   observer/runtime ops), `LoopSchedulerExtension` for codex-emulated
   loops, contract types + HTTP surface + sqlite migrations + catalog
   `supports_goals` / tri-state `loops` capability (fix JS validator +
   Rust tests together).
3. Desktop: GoalCard/LoopCard + composer chips (playground fixtures
   first), then live wiring via sdk-react.
4. Goals fleet pane with loop badges (local sessions first; cloud
   projection follows).
5. End-to-end validation, two layers (locked — both required):
   a. today's probe scripts promoted into the test harness — real
      claude/codex sessions through anyharness asserting
      set → edit → observe → met/fire → clear on both harnesses;
   b. **manual live validation in the running product**: desktop app
      (`pdev`) with real Claude Code and Codex sessions, exercising the
      composer goal/loop chips and cards end-to-end, UI-driven via
      Playwright (or the established playground/screenshot flow) — not
      just unit/protocol tests. Credentials for live runs may be
      borrowed from `~/proliferate/.env`.

Phase B — Workflows core:
5. Server entities (`workflow`, `workflow_version`, `workflow_run`) +
   StartRun (resolve, pin, hand plan) + Automation → trigger migration
   (auto-wrap legacy prompts).
6. anyharness `domains/workflows/` + `WorkflowRunActor` with
   `agent.prompt`, `agent.goal`, `shell.run` — desktop-local runs,
   manual trigger.
7. Builder UI + run timeline (fixtures first), `tool.call`/`notify`,
   `scm.open_pr`.
8. Cloud runs: scheduler → StartRun → sandbox actor; run events up the
   worker tail; Run as executor.

Phase C — `human.approval` durable pause, webhook/API triggers,
`workflow.call`, emulated goals (gemini/opencode), goal cost caps via
inference-gateway metering.

## 6. Risks / open items

- **Sidecar release loop**: codex-acp/claude-acp are separate forked
  packages with a known publish/scope gotcha — budget for the pin-bump
  dance; land GoalPort behind a capability check so an old sidecar just
  reports `supports_goals=false`.
- **Claude `/goal` while a turn is streaming**: probe showed mid-turn
  edits steer correctly on Codex; on Claude the `/goal` message queues as
  input. The runtime should prefer step-boundary arming (set before
  prompt) — which is what `agent.goal` does anyway.
- **This branch's ORM caveat**: `cloud_command`/`cloud_target` models are
  mid-cutover on `agent-auth/15-agents-ui`. Phase A (goals + loops) is
  runtime/desktop-side and branches from `agent-auth/15-agents-ui`
  (locked); Phase B server work should still branch from main after the
  gateway cutover lands.
- **Claude cron wakes — RESOLVED (probe, 2026-07-02)**: session crons DO
  fire under SDK-driven sessions (see §1); no Claude fallback needed.
  Remaining sub-items: (a) wake turns arrive as *spontaneous* turns —
  anyharness turn attribution must not treat them as user prompts;
  (b) cron lifetime = CLI process lifetime, so loops on cloud sessions
  require the session process to stay resident; (c) re-arm across
  `--resume` — RESOLVED (probe, 2026-07-02): wakes restart on resume
  with no re-arm needed.
- **Emulated-loop turn injection (codex)**: scheduler fires only at
  idle and coalesces missed fires; a fire during a long turn must not
  queue unboundedly.
- **Naming**: UI already says "Workflows" for automations; the migration
  renames the concept truthfully (Workflow = program, Trigger = the old
  automation) — copy pass needed so existing users aren't confused.
- **Free-plan gating** (1 workflow/person) needs a server-side check at
  workflow create, not just UI.
