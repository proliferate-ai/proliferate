"""Cloud command persistence."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudCommandKind,
    CloudCommandStatus,
)
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.store.cloud_sync import worker_control
from proliferate.db.store.cloud_sync.command_records import (
    CloudCommandSnapshot,
    is_terminal_status,
    snapshot_command,
)
from proliferate.db.store.cloud_sync.command_scope import (
    target_is_managed_cloud,
)
from proliferate.utils.time import utcnow

ARCHIVE_SUPERSEDED_COMMAND_KINDS: frozenset[str] = frozenset(
    (
        CloudCommandKind.start_session.value,
        CloudCommandKind.send_prompt.value,
        CloudCommandKind.decide_plan.value,
        CloudCommandKind.resolve_interaction.value,
        CloudCommandKind.update_session_config.value,
        CloudCommandKind.cancel_turn.value,
        CloudCommandKind.close_session.value,
        CloudCommandKind.materialize_workspace.value,
        CloudCommandKind.backfill_exposed_workspace.value,
    )
)

SUPERSEDABLE_COMMAND_STATUSES: tuple[str, ...] = (
    CloudCommandStatus.queued.value,
    CloudCommandStatus.leased.value,
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
    cloud_workspace_id: UUID | None,
    kind: str,
    payload_json: str,
    observed_event_seq: int | None,
    preconditions_json: str | None,
    authorization_context_json: str | None,
) -> CloudCommandSnapshot:
    now = utcnow()
    target = await db.get(CloudTarget, target_id)
    if (
        kind
        in {
            CloudCommandKind.materialize_workspace.value,
            CloudCommandKind.backfill_exposed_workspace.value,
        }
        and target_is_managed_cloud(target)
        and cloud_workspace_id is None
    ):
        raise RuntimeError(f"Managed {kind} commands require cloud_workspace_id.")
    if kind == CloudCommandKind.backfill_exposed_workspace.value and cloud_workspace_id is None:
        raise RuntimeError("backfill_exposed_workspace commands require cloud_workspace_id.")
    row = CloudCommand(
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
        target_id=target_id,
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_kind=actor_kind,
        source=source,
        workspace_id=workspace_id,
        cloud_workspace_id=cloud_workspace_id,
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
    await worker_control.bump_control_revision(db, target_id=target_id, now=now)
    return snapshot_command(row)


async def get_command_by_id(
    db: AsyncSession,
    command_id: UUID,
) -> CloudCommandSnapshot | None:
    row = await db.get(CloudCommand, command_id)
    return snapshot_command(row) if row is not None else None


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
    return snapshot_command(row) if row is not None else None


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
    eligible_statuses: tuple[str, ...] | None = None,
) -> CloudCommandSnapshot | None:
    row = (
        await db.execute(
            select(CloudCommand).where(CloudCommand.id == command_id).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if is_terminal_status(row.status):
        return snapshot_command(row)
    if eligible_statuses is not None and row.status not in eligible_statuses:
        return snapshot_command(row)
    row.status = CloudCommandStatus.expired.value
    row.expired_at = now
    row.error_code = error_code
    row.error_message = error_message
    row.updated_at = now
    await db.flush()
    await worker_control.bump_control_revision(db, target_id=row.target_id, now=now)
    return snapshot_command(row)


async def expire_stale_queued_commands(
    db: AsyncSession,
    *,
    target_id: UUID | None = None,
    source: str | None = None,
    command_kinds: frozenset[str] | tuple[str, ...] | None = None,
    older_than: datetime,
    error_code: str,
    error_message: str,
    now: datetime,
) -> tuple[CloudCommandSnapshot, ...]:
    query = select(CloudCommand).where(
        or_(
            and_(
                CloudCommand.status == CloudCommandStatus.queued.value,
                CloudCommand.created_at <= older_than,
            ),
            and_(
                CloudCommand.status == CloudCommandStatus.leased.value,
                CloudCommand.created_at <= older_than,
                CloudCommand.lease_expires_at.is_not(None),
                CloudCommand.lease_expires_at <= now,
            ),
            and_(
                CloudCommand.status == CloudCommandStatus.delivered.value,
                CloudCommand.created_at <= older_than,
                CloudCommand.lease_expires_at.is_not(None),
                CloudCommand.lease_expires_at <= now,
            ),
        )
    )
    if target_id is not None:
        query = query.where(CloudCommand.target_id == target_id)
    if source is not None:
        query = query.where(CloudCommand.source == source)
    if command_kinds is not None:
        query = query.where(CloudCommand.kind.in_(tuple(command_kinds)))
    rows = list(
        (
            await db.execute(
                query.with_for_update().order_by(
                    CloudCommand.created_at.asc(), CloudCommand.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.status = CloudCommandStatus.expired.value
        row.expired_at = now
        row.error_code = error_code
        row.error_message = error_message
        row.updated_at = now
    await db.flush()
    for expired_target_id in {row.target_id for row in rows}:
        await worker_control.bump_control_revision(db, target_id=expired_target_id, now=now)
    return tuple(snapshot_command(row) for row in rows)


async def supersede_workspace_commands(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    reason_code: str,
    reason_message: str,
    command_kinds: frozenset[str] | tuple[str, ...] | None = ARCHIVE_SUPERSEDED_COMMAND_KINDS,
    now: datetime | None = None,
) -> tuple[CloudCommandSnapshot, ...]:
    """Terminally supersede queued/leased commands for a workspace lifecycle change."""

    marked_at = now or utcnow()
    query = (
        select(CloudCommand)
        .where(CloudCommand.cloud_workspace_id == cloud_workspace_id)
        .where(CloudCommand.status.in_(SUPERSEDABLE_COMMAND_STATUSES))
    )
    if command_kinds is not None:
        query = query.where(CloudCommand.kind.in_(tuple(command_kinds)))
    rows = list(
        (
            await db.execute(
                query.with_for_update().order_by(
                    CloudCommand.created_at.asc(), CloudCommand.id.asc()
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.status = CloudCommandStatus.superseded.value
        row.error_code = reason_code
        row.error_message = reason_message
        row.lease_expires_at = None
        row.updated_at = marked_at
    await db.flush()
    for superseded_target_id in {row.target_id for row in rows}:
        await worker_control.bump_control_revision(
            db,
            target_id=superseded_target_id,
            now=marked_at,
        )
    return tuple(snapshot_command(row) for row in rows)
