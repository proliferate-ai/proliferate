"""Automation API models and payload builders."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.automations import AutomationRunValue, AutomationValue

ExecutionTarget = Literal["cloud", "local"]
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
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    schedule: AutomationScheduleRequest
    execution_target: ExecutionTarget = Field(alias="executionTarget")
    agent_kind: str | None = Field(default=None, alias="agentKind")
    model_id: str | None = Field(default=None, alias="modelId")
    mode_id: str | None = Field(default=None, alias="modeId")
    reasoning_effort: str | None = Field(default=None, alias="reasoningEffort")


class UpdateAutomationRequest(AutomationBaseModel):
    title: str | None = None
    prompt: str | None = None
    git_owner: str | None = Field(default=None, alias="gitOwner")
    git_repo_name: str | None = Field(default=None, alias="gitRepoName")
    schedule: AutomationScheduleRequest | None = None
    execution_target: ExecutionTarget | None = Field(default=None, alias="executionTarget")
    agent_kind: str | None = Field(default=None, alias="agentKind")
    model_id: str | None = Field(default=None, alias="modelId")
    mode_id: str | None = Field(default=None, alias="modeId")
    reasoning_effort: str | None = Field(default=None, alias="reasoningEffort")


class AutomationScheduleResponse(AutomationBaseModel):
    rrule: str
    timezone: str
    summary: str
    next_run_at: str | None = Field(alias="nextRunAt")


class AutomationResponse(AutomationBaseModel):
    id: str
    git_owner: str = Field(alias="gitOwner")
    git_repo_name: str = Field(alias="gitRepoName")
    title: str
    prompt: str
    schedule: AutomationScheduleResponse
    execution_target: ExecutionTarget = Field(alias="executionTarget")
    agent_kind: str | None = Field(alias="agentKind")
    model_id: str | None = Field(alias="modelId")
    mode_id: str | None = Field(alias="modeId")
    reasoning_effort: str | None = Field(alias="reasoningEffort")
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
    trigger_kind: RunTriggerKind = Field(alias="triggerKind")
    scheduled_for: str | None = Field(alias="scheduledFor")
    execution_target: ExecutionTarget = Field(alias="executionTarget")
    status: RunStatus
    title_snapshot: str = Field(alias="titleSnapshot")
    agent_kind_snapshot: str | None = Field(alias="agentKindSnapshot")
    model_id_snapshot: str | None = Field(alias="modelIdSnapshot")
    mode_id_snapshot: str | None = Field(alias="modeIdSnapshot")
    reasoning_effort_snapshot: str | None = Field(alias="reasoningEffortSnapshot")
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
    execution_target: ExecutionTarget = Field(alias="executionTarget")
    title_snapshot: str = Field(alias="titleSnapshot")
    prompt_snapshot: str = Field(alias="promptSnapshot")
    git_provider_snapshot: str = Field(alias="gitProviderSnapshot")
    git_owner_snapshot: str = Field(alias="gitOwnerSnapshot")
    git_repo_name_snapshot: str = Field(alias="gitRepoNameSnapshot")
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
        execution_target=value.execution_target,  # type: ignore[arg-type]
        agent_kind=value.agent_kind,
        model_id=value.model_id,
        mode_id=value.mode_id,
        reasoning_effort=value.reasoning_effort,
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
        trigger_kind=value.trigger_kind,  # type: ignore[arg-type]
        scheduled_for=_to_iso(value.scheduled_for),
        execution_target=value.execution_target,  # type: ignore[arg-type]
        status=value.status,  # type: ignore[arg-type]
        title_snapshot=value.title_snapshot,
        agent_kind_snapshot=value.agent_kind_snapshot,
        model_id_snapshot=value.model_id_snapshot,
        mode_id_snapshot=value.mode_id_snapshot,
        reasoning_effort_snapshot=value.reasoning_effort_snapshot,
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
        execution_target=value.execution_target,  # type: ignore[arg-type]
        title_snapshot=value.title,
        prompt_snapshot=value.prompt,
        git_provider_snapshot=value.git_provider,
        git_owner_snapshot=value.git_owner,
        git_repo_name_snapshot=value.git_repo_name,
        agent_kind_snapshot=value.agent_kind,
        model_id_snapshot=value.model_id,
        mode_id_snapshot=value.mode_id,
        reasoning_effort_snapshot=value.reasoning_effort,
        claim_id=str(value.claim_id),
        claim_expires_at=value.claim_expires_at.isoformat(),
        anyharness_workspace_id=value.anyharness_workspace_id,
        anyharness_session_id=value.anyharness_session_id,
    )
