# Claude Harness

Claude sessions are launched through the managed
`proliferate-ai/claude-agent-acp` adapter unless a workspace or environment
override supplies a local adapter executable.

## Supported Surfaces

- ACP `request_permission` is normalized into AnyHarness `permission`
  interactions.
- MCP elicitation is bridged through the Claude extension method
  `experimental/claude/mcpElicitation` when the adapter advertises support.
- Claude status, hook, task, and retry messages should map into existing
  transcript surfaces: transient thought status for short-lived progress and
  synthetic hook tool calls for hook lifecycle events.
- Assistant prose completion uses the AnyHarness
  `assistant_message_completed` marker so the event sink can close the open
  assistant transcript item.
- Transient progress uses the AnyHarness `transient_status` marker and is
  converted at the ACP boundary into typed normalized state.

## Extension Capabilities

AnyHarness advertises Claude extension support under `ClientCapabilities._meta`:

```json
{
  "claude": {
    "mcpElicitation": true
  }
}
```

The runtime side has a Claude-shaped user-input extension handler, but
AnyHarness does not advertise `requestUserInput` until the adapter can answer
`AskUserQuestion` through a public SDK callback. The adapter must only call a
method when the client capability is present. Unsupported or method-not-found
extension calls must resolve the Claude turn safely instead of leaving the SDK
blocked.

## AskUserQuestion Limitation

The current Claude SDK exposes `AskUserQuestion` input/output types, but the
blocking runtime path is delivered through the SDK's internal
`request_user_dialog` control request and does not currently expose a public
callback for the ACP adapter to answer.

Until that SDK callback exists, AnyHarness does not advertise
`claude.requestUserInput` and the adapter keeps `AskUserQuestion` disallowed.
This prevents an unsupported control request from failing the turn mid-stream.

## Permission Context

Claude permission requests may include display-safe context at
`RequestPermissionRequest._meta.claudeCode.permissionContext`.

Allowed fields are:

- `displayName`
- `blockedPath`
- `decisionReason`
- `agentId`

These fields are normalized into typed permission context in the AnyHarness
contract. Stable UI behavior must use the typed contract fields, not raw ACP
metadata or raw tool input/output blobs.

## Permission Mode Launch Guard

The managed `claude-agent-acp` adapter validates
`permissions.defaultMode` from Claude settings before creating a session. The
current managed adapter accepts `default`, `acceptEdits`, `plan`, `dontAsk`,
and `bypassPermissions`; it does not accept `auto`.

AnyHarness must not advertise `auto` as a Claude create-session mode until the
managed adapter supports it. Gateway-backed Claude launches set a
runtime-owned `CLAUDE_CONFIG_DIR` so hosted sessions do not inherit a user's
global Claude settings default that the adapter cannot start with.

Older user-owned managed Claude adapters can predate adapter support for
`auto`. Readiness treats a managed npm package whose installed metadata does
not match the bundled package spec as `install_required`, so the visible setup
flow and startup reconcile can refresh the adapter. If an adapter still reaches
session creation and fails on `permissions.defaultMode: auto`, the start error
must include a repair hint to update/reinstall Claude setup or change the
unsupported global Claude setting.

## Restart Semantics

Pending interactions are live broker state. Durable events and session
summaries can rebuild the visible UI while the process is live, but an
in-flight ACP callback is not recovered across server or adapter restart.
Local testing should restart desktop, AnyHarness, and the adapter together.
