"""Managed cloud slot wake hook skeleton."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_TARGET_HEARTBEAT_STALE_SECONDS
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_sandbox_profiles import load_sandbox_profile_by_id
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.billing.service import authorize_sandbox_start_for_billing_subject
from proliferate.server.cloud.runtime.ensure_running import ensure_environment_runtime_ready
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.server.cloud.runtime.domain.wake import WAKE_REQUIRED_CLOUD_COMMAND_KINDS
from proliferate.utils.crypto import decrypt_text
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
    task = asyncio.create_task(_run_wake_task(target_id, command_id))
    task.add_done_callback(
        lambda completed_task: _capture_wake_task_failure(
            completed_task,
            target_id=target_id,
            command_id=command_id,
        )
    )
    _wake_tasks[key] = task


async def _run_wake_task(target_id: UUID, command_id: UUID | None) -> None:
    key = str(target_id)
    try:
        await run_managed_slot_wake_job(target_id, command_id=command_id)
    finally:
        _wake_tasks.pop(key, None)


async def run_managed_slot_wake_job(target_id: UUID, command_id: UUID | None = None) -> None:
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

    resumed = await _resume_target_runtime_environment(target_id, command_id=command_id)
    if resumed:
        return

    await perform_proliferate_owned_e2b_resume({"target_id": str(target_id)})


async def _resume_target_runtime_environment(
    target_id: UUID,
    *,
    command_id: UUID | None,
) -> bool:
    async with db_engine.async_session_factory() as db:
        command = (
            await commands_store.get_command_by_id(db, command_id)
            if command_id is not None
            else None
        )
        environment: CloudRuntimeEnvironment | None = None
        workspace_id: UUID | None = command.cloud_workspace_id if command is not None else None
        if workspace_id is not None:
            workspace = await db.get(CloudWorkspace, workspace_id)
            if (
                workspace is not None
                and workspace.target_id == target_id
                and workspace.runtime_environment_id is not None
            ):
                environment = await db.get(
                    CloudRuntimeEnvironment,
                    workspace.runtime_environment_id,
                )

        if environment is None:
            runtime_access = await targets_store.load_active_runtime_access_for_target(
                db,
                target_id=target_id,
            )
            if runtime_access is None or runtime_access.active_sandbox_id is None:
                return False
            environment = (
                await db.execute(
                    select(CloudRuntimeEnvironment)
                    .where(
                        CloudRuntimeEnvironment.active_sandbox_id
                        == runtime_access.active_sandbox_id,
                    )
                    .where(CloudRuntimeEnvironment.target_id == target_id)
                    .order_by(CloudRuntimeEnvironment.updated_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if environment is None:
                return False

        if environment.target_id != target_id or not environment.runtime_token_ciphertext:
            return False
        access_token = decrypt_text(environment.runtime_token_ciphertext)
        wake_workspace_id = workspace_id or environment.id
        force_launcher_restart = await _target_worker_heartbeat_is_stale(db, target_id)

    runtime_url = await ensure_environment_runtime_ready(
        environment,
        workspace_id=wake_workspace_id,
        allow_launcher_restart=True,
        access_token=access_token,
        force_launcher_restart=force_launcher_restart,
        refresh_worker_enrollment_on_restart=force_launcher_restart,
    )
    logger.info(
        "Managed slot wake resumed target runtime",
        extra={
            "target_id": str(target_id),
            "command_id": str(command_id) if command_id is not None else None,
            "runtime_environment_id": str(environment.id),
            "workspace_id": str(wake_workspace_id),
            "runtime_url": runtime_url,
            "force_launcher_restart": force_launcher_restart,
        },
    )
    return True


async def _target_worker_heartbeat_is_stale(db: AsyncSession, target_id: UUID) -> bool:
    target = await targets_store.get_target_by_id(db, target_id)
    if target is None or target.status_record is None:
        return True
    heartbeat_at = target.status_record.last_heartbeat_at
    if target.status_record.worker_id is None or heartbeat_at is None:
        return True
    stale_before = utcnow() - timedelta(seconds=CLOUD_TARGET_HEARTBEAT_STALE_SECONDS)
    return heartbeat_at <= stale_before


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
