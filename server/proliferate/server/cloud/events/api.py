"""HTTP routes for cloud-synced session snapshots and streams."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.events.models import (
    CloudSessionProjectionResponse,
    CloudSessionSnapshotResponse,
)
from proliferate.server.cloud.events.service import (
    ensure_visible_session_target,
    get_session_snapshot,
    list_session_summaries,
)
from proliferate.server.cloud.live.models import (
    CloudSessionEventsResponse,
    CloudTranscriptSnapshotResponse,
)
from proliferate.server.cloud.live.service import (
    get_transcript_snapshot,
    list_session_events_after,
)

router = APIRouter(prefix="/sessions", tags=["cloud-sessions"])


@router.get("", response_model=list[CloudSessionProjectionResponse])
async def list_sessions_endpoint(
    target_id: UUID = Query(alias="targetId"),
    cloud_workspace_id: UUID | None = Query(default=None, alias="cloudWorkspaceId"),
    workspace_id: str | None = Query(default=None, alias="workspaceId"),
    limit: int = Query(default=100, ge=1, le=200),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> list[CloudSessionProjectionResponse]:
    try:
        return await list_session_summaries(
            db,
            target_id=target_id,
            user_id=user.id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            limit=limit,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/{session_id}/snapshot", response_model=CloudSessionSnapshotResponse)
async def get_session_snapshot_endpoint(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
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


@router.get("/{session_id}", response_model=CloudSessionSnapshotResponse)
async def get_session_snapshot_alias_endpoint(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
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


@router.get("/{session_id}/transcript", response_model=CloudTranscriptSnapshotResponse)
async def get_transcript_snapshot_endpoint(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudTranscriptSnapshotResponse:
    try:
        resolved_target_id = await ensure_visible_session_target(
            db,
            target_id=target_id,
            session_id=session_id,
            user_id=user.id,
        )
        return await get_transcript_snapshot(
            db,
            target_id=resolved_target_id,
            session_id=session_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/{session_id}/events", response_model=CloudSessionEventsResponse)
async def list_session_events_endpoint(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    after_seq: int = Query(default=0, alias="afterSeq"),
    limit: int = Query(default=100, ge=1, le=200),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSessionEventsResponse:
    try:
        resolved_target_id = await ensure_visible_session_target(
            db,
            target_id=target_id,
            session_id=session_id,
            user_id=user.id,
        )
        return await list_session_events_after(
            db,
            target_id=resolved_target_id,
            session_id=session_id,
            after_seq=after_seq,
            limit=limit,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
