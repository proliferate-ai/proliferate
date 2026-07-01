"""Persistence helpers for lightweight cloud workspace product rows."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow

CloudWorkspaceLifecycle = Literal["active", "archived", "all"]


def _apply_lifecycle_filter(
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
        .where(CloudWorkspace.owner_user_id == user_id)
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_lifecycle_filter(statement, lifecycle)
    return list((await db.execute(statement)).scalars().all())


async def list_active_workspace_branches_for_repo_environment(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> set[str]:
    rows = await db.execute(
        select(CloudWorkspace.git_branch).where(
            CloudWorkspace.repo_environment_id == repo_environment_id,
            CloudWorkspace.archived_at.is_(None),
        )
    )
    return {value for value in rows.scalars().all() if value}


async def get_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    return (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.id == workspace_id,
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


async def create_cloud_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_environment_id: UUID,
    display_name: str,
    git_branch: str,
    git_base_branch: str | None,
    anyharness_workspace_id: str | None = None,
) -> CloudWorkspace:
    now = utcnow()
    workspace = CloudWorkspace(
        owner_user_id=user_id,
        repo_environment_id=repo_environment_id,
        display_name=display_name,
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        anyharness_workspace_id=anyharness_workspace_id,
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    await db.flush()
    return workspace


async def update_workspace_anyharness_workspace_id(
    db: AsyncSession,
    workspace: CloudWorkspace,
    anyharness_workspace_id: str,
) -> CloudWorkspace:
    workspace.anyharness_workspace_id = anyharness_workspace_id
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


async def update_workspace_display_name(
    db: AsyncSession,
    workspace: CloudWorkspace,
    display_name: str,
) -> CloudWorkspace:
    workspace.display_name = display_name
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


async def archive_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    now = utcnow()
    workspace.archived_at = now
    workspace.updated_at = now
    await db.flush()
    return workspace


async def restore_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    workspace.archived_at = None
    workspace.updated_at = utcnow()
    await db.flush()
    return workspace


async def delete_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    await db.delete(workspace)
    await db.flush()
