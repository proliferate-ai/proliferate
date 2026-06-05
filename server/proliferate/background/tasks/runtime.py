"""Runtime control tasks for the background job substrate."""

from __future__ import annotations

import asyncio
from uuid import UUID

from proliferate.background.celery_app import celery_app
from proliferate.background.config import RUNTIME_WAKE_TARGET_TASK
from proliferate.server.cloud.runtime.wake import run_managed_target_wake_job


@celery_app.task(name=RUNTIME_WAKE_TARGET_TASK)
def wake_target(*, target_id: str, command_id: str | None = None) -> None:
    parsed_command_id = UUID(command_id) if command_id else None
    asyncio.run(
        run_managed_target_wake_job(
            UUID(target_id),
            command_id=parsed_command_id,
        )
    )
