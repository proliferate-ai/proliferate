# AnyHarness API Layer

Status: authoritative for `anyharness-lib/src/api/**`.

## Purpose

`api/` is the transport boundary. It owns how clients reach the runtime, not the
runtime behavior itself.

API files may own:

- route registration
- request extraction
- header/query/path/body parsing
- contract request/response mapping
- error-to-problem mapping
- auth middleware
- OpenAPI registration
- SSE and WebSocket transport details

API files must not own durable domain rules, live actor state machines, raw SQL,
or product workflow algorithms.

## Handler Shape

Handlers should read as:

```text
extract request
map contract input to internal input
call owning service/runtime
map internal result to contract response
map errors
```

If a handler contains a multi-step product sequence, move that sequence to the
owning domain `runtime.rs` or `service.rs`.

## Contract Mapping

Contract request and response types belong at the API boundary.

Preferred:

```text
api/http/<resource>.rs
  route handlers

api/http/<resource>_contract.rs
  internal <-> contract mappers when the mapping is large
```

Do not pass contract request/response types deep into domains or live runtime
code.

Exception: normalized session event payloads may be contract types below `api/`
when they are explicitly the durable event-log payload.

## AppState Use

Handlers pull coarse-grained dependencies from `AppState`:

```rust
state.session_runtime
state.session_service
state.workspace_runtime
state.terminal_service
```

Handlers should not use `AppState` fields to manually reconstruct workflows
that a domain runtime already owns.

## Operation Gates

Workspace operation gates may be acquired in API handlers when they are
transport-scoped admission checks around a single call. If the lease is part of
a deeper product workflow, move the workflow and lease ownership into the
domain runtime.

## MCP Endpoints

Product MCP endpoints are transport wrappers around product MCP servers.

The API layer may own:

- extracting the feature capability token header
- returning 401/400/204/200 responses
- calling a shared MCP endpoint helper

The API layer must not own tool behavior. Tool behavior belongs in the owning
domain MCP server.
