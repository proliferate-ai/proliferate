from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.repo_config.models import (
    CloudRepoConfigResponse,
    CloudRepoConfigsListResponse,
    CloudWorkspaceRepoConfigStatusResponse,
    PutCloudRepoFileRequest,
    RunCloudWorkspaceSetupResponse,
    ResyncCloudWorkspaceFilesResponse,
    SaveCloudRepoConfigRequest,
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


@router.get("/repos/configs", response_model=CloudRepoConfigsListResponse)
async def list_cloud_repo_configs_endpoint(
    user: User = Depends(current_active_user),
) -> CloudRepoConfigsListResponse:
    return await list_repo_configs(user.id)


@router.get("/repos/{git_owner}/{git_repo_name}/config", response_model=CloudRepoConfigResponse)
async def get_cloud_repo_config_endpoint(
    git_owner: str,
    git_repo_name: str,
    user: User = Depends(current_active_user),
) -> CloudRepoConfigResponse:
    return await get_repo_config(
        user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )


@router.put("/repos/{git_owner}/{git_repo_name}/config", response_model=CloudRepoConfigResponse)
async def save_cloud_repo_config_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: SaveCloudRepoConfigRequest,
    user: User = Depends(current_active_user),
) -> CloudRepoConfigResponse:
    try:
        return await save_repo_config(
            user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.put("/repos/{git_owner}/{git_repo_name}/files", response_model=CloudRepoConfigResponse)
async def save_cloud_repo_file_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: PutCloudRepoFileRequest,
    user: User = Depends(current_active_user),
) -> CloudRepoConfigResponse:
    try:
        return await save_repo_file(
            user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get(
    "/workspaces/{workspace_id}/repo-config-status",
    response_model=CloudWorkspaceRepoConfigStatusResponse,
)
async def get_cloud_workspace_repo_config_status_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> CloudWorkspaceRepoConfigStatusResponse:
    try:
        return await get_workspace_repo_config_status(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/workspaces/{workspace_id}/resync-files",
    response_model=ResyncCloudWorkspaceFilesResponse,
)
async def resync_cloud_workspace_files_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> ResyncCloudWorkspaceFilesResponse:
    try:
        return await resync_workspace_files(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post(
    "/workspaces/{workspace_id}/run-setup",
    response_model=RunCloudWorkspaceSetupResponse,
)
async def run_cloud_workspace_setup_endpoint(
    workspace_id: UUID,
    user: User = Depends(current_active_user),
) -> RunCloudWorkspaceSetupResponse:
    try:
        return await run_workspace_setup(user.id, workspace_id)
    except CloudApiError as error:
        raise_cloud_error(error)
