"""Access checks for cloud repo configuration APIs."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.store.organizations import get_active_membership
from proliferate.server.cloud.errors import CloudApiError


async def require_organization_repo_config_admin(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    if membership is None:
        raise CloudApiError(
            "organization_repo_config_not_found",
            "Organization repo configuration not found.",
            status_code=404,
        )
    if membership.role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "organization_repo_config_permission_denied",
            "You do not have permission to manage shared environments for this organization.",
            status_code=403,
        )
