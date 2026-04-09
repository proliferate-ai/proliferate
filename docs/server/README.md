# Server Standards

Status: authoritative for Proliferate backend/control-plane code in this repo.

Scope:

- `server/**`

## 1. File Tree

Use this as the default backend shape. Do not create new top-level backend
folders without a clear ownership reason.

```text
server/proliferate/
  main.py
  config.py
  constants/
  utils/
  auth/
    desktop/
  db/
    models/
    store/
  integrations/
  middleware/
  server/
    <domain>/
```

Domain packages are the default product shape under `server/`.

Smaller domains should usually stay as:

```text
server/<domain>/
  api.py
  models.py
  service.py
```

Larger centralized domains may keep their own nested structure when the domain
is broad and cohesive. `cloud/` is the main example:

```text
server/cloud/
  api.py
  <shared domain modules>.py
  <subdomain>/
    api.py
    models.py
    service.py
```

That is acceptable when the folder still reads as one domain with clear
internal ownership.

## 2. Non-Negotiable Rules

- Route handlers stay extremely thin.
- `api.py` is transport only. It parses the request, calls the right service,
  and returns the response.
- `service.py` owns business logic, orchestration, invariants, and validation.
- Database access belongs in `db/store/**` only.
- `service.py` must not run direct ORM queries or call `db.execute(...)`
  inline. If a service needs data, add a store function and call that.
- `db/models/**` owns ORM table definitions only.
- `server/<domain>/models.py` owns API request and response models only.
- Raw third-party SDK and API calls belong behind `integrations/**`.
- `middleware/**` is only for cross-cutting HTTP request lifecycle concerns.
- `config.py` owns env-derived runtime settings only.
- `constants/**` owns shared hardcoded values only.
- `utils/**` is for truly generic backend helpers that are not owned by one
  product domain.
- Prefer composition over inheritance.
- Keep inheritance shallow and explicit. Do not build deep `Base*` hierarchies
  for services, Pydantic models, dataclasses, or domain logic.
- Use Pydantic models for API transport schemas.
- Route handlers must declare a typed Pydantic return type. Never use
  `dict[str, Any]`, `list[dict[str, Any]]`, or any other `Any`-bearing type as
  a route return annotation. ANN401 is enforced by ruff — fix the model, do not
  suppress the lint rule.
- Use dataclasses for small internal value objects when a lightweight typed
  container helps and no framework behavior is needed.
- Do not use Pydantic models as ORM models or general-purpose domain objects.
- Map explicitly between ORM models, dataclasses, and Pydantic schemas instead
  of blurring those layers together.
- The layered ownership rule for types is: ORM model (persistence) →
  dataclass (internal domain value) → Pydantic model (wire format). Each layer
  owns its own type. The mapping between them is explicit and lives at the
  boundary — typically in `models.py` constructor functions.
- Pydantic belongs at trust boundaries: HTTP request parsing and response
  serialization. It does not belong inside service functions as a general
  container for data that never leaves the backend.
- Do not use `model_config = ConfigDict(from_attributes=True)` to map ORM
  objects directly into Pydantic response models. This collapses the dataclass
  layer, couples your wire format to ORM column names, and makes independent
  evolution of the two harder. Map explicitly instead.
- Prefer `@dataclass(frozen=True)` for dataclasses that represent read results
  from a store or service. Immutability makes the intent clear and prevents
  accidental mutation across call sites.
- Do not create junk-drawer modules such as `helpers.py`, `misc.py`, or
  catch-all `services/`.
- Preserve current API shapes and auth behavior unless an explicit change is
  requested.
- Delete dead compatibility paths instead of keeping duplicate old and new
  flows alive.

### Layer Law

- `api.py` is transport only and may call `service.py` only.
- `api.py` must not import `db/store/**`.
- `api.py` must not import `AsyncSessionDep`, `get_async_session`, or
  `async_session_factory`.
- `api.py` must not import SQLAlchemy directly.
- `api.py` may keep the current auth dependency return type import
  `from proliferate.db.models.auth import User`; no other ORM model imports are
  allowed in handlers.
- `service.py` may call stores and integrations, but may not import SQLAlchemy,
  `AsyncSession`, `AsyncSessionDep`, `get_async_session`, or
  `async_session_factory`.
- Runtime helpers under `server/**` follow the same no-session/no-SQLAlchemy
  rule as services unless they themselves live under `db/store/**`.
- Multi-step database transactions belong in store facades under `db/store/**`,
  not in services.

## 3. Ownership Model

Use the lowest layer that can own the logic cleanly.

| Concern | Owner | Rule of thumb |
| --- | --- | --- |
| Route handlers | `server/<domain>/api.py` | Thin request/response transport only. |
| API request and response models | `server/<domain>/models.py` | Transport-facing schemas only. |
| Product business logic | `server/<domain>/service.py` | Orchestration, invariants, validation, and coordination across stores and integrations. |
| Larger centralized domain logic | `server/<large-domain>/**` | Allowed for broad cohesive domains like `cloud/`; keep subpackages inside the domain instead of inventing parallel top-level folders. |
| ORM schema | `db/models/*.py` | Persisted schema only. |
| Database reads and writes | `db/store/*.py` | All DB access goes here, including query construction and `db.execute(...)`. |
| Auth, token, OAuth, PKCE, and auth dependencies | `auth/**` | Auth stays separate from product-domain business logic. |
| Third-party providers and vendor SDKs | `integrations/**` | Typed adapters only. Small integrations can be one file; larger ones should split into folders. |
| Cross-cutting request lifecycle behavior | `middleware/**` | Request context, tracing, logging correlation, and other HTTP-wide behavior. |
| Env-driven runtime configuration | `config.py` | Secrets, URLs, flags, limits, and other deployment-specific values. |
| Shared hardcoded values | `constants/**` | Stable code-level constants, defaults, and protocol labels. |
| Shared generic helpers | `utils/**` | Only for helpers that are truly generic across backend domains, such as shared crypto, telemetry, or time helpers. |
| API transport schemas | Pydantic models in `server/<domain>/models.py` | Validate and serialize request/response shapes at the transport boundary. |
| Small internal typed value objects | dataclasses in the owning module or domain package | Use for internal structure, not as a substitute for ORM or API schemas. |

Persistence rule:

- Services call store functions.
- Stores talk to the database.
- Handlers and services do not become ad hoc persistence layers.

## 4. Folder Guide

- `server/<domain>/`
  - Default home for backend product domains.
  - Small domains should usually be `api.py`, `models.py`, and `service.py`.
  - Larger domains like `cloud/` may keep nested subpackages when the domain is
    broad, centralized, and still clearly owned as one domain.

- `auth/`
  - Owns authentication, token handling, reusable authorization dependencies,
    OAuth, PKCE, and desktop auth flow logic.
  - Do not bury product-domain rules such as billing or workspace lifecycle
    behavior here.

- `db/models/`
  - ORM tables only.
  - Do not put request models, transport serializers, or service logic here.

- `db/store/`
  - All database operations live here.
  - If code needs `select(...)`, `insert(...)`, `update(...)`, `delete(...)`, or
    `db.execute(...)`, it belongs here rather than in a service or handler.

- `server/<domain>/models.py`
  - Pydantic request and response schemas only.
  - Keep inheritance shallow. Shared transport bases are fine when they remove
    obvious duplication, but avoid deep schema hierarchies.
  - Do not turn these models into ORM or generic domain objects.

- `integrations/`
  - Owns typed boundaries to third-party systems.
  - Keep vendor auth, client setup, payload normalization, and provider-specific
    error handling here.
  - Split a provider into a folder when one file stops being clear. `slack/`
    is preferable to one giant `slack.py` once the integration grows.

- `middleware/`
  - Owns HTTP-wide request lifecycle behavior.
  - Good examples are request context, tracing, correlation IDs, or shared
    request instrumentation.
  - Do not put product business logic or domain-specific permissions here.

- `constants/`
  - Shared hardcoded values only.
  - If a value comes from env or deployment settings, it belongs in `config.py`
    instead.

- `config.py`
  - Runtime settings only.
  - Do not turn it into a general global-values bucket for hardcoded constants.

- `utils/`
  - Shared generic backend helpers only when they are not naturally owned by a
    domain.
  - This is the right home for truly generic helpers such as shared crypto,
    telemetry, or time utilities.
  - Do not move domain business logic here just because it is reused twice.

- dataclasses
  - Use for small internal typed containers, parsed values, or normalized
    results that stay inside the backend.
  - Prefer explicit construction and mapping over clever inheritance.

- `main.py`
  - App bootstrap and route registration only.
  - Keep app construction separate from product behavior and persistence logic.
