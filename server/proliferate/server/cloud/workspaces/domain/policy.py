from __future__ import annotations

from uuid import UUID

from proliferate.auth.authorization import PolicyAllowed, PolicyDenied, PolicyVerdict

_CLOUD_WORKSPACE_NOT_FOUND = PolicyDenied(
    code="workspace_not_found",
    message="Cloud workspace not found.",
    status_code=404,
)
_ORG_CLOUD_NOT_READY = PolicyDenied(
    code="org_cloud_not_ready",
    message="Organization cloud workspaces are not available yet.",
    status_code=409,
)


def can_read_cloud_workspace(
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    has_active_organization_membership: bool,
) -> PolicyVerdict:
    if owner_scope == "personal" and owner_user_id == actor_user_id:
        return PolicyAllowed()
    if owner_scope == "organization" and organization_id is not None:
        if has_active_organization_membership:
            return _ORG_CLOUD_NOT_READY
        return _CLOUD_WORKSPACE_NOT_FOUND
    return _CLOUD_WORKSPACE_NOT_FOUND
