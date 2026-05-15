"""Cloud command persistence."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudCommandSnapshot:
    id: UUID
    idempotency_scope: str
    idempotency_key: str
    target_id: UUID
    organization_id: UUID | None
    actor_user_id: UUID | None
    actor_kind: str
    source: str
    workspace_id: str | None
    session_id: str | None
    kind: str
    payload_json: str
    observed_event_seq: int | None
    preconditions_json: str | None
    authorization_context_json: str | None
    status: str
    lease_id: str | None
    leased_by_worker_id: UUID | None
    attempt_count: int
    lease_expires_at: datetime | None
    delivered_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    expired_at: datetime | None
    error_code: str | None
    error_message: str | None
    result_json: str | None
    created_at: datetime
    updated_at: datetime


def _snapshot(row: CloudCommand) -> CloudCommandSnapshot:
    return CloudCommandSnapshot(
        id=row.id,
        idempotency_scope=row.idempotency_scope,
        idempotency_key=row.idempotency_key,
        target_id=row.target_id,
        organization_id=row.organization_id,
        actor_user_id=row.actor_user_id,
        actor_kind=row.actor_kind,
        source=row.source,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        kind=row.kind,
        payload_json=row.payload_json,
        observed_event_seq=row.observed_event_seq,
        preconditions_json=row.preconditions_json,
        authorization_context_json=row.authorization_context_json,
        status=row.status,
        lease_id=row.lease_id,
        leased_by_worker_id=row.leased_by_worker_id,
        attempt_count=row.attempt_count,
        lease_expires_at=row.lease_expires_at,
        delivered_at=row.delivered_at,
        accepted_at=row.accepted_at,
        rejected_at=row.rejected_at,
        expired_at=row.expired_at,
        error_code=row.error_code,
        error_message=row.error_message,
        result_json=row.result_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_command(
    db: AsyncSession,
    *,
    idempotency_scope: str,
    idempotency_key: str,
    target_id: UUID,
    organization_id: UUID | None,
    actor_user_id: UUID | None,
    actor_kind: str,
    source: str,
    workspace_id: str | None,
    session_id: str | None,
    kind: str,
    payload_json: str,
    observed_event_seq: int | None,
    preconditions_json: str | None,
    authorization_context_json: str | None,
) -> CloudCommandSnapshot:
    now = utcnow()
    row = CloudCommand(
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
        target_id=target_id,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_kind=actor_kind,
        source=source,
        workspace_id=workspace_id,
        session_id=session_id,
        kind=kind,
        payload_json=payload_json,
        observed_event_seq=observed_event_seq,
        preconditions_json=preconditions_json,
        authorization_context_json=authorization_context_json,
        status=CloudCommandStatus.queued.value,
        attempt_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _snapshot(row)


async def get_command_by_id(
    db: AsyncSession,
    command_id: UUID,
) -> CloudCommandSnapshot | None:
    row = await db.get(CloudCommand, command_id)
    return _snapshot(row) if row is not None else None


async def get_command_by_idempotency(
    db: AsyncSession,
    *,
    idempotency_scope: str,
    idempotency_key: str,
) -> CloudCommandSnapshot | None:
    row = (
        await db.execute(
            select(CloudCommand)
            .where(CloudCommand.idempotency_scope == idempotency_scope)
            .where(CloudCommand.idempotency_key == idempotency_key)
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def count_active_commands_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> int:
    count_value = (
        await db.execute(
            select(func.count(CloudCommand.id))
            .where(CloudCommand.target_id == target_id)
            .where(
                CloudCommand.status.in_(
                    (
                        CloudCommandStatus.queued.value,
                        CloudCommandStatus.leased.value,
                        CloudCommandStatus.delivered.value,
                    )
                )
            )
        )
    ).scalar_one()
    return int(count_value or 0)


async def expire_command_if_not_terminal(
    db: AsyncSession,
    *,
    command_id: UUID,
    error_code: str | None,
    error_message: str | None,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = (
        await db.execute(
            select(CloudCommand).where(CloudCommand.id == command_id).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if _is_terminal_status(row.status):
        return _snapshot(row)
    row.status = CloudCommandStatus.expired.value
    row.expired_at = now
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def lease_next_command(
    db: AsyncSession,
    *,
    target_id: UUID,
    worker_id: UUID,
    supported_kinds: tuple[str, ...],
    lease_id: str,
    lease_expires_at: datetime,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = (
        await db.execute(
            select(CloudCommand)
            .where(CloudCommand.target_id == target_id)
            .where(CloudCommand.kind.in_(supported_kinds))
            .where(
                or_(
                    CloudCommand.status == CloudCommandStatus.queued.value,
                    and_(
                        CloudCommand.status == CloudCommandStatus.leased.value,
                        CloudCommand.lease_expires_at.is_not(None),
                        CloudCommand.lease_expires_at <= now,
                    ),
                )
            )
            .order_by(CloudCommand.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = CloudCommandStatus.leased.value
    row.lease_id = lease_id
    row.leased_by_worker_id = worker_id
    row.lease_expires_at = lease_expires_at
    row.attempt_count += 1
    row.delivered_at = None
    row.error_code = None
    row.error_message = None
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def mark_command_delivered(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = await _get_worker_leased_command(
        db,
        command_id=command_id,
        worker_id=worker_id,
        lease_id=lease_id,
    )
    if row is None:
        return None
    if row.status == CloudCommandStatus.delivered.value:
        return _snapshot(row)
    if _is_terminal_status(row.status) or row.status != CloudCommandStatus.leased.value:
        return None
    row.status = CloudCommandStatus.delivered.value
    row.delivered_at = now
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def mark_command_failed_delivery(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    error_code: str | None,
    error_message: str | None,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = await _get_worker_leased_command(
        db,
        command_id=command_id,
        worker_id=worker_id,
        lease_id=lease_id,
    )
    if row is None:
        return None
    if _is_terminal_status(row.status):
        return _snapshot(row)
    if row.status not in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        return None
    row.status = CloudCommandStatus.failed_delivery.value
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def record_command_result(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
    status: str,
    error_code: str | None,
    error_message: str | None,
    result_json: str | None,
    now: datetime,
) -> CloudCommandSnapshot | None:
    row = await _get_worker_leased_command(
        db,
        command_id=command_id,
        worker_id=worker_id,
        lease_id=lease_id,
    )
    if row is None:
        return None
    if _is_terminal_status(row.status):
        return _snapshot(row)
    if row.status not in {
        CloudCommandStatus.leased.value,
        CloudCommandStatus.delivered.value,
    }:
        return None
    effective_status = status
    effective_error_code = error_code
    effective_error_message = error_message
    materialized_workspace_id = _materialized_workspace_id(
        kind=row.kind,
        status=status,
        result_json=result_json,
    )
    if (
        row.kind == CloudCommandKind.materialize_workspace.value
        and status
        in {
            CloudCommandStatus.accepted.value,
            CloudCommandStatus.accepted_but_queued.value,
        }
        and materialized_workspace_id is None
    ):
        effective_status = CloudCommandStatus.rejected.value
        effective_error_code = "invalid_materialize_workspace_result"
        effective_error_message = "materialize_workspace result is missing required stable fields."
    row.status = effective_status
    row.error_code = effective_error_code
    row.error_message = effective_error_message
    row.result_json = result_json
    if materialized_workspace_id is not None:
        row.workspace_id = materialized_workspace_id
    row.updated_at = now
    if effective_status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        row.accepted_at = now
        row.rejected_at = None
    elif effective_status in {
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.failed_delivery.value,
    }:
        row.rejected_at = now
    await db.flush()
    return _snapshot(row)


def _materialized_workspace_id(
    *,
    kind: str,
    status: str,
    result_json: str | None,
) -> str | None:
    if kind != CloudCommandKind.materialize_workspace.value or status not in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
    }:
        return None
    try:
        result = json.loads(result_json or "{}")
    except ValueError:
        return None
    if not isinstance(result, dict):
        return None
    mode = result.get("mode")
    if mode not in {"existing_path", "worktree"}:
        return None
    for field in ("repoRootId", "path", "kind"):
        value = result.get(field)
        if not isinstance(value, str) or not value.strip():
            return None
    workspace_id = result.get("anyharnessWorkspaceId")
    if not isinstance(workspace_id, str) or not workspace_id.strip():
        return None
    return workspace_id.strip()


def _is_terminal_status(status: str) -> bool:
    return status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }


async def _get_worker_leased_command(
    db: AsyncSession,
    *,
    command_id: UUID,
    worker_id: UUID,
    lease_id: str,
) -> CloudCommand | None:
    return (
        await db.execute(
            select(CloudCommand)
            .where(CloudCommand.id == command_id)
            .where(CloudCommand.leased_by_worker_id == worker_id)
            .where(CloudCommand.lease_id == lease_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
