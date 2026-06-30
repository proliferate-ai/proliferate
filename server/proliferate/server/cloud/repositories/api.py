"""Repository and environment configuration routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.repos.access import CloudRepoGitHubCredentialsDependency
from proliferate.server.cloud.repos.models import (
    CloudGitRepositoriesResponse,
    RepoBranchesResponse,
    cloud_git_repositories_payload,
)
from proliferate.server.cloud.repos.service import (
    DEFAULT_REPO_AFFILIATION,
    DEFAULT_REPO_VISIBILITY,
    get_cloud_repo_branches,
    list_cloud_repositories,
)
from proliferate.server.cloud.repositories.models import (
    RepoConfigsListResponse,
    RepoEnvironmentResponse,
    SaveRepoEnvironmentRequest,
    repo_config_payload,
    repo_environment_payload,
)
from proliferate.server.cloud.repositories.service import list_repositories, save_repo_environment

router = APIRouter()


@router.get("/repositories/catalog", response_model=CloudGitRepositoriesResponse)
async def list_repository_catalog_endpoint(
    credentials: CloudRepoGitHubCredentialsDependency,
    db: AsyncSession = Depends(get_async_session),
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    affiliation: str = DEFAULT_REPO_AFFILIATION,
    visibility: str = DEFAULT_REPO_VISIBILITY,
) -> CloudGitRepositoriesResponse:
    try:
        page = await list_cloud_repositories(
            db,
            credentials,
            query=query,
            cursor=cursor,
            limit=limit,
            affiliation=affiliation,
            visibility=visibility,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_git_repositories_payload(page)


@router.get("/repositories", response_model=RepoConfigsListResponse)
async def list_repositories_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RepoConfigsListResponse:
    values = await list_repositories(db, user_id=user.id)
    return RepoConfigsListResponse(repositories=[repo_config_payload(item) for item in values])


@router.get(
    "/repositories/{git_owner}/{git_repo_name}/branches", response_model=RepoBranchesResponse
)
async def get_repository_branches_endpoint(
    git_owner: str,
    git_repo_name: str,
    credentials: CloudRepoGitHubCredentialsDependency,
) -> RepoBranchesResponse:
    try:
        return await get_cloud_repo_branches(
            credentials,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.put(
    "/repositories/{git_owner}/{git_repo_name}/environment",
    response_model=RepoEnvironmentResponse,
)
async def save_repo_environment_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: SaveRepoEnvironmentRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> RepoEnvironmentResponse:
    value = await save_repo_environment(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        body=body,
    )
    return repo_environment_payload(value)
