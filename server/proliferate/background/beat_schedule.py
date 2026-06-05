"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

from proliferate.background.config import (
    PERIODIC_DEFAULT_QUEUE,
    SUPPORT_TRACKER_RECONCILE_PASS_TASK,
)
from proliferate.config import Settings, settings

BeatSchedule = dict[str, dict[str, object]]


def build_beat_schedule(config: Settings = settings) -> BeatSchedule:
    """Return the currently registered Beat schedule."""

    schedule: BeatSchedule = {}
    if config.support_tracker_enabled:
        schedule["support-tracker-reconcile"] = {
            "task": SUPPORT_TRACKER_RECONCILE_PASS_TASK,
            "schedule": max(config.support_tracker_reconciler_interval_seconds, 1.0),
            "options": {"queue": PERIODIC_DEFAULT_QUEUE},
        }
    return schedule
