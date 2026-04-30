"""Request schemas and response payload builders for cloud workspace APIs."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from proliferate.constants.cloud import CloudRuntimeEnvironmentStatus, CloudWorkspaceStatus
from proliferate.db.models.cloud import CloudRuntimeEnvironment, CloudWorkspace
from proliferate.server.cloud.credentials.models import (
    CloudAgentKind,
    CredentialStatusRecord,
    allowed_agent_kinds,
    ready_agent_kinds,
)
from proliferate.server.cloud.runtime.credential_freshness import CredentialFreshnessSnapshot

logger = logging.getLogger(__name__)


class CreateCloudWorkspaceRequest(BaseModel):
    git_provider: Literal["github"] = Field(alias="gitProvider")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    base_branch: str | None = Field(default=None, alias="baseBranch")
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


class OriginContext(BaseModel):
    """Advisory provenance metadata; not authoritative for policy decisions."""

    kind: Literal["human", "cowork", "api", "system"]
    entrypoint: Literal["desktop", "cloud", "local_runtime", "cowork"]


class WorkspaceSummary(BaseModel):
    id: str
    display_name: str | None = Field(serialization_alias="displayName")
    repo: RepoRef
    workspace_status: Literal["pending", "materializing", "ready", "archived", "error"] = Field(
        serialization_alias="workspaceStatus",
    )
    runtime: WorkspaceRuntimeSummary
    status_detail: str | None = Field(serialization_alias="statusDetail")
    last_error: str | None = Field(serialization_alias="lastError")
    template_version: str | None = Field(serialization_alias="templateVersion")
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
    origin: OriginContext | None = None


class WorkspaceDetail(WorkspaceSummary):
    allowed_agent_kinds: list[str] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")


class WorkspaceCredentialFreshness(BaseModel):
    status: Literal[
        "current",
        "stale",
        "restart_required",
        "apply_failed",
        "missing_credentials",
    ]
    files_current: bool = Field(serialization_alias="filesCurrent")
    process_current: bool = Field(serialization_alias="processCurrent")
    requires_restart: bool = Field(serialization_alias="requiresRestart")
    last_error: str | None = Field(default=None, serialization_alias="lastError")
    last_error_at: str | None = Field(default=None, serialization_alias="lastErrorAt")
    files_applied_at: str | None = Field(default=None, serialization_alias="filesAppliedAt")
    process_applied_at: str | None = Field(
        default=None,
        serialization_alias="processAppliedAt",
    )


class WorkspaceConnection(BaseModel):
    runtime_url: str = Field(serialization_alias="runtimeUrl")
    access_token: str = Field(serialization_alias="accessToken")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")
    runtime_generation: int = Field(serialization_alias="runtimeGeneration")
    allowed_agent_kinds: list[CloudAgentKind] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")
    credential_freshness: WorkspaceCredentialFreshness = Field(
        serialization_alias="credentialFreshness",
    )


class WorkspaceRuntimeSummary(BaseModel):
    environment_id: str | None = Field(serialization_alias="environmentId")
    status: Literal["pending", "provisioning", "running", "paused", "error", "disabled"]
    generation: int
    credential_freshness: WorkspaceCredentialFreshness | None = Field(
        default=None,
        serialization_alias="credentialFreshness",
    )
    action_block_kind: str | None = Field(default=None, serialization_alias="actionBlockKind")
    action_block_reason: str | None = Field(default=None, serialization_alias="actionBlockReason")


def _repo_ref(workspace: CloudWorkspace) -> RepoRef:
    return RepoRef(
        provider=workspace.git_provider,
        owner=workspace.git_owner,
        name=workspace.git_repo_name,
        branch=workspace.git_branch,
        base_branch=workspace.git_base_branch or workspace.git_branch,
    )


def _origin_payload(workspace: CloudWorkspace) -> OriginContext | None:
    if not workspace.origin_json:
        return None
    try:
        raw = json.loads(workspace.origin_json)
        if not isinstance(raw, dict):
            raise ValueError("origin JSON must be an object")
        return OriginContext.model_validate(raw)
    except Exception as exc:
        logger.warning(
            "invalid cloud workspace origin JSON",
            extra={"table": "cloud_workspace", "row_id": str(workspace.id), "error": str(exc)},
        )
        return None


def credential_freshness_payload(
    snapshot: CredentialFreshnessSnapshot | None,
) -> WorkspaceCredentialFreshness | None:
    if snapshot is None:
        return None
    return WorkspaceCredentialFreshness(
        status=snapshot.status,
        files_current=snapshot.files_current,
        process_current=snapshot.process_current,
        requires_restart=snapshot.requires_restart,
        last_error=snapshot.last_error,
        last_error_at=_to_iso(snapshot.last_error_at),
        files_applied_at=_to_iso(snapshot.files_applied_at),
        process_applied_at=_to_iso(snapshot.process_applied_at),
    )


def workspace_summary_payload(
    workspace: CloudWorkspace,
    *,
    runtime_environment: CloudRuntimeEnvironment | None = None,
    credential_freshness: CredentialFreshnessSnapshot | None = None,
    action_block_kind: str | None = None,
    action_block_reason: str | None = None,
) -> WorkspaceSummary:
    runtime_status = (
        runtime_environment.status
        if runtime_environment is not None
        else CloudRuntimeEnvironmentStatus.pending.value
    )
    if runtime_status not in {"pending", "provisioning", "running", "paused", "error", "disabled"}:
        runtime_status = CloudRuntimeEnvironmentStatus.error.value
    workspace_status = workspace.status
    if workspace_status not in {"pending", "materializing", "ready", "archived", "error"}:
        workspace_status = CloudWorkspaceStatus.error.value
    return WorkspaceSummary(
        id=str(workspace.id),
        display_name=workspace.display_name,
        repo=_repo_ref(workspace),
        workspace_status=workspace_status,  # type: ignore[arg-type]
        runtime=WorkspaceRuntimeSummary(
            environment_id=(
                str(runtime_environment.id) if runtime_environment is not None else None
            ),
            status=runtime_status,  # type: ignore[arg-type]
            generation=(
                runtime_environment.runtime_generation
                if runtime_environment is not None
                else workspace.runtime_generation
            ),
            credential_freshness=credential_freshness_payload(credential_freshness),
            action_block_kind=action_block_kind,
            action_block_reason=action_block_reason,
        ),
        status_detail=workspace.status_detail,
        last_error=workspace.last_error,
        template_version=workspace.template_version,
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
        origin=_origin_payload(workspace),
    )


def workspace_detail_payload(
    workspace: CloudWorkspace,
    credential_statuses: list[CredentialStatusRecord],
    *,
    runtime_environment: CloudRuntimeEnvironment | None = None,
    credential_freshness: CredentialFreshnessSnapshot | None = None,
    action_block_kind: str | None = None,
    action_block_reason: str | None = None,
) -> WorkspaceDetail:
    summary = workspace_summary_payload(
        workspace,
        runtime_environment=runtime_environment,
        credential_freshness=credential_freshness,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
    )
    return WorkspaceDetail(
        **summary.model_dump(),
        allowed_agent_kinds=allowed_agent_kinds(),
        ready_agent_kinds=ready_agent_kinds(credential_statuses),
        anyharness_workspace_id=workspace.anyharness_workspace_id,
    )
