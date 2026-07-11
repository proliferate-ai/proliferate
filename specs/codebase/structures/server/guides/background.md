# Background Work

Status: authoritative for non-HTTP background work — the Celery substrate under
`server/proliferate/background/**` and the worker-facing service logic under
`server/<domain>/**` that tasks call.

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

There are no bespoke `while True` loops and no per-domain worker processes in
the target. A scheduler is a Beat-fired task that polls due work and writes run
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
| **Prepared external effect** | `server/<domain>/worker/effects.py` when needed | a DB-free function that receives an immutable prepared payload, calls the owning integration boundary, and returns a typed result |

`background/**` is plumbing. It knows how to run a task, when to fire periodic
ones, and how to turn a committed outbox row into a dispatched task. It owns no
business logic. A task module is a thin wrapper: it opens a database session at
the task boundary, calls the owning domain's public service, and maps failures
to retries. For multi-phase I/O it closes that session, calls the domain's
prepared-effect adapter, and opens a new session for the apply service.

`server/<domain>/**` owns the work itself. A task for a domain calls that
domain's service exactly as an HTTP handler would. The service follows the same
layer law as API-facing code: it takes `db: AsyncSession`, never commits, never
imports SQLAlchemy or constructs vendor clients, and calls store functions for
data and integrations through their public API.

## Axes

Route any background concern with two questions:

```text
request-driven HTTP claim/lease by an external process  -> not background; an API near api.py
fires on a clock                                         -> Beat-fired periodic task
fires because a committed state change needs follow-up   -> outbox relay task
```

And place the work it runs:

```text
the task wrapper itself (open session, call service)    -> background/tasks/<area>.py
worker-facing orchestration (pick due, dispatch, record) -> server/<domain>/worker/service.py
pure computation shared with HTTP paths                  -> server/<domain>/domain/
prepared network effect, with no DB/session              -> server/<domain>/worker/effects.py
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
    <area>.py          # thin @app.task wrappers; open session; call domain service

server/<domain>/
  service.py           # API-facing and, when modest, worker-facing orchestration
  domain/
    <concern>.py       # pure logic shared by API and background paths
  worker/              # only when worker-facing orchestration is substantial
    service.py         # pick due work, dispatch, record results, handle failures
    effects.py         # optional DB-free prepared external effect adapter
```

A domain that runs background work owns at most a `worker/service.py`, an
optional `worker/effects.py`, and shared `domain/` logic. It does not own a
process entry point, a scheduler, or a reconciliation loop — those are the
substrate's job (Beat) or do not exist (one process is the Celery worker fleet).

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

## Multi-phase external I/O tasks

A task that calls a sandbox, runtime, poll endpoint, integration, or other
network service must not hold a database transaction open across that call. The
task still owns every commit, but it uses multiple short transactions around the
external effect:

```text
task transaction 1
  domain service claims/prepares durable effect identity
  task commits

external I/O
  no database session or transaction held

task transaction 2
  domain service applies result with generation/idempotency CAS
  task commits
```

The service remains commit-free in both phases. It exposes explicit
`prepare`/`claim` and `apply`/`reconcile` functions. Prepare returns an immutable,
secret-minimized effect payload or opaque identity. The task closes the database
session, calls the owning domain's DB-free
`worker/effects.py::perform_prepared_effect(payload)`, opens a new session, and
applies the typed result. The effect adapter—not the task—uses the approved
integration/vendor boundary; it contains no SQL or workflow cursor logic. A
crash before I/O leaves retryable prepared state. A crash after I/O is recovered
by querying the external identifier or replaying with the same idempotency key;
if neither is possible it records `outcome_uncertain` and never invents a second
effect.

Workflow cloud delivery, server actions, and polling use this pattern. A local
workflow run row committed as `ready` is immediately claimable through its HTTP
API and needs no outbox action merely to expose it. Optional best-effort wakeups
may happen after commit but are not part of correctness.

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
- Imports: `db/store` (the outbox store), `celery_app`, task references.
- Is the only `background/` module that touches a store, and it touches only the
  outbox store. It carries no domain logic — it routes a row to a task by kind.

## `background/tasks/<area>.py`

Thin task wrappers — the boundary between the broker and a domain.

- Owns: the `@app.task` function, database session boundaries, calls into the
  owning domain's public service/prepared-effect adapter, and the mapping of
  failures to retries.
- Imports: `celery_app`, the owning domain's service and optional public
  prepared-effect adapter, and the session factory.
- Never holds: business logic, SQLAlchemy queries or ORM imports, or raw vendor
  clients. A task that grows logic has put it in the wrong layer — push it into
  the domain's service, `domain/`, or prepared-effect adapter as appropriate.

```python
# Transaction-only example: materialize_due_rows performs no external I/O.
# A multi-phase task follows the prepare -> close -> effect -> apply shape above.
@app.task(bind=True, max_retries=5)
def materialize_due_rows(self, scan_id: str) -> None:
    async def _run() -> None:
        async with async_session_factory() as db:
            async with db.begin():
                await area_worker_service.materialize_due_rows(db, scan_id=UUID(scan_id))
    asyncio.run(_run())
```

## `server/<domain>/worker/service.py`

The worker-facing orchestration a task calls — present only when it is
substantial and distinct from the API-facing service.

- Owns: picking due work, preparing immutable effect payloads, recording typed
  results, and handling failures, as ordinary service functions.
- Imports: `db/store`, `domain/`, and integration metadata through public APIs;
  it does not perform the prepared network call inside a transaction.
- Same layer law as any service: takes `db: AsyncSession`, never commits (the
  task owns the transaction boundary), never imports SQLAlchemy, never
  constructs vendor clients.

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
  only `relay.py` touches a store (the outbox store).
- No task module imports ORM or constructs vendor clients; it opens a session at
  the boundary and threads `db` through the normal service/store layers.
- No database transaction spans external network I/O. Multi-phase tasks use
  short task-owned transactions, commit-free prepare/apply service methods, and
  the owning domain's DB-free prepared-effect adapter.

## Smells

- a `while True` reconciliation loop or a `worker.py` process entry point → it is
  the old model; the loop is a Beat-fired task and the process is the Celery fleet
- business logic, a store call, or a vendor client inside `background/tasks/**` →
  push it into the owning domain's service or DB-free prepared-effect adapter
- `asyncio.create_task(...)` for work that must not be lost → use the outbox
- a `scheduler.py` holding a loop body → Beat owns the schedule; the schedule is
  data in `beat_schedule.py`
- two `service.py` files at the same nesting → keep one API-facing service, or
  promote the worker-facing one into `worker/service.py`
- a `background/` module reaching into a domain's internals → route by task kind;
  the domain's public service owns the work
