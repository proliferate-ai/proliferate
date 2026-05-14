"""Schemas for cloud live stream messages."""

from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.server.cloud.commands.models import CloudCommandResponse
from proliferate.server.cloud.events.models import (
    CloudPendingInteractionResponse,
    CloudSessionEventResponse,
    CloudSessionProjectionResponse,
    CloudSessionSnapshotResponse,
    CloudTranscriptItemResponse,
)
from proliferate.server.cloud.targets.models import CloudTargetDetail
from proliferate.server.cloud.workspaces.models import WorkspaceDetail


class CloudStreamHeartbeatResponse(BaseModel):
    kind: str = "heartbeat"


class CloudLivePatchEnvelope(BaseModel):
    kind: str = "projection_patch"
    patch: dict[str, object] = Field(serialization_alias="patch")


class CloudWorkspaceSnapshotResponse(BaseModel):
    workspace: WorkspaceDetail
    sessions: list[CloudSessionProjectionResponse]


class CloudTranscriptSnapshotResponse(BaseModel):
    session: CloudSessionProjectionResponse
    transcript_items: list[CloudTranscriptItemResponse] = Field(
        serialization_alias="transcriptItems",
    )
    pending_interactions: list[CloudPendingInteractionResponse] = Field(
        serialization_alias="pendingInteractions",
    )
    last_event_seq: int = Field(serialization_alias="lastEventSeq")


class CloudSessionEventsResponse(BaseModel):
    events: list[CloudSessionEventResponse]
    next_cursor: int | None = Field(default=None, serialization_alias="nextCursor")


class CloudTargetSnapshotResponse(BaseModel):
    target: CloudTargetDetail


class CloudWorkspacePatchEnvelope(BaseModel):
    kind: str = "workspace_projection_patch"
    patch: dict[str, object] = Field(serialization_alias="patch")


class CloudTargetPatchEnvelope(BaseModel):
    kind: str = "target_projection_patch"
    target: CloudTargetDetail


class CloudCommandStatusEnvelope(BaseModel):
    kind: str = "command_status"
    command: CloudCommandResponse


def transcript_snapshot_response(
    snapshot: CloudSessionSnapshotResponse,
) -> CloudTranscriptSnapshotResponse:
    return CloudTranscriptSnapshotResponse(
        session=snapshot.session,
        transcript_items=list(snapshot.transcript_items),
        pending_interactions=list(snapshot.pending_interactions),
        last_event_seq=snapshot.session.last_event_seq,
    )
