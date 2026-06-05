from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import RUNTIME_WAKE_QUEUE, RUNTIME_WAKE_TARGET_TASK
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.server.cloud.commands.wake import enqueue_managed_target_wake_outbox


@pytest.mark.asyncio
async def test_enqueue_managed_target_wake_outbox_uses_caller_transaction(
    db_session: AsyncSession,
) -> None:
    target_id = uuid4()
    command_id = uuid4()

    await enqueue_managed_target_wake_outbox(
        db_session,
        target_id=target_id,
        command_id=command_id,
    )
    await db_session.rollback()

    rolled_back = (
        (
            await db_session.execute(
                select(BackgroundOutboxTask).where(
                    BackgroundOutboxTask.task_name == RUNTIME_WAKE_TARGET_TASK
                )
            )
        )
        .scalars()
        .all()
    )
    assert rolled_back == []

    await enqueue_managed_target_wake_outbox(
        db_session,
        target_id=target_id,
        command_id=command_id,
    )
    await db_session.commit()

    persisted = (
        await db_session.execute(
            select(BackgroundOutboxTask).where(
                BackgroundOutboxTask.task_name == RUNTIME_WAKE_TARGET_TASK
            )
        )
    ).scalar_one()
    assert persisted.queue == RUNTIME_WAKE_QUEUE
    assert persisted.kwargs_json == {
        "target_id": str(target_id),
        "command_id": str(command_id),
    }
    assert persisted.idempotency_key == (f"{RUNTIME_WAKE_TARGET_TASK}:{target_id}:{command_id}")
