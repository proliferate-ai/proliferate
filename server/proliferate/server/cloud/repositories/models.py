"""Wire models for repository and environment configuration."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.repositories import RepoConfigValue, RepoEnvironmentValue


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class RepoEnvironmentResponse(BaseModel):
    id: UUID
    repo_config_id: UUID = Field(serialization_alias="repoConfigId")
    kind: str
    desktop_install_id: str | None = Field(serialization_alias="desktopInstallId")
    local_path: str | None = Field(serialization_alias="localPath")
    configured: bool
    configured_at: str | None = Field(serialization_alias="configuredAt")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    setup_script: str = Field(serialization_alias="setupScript")
    setup_script_version: int = Field(serialization_alias="setupScriptVersion")
    run_command: str = Field(serialization_alias="runCommand")
    config_version: int = Field(serialization_alias="configVersion")
    legacy_cloud_repo_config_id: UUID | None = Field(
        serialization_alias="legacyCloudRepoConfigId"
    )


class RepoConfigResponse(BaseModel):
    id: UUID
    owner_scope: str = Field(serialization_alias="ownerScope")
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
    configured: bool = True
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
        configured=value.configured,
        configured_at=_iso(value.configured_at),
        default_branch=value.default_branch,
        setup_script=value.setup_script,
        setup_script_version=value.setup_script_version,
        run_command=value.run_command,
        config_version=value.config_version,
        legacy_cloud_repo_config_id=value.legacy_cloud_repo_config_id,
    )


def repo_config_payload(value: RepoConfigValue) -> RepoConfigResponse:
    return RepoConfigResponse(
        id=value.id,
        owner_scope=value.owner_scope,
        git_provider=value.git_provider,
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        environments=[repo_environment_payload(item) for item in value.environments],
    )
