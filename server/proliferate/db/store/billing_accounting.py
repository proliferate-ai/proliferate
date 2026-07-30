"""Billing usage accounting persistence helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_DECISION_REASON_OVERAGE_CAP_REACHED,
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
)
from proliferate.db.models.billing import (
    BillingDecisionEvent,
    BillingGrant,
    BillingGrantConsumption,
    BillingOverageRemainder,
    BillingSubject,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
)
from proliferate.utils.time import utcnow


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass(frozen=True)
class BillingAccountingResult:
    billing_subject_id: UUID
    consumed_seconds: float
    export_seconds: float
    export_count: int
    # Uncovered cents the org-month cap refused to bill. Ruled 2026-07-14: this
    # slice is PAUSED, not auto-written-off (write-off stays operator-only), so
    # it never becomes an export row. Law A2 still requires it to be receipted
    # rather than silently dropped, so the pass reports it here and records a
    # durable BillingDecisionEvent even when nothing was exported.
    over_cap_cents: int = 0


@dataclass(frozen=True)
class ClaimedUsageExport:
    id: UUID
    billing_subject_id: UUID
    stripe_customer_id: str | None
    quantity_seconds: float
    meter_quantity_cents: int | None
    idempotency_key: str
    accounted_until: datetime


async def get_or_create_overage_remainder(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    billing_subscription_id: UUID | None,
    period_start: datetime,
) -> BillingOverageRemainder:
    now = utcnow()
    period_start_utc = coerce_utc(period_start) or period_start
    result = await db.execute(
        pg_insert(BillingOverageRemainder)
        .values(
            billing_subject_id=billing_subject_id,
            billing_subscription_id=billing_subscription_id,
            period_start=period_start_utc,
            fractional_cents=0.0,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            constraint="uq_billing_overage_remainder_subject_period",
        )
        .returning(BillingOverageRemainder.id)
    )
    remainder_id = result.scalar_one_or_none()
    if remainder_id is None:
        remainder = (
            await db.execute(
                select(BillingOverageRemainder)
                .where(
                    BillingOverageRemainder.billing_subject_id == billing_subject_id,
                    BillingOverageRemainder.period_start == period_start_utc,
                )
                .with_for_update()
            )
        ).scalar_one()
    else:
        remainder = await db.get(BillingOverageRemainder, remainder_id)
        if remainder is None:
            raise RuntimeError("Billing overage remainder disappeared after creation.")
        await db.refresh(remainder, with_for_update=True)
    return remainder


async def record_grant_consumption(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    billing_grant_id: UUID,
    usage_segment_id: UUID,
    accounted_from: datetime,
    accounted_until: datetime,
    seconds: float,
    source: str,
) -> BillingGrantConsumption:
    consumption = BillingGrantConsumption(
        billing_subject_id=billing_subject_id,
        billing_grant_id=billing_grant_id,
        usage_segment_id=usage_segment_id,
        accounted_from=coerce_utc(accounted_from) or accounted_from,
        accounted_until=coerce_utc(accounted_until) or accounted_until,
        seconds=seconds,
        source=source,
        created_at=utcnow(),
    )
    db.add(consumption)
    await db.flush()
    return consumption


async def upsert_usage_cursor(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    usage_segment_id: UUID,
    accounted_until: datetime,
) -> BillingUsageCursor:
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingUsageCursor)
        .values(
            billing_subject_id=billing_subject_id,
            usage_segment_id=usage_segment_id,
            accounted_until=coerce_utc(accounted_until) or accounted_until,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[BillingUsageCursor.usage_segment_id],
            set_={
                "accounted_until": coerce_utc(accounted_until) or accounted_until,
                "updated_at": now,
            },
        )
        .returning(BillingUsageCursor.id)
    )
    cursor_id = result.scalar_one()
    cursor = await db.get(BillingUsageCursor, cursor_id)
    if cursor is None:
        raise RuntimeError("Billing usage cursor disappeared after upsert.")
    return cursor


async def create_usage_export(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    billing_subscription_id: UUID | None,
    usage_segment_id: UUID,
    period_start: datetime | None,
    period_end: datetime | None,
    accounted_from: datetime,
    accounted_until: datetime,
    quantity_seconds: float,
    meter_quantity_cents: int | None = None,
    cap_cents_snapshot: int | None = None,
    cap_used_cents_snapshot: int | None = None,
    writeoff_reason: str | None = None,
    idempotency_key: str,
    status: str,
) -> BillingUsageExport:
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingUsageExport)
        .values(
            billing_subject_id=billing_subject_id,
            billing_subscription_id=billing_subscription_id,
            usage_segment_id=usage_segment_id,
            period_start=coerce_utc(period_start),
            period_end=coerce_utc(period_end),
            accounted_from=coerce_utc(accounted_from) or accounted_from,
            accounted_until=coerce_utc(accounted_until) or accounted_until,
            quantity_seconds=quantity_seconds,
            meter_quantity_cents=meter_quantity_cents,
            cap_cents_snapshot=cap_cents_snapshot,
            cap_used_cents_snapshot=cap_used_cents_snapshot,
            writeoff_reason=writeoff_reason,
            idempotency_key=idempotency_key,
            stripe_meter_event_identifier=None,
            status=status,
            error=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingUsageExport.idempotency_key])
        .returning(BillingUsageExport.id)
    )
    export_id = result.scalar_one_or_none()
    if export_id is None:
        existing = (
            await db.execute(
                select(BillingUsageExport).where(
                    BillingUsageExport.idempotency_key == idempotency_key
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise RuntimeError("Billing usage export conflicted but no export was found.")
        return existing
    export = await db.get(BillingUsageExport, export_id)
    if export is None:
        raise RuntimeError("Billing usage export disappeared after creation.")
    return export


async def list_billing_subject_ids_for_usage_accounting(
    db: AsyncSession,
    limit: int = 100,
) -> list[UUID]:
    rows = (
        await db.execute(
            select(UsageSegment.billing_subject_id)
            .where(UsageSegment.is_billable.is_(True))
            .distinct()
            .order_by(UsageSegment.billing_subject_id)
            .limit(limit)
        )
    ).scalars()
    return list(rows.all())


async def over_cap_receipt_is_current(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    period_start: datetime | None,
) -> bool:
    """True when this subject's standing over-cap receipt still covers a refusal.

    An *open* usage segment (``ended_at IS NULL``) yields a fresh accountable
    slice on every 15-minute reconcile pass, so a subject parked at the org-month
    cap refuses spend again on every pass. Without this predicate that produced
    one ``overage_cap_reached`` receipt per pass (~96/day) whenever compute did
    not actually stop — observe mode, or a pause that failed — which is noise, not
    attribution.

    A standing receipt is "current" only while nothing has changed the subject's
    cap story:

    * a cap receipt exists, and
    * it belongs to the current billing period (a period rollover resets the cap,
      so the next refusal is a new fact), and
    * no ``billing_usage_export`` row has been written since it — an export means
      a cap raise let a slice through (partial or full), and that new export row
      is the re-arm signal, so a later refusal is a new fact too.

    Re-arm is therefore exactly two things: a new export row, or a period
    rollover. Grant-covered recovery is NOT one of them — a grant refill writes
    no ``billing_usage_export`` row at all, so it never trips this predicate.
    One receipt stands for the whole standing over-cap condition until money
    flows again (an export) or the period rolls; the first refusal is always
    receipted, and so is the first refusal after either re-arm condition.

    ``period_start=None`` means the caller has no subscription period to check
    the receipt against, so the rollover re-arm condition above is
    unverifiable. Fail open to receipting rather than silently skipping that
    check: without a period boundary an arbitrarily old receipt could
    otherwise suppress refusals forever.
    """
    if period_start is None:
        return False
    latest_receipt_at = await db.scalar(
        select(func.max(BillingDecisionEvent.created_at)).where(
            BillingDecisionEvent.billing_subject_id == billing_subject_id,
            BillingDecisionEvent.decision_type == BILLING_DECISION_OVERAGE_EXPORT,
            BillingDecisionEvent.reason == BILLING_DECISION_REASON_OVERAGE_CAP_REACHED,
        )
    )
    receipt_at = coerce_utc(latest_receipt_at)
    if receipt_at is None:
        return False
    period_start_utc = coerce_utc(period_start)
    if period_start_utc is not None and receipt_at < period_start_utc:
        return False
    latest_export_at = coerce_utc(
        await db.scalar(
            select(func.max(BillingUsageExport.created_at)).where(
                BillingUsageExport.billing_subject_id == billing_subject_id,
            )
        )
    )
    return latest_export_at is None or latest_export_at <= receipt_at


async def acquire_billing_subject_accounting_lock(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"billing-accounting:{billing_subject_id}"},
    )


async def list_accountable_usage_ranges(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    scan_until: datetime,
) -> list[tuple[UsageSegment, datetime, datetime]]:
    rows = (
        await db.execute(
            select(UsageSegment, BillingUsageCursor.accounted_until)
            .outerjoin(
                BillingUsageCursor,
                BillingUsageCursor.usage_segment_id == UsageSegment.id,
            )
            .where(
                UsageSegment.billing_subject_id == billing_subject_id,
                UsageSegment.is_billable.is_(True),
                UsageSegment.started_at < scan_until,
            )
            .order_by(UsageSegment.started_at.asc(), UsageSegment.created_at.asc())
        )
    ).all()

    ranges: list[tuple[UsageSegment, datetime, datetime]] = []
    for segment, cursor_accounted_until in rows:
        segment_start = coerce_utc(segment.started_at) or scan_until
        segment_end = min(coerce_utc(segment.ended_at) or scan_until, scan_until)
        accounted_from = max(
            segment_start,
            coerce_utc(cursor_accounted_until) or segment_start,
        )
        if segment_end > accounted_from:
            ranges.append((segment, accounted_from, segment_end))
    return ranges


async def list_grants_for_update(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[BillingGrant]:
    return list(
        (
            await db.execute(
                select(BillingGrant)
                .where(BillingGrant.billing_subject_id == billing_subject_id)
                .order_by(BillingGrant.effective_at.asc(), BillingGrant.created_at.asc())
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )


async def claim_usage_exports_for_sending(
    db: AsyncSession,
    limit: int = 100,
) -> list[ClaimedUsageExport]:
    now = utcnow()
    stale_sending_before = now - timedelta(minutes=5)
    claim_conditions = [
        BillingUsageExport.meter_quantity_cents > 0,
        BillingUsageExport.meter_quantity_cents.is_(None),
    ]
    rows = (
        await db.execute(
            select(BillingUsageExport, BillingSubject.stripe_customer_id)
            .join(
                BillingSubject,
                BillingSubject.id == BillingUsageExport.billing_subject_id,
            )
            .where(
                or_(*claim_conditions),
                or_(
                    BillingUsageExport.status.in_(
                        [
                            BILLING_USAGE_EXPORT_STATUS_PENDING,
                            BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
                        ]
                    ),
                    (BillingUsageExport.status == BILLING_USAGE_EXPORT_STATUS_SENDING)
                    & (BillingUsageExport.updated_at < stale_sending_before),
                ),
            )
            .order_by(BillingUsageExport.created_at.asc())
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).all()
    claimed: list[ClaimedUsageExport] = []
    for export, stripe_customer_id in rows:
        export.status = BILLING_USAGE_EXPORT_STATUS_SENDING
        export.error = None
        export.updated_at = now
        claimed.append(
            ClaimedUsageExport(
                id=export.id,
                billing_subject_id=export.billing_subject_id,
                stripe_customer_id=stripe_customer_id,
                quantity_seconds=export.quantity_seconds,
                meter_quantity_cents=export.meter_quantity_cents,
                idempotency_key=export.idempotency_key,
                accounted_until=export.accounted_until,
            )
        )
    await db.flush()
    return claimed


async def mark_usage_export_succeeded(
    db: AsyncSession,
    *,
    export_id: UUID,
    stripe_meter_event_identifier: str,
) -> None:
    export = await db.get(BillingUsageExport, export_id)
    if export is not None:
        export.status = BILLING_USAGE_EXPORT_STATUS_SUCCEEDED
        export.stripe_meter_event_identifier = stripe_meter_event_identifier
        export.error = None
        export.updated_at = utcnow()
    await db.flush()


async def mark_usage_export_failed(
    db: AsyncSession,
    *,
    export_id: UUID,
    terminal: bool,
    error: str,
) -> None:
    export = await db.get(BillingUsageExport, export_id)
    if export is not None:
        export.status = (
            BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL
            if terminal
            else BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE
        )
        export.error = error[:4000]
        export.updated_at = utcnow()
    await db.flush()


async def count_grants_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    grant_type: str,
) -> int:
    """How many grants of one type this subject already holds.

    Used to give refill checkout an idempotency key that advances after each
    completed purchase, so a double-click still dedupes while a genuine second
    purchase gets a fresh Stripe session instead of the spent one.
    """
    return int(
        await db.scalar(
            select(func.count())
            .select_from(BillingGrant)
            .where(
                BillingGrant.billing_subject_id == billing_subject_id,
                BillingGrant.grant_type == grant_type,
            )
        )
        or 0
    )
