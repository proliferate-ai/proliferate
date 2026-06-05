"""Support tracker tasks for the background job substrate."""

from __future__ import annotations

import asyncio

from proliferate.background.celery_app import celery_app
from proliferate.background.config import SUPPORT_TRACKER_RECONCILE_PASS_TASK
from proliferate.server.support.tracker import run_support_tracker_reconcile_pass


@celery_app.task(name=SUPPORT_TRACKER_RECONCILE_PASS_TASK)
def reconcile_tracker() -> int:
    return asyncio.run(run_support_tracker_reconcile_pass())
