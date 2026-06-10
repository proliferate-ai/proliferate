# AnyHarness App Composition

Status: authoritative for `anyharness-lib/src/app/**`.

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
domains/sessions/workspace_naming/session_extension.rs
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
ReviewProductMcpServer
SubagentProductMcpServer
WorkspaceNamingProductMcpServer
CoworkProductMcpServer
SkillsProductMcpServer
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
domains/sessions/mcp_bindings/selection.rs
domains/sessions/mcp_bindings/injection.rs
  launch-side selection and materialization

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
