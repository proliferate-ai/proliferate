from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerSelection
from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.workspaces.lifecycle.api import router as lifecycle_router
from proliferate.server.cloud.workspaces.models import (
    UpdateCloudWorkspaceBranchRequest,
    UpdateCloudWorkspaceDisplayNameRequest,
    WorkspaceDetail,
    WorkspaceSummary,
)
from proliferate.server.cloud.workspaces.provisioning.api import router as provisioning_router
from proliferate.server.cloud.workspaces.remote_access.api import router as remote_access_router
from proliferate.server.cloud.workspaces.service import (
    get_cloud_workspace_detail,
    list_cloud_workspaces_for_user,
    sync_cloud_workspace_branch,
    sync_cloud_workspace_display_name,
)
from proliferate.server.cloud.workspaces.target_launch.api import router as target_launch_router

router = APIRouter()


@router.get("/workspaces", response_model=list[WorkspaceSummary])
async def list_cloud_workspaces_endpoint(
    owner_scope: Literal["personal", "organization"] = Query("personal", alias="ownerScope"),
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    scope: Literal["my", "unclaimed", "claimable", "org-all", "exposed"] | None = Query(
        default=None,
    ),
    lifecycle: Literal["active", "archived", "all"] = Query("active"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[WorkspaceSummary]:
    try:
        return await list_cloud_workspaces_for_user(
            db,
            user.id,
            user=user,
            owner_selection=OwnerSelection(
                owner_scope=owner_scope,
                organization_id=organization_id,
            ),
            scope=scope,
            lifecycle=lifecycle,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


router.include_router(provisioning_router)
router.include_router(target_launch_router)
router.include_router(remote_access_router)
router.include_router(lifecycle_router)


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


@router.patch("/workspaces/{workspace_id}/branch", response_model=WorkspaceDetail)
async def update_cloud_workspace_branch_endpoint(
    workspace_id: UUID,
    body: UpdateCloudWorkspaceBranchRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        payload = await sync_cloud_workspace_branch(
            db,
            user.id,
            workspace_id,
            branch_name=body.branch_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.patch("/workspaces/{workspace_id}/display-name", response_model=WorkspaceDetail)
async def update_cloud_workspace_display_name_endpoint(
    workspace_id: UUID,
    body: UpdateCloudWorkspaceDisplayNameRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    try:
        payload = await sync_cloud_workspace_display_name(
            db,
            user.id,
            workspace_id,
            display_name=body.display_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload
