# Session Engine

Status: authoritative for the core AnyHarness session engine mental model.

## Core Flow

```text
api/http/sessions
  -> SessionRuntime
    -> SessionService / SessionStore
    -> LiveSessionManager
      -> LiveSessionHandle
        -> SessionActor
          -> AcpClient
          -> SessionEventSink
          -> InteractionBroker
```

Current names:

```text
SessionRuntime      anyharness-lib/src/sessions/runtime/
SessionService      anyharness-lib/src/sessions/service.rs
SessionStore        anyharness-lib/src/sessions/store/**
LiveSessionManager  live/sessions/manager.rs
LiveSessionHandle   live/sessions/handle.rs
SessionActor        live/sessions/actor/**
RuntimeClient       live/sessions/connection/runtime_client.rs; target role: AcpClient
SessionEventSink    live/sessions/event_sink/**
InteractionBroker   live/sessions/interactions/broker.rs
```

Implementation reality after the completed migration phases:

- session MCP assembly lives under `sessions/mcp_bindings/**`.
- `SessionStore` is split under `sessions/store/**`.
- `SessionRuntime` is split under `sessions/runtime/**`.
- `SessionEventSink` is split under `live/sessions/event_sink/**`.
- `SessionActor` is split under `live/sessions/actor/**`; connection mechanics
  are split under `live/sessions/connection/**`, the current name for the
  target `driver/**` role.

## Role Map

### SessionStore

Database adapter for session truth:

- sessions
- events
- raw notifications
- live config snapshots
- pending prompts
- background work rows

It does not know ACP and does not start sessions.

### SessionService

Durable session business logic:

- create durable session record
- validate durable session/workspace constraints
- update title
- list/get sessions
- get persisted live config snapshot
- build launch catalog
- summarize durable session/workspace state

It does not talk to a live ACP actor.

### SessionRuntime

High-level session use cases:

- create and start
- ensure/resume live session
- send prompt
- cancel/close
- fork
- set live config
- resolve interactions
- edit/remove pending prompts
- inject/replay events

This is the bridge between durable sessions and live execution. The
implementation is split under `sessions/runtime/**` by API-facing operation
family; callers should continue to use the public `SessionRuntime` type.

### LiveSessionManager

Live registry:

- session id to live handle map
- startup de-dupe
- pending startup waiters
- shared interaction broker

Current path: `live/sessions/manager.rs`.

### LiveSessionHandle

Typed command port into one actor:

- prompt
- set config
- resolve interaction
- fork
- close
- snapshot

### SessionActor

One running agent session state machine:

- ACP subprocess/client lifecycle
- command loop
- startup/resume
- pending prompt queue
- turn lifecycle
- live config apply
- fork handling
- interaction registration
- event sink calls
- shutdown/error handling

The actor implementation is split under `live/sessions/actor/**`; the detailed
folder contract is specified in `specs/session-actor.md`.

### AcpClient

Low-level ACP client wrapper. Current name: `RuntimeClient`, under
`live/sessions/connection/runtime_client.rs`.

It sends ACP requests to the subprocess and receives ACP notifications. It does
not own session business rules.

### SessionEventSink

ACP notification to AnyHarness event normalizer:

- tracks open transcript items
- normalizes assistant/tool/terminal/plan/background metadata
- assigns event sequence
- persists normalized events
- broadcasts events

This is core runtime logic, not a helper.

### InteractionBroker

Pending interaction rendezvous:

- permission decisions
- user-input questions
- MCP elicitation forms
- MCP URL reveal

The actor registers a pending request. The API later resolves it.

### Prompt Preparation

Prompt preparation turns user intent into a protocol-safe prompt payload:

- prompt blocks
- attachments
- plan references
- capabilities
- provenance
- validation

## Prompt Flow

```text
API handler
  -> SessionRuntime.send_prompt(...)
    -> load durable session
    -> prepare prompt payload
    -> ensure live handle exists
    -> send actor command
    -> actor sends ACP prompt via AcpClient
    -> ACP notifications return
    -> SessionEventSink persists and broadcasts events
```

Prompt submission and transcript streaming are separate interfaces:

```text
Command path:
  client -> HTTP command -> SessionRuntime -> LiveSessionHandle -> SessionActor

Event path:
  SessionEventSink -> SQLite append -> live broadcast channel -> SSE stream
```

The command response reports acceptance, not the agent response. For prompts,
the actor returns `Started { turn_id }` when it begins a turn and
`Queued { seq }` when the session is already busy and the prompt is durably
queued. The agent response arrives later as ordered `SessionEventEnvelope`
records over the event stream. Clients reconnect with `after_seq`; the SSE
handler replays missed SQLite events and then subscribes to the live broadcast
channel.

## Create Flow

```text
API handler
  -> SessionRuntime.create_and_start_session(...)
    -> SessionService creates durable session
    -> WorkspaceRuntime resolves workspace path/env
    -> SessionExtension registry resolves launch extras
    -> user MCP bindings + internal MCP servers are combined
    -> LiveSessionManager starts actor
    -> actor starts ACP client/subprocess
    -> SessionEventSink emits normalized events
```

## Session Actor Shape

`SessionActor` is the serialized owner of one live ACP session. Its job is
ordering: it decides how product commands, ACP notifications, prompt execution,
background work, pending interactions, config updates, and shutdown interleave.

The actor should not own prompt attachment validation, transcript rendering,
MCP schemas, plan product semantics, raw SQL query families, or API
request/response mapping. It should call the modules that own those concerns.

High-level target actor files:

```text
live/sessions/actor/
  mod.rs
  command.rs
  state.rs
  event_loop.rs
  turn/
  config/
  notifications/
  fork/
  interactions/
  shutdown/
```

See `specs/session-actor.md` for the concern-folder grammar and migration
plan.

The high-level loop should read as dispatch:

```text
startup
loop:
  command received       -> idle or busy command handler
  ACP notification       -> notification handler
  background work update -> background work handler
  shutdown               -> finalization
```

The active prompt loop should be equally explicit:

```text
accept prompt
  -> start turn
  -> run ACP prompt while handling notifications, busy commands, and background work
  -> finish turn
  -> apply queued config
  -> drain next pending prompt if one exists
```

Split idle and busy command handling. While idle, prompt/config/fork/close can
usually execute immediately. While busy, a prompt is queued, config is queued,
cancel is forwarded to ACP, interaction resolution is allowed, and close/dismiss
records intent to finish safely.

Core actor invariants:

- one live actor owns one ACP native session
- the actor is the only writer of `busy`
- prompt queue handoff is durable before `PendingPromptRemoved { Executed }`
- ACP notifications are persisted raw before normalized event handling
- config changes apply immediately only when idle; otherwise they queue
- shutdown resolves pending interactions and emits terminal session state

## Event Sink Shape

`SessionEventSink` is the transcript writer. The actor decides when something
happened; the sink decides how that becomes durable `SessionEventEnvelope`
records.

Target sink files:

```text
live/sessions/event_sink/
  mod.rs
  state.rs
  publish.rs
  turns.rs
  assistant.rs
  reasoning.rs
  tools.rs
  plans.rs
  config.rs
  interactions.rs
  pending_prompts.rs
  background_work.rs
  lifecycle.rs
  runtime_events.rs
  normalization/
```

The sink may assign sequence numbers, persist normalized events, and broadcast
them. It should not decide actor lifecycle, prompt queueing, config timing, or
pending interaction waits.

## Target File Shape

```text
domains/sessions/
  model.rs
  store/
  service/
  runtime/
  prompt/
  events/
  mcp_bindings/
  extensions/
  links/
  subagents/
  workspace_naming/

live/sessions/
  manager.rs
  handle.rs
  actor/
  driver/
  event_sink/
  interactions/
  background_work/
  replay/
```
