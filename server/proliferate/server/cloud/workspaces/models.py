"""Request and response schemas for cloud workspace APIs."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

CloudWorkspaceStatus = Literal["pending", "materializing", "ready", "archived", "error"]
CloudRuntimeStatus = Literal["pending", "running", "paused", "error", "disabled"]

# Placement-neutral backing kind. A repository worktree carries frozen real
# repository metadata; a scratch workspace has no repository backing and
# serializes ``repo``/``repoEnvironmentId`` as null (never fabricated).
CloudWorkspaceBackingKind = Literal["repositoryWorktree", "scratch"]
MaterializationTargetKind = Literal["managed_cloud", "local_desktop"]
MaterializationState = Literal[
    "pending",
    "hydrating",
    "hydrated",
    "missing",
    "inconsistent",
    "failed",
]
ReportableMaterializationState = Literal["hydrated", "missing", "inconsistent", "failed"]


class WorkspaceMaterializationSummary(BaseModel):
    id: str
    target_kind: MaterializationTargetKind = Field(serialization_alias="targetKind")
    desktop_install_id: str | None = Field(serialization_alias="desktopInstallId")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")
    worktree_path: str | None = Field(serialization_alias="worktreePath")
    state: MaterializationState
    generation: int
    expected_head_sha: str | None = Field(serialization_alias="expectedHeadSha")
    observed_head_sha: str | None = Field(serialization_alias="observedHeadSha")
    observed_branch: str | None = Field(serialization_alias="observedBranch")
    failure_code: str | None = Field(serialization_alias="failureCode")
    last_reported_at: str | None = Field(serialization_alias="lastReportedAt")


class CreateMaterializationIntentRequest(BaseModel):
    target_kind: Literal["local_desktop"] = Field(alias="targetKind")
    desktop_install_id: str = Field(alias="desktopInstallId")


class MaterializationIntentSource(BaseModel):
    repository: RepoRef
    branch_name: str = Field(serialization_alias="branchName")
    head_sha: str = Field(serialization_alias="headSha")


class MaterializationIntentResponse(BaseModel):
    materialization: WorkspaceMaterializationSummary
    operation_id: str = Field(serialization_alias="operationId")
    source: MaterializationIntentSource


class ReportMaterializationRequest(BaseModel):
    generation: int
    state: ReportableMaterializationState
    anyharness_workspace_id: str | None = Field(default=None, alias="anyharnessWorkspaceId")
    worktree_path: str | None = Field(default=None, alias="worktreePath")
    observed_branch: str | None = Field(default=None, alias="observedBranch")
    observed_head_sha: str | None = Field(default=None, alias="observedHeadSha")
    failure_code: str | None = Field(default=None, alias="failureCode")
    failure_detail: str | None = Field(default=None, alias="failureDetail")


class CreateCloudWorkspaceRequest(BaseModel):
    git_provider: Literal["github"] = Field(default="github", alias="gitProvider")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    base_branch: str | None = Field(default=None, alias="baseBranch")
    branch_name: str = Field(alias="branchName")
    display_name: str | None = Field(default=None, alias="displayName")
    generated_name: bool | None = Field(default=None, alias="generatedName")
    source: Literal["desktop", "web", "mobile"] | None = None


class UpdateCloudWorkspaceDisplayNameRequest(BaseModel):
    display_name: str | None = Field(default=None, alias="displayName")


class RepoRef(BaseModel):
    provider: str
    owner: str
    name: str
    branch: str
    base_branch: str = Field(serialization_alias="baseBranch")


class WorkspaceRuntimeAuthState(BaseModel):
    status: Literal["current"] = "current"
    config_current: bool = Field(default=True, serialization_alias="configCurrent")
    target_current: bool = Field(default=True, serialization_alias="targetCurrent")
    requires_restart: bool = Field(default=False, serialization_alias="requiresRestart")


class WorkspaceRuntimeSummary(BaseModel):
    environment_id: str | None = Field(default=None, serialization_alias="environmentId")
    status: CloudRuntimeStatus
    generation: int = 0
    runtime_auth: WorkspaceRuntimeAuthState = Field(
        default_factory=WorkspaceRuntimeAuthState,
        serialization_alias="runtimeAuth",
    )
    action_block_kind: str | None = Field(default=None, serialization_alias="actionBlockKind")
    action_block_reason: str | None = Field(default=None, serialization_alias="actionBlockReason")


class WorkspaceExecutionTargetSummary(BaseModel):
    kind: Literal["managed_cloud"] = "managed_cloud"
    target_id: str | None = Field(default=None, serialization_alias="targetId")
    label: str | None = None
    online: bool | None = None


class WorkspaceCloudAccessSummary(BaseModel):
    state: Literal["enabled"] = "enabled"
    exposure_id: str | None = Field(default=None, serialization_alias="exposureId")
    exposure_revision: int | None = Field(default=None, serialization_alias="exposureRevision")
    projection_state: Literal["untracked"] = Field(
        default="untracked",
        serialization_alias="projectionState",
    )
    commandable: bool = True


class WorkspaceSummary(BaseModel):
    id: str
    target_id: str | None = Field(default=None, serialization_alias="targetId")
    # The frozen response requires current servers to ALWAYS emit these three:
    # ``workspaceKind`` non-null, and ``repo``/``repoEnvironmentId`` required but
    # nullable for scratch (never omittable). They carry no default so the
    # OpenAPI schema keeps them in the required set; older-server compatibility
    # is expressed in the deliberately optional public projection type, not here.
    workspace_kind: CloudWorkspaceBackingKind = Field(serialization_alias="workspaceKind")
    repo_environment_id: str | None = Field(serialization_alias="repoEnvironmentId")
    display_name: str = Field(serialization_alias="displayName")
    repo: RepoRef | None
    status: CloudWorkspaceStatus
    workspace_status: CloudWorkspaceStatus = Field(serialization_alias="workspaceStatus")
    product_lifecycle: Literal["active", "archived"] = Field(
        serialization_alias="productLifecycle",
    )
    runtime: WorkspaceRuntimeSummary
    execution_target: WorkspaceExecutionTargetSummary = Field(
        default_factory=WorkspaceExecutionTargetSummary,
        serialization_alias="executionTarget",
    )
    selected_materialization_id: str | None = Field(
        default=None,
        serialization_alias="selectedMaterializationId",
    )
    primary_materialization: WorkspaceMaterializationSummary | None = Field(
        default=None,
        serialization_alias="primaryMaterialization",
    )
    materializations: list[WorkspaceMaterializationSummary] = Field(
        default_factory=list,
        serialization_alias="materializations",
    )
    cloud_access: WorkspaceCloudAccessSummary = Field(
        default_factory=WorkspaceCloudAccessSummary,
        serialization_alias="cloudAccess",
    )
    status_detail: str | None = Field(default=None, serialization_alias="statusDetail")
    last_error: str | None = Field(default=None, serialization_alias="lastError")
    template_version: str | None = Field(default=None, serialization_alias="templateVersion")
    updated_at: str | None = Field(default=None, serialization_alias="updatedAt")
    created_at: str | None = Field(default=None, serialization_alias="createdAt")
    ready_at: str | None = Field(default=None, serialization_alias="readyAt")
    action_block_kind: str | None = Field(default=None, serialization_alias="actionBlockKind")
    action_block_reason: str | None = Field(default=None, serialization_alias="actionBlockReason")
    post_ready_phase: Literal["idle"] = Field(default="idle", serialization_alias="postReadyPhase")
    post_ready_files_total: int = Field(default=0, serialization_alias="postReadyFilesTotal")
    post_ready_files_applied: int = Field(default=0, serialization_alias="postReadyFilesApplied")
    post_ready_started_at: str | None = Field(
        default=None,
        serialization_alias="postReadyStartedAt",
    )
    post_ready_completed_at: str | None = Field(
        default=None,
        serialization_alias="postReadyCompletedAt",
    )
    visibility: Literal["private", "archived"] = "private"
    exposure_state: Literal["untracked"] = Field(
        default="untracked",
        serialization_alias="exposureState",
    )
    sandbox_type: Literal["managed_personal"] = Field(
        default="managed_personal",
        serialization_alias="sandboxType",
    )
    last_activity_at: str | None = Field(default=None, serialization_alias="lastActivityAt")
    allowed_agent_kinds: list[str] = Field(
        default_factory=lambda: ["claude", "codex", "opencode", "grok"],
        serialization_alias="allowedAgentKinds",
    )
    ready_agent_kinds: list[str] = Field(
        default_factory=list,
        serialization_alias="readyAgentKinds",
    )
    anyharness_workspace_id: str | None = Field(
        default=None,
        serialization_alias="anyharnessWorkspaceId",
    )


class WorkspaceDetail(WorkspaceSummary):
    pass


class CloudWorkspaceRuntimeStatusResponse(BaseModel):
    workspace_id: UUID = Field(serialization_alias="workspaceId")
    status: CloudWorkspaceStatus
    runtime_status: CloudRuntimeStatus = Field(serialization_alias="runtimeStatus")
    sandbox_status: str | None = Field(default=None, serialization_alias="sandboxStatus")
    anyharness_workspace_id: str | None = Field(
        default=None,
        serialization_alias="anyharnessWorkspaceId",
    )
