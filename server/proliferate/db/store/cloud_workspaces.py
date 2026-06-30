"""Persistence helpers for cloud workspaces."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.utils.time import utcnow

CloudWorkspaceLifecycle = Literal["active", "archived", "all"]


def _apply_workspace_lifecycle_filter(
    statement: Select[tuple[CloudWorkspace]],
    lifecycle: CloudWorkspaceLifecycle,
) -> Select[tuple[CloudWorkspace]]:
    if lifecycle == "active":
        return statement.where(CloudWorkspace.archived_at.is_(None))
    if lifecycle == "archived":
        return statement.where(CloudWorkspace.archived_at.is_not(None))
    return statement


async def list_cloud_workspaces(
    db: AsyncSession,
    user_id: UUID,
    *,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .where(
            CloudWorkspace.owner_scope == "personal",
            CloudWorkspace.owner_user_id == user_id,
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_claimed_organization_workspaces_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .join(
            OrganizationMembership,
            OrganizationMembership.organization_id == CloudWorkspace.organization_id,
        )
        .where(
            CloudWorkspace.owner_scope == "organization",
            CloudWorkspaceExposure.visibility == "claimed",
            CloudWorkspaceExposure.claimed_by_user_id == user_id,
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            CloudWorkspaceExposure.archived_at.is_(None),
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_exposed_cloud_workspaces_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID | None = None,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    personal_query = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .where(
            CloudWorkspace.owner_scope == "personal",
            CloudWorkspace.owner_user_id == user_id,
            CloudWorkspaceExposure.owner_scope == "personal",
            CloudWorkspaceExposure.owner_user_id == user_id,
            CloudWorkspaceExposure.archived_at.is_(None),
            CloudWorkspaceExposure.status == "active",
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    personal_query = _apply_workspace_lifecycle_filter(personal_query, lifecycle)
    if organization_id is not None:
        personal_rows: list[CloudWorkspace] = []
    else:
        personal_rows = list((await db.execute(personal_query)).scalars().all())

    organization_query = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .join(
            OrganizationMembership,
            OrganizationMembership.organization_id == CloudWorkspace.organization_id,
        )
        .where(
            CloudWorkspace.owner_scope == "organization",
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            CloudWorkspaceExposure.owner_scope == "organization",
            CloudWorkspaceExposure.archived_at.is_(None),
            CloudWorkspaceExposure.status == "active",
            (
                (CloudWorkspaceExposure.visibility == "shared_unclaimed")
                | (CloudWorkspaceExposure.claimed_by_user_id == user_id)
                | (
                    OrganizationMembership.role.in_(
                        (ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN),
                    )
                )
            ),
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    organization_query = _apply_workspace_lifecycle_filter(organization_query, lifecycle)
    if organization_id is not None:
        organization_query = organization_query.where(
            CloudWorkspace.organization_id == organization_id,
        )
    organization_rows = list((await db.execute(organization_query)).scalars().all())

    by_id: dict[UUID, CloudWorkspace] = {}
    for workspace in [*personal_rows, *organization_rows]:
        by_id[workspace.id] = workspace
    return sorted(by_id.values(), key=lambda workspace: workspace.updated_at, reverse=True)


async def list_unclaimed_organization_workspaces(
    db: AsyncSession,
    *,
    organization_id: UUID,
    lifecycle: CloudWorkspaceLifecycle = "active",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .join(
            CloudWorkspaceExposure,
            CloudWorkspaceExposure.cloud_workspace_id == CloudWorkspace.id,
        )
        .where(
            CloudWorkspace.owner_scope == "organization",
            CloudWorkspace.organization_id == organization_id,
            CloudWorkspaceExposure.visibility == "shared_unclaimed",
            CloudWorkspaceExposure.archived_at.is_(None),
        )
        .order_by(CloudWorkspace.created_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_organization_workspaces_for_admin_audit(
    db: AsyncSession,
    *,
    organization_id: UUID,
    lifecycle: CloudWorkspaceLifecycle = "all",
) -> list[CloudWorkspace]:
    statement = (
        select(CloudWorkspace)
        .where(
            CloudWorkspace.owner_scope == "organization",
            CloudWorkspace.organization_id == organization_id,
        )
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_workspace_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def get_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.id == workspace_id,
                CloudWorkspace.owner_scope == "personal",
                CloudWorkspace.owner_user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_by_id(
    db: AsyncSession,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()


async def get_active_cloud_workspace_for_runtime_branch(
    db: AsyncSession,
    *,
    runtime_environment_id: UUID,
    git_branch: str,
    exclude_workspace_id: UUID | None = None,
) -> CloudWorkspace | None:
    statement = select(CloudWorkspace).where(
        CloudWorkspace.runtime_environment_id == runtime_environment_id,
        CloudWorkspace.git_branch == git_branch,
        CloudWorkspace.archived_at.is_(None),
    )
    if exclude_workspace_id is not None:
        statement = statement.where(CloudWorkspace.id != exclude_workspace_id)
    return (await db.execute(statement.limit(1))).scalar_one_or_none()


async def get_active_cloud_workspace_for_managed_profile_branch(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    exclude_workspace_id: UUID | None = None,
) -> CloudWorkspace | None:
    statement = select(CloudWorkspace).where(
        CloudWorkspace.sandbox_profile_id == sandbox_profile_id,
        CloudWorkspace.target_id == target_id,
        CloudWorkspace.git_provider == git_provider,
        CloudWorkspace.git_owner == git_owner,
        CloudWorkspace.git_repo_name == git_repo_name,
        CloudWorkspace.git_branch == git_branch,
        CloudWorkspace.archived_at.is_(None),
    )
    if exclude_workspace_id is not None:
        statement = statement.where(CloudWorkspace.id != exclude_workspace_id)
    return (await db.execute(statement.limit(1))).scalar_one_or_none()


async def get_existing_cloud_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.owner_scope == "personal",
                CloudWorkspace.owner_user_id == user_id,
                CloudWorkspace.git_provider == git_provider,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
                CloudWorkspace.git_branch == git_branch,
                CloudWorkspace.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def get_existing_managed_cloud_workspace_for_profile(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.sandbox_profile_id == sandbox_profile_id,
                CloudWorkspace.target_id == target_id,
                CloudWorkspace.git_provider == git_provider,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
                CloudWorkspace.git_branch == git_branch,
                CloudWorkspace.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def list_active_cloud_workspace_branches_for_user_repo(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> set[str]:
    rows = await db.execute(
        select(CloudWorkspace.git_branch).where(
            CloudWorkspace.owner_scope == "personal",
            CloudWorkspace.owner_user_id == user_id,
            CloudWorkspace.git_provider == git_provider,
            CloudWorkspace.git_owner == git_owner,
            CloudWorkspace.git_repo_name == git_repo_name,
            CloudWorkspace.archived_at.is_(None),
        )
    )
    return {branch for branch in rows.scalars().all() if branch}


async def list_active_managed_cloud_workspace_branches_for_profile_repo(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> set[str]:
    rows = await db.execute(
        select(CloudWorkspace.git_branch).where(
            CloudWorkspace.sandbox_profile_id == sandbox_profile_id,
            CloudWorkspace.target_id == target_id,
            CloudWorkspace.git_provider == git_provider,
            CloudWorkspace.git_owner == git_owner,
            CloudWorkspace.git_repo_name == git_repo_name,
            CloudWorkspace.archived_at.is_(None),
        )
    )
    return {branch for branch in rows.scalars().all() if branch}


async def load_any_cloud_workspace_for_repo(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace)
            .where(
                CloudWorkspace.owner_scope == "personal",
                CloudWorkspace.owner_user_id == user_id,
                CloudWorkspace.git_owner == git_owner,
                CloudWorkspace.git_repo_name == git_repo_name,
            )
            .order_by(CloudWorkspace.updated_at.desc())
        )
    ).scalar_one_or_none()


async def update_workspace_branch(
    db: AsyncSession,
    workspace: CloudWorkspace,
    branch_name: str,
) -> CloudWorkspace:
    workspace.git_branch = branch_name
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


async def update_workspace_display_name(
    db: AsyncSession,
    workspace: CloudWorkspace,
    display_name: str | None,
) -> CloudWorkspace:
    workspace.display_name = display_name
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace
