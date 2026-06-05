from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.server.cloud.workspaces.remote_access.models import (
    BootstrapWorkspaceRemoteAccessRequest,
    WorkspaceConnection,
)
from proliferate.server.cloud.workspaces.remote_access.service import (
    bootstrap_workspace_remote_access,
    disable_cloud_workspace_remote_access,
    enable_cloud_workspace_remote_access,
    get_cloud_connection,
)

router = APIRouter()


@router.post("/workspaces/remote-access", response_model=WorkspaceDetail)
async def bootstrap_workspace_remote_access_endpoint(
    body: BootstrapWorkspaceRemoteAccessRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await bootstrap_workspace_remote_access(db, user, body)
    except CloudApiError as error:
        log_cloud_event(
            "cloud remote access bootstrap rejected",
            error_code=error.code,
            status_code=error.status_code,
            target_id=body.target_id,
            anyharness_workspace_id=body.anyharness_workspace_id,
        )
        raise_cloud_error(error)


@router.get("/workspaces/{workspace_id}/connection", response_model=WorkspaceConnection)
async def get_cloud_workspace_connection_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceConnection:
    try:
        return await get_cloud_connection(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/remote-access/enable", response_model=WorkspaceDetail)
async def enable_cloud_workspace_remote_access_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await enable_cloud_workspace_remote_access(db, user, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/remote-access/disable", response_model=WorkspaceDetail)
async def disable_cloud_workspace_remote_access_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await disable_cloud_workspace_remote_access(db, user, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
