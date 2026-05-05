from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.worktree_policy.models import (
    CloudWorktreeRetentionPolicyRequest,
    CloudWorktreeRetentionPolicyResponse,
)
from proliferate.server.cloud.worktree_policy.service import (
    get_worktree_retention_policy,
    set_worktree_retention_policy,
)

router = APIRouter()


@router.get(
    "/worktree-retention-policy",
    response_model=CloudWorktreeRetentionPolicyResponse,
)
async def get_cloud_worktree_retention_policy_endpoint(
    user: User = Depends(current_active_user),
) -> CloudWorktreeRetentionPolicyResponse:
    return await get_worktree_retention_policy(user.id)


@router.put(
    "/worktree-retention-policy",
    response_model=CloudWorktreeRetentionPolicyResponse,
)
async def put_cloud_worktree_retention_policy_endpoint(
    body: CloudWorktreeRetentionPolicyRequest,
    user: User = Depends(current_active_user),
) -> CloudWorktreeRetentionPolicyResponse:
    try:
        return await set_worktree_retention_policy(
            user.id,
            max_materialized_worktrees_per_repo=body.max_materialized_worktrees_per_repo,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
