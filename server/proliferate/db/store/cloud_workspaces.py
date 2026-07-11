"""Persistence helpers for lightweight cloud workspace product rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import Select, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow

CloudWorkspaceLifecycle = Literal["active", "archived", "all"]


class CloudWorkspaceGenerationConflict(Exception):
    """A lifecycle mutation lost its workspace-generation compare-and-swap."""


@dataclass(frozen=True)
class CloudWorkspaceValue:
    id: UUID
    owner_user_id: UUID
    repo_environment_id: UUID
    display_name: str
    git_branch: str
    git_base_branch: str | None
    anyharness_workspace_id: str | None
    generation: int
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
        generation=row.generation,
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


async def get_active_cloud_workspace_for_repo_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_environment_id: UUID,
) -> CloudWorkspaceValue | None:
    """The most-recently-updated non-archived workspace the user owns for a repo
    environment, or None. Backs D16 trigger derivation (reuse before create)."""

    row = (
        await db.execute(
            select(CloudWorkspace)
            .where(
                CloudWorkspace.owner_user_id == user_id,
                CloudWorkspace.repo_environment_id == repo_environment_id,
                CloudWorkspace.archived_at.is_(None),
            )
            .order_by(CloudWorkspace.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return cloud_workspace_value(row) if row is not None else None


async def get_cloud_workspace_for_user(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
    *,
    lock_row: bool = False,
) -> CloudWorkspaceValue | None:
    statement = select(CloudWorkspace).where(
        CloudWorkspace.id == workspace_id,
        CloudWorkspace.owner_user_id == user_id,
    )
    if lock_row:
        statement = statement.with_for_update()
    row = (await db.execute(statement)).scalar_one_or_none()
    return cloud_workspace_value(row) if row is not None else None


async def get_cloud_workspace_by_id(
    db: AsyncSession,
    workspace_id: UUID,
) -> CloudWorkspaceValue | None:
    row = (
        await db.execute(select(CloudWorkspace).where(CloudWorkspace.id == workspace_id))
    ).scalar_one_or_none()
    return cloud_workspace_value(row) if row is not None else None


async def get_cloud_workspace_by_runtime_id(
    db: AsyncSession,
    *,
    user_id: UUID,
    anyharness_workspace_id: str,
    lock_row: bool = False,
) -> CloudWorkspaceValue | None:
    statement = select(CloudWorkspace).where(
        CloudWorkspace.owner_user_id == user_id,
        CloudWorkspace.anyharness_workspace_id == anyharness_workspace_id,
        CloudWorkspace.archived_at.is_(None),
    )
    if lock_row:
        statement = statement.with_for_update()
    row = await db.scalar(statement)
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
) -> CloudWorkspaceValue | None:
    """Fence a runtime-workspace identity update by the caller's generation.

    A newly created row starts at generation 1; its first runtime workspace is
    generation 1 as well. Replacing an already materialized runtime identity
    advances the generation. Stale rematerializers cannot overwrite either.
    """

    next_generation = workspace.generation
    if (
        workspace.anyharness_workspace_id is not None
        and workspace.anyharness_workspace_id != anyharness_workspace_id
    ):
        next_generation += 1
    row = await db.scalar(
        update(CloudWorkspace)
        .where(
            CloudWorkspace.id == workspace.id,
            CloudWorkspace.generation == workspace.generation,
            CloudWorkspace.anyharness_workspace_id.is_not_distinct_from(
                workspace.anyharness_workspace_id
            ),
        )
        .values(
            anyharness_workspace_id=anyharness_workspace_id,
            generation=next_generation,
            updated_at=utcnow(),
        )
        .returning(CloudWorkspace)
    )
    await db.flush()
    return cloud_workspace_value(row) if row is not None else None


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
    now = utcnow()
    row = await db.scalar(
        update(CloudWorkspace)
        .where(
            CloudWorkspace.id == workspace.id,
            CloudWorkspace.generation == workspace.generation,
            CloudWorkspace.archived_at.is_not_distinct_from(workspace.archived_at),
        )
        .values(
            archived_at=now,
            generation=workspace.generation + 1,
            updated_at=now,
        )
        .returning(CloudWorkspace)
    )
    if row is None:
        raise CloudWorkspaceGenerationConflict
    await db.flush()
    return cloud_workspace_value(row)


async def restore_cloud_workspace(
    db: AsyncSession,
    workspace: CloudWorkspaceValue,
) -> CloudWorkspaceValue | None:
    """Restore with a lineage bump; return None when the active branch is taken."""
    try:
        async with db.begin_nested():
            row = await db.scalar(
                update(CloudWorkspace)
                .where(
                    CloudWorkspace.id == workspace.id,
                    CloudWorkspace.generation == workspace.generation,
                    CloudWorkspace.archived_at.is_not_distinct_from(workspace.archived_at),
                )
                .values(
                    archived_at=None,
                    generation=workspace.generation + 1,
                    updated_at=utcnow(),
                )
                .returning(CloudWorkspace)
            )
            if row is None:
                raise CloudWorkspaceGenerationConflict
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
