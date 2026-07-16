"""Closed runtime projection custody checks."""

from __future__ import annotations

import httpx
import pytest

from proliferate.integrations.anyharness import workflow_client
from proliferate.integrations.anyharness.errors import WorkflowRuntimeError
from proliferate.integrations.anyharness.workflow_client import request_json
from proliferate.integrations.anyharness.workflow_runs import _safe_projection


def _install_transport(
    monkeypatch: pytest.MonkeyPatch,
    *,
    status_code: int,
    payload: object = {"ok": True},
) -> None:
    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json=payload, request=request)

    def client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(workflow_client.httpx, "AsyncClient", client)


def _payload(*, workspace_id: str = "workspace-a") -> dict[str, object]:
    return {
        "run": {
            "id": "run-a",
            "status": "running",
            "stateVersion": 3,
            "workspaceId": workspace_id,
            "sessionId": "session-a",
            "cancelRequestedAt": None,
            "failureCode": None,
            "interruptionCode": None,
            "startedAt": "2026-07-16T00:00:00Z",
            "finishedAt": None,
        },
        "steps": [
            {
                "stageIndex": 0,
                "stepIndex": 0,
                "status": "running",
                "promptId": "prompt-a",
                "turnId": "turn-a",
                "failureCode": None,
                "startedAt": "2026-07-16T00:00:00Z",
                "finishedAt": None,
            }
        ],
    }


def test_projection_requires_exact_bound_workspace() -> None:
    with pytest.raises(WorkflowRuntimeError) as raised:
        _safe_projection(
            _payload(workspace_id="workspace-other"),
            expected_run_id="run-a",
            expected_workspace_id="workspace-a",
        )
    assert raised.value.code == "workflow_run_workspace_mismatch"
    assert "workspace-other" not in str(raised.value)


def test_projection_is_explicit_allowlist_with_required_null_stop_reason() -> None:
    payload = _payload()
    payload["secret"] = "never-project"
    projection = _safe_projection(
        payload,
        expected_run_id="run-a",
        expected_workspace_id="workspace-a",
    )
    assert projection["workspaceId"] == "workspace-a"
    assert projection["stopReason"] is None
    assert "secret" not in projection


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("startedAt", "not-a-timestamp"),
        ("failureCode", "provider said token=secret"),
        ("interruptionCode", "unknown_reason"),
    ],
)
def test_projection_rejects_unbounded_codes_and_malformed_timestamps(
    field: str,
    value: str,
) -> None:
    payload = _payload()
    run = payload["run"]
    assert isinstance(run, dict)
    run[field] = value
    with pytest.raises(WorkflowRuntimeError) as raised:
        _safe_projection(
            payload,
            expected_run_id="run-a",
            expected_workspace_id="workspace-a",
        )
    assert raised.value.code == "workflow_run_invalid_response"
    assert value not in str(raised.value)


def test_projection_accepts_every_closed_v2_failure_code() -> None:
    payload = _payload()
    run = payload["run"]
    steps = payload["steps"]
    assert isinstance(run, dict)
    assert isinstance(steps, list)
    step = steps[0]
    assert isinstance(step, dict)
    run["status"] = "failed"
    run["failureCode"] = "session_config_apply_failed"
    step["status"] = "failed"
    step["failureCode"] = "session_config_apply_failed"

    projection = _safe_projection(
        payload,
        expected_run_id="run-a",
        expected_workspace_id="workspace-a",
    )

    assert projection["failureCode"] == "session_config_apply_failed"
    projected_steps = projection["steps"]
    assert isinstance(projected_steps, list)
    projected_step = projected_steps[0]
    assert isinstance(projected_step, dict)
    assert projected_step["failureCode"] == "session_config_apply_failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [200, 201])
async def test_request_json_accepts_only_explicit_success_statuses(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    _install_transport(monkeypatch, status_code=status_code)

    returned_status, payload = await request_json(
        "PUT",
        "https://runtime.invalid/v1/workflow-runs/run-a",
        access_token="secret-token",
        operation="workflow_run_put",
        expected_statuses=frozenset({200, 201}),
    )

    assert returned_status == status_code
    assert payload == {"ok": True}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "code", "retryable", "authentication", "not_found"),
    [
        (204, "workflow_run_put_unexpected_status", False, False, False),
        (400, "workflow_run_put_rejected", False, False, False),
        (401, "workflow_run_put_authentication_failed", False, True, False),
        (403, "workflow_run_put_authentication_failed", False, True, False),
        (404, "workflow_run_put_not_found", False, False, True),
        (409, "workflow_run_put_rejected", False, False, False),
        (422, "workflow_run_put_rejected", False, False, False),
        (500, "workflow_run_put_unavailable", True, False, False),
    ],
)
async def test_request_json_maps_closed_status_matrix_without_body_reflection(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    code: str,
    retryable: bool,
    authentication: bool,
    not_found: bool,
) -> None:
    marker = "credential=do-not-reflect"
    _install_transport(
        monkeypatch,
        status_code=status_code,
        payload={"detail": marker},
    )

    with pytest.raises(WorkflowRuntimeError) as raised:
        await request_json(
            "PUT",
            "https://runtime.invalid/v1/workflow-runs/run-a",
            access_token="secret-token",
            operation="workflow_run_put",
            expected_statuses=frozenset({200, 201}),
        )

    assert raised.value.code == code
    assert raised.value.retryable is retryable
    assert raised.value.authentication is authentication
    assert raised.value.not_found is not_found
    assert marker not in str(raised.value)
