from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mobility import CloudWorkspaceMoveCleanupItem
from proliferate.db.store.cloud_mobility.mappers import _cleanup_item_value
from proliferate.db.store.cloud_mobility.records import (
    CloudWorkspaceMoveCleanupItemInput,
    CloudWorkspaceMoveCleanupItemValue,
)
from proliferate.utils.time import utcnow


async def insert_cleanup_items_for_handoff(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    items: list[CloudWorkspaceMoveCleanupItemInput],
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    if not items:
        return []
    now = utcnow()
    existing_rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id)
            .with_for_update()
        )
    ).scalars()
    existing_keys = {
        (
            row.item_kind,
            row.target_id,
            row.anyharness_workspace_id,
            row.object_id,
        )
        for row in existing_rows
    }
    deduped_items = [
        item
        for item in items
        if (
            item.item_kind,
            item.target_id,
            item.anyharness_workspace_id,
            item.object_id,
        )
        not in existing_keys
    ]
    if not deduped_items:
        return []
    records = [
        CloudWorkspaceMoveCleanupItem(
            handoff_op_id=handoff_op_id,
            item_kind=item.item_kind,
            target_id=item.target_id,
            anyharness_workspace_id=item.anyharness_workspace_id,
            object_id=item.object_id,
            status="pending",
            attempt_count=0,
            next_attempt_at=now,
            error_code=None,
            error_message=None,
            started_at=None,
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
        for item in deduped_items
    ]
    db.add_all(records)
    await db.flush()
    return [_cleanup_item_value(record) for record in records]


async def list_cleanup_items_for_handoff(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id)
            .order_by(
                CloudWorkspaceMoveCleanupItem.created_at.asc(),
                CloudWorkspaceMoveCleanupItem.id.asc(),
            )
        )
    ).scalars()
    return [_cleanup_item_value(row) for row in rows]


async def load_due_cleanup_items(
    db: AsyncSession,
    *,
    now: datetime,
    item_kinds: set[str] | frozenset[str],
    limit: int,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    if not item_kinds:
        return []
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.item_kind.in_(item_kinds))
            .where(CloudWorkspaceMoveCleanupItem.status.in_(("pending", "failed")))
            .where(CloudWorkspaceMoveCleanupItem.next_attempt_at <= now)
            .order_by(
                CloudWorkspaceMoveCleanupItem.next_attempt_at.asc(),
                CloudWorkspaceMoveCleanupItem.created_at.asc(),
            )
            .limit(limit)
        )
    ).scalars()
    return [_cleanup_item_value(row) for row in rows]


async def get_cleanup_item_for_handoff(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
    lock: bool = False,
) -> CloudWorkspaceMoveCleanupItem | None:
    query = select(CloudWorkspaceMoveCleanupItem).where(
        CloudWorkspaceMoveCleanupItem.id == cleanup_item_id,
        CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id,
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def update_cleanup_item_status(
    db: AsyncSession,
    *,
    cleanup_item: CloudWorkspaceMoveCleanupItem,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
    retry_delay_seconds: int = 0,
) -> CloudWorkspaceMoveCleanupItemValue:
    now = utcnow()
    cleanup_item.status = status
    cleanup_item.updated_at = now
    if status == "in_progress":
        cleanup_item.started_at = now
    elif status == "completed":
        cleanup_item.completed_at = now
        cleanup_item.error_code = None
        cleanup_item.error_message = None
    elif status == "failed":
        cleanup_item.attempt_count += 1
        cleanup_item.error_code = error_code
        cleanup_item.error_message = error_message
        cleanup_item.next_attempt_at = now + timedelta(seconds=max(0, retry_delay_seconds))
    await db.flush()
    return _cleanup_item_value(cleanup_item)


async def all_cleanup_items_completed(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
) -> bool:
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem.status).where(
                CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id
            )
        )
    ).scalars()
    statuses = list(rows)
    return bool(statuses) and all(status == "completed" for status in statuses)


async def mark_remaining_cleanup_items_completed(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    error_message: str | None = None,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id)
            .where(CloudWorkspaceMoveCleanupItem.status != "completed")
            .with_for_update()
        )
    ).scalars()
    values: list[CloudWorkspaceMoveCleanupItemValue] = []
    now = utcnow()
    for row in rows:
        row.status = "completed"
        row.error_code = "manual_resolution" if error_message else None
        row.error_message = error_message
        row.completed_at = now
        row.updated_at = now
        values.append(_cleanup_item_value(row))
    await db.flush()
    return values
