from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
    MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO,
    MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO,
)
from proliferate.db.store.cloud_worktree_policy import (
    CloudWorktreePolicyValue,
    get_cloud_worktree_policy,
    load_cloud_worktree_policy_for_user,
    save_cloud_worktree_policy,
)
from proliferate.server.cloud.errors import CloudApiError

CloudWorktreePolicySource = Literal["persisted", "default"]


@dataclass(frozen=True)
class CloudWorktreeRetentionPolicy:
    max_materialized_worktrees_per_repo: int
    updated_at: datetime | None
    source: CloudWorktreePolicySource


def _default_worktree_policy() -> CloudWorktreeRetentionPolicy:
    return CloudWorktreeRetentionPolicy(
        max_materialized_worktrees_per_repo=DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
        updated_at=None,
        source="default",
    )


def _worktree_policy_result(value: CloudWorktreePolicyValue) -> CloudWorktreeRetentionPolicy:
    return CloudWorktreeRetentionPolicy(
        max_materialized_worktrees_per_repo=value.max_materialized_worktrees_per_repo,
        updated_at=value.updated_at,
        source="persisted",
    )


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
    db: AsyncSession,
    user_id: UUID,
) -> CloudWorktreeRetentionPolicy:
    value = await get_cloud_worktree_policy(db, user_id)
    if value is None:
        return _default_worktree_policy()
    return _worktree_policy_result(value)


async def set_worktree_retention_policy(
    db: AsyncSession,
    user_id: UUID,
    *,
    max_materialized_worktrees_per_repo: int,
) -> CloudWorktreeRetentionPolicy:
    value = await save_cloud_worktree_policy(
        db,
        user_id=user_id,
        max_materialized_worktrees_per_repo=validate_worktree_policy_limit(
            max_materialized_worktrees_per_repo,
        ),
    )
    return _worktree_policy_result(value)


async def load_worktree_retention_policy_for_runtime(
    db: AsyncSession,
    user_id: UUID,
) -> CloudWorktreeRetentionPolicy:
    value = await load_cloud_worktree_policy_for_user(db, user_id)
    if value is None:
        return _default_worktree_policy()
    return _worktree_policy_result(value)
