# Session Actor

Status: authoritative for the split live session actor.

This spec is specific to the actor portion of the AnyHarness session engine. It
assumes the broader architecture in
[guides/system-architecture.md](../guides/system-architecture.md) and the
session engine overview in [session-engine.md](session-engine.md).

Current implementation:

```text
anyharness-lib/src/live/sessions/actor/
anyharness-lib/src/live/sessions/driver/
anyharness-lib/src/live/sessions/handle.rs
```

Target owner:

```text
anyharness-lib/src/live/sessions/actor/
```

## Full Cleanup Scope

This is not a helper-extraction task. A completed actor migration means the
actor implementation is no longer a giant `session_actor.rs` file with support
modules around it.

Done means:

```text
live/sessions/actor/ owns the actor command protocol, state, event loop, turn,
config, notification, interaction-command, fork policy, background-work update,
and shutdown behavior.

live/sessions/driver/ owns ACP process/native-session startup and shutdown
mechanics currently embedded in actor startup paths.

live/sessions/handle.rs owns the public command/subscription port into one
actor.

acp/session_actor.rs is deleted. No top-level actor behavior remains there.
```

Do not stop after moving types, small helpers, or diagnostics out of the old
file. The top-level actor loop must be readable from
`live/sessions/actor/event_loop.rs`.

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
      -> live/sessions/event_sink
      -> live/sessions/interactions
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
  ACP process/session lifecycle: spawn, initialize, authenticate, load/new/fork,
  stderr, graceful close

live/sessions/acp_client
  low-level ACP request/notification adapter

live/sessions/event_sink
  normalized event sequencing, persistence, and broadcast fanout

live/sessions/interactions
  pending permission, user-input, and MCP elicitation rendezvous

live/sessions/background_work
  long-running tool/background work tracking

domains/sessions/store
  narrow durable operations the actor needs, such as raw notification append,
  pending prompt queue mutation, and config queue mutation

domains/sessions/prompt
  product prompt payload preparation before the actor receives a command

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

Target command categories:

```text
Prompt
  start immediately when idle; durably queue when busy

SetConfigOption
  apply immediately when idle; durably queue when busy

ResolveInteraction
  complete a pending permission/user-input/MCP elicitation

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

## Target Folder Shape

Top-level actor files:

```text
live/sessions/actor/
  mod.rs
  command.rs
  state.rs
  event_loop.rs
  spawn.rs
  startup.rs
  background_work.rs
```

Responsibilities:

```text
mod.rs
  public actor surface and module declarations

command.rs
  command/result types accepted by the actor handle

state.rs
  actor-owned live state and phase types

event_loop.rs
  top-level select loop and dispatch only

spawn.rs
  actor thread creation, readiness waiting, and handle construction

startup.rs
  ACP process/session startup orchestration after the actor thread is running

background_work.rs
  actor-side background work update handling
```

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

Target:

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

Target:

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

Target:

```text
actor/notifications/
  mod.rs
  types.rs
  handle.rs
  dispatch.rs
  replay_filter.rs
  plans.rs
```

Responsibilities:

```text
handle.rs
  ACP notification entrypoint

dispatch.rs
  route by notification kind: assistant, reasoning, tool, config, session info,
  usage, permission/input/MCP request, lifecycle

replay_filter.rs
  suppress provider replay/startup notifications that should not become new
  product events

plans.rs
  actor-side plan extraction hooks only while this remains coupled to live
  notification handling
```

Notification handlers should persist the raw ACP notification before normalized
event handling when the current invariant requires it.

Tool calls are not a separate actor subsystem unless they need one. They enter
as ACP notifications, route through notification dispatch, and are normalized
by `event_sink/tools.rs`.

## Interactions Folder

Target:

```text
actor/interactions/
  mod.rs
  types.rs
  handle.rs
  cleanup.rs
```

Responsibilities:

```text
handle.rs
  ResolveInteraction command entrypoint

cleanup.rs
  cancel/dismiss/shutdown cleanup for pending waits
```

The pending request broker itself belongs outside the actor:

```text
live/sessions/interactions/
```

Reason: `AcpClient` creates pending requests, API/runtime resolves them through
commands, and the actor cleans them up. The broker is a collaborator, not an
actor-internal module.

## Shutdown Folder

Target:

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

Target:

```text
live/sessions/driver/
  mod.rs
  types.rs
  start.rs
  process.rs
  native_session.rs
  stderr.rs
  shutdown.rs
```

Responsibilities:

```text
start.rs
  create an initialized ACP connection for this session launch

process.rs
  spawn and wire the provider process/stdin/stdout/stderr

native_session.rs
  new/load/fork native ACP session decisions and calls

stderr.rs
  stderr sanitization/classification

shutdown.rs
  provider/process close behavior that is not actor state-machine policy
```

The actor calls driver code during startup and shutdown, but driver code
owns the process/protocol resource mechanics.

For a full actor cleanup, driver extraction is in scope when the code is
currently embedded in `session_actor.rs`. The actor may keep policy decisions
such as "start a new native session vs load an existing native session" only
when that decision depends on actor phase or ordering. The process/protocol
mechanics belong in `live/sessions/driver/`.

Reusable ACP protocol or provider mechanics should move lower:

```text
integrations/acp/
integrations/agent_cli/
```

## Event Sink Boundary

The actor decides when something happened. The event sink decides how it becomes
durable and streamable.

Target:

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

Actor rewrite must preserve these:

```text
one actor owns one live ACP native session
actor is the only owner of busy/idle phase
prompt queue handoff is durable before executed pending prompt removal is emitted
ACP notifications are persisted raw before normalized event handling
config applies immediately only when idle; otherwise it queues
interaction cleanup runs on cancel, dismiss, close, and error
shutdown emits terminal session state exactly once
event sequence order is stable for SSE replay + live broadcast
actor never decides product MCP selection
actor never validates raw HTTP request shapes
```

## Migration Plan

This rewrite should be behavior-preserving and may be implemented in slices,
but the final PR state must be the full target shape above. Partial helper
extraction is not an acceptable endpoint.

Recommended order:

```text
1. Extract command/state/event-loop shell.
2. Extract turn start/active/finish/queue code.
3. Extract config apply/queue/persist code.
4. Extract notification dispatch/replay filtering.
5. Extract interaction resolution/cleanup commands.
6. Extract shutdown finalization.
7. Move process startup mechanics to live/sessions/driver.
8. Rename remaining RuntimeClient types only after behavior-preserving
   driver/client splits are stable.
```

Each slice should:

```text
preserve public command/result behavior
preserve event ordering
preserve existing tests or add focused characterization tests
delete the old code path
avoid unrelated topology moves
```

Do not combine actor behavior changes with broad `domains/` or `live/`
renames. The actor is the core loop; keep the migration reviewable.

## Acceptance Criteria

A full actor migration is accepted only when all of these are true:

```text
1. Opening live/sessions/actor/event_loop.rs shows the session engine event loop
   without reading prompt/config/notification/shutdown implementation details.

2. Idle and busy command behavior are explicit and separated.

3. Active turn handling lives under actor/turn/ and clearly shows start,
   active loop, finish, queued config application, and pending prompt drain.

4. Config apply-vs-queue behavior lives under actor/config/.

5. ACP notification dispatch lives under actor/notifications/ and delegates
   normalization to event_sink.

6. Actor-side interaction resolution and cleanup live under actor/interactions/.

7. Fork readiness, fork command handling, and native child-session close policy
   live under actor/fork/.

8. Background work update handling lives under actor/background_work.rs unless
   it grows enough to earn its own concern folder.

9. Cancel/close/dismiss/error finalization lives under actor/shutdown/.

10. ACP process/native-session startup mechanics no longer live in actor
   concern files; they live under live/sessions/driver/.

11. Product prompt preparation remains in domains/sessions/prompt.

12. Product MCP selection/injection remains in domains/sessions/mcp_bindings.

13. Event normalization, sequence assignment, persistence, and broadcast remain
    in `live/sessions/event_sink/**`.

14. The old acp/session_actor.rs implementation is gone.

15. Existing session behavior and event ordering are preserved by tests or
    focused characterization coverage.
```
