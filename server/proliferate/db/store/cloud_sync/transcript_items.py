"""Cloud transcript item persistence."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sync import CloudTranscriptItem
from proliferate.utils.time import utcnow

_GENERIC_TRANSCRIPT_TOOL_TITLES = frozenset(
    ("", "bash", "command", "shell", "terminal", "tool call")
)


@dataclass(frozen=True)
class CloudTranscriptItemSnapshot:
    id: UUID
    target_id: UUID
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    item_id: str
    turn_id: str | None
    kind: str | None
    status: str | None
    source_agent_kind: str | None
    title: str | None
    text: str | None
    payload_json: str | None
    first_seq: int
    last_seq: int
    completed_seq: int | None
    first_event_at: str | None
    last_event_at: str | None


def _item_snapshot(row: CloudTranscriptItem) -> CloudTranscriptItemSnapshot:
    return CloudTranscriptItemSnapshot(
        id=row.id,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        item_id=row.item_id,
        turn_id=row.turn_id,
        kind=row.kind,
        status=row.status,
        source_agent_kind=row.source_agent_kind,
        title=row.title,
        text=row.text,
        payload_json=row.payload_json,
        first_seq=row.first_seq,
        last_seq=row.last_seq,
        completed_seq=row.completed_seq,
        first_event_at=row.first_event_at,
        last_event_at=row.last_event_at,
    )


def _should_replace_transcript_item_title(current: str | None, replacement: str) -> bool:
    normalized_current = (current or "").strip().lower()
    normalized_replacement = replacement.strip().lower()
    return (
        normalized_replacement not in _GENERIC_TRANSCRIPT_TOOL_TITLES
        and normalized_current in _GENERIC_TRANSCRIPT_TOOL_TITLES
    )


async def upsert_transcript_item(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    session_id: str,
    item_id: str,
    turn_id: str | None,
    seq: int,
    occurred_at: str | None,
    kind: str | None,
    status: str | None,
    source_agent_kind: str | None,
    title: str | None,
    text: str | None,
    payload_json: str | None,
    completed: bool,
) -> CloudTranscriptItemSnapshot:
    now = utcnow()
    row = (
        await db.execute(
            select(CloudTranscriptItem)
            .where(CloudTranscriptItem.target_id == target_id)
            .where(CloudTranscriptItem.session_id == session_id)
            .where(CloudTranscriptItem.item_id == item_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudTranscriptItem(
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            session_id=session_id,
            item_id=item_id,
            turn_id=turn_id,
            kind=kind,
            status=status,
            source_agent_kind=source_agent_kind,
            title=title,
            text=text,
            payload_json=payload_json,
            first_seq=seq,
            last_seq=seq,
            completed_seq=seq if completed else None,
            first_event_at=occurred_at,
            last_event_at=occurred_at,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        if seq < row.last_seq:
            return _item_snapshot(row)
        row.cloud_workspace_id = cloud_workspace_id or row.cloud_workspace_id
        row.workspace_id = workspace_id or row.workspace_id
        row.turn_id = turn_id or row.turn_id
        row.kind = kind or row.kind
        row.status = status or row.status
        row.source_agent_kind = source_agent_kind or row.source_agent_kind
        row.title = title if title is not None else row.title
        row.text = text if text is not None else row.text
        row.payload_json = payload_json if payload_json is not None else row.payload_json
        row.last_seq = max(row.last_seq, seq)
        row.completed_seq = seq if completed else row.completed_seq
        row.last_event_at = occurred_at or row.last_event_at
        row.updated_at = now
    await db.flush()
    return _item_snapshot(row)


async def annotate_transcript_item_title(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    item_id: str | None,
    title: str | None,
) -> CloudTranscriptItemSnapshot | None:
    cleaned_title = title.strip() if title else ""
    if not item_id or not cleaned_title:
        return None
    row = (
        await db.execute(
            select(CloudTranscriptItem)
            .where(CloudTranscriptItem.target_id == target_id)
            .where(CloudTranscriptItem.session_id == session_id)
            .where(CloudTranscriptItem.item_id == item_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if not _should_replace_transcript_item_title(row.title, cleaned_title):
        return _item_snapshot(row)
    row.title = cleaned_title
    row.updated_at = utcnow()
    await db.flush()
    return _item_snapshot(row)


async def list_transcript_items(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    limit: int = 200,
) -> tuple[CloudTranscriptItemSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudTranscriptItem)
            .where(CloudTranscriptItem.target_id == target_id)
            .where(CloudTranscriptItem.session_id == session_id)
            .order_by(CloudTranscriptItem.first_seq.asc())
            .limit(limit)
        )
    ).scalars()
    return tuple(_item_snapshot(row) for row in rows)
