# Cloud Target And Managed Sandbox Foundation

Date: 2026-05-20

Status: implementation planning reference for a single replacement PR.

This is the foundation underneath MCPs/skills/plugins, agent auth, shared
sandboxes, automations, Slack, web/mobile, and claiming.

## Docs Read

- `docs/README.md`
- `docs/server/README.md`
- `docs/server/guides/database.md`
- `docs/server/guides/domains.md`
- `docs/architecture/cloud-work-launch-model-spec.md`
- `docs/architecture/cloud-worker-control-plane.md`
- `docs/architecture/cloud-worker-implementation-phases.md`

## Goal

Move the managed cloud model from the current repo-scoped runtime environment
shape to a stable sandbox/profile shape:

```text
personal cloud
  one managed cloud sandbox profile per user

shared cloud
  one managed cloud sandbox profile per organization

workspace
  durable row inside one sandbox profile and one target
```

Implementation assumption:

```text
No production users depend on the old schema.
No backwards-compatibility path is required.
Prefer replacing the old managed-cloud root model over dual-writing or
long-running compatibility shims.
```

After this lands, later systems can say:

```text
MCPs/skills/plugins
  configure sandbox profile desired runtime config

agent auth
  configure sandbox profile desired auth config

workspace/session launch
  requires the target for that profile to have applied current revisions
```

## High Level Notes / Mental Model Broadly

There are three different objects:

```text
sandbox profile
  Stable product/config identity.
  Owns "what this personal/shared sandbox should be configured with."

cloud target
  Addressable worker + AnyHarness runtime.
  Owns "where commands go and what runtime state has actually been applied."

sandbox slot
  Managed compute/provider lifecycle.
  Owns "what E2B sandbox backs this managed cloud target right now."
```

Current code already has several related pieces, but the root object is
different and should be replaced for managed cloud:

```text
Current main:
  CloudWorkspace
    -> CloudRuntimeEnvironment, unique by user/org + repo + isolation policy
      -> CloudTarget
      -> CloudSandbox

Target model:
  CloudSandboxProfile, unique by user/org
    -> CloudTarget
      -> CloudSandboxSlot
      -> CloudWorkspace[]
```

The current `CloudRuntimeEnvironment` is repo-scoped and mixes repo identity,
target identity, active provider sandbox, runtime URL/token, data key,
credential state, and env state. Since compatibility is not required, managed
cloud should stop using it as the root in this PR rather than carrying it as a
long-term bridge.

## Basic UX / High Level

### What Is The Relationship Between Sandboxes And People / Orgs?

V1 product invariant:

```text
user
  -> one personal managed cloud sandbox profile

organization
  -> one shared managed cloud sandbox profile
```

Do not create managed compute on signup or org creation.

Create the profile lazily on explicit cloud intent:

```text
personal profile creation triggers:
  user clicks Enable Personal Cloud
  user configures personal cloud agent auth
  user configures personal cloud MCP/skills/plugins
  user configures a repo for personal cloud
  user starts first personal cloud workspace

organization profile creation triggers:
  admin clicks Enable Shared Cloud
  admin configures shared cloud agent auth
  admin makes MCPs/skills/plugins public and requests shared readiness
  admin creates first shared automation/Slack/cloud workspace requiring shared cloud
```

The best UX should still present this as an explicit enablement flow:

```text
Enable Personal Cloud
  create profile
  collect/check required config
  provision target/slot only when needed or when setup completes

Enable Shared Cloud
  create org profile
  collect shared auth/public MCP/repo/env config
  provision target/slot only when needed or when setup completes
```

### What Is The Relationship Between Workspace And The Cloud DB?

Every managed-cloud workspace should have a durable Cloud row before
AnyHarness materialization starts.

Cloud DB stores:

```text
cloud_workspace
  sandbox_profile_id
  target_id
  owner scope
  repo identity
  branch/base branch
  worktree path
  AnyHarness workspace id once known
  status/lifecycle
  required runtime/auth revisions
```

Cloud DB does not store:

```text
full git worktree contents
live process state
raw AnyHarness caches
raw MCP credential values
raw provider secrets
```

This makes passive UI possible:

```text
E2B sandbox paused
  -> Cloud can still list workspaces/sessions/status from Cloud DB
  -> no need to wake compute just to render sidebar/history
```

### Managed Cloud Versus Non-Managed Targets

This spec is about managed cloud foundation first. Do not accidentally make
all targets subordinate to sandbox profiles.

```text
managed_cloud target
  belongs to one sandbox profile when profile-managed
  uses the one primary target for that profile

ssh / desktop_dispatch / self_hosted_cloud target
  remains target-first
  may optionally be associated with a profile for policy/defaults later
  does not require a cloud_sandbox_slot
```

The launch model remains target-first for non-managed targets. The profile is
the product/config root for personal/shared managed cloud; it is not a new
universal parent for every SSH or local target.

## Current Repo Snapshot

### Existing Models

```text
server/proliferate/db/models/cloud/targets.py
  CloudTarget
  CloudWorker
  CloudTargetEnrollment
  CloudTargetInventory
  CloudTargetStatus

server/proliferate/db/models/cloud/sandboxes.py
  CloudSandbox

server/proliferate/db/models/cloud/runtime_environments.py
  CloudRuntimeEnvironment

server/proliferate/db/models/cloud/workspaces.py
  CloudWorkspace
  CloudWorkspaceSetupRun

server/proliferate/db/models/cloud/target_config.py
  CloudTargetConfig

server/proliferate/db/models/cloud/sync.py
  CloudSyncedWorkspace
  CloudSessionProjection
  CloudSessionEvent
  CloudTranscriptItem
  CloudPendingInteraction
```

### Important Current Behaviors

`CloudRuntimeEnvironment` is currently unique by user/org + repo + isolation
policy. That means managed cloud runtime identity is effectively repo-scoped.

`CloudSandbox` already looks like provider lifecycle state, but it is attached
to `runtime_environment_id` and still has a compatibility-only
`cloud_workspace_id`.

`CloudWorkspace` is durable, but it points to `runtime_environment_id`, not to
`sandbox_profile_id` and `target_id` directly.

Managed org cloud is blocked in runtime provisioning with
`org_cloud_not_ready`.

`CloudTarget` is close to the target concept, but it does not yet belong to a
stable sandbox profile.

## Non-Negotiable Implementation Constraints

Profile-managed target identity must be deterministic:

```text
cloud_targets.sandbox_profile_id + profile_target_role = primary
  is the authoritative relationship for the one primary managed-cloud target
  backing a profile.

cloud_sandbox_profiles must not also own an authoritative managed_target_id.
```

If a cached target id is ever added to the profile response for convenience, it
must be treated as denormalized read-model data derived from `cloud_targets`,
not a second source of truth.

Profile/target creation must be idempotent under concurrency:

```text
ensure_personal_sandbox_profile
ensure_organization_sandbox_profile
ensure_primary_profile_target
```

must use a unique index plus conflict retry or an explicit row/advisory lock.
Concurrent "enable cloud" and "first workspace launch" must not create duplicate
profiles or duplicate primary targets.

New code must not extend current store/service debt. Some existing cloud store
files still self-open sessions, commit internally, and return ORM objects.
Profile-managed paths should add parameter-injected store functions returning
frozen dataclasses. If a managed-cloud caller is rewritten, delete the old
self-opening path instead of preserving it for compatibility.

Profile status should mean enablement/config state, not target/slot readiness.
Target status, worker status, inventory, slot state, and applied revisions remain
the runtime readiness source.

## Full DB Models + Schemas

### New Product Identity Model

Add:

```text
server/proliferate/db/models/cloud/sandbox_profiles.py
server/proliferate/db/store/cloud_sandbox_profiles.py
server/proliferate/server/cloud/sandbox_profiles/
  api.py
  service.py
  models.py
  access.py
  domain/policy.py
```

Schema:

```text
cloud_sandbox_profiles
  id
  owner_scope: personal | organization
  owner_user_id
  organization_id
  billing_subject_id
  status: disabled | configuring | enabled | blocked | error

  desired_runtime_config_sequence
  desired_runtime_config_revision_id
  desired_runtime_config_content_hash

  desired_agent_auth_sequence
  desired_agent_auth_revision_id

  created_by_user_id
  created_at
  updated_at
  archived_at
```

Initial uniqueness:

```text
unique active personal profile per owner_user_id
unique active organization profile per organization_id
```

Owner invariants:

```text
DB CHECK: owner_scope = personal
  owner_user_id is not null
  organization_id is null

DB CHECK: owner_scope = organization
  organization_id is not null
  owner_user_id is null

created_by_user_id
  always set; records the admin/user who created the profile, not ownership
```

Do not require a target immediately. A profile can exist before compute is
provisioned.

Partial unique indexes:

```text
unique(owner_user_id)
  where owner_scope = 'personal' and archived_at is null

unique(organization_id)
  where owner_scope = 'organization' and archived_at is null
```

Add `archived_at` in the first replacement migration. Do not make the unique
indexes depend on `status`; disabled profiles should be reusable/reactivatable,
not duplicated.

Profile ensure functions must also create/store the matching billing subject:

```text
ensure_personal_sandbox_profile
  calls/uses ensure_personal_billing_subject

ensure_organization_sandbox_profile
  calls/uses ensure_organization_billing_subject

cloud_sandbox_profiles.billing_subject_id
  matches the owner scope and is copied onto slots/workspaces
```

Sequence fields are monotonically increasing integers. They are the only values
used for ordering in preflight checks. Revision ids/content hashes are opaque
identity/integrity values and must not be ordered lexicographically.

Replacement rule:

```text
Managed-cloud code creates profiles through explicit ensure functions only.
No backfill path is required for production data.
Dev/test fixtures should be updated to the new root model instead of migrated
through CloudRuntimeEnvironment.
```

### Existing Agent-Auth SandboxProfile Disposition

The repo already has `sandbox_profile` in:

```text
server/proliferate/db/models/cloud/agent_auth.py
```

Do not create two independent profile roots.

Required disposition in this PR:

```text
Choose one physical table name:
  preferred: rehome/rename existing sandbox_profile into cloud_sandbox_profiles
  acceptable: keep physical sandbox_profile but make it the shared cloud
  sandbox profile model documented here

Remove managed_target_id as authoritative state.

Update FKs to the chosen profile table:
  sandbox_profile_agent_auth_revision.sandbox_profile_id
  sandbox_agent_auth_selection.sandbox_profile_id
  sandbox_profile_agent_auth_target_state.sandbox_profile_id
  agent_gateway_runtime_grant.sandbox_profile_id

Agent-auth target lookup:
  derive primary target from
  cloud_targets.sandbox_profile_id + profile_target_role = primary
```

The important invariant is conceptual: there is one sandbox profile root for
managed cloud, MCP/skills/plugins, and agent auth.

### CloudTarget Changes

Modify:

```text
server/proliferate/db/models/cloud/targets.py
server/proliferate/db/store/cloud_sync/targets.py
server/proliferate/server/cloud/targets/models.py
server/proliferate/server/cloud/targets/service.py
server/proliferate/server/cloud/targets/access.py
```

Add:

```text
cloud_targets.sandbox_profile_id nullable FK cloud_sandbox_profiles.id
cloud_targets.profile_target_role: primary | none
cloud_targets.owner_user_id nullable
```

Target intent:

```text
primary
  the one target backing a managed cloud profile

none
  local/SSH/self-hosted rows not owned by a managed cloud profile
```

Owner/kind invariants:

```text
profile_target_role = primary
  kind = managed_cloud
  sandbox_profile_id is not null
  target owner_scope matches profile owner_scope
  personal profile -> target.owner_user_id = profile.owner_user_id
  organization profile -> target.organization_id = profile.organization_id
  organization primary target -> target.owner_user_id is null unless the column
    is retained only as created_by_user_id-compatible metadata

profile_target_role = none
  sandbox_profile_id is null
```

If current `cloud_targets.owner_user_id` is non-null, relax it for organization
targets and use `created_by_user_id` for creator/audit identity. Do not encode
organization ownership as "admin user's personal target."

Executable constraints:

```text
DB CHECK:
  profile_target_role != 'primary'
  OR (kind = 'managed_cloud' AND sandbox_profile_id IS NOT NULL)

DB CHECK:
  owner_scope = 'personal'
  AND owner_user_id IS NOT NULL
  AND organization_id IS NULL
  OR owner_scope = 'organization'
  AND organization_id IS NOT NULL
  AND owner_user_id IS NULL
```

Service validation must additionally assert that a primary target's owner fields
match the referenced profile before insert/update.

Authoritative uniqueness:

```text
unique(sandbox_profile_id)
  where profile_target_role = 'primary' and archived_at is null
```

`cloud_targets.sandbox_profile_id + profile_target_role = primary` is the
source of truth for the profile's primary managed target. Do not also persist an
authoritative `managed_target_id` on the profile.

Do not move readiness/inventory into the profile. Keep runtime-applied facts on
target/profile applied state and status/inventory:

```text
cloud_sandbox_profile_target_state owns:
  sandbox_profile_id
  target_id
  active_sandbox_id
  slot_generation
  current_runtime_config_sequence
  current_runtime_config_revision_id
  current_agent_auth_sequence
  current_agent_auth_revision_id

target/inventory/status reports:
  worker status
  supported command kinds
  runtime versions
  optional denormalized copies of current runtime/auth sequences
```

Current applied revision fields are per `(sandbox_profile_id, target_id)`, not
generic per target in the abstract. In V1 there is one primary target per
profile, but the table shape should still preserve that relationship so agent
auth and MCP/skill runtime config can share the same preflight primitive.
Worker heartbeat or materialization-result payloads must report them before
launch preflight depends on them.

### CloudSandbox Changes

Treat existing `cloud_sandbox` as the implementation table for the target
`cloud_sandbox_slot` concept. The table name can stay if renaming creates churn;
the domain language should still be "slot."

Modify:

```text
server/proliferate/db/models/cloud/sandboxes.py
server/proliferate/db/store/cloud_workspaces.py
server/proliferate/server/cloud/runtime/ensure_running.py
server/proliferate/server/cloud/runtime/provision.py
```

Add:

```text
cloud_sandbox.sandbox_profile_id nullable FK cloud_sandbox_profiles.id
cloud_sandbox.target_id nullable FK cloud_targets.id
cloud_sandbox.billing_subject_id nullable FK billing_subject.id
cloud_sandbox.slot_generation integer
cloud_sandbox.superseded_by_sandbox_id nullable FK cloud_sandbox.id
cloud_sandbox.superseded_at nullable timestamptz
cloud_sandbox.lifecycle_on_timeout
cloud_sandbox.lifecycle_auto_resume
cloud_sandbox.provider_timeout_seconds
cloud_sandbox.blocked_reason
```

New rows should set:

```text
sandbox_profile_id
target_id
billing_subject_id
slot_generation
```

Managed-cloud slot lookup should use `(sandbox_profile_id, target_id)` and
provider lifecycle state. It should not join through `CloudRuntimeEnvironment`.
If `runtime_environment_id` or per-workspace slot fields have no non-managed
caller after the rewrite, remove them in the same PR. If they remain physically
present, managed-cloud code should leave them unset.

Active-slot invariant:

```text
unique active slot per sandbox_profile_id + target_id
  where superseded_at is null
  and status in ('creating', 'running', 'paused', 'blocked')
```

`ensure_profile_slot(profile_id, target_id)` must lock the target/profile pair,
load the active slot, and create a new slot only if none is active. Replacing a
provider sandbox must first mark the old slot superseded/killed/error and bump
`slot_generation`; then the new slot becomes the only active slot.

Worker fencing:

```text
cloud_target_enrollments.sandbox_profile_id nullable FK cloud_sandbox_profiles.id
cloud_target_enrollments.cloud_sandbox_id nullable FK cloud_sandbox.id
cloud_target_enrollments.slot_generation nullable integer

cloud_workers.cloud_sandbox_id nullable FK cloud_sandbox.id
cloud_workers.slot_generation nullable integer

cloud_commands.leased_cloud_sandbox_id nullable FK cloud_sandbox.id
cloud_commands.leased_slot_generation nullable integer

worker enrollment/heartbeat reports:
  target_id
  sandbox_profile_id
  cloud_sandbox_id
  slot_generation

command leasing must require:
  worker.target_id = command.target_id
  worker.cloud_sandbox_id = active slot id
  worker.slot_generation = active slot_generation

command delivery/result/event ingest must require:
  command.leased_cloud_sandbox_id = active slot id
  command.leased_slot_generation = active slot_generation
  worker.cloud_sandbox_id = command.leased_cloud_sandbox_id
  worker.slot_generation = command.leased_slot_generation
```

This prevents an old worker from a replaced provider sandbox from leasing
commands for the stable target or reporting stale results after replacement.
Cloud assigns `CloudWorker` slot identity from the consumed enrollment token;
it must not trust arbitrary heartbeat/request fields to pick a slot.

If a stale worker reports delivery, result, heartbeat, runtime-access data, or
readiness for a superseded slot, mark the worker stale/unusable and mark any
affected command stale/superseded. Do not update workspace, session, runtime
access, profile target state, or billing readiness from stale slot reports.

Billing/quota code must be able to list and count active slots without joining
through `CloudRuntimeEnvironment`. `billing_subject_id` on the slot is the
direct path; it should be copied from the sandbox profile at slot creation.

### Target Runtime Access State

Add a concrete target-level runtime access owner:

```text
cloud_target_runtime_access
  id
  target_id unique FK cloud_targets.id
  sandbox_profile_id FK cloud_sandbox_profiles.id
  active_sandbox_id FK cloud_sandbox.id
  slot_generation integer

  anyharness_base_url
  runtime_token_ciphertext
  anyharness_data_key_ciphertext

  last_worker_id nullable FK cloud_workers.id
  last_heartbeat_at
  created_at
  updated_at
```

This replaces managed-cloud reads of runtime URL/token/data key from
`CloudRuntimeEnvironment` or `CloudWorkspace`. It is target-scoped because the
same AnyHarness runtime backs many workspaces inside the sandbox.

Rules:

```text
cloud_target_runtime_access.target_id
  one row per managed cloud target

active_sandbox_id + slot_generation
  must match the current active slot

updates
  compare-and-set on target_id + active_sandbox_id + slot_generation
  stale slot updates are ignored/rejected

runtime_token_ciphertext / anyharness_data_key_ciphertext
  encrypted at rest, never logged, never copied onto cloud_workspace
```

If the product chooses a worker-only access model later, this table can shrink.
For this replacement PR, it is the explicit owner for all direct Cloud ->
AnyHarness connection state that used to live on runtime/workspace rows.

Boundary:

```text
cloud_target_runtime_access is for:
  managed provisioning
  diagnostics
  explicitly allowlisted health checks

Production cloud-mediated workspace/session mutations still go through:
  CloudCommand -> Worker -> AnyHarness

Do not add new direct Cloud -> AnyHarness mutation paths using this table.
```

### Profile Target Applied State

Add a profile/target materialization state row:

```text
cloud_sandbox_profile_target_state
  sandbox_profile_id FK cloud_sandbox_profiles.id
  target_id FK cloud_targets.id
  active_sandbox_id FK cloud_sandbox.id
  slot_generation integer

  current_runtime_config_sequence integer
  current_runtime_config_revision_id nullable text
  current_agent_auth_sequence integer
  current_agent_auth_revision_id nullable text

  last_materialized_at
  last_materialization_error nullable text
  updated_at
```

Uniqueness:

```text
unique(sandbox_profile_id, target_id)
```

This is the common launch-preflight source for later MCP/skills/plugins and
agent-auth work. `cloud_target_status` may duplicate these values for cheap
status reads, but the authoritative applied-state identity is profile + target.

Launch preflight treats `current_runtime_config_sequence` and
`current_agent_auth_sequence` as valid only when `active_sandbox_id` and
`slot_generation` match the current active slot. Slot replacement invalidates or
resets applied-state rows for that profile/target to the safe default until the
new slot reports materialization.

### CloudWorkspace Changes

Modify:

```text
server/proliferate/db/models/cloud/workspaces.py
server/proliferate/db/store/cloud_workspaces.py
server/proliferate/server/cloud/workspaces/models.py
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/workspaces/access.py
```

Add:

```text
cloud_workspace.sandbox_profile_id nullable FK cloud_sandbox_profiles.id
cloud_workspace.target_id nullable FK cloud_targets.id
cloud_workspace.user_id nullable or removed for managed-cloud ownership
cloud_workspace.normalized_repo_key text
cloud_workspace.worktree_path text
cloud_workspace.materialized_slot_generation nullable integer
cloud_workspace.required_runtime_config_sequence nullable integer
cloud_workspace.required_runtime_config_revision_id nullable text
cloud_workspace.required_agent_auth_sequence nullable integer
cloud_workspace.required_agent_auth_revision_id nullable text
```

For managed-cloud workspaces, `sandbox_profile_id` and `target_id` are required
at write time even if the physical columns stay nullable for other row types.
`user_id` must not drive ownership. Either remove it or make it nullable and
creator-only compatibility data; `owner_scope`, `owner_user_id`,
`organization_id`, and `created_by_user_id` are the authoritative fields.

Owner/billing invariants:

```text
managed cloud_workspace rows:
  sandbox_profile_id matches profile
  target_id is the profile primary target
  owner_scope matches profile.owner_scope
  owner_user_id / organization_id match profile owner fields
  created_by_user_id records the actor only
  billing_subject_id = cloud_sandbox_profiles.billing_subject_id
```

Workspace identity/uniqueness:

```text
normalized_repo_key
  canonical repo identity, e.g. github.com/proliferate-ai/proliferate

unique active workspace per:
  sandbox_profile_id
  target_id
  normalized_repo_key
  git_branch
  where archived_at is null

unique active worktree path per:
  target_id
  worktree_path
  where archived_at is null
```

Do not replace the current `runtime_environment_id + git_branch` uniqueness
with just `sandbox_profile_id + git_branch`; the same branch name can exist
across repos. Repo identity must be part of the key.

Remove managed-cloud dependence on:

```text
cloud_workspace.runtime_environment_id
cloud_workspace.active_sandbox_id
cloud_workspace.runtime_url
cloud_workspace.runtime_token_ciphertext
cloud_workspace.anyharness_data_key_ciphertext
```

Runtime access state belongs to the target/worker/slot boundary, not the
workspace row. If any of these fields still have non-managed callers, isolate
those callers explicitly; do not make new managed-cloud reads fall back to them.

Command identity caveat:

```text
cloud_workspace.id
  Cloud product workspace id

cloud_workspace.anyharness_workspace_id
  target-local AnyHarness workspace id, filled after materialization

cloud_commands.workspace_id
  currently stores AnyHarness workspace id for target command routing
```

Command/result correlation:

```text
cloud_commands.cloud_workspace_id nullable FK cloud_workspace.id
cloud_commands.target_id FK cloud_targets.id
cloud_commands.workspace_id nullable text
```

For workspace materialization and session-start commands:

```text
cloud_workspace_id
  always set; Cloud product row to update

workspace_id
  unset before materialization when no AnyHarness workspace id exists yet
  set to anyharness_workspace_id after materialization for commands that route
  to an existing AnyHarness workspace
```

Worker results must echo `cloud_workspace_id` and, when created, the
`anyharness_workspace_id`. That is the durable attachment point for non-
automation launches and automation launches alike. Do not rely on in-memory
stage context to connect materialization results back to Cloud rows.

Worker wire contract changes:

```text
WorkerCommandEnvelope.cloudWorkspaceId nullable uuid
WorkerCommandResultRequest.cloudWorkspaceId nullable uuid
WorkerCommandDeliveryRequest.cloudWorkspaceId nullable uuid, if delivery is
  used to update workspace state

workspaceId remains:
  AnyHarness workspace id only
```

For materialization/start-session results, the server must verify:

```text
result.cloudWorkspaceId = cloud_commands.cloud_workspace_id
result.target id / command target id = cloud_workspace.target_id
result worker slot id/generation = active slot id/generation
```

Only then may it update `cloud_workspace.anyharness_workspace_id`,
`materialized_slot_generation`, workspace status, session projection, or profile
target applied state.

Slot replacement and workspace materialization:

```text
cloud_workspace.anyharness_workspace_id
  is valid only for materialized_slot_generation = active slot_generation

slot replacement
  marks existing managed workspaces needs_rematerialization or equivalent
  clears/invalidates runnable AnyHarness workspace ids until rematerialized
```

The exact status name can follow existing workspace states, but the invariant is
that old AnyHarness workspace ids are never treated as runnable in a new slot.

### CloudRuntimeEnvironment Removal / Replacement

Managed cloud should stop using `CloudRuntimeEnvironment` as a root object in
this PR. Delete or isolate managed-cloud call sites instead of adding new
profile fields to `cloud_runtime_environment`.

Inspect and rewrite:

```text
server/proliferate/db/models/cloud/runtime_environments.py
server/proliferate/db/store/cloud_runtime_environments.py
server/proliferate/server/cloud/runtime/*.py
```

Move responsibilities to the new owners:

```text
repo identity / branch / setup inputs
  cloud_workspace and cloud_target_configs

target identity
  cloud_targets.sandbox_profile_id + profile_target_role = primary

active provider sandbox
  cloud_sandbox slot by sandbox_profile_id + target_id

runtime URL/token/data key
  target/worker access state, not workspace/root identity

credential/auth revision state
  agent-auth revision tables in the agent auth PR

repo env applied version
  workspace materialization / cloud_target_configs
```

If `CloudRuntimeEnvironment` remains for a narrow non-managed or test fixture
purpose, it must not be created, read, or required by the managed-cloud
personal/shared launch path.

Disposition map required during implementation:

```text
server/proliferate/server/cloud/runtime/*.py
  rewrite managed-cloud provisioning/ensure-running around profile/target/slot

server/proliferate/server/cloud/workspaces/service.py
  responses/details/listing read workspace + target + slot + runtime access

server/proliferate/server/cloud/commands/service.py
  command routing uses target/runtime access and cloud_workspace_id context

server/proliferate/server/cloud/webhooks/service.py
  provider events update cloud_sandbox slot by provider id/slot id

server/proliferate/db/store/billing.py
  active compute counts use cloud_sandbox.billing_subject_id

server/proliferate/server/automations/worker/cloud_execution/**
  use the same managed-profile workspace launch service or fail explicitly
```

Acceptance check:

```bash
rg "CloudRuntimeEnvironment|runtime_environment_id" server/proliferate
```

Every remaining hit must be classified as non-managed, test/fixture, diagnostic,
or dead code to delete. No managed-cloud launch/provisioning/billing/command
path may require it.

### Target Config / Runtime Config Changes

Modify:

```text
server/proliferate/db/models/cloud/target_config.py
server/proliferate/db/store/cloud_sync/target_config.py
server/proliferate/server/cloud/target_config/service.py
server/proliferate/server/cloud/target_config/api.py
```

Add:

```text
cloud_target_configs remains target + repo scoped for env/files/setup.
Do not put profile-wide MCP/skill desired state here.
```

Target config records can still be repo-scoped for env/files/setup, but
MCP/skill runtime config should become profile-scoped in a separate model owned
by the MCP/skills/plugins work:

```text
cloud_sandbox_runtime_config_revision
  sandbox_profile_id
  sequence
  revision_id
  content_hash
  manifest_json
  warnings_json

cloud_sandbox_runtime_config_current
  sandbox_profile_id
  current_sequence
  current_revision_id
```

That keeps profile desired capability state separate from repo materialization
payloads.

## End To End Flows Through The Product

### Creating New User / Associated Sandbox

1. User signs up.
2. No profile or compute is required at signup.
3. User takes an explicit cloud-intent action.
4. Server calls `ensure_personal_sandbox_profile`.
5. Profile starts as `configuring`.
6. When compute is needed, server creates or resolves primary managed target.
7. Server creates or resolves sandbox slot.
8. Worker enrolls and heartbeats.
9. Target readiness updates current applied state.
10. Profile remains `enabled`; readiness is derived from target status, slot
    state, worker inventory, and applied revision checks.

Primary files:

```text
server/proliferate/server/cloud/sandbox_profiles/service.py
server/proliferate/server/cloud/runtime/target_registration.py
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/db/store/cloud_sandbox_profiles.py
```

### Creating New Org / Associated Sandbox

1. Organization is created.
2. No shared profile or compute is required by default.
3. Admin clicks Enable Shared Cloud.
4. Server calls `ensure_organization_sandbox_profile`.
5. Profile starts as `configuring`.
6. Admin configures shared agent auth, public MCPs/skills/plugins, and shared
   repo/env defaults.
7. Server provisions primary managed target/slot when readiness is requested or
   first shared cloud run starts.
8. Remove the `org_cloud_not_ready` block only after profile target/slot and
   launch preflight are implemented.

Primary files:

```text
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/server/cloud/sandbox_profiles/service.py
```

### New Workspace On A Managed Cloud Sandbox

Target flow:

```text
client/automation/Slack asks Cloud to start work
  -> resolve sandbox profile
  -> ensure primary target exists
  -> ensure sandbox slot running or wake it
  -> write/update target runtime access and profile target applied-state rows
  -> create cloud_workspace row with sandbox_profile_id and target_id
  -> queue worker commands with cloud_workspace_id context
  -> worker materializes AnyHarness workspace
  -> worker writes back cloud_workspace_id + anyharness_workspace_id/status
```

Worker command sequence:

```text
configure_git_identity, if needed
ensure_repo_checkout
materialize_workspace existing_path/repo root, if needed
materialize_workspace worktree/final runnable workspace, if needed
materialize_environment
materialize_environment_runtime_config, after that command kind lands
refresh_agent_auth_config, after that command kind lands
start_session
```

`materialize_environment_runtime_config` is future. `refresh_agent_auth_config`
exists today against the existing agent-auth `sandbox_profile`; this PR must
either rebind it to the chosen shared profile root or keep profile launch
preflight from depending on it until that rebind lands.

`cloud_workspace.anyharness_workspace_id` should be set only from the final
runnable AnyHarness workspace. If the flow first materializes a repo root or
existing path only to discover/prepare the worktree, that intermediate id is not
the Cloud workspace's runnable workspace id.

The important fix is ordering:

```text
Cloud creates cloud_workspace before AnyHarness work starts.
Cloud workspace is associated with sandbox_profile_id and target_id.
Commands carry cloud_workspace_id before any AnyHarness workspace id exists.
AnyHarness workspace id is filled in later by worker.
```

Automation launch contract:

```text
managed_profile_launch(owner_scope, owner id, repo, branch, source)
  atomically resolves profile, primary target, active slot, CloudWorkspace, and
  initial command set

automation worker
  calls managed_profile_launch
  does not independently select "any online managed target"
```

If the requested owner scope is `organization` and shared cloud is still blocked,
`managed_profile_launch` fails before creating profile/target/slot/workspace
rows unless the explicit product decision is to enable organization-managed
cloud in this PR.

Primary files:

```text
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/commands/service.py
server/proliferate/server/cloud/runtime/ensure_running.py
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
```

## Specific Hooks

Profile creation hooks:

```text
Enable Personal Cloud
Enable Shared Cloud
first cloud workspace launch
first cloud config save that targets personal/shared cloud
```

Target/slot hooks:

```text
managed cloud provision
worker enrollment
worker heartbeat
provider pause/resume/error/killed event
slot replacement / generation bump
target runtime access update
billing block/unblock
```

Workspace hooks:

```text
create workspace
materialize workspace result
session start result
event upload / projection update
archive/delete workspace
move workspace, if supported
```

Readiness hooks:

```text
runtime config desired sequence changes
agent auth desired sequence changes
target reports current applied sequences/revision ids
worker command support changes
slot state changes
```

## Single PR Work Plan

Because there are no production users, implement this as one replacement PR,
not as an additive migration with fallback reads.

### 1. Replace The Managed-Cloud Root Schema

Add:

```text
cloud_sandbox_profiles
cloud_targets.sandbox_profile_id
cloud_targets.profile_target_role
cloud_sandbox.sandbox_profile_id
cloud_sandbox.target_id
cloud_sandbox.billing_subject_id
cloud_sandbox.slot_generation / supersession fields
cloud_target_enrollments sandbox_profile_id / cloud_sandbox_id / slot_generation
cloud_workers.cloud_sandbox_id
cloud_workers.slot_generation
cloud_commands.leased_cloud_sandbox_id
cloud_commands.leased_slot_generation
cloud_target_runtime_access
cloud_sandbox_profile_target_state
cloud_workspace.sandbox_profile_id
cloud_workspace.target_id
cloud_workspace.user_id nullable or removed from managed ownership
cloud_workspace.normalized_repo_key
cloud_workspace.worktree_path
cloud_workspace.materialized_slot_generation
cloud_commands.cloud_workspace_id
```

Remove or stop using in managed-cloud code:

```text
cloud_workspace.runtime_environment_id
cloud_workspace.active_sandbox_id
cloud_workspace.runtime_url
cloud_workspace.runtime_token_ciphertext
cloud_workspace.anyharness_data_key_ciphertext
cloud_sandbox.runtime_environment_id
cloud_sandbox.cloud_workspace_id
CloudRuntimeEnvironment as managed-cloud root
```

If a column cannot be dropped immediately because unrelated tests or
non-managed code still reference it, leave it physically present but remove it
from the managed-cloud service path and mark the remaining caller explicitly.

### 2. Add Profile Stores And Services

Files:

```text
server/proliferate/db/models/cloud/sandbox_profiles.py
server/proliferate/db/models/cloud/__init__.py
server/proliferate/db/store/cloud_sandbox_profiles.py
server/proliferate/server/cloud/sandbox_profiles/
```

Rules:

- Store functions accept `AsyncSession`.
- Store functions return frozen dataclasses.
- Services do not import SQLAlchemy.
- API is thin and passes `db`.
- `ensure_*` functions are idempotent under concurrent calls through unique
  indexes plus retry or explicit row/advisory locks.
- Do not add self-opening store helpers in this new area.

Required helpers:

```text
ensure_personal_sandbox_profile(user_id)
ensure_organization_sandbox_profile(organization_id)
ensure_primary_profile_target(sandbox_profile_id)
ensure_profile_slot(sandbox_profile_id, target_id)
record_target_runtime_access(target_id, active_sandbox_id, slot_generation)
record_profile_target_applied_state(sandbox_profile_id, target_id, ...)
```

### 3. Rewrite Managed Workspace Creation Around Profile -> Target -> Slot

Target flow:

```text
resolve owner scope
ensure sandbox profile
ensure primary target
ensure or wake sandbox slot
write/update runtime access and applied-state rows
create cloud_workspace with sandbox_profile_id + target_id
enqueue existing worker commands with cloud_workspace_id context only
worker writes back cloud_workspace_id + anyharness_workspace_id/status
```

Primary files:

```text
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/db/store/cloud_workspaces.py
server/proliferate/server/cloud/runtime/ensure_running.py
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/server/cloud/commands/service.py
server/proliferate/server/automations/worker/cloud_execution/**
```

Automations and future Slack launches must call the same managed-profile
workspace launch/materialization service. Do not let automations keep selecting
"any online managed target" independently. If the shared/team path is not ready,
fail before creating partial profile/target/slot/workspace rows.

Do not enqueue this future command kind in this foundation PR unless its server
constant, DB CHECK constraints, command validation, worker models, worker
dispatch handler, and tests land in the same PR:

```text
materialize_environment_runtime_config
```

`refresh_agent_auth_config` already exists. This PR must either rebind it to
the chosen shared profile root or keep launch preflight independent of it until
the agent-auth rebind lands.

### 4. Rewrite Slot Lifecycle And Billing Queries

Slot lifecycle should load by profile/target:

```text
sandbox_profile_id
target_id
provider_sandbox_id
state
billing_subject_id
slot_generation
```

Billing and limits must query `cloud_sandbox.billing_subject_id` directly. They
should not join through `CloudRuntimeEnvironment`.

Worker command leasing must be fenced by the active slot id and generation.
Heartbeat from an old slot should mark that worker stale/unusable for command
leasing rather than updating target readiness.

### 5. Add Runtime Access And Desired/Applied Revision Placeholders

Add the sequence fields now so MCP/skills/plugins and agent-auth can depend on
one stable root later:

```text
cloud_sandbox_profiles.desired_runtime_config_sequence
cloud_sandbox_profiles.desired_agent_auth_sequence
cloud_sandbox_profile_target_state.current_runtime_config_sequence
cloud_sandbox_profile_target_state.current_agent_auth_sequence
cloud_target_runtime_access.active_sandbox_id
cloud_target_runtime_access.anyharness_base_url
cloud_target_runtime_access.runtime_token_ciphertext
cloud_target_runtime_access.anyharness_data_key_ciphertext
```

For this foundation PR, default empty config is valid:

```text
desired sequence = 0
current sequence = 0
```

Launch preflight can start as a helper that passes for `0/0`. Later PRs wire
real runtime config and agent-auth refresh commands into that helper.

### 6. Organization Shared Cloud Path

The schema should support organization profiles in the same PR.

Implementation choice:

```text
preferred
  implement org profile -> primary target -> slot -> organization-owned
  CloudWorkspace enough to remove org_cloud_not_ready

acceptable temporary state
  keep org_cloud_not_ready, but only as an explicit product block before
  profile provisioning; do not create partial org workspaces through personal
  ownership semantics
```

Do not silently fall back from shared cloud to a user's personal cloud. Team
work must be organization-owned when it is enabled.

### 7. Delete Replaced Managed-Cloud Paths

As each managed-cloud call site is rewritten, remove the old runtime-environment
path from that call site. The final PR should not leave:

```text
new managed-cloud write path
  and
old CloudRuntimeEnvironment managed-cloud write path
```

side by side.

### 8. Tests

Add targeted server tests before broad smoke testing:

```text
profile creation is idempotent under concurrent calls
one primary target per profile is enforced
managed workspace creation writes sandbox_profile_id + target_id
workspace uniqueness includes normalized repo and branch
slot creation writes sandbox_profile_id + target_id + billing_subject_id
slot generation fences stale workers
command results correlate by cloud_workspace_id
managed workspace creation does not require CloudRuntimeEnvironment
unsupported future command kinds are not enqueued
organization profile creation is idempotent
shared cloud either provisions organization-owned workspace or fails explicitly
```

## Replacement Plan

Implementation order inside the PR:

```text
1. Add/reshape DB models and Alembic migration.
2. Add sandbox profile store/service with idempotent ensure helpers.
3. Rewrite target provisioning to create owner-correct primary profile targets.
4. Rewrite slot lifecycle to use profile/target, active-slot uniqueness,
   enrollment/result slot_generation fencing, and billing_subject_id.
5. Add target runtime access state and profile/target applied-state writes.
6. Rewrite managed workspace creation to create CloudWorkspace under
   sandbox_profile_id + target_id before AnyHarness materialization.
7. Add command/result wire correlation through cloud_workspace_id and leased
   slot identity.
8. Route automations through the same profile-managed launch service or block
   them before partial provisioning.
9. Rehome existing agent-auth sandbox_profile into the shared profile root and
   remove managed_target_id as authoritative state.
10. Remove managed-cloud reads/writes through CloudRuntimeEnvironment.
11. Add desired/current sequence placeholders and launch-preflight helper.
12. Keep future MCP/runtime-config command kinds disabled unless their full
   worker/server contract lands in the same PR; rebind or explicitly isolate
   existing refresh_agent_auth_config.
13. Update fixtures and tests to the new model directly.
14. Delete dead managed-cloud runtime-environment code.
```

No production data backfill is required. Dev/test seed data should be recreated
or mechanically rewritten only to keep local fixtures usable.

## Specific One Offs

### Why Not Just Reuse CloudRuntimeEnvironment?

Because it is unique by repo. If it remains the root, "one cloud sandbox per
user/org" is impossible without treating one repo as the sandbox identity.

### Should Profiles Be Created At Signup?

No. Create profiles on cloud intent. Create managed compute even later.

### Should A Workspace Be Created Before AnyHarness Knows About It?

Yes. For managed cloud, Cloud should create the durable `cloud_workspace` row
before worker materialization. AnyHarness ids are filled in after worker
success.

### What If E2B Pauses?

Only the slot state changes. Profile, target, workspace, and session projection
rows remain queryable.

### What If E2B Replaces The Sandbox?

The slot/provider fields change. The profile remains stable. The target should
remain stable if worker enrollment is for the same profile target; if not, the
new target must still attach to the profile and reconcile workspaces.

### Can A Profile Have Multiple Managed Targets?

No in V1. Enforce one active primary managed-cloud target per profile with the
partial unique index on `cloud_targets.sandbox_profile_id` where
`profile_target_role = primary`.

If the product later needs multiple managed sandboxes per org, add an explicit
new profile/slot dimension. Do not overload workspace or repo identity to create
extra sandboxes.

## Acceptance Criteria

Single PR acceptance:

- `cloud_sandbox_profile` is the managed-cloud product/config root.
- Personal cloud enablement creates or reuses one personal profile, one primary
  target, and one slot.
- Organization cloud enablement creates or reuses one organization profile; the
  shared launch path either provisions organization-owned workspaces or fails
  explicitly before provisioning.
- Owner constraints prevent organization/shared work from being represented as
  an admin user's personal target/workspace.
- Exactly one active managed slot exists per `(sandbox_profile_id, target_id)`.
- Worker enrollment, heartbeat, command leasing, delivery, result ingest, event
  ingest, runtime-access writes, and readiness updates are fenced by active slot
  id and `slot_generation`.
- Target runtime access state exists outside `CloudRuntimeEnvironment` and
  `CloudWorkspace`.
- Target runtime access is not used to add new direct Cloud -> AnyHarness
  mutation paths.
- Managed `cloud_workspace` rows are created before AnyHarness materialization
  and carry `sandbox_profile_id` + `target_id`.
- Managed `cloud_workspace.user_id` no longer drives ownership.
- Managed workspace uniqueness includes profile, target, normalized repo, and
  branch; active worktree paths are unique per target.
- Worker command/result payloads can correlate materialization results through
  `cloud_workspace_id` before `anyharness_workspace_id` exists.
- `cloud_workspace.anyharness_workspace_id` is valid only for the active
  `materialized_slot_generation`.
- Managed `cloud_sandbox` slot rows carry `sandbox_profile_id`, `target_id`, and
  `billing_subject_id`.
- Existing agent-auth `sandbox_profile` is rehomed into the one shared sandbox
  profile root; `managed_target_id` is not authoritative.
- Managed-cloud workspace/slot/provisioning code does not require
  `CloudRuntimeEnvironment`.
- Concurrent profile/target creation returns one profile and one primary target.
- Automations use the same profile-managed launch service or fail before
  partial provisioning.
- Unsupported future command kinds are never enqueued.
- Desired/current runtime/auth sequence placeholders exist and default to a
  passing `0/0` state.
- `refresh_agent_auth_config` is either rebound to the shared profile root or
  launch preflight does not depend on it yet.
- MCP/skills/plugins and agent auth specs can point at `sandbox_profile_id` as
  their product config root.
- `rg "CloudRuntimeEnvironment|runtime_environment_id" server/proliferate` has
  every remaining hit classified as non-managed, test/fixture, diagnostic, or
  dead code.

## Verification

Server:

```bash
cd server
uv run pytest -q
```

Targeted tests to add:

```text
server/tests/cloud/test_sandbox_profiles.py
server/tests/cloud/test_sandbox_profile_idempotency.py
server/tests/cloud/test_workspace_profile_target_links.py
server/tests/cloud/test_sandbox_slot_billing_subject.py
server/tests/cloud/test_sandbox_slot_generation_fencing.py
server/tests/cloud/test_target_runtime_access_state.py
server/tests/cloud/test_cloud_workspace_command_correlation.py
server/tests/cloud/test_cloud_workspace_slot_rematerialization.py
server/tests/cloud/test_agent_auth_profile_rehome.py
server/tests/cloud/test_managed_cloud_profile_target_provisioning.py
server/tests/cloud/test_org_cloud_profile_enablement.py
server/tests/automations/test_cloud_execution_uses_profile_launch.py
```

Worker/AnyHarness:

```bash
cargo test -p proliferate-worker
cargo test -p anyharness-contract
```

Manual smoke:

```text
Enable personal cloud
  -> profile created
  -> target/slot created lazily
  -> workspace created with profile/target links
  -> AnyHarness workspace id filled after materialization

Pause/resume provider sandbox
  -> Cloud still lists workspace without waking
  -> wake command updates slot and worker heartbeat

Enable shared cloud as admin
  -> org profile created
  -> target/slot can be provisioned
  -> org_cloud_not_ready removed only after launch path is ready
```
