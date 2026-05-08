"""Workspace file/setup operations for AnyHarness runtimes."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers, response_preview
from proliferate.integrations.anyharness.errors import CloudRuntimeOperationError
from proliferate.integrations.anyharness.models import (
    RemoteTerminalCommandRun,
    RemoteWorkspaceFileState,
    RemoteWorkspaceSetupStart,
)


def _raise_runtime_operation_error(
    action: str,
    response: httpx.Response,
) -> None:
    raise CloudRuntimeOperationError(
        f"{action} failed with status {response.status_code}: "
        f"{response_preview(response.text) or 'no response body'}"
    )


async def read_remote_workspace_file_state(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    relative_path: str,
) -> RemoteWorkspaceFileState:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/files/file",
            headers=auth_headers(access_token),
            params={"path": relative_path},
        )
    if response.status_code == 404:
        return RemoteWorkspaceFileState(exists=False, version_token="")
    if not response.is_success:
        _raise_runtime_operation_error("Remote file read", response)

    payload = response.json()
    version_token = payload.get("versionToken")
    if not isinstance(version_token, str) or not version_token:
        raise CloudRuntimeOperationError(
            f"Remote file '{relative_path}' did not return a usable version token."
        )
    return RemoteWorkspaceFileState(exists=True, version_token=version_token)


async def write_remote_workspace_file(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    relative_path: str,
    content: str,
    expected_version_token: str,
) -> None:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.put(
            f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/files/file",
            headers=auth_headers(access_token),
            json={
                "path": relative_path,
                "content": content,
                "expectedVersionToken": expected_version_token,
            },
        )
    if not response.is_success:
        _raise_runtime_operation_error("Remote file write", response)


async def start_remote_workspace_setup(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    command: str,
    base_ref: str | None,
) -> RemoteWorkspaceSetupStart:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/setup-start",
            headers=auth_headers(access_token),
            json={"command": command, "baseRef": base_ref},
        )
    if not response.is_success:
        _raise_runtime_operation_error("Remote setup start", response)
    payload = response.json()
    terminal_id = payload.get("terminalId")
    command_run_id = payload.get("commandRunId")
    status = payload.get("status")
    if not isinstance(status, str):
        raise CloudRuntimeOperationError("Remote setup start did not return a setup status.")
    if terminal_id is not None and not isinstance(terminal_id, str):
        terminal_id = None
    if command_run_id is not None and not isinstance(command_run_id, str):
        command_run_id = None
    return RemoteWorkspaceSetupStart(
        terminal_id=terminal_id,
        command_run_id=command_run_id,
        status=status,
    )


async def get_remote_terminal_command_run(
    runtime_url: str,
    access_token: str,
    *,
    command_run_id: str,
) -> RemoteTerminalCommandRun:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{runtime_url}/v1/terminal-command-runs/{command_run_id}",
            headers=auth_headers(access_token),
        )
    if not response.is_success:
        _raise_runtime_operation_error("Remote command-run read", response)
    payload = response.json()
    run_id = payload.get("id")
    status = payload.get("status")
    if not isinstance(run_id, str) or not isinstance(status, str):
        raise CloudRuntimeOperationError("Remote command-run detail was malformed.")
    exit_code = payload.get("exitCode")
    return RemoteTerminalCommandRun(
        id=run_id,
        status=status,
        exit_code=exit_code if isinstance(exit_code, int) else None,
        stdout=payload.get("stdout") if isinstance(payload.get("stdout"), str) else None,
        stderr=payload.get("stderr") if isinstance(payload.get("stderr"), str) else None,
        combined_output=(
            payload.get("combinedOutput")
            if isinstance(payload.get("combinedOutput"), str)
            else None
        ),
        output_truncated=bool(payload.get("outputTruncated")),
    )
