"""Persistence helpers for cloud sync targets and workers."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.targets import (
    CloudTarget,
    CloudTargetInventory,
    CloudTargetStatus,
    CloudWorker,
    CloudWorkerEnrollment,
)
from proliferate.db.store.cloud_sync.json import (
    JsonObject,
    decode_array,
    decode_object,
    encode_array,
    encode_object,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class EnrollmentToken:
    id: UUID
    target_id: UUID | None
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class TargetRecord:
    id: UUID
    org_id: UUID
    owner_user_id: UUID | None
    created_by_user_id: UUID
    display_name: str
    kind: str
    access_scope: str
    cloud_sync_enabled: bool
    archived_at: datetime | None


@dataclass(frozen=True)
class WorkerRecord:
    id: UUID
    target_id: UUID
    org_id: UUID
    install_id: str
    status: str
    worker_version: str | None
    anyharness_version: str | None


@dataclass(frozen=True)
class TargetStatusRecord:
    target_id: UUID
    online_status: str
    worker_connected: bool
    anyharness_reachable: bool
    safe_stop_state: str
    safe_stop_reasons: list[object]
    active_session_count: int
    active_turn_count: int
    pending_interaction_count: int
    active_terminal_count: int
    active_process_count: int
    last_seen_at: datetime | None


@dataclass(frozen=True)
class TargetInventoryRecord:
    target_id: UUID
    os_kind: str | None
    os_version: str | None
    arch: str | None
    distro: str | None
    shell: str | None
    package_managers: list[object]
    workspace_roots: list[object]
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


def hash_worker_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _target_record(target: CloudTarget) -> TargetRecord:
    return TargetRecord(
        id=target.id,
        org_id=target.org_id,
        owner_user_id=target.owner_user_id,
        created_by_user_id=target.created_by_user_id,
        display_name=target.display_name,
        kind=target.kind,
        access_scope=target.access_scope,
        cloud_sync_enabled=target.cloud_sync_enabled,
        archived_at=target.archived_at,
    )


def _worker_record(worker: CloudWorker) -> WorkerRecord:
    return WorkerRecord(
        id=worker.id,
        target_id=worker.target_id,
        org_id=worker.org_id,
        install_id=worker.install_id,
        status=worker.status,
        worker_version=worker.worker_version,
        anyharness_version=worker.anyharness_version,
    )


def _status_record(status: CloudTargetStatus) -> TargetStatusRecord:
    return TargetStatusRecord(
        target_id=status.target_id,
        online_status=status.online_status,
        worker_connected=status.worker_connected,
        anyharness_reachable=status.anyharness_reachable,
        safe_stop_state=status.safe_stop_state,
        safe_stop_reasons=decode_array(status.safe_stop_reasons_json),
        active_session_count=status.active_session_count,
        active_turn_count=status.active_turn_count,
        pending_interaction_count=status.pending_interaction_count,
        active_terminal_count=status.active_terminal_count,
        active_process_count=status.active_process_count,
        last_seen_at=status.last_seen_at,
    )


def _inventory_record(inventory: CloudTargetInventory) -> TargetInventoryRecord:
    return TargetInventoryRecord(
        target_id=inventory.target_id,
        os_kind=inventory.os_kind,
        os_version=inventory.os_version,
        arch=inventory.arch,
        distro=inventory.distro,
        shell=inventory.shell,
        package_managers=decode_array(inventory.package_managers_json),
        workspace_roots=decode_array(inventory.workspace_roots_json),
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
        provider_readiness=decode_object(inventory.provider_readiness_json),
        mcp_readiness=decode_object(inventory.mcp_readiness_json),
        agent_catalog_revision=inventory.agent_catalog_revision,
        reported_at=inventory.reported_at,
    )


async def create_enrollment_token(
    db: AsyncSession,
    *,
    org_id: UUID,
    created_by_user_id: UUID,
    target_kind: str,
    display_name: str,
    access_scope: str,
    target_id: UUID | None = None,
    ttl_minutes: int = 30,
) -> EnrollmentToken:
    token = secrets.token_urlsafe(32)
    expires_at = utcnow() + timedelta(minutes=ttl_minutes)
    record = CloudWorkerEnrollment(
        org_id=org_id,
        created_by_user_id=created_by_user_id,
        target_id=target_id,
        target_kind=target_kind,
        display_name=display_name,
        access_scope=access_scope,
        token_hash=hash_worker_token(token),
        expires_at=expires_at,
    )
    db.add(record)
    await db.flush()
    return EnrollmentToken(id=record.id, target_id=target_id, token=token, expires_at=expires_at)


async def consume_enrollment_token(
    db: AsyncSession,
    *,
    token: str,
) -> CloudWorkerEnrollment | None:
    record = (
        await db.execute(
            select(CloudWorkerEnrollment).where(
                CloudWorkerEnrollment.token_hash == hash_worker_token(token)
            )
        )
    ).scalar_one_or_none()
    if record is None or record.used_at is not None or record.expires_at <= utcnow():
        return None
    record.used_at = utcnow()
    await db.flush()
    return record


async def create_target_for_enrollment(
    db: AsyncSession,
    *,
    enrollment: CloudWorkerEnrollment,
    owner_user_id: UUID | None,
) -> TargetRecord:
    target = CloudTarget(
        org_id=enrollment.org_id,
        owner_user_id=owner_user_id,
        created_by_user_id=enrollment.created_by_user_id,
        display_name=enrollment.display_name,
        kind=enrollment.target_kind,
        access_scope=enrollment.access_scope,
        cloud_sync_enabled=True,
    )
    db.add(target)
    await db.flush()
    return _target_record(target)


async def create_worker(
    db: AsyncSession,
    *,
    target_id: UUID,
    org_id: UUID,
    install_id: str,
    token: str,
    worker_version: str | None,
    anyharness_version: str | None,
) -> WorkerRecord:
    worker = CloudWorker(
        target_id=target_id,
        org_id=org_id,
        install_id=install_id,
        token_hash=hash_worker_token(token),
        worker_version=worker_version,
        anyharness_version=anyharness_version,
        last_seen_at=utcnow(),
    )
    db.add(worker)
    await db.flush()
    await upsert_target_status(
        db,
        target_id=target_id,
        online_status="online",
        worker_connected=True,
        anyharness_reachable=True,
        anyharness_version=anyharness_version,
        worker_version=worker_version,
        supervisor_version=None,
        safe_stop_state="unknown",
        safe_stop_reasons=[],
        active_session_count=0,
        active_turn_count=0,
        pending_interaction_count=0,
        active_terminal_count=0,
        active_process_count=0,
    )
    return _worker_record(worker)


async def authenticate_worker(
    db: AsyncSession,
    *,
    worker_id: UUID,
    target_id: UUID,
    token: str,
) -> WorkerRecord | None:
    worker = await db.get(CloudWorker, worker_id)
    if (
        worker is None
        or worker.target_id != target_id
        or worker.status != "active"
        or worker.token_hash != hash_worker_token(token)
    ):
        return None
    return _worker_record(worker)


async def get_target(db: AsyncSession, target_id: UUID) -> TargetRecord | None:
    target = await db.get(CloudTarget, target_id)
    if target is None:
        return None
    return _target_record(target)


async def list_targets_for_org(db: AsyncSession, org_id: UUID) -> tuple[TargetRecord, ...]:
    rows = await db.execute(
        select(CloudTarget)
        .where(CloudTarget.org_id == org_id, CloudTarget.archived_at.is_(None))
        .order_by(CloudTarget.updated_at.desc())
    )
    return tuple(_target_record(row) for row in rows.scalars().all())


async def upsert_target_status(
    db: AsyncSession,
    *,
    target_id: UUID,
    online_status: str,
    worker_connected: bool,
    anyharness_reachable: bool,
    anyharness_version: str | None,
    worker_version: str | None,
    supervisor_version: str | None,
    safe_stop_state: str,
    safe_stop_reasons: list[object],
    active_session_count: int,
    active_turn_count: int,
    pending_interaction_count: int,
    active_terminal_count: int,
    active_process_count: int,
) -> TargetStatusRecord:
    status = await db.get(CloudTargetStatus, target_id)
    if status is None:
        status = CloudTargetStatus(target_id=target_id)
        db.add(status)
    now = utcnow()
    status.online_status = online_status
    status.last_seen_at = now
    status.last_activity_at = now
    status.worker_connected = worker_connected
    status.anyharness_reachable = anyharness_reachable
    status.anyharness_version = anyharness_version
    status.worker_version = worker_version
    status.supervisor_version = supervisor_version
    status.safe_stop_state = safe_stop_state
    status.safe_stop_reasons_json = encode_array(safe_stop_reasons)
    status.active_session_count = active_session_count
    status.active_turn_count = active_turn_count
    status.pending_interaction_count = pending_interaction_count
    status.active_terminal_count = active_terminal_count
    status.active_process_count = active_process_count
    status.updated_at = now
    await db.flush()
    return _status_record(status)


async def get_target_status(db: AsyncSession, target_id: UUID) -> TargetStatusRecord | None:
    status = await db.get(CloudTargetStatus, target_id)
    if status is None:
        return None
    return _status_record(status)


async def upsert_target_inventory(
    db: AsyncSession,
    *,
    target_id: UUID,
    os_kind: str | None,
    os_version: str | None,
    arch: str | None,
    distro: str | None,
    shell: str | None,
    package_managers: list[object],
    workspace_roots: list[object],
    capabilities: JsonObject,
    tool_versions: JsonObject,
    provider_readiness: JsonObject,
    mcp_readiness: JsonObject,
    agent_catalog_revision: str | None,
) -> TargetInventoryRecord:
    inventory = await db.get(CloudTargetInventory, target_id)
    if inventory is None:
        inventory = CloudTargetInventory(target_id=target_id)
        db.add(inventory)
    inventory.os_kind = os_kind
    inventory.os_version = os_version
    inventory.arch = arch
    inventory.distro = distro
    inventory.shell = shell
    inventory.package_managers_json = encode_array(package_managers)
    inventory.workspace_roots_json = encode_array(workspace_roots)
    inventory.supports_process_spawn = bool(capabilities.get("processSpawn", False))
    inventory.supports_pty = bool(capabilities.get("pty", False))
    inventory.supports_filesystem = bool(capabilities.get("filesystem", False))
    inventory.supports_git = bool(capabilities.get("git", False))
    inventory.supports_network_egress = bool(capabilities.get("networkEgress", False))
    inventory.supports_port_forwarding = bool(capabilities.get("portForwarding", False))
    inventory.supports_browser = bool(capabilities.get("browser", False))
    inventory.supports_computer_use = bool(capabilities.get("computerUse", False))
    inventory.supports_docker = bool(capabilities.get("docker", False))
    inventory.node_version = str(tool_versions.get("node")) if tool_versions.get("node") else None
    inventory.npm_version = str(tool_versions.get("npm")) if tool_versions.get("npm") else None
    python_version = tool_versions.get("python")
    inventory.python_version = str(python_version) if python_version else None
    inventory.uv_version = str(tool_versions.get("uv")) if tool_versions.get("uv") else None
    inventory.git_version = str(tool_versions.get("git")) if tool_versions.get("git") else None
    inventory.provider_readiness_json = encode_object(provider_readiness)
    inventory.mcp_readiness_json = encode_object(mcp_readiness)
    inventory.agent_catalog_revision = agent_catalog_revision
    inventory.reported_at = utcnow()
    await db.flush()
    return _inventory_record(inventory)


async def get_target_inventory(db: AsyncSession, target_id: UUID) -> TargetInventoryRecord | None:
    inventory = await db.get(CloudTargetInventory, target_id)
    if inventory is None:
        return None
    return _inventory_record(inventory)
