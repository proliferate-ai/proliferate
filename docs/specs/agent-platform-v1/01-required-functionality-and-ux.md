# Required Functionality End to End (Including UX)

## Goal
Ship a V1 coworker platform where durable manager agents orchestrate isolated coding workers with clear permission boundaries and session-centric approvals.

## Product bar (plain language)
Users should feel:
- "This coworker keeps context over time and does real work."
- "I can inspect and control all sessions from one operational workspace."
- "Permissions are clear; hidden-deny behavior avoids agent confusion."
- "Coding runs are transparent and auditable."

## Must-have workflows

### A) Onboarding to runnable repo baseline
1. Connect GitHub repo.
2. Choose monorepo target(s).
3. Provide/select env bundle.
4. Run setup session to validate baseline commands.
5. Save baseline and mark repo ready.

Acceptance:
- setup is deterministic and understandable
- baseline includes install/run/test commands + default target + env refs
- future sessions can launch from baseline without redoing setup

### B) Create a durable coworker
1. User creates automation objective and source bindings.
2. System creates one persistent manager session for that automation.
3. Tick wake creates `automation_run` and resumes same manager session.
4. Manager triages and reports status or delegates worker sessions.

Acceptance:
- manager continuity preserves history + filesystem between wakes
- each wake remains independently inspectable via `automation_run`
- manager can pause/resume cleanly without losing durable identity

### C) Manager orchestration
Manager can:
- do nothing/summarize
- spawn child worker sessions
- inspect/list existing children
- reprioritize/message children
- request external actions via gateway

Acceptance:
- manager default child concurrency is `10`, bounded by org/coworker caps
- delegation is restrictive-only (subset capabilities, no identity/policy escalation)
- manager does not directly perform coding execution in V1 baseline

### D) Child coding session flow
Child session gets:
- one explicit task
- repo baseline + branch policy
- env bundle refs
- subset of allowed capabilities

Child returns:
- summary
- changed files/diff
- test results
- PR metadata/artifacts (where allowed)

Acceptance:
- child sessions are isolated/disposable
- no filesystem sharing with manager or sibling children
- all side effects remain session-auditable

### E) Session-centric approvals
1. Session requests side-effect action.
2. Gateway validates capability + approval mode + live security state.
3. If approval required, session moves to waiting state.
4. Approval appears in `/sessions` row/detail context.
5. Approver approves/denies; worker resumes same session when possible.

Acceptance:
- approval UX is session-context-first, not inbox-only
- durable reconciliation works without active websocket
- continuation fallback allowed if same-session resume fails

### F) Session messaging
Message semantics:
- queued `session_messages` instructions/events
- manager->child: directive/reprioritization/status/cancel
- child->manager: status/question/blocked/completion

Delivery:
- inject at next safe reasoning checkpoint
- never mid-command/tool call
- queued while paused/waiting and injected at resume

## Core IA defaults

- `/sessions` is the operational center for manager sessions, child sessions, and ad-hoc sessions user can access.
- No separate approval-only workspace.
- Notifications route users into filtered `/sessions` views.

Session row baseline fields:
- title/objective
- branch
- creator
- runtime status
- operator status
- recent activity
- inline approval prompt when waiting

## Data model requirements

Durable minimum:
- `automation`
- `manager_session` (one per automation)
- `automation_run` (one per wake)
- `worker_session`
- `session_capabilities`
- `session_skills`
- `session_messages`
- `action_invocation`
- trigger/tick event rows
- notification/outbox rows

Key relationships:
- `automation -> manager_session`
- `automation -> automation_runs`
- `automation_run -> manager_session`
- `automation_run -> worker_sessions`
- `session -> session_capabilities/session_skills/session_messages/action_invocations`

Authorization baseline:
- denied actions are hidden from agent tool list
- visible modes are `allow` and `require_approval`
- live revocations still override fixed session bindings

## Status and visibility requirements

Runtime status:
- `starting`, `running`, `paused`, `completed`, `failed`, `cancelled`

Operator status:
- `active`, `waiting_for_approval`, `needs_input`, `ready_for_review`, `errored`, `done`

Visibility modes:
- `private`, `shared`, `org`

Defaults:
- ad-hoc sessions default `private`
- org coworker manager sessions default `org`
- child sessions spawned by org-visible coworker default `org`
- sessions inherit visibility from creating context unless explicitly narrowed

## Implementation file references

- `apps/web/src/server/routers/automations.ts`
- `apps/web/src/server/routers/sessions.ts`
- `apps/worker/src/automation/index.ts`
- `apps/gateway/src/hub/session-runtime.ts`
- `apps/gateway/src/api/proliferate/http/actions.ts`
- `packages/services/src/automations/service.ts`
- `packages/services/src/runs/service.ts`
- `packages/services/src/sessions/service.ts`
- `packages/services/src/actions/service.ts`

## Definition of done checklist
- [ ] Persistent manager session + per-wake run semantics are documented and implemented
- [ ] Child session isolation and restrictive delegation rules are explicit
- [ ] Session capability/skill/message tables are first-class in model docs
- [ ] Session-centric approvals and resume behavior are explicit
- [ ] `/sessions` operational workspace and status layers are consistent across specs
- [ ] Visibility inheritance and narrowing rules are explicit in UX and runtime docs
