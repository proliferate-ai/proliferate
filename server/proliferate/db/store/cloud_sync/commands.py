"""Persistence helpers for cloud worker commands."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.commands import CloudCommand, CloudCommandLease
from proliferate.db.store.cloud_sync.json import JsonObject, decode_object, encode_object
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CommandRecord:
    id: UUID
    idempotency_key: str
    org_id: UUID
    actor_user_id: UUID | None
    actor_kind: str
    source: str
    target_id: UUID
    workspace_id: UUID | None
    session_id: str | None
    kind: str
    payload: dict[str, object]
    observed_event_seq: int | None
    preconditions: dict[str, object]
    status: str
    created_at: datetime
    lease_expires_at: datetime | None
    error_code: str | None
    error_message: str | None


@dataclass(frozen=True)
class CommandLeaseRecord:
    id: UUID
    command: CommandRecord
    expires_at: datetime


def command_record(command: CloudCommand) -> CommandRecord:
    return CommandRecord(
        id=command.id,
        idempotency_key=command.idempotency_key,
        org_id=command.org_id,
        actor_user_id=command.actor_user_id,
        actor_kind=command.actor_kind,
        source=command.source,
        target_id=command.target_id,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        kind=command.kind,
        payload=decode_object(command.payload_json),
        observed_event_seq=command.observed_event_seq,
        preconditions=decode_object(command.preconditions_json),
        status=command.status,
        created_at=command.created_at,
        lease_expires_at=command.lease_expires_at,
        error_code=command.error_code,
        error_message=command.error_message,
    )


async def enqueue_command(
    db: AsyncSession,
    *,
    org_id: UUID,
    idempotency_key: str,
    actor_user_id: UUID | None,
    actor_kind: str,
    source: str,
    target_id: UUID,
    workspace_id: UUID | None,
    session_id: str | None,
    kind: str,
    payload: JsonObject,
    observed_event_seq: int | None,
    preconditions: JsonObject,
    authorization_context: JsonObject,
) -> CommandRecord:
    existing = (
        await db.execute(
            select(CloudCommand).where(
                CloudCommand.org_id == org_id,
                CloudCommand.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return command_record(existing)

    command = CloudCommand(
        org_id=org_id,
        idempotency_key=idempotency_key,
        actor_user_id=actor_user_id,
        actor_kind=actor_kind,
        source=source,
        target_id=target_id,
        workspace_id=workspace_id,
        session_id=session_id,
        kind=kind,
        payload_json=encode_object(payload),
        observed_event_seq=observed_event_seq,
        preconditions_json=encode_object(preconditions),
        authorization_context_json=encode_object(authorization_context),
        status="queued",
    )
    db.add(command)
    await db.flush()
    return command_record(command)


async def get_command(db: AsyncSession, command_id: UUID) -> CommandRecord | None:
    command = await db.get(CloudCommand, command_id)
    if command is None:
        return None
    return command_record(command)


async def lease_next_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    lease_seconds: int = 60,
) -> CommandLeaseRecord | None:
    now = utcnow()
    rows = await db.execute(
        select(CloudCommand)
        .where(CloudCommand.target_id == target_id)
        .where(CloudCommand.status == "queued")
        .order_by(CloudCommand.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    command = rows.scalar_one_or_none()
    if command is None:
        return None
    expires_at = now + timedelta(seconds=lease_seconds)
    command.status = "leased"
    command.leased_at = now
    command.lease_expires_at = expires_at
    command.updated_at = now
    lease = CloudCommandLease(
        command_id=command.id,
        target_id=target_id,
        worker_id=worker_id,
        leased_at=now,
        expires_at=expires_at,
    )
    db.add(lease)
    await db.flush()
    return CommandLeaseRecord(
        id=lease.id,
        command=command_record(command),
        expires_at=expires_at,
    )


async def mark_command_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
) -> CommandRecord | None:
    command = await db.get(CloudCommand, command_id)
    if command is None:
        return None
    now = utcnow()
    command.status = status
    if status == "delivered":
        command.delivered_at = now
    elif status == "failed_delivery":
        command.error_code = error_code
        command.error_message = error_message
    command.updated_at = now
    await db.flush()
    return command_record(command)


async def mark_command_result(
    db: AsyncSession,
    *,
    command_id: UUID,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
) -> CommandRecord | None:
    command = await db.get(CloudCommand, command_id)
    if command is None:
        return None
    now = utcnow()
    command.status = status
    if status in {"accepted", "accepted_but_queued"}:
        command.accepted_at = now
    elif status == "rejected":
        command.rejected_at = now
        command.error_code = error_code
        command.error_message = error_message
    elif status == "expired":
        command.expired_at = now
    command.updated_at = now
    await db.flush()
    return command_record(command)
