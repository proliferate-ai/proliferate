"""Minimal Cloud SSE routes for synced sessions."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.events.service import list_cloud_session_events

router = APIRouter(prefix="/live", tags=["cloud-live"])


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/sessions/{session_id}/stream")
async def stream_cloud_session_endpoint(
    session_id: UUID,
    after_sequence: int = Query(default=0, alias="afterSequence"),
    _: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> StreamingResponse:
    async def body() -> AsyncIterator[str]:
        events = await list_cloud_session_events(
            db,
            session_id=session_id,
            after_sequence=after_sequence,
            limit=200,
        )
        for event in events:
            yield _sse("event", event.model_dump(mode="json", by_alias=True))
        yield _sse("heartbeat", {"ok": True})

    return StreamingResponse(body(), media_type="text/event-stream")
