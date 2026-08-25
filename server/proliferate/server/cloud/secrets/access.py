"""Route dependencies for Cloud Secrets resource access."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organization_store
from proliferate.db.store import repositories as repositories_store
from proliferate.server.api_errors import CloudApiError


@dataclass(frozen=True)
class OrganizationSecretsAccess:
    actor_user_id: UUID
    organization_id: UUID
    membership_role: str


@dataclass(frozen=True)
class WorkspaceSecretsAccess:
    actor_user_id: UUID
    repo_environment_id: UUID


async def organization_secrets_member_access(
    organization_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OrganizationSecretsAccess:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    if membership is None:
        raise CloudApiError(
            "organization_secrets_not_found",
            "Organization secrets not found.",
            status_code=404,
        )
    return OrganizationSecretsAccess(
        actor_user_id=user.id,
        organization_id=organization_id,
        membership_role=membership.role,
    )


async def organization_secrets_admin_access(
    access: OrganizationSecretsAccess = Depends(organization_secrets_member_access),
) -> OrganizationSecretsAccess:
    if access.membership_role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "organization_secrets_permission_denied",
            "You do not have permission to manage organization secrets.",
            status_code=403,
        )
    return access


async def workspace_secrets_access(
    git_owner: str,
    git_repo_name: str,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceSecretsAccess:
    environment = await repositories_store.get_cloud_repo_environment(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_configured",
            "Configure this GitHub repo for cloud before managing workspace secrets.",
            status_code=404,
        )
    return WorkspaceSecretsAccess(
        actor_user_id=user.id,
        repo_environment_id=environment.id,
    )
