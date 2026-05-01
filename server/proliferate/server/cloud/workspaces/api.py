from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.workspaces.models import (
    CreateCloudWorkspaceRequest,
    UpdateCloudWorkspaceBranchRequest,
    UpdateCloudWorkspaceDisplayNameRequest,
    WorkspaceConnection,
    WorkspaceDetail,
    WorkspaceSummary,
)
from proliferate.server.cloud.workspaces.service import (
    create_cloud_workspace,
    delete_cloud_workspace,
    get_cloud_connection,
    get_cloud_workspace_detail,
    list_cloud_workspaces_for_user,
    start_cloud_workspace,
    stop_cloud_workspace,
    sync_cloud_workspace_branch,
    sync_cloud_workspace_credentials,
    sync_cloud_workspace_display_name,
)
from proliferate.server.organizations.service import OwnerSelection

router = APIRouter()


@router.get("/workspaces", response_model=list[WorkspaceSummary])
async def list_cloud_workspaces_endpoint(
    owner_scope: Literal["personal", "organization"] = Query("personal", alias="ownerScope"),
    organization_id: UUID | None = Query(default=None, alias="organizationId"),
    user: User = Depends(current_active_user),
) -> list[WorkspaceSummary]:
    try:
        return await list_cloud_workspaces_for_user(
            user.id,
            user=user,
            owner_selection=OwnerSelection(
                owner_scope=owner_scope,
                organization_id=organization_id,
            ),
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces", response_model=WorkspaceDetail)
async def create_cloud_workspace_endpoint(
    body: CreateCloudWorkspaceRequest,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        payload = await create_cloud_workspace(
            user,
            git_provider=body.git_provider,
            git_owner=body.git_owner,
            git_repo_name=body.git_repo_name,
            base_branch=body.base_branch,
            branch_name=body.branch_name,
            display_name=body.display_name,
            owner_selection=OwnerSelection(
                owner_scope=body.owner_scope,
                organization_id=body.organization_id,
            ),
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
async def get_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        return await get_cloud_workspace_detail(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/workspaces/{workspace_id}/connection", response_model=WorkspaceConnection)
async def get_cloud_workspace_connection_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> WorkspaceConnection:
    try:
        return await get_cloud_connection(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/workspaces/{workspace_id}/start", response_model=WorkspaceDetail)
async def start_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        payload = await start_cloud_workspace(user, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.post("/workspaces/{workspace_id}/stop", response_model=WorkspaceDetail)
async def stop_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        payload = await stop_cloud_workspace(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.patch("/workspaces/{workspace_id}/branch", response_model=WorkspaceDetail)
async def update_cloud_workspace_branch_endpoint(
    workspace_id: UUID,
    body: UpdateCloudWorkspaceBranchRequest,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        payload = await sync_cloud_workspace_branch(
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
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        payload = await sync_cloud_workspace_display_name(
            user.id,
            workspace_id,
            display_name=body.display_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.post("/workspaces/{workspace_id}/sync-credentials", response_model=WorkspaceDetail)
async def sync_cloud_workspace_credentials_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> WorkspaceDetail:
    try:
        payload = await sync_cloud_workspace_credentials(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return payload


@router.delete("/workspaces/{workspace_id}")
async def delete_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> dict[str, bool]:
    try:
        await delete_cloud_workspace(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return {"ok": True}
