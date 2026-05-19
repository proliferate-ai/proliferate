# Cloud Worker Implementation Phases

Status: implementation plan plus current implementation snapshot, verified
against `main` on 2026-05-15.

This document turns `docs/architecture/cloud-worker-control-plane.md` into
direct implementation phases with concrete file paths and ownership rules.

Use this when assigning implementation work. The architecture spec remains the
source of truth for the overall model; this file is the execution plan.

## Goal

Move Cloud-mediated runtime control to:

```text
Cloud client or automation
  -> CloudCommand in Proliferate Cloud
  -> Proliferate Worker on the target
  -> local AnyHarness API
  -> AnyHarness normalized events
  -> Worker event upload
  -> Cloud durable rows, snapshots, and live patches
```

The migration must preserve Desktop direct mode:

```text
Desktop rich local mode -> AnyHarness directly
```

The migration must remove production Cloud runtime control that directly calls
AnyHarness from the server. Server code may still provision compute, manage
policy, enqueue commands, ingest events, publish live patches, and store
snapshots.

## Current Main Snapshot

The original phase list below is still useful as the implementation map, but
the stack has moved beyond several "to build" statements. Current `main`
state for the AnyHarness / Proliferate Worker / supervisor path:

Implemented:

- `cloud/sdk` and `cloud/sdk-react` exist; generated OpenAPI output is tracked.
- Compute targets, SSH enrollment, worker heartbeat, target inventory, and
  direct SSH access metadata exist.
- `proliferate-supervisor` exists and is the target service entrypoint for SSH
  installs.
- Managed cloud bootstrap stages AnyHarness, Proliferate Worker, and
  Proliferate Supervisor, then launches the supervisor for fresh supervised
  runtimes.
- Worker command leasing/result reporting exists over `cloud_commands` using
  inline lease fields, not a separate lease table.
- Active worker command kinds are:

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

`sync_existing_workspace` is the current implementation command name. Treat it
as the implementation spelling of explicit exposure/projection backfill, not a
product-level sync-all primitive.

- Automation execution is staged through
  `server/proliferate/server/automations/worker/cloud_execution/`:

```text
resolve_target_stage
ensure_git_identity_stage
materialize_workspace_stage
materialize_environment_stage
start_session_stage
apply_session_config_stage
dispatch_prompt_stage
```

- Worker event sync polls AnyHarness session events by sequence and uploads
  batches directly to Cloud ingest. There is not yet a durable local event
  outbox table.
- Cloud event ingest stores bounded semantic rows, applies payload policy, and
  updates session/message/request/config state from events.
- A main-branch SSH automation smoke has verified command dispatch through
  `configure_git_identity`, `ensure_repo_checkout`, workspace materialization,
  environment materialization, session start, and prompt dispatch.

Important remaining gaps:

- Fresh target agent install/readiness is not automated in the worker
  automation smoke path. A target can be online but fail `start_session` with
  `InstallRequired` until the requested agent is installed through AnyHarness.
- Worker command-kind/min-version gating is not implemented.
- Supervisor update flow can stage/verify update requests, but no daemon path
  downloads, swaps binaries, restarts into a desired version, or rolls back.
- Some managed-cloud reconnect/credential-refresh paths still contain legacy
  direct launch fallbacks for old sandboxes.
- The worker sync path does not yet persist a separate event outbox before
  upload; command result retry state exists locally, event replay relies on
  AnyHarness event history and Cloud ingest cursors.

## Non-Negotiable Boundaries

AnyHarness owns execution truth:

- session actor loop
- prompt queue semantics
- config application semantics
- interaction acceptance/rejection
- event sequence numbers
- local SQLite runtime state
- local files/git/terminal/process capabilities

Proliferate Worker owns target transport:

- enrollment
- heartbeat
- inventory and readiness
- command leasing
- local AnyHarness API calls
- event tailing
- event upload
- local retry/outbox state
- supervisor/update coordination

Cloud owns control plane state:

- org/user/team auth
- target registry
- command queue
- event ingest and dedupe
- durable semantic transcript/config/request rows
- snapshots and live patches
- credential grants
- MCP/plugin launch input
- audit/billing/retention

Desktop owns rich direct UX:

- direct local AnyHarness SDK usage
- local workspace UI
- terminal/files/git/browser/computer-use rich surfaces
- local auth/storage/Tauri wiring

Cloud-mediated clients own thin remote UX:

- fetch snapshots
- subscribe to Cloud streams
- send Cloud commands
- render command status, transcript, config, requests, targets

## Product Objects Cloud Stores

Cloud should store concrete product rows, not an abstract UI-only event feed.

Durable Cloud rows:

```text
CloudTarget
CloudWorker
CloudWorkspace
CloudSession
CloudMessage
CloudToolCallSummary
CloudRequest
CloudSessionConfigState
CloudCommand
CloudSessionEvent
CloudEventIngestState
CloudArtifactRef
```

Where:

- `CloudWorkspace` is repo/root/workspace identity, target, owner/team,
  lifecycle, retention, and last activity.
- `CloudSession` is the cloud-visible session record: workspace, target,
  agent/model/mode, status, current turn, config version, last event sequence.
- `CloudMessage` is a completed user/assistant transcript item suitable for
  fast web/mobile/Slack rendering.
- `CloudToolCallSummary` is lightweight metadata only: tool name, status,
  timing, short summary, artifact refs. It is not raw tool input/output by
  default. ORM rows live in `db/models/cloud/sessions.py`; DB access lives in
  `db/store/cloud_sync/tool_calls.py`.
- `CloudRequest` is pending/resolved interaction state: permissions,
  elicitations, user-input requests, stale/expired requests.
- `CloudSessionConfigState` stores available config options plus current config
  for the session, as reported by AnyHarness events.
- `CloudWorkspaceExposure` is the Cloud-owned admission/policy row saying which
  target-side workspace is visible to Cloud, who can see it, and whether Cloud
  dispatch is allowed.
- `CloudSessionProjection` is the Cloud-owned cursor/read-model row saying how
  much session state Cloud should retain/render and where event upload resumes.
- `CloudCommand` is the durable queue and status record for a requested
  mutation.
- `CloudSessionEvent` is the bounded semantic event log used for replay,
  debugging, and snapshot rebuilds.
- `CloudEventIngestState` tracks per target/session cursors and gaps.
- `CloudArtifactRef` points at object-storage payloads when data is too large
  to store inline.

Projection is an architecture/control-plane object, not a user-facing noun.
Users see "remote access", "read-only", "live", "claim", and "move". The server
may expose projection status through workspace/session APIs, but product UI
should still be organized around targets, workspaces, sessions, messages,
requests, config, command status, and access state.

Live deltas are separate:

```text
live delta patches -> Redis/NATS/pubsub -> SSE/WebSocket clients
semantic facts     -> Postgres rows       -> snapshots and replay
large payloads     -> object storage      -> CloudArtifactRef
```

If no client is connected, live deltas may disappear. Durable semantic rows and
snapshots must still be written.

## Server Cloud Module Contract

Cloud server areas must use a predictable folder shape. Do not create a large
set of area-specific filenames up front. Each Cloud area starts with the same
module contract:

```text
server/proliferate/server/cloud/<area>/
  api.py          # HTTP/SSE transport only
  models.py       # Pydantic request/response schemas only
  service.py      # orchestration, transactions, store calls, integrations
  access.py       # optional resource-access route deps
  errors.py       # optional area-specific errors
  domain/
    types.py      # optional frozen dataclasses/enums used by pure rules
    rules.py      # optional pure validators, reducers, status transitions
    policy.py     # optional pure access/control policy verdicts
```

Initial Cloud areas for this migration:

```text
server/proliferate/server/cloud/
  targets/        compute target registry, enrollment, inventory, readiness
  worker/         worker-only auth, heartbeat, command lease, event upload
  commands/       CloudCommand enqueue, status, routing, idempotency
  events/         ingest, dedupe, cursor, payload policy, event log
  sessions/       CloudSession, messages, requests, config, transcript reads
  live/           Redis/NATS pubsub, SSE streams, replay
  compute/        stop/prune/extend/provider lifecycle policy
  target_config/  env, credentials, files, git, MCP materialization model
  runtime/        managed compute provisioning; direct-AnyHarness mutation paths transitional
```

Promotion rule:

- Start with `domain/types.py`, `domain/rules.py`, and `domain/policy.py`.
- Promote a more specific `domain/<concern>.py` only when one of those files is
  clearly too large or owns multiple unrelated rule families.
- Do not create `capabilities.py`, `enrollment.py`, `readiness.py`,
  `versions.py`, `routing.py`, `payload_policy.py`, etc. as default files.
  Those names are allowed only after promotion is earned.

DB files should also be predictable:

```text
server/proliferate/db/models/cloud/
  targets.py
  commands.py
  events.py
  sessions.py
  artifacts.py
  target_config.py

server/proliferate/db/store/cloud_sync/
  targets.py
  worker_auth.py
  inventory.py
  commands.py
  leases.py
  events.py
  cursors.py
  sessions.py
  messages.py
  tool_calls.py
  requests.py
  config.py
  artifacts.py
  target_config.py
```

Store files may be split into `db/store/cloud_sync/<area>/` only after a single
store file becomes too large or mixes unrelated DB ownership. The split should
be by table/resource, not by caller.

`db/models/cloud/sessions.py` owns `CloudSession`, `CloudMessage`,
`CloudToolCallSummary`, `CloudRequest`, and `CloudSessionConfigState`.
`db/store/cloud_sync/{sessions,messages,tool_calls,requests,config}.py` own
the corresponding read/write paths.

Existing cloud DB layout is transitional and must not be silently duplicated.
Phase 0 must add one disposition row per existing file before Phase 2 creates
or moves DB stores:

```text
server/proliferate/db/models/cloud/workspaces.py          keep; existing CloudWorkspace/CloudWorkspaceSetupRun owner
server/proliferate/db/models/cloud/repo_config.py         keep; repo config owner
server/proliferate/db/models/cloud/credentials.py         keep; credential owner
server/proliferate/db/models/cloud/mcp.py                 keep; MCP owner
server/proliferate/db/models/cloud/runtime_environments.py keep; managed runtime owner
server/proliferate/db/models/cloud/sandboxes.py           keep; managed sandbox owner
server/proliferate/db/models/cloud/worktree_policy.py     keep; worktree policy owner
server/proliferate/db/models/cloud/mobility.py            keep; mobility/handoff owner

server/proliferate/db/store/cloud_workspaces.py           decide: keep as owner or move whole resource, no duplicate
server/proliferate/db/store/cloud_workspace_setup_runs.py decide: keep as owner or merge with workspace store, no duplicate
server/proliferate/db/store/cloud_repo_config.py          keep unless target_config migration moves whole resource
server/proliferate/db/store/cloud_credentials.py          keep; credential owner
server/proliferate/db/store/cloud_mcp/**                  keep; MCP owner
server/proliferate/db/store/cloud_runtime_environments.py keep; runtime owner
server/proliferate/db/store/cloud_worktree_policy.py      keep; policy owner
server/proliferate/db/store/cloud_mobility.py             keep; mobility/handoff owner
```

## Phase 0: Contract Freeze And Direct-Path Audit

The phase sections below preserve the original implementation plan and file
ownership map. When a lower section describes future-looking pieces that differ
from `main`, the "Current Main Snapshot" above and the focused current specs
take precedence:

- `docs/architecture/cloud-worker-runtime-bundle-supervisor-spec.md`
- `docs/architecture/cloud-worker-workspace-command-spec.md`
- `docs/architecture/cloud-worker-automation-migration-spec.md`

### Goal

Freeze the command/event/snapshot shapes and produce an exact inventory of
direct server-to-AnyHarness calls before migration starts.

This phase prevents a hidden second runtime path from surviving the worker
migration.

### Files

Specs and audit output:

```text
docs/architecture/cloud-worker-control-plane.md
docs/architecture/cloud-worker-implementation-phases.md
docs/audits/cloud-worker-direct-anyharness-inventory.md
```

Existing direct server AnyHarness integration to audit:

```text
server/proliferate/integrations/anyharness/
  client.py
  runtime.py
  sessions.py
  workspaces.py
  workspace_ops.py
  worktrees.py

server/proliferate/server/automations/worker/
  cloud_executor_workspace.py
  cloud_executor_session.py

server/proliferate/server/cloud/runtime/
  anyharness_api.py
  provision.py
  service.py
  setup_monitor.py
  workspace_operations.py
  git_operations.py
  repo_config_apply.py
  worktree_policy_sync.py
```

AnyHarness contract files to stabilize:

```text
anyharness/crates/anyharness-contract/src/v1/commands.rs
anyharness/crates/anyharness-contract/src/v1/events.rs
anyharness/crates/anyharness-contract/src/v1/runtime.rs
```

Cloud schema and API shape specs:

```text
server/proliferate/server/cloud/commands/models.py
server/proliferate/server/cloud/events/models.py
server/proliferate/server/cloud/sessions/models.py
server/proliferate/server/cloud/targets/models.py
server/proliferate/server/cloud/worker/models.py
```

### Decisions

Production Cloud-mediated runtime commands must migrate:

- create session
- resume session
- send prompt
- update config
- resolve permission/user-input/MCP elicitation
- cancel turn/session
- sync existing workspace/session
- stop/prune/hibernate/extend when implemented through target runtime state

These direct server calls are transitional and should be removed or bypassed
for production Cloud sessions:

- `create_runtime_session`
- `prompt_runtime_session`
- `apply_runtime_reasoning_effort`
- `close_runtime_session`
- workspace setup calls that mutate AnyHarness directly
- worktree policy sync calls that mutate AnyHarness directly

These may remain temporarily while migration is staged:

- managed sandbox provisioning code in `server/proliferate/server/cloud/runtime/**`
- runtime setup monitor code needed to keep current cloud workspaces working
- direct AnyHarness integration tests
- local diagnostics and explicit developer tools

Final target:

- server does not directly mutate AnyHarness for Cloud-mediated sessions.
- `server/proliferate/integrations/anyharness/**` is either deleted or
  limited to tests, local diagnostics, or transitional code with an explicit
  audit allowlist.
- Desktop direct AnyHarness usage remains because it is not server-mediated
  Cloud runtime control.

### Required Audit Commands

Use these to create the inventory:

```bash
rg "integrations.anyharness|create_runtime_session|prompt_runtime_session|runtime_url|anyharness_workspace_id|anyharness_session_id" server/proliferate -g '*.py'
rg "AnyHarness|anyharness" server/proliferate/server/automations server/proliferate/server/cloud -g '*.py'
rg "integrations.anyharness|AnyHarness|anyharness" server/proliferate/server -g '*.py'
rg --files server/proliferate/db/models/cloud server/proliferate/db/store | rg 'cloud'
```

### Acceptance

- `docs/audits/cloud-worker-direct-anyharness-inventory.md` exists.
- Every direct AnyHarness server callsite is classified as:
  - `migrate-to-command`
  - `temporary-provisioning`
  - `test-or-diagnostic`
  - `delete`
- The audit groups every direct AnyHarness callsite by server consumer
  (`cloud`, `automations`, `billing`, `webhooks`, diagnostics, tests, etc.)
  and explicitly says whether any non-cloud production consumer remains.
- The audit includes the DB layout disposition table for every existing
  `db/models/cloud/**`, `db/store/cloud_*.py`, and `db/store/cloud_mcp/**`
  file, with no duplicate owner allowed for one ORM resource.
- No phase after Phase 4 can add a new production server-to-AnyHarness command
  path.

## Phase 1: Shared Cloud SDK Foundation

### Goal

Extract reusable Cloud API access from Desktop so Desktop, Web, Mobile, and
future developer SDKs do not each hand-roll Cloud clients.

This phase is allowed before the worker is complete because it mostly moves the
client access boundary.

### New Packages

Add two workspace packages:

These packages live under top-level `cloud/` because they are Proliferate
Cloud API clients, not AnyHarness runtime SDKs. Add exact workspace entries for
`cloud/sdk` and `cloud/sdk-react` to `pnpm-workspace.yaml`.

```text
cloud/sdk/
  package.json
  tsconfig.json
  src/
    index.ts
    client/
      core.ts
      auth.ts
      automations.ts
      commands.ts
      config.ts
      credentials.ts
      events.ts
      live.ts
      mcp.ts
      organizations.ts
      repos.ts
      sessions.ts
      targets.ts
      workspaces.ts
    streams/
      sse.ts
    types/
      automations.ts
      commands.ts
      config.ts
      credentials.ts
      events.ts
      live.ts
      organizations.ts
      sessions.ts
      targets.ts
      workspaces.ts
    generated/
      openapi.ts

cloud/sdk-react/
  package.json
  tsconfig.json
  src/
    index.ts
    context/
      CloudClientProvider.tsx
    hooks/
      automations.ts
      commands.ts
      config.ts
      credentials.ts
      live.ts
      organizations.ts
      sessions.ts
      targets.ts
      workspaces.ts
    lib/
      query-keys.ts
      client-cache.ts
```

Update workspace config:

```text
pnpm-workspace.yaml
desktop/package.json
```

Package names:

```text
@proliferate/cloud-sdk
@proliferate/cloud-sdk-react
```

The tree above is the end-state shape, not permission to pre-create empty
resource modules. Phase 1 should create the package skeleton, `client/core.ts`,
generated OpenAPI output, the React provider, and only the resource
client/hook files that are backed by an existing Desktop migration in the same
phase. Every later Desktop migration adds its SDK module in the same change.

### Desktop Migration Paths

Existing Desktop cloud access:

```text
desktop/src/lib/access/cloud/
desktop/src/hooks/access/cloud/
```

Target after migration:

```text
desktop/src/lib/access/cloud/
  client.ts                 # desktop auth/base-url/session wiring only
  timing.ts                 # desktop-local telemetry/timing if still needed

desktop/src/hooks/access/cloud/
  <resource>/query-keys.ts  # may delegate to cloud-sdk-react key helpers
  use-*.ts                  # desktop-specific auth/error/telemetry wrappers only
```

Move reusable raw endpoint logic from:

```text
desktop/src/lib/access/cloud/*.ts
```

into:

```text
cloud/sdk/src/client/*.ts
cloud/sdk/src/types/*.ts
```

Create each resource file only when its Desktop source module is moved.

Move reusable React Query logic from:

```text
desktop/src/hooks/access/cloud/**/*.ts
```

into:

```text
cloud/sdk-react/src/hooks/*.ts
cloud/sdk-react/src/lib/query-keys.ts
```

Create each hook file only when its Desktop hook migration lands.

Keep in Desktop:

- desktop auth/session storage
- Tauri/browser sign-in bridge
- product-specific workflow hooks
- Desktop-only telemetry decoration
- Desktop-only selected organization/user context if not generic

Do not keep duplicate low-level endpoint helpers in both Desktop and
`@proliferate/cloud-sdk`.

### Generated Types

The server OpenAPI schema remains the source for generated Cloud API types.

Generated output:

```text
cloud/sdk/src/generated/openapi.ts
```

Existing generated Desktop output:

```text
desktop/src/lib/access/cloud/generated/openapi.ts
```

is removed or replaced with a shim only during the migration. End state:
Desktop imports generated Cloud types through `@proliferate/cloud-sdk`.

### Acceptance

- Desktop builds using `@proliferate/cloud-sdk`.
- No product component calls raw `client.GET`/`client.POST` directly.
- SDK package skeleton, auth/base URL wiring, generated OpenAPI output, and
  the methods needed by Phase 1 Desktop migrations exist.
- New worker/cloud endpoints progressively gain typed SDK methods in the phase
  that introduces or migrates that endpoint:
  - `createTargetEnrollment`
  - `listTargets`
  - `getTarget`
  - `enqueueCommand`
  - `getCommandStatus`
  - `getWorkspaceSnapshot`
  - `getSessionSnapshot`
  - `getTranscriptSnapshot`
  - `subscribeSession`
  - `subscribeWorkspace`
- Existing Desktop Cloud functionality still works.

## Phase 2: Compute Targets, SSH Enrollment, And Supervisor MVP

### Goal

Let users register compute targets, especially SSH targets, and see them in
Desktop. SSH onboarding, installer, worker enrollment, target registry, and
supervisor MVP are one vertical.

### Server Domains

Add:

```text
server/proliferate/server/cloud/targets/
  api.py
  access.py
  models.py
  service.py
  domain/
    types.py
    rules.py
    policy.py

server/proliferate/server/cloud/worker/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py
```

Register routers in:

```text
server/proliferate/server/cloud/api.py
```

### Server DB

Add or update:

```text
server/proliferate/db/models/cloud/targets.py
server/proliferate/db/models/cloud/__init__.py  # directory already exists; export new models

server/proliferate/db/store/cloud_sync/
  __init__.py
  targets.py
  worker_auth.py
  inventory.py

server/alembic/versions/<revision>_cloud_targets_workers.py
```

Core tables:

```text
cloud_targets
cloud_workers
cloud_target_enrollments
cloud_target_inventory
cloud_target_status
```

### API Endpoints

Client/admin:

```text
POST /api/v1/cloud/targets/enrollments
GET  /api/v1/cloud/targets
GET  /api/v1/cloud/targets/{target_id}
POST /api/v1/cloud/targets/{target_id}/archive
```

Worker-only:

```text
POST /api/v1/cloud/worker/enroll
POST /api/v1/cloud/worker/heartbeat
POST /api/v1/cloud/worker/inventory
```

### Worker Crate

Add:

```text
anyharness/crates/proliferate-worker/
  Cargo.toml
  src/
    main.rs
    config.rs
    error.rs
    logging.rs
    runtime.rs
    identity/
      mod.rs
      enrollment.rs
      credentials.rs
      fingerprint.rs
    cloud_client/
      mod.rs
      auth.rs
      heartbeat.rs
      inventory.rs
    anyharness_client/
      mod.rs
      health.rs
      runtime.rs
    inventory/
      mod.rs
      platform.rs
      capabilities.rs
      mcp.rs
      providers.rs
      versions.rs
    store/
      mod.rs
      schema.rs
      migrations.rs
      identity.rs
      inventory.rs
```

Update:

```text
Cargo.toml
```

because the root workspace uses `anyharness/crates/*`.

### Supervisor Crate

Add a minimal supervisor from day one:

```text
anyharness/crates/proliferate-supervisor/
  Cargo.toml
  src/
    main.rs
    config.rs
    error.rs
    logging.rs
    process/
      mod.rs
      child.rs
      health.rs
      restart.rs
    install/
      mod.rs
      layout.rs
      service.rs
```

MVP responsibilities:

- start AnyHarness
- start Proliferate Worker
- restart either process if it exits unexpectedly
- write local logs
- expose installed version facts for worker inventory

Not MVP:

- signed artifact updates
- rollback
- staged upgrades
- idle-aware binary swap

Those move to Phase 8.

### Installer

Add:

```text
install/
  proliferate-target-install.sh
  README.md

server/proliferate/server/cloud/targets/domain/rules.py
```

Installer behavior:

- detect OS and arch
- create `~/.proliferate`
- download supervisor, AnyHarness, and worker artifacts
- write worker config with Cloud base URL and one-time enrollment token
- install systemd user service when available
- otherwise print foreground/manual fallback command
- start supervisor

Target layout:

```text
~/.proliferate/bin/anyharness
~/.proliferate/bin/proliferate-worker
~/.proliferate/bin/proliferate-supervisor
~/.proliferate/worker/config.toml
~/.proliferate/worker/worker.sqlite
~/.proliferate/logs/
```

Managed cloud images may use `$PROLIFERATE_HOME`, but the logical layout is
the same.

### Desktop Compute UX

Add:

```text
desktop/src/components/settings/panes/ComputePane.tsx
desktop/src/components/settings/panes/compute/
  AddSshTargetDialog.tsx
  ComputeTargetDetails.tsx
  ComputeTargetList.tsx
  ComputeTargetReadiness.tsx
  EnrollmentCommandBlock.tsx

desktop/src/hooks/access/cloud/targets/
  query-keys.ts
  use-cloud-targets.ts
  use-cloud-target-mutations.ts

desktop/src/hooks/settings/workflows/
  use-compute-target-enrollment.ts

desktop/src/lib/domain/compute/
  target-presentation.ts
  target-readiness.ts

desktop/src/copy/settings/
  compute.ts
```

Update:

```text
desktop/src/config/settings.ts
desktop/src/components/settings/settings-navigation.ts
desktop/src/components/settings/screen/SettingsScreen.tsx
```

UX:

- Settings has a distinct `Compute` section.
- User can click `Add SSH target`.
- UI asks for display name and optional default workspace root.
- UI creates enrollment token and shows an install command.
- After the command runs, the target appears as online/degraded/offline.
- Target details show worker version, AnyHarness version, supervisor version,
  git, node/npm/npx, python/uv, writable roots, provider readiness, MCP
  readiness, last heartbeat, and access scope.

### E2B Managed Cloud

Managed cloud target enrollment is not SSH onboarding.

Managed cloud flow:

- Cloud provisions sandbox through existing sandbox provider integration.
- Sandbox template starts supervisor, AnyHarness, and worker.
- Worker reads bootstrap token from env or metadata.
- Worker calls the same `/api/v1/cloud/worker/enroll` endpoint.
- Cloud creates or attaches a `managed_cloud` target.

Existing managed runtime provisioning remains under:

```text
server/proliferate/server/cloud/runtime/
server/proliferate/integrations/sandbox/
```

but its goal shifts from "server controls AnyHarness directly" to "server
provisions compute where worker controls AnyHarness".

### Acceptance

- Desktop can create an SSH enrollment token.
- SSH install command installs supervisor, AnyHarness, and worker.
- Worker enrolls successfully.
- Worker heartbeat updates target status.
- Inventory appears in target details.
- Target is selectable in UI once online.
- Managed cloud can enroll through the same worker endpoint.

## Phase 3: Worker Command Path

### Goal

Make Cloud commands reach AnyHarness through the worker with strong typed
payloads.

### Server Domains

Add:

```text
server/proliferate/server/cloud/commands/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py
    policy.py
```

Extend:

```text
server/proliferate/server/cloud/worker/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py
```

### Server DB

Add:

```text
server/proliferate/db/models/cloud/commands.py
server/proliferate/db/models/cloud/sessions.py
server/proliferate/db/store/cloud_sync/commands.py
server/proliferate/db/store/cloud_sync/leases.py
server/proliferate/db/store/cloud_sync/sessions.py
server/alembic/versions/<revision>_cloud_commands.py
```

Tables:

```text
cloud_commands
cloud_sessions
```

Current `main` stores lease fields inline on `cloud_commands`; there is no
separate `cloud_command_leases` table.

Constraints:

```text
unique(org_id, idempotency_key)
index(target_id, status, created_at)
index(session_id, status, created_at)
index(lease_expires_at) where status = 'leased'
unique(target_id, anyharness_session_id)
```

Phase 3 creates only the minimal `CloudSession` identity/status row needed for
command routing before full event ingest exists:

```text
cloud_session_id
org_id
target_id
workspace_id nullable
anyharness_session_id nullable until start_session is accepted
status: starting | running | rejected | failed | cancelled | unknown
last_command_id nullable
last_command_status
last_command_result_at nullable
last_observed_event_seq nullable
```

`start_session` command results create or update this row with the
AnyHarness session id. Later `send_prompt`, `resolve_interaction`,
`update_session_config`, and `cancel_turn` commands address the Cloud session
row and carry the AnyHarness session id to the Worker. This row is
command-backed until Phase 5 begins event ingest; Phase 5 extends the same ORM
and store ownership with message, request, config, tool-call, and
event-derived status fields.

### API Endpoints

Client/admin:

```text
POST /api/v1/cloud/commands
GET  /api/v1/cloud/commands/{command_id}
```

Worker:

```text
POST /api/v1/cloud/worker/commands/lease
POST /api/v1/cloud/worker/commands/{command_id}/delivery
POST /api/v1/cloud/worker/commands/{command_id}/result
```

### Command Kinds

V1 command kinds:

```text
start_session
send_prompt
resolve_interaction
update_session_config
cancel_turn
sync_existing_workspace
```

`sync_existing_workspace` should evolve toward `backfill_exposed_workspace` once
the exposure/projection admission model is implemented.

V1.1 command kinds:

```text
stop_session
close_session
stop_target
prune_workspace
materialize_environment
refresh_inventory
```

### Cloud Command Envelope

Every command must include:

```text
command_id
idempotency_key
org_id
actor_user_id nullable
source: web | mobile | slack | api | automation | desktop_cloud
target_id
workspace_id nullable
session_id nullable
kind
payload
observed_event_seq nullable
preconditions
created_at
expires_at nullable
```

Command payloads must be typed Pydantic models on the server and typed Rust
enums in the worker. Do not pass arbitrary `serde_json::Value` past the edge of
the parser. If a provider-specific field is unavoidable, wrap it in a named
typed extension object with validation and size limits.

### Worker Implementation

Add:

```text
anyharness/crates/proliferate-worker/src/cloud_client/
  commands.rs

anyharness/crates/proliferate-worker/src/commands/
  mod.rs
  dispatcher.rs
  mapping.rs
  preconditions.rs
  result.rs

anyharness/crates/proliferate-worker/src/anyharness_client/
  sessions.rs
  workspaces.rs
```

Responsibility split:

- `dispatcher.rs` chooses the local AnyHarness client method for the command
  kind.
- `mapping.rs` converts typed Cloud payloads into typed AnyHarness request
  payloads.
- `preconditions.rs` checks cheap local freshness before making the request.
- `result.rs` maps local accepted/rejected/error states back to Cloud command
  status.

### AnyHarness Contract Additions

Add optional command metadata to existing requests:

Current `main` has not added these fields. Worker dispatch uses existing
AnyHarness request bodies, and Cloud command ids/preconditions remain
Cloud/worker concerns.

```text
PromptSessionRequest.command_metadata
SetSessionConfigOptionRequest.command_metadata
SetSessionConfigOptionRequest.expected_config_version
ResolveInteractionRequest.command_metadata
ResolveInteractionRequest.expected_interaction_version
CreateSessionRequest.command_metadata
CreateSessionRequest.target_context
CancelSessionRequest.command_metadata
```

Place types in:

```text
anyharness/crates/anyharness-contract/src/v1/commands.rs
```

Do not create parallel worker-only AnyHarness routes when an existing route can
accept optional command metadata.

### Acceptance

- Worker long-polls and leases commands.
- `start_session` creates or updates a minimal CloudSession identity row from
  the worker delivery/result path.
- `send_prompt` reaches a local AnyHarness session through the worker.
- `resolve_interaction` reaches AnyHarness through the worker.
- `update_session_config` reaches AnyHarness through the worker.
- Duplicate idempotency keys return the same Cloud command.
- Expired/stale leases recover and can be re-leased.
- AnyHarness rejection updates Cloud command status as rejected.

## Phase 4: Direct Server-To-AnyHarness Migration

### Goal

Move production Cloud and automation runtime mutations from direct server
AnyHarness calls to Cloud commands.

This is the semantic migration. Phase 3 gives us the path; Phase 4 uses it.

### Must Migrate

Current automation direct runtime files:

```text
server/proliferate/server/automations/worker/cloud_executor_workspace.py
server/proliferate/server/automations/worker/cloud_executor_session.py
```

Current direct runtime integration:

```text
server/proliferate/integrations/anyharness/sessions.py
server/proliferate/integrations/anyharness/workspaces.py
server/proliferate/integrations/anyharness/workspace_ops.py
server/proliferate/integrations/anyharness/worktrees.py
```

Current cloud runtime direct setup code:

```text
server/proliferate/server/cloud/runtime/provision.py
server/proliferate/server/cloud/runtime/service.py
server/proliferate/server/cloud/runtime/repo_config_apply.py
server/proliferate/server/cloud/runtime/worktree_policy_sync.py
```

### Target Automation Shape

Add command-oriented executor helpers:

```text
server/proliferate/server/automations/worker/
  cloud_executor_commands.py
  cloud_executor_target.py
```

Migration:

- `cloud_executor_workspace.py` creates/selects a `CloudWorkspace` and target.
- It enqueues worker commands instead of directly preparing AnyHarness
  workspace state.
- `cloud_executor_session.py` enqueues:
  - `start_session`
  - `update_session_config`
  - `send_prompt`
- Automation run state advances from Cloud command status and the minimal
  command-backed CloudSession identity/status row introduced in Phase 3.
  Event-derived transcript, request, config, and turn-detail state starts in
  Phase 5.

Automation can still own:

- schedule/claim lifecycle
- run state
- deciding which target/workspace to use
- recording automation-specific failure codes

Automation must not own:

- direct prompt delivery to AnyHarness
- direct session creation in AnyHarness
- direct config mutation in AnyHarness

### Target Cloud Runtime Shape

Keep:

```text
server/proliferate/server/cloud/runtime/
```

for managed compute lifecycle:

- provision sandbox
- attach existing sandbox
- create runtime environment record
- create enrollment token/bootstrap material
- wait for worker enrollment and readiness
- retire/stop/prune sandbox according to policy

Remove or make transitional:

- direct session creation
- direct prompt sending
- direct config application
- direct AnyHarness workspace mutation once worker commands exist

### Integration Boundary End State

By the end of this phase:

```bash
rg "proliferate.integrations.anyharness" server/proliferate/server -g '*.py'
```

should only return:

- explicit transitional allowlist entries
- tests
- diagnostics
- provisioning code with an issue/todo pointing to the exact worker command
  that will replace it

### Acceptance

- A cloud automation can start a session and send its prompt through
  `CloudCommand -> Worker -> AnyHarness`.
- Automation progression in this phase relies on Cloud command status and the
  minimal CloudSession row, not on Phase 5 event-ingest rows.
- The old automation path no longer imports `create_runtime_session`,
  `prompt_runtime_session`, or `apply_runtime_reasoning_effort`.
- Managed cloud provisioning still works.
- Desktop direct AnyHarness usage still works.
- There is a short allowlist for any remaining server direct AnyHarness usage.

## Phase 5: Worker Event Sync And Cloud Ingest

### Goal

Upload AnyHarness session facts to Cloud and store durable semantic rows.

This is not token-level database replication. Live deltas can be chatty;
durable Cloud storage must be bounded and semantic.

### AnyHarness Requirements

Ensure session event envelopes carry:

```text
session_id
seq
event_id
event_type
schema_version
actor/source metadata
created_at
payload
payload_size/truncation/blob metadata where relevant
```

Contract file:

```text
anyharness/crates/anyharness-contract/src/v1/events.rs
```

Worker reads:

```text
GET /v1/sessions/{session_id}/events?after_seq=...
GET /v1/sessions/{session_id}/stream?after_seq=...
```

### Worker Implementation

Add:

```text
anyharness/crates/proliferate-worker/src/sync/
  mod.rs
  backfill.rs
  cursor.rs
  event_batch.rs
  mapper.rs
  outbox.rs
  tailer.rs

anyharness/crates/proliferate-worker/src/cloud_client/
  events.rs

anyharness/crates/proliferate-worker/src/store/
  cursors.rs
  outbox.rs
```

Loop split:

- `tailer.rs` talks to local AnyHarness and local worker SQLite.
- `outbox.rs` uploads retryable batches to Cloud.

The tailer exists even though AnyHarness has its own SQLite because the worker
needs an independent retry/outbox cursor for Cloud upload. It should not
interpret transcript meaning.

Batch defaults:

```text
flush after 100 ms
or 100 events
or 512 KB payload
or boundary event
```

Boundary events:

```text
message_completed
tool_call_started
tool_call_completed
interaction_requested
interaction_resolved
turn_completed
session_failed
config_updated
```

### Server Domains

Add:

```text
server/proliferate/server/cloud/events/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py

server/proliferate/server/cloud/sessions/
  api.py
  models.py
  access.py
  service.py
  domain/
    types.py
    rules.py
    policy.py
```

### Server DB

Add or extend:

```text
server/proliferate/db/models/cloud/events.py
server/proliferate/db/models/cloud/sessions.py
server/proliferate/db/models/cloud/artifacts.py

server/proliferate/db/store/cloud_sync/
  events.py
  cursors.py
  sessions.py
  messages.py
  tool_calls.py
  requests.py
  config.py
  artifacts.py

server/alembic/versions/<revision>_cloud_event_ingest.py
```

Tables:

```text
cloud_session_events
cloud_event_ingest_cursors
cloud_sessions (extend the Phase 3 command-backed row with event-derived state)
cloud_messages
cloud_tool_call_summaries
cloud_requests
cloud_session_config_state
cloud_artifact_refs
```

`db/models/cloud/sessions.py` owns `CloudSession`, `CloudMessage`,
`CloudToolCallSummary`, `CloudRequest`, and `CloudSessionConfigState`.
`db/store/cloud_sync/tool_calls.py` is the only store for
`CloudToolCallSummary` rows.

### Ingest Endpoint

Worker endpoint:

```text
POST /api/v1/cloud/worker/events/batches
```

Ingest order:

```text
1. authenticate worker
2. validate target/session ownership
3. parse typed event batch
4. dedupe by target_id + session_id + anyharness_seq
5. apply payload policy
6. write durable semantic event rows
7. update product rows:
   - CloudWorkspace
   - CloudSession
   - CloudMessage
   - CloudToolCallSummary
   - CloudRequest
   - CloudSessionConfigState
8. update ingest cursor
9. publish patches to live fanout
10. ack accepted contiguous cursor to worker
```

Do not publish durable patches as final unless the durable write succeeded.
Live-only deltas may publish before completion only if marked ephemeral.

### Payload Policy

Default durable policy:

```text
store:
  workspace/session lifecycle
  turn lifecycle
  user message accepted/completed
  assistant message completed
  tool call started/completed metadata
  interaction requested/resolved
  config changed
  session status changed
  artifact/blob references

do not store by default:
  per-token deltas
  raw item_delta rows
  raw tool input/output bodies
  terminal byte streams
  browser/computer-use frames
  screenshots inline
  full file contents
  raw ACP internals
```

Caps:

```text
inline payload soft cap: 64 KB
inline payload hard cap: 256 KB
durable session soft cap: 5k semantic events or 15 MB
durable session hard cap: 10k semantic events or 25 MB
```

Oversized data becomes:

- truncated
- summarized
- stored as `CloudArtifactRef`
- or excluded by policy

Durable session hard-cap behavior is deterministic. On the write that would
cross the hard cap, Cloud first compacts eligible older semantic events in the
same transaction. If the session still exceeds the hard cap, Cloud writes a
bounded `retention_exceeded` marker, marks the session sync state degraded,
stores only lifecycle/command/request-critical facts and artifact references,
excludes low-value transcript or tool metadata according to policy, and
advances the ingest cursor only for events whose storage/exclusion decision was
recorded. The Worker uploads events; Cloud alone decides compaction,
exclusion, and degraded-state transitions.

### Acceptance

- Worker tails local AnyHarness events.
- Worker uploads event batches.
- Duplicate uploads are harmless.
- Payload hash mismatch for same seq marks sync degraded.
- Cloud stores messages, sessions, config, requests, and tool summaries.
- Cloud does not durably store token-level deltas by default.
- If no SSE clients are connected, durable rows and snapshots still update.

## Phase 6: Cloud Snapshots, Redis Pubsub, And SSE

### Goal

Expose fast Cloud reads and live streams to Desktop cloud views, Web, Mobile,
Slack, and future API clients.

### Server Domains

Continue:

```text
server/proliferate/server/cloud/sessions/
server/proliferate/server/cloud/live/
```

Add:

```text
server/proliferate/server/cloud/live/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py

server/proliferate/integrations/pubsub/
  __init__.py
  redis.py
  models.py
```

`integrations/pubsub` owns Redis/NATS mechanics. `cloud/live` owns product
stream authorization, channel naming, replay, and patch shape.

### API Endpoints

Snapshot reads:

```text
GET /api/v1/cloud/workspaces
GET /api/v1/cloud/workspaces/{workspace_id}
GET /api/v1/cloud/sessions/{session_id}
GET /api/v1/cloud/sessions/{session_id}/transcript
GET /api/v1/cloud/targets/{target_id}
GET /api/v1/cloud/commands/{command_id}
```

Live streams:

```text
GET /api/v1/cloud/workspaces/{workspace_id}/stream
GET /api/v1/cloud/sessions/{session_id}/stream
GET /api/v1/cloud/targets/{target_id}/stream
```

SSE events:

```text
snapshot
patch
command_status
heartbeat
```

Stream clients should consume snapshots and patches. They should not rebuild
transcript state from raw AnyHarness events.

### Shared SDK

Add to:

```text
cloud/sdk/src/client/live.ts
cloud/sdk/src/streams/sse.ts
cloud/sdk/src/types/live.ts
cloud/sdk-react/src/hooks/live.ts
```

Required SDK functions:

```text
getWorkspaceSnapshot()
getSessionSnapshot()
getTranscriptSnapshot()
subscribeWorkspace()
subscribeSession()
subscribeTarget()
```

### Desktop Cloud Views

Add or migrate access hooks:

```text
desktop/src/hooks/access/cloud/workspaces/
desktop/src/hooks/access/cloud/sessions/
desktop/src/hooks/access/cloud/live/
desktop/src/hooks/access/cloud/targets/
```

Product surfaces can initially be minimal. The key requirement is that Desktop
can inspect the same Cloud snapshots that Web/Mobile will consume.

### Web Smoke Client

If the web app exists in this repo by this phase, it should depend on the
shared SDK packages instead of copying Desktop access code.

Expected future paths:

```text
web/package.json
web/src/app/
web/src/components/sessions/
web/src/hooks/access/cloud/
web/src/routes/workspaces.tsx
web/src/routes/sessions.$sessionId.tsx
```

If the web app is not yet in this repo, create only a minimal internal smoke
page or test client after confirming the intended app location.

### Acceptance

- Session stream returns initial snapshot and live patches.
- Workspace stream returns session/status changes.
- Redis/NATS failure does not corrupt durable rows.
- Reconnecting with cursor replays durable patches after cursor.
- Desktop cloud view can render target/session/transcript snapshots.
- Shared SDK exposes stream helpers.

## Phase 7: Credential And Environment Sync For Targets

### Goal

Make local, SSH, and managed cloud targets receive the same environment,
credential, git, and MCP launch configuration model.

This extends the existing Cloud environment configuration page rather than
creating a separate ad hoc SSH secrets flow.

### Existing Code To Reuse

Server:

```text
server/proliferate/server/cloud/credentials/
server/proliferate/server/cloud/repo_config/
server/proliferate/server/cloud/mcp_catalog/
server/proliferate/server/cloud/mcp_connections/
server/proliferate/server/cloud/mcp_materialization/
```

Desktop:

```text
desktop/src/components/settings/panes/EnvironmentsPane.tsx
desktop/src/components/settings/panes/repo/CloudRepoSection.tsx
desktop/src/lib/domain/settings/environment-draft.ts
desktop/src/hooks/access/cloud/use-cloud-credentials.ts
desktop/src/hooks/access/cloud/use-cloud-repo-config.ts
desktop/src/hooks/access/cloud/use-resync-cloud-workspace-credentials.ts
desktop/src/hooks/access/cloud/use-resync-cloud-workspace-files.ts
```

### New Target Config Domain

Add:

```text
server/proliferate/server/cloud/target_config/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py
    policy.py
```

DB:

```text
server/proliferate/db/models/cloud/target_config.py
server/proliferate/db/store/cloud_sync/target_config.py
server/alembic/versions/<revision>_cloud_target_config.py
```

Worker:

```text
anyharness/crates/proliferate-worker/src/commands/mapping.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/materialization/
  mod.rs
  env.rs
  files.rs
  git.rs
  mcp.rs
  skills.rs
```

Command kind:

```text
materialize_environment
```

### Config Model

Target config contains:

```text
env vars
tracked files
git credential grant
git author/committer identity
MCP bundle materialization plan
skill bundle refs
package/runtime readiness requirements
target-specific install/cache paths
```

It must not contain broad permanent raw secrets unless explicitly required and
approved by policy. Prefer session-scoped or target-scoped grants.

### Readiness Checks

Worker inventory reports:

```text
git
node
npm
npx
python
uv
network egress
writable plugin cache
browser/playwright support when relevant
```

Most first-party MCPs can assume Node once target readiness reports it. If a
tool needs Python/uv/browser/docker, its bundle declares that requirement and
Cloud/Worker mark the target degraded for that bundle until ready.

### Desktop UX

Extend the existing Cloud environment section so target choice is explicit.

Paths:

```text
desktop/src/components/settings/panes/repo/CloudRepoSection.tsx
desktop/src/components/settings/panes/repo/TargetEnvironmentSection.tsx
desktop/src/components/settings/panes/compute/ComputeTargetDetails.tsx

desktop/src/hooks/settings/workflows/use-target-environment-settings.ts
desktop/src/hooks/cloud/workflows/use-sync-target-environment.ts
desktop/src/lib/domain/settings/environment-draft.ts
```

UX:

- Repo environment page can show local, managed cloud, and SSH target sync.
- Target details show whether credentials/env are synced.
- User can resync selected files/credentials to a target.
- Workspace/automation creation can select an eligible target.

### Acceptance

- SSH target can receive repo env vars and tracked files.
- Managed cloud target can receive the same config model.
- Git credentials are present where required for repo operations.
- MCP readiness and materialization state are visible.
- Worker does not decide credential policy; it materializes resolved grants.

## Phase 8: Supervisor Updates, Retention, Observability, And Hardening

### Goal

Make targets operationally reliable: updateable, observable, revocable,
retention-aware, and safe to run at scale.

### Supervisor Update System

Extend:

```text
anyharness/crates/proliferate-supervisor/src/
  update/
    mod.rs
    artifacts.rs
    download.rs
    manifest.rs
    rollback.rs
    staging.rs
    swap.rs
  process/
    idle.rs
    health.rs
```

Worker:

```text
anyharness/crates/proliferate-worker/src/updates/
  mod.rs
  desired.rs
  supervisor.rs
  status.rs

anyharness/crates/proliferate-worker/src/cloud_client/updates.rs
anyharness/crates/proliferate-worker/src/store/updates.rs
```

Server:

```text
server/proliferate/server/cloud/targets/domain/rules.py
server/proliferate/server/cloud/worker/api.py
server/proliferate/server/cloud/worker/models.py
server/proliferate/server/cloud/worker/service.py
```

Optional if updates grow large:

```text
server/proliferate/server/cloud/updates/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py
```

Update flow:

```text
1. worker reports installed versions
2. cloud returns desired versions/update instructions
3. worker asks supervisor to stage update
4. supervisor downloads signed artifact for OS/arch
5. supervisor verifies signature/checksum
6. supervisor waits for safe point or pause
7. supervisor swaps binary atomically
8. supervisor restarts process
9. worker reports applied/failed/rolled_back status
```

### Retention And Safe Stop

Server:

```text
server/proliferate/server/cloud/compute/
  api.py
  models.py
  service.py
  domain/
    types.py
    rules.py
    policy.py

server/proliferate/server/cloud/runtime/
  scheduler.py
  setup_monitor.py
```

AnyHarness:

```text
anyharness/crates/anyharness-contract/src/v1/runtime.rs
anyharness/crates/anyharness-lib/src/api/http/runtime.rs
anyharness/crates/anyharness-lib/src/domains/runtime_inventory/
```

Worker:

```text
anyharness/crates/proliferate-worker/src/lifecycle/
  activity.rs
  safe_stop.rs
  shutdown.rs
```

Cloud should decide policy. Worker/AnyHarness report whether stopping is safe.

### Observability

Server logs/metrics:

- command queued/leased/delivered/accepted/rejected/expired
- worker heartbeat age
- event ingest lag
- snapshot update lag
- SSE subscriber count
- target online/degraded/offline
- payload truncation/blob decisions
- update status

Worker logs/metrics:

- enrollment result
- heartbeat failures
- lease loop status
- command dispatch latency
- AnyHarness request failures
- event tail lag
- outbox size/retry count
- inventory hash changes
- update stage/apply/rollback

Suggested files:

```text
server/proliferate/server/cloud/observability.py
anyharness/crates/proliferate-worker/src/observability.rs
anyharness/crates/proliferate-supervisor/src/observability.rs
```

### Security Hardening

Must support:

- worker token rotation
- worker revocation
- enrollment token expiry
- command idempotency
- command expiry
- signed update artifacts
- artifact checksum verification
- target access policy
- audit rows for commands and credential grants

### Acceptance

- Target versions are visible in Cloud.
- Worker/supervisor/AnyHarness update status is visible.
- Revoked worker cannot lease commands or upload events.
- Idle managed workspace can stop/prune after final sync.
- Active session/turn blocks unsafe stop.
- Large payloads are truncated or blobbed by policy.
- Event ingest and command latency are observable.

## Parallelization Plan

These workstreams can run mostly in parallel once Phase 0 is complete:

```text
A. Shared Cloud SDK
   Owns cloud/sdk, cloud/sdk-react, Desktop cloud access migration.

B. Compute Targets + SSH Enrollment
   Owns server targets/worker enrollment, Desktop Compute UX, installer,
   worker enrollment/heartbeat/inventory, supervisor MVP.

C. Command Path
   Owns server commands, worker command leasing/dispatch, AnyHarness command
   metadata.

D. Event Ingest + Sessions/Live
   Owns worker tail/outbox/upload, server events/sessions/live fanout.

E. Direct Runtime Migration
   Starts after C has a working command path. Owns automations/cloud runtime
   callsite migration and direct AnyHarness allowlist deletion.

F. Credential/Env Sync
   Starts after B and C. Owns target config, materialization command, SSH and
   managed cloud environment sync.

G. Hardening
   Starts after B. Owns update staging, retention, observability, revocation.
```

Do not start E before C has a tested worker command path. Otherwise the
migration will replace one unstable path with another.

## Implementation Guardrails

- Do not put all worker/cloud sync code in `server/proliferate/server/cloud/runtime`.
- Do not make Worker own business policy.
- Do not make Cloud store token-level transcript rows durably by default.
- Do not create surface-specific command semantics for Web, Slack, Mobile, API,
  and automations. They all enqueue `CloudCommand`.
- Do not let Desktop direct access bypass team policy for team/cloud sessions.
- Do not keep old and new direct runtime command paths after a phase declares
  migration complete.
- Do not introduce untyped `serde_json::Value` command payloads beyond edge
  parsing.
- Do not make Redis/NATS the durable source of truth.
- Do not make update logic depend on a single managed sandbox provider.

## Phase Completion Checklist

Before marking a phase complete:

- update or add tests named in the phase acceptance section
- update generated OpenAPI/SDK artifacts if endpoint contracts changed
- run the narrowest relevant checks
- run `rg` for disallowed imports/calls named in the phase
- remove transitional duplicate code unless explicitly allowlisted
- update this doc if implementation discovered a better file boundary

## Mechanical Phase Verification

Each phase should have a mechanical verifier. The verifier is not a replacement
for tests; it is a cheap, repeatable gate that checks repo shape, forbidden
imports, required files, generated artifacts, and the narrow smoke path for the
phase.

Add one script:

```text
scripts/check-cloud-worker-phase.mjs
```

Usage:

```bash
node scripts/check-cloud-worker-phase.mjs phase-0
node scripts/check-cloud-worker-phase.mjs phase-1
node scripts/check-cloud-worker-phase.mjs phase-2
node scripts/check-cloud-worker-phase.mjs phase-3
node scripts/check-cloud-worker-phase.mjs phase-4
node scripts/check-cloud-worker-phase.mjs phase-5
node scripts/check-cloud-worker-phase.mjs phase-6
node scripts/check-cloud-worker-phase.mjs phase-7
node scripts/check-cloud-worker-phase.mjs phase-8
```

The script should be intentionally boring:

- use Node built-ins only where possible
- shell out to `rg`, `cargo`, `pnpm`, and `uv` for focused checks
- fail fast with a clear list of missing files or forbidden references
- print the exact follow-up command when a generated artifact is stale
- support `--json` for CI summaries later

### Phase 0 Verifier

Checks:

```text
required files:
  docs/audits/cloud-worker-direct-anyharness-inventory.md

required audit sections:
  migrate-to-command
  temporary-provisioning
  test-or-diagnostic
  delete
  non-cloud consumers
  DB layout disposition

scan:
  rg "integrations.anyharness|create_runtime_session|prompt_runtime_session|runtime_url|anyharness_workspace_id|anyharness_session_id" server/proliferate -g "*.py"
  rg "integrations.anyharness|AnyHarness|anyharness" server/proliferate/server -g "*.py"
  rg --files server/proliferate/db/models/cloud server/proliferate/db/store | rg "cloud"
```

The scan may return results in Phase 0, but every result must appear in the
audit file. This can be checked mechanically by requiring each file path from
the `rg` output to be mentioned in the audit. The DB scan must also appear in
the audit with one disposition per existing cloud model/store file.

### Phase 1 Verifier

Checks:

```text
required files:
  cloud/sdk/package.json
  cloud/sdk/src/index.ts
  cloud/sdk/src/client/core.ts
  cloud/sdk/src/generated/openapi.ts
  cloud/sdk-react/package.json
  cloud/sdk-react/src/index.ts
  cloud/sdk-react/src/context/CloudClientProvider.tsx

workspace config:
  pnpm-workspace.yaml includes cloud/sdk and cloud/sdk-react
  desktop/package.json depends on @proliferate/cloud-sdk

forbidden:
  desktop product components outside desktop/src/lib/access/cloud and
  desktop/src/hooks/access/cloud do not call raw cloud client.GET/POST/PUT/PATCH/DELETE
  no duplicate generated Cloud OpenAPI truth remains in desktop after migration
```

Suggested raw-client scan:

```bash
rg "client\\.(GET|POST|PUT|PATCH|DELETE)\\(" desktop/src/components desktop/src/lib/domain desktop/src/hooks -g "*.ts" -g "*.tsx" -g "!desktop/src/hooks/access/cloud/**"
```

Focused commands:

```bash
pnpm --filter @proliferate/cloud-sdk build
pnpm --filter @proliferate/cloud-sdk-react build
pnpm --filter proliferate build
```

### Phase 2 Verifier

Checks:

```text
required server files:
  server/proliferate/server/cloud/targets/api.py
  server/proliferate/server/cloud/targets/service.py
  server/proliferate/server/cloud/worker/api.py
  server/proliferate/server/cloud/worker/service.py
  server/proliferate/db/models/cloud/targets.py
  server/proliferate/db/store/cloud_sync/targets.py
  server/proliferate/db/store/cloud_sync/worker_auth.py

required Rust crates:
  anyharness/crates/proliferate-worker/Cargo.toml
  anyharness/crates/proliferate-supervisor/Cargo.toml

required installer files:
  install/proliferate-target-install.sh
  install/README.md

required desktop files:
  desktop/src/components/settings/panes/ComputePane.tsx
  desktop/src/components/settings/panes/compute/AddSshTargetDialog.tsx
  desktop/src/hooks/access/cloud/targets/use-cloud-targets.ts
```

Smoke path:

```text
1. create enrollment token through server test client
2. worker enrolls with token against local server
3. worker heartbeat updates target status
4. inventory appears in target snapshot
```

Focused commands:

```bash
cargo check -p proliferate-worker
cargo check -p proliferate-supervisor
cd server && uv run pytest -q tests/cloud/test_targets.py tests/cloud/test_worker_enrollment.py
cd desktop && pnpm test -- Compute
```

### Phase 3 Verifier

Checks:

```text
required files:
  server/proliferate/server/cloud/commands/api.py
  server/proliferate/server/cloud/commands/service.py
  server/proliferate/db/models/cloud/commands.py
  server/proliferate/db/models/cloud/sessions.py
  server/proliferate/db/store/cloud_sync/commands.py
  server/proliferate/db/store/cloud_sync/sessions.py
  anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
  anyharness/crates/proliferate-worker/src/commands/mapping.rs
  anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
  anyharness/crates/anyharness-contract/src/v1/commands.rs

forbidden:
  command dispatch does not pass arbitrary serde_json::Value past edge parsing
  server command service does not call integrations.anyharness
```

Shape checks:

```bash
rg "serde_json::Value" anyharness/crates/proliferate-worker/src/commands -g '!mod.rs'
```

Expected result: no untyped command payloads outside edge parsing/mapping
files.

Smoke path:

```text
1. enqueue start_session command
2. worker leases command
3. worker dispatches local AnyHarness create-session request
4. worker reports delivered/result
5. Cloud creates or updates minimal CloudSession identity row
6. enqueue send_prompt against the CloudSession row
7. worker dispatches local AnyHarness prompt request
8. duplicate idempotency key returns same command
```

Focused commands:

```bash
cargo test -p proliferate-worker commands
cd server && uv run pytest -q tests/cloud/test_commands.py tests/cloud/test_worker_leases.py tests/cloud/test_command_sessions.py
```

### Phase 4 Verifier

Checks:

```text
scan:
  rg "create_runtime_session|prompt_runtime_session|apply_runtime_reasoning_effort|close_runtime_session" server/proliferate/server/automations server/proliferate/server/cloud -g "*.py"
```

Expected result:

- no hits in production automation execution paths
- remaining hits only in an explicit allowlist file:

```text
docs/audits/cloud-worker-direct-anyharness-allowlist.md
```

Smoke path:

```text
1. automation run chooses target/workspace
2. automation enqueues start_session/update_config/send_prompt commands
3. worker delivers commands
4. automation run advances from Cloud command status and minimal CloudSession state
```

Focused commands:

```bash
cd server && uv run pytest -q tests/automations/test_cloud_executor_worker_commands.py
```

### Phase 5 Verifier

Checks:

```text
required files:
  server/proliferate/server/cloud/events/service.py
  server/proliferate/server/cloud/events/domain/rules.py
  server/proliferate/server/cloud/sessions/service.py
  server/proliferate/server/cloud/sessions/domain/rules.py
  server/proliferate/db/models/cloud/events.py
  server/proliferate/db/models/cloud/sessions.py
  server/proliferate/db/store/cloud_sync/tool_calls.py
  anyharness/crates/proliferate-worker/src/sync/tailer.rs
  anyharness/crates/proliferate-worker/src/sync/outbox.rs
  anyharness/crates/proliferate-worker/src/sync/mapper.rs
```

Forbidden durable storage:

```text
per-token deltas
raw item_delta rows
raw terminal byte streams
raw browser/computer-use frames
large tool bodies inline by default
```

Smoke path:

```text
1. feed synthetic AnyHarness event batch to ingest
2. duplicate upload is accepted idempotently
3. cursor advances only over contiguous seq
4. completed message creates CloudMessage
5. interaction requested creates CloudRequest
6. config update creates CloudSessionConfigState
7. tool call started/completed creates or updates CloudToolCallSummary
```

Focused commands:

```bash
cargo test -p proliferate-worker sync
cd server && uv run pytest -q tests/cloud/test_event_ingest.py tests/cloud/test_session_rows.py
```

### Phase 6 Verifier

Checks:

```text
required files:
  server/proliferate/server/cloud/live/api.py
  server/proliferate/server/cloud/live/service.py
  server/proliferate/server/cloud/live/domain/rules.py
  server/proliferate/integrations/pubsub/redis.py
  cloud/sdk/src/client/live.ts
  cloud/sdk/src/streams/sse.ts
  cloud/sdk-react/src/hooks/live.ts
```

Smoke path:

```text
1. client opens session stream
2. server sends snapshot
3. event ingest updates durable rows
4. live service publishes patch
5. stream receives patch
6. reconnect with cursor replays missed durable patches
```

Focused commands:

```bash
cd server && uv run pytest -q tests/cloud/test_live_streams.py
pnpm --filter @proliferate/cloud-sdk test
```

### Phase 7 Verifier

Checks:

```text
required files:
  server/proliferate/server/cloud/target_config/api.py
  server/proliferate/server/cloud/target_config/service.py
  server/proliferate/server/cloud/target_config/domain/rules.py
  anyharness/crates/proliferate-worker/src/materialization/env.rs
  anyharness/crates/proliferate-worker/src/materialization/files.rs
  anyharness/crates/proliferate-worker/src/materialization/git.rs
  anyharness/crates/proliferate-worker/src/materialization/mcp.rs
```

Smoke path:

```text
1. create target config for SSH target
2. enqueue materialize_environment command
3. worker writes env/tracked files to target location
4. git credential grant is present for repo operation
5. MCP readiness/materialization status is visible
```

Focused commands:

```bash
cargo test -p proliferate-worker materialization
cd server && uv run pytest -q tests/cloud/test_target_config.py
```

### Phase 8 Verifier

Checks:

```text
required files:
  anyharness/crates/proliferate-supervisor/src/update/manifest.rs
  anyharness/crates/proliferate-supervisor/src/update/staging.rs
  anyharness/crates/proliferate-supervisor/src/update/rollback.rs
  anyharness/crates/proliferate-worker/src/updates/desired.rs
  anyharness/crates/proliferate-worker/src/cloud_client/updates.rs
  server/proliferate/server/cloud/compute/service.py
  server/proliferate/server/cloud/compute/domain/rules.py
```

Smoke path:

```text
1. worker reports installed versions
2. cloud returns desired version
3. worker asks supervisor to stage update
4. supervisor verifies artifact metadata/checksum in test mode
5. active session blocks unsafe update/stop
6. idle target allows update/stop
7. revoked worker cannot lease/upload
```

Focused commands:

```bash
cargo test -p proliferate-supervisor update
cargo test -p proliferate-worker updates
cd server && uv run pytest -q tests/cloud/test_updates.py tests/cloud/test_compute_safe_stop.py
```

## CI Shape

Each implementation PR should run only the phase gates it claims to complete.
The eventual CI jobs can be:

```text
cloud-worker-phase-0
cloud-worker-phase-1
cloud-worker-phase-2
cloud-worker-phase-3
cloud-worker-phase-4
cloud-worker-phase-5
cloud-worker-phase-6
cloud-worker-phase-7
cloud-worker-phase-8
```

Early PRs can run the verifier manually. Once a phase is complete, add its
verifier to CI so regressions fail mechanically.
