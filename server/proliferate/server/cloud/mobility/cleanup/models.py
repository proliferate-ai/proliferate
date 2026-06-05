from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_mobility.records import CloudWorkspaceMoveCleanupItemValue


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


class MobilityCleanupItemSummary(BaseModel):
    id: str
    handoff_op_id: str = Field(serialization_alias="handoffOpId")
    item_kind: str = Field(serialization_alias="itemKind")
    target_id: str | None = Field(default=None, serialization_alias="targetId")
    anyharness_workspace_id: str | None = Field(
        default=None,
        serialization_alias="anyharnessWorkspaceId",
    )
    object_id: str | None = Field(default=None, serialization_alias="objectId")
    status: str
    attempt_count: int = Field(serialization_alias="attemptCount")
    next_attempt_at: str = Field(serialization_alias="nextAttemptAt")
    error_code: str | None = Field(default=None, serialization_alias="errorCode")
    error_message: str | None = Field(default=None, serialization_alias="errorMessage")
    started_at: str | None = Field(default=None, serialization_alias="startedAt")
    completed_at: str | None = Field(default=None, serialization_alias="completedAt")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class FailMobilityCleanupItemRequest(BaseModel):
    error_code: str = Field(alias="errorCode")
    error_message: str = Field(alias="errorMessage")


class RepairWorkspaceMobilityHandoffRequest(BaseModel):
    action: str
    detail: str | None = None


def cleanup_item_summary_payload(
    value: CloudWorkspaceMoveCleanupItemValue,
) -> MobilityCleanupItemSummary:
    return MobilityCleanupItemSummary(
        id=str(value.id),
        handoff_op_id=str(value.handoff_op_id),
        item_kind=value.item_kind,
        target_id=str(value.target_id) if value.target_id else None,
        anyharness_workspace_id=value.anyharness_workspace_id,
        object_id=str(value.object_id) if value.object_id else None,
        status=value.status,
        attempt_count=value.attempt_count,
        next_attempt_at=_to_iso(value.next_attempt_at),
        error_code=value.error_code,
        error_message=value.error_message,
        started_at=_to_iso(value.started_at),
        completed_at=_to_iso(value.completed_at),
        created_at=_to_iso(value.created_at),
        updated_at=_to_iso(value.updated_at),
    )
