"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

from celery.schedules import crontab

from proliferate.background.config import CUSTOMERIO_ENGAGEMENT_SYNC_TASK
from proliferate.config import Settings, settings

BeatSchedule = dict[str, dict[str, object]]


def build_beat_schedule(config: Settings = settings) -> BeatSchedule:
    """Return the currently registered Beat schedule."""

    schedule: BeatSchedule = {}

    if config.customerio_site_id and config.customerio_api_key:
        schedule["customerio-engagement-sync"] = {
            "task": CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
            "schedule": crontab(minute="0", hour="9"),
        }

    return schedule
