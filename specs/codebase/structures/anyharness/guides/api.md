# AnyHarness API Layer

Status: authoritative for `anyharness-lib/src/api/**`.

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
domain `runtime.rs` or `service.rs`. Migration exception:
`workspaces_lifecycle.rs` implements the retire/cleanup state machine inline
(three copies with retention); target is a workspaces lifecycle service.

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
per record, called in a loop on list paths); `api/http/agents.rs` carries a
second error mechanism (`ProblemResponse`) alongside `ApiError`; `cowork.rs`
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
domains/sessions/mcp_bindings/selection.rs
domains/sessions/mcp_bindings/injection.rs
  launch-side selection and materialization
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
