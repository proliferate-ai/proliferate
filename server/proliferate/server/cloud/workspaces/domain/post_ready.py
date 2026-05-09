"""Pure post-ready repo-apply status decisions for cloud workspaces."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.constants.cloud import WorkspacePostReadyPhase


@dataclass(frozen=True)
class WorkspacePostReadyStatusPatch:
    phase: WorkspacePostReadyPhase | None = None
    status_detail: str | None = None
    files_total: int | None = None
    files_applied: int | None = None
    mark_started: bool = False
    mark_completed: bool = False
    clear_completed_at: bool = False
    set_failed_path: bool = False
    failed_path: str | None = None
    set_failed_error: bool = False
    failed_error: str | None = None
    files_version: int | None = None
    mark_applied_now: bool = False
    apply_token: str | None = None
    clear_apply_token: bool = False


def repo_setup_starting(apply_token: str) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        phase=WorkspacePostReadyPhase.starting_setup,
        status_detail="Starting repo setup",
        mark_started=True,
        clear_completed_at=True,
        set_failed_path=True,
        set_failed_error=True,
        apply_token=apply_token,
    )


def repo_setup_start_failed(error: str) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        phase=WorkspacePostReadyPhase.failed,
        status_detail="Repo setup failed to start",
        mark_completed=True,
        set_failed_path=True,
        set_failed_error=True,
        failed_error=error,
        clear_apply_token=True,
    )


def repo_config_apply_started(files_total: int) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        phase=WorkspacePostReadyPhase.applying_files,
        status_detail="Applying repo config",
        files_total=files_total,
        files_applied=0,
        mark_started=True,
        set_failed_path=True,
        set_failed_error=True,
    )


def repo_config_file_progress(files_applied: int) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        status_detail="Applying repo config",
        files_applied=files_applied,
        set_failed_path=True,
        set_failed_error=True,
    )


def repo_config_file_failed(
    *,
    relative_path: str,
    error: str,
) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        phase=WorkspacePostReadyPhase.failed,
        status_detail="Repo config apply failed",
        mark_completed=True,
        set_failed_path=True,
        failed_path=relative_path,
        set_failed_error=True,
        failed_error=error,
    )


def repo_config_files_version_applied(
    files_version: int,
) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        files_version=files_version,
        mark_applied_now=True,
        set_failed_path=True,
        set_failed_error=True,
    )


def repo_config_empty_completed() -> WorkspacePostReadyStatusPatch:
    return repo_config_completed(
        files_total=0,
        files_version=0,
        clear_apply_token=False,
    )


def repo_config_completed(
    *,
    files_total: int,
    files_version: int,
    clear_apply_token: bool,
) -> WorkspacePostReadyStatusPatch:
    return WorkspacePostReadyStatusPatch(
        phase=WorkspacePostReadyPhase.completed,
        status_detail="Ready",
        files_total=files_total,
        files_applied=files_total,
        mark_completed=True,
        set_failed_path=True,
        set_failed_error=True,
        files_version=files_version,
        mark_applied_now=True,
        clear_apply_token=clear_apply_token,
    )
