"""Request and response models for repo-scoped cloud configuration APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigSummaryValue,
    CloudRepoConfigValue,
    CloudRepoFileValue,
)


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class CloudRepoConfigSummary(BaseModel):
    git_owner: str = Field(serialization_alias="gitOwner")
    git_repo_name: str = Field(serialization_alias="gitRepoName")
    configured: bool
    configured_at: str | None = Field(serialization_alias="configuredAt")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    files_version: int = Field(serialization_alias="filesVersion")


class CloudRepoConfigsListResponse(BaseModel):
    configs: list[CloudRepoConfigSummary]


class CloudRepoFileMetadata(BaseModel):
    relative_path: str = Field(serialization_alias="relativePath")
    content_sha256: str = Field(serialization_alias="contentSha256")
    byte_size: int = Field(serialization_alias="byteSize")
    updated_at: str = Field(serialization_alias="updatedAt")
    last_synced_at: str = Field(serialization_alias="lastSyncedAt")
    content: str | None = None


class CloudRepoConfigResponse(BaseModel):
    configured: bool
    configured_at: str | None = Field(serialization_alias="configuredAt")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    env_vars: dict[str, str] = Field(serialization_alias="envVars")
    setup_script: str = Field(serialization_alias="setupScript")
    run_command: str = Field(serialization_alias="runCommand")
    files_version: int = Field(serialization_alias="filesVersion")
    tracked_files: list[CloudRepoFileMetadata] = Field(serialization_alias="trackedFiles")


class SaveCloudRepoConfigFile(BaseModel):
    relative_path: str = Field(alias="relativePath")
    content: str


class SaveCloudRepoConfigRequest(BaseModel):
    configured: bool
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    env_vars: dict[str, str] | None = Field(default=None, alias="envVars")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")
    files: list[SaveCloudRepoConfigFile] | None = None


class SaveOrganizationCloudRepoConfigRequest(BaseModel):
    configured: bool
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    env_vars: dict[str, str] | None = Field(default=None, alias="envVars")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")
    files: list[SaveCloudRepoConfigFile] | None = None


class PutCloudRepoFileRequest(BaseModel):
    relative_path: str = Field(alias="relativePath")
    content: str


def repo_config_summary_payload(value: CloudRepoConfigSummaryValue) -> CloudRepoConfigSummary:
    return CloudRepoConfigSummary(
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        configured=value.configured,
        configured_at=_to_iso(value.configured_at),
        default_branch=value.default_branch,
        files_version=value.files_version,
    )


def repo_file_metadata_payload(
    value: CloudRepoFileValue,
    *,
    include_content: bool = False,
) -> CloudRepoFileMetadata:
    return CloudRepoFileMetadata(
        relative_path=value.relative_path,
        content_sha256=value.content_sha256,
        byte_size=value.byte_size,
        updated_at=value.updated_at.isoformat(),
        last_synced_at=value.last_synced_at.isoformat(),
        content=value.content if include_content else None,
    )


def repo_config_payload(
    value: CloudRepoConfigValue,
    *,
    include_file_content: bool = False,
) -> CloudRepoConfigResponse:
    return CloudRepoConfigResponse(
        configured=value.configured,
        configured_at=_to_iso(value.configured_at),
        default_branch=value.default_branch,
        env_vars={},
        setup_script=value.setup_script,
        run_command=value.run_command,
        files_version=value.files_version,
        tracked_files=[
            repo_file_metadata_payload(item, include_content=include_file_content)
            for item in value.tracked_files
        ],
    )
