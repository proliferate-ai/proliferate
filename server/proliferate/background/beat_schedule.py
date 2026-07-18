"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

from celery.schedules import crontab

from proliferate.background.config import (
    BACKGROUND_RELAY_TASK,
    CLOUD_SANDBOX_ORPHAN_REAP_TASK,
    CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
)
from proliferate.config import Settings, settings

BeatSchedule = dict[str, dict[str, object]]

# Stable key for the single outbox-drain entry. Exactly one such entry exists so
# a lone Beat process owns outbox relay scheduling; RedBeat preserves this entry
# across restarts and prevents duplicate schedule ownership.
RELAY_SCHEDULE_ENTRY = "background-outbox-relay"


def build_beat_schedule(config: Settings = settings) -> BeatSchedule:
    """Return the currently registered Beat schedule.

    Always contains exactly one relay entry that fires the thin
    ``background.relay`` task. Each firing runs one bounded ``relay_once`` batch
    and exits; the schedule never carries a second outbox-drain entry.
    """

    schedule: BeatSchedule = {
        RELAY_SCHEDULE_ENTRY: {
            "task": BACKGROUND_RELAY_TASK,
            "schedule": config.background_relay_interval_seconds,
        },
    }

    if config.customerio_site_id and config.customerio_api_key:
        schedule["customerio-engagement-sync"] = {
            "task": CUSTOMERIO_ENGAGEMENT_SYNC_TASK,
            "schedule": crontab(minute="0", hour="9"),
        }

    if config.cloud_provisioning_configured:
        schedule["cloud-sandbox-orphan-reap"] = {
            "task": CLOUD_SANDBOX_ORPHAN_REAP_TASK,
            "schedule": crontab(minute="*/5"),
        }

    return schedule
