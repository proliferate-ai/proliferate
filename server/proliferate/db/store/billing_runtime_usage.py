"""Billing runtime usage persistence helpers."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, TypeVar
from uuid import UUID

from sqlalchemy import and_, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_RECONCILER_LOCK_KEY
from proliferate.db.models.billing import BillingDecisionEvent, UsageSegment, WebhookEventReceipt
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db.store.organizations import get_current_membership_for_user
from proliferate.utils.time import utcnow

T = TypeVar("T")


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


WebhookEventClaimStatus = Literal["claimed", "already_processed", "in_progress"]


@dataclass(frozen=True)
class WebhookEventClaim:
    status: WebhookEventClaimStatus
    receipt: WebhookEventReceipt | None


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


async def resolve_organization_id_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> UUID | None:
    """The org a user's compute belongs to, or None if they are org-less.

    Resolves the user's current (first active) membership — the same resolution
    the resume gate uses (``get_current_membership_for_user``). This is the org
    context stamped onto a usage segment so org-scoped compute budget limits can
    be evaluated, and it also decides who pays: a user with a current membership
    bills the org subject (see ``resolve_billing_subject_id_for_user``).
    """
    membership = await get_current_membership_for_user(db, user_id)
    return membership.organization.id if membership is not None else None


async def resolve_billing_subject_id_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> UUID:
    """The subject that pays for a user's compute.

    A user acting under a current org membership bills the org's billing subject
    (org Stripe customer + org grant pool); an org-less user bills their personal
    subject. This mirrors the LLM track exactly: an org member's gateway
    enrollment is minted against the org billing subject
    (``ensure_org_enrollment``), an org-less user's against their personal one
    (``ensure_user_enrollment``), and both keyed off the same current-membership
    test. Deriving both the paying subject and ``organization_id`` from the one
    membership lookup keeps compute attribution and enforcement scope from ever
    disagreeing.
    """
    organization_id = await resolve_organization_id_for_user(db, user_id)
    if organization_id is not None:
        subject = await ensure_organization_billing_subject(db, organization_id)
        return subject.id
    subject = await ensure_personal_billing_subject(db, user_id)
    return subject.id


async def _get_workspace_billing_subject(
    db: AsyncSession,
    workspace_id: UUID,
) -> tuple[UUID, UUID]:
    workspace = await db.get(CloudWorkspace, workspace_id)
    if workspace is None:
        raise RuntimeError("Cloud workspace not found while opening usage segment.")
    subject = await ensure_personal_billing_subject(db, workspace.owner_user_id)
    return subject.id, workspace.owner_user_id


async def _get_runtime_environment_billing_subject(
    db: AsyncSession,
    runtime_environment_id: UUID,
) -> tuple[UUID, UUID]:
    del db, runtime_environment_id
    raise RuntimeError("Cloud runtime environments have been removed.")


async def resolve_billing_subject_id_for_workspace(
    db: AsyncSession,
    workspace_id: UUID,
) -> UUID:
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
    organization_id: UUID | None,
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
            organization_id=organization_id,
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


async def claim_webhook_event_receipt_claim(
    db: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    external_sandbox_id: str | None = None,
    lease_seconds: int = 300,
) -> WebhookEventClaim:
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
            where=and_(
                WebhookEventReceipt.status != "processed",
                or_(
                    WebhookEventReceipt.processing_lease_expires_at.is_(None),
                    WebhookEventReceipt.processing_lease_expires_at < now,
                ),
            ),
        )
        .returning(WebhookEventReceipt.id)
    )
    receipt_id = result.scalar_one_or_none()
    if receipt_id is None:
        existing = (
            await db.execute(
                select(WebhookEventReceipt).where(
                    WebhookEventReceipt.provider == provider,
                    WebhookEventReceipt.event_id == event_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None and existing.status == "processed":
            return WebhookEventClaim(status="already_processed", receipt=existing)
        return WebhookEventClaim(status="in_progress", receipt=existing)
    receipt = await db.get(WebhookEventReceipt, receipt_id)
    if receipt is None:
        raise RuntimeError("Webhook receipt disappeared after claim.")
    return WebhookEventClaim(status="claimed", receipt=receipt)


async def claim_webhook_event_receipt(
    db: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    external_sandbox_id: str | None = None,
    lease_seconds: int = 300,
) -> WebhookEventReceipt | None:
    claim = await claim_webhook_event_receipt_claim(
        db,
        provider=provider,
        event_id=event_id,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
        lease_seconds=lease_seconds,
    )
    return claim.receipt if claim.status == "claimed" else None


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
    db: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    external_sandbox_id: str | None = None,
) -> WebhookEventClaim:
    return await claim_webhook_event_receipt_claim(
        db,
        provider=provider,
        event_id=event_id,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def mark_webhook_event_processed_by_id(
    db: AsyncSession,
    *,
    receipt_id: UUID,
) -> WebhookEventReceipt:
    return await mark_webhook_event_processed(db, receipt_id=receipt_id)


async def mark_webhook_event_failed_by_id(
    db: AsyncSession,
    *,
    receipt_id: UUID,
    error: str,
) -> WebhookEventReceipt:
    return await mark_webhook_event_failed(db, receipt_id=receipt_id, error=error)


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
    elif actor_user_id is not None:
        subject = await ensure_personal_billing_subject(db, actor_user_id)
        billing_subject_id = subject.id
        owner_user_id = actor_user_id
    else:
        raise RuntimeError("Usage segment requires a runtime environment, workspace, or user.")
    # Resolve the org the segment belongs to from the owner's current
    # membership. This is both the enforcement/attribution scope and, when set,
    # who pays: an owner acting under an org bills the org billing subject (org
    # Stripe customer + org grants), matching the LLM track; an org-less owner
    # keeps the personal subject resolved above. Both derive from one membership
    # lookup so ``organization_id`` and ``billing_subject_id`` can never disagree.
    organization_id = await resolve_organization_id_for_user(db, owner_user_id)
    if organization_id is not None:
        org_subject = await ensure_organization_billing_subject(db, organization_id)
        billing_subject_id = org_subject.id
    return await create_usage_segment(
        db,
        user_id=actor_user_id or owner_user_id,
        billing_subject_id=billing_subject_id,
        organization_id=organization_id,
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


async def open_usage_segment_for_sandbox(
    db: AsyncSession,
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
    return await ensure_sandbox_usage_started(
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


async def close_usage_segment_for_sandbox(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> UsageSegment | None:
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
    return segment


async def list_all_open_usage_segments(db: AsyncSession) -> list[UsageSegment]:
    return await list_open_usage_segments(db)


async def remember_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    return await record_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def record_billing_decision_event(
    db: AsyncSession,
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
    await db.flush()


async def with_billing_reconciler_lock[T](
    db: AsyncSession,
    callback: Callable[[AsyncSession], Awaitable[T]],
) -> tuple[bool, T | None]:
    acquired = await try_acquire_billing_reconciler_lock(db)
    if not acquired:
        return False, None
    try:
        result = await callback(db)
        return True, result
    finally:
        await release_billing_reconciler_lock(db)
