# AnyHarness Standards

Status: authoritative for AnyHarness runtime code in this repo.

Scope:

- `anyharness/crates/anyharness/**`
- `anyharness/crates/anyharness-credential-discovery/**`
- `anyharness/crates/anyharness-contract/**`
- `anyharness/crates/anyharness-lib/**`

Use this doc first to understand AnyHarness ownership. Then read the focused
guide or spec for the layer or subsystem you are changing.

## Overarching Architecture

AnyHarness is a runtime server for coding-agent work inside workspaces. The
central subsystem is the session engine: it creates, starts, resumes, prompts,
streams, controls, and records agent sessions.

The structure exists because AnyHarness has to keep four concerns separate:

- operate live ACP-backed agent sessions and their subprocesses
- expose APIs for sessions, workspaces, files, git, terminals, and process
  operations
- keep public over-the-wire contracts stable for SDKs and clients
- expose controlled agent extensions, especially product-owned MCP tools

These concerns change for different reasons and fail in different ways. Code is
organized around those boundaries, not around whichever HTTP route happens to
call it first.

### How To Think About The Boundaries

AnyHarness code falls into a small set of architectural divisions.

**Wire vs. runtime.** Public HTTP/SSE/WS shapes are the client contract. Runtime
internals may change; wire types should change deliberately and stay stable for
SDK consumers.

**Transport vs. behavior.** API code receives requests and returns responses.
It should translate between wire shapes and runtime calls. It should not become
the place where session, workspace, MCP, or agent behavior is defined.

**Durable vs. live.** Durable truth survives restart: session records, events,
workspace records, agent readiness facts, config snapshots, and product rules.
Live execution exists only in this process: ACP subprocesses, actors, handles,
streams, PTYs, and pending permission/user-input/MCP callbacks.

**Product meaning vs. local capability.** Domains decide what an operation
means in the product. Adapters perform focused local work such as reading
files, running git, opening hosting metadata, or executing a process.

**Product extension vs. protocol mechanics.** Product features own what their
tools do. Integration code owns how to speak MCP, ACP, or a provider CLI. A
shared MCP `tools/list` helper is protocol mechanics; a cowork or review tool
is product behavior.

**Composition vs. implementation.** App wiring constructs the runtime graph and
connects extension implementations. It should not contain the implementation
of those systems.

**Startup vs. runtime.** The binary starts the process, chooses runtime home,
initializes logging, and dispatches commands. Runtime behavior belongs behind
the library boundary.

**Credential discovery vs. readiness.** Credential discovery finds and
normalizes local provider auth material. Agent readiness and install policy are
runtime product decisions.

### Core Session Engine

The session engine bridges durable state and live execution.

```text
api/http/sessions
  -> domains/sessions/runtime::SessionRuntime
    -> domains/sessions/service::SessionService
    -> domains/sessions/store::SessionStore
    -> live/sessions::LiveSessionManager
      -> LiveSessionHandle
        -> SessionActor
          -> AcpClient
          -> SessionEventSink
          -> InteractionBroker
```

It owns these workflows:

- create durable session records
- resolve workspace, agent, model, mode, and launch config
- prepare launch payloads and prompt payloads
- start, resume, and close ACP-backed agent processes
- send prompts and live config changes to the running actor
- ingest ACP notifications
- normalize, persist, and broadcast session events
- broker permissions, user-input requests, and MCP elicitation

Role boundaries:

- `SessionRuntime` owns high-level session use cases.
- `SessionService` owns durable session rules.
- `SessionStore` owns SQL for session data.
- `LiveSessionManager` owns the live session registry and startup de-dupe.
- `SessionActor` owns one running session command loop.
- `AcpClient` owns low-level ACP request/notification I/O.
- `SessionEventSink` owns ACP notification normalization and persistence.
- `InteractionBroker` owns pending live interaction rendezvous.

### Runtime Capabilities Around The Engine

The engine depends on capabilities that are not themselves the engine.

```text
domains/workspaces
  workspace identity, paths, materialization, cleanup, retention

domains/agents
  agent catalog, readiness meaning, install/readiness policy

adapters/files
adapters/git
adapters/hosting
adapters/processes
  local workspace and machine operations

live/terminals
  PTY lifecycle, terminal handles, terminal event streams
```

Adapters perform local operations. Domains decide product meaning. Live systems
own running state.

### Product Domains And Extensions

Product features build on the core primitives:

```text
domains/cowork
domains/reviews
domains/plans
domains/mobility
domains/sessions/subagents
domains/sessions/workspace_naming
```

They should not fork session startup, prompt dispatch, or event ingestion. When
a product feature needs to participate in a session lifecycle, it plugs into a
core extension point and `app/` wires the implementation.

Example:

```text
domains/sessions/extensions::SessionExtension
  implemented by cowork, reviews, subagents, workspace naming
  wired by app/
  consumed by SessionRuntime at launch/prompt boundaries
```

### MCP Is A Vertical

MCP crosses layers. Do not put all MCP code in one folder.

```text
domains/sessions/mcp_bindings
  durable user-attached MCP server config and summaries

domains/<feature>/mcp
  product MCP tool behavior

integrations/mcp
  shared JSON-RPC, tool formatting, and capability-token scaffolding

live/sessions/interactions/mcp_elicitation
  live ACP interaction state

api/http
  HTTP endpoint wrapper for product MCP servers
```

Move protocol scaffolding to `integrations/mcp`. Keep product tool semantics in
the owning domain.

### Placement Questions

Use these questions before adding or moving code:

- Public wire shape? `anyharness-contract`, with API mapping in `api/`.
- HTTP/SSE/WS request handling? `api/`.
- Dependency construction? `app/`.
- Persisted product truth or durable rule? `domains/<domain>/`.
- Running process, actor, stream, handle, or pending callback? `live/`.
- Local file, git, hosting, or process operation? `adapters/`.
- Vendor/protocol mechanics? `integrations/`.
- SQLite setup or migrations? `persistence/`.
- Measurement/tracing helpers? `observability/`.
- Process startup? `anyharness`.

## Read Order

Always start here.

Guides define reusable engineering standards: where code goes, what each layer
may own, and which patterns are allowed.

Guides:

- [guides/system-architecture.md](guides/system-architecture.md) for the full
  AnyHarness source organization model: `api`, `app`, `domains`, `live`,
  `adapters`, `integrations`, `persistence`, and `observability`.
- [guides/crates.md](guides/crates.md) for crate ownership:
  `anyharness`, `anyharness-contract`, `anyharness-credential-discovery`, and
  `anyharness-lib`.
- [guides/api.md](guides/api.md) for HTTP/SSE/WS handler ownership, contract
  mapping, and transport-boundary rules.
- [guides/domains.md](guides/domains.md) for durable domains, the
  `model/store/service/runtime` shape, and product surface domains.
- [guides/live-runtime.md](guides/live-runtime.md) for managers, actors,
  handles, event sinks, brokers, and long-lived in-memory state.
- [guides/adapters.md](guides/adapters.md) for files, git, hosting, and
  process capabilities.
- [guides/integrations.md](guides/integrations.md) for MCP, ACP, agent CLI, and
  provider/protocol mechanics.
- [guides/harnesses.md](guides/harnesses.md) for provider-specific runtime
  behavior documented under `docs/anyharness/harnesses/**`.
- [guides/persistence.md](guides/persistence.md) for SQLite, stores,
  migrations, and transaction ownership.
- [guides/observability.md](guides/observability.md) for latency tracing,
  request measurements, and diagnostic helpers.
- [guides/repo-shape.md](guides/repo-shape.md) for file size thresholds,
  module style, and migration discipline.

Specs define subsystem behavior: lifecycle invariants, edge cases, and
verification for specific runtime flows.

Specs:

- [specs/session-engine.md](specs/session-engine.md) for the core session
  engine: `SessionRuntime`, live session manager, actor, ACP client, event
  sink, and interaction broker.
- [specs/session-actor.md](specs/session-actor.md) for the target
  `live/sessions/actor` state-machine split, actor-owned state, command
  handling, turn loop, config, notifications, interactions, and shutdown.
- [specs/agent-catalog-readiness.md](specs/agent-catalog-readiness.md) for
  the fully migrated agents domain: single catalog input, descriptor
  projection, install, credentials, readiness, seed artifacts, and launch
  resolution.
- [specs/mcp.md](specs/mcp.md) for user MCP bindings, product MCP servers,
  session extensions, capability tokens, and MCP elicitation.
- [specs/product-mcps.md](specs/product-mcps.md) for the repeatable product
  MCP server pattern: definition, auth, injection, context, tools, calls, UI
  exposure, and session MCP selection.
- [product-mcps/README.md](product-mcps/README.md) for the concrete product
  MCP definitions currently being standardized: subagents, artifacts, reviews,
  and workspace naming.

Existing subsystem docs under `docs/anyharness/src/**` remain valid during the
migration. Treat them as subsystem specs until they are moved or rewritten:

- [src/agents.md](src/agents.md)
- [src/acp.md](src/acp.md)
- [src/cowork-artifacts.md](src/cowork-artifacts.md)
- [src/files.md](src/files.md)
- [src/git.md](src/git.md)
- [src/persistence.md](src/persistence.md)
- [src/sessions.md](src/sessions.md)
- [src/workspaces.md](src/workspaces.md)

Harness docs cover provider-specific behavior. Read
[guides/harnesses.md](guides/harnesses.md) first when deciding whether a
provider rule belongs in a harness doc or an integration guide:

- [harnesses/claude.md](harnesses/claude.md)
- [harnesses/codex.md](harnesses/codex.md)

Also read:

- [contract.md](contract.md) if the change touches public transport schemas.

## Code Map

Use this map when starting from a file, task, or feature idea and deciding
which guide to read and where the code belongs.

| You are changing or building | Current common paths | Target owner | Read |
| --- | --- | --- | --- |
| Binary startup, CLI flags, runtime-home selection, command dispatch | `anyharness/crates/anyharness/src/**` | `anyharness` thin binary | [guides/crates.md](guides/crates.md) |
| Public HTTP/SSE/WS schemas, OpenAPI-visible request/response types | `anyharness-contract/src/v1/**` | `anyharness-contract` | [guides/crates.md](guides/crates.md), [contract.md](contract.md) |
| Provider credential file discovery or portable credential export/import | `anyharness-credential-discovery/src/**` | `anyharness-credential-discovery` | [guides/crates.md](guides/crates.md) |
| HTTP handlers, routers, auth headers, SSE/WS transport, OpenAPI wiring | `anyharness-lib/src/api/**` | `api/**` | [guides/api.md](guides/api.md) |
| AppState, dependency construction, wiring extension implementations | `anyharness-lib/src/app/**` | `app/**` | [guides/domains.md](guides/domains.md) |
| SQLite engine setup, migrations, DB pool wiring | `anyharness-lib/src/persistence/**` | `persistence/**` | [guides/persistence.md](guides/persistence.md) |
| Session durable records, event rows, session config, pending prompts | `anyharness-lib/src/sessions/**` | `domains/sessions/**` | [guides/domains.md](guides/domains.md), [specs/session-engine.md](specs/session-engine.md), [src/sessions.md](src/sessions.md) |
| Live running agent process, session actor loop, ACP client, event sink, interactions | `anyharness-lib/src/acp/**` | `live/sessions/**` plus earned `integrations/acp/**` | [guides/live-runtime.md](guides/live-runtime.md), [specs/session-engine.md](specs/session-engine.md), [src/acp.md](src/acp.md) |
| Workspace durable lifecycle, materialization, purge/retire, retention policy | `anyharness-lib/src/workspaces/**` | `domains/workspaces/**` | [guides/domains.md](guides/domains.md), [src/workspaces.md](src/workspaces.md) |
| Agent catalog, install, credentials, readiness, supported-agent meaning | `anyharness-lib/src/domains/agents/**` | `domains/agents/**` | [guides/domains.md](guides/domains.md), [specs/agent-catalog-readiness.md](specs/agent-catalog-readiness.md), [src/agents.md](src/agents.md) |
| Provider CLI install/probe/path/version mechanics | `anyharness-lib/src/integrations/agent_cli/**`, provider-specific ACP code | `integrations/agent_cli/**` | [guides/integrations.md](guides/integrations.md), [guides/harnesses.md](guides/harnesses.md) |
| Provider-specific behavior such as Claude/Codex extension support or live controls | `anyharness-lib/src/acp/**`, `docs/anyharness/harnesses/**` | harness doc plus owning runtime/integration module | [guides/harnesses.md](guides/harnesses.md), provider doc under `harnesses/**` |
| File browsing, file reads/writes, workspace file capabilities | `anyharness-lib/src/adapters/files/**` | `adapters/files/**` | [guides/adapters.md](guides/adapters.md), [src/files.md](src/files.md) |
| Git status/diff/branch operations and git command parsing | `anyharness-lib/src/adapters/git/**` | `adapters/git/**` | [guides/adapters.md](guides/adapters.md), [src/git.md](src/git.md) |
| Hosting and process helpers around local workspace capabilities | `anyharness-lib/src/adapters/hosting/**`, `anyharness-lib/src/adapters/processes/**` | `adapters/hosting/**`, `adapters/processes/**` | [guides/adapters.md](guides/adapters.md) |
| Terminal/PTTY lifecycle, terminal stream handles, terminal registry | `anyharness-lib/src/terminals/**` | `live/terminals/**` | [guides/live-runtime.md](guides/live-runtime.md) |
| MCP user bindings attached to a session | `anyharness-lib/src/sessions/mcp_bindings/**` | current `sessions/mcp_bindings/**`; final `domains/sessions/mcp_bindings/**` | [specs/mcp.md](specs/mcp.md), [guides/domains.md](guides/domains.md) |
| Product MCP tool servers for artifacts, reviews, subagents, workspace naming | `domains/cowork/**`, `domains/reviews/**`, `sessions/subagents/**`, `sessions/workspace_naming/**` | owning product domain | [specs/product-mcps.md](specs/product-mcps.md), [product-mcps/README.md](product-mcps/README.md), [guides/domains.md](guides/domains.md) |
| Shared MCP JSON-RPC, capability-token, tool-formatting scaffolding | `anyharness-lib/src/integrations/mcp/**` plus any remaining feature-local wrappers | `integrations/mcp/**` | [guides/integrations.md](guides/integrations.md), [specs/mcp.md](specs/mcp.md) |
| Cowork artifacts, delegation, or cowork-owned tools | `anyharness-lib/src/domains/cowork/**` | `domains/cowork/**` | [guides/domains.md](guides/domains.md), [src/cowork-artifacts.md](src/cowork-artifacts.md) |
| Reviews, plans, mobility, or repo-root product behavior | `domains/reviews/**`, `domains/plans/**`, `domains/mobility/**`, `repo_roots/**` | owning `domains/<domain>/**` | [guides/domains.md](guides/domains.md) |
| Latency tracing, request measurement, diagnostic ids | `observability/latency.rs` and scattered measurement helpers | `observability/**` | [guides/observability.md](guides/observability.md) |
| Splitting large files, moving modules, or creating new folders | any AnyHarness path | target layer from this table | [guides/repo-shape.md](guides/repo-shape.md) |

If a task appears to belong in two places, split by ownership. Example: a new
subagent MCP tool puts product behavior in `domains/sessions/subagents/**`,
shared JSON-RPC/capability helpers in `integrations/mcp/**`, and the HTTP route
adapter in `api/http/**`.

## Target Shape

This is the target architecture. Existing code is transitional in several
places. New code and cleanup work should move toward this structure.

```text
anyharness/crates/
  anyharness/
    src/                         # thin binary
  anyharness-contract/
    src/v1/                      # public wire schemas
  anyharness-credential-discovery/
    src/                         # shared provider credential discovery
  anyharness-lib/
    src/
      api/
        http/
        sse/
        ws/
        openapi.rs
        router.rs
      app/
        mod.rs                   # AppState composition root
      persistence/
      observability/
      domains/
        sessions/
        workspaces/
        agents/
        repo_roots/
        cowork/
        reviews/
        plans/
        mobility/
      live/
        sessions/
        terminals/
      adapters/
        files/
        git/
        hosting/
        processes/
      integrations/
        mcp/
        agent_cli/
        acp/                     # only when protocol mechanics earn it
      origin.rs
      lib.rs
```

Do not add new top-level AnyHarness folders without updating this doc and the
focused guide that owns the layer.

## Transitional State

The target shape is not fully implemented yet.

Current high-level mappings:

```text
current sessions/      -> target domains/sessions/
current workspaces/    -> target domains/workspaces/
current domains/agents/ -> target domains/agents/ plus integrations/agent_cli/
current repo_roots/    -> target domains/repo_roots/
current cowork/        -> target domains/cowork/
domains/reviews/      -> target domains/reviews/
domains/plans/        -> target domains/plans/
current mobility/      -> target domains/mobility/
current acp/           -> target live/sessions/ plus integrations/acp or mcp pieces
current terminals/     -> target live/terminals/
observability/latency.rs is the current owner for latency request context
and trace-field helpers.
```

Known transitional issues:

- Phase 1 topology moves are present: local file/git/hosting/process
  capabilities live under `adapters/**`, shared MCP helpers live under
  `integrations/mcp/**`, and provider CLI mechanics live under
  `integrations/agent_cli/**`.
- Product domain cleanup is partially present: agents, cowork, reviews, plans,
  and mobility live under `domains/**`; sessions, workspaces, repo roots, and
  terminals still use transitional top-level paths until the final topology
  rename phase.
- Session MCP assembly is split under `sessions/mcp_bindings/**`, including
  `assembly.rs`. The final `domains/sessions/**` path is still a target.
- `SessionRuntime` is split under `sessions/runtime/**`. The public
  `SessionRuntime` type remains the API-facing use-case surface.
- `SessionStore` is split under `sessions/store/**`. The public `SessionStore`
  type remains the caller-facing store surface.
- `SessionEventSink` is split under `acp/event_sink/**`. It has not moved to
  final `live/sessions/event_sink/**` topology yet.
- Latency helpers live under `observability/latency.rs`; lower layers should
  not import API transport modules for latency context.
- Contract request/response types leak below `api/`. Contract event payloads
  may be a deliberate durable event-log type, but other contract types should
  be mapped at the API boundary.
- The live session actor is split under `live/sessions/actor/**`,
  `live/sessions/connection/**`, and `live/sessions/handle.rs`. `AcpManager`,
  `RuntimeClient`, `InteractionBroker`, `BackgroundWorkRegistry`, and
  `replay_actor` remain transitional under `acp/**`.
- Some product MCP endpoint scaffolding may still be feature-local. Common
  protocol/auth scaffolding should use `integrations/mcp/`; product tool
  semantics stay with their owning domain.
- Some agent/provider CLI mechanics may still be mixed with agent
  catalog/readiness logic. Provider-specific process/install/probe behavior
  should move toward `integrations/agent_cli/`.

Cleanup work should preserve behavior, then move code to the target owner.
Do not leave duplicate old and new code paths after a migration.

## Hard Rules

- `anyharness` stays thin. It owns CLI/bootstrap only, not runtime behavior.
- `anyharness-contract` owns wire schemas only. It must not grow runtime logic.
- `anyharness-credential-discovery` owns shared provider credential parsing and
  portable auth-file normalization. It must not own runtime orchestration.
- `anyharness-lib` owns runtime behavior, durable domain rules, live
  orchestration, workspace adapters, and protocol integrations.
- `api/` is transport. It parses requests, calls the owning domain/runtime, and
  maps responses/errors.
- `app/` wires dependencies. `AppState` is not a place for business logic.
- `domains/` owns product concepts and durable business rules.
- `live/` owns long-lived in-memory actors, registries, handles, streams,
  subprocesses, and brokers.
- `adapters/` owns local workspace/machine capabilities such as file, git,
  hosting, and process operations.
- `integrations/` owns external protocol/vendor mechanics such as MCP, ACP
  protocol glue, and provider CLI quirks.
- `persistence/` owns SQLite setup, migrations, and DB wiring. Product stores
  own product-specific queries.
- `observability/` owns reusable latency/tracing/measurement helpers.
- Avoid generic catch-all modules such as `utils`, `helpers`, `misc`, or flat
  `services`.
- Keep imports direct and concrete. Do not add barrel files or convenience
  re-export modules unless a focused guide explicitly documents an exception.
- Delete dead runtime code instead of preserving parallel implementations.

## Dependency Direction

The intended dependency direction is:

```text
api -> domains/live/adapters/integrations for narrow transport/protocol wrappers
app -> everything for composition only
domains -> persistence/adapters/integrations/observability
live -> domains/integrations/observability
adapters -> observability and low-level filesystem/process/git crates
integrations -> external protocol/vendor crates and low-level helpers
persistence -> database crates only
```

Avoid these directions:

```text
domains -> api
live -> api
adapters -> domains
integrations -> domains
persistence -> domains
```

Core domains should not import product surface domains. When a product surface
needs to plug into a core lifecycle, use an extension point wired in `app/`.
For example, the session engine owns the `SessionExtension` trait; cowork,
reviews, subagents, and workspace naming implement it; `app` wires them into
`SessionRuntime`.
