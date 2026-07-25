from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class GenerateSessionTitleRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateSessionTitleResponse(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class GenerateWorkspaceNameRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateWorkspaceNameResponse(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class GenerateGitPublishRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=8000)
    mode: Literal["commit_message", "pull_request"]
    instructions: str | None = None


class GenerateGitPublishResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    commit_message: str | None = Field(default=None, alias="commitMessage")
    pr_title: str | None = Field(default=None, alias="prTitle")
    pr_body: str | None = Field(default=None, alias="prBody")
