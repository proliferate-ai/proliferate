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
from proliferate.db.models.cloud.agent_auth import SandboxProfile
from proliferate.db.models.cloud.cloud_target_runtime_access import CloudTargetRuntimeAccess
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.targets import (
    CloudTarget,
    CloudTargetInventory,
    CloudWorker,
)
from proliferate.db.models.cloud.targets import (
    CloudTargetStatus as CloudTargetStatusRow,
)
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.cloud_profile_target_guard import (
    ProfileTargetInvariantError,
    require_primary_managed_profile_target,
)
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
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID
    sandbox_profile_id: UUID | None
    profile_target_role: str
    default_workspace_root: str | None
    update_channel: str
    update_generation: int
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


@dataclass(frozen=True)
class TargetUpdateStatusWriteResult:
    target: CloudTargetSnapshot | None
    generation_matched: bool


@dataclass(frozen=True)
class CloudTargetRuntimeAccessSnapshot:
    id: UUID
    target_id: UUID
    sandbox_profile_id: UUID
    active_sandbox_id: UUID | None
    slot_generation: int | None
    anyharness_base_url: str | None
    runtime_token_ciphertext: str | None
    anyharness_data_key_ciphertext: str | None
    last_worker_id: UUID | None
    last_heartbeat_at: datetime | None
    created_at: datetime
    updated_at: datetime


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
        sandbox_profile_id=target.sandbox_profile_id,
        profile_target_role=target.profile_target_role,
        default_workspace_root=target.default_workspace_root,
        update_channel=target.update_channel,
        update_generation=target.update_generation,
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


def _runtime_access_snapshot(
    row: CloudTargetRuntimeAccess,
) -> CloudTargetRuntimeAccessSnapshot:
    return CloudTargetRuntimeAccessSnapshot(
        id=row.id,
        target_id=row.target_id,
        sandbox_profile_id=row.sandbox_profile_id,
        active_sandbox_id=row.active_sandbox_id,
        slot_generation=row.slot_generation,
        anyharness_base_url=row.anyharness_base_url,
        runtime_token_ciphertext=row.runtime_token_ciphertext,
        anyharness_data_key_ciphertext=row.anyharness_data_key_ciphertext,
        last_worker_id=row.last_worker_id,
        last_heartbeat_at=row.last_heartbeat_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
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
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    created_by_user_id: UUID,
    default_workspace_root: str | None,
    sandbox_profile_id: UUID | None = None,
    profile_target_role: str = "none",
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
        sandbox_profile_id=sandbox_profile_id,
        profile_target_role=profile_target_role,
        default_workspace_root=default_workspace_root,
        update_channel="stable",
        update_generation=0,
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


async def ensure_primary_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    created_by_user_id: UUID | None,
) -> CloudTargetSnapshot:
    profile = (
        await db.execute(
            select(SandboxProfile)
            .where(
                SandboxProfile.id == sandbox_profile_id,
                SandboxProfile.archived_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if profile is None:
        raise RuntimeError("Sandbox profile not found.")
    existing = (
        await db.execute(
            select(CloudTarget)
            .where(
                CloudTarget.sandbox_profile_id == sandbox_profile_id,
                CloudTarget.profile_target_role == "primary",
                CloudTarget.archived_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing is not None:
        status = await db.get(CloudTargetStatusRow, existing.id)
        inventory = await db.get(CloudTargetInventory, existing.id)
        worker = await _get_worker_for_status(db, status)
        return _target_snapshot(existing, status, inventory, worker)

    if profile.owner_scope == "personal":
        owner_user_id = profile.owner_user_id
        organization_id = None
        if owner_user_id is None:
            raise RuntimeError("Personal sandbox profile is missing owner_user_id.")
        target_created_by_user_id = created_by_user_id or owner_user_id
    else:
        owner_user_id = None
        organization_id = profile.organization_id
        if organization_id is None:
            raise RuntimeError("Organization sandbox profile is missing organization_id.")
        if created_by_user_id is None:
            raise RuntimeError("Organization primary target requires created_by_user_id.")
        target_created_by_user_id = created_by_user_id

    target = await create_target(
        db,
        display_name=(
            "Personal cloud sandbox"
            if profile.owner_scope == "personal"
            else "Shared cloud sandbox"
        ),
        kind="managed_cloud",
        owner_scope=profile.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=target_created_by_user_id,
        default_workspace_root=None,
        sandbox_profile_id=profile.id,
        profile_target_role="primary",
    )
    if profile.status == "configuring":
        profile.status = "provisioning"
        profile.updated_at = utcnow()
        await db.flush()
    return target


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
    target = (
        await db.execute(select(CloudTarget).where(CloudTarget.id == target_id).with_for_update())
    ).scalar_one_or_none()
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
        target.update_generation += 1
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


async def record_target_update_status_for_generation(
    db: AsyncSession,
    *,
    target_id: UUID,
    expected_update_generation: int,
    status_value: str,
    status_detail: str | None,
    component: str | None,
    version: str | None,
    reported_at: datetime,
) -> TargetUpdateStatusWriteResult:
    target = (
        await db.execute(select(CloudTarget).where(CloudTarget.id == target_id).with_for_update())
    ).scalar_one_or_none()
    if target is None:
        return TargetUpdateStatusWriteResult(target=None, generation_matched=True)
    if target.update_generation != expected_update_generation:
        return TargetUpdateStatusWriteResult(target=None, generation_matched=False)
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
    return TargetUpdateStatusWriteResult(
        target=_target_snapshot(target, status, inventory, worker),
        generation_matched=True,
    )


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


async def load_active_runtime_access_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> CloudTargetRuntimeAccessSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetRuntimeAccess).where(CloudTargetRuntimeAccess.target_id == target_id)
        )
    ).scalar_one_or_none()
    return _runtime_access_snapshot(row) if row is not None else None


async def update_target_runtime_access(
    db: AsyncSession,
    *,
    target_id: UUID,
    sandbox_profile_id: UUID,
    active_sandbox_id: UUID,
    slot_generation: int,
    anyharness_base_url: str | None,
    runtime_token_ciphertext: str | None,
    anyharness_data_key_ciphertext: str | None,
    worker_id: UUID | None,
    heartbeat_at: datetime,
) -> CloudTargetRuntimeAccessSnapshot | None:
    try:
        await require_primary_managed_profile_target(
            db,
            sandbox_profile_id=sandbox_profile_id,
            target_id=target_id,
        )
    except ProfileTargetInvariantError:
        return None
    active_slot = (
        await db.execute(
            select(CloudSandbox.id)
            .where(
                CloudSandbox.id == active_sandbox_id,
                CloudSandbox.sandbox_profile_id == sandbox_profile_id,
                CloudSandbox.target_id == target_id,
                CloudSandbox.slot_generation == slot_generation,
                CloudSandbox.superseded_at.is_(None),
            )
            .where(
                CloudSandbox.status.in_(
                    ("creating", "provisioning", "running", "paused", "blocked")
                )
            )
        )
    ).scalar_one_or_none()
    if active_slot is None:
        return None

    row = (
        await db.execute(
            select(CloudTargetRuntimeAccess)
            .where(CloudTargetRuntimeAccess.target_id == target_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        row = CloudTargetRuntimeAccess(
            target_id=target_id,
            sandbox_profile_id=sandbox_profile_id,
            active_sandbox_id=active_sandbox_id,
            slot_generation=slot_generation,
            anyharness_base_url=anyharness_base_url,
            runtime_token_ciphertext=runtime_token_ciphertext,
            anyharness_data_key_ciphertext=anyharness_data_key_ciphertext,
            last_worker_id=worker_id,
            last_heartbeat_at=heartbeat_at,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        slot_changed = (
            row.active_sandbox_id != active_sandbox_id or row.slot_generation != slot_generation
        )
        if row.active_sandbox_id not in {None, active_sandbox_id}:
            previous_slot = await db.get(CloudSandbox, row.active_sandbox_id)
            previous_slot_is_current = (
                previous_slot is not None
                and previous_slot.superseded_at is None
                and previous_slot.status
                in ("creating", "provisioning", "running", "paused", "blocked")
            )
            if previous_slot_is_current:
                return None
        elif row.slot_generation not in {None, slot_generation}:
            return None
        row.sandbox_profile_id = sandbox_profile_id
        row.active_sandbox_id = active_sandbox_id
        row.slot_generation = slot_generation
        if slot_changed:
            row.anyharness_base_url = anyharness_base_url
            row.runtime_token_ciphertext = runtime_token_ciphertext
            row.anyharness_data_key_ciphertext = anyharness_data_key_ciphertext
        else:
            if anyharness_base_url is not None:
                row.anyharness_base_url = anyharness_base_url
            if runtime_token_ciphertext is not None:
                row.runtime_token_ciphertext = runtime_token_ciphertext
            if anyharness_data_key_ciphertext is not None:
                row.anyharness_data_key_ciphertext = anyharness_data_key_ciphertext
        row.last_worker_id = worker_id
        row.last_heartbeat_at = heartbeat_at
        row.updated_at = now
    await db.flush()
    return _runtime_access_snapshot(row)


async def _get_worker_for_status(
    db: AsyncSession,
    status: CloudTargetStatusRow | None,
) -> CloudWorker | None:
    if status is None or status.worker_id is None:
        return None
    return await db.get(CloudWorker, status.worker_id)
