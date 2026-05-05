from __future__ import annotations

from uuid import UUID

from proliferate.db.store.cloud_worktree_policy import (
    DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
    MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO,
    MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO,
    load_cloud_worktree_policy_for_user,
    persist_cloud_worktree_policy_for_user,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worktree_policy.models import (
    CloudWorktreeRetentionPolicyResponse,
    cloud_worktree_policy_payload,
)

DEFAULT_POLICY_UPDATED_AT = "1970-01-01T00:00:00+00:00"


def validate_worktree_policy_limit(value: int) -> int:
    if (
        value < MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO
        or value > MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO
    ):
        raise CloudApiError(
            "invalid_worktree_retention_policy",
            (
                "Worktree cleanup policy must keep between "
                f"{MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO} and "
                f"{MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO} materialized managed checkouts "
                "per repo."
            ),
            status_code=400,
        )
    return value


async def get_worktree_retention_policy(
    user_id: UUID,
) -> CloudWorktreeRetentionPolicyResponse:
    value = await load_cloud_worktree_policy_for_user(user_id)
    if value is None:
        return CloudWorktreeRetentionPolicyResponse(
            max_materialized_worktrees_per_repo=DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
            updated_at=DEFAULT_POLICY_UPDATED_AT,
            source="default",
        )
    return cloud_worktree_policy_payload(value)


async def set_worktree_retention_policy(
    user_id: UUID,
    *,
    max_materialized_worktrees_per_repo: int,
) -> CloudWorktreeRetentionPolicyResponse:
    value = await persist_cloud_worktree_policy_for_user(
        user_id=user_id,
        max_materialized_worktrees_per_repo=validate_worktree_policy_limit(
            max_materialized_worktrees_per_repo,
        ),
    )
    return cloud_worktree_policy_payload(value)
