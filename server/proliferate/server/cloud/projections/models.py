"""Schemas for cloud projection snapshots."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.projections import ProjectionSnapshot


class ProjectionResponse(BaseModel):
    id: UUID
    org_id: UUID = Field(serialization_alias="orgId")
    projection_kind: str = Field(serialization_alias="projectionKind")
    projection_id: UUID = Field(serialization_alias="projectionId")
    target_id: UUID | None = Field(default=None, serialization_alias="targetId")
    workspace_id: UUID | None = Field(default=None, serialization_alias="workspaceId")
    session_id: UUID | None = Field(default=None, serialization_alias="sessionId")
    last_event_seq: int = Field(serialization_alias="lastEventSeq")
    snapshot: dict[str, object]
    updated_at: datetime = Field(serialization_alias="updatedAt")


def projection_response(projection: ProjectionSnapshot) -> ProjectionResponse:
    return ProjectionResponse(
        id=projection.id,
        org_id=projection.org_id,
        projection_kind=projection.projection_kind.value,
        projection_id=projection.projection_id,
        target_id=projection.target_id,
        workspace_id=projection.workspace_id,
        session_id=projection.session_id,
        last_event_seq=projection.last_event_seq,
        snapshot=projection.snapshot,
        updated_at=projection.updated_at,
    )
