# Session Actor

Status: authoritative for the split live session actor. The migration this
spec drove is complete; the shapes below are the current code.

This spec is specific to the actor portion of the AnyHarness session engine. It
assumes the broader architecture in
[guides/system-architecture.md](../guides/system-architecture.md) and the
session engine overview in [session-engine.md](session-engine.md).

Implementation:

```text
anyharness-lib/src/live/sessions/actor/
anyharness-lib/src/live/sessions/driver/
anyharness-lib/src/live/sessions/handle.rs
```

## Scope

The actor is not a giant `session_actor.rs` file with support modules around
it. The split holds as:

```text
live/sessions/actor/ owns the actor command protocol, state, run loop, turn,
config, notification, interaction-command, fork policy, background-work update,
and shutdown behavior — as &mut-self methods on `struct SessionActor`.

live/sessions/driver/ owns ACP process/connection/native-session startup and
shutdown mechanics.

live/sessions/handle.rs owns the public command/subscription port into one
actor.
```

The old `acp/session_actor.rs` is gone. The top-level actor loop is readable
from `live/sessions/actor/run.rs`.

## Purpose

`SessionActor` is the serialized decision loop for one running ACP-backed
session.

It owns ordering. It decides how these inputs interleave:

```text
product/user commands
ACP notifications
active prompt execution
pending prompt edits
queued config changes
background work updates
interaction resolutions
cancel/close/dismiss/shutdown
```

It does not own the whole session product. It is one live component inside:

```text
domains/sessions/runtime
  -> live/sessions/handle
    -> live/sessions/actor
      -> live/sessions/driver
      -> live/sessions/sink
      -> live/sessions/rendezvous
      -> live/sessions/background_work
```

## Non-Goals

The actor must not own:

```text
HTTP/SSE request handling
contract response mapping
prompt attachment validation
product MCP selection or injection
MCP JSON-RPC tool behavior
agent catalog/install policy
workspace/session durable business rules
raw SQL query families
transcript rendering
event stream replay
provider CLI launch policy
```

Those belong to `api/`, `domains/`, `integrations/`, `adapters/`, or sibling
`live/sessions/**` collaborators.

## Collaborators

The actor coordinates collaborators; it does not absorb their code.

```text
live/sessions/handle
  public command/subscription port used by SessionRuntime and stream code

live/sessions/driver
  ACP process/connection/session lifecycle: spawn (process.rs), establish and
  register handlers (connection.rs), initialize (session_lifecycle.rs),
  load/new/fork (native_session.rs), stderr, graceful close; the InboundDoor
  (driver/inbound/) receives agent-initiated requests and notifications

live/sessions/sink
  normalized event sequencing, persistence, and broadcast fanout; ingest.rs is
  the one ingestion entry for ACP notifications

live/sessions/rendezvous
  pending permission, user-input, and MCP elicitation rendezvous
  (InteractionRendezvous)

live/sessions/background_work
  long-running tool/background work tracking

live/sessions/model.rs capability traits
  the narrow durable operations the actor needs (EventPersist, QueueDurable,
  BackgroundWorkDurable, SessionStateDurable, AttachmentSource), implemented
  by domains/sessions/live_ports.rs and wired in app/sessions.rs as
  ActorCapabilities — the actor never sees a concrete store

live/sessions/model.rs product-hook ports
  SessionEventObserver, PermissionAdvisor, SessionDomainOp — how plans and
  reviews react without the actor importing their services

domains/sessions/prompt
  product prompt payload preparation before the actor receives a command;
  prompt/render.rs is the pure ACP-block rendering the actor calls with
  pre-loaded ResolvedParts

domains/sessions/mcp_bindings
  product/user MCP launch assembly before actor startup
```

Boundary rule:

```text
actor/
  What should this one live session do next?

sibling live/sessions folder
  How does this live resource or collaborator work?

domains/sessions
  What does this product operation mean durably?
```

## Owned State

The actor may own state required to serialize one live session:

```text
native ACP session id
current ACP driver/client handle
current phase: starting, idle, busy, closing, closed
active turn id and active prompt metadata
current live config snapshot needed for protocol calls
startup/native-session state
close/dismiss/cancel intent
active pending interaction ids that must be cleaned up on shutdown
diagnostic timers and stuck-turn bookkeeping
```

The actor should not keep hidden product truth that is not reconstructable from
domain state or provider state.

## Public Command Surface

Actor commands are the only way product code mutates a live session.

Command categories:

```text
Prompt
  start immediately when idle; durably queue when busy

SetConfigOption
  apply immediately when idle; durably queue when busy

ResolveInteraction
  complete a pending permission/user-input/MCP elicitation

RunDomainOp
  execute a boxed SessionDomainOp (e.g. the plan approve/reject decision)
  serialized through the mailbox; phases run under the sink lock, the boxed
  Any reply downcasts at the submitter

Fork
  allowed only when actor state and provider capability permit

Cancel
  forward cancellation to ACP and resolve pending waits as cancelled

Close / Dismiss
  record shutdown intent and finish safely

Snapshot
  return live execution snapshot without mutating actor state
```

Command definitions belong in:

```text
live/sessions/actor/command.rs
```

Command handlers belong under the concern that owns their behavior, not in one
giant command file.

## Event Loops

The actor has two important loops.

### Outer Loop

The outer loop runs while the actor is alive:

```text
startup
loop:
  product/user command       -> command handler
  ACP notification           -> notification handler
  background work update     -> background_work handler
  shutdown/error condition   -> shutdown handler
```

The outer loop file should read as dispatch. It should not contain full prompt
execution, config application, event normalization, or process startup
mechanics.

### Active Turn Loop

The active turn loop runs after an idle prompt begins:

```text
accept prompt
  -> start turn
  -> convert already-prepared PromptPayload into ACP blocks
  -> call ACP prompt
  -> while prompt is running:
       ACP notification       -> notification handler
       product/user command   -> busy command handler
       background work update -> background_work handler
       diagnostics timer      -> diagnostics handler
  -> finish turn
  -> apply queued config
  -> drain next pending prompt if one exists
  -> return to idle or continue next turn
```

The command response reports acceptance only:

```text
Started { turn_id }
Queued { seq }
Rejected { reason }
```

Agent output always arrives later through ACP notifications and the event sink.

## Idle vs Busy Rules

The same command may have different behavior depending on actor phase.

Idle:

```text
Prompt            -> start turn
SetConfigOption   -> apply to ACP/current config immediately
Fork              -> attempt fork if supported
Close/Dismiss     -> shutdown directly
Snapshot          -> return current snapshot
```

Busy:

```text
Prompt            -> durably queue pending prompt
SetConfigOption   -> durably queue pending config change
ResolveInteraction -> complete pending interaction
Cancel            -> forward cancellation to ACP
Close/Dismiss     -> record shutdown intent; finish/cancel safely
Fork              -> reject as busy
Snapshot          -> return current snapshot
```

This split should be explicit in code. Do not hide busy/idle behavior behind a
single large command match.

## Folder Shape

Top-level actor files:

```text
live/sessions/actor/
  mod.rs
  command.rs
  state.rs
  run.rs
  spawn.rs
  startup.rs
  background_work.rs
  tests/
```

Responsibilities:

```text
mod.rs
  public actor surface and module declarations

command.rs
  command/result types accepted by the actor handle

state.rs
  `struct SessionActor` — identity from the launch, loop-owned conversation
  state, wiring set at startup — plus SessionActorConfig (launch + caps +
  hooks + broker + event channel) and phase types

run.rs
  top-level select loop and dispatch only: &mut-self methods
  (run / run_idle / run_turn); every arm is one method call

spawn.rs
  actor thread creation, readiness waiting, and handle construction

startup.rs
  the SessionActor constructor: spawns the agent process
  (driver/process.rs), establishes the connection (driver/connection.rs),
  initializes it (driver/session_lifecycle.rs), starts the native session,
  and runs the startup config-restore sequence

background_work.rs
  actor-side background work update handling
```

The three receivers (commands, notifications, background work) deliberately
stay OUT of the struct: they are threaded through `run`/`run_idle`/`run_turn`
as parameters so the inner selects can borrow them alongside `&mut self`.
There are no per-flow context structs — handlers are methods on the actor.

No actor-owned file should become the new god module. If one concern file grows
past the repo-shape hard limit, split it by the concern grammar below before
the migration is considered complete.

Concern folders:

```text
turn/
  prompt turn lifecycle and pending prompt queue drain

config/
  actor-side config apply/queue/persist behavior

notifications/
  ACP notification classification and dispatch

shutdown/
  cancellation, close, dismiss, error finalization

interactions/
  actor-side interaction resolution commands

fork/
  actor command handling for verify-fork-ready, fork, and native child-session
  close; raw ACP capability parsing stays with driver/protocol code

diagnostics/
  stuck-turn and state diagnostics if it outgrows turn/diagnostics.rs
```

Use the concern grammar from `guides/system-architecture.md`:

```text
mod.rs
types.rs
handle.rs
apply.rs       # live/protocol mutation
queue.rs       # deferred durable work
persist.rs     # durable/sink writes
finish.rs      # terminal cleanup path
diagnostics.rs # tracing/debug timeout logic
```

## Turn Folder

Shape:

```text
actor/turn/
  mod.rs
  types.rs
  handle.rs
  start.rs
  active.rs
  queue.rs
  finish.rs
  diagnostics.rs
```

Responsibilities:

```text
handle.rs
  Prompt command entrypoint; choose start-now vs queue

start.rs
  idle prompt setup: begin turn, convert PromptPayload to ACP blocks, call ACP

active.rs
  active prompt select loop while provider is running

queue.rs
  busy prompt queue/edit/delete/drain behavior

finish.rs
  end turn, clear busy state, apply queued config, drain next prompt

diagnostics.rs
  stuck turn and long-running prompt diagnostics
```

The actor receives an already validated `PromptPayload`. Product prompt
building remains in `domains/sessions/prompt`.

## Config Folder

Shape:

```text
actor/config/
  mod.rs
  types.rs
  handle.rs
  apply.rs
  queue.rs
  persist.rs
  selection.rs
```

Responsibilities:

```text
handle.rs
  SetConfigOption command entrypoint; choose apply-now vs queue

apply.rs
  call ACP/native config APIs and mutate actor current config state

queue.rs
  persist pending config changes while busy

persist.rs
  update durable requested/current config snapshots through narrow store/sink calls

selection.rs
  pure helpers for choosing/merging actor-side config values
```

Config selection that is product-facing or launch-facing belongs in
`domains/sessions/config`. Actor config code owns only live apply/queue timing.

## Notifications Folder

Shape:

```text
actor/notifications/
  mod.rs
  handle.rs
  dispatch.rs
  replay_filter.rs
  observations.rs
```

Responsibilities:

```text
handle.rs
  ACP notification entrypoint

dispatch.rs
  persist the raw notification, hand it to sink.ingest, apply any returned
  ActorBoundUpdate (config/mode/session-info arms only the actor may finish),
  then run the observer pass over the collected observations

replay_filter.rs
  suppress provider replay/startup notifications that should not become new
  product events

observations.rs
  the observer dispatch pass: one sink lock hold, registration order,
  feed-forward of earlier observers' envelopes (see live/sessions/model.rs)
```

There is no actor-side plan code: plan sniffing lives in
`domains/plans/session_observer.rs` (a `SessionEventObserver` wired in
`app/sessions.rs`).

Notification handlers persist the raw ACP notification before normalized
event handling.

Tool calls are not a separate actor subsystem. They enter as ACP
notifications, route through notification dispatch, and are normalized by
`sink/tools.rs`.

## Interactions Folder

Shape:

```text
actor/interactions/
  mod.rs
  handle.rs
  outcomes.rs
  cleanup.rs
```

Responsibilities:

```text
handle.rs
  ResolveInteraction command entrypoint

outcomes.rs
  resolution outcome handling

cleanup.rs
  cancel/dismiss/shutdown cleanup for pending waits
```

There are no plan files here. Plan approve/reject is
`domains/plans/decision_op.rs`, a `SessionDomainOp` submitted via
`SessionCommand::RunDomainOp` (through `handle.run_domain_op`), not a bespoke
actor arm.

The pending request broker itself belongs outside the actor:

```text
live/sessions/rendezvous/
```

Reason: the driver's `InboundDoor` creates pending requests, API/runtime
resolves them through commands, and the actor cleans them up. The broker
(`InteractionRendezvous`) is a collaborator, not an actor-internal module.

## Shutdown Folder

Shape:

```text
actor/shutdown/
  mod.rs
  types.rs
  handle.rs
  cleanup.rs
  persist.rs
```

Responsibilities:

```text
handle.rs
  Close, Dismiss, Cancel, provider-error, and actor-error entrypoints

cleanup.rs
  stop/cancel provider work, close the driver, resolve pending interactions,
  clear phase

persist.rs
  emit terminal session state through event sink and narrow stores
```

Shutdown code owns finalization ordering. It should not format API errors or
decide product retention/cleanup policy.

## Connection Boundary

ACP process startup does not belong inside `actor/` concern folders.

Shape:

```text
live/sessions/driver/
  mod.rs
  types.rs
  process.rs
  connection.rs
  session_lifecycle.rs
  native_session.rs
  inbound/
  stderr.rs
  shutdown.rs
```

Responsibilities:

```text
process.rs
  spawn and wire the provider process/stdin/stdout/stderr

connection.rs
  establish the ACP client connection over the agent's stdio: register the
  inbound handlers (via the InboundDoor), spawn the connect future on the
  per-session LocalSet, return the ConnectionTo handle

session_lifecycle.rs
  initialize the established connection

native_session.rs
  new/load/fork native ACP session decisions and calls

inbound/
  the InboundDoor: agent-initiated notifications and requests (permission,
  user_input, mcp_elicitation) routed to the actor channel and the
  rendezvous broker; the permission path consults the PermissionAdvisor
  before parking

stderr.rs
  stderr sanitization/classification

shutdown.rs
  provider/process close behavior that is not actor state-machine policy
```

The actor's constructor (`actor/startup.rs`) builds the actor by calling
driver code in order — process spawn, `connection.rs`,
`session_lifecycle.rs`, native session start — but driver code owns the
process/protocol resource mechanics. The actor keeps policy decisions such as
"start a new native session vs load an existing native session" only when
that decision depends on actor phase or ordering.

Reusable ACP protocol or provider mechanics should move lower:

```text
integrations/acp/
integrations/agent_cli/
```

## Event Sink Boundary

The actor decides when something happened. The event sink decides how it becomes
durable and streamable.

Shape:

```text
live/sessions/sink/
  mod.rs
  state.rs
  ingest.rs
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

`ingest.rs` is the one ingestion entry: it takes one ACP notification, owns
its transcript consequence, collects `SinkObservation`s for the observer pass,
and returns `ActorBoundUpdate` for the arms it cannot finish (the sink is
meaning-blind: no durable session-row state, no product reactors).

Actor may call methods such as:

```text
begin_turn
turn_finished
assistant_chunk
tool_call
interaction_requested
config_updated
pending_prompt_added/removed
session_ended
```

Event sink may:

```text
assign sequence numbers
write normalized events
update open transcript item state
broadcast envelopes to subscribers
normalize ACP payload fragments
```

Event sink must not:

```text
queue prompts
decide busy/idle rules
choose which MCPs are attached
start/stop ACP process
wait for interaction resolution
format API responses
```

## Required Invariants

These hold today; changes must preserve them:

```text
one actor owns one live ACP native session
actor is the only owner of busy/idle phase
prompt queue handoff is durable before executed pending prompt removal is emitted
ACP notifications are persisted raw before normalized event handling
config applies immediately only when idle; otherwise it queues
interaction cleanup runs on cancel, dismiss, close, and error
shutdown emits terminal session state exactly once
event sequence order is stable for SSE replay + live broadcast
event-emitting hooks run synchronously under the sink lock (observer pass,
  advisor, domain-op phases); the sink advances next_seq only by envelopes
  returned/published back to it
actor never decides product MCP selection
actor never imports product-domain services — product reactions arrive as
  observers, the advisor, and domain ops via ActorCapabilities
actor never validates raw HTTP request shapes
```

## Shape Checklist

A change to the actor is in shape when all of these stay true:

```text
1. live/sessions/actor/run.rs shows the session engine loop without
   prompt/config/notification/shutdown implementation details — every select
   arm is one &mut-self method call.

2. Idle and busy command behavior are explicit and separated.

3. Active turn handling lives under actor/turn/ and clearly shows start,
   active loop, finish, queued config application, and pending prompt drain.

4. Config apply-vs-queue behavior lives under actor/config/.

5. ACP notification dispatch lives under actor/notifications/ and delegates
   normalization to sink.ingest; the observer pass runs from
   actor/notifications/observations.rs.

6. Actor-side interaction resolution and cleanup live under actor/interactions/;
   product decisions arrive as SessionDomainOps, never bespoke actor arms.

7. Fork readiness, fork command handling, and native child-session close policy
   live under actor/fork/.

8. Background work update handling lives under actor/background_work.rs unless
   it grows enough to earn its own concern folder.

9. Cancel/close/dismiss/error finalization lives under actor/shutdown/.

10. ACP process/connection/native-session startup mechanics live under
    live/sessions/driver/, called by actor/startup.rs in order.

11. Product prompt preparation remains in domains/sessions/prompt; rendering
    is the pure domains/sessions/prompt/render.rs over AttachmentSource-loaded
    parts.

12. Product MCP selection/injection remains in domains/sessions/mcp_bindings.

13. Event normalization, sequence assignment, persistence, and broadcast remain
    in `live/sessions/sink/**`.

14. The actor reaches durable state only through the capability traits in
    ActorCapabilities; it is testable with vectors behind the traits
    (see actor/tests/).
```
