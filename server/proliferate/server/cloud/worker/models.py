"""Schemas for worker-facing cloud sync APIs."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.server.cloud.commands.models import CommandResponse, command_response
from proliferate.db.store.cloud_sync.commands import CommandLeaseRecord


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


class WorkerHeartbeatRequest(BaseModel):
    heartbeat_id: str | None = Field(default=None, alias="heartbeatId")
    online_status: str = Field(default="online", alias="onlineStatus")
    anyharness_reachable: bool = Field(default=True, alias="anyharnessReachable")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    worker_version: str | None = Field(default=None, alias="workerVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")
    safe_stop_state: str = Field(default="unknown", alias="safeStopState")
    safe_stop_reasons: list[object] = Field(default_factory=list, alias="safeStopReasons")
    active_session_count: int = Field(default=0, alias="activeSessionCount")
    active_turn_count: int = Field(default=0, alias="activeTurnCount")
    pending_interaction_count: int = Field(default=0, alias="pendingInteractionCount")
    active_terminal_count: int = Field(default=0, alias="activeTerminalCount")
    active_process_count: int = Field(default=0, alias="activeProcessCount")


class WorkerHeartbeatResponse(BaseModel):
    ok: bool
    server_time: datetime = Field(serialization_alias="serverTime")


class WorkerInventoryRequest(BaseModel):
    os_kind: str | None = Field(default=None, alias="osKind")
    os_version: str | None = Field(default=None, alias="osVersion")
    arch: str | None = None
    distro: str | None = None
    shell: str | None = None
    package_managers: list[object] = Field(default_factory=list, alias="packageManagers")
    workspace_roots: list[object] = Field(default_factory=list, alias="workspaceRoots")
    capabilities: dict[str, object] = Field(default_factory=dict)
    tool_versions: dict[str, object] = Field(default_factory=dict, alias="toolVersions")
    provider_readiness: dict[str, object] = Field(default_factory=dict, alias="providerReadiness")
    mcp_readiness: dict[str, object] = Field(default_factory=dict, alias="mcpReadiness")
    agent_catalog_revision: str | None = Field(default=None, alias="agentCatalogRevision")


class LeaseCommandRequest(BaseModel):
    timeout_seconds: int = Field(default=25, alias="timeoutSeconds", ge=0, le=30)
    lease_seconds: int = Field(default=60, alias="leaseSeconds", ge=10, le=600)


class LeaseCommandResponse(BaseModel):
    lease_id: UUID | None = Field(default=None, serialization_alias="leaseId")
    command: CommandResponse | None = None
    lease_expires_at: datetime | None = Field(default=None, serialization_alias="leaseExpiresAt")


def lease_response(lease: CommandLeaseRecord | None) -> LeaseCommandResponse:
    if lease is None:
        return LeaseCommandResponse()
    return LeaseCommandResponse(
        lease_id=lease.id,
        command=command_response(lease.command),
        lease_expires_at=lease.expires_at,
    )


class CommandDeliveryRequest(BaseModel):
    status: str
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class CommandResultRequest(BaseModel):
    status: str
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class EventUpload(BaseModel):
    workspace_id: UUID | None = Field(default=None, alias="workspaceId")
    session_id: str = Field(alias="sessionId")
    anyharness_event_id: str | None = Field(default=None, alias="anyharnessEventId")
    anyharness_sequence: int = Field(alias="anyharnessSequence")
    event_type: str = Field(alias="eventType")
    schema_version: str = Field(default="v1", alias="schemaVersion")
    source_kind: str = Field(default="system", alias="sourceKind")
    actor_user_id: UUID | None = Field(default=None, alias="actorUserId")
    actor_external_id: str | None = Field(default=None, alias="actorExternalId")
    created_at: datetime = Field(alias="createdAt")
    payload: dict[str, object] = Field(default_factory=dict)
    payload_ref: str | None = Field(default=None, alias="payloadRef")
    payload_size_bytes: int = Field(default=0, alias="payloadSizeBytes")
    payload_hash: str | None = Field(default=None, alias="payloadHash")


class EventBatchUploadRequest(BaseModel):
    events: list[EventUpload]


class EventBatchUploadResponse(BaseModel):
    inserted_count: int = Field(serialization_alias="insertedCount")
    duplicate_count: int = Field(serialization_alias="duplicateCount")
