"""Automation API models and payload builders."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.automations import AutomationRunValue, AutomationValue

ExecutionTarget = Literal["cloud", "local"]
RunTriggerKind = Literal["scheduled", "manual"]
RunStatus = Literal["queued", "cancelled"]


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
    cancelled_at: str | None = Field(alias="cancelledAt")
    last_error: str | None = Field(alias="lastError")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AutomationRunListResponse(AutomationBaseModel):
    runs: list[AutomationRunResponse]


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
        cancelled_at=_to_iso(value.cancelled_at),
        last_error=value.last_error,
        created_at=value.created_at.isoformat(),
        updated_at=value.updated_at.isoformat(),
    )
