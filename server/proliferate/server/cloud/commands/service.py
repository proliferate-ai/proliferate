"""Cloud command queue orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.commands import (
    CommandActorKind,
    CommandKind,
    CommandSource,
    enqueue_command,
    get_command,
)
from proliferate.db.store.cloud_sync.targets import get_target_detail
from proliferate.server.cloud.commands.models import CommandResponse, command_response
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.time import utcnow


async def enqueue_cloud_command(
    db: AsyncSession,
    *,
    user_id: UUID,
    idempotency_key: str,
    source: str,
    target_id: UUID,
    workspace_id: UUID | None,
    session_id: UUID | None,
    kind: str,
    payload: dict[str, object],
    observed_event_seq: int | None,
    preconditions: dict[str, object],
) -> CommandResponse:
    target = await get_target_detail(db, target_id=target_id)
    if target is None or target.target.org_id != user_id:
        raise CloudApiError("target_not_found", "Target not found.", status_code=404)
    command = await enqueue_command(
        db,
        org_id=user_id,
        idempotency_key=idempotency_key,
        actor_user_id=user_id,
        actor_kind=CommandActorKind.user,
        source=CommandSource(source),
        target_id=target_id,
        workspace_id=workspace_id,
        session_id=session_id,
        kind=CommandKind(kind),
        payload=payload,
        observed_event_seq=observed_event_seq,
        preconditions=preconditions,
        authorization_context={"actorUserId": str(user_id)},
        now=utcnow(),
    )
    return command_response(command)


async def get_cloud_command(
    db: AsyncSession,
    *,
    user_id: UUID,
    command_id: UUID,
) -> CommandResponse:
    command = await get_command(db, command_id=command_id)
    if command is None or command.org_id != user_id:
        raise CloudApiError("command_not_found", "Command not found.", status_code=404)
    return command_response(command)
