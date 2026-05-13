"""Schemas for cloud target registry APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.target_records import (
    TargetDetailSnapshot,
    TargetInventorySnapshot,
    TargetSnapshot,
    TargetStatusSnapshot,
)

TargetKind = Literal[
    "managed_cloud",
    "self_hosted_cloud",
    "ssh",
    "desktop_dispatch",
    "local_direct",
    "future_vpc_worker",
]


class CreateEnrollmentRequest(BaseModel):
    target_kind: TargetKind = Field(alias="targetKind")
    display_name: str = Field(alias="displayName")
    access_scope: Literal["personal", "team", "org"] = Field(
        default="personal",
        alias="accessScope",
    )
    ttl_minutes: int = Field(default=30, alias="ttlMinutes", ge=1, le=1440)
    default_workspace_root: str | None = Field(default=None, alias="defaultWorkspaceRoot")
    persistence_class: Literal["ephemeral", "persistent", "snapshot_backed", "unknown"] = Field(
        default="unknown",
        alias="persistenceClass",
    )
    direct_attach_policy: Literal["disabled", "owner_only", "team_grant", "org_grant"] = Field(
        default="disabled",
        alias="directAttachPolicy",
    )
    update_channel: Literal["stable", "beta", "pinned"] = Field(
        default="stable",
        alias="updateChannel",
    )


class EnrollmentResponse(BaseModel):
    enrollment_id: UUID = Field(serialization_alias="enrollmentId")
    target_id: UUID | None = Field(default=None, serialization_alias="targetId")
    token: str
    expires_at: datetime = Field(serialization_alias="expiresAt")


class TargetStatusPayload(BaseModel):
    online_status: str = Field(serialization_alias="onlineStatus")
    worker_connected: bool = Field(serialization_alias="workerConnected")
    anyharness_reachable: bool = Field(serialization_alias="anyharnessReachable")
    safe_stop_state: str = Field(serialization_alias="safeStopState")
    safe_stop_reasons: dict[str, object] = Field(serialization_alias="safeStopReasons")
    active_session_count: int = Field(serialization_alias="activeSessionCount")
    active_turn_count: int = Field(serialization_alias="activeTurnCount")
    pending_interaction_count: int = Field(serialization_alias="pendingInteractionCount")
    active_terminal_count: int = Field(serialization_alias="activeTerminalCount")
    active_process_count: int = Field(serialization_alias="activeProcessCount")
    last_seen_at: datetime | None = Field(default=None, serialization_alias="lastSeenAt")


class TargetInventoryPayload(BaseModel):
    os_kind: str | None = Field(default=None, serialization_alias="osKind")
    os_version: str | None = Field(default=None, serialization_alias="osVersion")
    arch: str | None = None
    distro: str | None = None
    shell: str | None = None
    package_managers: dict[str, object] = Field(
        default_factory=dict,
        serialization_alias="packageManagers",
    )
    workspace_roots: dict[str, object] = Field(
        default_factory=dict,
        serialization_alias="workspaceRoots",
    )
    capabilities: dict[str, bool]
    tool_versions: dict[str, str | None] = Field(serialization_alias="toolVersions")
    provider_readiness: dict[str, object] = Field(serialization_alias="providerReadiness")
    mcp_readiness: dict[str, object] = Field(serialization_alias="mcpReadiness")
    agent_catalog_revision: str | None = Field(
        default=None,
        serialization_alias="agentCatalogRevision",
    )
    reported_at: datetime = Field(serialization_alias="reportedAt")


class TargetSummary(BaseModel):
    id: UUID
    org_id: UUID = Field(serialization_alias="orgId")
    owner_user_id: UUID | None = Field(default=None, serialization_alias="ownerUserId")
    display_name: str = Field(serialization_alias="displayName")
    kind: str
    access_scope: str = Field(serialization_alias="accessScope")
    persistence_class: str = Field(serialization_alias="persistenceClass")
    direct_attach_policy: str = Field(serialization_alias="directAttachPolicy")
    cloud_sync_enabled: bool = Field(serialization_alias="cloudSyncEnabled")
    update_channel: str = Field(serialization_alias="updateChannel")
    status: TargetStatusPayload | None = None
    inventory: TargetInventoryPayload | None = None


def target_status_payload(status: TargetStatusSnapshot | None) -> TargetStatusPayload | None:
    if status is None:
        return None
    return TargetStatusPayload(
        online_status=status.online_status.value,
        worker_connected=status.worker_connected,
        anyharness_reachable=status.anyharness_reachable,
        safe_stop_state=status.safe_stop_state.value,
        safe_stop_reasons=status.safe_stop_reasons,
        active_session_count=status.active_session_count,
        active_turn_count=status.active_turn_count,
        pending_interaction_count=status.pending_interaction_count,
        active_terminal_count=status.active_terminal_count,
        active_process_count=status.active_process_count,
        last_seen_at=status.last_seen_at,
    )


def target_inventory_payload(
    inventory: TargetInventorySnapshot | None,
) -> TargetInventoryPayload | None:
    if inventory is None:
        return None
    return TargetInventoryPayload(
        os_kind=inventory.os_kind,
        os_version=inventory.os_version,
        arch=inventory.arch,
        distro=inventory.distro,
        shell=inventory.shell,
        package_managers=inventory.package_managers,
        workspace_roots=inventory.workspace_roots,
        capabilities={
            "processSpawn": inventory.supports_process_spawn,
            "pty": inventory.supports_pty,
            "filesystem": inventory.supports_filesystem,
            "git": inventory.supports_git,
            "networkEgress": inventory.supports_network_egress,
            "portForwarding": inventory.supports_port_forwarding,
            "browser": inventory.supports_browser,
            "computerUse": inventory.supports_computer_use,
            "docker": inventory.supports_docker,
        },
        tool_versions={
            "node": inventory.node_version,
            "npm": inventory.npm_version,
            "python": inventory.python_version,
            "uv": inventory.uv_version,
            "git": inventory.git_version,
        },
        provider_readiness=inventory.provider_readiness,
        mcp_readiness=inventory.mcp_readiness,
        agent_catalog_revision=inventory.agent_catalog_revision,
        reported_at=inventory.reported_at,
    )


def target_summary_payload(detail: TargetDetailSnapshot) -> TargetSummary:
    target = detail.target
    return _target_summary(target, detail.status, detail.inventory)


def _target_summary(
    target: TargetSnapshot,
    status: TargetStatusSnapshot | None,
    inventory: TargetInventorySnapshot | None,
) -> TargetSummary:
    return TargetSummary(
        id=target.id,
        org_id=target.org_id,
        owner_user_id=target.owner_user_id,
        display_name=target.display_name,
        kind=target.kind.value,
        access_scope=target.access_scope.value,
        persistence_class=target.persistence_class.value,
        direct_attach_policy=target.direct_attach_policy.value,
        cloud_sync_enabled=target.cloud_sync_enabled,
        update_channel=target.update_channel.value,
        status=target_status_payload(status),
        inventory=target_inventory_payload(inventory),
    )
