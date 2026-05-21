"""Automation API models and payload builders."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.automations import AutomationRunValue, AutomationValue

OwnerScope = Literal["personal", "organization"]
TargetMode = Literal["local", "personal_cloud", "shared_cloud"]
RunTriggerKind = Literal["scheduled", "manual"]
RunStatus = Literal[
    "queued",
    "claimed",
    "creating_workspace",
    "provisioning_workspace",
    "creating_session",
    "dispatching",
    "dispatched",
    "failed",
    "cancelled",
]


def _to_iso(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


class AutomationBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AutomationScheduleRequest(AutomationBaseModel):
    rrule: str
    timezone: str


class CreateAutomationRequest(AutomationBaseModel):
    title: str
    prompt: str
    owner_scope: OwnerScope = Field(default="personal", alias="ownerScope")
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    schedule: AutomationScheduleRequest
    target_mode: TargetMode = Field(default="personal_cloud", alias="targetMode")
    cloud_agent_run_config_id: UUID = Field(alias="cloudAgentRunConfigId")


class UpdateAutomationRequest(AutomationBaseModel):
    title: str | None = None
    prompt: str | None = None
    git_owner: str | None = Field(default=None, alias="gitOwner")
    git_repo_name: str | None = Field(default=None, alias="gitRepoName")
    schedule: AutomationScheduleRequest | None = None
    target_mode: TargetMode | None = Field(default=None, alias="targetMode")
    cloud_agent_run_config_id: UUID | None = Field(default=None, alias="cloudAgentRunConfigId")


class AutomationScheduleResponse(AutomationBaseModel):
    rrule: str
    timezone: str
    summary: str
    next_run_at: str | None = Field(alias="nextRunAt")


class AutomationResponse(AutomationBaseModel):
    id: str
    owner_scope: OwnerScope = Field(alias="ownerScope")
    owner_user_id: str | None = Field(alias="ownerUserId")
    organization_id: str | None = Field(alias="organizationId")
    created_by_user_id: str = Field(alias="createdByUserId")
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    title: str
    prompt: str
    schedule: AutomationScheduleResponse
    target_mode: TargetMode = Field(alias="targetMode")
    cloud_agent_run_config_id: str = Field(alias="cloudAgentRunConfigId")
    enabled: bool
    paused_at: str | None = Field(alias="pausedAt")
    last_scheduled_at: str | None = Field(alias="lastScheduledAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AutomationListResponse(AutomationBaseModel):
    automations: list[AutomationResponse]


class AutomationRunResponse(AutomationBaseModel):
    id: str
    automation_id: str = Field(alias="automationId")
    owner_scope: OwnerScope = Field(alias="ownerScope")
    owner_user_id: str | None = Field(alias="ownerUserId")
    organization_id: str | None = Field(alias="organizationId")
    created_by_user_id: str = Field(alias="createdByUserId")
    trigger_kind: RunTriggerKind = Field(alias="triggerKind")
    scheduled_for: str | None = Field(alias="scheduledFor")
    target_mode: TargetMode = Field(alias="targetMode")
    status: RunStatus
    title_snapshot: str = Field(alias="titleSnapshot")
    prompt_snapshot: str = Field(alias="promptSnapshot")
    git_provider_snapshot: str = Field(alias="gitProviderSnapshot")
    git_owner_snapshot: str = Field(alias="gitOwnerSnapshot")
    git_repo_name_snapshot: str = Field(alias="gitRepoNameSnapshot")
    cloud_repo_config_id_snapshot: str = Field(alias="cloudRepoConfigIdSnapshot")
    cloud_target_id_snapshot: str | None = Field(alias="cloudTargetIdSnapshot")
    cloud_target_kind_snapshot: str | None = Field(alias="cloudTargetKindSnapshot")
    sandbox_profile_id: str | None = Field(alias="sandboxProfileId")
    cloud_workspace_exposure_id: str | None = Field(alias="cloudWorkspaceExposureId")
    agent_run_config_snapshot: dict[str, object] | None = Field(alias="agentRunConfigSnapshot")
    cascade_attempt: int = Field(alias="cascadeAttempt")
    last_cascade_command_id: str | None = Field(alias="lastCascadeCommandId")
    last_cascade_reason: str | None = Field(alias="lastCascadeReason")
    claim_expires_at: str | None = Field(alias="claimExpiresAt")
    dispatch_started_at: str | None = Field(alias="dispatchStartedAt")
    dispatched_at: str | None = Field(alias="dispatchedAt")
    failed_at: str | None = Field(alias="failedAt")
    cloud_workspace_id: str | None = Field(alias="cloudWorkspaceId")
    anyharness_workspace_id: str | None = Field(alias="anyharnessWorkspaceId")
    anyharness_session_id: str | None = Field(alias="anyharnessSessionId")
    cancelled_at: str | None = Field(alias="cancelledAt")
    last_error_code: str | None = Field(alias="lastErrorCode")
    last_error_message: str | None = Field(alias="lastErrorMessage")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AutomationRunListResponse(AutomationBaseModel):
    runs: list[AutomationRunResponse]


class LocalExecutorRepositoryIdentity(AutomationBaseModel):
    provider: str
    owner: str
    name: str


class LocalAutomationClaimRequest(AutomationBaseModel):
    executor_id: str = Field(alias="executorId")
    available_repositories: list[LocalExecutorRepositoryIdentity] = Field(
        alias="availableRepositories",
    )
    limit: int = 1


class LocalAutomationRunClaimResponse(AutomationBaseModel):
    id: str
    automation_id: str = Field(alias="automationId")
    status: RunStatus
    target_mode: TargetMode = Field(alias="targetMode")
    title_snapshot: str = Field(alias="titleSnapshot")
    prompt_snapshot: str = Field(alias="promptSnapshot")
    git_provider_snapshot: str = Field(alias="gitProviderSnapshot")
    git_owner_snapshot: str = Field(alias="gitOwnerSnapshot")
    git_repo_name_snapshot: str = Field(alias="gitRepoNameSnapshot")
    cloud_agent_run_config_id_snapshot: str | None = Field(alias="cloudAgentRunConfigIdSnapshot")
    agent_kind_snapshot: str | None = Field(alias="agentKindSnapshot")
    model_id_snapshot: str | None = Field(alias="modelIdSnapshot")
    mode_id_snapshot: str | None = Field(alias="modeIdSnapshot")
    reasoning_effort_snapshot: str | None = Field(alias="reasoningEffortSnapshot")
    claim_id: str = Field(alias="claimId")
    claim_expires_at: str = Field(alias="claimExpiresAt")
    anyharness_workspace_id: str | None = Field(alias="anyharnessWorkspaceId")
    anyharness_session_id: str | None = Field(alias="anyharnessSessionId")


class LocalAutomationClaimListResponse(AutomationBaseModel):
    runs: list[LocalAutomationRunClaimResponse]


class LocalAutomationClaimActionRequest(AutomationBaseModel):
    executor_id: str = Field(alias="executorId")
    claim_id: UUID = Field(alias="claimId")


class LocalAutomationAttachWorkspaceRequest(LocalAutomationClaimActionRequest):
    anyharness_workspace_id: str = Field(alias="anyharnessWorkspaceId")


class LocalAutomationAttachSessionRequest(LocalAutomationAttachWorkspaceRequest):
    anyharness_session_id: str = Field(alias="anyharnessSessionId")


class LocalAutomationFailRequest(LocalAutomationClaimActionRequest):
    error_code: str = Field(alias="errorCode")


class LocalAutomationMutationResponse(AutomationBaseModel):
    run: LocalAutomationRunClaimResponse | None = None
    accepted: bool = True


def automation_payload(value: AutomationValue) -> AutomationResponse:
    return AutomationResponse(
        id=str(value.id),
        owner_scope=value.owner_scope,  # type: ignore[arg-type]
        owner_user_id=str(value.owner_user_id) if value.owner_user_id else None,
        organization_id=str(value.organization_id) if value.organization_id else None,
        created_by_user_id=str(value.created_by_user_id),
        git_owner=value.git_owner,
        git_repo_name=value.git_repo_name,
        title=value.title,
        prompt=value.prompt,
        schedule=AutomationScheduleResponse(
            rrule=value.schedule_rrule,
            timezone=value.schedule_timezone,
            summary=value.schedule_summary,
            next_run_at=_to_iso(value.next_run_at),
        ),
        target_mode=value.target_mode,  # type: ignore[arg-type]
        cloud_agent_run_config_id=str(value.cloud_agent_run_config_id),
        enabled=value.enabled,
        paused_at=_to_iso(value.paused_at),
        last_scheduled_at=_to_iso(value.last_scheduled_at),
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
    )


def automation_run_payload(value: AutomationRunValue) -> AutomationRunResponse:
    return AutomationRunResponse(
        id=str(value.id),
        automation_id=str(value.automation_id),
        owner_scope=value.owner_scope,  # type: ignore[arg-type]
        owner_user_id=str(value.owner_user_id) if value.owner_user_id else None,
        organization_id=str(value.organization_id) if value.organization_id else None,
        created_by_user_id=str(value.created_by_user_id),
        trigger_kind=value.trigger_kind,  # type: ignore[arg-type]
        scheduled_for=_to_iso(value.scheduled_for),
        target_mode=value.target_mode,  # type: ignore[arg-type]
        status=value.status,  # type: ignore[arg-type]
        title_snapshot=value.title_snapshot,
        prompt_snapshot=value.prompt_snapshot,
        git_provider_snapshot=value.git_provider_snapshot,
        git_owner_snapshot=value.git_owner_snapshot,
        git_repo_name_snapshot=value.git_repo_name_snapshot,
        cloud_repo_config_id_snapshot=str(value.cloud_repo_config_id_snapshot),
        cloud_target_id_snapshot=(
            str(value.cloud_target_id_snapshot) if value.cloud_target_id_snapshot else None
        ),
        cloud_target_kind_snapshot=value.cloud_target_kind_snapshot,
        sandbox_profile_id=str(value.sandbox_profile_id) if value.sandbox_profile_id else None,
        cloud_workspace_exposure_id=(
            str(value.cloud_workspace_exposure_id) if value.cloud_workspace_exposure_id else None
        ),
        agent_run_config_snapshot=value.agent_run_config_snapshot_json,
        cascade_attempt=value.cascade_attempt,
        last_cascade_command_id=(
            str(value.last_cascade_command_id) if value.last_cascade_command_id else None
        ),
        last_cascade_reason=value.last_cascade_reason,
        claim_expires_at=_to_iso(value.claim_expires_at),
        dispatch_started_at=_to_iso(value.dispatch_started_at),
        dispatched_at=_to_iso(value.dispatched_at),
        failed_at=_to_iso(value.failed_at),
        cloud_workspace_id=str(value.cloud_workspace_id) if value.cloud_workspace_id else None,
        anyharness_workspace_id=value.anyharness_workspace_id,
        anyharness_session_id=value.anyharness_session_id,
        cancelled_at=_to_iso(value.cancelled_at),
        last_error_code=value.last_error_code,
        last_error_message=value.last_error_message,
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
    )


def local_claim_payload(value: AutomationRunClaimValue) -> LocalAutomationRunClaimResponse:
    return LocalAutomationRunClaimResponse(
        id=str(value.id),
        automation_id=str(value.automation_id),
        status=value.status,  # type: ignore[arg-type]
        target_mode=value.target_mode,  # type: ignore[arg-type]
        title_snapshot=value.title,
        prompt_snapshot=value.prompt,
        git_provider_snapshot=value.git_provider,
        git_owner_snapshot=value.git_owner,
        git_repo_name_snapshot=value.git_repo_name,
        cloud_agent_run_config_id_snapshot=(
            str(value.cloud_agent_run_config_id_snapshot)
            if value.cloud_agent_run_config_id_snapshot
            else None
        ),
        agent_kind_snapshot=value.agent_kind,
        model_id_snapshot=value.model_id,
        mode_id_snapshot=value.mode_id,
        reasoning_effort_snapshot=value.reasoning_effort,
        claim_id=str(value.claim_id),
        claim_expires_at=value.claim_expires_at.isoformat(),
        anyharness_workspace_id=value.anyharness_workspace_id,
        anyharness_session_id=value.anyharness_session_id,
    )
