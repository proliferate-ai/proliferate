"""Seat-count helpers for Pro billing."""

from __future__ import annotations

from datetime import datetime

from proliferate.constants.billing import PRO_INCLUDED_MANAGED_CLOUD_HOURS_PER_SEAT


def pro_period_grant_source_ref(*, subscription_id: str, period_start_unix: int) -> str:
    return f"stripe:pro-period:{subscription_id}:{period_start_unix}"


def seat_proration_grant_source_ref(
    *,
    subscription_id: str,
    membership_id: str,
    period_start_unix: int,
) -> str:
    return f"stripe:seat-proration:{subscription_id}:{membership_id}:{period_start_unix}"


def seat_adjustment_source_ref(
    *,
    subscription_id: str,
    membership_id: str,
    period_start_unix: int,
    event_unix_microseconds: int,
) -> str:
    return (
        "stripe:seat-adjustment:"
        f"{subscription_id}:{membership_id}:{period_start_unix}:{event_unix_microseconds}"
    )


def initial_seat_reconcile_source_ref(*, subscription_id: str, period_start_unix: int) -> str:
    return f"stripe:initial-reconcile:{subscription_id}:{period_start_unix}"


def prorated_seat_grant_hours(
    *,
    added_seats: int,
    period_start: datetime,
    period_end: datetime,
    effective_at: datetime,
) -> float:
    if added_seats <= 0 or period_end <= period_start:
        return 0.0
    effective = min(max(effective_at, period_start), period_end)
    total_seconds = max((period_end - period_start).total_seconds(), 1.0)
    remaining_seconds = max((period_end - effective).total_seconds(), 0.0)
    prorated_seconds = (
        added_seats
        * PRO_INCLUDED_MANAGED_CLOUD_HOURS_PER_SEAT
        * 3600.0
        * remaining_seconds
        / total_seconds
    )
    return max(int(prorated_seconds), 0) / 3600.0
