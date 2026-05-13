"""Typed records and mappers for cloud worker target stores."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from proliferate.db.models.cloud.targets import (
    CloudTarget,
    CloudTargetEnrollment,
    CloudTargetInventory,
    CloudTargetStatus,
    CloudWorker,
)


class TargetKind(StrEnum):
    managed_cloud = "managed_cloud"
    self_hosted_cloud = "self_hosted_cloud"
    ssh = "ssh"
    desktop_dispatch = "desktop_dispatch"
    local_direct = "local_direct"
    future_vpc_worker = "future_vpc_worker"


class TargetAccessScope(StrEnum):
    personal = "personal"
    team = "team"
    org = "org"


class TargetPersistenceClass(StrEnum):
    ephemeral = "ephemeral"
    persistent = "persistent"
    snapshot_backed = "snapshot_backed"
    unknown = "unknown"


class DirectAttachPolicy(StrEnum):
    disabled = "disabled"
    owner_only = "owner_only"
    team_grant = "team_grant"
    org_grant = "org_grant"


class TargetUpdateChannel(StrEnum):
    stable = "stable"
    beta = "beta"
    pinned = "pinned"


class WorkerStatus(StrEnum):
    enrolling = "enrolling"
    active = "active"
    revoked = "revoked"
    rotated = "rotated"


class AnyHarnessEndpointKind(StrEnum):
    http = "http"
    unix_socket = "unix_socket"


class TargetOnlineStatus(StrEnum):
    online = "online"
    degraded = "degraded"
    offline = "offline"


class SafeStopState(StrEnum):
    safe = "safe"
    blocked = "blocked"
    unknown = "unknown"


@dataclass(frozen=True)
class EnrollmentTokenSnapshot:
    id: UUID
    target_id: UUID | None
    org_id: UUID
    owner_user_id: UUID | None
    created_by_user_id: UUID
    display_name: str
    kind: TargetKind
    access_scope: TargetAccessScope
    expires_at: datetime
    consumed_at: datetime | None
    created_at: datetime


@dataclass(frozen=True)
class TargetSnapshot:
    id: UUID
    org_id: UUID
    owner_user_id: UUID | None
    display_name: str
    kind: TargetKind
    access_scope: TargetAccessScope
    created_by_user_id: UUID
    default_workspace_root: str | None
    persistence_class: TargetPersistenceClass
    direct_attach_policy: DirectAttachPolicy
    cloud_sync_enabled: bool
    update_channel: TargetUpdateChannel
    desired_anyharness_version: str | None
    desired_worker_version: str | None
    desired_supervisor_version: str | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


@dataclass(frozen=True)
class TargetStatusSnapshot:
    target_id: UUID
    online_status: TargetOnlineStatus
    last_seen_at: datetime | None
    last_inventory_at: datetime | None
    last_activity_at: datetime | None
    worker_connected: bool
    anyharness_reachable: bool
    anyharness_version: str | None
    worker_version: str | None
    supervisor_version: str | None
    safe_stop_state: SafeStopState
    safe_stop_reasons: dict[str, object]
    active_session_count: int
    active_turn_count: int
    pending_interaction_count: int
    active_terminal_count: int
    active_process_count: int
    updated_at: datetime


@dataclass(frozen=True)
class TargetInventorySnapshot:
    target_id: UUID
    os_kind: str | None
    os_version: str | None
    arch: str | None
    distro: str | None
    shell: str | None
    package_managers: dict[str, object]
    workspace_roots: dict[str, object]
    supports_process_spawn: bool
    supports_pty: bool
    supports_filesystem: bool
    supports_git: bool
    supports_network_egress: bool
    supports_port_forwarding: bool
    supports_browser: bool
    supports_computer_use: bool
    supports_docker: bool
    node_version: str | None
    npm_version: str | None
    python_version: str | None
    uv_version: str | None
    git_version: str | None
    provider_readiness: dict[str, object]
    mcp_readiness: dict[str, object]
    agent_catalog_revision: str | None
    reported_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class WorkerSnapshot:
    id: UUID
    target_id: UUID
    org_id: UUID
    install_id: str
    status: WorkerStatus
    auth_version: int
    last_seen_at: datetime | None
    last_heartbeat_id: str | None
    worker_version: str | None
    supervisor_version: str | None
    anyharness_endpoint_kind: AnyHarnessEndpointKind
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class TargetDetailSnapshot:
    target: TargetSnapshot
    status: TargetStatusSnapshot | None
    inventory: TargetInventorySnapshot | None
    active_worker: WorkerSnapshot | None


@dataclass(frozen=True)
class WorkerEnrollmentSnapshot:
    target: TargetSnapshot
    worker: WorkerSnapshot
    status: TargetStatusSnapshot
    inventory: TargetInventorySnapshot | None


@dataclass(frozen=True)
class HeartbeatReport:
    heartbeat_id: str | None
    worker_version: str | None
    supervisor_version: str | None
    anyharness_version: str | None
    worker_connected: bool
    anyharness_reachable: bool
    safe_stop_state: SafeStopState
    safe_stop_reasons: dict[str, object]
    active_session_count: int
    active_turn_count: int
    pending_interaction_count: int
    active_terminal_count: int
    active_process_count: int
    last_activity_at: datetime | None


@dataclass(frozen=True)
class InventoryReport:
    os_kind: str | None
    os_version: str | None
    arch: str | None
    distro: str | None
    shell: str | None
    package_managers: dict[str, object]
    workspace_roots: dict[str, object]
    supports_process_spawn: bool
    supports_pty: bool
    supports_filesystem: bool
    supports_git: bool
    supports_network_egress: bool
    supports_port_forwarding: bool
    supports_browser: bool
    supports_computer_use: bool
    supports_docker: bool
    node_version: str | None
    npm_version: str | None
    python_version: str | None
    uv_version: str | None
    git_version: str | None
    provider_readiness: dict[str, object]
    mcp_readiness: dict[str, object]
    agent_catalog_revision: str | None
    reported_at: datetime


def enrollment_snapshot(enrollment: CloudTargetEnrollment) -> EnrollmentTokenSnapshot:
    return EnrollmentTokenSnapshot(
        id=enrollment.id,
        target_id=enrollment.target_id,
        org_id=enrollment.org_id,
        owner_user_id=enrollment.owner_user_id,
        created_by_user_id=enrollment.created_by_user_id,
        display_name=enrollment.display_name,
        kind=TargetKind(enrollment.kind),
        access_scope=TargetAccessScope(enrollment.access_scope),
        expires_at=enrollment.expires_at,
        consumed_at=enrollment.consumed_at,
        created_at=enrollment.created_at,
    )


def target_snapshot(target: CloudTarget) -> TargetSnapshot:
    return TargetSnapshot(
        id=target.id,
        org_id=target.org_id,
        owner_user_id=target.owner_user_id,
        display_name=target.display_name,
        kind=TargetKind(target.kind),
        access_scope=TargetAccessScope(target.access_scope),
        created_by_user_id=target.created_by_user_id,
        default_workspace_root=target.default_workspace_root,
        persistence_class=TargetPersistenceClass(target.persistence_class),
        direct_attach_policy=DirectAttachPolicy(target.direct_attach_policy),
        cloud_sync_enabled=target.cloud_sync_enabled,
        update_channel=TargetUpdateChannel(target.update_channel),
        desired_anyharness_version=target.desired_anyharness_version,
        desired_worker_version=target.desired_worker_version,
        desired_supervisor_version=target.desired_supervisor_version,
        created_at=target.created_at,
        updated_at=target.updated_at,
        archived_at=target.archived_at,
    )


def status_snapshot(status: CloudTargetStatus) -> TargetStatusSnapshot:
    return TargetStatusSnapshot(
        target_id=status.target_id,
        online_status=TargetOnlineStatus(status.online_status),
        last_seen_at=status.last_seen_at,
        last_inventory_at=status.last_inventory_at,
        last_activity_at=status.last_activity_at,
        worker_connected=status.worker_connected,
        anyharness_reachable=status.anyharness_reachable,
        anyharness_version=status.anyharness_version,
        worker_version=status.worker_version,
        supervisor_version=status.supervisor_version,
        safe_stop_state=SafeStopState(status.safe_stop_state),
        safe_stop_reasons=dict(status.safe_stop_reasons),
        active_session_count=status.active_session_count,
        active_turn_count=status.active_turn_count,
        pending_interaction_count=status.pending_interaction_count,
        active_terminal_count=status.active_terminal_count,
        active_process_count=status.active_process_count,
        updated_at=status.updated_at,
    )


def inventory_snapshot(inventory: CloudTargetInventory) -> TargetInventorySnapshot:
    return TargetInventorySnapshot(
        target_id=inventory.target_id,
        os_kind=inventory.os_kind,
        os_version=inventory.os_version,
        arch=inventory.arch,
        distro=inventory.distro,
        shell=inventory.shell,
        package_managers=dict(inventory.package_managers),
        workspace_roots=dict(inventory.workspace_roots),
        supports_process_spawn=inventory.supports_process_spawn,
        supports_pty=inventory.supports_pty,
        supports_filesystem=inventory.supports_filesystem,
        supports_git=inventory.supports_git,
        supports_network_egress=inventory.supports_network_egress,
        supports_port_forwarding=inventory.supports_port_forwarding,
        supports_browser=inventory.supports_browser,
        supports_computer_use=inventory.supports_computer_use,
        supports_docker=inventory.supports_docker,
        node_version=inventory.node_version,
        npm_version=inventory.npm_version,
        python_version=inventory.python_version,
        uv_version=inventory.uv_version,
        git_version=inventory.git_version,
        provider_readiness=dict(inventory.provider_readiness),
        mcp_readiness=dict(inventory.mcp_readiness),
        agent_catalog_revision=inventory.agent_catalog_revision,
        reported_at=inventory.reported_at,
        updated_at=inventory.updated_at,
    )


def worker_snapshot(worker: CloudWorker) -> WorkerSnapshot:
    return WorkerSnapshot(
        id=worker.id,
        target_id=worker.target_id,
        org_id=worker.org_id,
        install_id=worker.install_id,
        status=WorkerStatus(worker.status),
        auth_version=worker.auth_version,
        last_seen_at=worker.last_seen_at,
        last_heartbeat_id=worker.last_heartbeat_id,
        worker_version=worker.worker_version,
        supervisor_version=worker.supervisor_version,
        anyharness_endpoint_kind=AnyHarnessEndpointKind(worker.anyharness_endpoint_kind),
        created_at=worker.created_at,
        updated_at=worker.updated_at,
        revoked_at=worker.revoked_at,
    )
