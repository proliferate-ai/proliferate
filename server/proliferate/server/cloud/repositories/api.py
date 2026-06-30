"""Repository and environment configuration routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.repositories.models import (
    RepoConfigsListResponse,
    RepoEnvironmentResponse,
    SaveCloudRepoEnvironmentRequest,
    SaveLocalRepoEnvironmentRequest,
    repo_config_payload,
    repo_environment_payload,
)
from proliferate.server.cloud.repositories.service import (
    list_repositories,
    save_cloud_environment,
    save_local_environment,
)

router = APIRouter()


@router.get("/repositories", response_model=RepoConfigsListResponse)
async def list_repositories_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RepoConfigsListResponse:
    values = await list_repositories(db, user_id=user.id)
    return RepoConfigsListResponse(repositories=[repo_config_payload(item) for item in values])


@router.put(
    "/repositories/{git_owner}/{git_repo_name}/environments/local",
    response_model=RepoEnvironmentResponse,
)
async def save_local_repo_environment_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: SaveLocalRepoEnvironmentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RepoEnvironmentResponse:
    value = await save_local_environment(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        body=body,
    )
    return repo_environment_payload(value)


@router.put(
    "/repositories/{git_owner}/{git_repo_name}/environments/cloud",
    response_model=RepoEnvironmentResponse,
)
async def save_cloud_repo_environment_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: SaveCloudRepoEnvironmentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RepoEnvironmentResponse:
    value = await save_cloud_environment(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        body=body,
    )
    return repo_environment_payload(value)
