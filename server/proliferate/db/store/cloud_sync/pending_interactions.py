"""Cloud pending interaction persistence."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sync import CloudPendingInteraction
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudPendingInteractionSnapshot:
    id: UUID
    target_id: UUID
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    request_id: str
    kind: str | None
    status: str
    title: str | None
    description: str | None
    payload_json: str | None
    requested_seq: int
    resolved_seq: int | None
    requested_at: str | None
    resolved_at: str | None


def _interaction_snapshot(row: CloudPendingInteraction) -> CloudPendingInteractionSnapshot:
    return CloudPendingInteractionSnapshot(
        id=row.id,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        request_id=row.request_id,
        kind=row.kind,
        status=row.status,
        title=row.title,
        description=row.description,
        payload_json=row.payload_json,
        requested_seq=row.requested_seq,
        resolved_seq=row.resolved_seq,
        requested_at=row.requested_at,
        resolved_at=row.resolved_at,
    )


async def upsert_pending_interaction(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    session_id: str,
    request_id: str,
    seq: int,
    occurred_at: str | None,
    kind: str | None,
    title: str | None,
    description: str | None,
    payload_json: str | None,
) -> CloudPendingInteractionSnapshot:
    now = utcnow()
    row = (
        await db.execute(
            select(CloudPendingInteraction)
            .where(CloudPendingInteraction.target_id == target_id)
            .where(CloudPendingInteraction.session_id == session_id)
            .where(CloudPendingInteraction.request_id == request_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudPendingInteraction(
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            session_id=session_id,
            request_id=request_id,
            kind=kind,
            status="pending",
            title=title,
            description=description,
            payload_json=payload_json,
            requested_seq=seq,
            resolved_seq=None,
            requested_at=occurred_at,
            resolved_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        if row.status == "resolved":
            return _interaction_snapshot(row)
        row.cloud_workspace_id = cloud_workspace_id or row.cloud_workspace_id
        row.workspace_id = workspace_id or row.workspace_id
        row.kind = kind or row.kind
        row.status = "pending"
        row.title = title if title is not None else row.title
        row.description = description if description is not None else row.description
        row.payload_json = payload_json if payload_json is not None else row.payload_json
        row.requested_seq = min(row.requested_seq, seq)
        row.requested_at = row.requested_at or occurred_at
        row.updated_at = now
    await db.flush()
    return _interaction_snapshot(row)


async def resolve_pending_interaction(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    request_id: str,
    seq: int,
    occurred_at: str | None,
    payload_json: str | None,
) -> CloudPendingInteractionSnapshot | None:
    row = (
        await db.execute(
            select(CloudPendingInteraction)
            .where(CloudPendingInteraction.target_id == target_id)
            .where(CloudPendingInteraction.session_id == session_id)
            .where(CloudPendingInteraction.request_id == request_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudPendingInteraction(
            target_id=target_id,
            cloud_workspace_id=None,
            workspace_id=None,
            session_id=session_id,
            request_id=request_id,
            kind=None,
            status="resolved",
            title=None,
            description=None,
            payload_json=payload_json,
            requested_seq=seq,
            resolved_seq=seq,
            requested_at=None,
            resolved_at=occurred_at,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(row)
        await db.flush()
        return _interaction_snapshot(row)
    row.status = "resolved"
    row.resolved_seq = seq
    row.resolved_at = occurred_at
    row.payload_json = payload_json if payload_json is not None else row.payload_json
    row.updated_at = utcnow()
    await db.flush()
    return _interaction_snapshot(row)


async def resolve_existing_pending_interaction(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    request_id: str,
    seq: int,
    occurred_at: str | None,
    payload_json: str | None,
) -> CloudPendingInteractionSnapshot | None:
    row = (
        await db.execute(
            select(CloudPendingInteraction)
            .where(CloudPendingInteraction.target_id == target_id)
            .where(CloudPendingInteraction.session_id == session_id)
            .where(CloudPendingInteraction.request_id == request_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "resolved"
    row.resolved_seq = seq
    row.resolved_at = occurred_at
    row.payload_json = payload_json if payload_json is not None else row.payload_json
    row.updated_at = utcnow()
    await db.flush()
    return _interaction_snapshot(row)


async def fail_existing_pending_interaction(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    request_id: str,
    occurred_at: str | None,
    description: str | None,
    payload_json: str | None,
) -> CloudPendingInteractionSnapshot | None:
    row = (
        await db.execute(
            select(CloudPendingInteraction)
            .where(CloudPendingInteraction.target_id == target_id)
            .where(CloudPendingInteraction.session_id == session_id)
            .where(CloudPendingInteraction.request_id == request_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.status == "resolved":
        return _interaction_snapshot(row)
    row.status = "failed"
    row.description = description if description is not None else row.description
    row.payload_json = payload_json if payload_json is not None else row.payload_json
    row.resolved_at = occurred_at
    row.updated_at = utcnow()
    await db.flush()
    return _interaction_snapshot(row)


async def resolve_missing_pending_interactions(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    active_request_ids: tuple[str, ...],
    seq: int,
    occurred_at: str | None,
) -> None:
    query = (
        select(CloudPendingInteraction)
        .where(CloudPendingInteraction.target_id == target_id)
        .where(CloudPendingInteraction.session_id == session_id)
        .where(CloudPendingInteraction.status == "pending")
    )
    if active_request_ids:
        query = query.where(CloudPendingInteraction.request_id.not_in(active_request_ids))
    rows = (await db.execute(query)).scalars()
    now = utcnow()
    for row in rows:
        row.status = "resolved"
        row.resolved_seq = seq
        row.resolved_at = occurred_at
        row.updated_at = now
    await db.flush()


async def list_pending_interactions(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> tuple[CloudPendingInteractionSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudPendingInteraction)
            .where(CloudPendingInteraction.target_id == target_id)
            .where(CloudPendingInteraction.session_id == session_id)
            .where(CloudPendingInteraction.status.in_(("pending", "failed")))
            .order_by(CloudPendingInteraction.requested_seq.asc())
        )
    ).scalars()
    return tuple(_interaction_snapshot(row) for row in rows)
