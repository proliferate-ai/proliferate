# Workers

Status: authoritative for `worker.py`, `reconciler.py`, scheduler files, the
`worker/` subfolder pattern, and worker-side service decomposition.

Read after `docs/server/README.md`. This guide details how non-HTTP entry
points are organized, how worker-side logic relates to HTTP-side logic, and
when a worker subfolder is earned.

## Ownership

A worker is a non-HTTP entry point that runs domain work outside the request
lifecycle. Common shapes:

- **Process entry points** — `worker.py` files run as separate processes,
  with `main()`, argparse, and signal handlers.
- **Reconciliation loops** — `reconciler.py` periodically compares expected
  vs actual state and fixes drift.
- **Scheduled jobs** — `scheduler.py` declares cron-style schedules.
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

The trigger: substantial worker-only logic that doesn't naturally fit in
`service.py`. Multiple files, distinct concerns, hundreds of lines that
aren't API-facing.

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

Alternative implementations of "do the worker's work." Two implementations
of the same conceptual job (e.g., cloud vs local) live as siblings in
`worker/`.

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

The trigger is *substantial worker-only logic that doesn't naturally fit in
`service.py`*. Without that, a sibling `worker.py` is enough.

## Worked Example: Automations

The automations domain has substantial worker-side work — multiple
executors, scheduler logic, distinct from API-side CRUD on automation
definitions. It's the canonical case for the `worker/` subfolder pattern.

### Today (transitional)

```text
server/automations/
  api.py
  service.py
  models.py
  worker.py                    # entry point
  schedule.py                  # MISNAMED — actually pure RRULE parsing logic
  cloud_executor.py            # executor implementation
  local_executor_service.py    # executor implementation (with bad _service suffix)
```

Issues:

- `schedule.py` is pure parsing logic. Belongs in `domain/`, not at the
  worker-shaped layer.
- `local_executor_service.py` has the `_service` suffix that's forbidden
  outside `service.py`.
- All worker-side concerns (executors, scheduler logic) sit alongside the
  API-side service.py with no organizational separation.

### Target

```text
server/automations/
  api.py                        # API routes: CRUD on automation definitions
  service.py                    # API-facing service: CRUD logic
  models.py                     # Pydantic API schemas
  domain/                       # pure logic shared between API and worker
    recurrence.py               # RRULE parsing (was schedule.py)
    policy.py                   # scheduling rules, can-run rules
  worker/                       # worker surface
    main.py                     # process entry: argparse, signals, async loop
    service.py                  # worker-facing service: pick due, dispatch, record
    scheduler.py                # scheduler loop body
    cloud_executor.py
    local_executor.py           # was local_executor_service.py
```

What lives where:

- `domain/recurrence.py` is pure: RRULE parsing, occurrence math, no I/O.
  Used by both worker (to find due automations) and API (to validate user
  input or render schedule descriptions).
- `worker/scheduler.py` is the loop body that calls
  `domain/recurrence.py` to find what's due, then dispatches via
  `worker/service.py`.
- `worker/service.py` orchestrates the worker side: pick next due, dispatch
  to executor, record result, handle failures.
- `worker/cloud_executor.py` and `worker/local_executor.py` are the two
  alternative implementations of "run an automation."

The parent `service.py` shrinks to just CRUD on automation definitions,
because all the executor and scheduling work has moved into `worker/`.

## Forbidden Patterns

- Pure parsing or computation logic in worker-shaped files
  (`worker.py`, `scheduler.py`, `reconciler.py`). That's `domain/` work.
- Substantial business logic inside `worker.py`'s loop body. The body calls
  `service.py`.
- Multiple "executor" or "runner" sibling files at the parent domain level
  (`automations/cloud_executor.py` + `automations/local_executor.py`).
  Promote to `worker/` once you have the pattern.
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
