"""Short-lived access checks for cloud live streams."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.events.service import ensure_visible_session_target
from proliferate.server.cloud.targets.service import get_target_detail
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.server.cloud.workspaces.service import get_cloud_workspace_detail


@dataclass(frozen=True)
class LiveSessionStreamAccess:
    target_id: UUID
    session_id: str


async def session_stream_user_can_read(
    session_id: str,
    target_id: UUID = Query(alias="targetId"),
    user: User = Depends(current_active_user),
) -> LiveSessionStreamAccess:
    async def read(db: AsyncSession) -> LiveSessionStreamAccess:
        resolved_target_id = await ensure_visible_session_target(
            db,
            target_id=target_id,
            session_id=session_id,
            user_id=user.id,
        )
        return LiveSessionStreamAccess(
            target_id=resolved_target_id,
            session_id=session_id,
        )

    return await _read_with_short_session(read)


async def workspace_stream_user_can_read(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    async def read(db: AsyncSession) -> WorkspaceDetail:
        return await get_cloud_workspace_detail(db, user.id, workspace_id)

    return await _read_with_short_session(read)


async def target_stream_user_can_read(
    target_id: UUID,
    user: User = Depends(current_active_user),
) -> targets_store.CloudTargetSnapshot:
    async def read(db: AsyncSession) -> targets_store.CloudTargetSnapshot:
        return await get_target_detail(db, target_id=target_id, user_id=user.id)

    return await _read_with_short_session(read)


async def _read_with_short_session[T](read: Callable[[AsyncSession], Awaitable[T]]) -> T:
    # Yield dependencies remain open for the lifetime of StreamingResponse.
    async with db_engine.async_session_factory() as db:
        try:
            result = await read(db)
        except CloudApiError as error:
            await db.rollback()
            raise_cloud_error(error)
        except Exception:
            await db.rollback()
            raise
        await db.rollback()
        return result
