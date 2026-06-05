"""Persistence helpers for cloud workspace lifecycle state."""

from __future__ import annotations

from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudWorkspaceCleanupState, CloudWorkspaceStatus
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_workspaces import persist_workspace_destroy, persist_workspace_stop
from proliferate.utils.time import utcnow

_UNSET: Final = object()


async def delete_cloud_workspace_records(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    await archive_cloud_workspace_record(db, workspace=workspace)
    await db.flush()


async def archive_cloud_workspace_record(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    now = utcnow()
    was_archived = workspace.archived_at is not None
    workspace.archive_requested_at = workspace.archive_requested_at or now
    workspace.archived_at = workspace.archived_at or now
    workspace.status = CloudWorkspaceStatus.archived.value
    workspace.status_detail = "Archived"
    if not was_archived or workspace.cleanup_state == CloudWorkspaceCleanupState.none.value:
        workspace.cleanup_state = (
            CloudWorkspaceCleanupState.pending.value
            if workspace.target_id is not None and workspace.anyharness_workspace_id
            else CloudWorkspaceCleanupState.complete.value
        )
    workspace.updated_at = now
    await db.flush()
    return workspace


async def restore_cloud_workspace_record(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    now = utcnow()
    workspace.archive_requested_at = None
    workspace.archived_at = None
    workspace.cleanup_state = CloudWorkspaceCleanupState.none.value
    workspace.cleanup_last_error = None
    workspace.status = (
        CloudWorkspaceStatus.ready.value
        if workspace.anyharness_workspace_id
        else CloudWorkspaceStatus.needs_rematerialization.value
    )
    workspace.status_detail = (
        "Ready" if workspace.status == CloudWorkspaceStatus.ready.value else "Restore pending"
    )
    workspace.updated_at = now
    await db.flush()
    return workspace


async def update_cloud_workspace_materialization_state(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    anyharness_workspace_id: str | None | object = _UNSET,
    worktree_path: str | None | object = _UNSET,
    status: CloudWorkspaceStatus | str | object = _UNSET,
    status_detail: str | None | object = _UNSET,
    cleanup_state: CloudWorkspaceCleanupState | str | object = _UNSET,
    cleanup_last_error: str | None | object = _UNSET,
    materialized_target_id: UUID | None | object = _UNSET,
) -> CloudWorkspace:
    now = utcnow()
    if anyharness_workspace_id is not _UNSET:
        workspace.anyharness_workspace_id = anyharness_workspace_id
        if anyharness_workspace_id:
            workspace.ready_at = workspace.ready_at or now
    if worktree_path is not _UNSET:
        workspace.worktree_path = worktree_path
    if status is not _UNSET:
        workspace.status = status.value if hasattr(status, "value") else str(status)
    if status_detail is not _UNSET:
        workspace.status_detail = status_detail
    if cleanup_state is not _UNSET:
        workspace.cleanup_state = (
            cleanup_state.value if hasattr(cleanup_state, "value") else str(cleanup_state)
        )
    if cleanup_last_error is not _UNSET:
        workspace.cleanup_last_error = (
            cleanup_last_error[:2000] if isinstance(cleanup_last_error, str) else None
        )
    if materialized_target_id is not _UNSET:
        workspace.materialized_target_id = materialized_target_id
    workspace.updated_at = now
    await db.flush()
    return workspace


async def purge_cloud_workspace_record(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
) -> None:
    await db.delete(workspace)
    await db.flush()


async def archive_cloud_workspace_record_by_id(
    db: AsyncSession,
    *,
    workspace_id: UUID,
) -> CloudWorkspace | None:
    workspace = (
        await db.execute(
            select(CloudWorkspace).where(CloudWorkspace.id == workspace_id).with_for_update()
        )
    ).scalar_one_or_none()
    if workspace is None:
        return None
    return await archive_cloud_workspace_record(db, workspace=workspace)


async def persist_workspace_stop_state(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    merged = await db.merge(workspace)
    await persist_workspace_stop(db, merged)


async def persist_workspace_destroy_state(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    merged = await db.merge(workspace)
    await persist_workspace_destroy(db, merged)


async def delete_cloud_workspace_records_for_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> None:
    merged = await db.merge(workspace)
    await delete_cloud_workspace_records(db, merged)
