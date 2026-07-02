"""Pure-logic tests for the LiteLLM usage importer (window + timestamp math)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from proliferate.integrations.litellm import LiteLLMSpendLogEntry
from proliferate.server.cloud.agent_gateway.usage_import import (
    _overlap_window_start,
    _parse_occurred_at,
)


class TestOverlapWindowStart:
    def test_subtracts_overlap_from_last_seen(self) -> None:
        last_seen = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
        now = datetime(2026, 7, 1, 12, 30, tzinfo=UTC)
        start = _overlap_window_start(last_seen, overlap_seconds=300.0, now=now)
        assert start == last_seen - timedelta(seconds=300)

    def test_first_tick_looks_back_one_window_from_now(self) -> None:
        now = datetime(2026, 7, 1, 12, 30, tzinfo=UTC)
        start = _overlap_window_start(None, overlap_seconds=300.0, now=now)
        assert start == now - timedelta(seconds=300)

    def test_window_start_never_exceeds_now(self) -> None:
        # A cursor far in the future (clock skew) still yields a start <= now.
        last_seen = datetime(2026, 7, 2, 12, 0, tzinfo=UTC)
        now = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
        start = _overlap_window_start(last_seen, overlap_seconds=0.0, now=now)
        assert start == now

    def test_negative_overlap_clamped_to_zero(self) -> None:
        last_seen = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
        now = datetime(2026, 7, 1, 12, 30, tzinfo=UTC)
        start = _overlap_window_start(last_seen, overlap_seconds=-10.0, now=now)
        assert start == last_seen


def _entry(**kwargs: object) -> LiteLLMSpendLogEntry:
    base: dict[str, object] = {"request_id": "req-1"}
    base.update(kwargs)
    return LiteLLMSpendLogEntry.model_validate(base)


class TestParseOccurredAt:
    def test_prefers_end_time(self) -> None:
        entry = _entry(startTime="2026-07-01T12:00:00Z", endTime="2026-07-01T12:00:05Z")
        assert _parse_occurred_at(entry) == datetime(2026, 7, 1, 12, 0, 5, tzinfo=UTC)

    def test_falls_back_to_start_time(self) -> None:
        entry = _entry(startTime="2026-07-01T12:00:00+00:00")
        assert _parse_occurred_at(entry) == datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC)

    def test_naive_timestamp_is_coerced_to_utc(self) -> None:
        entry = _entry(endTime="2026-07-01T12:00:05")
        parsed = _parse_occurred_at(entry)
        assert parsed is not None
        assert parsed.tzinfo is UTC

    def test_missing_and_invalid_timestamps_return_none(self) -> None:
        assert _parse_occurred_at(_entry()) is None
        assert _parse_occurred_at(_entry(endTime="not-a-date")) is None


class TestRemainingCreditMath:
    """The ledger math itself lives in the credits store; this pins the
    Decimal-exact expectations the importer relies on for exhaustion."""

    def test_remaining_is_grants_minus_usage_exact(self) -> None:
        granted = Decimal("5.0000")
        used = Decimal("4.99999999")
        remaining = granted - used
        assert remaining == Decimal("0.00000001")
        assert remaining > Decimal("0")

    def test_overspend_yields_negative_remaining(self) -> None:
        granted = Decimal("0.0010")
        used = Decimal("0.00234500")
        assert granted - used < Decimal("0")
