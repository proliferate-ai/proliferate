# Auth

Status: authoritative for authentication, authorization helpers,
resource-access route deps, and product policy rules.

Read after `docs/server/README.md`. This guide details the three-layer auth
model and how each layer's responsibility is enforced.

## Ownership

Auth has three layers, each with a distinct responsibility and home:

| Layer | Question | Lives in | Returns |
|---|---|---|---|
| **Authentication** | Is the request from a logged-in user? | `auth/dependencies.py` | `User` |
| **Resource access** | Does this resource exist + can this user touch it? | `server/<domain>/access.py` | The resource (snapshot dataclass) or raises 403/404 |
| **Product rule** | Given this state, is this action permitted right now? | `server/<domain>/domain/policy.py` | `PolicyVerdict` (allowed or denied) |

Plus one shared module:

| Module | What it holds |
|---|---|
| `auth/authorization.py` | Reusable helpers (`require_org_role`, `OwnerContext`, `PolicyVerdict`) used by both resource-access deps and policy functions |

## Folder Shape

```text
auth/
  __init__.py
  dependencies.py          # get_current_user, platform-admin checks
  authorization.py         # shared helpers: require_org_role, OwnerContext, PolicyVerdict
  jwt.py
  oauth.py
  pkce.py
  users.py
  models.py
  desktop/                 # desktop-specific auth flows

server/<domain>/
  access.py                # resource-access route deps (per domain)
  domain/
    policy.py              # pure product-rule verdicts (per domain)
```

Not every domain needs `access.py` or `domain/policy.py`. Only domains that
protect resources need access deps. Only domains with product rules need
policy.

## Authentication

`auth/dependencies.py` owns the authentication layer.

### Allowed

- `Depends(...)` functions returning `User`.
- JWT parsing, session lookup.
- Platform-level admin checks (e.g., `get_current_platform_admin`) that don't
  scope to a resource — just identity.

### Banned

- Resource-scoped checks. Those are domain-specific and live in
  `server/<domain>/access.py`.
- Business logic.
- ORM access except for the auth user lookup.

### Standard shape

```python
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_async_session),
) -> User:
    payload = decode_jwt(token)
    user = await load_user_by_id(db, payload.sub)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid auth")
    return user

async def get_current_platform_admin(
    user: User = Depends(get_current_user),
) -> User:
    if not user.is_platform_admin:
        raise HTTPException(status_code=403, detail="Platform admin required")
    return user
```

## Authorization Helpers

`auth/authorization.py` owns shared building blocks used by both
resource-access deps and policy functions.

### Allowed

- `require_org_role(context, allowed_roles)` and similar role-check helpers.
- `OwnerContext` (or equivalent) dataclass representing a user's relationship
  to a resource owner.
- `PolicyVerdict` tagged union (`PolicyAllowed | PolicyDenied`).
- `user_has_org_membership(user, organization_id)` and similar identity
  checks.

### Banned

- Resource lookups. Those happen in `<domain>/access.py`.
- HTTP-aware error raising. Helpers raise typed errors; callers decide the
  HTTP translation.
- Imports from `server/<domain>/**`. Auth helpers stay generic.

### Standard shapes

```python
@dataclass(frozen=True)
class OwnerContext:
    user_id: UUID
    organization_id: UUID | None
    role: str | None

def require_org_role(context: OwnerContext, allowed: Iterable[str]) -> None:
    if context.organization_id is None:
        raise PermissionDenied("Organization required")
    if context.role not in allowed:
        raise PermissionDenied(f"Role {context.role} not in allowed set")

@dataclass(frozen=True)
class PolicyAllowed:
    pass

@dataclass(frozen=True)
class PolicyDenied:
    code: str
    reason: str

PolicyVerdict = PolicyAllowed | PolicyDenied
```

## Resource-Access Route Deps

`server/<domain>/access.py` owns deps that look up a resource, check the
user can touch it, and return the resource (or raise 403/404).

### Allowed

- `async def` functions taking auth + path/query params and returning a
  resource snapshot.
- Calls to `db/store/**` for the lookup.
- Calls to `auth/authorization.py` for role checks.
- Calls to `domain/policy.py` for state-based access checks.
- Raising 404 for missing resources, 403 for forbidden.

### Banned

- Mutating writes. Access deps are read-only.
- Business logic beyond access.
- Inline authorization helpers (use `auth/authorization`).
- Returning Pydantic. Return the dataclass snapshot.

### Standard shape

```python
# server/cloud/workspaces/access.py
async def workspace_user_can_read(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceSnapshot:
    snapshot = await store.cloud_workspaces.get_workspace_snapshot(
        db, workspace_id
    )
    if snapshot is None:
        raise HTTPException(404, "Workspace not found")
    org_context = await store.organizations.get_owner_context(
        db, snapshot.owner_id, user.id
    )
    require_org_role(org_context, {OWNER, ADMIN, MEMBER})
    return snapshot

async def workspace_user_can_admin(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceSnapshot:
    # similar, but require admin role
    ...
```

### Naming convention

`<resource>_user_can_<action>` — e.g., `workspace_user_can_read`,
`workspace_user_can_admin`, `subscription_user_can_cancel`. The function
returns the resource snapshot when access is granted.

### Resource-scoped admin

When "admin" means "admin of *this specific* resource" (the common case),
use `<resource>_user_can_admin` in `<domain>/access.py`. When it means
"platform admin" (Proliferate staff with system-wide privileges), use
`get_current_platform_admin` from `auth/dependencies.py`.

## Product Policy Rules

`server/<domain>/domain/policy.py` owns pure product-rule verdicts.

### Allowed

- Pure functions taking dataclasses and returning `PolicyVerdict`.
- Reading dataclass fields, comparing values.
- Calling other `domain/<concern>.py` functions.

### Banned

- Raising `HTTPException`. Return a verdict; let the service raise.
- I/O, async, ORM, store imports.
- Service.py imports.
- Logging beyond pure data tracing.

### Standard shape

```python
# server/cloud/workspaces/domain/policy.py
from auth.authorization import PolicyAllowed, PolicyDenied, PolicyVerdict

def can_delete_workspace(workspace: WorkspaceSnapshot) -> PolicyVerdict:
    if workspace.status == WorkspaceStatus.DELETING:
        return PolicyDenied(
            code="ALREADY_DELETING",
            reason="Workspace is already being deleted",
        )
    if workspace.has_active_sessions:
        return PolicyDenied(
            code="HAS_ACTIVE_SESSIONS",
            reason="Cancel active sessions before deleting",
        )
    return PolicyAllowed()
```

### Service composition

```python
# server/cloud/workspaces/service.py
async def delete_workspace(
    db: AsyncSession,
    *,
    workspace: WorkspaceSnapshot,
) -> None:
    verdict = policy.can_delete_workspace(workspace)
    if isinstance(verdict, PolicyDenied):
        raise WorkspaceConflict(code=verdict.code, reason=verdict.reason)
    await store.cloud_workspaces.mark_deleting(db, workspace.id)
```

The service raises a domain error; the global exception handler maps it to
HTTPException with the `code` field.

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

Five files, each with one job:

1. **`auth/dependencies.py`** — `get_current_user` (authentication).
2. **`auth/authorization.py`** — `require_org_role`, `PolicyVerdict`
   (shared helpers).
3. **`cloud/workspaces/access.py`** — `workspace_user_can_admin` (resource
   access; lookup + role check + return snapshot).
4. **`cloud/workspaces/domain/policy.py`** — `can_delete_workspace` (pure
   product rule).
5. **`cloud/workspaces/service.py`** — `delete_workspace` (orchestration:
   policy check + store call).

The handler is three lines. No auth check is inline in the service body or
the handler body.

## Forbidden Patterns

- Authorization checks inline in `api.py` route handler bodies. Use deps.
- Authorization checks inline in `service.py` when they could have been
  route deps. Front-load access checks via `Depends`.
- Product rules buried as `if not condition: raise HTTPException(403)` in
  `service.py`. Extract to pure verdict functions in `domain/policy.py`.
- Cross-domain imports for auth infrastructure
  (`from organizations.service import require_org_role`). Always import
  from `auth.authorization`.
- Returning Pydantic from access deps. Return the dataclass snapshot.
- Catching `HTTPException` from a route dep to translate it. The dep raises
  the right code; the handler shouldn't intercept.
- Mixing authentication and authorization in one dep. Each dep does one
  job; compose them via `Depends(... = Depends(...))`.

## Migration Notes

When moving authorization helpers to `auth/authorization.py`:

1. Move `require_org_role` and related helpers from
   `organizations/service.py`.
2. Update every importer to use `from auth.authorization import
   require_org_role`.
3. Verify no domain-specific assumptions baked into the helpers; helpers
   are domain-agnostic.

When introducing `<domain>/access.py`:

1. Identify endpoints currently doing authorization inline in service.py.
2. Move the lookup + access check to a route dep returning the resource.
3. Update the handler to take the resource via `Depends(...)`.
4. Remove the inline authorization from the service.
5. Service now operates on a snapshot known to be authorized.

When introducing `<domain>/domain/policy.py`:

1. Find inline `if not allowed: raise HTTPException(...)` blocks in
   `service.py`.
2. Convert each to a pure verdict function.
3. Service calls the verdict, raises a domain error on `PolicyDenied`.
4. Verify the function is unit-testable with no DB or HTTP context.
