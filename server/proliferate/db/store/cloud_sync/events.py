"""Persistence helpers for cloud synced events and cursors."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.events import CloudEventIngestCursor, CloudSessionEvent
from proliferate.db.store.cloud_sync.json import JsonObject, decode_object, encode_object
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class EventRecord:
    id: UUID
    org_id: UUID
    target_id: UUID
    workspace_id: UUID | None
    session_id: str
    anyharness_sequence: int
    event_type: str
    schema_version: str
    source_kind: str
    created_at: datetime
    payload: dict[str, object]
    payload_ref: str | None


@dataclass(frozen=True)
class AppendEventResult:
    event: EventRecord
    inserted: bool


def _event_record(event: CloudSessionEvent) -> EventRecord:
    return EventRecord(
        id=event.id,
        org_id=event.org_id,
        target_id=event.target_id,
        workspace_id=event.workspace_id,
        session_id=event.session_id,
        anyharness_sequence=event.anyharness_sequence,
        event_type=event.event_type,
        schema_version=event.schema_version,
        source_kind=event.source_kind,
        created_at=event.created_at,
        payload=decode_object(event.payload_json),
        payload_ref=event.payload_ref,
    )


async def append_event(
    db: AsyncSession,
    *,
    org_id: UUID,
    target_id: UUID,
    workspace_id: UUID | None,
    session_id: str,
    anyharness_event_id: str | None,
    anyharness_sequence: int,
    event_type: str,
    schema_version: str,
    source_kind: str,
    actor_user_id: UUID | None,
    actor_external_id: str | None,
    created_at: datetime,
    payload: JsonObject,
    payload_ref: str | None,
    payload_size_bytes: int,
    payload_hash: str | None,
) -> AppendEventResult:
    dedupe_key = f"{target_id}:{session_id}:{anyharness_sequence}"
    existing = (
        await db.execute(
            select(CloudSessionEvent).where(
                CloudSessionEvent.target_id == target_id,
                CloudSessionEvent.session_id == session_id,
                CloudSessionEvent.anyharness_sequence == anyharness_sequence,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return AppendEventResult(event=_event_record(existing), inserted=False)

    event = CloudSessionEvent(
        org_id=org_id,
        target_id=target_id,
        workspace_id=workspace_id,
        session_id=session_id,
        anyharness_event_id=anyharness_event_id,
        anyharness_sequence=anyharness_sequence,
        event_type=event_type,
        schema_version=schema_version,
        source_kind=source_kind,
        actor_user_id=actor_user_id,
        actor_external_id=actor_external_id,
        created_at=created_at,
        payload_json=encode_object(payload),
        payload_ref=payload_ref,
        payload_size_bytes=payload_size_bytes,
        payload_hash=payload_hash,
        dedupe_key=dedupe_key,
    )
    db.add(event)
    await db.flush()
    await advance_cursor(
        db,
        target_id=target_id,
        workspace_id=workspace_id,
        session_id=session_id,
        sequence=anyharness_sequence,
    )
    return AppendEventResult(event=_event_record(event), inserted=True)


async def list_session_events_after(
    db: AsyncSession,
    *,
    session_id: str,
    after_sequence: int = 0,
    limit: int = 200,
) -> tuple[EventRecord, ...]:
    rows = await db.execute(
        select(CloudSessionEvent)
        .where(
            CloudSessionEvent.session_id == session_id,
            CloudSessionEvent.anyharness_sequence > after_sequence,
        )
        .order_by(CloudSessionEvent.anyharness_sequence.asc())
        .limit(limit)
    )
    return tuple(_event_record(row) for row in rows.scalars().all())


async def advance_cursor(
    db: AsyncSession,
    *,
    target_id: UUID,
    workspace_id: UUID | None,
    session_id: str,
    sequence: int,
) -> None:
    cursor = (
        await db.execute(
            select(CloudEventIngestCursor).where(
                CloudEventIngestCursor.target_id == target_id,
                CloudEventIngestCursor.session_id == session_id,
            )
        )
    ).scalar_one_or_none()
    if cursor is None:
        cursor = CloudEventIngestCursor(
            target_id=target_id,
            workspace_id=workspace_id,
            session_id=session_id,
        )
        db.add(cursor)
    cursor.highest_seen_sequence = max(cursor.highest_seen_sequence, sequence)
    if sequence == cursor.last_contiguous_sequence + 1:
        cursor.last_contiguous_sequence = sequence
    cursor.updated_at = utcnow()
    await db.flush()
