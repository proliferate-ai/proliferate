# Cloud Workspace / Target / Sandbox Materialization

Status: quick-reference study packet for managed cloud identity,
materialization, and the legacy transition surface.

Canonical sources:

- `docs/current/specs/00-sandbox-foundation.md`
- `docs/current/specs/04-cloud-running-alignment.md`
- `docs/server/README.md`
- `docs/architecture/cloud-worker-workspace-command-spec.md`

## Mental Model

There are two live paths.

Managed path:

```text
SandboxProfile
  -> primary CloudTarget
  -> active CloudSandbox slot
  -> CloudWorkspace product row
  -> cloud command queue
  -> worker
  -> AnyHarness workspace
```

Legacy personal cloud path:

```text
CloudWorkspace.runtime_environment_id
  -> CloudRuntimeEnvironment
  -> legacy provisioner/sandbox APIs
```

The managed path is the target architecture. Legacy columns and runtime
environment rows still exist, so always identify which path a workspace is on
before debugging.

Do not confuse:

```text
cloud_workspace.id              Cloud product workspace row.
cloud_workspace.anyharness_workspace_id
                                AnyHarness runtime workspace id.
cloud_commands.cloud_workspace_id
                                Cloud product workspace id.
cloud_commands.workspace_id     AnyHarness workspace id.
```

## Core DB Objects

Profile/config root:

```text
server/proliferate/db/models/cloud/agent_auth.py
  SandboxProfile
```

`SandboxProfile` is the stable personal/org sandbox identity. It owns the
configuration root for managed cloud, agent auth, and runtime config. Important
fields:

- `owner_scope`
- `owner_user_id`
- `organization_id`
- `billing_subject_id`
- `created_by_user_id`
- `desired_agent_auth_revision`
- `status`
- archival/deletion timestamps

Per-target applied state:

```text
server/proliferate/db/models/cloud/agent_auth.py
  SandboxProfileTargetState
```

`SandboxProfileTargetState` is per `(target_id, sandbox_profile_id)`. It tracks:

- `active_sandbox_id`
- `slot_generation`
- desired/applied agent auth revision
- agent auth status and restart/cleanup state
- applied runtime config sequence/revision
- runtime config status
- last command/worker/error for config/auth application

Target/worker/enrollment:

```text
server/proliferate/db/models/cloud/targets.py
  CloudTarget
  CloudWorker
  CloudTargetEnrollment
  CloudTargetInventory
  CloudTargetStatus
```

`CloudTarget` is the control-plane runtime identity. Important target kinds:

```text
managed_cloud
ssh
desktop_dispatch
local_direct
self_hosted_cloud
```

For managed cloud, the authoritative profile link is:

```text
cloud_targets.sandbox_profile_id
cloud_targets.profile_target_role = "primary"
```

`CloudWorker` and `CloudTargetEnrollment` carry `cloud_sandbox_id` and
`slot_generation`, so old workers cannot keep driving a replaced managed slot.

Sandbox slot:

```text
server/proliferate/db/models/cloud/sandboxes.py
  CloudSandbox
```

Managed rows have:

- `sandbox_profile_id`
- `target_id`
- `billing_subject_id`
- `slot_generation`
- provider/status/lifecycle fields
- supersede timestamps and reasons

Runtime access:

```text
server/proliferate/db/models/cloud/cloud_target_runtime_access.py
  CloudTargetRuntimeAccess
```

This stores direct AnyHarness access for the active target slot:

- `target_id`
- `sandbox_profile_id`
- `active_sandbox_id`
- `slot_generation`
- `anyharness_base_url`
- encrypted runtime token/data key
- last worker heartbeat

Workspace:

```text
server/proliferate/db/models/cloud/workspaces.py
  CloudWorkspace
  CloudWorkspaceSetupRun
```

Managed workspace fields:

- `sandbox_profile_id`
- `target_id`
- `billing_subject_id`
- `normalized_repo_key`
- `worktree_path`
- `origin`
- `anyharness_workspace_id`
- `materialized_slot_generation`
- `required_runtime_config_revision_id`
- `required_runtime_config_sequence`
- `required_agent_auth_revision`
- `status`, `ready_at`, `last_error`

Legacy compatibility fields still present:

- `runtime_environment_id`
- `active_sandbox_id`
- `runtime_url`
- `runtime_token_ciphertext`
- `anyharness_data_key_ciphertext`

Exposure:

```text
server/proliferate/db/models/cloud/exposures.py
  CloudWorkspaceExposure
```

Exposure decides whether Cloud can list, project, and command a runtime
workspace. Important fields:

- `target_id`
- `cloud_workspace_id`
- `anyharness_workspace_id`
- owner scope fields
- `visibility`: `private`, `shared_unclaimed`, `claimed`, `archived`
- `default_projection_level`
- `commandable`
- `status`: `active`, `paused`, `stale`, `revoked`
- `revision`

Commands:

```text
server/proliferate/db/models/cloud/commands.py
  CloudCommand
```

Materialization commands link Cloud product state to AnyHarness runtime state.
For managed work, `cloud_workspace_id` must travel through the command and be
echoed in worker results.

Target environment config:

```text
server/proliferate/db/models/cloud/target_config.py
  CloudTargetConfig
```

This stores materialized repo/target environment plans: env vars, tracked
files, setup/run commands, Git identity, and runtime config fragments.

## Bootstrap Flow

Create or fetch a profile:

```text
POST /v1/cloud/sandbox-profiles/personal
POST /v1/cloud/organizations/{organization_id}/sandbox-profile
```

Paths:

```text
server/proliferate/server/cloud/sandbox_profiles/api.py
server/proliferate/server/cloud/sandbox_profiles/service.py
```

Enable managed cloud for a profile:

```text
POST /v1/cloud/sandbox-profiles/{sandbox_profile_id}/enable-cloud
```

This creates/links:

```text
SandboxProfile
CloudTarget(kind = managed_cloud, profile_target_role = primary)
CloudSandbox(active slot)
SandboxProfileTargetState
CloudTargetRuntimeAccess
```

Guard/store paths:

```text
server/proliferate/db/store/cloud_profile_target_guard.py
server/proliferate/db/store/cloud_sandboxes.py
server/proliferate/server/cloud/targets/**
server/proliferate/server/cloud/compute/**
```

## Workspace Materialization Flow

1. Create the `CloudWorkspace` first.

Managed workspace creation writes a product row with:

```text
runtime_environment_id = NULL
sandbox_profile_id = <profile>
target_id = <target>
status = pending
anyharness_workspace_id = NULL
```

It also creates an active exposure without an AnyHarness workspace id.

Store:

```text
server/proliferate/db/store/cloud_workspaces.py
```

2. Queue materialization commands.

Common chain:

```text
ensure_repo_checkout
materialize_workspace(existing_path)
materialize_workspace(worktree)
```

Cloud command service:

```text
server/proliferate/server/cloud/commands/service.py
```

Automation materialization path:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/workspace.py
```

3. Worker maps `materialize_workspace` to AnyHarness.

Worker paths:

```text
anyharness/crates/proliferate-worker/src/commands/mapping.rs
anyharness/crates/proliferate-worker/src/anyharness_client/workspaces.rs
```

AnyHarness route:

```text
anyharness/crates/anyharness-lib/src/api/http/workspaces.rs
```

Mapping:

```text
existing_path -> POST /v1/workspaces/resolve
worktree      -> POST /v1/workspaces/worktrees
```

4. Worker result must echo stable fields.

Accepted materialization result includes:

```text
mode
anyharnessWorkspaceId
repoRootId
path
kind
cloudWorkspaceId
```

Cloud rejects missing or mismatched fields. On acceptance, Cloud:

- records `anyharness_workspace_id`
- records `materialized_slot_generation`
- marks workspace ready
- updates exposure with AnyHarness workspace id

Result handling:

```text
server/proliferate/db/store/cloud_sync/commands.py
```

## Environment Materialization

Workspace materialization answers:

```text
Does AnyHarness know this repo/worktree?
```

Environment materialization answers:

```text
Is the target configured with the right env/files/Git config/MCP/skills/runtime config?
```

Paths:

```text
server/proliferate/server/cloud/target_config/**
server/proliferate/server/automations/worker/cloud_execution/stages/environment.py
anyharness/crates/proliferate-worker/src/materialization/**
```

The `materialize_environment` command can apply:

- env vars
- tracked files
- Git identity/config
- setup/run command material
- runtime config fragments
- MCP/skill artifacts
- credential fragments

## Direct Target Launch

For `desktop_dispatch`, `ssh`, and `self_hosted_cloud`, Cloud can create a row
on a non-managed target and synchronously chain:

```text
checkout
materialize root
materialize worktree
start_session
optional config
send_prompt
```

Path:

```text
server/proliferate/server/cloud/workspaces/service.py
```

## Remote Access / Backfill

Remote access exposes an existing target-local AnyHarness workspace through
Cloud:

```text
upsert synced workspace
upsert exposure
enqueue backfill_exposed_workspace
worker maps local AnyHarness sessions into Cloud projection rows
```

Paths:

```text
server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/backfill/service.py
anyharness/crates/proliferate-worker/src/sync/backfill.rs
```

Desktop runtime resolution is separate:

```text
desktop/src/lib/access/anyharness/runtime-target.ts
desktop/src/hooks/workspaces/remote-access/**
desktop/src-tauri/src/commands/cloud_worker.rs
```

## Start Session Readiness

Managed `start_session` requires:

- ready `CloudWorkspace`
- active exposure
- exposure commandability
- `anyharness_workspace_id`
- owner/profile/target match
- active slot generation match
- runtime config current/applied when required
- agent auth current/applied when required

Readiness and scope logic:

```text
server/proliferate/server/cloud/commands/service.py
server/proliferate/db/store/cloud_sync/commands.py
packages/product-model/src/workspaces/cloud-work-inventory.ts
```

## Invariants

- `cloud_workspace` exists before `anyharness_workspace_id` exists.
- Managed target identity is `CloudTarget + SandboxProfile + active CloudSandbox slot`.
- `slot_generation` fences workers, leases, command results, and runtime access.
- `cloud_targets.sandbox_profile_id + profile_target_role = primary` is the managed profile link.
- Managed command leases/results must match `leased_cloud_sandbox_id` and `leased_slot_generation`.
- A managed workspace can run commands only when `materialized_slot_generation` matches the active slot.
- Exposure must be active and commandable for launch/prompt commands.
- Runtime config and agent auth must be applied/current before launch-capable commands.
- Public `POST /v1/cloud/workspaces` still uses the legacy personal runtime path and rejects org cloud creation with `org_cloud_not_ready`.

## Common Failure Modes

- Target offline/archived.
- Worker not enrolled.
- Worker lacks current managed slot identity.
- Command result came from stale `cloud_sandbox_id` or wrong `slot_generation`.
- `materialize_workspace` result lacks stable fields.
- `materialize_workspace` result has the wrong `cloudWorkspaceId`.
- Exposure lacks `anyharness_workspace_id`.
- Workspace archived or exposure revoked/read-only.
- Target/profile/owner mismatch.
- Runtime config or agent auth preflight not applied/current.
- GitHub repo inaccessible, base branch missing, or branch already exists.
- Target config workspace root outside target default root.
- Debugger mixes legacy runtime-environment path with managed profile/slot path.

## Debugging Order

1. `cloud_workspace`: status, target/profile ids, AnyHarness id, slot generation,
   worktree path, origin, last error.
2. `cloud_workspace_exposure`: active, commandable, visibility, revision,
   AnyHarness workspace id.
3. Managed target state: `cloud_targets`, `cloud_workers`, `cloud_sandbox`,
   `sandbox_profile_target_state`, `cloud_target_runtime_access`.
4. `cloud_commands`: kind, status, payload, lease ids, slot generation,
   error/result JSON.
5. Worker local SQLite: identity, pending command results, projection cursors.
6. AnyHarness workspace resolve/worktree API and runtime logs.

## Review Questions

- Explain the path from `SandboxProfile` to `AnyHarness workspace`.
- Why does `cloud_workspace` exist before `anyharness_workspace_id` exists?
- What does `slot_generation` fence?
- What fields must `materialize_workspace` echo?
- How is environment materialization different from workspace materialization?
- How do managed path and legacy runtime-environment path differ?
- What rows do you inspect when a workspace says pending forever?

