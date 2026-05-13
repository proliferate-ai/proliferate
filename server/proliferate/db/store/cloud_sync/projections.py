"""Persistence helpers for cloud projection snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.projections import CloudProjectionSnapshot


class ProjectionKind(StrEnum):
    workspace = "workspace"
    session = "session"
    transcript = "transcript"
    target = "target"


@dataclass(frozen=True)
class ProjectionSnapshot:
    id: UUID
    org_id: UUID
    projection_kind: ProjectionKind
    projection_id: UUID
    target_id: UUID | None
    workspace_id: UUID | None
    session_id: UUID | None
    last_event_seq: int
    snapshot: dict[str, object]
    created_at: datetime
    updated_at: datetime


async def upsert_projection_snapshot(
    db: AsyncSession,
    *,
    org_id: UUID,
    projection_kind: ProjectionKind,
    projection_id: UUID,
    target_id: UUID | None,
    workspace_id: UUID | None,
    session_id: UUID | None,
    last_event_seq: int,
    snapshot: dict[str, object],
    now: datetime,
) -> ProjectionSnapshot:
    record = (
        await db.execute(
            select(CloudProjectionSnapshot).where(
                CloudProjectionSnapshot.projection_kind == projection_kind.value,
                CloudProjectionSnapshot.projection_id == projection_id,
            )
        )
    ).scalar_one_or_none()
    if record is None:
        record = CloudProjectionSnapshot(
            org_id=org_id,
            projection_kind=projection_kind.value,
            projection_id=projection_id,
            target_id=target_id,
            workspace_id=workspace_id,
            session_id=session_id,
            created_at=now,
        )
        db.add(record)
    record.org_id = org_id
    record.target_id = target_id
    record.workspace_id = workspace_id
    record.session_id = session_id
    record.last_event_seq = max(record.last_event_seq, last_event_seq)
    record.snapshot = snapshot
    record.updated_at = now
    await db.flush()
    return _projection_snapshot(record)


async def get_projection_snapshot(
    db: AsyncSession,
    *,
    projection_kind: ProjectionKind,
    projection_id: UUID,
) -> ProjectionSnapshot | None:
    record = (
        await db.execute(
            select(CloudProjectionSnapshot).where(
                CloudProjectionSnapshot.projection_kind == projection_kind.value,
                CloudProjectionSnapshot.projection_id == projection_id,
            )
        )
    ).scalar_one_or_none()
    if record is None:
        return None
    return _projection_snapshot(record)


async def list_projection_snapshots(
    db: AsyncSession,
    *,
    org_id: UUID,
    projection_kind: ProjectionKind,
    limit: int,
) -> tuple[ProjectionSnapshot, ...]:
    rows = await db.execute(
        select(CloudProjectionSnapshot)
        .where(
            CloudProjectionSnapshot.org_id == org_id,
            CloudProjectionSnapshot.projection_kind == projection_kind.value,
        )
        .order_by(CloudProjectionSnapshot.updated_at.desc())
        .limit(limit)
    )
    return tuple(_projection_snapshot(record) for record in rows.scalars().all())


def _projection_snapshot(record: CloudProjectionSnapshot) -> ProjectionSnapshot:
    return ProjectionSnapshot(
        id=record.id,
        org_id=record.org_id,
        projection_kind=ProjectionKind(record.projection_kind),
        projection_id=record.projection_id,
        target_id=record.target_id,
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        last_event_seq=record.last_event_seq,
        snapshot=dict(record.snapshot),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )
