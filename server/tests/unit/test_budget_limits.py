from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.server.billing.budget_limits import (
    resolve_effective_limit,
    window_bounds,
)


def _limit(*, user_id, kind, window, cap_value, enabled=True):
    return SimpleNamespace(
        user_id=user_id,
        kind=kind,
        window=window,
        cap_value=cap_value,
        enabled=enabled,
    )


def test_window_bounds_day_is_utc_calendar_day() -> None:
    now = datetime(2026, 7, 7, 15, 43, 9, tzinfo=UTC)
    start, end = window_bounds("day", now)
    assert start == datetime(2026, 7, 7, tzinfo=UTC)
    assert end == datetime(2026, 7, 8, tzinfo=UTC)


def test_window_bounds_month_and_year_rollover() -> None:
    start, end = window_bounds("month", datetime(2026, 7, 7, 15, tzinfo=UTC))
    assert start == datetime(2026, 7, 1, tzinfo=UTC)
    assert end == datetime(2026, 8, 1, tzinfo=UTC)

    dec_start, dec_end = window_bounds("month", datetime(2026, 12, 31, 23, tzinfo=UTC))
    assert dec_start == datetime(2026, 12, 1, tzinfo=UTC)
    assert dec_end == datetime(2027, 1, 1, tzinfo=UTC)


def test_window_bounds_coerces_naive_to_utc() -> None:
    start, end = window_bounds("day", datetime(2026, 7, 7, 1, 0, 0))
    assert start == datetime(2026, 7, 7, tzinfo=UTC)
    assert end == datetime(2026, 7, 8, tzinfo=UTC)


def test_window_bounds_rejects_unknown_window() -> None:
    with pytest.raises(ValueError):
        window_bounds("week", datetime(2026, 7, 7, tzinfo=UTC))


def test_resolve_returns_none_when_no_applicable_limit() -> None:
    user_id = uuid4()
    limits = [
        _limit(user_id=None, kind="llm", window="month", cap_value=Decimal("10")),
        _limit(user_id=uuid4(), kind="compute", window="month", cap_value=Decimal("100")),
    ]
    assert resolve_effective_limit(limits, user_id=user_id, kind="compute") is None


def test_resolve_ignores_disabled_and_other_users() -> None:
    user_id = uuid4()
    other = uuid4()
    limits = [
        _limit(user_id=user_id, kind="llm", window="month", cap_value=Decimal("5"), enabled=False),
        _limit(user_id=other, kind="llm", window="month", cap_value=Decimal("3")),
    ]
    assert resolve_effective_limit(limits, user_id=user_id, kind="llm") is None


def test_resolve_org_wide_applies_to_user() -> None:
    user_id = uuid4()
    limits = [_limit(user_id=None, kind="llm", window="month", cap_value=Decimal("20"))]
    effective = resolve_effective_limit(limits, user_id=user_id, kind="llm")
    assert effective is not None
    assert effective.user_id is None
    assert effective.window == "month"
    assert effective.cap_value == 20.0


def test_resolve_per_user_wins_when_tighter() -> None:
    user_id = uuid4()
    limits = [
        _limit(user_id=None, kind="llm", window="month", cap_value=Decimal("20")),
        _limit(user_id=user_id, kind="llm", window="day", cap_value=Decimal("2")),
    ]
    effective = resolve_effective_limit(limits, user_id=user_id, kind="llm")
    assert effective is not None
    assert effective.user_id == user_id
    assert effective.cap_value == 2.0
    assert effective.window == "day"


def test_resolve_org_wide_wins_when_tighter_than_per_user() -> None:
    user_id = uuid4()
    limits = [
        _limit(user_id=None, kind="compute", window="month", cap_value=Decimal("100")),
        _limit(user_id=user_id, kind="compute", window="month", cap_value=Decimal("500")),
    ]
    effective = resolve_effective_limit(limits, user_id=user_id, kind="compute")
    assert effective is not None
    assert effective.user_id is None
    assert effective.cap_value == 100.0


def test_resolve_picks_tightest_among_same_scope() -> None:
    user_id = uuid4()
    limits = [
        _limit(user_id=user_id, kind="llm", window="month", cap_value=Decimal("50")),
        _limit(user_id=user_id, kind="llm", window="day", cap_value=Decimal("4")),
    ]
    effective = resolve_effective_limit(limits, user_id=user_id, kind="llm")
    assert effective is not None
    assert effective.cap_value == 4.0
    assert effective.window == "day"
