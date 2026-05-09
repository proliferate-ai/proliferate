# Phase 6F Billing Reconciler Audit

Status: audit-only cleanup note.

Scope:

- `server/proliferate/server/billing/reconciler.py`
- `server/tests/unit/test_billing_reconciler.py`
- adjacent billing service/store calls used by the reconciler

This audit reviews the billing reconciler against the worker ownership model in
`docs/server/guides/workers.md`. It does not change billing behavior.

## Current Ownership

`billing/reconciler.py` currently owns four distinct concerns:

- **Loop lifecycle**: `_reconciler_task`, `_billing_reconciler_loop`,
  `start_billing_reconciler`, and `stop_billing_reconciler`.
- **Pass entrypoint**: `run_billing_reconcile_pass`, the advisory lock, the
  configured sandbox provider, provider state indexing, and per-pass caches.
- **Reconciliation execution**: placeholder repair, open usage segment
  reconciliation, sandbox state updates, runtime environment updates, and
  billing decision event recording.
- **Product/accounting policy**: running state normalization, provider state to
  sandbox/environment status decisions, active-spend enforcement, quota pause
  behavior, and the repair/open-segment policy for placeholders.

The file is short enough to understand, but its ownership is broader than the
target worker model. It imports store helpers directly, constructs the
configured sandbox provider directly, and contains product policy inside the
reconciliation loop surface.

## Worker Folder Decision

Do **not** promote billing to `server/proliferate/server/billing/worker/`
yet.

Reasoning:

- Billing has one background flow today: a periodic reconciler started from the
  FastAPI lifespan.
- There is no separate billing worker process, queue consumer, or scheduler
  package to own.
- The docs allow a sibling `reconciler.py` when one file is enough.
- A `worker/` folder would mostly move current coupling into new paths before
  the billing service/store boundaries are ready.

The right near-term target is a thin sibling `reconciler.py` that owns only
loop lifecycle and pass invocation, with service/domain helpers underneath. A
`worker/` folder should wait until billing has multiple worker-only concerns or
a real standalone worker entrypoint.

## What Should Move Later

The eventual cleanup should split by responsibility, not by file size.

### 1. Keep Loop Lifecycle In `reconciler.py`

Keep:

- `_billing_reconciler_loop`
- `start_billing_reconciler`
- `stop_billing_reconciler`
- the interval sleep and Sentry/logging guard around a failed pass

The loop should call one service-level pass function. It should not know about
provider states, usage segments, quota decisions, or cloud environment updates.

### 2. Move The Pass To Billing Service

Create or move toward a service function shaped like:

```python
async def run_billing_reconcile_pass(db: AsyncSession) -> None:
    ...
```

That service should own:

- acquiring provider state through the sandbox integration boundary
- fetching open usage segments and snapshots through store functions
- recording billing decision events
- dispatching repair/enforcement actions

This should wait until the billing store functions involved can accept an
explicit `db: AsyncSession` without changing transaction timing. Today many of
those helpers still self-open sessions and commit internally.

### 3. Extract Pure Reconciliation Policy

Move product decisions that can be tested without I/O into
`server/proliferate/server/billing/domain/`.

Good candidates:

- provider state normalization: provider `running`/`started` to sandbox
  `running`
- provider terminal states to desired sandbox/environment status
- active-spend hold verdict to enforcement command
- placeholder repair command construction

Target shape:

```python
def plan_segment_reconciliation(input: SegmentState) -> ReconciliationCommand:
    ...
```

The domain planner should return commands or verdicts. The service executes
those commands against stores and integrations.

### 4. Thread DB Explicitly

The reconciler currently calls store wrappers that open their own sessions
inside an advisory-lock callback. That makes the lock look transaction-scoped
from `reconciler.py`, but much of the real work happens in separate
transactions.

The safer future shape is:

- loop entrypoint opens one session and transaction for one pass
- pass service receives `db`
- billing/cloud store helpers receive `db`
- stores do not commit
- advisory lock and mutations share the intended transaction boundary

This is a billing-sensitive migration and should not be folded into a broad
worker cleanup PR.

## Recommended Migration Lanes

1. **Domain planner lane**: add pure policy functions and tests for provider
   state to desired action. No DB or provider calls.
2. **Billing store-threading lane**: convert only the store functions needed by
   the reconciler to explicit `db`, preserving transaction behavior.
3. **Reconcile pass service lane**: move placeholder repair and segment
   enforcement execution into billing service functions that accept explicit
   dependencies.
4. **Reconciler thinning lane**: make `reconciler.py` call the pass service and
   retain only loop lifecycle and failure handling.

Each lane should be behavior-preserving. Do not combine the planner extraction,
DB transaction migration, and loop thinning in one PR.

## Deferred

Leave these out of Phase 6F:

- changing quota or pause semantics
- changing billing decision event contents
- changing usage segment idempotency keys
- changing E2B/provider retry behavior
- promoting `billing/worker/`
- rewriting `db/store/billing.py`
- converting the whole billing service/store stack to explicit DB sessions

Those belong in the later billing god-module work, with focused tests around
accounting and provider-state drift.

## Verification Expectations

For any future implementation PR touching this area, run at minimum:

```bash
cd server
uv run ruff check proliferate/ tests/
DEBUG=1 uv run --python 3.12 --extra dev python -m pytest -q tests/unit/test_billing_reconciler.py
```

Also run the repo-shape checks from the repository root:

```bash
python3.12 scripts/check_server_boundaries.py
python3.12 scripts/check_max_lines.py
```
