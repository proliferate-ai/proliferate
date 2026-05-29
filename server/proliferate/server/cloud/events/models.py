"""Schemas for cloud event ingest, projections, and session streams."""

from __future__ import annotations

import json
from uuid import UUID

from pydantic import BaseModel, Field, ValidationError

from proliferate.db.store.cloud_sync import events as events_store


class WorkerSessionEventEnvelope(BaseModel):
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    session_id: str = Field(alias="sessionId")
    seq: int
    timestamp: str | None = None
    turn_id: str | None = Field(default=None, alias="turnId")
    item_id: str | None = Field(default=None, alias="itemId")
    event: dict[str, object]


class WorkerEventBatchRequest(BaseModel):
    events: list[WorkerSessionEventEnvelope] = Field(default_factory=list, max_length=200)


class WorkerEventSessionAck(BaseModel):
    session_id: str = Field(serialization_alias="sessionId")
    last_contiguous_seq: int = Field(serialization_alias="lastContiguousSeq")


class WorkerEventAck(BaseModel):
    session_id: str = Field(serialization_alias="sessionId")
    seq: int
    action: str
    reason: str | None = None


class WorkerEventBatchResponse(BaseModel):
    accepted_events: int = Field(serialization_alias="acceptedEvents")
    duplicate_events: int = Field(serialization_alias="duplicateEvents")
    live_only_events: int = Field(serialization_alias="liveOnlyEvents")
    session_acks: list[WorkerEventSessionAck] = Field(serialization_alias="sessionAcks")
    event_acks: list[WorkerEventAck] = Field(
        default_factory=list,
        serialization_alias="eventAcks",
    )


class CloudSessionProjectionResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    cloud_workspace_id: str | None = Field(default=None, serialization_alias="cloudWorkspaceId")
    workspace_id: str | None = Field(default=None, serialization_alias="workspaceId")
    session_id: str = Field(serialization_alias="sessionId")
    native_session_id: str | None = Field(default=None, serialization_alias="nativeSessionId")
    source_agent_kind: str | None = Field(default=None, serialization_alias="sourceAgentKind")
    title: str | None = None
    status: str
    phase: str | None = None
    pending_interaction_count: int = Field(
        default=0,
        serialization_alias="pendingInteractionCount",
    )
    live_config: dict[str, object] | None = Field(default=None, serialization_alias="liveConfig")
    last_event_seq: int = Field(serialization_alias="lastEventSeq")
    last_event_at: str | None = Field(default=None, serialization_alias="lastEventAt")
    started_at: str | None = Field(default=None, serialization_alias="startedAt")
    ended_at: str | None = Field(default=None, serialization_alias="endedAt")


class CloudTranscriptItemResponse(BaseModel):
    item_id: str = Field(serialization_alias="itemId")
    turn_id: str | None = Field(default=None, serialization_alias="turnId")
    kind: str | None = None
    status: str | None = None
    source_agent_kind: str | None = Field(default=None, serialization_alias="sourceAgentKind")
    title: str | None = None
    text: str | None = None
    payload: dict[str, object] | None = None
    first_seq: int = Field(serialization_alias="firstSeq")
    last_seq: int = Field(serialization_alias="lastSeq")
    completed_seq: int | None = Field(default=None, serialization_alias="completedSeq")
    first_event_at: str | None = Field(default=None, serialization_alias="firstEventAt")
    last_event_at: str | None = Field(default=None, serialization_alias="lastEventAt")


class CloudPendingInteractionResponse(BaseModel):
    request_id: str = Field(serialization_alias="requestId")
    kind: str | None = None
    status: str
    title: str | None = None
    description: str | None = None
    payload: dict[str, object] | None = None
    requested_seq: int = Field(serialization_alias="requestedSeq")
    resolved_seq: int | None = Field(default=None, serialization_alias="resolvedSeq")
    requested_at: str | None = Field(default=None, serialization_alias="requestedAt")
    resolved_at: str | None = Field(default=None, serialization_alias="resolvedAt")


class CloudSessionSnapshotResponse(BaseModel):
    session: CloudSessionProjectionResponse
    transcript_items: list[CloudTranscriptItemResponse] = Field(
        serialization_alias="transcriptItems",
    )
    pending_interactions: list[CloudPendingInteractionResponse] = Field(
        serialization_alias="pendingInteractions",
    )


class CloudSessionEventResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    session_id: str = Field(serialization_alias="sessionId")
    seq: int
    event_type: str = Field(serialization_alias="eventType")
    source_kind: str = Field(serialization_alias="sourceKind")
    turn_id: str | None = Field(default=None, serialization_alias="turnId")
    item_id: str | None = Field(default=None, serialization_alias="itemId")
    occurred_at: str | None = Field(default=None, serialization_alias="occurredAt")
    payload: dict[str, object] | None = None
    envelope: WorkerSessionEventEnvelope | None = None


class CloudSessionPatchResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    session_id: str = Field(serialization_alias="sessionId")
    seq: int
    event_type: str = Field(serialization_alias="eventType")
    session: CloudSessionProjectionResponse
    transcript_item: CloudTranscriptItemResponse | None = Field(
        default=None,
        serialization_alias="transcriptItem",
    )
    pending_interaction: CloudPendingInteractionResponse | None = Field(
        default=None,
        serialization_alias="pendingInteraction",
    )
    envelope: WorkerSessionEventEnvelope | None = None


def session_projection_response(
    value: events_store.CloudSessionProjectionSnapshot,
) -> CloudSessionProjectionResponse:
    return CloudSessionProjectionResponse(
        target_id=str(value.target_id),
        cloud_workspace_id=_uuid_str(value.cloud_workspace_id),
        workspace_id=value.workspace_id,
        session_id=value.session_id,
        native_session_id=value.native_session_id,
        source_agent_kind=value.source_agent_kind,
        title=value.title,
        status=value.status,
        phase=value.phase,
        pending_interaction_count=value.pending_interaction_count,
        live_config=_json_dict(value.live_config_json),
        last_event_seq=value.last_event_seq,
        last_event_at=value.last_event_at,
        started_at=value.started_at,
        ended_at=value.ended_at,
    )


def transcript_item_response(
    value: events_store.CloudTranscriptItemSnapshot,
) -> CloudTranscriptItemResponse:
    return CloudTranscriptItemResponse(
        item_id=value.item_id,
        turn_id=value.turn_id,
        kind=value.kind,
        status=value.status,
        source_agent_kind=value.source_agent_kind,
        title=value.title,
        text=value.text,
        payload=_json_dict(value.payload_json),
        first_seq=value.first_seq,
        last_seq=value.last_seq,
        completed_seq=value.completed_seq,
        first_event_at=value.first_event_at,
        last_event_at=value.last_event_at,
    )


def pending_interaction_response(
    value: events_store.CloudPendingInteractionSnapshot,
) -> CloudPendingInteractionResponse:
    return CloudPendingInteractionResponse(
        request_id=value.request_id,
        kind=value.kind,
        status=value.status,
        title=value.title,
        description=value.description,
        payload=_json_dict(value.payload_json),
        requested_seq=value.requested_seq,
        resolved_seq=value.resolved_seq,
        requested_at=value.requested_at,
        resolved_at=value.resolved_at,
    )


def session_event_response(
    value: events_store.CloudSessionEventSnapshot,
) -> CloudSessionEventResponse:
    return CloudSessionEventResponse(
        target_id=str(value.target_id),
        session_id=value.session_id,
        seq=value.seq,
        event_type=value.event_type,
        source_kind=value.source_kind,
        turn_id=value.turn_id,
        item_id=value.item_id,
        occurred_at=value.occurred_at,
        payload=_json_dict(value.payload_json),
        envelope=session_event_envelope(value.payload_json),
    )


def session_patch_response(
    *,
    target_id: UUID,
    session_id: str,
    seq: int,
    event_type: str,
    session: events_store.CloudSessionProjectionSnapshot,
    transcript_item: events_store.CloudTranscriptItemSnapshot | None = None,
    pending_interaction: events_store.CloudPendingInteractionSnapshot | None = None,
    envelope: WorkerSessionEventEnvelope | None = None,
) -> CloudSessionPatchResponse:
    return CloudSessionPatchResponse(
        target_id=str(target_id),
        session_id=session_id,
        seq=seq,
        event_type=event_type,
        session=session_projection_response(session),
        transcript_item=(
            transcript_item_response(transcript_item) if transcript_item is not None else None
        ),
        pending_interaction=(
            pending_interaction_response(pending_interaction)
            if pending_interaction is not None
            else None
        ),
        envelope=envelope,
    )


def _json_dict(value: str | None) -> dict[str, object] | None:
    if value is None:
        return None
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {"value": parsed}


def session_event_envelope(value: str | None) -> WorkerSessionEventEnvelope | None:
    parsed = _json_dict(value)
    if parsed is None:
        return None
    try:
        return WorkerSessionEventEnvelope.model_validate(parsed)
    except ValidationError:
        return None


def _uuid_str(value: UUID | None) -> str | None:
    return str(value) if value is not None else None
