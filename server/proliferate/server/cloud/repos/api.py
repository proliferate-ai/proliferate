from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.repos.models import RepoBranchesResponse
from proliferate.server.cloud.repos.service import get_cloud_repo_branches

router = APIRouter()


@router.get("/repos/{git_owner}/{git_repo_name}/branches", response_model=RepoBranchesResponse)
async def get_cloud_repo_branches_endpoint(
    git_owner: str,
    git_repo_name: str,
    user: User = Depends(current_active_user),
) -> RepoBranchesResponse:
    try:
        return await get_cloud_repo_branches(
            user,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
