# Server Phase 8: Cloud Runtime Lifecycle Audit

Status: audit-only implementation plan.

This audit covers the cloud runtime lifecycle system deferred from Phase 7:

- `server/proliferate/server/cloud/runtime/**`
- `server/proliferate/server/cloud/webhooks/**`
- `server/proliferate/db/store/cloud_runtime_environments.py`
- `server/proliferate/db/store/cloud_repo_config.py`
- `server/proliferate/db/store/cloud_worktree_policy.py`
- runtime-touching billing reconciler checkpoints in
  `server/proliferate/server/billing/reconciler.py`

The goal is to define the invariants and safe migration sequence before moving
runtime lifecycle code. This is not a code-change plan to execute blindly.

## Executive Summary

Cloud runtime cleanup is a Phase 8 system migration because one persistent
runtime environment is shared by provisioning, workspace connection, credential
refresh, sandbox provider webhooks, billing reconciliation, repo config apply,
setup-run monitoring, and worktree policy sync.

The remaining self-opening store wrappers are not all ordinary missed DB
threading. Several are lifecycle checkpoints that deliberately commit around
long-running sandbox, AnyHarness, and provider operations. They should be
replaced only after the owning runtime entrypoints and transaction boundaries
are made explicit.

Recommended target:

- keep stores as injected, transaction-neutral DB primitives
- introduce runtime lifecycle service modules that own checkpoint boundaries
- keep provider/AnyHarness protocol calls behind integration-facing modules
- split pure runtime decisions into `server/cloud/runtime/domain/**`
- preserve independent checkpoint commits around long-running external work
- migrate one lifecycle entrypoint at a time with tests around current behavior

## Current Responsibilities

### Runtime Store

`db/store/cloud_runtime_environments.py` currently contains two shapes.

Injected primitives already match the database guide target:

- create or find a runtime environment for a repo/workspace
- load runtime environments and active sandbox records
- reserve a sandbox slot under a billing-subject advisory transaction lock
- persist runtime status, URL, token, generation, credential markers,
  repo-env version, active sandbox, and last error

Self-opening compatibility wrappers remain:

- `ensure_runtime_environment_for_workspace_id(...)`
- `load_runtime_environment_by_id(...)`
- `runtime_environment_credential_apply_lock(...)`
- `load_runtime_environment_for_workspace(...)`
- `load_runtime_environment_with_sandbox(...)`
- `reserve_and_attach_sandbox_for_environment(...)`
- `save_runtime_environment_state(...)`

The wrappers account for these runtime allowlist entries:

- `STORE_COMMIT_ROLLBACK server/proliferate/db/store/cloud_runtime_environments.py 3`
- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_runtime_environments.py 7`
- `STORE_SESSION_FACTORY_IMPORT server/proliferate/db/store/cloud_runtime_environments.py 1`

### Provisioning

`server/cloud/runtime/provision.py` owns the fresh provisioning state machine:

- load workspace, user, GitHub account, credentials, repo config, and runtime
  environment
- authorize sandbox start against billing policy
- allocate or reuse a provider sandbox
- open billing usage on sandbox creation
- stage binary/runtime dependencies
- write credential files
- clone and configure the repo
- launch AnyHarness
- verify runtime health and auth
- sync worktree retention policy
- reconcile remote agents
- create the root and visible AnyHarness workspaces
- finalize workspace runtime metadata
- persist runtime URL/token/root workspace/generation/repo-env state
- apply post-ready repo config and start setup monitoring
- destroy newly allocated sandboxes and close usage on provisioning failure

Provisioning interleaves DB checkpoints with long-running sandbox and remote
runtime work. It is the riskiest runtime migration area and should be split
only after its state transitions are covered by targeted tests.

### Runtime Connection And Reconnect

`server/cloud/runtime/service.py` owns public connection entrypoints for cloud
workspaces. It loads the runtime environment, checks billing spend holds,
ensures the runtime is reachable, refreshes credentials, syncs worktree
retention policy, and returns runtime connection details.

`server/cloud/runtime/ensure_running.py` owns reconnect/recovery:

- fast-path cached runtime URL health check
- provider endpoint refresh when preview URLs rotate
- paused/stopped sandbox resume
- final AnyHarness process relaunch only after endpoint probes fail
- auth enforcement after health
- runtime URL update when endpoint changes
- runtime generation increment when AnyHarness is relaunched

The split between "fresh endpoint is healthy" and "runtime process relaunched"
is an important user-visible invariant because desktop clients use runtime
generation to detect process identity changes.

### Credential Freshness

`server/cloud/runtime/credential_freshness.py` owns credential revision
planning and apply/relaunch behavior:

- compute file and process credential revisions from active credentials
- compare desired revisions with runtime-applied markers
- serialize apply work per runtime environment using an advisory lock
- write credential files into the active sandbox
- reconcile remote agents after file-only refreshes
- relaunch AnyHarness only when process credentials changed and no live
  runtime sessions exist
- persist credential apply markers and failure metadata

The advisory lock currently holds a DB connection for the duration of the
apply operation. That violates the target store shape, but it also provides
process-wide serialization. It needs a replacement lock primitive before this
flow is converted.

### Repo Config And Setup

`server/cloud/runtime/repo_config_apply.py` owns post-ready repo config:

- lock a workspace apply operation
- load repo config
- write tracked files to the remote AnyHarness workspace with version-token
  checks
- start saved setup scripts
- create setup-run monitor records
- mark apply/setup progress and failures on the workspace

`server/cloud/runtime/setup_monitor.py` owns a durable background reconciliation
loop for remote setup command runs. It claims due setup runs, loads the cloud
workspace connection, polls AnyHarness command-run status, releases running
runs, and finalizes terminal states.

Repo config and setup are runtime lifecycle-adjacent, but their persistent
state mostly lives in cloud workspace and setup-run stores. Coordinate their
migration with the cloud workspace Phase 8 audit.

### Worktree Policy Sync

`server/cloud/runtime/worktree_policy_sync.py` loads the user's cloud worktree
retention policy and pushes it into AnyHarness. It can also run deferred
startup cleanup in the background.

The remaining allowlist entries for `db/store/cloud_worktree_policy.py` exist
because runtime startup and workspace connection still need an isolated policy
read:

- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_worktree_policy.py 1`
- `STORE_SESSION_FACTORY_IMPORT server/proliferate/db/store/cloud_worktree_policy.py 1`

This should move to an explicit runtime lifecycle dependency once the runtime
entrypoints receive a DB session or lifecycle unit of work.

### Repo Config Reads

Provisioning, credential relaunch, and repo-config apply call isolated repo
config reads through `db/store/cloud_repo_config.py`.

Remaining allowlist entries:

- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_repo_config.py 2`
- `STORE_SESSION_FACTORY_IMPORT server/proliferate/db/store/cloud_repo_config.py 1`

These wrappers should disappear when provisioning and credential freshness have
explicit lifecycle entrypoints. Do not remove them mechanically while those
entrypoints still cross long-running sandbox work.

### Provider Webhooks

`server/cloud/webhooks/service.py` handles E2B sandbox lifecycle webhooks:

- verify signature
- dedupe event receipts
- ignore stale provider events by event time and precedence
- load sandbox by external id or metadata
- update sandbox provider state
- open or close usage segments
- enforce active spend holds by pausing sandbox
- mirror runtime environment status on created/resumed/paused/killed events
- clear runtime URL/token/active sandbox and increment generation when a
  provider reports the sandbox killed

Webhook runtime state writes must remain idempotent and safe under duplicated
or out-of-order provider events.

### Billing Reconciler

`server/billing/reconciler.py` touches runtime lifecycle state while repairing
or enforcing billing:

- loads runtime environments for sandbox placeholders and open usage segments
- repairs provider sandbox ids for placeholder records
- closes usage when provider state is paused/stopped/killed/destroyed
- pauses active sandboxes when billing spend holds are enforced
- marks runtime environments paused or unavailable
- clears runtime URL/token/active sandbox and increments generation when a
  provider sandbox is destroyed

This is both billing and runtime lifecycle behavior. Runtime cleanup must not
break billing's ability to checkpoint provider reality independently of HTTP
requests.

## Transaction And Checkpoint Boundaries

These boundaries must be preserved or intentionally replaced.

### Sandbox Reservation

`reserve_and_attach_sandbox_for_environment(...)` opens a transaction that:

- locks the billing subject when a concurrency limit applies
- counts active sandboxes for the billing subject
- inserts the sandbox row
- attaches the sandbox to the runtime environment
- marks the environment provisioning

This transaction is a quota and concurrency invariant. It should become an
explicit lifecycle checkpoint, not a generic store helper with hidden commit.

### Runtime State Save

`save_runtime_environment_state(...)` commits lifecycle checkpoints after
external operations:

- data key generated
- credential files written
- sandbox reused or connected
- runtime launched and health/auth verified
- runtime endpoint rotated
- runtime process relaunched
- provider reported pause/resume/kill
- billing reconciler observed provider drift
- credential apply succeeded or failed

Many of these writes intentionally happen after long-running network work.
Converting them to a single request or worker transaction would be wrong.

### Credential Apply Lock

`runtime_environment_credential_apply_lock(...)` serializes credential apply
operations per runtime environment. It currently uses a DB advisory lock. The
replacement should be a dedicated lock helper or lifecycle lock service so the
store can stop opening sessions without losing cross-process serialization.

### Setup Monitor Claims

Setup-run claim/release/finalize behavior is not owned by the runtime
environment store, but runtime connection checks are part of the poll path.
This is a separate worker/lifecycle boundary and should migrate with cloud
workspace setup-run cleanup.

## Invariants To Preserve

### Runtime Identity And Generation

- Increment `runtime_generation` when the runtime process identity changes,
  runtime token changes, or active sandbox is killed/destroyed.
- Do not increment generation for ordinary preview URL rotation when the same
  runtime process is still healthy.
- Do not expose a runtime connection if auth enforcement fails.
- Do not report ready runtime state while stale URL/token metadata points to a
  killed sandbox.

### Sandbox And Billing

- Sandbox reservation must preserve billing-subject concurrency limits.
- Usage segment open/close calls must remain idempotent enough for webhook and
  reconciler repair paths.
- Billing spend holds must block new starts and pause active provider sandboxes
  when enforcement mode is active.
- Provisioning failure must destroy newly allocated sandboxes, close usage as
  non-billable, and mark workspace error.

### Credential Freshness

- Credential file refreshes can happen without process restart.
- Process credential refresh requires restart unless credentials are already
  current.
- Runtime process restart must be blocked when AnyHarness reports live
  sessions.
- Credential apply failures must persist safe failure metadata without leaking
  secret details.
- Credential apply operations must remain serialized per runtime environment.

### Repo Config And Worktree Policy

- Repo config file writes must use remote version-token checks.
- Setup script start must persist a setup-run record with an apply token before
  the monitor owns polling.
- Worktree policy sync must happen before exposing/reusing a runtime for
  startup cleanup assumptions.
- Deferred startup cleanup may run in the background, but failures must be
  logged rather than block normal connection paths.

### Webhooks And Reconciliation

- Provider webhooks must dedupe event ids.
- Stale provider events must not move sandbox/runtime state backward.
- Provider killed/destroyed must clear runtime URL/token/active sandbox and
  increment generation.
- Billing reconciler must remain safe when provider listing and database state
  disagree.

## Target Ownership Shape

Recommended target folder shape:

```text
server/proliferate/server/cloud/runtime/
  service.py                         # API-facing connection/sync entrypoints
  provision.py                       # temporary until split by sequence below
  lifecycle/
    checkpoints.py                   # explicit runtime checkpoint writes
    locks.py                         # runtime advisory locks
    sandbox_reservation.py           # reserve/attach quota transaction
    reconnect.py                     # provider reconnect/relaunch sequence
    credentials.py                   # credential apply sequence
  domain/
    credential_revision.py           # pure revision/snapshot rules
    reconnect_policy.py              # pure runtime reconnect decisions
    runtime_state.py                 # pure generation/status transition rules
  repo_config/
    apply.py                         # current repo_config_apply.py responsibilities
    setup_monitor.py                 # promoted when setup-run store is threaded
  worktree_policy.py                 # runtime-facing policy sync facade
```

This is a target, not a first PR. Split only when a file has a clear receiving
module and tests that protect behavior.

Store target:

- `db/store/cloud_runtime_environments.py` keeps only injected primitives.
- self-opening wrappers move to runtime lifecycle checkpoints or disappear.
- `db/store/cloud_repo_config.py` keeps repo-config DB primitives only.
- `db/store/cloud_worktree_policy.py` keeps policy DB primitives only.

## Safe Migration Sequence

### 1. Add Lifecycle Checkpoint Tests First

Before moving code, add targeted tests for:

- `save_runtime_environment_state` generation increment behavior
- endpoint URL rotation without generation increment
- killed/destroyed provider events clear runtime URL/token/active sandbox and
  increment generation
- credential file-only refresh does not restart process
- process credential refresh refuses to restart with live sessions
- sandbox reservation returns `None` when the concurrency limit is reached
- provisioning failure destroys newly allocated sandboxes and marks workspace
  error

### 2. Introduce Explicit Runtime Checkpoint Service

Create a runtime lifecycle checkpoint module that owns self-contained
transactions around runtime state writes. It should call injected store
primitives internally and expose named checkpoint functions such as:

- `mark_runtime_data_key_ready(...)`
- `mark_runtime_endpoint_rotated(...)`
- `mark_runtime_process_relaunched(...)`
- `mark_runtime_provider_paused(...)`
- `mark_runtime_provider_destroyed(...)`
- `mark_credential_apply_failed(...)`

This is the right replacement for generic `save_runtime_environment_state(...)`
callers because it names lifecycle intent and keeps independent commits
explicit.

### 3. Extract Runtime Advisory Lock Primitive

Move the credential advisory lock out of the store into a narrow runtime or DB
lock helper. Keep behavior identical:

- PostgreSQL advisory lock by runtime environment id
- process-wide serialization
- unlock in `finally`
- no lock behavior change for non-PostgreSQL test environments

Only after this should `credential_freshness.py` stop importing the store lock.

### 4. Move Sandbox Reservation Boundary

Wrap `reserve_sandbox_slot_for_environment(db, ...)` in a runtime lifecycle
function that opens the transaction at the lifecycle boundary. Keep the
billing-subject advisory xact lock and active sandbox count in one transaction.

Do not thread this through the whole provisioning flow as a single transaction.

### 5. Split Credential Freshness

Move pure rules first:

- credential record filtering
- revision construction
- freshness snapshot construction
- restart-required decision

Then move orchestration only after the lock/checkpoint deps are explicit.
Target shape: a credential lifecycle service that receives external
capabilities for sandbox connection, AnyHarness workspace listing, credential
file writes, and runtime relaunch.

### 6. Split Reconnect

Move pure reconnect policy decisions out of `ensure_running.py`, then replace
direct `save_runtime_environment_state(...)` calls with lifecycle checkpoints.
Preserve the distinction between:

- cached URL still healthy
- provider endpoint rotated but process still healthy
- AnyHarness process relaunched

### 7. Convert Webhook Runtime Writes

Keep webhook dedupe and provider-state writes in the webhook flow, but replace
runtime environment writes with named lifecycle checkpoint functions. Add tests
for duplicate and stale events before moving.

### 8. Convert Billing Reconciler Runtime Writes

Coordinate with the billing Phase 8 audit. Billing should call runtime
lifecycle checkpoints for runtime status changes rather than low-level store
wrappers. Do not move billing accounting logic into runtime.

### 9. Thread Repo Config And Worktree Policy Reads

After provisioning/credential/connection entrypoints have explicit lifecycle
deps, replace isolated repo-config and worktree-policy store wrappers with
injected session reads or runtime service dependencies.

### 10. Remove Store Wrappers And Allowlist Entries

Only after all callsites are migrated:

- delete runtime self-opening store wrappers
- delete repo config and worktree policy isolated wrappers if no deferred
  workspace/runtime caller remains
- reduce `scripts/server_boundaries_allowlist.txt`
- keep server boundary and max-lines checks green

## Tests Required For Implementation

Existing tests already cover parts of the runtime surface:

- `server/tests/unit/test_cloud_runtime_provision.py`
- `server/tests/unit/test_cloud_runtime_credential_freshness.py`
- `server/tests/unit/test_cloud_runtime_ensure_running.py`
- `server/tests/unit/test_cloud_runtime_service.py`
- `server/tests/unit/test_cloud_runtime_scheduler.py`
- `server/tests/unit/test_cloud_worktree_policy_sync.py`
- `server/tests/unit/test_cloud_webhook_service.py`
- `server/tests/e2e/cloud/test_e2b_webhooks.py`

Before implementation, add or harden tests for:

- runtime checkpoint helper behavior with explicit generation rules
- sandbox reservation quota/concurrency transaction behavior
- credential advisory lock behavior around concurrent apply attempts
- provider webhook stale-event precedence
- billing reconciler destroyed/paused provider-state runtime checkpoints
- provisioning success path with runtime generation increment only on fresh
  launch
- provisioning reuse path with no generation increment
- repo config setup monitor record creation and apply-token preservation
- worktree policy sync failure handling for deferred cleanup

## Work To Coordinate With Other Phase 8 Lanes

Cloud runtime cannot be fully cleaned in isolation.

- **Billing/accounting/Stripe:** billing reconciler and active spend holds
  pause/destroy runtime sandboxes and checkpoint runtime status.
- **Cloud workspace lifecycle:** provisioning finalizes workspace metadata,
  setup-run state, post-ready repo config, and workspace error state.
- **Cloud mobility:** runtime worktree policy and AnyHarness workspace
  identity affect mobility destinations.
- **Automation workers:** runtime/workspace lifecycle may be started or
  observed from non-HTTP execution paths.

If these audits disagree on ownership, resolve the ownership model before code
movement.

## Implementation Guardrails

- Do not replace independent checkpoint commits with one long transaction
  around sandbox or AnyHarness network work.
- Do not split `provision.py` by line count alone; split by lifecycle step and
  test boundary.
- Do not move billing accounting decisions into runtime lifecycle modules.
- Do not move cloud workspace setup-run ownership into runtime unless the
  cloud workspace audit agrees.
- Do not remove isolated wrappers until their deferred callers are gone.
- Do not change runtime generation semantics without desktop/client review.
- Do not change webhook event precedence or dedupe behavior during
  reorganization.

## Recommended First Implementation PR

The first code PR should be narrow:

1. Add tests for runtime checkpoint generation semantics and webhook killed
   runtime clearing.
2. Introduce a small runtime lifecycle checkpoint module.
3. Replace only one low-risk caller of `save_runtime_environment_state(...)`
   with a named checkpoint.
4. Keep the old wrapper for remaining callers.
5. Update the allowlist only if the observed count drops.

That first PR should prove the pattern before the team attacks provisioning or
credential freshness.
