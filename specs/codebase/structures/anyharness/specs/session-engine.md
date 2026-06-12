# Session Engine

Status: authoritative for the core AnyHarness session engine mental model.

## Core Flow

```text
api/http/sessions
  -> SessionRuntime
    -> SessionService / SessionStore
    -> launch_policy (pure) -> SessionLaunch + SessionHooks
    -> LiveSessionManager.start_session(launch, hooks)
      -> LiveSessionHandle
        -> SessionActor
          -> driver (ACP connection; InboundDoor for inbound traffic)
          -> SessionEventSink (sink.ingest)
          -> InteractionRendezvous
```

Current names:

```text
SessionRuntime         anyharness-lib/src/domains/sessions/runtime/
SessionService         anyharness-lib/src/domains/sessions/service/
SessionStore           anyharness-lib/src/domains/sessions/store/**
SessionView            domains/sessions/runtime/view.rs
SessionLaunch et al.   live/sessions/model.rs (the live vocabulary file)
LiveSessionManager     live/sessions/manager/**
LiveSessionHandle      live/sessions/handle.rs
SessionActor           live/sessions/actor/** (struct in actor/state.rs)
InboundDoor            live/sessions/driver/inbound/**
SessionEventSink       live/sessions/sink/**
InteractionRendezvous  live/sessions/rendezvous/broker.rs
```

Implementation reality:

- session MCP assembly lives under `domains/sessions/mcp_bindings/**`.
- `SessionStore` is split under `domains/sessions/store/**`.
- `SessionService` is split under `domains/sessions/service/**`.
- `SessionRuntime` is split under `domains/sessions/runtime/**`; pure launch
  decisions are `runtime/launch_policy.rs`, read-side assembly is
  `runtime/view.rs`.
- The live capability traits the actor needs are implemented by
  `domains/sessions/live_ports.rs` (pure 1:1 delegation over the store) and
  wired once as `ActorCapabilities` in `app/sessions.rs`.
- `SessionEventSink` is split under `live/sessions/sink/**`.
- `SessionActor` is split under `live/sessions/actor/**`; driver mechanics are
  split under `live/sessions/driver/**`.

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
implementation is split under `domains/sessions/runtime/**` by API-facing operation
family; callers should continue to use the public `SessionRuntime` type.

Two files carry special roles:

- `runtime/launch_policy.rs` — pure launch decisions: data-in/data-out, no
  store, no clock, no `&self`. `startup.rs` resolves (record loads, link
  lookups, env/MCP assembly) and feeds gathered facts in; the policy chooses
  the startup strategy and assembles the final `SessionLaunch`.
- `runtime/view.rs` — `SessionView`, the read-side aggregate (record +
  live-config snapshot + execution summary + pending prompts) composed by the
  runtime with batched queries. HTTP maps it via the dep-less
  `SessionView::into_contract`; nothing fetches inside a mapper.

### LiveSessionManager

Live registry:

- session id to live handle map
- startup de-dupe
- pending startup waiters
- owns the shared `InteractionRendezvous` broker
- owns `ActorCapabilities` (wired once in `app/sessions.rs`) and hands it to
  every actor it starts

Current path: `live/sessions/manager/**`. The whole per-call surface is
`start_session(launch: SessionLaunch, hooks: SessionHooks)`.

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

### Driver / InboundDoor

`live/sessions/driver/**` owns the ACP process and connection mechanics:
process spawn (`process.rs`), connection establishment (`connection.rs`),
initialization (`session_lifecycle.rs`), and native new/load/fork calls
(`native_session.rs`).

`driver/inbound/**` is the `InboundDoor` — the agent-initiated direction of
the connection. It routes notifications to the actor's channel and inbound
requests (permission, user input, MCP elicitation) through the rendezvous
broker; the permission path consults the `PermissionAdvisor` before parking.
The driver does not own session business rules.

### SessionEventSink

ACP notification to AnyHarness event normalizer:

- tracks open transcript items
- normalizes assistant/tool/terminal/plan/background metadata
- assigns event sequence
- persists normalized events
- broadcasts events

This is core runtime logic, not a helper.

### InteractionRendezvous

Pending interaction rendezvous (`live/sessions/rendezvous/broker.rs`):

- permission decisions
- user-input questions
- MCP elicitation forms
- MCP URL reveal

The inbound door parks a pending request. The API later resolves it; the actor
cleans up on shutdown.

### Prompt Preparation

Prompt preparation turns user intent into a protocol-safe prompt payload:

- prompt blocks
- attachments
- plan references
- capabilities
- provenance
- validation

The pipeline is split pure/IO: `AttachmentSource::load` (the live capability,
implemented over store + attachment storage) loads every referenced part;
`domains/sessions/prompt/render.rs` is the pure half — `ResolvedParts` in,
ACP content blocks out, no IO, base64 and UTF-8 validation only.

### Plans And Reviews Hooks

Plans and reviews never appear inside the actor. They hook in through the
ports declared in `live/sessions/model.rs` and wired in `app/sessions.rs`:

- `domains/plans/session_observer.rs` / `domains/reviews/session_observer.rs`
  — `SessionEventObserver`s run in one ordered in-loop pass (plans before
  reviews; reviews consumes the plan envelopes via feed-forward).
- `domains/plans/permission_advisor.rs` — `PermissionAdvisor` consulted by the
  inbound door before parking a permission request (plan linking, predecided
  answers).
- `domains/plans/decision_op.rs` — the approve/reject decision as a
  `SessionDomainOp` serialized through the actor mailbox
  (`SessionCommand::RunDomainOp`).

See `guides/live-runtime.md` for the mechanism decision table and the
serialization/seq contracts.

## Prompt Flow

```text
API handler
  -> SessionRuntime.send_prompt(...)
    -> load durable session
    -> prepare prompt payload
    -> ensure live handle exists
    -> send actor command
    -> actor renders the payload (pure render.rs) and sends the ACP prompt
       over the driver connection
    -> ACP notifications return through the InboundDoor
    -> sink.ingest persists and broadcasts events
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
    -> launch_policy assembles SessionLaunch (pure); runtime builds SessionHooks
    -> LiveSessionManager.start_session(launch, hooks) starts the actor
    -> actor startup spawns the process and establishes the ACP connection
    -> sink emits normalized events
```

## Session Actor Shape

`SessionActor` is the serialized owner of one live ACP session. Its job is
ordering: it decides how product commands, ACP notifications, prompt execution,
background work, pending interactions, config updates, and shutdown interleave.

The actor should not own prompt attachment validation, transcript rendering,
MCP schemas, plan product semantics, raw SQL query families, or API
request/response mapping. It should call the modules that own those concerns.

High-level actor files:

```text
live/sessions/actor/
  mod.rs
  command.rs
  state.rs          # struct SessionActor
  run.rs            # &mut-self select loop; receivers threaded as parameters
  spawn.rs
  startup.rs        # constructor: driver/connection.rs + session_lifecycle.rs
  background_work.rs
  turn/
  config/
  notifications/
  fork/
  interactions/
  shutdown/
  tests/
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

Sink files:

```text
live/sessions/sink/
  mod.rs
  state.rs
  ingest.rs         # the one ingestion entry for ACP notifications
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
  metadata.rs
  normalization/
  tests/
```

The sink may assign sequence numbers, persist normalized events, and broadcast
them. It should not decide actor lifecycle, prompt queueing, config timing, or
pending interaction waits. The sink is meaning-blind: arms that need durable
session-row state or product reactors are parsed in `ingest.rs` and returned
to the actor as `ActorBoundUpdate`; special observations are collected for the
actor's observer pass.

## File Shape

```text
domains/sessions/
  model.rs
  live_ports.rs     # implements live's capability traits over the store
  store/
  service/
  runtime/          # incl. launch_policy.rs (pure) and view.rs (SessionView)
  prompt/           # incl. render.rs (pure)
  mcp_bindings/
  extensions.rs
  live_config/
  links/
  subagents/
  workspace_naming/

live/sessions/
  model.rs          # launch bundles, capability traits, hook ports
  manager/
  handle.rs
  probe.rs
  actor/
  driver/           # incl. inbound/ (InboundDoor)
  sink/
  rendezvous/
  background_work/
  replay/
```
