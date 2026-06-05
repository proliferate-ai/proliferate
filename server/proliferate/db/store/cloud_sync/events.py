"""Cloud session-event ingestion persistence."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.sync import (
    CloudEventIngestState,
    CloudSessionEvent,
    CloudSessionProjection,
    CloudSyncedWorkspace,
)
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class InsertSessionEvent:
    target_id: UUID
    worker_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    seq: int
    event_type: str
    source_kind: str
    turn_id: str | None
    item_id: str | None
    occurred_at: str | None
    payload_json: str | None
    payload_hash: str
    payload_size_bytes: int
    payload_truncated_at_bytes: int | None


@dataclass(frozen=True)
class CloudSessionEventSnapshot:
    id: UUID
    target_id: UUID
    worker_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    seq: int
    event_type: str
    source_kind: str
    turn_id: str | None
    item_id: str | None
    occurred_at: str | None
    payload_json: str | None
    payload_hash: str
    payload_size_bytes: int
    payload_truncated_at_bytes: int | None
    created_at: datetime


def _event_snapshot(row: CloudSessionEvent) -> CloudSessionEventSnapshot:
    return CloudSessionEventSnapshot(
        id=row.id,
        target_id=row.target_id,
        worker_id=row.worker_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        seq=row.anyharness_seq,
        event_type=row.event_type,
        source_kind=row.source_kind,
        turn_id=row.turn_id,
        item_id=row.item_id,
        occurred_at=row.occurred_at,
        payload_json=row.payload_json,
        payload_hash=row.payload_hash,
        payload_size_bytes=row.payload_size_bytes,
        payload_truncated_at_bytes=row.payload_truncated_at_bytes,
        created_at=row.created_at,
    )


async def resolve_cloud_workspace_id(
    db: AsyncSession,
    *,
    target_id: UUID,
    workspace_id: str | None,
) -> UUID | None:
    if not workspace_id:
        return None
    synced_row = (
        await db.execute(
            select(CloudSyncedWorkspace.cloud_workspace_id)
            .where(CloudSyncedWorkspace.target_id == target_id)
            .where(CloudSyncedWorkspace.workspace_id == workspace_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if synced_row is not None:
        return synced_row
    direct_row = (
        await db.execute(
            select(CloudWorkspace.id)
            .where(CloudWorkspace.target_id == target_id)
            .where(CloudWorkspace.anyharness_workspace_id == workspace_id)
            .where(CloudWorkspace.archived_at.is_(None))
            .order_by(CloudWorkspace.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if direct_row is not None:
        return direct_row
    row = (
        await db.execute(
            select(CloudWorkspace.id)
            .join(
                CloudRuntimeEnvironment,
                CloudRuntimeEnvironment.id == CloudWorkspace.runtime_environment_id,
            )
            .where(CloudRuntimeEnvironment.target_id == target_id)
            .where(CloudWorkspace.anyharness_workspace_id == workspace_id)
            .where(CloudWorkspace.archived_at.is_(None))
            .order_by(CloudWorkspace.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


async def get_ingest_cursor(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> int:
    row = await db.get(CloudEventIngestState, {"target_id": target_id, "session_id": session_id})
    return int(row.last_contiguous_seq) if row is not None else 0


async def upsert_ingest_cursor(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    worker_id: UUID | None,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    last_contiguous_seq: int,
) -> int:
    now = utcnow()
    row = await db.get(CloudEventIngestState, {"target_id": target_id, "session_id": session_id})
    if row is None:
        row = CloudEventIngestState(
            target_id=target_id,
            session_id=session_id,
            worker_id=worker_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            last_contiguous_seq=max(0, last_contiguous_seq),
            updated_at=now,
        )
        db.add(row)
    else:
        row.worker_id = worker_id
        row.cloud_workspace_id = cloud_workspace_id or row.cloud_workspace_id
        row.workspace_id = workspace_id or row.workspace_id
        row.last_contiguous_seq = max(row.last_contiguous_seq, last_contiguous_seq)
        row.updated_at = now
    projection = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.session_id == session_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if projection is not None:
        projection.last_uploaded_seq = max(
            projection.last_uploaded_seq or 0,
            row.last_contiguous_seq,
        )
        if _gap_state_repaired(projection.gap_state_json, row.last_contiguous_seq):
            projection.gap_state_json = None
        projection.updated_at = now
    await db.flush()
    return int(row.last_contiguous_seq)


def _gap_state_repaired(gap_state_json: str | None, last_contiguous_seq: int) -> bool:
    if gap_state_json is None:
        return False
    try:
        parsed = json.loads(gap_state_json)
    except ValueError:
        return last_contiguous_seq > 0
    if not isinstance(parsed, dict):
        return last_contiguous_seq > 0
    expected_seq = parsed.get("expectedSeq")
    if not isinstance(expected_seq, int) or isinstance(expected_seq, bool):
        return last_contiguous_seq > 0
    return last_contiguous_seq >= expected_seq


async def get_session_event_usage(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> tuple[int, int]:
    count_value, bytes_value = (
        await db.execute(
            select(
                func.count(CloudSessionEvent.id),
                func.coalesce(func.sum(CloudSessionEvent.payload_size_bytes), 0),
            )
            .where(CloudSessionEvent.target_id == target_id)
            .where(CloudSessionEvent.session_id == session_id)
        )
    ).one()
    return int(count_value or 0), int(bytes_value or 0)


async def insert_event_if_new(
    db: AsyncSession,
    event: InsertSessionEvent,
) -> tuple[CloudSessionEventSnapshot | None, bool, bool]:
    existing = (
        await db.execute(
            select(CloudSessionEvent)
            .where(CloudSessionEvent.target_id == event.target_id)
            .where(CloudSessionEvent.session_id == event.session_id)
            .where(CloudSessionEvent.anyharness_seq == event.seq)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _event_snapshot(existing), False, existing.payload_hash == event.payload_hash
    row = CloudSessionEvent(
        target_id=event.target_id,
        worker_id=event.worker_id,
        cloud_workspace_id=event.cloud_workspace_id,
        workspace_id=event.workspace_id,
        session_id=event.session_id,
        anyharness_seq=event.seq,
        event_type=event.event_type,
        source_kind=event.source_kind,
        turn_id=event.turn_id,
        item_id=event.item_id,
        occurred_at=event.occurred_at,
        payload_json=event.payload_json,
        payload_hash=event.payload_hash,
        payload_ref=None,
        payload_size_bytes=event.payload_size_bytes,
        payload_truncated_at_bytes=event.payload_truncated_at_bytes,
        created_at=utcnow(),
    )
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        existing = (
            await db.execute(
                select(CloudSessionEvent)
                .where(CloudSessionEvent.target_id == event.target_id)
                .where(CloudSessionEvent.session_id == event.session_id)
                .where(CloudSessionEvent.anyharness_seq == event.seq)
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return _event_snapshot(existing), False, existing.payload_hash == event.payload_hash
    return _event_snapshot(row), True, True


async def list_events_after(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    after_seq: int,
    limit: int = 200,
) -> tuple[CloudSessionEventSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudSessionEvent)
            .where(CloudSessionEvent.target_id == target_id)
            .where(CloudSessionEvent.session_id == session_id)
            .where(CloudSessionEvent.anyharness_seq > after_seq)
            .order_by(CloudSessionEvent.anyharness_seq.asc())
            .limit(limit)
        )
    ).scalars()
    return tuple(_event_snapshot(row) for row in rows)
