"""Managed cloud target wake hook skeleton."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_TARGET_HEARTBEAT_STALE_SECONDS, CloudCommandKind
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_sync import command_records
from proliferate.db.store.cloud_sync import command_results as command_results_store
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import pending_interactions as pending_interactions_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.billing.authorization import authorize_sandbox_start_for_billing_subject
from proliferate.server.cloud.live.service import (
    publish_command_status_after_commit,
    publish_worker_control_after_commit,
)
from proliferate.server.cloud.runtime.domain.wake import WAKE_REQUIRED_CLOUD_COMMAND_KINDS
from proliferate.server.cloud.runtime.liveness.ensure_running import (
    ensure_environment_runtime_ready,
)
from proliferate.utils.crypto import decrypt_text
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.runtime.wake")
_wake_tasks: dict[str, asyncio.Task[None]] = {}
_WAKE_BLOCKED_ERROR_CODE = "sandbox_wake_blocked"
_WAKE_BLOCKED_FALLBACK_MESSAGE = "Sandbox wake is blocked by billing."


async def cancel_managed_target_wake_tasks() -> None:
    """Cancel outstanding in-process wake attempts during shutdown or test cleanup."""

    tasks = tuple(_wake_tasks.values())
    if not tasks:
        return
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    for key, task in tuple(_wake_tasks.items()):
        if task in tasks:
            _wake_tasks.pop(key, None)


def kick_off_managed_target_wake(target_id: UUID, command_id: UUID | None = None) -> None:
    """Schedule a managed target wake attempt without waiting for provider work."""

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
        await run_managed_target_wake_job(target_id, command_id=command_id)
    finally:
        _wake_tasks.pop(key, None)


def _profile_billing_subject_id(sandbox_profile_id: UUID) -> UUID | None:
    """Resolve the billing subject for a profile-backed managed target.

    Sandbox profiles were removed with the Bifrost gateway teardown
    (specs/codebase/primitives/agent-auth-litellm.md), so the lookup always
    misses; callers treat ``None`` as "nothing to wake".
    """
    del sandbox_profile_id
    return None


async def run_managed_target_wake_job(target_id: UUID, command_id: UUID | None = None) -> None:
    """Gate managed target wake on billing before provider resume work."""

    async with db_engine.async_session_factory() as db:
        target = await targets_store.get_target_by_id(db, target_id)
        if target is None or target.sandbox_profile_id is None:
            return
        billing_subject_id = _profile_billing_subject_id(target.sandbox_profile_id)
        if billing_subject_id is None:
            return
        actor_user_id = target.created_by_user_id

    authorization = await authorize_sandbox_start_for_billing_subject(
        actor_user_id=actor_user_id,
        billing_subject_id=billing_subject_id,
    )
    if not authorization.allowed:
        async with db_engine.async_session_factory() as db:
            message = (
                authorization.message
                or authorization.start_block_reason
                or _WAKE_BLOCKED_FALLBACK_MESSAGE
            )
            marked_at = utcnow()
            commands = await command_results_store.mark_queued_commands_failed_delivery_for_target(
                db,
                target_id=target_id,
                command_kinds=WAKE_REQUIRED_CLOUD_COMMAND_KINDS,
                error_code=_WAKE_BLOCKED_ERROR_CODE,
                error_message=message,
                now=marked_at,
            )
            if commands:
                await worker_control_store.bump_control_revision(
                    db,
                    target_id=target_id,
                    now=marked_at,
                )
                await publish_worker_control_after_commit(
                    db,
                    target_id=target_id,
                    reason="command",
                )
            for command in commands:
                await _fail_pending_prompt_interaction_for_command(db, command)
                await publish_command_status_after_commit(db, command)
            await db.commit()
            logger.info(
                "Blocked managed target wake because billing denied sandbox start",
                extra={
                    "target_id": str(target_id),
                    "billing_subject_id": str(billing_subject_id),
                    "reason": authorization.start_block_reason,
                    "failed_command_count": len(commands),
                },
            )
            return

    async with _managed_target_wake_execution_lock(target_id) as acquired:
        if not acquired:
            logger.info(
                "Managed target wake skipped because another worker owns the target wake lock",
                extra={"target_id": str(target_id)},
            )
            return
        resumed = await _resume_target_runtime_environment(target_id, command_id=command_id)
        if resumed:
            return
        await perform_proliferate_owned_e2b_resume({"target_id": str(target_id)})


@asynccontextmanager
async def _managed_target_wake_execution_lock(target_id: UUID) -> AsyncIterator[bool]:
    async with db_engine.async_session_factory() as db:
        acquired = await targets_store.try_acquire_managed_target_wake_lock(
            db,
            target_id=target_id,
        )
        if not acquired:
            yield False
            return
        try:
            yield True
        finally:
            await targets_store.release_managed_target_wake_lock(
                db,
                target_id=target_id,
            )
            await db.commit()


async def _fail_pending_prompt_interaction_for_command(
    db: AsyncSession,
    command: command_records.CloudCommandSnapshot,
) -> None:
    if command.kind != CloudCommandKind.send_prompt.value or command.session_id is None:
        return
    try:
        payload = json.loads(command.payload_json or "{}")
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    prompt_id = _str_or_none(payload.get("promptId"))
    if not prompt_id:
        return
    await pending_interactions_store.fail_existing_pending_interaction(
        db,
        target_id=command.target_id,
        session_id=command.session_id,
        request_id=prompt_id,
        occurred_at=utcnow().isoformat(),
        description=command.error_message or "Prompt could not be delivered.",
        payload_json=_compact_json(
            {
                **payload,
                "commandId": str(command.id),
                "errorCode": command.error_code,
                "errorMessage": command.error_message,
                "status": command.status,
            }
        ),
    )


def _str_or_none(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _compact_json(value: dict[str, object]) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


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
            if runtime_access is None or runtime_access.cloud_sandbox_id is None:
                return False
            environment = (
                await db.execute(
                    select(CloudRuntimeEnvironment)
                    .where(
                        CloudRuntimeEnvironment.active_sandbox_id
                        == runtime_access.cloud_sandbox_id,
                    )
                    .where(CloudRuntimeEnvironment.target_id == target_id)
                    .order_by(CloudRuntimeEnvironment.updated_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if environment is None:
                return False
        elif environment.active_sandbox_id is None:
            runtime_access = await targets_store.load_active_runtime_access_for_target(
                db,
                target_id=target_id,
            )
            if runtime_access is None or runtime_access.cloud_sandbox_id is None:
                return False
            environment.active_sandbox_id = runtime_access.cloud_sandbox_id
            environment.runtime_url = runtime_access.anyharness_base_url or environment.runtime_url
            environment.runtime_token_ciphertext = (
                runtime_access.runtime_token_ciphertext or environment.runtime_token_ciphertext
            )
            environment.anyharness_data_key_ciphertext = (
                runtime_access.anyharness_data_key_ciphertext
                or environment.anyharness_data_key_ciphertext
            )
            await db.flush()
            await db.commit()

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
        "Managed target wake resumed target runtime",
        extra={
            "target_id": str(target_id),
            "command_id": str(command_id) if command_id is not None else None,
            "runtime_environment_id": str(environment.id),
            "workspace_id": str(wake_workspace_id),
            "runtime_url_present": bool(runtime_url),
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


async def perform_proliferate_owned_e2b_resume(target: object) -> None:
    """Placeholder for the Proliferate-owned provider resume operation."""

    del target


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
            "action": "managed_target_wake_task",
        },
        extras={
            "target_id": str(target_id),
            "command_id": str(command_id) if command_id is not None else None,
        },
    )
    logger.error(
        "Managed target wake task failed",
        exc_info=(type(exc), exc, exc.__traceback__),
    )
