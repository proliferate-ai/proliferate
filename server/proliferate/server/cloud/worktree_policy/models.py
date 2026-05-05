"""Request and response models for cloud worktree cleanup policy APIs."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_worktree_policy import CloudWorktreePolicyValue

CloudWorktreePolicySource = Literal["persisted", "default"]


class CloudWorktreeRetentionPolicyRequest(BaseModel):
    max_materialized_worktrees_per_repo: int = Field(alias="maxMaterializedWorktreesPerRepo")


class CloudWorktreeRetentionPolicyResponse(BaseModel):
    max_materialized_worktrees_per_repo: int = Field(
        serialization_alias="maxMaterializedWorktreesPerRepo",
    )
    updated_at: str = Field(serialization_alias="updatedAt")
    source: CloudWorktreePolicySource


def cloud_worktree_policy_payload(
    value: CloudWorktreePolicyValue,
) -> CloudWorktreeRetentionPolicyResponse:
    return CloudWorktreeRetentionPolicyResponse(
        max_materialized_worktrees_per_repo=value.max_materialized_worktrees_per_repo,
        updated_at=value.updated_at.isoformat(),
        source="persisted",
    )
