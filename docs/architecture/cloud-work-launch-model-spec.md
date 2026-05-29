# Cloud Work Launch Model Spec

Status: detailed implementation spec for the shared work launch model.

Date: 2026-05-15

## Purpose

This spec defines the shared model for starting work across Desktop, Web,
Mobile, Slack, and Automations.

The goal is to make every surface answer the same core question with the same
objects:

> What work are we starting, on which target, against which repo/workspace, with
> which runtime/materialization/config, and how do we verify it ran?

This spec is intentionally narrower than the full cloud surfaces plan. It owns
the launch model and backend boundaries. UI-specific flows are handled by later
surface specs.

## Current State

The repo already has most of the backend mechanics:

- Cloud targets, workers, enrollment, inventory, versions, and update state.
- SSH target enrollment with worker install command.
- Managed cloud target registration during sandbox boot.
- Target-level Git identity materialization.
- Automation definitions and runs with target/repo/agent/model snapshots.
- CloudCommands for `configure_git_identity`, `ensure_repo_checkout`,
  `materialize_workspace`, `materialize_environment`, `start_session`,
  `send_prompt`, `resolve_interaction`, `update_session_config`, `cancel_turn`,
  and `close_session`.
- Worker command dispatch for target materialization and AnyHarness commands.
- Cloud MCP connections and materialization.
- User-scoped cloud agent credential sync.

The main missing piece is not raw capability. The missing piece is a shared
product contract. Today the launch model is split across:

```text
Automation model:
  target, repo, prompt, agent, model, mode

Target config:
  env vars, files, setup, Git credential, agent credentials, MCP, skills

Cloud workspace:
  repo, branch, runtime state, AnyHarness workspace id

Desktop automation target picker:
  local-vs-cloud repo selection, not target-id-first compute selection
```

This spec consolidates those pieces into a single work launch model without
rewriting the whole stack at once.

## Core Layers

There are four distinct setup/execution layers.

### 1. Target Bootstrap

Happens when a machine or sandbox becomes a Proliferate target.

Owns:

```text
CloudTarget
CloudWorker
worker identity
worker/supervisor/AnyHarness versions
inventory/readiness
base workspace root
target GitHub credential
git user.name / user.email
```

Does not own:

```text
repo checkout
worktree creation
workspace env vars
MCP session config
agent session config
prompt execution
```

Invariant:

```text
After target bootstrap succeeds, ordinary git clone/fetch/push should work on
that target for the configured target user without per-workspace Git token
injection.
```

### 2. Workspace Preparation

Happens when a workspace, automation run, Slack command, or cloud chat needs a
repo/worktree on a target.

Owns:

```text
repo checkout
repo identity validation
git fetch
base branch selection
worktree path
AnyHarness repo-root registration
AnyHarness workspace/worktree registration
CloudWorkspace <-> AnyHarness workspace mapping
```

Does not own:

```text
target Git bootstrap
agent credential files
MCP config
prompt execution
```

Invariant:

```text
Workspace preparation assumes target Git is already configured. If Git is not
ready, it fails clearly as target_git_not_ready or an equivalent explicit
target-readiness error.
```

### 3. Workspace / Run Materialization

Happens after the repo/worktree exists and before the agent session starts.

Owns:

```text
env vars
tracked files
setup script
run command
MCP config
skills
agent credential files
workspace-root readiness requirements
```

Does not own:

```text
target bootstrap
repo checkout
worktree creation
session prompt execution
```

Invariant:

```text
Materialization is scoped to a workspace root or worktree. It may use reusable
target caches, but the input contract is workspace/run scoped.
```

### 4. Session Execution

Happens after workspace/run materialization.

Owns:

```text
start session
agent/model/mode/reasoning
config updates
prompt delivery
pending interactions
cancel/close
AnyHarness event stream
Cloud projections
```

Invariant:

```text
AnyHarness accepts, rejects, and orders execution-affecting commands. Cloud
queues commands and projects results; it does not manufacture canonical session
truth.
```

## Canonical Launch Flow

Every cloud-mediated launch should eventually follow this shape:

```text
1. Resolve actor, org, and source surface.
2. Resolve target.
3. Assert target is online and compatible.
4. Ensure target bootstrap is current.
5. Create or load CloudWorkspace / AutomationRun / SlackThreadLink as needed.
6. Ensure repo checkout exists on target.
7. Register repo root with AnyHarness.
8. Create/register worktree with AnyHarness.
9. Materialize workspace/run environment.
10. Start AnyHarness session.
11. Apply session config.
12. Send prompt or attach to existing session.
13. Sync events/projections back to Cloud.
```

For automations, steps 5-12 are driven by the automation run.

For Slack, steps 5-12 are driven by a Slack thread command/link.

For web/mobile new work, steps 5-12 are driven by a launch request.

For Desktop direct work, Desktop may direct-attach to AnyHarness, but equivalent
runtime-affecting actions still map to AnyHarness command/session APIs.

## Target Bootstrap Implementation

### Existing Files

```text
server/proliferate/server/cloud/targets/service.py
server/proliferate/server/cloud/targets/api.py
server/proliferate/server/cloud/targets/models.py
server/proliferate/server/cloud/targets/domain/rules.py
server/proliferate/server/cloud/targets/domain/policy.py

server/proliferate/server/cloud/worker/service.py
server/proliferate/server/cloud/worker/api.py
server/proliferate/server/cloud/worker/models.py

server/proliferate/server/cloud/target_git_identity/service.py
server/proliferate/server/cloud/target_git_identity/api.py
server/proliferate/server/cloud/target_git_identity/models.py

server/proliferate/db/models/cloud/targets.py
server/proliferate/db/models/cloud/target_git_identity.py
server/proliferate/db/store/cloud_sync/targets.py
server/proliferate/db/store/cloud_sync/worker_auth.py
server/proliferate/db/store/cloud_sync/target_git_identity.py

server/proliferate/server/cloud/runtime/target_registration.py
server/proliferate/server/cloud/runtime/provision.py

anyharness/crates/proliferate-worker/src/runtime.rs
anyharness/crates/proliferate-worker/src/identity/enrollment.rs
anyharness/crates/proliferate-worker/src/cloud_client/mod.rs
anyharness/crates/proliferate-worker/src/cloud_client/target_git_identity.rs
anyharness/crates/proliferate-worker/src/materialization/git_identity.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs

install/proliferate-target-install.sh
```

### Required Behavior

SSH enrollment:

```text
Desktop/Cloud creates target enrollment.
Cloud requires creator GitHub auth.
Cloud creates CloudTarget and single-use enrollment token.
Installer writes worker/supervisor config on SSH target.
Worker enrolls with token.
Cloud creates CloudWorker and stores inventory.
Cloud marks target online.
Cloud enqueues configure_git_identity for created_by_user_id.
Worker fetches worker-authenticated Git identity plan.
Worker writes Git credential and Git user config.
```

Managed cloud:

```text
Cloud creates or reuses a runtime environment target.
Cloud mints a fresh worker enrollment token for the sandbox boot.
Sandbox starts supervisor, worker, and AnyHarness.
Worker enrolls.
Cloud stores inventory and marks target online.
Cloud enqueues configure_git_identity for the creator/user.
Worker applies target Git identity.
```

### Required Changes

1. Make source naming explicit.

```text
server/proliferate/server/cloud/worker/service.py
  _enqueue_initial_git_identity(...)
    source should be target_enrollment, not automation
```

2. Make managed cloud target bootstrap match SSH conceptually.

```text
server/proliferate/server/cloud/runtime/provision.py
  keep legacy direct Git configuration only while needed for compatibility
  prefer worker target Git bootstrap for the durable target model
  document any transitional overlap inline or in this spec
```

3. Preserve no-secret enrollment.

```text
Enrollment tokens must never contain GitHub tokens, agent credentials, MCP
tokens, or repo env material.
```

### Tests

```text
server/tests/integration/test_cloud_targets_api.py
server/tests/integration/test_cloud_worker_updates_api.py
server/tests/unit/test_cloud_runtime_provision.py
```

Add/verify cases:

```text
SSH enrollment requires GitHub auth.
Worker enrollment queues configure_git_identity.
configure_git_identity command payload contains only targetGitIdentityId and
configVersion.
Worker fetches secrets through worker-authenticated materialization endpoint.
Managed cloud target enrollment follows the same target/worker path.
```

## Workspace Preparation Implementation

### Existing Files

```text
server/proliferate/server/automations/worker/cloud_execution/stages/workspace.py
server/proliferate/server/automations/worker/cloud_execution/commands.py
server/proliferate/server/automations/worker/cloud_execution/command_models.py
server/proliferate/server/automations/worker/cloud_execution/context.py

server/proliferate/server/cloud/workspaces/service.py
server/proliferate/server/cloud/workspaces/models.py
server/proliferate/db/models/cloud/workspaces.py
server/proliferate/db/store/cloud_workspaces.py

anyharness/crates/proliferate-worker/src/materialization/repo_checkout.rs
anyharness/crates/proliferate-worker/src/anyharness_client/workspaces.rs
anyharness/crates/proliferate-worker/src/commands/mapping.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
```

### Required Behavior

```text
Given target, repo, base branch, and desired worktree branch:

1. ensure_repo_checkout clones repo if missing.
2. ensure_repo_checkout validates existing repo if present.
3. ensure_repo_checkout fetches updates.
4. materialize_workspace(existing_path) registers repo root with AnyHarness.
5. materialize_workspace(worktree) creates/registers a worktree with AnyHarness.
6. Cloud stores the AnyHarness workspace id on the CloudWorkspace/AutomationRun.
```

### Required Changes

Create a shared work launch package so automations are no longer the only owner
of repo/worktree preparation.

```text
server/proliferate/server/cloud/work_launch/__init__.py
server/proliferate/server/cloud/work_launch/models.py
server/proliferate/server/cloud/work_launch/commands.py
server/proliferate/server/cloud/work_launch/workspace.py
```

Responsibilities:

```text
models.py
  WorkLaunchConfig
  WorkspacePrepConfig
  WorkspacePrepResult
  MaterializationConfig
  SessionLaunchConfig

commands.py
  enqueue_ensure_repo_checkout
  wait_for_ensure_repo_checkout
  enqueue_materialize_workspace
  wait_for_materialize_workspace
  enqueue_start_session
  enqueue_update_session_config
  enqueue_send_prompt

workspace.py
  ensure_repo_checkout_on_target(...)
  register_repo_root_with_anyharness(...)
  create_worktree_with_anyharness(...)
  prepare_workspace(...)
```

Then thin automation wrapper:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/workspace.py
  call server.cloud.work_launch.workspace.prepare_workspace(...)
  keep automation-specific run status transitions and claim checks here
```

Do not move automation claim lifecycle into `cloud.work_launch`.

### Tests

```text
server/tests/unit/test_cloud_executor_worker_commands.py
server/tests/unit/test_automation_cloud_execution_pipeline.py
server/tests/integration/test_cloud_commands_api.py
```

Add/verify cases:

```text
prepare_workspace enqueues checkout before AnyHarness workspace commands.
prepare_workspace fails clearly when target Git is not ready.
automation stage preserves current run transitions while delegating work prep.
materialize_workspace command payloads stay stable.
```

## Workspace / Run Materialization Implementation

### Existing Files

```text
server/proliferate/server/cloud/target_config/service.py
server/proliferate/server/cloud/target_config/api.py
server/proliferate/server/cloud/target_config/models.py
server/proliferate/server/cloud/target_config/domain/rules.py
server/proliferate/server/cloud/target_config/domain/policy.py

server/proliferate/db/models/cloud/target_config.py
server/proliferate/db/store/cloud_sync/target_config.py

server/proliferate/server/cloud/mcp_materialization/*
server/proliferate/server/cloud/mcp_connections/*
server/proliferate/db/models/cloud/mcp.py

server/proliferate/server/cloud/credentials/*
server/proliferate/db/models/cloud/credentials.py

server/proliferate/server/automations/worker/cloud_execution/stages/environment.py

anyharness/crates/proliferate-worker/src/materialization/mod.rs
```

### Required Behavior

```text
Given target, workspace root, repo, and materialization config:

1. Cloud resolves repo config.
2. Cloud resolves selected MCP connections.
3. Cloud resolves selected skill bundle refs.
4. Cloud resolves selected agent credential source.
5. Cloud creates encrypted materialization plan.
6. Cloud enqueues materialize_environment with targetConfigId/configVersion.
7. Worker fetches plan through worker-authenticated endpoint.
8. Worker writes env/files/setup/MCP/skills/agent credentials into workspace root.
9. Worker reports applied/failed.
```

### Required Changes

Rename the concept in docs and call sites, even if endpoint/table names remain
`target_config` for compatibility.

Conceptual rule:

```text
target_config implementation == workspace/run materialization plan
target Git identity == target bootstrap
```

Add launch config snapshots to automation definitions/runs.

```text
server/proliferate/db/models/automations.py
  Automation.launch_config_json
  AutomationRun.launch_config_snapshot_json

server/alembic/versions/<new>_automation_work_launch_config.py
```

Request/response/API updates:

```text
server/proliferate/server/automations/models.py
server/proliferate/server/automations/api.py
server/proliferate/db/store/automations.py
cloud/sdk/src/client/automations.ts
cloud/sdk/src/generated/openapi.ts
```

V1 launch config JSON:

```json
{
  "version": 1,
  "workspacePolicy": {
    "kind": "new_worktree"
  },
  "credentialSource": {
    "kind": "user_synced"
  },
  "gitIdentity": {
    "kind": "target_bootstrap"
  },
  "mcp": {
    "connectionIds": []
  },
  "skills": {
    "bundleRefs": []
  },
  "materialization": {
    "includeAgentCredentials": true,
    "includeGitCredentials": false
  }
}
```

Rules:

- `includeGitCredentials` defaults to false for workspace/run materialization
  because Git is target bootstrap.
- `includeAgentCredentials` defaults to true for V1 user-synced credential
  bridge.
- MCP connection ids are user-scoped in V1.
- Skills are carried as refs now, even if materialization initially writes an
  empty list.

### Tests

```text
server/tests/integration/test_automations_api.py
server/tests/unit/test_automation_service.py
server/tests/integration/test_cloud_target_config_api.py
server/tests/unit/test_mcp_materialization.py
```

Add/verify cases:

```text
Automation create stores launch_config_json.
Automation run snapshots launch_config_snapshot_json.
materialize_environment defaults includeGitCredentials=false for target-backed work.
MCP connection ids flow into materialization.
Agent credential source is visible in run metadata.
```

## Session Execution Implementation

### Existing Files

```text
server/proliferate/server/automations/worker/cloud_execution/stages/session.py
server/proliferate/server/automations/worker/cloud_execution/stages/prompt.py
server/proliferate/server/cloud/commands/service.py
server/proliferate/server/cloud/commands/models.py
server/proliferate/server/cloud/commands/domain/rules.py

anyharness/crates/proliferate-worker/src/commands/mapping.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/anyharness_client/sessions.rs
```

### Required Behavior

```text
Cloud enqueues start_session.
Worker calls AnyHarness start session.
Cloud stores AnyHarness session id.
Cloud enqueues update_session_config if needed.
Cloud enqueues send_prompt.
Worker uploads events.
Cloud updates projections.
```

### Required Changes

Move reusable command helpers into:

```text
server/proliferate/server/cloud/work_launch/commands.py
```

Automation-specific stages remain:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/session.py
server/proliferate/server/automations/worker/cloud_execution/stages/prompt.py
```

They should call shared helpers but keep:

```text
run status transitions
claim lifecycle checks
automation-specific error codes
```

Future web/mobile/Slack should call the same command helpers or higher-level
`work_launch.service` entry points.

### Tests

```text
server/tests/unit/test_cloud_executor_worker_commands.py
server/tests/unit/test_automation_cloud_execution_pipeline.py
server/tests/integration/test_cloud_commands_api.py
```

Add/verify cases:

```text
start_session payload is stable.
update_session_config supports normalized controls.
send_prompt uses stable prompt id/idempotency.
AnyHarness remains the accept/reject/order point.
```

## WorkLaunchConfig

The shared model should be stored as JSON at first and later promoted into
normalized tables only where we need queryability.

### V1 Shape

```text
WorkLaunchConfig
  version
  target
  repo
  workspacePolicy
  gitIdentity
  credentialSource
  mcp
  skills
  materialization
  sessionDefaults
  origin
```

Example:

```json
{
  "version": 1,
  "target": {
    "targetId": "uuid",
    "targetKind": "ssh",
    "executionRoute": "cloud_worker"
  },
  "repo": {
    "provider": "github",
    "owner": "proliferate-ai",
    "name": "proliferate",
    "baseBranch": "main"
  },
  "workspacePolicy": {
    "kind": "new_worktree"
  },
  "gitIdentity": {
    "kind": "target_bootstrap"
  },
  "credentialSource": {
    "kind": "user_synced"
  },
  "mcp": {
    "connectionIds": []
  },
  "skills": {
    "bundleRefs": []
  },
  "materialization": {
    "includeAgentCredentials": true,
    "includeGitCredentials": false
  },
  "sessionDefaults": {
    "agentKind": "claude",
    "modelId": null,
    "modeId": null,
    "reasoningEffort": null
  },
  "origin": {
    "source": "automation"
  }
}
```

### Persistence

Add:

```text
Automation.launch_config_json
AutomationRun.launch_config_snapshot_json
```

Keep existing columns:

```text
execution_target
cloud_target_id
cloud_target_kind_snapshot
git_owner
git_repo_name
agent_kind
model_id
mode_id
reasoning_effort
```

Reason:

```text
Existing columns remain stable/queryable and preserve backwards compatibility.
launch_config_json carries new launch semantics without excessive migrations.
```

## Desktop / Client Follow-Up

This spec does not fully define Desktop UX, but it does define the required
client-facing shape.

Current Desktop automation target selection:

```text
apps/desktop/src/lib/domain/automations/target/selection.ts
  executionTarget: cloud | local
  gitOwner
  gitRepoName
```

Required next shape:

```text
AutomationTargetSelection
  targetId
  targetKind
  executionRoute
  gitOwner
  gitRepoName
```

Likely files:

```text
apps/desktop/src/lib/domain/automations/target/selection.ts
apps/desktop/src/lib/domain/automations/target/records.ts
apps/desktop/src/hooks/automations/derived/use-automation-target-selection.ts
apps/desktop/src/components/automations/controls/AutomationTargetPicker.tsx
apps/desktop/src/components/automations/editor/AutomationEditorModal.tsx
apps/desktop/src/components/automations/list/AutomationDetailContent.tsx

apps/desktop/src/components/home/screen/HomeTargetPicker.tsx
apps/desktop/src/hooks/home/workflows/use-home-next-launch.ts
apps/desktop/src/hooks/cloud/workflows/use-create-cloud-workspace.ts
```

Required behavior:

```text
Automations and new chat use target-id-first selection.
Managed cloud, SSH, and local/direct are shown as target choices.
The UI explains whether a target can be opened directly or only dispatched via
Cloud.
```

## DDD Ownership

Final ownership:

```text
server/cloud/targets
  target bootstrap, enrollment, workers, inventory, readiness, updates

server/cloud/target_git_identity
  target-level Git identity materialization

server/cloud/work_launch
  shared target/repo/workspace/materialization/session launch contract

server/cloud/target_config
  lower-level workspace/run materialization implementation

server/cloud/workspaces
  CloudWorkspace records, access, lifecycle, projections

server/automations
  automation definition, schedule, run snapshots, claim/retry/cancel

server/integrations/slack
  Slack event parsing and formatting only; maps into work_launch/commands

anyharness/crates/proliferate-worker
  command leasing, target materialization, AnyHarness API dispatch, event upload
```

Avoid:

```text
Automation code owning generic workspace preparation forever.
Target config being treated as target bootstrap.
Slack inventing a separate launch path.
Mobile/web inventing separate Cloud command semantics.
Worker choosing credentials or product policy.
```

## Acceptance Demos

### Managed Cloud

```text
Create automation with managed cloud target.
Run now.
Cloud creates workspace/run.
Target bootstrap is current.
Repo/worktree is prepared.
Environment materializes.
Session starts.
Prompt is accepted.
Run shows target, workspace, session, and result state.
```

### SSH

```text
Create SSH target enrollment.
Run installer on SSH box.
Worker enrolls and applies target Git identity.
Create automation with SSH target.
Run now.
Repo clones/fetches on SSH target.
Worktree is created.
AnyHarness workspace/session starts on SSH target.
Prompt is accepted.
Desktop can direct-open if SSH direct access is configured; otherwise it shows
cloud-dispatch-only/open-in-web state.
```

### Local/Direct

```text
Create automation with local target.
Local executor claims run.
Local worktree/session flow remains compatible.
Run record still snapshots WorkLaunchConfig shape where applicable.
```

## Implementation Order

1. Fix naming/semantics in target bootstrap.
2. Add `server.cloud.work_launch` shared command/workspace helpers.
3. Add launch config JSON to automation definitions and runs.
4. Route automation workspace/environment/session stages through shared
   `work_launch` helpers.
5. Update SDK/OpenAPI for launch config fields.
6. Update Desktop automation target selection to target-id-first.
7. Reuse the same model for new chat, then web/mobile, then Slack.

## Open Follow-Up Questions

- Should `target_config` be renamed in code later, or remain as a compatibility
  implementation name behind `work_launch`?
- Which MCP bundle selector data exists today for Desktop automation creation?
- Should skills remain refs-only in V1 or materialize actual files immediately?
- Which launch config fields must become first-class DB columns for querying
  before web/mobile launch?
- Should managed cloud direct Git provisioning be removed immediately or kept as
  compatibility until all managed cloud launches go through worker bootstrap?
