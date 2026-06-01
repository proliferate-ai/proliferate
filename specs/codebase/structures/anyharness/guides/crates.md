# AnyHarness Crates

Status: authoritative for crate ownership under `anyharness/crates/**`.

## Ownership

```text
anyharness/
  thin binary crate

anyharness-contract/
  public wire schemas and OpenAPI-visible types

anyharness-credential-discovery/
  shared provider credential discovery and portable auth normalization

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

Use [../README.md](../README.md) for the internal runtime structure.
