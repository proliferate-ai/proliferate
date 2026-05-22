from __future__ import annotations

import uuid

import pytest

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_MODE_OFF,
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
    BILLING_PRICE_CLASS_UNKNOWN,
)
from proliferate.server.billing.models import BillingSnapshot
from proliferate.server.billing.pricing import classify_monthly_price_id
from proliferate.server.billing.service import repo_limit_for_billing_snapshot


def _billing_snapshot(*, billing_mode: str, is_paid_cloud: bool) -> BillingSnapshot:
    return BillingSnapshot(
        billing_subject_id=uuid.uuid4(),
        plan="cloud" if is_paid_cloud else "free",
        billing_mode=billing_mode,
        is_unlimited=False,
        has_unlimited_cloud_hours=is_paid_cloud,
        over_quota=False,
        is_paid_cloud=is_paid_cloud,
        payment_healthy=is_paid_cloud,
        overage_enabled=False,
        overage_cap_cents_per_seat=None,
        included_hours=None if is_paid_cloud else 10.0,
        used_hours=0.0,
        remaining_hours=None if is_paid_cloud else 10.0,
        cloud_repo_limit=settings.cloud_paid_repo_limit
        if is_paid_cloud
        else settings.cloud_free_repo_limit,
        active_cloud_repo_count=0,
        concurrent_sandbox_limit=None,
        active_sandbox_count=0,
        start_blocked=False,
        start_block_reason=None,
        active_spend_hold=False,
        hold_reason=None,
        remaining_seconds=None if is_paid_cloud else 10.0 * 3600.0,
        hosted_invoice_url=None,
    )


def test_repo_limit_applies_in_observe_and_enforce_modes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)

    assert (
        repo_limit_for_billing_snapshot(
            _billing_snapshot(billing_mode=BILLING_MODE_OBSERVE, is_paid_cloud=False)
        )
        == settings.cloud_free_repo_limit
    )

    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)

    assert (
        repo_limit_for_billing_snapshot(
            _billing_snapshot(billing_mode=BILLING_MODE_ENFORCE, is_paid_cloud=False)
        )
        == settings.cloud_free_repo_limit
    )
    assert (
        repo_limit_for_billing_snapshot(
            _billing_snapshot(billing_mode=BILLING_MODE_ENFORCE, is_paid_cloud=True)
        )
        == settings.cloud_paid_repo_limit
    )


def test_repo_limit_is_disabled_when_billing_mode_is_off() -> None:
    assert (
        repo_limit_for_billing_snapshot(
            _billing_snapshot(billing_mode=BILLING_MODE_OFF, is_paid_cloud=False)
        )
        is None
    )


def test_price_classification_distinguishes_pro_legacy_and_unknown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_legacy_alias")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "price_legacy")

    assert classify_monthly_price_id("price_pro") == BILLING_PRICE_CLASS_PRO
    assert classify_monthly_price_id("price_legacy") == BILLING_PRICE_CLASS_LEGACY_CLOUD
    assert classify_monthly_price_id("price_legacy_alias") == BILLING_PRICE_CLASS_UNKNOWN
    assert classify_monthly_price_id("price_unknown") == BILLING_PRICE_CLASS_UNKNOWN
    assert classify_monthly_price_id(None) == BILLING_PRICE_CLASS_UNKNOWN


def test_price_classification_treats_cloud_monthly_as_pro_alias_without_legacy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud_alias")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

    assert classify_monthly_price_id("price_cloud_alias") == BILLING_PRICE_CLASS_PRO
