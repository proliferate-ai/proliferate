"""Focused unit tests for the ruled billing-truth values (PR 4).

Each test pins one product change from the frozen billing-truth table
(``Run Tier 2 Strictly and Make Billing Truth Authoritative``, Frozen
2026-07-15; values RULED 2026-07-14). Offline/deterministic: pure helpers plus
``settings`` monkeypatching, no DB or network.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from proliferate.config import settings
from proliferate.server.billing.domain.accounting import overage_seconds_to_cents
from proliferate.server.billing.domain.seats import (
    pro_llm_pool_usd,
    pro_period_grant_hours,
    prorated_seat_grant_hours,
)
from proliferate.server.billing.policy import free_v2_policy, pro_policy
from proliferate.server.billing.pricing import (
    compute_hours_per_seat,
    compute_price_per_hour_cents,
    compute_price_per_hour_usd,
)
from proliferate.server.cloud.agent_gateway.free_credits import free_credit_amount_usd
from proliferate.server.cloud.agent_gateway.topups import (
    AUTO_TOPUP_ADMIN_ALERT_MARKER,
    LlmTopupRunResult,
    _record_topup_admin_alert_intent,
)
from proliferate.server.cloud.agent_gateway.usage_import import (
    apply_llm_margin,
    llm_margin_multiplier,
)


# --- A1: free lifetime managed-LLM grant is $2 -----------------------------


def test_a1_free_credit_default_is_two_dollars(monkeypatch: pytest.MonkeyPatch) -> None:
    # The shipped default (config.py) must be $2, not the stale $5.
    assert Settings_default("agent_gateway_free_credit_usd") == "2"
    assert free_credit_amount_usd() == Decimal("2")


def test_a1_free_credit_non_positive_disables_grant(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0")
    assert free_credit_amount_usd() == Decimal("0")
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "not-a-number")
    assert free_credit_amount_usd() == Decimal("0")


# --- A2: $5/seat managed-LLM shared org pool -------------------------------


def test_a2_pro_llm_pool_is_five_per_seat() -> None:
    assert pro_llm_pool_usd(1) == Decimal("5")
    assert pro_llm_pool_usd(3) == Decimal("15")
    # A null/zero seat count floors at one seat (never a zero/negative pool).
    assert pro_llm_pool_usd(None) == Decimal("5")
    assert pro_llm_pool_usd(0) == Decimal("5")


# --- A3/A4: $15/seat compute derived from E2B list x margin ----------------


def test_a4_compute_price_is_list_times_multiplier(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "e2b_list_price_usd_per_hour", "2.00")
    monkeypatch.setattr(settings, "pro_compute_margin_multiplier", 1.5)
    assert compute_price_per_hour_usd() == Decimal("3.00")
    assert compute_price_per_hour_cents() == 300
    # The multiplier (not a fixed dollar rate) is the constant: changing the
    # provider list price moves the derived rate.
    monkeypatch.setattr(settings, "e2b_list_price_usd_per_hour", "4.00")
    assert compute_price_per_hour_cents() == 600


def test_a4_compute_margin_stays_positive_above_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "e2b_list_price_usd_per_hour", "2.00")
    monkeypatch.setattr(settings, "pro_compute_margin_multiplier", 1.5)
    # Derived rate ($3.00) strictly exceeds provider list ($2.00) => margin > 0.
    assert compute_price_per_hour_usd() > Decimal("2.00")


def test_a3_compute_hours_per_seat_derived_from_fifteen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "e2b_list_price_usd_per_hour", "2.00")
    monkeypatch.setattr(settings, "pro_compute_margin_multiplier", 1.5)
    # $15 allocation / $3.00 per hour = 5 hours per seat.
    assert compute_hours_per_seat() == pytest.approx(5.0)


def test_a3_pro_period_grant_scales_hours_by_seats() -> None:
    # Pure: hours = seats * hours_per_seat (derivation passed in).
    assert pro_period_grant_hours(seat_quantity=3, hours_per_seat=5.0) == pytest.approx(15.0)
    assert pro_period_grant_hours(seat_quantity=None, hours_per_seat=5.0) == pytest.approx(5.0)


def test_a3_prorated_seat_grant_is_proportional() -> None:
    period_start = datetime(2026, 6, 1, tzinfo=UTC)
    period_end = period_start + timedelta(days=30)
    # Add one seat exactly halfway through the period => ~half the seat's hours.
    halfway = period_start + timedelta(days=15)
    hours = prorated_seat_grant_hours(
        added_seats=1,
        period_start=period_start,
        period_end=period_end,
        effective_at=halfway,
        hours_per_seat=10.0,
    )
    assert hours == pytest.approx(5.0, abs=0.05)


def test_a3_compute_hours_zero_when_unpriced(monkeypatch: pytest.MonkeyPatch) -> None:
    # A misconfigured (zero) compute price is fail-safe: no free hours, no
    # divide-by-zero.
    monkeypatch.setattr(settings, "e2b_list_price_usd_per_hour", "0")
    assert compute_hours_per_seat() == 0.0
    assert compute_price_per_hour_cents() == 0


# --- A5: overage rounds UP whole cents per closed segment, no carry ---------


def test_a5_overage_rounds_up_per_segment() -> None:
    # 1.2c of raw overage exports 2c (ceil), not 1c (floor).
    # rate 300c/hr => a segment of 14.4s = 300*14.4/3600 = 1.2c -> ceil = 2.
    assert overage_seconds_to_cents(14.4, rate_cents_per_hour=300) == 2
    # A whole hour is exact (no rounding surprise).
    assert overage_seconds_to_cents(3600, rate_cents_per_hour=300) == 300


def test_a5_segments_round_independently_no_cross_carry() -> None:
    # Two 1.2c segments each ceil to 2c independently => 4c total. A carried
    # fractional remainder would instead give 3c (2.4c -> 3), which the ruling
    # forbids: the segment is the rounding unit.
    seg = overage_seconds_to_cents(14.4, rate_cents_per_hour=300)
    assert seg + seg == 4


def test_a5_zero_and_negative_seconds_are_zero() -> None:
    assert overage_seconds_to_cents(0.0, rate_cents_per_hour=300) == 0
    assert overage_seconds_to_cents(-5.0, rate_cents_per_hour=300) == 0


# --- A6: flat $50/org/month overage cap ------------------------------------


def test_a6_default_overage_cap_is_flat_fifty_per_org(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    # Default cap is a flat $50/org, NOT scaled by seat count.
    one_seat = pro_policy(billable_seat_count=1, overage_cap_cents_per_seat=None)
    five_seat = pro_policy(billable_seat_count=5, overage_cap_cents_per_seat=None)
    assert one_seat.managed_cloud_overage_cap_cents == 5000
    assert five_seat.managed_cloud_overage_cap_cents == 5000


def test_a6_override_is_org_level_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    # A per-subject override is used as the org-level cap value, not multiplied
    # by seats.
    policy = pro_policy(billable_seat_count=4, overage_cap_cents_per_seat=1234)
    assert policy.managed_cloud_overage_cap_cents == 1234


def test_a4_policy_overage_rate_is_derived(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "e2b_list_price_usd_per_hour", "2.00")
    monkeypatch.setattr(settings, "pro_compute_margin_multiplier", 1.5)
    policy = pro_policy(billable_seat_count=2, overage_cap_cents_per_seat=None)
    assert policy.overage_price_per_hour_cents == 300
    assert policy.included_managed_cloud_hours == pytest.approx(10.0)  # 2 seats * 5h
    assert free_v2_policy().overage_price_per_hour_cents == 300


# --- A8: managed-LLM metered at provider list + 15% ------------------------


def test_a8_llm_margin_is_fifteen_percent(monkeypatch: pytest.MonkeyPatch) -> None:
    assert Settings_default("agent_gateway_llm_margin_pct") == "15"
    monkeypatch.setattr(settings, "agent_gateway_llm_margin_pct", "15")
    assert llm_margin_multiplier() == Decimal("1.15")
    assert apply_llm_margin(10.0) == pytest.approx(11.5)
    assert apply_llm_margin(0.0) == 0.0


def test_a8_margin_fails_safe_to_no_markup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_llm_margin_pct", "not-a-number")
    assert llm_margin_multiplier() == Decimal("1")
    monkeypatch.setattr(settings, "agent_gateway_llm_margin_pct", "-5")
    assert llm_margin_multiplier() == Decimal("1")


# --- A9: auto-top-up records an admin-alert intent, no email ---------------


def test_a9_alert_intent_default_matches_topups() -> None:
    # The result carries an alerts_recorded count so callers/tests can assert
    # one intent per auto top-up. Gating early-exits record none.
    result = LlmTopupRunResult(scanned=0, eligible=0, topped_up=0, skipped=0)
    assert result.alerts_recorded == 0


def test_a9_alert_intent_emits_marker_without_email() -> None:
    from uuid import uuid4

    from proliferate.server.cloud.agent_gateway import topups as topups_module

    captured: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record)

    handler = _Capture()
    topups_module.logger.addHandler(handler)
    previous_level = topups_module.logger.level
    previous_disabled = topups_module.logger.disabled
    # The app's dictConfig (disable_existing_loggers) can disable module loggers
    # during the test session; re-enable this one so the marker is observable.
    topups_module.logger.disabled = False
    topups_module.logger.setLevel(logging.INFO)
    try:
        _record_topup_admin_alert_intent(
            billing_subject_id=uuid4(),
            invoice_id="in_test_123",
        )
    finally:
        topups_module.logger.removeHandler(handler)
        topups_module.logger.setLevel(previous_level)
        topups_module.logger.disabled = previous_disabled

    markers = [r for r in captured if r.getMessage() == AUTO_TOPUP_ADMIN_ALERT_MARKER]
    assert len(markers) == 1
    assert getattr(markers[0], "alert_audience", None) == "org_admins"
    assert getattr(markers[0], "stripe_invoice_id", None) == "in_test_123"


def Settings_default(field: str) -> str:
    """The shipped default value declared on the Settings model (not env)."""
    return type(settings).model_fields[field].default
