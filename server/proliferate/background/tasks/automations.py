"""Automation execution tasks for the background job substrate."""

from __future__ import annotations

import asyncio
from uuid import UUID

from celery import Task

from proliferate.background.celery_app import celery_app
from proliferate.background.config import AUTOMATIONS_EXECUTE_RUN_TASK
from proliferate.server.automations.worker.cloud_executor import (
    CloudAutomationRunBusy,
    execute_cloud_automation_run,
)


@celery_app.task(name=AUTOMATIONS_EXECUTE_RUN_TASK, bind=True)
def execute_run(self: Task, *, run_id: str) -> bool:
    try:
        return asyncio.run(execute_cloud_automation_run(UUID(run_id)))
    except CloudAutomationRunBusy as exc:
        raise self.retry(countdown=exc.retry_after_seconds) from exc
