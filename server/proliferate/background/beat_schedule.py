"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

from celery.schedules import crontab

from proliferate.background.config import (
    CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
    WORKFLOW_DELIVER_OUTBOX_TASK,
    WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
)
from proliferate.config import Settings, settings
from proliferate.constants.workflows import WORKFLOW_SCHEDULER_DEFAULT_INTERVAL_SECONDS

BeatSchedule = dict[str, dict[str, object]]


def build_beat_schedule(config: Settings = settings) -> BeatSchedule:
    """Return the currently registered Beat schedule."""

    schedule: BeatSchedule = {}

    if config.customerio_site_id and config.customerio_api_key:
        schedule["customerio-engagement-sync"] = {
            "task": CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
            "schedule": crontab(minute="0", hour="9"),
        }

    # WS4a schedule plane (spec §6 WF-6, §10.2). Registered only when the cutover
    # flag is on; while off, the legacy scheduler loop owns firing. Both tasks run
    # on the same cadence the loop uses so the transition is behavior-preserving.
    # WS4c flips this default and deletes the loop.
    if config.workflows_beat_schedules:
        schedule["workflow-fire-due-schedules"] = {
            "task": WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
            "schedule": WORKFLOW_SCHEDULER_DEFAULT_INTERVAL_SECONDS,
        }
        schedule["workflow-deliver-outbox"] = {
            "task": WORKFLOW_DELIVER_OUTBOX_TASK,
            "schedule": WORKFLOW_SCHEDULER_DEFAULT_INTERVAL_SECONDS,
        }

    return schedule
