"""Persistence helpers for normalized cloud session events."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.events import CloudSessionEvent


class EventSourceKind(StrEnum):
    user = "user"
    assistant = "assistant"
    tool = "tool"
    system = "system"
    worker = "worker"
    target = "target"


@dataclass(frozen=True)
class SessionEventInsert:
    org_id: UUID
    target_id: UUID
    workspace_id: UUID | None
    session_id: UUID
    anyharness_event_id: str | None
    anyharness_sequence: int
    event_type: str
    schema_version: int
    source_kind: EventSourceKind
    actor_user_id: UUID | None
    actor_external_id: str | None
    created_at: datetime
    payload: dict[str, object] | None
    payload_ref: str | None
    payload_size_bytes: int
    payload_hash: str
    dedupe_key: str
    ingested_at: datetime


@dataclass(frozen=True)
class SessionEventSnapshot:
    id: UUID
    org_id: UUID
    target_id: UUID
    workspace_id: UUID | None
    session_id: UUID
    anyharness_event_id: str | None
    anyharness_sequence: int
    event_type: str
    schema_version: int
    source_kind: EventSourceKind
    actor_user_id: UUID | None
    actor_external_id: str | None
    created_at: datetime
    ingested_at: datetime
    payload: dict[str, object] | None
    payload_ref: str | None
    payload_size_bytes: int
    payload_hash: str
    dedupe_key: str


@dataclass(frozen=True)
class AppendEventsResult:
    inserted_events: tuple[SessionEventSnapshot, ...]
    duplicate_count: int
    conflict_count: int


async def append_session_events(
    db: AsyncSession,
    *,
    events: tuple[SessionEventInsert, ...],
) -> AppendEventsResult:
    inserted: list[SessionEventSnapshot] = []
    duplicate_count = 0
    conflict_count = 0
    for event in events:
        existing = (
            await db.execute(
                select(CloudSessionEvent).where(
                    CloudSessionEvent.target_id == event.target_id,
                    CloudSessionEvent.session_id == event.session_id,
                    CloudSessionEvent.anyharness_sequence == event.anyharness_sequence,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.payload_hash == event.payload_hash:
                duplicate_count += 1
            else:
                conflict_count += 1
            continue

        record = CloudSessionEvent(
            org_id=event.org_id,
            target_id=event.target_id,
            workspace_id=event.workspace_id,
            session_id=event.session_id,
            anyharness_event_id=event.anyharness_event_id,
            anyharness_sequence=event.anyharness_sequence,
            event_type=event.event_type,
            schema_version=event.schema_version,
            source_kind=event.source_kind.value,
            actor_user_id=event.actor_user_id,
            actor_external_id=event.actor_external_id,
            payload=event.payload,
            payload_ref=event.payload_ref,
            payload_size_bytes=event.payload_size_bytes,
            payload_hash=event.payload_hash,
            dedupe_key=event.dedupe_key,
            created_at=event.created_at,
            ingested_at=event.ingested_at,
        )
        db.add(record)
        await db.flush()
        inserted.append(_event_snapshot(record))
    return AppendEventsResult(
        inserted_events=tuple(inserted),
        duplicate_count=duplicate_count,
        conflict_count=conflict_count,
    )


async def list_session_events(
    db: AsyncSession,
    *,
    session_id: UUID,
    after_sequence: int | None,
    limit: int,
) -> tuple[SessionEventSnapshot, ...]:
    stmt = select(CloudSessionEvent).where(CloudSessionEvent.session_id == session_id)
    if after_sequence is not None:
        stmt = stmt.where(CloudSessionEvent.anyharness_sequence > after_sequence)
    rows = await db.execute(
        stmt.order_by(CloudSessionEvent.anyharness_sequence.asc()).limit(limit)
    )
    return tuple(_event_snapshot(record) for record in rows.scalars().all())


def _event_snapshot(record: CloudSessionEvent) -> SessionEventSnapshot:
    return SessionEventSnapshot(
        id=record.id,
        org_id=record.org_id,
        target_id=record.target_id,
        workspace_id=record.workspace_id,
        session_id=record.session_id,
        anyharness_event_id=record.anyharness_event_id,
        anyharness_sequence=record.anyharness_sequence,
        event_type=record.event_type,
        schema_version=record.schema_version,
        source_kind=EventSourceKind(record.source_kind),
        actor_user_id=record.actor_user_id,
        actor_external_id=record.actor_external_id,
        created_at=record.created_at,
        ingested_at=record.ingested_at,
        payload=dict(record.payload) if record.payload is not None else None,
        payload_ref=record.payload_ref,
        payload_size_bytes=record.payload_size_bytes,
        payload_hash=record.payload_hash,
        dedupe_key=record.dedupe_key,
    )
