"""Billing snapshot state orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_SUBJECT_KIND_PERSONAL,
    USAGE_SEGMENT_RECENT_LOOKBACK_DAYS,
)
from proliferate.db.store.billing import (
    count_active_cloud_repo_environments,
    estimate_unaccounted_billable_seconds,
    list_cloud_sandboxes_for_subject,
    list_entitlements,
    list_grants,
    list_usage_segments,
    sum_billable_usage_seconds_before,
)
from proliferate.db.store.billing_seats import count_active_seats_for_billing_subject
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_free_trial_v2_grant,
    ensure_personal_billing_subject,
    get_billing_subject_by_id,
)
from proliferate.db.store.billing_subscriptions import list_active_holds, list_subscriptions
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class BillingSnapshotState:
    subject: Any
    billing_subject_id: UUID
    sandboxes: list[Any]
    grants: list[Any]
    entitlements: list[Any]
    holds: list[Any]
    subscriptions: list[Any]
    usage_segments: list[Any]
    active_cloud_repo_count: int = 0
    unaccounted_billable_seconds: float = 0.0
    historical_billable_seconds: float = 0.0
    active_seat_count: int = 1
    managed_cloud_overage_used_cents: int = 0


class BillingSubjectRecord(Protocol):
    id: UUID
    kind: str
    user_id: UUID | None


async def _ensure_snapshot_free_grant(db: AsyncSession, subject: BillingSubjectRecord) -> None:
    if subject.kind != BILLING_SUBJECT_KIND_PERSONAL or subject.user_id is None:
        return
    if settings.pro_billing_enabled:
        await ensure_free_trial_v2_grant(db, subject)
    else:
        await ensure_free_included_grant(db, subject.user_id)
    await db.flush()


async def _build_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    now = utcnow()
    subject = await get_billing_subject_by_id(db, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    recent_window_started_at = now - timedelta(days=USAGE_SEGMENT_RECENT_LOOKBACK_DAYS)
    grants = await list_grants(db, billing_subject_id)
    entitlements = await list_entitlements(db, billing_subject_id)
    subscriptions = await list_subscriptions(db, billing_subject_id)
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
        managed_cloud_overage_used_cents=0,
    )


async def load_snapshot_state_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshotState:
    subject = await ensure_personal_billing_subject(db, user_id)
    await _ensure_snapshot_free_grant(db, subject)
    return await _build_snapshot_state_for_subject(db, subject.id)


async def load_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    subject = await get_billing_subject_by_id(db, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    await _ensure_snapshot_free_grant(db, subject)
    return await _build_snapshot_state_for_subject(db, billing_subject_id)
