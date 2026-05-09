# Server Phase 8: Automation Worker Claims Audit

Status: complete audit.

This audit covers automation worker claim and executor semantics before Phase 8
code movement. It is intentionally read-only: the remaining debt is not just
file placement. It is transaction timing, claim ownership, retry behavior, and
the split between server-side cloud workers and external desktop executors.

## Scope

Primary paths:

- `server/proliferate/server/automations/**`
- `server/proliferate/db/store/automation_run_claims.py`
- `server/proliferate/db/store/automation_cloud_workspace_claims.py`
- `server/proliferate/db/store/automations.py`

Related paths:

- `server/proliferate/db/models/automations.py`
- `server/proliferate/constants/automations.py`
- `server/tests/unit/test_automation_executor.py`
- `server/tests/unit/test_automation_store.py`
- `server/tests/integration/test_automations_api.py`

## Current Shape

The automations domain is already partly in the target worker shape:

```text
server/proliferate/server/automations/
  api.py
  service.py                         # API-facing automation CRUD and run-now
  local_executor_service.py          # API-facing desktop executor surface
  models.py
  domain/
    schedule.py
    validation.py
  worker/
    main.py                          # process entrypoint
    scheduler.py                     # scheduler loop/backoff/Sentry
    service.py                       # worker scheduler tick orchestration
    cloud_executor.py                # cloud executor claim loop/task lifecycle
    cloud_executor_claims.py         # heartbeat/current/fail helpers
    cloud_executor_workspace.py      # workspace stage orchestration
    cloud_executor_session.py        # session/prompt stage orchestration
    cloud_executor_config.py
```

This matches `docs/server/guides/workers.md` in broad shape: external desktop
executor endpoints stay API-facing in `local_executor_service.py`, while the
server-run cloud executor lives under `worker/`.

The remaining problem is lower level:

- Store files still open sessions and commit.
- Claim lifecycle rules live partly in store code.
- Long-running worker flow and short DB mutation flow are intertwined through
  self-committing store wrappers.
- One store helper creates a cloud workspace and mutates an automation run in
  the same transaction, crossing store ownership for an important atomicity
  reason.

## Current Responsibilities

| File | Owns today | Phase 8 concern |
|---|---|---|
| `server/automations/api.py` | User automation CRUD plus local executor HTTP endpoints. | Local executor endpoints do not receive a request DB session yet. |
| `server/automations/service.py` | API-facing automation creation/update/list/run-now. | Mostly clean after earlier phases; not the main Phase 8 risk. |
| `server/automations/local_executor_service.py` | Request-driven desktop executor claim, heartbeat, state transitions, and failure marking. | Calls self-opening claim store wrappers; should thread request DB sessions. |
| `server/automations/worker/main.py` | Process entry, args, signal handling, Sentry/logging, role selection. | Acceptable shape; should remain thin. |
| `server/automations/worker/scheduler.py` | Scheduler loop, retry backoff, escalation logging/Sentry. | Acceptable loop shape; should not absorb DB logic. |
| `server/automations/worker/service.py` | Scheduler tick: sweep expired dispatching runs, create due scheduled runs. | Calls self-committing store functions; transaction boundaries need to move out of stores. |
| `server/automations/worker/cloud_executor.py` | Cloud claim polling, concurrency, task lifecycle, heartbeat task lifecycle. | Calls claim store directly to acquire work. |
| `server/automations/worker/cloud_executor_claims.py` | Heartbeat loop, stale claim detection, fail-current-claim helper. | Calls claim store directly for atomic claim mutations. |
| `server/automations/worker/cloud_executor_workspace.py` | Create/load/provision workspace stages. | Crosses users, cloud workspace, runtime, and claim transitions. |
| `server/automations/worker/cloud_executor_session.py` | Runtime session creation, reasoning effort, prompt dispatch. | Encodes dispatch-uncertain semantics and external I/O ordering. |
| `db/store/automation_run_claims.py` | Claim acquisition, current-claim locks, heartbeat, state transitions, expiry sweep. | Largest ownership issue: session factory + commits + lifecycle policy in one store. |
| `db/store/automation_cloud_workspace_claims.py` | Atomically create cloud workspace and attach it to a claimed run. | Cross-store atomic wrapper that must move carefully, not disappear. |
| `db/store/automations.py` | Automation CRUD, run creation/listing, scheduler due-run insertion. | Remaining scheduler batch wrapper opens and commits its own session. |

## Claim State Model

Automation runs move through this practical lifecycle:

```text
queued
  -> claimed
  -> creating_workspace
  -> provisioning_workspace
  -> creating_session
  -> dispatching
  -> dispatched

queued/claimed/... can also become failed or cancelled.
```

The current status groups are:

- Reclaimable after claim expiry: `claimed`, `creating_workspace`,
  `provisioning_workspace`, `creating_session`.
- Active claim statuses: all reclaimable statuses plus `dispatching`.
- Terminal statuses: `dispatched`, `failed`, `cancelled`.

The important asymmetry is `dispatching`: it remains an active claim status,
but it is not reclaimable. If a claim expires while dispatching, the scheduler
sweeps it to `failed` with `dispatch_uncertain`. That is correct because prompt
delivery may have succeeded even if the executor stopped responding before it
recorded `dispatched`.

## Transaction And Locking Invariants

These invariants must survive migration:

1. **Claim acquisition is a short locked transaction.** Claimers select queued
   or expired-reclaimable runs with `FOR UPDATE SKIP LOCKED`, ordered by
   creation time, bounded by limit.
2. **Claim identity gates every mutation.** Claim mutations check run ID,
   claim ID, execution target, executor kind, allowed status, optional user
   ID, and active TTL under row lock.
3. **Expired non-dispatching work can be reclaimed.** Expired claims in
   reclaimable statuses return to a new executor by being overwritten with a
   fresh claim.
4. **Expired dispatching work is failed, not reclaimed.** This preserves the
   "prompt delivery uncertain" invariant.
5. **No long external I/O happens inside claim transactions.** Cloud workspace
   provisioning, runtime reconnect, session creation, config application, and
   prompt delivery all happen outside DB transactions. The executor re-checks
   the current claim before and after important stages.
6. **Heartbeat failure only marks the in-memory claim stale.** The heartbeat
   loop sets a stale event when the DB claim is no longer current; the main
   executor flow stops at stage boundaries.
7. **Final dispatched clears claim metadata.** `mark_run_dispatched` clears the
   executor kind, executor ID, claim ID, and claim expiry. The run is no longer
   owned by an executor after prompt acceptance is recorded.
8. **Failure clears claim metadata.** Failed runs clear ownership so stale
   executors cannot keep mutating them.
9. **Scheduled run creation is idempotent.** The scheduler inserts with the
   `(automation_id, scheduled_for)` unique slot and advances `next_run_at` even
   if another scheduler already created the slot.
10. **Bad schedules disable only the bad automation.** The scheduler logs,
    disables that automation, and continues the batch.
11. **Local executor claims are user- and repo-scoped.** Desktop executors can
    only claim local runs for the authenticated user and advertised repository
    identities.
12. **Cloud executor claims are global cloud-target claims.** The server worker
    claims cloud-target runs across users, then validates user/workspace state
    during execution.

## Remaining Boundary Debt

`scripts/server_boundaries_allowlist.txt` still contains these automation
entries:

| Rule | Path | Count | Why it remains |
|---|---|---:|---|
| `STORE_COMMIT_ROLLBACK` | `db/store/automation_cloud_workspace_claims.py` | 1 | Cross-store atomic workspace creation + run attachment. |
| `STORE_SESSION_FACTORY_CALL` | `db/store/automation_cloud_workspace_claims.py` | 1 | Same wrapper opens its own session. |
| `STORE_SESSION_FACTORY_IMPORT` | `db/store/automation_cloud_workspace_claims.py` | 1 | Same wrapper imports the session factory. |
| `STORE_COMMIT_ROLLBACK` | `db/store/automation_run_claims.py` | 12 | Claim acquisition, heartbeat, transitions, fail/dispatched, sweep. |
| `STORE_SESSION_FACTORY_CALL` | `db/store/automation_run_claims.py` | 13 | Same claim wrappers open their own short sessions. |
| `STORE_SESSION_FACTORY_IMPORT` | `db/store/automation_run_claims.py` | 1 | Claim store imports the session factory. |
| `STORE_COMMIT_ROLLBACK` | `db/store/automations.py` | 1 | Scheduler batch creates due runs and advances schedules. |
| `STORE_SESSION_FACTORY_CALL` | `db/store/automations.py` | 2 | Scheduler batch plus cloud workspace lookup helper still open sessions. |
| `STORE_SESSION_FACTORY_IMPORT` | `db/store/automations.py` | 1 | Automation store imports the session factory. |

These entries are Phase 8 debt, not permission for new store wrappers.

## Why This Is Not A Simple DB-Threading Pass

The normal server target is simple: handlers receive a DB session, services
thread it, stores never commit. The automation worker path has additional
constraints:

- A single automation run can span many seconds or minutes of external work.
- Claim ownership must be refreshed while the run is in progress.
- Every externally visible stage must be independently atomic.
- A crash between `dispatching` and `dispatched` has product meaning.
- Desktop executors are external clients, so each state transition is its own
  HTTP request and therefore its own request transaction.
- Cloud executors are server processes, but their stages still need short DB
  transactions around state mutations rather than one transaction around the
  whole run.

The migration should remove self-opening sessions from stores, but it should
not collapse these independent stage transactions into one large transaction.

## Target Ownership Shape

Keep the current high-level automations folder shape, but move transaction
ownership to the caller/service boundary and move pure claim rules out of
stores.

```text
server/proliferate/server/automations/
  api.py
  service.py                         # API-facing automation CRUD/run-now
  local_executor_service.py          # external desktop executor API service
  models.py
  domain/
    claim_lifecycle.py               # pure status sets, transition rules, error mapping
    schedule.py
    validation.py
  worker/
    main.py
    scheduler.py                     # loop/backoff only
    service.py                       # scheduler and cloud-executor orchestration
    cloud_executor.py                # loop/task lifecycle only
    cloud_executor_claims.py         # heartbeat/fail/current wrappers via worker service
    cloud_executor_workspace.py
    cloud_executor_session.py

server/proliferate/db/store/
  automations.py                     # automation definitions and scheduler read/write leaves
  automation_run_claims.py           # run-claim DB leaves, db passed in
  automation_cloud_workspace_claims.py
                                     # only if kept as a DB leaf with db passed in
```

Potential later store-folder promotion:

```text
server/proliferate/db/store/automations/
  definitions.py
  runs.py
  run_claims.py
  cloud_workspace_claims.py
  schedule_runs.py
```

Do not promote the folder until the DB-threading work proves the split. The
first Phase 8 implementation should avoid a broad move-and-rewrite PR.

## Safe Migration Sequence

### 1. Pin the claim contract before moving code

Add or expand tests for:

- Reclaimable statuses can be claimed after TTL expiry.
- `dispatching` claims are not reclaimed and are failed by the sweep.
- Stale claim IDs cannot mutate after reclaim.
- Heartbeat extends TTL only for the current claim.
- `mark_run_dispatched` clears claim metadata.
- `mark_run_failed` clears claim metadata.
- Local claims are restricted by user and canonical repository identity.
- Cloud claims skip local-target runs.
- Unconfigured agent snapshots fail at claim time without claiming the run.
- Scheduler duplicate slot insert advances `next_run_at`.
- Bad schedule disables one automation and continues the batch.

Some of these tests already exist in
`server/tests/unit/test_automation_executor.py` and
`server/tests/unit/test_automation_store.py`. Treat them as the regression
suite to preserve, not as sufficient coverage for all migration steps.

### 2. Extract pure claim lifecycle decisions

Move pure status groups and transition predicates into
`server/automations/domain/claim_lifecycle.py`.

Examples:

- reclaimable status set
- active claim status set
- terminal status set
- allowed previous statuses for each transition
- error-code-to-message mapping if it is product copy rather than DB shape

Keep this module synchronous and I/O-free. Stores may receive derived status
sets as parameters from services, or import narrow constants if necessary, but
claim lifecycle policy should stop being hidden inside store wrappers.

### 3. Introduce DB-leaf functions without deleting wrappers yet

For each self-opening store wrapper, add a DB-threaded equivalent:

- `claim_automation_runs(db, ...)`
- `load_current_run_claim(db, ...)`
- `heartbeat_run_claim(db, ...)`
- transition functions for workspace/session/dispatch/failure
- `sweep_expired_dispatching_runs(db, ...)`
- `create_due_scheduled_runs_batch(db, ...)`

These functions take `db: AsyncSession` and do not commit. They preserve the
same locks and status predicates. Keep the old wrappers temporarily only as
callers migrate, and remove each wrapper in the same PR as its final caller.

### 4. Thread DB through the local executor API surface

Add request-session injection to local executor endpoints and thread `db` into
`local_executor_service.py`.

This is the easiest caller class because every local executor mutation is
already one HTTP request. The FastAPI DB dependency can own commit/rollback for
each claim action.

Do not change endpoint payloads or response shapes.

### 5. Move scheduler transaction ownership out of stores

`worker/scheduler.py` should remain loop/backoff only. The transaction boundary
belongs in worker-facing service functions called by the loop.

Recommended shape:

- `run_scheduler_tick` opens or receives short transactions for:
  - sweep expired dispatching runs
  - create due scheduled runs
- Each transaction calls store leaves.
- The two operations may remain separate transactions; do not force one
  transaction for the entire tick unless a test proves that is required.

### 6. Move cloud executor claim mutations behind worker service operations

The cloud executor should call worker-facing service operations such as:

- claim cloud runs
- heartbeat current claim
- require current claim
- fail claim
- transition to creating/provisioning/creating-session/dispatching/dispatched

Those operations own short DB transactions and call store leaves. They must not
hold a DB transaction across cloud workspace provisioning, runtime reconnect,
session creation, config application, or prompt delivery.

### 7. Preserve the workspace-creation atomic wrapper deliberately

`automation_cloud_workspace_claims.py` currently locks the claimed run, creates
a cloud workspace record, attaches the workspace ID to the run, commits, and
refreshes the workspace.

This is a real invariant, not accidental coupling. The Phase 8 target should
move ownership to a service/worker transaction boundary, but preserve the
single atomic unit:

```text
lock current claim
verify claim still owns the run
create cloud workspace row with repo limits
attach workspace ID to run
commit
```

Coordinate this step with the cloud workspace lifecycle Phase 8 audit. Do not
rewrite broad cloud workspace creation semantics in the automation worker PR.

### 8. Remove store self-opening wrappers and allowlist entries

Once callers are migrated, delete wrappers that import
`async_session_factory`, remove commits from store files, and reduce the
automation entries in `scripts/server_boundaries_allowlist.txt`.

## Tests Required Before Implementation

Minimum targeted tests:

- `uv run pytest -q server/tests/unit/test_automation_executor.py`
- `uv run pytest -q server/tests/unit/test_automation_store.py`
- `uv run pytest -q server/tests/unit/test_automation_service.py`
- `uv run pytest -q server/tests/integration/test_automations_api.py`

New tests to add during migration:

- Claim DB-threaded functions preserve current wrapper behavior.
- Local executor endpoints commit state transitions through request DB session.
- Cloud executor service transactions do not hold locks across injected slow
  external operations.
- Heartbeat stale event stops execution after claim loss.
- Workspace creation remains atomic with claim attachment.
- Scheduler tick can partially succeed: sweep/create failures do not corrupt
  schedule advancement invariants.

Verification for every Phase 8 implementation PR:

- `/opt/homebrew/bin/python3.12 scripts/check_server_boundaries.py`
- `/opt/homebrew/bin/python3.12 scripts/check_max_lines.py`
- targeted automation tests above
- `git diff --check`

## Implementation Warnings

- Do not move `local_executor_service.py` into `worker/`. It is API-facing for
  external desktop executors, not a server-side worker implementation.
- Do not wrap a full cloud automation run in one DB transaction.
- Do not make `dispatching` reclaimable.
- Do not remove `claim_id` validation from any mutation.
- Do not replace `FOR UPDATE SKIP LOCKED` claim selection with a read-then-
  update pattern.
- Do not split `automation_run_claims.py` by line count before preserving the
  claim state machine in tests.
- Do not let cloud workspace Phase 8 and automation worker Phase 8 both rewrite
  the workspace-creation atomicity in separate PRs.

## Recommended Phase 8 PR Order

1. Add missing claim lifecycle tests and pure `domain/claim_lifecycle.py`.
2. Add DB-threaded store leaves while preserving old wrappers.
3. Migrate local executor API/service calls to request DB sessions.
4. Migrate scheduler tick to worker-owned transaction boundaries.
5. Migrate cloud executor claim operations to worker service operations.
6. Migrate the cloud workspace creation wrapper in coordination with cloud
   workspace lifecycle work.
7. Delete self-opening store wrappers and update the boundary allowlist.

After this sequence, the automations worker area should have no automation-
specific store session-factory allowlist entries, while preserving crash,
heartbeat, reclaim, and dispatch-uncertainty semantics.
