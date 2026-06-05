"""Client-visible command queue and pending interaction state."""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.live.service import publish_command_status_after_commit
from proliferate.utils.time import utcnow

_CLIENT_COMMAND_QUEUE_EXPIRATION = timedelta(minutes=4)
_CLIENT_EXPIRABLE_QUEUED_COMMAND_KINDS = {
    CloudCommandKind.start_session.value,
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.decide_plan.value,
    CloudCommandKind.update_session_config.value,
}
_CLIENT_EXPIRABLE_QUEUED_COMMAND_SOURCES = {
    CloudCommandSource.web.value,
    CloudCommandSource.mobile.value,
}
_CLIENT_COMMAND_QUEUE_TIMEOUT_CODE = "client_command_queue_timeout"
_CLIENT_COMMAND_QUEUE_TIMEOUT_MESSAGE = (
    "Cloud runtime did not pick up this command before it timed out. "
    "Retry after the workspace shows Live."
)


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


async def record_pending_prompt_interaction_for_command(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> None:
    if (
        command.kind != CloudCommandKind.send_prompt.value
        or command.session_id is None
        or command.cloud_workspace_id is None
    ):
        return
    try:
        payload = json.loads(command.payload_json or "{}")
    except ValueError:
        return
    if not isinstance(payload, dict):
        return
    prompt_id = _str_or_none(payload.get("promptId"))
    text = _str_or_none(payload.get("text"))
    if not prompt_id or not text or not text.strip():
        return
    await events_store.upsert_pending_interaction(
        db,
        target_id=command.target_id,
        cloud_workspace_id=command.cloud_workspace_id,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        request_id=prompt_id,
        seq=command.observed_event_seq or 0,
        occurred_at=command.created_at.isoformat(),
        kind="send_prompt",
        title="Queued prompt",
        description="Waiting for response.",
        payload_json=compact_command_json(
            {
                "text": text,
                "promptId": prompt_id,
                "commandId": str(command.id),
                "source": command.source,
            }
        ),
    )


async def expire_stale_client_command_if_needed(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
) -> commands_store.CloudCommandSnapshot:
    if command.source not in _CLIENT_EXPIRABLE_QUEUED_COMMAND_SOURCES:
        return command
    if command.kind not in _CLIENT_EXPIRABLE_QUEUED_COMMAND_KINDS:
        return command
    now = utcnow()
    if command.status == CloudCommandStatus.queued.value:
        if now - command.created_at < _CLIENT_COMMAND_QUEUE_EXPIRATION:
            return command
    elif command.status in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        if now - command.created_at < _CLIENT_COMMAND_QUEUE_EXPIRATION:
            return command
        if command.lease_expires_at is None or command.lease_expires_at > now:
            return command
    else:
        return command
    expired = await commands_store.expire_command_if_not_terminal(
        db,
        command_id=command.id,
        error_code=_CLIENT_COMMAND_QUEUE_TIMEOUT_CODE,
        error_message=_CLIENT_COMMAND_QUEUE_TIMEOUT_MESSAGE,
        now=now,
        eligible_statuses=(
            CloudCommandStatus.queued.value,
            CloudCommandStatus.leased.value,
            CloudCommandStatus.delivered.value,
        ),
    )
    if expired is None:
        return command
    if expired.status == CloudCommandStatus.expired.value:
        await mark_pending_prompt_interaction_failed_for_command(db, expired)
        await publish_command_status_after_commit(db, expired)
    return expired


async def expire_stale_client_commands_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> tuple[commands_store.CloudCommandSnapshot, ...]:
    now = utcnow()
    expired_commands: list[commands_store.CloudCommandSnapshot] = []
    for source in _CLIENT_EXPIRABLE_QUEUED_COMMAND_SOURCES:
        expired_commands.extend(
            await commands_store.expire_stale_queued_commands(
                db,
                target_id=target_id,
                source=source,
                command_kinds=tuple(_CLIENT_EXPIRABLE_QUEUED_COMMAND_KINDS),
                older_than=now - _CLIENT_COMMAND_QUEUE_EXPIRATION,
                error_code=_CLIENT_COMMAND_QUEUE_TIMEOUT_CODE,
                error_message=_CLIENT_COMMAND_QUEUE_TIMEOUT_MESSAGE,
                now=now,
            )
        )
    for command in expired_commands:
        await mark_pending_prompt_interaction_failed_for_command(db, command)
        await publish_command_status_after_commit(db, command)
    return tuple(expired_commands)


async def mark_pending_prompt_interaction_failed_for_command(
    db: AsyncSession,
    command: commands_store.CloudCommandSnapshot,
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
    await events_store.fail_existing_pending_interaction(
        db,
        target_id=command.target_id,
        session_id=command.session_id,
        request_id=prompt_id,
        occurred_at=utcnow().isoformat(),
        description=command.error_message or "Prompt could not be delivered.",
        payload_json=compact_command_json(
            {
                **payload,
                "commandId": str(command.id),
                "errorCode": command.error_code,
                "errorMessage": command.error_message,
                "status": command.status,
            }
        ),
    )
