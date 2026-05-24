"""Request schemas and response payload builders for cloud workspace APIs."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudRuntimeEnvironmentStatus,
    CloudWorkspaceStatus,
)
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.runtime.auth_status import RuntimeAuthStateSnapshot

logger = logging.getLogger(__name__)


class WorkspaceRecord(Protocol):
    id: UUID
    target_id: UUID | None
    display_name: str | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str | None
    origin: str
    origin_json: str | None
    status: str
    status_detail: str | None
    last_error: str | None
    template_version: str
    runtime_generation: int
    anyharness_workspace_id: str | None
    repo_post_ready_phase: str
    repo_post_ready_files_total: int
    repo_post_ready_files_applied: int
    repo_post_ready_started_at: datetime | None
    repo_post_ready_completed_at: datetime | None
    repo_files_last_failed_path: str | None
    updated_at: datetime
    created_at: datetime


class WorkspaceExposureRecord(Protocol):
    id: UUID
    visibility: str
    claimed_by_user_id: UUID | None
    default_projection_level: str
    commandable: bool
    status: str
    last_projected_at: datetime | None


class WorkspaceClaimRecord(Protocol):
    id: UUID
    claimed_by_user_id: UUID | None
    claimed_at: datetime
    source_kind: str


class WorkspaceSessionSummaryRecord(Protocol):
    target_id: UUID
    workspace_id: str | None
    session_id: str
    title: str | None
    status: str
    last_event_at: str | None


class RuntimeEnvironmentRecord(Protocol):
    id: UUID
    status: str
    runtime_generation: int


class WorkspaceBillingRecord(Protocol):
    plan: str
    billing_mode: str
    included_hours: float | None
    start_blocked: bool
    start_block_reason: str | None
    active_spend_hold: bool
    hold_reason: str | None
    remaining_seconds: float | None
    overage_enabled: bool
    overage_cap_cents_per_seat: int | None
    managed_cloud_overage_used_cents: int
    active_sandbox_count: int
    active_environment_limit: int | None


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


class CloudWorkspaceLaunchPreflightRequest(BaseModel):
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    target_kind: str = Field(default="managed_cloud", alias="targetKind")
    required_agent_kind: str | None = Field(default=None, alias="requiredAgentKind")
    required_managed_resources: list[Literal["compute", "llm", "gateway"]] = Field(
        default_factory=lambda: ["compute"],
        alias="requiredManagedResources",
    )


class CloudWorkspaceLaunchPreflightBillingSummary(BaseModel):
    owner_scope: Literal["personal", "organization"] = Field(alias="ownerScope")
    organization_id: str | None = Field(default=None, alias="organizationId")
    billing_subject_id: str | None = Field(default=None, alias="billingSubjectId")
    plan: str | None = None
    payment_healthy: bool | None = Field(default=None, alias="paymentHealthy")
    remaining_seconds: float | None = Field(default=None, alias="remainingSeconds")
    managed_llm_status: str | None = Field(default=None, alias="managedLlmStatus")


class CloudWorkspaceLaunchPreflightResponse(BaseModel):
    launch_allowed: bool = Field(alias="launchAllowed")
    blocked_reason: str | None = Field(default=None, alias="blockedReason")
    blocked_resource: Literal["compute", "llm", "gateway", "billing", "seat"] | None = Field(
        default=None,
        alias="blockedResource",
    )
    billing: CloudWorkspaceLaunchPreflightBillingSummary


class UpdateCloudWorkspaceBranchRequest(BaseModel):
    branch_name: str = Field(alias="branchName")


class UpdateCloudWorkspaceDisplayNameRequest(BaseModel):
    """Set or clear the user-provided cloud workspace display name.

    `None` (or an empty/whitespace string) clears the override and restores
    the default branch- or repo-derived label in the sidebar.
    """

    display_name: str | None = Field(default=None, alias="displayName")


class RemoteAccessRepoRef(BaseModel):
    provider: str = "local"
    owner: str = "local"
    name: str
    branch: str = "default"
    base_branch: str | None = Field(default=None, alias="baseBranch")


class BootstrapWorkspaceRemoteAccessRequest(BaseModel):
    target_id: UUID = Field(alias="targetId")
    anyharness_workspace_id: str = Field(alias="anyharnessWorkspaceId", min_length=1)
    anyharness_session_id: str | None = Field(default=None, alias="anyharnessSessionId")
    display_name: str | None = Field(default=None, alias="displayName")
    repo: RemoteAccessRepoRef | None = None


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
    title: str | None = None
    status: str
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


class WorkspaceConnection(BaseModel):
    runtime_url: str = Field(serialization_alias="runtimeUrl")
    access_token: str = Field(serialization_alias="accessToken")
    anyharness_workspace_id: str | None = Field(serialization_alias="anyharnessWorkspaceId")
    runtime_generation: int = Field(serialization_alias="runtimeGeneration")
    allowed_agent_kinds: list[CloudAgentKind] = Field(serialization_alias="allowedAgentKinds")
    ready_agent_kinds: list[str] = Field(serialization_alias="readyAgentKinds")
    runtime_auth: WorkspaceRuntimeAuthState = Field(
        serialization_alias="runtimeAuth",
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


def _repo_ref(workspace: WorkspaceRecord) -> RepoRef:
    return RepoRef(
        provider=workspace.git_provider,
        owner=workspace.git_owner,
        name=workspace.git_repo_name,
        branch=workspace.git_branch,
        base_branch=workspace.git_base_branch or workspace.git_branch,
    )


def _origin_payload(workspace: WorkspaceRecord) -> OriginContext | None:
    if not workspace.origin_json:
        return _origin_context_from_legacy_origin(workspace.origin)
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
        return _origin_context_from_legacy_origin(workspace.origin)


def _origin_context_from_legacy_origin(origin: str | None) -> OriginContext | None:
    if origin == "manual_desktop":
        return OriginContext(kind="human", entrypoint="desktop")
    if origin == "manual_web":
        return OriginContext(kind="human", entrypoint="web")
    if origin == "manual_mobile":
        return OriginContext(kind="human", entrypoint="mobile")
    if origin == "automation":
        return OriginContext(kind="system", entrypoint="cloud")
    if origin == "slack":
        return OriginContext(kind="system", entrypoint="slack")
    if origin == "cowork_api":
        return OriginContext(kind="api", entrypoint="api")
    return None


def runtime_auth_payload(
    snapshot: RuntimeAuthStateSnapshot | None,
) -> WorkspaceRuntimeAuthState | None:
    if snapshot is None:
        return None
    return WorkspaceRuntimeAuthState(
        status=snapshot.status,
        config_current=snapshot.config_current,
        target_current=snapshot.target_current,
        requires_restart=snapshot.requires_restart,
        desired_revision=snapshot.desired_revision,
        applied_revision=snapshot.applied_revision,
        last_error=snapshot.last_error,
        last_error_at=_to_iso(snapshot.last_error_at),
        last_attempted_at=_to_iso(snapshot.last_attempted_at),
        last_applied_at=_to_iso(snapshot.last_applied_at),
    )


def exposure_payload(exposure: WorkspaceExposureRecord | None) -> WorkspaceExposureSummary | None:
    if exposure is None:
        return None
    visibility = (
        exposure.visibility
        if exposure.visibility
        in {
            "private",
            "shared_unclaimed",
            "claimed",
            "archived",
        }
        else "private"
    )
    status = (
        exposure.status if exposure.status in {"active", "paused", "stale", "revoked"} else "stale"
    )
    return WorkspaceExposureSummary(
        id=str(exposure.id),
        visibility=visibility,
        claimed_by_user_id=(
            str(exposure.claimed_by_user_id) if exposure.claimed_by_user_id is not None else None
        ),
        default_projection_level=exposure.default_projection_level,
        commandable=exposure.commandable,
        status=status,
    )


def exposure_state_payload(exposure: WorkspaceExposureRecord | None) -> str:
    if exposure is None:
        return "untracked"
    if exposure.status in {"paused", "stale", "revoked"}:
        return exposure.status
    if exposure.status == "active" and exposure.last_projected_at is not None:
        return "live"
    return "tracked"


def sandbox_type_payload(workspace: WorkspaceRecord, target_kind: str | None) -> str:
    if target_kind == "ssh":
        return "ssh"
    if target_kind in {"desktop_dispatch", "local_direct"}:
        return "local"
    if target_kind == "self_hosted_cloud":
        return "self_hosted"
    return (
        "managed_shared"
        if getattr(workspace, "owner_scope", None) == "organization"
        else "managed_personal"
    )


def last_session_summary_payload(
    session: WorkspaceSessionSummaryRecord | None,
) -> LastSessionSummary | None:
    if session is None:
        return None
    return LastSessionSummary(
        target_id=str(session.target_id),
        workspace_id=session.workspace_id,
        session_id=session.session_id,
        title=session.title,
        status=session.status,
        last_event_at=session.last_event_at,
        preview=session.title,
    )


def billing_summary_payload(
    billing: WorkspaceBillingRecord | None,
) -> WorkspaceBillingSummary | None:
    if billing is None:
        return None
    block_status: Literal["allowed", "blocked", "warn"] = "allowed"
    if billing.start_blocked:
        block_status = "blocked"
    elif (
        billing.included_hours is not None
        and billing.remaining_seconds is not None
        and billing.included_hours > 0
        and 0 < billing.remaining_seconds <= (billing.included_hours * 3600.0 * 0.1)
    ):
        block_status = "warn"
    return WorkspaceBillingSummary(
        plan=billing.plan,
        billing_mode=billing.billing_mode,
        block_status=block_status,
        block_reason=billing.start_block_reason,
        hold_kind=billing.hold_reason,
        remaining_seconds_in_period=billing.remaining_seconds,
        overage_enabled=billing.overage_enabled,
        overage_cap_cents_per_seat=billing.overage_cap_cents_per_seat,
        overage_used_cents_this_period=billing.managed_cloud_overage_used_cents,
        start_blocked=billing.start_blocked,
        start_block_reason=billing.start_block_reason,
        active_spend_hold=billing.active_spend_hold,
        hold_reason=billing.hold_reason,
        remaining_seconds=billing.remaining_seconds,
        active_sandbox_count=billing.active_sandbox_count,
        active_environment_limit=billing.active_environment_limit,
    )


def workspace_summary_payload(
    workspace: WorkspaceRecord,
    *,
    runtime_environment: RuntimeEnvironmentRecord | None = None,
    runtime_auth: RuntimeAuthStateSnapshot | None = None,
    billing: WorkspaceBillingRecord | None = None,
    action_block_kind: str | None = None,
    action_block_reason: str | None = None,
    creator_context: WorkspaceCreatorContext | None = None,
    direct_target_context: WorkspaceDirectTargetContext | None = None,
    exposure: WorkspaceExposureRecord | None = None,
    claim: WorkspaceClaimRecord | None = None,
    last_session_summary: WorkspaceSessionSummaryRecord | None = None,
    target_kind: str | None = None,
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
    session_summary = last_session_summary_payload(last_session_summary)
    return WorkspaceSummary(
        id=str(workspace.id),
        target_id=str(workspace.target_id) if workspace.target_id is not None else None,
        display_name=workspace.display_name,
        repo=_repo_ref(workspace),
        workspace_status=workspace_status,
        runtime=WorkspaceRuntimeSummary(
            environment_id=(
                str(runtime_environment.id) if runtime_environment is not None else None
            ),
            status=runtime_status,
            generation=(
                runtime_environment.runtime_generation
                if runtime_environment is not None
                else workspace.runtime_generation
            ),
            runtime_auth=runtime_auth_payload(runtime_auth),
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
        creator_context=creator_context,
        direct_target_context=direct_target_context,
        visibility=exposure.visibility if exposure is not None else "private",
        exposure=exposure_payload(exposure),
        exposure_state=exposure_state_payload(exposure),
        sandbox_type=sandbox_type_payload(workspace, target_kind),
        last_activity_at=(
            session_summary.last_event_at
            if session_summary is not None and session_summary.last_event_at is not None
            else _to_iso(workspace.updated_at)
        ),
        last_session_summary=session_summary,
        claimed_by_user_id=(
            str(exposure.claimed_by_user_id)
            if exposure is not None and exposure.claimed_by_user_id is not None
            else (str(claim.claimed_by_user_id) if claim and claim.claimed_by_user_id else None)
        ),
        claim_id=str(claim.id) if claim is not None else None,
        claimed_at=_to_iso(claim.claimed_at) if claim is not None else None,
        claim_source_kind=claim.source_kind if claim is not None else None,
        billing=billing_summary_payload(billing),
    )


def workspace_detail_payload(
    workspace: WorkspaceRecord,
    ready_agent_kind_values: list[str] | tuple[str, ...],
    *,
    runtime_environment: RuntimeEnvironmentRecord | None = None,
    runtime_auth: RuntimeAuthStateSnapshot | None = None,
    billing: WorkspaceBillingRecord | None = None,
    action_block_kind: str | None = None,
    action_block_reason: str | None = None,
    creator_context: WorkspaceCreatorContext | None = None,
    direct_target_context: WorkspaceDirectTargetContext | None = None,
    exposure: WorkspaceExposureRecord | None = None,
    claim: WorkspaceClaimRecord | None = None,
    last_session_summary: WorkspaceSessionSummaryRecord | None = None,
    target_kind: str | None = None,
) -> WorkspaceDetail:
    summary = workspace_summary_payload(
        workspace,
        runtime_environment=runtime_environment,
        runtime_auth=runtime_auth,
        billing=billing,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        creator_context=creator_context,
        direct_target_context=direct_target_context,
        exposure=exposure,
        claim=claim,
        last_session_summary=last_session_summary,
        target_kind=target_kind,
    )
    return WorkspaceDetail(
        **summary.model_dump(),
        allowed_agent_kinds=allowed_agent_kinds(),
        ready_agent_kinds=sorted(set(ready_agent_kind_values)),
        anyharness_workspace_id=workspace.anyharness_workspace_id,
    )
