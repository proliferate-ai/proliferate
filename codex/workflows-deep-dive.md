# Workflows — navigable deep dive

> **Historical current-state snapshot, not the current contract.** This file is
> useful for implementation provenance at the old verified SHA named below.
> Current target behavior lives in
> [`specs/codebase/features/workflows.md`](../specs/codebase/features/workflows.md),
> and the audited completion sequence lives in
> [`specs/tbd/workflows-v1-completion-plan.md`](../specs/tbd/workflows-v1-completion-plan.md).

> **This doc is the map of the CURRENT state.** It is organized for someone reading
> to *understand* the system: click a link, land on the real code. Every path below
> was verified against the worktree `workflows/ui-round3` (tip `dfe38a81b`). Links
> are relative to this file (`codex/`).
>
> Companion: [`workflows-architecture.md`](workflows-architecture.md) is the
> **end-state** doc for the PR A–E arc (actions ledger + Slack delivery, poll
> triggers, `agent.emit`, `workflow.include` composition, gateway function grants) — read it for
> where the system is going and the [OPEN-n] decision log; read this for what is
> built today.

Four nouns, unchanged: **Session** = conversational context · **Run** = one
execution · **Workflow** = the program · **Trigger** = a thing that starts a run.
An automation is *only* a trigger; the deterministic `WorkflowRunActor` advances
the step cursor. The LLM performs agent steps but never interprets the workflow.

Two load-bearing invariants to keep in your head while reading:

1. **Whole-plan delivery.** `StartRun` is the *only* resolution point. The server
   pins an immutable version, bakes `{{args.*}}`, and hands the entire self-contained
   plan JSON to a runtime. The actor never fetches a definition.
2. **Desired / observed split.** Postgres owns the program + durable run ledger
   (desired state). anyharness/SQLite owns observed execution truth (cursor, per-step
   status, outputs). The server never talks step-by-step to the runtime — it delivers
   once (idempotent on `run_id`) and reconciles observed state by *receiving* `/status`
   reports (local) or *pulling* `/refresh` (cloud).

---

## Reading paths — "to understand X, read these in order"

**① Add a new step kind.**
1. [plan.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/plan.rs) — add the `StepKind` variant + payload struct (internally-tagged enum; an unknown kind is a hard deserialize error).
2. [domain/definition.py](../server/proliferate/server/cloud/workflows/domain/definition.py) — write a parser, register it in `_STEP_PARSERS`, add the slug to [constants/workflows.py](../server/proliferate/constants/workflows.py) `SUPPORTED_WORKFLOW_STEP_KINDS`.
3. [executor.rs](../anyharness/crates/anyharness-lib/src/live/workflows/executor.rs) `execute_step` dispatch + a `run_*` method; deterministic side effects go in [commands.rs](../anyharness/crates/anyharness-lib/src/live/workflows/commands.rs).
4. TS mirror: [definition.ts](../apps/packages/product-domain/src/workflows/definition.ts), [validation.ts](../apps/packages/product-domain/src/workflows/validation.ts), [run-status.ts](../apps/packages/product-domain/src/workflows/run-status.ts) (output chip), editor [WorkflowStepPanel.tsx](../apps/desktop/src/components/workflows/editor/WorkflowStepPanel.tsx).

**② Debug a stuck run.**
1. Read the ledger row status: [db/models/cloud/workflows.py](../server/proliferate/db/models/cloud/workflows.py) `WorkflowRun` + the transition guard [domain/run_status.py](../server/proliferate/server/cloud/workflows/domain/run_status.py).
2. Runtime truth: [model.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/model.rs) statuses + [service.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/service.rs) `run_next_step`/`apply_decision`.
3. Who is (not) driving: [manager.rs](../anyharness/crates/anyharness-lib/src/live/workflows/manager.rs) `spawn_actor` / crash-resume `spawn_startup_pass`, and [actor.rs](../anyharness/crates/anyharness-lib/src/live/workflows/actor.rs) `drive_run`.
4. Local lane not reporting? The relay is app-open-only: [use-local-workflow-relay.ts](../apps/desktop/src/hooks/access/cloud/workflows/use-local-workflow-relay.ts) + [relay.ts](../apps/desktop/src/lib/domain/workflows/relay.ts). Cloud lane: [delivery.py](../server/proliferate/server/cloud/workflows/delivery.py) `refresh_cloud_run`.

**③ Understand delivery.**
1. [service.py](../server/proliferate/server/cloud/workflows/service.py) `start_run` + `_resolve_plan` (plan shape).
2. Cloud lane: [delivery.py](../server/proliferate/server/cloud/workflows/delivery.py) `deliver_cloud_run` → [integrations/anyharness/workflow_runs.py](../server/proliferate/integrations/anyharness/workflow_runs.py).
3. Local lane: [use-launch-workflow-run.ts](../apps/desktop/src/hooks/access/cloud/workflows/use-launch-workflow-run.ts) → [lib/access/anyharness/workflow-runs.ts](../apps/desktop/src/lib/access/anyharness/workflow-runs.ts).
4. Runtime receive side: [api/http/workflow_runs.rs](../anyharness/crates/anyharness-lib/src/api/http/workflow_runs.rs) `create_workflow_run` → [manager.rs](../anyharness/crates/anyharness-lib/src/live/workflows/manager.rs) `deliver` → [service.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/service.rs) `create_run_idempotent`.

**④ Change the UI.**
1. Routes: [AuthenticatedAppHost.tsx](../apps/desktop/src/pages/AuthenticatedAppHost.tsx) (lines 63–66).
2. Screens: [WorkflowsHomeScreen.tsx](../apps/desktop/src/components/workflows/screen/WorkflowsHomeScreen.tsx), [WorkflowEditorScreen.tsx](../apps/desktop/src/components/workflows/screen/WorkflowEditorScreen.tsx), [WorkflowRunScreen.tsx](../apps/desktop/src/components/workflows/screen/WorkflowRunScreen.tsx).
3. Shared view logic: [product-domain/src/workflows/run-status.ts](../apps/packages/product-domain/src/workflows/run-status.ts) `deriveStepRunViews` + presentational rows in [product-ui/src/workflows/](../apps/packages/product-ui/src/workflows/WorkflowRunTimelineRow.tsx).
4. Data access hooks: [hooks/access/cloud/workflows/](../apps/desktop/src/hooks/access/cloud/workflows/use-workflows.ts).

---

## Table of contents

1. [End-to-end flow (both lanes)](#1-end-to-end-flow-both-lanes)
2. [Data model — tables, enums, transitions](#2-data-model--tables-enums-transitions)
3. [Server layer (control plane)](#3-server-layer-control-plane)
4. [Runtime layer (anyharness)](#4-runtime-layer-anyharness)
5. [Goals substrate it depends on](#5-goals-substrate-it-depends-on)
6. [Desktop / UI layer](#6-desktop--ui-layer)
7. [Design decisions + rationale](#7-design-decisions--rationale)
8. [Known gaps / drift + PR map](#8-known-gaps--drift--pr-map)
9. [Operational recipes](#9-operational-recipes)

---

## 1. End-to-end flow (both lanes)

### 1a. Create → StartRun → deliver → actor → observed status → run view

```
 ┌─────────── DESKTOP ───────────┐        ┌──────────── SERVER (control plane, Postgres) ────────────┐
 │ WorkflowEditorScreen          │        │                                                          │
 │  serializeWorkflowDefinition ─┼─PATCH──▶ /v1/cloud/workflows/{id}  → workflow_version (append)    │
 │                               │        │                                                          │
 │ Run → WorkflowRunArgsModal    │        │ service.start_run():                                     │
 │ useLaunchWorkflowRun ─────────┼─POST───▶  /workflows/{id}/runs                                    │
 │                               │        │   • pin version  • coerce args  • interpolate {{args.*}} │
 │                               │◀───────┤   • insert workflow_run (status=pending_delivery)        │
 │  run.resolvedPlan             │        │      resolved_plan_json = whole self-contained plan      │
 │                               │        │                                                          │
 │  LOCAL lane (client-driven):  │        │   CLOUD lane (personal_cloud): server delivers itself,   │
 │  createLocalWorkflowRun ──────┼─POST──┐ │   IN THE SAME StartRun REQUEST, gateway-direct:         │
 │    → local anyharness :8457   │       │ │   deliver_cloud_run → ensure_cloud_sandbox_gateway_     │
 │  markWorkflowRunDelivered ────┼─POST──┼─▶   access (wake+auth) → POST /v1/workflow-runs → sandbox │
 └───────────────┬───────────────┘       │ └──────────────────────────────────────────────────────┘
                 │  POST /v1/workflow-runs {plan, workspaceId}
                 ▼
 ┌──────────────────────── anyharness (runtime, SQLite) ───────────────────────┐
 │ api/http/workflow_runs::create_workflow_run  (202, idempotent on plan.run_id)│
 │ WorkflowRunManager.deliver                                                   │
 │   create_run_idempotent → workflow_runs + workflow_step_runs (all pending)   │
 │   spawn_actor(run_id)                                                        │
 │     actor::drive_run ── loop while Advanced ──▶ WorkflowService.run_next_step │
 │        WorkflowStepExecutorImpl.execute_step  (per-kind semantics)           │
 │           agent.prompt → session turn ; +goal → arm+await GoalMet ;          │
 │           shell.run/scm/notify → deterministic ; human.approval → suspend    │
 │        decide_after_step → apply_decision → advance / retry / fail / wait    │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                         │ observed status reconciled back to server:
      LOCAL:  WorkflowRelayProvider polls GET /v1/workflow-runs/{id}
              → planRelayReports diff → POST /v1/cloud/.../runs/{id}/status  (delivered→running→terminal)
      CLOUD:  run view polls GET /v1/cloud/.../runs/{id}/refresh
              → server reads GET /v1/workflow-runs/{id} through the gateway → syncs ledger
                                         │
                                         ▼
                       WorkflowRunScreen (useWorkflowRun 2.5s poll of the SERVER ledger)
                       deriveStepRunViews → run timeline (live goal line, output chips)
```

The single hinge: **the server never talks step-by-step to the runtime.** Local
state flows runtime→server *only* (desktop pushes `/status`); cloud state flows by
the server *pulling* `/refresh` (no worker→server push channel in v1).

### 1b. Step execution for `agent.prompt` + goal (arm → await → verify → terminal)

```
run_goal(agent, goal, step_index)                           executor.rs:250
  │
  ├─ ensure_session(slot)  ─ per-slot: reuse the slot's session or create it  :147
  │     in bypass mode (harness fixed per slot — no harness-switch)
  ├─ arm_goal(session, goal)   ── SetSessionGoalRequest{status:Active,      :368
  │     source_kind:Workflow, source_run_id} → goal_runtime.set_goal
  │     (ONLY place that stamps GoalSourceKind::Workflow)
  ├─ subscribe(session)  ── broadcast::Receiver<SessionEventEnvelope>       :214
  │     (subscribe BEFORE prompting so a fast terminal event isn't missed)
  ├─ send_prompt(...)
  │
  └─ await_goal_terminal(events, deadline, on_blocked, on_progress)         :557
        deadline = max_wall_secs + GOAL_BACKSTOP_GRACE(60s)   ← wall-clock backstop
        loop on SessionEvent:
          GoalUpdated ──▶ on_progress: record_step_goal_progress (throttled) ── live UI line
          GoalUpdated(blocked) ──▶ on_blocked:  Notify=keep waiting
                                                 PauseForApproval=AwaitApproval{goal_block}
                                                 Fail=Failed{goal_blocked}
          GoalUpdated(failed) ──▶ Failed{code=failed_reason}   (cap breach)
          GoalMet ──▶ verify?  none  → Completed{met_reason}
                             │  present→ run_verify_shell; exit==expect_exit → Completed{verified}
                             │           else re-arm w/ feedback (≤ MAX_VERIFY_ATTEMPTS=3)
                             │                     exhausted → verify_exhausted (clears goal)
          GoalCleared / SessionEnded ──▶ Failed{goal_cleared | session_closed}
          GoalWait::Timeout ──▶ clear_goal + Failed{goal_timeout}
```

Goal-met is model judgment; `verify` is ground truth. The wall-clock deadline is a
backstop for a hung in-flight turn the goals-domain cap guard (fires only on turn
boundaries) can't see. See [§5](#5-goals-substrate-it-depends-on).

### 1c. `agent.config` → per-slot model change (model-only, A3)

```
run_agent_config(slot, cfg)   executor.rs     (executes instantly, opens NO session)
  agent.config is MODEL-ONLY (A3): harness is fixed per slot, so a different
  harness is a different slot — the harness-switch machinery is DELETED.
    model changed → fold onto self.models[slot]; applied LIVE to the slot's
        session if one is already open:
           set_live_session_config_option(session_id, ACP_MODEL_COMPAT_CONFIG_ID, model)
           (slot's session not open yet ⇒ takes effect at its next creation)
  output: {model?, slot}

On resume: recompute_models folds every agent.config in the plan prefix
[0, cursor) over the plan's per-slot `sessions[slot].model` seed — derived purely
from plan+cursor, NO persisted config row.   executor.rs
```

### 1d. slot-keyed sessions (B7) + the C14 required-invocation gate

```
Sessions are SLOT-KEYED: each agent slot owns exactly one session for the run's
lifetime. `WorkflowStepExecutorImpl.current: HashMap<slot, CurrentSession>` and
`models: HashMap<slot, Option<String>>` replace the old single pointer.
`ensure_session(slot)` opens the slot's session lazily (harness from
`plan.sessions[slot]`), or — if `bind_session_id` is set (L29 / PR F, always
absent today) — loads an existing one. The slot→session_id map is persisted via
`set_session_for_slot` into `session_ids_json` (was an ordered list; now a
{"triage":"sess_…"} object).

C14 gate (arch §7.6): when an `agent.prompt` carries `required_invocation
{provider,tool}`, run_prompt re-prompts up to MAX_GATE_ATTEMPTS(3), collecting
the turn's ToolCall native tool names and matching provider+tool
(`mcp__<provider>__<tool>` and bare spellings). Exhaustion → `invocation_missing`
(on_fail matrix applies).
```

---

## 2. Data model — tables, enums, transitions

### 2a. Postgres (control plane)

File tree:

```
server/proliferate/
├── db/models/cloud/workflows.py        # ORM: Workflow, WorkflowVersion, WorkflowRun, WorkflowTrigger, WorkflowStepAction
├── db/store/cloud_workflows.py         # async data-access for workflow/version/run/step-action
├── db/store/cloud_workflow_triggers.py # trigger store incl. claim_due_schedule_trigger (FOR UPDATE SKIP LOCKED)
├── constants/workflows.py              # status enums, transition table, step-kind set, caps, free-plan limit
└── alembic/versions/
    ├── e4f7a2b9c6d1_workflow_entities.py   # workflow + version + run tables (down_rev c9b8a7d6e5f4)
    ├── b2d4f6a8c0e1_workflow_trigger.py    # workflow_trigger + trigger_id/scheduled_for on run (down_rev e4f7a2b9c6d1)
    ├── c3a5e7f9d1b2_workflow_step_action.py # workflow_step_action table (down_rev b2d4f6a8c0e1) — PR A
    └── f1c3d5b7a9e2_workflow_poll_trigger.py # poll columns + workflow_trigger_item (down_rev c3a5e7f9d1b2) — PR B
```

All four migrations are idempotent (guarded `_has_table`/`_has_index`/`_has_column`/`_has_check`).

**Tables** ([db/models/cloud/workflows.py](../server/proliferate/db/models/cloud/workflows.py)):

- **`workflow`** (line 38) — the program. `owner_user_id` (no personal/org `scope`
  column — v1 personal only), `current_version_id` (nullable, **no DB FK** — the two
  tables reference each other; app keeps it consistent), `archived_at` (soft-delete).
  Partial index `ix_workflow_owner_active … WHERE archived_at IS NULL` (line 46)
  serves both the home list and the free-plan cap.
- **`workflow_version`** (line 75) — immutable append-only; `definition_json` JSONB
  is the canonical validated dict; `UniqueConstraint(workflow_id, version_n)`.
- **`workflow_run`** (line 97) — the durable ledger; **run id is the delivery
  idempotency key** and travels inside the plan. CHECK constraints verbatim:

```python
CheckConstraint("trigger_kind IN ('manual', 'schedule', 'poll', 'chat', 'agent', 'api')", name="ck_workflow_run_trigger_kind"),
CheckConstraint("target_mode IN ('local', 'personal_cloud')", name="ck_workflow_run_target_mode"),
CheckConstraint(
    "status IN ('pending_delivery', 'delivered', 'running', 'waiting_approval', "
    "'completed', 'failed', 'cancelled')",
    name="ck_workflow_run_status"),
```
<sub>[db/models/cloud/workflows.py:102-121](../server/proliferate/db/models/cloud/workflows.py#L102)</sub> — `trigger_kind` widened to include `'poll'` (PR B).

Key columns: `workflow_version_id` FK **RESTRICT** (can't delete a version with runs);
`trigger_id` FK **SET NULL** (set only for scheduled runs); `scheduled_for` (RRULE slot —
dedup + FIFO key); `executor_user_id` (always = owner in v1); `resolved_plan_json`
(the whole payload); `step_cursor`, `step_outputs_json` (observed); `anyharness_workspace_id`,
`anyharness_session_ids` (observed); `cost_usd`/`cost_tokens`.

The hard double-fire guard is a **partial unique index**:
```python
Index("uq_workflow_run_trigger_slot", "trigger_id", "scheduled_for", unique=True,
      postgresql_where=text("trigger_id IS NOT NULL AND scheduled_for IS NOT NULL")),
```
<sub>[db/models/cloud/workflows.py:141-147](../server/proliferate/db/models/cloud/workflows.py#L141)</sub>

- **`workflow_trigger`** (line 200) — *only* a trigger (pins target + schedule/poll
  + concurrency, funnels to the same `StartRun`). CHECKs: `kind IN ('schedule',
  'poll')` (widened PR B), `concurrency_policy IN ('skip','queue')`,
  `target_mode IN ('local','personal_cloud')`, a cloud⇒workspace / local⇒null
  constraint (line 225), `ck_workflow_trigger_schedule_fields` (line 237 — a
  `schedule` must carry rrule + timezone + next_run_at), — PR B —
  `ck_workflow_trigger_poll_fields` (line 242 — a `poll` must carry `poll_url` +
  `poll_interval_secs`), and — **PR G (D16)** — `ck_workflow_trigger_repo_full_name`
  (a schedule/poll trigger must pin `repo_full_name`). Scheduler due-scan index
  `ix_workflow_trigger_scheduler_due` (line 248).
  **D16 repo pin (PR G):** `repo_full_name` ("org/repo") is the *authored* "where";
  `target_workspace_id` becomes **derived** — on trigger create/update the service
  resolves the caller's cloud repo environment for the pin and ensures a dedicated
  server-owned cloud workspace (reuse the repo's warm workspace, else provision the
  row via `cloud_workspaces.create_cloud_workspace`), stamping its id. Worktree
  materialization is NOT forced at save — `start_run` still raises
  `target_workspace_not_ready` until the runtime workspace is ready, so that 409 is
  a retry-at-fire concern, not a save error. The trigger-fire path is unchanged (it
  passes the pinned id into `start_run`). `input_presets_json` records the schedule
  preset input values behind the **enable-gate**: a schedule trigger cannot be
  `enabled` until every required workflow input has a preset (`schedule_presets_incomplete`
  400); a disabled draft may leave them blank. For schedule triggers the presets
  mirror `args_json` (the fire-time args). Poll columns (line 305) — endpoint, auth header *name*,
  Fernet-encrypted auth header *value* (`poll_auth_ciphertext`, house crypto
  helpers, never surfaced on reads), interval, item JSON Schema *derived from the
  workflow inputs* (D17 — no `poll_args_mapping_json`, dropped in-migration),
  opaque server-issued cursor, `last_poll_at`/`last_poll_error`
  — plus the poller's own due-scan index `ix_workflow_trigger_poller_due` (line
  257, partial on `enabled = true AND kind = 'poll'`).
- **`workflow_trigger_item`** (line 329, PR B) — the per-trigger seen-set: composite
  PK `(trigger_id, item_id)` on the poll item's endpoint-supplied `id` **is** the
  at-most-one-spawn-per-item guarantee (`insert_trigger_item`'s `INSERT ... ON
  CONFLICT DO NOTHING` is the CAS). `status` CHECK `spawned|invalid|error` (line
  341) doubles as the trigger-error surface: schema-invalid items and StartRun
  failures are recorded, never silently dropped. `run_id` FK **SET NULL** (item
  history survives a deleted run).
- **`workflow_step_action`** (line 364, PR A) — the step-actions ledger: server-side
  actions (Slack sends today) claimed off *observed* step completions. An action
  performs the side effect of a step the runtime already executed; it never decides
  what runs next (L19). `UniqueConstraint(run_id, step_key, action_kind)` (B5)
  **is** the claim — whichever observer's `INSERT ... ON CONFLICT DO NOTHING` lands
  owns performing the action. `status` CHECK `pending|done|failed` (line 395); partial
  index `ix_workflow_step_action_sweep … WHERE status = 'pending'` (line 398) drives
  the sweeper. Honest guarantee (stated in the model docstring): **exactly-once
  claim, at-least-once completion** — a crash between a successful Slack POST and
  the `status='done'` commit can duplicate a send, the same class as any
  non-transactional external side effect.

### 2b. Run status enum + transition table

Source: [constants/workflows.py](../server/proliferate/constants/workflows.py) — statuses,
`WORKFLOW_RUN_TERMINAL_STATUSES` (line 62), `WORKFLOW_RUN_STATUS_TRANSITIONS` (line 73),
`WORKFLOW_RUN_OBSERVABLE_STATUSES` (line 103). Guard enforced by
[domain/run_status.py](../server/proliferate/server/cloud/workflows/domain/run_status.py)
`check_transition` (line 37): a same-status report is an idempotent no-op; terminal
has no outgoing edges.

| from | allowed → |
|---|---|
| `pending_delivery` | `delivered`, `cancelled` |
| `delivered` | `running`, `cancelled` |
| `running` | `waiting_approval`, `completed`, `failed`, `cancelled` |
| `waiting_approval` | `running`, `completed`, `failed`, `cancelled` |
| terminal (`completed`/`failed`/`cancelled`) | — |

`WORKFLOW_RUN_OBSERVABLE_STATUSES` (what the runtime may self-report via `/status`) =
`running | waiting_approval | completed | failed | cancelled`. `delivery`
(`pending_delivery → delivered`) is its own endpoint, not a `/status` report.

### 2c. SQLite (runtime observed truth)

[persistence/sql/0053_workflow_runs.sql](../anyharness/crates/anyharness-lib/src/persistence/sql/0053_workflow_runs.sql):

- `workflow_runs(run_id PK, …, workspace_id NOT NULL REFERENCES workspaces ON DELETE
  CASCADE, plan_json NOT NULL, status NOT NULL, step_cursor DEFAULT 0, session_ids_json?,
  …)` + indexes on `(workspace_id, created_at DESC)` and `(status)`.
- `workflow_step_runs(run_id FK CASCADE, step_index, step_key NOT NULL, kind, status,
  attempt DEFAULT 0, output_json?, …, PRIMARY KEY(run_id, step_index))` + a unique
  index on `(run_id, step_key)`. `step_key` is the format-v2 structured key
  "<node>.<lane>.<step>" (B5); the cursor stays an integer position, but the key
  is the step's stable identity (outputs are reported by key). The Postgres
  `workflow_step_action` claim is `(run_id, step_key, action_kind)`.

Rust status mirrors ([model.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/model.rs)):
`WorkflowRunStatus = Running|WaitingApproval|Completed|Failed|Cancelled` (terminal:
last three; note **no** `pending_delivery`/`delivered` — those are control-plane-only);
`WorkflowStepStatus = Pending|Running|Waiting|Completed|Failed|Skipped`.

---

## 3. Server layer (control plane)

File tree — [server/proliferate/server/cloud/workflows/](../server/proliferate/server/cloud/workflows/):

```
cloud/workflows/
├── api.py          # FastAPI router, mounted at /v1/cloud/workflows; owner-scoped
├── models.py       # Pydantic request/response (populate_by_name, camelCase wire aliases)
├── service.py      # workflow/version CRUD, trigger CRUD (schedule + poll), StartRun + _resolve_plan
├── delivery.py     # cloud lane: deliver_cloud_run, refresh_cloud_run
├── scheduler.py    # second beat: fire due triggers + poll pass + deliver eligible cloud runs + refresh/sweep
├── actions.py      # PR A: step-actions ledger — claim_step_action, apply_step_actions, sweep_pending_actions
├── poller.py       # PR B: poll-trigger primitive — _poll_one_trigger, run_poll_pass, overlay_item_inputs
└── domain/         # pure, unit-tested, no DB
    ├── definition.py     # strict validator: raw dict → canonical dict
    ├── interpolation.py  # template grammar + arg coercion + injection guard
    ├── run_status.py     # transition guard (is_terminal / transition_allowed / check_transition)
    ├── policy.py         # free-plan cap (workflow_create_allowed / free_plan_workflow_limit)
    └── poll_contract.py  # PR B: PollItem/PollPage models + validate_item_data + derive_item_schema (inputs → JSON Schema, D17)
```
Integration boundary (raw HTTP to anyharness, kept out of the product domain):
[integrations/anyharness/workflow_runs.py](../server/proliferate/integrations/anyharness/workflow_runs.py)
(`deliver_workflow_run`, `read_workflow_run`).

### 3.1 Validator — [domain/definition.py](../server/proliferate/server/cloud/workflows/domain/definition.py)

**Format v2 (PR A — data-contract §1).** `parse_definition(raw, *,
require_steps=True)` → `(canonical, [ArgSpec])`. Rejects unknown kinds *and*
unknown fields. Top-level keys are now `{version, name?, description?, inputs,
integrations, agents}` — a hard cut from the old `{args, setup, steps}` (no dual
parser, no migration; E4). The spine is `agents: [{slot, harness, model, steps}]`
(≥1 node, slot unique `^[a-z][a-z0-9_]*$`); there is no top-level `steps` and no
`setup` (slot = session affinity; `session_binding` is stamped on the resolved
plan, not authored). **Zero-agent draft rule**: `require_steps=False` on
create/update; `StartRun` always parses with `require_steps=True`.

**Integrations (PR E, E3 namespace-only).** `integrations` is a flat list of
integration namespace strings (`["sentry","linear","slack"]`) — no `{provider,
tools}` shape, no tool lists anywhere in the definition. `_parse_integrations`
validates each is an identifier, deduped. `resolve_run_scope` stamps the
namespace grant per slot into `scope_json` (`{"<slot>": {"integrations": [...]}}`)
with NO tool fetch at mint (no `tools/list` call, no new StartRun failure mode).
The gateway enforces a namespace-only scope entry as "ALL tools of that
provider" at call time (`domain/scope.py`), so providers whose tools grow
mid-run work without re-mint.

Step kinds ([constants/workflows.py](../server/proliferate/constants/workflows.py)):
`agent.config` (narrowed to `{model}` only — same-harness rule), `agent.prompt`
(+`required_invocation?{provider,tool}`), **`agent.emit`** (NEW: `name` required +
unique, `output_schema?`, `max_attempts` default 3), `shell.run`, `scm.open_pr`,
**`branch`** (NEW: `on` = one prior-emit ref, `cases:{value:{to:continue|end}}`,
`reason?`), `notify` (Slack-only — `{slack_channel_id, message}`, the `channel`
discriminator and `in_app` are removed, E1b). **`human.approval` is removed (E1)**
— the `waiting_approval` run status survives via `goal.on_blocked`.

`_validate_spine_references` walks the flattened run order enforcing emit-name
uniqueness (whole definition) and *strictly-prior* ref visibility: `{{inputs.NAME}}`
must be a declared input; `{{EMIT.FIELD}}` must name an emit produced by an
earlier step (earlier nodes in full, earlier steps in the same node).

**`integrations` (§6, PR E, E3 namespace-only)** — `_parse_integrations`
(top-level, not a step) validates a flat list of namespace strings
(`["sentry","linear","slack"]`): each an identifier, deduped. No `{provider,
tools}` shape and no tool lists anywhere. Structural only here (`parse_definition`
stays pure); the owner-visibility check needs the DB and runs in the service layer
(§3.4a).

**`workflow.include` (§3.5, PR D)** — `_parse_workflow_include` validates the
definition-only composition step's shape (a UUID `workflow_id`, an `args` mapping of
child-arg identifiers → template strings). Its arg-mapping values are ordinary
templated strings in the parent's context, so `_iter_step_strings` yields them and
`_validate_references` checks them against the parent's args/earlier steps. That
same reference pass now tracks which earlier steps are includes and rejects any
`{{steps[i]...}}` / `{{steps.<name>...}}` that targets one (`include_step_reference`)
— an include produces no output and referencing into the child is out of scope v1.
The DB-backed checks (target ownership, arg coverage, cycles) live in the service
layer, not here; the resolver ([composition.py](../server/proliferate/server/cloud/workflows/domain/composition.py))
inlines it away at StartRun (§3.3).

### 3.2 Interpolation — [domain/interpolation.py](../server/proliferate/server/cloud/workflows/domain/interpolation.py)

Stored grammar is `{{inputs.<name>}}` + `{{<emit>.<field>}}` (B6). Reserved
first-segments: `inputs`, `steps`, `fields`.

- `coerce_arguments` (unchanged machinery) — strict (rejects unknown inputs),
  fills defaults, enforces required, coerces to declared type (text|number|
  choice|boolean, E2).
- `resolve_string` / `resolve_value` — the resolver's single pass: eager
  `{{inputs.*}}` substitution (segment-based; `_escape_braces` backslash-escapes
  `{`/`}` so an input value can't inject a live token) **and** rewrites
  `{{<emit>.<field>}}` → `{{steps[n].output.<field>}}` using the emit→flat-index
  map. templates.rs stays on the indexed grammar (unchanged) and unescapes.

### 3.3 Service — [service.py](../server/proliferate/server/cloud/workflows/service.py)

`start_run(...)` (line 316): validate target_mode/trigger_kind → owner-scoped 404 →
cloud target must be materialized (`target_workspace_not_ready` 409 before any row)
→ pin version → `parse_definition` strict → `coerce_arguments` →
`resolve_included_agents` (composition, PR D — below) → `_resolve_plan`
(line 262) → `store.create_run(status=pending_delivery)`. The run id is
pre-generated so it is inside the payload before insert. `trigger_kind` accepts
`'poll'` (PR B) exactly like `'schedule'` — from `start_run` onward a poll-fired
run is indistinguishable from a manual one (below, and [poller.py](../server/proliferate/server/cloud/workflows/poller.py)).

**Resolved-plan shape** (verbatim):
```python
return {
    "run_id": str(run_id),
    "plan_version": 1,
    "workflow_id": str(workflow_id),
    "workflow_version_id": str(version.id),
    "version_n": version.version_n,
    "trigger_kind": trigger_kind,
    "target_mode": target_mode,
    "sessions": {slot: {harness, model, session_binding, bind_session_id?}},  # per-slot
    "inputs": coerced_inputs,                        # eager values, verbatim
    "steps": [...],  # flattened spine, includes inlined FIRST (composition); each step
                     # stamped key="<node>.-.<step>", slot, label; {{inputs.*}} baked,
                     # {{emit.field}} rewritten to {{steps[n].output.field}}
}
```
`session_binding` defaults by trigger kind (manual/chat=fresh, schedule/poll=headless).
StartRun wire (B9): `args`→`inputs`, `target` = `workspace_id` XOR `trigger_id`,
optional `session_bindings:{slot:session_id}`.

**Composition by inlining (PR D, L20)** — [domain/composition.py](../server/proliferate/server/cloud/workflows/domain/composition.py).
A `workflow.include` step is **definition-only**: `resolve_included_steps` splices
the target workflow's CURRENT version's steps into the parent's agents spine at
StartRun, **before delivery** — one run, one plan, one cursor, one sandbox. There
is no child run, no parent linkage, no spawn. **The runtime is COMPLETELY unchanged
by D — there is no `plan.rs` change; the resolver eliminates every include step
before the flatten pass, so the runtime never sees one. That is the design (the
"no include kind in a resolved plan" property is asserted in
`test_workflow_include.py`).**

**Adapted to the v2 agents spine (this rebase):** a `workflow.include` step lives
*inside an agent node's step list* and inlines the child definition's STEPS into
that node (`resolve_included_agents` walks every node; `resolve_included_steps`
expands one node's step list). Composition operates **purely on the v2 named-ref
grammar** (`{{inputs.*}}` / `{{<emit>.<field>}}`) — it never touches indices. The
*parent's* single flatten pass (`_resolve_plan`) later assigns structured step keys
and rewrites every `{{<emit>.<field>}}` to the runtime's indexed
`{{steps[n].output.<field>}}`, so the ref-namespacing obligation collapses to
name-prefixing. Ordering is still load-bearing: inline FIRST, then the flatten
pass's eager `{{inputs.*}}` + emit-index rewrite runs over the whole spine in one
place. **A child definition with more than one agent node is REJECTED as an include
target for now (`include_multi_agent`, PROPOSED per A3's include row)** — cross-spine
inlining is the Part II composition pass's problem; the child's single node's
harness/model are discarded (its steps run in the parent node's slot). The two
resolver obligations (spec 3.5):

- **Arg binding** — the include's `args` mapping becomes the child's input context:
  each child `{{inputs.<name>}}` token is textually replaced by the mapping value
  (no brace-escaping — both sides are author-written definition text, unlike a
  user-supplied StartRun input). Mapping values may carry the PARENT's `{{inputs.*}}`
  (eager-resolved by the flatten pass) and `{{<emit>.<field>}}` refs (stay
  late-bound, rewritten to indexed form by the flatten pass); uncovered optional
  child inputs fall back to their default.
- **Emit-ref namespacing** — each child `agent.emit` `name` is prefixed
  `<includeName>_` and every child `{{<emit>.<field>}}` ref to one of them is
  rewritten to `{{<includeName>_<emit>.<field>}}` (includeName = the include's
  `name`, else `w<parentStepIndex>`). Prefixing happens BEFORE arg binding so a
  parent emit ref injected via the mapping (which names a PARENT emit) is never
  itself prefixed. The parent's own refs to an include handle are rejected at save
  (`include_step_reference`) — an include has no emit output, and cross-spine refs
  into the child are out of scope v1.

Nesting is recursive (B may include C — the child's emit names are prefixed at
each level: `w2_w1_g`) and depth-capped at `WORKFLOW_MAX_INCLUDE_DEPTH=5`; a
resolution-time breach fails the run cleanly (`include_depth_exceeded`) before any
delivery. Save-time validation (`validate_includes`, called from
`create_workflow`/`update_workflow`, walking every node's steps) proves the target
exists / is same-owner / not archived / has exactly one agent node
(`include_multi_agent`), is not self-included (`self_include`), that the mapping
covers the child's required inputs and references only declared child inputs
(`include_args_mismatch`), and that the include graph has no cycle (`include_cycle`,
naming the path). A child changed since save (e.g. it grew a required input or a
second agent node) re-fails at resolution with the same code.

*Surface-syntax decisions STILL pending Pablo's veto (unchanged by this rebase —
chosen by the orchestrator where §3.5 left the surface open):* the step kind is
`workflow.include` (deliberately not `workflow.run` — no runtime verb); its shape
is `{kind, workflow_id, args:{<child-input>: <template>}, name?}`; the arg mapping
is a flat `{child-input-name: template-string}` object; child emit-name prefixing
uses `<includeName>_<origName>` with `w<parentStepIndex>` as the default include
name. These four remain VETO-PENDING.

Also here: `report_run_status` (line 442; locks run, enforces `check_transition`,
stamps started/finished, writes cursor/outputs/session ids/cost, then — after the
status write commits — calls `actions.apply_step_actions` in a try/except so an
action failure never breaks status ingestion, line 486), `mark_run_delivered`
(idempotent), owner-scoped `list_runs`/`get_run`, and trigger CRUD (schedule +
poll, `create_trigger`/`update_trigger` branch on `body.kind`/`existing.kind`,
line 768/880). **Local schedule *and* poll triggers are both rejected at create/update**
(`_validate_trigger_target_mode`, line 541 — same helper, `is_poll` picks the
error code: `schedule_local_unsupported` / `poll_local_unsupported`) — there's no
server→desktop claim protocol for either.

**Poll trigger validation** (PR B, same file): `_validate_poll_config` (line 622)
normalizes + checks the endpoint config — url must be `http(s)://`,
`interval_secs >= WORKFLOW_POLL_MIN_INTERVAL_SECONDS` (60s floor) — and encrypts
a supplied `auth_value` via `encrypt_text` (never stored plaintext; omitting it on
an update keeps the existing ciphertext, supplying an `auth_header` with no value
on *create* is rejected). There is **no authoring surface for the item schema or
an args mapping** (D17): `_validate_poll_static_inputs` coerces just the static
input presets strict via `coerce_arguments` (a bad preset fails at write), and
`derive_item_schema` (`domain/poll_contract.py`) projects the workflow's declared
inputs into the item JSON Schema — each input a typed property (choice → enum),
required unless a preset/default already covers it. `_probe_poll_signature` then
does the **init-time inputs-signature check** (contract §2.2, amending L33a): it
GETs the endpoint once and validates every returned item's `data` against the
derived schema, so a `poll_signature_mismatch` (or unreachable-endpoint
`poll_probe_failed`) is caught at trigger create/update, not at poll time.
`_create_poll_trigger`/`_update_poll_trigger` wire these into the
same `create_trigger`/`update_trigger` entry points schedule triggers use — one
CRUD surface, kind-branched. `list_trigger_items` (line 996) is the read side of
the per-trigger seen-set (owner-scoped, delegates to
`trigger_store.list_trigger_items`).

### 3.4 Delivery — [delivery.py](../server/proliferate/server/cloud/workflows/delivery.py) (cloud lane)

Synchronous in the StartRun request (house-consistent: cloud workspace ops already
wake the sandbox in-request). No outbox/Celery.

- `deliver_cloud_run` (line 78) — idempotent; wakes + auths via
  `ensure_cloud_sandbox_gateway_access`, POSTs `/v1/workflow-runs {plan, workspaceId}`
  (expects 202) → `mark_run_delivered`. Any error → `_record_delivery_failure`
  (line 65; `error_code='delivery_failed'`, status stays `pending_delivery` for retry).
- `refresh_cloud_run` (line 225) — the UI's cloud poll path (also called
  unattended by scheduler phase 3, §3.5 below). `read_workflow_run`
  (GET through gateway) → `_parse_sandbox_run_view` (line 139, camelCase) →
  `_sync_run_from_view` (line 169): a **lenient reconciling read** that applies the
  observed snapshot but **skips the strict transition guard**, yet refuses to
  overwrite a run the server already considers terminal. A 404 leaves the ledger
  untouched. After the write commits it also calls `actions.apply_step_actions`
  (line 216, try/except-isolated, PR A) — the poll-driven twin of the
  `report_run_status` hook, so an unattended cloud run without a live UI tab still
  gets its Slack actions performed via scheduler phase 3.

### 3.4a Per-run gateway grants, completion ping, two-layer scope (PR E)

New in PR E ([gateway_grants.py](../server/proliferate/server/cloud/workflows/gateway_grants.py),
[integration_gateway/domain/scope.py](../server/proliferate/server/cloud/integration_gateway/domain/scope.py)).
The design of record is architecture §6 + L16/L21–L26.

**Mint at StartRun, EVERY run (L16).** After the plan is resolved, `start_run`
resolves the run's NAMESPACE grant (E3) = the definition's top-level
`integrations[]`, stamped **per slot** into `scope_json`
(`{"<slot>": {"integrations": [...]}}` — §2.6; v1 stamps every slot with the same
workflow-level list). `resolve_run_scope` returns that per-slot dict;
`granted_namespaces` flattens it for the checks below. Composition inlines a
child's *steps*, not its grant (L24). **No `tools/list` fetch at mint — E3
introduces no new StartRun failure mode.** **L22 fail-fast** runs BEFORE the run
row is created: `assert_declared_providers_ready` checks each declared namespace
has a ready account for the owner via the same org-aware
`get_ready_account_for_provider` the gateway uses — a declared namespace with no
ready account fails the run (`workflow_function_provider_not_ready` 409), never a
silent narrowing. Save-time, `create_workflow`/`update_workflow` additionally
reject an `integrations` namespace the owner cannot even see
(`workflow_function_provider_unknown`, seed + org customs). Then the run row is
created, a per-run token is minted (`secrets.token_urlsafe`, hashed exactly like
the worker token under its own HMAC domain — `hash_workflow_run_gateway_token`),
and the plaintext is folded into `resolved_plan_json.gateway` (identical shape on
both lanes — L16 — the local runtime errors if it can't honor it, §5.3):

```python
resolved_plan["gateway"] = {
    "url": <same URL enroll composes>,          # {base}/v1/cloud/integration-gateway/mcp
    "authorization": "Bearer <per-run token>",  # plaintext; only the hash is stored
    "ping_url": "{base}/v1/cloud/workflows/runs/{run_id}/ping",
    "integrations": ["sentry", "linear"],       # flat namespace list, possibly empty
}
```

The runtime only reads `integrations`'s emptiness (L22 local-lane fail-fast); it
never inspects tools. The token row (`cloud_workflow_run_gateway_token`) stores only
the hash + the frozen per-slot `scope_json` (NOT NULL; an empty per-slot grant is
never conflated with a worker token's NULL "unscoped"), status
`active|expired|revoked`, `expires_at = now + 24h` (a backstop — terminal status
expires it first).

**Two-layer scope (L25), NAMESPACE granularity (E3).** Layer 1 = a worker-level
provider-namespace allowlist (nullable `scope_json` on
`cloud_integration_gateway_token`; NULL = unscoped/today's behavior, never
"empty"). Layer 2 = the per-run token's frozen namespace grant. **Mint-vs-delivery
intersection choice:** the delivering worker is not known at StartRun for cloud runs
(the scheduler/`deliver_cloud_run` waking the sandbox is where the worker becomes
known), so the token is minted at StartRun with the *definition* namespaces and the
L25 subset intersection is performed **at delivery** — `deliver_cloud_run` →
`_apply_delivery_scope_intersection` reads the owner's active worker allowlist
(`get_active_worker_gateway_scope_for_owner`), intersects the plan's
`gateway.integrations` (`scope.intersect_namespaces_with_worker`; NULL worker =
unscoped passthrough, empty = drops all), and re-freezes BOTH the plan's
`gateway.integrations` and the per-slot token `scope_json` before the plan ships.
Enforcement is asymmetric: mint/delivery decides what *may* be requested; **every
gateway request re-checks the CURRENT worker allowlist** so a worker scope narrowed
after mint bites on the next call.

**Gateway enforcement** ([dependencies.py](../server/proliferate/server/cloud/integration_gateway/dependencies.py),
[service.py](../server/proliferate/server/cloud/integration_gateway/service.py)):
`require_integration_gateway_grant` tries the run-token hash FIRST (its own HMAC
domain — no collision with worker tokens), falling back to the worker token
unchanged. It **flattens** the per-slot `scope_json` into the namespace-level
`run_scope` the pure layer consumes — one namespace-only entry per granted provider
(`{"provider": ns}`, no `tools` key), union across slots (`_flatten_run_scope`). A
run grant carries `{run_id, owner, org, run_scope}` plus the freshly re-resolved
`worker_scope`. **E3: a namespace-only scope entry matches EVERY tool of that
provider at call time** — `scope.authorize_tool_call`/`filter_tools_to_scope` treat
an entry with no `tools` key as all-tools, so `tools/list` returns every tool of a
granted namespace and `tools/call` allows any of them; a provider outside the run
scope is still denied (`integration_gateway_scope_denied`, surfaced through the MCP
error-result envelope, not a 500). Providers whose tools grow mid-run work without
re-mint. An explicit `tools` list on an entry (reserved for future per-slot
narrowing) still restricts; core-v1 never emits it. The scope check is a **pure
helper** in `integration_gateway/domain/scope.py`, callable outside the FastAPI
dependency, so the future server-side `function_call` performer (§6.6/L18/L23)
authorizes through the same code. **Org policy (addendum):** `ready_accounts_for_grant`
and `account_for_provider` pass the grant's `organization_id` to the store so a
provider the owner's org has disabled by policy is filtered out of both
`list_providers` and `call_tool` — the same overlay the L22 mint check applies.

**Completion ping (§3.7 / L16).** `POST /runs/{run_id}/ping` in
[api.py](../server/proliferate/server/cloud/workflows/api.py) has **no user-session
auth** — the per-run token IS its auth. It validates the bearer (active + unexpired
`cloud_workflow_run_gateway_token`), requires `token.workflow_run_id == run_id`
(else 403 — run A's token can't ping run B), and for cloud-lane runs triggers the
existing `refresh_cloud_run`/`_sync_run_from_view`; local-lane runs accept 202 and
no-op (the desktop relay owns local observation). The body carries nothing;
duplicate/stale/late pings are safe by construction (refresh is reconcile-shaped,
transitions monotonic) — no state is added. Terminal status is the choke point that
expires the token: `report_run_status` AND `_sync_run_from_view` both call
`expire_run_gateway_tokens_for_run` when the resulting status is terminal
(idempotent), so a late ping after terminal is a benign 401.

**Sandbox purpose (L26).** `cloud_sandbox` gains a stamped `purpose` enum
(`interactive` | `workflow-run`, NOT NULL server_default `interactive`), set once at
creation and never inferred later. Workflow cloud delivery threads
`purpose='workflow-run'` through `ensure_cloud_sandbox_gateway_access` →
`ensure_cloud_sandbox_ready` → `ensure_personal_cloud_sandbox`; because the personal
sandbox is shared and returned as-is when it already exists, an existing sandbox is
never restamped (first-create wins).

**First integrations (L21):** the issues service (`api_key` seed) and Slack —
`api_key`-style, no mid-run OAuth-refresh failure mode. OAuth-DCR providers are
deferred until the frozen per-run scope has a mid-run reauth story.

### 3.5 Scheduler — [scheduler.py](../server/proliferate/server/cloud/workflows/scheduler.py)

A second beat beside the automations scheduler, launched in
[automations/worker/main.py](../server/proliferate/server/automations/worker/main.py)
`_amain` via `asyncio.gather(run_scheduler_loop(...), run_workflow_scheduler_loop(...))`
(lines 50–57). `run_workflow_scheduler_tick` (line 283) runs, in order: Phase 1 →
the poll pass (PR B) → Phase 2 → Phase 3.

- **Phase 1 — fire due triggers.** `_fire_due_triggers` (line 184) →
  `_fire_one_trigger` (line 100): `claim_due_schedule_trigger` (`FOR UPDATE SKIP LOCKED`,
  [cloud_workflow_triggers.py:344](../server/proliferate/db/store/cloud_workflow_triggers.py#L344))
  → archived-workflow guard → concurrency (`skip` drops + records reason + advances
  cursor; `queue` always creates) → `start_run` wrapped in `db.begin_nested()` so a
  StartRun error rolls back just the run insert.
- **Poll pass (PR B)** — [poller.py](../server/proliferate/server/cloud/workflows/poller.py)
  `run_poll_pass` (line 290), called from the tick (line 296) right after Phase 1,
  before delivery, so a freshly-spawned poll run is eligible for delivery the same
  tick. Runs in the same gathered process (spec 4.1: "one worker to run and
  monitor"), exception-isolated from the tick like Phase 3 — one trigger blowing
  up never stalls firing or delivery. Per due trigger, `_poll_one_trigger` (line
  159), one transaction: `claim_due_poll_trigger` (`FOR UPDATE SKIP LOCKED`,
  [cloud_workflow_triggers.py:485](../server/proliferate/db/store/cloud_workflow_triggers.py#L485),
  due = `last_poll_at` null or `last_poll_at + poll_interval_secs <= now`) →
  `fetch_poll_page` (httpx GET, 10s timeout, decrypted auth header) — an HTTP/shape
  error records `last_poll_error`, advances `last_poll_at`, and **keeps the old
  cursor** (never advance past unread items) → per item: `insert_trigger_item`
  (line 535, `INSERT ... ON CONFLICT DO NOTHING` on the `(trigger_id, item_id)`
  PK — the seen-set CAS; a `False` return means a replay, skip it) →
  `validate_item_data` against the derived `poll_item_schema_json` (a missing
  required field or wrong type marks the item `invalid`, not `error` — the shape
  is the endpoint's fault, not the run's) → `overlay_item_inputs` (D17: static
  `args_json` presets overlaid by the item's own fields, **taken directly by
  name** — the declared input names are the derived schema's `properties` keys;
  undeclared `data` fields are ignored, no dot-path mapping) →
  `start_run(inputs=…)` under a **savepoint per item** (`db.begin_nested()`,
  Pablo amendment 2026-07-07 mirroring Phase 1's per-trigger savepoint): a
  `start_run` failure rolls back only this item's run insert, never the whole
  transaction — without it one raising item would roll back the cursor + seen-set
  together and re-wedge the feed every poll. `mark_item` (line 560) finalizes
  `spawned`/`invalid`/`error`; `persist_poll_cursor` (line 580) advances the
  opaque cursor **in the same transaction** as the item rows, so a crash anywhere
  mid-loop re-polls the old cursor and the seen-set PK absorbs the replay.
- **Phase 2 — deliver eligible cloud runs.** `_deliver_pending_runs` (line 227) →
  `_deliver_one_run` (line 204): delivers **only the FIFO-first non-terminal run per
  trigger** (`earliest_non_terminal_run_id_for_trigger`,
  [cloud_workflows.py:440](../server/proliferate/db/store/cloud_workflows.py#L440)) —
  one rule expresses both the immediate case and `queue` deferral. Gated on
  `WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS = {schedule, poll}` (widened PR B — a
  poll-spawned run carries `trigger_kind='poll'` and must ride this same phase, or
  it would never deliver; `store.list_pending_scheduled_cloud_runs` is widened the
  same way). Capped per tick (each wakes a sandbox).
- **Phase 3 — refresh in-flight + sweep actions** (line 246, PR A). Added so
  Slack actions still fire for a triggered cloud run with nobody watching the run
  view (the UI's own `/refresh` poll is what drives `apply_step_actions` the rest
  of the time). `_refresh_in_flight_runs` (line 251) →
  `store.list_in_flight_triggered_cloud_runs`
  ([cloud_workflows.py:565](../server/proliferate/db/store/cloud_workflows.py#L565);
  `delivered|running|waiting_approval`, target_mode=personal_cloud, trigger_id not
  null — schedule *and* poll both qualify) capped at
  `_MAX_REFRESHES_PER_TICK=10` and filtered to `delivered_before=tick_start` (skips
  a run this same tick just delivered — it needs time to execute before a refresh
  is useful) → `refresh_cloud_run` per run, which reconciles the ledger and calls
  `apply_step_actions`. `_sweep_actions` (line 275) → `actions.sweep_pending_actions`.
  Both sub-phases are exception-isolated from Phase 1/poll/2 and from each other
  (`run_workflow_scheduler_tick`, line 283–314) — an actions bug never stalls
  trigger firing, polling, or delivery.

`run_workflow_scheduler_loop` (line 317): exponential backoff (×2, cap 300s), Sentry
after 3 consecutive failures.

### 3.6 API — [api.py](../server/proliferate/server/cloud/workflows/api.py)

`router = APIRouter(prefix="/workflows")`, included by
[cloud/api.py](../server/proliferate/server/cloud/api.py) (`prefix="/cloud"`) which
`main.py` mounts at `{api_prefix}/v1` → base **`/v1/cloud/workflows`**. Literal
`/runs*` routes declared before `/{workflow_id}`. Every route is
`Depends(current_product_user)` + owner-scoped. Models in
[models.py](../server/proliferate/server/cloud/workflows/models.py).

| method | path | notes |
|---|---|---|
| GET | `/workflows?includeArchived` | list |
| POST | `/workflows` | create (enforces free-plan cap) |
| GET | `/workflows/runs?workflowId` | run list |
| GET | `/workflows/runs/{run_id}` | run detail — `WorkflowRunDetailResponse{run, stepActions[]}` (PR A; `step_actions` from `store.list_actions_for_run`) |
| POST | `/workflows/runs/{run_id}/delivered` | marks delivery done. **D18 (E7):** auth is EITHER the per-run gateway token (anyharness) OR a user session (desktop local-lane relay); a valid token for another run → 403, no credential → 401 |
| POST | `/workflows/runs/{run_id}/status` | reports observed state; also triggers `apply_step_actions`. **D18 (E7):** same dual auth as `/delivered` — the run token proves the writer IS the runtime (closes the spoofing hole where any logged-in owner could move the run), user session stays for the local relay |
| POST | `/workflows/runs/{run_id}/deliver` | **cloud** lane retry of stuck `pending_delivery` |
| GET | `/workflows/runs/{run_id}/refresh` | **cloud** lane pull; syncs ledger; also triggers `apply_step_actions` |
| POST | `/workflows/runs/{run_id}/ping` | PR E (§3.4a) — completion ping; **no user session**, auth is the per-run gateway token; token↔run_id must match (else 403); cloud lane triggers `refresh_cloud_run`, local lane 202-no-ops; always 202 on valid token |
| GET | `/workflows/slack/channels` | PR A — `{channels:[{id,name}], connected}`; `connected:false` + empty list when the actor has no ready Slack account ([integrations accounts store](../server/proliferate/db/store/integrations/accounts.py)) |
| GET/PATCH/DELETE | `/workflows/{workflow_id}` | detail / update (append version) / archive |
| POST | `/workflows/{workflow_id}/runs` | **StartRun**; personal_cloud also calls `deliver_cloud_run` in-request |
| GET/POST · GET/PATCH/DELETE | `/workflows/{workflow_id}/triggers[/{trigger_id}]` | trigger CRUD — `kind:"schedule"\|"poll"`; **D16 (PR G):** the body pins `repoFullName` ("org/repo", authored; `targetWorkspaceId` is gone) and the server derives + returns `targetWorkspaceId`; `args` are the schedule presets and reads return `repoFullName`, `inputPresets`; a `poll` body carries `poll:{url, authHeader?, authValue?(write-only), intervalSecs}` (no item-schema/args-mapping authoring — D17), reads return `poll:{..., hasAuth, itemSchema(derived, read-only), lastPollAt, lastPollError}` (never the secret) |
| GET | `/workflows/{workflow_id}/triggers/{trigger_id}/items` | PR B — a poll trigger's seen-set, paginated (`limit`/`offset`), newest first: `{items:[{itemId, runId, status, errorMessage, receivedAt}]}` |

**No server-side cancel/pause endpoint** — cancel is a runtime concern
([§4.5](#45-local-http-surface), `POST /v1/workflow-runs/{id}/cancel`).

---

## 4. Runtime layer (anyharness)

Two layers: **`domains/workflows`** (durable truth + pure step-decision logic) and
**`live/workflows`** (one actor per run driving real sessions/goals/shells/PRs). The
domain owns no live state; the executor is the only seam to live execution — which
keeps the cursor + on-fail matrix unit-testable.

File tree — [crates/anyharness-lib/src/](../anyharness/crates/anyharness-lib/src/):

```
domains/workflows/
├── mod.rs              # module wiring
├── plan.rs             # strict typed deserialization of the resolved plan
├── model.rs            # WorkflowRunRecord / WorkflowStepRunRecord + status maps
├── engine.rs           # StepOutcome/StepDecision + pure decide_after_step + executor trait
├── service.rs          # WorkflowService: create_run_idempotent, run_next_step, apply_decision
├── store.rs            # SQLite CRUD
├── templates.rs        # late-bind {{steps[N].output…}} + unescape \{ \}
└── service_tests.rs    # engine/service unit tests
live/workflows/
├── mod.rs              # exports WorkflowRunManager, WorkflowExecDeps, WorkflowOwnedSessions, advisor
├── manager.rs          # actor lifecycle: deliver, spawn_actor, cancel, resolve_approval, startup pass
├── actor.rs            # drive_run loop
├── executor.rs         # WorkflowStepExecutorImpl: per-kind execute_step, ensure_session, run_goal…
├── commands.rs         # deterministic side effects: shell, open_pr, notify, verify
└── exec_policy.rs      # always-bypass: bypass_mode_for_kind + WorkflowAutoApproveAdvisor
api/http/workflow_runs.rs   # local HTTP surface (routes wired in api/router.rs:431)
persistence/sql/0053_workflow_runs.sql   # SQLite migration
```
Contract types: [anyharness-contract/src/v1/workflows.rs](../anyharness/crates/anyharness-contract/src/v1/workflows.rs)
(`WorkflowRunView` line 58, `WorkflowStepRunView` line 36, `CreateWorkflowRunRequest`
line 112, `ResolveWorkflowApprovalRequest` line 121).

### 4.1 Plan types — [plan.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/plan.rs)

The actor never re-fetches; it deserializes the plan strictly. `StepKind` is an
**internally-tagged (`tag="kind"`) enum** — an unknown step kind is a hard
deserialize error.

```rust
#[serde(tag = "kind")]
pub enum StepKind {   // format v2 — human.approval removed (E1), agent.emit + branch added
    #[serde(rename = "agent.config")]  AgentConfig(AgentConfigStep),
    #[serde(rename = "agent.prompt")]  AgentPrompt(AgentPromptStep),
    #[serde(rename = "agent.emit")]    AgentEmit(AgentEmitStep),
    #[serde(rename = "shell.run")]     ShellRun(ShellRunStep),
    #[serde(rename = "scm.open_pr")]   ScmOpenPr(ScmOpenPrStep),
    #[serde(rename = "notify")]        Notify(NotifyStep),      // {slack_channel_id, message}
    #[serde(rename = "branch")]        Branch(BranchStep),      // {on, cases:{v:{to}}, reason?}
}

// PlanStep carries key/slot/label; there is no single `setup` — the executor is
// slot-keyed (B7), reading sessions:{slot -> SessionSpec{harness, model?,
// session_binding, bind_session_id?}} directly.
pub struct PlanStep { pub key: String, pub slot: String, pub label: String, pub on_fail: OnFail, /* flatten */ kind }
pub struct AgentPromptStep { pub prompt: String, pub goal: Option<GoalSpec>, pub required_invocation: Option<RequiredInvocation> }
pub struct AgentEmitStep { pub prompt: String, pub max_attempts: u32 /*default 3*/, pub output_schema: Option<Value> }
pub struct AgentConfigStep { pub model: Option<String> }  // model-only (A3); harness fixed per slot
pub enum BranchTarget { Continue, End }
pub enum SessionBinding { Fresh, Headless }
```
<sub>[plan.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/plan.rs)</sub>

The runtime **executor** implements every v2 kind: `agent.emit` runs the
file-drop re-ask loop (C12, `max_attempts` from the plan), `branch` matches the
resolved `on` value against `cases` and routes continue/end (C11/E5), `notify` is
Slack-only.

`PlanStep { key, slot, label, on_fail: OnFail, #[serde(flatten)] kind: StepKind }`;
`OnFail { kind: OnFailKind(Stop|Retry|Continue), n: u32 }`; `ResolvedPlan { run_id,
…, sessions: BTreeMap<String, SessionSpec>, inputs, steps: Vec<PlanStep> }`.

`NotifyStep` (line 183, PR A) gained `#[serde(default)] pub slack_channel_id:
Option<String>` — old plans without the field still deserialize (defaults to
`None`); [templates.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/templates.rs)
`resolve_step` (line 140) carries it through late-binding untouched (it's never a
template target).

### 4.2 Engine — pure on-fail decision ([engine.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/engine.rs))

`StepOutcome` (line 50) from the executor: `Completed{output}`, `Failed{code,message?,output?}`,
`AwaitApproval{descriptor}`. `decide_after_step(on_fail, attempt, outcome) ->
StepDecision` (line 107):

| outcome | on_fail | decision |
|---|---|---|
| Completed | any | `Complete{output}` |
| AwaitApproval | any | `Suspend{descriptor}` |
| Failed | Stop | `FailRun` |
| Failed | Continue | `Continue` (mark step failed, advance) |
| Failed | Retry, `attempt ≤ n` | `Retry` (re-run, cursor unchanged) |
| Failed | Retry, `attempt > n` | `FailRun` |

`EngineProgress` (line 96) = `Advanced | SuspendedForApproval | Finished(status)`.
`WorkflowStepExecutor` (async trait, line 146) is the seam the live layer implements
and tests fake.

### 4.3 Service — cursor movement ([service.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/service.rs))

- `create_run_idempotent` (line 99) — re-delivery of a known `run_id` returns the
  record untouched (`created=false`); else inserts the run + one pending step-run per
  step, status Running, cursor 0.
- `run_next_step` (line 200) — terminal/cancel short-circuit → parse plan → `step(cursor)`
  → `build_outputs` (line 490; includes failed-but-continued steps) → detect
  `resumed_after_approval` (cursor step currently `Waiting`) → `templates::resolve_step`
  (late-bind) → `begin_step` → `executor.execute_step` → `decide_after_step` →
  `apply_decision`.
- `apply_decision` (line 338) — where the cursor moves: `Complete`/`Continue` →
  advance (Completed at end); `FailRun` → run Failed; `Retry` → step back to Pending
  (cursor unchanged); `Suspend` → step `Waiting`, output = descriptor, run `WaitingApproval`;
  `EndRun` (branch `end`, C11/E5) → step Completed with taken-case output, cursor
  jumps to the end, run `Completed`, and `skip_tail` marks every later still-pending
  step `Skipped`.
- `resolve_pending_approval` (line 249) — approve/deny/timeout. For a goal step parked
  on a block, **approve → `Retry`** (re-arm + continue waiting).
- `record_step_goal_progress` (line 173) — live goal upsert; writes onto a **RUNNING**
  step's `output_json` only (a terminal write is never clobbered by a late snapshot).
- `set_session_for_slot` (B7) — records `slot -> session_id` into the slot-keyed
  `session_ids` map (replaces the old append-once ordered `append_session_id`).

Late-binding: [templates.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/templates.rs)
resolves `{{steps[N].output.KEY.path}}` against completed outputs and unescapes
`\{`/`\}` in a single scan; an unresolved placeholder is left **verbatim** (never
silently emptied) — the runtime half of the injection guard.

### 4.4 Live — actor, manager, executor

**Manager** ([manager.rs](../anyharness/crates/anyharness-lib/src/live/workflows/manager.rs)) —
`WorkflowRunManager` is cheaply cloneable, stored in `AppState.workflow_manager`
([app/mod.rs:140](../anyharness/crates/anyharness-lib/src/app/mod.rs#L140), constructed
:341, `spawn_startup_pass` at boot :445).

- `deliver` (line 74) — verify workspace → `create_run_idempotent` → if Running and no
  live actor, `spawn_actor`.
- `spawn_actor` (line 205) — insert a `CancelToken` (guarded against double spawn),
  `tokio::spawn`: load run, parse plan (bad plan ⇒ `mark_run_terminal(Failed, bad_plan)`),
  build executor, `hydrate_from_run`, `drive_run` (loop while `Advanced`), on
  `SuspendedForApproval` arm the approval-timeout timer.
- `cancel` (line 105) — signal the live token, best-effort cancel every slot
  session's in-flight turn, directly `mark_run_terminal(Cancelled)` when no actor is driving.
- `resolve_approval` (line 144) → `resolve_pending_approval`; if it advanced, `spawn_actor`.
- `spawn_startup_pass` (line 176) — crash-resume: loads non-terminal runs; `Running` ⇒
  respawn at the persisted cursor (re-enter, attempt bumped — idempotency is per-kind);
  `WaitingApproval` ⇒ left parked, timeout timer re-armed.

**Executor** ([executor.rs](../anyharness/crates/anyharness-lib/src/live/workflows/executor.rs)),
one per run. Slot-keyed (B7): holds `current: HashMap<slot, CurrentSession>` (one
session per agent slot for the run's lifetime) and `models: HashMap<slot,
Option<String>>` (effective model per slot). `WorkflowExecDeps` bundles
session_runtime, goal_runtime, session_service, workspace_runtime,
workflow_service, acp_manager, workflow_owned_sessions.

- `hydrate_from_run` / `recompute_models` — resume: restore each slot's bound
  session from the persisted slot map + fold per-slot `agent.config` models.
- `ensure_session(slot)` — reuse the slot's session or create it in bypass mode
  (harness from `sessions[slot]`, fixed per slot — no harness match/switch), mark
  workflow-owned *before* the first prompt, persist via `set_session_for_slot`. A
  slot carrying `bind_session_id` (L29 / PR F, always absent today) loads an
  existing session instead of creating one.
- `subscribe` (line 214) — the **await substrate**: `broadcast::Receiver<SessionEventEnvelope>`;
  every wait subscribes *before* prompting.

**Per-kind semantics** (`execute_step` dispatch):

| kind | method | summary |
|---|---|---|
| `agent.config` | `run_agent_config(slot,…)` | instant; model-only (A3); folds model onto the slot + live model-set (see [§1c](#1c-agentconfig--per-slot-model-change-model-only-a3)) |
| `agent.prompt` (no goal) | `run_prompt(slot,…)` | ensure_session(slot) → subscribe → send_prompt → `await_turn_ended`; with `required_invocation` runs the C14 gate loop (MAX_GATE_ATTEMPTS=3, `invocation_missing` on exhaustion) |
| `agent.prompt` (goal) | `run_goal(slot,…)` | arm → await → verify → terminal (see [§1b](#1b-step-execution-for-agentprompt--goal-arm--await--verify--terminal)) |
| `shell.run` | [commands.rs](../anyharness/crates/anyharness-lib/src/live/workflows/commands.rs) `run_shell_step` | `/bin/sh -lc` in workspace, scrubbed env, 8 KiB tail, default 600s |
| `scm.open_pr` | `open_pr_step` | `git push` + `gh pr create`; missing gh → `scm_unavailable` |
| `agent.emit` | `run_emit(slot,…)` | file-drop re-ask loop (C12): prompt → await turn → read `<ws>/.proliferate/emit-<run>-<step>.json` → jsonschema-validate (optional schema) → corrective re-prompt up to plan `max_attempts` → `emit_invalid` on exhaustion; validated object = whole step output |
| `notify` | [commands.rs](../anyharness/crates/anyharness-lib/src/live/workflows/commands.rs) `notify_step` | Slack-only (E1b); never a hard failure; the runtime emits `{channel:"slack", message, slack_channel_id}`, the server-side effect claims from it |
| `branch` | `run_branch` | match the resolved `on` value against `cases`: `continue` → `Completed` (advance); `end` → `EndRun` (run `completed`, later steps `skipped`, E5); unmatched → `branch_unmatched` (on_fail applies) |
| ~~`human.approval`~~ | removed (E1) | step kind deleted; the `waiting_approval` status survives via `goal.on_blocked` |

**output_json vocabulary per kind** (consumed by the run view + `{{steps[N].output}}`):

| kind | output keys |
|---|---|
| agent.config | `model?`, `slot` |
| agent.prompt (turn) | `turn_id`, `session_id`, `required_invocation?` |
| agent.emit | the validated JSON object verbatim |
| branch | `value`, `target` (`continue`\|`end`) |
| agent.prompt (goal) | `session_id`, `met_reason?`, `verified?`, `verify_attempts?`; while running `{goal:{objective,status,iterations,tokens_used}, session_id}` |
| shell.run | `output_tail`, `exit_code`, `output_name?` |
| scm.open_pr | `pr_url` |
| notify | `channel:"slack"`, `message`, `slack_channel_id` — what the server's step-actions observer keys off (claim key is `(run_id, step_key, action_kind)`) |
| goal block (await) | `{kind:"goal_block", session_id, message}` |

**Live goal-progress snapshots.** `run_goal`'s `on_progress` closure fires on every
`GoalUpdated`, builds a `GoalSnapshot`, and — only when status/iterations/tokens
changed — calls `record_step_goal_progress`. The upsert is a no-op unless the step is
RUNNING, so the timeline renders honest counters without clobbering a terminal write.

**Resume matrix (idempotent step re-entry).** On respawn the cursor step re-executes
with `attempt+1`: `agent.prompt` re-sends a NEW turn; `+goal` re-arms and continues
waiting; `shell.run`/`scm.open_pr` re-execute; `agent.config` re-folds (idempotent);
a `Waiting` step stays parked; any completed step advanced the cursor atomically and
is never re-run.

**Exec policy — always bypass** ([exec_policy.rs](../anyharness/crates/anyharness-lib/src/live/workflows/exec_policy.rs)):
1. **Primary — native bypass mode.** `bypass_mode_for_kind` (line 62): `claude →
   "bypassPermissions"`, `codex → "full-access"`, else `None`. Persisted on the
   session row (survives crash-resume). Goal-capable harnesses emit no permission
   requests, so agent turns AND native-goal auto-continuation never block.
2. **Fallback — auto-approve advisor.** `WorkflowOwnedSessions` (line 79) is the
   in-memory grow-only set of executor-opened session ids. `WorkflowAutoApproveAdvisor`
   (line 103, wired in [app/sessions.rs:51](../anyharness/crates/anyharness-lib/src/app/sessions.rs#L51))
   returns `PermissionAdvice::Predecided` (auto-approve) for a workflow-owned session
   **without emitting an interaction event** (a synthetic `InteractionRequested` would
   make session replay re-park on a historical auto-approval forever).

### 4.5 Local HTTP surface

[api/http/workflow_runs.rs](../anyharness/crates/anyharness-lib/src/api/http/workflow_runs.rs),
routes wired in [api/router.rs:431-444](../anyharness/crates/anyharness-lib/src/api/router.rs#L431):

| method | path | notes |
|---|---|---|
| GET | `/v1/workflow-runs?workspace_id` | summaries; a direct-attach `UserClaim` token is scoped to its own workspace |
| POST | `/v1/workflow-runs` | 202 `WorkflowRunView`; idempotent on `plan.run_id` |
| GET | `/v1/workflow-runs/{run_id}` | full view |
| POST | `/v1/workflow-runs/{run_id}/cancel` | cancel |
| POST | `/v1/workflow-runs/{run_id}/approval` | `{approve}` |

`assert_workspace_auth_scope` gates every route on the run's workspace. Contract
`WorkflowRunView` is camelCase: `{runId, …, workspaceId, status, stepCursor,
sessionIds[], steps:[WorkflowStepRunView{stepIndex, kind, status, attempt, output?}]}`.

---

## 5. Goals substrate it depends on

The `agent.prompt`+goal step arms the *same* Goal object via the *same* `GoalRuntime`
as the pre-existing goals stack. Pointers (see the goals domain +
[harness-runtime-mechanics.md](harness-runtime-mechanics.md)):

**Contract `Goal`** ([anyharness-contract/src/v1/goals.rs:42](../anyharness/crates/anyharness-contract/src/v1/goals.rs#L42)),
fields the workflow layer couples to:

```rust
pub struct Goal {
    pub objective: String,
    pub status: GoalStatus,          // Active|Paused|Blocked|Met|Failed|Cleared (terminal: Met/Failed/Cleared)
    pub token_budget: Option<i64>,
    pub max_turns: Option<u32>,      // runtime-enforced; NEVER forwarded to the sidecar
    pub max_wall_secs: Option<u64>,  // runtime-enforced; NEVER forwarded to the sidecar
    pub tokens_used: Option<i64>,
    pub met_reason: Option<String>,
    pub failed_reason: Option<String>,  // max_turns_exhausted | max_wall_secs_exhausted (native failures leave absent)
    pub iterations: Option<i64>,
    pub source_kind: GoalSourceKind, // user|workflow|agent (default user)
    pub source_run_id: Option<String>,  // the arming workflow run when source_kind=workflow
    …
}
```
<sub>[goals.rs:42-78](../anyharness/crates/anyharness-contract/src/v1/goals.rs#L42)</sub>

- **Arming struct** `SetSessionGoalRequest` (line ~95) — exactly what
  `executor::arm_goal` ([executor.rs:368](../anyharness/crates/anyharness-lib/src/live/workflows/executor.rs#L368))
  constructs; the **only** place stamping `GoalSourceKind::Workflow` + `source_run_id`.
- **GoalRuntime seams** ([domains/goals/runtime.rs](../anyharness/crates/anyharness-lib/src/domains/goals/runtime.rs)):
  `set_goal` (sends only objective/status/tokenBudget over the wire, then `stamp_arming`
  writes caps+provenance locally after the native echo; `GOAL_CONFIRMATION_TIMEOUT`=15s),
  `clear_goal`. Terminal detection is **not** a poll — the executor subscribes to the
  session's `SessionEvent::{GoalMet, GoalUpdated, GoalCleared, SessionEnded}` broadcast.
- **Guard extension** ([domains/goals/hooks.rs](../anyharness/crates/anyharness-lib/src/domains/goals/hooks.rs)
  `GoalGuardExtension`) — on `on_turn_finished`, counts the turn and on a cap breach
  fails the mirror first (typed reason) then fires a native clear. This is the
  server-of-record for cap enforcement; the executor's wall-clock deadline is a
  backstop for a hung in-flight turn the guard can't see.

---

## 6. Desktop / UI layer

### 6.1 Routes + component tree

Routes in [AuthenticatedAppHost.tsx:63-66](../apps/desktop/src/pages/AuthenticatedAppHost.tsx#L63)
(playground DEV-only in [App.tsx](../apps/desktop/src/App.tsx)):

| path | page → screen |
|---|---|
| `workflows` | [WorkflowsHomePage](../apps/desktop/src/pages/WorkflowsHomePage.tsx) → [WorkflowsHomeScreen](../apps/desktop/src/components/workflows/screen/WorkflowsHomeScreen.tsx) |
| `workflows/:workflowId[/edit]` | [WorkflowEditorPage](../apps/desktop/src/pages/WorkflowEditorPage.tsx) → [WorkflowEditorScreen](../apps/desktop/src/components/workflows/screen/WorkflowEditorScreen.tsx) |
| `workflows/:workflowId/runs/:runId` | [WorkflowRunPage](../apps/desktop/src/pages/WorkflowRunPage.tsx) → [WorkflowRunScreen](../apps/desktop/src/components/workflows/screen/WorkflowRunScreen.tsx) → [WorkflowRunView](../apps/desktop/src/components/workflows/run/WorkflowRunView.tsx) |
| `/playground/workflows` (DEV) | [WorkflowsPlaygroundPage](../apps/desktop/src/pages/WorkflowsPlaygroundPage.tsx) → [WorkflowsPlayground](../apps/desktop/src/components/playground/workflows/WorkflowsPlayground.tsx) |

(There is an unrelated [pages/WorkflowsPage.tsx](../apps/desktop/src/pages/WorkflowsPage.tsx) — not one of the four.)

Desktop component tree — [components/workflows/](../apps/desktop/src/components/workflows/):

```
components/workflows/
├── screen/
│   ├── WorkflowsHomeScreen.tsx    # two tabs (Workflows | Runs); create gate; run modal
│   ├── WorkflowEditorScreen.tsx   # two-pane editor; draft state; validate; serialize→PATCH
│   └── WorkflowRunScreen.tsx      # run detail host (useWorkflowRun 2.5s poll)
├── home/
│   ├── WorkflowCard.tsx           # glyph strip, trigger pills, last-run dot, Run button
│   ├── WorkflowCardContainer.tsx  # fetches detail, parses currentVersion.definition
│   ├── WorkflowRunArgsModal.tsx   # per-arg form + local/cloud target + workspace picker
│   ├── WorkflowRunsTable.tsx      # Runs tab
│   └── WorkflowTemplatesGallery.tsx  # empty-state starters
├── editor/
│   ├── WorkflowStepRailCard.tsx   # center rail card (drag reorder, add/dup/delete)
│   ├── WorkflowStepPanel.tsx      # right per-kind editor
│   ├── WorkflowGoalAttachment.tsx # "◎ Iterate until" — only if harnessSupportsGoals
│   ├── WorkflowSetupCard.tsx / WorkflowMetaCard.tsx / WorkflowTriggersCard.tsx
│   ├── WorkflowStepConnector.tsx / WorkflowSelect.tsx / TemplateVarTextarea.tsx
│   └── (AgentConfigEditor lives within the panel — two "Keep current" selects)
└── run/
    └── WorkflowRunView.tsx        # renders deriveStepRunViews timeline; approve/deny (local only)
```

- **Goals are an attachment on `agent.prompt`, not a step kind** —
  [WorkflowGoalAttachment.tsx](../apps/desktop/src/components/workflows/editor/WorkflowGoalAttachment.tsx)
  renders only when `harnessSupportsGoals` ([goal-capability.ts](../apps/desktop/src/lib/domain/workflows/goal-capability.ts)).
- **Run view**: `approvalEnabled = isLocalRun` — cloud approvals aren't wired in v1.

### 6.2 Hooks + access layer

- [lib/access/cloud/workflows.ts](../apps/desktop/src/lib/access/cloud/workflows.ts) —
  typed wrappers over the generated OpenAPI client, one fn per §3.6 endpoint.
- [lib/access/anyharness/workflow-runs.ts](../apps/desktop/src/lib/access/anyharness/workflow-runs.ts) —
  **separate** local-runtime module using plain `fetch` against `/v1/workflow-runs`
  (`createLocalWorkflowRun`, `getLocalWorkflowRun`, `resolveLocalWorkflowApproval`).

[hooks/access/cloud/workflows/](../apps/desktop/src/hooks/access/cloud/workflows/):

```
hooks/access/cloud/workflows/
├── query-keys.ts             # factory rooted at ["cloud","workflows"]
├── types.ts
├── use-workflows.ts          # useWorkflows, useWorkflowDetail, useWorkflowRuns, useWorkflowRun (2.5s poll)
├── use-workflow-mutations.ts # create/update/archive
├── use-launch-workflow-run.ts# both lanes: startWorkflowRun; local + createLocalWorkflowRun→markDelivered→relay.register
├── use-workflow-triggers.ts
├── use-workflow-approval.ts  # hits the LOCAL runtime
├── use-cloud-run-refresh.ts  # useCloudRunRefreshPoll (3s /refresh; writes into run-detail cache)
└── use-local-workflow-relay.ts  # the relay driver (see §6.4)
```

### 6.3 Product-domain (shared, camelCase-in-memory)

[apps/packages/product-domain/src/workflows/](../apps/packages/product-domain/src/workflows/):

```
product-domain/src/workflows/
├── definition.ts     # WorkflowDefinition model + parse/serialize (wire snake_case ↔ camelCase)
├── run-status.ts     # deriveStepRunViews, goalLineFor, sessionLinkFor
├── model.ts          # run-row view model + free-plan policy
├── presentation.ts   # glyphs (◇ ⚙ $ ⇈ 🔔 ⏸, goal ◎), buildWorkflowCardView
├── templates.ts      # 5 starters, each leading with an agent.config step
├── interpolation.ts  # mirrors server grammar + editor autocomplete
├── validation.ts     # reproduces server strict checks for live feedback
└── workflows.test.ts # serializer/validation/run-status vitest suite
```

**TS `WorkflowDefinition`** ([definition.ts:166](../apps/packages/product-domain/src/workflows/definition.ts#L166)):

Format v2 (PR A) — the model mirrors the server spine. Refs use `{{inputs.*}}`
+ `{{emit.field}}`; the three grammar/kind files (definition.ts, validation.ts,
interpolation.ts) are cut to v2. **Follow-up:** the desktop editor components and
the sibling product-domain modules (model.ts, presentation.ts, effective-config.ts,
templates.ts, workflows.test.ts) still reference the v1 shape and are migrated in
the editor phase — the built dist does not compile until then.

```ts
export interface WorkflowDefinition {
  version: 1; name?: string; description?: string;
  inputs: WorkflowInputSpec[]; integrations: string[]; agents: WorkflowAgentNode[];
}
export interface WorkflowAgentNode { slot: string; harness: string; model: string; steps: WorkflowStep[] }
export interface AgentEmitStep extends StepBase { kind: "agent.emit"; prompt: string; name: string; outputSchema?; maxAttempts? }
export interface NotifyStep extends StepBase { kind: "notify"; slackChannelId: string; message: string }
export interface BranchStep extends StepBase { kind: "branch"; on: string; cases: Record<string,{to:"continue"|"end"}>; reason? }
export type WorkflowStep =
  | AgentPromptStep | AgentEmitStep | AgentConfigStep | ShellRunStep | ScmOpenPrStep | NotifyStep | BranchStep;
```
<sub>[definition.ts](../apps/packages/product-domain/src/workflows/definition.ts)</sub>

`parseWorkflowDefinition` is lenient (never throws, drops malformed steps — the
server validated on write); `serializeWorkflowDefinition` is its snake_case inverse.
Field mappings that differ: `maxTurns↔max_turns`, `maxWallSecs↔max_wall_secs`,
`onBlocked↔on_blocked`, `tokenBudget↔token_budget`, `verify.expectExit↔expect_exit`,
`onFail↔on_fail`, `timeoutSecs↔timeout_secs`, `outputName↔output_name`,
`onTimeout↔on_timeout`, `sessionBinding↔session_binding`.

**`deriveStepRunViews`** ([run-status.ts:326](../apps/packages/product-domain/src/workflows/run-status.ts#L326)):
`cursor = stepCursor ?? (completed ? steps.length : 0)`; `index<cursor`→completed;
`index>cursor`→skipped/cancelled/pending; `index===cursor` maps run status directly —
with the twist that a `running` run at a goal-armed prompt shows **`goal_iterating`**
(client-only status, [line 304](../apps/packages/product-domain/src/workflows/run-status.ts#L304)).
`goalLineFor` (line 230) reads `output.goal`; `sessionLinkFor` (line 243) reads
`output.session_id` for the "Open session" deep link.

### 6.4 Product-ui + local-lane relay

Shared presentational pieces — [apps/packages/product-ui/src/workflows/](../apps/packages/product-ui/src/workflows/):
[WorkflowRunTimelineRow](../apps/packages/product-ui/src/workflows/WorkflowRunTimelineRow.tsx),
[WorkflowStepCard](../apps/packages/product-ui/src/workflows/WorkflowStepCard.tsx),
[WorkflowStepGlyphStrip](../apps/packages/product-ui/src/workflows/WorkflowStepGlyphStrip.tsx),
[WorkflowStatusPill](../apps/packages/product-ui/src/workflows/WorkflowStatusPill.tsx),
[WorkflowStepRunDot](../apps/packages/product-ui/src/workflows/WorkflowStepRunDot.tsx),
[WorkflowStepKindBadge](../apps/packages/product-ui/src/workflows/WorkflowStepKindBadge.tsx).

**Local-lane relay** — three pieces + a provider:

```
lib/domain/workflows/relay.ts             # pure diff: planRelayReports(prev, view)
stores/workflows/workflow-relay-store.ts  # zustand registry (register/unregister/reportedRunning)
hooks/access/cloud/workflows/use-local-workflow-relay.ts  # 2s poll driver
providers/WorkflowRelayProvider.tsx       # mounted once in AppProviders (renders null)
```

- **Lifecycle — app-open-only** (known v1 gap): a run enters the registry at launch
  (`useLaunchWorkflowRun.register`) or via a one-shot re-attach on mount (server runs
  with `targetMode==="local"`, status in `{delivered,running,waiting_approval}`,
  non-null `anyharnessWorkspaceId`; seeds `reportedRunning`).
- **Poll loop** — every `RELAY_POLL_INTERVAL_MS=2000`: `getLocalWorkflowRun` →
  [planRelayReports](../apps/desktop/src/lib/domain/workflows/relay.ts) →
  `reportWorkflowRunStatus` in order → invalidate run-detail/run-list caches.
- **Diff rules** respect the transition table: always emit `running` first when
  `!reportedRunning` (so the server walks `delivered→running` before any terminal);
  otherwise emit only when signature `${status}:${cursor}:${JSON(outputs)}` changed.
- **The relay never feeds the UI directly** — the server ledger is the single source
  of truth. Local runs: `useWorkflowRun` polls the server at 2.5s. Cloud runs:
  `useCloudRunRefreshPoll` additionally polls `/refresh` at 3s.

Web ([apps/web/src/pages/WorkflowsPage.tsx](../apps/web/src/pages/WorkflowsPage.tsx))
routes `/workflows` to the **automations** screen — the web app has no workflow
editor/run UI of its own (drift note #7).

---

## 7. Design decisions + rationale

- **Whole-payload delivery.** `StartRun` is the only resolution point; the actor
  never fetches a definition. The run id is the idempotency key so a re-delivery
  after a network blip is safe. (`service._resolve_plan`, `manager.deliver`,
  `create_run_idempotent`.)
- **No "Run as" in v1.** Every run executes as the owner; `executor_user_id` exists
  for later team/service-account executors — no picker, no dead weight.
- **Always-bypass, no modes.** Goal turns verifiably stall on permission prompts;
  workflows must be unattended-safe by construction. `human.approval` is the explicit
  human-in-the-loop. (`exec_policy.rs`.)
- **Schedule *and* poll are cloud-only.** Both need a server→desktop claim protocol
  that doesn't exist; poll inherits the restriction for the same reason (PR B).
  (`service._validate_trigger_target_mode`.)
- **Zero-step drafts.** `require_steps=False` on save, `True` on StartRun.
- **`agent.config` as a step (not Setup-only).** Model changes are ordered events
  folded onto the step's slot (model-only, A3). Multi-agent chaining (Claude fixes →
  Codex reviews) is expressed as distinct *slots* — each slot owns its own session;
  there is no harness-switch. (`plan.rs::AgentConfigStep`, `run_agent_config`.)
- **Hidden run sessions.** Workflow-run sessions don't appear in the normal session
  list; their home is the run view's "Open session" deep link.
- **Notify in-app floor.** `notify` is never a hard failure. Slack delivery (PR A)
  is a server-side action claimed off the observed output, not a runtime concern —
  the runtime's job stops at emitting `{channel:"slack", message, slack_channel_id}`;
  the send itself, retries, and idempotency live in the step-actions ledger
  ([§2a](#2a-postgres-control-plane), [§3](#3-server-layer-control-plane)).

---

## 7.6 Session plane (PR F — binding · provenance · lockout · take-over)

The session plane is the one coherent PR that makes a workflow's sessions
first-class: how a run adopts an existing session, how machine-injected turns are
distinguished from human ones, how a driven session is protected from stray user
edits, and how a human takes it back. B8 + C10 + C13 + D15, plus the 2026-07-09
addendum (gateway rebind, bypass-registry unmark, keep-alive-on-terminal).

**B8 session binding (L29).** `StartRun` accepts
`session_bindings: {<slot>: session_id}` (server `StartRunRequest.session_bindings`,
`models.py`). The server validates each bound slot names a real agent slot
(`service.start_run`); the resolver sets `sessions[slot].bind_session_id`
(`_resolve_plan`). At runtime, `WorkflowStepExecutorImpl::ensure_session`'s bind
branch (`executor.rs`) LOADS the existing session instead of
`create_durable_session`, and **hard-errors `plan_malformed` if the session's
harness doesn't match the slot** (never a silent wrong-harness launch). The bound
session then appears in the run's slot→session map like any fresh session.

**C10 provenance (E9 — stamp at write time).** The executor injects prompts through
the internal provenance-carrying path
(`SessionRuntime::send_text_prompt_with_provenance`, `prompt.rs`), NOT the public
`send_prompt` (which the lockout guards). Each injection stamps
`PromptProvenance::Workflow { run_id, step_key, step_kind, label }` — the internal
enum's serde tag is `kind`, so the step-kind slug rides `step_kind` and surfaces as
the public contract's `kind` field (`prompt/provenance.rs` → contract `events.rs`).
The dead `Automation` variant (whose `to_public` lossily collapsed to `System`) is
gone. Desktop reads `prompt_provenance` off the `UserMessage` exactly as it reads
subagent-wake (`product-domain/.../subagents/provenance.ts`, `isWorkflowProvenance`).
Alongside the send, the executor writes a normalized row to the new
`workflow_session_injections` SQLite table (migration `0054`; `WorkflowStore::
insert_injection`) — the queryable index for the per-session steps checklist. Only
prompt-bearing steps write a row (shell steps write none — **PROPOSED option B,
adopted**: `turn_id` is NOT NULL, no read-path join). Absence of a row = human turn,
presence = machine.

**C13 lockout (E8 — block everything).** A session is held iff it appears in a
non-terminal run's session map — the run row IS the lock (no new column). The
runtime caches this in the generalized `WorkflowOwnedSessions`
(`HashMap<session_id, run_id>` + a `released` set, `exec_policy.rs`), which is ALSO
the always-bypass auto-approve registry — ownership and hold are the same condition.
`SessionRuntime` holds an `Arc<WorkflowOwnedSessions>` and guards every mutating verb
(`send_prompt`, `set_live_session_config_option`, `fork_session`, cancel/close;
title-update at the HTTP layer via `assert_session_not_workflow_held`) with a typed
`WorkflowHeld { run_id }` → 409 `SESSION_WORKFLOW_HELD` that routes the UI to the
take-over modal. **Included fix:** those verbs threaded access-gate errors as typed
`Access(WorkspaceAccessError)` (was a 500 collapse) so `WORKSPACE_MUTATION_BLOCKED`
and the new 409 both surface correctly. The executor is exempt by construction: it
uses the internal prompt path + `set_live_session_config_option_unlocked`.

**D15 take-over / cancel.** Server `POST /workflows/runs/{run_id}/cancel`
(`api.py` → `delivery.cancel_run`, user auth, owner-scoped 404):
`check_transition(→cancelled)` under `lock_run`, stamp `stopped_by_user_id`
(migration `a7b9c1d3e5f7`) + `finished_at`, run the shared terminal side effects
(expire the per-run gateway token, `apply_step_actions`), then best-effort runtime
cancel via `integrations/anyharness/workflow_runs.cancel_workflow_run` (cloud lane
through the sandbox gateway; local relayed by desktop). The runtime half already
existed (`manager.cancel`).

**Release = derived from terminal (C13 / addendum items 2–4).**
`WorkflowRunManager::release_on_terminal` fires on any terminal outcome (actor's
`drive_run` finishing, and the take-over `cancel`): it calls
`WorkflowOwnedSessions::release_run` (drops the run's sessions → simultaneously
un-holds them AND stops auto-approve — item 3; the `released` set stops a racing
crash-resume from re-arming) and deregisters each session from
`WorkflowGatewaySessions` so a later resume reassembles the worker dotfile binding
instead of the expired run token (item 2 restore). Sessions are **never closed** at
terminal (item 4, RULED): they stay open as normal interactive sessions. For a bound
(taken-over) session, the executor rebinds mid-run at claim time —
registers the per-run gateway server and relaunches the session
(`relaunch_session_for_mcp_rebind`) so its integration calls run under the run's
opt-in scope, not the owner's broad personal grant (item 2 claim).

---

## 8. Known gaps / drift + PR map

**Drift (design doc vs. shipped code — code wins):**
1. **No `agent.goal` step kind** — goal is an attachment on `agent.prompt`.
2. **`agent.config` added; `tool.call`/`workflow.call`/`agent.compact` not built.**
3. **Target modes `local | personal_cloud`** (spec said `local | cloud`).
4. ~~**Trigger-kind enum `manual|schedule|chat|agent|api`** (spec listed webhook/parent — absent).~~
   **`poll` landed (PR B):** `WorkflowRun.trigger_kind` and `WorkflowTrigger.kind`
   both widened to include `poll` (`manual|schedule|poll|chat|agent|api` /
   `schedule|poll`); webhook and parent-run provenance (`workflow.run`, PR D) are
   still absent.
5. **Session bindings `fresh | headless`** (spec's `current_session`/`no_session` not modelled as Setup bindings).
6. **Single `status` column, not `desired_state`/`observed_state`** — the split is enforced by the transition guard + the `OBSERVABLE_STATUSES` gate, not two columns.
7. **No workflow-`scope` column, no Automation→trigger migration** — web `/workflows` still routes to automations.
8. **No server-side cancel/pause endpoint** — cancel is a runtime endpoint only.
9. **`goal_iterating` and `cancelled` are client-only step statuses** (runtime `WorkflowStepStatus` lacks them).
10. ~~**Notify/Slack + scm/gh are stubs** (`slack_unavailable` / `scm_unavailable`).~~
    **Slack resolved by PR A** (this tree): `notify`+slack now performs a real send
    via the server-side step-actions ledger ([§2a](#2a-postgres-control-plane),
    [§3](#3-server-layer-control-plane)); `scm.open_pr`'s `scm_unavailable` (missing
    `gh`) is still a stub — unchanged.

**Gaps / sequencing:**
- **Sidecar pin bump (release blocker).** GoalPort/LoopPort ride the forked
  codex-acp/claude-acp sidecars behind a capability check; cloud goal-steps are the
  post-pin-bump follow-on.
- **Relay is app-open-only.** Local run relay state lives only while the desktop app
  is open. ([workflow-relay-store.ts](../apps/desktop/src/stores/workflows/workflow-relay-store.ts) docstring.)
- **Cloud runs poll, no push.** Run view polls `/refresh` at 3s.
- **Chat trigger — next cut.** `trigger_kind='chat'` is in the enum + client label map,
  but the composer "Run workflow" mid-chat binding isn't wired here.
- **Goals-domain nits** (inherited by the goal step): met-vs-cap race, `goal_timeout`
  session teardown with no mirror `failed` write on that path — see the goals-stack docs.

**PR / merge map** (numbers from the stack plan): draft **#921** `workflows/v1` (base
`goals/phase-a` = **#909**; sidecars codex-acp **#12** / claude-agent-acp **#24**).
Merge order **#12/#24 → catalog pin bump → #909 → #921.** `origin/workflows/v1` is at
`2577b19cd`; this tree (`workflows/ui-round3`, `dfe38a81b`) = origin + UI polish +
`agent.config` + live goal progress (push pending). Stage lineage from commit history:
server entities+StartRun → goals provenance+guard → engine + migration 0053 (W3) →
HTTP surface + app wiring → cloud delivery/refresh (W4) → schedule trigger + scheduler
(W5) → UI + always-bypass (W6) → cloud e2e evidence (W7, not yet in tree).

---

## 9. Operational recipes

**Run the stack locally** (from repo root; multi-worktree safe):
```bash
make setup PROFILE=<name>
make build                 # first clean worktree / after generated/Rust/frontend changes
make run PROFILE=<name>     # full stack; add STRIPE=1 for billing webhooks
```
Standalone: `cargo run -- serve` (runtime), `cd server && uv run pytest -q`. Desktop
debug: `pdev` on main, runtime API at `:8457/v1`, workflow playground at
`/playground/workflows`.

**Tests:**
```bash
# Server unit (the --extra dev is the gotcha — async plugins live there)
cd server && uv run --extra dev pytest tests/unit/test_workflow_*.py -q
# Runtime (Rust) domain engine + live layer
cd anyharness && cargo test -p anyharness-lib workflows
# Product-domain (TS) serializer/validation/run-status
pnpm --filter @proliferate/product-domain test
```
Fresh worktree: `make build` first (generates Tauri config + SDK + artifacts).
Regenerate the SDK after contract changes (`cd anyharness/sdk && pnpm run generate &&
pnpm run build`) — a stale SDK dist manifests as runtime "Importing binding name X not
found" after a branch switch.

**e2b dev-template rebuild** (cloud lane sandbox image; needs `E2B_API_KEY`/`E2B_TEMPLATE_NAME`):
```bash
make publish-cloud-template-env-local
make test-cloud-e2b        # RUN_CLOUD_E2E=1 pytest tests/e2e/cloud
```
W7 cloud end-to-end evidence is not present in this tree; `make test-cloud-e2b` is
where it will live.
