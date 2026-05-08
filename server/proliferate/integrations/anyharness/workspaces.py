"""AnyHarness runtime workspace operations."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import (
    RemoteWorkspaceSummary,
    ResolvedRemoteWorkspace,
)


def _parse_resolved_workspace(
    payload: object,
    *,
    invalid_message: str,
    workspace_id_message: str,
    repo_root_message: str,
) -> ResolvedRemoteWorkspace:
    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(invalid_message)

    workspace = payload.get("workspace")
    if not isinstance(workspace, dict):
        raise CloudRuntimeReconnectError(invalid_message)

    remote_workspace_id = workspace.get("id")
    if not isinstance(remote_workspace_id, str) or not remote_workspace_id:
        raise CloudRuntimeReconnectError(workspace_id_message)

    remote_repo_root_id = workspace.get("repoRootId")
    if not isinstance(remote_repo_root_id, str) or not remote_repo_root_id:
        repo_root = payload.get("repoRoot")
        if isinstance(repo_root, dict):
            remote_repo_root_id = repo_root.get("id")
    if not isinstance(remote_repo_root_id, str) or not remote_repo_root_id:
        raise CloudRuntimeReconnectError(repo_root_message)

    return ResolvedRemoteWorkspace(
        workspace_id=remote_workspace_id,
        repo_root_id=remote_repo_root_id,
    )


async def resolve_runtime_workspace(
    runtime_url: str,
    access_token: str,
    *,
    runtime_workdir: str,
) -> ResolvedRemoteWorkspace:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/workspaces/resolve",
                headers=auth_headers(access_token),
                json={
                    "path": runtime_workdir,
                    "origin": {"kind": "human", "entrypoint": "cloud"},
                },
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON when resolving the AnyHarness workspace."
                ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to resolve AnyHarness workspace.") from exc

    return _parse_resolved_workspace(
        payload,
        invalid_message="Cloud runtime did not return a valid AnyHarness workspace id.",
        workspace_id_message="Cloud runtime did not return a valid AnyHarness workspace id.",
        repo_root_message="Cloud runtime did not return a valid AnyHarness repo root id.",
    )


async def prepare_runtime_mobility_destination(
    runtime_url: str,
    access_token: str,
    *,
    repo_root_id: str,
    requested_branch: str,
    requested_base_sha: str,
    destination_id: str,
    preferred_workspace_name: str | None = None,
) -> ResolvedRemoteWorkspace:
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{runtime_url}/v1/repo-roots/{repo_root_id}/mobility/prepare-destination",
                headers=auth_headers(access_token),
                json={
                    "requestedBranch": requested_branch,
                    "requestedBaseSha": requested_base_sha,
                    "destinationId": destination_id,
                    "preferredWorkspaceName": preferred_workspace_name,
                },
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON when preparing a worktree destination."
                ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to prepare worktree destination.") from exc

    return _parse_resolved_workspace(
        payload,
        invalid_message="Cloud runtime did not return a valid prepared workspace.",
        workspace_id_message="Cloud runtime did not return a valid prepared workspace id.",
        repo_root_message="Cloud runtime did not return a valid prepared repo root id.",
    )


async def list_runtime_workspaces(
    runtime_url: str,
    access_token: str,
) -> list[RemoteWorkspaceSummary]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{runtime_url}/v1/workspaces",
                headers=auth_headers(access_token),
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to load cloud runtime workspace list.") from exc
    if not isinstance(payload, list):
        raise CloudRuntimeReconnectError("Cloud runtime did not return a valid workspace list.")

    summaries: list[RemoteWorkspaceSummary] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        summary = item.get("executionSummary")
        live_count = summary.get("liveSessionCount") if isinstance(summary, dict) else None
        workspace_id = item.get("id")
        summaries.append(
            RemoteWorkspaceSummary(
                workspace_id=workspace_id if isinstance(workspace_id, str) else None,
                live_session_count=live_count if isinstance(live_count, int) else 0,
            )
        )
    return summaries
