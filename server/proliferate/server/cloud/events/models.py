"""Schemas for cloud synced events."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.events import SessionEventSnapshot


class CloudSessionEventResponse(BaseModel):
    id: UUID
    org_id: UUID = Field(serialization_alias="orgId")
    target_id: UUID = Field(serialization_alias="targetId")
    workspace_id: UUID | None = Field(default=None, serialization_alias="workspaceId")
    session_id: UUID = Field(serialization_alias="sessionId")
    anyharness_sequence: int = Field(serialization_alias="anyharnessSequence")
    event_type: str = Field(serialization_alias="eventType")
    schema_version: int = Field(serialization_alias="schemaVersion")
    source_kind: str = Field(serialization_alias="sourceKind")
    created_at: datetime = Field(serialization_alias="createdAt")
    payload: dict[str, object] | None = None
    payload_ref: str | None = Field(default=None, serialization_alias="payloadRef")


def event_response(event: SessionEventSnapshot) -> CloudSessionEventResponse:
    return CloudSessionEventResponse(
        id=event.id,
        org_id=event.org_id,
        target_id=event.target_id,
        workspace_id=event.workspace_id,
        session_id=event.session_id,
        anyharness_sequence=event.anyharness_sequence,
        event_type=event.event_type,
        schema_version=event.schema_version,
        source_kind=event.source_kind.value,
        created_at=event.created_at,
        payload=event.payload,
        payload_ref=event.payload_ref,
    )
