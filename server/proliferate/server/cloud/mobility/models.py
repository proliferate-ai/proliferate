from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    CloudWorkspaceMobilityValue,
)


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class MobilityRepoRef(BaseModel):
    provider: str
    owner: str
    name: str
    branch: str


class MobilityHandoffSummary(BaseModel):
    id: str
    direction: str
    source_owner: str = Field(serialization_alias="sourceOwner")
    target_owner: str = Field(serialization_alias="targetOwner")
    phase: str
    requested_branch: str = Field(serialization_alias="requestedBranch")
    requested_base_sha: str | None = Field(
        default=None,
        serialization_alias="requestedBaseSha",
    )
    exclude_paths: list[str] = Field(serialization_alias="excludePaths")
    failure_code: str | None = Field(default=None, serialization_alias="failureCode")
    failure_detail: str | None = Field(default=None, serialization_alias="failureDetail")
    started_at: str = Field(serialization_alias="startedAt")
    heartbeat_at: str = Field(serialization_alias="heartbeatAt")
    finalized_at: str | None = Field(default=None, serialization_alias="finalizedAt")
    cleanup_completed_at: str | None = Field(
        default=None,
        serialization_alias="cleanupCompletedAt",
    )


class MobilityWorkspaceSummary(BaseModel):
    id: str
    display_name: str | None = Field(default=None, serialization_alias="displayName")
    repo: MobilityRepoRef
    owner: str
    lifecycle_state: str = Field(serialization_alias="lifecycleState")
    status_detail: str | None = Field(default=None, serialization_alias="statusDetail")
    last_error: str | None = Field(default=None, serialization_alias="lastError")
    cloud_workspace_id: str | None = Field(default=None, serialization_alias="cloudWorkspaceId")
    cloud_lost_at: str | None = Field(default=None, serialization_alias="cloudLostAt")
    cloud_lost_reason: str | None = Field(default=None, serialization_alias="cloudLostReason")
    active_handoff: MobilityHandoffSummary | None = Field(
        default=None,
        serialization_alias="activeHandoff",
    )
    updated_at: str | None = Field(serialization_alias="updatedAt")
    created_at: str | None = Field(serialization_alias="createdAt")


class MobilityWorkspaceDetail(MobilityWorkspaceSummary):
    last_handoff_op_id: str | None = Field(default=None, serialization_alias="lastHandoffOpId")


class EnsureMobilityWorkspaceRequest(BaseModel):
    git_provider: str = Field(alias="gitProvider")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    git_branch: str = Field(alias="gitBranch")
    display_name: str | None = Field(default=None, alias="displayName")
    owner_hint: str = Field(default="local", alias="ownerHint")


class WorkspaceMobilityPreflightRequest(BaseModel):
    direction: str
    requested_branch: str = Field(alias="requestedBranch")
    requested_base_sha: str | None = Field(default=None, alias="requestedBaseSha")


class WorkspaceMobilityPreflightResponse(BaseModel):
    can_start: bool = Field(serialization_alias="canStart")
    blockers: list[str]
    excluded_paths: list[str] = Field(serialization_alias="excludedPaths")
    workspace: MobilityWorkspaceDetail


class StartWorkspaceMobilityHandoffRequest(BaseModel):
    direction: str
    requested_branch: str = Field(alias="requestedBranch")
    requested_base_sha: str | None = Field(default=None, alias="requestedBaseSha")
    exclude_paths: list[str] = Field(default_factory=list, alias="excludePaths")


class UpdateWorkspaceMobilityHandoffPhaseRequest(BaseModel):
    phase: str
    status_detail: str | None = Field(default=None, alias="statusDetail")
    cloud_workspace_id: UUID | None = Field(default=None, alias="cloudWorkspaceId")


class FinalizeWorkspaceMobilityHandoffRequest(BaseModel):
    cloud_workspace_id: UUID | None = Field(default=None, alias="cloudWorkspaceId")


class FailWorkspaceMobilityHandoffRequest(BaseModel):
    failure_code: str = Field(alias="failureCode")
    failure_detail: str = Field(alias="failureDetail")


def handoff_summary_payload(value: CloudWorkspaceHandoffOpValue) -> MobilityHandoffSummary:
    return MobilityHandoffSummary(
        id=str(value.id),
        direction=value.direction,
        source_owner=value.source_owner,
        target_owner=value.target_owner,
        phase=value.phase,
        requested_branch=value.requested_branch,
        requested_base_sha=value.requested_base_sha,
        exclude_paths=list(value.exclude_paths),
        failure_code=value.failure_code,
        failure_detail=value.failure_detail,
        started_at=_to_iso(value.started_at),
        heartbeat_at=_to_iso(value.heartbeat_at),
        finalized_at=_to_iso(value.finalized_at),
        cleanup_completed_at=_to_iso(value.cleanup_completed_at),
    )


def mobility_workspace_summary_payload(
    value: CloudWorkspaceMobilityValue,
) -> MobilityWorkspaceSummary:
    return MobilityWorkspaceSummary(
        id=str(value.id),
        display_name=value.display_name,
        repo=MobilityRepoRef(
            provider=value.git_provider,
            owner=value.git_owner,
            name=value.git_repo_name,
            branch=value.git_branch,
        ),
        owner=value.owner,
        lifecycle_state=value.lifecycle_state,
        status_detail=value.status_detail,
        last_error=value.last_error,
        cloud_workspace_id=str(value.cloud_workspace_id) if value.cloud_workspace_id else None,
        cloud_lost_at=_to_iso(value.cloud_lost_at),
        cloud_lost_reason=value.cloud_lost_reason,
        active_handoff=(
            handoff_summary_payload(value.active_handoff)
            if value.active_handoff is not None
            else None
        ),
        updated_at=_to_iso(value.updated_at),
        created_at=_to_iso(value.created_at),
    )


def mobility_workspace_detail_payload(value: CloudWorkspaceMobilityValue) -> MobilityWorkspaceDetail:
    summary = mobility_workspace_summary_payload(value)
    return MobilityWorkspaceDetail(
        id=summary.id,
        display_name=summary.display_name,
        repo=summary.repo,
        owner=summary.owner,
        lifecycle_state=summary.lifecycle_state,
        status_detail=summary.status_detail,
        last_error=summary.last_error,
        cloud_workspace_id=summary.cloud_workspace_id,
        cloud_lost_at=summary.cloud_lost_at,
        cloud_lost_reason=summary.cloud_lost_reason,
        active_handoff=summary.active_handoff,
        updated_at=summary.updated_at,
        created_at=summary.created_at,
        last_handoff_op_id=(
            str(value.last_handoff_op_id) if value.last_handoff_op_id is not None else None
        ),
    )
