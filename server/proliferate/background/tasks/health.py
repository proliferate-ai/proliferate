"""Health tasks for the background job substrate."""

from __future__ import annotations

from proliferate.background.celery_app import celery_app
from proliferate.background.config import HEALTH_NOOP_TASK


@celery_app.task(name=HEALTH_NOOP_TASK)
def noop() -> str:
    return "ok"
