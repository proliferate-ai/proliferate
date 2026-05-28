# Worker Loop / Exposure / Web-Mobile Sync

Status: quick-reference study packet for worker loops, Cloud exposure,
projection, and client sync.

Canonical sources:

- `docs/current/specs/04-cloud-running-alignment.md`
- `docs/current/specs/08-web-mobile-dispatch.md`
- `docs/architecture/cloud-worker-workspace-command-spec.md`
- `docs/frontend/specs/mobile-cloud-client.md`
- `docs/frontend/specs/web-cloud-local-parity.md`

## Mental Model

Cloud owns:

- command queue
- target and worker state
- workspace exposure policy
- projected session/read models
- Cloud SSE streams

Worker owns:

- target-local relay identity
- command polling and dispatch
- materialization execution
- AnyHarness event tailing
- local retry cursors

AnyHarness owns:

- actual session runtime
- session event sequence
- local workspaces
- tool execution and interactions

Web/mobile consume:

- Cloud snapshots
- Cloud SSE streams
- Cloud command status
- Cloud read models

Core invariant:

```text
commands down: Cloud -> worker -> AnyHarness
events up:     AnyHarness -> worker -> Cloud -> clients
```

Session output is not returned by `send_prompt`. It is projected through the
event sync path.

## Worker Runtime Paths

```text
anyharness/crates/proliferate-worker/src/main.rs
anyharness/crates/proliferate-worker/src/runtime.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/sync/tailer.rs
anyharness/crates/proliferate-worker/src/store/mod.rs
```

Startup:

1. Load config.
2. Enroll or reuse worker identity.
3. Send inventory and heartbeat.
4. Spawn command dispatcher.
5. Spawn event tailer.
6. Sync revoked tokens.

Cloud worker APIs:

```text
server/proliferate/server/cloud/worker/api.py
server/proliferate/server/cloud/worker/service.py
```

Important endpoints:

```text
POST /v1/cloud/worker/enroll
POST /v1/cloud/worker/heartbeat
POST /v1/cloud/worker/inventory
POST /v1/cloud/worker/materialization-reports
POST /v1/cloud/worker/update-status
POST /v1/cloud/worker/commands/lease
POST /v1/cloud/worker/commands/{command_id}/delivery
POST /v1/cloud/worker/commands/{command_id}/result
GET  /v1/cloud/worker/exposures
GET  /v1/cloud/worker/revoked-jtis
POST /v1/cloud/worker/events/batches
POST /v1/cloud/worker/events/gaps
```

Local worker SQLite:

```text
identity
sync_sessions
sync_workspaces
worker_projection_cursor
pending_command_results
worker_workspace_discovery
```

Most important local tables:

- `pending_command_results`: retry terminal command results after Cloud POST failure.
- `worker_projection_cursor`: track AnyHarness event upload position per projection.
- `identity`: target/worker/profile/sandbox/slot identity.

## Command Dispatcher Loop

Dispatcher path:

```text
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
```

Loop:

1. Flush `pending_command_results`.
2. Probe AnyHarness health.
3. Lease supported command kinds from Cloud.
4. Report delivery for normal commands.
5. Dispatch local materialization handlers or AnyHarness HTTP.
6. Register session sync on successful session creation.
7. Save/report terminal result.

If AnyHarness is unhealthy, the worker advertises only materialization-safe
kinds, such as Git identity, repo checkout, and environment materialization.
Session commands require a healthy AnyHarness runtime.

Worker command client:

```text
anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
```

AnyHarness command clients:

```text
anyharness/crates/proliferate-worker/src/anyharness_client/sessions.rs
anyharness/crates/proliferate-worker/src/anyharness_client/workspaces.rs
anyharness/crates/proliferate-worker/src/anyharness_client/events.rs
```

Command mapping:

```text
anyharness/crates/proliferate-worker/src/commands/mapping.rs
```

## Exposure Mechanics

Exposure model/store:

```text
server/proliferate/db/models/cloud/exposures.py
server/proliferate/db/store/cloud_sync/exposures.py
```

Exposure answers:

- Can Cloud list this workspace?
- Can Cloud project its session state?
- Can Cloud-mediated clients command it?
- What default projection level should sessions use?
- Is it private, shared unclaimed, claimed, or archived?

Important exposure fields:

```text
target_id
cloud_workspace_id
anyharness_workspace_id
visibility
default_projection_level
commandable
status
revision
```

Visibility:

```text
private
shared_unclaimed
claimed
archived
```

Status:

```text
active
paused
stale
revoked
```

Projection levels:

```text
index_only          exposure-level inventory only.
session_summaries  summary-changing events only.
transcript         persisted transcript rows, no live fanout.
live               transcript plus live SSE patches.
```

Note: `CloudWorkspaceExposure` allows `index_only`; `CloudSessionProjection`
currently stores `session_summaries`, `transcript`, or `live`.

Worker exposure fetch:

```text
GET /v1/cloud/worker/exposures
server/proliferate/server/cloud/worker/service.py
```

The worker uses this response to reconcile local projection cursors and decide
what sessions/workspaces it should tail.

## Event Sync Up

Worker tailer:

```text
anyharness/crates/proliferate-worker/src/sync/tailer.rs
```

Loop:

1. Fetch active exposures/projection cursors from Cloud.
2. Discover sessions for workspace-only exposures.
3. Fetch AnyHarness events:

```text
GET /v1/sessions/{session_id}/events?after_seq=...&limit=100&oldest_first=true
```

4. Upload batches:

```text
POST /v1/cloud/worker/events/batches
```

5. Update local ack cursor only after Cloud accepts the batch.
6. Report gaps:

```text
POST /v1/cloud/worker/events/gaps
```

7. Pause that projection cursor until repaired.

Cloud ingest:

```text
server/proliferate/server/cloud/events/service.py
server/proliferate/server/cloud/events/ingest_policy.py
server/proliferate/server/cloud/events/domain/payload_policy.py
server/proliferate/db/store/cloud_sync/events.py
```

Durable event/read models:

```text
server/proliferate/db/models/cloud/sync.py
  CloudSessionEvent
  CloudEventIngestState
  CloudSyncedWorkspace
  CloudSessionProjection
  CloudTranscriptItem
  CloudPendingInteraction
```

Ingest rules:

- Event seq must be positive.
- Duplicate event seq is okay only if payload hash matches.
- Duplicate seq with different payload is rejected.
- Ingest requires an active projection tied to an active exposure.
- Projection workspace id must match exposure workspace id.
- Payload retention policy strips/truncates sensitive or large data.
- Live-only deltas are not durable.
- Live fanout happens after DB commit.

## Cloud Live Streams

Server paths:

```text
server/proliferate/server/cloud/live/api.py
server/proliferate/server/cloud/live/service.py
server/proliferate/server/cloud/events/api.py
```

Snapshot/list endpoints:

```text
GET /v1/cloud/workspaces/{workspace_id}/snapshot
GET /v1/cloud/sessions
GET /v1/cloud/sessions/{session_id}/snapshot
GET /v1/cloud/sessions/{session_id}
GET /v1/cloud/sessions/{session_id}/transcript
GET /v1/cloud/sessions/{session_id}/events
```

SSE endpoints:

```text
GET /v1/cloud/workspaces/{workspace_id}/stream
GET /v1/cloud/sessions/{session_id}/stream
GET /v1/cloud/targets/{target_id}/stream
```

Cloud live is SSE, not WebSocket. AnyHarness has other WebSocket surfaces such
as terminal transport, but Cloud command/session sync uses HTTP + SSE.

Stream event kinds include:

```text
snapshot
patch
projection_patch
workspace_projection_patch
target_projection_patch
command_status
heartbeat
```

## Web / Mobile Client Paths

Cloud SDK:

```text
cloud/sdk/src/client/commands.ts
cloud/sdk/src/client/events.ts
cloud/sdk/src/client/live.ts
cloud/sdk/src/client/workspaces.ts
cloud/sdk/src/streams/sse.ts
cloud/sdk/src/types/**
```

Cloud React bindings:

```text
cloud/sdk-react/src/hooks/commands.ts
cloud/sdk-react/src/hooks/events.ts
cloud/sdk-react/src/hooks/live.ts
cloud/sdk-react/src/hooks/live-reducer.ts
cloud/sdk-react/src/hooks/workspaces.ts
cloud/sdk-react/src/lib/query-keys.ts
```

Web:

```text
web/src/components/chat/screen/ChatScreen.tsx
web/src/lib/access/cloud/pending-home-prompt-dispatch.ts
```

Mobile:

```text
mobile/src/components/chat/MobileChatScreen.tsx
mobile/src/lib/access/cloud/pending-mobile-prompt-dispatch.ts
```

Shared view logic:

```text
packages/product-model/src/workspaces/cloud-work-inventory.ts
packages/product-model/src/chats/cloud/transcript-view.ts
packages/product-model/src/chats/cloud/composer-controls.ts
packages/product-ui/src/workspaces/**
packages/product-ui/src/chat/**
```

## Web / Mobile Command Flow

1. Load Cloud workspace/session snapshot.
2. Compute readiness from `packages/product-model`.
3. If needed, prepare/materialize managed workspace.
4. Enqueue `start_session`, `update_session_config`, or `send_prompt`.
5. Poll command status.
6. Subscribe to SSE streams.
7. Merge live patches into query cache/client state.
8. Render transcript from Cloud read models.

Important:

- Command status says whether dispatch was queued/accepted/rejected.
- Transcript output comes from event projection, not the command response.
- If stream fails with `401` or `403`, the client treats it as terminal.
- Other SSE errors reconnect with backoff.

## Desktop Relationship

Desktop can:

- run local AnyHarness directly
- start/stop local cloud worker for remote access
- view Cloud inventory/read models
- direct attach to runtime when permitted

Relevant paths:

```text
desktop/src/hooks/workspaces/remote-access/use-workspace-remote-access-actions.ts
desktop/src-tauri/src/commands/cloud_worker.rs
desktop/src/lib/access/anyharness/runtime-target.ts
```

## Invariants

- No active exposure/projection means worker events are discarded.
- Exposure commandability controls workspace/session command admission.
- Projection commandability controls session command admission.
- Managed targets are fenced by sandbox slot generation.
- Command result must match lease, worker, sandbox, and slot.
- Event seq and contiguous ack cursor are monotonic.
- Duplicate seq is allowed only with identical payload hash.
- Live publishes are deferred until DB commit.
- Worker pauses projection cursor on sequence gap.
- Web queued prompt/session/config commands expire after about 4 minutes if not terminal.

## Common Failure Modes

- Target offline: commands stay queued; UI polls status/snapshots.
- Worker crash before delivery: lease expires and may be picked up again.
- Worker crash after result preparation: `pending_command_results` retries.
- Worker crash after delivery but before result preparation: generic command can stay `delivered`.
- AnyHarness unhealthy: worker only takes materialization-safe commands.
- Runtime config/agent auth not ready: command rejected or blocked.
- Exposure paused/stale/revoked: commandability and ingest fail.
- Sequence gap: worker reports gap and stops tailing that cursor.
- Payload cap exceeded: ingest rejects.
- Duplicate seq payload mismatch: ingest rejects.

## Debugging Order

1. `cloud_commands`
2. `cloud_targets`, `cloud_workers`, `cloud_target_status`
3. `cloud_workspace_exposure`
4. `cloud_sessions`
5. `cloud_session_events`
6. `cloud_event_ingest_state`
7. `cloud_transcript_items`
8. `cloud_pending_interactions`
9. worker local `pending_command_results`
10. worker local `worker_projection_cursor`

Useful code breakpoints:

```text
server/proliferate/server/cloud/commands/service.py
server/proliferate/db/store/cloud_sync/commands.py
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/sync/tailer.rs
server/proliferate/server/cloud/events/service.py
server/proliferate/server/cloud/live/service.py
```

## Review Questions

- What flows down from Cloud and what flows up from AnyHarness?
- What does `cloud_workspace_exposure` decide?
- Why are events discarded without an active exposure/projection?
- What is the difference between `transcript` and `live` projection?
- Where do web/mobile get session output from?
- What happens on a sequence gap?
- Why can a prompt command be accepted while the transcript is still loading?

