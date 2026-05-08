"""Pure organization authorization and membership policy rules."""

from __future__ import annotations

from uuid import UUID

from proliferate.auth.authorization import (
    OwnerContext,
    PolicyAllowed,
    PolicyDenied,
    PolicyVerdict,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_ROLES,
)

_ORGANIZATION_ADMIN_ROLES = frozenset(
    {
        ORGANIZATION_ROLE_OWNER,
        ORGANIZATION_ROLE_ADMIN,
    }
)
_ORGANIZATION_OWNER_ROLES = frozenset({ORGANIZATION_ROLE_OWNER})
_ORGANIZATION_MEMBERSHIP_UPDATE_STATUSES = frozenset(
    {
        ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    }
)


def organization_admin_roles() -> frozenset[str]:
    return _ORGANIZATION_ADMIN_ROLES


def required_roles_for_invitation_role(role: str) -> frozenset[str]:
    if role == ORGANIZATION_ROLE_OWNER:
        return _ORGANIZATION_OWNER_ROLES
    return _ORGANIZATION_ADMIN_ROLES


def can_modify_membership(
    context: OwnerContext,
    membership_id: UUID,
) -> PolicyVerdict:
    if context.membership_id == membership_id:
        return PolicyDenied(
            code="cannot_modify_own_membership",
            message="You cannot modify your own organization membership.",
            status_code=403,
        )
    return PolicyAllowed()


def can_modify_owner_memberships(context: OwnerContext) -> bool:
    return context.membership_role == ORGANIZATION_ROLE_OWNER


def is_organization_role(role: str) -> bool:
    return role in ORGANIZATION_ROLES


def is_membership_update_status(status: str) -> bool:
    return status in _ORGANIZATION_MEMBERSHIP_UPDATE_STATUSES
