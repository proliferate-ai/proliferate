# Cloud Worker Workspace Command Spec

Status: concrete follow-up PR spec.

Scope: PR B in the Cloud Worker migration sequence.

This spec defines the missing CloudCommand primitive for target-side workspace
creation and worktree creation.

It assumes the supervised runtime bundle from
`docs/architecture/cloud-worker-runtime-bundle-supervisor-spec.md` exists:

```text
proliferate-supervisor
  -> anyharness
  -> proliferate-worker
```

## Goal

Cloud must be able to ask any registered target to create or resolve the
AnyHarness workspace needed before a session can start.

The command sequence after this PR should be:

```text
materialize_workspace
  -> returns anyharnessWorkspaceId, repoRootId, path, branch

start_session
  -> starts selected harness/model/mode in that workspace

send_prompt / update_session_config / resolve_interaction / cancel_turn
  -> normal live session control
```

This PR answers one question:

```text
How does Cloud create the target-side AnyHarness workspace/worktree without
directly calling AnyHarness from the server?
```

## Non-Goals

Do not migrate automations in this PR.

Do not add session MCP bundle launch semantics in this PR.

Do not move model/mode/reasoning/session config into this command.

Do not make this command responsible for all target environment files. Target
environment materialization remains separate.

Do not remove server direct AnyHarness calls in this PR except where they are
trivially unused. Full deletion belongs to the automation migration PR.

## Current Command Coverage

Already present on the worker stack:

```text
start_session
materialize_environment
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
sync_existing_workspace
```

These cover live session control and target config application. They do not
create the target-side AnyHarness workspace/worktree.

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

It does not call:

```text
POST /v1/workspaces
POST /v1/workspaces/worktrees
```

It therefore does not produce:

```text
anyharnessWorkspaceId
repoRootId
workspace path registered in AnyHarness SQLite
```

## Command Name

Add one active command kind:

```text
materialize_workspace
```

This name is intentionally broader than `create_workspace` because the worker
may either:

- resolve/register an existing path as an AnyHarness workspace
- create a new worktree workspace from an existing repo root

The command is still narrowly scoped: it materializes the AnyHarness workspace
identity, not the full session environment.

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

Add:

```python
CloudCommandKind.materialize_workspace = "materialize_workspace"
```

Add to:

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
POST /v1/workspaces
{
  "path": payload.path,
  "origin": payload.origin,
  "creatorContext": payload.creatorContext
}
```

If `displayName` is present, either:

- call the existing AnyHarness display-name endpoint if available, or
- defer display-name support and return the natural AnyHarness display name

Do not invent a worker-side display-name store.

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

For this PR, `setupScript` may be passed through to AnyHarness if the endpoint
already supports it. Do not add worker-side setup-script execution.

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

New file:

```text
anyharness/crates/proliferate-worker/src/anyharness_client/workspaces.rs
```

Changes:

- add `AnyHarnessClient::create_workspace`
- add `AnyHarnessClient::create_worktree_workspace`
- parse response into a typed Rust struct, not loose `serde_json::Value`
  where practical

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

Changes:

- add `AnyHarnessCommand::MaterializeWorkspace`
- parse a typed `MaterializeWorkspacePayload`
- reject invalid mode or missing fields with stable error codes
- map `existing_path` to AnyHarness create-workspace request
- map `worktree` to AnyHarness create-worktree request

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

Changes:

- advertise `materialize_workspace`
- dispatch it only when AnyHarness is healthy
- call the new AnyHarness workspace client method
- report stable result fields
- register the new workspace for sync if the command succeeds

Registration detail:

```text
store.upsert_sync_session(...) is session-scoped and should not be reused for
workspace-only commands unless the store already has a workspace sync table.
```

If no workspace-sync store exists yet, PR B should not invent a large sync
store. Return the workspace id in command result and let PR C decide how to
wire automation run state to Cloud workspace/session rows.

## AnyHarness API Dependency

This PR should use existing AnyHarness APIs:

```text
POST /v1/workspaces
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

## Command Sequencing After PR B

Existing path session:

```text
CloudCommand materialize_workspace(mode=existing_path)
  -> worker returns anyharnessWorkspaceId

CloudCommand start_session(workspaceId=anyharnessWorkspaceId)
  -> worker returns session id
```

Automation worktree session:

```text
CloudCommand materialize_workspace(mode=worktree)
  -> worker returns anyharnessWorkspaceId

CloudCommand materialize_environment(targetConfigId, configVersion)
  -> worker applies env/credentials/MCP/skills to workspace path

CloudCommand start_session(workspaceId=anyharnessWorkspaceId, session bundle)
  -> worker starts agent

CloudCommand send_prompt
  -> worker sends automation prompt
```

PR C may choose to reorder `materialize_environment` before or after
`materialize_workspace` if the target config plan already contains a final path.
The preferred order is workspace first, environment second.

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

No full automation smoke is required in this PR.

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

The worktree smoke is the important handoff to PR C. Automations should be
able to take the returned workspace id/path and attach them to
`automation_run.cloud_workspace_id` and
`automation_run.anyharness_workspace_id` without any direct Cloud ->
AnyHarness workspace call.

If this is too expensive for CI, keep it as a local smoke command and cover
server/worker mapping in unit tests.

## Completion Checklist

- [ ] `materialize_workspace` is an active CloudCommand kind
- [ ] worker advertises `materialize_workspace`
- [ ] server validates payload shape
- [ ] worker strictly parses payload shape
- [ ] worker calls AnyHarness workspace and worktree APIs
- [ ] command result exposes stable workspace fields
- [ ] worktree command returns enough path/branch/repo-root data for automation
      run attachment
- [ ] no MCP/session bundle logic is added to this command
- [ ] no automation migration occurs in this PR
- [ ] docs explain the difference between `materialize_workspace` and
      `materialize_environment`

## Review Questions

Reviewers should be able to answer:

1. Which command creates an AnyHarness workspace?
2. Which command applies env/credentials/MCP/skills files?
3. Does `start_session` require an existing AnyHarness workspace id?
4. Can an SSH target and managed cloud target use the same command?
5. Does the command result give PR C enough data to attach automation runs to
   the workspace?
6. For automation worktrees, which path and branch did Cloud request, and which
   workspace id did AnyHarness return?

If any answer is unclear, the PR is not finished.
