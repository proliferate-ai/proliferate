"""API-facing command transaction helpers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.db import session_ops as db_session
from proliferate.db.store.cloud_sync import command_records
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.service import enqueue_command


async def enqueue_command_and_commit(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    body: CreateCloudCommandRequest,
) -> command_records.CloudCommandSnapshot:
    command = await enqueue_command(db, user=user, body=body)
    await db_session.commit_session(db)
    return command
