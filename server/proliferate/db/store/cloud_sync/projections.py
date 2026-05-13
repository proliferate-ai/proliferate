"""Persistence helpers for cloud read-model projections."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.projections import CloudProjectionSnapshot
from proliferate.db.store.cloud_sync.json import JsonObject, decode_object, encode_object


@dataclass(frozen=True)
class ProjectionRecord:
    id: UUID
    org_id: UUID
    projection_kind: str
    projection_id: str
    target_id: UUID | None
    workspace_id: UUID | None
    session_id: str | None
    cursor: str | None
    snapshot: dict[str, object]
    updated_at: datetime


def _projection_record(projection: CloudProjectionSnapshot) -> ProjectionRecord:
    return ProjectionRecord(
        id=projection.id,
        org_id=projection.org_id,
        projection_kind=projection.projection_kind,
        projection_id=projection.projection_id,
        target_id=projection.target_id,
        workspace_id=projection.workspace_id,
        session_id=projection.session_id,
        cursor=projection.cursor,
        snapshot=decode_object(projection.snapshot_json),
        updated_at=projection.updated_at,
    )


async def upsert_projection(
    db: AsyncSession,
    *,
    org_id: UUID,
    projection_kind: str,
    projection_id: str,
    snapshot: JsonObject,
    cursor: str | None,
    target_id: UUID | None = None,
    workspace_id: UUID | None = None,
    session_id: str | None = None,
) -> ProjectionRecord:
    projection = (
        await db.execute(
            select(CloudProjectionSnapshot).where(
                CloudProjectionSnapshot.projection_kind == projection_kind,
                CloudProjectionSnapshot.projection_id == projection_id,
            )
        )
    ).scalar_one_or_none()
    if projection is None:
        projection = CloudProjectionSnapshot(
            org_id=org_id,
            projection_kind=projection_kind,
            projection_id=projection_id,
        )
        db.add(projection)
    projection.target_id = target_id
    projection.workspace_id = workspace_id
    projection.session_id = session_id
    projection.cursor = cursor
    projection.snapshot_json = encode_object(snapshot)
    await db.flush()
    return _projection_record(projection)


async def get_projection(
    db: AsyncSession,
    *,
    projection_kind: str,
    projection_id: str,
) -> ProjectionRecord | None:
    projection = (
        await db.execute(
            select(CloudProjectionSnapshot).where(
                CloudProjectionSnapshot.projection_kind == projection_kind,
                CloudProjectionSnapshot.projection_id == projection_id,
            )
        )
    ).scalar_one_or_none()
    if projection is None:
        return None
    return _projection_record(projection)
