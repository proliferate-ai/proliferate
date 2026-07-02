"""Pure validation helpers for cloud commands."""

from __future__ import annotations

from proliferate.constants.cloud import (
    ACTIVE_CLOUD_COMMAND_KINDS,
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
    if (
        kind
        in {
            CloudCommandKind.start_session.value,
            CloudCommandKind.backfill_exposed_workspace.value,
            CloudCommandKind.prune_workspace_worktree.value,
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
        CloudCommandKind.reconcile_agents.value,
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
            CloudCommandKind.decide_plan.value,
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
