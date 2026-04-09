"""Response schemas for cloud repository APIs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RepoBranchesResponse(BaseModel):
    default_branch: str = Field(serialization_alias="defaultBranch")
    branches: list[str]
