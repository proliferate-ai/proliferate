"""Request and response models for repo-scoped cloud configuration APIs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigSummaryValue,
    CloudRepoConfigValue,
    CloudRepoFileValue,
)
from proliferate.server.cloud.repo_config.domain.workspace_status import (
    RepoConfigTrackedFileStatus,
    ResyncWorkspaceRepoConfigStatus,
    RunWorkspaceSetupStatus,
    WorkspaceRepoConfigStatus,
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
    env_vars: dict[str, str] = Field(default_factory=dict, alias="envVars")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")
    files: list[SaveCloudRepoConfigFile]


class SaveOrganizationCloudRepoConfigRequest(BaseModel):
    configured: bool
    default_branch: str | None = Field(default=None, alias="defaultBranch")
    env_vars: dict[str, str] = Field(default_factory=dict, alias="envVars")
    setup_script: str = Field(default="", alias="setupScript")
    run_command: str = Field(default="", alias="runCommand")
    files: list[SaveCloudRepoConfigFile] | None = None


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
    terminal_id: str | None = Field(default=None, serialization_alias="terminalId")
    command_run_id: str | None = Field(default=None, serialization_alias="commandRunId")
    status: str


def repo_config_summary_payload(value: CloudRepoConfigSummaryValue) -> CloudRepoConfigSummary:
    return CloudRepoConfigSummary(
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        configured=value.configured,
        configured_at=_to_iso(value.configured_at),
        files_version=value.files_version,
    )


def repo_file_metadata_payload(
    value: CloudRepoFileValue | RepoConfigTrackedFileStatus,
    *,
    include_content: bool = False,
) -> CloudRepoFileMetadata:
    return CloudRepoFileMetadata(
        relative_path=value.relative_path,
        content_sha256=value.content_sha256,
        byte_size=value.byte_size,
        updated_at=value.updated_at.isoformat(),
        last_synced_at=value.last_synced_at.isoformat(),
        content=value.content
        if include_content and isinstance(value, CloudRepoFileValue)
        else None,
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
        env_vars=value.env_vars,
        setup_script=value.setup_script,
        run_command=value.run_command,
        files_version=value.files_version,
        tracked_files=[
            repo_file_metadata_payload(item, include_content=include_file_content)
            for item in value.tracked_files
        ],
    )


def workspace_repo_config_status_payload(
    status: WorkspaceRepoConfigStatus,
) -> CloudWorkspaceRepoConfigStatusResponse:
    return CloudWorkspaceRepoConfigStatusResponse(
        current_repo_files_version=status.current_repo_files_version,
        repo_files_applied_version=status.repo_files_applied_version,
        repo_files_applied_at=_to_iso(status.repo_files_applied_at),
        files_out_of_sync=status.files_out_of_sync,
        tracked_files=[repo_file_metadata_payload(item) for item in status.tracked_files],
        env_var_keys=list(status.env_var_keys),
        post_ready_phase=status.post_ready_phase,
        post_ready_files_total=status.post_ready_files_total,
        post_ready_files_applied=status.post_ready_files_applied,
        post_ready_started_at=_to_iso(status.post_ready_started_at),
        post_ready_completed_at=_to_iso(status.post_ready_completed_at),
        last_apply_failed_path=status.last_apply_failed_path,
        last_apply_error=status.last_apply_error,
    )


def resync_cloud_workspace_files_payload(
    status: ResyncWorkspaceRepoConfigStatus,
) -> ResyncCloudWorkspaceFilesResponse:
    response = workspace_repo_config_status_payload(status.status)
    return ResyncCloudWorkspaceFilesResponse(
        workspace_id=str(status.workspace_id),
        current_repo_files_version=response.current_repo_files_version,
        repo_files_applied_version=response.repo_files_applied_version,
        repo_files_applied_at=response.repo_files_applied_at,
        files_out_of_sync=response.files_out_of_sync,
        tracked_files=response.tracked_files,
        env_var_keys=response.env_var_keys,
        post_ready_phase=response.post_ready_phase,
        post_ready_files_total=response.post_ready_files_total,
        post_ready_files_applied=response.post_ready_files_applied,
        post_ready_started_at=response.post_ready_started_at,
        post_ready_completed_at=response.post_ready_completed_at,
        last_apply_failed_path=response.last_apply_failed_path,
        last_apply_error=response.last_apply_error,
    )


def run_cloud_workspace_setup_payload(
    status: RunWorkspaceSetupStatus,
) -> RunCloudWorkspaceSetupResponse:
    return RunCloudWorkspaceSetupResponse(
        workspace_id=str(status.workspace_id),
        command=status.command,
        terminal_id=status.terminal_id,
        command_run_id=status.command_run_id,
        status=status.status,
    )
