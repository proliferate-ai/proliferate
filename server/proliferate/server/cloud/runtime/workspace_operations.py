"""Remote AnyHarness workspace file/setup operations."""

from __future__ import annotations

import time
from dataclasses import dataclass
from uuid import UUID

import httpx

from proliferate.server.cloud._logging import log_cloud_event
from proliferate.utils.time import duration_ms


class CloudRuntimeOperationError(RuntimeError):
    """Raised when a runtime-backed file or setup operation fails."""


@dataclass(frozen=True)
class RemoteWorkspaceFileState:
    exists: bool
    version_token: str


def _auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _response_preview(text: str, *, max_chars: int = 240) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[:max_chars]}..."


def _raise_runtime_operation_error(
    action: str,
    response: httpx.Response,
) -> None:
    raise CloudRuntimeOperationError(
        f"{action} failed with status {response.status_code}: "
        f"{_response_preview(response.text) or 'no response body'}"
    )


async def read_remote_workspace_file_state(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    relative_path: str,
    workspace_id: UUID | None = None,
) -> RemoteWorkspaceFileState:
    read_started = time.perf_counter()
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/files/file",
            headers=_auth_headers(access_token),
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

    log_cloud_event(
        "cloud runtime file state loaded",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        remote_workspace_id=anyharness_workspace_id,
        relative_path=relative_path,
        elapsed_ms=duration_ms(read_started),
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
    workspace_id: UUID | None = None,
) -> None:
    write_started = time.perf_counter()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.put(
            f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/files/file",
            headers=_auth_headers(access_token),
            json={
                "path": relative_path,
                "content": content,
                "expectedVersionToken": expected_version_token,
            },
        )
    if not response.is_success:
        _raise_runtime_operation_error("Remote file write", response)

    log_cloud_event(
        "cloud runtime file written",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        remote_workspace_id=anyharness_workspace_id,
        relative_path=relative_path,
        elapsed_ms=duration_ms(write_started),
    )


async def start_remote_workspace_setup(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    command: str,
    base_ref: str | None,
    workspace_id: UUID | None = None,
) -> None:
    start_started = time.perf_counter()
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/setup-start",
            headers=_auth_headers(access_token),
            json={"command": command, "baseRef": base_ref},
        )
    if not response.is_success:
        _raise_runtime_operation_error("Remote setup start", response)

    log_cloud_event(
        "cloud runtime setup started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        remote_workspace_id=anyharness_workspace_id,
        elapsed_ms=duration_ms(start_started),
    )
