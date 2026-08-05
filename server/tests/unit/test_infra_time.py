from __future__ import annotations

from datetime import UTC, datetime

import pytest

import proliferate.lib.infra.time.elapsed as elapsed
import proliferate.lib.infra.time.wall_clock as wall_clock
from proliferate.db.models.cloud.agent_gateway import AgentApiKey


def test_utcnow_reads_utc_wall_clock_once(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = datetime(2026, 8, 5, 12, 34, 56, 789012, tzinfo=UTC)
    observed_timezones: list[object] = []

    class FakeDateTime:
        @classmethod
        def now(cls, timezone: object) -> datetime:
            observed_timezones.append(timezone)
            return expected

    monkeypatch.setattr(wall_clock, "datetime", FakeDateTime)

    assert wall_clock.utcnow() is expected
    assert observed_timezones == [UTC]


def test_orm_time_defaults_remain_deferred_wall_clock_callables() -> None:
    created_at = AgentApiKey.__table__.c.created_at
    updated_at = AgentApiKey.__table__.c.updated_at

    assert created_at.default is not None
    assert updated_at.default is not None
    assert updated_at.onupdate is not None
    assert getattr(created_at.default.arg, "__wrapped__", None) is wall_clock.utcnow
    assert getattr(updated_at.default.arg, "__wrapped__", None) is wall_clock.utcnow
    assert getattr(updated_at.onupdate.arg, "__wrapped__", None) is wall_clock.utcnow


@pytest.mark.parametrize(
    ("sample", "started_at", "expected"),
    [
        (12.3456, 10.0, 2345),
        (9.9981, 10.0, -1),
    ],
)
def test_duration_ms_samples_once_and_truncates_toward_zero(
    monkeypatch: pytest.MonkeyPatch,
    sample: float,
    started_at: float,
    expected: int,
) -> None:
    samples = iter([sample])
    monkeypatch.setattr(elapsed.time, "perf_counter", lambda: next(samples))

    assert elapsed.duration_ms(started_at) == expected
    with pytest.raises(StopIteration):
        next(samples)
