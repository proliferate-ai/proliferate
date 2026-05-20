"""Request and response models for Proliferate Worker endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.constants.cloud import CloudTargetUpdateChannel


class WorkerInventoryPayload(BaseModel):
    os: str | None = None
    arch: str | None = None
    distro: str | None = None
    shell: str | None = None
    git: dict[str, object] | None = None
    node: dict[str, object] | None = None
    python: dict[str, object] | None = None
    browser: dict[str, object] | None = None
    capabilities: dict[str, object] | None = None
    providers: dict[str, object] | None = None
    mcp: dict[str, object] | None = None


class WorkerEnrollRequest(BaseModel):
    enrollment_token: str = Field(alias="enrollmentToken")
    sandbox_profile_id: str | None = Field(default=None, alias="sandboxProfileId")
    cloud_sandbox_id: str | None = Field(default=None, alias="cloudSandboxId")
    slot_generation: int | None = Field(default=None, alias="slotGeneration")
    machine_fingerprint: str | None = Field(default=None, alias="machineFingerprint")
    hostname: str | None = None
    worker_version: str | None = Field(default=None, alias="workerVersion")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")
    inventory: WorkerInventoryPayload | None = None


class WorkerEnrollResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    sandbox_profile_id: str | None = Field(default=None, serialization_alias="sandboxProfileId")
    cloud_sandbox_id: str | None = Field(default=None, serialization_alias="cloudSandboxId")
    slot_generation: int | None = Field(default=None, serialization_alias="slotGeneration")
    worker_id: str = Field(serialization_alias="workerId")
    worker_token: str = Field(serialization_alias="workerToken")
    heartbeat_interval_seconds: int = Field(serialization_alias="heartbeatIntervalSeconds")


class WorkerHeartbeatRequest(BaseModel):
    sandbox_profile_id: str | None = Field(default=None, alias="sandboxProfileId")
    cloud_sandbox_id: str | None = Field(default=None, alias="cloudSandboxId")
    slot_generation: int | None = Field(default=None, alias="slotGeneration")
    status: str = "online"
    status_detail: str | None = Field(default=None, alias="statusDetail")
    worker_version: str | None = Field(default=None, alias="workerVersion")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")


class WorkerDesiredVersionsResponse(BaseModel):
    should_update: bool = Field(serialization_alias="shouldUpdate")
    update_channel: CloudTargetUpdateChannel = Field(serialization_alias="updateChannel")
    update_generation: int = Field(serialization_alias="updateGeneration")
    anyharness_version: str | None = Field(
        default=None,
        serialization_alias="anyharnessVersion",
    )
    worker_version: str | None = Field(default=None, serialization_alias="workerVersion")
    supervisor_version: str | None = Field(
        default=None,
        serialization_alias="supervisorVersion",
    )


class WorkerHeartbeatResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    sandbox_profile_id: str | None = Field(default=None, serialization_alias="sandboxProfileId")
    cloud_sandbox_id: str | None = Field(default=None, serialization_alias="cloudSandboxId")
    slot_generation: int | None = Field(default=None, serialization_alias="slotGeneration")
    worker_id: str = Field(serialization_alias="workerId")
    status: str
    server_time: str = Field(serialization_alias="serverTime")
    desired_versions: WorkerDesiredVersionsResponse = Field(
        serialization_alias="desiredVersions",
    )


class WorkerUpdateStatusRequest(BaseModel):
    status: str
    update_generation: int = Field(alias="updateGeneration")
    component: str | None = None
    version: str | None = None
    detail: str | None = None
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class WorkerUpdateStatusResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    worker_id: str = Field(serialization_alias="workerId")
    updated: bool


class WorkerInventoryRequest(WorkerInventoryPayload):
    status: str = "online"
    status_detail: str | None = Field(default=None, alias="statusDetail")


class WorkerInventoryResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    worker_id: str = Field(serialization_alias="workerId")
    updated: bool


class WorkerCommandLeaseRequest(BaseModel):
    supported_kinds: list[str] = Field(default_factory=list, alias="supportedKinds")
    lease_timeout_seconds: int | None = Field(default=None, alias="leaseTimeoutSeconds")


class WorkerCommandEnvelope(BaseModel):
    command_id: str = Field(serialization_alias="commandId")
    idempotency_key: str = Field(serialization_alias="idempotencyKey")
    target_id: str = Field(serialization_alias="targetId")
    workspace_id: str | None = Field(default=None, serialization_alias="workspaceId")
    cloud_workspace_id: str | None = Field(default=None, serialization_alias="cloudWorkspaceId")
    sandbox_profile_id: str | None = Field(default=None, serialization_alias="sandboxProfileId")
    slot_generation: int | None = Field(default=None, serialization_alias="slotGeneration")
    session_id: str | None = Field(default=None, serialization_alias="sessionId")
    kind: str
    payload: dict[str, object]
    observed_event_seq: int | None = Field(default=None, serialization_alias="observedEventSeq")
    preconditions: dict[str, object] | None = None
    lease_id: str = Field(serialization_alias="leaseId")
    lease_expires_at: str = Field(serialization_alias="leaseExpiresAt")


class WorkerCommandLeaseResponse(BaseModel):
    command: WorkerCommandEnvelope | None = None
    server_time: str = Field(serialization_alias="serverTime")


class WorkerCommandDeliveryRequest(BaseModel):
    lease_id: str = Field(alias="leaseId")
    cloud_workspace_id: str | None = Field(default=None, alias="cloudWorkspaceId")
    slot_generation: int | None = Field(default=None, alias="slotGeneration")
    status: str = "delivered"
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")


class WorkerCommandResultRequest(BaseModel):
    lease_id: str = Field(alias="leaseId")
    cloud_workspace_id: str | None = Field(default=None, alias="cloudWorkspaceId")
    slot_generation: int | None = Field(default=None, alias="slotGeneration")
    anyharness_workspace_id: str | None = Field(default=None, alias="anyharnessWorkspaceId")
    status: str
    error_code: str | None = Field(default=None, alias="errorCode")
    error_message: str | None = Field(default=None, alias="errorMessage")
    result: dict[str, object] | None = None


class WorkerCommandStatusResponse(BaseModel):
    command_id: str = Field(serialization_alias="commandId")
    status: str
    updated: bool
