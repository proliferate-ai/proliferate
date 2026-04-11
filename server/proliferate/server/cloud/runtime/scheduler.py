"""Thin orchestration surface for cloud workspace runtime tasks."""

from __future__ import annotations

import asyncio
from uuid import UUID

from proliferate.server.cloud.runtime.provision import provision_workspace

_provision_tasks: dict[str, asyncio.Task[None]] = {}


def schedule_workspace_provision(
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> None:
    key = str(workspace_id)
    existing = _provision_tasks.get(key)
    if existing and not existing.done():
        return
    _provision_tasks[key] = asyncio.create_task(
        _run_provision_task(
            workspace_id,
            requested_base_sha=requested_base_sha,
        )
    )


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
