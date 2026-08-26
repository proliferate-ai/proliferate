"""Cloud workspace API routes."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.workspaces.materializations import access as materializations_access
from proliferate.server.cloud.workspaces.materializations import (
    service as materializations_service,
)
from proliferate.server.cloud.workspaces.models import (
    CloudWorkspaceRuntimeStatusResponse,
    CreateCloudWorkspaceRequest,
    CreateMaterializationIntentRequest,
    MaterializationIntentResponse,
    ReportMaterializationRequest,
    UpdateCloudWorkspaceDisplayNameRequest,
    WorkspaceDetail,
    WorkspaceMaterializationSummary,
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
from proliferate.server.github.transactions import (
    commit_github_app_reauthorization_on_error,
)

_REAUTH_TRANSACTION_DEPENDENCIES = [Depends(commit_github_app_reauthorization_on_error)]

router = APIRouter()


@router.get("/workspaces", response_model=list[WorkspaceSummary])
async def list_cloud_workspaces_endpoint(
    lifecycle: Literal["active", "archived", "all"] = Query("active"),
    desktop_install_id: str | None = Query(default=None, alias="desktopInstallId"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[WorkspaceSummary]:
    return await list_cloud_workspaces_for_user(
        db,
        user.id,
        lifecycle=lifecycle,
        desktop_install_id=desktop_install_id,
    )


@router.post(
    "/workspaces",
    response_model=WorkspaceDetail,
    dependencies=_REAUTH_TRANSACTION_DEPENDENCIES,
)
async def create_cloud_workspace_endpoint(
    body: CreateCloudWorkspaceRequest,
    user: User = Depends(current_product_user),
    # Workspace provisioning performs remote work before its final Cloud row
    # write. Commit that final request transaction before the response starts so
    # a caller disconnect cannot observe success while dependency teardown rolls
    # the workspace back.
    db: AsyncSession = Depends(get_async_session, scope="function"),
) -> WorkspaceDetail:
    return await create_cloud_workspace_for_user(db, user, body)


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceDetail)
async def get_cloud_workspace_endpoint(
    workspace_id: UUID,
    desktop_install_id: str | None = Query(default=None, alias="desktopInstallId"),
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    return await get_cloud_workspace_detail(
        db,
        user.id,
        workspace_id,
        desktop_install_id=desktop_install_id,
    )


@router.post(
    "/workspaces/{workspace_id}/materializations",
    response_model=MaterializationIntentResponse,
)
async def create_workspace_materialization_intent_endpoint(
    workspace_id: UUID,
    body: CreateMaterializationIntentRequest,
    access: materializations_access.CreateLocalMaterializationAccess = Depends(
        materializations_access.create_local_materialization_access
    ),
    db: AsyncSession = Depends(get_async_session),
) -> MaterializationIntentResponse:
    return await materializations_service.create_local_materialization_intent(
        db,
        user_id=access.actor_user_id,
        workspace=access.workspace,
        desktop_install_id=access.desktop_install_id,
    )


@router.put(
    "/workspaces/{workspace_id}/materializations/{materialization_id}",
    response_model=WorkspaceMaterializationSummary,
)
async def report_workspace_materialization_endpoint(
    workspace_id: UUID,
    materialization_id: UUID,
    body: ReportMaterializationRequest,
    access: materializations_access.ExistingLocalMaterializationAccess = Depends(
        materializations_access.report_local_materialization_access
    ),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceMaterializationSummary:
    return await materializations_service.report_materialization(
        db,
        materialization=access.materialization,
        body=body,
    )


@router.delete(
    "/workspaces/{workspace_id}/materializations/{materialization_id}",
    status_code=204,
)
async def unlink_workspace_materialization_endpoint(
    workspace_id: UUID,
    materialization_id: UUID,
    access: materializations_access.ExistingLocalMaterializationAccess = Depends(
        materializations_access.unlink_local_materialization_access
    ),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    await materializations_service.unlink_materialization(
        db,
        materialization=access.materialization,
    )


@router.get(
    "/workspaces/{workspace_id}/runtime-status",
    response_model=CloudWorkspaceRuntimeStatusResponse,
)
async def get_cloud_workspace_runtime_status_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudWorkspaceRuntimeStatusResponse:
    return await get_cloud_workspace_runtime_status(db, user.id, workspace_id)


@router.patch("/workspaces/{workspace_id}/display-name", response_model=WorkspaceDetail)
async def update_cloud_workspace_display_name_endpoint(
    workspace_id: UUID,
    body: UpdateCloudWorkspaceDisplayNameRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    return await sync_cloud_workspace_display_name(
        db,
        user.id,
        workspace_id,
        display_name=body.display_name,
    )


@router.post("/workspaces/{workspace_id}/archive", response_model=WorkspaceDetail)
async def archive_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    return await archive_cloud_workspace_for_user(db, user.id, workspace_id)


@router.post("/workspaces/{workspace_id}/restore", response_model=WorkspaceDetail)
async def restore_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkspaceDetail:
    return await restore_cloud_workspace_for_user(db, user.id, workspace_id)


@router.delete("/workspaces/{workspace_id}", status_code=204)
async def delete_cloud_workspace_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    await delete_cloud_workspace_for_user(db, user.id, workspace_id)
