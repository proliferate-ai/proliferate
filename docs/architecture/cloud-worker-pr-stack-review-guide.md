# Cloud Worker PR Stack Review Guide

Status: synthesized reviewer guide for the Cloud worker/control-plane PR stack.
Current implementation notes were verified against `main` on 2026-05-15.

Purpose: give reviewers a single map for understanding the PRs that implement
the Cloud-mediated worker model. This document is intentionally not the source
of truth for the architecture itself. The architecture source of truth remains
`docs/architecture/cloud-worker-control-plane.md`.

Use this guide when reviewing:

- broad worker/control-plane baseline PR #207
- implementation stack PRs #212, #214, #216, #217, #218, #219, #221, #222,
  and #223

Current `main` has since folded in additional follow-up work beyond the PR list
above:

- supervised target runtime bundle for SSH and managed cloud
- active worker commands for Git bootstrap, repo checkout, workspace
  materialization, environment materialization, session control, and sync
- staged automation execution through
  `server/proliferate/server/automations/worker/cloud_execution/`
- target Git identity materialization without raw tokens in command payloads
- SSH automation smoke coverage through command dispatch

Current active worker command kinds:

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

Current storage differs from the early broad baseline:

- command lease fields live inline on `cloud_commands`
- there is no separate `cloud_command_leases` table
- worker event sync does not yet have a durable local event outbox table
- the user-facing product rows are sessions/messages/requests/config/targets,
  with projection as an implementation term rather than a standalone product
  object

## Core Mental Model

The product architecture is:

```text
Commands flow down:
  Cloud client / automation / Slack / API
    -> Cloud command API
    -> durable CloudCommand
    -> Proliferate Worker
    -> local AnyHarness API

Events flow up:
  AnyHarness normalized events
    -> Proliferate Worker
    -> Cloud ingest
    -> durable semantic rows + projections
    -> live fanout
    -> web / mobile / Slack / API / desktop cloud views
```

The ownership split must stay sharp:

```text
AnyHarness:
  execution truth, local SQLite, command acceptance/order, session loop,
  provider/MCP launch, local files/git/terminal/runtime capabilities.

Proliferate Worker:
  target-side bridge, enrollment, heartbeat, inventory, command delivery,
  event upload, cursor/outbox behavior, config materialization, update
  participation.

Cloud:
  auth, team/org policy, target registry, durable commands, event ingest,
  projections, live fanout, credentials/config grants, audit, billing,
  compute/update policy.

Clients:
  read Cloud snapshots/patches or direct AnyHarness state. They do not create
  durable runtime truth.
```

## Recommended Review Order

Review the implementation stack in this order:

1. #212 shared Cloud SDK foundation
2. #214 compute targets and worker enrollment
3. #216 command delivery through workers
4. #217 worker session event sync
5. #218 live session projection fanout
6. #219 existing workspace backfill
7. #221 live snapshot streams
8. #222 target config materialization
9. #223 worker update supervision

Review #207 as a broad baseline/reference PR. It is useful for understanding
the original system shape, but the sliced stack above contains the more specific
implementation path.

## Stack Map

| PR | Role | What It Enables |
| --- | --- | --- |
| #207 | Broad baseline | First worker/control-plane spine from main |
| #212 | SDK foundation | Shared typed Cloud API surface for Desktop/Web/Mobile |
| #214 | Targets/enrollment | Machines become registered Cloud targets through workers |
| #216 | Commands | Cloud routes runtime mutations through worker commands |
| #217 | Events/projections | Worker uploads AnyHarness session events into Cloud |
| #218 | Live fanout | Session projection patches fan out to live subscribers |
| #219 | Backfill | Existing target workspaces/sessions become Cloud-visible |
| #221 | Snapshot streams | Snapshot-first session/workspace/target streams |
| #222 | Target config | Env/git/MCP/skills/credentials materialize on targets |
| #223 | Updates | Desired versions, safe-stop checks, worker revocation |

## Cross-Stack Invariants

These checks apply to every PR in the stack:

- Worker tokens are target-scoped and do not authorize cross-target access.
- User-facing Cloud APIs enforce org/user/team ownership before returning
  target, workspace, session, event, command, config, or update state.
- Every runtime mutation is represented as a command and eventually accepted or
  rejected by AnyHarness.
- Worker command handling is idempotent or retry-safe at every network boundary.
- Cloud dedupes worker uploads by stable IDs, not by trusting retries to be
  rare.
- Cloud stores bounded semantic session history and projections, not raw
  token-level or ACP-internal runtime truth.
- Live fanout is derived from durable/projection writes and is safe to miss or
  replay from snapshots.
- Config and credential materialization does not leak secret payloads through
  user-facing responses, logs, SDK types, or live patches.
- Updates are generation-fenced so stale workers cannot report success for a
  newer desired version.

## PR #207: Worker Sync Control Plane

Link: https://github.com/proliferate-ai/proliferate/pull/207

### Purpose

Establishes the broad V1 Cloud worker/control-plane spine from `main`:

- target enrollment
- worker auth, heartbeat, and inventory
- command leasing
- event upload
- projection storage
- minimal live replay
- AnyHarness runtime inventory/activity/safe-stop APIs

Treat this as the broad baseline/reference PR rather than the final sliced
implementation.

### User-Visible Behavior

Cloud clients can:

- create and list targets
- enqueue and read commands
- read synced session events/projections
- open a basic session SSE replay

Target workers can enroll and start reporting target state.

### Architecture Flow

```text
Cloud:
  stores target, worker, command, event, projection, and artifact state

Worker:
  enrolls, heartbeats, leases commands, uploads events

AnyHarness:
  exposes runtime inventory/activity/safe-stop state
```

### Important Files

- `docs/architecture/cloud-worker-control-plane.md`
- `anyharness/crates/proliferate-worker/src/**`
- `anyharness/crates/anyharness-contract/src/v1/runtime.rs`
- `anyharness/crates/anyharness-lib/src/api/http/runtime.rs`
- `server/proliferate/db/models/cloud/{targets,commands,events,projections,artifacts}.py`
- `server/proliferate/db/store/cloud_sync/**`
- `server/proliferate/server/cloud/{targets,worker,commands,events,projections,live,compute}/**`

### Contracts And Tables

AnyHarness APIs:

- `GET /v1/runtime/inventory`
- `GET /v1/runtime/activity`
- `POST /v1/runtime/prepare-stop`

Worker APIs:

- `POST /v1/cloud/worker/enroll`
- `POST /v1/cloud/worker/heartbeat`
- `POST /v1/cloud/worker/inventory`
- `POST /v1/cloud/worker/commands/lease`
- `POST /v1/cloud/worker/commands/{id}/delivery`
- `POST /v1/cloud/worker/commands/{id}/result`
- `POST /v1/cloud/worker/events/batches`
- `POST /v1/cloud/worker/update-status`

Core tables:

- `cloud_targets`
- `cloud_workers`
- `cloud_commands`
- `cloud_session_events`
- `cloud_event_ingest_state`
- `cloud_synced_workspaces`
- `cloud_sessions`
- `cloud_transcript_items`
- `cloud_pending_interactions`

### Review Checklist

- Target and worker auth scopes every API path.
- Command leases recover after worker death.
- Duplicate event uploads are harmless.
- Cursor gaps do not corrupt projection state.
- Migration constraints/indexes match query shape.
- Worker token storage is private and not logged.
- Contract types do not leak AnyHarness runtime internals.

### Relationship And Risk

#207 is broad. Later PRs implement narrower hardened pieces of the same
architecture. It intentionally leaves live fanout, rich projections, backfill,
update trust, and full compute lifecycle incomplete.

## PR #212: Shared Cloud SDK Foundation

Link: https://github.com/proliferate-ai/proliferate/pull/212

### Purpose

Adds shared Cloud client packages:

- `@proliferate/cloud-sdk`
- `@proliferate/cloud-sdk-react`

It moves generated Cloud OpenAPI types out of Desktop and keeps Desktop-specific
auth, base URL, session refresh, and metrics in Desktop.

### User-Visible Behavior

This should be behavior-preserving for existing Desktop Cloud flows. The point
is to make Desktop, Web, Mobile, and future API surfaces consume the same typed
Cloud client primitives.

### Architecture Flow

```text
OpenAPI schema
  -> cloud/sdk generated types
  -> ProliferateCloudClient
  -> cloud-sdk-react hooks/query keys
  -> Desktop/Web/Mobile configure auth and storage separately
```

Desktop should configure the shared client, not fork endpoint logic.

### Important Files

- `cloud/sdk/src/client/core.ts`
- `cloud/sdk/src/client/{commands,targets,sessions,live,workspaces}.ts`
- `cloud/sdk/src/types/{commands,targets,sessions,live}.ts`
- `cloud/sdk/src/streams/sse.ts`
- `cloud/sdk-react/src/context/CloudClientProvider.tsx`
- `cloud/sdk-react/src/lib/query-keys.ts`
- `desktop/src/lib/access/cloud/client.ts`
- `Makefile`
- `pnpm-workspace.yaml`

### Key Contracts

- `ProliferateCloudClient`
- `ProliferateClientError`
- SDK global client config helpers
- typed command/target/session snapshot/live-patch types
- SSE helper primitives

The SDK adds client surfaces for phase-forward endpoints such as:

- `/v1/cloud/commands`
- `/v1/cloud/targets`
- `/v1/cloud/workspaces/{id}/snapshot`
- `/v1/cloud/sessions/{id}/snapshot`
- `/v1/cloud/sessions/{id}/transcript`
- live stream endpoints

### Review Checklist

- SDK package has no Desktop or Tauri imports.
- Generated OpenAPI output is not hand-edited.
- Desktop auth refresh remains Desktop-owned.
- SSE helper handles auth, abort, and reconnect call sites cleanly.
- React Query keys are stable and compatible with existing Desktop invalidation.
- Package-global client config is reset or overridden safely in tests.

### Relationship And Risk

This is the foundation for every later Cloud client change. The biggest risk is
that the SDK defines phase-forward contracts before the server routes fully
exist. Treat those contracts as intentional only when they are consumed by later
stack PRs.

## PR #214: Compute Targets And Worker Enrollment

Link: https://github.com/proliferate-ai/proliferate/pull/214

### Purpose

Adds the target registry and first target-side install/enrollment loop:

- Cloud target records
- one-time enrollment tokens
- worker heartbeat and inventory persistence
- Rust `proliferate-worker`
- Rust `proliferate-supervisor`
- SSH installer
- Desktop Compute settings pane

### User-Visible Behavior

Desktop gets a Compute pane where users can:

- list targets
- inspect readiness/inventory
- create an SSH enrollment command
- archive targets

Running the installer on a remote machine turns it into a Cloud-visible target.

### Architecture Flow

```text
User creates enrollment
  -> Cloud creates cloud_targets row and hashed single-use token
  -> installer writes worker/supervisor config
  -> worker POST /v1/cloud/worker/enroll
  -> Cloud returns worker token
  -> worker stores identity in local SQLite
  -> worker sends inventory and heartbeats
  -> Cloud updates target status and inventory
```

### Important Files

- `server/proliferate/server/cloud/targets/{api,models,service}.py`
- `server/proliferate/server/cloud/worker/{api,models,service}.py`
- `server/proliferate/db/models/cloud/targets.py`
- `server/proliferate/db/store/cloud_sync/{targets,worker_auth,inventory}.py`
- `server/alembic/versions/c4d5e6f7a8b9_cloud_targets_workers.py`
- `anyharness/crates/proliferate-worker/**`
- `anyharness/crates/proliferate-supervisor/**`
- `install/proliferate-target-install.sh`
- `desktop/src/components/settings/panes/ComputePane.tsx`

### Key Endpoints And Tables

User APIs:

- `POST /v1/cloud/targets/enrollments`
- `GET /v1/cloud/targets`
- `GET /v1/cloud/targets/{target_id}`
- `POST /v1/cloud/targets/{target_id}/archive`

Worker APIs:

- `POST /v1/cloud/worker/enroll`
- `POST /v1/cloud/worker/heartbeat`
- `POST /v1/cloud/worker/inventory`

Tables:

- `cloud_targets`
- `cloud_workers`
- `cloud_target_enrollments`
- `cloud_target_inventory`
- `cloud_target_status`

### Review Checklist

- Enrollment tokens are hashed, single-use, and expire.
- Archived target tokens are rejected.
- Target list/get/archive are org/user scoped.
- Worker inventory does not expose raw secrets.
- Worker config and DB files are created with private permissions.
- Installer handles artifact URLs, install paths, and systemd launch safely.
- Desktop invalidates target queries after enrollment/archive.

### Relationship And Risk

This PR makes targets real. Later PRs depend on its target IDs, worker tokens,
heartbeat path, and inventory shape. Watch the lost-response enrollment case:
if a worker consumes a one-time token but crashes before persisting its returned
identity, retry behavior must be understood.

## PR #216: Cloud Command Delivery Through Workers

Link: https://github.com/proliferate-ai/proliferate/pull/216

### Purpose

Routes Cloud runtime mutations through durable worker commands instead of direct
server-to-AnyHarness calls.

It is the first major step toward:

```text
Cloud -> Worker -> AnyHarness
```

for automation and cloud-mediated session control.

### User-Visible Behavior

Automations still create workspaces, start sessions, apply config, send prompts,
and cancel/close sessions. The difference is that the work is now delivered
through a worker polling/lease loop.

Command status becomes Cloud-readable.

### Architecture Flow

```text
Cloud API / automation
  -> validate target/workspace/command kind
  -> create cloud_commands row
  -> worker leases command
  -> worker reports delivered
  -> worker calls local AnyHarness API
  -> worker reports accepted/rejected/failed_delivery
  -> Cloud marks command terminal or retryable
```

Managed Cloud provisions a worker sidecar next to AnyHarness.

### Important Files

- `server/proliferate/server/cloud/commands/{api,models,service}.py`
- `server/proliferate/db/models/cloud/commands.py`
- `server/proliferate/db/store/cloud_sync/commands.py`
- `server/proliferate/server/cloud/worker/{api,models,service}.py`
- `server/proliferate/server/automations/worker/cloud_executor_{commands,session,target,workspace}.py`
- `server/proliferate/server/cloud/runtime/{target_registration,bootstrap,provision}.py`
- `anyharness/crates/proliferate-worker/src/commands/{dispatcher,mapping}.rs`
- `anyharness/crates/proliferate-worker/src/anyharness_client/sessions.rs`
- `docs/audits/cloud-worker-direct-anyharness-allowlist.md`

### Key Endpoints, Kinds, And Statuses

User APIs:

- `POST /v1/cloud/commands`
- `GET /v1/cloud/commands/{command_id}`

Worker APIs:

- `POST /v1/cloud/worker/commands/lease`
- `POST /v1/cloud/worker/commands/{command_id}/delivery`
- `POST /v1/cloud/worker/commands/{command_id}/result`

Command kinds:

- `start_session`
- `send_prompt`
- `resolve_interaction`
- `update_session_config`
- `cancel_turn`
- `close_session`

Command statuses:

- `queued`
- `leased`
- `delivered`
- `accepted`
- `accepted_but_queued`
- `rejected`
- `expired`
- `superseded`
- `failed_delivery`

### Review Checklist

- Idempotency is scoped to actor/org/target/workspace/command shape.
- Lease locking prevents two workers from delivering the same command.
- Delivered-but-not-resulted commands recover or expire predictably.
- Worker result reporting is idempotent.
- Command payload mapping is explicit and typed where possible.
- Automation waits on command status without reintroducing direct AnyHarness
  calls outside the allowlist.
- Managed Cloud bootstraps worker config alongside AnyHarness.

### Relationship And Risk

This PR makes the command path real. Later event and live-sync PRs make command
effects observable. Highest-risk review points are lease recovery, command
idempotency, and any remaining direct server-to-AnyHarness path.

## PR #217: Worker Session Event Sync

Link: https://github.com/proliferate-ai/proliferate/pull/217

### Purpose

Adds worker-uploaded AnyHarness session event sync and derives Cloud session
read models from those events.

### User-Visible Behavior

Cloud users can read:

- `GET /v1/cloud/sessions/{sessionId}/snapshot?targetId=...`
- `GET /v1/cloud/sessions/{sessionId}/stream?targetId=...&afterSeq=...`

Snapshots expose:

- session status
- transcript items
- pending interactions

Worker upload responses report accepted, duplicate, live-only events, and cursor
acknowledgements per session.

### Architecture Flow

```text
Worker command succeeds
  -> worker seeds local sync session
  -> worker polls AnyHarness session events
  -> worker uploads event batches
  -> Cloud dedupes by target/session/seq
  -> Cloud applies retention/redaction policy
  -> Cloud writes durable semantic rows
  -> Cloud advances ingest cursors
  -> Cloud updates session/transcript/interaction projections
```

### Important Files

- `server/proliferate/server/cloud/events/**`
- `server/proliferate/db/store/cloud_sync/events.py`
- `server/proliferate/db/models/cloud/sync.py`
- `server/alembic/versions/c8d9e0f1a2b3_*.py`
- `anyharness/crates/proliferate-worker/src/sync/tailer.rs`
- `anyharness/crates/proliferate-worker/src/cloud_client/events.rs`
- `anyharness/crates/proliferate-worker/src/anyharness_client/events.rs`
- `anyharness/crates/proliferate-worker/src/store/mod.rs`
- `anyharness/crates/proliferate-worker/src/commands/dispatcher.rs`

### Key Contracts And Tables

Tables:

- `cloud_session_events`
- `cloud_event_ingest_state`
- `cloud_sessions`
- `cloud_transcript_items`
- `cloud_pending_interactions`

Types/responses:

- `WorkerSessionEventEnvelope`
- `WorkerEventBatchRequest`
- `WorkerEventBatchResponse`
- `CloudSessionSnapshotResponse`
- `CloudSessionEventResponse`

### Review Checklist

- Worker event upload auth is target-scoped.
- Duplicate event with same seq and different hash is rejected or surfaced.
- Out-of-order seqs do not advance contiguous ack cursors incorrectly.
- Live-only events are acknowledged without becoming durable history.
- Raw tool bodies and oversized payloads are stripped or capped.
- Session hard caps are enforced.
- AnyHarness event pagination and limits are respected.
- Command success seeds enough target/session/workspace IDs for event sync.

### Relationship And Risk

This PR makes command effects visible in Cloud. It is intentionally more
important than live fanout: durable semantic rows and projections are what web,
mobile, Slack, and API read after reconnect.

Risk: projection logic relies on event type strings and dict payloads. Review
for places that should become stricter typed contracts.

## PR #218: Live Session Projection Fanout

Link: https://github.com/proliferate-ai/proliferate/pull/218

### Purpose

Replaces raw/polling session stream behavior with Cloud live fanout for session
projection patches.

### User-Visible Behavior

Session streams emit SSE frames:

- `snapshot`
- `patch`
- `heartbeat`

The client gets an initial full snapshot and then applies projection patches.

### Architecture Flow

```text
Cloud event ingest
  -> projection apply returns CloudSessionPatchResponse
  -> live service publishes projection_patch
  -> subscribers receive patch
```

The live layer uses a bounded subscriber queue keyed by:

```text
session:{targetId}:{sessionId}
```

### Important Files

- `server/proliferate/server/cloud/live/service.py`
- `server/proliferate/server/cloud/live/models.py`
- `server/proliferate/server/cloud/live/domain/channels.py`
- `server/proliferate/server/cloud/events/service.py`
- `server/proliferate/server/cloud/events/models.py`
- `server/proliferate/server/cloud/events/api.py`

### Key Contracts

- `CloudSessionPatchResponse`
- `CloudLivePatchEnvelope`
- `CloudStreamHeartbeatResponse`

### Review Checklist

- Clients tolerate new SSE event names and payload shape.
- Snapshot includes enough cursor information for reconnect.
- Heartbeats avoid silent dead streams.
- Subscriber queue overflow behavior is explicit.
- Patch ordering is stable when one batch produces multiple projection changes.
- Patches are scoped by target/session, not only session ID.

### Relationship And Risk

This builds on #217 projections. #221 later generalizes live streams across
sessions, workspaces, and targets with a clearer pub/sub boundary.

Risk: the live bus in this phase is process-local and cannot fan out across
multi-process or serverless deployments.

## PR #219: Existing Workspace Backfill Through Workers

Link: https://github.com/proliferate-ai/proliferate/pull/219

### Purpose

Lets workers map existing AnyHarness workspaces and sessions into Cloud read
models, not only sessions created through new Cloud commands.

### User-Visible Behavior

Existing target workspaces appear in:

- `GET /v1/cloud/workspaces`
- `GET /v1/cloud/sessions?targetId=...`

Existing sessions become readable through snapshot and stream APIs.

Users can enqueue `sync_existing_workspace`. Only workers advertising that
capability should lease it.

### Architecture Flow

```text
Cloud queues sync_existing_workspace
  -> worker leases special command
  -> worker fetches AnyHarness repo roots/workspaces/sessions
  -> worker uploads chunks to /worker/backfill
  -> Cloud creates/updates CloudWorkspace and mappings
  -> Cloud creates/updates session projections
  -> worker stores local workspace/session mappings
```

### Important Files

- `server/proliferate/server/cloud/backfill/**`
- `server/proliferate/db/store/cloud_sync/backfill.py`
- `server/proliferate/db/models/cloud/sync.py`
- `server/alembic/versions/c9d0e1f2a3b4_*.py`
- `server/proliferate/server/cloud/events/{api,service}.py`
- `server/proliferate/constants/cloud.py`
- `anyharness/crates/proliferate-worker/src/sync/backfill.rs`
- `anyharness/crates/proliferate-worker/src/anyharness_client/backfill.rs`
- `anyharness/crates/proliferate-worker/src/cloud_client/backfill.rs`
- `anyharness/crates/proliferate-worker/src/store/mod.rs`
- `anyharness/crates/proliferate-worker/src/commands/dispatcher.rs`

### Key Contracts And Tables

Endpoint:

- `POST /v1/cloud/worker/backfill`

Command kind:

- `sync_existing_workspace`

Tables/local worker tables:

- `cloud_synced_workspaces`
- worker `sync_workspaces`
- worker `pending_command_results`

AnyHarness dependencies:

- `GET /v1/repo-roots`
- `GET /v1/workspaces`
- `GET /v1/sessions?workspace_id=...`

### Review Checklist

- Workspace/session mapping is target-scoped.
- Backfill does not over-resolve active pending interactions.
- Only capable workers lease `sync_existing_workspace`.
- Pending command results survive worker restart and stale leases.
- Chunk ordering and retries are harmless.
- Backfilled workspaces with `runtime_environment_id = None` do not break
  assumptions elsewhere.

### Relationship And Risk

This closes the gap where only Cloud-created sessions were synced. It sits
between event sync and the later snapshot/live stream surface.

Risk: the worker can backfill all workspaces if no workspace ID is supplied,
while Cloud validation may require `workspaceId` for user-queued commands.
Review whether sync-all is internal-only.

## PR #221: Live Snapshot Streams

Link: https://github.com/proliferate-ai/proliferate/pull/221

### Purpose

Adds snapshot-first live stream endpoints for sessions, workspaces, and targets.
It also introduces a pub/sub integration boundary and after-commit live fanout.

### User-Visible Behavior

Clients can:

- fetch session, transcript, event, workspace, and target snapshots
- subscribe to session streams
- subscribe to workspace streams
- subscribe to target streams
- receive command status patches
- receive target status/update patches

### Architecture Flow

```text
DB mutation
  -> projection/status write
  -> register after-commit live publish
  -> commit succeeds
  -> PubSubBus publish
  -> SSE stream emits patch
```

This avoids publishing a live patch for a DB transaction that later rolls back.

### Important Files

- `server/proliferate/db/engine.py`
- `server/proliferate/integrations/pubsub/{models,redis}.py`
- `server/proliferate/server/cloud/live/{access,api,domain/rules,service,models}.py`
- `server/proliferate/server/cloud/events/api.py`
- `server/proliferate/server/cloud/events/service.py`
- `server/proliferate/server/cloud/commands/service.py`
- `server/proliferate/server/cloud/worker/service.py`
- `server/proliferate/server/cloud/targets/service.py`
- `cloud/sdk/src/client/live.ts`
- `cloud/sdk/src/client/sessions.ts`
- `cloud/sdk-react/src/hooks/{live,events,sessions}.ts`
- `cloud/sdk/src/types/live.ts`

### Key Endpoints And Events

Endpoints:

- `GET /v1/cloud/workspaces/{workspaceId}/snapshot`
- `GET /v1/cloud/sessions/{sessionId}/stream?targetId=&afterSeq=`
- `GET /v1/cloud/workspaces/{workspaceId}/stream?afterSeq=`
- `GET /v1/cloud/targets/{targetId}/stream?afterSeq=`
- `GET /v1/cloud/sessions/{sessionId}`
- `GET /v1/cloud/sessions/{sessionId}/snapshot`
- `GET /v1/cloud/sessions/{sessionId}/transcript`
- `GET /v1/cloud/sessions/{sessionId}/events`

Live event types include:

- `snapshot`
- `projection_patch`
- `workspace_projection_patch`
- `target_projection_patch`
- `command_status`
- `heartbeat`

### Review Checklist

- Stream access checks match snapshot access checks.
- Snapshot-then-subscribe race is handled by cursor semantics.
- After-commit hooks discard rolled-back patches.
- Reconnect with `afterSeq` does not miss durable events.
- Command and target patches publish after status mutation commit.
- SDK query/path names exactly match FastAPI routes.

### Relationship And Risk

This is the general live substrate that #222 and #223 build on for config and
update visibility.

Risk: the pub/sub abstraction is present, but production Redis/NATS/multi-node
fanout needs explicit deployment and testing. Stream IDs combine persisted event
seqs with generated live IDs, so reviewers should check reconnect semantics.

## PR #222: Target Config Materialization

Link: https://github.com/proliferate-ai/proliferate/pull/222

### Purpose

Adds target-scoped materialization for environment/config state needed before a
session runs on SSH, managed Cloud, or desktop-dispatch targets.

Materialization can include:

- env files
- repo files
- Git credentials
- MCP package/config data
- skills
- agent credential files

### User-Visible Behavior

Users can request materialization for a target/repo and inspect target config
records/status. Worker-owned secret plans are not exposed in user-facing
responses.

### Architecture Flow

```text
User requests materialization
  -> Cloud validates target/repo/config
  -> Cloud stores encrypted plan in cloud_target_configs
  -> Cloud queues materialize_environment command
  -> worker leases command
  -> worker fetches materialization plan with command_id/config_version/lease_id
  -> worker writes local files/config
  -> worker reports status
```

The worker should not decide which credentials or bundles are allowed. Cloud
resolves that policy and sends a narrow plan.

### Important Files

- `server/proliferate/server/cloud/target_config/{api,models,service}.py`
- `server/proliferate/server/cloud/target_config/domain/**`
- `server/proliferate/db/models/cloud/target_config.py`
- `server/proliferate/db/store/cloud_sync/target_config.py`
- `server/alembic/versions/d0*.py`
- `anyharness/crates/proliferate-worker/src/materialization/{env,files,git,mcp,skills,mod}.rs`
- `anyharness/crates/proliferate-worker/src/cloud_client/target_config.rs`
- `anyharness/crates/proliferate-worker/src/commands/dispatcher.rs`
- `cloud/sdk/src/client/target-configs.ts`

### Key Endpoints, Command, And Table

User APIs:

- `GET /v1/cloud/targets/{targetId}/configs`
- `GET /v1/cloud/targets/{targetId}/configs/{configId}`
- `POST /v1/cloud/targets/{targetId}/configs/materialize`

Worker APIs:

- `GET /v1/cloud/worker/target-configs/{configId}/materialization?command_id=&config_version=&lease_id=`
- `POST /v1/cloud/worker/target-configs/{configId}/status`

Command kind:

- `materialize_environment`

Table:

- `cloud_target_configs`

### Review Checklist

- Encrypted plan contents never leak through user responses.
- Worker plan fetch requires the matching command ID, worker ID, lease ID, and
  config version.
- Stale commands cannot apply newer config materialization plans.
- Workspace-root validation matches worker-side canonicalization.
- Path traversal, symlink, absolute path, and parent-dir escapes are blocked.
- Files are written with private permissions where appropriate.
- Git config rejects control characters and unsafe keys.
- Agent credential file materialization is provider-keyed and allowlisted.
- Idempotency accounts for config version changes.

### Relationship And Risk

This PR depends on durable commands and live target streams. It supplies the
target-preparation path needed for SSH/BYO targets, managed Cloud, MCP bundles,
skills, and agent credentials.

Risk: secret breadth is high. Review secret handling, file writes, and plan
fetch authorization more carefully than normal CRUD code.

## PR #223: Worker Update Supervision

Link: https://github.com/proliferate-ai/proliferate/pull/223

### Purpose

Adds update coordination and conservative compute safety controls:

- desired AnyHarness/worker/supervisor versions
- target update generation
- worker heartbeat desired-version handling
- worker update-status reporting
- supervisor update manifest/staging/rollback primitives
- safe-stop checks
- worker revocation

### User-Visible Behavior

Cloud target payloads expose current/desired versions and update status.

Admins can:

- set desired runtime versions
- check whether a target can stop safely
- revoke workers for a target

### Architecture Flow

```text
Admin sets desired versions
  -> Cloud increments updateGeneration
  -> worker heartbeat receives desiredVersions + generation
  -> worker compares desired with installed versions
  -> worker writes supervisor mailbox / update request
  -> supervisor stages/verifies update artifacts
  -> worker reports update status
  -> Cloud generation-fences status update
  -> target live stream publishes status patch
```

Safe-stop is intentionally conservative until target-side safety signals are
fully trusted.

### Important Files

- `server/proliferate/server/cloud/compute/{api,models,service}.py`
- `server/proliferate/server/cloud/worker/domain/updates.py`
- `server/proliferate/db/store/cloud_sync/targets.py`
- `server/proliferate/db/models/cloud/targets.py`
- `server/alembic/versions/*target_update*.py`
- `anyharness/crates/proliferate-worker/src/updates/**`
- `anyharness/crates/proliferate-supervisor/src/update/**`
- `cloud/sdk/src/client/compute.ts`
- `cloud/sdk/src/types/targets.ts`

### Key Endpoints And Fields

Compute APIs:

- `POST /v1/cloud/compute/targets/{targetId}/desired-versions`
- `POST /v1/cloud/compute/targets/{targetId}/safe-stop-check`
- `POST /v1/cloud/compute/targets/{targetId}/revoke-workers`

Worker API:

- `POST /v1/cloud/worker/update-status`

Target response adds:

- `update.channel`
- `update.generation`
- `update.desiredVersions`
- `update.currentVersions`
- `update.status`
- `update.component`
- `update.version`
- `update.reportedAt`

DB target update fields include:

- `update_channel`
- `update_generation`
- desired AnyHarness/worker/supervisor versions
- update status/detail/component/version/report time

### Review Checklist

- Desired-version updates are patch-style, not accidental full overwrites.
- `updateGeneration` fences worker status reports.
- Worker cannot report `applied` unless current versions match desired versions.
- Heartbeat response parsing is strict but backward compatible.
- Revoked workers cannot lease commands, upload events, fetch configs, or report
  update status.
- Safe-stop blocks active commands, active sessions, and idle-but-open sessions.
- Revocation is blocked while target update is in progress.
- Target streams publish update/revocation patches after commit.
- Supervisor staging validates checksums and does not follow unsafe paths.
- Stale supervisor mailbox entries are cleared before new desired versions.

### Relationship And Risk

This completes the update placeholder from the worker/control-plane architecture.

Risk: supervisor update support is not a full updater yet. Signed manifests,
trust root, artifact fetching, durable apply loop, rollback policy, and richer
machine-readable failure codes are deferred.

## Review By System Boundary

Use this section when reviewing the code by folder instead of by PR.

### `cloud/sdk/**`

Owns shared typed Cloud access:

- generated OpenAPI types
- low-level Cloud client
- stream/SSE helpers
- Cloud React hooks

It must not own Desktop auth storage, Tauri access, product-specific UI state,
or worker runtime behavior.

### `desktop/src/**`

Owns Desktop-specific Cloud wiring and UX:

- auth/session storage
- base URL configuration
- Desktop Compute settings surface
- Desktop query invalidation and local UI orchestration

It should not construct raw Cloud endpoint paths in product components when a
shared SDK method exists.

### `server/proliferate/server/cloud/**`

Owns Cloud product/control-plane behavior:

- target registry
- command queue
- worker APIs
- event ingest
- projections
- live streams
- backfill
- target config materialization
- compute/update policy

Domain folders should keep the same predictable shape where possible:

```text
api.py       HTTP boundary
models.py    Pydantic request/response models
service.py   orchestration and transaction shape
domain/      pure validation/mapping/rules when logic gets large
```

### `server/proliferate/db/**`

Owns persistence:

- SQLAlchemy models
- store classes/functions
- Alembic migrations

Stores should not decide product policy. They should provide precise persistence
operations used by Cloud services.

### `anyharness/crates/proliferate-worker/**`

Owns the target-side bridge:

- enrollment identity
- heartbeat/inventory
- command polling/dispatch
- local AnyHarness HTTP client
- event tailing and upload
- local cursor/outbox state
- backfill
- target config materialization
- update status/supervisor mailbox integration

It should not decide org/team authorization, credential grants, prompt queue
semantics, or transcript reconstruction.

### `anyharness/crates/proliferate-supervisor/**`

Owns process/update supervision primitives:

- start/restart worker/AnyHarness where applicable
- update manifest parsing
- staging and validation
- rollback metadata

It should not know Cloud org policy or session semantics.

## Open Questions To Keep Visible During Review

These are not necessarily blockers, but they are the questions most likely to
create future drift:

- Which direct server-to-AnyHarness paths remain, and are they explicitly
  allowed?
- Is every Cloud mutation either a durable command or a Cloud-owned metadata
  mutation?
- Do event payload caps keep Cloud storage bounded for large sessions?
- Are live patches always reconstructable from snapshots/projections?
- Does target config materialization have a clean path for GitHub/Git token
  rotation and credential revocation?
- Do worker retries preserve command result and materialization status across
  process restarts?
- Is `sync_existing_workspace` supposed to support sync-all as a product path,
  or only as an internal maintenance operation?
- What exact production pub/sub backend will replace or back the current
  process-local live fanout?
- What is the signed update artifact/trust-root plan after supervisor staging?
