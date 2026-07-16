"""Typed Workflow run acceptance, observation, and cancellation calls."""

from __future__ import annotations

from datetime import datetime

from proliferate.integrations.anyharness.errors import WorkflowRuntimeError
from proliferate.integrations.anyharness.models import WorkflowRunProjection
from proliferate.integrations.anyharness.workflow_client import request_json

_RUN_STATUSES = {"accepted", "running", "completed", "failed", "cancelled", "interrupted"}
_STEP_STATUSES = {"pending", "running", "completed", "failed", "cancelled", "interrupted"}
_FAILURE_CODES = {
    "workspace_unavailable",
    "session_create_failed",
    "session_start_failed",
    "prompt_dispatch_failed",
    "session_turn_failed",
    "session_turn_cancelled",
    "runtime_restarted",
    "session_config_apply_failed",
}
_INTERRUPTION_CODES = {"runtime_restarted"}


async def put_workflow_run(
    runtime_url: str,
    access_token: str,
    *,
    run_id: str,
    expected_workspace_id: str,
    request: dict[str, object],
) -> WorkflowRunProjection:
    _status, payload = await request_json(
        "PUT",
        f"{runtime_url}/v1/workflow-runs/{run_id}",
        access_token=access_token,
        operation="workflow_run_put",
        expected_statuses=frozenset({200, 201}),
        body=request,
        timeout_seconds=45.0,
    )
    return WorkflowRunProjection(
        value=_safe_projection(
            payload,
            expected_run_id=run_id,
            expected_workspace_id=expected_workspace_id,
        )
    )


async def get_workflow_run(
    runtime_url: str,
    access_token: str,
    *,
    run_id: str,
    expected_workspace_id: str,
) -> WorkflowRunProjection:
    _status, payload = await request_json(
        "GET",
        f"{runtime_url}/v1/workflow-runs/{run_id}",
        access_token=access_token,
        operation="workflow_run_get",
        expected_statuses=frozenset({200}),
        timeout_seconds=20.0,
    )
    return WorkflowRunProjection(
        value=_safe_projection(
            payload,
            expected_run_id=run_id,
            expected_workspace_id=expected_workspace_id,
        )
    )


async def cancel_workflow_run(
    runtime_url: str,
    access_token: str,
    *,
    run_id: str,
    expected_workspace_id: str,
) -> WorkflowRunProjection:
    _status, payload = await request_json(
        "POST",
        f"{runtime_url}/v1/workflow-runs/{run_id}/cancel",
        access_token=access_token,
        operation="workflow_run_cancel",
        expected_statuses=frozenset({200}),
        timeout_seconds=20.0,
    )
    return WorkflowRunProjection(
        value=_safe_projection(
            payload,
            expected_run_id=run_id,
            expected_workspace_id=expected_workspace_id,
        )
    )


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 255:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    return value


def _optional_timestamp(value: object) -> str | None:
    parsed = _optional_string(value)
    if parsed is None:
        return None
    try:
        timestamp = datetime.fromisoformat(parsed.replace("Z", "+00:00"))
    except ValueError as error:
        raise WorkflowRuntimeError("workflow_run_invalid_response") from error
    if timestamp.tzinfo is None:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    return parsed


def _optional_code(value: object, *, allowed: set[str]) -> str | None:
    parsed = _optional_string(value)
    if parsed is not None and parsed not in allowed:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    return parsed


def _safe_projection(
    payload: object,
    *,
    expected_run_id: str,
    expected_workspace_id: str,
) -> dict[str, object]:
    if not isinstance(payload, dict):
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    run = payload.get("run")
    steps = payload.get("steps")
    if not isinstance(run, dict) or not isinstance(steps, list) or len(steps) != 1:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    step = steps[0]
    if not isinstance(step, dict):
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    run_id = run.get("id")
    status = run.get("status")
    state_version = run.get("stateVersion")
    workspace_id = run.get("workspaceId")
    step_status = step.get("status")
    if run_id != expected_run_id:
        raise WorkflowRuntimeError("workflow_run_identity_mismatch")
    if status not in _RUN_STATUSES or step_status not in _STEP_STATUSES:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    if not isinstance(state_version, int) or isinstance(state_version, bool) or state_version < 1:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    if workspace_id != expected_workspace_id:
        raise WorkflowRuntimeError("workflow_run_workspace_mismatch")
    if step.get("stageIndex") != 0 or step.get("stepIndex") != 0:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    prompt_id = step.get("promptId")
    if not isinstance(prompt_id, str) or not prompt_id:
        raise WorkflowRuntimeError("workflow_run_invalid_response")
    interruption_code = _optional_code(
        run.get("interruptionCode"),
        allowed=_INTERRUPTION_CODES,
    )
    return {
        "id": run_id,
        "status": status,
        "stateVersion": state_version,
        "cancelRequestedAt": _optional_timestamp(run.get("cancelRequestedAt")),
        "failureCode": _optional_code(run.get("failureCode"), allowed=_FAILURE_CODES),
        "interruptionCode": interruption_code,
        "stopReason": None,
        "workspaceId": workspace_id,
        "sessionId": _optional_string(run.get("sessionId")),
        "promptId": prompt_id,
        "turnId": _optional_string(step.get("turnId")),
        "startedAt": _optional_timestamp(run.get("startedAt")),
        "finishedAt": _optional_timestamp(run.get("finishedAt")),
        "steps": [
            {
                "index": 0,
                "status": step_status,
                "failureCode": _optional_code(
                    step.get("failureCode"),
                    allowed=_FAILURE_CODES,
                ),
                "interruptionCode": (interruption_code if step_status == "interrupted" else None),
                "startedAt": _optional_timestamp(step.get("startedAt")),
                "finishedAt": _optional_timestamp(step.get("finishedAt")),
            }
        ],
    }
