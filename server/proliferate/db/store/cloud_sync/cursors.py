"""Persistence helpers for cloud event ingest cursors."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.events import CloudEventIngestCursor


class CursorStatus(StrEnum):
    current = "current"
    gap = "gap"
    degraded = "degraded"


@dataclass(frozen=True)
class EventIngestCursorSnapshot:
    target_id: UUID
    workspace_id: UUID
    session_id: UUID
    contiguous_sequence: int
    highest_seen_sequence: int
    cursor_status: CursorStatus
    gap_ranges: dict[str, object]
    updated_at: datetime


async def advance_event_ingest_cursor(
    db: AsyncSession,
    *,
    org_id: UUID,
    target_id: UUID,
    workspace_id: UUID,
    session_id: UUID,
    observed_sequences: tuple[int, ...],
    now: datetime,
) -> EventIngestCursorSnapshot:
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
            org_id=org_id,
            target_id=target_id,
            workspace_id=workspace_id,
            session_id=session_id,
            contiguous_sequence=0,
            highest_seen_sequence=0,
            cursor_status=CursorStatus.current.value,
            gap_ranges={},
            created_at=now,
            updated_at=now,
        )
        db.add(cursor)

    if observed_sequences:
        highest = max(observed_sequences)
        cursor.highest_seen_sequence = max(cursor.highest_seen_sequence, highest)
        cursor.contiguous_sequence = _advance_contiguous(
            cursor.contiguous_sequence,
            observed_sequences,
        )
        cursor.cursor_status = (
            CursorStatus.current.value
            if cursor.contiguous_sequence == cursor.highest_seen_sequence
            else CursorStatus.gap.value
        )
    cursor.workspace_id = workspace_id
    cursor.updated_at = now
    await db.flush()
    return _cursor_snapshot(cursor)


def _advance_contiguous(current: int, observed_sequences: tuple[int, ...]) -> int:
    next_sequence = current + 1
    contiguous = current
    for sequence in sorted(set(observed_sequences)):
        if sequence == next_sequence:
            contiguous = sequence
            next_sequence += 1
    return contiguous


def _cursor_snapshot(cursor: CloudEventIngestCursor) -> EventIngestCursorSnapshot:
    return EventIngestCursorSnapshot(
        target_id=cursor.target_id,
        workspace_id=cursor.workspace_id,
        session_id=cursor.session_id,
        contiguous_sequence=cursor.contiguous_sequence,
        highest_seen_sequence=cursor.highest_seen_sequence,
        cursor_status=CursorStatus(cursor.cursor_status),
        gap_ranges=dict(cursor.gap_ranges),
        updated_at=cursor.updated_at,
    )
