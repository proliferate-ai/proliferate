"""Workflow schedule occurrence enumeration and missed-run partition (spec §10.2).

Pure, DB-free logic shared by the Beat fire task and the legacy scheduler loop's
firing half. It owns the two schedule-plane decisions the spec fixes exactly:

**DST.** RRULEs are interpreted in the trigger's stored IANA timezone and
occurrence identities are stored in UTC. A *nonexistent* spring-forward wall time
(e.g. 02:30 on a US spring-forward day) is **skipped** entirely — it never fires
and is never recorded. An *ambiguous* fall-back wall time (e.g. 01:30 on a
fall-back day) **fires once at the earlier offset** (the pre-transition instant).

The automations schedule domain (``server/automations/domain/schedule.py``)
resolves a nonexistent wall time by shifting it forward instead of skipping it;
that is the wrong behavior for the workflow contract, so workflow scheduling owns
this enumeration rather than reusing that helper. Fall-back is already
once-at-earlier-offset there, and dateutil produces the same fold=0 instant here.

**Missed-run policy.** When the worker was down, every occurrence in the window
``(cursor, now]`` is enumerated oldest-first and partitioned per the trigger's
missed-run policy: ``run_latest`` fires the newest and records the rest missed,
``skip_all`` records every slot missed, ``replay_all`` fires every slot in order.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrule, rrulestr

from proliferate.constants.automations import AUTOMATION_SCHEDULE_ANCHOR_YEAR
from proliferate.constants.workflows import (
    WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
)
from proliferate.server.automations.domain.schedule import AutomationScheduleError

# Bounded scan for the next future occurrence so a schedule that only ever lands
# on nonexistent wall times (pathological, effectively impossible for v1's
# hourly/daily vocabulary) cannot spin forever.
_MAX_FUTURE_PROBE = 1000


@dataclass(frozen=True)
class SchedulePartition:
    """The result of enumerating a due window and applying the missed-run policy.

    ``fire_slots`` and ``missed_slots`` are UTC occurrence identities, ascending
    (oldest first). ``next_run_at`` is the next future occurrence after ``now``
    used to advance the cursor when the whole window is durably represented.
    """

    fire_slots: list[datetime]
    missed_slots: list[datetime]
    next_run_at: datetime


def _zone(timezone: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:  # pragma: no cover - stored tz is validated
        raise AutomationScheduleError(f"Unknown schedule timezone '{timezone}'.") from exc


def _build_rule(rrule_text: str, zone: ZoneInfo) -> rrule:
    dtstart = datetime(AUTOMATION_SCHEDULE_ANCHOR_YEAR, 1, 1, tzinfo=zone)
    try:
        parsed = rrulestr(rrule_text, dtstart=dtstart)
    except (TypeError, ValueError) as exc:
        raise AutomationScheduleError("Schedule RRULE is invalid.") from exc
    if not isinstance(parsed, rrule):
        # rruleset (composite) is rejected at trigger creation; guard anyway.
        raise AutomationScheduleError("Composite schedules are not supported.")
    return parsed


def _is_nonexistent_wall_time(local_dt: datetime) -> bool:
    """True when ``local_dt`` falls in a spring-forward gap (an imaginary wall
    time). Such a time does not round-trip through UTC: converting to UTC and back
    yields a different wall clock (the gap is skipped forward)."""

    return local_dt.astimezone(UTC).astimezone(local_dt.tzinfo) != local_dt


def _next_future_occurrence(rule: rrule, local_now: datetime, zone: ZoneInfo) -> datetime:
    """The next real occurrence strictly after ``local_now``, skipping nonexistent
    spring-forward wall times so the cursor never parks on an imaginary slot."""

    cursor = local_now
    for _ in range(_MAX_FUTURE_PROBE):
        occurrence = rule.after(cursor, inc=False)
        if occurrence is None:
            raise AutomationScheduleError("Schedule has no future occurrence.")
        if not _is_nonexistent_wall_time(occurrence):
            return occurrence.astimezone(UTC)
        cursor = occurrence
    raise AutomationScheduleError("Schedule has no real future occurrence.")


def due_schedule_occurrences(
    *, rrule_text: str, timezone: str, since: datetime, now: datetime
) -> tuple[list[datetime], datetime]:
    """Every real occurrence in the missed window ``[since, now]`` (ascending, UTC)
    with nonexistent spring-forward wall times skipped, plus the next future
    occurrence (> now). The list is empty when ``since`` is itself in the future.
    """

    zone = _zone(timezone)
    rule = _build_rule(rrule_text, zone)
    local_since = since.astimezone(zone)
    local_now = now.astimezone(zone)
    occurrences: list[datetime] = []
    for occurrence in rule.between(local_since, local_now, inc=True):
        if _is_nonexistent_wall_time(occurrence):
            # Nonexistent spring-DST wall time: skipped entirely (§10.2).
            continue
        occurrences.append(occurrence.astimezone(UTC))
    next_run_at = _next_future_occurrence(rule, local_now, zone)
    return occurrences, next_run_at


def partition_missed_run_window(
    *, occurrences: list[datetime], missed_run_policy: str, next_run_at: datetime
) -> SchedulePartition:
    """Split an ascending occurrence window into fire vs missed slots per policy.

    Missed occurrences are enumerated oldest-first (§10.2):
      - ``skip_all``:  fire nothing; record every slot missed.
      - ``replay_all``: fire every slot in order; record none missed.
      - ``run_latest`` (default): fire the newest; record every older slot missed.
    """

    if missed_run_policy == WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL:
        return SchedulePartition(
            fire_slots=[], missed_slots=list(occurrences), next_run_at=next_run_at
        )
    if missed_run_policy == WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL:
        return SchedulePartition(
            fire_slots=list(occurrences), missed_slots=[], next_run_at=next_run_at
        )
    # run_latest (default): the newest fires; every older slot is recorded missed.
    return SchedulePartition(
        fire_slots=[occurrences[-1]],
        missed_slots=list(occurrences[:-1]),
        next_run_at=next_run_at,
    )
