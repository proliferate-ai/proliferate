"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

from celery.schedules import crontab

from proliferate.background.config import (
    CLOUD_SANDBOX_ORPHAN_REAP_TASK,
    CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
)
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

    # Gate the orphan reap on cloud provisioning being configured: with no E2B,
    # the pass's list_sandbox_states raises, so the task must never be scheduled
    # (this preserves the no-E2B → no-reaper guard at the schedule level).
    if config.cloud_provisioning_configured:
        schedule["cloud-sandbox-orphan-reap"] = {
            "task": CLOUD_SANDBOX_ORPHAN_REAP_TASK,
            "schedule": crontab(minute="*/5"),
        }

    return schedule
