# AnyHarness Standards

Scope:

- `anyharness/crates/anyharness/**`
- `anyharness/crates/anyharness-credential-discovery/**`
- `anyharness/crates/anyharness-contract/**`
- `anyharness/crates/anyharness-lib/**`
- `anyharness/crates/proliferate-diagnostics-collector/**`
- `anyharness/crates/proliferate-diagnostics-protocol/**`

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
          -> driver (ACP connection; InboundDoor for inbound traffic)
          -> SessionEventSink
          -> InteractionRendezvous
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
- The driver owns the ACP process/connection; its `InboundDoor` receives
  agent-initiated requests and notifications.
- `SessionEventSink` owns ACP notification normalization and persistence
  (one ingestion entry: `sink.ingest`).
- `InteractionRendezvous` owns pending live interaction rendezvous.

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

### Feature Domains And Extensions

Product features build on the core primitives:

```text
domains/cowork
domains/reviews
domains/plans
domains/mobility
domains/workflows
domains/sessions/subagents
```

They should not fork session startup, prompt dispatch, or event ingestion. When
a product feature needs to participate in a session lifecycle, it plugs into a
core extension point and `app/` wires the implementation.

Example:

```text
domains/sessions/extensions::SessionExtension
  implemented by cowork, reviews, subagents
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

live/sessions/rendezvous/mcp_elicitation
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

- [mental-model.md](mental-model.md) for the lens that makes the
  other guides cohere: the eight jobs, the use-case pipeline
  (resolve -> decide -> execute), the mapping and error doctrines, the
  parameter test, proportionality, and the placement algorithm.
- [crates.md](crates.md) for crate ownership:
  `anyharness`, `anyharness-contract`, `anyharness-credential-discovery`, and
  `anyharness-lib`, plus the Desktop-owned provider-neutral diagnostics
  protocol crate.
- [api.md](api.md) for HTTP/SSE/WS handler ownership, contract
  mapping, and transport-boundary rules.
- [app.md](app.md) for `AppState`, dependency construction,
  session extension wiring, product MCP endpoint registration, and why
  AnyHarness uses explicit composition instead of singletons.
- [domains.md](domains.md) for durable domains, the
  `model/store/service/runtime` shape, and product surface domains.
- [live-runtime.md](live-runtime.md) for managers, handles,
  actors, drivers, event sinks, interaction rendezvous, and long-lived
  in-memory state.
- [adapters.md](adapters.md) for files, git, hosting, and
  process capabilities.
- [integrations.md](integrations.md) for MCP, ACP, agent CLI, and
  provider/protocol mechanics.
- [harnesses.md](harnesses.md) for provider-specific runtime
  behavior documented under `specs/anyharness/harnesses/**`.
- [persistence-stores.md](persistence-stores.md) for store shape, SQL
  ownership, and transaction ownership.
- [observability.md](observability.md) for latency tracing,
  request measurements, and diagnostic helpers.
- [repo-shape.md](repo-shape.md) for file size thresholds,
  module style, and migration discipline.

Specs define subsystem behavior: lifecycle invariants, edge cases, and
verification for specific runtime flows.

Specs:

- [session-engine.md](session-engine.md) for the core session
  engine: `SessionRuntime`, live session manager, actor, driver, event
  sink, and interaction rendezvous.
- [session-actor.md](session-actor.md) for the target
  `live/sessions/actor` state-machine split, actor-owned state, command
  handling, turn loop, config, notifications, interactions, and shutdown.
- [../codebase/platforms/product/agent-distribution.md](../codebase/platforms/product/agent-distribution.md) for
  the agents catalog/readiness model: single catalog input, trusted
  descriptor/model projection, install/readiness topology, seed artifacts, and
  launch resolution.
- [../codebase/platforms/product/mcp-runtime.md](../codebase/platforms/product/mcp-runtime.md) for user MCP bindings, product MCP servers,
  session extensions, capability tokens, and MCP elicitation.
- [../codebase/platforms/product/agent-features/servers.md](../codebase/platforms/product/agent-features/servers.md) for the repeatable product
  MCP server pattern: definition, auth, injection, context, tools, calls, UI
  exposure, and session MCP selection.
- [../codebase/platforms/product/agent-features/definitions/README.md](../codebase/platforms/product/agent-features/definitions/README.md) for the concrete product
  MCP definitions currently being standardized: subagents, artifacts, and
  reviews.

Subsystem docs at the top level of `specs/anyharness/**` own
behavior for runtime areas that do not yet have a focused guide or spec:

- [agents.md](agents.md)
- [acp.md](acp.md)
- [../codebase/systems/product/agents/cowork-artifacts.md](../codebase/systems/product/agents/cowork-artifacts.md)
- [files.md](files.md)
- [git.md](git.md)
- [persistence-database.md](persistence-database.md)
- [sessions.md](sessions.md)
- [workspaces.md](workspaces.md)

Harness docs cover provider-specific behavior. Read
[harnesses.md](harnesses.md) first when deciding whether a
provider rule belongs in a harness doc or an integration guide:

- [harnesses/claude.md](harnesses/claude.md)
- [harnesses/codex.md](harnesses/codex.md)
- [harnesses/grok.md](harnesses/grok.md)

Also read:

- [contract.md](contract.md) if the change touches public transport schemas.
- [architecture.md](architecture.md) for the plane-level view of what AnyHarness
  owns versus Cloud, Desktop, Worker, and Supervisor, and how a session request
  travels the runtime.
- [agent-mode-matrix.md](agent-mode-matrix.md) for which permission/approval
  modes each provider supports and how they map onto ACP.
- [workspace-command-environment.md](workspace-command-environment.md) for the
  environment AnyHarness assembles for commands running in a workspace:
  precedence layers, the protected `PROLIFERATE_*` metadata, and propagation.

## Code Map

Use this map when starting from a file, task, or feature idea and deciding
which guide to read and where the code belongs.

| You are changing or building | Paths | Owner | Read |
| --- | --- | --- | --- |
| Binary startup, CLI flags, runtime-home selection, command dispatch | `anyharness/crates/anyharness/src/**` | `anyharness` thin binary | [crates.md](crates.md) |
| Public HTTP/SSE/WS schemas, OpenAPI-visible request/response types | `anyharness-contract/src/v1/**` | `anyharness-contract` | [crates.md](crates.md), [contract.md](contract.md) |
| Provider-neutral Desktop diagnostics wire types, bounds, and pure validation | `proliferate-diagnostics-protocol/src/v1/**` | `proliferate-diagnostics-protocol` | [crates.md](crates.md), [../OBSERVABILITY.md](../OBSERVABILITY.md) |
| Standalone loopback diagnostics collection, bounded in-memory state, query/tail/export/health transport, and process resource profiling | `proliferate-diagnostics-collector/src/**` | `proliferate-diagnostics-collector` | [crates.md](crates.md), [../OBSERVABILITY.md](../OBSERVABILITY.md), [collector README](../../anyharness/crates/proliferate-diagnostics-collector/README.md) |
| Provider credential file discovery or portable credential export/import | `anyharness-credential-discovery/src/**` | `anyharness-credential-discovery` | [crates.md](crates.md) |
| HTTP handlers, routers, auth headers, SSE/WS transport, OpenAPI wiring | `anyharness-lib/src/api/**` | `api/**` | [api.md](api.md) |
| AppState, dependency construction, wiring extension implementations, product MCP endpoint registration | `anyharness-lib/src/app/**` | `app/**` | [app.md](app.md) |
| SQLite engine setup, migrations, DB pool wiring | `anyharness-lib/src/persistence/**` | `persistence/**` | [persistence-database.md](persistence-database.md) |
| Session durable records, event rows, session config, pending prompts | `anyharness-lib/src/domains/sessions/**` | `domains/sessions/**` | [domains.md](domains.md), [session-engine.md](session-engine.md), [sessions.md](sessions.md) |
| Live running agent process, session actor loop, ACP client, event sink, interactions | `anyharness-lib/src/live/sessions/**`, with remaining ACP helpers in `anyharness-lib/src/integrations/acp/**` | `live/sessions/**` plus `integrations/acp/**` | [live-runtime.md](live-runtime.md), [session-engine.md](session-engine.md), [acp.md](acp.md) |
| Workspace durable lifecycle, materialization, purge/retire, retention policy | `anyharness-lib/src/domains/workspaces/**` | `domains/workspaces/**` | [domains.md](domains.md), [workspaces.md](workspaces.md) |
| Agent catalog, install, credentials, readiness, supported-agent meaning | `anyharness-lib/src/domains/agents/**` | `domains/agents/**` | [domains.md](domains.md), [../codebase/platforms/product/agent-distribution.md](../codebase/platforms/product/agent-distribution.md), [agents.md](agents.md) |
| Provider CLI install/probe/path/version mechanics | `anyharness-lib/src/integrations/agent_cli/**`, provider-specific ACP code | `integrations/agent_cli/**` | [integrations.md](integrations.md), [harnesses.md](harnesses.md) |
| Provider-specific behavior such as Claude/Codex extension support or live controls | `anyharness-lib/src/live/sessions/**`, `anyharness-lib/src/integrations/acp/**`, `specs/anyharness/harnesses/**` | harness doc plus owning live runtime/integration module | [harnesses.md](harnesses.md), provider doc under `harnesses/**` |
| File browsing, file reads/writes, workspace file capabilities | `anyharness-lib/src/adapters/files/**` | `adapters/files/**` | [adapters.md](adapters.md), [files.md](files.md) |
| Git status/diff/branch operations and git command parsing | `anyharness-lib/src/adapters/git/**` | `adapters/git/**` | [adapters.md](adapters.md), [git.md](git.md) |
| Hosting and process helpers around local workspace capabilities | `anyharness-lib/src/adapters/hosting/**`, `anyharness-lib/src/adapters/processes/**` | `adapters/hosting/**`, `adapters/processes/**` | [adapters.md](adapters.md) |
| Terminal durable records, PTY lifecycle, terminal stream handles, terminal registry | `anyharness-lib/src/domains/terminals/**`, `anyharness-lib/src/live/terminals/**` | durable `domains/terminals/**` plus live `live/terminals/**` | [live-runtime.md](live-runtime.md) |
| MCP user bindings attached to a session | `anyharness-lib/src/domains/sessions/mcp_bindings/**` | `domains/sessions/mcp_bindings/**` | [../codebase/platforms/product/mcp-runtime.md](../codebase/platforms/product/mcp-runtime.md), [domains.md](domains.md) |
| Product MCP tool servers for artifacts, reviews, subagents | `domains/cowork/**`, `domains/reviews/**`, `domains/sessions/subagents/**` | owning product domain | [../codebase/platforms/product/agent-features/servers.md](../codebase/platforms/product/agent-features/servers.md), [../codebase/platforms/product/agent-features/definitions/README.md](../codebase/platforms/product/agent-features/definitions/README.md), [domains.md](domains.md) |
| Shared MCP JSON-RPC, capability-token, tool-formatting scaffolding | `anyharness-lib/src/integrations/mcp/**` plus any remaining feature-local wrappers | `integrations/mcp/**` | [integrations.md](integrations.md), [../codebase/platforms/product/mcp-runtime.md](../codebase/platforms/product/mcp-runtime.md) |
| Artifact durable model, manifest, protection, or runtime behavior | `anyharness-lib/src/domains/artifacts/**` | `domains/artifacts/**` | [domains.md](domains.md) |
| Cowork artifacts, delegation, or cowork-owned tools | `anyharness-lib/src/domains/cowork/**` | `domains/cowork/**` | [domains.md](domains.md), [../codebase/systems/product/agents/cowork-artifacts.md](../codebase/systems/product/agents/cowork-artifacts.md) |
| Session link graph: subagent, cowork, review-agent, fork relationships | `anyharness-lib/src/domains/sessions/links/**` | `domains/sessions/links/**` | [domains.md](domains.md), [session-engine.md](session-engine.md) |
| Reviews, plans, mobility, or repo-root product behavior | `domains/reviews/**`, `domains/plans/**`, `domains/mobility/**`, `domains/repo_roots/**` | owning `domains/<domain>/**` | [domains.md](domains.md), [mobility.md](mobility.md) |
| Durable one-prompt workflow execution in an existing workspace (run/step records, canonical-JSON replay, restart fencing) | `anyharness-lib/src/domains/workflows/**` | `domains/workflows/**` | [domains.md](domains.md), [specs/FEATURE_DOCS/WORKFLOWS.md](../FEATURE_DOCS/WORKFLOWS.md) |
| Latency tracing, request measurement, diagnostic ids | `observability/latency.rs` and scattered measurement helpers | `observability/**` | [observability.md](observability.md) |
| Splitting large files, moving modules, or creating new folders | any AnyHarness path | target layer from this table | [repo-shape.md](repo-shape.md) |

If a task appears to belong in two places, split by ownership. Example: a new
subagent MCP tool puts product behavior in `domains/sessions/subagents/**`,
shared JSON-RPC/capability helpers in `integrations/mcp/**`, and the HTTP route
adapter in `api/http/**`.

## Target Shape

This is the AnyHarness source organization.

```text
anyharness/crates/
  anyharness/
    src/                         # thin binary
  anyharness-contract/
    src/v1/                      # public wire schemas
  anyharness-credential-discovery/
    src/                         # shared provider credential discovery
  proliferate-diagnostics-protocol/
    src/v1/                      # contract only; no collector or producer runtime
  proliferate-diagnostics-collector/
    src/                         # standalone memory-only collector process
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
        artifacts/
        cowork/
        reviews/
        plans/
        mobility/
        terminals/
        workflows/
        materialization/
        activity/
        goals/
        loops/
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
        acp/                     # shared ACP protocol helpers
      origin.rs                 # advisory provenance only, see below
      process_env.rs
      lib.rs
```

Do not add new top-level AnyHarness folders without updating this doc and the
focused guide that owns the layer.

`origin.rs` is advisory provenance, not authority. It may describe where a
request/session/workspace came from. It should not decide auth, ownership,
billing, mutability, or sandbox policy.

Root-level files (`lib.rs`, `origin.rs`, `process_env.rs`) are crate-root
support modules, not layers. If one grows product meaning, live state, protocol
mechanics, local-machine capability, or DB infrastructure, move it into the
owning layer instead of growing a new global bucket.

## Hard Rules

- `anyharness` stays thin. It owns CLI/bootstrap only, not runtime behavior.
- `anyharness-contract` owns wire schemas only. It must not grow runtime logic.
- `anyharness-credential-discovery` owns shared provider credential parsing and
  portable auth-file normalization. It must not own runtime orchestration.
- `proliferate-diagnostics-protocol` owns only the versioned provider-neutral
  diagnostics wire contract, bounds, and pure validation. It must not own
  collection, transport, files, processes, export, or product orchestration.
- `proliferate-diagnostics-collector` owns only the standalone bounded
  in-memory collector and its loopback process boundary. It must not own
  Desktop/Tauri wiring, producer queues, AnyHarness runtime behavior, Worker
  behavior, server/cloud integration, persistence, or export destinations.
- `anyharness-lib` owns runtime behavior, durable domain rules, live
  orchestration, workspace adapters, and protocol integrations.
- `api/` is transport. It parses requests, calls the owning domain/runtime, and
  maps responses/errors.
- `app/` wires dependencies. `AppState` is not a place for business logic.
- `domains/` owns product concepts and durable business rules.
- `live/` owns long-lived in-memory managers, handles, actors, drivers,
  streams, subprocesses, and interaction rendezvous.
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
reviews, and subagents implement it; `app` wires them into
`SessionRuntime`.
