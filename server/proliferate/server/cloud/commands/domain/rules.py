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
_CONFIGURE_GIT_IDENTITY_FIELDS = {"targetGitIdentityId", "configVersion"}
_ENSURE_REPO_CHECKOUT_FIELDS = {"provider", "owner", "name", "path", "baseBranch"}
_REFRESH_AGENT_AUTH_CONFIG_FIELDS = {
    "sandboxProfileId",
    "revision",
    "reason",
    "forceRestart",
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
    if kind in {
        CloudCommandKind.configure_git_identity.value,
        CloudCommandKind.ensure_repo_checkout.value,
        CloudCommandKind.materialize_environment.value,
        CloudCommandKind.refresh_agent_auth_config.value,
    } and (workspace_id or session_id):
        raise CloudApiError(
            "cloud_command_target_only",
            f"{kind} commands must be scoped only to a target.",
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
    if kind == CloudCommandKind.configure_git_identity.value:
        _validate_configure_git_identity_payload(payload)
        return
    if kind == CloudCommandKind.ensure_repo_checkout.value:
        _validate_ensure_repo_checkout_payload(payload)
        return
    if kind == CloudCommandKind.refresh_agent_auth_config.value:
        _validate_refresh_agent_auth_config_payload(payload)
        return
    if kind in {CloudCommandKind.start_session.value, CloudCommandKind.send_prompt.value}:
        _validate_optional_agent_auth_preflight_payload(kind=kind, payload=payload)
        return
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


def _validate_configure_git_identity_payload(payload: dict[str, object]) -> None:
    _reject_unknown_fields(
        payload,
        _CONFIGURE_GIT_IDENTITY_FIELDS,
        code="cloud_command_configure_git_identity_payload_unknown",
        message_prefix="configure_git_identity payload contains unsupported field(s): ",
    )
    _required_string(
        payload,
        "targetGitIdentityId",
        code="cloud_command_configure_git_identity_id_required",
        message="configure_git_identity payload must contain targetGitIdentityId.",
    )
    _required_int(
        payload,
        "configVersion",
        code="cloud_command_configure_git_identity_version_required",
        message="configure_git_identity payload must contain configVersion.",
    )


def _validate_ensure_repo_checkout_payload(payload: dict[str, object]) -> None:
    _reject_unknown_fields(
        payload,
        _ENSURE_REPO_CHECKOUT_FIELDS,
        code="cloud_command_ensure_repo_checkout_payload_unknown",
        message_prefix="ensure_repo_checkout payload contains unsupported field(s): ",
    )
    provider = _required_string(
        payload,
        "provider",
        code="cloud_command_ensure_repo_checkout_provider_required",
        message="ensure_repo_checkout payload must contain provider.",
    )
    if provider != "github":
        raise CloudApiError(
            "cloud_command_ensure_repo_checkout_provider_unsupported",
            "ensure_repo_checkout only supports github.",
            status_code=400,
        )
    for field in ("owner", "name", "path"):
        _required_string(
            payload,
            field,
            code=f"cloud_command_ensure_repo_checkout_{field}_required",
            message=f"ensure_repo_checkout payload must contain {field}.",
        )
    _optional_string(payload, "baseBranch")


def _validate_refresh_agent_auth_config_payload(payload: dict[str, object]) -> None:
    _reject_unknown_fields(
        payload,
        _REFRESH_AGENT_AUTH_CONFIG_FIELDS,
        code="cloud_command_refresh_agent_auth_payload_unknown",
        message_prefix="refresh_agent_auth_config payload contains unsupported field(s): ",
    )
    _required_string(
        payload,
        "sandboxProfileId",
        code="cloud_command_refresh_agent_auth_profile_required",
        message="refresh_agent_auth_config payload must contain sandboxProfileId.",
    )
    revision = _required_int(
        payload,
        "revision",
        code="cloud_command_refresh_agent_auth_revision_required",
        message="refresh_agent_auth_config payload must contain revision.",
    )
    if revision < 0:
        raise CloudApiError(
            "cloud_command_refresh_agent_auth_revision_invalid",
            "refresh_agent_auth_config revision must be non-negative.",
            status_code=400,
        )
    _required_string(
        payload,
        "reason",
        code="cloud_command_refresh_agent_auth_reason_required",
        message="refresh_agent_auth_config payload must contain reason.",
    )
    value = payload.get("forceRestart")
    if not isinstance(value, bool):
        raise CloudApiError(
            "cloud_command_refresh_agent_auth_force_restart_required",
            "refresh_agent_auth_config payload must contain boolean forceRestart.",
            status_code=400,
        )


def _validate_optional_agent_auth_preflight_payload(
    *,
    kind: str,
    payload: dict[str, object],
) -> None:
    has_profile = "sandboxProfileId" in payload
    has_revision = "requiredAgentAuthRevision" in payload
    if not has_profile and not has_revision:
        return
    _required_string(
        payload,
        "sandboxProfileId",
        code="cloud_command_agent_auth_profile_required",
        message=f"{kind} payload must contain sandboxProfileId with auth preflight.",
    )
    revision = _required_int(
        payload,
        "requiredAgentAuthRevision",
        code="cloud_command_agent_auth_revision_required",
        message=f"{kind} payload must contain requiredAgentAuthRevision with auth preflight.",
    )
    if revision < 0:
        raise CloudApiError(
            "cloud_command_agent_auth_revision_invalid",
            f"{kind} requiredAgentAuthRevision must be non-negative.",
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


def _reject_unknown_fields(
    payload: dict[str, object],
    allowed_fields: set[str],
    *,
    code: str = "cloud_command_materialize_workspace_payload_unknown",
    message_prefix: str = "materialize_workspace payload contains unsupported field(s): ",
) -> None:
    unknown_fields = sorted(set(payload) - allowed_fields)
    if unknown_fields:
        raise CloudApiError(
            code,
            message_prefix + ", ".join(unknown_fields),
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


def _required_int(
    payload: dict[str, object],
    field: str,
    *,
    code: str,
    message: str,
) -> int:
    value = payload.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise CloudApiError(code, message, status_code=400)
    return value


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
