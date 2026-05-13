# Worker And Cloud Sync V1 Implementation Spec

Status: implementation alignment spec for Proliferate Worker, Cloud-mediated
targets, BYO SSH, managed cloud, basic web validation, SDK extraction, and
storage/retention boundaries.

This spec captures the architecture we want to implement. It intentionally
describes the target structure even where the current code or PR is only
partially aligned.

Related docs:

- `docs/architecture/worker-cloud-sync-decisions.md`
- `docs/architecture/cloud-worker-control-plane.md`
- `docs/architecture/plugins-and-skills.md`
- `docs/architecture/model-catalog-and-dynamic-registries.md`
- `docs/anyharness/src/workspaces.md`
- `docs/server/README.md`
- `docs/frontend/guides/access.md`
- `docs/sdk/README.md`

## V1 Product Outcome

V1 should get us to this product state:

1. Desktop has clean SSH connection and install logic.
2. Users can register a machine as a Cloud-addressable target.
3. Managed cloud sandboxes register as targets the same way.
4. New workspaces, sessions, and automations can choose a target:
   - local/direct
   - desktop dispatch
   - SSH
   - managed cloud
   - later self-hosted cloud
5. Cloud no longer uses direct AnyHarness runtime URLs for generic session
   control.
6. Cloud writes durable commands for targets.
7. Worker polls/leases commands, calls local AnyHarness, and reports results.
8. Worker uploads normalized event batches.
9. Cloud ingests events, materializes projections/messages/interactions/config,
   and fans out patches.
10. A basic web client can list cloud-visible workspaces/sessions, display
    messages, send prompts, resolve interactions, and verify the sync model.

V1 does not need full cloud file editing, terminal remoting, browser streaming,
mobile polish, Slack polish, or the final developer API.

## UX Scope

### Desktop SSH Target Setup

Desktop should expose a clear flow:

```text
Connect SSH machine
  -> choose personal/team/org scope
  -> name target
  -> Cloud creates enrollment token
  -> Desktop shows install command
  -> user runs command over SSH
  -> worker enrolls
  -> target appears online with inventory/readiness
```

The install command should contain:

- Cloud base URL
- enrollment token
- target kind `ssh`
- optional install channel
- optional desired AnyHarness/worker version

The UI should show:

- enrollment pending/expired/used
- target online/offline
- AnyHarness reachable
- git/node/npm/python/uv readiness
- workspace roots
- whether target is personal/team/org accessible
- warning when teammates cannot directly SSH into the machine

### Managed Cloud Target Setup

For managed cloud, users should not run a command manually.

Cloud provisions or boots a sandbox/image that already has:

- supervisor
- AnyHarness
- Proliferate Worker
- baseline git
- node/npm/npx
- optional python/uv

Bootstrap injects enrollment data. Worker enrolls on boot.

Early V1 can treat a managed cloud sandbox as a reusable target. Creating a
workspace means creating a new worktree/session inside that target. Later, a
policy can provision a new managed target per workspace or automation run.

### Target Selection

Target selection should appear anywhere work is launched:

- new workspace
- new session
- automation definition
- Slack/thread continuation later
- developer API later

The picker should distinguish:

- local/direct: rich desktop-only runtime
- desktop dispatch: local machine listens to Cloud while online
- SSH: existing user/team machine
- managed cloud: Proliferate-provisioned compute
- self-hosted cloud: future org-managed control plane/compute

The picker should show readiness:

- online/offline
- supports git
- supports required agent/provider
- supports required MCP/plugin bundle
- safe to launch
- credential grant availability

### Basic Web Validation Client

The initial web client only needs enough UI to validate the model:

- target list
- workspace list
- session list
- transcript/message view
- pending interactions
- current config/model state
- command status
- prompt box
- resolve interaction controls
- stop/prune buttons for testing lifecycle commands

It should consume Cloud APIs and Cloud live stream. It should not talk directly
to AnyHarness.

## Core Invariants

```text
AnyHarness is execution truth.
Cloud is control plane and projection store.
Worker is bridge.
Clients do not invent durable runtime truth.
Every mutation is a command.
Every runtime fact Cloud trusts comes from AnyHarness/Worker events or target inventory.
```

Cloud may create managed infrastructure, but after target registration generic
control goes through Worker.

## Server Folder Structure

The Cloud control plane should be organized by product responsibility:

```text
server/proliferate/server/cloud/
  targets/
    api.py
    models.py
    service.py

  worker/
    api.py
    models.py
    service.py

  commands/
    api.py
    models.py
    service.py

  events/
    api.py
    models.py
    service.py
    domain/
      payload_policy.py        # promote when retention logic grows

  projections/
    api.py
    models.py
    service.py
    domain/
      transcript.py            # promote when message projection grows
      config.py                # promote when config projection grows
      interactions.py          # promote when interaction projection grows

  live/
    api.py
    service.py
    domain/
      coalescing.py            # promote when live patch batching grows

  compute/
    api.py
    models.py
    service.py
    domain/
      retention.py             # promote when lifecycle policy grows

  workspaces/
    api.py
    models.py
    service.py
```

Existing `cloud/runtime/` remains for managed sandbox provider bootstrap and
runtime provisioning. It should not own generic command delivery, event ingest,
or Cloud-mediated session control.

Existing `cloud/workspaces/` remains the user-facing Cloud workspace product
domain. It should call `targets`, `commands`, `events`, `projections`, and
`compute` instead of reaching directly into target runtimes for generic
operations.

## Server Persistence Structure

Cloud sync persistence should live under:

```text
server/proliferate/db/models/cloud/
  targets.py
  commands.py
  events.py
  projections.py
  artifacts.py
  workspaces.py
  sandboxes.py
  runtime_environments.py

server/proliferate/db/store/cloud_sync/
  targets.py
  commands.py
  events.py
  projections.py
  artifacts.py
  target_records.py
```

Expected model groups:

- `CloudTarget`: registered compute target.
- `CloudWorker`: installed worker daemon for a target.
- `CloudTargetEnrollment`: short-lived enrollment token.
- `CloudTargetStatus`: heartbeat/activity/safe-stop state.
- `CloudTargetInventory`: OS/tools/capability/readiness snapshot.
- `CloudCommand`: durable mutation intent.
- `CloudCommandLease`: worker lease history.
- `CloudSessionEvent`: bounded semantic event log.
- `CloudEventIngestCursor`: target/session ack state.
- `CloudProjectionSnapshot`: V1 generic projection storage.
- `CloudArtifactRef`: retained blob/artifact metadata.
- `CloudWorkspace`: product-visible workspace.
- `CloudSandbox`: provider sandbox record.

When projections mature, generic `CloudProjectionSnapshot` can be promoted into
explicit tables such as `CloudSession`, `CloudMessage`,
`CloudPendingInteraction`, and `CloudSessionConfig`.

## Target Enrollment

### Enrollment Creation

Endpoint:

```text
POST /v1/cloud/targets/enrollments
```

Request:

```text
targetKind: managed_cloud | self_hosted_cloud | ssh | desktop_dispatch
displayName
accessScope: personal | team | org
ttlMinutes
```

Cloud creates an enrollment token with:

- token hash
- org/user scope
- target kind
- display name
- access scope
- expiration
- optional existing target id

### Worker Enrollment

Endpoint:

```text
POST /v1/cloud/worker/enroll
```

Worker sends:

- enrollment token
- install id
- worker version
- supervisor version
- AnyHarness version
- endpoint kind for local AnyHarness
- initial inventory when available

Cloud:

- consumes token once
- creates `CloudTarget` if needed
- creates `CloudWorker`
- stores worker credential hash
- creates initial `CloudTargetStatus`
- returns worker id, target id, and worker credential

## Worker Local Structure

Rust crate:

```text
anyharness/crates/proliferate-worker/src/
  main.rs
  config/
    file.rs
    env.rs
  identity/
    enroll.rs
    credentials.rs
    fingerprint.rs
  cloud_client/
    auth.rs
    commands.rs
    events.rs
    heartbeat.rs
    inventory.rs
    updates.rs
  anyharness_client/
    client.rs
    commands.rs
    events.rs
    inventory.rs
    activity.rs
  commands/
    dispatcher.rs
    mapping.rs
    result.rs
  sync/
    cursor.rs
    tail.rs
    event_batch.rs
    mapper.rs
  inventory/
    collect.rs
    tools.rs
    providers.rs
    mcp.rs
  updates/
    desired.rs
    supervisor.rs
    staging.rs
  store/
    sqlite.rs
    identity.rs
    command_leases.rs
    sync_cursors.rs
    inventory_cache.rs
    update_state.rs
  runtime/
    tasks.rs
    shutdown.rs
```

Worker local SQLite tables:

```text
identity:
  target_id, worker_id, install_id, cloud_base_url, credential metadata

command_leases:
  command_id, lease_id, status, leased_at, lease_expires_at, last_error

sync_cursors:
  local_workspace_id, cloud_workspace_id
  local_session_id, cloud_session_id
  last_cloud_ack_seq

inventory_cache:
  last_report_hash, last_reported_at

update_state:
  component, installed_version, desired_version, staged_path, status
```

Avoid durable transcript/event outbox for V1 unless cursor-first sync proves
insufficient. AnyHarness already persists local events.

## Worker Task Loops

Run these independent loops:

```text
heartbeat_loop:
  report online/activity/safe-stop/version state every 15-60s

inventory_loop:
  report slower tool/readiness snapshots every 5-30m or when changed

command_loop:
  long-poll/lease Cloud commands
  dispatch to AnyHarness or supervisor/platform
  report delivery/result

sync_tail_loop:
  read AnyHarness events after last_cloud_ack_seq
  micro-batch
  upload
  advance cursor on Cloud ack

update_loop:
  read desired versions from heartbeat/Cloud
  ask supervisor to stage/apply when safe
```

Loops should not block each other. A stuck event upload must not block command
polling, and a slow command must not block heartbeat.

## Command Delivery

Worker polls:

```text
POST /v1/cloud/worker/commands/lease
```

Cloud returns zero or more commands for the worker target.

Command kinds for V1:

- `start_session`
- `send_prompt`
- `resolve_interaction`
- `update_session_config`
- `cancel_session`
- `cancel_turn`
- `stop_workspace`
- `prune_workspace`

Command dispatch:

```text
CloudCommand
  -> commands/dispatcher.rs
  -> commands/mapping.rs
  -> anyharness_client method or supervisor/platform method
  -> report result to Cloud
```

Use typed command payload structs. Generic JSON is acceptable only at the
Cloud storage boundary, not in internal worker dispatch logic.

## AnyHarness Contract Requirements

AnyHarness should expose enough typed API surface for Worker:

```text
POST /v1/sessions
POST /v1/sessions/{session_id}/prompt
POST /v1/sessions/{session_id}/interactions/{interaction_id}/resolve
PATCH /v1/sessions/{session_id}/config
POST /v1/sessions/{session_id}/cancel
GET  /v1/sessions/{session_id}/stream?after_seq=N

GET  /v1/runtime/inventory
GET  /v1/runtime/activity
POST /v1/runtime/prepare-stop

POST /v1/workspaces/{workspace_id}/retire
DELETE /v1/workspaces/{workspace_id}
POST /v1/worktrees/retention/run
```

The exact endpoint names can follow existing AnyHarness contract conventions,
but the payloads should be generated/shared from `anyharness-contract` where
possible.

## Event Sync

Worker reads AnyHarness events:

```text
GET /v1/sessions/{session_id}/stream?after_seq=<last_cloud_ack_seq>
```

Micro-batch policy:

```text
flush when:
  20-100 events
  OR 50-150ms elapsed
  OR boundary event occurs
  OR 512KB batch size
```

Boundary events:

- user message accepted/completed
- assistant message completed
- interaction pending
- interaction resolved
- tool call started
- tool call completed
- config updated
- turn completed
- session failed/ended
- workspace stopped/pruned

Cloud ingest dedupes:

```text
unique(target_id, session_id, anyharness_sequence)
```

Duplicate same hash: ignore.

Duplicate different hash: conflict.

Cloud returns last contiguous ack sequence. Worker advances local cursor only
after ack.

## Cloud Event Processing

Server flow:

```text
POST /v1/cloud/worker/events/batches
  -> authenticate worker
  -> validate target
  -> normalize/validate event envelope
  -> apply payload policy
  -> append CloudSessionEvent when durable
  -> update projection rows/snapshots
  -> publish live patch to Redis/NATS
  -> return ack cursor
```

Payload policy:

```text
live-only:
  assistant deltas, tool deltas, terminal bytes, browser frames

durable semantic:
  message completed, tool summary, interaction pending/resolved,
  config updated, turn/session/workspace lifecycle

blob-ref:
  explicitly retained artifacts, large output, screenshots, files
```

Default caps:

```text
inline soft cap: 64 KB
inline hard cap: 256 KB
session soft cap: 5,000 durable events or 15 MB payload
session hard cap: 10,000 durable events or 25 MB payload
```

When caps are exceeded:

- truncate with metadata
- store only summaries
- blob-ref only when retention is required
- compact older turns into transcript summaries

## Projections

V1 projections should support these read shapes:

```text
WorkspaceSnapshot:
  workspace id, target id, repo, branch, status, last activity,
  active sessions, retention/materialization status

SessionSnapshot:
  session id, workspace id, target id, agent/model/config,
  status, current turn, pending interaction count, last event seq

TranscriptSnapshot:
  ordered CloudMessage rows or snapshot items, tool summaries,
  latest cursor

TargetSnapshot:
  target status, inventory, safe-stop state, versions, readiness

PendingInteractionsSnapshot:
  pending approvals/forms/user-input requests for a session
```

Clients should load snapshots and then subscribe to live patches. Clients
should not rebuild transcript state from raw event rows.

## Live Fanout

V1 infrastructure:

```text
Postgres:
  durable commands/events/projections

Redis/NATS:
  ephemeral pubsub for patches

SSE:
  web/mobile/desktop cloud views
```

When Cloud ingest stores events and updates projections, it publishes patches
to channels such as:

```text
org:{org_id}
target:{target_id}
workspace:{workspace_id}
session:{session_id}
```

If no SSE subscribers exist, nothing special happens. The durable DB rows and
projections remain the source for later reads.

## Workspace Lifecycle And Retention

Do not reduce this system to worktree pruning.

Use layered cleanup:

```text
compute stop:
  pause/hibernate sandbox, keep filesystem and AnyHarness DB

materialization prune:
  delete worktree/checkout/files, keep Cloud-visible history

runtime data purge:
  delete AnyHarness local workspace/session DB rows and attachments

cloud data retention:
  delete/compact Cloud messages/events/projections/artifacts/audit refs
```

Lifecycle vocabulary:

```text
active
idle
stopped
materialization_pruned
archived
purged
```

Cloud owns retention policy. Worker/AnyHarness reports safe-stop and executes
target cleanup. Cloud should update cleanup state based on confirmed target
events, not just intent.

Default policy:

```text
interactive managed cloud:
  stop after short idle timeout
  prune after 24-72h inactive unless pinned
  keep slim transcript/history after prune

automation work:
  stop/destroy after final sync
  retain selected outputs/artifacts
  prune materialization quickly
  compact raw event history

SSH targets:
  respect target owner policy
  do not delete arbitrary user files
  only prune Proliferate-managed worktrees unless explicitly allowed

desktop dispatch:
  cloud can request cleanup
  local owner controls destructive actions
```

Current AnyHarness worktree retention remains useful as one policy:

```text
keep at most N materialized standard worktrees per repo
```

but it should be folded into the broader lifecycle/retention system.

## MCP, Plugins, And Skills

Session launch input should include a resolved `SessionPluginBundle`.

Cloud owns:

- plugin/package selection
- user/team visibility
- credential grant authorization
- session-scoped bundle creation
- materialization plan creation

Worker owns:

- target readiness check
- selected artifact/command materialization
- passing bundle to AnyHarness

AnyHarness owns:

- launching MCP servers
- exposing skills
- session-level use of the bundle

Materialization recipes must be typed and allowlisted:

```text
existingCommand
npmPackage
pythonUvPackage
managedBinary
skillArtifact
```

No arbitrary shell install scripts in worker V1.

## Model Catalog And Session Config

Before a target/session exists, clients can render from Cloud catalog.

After a target/session exists, live truth comes from:

- target inventory/readiness
- synced target model registry projection
- AnyHarness session config/options events

Config updates are commands:

```text
client
  -> CloudCommand(update_session_config)
  -> Worker
  -> AnyHarness
  -> config.updated event
  -> Cloud projection patch
```

Store:

- current session config
- available config options
- selected model/provider/reasoning/mode
- target registry freshness

## SDK And Client Structure

We need to avoid every surface implementing its own Cloud client.

Target structure:

```text
packages/cloud-sdk or equivalent:
  generated OpenAPI types
  typed endpoint functions
  SSE/patch parser
  no React
  no Tauri
  no desktop auth storage

desktop adapter:
  base URL
  auth/session loading
  token refresh
  desktop-specific failure behavior

web/mobile adapter:
  browser/mobile auth
  base URL
  fetch implementation

cloud-sdk-react:
  optional React Query hooks
  snapshot loading
  SSE subscription wiring
```

Shared AnyHarness command payload types should come from the contract layer
when they are truly shared:

- prompt input blocks
- prompt request
- resolve interaction request
- config update request
- interaction decision

Cloud wraps those payloads in Cloud command envelopes.

Do not expose the full AnyHarness API as a Cloud proxy.

## Basic Web Client Implementation

The basic web client should prove the Cloud model.

Required screens:

- Targets
- Workspaces
- Sessions
- Transcript
- Pending interactions
- Config/model panel
- Command status/debug panel

Required actions:

- send prompt
- resolve interaction
- update config
- cancel
- stop/prune test commands

It should use:

- Cloud SDK for REST
- SSE for live patches
- Cloud projections for display

It should not use:

- direct AnyHarness endpoints
- target credentials
- local desktop assumptions

## Migration From Current Cloud Runtime

Current older cloud code stores runtime URLs/tokens and lets server-side Cloud
code call AnyHarness directly for workspace operations.

Migration direction:

1. Keep provider-specific sandbox provisioning under `cloud/runtime`.
2. Register each managed sandbox as a `CloudTarget`.
3. Move generic session/workspace mutations to Cloud commands.
4. Move event reads to Worker uploads and Cloud projections.
5. Keep direct runtime calls only for bootstrap/reconnect compatibility until
   worker path is complete.
6. Delete compatibility paths once managed cloud targets are fully worker-backed.

End state:

```text
cloud/runtime:
  provision and bootstrap managed compute

cloud/targets:
  registered compute identity/readiness

cloud/commands:
  all Cloud-mediated mutations

cloud/worker:
  target bridge API

cloud/events/projections/live:
  read and fanout model
```

## Implementation Sequence

1. Make worker/server command payloads strongly typed.
2. Replace worker durable event outbox with cursor-first event sync, or mark
   outbox as explicitly optional/future.
3. Implement Cloud event payload policy and semantic durable categories.
4. Implement projection application for workspace/session/transcript/config and
   pending interactions.
5. Add Redis/NATS-backed live fanout.
6. Add target enrollment/install UX for SSH.
7. Convert managed cloud bootstrap to worker enrollment.
8. Add target picker for workspace/session/automation launch.
9. Add basic web client for validating projections and commands.
10. Extract reusable Cloud SDK core from desktop Cloud access code.
11. Fold worktree pruning into workspace lifecycle/retention spec.

## Hard Non-Goals For This Pass

- full terminal remoting through Cloud
- file editing through Cloud
- browser/computer-use frame streaming
- mobile native UX polish
- Slack production integration polish
- developer API polish
- full restore of destroyed sandboxes from Cloud history
- Durable Objects as a required dependency
- arbitrary worker shell install scripts
- Cloud as a full AnyHarness SQLite replica

## Open Questions To Resolve Later

- Exact CloudSession/CloudMessage table shape versus generic projection JSON.
- Exact retention defaults by plan/org type.
- Whether automation workspaces should default to per-run managed targets or
  reused target worktrees.
- Whether self-hosted Proliferate Cloud ships as full control plane or target
  worker pool first.
- How much Cloud-side file/git read support V1 web needs after basic validation.
- Exact direct attach grant model for team-controlled direct desktop access.

