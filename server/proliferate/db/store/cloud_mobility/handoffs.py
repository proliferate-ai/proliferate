from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.mobility import CloudWorkspaceHandoffOp, CloudWorkspaceMobility
from proliferate.db.store.cloud_mobility.events import _record_mobility_event
from proliferate.db.store.cloud_mobility.mappers import (
    _active_lifecycle_state_for_owner,
    _handoff_value,
    _normalize_owner,
)
from proliferate.db.store.cloud_mobility.records import CloudWorkspaceHandoffOpValue
from proliferate.utils.time import utcnow


def _require_handoff_belongs_to_workspace(
    mobility_workspace: CloudWorkspaceMobility | None,
    handoff_op: CloudWorkspaceHandoffOp | None,
) -> tuple[CloudWorkspaceMobility, CloudWorkspaceHandoffOp]:
    if mobility_workspace is None or handoff_op is None:
        raise ValueError("mobility handoff not found")
    if handoff_op.mobility_workspace_id != mobility_workspace.id:
        raise ValueError("mobility handoff did not belong to workspace")
    return mobility_workspace, handoff_op


async def _get_cloud_workspace_mobility_for_update(
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


async def get_cloud_workspace_handoff_op(
    db: AsyncSession,
    *,
    user_id: UUID,
    handoff_op_id: UUID,
    lock: bool = False,
) -> CloudWorkspaceHandoffOp | None:
    query = select(CloudWorkspaceHandoffOp).where(
        CloudWorkspaceHandoffOp.id == handoff_op_id,
        CloudWorkspaceHandoffOp.user_id == user_id,
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()


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

    await db.flush()
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
    if previous_phase not in {"install_succeeded", "cutover_committed", "cleanup_pending"}:
        raise ValueError("handoff is not ready for cutover")
    handoff_op.phase = "cutover_committed"
    handoff_op.canonical_side = "destination"
    handoff_op.finalized_at = now
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now

    target_owner = _normalize_owner(handoff_op.target_owner)
    mobility_workspace.owner = target_owner
    mobility_workspace.lifecycle_state = _active_lifecycle_state_for_owner(target_owner)
    if target_owner == "local":
        mobility_workspace.cloud_workspace_id = None
    else:
        if cloud_workspace_id is None:
            raise ValueError("destination cloud workspace is required")
        mobility_workspace.cloud_workspace_id = cloud_workspace_id
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
    if handoff_op.phase == "completed":
        if (
            handoff_op.canonical_side != "destination"
            or handoff_op.finalized_at is None
            or handoff_op.cleanup_completed_at is None
        ):
            raise ValueError("handoff cleanup cannot complete before cutover")
        return _handoff_value(handoff_op)
    if handoff_op.phase not in {
        "cutover_committed",
        "cleanup_pending",
        "cleanup_failed",
    }:
        raise ValueError("handoff cleanup cannot complete before cutover")
    if handoff_op.canonical_side != "destination" or handoff_op.finalized_at is None:
        raise ValueError("handoff cleanup cannot complete before cutover")

    now = utcnow()
    previous_phase = handoff_op.phase
    handoff_op.phase = "completed"
    handoff_op.cleanup_completed_at = now
    handoff_op.failure_code = None
    handoff_op.failure_detail = None
    handoff_op.heartbeat_at = now
    handoff_op.updated_at = now

    mobility_workspace.active_handoff_op_id = None
    mobility_workspace.lifecycle_state = _active_lifecycle_state_for_owner(
        mobility_workspace.owner
    )
    if _normalize_owner(mobility_workspace.owner) == "local":
        mobility_workspace.cloud_workspace_id = None
    mobility_workspace.status_detail = "Ready"
    mobility_workspace.last_error = None
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


async def load_active_user_handoff_op_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    final_handoff_phases: tuple[str, ...],
) -> CloudWorkspaceHandoffOpValue | None:
    record = await get_active_user_handoff_op(
        db,
        user_id=user_id,
        final_handoff_phases=final_handoff_phases,
    )
    return _handoff_value(record) if record is not None else None


async def create_cloud_workspace_handoff_op_for_user(
    db: AsyncSession,
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
    mobility_workspace = await _get_cloud_workspace_mobility_for_update(
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
        await _get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
            lock=True,
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
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None = None,
) -> CloudWorkspaceHandoffOpValue:
    value = await update_cloud_workspace_handoff_phase_for_user(
        db,
        user_id=user_id,
        mobility_workspace_id=mobility_workspace_id,
        handoff_op_id=handoff_op_id,
        phase=phase,
        status_detail=status_detail,
        cloud_workspace_id=cloud_workspace_id,
    )
    await db.flush()
    return value


async def heartbeat_cloud_workspace_handoff_op_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
) -> CloudWorkspaceHandoffOpValue:
    _, handoff_op = _require_handoff_belongs_to_workspace(
        await _get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
            lock=True,
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
        await _get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
            lock=True,
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
        await _get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
            lock=True,
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
        await _get_cloud_workspace_mobility_for_update(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
        ),
        await get_cloud_workspace_handoff_op(
            db,
            user_id=user_id,
            handoff_op_id=handoff_op_id,
            lock=True,
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
    await db.flush()
    return value
