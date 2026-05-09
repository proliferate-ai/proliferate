"""Request and response models for cloud worktree cleanup policy APIs."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CloudWorktreePolicySource = Literal["persisted", "default"]


class CloudWorktreeRetentionPolicyRequest(BaseModel):
    max_materialized_worktrees_per_repo: int = Field(alias="maxMaterializedWorktreesPerRepo")


class CloudWorktreeRetentionPolicyResponse(BaseModel):
    max_materialized_worktrees_per_repo: int = Field(
        serialization_alias="maxMaterializedWorktreesPerRepo",
    )
    updated_at: str = Field(serialization_alias="updatedAt")
    source: CloudWorktreePolicySource
