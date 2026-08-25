# Server Standards

## Scope

These standards apply to backend/control-plane code under:

- `server/**`

The Python control plane lives under `server/proliferate/**`. The hosted
artifact viewer under `server/artifact-runtime/**` has its own contract; when a
change touches that tree, also read
[../../server/artifact-runtime/README.md](../../server/artifact-runtime/README.md).

## Goals

The server is organized into distinct homes for HTTP transport, business
orchestration, persistence, pure product rules, auth, integration adapters,
reusable cross-domain logic, background work, errors, config, and shared
constants.

The explicit goals are:

- make it predictable where backend code belongs before opening a file
- keep HTTP, domain logic, database access, and vendor access separate
- make large control-plane flows reviewable by moving logic to the owner layer
- preserve current behavior while keeping structure aligned with ownership rules

A file path should tell a developer what kind of code is allowed there. If a
server feature requires chasing imports through helpers, raw clients, route
handlers, and store calls to understand ownership, the structure is wrong.

## Target Shape

The server tree is relative to `server/proliferate/`. Folders are omitted when
they are not needed.

```text
server/proliferate/
  main.py
  config.py
  errors.py
  permissions.py

  background/
    celery_app.py
    config.py
    beat_schedule.py
    relay.py
    tasks/

  constants/
    <area>.py

  lib/
    infra/
      <technical-concern>/
    product/
      <concern>/
    capabilities/
      <capability>/

  auth/
    dependencies.py
    users.py
    api.py
    profile_api.py
    desktop/                 # leaf models and callback pages
    identity/                # credential, session, provider-protocol, and persistence leaf

  db/
    engine.py
    models/
      <resource>.py
    store/
      <resource>.py
      <area>/
        <resource>.py

  integrations/
    <vendor>.py
    <vendor>/
      __init__.py
      client.py
      models.py
      errors.py
      <concern>.py

  middleware/

  server/
    accounts/
      desktop/               # Desktop account-entry API and orchestration
      identity/              # web/mobile account-entry API and orchestration
    <domain>/
      api.py
      service.py
      models.py
      access.py
      errors.py
      domain/
        policy.py
        <concern>.py
      worker/
        service.py
      <subdomain>/
        api.py
        service.py
        models.py
        domain/
```

Do not add new top-level folders under `server/proliferate/` without updating
this doc and the focused guide that owns the layer.

## What Goes Where

Use this as a routing map. The focused guides own the detailed rules.

| Area | Path | Owns | Canon |
| --- | --- | --- | --- |
| App shell | `main.py`, `middleware/**` | FastAPI app construction, router mounting, exception handlers, cross-cutting request lifecycle, and application logging setup that attaches request correlation context and stamps release identity. It does not own release policy or product orchestration. | This doc |
| Settings and constants | `config.py`, `constants/<area>.py` | Env-derived runtime settings and shared hardcoded product/protocol values. | [config.md](config.md) |
| Reusable cross-domain logic | `lib/infra/**`, `lib/product/**`, `lib/capabilities/**` | Generic machinery, cross-domain pure product logic, and reusable orchestration over integrations — owned by no single domain. | [lib.md](lib.md) |
| Auth | `auth/**`, `permissions.py`, `server/<domain>/access.py`, `server/<domain>/domain/policy.py` | Actor authentication primitives, dependency-free authorization vocabulary, request-time owner/org resolution, resource-access deps, and pure product-policy verdicts. | [auth.md](auth.md) |
| Accounts | `server/accounts/**` | Product account-entry routes and orchestration: user resolution/creation, identity placement, admin-email enforcement, and product side effects. | [auth.md](auth.md) |
| Database | `db/models/**`, `db/store/**` | ORM schema, query execution, transactions, row locks, ORM -> dataclass type boundary. | [database.md](database.md) |
| Domain transport | `server/<domain>/api.py`, `server/<domain>/models.py` | HTTP route handling and Pydantic request/response schemas. | [domains.md](domains.md) |
| Domain logic | `server/<domain>/service.py`, `server/<domain>/domain/**`, `server/<domain>/<subdomain>/` | Business orchestration, pure product rules, and promoted product concepts. | [domains.md](domains.md) |
| Errors | `errors.py`, `server/<domain>/errors.py`, `integrations/<vendor>/errors.py` | Shared product errors, domain errors, integration-local vendor/protocol errors. | [errors.md](errors.md) |
| Integrations | `integrations/<vendor>.py`, `integrations/<vendor>/**`, `integrations/<protocol>/**` | Raw third-party SDK/API access, vendor models, vendor public APIs, multi-vendor protocol adapters. | [integrations.md](integrations.md) |
| Background work | `background/**`, `server/<domain>/worker/**` | Celery substrate (app, config, Beat schedule, outbox relay, thin tasks) and the worker-facing service logic a task calls. | [background.md](background.md) |
| Artifact runtime | `server/artifact-runtime/**` | Hosted artifact viewer and desktop/runtime `postMessage` renderer protocol. | [artifact-runtime README](../../server/artifact-runtime/README.md) |

Persistence rule:

- Services call store functions.
- Stores talk to the database.
- Handlers and services do not become ad hoc persistence layers.

## Hard Rules

- Keep imports direct and concrete. Do not add barrel files or convenience
  re-export modules, except integration packages may expose their public vendor
  API from `integrations/<vendor>/__init__.py`.
- `api.py` is transport only. It may receive FastAPI deps and pass the request
  session to services; it must not import stores, SQLAlchemy, or run auth
  checks inline.
- `service.py` owns orchestration and normally receives `db: AsyncSession` from
  its caller. It must not commit, import SQLAlchemy query APIs, or execute
  queries directly. A `worker/service.py` that alternates bounded database
  phases with foreign I/O may instead receive a task-created
  `async_sessionmaker[AsyncSession]`, open sessions only around store calls,
  and release each session before foreign I/O. The task owns current-event-loop
  engine creation and disposal; the worker service cannot import settings or
  global engine helpers, construct an engine, or call session database methods.
- All database access lives in `db/store/**`. Stores take `db: AsyncSession`,
  construct queries, return frozen dataclasses, and never commit or open
  sessions.
- `db/models/**` owns ORM table definitions only. ORM objects never leave the
  store boundary.
- Keep the type pipeline distinct: ORM -> dataclass -> Pydantic. Pydantic
  constructors take dataclasses, never ORM objects.
- Do not use `model_config = ConfigDict(from_attributes=True)` to map ORM
  objects directly into Pydantic response models.
- Pure product rules live in `server/<domain>/domain/<concern>.py`; they are
  synchronous and do not import FastAPI, SQLAlchemy, stores, integrations,
  config, or async I/O libraries.
- Raw third-party SDK and HTTP access belongs behind `integrations/**`.
  Product domains orchestrate integration results; they do not become protocol
  clients.
- `lib/**` is reusable cross-domain logic that owns no durable state and no
  product policy: `lib/infra/` is generic (no product, no vendor, no DB),
  `lib/product/` is cross-domain pure product logic (no I/O, never imports
  `integrations/`), and `lib/capabilities/` orchestrates integrations. No
  `lib/**` file imports `db/store` or `server/<domain>/**`. A concern enters
  `lib/` only at its second domain consumer.
- New and refactored authorization paths enforce standing and resource access at
  the endpoint via `Depends()`; services receive resolved context rather than
  becoming a hidden permission layer. Existing inline checks are migration
  debt, not a second recommended pattern. User actor deps
  (`current_active_user`, `current_limited_user`, `current_product_user`, and
  `current_organization_actor`) live in
  [auth/dependencies.py](../../server/proliferate/auth/dependencies.py),
  while the runtime-worker bearer dependency lives with the Cloud
  runtime-worker domain. Dependency-free authorization vocabulary and the pure
  `require_org_role(context, roles)` check live in
  [auth/authorization.py](../../server/proliferate/auth/authorization.py).
  [permissions.py](../../server/proliferate/permissions.py) re-exports that
  vocabulary and owns request-time owner/org selection, membership resolution,
  RLS context, `require_owner_role(*roles)`, and the `current_org_*` and
  `current_path_org_*` dependencies. Resource-access deps live in
  `server/<domain>/access.py`; product-policy verdicts live in
  `server/<domain>/domain/policy.py`.
- Services raise product/domain errors. A global FastAPI exception handler
  translates `ProliferateError` subclasses to HTTP responses.
- Integration errors stay integration-local and are translated to product
  meaning in services.
- `config.py` owns env-derived values. `constants/<area>.py` owns shared
  hardcoded policy and protocol values. `localhost` literals outside
  `config.py` defaults are forbidden.
- Canonical files are named `api.py`, `service.py`, and `models.py`; do not
  prefix or suffix them. Background work is one execution model — a Celery task —
  with substrate in `background/**` and worker-facing logic in
  `server/<domain>/worker/service.py`; there are no per-domain `worker.py`,
  `reconciler.py`, or `scheduler.py` process or loop files.
- Do not add `helper.py`, `helpers.py`, `misc.py`, `common.py`, `utils.py`, or
  `_helpers.py`-style modules at server boundaries. Reusable cross-domain
  machinery lives in `lib/infra/<concern>/`; single-domain helpers live in
  `domain/`, a promoted subdomain, an integration, or the owning service. There
  is no `utils/` bucket.
- Single-file folders are forbidden, except `server/**/domain/` may contain
  one meaningful pure-domain module and a canonical `worker/` may contain only
  `service.py`.
- A parent folder is either flat or organized into subfolders consistently.
  Mixed shapes are forbidden.
- Cross-domain reads go through stores. Cross-domain writes go through the
  owning domain's public service functions.
- `datetime.utcnow()` is forbidden. Generic application wall-clock timestamps
  use [proliferate.lib.infra.time.wall_clock.utcnow](../../server/proliferate/lib/infra/time/wall_clock.py).
- New resource tables use UUID primary keys, timezone-aware timestamps, and
  `deleted_at TIMESTAMPTZ NULL` for soft delete when soft delete is needed.

## Read Order

Always start with this file. Then read the focused guide for the layer you are
changing:

- [README.md](README.md) — the cross-layer ownership model and its explicit
  current gaps
- [domains.md](domains.md)
- [database.md](database.md)
- [auth.md](auth.md)
- [errors.md](errors.md)
- [integrations.md](integrations.md)
- [lib.md](lib.md)
- [config.md](config.md)
- [background.md](background.md)

Product and surface contracts live outside this structure folder. For
cross-cutting backend behavior such as billing, sandbox/workspace provisioning,
runtime-worker enrollment, MCP, claiming, workspace lifecycle, or product auth,
also read the relevant spec under `specs/codebase/platforms/product/**` or
`specs/codebase/systems/**`.

## Dependency Direction

Server dependency direction:

```text
api -> access -> db/store -> db/models
api -> service
service -> db/store -> db/models
service -> integrations
service -> domain
service -> lib
background/tasks -> service
background/relay -> db/store
lib/capabilities -> integrations, lib/product, lib/infra
lib/product -> lib/infra
```

`server/<domain>/domain/**` is pure and does not depend on services, stores,
integrations, SQLAlchemy, FastAPI, or async I/O libraries. `db/store/**` is the
only layer that imports SQLAlchemy query APIs. `integrations/**` is a leaf and
does not import server domain code. `lib/**` is a leaf below the domains: it
never imports `server/<domain>/**` or `db/store`, `lib/product/` never imports
`integrations/`, and a concern enters `lib/` only at its second domain consumer.
The dependency-free authorization types in
[auth/authorization.py](../../server/proliferate/auth/authorization.py)
sit below request composition. Domain code imports the public authorization
seam from [permissions.py](../../server/proliferate/permissions.py), which
is not an import-free leaf: it composes actor deps, stores, billing services,
and request/RLS context. The rest of `auth/**` remains below product domains;
product account-entry orchestration belongs to
[server/accounts/**](../../server/proliferate/server/accounts). Background
tasks call domain services. The relay owns outbox mutations and reads only
bounded, fixed-cardinality operational snapshots; current background-store
exceptions are recorded in the [Background guide](background.md).

## CI-Enforced Repo Shape

`scripts/check_max_lines.py` enforces the hard column for server layers and
falls back to the repo-wide 600-line ceiling for server files without a
server-specific hard threshold.

The Server CI lint job installs the exact `server/uv.lock` development
environment on Python 3.12, runs Ruff, and runs strict mypy through
`server/scripts/check_mypy_baseline.py`. Existing mypy debt is recorded by
file, error code, normalized message, and multiplicity in a shrink-only
baseline. A new diagnostic, a baseline increase relative to the comparison Git
revision, or a stale entry after a fix fails the check. `make lint-server` uses
the same frozen environment. Pull requests compare with their base SHA, pushes
compare with the event's pre-push SHA, and reusable/manual calls must provide an
explicit trusted comparison SHA; a newly created release tag rechecks against
its commit parent after the main-push gate. After fixing existing diagnostics,
ratchet the baseline down with:

```bash
cd server
uv run --python 3.12 --frozen --extra dev python scripts/check_mypy_baseline.py \
  --compare-ref origin/main --write-baseline
```

| Layer | Soft: split before | Hard: split or justify |
| --- | --- | --- |
| `server/<domain>/api.py` | 200 | 400 |
| `server/<domain>/service.py` | 500 | 800 |
| `server/<domain>/models.py` | 300 | 500 |
| `server/<domain>/domain/*.py` | 250 | 500 |
| `db/store/<resource>.py` | 400 | 700 |
| `db/models/*.py` | 300 | 500 |
| `integrations/<vendor>/*.py` | 300 | repo-wide ceiling |

Soft is a PR-review prompt. Hard requires a justification in the PR
description, typically a tracking issue plus the reason it cannot split now.

## Change Discipline

- Preserve current behavior unless an explicit behavior change is requested.
- Keep ownership boundaries intact before introducing new abstractions.
- Delete dead code when replacing an implementation.
- Do not leave duplicate old and new code paths behind.
- Do not create empty folder trees or speculative abstractions.
- Prefer one bounded backend area per PR.
- When splitting a file, preserve behavior first and improve behavior
  separately.
- Use focused tests around moved service, store, domain, and worker logic when
  the logic is meaningful or risky.
