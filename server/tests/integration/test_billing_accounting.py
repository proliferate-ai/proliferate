from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
    FREE_INCLUDED_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    PRO_PERIOD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingGrantConsumption,
    BillingSubject,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
)
from proliferate.db.store.billing import (
    account_usage_for_billing_subject,
    claim_usage_exports_for_sending,
    ensure_billing_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing import service as billing_service
from tests.integration.billing_accounting_helpers import (
    patch_global_session_factory,
    seed_usage_segment,
)


@pytest.mark.asyncio
async def test_usage_export_claiming_skips_written_off_rows(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_writeoff_claim_filter"
    now = datetime.now(UTC)
    written_off_export = BillingUsageExport(
        billing_subject_id=subject.id,
        billing_subscription_id=None,
        usage_segment_id=uuid.uuid4(),
        period_start=now - timedelta(days=1),
        period_end=now + timedelta(days=29),
        accounted_from=now - timedelta(hours=2),
        accounted_until=now - timedelta(hours=1),
        quantity_seconds=3600.0,
        meter_quantity_cents=200,
        cap_cents_snapshot=2000,
        cap_used_cents_snapshot=2000,
        writeoff_reason="overage_cap_exhausted",
        idempotency_key=f"writeoff:{uuid.uuid4()}",
        status=BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
    )
    billable_export = BillingUsageExport(
        billing_subject_id=subject.id,
        billing_subscription_id=None,
        usage_segment_id=uuid.uuid4(),
        period_start=now - timedelta(days=1),
        period_end=now + timedelta(days=29),
        accounted_from=now - timedelta(hours=1),
        accounted_until=now,
        quantity_seconds=1800.0,
        meter_quantity_cents=100,
        cap_cents_snapshot=2000,
        cap_used_cents_snapshot=1900,
        idempotency_key=f"billable:{uuid.uuid4()}",
        status=BILLING_USAGE_EXPORT_STATUS_PENDING,
    )
    db_session.add_all([written_off_export, billable_export])
    await db_session.commit()
    written_off_export_id = written_off_export.id
    billable_export_id = billable_export.id

    claimed = await claim_usage_exports_for_sending()
    db_session.expire_all()

    assert [export.id for export in claimed] == [billable_export_id]
    written_off = await db_session.get(BillingUsageExport, written_off_export_id)
    billable = await db_session.get(BillingUsageExport, billable_export_id)
    assert written_off is not None
    assert billable is not None
    assert written_off.status == BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF
    assert billable.status == BILLING_USAGE_EXPORT_STATUS_SENDING


@pytest.mark.asyncio
async def test_usage_export_claiming_keeps_legacy_null_exports_in_pro_mode(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_legacy_null_export"
    now = datetime.now(UTC)
    legacy_export = BillingUsageExport(
        billing_subject_id=subject.id,
        billing_subscription_id=None,
        usage_segment_id=uuid.uuid4(),
        period_start=None,
        period_end=None,
        accounted_from=now - timedelta(hours=2),
        accounted_until=now - timedelta(hours=1),
        quantity_seconds=3600.0,
        meter_quantity_cents=None,
        idempotency_key=f"legacy:{uuid.uuid4()}",
        status=BILLING_USAGE_EXPORT_STATUS_PENDING,
    )
    db_session.add(legacy_export)
    await db_session.commit()
    legacy_export_id = legacy_export.id

    claimed = await claim_usage_exports_for_sending()
    db_session.expire_all()

    assert [export.id for export in claimed] == [legacy_export_id]
    legacy = await db_session.get(BillingUsageExport, legacy_export_id)
    assert legacy is not None
    assert legacy.status == BILLING_USAGE_EXPORT_STATUS_SENDING


@pytest.mark.asyncio
async def test_accounting_consumes_monthly_then_refill_and_observes_uncovered_usage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=12.0,
    )
    segment_ended_at = segment.ended_at
    segment_id = segment.id
    now = datetime.now(UTC)
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=MONTHLY_CLOUD_GRANT_TYPE,
        hours_granted=5.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"stripe:invoice:{uuid.uuid4()}:cloud_monthly",
    )
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=5.0,
        effective_at=now - timedelta(days=1),
        expires_at=None,
        source_ref=f"stripe:checkout:{uuid.uuid4()}:refill_10h",
    )
    subscription = BillingSubscription(
        billing_subject_id=subject_id,
        stripe_subscription_id="sub_accounting",
        stripe_customer_id="cus_accounting",
        status="active",
        cancel_at_period_end=False,
        canceled_at=None,
        current_period_start=now - timedelta(days=1),
        current_period_end=now + timedelta(days=30),
        cloud_monthly_price_id="price_cloud",
        overage_price_id="price_overage",
        monthly_subscription_item_id="si_monthly",
        metered_subscription_item_id="si_metered",
        latest_invoice_id=None,
        latest_invoice_status=None,
        hosted_invoice_url=None,
    )
    db_session.add(subscription)
    await db_session.commit()

    result = await account_usage_for_billing_subject(
        billing_subject_id=subject_id,
        is_paid_cloud=True,
        billing_subscription_id=subscription.id,
        period_start=subscription.current_period_start,
        period_end=subscription.current_period_end,
        overage_enabled=True,
        billing_mode=BILLING_MODE_OBSERVE,
        scan_until=segment_ended_at,
    )

    assert result.consumed_seconds == 10 * 3600.0
    assert result.export_seconds == 2 * 3600.0
    assert result.export_count == 1
    db_session.expire_all()

    grants = list(
        (
            await db_session.execute(
                select(BillingGrant).where(BillingGrant.billing_subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )
    assert {grant.grant_type: grant.remaining_seconds for grant in grants} == {
        MONTHLY_CLOUD_GRANT_TYPE: 0.0,
        REFILL_10H_GRANT_TYPE: 0.0,
    }

    consumptions = list(
        (
            await db_session.execute(
                select(BillingGrantConsumption)
                .where(BillingGrantConsumption.billing_subject_id == subject_id)
                .order_by(BillingGrantConsumption.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    assert [consumption.seconds for consumption in consumptions] == [5 * 3600.0, 5 * 3600.0]

    export = (
        await db_session.execute(
            select(BillingUsageExport).where(BillingUsageExport.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert export.status == BILLING_USAGE_EXPORT_STATUS_OBSERVED
    assert export.quantity_seconds == 2 * 3600.0

    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == segment_ended_at


@pytest.mark.asyncio
async def test_paid_accounting_carries_free_grants_after_monthly_before_refill(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=12.0,
    )
    segment_ended_at = segment.ended_at
    now = datetime.now(UTC)
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=MONTHLY_CLOUD_GRANT_TYPE,
        hours_granted=2.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"stripe:invoice:{uuid.uuid4()}:cloud_monthly",
    )
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=5.0,
        effective_at=now - timedelta(days=1),
        expires_at=None,
        source_ref=f"free_included:{uuid.uuid4()}",
    )
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
    subscription = BillingSubscription(
        billing_subject_id=subject_id,
        stripe_subscription_id="sub_free_carry",
        stripe_customer_id="cus_free_carry",
        status="active",
        cancel_at_period_end=False,
        canceled_at=None,
        current_period_start=now - timedelta(days=1),
        current_period_end=now + timedelta(days=30),
        cloud_monthly_price_id="price_cloud",
        overage_price_id="price_overage",
        monthly_subscription_item_id="si_monthly",
        metered_subscription_item_id="si_metered",
        latest_invoice_id=None,
        latest_invoice_status=None,
        hosted_invoice_url=None,
    )
    db_session.add(subscription)
    await db_session.commit()

    result = await account_usage_for_billing_subject(
        billing_subject_id=subject_id,
        is_paid_cloud=True,
        billing_subscription_id=subscription.id,
        period_start=subscription.current_period_start,
        period_end=subscription.current_period_end,
        overage_enabled=True,
        billing_mode=BILLING_MODE_OBSERVE,
        scan_until=segment_ended_at,
    )

    assert result.consumed_seconds == 12 * 3600.0
    assert result.export_seconds == 0.0
    assert result.export_count == 0
    db_session.expire_all()

    grants = list(
        (
            await db_session.execute(
                select(BillingGrant).where(BillingGrant.billing_subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )
    assert {grant.grant_type: grant.remaining_seconds for grant in grants} == {
        MONTHLY_CLOUD_GRANT_TYPE: 0.0,
        FREE_INCLUDED_GRANT_TYPE: 0.0,
        REFILL_10H_GRANT_TYPE: 5 * 3600.0,
    }

    consumption_rows = (
        await db_session.execute(
            select(BillingGrantConsumption, BillingGrant.grant_type)
            .join(BillingGrant, BillingGrant.id == BillingGrantConsumption.billing_grant_id)
            .where(BillingGrantConsumption.billing_subject_id == subject_id)
        )
    ).all()
    assert {kind: consumption.seconds for consumption, kind in consumption_rows} == {
        MONTHLY_CLOUD_GRANT_TYPE: 2 * 3600.0,
        FREE_INCLUDED_GRANT_TYPE: 5 * 3600.0,
        REFILL_10H_GRANT_TYPE: 5 * 3600.0,
    }


@pytest.mark.asyncio
async def test_unlimited_accounting_advances_cursor_without_consuming_or_exporting(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=12.0,
    )
    segment_ended_at = segment.ended_at
    segment_id = segment.id
    now = datetime.now(UTC)
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=5.0,
        effective_at=now - timedelta(days=1),
        expires_at=None,
        source_ref=f"stripe:checkout:{uuid.uuid4()}:refill_10h",
    )
    await db_session.commit()

    result = await account_usage_for_billing_subject(
        billing_subject_id=subject_id,
        is_paid_cloud=False,
        billing_subscription_id=None,
        period_start=None,
        period_end=None,
        overage_enabled=False,
        billing_mode=BILLING_MODE_OBSERVE,
        consume_grants=False,
        export_overage=False,
        scan_until=segment_ended_at,
    )

    assert result.consumed_seconds == 0.0
    assert result.export_seconds == 0.0
    assert result.export_count == 0
    db_session.expire_all()

    grant = (
        await db_session.execute(
            select(BillingGrant).where(BillingGrant.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert grant.remaining_seconds == 5 * 3600.0

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
async def test_manual_unlimited_with_pro_subscription_does_not_export_overage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=12.0,
    )
    segment_ended_at = segment.ended_at
    segment_id = segment.id
    now = datetime.now(UTC)
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject_id,
            stripe_subscription_id="sub_unlimited_pro",
            stripe_customer_id="cus_unlimited_pro",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=now - timedelta(days=1),
            current_period_end=now + timedelta(days=30),
            cloud_monthly_price_id="price_pro",
            overage_price_id="price_overage",
            monthly_subscription_item_id="si_monthly",
            metered_subscription_item_id="si_metered",
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
            seat_quantity=1,
        )
    )
    db_session.add(
        BillingEntitlement(
            user_id=user_id,
            billing_subject_id=subject_id,
            kind="unlimited_cloud",
            effective_at=now - timedelta(days=1),
            expires_at=None,
            note="support override",
        )
    )
    await db_session.commit()

    await billing_service.run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

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
async def test_zero_pro_overage_cap_writes_off_uncovered_usage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=2.0,
    )
    segment_ended_at = segment.ended_at
    segment_id = segment.id
    now = datetime.now(UTC)
    subject = await db_session.get(BillingSubject, subject_id)
    assert subject is not None
    subject.overage_enabled = True
    subject.overage_cap_cents_per_seat = 0
    subscription = BillingSubscription(
        billing_subject_id=subject_id,
        stripe_subscription_id="sub_zero_cap",
        stripe_customer_id="cus_zero_cap",
        status="active",
        cancel_at_period_end=False,
        canceled_at=None,
        current_period_start=now - timedelta(days=1),
        current_period_end=now + timedelta(days=30),
        cloud_monthly_price_id="price_pro",
        overage_price_id="price_overage",
        monthly_subscription_item_id="si_monthly",
        metered_subscription_item_id="si_metered",
        latest_invoice_id=None,
        latest_invoice_status=None,
        hosted_invoice_url=None,
        seat_quantity=1,
    )
    db_session.add(subscription)
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=PRO_PERIOD_GRANT_TYPE,
        hours_granted=1.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"stripe:pro-period:{uuid.uuid4()}",
    )
    await db_session.commit()

    await billing_service.run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    exports = list(
        (
            await db_session.execute(
                select(BillingUsageExport)
                .where(BillingUsageExport.billing_subject_id == subject_id)
                .order_by(BillingUsageExport.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    assert len(exports) == 1
    assert exports[0].status == BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF
    assert exports[0].meter_quantity_cents == 0
    assert exports[0].cap_cents_snapshot == 0
    assert exports[0].writeoff_reason == "overage_cap_exhausted"
    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == segment_ended_at


@pytest.mark.asyncio
async def test_paid_accounting_does_not_export_pre_subscription_free_overage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=7.0,
    )
    now = datetime.now(UTC)
    segment.started_at = now - timedelta(hours=9)
    segment.ended_at = now - timedelta(hours=2)
    segment_ended_at = segment.ended_at
    segment_id = segment.id
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=5.0,
        effective_at=now - timedelta(days=1),
        expires_at=None,
        source_ref=f"free_included:{uuid.uuid4()}",
    )
    subscription = BillingSubscription(
        billing_subject_id=subject_id,
        stripe_subscription_id="sub_preperiod",
        stripe_customer_id="cus_preperiod",
        status="active",
        cancel_at_period_end=False,
        canceled_at=None,
        current_period_start=now - timedelta(hours=1),
        current_period_end=now + timedelta(days=30),
        cloud_monthly_price_id="price_cloud",
        overage_price_id="price_overage",
        monthly_subscription_item_id="si_monthly",
        metered_subscription_item_id="si_metered",
        latest_invoice_id=None,
        latest_invoice_status=None,
        hosted_invoice_url=None,
    )
    db_session.add(subscription)
    await db_session.commit()

    result = await account_usage_for_billing_subject(
        billing_subject_id=subject_id,
        is_paid_cloud=True,
        billing_subscription_id=subscription.id,
        period_start=subscription.current_period_start,
        period_end=subscription.current_period_end,
        overage_enabled=True,
        billing_mode=BILLING_MODE_OBSERVE,
        scan_until=now,
    )

    assert result.consumed_seconds == 5 * 3600.0
    assert result.export_seconds == 0.0
    assert result.export_count == 0
    db_session.expire_all()

    grant = (
        await db_session.execute(
            select(BillingGrant).where(BillingGrant.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert grant.remaining_seconds == 0.0
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
