# Server Grid Ownership Model

What an engineer needs to know to reason about the server architecture.

## Scope

This document owns the cross-layer ownership model for the Python control plane
under [server/proliferate](../../server/proliferate). The current source
router and enforced rules remain in [Server Standards](server.md); the
focused [domain](server.md), [database](server.md), [auth](../systems/identity/auth-surface.md),
[integration](server.md), [library](server.md), [error](server.md), and
[background](server.md) guides own the detail for their rows. Product
behavior remains in the owning platform or system document.

## Target-observed harness launch options

Cloud launch-option state is a thin copied-state domain under
`proliferate/server/cloud/harness_launch_options/`. It stores and reads one
verbatim state by `(cloud_sandbox_id, harness_kind)` and rejects stale source
revisions. Authorization is target-scoped. The server does not reconstruct
membership, apply add/remove overrides, or seed missing state from static
catalog data.

## Purpose And Ownership

The server is the **control plane**: an HTTP API plus background workers over
Postgres, integrating external vendors (AnyHarness runtime, Stripe, GitHub, AWS,
Slack). It owns persistence, auth, billing, orgs, and orchestrating runtimes — it
does **not** run agent sessions (AnyHarness does).

Three rules generate everything below:

1. **The layer law** — `api.py` (transport) → `service.py` (orchestration) →
   `db/store/**` (DB); `domain/**` (pure rules) on the side; `integrations/**`
   (vendors) as leaves.
2. **The type pipeline** — three distinct layers, never crossed:
   **ORM → dataclass → Pydantic**.
3. **Domain folders answer "what product area?"** — never transport, UI shape, or
   deployment target.

Plus the meta-rule: **lowest layer that can own it cleanly**, and dependencies
point one way.

The ownership model is current operating truth, enforced by
[check_server_boundaries.py](../../scripts/check_server_boundaries.py) from the
rule records in [lints/server/](../../lints/server/), with its exact named
exception sites in [exceptions.toml](../../lints/server/exceptions.toml).
The rules listed under [Current gaps](#current-gaps) are the ones that remain
unenforced; the reviewed exception ledger remains the operating tolerance until
those gaps close.

Every domain folder additionally carries a `MANIFEST.toml` — name, governing
spec, owns, public surface, and its measured allowed importers — validated by
[check_manifests.py](../../scripts/check_manifests.py) under the
`PROD-MANIFEST-*` records in
[lints/product/manifests.toml](../../lints/product/manifests.toml).

## The Core Idea

The server is a **grid**: columns are business domains such as Billing, Cloud,
Workflows, Accounts, and Organizations; rows are technical layers such as API,
service, domain, models, and stores. A piece of code lives at one coordinate.

**Legality is a pure function of coordinates.** Whether code at `(service,
billing)` can call code at `(store, cloud)` depends only on those coordinates
and an explicit ownership declaration. It does not depend on review history or
an undocumented exception. That makes the boundary searchable, testable, and
enforceable in CI.

Three principles hold the grid stable:

1. **Ownership stops the blast radius.** Only an owning domain writes its
   resources. Foreign reads exist only in a declared consumer ledger.
2. **Import audiences are inverse to knowledge.** Code importable by everyone
   knows nothing about product policy; code that knows product policy has a
   narrow audience.
3. **Layers own their seams.** A row answers one question—how data is loaded,
   how access is resolved, or how an error crosses transport—and every column
   uses that row's answer.

## The Layers

**API** is the HTTP boundary. It parses requests, receives authentication and
access dependencies, calls services, and shapes responses. It contains no
business logic, authorization decisions, or database operations.

**Service** is orchestration. It calls its own stores, foreign public services,
declared foreign-read stores, integrations, and allowed libraries. It receives
resolved access context and returns domain-typed data.

**Domain** is pure product policy. It performs no I/O. Its rules could move to a
different runtime without changing their inputs or outputs.

**Models** have two distinct audiences. Public models in a domain's `models.py`
are wire vocabulary; models under `db/models/**` are private ORM shapes. The
pipeline is ORM → frozen dataclass → Pydantic. A service never receives an ORM
object.

**Stores** are the only layer that knows SQL. A store receives the caller's
session, returns frozen dataclasses, and never opens, commits, or rolls back a
session. Each store has one owning domain. Foreign reads require an exact ledger
entry; foreign writes go through the owner's public service.

## The Type Pipeline — The Server's State Model

```text
ORM (db/models)  ──store returns──►  @dataclass(frozen=True)  ──models.py ctor──►  Pydantic (wire)
   stays in the store                  the safe travel format          the HTTP format
```

- **ORM never leaves the store.** Stores return frozen dataclasses.
- **Pydantic never accepts ORM.** Constructor functions take dataclasses (no
  `from_attributes=True`).
- Dataclasses carry **enums**; Pydantic maps to wire strings at the boundary.
- Cross-domain service calls pass **dataclasses**, not Pydantic.

The reason the boundary exists at the store and not somewhere more convenient:
ORM objects are mutable, session-coupled, and lazy-loading. An ORM object that
escapes the store carries an implicit dependency on a live session, so a read
that looks pure can emit SQL — or fail — arbitrarily far from the query that
produced it. A frozen dataclass is the safe travel format precisely because it
cannot do either.

## Transactions, Sessions, And Connections

- **Session** = the unit-of-work object (cheap; per request via the dep, per task
  via the worker entry). **Connection** = the scarce pooled resource, held *only*
  while a transaction is open. They are different things.
- **Stores take `db: AsyncSession`, never commit, never open sessions.**
- **HTTP:** the `get_async_session` dep owns the transaction (commit on success,
  rollback on exception). **Workers:** the task normally opens a session at the
  entry point (`async with session_factory() as db: async with db.begin(): …`).
  A worker service that must alternate bounded database phases with foreign I/O
  may receive the task-created session factory and open a fresh session around
  each store-only phase. The task still owns current-event-loop engine creation
  and disposal.
- **Never hold a connection across foreign I/O.** Short transactions only; for
  vendor-interleaving flows, commit → release → call → fresh short transaction.
  This is why the **outbox** exists (commit intent in one txn, do the side effect
  in a worker).
- **No `db.commit()` outside session-management code.**

The connection, not the session, is what runs out. A transaction left open
across a vendor HTTP call holds a pooled connection for the duration of someone
else's latency, so pool exhaustion arrives as an unrelated timeout somewhere
across the server. Short transactions and the outbox are the two mechanics that
keep foreign latency out of the pool.

## Shared Coordinates

**`lib/infra`** contains generic machinery: time, IDs, pagination, batching,
strings, and cryptography. Every layer may import it because it knows nothing
about products, vendors, or persistence.

**`lib/product`** contains cross-domain pure product logic. Its audience is the
product-domain service, domain, and models coordinates, plus a domain's
`worker/service.py`; API handlers, background task shims, stores, integrations,
and other infrastructure do not import it.

**`lib/capabilities`** contains reusable orchestration over integrations. Each
capability has an explicit domain-consumer map. A concern enters `lib/**` only
after a second real consumer exists.

**Integrations** contain vendor mechanics: raw SDKs, HTTP, protocol models, and
vendor errors. They are leaves below product domains. Services translate vendor
failures into product meaning.

**Seams** own cross-cutting request lifecycle. Authentication and
dependency-free authorization vocabulary sit below product domains; request
owner/org resolution composes at the endpoint; resource access remains in each
owning domain; one global error handler translates product errors.

**Background** has one durable execution model: thin Celery tasks fired by Beat
or the transactional outbox. Domain worker services own the work. There are no
domain schedulers, process-owned periodic loops, or `worker.py` entry points.
Only the outbox relay below `background/**` reads a store directly.

## Why Each Rule Exists

### Store ownership (`SRV-STORE`)

**Problem:** unrestricted foreign writes make responsibility and schema-change
impact unknowable.

**Rule:** writes cross domains only through the owner's public service. Reads
cross only through an exact, reviewable consumer ledger.

**Result:** a store owner can query every consumer before changing its contract,
and invariant enforcement has one write boundary.

### Error ownership (`SRV-ERR`)

**Problem:** protocol-shaped errors scattered through services make response
translation inconsistent and hard to test.

**Rule:** services raise product errors; the global handler translates them to
HTTP. `HTTPException` is legal only at authentication, org/resource-access, and
explicitly declared non-JSON transport boundaries. Error codes are globally
unique by convention; that uniqueness is not yet mechanically checked (gap 6).

**Result:** the HTTP format changes once, while product failures remain typed
and independently testable.

### Library purity (`SRV-LIB`)

**Problem:** a shared folder that imports everything becomes a junk drawer and
pulls single-domain policy out of its owner prematurely.

**Rule:** Infra is universal and product-blind; Product is pure and restricted
to product-domain `service.py`, `domain/**`, `models.py`, and
`worker/service.py`; Capabilities are consumer-mapped. Reuse requires at least
two real consumers.

**Result:** a library's import audience and allowed knowledge are obvious from
its coordinate.

### Background unification (`SRV-BG`)

**Problem:** domain-owned loops and schedulers create multiple restart,
observability, and failure models.

**Rule:** scheduled work is a Beat-fired Celery task; durable follow-up work is
an outbox-fired Celery task. Tasks are thin and process state is disposable.

**Result:** work is restartable, observable, and scalable through one runtime.

### Auth as a seam (`SRV-SEAM`)

**Problem:** authorization scattered through services hides access decisions
and makes authentication changes cross domain boundaries.

**Rule:** endpoints compose four orthogonal boundaries: actor authentication in
[auth/dependencies.py](../../server/proliferate/auth/dependencies.py),
org standing through
[permissions.py](../../server/proliferate/permissions.py), concrete
resource access in the owning domain's `access.py`, and pure product policy in
the owning domain's `domain/policy.py`. Services receive the resolved result.

**Result:** access is visible in route signatures, product policy is testable
without FastAPI, and authentication mechanisms remain below product domains.

## The Architecture in One Breath

Columns are domains and rows are layers. Within a column, API calls service,
service orchestrates, domain decides, and store persists. Public `models.py` is
the wire handshake. Stores have one owner; writes cross through that owner's
service and reads cross only when ledgered. Shared code has an explicit import
audience. Integrations isolate vendors. Auth and errors are seams. Background
work is a Celery task. Anything importable by every coordinate knows no product
or persistence detail.

## What the Grid Prevents

| Failure mode | Grid rule | Prevention |
| --- | --- | --- |
| Foreign writes corrupt shared state | `SRV-STORE-5` | Only the owner's service writes |
| Store changes surprise foreign readers | `SRV-STORE-6` | Exact consumer ledger makes reads queryable |
| Errors vary by call site | `SRV-ERR-1` | Product errors plus one transport handler |
| Shared code becomes a junk drawer | `SRV-LIB-1` | Three audiences and a two-consumer entry ticket |
| Auth decisions hide in orchestration | `SRV-SEAM-1` | Four endpoint-composed boundaries |
| Background work has divergent failure models | `SRV-BG-1` | One Celery execution model |
| Service cycles block refactors | `SRV-TOPO-1` | `GAP`: generated graph and acyclic-component gate are documented rules, not gates (#1714) |
| Third-party packages leak into product code | `SRV-PKG-1` | `GAP`: explicit package-audience map is a documented rule, not a gate (#1714) |

## Foreign-Read Doctrine

Foreign reads are legal only when the exact consumer and store operation appear
in the ownership ledger. A ledger row grants no module-wide permission, and
stale rows are meant to be pruned. The ledger is maintained by review rather
than by the checker: `check_server_boundaries.py` has no ledger table, so
neither the declarations nor their staleness are mechanically enforced (gap 2).
If a required read is not declared, the caller must either add the reviewed read
edge or consume an owner service contract.

The small declaration cost makes schema-change blast radius queryable: the
owner can answer “who reads this store?” without reconstructing history.

## How to Reason About a Change

Before code crosses domains or touches shared state, ask:

1. **Store ownership:** Does this domain own the store? If not, is this exact
   read ledgered, or is the write going through the owner's public service?
2. **Audience:** May this coordinate import the library or package? Does the
   imported code know more than its audience allows?
3. **Error shape:** Is a transport error legal at this seam, or must the code
   raise a product error?
4. **Background:** Is this durable work represented as a Celery task, with Beat
   or the outbox owning dispatch?
5. **Auth:** Is the decision visible in an endpoint dependency or pure policy,
   rather than buried in orchestration?

If every answer is yes or not applicable, the change aligns with the grid.

## Reading Order

1. This document for the ownership mental model.
2. [Server Standards](server.md) for current source routing and enforced
   rules.
3. [Library ownership](server.md) for import audiences.
4. [Domain ownership](server.md) for cross-domain coordination.
5. [Auth ownership](../systems/identity/auth-surface.md) for the four authorization boundaries.
6. [Background ownership](server.md) for task and transaction rules.

## Current gaps

Everything above this section is the current operating model, with each rule's
enforcement status stated inline where it is not mechanically checked. Each item
below is a named rule the model asserts that no checker holds yet — public debt,
not a softer version of the rule.

- [ ] **Coordinate enforcement is not present.** Current CI runs the bounded,
  path-classified
  [check_server_boundaries.py](../../scripts/check_server_boundaries.py)
  from [ci.yml](../../.github/workflows/ci.yml). There is no checked-in
  TOML coordinate map, general `check_grid.py`, package-audience map, generated
  service graph, or automatic owner/consumer map.
- [ ] **Store ownership and foreign-read declarations are not generally
  enforced.** The current [domain guide](server.md#cross-domain-coordination)
  permits foreign reads through stores, while the checker has no complete store
  owner table or exact foreign-read ledger. Cross-domain write repair and
  enforcement therefore remain bounded migrations rather than a repository-wide
  coordinate law.
- [ ] **The ORM → dataclass boundary is incomplete.** Current stores such as
  [users.py](../../server/proliferate/db/store/users.py) and
  [billing_subjects.py](../../server/proliferate/db/store/billing_subjects.py)
  return ORM types.
- [ ] **Request transaction ownership is incomplete.** The exception ledger
  records route-owned session calls across the Accounts
  [Desktop](../../server/proliferate/server/accounts/desktop/api.py) and
  [Identity](../../server/proliferate/server/accounts/identity/api.py) APIs.
  Each site is a `SRV-API-5` entry in
  [exceptions.toml](../../lints/server/exceptions.toml).
- [ ] **Authorization dependency adoption is partial.** The current
  [Auth guide](../systems/identity/auth-surface.md) treats inline service checks as migration debt. Current
  examples include Organization role gates in
  [organizations/service.py](../../server/proliferate/server/organizations/service.py),
  Cloud integration admin checks in
  [integration_gateway/connections/service.py](../../server/proliferate/server/integration_gateway/connections/service.py).
  In addition, `permissions.py` currently composes actor deps, stores, billing
  services, and request/RLS context; only `auth/authorization.py` is the
  dependency-free authorization leaf.
- [ ] **Error enforcement is incomplete.** Organization orchestration now
  raises transport-neutral Organization errors, and current direct
  `HTTPException` uses are confined to HTTP boundary modules. The checker still
  does not classify every service/internal module or enforce globally unique
  error codes.
- [ ] **Library audiences are not represented or enforced.** The current
  [lib tree](../../server/proliferate/lib) contains Infrastructure
  encryption/time and Product redirect-callback/telemetry leaves; workspace
  naming is owned by its Cloud domain. The server checker still does not scan
  `lib/**` for audience or purity rules, and current non-Product consumers of
  `lib/product` remain outside the target audience.
- [ ] **Raw-transport placement retains one exact exception.**
  `cloud/gateway/proxy.py` (deleted, cull part 2)
  owns raw HTTP and WebSocket proxy transport inside a product domain. Its
  `httpx` import is the one `SRV-INTEG-4` site in
  [exceptions.toml](../../lints/server/exceptions.toml).
  Sentry release identity is injected and no longer crosses into a product
  domain.
- [ ] **Service topology and package audiences are not gated.** Cloud Sandbox
  imports Gateway service in
  `cloud_sandboxes/service.py` (deleted, cull part 2),
  while Gateway imports Cloud Sandbox service in
  `gateway/service.py` (deleted, cull part 2).
  No generated graph rejects that cycle, and no third-party package map limits
  imports by coordinate.
- [ ] **Background execution is not unified.** Periodic process loops remain in
  `Billing reconciliation` (deleted, cull part 2),
  [anonymous telemetry](../../server/proliferate/server/anonymous_telemetry/worker.py),
  and three Agent Gateway loops in
  [worker.py](../../server/proliferate/server/agent_auth/worker.py).
  The one-off
  [enqueue_health.py](../../server/proliferate/background/enqueue_health.py)
  command also remains a direct background-store client. These paths require a
  deployed, behavior-equivalent background plane or an explicitly documented
  exception before the target can be enforced.

> [!note]
> This is the server area doc: layering, dependency direction, conventions. Stitched sections below, one per former owner doc:
> `standards.md` → [Server Standards](#server-standards)
> `domains.md` → [Server Domains](#server-domains)
> `database.md` → [Database](#database)
> `background.md` → [Background Work](#background-work)
> `config.md` → [Config And Constants](#config-and-constants)
> `errors.md` → [Errors](#errors)
> `lib.md` → [Server Lib](#server-lib)
> `integrations.md` → [Integrations](#integrations)

---

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
| Settings and constants | `config.py`, `constants/<area>.py` | Env-derived runtime settings and shared hardcoded product/protocol values. | [config.md](server.md) |
| Reusable cross-domain logic | `lib/infra/**`, `lib/product/**`, `lib/capabilities/**` | Generic machinery, cross-domain pure product logic, and reusable orchestration over integrations — owned by no single domain. | [lib.md](server.md) |
| Auth | `auth/**`, `permissions.py`, `server/<domain>/access.py`, `server/<domain>/domain/policy.py` | Actor authentication primitives, dependency-free authorization vocabulary, request-time owner/org resolution, resource-access deps, and pure product-policy verdicts. | [auth.md](../systems/identity/auth-surface.md) |
| Accounts | `server/accounts/**` | Product account-entry routes and orchestration: user resolution/creation, identity placement, admin-email enforcement, and product side effects. | [auth.md](../systems/identity/auth-surface.md) |
| Database | `db/models/**`, `db/store/**` | ORM schema, query execution, transactions, row locks, ORM -> dataclass type boundary. | [database.md](server.md) |
| Domain transport | `server/<domain>/api.py`, `server/<domain>/models.py` | HTTP route handling and Pydantic request/response schemas. | [domains.md](server.md) |
| Domain logic | `server/<domain>/service.py`, `server/<domain>/domain/**`, `server/<domain>/<subdomain>/` | Business orchestration, pure product rules, and promoted product concepts. | [domains.md](server.md) |
| Errors | `errors.py`, `server/<domain>/errors.py`, `integrations/<vendor>/errors.py` | Shared product errors, domain errors, integration-local vendor/protocol errors. | [errors.md](server.md) |
| Integrations | `integrations/<vendor>.py`, `integrations/<vendor>/**`, `integrations/<protocol>/**` | Raw third-party SDK/API access, vendor models, vendor public APIs, multi-vendor protocol adapters. | [integrations.md](server.md) |
| Background work | `background/**`, `server/<domain>/worker/**` | Celery substrate (app, config, Beat schedule, outbox relay, thin tasks) and the worker-facing service logic a task calls. | [background.md](server.md) |
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

- [README.md](server.md) — the cross-layer ownership model and its explicit
  current gaps
- [domains.md](server.md)
- [database.md](server.md)
- [auth.md](../systems/identity/auth-surface.md)
- [errors.md](server.md)
- [integrations.md](server.md)
- [lib.md](server.md)
- [config.md](server.md)
- [background.md](server.md)

Product and surface contracts live outside this structure folder. For
cross-cutting backend behavior such as billing, sandbox/workspace provisioning,
runtime-worker enrollment, MCP, claiming, workspace lifecycle, or product auth,
also read the relevant spec under `specs/product/**` or
`specs/systems/**`.

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
exceptions are recorded in the [Background guide](server.md).

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

---

# Server Domains

Backend product domains keep transport, orchestration, wire models, pure rules,
authorization deps, errors, and non-HTTP entry points in predictable homes. A
domain folder answers "what product area owns this?"

The placements below are the rule for new and refactored code. Remaining
inline authorization and boundary exceptions are migration debt, not alternate
patterns that new code may copy.

## Ownership

A `server/<domain>/` folder is one product area's home. It owns:

- HTTP transport via `api.py`
- Business orchestration via `service.py`
- Pydantic transport schemas via `models.py`
- Pure rules via `domain/<concern>.py`
- Resource-access route deps via `access.py` (when the domain has protected resources)
- Domain-specific errors via `errors.py` (when needed)
- Worker-facing background service via `worker/service.py` (when the domain runs
  background work a Celery task calls)
- Promoted subdomains via `<subdomain>/` (when earned)

A domain folder must answer "what product area?" — not transport, not UI shape,
not deployment target.

## Shape

Default shape for a small or moderate domain:

```text
server/<domain>/
  api.py
  service.py
  models.py
```

Extended shape when the domain has more structure:

```text
server/<domain>/
  api.py
  service.py
  models.py
  access.py                 # resource-access route deps
  errors.py                 # domain-specific error types
  domain/                   # pure logic
    policy.py
    <concern>.py
  worker/                   # worker-facing background service (when applicable)
    service.py
  <subdomain>/              # promoted subdomain
    api.py
    service.py
    models.py
    domain/
```

The hierarchy answers three questions, in order:

1. What product area? — the domain folder name.
2. Which surface within that area? — `api.py` (HTTP), `worker/service.py`
   (background), `<subdomain>/` (promoted concept).
3. What part of that surface? — `service.py` (orchestration), `domain/`
   (pure rules), `access.py` (auth), `errors.py` (types).

## What Each File Owns

### `api.py`

Transport only. Parses requests, calls services, returns responses. Stays
thin. Long handler bodies are a smell.

Allowed:

- Route declarations with typed Pydantic return annotations.
- Resource-access deps via `Depends(<domain>_user_can_<action>)`.
- Authentication deps via an actor dep (`Depends(current_product_user)`).
- Session injection via `db: AsyncSession = Depends(get_async_session)` —
  the handler receives the request session and passes it to the service.
- Response construction via `<domain>/models.py` payload functions.
- Request body validation via Pydantic input models.

Banned:

- Authorization checks inline in handler bodies. Use deps.
- Direct `db/store/**` imports.
- Calling `AsyncSession` methods (`db.execute`, `db.commit`, `db.add`)
  inside the handler body. The handler injects `db` and forwards it; only
  services and stores call methods on it.
- `async_session_factory` imports. The handler uses
  `Depends(get_async_session)`, never opens its own session.
- SQLAlchemy imports.
- Business logic. Move to `service.py`.
- ORM model imports other than `User` from auth.
- `try/except` around the whole handler. Let the error handler translate
  domain errors to HTTPException.

### `service.py`

Business logic, orchestration, invariants, validation. The middle layer
between handlers and stores.

Allowed:

- `db: AsyncSession` as a parameter (passed by the handler or the worker
  entry point). Service functions take this and thread it to stores.
- In `worker/service.py` only, a task-created
  `async_sessionmaker[AsyncSession]` when the orchestration must alternate
  bounded store-only phases with foreign I/O. Each session closes before the
  external call.
- Composing multiple store function calls within a single transaction
  (the request session by default; `db.begin_nested()` for narrower
  atomicity).
- Calling integrations via their public API.
- Calling pure functions in `domain/`.
- Calling other domains' public service functions for *writes*.
- Calling other domains' stores for *reads*.
- Raising domain errors (`raise WorkspaceAlreadyDeleting(...)`).

Banned:

- Global `async_session_factory` and engine-helper imports. Ordinary services
  don't open sessions. The narrow worker exception receives a factory from its
  task but cannot import settings, create an engine, or reach a global factory.
- SQLAlchemy query/building imports. The narrow worker exception may import
  only the `AsyncSession` and `async_sessionmaker` types from
  `sqlalchemy.ext.asyncio`.
- `select()`, `insert()`, `update()`, `delete()`, `db.execute()`. All DB
  access goes through stores.
- `db.commit()` or `db.rollback()`. Transactions are owned by the caller
  (the FastAPI dep for HTTP handlers; the worker entry point for workers).
- Authorization checks inline. Use route deps for resource access; call
  `domain/policy.py` for product rules.
- Inline status-to-label maps or other repeated presentation logic.
- Calling another domain's `service.py` private helpers. Public functions only.
- Calling another domain's `db/store/**` write functions. Writes go through
  the owning service.

### `models.py`

Pydantic API request and response schemas. The wire format.

Allowed:

- Request models for input validation.
- Response models for output serialization.
- Constructor functions taking dataclasses (`def workspace_response(snapshot:
  WorkspaceSnapshot) -> WorkspaceResponse`).
- Discriminated unions for tagged responses.
- Pydantic validators for input parsing.

Banned:

- Functions that take ORM objects (`def f(workspace: CloudWorkspace)`). Take
  dataclasses instead.
- `model_config = ConfigDict(from_attributes=True)`.
- Pydantic models reused as ORM substitutes or general internal containers.
- Deep schema inheritance hierarchies (`BaseFooModel` → `BaseBarModel` →
  `BazResponse`). Keep flat.
- ORM model imports for column-type re-use.

### `domain/<concern>.py`

Pure synchronous rules. The product's decision-making layer.

Allowed:

- Validators (`validate_<input>`).
- State machines and reducers.
- Calculators and pricing logic.
- Mappings (status → tone, kind → label).
- Planners (return command lists for an executor to run).
- Frozen dataclasses for internal types.
- Imports from `proliferate.permissions` (for `PolicyVerdict`, etc.) and other
  `domain/` modules.

Banned:

- `async def` exports. Domain is synchronous; if it needs to be async, it's
  not domain.
- `db.models.*`, SQLAlchemy, `db/store/**` imports.
- `httpx`, `requests`, integrations imports.
- `fastapi` imports (no HTTP, no Depends).
- `service.py` imports (domain doesn't depend on orchestration).
- Side effects: file I/O, network, logging beyond pure data, environment
  reads.

### `domain/policy.py`

Pure product-rule verdicts. A specific kind of `domain/` file.

Allowed:

- Functions returning `PolicyAllowed | PolicyDenied` (the tagged union).
- Reading dataclass fields, comparing values, applying rules.

Banned:

- Raising `HTTPException`. Return a verdict; let the service raise.
- I/O, imports from `db/`, `service.py`, integrations.

### `access.py`

Resource-access route dependencies. Looks up a resource, checks the user can
touch it, returns the resource (or raises 403/404).

Allowed:

- `async def` functions taking an actor dep (`Depends(current_product_user)`) and
  any path/query params.
- `db: AsyncSession = Depends(get_async_session)` for the lookup.
- Calls to `db/store/**` for the resource lookup.
- Composing request dependencies from
  [permissions.py](../../server/proliferate/permissions.py), such as
  `current_path_org_admin`, `current_owner_context`, or
  `require_owner_role("owner", "admin")`.
- Calls to `domain/policy.py` for state-based access checks.
- Returning the resource as a frozen dataclass.

Banned:

- Mutating writes. Access deps are read-only.
- Business logic beyond access.
- Inline org-standing helpers (compose the applicable dependency from the
  public `proliferate.permissions` seam).

### `errors.py`

Domain-specific error types inheriting from the shared base.

Allowed:

- Subclasses of `ProliferateError`, `NotFoundError`, `PermissionDenied`,
  `Conflict`.
- A `code` class attribute matching the error kind.

Banned:

- Raising HTTPException directly. The shared exception handler maps the
  domain error.
- Catching and re-wrapping unrelated exceptions.
- Error logic (just types).

## Service Decomposition

When `service.py` grows past comfortable, you have exactly five legal moves.
Sibling helper files at the parent level are not one of them.

### 1. Stay in `service.py` with internal sectioning

For growth that's more orchestration of the same product concept. Up to
~700–800 lines.

```python
# ──────────────────────────────────────
# Subscription lifecycle
# ──────────────────────────────────────
async def start_subscription(...): ...
async def cancel_subscription(...): ...

# ──────────────────────────────────────
# Usage reporting
# ──────────────────────────────────────
async def report_usage(...): ...
```

Beyond ~800 lines, the decomposition pressure is real and one of the next
options applies.

### 2. Extract pure logic to `domain/<concern>.py`

When part of the service is a meaningful pure rule — pricing, policy,
validation, calculation, state transition, or mapping — move it. The domain
file imports nothing from `db/`, `integrations/`, or `service.py`. Service
imports the pure function, calls it, raises on the verdict.

Do not extract every pure private helper. A tiny one-path helper may stay in
`service.py` when it only supports one orchestration path and moving it would
create a one-function domain file. Extract to `domain/` when the rule is
product policy, reusable, directly testable, or materially clarifies the
service flow.

### 3. Promote a subdomain

When the spillover has its own product concept *and* its own orchestration
mass — typically (but not always) signaled by its own API endpoints. New
`<subdomain>/api.py + service.py + models.py`.

A subdomain earns the folder when all three files would have meaningful
content. If `models.py` would be three lines and `api.py` would have one
route, you're over-engineering — keep it in the parent.

Internal-only subdomains may have no `api.py` if the work is all background
(e.g., a multi-step reconciliation flow). Still need `service.py` + `models.py`
to count as a subdomain.

### 4. Move vendor specifics to `integrations/<vendor>/`

If the spillover is a vendor adapter — auth flow, payload normalization,
webhook parsing — it leaves the product folder. See
[integrations.md](server.md). No exceptions for "but only this domain
uses it."

### 5. Add a worker-facing background service

`worker/service.py` for background work a Celery task calls. See
[background.md](server.md). Same layer law: no ORM imports, calls service or
store functions. It normally receives `db`; when foreign I/O separates bounded
database phases, it may receive a task-created session factory and must close
each store-only session before the external call. The task itself is substrate
in `background/**`, not a file in the domain.

### Forbidden

A top-level sibling file in `server/<domain>/` that:

- Imports `db.models.*` and isn't `service.py`. Service-layer work in
  disguise. Move to `service.py`, promote to a subdomain, or split into
  store + service.
- Has REST handlers. Those go in `api.py`.
- Mixes business orchestration with vendor specifics. Split.
- Is named `helper.py`, `helpers.py`, `misc.py`, `common.py`, or `utils.py`,
  or uses `_helper.py`, `_helpers.py`, or `_utils.py` as a suffix.
  Junk-drawer.

## Subdomain Promotion

A subdomain earns its folder when all of:

1. **Distinct product concept.** You'd describe it as a separate area in
   product docs, not just an aspect of the parent.
2. **Own orchestration mass.** Multi-step service-level workflows operating on
   its own resources.
3. **Filling api/service/models would produce meaningful content in all
   three.**

Examples that qualify in `cloud/`:

- `workspaces/` — its own product concept, lifecycle, endpoints.
- `repos/` — distinct from workspaces, own resources.
- `mobility/` — workspace mobility is its own surface.

Examples that don't qualify:

- A pricing helper for billing — that's `domain/pricing.py`.
- A reconciliation pass — that's a Beat-fired task in `background/**` calling the
  domain's `worker/service.py`.
- A two-function helper — keep inline.

Internal-only subdomains exist when there's enough orchestration mass without
external endpoints (e.g., a multi-step worker-driven flow). Same `service.py`
+ `models.py` requirement; `api.py` may be absent.

## Cross-Domain Coordination

Domains coordinate via two legal patterns:

**Reads cross via store.** A service may import another domain's store to read
data:

```python
# billing/service.py
from db.store.cloud_workspaces import list_workspaces_for_subject

async def compute_subject_usage(db: AsyncSession, subject_id: UUID):
    workspaces = await list_workspaces_for_subject(db, subject_id)
    return ...
```

The store boundary is safe — it returns frozen dataclasses, no behavior leaks.

**Writes cross via service.** A service must go through another domain's public
service functions to mutate that domain's resources:

```python
# billing/service.py
from cloud.workspaces.service import suspend_workspace

async def downgrade_subject(db: AsyncSession, subject_id: UUID):
    workspaces = await list_workspaces_for_subject(db, subject_id)
    for ws in workspaces:
        await suspend_workspace(db, workspace_id=ws.id, reason="downgrade")
```

The owning service runs its own policy, invariants, and audit.

### Forbidden cross-domain patterns

- A service calling another domain's store *write* function directly.
- Importing a service's private helpers (`from cloud.workspaces.service
  import _internal`). Public functions only.
- Cross-domain imports for authorization infrastructure. Domain code uses the
  public names re-exported by
  [permissions.py](../../server/proliferate/permissions.py), while
  [auth/authorization.py](../../server/proliferate/auth/authorization.py)
  remains the dependency-free definition owner.
- Two domains both writing the same ORM resource. The resource has one
  owning domain whose service is the write boundary.

The same pattern applies to subdomains within a parent: read via store, write
via service.

## Worker-Side Logic

When a domain has substantial worker-side logic that's distinct from HTTP-side
work, promote it to a `worker/` subfolder holding a worker-facing
`service.py` — the orchestration a Celery task calls to do the domain's
background work. The domain owns no process entry, scheduler, or reconciliation
loop: the task is substrate in `background/**`, and Beat owns scheduling.

```text
server/proliferate/server/workflows/
  api.py
  service.py            # API-facing service: CRUD on workflow definitions
  models.py             # API schemas
  domain/
    validation.py       # pure cross-field definition validation
    invocation.py       # pure eligibility / argument / identity rules
  worker/
    service.py          # worker-facing service: cancel, deliver, observe
```

Two `service.py` files coexist only when surfaces are genuinely distinct; they
share `domain/` and the store. Request-driven external-executor surfaces — where
an outside process claims, heartbeats, or reports against a Postgres lease — are
APIs, not worker code, and stay near `api.py`/`service.py`. See
[background.md](server.md) for the full background-work organization.

A `worker/` folder containing only its canonical `service.py` is the narrow
worker exception to the single-file-folder rule.

## Patterns

- A domain folder either has subfolder children consistently or is flat.
  Mixed shapes (some subfolders, some flat sibling files belonging to a
  subdomain) are forbidden. `domain/` may contain one meaningful pure-domain
  file, and `worker/` may contain only its canonical `service.py`; these are the
  narrow exceptions to the single-file-folder rule.
- Service composes; domain decides; store persists. If you find a service
  computing a complex rule inline, the rule belongs in `domain/`. If you find
  a domain function calling a store, it's not domain.
- The `models.py` constructor functions are the explicit type boundary
  between internal dataclasses and wire format. They never see ORM.
- Services import dataclasses (not Pydantic) when calling each other across
  domains. The Pydantic boundary is at `api.py`.
- Long functions in `service.py` usually want to be a planner in `domain/`
  plus a thin executor in `service.py`. The planner returns command-shaped
  data; the executor runs it.

---

# Database

The database layer owns persistence schema, query execution, transaction
boundaries, and the type boundary between persistence, internal logic, and wire
format. Service code sees frozen dataclasses, not ORM rows.

## Ownership

The database layer has three concerns:

- **`db/models/`** owns ORM table definitions. Persistence schema only.
- **`db/store/`** owns DB access — query construction, `db.execute(...)`,
  reads, writes. The only place SQLAlchemy is used.
- **The type pipeline** maps each persistence row through three layers: ORM
  (mutable, session-coupled) → dataclass (frozen, internal) → Pydantic (wire
  format).

Transactions, dataclass conventions, and DB column conventions all live in
this guide because they're all aspects of the database layer.

## `db/models/`

ORM tables. Nothing else.

### Shape

```text
db/models/
  __init__.py
  base.py
  <resource>.py        # one ORM file per resource cluster
```

Examples: `cloud.py`, `billing.py`, `auth.py`,
`organizations.py`. A single ORM file may declare multiple related table
classes (a primary entity plus its junction tables).

### Allowed

- SQLAlchemy `Mapped[...]` declarations.
- `__tablename__`, columns, indexes, constraints.
- Foreign-key relationships.
- Type-only enum imports (the Python enum lives in `domain/`).
- Inheritance via the shared `Base` from `db/models/base.py`.

### Banned

- API request or response models.
- Service logic.
- Computed properties that do business work. Simple derived properties
  (e.g., `is_active = Column(...)`) are fine.
- Deep `BaseFoo → BaseBar → Concrete` hierarchies. Use composition, not
  inheritance trees.
- Importing `db/store/**`, `service.py`, integrations, or business code.

### Key current model families

- **Sandbox access** (`db/models/cloud/sandboxes.py`): personal
  `cloud_sandbox` lifecycle, provider id, and encrypted AnyHarness access.
- **Repository configuration** (`db/models/repositories.py`):
  `repo_config`, `repo_environment`, and
  `cloud_repo_environment_materialization`.
- **Cloud workspace records** (`db/models/cloud/workspaces.py`): repository
  environment, branch/base branch, archive state, and optional
  `anyharness_workspace_id`.
- **Optional runtime Worker** (`db/models/runtime_workers.py`): Worker,
  one-time enrollment, and integration-gateway token records.
- **Sandbox secret materialization** (`db/models/cloud/secrets.py`): persisted
  runtime/repository secret-application state.
- **Billing, orgs, auth, and other product domains**: each retains its own
  `db/models/**` and `db/store/**` owner.

Target, command-queue, exposure, and Cloud session-projection tables were
removed. Runtime session/event truth remains in AnyHarness rather than a Cloud
projection ledger.

## `db/store/`

All DB access lives here.

### Shape

Default: flat file per resource.

```text
db/store/
  __init__.py
  <resource>.py
```

Each store file owns DB access for **one ORM resource** (and its tightly-related
supporting tables — e.g., a junction table for many-to-many). The boundary is
the ORM model, not the product concept.

When ≥4 closely-related stores cluster, use a folder:

```text
db/store/<area>/
  __init__.py
  <resource>.py        # un-prefixed inside the folder
```

Inside the folder, file names drop the area prefix because context lives in
the folder name. Example: `db/store/cloud_mcp/connections.py`, not
`db/store/cloud_mcp/cloud_mcp_connections.py`.

Pick one shape per area. A folder either has all of its area's stores inside,
or none.

### Allowed

- `async def` functions taking `db: AsyncSession` as a parameter.
- `select(...)`, `insert(...)`, `update(...)`, `delete(...)`,
  `db.execute(...)`.
- ORM model imports from `db/models/**`.
- Frozen dataclasses returned to services (read-result snapshots).
- Internal SQL helpers as private functions (`_build_filter_clause`).
- Resource-specific constants (table aliases, query fragments) as module-level
  constants.

### Banned

- Opening a session inside a store function (`async with
  async_session_factory() as db`). Stores take a session; they don't open
  one.
- Calling `db.commit()` or `db.rollback()`. Callers own commits.
- Calling another store function from within a store. Stores are leaves;
  they don't call peers. If you need cross-store logic, that's service work.
- Importing `service.py`, integrations, FastAPI, or business code.
- Returning ORM objects to services. Always return frozen dataclasses.
- Mixing parameter-injected and self-opening patterns in the same file.

### Standard function shape

```python
@dataclass(frozen=True)
class WorkspaceSnapshot:
    id: UUID
    status: WorkspaceStatus
    runtime_generation: int
    created_at: datetime

async def get_workspace_snapshot(
    db: AsyncSession, workspace_id: UUID
) -> WorkspaceSnapshot | None:
    workspace = await db.get(CloudWorkspace, workspace_id)
    if workspace is None:
        return None
    return WorkspaceSnapshot(
        id=workspace.id,
        status=workspace.status,
        runtime_generation=workspace.runtime_generation,
        created_at=workspace.created_at,
    )

async def list_workspaces_for_owner(
    db: AsyncSession, owner_id: UUID
) -> tuple[WorkspaceSnapshot, ...]:
    rows = await db.execute(
        select(CloudWorkspace)
        .where(CloudWorkspace.owner_id == owner_id)
        .where(CloudWorkspace.deleted_at.is_(None))
    )
    return tuple(
        WorkspaceSnapshot(...)
        for w in rows.scalars().all()
    )
```

Reads return dataclasses or tuples of dataclasses. Writes return primitive
result types (`UUID`, `bool`, `None`) or a small frozen dataclass when more
information is needed.

### Eager loading

Stores explicitly load relationships needed for the snapshot. No lazy
attribute access leaks past the store boundary.

```python
# Good
rows = await db.execute(
    select(CloudWorkspace)
    .options(selectinload(CloudWorkspace.runtime_environment))
    .where(...)
)

# Bad — implicit lazy load when the service reads workspace.runtime_environment
rows = await db.execute(select(CloudWorkspace).where(...))
```

If the dataclass needs a relationship's data, the store eager-loads it. If
the relationship is only needed sometimes, define a separate read function
that loads it.

### Locking

Row-level locks live in stores, named `acquire_<resource>_<purpose>_lock`.
They require an open transaction.

```python
async def acquire_billing_subject_repo_limit_lock(
    db: AsyncSession, billing_subject_id: UUID
) -> None:
    await db.execute(
        select(BillingSubject)
        .where(BillingSubject.id == billing_subject_id)
        .with_for_update()
    )
```

Callers must wrap in a transaction (request session or
`async with db.begin():`).

### Pagination

Default to cursor pagination. The store returns a tuple
`(items, next_cursor)`:

```python
@dataclass(frozen=True)
class WorkspacePage:
    items: tuple[WorkspaceSnapshot, ...]
    next_cursor: str | None

async def list_workspaces_page(
    db: AsyncSession, *, owner_id: UUID, cursor: str | None, limit: int
) -> WorkspacePage:
    ...
```

Cursor encoding is a store concern. Services and handlers pass cursors as
opaque strings.

## The Type Pipeline

```
   db/models/<x>.py            db/store/<x>.py             server/<domain>/models.py
   ┌──────────────┐           ┌──────────────┐            ┌──────────────────┐
   │  ORM model   │ ────────▶ │  dataclass   │ ─────────▶ │  Pydantic model  │
   │  (mutable,   │  store    │  (frozen,    │  payload   │  (wire format,   │
   │  session)    │  function │  internal)   │  function  │  validated)      │
   └──────────────┘           └──────────────┘            └──────────────────┘

   Mapping #1: in the store function. Reads ORM, returns frozen dataclass.
   Mapping #2: in models.py. Takes dataclass, returns Pydantic.
   Service code only ever sees the dataclass.
```

### Why three layers

ORM models are mutable, session-coupled, and lazy-loading. Service code that
operates on them accidentally triggers DB calls and can corrupt persistence
state. Pydantic models carry wire-format concerns (validation, serialization)
that don't belong inside services. The dataclass is the isolation layer:
immutable, no behavior, no I/O, easy to test.

### Where dataclasses live

Default rule: **colocated with what owns them**.

- **Read-result dataclass** (returned from a store function) → defined in
  that store file.
- **Service-internal dataclass** (intermediate result) → defined in
  `service.py`.
- **Pure-domain dataclass** (state machine state, parsed value) → defined in
  `server/<domain>/domain/<concern>.py`.
- **Cross-resource composed dataclass** (workspace + runtime joined for one
  read) → defined in the store file that owns the read.

### Dataclass conventions

- `@dataclass(frozen=True)` for read-result dataclasses. Immutability prevents
  accidental mutation across calls.
- Fields are only what the service needs, not every ORM column. Trim
  aggressively.
- Use enums on dataclass fields, not strings. Wire-format string mapping
  happens in the Pydantic constructor.
- Naming: `<Resource>Snapshot` for read-result dataclasses
  (`WorkspaceSnapshot`). `<Resource>Update` / `<Resource>Insert` for mutation
  parameter dataclasses. Pure-domain dataclasses use whatever name fits.

### Pydantic constructor functions

Live in `server/<domain>/models.py`. Take dataclasses, return Pydantic.

```python
# server/cloud/workspaces/models.py
class WorkspaceResponse(BaseModel):
    id: UUID
    status: str
    runtime_generation: int

def workspace_response(snapshot: WorkspaceSnapshot) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=snapshot.id,
        status=snapshot.status.value,
        runtime_generation=snapshot.runtime_generation,
    )
```

The constructor is the only place enum-to-string conversion happens. Service
code stays on the enum side; wire stays on the string side.

### Forbidden type patterns

- Pydantic constructor functions taking ORM objects. Always take dataclasses.
- `model_config = ConfigDict(from_attributes=True)` to map ORM into Pydantic.
- Pydantic models reused as ORM substitutes or general internal containers.
- Services receiving ORM objects directly from any caller.
- Returning Pydantic from services to handlers. The handler calls the
  constructor function.

## Transactions

One pattern: **store functions take `db: AsyncSession` and never commit**.
Callers own transactions.

### HTTP handlers

The request session is provided by the FastAPI dep. The dep commits on
success and rolls back on exception:

```python
async def get_async_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

Multi-step writes within one request commit together because they share the
session.

### Workers and reconcilers

Open a session at the entry point, wrap operations in `async with db.begin():`:

```python
async def run_billing_reconcile_pass() -> None:
    async with async_session_factory() as db:
        async with db.begin():
            await store.repair_placeholders(db)
            await store.reconcile_segments(db)
        # commits on context exit, rolls back on exception
```

A worker service that must alternate repeated read-only database phases with
foreign I/O may instead receive an `async_sessionmaker[AsyncSession]` created by
the task. The task creates and disposes the engine within the current
`asyncio.run()` lifecycle. The worker service opens one bounded session around
direct store calls, materializes frozen values, closes the session, and only
then performs foreign I/O. This exception does not permit the service to import
settings or global engine helpers, construct an engine, issue SQL, call session
query methods, commit, or roll back.

### Narrower atomicity within a request

When a service needs an inner transaction smaller than the request, use
`db.begin_nested()`:

```python
async def cancel_subscription_with_seat_reconcile(
    db: AsyncSession, subscription_id: UUID, subject_id: UUID
) -> None:
    async with db.begin_nested():
        await store.subscriptions.mark_cancelled(db, subscription_id)
        await store.seats.reconcile_after_cancel(db, subject_id)
    # if anything in the block raises, only this savepoint rolls back
```

### Forbidden transaction patterns

- Store functions opening their own session.
- Store functions calling `db.commit()` or `db.rollback()`.
- Services calling `db.commit()` directly.
- `async with db.begin():` inside a store function. If narrower atomicity is
  needed, the caller wraps the call in `db.begin_nested()`.
- Transaction boundaries hidden inside store function names (`commit_x`,
  `transactional_y`). The boundary is at the caller.

## DB Column Conventions

### Required columns on every resource table

```sql
id           UUID         PRIMARY KEY  DEFAULT gen_random_uuid()
created_at   TIMESTAMPTZ  NOT NULL     DEFAULT now()
updated_at   TIMESTAMPTZ  NOT NULL     DEFAULT now()
```

`updated_at` auto-bumps on row update. Use SQLAlchemy
`onupdate=func.now()` consistently across models.

### Timestamps

- **Always `TIMESTAMPTZ`** (timezone-aware). Never naive `TIMESTAMP`.
- **Always UTC** at the application boundary.
- **DB defaults `now()`** for `created_at` / `updated_at`. Don't set them in
  app code unless overriding.
- **Python:** obtain generic application UTC timestamps from
  [proliferate.lib.infra.time.wall_clock.utcnow](../../server/proliferate/lib/infra/time/wall_clock.py).
  Ban `datetime.utcnow()` (returns naive — silent timezone bug source).

### Soft delete

- **Only when needed.** Most resources don't need soft delete; default to
  hard delete.
- When used: `deleted_at TIMESTAMPTZ NULL`. No `is_deleted` boolean.
- **Reads filter `deleted_at IS NULL` by default.** A separate function
  (`load_x_including_deleted`) reads soft-deleted rows when explicitly needed.

### UUIDs and foreign keys

- **All primary keys are UUID** with DB default `gen_random_uuid()`.
- **Foreign key column naming:** `<resource>_id` singular (`user_id`,
  `workspace_id`).
- **Foreign keys are NOT NULL** unless the relationship is genuinely optional.

### Enums

- **Python:** `StrEnum` (or regular `Enum` for non-string).
- **DB:** native Postgres enum (preferred) or `VARCHAR` with a `CHECK`
  constraint. Pick one project-wide.
- **Enum changes require migrations.** Adding, renaming, or dropping a value
  → alembic migration each time.
- **Dataclasses use the Python enum** for the field type. Wire serialization
  happens in the Pydantic constructor.

### Index and constraint naming

Configure SQLAlchemy's metadata naming convention once so this is automatic:

- Indexes: `ix_<table>_<column>[_<column>...]`
- Unique: `uq_<table>_<column>[_<column>...]`
- Foreign keys: `fk_<table>_<column>`
- Primary keys: `pk_<table>`
- Check constraints: `ck_<table>_<description>`

### Forbidden DB patterns

- `TIMESTAMP` without timezone.
- `datetime.utcnow()` anywhere.
- `is_deleted` boolean.
- Foreign keys named without `_id` suffix.
- Raw integer primary keys for new resources.
- Lazy ORM attribute access leaking past the store boundary.

## Migrations

All schema changes go through alembic. Each schema migration is its own
revision. Data migrations and schema migrations are not mixed in one
revision unless the data migration is required for the schema change to land
safely.

Conventions:

- Migration revision filenames follow alembic's default scheme.
- Each migration's `upgrade()` and `downgrade()` are reviewed together.
- Adding a NOT NULL column to an existing table requires a backfill plan
  (default value at the DB level, or a multi-step migration that adds
  nullable, backfills, then sets NOT NULL).
- Renaming a column or table requires a multi-step migration when the
  application is running during the change.

---

# Background Work

Background work is everything the product does outside the request lifecycle:
periodic polls, drift reconciliation, and durable jobs triggered by a state
change. There is **one execution model** for all of it — a Celery task — and the
only thing that differs is the trigger.

## One unit, two triggers

Celery is the framework, RabbitMQ is the broker that delivers tasks to the
worker fleet, Postgres is the truth, and Redis holds the `redbeat` lock that
makes Beat highly available (Redis is a lock, never the broker). Every piece of
background work is the same unit — a **task** — and only the trigger differs:

| Trigger | Fires | For |
| --- | --- | --- |
| **Beat** (periodic) | on a clock, via `redbeat` | scheduler polls, surviving reconciler passes, batched telemetry |
| **Outbox relay** (on-demand) | when a committed state change demands follow-up work | execution jobs that must not be lost |

There are no bespoke `while True` loops and no per-domain worker processes. A
scheduler is a Beat-fired task that polls due work and writes run
rows plus outbox rows; it does not execute. A reconciler is a Beat-fired task
that survives only for **external-truth drift** and enqueues heavy corrective
work as on-demand tasks. A durable job is a task delivered by the relay,
idempotent on a job id, retried by the broker, and observable.

Work that is request-driven HTTP — an *external* process claiming, heartbeating,
or reporting against a Postgres-backed lease — is **not background work**. It is
an API. It stays near `api.py`/`service.py` in its domain and is never moved
behind Celery.

## Ownership

Two homes, split by a single boundary: substrate versus product logic.

| Concern | Lives in | Owns |
| --- | --- | --- |
| **Substrate** | `server/proliferate/background/**` | the Celery app, broker/queue/redbeat config, the Beat schedule registry, the outbox relay, and thin task modules |
| **Worker-facing logic** | `server/<domain>/**` | the service a task calls to do the domain's work, and the pure `domain/` logic it shares with HTTP paths |

`background/**` is plumbing. It knows how to run a task, when to fire periodic
ones, and how to turn a committed outbox row into a dispatched task. It owns no
business logic. A task module is a thin wrapper: it owns the database
engine/session boundary, calls the owning domain's public service, and maps
failures to retries.

`server/<domain>/**` owns the work itself. A task for a domain calls that
domain's service. The service follows the same layer law as API-facing code:
it never commits, imports SQLAlchemy query APIs, or constructs vendor clients,
and it calls store functions for data and integrations through their public
API. It normally takes `db: AsyncSession`. A worker service that alternates
bounded database phases with foreign I/O may instead take a task-created
session factory, open sessions only around store calls, and release them before
the external call.

## Axes

Route any background concern with two questions:

```text
request-driven HTTP claim/lease by an external process  -> not background; an API near api.py
fires on a clock                                         -> Beat-fired periodic task
fires because a committed state change needs follow-up   -> outbox relay task
```

And place the work it runs:

```text
the task wrapper itself (own DB boundary, call service) -> background/tasks/<area>.py
worker-facing orchestration (pick due, dispatch, record) -> server/<domain>/worker/service.py
pure computation shared with HTTP paths                  -> server/<domain>/domain/
```

A domain promotes `worker/` only when its worker-facing orchestration is
substantial and distinct from the API-facing service. Until then the task calls
the domain's ordinary `service.py`.

## Shape

```text
server/proliferate/background/
  celery_app.py        # the single Celery() app; task autodiscovery
  config.py            # broker, queues, routing, retry, redbeat, eager-test
  beat_schedule.py     # periodic registry: every X -> task Y (redbeat entries)
  relay.py             # outbox -> Celery: read committed rows, dispatch, mark relayed
  tasks/
    <area>.py          # thin @app.task wrappers; own DB boundary; call domain service

server/<domain>/
  service.py           # API-facing and, when modest, worker-facing orchestration
  domain/
    <concern>.py       # pure logic shared by API and background paths
  worker/              # only when worker-facing orchestration is substantial
    service.py         # pick due work, dispatch, record results, handle failures
```

A domain that runs background work owns at most a `worker/service.py` and shared
`domain/` logic. It does not own a process entry point, a scheduler, or a
reconciliation loop — those are the substrate's job (Beat) or do not exist (one
process is the Celery worker fleet).

The Cloud orphan-sandbox reaper is the concrete periodic example: Beat owns its
five-minute schedule, `background/tasks/cloud_sandboxes.py` only opens a session
and calls the domain, and `server/cloud/worker/` owns the advisory singleton,
provider attribution, grace window, and cleanup decisions.

## The outbox

On-demand jobs that must survive a restart use the **transactional outbox**. The
caller writes the state change and an outbox row in the **same caller-owned
transaction**; once that transaction commits, the job is guaranteed. The relay
reads committed outbox rows, dispatches the matching task, and marks the row
relayed. The broker then delivers, retries, and dead-letters.

```text
caller txn { state change + outbox row }  ->  commit  ->  relay  ->  broker  ->  task
```

This is the only correct way to enqueue work that must be consistent with a
state change. `asyncio.create_task(...)` and after-commit `loop.create_task(...)`
are not durable — they are lost on restart with no retry and no backpressure —
and are forbidden for work whose loss is a correctness bug. Loose,
fire-and-forget notifications with explicit at-most-once tolerance may enqueue a
task directly without the outbox, but the looseness must be deliberate.

**External-side-effect pattern (outbox):** a named orchestration function owns an
explicit multi-transaction sequence — write "pending" + commit → external call
(no open txn) → write result + commit — *or*, preferably, write the intent + an
outbox row and let a worker do the call.

Integration credential revocation is a current outbox consumer
(`integrations.revocation.process`): the revocation job row is written with the
intent, the outbox row rides the same transaction, and the worker's operation
is idempotent under broker redelivery.

## `background/celery_app.py`

The single Celery application every task and the relay import.

- Owns: the `Celery()` instance, task autodiscovery, and the shared app handle.
- Imports: `celery`, `background/config`.
- Never imports: domain services, `db/store`, or `integrations`. The app is
  substrate; it does not know what any task does.

## `background/config.py`

All broker and framework settings in one place.

- Owns: broker URL, result backend, queue and routing declarations, retry and
  dead-letter policy, `redbeat` settings, and the eager flag for tests.
- Imports: `config` (env-derived values), Celery config types.
- Never holds: business values. Product/protocol constants live in
  `constants/<area>.py`; env values live in `config.py`.

## `background/beat_schedule.py`

The periodic registry — the single list of what runs on a clock.

- Owns: `every X -> task Y` entries and their `redbeat` registration.
- Imports: task references by dotted path, scheduling constants.
- Never holds: a loop body or business logic. Beat fires tasks; the task does
  the work. There is no "scheduler loop" module — the schedule is data.

## `background/relay.py`

The bridge from the durable outbox to the broker.

- Owns: reading committed outbox rows, dispatching the matching task, and
  marking rows relayed; idempotent so a re-run never double-dispatches a job id.
- Imports: `db/store` (the outbox store and fixed-cardinality, read-only
  operational snapshots), `celery_app`, task references.
- Is the only `background/` module that touches a store. It carries no product
  mutation or routing policy beyond the supported task registry. Read-only
  operational snapshots may expose counts and ages only; they never expose
  identifiers, request payloads, responses, or credentials.

## `background/tasks/<area>.py`

Thin task wrappers — the boundary between the broker and a domain.

- Owns: the `@app.task` function, the database engine/session boundary, the call
  into the owning domain's public service, and the mapping of failures to
  retries. A synchronous task using `asyncio.run()` creates and disposes its
  engine inside that event-loop lifecycle rather than reusing a module-global
  async engine across firings.
- Imports: `celery_app`, the owning domain's service, and the session machinery.
- Never holds: business logic, SQLAlchemy queries or ORM imports, or raw vendor
  clients. A task that grows logic has put it in the wrong layer — push it into
  the domain's service or `domain/`.

```python
# background/tasks/cloud_sandboxes.py
async def _run_orphan_reap() -> None:
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            await run_orphan_sandbox_reap_pass(db)
    finally:
        await engine.dispose()
```

## `server/<domain>/worker/service.py`

The worker-facing orchestration a task calls — present only when it is
substantial and distinct from the API-facing service.

- Owns: picking due work, dispatching to the right execution, recording results,
  and handling failures, as ordinary service functions.
- Imports: `db/store`, `domain/`, `integrations` through their public API.
- Same layer law as any service: normally takes `db: AsyncSession`, never
  commits, never imports SQLAlchemy query APIs, and never constructs vendor
  clients. When foreign I/O must alternate with multiple bounded database
  phases, it may take the task-created `async_sessionmaker[AsyncSession]`, open
  sessions only around direct store calls, and release each before foreign I/O.
  The task creates and disposes the engine; the service cannot import settings
  or global engine helpers, construct an engine, issue SQL, or call session
  query/commit/rollback methods.

When the worker-facing surface is modest, these functions live in the domain's
ordinary `service.py` and there is no `worker/` subfolder. Two `service.py`
files at the same nesting are forbidden; promote to `worker/service.py` only when
worker-facing logic is genuinely separate from API-facing logic, and let both
share `domain/` and the stores.

## Rules

- One execution model: a Celery task. Beat fires the periodic ones; the outbox
  relay fires the on-demand ones. No bespoke loops, no per-domain processes.
- Substrate lives in `background/**`; the work a task performs lives in
  `server/<domain>/**`. `background/tasks/**` is thin and calls a domain service.
- Correctness-sensitive enqueue uses the outbox in the caller's transaction.
  Detached `asyncio.create_task` / after-commit `loop.create_task` is forbidden
  for work whose loss is a bug.
- Reconcilers survive only for external-truth drift and enqueue heavy corrective
  work as tasks; the broker's acks, retries, and dead-letters absorb
  internal-loss cases that bespoke reconcilers used to compensate for.
- Schedulers poll and materialize (run rows + outbox rows); they do not execute.
- External-process claim/heartbeat/report surfaces are APIs, not workers, and are
  never moved behind the broker. They stay near `api.py`/`service.py`.
- `background/**` imports no domain service except through a task module, and
  only `relay.py` touches stores (outbox writes plus read-only bounded
  operational snapshots).
- No task module imports ORM or constructs vendor clients. It owns the
  current-event-loop engine/session-factory lifetime and either opens the
  session itself or passes the factory to the narrow bounded worker-service
  pattern.

## Smells

- a `while True` reconciliation loop or a `worker.py` process entry point → it is
  the old model; the loop is a Beat-fired task and the process is the Celery fleet
- business logic, a store call, or a vendor client inside `background/tasks/**` →
  push it into the owning domain's service
- `asyncio.create_task(...)` for work that must not be lost → use the outbox
- a `scheduler.py` holding a loop body → Beat owns the schedule; the schedule is
  data in `beat_schedule.py`
- two `service.py` files at the same nesting → keep one API-facing service, or
  promote the worker-facing one into `worker/service.py`
- a `background/` module reaching into a domain's internals → route by task kind;
  the domain's public service owns the work

## Current gaps

Everything above this section is the current operating model, with each rule's
enforcement status stated inline where it is not mechanically checked. Each
unchecked item below is a concrete path that still departs from it — public debt,
not a softer version of the rule.

- [ ] **Billing reconciliation.**
      ``_billing_reconciler_loop`` (deleted, cull part 2)
      is started by `start_billing_reconciler` from the
      [`main.py` lifespan](../../server/proliferate/main.py) when
      `cloud_billing_mode` is `observe` or `enforce`;
      `run_background_workers` makes the starter a no-op. Each pass runs
      immediately, reports unexpected failures through `report_critical` and
      continues, then sleeps
      `max(BILLING_RECONCILE_INTERVAL_SECONDS, 30)` seconds. The
      [Billing contract](../systems/billing/deep-dive.md) describes the
      normal interval as fifteen minutes. Conversion is parked because ordinary
      self-host deployment does not run the Celery worker, Beat, or broker
      plane; moving this pass to Beat first would silently stop enforcement and
      reconciliation there.
- [ ] **Anonymous Server version telemetry.**
      [`_sender_loop`](../../server/proliferate/server/anonymous_telemetry/worker.py)
      is started by `start_server_anonymous_telemetry_sender` from the
      [`main.py` lifespan](../../server/proliferate/main.py) whenever
      anonymous telemetry is enabled. It is not gated by
      `run_background_workers`; it emits once immediately and then every 24
      hours, while failures are captured and logged and the loop continues.
      Conversion is parked for the same deployment-parity reason: self-host API
      installations currently emit this heartbeat without a Celery worker or
      Beat process, so a Beat-only move would silently remove it.
- [ ] **Agent Gateway enrollment backfill.**
      [`_backfill_loop`](../../server/proliferate/server/agent_auth/worker.py)
      is started by `start_agent_gateway_enrollment_backfill` from the
      [`main.py` lifespan](../../server/proliferate/main.py) when both
      Agent Gateway and `run_background_workers` are enabled. It runs
      immediately, catches unexpected failures, reports them through
      `report_critical`, and continues, then sleeps
      `agent_gateway_backfill_interval_seconds`. Conversion remains
      analysis-only until deployment parity, singleton and overlap behavior,
      the existing feature and worker gates, immediate-first-run cadence, and
      retry and replay behavior are characterized for a Beat-fired task.
- [ ] **Agent Gateway usage import.**
      [`_usage_import_loop`](../../server/proliferate/server/agent_auth/worker.py)
      is started by `start_agent_gateway_usage_import` from the
      [`main.py` lifespan](../../server/proliferate/main.py) under the
      same Agent Gateway and `run_background_workers` gates. It runs
      immediately, catches unexpected failures, reports them through
      `report_critical`, and continues, then sleeps
      `agent_gateway_usage_import_interval_seconds`. Conversion remains
      analysis-only until deployment parity, singleton and overlap behavior,
      the existing gates, immediate-first-run cadence, and retry and replay
      behavior are characterized for a Beat-fired task, including safe replay
      of LiteLLM spend-log paging and credit-exhaustion effects.
- [ ] **Agent Gateway LLM top-up.**
      [`_topup_loop`](../../server/proliferate/server/agent_auth/worker.py)
      is started by `start_agent_gateway_llm_topups` from the
      [`main.py` lifespan](../../server/proliferate/main.py) only when
      Agent Gateway, top-up configuration, and `run_background_workers` enable
      it. It runs immediately, catches unexpected failures, reports them
      through `report_critical`, and continues, then sleeps
      `agent_gateway_topup_interval_seconds`. Conversion remains analysis-only
      until deployment parity, singleton and overlap behavior, the existing
      gates, immediate-first-run cadence, retry and replay behavior for charge
      and top-up effects, and exact configuration parity are characterized for
      a Beat-fired task.
- [ ] **One-off health enqueue store client.**
      [`enqueue_health.py`](../../server/proliferate/background/enqueue_health.py)
      is a one-off deployment proof command, not a task or loop, but it writes
      directly through the background-outbox store. This is a concrete
      exception to the target body's rule that `relay.py` is the only
      `background/**` store client. It remains a placement and law gap; this
      documentation slice does not decide whether the utility moves or the
      target law later gains a narrow deployment exception.

Deployment evidence: the ordinary production self-host
[`docker-compose.production.yml`](../../server/deploy/docker-compose.production.yml)
defines the base API stack but no RabbitMQ, Celery worker, or Beat service. The
development [`docker-compose.yml`](../../server/docker-compose.yml)
makes `worker` and `beat` opt-in through the `background` profile.
[`run_background_workers`](../../server/proliferate/config.py) defaults
to true, and the current [`main.py` lifespan](../../server/proliferate/main.py)
keeps periodic work in the API process unless each starter's own gates disable
it.

---

# Config And Constants

Server values have three homes: deployment-derived settings, shared product or
protocol constants, and private file-local implementation details. Put each
value in the narrowest home that makes its ownership obvious.

## Ownership

The server has three homes for values:

| Value kind | Home | Question |
|---|---|---|
| Env-derived runtime setting | `config.py` | Can this vary by deployment, environment, secret, or operator choice? |
| Shared hardcoded policy value | `constants/<area>.py` | Is this a product/protocol rule reused or meaningful outside one file? |
| File-local mechanical value | the owning file | Is this only an implementation detail of one function/module? |

Do not leave product policy values scattered through `api.py`, `service.py`,
`db/store/**`, worker files, or integrations.

## `config.py`

`config.py` owns runtime settings derived from environment or deployment
configuration.

Put it here when the value is:

- a secret or credential
- a hostname, URL, origin, issuer, bucket, role ARN, or external endpoint
- a feature flag
- a timeout, limit, or mode that operators may tune per deployment
- local-dev/self-hosted/production-specific

Examples:

```python
DATABASE_URL = os.environ["DATABASE_URL"]
STRIPE_WEBHOOK_SECRET = os.environ["STRIPE_WEBHOOK_SECRET"]
CLOUD_RUNTIME_BASE_URL = os.getenv("CLOUD_RUNTIME_BASE_URL", "http://localhost:...")
ENABLE_BILLING_RECONCILER = env_bool("ENABLE_BILLING_RECONCILER", default=False)
```

Rules:

- Do not import product services or stores from `config.py`.
- Do not put hardcoded product constants here just because many files need
  them.
- `localhost` defaults are allowed here. They are not allowed scattered in
  services, stores, or integrations.
- Integration files read credentials and vendor endpoints from `config.py`.

## `constants/<area>.py`

`constants/**` owns hardcoded shared values that are part of product behavior,
protocol behavior, or validation policy.

Put it here when the value is:

- reused by more than one file
- a product limit, validation bound, timeout, retry count, page size, or
  default policy
- a protocol label, header name, sentinel value, or status string
- meaningful enough that changing it is a product decision
- part of an API-visible contract, even if only one parser or service uses it
  today

Examples:

```python
# constants/billing.py
DEFAULT_TRIAL_DAYS = 14
USAGE_RECONCILE_BATCH_SIZE = 500

# constants/cloud.py
WORKSPACE_NAME_MAX_LENGTH = 120
CLOUD_RUNTIME_CONNECT_TIMEOUT_SECONDS = 30

# constants/http.py
REQUEST_ID_HEADER = "x-request-id"
```

Rules:

- Constants use `UPPER_SNAKE_CASE`.
- Organize by area: `billing.py`, `cloud.py`, `auth.py`, `http.py`.
- Do not create `constants/misc.py`, `constants/common.py`, or
  `constants/helpers.py`.
- If a value becomes deployment-specific, move it from `constants/**` to
  `config.py`.

## File-Local Constants

File-local constants are allowed only when they are mechanical implementation
details with no broader product meaning. Do not keep a value local just
because it has one caller; if changing it changes product behavior, API
behavior, billing behavior, security behavior, or runtime protocol behavior,
put it in `constants/<area>.py` or `config.py`.

Allowed examples:

```python
_OWNER_ALIAS = "owner"
_CURSOR_SEPARATOR = ":"
_EMAIL_RE = re.compile(...)
_DATEUTIL_ANCHOR_YEAR = 2020
```

These values may stay in the file that owns the implementation.

Banned examples:

```python
MAX_WORKSPACES_PER_ORG = 10
DEFAULT_AUTOMATION_TIMEOUT_SECONDS = 600
RETRY_COUNT = 5
SUPPORTED_RUNTIME_VERSION = "..."
SUPPORTED_PROTOCOL_OPTIONS = {"mode", "interval", "timeout"}
```

Those carry product or protocol policy and belong in `constants/<area>.py` or
`config.py`.

## Placement Test

Ask these in order:

1. **Can an operator change it by env/deployment?** Put it in `config.py`.
2. **Does changing it alter product/protocol behavior?** Put it in
   `constants/<area>.py`.
3. **Is it only a private mechanical detail in one file?** Keep it
   file-local.

If unsure, prefer `constants/<area>.py` over scattering the value inline.

---

# Errors

Server errors have three homes: shared product error bases, domain-specific
product errors, and integration-local vendor errors. Product services raise
product/domain errors; one HTTP translation boundary turns them into responses.

## Ownership

The server has three error layers:

| Layer | Home | Owns |
|---|---|---|
| Shared product errors | `server/proliferate/errors.py` | Base class and common HTTP-shaped categories. |
| Domain errors | `server/<domain>/errors.py` | Product/domain failures with stable error codes. |
| Integration errors | `integrations/<vendor>/errors.py` or the integration file | Vendor/protocol failures. |

HTTP translation is centralized. Product services raise product/domain errors;
the FastAPI exception handler maps those errors to the JSON response shape.

## Shared Product Errors

`server/proliferate/errors.py` owns the common base and generic categories:

```python
class ProliferateError(Exception):
    code: str
    message: str
    status_code: int


class NotFoundError(ProliferateError): ...
class PermissionDenied(ProliferateError): ...
class Conflict(ProliferateError): ...
class InvalidRequest(ProliferateError): ...
```

The exact class names may grow with usage, but the shape is stable:

- `code` is the stable machine-readable error code.
- `message` is the client-facing message.
- `status_code` is the HTTP status chosen by the product error type.

Do not make shared errors know about any one product domain.

## Domain Errors

Domain errors live beside the domain they describe:

```text
server/<domain>/
  errors.py
  service.py
  api.py
```

Use a domain error when the failure is product behavior:

- missing resource
- forbidden action
- invalid domain input
- conflict with current state
- product limit reached
- domain-specific unavailable state

Domain errors inherit from the shared base or one of the shared categories.

```python
class ResourceNotReady(Conflict):
    code = "resource_not_ready"

    def __init__(self, message: str) -> None:
        super().__init__(message=message)
```

Services raise domain errors. APIs do not catch and translate them in each
route; the global handler owns translation.

## Integration Errors

Integration errors stay inside the integration boundary.

```text
integrations/<vendor>/
  errors.py
  client.py
```

Integration errors should describe vendor/protocol failures, not product
meaning. They do not inherit from `ProliferateError`.

Product services catch integration errors and translate them into domain
errors:

```python
try:
    result = await vendor_call(...)
except VendorIntegrationError as exc:
    raise DomainUnavailable("Could not complete the operation.") from exc
```

That translation is where product meaning enters.

## HTTP Translation

The FastAPI app registers one handler for `ProliferateError` subclasses.

The response shape is:

```json
{
  "detail": {
    "code": "stable_error_code",
    "message": "Client-facing message."
  }
}
```

Route files should not repeat this translation:

```python
# Bad
try:
    await service.do_work(...)
except DomainError as error:
    raise HTTPException(
        status_code=error.status_code,
        detail={"code": error.code, "message": error.message},
    )
```

Use the global handler instead:

```python
# Good
await service.do_work(...)
```

`AuthFlowError` is a legacy Auth protocol compatibility exception translated by
that same global handler. It preserves the already-shipped raw string
`{"detail": "Client-facing message."}` response while keeping its stable
internal code out of the public response. This exception exists only for
compatibility with existing Auth clients; it is not a general shortcut for new
product errors, which use the structured envelope above.

## Direct `HTTPException`

Direct `HTTPException` is allowed only at actual HTTP boundaries:

- framework authentication/authorization dependencies that integrate directly
  with FastAPI
- routes returning non-product assets or callback pages where the response is
  not the normal JSON error contract

It is banned in:

- `db/store/**`
- `server/<domain>/domain/**`
- integrations
- pure helpers
- stores or service internals that can raise a product/domain error instead

## Catching And Wrapping

Allowed:

- Service catches an integration error and raises a domain error.
- Service catches a known lower-level product error and maps it to a
  more-specific domain error.
- Worker entry points catch unexpected exceptions to log/report and then
  either re-raise or record failure state.

Banned:

- Broad `except Exception` that swallows the error.
- Catching a domain error in an API route only to reformat it.
- Integration code catching its own error type to produce an HTTP response.
- Domain errors wrapping unrelated exceptions without adding product meaning.

---

# Server Lib

`lib/**` is reusable cross-domain logic — the product concerns, integration capabilities, and generic machinery that more than one domain needs, that no single domain owns, that are not raw vendor clients, and that own no durable state and no product policy. It is the smallest layer: almost everything has a more specific home, so `lib/` is the last resort, not the default.

## Placement

Route by this. If nothing fits cleanly, it does not belong in `lib/`:

```text
raw third-party SDK/API access                   -> integrations/
generic, dumb (no product, no vendor, no DB)     -> lib/infra/
cross-domain PURE product logic (no I/O)         -> lib/product/
cross-domain orchestration over a vendor (I/O)   -> lib/capabilities/
single-domain pure logic                         -> server/<domain>/domain/
owns durable state or product policy             -> a domain (its service.py / db/store)
```

Two axes route everything: **product-aware?** (no → `infra`) and **does I/O?** (no → `product`, yes via a vendor → `capabilities`). Single-domain logic stays with its domain; cross-domain logic lives in `lib/`.

## Sub-areas

Each sub-area is defined by its import boundary.

| Sub-area | Product-aware? | Does I/O? | May import | Owns |
| --- | --- | --- | --- | --- |
| `lib/infra/` | no | no | low-level/generic libraries only | ids, time, batching, safe parsing, generic string utils |
| `lib/product/` | yes | no | `lib/infra`, `constants`, `config`, other `lib/product` | message/prompt building, product-aware formatting, shared validation, vocabulary, projections |
| `lib/capabilities/` | yes | yes | `integrations/`, `lib/product`, `lib/infra`, `constants`, `config` | reusable orchestration over a vendor (`llm_providers`, embeddings) |

## Boundaries

1. A concern belongs in `lib/` only when two or more domains share it. Single-consumer logic lives in `server/<domain>/domain/` and moves into `lib/` on the second consumer.
2. `lib/` owns no durable product state and no product policy. No `lib/` file imports `db/store`. `lib/` provides the reusable *how*; domains own the *what, when, and persist*.
3. `lib/` never imports `server/<domain>/**`. `lib/product/` additionally never imports `integrations/`.
4. Each concern is a folder with a narrow public API (`__init__.py`) and owns one noun-able concern. No loose files at any sub-area root. Generic helpers live in `lib/infra/`; there is no `utils/`, `helpers/`, `common/`, or `misc/` bucket.
5. A concern that grows durable state or product policy becomes a domain (`server/<domain>/`). A concern used by only one domain belongs in that domain's `domain/`.

## Shape

```text
server/proliferate/lib/
  infra/
    <technical-concern>/
      <helper>.py
  product/
    <concern>/
      __init__.py        # narrow public surface domains import
      <core>.py
      models.py          # concern-owned types, not product/db records
      <concern>.py
  capabilities/
    <capability>/
      __init__.py        # narrow public surface
      <core>.py          # orchestration over the integration
      selection.py       # provider/strategy selection when applicable
      models.py
```

## `lib/infra/`

Generic technical machinery with no product vocabulary and no vendor.

- Owns: ids and stable keys, time, scheduling, batching, safe JSON parsing, generic string and number formatting, measurement plumbing.
- Does not own: any product concept (sessions, workspaces, billing) — that is `product`.
- Imports: low-level and generic libraries only. Never `integrations/`, `db/store`, or `server/<domain>`.

A function that knows the product belongs in `product`; a vendor SDK belongs in `integrations`.

## `lib/product/`

Cross-domain pure product logic — product-aware, no I/O.

- Owns: message and prompt construction, product-aware formatting such as status-to-display copy, shared validation and vocabulary, cross-domain projections and view models.
- Does not own: durable state or product policy. Performs no I/O.
- Imports: `lib/infra`, `constants`, `config`, other `lib/product`. Never `integrations/`, `db/store`, network clients, or `server/<domain>`.

Pure functions: data in, decision, string, or model out. Single-domain pure logic stays in `server/<domain>/domain/`; only the shared part lives here.

## `lib/capabilities/`

Cross-domain capabilities that orchestrate integrations — product-aware, does I/O.

- Owns: the reusable operation over a vendor — provider and strategy selection, request building, retries, async offload — plus capability-owned types. `lib/capabilities/llm_providers` exposes `prompt(provider, messages)`.
- Does not own: durable product state or product policy. Not a raw vendor client — that is `integrations/`.
- Imports: `integrations/`, `lib/product`, `lib/infra`, `constants`, `config`. Never `db/store` or `server/<domain>`.

Stateless and dependency-injected: take the client, config, and data as arguments. No hidden module-level singletons. Blocking SDK calls run off the event loop.

## Example

The title-generation feature across the layers:

```text
integrations/llm_providers/        raw OpenAI/Anthropic clients, vendor models and errors
lib/capabilities/llm_providers/    prompt(provider, messages): selection, retries, async
lib/product/titles/                build_title_prompt(), normalize_title()
server/ai_magic/service.py         generate_and_save_title(): builds the prompt, calls the
                                   capability to generate, calls the store to save
```

`integrations` is the raw client; `lib/capabilities` is the reusable I/O operation over it; `lib/product` is the pure prompt and formatting logic; the domain composes them, persists, and decides. Nothing in `lib/` touches the database or decides product policy.

## Rules

- `lib/` is the last resort: default domain-local, and a concern enters only at two or more consumers.
- No `lib/` file imports `db/store` or `server/<domain>/**`. No durable state or product policy in `lib/`.
- `lib/product/` is pure: it does not import `integrations/` or perform I/O.
- Each concern is a folder with a public `__init__.py`. Generic helpers live in `lib/infra/`; there is no `utils/`, `helpers/`, `common/`, or `misc/` bucket.
- `lib/capabilities/` is stateless and dependency-injected; no hidden singletons; blocking work runs off the event loop.

## Smells

- a `lib/` file imports `db/store` or writes product rows → it is a domain
- a `lib/` file decides who-can, when, or billing → product policy → a domain
- a concern is used by only one domain → it belongs in that domain's `domain/`
- a `lib/product/**` file imports `integrations/` → it is not pure; it is a capability
- a `helpers.py` or `utils.py` appears → name the concern, or it is `infra`
- `lib/` imports a domain service → invert it and pass data or dependencies in

---

# Integrations

Integrations are the server's raw external access boundary. Product domains
call integration public APIs; integrations own vendor clients, vendor wire
types, authentication, retries, and protocol translation.

## Ownership

`integrations/` owns all third-party SDK and API access. Every external
network call originates here. Product code calls integrations through their
public API only; integration internals stay vendor-local.

Integration code owns:

- Vendor client construction
- Authentication and credential handling for the vendor
- Payload normalization (request/response shape adjustments)
- Vendor-specific error handling and retry policies
- Webhook signature verification (when applicable)
- Vendor-specific data types

Integration code does not own:

- Product business logic.
- Database access (no `db/store/**` imports).
- Service-layer orchestration.

Hosted product state that controls whether an external action may proceed is
therefore not an integration concern. The durable action-approval state
machine lives under
`server/integration_gateway/connections/action_approvals/`, with persistence in the hosted
Cloud database. Raw MCP/provider clients remain leaves beneath that boundary.

## Shape

Three legal shapes, picked by what the integration is.

### Shape 1: Single file (default)

```text
integrations/<vendor>.py
```

For simple integrations: one vendor, one cohesive purpose, < 300 lines.

Inside the file:

- Error class for the vendor's failures.
- Client construction or authentication setup.
- Payload dataclasses (when the integration parses structured responses).
- Public functions exported to product code.

Examples: `anthropic.py`, `github.py`, `resend.py`,
`anonymous_telemetry.py`.

### Shape 2: Folder, single provider

```text
integrations/<vendor>/
  __init__.py
  client.py
  models.py
  errors.py
  <concern>.py
```

For a vendor with multiple distinct concerns: auth + webhooks + OAuth flows,
or any set of features that don't fit cleanly in one file.

- `client.py` — base client, authentication, low-level calls.
- `models.py` — typed payload dataclasses (or Pydantic if parsing untrusted
  input from the vendor).
- `errors.py` — error types raised by the integration.
- `<concern>.py` — distinct features: `webhooks.py`, `oauth.py`,
  `notifications.py`.
- `__init__.py` — exports the public API. Internals stay vendor-local.
  This is the explicit Python-package exception to the repo-wide no-barrel
  rule; use it only for integration package public APIs.

Examples: `slack/` with `webhooks.py` + `errors.py`; `sentry/` with `client.py`
(SDK lifecycle and validated public ingress) + `privacy.py` (the closed
catalogs and outbound projection), where `__init__.py` is the export boundary.

Concern files should be coarse and meaningful. Do not mechanically mirror
every endpoint, REST resource, or SDK method into its own file. Start with the
operational seams that product code naturally cares about: auth, webhooks,
OAuth, sessions, provisioning, file operations, notifications, etc. Split
further only when a concern file grows large, has a distinct consumer set, or
contains multiple independent policies.

### Shape 3: Folder, polymorphic

```text
integrations/<protocol>/
  __init__.py
  base.py
  <provider>.py
  factory.py
  models.py
  errors.py
```

For multiple vendors implementing the same protocol where product code
selects an implementation at runtime.

- `base.py` — abstract interface or protocol that all providers implement.
- `<provider>.py` — each implementation when multiple providers exist.
- `factory.py` — provider selection logic (config-driven, identity-driven,
  etc.).
- `models.py` — shared types across providers.
- `errors.py` — shared error types raised by any provider.
- `__init__.py` — exports the factory and shared types.

Example: `sandbox/` with `base.py`, `e2b.py`, `factory.py`.

## Picking a Shape

| You have | Pick |
|---|---|
| One vendor, < 300 lines, one concern | Shape 1 (single file) |
| One vendor, multiple distinct concerns | Shape 2 (single-provider folder) |
| Multiple vendors implementing the same protocol | Shape 3 (polymorphic folder) |

Shape changes when ownership changes:

- Single file → single-provider folder when concerns split (extract
  webhooks, OAuth, etc.).
- Single-provider folder → polymorphic folder when a second vendor is added
  for the same protocol.
- Coarse concern file → narrower concern files only after the narrower split
  earns its place. Avoid endpoint-per-file structures by default.

## What Goes Inside an Integration

### Error class

Every integration defines its own error type. Local to the vendor.

```python
class StripeIntegrationError(Exception):
    """Raised on failures talking to Stripe."""
```

For folder integrations, the error class lives in `errors.py`. For
single-file integrations, it's defined at the top of the file.

Integration error types do **not** inherit from the shared
`server/proliferate/errors.py` base (`ProliferateError`). The product
service catches integration errors and translates to domain errors as
needed.

### Public API

The functions exported to product code. These are what services call.

For single-file integrations, the public API is whatever the file exports
(non-underscore-prefixed names).

For folder integrations, the public API is what `__init__.py` exports.
Everything else stays vendor-local.

This `__init__.py` export surface is intentional for integration packages:
services import the vendor API from one stable package boundary while
integration internals remain private. Do not use this pattern as a general
convenience re-export elsewhere in the server tree.

```python
# integrations/stripe/__init__.py
from .client import create_stripe_customer, retrieve_stripe_subscription
from .webhooks import verify_stripe_webhook
from .errors import StripeIntegrationError

__all__ = [
    "create_stripe_customer",
    "retrieve_stripe_subscription",
    "verify_stripe_webhook",
    "StripeIntegrationError",
]
```

### Models

Vendor-specific request/response shapes. Use dataclasses by default;
Pydantic when parsing structured untrusted input (webhook payloads).

For folder integrations, models live in `models.py`. For single-file
integrations, they're inline.

### Vendor-specific configuration

Integration files read from `config.py` for credentials and endpoints. They
do not hardcode URLs or secrets.

## Allowed in Integrations

- HTTP client libraries (`httpx`, vendor SDKs).
- Webhook signature verification.
- Credential retrieval from `config.py`.
- Vendor-specific retry, backoff, and timeout policies.
- Payload normalization (snake_case ↔ camelCase, etc.).
- Throwing the integration's own error type on failure.

## Banned in Integrations

- Product business logic. The integration translates to/from the vendor;
  it does not decide what to do with the result.
- `db/store/**` imports. Integrations don't touch the database.
- Service.py imports. Integrations are leaves.
- Hardcoded credentials, URLs, or environment values. Use `config.py`.
- Single-file folders (`integrations/<vendor>/<single-file>.py` with no
  other content). Flatten until the folder has real content.
- Catching the integration's own error type to translate to HTTPException.
  HTTP translation happens in services or the global exception handler.

## Vendor Boundary Discipline

Product code calls the integration's public API and nothing else.

```python
# Allowed
from integrations.stripe import create_stripe_customer, StripeIntegrationError

# Forbidden
from integrations.stripe.client import _internal_helper
from integrations.stripe.client import _StripeRequestBuilder
```

Integration internals (private functions, internal classes) are not part of
the contract.

## External-Action Admission Boundary

An external-action approval is hosted product authorization, not vendor
protocol state. The gateway must classify an action with its pure typed policy
before credential resolution or any provider call. An approval request is
bound server-side to the authenticated product user and organization scope,
integration account UUID plus `auth_version`, runtime Worker, signed
Worker/workspace/AnyHarness-session launch identity, exact verdict
provider/tool, and canonical payload digest. Prompt text, provider arguments,
gateway bearers, Worker credentials, and process memory are not approval
sources.

The hosted state machine has `pending`, `approved`, `rejected`, `revoked`,
`expired`, and `consumed` states with a 600-second TTL. `expires_at` is the
authoritative boundary even before observation materializes the `expired`
state and system audit event. TTL creation, predicates, transition timestamps,
and audit timestamps use PostgreSQL `clock_timestamp()`; transition code locks
the row before evaluating expiry. Request creation is committed before the gateway
returns its typed approval-required result. Execution admission is an atomic,
one-time, exact-binding `approved -> consumed` compare-and-set in a separate
short transaction; its audit event must commit before credential decryption,
auth-header rendering, or vendor network I/O.

The approval and event tables retain immutable identity snapshots so deletion
of a user, organization, account, or Worker cannot erase historical evidence.
First-party list/get/approve/reject/revoke routes require product-user auth,
recheck ownership and active organization membership, and expose only typed
metadata, the payload digest, and fixed action/account/source labels. Reserved
target/content fields remain null until a delivery slice owns one canonical
typed action parser; provider arguments are never stored or returned. These
routes must never return credentials, rendered auth, or raw provider payloads.

The current Slack boundary executes only the exact read/search allowlist.
Known Slack external actions can create durable requests but are not delivered;
unknown Slack tools fail closed. The next delivery slice is limited to
`slack_send_message`, a separate wrapper-level `approvalId`, and an explicit
reauthorization that adds only `chat:write` to the existing exact six scopes.
It must accept only the frozen `channel_id` plus `message` action shape, reject
aliases and extra or rich fields, and derive binding, UI summary, and provider
arguments from that one typed object. It must re-evaluate the verdict and full
binding, require the current account revision, and commit one-time consumption
before entering this raw integration layer. After the commit it must load and
copy only the exact `(account_id, auth_version)` credential/config snapshot or
fail, never refetch a newer revision through a generic launch resolver. Every
other Slack mutation remains denied from delivery.

## Webhooks

Webhook routes belong to the relevant product domain's `api.py`, not to
integrations:

```python
# server/billing/api.py
@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> dict:
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    event = verify_stripe_webhook(payload, signature)  # from integrations.stripe
    await service.handle_stripe_event(db, event)
    return {"received": True}
```

The integration owns signature verification and event parsing. The product
service owns "what to do when the event arrives."

## Forbidden Patterns

- Single-file folders (e.g., `integrations/billing/stripe.py` as the only
  file). Flatten or add real content.
- External protocol/client code in product domains. Product domains may
  orchestrate results, but raw HTTP/SDK protocol access belongs behind the
  owning integration boundary.
- Cross-vendor imports (`integrations/stripe/` importing from
  `integrations/anthropic/`). Integrations are independent.
- Imports from `server/<domain>/**` inside an integration. Integrations don't
  know about product domains.
- Database access from inside an integration.
- The same vendor's code split across two locations.

## Adding a New Integration

1. **Pick a shape.** Single file (default), folder (multi-concern), or
   polymorphic folder (multi-vendor protocol).
2. **Define the error type.** First, before the public API.
3. **Read credentials from `config.py`.** Never hardcode.
4. **Build the client construction or authentication helper.** This is what
   the public functions use internally.
5. **Implement public functions** that product code will call.
6. **Add unit tests** for the integration that mock the HTTP layer.
7. **For folder integrations:** export the public API from `__init__.py`.
8. **For external actions:** prove the hosted policy and committed admission
   boundary with mocks before adding a vendor call; never use a live provider
   account to verify authorization behavior.
