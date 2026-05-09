"""Pure setup-run lifecycle decisions for cloud workspaces."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.constants.cloud import (
    MAX_SETUP_MONITOR_ERROR_CHARS,
    SETUP_RUN_DEFAULT_FAILURE_ERROR,
    SETUP_RUN_MISSING_WORKSPACE_ERROR,
    SETUP_RUN_STATUS_STALE,
    SETUP_RUN_SUPERSEDED_ERROR,
    WorkspacePostReadyPhase,
)


@dataclass(frozen=True)
class SetupRunWorkspaceFinalization:
    phase: WorkspacePostReadyPhase
    status_detail: str
    repo_setup_applied_version: int | None = None
    repo_files_last_error: str | None = None


@dataclass(frozen=True)
class SetupRunFinalizationDecision:
    run_status: str
    run_last_error: str | None
    should_update_workspace: bool
    set_last_polled_at: bool
    clear_next_poll_at: bool
    workspace_update: SetupRunWorkspaceFinalization | None = None


def bounded_setup_monitor_error(value: str | None) -> str | None:
    if value is None:
        return None
    return value[:MAX_SETUP_MONITOR_ERROR_CHARS]


def setup_run_has_active_workspace_token(
    *,
    workspace_apply_token: str | None,
    workspace_phase: WorkspacePostReadyPhase | str | None,
    run_apply_token: str,
    command_run_id: str | None,
) -> bool:
    phase_value = (
        workspace_phase.value
        if isinstance(workspace_phase, WorkspacePostReadyPhase)
        else workspace_phase
    )
    return bool(
        workspace_apply_token == run_apply_token
        and command_run_id
        and phase_value == WorkspacePostReadyPhase.starting_setup.value
    )


def classify_setup_run_finalization(
    *,
    workspace_exists: bool,
    workspace_apply_token: str | None,
    workspace_phase: WorkspacePostReadyPhase | str | None,
    run_apply_token: str,
    command_run_id: str | None,
    final_status: str,
    success: bool,
    last_error: str | None,
    setup_script_version: int,
) -> SetupRunFinalizationDecision:
    if not workspace_exists:
        return SetupRunFinalizationDecision(
            run_status=SETUP_RUN_STATUS_STALE,
            run_last_error=SETUP_RUN_MISSING_WORKSPACE_ERROR,
            should_update_workspace=False,
            set_last_polled_at=False,
            clear_next_poll_at=False,
        )

    if not setup_run_has_active_workspace_token(
        workspace_apply_token=workspace_apply_token,
        workspace_phase=workspace_phase,
        run_apply_token=run_apply_token,
        command_run_id=command_run_id,
    ):
        return SetupRunFinalizationDecision(
            run_status=SETUP_RUN_STATUS_STALE,
            run_last_error=SETUP_RUN_SUPERSEDED_ERROR,
            should_update_workspace=False,
            set_last_polled_at=False,
            clear_next_poll_at=False,
        )

    bounded_last_error = bounded_setup_monitor_error(last_error)
    if success:
        workspace_update = SetupRunWorkspaceFinalization(
            phase=WorkspacePostReadyPhase.completed,
            repo_setup_applied_version=setup_script_version,
            repo_files_last_error=None,
            status_detail="Ready",
        )
    else:
        workspace_update = SetupRunWorkspaceFinalization(
            phase=WorkspacePostReadyPhase.failed,
            repo_setup_applied_version=None,
            repo_files_last_error=bounded_last_error or SETUP_RUN_DEFAULT_FAILURE_ERROR,
            status_detail="Repo setup failed",
        )

    return SetupRunFinalizationDecision(
        run_status=final_status,
        run_last_error=bounded_last_error,
        should_update_workspace=True,
        set_last_polled_at=True,
        clear_next_poll_at=True,
        workspace_update=workspace_update,
    )
