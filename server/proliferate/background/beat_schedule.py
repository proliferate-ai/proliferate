"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

from proliferate.config import Settings, settings

BeatSchedule = dict[str, dict[str, object]]


def build_beat_schedule(config: Settings = settings) -> BeatSchedule:
    """Return the currently registered Beat schedule."""

    schedule: BeatSchedule = {}
    return schedule
