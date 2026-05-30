# Workers

Status: provisional but authoritative for current background-job cleanup.

Read after `docs/structures/server/README.md`. This guide details how non-HTTP entry
points are organized, how worker-side logic relates to HTTP-side logic, and
when a worker subfolder is earned.

This guide is intentionally modest. Proliferate does not yet have a robust
worker framework, queue abstraction, or broad scheduler system. Do not use this
guide as permission to invent one. It exists to keep the background jobs we
already have from mixing entrypoint code, service orchestration, store access,
and pure logic in the same files.

Default to the simplest shape that keeps ownership clear:

- a thin `worker.py` or `reconciler.py` when one file is enough
- normal `service.py` functions for orchestration
- `domain/` for pure computation shared with HTTP paths
- `worker/` only when worker-only logic has multiple real concerns

## Ownership

A worker is a non-HTTP entry point that runs domain work outside the request
lifecycle. Common shapes:

- **Process entry points** — `worker.py` files run as separate processes,
  with `main()`, argparse, and signal handlers.
- **Reconciliation loops** — `reconciler.py` periodically compares expected
  vs actual state and fixes drift.
- **Scheduled jobs** — when present, `scheduler.py` declares schedules or the
  scheduler loop body. Do not add a scheduler layer unless an existing job
  genuinely needs it.
- **Queue handlers** — process messages from a queue.

Worker code follows the same layer law as HTTP code:

- Worker entry points call services. They don't run business logic
  themselves.
- Worker entry points and reconciliation loops don't import ORM directly.
  They call services; worker-facing services call store functions.
- Worker entry points don't construct vendor clients. Worker services or
  executors call integrations through their public API.

## Folder Shape

### Default: sibling files at the domain root

For a domain with one or two background-shape files:

```text
server/<domain>/
  api.py
  service.py
  models.py
  worker.py            # process entry point
  reconciler.py        # reconciliation loop (when applicable)
```

The worker calls service functions. Service is the shared orchestration
layer between API and worker.

### Promoted: `worker/` subfolder

When worker-side logic is substantial and distinct from HTTP-side work:

```text
server/<domain>/
  api.py
  service.py             # API-facing service
  models.py              # API schemas
  domain/                # pure logic shared between API and worker
    policy.py
    <concern>.py
  worker/                # worker surface
    main.py              # process entry: argparse, signals, async loop
    service.py           # worker-facing service
    scheduler.py         # scheduler loop body (if applicable)
    <executor>.py        # alternative implementations of the worker's work
    <concern>.py
```

The trigger: substantial worker-only logic that already does not fit cleanly
in `service.py`. Multiple files, distinct concerns, and hundreds of lines that
aren't API-facing. Do not create `worker/` preemptively for a thin loop.

When the worker subfolder is promoted:

- Two `service.py` files coexist — one at the parent (API-facing), one in
  `worker/` (worker-facing). They share `domain/` and stores.
- `domain/` and stores stay at the parent level. They're shared.
- The parent's `service.py` may shrink because some shared work moves to
  `domain/`.

## File Roles

### `worker.py` (or `worker/main.py`)

Process entry point. Loads config, parses args, sets up signal handlers,
runs the async event loop.

Allowed:

- `main()` function and module-level CLI parsing (`argparse`).
- Signal handler registration.
- Async event loop setup (`asyncio.run`, `loop.create_task`).
- Top-level structured logging configuration.
- Calls to `service.py` (API-facing or worker-facing).

Banned:

- Business logic. Loop bodies belong in `service.py` or named modules.
- ORM imports.
- Direct vendor client construction.
- Long handler functions. Keep `main` thin.

### `reconciler.py`

A specific kind of worker that reads expected state, reads actual state,
computes drift, and takes corrective action on a periodic loop.

Allowed:

- The reconciliation loop structure (`while True: await pass()`).
- Loop lifecycle: `start_*_reconciler`, `stop_*_reconciler`.
- Calls to service functions.
- A pass function that does one round of reconciliation.

Banned:

- Multiple distinct reconciliation flows in one file. Promote to
  `worker/<name>_reconciler.py` siblings.
- Substantial business logic inside the loop body. Extract to `service.py`.
- ORM imports.

### `scheduler.py`

Declares schedules. No business logic. Just a registry of what runs when.

Two shapes:

- **Domain-root scheduler** (`server/<domain>/scheduler.py`) — schedule
  registration for a single domain.
- **Inside `worker/`** (`server/<domain>/worker/scheduler.py`) — the
  scheduler loop body that picks due work and dispatches.

The two are different. The first is a list of "every X, run Y." The second
is the running loop that fires the dispatchers.

Allowed in either:

- Cron expressions or interval declarations.
- Mappings from schedule names to handler functions in service.

Banned:

- Business logic.
- ORM imports.
- Side effects on import.

### `<executor>.py` (in `worker/`)

Alternative implementations of "do the worker's work" that run inside the
server-side worker process. Two implementations of the same conceptual job
live as siblings in `worker/` only when both are worker-process
implementations.

An HTTP service used by an external executor to claim work, heartbeat, or
record progress is not a `worker/` executor. It is API-facing service code,
even if the caller is a worker process outside the server. Keep that surface
near `api.py` / parent `service.py` unless it earns its own subdomain.

Allowed:

- The implementation's own setup, dependencies, and execution.
- Calls to integrations and services.

Banned:

- Sharing implementation between executors via inheritance. If two
  executors share logic, extract to `worker/<shared>.py` or `domain/`.
- HTTP routes. Workers are not HTTP-facing.
- The `_service` suffix in the filename. Files are `cloud_executor.py`, not
  `cloud_executor_service.py`.

## Worker-Side Service Decomposition

When a domain has the worker subfolder pattern, both `service.py` files are
real services with the same layer law (no ORM imports, call store
functions). They differ in surface:

- **Parent `service.py`** — called by `api.py`. CRUD on resources, read APIs,
  request-driven mutations.
- **`worker/service.py`** — called by `worker/main.py`. Pick work, dispatch
  to an executor, record results, handle failures.

They share:

- `domain/` for pure logic (recurrence parsing, policy rules).
- `db/store/<resource>.py` for data access.
- Error types in the parent's `errors.py`.

Worker-side service functions still take `db: AsyncSession` and never
commit. The worker's `main.py` opens the session at the entry point and
threads it through:

```python
# server/<domain>/worker/main.py
async def main_loop() -> None:
    async with async_session_factory() as db:
        async with db.begin():
            await service.process_due_work(db)
        # commits on context exit
```

## Multiple Workers in One Domain

When a domain has multiple distinct background flows:

```text
server/billing/
  worker/
    main.py
    service.py
    seat_reconciler.py
    usage_reconciler.py
    stripe_event_worker.py
```

Each `<flow>.py` is its own focused module under `worker/`. They share
`worker/service.py` for common orchestration and the parent's `domain/` for
pure logic.

If a single `main.py` runs all of them in one process, that's fine. If
they're separate processes, each has its own entry point file in `worker/`.

## When NOT to Use the `worker/` Subfolder

- **The worker is just a thin loop calling one service function.** Keep
  `worker.py` at the parent. No subfolder.
- **The worker logic is < 200 lines total.** Keep flat.
- **There's no real distinction between API-side and worker-side work.** One
  `service.py` is enough.
- **You are creating the first background path for a domain.** Start with the
  flat shape unless the first implementation already has multiple executor or
  reconciliation concerns.

The trigger is *substantial worker-only logic that doesn't naturally fit in
`service.py`*. Without that, a sibling `worker.py` is enough.

## Representative Promoted Shape

A domain earns `worker/` when worker-side work has multiple real concerns:
process entry, scheduler loop, worker-facing orchestration, and one or more
server-side executors. The promoted shape should separate API-facing
operations from worker-process operations.

### Today (transitional)

```text
server/<domain>/
  api.py
  service.py                    # API-facing service
  models.py
  worker.py                     # process entry point
  schedule.py                   # pure recurrence logic in the wrong layer
  cloud_executor.py             # worker-process executor implementation
  <external_executor_surface>.py # API-facing surface for an external executor
```

Issues:

- Pure parsing logic belongs in `domain/`, not at the worker-shaped layer.
- Worker-process executors and scheduler logic sit alongside API-facing
  service code with no organizational separation.
- API-facing services for external executors must not be mistaken for
  server-side worker executors.

### Target

```text
server/<domain>/
  api.py                         # API routes
  service.py                     # API-facing service
  models.py                      # Pydantic API schemas
  <external_executor_surface>.py # API-facing external-executor surface
  domain/                        # pure logic shared by API and worker
    recurrence.py
    policy.py
  worker/                        # server-side worker process surface
    main.py                      # process entry: argparse, signals, async loop
    service.py                   # pick due, dispatch, record failures
    scheduler.py                 # scheduler loop body
    cloud_executor.py            # server-side executor implementation
```

What lives where:

- `domain/recurrence.py` is pure parsing and occurrence math, no I/O. Used by
  both worker and API paths.
- `worker/scheduler.py` is the loop body that finds due work, then dispatches
  via `worker/service.py`.
- `worker/service.py` orchestrates the worker side: pick next due, dispatch
  to executor, record result, handle failures.
- `worker/<executor>.py` files are server-side implementations of work.
- API-facing external-executor services remain outside `worker/` because they
  are request-driven surfaces, not worker-process implementation code.

The parent `service.py` remains API-facing. Worker-process concerns move into
`worker/`; external-executor HTTP surfaces stay API-facing.

## Forbidden Patterns

- Pure parsing or computation logic in worker-shaped files
  (`worker.py`, `scheduler.py`, `reconciler.py`). That's `domain/` work.
- Substantial business logic inside `worker.py`'s loop body. The body calls
  `service.py`.
- Multiple server-side "executor" or "runner" sibling files at the parent
  domain level. Promote to `worker/` once you have the pattern.
- The `_service` suffix on any worker-adjacent file. Files are `worker.py`,
  `reconciler.py`, `<name>_executor.py`, never `*_service.py`.
- ORM imports in worker entry points, reconcilers, schedulers, or executors.
  They call services; worker-facing services call store functions.
- Direct vendor client construction in worker entry points, reconcilers, or
  schedulers. Worker services or executors call integrations through their
  public API.
- Two `service.py` files at the same level. Either parent or `worker/`, not
  both at the same nesting.
- A worker subfolder with only `main.py`. Promote when there's substantial
  content; otherwise keep `worker.py` at the parent.

## Migration Notes

When promoting an existing flat layout to `worker/`:

1. Identify worker-only files (executors, scheduler loop bodies, queue
   handlers).
2. Identify pure logic that's shared between API and worker — move to
   `domain/`.
3. Create `worker/` and move worker-only files inside.
4. Create `worker/main.py` for the process entry point. The old `worker.py`
   becomes `worker/main.py`.
5. Create `worker/service.py` for worker-facing orchestration extracted
   from the old worker file or executors.
6. Verify no file at the parent level still does worker-only work.
7. Verify both `service.py` files don't share names with each other for the
   same operation (each owns its surface).
