"""Automation schedule parsing and occurrence calculations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import DAILY, HOURLY, rrule, rruleset, rrulestr

SCHEDULE_ANCHOR_YEAR = 2020
SUPPORTED_FREQS = {HOURLY, DAILY}
SUPPORTED_RRULE_KEYS = {"FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE"}
WEEKDAY_LABELS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class AutomationScheduleError(ValueError):
    """Raised when an automation schedule is invalid."""


@dataclass(frozen=True)
class ParsedAutomationSchedule:
    rrule_text: str
    timezone: str
    summary: str
    next_run_at: datetime


def _timezone(value: str) -> ZoneInfo:
    timezone = value.strip()
    if not timezone:
        raise AutomationScheduleError("Schedule timezone is required.")
    try:
        return ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise AutomationScheduleError(f"Unknown schedule timezone '{timezone}'.") from exc


def _reject_unsupported_raw_features(rrule_text: str) -> str:
    normalized = rrule_text.strip()
    if not normalized:
        raise AutomationScheduleError("Schedule RRULE is required.")
    upper_lines = [line.strip().upper() for line in normalized.splitlines() if line.strip()]
    if len(upper_lines) != 1:
        raise AutomationScheduleError("Schedules must contain exactly one RRULE.")
    line = upper_lines[0]
    if line.startswith("RRULE:"):
        line = line.removeprefix("RRULE:")
    parts = [part.strip() for part in line.split(";") if part.strip()]
    if not parts:
        raise AutomationScheduleError("Schedule RRULE is required.")
    keys = {part.split("=", 1)[0] for part in parts if "=" in part}
    if len(keys) != len(parts) or not keys.issubset(SUPPORTED_RRULE_KEYS):
        raise AutomationScheduleError("Schedule RRULE contains an unsupported v1 option.")
    return f"RRULE:{';'.join(parts)}"


def _parse_rule(rrule_text: str, timezone: ZoneInfo) -> rrule:
    dtstart = datetime(SCHEDULE_ANCHOR_YEAR, 1, 1, tzinfo=timezone)
    try:
        parsed = rrulestr(rrule_text, dtstart=dtstart)
    except (TypeError, ValueError) as exc:
        raise AutomationScheduleError("Schedule RRULE is invalid.") from exc
    if isinstance(parsed, rruleset):
        raise AutomationScheduleError("Composite schedules are not supported in v1.")
    if not isinstance(parsed, rrule):
        raise AutomationScheduleError("Schedule RRULE is invalid.")
    if parsed._freq not in SUPPORTED_FREQS:  # noqa: SLF001
        raise AutomationScheduleError("Only hourly and daily schedules are supported in v1.")
    if parsed._interval is None or parsed._interval < 1:  # noqa: SLF001
        raise AutomationScheduleError("Schedule interval must be at least 1.")
    if parsed._count is not None or parsed._until is not None:  # noqa: SLF001
        raise AutomationScheduleError("Finite schedules are not supported in v1.")
    if parsed._bysecond not in (None, (0,)):  # noqa: SLF001
        raise AutomationScheduleError("BYSECOND is not supported in v1.")
    if parsed._freq == HOURLY and (  # noqa: SLF001
        parsed._byhour is not None or parsed._byweekday is not None  # noqa: SLF001
    ):
        raise AutomationScheduleError("Hourly schedules cannot constrain BYHOUR or BYDAY in v1.")
    return parsed


def _summarize_rule(rule: rrule, timezone: str) -> str:
    try:
        rule_freq = rule._freq  # noqa: SLF001
        interval = rule._interval  # noqa: SLF001
        hours = tuple(rule._byhour or ())  # noqa: SLF001
        minutes = tuple(rule._byminute or ())  # noqa: SLF001
        weekdays = tuple(rule._byweekday or ())  # noqa: SLF001
    except AttributeError:
        return f"Schedule in {timezone}"
    freq = "Hourly" if rule_freq == HOURLY else "Daily"
    suffix = f" in {timezone}"
    if interval and interval > 1:
        freq = f"Every {interval} {'hours' if rule_freq == HOURLY else 'days'}"
    if rule_freq == DAILY and interval == 1:
        if weekdays == (0, 1, 2, 3, 4):
            freq = "Weekdays"
        elif weekdays == (5, 6):
            freq = "Weekends"
        elif weekdays:
            freq = ", ".join(WEEKDAY_LABELS[weekday] for weekday in weekdays)
    if rule_freq == DAILY and len(hours) == 1 and len(minutes) == 1:
        return f"{freq} at {hours[0]:02d}:{minutes[0]:02d}{suffix}"
    if rule_freq == HOURLY and len(minutes) == 1:
        return f"{freq} at :{minutes[0]:02d}{suffix}"
    return f"{freq}{suffix}"


def _previous_occurrence(rule: rrule, *, now: datetime, timezone: ZoneInfo) -> datetime | None:
    local_now = now.astimezone(timezone)
    occurrence = rule.before(local_now, inc=True)
    return None if occurrence is None else occurrence.astimezone(UTC)


def _next_occurrence(rule: rrule, *, now: datetime, timezone: ZoneInfo) -> datetime:
    local_now = now.astimezone(timezone)
    occurrence = rule.after(local_now, inc=False)
    if occurrence is None:
        raise AutomationScheduleError("Schedule has no future occurrence.")
    return occurrence.astimezone(UTC)


def normalize_schedule(
    *,
    rrule_text: str,
    timezone: str,
    now: datetime,
) -> ParsedAutomationSchedule:
    zone = _timezone(timezone)
    normalized_rrule = _reject_unsupported_raw_features(rrule_text)
    rule = _parse_rule(normalized_rrule, zone)
    next_run_at = _next_occurrence(rule, now=now, timezone=zone)
    return ParsedAutomationSchedule(
        rrule_text=normalized_rrule,
        timezone=timezone.strip(),
        summary=_summarize_rule(rule, timezone.strip()),
        next_run_at=next_run_at,
    )


def latest_due_occurrence(
    *,
    rrule_text: str,
    timezone: str,
    now: datetime,
) -> datetime | None:
    zone = _timezone(timezone)
    normalized_rrule = _reject_unsupported_raw_features(rrule_text)
    rule = _parse_rule(normalized_rrule, zone)
    return _previous_occurrence(rule, now=now, timezone=zone)


def next_future_occurrence(
    *,
    rrule_text: str,
    timezone: str,
    now: datetime,
) -> datetime:
    zone = _timezone(timezone)
    normalized_rrule = _reject_unsupported_raw_features(rrule_text)
    rule = _parse_rule(normalized_rrule, zone)
    return _next_occurrence(rule, now=now, timezone=zone)


def due_and_next_occurrences(
    *,
    rrule_text: str,
    timezone: str,
    now: datetime,
) -> tuple[datetime | None, datetime]:
    zone = _timezone(timezone)
    normalized_rrule = _reject_unsupported_raw_features(rrule_text)
    rule = _parse_rule(normalized_rrule, zone)
    return (
        _previous_occurrence(rule, now=now, timezone=zone),
        _next_occurrence(rule, now=now, timezone=zone),
    )
