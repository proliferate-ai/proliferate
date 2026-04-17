"""Billing decision-event persistence."""

from __future__ import annotations

from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.models.billing import BillingDecisionEvent
from proliferate.server.billing.models import utcnow


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
