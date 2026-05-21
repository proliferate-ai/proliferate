"""Persistence helpers for logical cloud workspace mobility records."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.analytics import CloudWorkspaceMobilityEvent
from proliferate.db.models.cloud.mobility import (
    CloudWorkspaceHandoffOp,
    CloudWorkspaceMobility,
    CloudWorkspaceMoveCleanupItem,
)
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.utils.time import utcnow


class RetryableMobilityFailurePredicate(Protocol):
    def __call__(
        self,
        *,
        lifecycle_state: str,
        has_active_handoff: bool,
    ) -> bool: ...


@dataclass(frozen=True)
class CloudWorkspaceHandoffOpValue:
    id: UUID
    mobility_workspace_id: UUID
    user_id: UUID
    direction: str
    source_owner: str
    target_owner: str
    phase: str
    requested_branch: str
    requested_base_sha: str | None
    exclude_paths: tuple[str, ...]
    failure_code: str | None
    failure_detail: str | None
    started_at: datetime
    heartbeat_at: datetime
    finalized_at: datetime | None
    cleanup_completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    canonical_side: str = "source"


@dataclass(frozen=True)
class CloudWorkspaceMobilityValue:
    id: UUID
    user_id: UUID
    display_name: str | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    owner: str
    lifecycle_state: str
    status_detail: str | None
    last_error: str | None
    cloud_workspace_id: UUID | None
    active_handoff_op_id: UUID | None
    last_handoff_op_id: UUID | None
    cloud_lost_at: datetime | None
    cloud_lost_reason: str | None
    created_at: datetime
    updated_at: datetime
    active_handoff: CloudWorkspaceHandoffOpValue | None


@dataclass(frozen=True)
class CloudWorkspaceMoveCleanupItemInput:
    item_kind: str
    target_id: UUID | None = None
    anyharness_workspace_id: str | None = None
    object_id: UUID | None = None


@dataclass(frozen=True)
class CloudWorkspaceMoveCleanupItemValue:
    id: UUID
    handoff_op_id: UUID
    item_kind: str
    target_id: UUID | None
    anyharness_workspace_id: str | None
    object_id: UUID | None
    status: str
    attempt_count: int
    next_attempt_at: datetime
    error_code: str | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _decode_exclude_paths(raw: str | None) -> tuple[str, ...]:
    try:
        decoded = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return ()
    if not isinstance(decoded, list):
        return ()
    return tuple(item for item in decoded if isinstance(item, str) and item.strip())


def _normalize_owner(owner: str) -> str:
    return "personal_cloud" if owner == "cloud" else owner


def _handoff_value(record: CloudWorkspaceHandoffOp) -> CloudWorkspaceHandoffOpValue:
    return CloudWorkspaceHandoffOpValue(
        id=record.id,
        mobility_workspace_id=record.mobility_workspace_id,
        user_id=record.user_id,
        direction=record.direction,
        source_owner=_normalize_owner(record.source_owner),
        target_owner=_normalize_owner(record.target_owner),
        phase=record.phase,
        canonical_side=record.canonical_side,
        requested_branch=record.requested_branch,
        requested_base_sha=record.requested_base_sha,
        exclude_paths=_decode_exclude_paths(record.exclude_paths_json),
        failure_code=record.failure_code,
        failure_detail=record.failure_detail,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        finalized_at=record.finalized_at,
        cleanup_completed_at=record.cleanup_completed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _cleanup_item_value(
    record: CloudWorkspaceMoveCleanupItem,
) -> CloudWorkspaceMoveCleanupItemValue:
    return CloudWorkspaceMoveCleanupItemValue(
        id=record.id,
        handoff_op_id=record.handoff_op_id,
        item_kind=record.item_kind,
        target_id=record.target_id,
        anyharness_workspace_id=record.anyharness_workspace_id,
        object_id=record.object_id,
        status=record.status,
        attempt_count=record.attempt_count,
        next_attempt_at=record.next_attempt_at,
        error_code=record.error_code,
        error_message=record.error_message,
        started_at=record.started_at,
        completed_at=record.completed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _mobility_value(
    record: CloudWorkspaceMobility,
    *,
    active_handoff: CloudWorkspaceHandoffOp | None = None,
) -> CloudWorkspaceMobilityValue:
    return CloudWorkspaceMobilityValue(
        id=record.id,
        user_id=record.user_id,
        display_name=record.display_name,
        git_provider=record.git_provider,
        git_owner=record.git_owner,
        git_repo_name=record.git_repo_name,
        git_branch=record.git_branch,
        owner=_normalize_owner(record.owner),
        lifecycle_state=record.lifecycle_state,
        status_detail=record.status_detail,
        last_error=record.last_error,
        cloud_workspace_id=record.cloud_workspace_id,
        active_handoff_op_id=record.active_handoff_op_id,
        last_handoff_op_id=record.last_handoff_op_id,
        cloud_lost_at=record.cloud_lost_at,
        cloud_lost_reason=record.cloud_lost_reason,
        created_at=record.created_at,
        updated_at=record.updated_at,
        active_handoff=(_handoff_value(active_handoff) if active_handoff is not None else None),
    )


def _require_handoff_belongs_to_workspace(
    mobility_workspace: CloudWorkspaceMobility | None,
    handoff_op: CloudWorkspaceHandoffOp | None,
) -> tuple[CloudWorkspaceMobility, CloudWorkspaceHandoffOp]:
    if mobility_workspace is None or handoff_op is None:
        raise ValueError("mobility handoff not found")
    if handoff_op.mobility_workspace_id != mobility_workspace.id:
        raise ValueError("mobility handoff did not belong to workspace")
    return mobility_workspace, handoff_op


def _clear_retryable_handoff_failure(
    record: CloudWorkspaceMobility,
    *,
    owner_hint: str,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
) -> bool:
    if not is_retryable_failure(
        lifecycle_state=record.lifecycle_state,
        has_active_handoff=record.active_handoff_op_id is not None,
    ):
        return False

    record.owner = _normalize_owner(owner_hint)
    record.lifecycle_state = active_lifecycle_state
    record.status_detail = None
    record.last_error = None
    return True


def _record_mobility_event(
    db: AsyncSession,
    *,
    user_id: UUID,
    cloud_workspace_id: UUID | None,
    handoff_op_id: UUID | None,
    event_type: str,
    direction: str | None = None,
    source_owner: str | None = None,
    target_owner: str | None = None,
    from_phase: str | None = None,
    to_phase: str | None = None,
    failure_code: str | None = None,
    occurred_at: datetime,
) -> None:
    db.add(
        CloudWorkspaceMobilityEvent(
            user_id=user_id,
            cloud_workspace_id=cloud_workspace_id,
            handoff_op_id=handoff_op_id,
            event_type=event_type,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
            from_phase=from_phase,
            to_phase=to_phase,
            failure_code=failure_code,
            occurred_at=occurred_at,
            created_at=occurred_at,
        )
    )


async def get_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobility | None:
    return (
        await db.execute(
            select(CloudWorkspaceMobility).where(
                CloudWorkspaceMobility.id == mobility_workspace_id,
                CloudWorkspaceMobility.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_mobility_for_update(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobility | None:
    return (
        await db.execute(
            select(CloudWorkspaceMobility)
            .where(
                CloudWorkspaceMobility.id == mobility_workspace_id,
                CloudWorkspaceMobility.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()


async def get_cloud_workspace_mobility_by_identity(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
) -> CloudWorkspaceMobility | None:
    return (
        await db.execute(
            select(CloudWorkspaceMobility).where(
                CloudWorkspaceMobility.user_id == user_id,
                CloudWorkspaceMobility.git_provider == git_provider,
                CloudWorkspaceMobility.git_owner == git_owner,
                CloudWorkspaceMobility.git_repo_name == git_repo_name,
                CloudWorkspaceMobility.git_branch == git_branch,
            )
        )
    ).scalar_one_or_none()


async def list_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[CloudWorkspaceMobility]:
    return list(
        (
            await db.execute(
                select(CloudWorkspaceMobility)
                .where(CloudWorkspaceMobility.user_id == user_id)
                .order_by(CloudWorkspaceMobility.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def load_cloud_workspace_mobility_value(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue | None:
    record = await get_cloud_workspace_mobility(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
    )
    if record is None:
        return None
    active_handoff = None
    if record.active_handoff_op_id is not None:
        active_handoff = await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=record.active_handoff_op_id,
        )
    return _mobility_value(record, active_handoff=active_handoff)


async def get_cloud_workspace_handoff_op(
    db: AsyncSession,
    *,
    user_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOp | None:
    return (
        await db.execute(
            select(CloudWorkspaceHandoffOp).where(
                CloudWorkspaceHandoffOp.id == handoff_op_id,
                CloudWorkspaceHandoffOp.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_active_user_handoff_op(
    db: AsyncSession,
    *,
    user_id: UUID,
    final_handoff_phases: tuple[str, ...],
) -> CloudWorkspaceHandoffOp | None:
    return (
        await db.execute(
            select(CloudWorkspaceHandoffOp)
            .where(
                CloudWorkspaceHandoffOp.user_id == user_id,
                CloudWorkspaceHandoffOp.phase.not_in(final_handoff_phases),
            )
            .order_by(CloudWorkspaceHandoffOp.created_at.desc())
        )
    ).scalar_one_or_none()


async def get_active_handoff_for_mobility(
    db: AsyncSession,
    *,
    mobility_workspace_id: UUID,
    final_handoff_phases: tuple[str, ...],
) -> CloudWorkspaceHandoffOp | None:
    return (
        await db.execute(
            select(CloudWorkspaceHandoffOp).where(
                CloudWorkspaceHandoffOp.mobility_workspace_id == mobility_workspace_id,
                CloudWorkspaceHandoffOp.phase.not_in(final_handoff_phases),
            )
        )
    ).scalar_one_or_none()


async def ensure_cloud_workspace_mobility(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    owner_hint: str,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
    display_name: str | None,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceMobilityValue:
    record = await get_cloud_workspace_mobility_by_identity(
        db,
        user_id=user_id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
    )
    now = utcnow()
    if record is None:
        record = CloudWorkspaceMobility(
            user_id=user_id,
            display_name=display_name,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            owner=_normalize_owner(owner_hint),
            lifecycle_state=active_lifecycle_state,
            status_detail=None,
            last_error=None,
            cloud_workspace_id=cloud_workspace_id,
            active_handoff_op_id=None,
            last_handoff_op_id=None,
            cloud_lost_at=None,
            cloud_lost_reason=None,
            created_at=now,
            updated_at=now,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        return _mobility_value(record)

    changed = _clear_retryable_handoff_failure(
        record,
        owner_hint=owner_hint,
        active_lifecycle_state=active_lifecycle_state,
        is_retryable_failure=is_retryable_failure,
    )
    if display_name is not None and display_name != record.display_name:
        record.display_name = display_name
        changed = True
    if cloud_workspace_id is not None and record.cloud_workspace_id != cloud_workspace_id:
        record.cloud_workspace_id = cloud_workspace_id
        changed = True
    if changed:
        record.updated_at = now
        await db.commit()
        await db.refresh(record)

    active_handoff = None
    if record.active_handoff_op_id is not None:
        active_handoff = await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=record.active_handoff_op_id,
        )
    return _mobility_value(record, active_handoff=active_handoff)


async def backfill_cloud_workspace_mobility_from_workspace(
    db: AsyncSession,
    *,
    workspace: CloudWorkspace,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
) -> CloudWorkspaceMobilityValue:
    return await ensure_cloud_workspace_mobility(
        db,
        user_id=workspace.user_id,
        git_provider=workspace.git_provider,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        owner_hint="personal_cloud",
        active_lifecycle_state=active_lifecycle_state,
        is_retryable_failure=is_retryable_failure,
        display_name=workspace.display_name,
        cloud_workspace_id=workspace.id,
    )


async def create_cloud_workspace_handoff_op(
    db: AsyncSession,
    *,
    mobility_workspace: CloudWorkspaceMobility,
    direction: str,
    source_owner: str,
    target_owner: str,
    moving_lifecycle_state: str,
    requested_branch: str,
    requested_base_sha: str | None,
    exclude_paths: list[str],
) -> CloudWorkspaceHandoffOpValue:
    now = utcnow()
    record = CloudWorkspaceHandoffOp(
        mobility_workspace_id=mobility_workspace.id,
        user_id=mobility_workspace.user_id,
        direction=direction,
        source_owner=_normalize_owner(source_owner),
        target_owner=_normalize_owner(target_owner),
        phase="start_requested",
        canonical_side="source",
        requested_branch=requested_branch,
        requested_base_sha=requested_base_sha,
        exclude_paths_json=json.dumps(exclude_paths),
        failure_code=None,
        failure_detail=None,
        started_at=now,
        heartbeat_at=now,
        finalized_at=None,
        cleanup_completed_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    await db.flush()

    mobility_workspace.active_handoff_op_id = record.id
    mobility_workspace.last_handoff_op_id = record.id
    mobility_workspace.owner = _normalize_owner(source_owner)
    mobility_workspace.lifecycle_state = moving_lifecycle_state
    mobility_workspace.status_detail = "Handoff started"
    mobility_workspace.last_error = None
    mobility_workspace.updated_at = now
    _record_mobility_event(
        db,
        user_id=mobility_workspace.user_id,
        cloud_workspace_id=mobility_workspace.cloud_workspace_id,
        handoff_op_id=record.id,
        event_type="handoff_started",
        direction=direction,
        source_owner=source_owner,
        target_owner=target_owner,
        to_phase=record.phase,
        occurred_at=now,
    )

    await db.commit()
    await db.refresh(record)
    await db.refresh(mobility_workspace)
    return _handoff_value(record)


async def update_cloud_workspace_handoff_phase(
    db: AsyncSession,
    *,
    handoff_op: CloudWorkspaceHandoffOp,
    mobility_workspace: CloudWorkspaceMobility,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None = None,
) -> CloudWorkspaceHandoffOpValue:
    now = utcnow()
    previous_phase = handoff_op.phase
    handoff_op.phase = phase
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now
    if cloud_workspace_id is not None:
        mobility_workspace.cloud_workspace_id = cloud_workspace_id
    if status_detail is not None:
        mobility_workspace.status_detail = status_detail
    mobility_workspace.updated_at = now
    if previous_phase != phase:
        _record_mobility_event(
            db,
            user_id=handoff_op.user_id,
            cloud_workspace_id=mobility_workspace.cloud_workspace_id,
            handoff_op_id=handoff_op.id,
            event_type="phase_changed",
            direction=handoff_op.direction,
            source_owner=handoff_op.source_owner,
            target_owner=handoff_op.target_owner,
            from_phase=previous_phase,
            to_phase=phase,
            occurred_at=now,
        )
    await db.flush()
    return _handoff_value(handoff_op)


async def heartbeat_cloud_workspace_handoff_op(
    db: AsyncSession,
    *,
    handoff_op: CloudWorkspaceHandoffOp,
) -> CloudWorkspaceHandoffOpValue:
    now = utcnow()
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now
    await db.flush()
    return _handoff_value(handoff_op)


async def finalize_cloud_workspace_handoff_op(
    db: AsyncSession,
    *,
    handoff_op: CloudWorkspaceHandoffOp,
    mobility_workspace: CloudWorkspaceMobility,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceHandoffOpValue:
    now = utcnow()
    previous_phase = handoff_op.phase
    handoff_op.phase = "cutover_committed"
    handoff_op.canonical_side = "destination"
    handoff_op.finalized_at = now
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now

    target_owner = _normalize_owner(handoff_op.target_owner)
    mobility_workspace.owner = target_owner
    mobility_workspace.lifecycle_state = {
        "local": "local_active",
        "personal_cloud": "cloud_active",
        "shared_cloud": "shared_cloud_active",
        "ssh": "ssh_active",
    }.get(target_owner, "cloud_active")
    mobility_workspace.cloud_workspace_id = (
        None
        if target_owner == "local"
        else cloud_workspace_id or mobility_workspace.cloud_workspace_id
    )
    mobility_workspace.status_detail = "Cutover committed"
    mobility_workspace.last_error = None
    mobility_workspace.updated_at = now
    if previous_phase != handoff_op.phase:
        _record_mobility_event(
            db,
            user_id=handoff_op.user_id,
            cloud_workspace_id=mobility_workspace.cloud_workspace_id,
            handoff_op_id=handoff_op.id,
            event_type="finalized",
            direction=handoff_op.direction,
            source_owner=handoff_op.source_owner,
            target_owner=handoff_op.target_owner,
            from_phase=previous_phase,
            to_phase=handoff_op.phase,
            occurred_at=now,
        )

    await db.flush()
    return _handoff_value(handoff_op)


async def complete_cloud_workspace_handoff_cleanup(
    db: AsyncSession,
    *,
    handoff_op: CloudWorkspaceHandoffOp,
    mobility_workspace: CloudWorkspaceMobility,
) -> CloudWorkspaceHandoffOpValue:
    now = utcnow()
    previous_phase = handoff_op.phase
    handoff_op.phase = "completed"
    handoff_op.cleanup_completed_at = now
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now

    mobility_workspace.active_handoff_op_id = None
    mobility_workspace.status_detail = "Ready"
    mobility_workspace.updated_at = now
    if previous_phase != handoff_op.phase:
        _record_mobility_event(
            db,
            user_id=handoff_op.user_id,
            cloud_workspace_id=mobility_workspace.cloud_workspace_id,
            handoff_op_id=handoff_op.id,
            event_type="cleanup_completed",
            direction=handoff_op.direction,
            source_owner=handoff_op.source_owner,
            target_owner=handoff_op.target_owner,
            from_phase=previous_phase,
            to_phase=handoff_op.phase,
            occurred_at=now,
        )

    await db.flush()
    return _handoff_value(handoff_op)


async def insert_cleanup_items_for_handoff(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    items: list[CloudWorkspaceMoveCleanupItemInput],
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    if not items:
        return []
    now = utcnow()
    records = [
        CloudWorkspaceMoveCleanupItem(
            handoff_op_id=handoff_op_id,
            item_kind=item.item_kind,
            target_id=item.target_id,
            anyharness_workspace_id=item.anyharness_workspace_id,
            object_id=item.object_id,
            status="pending",
            attempt_count=0,
            next_attempt_at=now,
            error_code=None,
            error_message=None,
            started_at=None,
            completed_at=None,
            created_at=now,
            updated_at=now,
        )
        for item in items
    ]
    db.add_all(records)
    await db.flush()
    return [_cleanup_item_value(record) for record in records]


async def list_cleanup_items_for_handoff(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id)
            .order_by(
                CloudWorkspaceMoveCleanupItem.created_at.asc(),
                CloudWorkspaceMoveCleanupItem.id.asc(),
            )
        )
    ).scalars()
    return [_cleanup_item_value(row) for row in rows]


async def load_due_cleanup_items(
    db: AsyncSession,
    *,
    now: datetime,
    item_kinds: set[str] | frozenset[str],
    limit: int,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    if not item_kinds:
        return []
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.item_kind.in_(item_kinds))
            .where(CloudWorkspaceMoveCleanupItem.status.in_(("pending", "failed")))
            .where(CloudWorkspaceMoveCleanupItem.next_attempt_at <= now)
            .order_by(
                CloudWorkspaceMoveCleanupItem.next_attempt_at.asc(),
                CloudWorkspaceMoveCleanupItem.created_at.asc(),
            )
            .limit(limit)
        )
    ).scalars()
    return [_cleanup_item_value(row) for row in rows]


async def get_cleanup_item_for_handoff(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    cleanup_item_id: UUID,
    lock: bool = False,
) -> CloudWorkspaceMoveCleanupItem | None:
    query = select(CloudWorkspaceMoveCleanupItem).where(
        CloudWorkspaceMoveCleanupItem.id == cleanup_item_id,
        CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id,
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


async def update_cleanup_item_status(
    db: AsyncSession,
    *,
    cleanup_item: CloudWorkspaceMoveCleanupItem,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
) -> CloudWorkspaceMoveCleanupItemValue:
    now = utcnow()
    cleanup_item.status = status
    cleanup_item.updated_at = now
    if status == "in_progress":
        cleanup_item.started_at = now
    elif status == "completed":
        cleanup_item.completed_at = now
        cleanup_item.error_code = None
        cleanup_item.error_message = None
    elif status == "failed":
        cleanup_item.attempt_count += 1
        cleanup_item.error_code = error_code
        cleanup_item.error_message = error_message
        cleanup_item.next_attempt_at = now
    await db.flush()
    return _cleanup_item_value(cleanup_item)


async def all_cleanup_items_completed(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
) -> bool:
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem.status).where(
                CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id
            )
        )
    ).scalars()
    statuses = list(rows)
    return bool(statuses) and all(status == "completed" for status in statuses)


async def mark_remaining_cleanup_items_completed(
    db: AsyncSession,
    *,
    handoff_op_id: UUID,
    error_message: str | None = None,
) -> list[CloudWorkspaceMoveCleanupItemValue]:
    rows = (
        await db.execute(
            select(CloudWorkspaceMoveCleanupItem)
            .where(CloudWorkspaceMoveCleanupItem.handoff_op_id == handoff_op_id)
            .where(CloudWorkspaceMoveCleanupItem.status != "completed")
            .with_for_update()
        )
    ).scalars()
    values: list[CloudWorkspaceMoveCleanupItemValue] = []
    now = utcnow()
    for row in rows:
        row.status = "completed"
        row.error_code = "manual_resolution" if error_message else None
        row.error_message = error_message
        row.completed_at = now
        row.updated_at = now
        values.append(_cleanup_item_value(row))
    await db.flush()
    return values


async def fail_cloud_workspace_handoff_op(
    db: AsyncSession,
    *,
    handoff_op: CloudWorkspaceHandoffOp,
    mobility_workspace: CloudWorkspaceMobility,
    phase: str,
    lifecycle_state: str,
    failure_code: str,
    failure_detail: str,
    status_detail: str | None,
    last_error: str,
    keep_active_handoff: bool = False,
    event_type: str = "handoff_failed",
) -> CloudWorkspaceHandoffOpValue:
    now = utcnow()
    previous_phase = handoff_op.phase
    handoff_op.phase = phase
    handoff_op.failure_code = failure_code
    handoff_op.failure_detail = failure_detail
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now

    if keep_active_handoff or phase in {"cleanup_failed", "repair_required"}:
        mobility_workspace.active_handoff_op_id = handoff_op.id
    else:
        mobility_workspace.active_handoff_op_id = None
    mobility_workspace.lifecycle_state = lifecycle_state
    mobility_workspace.status_detail = status_detail
    mobility_workspace.last_error = last_error
    mobility_workspace.updated_at = now
    if previous_phase != phase:
        _record_mobility_event(
            db,
            user_id=handoff_op.user_id,
            cloud_workspace_id=mobility_workspace.cloud_workspace_id,
            handoff_op_id=handoff_op.id,
            event_type=event_type,
            direction=handoff_op.direction,
            source_owner=handoff_op.source_owner,
            target_owner=handoff_op.target_owner,
            from_phase=previous_phase,
            to_phase=phase,
            failure_code=failure_code,
            occurred_at=now,
        )

    await db.flush()
    return _handoff_value(handoff_op)


async def list_cloud_workspace_mobility_for_user(
    *,
    user_id: UUID,
) -> list[CloudWorkspaceMobilityValue]:
    async with db_engine.async_session_factory() as db:
        records = await list_cloud_workspace_mobility(db, user_id=user_id)
        values: list[CloudWorkspaceMobilityValue] = []
        for record in records:
            active_handoff = None
            if record.active_handoff_op_id is not None:
                active_handoff = await get_cloud_workspace_handoff_op(
                    db,
                    user_id=user_id,
                    handoff_op_id=record.active_handoff_op_id,
                )
            values.append(_mobility_value(record, active_handoff=active_handoff))
        return values


async def load_cloud_workspace_mobility_for_user(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
) -> CloudWorkspaceMobilityValue | None:
    async with db_engine.async_session_factory() as db:
        return await load_cloud_workspace_mobility_value(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        )


async def ensure_cloud_workspace_mobility_for_user(
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    git_branch: str,
    owner_hint: str,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
    display_name: str | None,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceMobilityValue:
    async with db_engine.async_session_factory() as db:
        return await ensure_cloud_workspace_mobility(
            db,
            user_id=user_id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=git_branch,
            owner_hint=owner_hint,
            active_lifecycle_state=active_lifecycle_state,
            is_retryable_failure=is_retryable_failure,
            display_name=display_name,
            cloud_workspace_id=cloud_workspace_id,
        )


async def backfill_cloud_workspace_mobility_for_workspace(
    *,
    workspace: CloudWorkspace,
    active_lifecycle_state: str,
    is_retryable_failure: RetryableMobilityFailurePredicate,
) -> CloudWorkspaceMobilityValue:
    async with db_engine.async_session_factory() as db:
        return await backfill_cloud_workspace_mobility_from_workspace(
            db,
            workspace=workspace,
            active_lifecycle_state=active_lifecycle_state,
            is_retryable_failure=is_retryable_failure,
        )


async def load_active_user_handoff_op_for_user(
    *,
    user_id: UUID,
    final_handoff_phases: tuple[str, ...],
) -> CloudWorkspaceHandoffOpValue | None:
    async with db_engine.async_session_factory() as db:
        record = await get_active_user_handoff_op(
            db,
            user_id=user_id,
            final_handoff_phases=final_handoff_phases,
        )
        return _handoff_value(record) if record is not None else None


async def record_cloud_workspace_mobility_event_for_user(
    *,
    user_id: UUID,
    cloud_workspace_id: UUID | None,
    handoff_op_id: UUID | None,
    event_type: str,
    direction: str | None = None,
    source_owner: str | None = None,
    target_owner: str | None = None,
    from_phase: str | None = None,
    to_phase: str | None = None,
    failure_code: str | None = None,
) -> None:
    async with db_engine.async_session_factory() as db:
        _record_mobility_event(
            db,
            user_id=user_id,
            cloud_workspace_id=cloud_workspace_id,
            handoff_op_id=handoff_op_id,
            event_type=event_type,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
            from_phase=from_phase,
            to_phase=to_phase,
            failure_code=failure_code,
            occurred_at=utcnow(),
        )
        await db.commit()


async def create_cloud_workspace_handoff_op_for_user(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    direction: str,
    source_owner: str,
    target_owner: str,
    moving_lifecycle_state: str,
    final_handoff_phases: tuple[str, ...],
    requested_branch: str,
    requested_base_sha: str | None,
    exclude_paths: list[str],
) -> CloudWorkspaceHandoffOpValue:
    async with db_engine.async_session_factory() as db:
        mobility_workspace = await get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        )
        if mobility_workspace is None:
            raise ValueError("mobility workspace not found")
        existing_handoff = await get_active_handoff_for_mobility(
            db,
            mobility_workspace_id=mobility_workspace_id,
            final_handoff_phases=final_handoff_phases,
        )
        if existing_handoff is not None:
            raise ValueError("handoff already in progress for workspace")
        return await create_cloud_workspace_handoff_op(
            db,
            mobility_workspace=mobility_workspace,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
            moving_lifecycle_state=moving_lifecycle_state,
            requested_branch=requested_branch,
            requested_base_sha=requested_base_sha,
            exclude_paths=exclude_paths,
        )


async def update_cloud_workspace_handoff_phase_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None = None,
) -> CloudWorkspaceHandoffOpValue:
    mobility_workspace, handoff_op = _require_handoff_belongs_to_workspace(
        await get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
        ),
    )
    return await update_cloud_workspace_handoff_phase(
        db,
        handoff_op=handoff_op,
        mobility_workspace=mobility_workspace,
        phase=phase,
        status_detail=status_detail,
        cloud_workspace_id=cloud_workspace_id,
    )


async def update_cloud_workspace_handoff_phase_checkpoint_for_user(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None = None,
) -> CloudWorkspaceHandoffOpValue:
    async with db_engine.async_session_factory() as db:
        value = await update_cloud_workspace_handoff_phase_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=phase,
            status_detail=status_detail,
            cloud_workspace_id=cloud_workspace_id,
        )
        await db.commit()
        return value


async def heartbeat_cloud_workspace_handoff_op_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    _, handoff_op = _require_handoff_belongs_to_workspace(
        await get_cloud_workspace_mobility(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
        ),
    )
    return await heartbeat_cloud_workspace_handoff_op(db, handoff_op=handoff_op)


async def finalize_cloud_workspace_handoff_op_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    cloud_workspace_id: UUID | None,
) -> CloudWorkspaceHandoffOpValue:
    mobility_workspace, handoff_op = _require_handoff_belongs_to_workspace(
        await get_cloud_workspace_mobility(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
        ),
    )
    return await finalize_cloud_workspace_handoff_op(
        db,
        handoff_op=handoff_op,
        mobility_workspace=mobility_workspace,
        cloud_workspace_id=cloud_workspace_id,
    )


async def complete_cloud_workspace_handoff_cleanup_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    mobility_workspace, handoff_op = _require_handoff_belongs_to_workspace(
        await get_cloud_workspace_mobility(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
        ),
    )
    return await complete_cloud_workspace_handoff_cleanup(
        db,
        handoff_op=handoff_op,
        mobility_workspace=mobility_workspace,
    )


async def fail_cloud_workspace_handoff_op_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    lifecycle_state: str,
    failure_code: str,
    failure_detail: str,
    status_detail: str | None,
    last_error: str,
    keep_active_handoff: bool = False,
    event_type: str = "handoff_failed",
) -> CloudWorkspaceHandoffOpValue:
    mobility_workspace, handoff_op = _require_handoff_belongs_to_workspace(
        await get_cloud_workspace_mobility(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
        ),
    )
    return await fail_cloud_workspace_handoff_op(
        db,
        handoff_op=handoff_op,
        mobility_workspace=mobility_workspace,
        phase=phase,
        lifecycle_state=lifecycle_state,
        failure_code=failure_code,
        failure_detail=failure_detail,
        status_detail=status_detail,
        last_error=last_error,
        keep_active_handoff=keep_active_handoff,
        event_type=event_type,
    )


async def fail_cloud_workspace_handoff_op_checkpoint_for_user(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    lifecycle_state: str,
    failure_code: str,
    failure_detail: str,
    status_detail: str | None,
    last_error: str,
    keep_active_handoff: bool = False,
    event_type: str = "handoff_failed",
) -> CloudWorkspaceHandoffOpValue:
    async with db_engine.async_session_factory() as db:
        value = await fail_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=phase,
            lifecycle_state=lifecycle_state,
            failure_code=failure_code,
            failure_detail=failure_detail,
            status_detail=status_detail,
            last_error=last_error,
            keep_active_handoff=keep_active_handoff,
            event_type=event_type,
        )
        await db.commit()
        return value
