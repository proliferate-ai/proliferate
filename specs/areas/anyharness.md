# AnyHarness Standards

Scope:

- `anyharness/crates/anyharness/**`
- `anyharness/crates/anyharness-credential-discovery/**`
- `anyharness/crates/anyharness-contract/**`
- `anyharness/crates/anyharness-lib/**`
- `anyharness/crates/proliferate-diagnostics-client/**`
- `anyharness/crates/proliferate-diagnostics-collector/**`
- `anyharness/crates/proliferate-diagnostics-protocol/**`

Use this doc first to understand AnyHarness ownership. Then read the focused
guide or spec for the layer or subsystem you are changing.

## Launch-option and live-session authority

`domains/agents/launch_options/` owns target-observed pre-launch state and
exact validation. `domains/agents/launch_probe/` owns override-free detection.
`domains/sessions/launch_intent.rs` and the session store own the atomic
resolved intent. The live actor applies and confirms that intent before ready;
`domains/sessions/live_config/` owns the latest full per-session snapshot and
validated mutation. Catalog modules are distribution, presentation, and
compatibility support only and cannot authorize executable values.

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
  workspace identity, paths, materialization, archive/unarchive, purge/deletion

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
  implemented by cowork, reviews, and delegated-agent completion delivery
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

- [mental-model.md](anyharness.md) for the lens that makes the
  other guides cohere: the eight jobs, the use-case pipeline
  (resolve -> decide -> execute), the mapping and error doctrines, the
  parameter test, proportionality, and the placement algorithm.
- [crates.md](anyharness.md) for crate ownership:
  `anyharness`, `anyharness-contract`, `anyharness-credential-discovery`, and
  `anyharness-lib`, plus the Desktop-owned provider-neutral diagnostics
  protocol, producer-client, and collector crates.
- [api.md](anyharness.md) for HTTP/SSE/WS handler ownership, contract
  mapping, and transport-boundary rules.
- [app.md](anyharness.md) for `AppState`, dependency construction,
  session extension wiring, product MCP endpoint registration, and why
  AnyHarness uses explicit composition instead of singletons.
- [domains.md](anyharness.md) for durable domains, the
  `model/store/service/runtime` shape, and product surface domains.
- [live-runtime.md](anyharness.md) for managers, handles,
  actors, drivers, event sinks, interaction rendezvous, and long-lived
  in-memory state.
- [adapters.md](anyharness.md) for files, git, hosting, and
  process capabilities.
- [integrations.md](anyharness.md) for MCP, ACP, agent CLI, and
  provider/protocol mechanics.
- [harnesses.md](../systems/harnesses/harness-integrations.md) for provider-specific runtime
  behavior documented under `specs/areas/harnesses/**`.
- [persistence-stores.md](anyharness.md) for store shape, SQL
  ownership, and transaction ownership.
- [observability.md](anyharness.md) for latency tracing,
  request measurements, and diagnostic helpers.
- [repo-shape.md](anyharness.md) for file size thresholds,
  module style, and migration discipline.

Specs define subsystem behavior: lifecycle invariants, edge cases, and
verification for specific runtime flows.

Specs:

- [session-engine.md](../systems/sessions/session-engine.md) for the core session
  engine: `SessionRuntime`, live session manager, actor, driver, event
  sink, and interaction rendezvous.
- [session-actor.md](../systems/sessions/session-actor.md) for the target
  `live/sessions/actor` state-machine split, actor-owned state, command
  handling, turn loop, config, notifications, interactions, and shutdown.
- [../codebase/platforms/product/agent-distribution.md](../systems/harnesses/distribution.md) for
  distribution pins, install/readiness topology, and seed artifacts; executable
  model/control observation and launch resolution belong to
  [MODELS.md](../systems/agent_auth/models.md).
- [../codebase/platforms/product/mcp-runtime.md](../systems/subagents/mcp-runtime.md) for user MCP bindings, product MCP servers,
  session extensions, capability tokens, and MCP elicitation.
- [../codebase/platforms/product/agent-features/servers.md](../systems/subagents/product-mcp-servers.md) for the repeatable product
  MCP server pattern: definition, auth, injection, context, tools, calls, UI
  exposure, and session MCP selection.
- [../codebase/platforms/product/agent-features/definitions/README.md](../systems/subagents/product-mcp-servers.md) for the concrete product
  MCP definitions: Workspace, Cowork, and Reviews.

Subsystem docs at the top level of `specs/areas/**` own
behavior for runtime areas that do not yet have a focused guide or spec:

- [agents.md](../systems/harnesses/agents-domain.md)
- [acp.md](anyharness.md)
- [../codebase/systems/product/agents/cowork-artifacts.md](../systems/sessions/cowork-artifacts.md)
- [files.md](../systems/workspaces/files.md)
- [git.md](../systems/workspaces/git.md)
- [persistence-database.md](anyharness.md)
- [sessions.md](../systems/sessions/anyharness-sessions.md)
- [workspaces.md](../systems/workspaces/anyharness-workspaces.md)

Harness docs cover provider-specific behavior. Read
[harnesses.md](../systems/harnesses/harness-integrations.md) first when deciding whether a
provider rule belongs in a harness doc or an integration guide:

- [harnesses/claude.md](../systems/harnesses/claude.md)
- [harnesses/codex.md](../systems/harnesses/codex.md)
- [harnesses/grok.md](../systems/harnesses/grok.md)

Also read:

- [contract.md](anyharness.md) if the change touches public transport schemas.
- [architecture.md](anyharness.md) for the plane-level view of what AnyHarness
  owns versus Cloud, Desktop, Worker, and Supervisor, and how a session request
  travels the runtime.
- [agent-mode-matrix.md](../systems/harnesses/agent-mode-matrix.md) for which permission/approval
  modes each provider supports and how they map onto ACP.
- [workspace-command-environment.md](../systems/workspaces/command-environment.md) for the
  environment AnyHarness assembles for commands running in a workspace:
  precedence layers, the protected `PROLIFERATE_*` metadata, and propagation.

## Code Map

Use this map when starting from a file, task, or feature idea and deciding
which guide to read and where the code belongs.

| You are changing or building | Paths | Owner | Read |
| --- | --- | --- | --- |
| Binary startup, CLI flags, runtime-home selection, command dispatch | `anyharness/crates/anyharness/src/**` | `anyharness` thin binary | [crates.md](anyharness.md) |
| Public HTTP/SSE/WS schemas, OpenAPI-visible request/response types | `anyharness-contract/src/v1/**` | `anyharness-contract` | [crates.md](anyharness.md), [contract.md](anyharness.md) |
| Provider-neutral Desktop diagnostics wire types, bounds, and pure validation | `proliferate-diagnostics-protocol/src/v1/**` | `proliferate-diagnostics-protocol` | [crates.md](anyharness.md), [../OBSERVABILITY.md](../engineering/observability/standard.md) |
| Standalone loopback diagnostics collection, bounded in-memory state, query/tail/export/health transport, and process resource profiling | `proliferate-diagnostics-collector/src/**` | `proliferate-diagnostics-collector` | [crates.md](anyharness.md), [../OBSERVABILITY.md](../engineering/observability/standard.md), [collector README](../../anyharness/crates/proliferate-diagnostics-collector/README.md) |
| Bounded Desktop-owned producer adapter: tracing layer, secret filtering, admission queue/receipts, bridge activation, component fallback files | `proliferate-diagnostics-client/src/**` | `proliferate-diagnostics-client` | [crates.md](anyharness.md), [../OBSERVABILITY.md](../engineering/observability/standard.md) |
| Provider credential file discovery or portable credential export/import | `anyharness-credential-discovery/src/**` | `anyharness-credential-discovery` | [crates.md](anyharness.md) |
| HTTP handlers, routers, auth headers, SSE/WS transport, OpenAPI wiring | `anyharness-lib/src/api/**` | `api/**` | [api.md](anyharness.md) |
| AppState, dependency construction, wiring extension implementations, product MCP endpoint registration | `anyharness-lib/src/app/**` | `app/**` | [app.md](anyharness.md) |
| SQLite engine setup, migrations, DB pool wiring | `anyharness-lib/src/persistence/**` | `persistence/**` | [persistence-database.md](anyharness.md) |
| Session durable records, event rows, session config, pending prompts | `anyharness-lib/src/domains/sessions/**` | `domains/sessions/**` | [domains.md](anyharness.md), [session-engine.md](../systems/sessions/session-engine.md), [sessions.md](../systems/sessions/anyharness-sessions.md) |
| Live running agent process, session actor loop, ACP client, event sink, interactions | `anyharness-lib/src/live/sessions/**`, with remaining ACP helpers in `anyharness-lib/src/integrations/acp/**` | `live/sessions/**` plus `integrations/acp/**` | [live-runtime.md](anyharness.md), [session-engine.md](../systems/sessions/session-engine.md), [acp.md](anyharness.md) |
| Workspace durable lifecycle, materialization, archive/unarchive, purge/deletion | `anyharness-lib/src/domains/workspaces/**` | `domains/workspaces/**` | [domains.md](anyharness.md), [workspaces.md](../systems/workspaces/anyharness-workspaces.md) |
| Agent catalog, install, credentials, readiness, supported-agent meaning | `anyharness-lib/src/domains/agents/**` | `domains/agents/**` | [domains.md](anyharness.md), [../codebase/platforms/product/agent-distribution.md](../systems/harnesses/distribution.md), [agents.md](../systems/harnesses/agents-domain.md) |
| Provider CLI install/probe/path/version mechanics | `anyharness-lib/src/integrations/agent_cli/**`, provider-specific ACP code | `integrations/agent_cli/**` | [integrations.md](anyharness.md), [harnesses.md](../systems/harnesses/harness-integrations.md) |
| Provider-specific behavior such as Claude/Codex extension support or live controls | `anyharness-lib/src/live/sessions/**`, `anyharness-lib/src/integrations/acp/**`, `specs/areas/harnesses/**` | harness doc plus owning live runtime/integration module | [harnesses.md](../systems/harnesses/harness-integrations.md), provider doc under `harnesses/**` |
| File browsing, file reads/writes, workspace file capabilities | `anyharness-lib/src/adapters/files/**` | `adapters/files/**` | [adapters.md](anyharness.md), [files.md](../systems/workspaces/files.md) |
| Git status/diff/branch operations and git command parsing | `anyharness-lib/src/adapters/git/**` | `adapters/git/**` | [adapters.md](anyharness.md), [git.md](../systems/workspaces/git.md) |
| Hosting and process helpers around local workspace capabilities | `anyharness-lib/src/adapters/hosting/**`, `anyharness-lib/src/adapters/processes/**` | `adapters/hosting/**`, `adapters/processes/**` | [adapters.md](anyharness.md) |
| Terminal durable records, PTY lifecycle, terminal stream handles, terminal registry | `anyharness-lib/src/domains/terminals/**`, `anyharness-lib/src/live/terminals/**` | durable `domains/terminals/**` plus live `live/terminals/**` | [live-runtime.md](anyharness.md) |
| MCP user bindings attached to a session | `anyharness-lib/src/domains/sessions/mcp_bindings/**` | `domains/sessions/mcp_bindings/**` | [../codebase/platforms/product/mcp-runtime.md](../systems/subagents/mcp-runtime.md), [domains.md](anyharness.md) |
| Product MCP tool servers for Workspace, reviews, and Cowork | `domains/agent_operations/mcp/**`, `domains/reviews/mcp/**`, `domains/cowork/mcp/**` | owning product domain | [../codebase/platforms/product/agent-features/servers.md](../systems/subagents/product-mcp-servers.md), [../codebase/platforms/product/agent-features/definitions/README.md](../systems/subagents/product-mcp-servers.md), [domains.md](anyharness.md) |
| Shared MCP JSON-RPC, capability-token, tool-formatting scaffolding | `anyharness-lib/src/integrations/mcp/**` plus any remaining feature-local wrappers | `integrations/mcp/**` | [integrations.md](anyharness.md), [../codebase/platforms/product/mcp-runtime.md](../systems/subagents/mcp-runtime.md) |
| Artifact durable model, manifest, protection, or runtime behavior | `anyharness-lib/src/domains/artifacts/**` | `domains/artifacts/**` | [domains.md](anyharness.md) |
| Cowork artifacts, delegation, or cowork-owned tools | `anyharness-lib/src/domains/cowork/**` | `domains/cowork/**` | [domains.md](anyharness.md), [../codebase/systems/product/agents/cowork-artifacts.md](../systems/sessions/cowork-artifacts.md) |
| Session link graph: subagent, cowork, review-agent, fork relationships | `anyharness-lib/src/domains/sessions/links/**` | `domains/sessions/links/**` | [domains.md](anyharness.md), [session-engine.md](../systems/sessions/session-engine.md) |
| Reviews, plans, mobility, or repo-root product behavior | `domains/reviews/**`, `domains/plans/**`, `domains/mobility/**`, `domains/repo_roots/**` | owning `domains/<domain>/**` | [domains.md](anyharness.md), [mobility.md](../systems/workspaces/mobility.md) |
| Durable one-prompt workflow execution in an existing workspace (run/step records, canonical-JSON replay, restart fencing) | `anyharness-lib/src/domains/workflows/**` | `domains/workflows/**` | [domains.md](anyharness.md), [specs/systems/automations/deep-dive.md](../systems/automations/deep-dive.md) |
| Latency tracing, request measurement, diagnostic ids | `observability/latency.rs` and scattered measurement helpers | `observability/**` | [observability.md](anyharness.md) |
| Splitting large files, moving modules, or creating new folders | any AnyHarness path | target layer from this table | [repo-shape.md](anyharness.md) |

If a task appears to belong in two places, split by ownership. Example: a new
Workspace MCP operation puts product behavior in
`domains/agent_operations/**`, shared JSON-RPC/capability helpers in
`integrations/mcp/**`, and the HTTP route adapter in `api/http/**`.

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
  proliferate-diagnostics-client/
    src/                         # bounded producer adapter for Desktop-owned Rust children
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
- `proliferate-diagnostics-client` owns only the bounded local producer
  adapter linked into Desktop-owned Rust children: tracing capture, secret
  filtering, the admission queue and receipts, descriptor-possession bridge
  activation, and per-component fallback files. It must not own collector
  state, Desktop/Tauri wiring, product behavior, persistence, or replay.
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
reviews, and delegated-agent completion delivery implement it; `app` wires
them into `SessionRuntime`.

> [!note]
> This is the AnyHarness area doc: crate layout, domains, persistence, protocol, plus the worker and supervisor crates. Stitched sections below, one per former owner doc:
> `mental-model.md` → [AnyHarness Mental Model](#anyharness-mental-model)
> `architecture.md` → [AnyHarness — Architecture](#anyharness--architecture)
> `crates.md` → [AnyHarness Crates](#anyharness-crates)
> `domains.md` → [AnyHarness Domains](#anyharness-domains)
> `app.md` → [AnyHarness App Composition](#anyharness-app-composition)
> `api.md` → [AnyHarness API Layer](#anyharness-api-layer)
> `contract.md` → [Contract Crate](#contract-crate)
> `acp.md` → [ACP Runtime](#acp-runtime)
> `adapters.md` → [AnyHarness Adapters](#anyharness-adapters)
> `live-runtime.md` → [AnyHarness Live Runtime](#anyharness-live-runtime)
> `persistence-database.md` → [AnyHarness Persistence: Database Infrastructure](#anyharness-persistence-database-infrastructure)
> `persistence-stores.md` → [AnyHarness Persistence: Store Standards](#anyharness-persistence-store-standards)
> `repo-shape.md` → [AnyHarness Repo Shape](#anyharness-repo-shape)
> `observability.md` → [AnyHarness Observability](#anyharness-observability)
> `integrations.md` → [AnyHarness Integrations](#anyharness-integrations)
> `worker.md` → [Proliferate Worker](#proliferate-worker)
> `supervisor.md` → [Proliferate Supervisor Structure](#proliferate-supervisor-structure)

---

# AnyHarness Mental Model

## The Core Idea

Three rules generate the entire structure. Everything else is a consequence.

1. **Every function does exactly one job, and every file holds one job for
   one concern.** The eight jobs are: declare shapes, translate shapes,
   decide, orchestrate, perform effects, hold state, wire, observe. Every
   line in the codebase is classifiable into exactly one — there is no ninth
   category. Slop is one function doing two jobs.
2. **A path tells you what is allowed before you open the file.** The root of
   any module — domain or concern — reads as a table of contents.
3. **Dependency direction is one-way, and exactly one layer per use case may
   see across concerns.** For durable-only use cases that layer is the
   domain's `service.rs`; for live or multi-domain use cases it is the
   domain's `runtime.rs` (its facade). Everything below the composing layer
   is single-concern by construction — which is what makes it readable alone.

The corollary that decides most placements: anything **pure** is reachable by
`use`; anything **live** (stores, gates, handles, ciphers, clocks) must be
**handed in** as a dependency. `&self` on a service or runtime IS the deps
object: its field list is the license of what that layer may touch, set once
at wiring.

## The Eight Jobs

| # | Job | Home |
| --- | --- | --- |
| 1 | Declare shapes | `contract` crate (wire), `model.rs` (domain), `store/rows` (db), `live/<area>/model.rs` (live) |
| 2 | Translate shapes | only at the four doorsteps — see Mapping below |
| 3 | Decide | `*_policy.rs` and pure helper fns — sync, no IO, no clock |
| 4 | Orchestrate | `runtime.rs` (the facade: cross-concern) and `service.rs` (within-concern) use cases |
| 5 | Perform effects | mechanism files (one each), `adapters/`, `integrations/` |
| 6 | Hold state | `store/` (durable), live actors/managers (live) |
| 7 | Wire | `app/` only, via per-domain constructors |
| 8 | Observe | one span at each use-case entry |

The jobs compose; they do not embody. Orchestration **causes** effects by
calling their owners — `store.insert(record)?`, `handle.send(command).await?`
are orchestration lines, one effect-owner call each. **Performing** an effect
is the owner's job: effects on owned state belong to the custodian (the store
executes the SQL, the actor mutates live state when commanded); effects on the
un-owned world (filesystem, processes, network, protocol IO) belong to
mechanism files, `adapters/`, and `integrations/`. The violation is never
that a use case caused an effect — it is an orchestration body that contains
the mechanics inline: SQL strings, `std::fs` calls, process spawning,
encryption loops. One function embodying two jobs is the leak.

## Truths: Static, Dynamic, Derived

The state axis is "who owns the truth and does it change":

- **Static truth** — bundled data (registry/catalog JSON). Load, validate,
  project. Same answer every call. Pure for policy purposes.
- **Durable truth** — survives restart. Owned by stores; reached only through
  store surfaces.
- **Live truth** — exists only in this process: actors, handles, PTYs, leases.
  Owned by `live/**`.
- **Derived views** — own nothing, never write: readiness resolution, launch
  options, preflight results. Recomputed from the truths above. Because they
  are write-free, anyone may call them anywhere, concurrently.

A use case is classified by the truths it needs: durable-only -> `service.rs`
owns it; live or multi-domain -> `runtime.rs` owns it.

## The Use-Case Pipeline

Complex use cases always read in this order. The pipeline is a shape, not a
layer — it belongs to whichever layer owns the use case.

```text
preconditions -> idempotency -> pre-flight repairs -> resolve -> decide -> execute/record -> (compensate)
```

- **Preconditions**: "does the world permit this?" — gates, closed-state
  checks. Structured error variants, never stringified. Distinct from
  authorization (see Access below).
- **Idempotency**: the cheap "already done?" exit, before any effect or fetch
  fan-out. The authoritative check lives under the owning layer's lock.
- **Pre-flight repairs**: named best-effort effects that make the world
  startable (crash recovery sweeps). Named functions, never inline blocks.
- **Resolve**: every fetch, one truth per line, `?` handles existence. May
  branch on *what* to fetch, never on what is *allowed*. Gathers into a
  **Context**.
- **Decide (policy)**: pure — no `&self`, no IO, no clock, no UUIDs. Reads the
  Context and the input, applies every rule, emits a **Plan**: the complete
  description of what shall happen, executing nothing.
- **Execute/Record**: the effects policy cannot perform — identity and clock
  minting, encryption, inserts, process spawns. Plan plus stamps becomes the
  record.
- **Compensate**: failure-path effects (mark-errored) live in the use-case
  body next to the success path, never buried in `map_err`.

The Context is **not a model**. It is named local variables: private to one
use-case module, never exported, never stored, never serialized. The moment
another file imports a Context, it has become a god object. Contexts are
per-use-case; overlap between them is correct, deduplicating them is not.

The Plan is **data only**: debuggable, comparable, constructible in tests.
Capabilities (closures, sinks, hooks) travel beside plans, never inside them.
In-repo exemplar: `domains/artifacts` (`plan_create`/`plan_update` return typed
plans; the runtime owns all effects).

## Models

| Kind | Home | Law |
| --- | --- | --- |
| Wire | `anyharness-contract/src/v1/**` | never imported below `api/` (documented event-payload exception only) |
| Domain | `domains/<d>/model.rs` | the lingua franca; everyone may import |
| Row | inside `store/**` | never escapes the store |
| Live | `live/<area>/model.rs` | live's doorstep vocabulary (launch bundles, commands, events) |

Inputs, views, and plans are **domain models with role names**, not new kinds.
A representation must earn its existence: wire and row copies always qualify
(stability, layout); internal 1:1 mirrors are banned — pick one owner.

## Mapping

Translation happens at exactly **four doorsteps** and nowhere else:

```text
wire <-> domain     api/http/<resource>_contract.rs
row  <-> domain     inside the store
domain -> live      the launch/command bundle the runtime builds
live <-> protocol   inside the actor/driver (ACP)
```

- **Between domains there is no mapping.** Domains exchange domain models
  as-is. Cross-domain composition is passing, never translating. If complexity
  grows, contexts and deps grow — the mapping count stays fixed.
- **Mappers are dep-less, sync, and decisionless.** No `&state`, no store
  reads, no clock. If a mapper needs to fetch, the use case returned too
  little: fix its return type (a view model), not the mapper.
- Each type pair has exactly one mapper.
- The live layer may import domain **shapes**, never domain **services or
  stores**. Durable powers cross the live boundary as narrow capability traits
  (event sinks, hooks), wired in `app/`. If live needs a fact it does not
  have, add a field to the launch bundle — live never fetches.

## Errors

- **One error enum per public surface.** Each layer adds only the variants it
  introduces and absorbs lower errors via `#[from]` / `#[error(transparent)]`.
  Twin enums with hand-copied variant mappers are banned.
- **One `From<SurfaceError> for ApiError` per domain at the edge**
  (`api/http/<resource>_errors.rs`) — the only place HTTP learns failures.
  In-repo exemplar: `api/http/sessions_errors.rs`.
- **Expected outcomes are data, not errors**: not-found is `Option`,
  needs-selection is a variant with structure, "already installed" is an empty
  plan. Never a string.
- **Errors carry their context from birth** (the resolution error includes the
  agent kind) so `From` stays sufficient. A `map_err` that adds context means
  the source error is underspecified.
- **Never map typed -> `anyhow`/string.** Structure destruction upstream forces
  substring-sniffing downstream, which is a behavior change waiting on a
  reworded message. `anyhow` is blessed only at the store surface, for
  infrastructure failure, with expected conditions modeled in `Ok` types.
- Log where the error is handled, not at every hop.

## Dependencies And Parameters

The parameter test — for each thing a function needs, ask two questions:

```text
Does it vary per call?      Data or power?
NO                ->  constructor dep (wired once)
YES + data        ->  field on the input struct
YES + power       ->  separate capability parameter
observability ctx ->  never a parameter; it is a span
```

- More than 3 parameters earns an input struct. Adjacent identically-typed
  parameters are a compiler-invisible swap hazard — name them in a struct.
- Call sites passing bare `None, Vec::new(), true` positionally are the
  symptom; the struct is the cure.

## Access

Two different questions, two layers, never conflated:

- **Authorization** — "who is asking" — edge only, one named assertion from
  `api/http/access.rs`, before translation. Domains never see auth tokens.
- **Preconditions** — "does the world permit it" — domain only: gates and
  policy with structured variants. The edge never makes these calls.

A use case legitimately checks both; they are different questions.

## Observability

One `#[tracing::instrument]` span per use-case entry, fields declared once;
everything inside inherits them. Phase timings are events. Hand-repeated field
clusters and latency/flow context threaded through signatures are banned —
that context propagates through spans.

## Proportionality: Ceremony Is Earned

| Artifact | Earned when | Below that |
| --- | --- | --- |
| Input struct + `*_input()` | >3 args, or defaults/grouping | plain args at the call site |
| Context + resolve fn | >2 truths fetched | inline `let`s |
| `*_policy.rs` | >1 nontrivial rule, or rules worth lone tests | inline check |
| View model | response needs composition | return the record |
| Runtime layer | use case crosses concerns | service is the entry |
| Concern folder | domain root past ~8 files or 2+ nameable concerns | stay flat |

The invariants that never disappear, even for two-field CRUD: the auth
assertion, no contract types past the edge, errors via `From`, rows inside the
store.

## The Root Is A Table Of Contents

A domain's root may contain only `mod.rs`, `model.rs`, the entry surface
(`runtime.rs` and/or `service.rs`), and `store/`. Everything else lives in a
named concern folder, and each concern folder follows the identical internal
grammar (exports-only `mod.rs`, `service.rs`, policy, helpers — each earned).

If a file cannot say which concern it belongs to, that is not a homeless file —
it is an unnamed concern. Name it. A root (domain or concern) holds roughly
5–9 entries; shrink a table of contents by naming concerns, never by merging
files. The same rule applies recursively to concern folders that outgrow it.

## The Placement Algorithm

Four questions give every file exactly one home:

1. **Which domain?** (source of truth + the domain's charter)
2. **Which concern within it?** No concern fits -> shared shapes (`model.rs`)
   or a concern you have not named yet.
3. **Which role within the concern?** (service / policy / mechanism / store —
   the eight jobs)
4. **Earned or inline?** (the proportionality table)

## Building A New Use Case

The end-to-end order for a new feature. Skip any step the proportionality
table says is unearned; never skip the four invariants (auth assertion, no
contract types past the edge, errors via `From`, rows inside the store).

1. **Wire shape**: request/response types in `anyharness-contract/src/v1/`.
2. **Owner**: durable-only -> the domain's `service`; live or multi-domain ->
   its `runtime`. A new nameable concern -> a new concern folder.
3. **Domain vocabulary**: input/record/view types in `model.rs`.
4. **The use case**: the pipeline fn (resolve -> decide -> execute) with its
   private Context, and `<usecase>_policy.rs` for the rules.
5. **State**: store fns for new rows — tier-1 surface, tier-2 row fns
   (see persistence.md).
6. **Errors**: new enum or new variants, `#[from]` for absorbed layers, one
   `From` impl in `api/http/<resource>_errors.rs`.
7. **Edge**: the handler stanza plus seam constructors in
   `<resource>_contract.rs` (see api.md).
8. **Span**: `#[tracing::instrument]` on the use-case entry.
9. **Wiring**: extend the domain's constructor in `app/` if new deps appeared.
10. **Tests**: policy tests with hand-built Contexts (no DB), store tests,
    one handler test through the stanza.

Reviewing existing code is the same list run in reverse: anything that
deviates is either a named migration exception or a finding.

## Smells (Greppable)

A job has leaked if you see: a closure or clone-for-closure in an orchestration
body · a strategy `match` in a facade · repeated tracing field blocks ·
`map_err` with a hand-rolled variant match · `.to_string()` on a typed error ·
control flow on `message.contains(...)` · a fetch inside a mapper or policy ·
`Utc::now()`/`Uuid::new_v4()` inside decision logic · a handler importing
domain internals beyond the facade and its types · a Context imported by
another file · the same rule decided in two places · effects performed before
validation completes.

## In-Repo Exemplars

Every rule above has a native exemplar — cite these in reviews:

```text
errors-at-the-edge      api/http/sessions_errors.rs
shared handler stanza   api/http/git_task.rs (one seam for 11 git handlers)
named auth assertions   api/http/access.rs
protocol doorstep       acp/** (dep-less permission mappers, typed provider errors)
typed adapter errors    adapters/git/types.rs
plan functions          domains/artifacts (plan_create / plan_update)
two-tier store          domains/sessions/store (row fns take &Connection, compose in one tx)
participant trait       domains/sessions/deletion.rs (cross-domain tx via narrow trait)
wiring template         app/product_mcp.rs (deps struct + build fn)
textbook small domain   domains/repo_roots
```

## Migration Exceptions

Known violations, named per the specs convention. The rule above is the law;
these are the debt:

- ~81 `anyharness_contract` import lines inside `domains/**`; worst:
  `runtime_config` persists wire types as rows, `agents/auth` uses
  contract structs as its domain model. Target: domain twins minted at the
  seams.
- `api/http/agents_model_registry.rs` (with `agents_errors.rs`) carries a
  second error mechanism (`ProblemResponse`) alongside `ApiError`. Target: one
  mechanism.
- `api/http/workspaces_lifecycle.rs` implements the retire state machine in
  the handler (three copies including retention). Target: a lifecycle service
  in `domains/workspaces`.
- `WorkspaceService` and `WorkspaceRuntime` carry duplicated, diverged method
  bodies. Target: one entry surface.

Resolved (the rule now holds; listed for traceability):

- Latency context threading (a request-context struct through ~13 signatures
  across api -> domains -> live) — resolved by the latency-to-spans migration;
  flow context propagates through `#[tracing::instrument]` spans only.
- The sessions runtime's fetching response mapper (store reads + live lookups
  inside the domain-side contract builder) — resolved by
  `domains/sessions/runtime/view.rs`: the runtime composes `SessionView`; the
  API maps it with a dep-less mapper.
- `live/sessions` receiving concrete stores per call and a 15+-positional-param
  `start_session` — resolved by the `SessionLaunch`/`LaunchEnv` bundle,
  `ActorCapabilities` (capability traits wired once at manager construction),
  and per-call `SessionHooks`.

---

# AnyHarness — Architecture

---

## 1. Purpose / Ownership

AnyHarness is **the runtime that runs coding-agent sessions over the ACP protocol,
inside the sandbox or on Desktop**. Product clients call it directly; managed
Cloud traffic reaches the same API through the cloud-sandbox gateway.

It owns:
- **Running agent sessions** — spawning the agent subprocess, driving prompt turns
  over ACP, and turning the agent's streamed output into an ordered, replayable
  event log.
- **The durable record** of those sessions (config, history, identity) in local
  SQLite.
- **Applied runtime config** — external MCP servers, skills, and agent/provider
  auth — and its materialization into a session.
- **The product MCP tools** we expose back to the agent (subagents, reviews,
  cowork, skills, …).

It does **not** own product orchestration or account/billing truth (Cloud's
job), nor the external launch/update machinery used by Desktop, Worker, or an
installed Supervisor. AnyHarness is a local runtime engine whose own APIs and
SQLite database own workspace/session execution truth.

**The defining axis — Durable vs Live.** Almost every placement question in
AnyHarness reduces to one split: *is this the durable meaning of a session, or the
coordination of a running one?* Durable lives in `domains/` + `persistence/`; live
lives in `live/`. Hold this and the rest of the structure follows.

---

## 2. 20k-Foot Detailed View

### The four crates

```text
anyharness                       thin binary — parse args, wire deps, run
anyharness-contract              wire schemas (shapes that cross the network)
anyharness-credential-discovery  probe the env for credentials (files/keychain/markers)
anyharness-lib                   the runtime engine — everything below
```

Three small satellites + one engine. The contract crate keeps wire shapes out of
runtime types; credential-discovery keeps "find the creds" out of "am I ready to
serve."

### The eight layers in `anyharness-lib/src` (edge → substrate)

```text
api/            edges — HTTP/ACP surface. Translates wire ↔ runtime, nothing more.
app/            composition root — wires deps, mounts SessionExtensions, registers product MCPs.
domains/        DURABLE product meaning — sessions, agents, runtime_config, plugins, reviews, …
live/           EPHEMERAL coordination — running sessions: the ACP actors, event sinks, rendezvous.
adapters/       translate between a domain's types and an integration's types.
integrations/   leaf I/O — talk to the outside (ACP processes, MCP protocol, filesystem).
persistence/    durable storage substrate (SQLite) — how domains/ actually save.
observability/  cross-cutting — tracing/metrics/logs.
```

The structural feature that makes AnyHarness feel "more numerous" than the server:
`domains/` and `live/` are **siblings, not a stack**. A feature splits across two
homes — its durable half in `domains/<feature>/` and its running half in
`live/<feature>/`. That doubling is the source of most of the extra rules.

### The session engine — the role chain

The spine walks durable → live → external:

```text
SessionRuntime → SessionService → SessionStore →          [DURABLE: domains/]
   LiveSessionManager → LiveSessionHandle → SessionActor → [LIVE: live/]
      driver (ACP conn + InboundDoor) / SessionEventSink / InteractionRendezvous   [EXTERNAL + ordering]
```

The handoff `SessionStore → LiveSessionManager` is exactly the durable/live
boundary.

### The live grammar (5 roles)

The only layer juggling concurrency, so the most rules:

```text
manager   registry of MANY        — the only way to find/create a live instance
handle    the ONE public port     — every interaction with a live instance goes through it
actor     private serialized core  — owns the gravity; decides WHEN things happen
driver    external backing mechanism — the ACP process/connection the actor drives
sink      ordered write path        — decides HOW events become an ordered stream
```

Two non-obvious boundaries: **"actor decides WHEN, sink decides HOW it becomes
ordered output"**; and the **handle is the only port** — actor commands are
constructed only inside `handle.rs` (`handle.send_prompt(...)`, never
`handle.command_tx.send(SessionCommand::Prompt{...})`).

### MCP — a vertical, not a layer

The one feature that cuts through every layer:

```text
domains/sessions/mcp_bindings    durable: which MCPs a session/workspace has + binding policy
domains/<feature>/mcp            durable: a feature's product MCP tools (meaning)
integrations/mcp                 leaf: protocol mechanics (JSON-RPC, capability tokens)
live/.../rendezvous/mcp_elicitation     live: a pending elicitation rendezvous
api/http/product_mcp.rs          edge: the one HTTP route product MCPs are served on
```

### The two applied bundles

Both are **revision + scope versioned**, applied to a runtime scope, and
**snapshotted per session at create** (config never mutates inside a live session):

```text
runtime-config   PUT /v1/runtime-config       external MCPs + skills + artifacts + direct-attach-auth
                   secrets: in-memory cache (ephemeral, re-pushed to re-warm)
agent-auth       PUT /v1/agents/auth-config    per-agent-kind provider creds (env or files)
                   secrets: encrypted at rest (survives restart, needed to resume)
```

A session **pins** to a revision at create (`runtime_config_session_context` /
`agent_auth_scope` + `required_agent_auth_revision`), **materializes** secrets once
into the session, and launches from that frozen snapshot. "Refresh" means an
authorized caller applies a new revision and the *next* session picks it up —
never a live update.

### The event model

One `SessionEventSink` per session owns truth: a monotonic `seq`, the `turn_id`,
and the open-item state. ACP notifications are *normalized* into contract events
(one notification → 0..n events); `item_completed` is **synthesized** by
accumulating chunks, not a raw ACP frame. Every event is **persisted before
broadcast** (`publish_session_event`), which makes direct SSE/replay consumers
recoverable by `seq`.

---

## 3. Core Workflows

**Session start (durable → live):**
```text
create: pin runtime-config revision (bind_session_to_expected) + capture agent_auth_scope/revision
  → agent-auth launch_overlay: scope+revision gate (else 409 AGENT_AUTH_SELECTION_REQUIRED)
  → readiness gate: resolve_agent_with_env must be Ready
launch: SessionExtensions resolve launch extras
  → materialize external MCP servers (credentials interpolated from cache, once)
  → if skills: append skill INDEX to system prompt + add proliferate_skills MCP
  → choose_session_startup_strategy: Fresh (new_session) | LoadNative (load_session) | Fork
  → LiveSessionManager.start_session → spawn SessionActor (owns the ACP connection)
```

**A prompt turn (in → out):**
```text
handle.send_prompt → SessionCommand::Prompt → actor begins turn
  → sink.begin_turn (TurnStarted + User item) → conn.prompt(req)   [the long-lived ACP future]
  → ACP streams session/update notifications → InboundDoor → actor channel
  → sink.ingest normalizes (ItemStarted/ItemDelta/ToolCall…), each seq'd + persisted + broadcast
  → PromptResponse{stop_reason} → finish: sink.turn_ended → phase Idle → apply pending config → drain queue
```

**Mid-turn interactions (one rendezvous, many askers):**
```text
agent asks permission OR a product MCP tool elicits
  → rendezvous registers a parked oneshot + handle.add_pending_interaction + sink.interaction_requested
  → user answers → SessionCommand::ResolveInteraction (handled on the same actor)
  → rendezvous resolves the oneshot → the parked ACP callback returns → sink.interaction_resolved
```

**Config application:**
```text
authorized caller → PUT /v1/runtime-config or /v1/agents/auth-config
  → store upserts only when the sequence is newer
  → next session created snapshots the new revision (running sessions unaffected)
```

The current Proliferate Worker does not poll for these bundles or report applied
revisions. Managed Cloud calls/proxies to AnyHarness directly; the Worker's
AnyHarness HTTP use is limited to catalog convergence and the post-relaunch
`GET /health` version gate.

**Skill discovery / activation (advisory, no wiring change):**
```text
index in system prompt → agent: list_available_skills → activate_skill(id) returns full instructions
  (a pure read; no MCP enabled, no state set) → get_skill_resource(id, resId) streams one body
required MCPs are ALWAYS connected at launch; required_mcp_servers is a hint, not a gate
```

**Model switch in place:**
```text
SetConfigOption(model) → ensure live actor → attempt live apply (same session)
  exact live readback → persist the new canonical session snapshot
  acknowledgement/rejection without exact readback → SESSION_CONFIG_REJECTED
  queued replay → revalidate latest live-snapshot membership before apply
```

---

## 4. Each Layer's Best Practices

**`api/`** (the edges)
- Translate wire ↔ runtime and nothing more. No business logic. The product-MCP
  route (`product_mcp.rs`) looks up a handler by slug, validates the capability
  token, and dispatches — it does not know tool meaning.

**`app/`** (composition root)
- The "main()" of behavior: wire dependencies, mount `SessionExtension`s, register
  product MCPs into the launch catalog (selectors + token minters) and the endpoint
  registry. Keep it wiring; no logic.

**`domains/`** (durable meaning)
- Server-like `service + store` per feature, but the *running* half lives in
  `live/`. A domain owns durable truth and decisions; it must not reach into live
  coordination. `runtime_config` and `agents/auth` own the two synced
  bundles; `plugins` owns skills; `sessions` owns the session record + mcp_bindings
  + subagents.

**`live/`** (ephemeral coordination) — the grammar is law
- `manager` is the only registry; `handle` is the only public port; `actor` is
  private and serialized; `driver` is a mechanism (never makes product decisions);
  `sink` owns ordering. Outside `live/<resource>/`, only `manager` + `handle` +
  public types are visible.
- Dependency rules: `live → domains/integrations/adapters/observability` OK; AVOID
  `live → api/app`, `driver → domain services`, `sink → access-control`,
  `integrations → live`.
- The sink is the single source of event order: assign `seq`, persist, then
  broadcast — in that order.

**`adapters/`** — translate domain types ↔ integration types; pure shape-shifting.

**`integrations/`** (leaf I/O)
- Talk to the outside; never know about coordination. `integrations/mcp` owns MCP
  *protocol mechanics* (JSON-RPC, capability tokens) — the *meaning* of a product
  MCP tool lives in `domains/<feature>/mcp`.

**`persistence/`** — the SQLite substrate. Synced config is content-addressed:
skill bodies/resources are rows in `runtime_config_artifacts` (keyed by SHA), not
files on disk; the manifest pins per session in `runtime_config_session_context`.

**`observability/`** — cross-cutting tracing/metrics; keep it dependency-light.

**The MCP vertical convention** (to add a product MCP tool to feature X)
- Create `domains/X/mcp/{definition, tools, context, auth, calls, mod}.rs`:
  `definition` = identity (id/slug/codes); `tools` = arg structs +
  `MUTATING_TOOL_NAMES` + `build_tool_list`; `context` = `resolve_context`; `auth`
  = capability mint/validate; `calls` = `call_tool` match; `mod` = the
  `ProductMcpServer` impl bridging them.
- Register once in `app/product_mcp.rs`: a **launch-catalog** entry (selector
  closure decides which sessions attach it + a token minter) and an
  **endpoint-registry** entry (slug → handler + mutating list).
- Reuse the **interaction rendezvous** for any mid-call user prompt (elicitation) —
  do not invent a second one.

**Synced config & auth notes**
- Materialize secrets **once** at session create; fail loud (`MissingCredentials`)
  rather than launch with empty secrets. Runtime-config secrets are an ephemeral
  in-memory cache; agent-auth secrets are encrypted at rest.
- `expires_at` (agent-auth) is checked **only at launch** → 409 if expired. There
  is **no proactive refresh and no mid-session re-injection**: a running session
  whose grant expires fails on its next turn until a new session picks up the
  re-pushed revision. The cloud owns rotation; the sandbox is reactive.

---

## The Compression

**AnyHarness is a single-sandbox session engine split by one axis — durable meaning
(`domains/` + `persistence/`) vs the running instance (`live/`) — with edges
(`api`/`app`) on top and leaves (`adapters`/`integrations`) underneath.** The role
chain (`SessionRuntime → … → SessionActor → driver/Sink/Rendezvous`) walks that axis;
the live grammar (manager/handle/actor/driver/sink) governs the concurrency at the
bottom; one event sink owns `seq`/turn/item order (persist-before-broadcast); MCP is
the one vertical cutting through all layers; and two revision-pinned synced bundles
(runtime-config = external MCPs + skills; agent-auth = provider creds) are
snapshotted per session at create and never mutated live. Skills are DB-backed,
MCP-delivered, advisory know-how with progressive disclosure — not filesystem files
and not access control. Direct clients and the Cloud gateway use the same
AnyHarness contracts; the optional Worker only converges catalog/runtime
versions around the running process.

---

# AnyHarness Crates

## Ownership

```text
anyharness/
  thin binary crate

anyharness-contract/
  public wire schemas and OpenAPI-visible types

anyharness-credential-discovery/
  shared provider credential discovery and portable auth normalization

proliferate-diagnostics-protocol/
  provider-neutral Desktop diagnostics wire contract and pure validation

proliferate-diagnostics-client/
  bounded local producer adapter for Desktop-owned Rust children

proliferate-diagnostics-collector/
  standalone loopback diagnostics collector process and bounded memory state

anyharness-lib/
  runtime implementation
```

## `anyharness`

The binary crate owns process bootstrap only:

- CLI parsing
- tracing/logging initialization
- runtime home selection
- server startup
- command dispatch into `anyharness-lib`

It must not own runtime behavior, durable business rules, stores, protocol
normalization, or product workflows.

Expected shape:

```text
anyharness/src/
  main.rs          # initialize tracing, parse CLI, dispatch command
  cli.rs           # clap structs and enums only
  commands/        # bootstrap command, delegate to anyharness-lib
```

Current commands:

- `serve`
  - choose runtime home
  - ensure directories exist
  - open DB
  - build `AppState`
  - build and serve the router
- `print-openapi`
  - render OpenAPI JSON to stdout

Rule of thumb:

If a binary command needs to know how sessions, agents, files, or workspaces
actually work, that logic belongs in `anyharness-lib`. The binary crate may
compose services and choose startup policy; it must not become a second runtime
implementation.

## `anyharness-contract`

The contract crate owns public transport shapes:

- HTTP request and response bodies
- SSE event envelopes and payloads
- WebSocket payloads
- OpenAPI-visible enums and schemas

It must not import `anyharness-lib`.

Contract request/response types should be mapped at the API boundary before
entering durable domains or live runtime code.

Exception: session event payloads may intentionally be both contract-visible and
persisted event-log payloads. When a lower layer imports contract event types,
that dependency must be because the type is the durable event payload, not
because a handler leaked request/response models downward.

## `anyharness-credential-discovery`

This crate owns reusable provider credential discovery:

- reading known local auth/config files
- normalizing portable credential-export data
- provider-specific discovery rules shared by desktop/cloud sync and runtime
  readiness

It does not own:

- runtime service orchestration
- env persistence
- session launch behavior
- install/update behavior

## `anyharness-lib`

This crate owns the runtime:

- API transport boundary
- `AppState` composition
- SQLite persistence wiring
- durable domains
- live runtime actors and handles
- local workspace adapters
- protocol/vendor integrations

Use [README.md](anyharness.md) for the internal runtime structure.

## `proliferate-diagnostics-protocol`

This crate owns schema-versioned diagnostics envelopes, API shapes, closed
vocabularies, hard bounds, and pure record/lifecycle validation shared across
Desktop-owned producers and the standalone collector. It is separate from
`anyharness-contract`, whose audience is the AnyHarness public transport API.

It must not own collector runtime state, transport handlers, files, processes,
exporters, producer queues, or product orchestration. Cross-language meaning is
pinned by `fixtures/contracts/rust-observability-v1/`.

## `proliferate-diagnostics-client`

This crate owns the bounded local diagnostics adapter linked into the two
Desktop-owned Rust producers — the bundled `anyharness serve` child and
`proliferate-worker`:

- one global `tracing` layer per process with structural secret filtering
- the bounded admission queue, batching, receipts, and loss accounting
- activation purely by possession of the two reserved Desktop bridge and
  shutdown descriptors: `Disabled`, `Bundled`, or `BundledDegraded`, never a
  product-launch failure
- each component's fixed bounded fallback file family

It consumes `proliferate-diagnostics-protocol` as its only wire-contract
authority. It must not own collector runtime state, Desktop/Tauri wiring,
Sentry/PostHog policy, product behavior, persistent queues, or replay.

## `proliferate-diagnostics-collector`

This crate owns the standalone, memory-only Desktop diagnostics collector:

- capability-authenticated loopback HTTP transport
- bounded ingest, lifecycle validation, query, tail, export, and health state
- inherited capability and control file-descriptor process seams
- deterministic resource profiling for the standalone process
- the provider-neutral OTLP export adapter, compiled into every build, with a
  compile-time export policy that limits a customer build to the lifecycle
  record class and widens to every non-secret class under the non-default
  `internal-dogfood-export` feature

It consumes `proliferate-diagnostics-protocol` as its only wire-contract
authority. It must not own Desktop/Tauri wiring, producer queues, AnyHarness
runtime behavior, Worker behavior, server/cloud integration, or durable storage.
The export adapter it does own is provider-neutral OTLP over HTTP; the
destination URL and its request headers arrive as environment values, so no
provider identity or credential is part of any contract this crate holds. Its
process, transport, and export surfaces are documented in
`proliferate-diagnostics-collector/README.md`.

---

# AnyHarness Domains

Read [mental-model.md](anyharness.md) first: it owns the eight jobs, the
use-case pipeline, the mapping/error doctrines, and the placement algorithm
this guide applies to domains.

Product domains live under `domains/**`. Core session, workspace, agent, and
repo-root domains use the same root as product surfaces, with dependency
direction enforced by domain tier.

Current session-domain reality:

- user MCP bindings and session MCP launch assembly live under
  `domains/sessions/mcp_bindings/**`.
- session persistence is split under `domains/sessions/store/**`.
- session runtime orchestration is split under `domains/sessions/runtime/**`.

## Purpose

Domains own product concepts and durable truth.

They answer questions like:

- What is a session?
- Where does execution happen?
- Which agents are supported and ready?
- What durable events and config are recorded?
- What does a cowork thread, review run, plan, or mobility transfer own?

Domains should be readable without knowing HTTP routing or live actor internals.

## Domain Tiers

Not every domain has the same role. Use the tier to decide dependency direction
and internal shape.

### Core Primitive Domains

```text
sessions
workspaces
agents
repo_roots
```

These are foundational runtime concepts. Other product domains may depend on
them. They should not depend on product surfaces such as cowork or reviews.

Core primitive domains may define extension traits when product surfaces need
to participate in a core lifecycle. `app/` wires implementations into the core.

Expected shape:

```text
<core-domain>/
  model.rs
  store/          # promoted when there is more than one table/query family
  service/        # durable rules, split by use case when it grows
  runtime/        # only for cross-domain/live orchestration
  <subdomain>/    # promoted concern with its own lifecycle or model/store/service
```

Examples:

```text
sessions/
  model.rs
  runtime_event.rs
  extensions.rs
  live_ports.rs
  store/
  service/
  runtime/
  prompt/
  live_config/
  mcp_bindings/
  links/
  subagents/

workspaces/
  model.rs
  store/
  service/
  runtime/
  materialization/
  archive/
  deletion/
```

### Product Surface Domains

```text
artifacts
cowork
reviews
plans
mobility
```

These are product workflows built on core primitives. They may depend on core
domains. They should not be imported by core domains directly.

Expected shape:

```text
<feature-domain>/
  model.rs        # durable product records and domain-owned types
  store/          # product-specific queries
  service/        # durable product rules
  runtime/        # only if it coordinates cross-domain or live work
  mcp/            # when the product exposes MCP tools
  session_extension.rs  # when the product plugs into session launch/prompt
```

Product domains should use extension points instead of forking core session
behavior. For example, reviews can inject review-specific MCP tools through a
session extension; it should not duplicate session launch logic.

### Session-Owned Product Subdomains

Some product features are session-scoped and should live under `sessions/`
rather than becoming top-level domains.

Examples:

```text
domains/sessions/subagents/
domains/sessions/links/
```

Use this shape when the concept has durable state or tool behavior, but its
identity is subordinate to a session.

## Canonical Files

Default domain files:

```text
model.rs
store.rs or store/
service.rs or service/
runtime.rs or runtime/
```

Use:

- `model.rs` for durable records and domain-owned types.
- `store.rs` / `store/` for SQL only.
- `service.rs` / `service/` for durable rules over stores and domain models.
- `runtime.rs` / `runtime/` for high-level use cases that coordinate multiple
  services or bridge durable state to live execution.

Do not add broad `helpers.rs`, `utils.rs`, or `misc.rs`. Name the concept:
`prompt`, `events`, `retention`, `materialization`, `mcp_bindings`,
`extensions`, `catalog`, `readiness`.

## The Root Is A Table Of Contents

A domain's root may contain only the canonical files above plus named concern
folders. Every other file lives inside the concern it serves; each concern
folder repeats the identical internal grammar (exports-only `mod.rs`,
`service.rs`, policy, helpers — each earned, not mandatory).

If a file cannot say which concern it belongs to, that is an unnamed concern —
name it. A root holds roughly 5–9 entries. Shrink a table of contents by
naming concerns, never by merging files. The rule applies recursively: a
concern folder (or a `runtime/` folder) that accumulates 10+ files is several
concerns wearing one name.

Single-concern domains stay flat (`repo_roots`, `mobility`). The trigger for
folders is a root crossing ~8 files or containing two nameable concerns.

Migration exception: `domains/workspaces` currently has ~25 root files
(gates, worktrees, lifecycle, setup, and files concerns all flattened) and two
parallel entry surfaces (`WorkspaceService`, `WorkspaceRuntime`) with
duplicated bodies. Target: concern folders (`access/`, `lifecycle/`,
`worktrees/`, `setup/`, `files/`) behind one entry surface.

## Store vs Service vs Runtime

Stores:

- read/write domain rows
- construct SQL
- return domain records
- do not perform product workflows
- do not call live runtime systems

Services:

- enforce durable rules
- validate domain invariants
- coordinate domain stores
- may call adjacent domain stores when needed for durable validation
- do not start live actors or subprocesses

Runtimes:

- run high-level use cases
- coordinate multiple services
- bridge durable state to live state
- call `live/**` managers and handles
- own ordering when the workflow depends on live execution

For sessions:

```text
SessionStore   = SQL access for session rows/events/config/pending prompts
SessionService = durable session rules
SessionRuntime = session workflows that may start/prompt/resume live sessions
```

## Use-Case Shape

Complex use cases — service or runtime — follow one pipeline (see
[mental-model.md](anyharness.md) for the full law):

```text
preconditions -> idempotency -> pre-flight repairs -> resolve -> decide -> execute/record
```

The grammar per use case is a pair of files:

```text
service/create.rs          # the pipeline fn, resolve_create_context(), the
                           # private Context struct, the effects fn
service/create_policy.rs   # pure rules: (Context, Input) -> Plan
```

Rules:

- The **Context** (all fetched truths, one per line) is private to the
  use-case file. It is never exported, stored, or shared between use cases.
- **Policy files are pure**: no `&self`, no IO, no `Utc::now()`, no
  `Uuid::new_v4()`. Identity and clock are effects, minted in the
  execute/record step. Policy may read static bundled truth; dynamic truth
  arrives via the Context.
- A rule shared by several use cases graduates to one named domain-level home
  (the access gate pattern). The same rule decided in two places is the
  highest-priority smell.
- Inputs with more than 3 fields become one input struct in `model.rs`,
  replacing positional relays through service/runtime layers.
- Below the thresholds, everything collapses inline: one fetch is a `let`, one
  rule is an `if`. Ceremony is earned.

In-repo exemplar: `domains/artifacts` (typed `ArtifactCreatePlan` /
`ArtifactUpdatePlan` produced by plan functions, effects owned by the runtime).

## Growth Rules

The most common failure mode is letting a domain grow by appending methods to a
single `store.rs`, `service.rs`, or `runtime.rs`. Split by responsibility before
the file becomes a god module.

### Store Growth

Promote `store.rs` to `store/` when there is more than one table family or
query family.

```text
store/
  mod.rs
  sessions.rs
  events.rs
  raw_notifications.rs
  live_config.rs
  pending_prompts.rs
  background_work.rs
```

Store files split by durable data family, not by API route.

### Service Growth

Promote `service.rs` to `service/` when durable rules separate into named use
cases.

```text
service/
  mod.rs
  create.rs
  config.rs
  list.rs
  title.rs
  summaries.rs
```

Service files split by durable rule family. They do not hide live orchestration.

### Runtime Growth

Promote `runtime.rs` to `runtime/` when workflows bridge multiple services or
live systems.

```text
runtime/
  mod.rs
  create.rs
  prompt.rs
  resume.rs
  fork.rs
  interactions.rs
  pending_prompts.rs
```

Runtime files split by workflow family. If a workflow is actually actor state,
stream state, or pending callback state, it belongs in `live/**`, not a domain
runtime.

### Concept Promotion

Promote a named concern into its own folder when it has any of:

- its own durable model/store/service set
- its own lifecycle or background reconciliation
- its own MCP server or session extension
- repeated files with a stable concept name
- tests that naturally group around that concern

Do not promote a concern folder just to shrink a file.
`domains/sessions/title/{store,service}.rs` is wrong; `service/titles.rs` +
`store/sessions.rs` is right.

Examples:

```text
domains/sessions/links/
domains/sessions/subagents/
domains/workspaces/materialization/
domains/workspaces/archive/
domains/workspaces/deletion/
```

## Extension Points

Core domains may define extension traits when product surfaces need lifecycle
hooks.

Example:

```text
domains/sessions/extensions/
  SessionExtension
```

Product surfaces implement the trait:

```text
domains/cowork/session_extension.rs
domains/reviews/session_extension.rs
domains/sessions/subagents/session_extension.rs
```

`app/` wires implementations into the core. The core domain depends only on the
trait.

The same define-here/implement-there pattern runs in both directions. A domain
implements ports defined elsewhere in a dedicated `*_ports.rs` /
`*_observer.rs` file — pure trait impls, no new behavior homes:

```text
domains/plans/session_ports.rs
  implements sessions-defined plan-reference/interaction-link resolver traits

domains/sessions/live_ports.rs
  implements live's durable-capability traits (EventPersist, QueueDurable,
  BackgroundWorkDurable, SessionStateDurable, AttachmentSource from
  live/sessions/model.rs) as 1:1 delegation over SessionStore and the
  attachment storage
```

Product reactions to a live session use the live-defined hook ports the same
way (see `guides/live-runtime.md` for the mechanism decision table):

```text
domains/plans/session_observer.rs     SessionEventObserver: plan sniffing
domains/reviews/session_observer.rs   SessionEventObserver: candidate plans
                                      (registered after the plans observer)
domains/plans/permission_advisor.rs   PermissionAdvisor: plan-linked
                                      permissions, predecided answers
domains/plans/decision_op.rs          SessionDomainOp: approve/reject,
                                      serialized through the actor mailbox
```

`app/sessions.rs` wires these into `ActorCapabilities`; the live layer depends
only on its own traits.

## MCP Placement

MCP crosses several owners. Do not put all MCP code in one folder.

Domain-owned MCP code is product behavior:

```text
domains/<feature>/mcp/
  definition.rs
  auth.rs
  context.rs
  tools.rs
  calls.rs
  mod.rs
```

Use this shape when the MCP tools are part of the domain's product behavior.

File roles:

```text
definition.rs
  stable id, route slug, ACP server name, display name, instructions,
  prompt policy, and binding summary metadata

auth.rs
  thin feature wrapper around shared product MCP auth/token mechanics

context.rs
  resolve workspace/session/domain records and validate that this tool call
  applies to the current product context

tools.rs
  tool schemas and mutating tool name list

calls.rs
  actual product tool implementations

mod.rs
  product MCP server struct and ProductMcpServer implementation
```

Examples:

```text
domains/agent_operations/mcp/
domains/cowork/mcp/
domains/reviews/mcp/
```

Generic MCP protocol/server mechanics do not belong in domains:

```text
integrations/mcp/product_server/
integrations/mcp/json_rpc.rs
integrations/mcp/tools.rs
integrations/mcp/capability_token.rs
```

Session launch assembly does not belong in product domains either:

```text
domains/sessions/mcp_bindings/assembly.rs
domains/sessions/mcp_bindings/product_catalog.rs
domains/sessions/mcp_bindings/product_registry.rs
```

The distinctions:

```text
domains/<feature>/mcp
  what this product MCP does

integrations/mcp/product_server
  how every product MCP speaks MCP/JSON-RPC consistently

domains/sessions/mcp_bindings/product_registry.rs
  serving-side registry: incoming route slug -> product MCP handler

domains/sessions/mcp_bindings/product_catalog.rs
  launch-side facade: select and materialize product MCP launch extras for this session

domains/sessions/mcp_bindings/assembly.rs
  whole-session composer: user MCPs + product MCPs + session extensions +
  prompt extras + summaries

api/http/product_mcp.rs
  incoming HTTP endpoint wrapper

app/
  product MCP endpoint registration
```

Add a new product MCP by touching the product and composition points, not by
forking transport or protocol machinery:

```text
1. Add domains/<feature>/mcp/{definition,auth,context,tools,calls}.rs.
2. Implement ProductMcpServer in domains/<feature>/mcp/mod.rs.
3. Register the server in app's ProductMcpEndpointRegistry wiring.
4. Add selection predicate and HTTP materialization in
   domains/sessions/mcp_bindings/product_catalog.rs.
5. Add tests for auth, selection, injection, tools/list, tools/call, and
   endpoint dispatch.
```

## Contract Types

Do not import contract request/response types into domains. Use internal
domain models and API mappers. Domain models are the lingua franca between
domains: cross-domain composition passes domain models as-is and never
translates them.

Exception: session event payloads may use contract event types when those types
are the durable event-log payload. The exception is for event payloads only —
contract types as a domain's working model or as persisted rows are
violations.

Migration exceptions (the rule is the law; this is the debt):
`domains/agents/auth` uses contract auth structs end-to-end.
Target: domain twins minted at the API seam. (The sessions runtime's former
fetching response mapper is resolved: `runtime/view.rs` composes `SessionView`
and the API maps it dep-lessly.)

## Errors

One error enum per public surface (thiserror). Each layer adds only the
variants it introduces and absorbs lower errors with `#[from]` /
`#[error(transparent)]`. Banned: twin enums joined by hand-written
variant-copying mappers; `.to_string()` / `anyhow::anyhow!` applied to typed
errors; control flow on `message.contains(...)`. Expected outcomes
(not-found, needs-selection, already-done) are data in the `Ok` type, not
error strings. The HTTP mapping for a domain's errors lives in exactly one
`api/http/<resource>_errors.rs` `From` impl.

---

# AnyHarness App Composition

## Purpose

`app/` is the composition root for the AnyHarness runtime.

It constructs the runtime dependency graph once, stores it in `AppState`, and
passes that graph to API handlers. It may know about every layer because its
job is wiring. It should implement almost no product behavior.

The mental model:

```text
Db
  -> stores
    -> services
      -> runtimes/managers
        -> API handlers
```

`app/` is allowed to import domains, live managers, adapters, integrations,
persistence, and observability. Most other layers should not import `app/`.

## Why AppState Exists

Do not replace `AppState` with imported singletons.

AnyHarness needs an explicit runtime graph because many dependencies are
process-specific:

- runtime home
- runtime base URL
- bearer token
- runtime target id
- SQLite connection pool
- encryption/cipher configuration
- live managers and registries
- operation gates and shared caches
- startup background tasks
- session extension implementations
- product MCP endpoint registry

Singleton imports hide startup behavior, make tests leak state, and make
multi-profile local development harder. `AppState::new` makes construction,
configuration, sharing, and task startup deliberate.

## Current Shape

Current small shape:

```text
app/
  mod.rs
  tests.rs
```

`mod.rs` currently owns:

- `AppState`
- `AppState::new(...)`
- process/runtime config loading
- store construction
- service construction
- runtime construction
- live manager construction
- session extension wiring
- product MCP endpoint registry wiring
- startup task wiring

This is acceptable while the composition root is one readable file. Split it
only when a named wiring family becomes easier to read as its own module.

## What Goes In AppState

Put a constructed value in `AppState` when callers need one shared runtime
instance with process-specific config, state, or dependencies.

Good `AppState` values:

```text
SessionStore
SessionService
SessionRuntime
WorkspaceRuntime
LiveSessionManager
Terminal manager/service
ProductMcpEndpointRegistry
ReviewRuntime
PlanRuntime
AgentAuthService
RuntimeConfigService
```

Do not put pure helper functions in `AppState`. If something is stateless,
testable with plain inputs, and does not need shared process config, keep it in
the owning module as a function.

## Construction Order

`AppState::new` should read like construction, not behavior:

```text
1. Read process-level config/env.
2. Create storage infrastructure.
3. Create domain stores.
4. Create domain services.
5. Create live managers.
6. Create domain runtimes.
7. Wire session extensions.
8. Register product MCP endpoint servers.
9. Start owned startup/background tasks.
10. Return AppState.
```

If a branch decides how sessions, workspaces, agents, reviews, MCPs, or
terminal workflows behave, move that branch to the owning domain/runtime/live
module.

## Per-Domain Wiring

Each domain exposes one constructor entry — a `wire(deps) -> <Domain>` (or a
deps-struct + build fn) — that owns the construction details only that domain
knows. `AppState::new` then reads as a table of contents: one line per domain,
in dependency order. The in-repo template is `app/product_mcp.rs` (named deps
structs destructured into a single build fn).

Shared-instance law: a service consumed by both a domain's facade and another
domain (readiness, agent auth, gates) is constructed **once** and the same
instance is injected into both. Who-holds-what must be readable from the
`wire()` signatures alone — that visibility is the point of explicit wiring.
Every service's `&self` field list is its license; `app/` is where licenses
are granted.

Migration exception: `AppState::new` is currently ~335 lines of inline
construction for ~12 domains with no per-domain entry points. Target: the
wiring-family split below, one `wire()` per domain.

## Session Extensions

Core domains should not import product domains directly.

When a product domain needs to participate in a core lifecycle, the core domain
defines an extension trait and `app/` wires implementations into the core.

Example:

```text
domains/sessions/extensions
  defines SessionExtension

domains/cowork/session_extension.rs
domains/reviews/session_extension.rs
domains/sessions/subagents/session_extension.rs
  implement the trait

app/
  constructs implementations
  passes them into SessionRuntime
```

This keeps `sessions` core, while letting product surfaces participate in
launch, prompt, config, or close boundaries.

## Product MCP Endpoint Registry

`app/` owns product MCP endpoint registration because it is composition.

It constructs the concrete product MCP servers and registers them with the
generic serving-side registry:

```text
ProductMcpEndpointRegistry
  route_slug -> ProductMcpEndpointHandler
  product_id -> ProductMcpEndpointHandler
```

`app/` may list product MCP servers:

```text
WorkspaceProductMcpServer
ReviewProductMcpServer
CoworkProductMcpServer
```

`app/` must not implement tool behavior, token semantics, or session selection
policy:

```text
api/http/product_mcp.rs
  HTTP route/auth/gating/response mapping

domains/<feature>/mcp
  product tool behavior

domains/sessions/mcp_bindings/product_registry.rs
  serving-side registry shape

domains/sessions/mcp_bindings/product_catalog.rs
  launch-side facade: select and materialize product MCP launch extras for this session

integrations/mcp/product_server
  reusable MCP JSON-RPC server framework
```

## Growth Rules

If `app/mod.rs` grows too large, split by wiring family:

```text
app/
  mod.rs
  sessions.rs
  workspaces.rs
  agents.rs
  product_extensions.rs
  product_mcp.rs
  startup_tasks.rs
```

Those files still only wire dependencies.

Good app split:

```text
app/product_mcp.rs
  construct and register product MCP endpoint servers
```

Bad app split:

```text
app/product_mcp.rs
  implement cowork/review/subagent tool behavior
```

Use this test:

```text
Could this code be described as "construct X and pass it to Y"?
  yes -> app is plausible

Could this code be described as "decide what the product should do"?
  yes -> owning domain/runtime/live module
```

## Anti-Patterns

Avoid:

- product policy inside `AppState::new`
- raw SQL in `app/`
- actor command construction in `app/`
- direct HTTP response mapping in `app/`
- `AppState` passed deep into domain logic
- hidden module-load singletons that read env, open DBs, or spawn tasks
- app files named `helpers.rs`, `utils.rs`, or `misc.rs`

`AppState` is a dependency graph, not a service locator. API handlers may pull
coarse-grained dependencies from it. Lower layers should receive the narrow
dependencies they need.

---

# AnyHarness API Layer

## Purpose

`api/` is the transport boundary. It owns how clients reach the runtime, not
the runtime behavior itself.

API code may own:

- route registration
- URL path and HTTP verb shape
- request extraction
- header/query/path/body parsing
- transport-level authentication and admission
- operation gates when they are route-scoped admission checks
- contract request/response mapping
- error-to-problem mapping
- OpenAPI registration
- SSE and WebSocket transport details

API code must not own:

- durable product rules
- raw SQL
- live actor state machines
- MCP tool behavior
- session launch policy
- agent install/readiness policy
- workspace lifecycle policy

The shortcut:

```text
api/ receives the outside shape and calls the owner.
It is the front desk, not the factory.
```

## Folder Shape

Target shape:

```text
api/
  mod.rs
  router.rs
  auth.rs
  openapi.rs
  http/
  sse/
  ws/
```

### `router.rs`

`router.rs` builds the Axum router.

It owns:

- URL paths
- route grouping
- HTTP verbs
- route-level middleware
- body limits
- transport admission plumbing

It should not implement product workflows. If a route needs a multi-step
workflow, the router should point to a handler that calls the owning
domain/runtime.

### `auth.rs`

`auth.rs` owns API-level auth extraction and transport admission.

It may turn request auth material into an API auth context and API auth errors.
It should not become product policy. Product ownership, mutability, billing,
workspace lifecycle, and session-specific permission decisions belong in the
owning domain/runtime.

### `openapi.rs`

`openapi.rs` owns OpenAPI schema generation and route/type registration.

It should depend on contract-visible types and route metadata. It should not
pull runtime behavior into schema generation.

### `http/**`

`http/**` owns normal request/response handlers, split by route resource:

```text
api/http/
  sessions.rs
  workspaces.rs
  agents.rs
  files.rs
  git.rs
  product_mcp.rs
  error.rs
  access.rs
  *_contract.rs
```

Every handler is the same stanza, and nothing else:

```rust
assert_<scope>_auth(&auth, ...)?;                   // 1. authorize: ONE named assertion
let input = <usecase>_input(req)?;                  // 2. translate in — OPTIONAL, earned at
                                                    //    >3 fields; otherwise pass plain args
let result = state.<domain>.<usecase>(input).await?; // 3. call ONE use case; errors ride `?`
Ok(Json(<resource>_response(result)))               // 4. translate out (dep-less seam fn)
```

`result` is usually the plain domain record; it is a composed view model only
when the response needs composition — and assembling that view is the use
case's job, never the handler's or the mapper's.

Litmus rules (greppable):

- no `if`/`match`/loop beyond the `?`s
- no second domain/service call, no fetches, no business validation
- no `tracing::` calls (the middleware span owns the request)
- no `.map_err` (a `From` impl in `<resource>_errors.rs` makes errors flow)
- no inline auth matches — named assertions from `access.rs` only
- no imports from `domains/**` beyond the called surface and its input/view
  types

One sanctioned addition to the stanza: a route-scoped workspace operation
gate (see Operation Gates below) may precede step 3 when it wraps exactly one
call — it counts as transport admission, not a second domain call. If the
lease must span a multi-step workflow, the workflow and the lease both belong
in the domain runtime.

Authorization here answers "who is asking". Business preconditions ("is this
workspace mutable right now") belong inside the domain use case — a flow
checking both is correct; the edge checking preconditions is not.

Proportionality: the `*_input()` constructor is earned at >3 fields or when
defaults/grouping logic exists; below that, passing `&req.name` as a plain
argument IS the translation — the invariant is "no contract type crosses into
`domains/`", not "a constructor function exists". GET handlers drop step 2
entirely (`Path(id)` is already the input). The outbound `*_response()`
constructor always exists — that is where wire stability lives.

If a handler contains product sequencing, move that sequence to the owning
domain `runtime.rs` or `service.rs`.

`workspaces_lifecycle.rs` is the archive/unarchive pair, and it is the stanza
with nothing added: each handler authorizes, maps the request body into the
domain's own options type, calls one use case on
`state.workspace_archive_service`, and maps the outcome back. The whole archive
ordering story — quiesce, capture, the flip, the detached tail — lives in
`domains/workspaces/archive/`, so neither handler branches on anything. Both
take an OPTIONAL body so a bare `POST` with no `Content-Type` still converges,
because the request that matters most (a re-POST that finishes an interrupted
cleanup) is the one a human is most likely to issue by hand.

Their typed refusals ride `ProblemDetails.extra`, the one structured extension
slot: `WORKSPACE_UNARCHIVE_SCENARIO` carries the scenario body with its
`strategies` list, and `WORKSPACE_GIT_LOCKED` carries the offending lock
`file`. Before `extra` existed, a client needing either had to parse the human
sentence in `detail`. The SDK passes `extra` through untouched — the code→shape
table lives next to the status mapping in
`workspaces_lifecycle_errors.rs`.

### `sse/**`

`sse/**` owns server-sent event transport details:

- subscription setup
- replay/catch-up transport shape
- stream cancellation/close behavior
- mapping internal event envelopes into SSE frames

SSE code should not decide durable event meaning. Session event meaning belongs
in session domains/live event sinks/stores.

### `ws/**`

`ws/**` owns WebSocket transport details:

- socket upgrade handling
- socket message parsing
- socket close behavior
- mapping socket messages to live/domain calls

WebSocket code should not own terminal business logic, PTY lifecycle, or
durable terminal state.

## Support Files

Use focused API support files when handler files get large:

```text
api/http/error.rs
  ApiError and HTTP problem response mapping.

api/http/access.rs
  Shared API-level session/workspace access assertions.

api/http/<resource>_contract.rs
  internal <-> contract mappers when mapping is large.
```

These support files are still transport files. They should not become product
service layers.

## Contract Mapping

Contract request and response types belong at the API boundary.

Preferred:

```text
api/http/<resource>.rs
  route handlers

api/http/<resource>_contract.rs
  internal <-> contract mappers when the mapping is large

api/http/<resource>_errors.rs
  one From<DomainError> for ApiError impl per domain error type
```

Seam-file law: mappers are **sync, dep-less, and decisionless** — no
`&AppState`, no store reads, no live lookups, no clock, no business branches.
A mapper that needs to fetch means the use case returned too little; fix the
use case's return type (a view model composed by the runtime), never the
mapper. Each type pair has exactly one mapper.

Do not pass contract request/response types deep into domains or live runtime
code.

Exception: normalized session event payloads may be contract types below
`api/` when they are explicitly the durable event-log payload.

Migration exceptions: `sessions_contract.rs::session_to_contract` delegates to
an async fetching mapper on the session runtime (store reads + live lookups
per record, called in a loop on list paths); `api/http/agents_model_registry.rs`
carries a second error mechanism (`ProblemResponse`) alongside `ApiError`;
`cowork.rs`
and `mobility.rs` carry duplicate copies of mappers owned elsewhere. Targets:
runtime-composed `SessionView` + dep-less mapper; one `ApiError` mechanism;
one mapper per type pair.

## AppState Use

Handlers pull coarse-grained dependencies from `AppState`:

```rust
state.session_runtime
state.session_service
state.workspace_runtime
state.terminal_service
state.product_mcp_endpoint_registry
```

Handlers should not use `AppState` fields to manually reconstruct workflows
that a domain runtime already owns.

Good:

```text
handler -> SessionRuntime.send_prompt(...)
```

Bad:

```text
handler -> session store + workspace service + MCP assembly + live actor command
```

## Operation Gates

Workspace operation gates may be acquired in API handlers when they are
transport-scoped admission checks around a single call.

Examples:

- a mutating product MCP `tools/call`
- a route-level workspace write guard before dispatch

If the lease is part of a deeper product workflow, move the workflow and lease
ownership into the domain runtime.

## Product MCP Endpoint

`api/http/product_mcp.rs` is a transport wrapper around product MCP servers.

It owns:

- the generic product MCP HTTP route
- extracting `workspace_id`, `session_id`, and `product_mcp_slug`
- looking up the registered handler by route slug
- reading the product MCP token header
- calling token validation
- acquiring a workspace operation gate for mutating tools
- dispatching into the shared MCP server framework
- mapping errors and responses to HTTP

It must not own:

- tool behavior
- product MCP selection
- product MCP launch injection
- MCP JSON-RPC protocol mechanics

The end-to-end placement:

```text
api/http/product_mcp.rs
  incoming HTTP endpoint

domains/sessions/mcp_bindings/product_registry.rs
  serving-side route_slug -> product MCP handler map

integrations/mcp/product_server
  shared JSON-RPC dispatcher and ProductMcpServer trait

domains/<feature>/mcp
  product tool behavior

domains/sessions/mcp_bindings/product_catalog.rs
  launch-side facade: select and materialize product MCP launch extras for this session
```

## Smells

Move code out of `api/` when a handler:

- writes SQL directly
- constructs actor commands directly
- imports live actor/driver internals
- assembles MCP launch payloads
- parses vendor CLI output
- decides workspace retention/purge policy
- decides agent readiness/install policy
- contains a multi-step product workflow that would need tests without HTTP
- maps local adapter errors with product policy mixed into the adapter call

API handlers should be boring. Boring is the point.

---

# Contract Crate

`anyharness-contract` is the transport schema crate for AnyHarness.

## Allowed Location

- `anyharness/crates/anyharness-contract/src/**`

## Owns

- HTTP request bodies
- HTTP response bodies
- SSE payload schemas
- WebSocket payload schemas
- public enums visible to SDK consumers
- OpenAPI-visible struct and enum definitions
- API version folders such as `v1/`

## Must Not Own

- runtime services
- database records
- process handles
- filesystem and environment discovery
- business orchestration
- persistence helpers
- `axum` handlers
- `anyhow`-style workflow logic

## Versioning Rule

Transport schemas must live under an explicit version folder:

- `v1/common.rs`
- `v1/errors.rs`
- `v1/health.rs`
- `v1/agents.rs`
- `v1/session_config.rs`
- `v1/workspaces.rs`
- `v1/sessions.rs`
- `v1/files.rs`
- `v1/git.rs`
- `v1/terminals.rs`
- `v1/processes.rs`
- `v1/hosting.rs`
- `v1/events.rs`

Future breaking versions should become sibling folders such as `v2/`, not
unstructured replacements.

## Module Map

### `common.rs`

Owns shared identifier aliases used by the public API surface.

### `errors.rs`

Owns `ProblemDetails`, the canonical wire error shape returned by HTTP
endpoints.

For handled runtime incidents, `instance` is the mixed-deployment capability
receipt. AnyHarness mints one UUID, emits one bounded runtime-owned event, and
returns `urn:proliferate:anyharness:incident:<uuid>` in that existing field.
Callers may suppress their duplicate capture only after exact receipt
validation; absent, malformed, or foreign instances retain legacy capture.

### `health.rs`

Owns health-check response types.

`HealthResponse.agentSeed` is a public packaging/readiness diagnostic. It must
stay low-cardinality: status, source, ownership, action, counts, target, seeded
agent names, and coarse failure kind are allowed; absolute paths, raw errors,
archive names, checksums, and install logs are not.

### `agents.rs`

Owns agent-facing transport types:

- readiness/install/credential state enums
- artifact status
- agent summary
- install/login/reconcile request and response shapes
- exact target-observed `HarnessLaunchOptions` models, generic controls,
  defaults, basis/revision, and probe state

### `session_config.rs`

Owns the full session-local `SessionLiveConfigSnapshot`: exact models, generic
controls and allowed values, complete current values, monotonic source sequence,
and compatibility presentation groupings. The exact full fields—not the
groupings—are the active-session authority.

### `workspaces.rs`

Owns workspace-facing transport types:

- workspace summary
- create and resolve requests
- worktree creation request and response
- missing-worktree restore response, including `restored` and idempotent
  `already_present` outcomes
- setup-script execution payload

Workspace and session `origin` fields are advisory provenance read models only.
They must not be used as authority for authorization, billing, mutability,
sandbox ownership, MCP inheritance, or policy selection.

### `sessions.rs`

Owns session-facing transport types:

- session summary
- create and reconfigure requests
- optional resume request body
- redacted MCP binding summary read models
- prompt request and response
- pending-prompt edit, delete, exact-order, and steer requests
- interaction resolution request

`PromptInputBlock` is the client-to-runtime prompt shape. Plan handoff uses
`PromptInputBlock::PlanReference` with only `planId` and `snapshotHash`; the
runtime must resolve the trusted plan snapshot from its own store before any
agent input is produced. Clients must not send plan markdown as authority.
Image and embedded resource prompt blocks may carry optional attachment
`source` metadata (`upload` or `paste`). Source is display metadata only and
must not be used as an authorization, trust, or storage boundary.

Prompt provenance is a read-only display model on transcript user-message
payloads and pending-prompt summaries/events. Public prompt request bodies must
not accept provenance as trusted input. The public variants are deliberately
bounded to display-safe `agentSession`, `subagentWake`, and `system` shapes;
internal automation provenance is redacted or omitted rather than exposed
directly.

Pending-prompt sequence numbers are immutable, runtime-owned queue-entry
identities. They come from a durable per-session monotonic cursor and are never
reused after execution or deletion. Array order is the queue position.
`promptId` is only local-outbox reconciliation metadata and may be absent or
duplicated. Reorder requests carry both the exact order the caller observed and
the desired exact permutation; a changed current order is a typed 409 conflict.
`pending_prompts_reordered` carries the complete authoritative queue after the
runtime commits; reducers replace their queue from that payload rather than
applying it as a relative move. Keeping `seq` stable also makes older reducers
safe when they ignore the newer full-order event and later receive row updates
or removals.

`Session.mcpBindingSummaries` is a non-secret launch-time read model. It may
describe which MCP bindings were applied or not applied, but it must not carry
URLs, headers, env vars, command args, absolute paths, tokens, or raw error
strings. `null` means the session predates this read model or the state is
unknown; it does not mean the session had no MCP bindings.

`ResumeSessionRequest` must remain backwards-compatible with no body and `{}`.
When present, it may carry refreshed secret-bearing `mcpServers` plus matching
redacted `mcpBindingSummaries`; runtime liveness remains authoritative for
whether those refreshed bindings are persisted. An explicit empty
`pluginBundle` is a clear request and must be sent with an MCP refresh; this
keeps the clear self-contained after a runtime process restart.

`CreateSessionRequest.subagentsEnabled` remains accepted and persisted for
wire and mobility compatibility. Omitted values default to enabled. Workspace
attachment and current Agent Operations authority do not consult this legacy
flag. Resume requests do not carry it; resumed sessions retain the persisted
compatibility value.

### Cloud Access And Optional Worker Interaction

Managed Cloud does not translate product actions into a Worker command
protocol. The server creates worktrees by calling the normal AnyHarness
workspace API directly, and the cloud-sandbox gateway proxies ordinary
AnyHarness HTTP/WebSocket requests from authorized clients. Session events
remain AnyHarness runtime truth and are consumed through the normal runtime
contracts; the Worker does not upload Cloud event batches.

The optional Proliferate Worker uses a narrow catalog-and-health portion of the
AnyHarness HTTP contract:

| Worker purpose | AnyHarness route | Notes |
| --- | --- | --- |
| read active catalog version | `GET /v1/catalogs/agents/version` | Read-only observability; the only catalogs route the runtime exposes. There is no apply/push route — the catalog is binary-only ([agent-distribution.md](../systems/harnesses/distribution.md) "Convergence"). |
| verify a relaunched runtime | `GET /health` | Requires the desired AnyHarness version before accepting an in-place runtime update. Only a legacy (non-supervisor-owned, pre-bridge) target's Worker runs this gate itself; every other target is supervisor-owned, where Proliferate Supervisor runs the equivalent health-gate on its own activation. |

The Worker's download, checksum, preflight, swap, and relaunch orchestration
lives outside the AnyHarness API. Only the final health/version gate uses the
runtime HTTP surface.

### `files.rs`

Owns workspace file listing, read, write, and stat wire formats.

### `git.rs`

Owns normalized git response types:

- status snapshots
- changed files
- diff response
- branches
- stage/unstage/commit/push requests and responses

### `terminals.rs`

Owns terminal record and create/resize requests.

### `processes.rs`

Owns one-shot command execution request and response types.

### `hosting.rs`

Owns pull-request request and response types.

### `events.rs`

Owns the normalized session event stream:

- `SessionEventEnvelope`
- `SessionEvent`
- lifecycle events
- transcript item payloads
- config updates
- interaction events
- error events

This file is the public transcript/event contract and must remain stable and
well-structured.

`SessionEvent::SubagentTurnCompleted` is retained legacy relationship-completion
metadata, not a transcript item and not the automatic parent delivery or
delivery acknowledgement. SDK reducers and UI consumers should not render it as
assistant or user content by default or infer that a parent notification became
visible from its presence. Automatic parent delivery is represented by the
attributed user-message transcript item whose `promptProvenance` is
`subagentWake`; the legacy event only carries the durable `completionId`,
`sessionLinkId`, child identifiers, child last event seq, outcome, and optional
label.

Interaction payloads should expose only typed, UI-safe fields. Adapter-specific
metadata that becomes stable UI behavior must be promoted into a typed contract
field, such as `PermissionInteractionContext`, instead of being read from raw
ACP `_meta` or raw tool input/output blobs.

Adapter permission producers may provide display-safe context in vendor-scoped
ACP metadata, currently `_meta.claudeCode.permissionContext` and
`_meta.gemini.permissionContext`. `anyharness-lib/src/integrations/acp` is the
only layer
that should read those keys; SDK and Desktop consumers must use the normalized
typed `PermissionInteractionContext` carried by interaction events and pending
interaction summaries.

`ContentPart::ProposedPlan` and `ContentPart::PlanReference` intentionally
represent different workflows even though they carry the same immutable plan
snapshot fields. `ProposedPlan` is agent-emitted transcript content with
decision UI. `PlanReference` is a user-prompt echo showing that a stored plan
snapshot was attached to a prompt.
`ContentPart::Image` and `ContentPart::Resource` may echo attachment `source`
metadata so clients can render uploaded and pasted resources differently
without inferring behavior from names or URIs.

## Transport-Only Rule

The contract crate is for wire shapes, not internal domain flow.

That means:

- if a service needs an internal result type, define it in `anyharness-lib`
- if a store needs an internal record, define it in `anyharness-lib`
- if a handler needs to return a public shape, convert to a contract type there

Contract types are not internal service result types.

## Serialization Rules

- use explicit serde casing
- prefer stable public names over mirroring internal field names
- keep transport enums descriptive and bounded
- avoid leaking backend-only implementation details onto the wire

## OpenAPI Rule

If a type must appear in OpenAPI or the generated SDK, it belongs here.

If a type is only needed for runtime execution, persistence, or adapter
behavior, it does not belong here.

## Mobility Archive Rule

Workspace mobility archives are public transport. If a workspace contains a
delegated-session graph, the archive must preserve `session_links` and
`session_link_completions` when both linked sessions are included. Pending
`session_link_wake_schedules` travel only for Cowork links; delegated-agent
links neither export nor import them. Export must block with a clear preflight
error when only one side of a live link would be moved, because importing a
partial graph would break durable relationship ownership.
The optional `subagentClosedAt` field preserves reversible Closed state across
mobility; absence remains backward-compatible and means Open.

Pending prompts preserve their stable prompt identity, structured content, and
read-only `provenanceJson`, including canonical `subagentWake` attribution.
Pending or enqueued automatic completion deliveries travel in
`sessionLinkCompletionDeliveries` with their stable delivery/completion/link and
parent/child/turn identities, outcome and notification content, delivery state,
`parentPromptSeq`, retry count/schedule/error, and enqueue timestamps. Ephemeral
lease token and lease-expiry fields never travel. Export must read session,
prompt, event, subagent-graph, and completion-delivery rows from one coherent
durable snapshot so an archive is entirely before or entirely after atomic
completion admission, never a mixture of the two states.

---

# ACP Runtime

`anyharness-lib/src/integrations/acp/**` owns remaining shared ACP helper
modules: permission context mapping (`permission_context.rs`), permission
payload normalization (`permission_payload.rs`), and provider error mapping
(`provider_errors.rs`).

Live ACP-backed session runtime now lives under `live/sessions/**`. This legacy
subsystem doc maps the old "ACP runtime" concepts to current implementation
paths: manager, handle, actor, driver, sink, rendezvous, background
work, and replay are all under `live/sessions/**`.

## Core Concepts

The ACP runtime starts after the session domain has already decided that a
session exists and should run live.

The live ACP session runtime owns:

- the in-memory registry of live sessions
- one actor per live session
- the ACP stdio connection to the agent process
- interaction mediation for ACP permission requests
- normalization of ACP-native notifications into AnyHarness session events

It does not own session creation validation, workspace registration, or agent
installation.

## Core Runtime Objects

### `LiveSessionManager` (`anyharness/crates/anyharness-lib/src/live/sessions/manager/**`)

`LiveSessionManager` is the process-local coordinator for live sessions.

It owns:

- the in-memory `session_id -> LiveSessionHandle` map
- the shared `InteractionRendezvous`
- the start/inject sequencing critical section for session events

Its main jobs are:

- prevent duplicate actor startup for the same session
- seed actor event sinks from the latest durable event seq
- coordinate offline runtime event injection with actor startup
- build `SessionActorConfig`
- create the live broadcast channel
- spawn the actor and return its control handle
- run the idle-session reaper

#### Idle-session reaper (`live/sessions/manager/reaper.rs`)

A live agent session costs a fixed amount of memory for as long as its processes exist, and it never returns any of it: a session that has run one turn keeps its retained conversation indefinitely, so waiting reclaims nothing. Retiring the actor is the runtime's only reclaim mechanism, and it reclaims the whole session rather than the post-turn increment.

`spawn_idle_reaper` starts one sweep task per manager, wired in `app/sessions.rs`. Each sweep retires every live session that has been continuously quiescent for the threshold. Quiescent means all of: phase `Idle`, no pending interactions, the handle's busy flag clear, no pending `session_background_work` rows, an empty `session_pending_prompts` queue, no pending wake schedule whose delivery needs a live parent, and a durable shape the startup matrix would accept back. A durable read that fails is `Undetermined` and never reaps; the predicate fails closed.

Two of those conditions exist because retirement is only safe for a session that can come back, and only for a session nothing is about to send to:

- **Relaunchability.** The predicate runs the same decision the next prompt will run (`choose_session_startup_strategy`) and refuses to reap a session it returns an error for. The case that matters is a process-local (Claude) zero-turn fork child: it is inserted with `last_prompt_at: None`, finalizes to `Idle`, and `choose_fork_child_strategy` refuses to recover it on a cold actor, so reaping it would be permanent rather than non-terminal.
- **Pending wakes.** A `cowork_coding_session` completion delivers its parent wake through `acp_manager.get_handle(...)` and silently drops it when the parent is not live, and nothing scans for stranded pending prompts. So a parent holding a wake schedule on any relation other than `subagent` is held back. `subagent` parents stay reapable because their completions go through `session_link_completion_deliveries` and `CompletionDeliveryWorker` cold-starts the parent itself.

`AwaitingInteraction` is never reaped. A parked permission or input request belongs to a human, and the retirement path would cancel it along with the turn it is blocking. Sessions in that state are emitted per sweep under `result_class = "awaiting_interaction_held"`, and sessions held by a pending background-work row under `result_class = "background_work_held"`. Both are per-sweep GAUGES of a population that cannot be reaped, not counts of sessions that were otherwise ready: the checks run ahead of the threshold, so an ordinary in-flight permission prompt on a three-second-old session is counted too, and the same session is re-counted every sweep. They exist because both classes can leak permanently (`BackgroundWorkOptions::default()` sets `stale_after: None`, so an abandoned tracker's `pending` row never expires) and the alternative is that the leak is invisible.

Retirement is the existing non-terminal `Unload` disposition, so the durable session row, transcript, configuration, and `native_session_id` all survive; the next prompt resumes through the ordinary startup strategy matrix. The reaper writes nothing durable itself. The actor's exit sequence signals the agent's whole process GROUP rather than dropping its direct child, because the direct child is the ACP adapter and the vendor CLI beneath it is where most of a session's memory lives.

The reap is conditional, not advisory-then-forced. The sweep's verdict is stale the moment it is taken, so the reaper sends `SessionCommand::UnloadIfIdle` and the actor re-evaluates on its own loop: a running turn, a busy flag, a pending interaction, a durable queue head, or any command already sitting behind the unload in the mailbox all retain the session, and the reply names which. The residual window is between the actor accepting the unload and its handle leaving the live map: a prompt that fetched the handle inside it still reaches a closing mailbox, exactly as it does for any other unload.

The idle clock lives in the sweep task, not on the handle. Each sweep records the first tick at which a session was seen quiescent along with the live snapshot's `updated_at` activity marker; a non-quiescent observation drops the record and a changed marker restarts it, so the measured quantity is continuous idleness. Cadence is `min(threshold / 4, 15s)`.

Threshold is `ANYHARNESS_IDLE_SESSION_REAP_SECONDS`, in whole seconds, default 120. `0` disables the reaper; an unparseable value keeps the default.

### `LiveSessionHandle` (`anyharness/crates/anyharness-lib/src/live/sessions/handle.rs`)

`LiveSessionHandle` is the control surface for one live session.

It owns:

- the actor command channel
- the broadcast sender for live session events
- the busy flag used to reject concurrent prompts

Higher layers use it to:

- subscribe to live events
- send prompt / config / cancel / close commands
- gate prompt concurrency

### `SessionActorConfig` (`anyharness/crates/anyharness-lib/src/live/sessions/actor/state.rs`)

`SessionActorConfig` is the full startup input for one actor.

It includes:

- the durable `SessionRecord`
- the resolved agent launch surface
- workspace path
- workspace env
- session launch env
- session store
- shared interaction rendezvous
- resume metadata such as startup strategy and `last_seq`

This is the handoff from durable orchestration into live execution.

### `InboundDoor` (`anyharness/crates/anyharness-lib/src/live/sessions/driver/inbound/**`)

`InboundDoor` (formerly `RuntimeClient`) is the agent-initiated direction of
the AnyHarness ACP client: the connection (`driver/connection.rs`) registers
its handlers for inbound requests and notifications.

It handles:

- ACP permission requests normalized as interactions
- Codex user-input extension requests normalized as interactions
- Codex and Claude MCP elicitation extension requests normalized as
  interactions
- Claude user-input extension requests when an adapter version exposes a
  compatible AskUserQuestion bridge
- ACP session notifications

It does not own the actor loop. It translates ACP protocol callbacks into:

- interaction rendezvous requests
- internal notification messages
- normalized runtime events through the event sink

### `SessionEventSink` (`anyharness/crates/anyharness-lib/src/live/sessions/sink/**`)

`SessionEventSink` is the canonical normalization layer from ACP updates into
AnyHarness `SessionEventEnvelope`, with one ingestion entry: `sink.ingest`.

It owns:

- sequence numbering
- durable event persistence
- live event broadcast
- transcript item coalescing
- plan, tool, usage, config, interaction, and session event emission

### `InteractionRendezvous` (`anyharness/crates/anyharness-lib/src/live/sessions/rendezvous/broker.rs`)

`InteractionRendezvous` owns live pending interaction waits behind the
normalized interaction contract.

It stores:

- unresolved requests keyed by session id and request id
- per-kind validation state, such as ACP permission option ids and user-input
  question metadata

It resolves requests by:

- allow
- deny
- explicit option id
- submitted user input
- cancellation or dismissal of every live wait for a session

## Main Flow

### Session Start

The live start flow is:

1. `domains/sessions/runtime/startup.rs` decides a session should be live.
   - code: `anyharness/crates/anyharness-lib/src/domains/sessions/runtime/startup.rs`
2. It resolves workspace and agent dependencies.
3. It calls `LiveSessionManager::start_session(...)`.
4. `LiveSessionManager` enters the start/inject critical section, deduplicates by
   session id, reads the latest durable event seq, and spawns an actor if
   needed.
5. The actor launches the resolved agent-process executable with merged
   workspace and session env.
6. The actor establishes the ACP connection over child stdio
   (`driver/connection.rs`), registering the `InboundDoor` handlers.
7. The actor calls `initialize`.
8. If the agent advertises auth methods, the actor attempts `authenticate`, but
   `new_session` or `load_session` is still the real startup gate.
9. The actor either:
   - calls `new_session(...)` for a fresh session, or
   - calls `load_session(...)` when resuming
10. The actor emits startup events and persists the initial live-config
    snapshot.
11. The actor returns the native ACP session id back to the caller.

### Start/Inject Sequence Invariant

AnyHarness event `seq` values are session-local and monotonic. Live actors
normally own seq assignment through `SessionEventSink`, but runtime-owned
events may also need to be appended while no actor is live.

To prevent duplicate seq values:

- `LiveSessionManager::start_session(...)` reads `last_event_seq` only while holding
  the live-session registry write lock.
- offline runtime event injection takes the same lock, re-checks that no live
  actor exists, and appends by using one store operation that computes the next
  seq and inserts the event in a single transaction.
- live runtime event injection routes through `SessionCommand::InjectRuntimeEvent`
  so the actor’s `SessionEventSink` remains the only seq owner while the actor
  is live.
- a closed actor mailbox is not itself a sequencing handoff: stale-handle
  fallback waits for that exact actor generation to finish its final event
  writes, then re-checks the registry before either routing through a
  replacement generation or appending offline.

This lock is a process-local critical section. It must cover both the final
live-handle check and the durable seq read/append.

Injected runtime events use strict persistence: if the event cannot be written
to `session_events`, the injection returns an error and must not report success.
Existing ACP-derived events currently keep their best-effort persistence
behavior because they are emitted while processing ACP notifications; injected
events are runtime-owned calls where the caller relies on the returned envelope
as durable truth.

Replay actors reject runtime event injection. They are read-only playback
surfaces over existing events and must not mutate session history.

### Turn-Finished Notifications

At the end of each prompt turn, the session actor emits a
`SessionTurnFinishResult` to `SessionRuntime`.

The result contains:

- session id
- turn id
- outcome: completed, failed, or cancelled
- optional stop reason
- last durable event seq for the child session

`SessionRuntime` maps that actor result into extension-facing
`SessionTurnFinishedContext` and calls registered session extensions. This is
how cowork autosave and subagent parent wake behavior observe completed turns
without re-querying "latest" event state after the fact.

### Prompt Flow

The prompt flow is:

1. higher-level runtime gets a `LiveSessionHandle`
2. it sends `SessionCommand::Prompt`
3. the actor marks the session busy and updates durable status to `running`
4. `SessionEventSink` begins a turn and emits the user-message item
5. the actor calls ACP `prompt(...)`
6. while the prompt is active, the actor still processes:
   - ACP notifications
   - cancel requests
   - queued config changes
   - close requests
7. when the prompt finishes, the actor:
   - drains remaining notifications
   - emits `turn_ended`
   - updates durable status back to `idle` or `errored`
   - applies any queued config changes if now idle

### Notification and Streaming Flow

The notification flow is:

1. ACP delivers `session_notification(...)` to the `InboundDoor`
2. the `InboundDoor` forwards the notification into an internal channel
3. the actor consumes notifications
4. notification handlers in
   `anyharness/crates/anyharness-lib/src/live/sessions/actor/notifications/**`
   maps ACP updates into runtime behavior
5. `SessionEventSink` converts ACP-native chunks and tool updates into
   normalized transcript items and session events (through `sink.ingest`)
6. events are both:
   - appended durably through `SessionStore`
   - broadcast live through `tokio::broadcast`
7. the original ACP notification JSON is also appended durably for debug and
   regression capture before normalization

Important normalization behaviors:

- assistant chunks and reasoning chunks are coalesced into in-progress items
- tool calls are tracked as transcript items keyed by tool-call id
- plan updates replace the active plan item payload
- config-option updates rebuild the normalized live-config snapshot
- session info, usage, and interaction events are emitted as distinct typed
  events
- raw ACP notifications are persisted alongside normalized events so rendering
  or normalization bugs can be debugged from both views

### Interaction Flow

The interaction flow is:

1. ACP calls `request_permission(...)` or a supported extension method on
   the `InboundDoor`
   - Codex extension methods use `experimental/codex/*`
   - Claude extension methods use `experimental/claude/*`
2. the `InboundDoor` registers the rendezvous wait before making the request
   visible
3. the `InboundDoor` emits `interaction_requested` through the sink while
   publishing is locked against cleanup
4. `InteractionRendezvous` stores the pending request and waits
5. higher-level runtime resolves the request through the session actor by:
   - allow
   - deny
   - explicit option id
   - submitted input
   - cancellation
   - dismissal
6. the actor emits `interaction_resolved` exactly once and resumes the parked
   wait
7. the `InboundDoor` converts that back into the ACP or extension-specific
   response

### Config Flow

Live config changes are ACP-owned runtime operations, not pure session-store
updates.

The flow is:

1. the session runtime ensures the actor is live
2. it sends `SessionCommand::SetConfigOption`
3. the actor either:
   - applies the option immediately through ACP, or
   - queues it durably if the session is currently busy
4. ACP config updates rebuild the normalized live-config snapshot
5. the snapshot is persisted in `session_live_config_snapshots`
6. pending changes are replayed when the actor becomes idle again

Model selection has extra logic:

- try direct ACP model APIs first
- fall back to config-option setters when needed
- keep the normalized snapshot aligned with the effective current model

Most of that logic lives in
`anyharness/crates/anyharness-lib/src/live/sessions/actor/config/**`.

## Boundaries

### Live ACP Session Runtime Owns

- the in-memory live-session registry
- actor startup and shutdown
- ACP subprocess stdio lifecycle
- prompt / cancel / close execution
- live config application and queued config changes
- notification handling
- event normalization
- interaction rendezvous

### Live ACP Session Runtime Does Not Own

- HTTP, SSE, or WebSocket transport
- durable session creation validation
- session persistence schema
- workspace registration or identity rules
- agent descriptors
- installation logic
- ACP registry lookup
- pre-launch `HarnessLaunchOptions` persistence or exact create validation

## Important Invariants

- Live ACP state is process-local and in-memory.
- Durable session rows remain the source of truth for session identity.
- Event sequence numbers are monotonic per session.
- Resume starts the sink from `last_seq + 1` so live events continue the
  durable sequence.
- Only one prompt may run per live session at a time.
- Config requests must not silently disappear while a session is busy; they are
  queued durably and retried when the actor becomes idle.

## Failure Semantics

Startup can fail at several stages:

- subprocess spawn
- ACP initialize
- ACP authenticate
- ACP `new_session`
- ACP `load_session`

Prompt execution can fail independently after successful startup.

When that happens the actor is responsible for:

- surfacing a runtime-meaningful error
- updating durable session status
- emitting normalized error or session-ended events

Known provider-model rejections exposed through ACP are reduced to bounded
`ErrorEvent.code` values at the integration boundary. The original provider
message remains the technical detail; clients use the bounded code for
authored, actionable copy. A classification never changes launch-option
membership, retries a non-retryable request, or selects another model.

## Extension Points

Add behavior under `live/sessions/**` when it changes live ACP execution itself,
for example:

- new ACP notification kinds
- new normalized event behavior
- new permission-resolution behavior
- new actor commands
- new startup or resume behavior

Only add code under `acp/**` when it is a shared ACP helper that fits the
remaining permission context, permission payload, or provider error modules. Do
not add live-session behavior there.

Do not add live ACP behavior when it belongs to:

- session-domain validation
- workspace identity rules
- agent installation or registry resolution
- transport-layer request parsing

---

# AnyHarness Adapters

Adapter code lives under `anyharness-lib/src/adapters/**`.

## Purpose

Adapters perform focused operations against a local workspace or machine. They
know how to do an operation. Domains decide when and why that operation is
allowed.

Adapters are not product domains. They should be usable from tests or scripts
with explicit inputs such as a workspace root, path, command, timeout, git ref,
or provider CLI arguments. They should not need `AppState`, stores, HTTP
request context, or session runtime state.

The adapter mental model:

```text
domains   decide product policy
api       maps transport/auth/errors
live      owns currently running resources
adapters  perform local capabilities
```

Example:

```text
domains/workspaces
  decides whether dirty git status blocks archiving/deleting/migration

adapters/git
  reports git status/diff/branch facts
```

Another:

```text
api/http/files
  authenticates, resolves workspace, maps request/response

adapters/files
  resolves safe paths, reads/writes/lists/stat files
```

## Boundary Rules

Adapters may:

- call filesystem, process, git, provider CLI, and shell APIs
- parse command output
- enforce local safety checks such as path containment and timeout limits
- expose narrow capability functions
- define capability-specific input/output/error types

Adapters must not:

- own durable product rows
- import `AppState`
- import API handlers/auth/request context
- import live actors/managers/handles
- import domain services or domain stores
- decide session, workspace, mobility, review, cowork, or billing policy
- import contract request/response types as their internal model
- map errors to HTTP responses

If an endpoint exposes an adapter operation directly, the API layer still owns
transport mapping and authentication. Workspace lifecycle policy belongs in the
owning domain before the adapter is called.

## Default Shape

Adapters should use a consistent folder grammar:

```text
adapters/<capability>/
  mod.rs
  types.rs
  executor.rs      # optional
  service.rs       # optional, rare
  operations/
    <operation>.rs
```

The real adapter logic belongs in `operations/**`.

### `mod.rs`

`mod.rs` declares the module surface. It should be boring.

It may:

- declare child modules
- expose the intended public surface
- keep implementation modules private when possible

It should not:

- hold implementation logic
- grow parsers or command execution helpers
- become a convenience barrel for unrelated capabilities

Example:

```rust
pub mod types;

mod executor;

pub mod operations {
    pub mod diff;
    pub mod status;
    pub mod branches;
}
```

### `types.rs`

`types.rs` is the adapter-owned vocabulary.

It is imported by operation files and by callers that need adapter result/input
types.

Put shared adapter shapes here:

- operation inputs
- operation outputs
- local adapter errors
- small enums used by multiple operations
- typed local capability facts

Examples:

```text
GitStatusSnapshot
GitChangedFile
GitDiffScope
GitDiffResult
GitBranch
CommitError
PushError

WorkspaceFileKind
WorkspaceFileEntry
ListWorkspaceFilesResult
ReadWorkspaceFileResult
WriteWorkspaceFileResult
FileAdapterError

RunProcessRequest
RunProcessResult
ProcessServiceError

PullRequestState
PullRequestSummary
CreatePullRequestResult
HostingServiceError
```

Do not put these in `types.rs`:

- `WorkspaceRecord`
- `SessionRecord`
- HTTP contract request/response types
- `ProblemDetails`
- `AppState`
- live process/PTY/browser handles
- parser scratch state used by only one operation
- mutable caches

Rule of thumb:

```text
If two operation files, or one operation plus a caller, need the same shape,
put it in types.rs.

If only one operation uses a helper shape internally,
keep it inside that operation file.
```

### `executor.rs`

`executor.rs` is optional.

Use it when an adapter repeatedly invokes one low-level mechanism:

- `git`
- `gh`
- a subprocess runner
- a provider CLI
- a shared shell command wrapper

It sits below operations:

```text
operation -> executor -> local tool/mechanism
```

`executor.rs` responsibilities:

- invoke the local tool/mechanism
- apply shared command environment/cwd/timeout behavior
- return stdout/stderr/status in a narrow adapter-owned shape
- expose small helpers such as `run_git`, `run_gh`, or `run_process_with_timeout`

`executor.rs` non-responsibilities:

- no product policy
- no API mapping
- no domain/store access
- no operation-specific business meaning
- no broad orchestration across unrelated operations

If a concrete name is clearer than `executor.rs`, prefer the concrete name:

```text
git/
  executor.rs      # okay: shared git command runner

hosting/
  gh_cli.rs        # often clearer than executor.rs

processes/
  runner.rs        # often clearer than executor.rs
```

### `operations/`

`operations/**` is the normal implementation home.

Split operations by local capability family, not by HTTP route and not by
product workflow.

Examples:

```text
adapters/git/operations/
  status.rs
  diff.rs
  branches.rs
  commit.rs
  push.rs
  file_search.rs

adapters/files/operations/
  list.rs
  read.rs
  write.rs
  create.rs
  rename.rs
  delete.rs
  stat.rs

adapters/hosting/operations/
  current_pr.rs
  create_pr.rs

adapters/processes/operations/
  run.rs
  output.rs
  environment.rs
```

Operation files may use `types.rs`, safety helpers, parser helpers, and
`executor.rs`.

Operation files should not import `api/**`, `app/**`, `live/**`, or domain
services/stores.

The operation file can be the public adapter API. Callers may call:

```rust
crate::adapters::git::operations::diff::diff_for_path(...)
crate::adapters::git::operations::branches::list_branches(...)
```

This is acceptable. Do not add `service.rs` solely to avoid this path.

### `service.rs`

`service.rs` is optional and rare.

Use it only when it earns its keep through real shared state, configuration, or
composition.

Good reasons to add `service.rs`:

- the adapter owns shared state or cache
- the adapter owns shared configuration/defaults
- the adapter has a stateful object used by callers
- one public adapter method composes several operations into one capability
- keeping a stable facade materially reduces call-site churn

Bad reasons to add `service.rs`:

- it only forwards `Service::diff()` to `operations::diff::diff()`
- it exists because every adapter "should have a service"
- it becomes a 1,000-line implementation bucket
- it hides operation ownership instead of clarifying it

Allowed:

```text
service.rs
  owns FileSearchCache and delegates search work
  owns default timeout/config for process runner
  composes check_gh_installed + check_gh_auth + create_pr
```

Avoid:

```text
service.rs
  contains parsers
  contains all git operations
  contains product workflow rules
  contains HTTP error mapping
```

If a service exists, keep the direction clear:

```text
caller -> service.rs -> operations -> executor/local tool
```

Do not let operation files depend on `service.rs`.

## Capability Shapes

### Files

Target:

```text
adapters/files/
  mod.rs
  types.rs
  safety.rs
  operations/
    list.rs
    read.rs
    write.rs
    create.rs
    rename.rs
    delete.rs
    stat.rs
```

Files adapter code owns local file mechanics:

- workspace-relative path normalization
- containment checks
- file reads
- file writes
- directory listings
- create/rename/delete mechanics
- metadata/stat reads
- text/binary checks
- content version tokens

Files adapter code does not decide:

- whether a workspace may be modified
- whether a file should appear in transcript context
- whether an operation belongs to a review flow
- how API errors are rendered

### Git

Target:

```text
adapters/git/
  mod.rs
  types.rs
  executor.rs
  operations/
    status.rs
    diff.rs
    branches.rs
    commit.rs
    push.rs
    file_search.rs
```

Git adapter code owns:

- invoking git
- parsing git output
- status snapshots
- diffs
- branch/default/base logic
- staging/unstaging/committing
- pushing current branch
- repo file search mechanics

Git adapter code does not decide:

- whether dirty status blocks workspace retirement
- how mobility archives interpret deltas
- whether a review should include a diff
- when a cowork workspace should autosave as product policy

Watch for product-flavored names in git adapter operations. If an operation is
truly product-specific, move policy to a domain and keep only raw git mechanics
in the adapter.

### Hosting

Target:

```text
adapters/hosting/
  mod.rs
  types.rs
  gh_cli.rs
  operations/
    current_pr.rs
    create_pr.rs
```

Hosting adapter code owns provider command/API mechanics such as GitHub CLI
wrappers and pull-request metadata lookup.

Hosting adapter code does not decide:

- workspace lifecycle
- billing
- authorization
- product presentation
- release policy

### Processes

Target:

```text
adapters/processes/
  mod.rs
  types.rs
  runner.rs
  operations/
    run.rs
    environment.rs
    output.rs
```

Processes adapter code owns local command execution mechanics:

- args
- working directory
- environment
- timeouts
- output capture/truncation
- exit status mapping

Processes adapter code does not decide:

- which product workflow should run a command
- how command results affect durable session/workspace state
- whether command output should be shown in a UI

## Inputs And Outputs

Adapter inputs should be explicit and already resolved.

Prefer:

```text
workspace_root: PathBuf
relative_path: WorkspaceRelativePath
timeout: Duration
command: Vec<String>
base_ref: String
```

Avoid:

```text
workspace_id
session_id
AppState
Store
ContractRequest
```

If an adapter needs a workspace root, a domain or API caller resolves the
workspace first and passes the root in. The adapter does not query durable
workspace state.

Adapter outputs should be typed capability results, not HTTP responses and not
product presentation models.

Use free functions by default. Use a struct only when it holds dependencies,
cache, config, subprocess state, or test-injectable behavior:

```text
Good as functions:
  read_workspace_file(root, path)
  parse_git_status(output)
  build_safe_path(root, relative_path)

Good as structs:
  WorkspaceFileSearchCache
  ProcessService
  BrowserSessionController
```

If a struct has no fields, it probably should be a function.

## Error Ownership

Adapter errors should describe local capability failures:

- path escapes workspace root
- file not found
- git command failed
- process timed out
- provider CLI missing
- provider CLI not authenticated
- output could not be parsed

Domains translate adapter failures into product decisions when needed. API code
translates final errors into wire responses.

Avoid putting HTTP concepts on adapter errors:

```text
status_code()
problem_code()
```

Those mappings belong in API error translation. Adapters must not expose those
helpers.

## Growth Rules

Split an adapter before it becomes a mixed capability bucket.

Promote implementation into a new `operations/<name>.rs` file when it has:

- its own parser
- its own safety rules
- its own command shape
- its own fixture set
- more than one public function

Do not split by HTTP route. Split by local capability concern.

Do not create vague files:

```text
helpers.rs
utils.rs
misc.rs
common.rs
operations/workspace.rs
operations/review.rs
```

Prefer specific names:

```text
safety.rs
parser.rs
executor.rs
gh_cli.rs
operations/diff.rs
operations/branches.rs
operations/create_pr.rs
operations/output.rs
```

## Testing

Adapter tests should use temp directories, fixture command output, or narrow
command wrappers. They should not require an AnyHarness `AppState`, live
session manager, or SQLite store.

For git/process/hosting command wrappers, prefer testing parser behavior and
command construction separately from process execution.

Operations with complex parsers may keep tests beside the operation:

```text
operations/diff.rs
operations/diff_tests.rs
```

or in a nested test module when small.

## Migration Checklist

When cleaning up an adapter:

1. Identify the local capability.
2. Move shared adapter vocabulary into `types.rs`.
3. Move implementation into `operations/**`.
4. Add `executor.rs`, `gh_cli.rs`, or `runner.rs` only if there is repeated
   low-level tool invocation logic.
5. Keep or add `service.rs` only if it has real state/config/composition value.
6. Move HTTP mapping out to API.
7. Move product policy out to domains.
8. Keep callers pointed at operation files unless a service facade is earned.

---

# AnyHarness Live Runtime

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

Only create a `live/<system>/` folder when there is a real long-lived runtime
object: a manager, actor, handle, PTY, sidecar, watcher, stream registry, or
pending interaction rendezvous. A domain workflow that merely starts a session
does not earn one.

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

Do not use `service.rs`, `runtime.rs`, or `store.rs` inside `live/**` — those
names belong to `domains/`.

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

### Workspace-wide stop

`SessionRuntime::stop_all_for_workspace` (`domains/sessions/runtime/lifecycle.rs`)
is the one workspace-wide kill for the sessions plane. It is distinct from
`dismiss`: a dismiss reply fires before the actor loop even finishes, so it
proves nothing about the agent process. The stop path is backed by
`LiveSessionHandle::stop_and_await`, a private `SessionCommand::Stop` the
actor stores and answers only from `run()`'s exit sequence, after the agent's
whole process GROUP (`spawn_agent_process` gives it its own group) has gone
through the crate-root `process_kill` module's TERM -> 5s grace -> KILL
escalation and been reaped. The census - total processes reaped and how many
were `git` - travels back as the `PlaneKills` pair every stop primitive on
every plane returns; the domain folds it and moves the session row to its
stopped (`idle`, never `closed` or `dismissed`) state so unarchive/resume
still works. `process_kill` itself lives at the crate root, not under
`live/**` or `domains/**`, because both `live/terminals::manager` and
`domains/workspaces::setup_runtime` need to name `PlaneKills` and either
domain-side placement would force a second `live::` import in one of them.

The escalation above describes unix, where the integer a caller holds names a
process group (or, for a PTY, a session) because the spawn site called
`process_group(0)`. Windows has neither concept and those spawn calls are
`#[cfg(unix)]`, so on Windows the same integer is just the direct child's pid
and `process_kill_windows.rs` reads it as the ROOT of a process tree, reaching
the descendants through a `CreateToolhelp32Snapshot` walk over
`th32ParentProcessID`. The return contract is the same - the same
`(total, git)` census taken before anything is signaled, the same detached
escalation, the same grace-as-deadline and confirmation budget - but the
guarantee is weaker in three ways. `TerminateProcess` is unconditional, so the
Windows ladder has no graceful rung before it. The kill is not atomic against
a tree that grows mid-kill: `kill(-pgid)` still reaches a child created
between the unix enumeration and the signal, whereas Windows acts on a pid
list and picks such a child up only on the next confirmation pass. And a pid
is not an identity, so a descendant whose creation time cannot be read is
refused rather than killed, on the grounds that terminating a stranger is
worse than leaking a descendant.

Two timing rules make the stop fit an archive's quiesce budget:

- The 5s grace is a DEADLINE, not a fixed cost. Each escalation polls for its
  target's death and returns the moment the group (or PTY session) is
  confirmed empty, so a target that honors the TERM costs milliseconds.
- Every plane fans its per-target kills out CONCURRENTLY -
  `stop_all_for_workspace` across sessions, `close_all_for_workspace` across
  terminals. The worst case for a whole plane is ONE grace window, never one
  per target.

A `Stop` that arrives during an ACTIVE turn races the ACP cancel against a
short bound (`ACTIVE_TURN_STOP_BOUND`, `actor/turn/active.rs`). The cancel is
cooperative and nothing obliges an agent to honor it, so when the bound
expires the turn is abandoned (its transcript turn is closed as `Cancelled`)
and the exit sequence's group escalation runs regardless. The worst case for
one session is therefore the bound plus the grace, never the length of the
agent's turn.

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

### Workspace-wide stop and the archive-script run

`TerminalService` carries three workspace-wide primitives, split out of
`manager.rs` into the sibling `command_runs/workspace_stop.rs` to stay under
the line cap:

- `close_all_for_workspace` walks the `TerminalRegistry` directly (not
  through `TerminalHandle::close()`, whose setup-terminal guard would refuse
  while a sibling `kill_setup_run` running in parallel has not yet marked the
  active run interrupted) and kills every terminal by PTY SESSION, not just
  the shell's own pid - portable-pty's PTY child is already a session
  leader, so a session-wide kill is what reaches a `&`-backgrounded job an
  interactive shell's job control put in its own process group. The
  per-terminal kills run CONCURRENTLY, so a workspace with several open
  terminals pays one grace window, not one per terminal.
- `kill_active_run_for_workspace` (`WorkspaceSetupRuntime::kill_setup_run`'s
  mechanism) kills whatever setup or archive-script run is active for a
  workspace by process GROUP and marks the command run interrupted, so
  `is_setup_running` stops lying the moment it returns.
- `run_blocking_command_for_workspace`
  (`WorkspaceSetupRuntime::run_archive_script`'s mechanism) is an
  await-to-exit mode layered onto the same spawn/stream/timeout body
  `start_setup_command` already used for start-and-poll. It records with
  `TerminalPurpose::Run`, registers in the same in-memory active-run registry
  so `kill_active_run_for_workspace` can cancel-and-await it, but never calls
  `set_latest_setup_run` - an archive script must never become the
  workspace's durable setup pointer that `rerun_setup` replays. Unlike
  `start_setup_command`, it OWNS the terminal it creates and closes it on
  every exit path (success, failure, and the `ArchiveRunGuard::drop` backstop
  for a caller that walked away): the terminal is rooted in the workspace
  being archived, so no live PTY - and no blocking PTY-reader thread - may
  survive the run.

All three return or compose the crate-root `process_kill` module's
`PlaneKills` census and await confirmed process death before returning;
none of them closes or kills the other resource in its pair - killing the
setup terminal does not kill the setup script, and killing the setup script
does not close the terminal. They are the mechanism only: no operation-gate
lease, no access-gate assertion, and no parallel composition across planes -
that composition is quiesce's, layered on top.

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
(see [mental-model.md](anyharness.md) for the underlying law):

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

---

# AnyHarness Persistence: Database Infrastructure

`anyharness-lib/src/persistence/**` owns SQLite bootstrap, migrations, and the
shared database handle used by domain stores. The store-standards half of the
persistence pair is [persistence-stores.md](anyharness.md).

## Core Concepts

Persistence is intentionally small and central.

It owns:

- opening the runtime SQLite database
- enabling required pragmas
- running migrations
- exposing the shared `Db` handle used by stores

It does not own domain-specific SQL. That stays in the owning domain store such
as `domains/sessions/store/**` or `domains/workspaces/store/**`.

## Core Models

Core persistence files:

- `anyharness/crates/anyharness-lib/src/persistence/sqlite.rs`
- `anyharness/crates/anyharness-lib/src/persistence/migrations.rs`
- `anyharness/crates/anyharness-lib/src/persistence/mod.rs`

### `Db` (`anyharness/crates/anyharness-lib/src/persistence/sqlite.rs`)

`Db` is the shared SQLite handle wrapper.

It owns:

- one `rusqlite::Connection`
- mutex-protected access
- helper entrypoints for normal and transactional work

The important methods are:

- `open(...)`
- `open_in_memory(...)`
- `with_conn(...)`
- `with_tx(...)`

### Migrations (`anyharness/crates/anyharness-lib/src/persistence/migrations.rs`)

`migrations.rs` owns the ordered migration list and the `_migrations` tracking
table.

Each migration:

- has a stable name
- is applied once
- runs inside its own transaction

## Main Flow

### Startup

Database startup is:

1. determine the runtime DB path under runtime home
2. open the SQLite connection
3. enable required pragmas such as WAL and foreign keys
4. run migrations
5. return a shared `Db` handle

`AppState::new(...)`
(`anyharness/crates/anyharness-lib/src/app/mod.rs`)
then injects that shared handle into domain stores.

### Store Boundary

Persistence should be thought of as a two-layer boundary:

- `persistence/**`
  - DB bootstrap and shared DB access
- domain `store.rs` or `store/**`
  - actual SQL for that domain

That means:

- `domains/sessions/store/**` owns session/event/config SQL
- `domains/workspaces/store/**` owns workspace SQL
- `persistence/**` does not become a giant shared query bucket

## Durable Models

AnyHarness does not centralize all durable records in one global models module.

Instead:

- each durable domain owns its own record structs in `model.rs`
- each durable domain owns its own SQL in `store.rs` or `store/**`

Examples:

- `anyharness/crates/anyharness-lib/src/domains/sessions/model.rs`
  - `SessionRecord`
  - `SessionEventRecord`
  - live-config and pending-change records
- `anyharness/crates/anyharness-lib/src/domains/workspaces/model.rs`
  - `WorkspaceRecord`
  - git-context discovery records

This keeps durable state definitions close to the domain that owns them.

## Boundaries

### Persistence Owns

- opening SQLite
- migration sequencing
- shared DB access helpers

### Persistence Does Not Own

- session-domain rules
- workspace-domain rules
- agent install state
- live ACP or terminal state
- transport-layer schemas

## Important Invariants

- Migrations are the schema source of truth.
- Domain stores should use the shared `Db` handle rather than opening their own
  connections.
- Durable domain SQL stays with the owning domain store, not in
  `persistence/**`.
- Live in-memory runtime state must not be treated as if it were durable DB
  state.

## Extension Points

Add behavior here when it changes DB bootstrap or migration mechanics, for
example:

- new startup pragmas
- migration runner behavior
- DB-handle helper APIs

Do not add domain-specific query logic here unless it is truly cross-domain DB
infrastructure.

---

# AnyHarness Persistence: Store Standards

Standards half of the persistence pair: where SQL lives, how stores are shaped,
and who owns transactions. The database-infrastructure half is
[persistence-database.md](anyharness.md).

## Layer Split

There are two persistence concerns:

```text
persistence/
  database infrastructure

domains/<domain>/store.rs or store/
  product-specific queries
```

`persistence/` owns:

- opening SQLite
- migrations
- low-level DB wrapper types
- custom migration runners

Domain stores own:

- SQL for their product rows
- mapping rows into domain records
- durable query APIs used by services/runtimes

## Store Rules

Stores should:

- be synchronous when using the current SQLite access pattern
- own SQL query construction
- return domain records, not contract responses
- avoid business workflows
- avoid live runtime calls

Stores should not:

- call API handlers
- construct contract response payloads
- start actors or subprocesses
- perform multi-domain orchestration

## The Two-Tier Store Pattern

Stores have two tiers, and the split is what makes transactions composable:

```text
TIER 1 (public)   store fns speak domain and own the connection:
                    pub fn insert(&self, record) -> with_conn(...)
                    pub fn delete_session(&self, id) -> with_tx(...)

TIER 2 (private)  row fns take &Connection so several can compose
                  inside ONE transaction:
                    pub(super) fn insert_session_row(conn, record)
                    pub(super) fn insert_event_row(conn, ...)
```

The transaction boundary is the use-case boundary: when a use case needs
atomicity across row families (fork = session + link + event snapshot), one
tier-1 fn opens one `with_tx` and calls several tier-2 fns inside it.
Connections never escape upward; row types and SQL never escape the store.
In-repo exemplar: `domains/sessions/store/**`; cross-domain atomic deletes use
the participant-trait pattern (`domains/sessions/deletion.rs`).

Subagent lifecycle provides two additional exemplars. Creation inserts the
child session and its fanout-capped relationship in one transaction, preventing
an unlinked child from becoming visible as an ordinary session. Reversible
Close sets `session_links.subagent_closed_at`, deletes the child's pending
prompts, and defensively removes any retired legacy wake-schedule row for that
link in one transaction. Delegated-agent runtime behavior does not create or
read those rows; the shared schedule table remains active only for Cowork.
Actor cancellation/unload happens only after that transaction returns; no
database transaction is held across an actor await. Completion-ledger rows and
durable session history are deliberately not deleted.

Rules:

- low-level transaction helpers live with the relevant store when they are
  tightly tied to that store's SQL
- cross-domain transaction workflows belong in the owning domain runtime or
  service
- stores should not hide product workflow decisions inside a transaction helper

## Time, Identity, And Errors

- **Domain-meaningful times are passed in** (`created_at`, `closed_at`,
  `last_prompt_at` are minted by the use case's record phase);
  **`updated_at` is store-owned bookkeeping**. A store file using both
  conventions for the same kind of field is a bug farm — pick per the rule
  above. Identity (`Uuid::new_v4()`) is never minted inside a store.
- **Expected conditions live in the `Ok` type**: not-found is
  `Option`, empty is an empty `Vec`. Errors are reserved for infrastructure
  failure (disk, corruption, lock contention) — and for that, `anyhow` at the
  store surface is acceptable; services wrap it as their internal variant.
  Never encode an expected condition as an error string a caller must parse.

## Store Decomposition

A store file should split when it owns multiple independent row families or
exceeds the repo-shape thresholds.

For sessions, a clean target is:

```text
domains/sessions/store/
  mod.rs
  sessions.rs
  events.rs
  raw_notifications.rs
  live_config.rs
  pending_prompts.rs
  background_work.rs
```

Each file should own one table family or one closely related query family.

---

# AnyHarness Repo Shape

## File Size

Use these thresholds for Rust source under `anyharness/crates/**`:

| Area | Soft limit | Hard limit | Notes |
| --- | ---: | ---: | --- |
| `api/**/*.rs` | 400 | 700 | Large handlers usually mean product orchestration leaked into transport. |
| `app/**/*.rs` | 500 | 900 | Split by wiring family; app files must remain composition-only. |
| `domains/**/store*.rs` | 500 | 900 | Split by table/query family. |
| `domains/**/service*.rs` | 500 | 900 | Split by durable use case or subdomain. |
| `domains/**/runtime*.rs` | 500 | 900 | Split by workflow family. |
| `live/**/actor/**/*.rs` | 500 | 900 | Split by command/startup/prompt/config/lifecycle concern. |
| `live/**/driver/**/*.rs` | 500 | 900 | Split by external process/protocol/PTY lifecycle concern. |
| `live/**/sink/**/*.rs` | 500 | 900 | Split by normalized event family. |
| `live/**/output_sink/**/*.rs` | 500 | 900 | Split by ordered output family. |
| `adapters/**/*.rs` | 500 | 900 | Split by capability if the adapter grows. |
| `integrations/**/*.rs` | 400 | 800 | Split by protocol concern. |

Files above these limits require a split plan or justification.

Current split shapes:

- `domains/sessions/store/**` is the current split session store shape.
- `domains/sessions/mcp_bindings/**` is the current split session MCP binding and
  launch assembly shape.
- `live/sessions/sink/**` is the current split session event sink shape.
- `domains/sessions/runtime/**` is the current split session runtime shape.
- `live/sessions/manager/**`, `live/sessions/handle.rs`,
  `live/sessions/actor/**`, `live/sessions/driver/**`,
  `live/sessions/sink/**`, `live/sessions/rendezvous/**`,
  `live/sessions/background_work/**`, and `live/sessions/replay/**` are the
  current split live session shape. The `InboundDoor` is split under
  `live/sessions/driver/inbound/**` as the agent-initiated inbound direction
  inside the driver role.
- Remaining `acp/**` files are shared ACP permission/payload/provider-error
  helpers, not current owners for live session manager, sink, rendezvous,
  background work, or replay behavior.

## Module Style

Prefer explicit concern files over giant `mod.rs` files.

Use `mod.rs` to declare and lightly re-export a cohesive module surface, not to
hold the whole implementation.

Avoid both extremes:

- one 3,000-line file that owns five concepts
- ten tiny wrapper files that hide a simple local function

Split when a reader can name a real responsibility:

```text
store/events.rs
runtime/prompt.rs
actor/config.rs
sink/tools.rs
integrations/mcp/json_rpc.rs
```

## Large Subsystems

The top-level boundary is not enough for large subsystems. Once a subsystem has
multiple responsibility families, define its internal shape before splitting
files. The target is legibility by path at both levels:

```text
domains/sessions/runtime/prompt.rs    # session workflow entrypoint
live/sessions/actor/turn/active.rs    # active prompt turn loop
live/sessions/sink/tools.rs           # transcript event normalization
```

Do not dump unrelated files into a newly-correct parent folder. A move into
`live/sessions/actor/*.rs` is only useful if the children also encode
responsibility.

Large subsystem splits should name the local architecture explicitly in the
owning spec or guide. For example:

- durable domains split by `model`, `store`, `service`, `runtime`, and named
  subdomains.
- app composition split by wiring family such as sessions, workspaces,
  product extensions, product MCP registration, and startup tasks.
- live resources split by manager, handle, private actor, private driver,
  sink, rendezvous, background work, snapshot, and replay roles.
- live actors split by command surface, loop, startup, prompt turn, config,
  notifications, interactions, and shutdown.
- event/output sinks split by normalized event or output family.
- integrations split by protocol/vendor mechanic.

## Change Discipline

- Preserve behavior unless the task explicitly asks for a behavior change.
- Move one ownership boundary at a time.
- Do not leave duplicate old and new code paths after replacing an
  implementation.
- Do not create empty target folder trees.
- Do not add generic `utils`, `helpers`, or `misc` buckets.
- When moving files mechanically, run focused tests before beginning behavior
  changes.
- When splitting god files, split by responsibility, not by arbitrary line
  ranges.

## Boundary Ratchet

CI runs `scripts/check_anyharness_boundaries.py` to keep AnyHarness dependency
direction from regressing. The rules it enforces are records in
`lints/anyharness/boundaries.toml` (AH-API-*, AH-DOMAIN-*, AH-LIVE-*, …), and
each failure is rendered from its record, so the message carries the rule, the
legal alternative, and the record path.

Grandfathered violations live in `lints/anyharness/exceptions.toml`, one entry
per site rather than a per-file count: a site is a content fingerprint, so a
cleanup and a regression in the same file can no longer cancel out. New
violations fail, and a listed site that no longer violates fails as stale.

When a change removes a tolerated violation, delete that entry in the same
change. Adding one is an amendment — see `lints/README.md`.

## Old Path Ratchets

Completed splits block old flat file paths from coming back. The
repo-shape CI job runs `scripts/check_anyharness_old_paths.py` for completed
AnyHarness splits. Add paths to that check after the replacement lands on
`main`, then keep the old path blocked instead of relying on review to catch
resurrected flat files.

## Review Questions

Ask these in PR review:

- Can I tell what this file is allowed to own from its path?
- Does this file import upward into API/app or across into a product surface?
- Is this a behavior-preserving extraction, or did it change behavior?
- Did the old path get deleted?
- Did a generic shared bucket appear because ownership was unclear?

---

# AnyHarness Observability

## Purpose

`observability/` owns reusable tracing, latency, and measurement helpers.

This layer exists so lower runtime layers do not import diagnostics from
`api/http/**`.

Target examples:

```text
observability/latency.rs
observability/measurement.rs
observability/tracing.rs
```

## Allowed Concerns

Observability may own:

- request latency context parsed from headers
- flow id / flow kind / prompt id trace fields
- measurement operation ids
- safe debug snapshots
- small helpers for structured tracing fields

It must not own:

- product decisions
- retry behavior
- error classification beyond diagnostic labels
- HTTP response mapping

## Span Doctrine

How runtime code emits diagnostics, regardless of layer:

- One `#[tracing::instrument]` span per use-case entry, with fields declared
  once. Everything inside — events, errors, child calls — inherits them.
- Phase timings are span events, not hand-rolled `Instant::now()` pairs with
  repeated field blocks.
- **Observability context never appears in a function signature.** Request
  latency/flow context is parsed from headers at the transport edge
  (`FlowHeaders::from_headers` -> `.span()`), attached to the request span,
  and propagates through span context — never as a `latency: Option<&...>`
  parameter or struct field.
- Hand-copying the same field cluster (`flow_id`/`flow_kind`/`flow_source`/
  `prompt_id`) across multiple `tracing::` calls in one file is the symptom
  that a span is missing. Copy-pasted clusters drift; spans cannot.
- Log where an error is handled, not at every hop it passes through.

Under a Desktop-bundled supported-macOS `serve` launch, the same `tracing`
events are additionally captured by the bounded Desktop diagnostics layer
installed at binary bootstrap (`proliferate-diagnostics-client`); emitting
code does not change for it, and its absence changes nothing here.

This doctrine now holds on the sessions startup/prompt paths: the former
`LatencyRequestContext` (once threaded through ~13 signatures across
api -> domains -> live and relayed via actor config/command fields) is
deleted. Spans are attached at the transport edges and the
`[workspace-latency]` event names are unchanged.

## Dependency Rule

Allowed:

```text
api -> observability
domains -> observability
live -> observability
adapters -> observability
integrations -> observability
```

Banned:

```text
observability -> api
observability -> domains
observability -> live
```

---

# AnyHarness Integrations

Integration code lives under `anyharness-lib/src/integrations/**`.

## Purpose

`integrations/**` owns reusable implementations of external contracts that
AnyHarness must speak. It is for protocol/vendor mechanics, not product policy
and not live resource ownership.

The concise rule:

```text
integrations/ = external contract mechanics
domains/      = AnyHarness product/runtime decisions
live/         = currently running resources
adapters/     = local machine capabilities
api/          = HTTP/SSE/WS transport
```

Put code in `integrations/**` when the main job is:

```text
Conform to this external protocol/vendor interface.
```

Do not put code in `integrations/**` when the main job is:

```text
Decide what AnyHarness should do.
```

Examples:

```text
integrations/mcp
  MCP JSON-RPC formatting, MCP tool result formatting, generic product-MCP
  server dispatch, MCP capability-token mechanics.

integrations/agent_cli
  Vendor coding-agent CLI probing, launcher script mechanics, model discovery
  output parsing, ACP registry install metadata.

integrations/acp
  Reusable ACP protocol helpers if extracted from live-session code. Not the
  live session actor/driver lifecycle.
```

The top-level folder name should be an external system, protocol, or vendor
family:

```text
mcp
acp
agent_cli
github
slack
stripe
e2b
docker
ssh
openai
anthropic
bedrock
```

Avoid product-specific feature names:

```text
workspace
session
auth
billing
cloud
review
cowork
tools
```

## Boundary Rules

Integrations may:

- define external protocol/vendor types
- parse external protocol/vendor payloads
- format external protocol/vendor responses
- implement reusable protocol dispatch/client/server helpers
- wrap vendor CLI/API quirks
- own protocol/vendor auth mechanics
- expose neutral integration result/error types

Integrations must not:

- import `domains/**`
- import `app/**`
- import `api/**`
- import live actors/managers/handles
- own durable DB state
- decide product policy
- decide workspace/session/team lifecycle
- decide which MCP servers attach to a session
- decide agent selection or credential policy
- run a live session process

If integration code needs product decisions, pass those decisions in as data or
callbacks from the owning domain/live layer.

The copy test:

```text
Could this code be copied into another Rust app that also speaks this
protocol/vendor, without bringing AnyHarness product concepts with it?

yes -> probably integrations
no  -> probably domains/live/api/adapters
```

## Folder Composition

Split integrations by external contract role, not by generic operations and not
by product domain.

Canonical shape:

```text
integrations/<external_system>/
  mod.rs
  types.rs          # optional shared external/vendor vocabulary
  protocol.rs       # optional wire constants/types/conversions
  auth.rs           # optional protocol/vendor auth mechanics
  client.rs         # optional outbound client mechanics
  server/           # optional inbound server/dispatch mechanics
  cli/              # optional CLI-specific mechanics
  registry.rs       # optional external registry/schema mechanics
  parsing.rs        # optional shared parsers
```

Not every integration needs every role.

### `mod.rs`

`mod.rs` declares the module surface. It should stay boring.

It may:

- declare child modules
- expose the intended integration surface
- keep implementation modules private when possible

It should not:

- hold implementation logic
- become a product facade
- re-export unrelated vendor/protocol helpers

### `types.rs`

`types.rs` is optional shared integration vocabulary.

Use it for external/vendor shapes or neutral integration results shared by
multiple integration files or callers:

- wire DTOs
- parsed vendor records
- provider IDs
- protocol enums
- integration errors
- neutral discovery results

Do not put AnyHarness product records in `types.rs`:

- `SessionRecord`
- `WorkspaceRecord`
- domain service types
- HTTP contract request/response types
- live actor state

If a shape is only used by one parser or one file, keep it local to that file.

### `protocol.rs`

Use `protocol.rs` for wire-level rules:

- method names
- protocol versions
- request/response envelopes
- protocol error codes
- protocol conversion helpers
- constants required by the external spec

Current MCP uses `json_rpc.rs` for this role. That name is fine because it is
more specific than `protocol.rs`.

### `auth.rs`

Use `auth.rs` for protocol/vendor auth mechanics:

- token minting/validation
- auth header parsing
- signature verification
- OAuth wire mechanics if they are generic to the integration
- capability token scope validation when the scope is part of the protocol

Do not put product credential policy here:

- which auth type a team uses
- whether free credits apply
- whether a workspace may use shared credentials
- how credentials are persisted as product state

Those belong in the owning domain/server-side product layer.

### `client.rs`

Use `client.rs` for outbound protocol/API clients:

- request construction
- response parsing
- retry/error handling that is generic to the external system
- typed client methods over an external API

Do not use `client.rs` for live resource orchestration. If the client is owned
by a running session/terminal/browser actor, that orchestration belongs under
`live/<resource>/driver/**`.

### `server/`

Use `server/**` for inbound protocol/server frameworks:

- dispatchers
- request contexts
- initialize/handshake responses
- method routing
- server-side protocol errors

For MCP, `product_server/**` is this role. It is allowed because it is the
generic framework for product MCP servers; actual product tool behavior stays
in domains.

### `cli/`

Use `cli/**` for vendor CLI dialect mechanics:

- executable probing
- version probing
- CLI output parsing
- known args/env quirks
- launcher script shape
- vendor-specific model discovery

Generic process execution belongs in `adapters/processes`. CLI dialect logic
belongs in `integrations/<vendor_or_family>/cli/**` or directly under the
integration when small.

### `registry.rs`

Use `registry.rs` or `registry/**` for external registry formats:

- registry wire schema
- fetch mechanics
- platform distribution resolution
- install metadata parsing
- archive/package metadata

If the registry grows:

```text
registry/
  schema.rs
  fetch.rs
  resolve.rs
  install.rs
```

### `parsing.rs`

Use `parsing.rs` for shared parsing helpers only when the parsing logic spans
multiple files.

If parsing belongs to one role, keep it near that role:

```text
model_discovery.rs
registry/schema.rs
server/request.rs
```

## Current MCP Shape

Current MCP topology:

```text
integrations/mcp/
  mod.rs
  json_rpc.rs
  tools.rs
  capability_token.rs
  product_server/
    auth.rs
    definition.rs
    dispatcher.rs
    errors.rs
    request.rs
    response.rs
```

This is broadly correct.

Mapping:

```text
json_rpc.rs
  Wire/protocol helpers for JSON-RPC request/result/error shapes.

tools.rs
  MCP tool result and tool definition formatting.

capability_token.rs
  MCP capability-token mint/validate mechanics.

product_server/definition.rs
  Generic product-MCP server metadata contract.

product_server/auth.rs
  Generic product-MCP auth wrapper.

product_server/request.rs
  Generic product-MCP request context and auth header shapes.

product_server/dispatcher.rs
  Generic ProductMcpServer trait and JSON-RPC method dispatch.

product_server/response.rs
  MCP initialize response.

product_server/errors.rs
  Protocol/dispatch error constants and generic product-MCP dispatch errors.
```

What does not belong in `integrations/mcp/**`:

```text
domains/cowork/mcp
  cowork tool behavior

domains/reviews/mcp
  review tool behavior

domains/agent_operations/mcp
  Workspace agent and delegated-work tool behavior

domains/sessions/mcp_bindings
  session MCP selection/injection/assembly

api/http/product_mcp
  HTTP endpoint/auth/body mapping into MCP dispatch
```

## Current Agent CLI Shape

Current agent CLI topology:

```text
integrations/agent_cli/
  mod.rs
  executable.rs
  launcher.rs
  model_discovery.rs
```

This is mostly valid, but should stay narrow. (`acp_registry.rs` was removed
when the install path was fenced: ACP-registry resolution is now a probe-time
producer concern — `scripts/agent-catalog/resolve-pins.mjs` — and install
consumes the frozen catalog pin instead.)

Mapping:

```text
executable.rs
  Executable/path helpers used by agent CLI mechanics. This is the weakest fit
  because it is generic local-machine logic; keep it private support and avoid
  expanding it into a general adapter here.

launcher.rs
  Launcher script mechanics for invoking agent CLIs with fixed args/env/PATH.

model_discovery.rs
  Vendor CLI model-list commands and output parsing.
```

If `agent_cli` grows, split by role:

```text
integrations/agent_cli/
  mod.rs
  types.rs
  executable.rs

  launcher/
    mod.rs
    script.rs
    env.rs

  model_discovery/
    mod.rs
    cursor.rs
    opencode.rs
    parsing.rs

  registry/
    mod.rs
    schema.rs
    fetch.rs
    resolve.rs
    install.rs
```

What does not belong in `integrations/agent_cli/**`:

```text
domains/agents
  selected agent, resolved agent config, product readiness, auth requirements.

live/sessions/driver
  spawn the actual agent process, wire ACP, initialize native session,
  send prompt, cancel, close, receive notifications.

domains/agent_auth or server-side auth domain
  credential policy, free credits, BYOK/team/local auth rules.
```

## ACP Rule

If reusable ACP protocol helpers are extracted, they may live under:

```text
integrations/acp/
  protocol.rs
  json_rpc.rs
  client.rs
  server.rs
  conversions.rs
```

But session-stateful ACP code belongs under live session roles:

```text
live/sessions/driver/
  process.rs
  connection.rs
  inbound/            # the InboundDoor (agent-initiated traffic)
  session_lifecycle.rs
  native_session.rs
  shutdown.rs

live/sessions/sink/
  ACP notification -> AnyHarness event normalization

live/sessions/rendezvous/
  permission/user-input/MCP elicitation rendezvous
```

ACP is a protocol/backend, not an architectural peer of actor/driver/event
sink. ACP-specific code should sit under the role it serves.

## GitHub / Hosting Rule

Use `adapters/hosting` for local GitHub CLI mechanics:

```text
adapters/hosting
  run gh locally
  check gh installed/authenticated
  parse gh command output
```

Use `integrations/github` only if AnyHarness owns reusable GitHub API semantics:

```text
integrations/github
  REST/GraphQL clients
  webhook payload verification
  OAuth/API response parsing
  GitHub-specific API error mapping
```

## Dependency Rules

Allowed:

```text
domains -> integrations
live -> integrations
api -> integrations only for narrow transport/protocol wrappers
```

Banned:

```text
integrations -> domains
integrations -> app
integrations -> api
integrations -> live
```

Integration code may use adapters only when it needs a generic local mechanism,
but prefer keeping generic process/filesystem mechanics in adapters and passing
plain data into integrations.

## Migration Checklist

When adding or moving integration code:

1. Name the external protocol/vendor family.
2. Confirm the code is external contract mechanics, not product policy.
3. Choose the role: `protocol`, `auth`, `client`, `server`, `cli`, `registry`,
   or `parsing`.
4. Keep product decisions in domains/live/API and pass them in as data.
5. Keep local machine capability wrappers in adapters.
6. Keep live resource ownership in live drivers/actors.
7. Keep the integration import boundary clean: no domains/app/api/live imports.

---

# Proliferate Worker

Proliferate Worker is an optional process beside AnyHarness. It enrolls with
Cloud once, sends heartbeats, and — when a heartbeat ack reports version
divergence — writes a durable update request into a Proliferate Supervisor
mailbox. The agent catalog is not converged here: it ships only inside the
runtime binary
([agent-distribution.md](../systems/harnesses/distribution.md)),
so binary convergence is catalog convergence.

It is not a Cloud command runner. It does not lease commands, materialize
workspaces, upload session events, or maintain Cloud projections. Cloud
reaches AnyHarness directly for the current workspace and session flows.

## Harness launch-option synchronization

`launch_options_sync.rs` reads the runtime's per-harness launch-option state on
the heartbeat schedule and uploads only changed basis/revision documents. The
server heartbeat eligibility bit gates all work. Payloads are copied verbatim;
the Worker does not interpret models, controls, defaults, or evidence. A server
denial after advertised eligibility is a bounded contract contradiction and
does not advance the local last-pushed revision.

On a **supervisor-owned target** (`supervisor_update_request_dir` set in
config — every managed-cloud target, unconditionally), the Worker never
downloads, replaces, kills, or rolls back AnyHarness or itself.
It only observes heartbeat divergence and writes one durable request into
`.proliferate/supervisor/updates` for Proliferate Supervisor to act on; see
the [Lifecycle](#worker-lifecycle-and-convergence) section below and [specs/areas/anyharness.md](anyharness.md) for
the consumer side. A target with no mailbox dir (desktop, whose app bundle
owns both binaries) converges nothing: it heartbeats and syncs only. The
legacy Worker-owned in-place swaps, the Worker self-`exec` update, and the
one-time D5 bridge that migrated already-provisioned legacy sandboxes were
deleted by the cull sweep's delete-worker-legacy track, after the live E2B
UPDATE and D5 BRIDGE proofs (both 2026-07-26) and full fleet convergence.

## Current Process

```text
config + single-process lock + local SQLite
  -> load durable Worker identity, or exchange one enrollment token
  -> write integration-gateway credentials after a fresh enrollment
  -> heartbeat Cloud
  -> after each successful heartbeat, repair that fresh gateway credential if
     a revoked predecessor overwrote the shared file
  -> on a supervisor-owned target, use desiredVersions to converge:
       AnyHarness binary (which IS the agent-catalog update: the catalog
         ships inside the runtime binary — binary-only transport, see
         agent-distribution.md "Convergence") -> write a mailbox update request
       Worker binary -> write a mailbox update request
  -> sleep and repeat
```

Worker startup is best-effort in a cloud sandbox. The direct AnyHarness path
can remain healthy when the Worker is absent or unhealthy.

## Current Source Tree

```text
src/
├── main.rs
├── runtime.rs
├── config.rs
├── error.rs
├── logging.rs
├── observability.rs
├── process_lock.rs
├── versions.rs
├── integration_gateway.rs
├── launch_options_sync.rs
├── supervisor_bridge/
│   ├── mod.rs
│   └── mailbox.rs
├── cloud_client/
│   ├── mod.rs
│   ├── auth.rs
│   └── heartbeat.rs
├── identity/
│   ├── mod.rs
│   ├── enrollment.rs
│   ├── credentials.rs
│   └── fingerprint.rs
├── lifecycle/
│   ├── mod.rs
│   └── heartbeat.rs
└── store/
    ├── mod.rs
    ├── connection.rs
    ├── migrations.rs
    ├── identity.rs
    └── anyharness_update.rs
```

Do not create folders for removed or hypothetical command, event-tail,
inventory, or materialization subsystems.

## Ownership Map

| Area | Owns | Does not own | Guide |
| --- | --- | --- | --- |
| `main.rs`, `runtime.rs` | CLI entry, dependency construction, one heartbeat-and-convergence loop | Product workflows or background task supervision | [Runtime](#worker-runtime) |
| `identity/**` | Enrollment request, durable Worker credential, fingerprint | Sandbox identity, command identity, re-enrollment policy | [Identity](#worker-identity) |
| `lifecycle/heartbeat.rs` | Heartbeat cadence, request, and acknowledgement | Update execution or server-side liveness policy | [Lifecycle](#worker-lifecycle-and-convergence) |
| `supervisor_bridge/**` | Write one durable mailbox update request per diverging heartbeat on a supervisor-owned target; reconcile the Supervisor's activation results back into the store | Update download, verification, activation, health-gating, or rollback (Supervisor owns all of that) | [Lifecycle](#worker-lifecycle-and-convergence) |
| `launch_options_sync.rs` | Consume the server's `launchOptionsUploadAllowed` verdict; when allowed, read each runtime harness's exact launch-option state and upload only a higher source revision | Deciding eligibility, interpreting options/defaults/evidence, or rebuilding the copied statement | [Lifecycle](#worker-lifecycle-and-convergence) |
| `integration_gateway.rs` | Write the private gateway credential file returned by enrollment and repair it after an authenticated heartbeat when a predecessor overwrote it | Credential issuance or re-enrollment | [Identity](#worker-identity) |
| `cloud_client/**` | Raw Cloud HTTP and wire shapes | Convergence decisions or local persistence | [Clients](#worker-http-clients) |
| `store/**` | Durable Worker identity and AnyHarness update state in local SQLite | Cloud or AnyHarness product truth | [Store](#worker-store) |
| Root support files | Configuration, errors, telemetry, process locking, version reporting | Hidden service layers | [Root support](#worker-root-support-files) |

## Read Order

Read this file first, then the focused owner:

- [Runtime](#worker-runtime)
- [Identity](#worker-identity)
- [Lifecycle and convergence](#worker-lifecycle-and-convergence)
- [HTTP clients](#worker-http-clients)
- [Local store](#worker-store)
- [Root support](#worker-root-support-files)

For behavior outside the crate, use the current owners:

- [Server structure](server.md)
- [AnyHarness structure](anyharness.md)
- [Sandbox lifecycle](../systems/environments/README.md)
- `Repository environments and workspace provisioning` (deleted, cull part 2)
- [Billing](../systems/billing/deep-dive.md)

## Dependency Direction

```text
main
  -> config + logging + runtime

runtime
  -> process_lock + store + cloud_client + identity
  -> lifecycle/heartbeat
  -> supervisor_bridge (mailbox convergence)

identity
  -> cloud_client (enroll) + store (durable identity) + config sanitation

supervisor_bridge
  -> heartbeat response + cloud_client artifact-coordinate resolution
     (writes the mailbox request; never acts on it)
  -> store (records the converged version from an activation result)

store and cloud_client
  -> root support only
```

## Hard Rules

- Keep `main.rs` thin and keep `runtime.rs` readable as process choreography.
- Treat the durable Worker token as the only credential the Worker uses for
  its own post-enrollment Cloud requests. The separately returned
  integration-gateway bearer is written for AnyHarness to consume. A Worker
  may reassert the bearer retained from its own fresh enrollment only after
  that Worker's heartbeat authenticates successfully; after heartbeat rejects
  that Worker it must not rewrite shared gateway authority again.
- Never follow redirects on authenticated Cloud requests; public artifact
  fetches use a separate redirect-following client.
- Keep Worker-local SQLite private and limited to restart-critical Worker
  state. It is not Cloud or AnyHarness product truth.
- Do not add command polls, event tails, target/profile state, or workspace
  materialization to this crate.
- The Worker never downloads, replaces, kills, or rolls back AnyHarness or
  itself — on a supervisor-owned target it only writes a durable mailbox
  request (`supervisor_bridge/`) and lets Proliferate Supervisor act; with no
  mailbox dir it converges nothing at all. Do not reintroduce a Worker-owned
  swap of any kind.
- A missing or invalid durable credential has no automatic re-enrollment path.
  Do not invent destructive recovery in this crate.

# Worker HTTP Clients

## Cloud Client

```text
cloud_client/
├── mod.rs       CloudClient, wire DTOs, endpoint methods, response parsing
├── auth.rs      bearer-header formatting
└── heartbeat.rs heartbeat request construction
```

`CloudClient` owns the current raw Cloud HTTP surface:

- `POST /v1/cloud/worker/enroll`
- `POST /v1/cloud/worker/heartbeat`
- version-pinned artifact-coordinate resolution against the
  `GET /v1/cloud/{worker,runtime}/download/{target}/{version}/{asset}`
  redirect endpoints (`Location` + `HEAD` for size — never the binary body)
- `GET /v1/catalogs/agents` (deletion-pending: heartbeat catalog transport)
- a direct unauthenticated fetch from an already resolved CDN URL for the
  sibling checksum

It has two `reqwest` clients. Authenticated requests never follow redirects,
preventing a bearer token from crossing origins. Public artifact fetches
use a redirect-following client and a longer request timeout.

The client owns endpoint paths, headers, serialization, status checking, and
wire compatibility. It does not decide when enrollment, catalog sync, or an
update should happen, and it does not write the local store.

## AnyHarness Access

There is no general `anyharness_client` module in the current Worker; the
narrow local calls that exist (catalog-version poll, launch-option reads)
live with `launch_options_sync.rs`. These calls do not make the Worker the
general execution client for AnyHarness. Cloud performs current workspace and
session operations directly.

## Artifact Identity

The Cloud download endpoint redirects to a public artifact. The Worker reads
the redirect's `Location` (never the body) and derives the checksum URL from
that resolved binary URL, so the coordinates it writes into a mailbox request
name a binary and checksum from the same published directory. It does not
resolve the two artifacts through separate Cloud redirects.

## Hard Rules

- Never use the redirect-following client for authenticated Cloud requests.
- Never attach Worker or runtime bearer credentials to public CDN downloads.
- Keep transport parsing here and convergence decisions in their owning
  modules.
- Do not invent command, event, inventory, or projection endpoints.
- Add a broader AnyHarness client only when multiple current flows require a
  shared access boundary.

# Worker Identity

The Worker has a one-time bootstrap credential and one durable Cloud identity:

```text
enrollment_token
  -> POST /v1/cloud/worker/enroll
  -> worker_id + worker_token + integration-gateway coordinates
```

The persisted identity contains only `worker_id` and `worker_token`. Sandbox,
user, runtime kind, revocation, and liveness are Cloud-owned associations; the
Worker does not persist a Target, profile, slot, generation, or fence.

## Source Ownership

| File | Owns |
| --- | --- |
| `identity/mod.rs` | Durable-identity-first `ensure_enrolled` workflow |
| `identity/enrollment.rs` | Enrollment request construction and response split |
| `identity/credentials.rs` | `WorkerIdentity` and narrow store delegation |
| `identity/fingerprint.rs` | Diagnostic machine fingerprint and hostname hint |
| `integration_gateway.rs` | Private runtime credential file written from a fresh enrollment response |
| `store/identity.rs` | Single persisted identity row |

## Enrollment Precedence

```text
if SQLite contains an identity:
  use it
  clear any enrollment token from config best-effort
  do not call enroll

otherwise:
  require enrollment_token
  send fingerprint, hostname, Worker version, and optional AnyHarness version
  persist worker_id + worker_token
  clear enrollment token from config best-effort
  write integration-gateway credentials
```

A durable identity always wins over an enrollment token still present in the
configuration. An invalid or revoked durable token does not trigger automatic
re-enrollment.

## Credentials

- `enrollment_token` is a single-use bootstrap value and is removed from the
  private TOML configuration after enrollment when possible.
- `worker_token` is the durable opaque bearer token for authenticated Worker
  heartbeats. The Worker client also attaches it to catalog fetches, but the
  current catalog route does not enforce Worker authentication.
- The integration-gateway authorization value is distinct. On fresh
  enrollment it is written atomically to `integration-gateway.json` with
  private directory/file permissions. That process retains the response in
  memory and, after each successful authenticated heartbeat, restores the file
  only when it differs. This converges a delayed predecessor write. A heartbeat
  that succeeded immediately before revocation can race one final stale write;
  after rejection the predecessor stops writing, and the active successor
  repairs that race on its next successful heartbeat.
- `runtime_bearer_token` authenticates narrow calls to the co-located
  AnyHarness runtime. It is not Cloud auth.

The enrollment response's integration-gateway coordinates are not stored in
Worker SQLite. Repair is therefore limited to the process that freshly
enrolled and still holds those coordinates in memory. A restart that loads an
existing identity does not recreate a missing gateway file. Escalate that
state; do not silently re-enroll or mint a replacement locally.

## Fingerprint

The fingerprint is SHA-256 over OS, architecture, and hostname. It is a
diagnostic hint, not authentication or hardware attestation.

## Hard Rules

- Route enrollment through `identity::ensure_enrolled`.
- Never log, expose, or duplicate token values.
- Keep Worker identity limited to `worker_id` and `worker_token`.
- Keep private config and gateway writes atomic and permission-restricted.
- Do not implement routine token rotation, local identity deletion, or
  re-enrollment without an explicit product recovery design.

# Worker Lifecycle And Convergence

The Worker heartbeat is both its liveness signal and the carrier for desired
binary versions. Binary versions are all it carries: the agent catalog rides
inside the runtime binary, so there is no catalog version on the wire.

```text
POST /v1/cloud/worker/heartbeat
  request: status=online, Worker version, current AnyHarness version
  response: acknowledgement + optional desiredVersions
            + required launchOptionsUploadAllowed (not desired state)
```

The interval is `heartbeat_interval_seconds` from local configuration with a
10-second minimum. The enrollment response also includes an interval, but the
current Worker does not apply that response value.

Cloud derives liveness from an `online` row with a recent `last_seen_at`. The
Worker reports `online`; current application code does not transition the row
to the schema's `offline` status.

After a successful heartbeat, a process that freshly enrolled compares its
in-memory integration-gateway credential with the shared runtime dotfile and
repairs the file only when it differs. The check is intentionally after
authentication: once a superseded Worker's heartbeat fails, it cannot keep
reasserting a revoked gateway token. A success returned immediately before
revocation can race one final stale write, which the active successor repairs
on its next successful heartbeat.

## Harness Launch-Option Sync (server-gated, no convergence)

Launch-option sync is copied observation, not desired-state convergence. It
runs on the same tick before the mailbox convergence write.

The successful heartbeat acknowledgement carries
`launchOptionsUploadAllowed`. Absent decodes to `false`; on `false`,
`launch_options_sync::maybe_sync` returns before resolving the runtime bearer,
listing harnesses, reading launch options, or uploading anything. The Worker
does not re-derive eligibility.

On `true`, the Worker lists runtime harness kinds, reads
`GET /v1/agents/{kind}/launch-options`, serializes that response verbatim except
for runtime-only readiness decoration, and uploads it to
`/v1/cloud/harness-launch-options/{kind}`. In-memory state tracks the highest
successfully copied source revision per harness. Equal/older revisions are
skipped; a read, encoding, network, or ingest failure leaves the revision
unadvanced for a later tick. The Worker never interprets model/control IDs,
defaults, basis state, or probe evidence.

See [MODELS.md "Cloud copy"](../systems/agent_auth/models.md#cloud-copy)
for the server half of this contract.

## Catalog Convergence (none)

There is no catalog convergence in this crate: the agent catalog ships only
inside the runtime binary, so the AnyHarness binary swap below IS the catalog
update
([agent-distribution.md "Convergence"](../systems/harnesses/distribution.md#convergence)). The Worker has no served catalog version to compare, no
document to fetch, and no push route to call. Do not reintroduce one — a
faster catalog lane would break the invariant that the active catalog is
immutable for the lifetime of the runtime process.

## Supervisor-Owned Convergence (mailbox)

`heartbeat_and_converge` in `runtime.rs` branches on
`supervisor_bridge::is_supervisor_owned(config)` (whether
`supervisor_update_request_dir` is set): supervisor-owned targets route to
`converge_via_mailbox` (the mailbox write); a target with no mailbox dir
converges nothing.

When `WorkerConfig.supervisor_update_request_dir` is set (a supervisor-owned
target), AnyHarness and Worker binary divergence is **not** actioned in this
crate. Instead `supervisor_bridge::write_update_request` resolves the
artifact coordinates (public artifact redirect, sibling `.sha256`, size) and
atomically writes one request into `.proliferate/supervisor/updates`:

```text
desiredVersions diverges from the running AnyHarness/Worker version
  -> resolve artifact_url / sha256 / size_bytes (no download)
  -> build UpdateRequestV1 { request_id = deterministic(component, version), ... }
  -> write_request(dir, &request)   # atomic tmp+rename, 0700/0600
```

`request_id` is derived deterministically from `(component, version)`, so a
replayed heartbeat for the same divergence overwrites the same file rather
than enqueuing a duplicate; Proliferate Supervisor's own idempotency check
(`result_exists`) guarantees exactly one activation. The Worker reads the
Supervisor's terminal result only to reconcile: a successful AnyHarness
activation records the observed version into the store so the next heartbeat
reports convergence (R9-006), then GCs the request+result pair so a later
re-pin to the same version re-applies (R9-003); a terminal failure is left
latched so a lagging artifact is not retried until the pin changes.

See [specs/areas/anyharness.md](anyharness.md)
for the consumer side (verify, download, stage, activate, health-gate,
rollback).

## Launch Policy

Convergence is opt-in by mailbox dir alone. Desktop owns its bundled binaries
and never sets `supervisor_update_request_dir` (its config still writes the
retired `self_update_enabled = false` key, now an ignored no-op). Every
managed-cloud (E2B) target is always supervisor-owned: the server's
`build_worker_config` (`server/proliferate/server/cloud/runtime/bootstrap.py`)
emits `supervisor_update_request_dir` — calling it with
`supervisor_owned=False` raises `ValueError` because the legacy
independent-launch config shape was deleted. So the mailbox path in the
previous section is the only convergence path any Worker config can express;
on-disk configs still carrying the deleted legacy keys parse unchanged
(serde ignores unknown fields).

## Hard Rules

- Treat every convergence action as non-fatal to the heartbeat loop.
- Resolve the exact desired version's artifact coordinates before writing
  them into a mailbox request; never a rolling label.
- Rollback for both AnyHarness and Worker is Proliferate Supervisor's
  responsibility, not this crate's.
- Do not add Supervisor lifecycle behavior (download, stage, activate,
  health-gate, or rollback) to this crate; the mailbox write is the only
  convergence surface here.

# Worker Root Support Files

Root support modules are small process-wide dependencies. The focused root
workflow modules—`integration_gateway.rs` and `launch_options_sync.rs`—are
covered by the identity and lifecycle guides rather than treated as generic
utilities.

## Ownership

| File | Owns | Does not own |
| --- | --- | --- |
| `config.rs` | TOML config loading, defaults, enrollment-token sanitation, atomic private writes | Enrollment or convergence decisions |
| `error.rs` | Worker error variants and source conversion | Recovery policy |
| `logging.rs` | Pre-config bundled diagnostics activation, tracing and Sentry initialization, release identity, privacy scrubbing | Per-flow decisions |
| `observability.rs` | Heartbeat acknowledgement event | A generic telemetry service |
| `process_lock.rs` | One Worker process per canonical database path | Process supervision |
| `versions.rs` | Stamped Worker version; the running AnyHarness version (store-converged record, else the boot-time env hint) | Desired-version policy |

## Configuration Boundary

Current configuration includes:

- Cloud base URL, optional enrollment token, and Worker database path;
- heartbeat interval;
- integration-gateway output home;
- the Supervisor mailbox directory (`supervisor_update_request_dir`), whose
  presence is what makes a target supervisor-owned;
- runtime base URL and optional runtime bearer token for narrow local calls.

Runtime URL defaults to `http://127.0.0.1:8457`. Runtime bearer auth can be
loaded from config or the `ANYHARNESS_BEARER_TOKEN` environment variable by
the focused caller. Keys from the deleted legacy convergence paths that still
appear in deployed configs are ignored as unknown fields.

## Telemetry And Privacy

`logging.rs` stamps component-specific Worker release identity, initializes
Sentry when configured, and scrubs bearer values, URL query strings, and
absolute local paths from captured text. Before config load it also activates
the bundled Desktop diagnostics adapter purely by possession of the two
reserved bridge/shutdown descriptors: when present, the bounded
`proliferate-diagnostics-client` tracing layer joins the subscriber and its
guard flushes on shutdown; when absent, activation is `Disabled` with no
producer task, file, or network behavior. Desktop keeps one continuous
identity-stable natural-exit observer after startup; an ambiguous startup or
later inspection retains the child, bridge, drainers, and tail rather than
turning an error into reap authority. Flow modules still decide what an event
means and when to emit it.

Use current identifiers such as `worker_id` and the authenticated user context
when available. Do not add removed command, Target, projection, slot, or
generation identifiers as standard Worker fields.

## Hard Rules

- Do not add catch-all `utils`, `helpers`, `misc`, or service modules.
- Keep secrets out of errors and telemetry.
- Keep private writes atomic and permission-restricted.
- Move a decision into its focused owner when a support file starts owning a
  workflow.
- The process lock prevents two Workers from sharing one local database; it is
  not a distributed lock or Supervisor contract.

# Worker Runtime

`main.rs` initializes telemetry, parses `--config` and `--once`, loads
`WorkerConfig`, and calls `runtime::run`. It captures a terminal error for
Sentry but does not own Worker behavior.

## Startup

`runtime::run` performs the current startup in this order:

```text
acquire the process lock beside the Worker database
  -> open and migrate Worker-local SQLite
  -> build CloudClient
  -> load durable identity or enroll once
  -> after a fresh enrollment, write integration-gateway credentials
  -> create in-memory launch-option sync state
  -> heartbeat, repair that fresh gateway credential if needed, and converge once
  -> if --once: return
  -> otherwise: sleep for the configured interval and repeat
```

There is one loop. The Worker does not spawn command, event-tail, inventory,
or materialization loops, and it has no custom shutdown coordinator.

## One Tick

```text
POST heartbeat
  -> on failure: log and retry next tick
  -> if this process freshly enrolled and the shared gateway file differs,
     restore its credential now that heartbeat authenticated it
  -> copy changed harness launch-option state when this heartbeat permits it
  -> on a supervisor-owned target, mailbox convergence (non-fatal): reconcile
     activation results, then write update requests for any divergence
```

`--once` sends one heartbeat and may copy changed launch-option state, but it
only reports pending convergence without writing mailbox requests.

## Failure Boundary

After startup, a failed heartbeat or convergence action does not terminate the
loop. The current Worker and runtime continue serving where possible, and a
later heartbeat retries according to the owning module's rules.

Enrollment and local-store failures are startup failures because the loop
cannot authenticate or preserve its required identity without them.

## Hard Rules

- Keep dependency construction and ordering in `runtime.rs`; keep each action
  in its owning module.
- Do not add a broad context object until multiple real consumers require it.
- Do not turn the runtime loop into a command scheduler or process supervisor.
- Preserve the convergence order unless the update safety model changes.
- Keep `--once` non-destructive for binary updates.

# Worker Store

Worker-local SQLite contains only restart-critical Worker state. It is not
Cloud workspace state, AnyHarness runtime state, or a copy of server truth.

## Current Tree

```text
store/
├── mod.rs
├── connection.rs
├── migrations.rs
├── identity.rs
└── anyharness_update.rs
```

## Current Schema

```text
identity (single row, id = 1)
  worker_id
  worker_token
  updated_at

anyharness_update (single row, id = 1)
  converged_version
  failed_pin
  updated_at
```

`identity` lets a restart reuse the opaque Worker credential without another
enrollment. `anyharness_update` keeps its historical name and shape; its
`converged_version` records the runtime version of the last Supervisor
activation the Worker reconciled from the mailbox, which is what the next
heartbeat reports (R9-006). The `failed_pin` column is a leftover of the
deleted Worker-owned swap: unread, kept only because the schema is applied
on real boxes and is not worth migrating for a dead column. The swap journal
and failure latch live with Proliferate Supervisor
([specs/areas/anyharness.md](anyharness.md)).

## Source Ownership

| File | Owns |
| --- | --- |
| `mod.rs` | `WorkerStore` handle and module boundary |
| `connection.rs` | Database creation, private permissions, connection pragmas, and busy timeout |
| `migrations.rs` | Current table creation |
| `identity.rs` | Single-row identity load and upsert |
| `anyharness_update.rs` | Converged-version reads/writes |

The connection enables foreign keys and WAL and uses a five-second busy
timeout. The containing directory and database file are permission-restricted
on Unix.

## Hard Rules

- Keep APIs table-shaped and narrow; do not hide HTTP or convergence workflows
  behind store methods.
- Never store enrollment tokens, integration-gateway credentials, Cloud
  sandbox/workspace rows, commands, event cursors, or projections here.
- Do not log or expose `worker_token`.
- Preserve the single-row invariants unless the identity model itself changes.
- Use the schema and migrations that exist; do not document planned tables as
  current.

---

# Proliferate Supervisor Structure

Status: target standard for `proliferate-supervisor` code.

## Scope

These standards apply to the target-side Supervisor binary:

- `anyharness/crates/proliferate-supervisor/**`

This document defines Supervisor source structure and ownership rules. It does
not own server-side managed-cloud bootstrap, Worker command delivery, or
AnyHarness runtime internals. Read the owning docs for
those areas when changing those boundaries:

- `specs/areas/server.md` for managed-cloud bootstrap code under `server/**`
- `specs/areas/anyharness.md` for target Worker behavior
- `specs/areas/anyharness.md` for AnyHarness runtime behavior

## Goal

Supervisor exists to make a Proliferate target boring to operate. Once a target
has the runtime bundle, one local process should own the lifecycle of the two
long-lived child processes:

```text
proliferate-supervisor
  starts and restarts:
    anyharness
    proliferate-worker
```

The explicit goals are:

- make target process lifecycle predictable
- keep Worker focused on Cloud transport and command delivery
- keep AnyHarness focused on runtime execution
- keep Cloud and installers responsible for provisioning/configuration, not
  child-process supervision
- keep update staging local, narrow, verifiable, and separate from rollout
  policy

Supervisor is not Cloud, not Worker, and not AnyHarness.

## Implementation Status (this PR)

The update-mailbox consumer this PR adds is implemented and unit-tested. The
shared `proliferate-runtime-update-protocol` dependency, the `SupervisorConfig`
mailbox/health/download fields, the `SupervisorError` variants, the mailbox
consumer (`update/request.rs`), the bounded artifact download (`update/download.rs`),
the activation state machine (`update/activate.rs`), `RollbackPlan::apply`
(restore `.prev` over the active path), and the real `/health`-polling gate in
`process/health.rs` are all in place. `process/mod.rs` drains the mailbox
(`activate::run_pending` via the `LiveHost` adapter) once children are up, and
`cargo build -p proliferate-supervisor` succeeds. Two distinct live proofs
exist here, and both PASSED on real E2B sandboxes 2026-07-26: the UPDATE proof
(a fresh supervisor-owned sandbox converging pins 0.3.47→0.3.48 end to end,
this mailbox consumer included, zero rollbacks, ~75s convergence) and the D5
BRIDGE proof (in-place migration of an already-running legacy Worker's
process tree onto Supervisor via the one-time bridge, not a fresh provision —
sandbox `iwwvadhffzxoora56f437`, ~2.5s, no destroy/recreate). Both proofs
together cleared the gate to delete the server-side legacy launch path
entirely (`server/proliferate/server/cloud/materialization/sandbox_io/runtime_launch.py`
now has only one launch topology); the Worker-side bridge code itself was
deleted after full fleet convergence by the cull sweep's delete-worker-legacy
track. Everything below describes running code.

## Target Shape

```text
src/
  main.rs
  config.rs
  error.rs
  logging.rs
  observability.rs

  process/
    mod.rs
    child.rs
    health.rs
    restart.rs

  install/
    mod.rs
    layout.rs
    service.rs

  update/
    mod.rs
    request.rs
    manifest.rs
    download.rs
    staging.rs
    activate.rs
    rollback.rs
```

Do not create empty folders. Introduce a file or folder only when it has real
responsibility to own.

## What Goes Where

Use the lowest layer that can own the logic cleanly.

| Area | Path | Owns | Must Not Own |
| --- | --- | --- | --- |
| CLI entry | `src/main.rs` | CLI parsing, command dispatch, top-level error capture, and invoking the owning module. | Process lifecycle logic, update artifact mechanics, config schema policy, Cloud or AnyHarness semantics. |
| Config | `src/config.rs` | `SupervisorConfig`, TOML load/parse, default config path, and default restart/argument values. | Server bootstrap config generation, installer env validation, runtime execution policy. |
| Process lifecycle | `src/process/**` | Starting AnyHarness, starting Worker, restart timing, child process kill/wait behavior, and upgrade-window hooks. | Cloud command semantics, AnyHarness session/workspace behavior, binary download/swap, target enrollment. |
| Child spawning | `src/process/child.rs` | Focused child process spawn wrapper and env injection. | Restart loops or command-specific process behavior. |
| Restart policy | `src/process/restart.rs` | Boring restart delay/backoff helpers. | Product policy or target availability decisions. |
| Process health hooks | `src/process/health.rs` | Bounded polling of AnyHarness `/health` (matching the candidate version when known) and Worker liveness after a restart — the real activation health gate. | Cloud target state, update admission policy, artifact mechanics. |
| Install helpers | `src/install/**` | Supervisor-owned install layout helpers and systemd unit rendering. | Binary download, enrollment token handling, Cloud API calls. |
| Mailbox consumer | `src/update/request.rs` | Consuming the shared `proliferate-runtime-update-protocol` crate: scanning the mailbox for the next pending request, deduping against an already-written result, and recording results/invalid outcomes. | Defining the wire shapes (owned by the shared protocol crate), download, staging, or activation mechanics. |
| Update manifest | `src/update/manifest.rs` | Manifest parsing, supported component validation, artifact lookup, size checks, and checksum verification. | Rollout policy, desired-version reconciliation, binary replacement. |
| Update download | `src/update/download.rs` | Bounded `reqwest` GET of only the `artifact_url` named in a verified request, into the private staging dir, with timeout and max-size guards. | Following redirects beyond the single named URL, Cloud API calls, checksum policy (that stays a re-verify step against the manifest). |
| Update staging | `src/update/staging.rs` | Verified artifact staging, private permissions, atomic write/rename, and parent directory sync. | Downloading artifacts, applying swaps, restarting children after swaps. |
| Update activation | `src/update/activate.rs` | The activation state machine: verify → download → re-verify → stage → atomic activate → dependency-ordered restart → health-gate → result or rollback. Drains one mailbox request per supervise cycle. | Cloud command semantics, AnyHarness/Worker product behavior, desired-version policy (the request already encodes that). |
| Rollback | `src/update/rollback.rs` | Rollback plan data shape **and** its real `apply()` — restoring `.prev` over the active path when a health gate fails. | Production rollout orchestration or Worker/Cloud status policy. |
| Logging | `src/logging.rs` | Tracing/Sentry initialization and target-safe event scrubbing. | Product analytics, Cloud status, command correlation policy outside Supervisor logs. |
| Observability | `src/observability.rs` | Small semantic log helpers for Supervisor-owned events. | Broad telemetry pipelines or target inventory reporting. |
| Errors | `src/error.rs` | `SupervisorError` variants for Supervisor-owned failures. | Worker, Cloud, AnyHarness, or installer error domains. |

## Core Workflow

The main `run` workflow lives in `src/process/mod.rs`.

```text
load SupervisorConfig

loop:
  spawn AnyHarness with configured args/env

  loop:
    spawn Worker with:
      --config <worker_config>
      PROLIFERATE_SUPERVISOR_VERSION=<supervisor version>

    drain the update mailbox (update::activate::run_pending):
      for each next pending request with no result yet:
        verify manifest -> download -> re-verify -> stage
          -> activate atomically -> restart the changed component(s)
             in dependency order (AnyHarness before Worker)
          -> health-gate; on failure, roll back to `.prev`, restart, re-gate
        write exactly one result (activated | rolled_back | invalid)

    if AnyHarness exits:
      kill Worker
      wait for Worker
      restart both

    if Worker exits:
      wait restart delay
      restart Worker

  wait restart delay
```

The mailbox drain runs once per supervise cycle, after children are up and
before/around the restart select, so an update in flight cannot race an
unrelated child-exit restart. This is the core Supervisor primitive. Keep it
legible.


## Operational Notes

- A persistent TLS-trust failure fetching an update artifact (e.g. an expired or
  wrong certificate at the CDN) is classified as a transient `DownloadTransport`
  error, so the mailbox request is retried indefinitely rather than latching a
  terminal `Invalid` (consistent with R9-002's "network blips retry" intent).
  Operationally this means a genuinely broken artifact host shows up as a
  never-converging update, not a failed one — watch heartbeat staleness /
  desired-vs-observed divergence rather than expecting a terminal result. A
  bounded-retry cap is a possible future refinement.

## Boundary Model

```text
Server (managed-cloud bootstrap)
  writes worker config
  writes supervisor config
  launches supervisor

Supervisor
  starts/restarts AnyHarness and Worker
  injects configured env into children
  consumes the update mailbox: verifies, fetches (bounded reqwest),
    re-verifies, stages, atomically activates, restarts in dependency
    order, health-gates, and rolls back an unhealthy activation
  never self-updates (image-bound)

Worker
  enrolls target with Cloud
  heartbeats component versions/status
  leases Cloud commands
  writes narrow desired-update mailbox requests

AnyHarness
  owns target-local runtime execution:
  workspaces, sessions, transcripts, agents, MCP, files, git, terminals
```

Supervisor should know paths, binaries, env, child exits, restart delay, and
update artifacts. It should not know product workflows.

## Hard Rules

- `main.rs` stays a thin CLI and command dispatcher.
- `process/**` owns child lifecycle only. It must not call Cloud APIs,
  AnyHarness HTTP APIs, or Worker internals.
- Supervisor starts Worker; Worker talks to Cloud. Do not add a Cloud client
  to Supervisor.
- Supervisor starts AnyHarness; AnyHarness owns runtime semantics. Do not add
  session, workspace, agent, MCP, file, git, or terminal behavior to
  Supervisor.
- Supervisor may fetch (bounded `reqwest`, only the URL named in a verified
  request), stage, activate, health-gate, and roll back update artifacts. It
  must not own desired version policy, update admission, billing, target
  selection, or Cloud status policy — the request already encodes what to do.
- Update artifact identifiers must remain path-safe. Components stay limited
  to `anyharness` and `worker` (the shared protocol crate's `UpdateComponent`
  enum has no `supervisor` variant — the Supervisor is image-bound and never
  self-updates; a request naming it cannot be represented, not merely
  rejected).
- Staged update files and update directories must use private permissions.
- Child processes must be killed/waited in the same lifecycle boundary that
  spawned them.
- Environment passed to children must be explicit and config-driven. Do not
  silently inherit new credential or product env.
- Keep module names concrete. Do not add `utils.rs`, `helpers.rs`, or
  `misc.rs`.

## Dependency Direction

Preferred direction:

```text
main -> config / process / install / update / logging / observability

process -> config / error
process -> process/child
process -> process/restart
process -> process/health

install -> config / install/layout
update -> error
update/request -> proliferate-runtime-update-protocol (shared wire crate)
update/download -> reqwest (bounded fetch only)
update/activate -> update/{request,manifest,download,staging,rollback} / process/health
observability -> update/staging
logging -> no product modules
```

`proliferate-runtime-update-protocol` is an explicit, allowed workspace
dependency: a tiny serde-only crate that defines the mailbox wire shapes and
their atomic file IO. Both Supervisor and Worker depend on it; it depends on
neither, so taking it on does not pull in Worker internals and is not the
forbidden direction below. `reqwest` is likewise an explicit, declared
dependency (added for this change) scoped to `update/download.rs` only —
Supervisor's one and only outbound HTTP client, bounded to the single
`artifact_url` named in an already-verified request.

Forbidden direction:

```text
Supervisor -> server/**
Supervisor -> proliferate-worker internals (the shared protocol crate is not this)
Supervisor -> anyharness-lib runtime internals
Supervisor -> cloud SDK/client code
```

If a dependency feels awkward, keep the boundary narrow by passing paths,
args, env, or manifest data in through config or CLI arguments.

## Change Discipline

- Preserve the simple process model unless the task explicitly changes target
  lifecycle behavior.
- When changing runtime bundle layout, check server bootstrap,
  release/template scripts, and smoke tests together.
- When changing config schema, update managed-cloud config generation.
- When changing update staging or manifest validation, add focused Rust tests
  for path safety, checksum/size rejection, and permission behavior.
- When splitting files, split by responsibility first and preserve behavior.
- Keep Supervisor docs focused on Supervisor. Link to Worker, Server,
  Installer, and AnyHarness docs instead of copying their rules here.

## Review Checklist

- Can I tell from the path whether this is CLI, config, child lifecycle,
  install rendering, update verification/staging, logging, or errors?
- Did process lifecycle stay independent from Cloud command semantics?
- Did Supervisor avoid AnyHarness runtime behavior?
- Did Supervisor avoid Worker command/event/status logic?
- Are child env vars explicit and intentional?
- Are update artifact identifiers and staged paths path-safe?
- Are staged update permissions private?
- Did config schema changes update every config writer?
- Did runtime bundle changes check managed cloud, release, and smoke
  paths together?

---

# Generated references (formerly specs/areas/)

Files in this directory are reproducible evidence generated by code or schema
owners. Do not edit generated output by hand.

| Reference | Owner | Regenerate | Owning test |
| --- | --- | --- | --- |
| [`anyharness-db-schema.sql`](anyharness-db-schema.sql) | AnyHarness SQLite migrations (`anyharness/crates/anyharness-lib/src/persistence/migrations.rs`) | `cargo test -p anyharness-lib update_anyharness_schema_snapshot -- --ignored` | `anyharness_schema_snapshot_matches_migrations` in [`anyharness/crates/anyharness-lib/src/persistence/schema_snapshot_tests.rs`](../../anyharness/crates/anyharness-lib/src/persistence/schema_snapshot_tests.rs) |

The owning test must fail when generated output drifts from its source. The
regenerate command is the `#[ignore]`d twin of that test in the same file: it
runs the migrations against an in-memory database, dumps the schema, and
rewrites the snapshot at the path the checking test reads.
