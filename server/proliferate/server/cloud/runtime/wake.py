"""Managed cloud slot wake hook skeleton."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from proliferate.integrations.sentry import capture_server_sentry_exception

logger = logging.getLogger("proliferate.cloud.runtime.wake")
_wake_tasks: dict[str, asyncio.Task[None]] = {}


def kick_off_managed_slot_wake(target_id: UUID, command_id: UUID | None = None) -> None:
    """Schedule a managed slot wake attempt without waiting for provider work."""

    key = str(target_id)
    existing = _wake_tasks.get(key)
    if existing is not None and not existing.done():
        return
    task = asyncio.create_task(_run_wake_task(target_id))
    task.add_done_callback(
        lambda completed_task: _capture_wake_task_failure(
            completed_task,
            target_id=target_id,
            command_id=command_id,
        )
    )
    _wake_tasks[key] = task


async def _run_wake_task(target_id: UUID) -> None:
    key = str(target_id)
    try:
        await run_managed_slot_wake_job(target_id)
    finally:
        _wake_tasks.pop(key, None)


async def run_managed_slot_wake_job(target_id: UUID) -> None:
    """Background wake job placeholder.

    Spec 09 owns the billing decision and the provider resume implementation.
    This hook intentionally does not talk to E2B yet.
    """

    del target_id


async def perform_proliferate_owned_e2b_resume(slot: object) -> None:
    """Placeholder for the Proliferate-owned provider resume operation."""

    del slot


def _capture_wake_task_failure(
    task: asyncio.Task[None],
    *,
    target_id: UUID,
    command_id: UUID | None,
) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    capture_server_sentry_exception(
        exc,
        tags={
            "domain": "cloud_runtime",
            "action": "managed_slot_wake_task",
        },
        extras={
            "target_id": str(target_id),
            "command_id": str(command_id) if command_id is not None else None,
        },
    )
    logger.error(
        "Managed slot wake task failed",
        exc_info=(type(exc), exc, exc.__traceback__),
    )
