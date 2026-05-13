"""Persistence helpers for cloud command queue rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.commands import CloudCommand, CloudCommandLease


class CommandActorKind(StrEnum):
    user = "user"
    automation = "automation"
    slack = "slack"
    api_key = "api_key"
    system = "system"


class CommandSource(StrEnum):
    web = "web"
    mobile = "mobile"
    slack = "slack"
    api = "api"
    automation = "automation"
    desktop_cloud_view = "desktop_cloud_view"


class CommandKind(StrEnum):
    start_session = "start_session"
    send_prompt = "send_prompt"
    resolve_interaction = "resolve_interaction"
    update_session_config = "update_session_config"
    cancel_turn = "cancel_turn"
    cancel_session = "cancel_session"
    stop_workspace = "stop_workspace"
    hibernate_workspace = "hibernate_workspace"
    resume_workspace = "resume_workspace"
    prune_workspace = "prune_workspace"
    extend_workspace_ttl = "extend_workspace_ttl"
    sync_existing_workspace = "sync_existing_workspace"


class CommandStatus(StrEnum):
    queued = "queued"
    leased = "leased"
    delivered = "delivered"
    accepted = "accepted"
    accepted_but_queued = "accepted_but_queued"
    rejected = "rejected"
    expired = "expired"
    superseded = "superseded"
    failed_delivery = "failed_delivery"


class CommandLeaseStatus(StrEnum):
    active = "active"
    completed = "completed"
    expired = "expired"
    released = "released"


@dataclass(frozen=True)
class CommandSnapshot:
    id: UUID
    idempotency_key: str
    org_id: UUID
    actor_user_id: UUID | None
    actor_kind: CommandActorKind
    source: CommandSource
    target_id: UUID
    workspace_id: UUID | None
    session_id: UUID | None
    kind: CommandKind
    payload: dict[str, object]
    observed_event_seq: int | None
    preconditions: dict[str, object]
    status: CommandStatus
    authorization_context: dict[str, object]
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    leased_at: datetime | None
    lease_expires_at: datetime | None
    delivered_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    expired_at: datetime | None


@dataclass(frozen=True)
class CommandLeaseSnapshot:
    id: UUID
    command_id: UUID
    target_id: UUID
    worker_id: UUID
    status: CommandLeaseStatus
    attempt: int
    leased_at: datetime
    expires_at: datetime
    completed_at: datetime | None
    command: CommandSnapshot


async def enqueue_command(
    db: AsyncSession,
    *,
    org_id: UUID,
    idempotency_key: str,
    actor_user_id: UUID | None,
    actor_kind: CommandActorKind,
    source: CommandSource,
    target_id: UUID,
    workspace_id: UUID | None,
    session_id: UUID | None,
    kind: CommandKind,
    payload: dict[str, object],
    observed_event_seq: int | None,
    preconditions: dict[str, object],
    authorization_context: dict[str, object],
    now: datetime,
) -> CommandSnapshot:
    existing = (
        await db.execute(
            select(CloudCommand).where(
                CloudCommand.org_id == org_id,
                CloudCommand.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _command_snapshot(existing)

    command = CloudCommand(
        org_id=org_id,
        idempotency_key=idempotency_key,
        actor_user_id=actor_user_id,
        actor_kind=actor_kind.value,
        source=source.value,
        target_id=target_id,
        workspace_id=workspace_id,
        session_id=session_id,
        kind=kind.value,
        payload=payload,
        observed_event_seq=observed_event_seq,
        preconditions=preconditions,
        status=CommandStatus.queued.value,
        authorization_context=authorization_context,
        created_at=now,
        updated_at=now,
    )
    db.add(command)
    await db.flush()
    return _command_snapshot(command)


async def get_command(
    db: AsyncSession,
    *,
    command_id: UUID,
) -> CommandSnapshot | None:
    command = await db.get(CloudCommand, command_id)
    if command is None:
        return None
    return _command_snapshot(command)


async def get_command_for_actor(
    db: AsyncSession,
    *,
    command_id: UUID,
    actor_user_id: UUID,
) -> CommandSnapshot | None:
    command = (
        await db.execute(
            select(CloudCommand).where(
                CloudCommand.id == command_id,
                CloudCommand.actor_user_id == actor_user_id,
            )
        )
    ).scalar_one_or_none()
    if command is None:
        return None
    return _command_snapshot(command)


async def lease_next_commands(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    lease_expires_at: datetime,
    now: datetime,
    limit: int,
) -> tuple[CommandLeaseSnapshot, ...]:
    rows = await db.execute(
        select(CloudCommand)
        .where(
            CloudCommand.target_id == target_id,
            CloudCommand.status == CommandStatus.queued.value,
        )
        .order_by(CloudCommand.created_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    leases: list[CommandLeaseSnapshot] = []
    for command in rows.scalars().all():
        attempt = await _next_attempt(db, command.id)
        command.status = CommandStatus.leased.value
        command.leased_at = now
        command.lease_expires_at = lease_expires_at
        command.updated_at = now
        lease = CloudCommandLease(
            command_id=command.id,
            target_id=target_id,
            worker_id=worker_id,
            status=CommandLeaseStatus.active.value,
            attempt=attempt,
            leased_at=now,
            expires_at=lease_expires_at,
            created_at=now,
            updated_at=now,
        )
        db.add(lease)
        await db.flush()
        leases.append(_lease_snapshot(lease, command))
    return tuple(leases)


async def mark_command_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    status: CommandStatus,
    error_code: str | None,
    error_message: str | None,
    now: datetime,
) -> CommandSnapshot | None:
    command = await db.get(CloudCommand, command_id)
    if command is None:
        return None
    command.status = status.value
    command.error_code = error_code
    command.error_message = error_message
    command.updated_at = now
    if status == CommandStatus.delivered:
        command.delivered_at = now
    if status == CommandStatus.failed_delivery:
        command.lease_expires_at = None
    await _complete_active_lease(db, command_id=command_id, worker_id=worker_id, now=now)
    await db.flush()
    return _command_snapshot(command)


async def mark_command_result(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    status: CommandStatus,
    error_code: str | None,
    error_message: str | None,
    now: datetime,
) -> CommandSnapshot | None:
    command = await db.get(CloudCommand, command_id)
    if command is None:
        return None
    command.status = status.value
    command.error_code = error_code
    command.error_message = error_message
    command.updated_at = now
    if status in {CommandStatus.accepted, CommandStatus.accepted_but_queued}:
        command.accepted_at = now
    if status == CommandStatus.rejected:
        command.rejected_at = now
    await _complete_active_lease(db, command_id=command_id, worker_id=worker_id, now=now)
    await db.flush()
    return _command_snapshot(command)


async def _next_attempt(db: AsyncSession, command_id: UUID) -> int:
    rows = await db.execute(
        select(CloudCommandLease).where(CloudCommandLease.command_id == command_id)
    )
    return len(rows.scalars().all()) + 1


async def _complete_active_lease(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    now: datetime,
) -> None:
    rows = await db.execute(
        select(CloudCommandLease).where(
            CloudCommandLease.command_id == command_id,
            CloudCommandLease.worker_id == worker_id,
            CloudCommandLease.status == CommandLeaseStatus.active.value,
        )
    )
    for lease in rows.scalars().all():
        lease.status = CommandLeaseStatus.completed.value
        lease.completed_at = now
        lease.updated_at = now


def _lease_snapshot(lease: CloudCommandLease, command: CloudCommand) -> CommandLeaseSnapshot:
    return CommandLeaseSnapshot(
        id=lease.id,
        command_id=lease.command_id,
        target_id=lease.target_id,
        worker_id=lease.worker_id,
        status=CommandLeaseStatus(lease.status),
        attempt=lease.attempt,
        leased_at=lease.leased_at,
        expires_at=lease.expires_at,
        completed_at=lease.completed_at,
        command=_command_snapshot(command),
    )


def _command_snapshot(command: CloudCommand) -> CommandSnapshot:
    return CommandSnapshot(
        id=command.id,
        idempotency_key=command.idempotency_key,
        org_id=command.org_id,
        actor_user_id=command.actor_user_id,
        actor_kind=CommandActorKind(command.actor_kind),
        source=CommandSource(command.source),
        target_id=command.target_id,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        kind=CommandKind(command.kind),
        payload=dict(command.payload),
        observed_event_seq=command.observed_event_seq,
        preconditions=dict(command.preconditions),
        status=CommandStatus(command.status),
        authorization_context=dict(command.authorization_context),
        error_code=command.error_code,
        error_message=command.error_message,
        created_at=command.created_at,
        updated_at=command.updated_at,
        leased_at=command.leased_at,
        lease_expires_at=command.lease_expires_at,
        delivered_at=command.delivered_at,
        accepted_at=command.accepted_at,
        rejected_at=command.rejected_at,
        expired_at=command.expired_at,
    )
