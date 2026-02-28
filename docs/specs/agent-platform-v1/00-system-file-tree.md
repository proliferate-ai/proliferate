# System File Tree (V1)

This is the practical code map for the V1 agent platform.

## Top-level runtime systems
```text
/apps
  /web                 # Product UI + oRPC routes (metadata CRUD)
  /gateway             # Real-time runtime bus + action execution boundary
  /llm-proxy           # LiteLLM proxy service (virtual keys + provider routing)
  /worker              # Background jobs and orchestration
  /trigger-service     # Webhook ingestion and trigger processing

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
  billing.ts
  integrations.ts
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
    migration-controller.ts
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
  finalizer.ts
```

### 5) Policies, actions, credentials
```text
/packages/services/src
  /actions
    service.ts
    modes.ts
    modes-db.ts
    connectors/
  /integrations
    service.ts
    db.ts
    tokens.ts
  /notifications
    service.ts
    db.ts
  /outbox
    service.ts
```

### 6) Sandbox provider (E2B now)
```text
/packages/shared/src/providers
  e2b.ts               # V1 execution provider
  index.ts             # provider factory

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
  integrations.ts
  relations.ts
/packages/db/drizzle
  *.sql
```

## Planned additions for this spec pack
These are expected near-term additions, still inside existing structure:
```text
/ packages/services/src/credentials
  broker.ts
  access.ts
  types.ts
  providers/
```

## Rules for file ownership
- DB read/write logic belongs in `packages/services/src/**/db.ts`
- Gateway should call services, not raw DB SQL
- Web routers are thin wrappers around services/gateway clients
- Trigger-service should ingest and enqueue, not execute agent work inline
- Route handlers must not import Drizzle schema/client directly
- Mapping logic belongs in mapper modules, not routers

See: [10-layering-and-mapping-rules.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/10-layering-and-mapping-rules.md)

## Feature-to-system ownership map

| Product capability | Primary runtime owner | Primary files |
|---|---|---|
| Coworker creation/editing | Web + Services | `apps/web/src/server/routers/automations.ts`, `packages/services/src/automations/service.ts` |
| Long-running execution | Worker + Services | `apps/worker/src/automation/*`, `packages/services/src/runs/service.ts` |
| Trigger ingestion (webhook/polling) | Trigger-service | `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/polling/worker.ts` |
| Coding sessions + live runtime | Gateway + Providers | `apps/gateway/src/hub/session-runtime.ts`, `packages/shared/src/providers/e2b.ts` |
| Actions/approvals | Gateway + Actions service | `apps/gateway/src/api/proliferate/http/actions.ts`, `packages/services/src/actions/service.ts` |
| Integrations (OAuth + connectors) | Web + Integrations/Connectors services | `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/connectors/service.ts` |
| Notifications | Worker + Notifications service | `apps/worker/src/automation/notifications.ts`, `packages/services/src/notifications/service.ts` |
| Billing/metering | Web + Worker + Billing service | `apps/web/src/server/routers/billing.ts`, `apps/worker/src/billing/*`, `packages/services/src/billing/*` |
| LLM proxy runtime + key mgmt | LLM Proxy + Shared + Billing worker | `apps/llm-proxy/*`, `packages/shared/src/llm-proxy.ts`, `apps/worker/src/jobs/billing/llm-sync-*` |

## Core data model map (minimum to understand system behavior)

| Table/model | Purpose | Schema file |
|---|---|---|
| `sessions` | Runtime session state for coding/setup/automation-linked work | `packages/db/src/schema/sessions.ts` |
| `automations` | Long-running coworker definitions, prompts, notification destination | `packages/db/src/schema/automations.ts` |
| `triggers`, `trigger_events` | Trigger definitions + durable trigger event pipeline | `packages/db/src/schema/triggers.ts` |
| `integrations`, `repo_connections` | OAuth/GitHub-App integration records and repo bindings | `packages/db/src/schema/integrations.ts` |
| `action_invocations` | Side-effect execution audit and approval state | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `org_connectors` | Org-scoped MCP connector catalog/config | `packages/db/src/schema/schema.ts` (`orgConnectors`) |
| `outbox` | Durable async dispatch queue for notifications/side effects | `packages/db/src/schema/schema.ts` (`outbox`) |
| `session_notification_subscriptions` | Per-session notification preferences and delivery state | `packages/db/src/schema/slack.ts` |
| `billing_events`, `billing_reconciliations` | Usage ledger + billing correction trail | `packages/db/src/schema/billing.ts` |

## Engineering guardrails (general best practices)

### File size limits (targets, not hard compiler limits)
- Service files (`service.ts`, `db.ts`, routers): target under 400 lines
- Gateway hub/runtime files: target under 500 lines
- UI components: target under 300 lines
- Specs/docs: target under 500 lines each
- If a file crosses limits, split by subdomain before adding new features

### Function and module boundaries
- Prefer small single-purpose functions (target under 60 lines)
- Keep request parsing, business logic, and persistence separated
- Keep provider SDK calls behind provider/broker adapters

### Naming and structure
- Use explicit names (`runAs`, `credentialOwnerType`, `bootSnapshot`)
- Keep one module per domain responsibility (actions, credentials, notifications, etc.)
- Put shared contracts in `packages/shared/src/contracts`

### Reliability defaults
- DB-first for lists/inbox dashboards; stream only for live detail
- Use idempotency keys for side-effecting actions
- Use outbox pattern for async delivery and retries
- Persist status transitions instead of in-memory-only state

### Security defaults
- No privileged long-lived tokens in sandbox by default
- Short-lived repo-scoped git auth is allowed for sandbox coding sessions
- Gateway is the only side-effect execution boundary
- Run policy checks before token resolution and execution
- Log actor + run-as + credential owner on every invocation
