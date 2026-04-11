# AnyHarness Standards

Status: authoritative for AnyHarness runtime code in this repo.

Scope:

- `anyharness/crates/anyharness/**`
- `anyharness/crates/anyharness-credential-discovery/**`
- `anyharness/crates/anyharness-contract/**`
- `anyharness/crates/anyharness-lib/**`

Use this doc to answer the main runtime questions:

- which crate owns what?
- where does code live inside `anyharness-lib/src/**`?
- what is the difference between transport state, durable state, and live
  runtime state?
- why do handlers reach for `AppState` instead of importing everything
  directly?

This file owns the overall structure and ownership model for AnyHarness.
Subsystem docs under `docs/anyharness/src/**` explain the deeper runtime logic
for individual areas.

## 1. File Tree

```text
anyharness/
  crates/
    anyharness/
      src/
    anyharness-credential-discovery/
      src/
    anyharness-contract/
      src/
        v1/
    anyharness-lib/
      src/
        app/
        api/
        acp/
        agents/
        cowork/
        sessions/
        repo_roots/
        workspaces/
        files/
        git/
        hosting/
        processes/
        terminals/
        persistence/
```

Use this as the default runtime shape.

- `anyharness` is the thin binary crate.
- `anyharness-credential-discovery` owns shared provider-specific auth parsing
  and portable export rules used by both desktop and runtime code.
- `anyharness-contract` is the transport-schema crate.
- `anyharness-lib` owns the actual runtime implementation.

## 2. Non-Negotiable Rules

- `anyharness` stays thin. It owns CLI/bootstrap only, not runtime behavior.
- `anyharness-credential-discovery` owns provider-specific credential parsing
  and portable file normalization, not transport or runtime orchestration.
- `anyharness-contract` owns wire shapes only. It must not grow runtime logic.
- `anyharness-lib` owns runtime behavior, domain logic, live orchestration, and
  workspace-facing adapters.
- API handlers are boundary adapters, not the canonical home for runtime logic.
- Contract types stop at the transport boundary. They are not the default
  internal service model.
- `AppState` is shared runtime dependencies, not business logic and not a
  global junk drawer.
- Long-lived mutable runtime state must stay explicit and injectable.
- Durable business domains may use `model.rs` / `store.rs` / `service.rs`.
- Live runtime subsystems may use role-shaped modules such as `manager`,
  `actor`, `sink`, `broker`, `resolver`, or `installer`.
- Use `runtime.rs` or `orchestrator.rs` for cross-domain flows that do not fit
  one durable domain cleanly.
- Avoid generic catch-all modules such as `utils`, `helpers`, `misc`, or flat
  `services`.
- Delete dead runtime code instead of preserving parallel implementations.

## 3. Ownership Model

Use the lowest crate or runtime area that can own the logic cleanly.

| Concern | Owner | Rule of thumb |
| --- | --- | --- |
| CLI parsing, tracing init, command dispatch, server startup | `anyharness` | Thin executable shell only. |
| Shared Claude/Codex auth discovery and portable file normalization | `anyharness-credential-discovery` | Reused by desktop sync and runtime readiness without owning env persistence. |
| HTTP bodies, SSE payloads, WS payloads, OpenAPI-visible schemas | `anyharness-contract` | Public wire shapes only. |
| Composition root and shared runtime object graph | `anyharness-lib/src/app/` | Build `AppState` here and keep it focused on injected dependencies. |
| HTTP, SSE, WS, router, auth middleware, OpenAPI translation | `anyharness-lib/src/api/` | Transport boundary only. |
| Durable session truth and session-domain invariants | `anyharness-lib/src/sessions/` | Session rows, event rows, validation, and durable configuration rules. |
| Durable cowork truth and cowork thread invariants | `anyharness-lib/src/cowork/` | Cowork root/thread rows, artifact lifecycle, built-in MCP, and cowork-specific orchestration. |
| Durable repo-root truth | `anyharness-lib/src/repo_roots/` | Canonical repo roots, remote metadata, and repo-level identity. |
| Live ACP-backed session execution | `anyharness-lib/src/acp/` | In-memory actors, live session registry, permission mediation, and event normalization. |
| Agent metadata, readiness, installation, and provider catalog | `anyharness-lib/src/agents/` | Descriptor, registry, resolver, installer, and credential discovery flow. |
| Workspace identity, registration, resolution, worktrees, and env derivation | `anyharness-lib/src/workspaces/` | Execution-surface truth and worktree semantics. |
| Focused workspace-facing adapters | `anyharness-lib/src/files/`, `git/`, `hosting/`, `processes/` | Keep them narrow and scoped to one capability. |
| Live PTY lifecycle and terminal state | `anyharness-lib/src/terminals/` | Long-lived in-memory PTY handles and WS bridge behavior. |
| SQLite bootstrap, migrations, and DB wiring | `anyharness-lib/src/persistence/` | Shared DB/runtime persistence boundary. |

### Main Runtime Concepts

There are three different kinds of truth in the runtime:

- Contract state
  - what clients see on the wire
  - owned by `anyharness-contract`
- Durable state
  - what SQLite stores across process restarts
  - mainly owned by `sessions/`, `workspaces/`, and `persistence/`
- Live state
  - what only exists while the process is running
  - mainly owned by `acp/` and `terminals/`

That is why the code is layered. The runtime is intentionally separating:

- transport glue
- durable domain logic
- live in-memory orchestration

### Why `AppState` Exists

Imports give you code definitions. `AppState` gives handlers the already-built
runtime dependencies.

Use `AppState` when the API layer needs a shared long-lived runtime object,
such as:

- session runtime orchestration
- ACP live-session management
- terminal/PTTY lifecycle management
- shared workspace or session services built with runtime dependencies

Do not use `AppState` as a place to hide business logic. Handlers should pull a
coarse-grained dependency from state, then call into the owning service or
runtime.

### Common Flow Shapes

- Workspace resolve
  - handler -> workspace service -> resolver + workspace store
- Session create / resume / prompt
  - handler -> session runtime -> session service -> session store
  - then session runtime -> workspace service + ACP manager for live execution
- Session SSE
  - SSE handler -> durable backlog from session service + live events from ACP
- Terminal WebSocket
  - WS handler -> terminal service

### Common Module Patterns

- `model.rs`
  - internal durable records and runtime-owned domain types
- `store.rs`
  - persistence access only
- `service.rs`
  - durable-domain invariants and orchestration
- `runtime.rs` or `orchestrator.rs`
  - cross-domain workflows that coordinate durable domains with live runtime
    subsystems
- `resolver.rs`
  - discovery and probing
- `manager.rs`, `session_actor.rs`, `event_sink.rs`, `permission_broker.rs`
  - live runtime coordination
- `<dependency>.rs` or `<dependency>_cli.rs`
  - raw external wrappers

## 4. Read Order

Read this file first.

Then read:

1. [binary.md](binary.md) if the change touches the binary crate
2. [contract.md](contract.md) if the change touches transport schemas
3. the relevant subsystem doc under `docs/anyharness/src/**` when the change
   touches runtime logic:
   - `src/agents.md`
   - `src/acp.md`
   - `src/cowork-artifacts.md`
   - `src/git.md`
   - `src/files.md`
   - `src/persistence.md`
   - `src/workspaces.md`
   - `src/sessions.md`
