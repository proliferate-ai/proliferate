"""Cloud target registry persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from proliferate.constants.cloud import CloudTargetStatus, CloudTargetUpdateStatus
from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.cloud.targets import (
    CloudTarget,
    CloudTargetInventory,
    CloudWorker,
)
from proliferate.db.models.cloud.targets import (
    CloudTargetStatus as CloudTargetStatusRow,
)
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudTargetInventorySnapshot:
    target_id: UUID
    worker_id: UUID | None
    os: str | None
    arch: str | None
    distro: str | None
    shell: str | None
    git_json: str | None
    node_json: str | None
    python_json: str | None
    browser_json: str | None
    capabilities_json: str | None
    providers_json: str | None
    mcp_json: str | None
    raw_json: str | None
    updated_at: datetime


@dataclass(frozen=True)
class CloudTargetStatusSnapshot:
    target_id: UUID
    worker_id: UUID | None
    status: str
    status_detail: str | None
    last_seen_at: datetime | None
    last_heartbeat_at: datetime | None
    updated_at: datetime


@dataclass(frozen=True)
class CloudTargetCurrentVersionsSnapshot:
    worker_id: UUID
    worker_version: str | None
    anyharness_version: str | None
    supervisor_version: str | None
    reported_at: datetime | None


@dataclass(frozen=True)
class CloudTargetSnapshot:
    id: UUID
    display_name: str
    kind: str
    status: str
    owner_scope: str
    owner_user_id: UUID
    organization_id: UUID | None
    created_by_user_id: UUID
    default_workspace_root: str | None
    update_channel: str
    desired_anyharness_version: str | None
    desired_worker_version: str | None
    desired_supervisor_version: str | None
    update_status: str | None
    update_status_detail: str | None
    update_component: str | None
    update_version: str | None
    update_reported_at: datetime | None
    current_versions: CloudTargetCurrentVersionsSnapshot | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    status_record: CloudTargetStatusSnapshot | None
    inventory: CloudTargetInventorySnapshot | None


def _status_snapshot(row: CloudTargetStatusRow | None) -> CloudTargetStatusSnapshot | None:
    if row is None:
        return None
    return CloudTargetStatusSnapshot(
        target_id=row.target_id,
        worker_id=row.worker_id,
        status=row.status,
        status_detail=row.status_detail,
        last_seen_at=row.last_seen_at,
        last_heartbeat_at=row.last_heartbeat_at,
        updated_at=row.updated_at,
    )


def _inventory_snapshot(row: CloudTargetInventory | None) -> CloudTargetInventorySnapshot | None:
    if row is None:
        return None
    return CloudTargetInventorySnapshot(
        target_id=row.target_id,
        worker_id=row.worker_id,
        os=row.os,
        arch=row.arch,
        distro=row.distro,
        shell=row.shell,
        git_json=row.git_json,
        node_json=row.node_json,
        python_json=row.python_json,
        browser_json=row.browser_json,
        capabilities_json=row.capabilities_json,
        providers_json=row.providers_json,
        mcp_json=row.mcp_json,
        raw_json=row.raw_json,
        updated_at=row.updated_at,
    )


def _current_versions_snapshot(
    worker: CloudWorker | None,
) -> CloudTargetCurrentVersionsSnapshot | None:
    if worker is None:
        return None
    return CloudTargetCurrentVersionsSnapshot(
        worker_id=worker.id,
        worker_version=worker.worker_version,
        anyharness_version=worker.anyharness_version,
        supervisor_version=worker.supervisor_version,
        reported_at=worker.last_heartbeat_at,
    )


def _target_snapshot(
    target: CloudTarget,
    status: CloudTargetStatusRow | None,
    inventory: CloudTargetInventory | None,
    worker: CloudWorker | None,
) -> CloudTargetSnapshot:
    return CloudTargetSnapshot(
        id=target.id,
        display_name=target.display_name,
        kind=target.kind,
        status=status.status if status is not None else target.status,
        owner_scope=target.owner_scope,
        owner_user_id=target.owner_user_id,
        organization_id=target.organization_id,
        created_by_user_id=target.created_by_user_id,
        default_workspace_root=target.default_workspace_root,
        update_channel=target.update_channel,
        desired_anyharness_version=target.desired_anyharness_version,
        desired_worker_version=target.desired_worker_version,
        desired_supervisor_version=target.desired_supervisor_version,
        update_status=target.update_status,
        update_status_detail=target.update_status_detail,
        update_component=target.update_component,
        update_version=target.update_version,
        update_reported_at=target.update_reported_at,
        current_versions=_current_versions_snapshot(worker),
        archived_at=target.archived_at,
        created_at=target.created_at,
        updated_at=target.updated_at,
        status_record=_status_snapshot(status),
        inventory=_inventory_snapshot(inventory),
    )


def _visible_target_filter(user_id: UUID) -> ColumnElement[bool]:
    active_org_membership = exists().where(
        OrganizationMembership.organization_id == CloudTarget.organization_id,
        OrganizationMembership.user_id == user_id,
        OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    )
    return or_(
        and_(
            CloudTarget.owner_scope == "personal",
            or_(
                CloudTarget.owner_user_id == user_id,
                CloudTarget.created_by_user_id == user_id,
            ),
        ),
        and_(
            CloudTarget.owner_scope == "organization",
            CloudTarget.organization_id.is_not(None),
            active_org_membership,
        ),
    )


async def create_target(
    db: AsyncSession,
    *,
    display_name: str,
    kind: str,
    owner_scope: str,
    owner_user_id: UUID,
    organization_id: UUID | None,
    created_by_user_id: UUID,
    default_workspace_root: str | None,
) -> CloudTargetSnapshot:
    now = utcnow()
    target = CloudTarget(
        display_name=display_name,
        kind=kind,
        status=CloudTargetStatus.enrolling.value,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        default_workspace_root=default_workspace_root,
        update_channel="stable",
        archived_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(target)
    await db.flush()
    status = CloudTargetStatusRow(
        target_id=target.id,
        worker_id=None,
        status=CloudTargetStatus.enrolling.value,
        status_detail="Waiting for worker enrollment.",
        last_seen_at=None,
        last_heartbeat_at=None,
        updated_at=now,
    )
    db.add(status)
    await db.flush()
    return _target_snapshot(target, status, None, None)


async def get_target_by_id(
    db: AsyncSession,
    target_id: UUID,
) -> CloudTargetSnapshot | None:
    row = (
        await db.execute(
            select(CloudTarget, CloudTargetStatusRow, CloudTargetInventory, CloudWorker)
            .outerjoin(CloudTargetStatusRow, CloudTargetStatusRow.target_id == CloudTarget.id)
            .outerjoin(CloudTargetInventory, CloudTargetInventory.target_id == CloudTarget.id)
            .outerjoin(CloudWorker, CloudWorker.id == CloudTargetStatusRow.worker_id)
            .where(CloudTarget.id == target_id)
        )
    ).one_or_none()
    if row is None:
        return None
    target, status, inventory, worker = row
    return _target_snapshot(target, status, inventory, worker)


async def get_visible_target_by_id(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> CloudTargetSnapshot | None:
    row = (
        await db.execute(
            select(CloudTarget, CloudTargetStatusRow, CloudTargetInventory, CloudWorker)
            .outerjoin(CloudTargetStatusRow, CloudTargetStatusRow.target_id == CloudTarget.id)
            .outerjoin(CloudTargetInventory, CloudTargetInventory.target_id == CloudTarget.id)
            .outerjoin(CloudWorker, CloudWorker.id == CloudTargetStatusRow.worker_id)
            .where(CloudTarget.id == target_id)
            .where(_visible_target_filter(user_id))
        )
    ).one_or_none()
    if row is None:
        return None
    target, status, inventory, worker = row
    return _target_snapshot(target, status, inventory, worker)


async def list_visible_targets(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[CloudTargetSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudTarget, CloudTargetStatusRow, CloudTargetInventory, CloudWorker)
            .outerjoin(CloudTargetStatusRow, CloudTargetStatusRow.target_id == CloudTarget.id)
            .outerjoin(CloudTargetInventory, CloudTargetInventory.target_id == CloudTarget.id)
            .outerjoin(CloudWorker, CloudWorker.id == CloudTargetStatusRow.worker_id)
            .where(CloudTarget.status != CloudTargetStatus.archived.value)
            .where(_visible_target_filter(user_id))
            .order_by(CloudTarget.updated_at.desc(), CloudTarget.created_at.desc())
        )
    ).all()
    return tuple(
        _target_snapshot(target, status, inventory, worker)
        for target, status, inventory, worker in rows
    )


async def archive_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> CloudTargetSnapshot | None:
    target = await db.get(CloudTarget, target_id)
    if target is None:
        return None
    now = utcnow()
    target.status = CloudTargetStatus.archived.value
    target.archived_at = now
    target.updated_at = now
    status = await db.get(CloudTargetStatusRow, target_id)
    if status is not None:
        status.status = CloudTargetStatus.archived.value
        status.status_detail = "Target archived."
        status.updated_at = now
    await db.flush()
    inventory = await db.get(CloudTargetInventory, target_id)
    worker = await _get_worker_for_status(db, status)
    return _target_snapshot(target, status, inventory, worker)


async def set_target_desired_versions(
    db: AsyncSession,
    *,
    target_id: UUID,
    update_channel: str,
    desired_anyharness_version: str | None,
    desired_worker_version: str | None,
    desired_supervisor_version: str | None,
) -> CloudTargetSnapshot | None:
    target = await db.get(CloudTarget, target_id)
    if target is None:
        return None
    desired_versions_changed = (
        target.update_channel != update_channel
        or target.desired_anyharness_version != desired_anyharness_version
        or target.desired_worker_version != desired_worker_version
        or target.desired_supervisor_version != desired_supervisor_version
    )
    target.update_channel = update_channel
    target.desired_anyharness_version = desired_anyharness_version
    target.desired_worker_version = desired_worker_version
    target.desired_supervisor_version = desired_supervisor_version
    if desired_versions_changed:
        target.update_status = CloudTargetUpdateStatus.idle.value
        target.update_status_detail = "Desired versions changed."
        target.update_component = None
        target.update_version = None
        target.update_reported_at = None
    target.updated_at = utcnow()
    await db.flush()
    status = await db.get(CloudTargetStatusRow, target_id)
    inventory = await db.get(CloudTargetInventory, target_id)
    worker = await _get_worker_for_status(db, status)
    return _target_snapshot(target, status, inventory, worker)


async def record_target_update_status(
    db: AsyncSession,
    *,
    target_id: UUID,
    status_value: str,
    status_detail: str | None,
    component: str | None,
    version: str | None,
    reported_at: datetime,
) -> CloudTargetSnapshot | None:
    target = await db.get(CloudTarget, target_id)
    if target is None:
        return None
    target.update_status = status_value
    target.update_status_detail = status_detail
    target.update_component = component
    target.update_version = version
    target.update_reported_at = reported_at
    target.updated_at = reported_at
    await db.flush()
    status = await db.get(CloudTargetStatusRow, target_id)
    inventory = await db.get(CloudTargetInventory, target_id)
    worker = await _get_worker_for_status(db, status)
    return _target_snapshot(target, status, inventory, worker)


async def set_target_status(
    db: AsyncSession,
    *,
    target_id: UUID,
    status_value: str,
) -> None:
    target = await db.get(CloudTarget, target_id)
    if target is None:
        return
    target.status = status_value
    target.updated_at = utcnow()
    await db.flush()


async def _get_worker_for_status(
    db: AsyncSession,
    status: CloudTargetStatusRow | None,
) -> CloudWorker | None:
    if status is None or status.worker_id is None:
        return None
    return await db.get(CloudWorker, status.worker_id)
