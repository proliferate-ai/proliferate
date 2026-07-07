# Workflows — end-state architecture (after PRs A–E)

**What this doc is.** The complete as-it-will-be picture of the workflows system
after the five blessed build items land. It is the alignment surface: every
design point is tagged. **All eight [OPEN-n] questions were ruled by Pablo on
2026-07-07** — each ruling is recorded inline as **RULED** at its section and in
the §9 table. This doc is now the design of record for the arc: PRs A–E, plus a
UX PR F that is gated on its own design pass (§8.3).

**Companion docs — cross-linked, not duplicated:**
- [`workflows-deep-dive.md`](workflows-deep-dive.md) — the **current-state**
  navigable reference (file trees, verbatim types, flow diagrams for what is
  built today on `workflows/v1` + `workflows/ui-round3`). When this doc says
  "exists today", the deep dive has the full detail.
- [`specs/tbd/issue-autofix-system-v1.md`](../specs/tbd/issue-autofix-system-v1.md) —
  the umbrella system this build serves. **Its §2 (poll contract) and §3
  (functions-as-MCP-tools) are LOCKED**; this doc restates them, never
  re-derives them, and flags loudly if code reality forces a conflict.
- [`specs/tbd/issues-service-v1.md`](../specs/tbd/issues-service-v1.md) — the
  standalone service on the other side of the poll boundary (own repo/box).
- [`specs/tbd/goals-and-workflows-v1.md`](../specs/tbd/goals-and-workflows-v1.md) —
  the original design layer for what already shipped.

**Marking convention (strictly applied):**
- **LOCKED** — decided; provenance in parentheses (spec section, merged PR, or
  dated Pablo ruling). Not up for annotation.
- **PLANNED(A..E)** — designed here, ships in that PR. Veto/edit freely.
- **[OPEN-n]** — was open for Pablo's ruling; each had options, a
  recommendation, and one paragraph of tradeoff. All eight were ruled
  2026-07-07; the tags remain for traceability, with the ruling recorded
  inline and in §9.

**The five build items** (LOCKED — Pablo ruling 2026-07-06, "your load-bearing
set is blessed, with one amendment"; build order A→B→C→D→E):

| PR | Item | One line |
|---|---|---|
| **A** | Effects ledger + Slack notify delivery | server observes a completed step → performs a side effect exactly once; `notify(slack)` becomes real |
| **B** | Poll trigger primitive | Proliferate polls a conforming endpoint, spawns one run per new item, idempotently |
| **C** | `agent.emit` typed output | agent must produce schema-validated JSON that lands in `{{steps[n].output.*}}` |
| **D** | `workflow.run` fire-and-forget chaining | a step that spawns a child run via the PR-A observer |
| **E** | Gateway function grants | workflow definitions name allowed gateway tools; gateway enforces scope + audit at call time |

Sequencing against the existing stack (LOCKED, from the standing merge plan):
sidecars #12/#24 → catalog pin bump → #909 (`goals/phase-a`) → #921
(`workflows/v1`). **PR A branches from `workflows/v1` and holds until #921
lands on main** so the new stack rebases once. The known anyharness SQLite
migration-number collision (this line owns `0053_workflow_runs.sql`; the
goals-b/loops line owns `0055_loops_scheduler.sql`) is resolved by whichever
merges second renumbering. PRs A/B/E add **Postgres** migrations only; C/D add
plan-schema variants but **no new SQLite migrations**.

Doc conventions: current code is quoted with `file:line` from worktree
`workflows/ui-round3` (tip `768a309c7`). Proposed code is written as full
concrete blocks (DDL, signatures, config shapes) — if a block has no file:line
citation, it does not exist yet.

---

## Table of contents

1. [Object model](#1-object-model)
2. [End-state file tree](#2-end-state-file-tree)
3. [One run, end to end](#3-one-run-end-to-end)
4. [Recurrence machinery](#4-recurrence-machinery)
5. [Where things execute](#5-where-things-execute)
6. [Functions & auth](#6-functions--auth)
7. [Typed I/O](#7-typed-io)
8. [UX surfaces](#8-ux-surfaces)
9. [Decision log](#9-decision-log)
10. [Validation plan](#10-validation-plan)

---

## 1. Object model

### 1.1 What exists today (LOCKED — shipped in #921 line)

Four Postgres tables own the program + durable ledger
([db/models/cloud/workflows.py](../server/proliferate/db/models/cloud/workflows.py);
migrations `e4f7a2b9c6d1_workflow_entities.py` → `b2d4f6a8c0e1_workflow_trigger.py`,
both idempotent-guarded). Full column detail: deep dive §2a. The shape that
matters for A–E:

- **`workflow`** (line 38) — the program. `owner_user_id` (personal-only v1),
  `current_version_id` (nullable, no DB FK), `archived_at`.
- **`workflow_version`** (line 76) — immutable append-only;
  `definition_json JSONB` is the canonical validated dict. **PR C and E extend
  the definition vocabulary inside this JSON — no new columns.**
- **`workflow_run`** (line 97) — the durable ledger; run id = delivery
  idempotency key; `resolved_plan_json` (whole payload), `status` (7-state
  CHECK), `step_cursor` / `step_outputs_json` (observed), `trigger_id` FK SET
  NULL + `scheduled_for` (slot dedup: partial unique index
  `uq_workflow_run_trigger_slot`, line 141).
- **`workflow_trigger`** (line 200) — pins target + schedule + concurrency;
  CHECK `kind IN ('schedule')` — deliberately open vocabulary ("webhook/api
  arrive later" is in the model docstring). **PR B widens this CHECK.**

Runtime (SQLite, observed truth):
[`persistence/sql/0053_workflow_runs.sql`](../anyharness/crates/anyharness-lib/src/persistence/sql/0053_workflow_runs.sql)
— `workflow_runs(run_id PK, …, plan_json, status, step_cursor, session_ids_json)`
+ `workflow_step_runs(run_id, step_index PK, kind, status, attempt, output_json, …)`.
Unchanged by A–E except new `kind` slugs flowing through existing columns.

Run status enum + transition guard: `constants/workflows.py:38-99`,
`domain/run_status.py:25-51` (`check_transition`; same-status = idempotent
no-op; terminal has no outgoing edges). Unchanged by A–E.

### 1.2 NEW: the step-effects ledger (PLANNED A)

The shared mechanism under PR A (Slack sends) and PR D (child spawns): *the
server observes a completed step in reported/refreshed run state and performs a
side effect at most once per (run, step, kind), with retry for never-started
effects.* One table, one CAS:

```python
# server/proliferate/db/models/cloud/workflows.py  (PR A)
class WorkflowStepEffect(Base):
    """Server-side effects claimed off observed step completions.

    The (run_id, step_index, effect_kind) unique constraint IS the claim: the
    transaction that inserts the row owns the effect. status walks
    pending -> done | failed; a sweeper retries stale 'pending' rows (an owner
    that crashed before performing) and transient 'failed' rows.
    """

    __tablename__ = "workflow_step_effect"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "step_index", "effect_kind",
            name="uq_workflow_step_effect_claim",
        ),
        CheckConstraint(
            "effect_kind IN ('slack_notify', 'spawn_child_run')",
            name="ck_workflow_step_effect_kind",
        ),
        CheckConstraint(
            "status IN ('pending', 'done', 'failed')",
            name="ck_workflow_step_effect_status",
        ),
        Index(
            "ix_workflow_step_effect_sweep",
            "updated_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    step_index: Mapped[int] = mapped_column(Integer)
    effect_kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    # slack_notify: {channel_id, message_ts} | spawn_child_run: {child_run_id}
    result_json: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at / updated_at  # house pattern
```

The claim CAS (§3.4 shows it in flow context):

```python
# server/proliferate/server/cloud/workflows/effects.py  (PR A)
async def claim_step_effect(
    db: AsyncSession, *, run_id: UUID, step_index: int, effect_kind: str
) -> UUID | None:
    """INSERT ... ON CONFLICT DO NOTHING. Returns the new effect id when this
    caller won the claim, None when another observer already owns it."""
    stmt = (
        pg_insert(WorkflowStepEffect)
        .values(id=uuid4(), run_id=run_id, step_index=step_index,
                effect_kind=effect_kind, status="pending", attempt_count=0)
        .on_conflict_do_nothing(constraint="uq_workflow_step_effect_claim")
        .returning(WorkflowStepEffect.id)
    )
    return (await db.execute(stmt)).scalar_one_or_none()
```

**Honest guarantee statement** (PLANNED A — this wording should survive into
the code docstring): the ledger gives *exactly-once claim*. Effect execution is
*at-least-once completion* via the sweeper. A crash inside the effect window
(after the Slack POST succeeded, before `status='done'` committed) can
duplicate a send — the same guarantee class as every non-transactional external
side effect. For **child spawns** we close even that gap: the child
`run_id` is pre-generated and stored on the effect row *before* `start_run` is
called with it, and `start_run` gains an optional explicit `run_id` — a
sweeper retry then re-creates the same child id and the insert conflicts
harmlessly. True exactly-once for spawns; Slack keeps the honest weaker class.

### 1.3 NEW: poll trigger config + seen-set (PLANNED B)

Poll is a new `workflow_trigger.kind`, reusing the row (target, concurrency,
enabled, args) and adding poll-only columns. Verbatim DDL:

```python
# alembic: <rev>_workflow_poll_trigger.py  (PR B)
op.add_column("workflow_trigger", sa.Column("poll_url", sa.Text(), nullable=True))
op.add_column("workflow_trigger", sa.Column("poll_auth_header", sa.String(255), nullable=True))       # header NAME, e.g. "Authorization"
op.add_column("workflow_trigger", sa.Column("poll_auth_ciphertext", sa.Text(), nullable=True))        # Fernet-encrypted header VALUE (house crypto helpers); never in definition_json
op.add_column("workflow_trigger", sa.Column("poll_interval_secs", sa.Integer(), nullable=True))
op.add_column("workflow_trigger", sa.Column("poll_item_schema_json", JSONB(), nullable=True))          # JSON Schema each item's `data` must validate against
op.add_column("workflow_trigger", sa.Column("poll_args_mapping_json", JSONB(), nullable=True))         # {arg_name: "dot.path.into.data"} — §7.1
op.add_column("workflow_trigger", sa.Column("poll_cursor", sa.Text(), nullable=True))                  # opaque, server-issued, echoed verbatim
op.add_column("workflow_trigger", sa.Column("last_poll_at", sa.DateTime(timezone=True), nullable=True))
op.add_column("workflow_trigger", sa.Column("last_poll_error", sa.Text(), nullable=True))              # trigger-error surfacing (schema failures, HTTP errors)

# CHECK widened: kind IN ('schedule', 'poll'); plus completeness per kind:
sa.CheckConstraint(
    "kind <> 'poll' OR (poll_url IS NOT NULL AND poll_interval_secs IS NOT NULL)",
    name="ck_workflow_trigger_poll_fields",
)
# Poller due-scan index (mirror of ix_workflow_trigger_scheduler_due):
Index("ix_workflow_trigger_poller_due", "last_poll_at",
      postgresql_where=text("enabled = true AND kind = 'poll'"))
```

The per-trigger seen-set — the Proliferate half of the at-least-once story
(§4.3). Doubles as the trigger-error surface (invalid items are recorded, never
silently dropped — LOCKED, autofix §2):

```python
class WorkflowTriggerItem(Base):
    """At-most-one spawn per (trigger, item id). PK is the dedup guarantee."""

    __tablename__ = "workflow_trigger_item"
    __table_args__ = (
        CheckConstraint("status IN ('spawned', 'invalid', 'error')",
                        name="ck_workflow_trigger_item_status"),
    )

    trigger_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_trigger.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(255), primary_key=True)   # the poll item's `id`
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)  # schema-validation detail for 'invalid'
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

### 1.4 NEW: parent↔child linkage (PLANNED D)

```python
# alembic: <rev>_workflow_run_parent.py  (PR D)
op.add_column("workflow_run", sa.Column(
    "parent_run_id", sa.Uuid(),
    sa.ForeignKey("workflow_run.id", ondelete="SET NULL"), nullable=True))
op.add_column("workflow_run", sa.Column("parent_step_index", sa.Integer(), nullable=True))
op.create_index("ix_workflow_run_parent", "workflow_run", ["parent_run_id"],
                postgresql_where=sa.text("parent_run_id IS NOT NULL"))
```

Child provenance (`trigger_kind` value, executor identity, target workspace) is
[OPEN-7] — see §3.6.

### 1.5 Definition-JSON vocabulary growth (PLANNED C, E — no new tables)

Two extensions to the canonical definition dict stored in
`workflow_version.definition_json`:

```jsonc
{
  "args": [...],                       // exists today
  "setup": {...},                      // exists today
  "functions": [                       // NEW (PR E): gateway tool grants
    { "provider": "issues", "tools": ["claim", "search_issues", "update_status"] }
  ],
  "steps": [
    ...,
    {                                  // NEW (PR C): typed output step
      "kind": "agent.emit",
      "prompt": "Summarize the fix for the notification.",
      "output_schema": { "type": "object", "required": ["pr_title"], "properties": { "pr_title": {"type": "string"} } },
      "on_fail": { "kind": "stop" }
    },
    {                                  // NEW (PR D): chaining step
      "kind": "workflow.run",
      "workflow_id": "…uuid…",
      "args": { "issue_id": "{{steps[0].output.issue_id}}" }
    }
  ]
}
```

Validator: `SUPPORTED_WORKFLOW_STEP_KINDS` in
[constants/workflows.py:113-129](../server/proliferate/constants/workflows.py)
gains `agent.emit` + `workflow.run`; new `_parse_agent_emit` / `_parse_workflow_run`
register in `_STEP_PARSERS`
([definition.py](../server/proliferate/server/cloud/workflows/domain/definition.py),
pattern: deep dive reading-path ①). `functions` joins `args`/`setup`/`steps` in
the top-level allowed keys; each entry validates provider = a registered
integration-definition namespace visible to the owner, tools = non-empty
strings. Rust mirror: two `StepKind` variants in
[plan.rs:67-98](../anyharness/crates/anyharness-lib/src/domains/workflows/plan.rs)
(internally-tagged enum — old runtimes hard-fail on unknown kinds, which is
correct: a plan with steps the runtime can't execute must not half-run; the
catalog/runtime rebuild ships in the same PR).

---

## 2. End-state file tree

Every file the system touches after A–E. Legend: ✅ exists today (see deep dive
for role detail) · **A**/**B**/**C**/**D**/**E** arrives in that PR · Δ modified
in that PR.

```
server/proliferate/
├── constants/workflows.py                              ✅ ΔC ΔD (step-kind slugs) ΔE (functions caps)
├── db/models/cloud/workflows.py                        ✅ ΔA (WorkflowStepEffect) ΔB (trigger poll cols, WorkflowTriggerItem) ΔD (parent cols)
├── db/store/cloud_workflows.py                         ✅ ΔA (effect CRUD+sweep scan) ΔD (start_run explicit run_id, children query)
├── db/store/cloud_workflow_triggers.py                 ✅ ΔB (claim_due_poll_trigger, item seen-set CAS, cursor persist)
├── alembic/versions/
│   ├── e4f7a2b9c6d1_workflow_entities.py               ✅
│   ├── b2d4f6a8c0e1_workflow_trigger.py                ✅
│   ├── <rev>_workflow_step_effect.py                   A
│   ├── <rev>_workflow_poll_trigger.py                  B
│   ├── <rev>_workflow_run_parent.py                    D
│   └── <rev>_workflow_run_gateway_token.py             E   (shape depends on OPEN-3)
├── server/cloud/workflows/
│   ├── api.py                                          ✅ ΔA (GET slack channels for picker) ΔB (poll-trigger CRUD passthrough)
│   ├── models.py                                       ✅ ΔA ΔB ΔC ΔD ΔE (request/response mirrors)
│   ├── service.py                                      ✅ ΔB (poll trigger validate) ΔD (start_run run_id param, parent linkage)
│   ├── delivery.py                                     ✅ ΔA (refresh path calls effects.apply)
│   ├── scheduler.py                                    ✅ ΔA (phase 3: refresh in-flight scheduled cloud runs + effect sweeper) ΔB (imports poller into the same beat)
│   ├── effects.py                                      A   (claim CAS, slack_notify performer, spawn_child performer(D), sweeper)
│   ├── poller.py                                       B   (poll loop: fetch → validate → dedup → spawn → cursor persist)
│   └── domain/
│       ├── definition.py                               ✅ ΔC ΔD (parsers) ΔE (functions block)
│       ├── interpolation.py                            ✅ (unchanged — grammar already supports everything C needs)
│       ├── run_status.py                               ✅
│       ├── policy.py                                   ✅
│       └── poll_contract.py                            B   (item/page pydantic models of the LOCKED §2 contract + schema validation)
├── integrations/
│   ├── anyharness/workflow_runs.py                     ✅
│   └── slack/{client,messages,webhooks,errors}.py      ✅ (reused as-is by A: chat_post_message client.py:91, list_channels client.py:115)
└── server/cloud/integration_gateway/
    ├── api.py · dependencies.py · service.py           ✅ ΔE (grant carries run scope; tools/list + tools/call filtered by grant scope)
    └── domain/{json_rpc,tool_args,virtual_tools}.py    ✅ ΔE

anyharness/crates/anyharness-lib/src/
├── domains/workflows/
│   ├── plan.rs                                         ✅ ΔC (AgentEmitStep) ΔD (WorkflowRunStep)
│   ├── engine.rs · model.rs · store.rs                 ✅
│   ├── service.rs                                      ✅
│   └── templates.rs                                    ✅ ΔC (resolve_step arm for emit; workflow.run args late-bind)
├── live/workflows/
│   ├── executor.rs                                     ✅ ΔC (run_emit: prompt→await→read→validate→reprompt) ΔD (instant-complete arm) ΔE (per-run gateway launch extra if OPEN-3=a)
│   ├── commands.rs                                     ✅ ΔA (notify_step: channel:"slack" + slack_channel_id passthrough — 5 lines)
│   ├── actor.rs · manager.rs · exec_policy.rs          ✅
├── persistence/sql/0053_workflow_runs.sql              ✅ (number may shift on merge-collision renumber)
└── api/http/workflow_runs.rs                           ✅

apps/packages/product-domain/src/workflows/
├── definition.ts · validation.ts                       ✅ ΔC ΔD ΔE (step kinds + functions mirror)
├── run-status.ts                                       ✅ ΔC ΔD (output chips: emit payload, child-run link)
├── interpolation.ts · effective-config.ts              ✅
├── model.ts · presentation.ts · templates.ts           ✅ ΔB (poll trigger label) ΔD (chained templates)

apps/desktop/src/
├── components/workflows/editor/
│   ├── WorkflowStepPanel.tsx                           ✅ ΔA (slack channel picker) ΔC (emit editor: prompt + schema) ΔD (workflow picker + args)
│   ├── WorkflowTriggersCard.tsx                        ✅ ΔB (poll config: url/header/secret/interval/schema/mapping)
│   ├── WorkflowSetupCard.tsx                           ✅ Δ(OPEN-1) 
│   └── (rest of editor/, home/, run/, screen/)         ✅ ΔD (run view parent↔child links)
├── hooks/access/cloud/workflows/                       ✅ ΔA ΔB (new endpoints)
└── lib/access/cloud/workflows.ts                       ✅ ΔA ΔB

cloud/sdk/src/generated/openapi.ts                      ✅ regenerated in A, B, E (cloud-client-generate)

codex/
├── workflows-deep-dive.md                              ✅ Δ in EVERY PR (LOCKED — Pablo ruling 2026-07-06: same-PR doc updates)
└── workflows-architecture.md                           this doc; committed with PR A after annotation
```

**Not touched:** the issues service itself (own repo, `issues-service-v1.md`),
the automations stack, the sessions/goals engine (the goal step's substrate is
finished), `proliferate-worker` (unless OPEN-3 = per-run token via plan, which
keeps the worker unchanged too).

---

## 3. One run, end to end

### 3.1 The spine (LOCKED — shipped; deep dive §1a has the full diagram)

`StartRun` is the only resolution point: pin version → coerce args → eager
`{{args.*}}` interpolation → insert `workflow_run(status=pending_delivery,
resolved_plan_json=whole payload)` — run id pre-generated so it travels inside
the payload ([service.py:305-393](../server/proliferate/server/cloud/workflows/service.py)).
Delivery: local lane = desktop POSTs the plan to its own runtime then marks
`/delivered`; cloud lane = server wakes the sandbox and POSTs
`/v1/workflow-runs {plan, workspaceId}` in-request
([delivery.py:78](../server/proliferate/server/cloud/workflows/delivery.py)).
The runtime dedupes on `plan.run_id`
(`create_run_idempotent`), spawns one actor, and the actor loop is this —
verbatim, [actor.rs:14-35](../anyharness/crates/anyharness-lib/src/live/workflows/actor.rs):

```rust
pub async fn drive_run(
    service: &WorkflowService,
    executor: &dyn WorkflowStepExecutor,
    run_id: &str,
    cancel: &CancelToken,
) -> EngineProgress {
    loop {
        match service.run_next_step(run_id, executor, cancel).await {
            Ok(EngineProgress::Advanced) => continue,
            Ok(other) => return other,
            Err(error) => {
                let _ = service.mark_run_terminal(
                    run_id,
                    WorkflowRunStatus::Failed,
                    Some("engine_error".to_string()),
                    Some(error.to_string()),
                );
                return EngineProgress::Finished(WorkflowRunStatus::Failed);
            }
        }
    }
}
```

Each `run_next_step`
([service.rs:197-241](../anyharness/crates/anyharness-lib/src/domains/workflows/service.rs)):
terminal/cancel short-circuit → `step(cursor)` → `build_outputs` →
`templates::resolve_step` (late-bind `{{steps[N].output.*}}`) → `begin_step`
(persist Running) → `executor.execute_step` → `decide_after_step` (pure on-fail
matrix, [engine.rs:105-141](../anyharness/crates/anyharness-lib/src/domains/workflows/engine.rs))
→ `apply_decision` (the only place the cursor moves, one transaction per
transition).

**v1 is sequential steps only** (LOCKED — 2026-07-06 ruling: "parallel lanes
deferred"). One cursor, one actor, one timeline. What parallel lanes would
require later, for the record: a lane-keyed cursor (per-lane
`workflow_step_runs` partitioning), concurrent session management per lane in
the executor, lane-aware on-fail semantics (does lane 2 die when lane 1
fails?), and a two-dimensional run timeline. Nothing in A–E forecloses it; the
chaining story below is the v1 pressure valve.

### 3.2 Observed state → server (LOCKED — shipped)

The server never talks step-by-step to the runtime. Local lane: the desktop
relay polls the local runtime every 2s and POSTs diffs to
`/runs/{id}/status` → `report_run_status`
([service.py:431-472](../server/proliferate/server/cloud/workflows/service.py))
— locked row, strict `check_transition`, writes cursor/outputs/session
ids/cost. Cloud lane: `GET /runs/{id}/refresh` → `_sync_run_from_view`
([delivery.py:166-211](../server/proliferate/server/cloud/workflows/delivery.py))
— lenient reconciling read, never moves out of terminal.

### 3.3 NEW — the observer hook (PLANNED A)

Both ingest paths gain one call after they persist observed state:

```python
# at the end of report_run_status(...) and _sync_run_from_view(...):
await effects.apply_step_effects(db, run=updated)
```

```python
# server/proliferate/server/cloud/workflows/effects.py  (PR A; D adds the second arm)
EFFECT_STEP_KINDS = {"notify": "slack_notify", "workflow.run": "spawn_child_run"}

async def apply_step_effects(db: AsyncSession, *, run: WorkflowRunRecord) -> None:
    """Scan observed step outputs for effect-bearing completed steps; claim and
    perform any not yet owned. Safe to call on every report/refresh: the ledger
    CAS makes re-observation free."""
    plan_steps = (run.resolved_plan_json or {}).get("steps", [])
    for index_str, output in (run.step_outputs_json or {}).items():
        index = int(index_str)
        step = plan_steps[index] if index < len(plan_steps) else {}
        effect_kind = _effect_kind_for(step, output)      # notify+slack / workflow.run only
        if effect_kind is None:
            continue
        effect_id = await claim_step_effect(
            db, run_id=run.id, step_index=index, effect_kind=effect_kind)
        if effect_id is None:
            continue                                       # another observer owns it
        await _perform(db, effect_id, effect_kind, run=run, step=step, output=output)
```

`_perform("slack_notify")` resolves the owner's ready Slack integration account
(`get_ready_account_for_provider(db, owner_user_id, "slack")` —
[db/store/integrations/accounts.py:131](../server/proliferate/db/store/integrations/accounts.py)),
decrypts the bundle, and calls the **existing first-class client**
`chat_post_message(bot_token=…, channel_id=step["slack_channel_id"], text=output["message"], …)`
([integrations/slack/client.py:91-112](../server/proliferate/integrations/slack/client.py)).
No new Slack machinery is built. Runtime side is a 5-line change in
[commands.rs:197-208](../anyharness/crates/anyharness-lib/src/live/workflows/commands.rs):
`NotifyChannel::Slack` now outputs `{channel: "slack", message, slack_channel_id}`
instead of `"slack_unavailable"` — the *effect* is the server's job; the in-app
record remains the floor and the step still never hard-fails (LOCKED — shipped
stance, deep dive §7).

**The unattended-cloud gap this design must close** (PLANNED A — load-bearing):
cloud `/refresh` is UI-driven; a scheduled/poll-fired cloud run nobody is
watching would never be observed, so effects would never fire. Therefore the
workflow scheduler tick gains **phase 3**: refresh in-flight
(`delivered`/`running`/`waiting_approval`) scheduled+polled cloud runs, capped
per tick, plus the effect sweeper (retry `pending` effects older than 60s,
`attempt_count`-bounded). Local-lane runs keep the desktop relay as their
observer (app-open-only — the known v1 gap stands).

### 3.4 Crash-resume walkthrough (LOCKED — shipped; extended by A)

Runtime restart: `spawn_startup_pass`
([manager.rs:176-195](../anyharness/crates/anyharness-lib/src/live/workflows/manager.rs))
loads non-terminal runs — `Running` ⇒ respawn actor at the persisted cursor
(the cursor step re-enters with `attempt+1`; per-kind idempotency documented at
[manager.rs:1-19](../anyharness/crates/anyharness-lib/src/live/workflows/manager.rs));
`WaitingApproval` ⇒ parked, timeout timer re-armed. `hydrate_from_run`
([executor.rs:109-126](../anyharness/crates/anyharness-lib/src/live/workflows/executor.rs))
restores the session pointer + re-folds the active config from the plan prefix.

Now the full exactly-once trace for PR A's headline scenario — *server dies
between a notify step completing and the Slack send*:

```
runtime: notify step completes → output_json = {channel:"slack", slack_channel_id, message}
relay/refresh: POST /status carries step_outputs["3"]
server: report_run_status persists outputs
        → apply_step_effects → claim CAS inserts (run, 3, slack_notify) 'pending'
        → ☠ server crashes before chat_post_message
server restarts:
  relay re-reports (same signature) → apply_step_effects → CAS conflicts → skip  ✓ no double claim
  scheduler phase-3 sweeper: finds 'pending' effect, age > 60s, attempt_count 0
        → re-performs chat_post_message → status='done', result_json={message_ts}  ✓ delivered once
run view: renders the delivery chip from the effect row (sent / pending / failed)
```

And for PR D's child spawn: the effect row gets `result_json={"child_run_id": <pre-generated uuid>}`
*in the claim transaction*; `start_run(..., run_id=child_run_id)` is called
after. A sweeper retry calls `start_run` with the same id → PK conflict →
treat as already-spawned. Exactly-once, provably.

### 3.5 Chaining: `workflow.run` fire-and-forget (PLANNED D; semantics LOCKED 2026-07-06)

Runtime arm — instant, like `agent.config`:

```rust
// plan.rs (PR D)
#[serde(rename = "workflow.run")]
WorkflowRun(WorkflowRunStep),

pub struct WorkflowRunStep {
    pub workflow_id: String,
    /// Late-bound: may contain {{steps[N].output.*}} (resolved by templates.rs
    /// before execution, like every other templated field).
    #[serde(default)]
    pub args: serde_json::Value,
}

// executor.rs execute_step arm (PR D)
StepKind::WorkflowRun(spawn) => StepOutcome::Completed {
    output: json!({ "requested": true, "workflow_id": spawn.workflow_id, "args": spawn.args }),
},
```

The runtime performs nothing; the PR-A observer sees the completed step and
spawns the child through the ledger (§3.4). **What fire-and-forget does and
does not guarantee (state this in the editor UI copy too):** the child run is
created exactly once with the interpolated args, has its own run record, actor,
timeline, and cost line; the parent *completes regardless of the child's fate*
— no await, no child status feedback into the parent, no cycle risk beyond
depth (see below). What it does NOT give you: "run B after A *succeeds and
using B's results*" across workflows in one plan — that composition needs
await-child, which is deliberately v2 (awkward with one-shot plan delivery;
LOCKED deferral, 2026-07-06). **No mid-run plan mutation, ever** (LOCKED —
2026-07-06: "no await-child in v1; no mid-run plan mutation ever"): appending
steps to a delivered plan is ruled out.

Guard rails (PLANNED D): validator rejects `workflow_id` = the defining
workflow's own id (direct self-spawn); the spawner enforces a chain-depth cap
(walk `parent_run_id`, max 5) against indirect cycles — a depth breach records
the effect as `failed` with `error_message="chain_depth_exceeded"`, visible in
the parent's run view.

### 3.6 [OPEN-7] Child-run provenance — RULED (a) (Pablo, 2026-07-07)

**Ruling: new `'workflow'` trigger_kind (CHECK widened in the PR D migration);
child inherits the parent's workspace; executor = owner.** Original options,
for the record:

- **`trigger_kind`** — options: (a) reuse `'agent'` (in the CHECK today,
  currently unused), (b) **add `'workflow'` to the CHECK (recommended)** so run
  lists can distinguish agent-initiated from workflow-chained runs honestly,
  (c) the spec's old `'parent'`.
- **`executor_user_id`** — parent owner (only coherent v1 choice; runs-as-owner
  is LOCKED). Stated for completeness.
- **Target workspace** — recommended: **inherit the parent's workspace** (same
  `target_mode`, same workspace id). Two runs can share a workspace safely
  (runs are keyed by run_id; sessions are per-run). A child needing different
  hardware/isolation is a v2 concern.

Tradeoff paragraph: adding `'workflow'` to the CHECK costs a two-line migration
and buys permanent audit clarity — reusing `'agent'` avoids the migration but
conflates two genuinely different initiators the moment agent-initiated runs
ship, and renaming a trigger_kind later means rewriting history or living with
ambiguity. Inheriting the parent workspace avoids workspace provisioning in the
observer (which has no UI context to pick one) at the cost that a chained
workflow designed for a clean tree may see the parent's dirt — mitigated
because chained definitions declare their own Setup and can open fresh
sessions, and the fresh-tree question is the same one OPEN-4 answers for polls.

---

## 4. Recurrence machinery

### 4.1 What exists: the schedule beat (LOCKED — shipped)

One process hosts two independent beats:
[automations/worker/main.py](../server/proliferate/server/automations/worker/main.py)
`_amain` runs `asyncio.gather(run_scheduler_loop(...), run_workflow_scheduler_loop(...))`.
The workflow beat ticks every 15s
([scheduler.py:242-252](../server/proliferate/server/cloud/workflows/scheduler.py)):

- **Phase 1 — fire due triggers.** Per trigger, own transaction:
  `claim_due_schedule_trigger` (`FOR UPDATE SKIP LOCKED` —
  [cloud_workflow_triggers.py:235](../server/proliferate/db/store/cloud_workflow_triggers.py))
  → archived-workflow guard → RRULE cursor → concurrency (`skip` records + advances;
  `queue` always creates) → `start_run` inside a savepoint
  ([scheduler.py:96-178](../server/proliferate/server/cloud/workflows/scheduler.py)).
  The DB-level double-fire guard is the partial unique index on
  `(trigger_id, scheduled_for)`.
- **Phase 2 — deliver eligible cloud runs.** FIFO-first non-terminal run per
  trigger, capped per tick ([scheduler.py:200-237](../server/proliferate/server/cloud/workflows/scheduler.py)).
- Loop wrapper: exponential backoff ×2 cap 300s, Sentry after 3 consecutive
  failures.

PR A adds **phase 3** (observer refresh + effect sweeper, §3.3). PR B adds the
poll loop *into the same beat* — a third gathered coroutine, same
backoff/Sentry pattern, so operationally there is still exactly one worker
process to run and monitor.

### 4.2 The poll contract (LOCKED — restated verbatim from issue-autofix-system-v1 §2, not re-derived)

> ```
> GET /poll?cursor=<opaque>&limit=50
> Authorization: <configured header>
>
> 200 →
> {
>   "items": [
>     {
>       "id": "iss_abc123",          // stable, unique — idempotency key
>       "kind": "issue.new",          // namespaced event type
>       "occurred_at": "2026-07-06T...",
>       "data": { ... }               // validated against trigger schema
>     }
>   ],
>   "cursor": "eyJsYXN0X2lkIjo...",   // opaque, server-owned; echoed next poll
>   "has_more": false
> }
> ```
>
> Rules: cursor is opaque and server-issued (Proliferate stores and echoes it,
> never interprets it). `id` is the idempotency key — at-most-one workflow
> spawn per `id` per trigger config. `data` is schema-validated; failing items
> are skipped and surfaced as trigger errors, never silently dropped, never fed
> to an agent malformed. **Delivery is at-least-once** — the endpoint may see
> the same cursor twice; returning the same items twice must be safe. No ack
> callback, no two-phase protocol. Fan-out: one item = one workflow run;
> `limit` caps burst; backlog drains across polls.

**Conflict flag, resolved:** Pablo's handwritten concept doc said the endpoint
"should STOP serving things that have been polled" (queue-pop). That is
superseded by this contract (Pablo ruling 2026-07-06: "the poll contract stays
exactly as §2 specifies — no queue-pop") and is NOT ingested into this design.
Destructive pop + a crash before cursor persist = lost items; cursor echo +
idempotency keys + service-side claim CAS lose nothing.

### 4.3 The poller (PLANNED B)

```python
# server/proliferate/server/cloud/workflows/poller.py  (PR B)
async def _poll_one_trigger(session_factory, *, trigger_id: UUID, now: datetime) -> int:
    async with session_factory() as db, db.begin():
        trigger = await trigger_store.claim_due_poll_trigger(   # FOR UPDATE SKIP LOCKED,
            db, trigger_id=trigger_id, now=now)                 # due = last_poll_at + interval <= now
        if trigger is None or trigger.workflow_archived:
            return 0

        page = await fetch_poll_page(                            # httpx GET, 10s timeout,
            url=trigger.poll_url,                                # header from decrypted
            auth=decrypt_poll_auth(trigger),                     # poll_auth_ciphertext,
            cursor=trigger.poll_cursor, limit=50)                # parsed by poll_contract.py
        # HTTP / shape errors: record last_poll_error, advance last_poll_at, return 0.

        spawned = 0
        for item in page.items:
            inserted = await trigger_store.insert_trigger_item(  # INSERT ON CONFLICT DO NOTHING
                db, trigger_id=trigger_id, item_id=item.id)      # ← the seen-set CAS
            if not inserted:
                continue                                         # replayed item — dedup
            error = validate_item_data(item.data, trigger.poll_item_schema_json)
            if error:
                await trigger_store.mark_item(db, trigger_id, item.id,
                                              status="invalid", error_message=error)
                continue                                         # surfaced, never dropped, never spawned
            args = map_item_args(item.data, trigger)             # §7.1 — dot-path mapping over static args
            # Savepoint per item (Pablo amendment 2026-07-07, mirroring the
            # schedule scheduler's begin_nested around start_run): a start_run
            # failure rolls back ONLY this item's insert — without it, one
            # raising item would roll back the whole transaction (cursor, seen-
            # set, and all) and re-wedge the feed on every poll. The failure is
            # recorded as status='error' and the loop continues.
            try:
                async with db.begin_nested():
                    run = await service.start_run(
                        db, _SchedulerActor(id=trigger.workflow_owner_user_id),
                        trigger.workflow_id, args=args,
                        target_mode=trigger.target_mode,             # pinned cloud workspace (OPEN-4 ruling)
                        trigger_kind="poll",                         # new CHECK member (PR B migration)
                        target_workspace_id=trigger.target_workspace_id,
                        trigger_id=trigger_id)
            except CloudApiError as exc:
                await trigger_store.mark_item(db, trigger_id, item.id,
                                              status="error",
                                              error_message=f"{exc.code}: {exc.message}")
                continue
            await trigger_store.mark_item(db, trigger_id, item.id,
                                          status="spawned", run_id=run.id)
            spawned += 1

        # Cursor persists in the SAME transaction as the item rows: a crash
        # anywhere above re-polls the old cursor and the seen-set absorbs the
        # replay. The cursor NEVER advances past items that weren't recorded.
        await trigger_store.persist_poll_cursor(
            db, trigger_id=trigger_id, cursor=page.cursor, polled_at=now)
        return spawned
```

Delivery of the spawned cloud runs rides the existing phase 2 unchanged (they
carry `trigger_id`, so FIFO-per-trigger + per-tick caps apply). `has_more=true`
just means the next due tick drains more — no special casing.

### 4.4 The full at-least-once story (LOCKED composition — autofix §2 + §4.2 + P2/P3)

Three independent layers, each allowed to be imperfect:

```
endpoint may replay items          (at-least-once delivery; crash-safe by contract)
      ↓
workflow_trigger_item PK           (Proliferate: at-most-one SPAWN per item id)
      ↓
issues-service claim() CAS         (service side: at-most-one CLAIM per issue —
                                    issues-service-v1 §4: UPDATE ... WHERE claimed_by IS NULL)
      =
net exactly-once EFFECTS           (a duplicate fire produces a run that claims
                                    nothing, reads already_claimed, exits silently —
                                    enumerated outcome, not an error; autofix §3)
```

This is the P2/P3 pattern ("correctness by construction, not careful timing")
and it is why no ack callback exists anywhere.

---

## 5. Where things execute

### 5.1 Cloud-only components, stated explicitly (LOCKED — shipped reality)

| component | lanes | why |
|---|---|---|
| schedule triggers | **cloud only** | `_validate_trigger_target_mode` rejects local at create (`schedule_local_unsupported`) — no server→desktop claim protocol exists |
| poll triggers (B) | **cloud only** | same machinery, same reason; inherits the restriction |
| effect observer via scheduler phase 3 (A) | cloud runs | local runs are observed by the desktop relay (app-open-only) |
| Slack notify effect (A) | **both** — the effect runs on the *server*, fed by either lane's observed state | local lane caveat: app closed ⇒ report delayed ⇒ send delayed (not lost) |
| gateway dotfile (`integration-gateway.json`) | **cloud only** | written solely by `proliferate-worker` at enroll ([integration_gateway.rs:21-45](../anyharness/crates/proliferate-worker/src/integration_gateway.rs)); nothing in the desktop lane writes it (verified — see OPEN-5) |
| manual + chat-triggered runs | both | client-initiated; the desktop delivers locally itself |

### 5.2 [OPEN-4] Poll-trigger run target — RULED (a) (Pablo, 2026-07-07)

**Ruling: pinned cloud workspace per trigger + `queue` concurrency, with (c)'s
door left open in the schema** (the §1.3 columns already accommodate a future
per-item target mode without migration). Two conditions attached to the
ruling:

- **Shared-tree hygiene is the workflow's job, by convention:** the fix
  workflow's definition opens with a hygiene step —
  `shell.run: git checkout main && git pull && git clean -fd` — since fix runs
  share the pinned tree. Seeded/template definitions that mutate a shared
  workspace must carry the same step.
- **Throughput ceiling, stated honestly:** fix runs are 30–90 min each, so one
  pinned workspace processes ~16–48 fixes/day serially — fine at current issue
  volume, but a real ceiling. **Revisit the target mode when volume grows**;
  that is what (c)'s open door is for.

Original options, for the record:

**(a) Pinned cloud workspace per trigger (recommended).** Reuses the exact
shape schedule triggers already enforce — `ck_workflow_trigger_target_workspace`
requires a named workspace for `personal_cloud`
([workflows.py:225](../server/proliferate/db/models/cloud/workflows.py)) — plus
`queue` concurrency. Zero new provisioning machinery; items drain sequentially
through one sandbox.

**(b) Fresh headless cloud workspace per item.** True isolation, natural
parallelism — but the scheduler must provision/materialize workspaces (a
machine it doesn't have today), and every item pays a sandbox create+boot.

**(c) Configurable per trigger, (a) default.** The schema in §1.3 doesn't
change; (b) becomes a later `target_mode` value.

Triage-economics numbers (estimates, labeled as such): Sentry sync at 5-min
polls; a bad day ≈ 30–50 new issues, normal day ≈ 5–10. A triage run is small
— claim + search + verdict ≈ 2–4 min wall, cheap model. Under (b) that's
30–50 sandbox creates/day (each ≈ 30–60s e2b create+wake+enroll overhead ≈
25–50 sandbox-hours/day of mostly-idle boot+teardown) for runs whose work is
minutes. Under (a) one warm sandbox absorbs the whole stream; worst-case queue
latency on a 50-item burst ≈ 50 × 3 min ≈ 2.5h for the tail — acceptable for
triage (5-min poll cadence already sets the latency floor, and the fix
workflow's deeper runs are fewer). Recommendation: **(a) for v1**, with (c)'s
door left open in the trigger schema. Tradeoff: (a)'s single workspace means
poll-fired runs share a tree — same dirt concern as OPEN-7; the triage/fix
workflows mitigate by starting fresh sessions and not depending on tree state,
but a customer workflow that edits code in a pinned workspace must handle its
own hygiene (`shell.run` git-clean step, or declare fresh-tree-needed — a v2
definition flag).

### 5.3 [OPEN-5] Local-lane scope for gateway functions — RULED (a) (Pablo, 2026-07-07)

**Ruling: cloud-only v1. The "functions require cloud runs" caption must be
LOUD — surfaced at definition save (editor warns when a `functions` block is
saved) AND at local launch (the run-args modal warns before StartRun), never
discovered at runtime.**

Verified: the local desktop runtime home has **no** `integration-gateway.json`
writer — only `proliferate-worker` (cloud sandbox enroll) writes it; the
session-launch extension that injects the gateway MCP server
([mcp_bindings/integration_gateway.rs:41-78](../anyharness/crates/anyharness-lib/src/domains/sessions/mcp_bindings/integration_gateway.rs))
no-ops when the dotfile is absent. So today, **local-lane workflow agents have
zero gateway tools, silently.**

Options: **(a) cloud-only for v1 (recommended)** — PR E's editor surfaces a
"functions require cloud runs" caption when a definition with `functions` is
launched locally, and StartRun warns (not blocks); **(b) local parity** — the
desktop mints/fetches a gateway token at login and writes the dotfile into the
local runtime home (a real feature: token lifecycle on a developer laptop,
revocation, multi-profile homes). Tradeoff: the autofix system — the driving
customer of PR E — runs entirely on cloud triggers, so (b) buys nothing for
the mission and adds a credential-on-disk surface to the laptop; but (a) means
"test your functions workflow locally" doesn't work, which stings exactly the
FDE/template motion (A9) where an engineer iterates locally before deploying a
trigger. If (a), the gap must be loud in the UI, not discovered at runtime.
Note: if OPEN-3 resolves to per-run tokens *in the plan*, local parity gets
dramatically cheaper (the token rides the payload; no dotfile, no enrollment)
— worth weighing the two rulings together.

---

## 6. Functions & auth

### 6.1 Registration: the issues service as an integration definition (PLANNED E; pattern LOCKED — gateway shipped 07-03)

No new registration machinery. The issues service's MCP server becomes a seed
definition exactly like Slack's
([seeds.py:270-284](../server/proliferate/server/cloud/integrations/seeds.py) is
the template):

```python
SeedDefinition(
    namespace="issues",
    display_name="Issues Service",
    description="Claim, search, and transition Proliferate-internal issues.",
    auth_kind="api_key",                       # static bearer, not OAuth
    config=IntegrationConfig(
        transport="http",
        url=StaticUrl("https://issues.<internal-host>/mcp"),
        headers=(_secret_bearer_header("ISSUES_SERVICE_TOKEN"),),
    ),
)
```

Account rows (`cloud_integration_account`), org policy
(`cloud_integration_policy`), credential encryption, tool-cache refresh — all
existing ([integrations.py:38-151](../server/proliferate/db/models/cloud/integrations.py)).
**LOCKED (Pablo, 2026-07-06): there is no session-level "MCP injection"
concept and none is built. All external tools flow through the integrations
gateway, period.** The runtime's only involvement is the already-shipped launch
extension that points sessions at the gateway URL; per-workflow scoping is
gateway *configuration*, enforced at call time.

### 6.2 How a tool call flows today (LOCKED — shipped)

```
agent (in sandbox session)
  │  MCP tools/call over HTTP
  ▼
POST /v1/cloud/integration-gateway/mcp        api.py:44
  │  bearer token → hash → grant lookup       dependencies.py:26-47
  ▼
IntegrationGatewayGrant{runtime_worker_id, runtime_kind, owner_user_id, organization_id}
  │                                           store/runtime_workers.py:94-100
  ▼
_handle_tools_call → _call_virtual_tool       service.py:158-181
  → account_for_provider(grant, provider)     (owner's ready accounts, org policy applied)
  → resolve_launch (decrypt creds, refresh)   → mcp_remote.call_tool(url, headers, tool, args)
  → audit log per invocation
```

The grant is **per runtime worker** (`cloud_integration_gateway_token`, one
active per worker — [runtime_workers.py:109-138](../server/proliferate/db/models/cloud/runtime_workers.py)).
The gateway currently has **no idea which session, run, or workflow is
calling** — that is the entire gap PR E closes, and how it closes it is OPEN-3.

### 6.3 The grant in the definition (PLANNED E)

`definition_json.functions` (§1.5) is the source of truth for what a
workflow's agents may call. `StartRun` bakes the resolved grant into scope
(mechanism per OPEN-3); the gateway enforces it on both `tools/list` (the agent
only *sees* granted tools — least astonishment) and `tools/call` (defense in
depth). Scoping example from the mission (LOCKED — issues-service-v1 §5):
triage workflow → `claim, get_issue, search_issues, update_status,
mark_duplicate, mark_dismissed`; fix workflow → all tools.

### 6.4 [OPEN-3] The scoping key — RULED (a) (Pablo, 2026-07-07)

**Ruling: per-run gateway token minted at StartRun; scope frozen at mint;
expires at terminal status.** Option (b) is recorded below for the tradeoff
history only.

**Option (a) — per-run gateway token, minted at StartRun (recommended).**

```python
# alembic (PR E): one row per run, hashed token, scope snapshot
op.create_table(
    "cloud_workflow_run_gateway_token",
    sa.Column("id", sa.Uuid(), primary_key=True),
    sa.Column("workflow_run_id", sa.Uuid(),
              sa.ForeignKey("workflow_run.id", ondelete="CASCADE"), nullable=False),
    sa.Column("owner_user_id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=True),
    sa.Column("token_hash", sa.String(64), unique=True, nullable=False),
    sa.Column("scope_json", JSONB(), nullable=False),      # the definition's functions[], resolved
    sa.Column("status", sa.String(16), nullable=False),    # active | expired | revoked
    sa.Column("created_at", ...), sa.Column("expires_at", ...),  # lifetime = run lifetime + grace
)
```

```
StartRun: mint token → scope_json = definition.functions → plaintext token into
resolved_plan_json.gateway = {url, authorization}
  ▼ delivery (plan already travels authenticated to the sandbox)
executor.ensure_session: for workflow-owned sessions, pass the plan's gateway
block as a launch extra (same SessionMcpServer::Http shape the dotfile
extension builds — mcp_bindings/integration_gateway.rs:63-72) instead of/over
the worker dotfile
  ▼ agent calls gateway
dependencies.py: hash lookup hits cloud_workflow_run_gateway_token first →
grant carries {run_id, workflow_id, scope} → tools/list+call filtered to scope
→ audit rows stamped with run_id → terminal /status report expires the token
```

**Option (b) — keep the per-worker token; pass `X-Run-Id` as a header the
gateway cross-checks.** Sessions add the header via per-session MCP header
config; the gateway joins run→workflow→functions at call time.

Request-flow deltas, side by side:

```
(a) authorization: Bearer <per-run>          (b) authorization: Bearer <per-worker>
    identity = the token IS the run              x-run-id: <run uuid>
    scope frozen at StartRun                     identity = worker; run CLAIMED by header
    lifetime = run lifetime                      scope resolved live per call
    revocation = row flip                        any session on the worker can claim
                                                 any run id it can guess/observe
```

Audit implications: under (a) every audit row is attributable to a run by
construction (the credential proves it); `X-Run-Id` becomes redundant
corroboration. Under (b) the run attribution is a *claim* by the caller — an
agent (or a prompt-injected agent) in any co-located session can wear another
run's identity and inherit its broader scope. Recommendation: **(a)**.
Tradeoff paragraph: (a) costs a table, a mint step in StartRun, an executor
launch-extra path, and puts a live credential inside `resolved_plan_json`
(mitigations: hash-at-rest is impossible since the sandbox needs plaintext —
instead scope tokens tightly, expire on terminal status, and note
`resolved_plan_json` already rides the same trust boundary as the session
tokens the sandbox holds); (b) is a smaller diff (no migration, no mint) but
its security property is "trust the caller's header", which is exactly the
property we refused for run ownership everywhere else in this system, and it
makes the audit trail assertable rather than provable. (a) also cheapens
OPEN-5(b) later, per §5.3.

### 6.5 Error conventions the tools must follow (LOCKED — autofix §3, restated)

Enumerated return values, not HTTP failures (`already_claimed {by}`,
`invalid_transition {from,to}` are normal agent inputs); the state machine is
encoded in the API, not the prompt; every mutating call auto-appends to the
service's `events` with the calling run's identity. These are the issues
service's obligations; Proliferate's obligation is delivering trustworthy run
identity (OPEN-3) and scoping (§6.3).

---

## 7. Typed I/O

### 7.1 Poll item → run args (PLANNED B)

`data` is validated against `poll_item_schema_json` (LOCKED — malformed items
never reach an agent). Then a **dot-path mapping** turns item data into the
workflow's declared args, merged over the trigger's static `args_json`
([elaboration] — veto the grammar freely):

```jsonc
// workflow args:  [{name: "issue_id", type: "number", required: true},
//                  {name: "issue_title", type: "string", required: true}]
// trigger.poll_args_mapping_json:
{ "issue_id": "issue_id", "issue_title": "title" }        // paths into item.data, dots descend
```

`map_item_args` = static `args_json` ⊕ mapped values, then the **existing**
strict `coerce_arguments`
([interpolation.py:188](../server/proliferate/server/cloud/workflows/domain/interpolation.py))
— unknown args rejected, required enforced, types coerced. A mapping miss on a
required arg marks the item `invalid` (not `error`), with the message naming
the path. Nothing else is new: from `start_run` onward a poll-fired run is
indistinguishable from a manual one.

### 7.2 Interpolation rules as they exist (LOCKED — shipped; unchanged by A–E)

Two-phase, spec'd in [interpolation.py:1-17](../server/proliferate/server/cloud/workflows/domain/interpolation.py):

- **Eager at StartRun**: `{{args.<name>}}` substituted segment-based, never
  re-scanned; substituted values get every `{`/`}` backslash-escaped so an arg
  literally containing `{{steps[0].output.x}}` can never become a live token
  (`interpolate_args_in_string`, interpolation.py:229-248).
- **Late-bound at the runtime**: `{{steps[<n>].output.<name>}}` resolved by
  [templates.rs:22-49](../anyharness/crates/anyharness-lib/src/domains/workflows/templates.rs)
  against completed-step outputs in a single scan that also unescapes `\{`/`\}`;
  unresolved placeholders stay verbatim (never silently emptied). Validator
  guarantees refs point strictly earlier (`_validate_references`).

`build_outputs` ([service.rs:488-498](../anyharness/crates/anyharness-lib/src/domains/workflows/service.rs))
includes failed-but-continued steps, so `on_fail: continue` + a later
`{{steps[n].output.exit_code}}` works.

### 7.3 `agent.emit` (PLANNED C; existence LOCKED 2026-07-06 — "agent.emit with
schema validation is the typed output channel, and completion events are just
the last emit"; **no forced tool calls** — LOCKED same ruling)

```rust
// plan.rs (PR C)
#[serde(rename = "agent.emit")]
AgentEmit(AgentEmitStep),

pub struct AgentEmitStep {
    pub prompt: String,
    /// JSON Schema (2020-12 subset) the emitted value must validate against.
    pub output_schema: serde_json::Value,
}
```

Executor semantics (mirrors the verify-gate pattern the goal step already
uses — arm/await/check/re-prompt, `MAX_VERIFY_ATTEMPTS`-style):

```
run_emit(step, ctx):
  ensure_session → subscribe → send_prompt(step.prompt + EMIT_INSTRUCTION)
  await_turn_ended (TURN_BACKSTOP)
  read the emitted JSON (mechanism = OPEN-2)
  validate against output_schema (jsonschema crate)
    valid   → StepOutcome::Completed { output: <the validated object, verbatim> }
    invalid → re-prompt with the validation errors, ≤ MAX_EMIT_ATTEMPTS (3)
    exhausted → Failed { code: "emit_invalid", output: {errors, raw_tail} }
```

The validated object becomes the step's *entire* output, so
`{{steps[n].output.pr_title}}` navigates into it with the existing dot-path
resolution — zero new grammar. This is what makes notify messages, chained
`workflow.run` args, and the autofix Slack ping ("issue, evidence, who's
affected, PR link") all expressible today-shaped. A workflow's "completion
event with schema" is, by construction, its last `agent.emit` — no separate
concept exists.

### 7.4 [OPEN-2] The emit mechanism — RULED (a) (Pablo, 2026-07-07)

**Ruling: file-drop + validate + reprompt.**

**(a) File-drop (recommended).** `EMIT_INSTRUCTION` appended to the prompt:
*"Write ONLY the JSON object to `<workspace>/.proliferate/emit-<run>-<step>.json`.
Overwrite if present."* Executor reads the file after `TurnEnded`, validates,
deletes on success. Harness-agnostic (any agent that can write a file),
unambiguous (no prose-vs-payload parsing), naturally idempotent on retry
(overwrite), and the artifact aids debugging. Cost: one filesystem convention,
and the instruction consumes a little prompt space.

**(b) Parse the final assistant message.** Extract the last fenced JSON block
(or whole-message JSON) from the final assistant text. No filesystem
convention — but brittle against prose-happy models ("Here's the JSON you
asked for…"), against harnesses whose "final message" boundary differs
(Codex/Claude end-of-turn semantics already differ in the activity layer), and
retry prompts contaminate the transcript the user later opens via the session
deep link.

Tradeoff: (a)'s only real weakness is agents occasionally narrating instead of
writing the file — which the re-prompt loop already handles as a validation
failure with a corrective message; (b)'s failure mode (wrong block extracted,
silently valid-but-unintended JSON) is worse because it can *succeed wrongly*.
Recommendation: **(a)**.

### 7.5 [OPEN-6] Named step-output references — RULED (a) (Pablo, 2026-07-07)

**Ruling: optional per-step `name` + `{{steps.<name>.output.*}}` grammar,
inside PR C. `shell.run`'s `output_name` is deprecated into `name`.**

Today refs are index-based: `{{steps[3].output.pr_url}}` — brittle under step
reorder (the editor renumbers, references don't follow). Options: **(a) add an
optional per-step `name`** (identifier, unique in the definition), grammar
gains `{{steps.<name>.output.*}}` alongside index form (`shell.run` already has
`output_name` as precedent — deprecate it into `name`); **(b) index-only
stays, editor mitigates** (reorder rewrites references mechanically). Tradeoff:
(a) touches the validator, both interpolators, the runtime templates, TS
mirror, and autocomplete (~a day inside PR C, where the grammar files are
already open) and makes definitions durable under editing — the template/FDE
motion writes definitions that get edited by others; (b) is free now but every
reorder is a landmine and editor-rewrite has its own edge cases (refs inside
`workflow.run` args). Recommendation: **(a), inside PR C.**

---

## 8. UX surfaces

Pablo's handwritten concept doc is the source for UX intent; its intents are
folded in here so that doc can be retired. Its queue-pop polling idea is
superseded (§4.2) and NOT ingested.

### 8.1 What exists (LOCKED — shipped; deep dive §6)

Home (two tabs, cards, args modal, templates gallery), editor (roomy numbered
rail + scope-boundary headers for `agent.config`, right panel, live
validation), run view (timeline via `deriveStepRunViews`, live goal line,
Open-session deep link, local-lane approve/deny), playground fixtures. Routes:
[AuthenticatedAppHost.tsx:63-66](../apps/desktop/src/pages/AuthenticatedAppHost.tsx).

### 8.2 Ships inside A–E (PLANNED, per PR)

| PR | surface |
|---|---|
| A | notify step panel: Slack channel picker (new `GET /v1/cloud/workflows/slack/channels` wrapping [client.py:115 list_channels](../server/proliferate/integrations/slack/client.py)); `slackConnected` flag → "Connect Slack in Settings → Integrations" caption when absent; run-view delivery chip fed by the effect row (sent ✓ / pending / failed + reason) |
| B | triggers card: poll config form (url, auth header name+secret, interval, item schema, args mapping with per-arg path fields); trigger row surfaces `last_poll_error` + per-item table (spawned/invalid) linked from the trigger |
| C | emit step editor: prompt + schema editor (JSON textarea with validation, template chips for common shapes); run-view output chip renders the emitted object (collapsed JSON) |
| D | step panel: workflow picker (owner's non-archived workflows) + args editor with `{{steps…}}` autocomplete; run view: "Spawned run →" link on the step row, "Started by <parent> step N ↗" banner on the child |
| E | editor: Functions section (provider + tool multi-select from the gateway's tool cache); local-launch caption per OPEN-5 |

### 8.3 Concept-doc intents → disposition ([OPEN-8] — RULED (a), Pablo 2026-07-07)

**Ruling: a separate UX PR F after E**, bundling: in-chat trigger modal,
new-chat recommended strip, tab-grouped run sessions, session input-lockout
during runs, seeded read-only templates, Stop/cancel button (including the
missing server-side cancel endpoint — deep-dive drift #8), **and seeded
workspaces** (new item, not in the original concept doc): a pre-provisioned
cloud workspace per seeded workflow, so a fresh user can trigger a template
without any setup — provisioning happens at seed time, and the template's
trigger/StartRun defaults point at it.

**Gate on PR F (Pablo, verbatim intent): before building F, write a
§8-equivalent design section for it at engine-section depth and bring it for
annotation like this doc — one-line intents don't get built.** The table below
is the intent inventory that design pass expands from:

| intent (Pablo's words) | disposition |
|---|---|
| "clean list of workflows with agent provider icons and clear use cases" | exists (cards + glyph strip); provider icon on the card = small Δ, fold into any A–E UI pass |
| "pre-constructed workflows seeded in app" | templates gallery exists (5 starters); *seeded org/global read-only templates instantiated on use* = **PR F** (OPEN-8 ruling), incl. seeded workspaces (below) |
| "recommended workflows in the main part of the new-chat page" | NOT built. Home composer is [HomeNextScreen.tsx](../apps/desktop/src/components/home/screen/HomeNextScreen.tsx); a recommended-workflows strip is a contained addition. **PR F** (OPEN-8 ruling) |
| "in every chat, place to trigger workflow (clean modal)" | NOT built; `trigger_kind='chat'` is in the run CHECK and the client label map ([model.ts:23](../apps/packages/product-domain/src/workflows/model.ts)) — enum-ready, composer binding unwired. **PR F** (OPEN-8 ruling) |
| "new workflows run in new session in the workspace; same provider may offer continue-or-new" | matches shipped session semantics (harness switch ⇒ new session at next agent step; same harness reuses). The continue-current-chat variant needs the chat trigger first. |
| "when running: see steps + stream but CANNOT touch ANYTHING; clean view" | matches the shipped run view (read-only timeline; sessions reachable via deep link). Enforcing read-only on the *deep-linked session while the run drives it* is real work (input lockout + banner) — **PR F** (OPEN-8 ruling) |
| "group tabs run by the workflow in a tab group" | tab-group machinery exists ([use-tab-group-actions.ts](../apps/desktop/src/hooks/workspaces/workflows/tabs/use-tab-group-actions.ts), TabGroupPill) — binding run-opened sessions into a group is contained. **PR F** (OPEN-8 ruling) |
| "can pause but is destructive — no resume" | **Naming correction (recommended):** the engine *has* durable resume (cursor + crash-resume, §3.4) — don't ship an action called "pause" that destroys. Ship **Stop (cancel)**: exists runtime-side (`POST /v1/workflow-runs/{id}/cancel`); the server-side desired-state cancel endpoint is still missing (deep-dive drift #8) and should ride the first UX PR that needs it. Long-lived "pause and pick up later" is intentionally not a state — the P2 pattern (nothing waits inside a workflow; the service state machine holds position) covers the real need. |

### 8.4 Run-view honesty rule (LOCKED — Pablo, gallery round 2: "we shouldn't be
mocking stuff we don't have")

Every chip/line in the run view renders from real observed data (`output_json`,
effect rows). No invented intermediate states. `goal_iterating` stays the only
client-derived status (from real cursor + goal-armed fact).

---

## 9. Decision log

### LOCKED (provenance in parentheses)

| # | decision | provenance |
|---|---|---|
| L1 | Whole-plan delivery; run id = idempotency key; actor never fetches definitions | shipped, #921 line; deep dive §7 |
| L2 | Desired/observed split; server never step-drives the runtime | shipped; deep dive §1 |
| L3 | Always-bypass workflow sessions; `human.approval` is the only human-in-the-loop | goals-and-workflows-v1 §3.3; shipped `exec_policy.rs` |
| L4 | Runs-as-owner; no "Run as" v1 | goals-and-workflows-v1; shipped |
| L5 | `agent.config` is a step; harness switch ⇒ new session at next agent step; model-only ⇒ live set | Pablo ruling (mental-model msg, 2026-07-04); shipped |
| L6 | Goal = attachment on `agent.prompt`, native mirror, caps runtime-enforced | goals stack, shipped |
| L7 | Poll contract: at-least-once, opaque cursor, id idempotency, schema-validated data, no queue-pop | issue-autofix-system-v1 §2; Pablo ruling 2026-07-06 |
| L8 | Functions = MCP tools through the integrations gateway; **no session-level MCP injection concept, ever**; per-workflow scoping is gateway config | issue-autofix-system-v1 §3; Pablo rulings 2026-07-06 (×2) |
| L9 | No forced tool calls; `agent.emit` (schema-validated) is the typed output channel; completion event = last emit | Pablo ruling 2026-07-06 |
| L10 | Parallel lanes deferred; chaining = fire-and-forget `workflow.run` via server-observed spawn; no await-child v1; **no mid-run plan mutation ever** | Pablo ruling 2026-07-06 |
| L11 | Flaky-test handling out of v1 entirely; unresolvable test failures → `needs-human` | issue-autofix-system-v1 §5.3/§8 |
| L12 | Slack notify delivery graduates to required (critical path); server-observed delivery, runtime never blocks on it | Pablo ruling 2026-07-06 (amendment) |
| L13 | Build order A→B→C→D→E; PR A holds until #921 lands; docs updated in the same PR as code | Pablo rulings 2026-07-06 |
| L14 | Run view renders only real observed data (no mocked states) | Pablo, UI gallery round 2 |
| L15 | Schedule (and by inheritance poll) triggers are cloud-only until a server→desktop claim protocol exists | shipped `_validate_trigger_target_mode` |

### OPEN — all ruled by Pablo, 2026-07-07

| # | question | options (rec. first) | ruling |
|---|---|---|---|
| OPEN-1 | PR #966 disposition — it now conflicts with `workflows/v1` tip; its residual change is only the Setup-summary session label. Also: do you still want that label ("Fresh (visible)/Headless") out of the collapsed summary? | (a) close #966 as superseded; I land the label one-liner on `workflows/v1` if wanted · (b) I rebase #966 for you to merge | **(a)** — close #966 as superseded; land the session-label one-liner on `workflows/v1` |
| OPEN-2 | `agent.emit` mechanism (§7.4) | (a) file-drop + validate + reprompt · (b) parse final assistant message | **(a)** file-drop + validate + reprompt |
| OPEN-3 | Gateway scoping key (§6.4) | (a) per-run token minted at StartRun, scope frozen, expires at terminal · (b) per-worker token + `X-Run-Id` header cross-check | **(a)** per-run token minted at StartRun; scope frozen; expires at terminal |
| OPEN-4 | Poll-trigger run target (§5.2) | (a) pinned cloud workspace per trigger + queue (schedule-trigger shape reused) · (b) fresh headless workspace per item · (c) configurable, (a) default | **(a)** pinned workspace + queue, (c)'s door open in schema; fix workflow opens with a git-hygiene step; throughput ceiling noted — revisit at volume |
| OPEN-5 | Local-lane gateway functions (§5.3) | (a) cloud-only v1, loud UI caption · (b) local parity (dotfile/token on laptop) | **(a)** cloud-only v1; loud caption at definition save AND local launch |
| OPEN-6 | Named step-output refs (§7.5) | (a) optional step `name` + `{{steps.<name>.output.*}}`, inside PR C · (b) index-only, editor rewrites on reorder | **(a)** named refs inside PR C; `output_name` deprecated into `name` |
| OPEN-7 | Child-run provenance (§3.6) | trigger_kind: (a) new `'workflow'` · (b) reuse `'agent'`; workspace: inherit parent's (rec.); executor = owner (stated) | **(a)** new `'workflow'` trigger_kind; inherit parent workspace; executor = owner |
| OPEN-8 | UX-surface sequencing (§8.3): new-chat recommended strip, in-chat trigger modal, tab-grouped run sessions, session input-lockout during runs, seeded org templates, seeded workspaces | (a) separate UX PR F after E · (b) fold selected items into A–E · (c) later | **(a)** separate UX PR F after E — full bundle incl. Stop/cancel (+ server-side cancel endpoint) and NEW seeded-workspaces item; F gated on its own engine-depth design doc |

---

## 10. Validation plan

Per-PR manual scripts, written to run cold. Common setup: a dev profile per PR
(`make setup PROFILE=wf<x> && make build && make run PROFILE=wf<x>` from a
worktree on the PR branch), auth per
[`specs/developing/local/feature-worktree-auth.md`](../specs/developing/local/feature-worktree-auth.md)
(layer B: `SINGLE_ORG_MODE=true`, `/setup` claim, then password login; seed the
github grant incl. non-null `access_token_ciphertext` — the readiness check
requires it). Server unit suites ride each PR
(`cd server && uv run --extra dev pytest tests/unit/test_workflow_*.py -q`);
these scripts are the *behavioral* pass on top.

### PR A — effects ledger + Slack

1. Settings → Integrations → connect Slack (real OAuth against the seeded
   `slack` definition; needs `CLOUD_MCP_SLACK_*` env in the profile).
2. Create workflow: one `agent.prompt` (trivial), one `notify(slack)` step —
   the panel should list real channels; pick a test channel. Run (local lane).
3. **Expect:** message in the channel within ~5s of the step completing; run
   view shows the delivery chip `sent ✓`; exactly one
   `workflow_step_effect` row (`status='done'`, `result_json.message_ts` set).
4. **Crash drill:** re-run; the moment the prompt step completes, `kill -9` the
   server (`make run` supervisor restarts it, or restart manually). **Expect:**
   after restart the sweeper (scheduler phase 3) delivers; the channel shows
   **exactly one** message for that run; effect row `attempt_count ≥ 1`.
5. **Replay drill:** POST the same `/status` body twice (curl, bearer from
   login). **Expect:** second call is a no-op (CAS conflict), no second send.
6. Cloud lane: same workflow on a schedule trigger, one-shot RRULE, **close the
   run view** (nobody polls `/refresh`). **Expect:** message still arrives —
   phase 3 observed the run without a UI.

### PR B — poll trigger

1. Run the replaying stub feed (deliberately violates nothing but replays —
   save as `/tmp/stub_feed.py`, `uv run uvicorn stub_feed:app --port 9911`):

```python
# stub_feed.py — poll-contract stub that RE-SERVES the last page once (at-least-once)
from fastapi import FastAPI, Request
app = FastAPI()
ITEMS = [{"id": f"it_{i}", "kind": "test.item", "occurred_at": "2026-07-07T00:00:00Z",
          "data": {"n": i, "title": f"item {i}"}} for i in range(7)]
ITEMS.append({"id": "it_bad", "kind": "test.item", "occurred_at": "2026-07-07T00:00:00Z",
              "data": {"title": 42}})   # schema-invalid on purpose (n missing, title wrong type)
@app.get("/poll")
def poll(request: Request, cursor: str = "", limit: int = 50):
    start = max(0, int(cursor or 0) - 2)          # ← replays the last 2 items every page
    page = ITEMS[start:start + limit]
    return {"items": page, "cursor": str(start + len(page)), "has_more": start + len(page) < len(ITEMS)}
```

2. Workflow with args `n:number, title:string`, one prompt step
   `"item {{args.title}}"`. Trigger: kind=poll, url `http://127.0.0.1:9911/poll`,
   interval 60s, schema `{required:["n","title"], properties:{n:{type:"number"}, title:{type:"string"}}}`,
   mapping `{n: "n", title: "title"}`, pinned cloud workspace (per OPEN-4a) or
   local equivalent if OPEN-4 rules otherwise.
3. **Expect over the next few ticks:** exactly **7** runs (one per valid id,
   despite every page replaying two ids); `workflow_trigger_item` has 7
   `spawned` + 1 `invalid` (`it_bad`, error naming the schema failure);
   `last_poll_error` null; trigger UI shows the invalid item.
4. **Crash drill:** stop the server mid-drain, restart. **Expect:** still 7
   runs total — cursor+seen-set absorbed the replay.
5. Kill the stub. **Expect:** `last_poll_error` populated, trigger stays
   enabled, next tick retries.

### PR C — agent.emit

1. Workflow: `agent.prompt` ("create FEATURES.md listing 3 invented features"),
   then `agent.emit` (prompt: "emit the feature list", schema
   `{required:["features"], properties:{features:{type:"array", items:{type:"string"}, minItems:3}}}`),
   then `notify(slack)` with message `"Features: {{steps[1].output.features}}"`.
2. **Expect:** run completes; emit step's output chip shows the validated
   object; the Slack message contains the real array (late-binding worked).
3. **Adversarial:** schema demanding `{"impossible": {"const": 12345}}` with a
   prompt that never mentions it. **Expect:** ≤3 attempts visible
   (`attempt` field), then step `failed` with code `emit_invalid` and the
   validation errors in the output — no infinite loop, no fabricated pass.

### PR D — workflow.run

1. Child workflow `W2`: arg `title:string`, one prompt step. Parent `W1`:
   `agent.emit` (emits `{"title": ...}`) → `workflow.run(W2, args:{title:"{{steps[0].output.title}}"})`.
2. Run `W1`. **Expect:** `W1` completes immediately after the spawn step
   (fire-and-forget); a `W2` run appears with the interpolated arg, linked both
   ways in the run views; `workflow_run.parent_run_id/parent_step_index` set;
   spawn effect row `done` with `child_run_id`.
3. **Crash drill:** kill the server between `W1`'s spawn-step completion and
   child creation; restart. **Expect:** exactly **one** `W2` run (pre-generated
   child id makes the retry conflict).
4. **Cycle drill:** point a workflow at itself → validator rejects; build an
   A→B→A indirect loop → chain stops at depth 5 with
   `chain_depth_exceeded` on the effect row.

### PR E — function grants

1. Register a stub MCP server as an `api_key` integration definition (or the
   real issues service if up); connect an account.
2. Two workflows: `WF-narrow` grants `["tool_a"]`; `WF-wide` grants
   `["tool_a","tool_b"]`. Each has a prompt step instructing the agent to list
   tools and call `tool_b`.
3. **Expect:** in `WF-narrow`'s session, `tools/list` through the gateway shows
   only `tool_a`; the `tool_b` call returns a scope error (enumerated, not
   500). In `WF-wide`, `tool_b` succeeds. Gateway audit rows carry the run id.
4. Under OPEN-3(a): after the run terminates, replay its bearer against the
   gateway with curl. **Expect:** 401 (token expired with the run).
5. A plain interactive (non-workflow) session still sees its normal
   account-based tools — no regression in the existing grant path.

### Final acceptance — the mock end-to-end (after E)

Seed the issues service (or its stub) with fake Sentry + support items. Point a
real poll trigger (5-min interval) at `/poll/new-issues` with the triage
workflow (granted the narrow tool set), and one at `/poll/triaged-issues` with
a fix workflow (wide set) whose last steps are `agent.emit` → `notify(slack)`.
**Expect:** items flow new→triaged→awaiting-merge with claims/dedup visible in
the service's `events`; duplicate poll deliveries produce zero duplicate runs;
Slack pings arrive with emitted fields filled in; every state transition in the
service was made through gateway tool calls attributable to a run. That
demonstration — poll + functions + emit + chaining + Slack, on the real
contracts — is the definition of done for this arc.

---

*Written 2026-07-07 against worktree `workflows/ui-round3` (tip `768a309c7`).
The previous as-built content of this file is superseded by
[`workflows-deep-dive.md`](workflows-deep-dive.md), which remains the
current-state reference and is updated in the same PR as every code change
(L13). After annotation, this doc commits with PR A.*
