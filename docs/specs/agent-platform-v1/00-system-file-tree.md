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
