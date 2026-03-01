# Source: README.md

# Agent Platform V1 Specs (E2B-Only Compute)

## Why this folder exists
These docs define a concrete, plain-language V1 implementation plan for Proliferate.

This folder is intentionally practical:
- What users can do end to end
- What we are building now (E2B-only compute in V1)
- Where code should live in this repo
- What "done" means for each subsystem
- Which files and DB models each subsystem owns

## V1 product shape
V1 has two main experiences:
1. **Interactive coding runs**: user asks agent to fix/build something now
2. **Persistent background agents**: agent keeps watching a job (for example Sentry), spawns worker runs, and reports progress

Primary IA defaults for V1:
- `/sessions` is the central operational workspace for all org-visible sessions and approval handling.
- `/agents` is supervisor-level state (objective, cadence, timeline, spawned sessions).
- Notifications route users into filtered session views; approval UX is session-centric.

## Out of scope for this spec pack
- Building a custom proprietary compute orchestrator
- Non-engineering workflows (email support automation, generic business agents)
- Deep visual no-code workflow builder

## File tree (this spec pack)
```text
/docs/specs/agent-platform-v1/
  README.md
  00-system-file-tree.md
  01-required-functionality-and-ux.md
  02-e2b-interface-and-usage.md
  03-action-registry-and-org-usage.md
  04-long-running-agents.md
  05-trigger-services.md
  06-gateway-functionality.md
  07-cloud-billing.md
  08-coding-agent-harnesses.md
  09-notifications.md
  10-layering-and-mapping-rules.md
  11-streaming-preview-transport-v2.md
  12-reference-index-files-and-models.md
  13-self-hosting-and-updates.md
  14-boot-snapshot-contract.md
  15-llm-proxy-architecture.md
  16-agent-tool-contract.md
  17-entity-ontology-and-lifecycle.md
  18-repo-onboarding-and-configuration-lifecycle.md
  19-artifacts-and-retention.md
  20-code-quality-contract.md
```

## Spec reading order
1. [17-entity-ontology-and-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/17-entity-ontology-and-lifecycle.md)
2. [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)
3. [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)
4. [18-repo-onboarding-and-configuration-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/18-repo-onboarding-and-configuration-lifecycle.md)
5. [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)
6. [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)
7. [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)
8. [16-agent-tool-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)
9. [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)
10. [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)
11. [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)
12. [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)
13. [19-artifacts-and-retention.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/19-artifacts-and-retention.md)
14. [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)
15. [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)
16. [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)
17. [12-reference-index-files-and-models.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/12-reference-index-files-and-models.md)
18. [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)
19. [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)
20. [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)
21. [20-code-quality-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/20-code-quality-contract.md)

## Source references in current repo
These docs align with existing architecture and code:
- [sessions-gateway.md](/Users/pablo/proliferate/docs/specs/sessions-gateway.md)
- [sandbox-providers.md](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)
- [actions.md](/Users/pablo/proliferate/docs/specs/actions.md)
- [triggers.md](/Users/pablo/proliferate/docs/specs/triggers.md)
- [billing-metering.md](/Users/pablo/proliferate/docs/specs/billing-metering.md)
- [agent-entity-design.md](/Users/pablo/proliferate/docs/agent-entity-design.md)

## V1 principles
- Clean-slate rewrite is allowed; no backward-compatibility or user migration constraints
- Gateway is the runtime action bus and policy checkpoint
- E2B is compute provider for V1 only
- DB-first UI for reliability, stream attach for live detail
- No privileged direct provider calls from sandbox
- Sandbox-native git operations use short-lived repo-scoped auth
- PR ownership mode defaults to `sandbox_pr` (future strict mode: `gateway_pr`)
- Integration architecture is brokerless: self-hosted OAuth lifecycle + MCP connectors (no Nango dependency in runtime path)
- Keep harness pluggable (OpenCode default, others possible)
- Manager cognition runs in persistent home sandbox, not control-plane process
- Primary wake path is tick-based outbound polling (no inbound webhook dependency required for core operation)
- Trigger-service remains a separate runtime from main API (ingestion/scheduling isolation)
- Session identity supports ad-hoc + managed flows: ad-hoc sessions can have no coworker link; managed runs bind to coworker identity
- One automation owns one persistent `manager_session`; each wake creates `automation_run` linked to that manager session
- Runtime authorization executes from immutable session core fields + `session_capabilities`; live security revocations still override at execution time
- Session behavior packs (`session_skills`) are separate from permissions (`session_capabilities`)
- Inter-session instructions are durable `session_messages` injected at safe reasoning checkpoints
- Agent tool discovery/invocation uses one frozen manifest and one structured response envelope (`success|failed|pending_approval`)
- Canonical runtime chain is `automation -> automation_run -> session -> action_invocation`
- Approval-triggered resume orchestration is worker-owned and durable (gateway push is best-effort only)
- Approval review surfaces are session-centric; notification inbox is a delivery primitive, not the primary approval workspace
- Manager-to-child delegation is restrictive-only (subset capabilities, no run-as/credential escalation)
- Repo onboarding is baseline-driven for monorepos (remove `configuration*` as primary contract)
- Default idle timeout is `10m` (normal idle + approval-wait idle)
- Control plane deployment support includes cloud, Docker self-host, and Kubernetes self-host
- Sandbox compute remains E2B-only in V1 (all deployment modes require E2B)
- Every subsystem spec should include implementation file tree + core data model section

---

# Source: 17-entity-ontology-and-lifecycle.md

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

---

# Source: 00-system-file-tree.md

# System File Tree (V1)

This is the practical code map for the V1 agent platform.

## Top-level runtime systems
```text
/apps
  /web                 # Product UI + oRPC routes (metadata CRUD)
  /gateway             # Real-time runtime bus + action execution boundary
  /llm-proxy           # LiteLLM proxy service (virtual keys + provider routing)
  /worker              # Background jobs and orchestration
  /trigger-service     # Tick scheduler + source ingestion

/packages
  /db                  # Schema and migrations
  /services            # Business logic + DB operations
  /shared              # Contracts, sandbox provider impls, opencode tooling
  /triggers            # Trigger provider registry + adapters
  /queue               # Queue wrappers/locking
  /gateway-clients     # Client libs used by web/worker

/charts
  /proliferate         # Self-host deployment chart

/infra
  /pulumi-k8s          # AWS EKS deployment IaC
  /pulumi-k8s-gcp      # GKE deployment IaC
```

## Key folders for each concern

### 1) Product UX and APIs
```text
/apps/web/src/server/routers
  actions.ts
  automations.ts
  onboarding.ts
  integrations.ts
  repos.ts
  sessions.ts
  triggers.ts
```

### 2) Gateway runtime/action bus
```text
/apps/gateway/src
  /api/proliferate/http
    actions.ts
    sessions.ts
    tools.ts
  /hub
    session-hub.ts
    session-runtime.ts
    event-processor.ts
    lifecycle-controller.ts
```

### 3) Trigger ingestion
```text
/apps/trigger-service/src
  /api
    webhooks.ts
    providers.ts
  /webhook-inbox
    worker.ts
  /polling
    worker.ts
```

### 4) Background orchestration
```text
/apps/worker/src/automation
  index.ts
  resolve-target.ts
  notifications.ts
  artifacts.ts
  finalizer.ts
```

### 5) Policies, capabilities, actions, credentials
```text
/packages/services/src
  /onboarding
    service.ts
    db.ts
  /repos
    service.ts
    db.ts
  /automations
    service.ts
  /runs
    service.ts
  /sessions
    service.ts
    sandbox-env.ts
  /actions
    service.ts
    modes.ts
    modes-db.ts
    connectors/
  /integrations
    service.ts
    db.ts
    tokens.ts
```

### 6) Sandbox provider (E2B now)
```text
/packages/shared/src/providers
  e2b.ts
  index.ts

/packages/shared/src/sandbox
  opencode.ts
  config.ts
  git-freshness.ts
```

### 7) Contracts and tool packs
```text
/packages/shared/src/contracts
/packages/shared/src/opencode-tools
  index.ts
```

### 8) Core data model
```text
/packages/db/src/schema
  schema.ts
  automations.ts
  sessions.ts
  integrations.ts
  triggers.ts
  relations.ts
/packages/db/drizzle
  *.sql
```

## Rules for file ownership
- DB read/write logic belongs in `packages/services/src/**/db.ts`
- Gateway should call services, not raw DB SQL
- Web routers are thin wrappers around services/gateway clients
- Trigger-service ingests/enqueues; it does not execute long-running agent cognition inline

## Feature-to-system ownership map

| Product capability | Primary runtime owner | Primary files |
|---|---|---|
| Coworker creation/editing | Web + Services | `apps/web/src/server/routers/automations.ts`, `packages/services/src/automations/service.ts` |
| Repo onboarding baseline | Web + Services | `apps/web/src/server/routers/onboarding.ts`, `apps/web/src/server/routers/repos.ts`, `packages/services/src/onboarding/service.ts`, `packages/services/src/repos/service.ts` |
| Long-running execution | Worker + Services | `apps/worker/src/automation/*`, `packages/services/src/runs/service.ts` |
| Trigger/tick ingestion | Trigger-service | `apps/trigger-service/src/polling/worker.ts`, `apps/trigger-service/src/api/webhooks.ts` |
| Coding sessions + live runtime | Gateway + Providers | `apps/gateway/src/hub/session-runtime.ts`, `packages/shared/src/providers/e2b.ts` |
| Actions/approvals | Gateway + Actions service | `apps/gateway/src/api/proliferate/http/actions.ts`, `packages/services/src/actions/service.ts` |
| Integrations/connectors | Web + Integrations services | `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/connectors/service.ts` |
| Notifications | Worker + Notifications service | `apps/worker/src/automation/notifications.ts`, `packages/services/src/notifications/service.ts` |

## Core data model map

| Table/model | Purpose | Schema file |
|---|---|---|
| `automations` | durable coworker identity/objective/default policy | `packages/db/src/schema/automations.ts` |
| `automation_runs` | one row per wake cycle for manager orchestration | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `sessions` | manager/worker/ad-hoc runtime state + linkage | `packages/db/src/schema/sessions.ts` |
| `session_capabilities` | session-scoped permissions and approval mode bindings | `packages/db/src/schema/schema.ts` (target) |
| `session_skills` | session-scoped skill attachments and versions | `packages/db/src/schema/schema.ts` (target) |
| `session_messages` | queued user/manager/child instructions/events | `packages/db/src/schema/schema.ts` (target) |
| `action_invocations` | side-effect execution + approval audit | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `triggers`, `trigger_events` | tick/event pipeline and source checkpoints | `packages/db/src/schema/triggers.ts` |
| `outbox` | durable async dispatch queue | `packages/db/src/schema/schema.ts` (`outbox`) |
| `integrations`, `repo_connections`, `org_connectors` | OAuth/MCP/source bindings | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |

## Engineering guardrails
- DB-first for list/workspace correctness; stream for live detail only.
- Side-effect tools require idempotency keys.
- Gateway remains the policy/audit boundary for actions.
- Live revocation checks override frozen session capability bindings.

---

# Source: 01-required-functionality-and-ux.md

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

---

# Source: 18-repo-onboarding-and-configuration-lifecycle.md

# Repo Onboarding and Baseline Lifecycle

## Goal
Define a simple monorepo-first onboarding contract that produces reusable repo baselines for future coding sessions.

## Status
- Applies to: V1
- Normative: Yes

## Core decision

V1 removes `configuration`, `configuration_repo`, and `configuration_secret` from the primary onboarding model.

Replace with a repo baseline model:
- one baseline per repo
- optional named monorepo targets within that baseline

## Baseline contract

Baseline stores:
- install/update commands
- run commands
- optional test commands
- default working directory/target
- preview port expectations
- env bundle references
- optional E2B workspace cache snapshot reference

### Baseline recipe structure (required)

Update/install recipe entries MUST support:
- `name`
- `command`
- `workingDirectory`
- `runPolicy` (`always | conditional`)
- optional `conditionalInputs` (for example lockfile/dockerfile/target change triggers)

Run service recipe entries MUST support:
- `serviceName`
- `command`
- `workingDirectory`
- `envMode` (`process_env | env_file | both`)
- `isLongRunning` (boolean)
- optional `expectedPorts`
- optional `healthCheck`
- optional `restartPolicy`

Optional test recipe entries SHOULD support:
- `name`
- `command`
- `workingDirectory`
- `isBlocking` (boolean)

## Core entities

| Entity | Meaning | Primary model/file |
|---|---|---|
| `repo` | Connected source-control repository | `packages/db/src/schema/repos.ts` |
| `repo_baseline` | Runnable baseline metadata and target command set | `packages/db/src/schema/schema.ts` (target) |
| `repo_baseline_target` | Named monorepo targets attached to a baseline | `packages/db/src/schema/schema.ts` (target) |
| `session (setup)` | Onboarding/setup run that validates baseline | `packages/db/src/schema/sessions.ts` (`sessionType = setup`) |
| `session (coding)` | Task-oriented coding run using baseline + task constraints | `packages/db/src/schema/sessions.ts` |

## Implementation file anchors

```text
apps/web/src/server/routers/
  onboarding.ts
  repos.ts
  sessions-create.ts
  sessions-submit-env.ts

packages/services/src/onboarding/
  service.ts
  db.ts

packages/services/src/repos/
  service.ts
  db.ts

packages/services/src/sessions/
  service.ts
  sandbox-env.ts
```

## Lifecycle contract

### 1) First-time onboarding
1. Connect repo.
2. Choose monorepo target(s).
3. Provide/select env bundle.
4. Run onboarding/setup session.
5. Validate install/run/test commands.
6. Persist `repo_baseline` (+ target records where applicable).
7. Mark repo ready.

### 2) Coding session creation
1. User/manager requests coding session for repo + task.
2. Session loads repo baseline.
3. Optional workspace cache snapshot is restored.
4. Session executes mandatory git freshness step.
5. Session runs baseline update/install recipe according to `runPolicy`.
6. Session starts baseline run services under process supervision.
7. Session exposes logs/service status/ports to UI + agent.
8. Session runs requested target/commands under task constraints.

### 3) Refresh/repair path
Trigger conditions:
- onboarding commands no longer work
- dependency/tooling drift
- explicit operator refresh request

Repair flow:
1. Run new onboarding/setup session.
2. Update repo baseline and targets.
3. Future sessions use refreshed baseline.
4. In-flight sessions keep their own immutable session contract.

## Required invariants

- Every coding session links to baseline identity (`repo_baseline_id` target contract).
- Baseline updates apply only to future sessions.
- Env values remain encrypted at rest; sessions carry refs, not plaintext metadata copies.
- Git freshness step always runs before task execution.
- Baseline granularity default is repo-level with named internal targets.
- Missing/stale workspace snapshots MUST fall back to repo-baseline bootstrap (never hard-fail solely due to snapshot loss).
- Correctness source is baseline + git freshness + recipes; workspace snapshot is optimization only.

## UX contract

Onboarding page must show:
- repo connected state
- selected monorepo targets
- baseline validation state
- ready-for-run indicator
- one-click baseline refresh action when stale

Session detail must show:
- baseline used
- target used
- whether cache snapshot was restored
- active services and service health
- service logs and exposed preview ports

## Definition of done checklist

- [ ] Onboarding creates `repo_baseline` instead of `configuration*`
- [ ] Session creation resolves baseline + target deterministically
- [ ] Git freshness step is mandatory in coding session bootstrap
- [ ] Repair flow refreshes baseline without mutating active sessions
- [ ] UX exposes baseline readiness and refresh state from durable DB rows
- [ ] Recipe schema supports `always|conditional` install/update execution policy
- [ ] Service model is first-class (name/cmd/cwd/env/ports/health/restart)

---

# Source: 06-gateway-functionality.md

# Gateway Functionality (Runtime Bus)

## Goal
Make gateway the single runtime execution layer for agent actions and session streaming.

## Product-level role
Gateway is where "work" happens at runtime:
- Accept tool/action requests from running sessions
- Resolve policy and approvals
- Execute integrations server-side
- Persist invocation results
- Push live status to connected viewers

Current code anchors:
- [HTTP actions surface](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts)
- [tools route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)
- [session runtime](/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts)
- [session hub](/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts)
- [event processor](/Users/pablo/proliferate/apps/gateway/src/hub/event-processor.ts)

## Gateway file tree (runtime-critical paths)

```text
apps/gateway/src/
  api/proliferate/http/
    actions.ts                # action invoke/approve/deny + reconcile read endpoint
    sessions.ts               # session lifecycle endpoints used by clients
    tools.ts                  # tool surface and callback handling
  api/proxy/
    devtools.ts               # runtime proxy surfaces
    terminal.ts               # terminal websocket proxy
  hub/
    session-hub.ts            # per-session fanout and client coordination
    session-runtime.ts        # provider runtime ensure/reconnect
    event-processor.ts        # stream normalization + telemetry/compute metering intercept
    backplane.ts              # cross-replica pub/sub fanout bridge
```

## Core data models gateway reads/writes

| Model | Gateway usage | File |
|---|---|---|
| `sessions` | status transitions, runtime metadata (`sandboxId`, tunnel urls, telemetry) | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | side-effect lifecycle and approvals | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` / `org_connectors` | action source resolution and auth lookup context | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |
| `outbox` | downstream async notifications/events after runtime transitions | `packages/db/src/schema/schema.ts` (`outbox`) |

## Required responsibilities

### 1) Session runtime control
- Ensure sandbox runtime is ready
- Maintain stream lifecycle and reconnect behavior
- Expose runtime status to clients
- Enforce immutable session core + capability bindings during runtime and policy checks

### 2) Action invocation boundary
- List available actions
- Invoke action
- Approve/deny invocation
- Emit invocation status updates
- Applies to non-git side effects; sandbox-native git push/PR path follows coding harness contract
- If PR ownership mode is `gateway_pr` (future strict mode), gateway also owns PR creation side effect
- Enforce tool contract envelopes defined in `16-agent-tool-contract.md`

### 3) Policy/identity checkpoint
Before side effects:
- Validate action params
- Resolve mode (`allow`, `require_approval`, `deny`)
- Resolve execution identity/credential owner
- Revalidate delayed invocations after approval and before execution

Approval resume ownership contract:
- Gateway owns live runtime signaling and invocation persistence.
- Worker owns durable approval-triggered resume orchestration via claimed `resume_intent` rows/outbox.
- Gateway push (`sys_event.tool_resume`) is best-effort and never the source-of-truth resume mechanism.
- Resume intent is emitted only for final invocation outcomes tied to waiting origin executions (`completed|failed|denied|expired`).
- Intermediate `approved` does not emit resume intent.

Approval-wait response contract:
- On `require_approval`, gateway persists pending state and returns immediate suspended response (`202` semantic).
- Response payload must be structured as `status=pending_approval` + `invocationId` + summary context.
- Harness writes checkpoint and yields; gateway must not require long-held open request sockets.
- Session may remain running until idle timeout; standard idle pause (`10m`) handles hibernation.
- On approval/deny, gateway emits a deterministic resume event (`sys_event.tool_resume`) with invocation outcome for harness continuation.
- Because paused sandboxes drop connections, harness/daemon must reconcile pending invocation states on reconnect (pull-based sync), not rely only on pushed resume events.
- Pending approval rows auto-expire after `24h`; expiration outcome must be included in reconciliation responses.

Reconciliation read contract:
- Gateway exposes deterministic reconciliation endpoint (see `16-agent-tool-contract.md`):
  - `GET /api/proliferate/http/actions/reconcile?sessionId=:id&after=:cursor`
- Response ordering is stable (`updatedAt`, `invocationId`) and idempotent for repeated reads.
- Harness reconciliation is mandatory before continuing reasoning after reconnect/resume from waiting state.

Resume orchestration contract (worker-owned):
1. Worker claims durable `resume_intent` (unique on `(origin_session_id, invocation_id)`).
2. Worker attempts to resume the same paused origin session first.
3. On transient provider/runtime failures, retry with bounded exponential backoff (default 3 attempts).
4. On permanent failure (for example sandbox missing) or exhausted retries, create one continuation session and inject reconciliation outcome.
5. If continuation bootstrap fails, mark `resume_failed` durably and emit notifications.

Resume timeout contract:
- No separate expiry for resume intents in V1.
- Resume orchestration terminates in `satisfied`, `continued`, or `resume_failed`, bounded by run/session deadline policy.

### 4) Durable persistence
- Persist invocation rows and status transitions
- Persist tool/action outputs needed for audit and UI replay

### 5) Live fanout
- Broadcast runtime and invocation updates over websocket
- Allow multi-viewer visibility for same session

Horizontal scale contract:
- Split runtime traffic into:
  - Control stream: low-volume lifecycle/invocation events (approval state, status changes, coordination).
  - Data stream: high-volume PTY/FS/runtime byte streams.
- Use shared backplane (Redis Pub/Sub or equivalent) for control stream only.
- Do not publish raw PTY/FS high-throughput frames to Redis backplane by default.
- Each session has an owner gateway replica for daemon data-plane connection.
- Browser stream attachment must route to owner gateway (consistent hash, owner lookup + redirect/proxy, or equivalent).
- Sticky sessions may be used as optimization but are not sufficient as sole correctness mechanism.
- On owner failover, new owner reattaches runtime and resumes using replay/reconciliation semantics.

### 6) Metering and telemetry intercept
- Parse runtime `agent_event` frames for observability and realtime UX telemetry
- Persist deterministic compute lifecycle cut points (`start`, `pause`, `resume`, `end`) for billing
- Do not create billable LLM token events from stream frames
- LLM token billing truth comes from LiteLLM spend ingestion (`15-llm-proxy-architecture.md`)

## DB-first + stream-attach UX split

### Org and inbox pages
- Read durable tables first
- No streaming dependency for basic visibility

### Session detail page
- Load persisted state first
- Attach websocket stream for live detail

This prevents dashboards from breaking when streams reconnect.

Streaming contracts for terminal/code/preview transport are detailed in:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)
- [canonical streaming spec](/Users/pablo/proliferate/docs/specs/streaming-preview.md)
- [16-agent-tool-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)

## Failure behavior
Gateway must be explicit about:
- Disconnected runtime
- Invocation pending approval
- Invocation denied
- Provider/integration execution error
- Suspended-waiting-for-approval status with deterministic resume path
- Reconnect reconciliation failures (for pending invocation/status pull)
- Resume orchestration state transitions (`resume_queued`, `resuming`, `continued`, `resume_failed`) from durable DB state

Each must have clear status and retry path.

## Non-goals (V1)
- Turn gateway into main CRUD API surface
- Embed business policy in frontend code
- Direct sandbox-to-external integration calls

## Definition of done checklist
- [ ] Gateway is the only runtime action bus
- [ ] Side effects require policy resolution before execution
- [ ] Invocation rows persist all status transitions
- [ ] Websocket broadcasts include pending/completed/failed states
- [ ] DB-first org dashboard + live session detail split is implemented
- [ ] Gateway evaluates runtime permissions against immutable session contract
- [ ] Post-approval revalidation is enforced before executing pending actions
- [ ] Gateway route handlers remain transport-only and do not import Drizzle models directly
- [ ] Gateway stream telemetry does not directly write billable LLM token events

---

# Source: 02-e2b-interface-and-usage.md

# E2B Interface and Usage Pattern (V1)

## Goal
Use E2B as the only execution provider in V1, while keeping code structured so we can add Docker/K8s later without rewriting control-plane logic.

V1 support boundary:
- Managed cloud and self-hosted control plane are both supported.
- Sandbox execution provider remains E2B in all modes for V1.

## Hard boundary
- Control plane decides **when** to run
- E2B provider decides **how** to start/stop/exec in sandbox
- Business logic must not call E2B SDK directly outside provider layer

Primary code path today:
- [e2b.ts](/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts)
- [providers/index.ts](/Users/pablo/proliferate/packages/shared/src/providers/index.ts)
- [gateway session runtime](/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts)
- [gateway session hub](/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts)
- [snapshot resolution helper](/Users/pablo/proliferate/packages/shared/src/snapshot-resolution.ts)

## File tree for provider boundary

```text
packages/shared/src/providers/
  e2b.ts                    # E2B implementation
  modal-libmodal.ts         # existing alt provider reference
  index.ts                  # provider factory/selection

apps/gateway/src/hub/
  session-runtime.ts        # asks provider to ensure sandbox, tracks readiness
  session-hub.ts            # stream lifecycle, reconnect, runtime fanout

packages/services/src/sessions/
  db.ts                     # durable session metadata updates (sandbox ids, status)
```

## Core data models touched by provider lifecycle

| Model | Why it matters | File |
|---|---|---|
| `sessions` | Stores `sandboxId`, provider, status, tunnel URLs, pause state | `packages/db/src/schema/sessions.ts` |
| `repo_baseline` | Default baseline command/context selection for faster start | `packages/db/src/schema/schema.ts` (target) |
| `repos` | Repo identity and setup context used during boot | `packages/db/src/schema/repos.ts` |

## Provider contract (V1 expected behavior)
Provider must support:
- Ensure sandbox exists
- Execute command(s)
- Stream output/events via gateway runtime path
- Pause/resume by sandbox id when available
- Destroy sandbox

Control-plane code should only call provider abstraction, not vendor SDK types.

## Boot flow (E2B)
1. Session runtime asks provider to ensure sandbox
2. Provider resolves sandbox identity (`currentSandboxId` or create new)
3. Provider injects runtime env (session id, gateway URL/token, env bundle values, non-sensitive config)
4. Provider may inject short-lived repo-scoped git credential for sandbox-native git operations
5. Sandbox starts `sandbox-daemon` and runtime processes
6. Provider resolves ingress host by explicit daemon port (E2B `getHost(port)`)
7. Gateway performs signed readiness probe against daemon ingress endpoint and marks runtime ready

Transport direction rule:
- Runtime transport uses Gateway -> Sandbox ingress over provider tunnel.
- Browser never receives provider hostnames directly.

## Pause/Resume flow (E2B)
- Pause:
  - Triggered by idle policy (default `10m`), including approval-wait idle periods
  - Provider pause call executed (`betaPause` path in E2B SDK)
  - Session row updated with paused state and snapshot/sandbox reference
- Resume:
  - Resolve pinned compute identity from immutable session core fields (`provider/templateId/imageDigest`)
  - Provider reconnect by stored id (`connect()` resumes paused E2B sandboxes)
  - Re-hydrate fresh short-lived credentials (git/app tokens, virtual LLM key) via control plane before resuming task execution
  - Runtime restarts stream
  - Session continues from durable DB context

Network caveat from E2B behavior:
- Paused sandboxes drop active network connections.
- On resume, terminal/preview clients must reattach.

## Snapshot/setup strategy (V1)
Use E2B capabilities pragmatically:
- Snapshot is optimization, not correctness dependency
- Correctness comes from DB state + reproducible workspace steps

Recommended V1 behavior:
- On first repo setup, let setup run complete and persist metadata
- For recurring work, resume existing sandbox when possible
- If sandbox missing/expired, rebuild quickly from known setup path
- Use a "fat" E2B template for coding runs (Playwright + browser support) so final outputs can include visual proof artifacts
- Always run a git freshness step before task execution (`git fetch` + reset/rebase policy) so cached sandbox state does not drift from remote

## Setup snapshot refresh policy
To avoid stale snapshots:

1. Detect dependency-shape changes on default branch (`package-lock`, `pnpm-lock`, `poetry.lock`, `requirements*`, `Dockerfile`, `.devcontainer/*`).
2. Mark configuration snapshot stale.
3. Rebuild baseline setup snapshot asynchronously.
4. New sessions use refreshed baseline snapshot; existing active sessions continue until completion.

## Security requirements
- Do not inject privileged long-lived tokens into sandbox by default
- Sandbox-native git operations may use short-lived, repo-scoped credentials (ephemeral)
- Ephemeral credentials must be minted/refreshed on cold boot and resume; never restored from frozen snapshot values
- Keep non-git action/integration execution server-side
- Sandbox can request actions; gateway approves/executes

## Failure handling
Common failures and expected response:
- Sandbox create fails: mark session failed with retry metadata
- Sandbox pause fails: log and continue with stop fallback
- Resume id not found: create new sandbox and recover from durable state
- Stream disconnect: retry attach with bounded backoff

## Telemetry required for E2B V1
Track per session:
- Sandbox create latency
- Time to first output
- Resume latency
- Pause success rate
- Failures by class (create, exec, resume, stream)
- Reattach success rate after pause/resume

## Non-goals (V1)
- Cross-provider state portability
- Kubernetes scheduling features
- Full snapshot productization UI

## Definition of done checklist
- [ ] All runtime execution goes through provider abstraction
- [ ] E2B boot/exec/pause/resume/destroy implemented reliably
- [ ] Failure paths are explicit with retries/fallbacks
- [ ] Security boundary preserved (server-side credential execution)
- [ ] Basic E2B telemetry emitted and queryable
- [ ] Runtime readiness is based on signed inbound daemon readiness check via provider tunnel
- [ ] Snapshot refresh path exists for dependency and environment drift

---

# Source: 03-action-registry-and-org-usage.md

# Action Registry and Org Usage

## Goal
Create one execution boundary for all side effects (GitHub, Sentry, Linear, Slack, MCP tools) where policy, identity, OAuth resolution, approval, and audit are handled consistently.

This is the main difference between "agent can think" and "agent can safely do work".

## Scope
In scope:
- Action catalog listing for a session/coworker
- Action invocation + mode resolution (`allow`, `require_approval`, `deny`)
- OAuth token resolution and MCP connector auth resolution
- Sandbox-native git credential policy (short-lived, repo-scoped)
- GitHub PR ownership mode policy (`sandbox_pr` vs `gateway_pr`)
- Org-wide vs personal integration behavior
- Approval and post-approval revalidation
- Audit and status visibility

Out of scope:
- Trigger ingestion mechanics (see `05-trigger-services.md`)
- Session boot/runtime internals (see `06-gateway-functionality.md` and `11-streaming-preview-transport-v2.md`)

## Implementation file tree (must-read)

```text
apps/gateway/src/api/proliferate/http/
  actions.ts                 # invoke/approve/deny/status surfaces

packages/services/src/actions/
  service.ts                 # mode resolution + invocation lifecycle
  db.ts                      # action invocation persistence
  modes.ts                   # policy source resolution
  connectors/                # MCP connector action source adapters

packages/services/src/integrations/
  service.ts                 # integration lifecycle
  tokens.ts                  # OAuth token resolution boundary
  github-app.ts              # GitHub App installation token path
  oauth.ts                   # provider OAuth exchange + refresh lifecycle (target)

packages/services/src/connectors/
  service.ts                 # org connector CRUD and validation
  db.ts                      # org connector persistence

packages/services/src/secrets/
  service.ts                 # secret resolution for connector auth
```

Reference docs:
- `docs/specs/actions.md`
- `docs/specs/integrations.md`
- `docs/sim-architecture-spec.md` (for control-plane credential handling pattern)
- `docs/specs/agent-platform-v1/16-agent-tool-contract.md`

## Core data models

| Model | Purpose | File |
|---|---|---|
| `action_invocations` | Durable record of requested/executed/approved/denied side effects | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` | OAuth/GitHub-App references by org | `packages/db/src/schema/integrations.ts` |
| `org_connectors` | Org-scoped MCP connector definitions | `packages/db/src/schema/schema.ts` (`orgConnectors`) |
| `organization.action_modes` | Org policy overrides for `sourceId:actionId` keys | `packages/db/src/schema/schema.ts` |
| `automations.action_modes` | Coworker-level stricter policy overrides | `packages/db/src/schema/schema.ts` |
| `outbox` | Async notifications for approval/state transitions | `packages/db/src/schema/schema.ts` (`outbox`) |

Minimum invocation fields to persist:
- `organizationId`, `sessionId`, `sourceId`, `actionId`, `params`
- `mode`, `modeSource`
- `actorUserId`, `requestedRunAs`, `credentialOwnerType`
- `status`, `approvedBy`, `approvedAt`, `executedAt`, `error`

Session-scoped execution rule:
- Actions are never executed "by automation row" directly.
- Every invocation must be attributable to a concrete session execution context.

## Action source architecture

### One catalog, two source types
1. Provider actions:
- Built-in adapters for GitHub/Linear/Sentry/Slack class operations
- Definitions and schemas owned in provider/action modules

2. Connector actions (MCP):
- Discovered from org connector tools list (`tools/list`)
- Wrapped into the same `sourceId/actionId` runtime contract
- Executed through server-side connector client, never direct sandbox secret use

The runtime pipeline is unified after source resolution.

## OAuth and MCP credential path (required behavior)

### OAuth-backed actions
- OAuth is managed in Proliferate control-plane (no external broker dependency).
- Provider account references and encrypted credential material are stored in Proliferate DB/secret boundary.
- Runtime obtains fresh token server-side via `packages/services/src/integrations/tokens.ts:getToken`.
- Refresh flow is provider-specific and executed by integration token service (`oauth.ts` target ownership).
- GitHub App path mints short-lived installation tokens server-side (`github-app.ts`).
- Sandbox never receives long-lived OAuth secrets.
- Final target is one in-house OAuth lifecycle:
  1. Auth code exchange
  2. Encrypted token persistence
  3. Refresh/retry lifecycle
  4. Revocation/disconnect lifecycle

### MCP connector-backed actions
- Connector config is org-owned (`org_connectors`).
- Auth material resolves from server-side secret storage (`packages/services/src/secrets/service.ts`).
- Gateway/service opens MCP client session and executes tool call.
- Sandbox only receives action results, not connector credentials.

This follows the same control-plane secret boundary that strong enterprise systems use.

## Sandbox-native git operations (explicit V1 exception)

Allowed in sandbox:
- `git fetch/pull/commit/push`
- PR creation from sandbox tooling (default mode)

Required constraints:
- Credentials must be short-lived and repo-scoped.
- Credentials are minted server-side and injected only for session runtime.
- Credentials must be refreshed on resume/rehydration paths; expired credentials must not be replayed from stored runtime snapshots.
- No long-lived org action secrets are injected for this path.
- Non-git side effects (for example ticket changes, deploy actions, analytics writes) stay in gateway action execution path.
- Audit must still record actor, run identity, repo, and resulting PR metadata.

## GitHub PR ownership mode (policy toggle)

`sandbox_pr` (V1 default):
- Sandbox creates PR directly after push using short-lived repo-scoped credential.
- Fastest path; minimal control-plane orchestration.

`gateway_pr` (future strict mode):
- Sandbox pushes branch only.
- Sandbox emits PR-create request to gateway action boundary.
- Gateway creates PR server-side with policy-controlled identity.

Mode requirements:
- PR ownership mode is explicit and must be frozen in immutable session core fields.
- Mid-run mode changes do not affect in-flight run behavior.

## Invocation flow (end to end)

### 1) List available actions
1. Resolve session org + identity
2. Load built-in provider actions
3. Load enabled org connectors and discover tools
4. Normalize to tool manifest contract (title/when-to-use/schema/risk/mode hint)
5. Freeze manifest in immutable session capability/tool contract for that session
6. Return normalized list with schema + mode hints

### 2) Invoke action
1. Validate input schema
2. Resolve mode in deterministic order:
- automation override
- org override
- default risk mode
3. Create invocation row
4. If action is not visible to session capability set, reject as policy denied
5. If `require_approval`: persist pending + emit notification + return structured `pending_approval` response immediately
6. If `allow`: execute immediately via provider/connector adapter
7. Persist final status and normalized output summary

### 3) Approve/deny pending invocation
1. Validate approver role
2. Transition pending row
3. Revalidate before execution (TOCTOU)
- token still valid
- target state still valid
- policy still permits this exact request
4. Execute or fail with revalidation error
5. Persist final state + broadcast update
6. If unresolved beyond expiry window, transition to `expired` and publish deterministic outcome for harness reconciliation
7. For origin execution still marked `waiting_for_approval`, write durable `resume_intent` in the same transaction as final invocation outcome persistence.

Revalidation precedence contract (required):
- Frozen immutable session contract remains source-of-truth for run intent (identity/tooling defaults).
- Live org security state is source-of-truth at execution time:
  - integration/token revocations
  - org kill switches / connector disablement
  - credential validity/expiry
- If live security state is stricter than frozen snapshot, execution must fail closed.

## Invocation state machine and idempotency

Allowed transitions:
- `pending` -> `approved` -> `executing` -> `completed|failed`
- `pending` -> `denied`
- `pending` -> `expired`
- `approved` -> `failed` (revalidation or execution failure)
Idempotency requirements:
- Every invocation must carry an `idempotencyKey` unique per org + action intent.
- Retry of the same request must return existing invocation/result instead of duplicating side effects.
- External provider request IDs should be stored when available for reconciliation.

Approval-triggered resume contract:
- Resume intent is created only on final resolved outcomes for a previously pending invocation:
  - `completed` (approved path executed successfully)
  - `failed` (approved path but execution/revalidation failed)
  - `denied`
  - `expired`
- Do not create resume intent for intermediate `approved` state.
- Resume intent uniqueness key is `(origin_session_id, invocation_id)`.
- Runtime/harness injection dedupe key is `invocation_id`.
- Resume intent processing is owned by worker/orchestration queue and does not rely on live gateway stream connectivity.

Approval expiration policy:
- Pending approvals auto-expire after `24h` if unanswered.
- Expiration is durable (`status=expired`) and must be visible in session approval surfaces + harness reconciliation payloads.

## Org-wide vs personal integration behavior

Two separate decisions must always be explicit:
1. `run_as`: who the coworker is acting as
2. `credential_owner`: whose token/connector auth will be used

Default policy for V1:
- Interactive runs: prefer personal credential when available
- Long-running coworkers: prefer org/system credential
- Personal -> org fallback only when explicitly allowed by policy

Fail-safe rule:
- If required personal credential is missing, fail with actionable message.
- Do not silently escalate to org admin credentials.

## Sharing behavior for coworkers/templates

Required UX semantics:
- Coworkers can be shared, but integrations must declare ownership type (`org` vs `personal-required`).
- On import/share, personal-required integrations prompt the recipient to bind their own account.
- Warning banner must explain when a coworker currently depends on personal credentials.

## Security invariants

- Every non-git external side effect runs through gateway/service invocation path.
- Sandbox git push/PR path is the only V1 exception and is constrained to short-lived repo-scoped credentials.
- V1 default PR mode is `sandbox_pr`; strict `gateway_pr` is reserved for policy hardening without architecture rewrite.
- No direct sandbox -> third-party privileged writes with raw org credentials.
- All invocations are auditable and queryable by session/coworker/org.
- Approval-required actions must be durable and recoverable across restarts.
- Connector and OAuth auth materials are resolved server-side only.

## OAuth baseline (clean-slate)

Required baseline:
1. Use in-house OAuth for provider auth code exchange, encrypted token persistence, refresh, and revoke.
2. Do not route runtime token resolution through broker APIs.
3. Keep one token-resolution path (`integrations/tokens.ts`) for all OAuth-backed actions.

## Definition of done checklist
- [ ] Single invocation lifecycle covers provider and MCP connector actions
- [ ] Input schemas validated before execution
- [ ] Mode resolution and source attribution persisted on each invocation
- [ ] OAuth and connector auth resolved server-side only
- [ ] Org vs personal credential behavior is explicit and visible
- [ ] Approval/deny + revalidation paths are implemented and auditable
- [ ] Sharing UX warns and remaps personal integrations on import
- [ ] PR ownership mode is explicit per run (`sandbox_pr` default, `gateway_pr` available for future strict mode)

---

# Source: 16-agent-tool-contract.md

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

---

# Source: 04-long-running-agents.md

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

---

# Source: 05-trigger-services.md

# Trigger Services (Tick Engine + Source Ingestion)

## Goal
Turn external source state into reliable internal work requests for coworkers.

## Core rule
Trigger-service is ingestion + scheduling infrastructure, not the LLM reasoning layer.
It should persist quickly, schedule safely, and hand off deterministic work.

Current key files:
- [polling worker](/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts)
- [scheduled worker](/Users/pablo/proliferate/apps/trigger-service/src/scheduled/worker.ts)
- [webhooks ingestion (optional external ingress)](/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts)
- [trigger services](/Users/pablo/proliferate/packages/services/src/triggers)

## Trigger subsystem file tree

```text
apps/trigger-service/src/
  polling/worker.ts             # tick cadence execution + source polling
  scheduled/worker.ts           # cron scheduler restore + due trigger execution
  api/webhooks.ts               # optional external ingress path (normalized into wake pipeline)
  webhook-inbox/worker.ts       # async ingestion processing for external ingress path

packages/services/src/triggers/
  service.ts                    # trigger/tick CRUD + orchestration rules
  db.ts                         # trigger and trigger event persistence
  mapper.ts                     # API shape mapping

packages/services/src/webhook-inbox/
  db.ts                         # raw external ingress durability + claim/retry
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `triggers` | Trigger/tick definitions (provider, cadence, config, integration binding) | `packages/db/src/schema/triggers.ts` |
| `trigger_events` | Durable event records before/after processing | `packages/db/src/schema/triggers.ts` |
| `trigger_event_actions` | Audit of tool actions from trigger processing | `packages/db/src/schema/triggers.ts` |
| `trigger_poll_groups` | Polling fan-in by org/provider/integration for scale | `packages/db/src/schema/schema.ts` |
| `webhook_inbox` | Raw external event durability and retry safety | `packages/db/src/schema/schema.ts` |

Checkpoint model:
- `agent_source_cursors` (or equivalent) for per-coworker/per-source checkpoint state, replacing broad poll-group-only cursor ownership.

## V1 source scope
Required:
- GitHub (issues/PR/CI signal entrypoints)
- Linear (issue updates/comments)
- Sentry (issue events)
- Slack (mentions/commands)

Optional/later:
- PostHog batch analysis
- Jira parity for enterprise bundles
- Docs/productivity sources (for example Google Docs) via connector-backed ingestion

## Wake model (tick-first)
Primary path:
- A cadence tick determines due coworkers.
- Worker polls configured sources outbound.
- If there is no new source delta, worker updates checkpoint and exits.
- If there is new source delta, worker creates wake event + manager wake request.

Secondary path (optional ingress):
- Webhooks can still be ingested where needed.
- Webhook payloads are normalized into the same internal wake/event path.

Why this shape:
- Works in private-network/self-host environments without public inbound routing.
- Keeps operator model simple: polling cadence + checkpoints + idempotency.

## Event pipeline
1. Tick scheduler identifies due coworker/source scope
2. Poll source APIs outbound (or ingest external event via ingress path)
3. Normalize payload to internal event shape
4. Persist wake event
5. Deduplicate/group bursty events deterministically
6. Create manager wake request (not child coding run)
7. Dispatch wake via outbox/worker pipeline

Run-storm prevention rule:
- Trigger-service must not spawn child coding runs directly.
- If manager is already running/queued for a coworker, coalesce additional wake events.
- Trigger-service performs deterministic pre-LLM grouping so manager receives summarized batches, not raw firehose payloads.
- Manager harness decides child run fanout from grouped summaries.

Context handoff rule:
- Trigger-service and manager handoff must preserve structured source context for child run creation.
- Minimum handoff shape includes:
  - provider + stable group key
  - first/last seen timestamps + count
  - representative payload summary + links
- This structured bundle is passed to child run context assembly (see `16-agent-tool-contract.md`).

Deterministic grouping requirements:
- Group by provider-specific stable keys (for example `sentry_issue_id`, `linear_issue_id`, `github_repo+pr+event_type`).
- Maintain counters and first/last occurrence timestamps per group.
- Store representative payload sample (or normalized summary), not every duplicate body.
- Enforce max grouped items per wake payload; overflow items remain queued.

## Dedup and idempotency
Must dedupe on:
- Provider event id or source cursor checkpoint
- Content hash + source + time window
- Tick idempotency key (`coworkerId + source + scheduledWindow`)

Must support safe reprocessing if worker crashes.

## Trigger-to-agent mapping
Mapping model should support:
- Org-level coworker owning source (for example global Sentry triager)
- Repo/project scoped coworker binding
- Manual override in UI

Routing precedence (required):
1. Explicit source/tick -> coworker binding
2. Repo/project scoped coworker binding
3. Org default coworker for provider/source

Fanout/backpressure rules (required):
- Default fanout is one target coworker per wake event unless explicitly configured.
- If multiple targets are allowed, enforce max fanout per event.
- When org concurrency cap is reached, queue events and mark delayed (not dropped).

## UX expectations
Users should not configure brittle technical trigger graphs for V1.
They should configure:
- Which sources this coworker watches
- Which projects/repos are included
- Tick cadence (`every 5m`, `hourly`, `daily`) and optional custom cron
- "Run now" test action for each configured source

## Definition of done checklist
- [ ] Tick-based polling path is durable and idempotent
- [ ] Optional external ingress path normalizes into same wake pipeline
- [ ] Dedup prevents duplicate run storms
- [ ] Wake events map cleanly to target coworkers
- [ ] Failures are visible and retryable
- [ ] Trigger setup UX supports tick cadence without manual JSON editing

---

# Source: 08-coding-agent-harnesses.md

# Coding Agent Harnesses

## Goal
Support strong coding execution today with OpenCode, while keeping the system harness-agnostic so teams can use other coding agents later.

## Product requirement
Users should be able to:
- Run coding tasks with a default harness (OpenCode)
- Keep long-running orchestration independent of harness choice
- Eventually switch harness per agent/profile without replacing control plane

## Clear responsibility split

### Control plane + gateway
Owns:
- Session lifecycle
- Policy and approvals
- Credential resolution
- Audit and live events

### Coding harness inside sandbox
Owns:
- Code reasoning loop
- File edits
- Command/test execution
- Producing patch/commit output
- Sandbox-native git push and PR creation for repo tasks (with short-lived repo-scoped auth)

This keeps orchestration stable even if harness changes.

## V1 harness mode
Default only:
- OpenCode as coding harness
- PR ownership mode defaults to `sandbox_pr` (sandbox pushes + creates PR)

Relevant code paths:
- [opencode config helpers](/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts)
- [opencode tools package](/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts)
- [gateway tool route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)
- [agent contract spec](/Users/pablo/proliferate/docs/specs/agent-contract.md)
- [sandbox provider spec](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)
- [tool contract spec](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)

## Harness file tree (V1)

```text
packages/shared/src/sandbox/
  opencode.ts                 # OpenCode runtime config and launch helpers
  config.ts                   # sandbox bootstrap files + defaults

packages/shared/src/opencode-tools/
  index.ts                    # tool injection contracts for coding runs

apps/gateway/src/api/proliferate/http/
  tools.ts                    # tool callback boundary into control plane

packages/services/src/actions/
  service.ts                  # side-effect path for tool-requested actions
```

## Core data models used by harness flows

| Model | Harness relevance | File |
|---|---|---|
| `sessions` | Run identity, prompt context, runtime status | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | Actions requested by harness and approval outcomes | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` / `org_connectors` | Source auth lookup done by gateway/services | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |
| `outbox` | Notifications from terminal run state changes | `packages/db/src/schema/schema.ts` (`outbox`) |

## Future harness-agnostic contract
Plan for simple adapter surface:
- start(task, context)
- stream events
- stop
- collect outputs

Each harness adapter should map to common run output format:
- summary
- changed files
- checks run + results
- PR metadata links
- artifacts

## Worker profiles (recommended)
Two profiles are required:
- **Worker harness (fat sandbox):** OpenCode for coding tasks (edit/test/git flows)
- **Manager harness (lean sandbox):** lightweight orchestration loop for inbox triage, status queries, and spawning child coding runs

Manager harness responsibilities:
- read coworker inbox/events
- summarize progress and answer \"what happened\" queries
- call control-plane tools to spawn coding child runs
- avoid heavy code-editing loops

Worker harness responsibilities:
- execute concrete coding task
- run checks/tests
- produce deterministic output bundle (summary, diff, artifacts, PR metadata)
- handle git fetch/commit/push/PR using ephemeral repo credentials

PR ownership mode support:
- `sandbox_pr` (default now): worker harness creates PR from sandbox.
- `gateway_pr` (future strict mode): worker harness pushes branch; gateway creates PR.

## Async approval handoff contract

When harness requests a gateway action and receives `status=pending_approval`:
- Harness must treat it as "waiting", not failure.
- Harness must persist checkpoint state (`waiting_for_approval`, `invocationId`) and yield/exit loop cleanly.
- Harness must not busy poll.
- Session follows normal idle policy (default `10m`) and may pause.
- Gateway resume push event (`sys_event.tool_resume`) is best-effort only.
- On reconnect/resume, harness/daemon must reconcile invocation states from gateway before next reasoning step.
- Reconciliation outcomes include `approved/executed`, `denied`, `failed`, and `expired`.

Resume source-of-truth:
- Harness continuation is driven by durable worker-owned resume orchestration, not by websocket push delivery guarantees.
- Harness must assume it can wake in:
  - same resumed origin session, or
  - continuation session created after resume fallback.
- Harness must dedupe already-applied reconciliation outcomes by `invocationId`.

OpenCode continuation baseline (V1):
- Default to stateless continuation mode (no required native in-process checkpoint primitive).
- After reconciliation, restart a new reasoning turn with:
  - prior run summary
  - resolved invocation outcome
  - explicit continue instruction from control plane
- Use stateful checkpoint resume only if explicitly supported and verified in harness implementation docs.

Continuation identity contract:
- If running in continuation session, control plane must include `continuedFromSessionId` context.
- Harness must treat this as the same logical task lineage and continue from durable state, not from stale in-memory assumptions.

Invocation response handling (required):
- Harness tool adapter must consume one structured envelope:
  - `success`: inject result payload to reasoning loop
  - `failed`: inject structured error (`code`, `message`, `retryable`)
  - `pending_approval`: checkpoint + yield flow above

## Security constraints for harnesses
- Harness never receives privileged org tokens by default
- Harness may receive short-lived repo-scoped git auth for coding session lifecycle
- External side effects use gateway action invocation path
- Harness may request actions; gateway decides and executes
- OAuth and MCP credentials are resolved in control-plane services, not inside sandbox

## UX implications
Users should not need to know harness internals.
They should configure:
- Agent purpose
- Allowed tools/capabilities
- Output/review expectations

Harness choice is advanced setting.

## Non-goals (V1)
- Perfect abstraction over all coding tools now
- Full bring-your-own harness support in first release
- Deep harness-specific UI customizations

## Definition of done checklist
- [ ] OpenCode-based coding runs are stable in E2B
- [ ] Harness logic does not bypass gateway action boundary
- [ ] Run outputs are normalized for UI and audits
- [ ] Codebase is structured to add new harness adapters later

---

# Source: 09-notifications.md

# Notification Mechanisms for Agents

## Goal
Make notifications reliable, low-noise, and actionable for both interactive runs and long-running coworkers.

## Product behavior
Notifications should answer:
- What happened?
- Does a human need to act?
- Where do I click to inspect/fix/approve?

They should also support a coworker-style communication model:
- Per-coworker thread/channel destination
- Optional "ping me on every meaningful update" mode
- Immediate escalation for blocked/approval-required states

## Notification event types (V1)
Required:
- `approval_required`
- `approval_resolved`
- `run_started`
- `run_blocked`
- `run_failed`
- `run_completed`
- `agent_health_degraded`

Optional in V1.1:
- `digest_daily`
- `digest_weekly`

## Delivery channels
V1 required channels:
- In-app notifications center (durable source of truth)
- Slack (primary external channel)

V1.1+ channels:
- Email
- Webhook sink
- Desktop push

## Architecture model
Use durable outbox + async dispatch.

Current code anchors:
- [notifications service](/Users/pablo/proliferate/packages/services/src/notifications/service.ts)
- [notifications db](/Users/pablo/proliferate/packages/services/src/notifications/db.ts)
- [outbox service](/Users/pablo/proliferate/packages/services/src/outbox/service.ts)
- [worker notification dispatch](/Users/pablo/proliferate/apps/worker/src/automation/notifications.ts)

## Notifications file tree

```text
packages/services/src/notifications/
  service.ts                  # notification intents + enqueue
  db.ts                       # subscriptions and notify markers

packages/services/src/outbox/
  service.ts                  # claim/retry/dispatched/failed transitions

apps/worker/src/automation/
  notifications.ts            # run notification formatting + delivery
  outbox-dispatch.ts          # generic outbox dispatch loop
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `outbox` | Durable queue and retry/lease state for notification delivery | `packages/db/src/schema/schema.ts` (`outbox`) |
| `session_notification_subscriptions` | Per-user per-session subscription preferences and delivery marker | `packages/db/src/schema/slack.ts` |
| `automations.notification_*` fields | Coworker-level destination defaults | `packages/db/src/schema/automations.ts` |
| `automation_runs` / `sessions` | Source state for notification content and deep links | `packages/db/src/schema/schema.ts`, `packages/db/src/schema/sessions.ts` |
| `automation_run_events` | Durable timeline/audit events consumed by notification and session views | `packages/db/src/schema/schema.ts` (`automationRunEvents`) |

## State layering contract (required)

To avoid mixing concerns, treat these as separate layers:

1. Entity statuses (source of truth for lifecycle)
- `action_invocations.status`: `pending | approved | denied | completed | failed | expired`
- `sessions.status`: `starting | running | paused | stopped | failed`
- `automation_runs.status`: orchestration lifecycle status values

2. Timeline events (durable history, append-focused)
- examples: `approval_required`, `approval_resolved`, `resume_queued`, `resuming`, `continued`, `resume_failed`
- stored durably and shown in run/session timelines

3. Notification intents (delivery tasks)
- records queued for in-app notifications center / Slack / email channels
- created from status changes + timeline events under noise-control policy

## End-to-end flow
1. Runtime status changes (or approval requirement occurs)
2. System writes durable notification intent (outbox + subscription state)
3. Dispatcher claims pending outbox rows
4. Channel delivery attempt runs
5. Delivery result stored (`sent`, `failed`, `retrying`, `dead_letter`)
6. UI reflects latest state from DB

Approval-resume durable timeline chain:
- `approval_required`
- `approval_resolved` (`approved` / `denied` / `expired`)
- `resume_queued`
- `resuming` (or `continued` when fallback continuation session is created)
- terminal outcome: `run_completed` / `run_failed` / `resume_failed`

## Recipient resolution model
Resolve recipients by precedence:
1. Run/session-level override
2. Coworker-level notification config
3. Org defaults
4. User notification preferences (mute/escalation)

## Required payload fields
Every notification should include:
- organizationId
- automationId and/or automationRunId and/or sessionId
- event type
- short title
- human-readable summary
- deep link(s) to run/session/approval
- severity
- createdAt

For approvals, include:
- requested action
- reason
- invocation id
- expiry timestamp
- approval links
- origin session/run references

## Reliability rules
- Use idempotency key per notification intent
- Retries with backoff for transient channel errors
- Dead-letter after max attempts
- Never lose notifications due to websocket disconnects (DB is source of truth)

## Noise control rules
- Coalesce repeated events for same run in short window
- Avoid sending both "started" and immediate "failed" spam chains
- Use digest mode for low-priority updates
- Always send `approval_required` immediately

## Security and privacy rules
- Do not include secrets in notification payloads
- Limit sensitive stack traces in external channels
- Keep full details in app (linked secure page)
- Record who approved/denied in audit trail

## UX requirements

### In-app notifications center
Must support:
- Filter by status/severity/type
- Mark read/unread
- Approve/deny from notification context where applicable (or deep-link to session approval surface)
- Deny with reason (optional text)
- Clear link to session detail and artifacts
- Show action context (what will happen, target resource, requester/run identity, and expiry)

### Slack
Must support:
- Human-readable summary
- Button/link to "View Run" and "Review Approval"
- For approval-required, clear call-to-action with deep link to web sessions filters/detail (Slack-native approve/deny is optional, not required in V1)
- Stable thread/channel targeting for each coworker when configured

Approval timeout rule:
- Approval-required notifications must show a clear expiration window (`24h` default).
- On expiration, send follow-up status notification (`expired`) and keep durable audit trail.

External push noise policy:
- External channels should not receive every resume-state transition by default.
- Required external pushes:
  - `approval_required`
  - `resume_failed`
  - final resumed/continued outcome (`run_completed` / `run_failed`)
- `approval_resolved` external push is optional by org preference; durable in-app timeline remains required.

## Cloud billing tie-in
Notification usage may become billable later, but V1 treats notification dispatch as operational cost, not primary billing dimension.

## Non-goals (V1)
- Full campaign-style notification rules engine
- Arbitrary user-built workflows for notification routing
- Multi-channel fanout policies with complex conditional trees

## Definition of done checklist
- [ ] Notification intents are written durably
- [ ] Dispatcher retries and marks final delivery status
- [ ] In-app notifications center shows reliable DB-backed notifications
- [ ] Slack notifications include actionable deep links
- [ ] Approval-required notifications are immediate and auditable
- [ ] Coworker-level destination preferences are respected

---

# Source: 19-artifacts-and-retention.md

# Artifacts and Retention

## Goal
Define where run outputs live, how they are referenced, and how retention/security rules are enforced.

## Status
- Applies to: V1
- Normative: Yes

## Scope
In scope:
- artifact classes and ownership
- object storage write/read path
- DB metadata references
- retention and deletion policy
- self-host operator requirements

Out of scope:
- full content-addressed storage redesign
- custom enterprise DLP pipelines

## Artifact classes (V1)
- `completion` artifacts: final run output bundle
- `enrichment` artifacts: pre-execution analysis bundle
- `sources` artifacts: normalized source context snapshot
- `policy` artifacts: policy/evaluation summary bundle
- visual proof artifacts (screenshots/video) when task requires UI proof

## File anchors

```text
apps/worker/src/automation/
  index.ts
  artifacts.ts

packages/services/src/runs/
  service.ts
  db.ts

packages/db/src/schema/
  schema.ts            # automationRuns.*ArtifactRef
  sessions.ts

apps/web/src/server/routers/
  automations.ts
  sessions.ts
```

## Core data model contract

| Model/field | Purpose | File |
|---|---|---|
| `automation_runs.completionArtifactRef` | pointer to completion artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.enrichmentArtifactRef` | pointer to enrichment artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.sourcesArtifactRef` | pointer to source-context artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.policyArtifactRef` | pointer to policy artifact object | `packages/db/src/schema/schema.ts` |
| `automation_runs.completionJson/enrichmentJson` | structured inline summary payloads | `packages/db/src/schema/schema.ts` |

## Write path contract
1. Run service reaches artifact-write stage and enqueues outbox job (`kind = write_artifacts`).
2. Worker claims job and writes artifact payload to object storage.
3. Worker updates corresponding `*ArtifactRef` field(s) on `automation_runs`.
4. Worker emits durable run/timeline event for artifact write result.

## Read path contract
1. UI/API reads run/session metadata from DB first.
2. If artifact reference exists, backend resolves authorized object access.
3. Client receives metadata + retrieval link/stream response from authorized backend path.

Rules:
- Browsers do not receive unrestricted bucket credentials.
- Artifact read authorization must check org/session ownership before serving.

## Retention contract
- Default retention follows run/session retention window unless overridden by org policy.
- Deletion policy must remove:
  - object storage blob
  - stale DB reference or mark-as-deleted state
- Legal hold/compliance override can suspend deletion for selected orgs.

## Size and safety constraints
- Artifact payloads must be bounded and compressed where appropriate.
- Do not store raw secrets or token values inside artifacts.
- External channel notifications should link to artifact views, not inline full sensitive payloads.

## Self-host requirements
- Operator must provide S3-compatible object storage endpoint.
- Required env/config includes bucket, region/endpoint, and credentials binding.
- Backup/restore runbooks must include both Postgres and object storage.

## Definition of done checklist
- [ ] Artifact write path is asynchronous and durable
- [ ] `automation_runs` stores stable artifact references
- [ ] Artifact reads enforce org/session authorization
- [ ] Retention/deletion policy is documented and executable
- [ ] Self-host deployment docs include object storage prerequisites

---

# Source: 07-cloud-billing.md

# Billing on Cloud (V1)

## Goal
Bill managed-cloud customers in a way that is simple, explainable, and tied to real agent usage.

Current code anchors:
- [web billing router](/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts)
- [billing services](/Users/pablo/proliferate/packages/services/src/billing)
- [metering](/Users/pablo/proliferate/packages/services/src/billing/metering.ts)
- [billing worker](/Users/pablo/proliferate/apps/worker/src/billing/worker.ts)
- [billing outbox processor](/Users/pablo/proliferate/apps/worker/src/jobs/billing/outbox.job.ts)

## Billing file tree

```text
apps/web/src/server/routers/
  billing.ts                  # customer-facing billing APIs

apps/worker/src/billing/
  worker.ts                   # recurring billing jobs

apps/worker/src/jobs/billing/
  outbox.job.ts               # outbox posting/sync jobs
  fast-reconcile.job.ts       # on-demand reconciliation

packages/services/src/billing/
  metering.ts                 # usage event creation
  gate.ts                     # runtime gating checks
  org-pause.ts                # pause org on policy/credit rules
  shadow-balance.ts           # fast balance approximation
  outbox.ts                   # outbox posting helpers
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `billing_events` | Usage ledger + outbox posting state (`pending`, `posted`, `failed`) | `packages/db/src/schema/billing.ts` |
| `llm_spend_cursors` | Incremental sync cursor for LLM spend ingestion | `packages/db/src/schema/billing.ts` |
| `billing_reconciliations` | Manual/automatic corrections with audit trail | `packages/db/src/schema/billing.ts` |
| `sessions` | Runtime duration and lifecycle timestamps used for compute metering | `packages/db/src/schema/sessions.ts` |
| `organization` billing fields | Current balance/plan and gating behavior | `packages/db/src/schema/schema.ts` / auth schema |

## V1 pricing model (recommended)
Two-part model:
1. Platform fee (seat/base)
2. Usage fee (runtime and model usage)

Keep invoicing transparent:
- Session runtime minutes
- Model token spend proxy
- Optional premium for heavy sandbox usage

## What to meter in V1
Required metering dimensions:
- Session/runtime duration
- Run count
- Invocation count for expensive connectors
- LLM token usage (from LiteLLM spend logs)

If LLM proxy spend data is unavailable for a path, meter runtime minutes as fallback and label estimate in reporting.

## Metering source-of-truth rules
- LLM token usage source-of-truth is LiteLLM spend ingestion (`llm-sync-*` worker jobs, per-org cursor).
- Gateway runtime stream usage frames are advisory telemetry only (not billable token truth).
- Session compute duration is derived from durable lifecycle timestamps (`startedAt`, `pausedAt`, `endedAt`) with pause windows excluded.
- Pause/resume boundaries must create deterministic metering cut points to avoid double counting.
- Approval-wait time is billable only while session is still running; once idle pause triggers, paused window is not billable.

Budget enforcement split (required):
- Ledger truth remains async (spend ingestion).
- Hard budget/rate enforcement must happen synchronously at LLM proxy virtual-key layer.
- Billing worker reconciliation must not be the first line of budget defense for runaway loops.

## Metering event model
Create durable usage records when:
- Session starts/stops
- Run completes/fails
- Invocation executes expensive side effects

Each usage row needs:
- org id
- source (session/run/invocation)
- quantity + unit
- timestamp
- correlation id for debugging
- provider/model metadata when applicable

## Billing UX requirements
Customer can see:
- Current billing period usage summary
- Top cost drivers (by agent/repo/workflow)
- Recent billable events
- Plan limits and nearing-limit warnings

## Entitlement gates (cloud only)
Need soft/hard gates for:
- Max concurrent runs
- Max active background agents
- Monthly usage thresholds

Gates should fail with clear reason and upgrade path.

## Metering event contract (minimum fields)
Every billable event must include:
- `organizationId`
- `eventType` (`compute` or `llm`)
- `quantity`, `credits`
- `idempotencyKey`
- `sessionIds` (where relevant)
- `metadata` for debugging/explaining invoices

## Non-goals (V1)
- Highly complex pricing permutations
- Per-action micro-pricing for every connector
- Full finance-grade cost attribution by every subcomponent

## Definition of done checklist
- [ ] Metering records are durable and queryable
- [ ] Billing UI shows usage and recent billable activity
- [ ] Plan limits are enforced with clear user messaging
- [ ] Invoices/charges can be explained from recorded events
- [ ] Outbox/reconciliation jobs can recover from transient posting failures

---

# Source: 10-layering-and-mapping-rules.md

# Layering and Mapping Rules (No DB in Routers)

## Goal
Keep architecture clean and maintainable by enforcing strict boundaries between transport, business logic, persistence, and mapping.

## Required layer order
All request paths should follow this flow:

```text
Router/Handler -> Service -> DB Module -> Mapper -> Contract DTO -> Response
```

## Hard rules

### 1) Routers/handlers do transport only
Routers may:
- Validate auth/session context
- Parse request input
- Call service methods
- Return contract-shaped responses

Routers may **not**:
- Execute DB queries
- Build SQL
- Import Drizzle table objects
- Perform business policy decisions
- Contain connector/provider calls

### 2) Services own business logic
Services must:
- Enforce domain rules and policy decisions
- Orchestrate multiple DB calls in a coherent operation
- Call providers/adapters via clean interfaces
- Decide which mapper/DTO shape is returned

Services should not:
- Parse HTTP request objects
- Depend on framework transport types

### 3) DB modules own persistence
`db.ts` modules must contain:
- All DB reads/writes for that domain
- Transaction boundaries
- Necessary raw SQL helpers when unavoidable

`db.ts` modules should not:
- Know about HTTP, websocket, or UI concerns
- Build user-facing response strings

### 4) Mappers own shape conversion
Mapper modules convert:
- DB rows -> domain objects
- Domain objects -> contract DTOs

Mappers should be pure and deterministic.
No network, DB, or side effects inside mappers.

## Canonical file pattern (per domain)
```text
/packages/services/src/<domain>/
  db.ts          # persistence only
  service.ts     # business logic only
  mapper.ts      # row/domain/DTO conversion only
  index.ts       # exports
```

## Concrete domain examples in this repo

```text
packages/services/src/actions/
  db.ts
  service.ts

packages/services/src/integrations/
  db.ts
  service.ts
  tokens.ts        # provider token resolution helper used by service layer

packages/services/src/triggers/
  db.ts
  service.ts
  mapper.ts

packages/services/src/notifications/
  db.ts
  service.ts
```

## Web and Gateway usage pattern

### Web router pattern
```text
apps/web/src/server/routers/*.ts
  -> calls packages/services/src/<domain>/service.ts
```

### Gateway runtime/API pattern
```text
apps/gateway/src/api/*
  -> calls services actions/sessions/integrations APIs
  -> no direct DB queries in route handlers
```

## Core data model ownership rule
All table access still belongs to service `db.ts` modules, even when schemas live in multiple files:
- Sessions/runtime: `packages/db/src/schema/sessions.ts`
- Integrations/connectors: `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` (`orgConnectors`)
- Actions/approvals: `packages/db/src/schema/schema.ts` (`actionInvocations`)
- Triggers/events: `packages/db/src/schema/triggers.ts`
- Billing ledger: `packages/db/src/schema/billing.ts`

## Mapping logic requirements
- Keep contract schemas in `packages/shared/src/contracts`
- Keep field naming consistent across layers (`runAs`, `credentialOwnerType`, etc.)
- Handle nullable/optional fields in mappers, not in UI route handlers
- Centralize timestamp/status normalization in mappers

## Anti-patterns to ban
- Drizzle imports in routers
- `db.select(...)` directly in route files
- Returning raw DB rows to clients
- Copy-pasting mapping logic across routers
- Business policy checks scattered across handlers

## Example: good vs bad

### Bad
- Router validates input, queries DB, checks policy, calls Slack API, formats response

### Good
- Router validates input and calls service
- Service checks policy and calls db + connector + mapper
- DB module does queries only
- Mapper returns stable DTO for router response

## Why this matters
- Easier testing (unit test service and mapper layers independently)
- Safer refactors (transport changes do not break DB logic)
- Better security review (policy logic in one place)
- Cleaner API contracts (no accidental DB leakage)

## Enforcement checklist
- [ ] No DB imports in routers/handlers
- [ ] Every domain has db/service/mapper split
- [ ] Routes return mapped DTOs, not DB rows
- [ ] Policy logic is centralized in services/actions
- [ ] Side-effecting connector calls happen outside router layer
- [ ] OAuth token resolution and MCP secret resolution happen in services, never in routers

---

# Source: 11-streaming-preview-transport-v2.md

# Streaming & Preview Transport — System Spec (V2 "AnyRun" Architecture)

**Status:** `ACTIVE_IMPLEMENTATION_SPEC`

**Objective:** A unified, event-driven, zero-trust transport architecture for real-time agent devboxes. This replaces HTTP polling, embedded IDE servers, and direct browser-to-provider routing with a gateway-controlled daemon transport.

## 0. Clean-Slate Mandate

- **VS Code server is removed** from the target architecture.
- **HTTP polling is banned** for runtime freshness surfaces (terminal, changes, services, preview readiness).
- **Browser never sees provider tunnel URLs** (`*.e2b.dev` or equivalent).
- **`sandbox-daemon` replaces `sandbox-mcp` and in-sandbox Caddy** as the runtime transport/control component.

## 1. Transport Topology Decision (Single Source of Truth)

This spec uses one network model for runtime transport:

1. **Browser -> Gateway (Hop 1):**
- Browser uses stable Gateway endpoints only:
- `WSS /v1/sessions/:sessionId/stream`
- `HTTPS /v1/sessions/:sessionId/fs/*`
- `HTTPS :previewPort-:sessionId--preview.<gateway-domain>/*` (wildcard preview host)

2. **Gateway -> Sandbox (Hop 2):**
- Gateway dials sandbox ingress via provider tunnel host.
- For E2B, host is resolved by port using `sandbox.getHost(port)`.
- Gateway signs each request with `X-Proliferate-Sandbox-Signature` (`HMAC(method + path + body_hash + exp + nonce)`).
- `sandbox-daemon` validates signature + expiry + nonce replay cache.

Important:
- This V2 transport **does not** depend on a sandbox-initiated outbound control websocket for runtime readiness.
- Readiness is based on successful signed health check over provider ingress.
- V1 runtime compute assumes E2B ingress semantics; non-E2B provider networking is future extension work.

## 2. `sandbox-daemon` Responsibilities

`/sandbox-daemon` runs as PID 1 and owns runtime transport.

Process supervision requirement:
- Sandbox runtime must correctly reap child processes and forward signals.
- Acceptable patterns:
  - `tini`/`dumb-init` as PID 1 launching `sandbox-daemon`, or
  - daemon implementation explicitly handling init-style reaping/signal duties.

### 2.1 Unified in-sandbox router (no Caddy)
`/sandbox-daemon` binds to one exposed sandbox port and routes in memory:
- `/_proliferate/pty/*` -> PTY attach/input/replay APIs
- `/_proliferate/fs/*` -> file tree/read/write APIs
- `/_proliferate/events` -> unified event stream feed
- `/*` -> dynamic reverse proxy to active preview app port

No runtime Caddyfile rewrite/reload loop in target architecture.

Preview proxy compatibility requirements:
- Daemon reverse proxy must preserve `Host` and forwarding headers needed by modern dev servers.
- Daemon reverse proxy must support HTTP upgrade and bidirectional websocket proxying for HMR (Vite/Next.js/Fast Refresh).

### 2.2 PTY replay contract
- Per-process ring buffer: max `10,000` lines OR `8MB`.
- Max line length: `16KB` (truncate over limit).
- Reconnect uses `last_seq` for delta replay.
- Cold restart resets daemon buffer; client falls back to durable DB history surfaces.

### 2.3 FS jail contract
- Workspace root is canonicalized by `realpath`.
- Reject null byte paths.
- Resolve target via workspace-relative path.
- Reject traversal (`..`) and absolute escapes.
- Re-check resolved symlink targets under workspace before read/write.
- `/fs/write` max payload: `10MB`.

### 2.4 Dynamic preview port discovery
- Preferred path: harness/runner explicitly registers preview intent with daemon (port + intent metadata).
- Fallback path: daemon polls `ss -tln` every `500ms` when explicit registration is unavailable.
- Track safe candidate ports and select active preview target with stability gating.
- Only proxy allowlisted preview port ranges by policy (default `3000-9999`).
- Never proxy denylisted infra/internal ports (`22`, `2375`, `2376`, `4096`, `26500`) even if in range.
- Emit `port_opened` only after stability window/health check to avoid short-lived test-port flicker.
- Emit `port_closed` on durable closure.
- Gateway maps preview requests by host pattern (`:previewPort-:sessionId--preview`) to target session and safe port.

### 2.5 Daemon runtime modes
- `sandbox-daemon --mode=worker`:
  - Full PTY + FS + preview port watchers + agent stream ingestion.
- `sandbox-daemon --mode=manager`:
  - Minimal transport/control mode for lean manager sandboxes.
  - No FS watcher and no preview port watcher loops by default.

## 3. Unified Event Protocol

All runtime streams are multiplexed through one versioned envelope:

```json
{
  "v": "1",
  "stream": "pty_out | fs_change | agent_event | port_opened | sys_event",
  "seq": 1045,
  "event": "data | close | error",
  "payload": { "text": "npm install complete\\n" },
  "ts": 1708123456789
}
```

Backpressure:
- Per-client queue cap in Gateway: `1000` messages OR `2MB`.
- On overflow, disconnect slow consumer (`1011`) without affecting other viewers.

Gateway horizontal scale contract:
- Separate control-plane and data-plane streaming:
  - Control-plane events (invocation status, approvals, session state) may use shared backplane.
  - Data-plane events (`pty_out` and other high-frequency runtime streams) stay on session owner gateway path.
- Multiple gateway replicas require a shared control backplane (Redis Pub/Sub or equivalent).
- Session owner gateway maintains primary daemon data stream attachment.
- Browser connections must resolve to session owner gateway (owner lookup + redirect/proxy/consistent-hash strategy).
- Sticky sessions can improve locality but are not a complete correctness mechanism.
- On owner loss, ownership transfers and new owner reattaches using replay/reconciliation contracts.

Initial hydration requirement:
- Before applying websocket deltas, UI must fetch baseline runtime state:
  - `GET /v1/sessions/:id/fs/tree`
  - `GET /v1/sessions/:id/preview/ports`
- Websocket events are deltas layered on top of this baseline.

Reconnect reconciliation requirement:
- On daemon/harness reconnect after pause/resume, runtime must fetch pending invocation outcomes from gateway (for example approvals resolved while sandbox slept).
- Resume correctness must not depend solely on in-flight websocket push events.

## 4. E2B-Specific Contracts (from docs)

### 4.1 Ingress host resolution
- E2B requires explicit port host resolution (`getHost(port)`).
- Gateway resolves host by daemon ingress port for runtime transport.
- Preview traffic is routed through daemon reverse-proxy path on the same ingress endpoint.

### 4.2 Pause/resume behavior
- `betaPause()` persists filesystem + memory state.
- Reconnect via `connect()` resumes paused sandbox.
- While paused, in-sandbox services are unreachable and client connections are dropped.
- After resume, clients must re-establish stream/proxy connections.

### 4.3 Auto-pause
- Auto-pause may be enabled for idle cost control.
- Default idle timeout for this spec pack is `10m`.
- Gateway/runtime must treat paused sandboxes as expected reconnect events, not hard failures.

## 5. Provider Contract

V1 provider contract:
- Sandbox compute provider is E2B only.

Future provider extension contract:
- Any additional provider used with this architecture must support:
- inbound HTTP/WS tunnel to sandbox daemon port,
- websocket upgrades,
- low-latency request/response for interactive transport.

- If provider cannot satisfy these transport primitives, it is out of contract.

## 6. Billing and Telemetry Intercept Requirements

Gateway is not a dumb pipe. `event-processor` must extract runtime telemetry from `agent_event` frames for UX/observability and compute lifecycle accounting.

Metering contract:
- LLM token billing truth is owned by LiteLLM spend ingestion (`15-llm-proxy-architecture.md`).
- Gateway stream frames must not be the source-of-truth for billable token usage.
- Gateway records compute lifecycle cut points and correlation metadata.

On terminal/final state, Gateway writes compute-side billing outbox/event rows for worker reconciliation.

## 7. Success Metrics (SLOs)

Measured at Gateway with OpenTelemetry, aggregated in Datadog/Prometheus (rolling 5-minute windows):

1. Attach time (`p95`) < `150ms`
2. PTY replay recovery (`p95`) < `100ms`
3. FS read roundtrip (`p95`) < `150ms`
4. FS change -> UI event delivery (`p95`) < `50ms`
5. Idle memory reduction vs old code-server baseline > `150MB`

## 8. Implementation File Map (Target-State Owners)

```text
apps/gateway/src/
  api/proliferate/ws/           # unified stream endpoint
  api/proxy/                    # fs/preview/terminal proxy surfaces
  api/proliferate/http/         # runtime reconciliation endpoints
  hub/session-runtime.ts        # runtime ensure + reconnect
  hub/event-processor.ts        # event normalization + metering intercept
  hub/backplane.ts              # cross-replica stream fanout

packages/shared/src/providers/
  e2b.ts                        # provider tunnel host resolution
  modal-libmodal.ts             # alternate provider parity

packages/sandbox-daemon/        # new daemon package (replaces sandbox-mcp)
  src/server.ts
  src/pty.ts
  src/fs.ts
  src/ports.ts
  src/router.ts
```

## 9. Core Data Model Surfaces

| Model | Why transport cares | File |
|---|---|---|
| `sessions` | runtime tunnel/daemon metadata, status, reconnect context | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | streamed approval/completion transitions | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | streamed long-running run updates | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `billing_events` | transport-level usage metering persistence | `packages/db/src/schema/billing.ts` |

---

# Source: 12-reference-index-files-and-models.md

# Reference Index: Files and Data Models

## Purpose
This index verifies that each subsystem spec maps to concrete implementation files and concrete data models.

## Shared model baseline (V1)

Core runtime entities referenced across this spec pack:
- `automations`
- `automation_runs`
- `sessions` (manager, worker, ad-hoc)
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `action_invocations`
- `triggers`, `trigger_events`
- `outbox`

## Clean-slate DB table inventory (explicit)

This section is the canonical clean-slate table inventory for V1 planning/codegen.

Auth and org:
- `users`
- `auth_sessions`
- `auth_accounts`
- `organizations`
- `organization_members`
- `organization_invitations`
- `user_access_tokens`
- `cli_device_codes`

Repo, onboarding, env:
- `repos`
- `repo_connections`
- `env_bundles`
- `env_bundle_items`
- `repo_baselines`
- `repo_baseline_targets`
- `workspace_cache_snapshots`

Integrations and tools:
- `integrations`
- `integration_credentials`
- `org_connectors`
- `org_connector_tools`

Skills and capability policy:
- `skills`
- `organization_capability_policies`
- `automation_capabilities`
- `automation_skills`

Coworkers and wakes:
- `automations`
- `automation_source_bindings`
- `automation_schedules`
- `automation_source_cursors`
- `wake_events`
- `webhook_inbox`
- `automation_runs`
- `automation_run_events`
- `automation_checkpoints`

Sessions and runtime:
- `sessions`
- `session_capabilities`
- `session_skills`
- `session_messages`
- `session_events`
- `session_checkpoints`
- `session_acl`
- `session_tool_calls`
- `session_pull_requests`
- `artifacts`

Approvals and actions:
- `action_invocations`
- `action_invocation_events`
- `resume_intents`

Notifications:
- `notifications`
- `notification_preferences`
- `session_subscriptions`
- `slack_threads`
- `outbox`

Billing:
- `billing_event_keys`
- `billing_events`
- `llm_spend_cursors`
- `billing_reconciliations`

Locked modeling assumptions:
- One persistent manager session per automation (`automations.managerSessionId` target linkage).
- One active repo baseline per repo at a time (`repo_baselines` active/version contract).
- Denied capabilities are absent from session materialization (session rows only carry allow/approval-capable bindings).
- Org visibility defaults through `sessions.visibility = 'org'`; private sharing uses `session_acl`.
- Env bundles are encrypted at rest; runtime sessions reference bundle IDs, not plaintext values.

### Clean-slate table detail (keys and invariants)

Auth and org detail:
- `users`: canonical human/operator identity.
- `auth_sessions`: login session state (`user_id`, expiry, revocation state).
- `auth_accounts`: provider account linkage (`provider`, `provider_account_id`, `user_id`) with unique `(provider, provider_account_id)`.
- `organizations`: tenancy root (`slug`, plan/billing status, security defaults).
- `organization_members`: membership and role with unique `(organization_id, user_id)`.
- `organization_invitations`: pending invite lifecycle (`email`, `role`, `expires_at`, status).
- `user_access_tokens`: personal API tokens (hashed at rest, scoped, revocable).
- `cli_device_codes`: device auth challenge rows (`user_code`, `device_code`, polling expiry/state).

Repo, onboarding, env detail:
- `repos`: org repo identity (`organization_id`, provider metadata, default branch).
- `repo_connections`: integration-installation/repo binding (`repo_id`, `integration_id`) unique per pair.
- `env_bundles`: encrypted env bundle metadata (`organization_id`, name, version, digest).
- `env_bundle_items`: encrypted key/value payload rows linked to bundle version.
- `repo_baselines`: per-repo runnable baseline (`repo_id`, status, active flag, env bundle refs, working dir, command set, preview hints).
- `repo_baseline_targets`: named monorepo target rows under baseline (`baseline_id`, `target_name`, run/test/install overrides).
- `workspace_cache_snapshots`: optional E2B cache/snapshot pointers linked to repo baseline lineage.

Integrations and tools detail:
- `integrations`: org integration records (provider install/account linkage, enabled state).
- `integration_credentials`: encrypted token material or credential pointers with rotation metadata.
- `org_connectors`: org-level MCP connector config and enable/disable status.
- `org_connector_tools`: discovered normalized tool catalog per connector with stable `tool_id` and schema metadata.

Skills and capability policy detail:
- `skills`: skill registry (`skill_key`, versioning metadata, instruction payload refs).
- `organization_capability_policies`: org default capability policy template by capability key.
- `automation_capabilities`: automation-level capability defaults (allow/approval templates only; no surfaced deny for session materialization).
- `automation_skills`: default skill attachments at automation level (`automation_id`, `skill_id`, `version`).

Coworkers and wakes detail:
- `automations`: durable coworker identity/objective with `manager_session_id` (target) and default visibility/policy.
- `automation_source_bindings`: source/provider bindings (Sentry/Linear/GitHub etc.) per automation.
- `automation_schedules`: cadence/tick config and enablement state.
- `automation_source_cursors`: per-source checkpoint cursor state for incremental polling.
- `wake_events`: normalized wake records (tick/webhook/manual) with dedupe key and processing status.
- `webhook_inbox`: raw inbound webhook payload store + normalization status.
- `automation_runs`: one row per wake, linked to automation and manager session, with run lifecycle status.
- `automation_run_events`: ordered timeline/audit events for each run.
- `automation_checkpoints`: durable per-wake summary checkpoints for manager fallback reconstruction.

Sessions and runtime detail:
- `sessions`: core execution entity (`kind`, `automation_id`, optional `automation_run_id`, `visibility`, repo/baseline linkage, compute linkage, status fields).
- `session_capabilities`: immutable session-scoped permission rows (`capability_key`, mode, scope, credential policy) unique by `(session_id, capability_key, scope_key?)`.
- `session_skills`: immutable skill bindings per session (`session_id`, `skill_id`, `version`).
- `session_messages`: queued instruction/event rows with sender/recipient direction + delivery state.
- `session_events`: durable timeline events for status/runtime transitions.
- `session_checkpoints`: resumable or summary checkpoints for continuation/recovery.
- `session_acl`: explicit access grants for private/shareable sessions (viewer/editor/reviewer roles).
- `session_tool_calls`: normalized tool-call trace rows for observability/replay.
- `session_pull_requests`: PR linkage metadata created/observed during session.
- `artifacts`: generic artifact catalog (`owner_type`, `owner_id`, `kind`, `storage_ref`, digest, retention fields).

Approvals and actions detail:
- `action_invocations`: side-effect attempts (always `session_id`; also `automation_run_id` for manager-side actions) with mode, actor, credential owner, status.
- `action_invocation_events`: append-only state transition history for each invocation.
- `resume_intents`: durable approval-resolution resume orchestration keyed uniquely by `(origin_session_id, invocation_id)`.

Notifications detail:
- `notifications`: durable user/org notification records and read state.
- `notification_preferences`: per-user/channel preference controls.
- `session_subscriptions`: session follow/subscription rows for routing updates.
- `slack_threads`: mapping between internal entities and Slack thread/channel identities.
- `outbox`: reliable async dispatch queue for notifications/webhooks/fanout side effects.

Billing detail:
- `billing_event_keys`: idempotency/dedupe keys for billing ingestion.
- `billing_events`: normalized usage ledger rows (compute/runtime + LLM usage events).
- `llm_spend_cursors`: per-org/provider sync cursors for spend ingestion.
- `billing_reconciliations`: correction/reconciliation audit records.

Policy materialization note:
- `organization_capability_policies` may include explicit `hidden` template semantics.
- Session materialization in `session_capabilities` remains allow/approval only.
- Effective hidden behavior at runtime means "no capability row materialized for this session."

### V1 decisions explicitly locked

- `action_invocations` are for side-effecting writes/destructive actions; read/query calls are traced via session tool/timeline events.
- Manager transcript continuity uses bounded compaction summaries to prevent unbounded prompt growth.
- Mid-session skill edits do not hot-inject; manager changes apply next wake, worker changes apply on new worker sessions.
- Workspace snapshot loss never blocks execution by itself; baseline + git freshness + recipes are correctness source.
- Manager is orchestration-first and does not directly execute coding tasks in V1 default policy.
- Visibility inheritance defaults from creator context and can only be narrowed within policy bounds.

## 1) System map
Spec:
- [00-system-file-tree.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/00-system-file-tree.md)

Primary files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/actions.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`

Primary models:
- `automations`, `automation_runs`, `sessions`
- `session_capabilities`, `session_skills`, `session_messages` (target)
- `action_invocations`, `outbox`

## 2) Required functionality and UX
Spec:
- [01-required-functionality-and-ux.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/01-required-functionality-and-ux.md)

Primary files:
- `/Users/pablo/proliferate/apps/web/src/server/routers/automations.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/sessions.ts`
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`

Primary models:
- `automations`, `automation_runs`, `sessions`
- `session_capabilities`, `session_skills`, `session_messages` (target)
- `action_invocations`, `outbox`

## 3) E2B interface and usage
Spec:
- [02-e2b-interface-and-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/02-e2b-interface-and-usage.md)

Primary files:
- `/Users/pablo/proliferate/packages/shared/src/providers/e2b.ts`
- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`

Primary models:
- `sessions`
- `repos`
- `repo_baselines` (target)

## 4) Actions, OAuth, MCP, org usage
Spec:
- [03-action-registry-and-org-usage.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/03-action-registry-and-org-usage.md)

Primary files:
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/integrations/tokens.ts`

Primary models:
- `action_invocations`
- `integrations`, `org_connectors`
- `sessions`, `session_capabilities` (target)

## 5) Long-running coworkers
Spec:
- [04-long-running-agents.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/04-long-running-agents.md)

Primary files:
- `/Users/pablo/proliferate/apps/worker/src/automation/index.ts`
- `/Users/pablo/proliferate/packages/services/src/runs/service.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`

Primary models:
- `automations`
- `automation_runs`
- `sessions`
- `session_messages` (target)

## 6) Trigger services
Spec:
- [05-trigger-services.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/05-trigger-services.md)

Primary models:
- `triggers`
- `trigger_events`
- `webhook_inbox`

## 7) Gateway runtime
Spec:
- [06-gateway-functionality.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/06-gateway-functionality.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `action_invocations`
- `outbox`

## 8) Cloud billing
Spec:
- [07-cloud-billing.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/07-cloud-billing.md)

Primary models:
- `billing_events`
- `sessions`

## 9) Coding harnesses
Spec:
- [08-coding-agent-harnesses.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/08-coding-agent-harnesses.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `action_invocations`

## 10) Notifications
Spec:
- [09-notifications.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/09-notifications.md)

Primary models:
- `outbox`
- `automation_runs`, `sessions`
- `session_notification_subscriptions`

## 11) Layering and mapping
Spec:
- [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)

## 12) Streaming and preview transport
Spec:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)

Primary models:
- `sessions`
- `action_invocations`
- `automation_runs`

## 13) Self-hosting and updates
Spec:
- [13-self-hosting-and-updates.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/13-self-hosting-and-updates.md)

Primary models:
- `sessions`
- `automation_runs`
- `action_invocations`
- `outbox`

## 14) Session runtime contract
Spec:
- [14-boot-snapshot-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/14-boot-snapshot-contract.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `automation_runs`
- `action_invocations`

## 15) LLM proxy architecture
Spec:
- [15-llm-proxy-architecture.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/15-llm-proxy-architecture.md)

## 16) Agent tool contract
Spec:
- [16-agent-tool-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)

Primary models:
- `sessions`
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `action_invocations`

## 17) Entity ontology and lifecycle
Spec:
- [17-entity-ontology-and-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/17-entity-ontology-and-lifecycle.md)

Primary models:
- `automations`
- `automation_runs`
- `sessions`
- `session_capabilities` (target)
- `session_skills` (target)
- `session_messages` (target)
- `action_invocations`

## 18) Repo onboarding and baseline lifecycle
Spec:
- [18-repo-onboarding-and-configuration-lifecycle.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/18-repo-onboarding-and-configuration-lifecycle.md)

Primary models:
- `repos`
- `repo_baselines` (target)
- `repo_baseline_targets` (target)
- `sessions`

## 19) Artifacts and retention
Spec:
- [19-artifacts-and-retention.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/19-artifacts-and-retention.md)

Primary models:
- `automation_runs.*ArtifactRef`
- `outbox`

## 20) Code quality contract
Spec:
- [20-code-quality-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/20-code-quality-contract.md)

## Reference quality checklist
- Every subsystem spec includes implementation file references.
- Every subsystem spec includes core data-model references.
- Clean-slate table inventory is explicitly listed in this spec.
- Session capability/skill/message model split is explicit in runtime and tool specs.
- Repo baseline model replaces `configuration*` references in onboarding/runtime docs.

---

# Source: 13-self-hosting-and-updates.md

# Self-Hosting and Update Strategy

## Goal
Define how Proliferate is deployed, upgraded, and operated outside managed cloud, without ambiguity.

This is a product requirement, not only infra detail.

Clean-slate assumption:
- This spec targets the rewrite baseline.
- No legacy cutover or backward-compatibility track is required for initial release.

## Deployment modes

### A) Managed cloud (default)
- Proliferate team operates web, gateway, worker, trigger-service, DB, and billing stack.
- Customer connects integrations and uses hosted runtime.

### B) Self-host Docker
- Customer runs platform services via Docker Compose or equivalent container runtime.
- Best for single-team/self-managed deployments.
- Sandbox compute still runs on E2B in V1.

### C) Self-host Kubernetes
- Customer deploys platform services in Kubernetes (Helm + Postgres + Redis baseline).
- Best for multi-team and stricter SRE controls.
- Sandbox compute still runs on E2B in V1.

### D) Enterprise controlled environment
- Same as self-host, with stricter network/policy constraints.
- Customer controls ingress, secrets manager, observability stack, and upgrade windows.

## V1 support matrix

Control plane hosting:

| Mode | Support status | Notes |
|---|---|---|
| Managed cloud | Supported | Default customer path |
| Self-host Docker | Supported | Fastest self-host path |
| Self-host Kubernetes | Supported | Recommended for larger orgs |

Sandbox compute provider:

| Provider | V1 status | Notes |
|---|---|---|
| E2B | Supported | Required in all deployment modes for V1 |
| Self-host Docker/Kubernetes sandbox provider | Future | Not in V1 implementation contract |
| Modal | Out of scope | Not part of this V1 spec pack |

## Implementation file tree (self-host and update surfaces)

```text
charts/proliferate/                    # Helm chart for app services
infra/pulumi-k8s/                      # AWS EKS IaC
infra/pulumi-k8s-gcp/                  # GKE IaC
packages/environment/src/schema.ts     # canonical env var schema
packages/db/drizzle/                   # DB migrations
apps/web/src/server/routers/admin.ts   # admin/update runtime controls (where applicable)
```

Operational references:
- `/Users/pablo/proliferate/docs/specs/sandbox-providers.md`
- `/Users/pablo/proliferate/docs/specs/billing-metering.md`

## Runtime architecture expectations for self-host

Required services:
- `web` (UI + API routers)
- `gateway` (runtime stream + action boundary)
- `worker` (async orchestration)
- `trigger-service` (webhook and polling ingestion)
- Postgres (durable state)
- Redis (queues/coordination where configured)
- In-house OAuth/token services (inside `web` + `packages/services/src/integrations`) for core providers

Optional/external:
- E2B provider endpoints (required for sandbox compute)
- ngrok (or equivalent public tunnel) only when needed for local dev, OAuth callback, or optional webhook ingress
- external observability stack
- customer-managed secrets manager (recommended)
- third-party OAuth brokers (not required)

## Update channels

### Application versioning
- Container images are versioned by semver tag and immutable digest.
- Helm values pin explicit image tags for each service.

### Database versioning
- All schema changes must ship as forward migrations in `packages/db/drizzle/`.
- App release notes must state required schema version and any destructive/operator-managed steps.

### Config versioning
- Env schema changes are tracked in `packages/environment/src/schema.ts`.
- Breaking env changes require startup validation errors with actionable messaging.

## Upgrade process (self-host operator runbook)

1. Preflight:
- Validate target version release notes.
- Backup Postgres and critical object storage artifacts.
- Verify secrets and env var schema requirements.

2. Schema migration:
- Apply DB migrations first.
- Confirm migration health and lock duration bounds.

3. Service rollout:
- Roll `worker` + `trigger-service` first.
- Roll `gateway` next.
- Roll `web` last.

4. Post-deploy checks:
- Session create/pause/resume smoke test.
- Action invoke/approval flow smoke test.
- Trigger ingestion and outbox dispatch smoke test.
- Billing event pipeline health check.

5. Rollback:
- Rollback app images to previous version.
- DB rollback only if release notes explicitly declare reversible migration path.

## Self-hosting support for E2B-specific patterns

V1 compute contract:
- E2B is mandatory for sandbox execution in managed and self-host control-plane deployments.

Required E2B behavior:
- Runtime uses provider host resolution per port (`getHost(port)` semantics).
- Paused sandboxes drop active network streams; gateway reconnect behavior is mandatory.
- Snapshot/pause behavior should be treated as optimization, not correctness source.

Core wake model in self-host:
- Core coworker operation does not require inbound public webhooks.
- Tick -> wake manager session -> manager inspects sources/tools -> manager decides orchestration/actions.
- Optional webhooks feed same durable trigger pipeline when enabled.

(Reference obtained from E2B docs via Context7.)

## Security requirements for self-host

- No direct browser-to-sandbox tunnel exposure.
- Gateway remains mandatory policy and auth boundary.
- Browser should never connect directly to E2B sandbox runtime.
- Secret sources should be pluggable (K8s secrets, external secret manager).
- Audit tables must remain enabled and queryable in all deployment modes.
- OAuth token lifecycle (exchange/refresh/revoke) must run within Proliferate control plane, with encrypted token storage and no broker lock-in.
- Sandbox-integrated SaaS access should primarily route through gateway-backed tools instead of unconstrained sandbox egress.

## Core data models impacted by upgrades

| Model | Upgrade sensitivity | File |
|---|---|---|
| `sessions` | runtime behavior, status transitions, reconnect behavior | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | approval and action replay correctness | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | long-running orchestration continuity | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `outbox` | delivery reliability across deploys | `packages/db/src/schema/schema.ts` (`outbox`) |
| `billing_events` | financial correctness during rollouts | `packages/db/src/schema/billing.ts` |

## Definition of done checklist
- [ ] Self-host deployment topology is documented and reproducible
- [ ] Upgrade order and rollback policy are explicitly defined
- [ ] DB upgrade contract is documented
- [ ] Health checks cover runtime, actions, triggers, and billing paths
- [ ] Security boundary remains identical in cloud and self-host modes

---

# Source: 14-boot-snapshot-contract.md

# Session Runtime Contract (Boot Snapshot Replacement)

## Goal
Replace the broad `boot_snapshot`-as-primary contract with a cleaner immutable session contract made of normalized fields and session-scoped bindings.

## Status
- Applies to: V1
- Normative: Yes

## Core decision

V1 must not rely on one giant frozen JSON payload as the primary runtime contract.

Replace broad `boot_snapshot` with:
1. Small immutable `sessions` core fields
2. `session_capabilities` rows
3. `session_skills` rows
4. `session_messages` rows
5. `automation_runs` for per-wake manager execution context

`boot_snapshot` may still exist as a compatibility/debug envelope where needed, but it is not the authoritative model boundary.

## Immutable session core fields (required)

Each session must freeze core execution identity at creation:
- session kind (`adhoc_interactive | manager | worker_child`)
- actor/run-as policy
- automation linkage (`automation_id`, optional `automation_run_id`)
- repo/branch/base-commit baseline
- env bundle references (not plaintext values)
- compute profile
- visibility mode
- model/instruction references (if pinned)

These fields are immutable for in-flight execution.

## Session capabilities contract

`session_capabilities` is authoritative for runtime permissions.

Each row defines:
- `capability_key` (for example `sentry.read`, `child.spawn`, `github.pr.create`)
- mode (`allow | require_approval`)
- credential owner policy context
- optional scope limits (repo/project/resource)
- created-at/audit metadata

Rules:
- denied capabilities do not appear in agent-visible tooling
- live security revocations still override session-bound allow/approval states
- policy checks happen at invocation time in gateway

## Session skills contract

`session_skills` stores behavior packs attached to a session.

Each row defines:
- `skill_id`
- `version`
- optional config payload

Rules:
- skills shape behavior, workflow style, and prompting
- skills never grant permissions
- permission source of truth is always `session_capabilities`

## Session messages contract

`session_messages` stores queued instructions/events.

Supported directions:
- user -> session
- manager -> child
- child -> manager

Delivery rules:
- active session: inject at next safe reasoning checkpoint
- paused/waiting session: queue and inject on resume before next reasoning step
- no arbitrary mid-command interruption in V1

## Manager run linkage

Because manager session is persistent across wakes:
- every wake creates `automation_run`
- manager-side action/timeline/audit events must attach to active `automation_run_id`
- run-level inspectability is required even when `manager_session_id` is stable

## Environment and secret boundary

Storage:
- env bundles are encrypted at rest in control plane

Runtime boot/resume:
- decrypt env bundle at boot/resume
- materialize as process environment
- optional app-scoped env file materialization if tooling requires it

Safety:
- never persist plaintext env values in session metadata
- do not expose env values in UI payloads
- do not emit env values in logs by default
- do not persist env values in artifacts by default

Secret classes:
- repo/runtime env may materialize in sandbox runtime
- integration/OAuth/action secrets remain server-side unless explicitly projected into runtime env policy

## Mutable vs immutable

Immutable for current session execution:
- session core fields listed above
- `session_capabilities` bindings
- `session_skills` bindings

Mutable during execution:
- progress/status
- action outcomes and approval states
- emitted artifacts
- transient retries/checkpoints
- queued `session_messages`

## Enforcement requirements

1. Runtime authorization executes from immutable session core + `session_capabilities`.
2. Gateway validates invocation input shape, capability binding, credential policy, and live revocation state.
3. Mid-session automation/config edits do not alter active session bindings.
4. Resume/restart must preserve session contract identity and refresh short-lived credentials dynamically.
5. Live revocations/disabled integrations/credential invalidation override frozen session bindings immediately.

## Implementation file anchors

- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`

## Core data models

| Model | Contract relevance | File |
|---|---|---|
| `sessions` | immutable session core identity and linkage | `packages/db/src/schema/sessions.ts` |
| `session_capabilities` | session-scoped permission bindings | `packages/db/src/schema/schema.ts` (target) |
| `session_skills` | session-scoped skill attachments/version pinning | `packages/db/src/schema/schema.ts` (target) |
| `session_messages` | queued inter-session/user instructions | `packages/db/src/schema/schema.ts` (target) |
| `automation_runs` | per-wake manager execution and audit grouping | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `action_invocations` | side-effect audit under session capability policy | `packages/db/src/schema/schema.ts` (`actionInvocations`) |

## Definition of done checklist
- [ ] Session contract is defined as core fields + capability/skill/message bindings
- [ ] New sessions persist immutable capability and skill bindings at creation
- [ ] Tool/action visibility excludes denied capabilities
- [ ] Manager-side actions are attributable to active `automation_run_id`
- [ ] Env handling is encrypted-at-rest and plaintext-free in metadata/log/artifact paths
- [ ] Runtime policy checks enforce live security overrides

---

# Source: 15-llm-proxy-architecture.md

# LLM Proxy Architecture (V1)

## Goal
Define a stable, production-safe LLM proxy architecture for V1 that matches the existing Proliferate LiteLLM pattern:
- short-lived virtual keys for sandbox traffic
- server-side control-plane key management
- durable spend ingestion into billing events
- model routing alignment with OpenCode/runtime config

This spec intentionally follows the old/current architecture rather than inventing a new proxy stack.

## Scope
In scope:
- Session virtual key generation/revocation flow
- Team/org mapping in proxy
- Sandbox URL/key injection contract
- Spend sync contract and cursor semantics
- Model routing contract (canonical model -> proxy model mapping)
- Self-host deployment expectations for proxy

Out of scope:
- Pricing strategy and credit policy details (see `07-cloud-billing.md`)
- Session lifecycle orchestration beyond env/key contract
- Secret storage internals outside referenced services

## High-level architecture (existing pattern)

```text
Sandbox/OpenCode --(virtual key + base URL)--> LiteLLM Proxy --> Provider APIs
       ^                                              |
       |                                              v
Gateway/Services --(master key admin APIs)--> key/team mgmt + spend logs
```

Control-plane plane:
- Uses proxy admin endpoints with master key
- Creates team if needed
- Mints short-lived session key
- Reads spend logs for billing sync

Sandbox data plane:
- Uses only session virtual key
- Never receives proxy master key
- Sends model requests through proxy base URL

## File tree and ownership

```text
apps/llm-proxy/
  litellm/config.yaml                # model/provider routing config
  Dockerfile                         # proxy image build
  README.md                          # runtime/deploy notes

packages/shared/src/
  llm-proxy.ts                       # key generation, team ensure, URL helpers, revoke

packages/services/src/sessions/
  sandbox-env.ts                     # sandbox env assembly, proxy key injection

packages/services/src/billing/
  litellm-api.ts                     # spend/logs REST client
  db.ts                              # llm spend cursor persistence

apps/worker/src/jobs/billing/
  llm-sync-dispatcher.job.ts         # org fanout
  llm-sync-org.job.ts                # per-org spend ingestion
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `llm_spend_cursors` | Per-org incremental spend cursor | `packages/db/src/schema/billing.ts` |
| `billing_events` | Durable billable usage entries | `packages/db/src/schema/billing.ts` |
| `sessions` | Session identity for key scoping/audit linkage | `packages/db/src/schema/sessions.ts` |
| `organization` | Team/org identity and billing state | `packages/db/src/schema/schema.ts` |

## Runtime contract

### 1) Session key generation
When runtime boots or resumes:
1. Ensure proxy team exists for org (`team_id = organizationId`)
2. Generate fresh short-lived virtual key (`user_id = sessionId`, alias bound to session)
3. Inject proxy base URL + virtual key into sandbox runtime env
4. Attach synchronous budget/rate limits to virtual key (org/session policy)

Rules:
- Duration defaults from `LLM_PROXY_KEY_DURATION` (or sensible default)
- Replace/revoke prior alias key for same session when regenerating (boot or resume)
- Fail fast if proxy is required and key generation fails
- Key-level budget/rate limits must be set at issuance time for real-time enforcement (not only async billing)
- Expired virtual keys must never be revived from persisted snapshot/env state.

### 2) Sandbox env injection
Preferred secure mode:
- `sandbox-daemon` receives session virtual key in daemon-only secret context.
- Daemon exposes local loopback proxy endpoint (for example `127.0.0.1:<port>`) for harness model traffic.
- Harness points `ANTHROPIC_BASE_URL` at local daemon proxy endpoint.
- Harness uses non-sensitive placeholder api key value; real virtual key is attached by daemon when forwarding to LiteLLM.

Direct env mode (simple, less hardened):
- Sandbox process receives `ANTHROPIC_API_KEY` (virtual key) and `ANTHROPIC_BASE_URL` directly.
- Allowed for controlled environments, but not preferred for hardened environments.

Sandbox must not receive:
- `LLM_PROXY_MASTER_KEY`
- raw provider long-lived keys when proxy mode is enabled

### 3) Revocation behavior
On pause/termination/enforcement:
- revoke session alias key best-effort
- revocation failure should not block lifecycle transitions

Resume behavior:
- On resume, runtime must request a newly valid session virtual key before first model call.
- `401/invalid_key` from proxy should trigger one controlled refresh path before surfacing hard failure.

### 4) Spend ingestion
Worker pipeline:
1. Dispatcher enqueues org sync jobs
2. Per-org job calls proxy spend logs API (bounded window)
3. Convert rows to idempotent billing events
4. Advance org cursor deterministically

Idempotency:
- use provider request identifiers for dedupe keying (`llm:{request_id}` pattern)
- cursor progression alone is not the sole dedupe guarantee

Billing source-of-truth rule:
- LiteLLM spend ingestion is the sole source-of-truth for billable LLM token usage.
- Gateway runtime stream telemetry may provide realtime usage hints for UX, but must not be used as authoritative token billing.

Real-time budget enforcement rule:
- Async spend ingestion is ledger truth, but budget blocking must occur synchronously in proxy/key enforcement path.
- When key budget is exhausted, proxy rejects requests immediately (for example 429/policy denial).
- Runtime must treat budget-denied responses as terminal or pause-worthy policy events, not transient transport errors.

## URL and environment contract

Required env:
- `LLM_PROXY_URL`
- `LLM_PROXY_MASTER_KEY`

Optional env:
- `LLM_PROXY_PUBLIC_URL` (sandbox-facing URL override)
- `LLM_PROXY_ADMIN_URL` (admin API override)
- `LLM_PROXY_KEY_DURATION`
- `LLM_PROXY_REQUIRED`

URL rules:
- admin calls use admin URL role
- sandbox base URL uses public URL role
- normalize base URL to single `/v1` suffix for consistent SDK/runtime behavior

## Model routing contract

Three surfaces must stay aligned:
1. Canonical model IDs in shared model catalog
2. OpenCode/provider config generated for sandbox runtime
3. LiteLLM model mapping in `apps/llm-proxy/litellm/config.yaml`

Any model add/change must update all three surfaces in one change.

## Security invariants

- Master key is server-side only.
- Sandbox uses short-lived virtual keys only, preferably via daemon-local proxy indirection.
- Proxy key generation and spend reads are audited and attributable to org/session context.
- No browser client can call proxy admin endpoints directly.
- Budget/rate policy must be enforced at proxy ingress for each virtual key.

## Self-hosting expectations

For self-host customers:
- proxy can run as a separate service/container
- operator supplies provider API keys and proxy master key
- app services use configured proxy admin/public URLs
- billing worker can reach spend logs endpoint

This keeps cloud and self-host behavior aligned with one architecture.

## Definition of done checklist

- [ ] Session startup mints short-lived proxy key and injects sandbox env correctly
- [ ] Proxy master key is never exposed to sandbox/runtime logs
- [ ] Spend sync writes idempotent `billing_events` and advances per-org cursor
- [ ] URL roles (admin/public) are respected and `/v1` normalization is consistent
- [ ] Model routing remains aligned across shared catalog, runtime config, and LiteLLM config
- [ ] Self-host operator has clear required env and deploy contract

---

# Source: 20-code-quality-contract.md

# Code Quality Contract - System Spec

## 1. Purpose

Define a clean, principle-first quality contract for migration and new code.

Primary rule:
- If you touch a file, leave it better than before, or at minimum not worse.

Primary goal:
- Prevent duplicated logic and disorganized code so migration work does not create rewrite debt later.

---

## 2. Scope

### In scope
- Code organization rules (where code belongs).
- Touched-file quality ratchet.
- Duplication prevention rules.
- CI and exception protocol.

### Out of scope
- Product behavior and runtime architecture (owned by subsystem specs).
- UI design system details.

---

## 3. Core Principles

1. **Clear placement before coding**
	- Decide the owning layer/module before adding logic.
2. **One responsibility per file**
	- Keep transport, orchestration, and persistence separated.
3. **No new duplication**
	- Reuse shared helpers; do not copy logic across providers/routes.
4. **Touched files improve or hold**
	- Legacy debt can exist; touched code must not regress.
5. **Prefer extraction over growth**
	- When a file is hard to reason about, extract coherent modules.

---

## 4. Code Organization Rules (Normative)

### 4.1 Backend layering
1. Routers/route handlers must stay transport adapters.
2. Business orchestration/policy lives in `packages/services/src/**/service.ts`.
3. Persistence mechanics live in `packages/services/src/**/db.ts` (or `*-db.ts`).
4. Code outside allowed packages must not import `@proliferate/db` directly.
5. New direct DB writes in `service.ts` must not be introduced.

### 4.2 Shared logic and duplication prevention
1. Shared pure helpers/types belong in `packages/shared`.
2. Shared backend/business helpers belong in `packages/services`.
3. Web-only helpers stay in `apps/web/src/lib`.
4. Duplicate implementations of the same primitive in touched code are not allowed.
5. Security-sensitive primitives (for example signature/hash verification) must use one shared implementation per pattern.

### 4.3 Frontend placement rules
1. Data fetching in components should use project data-layer patterns (oRPC/TanStack Query), not ad-hoc raw API calls.
2. Hooks should be explicit, reusable, and use kebab-case filenames (for example `use-repos.ts`).
3. Avoid adding business logic directly in route/page components when it can live in services or shared modules.

### 4.4 Tests for changed logic
1. Touched business logic (`service.ts`, `db.ts`, provider lifecycle code) must include updated or new tests, or a time-boxed exception.
2. Bug fixes must include regression coverage unless impossible (then exception required).

---

## 5. Touched-File Ratchet

For each touched file:
1. No new violations on zero-tolerance gates.
2. No regression on baselined gates.
3. Avoid net complexity growth when simple extraction is possible.
4. No new duplicated helper patterns.

Recommended:
- If a high-debt file is touched, reduce at least one clear local debt item (extract helper/module, remove duplication, simplify branching).

---

## 6. CI Enforcement

### 6.1 Active blocking gates
- `lint:no-direct-db-import`
- `lint:no-raw-api-fetch`
- `lint:db-boundary`
- `biome check .`

### 6.2 Baseline model
- Baselines are temporary debt ledgers, not permission to add debt.
- Existing baseline:
	- `scripts/db-boundary-baseline.json`
- Baseline increases require an approved exception.

### 6.3 Planned quality gates
- Duplicate helper/signature detection.
- Touched-file organization/placement checks (where practical).
- Additional complexity checks where tooling is stable.

---

## 7. Exceptions (Time-Boxed)

Allowed only for temporary, justified cases (for example critical incident fixes or unsafe decomposition windows).

Required fields:
- `reason`
- `owner`
- `expiresOn` (YYYY-MM-DD)
- `followUpTicket`
- `scope` (file/rule waived)

Storage:
- Human-readable: `docs/code-quality-exceptions.md`
- Machine-readable: `scripts/code-quality-exceptions.json`

Expiry:
- Expired exceptions fail CI.
- Renewals require explicit reviewer re-approval.

---

## 8. Status

| Feature | Status | Evidence |
|---|---|---|
| No direct DB imports outside allowed packages | Implemented | `scripts/check-no-direct-db-import.mjs` |
| No raw `fetch('/api/...')` in web source | Implemented | `scripts/check-no-raw-api-fetch.mjs` |
| DB-boundary baseline for `packages/services` | Implemented | `scripts/check-db-boundary.mjs`, `scripts/db-boundary-baseline.json` |
| Touched-file ratchet | Partial | Baseline ratchet exists; broaden enforcement over time |
| Duplicate helper/signature detection | Planned | Add dedicated lint gate |
| Organization-first placement checks | Planned | Add targeted checks where tooling is reliable |

---

## 9. Acceptance Checklist

- [ ] Contract is principle-first and easy to apply during reviews.
- [ ] Layer placement rules are explicit and consistent.
- [ ] Anti-duplication rules are explicit and enforced over time.
- [ ] Existing blocking gates remain active.
- [ ] Exception protocol is enforceable (including expiry).
# Code Quality Contract - System Spec

## 1. Purpose

This spec defines the minimum code-quality contract for migration work.

Primary rule:
- If you touch a file, leave it better than before, or at minimum not worse.

Why this exists:
- Keep migration velocity high without allowing quality regressions.
- Make quality expectations objective and CI-enforceable.

---

## 2. Scope

### In scope
- Touched-file ratchet policy.
- Layer boundary rules (router/service/db).
- CI quality gates and baselines.
- Time-boxed exceptions.

### Out of scope
- Product architecture and runtime behavior (owned by subsystem specs).
- UI design guidance.

---

## 3. Normative Rules (MUST)

### 3.1 Layer boundaries
1. Route handlers/routers are transport adapters only.
2. Business logic lives in `packages/services/src/**/service.ts`.
3. Persistence logic lives in `packages/services/src/**/db.ts` (or `*-db.ts`).
4. Code outside allowed packages must not import `@proliferate/db` directly.
5. New direct DB writes in `service.ts` must not be introduced.

### 3.2 Touched-file ratchet
For each touched file:
1. No new violations on zero-tolerance gates.
2. No regression on baselined gates (count must not exceed baseline).
3. If file is above target size, line count must not increase.
4. If file is above hard ceiling, line count must decrease unless exception approved.
5. No new duplicated crypto/signature helper implementations.

### 3.3 Size and complexity thresholds

| Layer | Target | Hard ceiling (exception required) |
|---|---:|---:|
| Web/gateway routers | 350 | 600 |
| `service.ts` | 400 | 650 |
| `db.ts` | 300 | 500 |
| Provider modules | 450 | 800 |
| UI components | 300 | 500 |

Function thresholds:
- Target max function length: 60 lines.
- Hard ceiling: 120 lines (exception required).
- Cyclomatic complexity target: 10.
- Hard ceiling: 15 (exception required).

### 3.4 Tests on changed logic
- Touched business logic (`service.ts`, `db.ts`, provider lifecycle code) must include updated or new tests.
- Bug fixes must include regression tests unless exception-approved.

---

## 4. CI Enforcement

### 4.1 Blocking today
- `lint:no-direct-db-import`
- `lint:no-raw-api-fetch`
- `lint:db-boundary`
- `biome check .`

### 4.2 Required gates for full contract
- `lint:file-size` (touched files vs thresholds)
- `lint:function-size` (touched functions vs length limits)
- `lint:complexity` (touched code vs complexity limits)
- `lint:no-duplicate-signature-helpers`

### 4.3 Baselines
Baselines are temporary debt ledgers, not permission to add debt.

Existing:
- `scripts/db-boundary-baseline.json`

Planned:
- `scripts/file-size-baseline.json`
- `scripts/function-complexity-baseline.json`

Rules:
- Baselines are file-scoped and count-based.
- Raising baseline counts requires an approved exception.

---

## 5. Exceptions (Time-Boxed)

Exceptions are allowed only for temporary, justified cases (for example critical incident fixes or unsafe decomposition windows).

Required fields:
- `reason`
- `owner`
- `expiresOn` (YYYY-MM-DD)
- `followUpTicket`
- `scope` (file/rule waived)

Storage:
- Human-readable: `docs/code-quality-exceptions.md`
- Machine-readable: `scripts/code-quality-exceptions.json`

Expiry:
- Expired exceptions fail CI.
- Renewal requires explicit reviewer re-approval.
---

## 6. Status

| Feature | Status | Evidence |
|---|---|---|
| No direct DB imports outside allowed packages | Implemented | `scripts/check-no-direct-db-import.mjs` |
| No raw `fetch('/api/...')` in web source | Implemented | `scripts/check-no-raw-api-fetch.mjs` |
| DB-boundary baseline for `packages/services` | Implemented | `scripts/check-db-boundary.mjs`, `scripts/db-boundary-baseline.json` |
| Touched-file ratchet (repo-wide) | Partial | DB-boundary ratchet exists; expand via §4.2 |
| File length/complexity gates by layer | Planned | Add scripts + CI wiring in §4.2 |
| Duplicate signature helper detection | Planned | Add gate in §4.2 |

---

## 7. Acceptance Checklist

- [ ] Contract is principle-first and CI-enforceable.
- [ ] Existing blocking gates remain active.
- [ ] New touched-file gates are implemented and rolled out.
- [ ] Exception protocol is enforced (including expiry).
- [ ] `AGENTS.md`, `CLAUDE.md`, and PR template reference this contract.
# Code Quality Contract - System Spec

## 1. Scope & Purpose

### In Scope
- Repository-wide code quality standards for migration and new development.
- Enforceable boundaries between router/service/db layers.
- Touched-file ratchet policy ("no net quality debt" on changed code).
- CI gate definitions for lint/boundary/size/complexity/test requirements.
- Exception protocol for temporary rule breaks.

### Out of Scope
- Product/runtime architecture decisions (owned by subsystem specs).
- UI design guidelines.
- Team staffing/process norms outside code quality enforcement.

### Feature Status

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| No direct DB imports outside allowed packages | Implemented | `scripts/check-no-direct-db-import.mjs`, `package.json:lint:no-direct-db-import` | Blocking in `pnpm lint` |
| No raw `fetch('/api/...')` in web source | Implemented | `scripts/check-no-raw-api-fetch.mjs`, `package.json:lint:no-raw-api-fetch` | Blocking in `pnpm lint` |
| DB-boundary baseline for `packages/services` | Implemented | `scripts/check-db-boundary.mjs`, `scripts/db-boundary-baseline.json`, `package.json:lint:db-boundary` | Baseline ratchet exists today |
| Migration touched-file ratchet (repo-wide) | Partial | Existing DB-boundary ratchet only | Expanded contract defined in this spec |
| File length/complexity CI gates by layer | Planned | This spec §6.2, §6.6 | Add scripts + CI jobs |
| Duplicate signature/crypto helper detection | Planned | This spec §6.3, §6.6 | Add duplication gate |

### Purpose
This contract defines minimum quality guarantees during rewrite/migration.  
Primary rule: **any file touched in a PR must be equal or better quality than before**, unless a documented exception is approved.

---

## 2. Core Concepts

### 2.1 Quality Contract
Quality is not advisory. Rules in this document use:
- **MUST / MUST NOT**: hard requirements.
- **SHOULD / SHOULD NOT**: strong default; exceptions allowed with justification.

### 2.2 Touched-File Ratchet
Principle: if a PR edits file `F`, treat `F` as potentially carrying quality debt and leave it better than before (or at minimum not worse).

Enforcement: PR quality checks evaluate `F` against this contract and baseline.
- Existing debt in untouched files is tolerated short-term.
- New or increased debt in touched files is not tolerated.

### 2.3 Debt Baseline
A baseline file records known violations that are temporarily tolerated.
- Example existing baseline: `scripts/db-boundary-baseline.json`.
- Baselines are debt ledgers, not permission to add debt.

### 2.4 Exception Record
Temporary waivers are allowed only with:
- explicit owner,
- explicit expiry date,
- follow-up ticket,
- reviewer approval.

---

## 3. Ownership and Enforcement Surfaces

### 3.1 Core files
- CI workflow: `/Users/pablo/proliferate/.github/workflows/ci.yml`
- Lint entrypoint: `/Users/pablo/proliferate/package.json` (`lint`, `typecheck`, `test`)
- Current quality scripts:
  - `/Users/pablo/proliferate/scripts/check-no-direct-db-import.mjs`
  - `/Users/pablo/proliferate/scripts/check-no-raw-api-fetch.mjs`
  - `/Users/pablo/proliferate/scripts/check-db-boundary.mjs`
  - `/Users/pablo/proliferate/scripts/db-boundary-baseline.json`
- Agent instructions:
  - `/Users/pablo/proliferate/AGENTS.md`
  - `/Users/pablo/proliferate/CLAUDE.md`
- PR policy:
  - `/Users/pablo/proliferate/.github/PULL_REQUEST_TEMPLATE.md`

### 3.2 Ownership
- Platform/infra maintainers own CI gates and baseline files.
- Domain teams own remediation of touched-file violations in their areas.

---

## 4. Quality Targets (Normative)

### 4.1 Layering invariants
1. Routers/route handlers **MUST** be transport adapters only.
2. Business orchestration/policy **MUST** live in `packages/services/src/**/service.ts`.
3. Persistence mechanics **MUST** live in `packages/services/src/**/db.ts` (or `*-db.ts`).
4. Code outside allowed packages **MUST NOT** import `@proliferate/db` directly.
5. New direct DB writes in `service.ts` **MUST NOT** be introduced.

### 4.2 Size thresholds (touched-file policy)
For touched files:

| Layer | Target | Hard ceiling without exception |
|---|---:|---:|
| Web/gateway routers | 350 lines | 600 lines |
| `service.ts` | 400 lines | 650 lines |
| `db.ts` | 300 lines | 500 lines |
| Provider modules | 450 lines | 800 lines |
| UI components | 300 lines | 500 lines |

Rules:
- New files **MUST** meet target.
- Touched legacy files above target **MUST NOT** grow in size.
- Touched files above hard ceiling **MUST** be reduced or carry approved exception.

### 4.3 Function complexity thresholds (touched-file policy)
- Target max function length: 60 lines.
- Hard ceiling without exception: 120 lines.
- Cyclomatic complexity target: 10.
- Hard ceiling without exception: 15.

If complexity tooling is unavailable for a given package today, function-length checks still apply and complexity gate is introduced as planned in §6.6.

### 4.4 Duplication and security invariants
1. Crypto/signature primitives (`HMAC`, hash verify helpers) **MUST** have one shared implementation per pattern.
2. Provider-specific wrappers **SHOULD** call shared helpers, not reimplement primitives.
3. Duplicate implementations **MUST NOT** be added in touched code.

### 4.5 Test invariants for changed logic
- Touched business logic files (`service.ts`, `db.ts`, provider lifecycle logic) **MUST** include:
  - updated existing tests, or
  - new tests covering changed behavior, or
  - explicit exception record.
- Bug fixes **MUST** include regression test coverage unless impossible (then exception required).

---

## 5. Touched-File Ratchet Rules

### 5.1 Definition of touched file
A touched file is any tracked source file changed in the PR diff:
- `apps/**`
- `packages/**`
- `scripts/**` (for quality gates)

### 5.2 Ratchet policy
For each touched file:
1. **No new violations**: any gate with zero baseline tolerance must remain zero.
2. **No regression**: for baselined gates, count must not exceed baseline.
3. **Improve-or-hold floor**: if immediate improvement is not practical in this PR, the file MUST at least not regress.
4. **Size ratchet**:
  - if file is above target, line count must not increase.
  - if file is above hard ceiling, line count must decrease unless exception approved.
5. **Duplication ratchet**: no new duplicated crypto/signature helpers.

### 5.3 Debt reduction bonus rule (recommended)
When touching a high-debt file (> hard ceiling), PR **SHOULD** reduce file size by at least 5% or extract one coherent module.

---

## 6. CI Enforcement Plan

### 6.1 Existing blocking gates (already active)
- `pnpm lint` executes:
  - `turbo run lint`
  - `biome check .`
  - `lint:no-raw-api-fetch`
  - `lint:no-direct-db-import`
  - `lint:db-boundary`

### 6.2 Required new gates
Add scripts (or equivalent checks) and wire into `pnpm lint` / CI:
1. `lint:file-size`:
  - evaluates touched files against §4.2 thresholds.
2. `lint:function-size`:
  - evaluates touched functions against §4.3 length limits.
3. `lint:complexity`:
  - evaluates touched files against §4.3 complexity limits.
4. `lint:no-duplicate-signature-helpers`:
  - prevents new duplicated `hmacSha256`/signature primitives.

### 6.3 Baseline files
Use baseline files for legacy debt where needed:
- `scripts/db-boundary-baseline.json` (existing)
- `scripts/file-size-baseline.json` (new)
- `scripts/function-complexity-baseline.json` (new, if needed)

Baseline rules:
- Baseline entries **MUST** be count-based and file-scoped.
- Raising baseline counts in PR **MUST NOT** happen without exception.

### 6.4 CI failure policy
- Any blocking gate failure fails PR.
- Exception-approved violations are validated against allowlist file (see §7).
- Warning-only phase allowed during rollout (see §8), then blocking.

### 6.5 Minimum PR verification for touched backend code
For PRs touching backend logic (`apps/gateway`, `apps/worker`, `packages/services`, providers):
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (or package-scoped test command with rationale)

---

## 7. Exception Protocol (Time-Boxed)

### 7.1 Allowed exception cases
- Critical production fix where immediate decomposition is unsafe.
- Large migration slice where split must occur in follow-up PR.
- External API/regression constraints requiring temporary complexity.

### 7.2 Required exception payload
Every exception **MUST** include:
- `reason`
- `owner`
- `expiresOn` (YYYY-MM-DD)
- `followUpTicket`
- `scope` (files/rules waived)

### 7.3 Storage
- Exception records **SHOULD** be stored in:
  - `docs/code-quality-exceptions.md` (human-readable)
  - `scripts/code-quality-exceptions.json` (machine-readable)

### 7.4 Expiry behavior
- Expired exceptions fail CI.
- Renewals require explicit reviewer re-approval and new expiry.

---

## 8. Rollout Plan

### Phase 0 (immediate)
- Adopt this spec.
- Continue existing blocking gates.

### Phase 1 (week 1)
- Introduce new gates in warning mode (`file-size`, `function-size`, `duplicate-signature`).
- Populate initial baselines for legacy hotspots.

### Phase 2 (week 2)
- Switch touched-file gates to blocking mode.
- Enforce exception protocol in PR template.

### Phase 3 (week 3+)
- Enable complexity blocking.
- Tighten thresholds gradually in high-churn domains.

---

## 9. Known Limitations & Tech Debt

1. Current enforcement is strong for DB-boundary and direct import misuse, but weak for file size/complexity until new gates land.
2. Some large legacy files already exceed targets (routers/providers); ratchet policy prevents regression while migration decomposes them.
3. Complexity tooling may vary across packages; temporary fallback is function-length checks.
4. Duplicate signature helper detection is currently manual; automated gate is required.

---

## Acceptance Checklist

- [ ] Spec exists and is referenced by quality/migration work
- [ ] Existing gates remain blocking in CI
- [ ] New touched-file gates are implemented and phased in
- [ ] Exception protocol is documented and enforceable
- [ ] `AGENTS.md`, `CLAUDE.md`, and PR template reference this contract
