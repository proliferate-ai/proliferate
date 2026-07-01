"""Persistence helpers for lightweight cloud workspace product rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow

CloudWorkspaceLifecycle = Literal["active", "archived", "all"]


@dataclass(frozen=True)
class CloudWorkspaceValue:
    id: UUID
    owner_user_id: UUID
    repo_environment_id: UUID
    display_name: str
    git_branch: str
    git_base_branch: str | None
    anyharness_workspace_id: str | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


def cloud_workspace_value(row: CloudWorkspace) -> CloudWorkspaceValue:
    return CloudWorkspaceValue(
        id=row.id,
        owner_user_id=row.owner_user_id,
        repo_environment_id=row.repo_environment_id,
        display_name=row.display_name,
        git_branch=row.git_branch,
        git_base_branch=row.git_base_branch,
        anyharness_workspace_id=row.anyharness_workspace_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


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
) -> list[CloudWorkspaceValue]:
    statement = (
        select(CloudWorkspace)
        .where(CloudWorkspace.owner_user_id == user_id)
        .order_by(CloudWorkspace.updated_at.desc())
    )
    statement = _apply_lifecycle_filter(statement, lifecycle)
    return [cloud_workspace_value(row) for row in (await db.execute(statement)).scalars().all()]


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
) -> CloudWorkspaceValue | None:
    row = (
        await db.execute(
            select(CloudWorkspace).where(
                CloudWorkspace.id == workspace_id,
                CloudWorkspace.owner_user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return cloud_workspace_value(row) if row is not None else None


async def get_cloud_workspace_by_id(
    db: AsyncSession,
    workspace_id: UUID,
) -> CloudWorkspaceValue | None:
    row = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    return cloud_workspace_value(row) if row is not None else None


async def create_cloud_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_environment_id: UUID,
    display_name: str,
    git_branch: str,
    git_base_branch: str | None,
    anyharness_workspace_id: str | None = None,
) -> CloudWorkspaceValue | None:
    """Create a workspace row; returns None when the active branch is taken."""
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
    try:
        async with db.begin_nested():
            db.add(workspace)
            await db.flush()
    except IntegrityError:
        return None
    return cloud_workspace_value(workspace)


async def update_workspace_anyharness_workspace_id(
    db: AsyncSession,
    workspace: CloudWorkspaceValue,
    anyharness_workspace_id: str,
) -> CloudWorkspaceValue:
    row = await _load_workspace_row(db, workspace.id)
    row.anyharness_workspace_id = anyharness_workspace_id
    row.updated_at = utcnow()
    await db.flush()
    return cloud_workspace_value(row)


async def update_workspace_display_name(
    db: AsyncSession,
    workspace: CloudWorkspaceValue,
    display_name: str,
) -> CloudWorkspaceValue:
    row = await _load_workspace_row(db, workspace.id)
    row.display_name = display_name
    row.updated_at = utcnow()
    await db.flush()
    return cloud_workspace_value(row)


async def archive_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspaceValue,
) -> CloudWorkspaceValue:
    row = await _load_workspace_row(db, workspace.id)
    now = utcnow()
    row.archived_at = now
    row.updated_at = now
    await db.flush()
    return cloud_workspace_value(row)


async def restore_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspaceValue,
) -> CloudWorkspaceValue | None:
    """Clear archived_at; returns None when the active branch is taken."""
    row = await _load_workspace_row(db, workspace.id)
    try:
        async with db.begin_nested():
            row.archived_at = None
            row.updated_at = utcnow()
            await db.flush()
    except IntegrityError:
        return None
    return cloud_workspace_value(row)


async def delete_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspaceValue,
) -> None:
    row = await _load_workspace_row(db, workspace.id)
    await db.delete(row)
    await db.flush()


async def _load_workspace_row(db: AsyncSession, workspace_id: UUID) -> CloudWorkspace:
    row = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one()
    return row
