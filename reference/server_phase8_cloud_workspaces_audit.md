# Server Phase 8: Cloud Workspace Lifecycle Audit

Status: complete.

This audit covers the Phase 8 cloud workspace lifecycle lane:

- `server/proliferate/server/cloud/workspaces/**`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/db/store/cloud_workspace_setup_runs.py`

The goal is design clarity before implementation. Cloud workspaces are not just
CRUD records: they are request-created workspaces, automation-created
workspaces, runtime materialization jobs, repo-config apply progress, setup
command monitors, sandbox lifecycle state, and billing/concurrency checkpoints.

## Recommendation

Do not start this lane with mechanical DB threading or file splitting.

The remaining cloud workspace debt is real, but the risky part is transaction
timing. Several store wrappers intentionally commit independently around
long-running provider, GitHub, AnyHarness, billing, and setup-monitor work. Move
those only after pinning the lifecycle invariants below and adding tests that
exercise checkpoint ordering.

## Current Responsibilities

### API Layer

`server/cloud/workspaces/api.py` owns the HTTP surface:

- list, create, detail, connection
- start, stop, delete
- branch/display-name updates
- credential sync

It is still transitional:

- handlers do not inject `db: AsyncSession`
- handlers pass `User` ORM objects into service functions
- handlers catch `CloudApiError` and translate it per route

Target shape is thin transport with request DB injection, resource-access deps
where appropriate, and shared error translation through the server error model.

### Access And Policy Layer

`server/cloud/workspaces/access.py` is already the right concept, but it is not
yet the final shape.

Current behavior:

- `cloud_workspace_user_can_read(user_id, workspace_id)` loads by workspace ID
  through a self-opening store wrapper.
- personal workspaces are readable only by `owner_user_id`.
- organization workspaces currently preserve the existing `org_cloud_not_ready`
  behavior when the actor has membership.
- missing or forbidden personal workspaces are both hidden as
  `workspace_not_found`.

Transitional issue:

- access returns an ORM `CloudWorkspace` because the service layer still mutates
  ORM objects directly.

Phase 8 should introduce snapshot-returning store reads before converting
access deps fully. Do not switch access to snapshots until the service write
paths no longer expect attached ORM instances.

### Workspace Service

`server/cloud/workspaces/service.py` is the main god file for this lane.

It currently owns:

- create validation: GitHub link, repo config, default/base branch selection,
  branch collision checks, repo access, billing authorization, repo limit, and
  credential availability
- human workspace creation and automation workspace creation
- existing-branch workspace ensure for mobility
- listing/detail payload assembly with runtime environment, billing, credential
  freshness, and automation-run context
- status transition rules
- start/restart queuing and provisioning scheduling
- branch/display-name mutation
- credential sync delegation
- stop/delete sandbox provider orchestration
- runtime connection probing and error marking

The service imports ORM/auth models and many cross-domain stores/services. This
is why `SERVICE_ORM_IMPORT` remains allowlisted for the file.

### Workspace Store

`db/store/cloud_workspaces.py` contains several different concerns in one file:

- workspace reads and active-branch lookup
- create record plus billing-subject repo-limit enforcement
- sandbox record reads, reservation, binding, provider-state updates
- workspace materialization finalization
- runtime reconnect state persistence
- status and error persistence
- repo-config apply progress and advisory lock helpers
- compatibility self-opening wrappers for most of the above

Injected primitives exist, but the public call sites mostly use self-opening
wrappers. The file currently accounts for:

- `STORE_COMMIT_ROLLBACK` count 16
- `STORE_SESSION_FACTORY_CALL` count 26
- `STORE_SESSION_FACTORY_IMPORT` count 1

The injected primitives and wrappers are mixed, which makes it difficult to see
which commits are ordinary request commits and which are lifecycle checkpoints.

### Setup-Run Store

`db/store/cloud_workspace_setup_runs.py` owns durable monitoring for remote
AnyHarness setup command-runs.

It currently owns:

- setup-run creation after remote command start
- due-run claiming with `FOR UPDATE SKIP LOCKED`
- claim release and next-poll scheduling
- finalization as succeeded, failed, timed out, or stale
- workspace post-ready phase updates during finalization

The file accounts for:

- `STORE_COMMIT_ROLLBACK` count 4
- `STORE_SESSION_FACTORY_CALL` count 5
- `STORE_SESSION_FACTORY_IMPORT` count 1

The commits here are monitor checkpoints. They should not be folded into a
request transaction.

### Runtime Callers

Cloud workspace lifecycle also spans runtime modules:

- `runtime/scheduler.py` keeps an in-memory per-workspace provisioning task map.
- `runtime/provision.py` updates materialization status at each provisioning
  step and finalizes workspace/runtime/sandbox records.
- `runtime/repo_config_apply.py` applies repo files, starts setup commands, and
  writes post-ready progress.
- `runtime/setup_monitor.py` claims setup runs, polls AnyHarness command-run
  status, and finalizes the active setup token.

These modules are outside the narrow workspace folder, but they are part of the
same lifecycle invariants. Phase 8 implementation needs to coordinate with the
runtime lifecycle lane.

## Lifecycle States And Transitions

### Workspace Visible Status

`CloudWorkspaceStatus` values:

- `pending`
- `materializing`
- `ready`
- `archived`
- `error`

Current service transition map:

- `pending` -> `materializing`, `archived`, `error`
- `materializing` -> `ready`, `archived`, `error`
- `ready` -> `materializing`, `archived`, `error`
- `archived` -> `materializing`, `error`
- `error` -> `materializing`, `archived`

Notable behavior:

- create inserts `pending`, schedules provisioning, and returns immediately
- start on `pending` clears stale errors and schedules provisioning without
  changing status
- start on `error` or `archived` transitions to `materializing` and schedules
  provisioning
- start on `ready` returns detail without scheduling
- stop/archive transitions to `archived`
- provisioning failure marks `error`, clears runtime metadata, and may clear
  the active sandbox

### Repo Post-Ready Phase

`WorkspacePostReadyPhase` values:

- `idle`
- `applying_files`
- `starting_setup`
- `completed`
- `failed`

Current behavior:

- new workspace records start at `idle`
- after provisioning, `apply_workspace_repo_config_after_provision` applies
  tracked repo files and optionally starts setup
- file apply writes per-file progress and stores failed path/error on failure
- setup command start moves phase to `starting_setup` and writes an apply token
- setup monitor finalization only updates the workspace if the run's apply
  token still matches the workspace's active token
- superseded or missing-workspace setup runs become `stale`

### Setup-Run Status

Current setup-run active statuses are `pending` and `running`. Final statuses
observed in the store/monitor are:

- `succeeded`
- `failed`
- `timed_out`
- `stale`

Important timing:

- claim TTL is 45 seconds
- normal poll interval is 5 seconds
- command start sets a deadline of 35 minutes
- `command_run_id` is unique
- finalization clears claim fields and active apply token

## Transaction Boundaries To Preserve

These are the boundaries a Phase 8 implementation must not accidentally
collapse.

1. **Workspace creation + repo-limit enforcement**
   - `create_cloud_workspace_record` ensures a personal billing subject,
     enforces cloud repo limits under a billing-subject lock, ensures a runtime
     environment, creates the workspace, and commits by default.
   - Automation creation uses a claimed-run path that must preserve claim
     semantics.

2. **Provisioning task checkpoints**
   - The scheduler starts a background task; provisioning status writes commit
     independently as external work progresses.
   - Status details such as "Allocating sandbox", "Cloning repository", and
     "Starting AnyHarness" are visible progress, not local-only state.

3. **Sandbox reservation**
   - Sandbox reservation checks active sandbox count under a billing-subject
     concurrency lock and attaches the sandbox to the workspace/runtime.
   - This is a billing/concurrency invariant.

4. **Provision finalization**
   - Workspace, sandbox, runtime URL/token, AnyHarness workspace ID, template
     version, ready timestamp, and runtime generation are finalized together.
   - Runtime-environment state is then updated in a related checkpoint.

5. **Provision failure cleanup**
   - Failed attempts may destroy a just-allocated provider sandbox, close a
     usage segment as non-billable, update sandbox status, mark the workspace
     error, and clear runtime metadata.
   - These steps must remain idempotent enough for partial provider failures.

6. **Stop/delete**
   - Stop pauses the active sandbox when possible, closes usage, updates sandbox
     status, archives the workspace, and persists the stop state.
   - Delete/destroy uses similar provider/usage/sandbox updates, clears runtime
     metadata, and archives the workspace.

7. **Repo-apply advisory lock**
   - Repo file apply and setup start are guarded by a workspace-specific
     advisory lock.
   - Only one post-ready apply/setup flow should mutate
     `repo_post_ready_*` fields for a workspace at a time.

8. **Setup monitor claims**
   - Due setup runs are claimed with row locks and `SKIP LOCKED`.
   - Polling, release, timeout, and finalization each commit independently so
     another process can take over after claim expiry.

9. **Setup finalization active-token check**
   - Finalization only updates workspace post-ready state if the setup run's
     token still matches `repo_post_ready_apply_token` and the workspace is in
     `starting_setup`.
   - This prevents stale command-runs from overwriting newer apply attempts.

## Boundary Debt

Current allowlist entries owned by this lane:

- `SERVICE_ORM_IMPORT server/proliferate/server/cloud/workspaces/service.py 2`
- `STORE_COMMIT_ROLLBACK server/proliferate/db/store/cloud_workspace_setup_runs.py 4`
- `STORE_COMMIT_ROLLBACK server/proliferate/db/store/cloud_workspaces.py 16`
- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_workspace_setup_runs.py 5`
- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_workspaces.py 26`
- `STORE_SESSION_FACTORY_IMPORT server/proliferate/db/store/cloud_workspace_setup_runs.py 1`
- `STORE_SESSION_FACTORY_IMPORT server/proliferate/db/store/cloud_workspaces.py 1`

Related but not owned solely by this lane:

- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_repo_config.py 2`
- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_worktree_policy.py 1`
- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_runtime_environments.py 7`

Those related entries are shared with runtime lifecycle and repo-config apply.

## File-Size Debt

Primary oversized files:

- `server/proliferate/server/cloud/workspaces/service.py` — 1104 lines
- `server/proliferate/db/store/cloud_workspaces.py` — 1001 lines

Medium supporting files:

- `server/proliferate/server/cloud/workspaces/models.py` — 329 lines
- `server/proliferate/db/store/cloud_workspace_setup_runs.py` — 209 lines

Do not split only to reduce line count. Split around lifecycle ownership:

- request-facing workspace CRUD/read orchestration
- workspace materialization/start/stop/delete orchestration
- sandbox persistence primitives
- repo apply progress persistence
- setup-run persistence/claiming

## Target Ownership Shape

Recommended target after Phase 8 design:

```text
server/proliferate/server/cloud/workspaces/
  api.py
  access.py
  errors.py
  models.py
  service.py                    # request-facing create/list/detail/update shell
  domain/
    lifecycle.py                # pure status/phase transition rules
    policy.py                   # access/product policy
    repo_selection.py           # pure branch/default selection decisions
  lifecycle/
    service.py                  # start/stop/delete/restart orchestration
    setup_runs.py               # setup-run service over store primitives

server/proliferate/db/store/cloud_workspaces/
  workspaces.py                 # CloudWorkspace reads/writes, dataclass snapshots
  sandboxes.py                  # CloudSandbox workspace attachment/status primitives
  repo_apply.py                 # repo_post_ready progress + advisory lock
  setup_runs.py                 # CloudWorkspaceSetupRun persistence
```

Use the folder shape only if the implementation actually moves all related
workspace stores together. Do not leave both `db/store/cloud_workspaces.py` and
`db/store/cloud_workspaces/` active long-term.

## Safe Migration Sequence

### 1. Codify Pure Lifecycle Rules

Move the status transition map and post-ready phase rules into
`server/cloud/workspaces/domain/lifecycle.py`.

Add tests for:

- every allowed workspace status transition
- representative denied transitions
- start behavior for `pending`, `ready`, `archived`, and `error`
- active setup token matching versus stale setup-run finalization

This step should not change DB or service boundaries.

### 2. Introduce Store Snapshots

Add frozen dataclasses for workspace, sandbox, and setup-run read results.

Start with read-only paths:

- list workspaces
- detail lookup
- access checks
- setup-run load/claim result shape

Keep write paths on ORM objects until explicit mutation commands exist. This
avoids a half-migrated service that both mutates ORM and consumes snapshots.

### 3. Thread Request DB Through Simple HTTP Paths

Convert only request-local paths first:

- list
- detail
- branch/display-name update
- credential sync detail reload

Do not convert provisioning scheduler, setup monitor, stop/delete provider
calls, or repo-apply locks in this slice.

### 4. Split Request Create From Background Materialization

Create should become:

1. validate user/repo/branch/billing/credential inputs
2. create the workspace record in the request transaction
3. enqueue/schedule materialization through a narrow lifecycle interface
4. return detail

Before this step, add tests proving duplicate branch checks, repo-limit
enforcement, and automation claim creation still behave as today.

### 5. Design Worker/Lifecycle Transaction Entrypoints

Before removing self-opening wrappers for provisioning/setup monitor, introduce
explicit lifecycle entrypoints that own sessions:

- provisioning task entrypoint
- setup-monitor claim/poll/finalize pass
- stop/delete runtime operation if kept outside request transaction

These entrypoints may open their own DB sessions. Stores below them should then
accept `db`.

### 6. Convert Setup Runs

Move setup-run persistence to injected store primitives only after the monitor
entrypoint owns the session.

Preserve:

- `SKIP LOCKED` claim behavior
- claim TTL and next-poll scheduling
- timeout finalization
- stale-token protection
- failed setup error truncation

### 7. Convert Stop/Delete

Split provider side effects from persistence checkpoints.

Recommended shape:

- plan/load active sandbox
- call provider pause/destroy
- close usage segment
- persist sandbox/workspace result

Tests must cover provider failure leaving enough state for retry/debug.

### 8. Remove Compatibility Wrappers And Allowlist Entries

Only after callsites migrate:

- delete self-opening wrappers in workspace/setup-run stores
- remove matching allowlist entries
- keep runtime/repo-config allowlist entries until their Phase 8 lanes migrate

## Tests Required Before Implementation

Minimum unit tests:

- workspace lifecycle transition table
- create validation ordering: org not ready, GitHub link, repo config, branch
  default/fallback, duplicate branch, billing block, credential requirement
- start/restart behavior for each visible workspace status
- stop/delete state planning for provider success and failure
- setup-run claim/release/finalize/timeout behavior
- stale setup-run token cannot overwrite a newer apply
- repo-apply lock prevents concurrent post-ready mutation

Minimum integration tests:

- create returns `pending` and does not block on provisioning
- start from `error` requeues `materializing`
- ready workspace start does not enqueue provisioning
- setup monitor succeeds and updates `repo_setup_applied_version`
- setup monitor failure records `repo_files_last_error` and keeps workspace
  otherwise inspectable
- delete/archive marks cleanup state and hides archived workspaces from normal
  list results
- repo limit enforcement remains locked per billing subject

Existing coverage to preserve:

- `server/tests/unit/test_cloud_workspace_service.py`
- `server/tests/unit/test_cloud_workspace_access_policy.py`
- `server/tests/unit/test_cloud_runtime_provision.py`
- `server/tests/integration/test_cloud_api.py::TestCloudWorkspaces`
- `server/tests/integration/test_cloud_repo_limits.py`
- `server/tests/e2e/cloud/test_lifecycle.py`
- `server/tests/e2e/cloud/test_provisioning.py`

## Implementation Guardrails

- Keep this lane coordinated with the cloud runtime lifecycle audit. Runtime
  provisioning owns many workspace state transitions.
- Do not pass ORM `User` or `CloudWorkspace` deeper into new service code.
- Do not make stores call peer stores while splitting files.
- Do not move setup-monitor commits into request transactions.
- Do not remove visible progress status writes unless the replacement gives
  the desktop equivalent progress semantics.
- Do not broaden organization workspace behavior; current `org_cloud_not_ready`
  behavior is intentional until product support exists.

## Phase 8 Exit Criteria

This lane is complete when:

- request handlers inject and thread `db`
- workspace access returns snapshots, not ORM objects
- workspace service no longer imports ORM/auth models
- workspace stores expose injected primitives only
- setup-run monitor entrypoints own sessions explicitly above the store layer
- boundary allowlist entries for `cloud_workspaces.py`,
  `cloud_workspace_setup_runs.py`, and `cloud/workspaces/service.py` are gone
- lifecycle transition, setup-run, and stop/delete tests protect the transaction
  timing described in this audit
