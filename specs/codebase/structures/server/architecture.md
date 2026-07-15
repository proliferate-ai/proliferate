# Server Architecture

Status: consolidated architecture reference for the Proliferate backend /
control-plane (`server/**`). The focused Server guides, managed-cloud platform
docs, and Proliferate Worker structure docs remain the detailed current owners;
this doc is the single structured overview — purpose, the 20k-foot model, core
workflows, per-folder best practices, and detailed sections for the **managed
runtime path**, the optional **runtime Worker**, and the **DB models**.

---

## 1. Purpose / Ownership

The server is the **control plane**: an HTTP API + background workers over
Postgres, integrating external vendors (AnyHarness runtime, Stripe, GitHub, AWS,
Slack). It owns persistence, auth, billing, orgs, and orchestrating runtimes — it
does **not** run agent sessions (AnyHarness does).

**The three rules that generate everything:**

1. **The layer law** — `api.py` (transport) → `service.py` (orchestration) →
   `db/store/**` (DB); `domain/**` (pure rules) on the side; `integrations/**`
   (vendors) as leaves.
2. **The type pipeline** — three distinct layers, never crossed:
   **ORM → dataclass → Pydantic**.
3. **Domain folders answer "what product area?"** — never transport, UI shape, or
   deployment target.

Plus the meta-rule: **lowest layer that can own it cleanly**, and dependencies
point one way.

---

## 2. 20k-Foot Detailed View

### The layers (shelves)

```text
server/proliferate/
  main.py · config.py · errors.py
  constants/<area>.py        # hardcoded policy values
  middleware/                # cross-cutting HTTP lifecycle
  permissions.py             # org-authz factory deps + verdict types (leaf, imported everywhere)
  auth/                      # actor authn deps + viewer/desktop/identity APIs + crypto utils
  lib/                       # reusable cross-domain logic (leaf below domains)
    infra/ product/ capabilities/
  background/                # Celery substrate: app, config, beat, relay, tasks
  db/
    models/<resource>.py     # ORM tables (leaf)
    store/<resource>.py      # ALL database access
  integrations/<vendor>/     # vendor adapters (leaf)
  server/<domain>/           # the product areas (most code)
    api.py service.py models.py
    access.py errors.py domain/<concern>.py
    worker/service.py        # worker-facing background service
    <subdomain>/
```

| Layer | Owns | Never |
| --- | --- | --- |
| `api.py` | parse → call service → return | `db/store` import, `AsyncSession` methods, SQLAlchemy, business logic, inline auth, try/except around the handler |
| `service.py` | business logic, orchestration, invariants, validation | open sessions, SQLAlchemy, `select/insert/db.execute`, `commit`, inline auth |
| `domain/**` | pure rules: validators, state machines, calculators, mappings, **planners** | `async def`, DB/ORM, FastAPI, integrations, I/O — *returns data* |
| `db/store/**` | query construction + execution; returns **frozen dataclasses** | commit, open sessions; ORM never leaves here |
| `db/models/**` | ORM table definitions only | imports nothing (leaf) |
| `integrations/<vendor>` | typed vendor adapters | importing server domain code (leaf; public via `__init__`) |

### The type pipeline — the server's "state model"

```text
ORM (db/models)  ──store returns──►  @dataclass(frozen=True)  ──models.py ctor──►  Pydantic (wire)
   stays in the store                  the safe travel format          the HTTP format
```
- **ORM never leaves the store.** Stores return frozen dataclasses.
- **Pydantic never accepts ORM.** Constructor functions take dataclasses (no
  `from_attributes=True`).
- Dataclasses carry **enums**; Pydantic maps to wire strings at the boundary.
- Cross-domain service calls pass **dataclasses**, not Pydantic.

### Transactions / sessions / connections (critical)

- **Session** = the unit-of-work object (cheap; per request via the dep, per task
  via the worker entry). **Connection** = the scarce pooled resource, held *only*
  while a transaction is open. They are different things.
- **Stores take `db: AsyncSession`, never commit, never open sessions.**
- **HTTP:** the `get_async_session` dep owns the transaction (commit on success,
  rollback on exception). **Workers:** open a session at the entry point
  (`async with session_factory() as db: async with db.begin(): …`).
- **Never hold a connection across foreign I/O.** Short transactions only; for
  vendor-interleaving flows, commit → release → call → fresh short transaction.
  This is why the **outbox** exists (commit intent in one txn, do the side effect
  in a worker).
- **No `db.commit()` outside session-management code.**

### Dependency direction

```text
api → service → store → models → SQLAlchemy        (nothing else imports SQLAlchemy)
service → integrations / domain / other domains' public services (writes) or stores (reads)
domain → pure (no FastAPI/SQLAlchemy/store/integrations/HTTP)
auth/** → importable by every layer
workers → call services, not stores; own the transaction at the entry
```

---

## 3. Core Workflows

**The request lifecycle:**
```text
request → middleware → api handler
   Depends(current_product_user)        # authn (actor dep)
   Depends(require_org_role(org_id, …)) # permissions.py: org standing → OwnerContext
   Depends(<domain>_user_can_<action>)  # access.py: lookup + check → resource or 403/404
   db = Depends(get_async_session)
   → service(db, …)
        domain/policy.py  → pure verdict
        domain/<concern>  → pure decisions
        db/store/**(db, …)→ SQL → frozen dataclass
        integrations/**   → external calls
   → models.py constructor (dataclass → Pydantic)
→ response   (the dep commits on success / rolls back on error)
```

**Cross-domain coordination:** *reads cross via store* (import another domain's
store to read), *writes cross via service* (call its public service function).
One owning domain per resource; never two domains writing the same ORM resource.

**Planner / executor:** a long service usually wants a **planner in `domain/`**
(returns command-shaped data) + a **thin executor in `service.py`**. Same
"decide here, execute there" split as the frontend's side-effect planner.

**Service decomposition — the five legal moves** (when `service.py` grows): (1)
internal sectioning (~700–800 lines), (2) extract pure logic to
`domain/<concern>.py`, (3) promote a subdomain (own api/service/models), (4) move
vendor specifics to `integrations/<vendor>/`, (5) add a worker entry point.
**Sibling helper files are not a move.**

**External-side-effect pattern (outbox):** a named orchestration function owns an
explicit multi-transaction sequence — write "pending" + commit → external call
(no open txn) → write result + commit — *or*, preferably, write the intent + an
outbox row and let a worker do the call.

---

## 4. Each Folder's Best Practices

### `server/<domain>/api.py`
- Transport only: route declarations, `Depends(...)` injection, response
  construction via `models.py`, request validation. Stays thin.
- **Never:** inline auth (use deps), `db/store` imports, `AsyncSession` methods,
  `async_session_factory`, SQLAlchemy, business logic, ORM imports (except `User`),
  try/except around the whole handler.

### `server/<domain>/service.py`
- Business logic, orchestration, invariants. Takes `db`, threads it to stores,
  calls integrations + `domain/`, raises domain errors.
- **Never:** open sessions, import SQLAlchemy, run `select/insert/db.execute`,
  `commit/rollback`, inline auth, or call another service's private helpers.

### `server/<domain>/models.py`
- Pydantic request/response schemas; constructor functions take **dataclasses**.
- **Never:** functions taking ORM, `ConfigDict(from_attributes=True)`, Pydantic as
  ORM substitutes, deep inheritance, ORM imports.

### `server/<domain>/domain/<concern>.py` (+ `policy.py`)
- Pure synchronous rules: validators, state machines, calculators, mappings,
  planners, frozen dataclasses. `policy.py` returns `PolicyAllowed | PolicyDenied`.
- **Never:** `async def` exports, DB/ORM/store imports, httpx/integrations,
  FastAPI, `service.py` imports, side effects, raising `HTTPException`.

### `server/<domain>/access.py`
- Resource-access route deps: look up the resource, check the user can touch it,
  return it (or raise 403/404). Read-only.
- **Never:** mutating writes, business logic, inline authz helpers (compose the
  `proliferate.permissions` factories).

### `server/<domain>/errors.py`
- Domain error types subclassing the shared base, with a `code`. Types only.
- **Never:** raise `HTTPException` (the global handler maps it), catch/re-wrap
  unrelated exceptions, error logic.

### `db/models/<resource>.py`
- ORM table definitions only. UUID PKs (`gen_random_uuid()`), `TIMESTAMPTZ`
  everywhere, `deleted_at` not `is_deleted`. Leaf — imports no services/stores.

### `db/store/<resource>.py`
- ALL DB access: query construction + execution. Takes `db`, returns **frozen
  dataclasses**, co-locates read-result dataclasses.
- **Never:** open sessions, commit/rollback, import services/integrations, let ORM
  escape. Flat (`cloud_workspaces.py`) or folder (`cloud_mcp/connections.py`).

### `integrations/<vendor>/**`
- Typed adapters around a vendor SDK/API: client, models, errors, concerns.
  Public via `__init__.py` (the one barrel exception).
- **Never:** import server domain code (leaf). Raw third-party calls live *only*
  here; product domains orchestrate results.

### `auth/**` / `permissions.py`
- Authorization is enforced at the endpoint via `Depends()`; services get a
  pre-authorized context and run no auth checks. `auth/dependencies.py` owns
  user actor deps (`current_active_user`, `current_product_user`); the Cloud
  runtime-worker domain owns its opaque-bearer `WorkerAuthContext` dependency.
  `permissions.py` (server
  root) = org-authorization factory deps (`require_org_role(org_id, roles)`,
  `require_org_membership`) returning `OwnerContext`, plus `PolicyVerdict`. It is
  a leaf importing neither `auth/**` nor `server/<domain>/**`; cross-domain authz
  always comes from `proliferate.permissions`, never another service. `auth/` also
  owns the `viewer_api/`, `desktop_api/`, `identity_api/` surfaces and `utils/`
  crypto primitives.

### `background/**` / `server/<domain>/worker/service.py`
- One background model: a Celery task. **Beat** fires periodic ones (scheduler
  polls, surviving reconciler passes); the **outbox relay** fires on-demand ones
  (durable jobs tied to a committed state change). `background/**` is substrate —
  `celery_app.py`, `config.py`, `beat_schedule.py`, `relay.py`, thin `tasks/`;
  the work a task performs lives in the domain's `worker/service.py` (or
  `service.py`), same layer law (call services/stores, no ORM, no vendor client).
  The task opens the session at its boundary. There are no per-domain `worker.py`,
  `reconciler.py`, or `scheduler.py` process or loop files. Request-driven
  external-process claim/heartbeat/report surfaces are APIs, not background work.

### `lib/**`
- Reusable cross-domain logic owned by no single domain: `infra/` (generic, no
  product/vendor/DB), `product/` (cross-domain pure product logic, no I/O, never
  imports `integrations/`), `capabilities/` (reusable orchestration over an
  integration). A leaf below the domains: never imports `server/<domain>/**` or
  `db/store`, owns no durable state or product policy, and a concern enters only
  at its second domain consumer. Replaces any `utils/` bucket.

### `config.py` / `constants/<area>.py`
- `config.py` = env-derived runtime settings (secrets, URLs, flags). `constants/`
  = hardcoded policy (limits, timeouts, headers, sentinels). Product-policy
  literals in service/api/store files are forbidden. No `localhost` outside config.

### `middleware/**`
- Cross-cutting HTTP lifecycle only (request context, tracing, correlation ids).
  No product logic.

**Cross-cutting hygiene:** canonical files never prefixed/suffixed; no junk-drawer
modules (`helpers.py`/`utils.py`/`misc.py`); no single-file folders (except
`domain/`); a folder is all-subfolders or all-flat; never `datetime.utcnow()`
(use `datetime.now(timezone.utc)`). Size thresholds are CI-enforced
(`check_max_lines.py`); boundaries by `check_server_boundaries.py`.

---

## 5. Managed Runtime And Worker (detailed)

The hosted Cloud path is direct. One user has at most one active personal
`cloud_sandbox` row. Provider and runtime work happens just in time when a repo
environment or workspace needs materialization:

```text
Cloud service
  -> E2B create/resume
  -> launch authenticated AnyHarness when absent/unhealthy
       -> persist ready access
       -> best-effort start Proliferate Worker sidecar
     OR reuse an already-healthy authenticated AnyHarness
       -> do not restart a missing Worker sidecar
  -> materialize the repo
```

The current E2B launch path does not start Proliferate Supervisor. Supervisor
remains the process/update owner for the SSH installer and its installed target
layout; do not infer that topology for hosted sandboxes.

The optional Worker has one heartbeat loop, not a product-command channel:

```text
fresh process
  -> consume one-time enrollment token when no durable identity exists
  -> persist opaque Worker identity/token in local SQLite
  -> heartbeat with Worker and AnyHarness versions
  -> act on desired catalog, Worker, and AnyHarness versions
```

Cloud enrollment returns a Worker token plus integration-gateway credentials.
Heartbeat updates `last_seen_at` and installed versions and returns desired
versions. Catalog convergence reads/writes the AnyHarness catalog directly.
Worker self-update verifies and preflights a public artifact, atomically swaps
the binary, then `exec`s it. AnyHarness convergence stops, swaps, relaunches,
health-checks, and can roll back the runtime binary.

There is no mounted Target registry, command/control poll, event tail, exposure
reconcile loop, inventory report, materialization report, or Supervisor mailbox.
See `specs/codebase/structures/proliferate-worker/README.md` for the exact current
source tree.

---

## 6. Cloud ↔ Runtime Flow (detailed)

Cloud owns product/account configuration, billing gates, repository settings,
and Cloud workspace rows. AnyHarness SQLite owns runtime workspaces, sessions,
events, terminals, and execution state.

```text
save cloud repo environment
  -> commit product configuration
  -> schedule best-effort materialization after commit

create cloud workspace
  -> validate repo environment, GitHub access, branch, and conflicts
  -> synchronously materialize the repo (creating/resuming E2B as needed)
  -> insert cloud_workspace
  -> call AnyHarness POST /v1/workspaces/worktrees directly
  -> store anyharness_workspace_id

client runtime request
  -> authenticate and authorize in Cloud
  -> load/decrypt cloud_sandbox runtime access
  -> proxy HTTP or WebSocket traffic through the cloud-sandbox gateway
  -> AnyHarness
```

The workspace operation is not an atomic cross-system transaction. The Cloud
row is flushed before the AnyHarness call but remains in the request
transaction, so a propagated failure rolls it back. If runtime creation or
resolution succeeds and a later Cloud write or commit fails, an AnyHarness
worktree can instead remain without a committed Cloud row. Existing null-id
Cloud rows still render as `materializing` and eventually `error` after the
stale threshold; they are not the normal artifact of a failed current create
request.

Worker enrollment and heartbeat are a separate optional liveness/convergence
path. Product prompts, workspace operations, and session events do not travel
through the Worker. The server calls or proxies to AnyHarness directly.

---

## 7. DB Models (detailed)

### Conventions (enforced)
- **UUID primary keys** (`gen_random_uuid()`); no integer PKs for new resources.
- **`TIMESTAMPTZ` everywhere**; never naive `TIMESTAMP`; `datetime.now(timezone.utc)`.
- **Soft delete** via `deleted_at TIMESTAMPTZ NULL`, never `is_deleted`; default to
  hard delete.
- **No lazy ORM access past the store boundary** (the reason stores return
  frozen dataclasses).
- Schema changes go through **Alembic**.

### The type pipeline (recap)
ORM (`db/models`) → frozen dataclass (store returns) → Pydantic (`models.py` ctor).
ORM stays in the store; Pydantic never sees ORM.

### Store rules
- One ORM resource per store file. Takes `db`, never commits/opens sessions,
  returns dataclasses. Flat (prefixed) or folder (un-prefixed inside).

### Key current model families

- **Sandbox access** (`db/models/cloud/sandboxes.py`): personal
  `cloud_sandbox` lifecycle, provider id, and encrypted AnyHarness access.
- **Repository configuration** (`db/models/cloud/repositories.py`):
  `repo_config`, `repo_environment`, and
  `cloud_repo_environment_materialization`.
- **Cloud workspace records** (`db/models/cloud/workspaces.py`): repository
  environment, branch/base branch, archive state, and optional
  `anyharness_workspace_id`.
- **Optional runtime Worker** (`db/models/cloud/runtime_workers.py`): Worker,
  one-time enrollment, and integration-gateway token records.
- **Sandbox secret materialization** (`db/models/cloud/secrets.py`): persisted
  runtime/repository secret-application state.
- **Billing, orgs, auth, and other product domains**: each retains its own
  `db/models/**` and `db/store/**` owner.

Target, command-queue, exposure, and Cloud session-projection tables were
removed. Runtime session/event truth remains in AnyHarness rather than a Cloud
projection ledger.

---

## The Compression

**`api` transports, `service` orchestrates, `domain` decides, `store` persists,
`integrations` reach outside; types flow ORM → dataclass → Pydantic, never
backward; transactions are short and owned at the edge, with the outbox for
external side effects.** Managed Cloud uses one personal `cloud_sandbox`,
just-in-time E2B/AnyHarness materialization, and direct gateway access. The
optional Worker enrolls, heartbeats, and converges catalog/binary versions; it
does not carry product commands or replicate runtime events.
