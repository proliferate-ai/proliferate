"""Managed Cloud execution wire models and projections."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from proliferate.db.store.workflow_invocations import WorkflowInvocationSnapshot
from proliferate.db.store.workflow_managed_execution import WorkflowManagedExecutionSnapshot
from proliferate.db.store.workflow_managed_history import WorkflowHistoryItem
from proliferate.server.workflows.models import (
    WorkflowInvocationResponse,
    WorkflowInvocationWireModel,
    workflow_invocation_response,
)


class ManagedWorkflowExecutionStep(WorkflowInvocationWireModel):
    index: Literal[0]
    status: Literal["pending", "running", "completed", "failed", "cancelled", "interrupted"]
    failure_code: str | None
    interruption_code: Literal["runtime_restarted"] | None
    started_at: datetime | None
    finished_at: datetime | None


class ManagedWorkflowRuntimeExecution(WorkflowInvocationWireModel):
    status: Literal["accepted", "running", "completed", "failed", "cancelled", "interrupted"]
    state_version: int = Field(ge=1)
    cancel_requested_at: datetime | None
    failure_code: str | None
    interruption_code: Literal["runtime_restarted"] | None
    stop_reason: str | None
    started_at: datetime | None
    finished_at: datetime | None
    steps: list[ManagedWorkflowExecutionStep] = Field(min_length=1, max_length=1)


class ManagedWorkflowFreshness(WorkflowInvocationWireModel):
    status: Literal["pending", "live", "stale", "unreachable", "target_lost"]
    latest_observed_at: datetime | None


class ManagedWorkflowCorrelations(WorkflowInvocationWireModel):
    cloud_workspace_id: UUID | None
    anyharness_workspace_id: str | None
    session_id: str | None
    prompt_id: str | None
    turn_id: str | None


class ManagedWorkflowOpenTarget(WorkflowInvocationWireModel):
    cloud_workspace_id: UUID
    anyharness_workspace_id: str
    session_id: str


class ManagedWorkflowExecutionResponse(WorkflowInvocationWireModel):
    delivery_status: Literal[
        "prepared", "queued", "delivering", "accepted", "delivery_failed", "delivery_cancelled"
    ]
    delivery_checkpoint: Literal[
        "none",
        "target_plan_frozen",
        "target_bound",
        "workspace_put_started",
        "workspace_ready",
        "run_put_started",
        "accepted",
    ]
    desired_state: Literal["active", "cancelled"]
    execution: ManagedWorkflowRuntimeExecution | None
    freshness: ManagedWorkflowFreshness
    correlations: ManagedWorkflowCorrelations
    open_target: ManagedWorkflowOpenTarget | None
    delivery_error_code: str | None
    observation_error_code: str | None
    accepted_at: datetime | None
    updated_at: datetime


class ManagedWorkflowInvocationResponse(WorkflowInvocationResponse):
    managed_execution: ManagedWorkflowExecutionResponse


class ManagedWorkflowHistoryItem(WorkflowInvocationWireModel):
    id: UUID
    workflow_definition_id: UUID
    definition_revision: int
    title: str
    placement_kind: Literal["repositoryWorktree", "scratch"]
    target_kind: Literal["managedCloud"]
    delivery_status: str
    desired_state: str
    execution_status: str | None
    freshness: Literal["pending", "live", "stale", "unreachable", "target_lost"]
    latest_observed_at: datetime | None
    cloud_workspace_id: UUID | None
    session_id: str | None
    created_at: datetime
    updated_at: datetime


class ManagedWorkflowHistoryResponse(WorkflowInvocationWireModel):
    items: list[ManagedWorkflowHistoryItem]
    next_cursor: str | None


def managed_workflow_invocation_response(
    invocation: WorkflowInvocationSnapshot,
    managed: WorkflowManagedExecutionSnapshot,
    *,
    freshness: str,
    open_target_available: bool,
) -> ManagedWorkflowInvocationResponse:
    projection = managed.latest_projection_json
    execution = None
    if projection is not None:
        execution = ManagedWorkflowRuntimeExecution.model_validate(
            {
                "status": projection.get("status"),
                "stateVersion": projection.get("stateVersion"),
                "cancelRequestedAt": projection.get("cancelRequestedAt"),
                "failureCode": projection.get("failureCode"),
                "interruptionCode": projection.get("interruptionCode"),
                "stopReason": projection.get("stopReason"),
                "startedAt": projection.get("startedAt"),
                "finishedAt": projection.get("finishedAt"),
                "steps": projection.get("steps"),
            }
        )
    session_id = (
        projection.get("sessionId")
        if projection is not None and isinstance(projection.get("sessionId"), str)
        else None
    )
    anyharness_workspace_id = managed.target_workspace_id
    open_target = None
    if (
        open_target_available
        and managed.cloud_workspace_id is not None
        and anyharness_workspace_id is not None
        and session_id is not None
    ):
        open_target = ManagedWorkflowOpenTarget(
            cloud_workspace_id=managed.cloud_workspace_id,
            anyharness_workspace_id=anyharness_workspace_id,
            session_id=session_id,
        )
    managed_response = ManagedWorkflowExecutionResponse(
        delivery_status=managed.delivery_status,  # type: ignore[arg-type]
        delivery_checkpoint=managed.delivery_checkpoint,  # type: ignore[arg-type]
        desired_state=managed.desired_state,  # type: ignore[arg-type]
        execution=execution,
        freshness=ManagedWorkflowFreshness(
            status=freshness,  # type: ignore[arg-type]
            latest_observed_at=managed.latest_observed_at,
        ),
        correlations=ManagedWorkflowCorrelations(
            cloud_workspace_id=managed.cloud_workspace_id,
            anyharness_workspace_id=anyharness_workspace_id,
            session_id=session_id,
            prompt_id=(
                projection.get("promptId")
                if projection is not None and isinstance(projection.get("promptId"), str)
                else None
            ),
            turn_id=(
                projection.get("turnId")
                if projection is not None and isinstance(projection.get("turnId"), str)
                else None
            ),
        ),
        open_target=open_target,
        delivery_error_code=managed.last_delivery_error_code,
        observation_error_code=managed.last_observation_error_code,
        accepted_at=managed.accepted_at,
        updated_at=managed.updated_at,
    )
    immutable = workflow_invocation_response(invocation).model_dump(
        by_alias=True,
        mode="json",
    )
    immutable["managedExecution"] = managed_response.model_dump(
        by_alias=True,
        mode="json",
    )
    return ManagedWorkflowInvocationResponse.model_validate(immutable)


def managed_workflow_invocation_payload(
    value: ManagedWorkflowInvocationResponse,
) -> dict[str, object]:
    """Preserve the immutable invocation wire while retaining managed nulls."""

    immutable = WorkflowInvocationResponse.model_validate(
        value.model_dump(
            by_alias=True,
            mode="json",
            exclude={"managed_execution"},
        )
    )
    payload = immutable.model_dump(by_alias=True, mode="json", exclude_none=True)
    payload["managedExecution"] = value.managed_execution.model_dump(
        by_alias=True,
        mode="json",
    )
    return payload


def workflow_history_item_response(
    value: WorkflowHistoryItem,
    *,
    freshness: str,
) -> ManagedWorkflowHistoryItem:
    projection = value.managed.latest_projection_json or {}
    return ManagedWorkflowHistoryItem(
        id=value.invocation_id,
        workflow_definition_id=value.workflow_definition_id,
        definition_revision=value.definition_revision,
        title=value.title,
        placement_kind=value.placement_kind,  # type: ignore[arg-type]
        target_kind=value.target_kind,  # type: ignore[arg-type]
        delivery_status=value.managed.delivery_status,
        desired_state=value.managed.desired_state,
        execution_status=value.managed.execution_status,
        freshness=freshness,  # type: ignore[arg-type]
        latest_observed_at=value.managed.latest_observed_at,
        cloud_workspace_id=value.managed.cloud_workspace_id,
        session_id=(
            projection.get("sessionId")
            if isinstance(projection.get("sessionId"), str)
            else None
        ),
        created_at=value.created_at,
        updated_at=value.managed.updated_at,
    )
