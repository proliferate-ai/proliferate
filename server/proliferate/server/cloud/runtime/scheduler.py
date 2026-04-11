"""Thin orchestration surface for cloud workspace runtime tasks."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.cloud.runtime.provision import provision_workspace

_provision_tasks: dict[str, asyncio.Task[None]] = {}
logger = logging.getLogger("proliferate.cloud.runtime.scheduler")


def _capture_provision_task_failure(task: asyncio.Task[None], *, workspace_id: UUID) -> None:
    if task.cancelled():
        return

    exc = task.exception()
    if exc is None:
        return

    capture_server_sentry_exception(
        exc,
        tags={
            "domain": "cloud_runtime",
            "action": "workspace_provision_task",
        },
        extras={
            "workspace_id": str(workspace_id),
        },
    )
    logger.error(
        "Workspace provision task failed",
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def schedule_workspace_provision(
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> None:
    key = str(workspace_id)
    existing = _provision_tasks.get(key)
    if existing and not existing.done():
        return
    task = asyncio.create_task(
        _run_provision_task(
            workspace_id,
            requested_base_sha=requested_base_sha,
        )
    )
    task.add_done_callback(
        lambda completed_task: _capture_provision_task_failure(
            completed_task,
            workspace_id=workspace_id,
        )
    )
    _provision_tasks[key] = task


async def _run_provision_task(
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> None:
    key = str(workspace_id)
    try:
        await provision_workspace(workspace_id, requested_base_sha=requested_base_sha)
    finally:
        _provision_tasks.pop(key, None)
