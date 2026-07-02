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
    machine_fingerprint: str | None = None
    hostname: str | None = None
    worker_version: str | None = None
    anyharness_version: str | None = None


class WorkerEnrollResponse(_CamelModel):
    worker_id: str
    worker_token: str
    heartbeat_interval_seconds: int
    integration_gateway: IntegrationGatewayConfig


class WorkerHeartbeatRequest(_CamelModel):
    status: str | None = None


class WorkerHeartbeatResponse(_CamelModel):
    worker_id: str
    server_time: datetime
    heartbeat_interval_seconds: int


class DesktopWorkerEnrollmentRequest(_CamelModel):
    desktop_install_id: str = Field(min_length=1, max_length=255)


class DesktopWorkerEnrollmentResponse(_CamelModel):
    enrollment_token: str
    expires_at: datetime
