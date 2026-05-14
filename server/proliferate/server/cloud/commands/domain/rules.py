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
    if kind in {
        CloudCommandKind.start_session.value,
        CloudCommandKind.sync_existing_workspace.value,
    } and not workspace_id:
        raise CloudApiError(
            "cloud_command_workspace_required",
            f"Cloud command kind requires workspaceId: {kind}",
            status_code=400,
        )
    if kind in {
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.resolve_interaction.value,
        CloudCommandKind.update_session_config.value,
        CloudCommandKind.cancel_turn.value,
        CloudCommandKind.close_session.value,
    } and not session_id:
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
