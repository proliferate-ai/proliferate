from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
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

router = APIRouter()


@router.get("/repos", response_model=CloudGitRepositoriesResponse)
async def list_cloud_repositories_endpoint(
    response: Response,
    credentials: CloudRepoGitHubCredentialsDependency,
    db: AsyncSession = Depends(get_async_session),
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    affiliation: str = DEFAULT_REPO_AFFILIATION,
    visibility: str = DEFAULT_REPO_VISIBILITY,
) -> CloudGitRepositoriesResponse:
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Vary"] = "Authorization, Cookie"
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


@router.get("/repos/{git_owner}/{git_repo_name}/branches", response_model=RepoBranchesResponse)
async def get_cloud_repo_branches_endpoint(
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
