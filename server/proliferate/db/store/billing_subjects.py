"""Billing subject, grant, and customer-state persistence helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_SUBJECT_KIND_ORGANIZATION,
    BILLING_SUBJECT_KIND_PERSONAL,
    FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
    FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL,
    FREE_CLOUD_ALLOCATION_PERIOD_V2,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    PRO_FREE_TRIAL_HOURS,
)
from proliferate.db.models.auth import AuthIdentity
from proliferate.db.models.billing import (
    BillingGrant,
    BillingSubject,
    FreeCloudAllocation,
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
class BillingSubjectStripeState:
    billing_subject_id: UUID
    kind: str
    user_id: UUID | None
    organization_id: UUID | None
    stripe_customer_id: str | None


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


async def ensure_organization_billing_subject(
    db: AsyncSession,
    organization_id: UUID,
) -> BillingSubject:
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingSubject)
        .values(
            kind=BILLING_SUBJECT_KIND_ORGANIZATION,
            user_id=None,
            organization_id=organization_id,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[BillingSubject.organization_id],
            index_where=(
                (BillingSubject.kind == BILLING_SUBJECT_KIND_ORGANIZATION)
                & BillingSubject.organization_id.is_not(None)
            ),
        )
        .returning(BillingSubject.id)
    )
    subject_id = result.scalar_one_or_none()
    if subject_id is None:
        subject = (
            await db.execute(
                select(BillingSubject).where(
                    BillingSubject.kind == BILLING_SUBJECT_KIND_ORGANIZATION,
                    BillingSubject.organization_id == organization_id,
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


async def ensure_free_trial_v2_grant(db: AsyncSession, subject: BillingSubject) -> bool:
    if subject.kind != BILLING_SUBJECT_KIND_PERSONAL or subject.user_id is None:
        return False
    github_provider_user_id = await _linked_github_provider_user_id(db, subject.user_id)
    if github_provider_user_id is None:
        return False
    if not await _ensure_free_trial_allocation(
        db,
        subject=subject,
        github_provider_user_id=github_provider_user_id,
    ):
        return False
    now = utcnow()
    used_seconds = await sum_all_time_billable_usage_seconds(db, subject.id, now=now)
    remaining_seconds = max(PRO_FREE_TRIAL_HOURS * 3600.0 - used_seconds, 0.0)
    old_grants = (
        await db.execute(
            select(BillingGrant)
            .where(
                BillingGrant.billing_subject_id == subject.id,
                BillingGrant.grant_type == FREE_INCLUDED_GRANT_TYPE,
                BillingGrant.expires_at.is_(None),
            )
            .with_for_update()
        )
    ).scalars()
    for grant in old_grants.all():
        grant.expires_at = now
        grant.remaining_seconds = 0.0
        grant.updated_at = now
    result = await db.execute(
        pg_insert(BillingGrant)
        .values(
            user_id=subject.user_id,
            billing_subject_id=subject.id,
            grant_type=FREE_TRIAL_V2_GRANT_TYPE,
            hours_granted=remaining_seconds / 3600.0,
            remaining_seconds=remaining_seconds,
            effective_at=now,
            expires_at=None,
            source_ref=f"{FREE_TRIAL_V2_GRANT_TYPE}:{subject.id}",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingGrant.source_ref])
        .returning(BillingGrant.id)
    )
    grant_id = result.scalar_one_or_none()
    if grant_id is not None:
        allocation = await _load_free_trial_allocation_for_subject(db, subject)
        if allocation is not None and allocation.issued_billing_grant_id is None:
            allocation.issued_billing_grant_id = grant_id
            allocation.updated_at = now
            await db.flush()
        return True
    return False


async def ensure_agent_gateway_free_credit_allocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    period_key: str,
) -> bool:
    """Reserve the one-time agent-gateway free-credit allocation for a user.

    Deduped through ``free_cloud_allocation`` on (allocation_kind, github
    identity, period_key) — the same anti-abuse guard the compute free trial
    uses. Returns True only when this call owns the allocation (either it
    created the row, or an existing row already belongs to this subject), so
    the caller can grant credits exactly once per GitHub identity. Returns
    False when the user has no linked GitHub identity or the allocation
    belongs to a different subject.
    """
    github_provider_user_id = await _linked_github_provider_user_id(db, user_id)
    if github_provider_user_id is None:
        return False
    subject = await ensure_personal_billing_subject(db, user_id)
    return await _ensure_free_cloud_allocation(
        db,
        allocation_kind=FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
        subject=subject,
        github_provider_user_id=github_provider_user_id,
        period_key=period_key,
    )


async def _linked_github_provider_user_id(db: AsyncSession, user_id: UUID) -> str | None:
    return await db.scalar(
        select(AuthIdentity.provider_subject)
        .where(
            AuthIdentity.user_id == user_id,
            AuthIdentity.provider == "github",
        )
        .order_by(AuthIdentity.linked_at.desc(), AuthIdentity.created_at.desc())
        .limit(1)
    )


async def _load_free_trial_allocation_for_subject(
    db: AsyncSession,
    subject: BillingSubject,
) -> FreeCloudAllocation | None:
    return (
        await db.execute(
            select(FreeCloudAllocation)
            .where(
                FreeCloudAllocation.billing_subject_id == subject.id,
                FreeCloudAllocation.allocation_kind == FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL,
                FreeCloudAllocation.period_key == FREE_CLOUD_ALLOCATION_PERIOD_V2,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()


async def _ensure_free_trial_allocation(
    db: AsyncSession,
    *,
    subject: BillingSubject,
    github_provider_user_id: str,
) -> bool:
    return await _ensure_free_cloud_allocation(
        db,
        allocation_kind=FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL,
        subject=subject,
        github_provider_user_id=github_provider_user_id,
        period_key=FREE_CLOUD_ALLOCATION_PERIOD_V2,
    )


async def _ensure_free_cloud_allocation(
    db: AsyncSession,
    *,
    allocation_kind: str,
    subject: BillingSubject,
    github_provider_user_id: str,
    period_key: str,
) -> bool:
    if subject.user_id is None:
        return False
    now = utcnow()
    result = await db.execute(
        pg_insert(FreeCloudAllocation)
        .values(
            allocation_kind=allocation_kind,
            github_provider_user_id=github_provider_user_id,
            billing_subject_id=subject.id,
            user_id=subject.user_id,
            issued_billing_grant_id=None,
            period_key=period_key,
            status="active",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                FreeCloudAllocation.allocation_kind,
                FreeCloudAllocation.github_provider_user_id,
                FreeCloudAllocation.period_key,
            ]
        )
        .returning(FreeCloudAllocation.id)
    )
    created_id = result.scalar_one_or_none()
    if created_id is not None:
        return True
    existing = (
        await db.execute(
            select(FreeCloudAllocation)
            .where(
                FreeCloudAllocation.allocation_kind == allocation_kind,
                FreeCloudAllocation.github_provider_user_id == github_provider_user_id,
                FreeCloudAllocation.period_key == period_key,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    return existing is not None and existing.billing_subject_id == subject.id


async def get_billing_subject_by_stripe_customer(
    db: AsyncSession,
    stripe_customer_id: str,
) -> BillingSubject | None:
    return (
        await db.execute(
            select(BillingSubject).where(BillingSubject.stripe_customer_id == stripe_customer_id)
        )
    ).scalar_one_or_none()


async def get_billing_subject_by_id(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSubject | None:
    return await db.get(BillingSubject, billing_subject_id)


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
    now = utcnow()
    subject.overage_enabled = overage_enabled
    subject.overage_preference_set_at = now
    subject.updated_at = now
    await db.flush()
    return subject


async def set_billing_subject_overage_policy(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    overage_enabled: bool,
    overage_cap_cents_per_seat: int | None = None,
) -> BillingSubject:
    subject = await set_billing_subject_overage_enabled(
        db,
        billing_subject_id=billing_subject_id,
        overage_enabled=overage_enabled,
    )
    if overage_cap_cents_per_seat is not None:
        subject.overage_cap_cents_per_seat = overage_cap_cents_per_seat
    subject.updated_at = utcnow()
    await db.flush()
    return subject


def _billing_subject_stripe_state(subject: BillingSubject) -> BillingSubjectStripeState:
    return BillingSubjectStripeState(
        billing_subject_id=subject.id,
        kind=subject.kind,
        user_id=subject.user_id,
        organization_id=subject.organization_id,
        stripe_customer_id=subject.stripe_customer_id,
    )


async def get_or_create_user_stripe_customer_state(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSubjectStripeState:
    subject = await ensure_personal_billing_subject(db, user_id)
    await db.flush()
    return _billing_subject_stripe_state(subject)


async def get_or_create_stripe_customer_state_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_user_stripe_customer_state(db, user_id)


async def get_or_create_organization_stripe_customer_state(
    db: AsyncSession,
    organization_id: UUID,
) -> BillingSubjectStripeState:
    subject = await ensure_organization_billing_subject(db, organization_id)
    await db.flush()
    return _billing_subject_stripe_state(subject)


async def bind_stripe_customer_to_billing_subject(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    stripe_customer_id: str,
) -> BillingSubjectStripeState:
    subject = await set_billing_subject_stripe_customer(
        db,
        billing_subject_id=billing_subject_id,
        stripe_customer_id=stripe_customer_id,
    )
    await db.flush()
    return _billing_subject_stripe_state(subject)


async def set_overage_policy_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    overage_enabled: bool,
    overage_cap_cents_per_seat: int | None = None,
) -> BillingSubject:
    subject = await ensure_personal_billing_subject(db, user_id)
    return await set_billing_subject_overage_policy(
        db,
        billing_subject_id=subject.id,
        overage_enabled=overage_enabled,
        overage_cap_cents_per_seat=overage_cap_cents_per_seat,
    )


async def set_overage_policy_for_subject(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    overage_enabled: bool,
    overage_cap_cents_per_seat: int | None = None,
) -> BillingSubject:
    return await set_billing_subject_overage_policy(
        db,
        billing_subject_id=billing_subject_id,
        overage_enabled=overage_enabled,
        overage_cap_cents_per_seat=overage_cap_cents_per_seat,
    )


async def get_billing_subject_for_stripe_reference(
    db: AsyncSession,
    *,
    billing_subject_id: UUID | None,
    stripe_customer_id: str | None,
) -> BillingSubject | None:
    if billing_subject_id is not None:
        return await db.get(BillingSubject, billing_subject_id)
    if stripe_customer_id is not None:
        return await get_billing_subject_by_stripe_customer(db, stripe_customer_id)
    return None


async def ensure_billing_grant(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    billing_subject_id: UUID,
    grant_type: str,
    hours_granted: float,
    effective_at: datetime,
    expires_at: datetime | None,
    source_ref: str,
    top_up_existing: bool = False,
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
        if top_up_existing and hours_granted > existing.hours_granted:
            delta_seconds = (hours_granted - existing.hours_granted) * 3600.0
            existing.hours_granted = hours_granted
            existing.remaining_seconds = max(existing.remaining_seconds + delta_seconds, 0.0)
            existing.expires_at = coerce_utc(expires_at)
            existing.updated_at = now
        return existing
    grant = await db.get(BillingGrant, grant_id)
    if grant is None:
        raise RuntimeError("Billing grant disappeared after creation.")
    return grant


async def ensure_billing_grant_record(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    billing_subject_id: UUID,
    grant_type: str,
    hours_granted: float,
    effective_at: datetime,
    expires_at: datetime | None,
    source_ref: str,
    top_up_existing: bool = False,
) -> BillingGrant:
    return await ensure_billing_grant(
        db,
        user_id=user_id,
        billing_subject_id=billing_subject_id,
        grant_type=grant_type,
        hours_granted=hours_granted,
        effective_at=effective_at,
        expires_at=expires_at,
        source_ref=source_ref,
        top_up_existing=top_up_existing,
    )


async def sum_all_time_billable_usage_seconds(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    now: datetime,
) -> float:
    completed = await db.scalar(
        select(
            func.coalesce(
                func.sum(func.extract("epoch", UsageSegment.ended_at - UsageSegment.started_at)),
                0.0,
            )
        ).where(
            UsageSegment.billing_subject_id == billing_subject_id,
            UsageSegment.is_billable.is_(True),
            UsageSegment.ended_at.is_not(None),
        )
    )
    open_rows = (
        await db.execute(
            select(UsageSegment.started_at).where(
                UsageSegment.billing_subject_id == billing_subject_id,
                UsageSegment.is_billable.is_(True),
                UsageSegment.ended_at.is_(None),
            )
        )
    ).scalars()
    current_time = coerce_utc(now) or now
    open_seconds = sum(
        max((current_time - (coerce_utc(started_at) or current_time)).total_seconds(), 0.0)
        for started_at in open_rows.all()
    )
    return max(float(completed or 0.0) + open_seconds, 0.0)
