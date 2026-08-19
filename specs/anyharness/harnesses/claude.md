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
- Native `Agent`/`Task` child prose, reasoning, and tools use
  `_meta.anyharness.parentToolCallId`. The adapter keeps the legacy
  `_meta.claudeCode.parentToolUseId` alongside it for compatibility, uses each
  Anthropic message id as stable live/replay identity, and deduplicates
  assembled blocks already delivered as deltas.

The maintained fork is installed directly from the immutable root Git source;
its `prepare` script builds the adapter. This path does not depend on a
published Claude fork package. The registry owns the manually curated Git ref;
the generated catalog locks that ref together with the installed version and
successful probe attestations.

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

Because the public SDK callback is absent, AnyHarness does not advertise
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
`permissions.defaultMode` from Claude settings before creating a session. It
accepts `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`, and
`auto`. `auto` is model-dependent: the adapter advertises it only when the
resolved Claude model reports auto-mode support and clamps a stale `auto`
default back to `default` when the active model does not support it.

Gateway-backed Claude launches set a runtime-owned `CLAUDE_CONFIG_DIR` so
hosted sessions do not inherit unrelated user-global Claude configuration.
Readiness treats a managed package whose installed source metadata does not
match the bundled Git pin as `install_required`, so setup and startup reconcile
can refresh older adapters before launch.

## Process-Local Fork Lifecycle

Claude fork ids are owned by one adapter process until the child has durable
turn history. A new fork child therefore uses one connection for the complete
sequence `initialize -> session/load(parent) -> session/fork(parent)`. Parent
load uses ordinary startup metadata; the private `upToMessageId` anchor is sent
only with `session/fork`. Hydration never prompts and never closes the parent.

The connection installs its fork epoch before transport starts. Parent replay
is quarantined during load. Notifications that race ahead of the fork response
are held in a bounded buffer and released only when the response names that
exact child. Requests are denied until durable child finalization; delayed
parent and unknown traffic remain quarantined after readiness. Claude's legacy
user-input and MCP extension requests resolve with a fixed
cancellation-success shape on fork connections before payload parsing because
they do not provide an accepted protocol-level session scope. Standard scoped
ACP requests may run only for the ready child.

Transport observation is unconditional, but a Claude fork connection is
permanently header-only in both directions, including when full ACP teeing is
enabled. Raw transport parent/child ids, extension method text, response data,
and provider response errors are omitted from transport and startup-failure
diagnostics. Protected input is validated before ACP dispatch, response ids
must match a bounded single-use client request, and malformed or unowned
envelopes terminate with fixed diagnostics. Existing structured session
lifecycle identifiers remain intact.

Durably, the operation and child stay `prepared` through child/link/prefix
creation. The child actor claims `native_call_in_flight` at the wire seam. A
valid result atomically assigns the native id to `sessions` and records
`native_result_known`; `fork_operations.native_child_session_id` remains NULL.
Only the final atomic `sessions.status = idle` + operation `completed`
transition can publish the child ready. Explicit wire errors become `failed`;
disconnects, malformed results, invalid child ids, and ambiguous local errors
become `native_outcome_unknown`. Cold zero-turn recovery fails closed until an
exact-prefix recovery proof exists; it never issues a second fork speculatively.

## Restart Semantics

Pending interactions are live broker state. Durable events and session
summaries can rebuild the visible UI while the process is live, but an
in-flight ACP callback is not recovered across server or adapter restart.
Local testing should restart desktop, AnyHarness, and the adapter together.
