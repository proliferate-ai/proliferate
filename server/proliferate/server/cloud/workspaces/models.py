"""Request schemas and response payload builders for cloud workspace APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from proliferate.db.models.cloud import CloudWorkspace
from proliferate.server.cloud.credentials.models import (
    CloudAgentKind,
    CredentialStatusRecord,
    allowed_agent_kinds,
    ready_agent_kinds,
)


class CreateCloudWorkspaceRequest(BaseModel):
    git_provider: Literal["github"] = Field(alias="gitProvider")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    base_branch: str = Field(alias="baseBranch")
    branch_name: str = Field(alias="branchName")
    display_name: str | None = Field(default=None, alias="displayName")


class UpdateCloudWorkspaceBranchRequest(BaseModel):
    branch_name: str = Field(alias="branchName")


class UpdateCloudWorkspaceDisplayNameRequest(BaseModel):
    """Set or clear the user-provided cloud workspace display name.

    `None` (or an empty/whitespace string) clears the override and restores
    the default branch- or repo-derived label in the sidebar.
    """

    display_name: str | None = Field(default=None, alias="displayName")


def _to_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


class RepoRef(BaseModel):
    provider: str
    owner: str
    name: str
    branch: str
    base_branch: str = Field(serialization_alias="baseBranch")


class WorkspaceSummary(BaseModel):
    id: str
    display_name: str | None = Field(serialization_alias="displayName")
    repo: RepoRef
    status: str
    status_detail: str | None = Field(serialization_alias="statusDetail")
    last_error: str | None = Field(serialization_alias="lastError")
    template_version: str | None = Field(serialization_alias="templateVersion")
    runtime_generation: int = Field(serialization_alias="runtimeGeneration")
    updated_at: str | None = Field(serialization_alias="updatedAt")
    created_at: str | None = Field(serialization_alias="createdAt")
    action_block_kind: str | None = Field(default=None, serialization_alias="actionBlockKind")
    action_block_reason: str | None = Field(default=None, serialization_alias="actionBlockReason")
    post_ready_phase: str = Field(serialization_alias="postReadyPhase")
    post_ready_files_total: int = Field(serialization_alias="postReadyFilesTotal")
    post_ready_files_applied: int = Field(serialization_alias="postReadyFilesApplied")
    post_ready_started_at: str | None = Field(serialization_alias="postReadyStartedAt")
    post_ready_completed_at: str | None = Field(serialization_alias="postReadyCompletedAt")
    repo_files_last_failed_path: str | None = Field(
        default=None,
        serialization_alias="repoFilesLastFailedPath",
    )


class WorkspaceDetail(WorkspaceSummary):
    allowed_agent_kinds: list[str] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")


class WorkspaceConnection(BaseModel):
    runtime_url: str = Field(serialization_alias="runtimeUrl")
    access_token: str = Field(serialization_alias="accessToken")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")
    runtime_generation: int = Field(serialization_alias="runtimeGeneration")
    allowed_agent_kinds: list[CloudAgentKind] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")


def _repo_ref(workspace: CloudWorkspace) -> RepoRef:
    return RepoRef(
        provider=workspace.git_provider,
        owner=workspace.git_owner,
        name=workspace.git_repo_name,
        branch=workspace.git_branch,
        base_branch=workspace.git_base_branch or workspace.git_branch,
    )


def workspace_summary_payload(
    workspace: CloudWorkspace,
    *,
    action_block_kind: str | None = None,
    action_block_reason: str | None = None,
) -> WorkspaceSummary:
    return WorkspaceSummary(
        id=str(workspace.id),
        display_name=workspace.display_name,
        repo=_repo_ref(workspace),
        status=workspace.status,
        status_detail=workspace.status_detail,
        last_error=workspace.last_error,
        template_version=workspace.template_version,
        runtime_generation=workspace.runtime_generation,
        updated_at=_to_iso(workspace.updated_at),
        created_at=_to_iso(workspace.created_at),
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        post_ready_phase=workspace.repo_post_ready_phase,
        post_ready_files_total=workspace.repo_post_ready_files_total,
        post_ready_files_applied=workspace.repo_post_ready_files_applied,
        post_ready_started_at=_to_iso(workspace.repo_post_ready_started_at),
        post_ready_completed_at=_to_iso(workspace.repo_post_ready_completed_at),
        repo_files_last_failed_path=workspace.repo_files_last_failed_path,
    )


def workspace_detail_payload(
    workspace: CloudWorkspace,
    credential_statuses: list[CredentialStatusRecord],
    *,
    action_block_kind: str | None = None,
    action_block_reason: str | None = None,
) -> WorkspaceDetail:
    return WorkspaceDetail(
        id=str(workspace.id),
        display_name=workspace.display_name,
        repo=_repo_ref(workspace),
        status=workspace.status,
        status_detail=workspace.status_detail,
        last_error=workspace.last_error,
        template_version=workspace.template_version,
        runtime_generation=workspace.runtime_generation,
        updated_at=_to_iso(workspace.updated_at),
        created_at=_to_iso(workspace.created_at),
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        post_ready_phase=workspace.repo_post_ready_phase,
        post_ready_files_total=workspace.repo_post_ready_files_total,
        post_ready_files_applied=workspace.repo_post_ready_files_applied,
        post_ready_started_at=_to_iso(workspace.repo_post_ready_started_at),
        post_ready_completed_at=_to_iso(workspace.repo_post_ready_completed_at),
        repo_files_last_failed_path=workspace.repo_files_last_failed_path,
        allowed_agent_kinds=allowed_agent_kinds(),
        ready_agent_kinds=ready_agent_kinds(credential_statuses),
        anyharness_workspace_id=workspace.anyharness_workspace_id,
    )
