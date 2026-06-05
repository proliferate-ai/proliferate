from __future__ import annotations

from contextlib import suppress
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMoveCleanupItemValue,
    all_cleanup_items_completed,
    complete_cloud_workspace_handoff_cleanup_for_user,
    fail_cloud_workspace_handoff_op_for_user,
    get_cleanup_item_for_handoff,
    get_cloud_workspace_handoff_op,
    list_cleanup_items_for_handoff,
    update_cleanup_item_status,
    update_cloud_workspace_handoff_phase_for_user,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mobility.cleanup.domain.ownership import (
    is_desktop_cleanup_item_kind,
)
from proliferate.server.cloud.mobility.cleanup_executor import (
    SERVER_CLEANUP_ITEM_KINDS,
    cleanup_item_execution_rank,
    execute_server_cleanup_item,
)
from proliferate.server.cloud.mobility.domain.lifecycle import (
    CANONICAL_SIDE_DESTINATION,
    HANDOFF_PHASE_CLEANUP_FAILED,
    HANDOFF_PHASE_CLEANUP_PENDING,
    HANDOFF_PHASE_CUTOVER_COMMITTED,
    HANDOFF_PHASE_REPAIR_REQUIRED,
    LIFECYCLE_CLEANUP_FAILED,
    cleanup_retry_delay_seconds,
    visible_failure_last_error,
    visible_failure_status_detail,
)
from proliferate.server.cloud.mobility.service import (
    expire_stale_cloud_workspace_handoffs_for_user,
    get_cloud_workspace_mobility_detail,
)


async def _require_handoff_belongs_to_workspace(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> None:
    handoff = await get_cloud_workspace_handoff_op(
        db,
        user_id=user_id,
        handoff_op_id=handoff_op_id,
    )
    if handoff is None or handoff.mobility_workspace_id != mobility_workspace_id:
        raise CloudApiError("handoff_not_found", "Mobility handoff not found.", status_code=404)


async def complete_cloud_workspace_handoff_cleanup(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    await expire_stale_cloud_workspace_handoffs_for_user(db, user_id=user_id)
    cleanup_items = await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)
    if cleanup_items:
        for item in cleanup_items:
            if item.status == "completed" or item.item_kind in SERVER_CLEANUP_ITEM_KINDS:
                continue
            cleanup_item = await get_cleanup_item_for_handoff(
                db,
                handoff_op_id=handoff_op_id,
                cleanup_item_id=item.id,
                lock=True,
            )
            if cleanup_item is not None:
                await update_cleanup_item_status(
                    db,
                    cleanup_item=cleanup_item,
                    status="completed",
                )
        cleanup_items = await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)
        for item in sorted(
            cleanup_items,
            key=lambda value: cleanup_item_execution_rank(value.item_kind),
        ):
            if item.status == "completed" or item.item_kind not in SERVER_CLEANUP_ITEM_KINDS:
                continue
            await execute_server_cleanup_item(
                db,
                handoff_op_id=handoff_op_id,
                cleanup_item_id=item.id,
            )
        cleanup_items = await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)
        if not all(item.status == "completed" for item in cleanup_items):
            raise CloudApiError(
                "cleanup_items_incomplete",
                "All cleanup items must complete before the handoff can be marked completed.",
                status_code=409,
            )
    try:
        return await complete_cloud_workspace_handoff_cleanup_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    except ValueError as error:
        message = str(error)
        if "not found" in message:
            raise CloudApiError("handoff_not_found", message, status_code=404) from error
        raise CloudApiError("invalid_handoff_phase", message, status_code=409) from error


async def list_cloud_workspace_handoff_cleanup_items(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    return await list_cleanup_items_for_handoff(db, handoff_op_id=handoff_op_id)


async def start_cloud_workspace_handoff_cleanup_item(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
) -> CloudWorkspaceMoveCleanupItemValue:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None:
        raise CloudApiError("cleanup_item_not_found", "Cleanup item not found.", status_code=404)
    if not is_desktop_cleanup_item_kind(item.item_kind):
        raise CloudApiError(
            "cleanup_item_server_owned",
            "This cleanup item is completed by the server.",
            status_code=409,
        )
    return await update_cleanup_item_status(db, cleanup_item=item, status="in_progress")


async def complete_cloud_workspace_handoff_cleanup_item(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
) -> CloudWorkspaceMoveCleanupItemValue:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None:
        raise CloudApiError("cleanup_item_not_found", "Cleanup item not found.", status_code=404)
    if not is_desktop_cleanup_item_kind(item.item_kind):
        raise CloudApiError(
            "cleanup_item_server_owned",
            "This cleanup item is completed by the server.",
            status_code=409,
        )
    value = await update_cleanup_item_status(db, cleanup_item=item, status="completed")
    if await all_cleanup_items_completed(db, handoff_op_id=handoff_op_id):
        with suppress(CloudApiError, ValueError):
            await complete_cloud_workspace_handoff_cleanup(
                db,
                user_id=user_id,
                mobility_workspace_id=mobility_workspace_id,
                handoff_op_id=handoff_op_id,
            )
    return value


async def fail_cloud_workspace_handoff_cleanup_item(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
    error_code: str,
    error_message: str,
) -> CloudWorkspaceMoveCleanupItemValue:
    await get_cloud_workspace_mobility_detail(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    item = await get_cleanup_item_for_handoff(
        db,
        handoff_op_id=handoff_op_id,
        cleanup_item_id=cleanup_item_id,
        lock=True,
    )
    if item is None:
        raise CloudApiError("cleanup_item_not_found", "Cleanup item not found.", status_code=404)
    if not is_desktop_cleanup_item_kind(item.item_kind):
        raise CloudApiError(
            "cleanup_item_server_owned",
            "This cleanup item is completed by the server.",
            status_code=409,
        )
    value = await update_cleanup_item_status(
        db,
        cleanup_item=item,
        status="failed",
        error_code=error_code,
        error_message=error_message,
        retry_delay_seconds=cleanup_retry_delay_seconds(item.attempt_count + 1),
    )
    if value.attempt_count >= max(1, settings.workspace_move_cleanup_max_attempts):
        await fail_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=HANDOFF_PHASE_CLEANUP_FAILED,
            lifecycle_state=LIFECYCLE_CLEANUP_FAILED,
            failure_code=error_code,
            failure_detail=error_message,
            status_detail=visible_failure_status_detail(error_message),
            last_error=visible_failure_last_error(error_message),
        )
    return value


async def repair_cloud_workspace_handoff(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    action: str,
    detail: str | None,
) -> CloudWorkspaceHandoffOpValue:
    if action not in {"resume_cleanup", "mark_complete"}:
        raise CloudApiError(
            "invalid_repair_action",
            "repair action must be 'resume_cleanup' or 'mark_complete'.",
            status_code=400,
        )
    await _require_handoff_belongs_to_workspace(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
    )
    handoff = await get_cloud_workspace_handoff_op(
        db,
        user_id=user_id,
        handoff_op_id=handoff_op_id,
        lock=True,
    )
    if handoff is None or handoff.mobility_workspace_id != mobility_workspace_id:
        raise CloudApiError("handoff_not_found", "Mobility handoff not found.", status_code=404)
    if action == "mark_complete":
        if not await all_cleanup_items_completed(db, handoff_op_id=handoff_op_id):
            raise CloudApiError(
                "cleanup_items_incomplete",
                "Cleanup items must complete before a handoff can be marked complete.",
                status_code=409,
            )
        return await complete_cloud_workspace_handoff_cleanup_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
        )
    if handoff.canonical_side != CANONICAL_SIDE_DESTINATION or handoff.finalized_at is None:
        raise CloudApiError(
            "handoff_not_finalized",
            "Cleanup can only resume after cutover is committed.",
            status_code=409,
        )
    if handoff.phase not in {
        HANDOFF_PHASE_CUTOVER_COMMITTED,
        HANDOFF_PHASE_CLEANUP_PENDING,
        HANDOFF_PHASE_CLEANUP_FAILED,
        HANDOFF_PHASE_REPAIR_REQUIRED,
    }:
        raise CloudApiError(
            "invalid_handoff_phase",
            "Cleanup can only resume from a finalized cleanup phase.",
            status_code=409,
        )
    return await update_cloud_workspace_handoff_phase_for_user(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
        phase=HANDOFF_PHASE_CLEANUP_PENDING,
        status_detail="Awaiting source cleanup",
    )
