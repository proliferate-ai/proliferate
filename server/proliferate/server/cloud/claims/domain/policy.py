"""Pure policy helpers for user-facing workspace claims."""

from __future__ import annotations

from uuid import UUID

from proliferate.auth.authorization import PolicyAllowed, PolicyDenied, PolicyVerdict

_NOT_FOUND = PolicyDenied(
    code="workspace_not_found",
    message="Cloud workspace not found.",
    status_code=404,
)
_NOT_UNCLAIMED = PolicyDenied(
    code="workspace_not_unclaimed",
    message="Workspace is not available to claim.",
    status_code=409,
)
_CLAIM_HELD_BY_OTHER = PolicyDenied(
    code="claim_held_by_other",
    message="Workspace has already been claimed by another user.",
    status_code=403,
)
_DIRECT_ATTACH_DESKTOP_ONLY = PolicyDenied(
    code="direct_attach_desktop_only",
    message="Direct workspace attach tokens are only issued to Desktop clients.",
    status_code=403,
)
_DIRECT_ATTACH_NOT_READY = PolicyDenied(
    code="direct_attach_not_ready",
    message="Workspace is not ready for direct Desktop attach.",
    status_code=409,
)


def is_org_admin_role(role: str | None) -> bool:
    return role in {"owner", "admin"}


def can_view_cloud_workspace(
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    exposure_visibility: str | None,
    exposure_claimed_by_user_id: UUID | None,
    has_active_organization_membership: bool,
    is_organization_admin: bool,
) -> PolicyVerdict:
    if owner_scope == "personal":
        return PolicyAllowed() if owner_user_id == actor_user_id else _NOT_FOUND
    if owner_scope != "organization" or organization_id is None:
        return _NOT_FOUND
    if not has_active_organization_membership:
        return _NOT_FOUND

    visibility = exposure_visibility or "private"
    if visibility == "shared_unclaimed":
        return PolicyAllowed()
    if visibility == "claimed":
        if exposure_claimed_by_user_id == actor_user_id or is_organization_admin:
            return PolicyAllowed()
        return _NOT_FOUND
    if visibility == "archived":
        return PolicyAllowed() if is_organization_admin else _NOT_FOUND
    return PolicyAllowed() if is_organization_admin else _NOT_FOUND


def can_interact_cloud_workspace(
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    exposure_visibility: str | None,
    exposure_claimed_by_user_id: UUID | None,
    workspace_archived: bool,
    has_active_organization_membership: bool,
) -> PolicyVerdict:
    if workspace_archived:
        return _NOT_FOUND
    if owner_scope == "personal":
        return PolicyAllowed() if owner_user_id == actor_user_id else _NOT_FOUND
    if owner_scope != "organization" or organization_id is None:
        return _NOT_FOUND
    if not has_active_organization_membership:
        return _NOT_FOUND

    visibility = exposure_visibility or "private"
    if visibility == "shared_unclaimed":
        return PolicyAllowed()
    if visibility == "claimed":
        if exposure_claimed_by_user_id == actor_user_id:
            return PolicyAllowed()
        return _CLAIM_HELD_BY_OTHER
    return _NOT_FOUND


def can_archive_cloud_workspace(
    *,
    actor_user_id: UUID,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    exposure_visibility: str | None,
    exposure_claimed_by_user_id: UUID | None,
    workspace_archived: bool,
    has_active_organization_membership: bool,
    is_organization_admin: bool,
) -> PolicyVerdict:
    # Archive/restore/purge lifecycle calls are retry-safe, so archived rows
    # still flow through the same ownership and claim checks.
    if owner_scope == "personal":
        return PolicyAllowed() if owner_user_id == actor_user_id else _NOT_FOUND
    if owner_scope != "organization" or organization_id is None:
        return _NOT_FOUND
    if not has_active_organization_membership:
        return _NOT_FOUND

    visibility = exposure_visibility or "private"
    if visibility == "shared_unclaimed":
        return PolicyAllowed() if is_organization_admin else _NOT_FOUND
    if visibility == "claimed":
        if exposure_claimed_by_user_id == actor_user_id or is_organization_admin:
            return PolicyAllowed()
        return _CLAIM_HELD_BY_OTHER
    return PolicyAllowed() if is_organization_admin else _NOT_FOUND


def can_claim_cloud_workspace(
    *,
    owner_scope: str,
    organization_id: UUID | None,
    exposure_visibility: str | None,
    workspace_archived: bool,
    has_active_organization_membership: bool,
    claim_exists: bool,
) -> PolicyVerdict:
    if owner_scope != "organization" or organization_id is None:
        return _NOT_FOUND
    if workspace_archived:
        return _NOT_FOUND
    if not has_active_organization_membership:
        return _NOT_FOUND
    if claim_exists:
        return _CLAIM_HELD_BY_OTHER
    if exposure_visibility != "shared_unclaimed":
        return _NOT_UNCLAIMED
    return PolicyAllowed()


def can_request_direct_attach_token(
    *,
    actor_user_id: UUID,
    claimed_by_user_id: UUID | None,
    target_kind: str | None,
    has_anyharness_base_url: bool,
    client_kind: str | None,
    workspace_archived: bool,
    exposure_visibility: str | None,
    exposure_claimed_by_user_id: UUID | None,
) -> PolicyVerdict:
    if workspace_archived:
        return _NOT_FOUND
    if exposure_visibility != "claimed" or exposure_claimed_by_user_id != claimed_by_user_id:
        return _DIRECT_ATTACH_NOT_READY
    if client_kind != "desktop":
        return _DIRECT_ATTACH_DESKTOP_ONLY
    if claimed_by_user_id != actor_user_id:
        return _CLAIM_HELD_BY_OTHER
    if target_kind != "managed_cloud" or not has_anyharness_base_url:
        return _DIRECT_ATTACH_NOT_READY
    return PolicyAllowed()


def can_revoke_claim_token(
    *,
    actor_user_id: UUID,
    claimed_by_user_id: UUID | None,
    is_organization_admin: bool,
    token_status: str,
) -> PolicyVerdict:
    if token_status != "active":
        return PolicyDenied(
            code="claim_token_not_active",
            message="Direct attach token is not active.",
            status_code=409,
        )
    if actor_user_id == claimed_by_user_id or is_organization_admin:
        return PolicyAllowed()
    return _NOT_FOUND
