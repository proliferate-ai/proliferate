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
- Runs as an isolated \"lean\" sandbox agent (not inside control-plane Node.js process)
- Durable identity and objective
- Reads inbox (chat, webhook, cron wake) via gateway tools
- Decides what to do next
- Spawns child runs for concrete work

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

## Wake model
Use hybrid wake strategy:
- Webhooks for interactive/near-real-time events (GitHub mentions, Slack)
- Cron polling for periodic batch checks (for example Sentry triage sweep)

Internally both become inbox events.

## Idle/suspend behavior
When agent has no immediate work:
- Persist current state and summary
- Pause sandbox (E2B) or stop safely
- Resume on next wake event

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
