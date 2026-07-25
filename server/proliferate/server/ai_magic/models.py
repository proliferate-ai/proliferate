from __future__ import annotations

from pydantic import BaseModel, Field


class GenerateSessionTitleRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateSessionTitleResponse(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class GenerateWorkspaceNameRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateWorkspaceNameResponse(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class GenerateCommitMessageRequest(BaseModel):
    diff_stat: str = Field(alias="diffStat", min_length=0, max_length=2000)
    diff_excerpt: str = Field(alias="diffExcerpt", min_length=0, max_length=20000)
    branch_name: str | None = Field(default=None, alias="branchName", max_length=256)


class GenerateCommitMessageResponse(BaseModel):
    message: str = Field(min_length=1, max_length=500)
