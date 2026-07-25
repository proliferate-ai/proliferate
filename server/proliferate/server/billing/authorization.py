"""Billing authorization gates for managed cloud starts."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_AUTHORIZE_START,
    BILLING_MODE_ENFORCE,
)
from proliferate.db import session_ops as db_session
from proliferate.db.store.billing_runtime_usage import (
    record_billing_decision_event,
    resolve_billing_subject_id_for_workspace,
)
from proliferate.server.billing import snapshot_state
from proliferate.server.billing.domain.plans import authorization_message
from proliferate.server.billing.models import BillingSnapshot, SandboxStartAuthorization
from proliferate.server.billing.snapshots import (
    build_billing_snapshot,
    state_with_overage_usage,
)


async def authorize_sandbox_start_for_billing_subject(
    *,
    actor_user_id: UUID | None,
    billing_subject_id: UUID,
    workspace_id: UUID | None = None,
) -> SandboxStartAuthorization:
    async with db_session.open_async_transaction() as db:
        state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
        state = await state_with_overage_usage(db, state)
        snapshot = build_billing_snapshot(state)
        return await record_sandbox_start_authorization(
            db,
            snapshot,
            actor_user_id=actor_user_id,
            workspace_id=workspace_id,
        )


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    async with db_session.open_async_transaction() as db:
        if workspace_id is None:
            state = await snapshot_state.load_snapshot_state_for_user(db, user_id)
        else:
            billing_subject_id = await resolve_billing_subject_id_for_workspace(
                db,
                workspace_id,
            )
            state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
        state = await state_with_overage_usage(db, state)
        snapshot = build_billing_snapshot(state)
        return await record_sandbox_start_authorization(
            db,
            snapshot,
            actor_user_id=user_id,
            workspace_id=workspace_id,
        )


async def record_sandbox_start_authorization(
    db: AsyncSession,
    snapshot: BillingSnapshot,
    *,
    actor_user_id: UUID | None,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    enforced = settings.cloud_billing_mode == BILLING_MODE_ENFORCE
    allowed = not enforced or not snapshot.start_blocked
    reason = snapshot.start_block_reason if snapshot.start_blocked else None
    await record_billing_decision_event(
        db,
        billing_subject_id=snapshot.billing_subject_id,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
        decision_type=BILLING_DECISION_AUTHORIZE_START,
        mode=settings.cloud_billing_mode,
        would_block_start=snapshot.start_blocked,
        would_pause_active=snapshot.active_spend_hold,
        reason=reason,
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )
    return SandboxStartAuthorization(
        allowed=allowed,
        billing_subject_id=snapshot.billing_subject_id,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        message=authorization_message(reason),
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
        active_environment_limit=snapshot.active_environment_limit,
    )
