"""Billing persistence layer."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import TypeVar
from uuid import UUID

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_RECONCILER_LOCK_KEY,
    BILLING_SUBJECT_KIND_PERSONAL,
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    FREE_INCLUDED_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
    USAGE_SEGMENT_RECENT_LOOKBACK_DAYS,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import (
    BillingDecisionEvent,
    BillingEntitlement,
    BillingGrant,
    BillingGrantConsumption,
    BillingHold,
    BillingSubject,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
    WebhookEventReceipt,
)
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.server.billing.models import coerce_utc, utcnow

T = TypeVar("T")


@dataclass(frozen=True)
class BillingSnapshotState:
    subject: BillingSubject
    billing_subject_id: UUID
    sandboxes: list[CloudSandbox]
    grants: list[BillingGrant]
    entitlements: list[BillingEntitlement]
    holds: list[BillingHold]
    subscriptions: list[BillingSubscription]
    usage_segments: list[UsageSegment]
    unaccounted_billable_seconds: float = 0.0
    historical_billable_seconds: float = 0.0


@dataclass(frozen=True)
class BillingAccountingResult:
    billing_subject_id: UUID
    consumed_seconds: float
    export_seconds: float
    export_count: int


@dataclass(frozen=True)
class ClaimedUsageExport:
    id: UUID
    billing_subject_id: UUID
    stripe_customer_id: str | None
    quantity_seconds: float
    idempotency_key: str
    accounted_until: datetime


class _GrantKind(StrEnum):
    FREE = FREE_INCLUDED_GRANT_TYPE
    MONTHLY = MONTHLY_CLOUD_GRANT_TYPE
    REFILL = REFILL_10H_GRANT_TYPE


async def ensure_personal_billing_subject(db: AsyncSession, user_id: UUID) -> BillingSubject:
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingSubject)
        .values(
            kind=BILLING_SUBJECT_KIND_PERSONAL,
            user_id=user_id,
            organization_id=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingSubject.user_id])
        .returning(BillingSubject.id)
    )
    subject_id = result.scalar_one_or_none()
    if subject_id is None:
        subject = (
            await db.execute(
                select(BillingSubject).where(
                    BillingSubject.kind == BILLING_SUBJECT_KIND_PERSONAL,
                    BillingSubject.user_id == user_id,
                )
            )
        ).scalar_one()
    else:
        subject = await db.get(BillingSubject, subject_id)
        if subject is None:
            raise RuntimeError("Billing subject disappeared after creation.")
    return subject


async def ensure_free_included_grant(db: AsyncSession, user_id: UUID) -> bool:
    subject = await ensure_personal_billing_subject(db, user_id)
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingGrant)
        .values(
            user_id=user_id,
            billing_subject_id=subject.id,
            grant_type=FREE_INCLUDED_GRANT_TYPE,
            hours_granted=settings.cloud_free_sandbox_hours,
            remaining_seconds=max(settings.cloud_free_sandbox_hours * 3600.0, 0.0),
            effective_at=now,
            expires_at=None,
            source_ref=f"{FREE_INCLUDED_GRANT_TYPE}:{user_id}",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingGrant.source_ref])
    )
    return (result.rowcount or 0) > 0


async def list_cloud_sandboxes_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[CloudSandbox]:
    return list(
        (
            await db.execute(
                select(CloudSandbox)
                .join(CloudWorkspace, CloudSandbox.cloud_workspace_id == CloudWorkspace.id)
                .where(CloudWorkspace.billing_subject_id == billing_subject_id)
            )
        )
        .scalars()
        .all()
    )


async def list_grants(db: AsyncSession, billing_subject_id: UUID) -> list[BillingGrant]:
    return list(
        (
            await db.execute(
                select(BillingGrant)
                .where(BillingGrant.billing_subject_id == billing_subject_id)
                .order_by(BillingGrant.effective_at.asc(), BillingGrant.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_entitlements(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[BillingEntitlement]:
    return list(
        (
            await db.execute(
                select(BillingEntitlement)
                .where(BillingEntitlement.billing_subject_id == billing_subject_id)
                .order_by(
                    BillingEntitlement.effective_at.asc(),
                    BillingEntitlement.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )


async def list_active_holds(db: AsyncSession, billing_subject_id: UUID) -> list[BillingHold]:
    return list(
        (
            await db.execute(
                select(BillingHold)
                .where(
                    BillingHold.billing_subject_id == billing_subject_id,
                    BillingHold.status == BILLING_HOLD_STATUS_ACTIVE,
                )
                .order_by(BillingHold.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_subscriptions(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[BillingSubscription]:
    return list(
        (
            await db.execute(
                select(BillingSubscription)
                .where(BillingSubscription.billing_subject_id == billing_subject_id)
                .order_by(
                    BillingSubscription.current_period_end.desc().nullslast(),
                    BillingSubscription.updated_at.desc(),
                )
            )
        )
        .scalars()
        .all()
    )


async def get_billing_subject_by_stripe_customer(
    db: AsyncSession,
    stripe_customer_id: str,
) -> BillingSubject | None:
    return (
        await db.execute(
            select(BillingSubject).where(BillingSubject.stripe_customer_id == stripe_customer_id)
        )
    ).scalar_one_or_none()


async def set_billing_subject_stripe_customer(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    stripe_customer_id: str,
) -> BillingSubject:
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    subject.stripe_customer_id = stripe_customer_id
    subject.updated_at = utcnow()
    await db.flush()
    return subject


async def set_billing_subject_overage_enabled(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    overage_enabled: bool,
) -> BillingSubject:
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    subject.overage_enabled = overage_enabled
    subject.updated_at = utcnow()
    await db.flush()
    return subject


async def upsert_billing_subscription(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    stripe_subscription_id: str,
    stripe_customer_id: str,
    status: str,
    cancel_at_period_end: bool,
    canceled_at: datetime | None,
    current_period_start: datetime | None,
    current_period_end: datetime | None,
    cloud_monthly_price_id: str | None,
    overage_price_id: str | None,
    monthly_subscription_item_id: str | None,
    metered_subscription_item_id: str | None,
    latest_invoice_id: str | None,
    latest_invoice_status: str | None,
    hosted_invoice_url: str | None,
) -> BillingSubscription:
    now = utcnow()
    values = {
        "billing_subject_id": billing_subject_id,
        "stripe_subscription_id": stripe_subscription_id,
        "stripe_customer_id": stripe_customer_id,
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": coerce_utc(canceled_at),
        "current_period_start": coerce_utc(current_period_start),
        "current_period_end": coerce_utc(current_period_end),
        "cloud_monthly_price_id": cloud_monthly_price_id,
        "overage_price_id": overage_price_id,
        "monthly_subscription_item_id": monthly_subscription_item_id,
        "metered_subscription_item_id": metered_subscription_item_id,
        "latest_invoice_id": latest_invoice_id,
        "latest_invoice_status": latest_invoice_status,
        "hosted_invoice_url": hosted_invoice_url,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.execute(
        pg_insert(BillingSubscription)
        .values(**values)
        .on_conflict_do_update(
            index_elements=[BillingSubscription.stripe_subscription_id],
            set_={
                key: value
                for key, value in values.items()
                if key not in {"stripe_subscription_id", "created_at"}
            }
            | {"updated_at": now},
        )
        .returning(BillingSubscription.id)
    )
    subscription_id = result.scalar_one()
    subscription = await db.get(BillingSubscription, subscription_id)
    if subscription is None:
        raise RuntimeError("Billing subscription disappeared after upsert.")
    return subscription


async def ensure_billing_grant(
    db: AsyncSession,
    *,
    user_id: UUID,
    billing_subject_id: UUID,
    grant_type: str,
    hours_granted: float,
    effective_at: datetime,
    expires_at: datetime | None,
    source_ref: str,
) -> BillingGrant:
    now = utcnow()
    remaining_seconds = max(hours_granted * 3600.0, 0.0)
    result = await db.execute(
        pg_insert(BillingGrant)
        .values(
            user_id=user_id,
            billing_subject_id=billing_subject_id,
            grant_type=grant_type,
            hours_granted=hours_granted,
            remaining_seconds=remaining_seconds,
            effective_at=coerce_utc(effective_at) or now,
            expires_at=coerce_utc(expires_at),
            source_ref=source_ref,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingGrant.source_ref])
        .returning(BillingGrant.id)
    )
    grant_id = result.scalar_one_or_none()
    if grant_id is None:
        existing = (
            await db.execute(select(BillingGrant).where(BillingGrant.source_ref == source_ref))
        ).scalar_one_or_none()
        if existing is None:
            raise RuntimeError("Billing grant insert conflicted but no grant was found.")
        return existing
    grant = await db.get(BillingGrant, grant_id)
    if grant is None:
        raise RuntimeError("Billing grant disappeared after creation.")
    return grant


async def list_usage_segments(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    window_started_at: datetime | None = None,
) -> list[UsageSegment]:
    conditions = [
        UsageSegment.billing_subject_id == billing_subject_id,
        UsageSegment.is_billable.is_(True),
    ]
    if window_started_at is not None:
        recent_cutoff = coerce_utc(window_started_at) or window_started_at
        conditions.append(
            or_(
                UsageSegment.started_at >= recent_cutoff,
                UsageSegment.ended_at.is_(None),
                UsageSegment.ended_at >= recent_cutoff,
            )
        )
    return list(
        (
            await db.execute(
                select(UsageSegment)
                .where(*conditions)
                .order_by(UsageSegment.started_at.asc(), UsageSegment.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def sum_billable_usage_seconds_before(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    window_started_at: datetime,
) -> float:
    recent_cutoff = coerce_utc(window_started_at) or window_started_at
    result = await db.scalar(
        select(
            func.coalesce(
                func.sum(func.extract("epoch", UsageSegment.ended_at - UsageSegment.started_at)),
                0.0,
            )
        ).where(
            UsageSegment.billing_subject_id == billing_subject_id,
            UsageSegment.is_billable.is_(True),
            UsageSegment.ended_at.is_not(None),
            UsageSegment.started_at < recent_cutoff,
            UsageSegment.ended_at < recent_cutoff,
        )
    )
    return float(result or 0.0)


async def estimate_unaccounted_billable_seconds(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    now: datetime,
) -> float:
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
            )
        )
    ).all()
    total = 0.0
    current_time = coerce_utc(now) or now
    for segment, cursor_accounted_until in rows:
        segment_end = coerce_utc(segment.ended_at) or current_time
        accounted_from = max(
            coerce_utc(segment.started_at) or current_time,
            coerce_utc(cursor_accounted_until) or (coerce_utc(segment.started_at) or current_time),
        )
        if segment_end > accounted_from:
            total += (segment_end - accounted_from).total_seconds()
    return max(total, 0.0)


async def get_open_usage_segment(
    db: AsyncSession,
    sandbox_id: UUID,
) -> UsageSegment | None:
    return (
        await db.execute(
            select(UsageSegment).where(
                UsageSegment.sandbox_id == sandbox_id,
                UsageSegment.ended_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def _get_workspace_billing_subject(
    db: AsyncSession,
    workspace_id: UUID,
) -> tuple[UUID, UUID]:
    workspace = await db.get(CloudWorkspace, workspace_id)
    if workspace is None:
        raise RuntimeError("Cloud workspace not found while opening usage segment.")
    return workspace.billing_subject_id, workspace.user_id


async def resolve_billing_subject_id_for_workspace(workspace_id: UUID) -> UUID:
    async with db_engine.async_session_factory() as db:
        billing_subject_id, _owner_user_id = await _get_workspace_billing_subject(
            db,
            workspace_id,
        )
        return billing_subject_id


async def create_usage_segment(
    db: AsyncSession,
    *,
    user_id: UUID,
    billing_subject_id: UUID,
    workspace_id: UUID,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    is_billable: bool = True,
) -> UsageSegment:
    now = utcnow()
    result = await db.execute(
        pg_insert(UsageSegment)
        .values(
            user_id=user_id,
            billing_subject_id=billing_subject_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=coerce_utc(started_at) or now,
            ended_at=None,
            is_billable=is_billable,
            opened_by=opened_by,
            closed_by=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[UsageSegment.sandbox_id],
            index_where=UsageSegment.ended_at.is_(None),
        )
        .returning(UsageSegment.id)
    )
    segment_id = result.scalar_one_or_none()
    if segment_id is not None:
        segment = await db.get(UsageSegment, segment_id)
        if segment is None:
            raise RuntimeError("Usage segment disappeared after creation.")
        return segment

    existing = await get_open_usage_segment(db, sandbox_id)
    if existing is None:
        raise RuntimeError("Usage segment insert conflicted but no open segment was found.")
    return existing


async def close_usage_segment(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
) -> UsageSegment | None:
    segment = await get_open_usage_segment(db, sandbox_id)
    if segment is None:
        return None

    segment.ended_at = coerce_utc(ended_at) or utcnow()
    segment.closed_by = closed_by
    segment.updated_at = utcnow()
    await db.flush()
    return segment


async def mark_usage_segment_non_billable(
    db: AsyncSession,
    *,
    segment_id: UUID,
    reason: str,
) -> UsageSegment:
    segment = await db.get(UsageSegment, segment_id)
    if segment is None:
        raise RuntimeError("Usage segment not found.")
    segment.is_billable = False
    segment.closed_by = reason
    segment.updated_at = utcnow()
    await db.flush()
    return segment


async def list_open_usage_segments(db: AsyncSession) -> list[UsageSegment]:
    return list(
        (await db.execute(select(UsageSegment).where(UsageSegment.ended_at.is_(None))))
        .scalars()
        .all()
    )


async def record_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    result = await db.execute(
        pg_insert(WebhookEventReceipt)
        .values(
            event_id=event_id,
            provider=provider,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
            status="processed",
            attempt_count=1,
            received_at=utcnow(),
            processed_at=utcnow(),
            updated_at=utcnow(),
        )
        .on_conflict_do_nothing(
            index_elements=[WebhookEventReceipt.provider, WebhookEventReceipt.event_id],
        )
    )
    return (result.rowcount or 0) > 0


async def claim_webhook_event_receipt(
    db: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    external_sandbox_id: str | None = None,
    lease_seconds: int = 300,
) -> WebhookEventReceipt | None:
    now = utcnow()
    lease_expires_at = now + timedelta(seconds=lease_seconds)
    result = await db.execute(
        pg_insert(WebhookEventReceipt)
        .values(
            provider=provider,
            event_id=event_id,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
            status="processing",
            attempt_count=1,
            processing_lease_expires_at=lease_expires_at,
            last_error=None,
            received_at=now,
            processed_at=None,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[WebhookEventReceipt.provider, WebhookEventReceipt.event_id],
            set_={
                "event_type": event_type,
                "external_sandbox_id": external_sandbox_id,
                "status": "processing",
                "attempt_count": WebhookEventReceipt.attempt_count + 1,
                "processing_lease_expires_at": lease_expires_at,
                "last_error": None,
                "updated_at": now,
            },
            where=or_(
                WebhookEventReceipt.status != "processed",
                WebhookEventReceipt.processing_lease_expires_at.is_(None),
                WebhookEventReceipt.processing_lease_expires_at < now,
            ),
        )
        .returning(WebhookEventReceipt.id)
    )
    receipt_id = result.scalar_one_or_none()
    if receipt_id is None:
        return None
    receipt = await db.get(WebhookEventReceipt, receipt_id)
    if receipt is None:
        raise RuntimeError("Webhook receipt disappeared after claim.")
    return receipt


async def mark_webhook_event_processed(
    db: AsyncSession,
    *,
    receipt_id: UUID,
) -> WebhookEventReceipt:
    receipt = await db.get(WebhookEventReceipt, receipt_id)
    if receipt is None:
        raise RuntimeError("Webhook receipt not found.")
    receipt.status = "processed"
    receipt.processing_lease_expires_at = None
    receipt.last_error = None
    receipt.processed_at = utcnow()
    receipt.updated_at = utcnow()
    await db.flush()
    return receipt


async def mark_webhook_event_failed(
    db: AsyncSession,
    *,
    receipt_id: UUID,
    error: str,
) -> WebhookEventReceipt:
    receipt = await db.get(WebhookEventReceipt, receipt_id)
    if receipt is None:
        raise RuntimeError("Webhook receipt not found.")
    receipt.status = "failed"
    receipt.processing_lease_expires_at = None
    receipt.last_error = error[:4000]
    receipt.updated_at = utcnow()
    await db.flush()
    return receipt


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


async def list_billing_subject_ids_for_usage_accounting(limit: int = 100) -> list[UUID]:
    async with db_engine.async_session_factory() as db:
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


async def _acquire_billing_subject_accounting_lock(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"billing-accounting:{billing_subject_id}"},
    )


def _grant_boundary_after(start: datetime, end: datetime, grant: BillingGrant) -> datetime | None:
    effective_at = coerce_utc(grant.effective_at)
    expires_at = coerce_utc(grant.expires_at)
    if effective_at is not None and start < effective_at < end:
        return effective_at
    if expires_at is not None and start < expires_at < end:
        return expires_at
    return None


def _next_accounting_boundary(
    start: datetime,
    end: datetime,
    grants: list[BillingGrant],
    extra_boundaries: tuple[datetime, ...] = (),
) -> datetime:
    boundary = end
    for grant in grants:
        grant_boundary = _grant_boundary_after(start, end, grant)
        if grant_boundary is not None and grant_boundary < boundary:
            boundary = grant_boundary
    for extra_boundary in extra_boundaries:
        if start < extra_boundary < boundary:
            boundary = extra_boundary
    return boundary


def _grant_is_usable_for_accounting(grant: BillingGrant, at: datetime) -> bool:
    if grant.remaining_seconds <= 0:
        return False
    effective_at = coerce_utc(grant.effective_at) or at
    expires_at = coerce_utc(grant.expires_at)
    return effective_at <= at and (expires_at is None or expires_at > at)


def _ordered_accounting_grants(
    grants: list[BillingGrant],
    *,
    is_paid_cloud: bool,
    at: datetime,
) -> list[BillingGrant]:
    if is_paid_cloud:
        grant_type_order = {
            _GrantKind.MONTHLY: 0,
            _GrantKind.FREE: 1,
            _GrantKind.REFILL: 2,
        }
    else:
        grant_type_order = {
            _GrantKind.FREE: 0,
            _GrantKind.REFILL: 1,
        }

    eligible = [
        grant
        for grant in grants
        if grant.grant_type in grant_type_order and _grant_is_usable_for_accounting(grant, at)
    ]
    return sorted(
        eligible,
        key=lambda grant: (
            grant_type_order[_GrantKind(grant.grant_type)],
            coerce_utc(grant.expires_at) or datetime.max.replace(tzinfo=at.tzinfo),
            coerce_utc(grant.effective_at) or datetime.min.replace(tzinfo=at.tzinfo),
            grant.created_at,
        ),
    )


def _usage_export_idempotency_key(
    *,
    billing_subject_id: UUID,
    usage_segment_id: UUID,
    accounted_from: datetime,
    accounted_until: datetime,
) -> str:
    return (
        f"stripe:usage:{billing_subject_id}:{usage_segment_id}:"
        f"{accounted_from.isoformat()}:{accounted_until.isoformat()}"
    )


async def _list_accountable_usage_ranges(
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


async def account_usage_for_billing_subject(
    *,
    billing_subject_id: UUID,
    is_paid_cloud: bool,
    billing_subscription_id: UUID | None,
    period_start: datetime | None,
    period_end: datetime | None,
    overage_enabled: bool,
    billing_mode: str,
    scan_until: datetime | None = None,
) -> BillingAccountingResult:
    if billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return BillingAccountingResult(
            billing_subject_id=billing_subject_id,
            consumed_seconds=0.0,
            export_seconds=0.0,
            export_count=0,
        )

    now = utcnow()
    effective_scan_until = coerce_utc(scan_until) or now
    period_start_utc = coerce_utc(period_start)
    period_end_utc = coerce_utc(period_end)
    if is_paid_cloud and period_end_utc is not None:
        effective_scan_until = min(effective_scan_until, period_end_utc)
    if effective_scan_until > now:
        effective_scan_until = now

    async with db_engine.async_session_factory() as db:
        await _acquire_billing_subject_accounting_lock(db, billing_subject_id)
        subject = await db.get(BillingSubject, billing_subject_id)
        if subject is None:
            await db.commit()
            return BillingAccountingResult(
                billing_subject_id=billing_subject_id,
                consumed_seconds=0.0,
                export_seconds=0.0,
                export_count=0,
            )

        grants = list(
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
        usage_ranges = await _list_accountable_usage_ranges(
            db,
            billing_subject_id=billing_subject_id,
            scan_until=effective_scan_until,
        )

        consumed_seconds = 0.0
        export_seconds = 0.0
        export_count = 0
        export_status = (
            BILLING_USAGE_EXPORT_STATUS_OBSERVED
            if billing_mode == BILLING_MODE_OBSERVE
            else BILLING_USAGE_EXPORT_STATUS_PENDING
        )
        can_export_overage = is_paid_cloud and overage_enabled
        accounting_boundaries = (
            (period_start_utc,) if is_paid_cloud and period_start_utc is not None else ()
        )

        for segment, range_start, range_end in usage_ranges:
            accounted_from = range_start
            while accounted_from < range_end:
                accounted_until = _next_accounting_boundary(
                    accounted_from,
                    range_end,
                    grants,
                    accounting_boundaries,
                )
                seconds = max((accounted_until - accounted_from).total_seconds(), 0.0)
                if seconds <= 0:
                    break

                uncovered_seconds = seconds
                for grant in _ordered_accounting_grants(
                    grants,
                    is_paid_cloud=is_paid_cloud,
                    at=accounted_from,
                ):
                    consumed = min(float(grant.remaining_seconds), uncovered_seconds)
                    if consumed <= 0:
                        continue
                    grant.remaining_seconds = max(float(grant.remaining_seconds) - consumed, 0.0)
                    grant.updated_at = now
                    db.add(
                        BillingGrantConsumption(
                            billing_subject_id=billing_subject_id,
                            billing_grant_id=grant.id,
                            usage_segment_id=segment.id,
                            accounted_from=accounted_from,
                            accounted_until=accounted_until,
                            seconds=consumed,
                            source="usage_accounting",
                            created_at=now,
                        )
                    )
                    consumed_seconds += consumed
                    uncovered_seconds -= consumed
                    if uncovered_seconds <= 0:
                        break

                slice_is_in_paid_period = (
                    period_start_utc is None or accounted_from >= period_start_utc
                )
                if uncovered_seconds > 0 and can_export_overage and slice_is_in_paid_period:
                    await create_usage_export(
                        db,
                        billing_subject_id=billing_subject_id,
                        billing_subscription_id=billing_subscription_id,
                        usage_segment_id=segment.id,
                        period_start=period_start,
                        period_end=period_end,
                        accounted_from=accounted_from,
                        accounted_until=accounted_until,
                        quantity_seconds=uncovered_seconds,
                        idempotency_key=_usage_export_idempotency_key(
                            billing_subject_id=billing_subject_id,
                            usage_segment_id=segment.id,
                            accounted_from=accounted_from,
                            accounted_until=accounted_until,
                        ),
                        status=export_status,
                    )
                    export_seconds += uncovered_seconds
                    export_count += 1

                await upsert_usage_cursor(
                    db,
                    billing_subject_id=billing_subject_id,
                    usage_segment_id=segment.id,
                    accounted_until=accounted_until,
                )
                accounted_from = accounted_until

        await db.commit()
        return BillingAccountingResult(
            billing_subject_id=billing_subject_id,
            consumed_seconds=consumed_seconds,
            export_seconds=export_seconds,
            export_count=export_count,
        )


async def claim_usage_exports_for_sending(limit: int = 100) -> list[ClaimedUsageExport]:
    async with db_engine.async_session_factory() as db:
        now = utcnow()
        stale_sending_before = now - timedelta(minutes=5)
        rows = (
            await db.execute(
                select(BillingUsageExport, BillingSubject.stripe_customer_id)
                .join(
                    BillingSubject,
                    BillingSubject.id == BillingUsageExport.billing_subject_id,
                )
                .where(
                    or_(
                        BillingUsageExport.status.in_(
                            [
                                BILLING_USAGE_EXPORT_STATUS_PENDING,
                                BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
                            ]
                        ),
                        (BillingUsageExport.status == BILLING_USAGE_EXPORT_STATUS_SENDING)
                        & (BillingUsageExport.updated_at < stale_sending_before),
                    )
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
                    idempotency_key=export.idempotency_key,
                    accounted_until=export.accounted_until,
                )
            )
        await db.commit()
        return claimed


async def mark_usage_export_succeeded(
    *,
    export_id: UUID,
    stripe_meter_event_identifier: str,
) -> None:
    async with db_engine.async_session_factory() as db:
        export = await db.get(BillingUsageExport, export_id)
        if export is not None:
            export.status = BILLING_USAGE_EXPORT_STATUS_SUCCEEDED
            export.stripe_meter_event_identifier = stripe_meter_event_identifier
            export.error = None
            export.updated_at = utcnow()
        await db.commit()


async def mark_usage_export_failed(
    *,
    export_id: UUID,
    terminal: bool,
    error: str,
) -> None:
    async with db_engine.async_session_factory() as db:
        export = await db.get(BillingUsageExport, export_id)
        if export is not None:
            export.status = (
                BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL
                if terminal
                else BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE
            )
            export.error = error[:4000]
            export.updated_at = utcnow()
        await db.commit()


async def ensure_sandbox_usage_started(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    sandbox_id: UUID,
    actor_user_id: UUID | None,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    observed_at: datetime,
    source: str,
    event_id: str,
    is_billable: bool,
) -> UsageSegment:
    await record_sandbox_event_receipt(
        db,
        event_id=f"usage:{event_id}",
        provider="proliferate_usage",
        event_type=source,
        external_sandbox_id=external_sandbox_id,
    )
    billing_subject_id, owner_user_id = await _get_workspace_billing_subject(db, workspace_id)
    return await create_usage_segment(
        db,
        user_id=actor_user_id or owner_user_id,
        billing_subject_id=billing_subject_id,
        workspace_id=workspace_id,
        sandbox_id=sandbox_id,
        external_sandbox_id=external_sandbox_id,
        sandbox_execution_id=sandbox_execution_id,
        started_at=observed_at,
        opened_by=source,
        is_billable=is_billable,
    )


async def ensure_sandbox_usage_stopped(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    observed_at: datetime,
    source: str,
    event_id: str,
    reason: str,
) -> UsageSegment | None:
    await record_sandbox_event_receipt(
        db,
        event_id=f"usage:{event_id}",
        provider="proliferate_usage",
        event_type=source,
        external_sandbox_id=None,
    )
    return await close_usage_segment(
        db,
        sandbox_id=sandbox_id,
        ended_at=observed_at,
        closed_by=reason,
    )


async def try_acquire_billing_reconciler_lock(db: AsyncSession) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": BILLING_RECONCILER_LOCK_KEY},
    )
    return bool(result)


async def release_billing_reconciler_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(:lock_key)"),
        {"lock_key": BILLING_RECONCILER_LOCK_KEY},
    )


async def _build_billing_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    now = utcnow()
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    recent_window_started_at = now - timedelta(days=USAGE_SEGMENT_RECENT_LOOKBACK_DAYS)
    grants = await list_grants(db, billing_subject_id)
    entitlements = await list_entitlements(db, billing_subject_id)
    return BillingSnapshotState(
        subject=subject,
        billing_subject_id=billing_subject_id,
        sandboxes=await list_cloud_sandboxes_for_subject(db, billing_subject_id),
        grants=grants,
        entitlements=entitlements,
        holds=await list_active_holds(db, billing_subject_id),
        subscriptions=await list_subscriptions(db, billing_subject_id),
        usage_segments=await list_usage_segments(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
        unaccounted_billable_seconds=await estimate_unaccounted_billable_seconds(
            db,
            billing_subject_id,
            now=now,
        ),
        historical_billable_seconds=await sum_billable_usage_seconds_before(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
    )


async def load_billing_snapshot_state(user_id: UUID) -> BillingSnapshotState:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, user_id)
        await ensure_free_included_grant(db, user_id)
        await db.commit()
        return await _build_billing_snapshot_state_for_subject(db, subject.id)


async def load_billing_snapshot_state_for_subject(
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    async with db_engine.async_session_factory() as db:
        subject = await db.get(BillingSubject, billing_subject_id)
        if subject is None:
            raise RuntimeError("Billing subject not found.")
        if subject.kind == BILLING_SUBJECT_KIND_PERSONAL and subject.user_id is not None:
            await ensure_free_included_grant(db, subject.user_id)
            await db.commit()
        return await _build_billing_snapshot_state_for_subject(db, billing_subject_id)


async def open_usage_segment_for_sandbox(
    *,
    workspace_id: UUID,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    user_id: UUID | None = None,
    is_billable: bool = True,
    event_id: str | None = None,
) -> UsageSegment:
    async with db_engine.async_session_factory() as db:
        segment = await ensure_sandbox_usage_started(
            db,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            actor_user_id=user_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            observed_at=started_at,
            source=opened_by,
            event_id=event_id or f"usage-start:{opened_by}:{sandbox_id}:{started_at.isoformat()}",
            is_billable=is_billable,
        )
        await db.commit()
        await db.refresh(segment)
        return segment


async def close_usage_segment_for_sandbox(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> UsageSegment | None:
    async with db_engine.async_session_factory() as db:
        segment = await ensure_sandbox_usage_stopped(
            db,
            sandbox_id=sandbox_id,
            observed_at=ended_at,
            source=closed_by,
            event_id=event_id or f"usage-stop:{closed_by}:{sandbox_id}:{ended_at.isoformat()}",
            reason=closed_by,
        )
        if segment is not None and is_billable is False:
            segment = await mark_usage_segment_non_billable(
                db,
                segment_id=segment.id,
                reason=closed_by,
            )
        await db.commit()
        if segment is None:
            return None
        await db.refresh(segment)
        return segment


async def list_all_open_usage_segments() -> list[UsageSegment]:
    async with db_engine.async_session_factory() as db:
        return await list_open_usage_segments(db)


async def remember_sandbox_event_receipt(
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    async with db_engine.async_session_factory() as db:
        created = await record_sandbox_event_receipt(
            db,
            event_id=event_id,
            provider=provider,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
        )
        await db.commit()
        return created


async def record_billing_decision_event(
    *,
    billing_subject_id: UUID,
    actor_user_id: UUID | None,
    workspace_id: UUID | None,
    decision_type: str,
    mode: str,
    would_block_start: bool,
    would_pause_active: bool,
    reason: str | None,
    active_sandbox_count: int,
    remaining_seconds: float | None,
) -> None:
    async with db_engine.async_session_factory() as db:
        db.add(
            BillingDecisionEvent(
                billing_subject_id=billing_subject_id,
                actor_user_id=actor_user_id,
                workspace_id=workspace_id,
                decision_type=decision_type,
                mode=mode,
                would_block_start=would_block_start,
                would_pause_active=would_pause_active,
                reason=reason,
                active_sandbox_count=active_sandbox_count,
                remaining_seconds=remaining_seconds,
                created_at=utcnow(),
            )
        )
        await db.commit()


async def with_billing_reconciler_lock[T](
    callback: Callable[[AsyncSession], Awaitable[T]],
) -> tuple[bool, T | None]:
    async with db_engine.async_session_factory() as db:
        acquired = await try_acquire_billing_reconciler_lock(db)
        if not acquired:
            return False, None
        try:
            result = await callback(db)
            await db.commit()
            return True, result
        finally:
            await release_billing_reconciler_lock(db)
