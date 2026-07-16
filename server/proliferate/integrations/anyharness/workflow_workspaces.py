"""Typed Workflow workspace placement calls for a direct AnyHarness target."""

from __future__ import annotations

from proliferate.integrations.anyharness.errors import WorkflowRuntimeError
from proliferate.integrations.anyharness.models import WorkflowWorkspaceAcceptance
from proliferate.integrations.anyharness.workflow_client import request_json


async def resolve_workflow_repo_root(
    runtime_url: str,
    access_token: str,
    *,
    runtime_workdir: str,
) -> str:
    _status, payload = await request_json(
        "POST",
        f"{runtime_url}/v1/workspaces/resolve",
        access_token=access_token,
        operation="workflow_repo_root_resolve",
        expected_statuses=frozenset({200}),
        body={
            "path": runtime_workdir,
            "origin": {"kind": "human", "entrypoint": "cloud"},
        },
        timeout_seconds=20.0,
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("workspace"), dict):
        raise WorkflowRuntimeError("workflow_repo_root_invalid_response")
    workspace = payload["workspace"]
    repo_root_id = workspace.get("repoRootId")
    if not isinstance(repo_root_id, str) or not repo_root_id:
        repo_root = payload.get("repoRoot")
        repo_root_id = repo_root.get("id") if isinstance(repo_root, dict) else None
    if not isinstance(repo_root_id, str) or not repo_root_id:
        raise WorkflowRuntimeError("workflow_repo_root_invalid_response")
    return repo_root_id


async def put_workflow_workspace(
    runtime_url: str,
    access_token: str,
    *,
    run_id: str,
    placement: dict[str, object],
) -> WorkflowWorkspaceAcceptance:
    _status, payload = await request_json(
        "PUT",
        f"{runtime_url}/v1/workflow-run-workspaces/{run_id}",
        access_token=access_token,
        operation="workflow_workspace_put",
        expected_statuses=frozenset({200, 201}),
        body={"schemaVersion": 1, "placement": placement},
        timeout_seconds=660.0,
    )
    if not isinstance(payload, dict):
        raise WorkflowRuntimeError("workflow_workspace_put_invalid_response")
    if payload.get("runId") != run_id or payload.get("schemaVersion") != 1:
        raise WorkflowRuntimeError("workflow_workspace_put_identity_mismatch")
    status = payload.get("status")
    workspace_id = payload.get("workspaceId")
    if status == "failed":
        raise WorkflowRuntimeError("workflow_workspace_materialization_failed")
    if status != "ready":
        raise WorkflowRuntimeError("workflow_workspace_not_ready", retryable=True)
    if not isinstance(workspace_id, str) or not workspace_id.strip():
        raise WorkflowRuntimeError("workflow_workspace_put_invalid_response")
    return WorkflowWorkspaceAcceptance(workspace_id=workspace_id)
