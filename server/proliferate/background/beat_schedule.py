"""Beat schedule registry for the background job substrate."""

from __future__ import annotations

BeatSchedule = dict[str, dict[str, object]]


def build_beat_schedule() -> BeatSchedule:
    """Return the currently registered Beat schedule.

    Slice 1 intentionally does not move any periodic business work. Later
    slices add entries here when reconcilers or schedulers move to Beat.
    """

    return {}
