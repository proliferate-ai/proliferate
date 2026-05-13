# AnyHarness Integrations

Status: authoritative for external protocol/vendor mechanics.

## Purpose

`integrations/**` owns how AnyHarness speaks external protocols and vendor
surfaces. It does not own product semantics.

Current and target examples:

```text
integrations/mcp/
  JSON-RPC/MCP helpers, tool result formatting, capability-token helper

integrations/agent_cli/
  Claude/Codex/Gemini/OpenCode/Cursor CLI install/probe/path/version quirks

integrations/acp/
  low-level ACP protocol helpers if they become reusable outside live sessions
```

`integrations/mcp/**` and `integrations/agent_cli/**` are present in the
current code. Reusable ACP protocol helpers have not earned a separate
`integrations/acp/**` folder yet; live ACP execution remains under the
transitional `acp/**` path.

## MCP

Generic MCP code belongs here:

- JSON-RPC request parsing helpers
- `initialize` / `tools/list` response scaffolding
- tool result/error formatting
- shared tool definition helper
- signed workspace/session capability tokens

Product tool behavior does not belong here.
Session MCP launch assembly also does not belong here; that is session-domain
composition because it decides which user and product MCP servers a session
launches with. The current implementation is `sessions/mcp_bindings/**`; the
final topology target is `domains/sessions/mcp_bindings/**`.

Examples:

```text
integrations/mcp can define jsonrpc_tool_result(...)
domains/sessions/mcp_bindings assembles the MCP servers for a session launch
domains/reviews decides what submit_review_result does
domains/cowork decides what create_artifact does
domains/sessions/subagents decides what create_subagent does
```

## Agent CLI

Provider-specific mechanics belong here when they are about talking to or
installing a vendor CLI/process:

- executable path probing
- version probing
- managed install details
- provider-specific command templates
- CLI compatibility checks
- local provider process quirks

Generic agent catalog/readiness meaning belongs in `domains/agents`.

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
```

If integration code needs product decisions, pass those decisions in as data or
callbacks from the owning domain.
