"""Request/response models for runtime worker enrollment + heartbeat."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

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
    # None when the server image was not stamped with RUNTIME_VERSION: like the
    # worker pin, an unstamped fallback could never match a published runtime
    # artifact and would drive an anyharness-updating sandbox worker into
    # perpetual swap attempts, so an unstamped server pins nothing.
    anyharness: str | None = None
    catalog_version: str | None = None


class WorkerHeartbeatResponse(_CamelModel):
    worker_id: str
    server_time: datetime
    heartbeat_interval_seconds: int
    desired_versions: WorkerDesiredVersions
    # Make Managed Runtime Updates Supervisor-Owned, decision 6 (the D5
    # bridge): "supervisor_owned" only for cloud-sandbox targets while
    # `settings.supervisor_owned_runtime` is on, else None/absent. A legacy
    # Worker that has never seen this field treats it exactly like an absent
    # one (old-worker compat, same shape as `desired_versions`).
    desired_topology: str | None = None


class SetSandboxDesiredVersionsRequest(_CamelModel):
    """Admin setter body for a sandbox's target-scoped desired versions.

    ``None`` (the default, and the JSON explicit ``null``) clears the
    override so the target inherits the global pin again.
    """

    desired_anyharness_version: str | None = Field(default=None, max_length=64)
    desired_worker_version: str | None = Field(default=None, max_length=64)


class SetSandboxDesiredVersionsResponse(_CamelModel):
    cloud_sandbox_id: str
    desired_anyharness_version: str | None
    desired_worker_version: str | None


class DesktopWorkerEnrollmentRequest(_CamelModel):
    desktop_install_id: str = Field(min_length=1, max_length=255)
    organization_id: UUID | None = None


class DesktopWorkerEnrollmentResponse(_CamelModel):
    enrollment_token: str
    expires_at: datetime


class DesktopWorkerRevokeRequest(_CamelModel):
    desktop_install_id: str = Field(min_length=1, max_length=255)


class DesktopWorkerRevokeResponse(_CamelModel):
    revoked: bool
