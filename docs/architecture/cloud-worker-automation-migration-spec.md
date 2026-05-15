# Cloud Worker Automation Migration Spec

Status: current implementation spec, verified against `main` on 2026-05-15.

Scope: command-backed automation execution through Proliferate Worker.

This spec describes the current automation execution path that runs against any
registered target through CloudCommands.

It depends on:

- `docs/architecture/cloud-worker-runtime-bundle-supervisor-spec.md`
- `docs/architecture/cloud-worker-workspace-command-spec.md`

## Goal

Automations should not be a special server-to-AnyHarness execution path.

Automation execution should become a target-agnostic command pipeline:

```text
automation run
  -> resolve target_id
  -> configure_git_identity command
  -> ensure_repo_checkout command
  -> materialize_workspace existing_path command for repo root
  -> materialize_workspace worktree command for the run workspace
  -> materialize_environment command
  -> start_session command
  -> update_session_config command if needed
  -> send_prompt command
  -> worker event sync updates Cloud session/message/request state
```

The same pipeline must work for:

```text
managed_cloud
ssh
future desktop_dispatch / self_hosted / vpc targets
```

The executor should not know how to call E2B or SSH directly for execution
mutations. It should resolve a target and enqueue commands for that target.

## Current Main State

`main` implements the staged automation pipeline under:

```text
server/proliferate/server/automations/worker/cloud_execution/
```

The ordered stage calls are:

```text
resolve_target_stage
ensure_git_identity_stage
materialize_workspace_stage
materialize_environment_stage
start_session_stage
apply_session_config_stage
dispatch_prompt_stage
```

Stage responsibilities on `main`:

- target stage resolves/snapshots the registered target and checks online
  readiness.
- Git identity stage enqueues `configure_git_identity` using target-scoped
  encrypted Git material. Raw GitHub tokens are not placed in command payloads.
- workspace stage creates/loads the CloudWorkspace, enqueues
  `ensure_repo_checkout`, resolves the repo root with
  `materialize_workspace(mode=existing_path)`, creates the automation worktree
  with `materialize_workspace(mode=worktree)`, and attaches AnyHarness ids to
  the run.
- environment stage enqueues `materialize_environment` for env vars, tracked
  files, MCP config, skills, agent credential files, and manifests.
- session stage enqueues `start_session` and optional `update_session_config`.
- prompt stage enqueues `send_prompt` and marks the run `dispatched` after the
  command is accepted or accepted-but-queued.

Current caveats:

- Worker compatibility/min-version gating is not implemented; there are no
  pre-launch deployed old workers, so failures are currently command-level
  instead of immediate "target worker too old" errors.
- Fresh targets still need the requested agent installed/readied before
  `start_session`; Git checkout and workspace materialization do not install
  Claude/Codex/Gemini/OpenCode.
- Cloud projections/session visibility are event-ingest driven. The automation
  executor records run ids and command status, not assistant transcript rows.

## Non-Goals

Do not implement target bootstrap or supervisor behavior here. That belongs to
`docs/architecture/cloud-worker-runtime-bundle-supervisor-spec.md`.

Do not build the final Web/Mobile automation UX in this migration layer.

Do not redesign automation scheduling.

Do not fully solve retention/pruning. The PR should keep enough IDs to allow
future cleanup and should not make pruning harder.

Do not remove all Cloud runtime bootstrap code. Managed cloud may still need
server-owned provisioning before a target exists.

## Current Target Model

The target model already has the correct core shape.

`cloud_targets` is the durable target identity:

```text
id
display_name
kind
status
owner_scope
owner_user_id
organization_id
created_by_user_id
default_workspace_root
desired_anyharness_version
desired_worker_version
desired_supervisor_version
update state
timestamps
```

`cloud_workers` is the enrolled process attached to a target:

```text
id
target_id
token_hash
machine_fingerprint
hostname
status
worker_version
anyharness_version
supervisor_version
last_seen_at
last_heartbeat_at
```

`cloud_commands.target_id` is the routing key.

Worker authentication flow:

```text
worker token -> cloud_workers row -> target_id
```

Command leasing flow:

```text
CloudCommand(target_id = T)
worker for target T long-polls
Cloud leases command to that worker
worker calls local AnyHarness
worker reports result
```

The automation executor must use this routing model.

## Current Automation Model

Current automation data already stores enough execution lifecycle state for a
first migration:

```text
automation.execution_target
automation_run.execution_target
automation_run.status
automation_run.cloud_workspace_id
automation_run.anyharness_workspace_id
automation_run.anyharness_session_id
automation_run.claim_id
automation_run.dispatch_started_at
automation_run.dispatched_at
automation_run.last_error_*
```

Existing run statuses can be retained initially:

```text
queued
claimed
creating_workspace
provisioning_workspace
creating_session
dispatching
dispatched
failed
cancelled
```

Current command-backed interpretation:

```text
creating_workspace
  configure_git_identity, ensure_repo_checkout, or materialize_workspace command
  in progress

provisioning_workspace
  materialize_environment command in progress

creating_session
  start_session command in progress

dispatching
  send_prompt command in progress
```

Avoid a status migration unless it is necessary.

## Required Data Model Changes

Automations need to snapshot the selected target.

Add to `automation`:

```text
cloud_target_id UUID NULL REFERENCES cloud_targets(id) ON DELETE SET NULL
cloud_target_kind_snapshot VARCHAR(32) NULL
```

Add to `automation_run`:

```text
cloud_target_id_snapshot UUID NULL REFERENCES cloud_targets(id) ON DELETE SET NULL
cloud_target_kind_snapshot VARCHAR(32) NULL
```

The run snapshot is required because a target can be renamed, archived, or
changed after the run is created.

Naming notes:

- Keep `execution_target` temporarily if removing it causes too much migration
  churn.
- Prefer using `cloud_target_id_snapshot` as the actual command-routing source
  once a run is queued.
- `cloud_target_kind_snapshot` is for debugging/UI and not for routing.
- Use `targetId` in API request/response JSON. Do not expose the internal
  `cloud_target_id` column name on the wire.

If the existing `execution_target` check constraint only allows `cloud` and
`local`, do not force SSH into `execution_target` unless needed. The cleaner
short-term model is:

```text
execution_target = cloud
cloud_target_id_snapshot = selected managed_cloud or ssh target
```

Longer term, rename `execution_target` to a more precise execution mode.

Do not add separate automation columns for SSH host, E2B sandbox id, runtime
URL, worker id, or direct AnyHarness URL. Those are target/worker/runtime
concerns. Automation only selects a registered Cloud target.

## Target Selection Rules

Automation target selection has three moments, each with a different purpose:

```text
automation create/update
  store the user's preferred target for future runs

automation run creation
  snapshot the preferred target onto the run

automation run execution
  load the snapshotted target and enqueue commands for it
```

Rules:

- If `automation.cloud_target_id` is set, every new run snapshots it into
  `automation_run.cloud_target_id_snapshot`.
- If `automation.cloud_target_id` is null and `execution_target = cloud`,
  service may resolve the user's default managed-cloud target. If none exists,
  return a clear `target_required` error.
- If `execution_target = local`, do not set a cloud target snapshot.
- A manual run may override the automation's default target only if the API
  explicitly accepts that override and snapshots it onto the run.
- Once a run exists, execution uses the run snapshot. It does not reread the
  automation's current target preference.

The resolver may queue work for a temporarily offline target only if product
policy explicitly allows queued execution for that target kind. For the first
implementation, prefer a strict rule:

```text
ssh
  require worker online and target not archived

managed_cloud
  if no target exists, provision/register one first
  then require worker online before command execution
```

This keeps first-run failure modes obvious.

## File Ownership Map

### Automation ORM And Store

```text
server/proliferate/db/models/automations.py
server/proliferate/db/store/automations.py
server/proliferate/db/store/automation_run_claim_values.py
server/proliferate/db/store/automation_run_claims.py
server/proliferate/db/store/automation_run_claim_transitions.py
server/alembic/versions/<new_revision>_automation_target_snapshots.py
```

Expected work:

- add automation target fields
- snapshot target fields when creating automation runs
- thread target fields through `AutomationValue` and `AutomationRunValue`
- ensure claim values include target snapshot fields
- preserve existing claim and heartbeat semantics

Dataclasses must include the new fields:

```text
AutomationValue.cloud_target_id
AutomationValue.cloud_target_kind

AutomationRunValue.cloud_target_id_snapshot
AutomationRunValue.cloud_target_kind_snapshot

AutomationRunClaimValue.cloud_target_id_snapshot
AutomationRunClaimValue.cloud_target_kind_snapshot
```

Store functions that create or claim runs must never infer target selection
from `execution_target` alone after this migration. `execution_target = cloud`
only means "the Cloud executor owns this run"; it does not identify the
specific machine/sandbox.

### Automation API And Models

```text
server/proliferate/server/automations/api.py
server/proliferate/server/automations/models.py
server/proliferate/server/automations/service.py
server/proliferate/server/automations/domain/validation.py
```

Expected work:

- create/update automation can accept target selection
- list/detail responses include target selection and target snapshot
- validate selected target is visible and usable by the actor
- keep existing local automation behavior intact

Request shape:

```json
{
  "executionTarget": "cloud",
  "targetId": "a602..."
}
```

Response shape:

```json
{
  "executionTarget": "cloud",
  "targetId": "a602...",
  "targetKind": "ssh"
}
```

If `targetId` is omitted for a cloud automation, service may pick the user's
default managed cloud target if that exists. If no target exists, fail with a
clear `target_required` error.

Validation must happen in `service.py` or `domain/validation.py`, not in
`api.py`.

Validation inputs:

```text
actor user id
organization/team scope when present
executionTarget
targetId
agentKind/model/mode
repo config
```

Validation output should be a resolved target preference:

```text
cloud_target_id: UUID | None
cloud_target_kind_snapshot: str | None
```

The API should not accept raw worker ids. Workers rotate and reconnect; target
ids are the durable product identity.

## Automation Run Snapshot Timing

Snapshot target fields at run creation whenever possible:

```text
create_automation_run
scheduled run insert
manual run trigger
```

If a legacy run has no target snapshot, the cloud executor's target stage may
perform a compatibility resolution, write the snapshot back to the run, and
continue. This compatibility path is allowed only for rows created before this
migration.

The executor should not silently switch targets on retry. If a snapshotted
target is archived or unavailable, fail with a target-specific error unless
the user manually reruns against a different target.

Expected failure codes:

```text
target_required
target_not_found
target_archived
target_offline
target_not_authorized
target_missing_capability
target_agent_not_ready
```

Use these as internal failure codes first; user-facing copy can map them later.

### Automation Cloud Execution Structure

Promote cloud automation execution into a legible stage subfolder.

Target structure:

```text
server/proliferate/server/automations/worker/
  cloud_executor.py
    loop only:
      claim runs
      spawn process task
      heartbeat cleanup

  cloud_execution/
    __init__.py
    context.py
      AutomationExecutionContext
      TargetExecutionContext
      WorkspaceExecutionContext
      SessionExecutionContext

    pipeline.py
      run_automation_pipeline(ctx)
      ordered stage calls

    commands.py
      enqueue_cloud_command()
      wait_for_cloud_command()
      parse command result helpers
      idempotency helpers

    stages/
      __init__.py
      target.py
        resolve_target_stage()

      workspace.py
        materialize_workspace_stage()

      environment.py
        materialize_environment_stage()

      session.py
        start_session_stage()
        apply_session_config_stage()

      prompt.py
        dispatch_prompt_stage()

      cleanup.py
        close_orphan_session()
        fail_current_claim()
```

Do not keep substantial new logic in the older flat files if this migration rewrites
the executor. Existing files can become shims temporarily only inside the same
PR while moving tests; do not leave duplicate production paths.

## Execution Context

Use explicit context objects so stages do not pass large positional argument
lists or reload the same facts repeatedly.

Suggested dataclasses:

```python
@dataclass(frozen=True)
class AutomationExecutionContext:
    claim: AutomationRunClaimValue
    target: TargetExecutionContext | None = None
    workspace: WorkspaceExecutionContext | None = None
    session: SessionExecutionContext | None = None
```

```python
@dataclass(frozen=True)
class TargetExecutionContext:
    target_id: UUID
    target_kind: str
    default_workspace_root: str | None
    status: str
    ready_agent_kinds: tuple[str, ...]
```

```python
@dataclass(frozen=True)
class WorkspaceExecutionContext:
    cloud_workspace_id: UUID
    anyharness_workspace_id: str
    anyharness_repo_root_id: str | None
    path: str
    branch: str | None
    target_config_id: UUID | None
    target_config_version: int | None
```

```python
@dataclass(frozen=True)
class SessionExecutionContext:
    anyharness_session_id: str
```

Each stage should return a new context with additional fields populated.

## Pipeline

`pipeline.py` should make the sequence obvious:

```python
async def run_automation_pipeline(ctx: AutomationExecutionContext) -> None:
    ctx = await resolve_target_stage(ctx)
    ctx = await ensure_git_identity_stage(ctx)
    ctx = await materialize_workspace_stage(ctx)
    ctx = await materialize_environment_stage(ctx)
    ctx = await start_session_stage(ctx)
    ctx = await apply_session_config_stage(ctx)
    await dispatch_prompt_stage(ctx)
```

`cloud_executor.py` should not contain this sequence inline. It should:

- claim runs
- start heartbeat loop
- build initial context
- call `run_automation_pipeline`
- handle final exception-to-failure conversion

`cloud_executor.py` may own concurrency, loop timing, task cancellation, and
heartbeat lifecycle. It must not own command payload construction, target
resolution, workspace materialization, or session config details.

## Claim And Retry Semantics

The current claim model is good enough and should be preserved:

```text
run status
claim_id
claim_expires_at
last_heartbeat_at
executor_kind
executor_id
```

The staged pipeline must be retry-safe. Each stage should be written so a
reclaimed run can continue from persisted state:

```text
cloud_workspace_id exists
  workspace stage loads it instead of creating another CloudWorkspace

anyharness_workspace_id exists
  workspace stage skips materialize_workspace unless a repair is required

anyharness_session_id exists
  session stage skips start_session and only applies missing config if needed

dispatched_at exists
  prompt stage is complete
```

Do not rely on in-memory context to survive executor restart. Context is only a
readability layer over persisted run/command/target state.

When a command times out, the stage must distinguish:

```text
definitely not delivered
  command expired before worker lease/delivery

uncertain
  command was delivered/leased but no terminal result arrived before timeout

terminal failure
  worker/AnyHarness reported rejected or failed_delivery
```

For uncertain prompt dispatch, keep using the existing
`dispatch_uncertain`-style failure behavior so the UI and future repair logic
do not claim the prompt was safely absent.

## Stage Responsibilities

### Target Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/target.py
```

Responsibilities:

- read `cloud_target_id_snapshot` from claim
- if missing, resolve default target according to current product rule
- load target snapshot
- verify target is visible/usable for the run owner or org
- verify target is online or command-addressable
- verify required agent kind is available or at least not explicitly missing
- verify basic target readiness needed by automations:
  - `git`
  - configured agent provider
  - Node/npm/npx if MCP bundles are requested
  - writable workspace root
- write compatibility snapshot fields back to the run if this is a legacy run
  missing them

Do not inspect SSH credentials. Command execution happens through worker
long-polling, not by direct SSH.

Target stage output:

```text
TargetExecutionContext
  target_id
  target_kind
  default_workspace_root
  status
  ready_agent_kinds
```

This stage is the only automation stage allowed to choose or provision a
target.

### Git Identity Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/git_identity.py
```

Responsibilities:

- resolve the target creator/user GitHub OAuth account and Git identity used
  for v1 target Git access
- create or load the target Git identity record
- enqueue `configure_git_identity`
- wait for result
- fail explicitly if the user has no GitHub auth or Cloud cannot materialize
  the target Git identity

The command payload contains only the target Git identity id and config
version. It must never contain the raw GitHub OAuth token. The worker fetches
encrypted material through a worker-authenticated Cloud endpoint.

Command stage key:

```text
configure-git-identity:{config_version}
```

### Workspace Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/workspace.py
```

Responsibilities:

- create/load `CloudWorkspace` record for the run
- enqueue `ensure_repo_checkout`
- wait for repo checkout result
- enqueue `materialize_workspace(mode=existing_path)` to resolve the repo root
- wait for repo-root workspace result
- enqueue `materialize_workspace(mode=worktree)` to create/resolve the run
  worktree
- wait for worktree result
- attach `anyharness_workspace_id` and cloud workspace id to the run
- attach `anyharness_repo_root_id` if the worker returns one and the schema has
  a place for it; otherwise record it in command result metadata until a later
  migration adds a first-class column
- build `WorkspaceExecutionContext`

Command stage key:

```text
ensure-repo-checkout
materialize-workspace:repo-root
materialize-workspace:worktree
```

Expected `ensure_repo_checkout` payload:

```json
{
  "repo": {
    "provider": "github",
    "owner": "proliferate-ai",
    "name": "proliferate"
  },
  "checkoutPath": "/home/ubuntu/proliferate-workspaces/proliferate-ai/proliferate",
  "baseBranch": "main"
}
```

Expected worktree `materialize_workspace` payload:

```json
{
  "mode": "worktree",
  "repoRootId": "... if known ...",
  "targetPath": "...",
  "newBranchName": "...",
  "baseBranch": "...",
  "origin": {
    "kind": "system",
    "entrypoint": "automation"
  },
  "creatorContext": {
    "kind": "automation",
    "automationId": "...",
    "automationRunId": "..."
  }
}
```

Fresh targets use `ensure_repo_checkout` followed by
`materialize_workspace(mode=existing_path)` to get the repo root id before
creating the worktree. Keep this explicit rather than hiding it in the worker.

Workspace path policy:

```text
base:
  target.default_workspace_root

path:
  <base>/<repo-owner>/<repo-name>/<automation-run-id-or-branch-slug>

branch:
  <automation_cloud_executor_branch_prefix>/<run-specific-slug>
```

Do not derive target paths inside the worker. The server chooses the desired
path/branch, the worker validates and materializes it.

### Environment Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/environment.py
```

Responsibilities:

- decide whether a target config exists for this target/repo
- create or update the target config record if needed
- enqueue `materialize_environment`
- wait for result
- fail run if target config cannot be applied

Command stage key:

```text
materialize-environment:{target_config_version}
```

This stage owns durable filesystem materialization:

```text
git credentials
repo env vars
tracked files
agent auth files when required by harness
MCP/skill filesystem config when required
target config manifest
```

It does not start sessions.

It should use the Cloud target config subsystem as the source of the material
to apply. If target config does not exist for this target/repo/user, create it
from the same synced credential/environment model used by the existing Cloud
syncing UI.

The stage must be idempotent by target config version. Reapplying the same
version should be a no-op or safe overwrite on the target.

### Session Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/session.py
```

Responsibilities:

- enqueue `start_session`
- wait for session id
- attach `anyharness_session_id` to run
- apply session config commands that must happen after creation

Command stage keys:

```text
start-session
update-reasoning-effort
update-model
update-mode
```

The `start_session` payload should carry session-scoped bundle data where
AnyHarness can consume it directly:

```text
agentKind
modelId
modeId
origin
credential grant refs
MCP bundle refs/config
skill refs
```

Do not move workspace path creation into this stage.

Session result parsing must accept the worker's typed command result, not raw
AnyHarness JSON guessing in the pipeline. The helper may translate compatible
legacy bodies for one migration, but the target result is:

```json
{
  "sessionId": "sess_...",
  "workspaceId": "ws_...",
  "acceptedConfig": {
    "agentKind": "claude",
    "modelId": "...",
    "modeId": "..."
  }
}
```

### Prompt Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/prompt.py
```

Responsibilities:

- mark run `dispatching`
- enqueue `send_prompt`
- wait for accepted or accepted_but_queued
- mark run `dispatched`

Command stage key:

```text
send-prompt
```

Payload:

```json
{
  "idempotencyKey": "automation_run:<run_id>:send-prompt",
  "blocks": [
    { "type": "text", "text": "..." }
  ]
}
```

Do not write the final Cloud message row here. The accepted user message and
assistant output should arrive through worker event sync. The executor only
records command status and automation-run dispatch state.

### Cleanup Stage

File:

```text
server/proliferate/server/automations/worker/cloud_execution/stages/cleanup.py
```

Responsibilities:

- close orphan sessions when a claim is lost after session creation
- translate stage failures into automation failure codes
- avoid best-effort cleanup blocking command result persistence

Cleanup is deliberately best-effort. If a close command cannot be enqueued,
record a warning and fail the run with the original stage error. Do not mask
the original failure with cleanup failure.

## Command Helper Layer

File:

```text
server/proliferate/server/automations/worker/cloud_execution/commands.py
```

This file should be intentionally boring.

Responsibilities:

- create command rows with stable idempotency scope/key
- wait for command status
- expire timed-out commands
- parse command result body
- provide typed helpers for known stage results

It should not know business semantics such as "an automation is creating a
workspace" or "this claim is stale."

Idempotency scope:

```text
automation_run:{run_id}:target:{target_id}
```

Stage keys:

```text
configure-git-identity:{config_version}
ensure-repo-checkout
materialize-workspace:repo-root
materialize-workspace:worktree
materialize-environment:{config_version}
start-session
update-reasoning-effort
send-prompt
close-orphan-session:{session_id}
```

## CloudCommand Contracts Used By Automations

The automation executor should use the normal Cloud command store/service, not
private worker endpoints.

Every command row should include:

```text
target_id
kind
workspace_id when known
session_id when known
actor_kind = automation
actor_id = automation id or run id
source = automation
idempotency_scope = automation_run:<run_id>:target:<target_id>
idempotency_key = stage key
payload
expires_at
```

Command statuses are interpreted as:

```text
queued
  Cloud accepted the command but no worker has leased it yet.

leased
  A worker has reserved the command. Execution may not have started.

delivered
  Worker received the command and started local handling.

accepted
  AnyHarness accepted/applied the command.

accepted_but_queued
  AnyHarness accepted the command but queued it behind existing runtime work.

rejected
  AnyHarness rejected the command with a structured reason.

failed_delivery
  Worker could not deliver/apply the command to local AnyHarness.

expired / superseded
  Cloud terminal states. Treat as failure unless the stage has already been
  satisfied through persisted run state.
```

Stage success rules:

```text
materialize_workspace
  accepted or accepted_but_queued, with workspace result body

materialize_environment
  accepted or accepted_but_queued, with materialization status applied

start_session
  accepted or accepted_but_queued, with session id

update_session_config
  accepted or accepted_but_queued

send_prompt
  accepted or accepted_but_queued
```

Do not treat `delivered` as success. It only means the worker saw the command.

## Typed Payload And Result Shapes

Stage code should avoid new `dict[str, object]` spread across stages. It is
fine for the store to persist JSON, but stage code should use small
Pydantic/dataclass payload builders before serializing.

Suggested files:

```text
server/proliferate/server/automations/worker/cloud_execution/command_models.py
```

Suggested types:

```text
ConfigureGitIdentityPayload
ConfigureGitIdentityResult
EnsureRepoCheckoutPayload
EnsureRepoCheckoutResult
MaterializeWorkspacePayload
MaterializeWorkspaceResult
MaterializeEnvironmentPayload
MaterializeEnvironmentResult
StartSessionPayload
StartSessionResult
UpdateSessionConfigPayload
SendPromptPayload
```

The command helper should expose methods like:

```python
await enqueue_materialize_workspace(ctx, payload)
await wait_for_materialize_workspace(command)
await enqueue_start_session(ctx, payload)
await wait_for_start_session(command)
```

Those helpers may internally call a generic `enqueue_cloud_command`, but call
sites should read like domain stages, not raw JSON assembly.

Result parsing must be strict:

- required ids must be present and non-empty
- unexpected terminal command statuses fail the stage
- raw worker result JSON is translated once at the command helper boundary
- stages receive typed result objects

## Cloud Workspace And Session Projections

The automation executor should not poll AnyHarness directly to find
transcript/session state.

After `start_session` and `send_prompt`, visibility comes from the existing
Cloud sync path:

```text
AnyHarness emits normalized events
worker uploads event batches
Cloud ingest dedupes/stores semantic rows
Cloud updates CloudSession/CloudMessage/PendingInteraction snapshots
SSE/Web clients observe patches
```

The automation executor may persist:

```text
automation_run.cloud_workspace_id
automation_run.anyharness_workspace_id
automation_run.anyharness_session_id
automation_run.dispatched_at
```

It should not persist assistant messages, tool summaries, pending
interactions, or completion summaries directly. Those belong to the event
ingest/projection path.

## Existing File Migration Map

Current files:

```text
server/proliferate/server/automations/worker/cloud_executor.py
server/proliferate/server/automations/worker/cloud_executor_claims.py
server/proliferate/server/automations/worker/cloud_executor_commands.py
server/proliferate/server/automations/worker/cloud_executor_config.py
server/proliferate/server/automations/worker/cloud_executor_session.py
server/proliferate/server/automations/worker/cloud_executor_target.py
server/proliferate/server/automations/worker/cloud_executor_workspace.py
```

Target movement:

```text
cloud_executor.py
  keep as loop and task lifecycle entrypoint

cloud_executor_config.py
  keep if config is only used by the loop; otherwise move to
  cloud_execution/context.py or cloud_execution/config.py

cloud_executor_claims.py
  keep claim heartbeat/failure helpers if they are general worker lifecycle
  plumbing

cloud_executor_commands.py
  move into cloud_execution/commands.py

cloud_executor_target.py
  move into cloud_execution/stages/target.py

cloud_executor_workspace.py
  split into cloud_execution/stages/workspace.py and
  cloud_execution/stages/environment.py

cloud_executor_session.py
  split into cloud_execution/stages/session.py and
  cloud_execution/stages/prompt.py
```

Do not leave both old and new production implementations active. Compatibility
shims are acceptable only if they import and delegate to the new module.

## Database Migration Details

Migration should:

```text
automation:
  add cloud_target_id nullable FK cloud_targets(id) ON DELETE SET NULL
  add cloud_target_kind_snapshot nullable string(32)
  add index on cloud_target_id

automation_run:
  add cloud_target_id_snapshot nullable FK cloud_targets(id) ON DELETE SET NULL
  add cloud_target_kind_snapshot nullable string(32)
  add index on cloud_target_id_snapshot
  consider partial index for cloud claimable runs with cloud_target_id_snapshot
```

Backfill:

```text
existing cloud automations/runs:
  leave target null
  compatibility resolver can select default managed-cloud target

existing local automations/runs:
  leave target null
```

Do not attempt to infer SSH targets from repo URLs, hostnames, or previous
workspace paths.

## Product/API Behavior

Automation create/update:

```text
executionTarget = local
  targetId must be null

executionTarget = cloud
  targetId optional only if product policy can resolve a default managed target
```

Manual trigger:

```text
uses automation target by default
may accept target override if implemented
snapshot override onto run
```

List/detail:

```text
automation.target
  id
  kind
  displayName if available

automationRun.targetSnapshot
  id
  kind
```

If the target was deleted/archived after the run:

```text
show snapshotted id/kind
target display name may be null
do not hide the run
```

## Managed Cloud And SSH Exact Flow

Managed cloud:

```text
1. Automation has executionTarget=cloud and no explicit SSH target.
2. Target stage resolves or provisions the user's/team's managed cloud target.
3. Runtime bundle boots under supervisor.
4. Worker enrolls and reports online.
5. Target stage snapshots cloud_target_id_snapshot.
6. Later stages enqueue CloudCommands to that target id.
```

SSH:

```text
1. User/admin enrolls SSH target through compute settings.
2. Automation is created with executionTarget=cloud and targetId=<ssh target>.
3. Run snapshots that target id/kind.
4. Target stage requires the worker to be online.
5. Later stages enqueue the same CloudCommands to that target id.
```

No automation executor code should branch on SSH credentials. The only target
kind branches allowed are:

```text
target resolution/provisioning
readiness policy
workspace root/path defaults
error copy/code
```

## Implementation Order

The implementation on `main` has already completed the core migration order:

1. DB columns and dataclass/Pydantic fields were added for target snapshots.
2. Automation target selection is validated through the automation service.
3. Manual and scheduled runs snapshot target fields.
4. `cloud_execution/context.py`, `commands.py`, and typed command models exist.
5. Target resolution lives in `cloud_execution/stages/target.py`.
6. Git identity, workspace, environment, session, and prompt logic live in
   explicit stages.
7. `cloud_executor.py` calls `run_automation_pipeline`.
8. Direct AnyHarness mutation imports are removed from automation execution.
9. Unit coverage exists for the staged pieces.

Remaining implementation hardening:

1. Make fresh-target agent install/readiness part of the repeatable smoke path.
2. Add worker command-kind/min-version gating before enqueue.
3. Keep managed-cloud legacy direct launch fallbacks isolated to provisioning
   and reconnect compatibility.
4. Expand smoke scripts so SSH and managed cloud automations are both tested
   from `main` without manual setup.

## Acceptance Criteria

The migration is considered healthy only when all of these are true:

- A cloud automation can target an enrolled SSH target by target id.
- A cloud automation can target the managed-cloud path after the target is
  provisioned/enrolled.
- The executor never needs a runtime URL or runtime token to mutate a session.
- The executor does not create transcript/message rows directly.
- Retrying a claimed run does not create duplicate workspaces, sessions, or
  prompts when prior command results were already persisted.
- Every CloudCommand created by the executor has stable idempotency scope/key.
- A reviewer can understand the full execution order from `pipeline.py` without
  opening worker loop code.
- A fresh SSH smoke either installs/readies the requested agent automatically
  or fails before `start_session` with a clear agent-readiness error.

## Direct AnyHarness Call Removal

Automation execution must not call direct AnyHarness mutation helpers.

Disallowed in automation execution code:

```text
create_runtime_session
send_runtime_prompt
apply_runtime_config
close_runtime_session
resolve_remote_workspace
prepare_runtime_mobility_destination
```

These may still exist in managed cloud provisioning/bootstrap until the broader
runtime provisioning migration removes them.

The test gate should scan automation worker code for imports from:

```text
proliferate.integrations.anyharness.sessions
proliferate.server.cloud.runtime.anyharness_api
```

unless the import is in an explicitly allowed bootstrap-only file.

## Managed Cloud Targeting

Managed cloud is still allowed to provision a sandbox before a target exists.

After the sandbox worker enrolls, automation execution should use:

```text
target_id
```

not:

```text
runtime_url
runtime_token
```

If an automation has no selected target and product policy allows default
managed cloud, the target stage may provision or select a managed cloud target.
Once selected, later stages must be command-based.

## SSH Targeting

SSH automations require an already enrolled SSH target.

The executor should not open SSH connections.

The executor should not require the user running the server to have SSH keys.

All execution happens by:

```text
CloudCommand.target_id
worker long poll
local AnyHarness
```

## Tests

### Unit Tests

Add or update:

```text
server/tests/unit/test_automation_cloud_execution_pipeline.py
server/tests/unit/test_cloud_executor_worker_commands.py
server/tests/unit/test_automations_service.py
```

Suggested cases:

- pipeline calls stages in order
- target stage loads selected SSH target
- target stage loads selected managed cloud target
- target stage rejects archived/offline target where policy requires online
- Git identity stage enqueues `configure_git_identity`
- workspace stage enqueues `ensure_repo_checkout`
- workspace stage enqueues `materialize_workspace` for repo root and worktree
- environment stage enqueues `materialize_environment`
- session stage enqueues `start_session`
- prompt stage enqueues `send_prompt`
- idempotency keys are stable across retries
- automation run snapshots selected cloud target id/kind
- automation responses include selected target id/kind
- legacy cloud runs without a target snapshot resolve a default managed-cloud
  target or fail with `target_required`
- automation worker path has no direct AnyHarness mutation imports

### Integration Smoke

The migration should be validated as a smoke ladder. Each rung proves one spec,
and the final rung proves the full Cloud Worker architecture.

Runtime bundle / supervisor smoke:

```text
1. fresh SSH machine or freshly cleaned test target
2. run install/proliferate-target-install.sh with:
     PROLIFERATE_CLOUD_URL
     PROLIFERATE_ENROLLMENT_TOKEN
3. verify proliferate-supervisor is running
4. verify anyharness is running under supervisor
5. verify proliferate-worker is running under supervisor
6. verify target appears online in Cloud
7. verify inventory reports:
     git
     node/npm/npx
     AnyHarness version
     worker version
     supervisor version
```

Workspace command smoke:

```text
1. use the enrolled target from the runtime smoke
2. enqueue one materialize_workspace CloudCommand for that target
3. verify worker leases the command
4. verify worker calls local AnyHarness
5. verify target has the expected workspace/worktree path
6. verify command reaches accepted or accepted_but_queued
7. verify Cloud stores the returned AnyHarness workspace id/path
```

The workspace command smoke must include a `mode = worktree` case, not only an
`existing_path` case, because automation runs are expected to create isolated
worktrees under the target's default workspace root.

Automation command pipeline smoke:

```text
1. local Cloud server
2. enrolled SSH target from the runtime smoke
3. automation targeting SSH target
4. manual automation trigger
5. CloudCommands appear:
     configure_git_identity
     ensure_repo_checkout
     materialize_workspace existing_path
     materialize_workspace worktree
     materialize_environment
     start_session
     update_session_config if configured
     send_prompt
6. worker leases and accepts them
7. AnyHarness session exists
8. automation_run stores cloud_workspace_id and anyharness_workspace_id
9. CloudWorkspace records target id, repo identity, requested worktree path,
   and returned AnyHarness workspace id
10. target filesystem contains the expected automation worktree path
11. worker event sync creates Cloud session/message/projection rows
12. automation run is dispatched or failed with a specific stage error
```

Managed cloud smoke should prove the same command sequence after the managed
target is ready.

The PR stack is not architecturally complete until the final smoke proves:

```text
local Cloud server
  -> ngrok or reverse tunnel
  -> fresh SSH target enrollment
  -> target online with supervisor/AnyHarness/worker
  -> automation targeting SSH target
  -> manual trigger
  -> CloudCommands leased by worker
  -> AnyHarness worktree workspace/session/prompt accepted
  -> automation run linked to CloudWorkspace + AnyHarness workspace id
  -> target filesystem has expected worktree path
  -> worker event upload
  -> Cloud session/message/projection rows visible
  -> Cloud web view can render the run
```

Eventually this should become one repeatable command:

```bash
make smoke-cloud-worker-ssh PROFILE=worker \
  CLOUD_URL=https://example.ngrok-free.app \
  SSH_HOST=ubuntu@example \
  SSH_KEY=/path/to/key
```

The make target may start as a thin wrapper over the existing local dev server,
ngrok/reverse tunnel setup, enrollment token creation, SSH installer execution,
manual automation trigger, and database/API assertions. It should not rely on
private local state beyond the explicit arguments.

### Static Checks

Add a cheap regression check, either as a unit test or script invoked by the
server test target:

```text
rg "proliferate\\.integrations\\.anyharness\\.sessions|server\\.cloud\\.runtime\\.anyharness_api" \
  server/proliferate/server/automations/worker
```

The check should fail if automation worker code imports direct AnyHarness
mutation adapters.

### Manual Local Smoke

Expected manual loop:

```text
1. make dev PROFILE=worker
2. expose local server to SSH target with ngrok or reverse tunnel
3. enroll SSH target with install/proliferate-target-install.sh
4. create automation with executionTarget=cloud and targetId=<ssh target id>
5. trigger manual run
6. inspect cloud_commands for ordered stage commands
7. inspect automation_run for cloud_target_id_snapshot, cloud_workspace_id,
   anyharness_workspace_id, and anyharness_session_id
8. inspect CloudWorkspace for target id, repo identity, requested worktree path,
   and returned AnyHarness workspace id
9. SSH into target and confirm the expected worktree path exists under the
   target default workspace root
10. open Cloud session view and confirm transcript/event sync appears
```

This smoke is intentionally end-to-end. Unit tests prove stage logic; this
proves target registration, command leasing, worker dispatch, AnyHarness
execution, event upload, and Cloud projections are connected.

## Completion Checklist

- [x] automations can store selected cloud target id
- [x] automation runs snapshot selected cloud target id/kind
- [x] cloud executor is organized as a stage pipeline
- [x] Git identity stage uses `configure_git_identity`
- [x] workspace stage uses `ensure_repo_checkout`
- [x] workspace stage uses `materialize_workspace`
- [x] environment stage uses `materialize_environment`
- [x] session/prompt stages use existing command kinds
- [x] managed cloud automations use target id after provisioning/enrollment
- [x] SSH automations use the same command path
- [x] automation execution code has no direct AnyHarness mutation calls
- [x] event sync, not direct executor polling, updates Cloud session/message
      visibility
- [ ] fresh-target automation smoke installs/readies requested agent before
      `start_session`
- [ ] Cloud rejects enqueue for command kinds unsupported by the target worker

## Review Questions

Reviewers should be able to answer:

1. Where is the target selected?
2. Where is `cloud_target_id_snapshot` written?
3. Which file shows the ordered automation execution pipeline?
4. Which stage creates the AnyHarness workspace?
5. Which stage applies target environment config?
6. Which stage starts the session?
7. Can the same code run on SSH and managed cloud?
8. What direct AnyHarness calls remain, and are they bootstrap-only?

If any answer is unclear, the PR is not finished.
