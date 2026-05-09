"""Persistence helpers for cloud workspace setup-run monitoring."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    SETUP_RUN_ACTIVE_STATUSES,
    SETUP_RUN_STATUS_RUNNING,
    bounded_setup_monitor_error,
    classify_setup_run_finalization,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.workspaces import CloudWorkspace, CloudWorkspaceSetupRun
from proliferate.utils.time import utcnow

SETUP_MONITOR_CLAIM_TTL = timedelta(seconds=45)
SETUP_MONITOR_POLL_INTERVAL = timedelta(seconds=5)


async def create_cloud_workspace_setup_run(
    *,
    workspace_id: UUID,
    anyharness_workspace_id: str,
    terminal_id: str | None,
    command_run_id: str,
    setup_script_version: int,
    apply_token: str,
    deadline_at: datetime,
    status: str = SETUP_RUN_STATUS_RUNNING,
) -> CloudWorkspaceSetupRun:
    async with db_engine.async_session_factory() as db:
        now = utcnow()
        run = CloudWorkspaceSetupRun(
            workspace_id=workspace_id,
            anyharness_workspace_id=anyharness_workspace_id,
            terminal_id=terminal_id,
            command_run_id=command_run_id,
            setup_script_version=setup_script_version,
            apply_token=apply_token,
            status=status,
            deadline_at=deadline_at,
            claim_owner=None,
            claim_until=None,
            last_polled_at=None,
            next_poll_at=now,
            last_error=None,
            created_at=now,
            updated_at=now,
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        return run


async def load_cloud_workspace_setup_run(
    setup_run_id: UUID,
) -> CloudWorkspaceSetupRun | None:
    async with db_engine.async_session_factory() as db:
        return await db.get(CloudWorkspaceSetupRun, setup_run_id)


async def claim_due_setup_runs(
    *,
    owner: str,
    limit: int = 10,
    now: datetime | None = None,
) -> list[CloudWorkspaceSetupRun]:
    now = now or utcnow()
    claim_until = now + SETUP_MONITOR_CLAIM_TTL
    async with db_engine.async_session_factory() as db:
        runs = list(
            (
                await db.execute(
                    select(CloudWorkspaceSetupRun)
                    .where(
                        CloudWorkspaceSetupRun.status.in_(SETUP_RUN_ACTIVE_STATUSES),
                        or_(
                            CloudWorkspaceSetupRun.next_poll_at.is_(None),
                            CloudWorkspaceSetupRun.next_poll_at <= now,
                            CloudWorkspaceSetupRun.deadline_at <= now,
                        ),
                        or_(
                            CloudWorkspaceSetupRun.claim_until.is_(None),
                            CloudWorkspaceSetupRun.claim_until <= now,
                        ),
                    )
                    .order_by(CloudWorkspaceSetupRun.next_poll_at.asc().nullsfirst())
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
            run.claim_owner = owner
            run.claim_until = claim_until
            run.updated_at = now
        await db.commit()
        return runs


async def release_setup_run_claim(
    setup_run_id: UUID,
    *,
    status: str = SETUP_RUN_STATUS_RUNNING,
    next_poll_at: datetime | None = None,
    last_error: str | None = None,
) -> None:
    async with db_engine.async_session_factory() as db:
        run = await db.get(CloudWorkspaceSetupRun, setup_run_id)
        if run is None:
            return
        now = utcnow()
        run.status = status
        run.claim_owner = None
        run.claim_until = None
        run.last_polled_at = now
        run.next_poll_at = next_poll_at or (now + SETUP_MONITOR_POLL_INTERVAL)
        run.last_error = bounded_setup_monitor_error(last_error)
        run.updated_at = now
        await db.commit()


async def finalize_setup_run(
    setup_run_id: UUID,
    *,
    final_status: str,
    success: bool,
    last_error: str | None = None,
) -> None:
    async with db_engine.async_session_factory() as db:
        await _finalize_setup_run(db, setup_run_id, final_status, success, last_error)
        await db.commit()


async def _finalize_setup_run(
    db: AsyncSession,
    setup_run_id: UUID,
    final_status: str,
    success: bool,
    last_error: str | None,
) -> None:
    run = await db.get(CloudWorkspaceSetupRun, setup_run_id)
    if run is None:
        return
    now = utcnow()
    workspace = await db.get(CloudWorkspace, run.workspace_id)
    decision = classify_setup_run_finalization(
        workspace_exists=workspace is not None,
        workspace_apply_token=(
            workspace.repo_post_ready_apply_token if workspace is not None else None
        ),
        workspace_phase=workspace.repo_post_ready_phase if workspace is not None else None,
        run_apply_token=run.apply_token,
        command_run_id=run.command_run_id,
        final_status=final_status,
        success=success,
        last_error=last_error,
        setup_script_version=run.setup_script_version,
    )

    run.status = decision.run_status
    run.claim_owner = None
    run.claim_until = None
    if decision.set_last_polled_at:
        run.last_polled_at = now
    if decision.clear_next_poll_at:
        run.next_poll_at = None
    run.last_error = decision.run_last_error
    run.updated_at = now

    if not decision.should_update_workspace or workspace is None:
        return
    workspace_update = decision.workspace_update
    if workspace_update is None:
        return
    workspace.repo_post_ready_completed_at = now
    workspace.repo_post_ready_apply_token = None
    workspace.updated_at = now
    workspace.repo_post_ready_phase = workspace_update.phase.value
    if workspace_update.repo_setup_applied_version is not None:
        workspace.repo_setup_applied_version = workspace_update.repo_setup_applied_version
    workspace.repo_files_last_failed_path = None
    workspace.repo_files_last_error = workspace_update.repo_files_last_error
    workspace.status_detail = workspace_update.status_detail


async def mark_setup_run_timed_out(setup_run_id: UUID) -> None:
    await finalize_setup_run(
        setup_run_id,
        final_status="timed_out",
        success=False,
        last_error="Repo setup monitor timed out.",
    )
