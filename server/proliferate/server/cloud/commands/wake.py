"""Command wake scheduling helpers."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import RUNTIME_WAKE_QUEUE, RUNTIME_WAKE_TARGET_TASK
from proliferate.db.store.background_outbox import enqueue_outbox_task


async def enqueue_managed_target_wake_outbox(
    db: AsyncSession,
    *,
    target_id: UUID,
    command_id: UUID,
) -> None:
    await enqueue_outbox_task(
        db,
        task_name=RUNTIME_WAKE_TARGET_TASK,
        queue=RUNTIME_WAKE_QUEUE,
        kwargs_json={
            "target_id": str(target_id),
            "command_id": str(command_id),
        },
        idempotency_key=f"{RUNTIME_WAKE_TARGET_TASK}:{target_id}:{command_id}",
    )
