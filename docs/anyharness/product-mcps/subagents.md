# Subagents MCP

Status: authoritative target definition for the Subagents product MCP.

## Identity

```text
id: subagents
owner domain: domains/sessions/subagents
implementation: sessions/subagents/mcp/**
visibility: internal
route slug: subagents
server name: proliferate-subagents
default injection: attach to parent sessions that are allowed to create/manage
  same-workspace child agent sessions
```

This MCP lets a parent agent create and supervise same-workspace child sessions.
It is a product workflow built on the normal session runtime. It must not
create a parallel session engine.

## Auth

Current auth shape:

```text
header: x-subagent-session-token
secret file: subagent-mcp-token.key
ttl: 12 hours
scope: workspace_id + parent_session_id
signature: legacy sha256-dot today; target should use the shared product MCP
  token envelope from integrations/mcp/product_server
```

The capability token authorizes only the parent session it was minted for. It
does not grant access to arbitrary child sessions; child access is checked by
the subagents domain.

## Selection And Injection

Attach when:

- the session is a standard parent session
- the product launch policy allows subagents
- the parent can create same-workspace child sessions

Do not attach when:

- the session is itself a subagent child that cannot create grandchildren
- workspace/session policy disables subagents
- the session launch is internal-only and does not include the subagent
  capability

Injection output:

```text
url: /v1/workspaces/{workspace_id}/sessions/{parent_session_id}/mcp/subagents
headers:
  authorization: Bearer <runtime token> when runtime auth is enabled
  x-anyharness-product-mcp-token or x-subagent-session-token: scoped token
binding summary: subagents capability attached
prompt text: explain same-workspace child sessions, creation limits, and wake
  behavior
```

The actor receives the final HTTP MCP server config. It must not evaluate
subagent policy.

## Context

`context.rs` resolves:

- workspace id
- parent session id
- parent session record
- workspace surface
- existing child count
- child ownership validation
- limits such as max children and depth
- launch catalog/live config needed to compute defaults

Current invariant:

- subagents are only available in standard workspaces
- child sessions are normal sessions in the same workspace
- grandchildren are not allowed
- child MCP inheritance is currently none

## Tools

Current tools:

```text
get_subagent_launch_options
  returns defaults, limits, supported agent/model choices, mode hints, and
  creation block reason

create_subagent
  creates a durable child session, links it to the parent, starts it, and sends
  the initial prompt

list_subagents
  lists child sessions owned by this parent

send_subagent_message
  sends another prompt to an owned child session

schedule_subagent_wake
  schedules a one-shot wake when the child's next newly completed turn lands

get_subagent_status
  returns execution status for an owned child session

read_subagent_events
  returns a bounded sanitized event slice from an owned child session
```

Tool list construction belongs in `tools.rs`. Tool availability should vary by
typed context, not by ad hoc checks inside JSON-RPC dispatch.

## Calls

`calls.rs` delegates to:

- subagents service for parent/child ownership and links
- session runtime for durable session creation, live start, and prompt send
- session event read APIs for sanitized child event slices

Required call invariants:

- trim and validate prompts before creating or sending
- validate parent can spawn before creating a child
- rollback child session/link state when startup fails
- do not bypass `SessionRuntime` for child session creation/start/prompt
- never expose events for a child not owned by the parent
- wake scheduling is explicit and not retroactive

## UI Exposure

Internal only.

UI may show:

- attached subagents capability in MCP binding summaries
- child sessions in the workspace/session UI through normal subagent product
  state

UI should not show a generic user toggle for this MCP until subagents become a
separately configurable product capability.

## Tests

Required tests:

- selection attaches subagents only to eligible parent sessions
- selection does not attach to child sessions/grandchild contexts
- token rejects wrong workspace/session
- `tools/list` includes launch options before create
- `create_subagent` rolls back on failed link/start/prompt
- child event reads are ownership-scoped and bounded
- wake scheduling is idempotent and not retroactive
- actor launch receives final MCP config without policy branches

## Migration Acceptance

Done when:

- `sessions/subagents/mcp_server/**` is replaced by
  `domains/sessions/subagents/mcp/**`.
- protocol dispatch uses the shared `integrations/mcp/product_server` kit.
- selection/injection lives under `domains/sessions/mcp_bindings/**`.
- product behavior lives in subagents domain service/runtime calls.
- temporary header/signature names are either migrated to the shared product
  MCP token envelope or explicitly documented as compatibility aliases.
