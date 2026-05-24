"""Response schemas for cloud repository APIs."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from proliferate.server.cloud.repos.domain.catalog import CloudGitRepositoriesPageRecord


class RepoBranchesResponse(BaseModel):
    default_branch: str = Field(serialization_alias="defaultBranch")
    branches: list[str]
    permission: str | None = None
    private: bool | None = None
    fork: bool | None = None
    archived: bool | None = None
    disabled: bool | None = None


class CloudGitRepositorySummary(BaseModel):
    provider: Literal["github"] = "github"
    git_owner: str = Field(serialization_alias="gitOwner")
    git_repo_name: str = Field(serialization_alias="gitRepoName")
    full_name: str = Field(serialization_alias="fullName")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    private: bool
    fork: bool
    archived: bool
    disabled: bool
    html_url: str | None = Field(serialization_alias="htmlUrl")
    owner_avatar_url: str | None = Field(serialization_alias="ownerAvatarUrl")
    pushed_at: str | None = Field(serialization_alias="pushedAt")
    updated_at: str | None = Field(serialization_alias="updatedAt")
    permission: str | None = None
    configured: bool = False
    repo_config_state: Literal["missing", "disabled", "configured"] = Field(
        serialization_alias="repoConfigState"
    )


class CloudGitRepositoriesResponse(BaseModel):
    repositories: list[CloudGitRepositorySummary]
    next_cursor: str | None = Field(serialization_alias="nextCursor")


def cloud_git_repositories_payload(
    page: CloudGitRepositoriesPageRecord,
) -> CloudGitRepositoriesResponse:
    return CloudGitRepositoriesResponse(
        repositories=[
            CloudGitRepositorySummary(
                provider=repo.provider,
                git_owner=repo.git_owner,
                git_repo_name=repo.git_repo_name,
                full_name=repo.full_name,
                default_branch=repo.default_branch,
                private=repo.private,
                fork=repo.fork,
                archived=repo.archived,
                disabled=repo.disabled,
                html_url=repo.html_url,
                owner_avatar_url=repo.owner_avatar_url,
                pushed_at=repo.pushed_at,
                updated_at=repo.updated_at,
                permission=repo.permission,
                configured=repo.configured,
                repo_config_state=repo.repo_config_state,
            )
            for repo in page.repositories
        ],
        next_cursor=page.next_cursor,
    )
