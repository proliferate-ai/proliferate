"""Over-cap compute-overage accounting receipts (corridor B-F1, law A2).

Law A2 of the billing launch plan: "no orphaned spend — every closed segment is
grant-covered, exported, or receipted. No silent fourth bucket."

The org-month overage cap clamps ``billable_cents`` below the metered
``meter_cents``. Ruled 2026-07-14, the refused remainder is *paused*, not
auto-written-off: write-off stays operator-only, so no ``written_off`` export row
is created for it (pinned by ``t2-bill.ts`` / ``billing/overage.spec.ts`` and by
``test_zero_pro_overage_cap_pauses_without_auto_writeoff``). What A2 does require
is that the refused spend be *attributable*, and it was not: a pass whose whole
uncovered slice was over-cap recorded no ``BillingDecisionEvent`` at all, because
the receipt was gated on ``export_count > 0``. These tests pin the receipt.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_DECISION_REASON_OVERAGE_CAP_REACHED,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    PRO_PERIOD_GRANT_TYPE,
)
from proliferate.db.models.billing import (
    BillingDecisionEvent,
    BillingSubject,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
)
from proliferate.db.store.billing_subjects import ensure_billing_grant
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.billing.accounting_pass import run_billing_accounting_pass
from tests.integration.billing_accounting_helpers import (
    patch_global_session_factory,
    seed_usage_segment,
)


async def _seed_capped_overage_subject(
    db_session: AsyncSession,
    *,
    hours: float,
    cap_cents: int,
    granted_hours: float,
    label: str,
    prior_export_cents: int = 0,
) -> tuple[uuid.UUID, uuid.UUID, datetime | None]:
    """Paid pro subject with overage enabled, a flat org-month cap, and one segment.

    ``prior_export_cents`` seeds an earlier in-period billable export so the
    org-month cap is already (partly) spent before the pass runs, which is how a
    real subject reaches the cap mid-period.
    """
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(db_session, user_id=user_id, hours=hours)
    now = datetime.now(UTC)
    period_start = now - timedelta(days=1)
    subject = await db_session.get(BillingSubject, subject_id)
    assert subject is not None
    subject.overage_enabled = True
    subject.overage_cap_cents_per_seat = cap_cents
    if prior_export_cents > 0:
        db_session.add(
            BillingUsageExport(
                billing_subject_id=subject_id,
                billing_subscription_id=None,
                usage_segment_id=uuid.uuid4(),
                period_start=period_start,
                period_end=now + timedelta(days=30),
                accounted_from=now - timedelta(days=1),
                accounted_until=now - timedelta(hours=20),
                quantity_seconds=prior_export_cents * 3600.0 / 300,
                meter_quantity_cents=prior_export_cents,
                cap_cents_snapshot=cap_cents,
                cap_used_cents_snapshot=0,
                idempotency_key=f"prior:{label}:{uuid.uuid4()}",
                status=BILLING_USAGE_EXPORT_STATUS_OBSERVED,
            )
        )
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject_id,
            stripe_subscription_id=f"sub_{label}",
            stripe_customer_id=f"cus_{label}",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=period_start,
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
    if granted_hours > 0:
        await ensure_billing_grant(
            db_session,
            user_id=user_id,
            billing_subject_id=subject_id,
            grant_type=PRO_PERIOD_GRANT_TYPE,
            hours_granted=granted_hours,
            effective_at=now - timedelta(days=1),
            expires_at=now + timedelta(days=30),
            source_ref=f"stripe:pro-period:{uuid.uuid4()}",
        )
    await db_session.commit()
    return subject_id, segment.id, segment.ended_at


def _configure_pro_observe(test_engine: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")


async def _exports_for(
    db_session: AsyncSession,
    subject_id: uuid.UUID,
) -> list[BillingUsageExport]:
    return list(
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


async def _decisions_for(
    db_session: AsyncSession,
    subject_id: uuid.UUID,
) -> list[BillingDecisionEvent]:
    return list(
        (
            await db_session.execute(
                select(BillingDecisionEvent)
                .where(BillingDecisionEvent.billing_subject_id == subject_id)
                .order_by(BillingDecisionEvent.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_fully_over_cap_pass_records_receipt_without_export_row(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """B-F1 / A2a: a pass whose whole uncovered slice is over-cap still receipts.

    Ruled 2026-07-14: past the org-month cap compute PAUSES and the remainder is
    NOT auto-written-off (write-off is operator-only), so no export row appears.
    Law A2 nonetheless forbids a silent fourth bucket, so the pass must leave a
    durable ``BillingDecisionEvent``. Before this fix the receipt was gated on
    ``export_count > 0`` and such a pass left no trace at all.
    """
    _configure_pro_observe(test_engine, monkeypatch)
    # Cap (300c) already fully spent by an earlier in-period export, no grant
    # left, so the whole 1h uncovered slice (300c at $3/hr) is over-cap.
    subject_id, segment_id, segment_ended_at = await _seed_capped_overage_subject(
        db_session,
        hours=1.0,
        cap_cents=300,
        granted_hours=0.0,
        label="fully_over_cap",
        prior_export_cents=300,
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    exports = await _exports_for(db_session, subject_id)
    # Ruled behaviour: the over-cap hour adds no export row of any kind — only
    # the pre-seeded prior export remains.
    assert [export.meter_quantity_cents for export in exports] == [300]
    assert all(export.writeoff_reason is None for export in exports)
    decisions = await _decisions_for(db_session, subject_id)
    assert [decision.reason for decision in decisions] == [
        BILLING_DECISION_REASON_OVERAGE_CAP_REACHED
    ]
    assert decisions[0].decision_type == BILLING_DECISION_OVERAGE_EXPORT
    assert decisions[0].mode == BILLING_MODE_OBSERVE
    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == segment_ended_at


@pytest.mark.asyncio
async def test_zero_cap_over_cap_pass_records_receipt(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """B-F1 / A2a: the zero-cap variant is receipted too.

    A ``0`` cap refuses the whole uncovered slice without any prior export, which
    is the shape ``test_zero_pro_overage_cap_pauses_without_auto_writeoff`` pins
    for the no-export-row half of the ruling. Assert the receipt half here so the
    zero-cap path is not a silent fourth bucket either.
    """
    _configure_pro_observe(test_engine, monkeypatch)
    subject_id, _segment_id, _ended_at = await _seed_capped_overage_subject(
        db_session,
        hours=2.0,
        cap_cents=0,
        granted_hours=1.0,
        label="zero_cap_receipt",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    assert await _exports_for(db_session, subject_id) == []
    decisions = await _decisions_for(db_session, subject_id)
    assert [decision.reason for decision in decisions] == [
        BILLING_DECISION_REASON_OVERAGE_CAP_REACHED
    ]


@pytest.mark.asyncio
async def test_partially_clamped_overage_exports_billable_and_receipts_remainder(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """B-F1 / A2b: a partial clamp bills up to the cap and receipts the rest.

    Cap 300c against a 2h uncovered slice at $3/hr (600c): 300c exports, 300c is
    refused. The billable row must be exactly the capped amount, and the refused
    half must be accounted for by the receipt rather than vanishing.
    """
    _configure_pro_observe(test_engine, monkeypatch)
    subject_id, _segment_id, _ended_at = await _seed_capped_overage_subject(
        db_session,
        hours=2.0,
        cap_cents=300,
        granted_hours=0.0,
        label="partial_clamp",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    exports = await _exports_for(db_session, subject_id)
    assert len(exports) == 1
    assert exports[0].meter_quantity_cents == 300
    assert exports[0].status == BILLING_USAGE_EXPORT_STATUS_OBSERVED
    assert exports[0].writeoff_reason is None
    # Billed half is one hour of the two-hour slice.
    assert exports[0].quantity_seconds == pytest.approx(3600.0)
    decisions = await _decisions_for(db_session, subject_id)
    assert [decision.reason for decision in decisions] == [BILLING_USAGE_EXPORT_STATUS_OBSERVED]


@pytest.mark.asyncio
async def test_under_cap_overage_receipts_as_export_without_cap_reason(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """B-F1 / A2c regression: under-cap behaviour is unchanged by the fix.

    A generous cap must leave the ordinary export path and its ``observed``
    receipt reason exactly as before — no cap receipt, no write-off row.
    """
    _configure_pro_observe(test_engine, monkeypatch)
    subject_id, _segment_id, _ended_at = await _seed_capped_overage_subject(
        db_session,
        hours=2.0,
        cap_cents=100_000,
        granted_hours=1.0,
        label="under_cap",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    exports = await _exports_for(db_session, subject_id)
    assert len(exports) == 1
    assert exports[0].meter_quantity_cents == 300
    assert exports[0].writeoff_reason is None
    assert exports[0].status == BILLING_USAGE_EXPORT_STATUS_OBSERVED
    decisions = await _decisions_for(db_session, subject_id)
    assert [decision.reason for decision in decisions] == [BILLING_USAGE_EXPORT_STATUS_OBSERVED]


@pytest.mark.asyncio
async def test_over_cap_pass_rerun_is_idempotent(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """B-F1 / A2d: re-running the pass adds no export rows for over-cap usage.

    The usage cursor advances past the accounted slice on the first pass, so the
    second pass finds nothing accountable: no duplicate export row and (because
    there is no new refused spend) no second cap receipt either.
    """
    _configure_pro_observe(test_engine, monkeypatch)
    subject_id, _segment_id, _ended_at = await _seed_capped_overage_subject(
        db_session,
        hours=2.0,
        cap_cents=300,
        granted_hours=1.0,
        label="over_cap_rerun",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()
    exports_after_first = await _exports_for(db_session, subject_id)
    decisions_after_first = await _decisions_for(db_session, subject_id)

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    exports_after_second = await _exports_for(db_session, subject_id)
    decisions_after_second = await _decisions_for(db_session, subject_id)
    assert [export.id for export in exports_after_second] == [
        export.id for export in exports_after_first
    ]
    assert [decision.id for decision in decisions_after_second] == [
        decision.id for decision in decisions_after_first
    ]


@pytest.mark.asyncio
async def test_over_cap_accounting_never_produces_claimable_rows(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """B-F1 / A2e: the Stripe claimer never picks up over-cap spend.

    Complements ``test_usage_export_claiming_skips_written_off_rows`` (which
    builds its rows by hand) by driving the real production accounting path and
    asserting the claimer only ever sees the capped billable row.
    """
    _configure_pro_observe(test_engine, monkeypatch)
    subject_id, _segment_id, _ended_at = await _seed_capped_overage_subject(
        db_session,
        hours=2.0,
        cap_cents=300,
        granted_hours=0.0,
        label="claimer_over_cap",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()
    exports = await _exports_for(db_session, subject_id)
    assert len(exports) == 1
    # Observe mode parks the billable row as `observed`, which the claimer also
    # never claims; flip it to pending so the claimer is genuinely exercised.
    billable_id = exports[0].id
    exports[0].status = BILLING_USAGE_EXPORT_STATUS_PENDING
    await db_session.commit()

    claimed = await billing_accounting_service.claim_usage_exports_for_sending()
    db_session.expire_all()

    # Only the capped billable row is claimable: the refused 300c never becomes
    # a Stripe-visible row, so the claimer can never bill the uncapped 600c the
    # slice metered to.
    assert [export.id for export in claimed] == [billable_id]
    assert sum(export.meter_quantity_cents or 0 for export in claimed) == 300
