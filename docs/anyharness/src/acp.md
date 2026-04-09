# ACP Runtime

`anyharness-lib/src/acp/**` owns live ACP-backed session execution.

## Core Concepts

The ACP runtime starts after the session domain has already decided that a
session exists and should run live.

It owns:

- the in-memory registry of live sessions
- one actor per live session
- the ACP stdio connection to the agent process
- permission mediation
- normalization of ACP-native notifications into AnyHarness session events

It does not own session creation validation, workspace registration, or agent
installation.

## Core Runtime Objects

### `AcpManager` (`anyharness/crates/anyharness-lib/src/acp/manager.rs`)

`AcpManager` is the process-local coordinator for live sessions.

It owns:

- the in-memory `session_id -> LiveSessionHandle` map
- the shared `PermissionBroker`

Its main jobs are:

- prevent duplicate actor startup for the same session
- build `SessionActorConfig`
- create the live broadcast channel
- spawn the actor and return its control handle

### `LiveSessionHandle` (`anyharness/crates/anyharness-lib/src/acp/session_actor.rs`)

`LiveSessionHandle` is the control surface for one live session.

It owns:

- the actor command channel
- the broadcast sender for live session events
- the busy flag used to reject concurrent prompts

Higher layers use it to:

- subscribe to live events
- send prompt / config / cancel / close commands
- gate prompt concurrency

### `SessionActorConfig` (`anyharness/crates/anyharness-lib/src/acp/session_actor.rs`)

`SessionActorConfig` is the full startup input for one actor.

It includes:

- the durable `SessionRecord`
- the resolved agent launch surface
- workspace path
- workspace env
- session launch env
- session store
- shared permission broker
- resume metadata such as `is_resume` and `last_seq`

This is the handoff from durable orchestration into live execution.

### `RuntimeClient` (`anyharness/crates/anyharness-lib/src/acp/runtime_client.rs`)

`RuntimeClient` is the AnyHarness ACP client implementation.

It handles:

- ACP permission requests
- ACP session notifications

It does not own the actor loop. It translates ACP protocol callbacks into:

- permission broker requests
- internal notification messages
- normalized runtime events through the event sink

### `SessionEventSink` (`anyharness/crates/anyharness-lib/src/acp/event_sink.rs`)

`SessionEventSink` is the canonical normalization layer from ACP updates into
AnyHarness `SessionEventEnvelope`.

It owns:

- sequence numbering
- durable event persistence
- live event broadcast
- transcript item coalescing
- plan, tool, usage, config, permission, and session event emission

### `PermissionBroker` (`anyharness/crates/anyharness-lib/src/acp/permission_broker.rs`)

`PermissionBroker` owns pending ACP permission-request state.

It stores:

- unresolved requests keyed by request id
- ACP option ids and option kinds

It resolves requests by:

- allow
- deny
- explicit option id

## Main Flow

### Session Start

The live start flow is:

1. `sessions/runtime.rs` decides a session should be live.
   - code: `anyharness/crates/anyharness-lib/src/sessions/runtime.rs`
2. It resolves workspace and agent dependencies.
3. It calls `AcpManager::start_session(...)`.
4. `AcpManager` deduplicates by session id and spawns an actor if needed.
5. The actor launches the resolved agent-process executable with merged
   workspace and session env.
6. The actor creates an ACP `ClientSideConnection` over child stdio.
7. The actor calls `initialize`.
8. If the agent advertises auth methods, the actor attempts `authenticate`, but
   `new_session` or `load_session` is still the real startup gate.
9. The actor either:
   - calls `new_session(...)` for a fresh session, or
   - calls `load_session(...)` when resuming
10. The actor emits startup events and persists the initial live-config
    snapshot.
11. The actor returns the native ACP session id back to the caller.

### Prompt Flow

The prompt flow is:

1. higher-level runtime gets a `LiveSessionHandle`
2. it sends `SessionCommand::Prompt`
3. the actor marks the session busy and updates durable status to `running`
4. `SessionEventSink` begins a turn and emits the user-message item
5. the actor calls ACP `prompt(...)`
6. while the prompt is active, the actor still processes:
   - ACP notifications
   - cancel requests
   - queued config changes
   - close requests
7. when the prompt finishes, the actor:
   - drains remaining notifications
   - emits `turn_ended`
   - updates durable status back to `idle` or `errored`
   - applies any queued config changes if now idle

### Notification and Streaming Flow

The notification flow is:

1. ACP sends `session_notification(...)` into `RuntimeClient`
2. `RuntimeClient` forwards the notification into an internal channel
3. the actor consumes notifications
4. `handle_notification(...)` in
   `anyharness/crates/anyharness-lib/src/acp/session_actor.rs`
   maps ACP updates into runtime behavior
5. `SessionEventSink` converts ACP-native chunks and tool updates into
   normalized transcript items and session events
6. events are both:
   - appended durably through `SessionStore`
   - broadcast live through `tokio::broadcast`
7. the original ACP notification JSON is also appended durably for debug and
   regression capture before normalization

Important normalization behaviors:

- assistant chunks and reasoning chunks are coalesced into in-progress items
- tool calls are tracked as transcript items keyed by tool-call id
- plan updates replace the active plan item payload
- config-option updates rebuild the normalized live-config snapshot
- session info, usage, and permission events are emitted as distinct typed
  events
- raw ACP notifications are persisted alongside normalized events so rendering
  or normalization bugs can be debugged from both views

### Permission Flow

The permission flow is:

1. ACP calls `request_permission(...)` on `RuntimeClient`
2. `RuntimeClient` emits `permission_requested` through the sink
3. `PermissionBroker` stores the pending request and waits
4. higher-level runtime resolves the request by:
   - allow
   - deny
   - explicit option id
5. `RuntimeClient` converts that back into ACP’s permission outcome
6. `RuntimeClient` emits `permission_resolved` through the sink

### Config Flow

Live config changes are ACP-owned runtime operations, not pure session-store
updates.

The flow is:

1. the session runtime ensures the actor is live
2. it sends `SessionCommand::SetConfigOption`
3. the actor either:
   - applies the option immediately through ACP, or
   - queues it durably if the session is currently busy
4. ACP config updates rebuild the normalized live-config snapshot
5. the snapshot is persisted in `session_live_config_snapshots`
6. pending changes are replayed when the actor becomes idle again

Model selection has extra logic:

- try direct ACP model APIs first
- fall back to config-option setters when needed
- keep the normalized snapshot aligned with the effective current model

Most of that logic lives in
`anyharness/crates/anyharness-lib/src/acp/session_actor.rs`.

## Boundaries

### ACP Owns

- the in-memory live-session registry
- actor startup and shutdown
- ACP subprocess stdio lifecycle
- prompt / cancel / close execution
- live config application and queued config changes
- notification handling
- event normalization
- permission brokering

### ACP Does Not Own

- HTTP, SSE, or WebSocket transport
- durable session creation validation
- session persistence schema
- workspace registration or identity rules
- agent descriptors
- installation logic
- ACP registry lookup
- provider model catalogs

## Important Invariants

- Live ACP state is process-local and in-memory.
- Durable session rows remain the source of truth for session identity.
- Event sequence numbers are monotonic per session.
- Resume starts the sink from `last_seq + 1` so live events continue the
  durable sequence.
- Only one prompt may run per live session at a time.
- Config requests must not silently disappear while a session is busy; they are
  queued durably and retried when the actor becomes idle.

## Failure Semantics

Startup can fail at several stages:

- subprocess spawn
- ACP initialize
- ACP authenticate
- ACP `new_session`
- ACP `load_session`

Prompt execution can fail independently after successful startup.

When that happens the actor is responsible for:

- surfacing a runtime-meaningful error
- updating durable session status
- emitting normalized error or session-ended events

## Extension Points

Add behavior here when it changes live ACP execution itself, for example:

- new ACP notification kinds
- new normalized event behavior
- new permission-resolution behavior
- new actor commands
- new startup or resume behavior

Do not add behavior here when it belongs to:

- session-domain validation
- workspace identity rules
- agent installation or registry resolution
- transport-layer request parsing
