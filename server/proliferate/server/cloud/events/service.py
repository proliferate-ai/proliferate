"""Application service for worker event ingest and cloud session projections."""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.events.domain.cursors import advance_contiguous_cursor
from proliferate.server.cloud.events.domain.payload_policy import retained_payload
from proliferate.server.cloud.events.domain.projection import (
    event_type,
    source_kind_for_event,
    transcript_item_id,
    transcript_item_payload,
    transcript_item_text,
)
from proliferate.server.cloud.events.models import (
    CloudSessionPatchResponse,
    CloudSessionProjectionResponse,
    CloudSessionSnapshotResponse,
    WorkerEventAck,
    WorkerEventBatchRequest,
    WorkerEventBatchResponse,
    WorkerEventSessionAck,
    pending_interaction_response,
    session_projection_response,
    transcript_item_response,
)
from proliferate.server.cloud.live.service import (
    projection_patch_from_event,
    publish_session_patch,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext

SESSION_DURABLE_EVENT_HARD_CAP = 10_000
SESSION_PAYLOAD_BYTES_HARD_CAP = 25 * 1024 * 1024


@dataclass(frozen=True)
class SessionProjectionPatch:
    status: str | None = None
    phase: str | None = None
    native_session_id: str | None = None
    source_agent_kind: str | None = None
    title: str | None = None
    live_config_json: str | None = None
    started_at: str | None = None
    ended_at: str | None = None


@dataclass(frozen=True)
class ProjectionIngestPolicy:
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    projection_level: str
    live_fanout: bool
    transcript_rows: bool


@dataclass(frozen=True)
class ProjectionIngestAdmission:
    policy: ProjectionIngestPolicy | None
    discard_reason: str = "inactive_projection"


async def ingest_worker_event_batch(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerEventBatchRequest,
) -> WorkerEventBatchResponse:
    accepted_events = 0
    duplicate_events = 0
    live_only_events = 0
    processed_by_session: dict[str, list[int]] = defaultdict(list)
    workspace_by_session: dict[str, str | None] = {}
    cloud_workspace_by_session: dict[str, UUID | None] = {}
    projection_patches: list[CloudSessionPatchResponse] = []
    event_acks: list[WorkerEventAck] = []

    for event in body.events:
        if event.seq <= 0:
            raise CloudApiError(
                "cloud_event_invalid_sequence",
                "Event sequence must be positive.",
                status_code=400,
            )
        envelope = event.model_dump(by_alias=True)
        current_event_type = event_type(envelope)
        current_workspace_id = event.workspace_id

        admission = await _projection_ingest_policy(
            db,
            target_id=auth.target_id,
            session_id=event.session_id,
            workspace_id=current_workspace_id,
        )
        policy = admission.policy
        if policy is None:
            live_only_events += 1
            event_acks.append(
                WorkerEventAck(
                    session_id=event.session_id,
                    seq=event.seq,
                    action="discarded",
                    reason=admission.discard_reason,
                )
            )
            continue
        workspace_by_session[event.session_id] = policy.workspace_id or current_workspace_id
        cloud_workspace_by_session[event.session_id] = policy.cloud_workspace_id
        payload_decision = retained_payload(current_event_type, envelope)
        if not payload_decision.durable:
            live_only_events += 1
            processed_by_session[event.session_id].append(event.seq)
            event_acks.append(
                WorkerEventAck(
                    session_id=event.session_id,
                    seq=event.seq,
                    action="live_only",
                    reason="payload_not_retained",
                )
            )
            continue
        if policy.projection_level == "session_summaries" and not _updates_session_summary(
            current_event_type
        ):
            live_only_events += 1
            processed_by_session[event.session_id].append(event.seq)
            event_acks.append(
                WorkerEventAck(
                    session_id=event.session_id,
                    seq=event.seq,
                    action="live_only",
                    reason="projection_level_session_summaries",
                )
            )
            continue
        if policy.projection_level == "session_summaries":
            event_count, payload_bytes = await events_store.get_session_event_usage(
                db,
                target_id=auth.target_id,
                session_id=event.session_id,
            )
            if event_count >= SESSION_DURABLE_EVENT_HARD_CAP:
                raise CloudApiError(
                    "cloud_event_session_cap_exceeded",
                    "Session cloud event retention cap exceeded.",
                    status_code=413,
                )
            projected_payload_bytes = payload_bytes + payload_decision.payload_size_bytes
            if projected_payload_bytes > SESSION_PAYLOAD_BYTES_HARD_CAP:
                raise CloudApiError(
                    "cloud_event_session_payload_cap_exceeded",
                    "Session cloud payload retention cap exceeded.",
                    status_code=413,
                )
            inserted, is_new, duplicate_matches = await events_store.insert_event_if_new(
                db,
                events_store.InsertSessionEvent(
                    target_id=auth.target_id,
                    worker_id=auth.worker_id,
                    cloud_workspace_id=policy.cloud_workspace_id,
                    workspace_id=policy.workspace_id,
                    session_id=event.session_id,
                    seq=event.seq,
                    event_type=current_event_type,
                    source_kind=source_kind_for_event(event.event),
                    turn_id=event.turn_id,
                    item_id=event.item_id,
                    occurred_at=event.timestamp,
                    payload_json=payload_decision.payload_json,
                    payload_hash=payload_decision.payload_hash,
                    payload_size_bytes=payload_decision.payload_size_bytes,
                    payload_truncated_at_bytes=payload_decision.payload_truncated_at_bytes,
                ),
            )
            if not duplicate_matches:
                raise CloudApiError(
                    "cloud_event_duplicate_mismatch",
                    "Duplicate event sequence has a different payload hash.",
                    status_code=409,
                )
            processed_by_session[event.session_id].append(event.seq)
            if inserted is None or not is_new:
                duplicate_events += 1
                event_acks.append(
                    WorkerEventAck(
                        session_id=event.session_id,
                        seq=event.seq,
                        action="duplicate",
                    )
                )
                continue
            accepted_events += 1
            event_acks.append(
                WorkerEventAck(
                    session_id=event.session_id,
                    seq=event.seq,
                    action="accepted",
                )
            )
            patch = await _apply_projection(
                db,
                auth=auth,
                cloud_workspace_id=policy.cloud_workspace_id,
                workspace_id=policy.workspace_id,
                envelope=envelope,
                payload_json=payload_decision.payload_json,
                include_transcript=False,
            )
            if policy.live_fanout:
                projection_patches.append(patch)
            continue
        event_count, payload_bytes = await events_store.get_session_event_usage(
            db,
            target_id=auth.target_id,
            session_id=event.session_id,
        )
        if event_count >= SESSION_DURABLE_EVENT_HARD_CAP:
            raise CloudApiError(
                "cloud_event_session_cap_exceeded",
                "Session cloud event retention cap exceeded.",
                status_code=413,
            )
        if payload_bytes + payload_decision.payload_size_bytes > SESSION_PAYLOAD_BYTES_HARD_CAP:
            raise CloudApiError(
                "cloud_event_session_payload_cap_exceeded",
                "Session cloud payload retention cap exceeded.",
                status_code=413,
            )
        inserted, is_new, duplicate_matches = await events_store.insert_event_if_new(
            db,
            events_store.InsertSessionEvent(
                target_id=auth.target_id,
                worker_id=auth.worker_id,
                cloud_workspace_id=policy.cloud_workspace_id,
                workspace_id=policy.workspace_id,
                session_id=event.session_id,
                seq=event.seq,
                event_type=current_event_type,
                source_kind=source_kind_for_event(event.event),
                turn_id=event.turn_id,
                item_id=event.item_id,
                occurred_at=event.timestamp,
                payload_json=payload_decision.payload_json,
                payload_hash=payload_decision.payload_hash,
                payload_size_bytes=payload_decision.payload_size_bytes,
                payload_truncated_at_bytes=payload_decision.payload_truncated_at_bytes,
            ),
        )
        if not duplicate_matches:
            raise CloudApiError(
                "cloud_event_duplicate_mismatch",
                "Duplicate event sequence has a different payload hash.",
                status_code=409,
            )
        processed_by_session[event.session_id].append(event.seq)
        if inserted is None or not is_new:
            duplicate_events += 1
            event_acks.append(
                WorkerEventAck(
                    session_id=event.session_id,
                    seq=event.seq,
                    action="duplicate",
                )
            )
            continue
        accepted_events += 1
        event_acks.append(
            WorkerEventAck(
                session_id=event.session_id,
                seq=event.seq,
                action="accepted",
            )
        )
        patch = await _apply_projection(
            db,
            auth=auth,
            cloud_workspace_id=policy.cloud_workspace_id,
            workspace_id=policy.workspace_id,
            envelope=envelope,
            payload_json=payload_decision.payload_json,
            include_transcript=policy.transcript_rows,
        )
        if policy.live_fanout:
            projection_patches.append(patch)

    session_acks: list[WorkerEventSessionAck] = []
    for session_id, seqs in processed_by_session.items():
        current = await events_store.get_ingest_cursor(
            db,
            target_id=auth.target_id,
            session_id=session_id,
        )
        last_contiguous_seq = advance_contiguous_cursor(current, seqs)
        cursor = await events_store.upsert_ingest_cursor(
            db,
            target_id=auth.target_id,
            session_id=session_id,
            worker_id=auth.worker_id,
            cloud_workspace_id=cloud_workspace_by_session.get(session_id),
            workspace_id=workspace_by_session.get(session_id),
            last_contiguous_seq=last_contiguous_seq,
        )
        session_acks.append(
            WorkerEventSessionAck(
                session_id=session_id,
                last_contiguous_seq=cursor,
            )
        )

    for patch in projection_patches:
        await publish_session_patch(patch)

    return WorkerEventBatchResponse(
        accepted_events=accepted_events,
        duplicate_events=duplicate_events,
        live_only_events=live_only_events,
        session_acks=session_acks,
        event_acks=event_acks,
    )


async def _projection_ingest_policy(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    workspace_id: str | None,
) -> ProjectionIngestAdmission:
    projection = await events_store.get_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    if projection is None or projection.exposure_id is None:
        return ProjectionIngestAdmission(policy=None)
    exposure = await exposures_store.get_workspace_exposure_by_id(
        db,
        projection.exposure_id,
    )
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        return ProjectionIngestAdmission(policy=None)
    expected_workspace_id = exposure.anyharness_workspace_id or projection.workspace_id
    if expected_workspace_id and workspace_id and workspace_id != expected_workspace_id:
        return ProjectionIngestAdmission(policy=None, discard_reason="workspace_mismatch")
    return ProjectionIngestAdmission(
        policy=ProjectionIngestPolicy(
            cloud_workspace_id=projection.cloud_workspace_id or exposure.cloud_workspace_id,
            workspace_id=expected_workspace_id or workspace_id,
            projection_level=projection.projection_level,
            live_fanout=projection.projection_level == "live",
            transcript_rows=projection.projection_level in {"transcript", "live"},
        )
    )


def _updates_session_summary(event_type_value: str) -> bool:
    return event_type_value in {
        "session_started",
        "session_ended",
        "turn_started",
        "turn_ended",
        "session_info_update",
        "config_option_update",
    }


async def get_session_snapshot(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudSessionSnapshotResponse:
    projection = await events_store.get_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    if projection is None:
        raise CloudApiError(
            "cloud_session_not_found",
            "Synced session not found.",
            status_code=404,
        )
    transcript_items = await events_store.list_transcript_items(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    pending_interactions = await events_store.list_pending_interactions(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    return CloudSessionSnapshotResponse(
        session=session_projection_response(projection),
        transcript_items=[transcript_item_response(item) for item in transcript_items],
        pending_interactions=[
            pending_interaction_response(interaction) for interaction in pending_interactions
        ],
    )


async def list_session_summaries(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
    cloud_workspace_id: UUID | None = None,
    workspace_id: str | None = None,
    limit: int = 100,
) -> list[CloudSessionProjectionResponse]:
    await ensure_visible_target(db, target_id=target_id, user_id=user_id)
    sessions = await events_store.list_session_projections(
        db,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        workspace_id=workspace_id,
        limit=min(max(limit, 1), 200),
    )
    return [session_projection_response(session) for session in sessions]


async def ensure_visible_session_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    user_id: UUID,
) -> UUID:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user_id,
    )
    if target is None:
        raise CloudApiError(
            "cloud_session_not_found",
            "Synced session not found.",
            status_code=404,
        )
    projection = await events_store.get_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    if projection is None:
        raise CloudApiError(
            "cloud_session_not_found",
            "Synced session not found.",
            status_code=404,
        )
    return target_id


async def ensure_visible_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> targets_store.CloudTargetSnapshot:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user_id,
    )
    if target is None:
        raise CloudApiError(
            "cloud_target_not_found",
            "Target not found.",
            status_code=404,
        )
    return target


async def _apply_projection(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    envelope: dict[str, object],
    payload_json: str | None,
    include_transcript: bool,
) -> CloudSessionPatchResponse:
    session_id = str(envelope["sessionId"])
    seq = _int_value(envelope["seq"])
    occurred_at = envelope.get("timestamp")
    timestamp = occurred_at if isinstance(occurred_at, str) else None
    event = envelope.get("event")
    event_payload = event if isinstance(event, dict) else {}
    current_event_type = event_type(envelope)
    patch = _session_projection_patch(current_event_type, event_payload, timestamp)
    session_projection = await events_store.upsert_session_projection(
        db,
        target_id=auth.target_id,
        cloud_workspace_id=cloud_workspace_id,
        workspace_id=workspace_id,
        session_id=session_id,
        seq=seq,
        occurred_at=timestamp,
        status=patch.status,
        phase=patch.phase,
        native_session_id=patch.native_session_id,
        source_agent_kind=patch.source_agent_kind,
        title=patch.title,
        live_config_json=patch.live_config_json,
        started_at=patch.started_at,
        ended_at=patch.ended_at,
    )
    transcript_item = None
    pending_interaction = None

    if include_transcript and current_event_type in {"item_started", "item_completed"}:
        item_id = transcript_item_id(envelope)
        if item_id is not None:
            item = transcript_item_payload(event_payload)
            transcript_item = await events_store.upsert_transcript_item(
                db,
                target_id=auth.target_id,
                cloud_workspace_id=cloud_workspace_id,
                workspace_id=workspace_id,
                session_id=session_id,
                item_id=item_id,
                turn_id=_str_or_none(envelope.get("turnId")),
                seq=seq,
                occurred_at=timestamp,
                kind=_str_or_none(item.get("kind")),
                status=_str_or_none(item.get("status")),
                source_agent_kind=_str_or_none(item.get("sourceAgentKind")),
                title=_str_or_none(item.get("title")),
                text=transcript_item_text(item),
                payload_json=payload_json,
                completed=current_event_type == "item_completed",
            )
    elif include_transcript and current_event_type == "interaction_requested":
        request_id = _str_or_none(event_payload.get("requestId"))
        if request_id:
            pending_interaction = await events_store.upsert_pending_interaction(
                db,
                target_id=auth.target_id,
                cloud_workspace_id=cloud_workspace_id,
                workspace_id=workspace_id,
                session_id=session_id,
                request_id=request_id,
                seq=seq,
                occurred_at=timestamp,
                kind=_str_or_none(event_payload.get("kind")),
                title=_str_or_none(event_payload.get("title")),
                description=_str_or_none(event_payload.get("description")),
                payload_json=payload_json,
            )
    elif include_transcript and current_event_type == "interaction_resolved":
        request_id = _str_or_none(event_payload.get("requestId"))
        if request_id:
            pending_interaction = await events_store.resolve_pending_interaction(
                db,
                target_id=auth.target_id,
                session_id=session_id,
                request_id=request_id,
                seq=seq,
                occurred_at=timestamp,
                payload_json=payload_json,
            )
    return projection_patch_from_event(
        target_id=auth.target_id,
        session_id=session_id,
        seq=seq,
        event_type=current_event_type,
        session=session_projection,
        transcript_item=transcript_item,
        pending_interaction=pending_interaction,
    )


def _session_projection_patch(
    event_type_value: str,
    event: dict[str, object],
    timestamp: str | None,
) -> SessionProjectionPatch:
    if event_type_value == "session_started":
        return SessionProjectionPatch(
            status="running",
            phase="running",
            native_session_id=_str_or_none(event.get("nativeSessionId")),
            source_agent_kind=_str_or_none(event.get("sourceAgentKind")),
            started_at=timestamp,
        )
    if event_type_value == "session_ended":
        return SessionProjectionPatch(status="ended", phase="ended", ended_at=timestamp)
    if event_type_value == "turn_started":
        return SessionProjectionPatch(status="running", phase="turn_running")
    if event_type_value == "turn_ended":
        return SessionProjectionPatch(status="idle", phase="idle")
    if event_type_value == "session_info_update":
        return SessionProjectionPatch(title=_str_or_none(event.get("title")))
    if event_type_value == "config_option_update":
        live_config = event.get("liveConfig")
        return SessionProjectionPatch(
            live_config_json=json.dumps(
                live_config if isinstance(live_config, dict) else event,
                separators=(",", ":"),
                sort_keys=True,
            )
        )
    return SessionProjectionPatch()


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _int_value(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    raise TypeError(f"Expected integer-compatible value, got {type(value).__name__}.")
