from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.constants.ai_magic import (
    COMMIT_MESSAGE_MAX_DIFF_CHARS,
    COMMIT_MESSAGE_MAX_MESSAGE_CHARS,
)


class GenerateSessionTitleRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateSessionTitleResponse(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class GenerateWorkspaceNameRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateWorkspaceNameResponse(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class GenerateCommitMessageRequest(BaseModel):
    diff_text: str = Field(
        alias="diffText",
        min_length=1,
        max_length=COMMIT_MESSAGE_MAX_DIFF_CHARS,
    )
    git_owner: str | None = Field(default=None, alias="gitOwner", max_length=255)
    git_repo_name: str | None = Field(default=None, alias="gitRepoName", max_length=255)
    branch_name: str | None = Field(default=None, alias="branchName", max_length=255)


class GenerateCommitMessageResponse(BaseModel):
    message: str = Field(min_length=1, max_length=COMMIT_MESSAGE_MAX_MESSAGE_CHARS)
