"""Wire models for repository and environment configuration."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.constants.cloud import (
    CloudMaterializationStatus,
    GitProvider,
    RepoEnvironmentKind,
)
from proliferate.db.store.cloud_repo_environment_materializations import (
    CloudRepoEnvironmentMaterializationValue,
)
from proliferate.db.store.repositories import RepoConfigValue, RepoEnvironmentValue


class RepoEnvironmentMaterializationResponse(BaseModel):
    status: CloudMaterializationStatus
    last_error: str | None = Field(default=None, serialization_alias="lastError")
    materialized_at: datetime | None = Field(default=None, serialization_alias="materializedAt")


class RepoEnvironmentResponse(BaseModel):
    id: UUID
    repo_config_id: UUID = Field(serialization_alias="repoConfigId")
    kind: RepoEnvironmentKind
    desktop_install_id: str | None = Field(serialization_alias="desktopInstallId")
    local_path: str | None = Field(serialization_alias="localPath")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    setup_script: str = Field(serialization_alias="setupScript")
    run_command: str = Field(serialization_alias="runCommand")
    materialization: RepoEnvironmentMaterializationResponse | None = None


class RepoConfigResponse(BaseModel):
    id: UUID
    git_provider: GitProvider = Field(serialization_alias="gitProvider")
    git_owner: str = Field(serialization_alias="gitOwner")
    git_repo_name: str = Field(serialization_alias="gitRepoName")
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


def repo_environment_materialization_payload(
    value: CloudRepoEnvironmentMaterializationValue | None,
) -> RepoEnvironmentMaterializationResponse | None:
    if value is None:
        return None
    return RepoEnvironmentMaterializationResponse(
        status=value.status,
        last_error=value.last_error,
        materialized_at=value.materialized_at,
    )


def repo_environment_payload(
    value: RepoEnvironmentValue,
    *,
    materialization: CloudRepoEnvironmentMaterializationValue | None = None,
) -> RepoEnvironmentResponse:
    return RepoEnvironmentResponse(
        id=value.id,
        repo_config_id=value.repo_config_id,
        kind=value.environment_kind,
        desktop_install_id=value.desktop_install_id,
        local_path=value.local_path,
        default_branch=value.default_branch,
        setup_script=value.setup_script,
        run_command=value.run_command,
        materialization=repo_environment_materialization_payload(materialization),
    )


def repo_config_payload(value: RepoConfigValue) -> RepoConfigResponse:
    return RepoConfigResponse(
        id=value.id,
        git_provider=value.git_provider,
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        environments=[repo_environment_payload(item) for item in value.environments],
    )
