"""Pure cloud workspace lifecycle decisions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from proliferate.constants.cloud import CloudWorkspaceStatus

PROVISIONING_STATUSES: frozenset[str] = frozenset(
    {
        CloudWorkspaceStatus.pending.value,
        CloudWorkspaceStatus.materializing.value,
    }
)

VALID_STATUS_TRANSITIONS: dict[CloudWorkspaceStatus, frozenset[CloudWorkspaceStatus]] = {
    CloudWorkspaceStatus.pending: frozenset(
        {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.archived,
            CloudWorkspaceStatus.error,
        }
    ),
    CloudWorkspaceStatus.materializing: frozenset(
        {
            CloudWorkspaceStatus.ready,
            CloudWorkspaceStatus.archived,
            CloudWorkspaceStatus.error,
        }
    ),
    CloudWorkspaceStatus.ready: frozenset(
        {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.archived,
            CloudWorkspaceStatus.error,
        }
    ),
    CloudWorkspaceStatus.archived: frozenset(
        {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.error,
        }
    ),
    CloudWorkspaceStatus.error: frozenset(
        {
            CloudWorkspaceStatus.materializing,
            CloudWorkspaceStatus.archived,
        }
    ),
}


@dataclass(frozen=True)
class WorkspaceStatusTransitionDecision:
    allowed: bool
    current_status: CloudWorkspaceStatus
    target_status: CloudWorkspaceStatus
    status_detail: str
    error_code: str | None = None
    error_message: str | None = None
    status_code: int | None = None


@dataclass(frozen=True)
class WorkspaceStartDecision:
    action: Literal["return_current", "queue_pending", "return_ready", "restart_materializing"]
    refresh_repo_env_snapshot: bool
    clear_last_error: bool
    persist_before_schedule: bool
    schedule_provision: bool
    target_status: CloudWorkspaceStatus | None = None
    status_detail: str | None = None


@dataclass(frozen=True)
class ProviderFailureDebugStateDecision:
    sandbox_status: str
    preserve_workspace_runtime_metadata: bool
    clear_workspace_runtime_metadata: bool
    clear_active_sandbox: bool


def normalize_workspace_status(status: CloudWorkspaceStatus | str) -> CloudWorkspaceStatus:
    if isinstance(status, CloudWorkspaceStatus):
        return status
    try:
        return CloudWorkspaceStatus(str(status))
    except ValueError:
        return CloudWorkspaceStatus.error


def workspace_status_detail(status: CloudWorkspaceStatus) -> str:
    return status.value.replace("_", " ").title()


def decide_workspace_status_transition(
    current_status: CloudWorkspaceStatus | str,
    target_status: CloudWorkspaceStatus,
    *,
    status_detail: str | None = None,
) -> WorkspaceStatusTransitionDecision:
    normalized_current = normalize_workspace_status(current_status)
    resolved_detail = status_detail or workspace_status_detail(target_status)
    allowed_targets = VALID_STATUS_TRANSITIONS.get(normalized_current, frozenset())
    if target_status in allowed_targets:
        return WorkspaceStatusTransitionDecision(
            allowed=True,
            current_status=normalized_current,
            target_status=target_status,
            status_detail=resolved_detail,
        )
    return WorkspaceStatusTransitionDecision(
        allowed=False,
        current_status=normalized_current,
        target_status=target_status,
        status_detail=resolved_detail,
        error_code="invalid_status_transition",
        error_message=(
            f"Cannot transition workspace from '{current_status}' to '{target_status.value}'."
        ),
        status_code=409,
    )


def start_request_should_return_existing(status: CloudWorkspaceStatus | str) -> bool:
    return normalize_workspace_status(status) == CloudWorkspaceStatus.materializing


def decide_workspace_start_after_validation(
    status: CloudWorkspaceStatus | str,
    *,
    ready_at_exists: bool,
) -> WorkspaceStartDecision:
    refresh_repo_env_snapshot = not ready_at_exists
    normalized_status = normalize_workspace_status(status)
    if normalized_status == CloudWorkspaceStatus.pending:
        return WorkspaceStartDecision(
            action="queue_pending",
            refresh_repo_env_snapshot=refresh_repo_env_snapshot,
            clear_last_error=True,
            persist_before_schedule=True,
            schedule_provision=True,
        )
    if normalized_status == CloudWorkspaceStatus.ready:
        return WorkspaceStartDecision(
            action="return_ready",
            refresh_repo_env_snapshot=refresh_repo_env_snapshot,
            clear_last_error=False,
            persist_before_schedule=False,
            schedule_provision=False,
        )
    if normalized_status == CloudWorkspaceStatus.materializing:
        return WorkspaceStartDecision(
            action="return_current",
            refresh_repo_env_snapshot=False,
            clear_last_error=False,
            persist_before_schedule=False,
            schedule_provision=False,
        )
    return WorkspaceStartDecision(
        action="restart_materializing",
        refresh_repo_env_snapshot=refresh_repo_env_snapshot,
        clear_last_error=True,
        persist_before_schedule=True,
        schedule_provision=True,
        target_status=CloudWorkspaceStatus.materializing,
        status_detail="Preparing runtime",
    )


def provider_failure_debug_state(
    operation: Literal["stop", "destroy"],
) -> ProviderFailureDebugStateDecision:
    if operation == "stop":
        return ProviderFailureDebugStateDecision(
            sandbox_status="error",
            preserve_workspace_runtime_metadata=True,
            clear_workspace_runtime_metadata=False,
            clear_active_sandbox=False,
        )
    return ProviderFailureDebugStateDecision(
        sandbox_status="error",
        preserve_workspace_runtime_metadata=False,
        clear_workspace_runtime_metadata=True,
        clear_active_sandbox=True,
    )
