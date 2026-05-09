# Server Phase 8: Cloud Mobility Audit

Status: implementation planning reference.

This audit covers the cloud mobility lifecycle before any Phase 8 code
movement. It is intentionally read-only: the mobility flow has checkpoint and
handoff semantics that need to be preserved before store/session cleanup or
file splits happen.

Primary paths:

- `server/proliferate/server/cloud/mobility/api.py`
- `server/proliferate/server/cloud/mobility/service.py`
- `server/proliferate/server/cloud/mobility/models.py`
- `server/proliferate/db/store/cloud_mobility.py`
- `server/proliferate/db/models/cloud/mobility.py`
- `server/tests/unit/test_cloud_mobility_service.py`
- `server/tests/unit/test_cloud_mobility_store.py`

## Current Responsibilities

| Path | Current ownership | Cleanup pressure |
|---|---|---|
| `server/cloud/mobility/api.py` | HTTP routes for logical mobility workspaces, preflight, handoff start, heartbeat, phase updates, finalize, cleanup complete, and fail. | Routes still catch `CloudApiError` directly; they also do not receive/thread request DB sessions. |
| `server/cloud/mobility/service.py` | User-facing orchestration, stale handoff expiry, workspace listing/backfill, preflight blockers, local-to-cloud provisioning kickoff, handoff phase APIs, and Cloud API error mapping. | Orchestration is mixed with product-state rules and calls isolated store wrappers. |
| `server/cloud/mobility/models.py` | Pydantic request/response models and payload constructors from store dataclasses. | Shape is mostly right; response constructors depend directly on store value types. |
| `db/store/cloud_mobility.py` | ORM reads/writes, dataclasses, lifecycle state mutation, handoff op mutation, row locking, and transitional isolated DB wrappers. | Store still owns transaction commits, session creation, and some product state-machine decisions. |
| `db/models/cloud/mobility.py` | ORM tables for `cloud_workspace_mobility` and `cloud_workspace_handoff_op`. | Shape is acceptable; state strings are not yet backed by domain enums. |

## Lifecycle Model

Cloud mobility models one logical workspace that can be owned by local or cloud
state while a handoff operation coordinates movement between those owners.

Observed owner values:

- `local`
- `cloud`

Observed mobility lifecycle states:

- `local_active`
- `cloud_active`
- `moving_to_cloud`
- `moving_to_local`
- `handoff_failed`
- `cleanup_failed`

Observed handoff phases:

- `start_requested`
- `source_frozen`
- `destination_ready`
- `install_succeeded`
- `cleanup_pending`
- `cleanup_failed`
- `completed`
- `handoff_failed`

Current active handoff detection treats every phase except `completed` and
`handoff_failed` as active. That means `cleanup_failed` remains an active
handoff and blocks new handoffs until cleanup is resolved or the flow is
redesigned.

## Current Request Flows

### List Mobility Workspaces

`list_cloud_workspace_mobility_for_user` first expires stale handoffs for the
user, then lists cloud workspaces, backfills mobility rows for each cloud
workspace, and finally returns mobility rows.

Important behavior:

- A read endpoint may mutate state by expiring stale handoffs and backfilling
  mobility rows.
- Backfill creates or updates logical mobility records with `owner_hint="cloud"`.
- The flow fans out into multiple isolated store sessions today.

### Ensure Mobility Workspace

`ensure_cloud_workspace_mobility` validates `ownerHint`, finds an existing
cloud workspace for the repo/branch if present, and creates or updates the
logical mobility row.

Important behavior:

- Existing `handoff_failed` rows with no active handoff are retryable and reset
  to the requested active owner.
- Display name and cloud workspace ID can be refreshed during ensure.
- A unique identity is `(user_id, git_provider, git_owner, git_repo_name,
  git_branch)`.

### Preflight Handoff

`preflight_cloud_workspace_handoff` checks whether a handoff can start.

Blockers include:

- unsupported direction
- `cloud_lost` state
- active handoff on the same workspace
- active handoff on another workspace for the same user
- owner/direction mismatch
- missing GitHub link or repository access for local-to-cloud
- requested branch missing on GitHub
- requested branch head not matching the requested base SHA
- requested branch not matching the logical workspace branch
- empty requested base SHA when explicitly provided

The response also includes excluded paths from repo config tracked files.

### Start Handoff

`start_cloud_workspace_handoff` re-runs preflight, creates the handoff op, and
then branches by direction.

For `local_to_cloud`:

1. Create the handoff op and commit the mobility row into a moving state.
2. Load the user with OAuth accounts.
3. Ensure a cloud workspace for the existing branch.
4. Start the cloud workspace with the requested base SHA.
5. Update the handoff phase/status to `start_requested` with the cloud
   workspace ID.
6. If cloud setup fails after handoff creation, mark the handoff failed and
   re-raise the original error.

For `cloud_to_local`:

- The server currently creates the handoff and returns it. The client/runtime
  side drives later phase updates and finalization.

Important behavior:

- Handoff creation is a durable checkpoint before cloud workspace provisioning.
- Failure after handoff creation must leave an observable failed handoff.
- Only one active handoff per mobility workspace is allowed.
- Preflight separately blocks another active handoff for the same user.

### Phase, Heartbeat, Finalize, Cleanup, Fail

The remaining endpoints mutate an existing handoff:

- `heartbeat` refreshes `heartbeat_at`.
- `phase` validates against the accepted phase set, updates phase/status, and
  optionally records a cloud workspace ID.
- `finalize` moves phase to `cleanup_pending`, sets `finalized_at`, flips the
  logical owner to the target owner, moves lifecycle state to active
  local/cloud, records the cloud workspace ID if provided, and leaves cleanup
  pending.
- `cleanup-complete` moves phase to `completed`, sets
  `cleanup_completed_at`, clears `active_handoff_op_id`, and marks status
  `Ready`.
- `fail` moves phase to `handoff_failed`, clears the active handoff pointer,
  moves lifecycle to `handoff_failed`, and records failure detail.

Important behavior:

- `finalize` changes the visible owner before source cleanup is complete.
- Source cleanup completion, not finalization, clears the active handoff.
- Failure detail is truncated differently for status detail and last error.

### Stale Expiry

`expire_stale_cloud_workspace_handoffs_for_user` scans mobility rows for the
user and expires active handoffs whose heartbeat is older than 120 seconds.

Important behavior:

- If the handoff was finalized but cleanup did not complete, expiry becomes
  `cleanup_failed`, keeps the active handoff pointer, and uses cleanup-specific
  failure text.
- Otherwise expiry becomes `handoff_failed`, clears the active handoff pointer,
  and records handoff failure text.
- Expiry currently runs opportunistically at the start of most service calls.

## Transaction Boundaries

The current store has two layers:

1. Lower-level functions that accept `db: AsyncSession`.
2. Transitional `*_for_user` wrappers that open `async_session_factory()`.

The allowlist records the remaining debt:

- `STORE_COMMIT_ROLLBACK server/proliferate/db/store/cloud_mobility.py 9`
- `STORE_SESSION_FACTORY_CALL server/proliferate/db/store/cloud_mobility.py 13`
- `STORE_SESSION_FACTORY_IMPORT server/proliferate/db/store/cloud_mobility.py 1`

The commits are not incidental. Today each handoff mutation is its own durable
checkpoint:

- ensure/backfill commits creation or retry reset
- handoff creation commits the active handoff and moving lifecycle state before
  provisioning continues
- phase updates commit progress and heartbeat refresh
- finalization commits ownership transfer before source cleanup
- cleanup completion commits the terminal completed phase
- failure/expiry commits observable failure state

Phase 8 must preserve these checkpoints deliberately. Moving to request-session
threading cannot accidentally make a long local-to-cloud start flow one large
transaction that rolls back the handoff creation when provisioning fails.

## Retry And Failure Invariants

- A `handoff_failed` workspace with no active handoff is retryable through
  ensure; the owner and lifecycle state reset to the owner hint.
- A workspace with `active_handoff_op_id` blocks new handoffs.
- A user may have only one active handoff at a time, enforced in preflight.
- `cleanup_failed` is active by query semantics and should not be treated as a
  normal retryable failure.
- Local-to-cloud provisioning failure after handoff creation must call the
  fail path before surfacing the error.
- Stale expiry must distinguish cleanup timeout from pre-finalization timeout.
- Branch preflight must remain strict about branch presence and requested base
  SHA matching.

## Boundary And Shape Issues

1. **API error translation remains route-local.** Routes catch
   `CloudApiError` and call `raise_cloud_error`. This is consistent with
   existing cloud code but still not the shared error target shape.
2. **API routes do not inject `AsyncSession`.** The mobility service cannot
   yet thread request DB sessions because it calls isolated store wrappers.
3. **Store owns product state transitions.** Functions such as
   `create_cloud_workspace_handoff_op`, `finalize_cloud_workspace_handoff_op`,
   `complete_cloud_workspace_handoff_cleanup`, and
   `expire_stale_cloud_workspace_handoff_op_for_user` encode lifecycle rules
   directly in the DB store.
4. **State strings are untyped.** Owners, lifecycle states, directions, and
   phases are all strings across ORM, dataclass, service, and API layers.
5. **Read paths can mutate.** List/detail/preflight calls run stale expiry,
   and list also backfills mobility rows from cloud workspaces.
6. **Mobility reaches into neighboring domains.** The service coordinates repo
   branch access, repo config, cloud workspace creation/start, and user OAuth
   loading. That orchestration is real, but it needs cleaner dependency
   boundaries before code movement.

## Target Ownership Shape

Do not start by splitting files only by size. Start by making lifecycle
ownership explicit.

Suggested target:

```text
server/proliferate/server/cloud/mobility/
  api.py
  service.py
  models.py
  errors.py                    # mobility-specific errors if CloudApiError migrates
  domain/
    lifecycle.py               # pure state transition planners and typed states
    preflight.py               # blocker rules, direction/owner validation
    stale.py                   # stale-expiry classification
  worker.py or reconciler.py   # only if stale expiry moves out of read paths

server/proliferate/db/store/
  cloud_mobility.py            # DB reads/writes only, no session opening/commit
```

The domain layer should own pure rules:

- valid directions and phases
- owner/direction compatibility
- active/final/failed handoff classification
- stale-expiry outcome: `cleanup_failed` vs `handoff_failed`
- retryability of failed mobility workspaces
- status detail and failure truncation rules

The service layer should own orchestration:

- expire/backfill/list order
- preflight dependency calls
- handoff start sequence
- cloud workspace ensure/start calls
- durable checkpoint ordering

The store should own only:

- query construction
- row locks
- row mutation primitives requested by the service
- dataclass snapshots

## Safe Migration Sequence

1. **Add characterization tests first.**
   Cover lifecycle transitions and checkpoint semantics before moving code.
2. **Extract pure mobility domain rules without behavior change.**
   Move string sets, active/final phase classification, retryability, stale
   expiry outcome selection, and direction/owner checks into
   `server/cloud/mobility/domain/`.
3. **Split store primitives from isolated wrappers.**
   Keep behavior intact, but make lower-level store functions accept `db` and
   stop encoding high-level state choices directly where practical.
4. **Thread DB sessions through API/service for simple read/write paths.**
   Start with detail, heartbeat, explicit phase update, finalize, cleanup, and
   fail. Do not start with list/backfill or local-to-cloud start.
5. **Preserve durable checkpoints in service code.**
   For handoff start, keep the handoff-creation checkpoint before cloud
   provisioning. This may require explicit short transactions or a dedicated
   checkpoint helper, not a single request transaction.
6. **Move stale expiry out of incidental read paths only after designing the
   replacement.**
   Options: keep explicit service call at route start with threaded DB, or
   promote a reconciler/worker. Do not silently drop opportunistic expiry.
7. **Convert response constructors away from store value imports only after
   the dataclass ownership is settled.**
   The current direct store value imports are acceptable until the store split
   defines stable internal snapshots.
8. **Reduce allowlist counts only with the matching migration.**
   The Phase 8 goal is to eliminate the three `cloud_mobility.py` entries, but
   not by hiding session creation or commits in a different layer.

## Required Tests Before Implementation

Add or strengthen tests for:

- preflight blocks owner/direction mismatch for both directions
- preflight blocks another active handoff for the same user
- preflight blocks `cloud_lost`
- preflight branch-not-found and branch-head-mismatch behavior
- local-to-cloud start creates a durable handoff before cloud workspace start
- local-to-cloud start marks the handoff failed when cloud workspace ensure or
  start fails
- cloud-to-local start creates a handoff without starting cloud provisioning
- heartbeat refreshes `heartbeat_at` without changing phase
- explicit phase update rejects unsupported phases
- finalize flips owner and lifecycle state but keeps active handoff until
  cleanup completion
- cleanup completion clears active handoff and marks completed
- failure clears active handoff and records truncated detail/error
- stale expiry before finalization becomes `handoff_failed`
- stale expiry after finalization but before cleanup becomes `cleanup_failed`
  and keeps the active handoff pointer
- retry ensure clears a retryable `handoff_failed` workspace only when no
  active handoff exists
- list path backfills cloud-owned mobility rows for existing cloud workspaces

Run these with the existing service/store unit tests before replacing the
isolated wrappers.

## Explicit Non-Goals For The First Implementation PR

- Do not redesign the desktop/runtime mobility protocol.
- Do not change the public API payload shape.
- Do not remove stale expiry unless a replacement reconciler or explicit
  service checkpoint is implemented and tested.
- Do not merge mobility with cloud workspace lifecycle. Mobility coordinates
  with workspaces, but it is its own promoted cloud subdomain.
- Do not treat `cleanup_failed` as a terminal non-active state without a
  product decision.
- Do not wrap local-to-cloud start in one request-wide transaction that rolls
  back the durable handoff on provisioning failure.

## Recommended Phase 8 Implementation Lanes

1. **Mobility domain extraction.**
   Pure state/phase/preflight/stale helpers plus tests.
2. **Mobility store primitive split.**
   Store remains one file if needed, but lower-level DB functions become the
   only public DB API and wrappers are isolated for deletion.
3. **Simple endpoint DB threading.**
   Convert heartbeat, phase, finalize, cleanup, fail, and detail before
   list/start.
4. **List/backfill/stale expiry design.**
   Decide whether expiry/backfill remain synchronous service work or move to a
   reconciler.
5. **Start handoff checkpoint migration.**
   Preserve the durable checkpoint around handoff creation and failure marking
   while removing store-owned session creation.
