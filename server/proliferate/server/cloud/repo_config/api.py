from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.repo_config.models import (
    CloudRepoConfigResponse,
    CloudRepoConfigsListResponse,
    CloudWorkspaceRepoConfigStatusResponse,
    PutCloudRepoFileRequest,
    ResyncCloudWorkspaceFilesResponse,
    RunCloudWorkspaceSetupResponse,
    SaveCloudRepoConfigRequest,
    repo_config_payload,
    repo_config_summary_payload,
    resync_cloud_workspace_files_payload,
    run_cloud_workspace_setup_payload,
    workspace_repo_config_status_payload,
)
from proliferate.server.cloud.repo_config.service import (
    get_repo_config,
    get_workspace_repo_config_status,
    list_repo_configs,
    resync_workspace_files,
    run_workspace_setup,
    save_repo_config,
    save_repo_file,
)

router = APIRouter()


def _default_repo_config_response() -> CloudRepoConfigResponse:
    return CloudRepoConfigResponse(
        configured=False,
        configured_at=None,
        default_branch=None,
        env_vars={},
        setup_script="",
        run_command="",
        files_version=0,
        tracked_files=[],
    )


@router.get("/repos/configs", response_model=CloudRepoConfigsListResponse)
async def list_cloud_repo_configs_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudRepoConfigsListResponse:
    return CloudRepoConfigsListResponse(
        configs=[
            repo_config_summary_payload(value) for value in await list_repo_configs(db, user.id)
        ]
    )


@router.get("/repos/{git_owner}/{git_repo_name}/config", response_model=CloudRepoConfigResponse)
async def get_cloud_repo_config_endpoint(
    git_owner: str,
    git_repo_name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudRepoConfigResponse:
    value = await get_repo_config(
        db,
        user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return _default_repo_config_response() if value is None else repo_config_payload(value)


@router.put("/repos/{git_owner}/{git_repo_name}/config", response_model=CloudRepoConfigResponse)
async def save_cloud_repo_config_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: SaveCloudRepoConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudRepoConfigResponse:
    try:
        value = await save_repo_config(
            db,
            user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return repo_config_payload(value)


@router.put("/repos/{git_owner}/{git_repo_name}/files", response_model=CloudRepoConfigResponse)
async def save_cloud_repo_file_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: PutCloudRepoFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudRepoConfigResponse:
    try:
        value = await save_repo_file(
            db,
            user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return repo_config_payload(value)


@router.get(
    "/workspaces/{workspace_id}/repo-config-status",
    response_model=CloudWorkspaceRepoConfigStatusResponse,
)
async def get_cloud_workspace_repo_config_status_endpoint(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudWorkspaceRepoConfigStatusResponse:
    try:
        status = await get_workspace_repo_config_status(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return workspace_repo_config_status_payload(status)


@router.post(
    "/workspaces/{workspace_id}/resync-files",
    response_model=ResyncCloudWorkspaceFilesResponse,
)
async def resync_cloud_workspace_files_endpoint(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> ResyncCloudWorkspaceFilesResponse:
    try:
        status = await resync_workspace_files(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return resync_cloud_workspace_files_payload(status)


@router.post(
    "/workspaces/{workspace_id}/run-setup",
    response_model=RunCloudWorkspaceSetupResponse,
)
async def run_cloud_workspace_setup_endpoint(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> RunCloudWorkspaceSetupResponse:
    try:
        status = await run_workspace_setup(db, user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return run_cloud_workspace_setup_payload(status)
