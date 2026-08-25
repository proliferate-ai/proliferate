from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.github.repos.access import CloudRepoGitHubCredentialsDependency
from proliferate.server.github.repos.models import (
    CloudGitRepositoriesResponse,
    RepoBranchesResponse,
    cloud_git_repositories_payload,
)
from proliferate.server.github.repos.service import (
    DEFAULT_REPO_AFFILIATION,
    DEFAULT_REPO_VISIBILITY,
    get_cloud_repo_branches,
    list_cloud_repositories,
)
from proliferate.server.github.transactions import (
    commit_github_app_reauthorization_on_error,
)

router = APIRouter(dependencies=[Depends(commit_github_app_reauthorization_on_error)])


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
    page = await list_cloud_repositories(
        db,
        credentials,
        query=query,
        cursor=cursor,
        limit=limit,
        affiliation=affiliation,
        visibility=visibility,
    )
    return cloud_git_repositories_payload(page)


@router.get("/repos/{git_owner}/{git_repo_name}/branches", response_model=RepoBranchesResponse)
async def get_cloud_repo_branches_endpoint(
    git_owner: str,
    git_repo_name: str,
    credentials: CloudRepoGitHubCredentialsDependency,
) -> RepoBranchesResponse:
    return await get_cloud_repo_branches(
        credentials,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
