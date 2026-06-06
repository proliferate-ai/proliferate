# Server Standards

Status: authoritative for Proliferate backend/control-plane code in this repo.

Scope:

- `server/**`

Use this doc first to understand the server ownership model. Then read the
focused guide that applies to the code you are changing.

## Read Order

Always start here.

Guides define reusable engineering standards: where code goes, what each layer
may own, and which patterns are allowed.

Guides:

- [guides/domains.md](guides/domains.md) for `server/<domain>/` shape, the
  api/service/models triplet, `domain/` for pure logic, subdomain promotion,
  and cross-domain coordination.
- [guides/database.md](guides/database.md) for `db/store/`, `db/models/`,
  transactions, the ORM → dataclass → Pydantic type pipeline, and DB column
  conventions.
- [guides/auth.md](guides/auth.md) for authentication, the
  `auth/authorization` shared helpers, `<domain>/access.py` resource-access
  route deps, and `<domain>/domain/policy.py` product rules.
- [guides/errors.md](guides/errors.md) for shared product errors,
  domain-specific errors, integration-error translation, and global HTTP
  exception mapping.
- [guides/integrations.md](guides/integrations.md) for `integrations/<vendor>/`
  shapes and adapter conventions.
- [guides/config.md](guides/config.md) for `config.py`,
  `constants/<area>.py`, env-derived settings, hardcoded policy values, and
  file-local constants.
- [guides/workers.md](guides/workers.md) for the current lightweight
  background-job conventions: `worker.py`, `reconciler.py`, earned
  `worker/` subfolders, and worker-side service decomposition.

Audits capture focused cleanup findings for complex paths where the safe next
step is design clarity before code movement:

- [audits/phase6-billing-reconciler.md](audits/phase6-billing-reconciler.md)
  for the billing reconciler worker-boundary audit.
- [audits/phase6-cloud-runtime-background-loops.md](audits/phase6-cloud-runtime-background-loops.md)
  for the cloud runtime setup monitor and provisioning scheduler audit.
- [audits/server-structure-hygiene.md](audits/server-structure-hygiene.md)
  for the current multi-lane handoff plan to remove server structure
  migration debt.

Specs (when added) define product/surface contracts: lifecycle invariants,
edge cases, and focused verification for a specific cross-cutting flow such as
billing, runtime provisioning, or MCP. None are written yet.

When a change touches `server/artifact-runtime/**`, also read
[../../../../server/artifact-runtime/README.md](../../../../server/artifact-runtime/README.md).
That README owns the hosted artifact viewer contract, the desktop/runtime
`postMessage` protocol, and the per-type renderer behavior.

## Target Shape

This is the target architecture. Some existing code is still transitional; new
code and cleanup work should move toward this shape.

```text
server/proliferate/
  main.py
  config.py
  errors.py

  background/
    celery_app.py
    config.py
    beat_schedule.py
    relay.py
    tasks/

  constants/
    <area>.py
  utils/
  auth/
    dependencies.py
    authorization.py
    desktop/
    jwt.py
    oauth.py
    pkce.py
    users.py
    models.py
  db/
    engine.py
    models/
      <resource>.py
    store/
      <resource>.py                   # flat, default
      <area>/                         # folder when ≥4 related stores cluster
        <resource>.py
  integrations/
    <vendor>.py                       # single file (default)
    <vendor>/                         # folder for multi-concern or polymorphic
      __init__.py
      client.py
      models.py
      errors.py
      <concern>.py
  middleware/
  server/
    <domain>/
      api.py                          # transport
      service.py                      # orchestration
      models.py                       # Pydantic transport schemas
      access.py                       # resource-access route deps (when needed)
      errors.py                       # domain-specific error types (when needed)
      domain/                         # pure logic
        policy.py                     # product rules returning PolicyVerdict
        <concern>.py
      worker.py                       # non-HTTP entry point (when applicable)
      reconciler.py                   # state-drift loop (when applicable)
      worker/                         # promoted: substantial worker-side logic
        main.py
        service.py
        <concern>.py
      <subdomain>/                    # promoted: own product concept
        api.py
        service.py
        models.py
        domain/
```

Do not add new top-level server folders without updating this doc and the
focused guide that owns the layer.

## Transitional State

This doc describes the **target** architecture. The codebase is migrating
toward it; some existing patterns still need to be reshaped before every
hard rule below holds true everywhere.

Target-shape files that exist but are still not universally adopted:

- `server/proliferate/errors.py` — the shared base for `ProliferateError`,
  `NotFoundError`, `PermissionDenied`, `Conflict`, and `InvalidRequest`.
  Some domain code still uses older local error classes or route-level HTTP
  translation.
- `auth/authorization.py` — shared authorization context and policy verdict
  helpers. Some legacy authorization helpers and checks still live inside
  product-domain services.
- `server/<domain>/access.py` — resource-access route deps. Some domains still
  do resource lookup and access checks inline in services or handlers.
- `server/<domain>/domain/policy.py` — pure product-rule verdicts. Some
  product rules are still inline in services.

Patterns that **need migration**:

- **DB session threading.** Today many handlers receive only `User` (no
  `db`), and stores self-open sessions internally. Target: handlers receive
  `db: AsyncSession = Depends(get_async_session)`, services accept and
  thread `db`, stores never open sessions or commit. See
  [guides/database.md](guides/database.md).
- **Protocol clients in product code.** Some raw HTTP/SDK clients still live
  inside product domains. Target: move protocol access behind
  `integrations/**`; product domains orchestrate results.
- **Sibling helper files importing ORM.** Some domain-adjacent helper files do
  service-layer or store-layer work while sitting outside the canonical
  `api.py` / `service.py` / `models.py` / `domain/` shape. Target: see
  [guides/domains.md](guides/domains.md) on service decomposition.
- **God files.** Some stores, services, runtime flows, and workers are large
  coupled modules that need staged decomposition under the relevant guide.
  Treat these as senior-review migrations, not first-wave cleanup.
- **Pydantic constructors accepting ORM.** Some response constructors still
  accept ORM objects. Target: every constructor takes a dataclass.

Cleanup work should preserve current behavior, then incrementally move to
the target shape. New code should follow the rules below. PRs that
introduce new code in the **old** patterns require a justification.

## Hard Rules

### Layer law

- `api.py` is transport only. It parses the request, calls the right service,
  and returns the response. It may import `Depends`, `get_async_session`, and
  `current_active_user` (or equivalent auth dep) **only for use as
  `Depends(...)` injections** — never to call directly. It must not import
  `db/store/**`, must not call `AsyncSession` methods, and must not import
  SQLAlchemy. The only ORM model import allowed in handlers is `User` from
  auth.
- `service.py` owns business logic, orchestration, invariants, and validation.
  It accepts an `AsyncSession` parameter passed by the handler and threads it
  to stores. It must not import `async_session_factory` or open its own
  sessions. It must not import SQLAlchemy directly. It must not run
  `select(...)`, `insert(...)`, `update(...)`, `delete(...)`, or
  `db.execute(...)`.
- All database access lives in `db/store/**`. Stores own query construction
  and DB execution.
- `db/models/**` owns ORM table definitions only.
- `server/<domain>/models.py` owns Pydantic API request and response schemas
  only. It must not accept ORM objects in payload builder functions; the
  dataclass intermediate layer is mandatory.
- Raw third-party SDK and API calls belong behind `integrations/**`.
- Pure product rules belong in `server/<domain>/domain/<concern>.py`. They
  must not import FastAPI, SQLAlchemy, async I/O libraries, integrations,
  stores, config, or HTTP exception types. They are synchronous: no `async
  def` exports. They return data.
- `middleware/**` is only for cross-cutting HTTP request lifecycle concerns.

### Type pipeline

- Three layers always distinct: ORM (`db/models/`), dataclass (colocated with
  owner, typically the store file), Pydantic (`server/<domain>/models.py`).
- ORM never leaves the store boundary. Store functions return frozen
  dataclasses, not ORM objects.
- Pydantic never accepts ORM. Pydantic constructor functions take dataclasses.
- `@dataclass(frozen=True)` for read-result dataclasses.
- Use enums on dataclass fields, not strings. Wire-format string mapping
  happens in the Pydantic constructor.
- Do not use `model_config = ConfigDict(from_attributes=True)` to map ORM
  objects directly into Pydantic response models.

### Transactions

- Store functions take `db: AsyncSession` as a parameter. They never commit
  and never open sessions.
- HTTP handlers use the request session via `Depends(get_async_session)`. The
  dep commits on success and rolls back on exception.
- Workers, reconcilers, and schedulers open a session at the entry point with
  `async with async_session_factory() as db: async with db.begin(): ...`.
- For narrower atomicity within a request, services use
  `async with db.begin_nested():` around the relevant store calls.
- No `db.commit()` outside session-management code (the FastAPI dep, the
  worker entry point).

### Authorization

- Authentication (returning `User`) lives in `auth/dependencies.py`.
- Shared authorization helpers (`require_org_role`, `OwnerContext`,
  `PolicyVerdict`) live in `auth/authorization.py`.
- Resource-access route deps (returning the resource or raising 403/404) live
  in `server/<domain>/access.py`.
- Product rules (given state, is the action permitted) live in
  `server/<domain>/domain/policy.py` as pure functions returning
  `PolicyAllowed | PolicyDenied`.
- Authorization checks must not appear inline in `api.py` route handler
  bodies. Use deps.
- Authorization checks should not appear inline in `service.py` when they
  could have been route deps (fail-fast wins). Product rules from
  `domain/policy.py` are called from `service.py`.

### Errors

See [guides/errors.md](guides/errors.md) for the detailed error model.

- A single root `server/proliferate/errors.py` defines the base
  `ProliferateError` class and shared types (`NotFoundError`,
  `PermissionDenied`, `Conflict`).
- Domain-specific errors live in `server/<domain>/errors.py` and inherit from
  the shared base.
- Integration errors stay integration-local (`integrations/<vendor>.py` or
  `integrations/<vendor>/errors.py`).
- A FastAPI exception handler maps `ProliferateError` subclasses to
  `HTTPException` with the `code` field as the JSON error code. Services
  raise domain errors; the handler does HTTP translation.
- Do not catch `Exception` broadly without re-raising.
- Do not raise `HTTPException` from `domain/policy.py` or `db/store/`. Only
  services and api handlers raise HTTP-aware errors.

### Configs and constants

- `config.py` owns env-derived runtime settings only (secrets, URLs,
  deployment values, feature flags).
- `constants/<area>.py` owns shared hardcoded policy values: limits, timeouts,
  retry counts, page sizes, validation bounds, sentinel values, headers,
  default statuses, and protocol labels.
- Module-level numeric or string constants in `service.py`, `api.py`, or
  `db/store/**` files are forbidden when they carry product policy. Move them
  to `constants/<area>.py` or `config.py`. File-local mechanical constants
  such as SQL aliases, private regex fragments, or query column labels may
  stay local.
- `localhost` literals outside `config.py` defaults are forbidden.

### File size thresholds

| Layer | Soft (split before) | Hard (split or justify) |
|---|---|---|
| `server/<domain>/api.py` | 200 | 400 |
| `server/<domain>/service.py` | 500 | 800 |
| `server/<domain>/models.py` | 300 | 500 |
| `server/<domain>/domain/*.py` | 250 | 500 |
| `db/store/<resource>.py` | 400 | 700 |
| `db/models/*.py` | 300 | 500 |
| `integrations/<vendor>/*.py` | 300 | — |

Soft is a PR-review prompt. Hard requires a justification in the PR
description (typically a tracking issue + reason it can't split now).
`scripts/check_max_lines.py` enforces the hard column for server layers and
falls back to the repo-wide 600-line ceiling for server files without a
server-specific hard threshold. Existing oversized files are count-allowlisted
in `scripts/max_lines_allowlist.txt`; if one shrinks, lower or remove the
matching count in the same PR.

### Naming

- Canonical files (`api.py`, `service.py`, `models.py`, `worker.py`,
  `reconciler.py`, `scheduler.py`) are never prefixed or suffixed.
- Domain subdirectory files use descriptive nouns (`pricing.py`, `policy.py`,
  `validation.py`). No `_service.py`, `_helper.py`, `_helpers.py`, or
  `_utils.py` suffixes.
- Subdomain folders use singular product concepts (`subscriptions/`,
  `seats/`). No "manager"/"handler" suffixes.
- Store files match the ORM resource name. Flat: prefixed
  (`cloud_workspaces.py`). Folder: un-prefixed inside (`cloud_mcp/connections.py`).
- No single-underscore-prefixed module names at module scope (`_logging.py` is
  forbidden). Python package mechanics such as `__init__.py` and
  `__main__.py` are allowed.
- Constants use `UPPER_SNAKE_CASE` and live in `constants/<area>.py`.

### Folder hygiene

- Single-file folders are forbidden. If a folder has only one file, inline it.
- Exception: `server/**/domain/` may contain exactly one meaningful pure-domain
  module such as `policy.py`, `pricing.py`, or `validation.py`. Do not add
  placeholder files just to satisfy folder shape.
- Domain folders answer "what product area?" — not transport (`cloud/`,
  `api/`, `tauri/` are forbidden as `server/` children; transport stays in
  `integrations/` or `db/`) and not UI shape.
- Pick one shape per parent. A folder either has subfolder children
  consistently or is flat. Mixed shapes are forbidden.
- New top-level `server/proliferate/` folders require a doc-touching PR with
  a one-paragraph rationale.
- No junk-drawer modules: `helper.py`, `helpers.py`, `misc.py`, `common.py`,
  or `utils.py` at any checked server boundary. `utils/` at the project root
  is for truly generic helpers only.

### Cross-domain coordination

- Reads cross via store: a service may import another domain's store to read
  data.
- Writes cross via service: a service must go through another domain's public
  service functions to mutate that domain's resources.
- Service-to-service imports are limited to public functions. Importing
  another service's private helpers is forbidden.
- Cross-domain imports for auth infrastructure use `auth.authorization`,
  never another domain's `service.py`.

### Forbidden patterns across all layers

- Sibling helper files alongside `service.py` that import `db.models.*` or do
  service-layer work. Helpers live in `domain/` (pure) or are promoted to a
  subdomain.
- Cross-resource transactional writes spread across multiple service calls
  without a transaction boundary.
- Pydantic models used as ORM models or general-purpose internal containers.
- `datetime.utcnow()` anywhere in the codebase. Use
  `datetime.now(timezone.utc)`.
- `TIMESTAMP` columns without timezone. Use `TIMESTAMPTZ` everywhere.
- `is_deleted` boolean columns. Use `deleted_at TIMESTAMPTZ NULL` for soft
  delete; default to hard delete.
- Raw integer primary keys for new resources. UUID primary keys with
  `gen_random_uuid()` defaults.
- Lazy ORM attribute access reaching past the store boundary.

## Ownership Model

Use the lowest layer that can own the logic cleanly.

| Concern | Owner | Rule of thumb | Details |
| --- | --- | --- | --- |
| App shell | `main.py`, `middleware/**` | FastAPI app construction, router mounting, exception handlers, cross-cutting request lifecycle. | This doc |
| Settings and constants | `config.py`, `constants/<area>.py` | Env-derived runtime settings and shared hardcoded product/protocol values. | [guides/config.md](guides/config.md) |
| Generic support | `utils/**` | Truly generic helpers with no product, HTTP, DB, or vendor ownership. | This doc |
| Background substrate | `background/**` | Cross-domain Celery app, broker/queue/redbeat config, Beat schedule registry, outbox relay home, and thin task modules. | [guides/workers.md](guides/workers.md) |
| Auth | `auth/**`, `server/<domain>/access.py`, `server/<domain>/domain/policy.py` | Authentication, shared authorization helpers, resource-access deps, pure product-policy verdicts. | [guides/auth.md](guides/auth.md) |
| Database | `db/models/**`, `db/store/**` | ORM schema, query execution, transactions, row locks, ORM -> dataclass type boundary. | [guides/database.md](guides/database.md) |
| Domain transport | `server/<domain>/api.py`, `server/<domain>/models.py` | HTTP route handling and Pydantic request/response schemas. | [guides/domains.md](guides/domains.md) |
| Domain logic | `server/<domain>/service.py`, `server/<domain>/domain/**`, `server/<domain>/<subdomain>/` | Business orchestration, pure product rules, and promoted product concepts. | [guides/domains.md](guides/domains.md) |
| Errors | `errors.py`, `server/<domain>/errors.py`, `integrations/<vendor>/errors.py` | Shared product errors, domain errors, integration-local vendor/protocol errors. | [guides/errors.md](guides/errors.md) |
| Integrations | `integrations/<vendor>.py`, `integrations/<vendor>/**`, `integrations/<protocol>/**` | Raw third-party SDK/API access, vendor models, vendor public APIs, multi-vendor protocol adapters. | [guides/integrations.md](guides/integrations.md) |
| Workers | `server/<domain>/worker.py`, `server/<domain>/reconciler.py`, `server/<domain>/scheduler.py`, `server/<domain>/worker/**` | Non-HTTP entry points, reconciliation loops, scheduler loops, worker-facing orchestration. | [guides/workers.md](guides/workers.md) |
| Artifact runtime | `server/artifact-runtime/**` | Hosted artifact viewer and desktop/runtime `postMessage` renderer protocol. | [artifact-runtime README](../../../../server/artifact-runtime/README.md) |

Persistence rule:

- Services call store functions.
- Stores talk to the database.
- Handlers and services do not become ad hoc persistence layers.

## Dependency Direction

- `api.py` calls `service.py` and depends on access deps from `<domain>/access.py`.
- `service.py` calls stores in `db/store/**`, integrations in `integrations/**`,
  pure functions in `<domain>/domain/**`, and other domains' public service
  functions (writes) or stores (reads).
- `<domain>/domain/**` is pure: it does not import FastAPI, SQLAlchemy,
  `db/store/**`, integrations, async I/O libraries, or HTTP exception types.
- `db/store/**` calls `db/models/**` and SQLAlchemy. Nothing else may import
  SQLAlchemy.
- `db/models/**` is leaf: it does not import services, stores, or integrations.
- `integrations/<vendor>/**` is leaf: it does not import server domain code.
  Each vendor folder exposes a public API via `__init__.py`; this is the
  explicit Python integration-package exception to the repo-wide no-barrel
  rule. Internals stay vendor-local.
- `auth/**` may be imported by every layer. Cross-domain authorization helpers
  always come from `auth.authorization`, never from another domain's
  `service.py`.
- Workers (`worker.py`, `reconciler.py`, `worker/`) follow the same dependency
  direction as api/service. They call services, not stores directly.
