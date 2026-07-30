"""Repeated accounting passes must not re-charge the same usage (law A2, B2).

The accounting pass runs every 15 minutes against every subject with billable
usage. Nothing about that is idempotent by construction — it is idempotent
*because* of the ``billing_usage_cursor`` row, which records how far each
segment has been accounted. If that cursor were ever not advanced, or were
ignored, every pass would re-bill the whole segment from scratch: a user with a
closed 2-hour segment would be charged 2 hours every 15 minutes, forever.

Every existing accounting test runs the pass exactly ONCE, so the guarantee the
entire money-out path rests on was unpinned. These tests run it twice and three
times and assert nothing moves after the first pass — separately for the
outcomes that have different code paths:

* grant-covered usage (grant seconds consumed, consumption rows written),
* uncovered usage under PRO (a metered export row created), and
* uncovered usage under the launch config, PRO off (no export row at all).

That last one is not a formality. ``run_billing_accounting_pass`` only reaches
the export arm when ``pro_billing_enabled`` is on *and* the subscription
classifies as Pro, and ``export_overage`` repeats the same condition. With PRO
off there is no metered money-out path whatsoever — uncovered compute is
prevented by the start gate rather than billed after the fact. Pinning that
keeps a later PRO rollout from silently turning launch-era usage into charges.

A closed segment is used deliberately. An OPEN segment legitimately accrues new
billable time between passes, so it cannot distinguish "correctly billed the new
slice" from "re-billed the old one".
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
    BILLING_MODE_OBSERVE,
    FREE_INCLUDED_GRANT_TYPE,
)
from proliferate.db.models.billing import (
    BillingGrant,
    BillingGrantConsumption,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
)
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant,
    get_billing_subject_by_id,
)
from proliferate.server.billing.accounting_pass import run_billing_accounting_pass
from tests.integration.billing_accounting_helpers import (
    patch_global_session_factory,
    seed_usage_segment,
)

SEGMENT_HOURS = 2.0


@pytest.fixture(autouse=True)
def _observe_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Observe mode: exports are written but not sent to Stripe.

    The idempotency question is about the rows we create, so keeping Stripe out
    of it keeps the test about accounting rather than about the exporter.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)


async def _consumptions(db_session: AsyncSession, subject_id: uuid.UUID) -> list[float]:
    return [
        consumption.seconds
        for consumption in (
            await db_session.execute(
                select(BillingGrantConsumption)
                .where(BillingGrantConsumption.billing_subject_id == subject_id)
                .order_by(BillingGrantConsumption.id)
            )
        )
        .scalars()
        .all()
    ]


async def _exports(db_session: AsyncSession, subject_id: uuid.UUID) -> list[BillingUsageExport]:
    return list(
        (
            await db_session.execute(
                select(BillingUsageExport)
                .where(BillingUsageExport.billing_subject_id == subject_id)
                .order_by(BillingUsageExport.id)
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_repeated_passes_consume_grant_seconds_exactly_once(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Three passes over one closed grant-covered segment drain the grant once.

    A 2-hour segment against a 5-hour grant. Correct behaviour leaves 3 hours
    remaining no matter how many passes run. A cursor regression would leave 1
    hour after the second pass and 0 (plus uncovered overage) after the third —
    the user's balance evaporating while they run nothing.
    """
    patch_global_session_factory(test_engine, monkeypatch)
    user_id = uuid.uuid4()
    subject_id, _segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=SEGMENT_HOURS,
    )
    source_ref = f"{FREE_INCLUDED_GRANT_TYPE}:{uuid.uuid4()}"
    await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=subject_id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=5.0,
        effective_at=datetime.now(UTC) - timedelta(days=1),
        expires_at=None,
        source_ref=source_ref,
    )
    await db_session.commit()

    async def _remaining() -> float:
        db_session.expire_all()
        grant = (
            await db_session.execute(
                select(BillingGrant).where(BillingGrant.source_ref == source_ref)
            )
        ).scalar_one()
        return grant.remaining_seconds

    await run_billing_accounting_pass(subject_limit=10)
    remaining_after_first = await _remaining()
    assert remaining_after_first == pytest.approx(3 * 3600.0)
    consumptions_after_first = await _consumptions(db_session, subject_id)
    assert consumptions_after_first == [pytest.approx(SEGMENT_HOURS * 3600.0)]

    # Two more passes, as the 15-minute loop would do with nothing new happening.
    await run_billing_accounting_pass(subject_limit=10)
    await run_billing_accounting_pass(subject_limit=10)

    assert await _remaining() == pytest.approx(remaining_after_first), (
        "repeated passes re-charged a closed segment against the grant"
    )
    assert await _consumptions(db_session, subject_id) == consumptions_after_first, (
        "repeated passes wrote duplicate grant-consumption rows"
    )
    assert await _exports(db_session, subject_id) == [], (
        "fully grant-covered usage must never produce a metered export row"
    )


async def _seed_paid_pro_subject(
    db_session: AsyncSession,
    *,
    label: str,
) -> tuple[uuid.UUID, uuid.UUID, datetime | None]:
    """A Pro subject with overage enabled, no grant, and one closed segment.

    No grant at all, so the whole slice is uncovered; the subscription is what
    makes uncovered usage billable rather than refused. The cap is left at the
    flat org-month default ($50), well above 2 hours of compute, so nothing is
    clamped and the export arm is the only thing under test.
    """
    user_id = uuid.uuid4()
    subject_id, segment = await seed_usage_segment(
        db_session,
        user_id=user_id,
        hours=SEGMENT_HOURS,
    )
    now = datetime.now(UTC)
    subject = await get_billing_subject_by_id(db_session, subject_id)
    assert subject is not None
    subject.overage_enabled = True
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject_id,
            stripe_subscription_id=f"sub_{label}",
            stripe_customer_id=f"cus_{label}",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            # The period must start before the segment: a paid subject's
            # accounting splits at ``current_period_start``, and any slice before
            # it is observed rather than exported.
            current_period_start=now - timedelta(days=1),
            current_period_end=now + timedelta(days=29),
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
    await db_session.commit()
    return subject_id, segment.id, segment.ended_at


@pytest.mark.asyncio
async def test_repeated_passes_export_uncovered_usage_exactly_once(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two passes over uncovered usage produce ONE export row (B2).

    This is the arm that reaches Stripe in enforce mode, so a duplicate here is
    a duplicate charge. The per-row idempotency key protects against re-*sending*
    one row; it cannot protect against a second row being created for usage
    already billed. That is the cursor's job, and this is what pins it.

    PRO must be on for an export row to exist at all — see the module docstring
    and ``test_pro_off_never_exports_uncovered_usage``. So this test deliberately
    runs the *future* configuration: it guards the money-out path that a PRO
    rollout switches on, not the launch-day one.
    """
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    subject_id, segment_id, segment_ended_at = await _seed_paid_pro_subject(
        db_session,
        label="repeat_pass",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()
    exports_after_first = await _exports(db_session, subject_id)
    assert len(exports_after_first) == 1
    first_key = exports_after_first[0].idempotency_key
    first_seconds = exports_after_first[0].quantity_seconds
    assert first_seconds == pytest.approx(SEGMENT_HOURS * 3600.0)

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    exports_after_second = await _exports(db_session, subject_id)
    assert len(exports_after_second) == 1, (
        "a second pass created a second export row for usage already billed — "
        f"{[export.quantity_seconds for export in exports_after_second]}"
    )
    assert exports_after_second[0].idempotency_key == first_key
    assert exports_after_second[0].quantity_seconds == pytest.approx(first_seconds)

    # The cursor is the mechanism, so assert it directly rather than only its
    # effect: it must sit exactly at the segment's end, not short of it.
    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == segment_ended_at


@pytest.mark.asyncio
async def test_pro_off_never_exports_uncovered_usage(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The launch config has no metered money-out path at all.

    Same subject and same uncovered 2 hours as the export test above, with the
    only difference being ``pro_billing_enabled=False`` — the launch setting.
    The pass must write no export row: uncovered compute is refused up front by
    the start gate, never charged afterwards. The autouse fixture already pins
    PRO off, so this asserts the shipping configuration directly.

    The cursor must still advance. Otherwise every 15-minute pass would rescan
    the same closed segment forever, and the day PRO is switched on it would
    export launch-era usage as fresh charges.
    """
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    subject_id, segment_id, segment_ended_at = await _seed_paid_pro_subject(
        db_session,
        label="pro_off",
    )

    await run_billing_accounting_pass(subject_limit=10)
    db_session.expire_all()

    assert await _exports(db_session, subject_id) == [], (
        "PRO is off at launch, so uncovered usage must never be metered to Stripe"
    )
    cursor = (
        await db_session.execute(
            select(BillingUsageCursor).where(BillingUsageCursor.usage_segment_id == segment_id)
        )
    ).scalar_one()
    assert cursor.accounted_until == segment_ended_at, (
        "the cursor must advance even with nothing to bill, or enabling PRO later "
        "would export usage from before it was enabled"
    )
