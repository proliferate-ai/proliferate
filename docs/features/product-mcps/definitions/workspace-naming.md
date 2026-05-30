# Workspace Naming MCP

Status: authoritative target definition for the Workspace Naming product MCP.

## Identity

```text
id: workspace_naming
owner domain: domains/sessions/workspace_naming
implementation: sessions/workspace_naming/mcp/**
visibility: internal
route slug: workspace_naming
server name: proliferate-workspace-naming
default injection: attach only to first-turn workspace naming sessions that
  are eligible to set the workspace display name
```

This MCP lets a dedicated naming session set a concise display name for a
workspace before doing any other visible work.

## Auth

Current auth shape:

```text
header: x-workspace-naming-session-token
secret file: workspace-naming-mcp-token.key
ttl: 12 hours
scope: workspace_id + session_id
signature: HMAC SHA-256
```

Target scope:

```text
workspace_id
session_id
product_mcp_id: workspace_naming
capability: set_workspace_display_name
```

## Selection And Injection

Attach when:

- the session was created for workspace naming
- the workspace/session passes naming eligibility checks
- the session is on the first turn where naming should occur before any other
  visible output

Do not attach when:

- the workspace already has final naming state that should not be changed
- the session is not the naming session
- the workspace is not mutable

Injection output:

```text
url: /v1/workspaces/{workspace_id}/sessions/{session_id}/mcp/workspace_naming
headers:
  authorization: Bearer <runtime token> when runtime auth is enabled
  x-anyharness-product-mcp-token or x-workspace-naming-session-token: scoped token
binding summary: workspace naming tool attached
first-prompt-only prompt text: call the naming tool before any visible response
```

This MCP is intentionally prompt-sensitive. Its prompt text belongs in session
MCP injection, not inside the actor loop.

## Context

`context.rs` resolves:

- workspace id
- session id
- session record
- workspace record
- naming eligibility
- workspace mutability

Context validation must prove the session belongs to the workspace and that the
naming tool is allowed for this session.

## Tools

Current tool:

```text
set_workspace_display_name
  displayName: string
```

Instructions should make the agent-visible qualified name explicit when tools
are namespaced:

```text
mcp__workspace_naming__set_workspace_display_name
```

The tool description must also state:

- call this before any user-visible response in the naming turn
- do not use ToolSearch to find it
- do not use subagents for workspace naming
- do not rename git branches

## Calls

`calls.rs` delegates to:

- session store to load and validate the session
- workspace runtime to load and update workspace display name
- workspace access gate to assert mutability
- workspace naming eligibility policy

Required call invariants:

- trim and reject empty display names
- validate session belongs to workspace
- validate naming eligibility
- assert workspace mutability before update
- update only workspace display name; do not rename branches

## UI Exposure

Internal only.

Workspace UI owns visible naming state. The MCP binding summary may show that
naming tools were attached, but the user should not see a generic toggle for
this MCP.

## Tests

Required tests:

- selection attaches only for naming-eligible sessions
- context rejects wrong workspace/session pair
- tool description includes the exact namespaced tool name
- tool description forbids ToolSearch/subagents/branch renaming
- empty display name is rejected
- workspace mutability is enforced
- call updates workspace display name through workspace runtime

## Migration Acceptance

Done when:

- `sessions/workspace_naming/mcp_server/**` is replaced by
  `domains/sessions/workspace_naming/mcp/**`.
- eligibility/context logic lives in `context.rs`.
- prompt-sensitive instructions live in injection/definition, not actor code.
- `calls.rs` delegates to workspace runtime/access gate and naming policy.
- shared JSON-RPC dispatch lives in `integrations/mcp/product_server`.
