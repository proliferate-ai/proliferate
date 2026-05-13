"""Persistence helpers for cloud artifact references."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.artifacts import CloudArtifactRef


class ArtifactRetentionState(StrEnum):
    active = "active"
    pinned = "pinned"
    expired = "expired"
    deleted = "deleted"


@dataclass(frozen=True)
class ArtifactRefSnapshot:
    id: UUID
    org_id: UUID
    target_id: UUID | None
    workspace_id: UUID | None
    session_id: UUID | None
    event_id: UUID | None
    artifact_kind: str
    content_type: str | None
    byte_size: int | None
    storage_url: str | None
    storage_key: str | None
    metadata_json: dict[str, object]
    retention_state: ArtifactRetentionState
    retention_expires_at: datetime | None
    pinned: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


async def create_artifact_ref(
    db: AsyncSession,
    *,
    org_id: UUID,
    target_id: UUID | None,
    workspace_id: UUID | None,
    session_id: UUID | None,
    event_id: UUID | None,
    artifact_kind: str,
    content_type: str | None,
    byte_size: int | None,
    storage_url: str | None,
    storage_key: str | None,
    metadata_json: dict[str, object],
    retention_expires_at: datetime | None,
    pinned: bool,
    now: datetime,
) -> ArtifactRefSnapshot:
    record = CloudArtifactRef(
        org_id=org_id,
        target_id=target_id,
        workspace_id=workspace_id,
        session_id=session_id,
        event_id=event_id,
        artifact_kind=artifact_kind,
        content_type=content_type,
        byte_size=byte_size,
        storage_url=storage_url,
        storage_key=storage_key,
        metadata_json=metadata_json,
        retention_state=(
            ArtifactRetentionState.pinned.value if pinned else ArtifactRetentionState.active.value
        ),
        retention_expires_at=retention_expires_at,
        pinned=pinned,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    await db.flush()
    return _artifact_ref_snapshot(record)


async def list_workspace_artifact_refs(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    session_id: UUID | None,
    limit: int,
) -> tuple[ArtifactRefSnapshot, ...]:
    stmt = select(CloudArtifactRef).where(
        CloudArtifactRef.workspace_id == workspace_id,
        CloudArtifactRef.deleted_at.is_(None),
    )
    if session_id is not None:
        stmt = stmt.where(CloudArtifactRef.session_id == session_id)
    rows = await db.execute(stmt.order_by(CloudArtifactRef.created_at.desc()).limit(limit))
    return tuple(_artifact_ref_snapshot(record) for record in rows.scalars().all())


def _artifact_ref_snapshot(record: CloudArtifactRef) -> ArtifactRefSnapshot:
    return ArtifactRefSnapshot(
        id=record.id,
        org_id=record.org_id,
        target_id=record.target_id,
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        event_id=record.event_id,
        artifact_kind=record.artifact_kind,
        content_type=record.content_type,
        byte_size=record.byte_size,
        storage_url=record.storage_url,
        storage_key=record.storage_key,
        metadata_json=dict(record.metadata_json),
        retention_state=ArtifactRetentionState(record.retention_state),
        retention_expires_at=record.retention_expires_at,
        pinned=record.pinned,
        created_at=record.created_at,
        updated_at=record.updated_at,
        deleted_at=record.deleted_at,
    )
