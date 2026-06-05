"""Command wake scheduling helpers."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.background.config import RUNTIME_WAKE_QUEUE, RUNTIME_WAKE_TARGET_TASK
from proliferate.constants.cloud import CloudCommandStatus
from proliferate.db.store.background_outbox import enqueue_outbox_task
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.commands.domain.target import target_requires_cloud_workspace
from proliferate.server.cloud.live.service import publish_worker_control_after_commit
from proliferate.server.cloud.runtime.domain.wake import command_kind_requires_wake


async def enqueue_managed_target_wake_outbox(
    db: AsyncSession,
    *,
    target_id: UUID,
    command_id: UUID,
) -> None:
    await enqueue_outbox_task(
        db,
        task_name=RUNTIME_WAKE_TARGET_TASK,
        queue=RUNTIME_WAKE_QUEUE,
        kwargs_json={
            "target_id": str(target_id),
            "command_id": str(command_id),
        },
        idempotency_key=f"{RUNTIME_WAKE_TARGET_TASK}:{target_id}:{command_id}",
    )


def is_terminal_command_status(status: str) -> bool:
    return status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }


def _command_requires_managed_target_wake(
    target: targets_store.CloudTargetSnapshot,
    command: commands_store.CloudCommandSnapshot,
) -> bool:
    if is_terminal_command_status(command.status):
        return False
    if not target_requires_cloud_workspace(target):
        return False
    return command_kind_requires_wake(command.kind)


async def kick_off_command_wake_after_commit_if_required(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    await publish_worker_control_after_commit(db, target_id=target.id, reason="command")
    if not _command_requires_managed_target_wake(target, command):
        return

    await enqueue_managed_target_wake_outbox(
        db,
        target_id=target.id,
        command_id=command.id,
    )
