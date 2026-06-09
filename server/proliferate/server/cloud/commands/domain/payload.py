"""Pure payload validation helpers for cloud commands."""

from __future__ import annotations

from proliferate.constants.cloud import CloudCommandKind
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
    "checkoutMode",
    "setupScript",
    "nameConflictPolicy",
    "origin",
    "creatorContext",
}
_PRUNE_WORKSPACE_WORKTREE_FIELDS = {
    "workspaceId",
    "cloudWorkspaceId",
    "reason",
}
_RUNTIME_CONFIG_PREFLIGHT_FIELDS = {
    "sandboxProfileId",
    "requiredRuntimeConfigRevisionId",
    "requiredRuntimeConfigSequence",
    "requiredRuntimeConfigContentHash",
}
_DECIDE_PLAN_FIELDS = {
    "workspaceId",
    "planId",
    "decision",
    "expectedDecisionVersion",
    *_RUNTIME_CONFIG_PREFLIGHT_FIELDS,
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
    if kind in {
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.decide_plan.value,
    }:
        if kind == CloudCommandKind.decide_plan.value:
            _validate_decide_plan_payload(payload)
            _validate_optional_runtime_config_preflight_payload(kind=kind, payload=payload)
            return
        _validate_optional_agent_auth_preflight_payload(kind=kind, payload=payload)
        _validate_optional_runtime_config_preflight_payload(kind=kind, payload=payload)
        return
    if kind == CloudCommandKind.prune_workspace_worktree.value:
        _validate_prune_workspace_worktree_payload(payload)
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
        _optional_string_choice(
            payload,
            "checkoutMode",
            {"new_branch", "detached_ref"},
        )
        _optional_string(payload, "setupScript")
        _optional_string_choice(
            payload,
            "nameConflictPolicy",
            {"fail", "suffix_path"},
        )
        _optional_object(payload, "origin")
        _optional_object(payload, "creatorContext")
        return
    raise CloudApiError(
        "cloud_command_materialize_workspace_mode_invalid",
        "materialize_workspace mode must be existing_path or worktree.",
        status_code=400,
    )


def _validate_prune_workspace_worktree_payload(payload: dict[str, object]) -> None:
    _reject_unknown_fields(
        payload,
        _PRUNE_WORKSPACE_WORKTREE_FIELDS,
        code="cloud_command_prune_workspace_payload_unknown",
        message_prefix="prune_workspace_worktree payload contains unsupported field(s): ",
    )
    _optional_string(payload, "workspaceId")
    _optional_string(payload, "cloudWorkspaceId")
    _optional_string(payload, "reason")


def _validate_decide_plan_payload(payload: dict[str, object]) -> None:
    _reject_unknown_fields(
        payload,
        _DECIDE_PLAN_FIELDS,
        code="cloud_command_decide_plan_payload_unknown",
        message_prefix="decide_plan payload contains unsupported field(s): ",
    )
    _required_string(
        payload,
        "workspaceId",
        code="cloud_command_decide_plan_workspace_required",
        message="decide_plan payload must contain workspaceId.",
    )
    _required_string(
        payload,
        "planId",
        code="cloud_command_decide_plan_plan_required",
        message="decide_plan payload must contain planId.",
    )
    decision = _required_string(
        payload,
        "decision",
        code="cloud_command_decide_plan_decision_required",
        message="decide_plan payload must contain decision.",
    )
    if decision not in {"approve", "reject"}:
        raise CloudApiError(
            "cloud_command_decide_plan_decision_invalid",
            "decide_plan decision must be approve or reject.",
            status_code=400,
        )
    version = _required_int(
        payload,
        "expectedDecisionVersion",
        code="cloud_command_decide_plan_version_required",
        message="decide_plan payload must contain expectedDecisionVersion.",
    )
    if version < 0:
        raise CloudApiError(
            "cloud_command_decide_plan_version_invalid",
            "decide_plan expectedDecisionVersion must be non-negative.",
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
    has_scope = "agentAuthScope" in payload
    if not has_profile and not has_revision and not has_scope:
        return
    sandbox_profile_id = _agent_auth_sandbox_profile_id(payload)
    if not sandbox_profile_id:
        raise CloudApiError(
            "cloud_command_agent_auth_profile_required",
            f"{kind} payload must contain sandboxProfileId with auth preflight.",
            status_code=400,
        )
    if has_profile or has_revision:
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
    _validate_agent_auth_scope(payload, kind, sandbox_profile_id=sandbox_profile_id)


def _agent_auth_sandbox_profile_id(payload: dict[str, object]) -> str:
    sandbox_profile_id = str(payload.get("sandboxProfileId") or "")
    if sandbox_profile_id:
        return sandbox_profile_id
    expected_revision = payload.get("expectedRuntimeConfigRevision")
    if isinstance(expected_revision, dict):
        external_scope = expected_revision.get("externalScope")
        if isinstance(external_scope, dict):
            expected_provider = str(external_scope.get("provider") or "")
            if expected_provider == "proliferate-cloud":
                return str(external_scope.get("id") or "")
    return ""


def _validate_agent_auth_scope(
    payload: dict[str, object],
    kind: str,
    *,
    sandbox_profile_id: str,
) -> None:
    raw_scope = payload.get("agentAuthScope")
    if raw_scope is None:
        return
    if not isinstance(raw_scope, dict):
        raise CloudApiError(
            "cloud_command_agent_auth_scope_invalid",
            f"{kind} agentAuthScope must be an object.",
            status_code=400,
        )
    scope = {str(key): value for key, value in raw_scope.items()}
    _reject_unknown_fields(
        scope,
        {"provider", "id", "targetId"},
        code="cloud_command_agent_auth_scope_invalid",
        message_prefix=f"{kind} agentAuthScope contains unsupported field(s): ",
    )
    provider = _required_string(
        scope,
        "provider",
        code="cloud_command_agent_auth_scope_invalid",
        message=f"{kind} agentAuthScope must contain provider.",
    )
    scope_id = _required_string(
        scope,
        "id",
        code="cloud_command_agent_auth_scope_invalid",
        message=f"{kind} agentAuthScope must contain id.",
    )
    _required_string(
        scope,
        "targetId",
        code="cloud_command_agent_auth_scope_invalid",
        message=f"{kind} agentAuthScope must contain targetId.",
    )
    if provider != "proliferate-cloud" or scope_id != sandbox_profile_id:
        raise CloudApiError(
            "cloud_command_agent_auth_scope_invalid",
            f"{kind} agentAuthScope must match the cloud-owned auth preflight scope.",
            status_code=400,
        )


def _validate_optional_runtime_config_preflight_payload(
    *,
    kind: str,
    payload: dict[str, object],
) -> None:
    has_runtime_preflight = any(
        field in payload
        for field in (
            "requiredRuntimeConfigRevisionId",
            "requiredRuntimeConfigSequence",
            "requiredRuntimeConfigContentHash",
        )
    )
    if not has_runtime_preflight:
        return
    _required_string(
        payload,
        "sandboxProfileId",
        code="cloud_command_runtime_config_profile_required",
        message=f"{kind} payload must contain sandboxProfileId with runtime config preflight.",
    )
    _required_string(
        payload,
        "requiredRuntimeConfigRevisionId",
        code="cloud_command_runtime_config_revision_required",
        message=(
            f"{kind} payload must contain requiredRuntimeConfigRevisionId with runtime "
            "config preflight."
        ),
    )
    _required_string(
        payload,
        "requiredRuntimeConfigContentHash",
        code="cloud_command_runtime_config_hash_required",
        message=(
            f"{kind} payload must contain requiredRuntimeConfigContentHash with runtime "
            "config preflight."
        ),
    )
    sequence = _required_int(
        payload,
        "requiredRuntimeConfigSequence",
        code="cloud_command_runtime_config_sequence_required",
        message=(
            f"{kind} payload must contain requiredRuntimeConfigSequence with runtime "
            "config preflight."
        ),
    )
    if sequence < 0:
        raise CloudApiError(
            "cloud_command_runtime_config_sequence_invalid",
            f"{kind} requiredRuntimeConfigSequence must be non-negative.",
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


def _optional_string_choice(
    payload: dict[str, object],
    field: str,
    allowed_values: set[str],
) -> None:
    _optional_string(payload, field)
    value = payload.get(field)
    if value is None:
        return
    if isinstance(value, str) and value in allowed_values:
        return
    raise CloudApiError(
        "cloud_command_materialize_workspace_payload_invalid",
        f"materialize_workspace payload field is invalid: {field}",
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
