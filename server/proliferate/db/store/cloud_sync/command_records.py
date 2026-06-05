"""Cloud command record snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from proliferate.constants.cloud import CloudCommandStatus
from proliferate.db.models.cloud.commands import CloudCommand


@dataclass(frozen=True)
class CloudCommandSnapshot:
    id: UUID
    idempotency_scope: str
    idempotency_key: str
    target_id: UUID
    organization_id: UUID | None
    actor_user_id: UUID | None
    actor_kind: str
    source: str
    workspace_id: str | None
    cloud_workspace_id: UUID | None
    session_id: str | None
    kind: str
    payload_json: str
    observed_event_seq: int | None
    preconditions_json: str | None
    authorization_context_json: str | None
    status: str
    lease_id: str | None
    leased_by_worker_id: UUID | None
    attempt_count: int
    lease_expires_at: datetime | None
    delivered_at: datetime | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    expired_at: datetime | None
    error_code: str | None
    error_message: str | None
    result_json: str | None
    created_at: datetime
    updated_at: datetime


def snapshot_command(row: CloudCommand) -> CloudCommandSnapshot:
    return CloudCommandSnapshot(
        id=row.id,
        idempotency_scope=row.idempotency_scope,
        idempotency_key=row.idempotency_key,
        target_id=row.target_id,
        organization_id=row.organization_id,
        actor_user_id=row.actor_user_id,
        actor_kind=row.actor_kind,
        source=row.source,
        workspace_id=row.workspace_id,
        cloud_workspace_id=row.cloud_workspace_id,
        session_id=row.session_id,
        kind=row.kind,
        payload_json=row.payload_json,
        observed_event_seq=row.observed_event_seq,
        preconditions_json=row.preconditions_json,
        authorization_context_json=row.authorization_context_json,
        status=row.status,
        lease_id=row.lease_id,
        leased_by_worker_id=row.leased_by_worker_id,
        attempt_count=row.attempt_count,
        lease_expires_at=row.lease_expires_at,
        delivered_at=row.delivered_at,
        accepted_at=row.accepted_at,
        rejected_at=row.rejected_at,
        expired_at=row.expired_at,
        error_code=row.error_code,
        error_message=row.error_message,
        result_json=row.result_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def is_terminal_status(status: str) -> bool:
    return status in {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
