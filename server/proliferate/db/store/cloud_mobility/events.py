from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.analytics import CloudWorkspaceMobilityEvent
from proliferate.utils.time import utcnow


def _record_mobility_event(
    db: AsyncSession,
    *,
    user_id: UUID,
    cloud_workspace_id: UUID | None,
    handoff_op_id: UUID | None,
    event_type: str,
    direction: str | None = None,
    source_owner: str | None = None,
    target_owner: str | None = None,
    from_phase: str | None = None,
    to_phase: str | None = None,
    failure_code: str | None = None,
    occurred_at: datetime,
) -> None:
    db.add(
        CloudWorkspaceMobilityEvent(
            user_id=user_id,
            cloud_workspace_id=cloud_workspace_id,
            handoff_op_id=handoff_op_id,
            event_type=event_type,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
            from_phase=from_phase,
            to_phase=to_phase,
            failure_code=failure_code,
            occurred_at=occurred_at,
            created_at=occurred_at,
        )
    )


async def record_cloud_workspace_mobility_event_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    cloud_workspace_id: UUID | None,
    handoff_op_id: UUID | None,
    event_type: str,
    direction: str | None = None,
    source_owner: str | None = None,
    target_owner: str | None = None,
    from_phase: str | None = None,
    to_phase: str | None = None,
    failure_code: str | None = None,
) -> None:
    _record_mobility_event(
        db,
        user_id=user_id,
        cloud_workspace_id=cloud_workspace_id,
        handoff_op_id=handoff_op_id,
        event_type=event_type,
        direction=direction,
        source_owner=source_owner,
        target_owner=target_owner,
        from_phase=from_phase,
        to_phase=to_phase,
        failure_code=failure_code,
        occurred_at=utcnow(),
    )
    await db.flush()
