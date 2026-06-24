from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.repo_config.models import (
    CloudRepoConfigResponse,
    CloudRepoConfigsListResponse,
    PutCloudRepoFileRequest,
    SaveCloudRepoConfigRequest,
    SaveOrganizationCloudRepoConfigRequest,
    repo_config_payload,
    repo_config_summary_payload,
)
from proliferate.server.cloud.repo_config.service import (
    get_organization_repo_config,
    get_repo_config,
    list_organization_repo_configs,
    list_repo_configs,
    save_organization_repo_config,
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
    user: User = Depends(current_product_user),
) -> CloudRepoConfigsListResponse:
    return CloudRepoConfigsListResponse(
        configs=[
            repo_config_summary_payload(value) for value in await list_repo_configs(db, user.id)
        ]
    )


@router.get(
    "/organizations/{organization_id}/repos/configs",
    response_model=CloudRepoConfigsListResponse,
)
async def list_organization_cloud_repo_configs_endpoint(
    organization_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudRepoConfigsListResponse:
    try:
        values = await list_organization_repo_configs(db, user.id, organization_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return CloudRepoConfigsListResponse(
        configs=[repo_config_summary_payload(value) for value in values]
    )


@router.get("/repos/{git_owner}/{git_repo_name}/config", response_model=CloudRepoConfigResponse)
async def get_cloud_repo_config_endpoint(
    git_owner: str,
    git_repo_name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudRepoConfigResponse:
    value = await get_repo_config(
        db,
        user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return _default_repo_config_response() if value is None else repo_config_payload(value)


@router.get(
    "/organizations/{organization_id}/repos/{git_owner}/{git_repo_name}/config",
    response_model=CloudRepoConfigResponse,
)
async def get_organization_cloud_repo_config_endpoint(
    organization_id: UUID,
    git_owner: str,
    git_repo_name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudRepoConfigResponse:
    try:
        value = await get_organization_repo_config(
            db,
            user.id,
            organization_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return (
        _default_repo_config_response()
        if value is None
        else repo_config_payload(value, include_file_content=True)
    )


@router.put("/repos/{git_owner}/{git_repo_name}/config", response_model=CloudRepoConfigResponse)
async def save_cloud_repo_config_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: SaveCloudRepoConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
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

@router.put(
    "/organizations/{organization_id}/repos/{git_owner}/{git_repo_name}/config",
    response_model=CloudRepoConfigResponse,
)
async def save_organization_cloud_repo_config_endpoint(
    organization_id: UUID,
    git_owner: str,
    git_repo_name: str,
    body: SaveOrganizationCloudRepoConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudRepoConfigResponse:
    try:
        value = await save_organization_repo_config(
            db,
            user.id,
            organization_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            body=body,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return repo_config_payload(value, include_file_content=True)


@router.put("/repos/{git_owner}/{git_repo_name}/files", response_model=CloudRepoConfigResponse)
async def save_cloud_repo_file_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: PutCloudRepoFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
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
