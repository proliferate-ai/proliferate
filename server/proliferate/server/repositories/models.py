"""Wire models for repository and environment configuration."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.constants.ai_magic import COMMIT_MESSAGE_MAX_INSTRUCTIONS_CHARS
from proliferate.constants.cloud import (
    GitProvider,
    RepoEnvironmentKind,
)
from proliferate.db.store.repositories import RepoConfigValue, RepoEnvironmentValue


class RepoEnvironmentResponse(BaseModel):
    id: UUID
    repo_config_id: UUID = Field(serialization_alias="repoConfigId")
    kind: RepoEnvironmentKind
    desktop_install_id: str | None = Field(serialization_alias="desktopInstallId")
    local_path: str | None = Field(serialization_alias="localPath")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    setup_script: str = Field(serialization_alias="setupScript")
    run_command: str = Field(serialization_alias="runCommand")
    archive_script: str = Field(serialization_alias="archiveScript")
    rerun_setup_on_unarchive: bool = Field(serialization_alias="rerunSetupOnUnarchive")


class RepoConfigResponse(BaseModel):
    id: UUID
    git_provider: GitProvider = Field(serialization_alias="gitProvider")
    git_owner: str = Field(serialization_alias="gitOwner")
    git_repo_name: str = Field(serialization_alias="gitRepoName")
    commit_instructions: str = Field(serialization_alias="commitInstructions")
    environments: list[RepoEnvironmentResponse]


class RepoConfigsListResponse(BaseModel):
    repositories: list[RepoConfigResponse]


class SaveRepoEnvironmentRequest(BaseModel):
    kind: RepoEnvironmentKind
    git_provider: GitProvider = Field(default=GitProvider.github, alias="gitProvider")
    desktop_install_id: str | None = Field(default=None, alias="desktopInstallId")
    local_path: str | None = Field(default=None, alias="localPath")
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")
    # None means "leave the stored value alone" on an existing row, and
    # "take the column default" when the upsert inserts a fresh row.
    archive_script: str | None = Field(default=None, alias="archiveScript")
    rerun_setup_on_unarchive: bool | None = Field(default=None, alias="rerunSetupOnUnarchive")


class UpdateRepoConfigRequest(BaseModel):
    commit_instructions: str = Field(
        default="",
        alias="commitInstructions",
        max_length=COMMIT_MESSAGE_MAX_INSTRUCTIONS_CHARS,
    )


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
        archive_script=value.archive_script,
        rerun_setup_on_unarchive=value.rerun_setup_on_unarchive,
    )


def repo_config_payload(value: RepoConfigValue) -> RepoConfigResponse:
    return RepoConfigResponse(
        id=value.id,
        git_provider=value.git_provider,
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        commit_instructions=value.commit_instructions,
        environments=[repo_environment_payload(item) for item in value.environments],
    )
