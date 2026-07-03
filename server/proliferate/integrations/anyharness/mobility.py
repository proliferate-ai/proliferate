"""AnyHarness runtime mobility operations (export/install/freeze/preflight).

Backs the ``workspace_move`` server domain (specs/tbd/workspace-migration-v2.md
section 5.2). Each call takes its own ``(runtime_url, access_token)`` pair --
same per-call pattern as the rest of this integration
(``proliferate.integrations.anyharness.client.auth_headers``) -- because a move
saga can touch two different sandboxes' runtimes across the same request.
"""

from __future__ import annotations

import httpx

from proliferate.integrations.anyharness.client import auth_headers
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.models import (
    RuntimeMobilityInstallResult,
    RuntimeMobilityPreflight,
    RuntimeMobilityState,
)
from proliferate.integrations.anyharness.workspaces import _runtime_status_error_message

_MOBILITY_PREFLIGHT_TIMEOUT_SECONDS = 30.0
_MOBILITY_RUNTIME_STATE_TIMEOUT_SECONDS = 30.0
_MOBILITY_EXPORT_TIMEOUT_SECONDS = 180.0
_MOBILITY_INSTALL_TIMEOUT_SECONDS = 180.0


async def preflight_runtime_mobility(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
) -> RuntimeMobilityPreflight:
    """Ask the runtime whether ``anyharness_workspace_id`` is safe to move right now."""
    try:
        async with httpx.AsyncClient(timeout=_MOBILITY_PREFLIGHT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/mobility/preflight",
                headers=auth_headers(access_token),
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON for mobility preflight."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(exc.response, "Failed to preflight workspace mobility.")
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to preflight workspace mobility.") from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned an invalid mobility preflight response."
        )
    blockers = payload.get("blockers")
    blocker_codes = (
        tuple(
            item["code"]
            for item in blockers
            if isinstance(blockers, list)
            and isinstance(item, dict)
            and isinstance(item.get("code"), str)
        )
        if isinstance(blockers, list)
        else ()
    )
    base_commit_sha = payload.get("baseCommitSha")
    branch_name = payload.get("branchName")
    return RuntimeMobilityPreflight(
        workspace_id=str(payload.get("workspaceId") or anyharness_workspace_id),
        can_move=bool(payload.get("canMove", False)),
        base_commit_sha=base_commit_sha if isinstance(base_commit_sha, str) else None,
        branch_name=branch_name if isinstance(branch_name, str) else None,
        blocker_codes=blocker_codes,
    )


async def set_runtime_mobility_state(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    mode: str,
    handoff_op_id: str | None = None,
) -> RuntimeMobilityState:
    """Flip a workspace's mobility runtime mode (e.g. ``frozen_for_handoff``)."""
    body: dict[str, object] = {"mode": mode}
    if handoff_op_id is not None:
        body["handoffOpId"] = handoff_op_id
    try:
        async with httpx.AsyncClient(timeout=_MOBILITY_RUNTIME_STATE_TIMEOUT_SECONDS) as client:
            response = await client.put(
                f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/mobility/runtime-state",
                headers=auth_headers(access_token),
                json=body,
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON for mobility runtime-state."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to set workspace mobility runtime state.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError(
            "Failed to set workspace mobility runtime state."
        ) from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned an invalid mobility runtime-state response."
        )
    handoff_op_id_out = payload.get("handoffOpId")
    return RuntimeMobilityState(
        workspace_id=str(payload.get("workspaceId") or anyharness_workspace_id),
        mode=str(payload.get("mode") or mode),
        handoff_op_id=handoff_op_id_out if isinstance(handoff_op_id_out, str) else None,
    )


async def export_runtime_mobility_archive(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    expected_handoff_op_id: str,
    expected_base_commit_sha: str,
    expected_branch_name: str,
    exclude_paths: list[str] | None = None,
) -> dict[str, object]:
    """Export a mobility archive from a *frozen* source workspace.

    The engine hard-refuses this unless ``requireCleanGitState`` plus all three
    ``expected*`` fields match the workspace's live git state
    (``validate_expected_export_git_state``, spec section 0) -- that guard chain is
    always requested here, matching the locked "git is the transfer plane for code"
    principle (spec section 2.1).

    The returned dict is the raw ``WorkspaceMobilityArchive`` payload; the server
    treats it as opaque and forwards it verbatim to ``install_runtime_mobility_archive``
    or straight to the Desktop caller -- it never inspects archive contents.
    """
    body: dict[str, object] = {
        "requireCleanGitState": True,
        "expectedHandoffOpId": expected_handoff_op_id,
        "expectedBaseCommitSha": expected_base_commit_sha,
        "expectedBranchName": expected_branch_name,
    }
    if exclude_paths:
        body["excludePaths"] = exclude_paths
    try:
        async with httpx.AsyncClient(timeout=_MOBILITY_EXPORT_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/mobility/export",
                headers=auth_headers(access_token),
                json=body,
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON for mobility export."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to export workspace mobility archive.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to export workspace mobility archive.") from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError("Cloud runtime returned an invalid mobility archive.")
    return payload


async def install_runtime_mobility_archive(
    runtime_url: str,
    access_token: str,
    *,
    anyharness_workspace_id: str,
    archive: dict[str, object],
    operation_id: str | None = None,
    install_mode: str = "preserve_native_sessions",
) -> RuntimeMobilityInstallResult:
    """Install a previously exported archive into a destination workspace.

    ``operation_id`` should be the ``workspace_move`` id: the engine's install
    idempotency (``find_completed_install``, spec section 5.2) is keyed on it, so a
    retried install call is safe to repeat.
    """
    body: dict[str, object] = {"archive": archive, "installMode": install_mode}
    if operation_id is not None:
        body["operationId"] = operation_id
    try:
        async with httpx.AsyncClient(timeout=_MOBILITY_INSTALL_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{runtime_url}/v1/workspaces/{anyharness_workspace_id}/mobility/install",
                headers=auth_headers(access_token),
                json=body,
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise CloudRuntimeReconnectError(
                    "Cloud runtime returned invalid JSON for mobility install."
                ) from exc
    except httpx.HTTPStatusError as exc:
        raise CloudRuntimeReconnectError(
            _runtime_status_error_message(
                exc.response,
                "Failed to install workspace mobility archive.",
            )
        ) from exc
    except httpx.HTTPError as exc:
        raise CloudRuntimeReconnectError("Failed to install workspace mobility archive.") from exc

    if not isinstance(payload, dict):
        raise CloudRuntimeReconnectError(
            "Cloud runtime returned an invalid mobility install response."
        )
    return _parse_install_result(payload, anyharness_workspace_id)


def _parse_install_result(
    payload: dict[str, object],
    fallback_workspace_id: str,
) -> RuntimeMobilityInstallResult:
    base_commit_sha = payload.get("baseCommitSha")
    if not isinstance(base_commit_sha, str) or not base_commit_sha:
        raise CloudRuntimeReconnectError(
            "Cloud runtime did not return a base commit sha for the installed workspace."
        )
    source_workspace_path = payload.get("sourceWorkspacePath")
    imported_session_ids = payload.get("importedSessionIds")
    return RuntimeMobilityInstallResult(
        workspace_id=str(payload.get("workspaceId") or fallback_workspace_id),
        source_workspace_path=(
            source_workspace_path if isinstance(source_workspace_path, str) else ""
        ),
        base_commit_sha=base_commit_sha,
        imported_session_ids=tuple(item for item in imported_session_ids if isinstance(item, str))
        if isinstance(imported_session_ids, list)
        else (),
        applied_file_count=_as_int(payload.get("appliedFileCount")),
        deleted_file_count=_as_int(payload.get("deletedFileCount")),
        imported_agent_artifact_count=_as_int(payload.get("importedAgentArtifactCount")),
    )


def _as_int(value: object) -> int:
    return value if isinstance(value, int) else 0
