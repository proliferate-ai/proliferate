# Workspace Pruning And Worktree Management Spec

Status: implementation spec with V1 archive-prune slice implemented.

Date: 2026-05-25

## Purpose

This spec defines the product and implementation model for workspace pruning,
worktree cleanup, archive/restore, and on-demand rehydration across Desktop,
Cloud, Web, Mobile, and worker-managed targets.

The central distinction is:

```text
Workspace = durable product record.
Worktree = filesystem materialization where runtime work happens.
```

Worktree cleanup must never mean "delete the chat." A user should be able to
keep a workspace active while its checkout is currently absent, and a user
should be able to archive a workspace without losing history, repo identity,
branch/ref, sessions, or cloud refs.

## V1 Implementation Boundary

The implemented V1 slice covers the first end-to-end storage-management path:

- Cloud workspace responses expose product lifecycle, runtime target,
  cloud-access, and primary-materialization state separately.
- Desktop selection and sidebar logic distinguish "Cloud access enabled" from
  "managed cloud runtime", so a cloud-synced local workspace continues to route
  to local Tauri/AnyHarness when it has a local materialization.
- Cloud archive/restore/purge are durable product APIs.
- Archiving a materialized target workspace queues a
  `prune_workspace_worktree` command.
- The worker handles that command by asking AnyHarness to run the existing safe
  retire/preflight path, then reports materialization state and cleanup status
  back to Cloud.
- Cloud stores the report, preserves the workspace record/history, and removes
  inactive worker exposure from active sync after successful dehydration.

The V1 slice intentionally does not claim full active lazy rehydration or cache
cleanup. Those need the AnyHarness materialization contract described below:
either identity-preserving dehydrate/rehydrate APIs, or a generation-remapping
contract that can recreate a target worktree and bridge session projections
under the same Cloud workspace id.

## End-State UX

### Active Workspaces

Most active workspaces can have their worktrees silently pruned in the
background when they are clean, old enough, not pinned, and not running work.
They remain visible in the normal workspace list.

When the user selects an active workspace whose worktree has been pruned:

```text
1. The transcript and session history load immediately from durable state.
2. Files, terminal, and new agent actions show a restorable/dehydrated state.
3. No checkout is created only because the chat was selected.
4. The first runtime-demand action rehydrates the checkout from repo +
   branch/ref + workspace config.
5. The original action resumes after hydration.
```

The user should see "restoring workspace" only once hydration is actually
needed. They should not see a dead workspace, a missing folder error, or a
cloud-sandbox resume screen when the selected runtime is the local desktop
target.

### Archive

Archive is explicit user intent. It is not just a sidebar filter.

When the user archives a workspace:

```text
1. The workspace immediately leaves the active workspace list.
2. The workspace appears in the Archived chats settings page.
3. The workspace record, sessions, transcript, repo identity, branch/ref,
   cloud refs, and ownership remain durable.
4. The system attempts to prune the worktree.
```

If the worktree is safe to remove, the checkout is deleted and the workspace is
archived + dehydrated.

If the worktree is not safe to remove, the workspace still remains archived, but
Archived chats shows a cleanup attention state with the blocker. Examples:

- uncommitted changes
- conflicts
- live session
- active terminal
- queued prompt
- running operation

This keeps the product semantics clear: archive hides the workspace from normal
work, while cleanup safety remains strict and visible.

### Restore

Restoring an archived workspace:

```text
1. Moves it back to active workspaces.
2. Keeps the same durable workspace id and history.
3. Rehydrates the worktree on demand when the user opens files, starts a
   terminal, sends a prompt, or otherwise needs runtime access.
```

Restore should feel like "bring this workspace back" rather than "create a new
workspace from scratch."

### Delete / Purge

Delete/purge is the only destructive product operation. It requires explicit
confirmation and removes the product record and durable history according to
the relevant retention policy.

Prune, archive, and restore must not be overloaded to mean delete.

## Non-Goals

Do not automatically delete workspace records or chat/session history.

Do not auto-prune dirty work unless a separate reliable checkpoint/snapshot
system exists and the product has adopted it explicitly.

Do not prune arbitrary user folders outside Proliferate-managed worktree roots.

Do not make Desktop local sidebar archive a local-only preference long term.
Archive needs to become durable product lifecycle state.

Do not make Cloud directly delete target files. Cloud owns intent and policy;
the target runtime owns filesystem safety and execution.

## Local QA Requirement

This feature must be QA'd in a profile-isolated full-stack worktree, not only
through unit tests or a shared `main` dev profile.

Use the profile-aware workflow:

```bash
make dev-init PROFILE=<name>
make dev PROFILE=<name>
```

For a worktree-specific QA pass, copy the developer's local env files into the
worktree before startup:

```text
.env
.env.local
.env.prod
server/.env
server/.env.local
```

These files contain local secrets and must remain uncommitted.

After startup, the user should log in through the worktree's local app/web
surface. The resulting auth/session state is part of the QA fixture. This is
important because the highest-risk bugs are not pure UI states; they involve
authenticated Cloud records, local Desktop runtime state, cloud access exposure,
and target selection.

The minimum manual QA profile should cover:

- enabling Cloud access for a local Desktop workspace
- reloading that cloud-synced local workspace
- confirming the UI reconnects to local Tauri/AnyHarness, not a managed cloud
  sandbox
- confirming cloud-access indicators do not imply cloud-sandbox execution
- archiving a workspace and seeing it move to Archived immediately
- restoring the same workspace id and history from Archived
- exercising a cleanup blocker with dirty work, if practical

Profile state should live under:

```text
~/.proliferate-local/dev/profiles/<name>/
~/.proliferate-local/runtimes/<name>/
```

## Current Code Anchors

These are the existing pieces this spec should build on rather than bypass.
Line references were checked against `main` at `dcd18490` on 2026-05-25.

### Cloud Workspace Record

`server/proliferate/db/models/cloud/workspaces.py`

- `CloudWorkspace` is the durable cloud workspace table at line 22.
- It already stores display name, Git provider/owner/repo, branch/base branch,
  `worktree_path`, runtime ids, `archived_at`, and cleanup state.
- Active uniqueness today is usually expressed as `archived_at IS NULL`.

Important current rows:

```text
CloudWorkspace.display_name
CloudWorkspace.git_provider / git_owner / git_repo_name
CloudWorkspace.git_branch / git_base_branch
CloudWorkspace.worktree_path
CloudWorkspace.active_sandbox_id
CloudWorkspace.anyharness_workspace_id
CloudWorkspace.archived_at
CloudWorkspace.cleanup_state
```

Useful current lines:

```text
22   class CloudWorkspace
108  display_name
109  git_provider
115  worktree_path
133  active_sandbox_id
179  archived_at
180  cleanup_state
```

`server/proliferate/db/store/cloud_workspaces.py`

- `archive_cloud_workspace_record(...)` starts at line 562.
- It currently marks `archived_at`, status
  `archived`, and cleanup state `pending`.
- This is close to the desired product archive path, but cleanup semantics need
  to become materialization-specific and report blocker states clearly.

### Cloud Worktree Policy

`server/proliferate/constants/cloud.py`

- `DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO = 20` at line 349.

`server/proliferate/db/models/cloud/worktree_policy.py`

- `CloudWorktreeRetentionPolicy` starts at line 12.
- It stores
  `max_materialized_worktrees_per_repo` with a 10-100 bounds check.

`server/proliferate/server/cloud/worktree_policy/**`

- Cloud already exposes get/set APIs for the user policy.
- This should remain the policy owner for cloud-visible product limits.

### AnyHarness Worktree Safety And Retention

`docs/anyharness/src/workspaces.md`

- AnyHarness treats workspace records as durable execution-surface identity.
- It already distinguishes local workspaces and worktree workspaces.
- It already states that worktree retention is enforced by AnyHarness and that
  control planes sync desired policy through the runtime API.

`anyharness/crates/anyharness-lib/src/api/router.rs`

- Existing worktree endpoints include:

```text
83   /worktrees/inventory
87   /worktrees/orphans/prune
91   /worktrees/retention-policy
95   /worktrees/retention/run
```

`anyharness/crates/anyharness-lib/src/workspaces/retention.rs`

- Current retention groups standard active worktree workspaces by repo.
- It enforces the materialized-worktree limit.
- It preflights, rechecks under operation lock, then removes the worktree.
- Key lines:

```text
142  list_standard_active_worktrees_by_activity
210  first preflight check
284  preflight recheck before deletion
347  retire_worktree_materialization call
```

`anyharness/crates/anyharness-lib/src/workspaces/retire_preflight.rs`

- Current preflight blocks unsafe cleanup for dirty work, conflicts, live
  sessions, active terminals, pending prompts, pending interactions, and running
  operations.
- Key lines:

```text
182  dirty work blocker
188  conflicted work blocker
277  live execution blocker gate
333  live session / terminal / prompt blockers
403  running operation blockers
```

`anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`

- `retire_worktree_materialization(...)` is the current filesystem deletion
  path at line 514 and uses `git worktree remove --force`.

### Current Desktop Archive Gap

`desktop/src/stores/preferences/workspace-ui-sidebar-actions.ts`

- Desktop sidebar archive currently stores ids in `archivedWorkspaceIds`
  starting at line 32.
- That is local UI preference state, not durable product lifecycle.

This spec replaces that long-term meaning with server/runtime-backed archive
state while preserving local responsiveness in the UI.

## Concepts

### Workspace

A workspace is a durable product record.

It owns:

- chat history
- session history and transcript projections
- repo identity
- branch/ref
- display metadata
- ownership and sharing state
- target/cloud refs
- last activity
- archive/delete lifecycle
- materialization summary

A workspace can be active even when no runnable checkout currently exists.

For Cloud-backed workspaces, `CloudWorkspace.id` is the stable product id. For
local-only workspaces, the target state should move toward the same durable
product lifecycle concept instead of relying on sidebar preference ids. Until
that migration exists, local-only archive can remain an optimistic Desktop
overlay, but product code should treat that as transitional debt.

### Worktree

A worktree is a filesystem checkout/materialization of a workspace on a target.

It owns:

- checkout path
- current file tree
- git worktree state
- generated dependency caches under that checkout
- terminal/session execution root

Pruning a worktree deletes the checkout/materialized files, not the workspace
record and not chat/session history.

### Materialization

A materialization is the binding between a durable workspace and a target's
runtime/filesystem state.

It owns:

- target id
- runtime kind
- AnyHarness workspace id, if one is currently registered
- worktree path, if hydrated
- materialization generation
- last reported state
- cleanup status, blockers, and errors
- measured storage usage

Cloud access/exposure is related but separate. A workspace can have a Cloud
record and a Cloud exposure while still executing on the local Desktop target.

### Cache

Cache cleanup is separate from worktree pruning.

Safe generated paths can be pruned inside a hydrated worktree without changing
workspace lifecycle or materialization state. Examples:

```text
node_modules
target
dist/build caches
package manager caches
tool caches under Proliferate-managed roots
```

Cache cleanup should report reclaimed bytes and should not affect chat/session
continuity.

### Archive

Archive is a durable product lifecycle state.

Archived workspaces are hidden from active work views and shown in an Archived
area. They remain recoverable and searchable.

Archive requests should also request worktree pruning, but filesystem safety can
block the cleanup step without undoing the archive.

### Rehydrate

Rehydrate restores a filesystem materialization for a workspace from durable
state:

```text
repo provider/owner/name
repo root or checkout origin
branch/base branch/ref
workspace config
cloud/target materialization config
AnyHarness workspace identity or a new materialization generation
```

Rehydration should be lazy. Selecting a dehydrated workspace should load
transcript and metadata without forcing checkout creation. Runtime-demand
actions trigger hydration:

- opening files
- starting a terminal
- sending a prompt
- explicit "restore worktree" action

If the user sends a prompt while dehydrated, the prompt should become a visible
queued prompt with copy like "restoring workspace to send", then dispatch after
hydration succeeds.

## State Model

### Product Lifecycle

Product lifecycle answers: "Should this workspace appear as usable work?"

```text
active
archived
deleted
```

`active`

- Shows in normal workspace lists.
- Can be hydrated or dehydrated.
- Can receive prompts after rehydration if needed.

`archived`

- Hidden from normal active lists.
- Shown in Settings -> Archived chats.
- Does not receive new prompts unless restored first.
- Can still have cleanup attention if its worktree could not yet be pruned.

`deleted`

- Product record and history are removed or tombstoned according to retention.
- Only explicit destructive user action should enter this state.

### Materialization State

Materialization state answers: "Does a runnable checkout exist right now?"

```text
hydrated
dehydrated
hydrating
unknown
inconsistent
```

`hydrated`

- A target has a usable checkout/worktree.
- Runtime actions can use this materialization immediately.

`dehydrated`

- Durable workspace exists but the checkout is absent.
- Transcript/history can load.
- Files/terminal/prompt dispatch require hydration first.

`hydrating`

- A target is currently restoring checkout and runtime context.

`unknown`

- Cloud has not yet received a fresh report from the owning target.

`inconsistent`

- Cloud and target disagree in a way that requires reconciliation. Examples:
  stale AnyHarness id, missing path for a supposedly hydrated workspace, or an
  exposure that points at a materialization the worker no longer recognizes.

### Cleanup Status

Cleanup status answers: "What happened when we tried to remove storage?"

```text
idle
pruning
blocked
failed
skipped
completed
```

`blocked`

- Cleanup was not safe. Store structured blockers and show attention in the
  Archived chats settings page or workspace details.

`failed`

- Cleanup attempted and failed due to an operational error, not a safety
  blocker. Store last error and retry affordance.

`skipped`

- Cleanup did not run because the policy did not select this materialization or
  because another operation superseded it.

### Runtime Target

Runtime target answers: "Where will runtime work execute?"

Required normalized shape:

```text
executionTarget.kind = local_desktop | managed_cloud | ssh | self_hosted
executionTarget.targetId
selectedMaterializationId
cloudAccess.state = disabled | enabled | enabling | error
```

Surfaces must not infer runtime target from "has cloud workspace record",
`cloudWorkspaceId`, or exposure existence.

### Why This Split Matters

The current AnyHarness `retired` lifecycle combines two ideas:

```text
not active as an execution workspace
cleanup requested/completed for a worktree path
```

For product UX, those must split:

```text
CloudWorkspace.product_lifecycle = active | archived | deleted
WorkspaceMaterialization.materialization_state = hydrated | dehydrated | ...
WorkspaceMaterialization.cleanup_status = idle | pruning | blocked | ...
```

An active workspace can be dehydrated.
An archived workspace can be cleanup-blocked.
A deleted workspace is the only product-destructive state.

## Required AnyHarness Materialization Contract

Active dehydration is not implementable by simply reusing today's AnyHarness
retirement path.

Current behavior:

- `retention.rs` ultimately calls `retire_worktree_materialization(...)`.
- The current retention path marks the AnyHarness workspace as `retired`.
- `access_gate.rs` blocks mutation for retired workspaces.

That is correct for today's "remove this worktree execution workspace" behavior,
but it does not represent "this product workspace is still active, with chat
available, and can be rehydrated later."

V1 must choose one of these runtime contracts before active auto-pruning ships:

1. Add explicit AnyHarness materialization APIs that dehydrate and rehydrate a
   worktree while preserving an active durable runtime workspace identity.
2. Treat Cloud as the stable product identity, allow rehydration to create a new
   AnyHarness workspace/materialization generation, and make transcript/session
   projections bridge old and new runtime ids under the same Cloud workspace.

Option 1 is cleaner long term. Option 2 may be faster if the existing
`ensure_repo_checkout`, `materialize_workspace`, and environment materialization
paths are used carefully. Either way, the spec must not assume that current
`retired` state can stand in for active dehydration.

Required AnyHarness capabilities:

- structured preflight for prune/cache cleanup
- operation lock and immediate pre-delete recheck
- managed-root path validation
- dehydrate worktree without deleting durable product history
- rehydrate or materialize from repo/ref/config
- report stale/missing/inconsistent materializations
- preserve or explicitly remap session/runtime identity

## Services Touched

| Area | Responsibility | Required Changes |
| --- | --- | --- |
| Cloud workspace service | Product lifecycle, archive/restore/delete, response shape | Add lifecycle fields, materialization summary, explicit archive/restore/purge APIs |
| Cloud command service | Target commands for runtime actions | Add version-gated materialization/cache command kinds only after worker support exists |
| Worker | Target orchestration | Poll policy/commands, sync policy to AnyHarness, report inventory/materialization/cleanup results |
| AnyHarness | Filesystem/runtime safety | Add or formalize active dehydrate/rehydrate semantics; keep prune safety local to target |
| SDK / SDK React | Typed product model | Expose lifecycle, target, cloud access, and materialization fields without raw endpoint leakage |
| Desktop / Web / Mobile | UX and action routing | Use product model fields; stop using cloud existence as runtime-target signal |

## Ownership

### Cloud / Server Owns

Cloud owns canonical product state and policy for Cloud-backed workspaces:

- workspace lifecycle: active, archived, deleted
- materialization desired state
- max hydrated worktrees per user/profile/target/repo
- pinned state
- archive/restore/delete user intents
- product-visible blocker and last-error summaries
- storage usage summaries reported by targets
- command queueing for target actions

Cloud does not directly manipulate target filesystem paths.

### Proliferate Worker Owns

The worker owns background orchestration on a target:

- polling Cloud for commands
- polling/syncing policy
- reporting target liveness and inventory
- asking AnyHarness to run preflight, prune, rehydrate, cache cleanup
- uploading materialization status, blockers, bytes, and command results

Automatic pruning is owned by the worker loop, but v1 candidate selection and
filesystem safety should remain inside AnyHarness after the worker syncs Cloud's
desired retention policy. If Cloud ever needs to select exact candidates, a new
candidate-scoped AnyHarness prune API is required so the runtime can still
validate and reject unsafe candidates.

### AnyHarness Owns

AnyHarness owns filesystem and runtime safety:

- managed worktree root boundaries
- canonical path checks
- dirty/conflict detection
- live session, terminal, prompt, and operation blockers
- operation locking and preflight recheck
- worktree deletion
- workspace/worktree registration
- local runtime materialization

AnyHarness should expose enough structured results for Cloud and Desktop to
show product-level state without reimplementing filesystem safety.

### Desktop / Web / Mobile Own

Surfaces own presentation and user interactions:

- active vs archived navigation
- lazy restore/dehydrated UI
- archive, restore, prune now, retry cleanup actions
- blocker resolution affordances
- local-vs-cloud target clarity

Surfaces should not infer cloud sandbox execution from "has cloud workspace
record." Runtime selection must come from target/materialization ownership.

## Data Model Additions

Use a separate materialization table in v1 if feasible. It is the least
ambiguous representation because one durable workspace may eventually have
materializations on multiple targets.

Recommended shape:

```text
cloud_workspaces
  id
  owner_scope / owner_id
  product_lifecycle: active | archived | deleted
  archived_at
  deleted_at
  pinned_at
  last_opened_at
  last_activity_at
  git_provider / git_owner / git_repo_name / normalized_repo_key
  git_branch / git_base_branch / git_ref
  display_name
  durable workspace/session metadata...

cloud_workspace_materializations
  id
  cloud_workspace_id
  target_id
  exposure_id nullable
  anyharness_workspace_id nullable
  worktree_path nullable
  execution_target_kind: local_desktop | managed_cloud | ssh | self_hosted
  materialization_state: hydrated | dehydrated | hydrating | unknown | inconsistent
  cleanup_status: idle | pruning | blocked | failed | skipped | completed
  desired_state: hydrated | dehydrated
  generation
  last_command_id nullable
  state_reason
  blockers_json
  error_code
  error_message
  retryable
  last_reported_at
  last_hydrated_at
  last_dehydrated_at
  last_prune_attempted_at
  last_prune_completed_at
  reclaimed_bytes
  storage_bytes
  cache_bytes
  measured_at
```

Recommended uniqueness:

```text
cloud_workspaces(owner_scope, owner_id, normalized_repo_key, git_branch)
  WHERE product_lifecycle = 'active'

cloud_workspace_materializations(target_id, anyharness_workspace_id)
  WHERE anyharness_workspace_id IS NOT NULL

cloud_workspace_materializations(target_id, worktree_path)
  WHERE materialization_state = 'hydrated' AND worktree_path IS NOT NULL
```

Migration note:

- Existing `archived_at` is already used for active uniqueness and list
  filtering. For v1, add `product_lifecycle` and keep `archived_at` as an
  indexed compatibility mirror for archived workspaces until all call sites are
  migrated.
- Existing `cleanup_state` can remain as a compatibility projection, but new
  service code should derive UI state from materialization `cleanup_status`.
- If implementation temporarily stores the primary materialization on
  `cloud_workspaces`, the service and SDK response must still expose the shape
  described below so UI and mobile do not learn the temporary storage layout.

Exposure/projection rule:

- Dehydrating a worktree must not revoke Cloud access by itself.
- Dehydrating a worktree must not erase transcript projections.
- Exposure state answers whether cloud surfaces can reach a target.
- Materialization state answers whether runtime actions can execute immediately.

## API And Response Contract

Workspace list/detail responses should expose product, materialization, target,
and cloud-access state explicitly.

Representative shape:

```json
{
  "id": "cloud_workspace_id",
  "displayName": "proliferate",
  "productLifecycle": "active",
  "pinned": false,
  "repo": {
    "provider": "github",
    "owner": "proliferate-ai",
    "name": "proliferate",
    "branch": "main",
    "ref": null
  },
  "executionTarget": {
    "kind": "local_desktop",
    "targetId": "target_id",
    "label": "Pablo's MacBook Pro",
    "online": true
  },
  "cloudAccess": {
    "state": "enabled",
    "exposureId": "exposure_id",
    "exposureRevision": 1
  },
  "primaryMaterialization": {
    "id": "materialization_id",
    "targetId": "target_id",
    "anyharnessWorkspaceId": "optional_runtime_id",
    "state": "dehydrated",
    "desiredState": "hydrated",
    "cleanupStatus": "idle",
    "generation": 3,
    "blockers": [],
    "lastError": null,
    "storageBytes": 123456
  },
  "materializations": []
}
```

Deprecated compatibility fields such as `workspaceStatus`, `visibility`, and
top-level `archivedAt` may remain during migration, but new UI must not use them
as lifecycle truth.

Required product APIs:

```text
GET    /v1/cloud/workspaces?lifecycle=active|archived|all
POST   /v1/cloud/workspaces/{workspace_id}/archive
POST   /v1/cloud/workspaces/{workspace_id}/restore
POST   /v1/cloud/workspaces/{workspace_id}/purge
POST   /v1/cloud/workspaces/{workspace_id}/materializations/{id}/prune
POST   /v1/cloud/workspaces/{workspace_id}/materializations/{id}/hydrate
POST   /v1/cloud/workspaces/{workspace_id}/materializations/{id}/clean-caches
POST   /v1/cloud/worker/materialization-reports
```

API requirements:

- Archive/restore/purge are idempotent for repeated client retries.
- Archive/restore/purge authorize against workspace ownership/sharing, not only
  target reachability.
- Restore handles active uniqueness conflicts explicitly. If a restored
  workspace collides with an active workspace, return a structured conflict
  instead of silently creating a duplicate.
- SDK React invalidates active, archived, all, workspace detail, command, and
  cloud exposure query keys after mutations.
- `deleteCloudWorkspace` must be migrated or wrapped so callers choose between
  archive, restore, and purge intentionally.

## Interfaces And Commands

Do not add product command names unless both Cloud and worker understand them.
Unknown `CloudCommandKind` values are rejected by the current dispatch/mapping
path.

Potential CloudCommand kinds after worker support exists:

```text
prune_workspace_worktree
clean_workspace_caches
hydrate_workspace_materialization
```

`hydrate_workspace_materialization`

- input: workspace id, materialization id, target id, repo identity/ref,
  desired path/worktree mode, materialization config version
- output: AnyHarness workspace id or remapped generation, worktree path,
  materialization state, storage summary

`prune_workspace_worktree`

- input: workspace id, materialization id, target id, expected AnyHarness
  workspace id/path, reason `auto_retention | archive | manual`
- output: materialization state, cleanup status, blockers or error, reclaimed
  bytes

`clean_workspace_caches`

- input: workspace id, materialization id, target id, safe path policy version
- output: reclaimed bytes, cleaned paths summary, blockers or error

Inventory and materialization status are worker report endpoints/events, not
commands. The worker reports what exists on the target; Cloud commands express
user or policy intent.

Phase-one rehydration can be a product flow that uses existing runtime APIs:

```text
ensure_repo_checkout
materialize_workspace
materialize_environment
```

That phase must still report the resulting materialization id/generation back to
Cloud.

## Policies

### Automatic Worktree Pruning

Automatic pruning selects candidates only from active workspaces whose
materialization is safe to remove.

V1 policy split:

- Cloud stores desired policy and product-visible limits.
- Worker syncs desired policy to AnyHarness.
- AnyHarness computes and enforces candidates for its managed target.
- Worker reports results and blockers back to Cloud.

Keep hydrated:

- live sessions
- active terminals
- queued prompts or pending interactions
- running operations
- pinned workspaces
- recently used workspaces
- dirty or conflicted workspaces
- workspaces outside Proliferate-managed roots
- workspaces with unresolved cleanup blockers

Eligible:

- active
- clean
- not live
- not recently used
- not pinned
- under a managed worktree root
- over the configured per-repo/per-target hydration limit

Result:

- product lifecycle remains `active`
- materialization state becomes `dehydrated`
- cleanup status becomes `completed`
- transcript/session history remain available

### Archive Pruning

Archive pruning is requested immediately when the product lifecycle becomes
`archived`.

If cleanup succeeds:

```text
product_lifecycle = archived
materialization_state = dehydrated
cleanup_status = completed
```

If cleanup is blocked:

```text
product_lifecycle = archived
materialization_state = hydrated
cleanup_status = blocked
blockers = structured safety blockers
```

If cleanup fails operationally:

```text
product_lifecycle = archived
materialization_state = hydrated | unknown
cleanup_status = failed
last_error = structured operational error
```

### Cache Cleanup

Cache cleanup may run on hydrated active or archived workspaces when safe.

It must not change product lifecycle or materialization state. It updates
storage metrics and last cache cleanup result only.

## Flows

### 1. Automatic Active Worktree Prune

```text
1. Worker reports inventory and target liveness.
2. Worker loads Cloud worktree retention policy.
3. Worker syncs desired retention policy to AnyHarness.
4. AnyHarness computes candidate active workspaces over the hydrated limit.
5. AnyHarness preflights candidates.
6. AnyHarness rejects unsafe candidates with structured blockers.
7. AnyHarness rechecks safe candidates under operation lock.
8. AnyHarness deletes the worktree checkout.
9. Worker reports materialization_state=dehydrated, cleanup_status=completed,
   blockers/failures, and reclaimed bytes.
10. Cloud updates product-visible materialization summary.
```

Invariant:

```text
The workspace remains active the whole time.
```

### 2. Select Dehydrated Active Workspace

```text
1. User selects active workspace.
2. Surface loads transcript/session history from durable Cloud/Desktop state.
3. Surface notices materialization_state=dehydrated.
4. Surface shows files/terminal/runtime controls in a restorable state.
5. No checkout is created solely because the user selected the workspace.
```

Runtime destination must come from `executionTarget` and selected
materialization, not from whether the workspace also has a Cloud sync record.

### 3. Runtime Action On Dehydrated Workspace

```text
1. User opens files, starts terminal, sends prompt, or clicks restore worktree.
2. Surface marks the action as waiting on hydration.
3. Cloud queues hydrate command for the selected target, or Desktop calls local
   AnyHarness directly for local-only work.
4. Worker ensures repo checkout, worktree, AnyHarness workspace registration,
   environment config, and materialization summary.
5. Worker reports materialization_state=hydrated.
6. Surface resumes the original action.
```

For a prompt, the user should see the prompt in the conversation immediately as
queued or pending, not lose text while hydration runs.

### 4. Archive Workspace

```text
1. User clicks Archive.
2. Cloud marks product_lifecycle=archived.
3. Workspace leaves active lists and appears in Archived chats under Settings.
4. A prune intent is created for the relevant materialization.
5. Worker/AnyHarness attempts safe prune.
6. Archived item shows either clean archived state, cleanup blocker, or cleanup
   failure.
```

Archive is immediate from the product point of view. Cleanup may lag or need
attention.

### 5. Restore Archived Workspace

```text
1. User opens Settings -> Archived chats and clicks Unarchive.
2. Cloud checks active uniqueness for the repo/branch/owner scope.
3. Cloud marks product_lifecycle=active or returns a structured conflict.
4. Workspace returns to active lists.
5. If materialization_state=dehydrated, runtime access triggers hydration.
6. Rehydration uses saved repo identity, branch/ref, workspace config, and
   target materialization config.
```

No new product workspace should be created unless the old one was deleted.

### 6. Manual Prune Now

```text
1. User chooses Prune worktree now.
2. Surface shows preflight result if blocked.
3. If safe, target prunes worktree.
4. Active workspace remains active but becomes dehydrated.
```

Manual prune is not archive. It is a storage action.

### 7. Delete / Purge

```text
1. User chooses Delete/Purge.
2. Surface explains destructive consequence.
3. User confirms.
4. Cloud deletes or tombstones workspace product records and schedules
   filesystem cleanup.
5. Pending commands for the workspace are cancelled or ignored by generation.
```

Delete/purge can include stronger cleanup behavior because the user explicitly
asked for destruction.

## Surface State Matrix

| State | Placement | Primary Copy | Enabled Actions | Disabled Actions | Badge |
| --- | --- | --- | --- | --- | --- |
| active + hydrated | Active list | Normal workspace name | open files, terminal, prompt, archive, prune now | none | optional target icon |
| active + dehydrated | Active list | Normal name; runtime controls say "restore worktree" | transcript, archive, hydrate | files/terminal/prompt until hydration starts | subtle storage/restorable dot |
| active + hydrating | Active list | "Restoring workspace..." | transcript, cancel if supported | destructive prune | spinner/progress |
| active + pruning | Active list | "Cleaning up worktree..." | transcript | files/terminal/prompt until result | cleanup progress |
| archived + dehydrated | Archived chats settings page | Normal name, archived | unarchive, purge | prompt/terminal | archived icon plus restorable |
| archived + cleanup blocked | Archived chats settings page | "Cleanup needs attention" | unarchive, view blockers, retry prune, purge | prompt until restore | attention badge |
| archived + cleanup failed | Archived chats settings page | "Cleanup failed" | retry cleanup, unarchive, purge | prompt until restore | attention badge |

## Sidebar And Runtime Target Contract

Sidebar and workspace-shell view models should come from one shared product
model, not duplicated inference in Desktop and Web.

Required view-model fields:

```text
workspaceId
productLifecycle
listPlacement: active | archived | hidden
archivedCount
executionTarget.kind
executionTarget.label
cloudAccess.state
primaryMaterialization.state
primaryMaterialization.cleanupStatus
cleanupAttention
enabledActions
selectedArchivedReadOnly
```

UI rules:

- Cloud access enabled should remain visible as an access indicator.
- Cloud access enabled must not use the same icon/copy as managed cloud runtime.
- Active/dehydrated workspaces stay in the active list.
- Archived workspaces move to the Archived chats settings page, not a mere
  filter or top-level daily navigation item.
- Local preference ids can provide optimistic latency hiding, but must reconcile
  to durable product lifecycle.

## Permissions And Identity

Lifecycle mutations require workspace ownership or an explicit permission grant.

Runtime actions require:

- a selected materialization target
- target online or command queued semantics
- worker version support for the requested command
- active product lifecycle unless the action is restore/purge/cleanup

Identity requirements:

- `CloudWorkspace.id` remains stable across archive/restore/dehydrate/rehydrate.
- Materialization `generation` increments when runtime identity/path is remapped.
- Worker command results include the expected generation or command id to avoid
  stale reports reviving old state.
- Sessions/transcript projections remain attached to the stable Cloud workspace
  even if the AnyHarness workspace id changes.

## Failure Model

Persist failures as structured state, not only log lines.

Required categories:

```text
blocked_dirty_work
blocked_conflicts
blocked_live_session
blocked_active_terminal
blocked_pending_prompt
blocked_running_operation
target_offline
command_expired
missing_runtime_workspace
stale_materialization_generation
restore_conflict
path_outside_managed_root
operation_failed
inconsistent_report
```

Required behavior:

- Target offline: show queued/offline state; do not mark prune failed until the
  command expires or policy decides to skip.
- Command expiry: keep product lifecycle intact and expose retry.
- Open while pruning: allow transcript; runtime actions wait for prune result
  and then hydrate if needed.
- Delete racing commands: command results must be ignored if workspace is
  deleted or generation no longer matches.
- Stale AnyHarness id: report `inconsistent`, then reconcile by inventory or
  explicit rematerialization.
- Restore conflict: return a user-actionable conflict instead of creating a new
  workspace silently.

## Safety Rules

Never auto-prune:

- uncommitted work
- conflicted work
- ambiguous git operation state
- live sessions
- active terminals
- pending prompts
- pending interactions
- running operations
- worktrees outside Proliferate-managed roots
- arbitrary user folders

Always:

- preflight before cleanup
- recheck under operation lock immediately before deletion
- preserve durable workspace/session history for prune/archive
- report blockers structurally
- make delete/purge explicit

## Verification

Automated tests:

- Cloud workspace service unit tests for active/archived/deleted lifecycle,
  restore conflicts, idempotent archive/restore/purge, and compatibility
  `archived_at` behavior.
- Cloud materialization service tests for state transitions, stale generation
  reports, target offline, command expiry, and cleanup blocker persistence.
- API/SDK tests for response shape and query invalidation.
- Worker command/report tests for supported command kinds and unknown command
  rejection.
- AnyHarness tests proving active dehydration does not use retired-workspace
  mutation-blocking semantics.
- Dirty-work fixture proving auto-prune and archive cleanup preserve user work
  and surface blockers.

Manual profile QA:

- Use `make dev-init PROFILE=<name>` and `make dev PROFILE=<name>` from a
  separate worktree with copied local env files.
- Enable Cloud access for a local Desktop workspace.
- Reload that cloud-synced local workspace and confirm local Tauri/AnyHarness is
  the runtime target, not managed cloud.
- Archive a clean workspace and confirm it leaves Active immediately and lands
  in Archived.
- Archive a dirty workspace and confirm archive succeeds while cleanup attention
  explains the blocker.
- Restore an archived workspace and confirm the same Cloud workspace id/history
  returns to Active.
- Select a dehydrated workspace and confirm transcript loads without checkout
  hydration until a file/terminal/prompt action.
- Send a prompt while dehydrated and confirm the prompt is visibly queued during
  hydration.

## Implementation Plan

### Phase 1: Name The Model

Add service-layer vocabulary for:

```text
product_lifecycle
materialization_state
cleanup_status
desired_materialization_state
execution_target
cloud_access
```

Do this before large UI changes so product code stops treating archive,
cleanup, cloud access, cloud runtime, and worktree absence as the same thing.

Acceptance:

- Cloud workspace serializers expose product lifecycle and materialization
  summary separately.
- New UI reads `productLifecycle`, `executionTarget`, `cloudAccess`, and
  `primaryMaterialization`.
- Desktop sidebar local archive preference is no longer the long-term source of
  truth for durable archive.

### Phase 2: AnyHarness Contract

Define and implement the runtime path for active dehydration/rehydration.

Acceptance:

- The spec has an implementation choice between identity-preserving dehydrate
  and generation-remapping rehydrate.
- Active dehydration does not rely on AnyHarness `retired` state as product
  truth.
- Runtime reports can distinguish missing, stale, blocked, failed, skipped, and
  inconsistent materializations.

### Phase 3: Materialization Reporting

Add or formalize storage for target materialization state.

Acceptance:

- Worker reports hydrated/dehydrated/hydrating/unknown/inconsistent.
- Worker reports cleanup idle/pruning/blocked/failed/skipped/completed.
- Cloud can show current materialization state without querying AnyHarness
  synchronously on every list render.
- Blockers and errors are structured.

### Phase 4: Archive / Restore Product Flow

Implement durable archive and restore.

Acceptance:

- Archive moves workspace to Archived immediately.
- Restore returns the same workspace to active or returns a structured conflict.
- Archive schedules prune.
- Cleanup blocker does not undo archive.

### Phase 5: Active Dehydration And Lazy Rehydrate

Allow active workspaces to be dehydrated by retention and rehydrated on demand.

Acceptance:

- Selecting an active dehydrated workspace shows transcript immediately.
- Runtime actions trigger hydration.
- Prompt dispatch is visibly queued during hydration.
- Hydration targets the correct runtime: local desktop vs managed cloud.

### Phase 6: Cache Cleanup

Add safe generated-path cleanup as a separate storage action.

Acceptance:

- Cache cleanup reports reclaimed bytes.
- Cache cleanup does not alter workspace lifecycle or transcript continuity.

### Phase 7: UI Polish And Education

Clean up visual affordances:

- active vs archived navigation
- runtime target icon
- cloud access indicator
- restoring state
- cleanup attention state
- restore/archive/delete action placement

Acceptance:

- Users can tell whether something is local, cloud-access-enabled, cloud
  sandbox-backed, active, archived, hydrated, or restoring.

## Open Questions

Should archive ever be blocked entirely by dirty work, or should archive always
move to Archived with cleanup attention? This spec recommends immediate archive
with blocked cleanup, because that matches the desired UX: archive is product
organization, cleanup is filesystem safety.

Should implementation preserve AnyHarness workspace id across dehydration, or
allow a new materialization generation under the same Cloud workspace id? This
spec prefers identity preservation long term, but permits generation remapping
for v1 if transcript projections and command routing remain correct.

What is the first-class pinning model: pinned workspace, pinned repo, or pinned
target materialization? This spec assumes pinned workspace for v1.

Where does the generated-cache safe path policy live? This spec recommends
Cloud policy version + AnyHarness enforcement, so targets never execute
arbitrary server-provided deletion globs without validation.

How much local-only lifecycle should be implemented before Cloud-backed archive
ships? This spec allows transitional Desktop overlay behavior, but the target
model should be durable local lifecycle rather than permanent sidebar
preferences.

## Implementation Notes

The existing AnyHarness retention path uses `retired` terminology. Avoid
leaking that wording into product UX. Treat it as the current cleanup mechanism,
not as sufficient active-dehydration semantics.

The current cloud archive path already sets cleanup pending. Keep that useful
intent, but split the user-visible archive state from the filesystem cleanup
result.

The current Desktop sidebar archive preference can remain as an optimistic local
UI cache during transition, but it should reconcile to durable workspace
lifecycle state.

The worktree policy UI should continue to speak about storage cleanup, not
workspace deletion. Copy should make clear that history remains unless the user
deletes the workspace.
