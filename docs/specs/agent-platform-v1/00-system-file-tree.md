# System File Tree (V1)

This is the practical code map for the V1 agent platform.

## Top-level runtime systems
```text
/apps
  /web                 # Product UI + oRPC routes (metadata CRUD)
  /gateway             # Real-time runtime bus + action execution boundary
  /worker              # Background jobs and orchestration
  /trigger-service     # Webhook ingestion and trigger processing

/packages
  /db                  # Schema and migrations
  /services            # Business logic + DB operations
  /shared              # Contracts, sandbox provider impls, opencode tooling
  /triggers            # Trigger provider registry + adapters
  /queue               # Queue wrappers/locking
  /gateway-clients     # Client libs used by web/worker
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
