"""Runtime identity read for managed Workflow custody."""

from __future__ import annotations

from proliferate.integrations.anyharness.errors import WorkflowRuntimeError
from proliferate.integrations.anyharness.models import RuntimeExecutionStoreIdentity
from proliferate.integrations.anyharness.workflow_client import request_json


async def get_execution_store_identity(
    runtime_url: str,
    access_token: str,
) -> RuntimeExecutionStoreIdentity:
    _status, payload = await request_json(
        "GET",
        f"{runtime_url}/health",
        access_token=access_token,
        operation="runtime_identity",
        expected_statuses=frozenset({200}),
        timeout_seconds=15.0,
    )
    if not isinstance(payload, dict):
        raise WorkflowRuntimeError("runtime_identity_invalid_response")
    value = payload.get("executionStoreId")
    if not isinstance(value, str) or not value.strip() or len(value) > 255:
        raise WorkflowRuntimeError("runtime_identity_missing")
    return RuntimeExecutionStoreIdentity(execution_store_id=value)
