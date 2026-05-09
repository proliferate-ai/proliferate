from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from proliferate.constants.billing import (
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
    BILLING_PRICE_CLASS_UNKNOWN,
    FREE_INCLUDED_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
    UNLIMITED_CLOUD_ENTITLEMENT,
    WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
)
from proliferate.server.billing.domain.accounting import (
    next_accounting_boundary,
    ordered_accounting_grants,
    stripe_status_is_terminal,
    terminal_meter_event_error,
    usage_export_idempotency_key,
)
from proliferate.server.billing.domain.plans import (
    BillingPlanRuleConfig,
    active_hold_reason,
    compute_unlimited_cloud_hours_state,
)
from proliferate.server.billing.domain.pricing import (
    BillingPriceIds,
    classify_monthly_price_id,
)
from proliferate.server.billing.domain.webhooks import (
    line_is_cloud_subscription,
    subscription_item_details,
    subscription_period,
)


def test_domain_price_classification_distinguishes_pro_legacy_and_unknown() -> None:
    price_ids = BillingPriceIds(
        cloud_monthly_price_id="price_cloud_alias",
        pro_monthly_price_id="price_pro",
        legacy_cloud_monthly_price_id="price_legacy",
    )

    assert classify_monthly_price_id("price_pro", price_ids=price_ids) == BILLING_PRICE_CLASS_PRO
    assert (
        classify_monthly_price_id("price_legacy", price_ids=price_ids)
        == BILLING_PRICE_CLASS_LEGACY_CLOUD
    )
    assert (
        classify_monthly_price_id("price_cloud_alias", price_ids=price_ids)
        == BILLING_PRICE_CLASS_UNKNOWN
    )
    assert classify_monthly_price_id(None, price_ids=price_ids) == BILLING_PRICE_CLASS_UNKNOWN


def test_domain_price_classification_treats_cloud_monthly_as_pro_alias() -> None:
    price_ids = BillingPriceIds(
        cloud_monthly_price_id="price_cloud_alias",
        pro_monthly_price_id="",
        legacy_cloud_monthly_price_id="",
    )

    assert (
        classify_monthly_price_id("price_cloud_alias", price_ids=price_ids)
        == BILLING_PRICE_CLASS_PRO
    )


def test_entitlement_state_and_hold_reason_are_pure_rules() -> None:
    now = datetime(2026, 5, 9, 12, tzinfo=UTC)
    price_ids = BillingPriceIds(legacy_cloud_monthly_price_id="price_legacy")
    subscription = SimpleNamespace(
        status="active",
        cloud_monthly_price_id="price_legacy",
        current_period_start=now - timedelta(days=3),
        current_period_end=now + timedelta(days=27),
        created_at=now - timedelta(days=10),
        updated_at=now - timedelta(hours=1),
    )
    entitlement = SimpleNamespace(
        kind=UNLIMITED_CLOUD_ENTITLEMENT,
        effective_at=now - timedelta(days=20),
        expires_at=None,
        created_at=now - timedelta(days=20),
    )

    state = compute_unlimited_cloud_hours_state(
        subscriptions=[subscription],
        entitlements=[entitlement],
        now=now,
        config=BillingPlanRuleConfig(
            pro_billing_enabled=True,
            cloud_monthly_price_id="",
            price_ids=price_ids,
        ),
    )

    assert state.subscription is subscription
    assert state.manual_entitlement is entitlement
    assert state.has_unlimited_cloud_hours is True
    assert state.unlimited_window_start == entitlement.effective_at
    assert state.legacy_cloud_subscription is True
    assert (
        active_hold_reason([SimpleNamespace(kind=BILLING_HOLD_KIND_PAYMENT_FAILED)])
        == WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED
    )


def test_accounting_grant_order_boundaries_and_export_keys_are_pure() -> None:
    now = datetime(2026, 5, 9, 12, tzinfo=UTC)
    grants = [
        SimpleNamespace(
            grant_type=REFILL_10H_GRANT_TYPE,
            remaining_seconds=3600.0,
            effective_at=now - timedelta(days=1),
            expires_at=None,
            created_at=now,
        ),
        SimpleNamespace(
            grant_type=FREE_INCLUDED_GRANT_TYPE,
            remaining_seconds=3600.0,
            effective_at=now - timedelta(days=1),
            expires_at=None,
            created_at=now,
        ),
        SimpleNamespace(
            grant_type=MONTHLY_CLOUD_GRANT_TYPE,
            remaining_seconds=3600.0,
            effective_at=now - timedelta(days=1),
            expires_at=now + timedelta(hours=2),
            created_at=now,
        ),
    ]

    ordered = ordered_accounting_grants(
        grants,
        pro_billing_enabled=False,
        is_paid_cloud=True,
        at=now,
    )

    assert [grant.grant_type for grant in ordered] == [
        MONTHLY_CLOUD_GRANT_TYPE,
        FREE_INCLUDED_GRANT_TYPE,
        REFILL_10H_GRANT_TYPE,
    ]
    assert next_accounting_boundary(now, now + timedelta(hours=3), grants) == now + timedelta(
        hours=2,
    )
    assert usage_export_idempotency_key(
        billing_subject_id=uuid4(),
        usage_segment_id=uuid4(),
        accounted_from=now,
        accounted_until=now + timedelta(hours=1),
    ).startswith("stripe:usage:")


def test_meter_export_failure_classification_is_pure() -> None:
    now = datetime(2026, 5, 9, 12, tzinfo=UTC)

    assert stripe_status_is_terminal(400) is True
    assert stripe_status_is_terminal(429) is False
    assert stripe_status_is_terminal(500) is False
    assert (
        terminal_meter_event_error(now - timedelta(days=36), now=now)
        == "Stripe meter events cannot be created for usage older than 35 days."
    )
    assert (
        terminal_meter_event_error(now + timedelta(minutes=6), now=now)
        == "Stripe meter events cannot be created more than 5 minutes in the future."
    )
    assert terminal_meter_event_error(now, now=now) is None


def test_webhook_subscription_payload_extraction_is_pure() -> None:
    price_ids = BillingPriceIds(pro_monthly_price_id="price_pro")
    subscription = {
        "current_period_start": None,
        "current_period_end": None,
        "items": {
            "data": [
                {
                    "id": "si_monthly",
                    "quantity": 3,
                    "price": {"id": "price_pro"},
                    "current_period_start": 1_776_586_422,
                    "current_period_end": 1_779_178_422,
                },
                {"id": "si_overage", "price": {"id": "price_overage"}},
            ],
        },
    }

    details = subscription_item_details(
        subscription,
        monthly_price_ids=frozenset({"price_pro"}),
        overage_price_ids=frozenset({"price_overage"}),
    )

    assert details.monthly_item_id == "si_monthly"
    assert details.metered_item_id == "si_overage"
    assert details.seat_quantity == 3
    assert subscription_period(
        subscription,
        monthly_item_id=details.monthly_item_id,
        metered_item_id=details.metered_item_id,
    ) == (
        datetime.fromtimestamp(1_776_586_422, tz=UTC),
        datetime.fromtimestamp(1_779_178_422, tz=UTC),
    )
    assert line_is_cloud_subscription(
        {"pricing": {"price_details": {"price": "price_pro"}}},
        pro_billing_enabled=True,
        cloud_monthly_price_id="",
        price_ids=price_ids,
    )
