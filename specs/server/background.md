# Background Work

Background work is everything the product does outside the request lifecycle:
periodic polls, drift reconciliation, and durable jobs triggered by a state
change. There is **one execution model** for all of it — a Celery task — and the
only thing that differs is the trigger.

## One unit, two triggers

Celery is the framework, RabbitMQ is the broker that delivers tasks to the
worker fleet, Postgres is the truth, and Redis holds the `redbeat` lock that
makes Beat highly available (Redis is a lock, never the broker). Every piece of
background work is the same unit — a **task** — and only the trigger differs:

| Trigger | Fires | For |
| --- | --- | --- |
| **Beat** (periodic) | on a clock, via `redbeat` | scheduler polls, surviving reconciler passes, batched telemetry |
| **Outbox relay** (on-demand) | when a committed state change demands follow-up work | execution jobs that must not be lost |

There are no bespoke `while True` loops and no per-domain worker processes. A
scheduler is a Beat-fired task that polls due work and writes run
rows plus outbox rows; it does not execute. A reconciler is a Beat-fired task
that survives only for **external-truth drift** and enqueues heavy corrective
work as on-demand tasks. A durable job is a task delivered by the relay,
idempotent on a job id, retried by the broker, and observable.

Work that is request-driven HTTP — an *external* process claiming, heartbeating,
or reporting against a Postgres-backed lease — is **not background work**. It is
an API. It stays near `api.py`/`service.py` in its domain and is never moved
behind Celery.

## Ownership

Two homes, split by a single boundary: substrate versus product logic.

| Concern | Lives in | Owns |
| --- | --- | --- |
| **Substrate** | `server/proliferate/background/**` | the Celery app, broker/queue/redbeat config, the Beat schedule registry, the outbox relay, and thin task modules |
| **Worker-facing logic** | `server/<domain>/**` | the service a task calls to do the domain's work, and the pure `domain/` logic it shares with HTTP paths |

`background/**` is plumbing. It knows how to run a task, when to fire periodic
ones, and how to turn a committed outbox row into a dispatched task. It owns no
business logic. A task module is a thin wrapper: it owns the database
engine/session boundary, calls the owning domain's public service, and maps
failures to retries.

`server/<domain>/**` owns the work itself. A task for a domain calls that
domain's service. The service follows the same layer law as API-facing code:
it never commits, imports SQLAlchemy query APIs, or constructs vendor clients,
and it calls store functions for data and integrations through their public
API. It normally takes `db: AsyncSession`. A worker service that alternates
bounded database phases with foreign I/O may instead take a task-created
session factory, open sessions only around store calls, and release them before
the external call.

## Axes

Route any background concern with two questions:

```text
request-driven HTTP claim/lease by an external process  -> not background; an API near api.py
fires on a clock                                         -> Beat-fired periodic task
fires because a committed state change needs follow-up   -> outbox relay task
```

And place the work it runs:

```text
the task wrapper itself (own DB boundary, call service) -> background/tasks/<area>.py
worker-facing orchestration (pick due, dispatch, record) -> server/<domain>/worker/service.py
pure computation shared with HTTP paths                  -> server/<domain>/domain/
```

A domain promotes `worker/` only when its worker-facing orchestration is
substantial and distinct from the API-facing service. Until then the task calls
the domain's ordinary `service.py`.

## Shape

```text
server/proliferate/background/
  celery_app.py        # the single Celery() app; task autodiscovery
  config.py            # broker, queues, routing, retry, redbeat, eager-test
  beat_schedule.py     # periodic registry: every X -> task Y (redbeat entries)
  relay.py             # outbox -> Celery: read committed rows, dispatch, mark relayed
  tasks/
    <area>.py          # thin @app.task wrappers; own DB boundary; call domain service

server/<domain>/
  service.py           # API-facing and, when modest, worker-facing orchestration
  domain/
    <concern>.py       # pure logic shared by API and background paths
  worker/              # only when worker-facing orchestration is substantial
    service.py         # pick due work, dispatch, record results, handle failures
```

A domain that runs background work owns at most a `worker/service.py` and shared
`domain/` logic. It does not own a process entry point, a scheduler, or a
reconciliation loop — those are the substrate's job (Beat) or do not exist (one
process is the Celery worker fleet).

The Cloud orphan-sandbox reaper is the concrete periodic example: Beat owns its
five-minute schedule, `background/tasks/cloud_sandboxes.py` only opens a session
and calls the domain, and `server/cloud/worker/` owns the advisory singleton,
provider attribution, grace window, and cleanup decisions.

## The outbox

On-demand jobs that must survive a restart use the **transactional outbox**. The
caller writes the state change and an outbox row in the **same caller-owned
transaction**; once that transaction commits, the job is guaranteed. The relay
reads committed outbox rows, dispatches the matching task, and marks the row
relayed. The broker then delivers, retries, and dead-letters.

```text
caller txn { state change + outbox row }  ->  commit  ->  relay  ->  broker  ->  task
```

This is the only correct way to enqueue work that must be consistent with a
state change. `asyncio.create_task(...)` and after-commit `loop.create_task(...)`
are not durable — they are lost on restart with no retry and no backpressure —
and are forbidden for work whose loss is a correctness bug. Loose,
fire-and-forget notifications with explicit at-most-once tolerance may enqueue a
task directly without the outbox, but the looseness must be deliberate.

**External-side-effect pattern (outbox):** a named orchestration function owns an
explicit multi-transaction sequence — write "pending" + commit → external call
(no open txn) → write result + commit — *or*, preferably, write the intent + an
outbox row and let a worker do the call.

Integration credential revocation is a current outbox consumer
(`integrations.revocation.process`): the revocation job row is written with the
intent, the outbox row rides the same transaction, and the worker's operation
is idempotent under broker redelivery.

## `background/celery_app.py`

The single Celery application every task and the relay import.

- Owns: the `Celery()` instance, task autodiscovery, and the shared app handle.
- Imports: `celery`, `background/config`.
- Never imports: domain services, `db/store`, or `integrations`. The app is
  substrate; it does not know what any task does.

## `background/config.py`

All broker and framework settings in one place.

- Owns: broker URL, result backend, queue and routing declarations, retry and
  dead-letter policy, `redbeat` settings, and the eager flag for tests.
- Imports: `config` (env-derived values), Celery config types.
- Never holds: business values. Product/protocol constants live in
  `constants/<area>.py`; env values live in `config.py`.

## `background/beat_schedule.py`

The periodic registry — the single list of what runs on a clock.

- Owns: `every X -> task Y` entries and their `redbeat` registration.
- Imports: task references by dotted path, scheduling constants.
- Never holds: a loop body or business logic. Beat fires tasks; the task does
  the work. There is no "scheduler loop" module — the schedule is data.

## `background/relay.py`

The bridge from the durable outbox to the broker.

- Owns: reading committed outbox rows, dispatching the matching task, and
  marking rows relayed; idempotent so a re-run never double-dispatches a job id.
- Imports: `db/store` (the outbox store and fixed-cardinality, read-only
  operational snapshots), `celery_app`, task references.
- Is the only `background/` module that touches a store. It carries no product
  mutation or routing policy beyond the supported task registry. Read-only
  operational snapshots may expose counts and ages only; they never expose
  identifiers, request payloads, responses, or credentials.

## `background/tasks/<area>.py`

Thin task wrappers — the boundary between the broker and a domain.

- Owns: the `@app.task` function, the database engine/session boundary, the call
  into the owning domain's public service, and the mapping of failures to
  retries. A synchronous task using `asyncio.run()` creates and disposes its
  engine inside that event-loop lifecycle rather than reusing a module-global
  async engine across firings.
- Imports: `celery_app`, the owning domain's service, and the session machinery.
- Never holds: business logic, SQLAlchemy queries or ORM imports, or raw vendor
  clients. A task that grows logic has put it in the wrong layer — push it into
  the domain's service or `domain/`.

```python
# background/tasks/cloud_sandboxes.py
async def _run_orphan_reap() -> None:
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            await run_orphan_sandbox_reap_pass(db)
    finally:
        await engine.dispose()
```

## `server/<domain>/worker/service.py`

The worker-facing orchestration a task calls — present only when it is
substantial and distinct from the API-facing service.

- Owns: picking due work, dispatching to the right execution, recording results,
  and handling failures, as ordinary service functions.
- Imports: `db/store`, `domain/`, `integrations` through their public API.
- Same layer law as any service: normally takes `db: AsyncSession`, never
  commits, never imports SQLAlchemy query APIs, and never constructs vendor
  clients. When foreign I/O must alternate with multiple bounded database
  phases, it may take the task-created `async_sessionmaker[AsyncSession]`, open
  sessions only around direct store calls, and release each before foreign I/O.
  The task creates and disposes the engine; the service cannot import settings
  or global engine helpers, construct an engine, issue SQL, or call session
  query/commit/rollback methods.

When the worker-facing surface is modest, these functions live in the domain's
ordinary `service.py` and there is no `worker/` subfolder. Two `service.py`
files at the same nesting are forbidden; promote to `worker/service.py` only when
worker-facing logic is genuinely separate from API-facing logic, and let both
share `domain/` and the stores.

## Rules

- One execution model: a Celery task. Beat fires the periodic ones; the outbox
  relay fires the on-demand ones. No bespoke loops, no per-domain processes.
- Substrate lives in `background/**`; the work a task performs lives in
  `server/<domain>/**`. `background/tasks/**` is thin and calls a domain service.
- Correctness-sensitive enqueue uses the outbox in the caller's transaction.
  Detached `asyncio.create_task` / after-commit `loop.create_task` is forbidden
  for work whose loss is a bug.
- Reconcilers survive only for external-truth drift and enqueue heavy corrective
  work as tasks; the broker's acks, retries, and dead-letters absorb
  internal-loss cases that bespoke reconcilers used to compensate for.
- Schedulers poll and materialize (run rows + outbox rows); they do not execute.
- External-process claim/heartbeat/report surfaces are APIs, not workers, and are
  never moved behind the broker. They stay near `api.py`/`service.py`.
- `background/**` imports no domain service except through a task module, and
  only `relay.py` touches stores (outbox writes plus read-only bounded
  operational snapshots).
- No task module imports ORM or constructs vendor clients. It owns the
  current-event-loop engine/session-factory lifetime and either opens the
  session itself or passes the factory to the narrow bounded worker-service
  pattern.

## Smells

- a `while True` reconciliation loop or a `worker.py` process entry point → it is
  the old model; the loop is a Beat-fired task and the process is the Celery fleet
- business logic, a store call, or a vendor client inside `background/tasks/**` →
  push it into the owning domain's service
- `asyncio.create_task(...)` for work that must not be lost → use the outbox
- a `scheduler.py` holding a loop body → Beat owns the schedule; the schedule is
  data in `beat_schedule.py`
- two `service.py` files at the same nesting → keep one API-facing service, or
  promote the worker-facing one into `worker/service.py`
- a `background/` module reaching into a domain's internals → route by task kind;
  the domain's public service owns the work

## Current gaps

Everything above this section is the current operating model, with each rule's
enforcement status stated inline where it is not mechanically checked. Each
unchecked item below is a concrete path that still departs from it — public debt,
not a softer version of the rule.

- [ ] **Billing reconciliation.**
      ``_billing_reconciler_loop`` (deleted, cull part 2)
      is started by `start_billing_reconciler` from the
      [`main.py` lifespan](../../server/proliferate/main.py) when
      `cloud_billing_mode` is `observe` or `enforce`;
      `run_background_workers` makes the starter a no-op. Each pass runs
      immediately, reports unexpected failures through `report_critical` and
      continues, then sleeps
      `max(BILLING_RECONCILE_INTERVAL_SECONDS, 30)` seconds. The
      [Billing contract](../FEATURE_DOCS/BILLING.md) describes the
      normal interval as fifteen minutes. Conversion is parked because ordinary
      self-host deployment does not run the Celery worker, Beat, or broker
      plane; moving this pass to Beat first would silently stop enforcement and
      reconciliation there.
- [ ] **Anonymous Server version telemetry.**
      [`_sender_loop`](../../server/proliferate/server/anonymous_telemetry/worker.py)
      is started by `start_server_anonymous_telemetry_sender` from the
      [`main.py` lifespan](../../server/proliferate/main.py) whenever
      anonymous telemetry is enabled. It is not gated by
      `run_background_workers`; it emits once immediately and then every 24
      hours, while failures are captured and logged and the loop continues.
      Conversion is parked for the same deployment-parity reason: self-host API
      installations currently emit this heartbeat without a Celery worker or
      Beat process, so a Beat-only move would silently remove it.
- [ ] **Agent Gateway enrollment backfill.**
      [`_backfill_loop`](../../server/proliferate/server/agent_auth/worker.py)
      is started by `start_agent_gateway_enrollment_backfill` from the
      [`main.py` lifespan](../../server/proliferate/main.py) when both
      Agent Gateway and `run_background_workers` are enabled. It runs
      immediately, catches unexpected failures, reports them through
      `report_critical`, and continues, then sleeps
      `agent_gateway_backfill_interval_seconds`. Conversion remains
      analysis-only until deployment parity, singleton and overlap behavior,
      the existing feature and worker gates, immediate-first-run cadence, and
      retry and replay behavior are characterized for a Beat-fired task.
- [ ] **Agent Gateway usage import.**
      [`_usage_import_loop`](../../server/proliferate/server/agent_auth/worker.py)
      is started by `start_agent_gateway_usage_import` from the
      [`main.py` lifespan](../../server/proliferate/main.py) under the
      same Agent Gateway and `run_background_workers` gates. It runs
      immediately, catches unexpected failures, reports them through
      `report_critical`, and continues, then sleeps
      `agent_gateway_usage_import_interval_seconds`. Conversion remains
      analysis-only until deployment parity, singleton and overlap behavior,
      the existing gates, immediate-first-run cadence, and retry and replay
      behavior are characterized for a Beat-fired task, including safe replay
      of LiteLLM spend-log paging and credit-exhaustion effects.
- [ ] **Agent Gateway LLM top-up.**
      [`_topup_loop`](../../server/proliferate/server/agent_auth/worker.py)
      is started by `start_agent_gateway_llm_topups` from the
      [`main.py` lifespan](../../server/proliferate/main.py) only when
      Agent Gateway, top-up configuration, and `run_background_workers` enable
      it. It runs immediately, catches unexpected failures, reports them
      through `report_critical`, and continues, then sleeps
      `agent_gateway_topup_interval_seconds`. Conversion remains analysis-only
      until deployment parity, singleton and overlap behavior, the existing
      gates, immediate-first-run cadence, retry and replay behavior for charge
      and top-up effects, and exact configuration parity are characterized for
      a Beat-fired task.
- [ ] **One-off health enqueue store client.**
      [`enqueue_health.py`](../../server/proliferate/background/enqueue_health.py)
      is a one-off deployment proof command, not a task or loop, but it writes
      directly through the background-outbox store. This is a concrete
      exception to the target body's rule that `relay.py` is the only
      `background/**` store client. It remains a placement and law gap; this
      documentation slice does not decide whether the utility moves or the
      target law later gains a narrow deployment exception.

Deployment evidence: the ordinary production self-host
[`docker-compose.production.yml`](../../server/deploy/docker-compose.production.yml)
defines the base API stack but no RabbitMQ, Celery worker, or Beat service. The
development [`docker-compose.yml`](../../server/docker-compose.yml)
makes `worker` and `beat` opt-in through the `background` profile.
[`run_background_workers`](../../server/proliferate/config.py) defaults
to true, and the current [`main.py` lifespan](../../server/proliferate/main.py)
keeps periodic work in the API process unless each starter's own gates disable
it.
