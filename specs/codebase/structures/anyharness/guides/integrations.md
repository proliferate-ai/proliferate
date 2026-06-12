# AnyHarness Integrations

Status: authoritative for external protocol/vendor mechanics.

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

Avoid product-domain names:

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

domains/sessions/subagents/mcp
  subagent tool behavior

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
  acp_registry.rs
  executable.rs
  launcher.rs
  model_discovery.rs
```

This is mostly valid, but should stay narrow.

Mapping:

```text
acp_registry.rs
  ACP registry wire schema, fetch/parse/resolve distribution metadata,
  install metadata mechanics.

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
