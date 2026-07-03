"""Cloud workflows API request/response models and payload constructors."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_workflows import (
    WorkflowRecord,
    WorkflowRunRecord,
    WorkflowVersionRecord,
)

WorkflowTargetMode = Literal["local", "personal_cloud"]
WorkflowTriggerKind = Literal["manual", "schedule", "chat", "agent", "api"]
WorkflowRunObservableStatus = Literal[
    "running", "waiting_approval", "completed", "failed", "cancelled"
]


class WorkflowBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# --- requests ------------------------------------------------------------------


class WorkflowCreateRequest(WorkflowBaseModel):
    name: str
    description: str | None = None
    # Raw definition object; validated strictly by the domain layer on write.
    definition: dict[str, object]


class WorkflowUpdateRequest(WorkflowBaseModel):
    name: str | None = None
    description: str | None = None
    definition: dict[str, object]


class StartRunRequest(WorkflowBaseModel):
    args: dict[str, object] = Field(default_factory=dict)
    target_mode: WorkflowTargetMode = Field(alias="targetMode")
    version_id: UUID | None = Field(default=None, alias="versionId")
    # Required for ``personal_cloud`` runs: the cloud workspace the server delivers
    # the resolved plan into (validated for ownership). Ignored for ``local`` runs,
    # whose workspace is picked client-side and handed to the local runtime.
    target_workspace_id: UUID | None = Field(default=None, alias="targetWorkspaceId")


class RunStatusRequest(WorkflowBaseModel):
    status: WorkflowRunObservableStatus
    step_cursor: int | None = Field(default=None, alias="stepCursor")
    step_outputs: dict[str, object] | None = Field(default=None, alias="stepOutputs")
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")
    anyharness_workspace_id: str | None = Field(default=None, alias="anyharnessWorkspaceId")
    anyharness_session_ids: list[str] | None = Field(default=None, alias="anyharnessSessionIds")
    cost_usd: float | None = Field(default=None, alias="costUsd")
    cost_tokens: int | None = Field(default=None, alias="costTokens")


# --- responses -----------------------------------------------------------------


class WorkflowResponse(WorkflowBaseModel):
    id: str
    owner_user_id: str = Field(alias="ownerUserId")
    created_by_user_id: str = Field(alias="createdByUserId")
    name: str
    description: str | None
    current_version_id: str | None = Field(alias="currentVersionId")
    archived_at: str | None = Field(alias="archivedAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class WorkflowVersionResponse(WorkflowBaseModel):
    id: str
    workflow_id: str = Field(alias="workflowId")
    version_n: int = Field(alias="versionN")
    definition: dict[str, object]
    created_by_user_id: str = Field(alias="createdByUserId")
    created_at: str = Field(alias="createdAt")


class WorkflowDetailResponse(WorkflowBaseModel):
    workflow: WorkflowResponse
    current_version: WorkflowVersionResponse | None = Field(alias="currentVersion")
    versions: list[WorkflowVersionResponse]


class WorkflowListResponse(WorkflowBaseModel):
    workflows: list[WorkflowResponse]


class WorkflowRunResponse(WorkflowBaseModel):
    id: str
    workflow_id: str = Field(alias="workflowId")
    workflow_version_id: str = Field(alias="workflowVersionId")
    trigger_kind: str = Field(alias="triggerKind")
    executor_user_id: str = Field(alias="executorUserId")
    args: dict[str, object]
    target_mode: str = Field(alias="targetMode")
    resolved_plan: dict[str, object] = Field(alias="resolvedPlan")
    status: str
    step_cursor: int | None = Field(alias="stepCursor")
    step_outputs: dict[str, object] | None = Field(alias="stepOutputs")
    anyharness_workspace_id: str | None = Field(alias="anyharnessWorkspaceId")
    anyharness_session_ids: list[str] | None = Field(alias="anyharnessSessionIds")
    error_code: str | None = Field(alias="errorCode")
    error_message: str | None = Field(alias="errorMessage")
    cost_usd: str | None = Field(alias="costUsd")
    cost_tokens: int | None = Field(alias="costTokens")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    delivered_at: str | None = Field(alias="deliveredAt")
    started_at: str | None = Field(alias="startedAt")
    finished_at: str | None = Field(alias="finishedAt")


class WorkflowRunListResponse(WorkflowBaseModel):
    runs: list[WorkflowRunResponse]


# --- constructors --------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def workflow_payload(record: WorkflowRecord) -> WorkflowResponse:
    return WorkflowResponse(
        id=str(record.id),
        owner_user_id=str(record.owner_user_id),
        created_by_user_id=str(record.created_by_user_id),
        name=record.name,
        description=record.description,
        current_version_id=str(record.current_version_id) if record.current_version_id else None,
        archived_at=_iso(record.archived_at),
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


def version_payload(record: WorkflowVersionRecord) -> WorkflowVersionResponse:
    return WorkflowVersionResponse(
        id=str(record.id),
        workflow_id=str(record.workflow_id),
        version_n=record.version_n,
        definition=record.definition_json,
        created_by_user_id=str(record.created_by_user_id),
        created_at=record.created_at.isoformat(),
    )


def workflow_detail_payload(
    workflow: WorkflowRecord,
    versions: list[WorkflowVersionRecord],
) -> WorkflowDetailResponse:
    current = next((v for v in versions if v.id == workflow.current_version_id), None)
    return WorkflowDetailResponse(
        workflow=workflow_payload(workflow),
        current_version=version_payload(current) if current is not None else None,
        versions=[version_payload(v) for v in versions],
    )


def _decimal_str(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def run_payload(record: WorkflowRunRecord) -> WorkflowRunResponse:
    return WorkflowRunResponse(
        id=str(record.id),
        workflow_id=str(record.workflow_id),
        workflow_version_id=str(record.workflow_version_id),
        trigger_kind=record.trigger_kind,
        executor_user_id=str(record.executor_user_id),
        args=record.args_json,
        target_mode=record.target_mode,
        resolved_plan=record.resolved_plan_json,
        status=record.status,
        step_cursor=record.step_cursor,
        step_outputs=record.step_outputs_json,
        anyharness_workspace_id=record.anyharness_workspace_id,
        anyharness_session_ids=record.anyharness_session_ids,
        error_code=record.error_code,
        error_message=record.error_message,
        cost_usd=_decimal_str(record.cost_usd),
        cost_tokens=record.cost_tokens,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
        delivered_at=_iso(record.delivered_at),
        started_at=_iso(record.started_at),
        finished_at=_iso(record.finished_at),
    )
