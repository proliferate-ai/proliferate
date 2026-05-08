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

Specs (when added) define product/surface contracts: lifecycle invariants,
edge cases, and focused verification for a specific cross-cutting flow such as
billing, runtime provisioning, or MCP. None are written yet.

When a change touches `server/artifact-runtime/**`, also read
[../../server/artifact-runtime/README.md](../../server/artifact-runtime/README.md).
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

Files named in the target shape that **do not yet exist** (or are partial):

- `server/proliferate/errors.py` — the shared base for `ProliferateError`,
  `NotFoundError`, `PermissionDenied`, `Conflict`. Today error types are
  scattered or per-domain only.
- `auth/authorization.py` — shared authorization context and policy verdict
  helpers. Today some shared authorization helpers live inside product-domain
  services; they migrate to a dedicated auth module so domains stop
  cross-importing for authorization infrastructure.
- `server/<domain>/access.py` — resource-access route deps. Most domains
  don't have one today; access checks happen inline in services.
- `server/<domain>/domain/policy.py` — pure product-rule verdicts. Today
  most product rules are inline `if not condition: raise HTTPException(...)`
  blocks in services.

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

### Naming

- Canonical files (`api.py`, `service.py`, `models.py`, `worker.py`,
  `reconciler.py`, `scheduler.py`) are never prefixed or suffixed.
- Domain subdirectory files use descriptive nouns (`pricing.py`, `policy.py`,
  `validation.py`). No `_service`, `_helper`, or `_utils` suffixes.
- Subdomain folders use singular product concepts (`subscriptions/`,
  `seats/`). No "manager"/"handler" suffixes.
- Store files match the ORM resource name. Flat: prefixed
  (`cloud_workspaces.py`). Folder: un-prefixed inside (`cloud_mcp/connections.py`).
- No underscore-prefixed module names at module scope (`_logging.py` is
  forbidden).
- Constants use `UPPER_SNAKE_CASE` and live in `constants/<area>.py`.

### Folder hygiene

- Single-file folders are forbidden. If a folder has only one file, inline it.
- Domain folders answer "what product area?" — not transport (`cloud/`,
  `api/`, `tauri/` are forbidden as `server/` children; transport stays in
  `integrations/` or `db/`) and not UI shape.
- Pick one shape per parent. A folder either has subfolder children
  consistently or is flat. Mixed shapes are forbidden.
- New top-level `server/proliferate/` folders require a doc-touching PR with
  a one-paragraph rationale.
- No junk-drawer modules: `helpers.py`, `misc.py`, `utils.py` at any
  domain level. `utils/` at the project root is for truly generic helpers
  only.

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
| Route handlers | `server/<domain>/api.py` | Thin request/response transport only. | [domains.md](guides/domains.md) |
| API request/response models | `server/<domain>/models.py` | Pydantic transport schemas. Constructor functions take dataclasses, never ORM. | [domains.md](guides/domains.md), [database.md](guides/database.md) |
| Product business logic | `server/<domain>/service.py` | Orchestration, invariants, validation. Calls stores and integrations. | [domains.md](guides/domains.md) |
| Pure product rules | `server/<domain>/domain/<concern>.py` | State machines, validators, calculators, planners. No I/O. | [domains.md](guides/domains.md) |
| Subdomain | `server/<domain>/<subdomain>/` | Promoted product concept with its own api/service/models. | [domains.md](guides/domains.md) |
| Worker process entry point | `server/<domain>/worker.py` (or `worker/main.py`) | argparse, signals, async loop setup. Calls service. | [workers.md](guides/workers.md) |
| Reconciliation loop | `server/<domain>/reconciler.py` (or `worker/reconciler.py`) | State-drift loop. Calls service. | [workers.md](guides/workers.md) |
| Resource-access route deps | `server/<domain>/access.py` | Lookup + access check + return resource. | [auth.md](guides/auth.md) |
| Product policy rules | `server/<domain>/domain/policy.py` | Pure verdict functions. | [auth.md](guides/auth.md) |
| Authentication | `auth/dependencies.py` | `get_current_user`, platform-admin checks. | [auth.md](guides/auth.md) |
| Shared authorization helpers | `auth/authorization.py` | `require_org_role`, `OwnerContext`, `PolicyVerdict`. | [auth.md](guides/auth.md) |
| ORM schema | `db/models/<resource>.py` | Persisted schema only. | [database.md](guides/database.md) |
| Database reads/writes | `db/store/<resource>.py` (flat) or `db/store/<area>/<resource>.py` (folder) | One ORM resource per file. Returns frozen dataclasses. Takes `db: AsyncSession`. Never commits. | [database.md](guides/database.md) |
| Read-result dataclasses | Co-located in the owning store file | `@dataclass(frozen=True)` snapshots returned to services. | [database.md](guides/database.md) |
| Internal value types | dataclasses in the owning module | Use for typed internal containers, not ORM or API substitutes. | [database.md](guides/database.md) |
| Third-party providers and SDKs | `integrations/<vendor>.py` (single file) or `integrations/<vendor>/` (folder) | Typed adapters only. | [integrations.md](guides/integrations.md) |
| Multi-vendor protocol | `integrations/<protocol>/` with `base.py`, `<provider>.py`, `factory.py` | Abstract over vendors implementing the same protocol. | [integrations.md](guides/integrations.md) |
| Cross-cutting HTTP behavior | `middleware/**` | Request context, tracing, correlation IDs. No product logic. | — |
| Env-driven runtime configuration | `config.py` | Secrets, URLs, flags, limits that vary by deployment. | [config.md](guides/config.md) |
| Hardcoded policy values | `constants/<area>.py` | Limits, timeouts, sentinel values, headers, protocol labels. | [config.md](guides/config.md) |
| Shared base errors | `server/proliferate/errors.py` | `ProliferateError`, `NotFoundError`, `PermissionDenied`, `Conflict`. | [errors.md](guides/errors.md) |
| Domain-specific errors | `server/<domain>/errors.py` | Inherit from the shared base. | [errors.md](guides/errors.md) |
| Integration-specific errors | `integrations/<vendor>/errors.py` or inline | Stay integration-local. | [integrations.md](guides/integrations.md) |

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
