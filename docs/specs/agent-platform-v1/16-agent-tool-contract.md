# Agent Tool Contract

## Goal
Define one canonical in-sandbox interface for capability-constrained tool discovery, invocation, approval handling, and manager/child orchestration.

## Scope
In scope:
- capability-to-tool mapping
- tool listing behavior for allowed/approval-only actions
- invocation envelopes
- approval and reconciliation path
- manager-child orchestration tool surface
- skills vs capabilities vs tools vs actions boundary

Out of scope:
- provider-specific business semantics for every connector action
- frontend component design details

## Canonical interface

Every sandbox gets Proliferate CLI as the canonical agent-facing interface for:
- source querying
- child-session orchestration
- action invocation
- session inspection/status reporting
- session skill/capability introspection
- repo baseline recipe management for onboarding/setup sessions
- service/log/port inspection for active session runtime

Default runtime access model:
- source reads/writes: gateway-backed CLI paths
- child orchestration: CLI paths
- git operations: sandbox-native with short-lived repo-scoped auth

CLI contract requirement:
- Harnesses (OpenCode, Claude Code, Codex, and future agents) MUST consume the same CLI contract semantics.
- Provider/harness-specific tool injection MAY exist as adapter glue but MUST NOT be the source-of-truth policy surface.

## Terminology boundary (required)

### Skills
- Reusable behavior packs (instructions, patterns, examples, workflows).
- Versioned and attachable to automations/sessions.
- Do not grant permissions.

### Capabilities
- Session-scoped permissions/resources.
- Examples: `sentry.read`, `linear.write`, `child.spawn`, `github.pr.create`, `repo.git.push`.

### Tools
- Agent-facing CLI interfaces that consume capabilities.

### Actions
- Auditable side effects executed through gateway policy/audit path.

Key rule:
- skills shape behavior
- capabilities define permission

## Tool listing and visibility rules

Listing behavior:
- CLI/tool list must show only what the current session can use.
- Denied actions/capabilities do not appear.
- Agent-facing modes are effectively:
	- `allow`
	- `require_approval`

Execution-time rule:
- live revocations/disabled integrations/credential invalidation still override listed tool availability at invocation time.

## Session capability binding contract

Tool availability is resolved from immutable `session_capabilities`.

At session creation:
1. Resolve capability bindings.
2. Build normalized tool manifest from allowed/approval-bound capabilities.
3. Freeze manifest for that session execution.

No mid-session expansive refresh:
- Live config changes apply to new sessions.
- Existing session remains bound to its immutable capability envelope.

Skill change rule:
- Mid-session skill edits MUST NOT hot-inject into an in-progress reasoning step.
- For persistent manager sessions, changed skill attachments apply on next wake.
- For worker sessions, changed skill attachments apply only to newly created worker sessions.

## Manager orchestration tool surface

Managers must have orchestration capabilities in baseline policy:
- `child.spawn`
- `child.list`
- `child.inspect`
- `child.message`
- `child.cancel`

Delegation constraints when spawning child:
- child capability set is strict subset of manager capability set
- no escalation of run-as identity
- no escalation of credential owner policy
- no escalation of approval mode

## Session message transport contract

Messages are `session_messages` rows and represent queued instructions/events.

Delivery semantics:
- running session: inject at next safe reasoning checkpoint
- paused/waiting session: inject before next reasoning step on resume
- no shared terminal control or mid-command interruption in V1

## Invocation request contract (agent -> gateway)

```json
{
  "sessionId": "sess_x",
  "toolId": "linear.update_issue",
  "input": {},
  "idempotencyKey": "sess_x:linear.update_issue:abc123"
}
```

Rules:
- `toolId` must be visible in current frozen manifest
- idempotency key required for side effects
- gateway validates input shape, capability binding, credential policy, and live revocation state

## Invocation response contract (gateway -> agent)

```json
{
  "status": "success | failed | pending_approval",
  "invocationId": "inv_x",
  "result": {},
  "error": {
    "code": "POLICY_DENIED",
    "message": "Action denied by org policy",
    "retryable": false,
    "details": {}
  }
}
```

Rules:
- `success`: include normalized result payload
- `failed`: include structured error payload
- `pending_approval`: include invocation id + approval context summary

## Approval and reconciliation contract

When `pending_approval`:
1. Session enters waiting state and yields normally.
2. Approval prompt appears in session context (`/sessions` row/detail).
3. Reconciliation pulls final state before next reasoning step.

Final-outcome rule:
- Resume intent should trigger only on terminal invocation outcomes:
	- completed
	- failed
	- denied
	- expired

Source of truth:
- durable DB state (invocations + resume orchestration), not websocket presence.

## Read vs write audit boundary (required)

- Write/destructive side effects MUST create `action_invocations` rows.
- Read/query-only tool calls SHOULD NOT create `action_invocations` by default.
- Read/query activity SHOULD be recorded in `session_tool_calls` and/or session timeline events for debug traceability.
- If a tool can both read and write, only write path executions create `action_invocation` rows.

## Implementation file anchors

```text
apps/gateway/src/api/proliferate/http/
  tools.ts
  actions.ts

apps/gateway/src/hub/
  session-hub.ts
  session-runtime.ts

packages/shared/src/opencode-tools/
  index.ts

packages/services/src/actions/
  service.ts
  db.ts
  connectors/

packages/services/src/sessions/
  service.ts
```

## Core data models

| Model | Contract relevance | File |
|---|---|---|
| `sessions` | session core linkage and runtime state | `packages/db/src/schema/sessions.ts` |
| `session_capabilities` | capability bindings and approval mode hints | `packages/db/src/schema/schema.ts` (target) |
| `session_skills` | skill attachments/version pinning | `packages/db/src/schema/schema.ts` (target) |
| `session_messages` | manager/child/user queued instructions | `packages/db/src/schema/schema.ts` (target) |
| `automation_runs` | per-wake manager context for managed sessions | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `action_invocations` | approval and side-effect lifecycle | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `outbox` | approval-required notifications and follow-up dispatch | `packages/db/src/schema/schema.ts` (`outbox`) |

## Definition of done checklist
- [ ] Proliferate CLI is documented as canonical in-sandbox tool interface
- [ ] Denied actions are hidden from agent-visible tool listings
- [ ] Invocation envelope uses `success|failed|pending_approval` states
- [ ] Manager orchestration capabilities and restrictive delegation rules are explicit
- [ ] Session message delivery rules are explicit and checkpoint-safe
- [ ] Runtime checks enforce live revocation overrides
- [ ] Read/query vs write side-effect audit boundary is explicit and enforced
- [ ] Mid-session skill change application timing is explicit
