"""Cloud workspace API routes."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.workspaces.models import (
    CloudWorkspaceRuntimeStatusResponse,
    CreateCloudWorkspaceRequest,
    UpdateCloudWorkspaceDisplayNameRequest,
    WorkspaceDetail,
    WorkspaceSummary,
)
from proliferate.server.cloud.workspaces.service import (
    archive_cloud_workspace_for_user,
    create_cloud_workspace_for_user,
    delete_cloud_workspace_for_user,
    get_cloud_workspace_detail,
    get_cloud_workspace_runtime_status,
    list_cloud_workspaces_for_user,
    restore_cloud_workspace_for_user,
    sync_cloud_workspace_display_name,
)

router = APIRouter()


@router.get("/workspaces", response_model=list[WorkspaceSummary])
async def list_cloud_workspaces_endpoint(
    lifecycle: Literal["active", "archived", "all"] = Query("active"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[WorkspaceSummary]:
    try:
        return await list_cloud_workspaces_for_user(
            db,
            user.id,
            lifecycle=lifecycle,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces", response_model=WorkspaceDetail)
async def create_cloud_workspace_endpoint(
    body: CreateCloudWorkspaceRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await create_cloud_workspace_for_user(db, user, body)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
async def get_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await get_cloud_workspace_detail(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get(
    "/workspaces/{workspace_id}/runtime-status",
    response_model=CloudWorkspaceRuntimeStatusResponse,
)
async def get_cloud_workspace_runtime_status_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudWorkspaceRuntimeStatusResponse:
    try:
        return await get_cloud_workspace_runtime_status(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.patch("/workspaces/{workspace_id}/display-name", response_model=WorkspaceDetail)
async def update_cloud_workspace_display_name_endpoint(
    workspace_id: UUID,
    body: UpdateCloudWorkspaceDisplayNameRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await sync_cloud_workspace_display_name(
            db,
            user.id,
            workspace_id,
            display_name=body.display_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/archive", response_model=WorkspaceDetail)
async def archive_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await archive_cloud_workspace_for_user(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/restore", response_model=WorkspaceDetail)
async def restore_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        return await restore_cloud_workspace_for_user(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.delete("/workspaces/{workspace_id}", status_code=204)
async def delete_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    try:
        await delete_cloud_workspace_for_user(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
