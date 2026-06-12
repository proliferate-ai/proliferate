# AnyHarness Live Runtime

Status: authoritative for long-lived in-memory runtime systems under
`anyharness-lib/src/live/**`.

Session manager, handle, actor, driver, sink, interaction rendezvous,
background work, and replay live under `live/sessions/**`. Remaining `acp/**`
files are shared permission, payload, and provider-error helpers, not
live-session owners. Treat this guide as the grammar for new work and cleanup
passes.

## Purpose

Live runtime code owns state that only exists while the AnyHarness process is
running:

- actor tasks and command channels
- live handles and subscriptions
- subprocess, PTY, browser, or protocol clients
- event/output fanout channels
- pending permission/user-input/MCP callbacks
- startup de-dupe maps
- provider-reported long-running work registries
- cheap live snapshots

Live runtime code should not become durable business logic. Durable records,
product policy, SQL, and cross-restart truth stay in `domains/**`.

## Placement

Put code in `live/**` when it answers questions like:

```text
Which resource instances are running right now?
How do commands reach one running instance?
How do callers subscribe to live updates?
How do we serialize mutation while an instance is busy?
How do we own a subprocess, PTY, browser, or protocol client?
How do we hold a pending live request until a later API call resolves it?
```

Do not put code in `live/**` when it answers:

```text
Which product state transition is allowed?
Which rows should be persisted as durable truth?
Which workspace/session/team owns this thing?
Which HTTP response should the client receive?
How does an external protocol format its raw wire messages?
```

Those belong in `domains/**`, `persistence/**`, `api/**`, or
`integrations/**`.

## Core Grammar

Every live resource should be described with the same vocabulary:

```text
manager = owns/starts/de-dupes/looks up many live instances
handle  = the only public port to one live instance
actor   = private serialized coordinator for one live instance
driver  = private external backing mechanism
sink    = private sequenced event/output write path
```

Not every resource needs every role. The vocabulary is a grammar, not a
template.

Default target shape:

```text
live/<resource>/
  mod.rs
  model.rs          # the live vocabulary file (see below)
  manager.rs or manager/
  handle.rs
  actor/
  driver/
  sink/             # or output_sink/ for terminal-style streams
  rendezvous/
  background_work/
  snapshot/
  replay/
```

Only `model`, `manager`, `handle`, and intentionally public live
result/snapshot/event types should be visible outside `live/<resource>`. Actor
commands, driver clients, sink internals, and rendezvous waiters are private
implementation details.

## The Live Vocabulary File

`live/<area>/model.rs` is the live layer's job-1 file: it declares every shape
that crosses the live boundary, in live's own vocabulary. For sessions it
holds:

```text
launch bundles      SessionLaunch, LaunchEnv (named env layers — never four
                    adjacent maps), SystemPromptAppends, SessionStartupStrategy

capability traits   the durable powers the actor needs, mirroring store
                    signatures 1:1: EventPersist, QueueDurable,
                    BackgroundWorkDurable, SessionStateDurable,
                    AttachmentSource

capability bundle   ActorCapabilities — the never-varies set (traits +
                    observers + advisor), built once and owned by the manager

per-call powers     SessionHooks (on_turn_finish, on_exit)

product-hook ports  SessionEventObserver, PermissionAdvisor, SessionDomainOp
                    (+ ObserverEffects, PermissionAdvice, SessionOpEmitter)
```

Live defines these traits; domains implement them
(`domains/sessions/live_ports.rs` for the durable capabilities,
`domains/plans/` and `domains/reviews/` for the product hooks); `app/` wires
the implementations in. Live never imports domain services or stores.

## Manager

The manager owns many live instances of one resource type.

Manager responsibilities:

- keep the registry from durable id to live handle
- de-dupe startup for the same durable id
- create actor tasks and their initial handles
- remove closed instances from the registry
- expose lookup/start/list operations for callers

Manager non-responsibilities:

- no product policy
- no HTTP mapping
- no raw SQL
- no actor event-loop logic
- no protocol/client implementation
- no broad `AppState` service-locator behavior

Managers may own shared live infrastructure when that infrastructure exists
only to coordinate instances of this live resource. If a broker or service is
used independently by other domains/resources, `app/` should compose it and
pass it in as a dependency.

The capability-wiring law: the wiring family (`app/sessions.rs`) builds the
never-varies capability bundle exactly once; the manager owns it and hands it
to every actor it starts.

```rust
// app/sessions.rs — composition only, no behavior
let caps = ActorCapabilities { events, queue, background, state, attachments,
                               observers, permission_advisor };
let manager = LiveSessionManager::new(caps);
```

Per-call data rides the launch bundle; per-call powers ride beside it:

```rust
manager.start_session(launch /* SessionLaunch */, hooks /* SessionHooks */)
```

## Handle

The handle is the public port to one live instance.

Handle responsibilities:

- expose typed commands such as `send_prompt`, `cancel`, `resize`, or `close`
- expose subscriptions to live events/output when relevant
- expose cheap snapshots/status reads
- translate public live operations into private actor commands
- hide channels, actor command enums, and driver details from callers

Handle non-responsibilities:

- no product policy
- no protocol/client implementation
- no event normalization
- no durable SQL except through narrow dependencies owned elsewhere

Code outside `live/<resource>` may hold a handle. It should not construct
private actor commands or send directly on the actor mailbox.

Good boundary:

```rust
handle.send_prompt(payload, prompt_id).await?;
```

Bad boundary:

```rust
handle
    .command_tx
    .send(SessionCommand::Prompt { payload, prompt_id })
    .await?;
```

The second form leaks actor internals and makes every caller part of the live
state machine.

## Actor

The actor is the private serialized coordinator for one live instance.

Actor responsibilities:

- own authoritative live mutation for one instance
- serialize commands, external notifications, timeouts, and shutdown
- enforce live phase rules such as idle/busy/closing
- decide ordering and delegate work to driver, sink, rendezvous, and
  background-work helpers
- update actor-owned snapshot state

Actor non-responsibilities:

- no inline external process/protocol mechanics
- no inline event normalization or sequence assignment
- no durable product validation
- no HTTP transport mapping
- no public command surface outside the handle

The actor has gravity. Keep handlers thin:

```text
receive event
validate current live phase
update actor-owned state
call driver/sink/rendezvous/background_work helper
return accepted/queued/rejected outcome
```

The actor loop should read as dispatch, not as the full implementation of every
subsystem.

## Driver

The driver owns the external backing mechanism that makes a live resource real.

Driver examples:

- ACP process/client for a session
- PTY process for a terminal
- CDP/Playwright/browser process for a browser
- remote provider session client
- local sidecar process

Driver responsibilities:

- start/connect to the external mechanism
- manage stdin/stdout/stderr or protocol request/response I/O
- perform external lifecycle operations such as initialize, resize, close, or
  shutdown
- expose narrow methods used by the actor
- translate low-level external errors into driver-owned errors

Driver non-responsibilities:

- no product policy
- no event-log sequencing
- no API mapping
- no direct domain service orchestration
- no ownership of the live actor loop

Session code uses `driver/**` for this role because it fits processes, PTYs,
protocol clients, browser drivers, and remote providers.

## Event And Output Sinks

A sink is the sequenced write path from external/runtime events into the
internal live stream.

For sessions, this is an event sink with one ingestion entry — `sink.ingest`
takes one ACP `SessionNotification` and owns its whole transcript consequence:

```text
ACP notification -> sink.ingest -> normalize -> persist -> broadcast
                                -> SinkObservations (for the observer pass)
                                -> ActorBoundUpdate (arms only the actor may
                                   finish: config/mode/session-info)
```

The sink stays meaning-blind: it never touches durable session-row state or
product reactors. What it cannot finish it parses and hands back to the actor.

For terminals, this is more naturally an output sink:

```text
PTY bytes/lifecycle -> ordered terminal output/status -> broadcast/store
```

Sink responsibilities:

- normalize external/runtime events
- assign sequence/order when this resource owns sequencing
- maintain open streaming item state
- persist durable event/output rows when applicable
- broadcast live updates
- own replay-facing event/output shape when applicable

Sink non-responsibilities:

- no prompt queueing
- no busy/idle state machine
- no subprocess lifecycle
- no product access-control decisions

The boundary:

```text
actor decides when something happened
sink decides how that becomes ordered output/events
```

Avoid a generic `events/` folder. Use `sink/`, `output_sink/`,
`projection/`, or a more specific name that says what the folder writes.

## Rendezvous

`rendezvous/**` owns pending live rendezvous. For sessions the broker type is
`InteractionRendezvous` (`live/sessions/rendezvous/broker.rs`).

Examples:

- permission request id to waiter
- user-input request id to waiter
- MCP elicitation request id to waiter
- dialog/credential prompt request id to waiter for a future browser/computer
  use resource

Live interaction responsibilities:

- create and track pending requests
- match resolutions by request id
- validate protocol/schema/kind shape
- cancel or time out waiters when the live actor closes
- deliver resolution back to the actor or driver

Domain responsibilities stay outside live:

- decide whether the user/team/session may answer
- decide what the answer means as product state
- persist durable interaction records when needed
- enforce product policy for submitted values

Live may validate that a response is the right shape for the pending request.
It should not decide product meaning.

## Background Work

`background_work/**` is only for long-running work that is reported by or
delegated to the external provider/runtime and has identity of its own.

Good examples:

- Claude background work registry
- provider task id to live updates
- tool/background-work status updates that must be ordered into the session
  event stream

Bad examples:

- arbitrary cleanup tasks
- retry timers
- metrics emitters
- delayed UI notifications

Those belong under the role they serve: `driver/retry.rs`,
`actor/shutdown/cleanup.rs`, `sink/publish.rs`, or
`manager/cleanup.rs`.

## Snapshots And Replay

Handles may expose cheap snapshots directly. The actor should still be the
write owner for live mutation.

Promote to `snapshot/**` or `projection/**` when snapshot logic becomes a real
read model:

- browser URL/title/viewport/download state
- terminal dimensions/process status/last output position
- active command or input mode
- current session phase with rich pending work state

Use `replay/**` when replay is more than a tiny helper:

- replay filtering
- subscription catch-up
- persisted output/event stream reconstruction
- replay cursor handling

Do not call something `replay_actor` unless it truly has its own mailbox,
serialized state, independent task, and lifecycle. Otherwise prefer
`replay/stream.rs` or `sink/replay.rs`.

## Folder Composition

### `actor/**`

Target shape:

```text
actor/
  mod.rs
  command.rs
  state.rs
  run.rs
  spawn.rs
  startup.rs

  <flow>/
    mod.rs
    types.rs
    handle.rs
    apply.rs
    queue.rs
    persist.rs
    finish.rs
    diagnostics.rs
```

Use only the files that earn their keep.

Actor file roles:

```text
command.rs
  private actor mailbox protocol

state.rs
  the actor struct: actor-owned mutable state and phase tracking

run.rs
  select/receive loop and top-level dispatch — `&mut self` methods on the
  actor struct; receivers threaded as parameters, never stored on the struct

spawn.rs/startup.rs
  task creation and initial live setup

<flow>/types.rs
  flow-specific private actor helper types

<flow>/handle.rs
  command/notification handler for that flow

<flow>/apply.rs
  live state/protocol application helper

<flow>/queue.rs
  deferred work logic

<flow>/persist.rs
  calls into sink/domain persistence capability, not raw SQL sprawl

<flow>/finish.rs
  terminal cleanup for that flow

<flow>/diagnostics.rs
  tracing, timeout labels, and debug measurements
```

Split actor folders by live flow, not by vague helper category:

```text
turn/
config/
notifications/
interactions/
fork/
shutdown/
```

Avoid:

```text
utils.rs
helpers.rs
misc.rs
processing.rs
logic.rs
```

### `driver/**`

Target shape:

```text
driver/
  mod.rs
  types.rs
  start.rs
  process.rs
  client.rs
  stderr.rs
  resize.rs
  shutdown.rs
```

Use concrete names for the external mechanism. For session ACP, the driver
files are:

```text
driver/types.rs
driver/process.rs            # spawn and wire the agent process
driver/connection.rs         # establish the ACP connection, register inbound handlers
driver/session_lifecycle.rs  # initialize the connection
driver/native_session.rs     # new/load/fork native session calls
driver/inbound/              # InboundDoor — see below
driver/stderr.rs
driver/shutdown.rs
```

`driver/inbound/` is the **inbound door**: everything the agent-initiated
direction of the connection may touch. Handlers registered in `connection.rs`
clone an `Arc<InboundDoor>`, which routes notifications to the actor's channel
and inbound requests (permission, user input, MCP elicitation) through the
rendezvous broker, rendering pending-interaction state via the shared sink.

For terminals, target driver files would likely be:

```text
live/terminals/driver/
  pty.rs
  process.rs
  resize.rs
  shutdown.rs
```

### `sink/**` Or `output_sink/**`

Target event sink shape:

```text
sink/
  mod.rs
  state.rs
  ingest.rs        # the one ingestion entry for ACP notifications
  publish.rs
  lifecycle.rs
  turns.rs
  assistant.rs
  reasoning.rs
  tools.rs
  plans.rs
  config.rs
  interactions.rs
  pending_prompts.rs
  background_work.rs
  runtime_events.rs
  metadata.rs
  normalization/
```

Split by event/output family and sequencing responsibility. Keep the sink as
the one ordered write path, with `ingest` as its one inbound entry.

### `rendezvous/**`

Target shape:

```text
rendezvous/
  mod.rs
  broker.rs            # InteractionRendezvous
  broker/validation.rs
  mcp_elicitation/
```

Use subfolders when the rendezvous kind has several protocol or normalization
steps. The protocol-side creation of pending requests lives in
`driver/inbound/` (permission, user input, MCP elicitation); the broker owns
the waiters.

### `background_work/**`

Target shape:

```text
background_work/
  mod.rs
  registry.rs
  updates.rs
  <provider>.rs
```

Split provider-specific long-running work from generic registry/update logic.

## Live Sessions

Current session shape:

```text
live/sessions/
  mod.rs
  model.rs           # the live vocabulary file
  manager/           # surface, startup, replay, runtime-event injection
  handle.rs
  probe.rs

  actor/
    command.rs
    state.rs         # struct SessionActor
    run.rs
    spawn.rs
    startup.rs
    background_work.rs
    turn/
    config/
    notifications/   # dispatch, replay_filter, observations
    interactions/
    fork/
    shutdown/
    tests/

  driver/
    types.rs
    process.rs
    connection.rs
    session_lifecycle.rs
    native_session.rs
    inbound/         # InboundDoor: permission, user_input, mcp_elicitation
    stderr.rs
    shutdown.rs

  sink/              # ingest.rs is the one ingestion entry
  rendezvous/        # InteractionRendezvous broker + mcp_elicitation
  background_work/
  replay/
```

Path mapping notes:

```text
live/sessions/rendezvous/**
  permission, user-input, and MCP elicitation rendezvous (formerly
  interactions/; the broker is InteractionRendezvous)

live/sessions/sink/**
  the session event sink (formerly event_sink/)

live/sessions/driver/inbound/**
  the agent-initiated direction of the ACP connection (formerly the
  runtime_client folder); reusable protocol pieces belong under
  integrations/acp only when they are genuinely protocol-neutral

acp/permission_context.rs
acp/permission_payload.rs
acp/provider_errors.rs
  remaining shared ACP helper paths; move to integrations/acp only if reusable
  protocol mechanics earn that owner
```

The end-to-end session mental model:

```text
SessionRuntime
  loads durable session/workspace/agent state (startup.rs resolves)
  launch_policy (pure) decides strategy and assembles SessionLaunch
  calls manager.start_session(launch, hooks)

LiveSessionManager
  owns ActorCapabilities (wired once in app/sessions.rs)
  starts or finds the live session
  returns LiveSessionHandle

LiveSessionHandle
  accepts typed public commands
  sends private actor commands

SessionActor
  serializes live mutation
  delegates external I/O to driver
  delegates event persistence/broadcast to sink (sink.ingest)
  delegates live rendezvous to the InteractionRendezvous broker
  runs the observer dispatch pass and serialized domain ops

Driver
  owns ACP process/connection lifecycle; the InboundDoor receives
  agent-initiated traffic

Sink
  normalizes ACP notifications into durable/broadcast session events
```

## Product Hooks

Product domains react to a live session through four mechanisms, all declared
in `live/sessions/model.rs` and wired in `app/`. The actor's pockets are
empty: it never imports plan or review services.

The mechanism decision table:

| Mechanism | Timing | Task / thread | May emit events | May block |
| --- | --- | --- | --- | --- |
| `SessionExtension` | launch / turn-finish / session-close lifecycle | main tokio runtime (hooks may spawn) | no — use the runtime-event injection paths | no |
| `SessionEventObserver` | each special observation in the dispatch pass | per-session thread, in-loop, sink lock held | yes — committed rows returned in `ObserverEffects` | sqlite tx only |
| `PermissionAdvisor` | inbound permission arrival, before parking | inbound-door task, sink lock held by the caller | yes — committed rows returned in `Predecided` | sqlite tx only |
| `SessionDomainOp` | product-initiated write needing command ordering | actor loop via the mailbox, sink lock per phase | yes — via `SessionOpEmitter::publish` | sqlite tx only (sync per phase) |

Current implementors: `domains/plans/session_observer.rs` (plan sniffing),
`domains/reviews/session_observer.rs` (candidate plans),
`domains/plans/permission_advisor.rs` (plan-linked permissions),
`domains/plans/decision_op.rs` (approve/reject via
`SessionCommand::RunDomainOp`).

## Event-Emission Serialization

Session-event emission rests on two nested guarantees:

1. **The per-session `current_thread` runtime** — nothing in one session is
   ever parallel.
2. **The sink lock** — every `next_seq` read, every domain tx persisting event
   rows, and every publish happens while the sink mutex is held.

The actor loop adds *ordering* on top: domain writes that must not interleave
with `Cancel`/`Close`/other commands ride the mailbox as a `SessionDomainOp`
(two locked phases, lock released only for an interaction resolution between
them).

Observers run **in-loop in a single ordered pass**, in registration order,
under one sink lock hold. Observer `i`'s returned envelopes are published
immediately and fed forward only to observers `j > i` — never backward, never
a second pass. The partial-failure seq contract: a hook either fails WITHOUT
committing event rows, or commits and returns EVERY committed envelope; the
sink advances `next_seq` only by returned envelopes, so an unreturned row
collides loudly (unique-seq violation), never a silent gap.

The advisor runs on the **inbound-door task** with the sink lock held by the
caller — exactly where the inline logic it replaced ran.

Anything event-emitting is synchronous under the sink lock. Side effects that
emit nothing may hand off to a main-runtime `Handle` captured at app wiring —
the per-session runtime dies with the session; never spawn lasting work on it.

## Live Terminals

Current terminal code is already split by durable and live ownership:

```text
domains/terminals/
  model.rs
  service.rs
  store.rs

live/terminals/
  manager.rs
  handle.rs
  driver.rs
  output_sink.rs
  replay.rs
  shell.rs
```

Future growth should keep the live and durable pieces explicit and promote
flat live files into role folders only when the extra shape is earned:

```text
domains/terminals/
  model.rs
  store.rs
  service.rs

live/terminals/
  manager.rs
  handle.rs
  actor/
  driver/
    pty.rs
    process.rs
    resize.rs
    shutdown.rs
  output_sink/
    publish.rs
    lifecycle.rs
    output.rs
  snapshot/
```

Terminal-specific mapping:

```text
domain service
  durable terminal records, access checks, saved history/metadata if any

manager
  registry of running PTYs

handle
  write input, resize, close, subscribe, read snapshot

actor
  serialize input/resize/close/output lifecycle

driver
  PTY and shell process lifecycle

output_sink
  ordered terminal output/status stream
```

## Composite Live Resources

Some future live resources are trees, not flat instances. Browsers are the
important adversarial case:

```text
browser -> context -> page -> dialogs/downloads/network streams
```

Pick the unit of live identity explicitly. Valid options:

```text
live/browsers/
  manager for browser instances
  browser handles that expose context/page creation
  page handles for page-specific commands

live/browser_pages/
  separate page resource keyed by browser/context/page ids
```

Do not hide a large tree of live instances inside one giant actor unless one
serialized loop is truly the correct unit of mutation. Page-level actors often
make sense for browser automation, while browser/context lifecycle can be
managed above them.

## The Live Boundary

How product code hands work to a live resource, and what live may know back
(see [mental-model.md](mental-model.md) for the underlying law):

- **Live receives complete descriptions.** The owning domain runtime resolves
  all product truths and hands the live layer one launch/command bundle. If a
  live resource needs a fact it does not have, the fix is adding a field to
  the bundle — live never fetches product truth.
- **Domain shapes may cross in; domain services and stores may not.** A
  `SessionRecord` or `ResolvedAgent` crossing into live is the lingua franca
  working. A concrete store or service crossing in makes the actor untestable
  and lets live read or write anything durable.
- **Durable powers cross as narrow capability traits.** When an actor must
  persist as it runs (event sinks, attachment writes), live defines the trait
  in its own vocabulary, the domain implements it, and `app/` wires it. The
  actor is then testable with a vector behind the trait.
- **The relay points down.** Manager -> actor -> driver: each level consumes
  the level above's output and derives only mechanical detail (command lines,
  env merge order, protocol messages). No level reaches up for more.
- **The manager owns authoritative idempotency** for "is this already
  running", checked under its own lock. Callers may keep a fast-path check;
  the lock-held check is the one that prevents races.
- Bundle parameters by the parameter test: never-varies -> manager
  constructor; per-call data -> the launch struct; per-call power -> a
  capability parameter beside it. Adjacent identically-typed parameters
  (multiple env maps) are a silent-swap hazard and must be named struct
  fields.

Sessions are the in-repo exemplar of this boundary:
`manager.start_session(launch: SessionLaunch, hooks: SessionHooks)` is the
whole per-call surface; the durable powers are the capability traits in
`ActorCapabilities`, implemented by `domains/sessions/live_ports.rs` (pure
1:1 delegation over `SessionStore`) and wired once in `app/sessions.rs`.

## Dependency Rules

Allowed:

```text
live -> domain shapes (model types) and live-defined capability traits
live -> integrations for protocol/vendor mechanics
live -> adapters only when the live resource directly owns a local capability
live -> observability
```

Avoid:

```text
live -> api
live -> app
driver -> product domain services
sink -> product access-control decisions
integrations -> live
```

Recommended module visibility:

```rust
pub mod sessions {
    pub mod model; // the boundary vocabulary is public

    pub use handle::LiveSessionHandle;
    pub use manager::LiveSessionManager;

    mod actor;
    mod driver;
    mod sink;
    mod rendezvous;
    mod background_work;
}
```

Actor commands should be private to the live resource:

```rust
pub(in crate::live::sessions) enum SessionCommand {
    // ...
}
```

Better still, only `handle.rs` constructs them.

## Review Checklist

Use this checklist when reviewing live runtime changes:

- Is there exactly one public command port for one live instance?
- Can code outside the live resource construct actor commands? If yes, fix it.
- Does the actor handler decide ordering and delegate, or did it absorb driver
  and sink logic?
- Is the driver free of product policy and API mapping?
- Is the sink the only sequenced event/output writer?
- Are live interaction waiters separated from durable product meaning?
- Is background work limited to provider/runtime work with identity?
- Are snapshots read-only to callers and write-owned by the actor/handle path?
- Does a new folder represent ownership, or just a prettier `misc` bucket?
- If the resource is composite, is the unit of serialization explicit?
- Does anything cross the live boundary besides domain shapes, one launch
  bundle, and capability traits?
- Could this actor be tested without a database behind it?
