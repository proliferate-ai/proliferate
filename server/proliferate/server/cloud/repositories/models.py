"""Wire models for repository and environment configuration."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.repositories import RepoConfigValue, RepoEnvironmentValue


class RepoEnvironmentResponse(BaseModel):
    id: UUID
    repo_config_id: UUID = Field(serialization_alias="repoConfigId")
    kind: str
    desktop_install_id: str | None = Field(serialization_alias="desktopInstallId")
    local_path: str | None = Field(serialization_alias="localPath")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    setup_script: str = Field(serialization_alias="setupScript")
    run_command: str = Field(serialization_alias="runCommand")


class RepoConfigResponse(BaseModel):
    id: UUID
    git_provider: str = Field(serialization_alias="gitProvider")
    git_owner: str = Field(serialization_alias="gitOwner")
    git_repo_name: str = Field(serialization_alias="gitRepoName")
    environments: list[RepoEnvironmentResponse]


class RepoConfigsListResponse(BaseModel):
    repositories: list[RepoConfigResponse]


class SaveLocalRepoEnvironmentRequest(BaseModel):
    git_provider: str = Field(default="github", alias="gitProvider")
    desktop_install_id: str = Field(alias="desktopInstallId")
    local_path: str = Field(alias="localPath")
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")


class SaveCloudRepoEnvironmentRequest(BaseModel):
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")


def repo_environment_payload(value: RepoEnvironmentValue) -> RepoEnvironmentResponse:
    return RepoEnvironmentResponse(
        id=value.id,
        repo_config_id=value.repo_config_id,
        kind=value.environment_kind,
        desktop_install_id=value.desktop_install_id,
        local_path=value.local_path,
        default_branch=value.default_branch,
        setup_script=value.setup_script,
        run_command=value.run_command,
    )


def repo_config_payload(value: RepoConfigValue) -> RepoConfigResponse:
    return RepoConfigResponse(
        id=value.id,
        git_provider=value.git_provider,
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        environments=[repo_environment_payload(item) for item in value.environments],
    )
