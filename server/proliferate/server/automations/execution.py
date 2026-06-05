"""Automation execution dispatch helpers."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import (
    AUTOMATIONS_EXECUTE_RUN_TASK,
    AUTOMATIONS_EXECUTION_QUEUE,
)
from proliferate.db.store.background_outbox import enqueue_outbox_task


async def enqueue_cloud_run_execution_outbox(
    db: AsyncSession,
    *,
    run_id: UUID,
) -> None:
    await enqueue_outbox_task(
        db,
        task_name=AUTOMATIONS_EXECUTE_RUN_TASK,
        queue=AUTOMATIONS_EXECUTION_QUEUE,
        kwargs_json={"run_id": str(run_id)},
        idempotency_key=f"{AUTOMATIONS_EXECUTE_RUN_TASK}:{run_id}",
    )
