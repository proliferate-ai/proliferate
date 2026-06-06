# Auth

Server auth has four boundaries: **authentication** identifies the caller,
**org authorization** decides whether that caller has the right standing in an
organization, **resource access** checks whether the caller can touch a specific
resource, and **product policy** decides whether the current resource state
allows an action. Every one of them is enforced at the endpoint via `Depends()`.
Services receive a resolved, pre-authorized context and contain **no auth
checks** — they are never a hidden permission layer.

## Ownership

| Boundary | Question | Lives in | Returns |
|---|---|---|---|
| **Authentication** | Who is the caller? | `auth/dependencies.py` | the actor (`User` / `WorkerAuthContext`) |
| **Org authorization** | Does the caller have the right org standing? | `permissions.py` (factory deps) | `OwnerContext` |
| **Resource access** | Can this caller touch *this* resource? | `server/<domain>/access.py` | the resource snapshot, or raises 403/404 |
| **Product rule** | Given this state, is the action permitted now? | `server/<domain>/domain/policy.py` | `PolicyVerdict` |

Authorization currency — `OwnerContext`, `PolicyVerdict`, `require_org_role`,
`require_org_membership` — lives in `server/proliferate/permissions.py`, not in
`auth/`. It is product-wide vocabulary imported by ~every domain and has no
auth-specific logic, so it sits at the server root next to `config.py` and
`errors.py`. `auth/` owns only authentication and the OAuth/identity surfaces.

## The actor dependency hierarchy

Authorization is a chain of `Depends()`, each one composing the one above it. An
endpoint declares the *lowest actor it requires* and gets everything below it for
free; nothing downstream re-checks.

```text
anonymous
└── current_active_user                    active user
    └── current_product_user               + GitHub connected — default for product/cloud surfaces
        ├── require_org_membership(org_id)  org member  -> OwnerContext
        └── require_org_role(org_id, roles) org standing -> OwnerContext

current_worker                             worker JWT  -> WorkerAuthContext
optional_current_active_user               maybe authenticated (public-with-extras)
```

`require_org_membership` and `require_org_role` are **dependency factories**:
called with the path's `org_id` (and, for role, the allowed roles), they return a
`Depends` that resolves and returns an `OwnerContext`. Org standing is checked at
the endpoint boundary — never inside a service. This is the whole centralized
model: identity actors in `auth/dependencies.py`, org-authorization factories in
`permissions.py`, both wired in at the route via `Depends()`.

## Shape

```text
server/proliferate/
  permissions.py             # OwnerContext, PolicyVerdict, require_org_role, require_org_membership

  auth/
    __init__.py
    dependencies.py          # all actor deps: current_active_user, current_product_user,
                             #   optional_current_active_user, current_worker
    users.py                 # UserManager (fastapi-users lifecycle plumbing)
    viewer_api/              # /auth/viewer + /users/me surface: api.py, profile_api.py, service.py, models.py
    desktop_api/             # desktop OAuth flow (authorize, callback, PKCE, pages)
    identity_api/            # core identity: providers, store, service, routing, types
    utils/                   # auth crypto primitives only: jwt, oauth, passwords, pkce

  server/<domain>/
    access.py                # resource-access route deps (per domain)
    domain/
      policy.py              # pure product-rule verdicts (per domain)
```

`auth/utils/` holds only the closed set of auth crypto primitives
(`jwt`, `oauth`, `passwords`, `pkce`); it is not a general bucket. Not every
domain needs `access.py` or `domain/policy.py` — only domains that protect
resources or carry product rules.

## Authentication

`auth/dependencies.py` owns every actor dependency — the single home for "who is
the caller." Each is a thin `Depends()` that composes the one above it.

| Dep | Gates |
|---|---|
| `current_active_user` | active user, no GitHub requirement |
| `current_product_user` | active user **+ GitHub connected** — the default for product/cloud surfaces |
| `optional_current_active_user` | maybe authenticated (public route with extra behavior when signed in) |
| `current_worker` | worker JWT, resolved to a `WorkerAuthContext` (see Worker actor) |

There is no `current_limited_user`: it was a no-op wrapper over
`current_active_user` and does not exist in this model.

### Allowed

- `Depends(...)` functions returning an actor (`User` or `WorkerAuthContext`).
- JWT parsing (via `auth/utils/jwt`), session/user lookup.
- Platform-level admin checks that scope to identity, not a resource.

### Banned

- Org-standing or resource-scoped checks. Org standing belongs in
  `permissions.py` factory deps; resource checks belong in
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

async def current_product_user(
    user: User = Depends(current_active_user),
) -> User:
    if not user.github_connected:
        raise HTTPException(status_code=403, detail="GitHub connection required")
    return user
```

### OAuth and identity surfaces

Product OAuth lives under `auth/identity_api/**`; the desktop boundary lives under
`auth/desktop_api/**`. GitHub uses the shared `/auth/github/callback` provider
callback for desktop, web, and mobile. The surface is recovered from the stored
auth challenge, so the GitHub OAuth app needs only one callback URL:

```text
<API_BASE_URL>/auth/github/callback
```

Desktop GitHub still starts through `POST /auth/desktop/github/start`, exchanges
desktop auth codes through `/auth/desktop/token`, and handles
`proliferate://auth/callback` deep links. The older
`/auth/desktop/github/authorize` and `/auth/desktop/github/callback` routes are
compatibility routes and must not be configured as the current callback.

## Worker actor

`current_worker` authenticates a remote runtime worker. A worker is not a user:
it presents a worker JWT that resolves to a single `target_id`, and that resolved
`WorkerAuthContext` is what worker-facing endpoints depend on. It lives in
`auth/dependencies.py` alongside the other actors — there is no inline
`authenticate_worker(...)` call in any endpoint body.

### Allowed

- A `Depends()` that verifies the worker JWT (via `auth/utils/jwt`) and returns
  the `WorkerAuthContext` (the resolved `target_id` and its context).
- Rejecting an unknown, archived, or revoked token with 401.

### Banned

- Command- or revision-scoped authorization. The dep authenticates the worker;
  whether a target may act on a specific command or revision is decided in the
  owning domain.
- Inline `worker_token` parsing in `api.py` handlers or in services. The token is
  authenticated once, in the dep; ~15 copy-pasted call sites collapse into it.

### Standard shape

```python
# auth/dependencies.py
async def current_worker(
    authorization: str = Header(...),
    db: AsyncSession = Depends(get_async_session),
) -> WorkerAuthContext:
    context = await resolve_worker_token(db, authorization)
    if context is None:
        raise HTTPException(status_code=401, detail="Invalid worker token")
    return context
```

Worker-facing endpoints — the control long-poll, command lease/result, and
applied-revision report — depend on `current_worker` and receive a pre-authorized
`target_id`. Services on those paths never re-authenticate the worker.

## Org Authorization

`server/proliferate/permissions.py` owns org-standing authorization and the
shared verdict vocabulary, used by route deps, resource-access deps, and policy
functions across every domain.

### Allowed

- `require_org_membership(org_id)` and `require_org_role(org_id, roles)` —
  dependency factories that resolve and return an `OwnerContext`.
- `OwnerContext` (and `OwnerSelection`) describing a caller's relationship to an
  organization.
- `PolicyVerdict` tagged union (`PolicyAllowed | PolicyDenied`).

### Banned

- Resource lookups. Those happen in `server/<domain>/access.py`.
- Auth-flow logic. `permissions.py` is product authorization, not authentication.
- Imports from `auth/**` or `server/<domain>/**`. It stays a leaf so every layer
  can import it.

### Standard shapes

```python
# server/proliferate/permissions.py
@dataclass(frozen=True)
class OwnerContext:
    user_id: UUID
    organization_id: UUID | None
    role: str | None

def require_org_role(org_id: UUID, roles: Iterable[str]):
    async def _dep(
        user: User = Depends(current_product_user),
        db: AsyncSession = Depends(get_async_session),
    ) -> OwnerContext:
        context = await resolve_owner_context(db, org_id, user.id)
        if context.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient org role")
        return context
    return _dep

@dataclass(frozen=True)
class PolicyAllowed: ...

@dataclass(frozen=True)
class PolicyDenied:
    code: str
    reason: str

PolicyVerdict = PolicyAllowed | PolicyDenied
```

## Resource-Access Route Deps

`server/<domain>/access.py` owns deps that look up a resource, check the caller
can touch it, and return the resource (or raise 403/404).

### Allowed

- `async def` functions taking an actor + path/query params and returning a
  resource snapshot.
- Calls to `db/store/**` for the lookup.
- Composing `require_org_role`/`require_org_membership` from `permissions.py`.
- Calls to `domain/policy.py` for state-based access checks.
- Raising 404 for missing resources, 403 for forbidden.

### Banned

- Mutating writes. Access deps are read-only.
- Business logic beyond access.
- Inline org-authorization logic (compose the `permissions.py` factory).
- Returning Pydantic. Return the dataclass snapshot.

### Standard shape

```python
# server/cloud/workspaces/access.py
async def workspace_user_can_admin(
    workspace_id: UUID,
    owner: OwnerContext = Depends(require_org_role(... , roles={OWNER, ADMIN})),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceSnapshot:
    snapshot = await store.cloud_workspaces.get_workspace_snapshot(db, workspace_id)
    if snapshot is None:
        raise HTTPException(404, "Workspace not found")
    if snapshot.owner_id != owner.organization_id:
        raise HTTPException(403, "Workspace not in organization")
    return snapshot
```

### Naming convention

`<resource>_user_can_<action>` — e.g., `workspace_user_can_read`,
`workspace_user_can_admin`, `subscription_user_can_cancel`. The function returns
the resource snapshot when access is granted.

### Resource-scoped vs platform admin

When "admin" means "admin of *this* resource", compose `require_org_role` in
`<domain>/access.py`. When it means "platform admin" (Proliferate staff,
system-wide), use the platform-admin actor from `auth/dependencies.py`.

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
        return PolicyDenied(code="ALREADY_DELETING", reason="Already being deleted")
    if workspace.has_active_sessions:
        return PolicyDenied(code="HAS_ACTIVE_SESSIONS", reason="Cancel sessions first")
    return PolicyAllowed()
```

### Service composition

```python
# server/cloud/workspaces/service.py
async def delete_workspace(db: AsyncSession, *, workspace: WorkspaceSnapshot) -> None:
    verdict = policy.can_delete_workspace(workspace)
    if isinstance(verdict, PolicyDenied):
        raise WorkspaceConflict(code=verdict.code, reason=verdict.reason)
    await store.cloud_workspaces.mark_deleting(db, workspace.id)
```

The service raises a domain error; the global handler maps it to an HTTP
response. The service runs **no auth check** — admin standing was resolved by the
endpoint's deps before `delete_workspace` was ever called.

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
2. **`permissions.py`** — `require_org_role` (org standing → `OwnerContext`).
3. **`cloud/workspaces/access.py`** — `workspace_user_can_admin` (resource lookup
   + return snapshot).
4. **`cloud/workspaces/domain/policy.py`** — `can_delete_workspace` (pure rule).
5. **`cloud/workspaces/service.py`** — `delete_workspace` (orchestration only).

The handler is three lines and the service has no inline auth.

## Forbidden Patterns

- Authorization checks inline in `api.py` route bodies. Use deps.
- Org-standing checks buried in `service.py`. Resolve `OwnerContext` at the
  endpoint via the `permissions.py` factory and pass it in.
- Product rules buried as `if not condition: raise HTTPException(403)` in
  `service.py`. Extract to pure verdicts in `domain/policy.py`.
- Inline `authenticate_worker(...)` or `worker_token` parsing in handlers or
  services. Authenticate once via `current_worker`.
- Importing authorization helpers from a domain service
  (`from organizations.service import require_org_role`) or from `auth/`. Always
  import `OwnerContext`, `PolicyVerdict`, and the factories from
  `proliferate.permissions`.
- Returning Pydantic from access deps. Return the dataclass snapshot.
- A `current_limited_user`-style no-op wrapper. Use `current_active_user`.
- Mixing authentication and authorization in one dep. Each does one job; compose
  via `Depends(... = Depends(...))`.
