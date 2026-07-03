"""Request/response models for runtime worker enrollment + heartbeat."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class IntegrationGatewayConfig(_CamelModel):
    """The AnyHarness-facing gateway config the worker writes to a dotfile."""

    url: str
    authorization: str


class WorkerEnrollRequest(_CamelModel):
    enrollment_token: str
    # max_length mirrors the cloud_runtime_worker column widths so an overlong
    # value is a 422 at the edge, not a StringDataRightTruncation 500.
    machine_fingerprint: str | None = Field(default=None, max_length=128)
    hostname: str | None = Field(default=None, max_length=255)
    worker_version: str | None = Field(default=None, max_length=64)
    anyharness_version: str | None = Field(default=None, max_length=64)


class WorkerEnrollResponse(_CamelModel):
    worker_id: str
    worker_token: str
    heartbeat_interval_seconds: int
    integration_gateway: IntegrationGatewayConfig


class WorkerHeartbeatRequest(_CamelModel):
    status: str | None = None
    # Self-reported after a binary swap so the row tracks what actually runs.
    # Column-width bounds, as on WorkerEnrollRequest.
    worker_version: str | None = Field(default=None, max_length=64)
    anyharness_version: str | None = Field(default=None, max_length=64)


class WorkerDesiredVersions(_CamelModel):
    """The component versions this server pins; workers converge onto these."""

    # None when the server image was not stamped with WORKER_VERSION: a
    # fallback pin could never match a worker artifact and would drive
    # self-updating workers into perpetual swap attempts, so an unstamped
    # server pins nothing.
    worker: str | None = None
    anyharness: str


class WorkerHeartbeatResponse(_CamelModel):
    worker_id: str
    server_time: datetime
    heartbeat_interval_seconds: int
    desired_versions: WorkerDesiredVersions


class DesktopWorkerEnrollmentRequest(_CamelModel):
    desktop_install_id: str = Field(min_length=1, max_length=255)


class DesktopWorkerEnrollmentResponse(_CamelModel):
    enrollment_token: str
    expires_at: datetime
