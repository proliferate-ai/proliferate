"""Request and response schemas for cloud workspace APIs."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CreateCloudWorkspaceRequest(BaseModel):
    git_provider: Literal["github"] = Field(alias="gitProvider")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    base_branch: str | None = Field(default=None, alias="baseBranch")
    branch_name: str = Field(alias="branchName")
    display_name: str | None = Field(default=None, alias="displayName")
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    required_agent_kind: str | None = Field(default=None, alias="requiredAgentKind")
    source: Literal["desktop", "web", "mobile"] | None = None


class UpdateCloudWorkspaceBranchRequest(BaseModel):
    branch_name: str = Field(alias="branchName")


class UpdateCloudWorkspaceDisplayNameRequest(BaseModel):
    """Set or clear the user-provided cloud workspace display name.

    `None` (or an empty/whitespace string) clears the override and restores
    the default branch- or repo-derived label in the sidebar.
    """

    display_name: str | None = Field(default=None, alias="displayName")


class RepoRef(BaseModel):
    provider: str
    owner: str
    name: str
    branch: str
    base_branch: str = Field(serialization_alias="baseBranch")


class OriginContext(BaseModel):
    """Advisory provenance metadata; not authoritative for policy decisions."""

    kind: Literal["human", "cowork", "api", "system"]
    entrypoint: Literal[
        "desktop",
        "web",
        "mobile",
        "cloud",
        "local_runtime",
        "cowork",
        "slack",
        "api",
    ]


class WorkspaceCreatorContext(BaseModel):
    """Display/navigation provenance for workspace creators."""

    kind: Literal["human", "automation", "agent"]
    automation_id: str | None = Field(default=None, serialization_alias="automationId")
    automation_run_id: str | None = Field(default=None, serialization_alias="automationRunId")
    source_session_id: str | None = Field(default=None, serialization_alias="sourceSessionId")
    source_session_workspace_id: str | None = Field(
        default=None,
        serialization_alias="sourceSessionWorkspaceId",
    )
    session_link_id: str | None = Field(default=None, serialization_alias="sessionLinkId")
    source_workspace_id: str | None = Field(default=None, serialization_alias="sourceWorkspaceId")
    label: str | None = None


class WorkspaceDirectTargetContext(BaseModel):
    """Direct runtime materialization for non-managed cloud targets."""

    target_id: str = Field(serialization_alias="targetId")
    target_kind: str = Field(serialization_alias="targetKind")
    anyharness_workspace_id: str = Field(serialization_alias="anyharnessWorkspaceId")


class WorkspaceExecutionTargetSummary(BaseModel):
    kind: Literal["local_desktop", "managed_cloud", "ssh", "self_hosted"]
    target_id: str | None = Field(default=None, serialization_alias="targetId")
    label: str | None = None
    online: bool | None = None


class WorkspaceMaterializationSummary(BaseModel):
    id: str
    target_id: str | None = Field(default=None, serialization_alias="targetId")
    anyharness_workspace_id: str | None = Field(
        default=None,
        serialization_alias="anyharnessWorkspaceId",
    )
    worktree_path: str | None = Field(default=None, serialization_alias="worktreePath")
    state: Literal["hydrated", "dehydrated", "hydrating", "unknown", "inconsistent"]
    desired_state: Literal["hydrated", "dehydrated"] = Field(serialization_alias="desiredState")
    cleanup_status: Literal["idle", "pruning", "blocked", "failed", "skipped", "completed"] = (
        Field(
            serialization_alias="cleanupStatus",
        )
    )
    cleanup_last_error: str | None = Field(default=None, serialization_alias="cleanupLastError")
    blockers: list[str] = Field(default_factory=list)
    generation: int
    storage_bytes: int | None = Field(default=None, serialization_alias="storageBytes")


class WorkspaceCloudAccessSummary(BaseModel):
    state: Literal["disabled", "enabled", "enabling", "error"]
    exposure_id: str | None = Field(default=None, serialization_alias="exposureId")
    exposure_revision: int | None = Field(default=None, serialization_alias="exposureRevision")
    projection_state: Literal["untracked", "tracked", "live", "paused", "stale", "revoked"] = (
        Field(
            serialization_alias="projectionState",
        )
    )
    commandable: bool


class WorkspaceExposureSummary(BaseModel):
    id: str
    visibility: Literal["private", "shared_unclaimed", "claimed", "archived"]
    claimed_by_user_id: str | None = Field(default=None, serialization_alias="claimedByUserId")
    default_projection_level: str = Field(serialization_alias="defaultProjectionLevel")
    commandable: bool
    status: Literal["active", "paused", "stale", "revoked"]


class LastSessionSummary(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    workspace_id: str | None = Field(default=None, serialization_alias="workspaceId")
    session_id: str = Field(serialization_alias="sessionId")
    source_agent_kind: str | None = Field(default=None, serialization_alias="sourceAgentKind")
    title: str | None = None
    status: str
    phase: str | None = None
    pending_interaction_count: int = Field(
        default=0,
        serialization_alias="pendingInteractionCount",
    )
    last_event_at: str | None = Field(default=None, serialization_alias="lastEventAt")
    preview: str | None = None


class WorkspaceBillingSummary(BaseModel):
    plan: str
    billing_mode: str = Field(serialization_alias="billingMode")
    block_status: Literal["allowed", "blocked", "warn"] = Field(
        serialization_alias="blockStatus",
    )
    block_reason: str | None = Field(default=None, serialization_alias="blockReason")
    hold_kind: str | None = Field(default=None, serialization_alias="holdKind")
    remaining_seconds_in_period: float | None = Field(
        default=None,
        serialization_alias="remainingSecondsInPeriod",
    )
    overage_enabled: bool = Field(serialization_alias="overageEnabled")
    overage_cap_cents_per_seat: int | None = Field(
        default=None,
        serialization_alias="overageCapCentsPerSeat",
    )
    overage_used_cents_this_period: int = Field(
        serialization_alias="overageUsedCentsThisPeriod",
    )
    start_blocked: bool = Field(serialization_alias="startBlocked")
    start_block_reason: str | None = Field(default=None, serialization_alias="startBlockReason")
    active_spend_hold: bool = Field(serialization_alias="activeSpendHold")
    hold_reason: str | None = Field(default=None, serialization_alias="holdReason")
    remaining_seconds: float | None = Field(default=None, serialization_alias="remainingSeconds")
    active_sandbox_count: int = Field(serialization_alias="activeSandboxCount")
    active_environment_limit: int | None = Field(
        default=None,
        serialization_alias="activeEnvironmentLimit",
    )


class WorkspaceSummary(BaseModel):
    id: str
    target_id: str | None = Field(default=None, serialization_alias="targetId")
    display_name: str | None = Field(serialization_alias="displayName")
    repo: RepoRef
    workspace_status: Literal[
        "pending",
        "materializing",
        "needs_rematerialization",
        "ready",
        "archived",
        "error",
    ] = Field(serialization_alias="workspaceStatus")
    product_lifecycle: Literal["active", "archived", "deleted"] = Field(
        serialization_alias="productLifecycle",
    )
    runtime: WorkspaceRuntimeSummary
    execution_target: WorkspaceExecutionTargetSummary = Field(
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
    cloud_access: WorkspaceCloudAccessSummary = Field(serialization_alias="cloudAccess")
    status_detail: str | None = Field(serialization_alias="statusDetail")
    last_error: str | None = Field(serialization_alias="lastError")
    template_version: str | None = Field(serialization_alias="templateVersion")
    updated_at: str | None = Field(serialization_alias="updatedAt")
    created_at: str | None = Field(serialization_alias="createdAt")
    ready_at: str | None = Field(serialization_alias="readyAt")
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
    creator_context: WorkspaceCreatorContext | None = Field(
        default=None,
        serialization_alias="creatorContext",
    )
    direct_target_context: WorkspaceDirectTargetContext | None = Field(
        default=None,
        serialization_alias="directTargetContext",
    )
    visibility: Literal["private", "shared_unclaimed", "claimed", "archived"] = "private"
    exposure: WorkspaceExposureSummary | None = None
    exposure_state: Literal["untracked", "tracked", "live", "paused", "stale", "revoked"] = Field(
        default="untracked",
        serialization_alias="exposureState",
    )
    sandbox_type: Literal[
        "local",
        "ssh",
        "managed_personal",
        "managed_shared",
        "self_hosted",
    ] = Field(default="managed_personal", serialization_alias="sandboxType")
    last_activity_at: str | None = Field(default=None, serialization_alias="lastActivityAt")
    last_session_summary: LastSessionSummary | None = Field(
        default=None,
        serialization_alias="lastSessionSummary",
    )
    claimed_by_user_id: str | None = Field(default=None, serialization_alias="claimedByUserId")
    claim_id: str | None = Field(default=None, serialization_alias="claimId")
    claimed_at: str | None = Field(default=None, serialization_alias="claimedAt")
    claim_source_kind: str | None = Field(default=None, serialization_alias="claimSourceKind")
    billing: WorkspaceBillingSummary | None = None


class WorkspaceDetail(WorkspaceSummary):
    allowed_agent_kinds: list[str] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")


class WorkspaceRuntimeAuthState(BaseModel):
    status: Literal[
        "current",
        "stale",
        "restart_required",
        "apply_failed",
        "missing_credentials",
    ]
    config_current: bool = Field(serialization_alias="configCurrent")
    target_current: bool = Field(serialization_alias="targetCurrent")
    requires_restart: bool = Field(serialization_alias="requiresRestart")
    desired_revision: int | None = Field(default=None, serialization_alias="desiredRevision")
    applied_revision: int | None = Field(default=None, serialization_alias="appliedRevision")
    last_error: str | None = Field(default=None, serialization_alias="lastError")
    last_error_at: str | None = Field(default=None, serialization_alias="lastErrorAt")
    last_attempted_at: str | None = Field(default=None, serialization_alias="lastAttemptedAt")
    last_applied_at: str | None = Field(
        default=None,
        serialization_alias="lastAppliedAt",
    )


class WorkspaceRuntimeSummary(BaseModel):
    environment_id: str | None = Field(serialization_alias="environmentId")
    status: Literal["pending", "provisioning", "running", "paused", "error", "disabled"]
    generation: int
    runtime_auth: WorkspaceRuntimeAuthState | None = Field(
        default=None,
        serialization_alias="runtimeAuth",
    )
    action_block_kind: str | None = Field(default=None, serialization_alias="actionBlockKind")
    action_block_reason: str | None = Field(default=None, serialization_alias="actionBlockReason")
