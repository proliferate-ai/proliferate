"""Managed cloud slot wake hook skeleton."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_sandbox_profiles import load_sandbox_profile_by_id
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.billing.service import authorize_sandbox_start_for_billing_subject
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.runtime.domain.wake import WAKE_REQUIRED_CLOUD_COMMAND_KINDS
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.runtime.wake")
_wake_tasks: dict[str, asyncio.Task[None]] = {}
_WAKE_BLOCKED_ERROR_CODE = "sandbox_wake_blocked"
_WAKE_BLOCKED_FALLBACK_MESSAGE = "Sandbox wake is blocked by billing."


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
    """Gate managed slot wake on billing before provider resume work."""

    async with db_engine.async_session_factory() as db:
        target = await targets_store.get_target_by_id(db, target_id)
        if target is None or target.sandbox_profile_id is None:
            return
        profile = await load_sandbox_profile_by_id(db, target.sandbox_profile_id)
        if profile is None:
            return
        authorization = await authorize_sandbox_start_for_billing_subject(
            actor_user_id=target.created_by_user_id,
            billing_subject_id=profile.billing_subject_id,
        )
        if not authorization.allowed:
            message = (
                authorization.message
                or authorization.start_block_reason
                or _WAKE_BLOCKED_FALLBACK_MESSAGE
            )
            commands = await commands_store.mark_queued_commands_failed_delivery_for_target(
                db,
                target_id=target.id,
                command_kinds=WAKE_REQUIRED_CLOUD_COMMAND_KINDS,
                error_code=_WAKE_BLOCKED_ERROR_CODE,
                error_message=message,
                now=utcnow(),
            )
            for command in commands:
                await publish_command_status_after_commit(db, command)
            await db.commit()
            logger.info(
                "Blocked managed slot wake because billing denied sandbox start",
                extra={
                    "target_id": str(target_id),
                    "billing_subject_id": str(profile.billing_subject_id),
                    "reason": authorization.start_block_reason,
                    "failed_command_count": len(commands),
                },
            )
            return
        await db.commit()

    await perform_proliferate_owned_e2b_resume({"target_id": str(target_id)})


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
