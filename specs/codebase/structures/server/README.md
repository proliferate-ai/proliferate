# Server Standards

Status: authoritative for Proliferate backend/control-plane code in this repo.

## Scope

These standards apply to backend/control-plane code under:

- `server/**`

The Python control plane lives under `server/proliferate/**`. The hosted
artifact viewer under `server/artifact-runtime/**` has its own contract; when a
change touches that tree, also read
[../../../../server/artifact-runtime/README.md](../../../../server/artifact-runtime/README.md).

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
    viewer_api/
    desktop_api/
    identity_api/
    utils/

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
| App shell | `main.py`, `middleware/**` | FastAPI app construction, router mounting, exception handlers, cross-cutting request lifecycle. | This doc |
| Settings and constants | `config.py`, `constants/<area>.py` | Env-derived runtime settings and shared hardcoded product/protocol values. | [guides/config.md](guides/config.md) |
| Reusable cross-domain logic | `lib/infra/**`, `lib/product/**`, `lib/capabilities/**` | Generic machinery, cross-domain pure product logic, and reusable orchestration over integrations — owned by no single domain. | [guides/lib.md](guides/lib.md) |
| Auth | `auth/**`, `permissions.py`, `server/<domain>/access.py`, `server/<domain>/domain/policy.py` | Actor authentication deps (user + worker), org-authorization factory deps and verdict types, resource-access deps, pure product-policy verdicts. | [guides/auth.md](guides/auth.md) |
| Database | `db/models/**`, `db/store/**` | ORM schema, query execution, transactions, row locks, ORM -> dataclass type boundary. | [guides/database.md](guides/database.md) |
| Domain transport | `server/<domain>/api.py`, `server/<domain>/models.py` | HTTP route handling and Pydantic request/response schemas. | [guides/domains.md](guides/domains.md) |
| Domain logic | `server/<domain>/service.py`, `server/<domain>/domain/**`, `server/<domain>/<subdomain>/` | Business orchestration, pure product rules, and promoted product concepts. | [guides/domains.md](guides/domains.md) |
| Errors | `errors.py`, `server/<domain>/errors.py`, `integrations/<vendor>/errors.py` | Shared product errors, domain errors, integration-local vendor/protocol errors. | [guides/errors.md](guides/errors.md) |
| Integrations | `integrations/<vendor>.py`, `integrations/<vendor>/**`, `integrations/<protocol>/**` | Raw third-party SDK/API access, vendor models, vendor public APIs, multi-vendor protocol adapters. | [guides/integrations.md](guides/integrations.md) |
| Background work | `background/**`, `server/<domain>/worker/**` | Celery substrate (app, config, Beat schedule, outbox relay, thin tasks) and the worker-facing service logic a task calls. | [guides/background.md](guides/background.md) |
| Artifact runtime | `server/artifact-runtime/**` | Hosted artifact viewer and desktop/runtime `postMessage` renderer protocol. | [artifact-runtime README](../../../../server/artifact-runtime/README.md) |

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
- `service.py` owns orchestration and receives `db: AsyncSession` from its
  caller. It must not open sessions, commit, import SQLAlchemy, or execute
  queries directly.
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
- Authorization is enforced at the endpoint via `Depends()`; services receive a
  pre-authorized context and run no auth checks. All actor deps
  (`current_active_user`, `current_product_user`, `current_worker`) live in
  `auth/dependencies.py`; org-authorization factory deps and verdict types
  (`require_org_role`, `require_org_membership`, `OwnerContext`, `PolicyVerdict`)
  live in `permissions.py` at the server root; resource-access deps live in
  `server/<domain>/access.py`; and product policy verdicts live in
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
  one meaningful pure-domain module.
- A parent folder is either flat or organized into subfolders consistently.
  Mixed shapes are forbidden.
- Cross-domain reads go through stores. Cross-domain writes go through the
  owning domain's public service functions.
- `datetime.utcnow()` is forbidden. Use `datetime.now(timezone.utc)`.
- New resource tables use UUID primary keys, timezone-aware timestamps, and
  `deleted_at TIMESTAMPTZ NULL` for soft delete when soft delete is needed.

## Read Order

Always start with this file. Then read the focused guide for the layer you are
changing:

- [guides/domains.md](guides/domains.md)
- [guides/database.md](guides/database.md)
- [guides/auth.md](guides/auth.md)
- [guides/errors.md](guides/errors.md)
- [guides/integrations.md](guides/integrations.md)
- [guides/lib.md](guides/lib.md)
- [guides/config.md](guides/config.md)
- [guides/background.md](guides/background.md)

Product and surface contracts live outside this structure folder. For
cross-cutting backend behavior such as billing, runtime provisioning, MCP,
claiming, cloud commands, workspace lifecycle, or product auth, also read the
relevant spec under `specs/codebase/primitives/**` or
`specs/codebase/features/**`.

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
`auth/**` may be imported by every layer for authentication, and cross-domain
authorization always comes from `proliferate.permissions` (a leaf importing
neither `auth/**` nor `server/<domain>/**`). Background tasks call domain
services; the relay is the only `background/**` module that touches a store, and
only the outbox store.

## CI-Enforced Repo Shape

`scripts/check_max_lines.py` enforces the hard column for server layers and
falls back to the repo-wide 600-line ceiling for server files without a
server-specific hard threshold.

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
