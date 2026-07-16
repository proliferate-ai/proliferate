"""AnyHarness runtime workspace operations."""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import (
    MaterializedRemoteWorkspaceAtRef,
    RemoteGitStatusSnapshot,
    RemoteWorkspaceSummary,
    ResolvedRemoteWorkspace,
)

_CREATE_WORKTREE_TIMEOUT_SECONDS = 180.0
_GIT_STATUS_TIMEOUT_SECONDS = 15.0
_MATERIALIZE_AT_REF_TIMEOUT_SECONDS = 600.0


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


async def materialize_workspace_at_ref(
    runtime_url: str,
    access_token: str,
    *,
    repo_root_id: str,
    operation_id: str,
    branch_name: str,
    head_sha: str,
    preferred_workspace_name: str | None = None,
    destination_id: str | None = None,
) -> MaterializedRemoteWorkspaceAtRef:
    """Create or reuse a workspace at an exact branch + commit (PR 3 endpoint).

    The runtime ledger keys idempotency off ``operation_id``: retrying with the
    same id reuses the earlier result rather than creating a second worktree.
    """
    body: dict[str, object] = {
        "operationId": operation_id,
        "branchName": branch_name,
        "headSha": head_sha,
    }
    if preferred_workspace_name:
        body["preferredWorkspaceName"] = preferred_workspace_name
    if destination_id:
        body["destinationId"] = destination_id

    try:
        async with httpx.AsyncClient(timeout=_MATERIALIZE_AT_REF_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{runtime_url}/v1/repo-roots/{repo_root_id}/workspace-materializations",
                headers=auth_headers(access_token),
                json=body,
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON when materializing a workspace at ref."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to materialize AnyHarness workspace at ref.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to materialize AnyHarness workspace at ref."
        ) from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid workspace materialization."
        )
    workspace = payload.get("workspace")
    workspace_id = workspace.get("id") if isinstance(workspace, dict) else None
    observed_head_sha = payload.get("observedHeadSha")
    outcome = payload.get("outcome")
    if not isinstance(workspace_id, str) or not workspace_id:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid materialized workspace id."
        )
    if not isinstance(observed_head_sha, str) or not observed_head_sha:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a valid observed HEAD for the materialization."
        )
    return MaterializedRemoteWorkspaceAtRef(
        workspace_id=workspace_id,
        observed_head_sha=observed_head_sha,
        outcome=outcome if isinstance(outcome, str) else "created",
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


def _require_str(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise CloudRuntimeReconnectError(f"Cloud runtime git status is missing a valid '{key}'.")
    return value


def _require_bool(payload: dict[str, object], key: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise CloudRuntimeReconnectError(f"Cloud runtime git status is missing a valid '{key}'.")
    return value


def _require_int(payload: dict[str, object], key: str) -> int:
    value = payload.get(key)
    # bool is a subclass of int; reject it explicitly.
    if not isinstance(value, int) or isinstance(value, bool):
        raise CloudRuntimeReconnectError(f"Cloud runtime git status is missing a valid '{key}'.")
    return value


def _optional_str(payload: dict[str, object], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise CloudRuntimeReconnectError(f"Cloud runtime git status returned an invalid '{key}'.")
    return value


_GIT_STATUS_OPERATIONS = {"none", "merge", "rebase", "cherry_pick", "revert"}


def _parse_git_status_snapshot(payload: object) -> RemoteGitStatusSnapshot:
    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError("Cloud runtime returned an invalid git status snapshot.")
    operation = _require_str(payload, "operation")
    if operation not in _GIT_STATUS_OPERATIONS:
        raise CloudRuntimeReconnectError("Cloud runtime git status returned an unknown operation.")
    return RemoteGitStatusSnapshot(
        workspace_id=_require_str(payload, "workspaceId"),
        workspace_path=_require_str(payload, "workspacePath"),
        repo_root_path=_require_str(payload, "repoRootPath"),
        current_branch=_optional_str(payload, "currentBranch"),
        head_oid=_require_str(payload, "headOid"),
        detached=_require_bool(payload, "detached"),
        upstream_branch=_optional_str(payload, "upstreamBranch"),
        suggested_base_branch=_optional_str(payload, "suggestedBaseBranch"),
        ahead=_require_int(payload, "ahead"),
        behind=_require_int(payload, "behind"),
        operation=operation,
        conflicted=_require_bool(payload, "conflicted"),
        clean=_require_bool(payload, "clean"),
    )


async def get_runtime_git_status(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
) -> RemoteGitStatusSnapshot:
    """Read the AnyHarness workspace git status as a typed, fail-closed snapshot.

    Transport failures and missing/malformed required fields raise
    ``CloudRuntimeReconnectError`` — a status read is never interpreted as clean.
    """
    try:
        async with httpx.AsyncClient(timeout=_GIT_STATUS_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/git/status",
                headers=auth_headers(access_token),
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON for git status."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to read cloud workspace git status.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to read cloud workspace git status.") from exc

    return _parse_git_status_snapshot(payload)
