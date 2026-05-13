# AnyHarness Live Runtime

Status: authoritative for long-lived in-memory runtime systems under
`anyharness-lib/src/live/**`.

The current code is transitional. The live session actor now lives under
`live/sessions/actor/**`, its handle under `live/sessions/handle.rs`, and ACP
process/session mechanics under `live/sessions/connection/**`.
`SessionEventSink` has been split under `acp/event_sink/**`; the final move to
`live/sessions/event_sink/**` is still a topology step. `AcpManager`,
`RuntimeClient`, `InteractionBroker`, `BackgroundWorkRegistry`, and
`replay_actor` also remain under transitional `acp/**` paths until their own
topology passes. `terminals/**` maps to target `live/terminals/**`.

## Purpose

Live runtime code owns state that only exists while the AnyHarness process is
running:

- actor registries
- session handles
- command loops
- subprocess clients
- event sinks
- interaction brokers
- PTY handles
- broadcast channels
- in-memory startup/de-dupe state

Live runtime code should not become durable business logic. Durable rules stay
in `domains/**`.

## Live Session Engine Roles

The live session engine should read as:

```text
LiveSessionManager
  registry and startup de-dupe for live sessions

LiveSessionHandle
  typed command port into one live session actor

SessionActor
  one running session state machine and command loop

AcpClient
  low-level ACP protocol client wrapper

SessionEventSink
  normalizes ACP notifications into durable AnyHarness events

InteractionBroker
  pending permission/user-input/MCP elicitation rendezvous
```

Current name mapping:

```text
AcpManager       -> LiveSessionManager
RuntimeClient    -> AcpClient
SessionEventSink -> currently acp/event_sink/**; target live/sessions/event_sink/
InteractionBroker -> currently acp/permission_broker/**; target live/sessions/interactions/
```

## Actor Files

An actor file should not grow into a whole subsystem. The loop owns ordering;
handlers own behavior. A reader should be able to open the loop file and see
the live state machine without also reading prompt payload conversion,
transcript normalization, MCP schemas, or plan ingestion.

Split by actor concern:

```text
live/sessions/actor/
  mod.rs
  command.rs
  state.rs
  event_loop.rs
  startup.rs
  background_work.rs
  turn/
    mod.rs
    types.rs
    handle.rs
    start.rs
    active.rs
    finish.rs
    queue.rs
    diagnostics.rs
  config/
    mod.rs
    types.rs
    handle.rs
    apply.rs
    queue.rs
    persist.rs
    selection.rs
  notifications/
    mod.rs
    types.rs
    handle.rs
    dispatch.rs
    replay_filter.rs
    plans.rs
  interactions/
    mod.rs
    handle.rs
    cleanup.rs
  fork/
    mod.rs
    handle.rs
    policy.rs
  shutdown/
    mod.rs
    types.rs
    handle.rs
    cleanup.rs
    persist.rs

live/sessions/connection/
  mod.rs
  types.rs
  start.rs
  process.rs
  native_session.rs
  stderr.rs
  shutdown.rs
```

Keep `mod.rs` focused on the public actor surface. Keep `event_loop.rs` focused on
selecting the next actor event and dispatching it. Split idle and busy command
handling because the same command can have different legal behavior while a
prompt is running.

## Event Sink Files

Event sinks are core runtime pieces, not incidental helpers. Split
normalization by event family:

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

The sink may persist and broadcast normalized events. It should not decide
durable session business rules.

Use the actor/sink boundary strictly:

```text
actor      decides when something happens
event_sink decides how that becomes a durable SessionEventEnvelope
```

The actor may call sink methods such as `begin_turn`, `turn_ended`,
`interaction_requested`, or `ingest_tool_call`. The sink should not own prompt
queueing, busy/idle rules, ACP subprocess lifecycle, or interaction waiting.

## Interaction Broker

The interaction broker owns pending request rendezvous:

- permission decisions
- user-input questions
- MCP elicitation forms and URL reveal

It should be under live runtime because it connects a live actor request to a
later API resolution.

## Dependency Rules

Allowed:

```text
live -> domains
live -> integrations
live -> observability
```

Avoid:

```text
live -> api
live -> app
live -> adapters unless the actor directly owns the live process capability
```

If live code needs request latency context, import it from `observability/`, not
from `api/http`.
