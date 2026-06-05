# RFC: Worker Tier Scalability — Broker-Backed Job System

Status: draft background and rationale. The executable first-slice decisions
are ratified in `worker-tier-durable-jobs-ratification.md`.

Owner: TBD. Drafted from the worker guide
(`specs/codebase/structures/server/guides/workers.md`), the two worker audits,
and the server structure hygiene handoff.

Shared Redis/wake ownership is ratified in
`specs/tbd/shared-redis-wake-ownership.md`. This RFC conforms to that decision:
the worker control-loop owns the worker-control doorbell, and worker-tier
durable jobs use RabbitMQ as the broker with Redis only for ancillary redbeat,
locks, and rate limits.

## 1. Context And Drivers

We are explicitly building for enterprise scale with a large influx of new
users. The current worker tier is a hand-rolled, Postgres-as-queue, polling
model: in-process `asyncio` loops started from the FastAPI lifespan
(`billing/reconciler.py`, `cloud/mobility/reconciler.py`,
`cloud/runtime/setup_monitor.py`) plus one separate-process, claim-based worker
(`automations/worker/`). This was a reasonable v1 but does not meet the
reliability, isolation, and throughput bar for enterprise multi-tenant load.

Migration *labor* is cheap (agent-executable). The expensive parts are (a) the
*design/semantics* (durability, idempotency, ordering) and (b) *verification*
under failure injection. The plan front-loads those.

### Observed pains (all four are biting)

| Pain | Class | Does a broker alone fix it? |
| --- | --- | --- |
| Postgres is the bottleneck (queue traffic, lock contention) | throughput | **Yes** — the genuine broker win. |
| Jobs run twice or get lost | delivery semantics | Only with durable acks **+ idempotent consumers + outbox**. |
| State drifts across tables/services | consistency | **No** — outbox + reconcilers. A naive broker makes it worse. |
| Scheduling unreliable (missed/dup runs) | scheduling | **No**, often worse — needs `redbeat`/leader election. |

Conclusion: "move to Celery" addresses ~1 of 4 pains and can regress
scheduling. The correct framing is **replace the hand-rolled worker tier with a
designed job system**, of which the broker is one component.

## 2. Decision: The Engine

Adopt the standard Celery enterprise topology (the user's "Redis + Celery +
RabbitMQ"). These are complementary, not alternatives:

| Piece | Role |
| --- | --- |
| **RabbitMQ** | the **broker** — durable, acked job delivery. Quorum queues for HA. |
| **Celery** | the **framework** — consumers, routing, priorities, retries, Beat. |
| **Redis** | the **ancillary store** — `redbeat` scheduler lock, rate limits, distributed locks. *Not* the broker. Result backend only if needed. |

Hard constraints:

- **RabbitMQ is the broker, not Redis.** Redis-as-broker can drop tasks under
  failure; that reintroduces the "jobs lost" pain.
- **Worker-control doorbells are not broker tasks.** The control-loop owns the
  lossy worker-control wake channel; Celery tasks that mutate worker-visible
  state bump Postgres control state and publish through the existing
  after-commit doorbell path.
- **Question the Redis result backend.** Jobs write outcomes to Postgres;
  Redis earns its place for `redbeat` + rate limiting, not results-by-default.

### Buy vs build

- **Adopt (never build):** the broker (RabbitMQ), the queue/retry/routing
  framework (Celery), the lock/rate store (Redis). Do **not** reimplement
  broker/queue primitives — that is the trap inside "build our own worker
  system."
- **Build (our actual work):** the transactional outbox + relay, idempotency
  keys on consumers, the retained reconcilers, the domain worker tier
  (refactored to dispatch via Celery instead of polling), and the
  observability + multi-tenant queue/priority policy.

## 3. Target Architecture

```text
state change ─┐
              ├─(one Postgres txn)─► state row + outbox row     [TRUTH: Postgres]
              ┘
                         │
                   outbox relay  ──publish──► RabbitMQ           [THROUGHPUT: broker]
                                                  │
                                          Celery workers
                                          (idempotent, keyed on job id)
                                                  │
                                          domain service layer ─► stores / integrations
                                                  ▲
                         reconcilers ─────────────┘              [RECOVERY: re-derive drift]
                         (retained; re-enqueue anything the happy path lost)

scheduling: redbeat / leader-elected Beat ──► enqueue via the same outbox path
```

Principle: **Postgres for truth, broker for throughput, reconcilers for
recovery, idempotency everywhere, a real scheduler for time.**

### Why each pain is cleared

- **Postgres bottleneck** → execution moves off the DB onto RabbitMQ workers.
- **Jobs lost/double** → outbox (no dual write) + RabbitMQ acks + idempotent
  consumers.
- **State drift** → outbox couples state+enqueue atomically; reconcilers re-derive.
- **Scheduling** → `redbeat`/leader election removes the single-point Beat risk.

### What does NOT change

- **External-truth reconcilers stay** (billing provider/usage, AnyHarness setup
  runs, gateway state). They are the correctness backstop for systems we do not
  control and that change without notifying us. The broker covers *internal*
  lost work, so reconcilers shrink to this irreducible external-drift core.
- **Existing claim/lease/fence primitives** (`automations` run claims,
  `cloud/worker` command leasing, `specs/codebase/primitives/claiming.md`) are
  reused for idempotency, not rebuilt.

### The Unified Task Model

In Celery there is one unit — the task. Only the **trigger** differs:

- **Periodic tasks** are fired by **Beat** on a clock: the scheduler poll
  ("what's due?"), the surviving reconciler passes ("what's drifted?"), and
  telemetry sends. A scheduler and a reconciler are *both just Beat-fired
  periodic tasks* — not bespoke `while True` loops.
- **On-demand tasks** are fired by the **outbox relay** when work is created:
  execute a run, wake a target runtime, send a notification.

So the four archetypes collapse in implementation terms: *scheduler* and
*reconciler* are periodic tasks; *executor* is an on-demand task; the
*control-plane API* stays an external-pull HTTP surface (not a task).

### Code Structure

```text
server/proliferate/background/
  celery_app.py        # the single Celery() app
  config.py            # broker, durability chain, task_routes, queues
  beat_schedule.py     # periodic triggers (scheduler tick, reconciler passes, telemetry)
  relay.py             # outbox → enqueue (on-demand triggers)
  tasks/
    automations/tasks.py   # schedule_due_runs (Beat) + execute_run (enqueued)
    billing/tasks.py       # reconcile_pass (Beat)
    cloud_runtime/tasks.py # wake_target (enqueued) + setup_reconcile_pass (Beat)

proliferate/server/<domain>/    # UNCHANGED: service.py + domain/ own all logic
```

`tasks/*` files are thin shells: each task opens its own session at entry,
threads `db` into a public service function, and is idempotent on its job id.
No business logic lives in a task.

`beat_schedule.py` — the periodic triggers:

```python
from celery.schedules import crontab

beat_schedule = {
    "automations-schedule-tick": {        # the scheduler poll
        "task": "automations.schedule_due_runs",
        "schedule": 15.0,
    },
    "billing-reconcile": {                # a surviving external-drift reconciler
        "task": "billing.reconcile_pass",
        "schedule": 60.0,
    },
    "anonymous-telemetry": {
        "task": "telemetry.send_anonymous_batch",
        "schedule": crontab(minute="*/5"),
    },
}
```

Reference `tasks/automations/tasks.py` — both trigger types, both thin shells:

```python
import asyncio

from proliferate.background.celery_app import app
from proliferate.db import engine
from proliferate.server.automations import service
from proliferate.server.automations.worker import service as worker_service


# PERIODIC — Beat fires this ~every 15s. The scheduler poll.
@app.task(name="automations.schedule_due_runs", acks_late=True)
def schedule_due_runs() -> None:
    asyncio.run(_schedule_due_runs())


async def _schedule_due_runs() -> None:
    async with engine.async_session_factory() as db, db.begin():
        await worker_service.run_scheduler_tick(db)   # creates run rows + outbox rows


# ON-DEMAND — the relay fires this per pending run. The executor.
@app.task(
    name="automations.execute_run",
    bind=True,
    acks_late=True,
    max_retries=5,
    retry_backoff=True,
)
def execute_run(self, run_id: str) -> None:
    asyncio.run(_execute_run(run_id))                 # idempotent on run_id


async def _execute_run(run_id: str) -> None:
    async with engine.async_session_factory() as db, db.begin():
        await service.execute_run(db, run_id=run_id)  # stage pipeline lives in service
```

The scheduler tick writes runs + outbox rows in one transaction; the relay
later reads committed outbox rows and calls `execute_run.delay(run_id)`. That
keeps the enqueue transactionally consistent with run creation (no dual write).

## 4. The Hard Prerequisite (Sequencing Constraint)

**The transactional outbox is gated on caller-owned transactions.** A correct
outbox writes the state row and the outbox row in one commit. Today many stores
self-open sessions and commit internally — hygiene baseline:
`STORE_SESSION_FACTORY_CALL` 90, `STORE_COMMIT_ROLLBACK` 59 across 16 stores.
Both worker audits (billing, cloud-runtime) explicitly defer worker refactoring
until stores accept an explicit `db: AsyncSession`.

Therefore: **the consistency half of this RFC depends on Swarm 2 (Database
Session Threading) and Swarm 3 (Service Boundary Cleanup) from the server
structure hygiene plan.** Building the outbox before stores stop self-committing
means building it on quicksand. This is the single most important sequencing
fact in this document.

The transaction-ownership decision is already on the books (hygiene "Alignment
Decisions"): transaction boundaries belong at API, worker, or named
orchestration entry points, never in `db/store/**`. The outbox relay and
enqueue are exactly such a named orchestration boundary.

## 5. Integration Reality: Celery + async SQLAlchemy

Celery workers are sync (prefork); our stack is async SQLAlchemy. Decide up
front rather than discovering it:

- **Recommended:** prefork workers, `asyncio.run(...)` per task to drive the
  existing async service layer. Simple, proven, modest per-task overhead.
- Alternatives (gevent/thread pools, sync sessions in workers) add complexity
  for narrow benefit. Defer unless profiling demands it.

## 6. Phased Plan

The ratified first implementation order is in
`worker-tier-durable-jobs-ratification.md`. Each phase below is
behavior-preserving and independently shippable. Broker-delivered domain work
that needs state/enqueue atomicity depends on explicit transaction ownership for
that path.

- **Phase 0 — Decisions + harness.** Ratify this RFC through the companion
  ratification doc. Capture current job volumes and latency requirements. Stand
  up the failure-injection verification harness (Section 7) before real work
  moves.
- **Phase 1 — Celery/RabbitMQ/redbeat skeleton.** Add the
  `server/proliferate/background/**` package, configuration, queue routing,
  local/dev documentation, and a no-op task. This phase must not move business
  work.
- **Phase 2 — Transactional outbox foundation.** Add the outbox table, store
  helpers, relay shell, idempotent publication semantics, and crash/duplicate
  tests. The relay may publish only no-op or test tasks until a real domain
  path is ready.
- **Phase 3 — One low-risk direct enqueue.** Move a loose-consistency
  notification or Customer.io lifecycle side effect to prove worker deployment
  without pretending it provides state/enqueue atomicity.
- **Phase 4 — One correctness-sensitive outbox path.** Move one fire-and-forget
  path, such as runtime wake or workspace provisioning, behind the outbox after
  that path has explicit transaction ownership. If the task mutates
  worker-visible state, land distributed worker-control pub/sub first or accept
  timeout-only wakes explicitly.
- **Phase 5 — Periodic work to Beat.** Move FastAPI-lifespan reconcilers and
  telemetry to Beat-fired periodic tasks. Do not lift them to bespoke loop
  processes by default.
- **Phase 6 — Automations execution.** Move cloud automation execution to one
  idempotent task per run. Keep the scheduler poll and local executor API
  separate.
- **Phase 7 — Enterprise hardening.** Per-workload queues, priorities, rate
  limits, Flower/Sentry observability, and measured queue/fleet split changes.

## 7. Verification (the part agents do NOT make cheap)

Every phase that touches delivery must pass failure injection before it is
trusted:

- Kill a worker mid-task → job is retried, effect happens exactly once.
- Crash between state commit and broker publish → outbox relay re-publishes;
  no lost job.
- Duplicate delivery → idempotency key makes the second run a no-op.
- Broker partition/outage → outbox buffers; recovery drains without loss.
- Scheduler failover → no missed and no duplicated scheduled runs.
- Reconciler re-derivation → orphaned/drifted work is re-enqueued.

Plus the standing server checks: `scripts/check_server_boundaries.py`,
`scripts/check_max_lines.py`, and focused pytest for each touched domain.

## 8. Risks And Non-Goals

- **Do not** start Phase 2 before the relevant stores are explicit-session
  capable. (Hard dependency, Section 4.)
- **Do not** use Redis as the Celery broker for durable work.
- **Do not** delete the reconcilers; they are the recovery layer.
- **Do not** big-bang. One workload at a time, behind the outbox, verified.
- **Non-goal:** rebuilding broker/queue primitives ("build our own" means the
  domain tier on top of Celery, not a new Celery).
- **Non-goal:** changing accounting/billing, command fencing, or runtime
  lifecycle semantics during the move.

## 9. Decisions Ratified For The First Slice

See `worker-tier-durable-jobs-ratification.md` for the binding first-slice
plan. In short:

- RabbitMQ is the Celery broker.
- Redis is ancillary for redbeat, locks, rate limits, and metrics.
- Redbeat is the initial scheduler-HA choice.
- No Redis result backend by default.
- Celery tasks are prefork sync shells that call the existing async service
  layer with `asyncio.run(...)`.
- Outbox-backed domain work waits for caller-owned transaction boundaries.
- Do not add temporary dedicated-loop processes unless there is an emergency
  production brake with a rollback plan.

## 10. Open Decisions For Later Slices

1. First correctness-sensitive workload after the skeleton/outbox slices
   (proposed: runtime wake).
2. When, if ever, automations should graduate from one task per run to a Celery
   chain.
3. Sequencing with the active hygiene swarms — does the worker migration get
   its own swarm after Swarm 2/3, or fold into Swarm 7 (workspaces/commands/
   worker control)?
