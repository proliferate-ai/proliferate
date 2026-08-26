# Auth

Server auth has four boundaries: **authentication** identifies the caller, **org authorization** decides whether that caller has the right standing in an organization, **resource access** checks whether the caller can touch a specific resource, and **product policy** decides whether the current resource state allows an action. New and refactored paths enforce these boundaries at the endpoint via `Depends()`: services receive resolved context rather than becoming a hidden permission layer. Existing inline checks are migration work, not a second recommended pattern.

## Ownership

| Boundary | Question | Lives in | Returns |
|---|---|---|---|
| **Authentication** | Who is the caller? | `auth/dependencies.py` for users; `server/seam/workers/auth.py` for Workers | the actor (`User` / `WorkerAuthContext`) |
| **Org authorization** | Does the caller have the right org standing? | `permissions.py` (request deps and factories) | `OwnerContext` or `CurrentOrgUser` |
| **Resource access** | Can this caller touch *this* resource? | `server/<domain>/access.py` | the resource snapshot, or raises 403/404 |
| **Product rule** | Given this state, is the action permitted now? | `server/<domain>/domain/policy.py` | `PolicyVerdict` |

Dependency-free authorization currency — `ActorIdentity`, `AuthenticatedUser`, `OwnerScope`, `OwnerSelection`, `OwnerContext`, `PolicyAllowed`, `PolicyDenied`, `PolicyVerdict`, and the pure `require_org_role` check — is defined in [auth/authorization.py](../../../server/proliferate/auth/authorization.py). [permissions.py](../../../server/proliferate/permissions.py) re-exports that vocabulary as the public domain-facing seam and owns request-time organization selection, membership resolution, request/RLS context, and FastAPI dependencies. New and refactored domain code imports public names from `proliferate.permissions`; direct imports from `auth.authorization` are migration work, not a second public seam.

[auth/dependencies.py](../../../server/proliferate/auth/dependencies.py) centralizes **actor dependencies**, not every FastAPI dependency used by a route. Resource-specific dependencies stay in the domain that owns the resource. [auth/**](../../../server/proliferate/auth) remains below product domains for credentials, sessions, provider protocols, identity persistence, and transport-neutral Auth failures. Product account-entry routes and orchestration live in [server/accounts/**](../../../server/proliferate/server/accounts). This split describes the current implementation; it does not make `permissions.py` an import-free leaf.

## The actor dependency hierarchy

Authorization is a chain of `Depends()`, each one composing the one above it. An endpoint declares the lowest actor or organization context it requires.

```text
anonymous
└── current_active_user                    active user
    └── current_limited_user               compatibility actor seam; currently no extra gate
        ├── current_product_user           product readiness with the current single-org rules
        └── current_organization_actor     organization-surface readiness

current_product_user
└── current_owner_context                  selected/default payer -> OwnerContext
    ├── require_owner_role(*roles)         dependency factory -> OwnerContext
    └── current_org_member/admin/owner     selected owner -> CurrentOrgUser

current_organization_actor
└── current_path_org_member                path organization -> CurrentOrgUser
    ├── current_path_org_admin
    └── current_path_org_owner

authenticate_worker                       opaque worker bearer token -> WorkerAuthContext
optional_current_active_user               maybe authenticated (public-with-extras)
```

`require_owner_role(*roles)` is a dependency factory over the selected `OwnerContext`. `require_org_role(context, roles)` is instead a synchronous pure check over an already-resolved context. Path-organization routes use the `current_path_org_*` dependencies. There is no separate organization-membership factory. New and refactored paths resolve org standing at the endpoint boundary rather than hiding it inside a service.

## Shape

```text
server/proliferate/
  permissions.py             # request org deps + public authorization re-exports

  auth/
    __init__.py
    dependencies.py          # current_active_user, current_limited_user,
                             # current_product_user, current_organization_actor,
                             # optional_current_active_user
    authorization.py         # dependency-free owner/policy vocabulary + pure role check
    users.py                 # UserManager (fastapi-users lifecycle plumbing)
    desktop/                 # leaf models and callback pages
    identity/                # provider protocol, stores, sessions, and credential primitives
    jwt.py                   # auth crypto/protocol primitive
    oauth.py                 # auth crypto/protocol primitive
    passwords.py             # auth crypto/protocol primitive
    pkce.py                  # auth crypto/protocol primitive

  server/accounts/
    desktop/                 # /auth/desktop routes and Desktop account-entry orchestration
    identity/                # /auth web/mobile routes and account-entry orchestration

  server/<domain>/
    access.py                # resource-access route deps (per domain)
    domain/
      policy.py              # pure product-rule verdicts (per domain)

  server/seam/workers/
    auth.py                  # WorkerAuthContext + opaque bearer-token dependency
```

The flat `auth/{jwt,oauth,passwords,pkce}.py` modules hold the closed set of auth crypto and protocol primitives; there is no general utility bucket. Not every domain needs `access.py` or `domain/policy.py` — only domains that protect resources or carry product rules.

## Placement Rule

Use the question the code answers to decide where it lives:

- "Who is calling?" belongs in `auth/dependencies.py`.
- "What organization standing does the caller have?" is resolved by
  `permissions.py` using vocabulary from `auth/authorization.py`.
- "Can this caller touch this concrete route resource?" belongs in
  `server/<domain>/access.py`.
- "Does the current product state allow this action?" belongs in
  `server/<domain>/domain/policy.py`.

Do not move resource-access deps into `auth/dependencies.py` just because they are implemented with `Depends()`. A resource-access dep consumes route params, loads domain-owned snapshots, composes actor/org authorization, and returns a pre-authorized resource for the handler. Keeping that code in `server/<domain>/access.py` prevents `auth/` from importing product stores and rules, and keeps the route signature explicit about which resource permission is required.

## Layer Examples

Use `auth/dependencies.py` for actor-only checks. This file may verify a session, load the actor, and enforce account readiness, but it does not consume resource IDs or import resource-owned stores.

```python
# auth/dependencies.py
async def current_product_user(
    user: User = Depends(current_limited_user),
    db: AsyncSession = Depends(get_async_session),
) -> User:
    if settings.single_org_mode:
        return user
    return await _require_product_ready(db, user)
```

Use `server/<domain>/access.py` when a route needs a concrete resource already loaded and authorized. The dep receives route params, composes actor/org deps, reads the store, calls pure policy if needed, raises 403/404, and returns the snapshot the handler or service will use.

```python
# server/cloud/workspaces/access.py
async def workspace_user_can_archive(
    workspace_id: UUID,
    owner: OwnerContext = Depends(current_owner_context),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceSnapshot:
    workspace = await cloud_workspaces_store.get_workspace_snapshot(db, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if workspace.owner_scope != owner.owner_scope:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if (
        owner.owner_scope == "organization"
        and workspace.organization_id != owner.organization_id
    ):
        raise HTTPException(status_code=404, detail="Workspace not found")
    verdict = policy.can_archive_workspace(
        workspace=workspace,
        actor_user_id=owner.actor_user_id,
        membership_role=owner.membership_role,
    )
    if isinstance(verdict, PolicyDenied):
        if verdict.code == "workspace_not_found":
            raise HTTPException(status_code=404, detail=verdict.message)
        raise HTTPException(status_code=403, detail=verdict.message)
    return workspace
```

Use `domain/policy.py` for pure product decisions. The function takes already loaded facts, performs no I/O, imports no FastAPI or stores, and returns a verdict instead of raising an HTTP exception.

```python
# server/cloud/workspaces/domain/policy.py
def can_archive_workspace(
    *,
    workspace: WorkspaceSnapshot,
    actor_user_id: UUID,
    membership_role: str | None,
) -> PolicyVerdict:
    if workspace.owner_scope == "personal":
        if workspace.owner_user_id == actor_user_id:
            return PolicyAllowed()
        return PolicyDenied(
            code="workspace_not_found",
            message="Workspace not found.",
        )

    if workspace.organization_id is None:
        return PolicyDenied(
            code="workspace_not_found",
            message="Workspace not found.",
        )

    if membership_role in {"owner", "admin"}:
        return PolicyAllowed()

    return PolicyDenied(
        code="workspace_permission_denied",
        message="You do not have permission to archive this workspace.",
    )
```

## Authentication

`auth/dependencies.py` owns user actor dependencies. The Cloud runtime-worker domain owns its separate machine-actor dependency because the opaque Worker token is part of that domain's enrollment lifecycle.

| Dep | Gates |
|---|---|
| `current_active_user` | active user, no GitHub requirement |
| `current_limited_user` | compatibility actor seam over `current_active_user`; currently adds no gate |
| `current_product_user` | active user plus current product readiness — the default for product/cloud surfaces. Single-org instances bypass the GitHub check; hosted users require account readiness. |
| `current_organization_actor` | actor for organization-membership surfaces; applies the current hosted readiness gate and single-org bypass |
| `optional_current_active_user` | maybe authenticated (public route with extra behavior when signed in) |

`current_limited_user` is live compatibility vocabulary used by actor and identity routes. It currently returns `current_active_user` unchanged. Do not create more no-op actor wrappers; removing or bypassing this one is a separate code migration, not an assumption a caller should make from this guide.

### Allowed

- `Depends(...)` functions returning a user actor (`User`). The separate
  Worker actor dependency remains in `server/seam/workers/auth.py`.
- JWT parsing (via `auth/jwt`), session/user lookup.
- Platform-level admin checks that scope to identity, not a resource.

### Banned

- Org-standing or resource-scoped checks. Org standing belongs in
  `permissions.py` request deps; resource checks belong in
  `server/<domain>/access.py`.
- Business logic.
- ORM access beyond the actor lookup.

### Standard shape

```python
# auth/dependencies.py
async def current_active_user(
    user: User = Depends(fastapi_users.current_user(active=True)),
) -> User:
    return user

async def current_limited_user(
    user: User = Depends(current_active_user),
) -> User:
    return user

async def current_product_user(
    user: User = Depends(current_limited_user),
    db: AsyncSession = Depends(get_async_session),
) -> User:
    if settings.single_org_mode:
        return user
    return await _require_product_ready(db, user)
```

### OAuth and account-entry surfaces

Product account entry lives under `server/accounts/identity/**`, and the Desktop account-entry boundary lives under `server/accounts/desktop/**`. GitHub uses the shared `/auth/github/callback` provider callback for desktop, web, and mobile. The surface is recovered from the stored auth challenge, so the GitHub OAuth app needs only one callback URL:

```text
<API_BASE_URL>/auth/github/callback
```

Desktop GitHub still starts through `POST /auth/desktop/github/start`, exchanges desktop auth codes through `/auth/desktop/token`, and handles `proliferate://auth/callback` deep links. The older `/auth/desktop/github/authorize` and `/auth/desktop/github/callback` routes are compatibility routes and must not be configured as the current callback.

Both provider callback endpoints (`oauth_callback` for `/{surface}/{provider}/callback` and `oauth_shared_provider_callback` for `/{provider}/callback`) return an HTML handoff page when the challenge's stored surface is `desktop`, instead of a raw 302, because a system browser cannot render a custom-scheme redirect. The page fires the `proliferate://auth/callback` deep link itself (`make_desktop_handoff_page` on success, `make_desktop_provider_error_page` on a provider error) and gives desktop something to leave in the tab besides a blank page. Web and mobile callbacks keep the raw 302 in both cases; mobile shares the same `proliferate://auth/callback` string as desktop but relies on the OS intercepting the redirect, so the branch is always on the challenge's stored `surface`, never on the redirect URI's scheme. This branch only applies once a challenge is found: missing params and a provider-error callback whose challenge cannot be consumed both fall through to the shared error path and 302 to the web `/auth/error` page, since there is no challenge left to read a surface from, but an unconsumable challenge on the success branch (expired or replayed state) is not caught there and surfaces the shared JSON 400 error response instead.

## Worker actor

`server/seam/workers/auth.py::authenticate_worker` authenticates an enrolled runtime Worker. A Worker is not a user and does not present a JWT or a Target id. It presents an opaque bearer token; the dependency hashes that token, loads the active `cloud_runtime_worker`, and returns a frozen `WorkerAuthContext` containing `worker_id`, `owner_user_id`, optional `organization_id`, and `runtime_kind`.

### Allowed

- A domain-owned `Depends()` that parses one bearer header, hashes the opaque
  token, and returns `WorkerAuthContext`.
- Rejecting a missing, malformed, unknown, or revoked token with 401.

### Banned

- Product-command, Target, lease, or revision authorization. Those endpoints do
  not exist in the current Worker surface.
- Re-parsing `worker_token` in handlers or services. The domain dependency owns
  bearer parsing and token lookup once.

### Standard shape

```python
# server/seam/workers/auth.py
async def authenticate_worker(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
) -> WorkerAuthContext:
    token = bearer_token_from_request(request)
    worker = await runtime_workers_store.get_worker_by_token_hash(
        db,
        token_hash=runtime_workers_store.hash_worker_token(token),
    )
    if worker is None:
        raise CloudApiError(..., status_code=401)
    return WorkerAuthContext(
        worker_id=worker.id,
        owner_user_id=worker.owner_user_id,
        organization_id=worker.organization_id,
        runtime_kind=worker.runtime_kind,
    )
```

`POST /v1/cloud/worker/heartbeat` depends on `authenticate_worker` and receives the resolved Worker identity. Enrollment consumes its separate one-time token; the public artifact redirect routes are intentionally unauthenticated. There is no mounted Worker control, command lease/result, or applied-revision endpoint.

## Org Authorization

[auth/authorization.py](../../../server/proliferate/auth/authorization.py) owns the dependency-free vocabulary: `ActorIdentity`, `AuthenticatedUser`, `OwnerScope`, `OwnerSelection`, `OwnerContext`, `PolicyAllowed`, `PolicyDenied`, `PolicyVerdict`, and `require_org_role`. [permissions.py](../../../server/proliferate/permissions.py) re-exports those names as the public domain-facing seam and owns request-time org-standing resolution.

### Allowed

- `current_owner_context` and `require_owner_role(*roles)` for selected-owner
  routes that receive an `OwnerContext`.
- `current_path_org_member/admin/owner` for organization IDs carried by the
  path, and `current_org_member/admin/owner` for a selected owner. These return
  `CurrentOrgUser`.
- Re-exporting `ActorIdentity`, `AuthenticatedUser`, `OwnerScope`,
  `OwnerSelection`, `OwnerContext`, `PolicyAllowed`, `PolicyDenied`,
  `PolicyVerdict`, and the pure `require_org_role(context, roles)` check from
  `auth/authorization.py`.
- Applying request and RLS organization context after membership resolution.

### Banned

- Resource lookups. Those happen in `server/<domain>/access.py`.
- OAuth, session, or identity-flow logic. `permissions.py` composes actor
  dependencies but does not own authentication.
- Resource-specific product policy. The request seam resolves owner standing;
  the owning domain resolves access to its concrete resource.

### Standard shapes

```python
# server/proliferate/auth/authorization.py
@dataclass(frozen=True)
class OwnerContext:
    owner_scope: OwnerScope
    actor_user_id: UUID
    owner_user_id: UUID | None
    organization_id: UUID | None
    membership_id: UUID | None
    membership_role: str | None
    billing_subject_id: UUID

def require_org_role(context: OwnerContext, roles: Iterable[str]) -> None:
    if context.owner_scope != "organization" or context.membership_role is None:
        raise NotFoundError("Organization not found.", code="organization_not_found")
    if context.membership_role not in set(roles):
        raise PermissionDenied(
            "You do not have permission to manage this organization.",
            code="organization_permission_denied",
        )

@dataclass(frozen=True)
class PolicyAllowed:
    allowed: Literal[True] = True

@dataclass(frozen=True)
class PolicyDenied:
    code: str
    message: str
    status_code: int = 403
    allowed: Literal[False] = False

PolicyVerdict = PolicyAllowed | PolicyDenied

# server/proliferate/permissions.py
def require_owner_role(*roles: str):
    async def dependency(
        context: OwnerContext = Depends(current_owner_context),
    ) -> OwnerContext:
        require_org_role(context, roles)
        return context
    return dependency
```

## Resource-Access Route Deps

`server/<domain>/access.py` owns deps that look up a resource, check the caller can touch it, and return the resource (or raise 403/404).

These deps are the adapter between request-time information and pure policy: they may read stores and raise HTTP-shaped permission results, while `domain/policy.py` remains synchronous and side-effect free.

### Allowed

- `async def` functions taking an actor + path/query params and returning a
  resource snapshot.
- Calls to `db/store/**` for the lookup.
- Composing `current_path_org_member/admin/owner`, `current_owner_context`, or
  `require_owner_role` from `permissions.py`.
- Calls to `domain/policy.py` for state-based access checks.
- Raising 404 for missing resources, 403 for forbidden.

### Banned

- Mutating writes. Access deps are read-only.
- Business logic beyond access.
- Inline org-authorization logic (compose the applicable `permissions.py`
  dependency).
- Returning Pydantic. Return the dataclass snapshot.

### Standard shape

```python
# server/cloud/workspaces/access.py
async def workspace_user_can_admin(
    workspace_id: UUID,
    org_user: CurrentOrgUser = Depends(current_org_admin),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceSnapshot:
    snapshot = await store.cloud_workspaces.get_workspace_snapshot(db, workspace_id)
    if snapshot is None:
        raise HTTPException(404, "Workspace not found")
    if snapshot.organization_id != org_user.organization_id:
        raise HTTPException(403, "Workspace not in organization")
    return snapshot
```

### Naming convention

`<resource>_user_can_<action>` — e.g., `workspace_user_can_read`, `workspace_user_can_admin`, `subscription_user_can_cancel`. The function returns the resource snapshot when access is granted.

### Resource-scoped vs platform admin

When "admin" means "admin of *this* path organization", compose `current_path_org_admin` in `<domain>/access.py`. A resource-only route can compose selected-owner `current_org_admin` or `require_owner_role("owner", "admin")` instead. When it means "platform admin" (Proliferate staff, system-wide), use the platform-admin actor from `auth/dependencies.py`.

## Product Policy Rules

`server/<domain>/domain/policy.py` owns pure product-rule verdicts.

### Allowed

- Pure functions taking dataclasses and returning `PolicyVerdict`.
- Reading dataclass fields, comparing values.
- Calling other `domain/<concern>.py` functions.

### Banned

- Raising `HTTPException`. Return a verdict; let the service raise.
- I/O, async, ORM, store imports, service imports.

### Standard shape

```python
# server/cloud/workspaces/domain/policy.py
from proliferate.permissions import PolicyAllowed, PolicyDenied, PolicyVerdict

def can_delete_workspace(workspace: WorkspaceSnapshot) -> PolicyVerdict:
    if workspace.status == WorkspaceStatus.DELETING:
        return PolicyDenied(code="ALREADY_DELETING", message="Already being deleted")
    if workspace.has_active_sessions:
        return PolicyDenied(code="HAS_ACTIVE_SESSIONS", message="Cancel sessions first")
    return PolicyAllowed()
```

### Service composition

```python
# server/cloud/workspaces/service.py
async def delete_workspace(db: AsyncSession, *, workspace: WorkspaceSnapshot) -> None:
    verdict = policy.can_delete_workspace(workspace)
    if isinstance(verdict, PolicyDenied):
        raise WorkspaceConflict(verdict.message, code=verdict.code)
    await store.cloud_workspaces.mark_deleting(db, workspace.id)
```

The service raises a domain error; the global handler maps it to an HTTP response. In the endpoint-composed shape, admin standing is resolved before `delete_workspace` is called. Existing services that still resolve standing inline are migration debt.

## End-to-End Example

```python
# server/cloud/workspaces/api.py
@router.delete("/cloud/workspaces/{workspace_id}")
async def delete_cloud_workspace(
    workspace: WorkspaceSnapshot = Depends(workspace_user_can_admin),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceResponse:
    await service.delete_workspace(db, workspace=workspace)
    return workspace_response(workspace)
```

Each layer does one job, all before the service body runs:

1. **`auth/dependencies.py`** — `current_product_user` (authentication).
2. **`permissions.py`** — the applicable path or selected-owner dependency
   (org standing → `CurrentOrgUser` or `OwnerContext`).
3. **`cloud/workspaces/access.py`** — `workspace_user_can_admin` (resource lookup
   + return snapshot).
4. **`cloud/workspaces/domain/policy.py`** — `can_delete_workspace` (pure rule).
5. **`cloud/workspaces/service.py`** — `delete_workspace` (orchestration only).

The handler is three lines and the service has no inline auth.

## Forbidden Patterns

- Authorization checks inline in `api.py` route bodies. Use deps.
- Org-standing checks buried in `service.py`. New and refactored paths resolve
  `CurrentOrgUser` or `OwnerContext` at the endpoint through `permissions.py`
  and pass it in.
- Product rules buried as `if not condition: raise HTTPException(403)` in
  `service.py`. Extract to pure verdicts in `domain/policy.py`.
- Inline Worker bearer parsing in handlers or services. Authenticate once via
  the domain-owned `authenticate_worker` dependency.
- Importing authorization helpers from a domain service. Domain code imports
  `OwnerContext`, `PolicyVerdict`, request dependencies, and factories from the
  public `proliferate.permissions` seam.
- Returning Pydantic from access deps. Return the dataclass snapshot.
- New no-op actor wrappers. The existing `current_limited_user` compatibility
  seam is not precedent for another.
- Mixing authentication and authorization in one dep. Each does one job; compose
  via `Depends(... = Depends(...))`.
