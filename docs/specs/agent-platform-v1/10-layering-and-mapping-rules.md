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
