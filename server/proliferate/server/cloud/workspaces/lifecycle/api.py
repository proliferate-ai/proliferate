from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.workspaces.lifecycle.models import (
    WorkspaceLifecycleMutationResponse,
)
from proliferate.server.cloud.workspaces.lifecycle.service import (
    archive_cloud_workspace,
    delete_cloud_workspace,
    purge_cloud_workspace,
    restore_cloud_workspace,
    stop_cloud_workspace,
)
from proliferate.server.cloud.workspaces.models import WorkspaceDetail

router = APIRouter()


@router.post("/workspaces/{workspace_id}/stop", response_model=WorkspaceDetail)
async def stop_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        payload = await stop_cloud_workspace(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.post("/workspaces/{workspace_id}/archive", response_model=WorkspaceDetail)
async def archive_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await archive_cloud_workspace(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/restore", response_model=WorkspaceDetail)
async def restore_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await restore_cloud_workspace(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/workspaces/{workspace_id}/purge",
    response_model=WorkspaceLifecycleMutationResponse,
)
@router.delete(
    "/workspaces/{workspace_id}/purge",
    response_model=WorkspaceLifecycleMutationResponse,
)
async def purge_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceLifecycleMutationResponse:
    try:
        await purge_cloud_workspace(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return WorkspaceLifecycleMutationResponse()


@router.delete(
    "/workspaces/{workspace_id}",
    response_model=WorkspaceLifecycleMutationResponse,
)
async def delete_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceLifecycleMutationResponse:
    try:
        await delete_cloud_workspace(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return WorkspaceLifecycleMutationResponse()
