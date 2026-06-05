"""Durable mobility transaction boundaries owned outside db/store."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_mobility.handoffs import (
    create_cloud_workspace_handoff_op_for_user,
    fail_cloud_workspace_handoff_op_checkpoint_for_user,
    update_cloud_workspace_handoff_phase_checkpoint_for_user,
)
from proliferate.db.store.cloud_mobility.records import CloudWorkspaceHandoffOpValue
from proliferate.db.store.cloud_mobility.workspaces import list_cloud_workspace_mobility_for_user
from proliferate.server.cloud.mobility.domain.lifecycle import (
    stale_handoff_outcome,
    visible_failure_last_error,
    visible_failure_status_detail,
)
from proliferate.utils.time import utcnow


async def expire_stale_handoffs_tx(
    *,
    user_id: UUID,
    stale_after: timedelta,
) -> None:
    stale_before = utcnow() - stale_after
    async with db_engine.async_session_factory() as db, db.begin():
        workspaces = await list_cloud_workspace_mobility_for_user(db, user_id=user_id)
        for workspace in workspaces:
            active_handoff = workspace.active_handoff
            if active_handoff is None or active_handoff.heartbeat_at >= stale_before:
                continue
            outcome = stale_handoff_outcome(
                finalized_at=active_handoff.finalized_at,
                cleanup_completed_at=active_handoff.cleanup_completed_at,
                canonical_side=active_handoff.canonical_side,
            )
            await fail_cloud_workspace_handoff_op_checkpoint_for_user(
                db,
                user_id=user_id,
                mobility_workspace_id=workspace.id,
                handoff_op_id=active_handoff.id,
                phase=outcome.phase,
                lifecycle_state=outcome.lifecycle_state,
                failure_code=outcome.failure_code,
                failure_detail=outcome.failure_detail,
                status_detail=visible_failure_status_detail(outcome.failure_detail),
                last_error=visible_failure_last_error(outcome.failure_detail),
                keep_active_handoff=outcome.keep_active_handoff,
                event_type="handoff_stale",
            )


async def create_cloud_workspace_handoff_op_checkpoint_tx(
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
    async with db_engine.async_session_factory() as db, db.begin():
        return await create_cloud_workspace_handoff_op_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            direction=direction,
            source_owner=source_owner,
            target_owner=target_owner,
            moving_lifecycle_state=moving_lifecycle_state,
            final_handoff_phases=final_handoff_phases,
            requested_branch=requested_branch,
            requested_base_sha=requested_base_sha,
            exclude_paths=exclude_paths,
        )


async def update_cloud_workspace_handoff_phase_checkpoint_tx(
    *,
    user_id: UUID,
    mobility_workspace_id: UUID,
    handoff_op_id: UUID,
    phase: str,
    status_detail: str | None,
    cloud_workspace_id: UUID | None = None,
) -> CloudWorkspaceHandoffOpValue:
    async with db_engine.async_session_factory() as db, db.begin():
        return await update_cloud_workspace_handoff_phase_checkpoint_for_user(
            db,
            user_id=user_id,
            mobility_workspace_id=mobility_workspace_id,
            handoff_op_id=handoff_op_id,
            phase=phase,
            status_detail=status_detail,
            cloud_workspace_id=cloud_workspace_id,
        )


async def fail_cloud_workspace_handoff_op_checkpoint_tx(
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
    async with db_engine.async_session_factory() as db, db.begin():
        return await fail_cloud_workspace_handoff_op_checkpoint_for_user(
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
