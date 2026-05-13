"""Schemas for Cloud-mediated command APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.commands import CommandSnapshot

CommandKind = Literal[
    "start_session",
    "send_prompt",
    "resolve_interaction",
    "update_session_config",
    "cancel_turn",
    "cancel_session",
    "stop_workspace",
    "hibernate_workspace",
    "resume_workspace",
    "prune_workspace",
    "extend_workspace_ttl",
    "sync_existing_workspace",
]


class EnqueueCommandRequest(BaseModel):
    idempotency_key: str = Field(alias="idempotencyKey")
    source: Literal["web", "mobile", "slack", "api", "automation", "desktop_cloud_view"]
    target_id: UUID = Field(alias="targetId")
    workspace_id: UUID | None = Field(default=None, alias="workspaceId")
    session_id: UUID | None = Field(default=None, alias="sessionId")
    kind: CommandKind
    payload: dict[str, object] = Field(default_factory=dict)
    observed_event_seq: int | None = Field(default=None, alias="observedEventSeq")
    preconditions: dict[str, object] = Field(default_factory=dict)


class CommandResponse(BaseModel):
    id: UUID
    idempotency_key: str = Field(serialization_alias="idempotencyKey")
    org_id: UUID = Field(serialization_alias="orgId")
    actor_user_id: UUID | None = Field(default=None, serialization_alias="actorUserId")
    actor_kind: str = Field(serialization_alias="actorKind")
    source: str
    target_id: UUID = Field(serialization_alias="targetId")
    workspace_id: UUID | None = Field(default=None, serialization_alias="workspaceId")
    session_id: UUID | None = Field(default=None, serialization_alias="sessionId")
    kind: str
    payload: dict[str, object]
    observed_event_seq: int | None = Field(default=None, serialization_alias="observedEventSeq")
    preconditions: dict[str, object]
    status: str
    created_at: datetime = Field(serialization_alias="createdAt")
    lease_expires_at: datetime | None = Field(default=None, serialization_alias="leaseExpiresAt")
    error_code: str | None = Field(default=None, serialization_alias="errorCode")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")


def command_response(command: CommandSnapshot) -> CommandResponse:
    return CommandResponse(
        id=command.id,
        idempotency_key=command.idempotency_key,
        org_id=command.org_id,
        actor_user_id=command.actor_user_id,
        actor_kind=command.actor_kind.value,
        source=command.source.value,
        target_id=command.target_id,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        kind=command.kind.value,
        payload=command.payload,
        observed_event_seq=command.observed_event_seq,
        preconditions=command.preconditions,
        status=command.status.value,
        created_at=command.created_at,
        lease_expires_at=command.lease_expires_at,
        error_code=command.error_code,
        error_message=command.error_message,
    )
