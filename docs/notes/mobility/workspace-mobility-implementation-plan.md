# Workspace Mobility: Technical Implementation Plan

Status: draft

This document is the implementation plan for end-to-end local `<->` cloud
workspace mobility. It assumes the accepted decisions in:

- [decision-v1-support-matrix.md](./decision-v1-support-matrix.md)
- [decision-quiescence-and-runtime-freeze.md](./decision-quiescence-and-runtime-freeze.md)
- [decision-git-base-prepare-and-roundtrip.md](./decision-git-base-prepare-and-roundtrip.md)
- [decision-agent-history-and-source-cleanup.md](./decision-agent-history-and-source-cleanup.md)
- [decision-handoff-ui-and-user-flow.md](./decision-handoff-ui-and-user-flow.md)

It also depends on the portability analysis in:

- [session-portability-summary.md](./session-portability-summary.md)

## 0. Current implementation inventory and required cleanup

This plan builds on mobility code that already exists on the current mobility
branches. It is not a greenfield design.

### 0.1 Already exists

Runtime primitive:

- AnyHarness mobility export/install endpoints
- internal AnyHarness mobility archive types
- working archive export/install logic

Server/control plane:

- `CloudWorkspaceMobility` ORM model
- mobility list/get/display-name/cloud-lost APIs
- backfill helpers from `CloudWorkspace`

Desktop:

- mobility summaries loaded alongside local/cloud workspaces
- logical-workspace derivation by repo + branch
- initial mobility-aware sidebar/display-name behavior

### 0.2 Exists but is in the wrong final shape

These are real code paths that should be treated as transitional and refactored
as part of implementation:

- `server/cloud/mobility/service.py` currently opens DB sessions directly and
  performs ORM commit/refresh work inline; that must move into `db/store/**`
  to satisfy the server layer law
- `anyharness-lib/src/mobility/mod.rs` currently holds internal archive data
  models that belong in `mobility/model.rs`
- `anyharness-lib/src/mobility/service.rs` is currently acting as the
  cross-domain workflow owner; the target shape is `mobility/orchestrator.rs`
  (or equivalent)
- git delta logic currently lives in `mobility/service.rs`; it belongs in
  `git/`
- provider artifact portability logic currently lives in
  `mobility/agent_artifacts.rs`; it belongs in `agents/portability/**`
- mobility contract record types currently mirror internal session records
  closely; they are acceptable as transport types but must remain boundary
  types, not internal runtime models

### 0.3 Shipping cutover rule

This feature must not ship as a second parallel workspace identity path.

By the time the user-facing mobility flow lands:

- logical workspaces are the only user-facing local/cloud workspace identity
- old cloud-only sidebar/action paths are deleted or fully routed through
  mobility-aware flows
- synthetic `cloud:<id>` identifiers, if still needed at all, remain only as an
  internal runtime-target translation detail and not as a second user-facing
  workspace model

## 1. Product model

Mobility is not generic two-way sync. It is a single-writer handoff.

One logical workspace may be materialized:

- locally
- in cloud

At any time, only one materialization is authoritative.

Moving a workspace means:

1. prove the move is allowed
2. freeze the current owner
3. prepare the destination at the same git base
4. export the portable mutable state
5. install that state on the destination
6. flip ownership
7. clean up migrated source state

The moved payload is an archive of mutable state, not a full repo snapshot.

## 2. Core state model

### 2.1 Server-owned logical workspace state

The authoritative workspace mobility state lives in `server/cloud/mobility/**`
and is represented by the `CloudWorkspaceMobility` record.

The logical state machine should be treated as:

- `local_active`
- `moving_to_cloud`
- `cloud_active`
- `moving_to_local`
- `handoff_failed`
- `cloud_lost`

The current implementation has split `owner` and `lifecycle_state` fields.
That is acceptable as long as desktop treats the combination as one coherent
logical state.

The logical record owns:

- stable logical workspace identity
- repo identity and branch
- current authoritative owner
- lifecycle state
- linked cloud materialization id when one exists
- logical display name
- last handoff operation id
- last error / cloud-lost reason

In addition to the high-level logical workspace state, the server must own a
separate fine-grained handoff operation record. That operation record is the
durable crash-recovery state machine for the move workflow.

### 2.2 AnyHarness runtime workspace access state

Each AnyHarness runtime needs its own small durable access-state row for each
workspace execution surface.

Recommended modes:

- `normal`
- `frozen_for_handoff`
- `remote_owned`

This is not product state. It is runtime enforcement state.

The runtime access row should include:

- `workspace_id`
- `mode`
- `handoff_op_id`
- `updated_at`

### 2.3 Desktop state

Desktop should not own authoritative handoff truth.

Desktop owns:

- query-backed view of server handoff state
- query-backed view of runtime preflight/install state
- ephemeral local UI state:
  - dialog open/closed
  - local animation / affordance state

React Query remains the authoritative frontend cache for remote/server/runtime
state. Do not introduce a separate mobility Zustand cache for owner or handoff
phase.

## 3. Ownership and responsibility split

### 3.1 Server / control plane owns

- logical workspace identity
- handoff operation lifecycle
- authoritative owner
- cloud provisioning
- cloud-lost state
- repo-config exclusion-set calculation

Keep this in the existing `server/cloud/**` domain:

- `server/cloud/mobility/**`
- `server/cloud/workspaces/**`
- `db/store/cloud_mobility.py`
- `db/store/cloud_workspaces.py`

### 3.2 AnyHarness owns

- source runtime preflight
- source freeze / destination remote-owned mode
- central mutation gate
- archive export
- archive install
- cleanup of moved supported sessions
- provider-native session portability

Keep the logic aligned with the runtime ownership rules:

- `mobility/` as orchestrator only
- `git/` owns git delta discovery
- `sessions/` owns durable session bundle export/import
- `agents/` owns provider-native session portability
- `workspaces/` owns runtime access-state gate

### 3.3 Desktop owns

- handoff initiation
- local-runtime proxy calls that the server cannot perform directly
- archive relay between runtimes
- confirmation UX
- selection/runtime reconnection
- phase rendering and animation

Desktop does not own the authoritative handoff state machine. It is a transient
executor and renderer. The server owns durable phase progression, timeout, and
recovery.

### 3.4 SDK owns

- generic AnyHarness mobility endpoints and types
- generic React hooks for those endpoints

Do not add ad hoc desktop-only wrappers for generic AnyHarness mobility
resources.

The AnyHarness contract must stay generic:

- generic fields such as `excludedPaths`, `baseCommitSha`, and session summaries
  are fine
- repo-config policy and cloud-provisioning policy stay in
  `server/cloud/mobility/**` and app-layer orchestration

## 4. Supported session behavior

v1 moves:

- Claude
- Codex

v1 skips:

- Gemini

Per-workspace behavior:

- supported sessions are moved
- unsupported sessions remain on the source side
- unsupported idle sessions do not block handoff
- unsupported actively running sessions do block handoff

The UI must make skipped sessions explicit at preflight and during the
workspace-owned-elsewhere state.

## 5. End-to-end handoff workflow

### Phase 0: Idle

Server logical state:

- `local_active` or `cloud_active`

Runtime access modes:

- owner side: `normal`
- non-owner side: `remote_owned` or absent

### Phase 1: Source runtime preflight

Desktop calls source AnyHarness:

- `POST /v1/workspaces/{workspace_id}/mobility/preflight`

This endpoint should return:

- current branch name
- current `HEAD` SHA
- `can_move`
- blocking reasons
- syncable session summary
- unsupported-session summary

Runtime preflight must compute:

- whether any session is actively running
- whether any pending approval exists
- whether any pending prompt exists
- whether setup is running
- which sessions are mobility-supported
- which unsupported sessions are present

This logic belongs in a mobility orchestrator that composes:

- `workspaces/`
- `sessions/`
- `acp/`
- `agents/`

### Phase 2: Server preflight

Desktop calls server mobility preflight.

The server must:

- verify the source branch exists remotely
- verify the source SHA can be materialized on the destination
- calculate repo-config/provisioning-owned exclusions

For `local -> cloud`, this means validating cloud can provision the exact ref.

For `cloud -> local`, this means validating local destination preparation will
be able to fetch and check out the exact source ref.

### Phase 3: User confirmation

Desktop shows the confirmation dialog below-chat-input action flow.

The dialog must show:

- source and destination
- branch / base SHA basis
- supported sessions that will move
- unsupported sessions that will be skipped
- blockers if the move is currently disallowed

### Phase 4: Start handoff operation

Desktop calls server:

- `start handoff`

The server should create or advance a durable handoff operation record with:

- `handoff_op_id`
- logical workspace id
- source owner
- destination owner
- source branch
- source base SHA
- current phase
- timestamps
- heartbeat / timeout fields

The server is the durable handoff state-machine owner.

Desktop may trigger and report steps, but the server owns:

- legal phase transitions
- timeout / heartbeat expiry
- recovery from partially completed operations

Important: the server should not expose the logical workspace as fully
`moving_to_cloud` / `moving_to_local` until source freeze has actually been
acknowledged. The earlier “start requested” state belongs in the handoff
operation record, not only in desktop memory.

### Phase 5: Freeze source runtime

Desktop calls source AnyHarness:

- `PUT /v1/workspaces/{workspace_id}/mobility/runtime-state`

Set:

- `mode = frozen_for_handoff`
- `handoff_op_id`

Once frozen, the workspace may not accept mutations.

The same endpoint is also the source-side deactivation mechanism later in the
workflow. The transport shape should explicitly support both transitions:

- `normal -> frozen_for_handoff` during export preparation
- `frozen_for_handoff -> remote_owned` during pre-finalize deactivation

This freeze must survive runtime restart.

After source freeze succeeds, desktop reports that completion to the server and
the server advances the handoff op to `source_frozen`. This is the point where
the logical workspace may safely be treated as actively moving.

### Phase 6: Prepare destination base

#### Local -> cloud

Server/cloud provisioning owns this phase.

Add a new exact-ref provisioning mode to the cloud workspace service instead of
reusing the current "new branch from base branch" logic.

The new mode must:

- clone/fetch the repo
- check out the source branch
- check out or reset to the exact source SHA
- apply repo-config owned files / env / setup-owned state as part of normal
  control-plane provisioning

#### Cloud -> local

Local AnyHarness owns this phase.

Add a destination-prep operation that:

- fetches the source branch
- checks out the source branch
- resets the local repo root to the exact source SHA

This must happen before archive install because the archive only carries delta,
not commits.

### Phase 7: Wait for destination runtime ready

There is an explicit wait phase between provisioning and archive transfer.

Desktop or server-driven orchestration must wait until the destination
AnyHarness runtime is:

- reachable
- healthy
- attached to the prepared workspace

For `local -> cloud`, this means the cloud runtime is fully booted and its
AnyHarness workspace exists.

The server should advance the durable handoff operation when cloud-side runtime
readiness is known. Desktop then polls and renders that phase.

### Phase 8: Export archive from source

Desktop calls source AnyHarness:

- `POST /v1/workspaces/{workspace_id}/mobility/export`

The archive is only the portable mutable payload. It does not provision the
destination.

Archive contents:

- validation metadata:
  - branch name
  - base commit SHA
- repo delta:
  - tracked modified files
  - tracked deleted files
  - untracked non-ignored files
- durable AnyHarness session state
- provider-native session bundles for supported sessions

The export request also carries the exclusion set from the server so the source
runtime does not export provisioning-owned files.

After export succeeds, desktop reports summary metadata back to the server-owned
handoff operation.

### Phase 9: Install archive on destination

Desktop sends the archive to destination AnyHarness:

- `POST /v1/workspaces/{workspace_id}/mobility/install`

Destination AnyHarness must:

- validate archive shape
- validate path safety
- validate `destination HEAD == archive base SHA`
- apply deletions
- apply changed and untracked files
- import durable AnyHarness session state into the destination sqlite,
  remapped to the destination workspace id
- install provider-native session bundles

The installer should remain deterministic and explicit:

- no merge logic
- no repo provisioning logic
- no broad transcript rewriting

After install succeeds, desktop reports completion back to the server-owned
handoff operation.

### Phase 10: Source deactivation

Before the owner flips, the source must stop looking like a live resumable
target.

Desktop calls source AnyHarness:

- `PUT /v1/workspaces/{workspace_id}/mobility/runtime-state`

Set:

- `mode = remote_owned`
- `handoff_op_id`
- `moved_supported_session_ids`

This is a distinct step from cleanup. It is the pre-finalize deactivation
operation, even though it reuses the same runtime-state endpoint as Phase 5.

This phase must:

- switch the source workspace runtime mode to `remote_owned`
- make moved supported sessions non-runnable on the source side

This phase exists to avoid a crash window where the server has already flipped
ownership but the source still appears to be a live writable/resumable copy.

### Phase 11: Finalize owner flip

Desktop calls server:

- `finalize handoff`

The server:

- flips the authoritative owner
- moves the logical workspace to `local_active` or `cloud_active`
- marks the handoff op as `cleanup_pending`

Only after this step is the destination the real live workspace.

### Phase 12: Source cleanup / garbage collection

Desktop calls source AnyHarness:

- `POST /v1/workspaces/{workspace_id}/mobility/cleanup`

Source AnyHarness must:

- delete or tombstone moved supported sessions
- remove provider-native artifacts for moved supported sessions where
  appropriate
- preserve skipped unsupported sessions
- keep the source workspace in `remote_owned`

This prevents stale local copies of moved supported sessions from being treated
as live in future handoffs.

The handoff op remains open until this phase succeeds. The durable server-owned
handoff lifecycle must therefore include post-finalize states such as:

- `cleanup_pending`
- `cleanup_failed`
- `completed`

If desktop crashes after finalize but before cleanup completes, the server still
has a durable outstanding cleanup responsibility. Desktop may re-drive that
cleanup on reconnect, but the server remains the durable owner of the retryable
state.

## 6. AnyHarness runtime design

### 6.1 Transport surface

Add a generic mobility resource family to the AnyHarness contract:

- `preflight`
- `runtime-state update` (freeze + pre-finalize deactivation)
- `export`
- `install`
- `cleanup`

Keep the flow consistent with runtime ownership rules:

- `anyharness-contract` owns wire shapes only
- `api/http/` owns transport translation only
- runtime logic lives in `anyharness-lib`

The contract remains intentionally generic. It should not absorb Proliferate
cloud policy:

- `excludedPaths` is a good contract field
- “repo-config-managed tracked-file exclusion policy” is not a contract concern

### 6.2 Mobility orchestration area

Add an orchestration-only mobility area to `anyharness-lib`, for example:

- `mobility/mod.rs`
- `mobility/model.rs`
- `mobility/orchestrator.rs`

This area should compose the existing owners. It should not reimplement their
logic.

Current branch note:

- existing code uses `mobility/mod.rs` + `mobility/service.rs`
- target shape should migrate internal data structs into `mobility/model.rs`
  and the cross-domain workflow into `mobility/orchestrator.rs` (or equivalent)

### 6.3 Workspace access gate

Add a central access gate in `workspaces/`, for example:

- `workspaces/access_store.rs`
- `workspaces/access_service.rs`

This service should own:

- durable runtime mode lookup
- `assert_can_mutate(workspace_id)`
- `assert_can_start_live_session(workspace_id, session_id)`
- updates to `normal | frozen_for_handoff | remote_owned`

Every workspace-scoped mutator and live-session bootstrap path must go through
this gate.

This explicitly includes:

- `create_session`
- `resume_session`
- `ensure_live_session`
- prompt/config/cancel/approval actions
- file writes
- git mutations
- process start / mutation
- terminal create/input/delete
- setup/worktree actions

`remote_owned` is therefore stronger than “read-only.” It means the source copy
may not be used to create or resume a live agent session.

### 6.4 Git delta discovery

Keep repo delta discovery in `git/`.

Recommended addition:

- `git/mobility_delta.rs`

Responsibilities:

- collect tracked modifications
- collect tracked deletions
- collect untracked non-ignored files
- apply exclusion filtering

Current branch note:

- the current export/install implementation keeps delta discovery inside
  `mobility/service.rs`
- implementation should move that logic into `git/` to match ownership rules

### 6.5 Session durable bundle

Keep durable session export/import in `sessions/`.

Recommended additions:

- `sessions/mobility_bundle.rs`
- service methods for:
  - export session bundle by session id
  - import session bundle into destination workspace
  - mark moved supported sessions non-runnable before finalize
  - tombstone/delete moved sessions after finalize

Exported AnyHarness session state must include:

- session row
- event rows
- live config snapshot
- pending config changes
- pending prompts
- raw notifications

### 6.6 Agent-native session portability

Keep provider-native portability in `agents/`.

Recommended structure:

- `agents/portability/mod.rs`
- `agents/portability/claude.rs`
- `agents/portability/codex.rs`

Do not put provider-native session rules in the mobility orchestrator.

The orchestrator should dispatch based on:

- `session.agent_kind`
- `session.native_session_id`

Current branch note:

- the current implementation keeps provider artifact logic in
  `mobility/agent_artifacts.rs`
- implementation should move that logic into `agents/portability/**`

#### Claude adapter

Export:

- primary transcript JSONL
- required sidecars:
  - subagents
  - remote-agents
  - tool-results
- optional plan artifacts only if needed for actual resume behavior

Install:

- compute target Claude project storage location from target workspace path
- write transcript and sidecars there
- no broad transcript rewrite

#### Codex adapter

Export:

- single rollout JSONL
- no SQLite export

Install:

- write rollout into correct date-partitioned codex session path
- prefer explicit cwd override at resume time
- only rewrite structurally necessary cwd fields if the final implementation
  proves it is required for resume correctness

### 6.7 Archive format

Use one structured archive object for v1.

The archive should contain:

- archive metadata
- repo delta entries
- deleted paths
- per-session bundles, each containing:
  - AnyHarness durable bundle
  - agent-native portability bundle

It does not need to be a literal tarball in v1. A structured JSON/body payload
is acceptable if size remains manageable.

### 6.8 Archive size limits

v1 should ship with explicit hard limits.

Use the current runtime constraints as the starting point:

- total archive body cap: 128 MiB
- per-file cap: 16 MiB

Preflight should estimate archive size and fail early when the export would
exceed those limits.

If export or install still exceeds the cap, the runtime should return a typed
over-limit error. v1 does not add chunked or multipart archive transport.

## 7. Server/control-plane design

### 7.1 Keep mobility in the cloud domain

Per backend repo-shape rules, mobility belongs in:

- `server/cloud/mobility/**`

Do not create a new top-level backend domain for this feature.

### 7.2 Service and store split

Keep:

- `api.py` thin
- `service.py` for orchestration
- `db/store/**` for DB access only

The mobility service should own:

- backfill of existing cloud workspaces into logical mobility records
- start/finalize/fail transitions
- handoff op lifecycle
- exact-ref provisioning orchestration
- cloud-lost transitions

Current branch note:

- the existing `server/cloud/mobility/service.py` currently opens DB sessions
  directly and performs ORM commit/refresh work inline
- implementation should first normalize that code to use `db/store/**` for all
  database access before the durable handoff state machine is expanded there

### 7.3 Existing cloud workspaces

Backfill all existing `CloudWorkspace` rows into mobility records as
cloud-owned logical workspaces.

This avoids running duplicate legacy and mobility workspace identity models in
parallel forever.

### 7.4 Handoff operation durability

Add a durable handoff operation record or equivalent durable fields sufficient
to recover from:

- desktop crash mid-handoff
- destination provisioning delay
- export/install failure

The operation should track:

- phase
- timestamps
- source/destination
- source branch / SHA
- failure reason
- heartbeat / timeout

The phase set must cover the full lifecycle, including post-finalize cleanup,
for example:

- `start_requested`
- `source_frozen`
- `destination_ready`
- `install_succeeded`
- `cleanup_pending`
- `cleanup_failed`
- `completed`

## 8. Desktop design

### 8.1 Domain model

Keep the logical workspace as a derived domain object in:

- `lib/domain/workspaces/**`

Desktop should derive one logical workspace from:

- local AnyHarness workspaces
- cloud materializations
- mobility records

Use repo + branch grouping.

### 8.2 Loading rules

Mobility records must not only load when "cloud active" in the old sense. A
cloud-owned logical workspace still exists even if the cloud materialization is
currently missing or unavailable.

### 8.3 Workflow hooks

Split the workflow into small hooks plus a pure reducer. Avoid a single god
hook.

Suggested hooks:

- `use-mobility-preflight.ts`
- `use-start-handoff.ts`
- `use-export-install-handoff.ts`
- `use-finalize-handoff.ts`
- `handoff-reducer.ts`

These hooks own UI-facing orchestration only. They do not become a second
authoritative handoff state machine.

### 8.4 UI placement

Primary action:

- below the chat input

Confirmation:

- modal/dialog owned by the workspace/chat product area

In-progress state:

- existing composer/workspace status surfaces above the chat input
- disabled composer
- phase text
- transient animation

v1 should not introduce a fifth independent composer top-slot inhabitant for
handoff progress.

Instead:

- the action lives below the chat input
- confirmation is a modal/dialog
- in-progress / failed handoff status extends the workspace status panel path
  above the composer
- `CloudRuntimeAttachedPanel` remains responsible for raw cloud runtime
  connect/resume/error states

### 8.5 Selection and runtime target resolution

Desktop must route logical workspace selection to the current concrete owner:

- local owner -> local AnyHarness workspace id
- cloud owner -> cloud workspace connection / temporary internal synthetic
  translation only if still required during the refactor

Shipping cutover requirement:

- the old cloud-only sidebar/action flow is removed in the same feature slice
- logical workspaces become the only user-facing workspace identity model
- any remaining synthetic-id translation stays internal to runtime-target
  resolution, not the sidebar/domain model

## 9. Failure model

### 9.1 Before finalize

If any phase before finalize fails:

- server moves logical workspace to `handoff_failed`
- source runtime is restored to `normal`
- source remains authoritative
- destination remains non-authoritative

### 9.2 After finalize

Finalize only flips the authoritative owner. It does not close the handoff
operation.

After finalize:

- the server records `cleanup_pending`
- source runtime remains `remote_owned`
- source cleanup is retried until success or a durable `cleanup_failed` state
  is recorded

Only after cleanup succeeds should the handoff op be marked `completed`.

If destination later disappears unexpectedly while cloud-owned:

- server sets `cloud_lost`
- UI shows support-only error state
- no automatic local reclaim in v1

## 10. Testing plan

### 10.1 Runtime/unit coverage

- preflight blocks running sessions
- unsupported idle sessions are skipped
- unsupported running sessions block
- access gate blocks all mutators in frozen/remote-owned modes
- access gate blocks `create_session`, `resume_session`, and
  `ensure_live_session` in frozen/remote-owned modes
- archive export excludes provisioning-owned paths
- install rejects base mismatch
- pre-finalize deactivation marks moved supported sessions non-runnable before
  owner flip
- source cleanup deletes moved supported sessions

### 10.2 Provider portability tests

- Claude export/install round-trip preserves resume
- Codex export/install round-trip preserves resume
- no broad transcript rewrite is performed

### 10.3 Server/control-plane tests

- backfill existing cloud workspaces into mobility records
- exact-ref provisioning path
- start/finalize/fail transitions
- cleanup-pending / cleanup-failed / completed transitions
- cloud-lost transition
- handoff operation timeout / heartbeat expiry

### 10.4 Desktop tests

- logical-workspace grouping by repo + branch
- confirmation modal content
- below-input action rendering
- phase status rendering
- unsupported-session summary rendering
- workspace-status-panel integration for handoff progress/failure

### 10.5 End-to-end validation loop

Use the existing local AnyHarness + E2B-backed cloud runtime loop as the main
correctness path.

The primary real loop should validate:

- local -> cloud with dirty git state + supported sessions
- continue chatting in cloud
- cloud -> local after branch advancement
- continue chatting locally again
- unsupported idle session is skipped and surfaced correctly

## 11. Implementation order

1. Land decision docs and this plan.
2. Refactor existing mobility code into final ownership boundaries:
   - move server DB access into `db/store/**`
   - move AnyHarness internal archive types into `mobility/model.rs`
   - move AnyHarness delta discovery into `git/`
   - move provider portability into `agents/portability/**`
3. Finish AnyHarness runtime design:
   - access gate
   - preflight
   - pre-finalize deactivation via runtime-state transition
   - cleanup
   - provider portability adapters
4. Extend AnyHarness contract + SDK + sdk-react.
5. Extend server mobility service for real handoff operations and exact-ref
   provisioning.
6. Implement desktop workflow hooks.
7. Cut over the desktop to logical-workspace-only user-facing identity and
   delete old cloud-only entry paths.
8. Implement below-input action + confirmation modal + workspace-status-panel
   phase rendering.
9. Run full local `<->` cloud validation loop and iterate.
