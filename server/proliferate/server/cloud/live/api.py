"""HTTP routes for cloud live snapshots and SSE streams."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.live.access import (
    LiveSessionStreamAccess,
    session_stream_user_can_read,
    target_stream_user_can_read,
    workspace_stream_user_can_read,
)
from proliferate.server.cloud.live.models import CloudWorkspaceSnapshotResponse
from proliferate.server.cloud.live.service import (
    get_workspace_snapshot,
    stream_session_events,
    stream_target_events,
    stream_workspace_events,
)
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.server.cloud.workspaces.service import get_cloud_workspace_detail

router = APIRouter(tags=["cloud-live"])


@router.get("/workspaces/{workspace_id}/snapshot", response_model=CloudWorkspaceSnapshotResponse)
async def get_workspace_snapshot_endpoint(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudWorkspaceSnapshotResponse:
    try:
        workspace = await get_cloud_workspace_detail(db, user.id, workspace_id)
        return await get_workspace_snapshot(db, workspace=workspace)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/sessions/{session_id}/stream")
async def stream_session_endpoint(
    after_seq: int = Query(default=0, alias="afterSeq"),
    access: LiveSessionStreamAccess = Depends(session_stream_user_can_read),
) -> StreamingResponse:
    return StreamingResponse(
        stream_session_events(
            target_id=access.target_id,
            session_id=access.session_id,
            after_seq=after_seq,
        ),
        media_type="text/event-stream",
    )


@router.get("/workspaces/{workspace_id}/stream")
async def stream_workspace_endpoint(
    after_seq: int = Query(default=0, alias="afterSeq"),
    workspace: WorkspaceDetail = Depends(workspace_stream_user_can_read),
) -> StreamingResponse:
    return StreamingResponse(
        stream_workspace_events(
            workspace=workspace,
            after_seq=after_seq,
        ),
        media_type="text/event-stream",
    )


@router.get("/targets/{target_id}/stream")
async def stream_target_endpoint(
    after_seq: int = Query(default=0, alias="afterSeq"),
    target: targets_store.CloudTargetSnapshot = Depends(target_stream_user_can_read),
) -> StreamingResponse:
    return StreamingResponse(
        stream_target_events(target_id=target.id, after_seq=after_seq),
        media_type="text/event-stream",
    )
