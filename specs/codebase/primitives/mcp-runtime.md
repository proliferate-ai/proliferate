# MCP In AnyHarness

Status: authoritative for the MCP mental model in AnyHarness.

MCP appears in several places. They are related, but they are not the same
thing.

## Four MCP Concepts

### 1. User MCP Bindings

MCP servers explicitly attached to a session by a client/user.

Implementation owner:

```text
domains/sessions/mcp_bindings/
```

Responsibilities:

- stored MCP server models
- encryption/decryption
- binding summary validation
- contract mapping
- conversion to ACP MCP server config

This folder also owns the central session MCP assembly path described below.

### 2. Session Extensions

Product features can inject MCP servers into a session launch.

Current trait: `domains/sessions/extensions.rs::SessionExtension`.

Current implementations:

```text
domains/cowork/runtime.rs
domains/reviews/hooks.rs
domains/sessions/subagents/hooks.rs
```

The extension returns launch extras:

- system prompt append text
- first prompt system prompt append text
- internal MCP servers
- binding summaries

### 3. Product MCP Servers

Internal Proliferate tool surfaces exposed to agents through HTTP MCP servers.

Examples:

- cowork artifact/delegation tools
- subagent tools
- review tools

Current implementation shape:

```text
domains/cowork/mcp/
domains/reviews/mcp/
domains/sessions/subagents/mcp/
```

Product tool behavior stays with the product domain.

### 4. MCP Elicitation

Live ACP interaction type where an agent asks for an MCP form or URL reveal.

Current implementation owner:

```text
live/sessions/interactions/mcp_elicitation.rs
live/sessions/interactions/mcp_elicitation/
```

Target owner:

```text
live/sessions/interactions/mcp_elicitation/
```

This is part of the live interaction broker, not a product MCP tool server.

## Current Injection Flow

```text
SessionRuntime starts a session
  -> decrypts user MCP bindings unless internal-only policy applies
  -> asks registered SessionExtension implementations for launch extras
  -> merges system prompt append values
  -> persists extension binding summaries
  -> appends internal MCP servers to user MCP servers
  -> passes final MCP server list to the live session actor
```

## Session MCP Assembly

Session launch needs one central assembly boundary. Do not spread MCP launch
composition across session runtime, product domains, and actor startup.

Implementation owner:

```text
domains/sessions/mcp_bindings/assembly.rs
```

This boundary answers one question:

```text
Which MCP servers, prompt additions, and binding summaries should this session
launch with?
```

Current shape:

```text
domains/sessions/mcp_bindings/
  model.rs       # SessionMcpServer, headers/env, policies, summaries
  crypto.rs      # binding encryption/decryption and data-key loading
  contract.rs    # contract <-> domain mapping
  summaries.rs   # summary validation/serialization/merge helpers
  acp.rs         # SessionMcpServer -> ACP MCP server config
  assembly.rs    # assemble_session_mcp_launch(...)
```

The assembly function owns:

- applying `InternalOnly` vs user-inherited binding policy
- decrypting user-supplied MCP bindings
- collecting launch extras from registered session extensions
- merging user and product MCP servers in launch order
- merging and validating binding summaries
- producing system prompt append text and first-prompt append text
- returning restart-required/missing-data-key errors when persisted bindings
  cannot be used

It does not own:

- JSON-RPC parsing or response formatting
- capability-token signing
- product tool behavior such as `create_subagent`, `submit_review_result`, or
  `create_artifact`
- live MCP elicitation resolution

The caller should read like:

```text
SessionRuntime::start_live_session
  -> load workspace and resolve agent
  -> assemble_session_mcp_launch(...)
  -> persist changed/extension binding summaries
  -> start live actor with final MCP server list and prompt additions
```

The actor receives the final launch payload. It should not decide which product
MCP servers to inject.

### Reconfiguration of a live session

The MCP list is fixed for one live actor generation. A product such as
Workflows that must replace interactive bindings does not inject an MCP server
into the running actor. It first closes admission and quiesces/checkpoints the
session, stops the actor, calls the same central
`assemble_session_mcp_launch(...)` boundary with the new policy, and restarts
the same durable session ID/transcript under a new actor generation. Releasing
the temporary policy uses the same reverse restart with newly minted bindings.
If quiescence or restart acknowledgment fails, the session remains fenced; it
does not run with a partially changed MCP list.

### Product MCP Extension Pattern

Every product MCP feature should follow the same two-part pattern.

First, the session MCP binding layer contributes launch extras:

```text
domains/sessions/mcp_bindings/product_catalog.rs
  -> decides which product MCPs attach to a launched session
  -> returns binding summaries and any product prompt additions
  -> builds concrete HTTP MCP server configs
  -> mints product capability tokens
```

Second, the product MCP server implements the tools:

```text
domains/<feature>/mcp/
  definition.rs  # stable id, route slug, ACP server name, prompt text
  auth.rs        # thin feature auth wrapper around integrations/mcp/product_server
  context.rs     # request/session context resolution
  tools.rs       # feature tool args and tool list
  calls.rs       # product tool handlers
```

Session MCP binding code is about making tools available to an agent. Product
MCP server code is about handling tool calls after the agent invokes them. Keep
those separate.

Each product extension typically creates an HTTP MCP server:

```text
url: /v1/workspaces/{workspace_id}/.../{session_id}/mcp
headers:
  authorization: Bearer <runtime token>       # when runtime auth is enabled
  x-anyharness-product-mcp-token: <capability token>
```

## Current Endpoint Flow

Each product MCP endpoint currently has:

```text
GET  -> 204 No Content
POST -> validate capability header
        optionally acquire workspace operation lease
        optionally assert workspace mutable
        dispatch through integrations/mcp/product_server
        return JSON-RPC response or no-content response
```

Target shared owner for transport scaffolding:

```text
api/http/product_mcp.rs
```

Target shared owner for protocol/auth helpers:

```text
integrations/mcp/
  capability_token.rs
  json_rpc.rs
  tools.rs
```

The shared `integrations/mcp/**` helpers are present. New HTTP transports use
the shared product-MCP scaffolding instead of adding per-feature wrappers.

## Consolidation Rule

Move common scaffolding:

- signed capability-token helper
- secret-file creation
- JSON-RPC request parsing
- initialize response helper
- result/error helpers
- tool definition helper
- tool result formatting

Do not move product behavior:

- `create_subagent`
- `submit_review_result`
- `create_artifact`
- cowork delegation/coding tools

Those stay in the owning domain.

## Dependency Rule

```text
domains/<feature>/mcp -> integrations/mcp/product_server
api/http/product_mcp -> domains/sessions/mcp_bindings/product_registry
integrations/mcp -> no product domains
```

The integration layer speaks MCP. Product domains decide what tools do.
