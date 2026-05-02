from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    FREE_INCLUDED_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.db.models.billing import (
    BillingGrant,
    BillingGrantConsumption,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
)
from proliferate.db.store.billing import (
    account_usage_for_billing_subject,
    ensure_billing_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing import service as billing_service
from tests.integration.billing_accounting_helpers import (
    patch_global_session_factory,
    seed_usage_segment,
)


@pytest.mark.asyncio
async def test_accounting_splits_pre_subscription_usage_before_unlimited_hours(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=2.0,
    )
    now = datetime.now(UTC)
    subscription_started_at = now - timedelta(hours=1)
    segment.started_at = now - timedelta(hours=2)
    segment.ended_at = now
    segment_ended_at = segment.ended_at
    segment_id = segment.id
    free_grant_source_ref = f"free_included:{uuid.uuid4()}"
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=2.0,
        effective_at=now - timedelta(days=1),
        expires_at=None,
        source_ref=free_grant_source_ref,
    )
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject_id,
            stripe_subscription_id="sub_upgrade_boundary",
            stripe_customer_id="cus_upgrade_boundary",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=subscription_started_at,
            current_period_end=now + timedelta(days=30),
            cloud_monthly_price_id="price_cloud",
            overage_price_id=None,
            monthly_subscription_item_id="si_monthly",
            metered_subscription_item_id=None,
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
            created_at=subscription_started_at,
            updated_at=now,
        )
    )
    await db_session.commit()

    await billing_service.run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    grant = (
        await db_session.execute(
            select(BillingGrant).where(BillingGrant.source_ref == free_grant_source_ref)
        )
    ).scalar_one()
    assert grant.remaining_seconds == 1 * 3600.0

    consumptions = list(
        (
            await db_session.execute(
                select(BillingGrantConsumption).where(
                    BillingGrantConsumption.billing_subject_id == subject_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert [consumption.seconds for consumption in consumptions] == [1 * 3600.0]

    exports = list(
        (
            await db_session.execute(
                select(BillingUsageExport).where(
                    BillingUsageExport.billing_subject_id == subject_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert exports == []

    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == segment_ended_at


@pytest.mark.asyncio
async def test_accounting_uses_stable_subscription_start_after_renewal(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=2.0,
    )
    now = datetime.now(UTC)
    paid_access_started_at = now - timedelta(days=10)
    segment.started_at = now - timedelta(hours=2)
    segment.ended_at = now
    segment_id = segment.id
    free_grant_source_ref = f"free_included:{uuid.uuid4()}"
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=2.0,
        effective_at=now - timedelta(days=20),
        expires_at=None,
        source_ref=free_grant_source_ref,
    )
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject_id,
            stripe_subscription_id="sub_renewal_boundary",
            stripe_customer_id="cus_renewal_boundary",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=now - timedelta(minutes=30),
            current_period_end=now + timedelta(days=30),
            cloud_monthly_price_id="price_cloud",
            overage_price_id=None,
            monthly_subscription_item_id="si_monthly",
            metered_subscription_item_id=None,
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
            created_at=paid_access_started_at,
            updated_at=now,
        )
    )
    await db_session.commit()

    await billing_service.run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    grant = (
        await db_session.execute(
            select(BillingGrant).where(BillingGrant.source_ref == free_grant_source_ref)
        )
    ).scalar_one()
    assert grant.remaining_seconds == 2 * 3600.0

    consumptions = list(
        (
            await db_session.execute(
                select(BillingGrantConsumption).where(
                    BillingGrantConsumption.billing_subject_id == subject_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert consumptions == []

    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == now


@pytest.mark.asyncio
async def test_accounting_cursor_prevents_duplicate_consumption(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=2.0,
    )
    segment_ended_at = segment.ended_at
    now = datetime.now(UTC)
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=now - timedelta(days=1),
        expires_at=None,
        source_ref=f"stripe:checkout:{uuid.uuid4()}:refill_10h",
    )
    await db_session.commit()

    for _ in range(2):
        await account_usage_for_billing_subject(
            billing_subject_id=subject_id,
            is_paid_cloud=False,
            billing_subscription_id=None,
            period_start=None,
            period_end=None,
            overage_enabled=False,
            billing_mode=BILLING_MODE_OBSERVE,
            scan_until=segment_ended_at,
        )
    db_session.expire_all()

    grant = (
        await db_session.execute(
            select(BillingGrant).where(BillingGrant.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert grant.remaining_seconds == 8 * 3600.0

    consumption_count = (
        await db_session.execute(
            select(BillingGrantConsumption).where(
                BillingGrantConsumption.billing_subject_id == subject_id
            )
        )
    ).scalars()
    assert len(list(consumption_count.all())) == 1


@pytest.mark.asyncio
async def test_pending_usage_export_is_sent_as_raw_seconds(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "stripe_sandbox_meter_event_name", "proliferate_sandbox_seconds")
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=2.0,
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_export"
    export = BillingUsageExport(
        billing_subject_id=subject_id,
        billing_subscription_id=None,
        usage_segment_id=segment.id,
        period_start=None,
        period_end=None,
        accounted_from=segment.started_at,
        accounted_until=segment.ended_at,
        quantity_seconds=7200.0,
        idempotency_key=f"stripe:usage:{uuid.uuid4()}",
        stripe_meter_event_identifier=None,
        status="pending",
        error=None,
    )
    db_session.add(export)
    await db_session.commit()

    calls: list[dict[str, Any]] = []

    async def _fake_create_meter_event(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {"identifier": kwargs["identifier"]}

    monkeypatch.setattr(
        billing_service.stripe_billing,
        "create_meter_event",
        _fake_create_meter_event,
    )

    await billing_service.send_pending_usage_exports()

    assert calls == [
        {
            "event_name": "proliferate_sandbox_seconds",
            "stripe_customer_id": "cus_export",
            "quantity_seconds": 7200,
            "identifier": f"usage_export:{export.id}",
            "timestamp": int(segment.ended_at.timestamp()),
            "idempotency_key": export.idempotency_key,
        }
    ]
    await db_session.refresh(export)
    assert export.status == BILLING_USAGE_EXPORT_STATUS_SUCCEEDED
    assert export.stripe_meter_event_identifier == f"usage_export:{export.id}"
