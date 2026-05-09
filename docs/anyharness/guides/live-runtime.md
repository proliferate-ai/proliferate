# AnyHarness Live Runtime

Status: authoritative for long-lived in-memory runtime systems under
`anyharness-lib/src/live/**`.

The current code is transitional. Today `acp/**` maps mostly to target
`live/sessions/**`, and `terminals/**` maps to target `live/terminals/**`.

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
SessionEventSink -> keep or split under event_sink/
InteractionBroker -> live/sessions/interactions/
```

## Actor Files

An actor file should not grow into a whole subsystem. Split by actor concern:

```text
live/sessions/actor/
  mod.rs
  command.rs
  startup.rs
  prompt_queue.rs
  prompt.rs
  config.rs
  interactions.rs
  fork.rs
  lifecycle.rs
  stderr.rs
```

Keep `mod.rs` focused on the public actor surface and high-level loop. Move
state transitions and helpers into named files.

## Event Sink Files

Event sinks are core runtime pieces, not incidental helpers. Split
normalization by event family:

```text
live/sessions/event_sink/
  mod.rs
  state.rs
  emit.rs
  assistant.rs
  tools.rs
  terminals.rs
  plans.rs
  background_work.rs
  metadata.rs
  file_references.rs
```

The sink may persist and broadcast normalized events. It should not decide
durable session business rules.

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
