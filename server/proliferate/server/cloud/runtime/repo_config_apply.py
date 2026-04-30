"""Repo-config apply flows for cloud workspaces after runtime readiness."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

from proliferate.constants.cloud import WorkspacePostReadyPhase
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigValue,
    load_cloud_repo_config_for_user,
)
from proliferate.db.store.cloud_workspace_setup_runs import create_cloud_workspace_setup_run
from proliferate.db.store.cloud_workspaces import (
    update_workspace_repo_apply_status_by_id,
    workspace_repo_apply_lock,
)
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.workspace_operations import (
    CloudRuntimeOperationError,
    read_remote_workspace_file_state,
    start_remote_workspace_setup,
    write_remote_workspace_file,
)
from proliferate.utils.time import utcnow


class WorkspaceRepoApplyBusyError(RuntimeError):
    """Raised when a workspace already has an apply or setup operation in flight."""


_SKIP = object()


@dataclass(frozen=True)
class WorkspaceRuntimeAccess:
    runtime_url: str
    access_token: str
    anyharness_workspace_id: str


@dataclass(frozen=True)
class WorkspaceSetupStartResult:
    command: str
    terminal_id: str | None
    command_run_id: str | None
    status: str


@asynccontextmanager
async def _workspace_apply_lock(workspace_id: UUID) -> AsyncIterator[None]:
    async with workspace_repo_apply_lock(workspace_id) as acquired:
        if not acquired:
            raise WorkspaceRepoApplyBusyError(
                "A repo config apply operation is already running for this workspace."
            )
        yield


async def _load_workspace_repo_config(workspace: CloudWorkspace) -> CloudRepoConfigValue | None:
    return await load_cloud_repo_config_for_user(
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )


async def _set_apply_phase(
    workspace_id: UUID,
    *,
    phase: WorkspacePostReadyPhase,
    files_total: int | None = None,
    files_applied: int | None = None,
    started: bool = False,
    completed: bool = False,
    failed_path: str | None | object = _SKIP,
    failed_error: str | None | object = _SKIP,
    files_version: int | None = None,
    applied_now: bool = False,
    status_detail: str,
    apply_token: str | None | object = _SKIP,
) -> None:
    kwargs: dict[str, object] = {
        "repo_post_ready_phase": phase.value,
        "status_detail": status_detail,
    }
    if files_total is not None:
        kwargs["repo_post_ready_files_total"] = files_total
    if files_applied is not None:
        kwargs["repo_post_ready_files_applied"] = files_applied
    if started:
        kwargs["repo_post_ready_started_at"] = utcnow()
    if completed:
        kwargs["repo_post_ready_completed_at"] = utcnow()
    if failed_path is not _SKIP:
        kwargs["repo_files_last_failed_path"] = failed_path
    if failed_error is not _SKIP:
        kwargs["repo_files_last_error"] = failed_error
    if files_version is not None:
        kwargs["repo_files_applied_version"] = files_version
    if applied_now:
        kwargs["repo_files_applied_at"] = utcnow()
    if apply_token is not _SKIP:
        kwargs["repo_post_ready_apply_token"] = apply_token
    await update_workspace_repo_apply_status_by_id(workspace_id, **kwargs)


async def _start_workspace_setup_monitor(
    workspace: CloudWorkspace,
    *,
    runtime: WorkspaceRuntimeAccess,
    repo_config: CloudRepoConfigValue,
    setup_script: str,
) -> WorkspaceSetupStartResult:
    apply_token = uuid4().hex
    await update_workspace_repo_apply_status_by_id(
        workspace.id,
        repo_post_ready_phase=WorkspacePostReadyPhase.starting_setup.value,
        repo_post_ready_started_at=utcnow(),
        repo_post_ready_completed_at=None,
        repo_post_ready_apply_token=apply_token,
        repo_files_last_failed_path=None,
        repo_files_last_error=None,
        status_detail="Starting repo setup",
    )
    try:
        started = await start_remote_workspace_setup(
            runtime.runtime_url,
            runtime.access_token,
            anyharness_workspace_id=runtime.anyharness_workspace_id,
            command=setup_script,
            base_ref=workspace.git_base_branch,
            workspace_id=workspace.id,
        )
        if not started.command_run_id:
            raise CloudRuntimeOperationError("Remote setup start did not return a commandRunId.")
        await create_cloud_workspace_setup_run(
            workspace_id=workspace.id,
            anyharness_workspace_id=runtime.anyharness_workspace_id,
            terminal_id=started.terminal_id,
            command_run_id=started.command_run_id,
            setup_script_version=repo_config.files_version,
            apply_token=apply_token,
            deadline_at=utcnow() + timedelta(minutes=35),
            status="running",
        )
    except Exception as exc:
        error_message = format_exception_message(exc)
        await update_workspace_repo_apply_status_by_id(
            workspace.id,
            repo_post_ready_phase=WorkspacePostReadyPhase.failed.value,
            repo_post_ready_completed_at=utcnow(),
            repo_post_ready_apply_token=None,
            repo_files_last_failed_path=None,
            repo_files_last_error=error_message,
            status_detail="Repo setup failed to start",
        )
        raise CloudRuntimeOperationError(error_message) from exc

    return WorkspaceSetupStartResult(
        command=setup_script,
        terminal_id=started.terminal_id,
        command_run_id=started.command_run_id,
        status=started.status,
    )


async def _apply_repo_files(
    workspace: CloudWorkspace,
    *,
    runtime: WorkspaceRuntimeAccess,
    repo_config: CloudRepoConfigValue,
) -> None:
    total_files = len(repo_config.tracked_files)
    await _set_apply_phase(
        workspace.id,
        phase=WorkspacePostReadyPhase.applying_files,
        files_total=total_files,
        files_applied=0,
        started=True,
        failed_path=None,
        failed_error=None,
        status_detail="Applying repo config",
    )

    for index, tracked_file in enumerate(repo_config.tracked_files, start=1):
        try:
            remote_state = await read_remote_workspace_file_state(
                runtime.runtime_url,
                runtime.access_token,
                anyharness_workspace_id=runtime.anyharness_workspace_id,
                relative_path=tracked_file.relative_path,
                workspace_id=workspace.id,
            )
            await write_remote_workspace_file(
                runtime.runtime_url,
                runtime.access_token,
                anyharness_workspace_id=runtime.anyharness_workspace_id,
                relative_path=tracked_file.relative_path,
                content=tracked_file.content,
                expected_version_token=remote_state.version_token,
                workspace_id=workspace.id,
            )
        except Exception as exc:
            error_message = format_exception_message(exc)
            await update_workspace_repo_apply_status_by_id(
                workspace.id,
                repo_post_ready_phase=WorkspacePostReadyPhase.failed.value,
                repo_post_ready_completed_at=utcnow(),
                repo_files_last_failed_path=tracked_file.relative_path,
                repo_files_last_error=error_message,
                status_detail="Repo config apply failed",
            )
            raise CloudRuntimeOperationError(error_message) from exc

        await update_workspace_repo_apply_status_by_id(
            workspace.id,
            repo_post_ready_files_applied=index,
            repo_files_last_failed_path=None,
            repo_files_last_error=None,
            status_detail="Applying repo config",
        )

    await update_workspace_repo_apply_status_by_id(
        workspace.id,
        repo_files_applied_version=repo_config.files_version,
        repo_files_applied_at=utcnow(),
        repo_files_last_failed_path=None,
        repo_files_last_error=None,
    )


async def apply_workspace_repo_config(
    workspace: CloudWorkspace,
    *,
    runtime: WorkspaceRuntimeAccess,
    run_setup: bool,
) -> CloudRepoConfigValue | None:
    async with _workspace_apply_lock(workspace.id):
        repo_config = await _load_workspace_repo_config(workspace)
        if repo_config is None:
            await _set_apply_phase(
                workspace.id,
                phase=WorkspacePostReadyPhase.completed,
                files_total=0,
                files_applied=0,
                completed=True,
                files_version=0,
                applied_now=True,
                failed_path=None,
                failed_error=None,
                status_detail="Ready",
            )
            return None

        await _apply_repo_files(workspace, runtime=runtime, repo_config=repo_config)

        setup_script = repo_config.setup_script.strip()
        if run_setup and setup_script:
            await _start_workspace_setup_monitor(
                workspace,
                runtime=runtime,
                repo_config=repo_config,
                setup_script=setup_script,
            )
            return repo_config

        await _set_apply_phase(
            workspace.id,
            phase=WorkspacePostReadyPhase.completed,
            files_total=len(repo_config.tracked_files),
            files_applied=len(repo_config.tracked_files),
            completed=True,
            files_version=repo_config.files_version,
            applied_now=True,
            failed_path=None,
            failed_error=None,
            status_detail="Ready",
            apply_token=None,
        )
        return repo_config


async def run_workspace_saved_setup(
    workspace: CloudWorkspace,
    *,
    runtime: WorkspaceRuntimeAccess,
) -> WorkspaceSetupStartResult:
    async with _workspace_apply_lock(workspace.id):
        repo_config = await _load_workspace_repo_config(workspace)
        setup_script = "" if repo_config is None else repo_config.setup_script.strip()
        if not setup_script:
            raise CloudApiError(
                "cloud_setup_script_missing",
                "No cloud setup script is configured for this repo.",
                status_code=400,
            )

        return await _start_workspace_setup_monitor(
            workspace,
            runtime=runtime,
            repo_config=repo_config,
            setup_script=setup_script,
        )


async def apply_workspace_repo_config_after_provision(
    workspace: CloudWorkspace,
    *,
    runtime: WorkspaceRuntimeAccess,
) -> None:
    try:
        await apply_workspace_repo_config(workspace, runtime=runtime, run_setup=True)
    except WorkspaceRepoApplyBusyError:
        log_cloud_event(
            "cloud workspace post-ready apply skipped because another apply is active",
            level=logging.WARNING,
            workspace_id=workspace.id,
        )
    except Exception as exc:
        log_cloud_event(
            "cloud workspace post-ready apply failed",
            level=logging.WARNING,
            workspace_id=workspace.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
