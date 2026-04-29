from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    FREE_INCLUDED_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.billing import (
    BillingGrant,
    BillingGrantConsumption,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
)
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.db.store.billing import (
    account_usage_for_billing_subject,
    ensure_billing_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing import service as billing_service


def _patch_global_session_factory(
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )


async def _seed_usage_segment(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    hours: float,
    ended: bool = True,
) -> tuple[uuid.UUID, UsageSegment]:
    subject = await ensure_personal_billing_subject(db_session, user_id)
    now = datetime.now(UTC)
    workspace = CloudWorkspace(
        user_id=user_id,
        billing_subject_id=subject.id,
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="main",
        git_base_branch="main",
        status="running" if not ended else "stopped",
        status_detail="Running" if not ended else "Stopped",
        last_error=None,
        template_version="v1",
        runtime_generation=1,
    )
    db_session.add(workspace)
    await db_session.flush()

    sandbox = CloudSandbox(
        cloud_workspace_id=workspace.id,
        provider="e2b",
        external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        status="running" if not ended else "paused",
        template_version="v1",
        started_at=now - timedelta(hours=hours),
        stopped_at=now if ended else None,
    )
    db_session.add(sandbox)
    await db_session.flush()

    segment = UsageSegment(
        user_id=user_id,
        billing_subject_id=subject.id,
        workspace_id=workspace.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=sandbox.external_sandbox_id,
        sandbox_execution_id=None,
        started_at=now - timedelta(hours=hours),
        ended_at=now if ended else None,
        is_billable=True,
        opened_by="provision",
        closed_by="manual_stop" if ended else None,
    )
    db_session.add(segment)
    await db_session.flush()
    return subject.id, segment


@pytest.mark.asyncio
async def test_accounting_consumes_monthly_then_refill_and_observes_uncovered_usage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject_id, segment = await _seed_usage_segment(
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
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject_id, segment = await _seed_usage_segment(
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
async def test_paid_accounting_does_not_export_pre_subscription_free_overage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject_id, segment = await _seed_usage_segment(
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


@pytest.mark.asyncio
async def test_accounting_cursor_prevents_duplicate_consumption(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject_id, segment = await _seed_usage_segment(
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
    _patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "stripe_sandbox_meter_event_name", "proliferate_sandbox_seconds")
    user_id = uuid.uuid4()
    subject_id, segment = await _seed_usage_segment(
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
