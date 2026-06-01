# Server Domains

Backend product domains keep transport, orchestration, wire models, pure rules,
authorization deps, errors, and non-HTTP entry points in predictable homes. A
domain folder answers "what product area owns this?"

## Ownership

A `server/<domain>/` folder is one product area's home. It owns:

- HTTP transport via `api.py`
- Business orchestration via `service.py`
- Pydantic transport schemas via `models.py`
- Pure rules via `domain/<concern>.py`
- Resource-access route deps via `access.py` (when the domain has protected resources)
- Domain-specific errors via `errors.py` (when needed)
- Non-HTTP entry points via `worker.py` / `reconciler.py` (when applicable)
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
  worker.py                 # non-HTTP entry point (or worker/ subfolder)
  reconciler.py             # state-drift loop (when applicable)
  <subdomain>/              # promoted subdomain
    api.py
    service.py
    models.py
    domain/
```

The hierarchy answers three questions, in order:

1. What product area? — the domain folder name.
2. Which surface within that area? — `api.py` (HTTP), `worker.py` (background),
   `<subdomain>/` (promoted concept).
3. What part of that surface? — `service.py` (orchestration), `domain/`
   (pure rules), `access.py` (auth), `errors.py` (types).

## What Each File Owns

### `api.py`

Transport only. Parses requests, calls services, returns responses. Stays
thin. Long handler bodies are a smell.

Allowed:

- Route declarations with typed Pydantic return annotations.
- Resource-access deps via `Depends(<domain>_user_can_<action>)`.
- Authentication deps via `Depends(get_current_user)`.
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
- Composing multiple store function calls within a single transaction
  (the request session by default; `db.begin_nested()` for narrower
  atomicity).
- Calling integrations via their public API.
- Calling pure functions in `domain/`.
- Calling other domains' public service functions for *writes*.
- Calling other domains' stores for *reads*.
- Raising domain errors (`raise WorkspaceAlreadyDeleting(...)`).

Banned:

- `async_session_factory` imports. Services don't open sessions; they
  receive them.
- SQLAlchemy direct imports (`from sqlalchemy import ...`).
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
- Imports from `auth/authorization` (for `PolicyVerdict`, etc.) and other
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

- `async def` functions taking `Depends(get_current_user)` and any path/query
  params.
- `db: AsyncSession = Depends(get_async_session)` for the lookup.
- Calls to `db/store/**` for the resource lookup.
- Calls to `auth/authorization.py` helpers (`require_org_role`, etc.).
- Calls to `domain/policy.py` for state-based access checks.
- Returning the resource as a frozen dataclass.

Banned:

- Mutating writes. Access deps are read-only.
- Business logic beyond access.
- Inline authorization helpers (use `auth/authorization`).

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
[integrations.md](integrations.md). No exceptions for "but only this domain
uses it."

### 5. Add a non-HTTP entry point

`worker.py`, `scheduler.py`, `reconciler.py` for background work. See
[workers.md](workers.md). Same layer law: no ORM imports, calls service or
store functions.

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
- A reconciler — that's `reconciler.py` at the parent.
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

**Writes cross via service.** A service must go through another domain's
public service functions to mutate that domain's resources:

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
- Cross-domain imports for auth infrastructure. Always use
  `auth.authorization`.
- Two domains both writing the same ORM resource. The resource has one
  owning domain whose service is the write boundary.

The same pattern applies to subdomains within a parent: read via store, write
via service.

## Worker-Side Logic

When a domain has substantial worker-side logic that's distinct from
HTTP-side work, promote it to a `worker/` (or `runtime/`) subfolder. Inside,
the shape mirrors a subdomain: `main.py` (entry), `service.py` (worker-facing
orchestration), other named modules for substantial concerns.

```text
server/automations/
  api.py
  service.py            # API-facing service: CRUD on automation definitions
  models.py             # API schemas
  domain/
    recurrence.py       # pure RRULE parsing
    policy.py
  worker/
    main.py             # process entry
    service.py          # worker-facing service: pick due, dispatch, record
    scheduler.py        # scheduler loop body
    cloud_executor.py
    local_executor.py
```

Two `service.py` files coexist when surfaces are genuinely distinct. They
share `domain/` and the store. See [workers.md](workers.md) for the full
worker organization.

## Migration Example: Cloud Runtime Carving

`cloud/runtime/` is a migration exception when it mixes vendor access,
provisioning, credentials, config sync, and liveness concerns in one flat
folder. The carved shape is:

```text
integrations/anyharness/                  <- moved out
  __init__.py
  client.py                               <- was anyharness_api.py
  sessions.py                             <- was session_api.py
  workspace_operations.py                 <- was workspace_operations.py
  errors.py
  models.py

cloud/runtime/
  api.py
  service.py                              <- cross-cutting only
  models.py                               <- shared types

  provisioning/                           <- subdomain
    service.py                            <- was provision.py
    models.py                             <- provision input/result types
    bootstrap.py                          <- runtime startup setup
    git_operations.py
    sandbox_helpers.py                    <- was sandbox_exec.py
    scheduler.py                          <- provision task scheduling
    domain/
      step_tracker.py                     <- _StepTracker extracted
      identity_resolver.py                <- _resolve_git_identity extracted
      data_key.py                         <- was top-level

  credentials/                            <- subdomain
    service.py                            <- sync_workspace_credentials
    models.py                             <- provision credential dataclasses
    domain/
      freshness.py                        <- was credential_freshness.py

  config_sync/                            <- subdomain
    service.py                            <- combines repo + worktree policy
    repo_config.py                        <- was repo_config_apply.py
    worktree_policy.py                    <- was worktree_policy_sync.py

  liveness/                               <- subdomain
    service.py                            <- ensure_running orchestration
    reconciler.py                         <- was setup_monitor.py
    domain/
      restart_policy.py                   <- pure restart logic
      health_checks.py                    <- provider-specific health waits
```

Each subdomain is coherent and reasonably sized. The AnyHarness vendor client
leaves product code entirely. Large provisioning helpers that are pure product
rules belong in `provisioning/domain/`; vendor calls belong in
`integrations/anyharness/`.

## Patterns

- A domain folder either has subfolder children consistently or is flat.
  Mixed shapes (some subfolders, some flat sibling files belonging to a
  subdomain) are forbidden. `domain/` is the narrow exception to the
  single-file-folder rule: one meaningful pure-domain file is allowed when
  the domain only has one extracted rule module.
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
