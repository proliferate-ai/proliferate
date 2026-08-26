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
    list_entitlements,
    list_grants,
    list_usage_segments,
    sum_billable_usage_seconds_before,
)
from proliferate.db.store.billing_runtime_usage import resolve_billing_subject_id_for_user
from proliferate.db.store.billing_seats import count_active_seats_for_billing_subject
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_free_trial_v2_grant,
    get_billing_subject_by_id,
)
from proliferate.db.store.billing_subscriptions import list_active_holds, list_subscriptions
from proliferate.lib.infra.time.wall_clock import utcnow


@dataclass(frozen=True)
class BillingSnapshotState:
    subject: Any
    billing_subject_id: UUID
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


async def _ensure_snapshot_free_grant(
    db: AsyncSession,
    subject: BillingSubjectRecord,
    *,
    grant_user_id: UUID | None = None,
    payer_billing_subject_id: UUID | None = None,
) -> None:
    """Mint the free allowance on the subject this snapshot is FOR — if it pays.

    Law W1 ("the org always pays") governs money IN as well as money out. The
    free allowance has to land on the *paying* subject or it is unspendable: an
    org-membered user's compute drains the org pool, so a grant sitting on their
    personal subject is a balance they can see and never spend (W-F1). Before
    this, an org subject was skipped outright, which left the org pool empty by
    construction — under ``CLOUD_BILLING_MODE=enforce`` that blocks a brand-new
    org member's very first start.

    ``grant_user_id`` names the user the allowance belongs to. The free grant is
    per-user, not per-org, so an org subject reached without owner context is
    left alone rather than granted a pooled allowance nobody owns.

    The mint is guarded by the payer check rather than by subject kind: we only
    ever place a user's allowance on the one subject that pays for that user's
    compute. Loading some *other* org's snapshot (a second membership, viewed
    from settings) must not re-home the grant there — that would strand it just
    as surely as leaving it on personal did. ``payer_billing_subject_id`` lets a
    caller that already resolved the payer skip the second lookup.
    """
    user_id = grant_user_id or subject.user_id
    if user_id is None:
        return
    payer_subject_id = payer_billing_subject_id
    if payer_subject_id is None:
        payer_subject_id = await resolve_billing_subject_id_for_user(db, user_id)
    if payer_subject_id != subject.id:
        return
    if settings.pro_billing_enabled:
        # ``free_trial_v2`` stays personal-only: it reads and rewrites personal
        # ``free_included`` grants, and it is gated behind ``pro_billing_enabled``,
        # which is off at launch (W-F2/W-F3 are the PRO-path follow-ups).
        if subject.kind == BILLING_SUBJECT_KIND_PERSONAL and subject.user_id is not None:
            await ensure_free_trial_v2_grant(db, subject)
            await db.flush()
        return
    await ensure_free_included_grant(db, user_id, billing_subject_id=subject.id)
    await db.flush()


async def _build_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    actor_user_id: UUID | None = None,
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
            actor_user_id=actor_user_id,
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
    """Snapshot for a user, on the subject that PAYS for them (law W1).

    Resolves the payer the same way segment-open and the start gate do
    (``resolve_billing_subject_id_for_user``): org subject under a membership,
    personal subject when org-less. Reading the personal subject here while spend
    drains the org subject is what made a purchased or free balance look present
    but spend as empty (W-F1).
    """
    billing_subject_id = await resolve_billing_subject_id_for_user(db, user_id)
    subject = await get_billing_subject_by_id(db, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    await _ensure_snapshot_free_grant(
        db,
        subject,
        grant_user_id=user_id,
        payer_billing_subject_id=billing_subject_id,
    )
    return await _build_snapshot_state_for_subject(
        db,
        billing_subject_id,
        actor_user_id=user_id,
    )


async def load_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    grant_user_id: UUID | None = None,
) -> BillingSnapshotState:
    subject = await get_billing_subject_by_id(db, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    await _ensure_snapshot_free_grant(db, subject, grant_user_id=grant_user_id)
    return await _build_snapshot_state_for_subject(
        db,
        billing_subject_id,
        actor_user_id=grant_user_id,
    )
