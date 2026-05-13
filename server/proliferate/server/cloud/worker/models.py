"""Schemas for worker-facing cloud sync APIs."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.commands import CommandLeaseSnapshot, CommandSnapshot


class WorkerEnrollRequest(BaseModel):
    enrollment_token: str = Field(alias="enrollmentToken")
    install_id: str = Field(alias="installId")
    worker_version: str | None = Field(default=None, alias="workerVersion")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")


class WorkerEnrollResponse(BaseModel):
    target_id: UUID = Field(serialization_alias="targetId")
    worker_id: UUID = Field(serialization_alias="workerId")
    worker_token: str = Field(serialization_alias="workerToken")
    cloud_base_url: str | None = Field(default=None, serialization_alias="cloudBaseUrl")
    credential_kind: str = Field(default="bearer", serialization_alias="credentialKind")


class WorkerHeartbeatRequest(BaseModel):
    heartbeat_id: str | None = Field(default=None, alias="heartbeatId")
    online_status: str = Field(default="online", alias="onlineStatus")
    anyharness_reachable: bool = Field(default=True, alias="anyharnessReachable")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    worker_version: str | None = Field(default=None, alias="workerVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")
    safe_stop_state: str = Field(default="unknown", alias="safeStopState")
    safe_stop_reasons: dict[str, object] = Field(default_factory=dict, alias="safeStopReasons")
    active_session_count: int = Field(default=0, alias="activeSessionCount")
    active_turn_count: int = Field(default=0, alias="activeTurnCount")
    pending_interaction_count: int = Field(default=0, alias="pendingInteractionCount")
    active_terminal_count: int = Field(default=0, alias="activeTerminalCount")
    active_process_count: int = Field(default=0, alias="activeProcessCount")
    last_activity_at: datetime | None = Field(default=None, alias="lastActivityAt")


class WorkerHeartbeatResponse(BaseModel):
    ok: bool
    server_time: datetime = Field(serialization_alias="serverTime")


class WorkerInventoryRequest(BaseModel):
    os_kind: str | None = Field(default=None, alias="osKind")
    os_version: str | None = Field(default=None, alias="osVersion")
    arch: str | None = None
    distro: str | None = None
    shell: str | None = None
    package_managers: list[str] = Field(default_factory=list, alias="packageManagers")
    workspace_roots: list[str] = Field(default_factory=list, alias="workspaceRoots")
    capabilities: dict[str, object] = Field(default_factory=dict)
    tool_versions: dict[str, object] = Field(default_factory=dict, alias="toolVersions")
    provider_readiness: dict[str, object] = Field(default_factory=dict, alias="providerReadiness")
    mcp_readiness: dict[str, object] = Field(default_factory=dict, alias="mcpReadiness")
    agent_catalog_revision: str | None = Field(default=None, alias="agentCatalogRevision")
    reported_at: datetime = Field(alias="reportedAt")


class LeaseCommandRequest(BaseModel):
    timeout_seconds: int = Field(default=25, alias="timeoutSeconds", ge=0, le=30)
    lease_seconds: int = Field(default=60, alias="leaseSeconds", ge=10, le=600)
    max_commands: int = Field(default=10, alias="maxCommands", ge=1, le=25)


class WorkerCommandResponse(BaseModel):
    command_id: UUID = Field(serialization_alias="commandId")
    idempotency_key: str = Field(serialization_alias="idempotencyKey")
    lease_id: UUID = Field(serialization_alias="leaseId")
    kind: str
    workspace_id: UUID | None = Field(default=None, serialization_alias="workspaceId")
    session_id: UUID | None = Field(default=None, serialization_alias="sessionId")
    payload: dict[str, object]
    observed_event_seq: int | None = Field(default=None, serialization_alias="observedEventSeq")
    preconditions: dict[str, object]


class LeaseCommandResponse(BaseModel):
    commands: list[WorkerCommandResponse] = Field(default_factory=list)


def lease_response(leases: tuple[CommandLeaseSnapshot, ...]) -> LeaseCommandResponse:
    return LeaseCommandResponse(commands=[_worker_command(lease) for lease in leases])


def _worker_command(lease: CommandLeaseSnapshot) -> WorkerCommandResponse:
    command: CommandSnapshot = lease.command
    return WorkerCommandResponse(
        command_id=command.id,
        idempotency_key=command.idempotency_key,
        lease_id=lease.id,
        kind=command.kind.value,
        workspace_id=command.workspace_id,
        session_id=command.session_id,
        payload=command.payload,
        observed_event_seq=command.observed_event_seq,
        preconditions=command.preconditions,
    )


class CommandDeliveryRequest(BaseModel):
    lease_id: UUID | None = Field(default=None, alias="leaseId")
    status: str
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class CommandResultRequest(BaseModel):
    lease_id: UUID | None = Field(default=None, alias="leaseId")
    status: str
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class EventUpload(BaseModel):
    workspace_id: UUID | None = Field(default=None, alias="workspaceId")
    session_id: UUID = Field(alias="sessionId")
    anyharness_event_id: str | None = Field(default=None, alias="anyharnessEventId")
    anyharness_sequence: int = Field(alias="anyharnessSequence")
    event_type: str = Field(alias="eventType")
    schema_version: int = Field(default=1, alias="schemaVersion")
    source_kind: str = Field(default="target", alias="sourceKind")
    actor_user_id: UUID | None = Field(default=None, alias="actorUserId")
    actor_external_id: str | None = Field(default=None, alias="actorExternalId")
    created_at: datetime = Field(alias="createdAt")
    payload: dict[str, object] | None = None
    payload_ref: str | None = Field(default=None, alias="payloadRef")
    payload_size_bytes: int = Field(default=0, alias="payloadSizeBytes")
    payload_hash: str | None = Field(default=None, alias="payloadHash")
    dedupe_key: str | None = Field(default=None, alias="dedupeKey")


class EventBatchPayload(BaseModel):
    events: list[EventUpload] = Field(default_factory=list)


class EventBatchUploadRequest(BaseModel):
    events: list[EventUpload] = Field(default_factory=list)
    batch: EventBatchPayload | None = None

    def all_events(self) -> list[EventUpload]:
        if self.batch is not None:
            return self.batch.events
        return self.events


class EventBatchUploadResponse(BaseModel):
    accepted: bool = True
    last_ack_seq: int | None = Field(default=None, serialization_alias="lastAckSeq")
    inserted_count: int = Field(serialization_alias="insertedCount")
    duplicate_count: int = Field(serialization_alias="duplicateCount")
    conflict_count: int = Field(default=0, serialization_alias="conflictCount")


class WorkerUpdateStatusRequest(BaseModel):
    reports: list[dict[str, object]] = Field(default_factory=list)


class WorkerUpdateStatusResponse(BaseModel):
    accepted: bool = True
