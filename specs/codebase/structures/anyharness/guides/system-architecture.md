# AnyHarness System Architecture

Status: draft architecture reference for AnyHarness source organization.

This document defines where AnyHarness code belongs and how folders should
grow. It is intentionally about organization and ownership.

## Top-Level Shape

```text
anyharness-lib/src/
  api/
  app/
  domains/
  live/
  adapters/
  integrations/
  persistence/
  observability/
```

Use these boundaries when placing code:

```text
api
  Owns transport only.
  Parse HTTP/SSE/WS requests, authenticate, acquire route-level leases, call
  domain/runtime/live APIs, and map results/errors into contract responses.
  Do not put product workflows, SQL, actor loops, MCP tool behavior, or
  install policy here.

app
  Owns composition only.
  Construct AppState, create stores/services/runtimes/managers, wire session
  extensions, pass shared config such as runtime_home and auth tokens.
  Register product MCP endpoint servers. Do not implement product behavior
  here.

domains
  Owns product concepts.
  Define product records, durable SQL stores, durable rules, and high-level
  use cases. Decide what a session/workspace/agent/review/plan means, what
  state is valid, and when a product action is allowed.
  Runtime files may command live systems; service files should stay durable.

live
  Owns currently running state.
  Manage actors, handles, process clients, PTYs, broadcast channels, pending
  interactions, startup de-dupe, and stream fanout. Reconstruct from durable
  domain state after restart. Do not decide product policy.

adapters
  Owns local machine capabilities.
  Read/write/list files, run git commands, spawn helper processes, call hosting
  CLIs, drive browser/computer-use primitives, and parse local command output.
  Do not own product SQL, session/workspace lifecycle, or UI/API policy.

integrations
  Owns protocol/vendor mechanics.
  Encode/decode MCP or ACP messages, normalize provider errors, discover or
  launch provider CLIs, format tool results, and implement reusable auth/token
  primitives. Do not know product concepts such as reviews or subagents.

persistence
  Owns storage infrastructure.
  Manage SQLite connection setup, migrations, and generic transaction helpers.
  Do not put domain table queries or product row mapping here.

observability
  Owns diagnostics infrastructure.
  Provide tracing, measurements, counters, latency spans, and debug helpers.
  Do not alter product behavior.
```

Do not organize code by whichever route happened to call it first. Organize by
ownership.

## Dependency Direction

Preferred direction:

```text
api -> domains
api -> live handles/managers when transport must stream or subscribe

app -> everything

domains/runtime -> domains/service + live + adapters + other domains
domains/service -> domains/store + domain models
domains/store -> persistence

live -> domains/store or narrow persistence capabilities
live -> integrations

domains -> adapters
domains -> integrations

integrations -> no product domains
adapters -> no product domains
```

`app/` is the composition root and may know about everything. Most other code
should not import `app/`.

## Crate Root Support Files

The top-level `anyharness-lib/src` files are not all architectural layers.

Expected root-level files:

```text
lib.rs
  crate module declarations and intentional exports

origin.rs
  small shared provenance/origin value types

process_env.rs
  small private process/environment helpers
```

Treat these as crate-root support modules, not as a license to create more
global buckets. If a root file grows into product meaning, live state,
protocol/vendor mechanics, local-machine capability, or DB infrastructure,
move it into the owning layer.

`origin.rs` is advisory provenance, not authority. It may describe where a
request/session/workspace came from. It should not decide auth, ownership,
billing, mutability, or sandbox policy.

## Domains

Domains own product concepts with durable records, rules, and use cases. A
domain is not created because an HTTP route exists; it is created because the
product has a concept that must be validated, stored, listed, resumed,
summarized, or coordinated.

Put code in `domains/<domain>/` when it answers questions like:

```text
What records represent this product concept?
Which state transitions are valid?
What durable data must be read or written?
Which live/adapters/other domains must be coordinated to perform this use case?
What should callers receive as the domain-level result or error?
```

Do not put code in a domain when it only answers:

```text
How do I parse an HTTP request?
How do I spawn a process?
How do I run git?
How do I format JSON-RPC?
How do I keep an actor loop alive?
```

Examples:

```text
domains/sessions
domains/workspaces
domains/agents
domains/terminals
domains/plans
domains/reviews
domains/cowork
domains/mobility
domains/repo_roots
```

Default small domain:

```text
domains/<domain>/
  mod.rs
  model.rs
  store.rs
  service.rs
```

Add `runtime.rs` only when the domain orchestrates live state, adapters, or
other domains.

Responsibilities:

```text
model.rs
  domain-owned product records, enums, internal data types

store.rs or store/
  raw domain SQL, row mapping, transactions

service.rs or service/
  durable product operations over store data

runtime.rs or runtime/
  high-level use cases that cross durable/live/adapters/domain boundaries

mod.rs
  module declarations and intentional exports
```

### Store, Service, Runtime

Use this distinction:

```text
store
  DB mechanics for this domain

service
  durable product rules

runtime
  running use cases that may command live systems
```

For sessions:

```text
SessionStore
  SQL for sessions, events, config snapshots, pending prompts, attachments

SessionService
  durable session rules: create, read, list, title, summaries, validation

SessionRuntime
  session use cases: create-and-start, prompt, resume, fork, config, cancel
```

### Domain Growth

There are two valid promotions: layer promotion and feature promotion. Pick the
one that matches the reason the code is growing.

### Layer Promotion

Promote a layer file when the file is large because one layer has many
operation families. The folder name remains the layer name, and children split
by operation/data family.

Use layer promotion when the answer is yes:

```text
Is this still one kind of work?
Are all children still store operations, service operations, or runtime
workflows?
Would moving a child out of this layer hide the fact that it is still SQL,
durable rules, or live orchestration?
```

`store/` children are table/query families:

```text
store.rs -> store/
  mod.rs
  sessions.rs
  events.rs
  pending_prompts.rs
  attachments.rs
  live_config.rs
```

`service/` children are durable rule/use-case families:

```text
service.rs -> service/
  mod.rs
  creation.rs
  listing.rs
  titles.rs
  config.rs
```

`runtime/` children are high-level workflow families:

```text
runtime.rs -> runtime/
  mod.rs
  creation.rs
  prompt.rs
  config.rs
  fork.rs
  interactions.rs
```

Inside a promoted layer folder:

```text
mod.rs
  module declarations and narrow public exports

<operation>.rs
  one operation family or data family

tests.rs or tests/
  tests for that layer/folder
```

Do not name children:

```text
helpers.rs
utils.rs
logic.rs
misc.rs
manager.rs     # unless it truly owns live in-memory lifecycle
processor.rs   # too vague without a narrower qualifier
```

### Feature Promotion

Promote a named feature folder when a product concept has its own identity
inside the larger domain.

Use feature promotion when any answer is yes:

```text
Does this concept have its own model/store/service stack?
Does it have its own lifecycle or background reconciliation?
Does it expose an MCP server or session extension?
Would product docs explain it as a named capability?
Do its tests naturally group around the concept rather than around store or
service mechanics?
```

Feature folder examples:

```text
domains/sessions/links/
  mod.rs
  model.rs
  store.rs
  service.rs
```

```text
domains/workspaces/retirement/
  mod.rs
  policy.rs
  preflight.rs
  purge.rs
```

Inside a feature folder, use the same domain grammar when it applies:

```text
<feature>/
  mod.rs
  model.rs
  store.rs
  service.rs
  runtime.rs     # only if this feature crosses into live/adapters/other domains
```

### Choosing Between Them

Choose layer promotion when a file is large but still one layer:

```text
domains/sessions/store.rs is large because it owns sessions, events, attachments,
pending prompts, and live config SQL.

Promote to:
  domains/sessions/store/{sessions,events,attachments,pending_prompts,live_config}.rs
```

Choose feature promotion when the concept has its own product identity:

```text
domains/sessions/links owns link records, link service behavior, completions, and
tests.

Promote to:
  domains/sessions/links/{model,store,service,completions}.rs
```

Do not create a feature folder just to shrink a file:

```text
Bad:
  domains/sessions/title/{store,service}.rs

Better:
  domains/sessions/service/titles.rs
  domains/sessions/store/sessions.rs
```

Do not add:

```text
rules/
utils/
helpers/
misc/
common/
```

Put pure logic next to the concept it serves:

```text
workspaces/retirement/policy.rs
domains/sessions/config/selection.rs
agents/catalog/validation.rs
```

## Live Runtime

`live/` owns process-lived systems. These systems are reconstructed after an
AnyHarness restart from domain state, config, and external resources. They are
not the durable product truth.

Put code in `live/` when it answers questions like:

```text
Which instances are running right now?
How do commands reach one running instance?
How do we subscribe to live events?
How do we sequence events while an actor is busy?
How do we manage a subprocess, PTY, sidecar, browser, or long-lived stream?
How do we hold a pending request until a later API call resolves it?
```

Examples of live-owned state:

```text
actor tasks
command channels
broadcast channels
live handles
PTY handles
subprocess clients
pending interaction waiters
startup de-dupe maps
watcher tasks
```

Do not put code in `live/` when it decides product policy, owns product SQL,
or defines public wire shapes. Those belong to `domains/`, `domains/*/store`,
and `anyharness-contract`/`api`.

Likely live systems:

```text
live/sessions/
live/terminals/
live/browsers/     # future
live/workers/      # future local worker/dispatch state if owned here
```

Default live system:

```text
live/<system>/
  mod.rs
  manager.rs or manager/
  handle.rs
  actor/              # optional, private serialized coordinator
  driver/             # optional, private external backing mechanism
  sink/               # optional, sequenced event write path
  output_sink/        # optional terminal-style stream write path
  rendezvous/         # optional pending live rendezvous
  background_work/    # optional provider/runtime long-running work
  snapshot/           # optional read projection
  replay/             # optional replay/subscription mechanics
```

Responsibilities:

```text
manager.rs or manager/
  registry, lifecycle, startup de-dupe, and lookup for many live instances

handle.rs
  the only public command/subscription/snapshot port for one live instance

actor/
  private serialized mutation and ordering loop for one live instance

driver/
  external mechanism that makes the live resource real: ACP client,
  subprocess, PTY, browser driver, remote provider, or protocol client

sink/ or output_sink/
  normalized, sequenced write path into durable/broadcast/live streams

rendezvous/
  pending request-id to waiter/resolution state for live callbacks

background_work/
  live tracking for provider/runtime work with its own external identity

snapshot/ or projection/
  optional read model when snapshots become more than a cheap handle field

replay/
  optional replay stream/filter logic when it is substantial

mod.rs
  module declarations and narrow intentional exports
```

Only create a `live/<system>/` folder when there is a real long-lived runtime
object: a manager, actor, handle, PTY, sidecar, watcher, stream registry, or
pending interaction rendezvous. A domain workflow that merely starts a session
does not earn a `live/` folder.

Not every live resource needs every role. The minimum shape is whatever keeps
the live identity legible. A one-shot command runner may only need a handle
and a process driver. A session needs the full manager/handle/actor/driver/event
pipeline. A future browser may be a composite resource with browser, context,
and page live identities.

Public surface rule:

```text
Outside live/<resource>/:
  may use Live<Resource>Manager
  may use Live<Resource>Handle
  may use public live result/snapshot/event types

Outside live/<resource>/:
  must not construct actor commands
  must not import actor internals
  must not import driver internals
  must not import event sink internals
```

The handle is the command facade. Code outside the live resource may hold a
handle, call handle methods, subscribe through it, and read snapshots through
it. Only the handle should construct actor commands or send on the actor
mailbox.

Naming rules:

```text
manager = many live instances
handle  = one live instance public port
actor   = private serialized coordinator for one live instance
driver  = private external backing mechanism
sink    = sequenced event/output write path
rendezvous = pending live interaction rendezvous
snapshot = read projection published by the actor/handle
```

Do not use `service.rs`, `runtime.rs`, or `store.rs` inside `live/` unless
there is a very specific reason. Those names usually belong to `domains/`.

### Live Sessions

Target shape:

```text
live/sessions/
  mod.rs
  model.rs            # the live vocabulary (SessionLaunch, SessionHooks, …)
  manager/
  handle.rs

  actor/
  driver/
  sink/
  rendezvous/
  background_work/
  snapshot/
  replay/
```

Ownership:

```text
manager/
  live session registry and startup de-dupe

handle.rs
  command/subscription/snapshot port used by SessionRuntime and API stream code

actor/
  idle/busy routing, turn loop, queued prompt/config behavior,
  notification dispatch, shutdown decisions

driver/
  ACP process/connection lifecycle: spawn, stdio, initialize, authenticate,
  new/load/fork native session, stderr; the InboundDoor (driver/inbound/)
  receives agent-initiated traffic

sink/
  event normalization, sequence assignment, persistence, broadcast
  (one ingestion entry: sink.ingest)

rendezvous/
  permission/user-input/MCP pending request rendezvous

background_work/
  long-running tool/background task tracking
```

The current tree uses `live/sessions/driver/**` for the driver role.

The actor coordinates these collaborators, but it should not own all their
implementation code. Actor handlers are thin: they decide ordering, validate
the live phase, update actor-owned state, and delegate to driver/sink/
rendezvous/background-work helpers.

Use this boundary:

```text
actor/
  What should this live session do next?

sibling/collaborator under live/sessions/
  How does this live session resource/collaborator work?
```

### Actor Concern Folder Grammar

Inside an actor concern folder, use consistent names:

```text
actor/<concern>/
  mod.rs
  types.rs
  handle.rs
```

Add only when needed:

```text
apply.rs
  live/protocol state changes

queue.rs
  deferred work

persist.rs
  durable/sink writes

finish.rs
  terminal cleanup for a flow

diagnostics.rs
  tracing/debug timeout logic
```

Session actor target:

```text
live/sessions/actor/
  mod.rs
  command.rs
  state.rs
  run.rs

  turn/
    mod.rs
    types.rs
    handle.rs
    start.rs
    active.rs
    queue.rs
    finish.rs
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
    observations.rs

  shutdown/
    mod.rs
    types.rs
    handle.rs
    cleanup.rs
    persist.rs
```

The top loop should read as dispatch:

```text
command received       -> command/turn/config/interactions/shutdown handler
ACP notification       -> notification handler
background work update -> background work handler
shutdown               -> finalization
```

Negative actor rules:

```text
actor/ must not inline external process/protocol mechanics
actor/ must not inline event normalization/persistence
actor/ must not decide durable product policy
actor/ must not expose its command enum outside the live resource
driver/ must not import api/app or product stores/services
sink/ must be the only sequenced event writer for that resource
```

## Adapters

Adapters are local machine/workspace capabilities. They know how to perform an
operation against the local environment, not why the product wants it.

Put code in `adapters/` when it answers questions like:

```text
How do I safely read this path?
How do I run this git command and parse the output?
How do I spawn this process with the right env?
How do I call this hosting CLI and normalize its output?
How do I drive a local browser/computer-use primitive?
```

Do not put code in `adapters/` when it answers:

```text
Should this workspace be retired?
Should this session be allowed to read files?
Should this review run use this diff?
Which API response should the client see?
```

Examples:

```text
adapters/files/
adapters/git/
adapters/processes/
adapters/hosting/
adapters/browser/      # future
```

Allowed:

```text
filesystem access
path safety checks
process spawning
git commands
hosting CLI calls
browser automation primitives
parsing command output
capability-specific caches
```

Banned:

```text
durable product SQL
session/workspace lifecycle decisions
calling domain services to decide product policy
event fanout
API response shaping
```

Default adapter:

```text
adapters/<capability>/
  mod.rs
  types.rs
  executor.rs      # optional
  service.rs       # optional, rare
  operations/
    <operation>.rs
```

Use `operations/**` as the normal implementation home. Split by local
capability family:

```text
adapters/git/operations/
  status.rs
  diff.rs
  branches.rs
  commit.rs

adapters/files/operations/
  list.rs
  read.rs
  write.rs
  delete.rs
```

`types.rs` holds adapter-owned input/output/error vocabulary shared by
operations or callers. `executor.rs` is optional and should wrap one repeated
low-level mechanism such as `git`, `gh`, or a subprocess runner. `service.rs`
is rare; use it only when the adapter has meaningful shared state or a stable
facade over many operations.

Use free functions by default. Use a struct only when it holds dependencies,
cache, config, subprocess state, or test-injectable behavior.

Good as functions:

```text
read_workspace_file(root, path)
parse_git_status(output)
build_safe_path(root, relative_path)
```

Good as structs:

```text
WorkspaceFileSearchCache
ProcessService
BrowserSessionController
```

If a struct has no fields, it probably should be a function.

## Integrations

Integrations are reusable protocol/vendor mechanics. They answer:

```text
How does this protocol/vendor work?
How do we translate raw external shape into reusable internal capability?
```

They do not answer:

```text
Should this be enabled for this workspace/session/team?
What product object does this create?
How should this appear in the UI?
```

Use `integrations/` for reusable mechanics that would still make sense if the
product feature were removed. If the file name wants a product noun such as
`reviews`, `cowork`, `subagents`, `sessions`, or `workspace_naming`, it almost
certainly belongs in a domain.

Canonical integration:

```text
integrations/<integration>/
  mod.rs
  types.rs          # optional external/vendor vocabulary
  protocol.rs       # optional wire constants/types/conversions
  auth.rs           # optional protocol/vendor auth mechanics
  client.rs         # optional outbound client mechanics
  server/           # optional inbound server/dispatch mechanics
  cli/              # optional vendor CLI dialect mechanics
  registry.rs       # optional external registry/schema mechanics
  parsing.rs        # optional shared parsers
```

Not every integration needs every role. Split by external contract mechanics,
not by product feature.

Examples:

```text
integrations/mcp/
  JSON-RPC, tool formatting, capability-token primitive,
  product MCP dispatcher scaffolding

integrations/acp/
  reusable ACP protocol helpers and provider error normalization; not the
  live session actor/driver lifecycle

integrations/agent_cli/
  executable lookup, launcher scripts, provider CLI command mechanics
```

Move common protocol/vendor scaffolding here. Do not move product behavior
here.

Example:

```text
integrations/mcp
  knows how MCP JSON-RPC works

domains/reviews/mcp
  knows what review MCP tools do

domains/sessions/mcp_bindings
  knows which MCPs are attached to a session
```

Dependency rule:

```text
integrations/ may depend on std, protocol crates, HTTP/process/fs helpers,
and small shared utilities.

integrations/ must not depend on domains/, live/, api/, app/, or product
stores/services/runtimes.
```

## API

`api/` is transport.

Allowed:

```text
parse path/query/body
authenticate
authorize at transport boundary
call domain/runtime/live handle methods
map errors to HTTP responses
map domain/live data to contract response types
build SSE/WS streams from domain/live subscriptions
```

Banned:

```text
business workflows
raw product SQL
actor loop logic
product MCP tool logic
agent install policy
workspace/session lifecycle policy
```

If an API handler grows beyond transport work, move the behavior to a domain
service/runtime or a live system.

API handlers should read in this order:

```text
extract request
authenticate/authorize transport-level access
call one domain/runtime/live capability
map result/error
return contract response
```

If a handler contains multi-step product sequencing, product validation that is
not transport-specific, or direct SQL, the code is in the wrong layer.

## App

`app/` is the composition root.

It may know about everything because it builds the dependency graph:

```text
stores
services
runtimes
live managers
session extensions
adapters
catalogs
auth helpers
```

It exists because AnyHarness has process-specific state that should be
constructed once and shared deliberately: DB handles, runtime home, bearer
token, live managers, operation gates, session extensions, product MCP endpoint
registry, and startup tasks. Do not replace this with imported singletons.

It should not implement business behavior. If `AppState::new` becomes too
large, split wiring by system:

```text
app/sessions.rs
app/workspaces.rs
app/agents.rs
app/product_extensions.rs
app/product_mcp.rs
app/startup_tasks.rs
```

Those files still only wire dependencies.

`app/` code should read as construction:

```text
create store
create service
create runtime
create live manager
wire extension implementation
register product MCP endpoint server
store in AppState
```

If `app/` contains a branch that decides product behavior for a session,
workspace, MCP, review, or agent, move that branch to the owning domain.

## Persistence

`persistence/` owns generic SQLite infrastructure:

```text
connection/pool
migration runner
generic transaction helpers
custom migration framework
```

Product SQL belongs in:

```text
domains/<domain>/store/
```

Do not put `SELECT * FROM sessions` style queries in `persistence/`.

## Observability

`observability/` owns generic diagnostics:

```text
tracing helpers
latency measurement
debug measurement
diagnostic classification
```

It should not change product behavior.

## Structs vs Functions

Use free functions for:

```text
pure transforms
local operations with explicit inputs
stateless parsing/validation
```

Use structs when they hold stable dependencies:

```text
stores hold DB handles
services hold stores/collaborators
runtimes hold services/live managers/adapters
managers hold live registries
actors hold live state machines
adapters hold caches/config/subprocess state only when needed
```

This is Rust-style dependency injection:

```text
AppState wires once
service/runtime structs narrow the dependency surface
methods take per-call input
pure helpers stay free functions
```

Do not pass `AppState` deep into product logic. That turns it into a service
locator and erases ownership.

## Banned Generic Buckets

Avoid:

```text
utils.rs
helpers.rs
common.rs
misc.rs
logic.rs
stuff.rs
```

When a name is hard, stop and identify the owning concept. The path should tell
a reader what the file is allowed to do.

## Migration Principle

Move one ownership boundary at a time.

Good:

```text
Split domains/sessions/store.rs into store/{sessions,events,pending_prompts}.rs
without changing behavior.
```

Bad:

```text
Move files, rename types, change session behavior, and alter API responses in
one PR.
```

After a split lands, block the old flat path from returning and delete the old
code path in the same change.
