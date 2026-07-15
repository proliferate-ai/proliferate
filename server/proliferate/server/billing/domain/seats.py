"""Pure Pro billing seat and grant calculations."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from proliferate.constants.billing import PRO_LLM_ALLOCATION_USD_PER_SEAT


def pro_llm_pool_usd(seat_quantity: int | None) -> Decimal:
    """Shared org managed-LLM pool for ``seat_quantity`` billed seats.

    $5 per active billed seat, allocated into the org's shared LLM pool each
    paid period (a 3-seat org gets $15). Pure: the caller wires the returned
    dollar amount into the LLM credit ledger and handles per-period reset.
    """
    return max(seat_quantity or 1, 1) * PRO_LLM_ALLOCATION_USD_PER_SEAT


def pro_llm_pool_grant_source_ref(*, subscription_id: str, period_start_unix: int) -> str:
    return f"stripe:pro-llm-pool:{subscription_id}:{period_start_unix}"


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


def pro_period_grant_hours(*, seat_quantity: int | None, hours_per_seat: float) -> float:
    """Included compute-hours for ``seat_quantity`` seats.

    ``hours_per_seat`` is the derived $15/seat compute allocation converted to
    sandbox-hours at the current compute price (see
    ``billing.pricing.compute_hours_per_seat``). Passed in so this stays a pure
    function testable without settings.
    """
    return max(seat_quantity or 1, 1) * hours_per_seat


def prorated_seat_grant_hours(
    *,
    added_seats: int,
    period_start: datetime,
    period_end: datetime,
    effective_at: datetime,
    hours_per_seat: float,
) -> float:
    if added_seats <= 0 or period_end <= period_start:
        return 0.0
    effective = min(max(effective_at, period_start), period_end)
    total_seconds = max((period_end - period_start).total_seconds(), 1.0)
    remaining_seconds = max((period_end - effective).total_seconds(), 0.0)
    prorated_seconds = (
        added_seats * hours_per_seat * 3600.0 * remaining_seconds / total_seconds
    )
    return max(int(prorated_seconds), 0) / 3600.0
