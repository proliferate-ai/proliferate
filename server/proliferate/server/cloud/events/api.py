"""Cloud synced event read routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.events.models import CloudSessionEventResponse
from proliferate.server.cloud.events.service import list_cloud_session_events

router = APIRouter(prefix="/events", tags=["cloud-events"])


@router.get("/sessions/{session_id}", response_model=list[CloudSessionEventResponse])
async def list_cloud_session_events_endpoint(
    session_id: UUID,
    after_sequence: int = Query(default=0, alias="afterSequence"),
    limit: int = Query(default=200, ge=1, le=1000),
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[CloudSessionEventResponse]:
    return await list_cloud_session_events(
        db,
        session_id=session_id,
        after_sequence=after_sequence,
        limit=limit,
    )
