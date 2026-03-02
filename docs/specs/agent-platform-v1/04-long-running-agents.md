# Long-Running Agents

## Goal
Support durable coworkers that wake repeatedly, preserve manager continuity, orchestrate isolated coding children, and remain auditable per wake.

## Product behavior
A long-running coworker should behave like a persistent teammate:
- keep one durable objective
- wake on schedule
- inspect connected sources
- delegate concrete coding work to children
- report progress with inspectable per-wake history

## Runtime model

### A) Manager session (persistent home sandbox)
- Every automation owns one persistent `manager_session`.
- Manager wakes reuse the same paused E2B sandbox whenever possible.
- Continuity includes transcript/thread state, file tree state, and lightweight local memory files.
- On each wake, manager receives a short wake note (elapsed time + reminder objective + new notes).
- When no work remains, manager pauses again.

Manager repo-env default:
- Worker sessions always receive repo runtime env/baseline context for coding tasks.
- Manager sessions receive full repo runtime env only when automation is explicitly repo-bound and local repo context is required by policy.
- Default manager mode is orchestration-first, not full coding runtime.

### B) Automation run (one wake cycle)
- Every wake creates one new `automation_run`.
- `automation_run` points to the same persistent `manager_session`.
- Timeline, actions, and summaries must be attributable per `automation_run`.

### C) Worker sessions (child coding sessions)
- Manager can spawn child `worker_sessions` for concrete tasks.
- Each worker session uses fresh sandbox/runtime and independent branch constraints.
- Worker sessions are task-oriented and disposable.
- Worker sessions never share filesystem state with manager or sibling workers.

### D) Durable fallback summary
Primary continuity is paused sandbox state. Platform must still persist a small durable summary at end of each wake:
- objective state
- open items
- open child sessions
- pending approvals

If manager sandbox resume fails, create replacement manager session from last durable summary and continue.
- Resume failure/replacement MUST be emitted as a durable continuity event visible in session/run timeline.

## Orchestration and concurrency

### Default concurrency
- Manager default max in-flight children: `10`.
- Enforced alongside org-level and coworker-level caps.

### Manager capabilities (required baseline)
- `child.spawn`
- `child.list`
- `child.inspect`
- `child.message`
- `child.cancel`

Source capabilities are added by policy/config (for example `sentry.read`, `linear.write`, `github.read`).

### Delegation rules
When manager creates child session:
- child capabilities must be a strict subset of manager capabilities
- manager cannot escalate run-as identity, credential owner, or approval mode
- manager may only narrow scope, tool access, and repo/task constraints

Delegation is restrictive-only, never expansive.

## Message flow between manager and child

Storage:
- messages are `session_messages` rows
- semantics are queued instruction/events, not free-form side channels

Manager -> child message types:
- directive
- reprioritization
- clarification
- cancel request
- status request

Child -> manager message types:
- status note
- question
- blocked reason
- completion summary

Delivery behavior:
- active child: inject at next safe reasoning checkpoint
- paused/waiting child: queue and inject on resume before next reasoning step
- no mid-command interruption in V1

V1 non-goals:
- no shared terminal control between manager and child
- no arbitrary mid-command interrupt/kill injection
- no shared filesystem between manager and child sandboxes

## Operational UX requirements

- `/sessions` is the operational workspace for manager + child sessions.
- Approval prompts appear inline in session context.
- No separate approval-only operational inbox.

Session row baseline fields:
- title/objective
- branch
- creator
- runtime status
- operator status
- recent activity indicator
- inline approval affordance when waiting

## Runtime and operator status layers

Runtime status:
- `starting`
- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`

Operator status:
- `active`
- `waiting_for_approval`
- `needs_input`
- `ready_for_review`
- `errored`
- `done`

## Implementation file tree (current/planned owners)

```text
apps/worker/src/automation/
  index.ts
  resolve-target.ts
  finalizer.ts
  notifications.ts

apps/trigger-service/src/
  polling/worker.ts
  api/webhooks.ts

packages/services/src/
  automations/service.ts
  runs/service.ts
  sessions/service.ts
  outbox/service.ts
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `automations` | durable coworker identity, objective, defaults | `packages/db/src/schema/automations.ts` |
| `automation_runs` | per-wake execution record and per-wake audit grouping | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `sessions` | manager and worker session runtime linkage/state | `packages/db/src/schema/sessions.ts` |
| `session_capabilities` | session-scoped permissions | `packages/db/src/schema/schema.ts` (target) |
| `session_skills` | session-scoped skill bindings | `packages/db/src/schema/schema.ts` (target) |
| `session_messages` | queued manager/child/user messages | `packages/db/src/schema/schema.ts` (target) |
| `action_invocations` | side-effect and approval audit | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `trigger_events` | durable tick/event ingest history | `packages/db/src/schema/triggers.ts` |
| `outbox` | follow-up notifications and durable dispatch | `packages/db/src/schema/schema.ts` (`outbox`) |

## Definition of done checklist
- [ ] Persistent manager session resumes across wakes in steady state
- [ ] Every wake creates `automation_run` linked to same manager session
- [ ] Manager can spawn, inspect, message, and cancel child sessions
- [ ] Child sessions are isolated and disposable with no shared filesystem
- [ ] Per-wake durable summary exists for manager failure fallback
- [ ] Runtime and operator status layers are visible in sessions workspace
- [ ] Manager repo-env default policy is explicit (orchestration-first baseline)
- [ ] Resume failure continuity events are emitted for manager rehydration paths
