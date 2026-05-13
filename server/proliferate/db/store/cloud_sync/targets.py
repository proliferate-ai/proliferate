"""Persistence helpers for cloud worker targets."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.targets import (
    CloudTarget,
    CloudTargetEnrollment,
    CloudTargetInventory,
    CloudTargetStatus,
    CloudWorker,
)
from proliferate.db.store.cloud_sync.target_records import (
    AnyHarnessEndpointKind,
    DirectAttachPolicy,
    EnrollmentTokenSnapshot,
    HeartbeatReport,
    InventoryReport,
    SafeStopState,
    TargetAccessScope,
    TargetDetailSnapshot,
    TargetInventorySnapshot,
    TargetKind,
    TargetOnlineStatus,
    TargetPersistenceClass,
    TargetStatusSnapshot,
    TargetUpdateChannel,
    WorkerEnrollmentSnapshot,
    WorkerSnapshot,
    WorkerStatus,
    enrollment_snapshot,
    inventory_snapshot,
    status_snapshot,
    target_snapshot,
    worker_snapshot,
)
from proliferate.utils.time import utcnow


async def create_target_enrollment(
    db: AsyncSession,
    *,
    org_id: UUID,
    owner_user_id: UUID | None,
    created_by_user_id: UUID,
    token_hash: str,
    display_name: str,
    kind: TargetKind,
    access_scope: TargetAccessScope,
    expires_at: datetime,
    default_workspace_root: str | None,
    persistence_class: TargetPersistenceClass,
    direct_attach_policy: DirectAttachPolicy,
    cloud_sync_enabled: bool,
    update_channel: TargetUpdateChannel,
) -> EnrollmentTokenSnapshot:
    now = utcnow()
    enrollment = CloudTargetEnrollment(
        org_id=org_id,
        owner_user_id=owner_user_id,
        created_by_user_id=created_by_user_id,
        token_hash=token_hash,
        display_name=display_name,
        kind=kind.value,
        access_scope=access_scope.value,
        expires_at=expires_at,
        default_workspace_root=default_workspace_root,
        persistence_class=persistence_class.value,
        direct_attach_policy=direct_attach_policy.value,
        cloud_sync_enabled=cloud_sync_enabled,
        update_channel=update_channel.value,
        created_at=now,
        updated_at=now,
    )
    db.add(enrollment)
    await db.flush()
    return enrollment_snapshot(enrollment)


async def list_targets_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[TargetDetailSnapshot, ...]:
    rows = await db.execute(
        select(CloudTarget)
        .where(CloudTarget.owner_user_id == user_id)
        .where(CloudTarget.archived_at.is_(None))
        .order_by(CloudTarget.updated_at.desc())
    )
    snapshots: list[TargetDetailSnapshot] = []
    for target in rows.scalars().all():
        snapshots.append(await _target_detail_snapshot(db, target))
    return tuple(snapshots)


async def get_target_detail_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_id: UUID,
) -> TargetDetailSnapshot | None:
    target = (
        await db.execute(
            select(CloudTarget).where(
                CloudTarget.id == target_id,
                CloudTarget.owner_user_id == user_id,
                CloudTarget.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if target is None:
        return None
    return await _target_detail_snapshot(db, target)


async def get_target_detail(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> TargetDetailSnapshot | None:
    target = await db.get(CloudTarget, target_id)
    if target is None or target.archived_at is not None:
        return None
    return await _target_detail_snapshot(db, target)


async def archive_target_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_id: UUID,
) -> TargetDetailSnapshot | None:
    target = (
        await db.execute(
            select(CloudTarget).where(
                CloudTarget.id == target_id,
                CloudTarget.owner_user_id == user_id,
                CloudTarget.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if target is None:
        return None
    target.archived_at = utcnow()
    target.updated_at = target.archived_at
    await db.flush()
    return await _target_detail_snapshot(db, target)


async def consume_enrollment_for_worker(
    db: AsyncSession,
    *,
    token_hash: str,
    worker_credential_hash: str,
    install_id: str,
    worker_version: str | None,
    supervisor_version: str | None,
    endpoint_kind: AnyHarnessEndpointKind,
    inventory: InventoryReport | None,
    now: datetime,
) -> WorkerEnrollmentSnapshot | None:
    enrollment = (
        await db.execute(
            select(CloudTargetEnrollment)
            .where(CloudTargetEnrollment.token_hash == token_hash)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if enrollment is None or enrollment.consumed_at is not None or enrollment.expires_at <= now:
        return None

    target = await _load_or_create_target(db, enrollment, now)
    worker = await _load_or_create_worker(
        db,
        target=target,
        install_id=install_id,
        credential_hash=worker_credential_hash,
        worker_version=worker_version,
        supervisor_version=supervisor_version,
        endpoint_kind=endpoint_kind,
        now=now,
    )
    status = await _upsert_status(
        db,
        target=target,
        report=HeartbeatReport(
            heartbeat_id=None,
            worker_version=worker_version,
            supervisor_version=supervisor_version,
            anyharness_version=None,
            worker_connected=True,
            anyharness_reachable=False,
            safe_stop_state=SafeStopState.unknown,
            safe_stop_reasons={},
            active_session_count=0,
            active_turn_count=0,
            pending_interaction_count=0,
            active_terminal_count=0,
            active_process_count=0,
            last_activity_at=None,
        ),
        now=now,
    )
    inventory_snapshot = None
    if inventory is not None:
        inventory_snapshot = await _upsert_inventory(db, target=target, report=inventory, now=now)

    enrollment.target_id = target.id
    enrollment.consumed_at = now
    enrollment.updated_at = now
    await db.flush()
    return WorkerEnrollmentSnapshot(
        target=target_snapshot(target),
        worker=worker_snapshot(worker),
        status=status,
        inventory=inventory_snapshot,
    )


async def get_active_worker_by_credential(
    db: AsyncSession,
    *,
    worker_id: UUID,
    target_id: UUID,
    credential_hash: str,
) -> WorkerSnapshot | None:
    worker = (
        await db.execute(
            select(CloudWorker).where(
                CloudWorker.id == worker_id,
                CloudWorker.target_id == target_id,
                CloudWorker.credential_hash == credential_hash,
                CloudWorker.status == WorkerStatus.active.value,
                CloudWorker.revoked_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if worker is None:
        return None
    return worker_snapshot(worker)


async def update_worker_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
    target_id: UUID,
    report: HeartbeatReport,
    now: datetime,
) -> TargetStatusSnapshot | None:
    worker = await db.get(CloudWorker, worker_id)
    target = await db.get(CloudTarget, target_id)
    if worker is None or target is None or worker.target_id != target_id:
        return None
    worker.last_seen_at = now
    worker.last_heartbeat_id = report.heartbeat_id
    worker.worker_version = report.worker_version
    worker.supervisor_version = report.supervisor_version
    worker.updated_at = now
    return await _upsert_status(db, target=target, report=report, now=now)


async def upsert_target_inventory(
    db: AsyncSession,
    *,
    target_id: UUID,
    report: InventoryReport,
    now: datetime,
) -> TargetInventorySnapshot | None:
    target = await db.get(CloudTarget, target_id)
    if target is None:
        return None
    return await _upsert_inventory(db, target=target, report=report, now=now)


async def _load_or_create_target(
    db: AsyncSession,
    enrollment: CloudTargetEnrollment,
    now: datetime,
) -> CloudTarget:
    if enrollment.target_id is not None:
        target = await db.get(CloudTarget, enrollment.target_id)
        if target is not None:
            return target

    target = CloudTarget(
        org_id=enrollment.org_id,
        owner_user_id=enrollment.owner_user_id,
        display_name=enrollment.display_name,
        kind=enrollment.kind,
        access_scope=enrollment.access_scope,
        created_by_user_id=enrollment.created_by_user_id,
        default_workspace_root=enrollment.default_workspace_root,
        persistence_class=enrollment.persistence_class,
        direct_attach_policy=enrollment.direct_attach_policy,
        cloud_sync_enabled=enrollment.cloud_sync_enabled,
        update_channel=enrollment.update_channel,
        created_at=now,
        updated_at=now,
    )
    db.add(target)
    await db.flush()
    return target


async def _load_or_create_worker(
    db: AsyncSession,
    *,
    target: CloudTarget,
    install_id: str,
    credential_hash: str,
    worker_version: str | None,
    supervisor_version: str | None,
    endpoint_kind: AnyHarnessEndpointKind,
    now: datetime,
) -> CloudWorker:
    worker = (
        await db.execute(select(CloudWorker).where(CloudWorker.install_id == install_id))
    ).scalar_one_or_none()
    if worker is None:
        worker = CloudWorker(
            target_id=target.id,
            org_id=target.org_id,
            install_id=install_id,
            credential_hash=credential_hash,
            status=WorkerStatus.active.value,
            auth_version=1,
            last_seen_at=now,
            worker_version=worker_version,
            supervisor_version=supervisor_version,
            anyharness_endpoint_kind=endpoint_kind.value,
            created_at=now,
            updated_at=now,
        )
        db.add(worker)
        await db.flush()
        return worker

    worker.target_id = target.id
    worker.org_id = target.org_id
    worker.credential_hash = credential_hash
    worker.status = WorkerStatus.active.value
    worker.last_seen_at = now
    worker.worker_version = worker_version
    worker.supervisor_version = supervisor_version
    worker.anyharness_endpoint_kind = endpoint_kind.value
    worker.revoked_at = None
    worker.updated_at = now
    await db.flush()
    return worker


async def _upsert_status(
    db: AsyncSession,
    *,
    target: CloudTarget,
    report: HeartbeatReport,
    now: datetime,
) -> TargetStatusSnapshot:
    status = (
        await db.execute(select(CloudTargetStatus).where(CloudTargetStatus.target_id == target.id))
    ).scalar_one_or_none()
    online_status = (
        TargetOnlineStatus.online
        if report.worker_connected and report.anyharness_reachable
        else TargetOnlineStatus.degraded
        if report.worker_connected
        else TargetOnlineStatus.offline
    )
    if status is None:
        status = CloudTargetStatus(target_id=target.id, org_id=target.org_id, created_at=now)
        db.add(status)
    status.online_status = online_status.value
    status.last_seen_at = now
    status.last_activity_at = report.last_activity_at
    status.worker_connected = report.worker_connected
    status.anyharness_reachable = report.anyharness_reachable
    status.anyharness_version = report.anyharness_version
    status.worker_version = report.worker_version
    status.supervisor_version = report.supervisor_version
    status.safe_stop_state = report.safe_stop_state.value
    status.safe_stop_reasons = report.safe_stop_reasons
    status.active_session_count = report.active_session_count
    status.active_turn_count = report.active_turn_count
    status.pending_interaction_count = report.pending_interaction_count
    status.active_terminal_count = report.active_terminal_count
    status.active_process_count = report.active_process_count
    status.updated_at = now
    await db.flush()
    return status_snapshot(status)


async def _upsert_inventory(
    db: AsyncSession,
    *,
    target: CloudTarget,
    report: InventoryReport,
    now: datetime,
) -> TargetInventorySnapshot:
    inventory = (
        await db.execute(
            select(CloudTargetInventory).where(CloudTargetInventory.target_id == target.id)
        )
    ).scalar_one_or_none()
    if inventory is None:
        inventory = CloudTargetInventory(
            target_id=target.id,
            org_id=target.org_id,
            created_at=now,
            reported_at=report.reported_at,
        )
        db.add(inventory)
    inventory.os_kind = report.os_kind
    inventory.os_version = report.os_version
    inventory.arch = report.arch
    inventory.distro = report.distro
    inventory.shell = report.shell
    inventory.package_managers = report.package_managers
    inventory.workspace_roots = report.workspace_roots
    inventory.supports_process_spawn = report.supports_process_spawn
    inventory.supports_pty = report.supports_pty
    inventory.supports_filesystem = report.supports_filesystem
    inventory.supports_git = report.supports_git
    inventory.supports_network_egress = report.supports_network_egress
    inventory.supports_port_forwarding = report.supports_port_forwarding
    inventory.supports_browser = report.supports_browser
    inventory.supports_computer_use = report.supports_computer_use
    inventory.supports_docker = report.supports_docker
    inventory.node_version = report.node_version
    inventory.npm_version = report.npm_version
    inventory.python_version = report.python_version
    inventory.uv_version = report.uv_version
    inventory.git_version = report.git_version
    inventory.provider_readiness = report.provider_readiness
    inventory.mcp_readiness = report.mcp_readiness
    inventory.agent_catalog_revision = report.agent_catalog_revision
    inventory.reported_at = report.reported_at
    inventory.updated_at = now

    status = (
        await db.execute(select(CloudTargetStatus).where(CloudTargetStatus.target_id == target.id))
    ).scalar_one_or_none()
    if status is not None:
        status.last_inventory_at = report.reported_at
        status.updated_at = now
    await db.flush()
    return inventory_snapshot(inventory)


async def _target_detail_snapshot(
    db: AsyncSession,
    target: CloudTarget,
) -> TargetDetailSnapshot:
    status = (
        await db.execute(select(CloudTargetStatus).where(CloudTargetStatus.target_id == target.id))
    ).scalar_one_or_none()
    inventory = (
        await db.execute(
            select(CloudTargetInventory).where(CloudTargetInventory.target_id == target.id)
        )
    ).scalar_one_or_none()
    worker = (
        (
            await db.execute(
                select(CloudWorker)
                .where(
                    CloudWorker.target_id == target.id,
                    CloudWorker.status == WorkerStatus.active.value,
                    CloudWorker.revoked_at.is_(None),
                )
                .order_by(
                    CloudWorker.last_seen_at.desc().nullslast(), CloudWorker.updated_at.desc()
                )
            )
        )
        .scalars()
        .first()
    )
    return TargetDetailSnapshot(
        target=target_snapshot(target),
        status=status_snapshot(status) if status is not None else None,
        inventory=inventory_snapshot(inventory) if inventory is not None else None,
        active_worker=worker_snapshot(worker) if worker is not None else None,
    )
