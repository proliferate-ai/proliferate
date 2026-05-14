"""HTTP routes for cloud-synced session snapshots and streams."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.events.models import CloudSessionSnapshotResponse
from proliferate.server.cloud.events.service import (
    ensure_visible_session_target,
    get_session_snapshot,
)
from proliferate.server.cloud.live.service import stream_session_events

router = APIRouter(prefix="/sessions", tags=["cloud-sessions"])


@router.get("/{session_id}/snapshot", response_model=CloudSessionSnapshotResponse)
async def get_session_snapshot_endpoint(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudSessionSnapshotResponse:
    try:
        resolved_target_id = await ensure_visible_session_target(
            db,
            target_id=target_id,
            session_id=session_id,
            user_id=user.id,
        )
        return await get_session_snapshot(
            db,
            target_id=resolved_target_id,
            session_id=session_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/{session_id}/stream")
async def stream_session_endpoint(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    after_seq: int = Query(default=0, alias="afterSeq"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> StreamingResponse:
    try:
        resolved_target_id = await ensure_visible_session_target(
            db,
            target_id=target_id,
            session_id=session_id,
            user_id=user.id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)

    return StreamingResponse(
        stream_session_events(
            target_id=resolved_target_id,
            session_id=session_id,
            after_seq=after_seq,
        ),
        media_type="text/event-stream",
    )
