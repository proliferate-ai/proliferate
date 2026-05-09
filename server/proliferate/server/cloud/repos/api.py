from __future__ import annotations

from fastapi import APIRouter

from proliferate.server.cloud.repos.access import CloudRepoGitHubCredentialsDependency
from proliferate.server.cloud.repos.models import RepoBranchesResponse
from proliferate.server.cloud.repos.service import get_cloud_repo_branches

router = APIRouter()


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
