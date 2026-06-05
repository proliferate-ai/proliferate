"""Notification tasks for the background job substrate."""

from __future__ import annotations

import asyncio

from proliferate.background.celery_app import celery_app
from proliferate.background.config import NOTIFICATIONS_SEND_SLACK_TASK
from proliferate.server.notifications import deliver_slack_notification_task_payload


@celery_app.task(name=NOTIFICATIONS_SEND_SLACK_TASK)
def send_slack(payload: dict[str, object]) -> bool:
    return asyncio.run(deliver_slack_notification_task_payload(payload))
