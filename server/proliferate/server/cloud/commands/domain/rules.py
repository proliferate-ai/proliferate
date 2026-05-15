"""Pure validation and serialization helpers for cloud commands."""

from __future__ import annotations

import json

from proliferate.constants.cloud import (
    ACTIVE_CLOUD_COMMAND_KINDS,
    CLOUD_COMMAND_MAX_PAYLOAD_BYTES,
    SUPPORTED_CLOUD_COMMAND_SOURCES,
    CloudCommandKind,
    CloudCommandSource,
)
from proliferate.server.cloud.errors import CloudApiError

_MATERIALIZE_EXISTING_PATH_FIELDS = {
    "mode",
    "path",
    "displayName",
    "origin",
    "creatorContext",
}
_MATERIALIZE_WORKTREE_FIELDS = {
    "mode",
    "repoRootId",
    "targetPath",
    "newBranchName",
    "baseBranch",
    "setupScript",
    "origin",
    "creatorContext",
}
_MAX_MATERIALIZE_WORKSPACE_DISPLAY_NAME_CHARS = 160


def validate_active_command_kind(kind: str) -> str:
    if kind not in ACTIVE_CLOUD_COMMAND_KINDS:
        raise CloudApiError(
            "cloud_command_kind_unsupported",
            f"Cloud command kind is not supported yet: {kind}",
            status_code=400,
        )
    return kind


def validate_command_source(source: str | None) -> str:
    if source is None:
        return CloudCommandSource.api.value
    if source not in SUPPORTED_CLOUD_COMMAND_SOURCES:
        raise CloudApiError(
            "cloud_command_source_invalid",
            f"Cloud command source is not supported: {source}",
            status_code=400,
        )
    return source


def validate_command_shape(
    *,
    kind: str,
    workspace_id: str | None,
    session_id: str | None,
    preconditions: dict[str, object] | None,
) -> None:
    if (
        kind
        in {
            CloudCommandKind.start_session.value,
            CloudCommandKind.sync_existing_workspace.value,
        }
        and not workspace_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_required",
            f"Cloud command kind requires workspaceId: {kind}",
            status_code=400,
        )
    if kind == CloudCommandKind.materialize_environment.value and (workspace_id or session_id):
        raise CloudApiError(
            "cloud_command_target_only",
            "materialize_environment commands must be scoped only to a target.",
            status_code=400,
        )
    if kind == CloudCommandKind.materialize_workspace.value and (workspace_id or session_id):
        raise CloudApiError(
            "cloud_command_target_only",
            "materialize_workspace commands must be scoped only to a target.",
            status_code=400,
        )
    if (
        kind
        in {
            CloudCommandKind.send_prompt.value,
            CloudCommandKind.resolve_interaction.value,
            CloudCommandKind.update_session_config.value,
            CloudCommandKind.cancel_turn.value,
            CloudCommandKind.close_session.value,
        }
        and not session_id
    ):
        raise CloudApiError(
            "cloud_command_session_required",
            f"Cloud command kind requires sessionId: {kind}",
            status_code=400,
        )
    if preconditions:
        raise CloudApiError(
            "cloud_command_preconditions_unsupported",
            "Cloud command preconditions are not supported in phase 3.",
            status_code=400,
        )


def validate_command_payload(*, kind: str, payload: dict[str, object]) -> None:
    if kind != CloudCommandKind.materialize_workspace.value:
        return
    mode = _required_string(
        payload,
        "mode",
        code="cloud_command_materialize_workspace_mode_required",
        message="materialize_workspace payload must contain mode.",
    )
    if mode == "existing_path":
        _reject_unknown_fields(payload, _MATERIALIZE_EXISTING_PATH_FIELDS)
        _required_string(
            payload,
            "path",
            code="cloud_command_materialize_workspace_path_required",
            message="existing_path workspace materialization requires path.",
        )
        _optional_string(payload, "displayName")
        _optional_object(payload, "origin")
        _optional_object(payload, "creatorContext")
        return
    if mode == "worktree":
        _reject_unknown_fields(payload, _MATERIALIZE_WORKTREE_FIELDS)
        _required_string(
            payload,
            "repoRootId",
            code="cloud_command_materialize_workspace_repo_root_required",
            message="worktree workspace materialization requires repoRootId.",
        )
        _required_string(
            payload,
            "targetPath",
            code="cloud_command_materialize_workspace_target_path_required",
            message="worktree workspace materialization requires targetPath.",
        )
        _required_string(
            payload,
            "newBranchName",
            code="cloud_command_materialize_workspace_branch_required",
            message="worktree workspace materialization requires newBranchName.",
        )
        _optional_string(payload, "baseBranch")
        _optional_string(payload, "setupScript")
        _optional_object(payload, "origin")
        _optional_object(payload, "creatorContext")
        return
    raise CloudApiError(
        "cloud_command_materialize_workspace_mode_invalid",
        "materialize_workspace mode must be existing_path or worktree.",
        status_code=400,
    )


def _required_string(
    payload: dict[str, object],
    field: str,
    *,
    code: str,
    message: str,
) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise CloudApiError(code, message, status_code=400)
    return value.strip()


def _reject_unknown_fields(payload: dict[str, object], allowed_fields: set[str]) -> None:
    unknown_fields = sorted(set(payload) - allowed_fields)
    if unknown_fields:
        raise CloudApiError(
            "cloud_command_materialize_workspace_payload_unknown",
            "materialize_workspace payload contains unsupported field(s): "
            + ", ".join(unknown_fields),
            status_code=400,
        )


def _optional_string(payload: dict[str, object], field: str) -> None:
    if field not in payload or payload[field] is None:
        return
    if not isinstance(payload[field], str):
        raise CloudApiError(
            "cloud_command_materialize_workspace_payload_invalid",
            f"materialize_workspace payload field must be a string: {field}",
            status_code=400,
        )
    if (
        field == "displayName"
        and len(payload[field].strip()) > _MAX_MATERIALIZE_WORKSPACE_DISPLAY_NAME_CHARS
    ):
        raise CloudApiError(
            "cloud_command_materialize_workspace_payload_invalid",
            "materialize_workspace displayName cannot exceed "
            f"{_MAX_MATERIALIZE_WORKSPACE_DISPLAY_NAME_CHARS} characters.",
            status_code=400,
        )


def _optional_object(payload: dict[str, object], field: str) -> None:
    if field not in payload or payload[field] is None:
        return
    if not isinstance(payload[field], dict):
        raise CloudApiError(
            "cloud_command_materialize_workspace_payload_invalid",
            f"materialize_workspace payload field must be an object: {field}",
            status_code=400,
        )


def compact_command_json(value: dict[str, object] | None) -> str | None:
    if value is None:
        return None
    serialized = json.dumps(value, separators=(",", ":"), sort_keys=True)
    if len(serialized.encode("utf-8")) > CLOUD_COMMAND_MAX_PAYLOAD_BYTES:
        raise CloudApiError(
            "cloud_command_payload_too_large",
            "Cloud command JSON payload must be "
            f"{CLOUD_COMMAND_MAX_PAYLOAD_BYTES} bytes or fewer.",
            status_code=413,
        )
    return serialized
