"""Request and response models for cloud commands."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.commands import CloudCommandSnapshot


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class CreateCloudCommandRequest(BaseModel):
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1, max_length=255)
    target_id: UUID = Field(alias="targetId")
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    session_id: str | None = Field(default=None, alias="sessionId")
    kind: str
    payload: dict[str, object] = Field(default_factory=dict)
    observed_event_seq: int | None = Field(default=None, alias="observedEventSeq")
    preconditions: dict[str, object] | None = None
    source: str | None = None


class CloudCommandResponse(BaseModel):
    command_id: str = Field(serialization_alias="commandId")
    idempotency_key: str = Field(serialization_alias="idempotencyKey")
    target_id: str = Field(serialization_alias="targetId")
    workspace_id: str | None = Field(default=None, serialization_alias="workspaceId")
    session_id: str | None = Field(default=None, serialization_alias="sessionId")
    kind: str
    source: str
    status: str
    lease_id: str | None = Field(default=None, serialization_alias="leaseId")
    lease_expires_at: str | None = Field(default=None, serialization_alias="leaseExpiresAt")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")
    delivered_at: str | None = Field(default=None, serialization_alias="deliveredAt")
    accepted_at: str | None = Field(default=None, serialization_alias="acceptedAt")
    rejected_at: str | None = Field(default=None, serialization_alias="rejectedAt")
    error_code: str | None = Field(default=None, serialization_alias="errorCode")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")


def command_response_payload(value: CloudCommandSnapshot) -> CloudCommandResponse:
    return CloudCommandResponse(
        command_id=str(value.id),
        idempotency_key=value.idempotency_key,
        target_id=str(value.target_id),
        workspace_id=value.workspace_id,
        session_id=value.session_id,
        kind=value.kind,
        source=value.source,
        status=value.status,
        lease_id=value.lease_id,
        lease_expires_at=_to_iso(value.lease_expires_at),
        created_at=_to_iso(value.created_at) or "",
        updated_at=_to_iso(value.updated_at) or "",
        delivered_at=_to_iso(value.delivered_at),
        accepted_at=_to_iso(value.accepted_at),
        rejected_at=_to_iso(value.rejected_at),
        error_code=value.error_code,
        error_message=value.error_message,
    )
