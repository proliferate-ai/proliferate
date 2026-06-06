# Worker Tier Migration Catalog + Mental Model

Status: live tracker for the in-flight worker-tier migration — transitional by
design. Companion to `worker-tier-scalability-rfc.md`; first-slice decisions are
ratified in `worker-tier-durable-jobs-ratification.md`. The authoritative
end-state (where this all lands) is
`specs/codebase/structures/server/guides/background.md` — one execution model, two
triggers (Beat / outbox relay). This doc is the bridge from current code to that
end-state and is retired once the migration completes.

## Mental Model: Four Archetypes

Every piece of background / async-shaped work is exactly one of these. The
archetype decides what it *becomes* in the new system.

| Archetype | Shape | Question it answers | Target in new system |
| --- | --- | --- | --- |
| **Scheduler** | poll on a clock | "what's due *now*?" | a **Beat-fired periodic task** (no bespoke loop) that polls due work and materializes runs + outbox rows; does not execute. HA via `redbeat`. |
| **Reconciler** | periodic idempotent pass | "expected vs actual — fix the gap" | a **Beat-fired periodic task**; survives only for *external-truth* drift; enqueues heavy corrective work as on-demand tasks. The broker absorbs internal-loss cases, so this set shrinks. |
| **Task** | a discrete unit of work | "run this one job" | a **Celery task** fired by the outbox relay; idempotent on a job id; retried; observable. |
| **Control-plane API** | request-driven HTTP | "an *external* process wants to claim/heartbeat/report" | **not a worker** — stays an external-pull API (Postgres-backed claim/lease). Out of scope for Celery. |

**Unified implementation.** In Celery there is one unit — the task — and only
the *trigger* differs: **Beat** fires the periodic ones (scheduler poll,
surviving reconciler passes, telemetry); the **outbox relay** fires the
on-demand ones (execution). So *scheduler* and *reconciler* are not bespoke
`while True` loops in the target — they are periodic tasks. See the RFC's "Code
Structure" for the `background/` layout, `beat_schedule.py`, and a reference
`tasks.py`.

Two cross-cutting facts the sweep revealed:

- **The in-process problem.** Five reconcilers + the telemetry sender run as
  `asyncio` tasks *inside the API server process* (started from the FastAPI
  lifespan). They compete with request handling, can't scale independently, and
  die/restart with the API.
- **The fire-and-forget problem.** Several request paths spawn
  `asyncio.create_task(...)` with **no durability** — lost on restart, no
  retry, no backpressure, no visibility. Some after-commit callbacks also
  dispatch with `loop.create_task(...)`, which has the same process-lifetime
  risk once the commit has succeeded. These are the sharpest "jobs lost" risk
  in the codebase.

## Migration Status (live)

Last verified against `main`: 2026-06-06.

**Infrastructure — done.**

- **Slice 1 (skeleton):** `background/{celery_app,config,beat_schedule,relay}.py`,
  `background/tasks/**`, and a health no-op task all exist.
- **Slice 2 (outbox foundation):** `db/store/background_outbox.py` plus the
  `background_outbox_task` migration; the relay claims, publishes, and marks
  outbox rows; the `automation_execution_outbox_backfill` migration is in.

**Done — cut over.**

- **2 Automations cloud executor** — broker-delivered via outbox → relay →
  `automations.execute_run`; the stage pipeline runs as the task body; backfill
  migration landed.
- **8 Support tracker** — Beat-fired `support.reconcile_tracker` (wired in
  `beat_schedule.py`); `support/reconciler.py` is gone.
- **10 Runtime wake** — durable via
  `cloud/commands/wake.py::enqueue_managed_target_wake_outbox` → outbox →
  `runtime.wake_target` (covered by `test_runtime_config_wake_outbox`). A residual
  in-process `kick_off_managed_target_wake` helper in `wake.py` is left to retire.
- **12 Signup Slack** — after-commit enqueue via `celery_app.send_task` →
  `notifications.send_slack` (loose consistency, as classified).

**Pending — still old shape.**

- **1 Automations scheduler** — still a poll loop/process
  (`automations/worker/scheduler.py`); convert to Beat.
- **4 Billing**, **5 Setup monitor**, **6 Agent gateway**, **7 Mobility**,
  **9 Telemetry** — still in-process lifespan loops; convert to Beat-fired tasks.
- **11 Worktree cleanup**, **15 Workspace provisioning**, **16 Customer.io
  lifecycle** — still detached `create_task`; move to outbox / direct enqueue.
- **17 Support diagnostics kick** — the tracker reconcile is done (8); the
  immediate diagnostics kick is not yet on the broker.

**Unchanged by design.**

- **3 Local executor**, **13 Cloud command worker control** — external-pull
  control-plane APIs; stay on the Postgres claim/lease, never behind the broker.
- **14 Slack worker** — parked.

**Retirement condition.** Delete this catalog when every Pending item is Done and
the old loop / `create_task` files it indexes are gone. The authoritative
end-state then lives only in `guides/background.md`.

## Inventory

The table records state **at sweep time**; current per-item status is in
*Migration Status* above.

| # | Item | File(s) | Runs today | What it does | Durability gap | Archetype → target |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Automations scheduler | `automations/worker/scheduler.py`, `worker/service.py` | separate process | poll due automations (RRULE) → create run rows + advance `next_run_at` | OK (DB-backed) | **Scheduler** — keep poll; dedicated proc; HA |
| 2 | Automations cloud executor | `automations/worker/cloud_executor*.py`, `cloud_execution/**` | separate process | claim pending runs → run stage pipeline (target→git→workspace→env→session→prompt) | claim/lease; DB-as-queue polling load | **Task** — broker-delivered, idempotent on `run_id` — **PRIORITY** |
| 3 | Automations local executor | `automations/local_executor.py` | API (request-driven) | external **desktop** executors claim/heartbeat/record local runs | n/a (it's an API) | **Control-plane API** — stays API-facing |
| 4 | Billing reconciler | `billing/reconciler.py` | in-process (lifespan) | reconcile usage segments, provider state, quota/spend enforcement | idempotent loop, but in API process | **Reconciler** — Beat-fired task; enqueue corrective work |
| 5 | Cloud setup monitor | `cloud/runtime/setup_monitor.py` | in-process (lifespan) | claim + poll remote AnyHarness setup runs; finalize/timeout | idempotent; in API process; tightly coupled (audit-flagged) | **Reconciler** — Beat-fired task after careful extraction |
| 6 | Agent gateway reconciler | `cloud/agent_auth/reconciler.py`, `reconciliation.py`, `worker_*.py`, `budget_reconciliation.py` | in-process (lifespan) | reconcile agent-auth gateway router state, budgets, materialization | idempotent; in API process | **Reconciler** — Beat-fired task |
| 7 | Mobility cleanup reconciler | `cloud/mobility/reconciler.py`, `cleanup_executor.py` | in-process (lifespan) | find due cleanup items → execute per-item (own session each) | idempotent; in API process | **Reconciler** (poll) + per-item exec → **Task** candidate |
| 8 | Support tracker reconciler | `support/reconciler.py` | in-process (lifespan) | reconcile support report tracking | idempotent; in API process | **Reconciler** — Beat-fired task |
| 9 | Anonymous telemetry sender | `anonymous_telemetry/worker.py` | in-process (lifespan) | periodic batched send of anonymous telemetry | in API process | **Scheduler/periodic Task** — Beat-fired task |
| 10 | Runtime wake jobs | `cloud/runtime/wake.py` | **fire-and-forget `create_task`** in request path | wake a managed target runtime for a command | ⚠️ no durability/retry; lost on restart | **Task** — durable queued — **Tier 1** |
| 11 | Deferred worktree cleanup | `cloud/runtime/config_sync/worktree_policy.py` | **fire-and-forget `create_task`** | deferred cleanup after worktree policy sync | ⚠️ no durability/retry | **Task** — durable queued — **Tier 1** |
| 12 | Signup Slack notification | `notifications.py` (`schedule_signup_slack_notification`) | **fire-and-forget `create_task`** | send signup Slack notification | ⚠️ no durability/retry; lost on restart | **Task** — durable queued — **Tier 1** (loose consistency OK) |
| 13 | Cloud command worker control | `cloud/worker/**` (`api.py`, `control/`, `service.py`, `transactions.py`) | API (request-driven) | external runtime workers claim cloud commands, heartbeat, and report progress | n/a (it's an API) | **Control-plane API** — stays; decide later if dispatch moves to broker |
| 14 | Slack bot worker (parked) | `cloud/slack/worker/**` | disabled | deferred Slack event/command/outbound/post-session handlers | parked | **Deferred** — revisit on revive |
| 15 | Cloud workspace provisioning | `cloud/runtime/scheduler.py`, `cloud/runtime/provision.py`, `cloud/workspaces/service.py` | **fire-and-forget `create_task`** in workspace paths | provision/start cloud workspaces and update workspace state | ⚠️ long-lived work lost on API restart | **Task** — durable queued — **Tier 1** |
| 16 | Customer.io desktop-auth side effects | `auth/desktop/service.py`, `auth/identity/service.py` | **fire-and-forget `create_task`** after desktop auth | identify/track/welcome-email Customer.io user events | ⚠️ no durability/retry; duplicate external effects need keys | **Task** — durable queued — **Tier 1** (loose consistency with idempotency keys) |
| 17 | Support diagnostics and immediate tracker kicks | `support/jobs.py`, `support/api.py`, `support/service.py`, `db/engine.py` | after-commit callback dispatched via `loop.create_task(...)` | collect support diagnostics and kick support tracking promptly | ⚠️ committed state may not get its follow-up work on restart | **Task** — durable queued or Beat-backed reconciler — **Tier 1** |

## Automations Deep-Dive (the priority)

Today automations is three pieces:

1. **Scheduler** (`worker/scheduler.py` → `run_scheduler_tick`): polls due
   automations via RRULE, creates run rows, advances `next_run_at`. → **stays a
   poll**, runs in a dedicated process, made HA.
2. **Cloud executor** (`worker/cloud_executor*.py` + `cloud_execution/`): claims
   pending runs and drives the **stage pipeline** (`resolve_target →
   git_identity → workspace → environment → session → prompt`), with
   claim-stale checks between stages. → **becomes the Celery task**: the run is
   delivered by the broker, the task body runs the pipeline, idempotent on
   `run_id`; the claim/lease is replaced by RabbitMQ acks + idempotency.
3. **Local executor** (`local_executor.py`): the **external desktop** executor
   API. → **stays an API**; not a Celery target.

Target flow:

```text
scheduler (poll) ─► create run row + outbox row (one txn) ─► relay ─► broker ─► task: run stage pipeline
```

Design decision to make: the stage pipeline is **one task** (runs all stages,
re-entrant on retry) vs a **Celery chain** (one task per stage). Fine-grained is
the stated preference, but a chain adds coordination cost and the inter-stage
cancellation semantics need care. Recommend: **one idempotent task per run** to
start (stages as internal steps), revisit a chain only if stage-level retry
isolation proves necessary.

## Migration Ordering (ratified)

- **Slice 1 — Infrastructure skeleton.** Add Celery/RabbitMQ/redbeat config,
  app wiring, and a no-op task. Do not move business work.
- **Slice 2 — Transactional outbox foundation.** Add outbox rows, store
  helpers, and relay semantics before correctness-sensitive on-demand work.
- **Tier 1 — Kill fire-and-forget/after-commit detached work (items 10–12,
  15–17).** Highest correctness risk (silent loss today), smallest/cleanest
  Celery conversions. Runtime wake (10), worktree cleanup (11), workspace
  provisioning (15), and support work that drives report state (17) want outbox
  consistency with their triggering state change; Slack (12) and Customer.io
  lifecycle events (16) are loose enough to enqueue directly when duplicate and
  missed delivery semantics are explicit.
- **Tier 0 periodic work — Convert, do not lift by default.** Items 4–9 should
  move to Beat-fired periodic tasks once the skeleton is ready. Dedicated
  bespoke loop processes are reserved for emergency production brakes.
- **Tier 2 — Migrate automations execution (item 2) to the broker.** The
  throughput win and the stated priority. Keep the scheduler (1) as a poll.
- **Tier 3 — Refine reconcilers.** Have the Beat-fired reconcilers *enqueue*
  corrective tasks instead of executing heavy work inline (item 7's per-item
  execution becomes tasks).
- **Out of scope (decide separately):** external-executor control-plane APIs
  (items 3, 13) and the parked Slack worker (14).

Dependency reminder: any **transactionally-consistent enqueue** (outbox) for
Tiers 1–2 is gated on explicit transaction ownership, because the outbox insert
must ride in the same caller-owned transaction as the state change. Tier 0
periodic work can move without an outbox when it calls an already-idempotent
pass function, but it still needs the Celery/redbeat skeleton first.

## Resolved Decisions

- **Reconcilers/schedulers become Beat-fired periodic tasks**, not bespoke
  loops or lifted loops. (See RFC "Unified Task Model".)
- **Reconcilers survive only for external-truth drift.** The broker (acks +
  retries + DLX) absorbs internal lost-work, which is what most current
  reconcilers compensate for. Billing keeps one; automations likely loses its
  reconciler entirely (the broker covers stuck runs).
- **Anonymous telemetry (9): a Beat-fired periodic task** — it's a simple "every
  N min, send the batch," exactly Beat's job; no lifted loop needed.
- **Stage pipeline (2): one idempotent task per run** (stages internal),
  revisit a Celery chain only if stage-level retry isolation proves necessary.
- **External executors keep the Postgres claim API (items 3, 13).** Do not back
  it with RabbitMQ: the broker is for connected consumers we push to, not for
  request/response HTTP pulls; claims/leases are a natural fit for DB rows.
- **Worker-control doorbells belong to the control-loop.** See
  `shared-redis-wake-ownership.md`: Celery tasks that change command/target/
  exposure/projection state publish through the existing worker-control
  after-commit path, but RabbitMQ does not become the cloud-worker command
  delivery channel.
- **The current process-local doorbell is not enough for Celery-origin
  mutations.** If a Celery worker changes worker-visible state, the PR must land
  shared Redis/NATS worker-control pub/sub first, or explicitly accept
  timeout-only wake behavior.

## Open Questions

1. Which queue/fleet runs the periodic (Beat-fired) tasks — a shared `periodic`
   lane, or per-weight-class lanes?
2. Which correctness-sensitive Tier 1 workload should move first after the
   skeleton and outbox foundation?
