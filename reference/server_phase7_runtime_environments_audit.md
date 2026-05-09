# Server Phase 7G: Cloud Runtime Environments Audit

Status: complete.

This audit covers the Phase 7G runtime-environment cleanup lane:

- `server/proliferate/db/store/cloud_runtime_environments.py`
- `server/proliferate/server/cloud/runtime/credential_freshness.py`
- `server/proliferate/server/cloud/runtime/bootstrap.py`
- `server/proliferate/server/cloud/runtime/ensure_running.py`

## Recommendation

Do not convert this lane in Phase 7.

The remaining `cloud_runtime_environments` store debt is not ordinary missed DB
threading. The self-opening wrappers are transaction boundaries for cloud
runtime lifecycle flows: provisioning, reconnect, credential refresh, sandbox
webhooks, and billing reconciliation. Converting them safely requires a Phase 8
runtime-lifecycle design pass.

## Current Responsibilities

### Store Layer

`db/store/cloud_runtime_environments.py` contains two kinds of functions.

Injected store functions already match the target shape:

- `ensure_runtime_environment_for_repo(db, ...)`
- `get_runtime_environment_by_id(db, ...)`
- `get_runtime_environment_for_workspace(db, ...)`
- `ensure_runtime_environment_for_workspace(db, workspace)`
- `get_active_sandbox_for_environment(db, environment)`
- `reserve_sandbox_slot_for_environment(db, ...)`
- `persist_runtime_environment_state(db, environment, ...)`

Self-opening compatibility wrappers remain:

- `ensure_runtime_environment_for_workspace_id(workspace_id)`
- `load_runtime_environment_by_id(runtime_environment_id)`
- `runtime_environment_credential_apply_lock(runtime_environment_id)`
- `load_runtime_environment_for_workspace(workspace)`
- `load_runtime_environment_with_sandbox(runtime_environment_id)`
- `reserve_and_attach_sandbox_for_environment(runtime_environment_id, ...)`
- `save_runtime_environment_state(runtime_environment_id, **kwargs)`

Those wrappers account for the current boundary allowlist entries:

- `STORE_SESSION_FACTORY_IMPORT`
- `STORE_SESSION_FACTORY_CALL`
- `STORE_COMMIT_ROLLBACK`

### Runtime Credential Freshness

`runtime/credential_freshness.py` owns runtime credential revision planning and
the process that applies credentials to an already-running sandbox. It calls
self-opening runtime-environment wrappers because the apply flow spans:

- loading runtime state
- acquiring a runtime-environment advisory lock
- sandbox connection and command execution
- live-session checks through AnyHarness
- relaunching the runtime process when allowed
- persisting credential revision markers and failure metadata

The advisory lock currently holds a dedicated DB connection while the flow runs.
That is intentional process-wide serialization. Replacing it requires a
purpose-built lock/session design, not a mechanical store signature change.

### Runtime Bootstrap

`runtime/bootstrap.py` is large but does not own DB access. It owns sandbox
bootstrap commands, runtime launch script construction, binary staging, and
Node/Rust runtime checks. It is provisioning-adjacent and should not be split in
Phase 7 unless a later Phase 8 runtime provisioning plan creates clear receiving
modules.

### Runtime Ensure-Running

`runtime/ensure_running.py` owns reconnect/recovery for existing runtime
sandboxes. It uses runtime-environment state writes only after provider endpoint
probe, sandbox resume/connect, or AnyHarness relaunch. Those writes are part of
runtime liveness semantics and should remain coupled to the Phase 8 runtime
reconnect plan.

## Callsite Map

`ensure_runtime_environment_for_workspace_id`:

- `server/cloud/runtime/provision.py`
- Opens a short transaction to attach/create the environment before provisioning
  continues. Safe conversion depends on restructuring provisioning input load.

`load_runtime_environment_by_id`:

- `server/billing/reconciler.py`
- `server/cloud/webhooks/service.py`
- `server/cloud/runtime/credential_freshness.py`
- Used by background reconciliation, sandbox webhook handling, and credential
  refresh. These are independent lifecycle entrypoints, not request-local reads.

`runtime_environment_credential_apply_lock`:

- `server/cloud/runtime/credential_freshness.py`
- Holds a process-wide advisory lock while sandbox/network operations run.
  Requires explicit Phase 8 lock design before moving.

`load_runtime_environment_for_workspace`:

- `server/cloud/runtime/service.py`
- `server/cloud/workspaces/service.py`
- Used by workspace detail/connection surfaces and setup monitor paths. These
  callsites are entangled with cloud workspace lifecycle service debt.

`load_runtime_environment_with_sandbox`:

- `server/cloud/runtime/provision.py`
- `server/cloud/runtime/credential_freshness.py`
- Used to reconnect/reuse the active sandbox. Tied to runtime provisioning and
  credential refresh.

`reserve_and_attach_sandbox_for_environment`:

- `server/cloud/runtime/provision.py`
- Opens a transaction around billing-subject concurrency lock, active sandbox
  count, sandbox row insert, and environment activation. This transaction is an
  invariant and should not be threaded through provisioning casually.

`save_runtime_environment_state`:

- `server/billing/reconciler.py`
- `server/cloud/webhooks/service.py`
- `server/cloud/runtime/provision.py`
- `server/cloud/runtime/credential_freshness.py`
- `server/cloud/runtime/ensure_running.py`
- Writes runtime status, URL, tokens, active sandbox, generation increments,
  credential markers, repo-env version, and last error. The callsites are
  lifecycle checkpoints that currently commit independently.

## Invariants To Preserve In Phase 8

- Runtime state checkpoints commit independently before and after long-running
  sandbox/network work.
- `reserve_and_attach_sandbox_for_environment` preserves the billing-subject
  concurrency check and sandbox insert in one transaction.
- Runtime generation increments only when the runtime endpoint/token/process
  identity changes.
- Credential apply operations remain serialized per runtime environment across
  processes.
- Webhook and billing reconciler state writes remain idempotent and safe when
  provider events arrive out of order.
- Runtime reconnect must not start or restart AnyHarness while stale state is
  still visible as healthy.

## Phase 8 Target Shape

Recommended Phase 8 plan:

1. Create a runtime-lifecycle design note covering provisioning, reconnect,
   credential refresh, webhooks, and billing reconciler updates together.
2. Keep injected store primitives in `db/store/cloud_runtime_environments.py`.
3. Move self-opening lifecycle wrappers out of the store only after defining
   explicit lifecycle entrypoints and transaction boundaries.
4. Introduce a narrow DB advisory-lock helper for process-wide locks, then move
   `runtime_environment_credential_apply_lock` to that helper or to a runtime
   lifecycle module.
5. Convert callsites in slices:
   - provisioning input/load and sandbox reservation
   - credential freshness apply/relaunch
   - ensure-running reconnect state writes
   - webhook and billing reconciler checkpoint writes
6. Add tests around transaction timing and generation increments before
   removing the allowlist entries.

## Phase 7 Result

No code movement is recommended for 7G. The lane is complete as an audit and
should be considered Phase 8-deferred.

