"""Cloud synced event read orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.events import list_session_events
from proliferate.server.cloud.events.models import CloudSessionEventResponse, event_response


async def list_cloud_session_events(
    db: AsyncSession,
    *,
    session_id: UUID,
    after_sequence: int,
    limit: int,
) -> list[CloudSessionEventResponse]:
    events = await list_session_events(
        db,
        session_id=session_id,
        after_sequence=after_sequence,
        limit=limit,
    )
    return [event_response(event) for event in events]
