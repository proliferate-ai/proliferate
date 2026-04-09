# Sessions

`anyharness-lib/src/sessions/**` owns durable session truth, session-domain
validation, event persistence, live-config persistence, and the runtime-level
orchestration that bridges durable sessions into live ACP execution.

## Core Concepts

The sessions area has two layers:

- durable session domain
  - `anyharness/crates/anyharness-lib/src/sessions/model.rs`
  - `anyharness/crates/anyharness-lib/src/sessions/store.rs`
  - `anyharness/crates/anyharness-lib/src/sessions/service.rs`
- live orchestration bridge
  - `anyharness/crates/anyharness-lib/src/sessions/runtime.rs`

The durable layer owns:

- session identity
- stored status
- event history
- raw ACP notification history for debugging
- persisted live-config snapshots
- queued config changes

The runtime layer owns:

- create-and-start
- resume
- prompt / cancel / close
- permission resolution
- coordination with workspaces and ACP

## Core Models

### `SessionRecord` (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

`SessionRecord` is the durable session row.

It includes:

- `id`
- `workspace_id`
- `agent_kind`
- `native_session_id`
- requested / current model and mode fields
- status
- timestamps

This is the durable identity surface for a session.

### `SessionEventRecord` (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

`SessionEventRecord` is the durable event log row.

It stores:

- monotonically increasing `seq`
- timestamp
- event type
- optional turn and item ids
- serialized event payload JSON

This is the backlog source for session history and SSE replay.

### `SessionRawNotificationRecord` (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

`SessionRawNotificationRecord` is the durable raw ACP notification row.

It stores:

- monotonically increasing `seq`
- timestamp
- ACP notification kind
- serialized raw notification JSON

This is a debug and regression-capture surface. It does not replace normalized
session events as the runtime truth for replay or rendering.

### Live Config Records (`anyharness/crates/anyharness-lib/src/sessions/model.rs`)

There are two durable config-related record types:

- `SessionLiveConfigSnapshotRecord`
  - the last normalized ACP-exposed config surface
- `PendingConfigChangeRecord`
  - config changes requested while a session was busy

These are how the runtime remembers live config across reconnects and busy
periods.

## Durable Session Flow

### Create

`SessionService::create_session(...)`
(`anyharness/crates/anyharness-lib/src/sessions/service.rs`)
does the durable validation path.

It:

1. verifies the workspace exists
2. verifies the requested agent kind exists in the built-in registry
3. resolves the agent and requires it to be ready
4. validates the requested model id against the curated provider catalog
5. creates the durable `SessionRecord` in `starting` state

This path does not start ACP directly. It only produces a valid durable session
record.

### Read and History

The durable service and store own:

- `get_session`
- `list_sessions`
- `list_session_event_records`
- `get_live_config_snapshot`

SSE replay and history endpoints read from these durable records first before
merging live events.

## Runtime Flow

### Create and Start

`SessionRuntime::create_and_start_session(...)`
(`anyharness/crates/anyharness-lib/src/sessions/runtime.rs`)
is the eager live-start path.

It:

1. asks `SessionService` to create the durable row
2. resolves the workspace
3. resolves the agent again for launch
4. computes the last durable event seq
5. asks `AcpManager` to start the live actor
6. persists the native session id and updates status to `idle`

This is the bridge from durable session creation into live ACP execution.

### Resume

`ensure_live_session(...)`
(`anyharness/crates/anyharness-lib/src/sessions/runtime.rs`)
is the idempotent cold-start path for an existing session.

It:

1. loads the durable session row
2. checks whether a live handle already exists
3. if not, restarts the live actor using the persisted native session id
4. returns the refreshed durable session summary

### Prompt / Cancel / Close

Prompt flow is owned by `SessionRuntime`, but actual prompt execution is owned
by the ACP actor.

The runtime layer:

- ensures the actor exists
- sends the command over the actor channel
- maps actor/lifecycle errors into runtime-facing errors

Cancel and close follow the same pattern.

### Permission Resolution

Permission resolution also goes through `SessionRuntime`.

It does not persist permissions itself. It finds the live session handle and
delegates to ACP’s permission broker via the live runtime.

## Configuring Flow

Live session configuration is deliberately split across the session and ACP
layers.

### What the session domain owns

The session domain owns:

- the durable live-config snapshot
- the queue of pending config changes
- normalized control metadata exposed back to clients

`live_config.rs`
(`anyharness/crates/anyharness-lib/src/sessions/live_config.rs`)
is the normalization layer from ACP config options into the runtime-owned
`SessionLiveConfigSnapshot` shape.

It:

- flattens ACP select options into raw config options
- groups known controls into normalized buckets such as model, mode, reasoning,
  effort, and fast mode
- preserves everything else as extras

### What the ACP runtime owns

The ACP runtime owns:

- applying or queuing config changes against a live actor
- restoring persisted config after resume
- emitting config updates when ACP changes the active surface

### End-to-end config flow

1. client requests a config change
2. `SessionRuntime` ensures the actor is live
3. the actor tries to apply the change through ACP
4. if the session is busy, the change is queued durably
5. ACP config updates rebuild the normalized snapshot
6. the snapshot is persisted durably
7. queued changes are replayed when the actor becomes idle

### Model selection specifics

Model changes have extra logic because agents expose models in different ways.

The runtime tries:

1. direct ACP model APIs
2. curated Claude alias handling when needed
3. generic config-option setters as a fallback

That is why model configuration spans both:

- `anyharness/crates/anyharness-lib/src/sessions/live_config.rs`
- `anyharness/crates/anyharness-lib/src/acp/session_actor.rs`

## SSE and Event Flow

The session stream endpoint merges:

- durable backlog from `SessionStore`
- live broadcast events from the active `LiveSessionHandle`

The important behavior is:

- durable history is always replayable
- live events continue from the highest already-sent sequence
- SSE does not become the source of truth; durable event rows do

Code path:

- `anyharness/crates/anyharness-lib/src/api/sse/sessions.rs`

## Boundaries

### Sessions Owns

- durable session identity
- session validation
- session status persistence
- event history persistence
- live-config snapshot persistence
- pending config-change persistence
- runtime-level orchestration between durable sessions, workspaces, and ACP

### Sessions Does Not Own

- low-level ACP protocol handling
- live actor registry
- workspace registration or worktree creation
- agent installation logic
- HTTP or SSE transport parsing

## Important Invariants

- A session must belong to a valid workspace.
- A session must target a supported, ready agent before creation succeeds.
- Session event sequences are monotonic per session.
- Durable records remain authoritative even when no live actor exists.
- Config changes requested while busy must not be lost.

## Extension Points

Add behavior here when it changes session-domain rules or durable/runtime
session orchestration, for example:

- new session validation rules
- new durable config metadata
- new session lifecycle operations
- new config-normalization behavior

Do not add behavior here when it belongs purely to:

- ACP protocol callbacks
- workspace identity rules
- agent install or credential logic
