from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.constants.cloud import DEFAULT_WORKTREE_POLICY_UPDATED_AT
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.worktree_policy.models import (
    CloudWorktreeRetentionPolicyRequest,
    CloudWorktreeRetentionPolicyResponse,
)
from proliferate.server.cloud.worktree_policy.service import (
    CloudWorktreeRetentionPolicy,
    get_worktree_retention_policy,
    set_worktree_retention_policy,
)

router = APIRouter()


def _worktree_policy_response(
    policy: CloudWorktreeRetentionPolicy,
) -> CloudWorktreeRetentionPolicyResponse:
    return CloudWorktreeRetentionPolicyResponse(
        max_materialized_worktrees_per_repo=policy.max_materialized_worktrees_per_repo,
        updated_at=(
            DEFAULT_WORKTREE_POLICY_UPDATED_AT
            if policy.updated_at is None
            else policy.updated_at.isoformat()
        ),
        source=policy.source,
    )


@router.get(
    "/worktree-retention-policy",
    response_model=CloudWorktreeRetentionPolicyResponse,
)
async def get_cloud_worktree_retention_policy_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudWorktreeRetentionPolicyResponse:
    return _worktree_policy_response(await get_worktree_retention_policy(db, user.id))


@router.put(
    "/worktree-retention-policy",
    response_model=CloudWorktreeRetentionPolicyResponse,
)
async def put_cloud_worktree_retention_policy_endpoint(
    body: CloudWorktreeRetentionPolicyRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> CloudWorktreeRetentionPolicyResponse:
    return _worktree_policy_response(
        await set_worktree_retention_policy(
            db,
            user.id,
            max_materialized_worktrees_per_repo=body.max_materialized_worktrees_per_repo,
        )
    )
