from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.mobility import CloudWorkspaceHandoffOp, CloudWorkspaceMobility
from proliferate.db.store.cloud_mobility import (
    all_cleanup_items_completed,
    complete_cloud_workspace_handoff_cleanup,
    fail_cloud_workspace_handoff_op,
    get_cleanup_item_for_handoff,
    list_cleanup_items_for_handoff,
    update_cleanup_item_status,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync.exposures import archive_workspace_exposure
from proliferate.db.store.cloud_sync.projections import end_session_projection_by_id
from proliferate.db.store.cloud_workspaces import archive_cloud_workspace_record_by_id
from proliferate.integrations.anyharness import destroy_runtime_mobility_source
from proliferate.server.cloud.mobility.domain.lifecycle import (
    HANDOFF_PHASE_CLEANUP_FAILED,
    LIFECYCLE_CLEANUP_FAILED,
    cleanup_retry_delay_seconds,
    visible_failure_last_error,
    visible_failure_status_detail,
)
from proliferate.utils.crypto import decrypt_text

SERVER_CLEANUP_ITEM_KINDS: frozenset[str] = frozenset(
    {
        "anyharness_workspace",
        "cloud_workspace",
        "cloud_exposure",
        "cloud_session_projection",
        "cloud_transcript_projection",
        "worker_projection_cursor",
    }
)
_CLEANUP_KIND_ORDER: tuple[str, ...] = (
    "anyharness_workspace",
    "cloud_session_projection",
    "cloud_transcript_projection",
    "cloud_exposure",
    "worker_projection_cursor",
    "cloud_workspace",
)
_CLEANUP_KIND_RANK = {kind: index for index, kind in enumerate(_CLEANUP_KIND_ORDER)}


def cleanup_item_execution_rank(item_kind: str) -> int:
    return _CLEANUP_KIND_RANK.get(item_kind, len(_CLEANUP_KIND_ORDER))


async def _earlier_cleanup_items_completed(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    item_kind: str,
) -> bool:
    item_rank = cleanup_item_execution_rank(item_kind)
    for item in await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id):
        if cleanup_item_execution_rank(item.item_kind) >= item_rank:
            continue
        if item.status != "completed":
            return False
    return True


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
    if not await _earlier_cleanup_items_completed(
        db,
        handoff_op_id=handoff_op_id,
        item_kind=item.item_kind,
    ):
        return

    await update_cleanup_item_status(db, cleanup_item=item, status="in_progress")
    try:
        if item.item_kind == "anyharness_workspace":
            await _destroy_anyharness_workspace_cleanup_item(db, item=item)
        elif item.item_kind == "cloud_workspace" and item.object_id is not None:
            await archive_cloud_workspace_record_by_id(db, workspace_id=item.object_id)
        elif item.item_kind == "cloud_exposure" and item.object_id is not None:
            await archive_workspace_exposure(db, exposure_id=item.object_id)
        elif item.item_kind == "cloud_session_projection" and item.object_id is not None:
            await end_session_projection_by_id(db, projection_id=item.object_id)
        elif item.item_kind in {"worker_projection_cursor", "cloud_transcript_projection"}:
            pass
        await update_cleanup_item_status(db, cleanup_item=item, status="completed")
    except Exception as error:
        value = await update_cleanup_item_status(
            db,
            cleanup_item=item,
            status="failed",
            error_code=error.__class__.__name__,
            error_message=str(error),
            retry_delay_seconds=cleanup_retry_delay_seconds(item.attempt_count + 1),
        )
        if value.attempt_count >= max(1, settings.workspace_move_cleanup_max_attempts):
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
            failure_detail = value.error_message or "Workspace cleanup failed."
            await fail_cloud_workspace_handoff_op(
                db,
                handoff_op=handoff,
                mobility_workspace=mobility_workspace,
                phase=HANDOFF_PHASE_CLEANUP_FAILED,
                lifecycle_state=LIFECYCLE_CLEANUP_FAILED,
                failure_code=value.error_code or "cleanup_failed",
                failure_detail=failure_detail,
                status_detail=visible_failure_status_detail(failure_detail),
                last_error=visible_failure_last_error(failure_detail),
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


async def _destroy_anyharness_workspace_cleanup_item(
    db: AsyncSession,
    *,
    item,
) -> None:
    if item.target_id is None or not item.anyharness_workspace_id:
        return
    runtime_access = await targets_store.load_active_runtime_access_for_target(
        db,
        target_id=item.target_id,
    )
    if runtime_access is None or not runtime_access.anyharness_base_url:
        raise RuntimeError("Cloud runtime access is unavailable for source cleanup.")
    if not runtime_access.runtime_token_ciphertext:
        raise RuntimeError("Cloud runtime token is unavailable for source cleanup.")

    await destroy_runtime_mobility_source(
        runtime_access.anyharness_base_url,
        decrypt_text(runtime_access.runtime_token_ciphertext),
        anyharness_workspace_id=item.anyharness_workspace_id,
    )
