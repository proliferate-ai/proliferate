"""Allowlisted session snapshots for support cloud diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sync import (
    CloudEventIngestState,
    CloudPendingInteraction,
    CloudSessionEvent,
    CloudSessionProjection,
    CloudTranscriptItem,
)

type SessionKey = tuple[UUID, str]


@dataclass(frozen=True)
class CloudSessionDiagnosticsSnapshot:
    target_id: UUID
    cloud_workspace_id: UUID | None
    exposure_id: UUID | None
    workspace_id: str | None
    session_id: str
    native_session_id: str | None
    source_agent_kind: str | None
    status: str
    phase: str | None
    projection_level: str
    commandable: bool
    live_config_present: bool
    gap_state_present: bool
    last_uploaded_seq: int | None
    last_event_seq: int
    last_event_at: str | None
    started_at: str | None
    ended_at: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudSessionEventDiagnosticsSnapshot:
    target_id: UUID
    worker_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    anyharness_seq: int
    event_type: str
    source_kind: str
    turn_id: str | None
    item_id: str | None
    occurred_at: str | None
    payload_hash: str
    payload_size_bytes: int
    payload_truncated_at_bytes: int | None
    created_at: datetime


@dataclass(frozen=True)
class CloudTranscriptItemDiagnosticsSnapshot:
    target_id: UUID
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    item_id: str
    turn_id: str | None
    kind: str | None
    status: str | None
    source_agent_kind: str | None
    first_seq: int
    last_seq: int
    completed_seq: int | None
    first_event_at: str | None
    last_event_at: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudPendingInteractionDiagnosticsSnapshot:
    target_id: UUID
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    request_id: str
    kind: str | None
    status: str
    requested_seq: int
    resolved_seq: int | None
    requested_at: str | None
    resolved_at: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudEventIngestStateDiagnosticsSnapshot:
    target_id: UUID
    session_id: str
    worker_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    last_contiguous_seq: int
    updated_at: datetime


async def list_recent_sessions_for_workspaces(
    db: AsyncSession,
    workspace_ids: tuple[UUID, ...],
    *,
    limit: int,
) -> tuple[CloudSessionDiagnosticsSnapshot, ...]:
    if not workspace_ids:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudSessionProjection)
                .where(CloudSessionProjection.cloud_workspace_id.in_(workspace_ids))
                .order_by(desc(CloudSessionProjection.updated_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_session_snapshot(row) for row in rows)


async def list_recent_events_for_sessions(
    db: AsyncSession,
    session_keys: tuple[SessionKey, ...],
    *,
    limit_per_session: int,
) -> tuple[CloudSessionEventDiagnosticsSnapshot, ...]:
    snapshots: list[CloudSessionEventDiagnosticsSnapshot] = []
    for target_id, session_id in session_keys:
        rows = (
            (
                await db.execute(
                    select(CloudSessionEvent)
                    .where(CloudSessionEvent.target_id == target_id)
                    .where(CloudSessionEvent.session_id == session_id)
                    .order_by(desc(CloudSessionEvent.anyharness_seq))
                    .limit(limit_per_session)
                )
            )
            .scalars()
            .all()
        )
        snapshots.extend(_event_snapshot(row) for row in rows)
    return tuple(snapshots)


async def list_recent_transcript_items_for_sessions(
    db: AsyncSession,
    session_keys: tuple[SessionKey, ...],
    *,
    limit_per_session: int,
) -> tuple[CloudTranscriptItemDiagnosticsSnapshot, ...]:
    snapshots: list[CloudTranscriptItemDiagnosticsSnapshot] = []
    for target_id, session_id in session_keys:
        rows = (
            (
                await db.execute(
                    select(CloudTranscriptItem)
                    .where(CloudTranscriptItem.target_id == target_id)
                    .where(CloudTranscriptItem.session_id == session_id)
                    .order_by(desc(CloudTranscriptItem.last_seq))
                    .limit(limit_per_session)
                )
            )
            .scalars()
            .all()
        )
        snapshots.extend(_transcript_item_snapshot(row) for row in rows)
    return tuple(snapshots)


async def list_pending_interactions_for_sessions(
    db: AsyncSession,
    session_keys: tuple[SessionKey, ...],
    *,
    limit: int,
) -> tuple[CloudPendingInteractionDiagnosticsSnapshot, ...]:
    if not session_keys:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudPendingInteraction)
                .where(_session_key_clause(CloudPendingInteraction, session_keys))
                .order_by(desc(CloudPendingInteraction.updated_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_pending_interaction_snapshot(row) for row in rows)


async def list_event_ingest_states_for_sessions(
    db: AsyncSession,
    session_keys: tuple[SessionKey, ...],
) -> tuple[CloudEventIngestStateDiagnosticsSnapshot, ...]:
    if not session_keys:
        return ()
    rows = (
        (
            await db.execute(
                select(CloudEventIngestState).where(
                    _session_key_clause(CloudEventIngestState, session_keys)
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_event_ingest_state_snapshot(row) for row in rows)


def _session_key_clause(model: object, session_keys: tuple[SessionKey, ...]) -> object:
    return or_(
        *(
            and_(model.target_id == target_id, model.session_id == session_id)
            for target_id, session_id in session_keys
        )
    )


def _session_snapshot(row: CloudSessionProjection) -> CloudSessionDiagnosticsSnapshot:
    return CloudSessionDiagnosticsSnapshot(
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        exposure_id=row.exposure_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        native_session_id=row.native_session_id,
        source_agent_kind=row.source_agent_kind,
        status=row.status,
        phase=row.phase,
        projection_level=row.projection_level,
        commandable=row.commandable,
        live_config_present=bool(row.live_config_json),
        gap_state_present=bool(row.gap_state_json),
        last_uploaded_seq=row.last_uploaded_seq,
        last_event_seq=row.last_event_seq,
        last_event_at=row.last_event_at,
        started_at=row.started_at,
        ended_at=row.ended_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _event_snapshot(row: CloudSessionEvent) -> CloudSessionEventDiagnosticsSnapshot:
    return CloudSessionEventDiagnosticsSnapshot(
        target_id=row.target_id,
        worker_id=row.worker_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        anyharness_seq=row.anyharness_seq,
        event_type=row.event_type,
        source_kind=row.source_kind,
        turn_id=row.turn_id,
        item_id=row.item_id,
        occurred_at=row.occurred_at,
        payload_hash=row.payload_hash,
        payload_size_bytes=row.payload_size_bytes,
        payload_truncated_at_bytes=row.payload_truncated_at_bytes,
        created_at=row.created_at,
    )


def _transcript_item_snapshot(row: CloudTranscriptItem) -> CloudTranscriptItemDiagnosticsSnapshot:
    return CloudTranscriptItemDiagnosticsSnapshot(
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        item_id=row.item_id,
        turn_id=row.turn_id,
        kind=row.kind,
        status=row.status,
        source_agent_kind=row.source_agent_kind,
        first_seq=row.first_seq,
        last_seq=row.last_seq,
        completed_seq=row.completed_seq,
        first_event_at=row.first_event_at,
        last_event_at=row.last_event_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _pending_interaction_snapshot(
    row: CloudPendingInteraction,
) -> CloudPendingInteractionDiagnosticsSnapshot:
    return CloudPendingInteractionDiagnosticsSnapshot(
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        request_id=row.request_id,
        kind=row.kind,
        status=row.status,
        requested_seq=row.requested_seq,
        resolved_seq=row.resolved_seq,
        requested_at=row.requested_at,
        resolved_at=row.resolved_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _event_ingest_state_snapshot(
    row: CloudEventIngestState,
) -> CloudEventIngestStateDiagnosticsSnapshot:
    return CloudEventIngestStateDiagnosticsSnapshot(
        target_id=row.target_id,
        session_id=row.session_id,
        worker_id=row.worker_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        last_contiguous_seq=row.last_contiguous_seq,
        updated_at=row.updated_at,
    )
