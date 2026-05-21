from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mobility import CloudWorkspaceHandoffOp, CloudWorkspaceMobility
from proliferate.db.store.cloud_mobility import (
    all_cleanup_items_completed,
    complete_cloud_workspace_handoff_cleanup,
    get_cleanup_item_for_handoff,
    update_cleanup_item_status,
)
from proliferate.db.store.cloud_sync.exposures import archive_workspace_exposure
from proliferate.db.store.cloud_sync.projections import end_session_projection_by_id
from proliferate.db.store.cloud_workspaces import archive_cloud_workspace_record_by_id

SERVER_CLEANUP_ITEM_KINDS: frozenset[str] = frozenset(
    {
        "cloud_workspace",
        "cloud_exposure",
        "cloud_session_projection",
        "cloud_transcript_projection",
        "worker_projection_cursor",
    }
)


async def execute_server_cleanup_item(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
) -> None:
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None or item.item_kind not in SERVER_CLEANUP_ITEM_KINDS:
        return

    await update_cleanup_item_status(db, cleanup_item=item, status="in_progress")
    try:
        if item.item_kind == "cloud_workspace" and item.object_id is not None:
            await archive_cloud_workspace_record_by_id(db, workspace_id=item.object_id)
        elif item.item_kind == "cloud_exposure" and item.object_id is not None:
            await archive_workspace_exposure(db, exposure_id=item.object_id)
        elif item.item_kind == "cloud_session_projection" and item.object_id is not None:
            await end_session_projection_by_id(db, projection_id=item.object_id)
        elif item.item_kind in {"worker_projection_cursor", "cloud_transcript_projection"}:
            pass
        await update_cleanup_item_status(db, cleanup_item=item, status="completed")
    except Exception as error:
        await update_cleanup_item_status(
            db,
            cleanup_item=item,
            status="failed",
            error_code=error.__class__.__name__,
            error_message=str(error),
        )
        return

    if await all_cleanup_items_completed(db, handoff_op_id=handoff_op_id):
        handoff = await db.get(CloudWorkspaceHandoffOp, handoff_op_id)
        if handoff is None:
            return
        mobility_workspace = (
            await db.execute(
                select(CloudWorkspaceMobility)
                .where(CloudWorkspaceMobility.id == handoff.mobility_workspace_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if mobility_workspace is None:
            return
        await complete_cloud_workspace_handoff_cleanup(
            db,
            handoff_op=handoff,
            mobility_workspace=mobility_workspace,
        )
