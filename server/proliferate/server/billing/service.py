"""Billing service layer."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.billing_accounting import (
    BillingAccountingResult,
    ClaimedUsageExport,
)
from proliferate.db.store.billing_subjects import (
    BillingSubjectStripeState,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
)
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.billing import accounting_pass as billing_accounting_pass_service
from proliferate.server.billing import authorization as billing_authorization
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.models import (
    BillingSnapshot,
    SandboxStartAuthorization,
)
from proliferate.server.billing.snapshot_state import BillingSnapshotState


def repo_limit_for_billing_snapshot(snapshot: BillingSnapshot) -> int | None:
    return billing_snapshots.repo_limit_for_billing_snapshot(snapshot)


async def ensure_personal_billing_subject_state(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_user_stripe_customer_state(db, user_id)


async def ensure_organization_billing_subject_state(
    db: AsyncSession,
    organization_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_organization_stripe_customer_state(db, organization_id)


async def get_billing_snapshot(user_id: UUID) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot(user_id)


async def get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_request(db, user_id)


async def get_billing_snapshot_for_subject(billing_subject_id: UUID) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject(billing_subject_id)


async def get_billing_snapshot_for_subject_in_session(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        billing_subject_id,
    )


async def authorize_sandbox_start_for_billing_subject(
    *,
    actor_user_id: UUID | None,
    billing_subject_id: UUID,
    workspace_id: UUID | None = None,
) -> SandboxStartAuthorization:
    return await billing_authorization.authorize_sandbox_start_for_billing_subject(
        actor_user_id=actor_user_id,
        billing_subject_id=billing_subject_id,
        workspace_id=workspace_id,
    )


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    return await billing_authorization.authorize_sandbox_start(
        user_id=user_id,
        workspace_id=workspace_id,
    )


async def state_with_overage_usage(
    db: AsyncSession,
    state: BillingSnapshotState,
) -> BillingSnapshotState:
    return await billing_snapshots.state_with_overage_usage(db, state)


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
    return await billing_accounting_service.account_usage_for_billing_subject(
        billing_subject_id=billing_subject_id,
        is_paid_cloud=is_paid_cloud,
        billing_subscription_id=billing_subscription_id,
        period_start=period_start,
        period_end=period_end,
        overage_enabled=overage_enabled,
        billing_mode=billing_mode,
        overage_cap_cents=overage_cap_cents,
        consume_grants=consume_grants,
        export_overage=export_overage,
        scan_until=scan_until,
    )


async def claim_usage_exports_for_sending(*, limit: int = 100) -> list[ClaimedUsageExport]:
    return await billing_accounting_service.claim_usage_exports_for_sending(limit=limit)


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    await billing_accounting_pass_service.run_billing_accounting_pass(
        subject_limit=subject_limit,
    )


async def process_pending_seat_adjustments(*, limit: int = 100) -> None:
    await billing_accounting_service.process_pending_seat_adjustments(limit=limit)


async def send_pending_usage_exports(*, limit: int = 100) -> None:
    await billing_accounting_service.send_pending_usage_exports(limit=limit)
