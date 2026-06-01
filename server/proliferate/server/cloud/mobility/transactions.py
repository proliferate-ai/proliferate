"""Durable mobility transaction boundaries owned outside db/store."""

from __future__ import annotations

from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_mobility import (
    CloudWorkspaceHandoffOpValue,
    create_cloud_workspace_handoff_op_for_user,
    fail_cloud_workspace_handoff_op_checkpoint_for_user,
    update_cloud_workspace_handoff_phase_checkpoint_for_user,
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
