"""Request and response models for Proliferate Worker endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


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
    machine_fingerprint: str | None = Field(default=None, alias="machineFingerprint")
    hostname: str | None = None
    worker_version: str | None = Field(default=None, alias="workerVersion")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")
    inventory: WorkerInventoryPayload | None = None


class WorkerEnrollResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    worker_id: str = Field(serialization_alias="workerId")
    worker_token: str = Field(serialization_alias="workerToken")
    heartbeat_interval_seconds: int = Field(serialization_alias="heartbeatIntervalSeconds")


class WorkerHeartbeatRequest(BaseModel):
    status: str = "online"
    status_detail: str | None = Field(default=None, alias="statusDetail")
    worker_version: str | None = Field(default=None, alias="workerVersion")
    anyharness_version: str | None = Field(default=None, alias="anyharnessVersion")
    supervisor_version: str | None = Field(default=None, alias="supervisorVersion")


class WorkerHeartbeatResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    worker_id: str = Field(serialization_alias="workerId")
    status: str
    server_time: str = Field(serialization_alias="serverTime")


class WorkerInventoryRequest(WorkerInventoryPayload):
    status: str = "online"
    status_detail: str | None = Field(default=None, alias="statusDetail")


class WorkerInventoryResponse(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    worker_id: str = Field(serialization_alias="workerId")
    updated: bool
