# Entity Ontology and Lifecycle

## Goal
Define one unambiguous runtime model for durable coworkers, wake cycles, child coding sessions, and side-effect audit.

## Status
- Applies to: V1
- Normative: Yes

## Canonical entities

1. `automation`
- Durable coworker identity.
- Stores objective, source bindings, default visibility, default capability policy, and default skill set.

2. `manager_session`
- One persistent home session for the coworker.
- Reuses the same paused E2B sandbox across wakes whenever possible.
- Preserves transcript continuity, filesystem state, and lightweight local memory files.

3. `automation_run`
- One wake cycle.
- Created on every scheduler tick/resume.
- Always links to the same `manager_session`.

4. `worker_session`
- One task-specific child coding session.
- Runs in a fresh isolated sandbox.
- Uses separate runtime + branch policy from manager and sibling workers.

5. `action_invocation`
- One side-effect attempt with audit lifecycle.
- Always session-scoped.
- Manager-side invocations must also record active `automation_run_id` because manager session spans many wakes.

6. `session_capabilities`
- Session-scoped permission/resource bindings.
- Defines what a session can read, invoke, and mutate.

7. `session_skills`
- Session-scoped skill attachments with explicit version pinning.
- Shapes behavior only; does not grant permissions.

8. `session_messages`
- Session-scoped queued instructions/events for user->session, manager->child, and child->manager communication.

## Relationship model (required)

```text
automation (1) -> (1) manager_session
automation (1) -> (N) automation_runs
automation_run (N) -> (1) manager_session
automation_run (1) -> (N) worker_sessions

session (1) -> (N) session_capabilities
session (1) -> (N) session_skills
session (1) -> (N) session_messages
session (1) -> (N) action_invocations
```

Ad-hoc interactive session:
- no automation linkage required
- still uses session-scoped capabilities/skills/messages/action_invocations

Managed automation execution:
- exactly one durable `manager_session` per `automation`
- many `automation_runs` over time
- many `worker_sessions` across runs

## Lifecycle chain (required)

1. `automation` exists with objective, policies, and source bindings.
2. Worker claims wake lease and creates one `automation_run`.
3. Worker resumes the persistent `manager_session` for that automation.
4. Manager inspects sources/tools, decides to do nothing, summarize, request actions, or orchestrate children.
5. Manager may create one or more `worker_sessions` for concrete coding tasks.
6. Sessions emit `action_invocations` and `session_messages` as work proceeds.
7. Manager persists wake summary and pauses again.

## Durable continuity model

Steady state:
- Same manager sandbox is resumed each wake.
- Same history and file tree continue.

Failure fallback:
- If paused sandbox cannot be resumed, create a replacement manager session from last durable wake summary.
- Durable summary must include:
	- objective state
	- open items
	- open child sessions
	- pending approvals
- Replacement bootstrap MUST emit a durable continuity event linked to both `automation_id` and new `automation_run_id` so operators can see that manager home state was rehydrated.

## Transcript growth and compaction policy (required)

- Manager transcript continuity is user-visible and must appear continuous across wakes.
- Platform MUST compact long manager history to bounded context by writing durable summary artifacts/checkpoints.
- Compaction MUST preserve:
	- unresolved tasks
	- pending approvals
	- active child session references
	- key recent decisions and rationale
- Compaction MAY discard raw historical message detail once represented in durable summary artifacts.
- On wake, manager prompt/context MUST include latest compacted summary plus recent un-compacted turns.

## Manager and worker boundaries

Manager role:
- orchestrates, triages, inspects, delegates, summarizes
- may message/reprioritize existing children
- may request actions through gateway policy path

Worker role:
- performs concrete coding task execution
- runs tests/commands
- creates commits/PRs where capability allows

V1 default:
- manager does not directly perform coding task execution

## Status model (required)

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

## Visibility model (required)

Modes:
- `private`
- `shared`
- `org`

Defaults:
- ad-hoc sessions default to `private`
- org-wide coworker manager sessions default to `org`
- child sessions spawned by org-visible coworkers default to `org`

Inheritance rule:
- New sessions inherit visibility from creating context unless explicitly narrowed by policy or creator.
- Visibility escalation beyond creator-visible scope is forbidden.

## Glossary rule
- Use canonical terms in all normative sections.
- Avoid bare `run` when `automation_run` or `worker_session` is intended.

## Definition of done checklist
- [ ] Canonical entities and relationships are applied across all V1 specs
- [ ] Session-scoped capabilities/skills/messages are explicit in runtime and tool contracts
- [ ] Manager persistent-session semantics and failure fallback are documented
- [ ] Manager-side action audits are linked to both `session_id` and active `automation_run_id`
- [ ] Runtime and operator status layers are used consistently in UX and API docs
