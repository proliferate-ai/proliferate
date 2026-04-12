"""Request and response models for repo-scoped cloud configuration APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from proliferate.db.models.cloud import CloudWorkspace
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
    files_version: int = Field(serialization_alias="filesVersion")


class CloudRepoConfigsListResponse(BaseModel):
    configs: list[CloudRepoConfigSummary]


class CloudRepoFileMetadata(BaseModel):
    relative_path: str = Field(serialization_alias="relativePath")
    content_sha256: str = Field(serialization_alias="contentSha256")
    byte_size: int = Field(serialization_alias="byteSize")
    updated_at: str = Field(serialization_alias="updatedAt")
    last_synced_at: str = Field(serialization_alias="lastSyncedAt")


class CloudRepoConfigResponse(BaseModel):
    configured: bool
    configured_at: str | None = Field(serialization_alias="configuredAt")
    default_branch: str | None = Field(serialization_alias="defaultBranch")
    env_vars: dict[str, str] = Field(serialization_alias="envVars")
    setup_script: str = Field(serialization_alias="setupScript")
    files_version: int = Field(serialization_alias="filesVersion")
    tracked_files: list[CloudRepoFileMetadata] = Field(serialization_alias="trackedFiles")


class SaveCloudRepoConfigFile(BaseModel):
    relative_path: str = Field(alias="relativePath")
    content: str


class SaveCloudRepoConfigRequest(BaseModel):
    configured: bool
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    env_vars: dict[str, str] = Field(default_factory=dict, alias="envVars")
    setup_script: str = Field(default="", alias="setupScript")
    files: list[SaveCloudRepoConfigFile] = Field(default_factory=list)


class PutCloudRepoFileRequest(BaseModel):
    relative_path: str = Field(alias="relativePath")
    content: str


class CloudWorkspaceRepoConfigStatusResponse(BaseModel):
    current_repo_files_version: int = Field(serialization_alias="currentRepoFilesVersion")
    repo_files_applied_version: int = Field(serialization_alias="repoFilesAppliedVersion")
    repo_files_applied_at: str | None = Field(serialization_alias="repoFilesAppliedAt")
    files_out_of_sync: bool = Field(serialization_alias="filesOutOfSync")
    tracked_files: list[CloudRepoFileMetadata] = Field(serialization_alias="trackedFiles")
    env_var_keys: list[str] = Field(serialization_alias="envVarKeys")
    post_ready_phase: str = Field(serialization_alias="postReadyPhase")
    post_ready_files_total: int = Field(serialization_alias="postReadyFilesTotal")
    post_ready_files_applied: int = Field(serialization_alias="postReadyFilesApplied")
    post_ready_started_at: str | None = Field(serialization_alias="postReadyStartedAt")
    post_ready_completed_at: str | None = Field(serialization_alias="postReadyCompletedAt")
    last_apply_failed_path: str | None = Field(serialization_alias="lastApplyFailedPath")
    last_apply_error: str | None = Field(serialization_alias="lastApplyError")


class ResyncCloudWorkspaceFilesResponse(CloudWorkspaceRepoConfigStatusResponse):
    workspace_id: str = Field(serialization_alias="workspaceId")


class RunCloudWorkspaceSetupResponse(BaseModel):
    workspace_id: str = Field(serialization_alias="workspaceId")
    command: str


def repo_config_summary_payload(value: CloudRepoConfigSummaryValue) -> CloudRepoConfigSummary:
    return CloudRepoConfigSummary(
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        configured=value.configured,
        configured_at=_to_iso(value.configured_at),
        files_version=value.files_version,
    )


def repo_file_metadata_payload(value: CloudRepoFileValue) -> CloudRepoFileMetadata:
    return CloudRepoFileMetadata(
        relative_path=value.relative_path,
        content_sha256=value.content_sha256,
        byte_size=value.byte_size,
        updated_at=value.updated_at.isoformat(),
        last_synced_at=value.last_synced_at.isoformat(),
    )


def repo_config_payload(value: CloudRepoConfigValue) -> CloudRepoConfigResponse:
    return CloudRepoConfigResponse(
        configured=value.configured,
        configured_at=_to_iso(value.configured_at),
        default_branch=value.default_branch,
        env_vars=value.env_vars,
        setup_script=value.setup_script,
        files_version=value.files_version,
        tracked_files=[repo_file_metadata_payload(item) for item in value.tracked_files],
    )


def workspace_repo_config_status_payload(
    workspace: CloudWorkspace,
    repo_config: CloudRepoConfigValue | None,
) -> CloudWorkspaceRepoConfigStatusResponse:
    tracked_files = (
        []
        if repo_config is None
        else [repo_file_metadata_payload(item) for item in repo_config.tracked_files]
    )
    env_var_keys = [] if repo_config is None else sorted(repo_config.env_vars)
    current_version = 0 if repo_config is None else repo_config.files_version
    return CloudWorkspaceRepoConfigStatusResponse(
        current_repo_files_version=current_version,
        repo_files_applied_version=workspace.repo_files_applied_version,
        repo_files_applied_at=_to_iso(workspace.repo_files_applied_at),
        files_out_of_sync=workspace.repo_files_applied_version != current_version,
        tracked_files=tracked_files,
        env_var_keys=env_var_keys,
        post_ready_phase=workspace.repo_post_ready_phase,
        post_ready_files_total=workspace.repo_post_ready_files_total,
        post_ready_files_applied=workspace.repo_post_ready_files_applied,
        post_ready_started_at=_to_iso(workspace.repo_post_ready_started_at),
        post_ready_completed_at=_to_iso(workspace.repo_post_ready_completed_at),
        last_apply_failed_path=workspace.repo_files_last_failed_path,
        last_apply_error=workspace.repo_files_last_error,
    )


def resync_cloud_workspace_files_payload(
    workspace: CloudWorkspace,
    repo_config: CloudRepoConfigValue | None,
) -> ResyncCloudWorkspaceFilesResponse:
    status = workspace_repo_config_status_payload(workspace, repo_config)
    return ResyncCloudWorkspaceFilesResponse(
        workspace_id=str(workspace.id),
        current_repo_files_version=status.current_repo_files_version,
        repo_files_applied_version=status.repo_files_applied_version,
        repo_files_applied_at=status.repo_files_applied_at,
        files_out_of_sync=status.files_out_of_sync,
        tracked_files=status.tracked_files,
        env_var_keys=status.env_var_keys,
        post_ready_phase=status.post_ready_phase,
        post_ready_files_total=status.post_ready_files_total,
        post_ready_files_applied=status.post_ready_files_applied,
        post_ready_started_at=status.post_ready_started_at,
        post_ready_completed_at=status.post_ready_completed_at,
        last_apply_failed_path=status.last_apply_failed_path,
        last_apply_error=status.last_apply_error,
    )


def run_cloud_workspace_setup_payload(
    workspace: CloudWorkspace,
    *,
    command: str,
) -> RunCloudWorkspaceSetupResponse:
    return RunCloudWorkspaceSetupResponse(
        workspace_id=str(workspace.id),
        command=command,
    )
