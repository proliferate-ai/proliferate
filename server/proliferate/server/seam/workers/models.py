"""Request/response models for runtime worker enrollment + heartbeat."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# A desired version flows into CDN redirect paths (runtime/stable/<pin>/...) and
# into the Supervisor mailbox request as a path-embedded identifier, so it must
# be a safe filename fragment — not merely bounded in length. Mirrors the
# protocol crate's `validate_identifier` admission (alphanumeric plus . _ - +,
# never empty / "." / "..").
_VERSION_IDENTIFIER_EXTRA = frozenset("._-+")


def _validate_version_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    if value in ("", ".", "..") or not all(
        char.isascii() and (char.isalnum() or char in _VERSION_IDENTIFIER_EXTRA) for char in value
    ):
        raise ValueError("desired version must be a safe identifier (alphanumeric and . _ - +)")
    return value


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
    # Telemetry only (Update Flow ADR, FR-1): last-observed agent catalog
    # version, polled by the worker from its runtime's read-only
    # `GET /v1/catalogs/agents/version`. Never desired state, never pushed
    # back to the runtime.
    catalog_version: str | None = Field(default=None, max_length=64)


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


class WorkerHeartbeatResponse(_CamelModel):
    worker_id: str
    server_time: datetime
    heartbeat_interval_seconds: int
    desired_versions: WorkerDesiredVersions
    # The server-owned verdict on whether this Worker may upload target launch
    # options. Required on every new-server 200 — a successful,
    # authenticated heartbeat always states the verdict explicitly, and a Worker
    # that receives no field at all (an old server) fails closed to ``false``.
    # It is not desired state: it never alters Supervisor, mailbox, or binary
    # convergence. Authentication is a separate boundary — a missing, unknown, or
    # revoked Worker gets ``401 cloud_worker_unauthorized`` and no response body
    # at all, never a 200 whose verdict happens to be ``false``.
    launch_options_upload_allowed: bool


class DesktopWorkerEnrollmentRequest(_CamelModel):
    desktop_install_id: str = Field(min_length=1, max_length=255)
    organization_id: UUID | None = None


class DesktopWorkerEnrollmentResponse(_CamelModel):
    enrollment_token: str
    expires_at: datetime
    pending_ticket_policy: Literal["newest_wins"] = "newest_wins"


class DesktopWorkerRevokeRequest(_CamelModel):
    desktop_install_id: str = Field(min_length=1, max_length=255)


class DesktopWorkerRevokeResponse(_CamelModel):
    revoked: bool
