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
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_PRICE_CLASS_PRO,
    BILLING_RECONCILER_LOCK_KEY,
    BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS,
    BILLING_SUBJECT_KIND_ORGANIZATION,
    BILLING_SUBJECT_KIND_PERSONAL,
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    PRO_PERIOD_GRANT_TYPE,
    PRO_SEAT_PRORATION_GRANT_TYPE,
    PRO_FREE_TRIAL_HOURS,
    REFILL_10H_GRANT_TYPE,
    USAGE_SEGMENT_RECENT_LOOKBACK_DAYS,
)
from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import (
    BillingDecisionEvent,
    BillingEntitlement,
    BillingGrant,
    BillingGrantConsumption,
    BillingHold,
    BillingOverageRemainder,
    BillingSeatAdjustment,
    BillingSubject,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
    WebhookEventReceipt,
)
from proliferate.db.models.cloud import (
    CloudRepoConfig,
    CloudRuntimeEnvironment,
    CloudSandbox,
    CloudWorkspace,
)
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.server.billing.accounting import overage_seconds_to_cents
from proliferate.server.billing.models import coerce_utc, utcnow
from proliferate.server.billing.pricing import classify_monthly_price_id
from proliferate.server.billing.seats import (
    initial_seat_reconcile_source_ref,
    seat_adjustment_source_ref,
)

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
    active_cloud_repo_count: int = 0
    unaccounted_billable_seconds: float = 0.0
    historical_billable_seconds: float = 0.0
    active_seat_count: int = 1
    managed_cloud_overage_used_cents: int = 0


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
    meter_quantity_cents: int | None
    idempotency_key: str
    accounted_until: datetime


@dataclass(frozen=True)
class BillingSubjectStripeState:
    billing_subject_id: UUID
    kind: str
    user_id: UUID | None
    organization_id: UUID | None
    stripe_customer_id: str | None


@dataclass(frozen=True)
class ClaimedSeatAdjustment:
    id: UUID
    billing_subject_id: UUID
    billing_subscription_id: UUID
    user_id: UUID | None
    membership_id: UUID | None
    stripe_subscription_id: str
    monthly_subscription_item_id: str
    previous_quantity: int | None
    target_quantity: int
    grant_quantity: int
    period_start: datetime | None
    period_end: datetime | None
    effective_at: datetime | None
    source_ref: str


@dataclass(frozen=True)
class InitialSeatReconcileAdjustment:
    id: UUID
    monthly_subscription_item_id: str
    target_quantity: int


class _GrantKind(StrEnum):
    FREE = FREE_INCLUDED_GRANT_TYPE
    FREE_TRIAL_V2 = FREE_TRIAL_V2_GRANT_TYPE
    MONTHLY = MONTHLY_CLOUD_GRANT_TYPE
    PRO_PERIOD = PRO_PERIOD_GRANT_TYPE
    PRO_SEAT_PRORATION = PRO_SEAT_PRORATION_GRANT_TYPE
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
                .join(
                    CloudRuntimeEnvironment,
                    CloudSandbox.runtime_environment_id == CloudRuntimeEnvironment.id,
                )
                .where(CloudRuntimeEnvironment.billing_subject_id == billing_subject_id)
            )
        )
        .scalars()
        .all()
    )


async def count_active_cloud_repo_environments(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> int:
    repo_keys = {
        (
            git_provider,
            git_owner_norm,
            git_repo_name_norm,
        )
        for git_provider, git_owner_norm, git_repo_name_norm in (
            await db.execute(
                select(
                    CloudWorkspace.git_provider,
                    func.coalesce(
                        CloudRuntimeEnvironment.git_owner_norm,
                        func.lower(func.btrim(CloudWorkspace.git_owner)),
                    ),
                    func.coalesce(
                        CloudRuntimeEnvironment.git_repo_name_norm,
                        func.lower(func.btrim(CloudWorkspace.git_repo_name)),
                    ),
                )
                .outerjoin(
                    CloudRuntimeEnvironment,
                    CloudWorkspace.runtime_environment_id == CloudRuntimeEnvironment.id,
                )
                .where(
                    CloudWorkspace.billing_subject_id == billing_subject_id,
                    CloudWorkspace.archived_at.is_(None),
                )
                .distinct()
            )
        ).all()
    }

    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is not None and subject.user_id is not None:
        repo_keys.update(
            (
                "github",
                git_owner_norm,
                git_repo_name_norm,
            )
            for git_owner_norm, git_repo_name_norm in (
                await db.execute(
                    select(
                        func.lower(func.btrim(CloudRepoConfig.git_owner)),
                        func.lower(func.btrim(CloudRepoConfig.git_repo_name)),
                    )
                    .where(
                        CloudRepoConfig.user_id == subject.user_id,
                        CloudRepoConfig.configured.is_(True),
                    )
                    .distinct()
                )
            ).all()
        )

    return len(repo_keys)


async def cloud_repo_slot_exists(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> bool:
    git_owner_norm = git_owner.strip().lower()
    git_repo_name_norm = git_repo_name.strip().lower()
    active_workspace_id = await db.scalar(
        select(CloudWorkspace.id)
        .outerjoin(
            CloudRuntimeEnvironment,
            CloudWorkspace.runtime_environment_id == CloudRuntimeEnvironment.id,
        )
        .where(
            CloudWorkspace.billing_subject_id == billing_subject_id,
            CloudWorkspace.git_provider == git_provider,
            func.coalesce(
                CloudRuntimeEnvironment.git_owner_norm,
                func.lower(func.btrim(CloudWorkspace.git_owner)),
            )
            == git_owner_norm,
            func.coalesce(
                CloudRuntimeEnvironment.git_repo_name_norm,
                func.lower(func.btrim(CloudWorkspace.git_repo_name)),
            )
            == git_repo_name_norm,
            CloudWorkspace.archived_at.is_(None),
        )
        .limit(1)
    )
    if active_workspace_id is not None:
        return True

    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None or subject.user_id is None or git_provider != "github":
        return False

    configured_repo_id = await db.scalar(
        select(CloudRepoConfig.id)
        .where(
            CloudRepoConfig.user_id == subject.user_id,
            func.lower(func.btrim(CloudRepoConfig.git_owner)) == git_owner_norm,
            func.lower(func.btrim(CloudRepoConfig.git_repo_name)) == git_repo_name_norm,
            CloudRepoConfig.configured.is_(True),
        )
        .limit(1)
    )
    return configured_repo_id is not None


async def acquire_billing_subject_repo_limit_lock(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"cloud-repo-limit:{billing_subject_id}"},
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


async def get_or_create_stripe_customer_state_for_user(user_id: UUID) -> BillingSubjectStripeState:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, user_id)
        state = _billing_subject_stripe_state(subject)
        await db.commit()
        return state


async def get_or_create_stripe_customer_state_for_organization(
    organization_id: UUID,
) -> BillingSubjectStripeState:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_organization_billing_subject(db, organization_id)
        state = _billing_subject_stripe_state(subject)
        await db.commit()
        return state


async def bind_stripe_customer_to_billing_subject(
    *,
    billing_subject_id: UUID,
    stripe_customer_id: str,
) -> BillingSubjectStripeState:
    async with db_engine.async_session_factory() as db:
        subject = await set_billing_subject_stripe_customer(
            db,
            billing_subject_id=billing_subject_id,
            stripe_customer_id=stripe_customer_id,
        )
        state = _billing_subject_stripe_state(subject)
        await db.commit()
        return state


async def set_overage_policy_for_user(
    *,
    user_id: UUID,
    overage_enabled: bool,
    overage_cap_cents_per_seat: int | None = None,
) -> BillingSubject:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, user_id)
        subject = await set_billing_subject_overage_policy(
            db,
            billing_subject_id=subject.id,
            overage_enabled=overage_enabled,
            overage_cap_cents_per_seat=overage_cap_cents_per_seat,
        )
        await db.commit()
        return subject


async def set_overage_policy_for_subject(
    *,
    billing_subject_id: UUID,
    overage_enabled: bool,
    overage_cap_cents_per_seat: int | None = None,
) -> BillingSubject:
    async with db_engine.async_session_factory() as db:
        subject = await set_billing_subject_overage_policy(
            db,
            billing_subject_id=billing_subject_id,
            overage_enabled=overage_enabled,
            overage_cap_cents_per_seat=overage_cap_cents_per_seat,
        )
        await db.commit()
        return subject


async def get_billing_subject_for_stripe_reference(
    *,
    billing_subject_id: UUID | None,
    stripe_customer_id: str | None,
) -> BillingSubject | None:
    async with db_engine.async_session_factory() as db:
        if billing_subject_id is not None:
            return await db.get(BillingSubject, billing_subject_id)
        if stripe_customer_id is not None:
            return await get_billing_subject_by_stripe_customer(db, stripe_customer_id)
    return None


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
    seat_quantity: int | None = None,
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
        "seat_quantity": seat_quantity,
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


async def upsert_stripe_subscription_record(
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
    seat_quantity: int | None = None,
    default_pro_overage_enabled: bool = False,
) -> BillingSubscription:
    async with db_engine.async_session_factory() as db:
        subscription = await upsert_billing_subscription(
            db,
            billing_subject_id=billing_subject_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_customer_id=stripe_customer_id,
            status=status,
            cancel_at_period_end=cancel_at_period_end,
            canceled_at=canceled_at,
            current_period_start=current_period_start,
            current_period_end=current_period_end,
            cloud_monthly_price_id=cloud_monthly_price_id,
            overage_price_id=overage_price_id,
            monthly_subscription_item_id=monthly_subscription_item_id,
            metered_subscription_item_id=metered_subscription_item_id,
            latest_invoice_id=latest_invoice_id,
            latest_invoice_status=latest_invoice_status,
            hosted_invoice_url=hosted_invoice_url,
            seat_quantity=seat_quantity,
        )
        if default_pro_overage_enabled:
            subject = await db.get(BillingSubject, billing_subject_id)
            if subject is not None and subject.overage_preference_set_at is None:
                now = utcnow()
                subject.overage_enabled = True
                subject.overage_preference_set_at = now
                subject.updated_at = now
        await db.commit()
        return subscription


async def maybe_create_org_seat_adjustment(
    db: AsyncSession,
    *,
    organization_id: UUID,
    membership_id: UUID | None,
) -> bool:
    if not settings.pro_billing_enabled:
        return False
    subject = (
        await db.execute(
            select(BillingSubject)
            .where(
                BillingSubject.kind == BILLING_SUBJECT_KIND_ORGANIZATION,
                BillingSubject.organization_id == organization_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if subject is None:
        return False
    subscription = (
        await db.execute(
            select(BillingSubscription)
            .where(
                BillingSubscription.billing_subject_id == subject.id,
                BillingSubscription.status.in_(["active", "trialing"]),
            )
            .order_by(
                BillingSubscription.current_period_end.desc().nulls_last(),
                BillingSubscription.updated_at.desc(),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        subscription is None
        or subscription.monthly_subscription_item_id is None
        or classify_monthly_price_id(subscription.cloud_monthly_price_id) != BILLING_PRICE_CLASS_PRO
        or subscription.current_period_start is None
    ):
        return False
    target_quantity = await count_active_seats_for_billing_subject(db, subject)
    previous_quantity = (
        int(subscription.seat_quantity)
        if subscription.seat_quantity is not None
        else target_quantity
    )
    period_start = coerce_utc(subscription.current_period_start) or subscription.current_period_start
    now = utcnow()
    grant_quantity = 0
    if target_quantity > previous_quantity and membership_id is not None:
        membership = await db.get(OrganizationMembership, membership_id)
        had_current_period_decrease = await _has_current_period_seat_decrease_for_membership(
            db,
            billing_subscription_id=subscription.id,
            membership_id=membership_id,
            period_start=subscription.current_period_start,
        )
        if (
            membership is not None
            and membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
            and now >= period_start
            and not had_current_period_decrease
        ):
            grant_quantity = min(target_quantity - previous_quantity, 1)
    if target_quantity == previous_quantity and grant_quantity == 0:
        return False
    source_ref = seat_adjustment_source_ref(
        subscription_id=subscription.stripe_subscription_id,
        membership_id=str(membership_id or organization_id),
        period_start_unix=int(subscription.current_period_start.timestamp()),
        event_unix_microseconds=int(now.timestamp() * 1_000_000),
    )
    result = await db.execute(
        pg_insert(BillingSeatAdjustment)
        .values(
            billing_subject_id=subject.id,
            billing_subscription_id=subscription.id,
            organization_id=organization_id,
            membership_id=membership_id,
            stripe_subscription_id=subscription.stripe_subscription_id,
            monthly_subscription_item_id=subscription.monthly_subscription_item_id,
            previous_quantity=previous_quantity,
            target_quantity=target_quantity,
            grant_quantity=grant_quantity,
            attempt_count=0,
            period_start=subscription.current_period_start,
            effective_at=now,
            source_ref=source_ref,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingSeatAdjustment.source_ref])
    )
    return (result.rowcount or 0) > 0


async def claim_pending_seat_adjustments(limit: int = 100) -> list[ClaimedSeatAdjustment]:
    async with db_engine.async_session_factory() as db:
        rows = (
            await db.execute(
                select(BillingSeatAdjustment, BillingSubscription, BillingSubject)
                .join(
                    BillingSubscription,
                    BillingSubscription.id == BillingSeatAdjustment.billing_subscription_id,
                )
                .join(BillingSubject, BillingSubject.id == BillingSeatAdjustment.billing_subject_id)
                .where(BillingSeatAdjustment.status.in_(["pending", "failed_retryable"]))
                .order_by(BillingSeatAdjustment.created_at.asc())
                .limit(limit)
                .with_for_update(
                    skip_locked=True,
                    of=(BillingSeatAdjustment, BillingSubscription, BillingSubject),
                )
            )
        ).all()
        now = utcnow()
        claimed: list[ClaimedSeatAdjustment] = []
        for adjustment, subscription, subject in rows:
            if adjustment.monthly_subscription_item_id is None:
                adjustment.status = "failed_terminal"
                adjustment.last_error = "Missing Stripe subscription item id."
                adjustment.updated_at = now
                continue
            if adjustment.stripe_confirmed_at is None:
                current_quantity = await count_active_seats_for_billing_subject(db, subject)
                confirmed_quantity = (
                    int(subscription.seat_quantity)
                    if subscription.seat_quantity is not None
                    else adjustment.previous_quantity
                )
                if confirmed_quantity is None:
                    confirmed_quantity = current_quantity
                grant_quantity = 0
                period_start = coerce_utc(adjustment.period_start)
                # Use the persisted adjustment time when reclaiming rows; a retry may run
                # much later than the membership activation that created the adjustment.
                effective_at = coerce_utc(adjustment.effective_at or adjustment.created_at)
                membership = (
                    await db.get(OrganizationMembership, adjustment.membership_id)
                    if adjustment.membership_id is not None
                    else None
                )
                if (
                    current_quantity > confirmed_quantity
                    and membership is not None
                    and membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
                    and period_start is not None
                    and effective_at is not None
                    and effective_at >= period_start
                    and not await _has_current_period_seat_decrease_for_membership(
                        db,
                        billing_subscription_id=subscription.id,
                        membership_id=adjustment.membership_id,
                        period_start=adjustment.period_start,
                    )
                ):
                    grant_quantity = min(current_quantity - confirmed_quantity, 1)

                adjustment.previous_quantity = confirmed_quantity
                adjustment.target_quantity = current_quantity
                adjustment.grant_quantity = grant_quantity
                adjustment.updated_at = now
                if current_quantity == confirmed_quantity and grant_quantity == 0:
                    adjustment.status = "succeeded"
                    adjustment.stripe_confirmed_at = now
                    adjustment.grant_issued_at = now
                    adjustment.last_error = "stale_seat_adjustment_noop"
                    continue
            claimed.append(
                ClaimedSeatAdjustment(
                    id=adjustment.id,
                    billing_subject_id=adjustment.billing_subject_id,
                    billing_subscription_id=adjustment.billing_subscription_id,
                    user_id=subject.user_id,
                    membership_id=adjustment.membership_id,
                    stripe_subscription_id=adjustment.stripe_subscription_id,
                    monthly_subscription_item_id=adjustment.monthly_subscription_item_id,
                    previous_quantity=adjustment.previous_quantity,
                    target_quantity=adjustment.target_quantity,
                    grant_quantity=adjustment.grant_quantity,
                    period_start=adjustment.period_start,
                    period_end=subscription.current_period_end,
                    effective_at=adjustment.effective_at or adjustment.created_at,
                    source_ref=adjustment.source_ref,
                )
            )
        await db.commit()
        return claimed


async def mark_seat_adjustment_stripe_confirmed(*, adjustment_id: UUID) -> None:
    async with db_engine.async_session_factory() as db:
        adjustment = await db.get(BillingSeatAdjustment, adjustment_id)
        if adjustment is not None:
            adjustment.stripe_confirmed_at = utcnow()
            adjustment.last_error = None
            adjustment.updated_at = utcnow()
            subscription = await db.get(BillingSubscription, adjustment.billing_subscription_id)
            if subscription is not None:
                subscription.seat_quantity = adjustment.target_quantity
                subscription.updated_at = utcnow()
        await db.commit()


async def mark_seat_adjustment_grant_issued(*, adjustment_id: UUID) -> None:
    async with db_engine.async_session_factory() as db:
        adjustment = await db.get(BillingSeatAdjustment, adjustment_id)
        if adjustment is not None:
            adjustment.grant_issued_at = utcnow()
            adjustment.status = "succeeded"
            adjustment.last_error = None
            adjustment.updated_at = utcnow()
        await db.commit()


async def mark_seat_adjustment_failed(
    *,
    adjustment_id: UUID,
    error: str,
    terminal: bool = False,
) -> None:
    async with db_engine.async_session_factory() as db:
        adjustment = await db.get(BillingSeatAdjustment, adjustment_id)
        if adjustment is not None:
            adjustment.attempt_count = int(adjustment.attempt_count or 0) + 1
            should_terminal = terminal or (
                adjustment.attempt_count >= BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS
            )
            adjustment.status = "failed_terminal" if should_terminal else "failed_retryable"
            adjustment.last_error = error[:4000]
            adjustment.updated_at = utcnow()
        await db.commit()


async def ensure_billing_grant_record(
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
    async with db_engine.async_session_factory() as db:
        grant = await ensure_billing_grant(
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
        await db.commit()
        return grant


async def apply_payment_failed_hold(
    *,
    billing_subject_id: UUID,
    source: str,
    source_ref: str | None,
) -> None:
    async with db_engine.async_session_factory() as db:
        existing = (
            await db.execute(
                select(BillingHold).where(
                    BillingHold.billing_subject_id == billing_subject_id,
                    BillingHold.kind == BILLING_HOLD_KIND_PAYMENT_FAILED,
                    BillingHold.status == BILLING_HOLD_STATUS_ACTIVE,
                )
            )
        ).scalar_one_or_none()
        now = utcnow()
        if existing is not None:
            existing.source_ref = source_ref or existing.source_ref
            existing.updated_at = now
        else:
            db.add(
                BillingHold(
                    billing_subject_id=billing_subject_id,
                    kind=BILLING_HOLD_KIND_PAYMENT_FAILED,
                    status=BILLING_HOLD_STATUS_ACTIVE,
                    source=source,
                    source_ref=source_ref,
                    created_at=now,
                    resolved_at=None,
                    updated_at=now,
                )
            )
        await db.commit()


async def clear_payment_failed_holds(*, billing_subject_id: UUID) -> None:
    async with db_engine.async_session_factory() as db:
        holds = list(
            (
                await db.execute(
                    select(BillingHold).where(
                        BillingHold.billing_subject_id == billing_subject_id,
                        BillingHold.kind == BILLING_HOLD_KIND_PAYMENT_FAILED,
                        BillingHold.status == BILLING_HOLD_STATUS_ACTIVE,
                    )
                )
            )
            .scalars()
            .all()
        )
        now = utcnow()
        for hold in holds:
            hold.status = "resolved"
            hold.resolved_at = now
            hold.updated_at = now
        await db.commit()


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


_CAP_COUNTING_EXPORT_STATUSES = {
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    # Retryable rows are durable billable exports that have already advanced usage
    # cursors. Keep them in cap spend so later accounting passes cannot overrun
    # the cap while Stripe delivery is being retried for the same row.
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
}


async def sum_meter_quantity_cents_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    period_start: datetime | None = None,
) -> int:
    conditions = [
        BillingUsageExport.billing_subject_id == billing_subject_id,
        BillingUsageExport.status.in_(_CAP_COUNTING_EXPORT_STATUSES),
        BillingUsageExport.meter_quantity_cents.is_not(None),
    ]
    if period_start is not None:
        conditions.append(
            BillingUsageExport.period_start == (coerce_utc(period_start) or period_start)
        )
    result = await db.scalar(
        select(func.coalesce(func.sum(BillingUsageExport.meter_quantity_cents), 0)).where(
            *conditions
        )
    )
    return int(result or 0)


async def count_active_seats_for_billing_subject(
    db: AsyncSession,
    subject: BillingSubject,
) -> int:
    if subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION and subject.organization_id is not None:
        count = await db.scalar(
            select(func.count(OrganizationMembership.id)).where(
                OrganizationMembership.organization_id == subject.organization_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
        )
        return max(int(count or 0), 1)
    return 1


async def count_active_seats_for_billing_subject_id(billing_subject_id: UUID) -> int:
    async with db_engine.async_session_factory() as db:
        subject = await db.get(BillingSubject, billing_subject_id)
        if subject is None:
            return 1
        return await count_active_seats_for_billing_subject(db, subject)


async def prepare_initial_org_seat_reconcile(
    *,
    billing_subscription_id: UUID,
) -> InitialSeatReconcileAdjustment | None:
    if not settings.pro_billing_enabled:
        return None
    async with db_engine.async_session_factory() as db:
        subscription = await db.get(
            BillingSubscription,
            billing_subscription_id,
            with_for_update=True,
        )
        if subscription is None:
            return None
        subject = await db.get(BillingSubject, subscription.billing_subject_id, with_for_update=True)
        if (
            subject is None
            or subject.kind != BILLING_SUBJECT_KIND_ORGANIZATION
            or subject.organization_id is None
            or subscription.status not in {"active", "trialing"}
            or subscription.monthly_subscription_item_id is None
            or subscription.current_period_start is None
            or classify_monthly_price_id(subscription.cloud_monthly_price_id)
            != BILLING_PRICE_CLASS_PRO
        ):
            return None

        target_quantity = await count_active_seats_for_billing_subject(db, subject)
        previous_quantity = (
            int(subscription.seat_quantity)
            if subscription.seat_quantity is not None
            else target_quantity
        )
        period_start_unix = int(subscription.current_period_start.timestamp())
        source_ref = initial_seat_reconcile_source_ref(
            subscription_id=subscription.stripe_subscription_id,
            period_start_unix=period_start_unix,
        )
        now = utcnow()
        existing = (
            await db.execute(
                select(BillingSeatAdjustment)
                .where(BillingSeatAdjustment.source_ref == source_ref)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.status == "succeeded":
                if target_quantity == existing.target_quantity:
                    if subscription.seat_quantity != existing.target_quantity:
                        subscription.seat_quantity = existing.target_quantity
                        subscription.updated_at = now
                    await db.commit()
                    return None
                # Webhook retries are idempotent, but a later subscription update in the
                # same period can still reveal active-seat drift. Reuse the per-period
                # reconcile row and let the Stripe idempotency key include the new target.
                existing.status = "pending"
                existing.stripe_confirmed_at = None
                existing.grant_issued_at = None
                existing.last_error = None
                existing.previous_quantity = previous_quantity
                existing.target_quantity = target_quantity
                existing.grant_quantity = 0
                existing.attempt_count = 0
                existing.updated_at = now
                if subscription.seat_quantity != previous_quantity:
                    subscription.seat_quantity = previous_quantity
                    subscription.updated_at = now
                await db.commit()
                return InitialSeatReconcileAdjustment(
                    id=existing.id,
                    monthly_subscription_item_id=existing.monthly_subscription_item_id
                    or subscription.monthly_subscription_item_id,
                    target_quantity=existing.target_quantity,
                )
            if existing.stripe_confirmed_at is None:
                existing.previous_quantity = previous_quantity
                existing.target_quantity = target_quantity
                existing.grant_quantity = 0
                existing.attempt_count = 0
                existing.updated_at = now
            await db.commit()
            return InitialSeatReconcileAdjustment(
                id=existing.id,
                monthly_subscription_item_id=existing.monthly_subscription_item_id
                or subscription.monthly_subscription_item_id,
                target_quantity=existing.target_quantity,
            )

        if target_quantity == previous_quantity:
            return None

        result = await db.execute(
            pg_insert(BillingSeatAdjustment)
            .values(
                billing_subject_id=subject.id,
                billing_subscription_id=subscription.id,
                organization_id=subject.organization_id,
                membership_id=None,
                stripe_subscription_id=subscription.stripe_subscription_id,
                monthly_subscription_item_id=subscription.monthly_subscription_item_id,
                previous_quantity=previous_quantity,
                target_quantity=target_quantity,
                grant_quantity=0,
                attempt_count=0,
                period_start=subscription.current_period_start,
                effective_at=now,
                source_ref=source_ref,
                status="pending",
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=[BillingSeatAdjustment.source_ref])
            .returning(BillingSeatAdjustment.id)
        )
        adjustment_id = result.scalar_one_or_none()
        if adjustment_id is None:
            await db.commit()
            return None
        await db.commit()
        return InitialSeatReconcileAdjustment(
            id=adjustment_id,
            monthly_subscription_item_id=subscription.monthly_subscription_item_id,
            target_quantity=target_quantity,
        )


async def load_billing_subscription_by_id(
    billing_subscription_id: UUID,
) -> BillingSubscription | None:
    async with db_engine.async_session_factory() as db:
        return await db.get(BillingSubscription, billing_subscription_id)


async def _has_current_period_seat_decrease_for_membership(
    db: AsyncSession,
    *,
    billing_subscription_id: UUID,
    membership_id: UUID,
    period_start: datetime,
) -> bool:
    # A same-period decrease means that seat was already covered by the period grant.
    # Re-adding it should sync Stripe quantity without issuing another prorated grant.
    return (
        await db.execute(
            select(BillingSeatAdjustment.id)
            .where(
                BillingSeatAdjustment.billing_subscription_id == billing_subscription_id,
                BillingSeatAdjustment.membership_id == membership_id,
                BillingSeatAdjustment.period_start == period_start,
                BillingSeatAdjustment.previous_quantity.is_not(None),
                BillingSeatAdjustment.previous_quantity > BillingSeatAdjustment.target_quantity,
            )
            .limit(1)
        )
    ).scalar_one_or_none() is not None


def _active_pro_period_start(
    subscriptions: list[BillingSubscription],
    *,
    now: datetime,
) -> datetime | None:
    active_periods: list[tuple[datetime, datetime, datetime]] = []
    for subscription in subscriptions:
        if (
            subscription.status not in {"active", "trialing"}
            or classify_monthly_price_id(subscription.cloud_monthly_price_id)
            != BILLING_PRICE_CLASS_PRO
            or subscription.current_period_start is None
        ):
            continue
        period_start = coerce_utc(subscription.current_period_start)
        if period_start is None:
            continue
        period_end = coerce_utc(subscription.current_period_end) or datetime.max.replace(
            tzinfo=period_start.tzinfo,
        )
        if period_end < now:
            continue
        active_periods.append(
            (
                period_end,
                coerce_utc(subscription.updated_at)
                or datetime.min.replace(tzinfo=period_start.tzinfo),
                period_start,
            )
        )
    if not active_periods:
        return None
    return max(active_periods)[2]


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


async def _get_runtime_environment_billing_subject(
    db: AsyncSession,
    runtime_environment_id: UUID,
) -> tuple[UUID, UUID]:
    environment = await db.get(CloudRuntimeEnvironment, runtime_environment_id)
    if environment is None:
        raise RuntimeError("Cloud runtime environment not found while opening usage segment.")
    return environment.billing_subject_id, environment.user_id


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
    runtime_environment_id: UUID | None,
    workspace_id: UUID | None,
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
            runtime_environment_id=runtime_environment_id,
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


async def claim_webhook_event(
    *,
    provider: str,
    event_id: str,
    event_type: str,
    external_sandbox_id: str | None = None,
) -> WebhookEventReceipt | None:
    async with db_engine.async_session_factory() as db:
        receipt = await claim_webhook_event_receipt(
            db,
            provider=provider,
            event_id=event_id,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
        )
        await db.commit()
        return receipt


async def mark_webhook_event_processed_by_id(*, receipt_id: UUID) -> WebhookEventReceipt:
    async with db_engine.async_session_factory() as db:
        receipt = await mark_webhook_event_processed(db, receipt_id=receipt_id)
        await db.commit()
        return receipt


async def mark_webhook_event_failed_by_id(
    *,
    receipt_id: UUID,
    error: str,
) -> WebhookEventReceipt:
    async with db_engine.async_session_factory() as db:
        receipt = await mark_webhook_event_failed(db, receipt_id=receipt_id, error=error)
        await db.commit()
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
    if settings.pro_billing_enabled and is_paid_cloud:
        grant_type_order = {
            _GrantKind.PRO_PERIOD: 0,
            _GrantKind.PRO_SEAT_PRORATION: 1,
            _GrantKind.REFILL: 2,
        }
    elif settings.pro_billing_enabled:
        grant_type_order = {
            _GrantKind.FREE_TRIAL_V2: 0,
            _GrantKind.REFILL: 1,
        }
    elif is_paid_cloud:
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
    overage_cap_cents: int | None = None,
    consume_grants: bool = True,
    export_overage: bool = True,
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
        can_export_overage = export_overage and is_paid_cloud and overage_enabled
        accounting_boundaries = (
            (period_start_utc,) if is_paid_cloud and period_start_utc is not None else ()
        )
        cap_used_cents = 0
        overage_remainder: BillingOverageRemainder | None = None
        if can_export_overage and period_start_utc is not None:
            cap_used_cents = await sum_meter_quantity_cents_for_subject(
                db,
                billing_subject_id,
                period_start=period_start_utc,
            )
            overage_remainder = await get_or_create_overage_remainder(
                db,
                billing_subject_id=billing_subject_id,
                billing_subscription_id=billing_subscription_id,
                period_start=period_start_utc,
            )

        for segment, range_start, range_end in usage_ranges:
            accounted_from = range_start
            while accounted_from < range_end:
                accounted_until = _next_accounting_boundary(
                    accounted_from,
                    range_end,
                    grants if consume_grants else [],
                    accounting_boundaries,
                )
                seconds = max((accounted_until - accounted_from).total_seconds(), 0.0)
                if seconds <= 0:
                    break

                uncovered_seconds = seconds
                if consume_grants:
                    for grant in _ordered_accounting_grants(
                        grants,
                        is_paid_cloud=is_paid_cloud,
                        at=accounted_from,
                    ):
                        consumed = min(float(grant.remaining_seconds), uncovered_seconds)
                        if consumed <= 0:
                            continue
                        grant.remaining_seconds = max(
                            float(grant.remaining_seconds) - consumed,
                            0.0,
                        )
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
                    remainder_cents = (
                        float(overage_remainder.fractional_cents)
                        if overage_remainder is not None
                        else 0.0
                    )
                    meter_cents, fractional_cents = overage_seconds_to_cents(
                        uncovered_seconds,
                        fractional_cents=remainder_cents,
                    )
                    if overage_remainder is not None:
                        overage_remainder.fractional_cents = fractional_cents
                        overage_remainder.updated_at = now

                    if meter_cents > 0:
                        cap_remaining_cents = (
                            max(overage_cap_cents - cap_used_cents, 0)
                            if overage_cap_cents is not None
                            else meter_cents
                        )
                        billable_cents = min(meter_cents, cap_remaining_cents)
                        writeoff_cents = max(meter_cents - billable_cents, 0)
                        base_idempotency_key = _usage_export_idempotency_key(
                            billing_subject_id=billing_subject_id,
                            usage_segment_id=segment.id,
                            accounted_from=accounted_from,
                            accounted_until=accounted_until,
                        )
                        billable_seconds = (
                            uncovered_seconds * billable_cents / meter_cents
                            if billable_cents > 0
                            else 0.0
                        )
                        writeoff_seconds = max(uncovered_seconds - billable_seconds, 0.0)
                        if billable_cents > 0:
                            await create_usage_export(
                                db,
                                billing_subject_id=billing_subject_id,
                                billing_subscription_id=billing_subscription_id,
                                usage_segment_id=segment.id,
                                period_start=period_start,
                                period_end=period_end,
                                accounted_from=accounted_from,
                                accounted_until=accounted_until,
                                quantity_seconds=billable_seconds,
                                meter_quantity_cents=billable_cents,
                                cap_cents_snapshot=overage_cap_cents,
                                cap_used_cents_snapshot=cap_used_cents,
                                idempotency_key=f"{base_idempotency_key}:billable",
                                status=export_status,
                            )
                            cap_used_cents += billable_cents
                            export_seconds += billable_seconds
                            export_count += 1
                        if writeoff_cents > 0:
                            await create_usage_export(
                                db,
                                billing_subject_id=billing_subject_id,
                                billing_subscription_id=billing_subscription_id,
                                usage_segment_id=segment.id,
                                period_start=period_start,
                                period_end=period_end,
                                accounted_from=accounted_from,
                                accounted_until=accounted_until,
                                quantity_seconds=writeoff_seconds,
                                meter_quantity_cents=0,
                                cap_cents_snapshot=overage_cap_cents,
                                cap_used_cents_snapshot=cap_used_cents,
                                writeoff_reason="overage_cap_exhausted",
                                idempotency_key=f"{base_idempotency_key}:writeoff",
                                status=BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF,
                            )
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
                    meter_quantity_cents=export.meter_quantity_cents,
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
    runtime_environment_id: UUID | None = None,
    workspace_id: UUID | None = None,
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
    if runtime_environment_id is not None:
        billing_subject_id, owner_user_id = await _get_runtime_environment_billing_subject(
            db,
            runtime_environment_id,
        )
    elif workspace_id is not None:
        billing_subject_id, owner_user_id = await _get_workspace_billing_subject(db, workspace_id)
    else:
        raise RuntimeError("Usage segment requires a runtime environment or workspace.")
    return await create_usage_segment(
        db,
        user_id=actor_user_id or owner_user_id,
        billing_subject_id=billing_subject_id,
        runtime_environment_id=runtime_environment_id,
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
    subscriptions = await list_subscriptions(db, billing_subject_id)
    active_pro_period_start = _active_pro_period_start(subscriptions, now=now)
    return BillingSnapshotState(
        subject=subject,
        billing_subject_id=billing_subject_id,
        sandboxes=await list_cloud_sandboxes_for_subject(db, billing_subject_id),
        grants=grants,
        entitlements=entitlements,
        holds=await list_active_holds(db, billing_subject_id),
        subscriptions=subscriptions,
        usage_segments=await list_usage_segments(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
        active_cloud_repo_count=await count_active_cloud_repo_environments(
            db,
            billing_subject_id,
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
        active_seat_count=await count_active_seats_for_billing_subject(db, subject),
        managed_cloud_overage_used_cents=(
            await sum_meter_quantity_cents_for_subject(
                db,
                billing_subject_id,
                period_start=active_pro_period_start,
            )
            if active_pro_period_start is not None
            else 0
        ),
    )


async def load_billing_snapshot_state(user_id: UUID) -> BillingSnapshotState:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, user_id)
        if settings.pro_billing_enabled:
            await ensure_free_trial_v2_grant(db, subject)
        else:
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
            if settings.pro_billing_enabled:
                await ensure_free_trial_v2_grant(db, subject)
            else:
                await ensure_free_included_grant(db, subject.user_id)
            await db.commit()
        return await _build_billing_snapshot_state_for_subject(db, billing_subject_id)


async def open_usage_segment_for_sandbox(
    *,
    runtime_environment_id: UUID | None = None,
    workspace_id: UUID | None = None,
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
            runtime_environment_id=runtime_environment_id,
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
