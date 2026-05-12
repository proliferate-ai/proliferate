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
SessionService      anyharness-lib/src/sessions/service/
SessionStore        anyharness-lib/src/sessions/store/**
AcpManager          target name: LiveSessionManager
LiveSessionHandle   currently inside acp/session_actor.rs
SessionActor        currently acp/session_actor.rs
RuntimeClient       target name: AcpClient
SessionEventSink    currently acp/event_sink/**
InteractionBroker   currently acp/permission_broker/**
```

Implementation reality after the completed migration phases:

- session MCP assembly lives under `sessions/mcp_bindings/**`.
- `SessionStore` is split under `sessions/store/**`.
- `SessionService` is split under `sessions/service/**`.
- `SessionRuntime` is split under `sessions/runtime/**`.
- prompt preparation is split under `sessions/prompt/**`.
- `SessionEventSink` is split under `acp/event_sink/**`.
- `acp/session_actor.rs` remains the current actor implementation; the actor
  loop rewrite is deferred/manual.

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

Current service files:

```text
sessions/service/
  mod.rs             # service type, constructor, public error surface
  creation.rs        # durable session validation and record creation
  queries.rs         # session reads, title updates, live-config snapshots
  import_export.rs   # mobility import and durable delete cleanup
  launch_catalog.rs  # workspace/effective launch catalog projection
  model_resolution.rs
  attachments.rs     # prompt attachment read fallback and migration
```

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

Current name: `AcpManager`.

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

The current implementation remains a single `acp/session_actor.rs` file. The
rewrite into an actor folder requires a dedicated actor spec and is explicitly
deferred.

### AcpClient

Low-level ACP client wrapper. Current name: `RuntimeClient`.

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

Current prompt files:

```text
sessions/prompt/
  mod.rs          # public prompt API, limits, prepare context
  payload.rs      # persisted prompt payload and ACP content conversion
  blocks.rs       # stored block schema and transcript content projection
  prepare.rs      # request block validation and PreparedPrompt assembly
  attachments.rs  # prepared attachment records, storage cleanup/persist helpers
  provenance.rs   # internal provenance schema and public-safe projection
  capabilities.rs # ACP/live-config prompt capability mapping
```

Keep new prompt block validation in `prepare.rs`, new persisted block shape in
`blocks.rs`, and ACP conversion in `payload.rs`.

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
  event_sink/
  interactions/
  acp_client.rs
  replay_actor.rs
```
