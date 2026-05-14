"""Policy decisions for cloud compute target management."""

from __future__ import annotations

from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.organization_records import MembershipRecord
from proliferate.server.cloud.errors import CloudApiError


def require_target_admin_membership(
    membership: MembershipRecord | None,
) -> None:
    if membership is None:
        raise CloudApiError(
            "cloud_target_organization_not_found",
            "Organization not found.",
            status_code=404,
        )
    if membership.role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "cloud_target_organization_permission_denied",
            "You do not have permission to manage targets for this organization.",
            status_code=403,
        )
