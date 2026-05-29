"""Cloud event-sync persistence and projection stores."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.sync import (
    CloudEventIngestState,
    CloudPendingInteraction,
    CloudSessionEvent,
    CloudSessionProjection,
    CloudSyncedWorkspace,
    CloudTranscriptItem,
)
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow

_GENERIC_TRANSCRIPT_TOOL_TITLES = frozenset(
    ("", "bash", "command", "shell", "terminal", "tool call")
)


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


@dataclass(frozen=True)
class CloudSessionProjectionSnapshot:
    id: UUID
    target_id: UUID
    exposure_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    native_session_id: str | None
    source_agent_kind: str | None
    title: str | None
    status: str
    phase: str | None
    live_config_json: str | None
    projection_level: str
    commandable: bool
    gap_state_json: str | None
    last_uploaded_seq: int | None
    agent_run_config_snapshot_json: dict[str, object] | None
    last_event_seq: int
    last_event_at: str | None
    started_at: str | None
    ended_at: str | None
    updated_at: datetime
    pending_interaction_count: int = 0
    preview: str | None = None


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


def _session_snapshot(
    row: CloudSessionProjection,
    *,
    pending_interaction_count: int = 0,
    preview: str | None = None,
) -> CloudSessionProjectionSnapshot:
    return CloudSessionProjectionSnapshot(
        id=row.id,
        target_id=row.target_id,
        exposure_id=row.exposure_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        native_session_id=row.native_session_id,
        source_agent_kind=row.source_agent_kind,
        title=row.title,
        status=row.status,
        phase=row.phase,
        live_config_json=row.live_config_json,
        projection_level=row.projection_level,
        commandable=row.commandable,
        gap_state_json=row.gap_state_json,
        last_uploaded_seq=row.last_uploaded_seq,
        agent_run_config_snapshot_json=row.agent_run_config_snapshot_json,
        last_event_seq=row.last_event_seq,
        last_event_at=row.last_event_at,
        started_at=row.started_at,
        ended_at=row.ended_at,
        updated_at=row.updated_at,
        pending_interaction_count=pending_interaction_count,
        preview=preview,
    )


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


def _should_replace_transcript_item_title(current: str | None, replacement: str) -> bool:
    normalized_current = (current or "").strip().lower()
    normalized_replacement = replacement.strip().lower()
    return (
        normalized_replacement not in _GENERIC_TRANSCRIPT_TOOL_TITLES
        and normalized_current in _GENERIC_TRANSCRIPT_TOOL_TITLES
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


async def count_active_sessions_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> int:
    count_value = (
        await db.execute(
            select(func.count(CloudSessionProjection.id))
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.ended_at.is_(None))
        )
    ).scalar_one()
    return int(count_value or 0)


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


async def upsert_session_projection(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    session_id: str,
    seq: int,
    occurred_at: str | None,
    status: str | None = None,
    phase: str | None = None,
    native_session_id: str | None = None,
    source_agent_kind: str | None = None,
    title: str | None = None,
    live_config_json: str | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
) -> CloudSessionProjectionSnapshot:
    now = utcnow()
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.session_id == session_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudSessionProjection(
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            session_id=session_id,
            native_session_id=native_session_id,
            source_agent_kind=source_agent_kind,
            title=title,
            status=status or "running",
            phase=phase,
            live_config_json=live_config_json,
            projection_level="live",
            commandable=True,
            last_event_seq=seq,
            last_event_at=occurred_at,
            started_at=started_at,
            ended_at=ended_at,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        if seq < row.last_event_seq:
            return _session_snapshot(row)
        row.cloud_workspace_id = cloud_workspace_id or row.cloud_workspace_id
        row.workspace_id = workspace_id or row.workspace_id
        row.native_session_id = native_session_id or row.native_session_id
        row.source_agent_kind = source_agent_kind or row.source_agent_kind
        row.title = title if title is not None else row.title
        row.status = status or row.status
        row.phase = phase or row.phase
        row.live_config_json = (
            live_config_json if live_config_json is not None else row.live_config_json
        )
        row.last_event_seq = max(row.last_event_seq, seq)
        row.last_event_at = occurred_at or row.last_event_at
        row.started_at = started_at or row.started_at
        row.ended_at = ended_at or row.ended_at
        row.updated_at = now
    await db.flush()
    return _session_snapshot(row)


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


async def get_session_projection(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudSessionProjectionSnapshot | None:
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.session_id == session_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    pending_count = await _pending_interaction_count_for_session(
        db,
        target_id=row.target_id,
        session_id=row.session_id,
    )
    return _session_snapshot(row, pending_interaction_count=pending_count)


async def get_session_projection_by_session_id(
    db: AsyncSession,
    *,
    session_id: str,
) -> CloudSessionProjectionSnapshot | None:
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.session_id == session_id)
            .order_by(CloudSessionProjection.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    pending_count = await _pending_interaction_count_for_session(
        db,
        target_id=row.target_id,
        session_id=row.session_id,
    )
    return _session_snapshot(row, pending_interaction_count=pending_count)


async def list_session_projections(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID | None = None,
    workspace_id: str | None = None,
    limit: int = 100,
) -> tuple[CloudSessionProjectionSnapshot, ...]:
    query = select(CloudSessionProjection).where(CloudSessionProjection.target_id == target_id)
    if cloud_workspace_id is not None:
        query = query.where(CloudSessionProjection.cloud_workspace_id == cloud_workspace_id)
    if workspace_id is not None:
        query = query.where(CloudSessionProjection.workspace_id == workspace_id)
    rows = tuple(
        (
            await db.execute(
                query.order_by(
                    CloudSessionProjection.updated_at.desc(),
                    CloudSessionProjection.last_event_seq.desc(),
                ).limit(limit)
            )
        ).scalars()
    )
    previews = await _latest_transcript_previews_for_sessions(db, rows)
    pending_counts = await _pending_interaction_counts_for_sessions(db, rows)
    return tuple(
        _session_snapshot(
            row,
            pending_interaction_count=pending_counts.get((row.target_id, row.session_id), 0),
            preview=previews.get((row.target_id, row.session_id)),
        )
        for row in rows
    )


async def list_session_projections_for_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    target_id: UUID | None = None,
    limit: int = 100,
) -> tuple[CloudSessionProjectionSnapshot, ...]:
    query = select(CloudSessionProjection).where(
        CloudSessionProjection.cloud_workspace_id == cloud_workspace_id
    )
    if target_id is not None:
        query = query.where(CloudSessionProjection.target_id == target_id)
    rows = tuple(
        (
            await db.execute(
                query.order_by(
                    CloudSessionProjection.updated_at.desc(),
                    CloudSessionProjection.last_event_seq.desc(),
                ).limit(limit)
            )
        ).scalars()
    )
    previews = await _latest_transcript_previews_for_sessions(db, rows)
    pending_counts = await _pending_interaction_counts_for_sessions(db, rows)
    return tuple(
        _session_snapshot(
            row,
            pending_interaction_count=pending_counts.get((row.target_id, row.session_id), 0),
            preview=previews.get((row.target_id, row.session_id)),
        )
        for row in rows
    )


async def _pending_interaction_count_for_session(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> int:
    count = await db.scalar(
        select(func.count(CloudPendingInteraction.id))
        .where(CloudPendingInteraction.target_id == target_id)
        .where(CloudPendingInteraction.session_id == session_id)
        .where(CloudPendingInteraction.status.in_(("pending", "failed")))
    )
    return int(count or 0)


async def _pending_interaction_counts_for_sessions(
    db: AsyncSession,
    rows: tuple[CloudSessionProjection, ...],
) -> dict[tuple[UUID, str], int]:
    session_keys = tuple({(row.target_id, row.session_id) for row in rows})
    if not session_keys:
        return {}
    conditions = [
        and_(
            CloudPendingInteraction.target_id == target_id,
            CloudPendingInteraction.session_id == session_id,
        )
        for target_id, session_id in session_keys
    ]
    count_rows = await db.execute(
        select(
            CloudPendingInteraction.target_id,
            CloudPendingInteraction.session_id,
            func.count(CloudPendingInteraction.id),
        )
        .where(or_(*conditions))
        .where(CloudPendingInteraction.status.in_(("pending", "failed")))
        .group_by(CloudPendingInteraction.target_id, CloudPendingInteraction.session_id)
    )
    return {
        (target_id, session_id): int(count)
        for target_id, session_id, count in count_rows
    }


async def _latest_transcript_previews_for_sessions(
    db: AsyncSession,
    rows: tuple[CloudSessionProjection, ...],
) -> dict[tuple[UUID, str], str]:
    session_keys = tuple({(row.target_id, row.session_id) for row in rows})
    if not session_keys:
        return {}
    conditions = [
        and_(
            CloudTranscriptItem.target_id == target_id,
            CloudTranscriptItem.session_id == session_id,
        )
        for target_id, session_id in session_keys
    ]
    preview_query = (
        select(CloudTranscriptItem)
        .where(or_(*conditions))
        .order_by(
            CloudTranscriptItem.target_id.asc(),
            CloudTranscriptItem.session_id.asc(),
            CloudTranscriptItem.last_seq.desc(),
            CloudTranscriptItem.updated_at.desc(),
        )
    )
    if len(session_keys) == 1:
        preview_query = preview_query.limit(50)
    transcript_rows = (await db.execute(preview_query)).scalars()
    previews: dict[tuple[UUID, str], str] = {}
    fallback_previews: dict[tuple[UUID, str], str] = {}
    for item in transcript_rows:
        key = (item.target_id, item.session_id)
        if key in previews:
            continue
        preview = _transcript_item_preview(item)
        if not preview:
            continue
        if _is_conversation_preview_kind(item.kind):
            previews[key] = preview
        elif key not in fallback_previews:
            fallback_previews[key] = preview
    return {**fallback_previews, **previews}


def _is_conversation_preview_kind(kind: str | None) -> bool:
    normalized = (kind or "").strip().lower()
    return normalized in {"assistant_message", "prompt", "user_message"}


def _transcript_item_preview(item: CloudTranscriptItem) -> str | None:
    for value in (item.text, item.title):
        preview = _compact_preview_text(value)
        if preview:
            return preview
    return None


def _compact_preview_text(value: str | None) -> str | None:
    text = " ".join((value or "").split())
    if not text:
        return None
    if text.lower() in {
        "assistant_message",
        "bash",
        "command",
        "shell",
        "terminal",
        "tool call",
        "user_message",
    }:
        return None
    if len(text) <= 280:
        return text
    return f"{text[:277].rstrip()}..."


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
