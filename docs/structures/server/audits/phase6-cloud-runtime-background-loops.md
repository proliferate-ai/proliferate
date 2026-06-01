# Phase 6E Cloud Runtime Background Loop Audit

Status: audit-only cleanup note.

Scope:

- `server/proliferate/server/cloud/runtime/setup_monitor.py`
- `server/proliferate/server/cloud/runtime/scheduler.py`
- related setup-run store/service paths

This audit reviews the cloud runtime background loops against the worker
ownership model in `docs/structures/server/guides/workers.md`. It does not change cloud
runtime behavior.

## Current Ownership

### `cloud/runtime/scheduler.py`

This file is a small in-process provisioning task registry:

- dedupes active provisioning tasks by workspace id
- starts `provision_workspace(...)` in an asyncio task
- captures and logs task failures
- removes completed tasks from the registry

It is not a durable scheduler and does not currently earn a `worker/` folder.
The name is slightly broad, but the file is small and behavior is covered by
`server/tests/unit/test_cloud_runtime_scheduler.py`.

### `cloud/runtime/setup_monitor.py`

This file owns a durable reconciliation loop for remote AnyHarness setup
command runs:

- app lifecycle starts and stops the monitor
- each loop claims due setup runs by monitor owner
- each claimed run is polled through the remote AnyHarness connection
- queued or running runs release their claim
- succeeded, failed, and timed-out runs finalize setup state
- missing workspace or runtime cases are handled as stale or retryable

This is worker-like, but it is tightly coupled to cloud runtime materialization,
post-ready setup, setup-run persistence, and remote runtime connection state.
It should not be reorganized in Phase 6 without a focused cloud runtime pass.

### `db/store/cloud_workspace_setup_runs.py`

The setup-run store still self-opens sessions and commits. That violates the
target database threading model, but it is separate migration debt. Converting
this store should happen before or alongside any setup monitor extraction.

### `cloud/runtime/config_sync/repo_config.py`

This starts remote setup commands and persists setup-run monitor records after
the workspace reaches post-ready setup. It is part of the cloud runtime
materialization/config-application state machine. Lane 5 moved the owner under
`config_sync/`; the setup-run behavior should still be left in place for this
audit.

## Worker Guide Fit

The setup monitor has several responsibilities that the worker docs would
normally separate:

- loop lifecycle
- due-work claiming
- integration polling
- setup-run state transition decisions
- persistence writes

However, promoting it now would mostly move coupling into new files without
reducing risk. The right sequence is to first make setup-run persistence accept
explicit database sessions, then extract the reconciliation logic with tests
around the existing state transitions.

The provisioning scheduler does not have that problem. It is intentionally
process-local task coordination and can remain flat for now.

## Deferred Cleanup Lanes

### 1. Cloud Setup-Run Store Session Threading

Later phase: database/runtime cleanup.

Target:

- make setup-run store functions accept an explicit `AsyncSession`
- remove self-opened sessions and internal commits
- keep claim, release, and finalize behavior identical
- add targeted tests for claim TTL, stale runs, superseded apply tokens,
  deadline timeout, release-on-running, and finalization

Do this before extracting setup monitor orchestration.

### 2. Cloud Setup Monitor Service Extraction

Later phase: cloud runtime worker/service cleanup.

Possible target shape:

- a tiny lifecycle module owns start/stop/task cancellation
- a setup monitor service owns reconcile, poll, and finalize decisions
- store and integration operations arrive as explicit dependencies or narrow
  service functions

Do not change:

- monitor owner uniqueness
- claim TTL and poll interval semantics
- deadline handling
- apply-token supersede protection
- release behavior for queued or running remote command runs
- stale handling for missing workspaces or runtimes

### 3. Provision Task Registry Hardening

Later small cleanup, optional.

Possible changes:

- add a short comment documenting that `scheduler.py` is an in-process
  provisioning task registry, not a durable scheduler
- add or preserve tests for duplicate scheduling and task cleanup
- avoid moving it to a worker folder unless behavior becomes durable or more
  stateful

### 4. Cloud Runtime Provisioning Design Review

Later focused pass.

Before larger refactors, document the provisioning and materialization
invariants:

- workspace lifecycle states
- setup apply token behavior
- local vs cloud runtime readiness assumptions
- retry behavior
- where user-visible failure state is set

This should happen before reorganizing the broader cloud runtime service tree.

## Phase 6E Recommendation

Treat Phase 6E as complete with audit-only output.

No implementation should be done in this phase beyond optional comments. The
actual cleanup belongs after the setup-run database API is made explicit and
the cloud runtime provisioning invariants are captured.
