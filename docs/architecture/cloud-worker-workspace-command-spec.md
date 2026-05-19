# Cloud Worker Workspace Command Spec

Status: current implementation spec, verified against `main` on 2026-05-15.

Scope: target-side Git checkout, workspace registration, and worktree creation
commands used by Proliferate Worker.

This spec defines the CloudCommand primitives that let Cloud prepare a target
for a session without directly calling AnyHarness:

- `configure_git_identity`
- `ensure_repo_checkout`
- `materialize_workspace`

It assumes the supervised runtime bundle from
`docs/architecture/cloud-worker-runtime-bundle-supervisor-spec.md` exists:

```text
proliferate-supervisor
  -> anyharness
  -> proliferate-worker
```

The original PR-B framing in this file is historical. These command kinds now
exist on `main`; this document describes the current behavior and remaining
hardening work.

## Current Main State

`main` currently supports these worker command kinds:

```text
configure_git_identity
ensure_repo_checkout
materialize_workspace
materialize_environment
start_session
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
sync_existing_workspace
```

The workspace-preparation path used by automations is:

```text
configure_git_identity
  -> worker fetches encrypted target Git identity material through a
     worker-authenticated Cloud endpoint
  -> worker writes target-scoped Git credential/config under Proliferate-owned
     target storage

ensure_repo_checkout
  -> worker verifies Git identity is configured
  -> worker clones or fetches the target repo root path

materialize_workspace(mode=existing_path)
  -> worker calls AnyHarness /v1/workspaces/resolve for the repo root
  -> worker returns anyharnessWorkspaceId and repoRootId

materialize_workspace(mode=worktree)
  -> worker calls AnyHarness /v1/workspaces/worktrees
  -> if creation reports a compatible existing worktree, worker resolves it
     through AnyHarness and returns the existing workspace id

materialize_environment
  -> worker fetches the target config materialization plan through Cloud
  -> worker applies env vars, tracked files, MCP config, skills, agent
     credential files, and manifests to the final workspace path
```

Current caveats:

- Cloud command leasing uses inline fields on `cloud_commands`; there is no
  separate lease table.
- Worker command polling returns immediately from the server and sleeps briefly
  on empty responses. It is polling, not server-side long-poll blocking.
- The worker sync loop tails AnyHarness events by polling
  `/v1/sessions/{id}/events?after_seq=...` and uploads batches directly. There
  is no durable local event outbox table yet.
- `sync_existing_workspace` is the current implementation name for existing
  workspace backfill. The target architecture should treat this as
  `backfill_exposed_workspace`: backfill only work covered by active Cloud
  exposure/projection rows. Do not add product semantics around sync-all or
  copy-to-cloud.
- Command preconditions and worker min-version gating are not implemented yet.
- Fresh SSH targets still need the requested agent installed before
  `start_session`; Git/workspace materialization alone does not install Claude,
  Codex, Gemini, or other agent binaries.

## Goal

Cloud must be able to ask any registered target to create or resolve the
AnyHarness workspace needed before a session can start.

The command sequence is:

```text
configure_git_identity
  -> configures target Git credentials without raw tokens in command payloads

ensure_repo_checkout
  -> ensures the repo root exists and is fetchable on the target

materialize_workspace
  -> returns anyharnessWorkspaceId, repoRootId, path, branch

start_session
  -> starts selected harness/model/mode in that workspace

send_prompt / update_session_config / resolve_interaction / cancel_turn
  -> normal live session control
```

This command family answers one question:

```text
How does Cloud create the target-side AnyHarness workspace/worktree without
directly calling AnyHarness from the server?
```

## Non-Goals

Do not put automation-specific business logic in the worker. Automations use
these commands from the server-side staged pipeline.

Do not add session MCP bundle launch semantics to `materialize_workspace`.

Do not move model/mode/reasoning/session config into this command.

Do not make this command responsible for all target environment files. Target
environment materialization remains separate.

Do not make `materialize_workspace` install agent binaries or resolve provider
readiness. Agent installation/readiness is an AnyHarness agent-catalog concern
and is orchestrated separately.

## Command Coverage

Present on the worker stack:

```text
configure_git_identity
ensure_repo_checkout
materialize_workspace
start_session
materialize_environment
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
sync_existing_workspace
```

These cover target Git bootstrap, repo checkout, workspace/worktree
materialization, target config application, live session control, and existing
workspace projection backfill.

Future naming should prefer:

```text
backfill_exposed_workspace
```

over `sync_existing_workspace`. The existing command should not upload every
workspace/session visible to AnyHarness. It should be driven by Cloud-owned
exposure/projection admission.

`materialize_environment` currently applies configuration files to a filesystem
root:

```text
env vars
tracked config files
git credential config
agent credential files
MCP config
skill refs
target-config manifest
```

It intentionally does not call:

```text
POST /v1/workspaces/worktrees
POST /v1/workspaces/resolve
```

It therefore does not produce:

```text
anyharnessWorkspaceId
repoRootId
workspace path registered in AnyHarness SQLite
```

Those ids are produced by `materialize_workspace`, after
`ensure_repo_checkout` has made sure the repo root exists on the target.

## Workspace Command Name

The active workspace command kind is:

```text
materialize_workspace
```

This name is intentionally broader than `create_workspace` because the worker
may either:

- resolve/register an existing path as an AnyHarness workspace
- create a new worktree workspace from an existing repo root

The command is still narrowly scoped: it materializes the AnyHarness workspace
identity, not the full session environment.

## Exposure And Projection Boundary

Workspace materialization and workspace projection are separate.

```text
materialize_workspace
  creates/resolves target-side AnyHarness workspace identity

backfill_exposed_workspace / current sync_existing_workspace
  uploads bounded metadata/events for Cloud-exposed work only
```

Cloud owns the exposure/projection rows. Worker only applies them:

```text
No active exposure
  worker ignores the workspace/session

Active exposure
  worker may map/backfill the workspace/session

Active session projection
  worker tails AnyHarness events from the stored cursor

Commandable live projection
  Cloud may enqueue send_prompt/update/resolve commands after auth checks
```

This keeps "Continue remotely" as a visibility/control operation, not a copy or
full migration. Moving runnable state to another target is a different command
family.

## Data Model

### CloudCommand Row

The command is stored in `cloud_commands` like other worker commands:

```text
target_id       required
workspace_id    optional on enqueue; set to AnyHarness workspace id only after result
session_id      null
kind            materialize_workspace
payload_json    typed command payload
result_json     typed worker result
```

The command must be target-scoped. It is not session-scoped because the session
does not exist yet.

### Command Kind Constants

Files:

```text
server/proliferate/constants/cloud.py
anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
```

Current active command kinds include:

```text
configure_git_identity
ensure_repo_checkout
materialize_workspace
materialize_environment
start_session
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
sync_existing_workspace
```

Each active kind must be present in:

```text
ACTIVE_CLOUD_COMMAND_KINDS
DEFAULT_CLOUD_WORKER_COMMAND_KINDS
SUPPORTED_COMMAND_KINDS in worker
```

## Payload Schema

The payload is a discriminated union.

### Existing Path Mode

Use this when a repo/workspace path already exists on the target and should be
registered or resolved as an AnyHarness workspace.

```json
{
  "mode": "existing_path",
  "path": "/home/ubuntu/proliferate/workspaces/acme-api",
  "displayName": "acme-api",
  "origin": {
    "kind": "system",
    "entrypoint": "cloud"
  },
  "creatorContext": {
    "kind": "automation",
    "automationRunId": "6bf8..."
  }
}
```

Required:

```text
mode = existing_path
path
```

Optional:

```text
displayName
origin
creatorContext
```

Worker behavior:

```text
POST /v1/workspaces/resolve
{
  "path": payload.path,
  "origin": payload.origin,
  "creatorContext": payload.creatorContext
}
```

If `displayName` is present, the worker applies it through AnyHarness after the
workspace is resolved. Do not invent a worker-side display-name store.

### Worktree Mode

Use this when Cloud wants a new worktree workspace for an automation/new run.

```json
{
  "mode": "worktree",
  "repoRootId": "rr_123",
  "targetPath": "/home/ubuntu/proliferate/workspaces/acme-api-run-6bf8",
  "newBranchName": "proliferate/automation-6bf8",
  "baseBranch": "main",
  "setupScript": null,
  "origin": {
    "kind": "system",
    "entrypoint": "cloud"
  },
  "creatorContext": {
    "kind": "automation",
    "automationRunId": "6bf8..."
  }
}
```

Required:

```text
mode = worktree
repoRootId
targetPath
newBranchName
```

Optional:

```text
baseBranch
setupScript
origin
creatorContext
```

Worker behavior:

```text
POST /v1/workspaces/worktrees
{
  "repoRootId": payload.repoRootId,
  "targetPath": payload.targetPath,
  "newBranchName": payload.newBranchName,
  "baseBranch": payload.baseBranch,
  "setupScript": payload.setupScript,
  "origin": payload.origin,
  "creatorContext": payload.creatorContext
}
```

`setupScript` may be passed through to AnyHarness if the endpoint supports it.
Do not add worker-side setup-script execution.

If AnyHarness reports that the requested worktree already exists or returns a
non-success response that could correspond to an existing compatible worktree,
the worker may recover by resolving `targetPath` through
`/v1/workspaces/resolve`. Recovery must only accept a workspace whose repo root
and branch/path match the command request.

## Result Schema

The worker command result should be stable and independent of raw AnyHarness
response details:

```json
{
  "mode": "worktree",
  "anyharnessWorkspaceId": "workspace_abc",
  "repoRootId": "repo_root_abc",
  "path": "/home/ubuntu/proliferate/workspaces/acme-api-run-6bf8",
  "kind": "worktree",
  "currentBranch": "proliferate/automation-6bf8",
  "originalBranch": "main",
  "displayName": "acme-api-run-6bf8"
}
```

Required:

```text
mode
anyharnessWorkspaceId
repoRootId
path
kind
```

Optional:

```text
currentBranch
originalBranch
displayName
```

The command result may still include the raw AnyHarness response under the
existing `body` wrapper used by worker command reporting, but consumers should
read the stable result fields.

## Server Changes

### Constants

File:

```text
server/proliferate/constants/cloud.py
```

Changes:

- add `CloudCommandKind.materialize_workspace`
- add to `ACTIVE_CLOUD_COMMAND_KINDS`
- add to `DEFAULT_CLOUD_WORKER_COMMAND_KINDS`
- keep `materialize_environment` separate

### Validation

File:

```text
server/proliferate/server/cloud/commands/domain/rules.py
```

Changes:

- `materialize_workspace` must require `target_id`
- `materialize_workspace` must reject `session_id`
- `materialize_workspace` must accept absent `workspace_id`
- validate payload shape:
  - `mode` is `existing_path` or `worktree`
  - required fields for each mode are present and non-empty strings
  - reject unknown mode
  - reject payload over existing command size cap

Keep validation pure. Do not query the database from this file.

### API Models

File:

```text
server/proliferate/server/cloud/commands/models.py
```

Changes:

- add Pydantic models for `MaterializeWorkspacePayload`
- add Pydantic response helper for typed command result if command responses
  expose parsed payload/result
- preserve generic command API compatibility

### Database Migration

Files:

```text
server/proliferate/db/models/cloud/commands.py
server/alembic/versions/<new_revision>_cloud_materialize_workspace_command.py
```

If command kind is enforced by a check constraint, update it to include:

```text
materialize_workspace
```

The migration should be idempotent in the style of existing migrations.

## Worker Changes

### Cloud Client Command List

File:

```text
anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
```

Changes:

- add `"materialize_workspace"` to `SUPPORTED_COMMAND_KINDS`

### AnyHarness Workspace Client

File:

```text
anyharness/crates/proliferate-worker/src/anyharness_client/workspaces.rs
```

Current behavior:

- `existing_path` calls AnyHarness workspace resolve, not create.
- `worktree` calls AnyHarness worktree creation.
- optional display names are applied after workspace materialization.
- command results extract stable workspace fields from AnyHarness responses.

Expected structs:

```rust
pub struct AnyHarnessWorkspaceCommandResponse {
    pub status: StatusCode,
    pub body: serde_json::Value,
}

pub struct MaterializedWorkspaceResult {
    pub mode: String,
    pub anyharness_workspace_id: String,
    pub repo_root_id: String,
    pub path: String,
    pub kind: String,
    pub current_branch: Option<String>,
    pub original_branch: Option<String>,
    pub display_name: Option<String>,
}
```

If sharing `AnyHarnessCommandResponse` is simpler, keep the response type
shared but extract the typed result before reporting the command result.

Update:

```text
anyharness/crates/proliferate-worker/src/anyharness_client/mod.rs
```

to expose the new module.

### Payload Mapping

File:

```text
anyharness/crates/proliferate-worker/src/commands/mapping.rs
```

Current behavior:

- parses a typed `MaterializeWorkspacePayload`
- rejects invalid mode or missing fields with stable error codes
- maps `existing_path` to AnyHarness resolve-workspace request
- maps `worktree` to AnyHarness create-worktree request

Suggested worker-side enum:

```rust
#[derive(Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
enum MaterializeWorkspacePayload {
    ExistingPath {
        path: String,
        #[serde(default)]
        display_name: Option<String>,
        #[serde(default)]
        origin: Option<Value>,
        #[serde(default)]
        creator_context: Option<Value>,
    },
    Worktree {
        repo_root_id: String,
        target_path: String,
        new_branch_name: String,
        #[serde(default)]
        base_branch: Option<String>,
        #[serde(default)]
        setup_script: Option<String>,
        #[serde(default)]
        origin: Option<Value>,
        #[serde(default)]
        creator_context: Option<Value>,
    },
}
```

Use `deny_unknown_fields` unless existing command payload compatibility makes
that risky. Prefer strict parsing for this new command.

### Dispatcher

File:

```text
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
```

Current behavior:

- advertises `materialize_workspace`
- dispatches it only when AnyHarness is healthy
- calls the AnyHarness workspace client
- reports stable result fields
- leaves session event sync registration to later session commands because
  `materialize_workspace` is workspace-scoped, not session-scoped

Registration detail:

```text
store.upsert_sync_session(...) is session-scoped and should not be reused for
workspace-only commands unless the store already has a workspace sync table.
```

Do not invent a workspace-sync store inside this command. Return the workspace
id in the command result and let the server-side automation stage attach it to
the run and Cloud workspace rows.

## AnyHarness API Dependency

This command uses existing AnyHarness APIs:

```text
POST /v1/workspaces/resolve
POST /v1/workspaces/worktrees
```

Do not change AnyHarness APIs unless the current contract lacks a required
field. If a field is missing:

- add it to `anyharness-contract`
- update the HTTP handler
- regenerate or update OpenAPI as the repo expects
- add focused AnyHarness tests

Known existing request types:

```text
CreateWorkspaceRequest
CreateWorktreeWorkspaceRequest
WorkspaceCreatorContext
OriginContext
```

## Command Sequencing

Existing path session:

```text
CloudCommand configure_git_identity
  -> worker configures target Git credentials if stale/missing

CloudCommand ensure_repo_checkout
  -> worker clones/fetches repo root path

CloudCommand materialize_workspace(mode=existing_path)
  -> worker returns anyharnessWorkspaceId

CloudCommand start_session(workspaceId=anyharnessWorkspaceId)
  -> worker returns session id
```

Automation worktree session:

```text
CloudCommand configure_git_identity
  -> worker configures target Git credentials if stale/missing

CloudCommand ensure_repo_checkout
  -> worker clones/fetches repo root path

CloudCommand materialize_workspace(mode=existing_path)
  -> worker resolves the repo root and returns repoRootId

CloudCommand materialize_workspace(mode=worktree)
  -> worker returns anyharnessWorkspaceId

CloudCommand materialize_environment(targetConfigId, configVersion)
  -> worker applies env/credentials/MCP/skills to workspace path

CloudCommand start_session(workspaceId=anyharnessWorkspaceId, session bundle)
  -> worker starts agent

CloudCommand send_prompt
  -> worker sends automation prompt
```

Automation execution uses workspace first, environment second. If a later
target-config design needs to apply files before workspace creation, that
should be modeled explicitly rather than hidden inside the worker.

## Tests

### Server Unit Tests

Files:

```text
server/tests/unit/test_cloud_commands.py
server/tests/unit/test_cloud_worker_commands.py
```

Add tests:

- accepts valid `materialize_workspace` `existing_path` payload
- accepts valid `materialize_workspace` `worktree` payload
- rejects missing path in `existing_path`
- rejects missing `repoRootId`, `targetPath`, or `newBranchName` in `worktree`
- rejects `session_id` on `materialize_workspace`
- allows absent `workspace_id` on `materialize_workspace`
- check constraint/migration includes command kind

### Worker Rust Tests

Files:

```text
anyharness/crates/proliferate-worker/src/commands/mapping.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/anyharness_client/workspaces.rs
```

Add tests:

- parses `existing_path` payload
- parses `worktree` payload
- rejects unknown mode
- rejects missing required fields
- maps request body to AnyHarness camelCase fields
- extracts stable result fields from AnyHarness response

### Integration/Smoke

The original PR-level spec did not require a full automation smoke. The current
mainline acceptance path should include a full automation smoke because the
workspace command is now part of the automation pipeline.

Minimal existing-path smoke:

```text
1. start local AnyHarness
2. enqueue materialize_workspace existing_path command for local/SSH target
3. worker leases command
4. AnyHarness workspace appears in /v1/workspaces
5. command result includes anyharnessWorkspaceId
```

Minimal worktree smoke:

```text
1. start local AnyHarness with a repo root registered or resolvable
2. enqueue materialize_workspace worktree command with:
     repoRootId
     targetPath under the target default workspace root
     newBranchName
     baseBranch
3. worker leases command
4. target filesystem contains the expected worktree path
5. AnyHarness workspace appears in /v1/workspaces with kind=worktree
6. command result includes:
     anyharnessWorkspaceId
     anyharnessRepoRootId when available
     path
     kind=worktree
     branch/newBranchName
```

The worktree smoke is the important automation handoff. Automations should be
able to take the returned workspace id/path and attach them to
`automation_run.cloud_workspace_id` and
`automation_run.anyharness_workspace_id` without any direct Cloud ->
AnyHarness workspace call.

If this is too expensive for CI, keep it as a local smoke command and cover
server/worker mapping in unit tests.

Full SSH automation smoke:

```text
1. run local Cloud profile, for example runtime on API port 8040
2. enroll an SSH target through the installer
3. ensure target Git identity is configured through configure_git_identity
4. trigger automation targeting that SSH target
5. verify command order:
     configure_git_identity
     ensure_repo_checkout
     materialize_workspace existing_path
     materialize_workspace worktree
     materialize_environment
     start_session
     send_prompt
6. verify run reaches dispatched and AnyHarness has a session id
```

Current manual caveat: the requested agent must be installed/readied on a fresh
SSH target before `start_session`, or the run can fail with `InstallRequired`.

## Completion Checklist

- [x] `configure_git_identity` is an active CloudCommand kind
- [x] `ensure_repo_checkout` is an active CloudCommand kind
- [x] `materialize_workspace` is an active CloudCommand kind
- [x] worker advertises `materialize_workspace`
- [x] server validates payload shape
- [x] worker parses payload shape
- [x] worker calls AnyHarness resolve-workspace and worktree APIs
- [x] command result exposes stable workspace fields
- [x] worktree command returns enough path/branch/repo-root data for automation
      run attachment
- [x] no MCP/session bundle logic is added to this command
- [x] automation migration consumes the command through the staged pipeline
- [x] docs explain the difference between `materialize_workspace` and
      `materialize_environment`
- [ ] command-kind/min-version gating rejects unsupported old workers before
      enqueue
- [ ] repeatable automation smoke installs/readies requested agents on fresh
      targets before `start_session`

## Review Questions

Reviewers should be able to answer:

1. Which command creates an AnyHarness workspace?
2. Which command applies env/credentials/MCP/skills files?
3. Does `start_session` require an existing AnyHarness workspace id?
4. Can an SSH target and managed cloud target use the same command?
5. Does the command result give automations enough data to attach runs to
   the workspace?
6. For automation worktrees, which path and branch did Cloud request, and which
   workspace id did AnyHarness return?

If any answer is unclear, the PR is not finished.
