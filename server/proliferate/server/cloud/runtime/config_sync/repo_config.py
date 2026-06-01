"""Repo-config apply flows for cloud workspaces after runtime readiness."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigValue,
    load_cloud_repo_config_for_user,
)
from proliferate.db.store.cloud_workspace_setup_runs import create_cloud_workspace_setup_run
from proliferate.db.store.cloud_workspaces import (
    update_workspace_repo_apply_status_by_id,
    workspace_repo_apply_lock,
)
from proliferate.integrations.anyharness import (
    CloudRuntimeOperationError,
    read_remote_workspace_file_state,
    start_remote_workspace_setup,
    write_remote_workspace_file,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.workspaces.domain.post_ready import (
    WorkspacePostReadyStatusPatch,
    repo_config_apply_started,
    repo_config_completed,
    repo_config_empty_completed,
    repo_config_file_failed,
    repo_config_file_progress,
    repo_config_files_version_applied,
    repo_setup_start_failed,
    repo_setup_starting,
)
from proliferate.utils.time import duration_ms, utcnow


class WorkspaceRepoApplyBusyError(RuntimeError):
    """Raised when a workspace already has an apply or setup operation in flight."""


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
    async with (
        db_engine.async_session_factory() as db,
        workspace_repo_apply_lock(db, workspace_id) as acquired,
    ):
        if not acquired:
            raise WorkspaceRepoApplyBusyError(
                "A repo config apply operation is already running for this workspace."
            )
        yield


async def _load_workspace_repo_config(workspace: CloudWorkspace) -> CloudRepoConfigValue | None:
    async with db_engine.async_session_factory() as db:
        return await load_cloud_repo_config_for_user(
            db,
            user_id=workspace.user_id,
            git_owner=workspace.git_owner,
            git_repo_name=workspace.git_repo_name,
        )


async def _apply_post_ready_patch(
    workspace_id: UUID,
    patch: WorkspacePostReadyStatusPatch,
) -> None:
    kwargs: dict[str, object] = {}
    if patch.phase is not None:
        kwargs["repo_post_ready_phase"] = patch.phase.value
    if patch.status_detail is not None:
        kwargs["status_detail"] = patch.status_detail
    if patch.files_total is not None:
        kwargs["repo_post_ready_files_total"] = patch.files_total
    if patch.files_applied is not None:
        kwargs["repo_post_ready_files_applied"] = patch.files_applied
    if patch.mark_started:
        kwargs["repo_post_ready_started_at"] = utcnow()
    if patch.mark_completed:
        kwargs["repo_post_ready_completed_at"] = utcnow()
    if patch.clear_completed_at:
        kwargs["repo_post_ready_completed_at"] = None
    if patch.set_failed_path:
        kwargs["repo_files_last_failed_path"] = patch.failed_path
    if patch.set_failed_error:
        kwargs["repo_files_last_error"] = patch.failed_error
    if patch.files_version is not None:
        kwargs["repo_files_applied_version"] = patch.files_version
    if patch.mark_applied_now:
        kwargs["repo_files_applied_at"] = utcnow()
    if patch.clear_apply_token:
        kwargs["repo_post_ready_apply_token"] = None
    elif patch.apply_token is not None:
        kwargs["repo_post_ready_apply_token"] = patch.apply_token
    async with db_engine.async_session_factory() as db, db.begin():
        await update_workspace_repo_apply_status_by_id(db, workspace_id, **kwargs)


async def _start_workspace_setup_monitor(
    workspace: CloudWorkspace,
    *,
    runtime: WorkspaceRuntimeAccess,
    repo_config: CloudRepoConfigValue,
    setup_script: str,
) -> WorkspaceSetupStartResult:
    apply_token = uuid4().hex
    await _apply_post_ready_patch(workspace.id, repo_setup_starting(apply_token))
    try:
        setup_started = time.perf_counter()
        started = await start_remote_workspace_setup(
            runtime.runtime_url,
            runtime.access_token,
            anyharness_workspace_id=runtime.anyharness_workspace_id,
            command=setup_script,
            base_ref=workspace.git_base_branch,
        )
        log_cloud_event(
            "cloud runtime setup started",
            workspace_id=workspace.id,
            runtime_url=runtime.runtime_url,
            remote_workspace_id=runtime.anyharness_workspace_id,
            elapsed_ms=duration_ms(setup_started),
        )
        if not started.command_run_id:
            raise CloudRuntimeOperationError("Remote setup start did not return a commandRunId.")
        async with db_engine.async_session_factory() as db, db.begin():
            await create_cloud_workspace_setup_run(
                db,
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
        await _apply_post_ready_patch(
            workspace.id,
            repo_setup_start_failed(error_message),
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
    await _apply_post_ready_patch(workspace.id, repo_config_apply_started(total_files))

    for index, tracked_file in enumerate(repo_config.tracked_files, start=1):
        try:
            read_started = time.perf_counter()
            remote_state = await read_remote_workspace_file_state(
                runtime.runtime_url,
                runtime.access_token,
                anyharness_workspace_id=runtime.anyharness_workspace_id,
                relative_path=tracked_file.relative_path,
            )
            log_cloud_event(
                "cloud runtime file state loaded",
                workspace_id=workspace.id,
                runtime_url=runtime.runtime_url,
                remote_workspace_id=runtime.anyharness_workspace_id,
                relative_path=tracked_file.relative_path,
                elapsed_ms=duration_ms(read_started),
            )
            write_started = time.perf_counter()
            await write_remote_workspace_file(
                runtime.runtime_url,
                runtime.access_token,
                anyharness_workspace_id=runtime.anyharness_workspace_id,
                relative_path=tracked_file.relative_path,
                content=tracked_file.content,
                expected_version_token=remote_state.version_token,
            )
            log_cloud_event(
                "cloud runtime file written",
                workspace_id=workspace.id,
                runtime_url=runtime.runtime_url,
                remote_workspace_id=runtime.anyharness_workspace_id,
                relative_path=tracked_file.relative_path,
                elapsed_ms=duration_ms(write_started),
            )
        except Exception as exc:
            error_message = format_exception_message(exc)
            await _apply_post_ready_patch(
                workspace.id,
                repo_config_file_failed(
                    relative_path=tracked_file.relative_path,
                    error=error_message,
                ),
            )
            raise CloudRuntimeOperationError(error_message) from exc

        await _apply_post_ready_patch(workspace.id, repo_config_file_progress(index))

    await _apply_post_ready_patch(
        workspace.id,
        repo_config_files_version_applied(repo_config.files_version),
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
            await _apply_post_ready_patch(workspace.id, repo_config_empty_completed())
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

        await _apply_post_ready_patch(
            workspace.id,
            repo_config_completed(
                files_total=len(repo_config.tracked_files),
                files_version=repo_config.files_version,
                clear_apply_token=True,
            ),
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
