# Workflows — navigable deep dive

> **This doc is the map of the CURRENT state.** It is organized for someone reading
> to *understand* the system: click a link, land on the real code. Every path below
> was verified against the worktree `workflows/ui-round3` (tip `dfe38a81b`). Links
> are relative to this file (`codex/`).
>
> Companion: [`workflows-architecture.md`](workflows-architecture.md) is the
> **end-state** doc for the PR A–E arc (actions ledger + Slack delivery, poll
> triggers, `agent.emit`, `workflow.run`, gateway function grants) — read it for
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
  ├─ ensure_session()  ──── harness match? reuse : create in bypass mode   :147
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

### 1c. `agent.config` → session-switch flow

```
run_agent_config(cfg)   executor.rs:426     (executes instantly, opens NO session)
  fold {harness?, model?} onto self.active (ActiveConfig)
    ├─ harness changed  → session_switched:true
    │      (a NEW session opens at the NEXT agent step, when ensure_session sees
    │       active.harness != current.harness — NOT here)
    └─ harness same, model changed → applied LIVE to current session:
           set_live_session_config_option(session_id, ACP_MODEL_COMPAT_CONFIG_ID, model)
           (no live session yet ⇒ takes effect at next creation)
  output: {harness?, model?, session_switched}

On resume: recompute_active_config folds every agent.config in plan prefix
[0, cursor) over the Setup seed — derived purely from plan+cursor, NO persisted
config row.   executor.rs:131
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
    └── c3a5e7f9d1b2_workflow_step_action.py # workflow_step_action table (down_rev b2d4f6a8c0e1) — PR A
```

All three migrations are idempotent (guarded `_has_table`/`_has_index`/`_has_column`).

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
CheckConstraint("trigger_kind IN ('manual', 'schedule', 'chat', 'agent', 'api')", name="ck_workflow_run_trigger_kind"),
CheckConstraint("target_mode IN ('local', 'personal_cloud')", name="ck_workflow_run_target_mode"),
CheckConstraint(
    "status IN ('pending_delivery', 'delivered', 'running', 'waiting_approval', "
    "'completed', 'failed', 'cancelled')",
    name="ck_workflow_run_status"),
```
<sub>[db/models/cloud/workflows.py:102-120](../server/proliferate/db/models/cloud/workflows.py#L102)</sub>

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

- **`workflow_trigger`** (line 200) — *only* a trigger (pins target + schedule +
  concurrency, funnels to the same `StartRun`). CHECKs: `kind IN ('schedule')`,
  `concurrency_policy IN ('skip','queue')`, `target_mode IN ('local','personal_cloud')`,
  a cloud⇒workspace / local⇒null constraint (line 225), and `ck_workflow_trigger_schedule_fields`
  (line 231 — a `schedule` must carry rrule + timezone + next_run_at). Scheduler
  due-scan index `ix_workflow_trigger_scheduler_due` (line 242).
- **`workflow_step_action`** (line 299, PR A) — the step-actions ledger: server-side
  actions (Slack sends today) claimed off *observed* step completions. An action
  performs the side effect of a step the runtime already executed; it never decides
  what runs next (L19). `UniqueConstraint(run_id, step_key, action_kind)` (B5)
  **is** the claim — whichever observer's `INSERT ... ON CONFLICT DO NOTHING` lands
  owns performing the action. `status` CHECK `pending|done|failed` (line 324); partial
  index `ix_workflow_step_action_sweep … WHERE status = 'pending'` (line 328) drives
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
├── service.py      # workflow/version CRUD, trigger CRUD, StartRun + _resolve_plan
├── delivery.py     # cloud lane: deliver_cloud_run, refresh_cloud_run
├── scheduler.py    # second beat: fire due triggers + deliver eligible cloud runs + refresh/sweep (PR A phase 3)
├── actions.py      # PR A: step-actions ledger — claim_step_action, apply_step_actions, sweep_pending_actions
└── domain/         # pure, unit-tested, no DB
    ├── definition.py     # strict validator: raw dict → canonical dict
    ├── interpolation.py  # template grammar + arg coercion + injection guard
    ├── run_status.py     # transition guard (is_terminal / transition_allowed / check_transition)
    └── policy.py         # free-plan cap (workflow_create_allowed / free_plan_workflow_limit)
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

`start_run(...)` (line 305): validate target_mode/trigger_kind → owner-scoped 404 →
cloud target must be materialized (`target_workspace_not_ready` 409 before any row)
→ pin version → `parse_definition` strict → `coerce_arguments` → `_resolve_plan`
(line 251) → `store.create_run(status=pending_delivery)`. The run id is
pre-generated so it is inside the payload before insert.

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
    "steps": [...],  # flattened spine; each step stamped key="<node>.-.<step>", slot, label;
                     # {{inputs.*}} baked, {{emit.field}} rewritten to {{steps[n].output.field}}
}
```
`session_binding` defaults by trigger kind (manual/chat=fresh, schedule/poll=headless).
StartRun wire (B9): `args`→`inputs`, `target` = `workspace_id` XOR `trigger_id`,
optional `session_bindings:{slot:session_id}`.

Also here: `report_run_status` (line 434; locks run, enforces `check_transition`,
stamps started/finished, writes cursor/outputs/session ids/cost, then — after the
status write commits — calls `actions.apply_step_actions` in a try/except so an
action failure never breaks status ingestion, line 475), `mark_run_delivered`
(idempotent), owner-scoped `list_runs`/`get_run`, and trigger CRUD. **Local schedule
triggers are rejected at create** (`_validate_trigger_target_mode` →
`schedule_local_unsupported`) — there's no server→desktop claim protocol.

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

### 3.5 Scheduler — [scheduler.py](../server/proliferate/server/cloud/workflows/scheduler.py)

A second beat beside the automations scheduler, launched in
[automations/worker/main.py](../server/proliferate/server/automations/worker/main.py)
`_amain` via `asyncio.gather(run_scheduler_loop(...), run_workflow_scheduler_loop(...))`
(lines 50–57). Three phases per tick:

- **Phase 1 — fire due triggers.** `_fire_due_triggers` (line 181) →
  `_fire_one_trigger` (line 97): `claim_due_schedule_trigger` (`FOR UPDATE SKIP LOCKED`,
  [cloud_workflow_triggers.py:235](../server/proliferate/db/store/cloud_workflow_triggers.py#L235))
  → archived-workflow guard → concurrency (`skip` drops + records reason + advances
  cursor; `queue` always creates) → `start_run` wrapped in `db.begin_nested()` so a
  StartRun error rolls back just the run insert.
- **Phase 2 — deliver eligible cloud runs.** `_deliver_pending_runs` (line 221) →
  `_deliver_one_run` (line 201): delivers **only the FIFO-first non-terminal run per
  trigger** (`earliest_non_terminal_run_id_for_trigger`,
  [cloud_workflows.py:435](../server/proliferate/db/store/cloud_workflows.py#L435)) —
  one rule expresses both the immediate case and `queue` deferral. Capped per tick
  (each wakes a sandbox).
- **Phase 3 — refresh in-flight + sweep actions** (line 245, PR A). Added so
  Slack actions still fire for a triggered cloud run with nobody watching the run
  view (the UI's own `/refresh` poll is what drives `apply_step_actions` the rest
  of the time). `_refresh_in_flight_runs` (line 245) →
  `store.list_in_flight_triggered_cloud_runs`
  ([cloud_workflows.py:561](../server/proliferate/db/store/cloud_workflows.py#L561);
  `delivered|running|waiting_approval`, target_mode=personal_cloud, trigger_id not
  null) capped at
  `_MAX_REFRESHES_PER_TICK=10` and filtered to `delivered_before=tick_start` (skips
  a run this same tick just delivered — it needs time to execute before a refresh
  is useful) → `refresh_cloud_run` per run, which reconciles the ledger and calls
  `apply_step_actions`. `_sweep_actions` (line 269) → `actions.sweep_pending_actions`.
  Both sub-phases are exception-isolated from Phase 1/2 and from each other
  (`run_workflow_scheduler_tick`, line 288–295) — an actions bug never stalls
  trigger firing or delivery.

`run_workflow_scheduler_loop` (line 300): exponential backoff (×2, cap 300s), Sentry
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
| POST | `/workflows/runs/{run_id}/delivered` | **local** lane marks its delivery done |
| POST | `/workflows/runs/{run_id}/status` | **local relay** reports observed state; also triggers `apply_step_actions` |
| POST | `/workflows/runs/{run_id}/deliver` | **cloud** lane retry of stuck `pending_delivery` |
| GET | `/workflows/runs/{run_id}/refresh` | **cloud** lane pull; syncs ledger; also triggers `apply_step_actions` |
| GET | `/workflows/slack/channels` | PR A — `{channels:[{id,name}], connected}`; `connected:false` + empty list when the actor has no ready Slack account ([integrations accounts store](../server/proliferate/db/store/integrations/accounts.py)) |
| GET/PATCH/DELETE | `/workflows/{workflow_id}` | detail / update (append version) / archive |
| POST | `/workflows/{workflow_id}/runs` | **StartRun**; personal_cloud also calls `deliver_cloud_run` in-request |
| GET/POST · GET/PATCH/DELETE | `/workflows/{workflow_id}/triggers[/{trigger_id}]` | trigger CRUD |

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

// PlanStep now carries key/slot/label; ResolvedPlan.setup is gone — replaced by
// sessions:{slot -> SessionSpec{harness, model?, session_binding, bind_session_id?}}.
// ResolvedPlan::setup() derives a single PlanSetup for the current (pre-multi-slot)
// executor (TODO phase C/F: make the executor slot-keyed).
pub struct PlanStep { pub key: String, pub slot: String, pub label: String, pub on_fail: OnFail, /* flatten */ kind }
pub struct AgentPromptStep { pub prompt: String, pub goal: Option<GoalSpec>, pub required_invocation: Option<RequiredInvocation> }
pub struct AgentEmitStep { pub prompt: String, pub max_attempts: u32 /*default 3*/, pub output_schema: Option<Value> }
pub struct AgentConfigStep { pub harness: Option<String> /*deprecated; server emits model only*/, pub model: Option<String> }
pub enum BranchTarget { Continue, End }
pub enum SessionBinding { Fresh, Headless }
```
<sub>[plan.rs](../anyharness/crates/anyharness-lib/src/domains/workflows/plan.rs)</sub>

The runtime **executor** carries the v2 plan types but its per-kind *behavior* is
unchanged in this pass: `agent.emit` and `branch` return a `not_implemented`
failure (execution lands in phase C/F, C11/C12); `notify` is Slack-only.

`PlanStep { on_fail: OnFail, #[serde(flatten)] kind: StepKind }`; `OnFail { kind:
OnFailKind(Stop|Retry|Continue), n: u32 }`; `ResolvedPlan { run_id, …, setup: PlanSetup,
args, steps: Vec<PlanStep> }` (line 21).

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
  (cursor unchanged); `Suspend` → step `Waiting`, output = descriptor, run `WaitingApproval`.
- `resolve_pending_approval` (line 249) — approve/deny/timeout. For a goal step parked
  on a block, **approve → `Retry`** (re-arm + continue waiting).
- `record_step_goal_progress` (line 173) — live goal upsert; writes onto a **RUNNING**
  step's `output_json` only (a terminal write is never clobbered by a late snapshot).
- `append_session_id` (line 154) — append-once, ordered.

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
- `cancel` (line 105) — signal the live token, best-effort cancel the current session's
  in-flight turn, directly `mark_run_terminal(Cancelled)` when no actor is driving.
- `resolve_approval` (line 144) → `resolve_pending_approval`; if it advanced, `spawn_actor`.
- `spawn_startup_pass` (line 176) — crash-resume: loads non-terminal runs; `Running` ⇒
  respawn at the persisted cursor (re-enter, attempt bumped — idempotency is per-kind);
  `WaitingApproval` ⇒ left parked, timeout timer re-armed.

**Executor** ([executor.rs](../anyharness/crates/anyharness-lib/src/live/workflows/executor.rs)),
one per run. Holds `current: Option<CurrentSession>` (run session continuity) and
`active: ActiveConfig{harness, model?}`. `WorkflowExecDeps` bundles session_runtime,
goal_runtime, session_service, workspace_runtime, workflow_service, acp_manager,
workflow_owned_sessions.

- `hydrate_from_run` (line 112) / `recompute_active_config` (line 131) — resume.
- `ensure_session` (line 147) — reuse current session only if harness matches; else
  create in bypass mode, mark workflow-owned *before* the first prompt, append id.
- `subscribe` (line 214) — the **await substrate**: `broadcast::Receiver<SessionEventEnvelope>`;
  every wait subscribes *before* prompting.

**Per-kind semantics** (`execute_step` dispatch):

| kind | method | summary |
|---|---|---|
| `agent.config` | `run_agent_config` :426 | instant; folds harness/model; live model-set or session_switched (see [§1c](#1c-agentconfig--session-switch-flow)) |
| `agent.prompt` (no goal) | `run_prompt` :227 | ensure_session → subscribe → send_prompt → `await_turn_ended` (TURN_BACKSTOP 30m) |
| `agent.prompt` (goal) | `run_goal` :250 | arm → await → verify → terminal (see [§1b](#1b-step-execution-for-agentprompt--goal-arm--await--verify--terminal)) |
| `shell.run` | [commands.rs](../anyharness/crates/anyharness-lib/src/live/workflows/commands.rs) `run_shell_step` | `/bin/sh -lc` in workspace, scrubbed env, 8 KiB tail, default 600s |
| `scm.open_pr` | `open_pr_step` | `git push` + `gh pr create`; missing gh → `scm_unavailable` |
| `agent.emit` | — (phase C/F) | v2 kind; execution (re-ask loop, C12) not yet built — returns `not_implemented` for now |
| `notify` | [commands.rs](../anyharness/crates/anyharness-lib/src/live/workflows/commands.rs) `notify_step` | Slack-only (E1b); never a hard failure; the runtime emits `{channel:"slack", message, slack_channel_id}`, the server-side effect claims from it |
| `branch` | — (phase C/F) | v2 kind; continue/end arm (C11) not yet built — returns `not_implemented` for now |
| ~~`human.approval`~~ | removed (E1) | step kind deleted; the `waiting_approval` status survives via `goal.on_blocked` |

**output_json vocabulary per kind** (consumed by the run view + `{{steps[N].output}}`):

| kind | output keys |
|---|---|
| agent.config | `harness?`, `model?`, `session_switched` |
| agent.prompt (turn) | `turn_id`, `session_id` |
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
- **Schedule cloud-only.** Local scheduling needs a server→desktop claim protocol +
  repo/workspace binding that doesn't exist. (`service._validate_trigger_target_mode`.)
- **Zero-step drafts.** `require_steps=False` on save, `True` on StartRun.
- **`agent.config` as a step (not Setup-only).** Config changes are ordered events
  (Claude fixes → Codex reviews), folded into the active config; harness switch opens
  a new session at the next agent step. (`plan.rs::AgentConfigStep`, `run_agent_config`.)
- **Hidden run sessions.** Workflow-run sessions don't appear in the normal session
  list; their home is the run view's "Open session" deep link.
- **Notify in-app floor.** `notify` is never a hard failure. Slack delivery (PR A)
  is a server-side action claimed off the observed output, not a runtime concern —
  the runtime's job stops at emitting `{channel:"slack", message, slack_channel_id}`;
  the send itself, retries, and idempotency live in the step-actions ledger
  ([§2a](#2a-postgres-control-plane), [§3](#3-server-layer-control-plane)).

---

## 8. Known gaps / drift + PR map

**Drift (design doc vs. shipped code — code wins):**
1. **No `agent.goal` step kind** — goal is an attachment on `agent.prompt`.
2. **`agent.config` added; `tool.call`/`workflow.call`/`agent.compact` not built.**
3. **Target modes `local | personal_cloud`** (spec said `local | cloud`).
4. **Trigger-kind enum `manual|schedule|chat|agent|api`** (spec listed webhook/parent — absent).
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
