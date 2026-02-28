# Long-Running Agents

## Goal
Support persistent agents that keep working over time, can spawn child coding runs, survive restarts, and remain inspectable by humans.

## Product behavior
A long-running agent should feel like a teammate that owns a job.

Example:
- "Sentry Auto-Fixer" runs all day
- It checks new issues, spawns child coding runs, and reports results
- User can ask "what got fixed?" and get concrete links

## Runtime model

### A) Manager agent (supervisor role)
- Runs as an isolated "lean" sandbox agent (not inside control-plane Node.js process)
- Durable identity and objective
- Reads grouped inbox summaries (chat, webhook, cron wake) via gateway tools
- Decides what to do next
- Spawns child runs for concrete work

Efficiency constraints:
- Manager sessions should be burst-oriented and short-lived (triage/decide/dispatch, then exit).
- Do not keep lean manager sandboxes idling for long periods when no work remains.
- Deterministic pre-processing (dedupe/grouping/routing prep) may run in trigger-service/worker before manager boot.

### B) Child runs
- Isolated coding sessions
- One task per run
- Produce reviewable outputs (PR, logs, summary)

### C) Durable state in DB
Persist:
- Agent status and intent
- Run graph (parent/child links)
- Progress summaries
- Approvals and action results
- Source cursors/checkpoints (for polling sources)

Do not rely on in-memory gateway state for long-running correctness.

### D) Control plane backend responsibilities (no LLM loop)
- Route events to inbox
- Orchestrate session/run lifecycle
- Enforce policy/approvals
- Persist and broadcast runtime state

The control plane does not run open-ended LLM planning logic directly.

Lease/locking requirement:
- Only one manager harness instance may be active per coworker at a time.
- Claim must use durable lock/lease semantics to prevent duplicate orchestration loops.
- Trigger wake events must be coalesced to avoid duplicate manager boots.

## Implementation file tree (current and planned owners)

```text
apps/worker/src/automation/
  index.ts                  # run execution orchestration
  resolve-target.ts         # target repo/config resolution
  finalizer.ts              # completion + side effects
  notifications.ts          # run status notifications

apps/trigger-service/src/
  api/webhooks.ts           # webhook ingestion
  polling/worker.ts         # cron polling ingestion

packages/services/src/
  automations/service.ts    # coworker definitions and config
  runs/service.ts           # run lifecycle + transitions
  sessions/service.ts       # session lifecycle linkage
  outbox/service.ts         # durable async dispatch
```

## Core data models for long-running behavior

| Model | Purpose | File |
|---|---|---|
| `automations` | Coworker identity, instructions, enabled state, notification destination | `packages/db/src/schema/automations.ts` |
| `triggers` | What wakes the coworker and with which provider/cadence | `packages/db/src/schema/triggers.ts` |
| `trigger_events` | Durable queue/history of incoming wake events | `packages/db/src/schema/triggers.ts` |
| `automation_runs` | Per-wake execution record and status transitions | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `sessions` | Child coding session runtime and sandbox linkage | `packages/db/src/schema/sessions.ts` |
| `outbox` | Follow-up dispatch for notifications/side effects | `packages/db/src/schema/schema.ts` (`outbox`) |

## Wake model
Use hybrid wake strategy:
- Webhooks for interactive/near-real-time events (GitHub mentions, Slack)
- Cron polling for periodic batch checks (for example Sentry triage sweep)

Internally both become inbox events.

## Query-from-anywhere contract
Users should be able to ask coworkers for status from web (primary) and Slack/GitHub (secondary).

Required behavior:
- A status query resolves from durable run/session rows first.
- If manager agent is currently running, include live addendum from current context.
- Response always includes concrete links (run details, PRs, approvals).

## Idle/suspend behavior
When agent has no immediate work:
- Persist current state and summary
- Pause sandbox (E2B) or stop safely
- Resume on next wake event

Default idle timeout:
- `10m` for both normal idle periods and approval-wait idle periods.

Cost guardrail:
- Prefer stopping completed/idle manager sessions rather than hibernating them.
- Reserve pause/hibernate primarily for worker coding sessions with expensive warm state.

## User controls
Required controls:
- Pause agent
- Resume agent
- Cancel current child run
- Reprioritize objective (chat command)
- See current status and recent outcomes

## Safety controls
- Concurrency cap per agent and per org
- Retry limits and backoff
- Idempotency on side effects
- Budget/time limits per run

## Practical V1 constraints
- Keep one clear parent/child model (avoid deep recursive fanout)
- Keep child run objective small and explicit
- Prefer deterministic run completion criteria (tests pass, PR created)

## Definition of done checklist
- [ ] Persistent agent can wake repeatedly from inbox events
- [ ] Agent can spawn and track child runs
- [ ] Parent/child statuses are visible in UI
- [ ] Agent survives process restart without losing control state
- [ ] Pause/resume behavior is stable for day-scale workflows
- [ ] Manager/supervisor cognition runs in isolated sandbox, not control-plane process
- [ ] Status queries are available from dashboard and at least one external channel (Slack/GitHub)
