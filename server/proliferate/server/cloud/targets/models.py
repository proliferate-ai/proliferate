"""Request and response models for cloud compute targets."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sync.targets import (
    CloudTargetCurrentVersionsSnapshot,
    CloudTargetInventorySnapshot,
    CloudTargetSnapshot,
    CloudTargetStatusSnapshot,
)


def _to_iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _parse_json(value: str | None) -> dict[str, object] | None:
    if value is None:
        return None
    parsed = cast(object, json.loads(value))
    return parsed if isinstance(parsed, dict) else {"value": parsed}


class CloudTargetInventoryModel(BaseModel):
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
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudTargetStatusModel(BaseModel):
    status: str
    status_detail: str | None = Field(default=None, serialization_alias="statusDetail")
    last_seen_at: str | None = Field(default=None, serialization_alias="lastSeenAt")
    last_heartbeat_at: str | None = Field(default=None, serialization_alias="lastHeartbeatAt")
    updated_at: str | None = Field(default=None, serialization_alias="updatedAt")


class CloudTargetDesiredVersionsModel(BaseModel):
    anyharness_version: str | None = Field(
        default=None,
        serialization_alias="anyharnessVersion",
    )
    worker_version: str | None = Field(default=None, serialization_alias="workerVersion")
    supervisor_version: str | None = Field(
        default=None,
        serialization_alias="supervisorVersion",
    )


class CloudTargetCurrentVersionsModel(BaseModel):
    worker_id: str = Field(serialization_alias="workerId")
    anyharness_version: str | None = Field(
        default=None,
        serialization_alias="anyharnessVersion",
    )
    worker_version: str | None = Field(default=None, serialization_alias="workerVersion")
    supervisor_version: str | None = Field(
        default=None,
        serialization_alias="supervisorVersion",
    )
    reported_at: str | None = Field(default=None, serialization_alias="reportedAt")


class CloudTargetUpdateModel(BaseModel):
    channel: str
    generation: int
    desired_versions: CloudTargetDesiredVersionsModel = Field(
        serialization_alias="desiredVersions",
    )
    current_versions: CloudTargetCurrentVersionsModel | None = Field(
        default=None,
        serialization_alias="currentVersions",
    )
    status: str | None = None
    status_detail: str | None = Field(default=None, serialization_alias="statusDetail")
    component: str | None = None
    version: str | None = None
    reported_at: str | None = Field(default=None, serialization_alias="reportedAt")


class CloudTargetSummary(BaseModel):
    id: str
    display_name: str = Field(serialization_alias="displayName")
    kind: str
    status: str
    owner_scope: str = Field(serialization_alias="ownerScope")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
    default_workspace_root: str | None = Field(
        default=None,
        serialization_alias="defaultWorkspaceRoot",
    )
    inventory: CloudTargetInventoryModel | None = None
    status_detail: CloudTargetStatusModel | None = Field(
        default=None,
        serialization_alias="statusDetail",
    )
    update: CloudTargetUpdateModel
    archived_at: str | None = Field(default=None, serialization_alias="archivedAt")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudTargetDetail(CloudTargetSummary):
    owner_user_id: str = Field(serialization_alias="ownerUserId")
    created_by_user_id: str = Field(serialization_alias="createdByUserId")


class CloudTargetEnrollmentRequest(BaseModel):
    display_name: str = Field(alias="displayName")
    kind: str = "ssh"
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")
    default_workspace_root: str | None = Field(default=None, alias="defaultWorkspaceRoot")
    ttl_seconds: int | None = Field(default=None, alias="ttlSeconds")


class CloudTargetEnrollmentResponse(BaseModel):
    target: CloudTargetDetail
    enrollment_token: str = Field(serialization_alias="enrollmentToken")
    install_command: str = Field(serialization_alias="installCommand")
    expires_at: str = Field(serialization_alias="expiresAt")


class ArchiveCloudTargetResponse(BaseModel):
    target: CloudTargetDetail


def inventory_payload(
    value: CloudTargetInventorySnapshot | None,
) -> CloudTargetInventoryModel | None:
    if value is None:
        return None
    return CloudTargetInventoryModel(
        os=value.os,
        arch=value.arch,
        distro=value.distro,
        shell=value.shell,
        git=_parse_json(value.git_json),
        node=_parse_json(value.node_json),
        python=_parse_json(value.python_json),
        browser=_parse_json(value.browser_json),
        capabilities=_parse_json(value.capabilities_json),
        providers=_parse_json(value.providers_json),
        mcp=_parse_json(value.mcp_json),
        updated_at=_to_iso(value.updated_at),
    )


def status_payload(
    value: CloudTargetStatusSnapshot | None,
) -> CloudTargetStatusModel | None:
    if value is None:
        return None
    return CloudTargetStatusModel(
        status=value.status,
        status_detail=value.status_detail,
        last_seen_at=_to_iso(value.last_seen_at),
        last_heartbeat_at=_to_iso(value.last_heartbeat_at),
        updated_at=_to_iso(value.updated_at),
    )


def current_versions_payload(
    value: CloudTargetCurrentVersionsSnapshot | None,
) -> CloudTargetCurrentVersionsModel | None:
    if value is None:
        return None
    return CloudTargetCurrentVersionsModel(
        worker_id=str(value.worker_id),
        anyharness_version=value.anyharness_version,
        worker_version=value.worker_version,
        supervisor_version=value.supervisor_version,
        reported_at=_to_iso(value.reported_at),
    )


def update_payload(value: CloudTargetSnapshot) -> CloudTargetUpdateModel:
    return CloudTargetUpdateModel(
        channel=value.update_channel,
        generation=value.update_generation,
        desired_versions=CloudTargetDesiredVersionsModel(
            anyharness_version=value.desired_anyharness_version,
            worker_version=value.desired_worker_version,
            supervisor_version=value.desired_supervisor_version,
        ),
        current_versions=current_versions_payload(value.current_versions),
        status=value.update_status,
        status_detail=value.update_status_detail,
        component=value.update_component,
        version=value.update_version,
        reported_at=_to_iso(value.update_reported_at),
    )


def target_summary_payload(value: CloudTargetSnapshot) -> CloudTargetSummary:
    return CloudTargetSummary(
        id=str(value.id),
        display_name=value.display_name,
        kind=value.kind,
        status=value.status,
        owner_scope=value.owner_scope,
        organization_id=str(value.organization_id) if value.organization_id else None,
        default_workspace_root=value.default_workspace_root,
        inventory=inventory_payload(value.inventory),
        status_detail=status_payload(value.status_record),
        update=update_payload(value),
        archived_at=_to_iso(value.archived_at),
        created_at=_to_iso(value.created_at),
        updated_at=_to_iso(value.updated_at),
    )


def target_detail_payload(value: CloudTargetSnapshot) -> CloudTargetDetail:
    return CloudTargetDetail(
        **target_summary_payload(value).model_dump(),
        owner_user_id=str(value.owner_user_id),
        created_by_user_id=str(value.created_by_user_id),
    )
