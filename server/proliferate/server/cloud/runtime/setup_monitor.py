"""Durable monitor for remote AnyHarness setup command-runs."""

from __future__ import annotations

import asyncio
import logging
import socket
from uuid import UUID, uuid4

from proliferate.db.store.cloud_workspace_setup_runs import (
    claim_due_setup_runs,
    finalize_setup_run,
    load_cloud_workspace_setup_run,
    mark_setup_run_timed_out,
    release_setup_run_claim,
)
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.runtime.service import get_workspace_connection
from proliferate.server.cloud.runtime.workspace_operations import get_remote_terminal_command_run
from proliferate.utils.time import utcnow

_SETUP_MONITOR_POLL_SECONDS = 5
_SETUP_MONITOR_OWNER = f"{socket.gethostname()}:{uuid4()}"
_setup_monitor_task: asyncio.Task[None] | None = None


def start_cloud_setup_monitor() -> None:
    global _setup_monitor_task
    if _setup_monitor_task is None or _setup_monitor_task.done():
        _setup_monitor_task = asyncio.create_task(
            _cloud_setup_monitor_loop(),
            name="cloud-setup-monitor",
        )


async def stop_cloud_setup_monitor() -> None:
    global _setup_monitor_task
    task = _setup_monitor_task
    _setup_monitor_task = None
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return


async def _cloud_setup_monitor_loop() -> None:
    while True:
        try:
            await reconcile_cloud_setup_runs()
        except Exception as exc:
            log_cloud_event(
                "cloud setup monitor reconciliation failed",
                level=logging.WARNING,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
        await asyncio.sleep(_SETUP_MONITOR_POLL_SECONDS)


async def reconcile_cloud_setup_runs() -> None:
    for run in await claim_due_setup_runs(owner=_SETUP_MONITOR_OWNER):
        try:
            await _poll_setup_run(run.id)
        except Exception as exc:
            error_message = format_exception_message(exc)
            if utcnow() >= run.deadline_at:
                await finalize_setup_run(
                    run.id,
                    final_status="failed",
                    success=False,
                    last_error=error_message,
                )
            else:
                await release_setup_run_claim(run.id, last_error=error_message)


async def _poll_setup_run(setup_run_id: UUID) -> None:
    setup_run = await load_cloud_workspace_setup_run(setup_run_id)
    if setup_run is None:
        return
    if utcnow() >= setup_run.deadline_at:
        await mark_setup_run_timed_out(setup_run.id)
        return

    workspace = await load_cloud_workspace_by_id(setup_run.workspace_id)
    if workspace is None:
        await finalize_setup_run(
            setup_run.id,
            final_status="stale",
            success=False,
            last_error="Cloud workspace no longer exists.",
        )
        return

    target = await get_workspace_connection(workspace)
    if not target.anyharness_workspace_id:
        await release_setup_run_claim(
            setup_run.id,
            last_error="Cloud workspace runtime is not ready yet.",
        )
        return

    detail = await get_remote_terminal_command_run(
        target.runtime_url,
        target.access_token,
        command_run_id=setup_run.command_run_id,
        workspace_id=workspace.id,
    )

    if detail.status in {"queued", "running"}:
        await release_setup_run_claim(setup_run.id, status="running")
        return

    if detail.status == "succeeded":
        await finalize_setup_run(setup_run.id, final_status="succeeded", success=True)
        return

    final_status = "timed_out" if detail.status == "timed_out" else "failed"
    await finalize_setup_run(
        setup_run.id,
        final_status=final_status,
        success=False,
        last_error=_setup_error_message(detail.stderr, detail.combined_output, detail.stdout),
    )


def _setup_error_message(
    stderr: str | None,
    combined_output: str | None,
    stdout: str | None,
) -> str:
    for value in (stderr, combined_output, stdout):
        if value and value.strip():
            return value.strip()
    return "Repo setup failed."
