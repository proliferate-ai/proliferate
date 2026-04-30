from datetime import UTC, datetime

import pytest

from proliferate.server.automations.schedule import (
    AutomationScheduleError,
    latest_due_occurrence,
    next_future_occurrence,
    normalize_schedule,
)


def test_normalize_daily_schedule_computes_next_run_in_timezone() -> None:
    parsed = normalize_schedule(
        rrule_text="RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=30",
        timezone="America/Los_Angeles",
        now=datetime(2026, 4, 20, 16, 0, tzinfo=UTC),
    )

    assert parsed.rrule_text == "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=30"
    assert parsed.summary == "Daily at 09:30 in America/Los_Angeles"
    assert parsed.next_run_at == datetime(2026, 4, 20, 16, 30, tzinfo=UTC)


def test_hourly_schedule_uses_latest_due_slot_after_downtime() -> None:
    due = latest_due_occurrence(
        rrule_text="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
        timezone="UTC",
        now=datetime(2026, 4, 20, 12, 43, tzinfo=UTC),
    )
    next_run = next_future_occurrence(
        rrule_text="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
        timezone="UTC",
        now=datetime(2026, 4, 20, 12, 43, tzinfo=UTC),
    )

    assert due == datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    assert next_run == datetime(2026, 4, 20, 13, 0, tzinfo=UTC)


def test_hourly_schedule_includes_current_boundary_as_due_slot() -> None:
    due = latest_due_occurrence(
        rrule_text="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
        timezone="UTC",
        now=datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )

    assert due == datetime(2026, 4, 20, 12, 0, tzinfo=UTC)


def test_interval_summary_handles_multi_day_schedule() -> None:
    parsed = normalize_schedule(
        rrule_text="RRULE:FREQ=DAILY;INTERVAL=3;BYHOUR=9;BYMINUTE=0",
        timezone="UTC",
        now=datetime(2026, 4, 20, 8, 0, tzinfo=UTC),
    )

    assert parsed.summary == "Every 3 days at 09:00 in UTC"


def test_summary_names_custom_weekday_schedule() -> None:
    parsed = normalize_schedule(
        rrule_text="RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=9;BYMINUTE=0",
        timezone="UTC",
        now=datetime(2026, 4, 20, 8, 0, tzinfo=UTC),
    )

    assert parsed.summary == "Mon, Wed at 09:00 in UTC"


def test_weekday_schedule_summary_names_weekdays() -> None:
    parsed = normalize_schedule(
        rrule_text="RRULE:FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
        timezone="America/Los_Angeles",
        now=datetime(2026, 4, 20, 16, 0, tzinfo=UTC),
    )

    assert parsed.summary == "Weekdays at 09:00 in America/Los_Angeles"


@pytest.mark.parametrize(
    "rrule_text",
    [
        "DTSTART:20260420T090000Z\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        "RRULE:FREQ=MINUTELY;INTERVAL=15",
        "RRULE:FREQ=DAILY;COUNT=3",
        "RRULE:FREQ=DAILY;UNTIL=20260430T000000Z",
        "RRULE:FREQ=DAILY;BYSECOND=30",
        "RRULE:FREQ=HOURLY;INTERVAL=0;BYMINUTE=0",
        "RRULE:FREQ=HOURLY;BYHOUR=9;BYMINUTE=0",
        "RRULE:FREQ=HOURLY;BYDAY=MO;BYMINUTE=0",
        "RRULE:FREQ=DAILY;BYMONTH=1;BYHOUR=9;BYMINUTE=0",
    ],
)
def test_rejects_unsupported_rrule_features(rrule_text: str) -> None:
    with pytest.raises(AutomationScheduleError):
        normalize_schedule(
            rrule_text=rrule_text,
            timezone="UTC",
            now=datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
        )


def test_rejects_unknown_timezone() -> None:
    with pytest.raises(AutomationScheduleError):
        normalize_schedule(
            rrule_text="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            timezone="Mars/Base",
            now=datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
        )
