# Services Package Rules

These rules apply to everything under `/Users/pablo/proliferate/packages/services`.

## Core Boundary

- `packages/services` owns business logic.
- It is the domain and orchestration layer.
- It owns:
	- business workflows
	- policy checks
	- orchestration across DB calls
	- domain-side side effects
	- typed domain errors
- It does **not** own:
	- transport concerns
	- UI concerns
	- route wiring
	- request parsing
	- response shaping for oRPC or HTTP
	- shared contract/schema ownership

- `packages/services` must never depend on transport layers.
- Do not import from:
	- `apps/backend/**`
	- `apps/web/**`
	- route handlers
	- middleware

## Domain File Roles

### `src/<domain>/service.ts`

- `service.ts` is the main business-logic entrypoint for a domain.
- It owns:
	- orchestration
	- policy branching
	- side effects
	- provider calls
	- retries and idempotency decisions
	- composition of multiple DB operations
- Service methods should expose explicit, readable inputs and outputs.
- Service methods should throw typed domain errors when something goes wrong.

- `service.ts` must not:
	- read request objects
	- throw `ORPCError`
	- define router behavior
	- import from app-layer route code
	- contain UI concerns

### `src/<domain>/db.ts`

- `db.ts` owns database reads and writes only.
- Keep queries focused and composable.
- `db.ts` may define local query-result types and row-shape interfaces if they are only used there.

- `db.ts` must not:
	- contain business workflows
	- perform policy branching
	- call external providers
	- import app-layer modules
	- contain transport logic

### `src/<domain>/errors.ts`

- Use `errors.ts` when multiple files in a domain share the same domain error types.
- Domain errors belong in the owning domain.
- Routers map these errors to transport errors.

- Do not define domain/business error classes in routers.

### `src/<domain>/types.ts`

- `types.ts` is for TypeScript-only domain types shared across files in a domain.
- Use it for:
	- shared domain DTOs
	- reusable TypeScript-only shapes
	- shared row/result types if they are used across more than one file

- `types.ts` is not for runtime validation schemas.

### `src/<domain>/mappers.ts`

- `mappers.ts` is optional.
- Add it only when there is real translation logic between layers, for example:
	- DB row -> domain model
	- provider payload -> domain model
	- persisted shape -> service return shape

- Do not create mapper files for trivial one-line property copies.
- Keep tiny one-off mappings local when that is clearer.
- Mapper files must not contain business logic or transport logic.

## Imports

- Prefer direct imports.
- Do not reintroduce root barrels or shim files.
- Import from the actual source module or explicit package subpath directly.

- Services may import:
	- `@proliferate/db`
	- `@proliferate/db/schema`
	- `@proliferate/logger`
	- other service-domain modules when there is a real domain dependency

- Be careful with service-to-service imports.
- Do not create a tangled graph of circular orchestration across domains.
- If a workflow spans multiple domains and becomes large, extract a clearer orchestration point instead of burying it in `db.ts`.

## Database Access

- Inside `packages/services`, import DB helpers directly from:
	- `@proliferate/db`
	- `@proliferate/db/schema`
- Do not add local DB shim wrappers.
- Do not re-export DB clients from `services`.
- The services package is the only place that should directly use DB access in normal app code.

## Errors

- Services throw typed domain errors.
- Services do not throw transport-specific errors.
- Services do not throw `ORPCError`.
- Services must not parse route-layer error strings.
- Do not return `{ ok: false }` result envelopes unless a domain intentionally standardizes that pattern.

## Types vs Schemas

- `types.ts` = TypeScript-only domain types.
- `db.ts` local interfaces = local query result shapes.
- Runtime validation schemas do **not** belong in `services`.
- Shared request/response schemas belong in the contract/schema package, not here.

## Cleanup Discipline

- Delete dead service/domain code unless there is a clear short-term migration dependency.
- Do not preserve old abstractions just to avoid touching imports.
- If a file is only acting as a shim or pass-through layer, remove it.
