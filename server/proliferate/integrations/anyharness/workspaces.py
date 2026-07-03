"""AnyHarness runtime workspace operations."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace

_MOBILITY_DESTINATION_PREPARE_TIMEOUT_SECONDS = 180.0
_MOBILITY_DESTROY_SOURCE_TIMEOUT_SECONDS = 60.0
_CREATE_WORKTREE_TIMEOUT_SECONDS = 180.0


def _runtime_status_error_message(
    response: httpx.Response,
    fallback: str,
) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None

    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        title = payload.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()

    text = response.text.strip()
    if text:
        return f"{fallback} Runtime returned {response.status_code}: {text[:500]}"
    return fallback


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
        async with httpx.AsyncClient(
            timeout=_MOBILITY_DESTINATION_PREPARE_TIMEOUT_SECONDS
        ) as client:
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
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to prepare worktree destination.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to prepare worktree destination.") from exc

    return _parse_resolved_workspace(
        payload,
        invalid_message="Cloud runtime did not return a valid prepared workspace.",
        workspace_id_message="Cloud runtime did not return a valid prepared workspace id.",
        repo_root_message="Cloud runtime did not return a valid prepared repo root id.",
    )


async def create_remote_worktree_workspace(
    runtime_url: str,
    access_token: str,
    *,
    repo_root_id: str,
    target_path: str,
    new_branch_name: str,
    base_branch: str | None,
    setup_script: str | None = None,
    origin: dict[str, object] | None = None,
    creator_context: dict[str, object] | None = None,
) -> ResolvedRemoteWorkspace:
    body: dict[str, object] = {
        "repoRootId": repo_root_id,
        "targetPath": target_path,
        "newBranchName": new_branch_name,
        "checkoutMode": "new_branch",
        "nameConflictPolicy": "fail",
    }
    if base_branch:
        body["baseBranch"] = base_branch
    if setup_script:
        body["setupScript"] = setup_script
    if origin is not None:
        body["origin"] = origin
    if creator_context is not None:
        body["creatorContext"] = creator_context

    try:
        async with httpx.AsyncClient(timeout=_CREATE_WORKTREE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{runtime_url}/v1/workspaces/worktrees",
                headers=auth_headers(access_token),
                json=body,
            )
            if response.status_code == 409:
                try:
                    return await resolve_runtime_workspace(
                        runtime_url,
                        access_token,
                        runtime_workdir=target_path,
                    )
                except CloudRuntimeReconnectError as exc:
                    raise CloudRuntimeReconnectError(
                        _runtime_status_error_message(
                            response,
                            "Failed to create AnyHarness worktree workspace.",
                        )
                    ) from exc
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON when creating a worktree workspace."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to create AnyHarness worktree workspace.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to create AnyHarness worktree workspace."
        ) from exc

    return _parse_resolved_workspace(
        payload,
        invalid_message="Cloud runtime did not return a valid worktree workspace.",
        workspace_id_message="Cloud runtime did not return a valid worktree workspace id.",
        repo_root_message="Cloud runtime did not return a valid worktree repo root id.",
    )


async def destroy_runtime_mobility_source(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=_MOBILITY_DESTROY_SOURCE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/mobility/destroy-source",
                headers=auth_headers(access_token),
                json={},
            )
            if response.status_code == 404:
                return
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to destroy old AnyHarness mobility source.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to destroy old AnyHarness mobility source."
        ) from exc
