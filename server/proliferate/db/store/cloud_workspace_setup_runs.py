"""Persistence helpers for cloud workspace setup-run monitoring."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import WorkspacePostReadyPhase
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudWorkspace, CloudWorkspaceSetupRun
from proliferate.utils.time import utcnow

SETUP_RUN_ACTIVE_STATUSES = ("pending", "running")
SETUP_MONITOR_CLAIM_TTL = timedelta(seconds=45)
SETUP_MONITOR_POLL_INTERVAL = timedelta(seconds=5)
MAX_SETUP_MONITOR_ERROR_CHARS = 2000


def _bounded_error(value: str | None) -> str | None:
    if value is None:
        return None
    return value[:MAX_SETUP_MONITOR_ERROR_CHARS]


async def create_cloud_workspace_setup_run(
    *,
    workspace_id: UUID,
    anyharness_workspace_id: str,
    terminal_id: str | None,
    command_run_id: str,
    setup_script_version: int,
    apply_token: str,
    deadline_at: datetime,
    status: str = "running",
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
    status: str = "running",
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
        run.last_error = _bounded_error(last_error)
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
    if workspace is None:
        run.status = "stale"
        run.claim_owner = None
        run.claim_until = None
        run.last_error = "Cloud workspace no longer exists."
        run.updated_at = now
        return

    active_matches = bool(
        workspace.repo_post_ready_apply_token == run.apply_token
        and run.command_run_id
        and workspace.repo_post_ready_phase == WorkspacePostReadyPhase.starting_setup.value
    )
    if not active_matches:
        run.status = "stale"
        run.claim_owner = None
        run.claim_until = None
        run.last_error = "Setup run was superseded by a newer apply."
        run.updated_at = now
        return

    run.status = final_status
    run.claim_owner = None
    run.claim_until = None
    run.last_polled_at = now
    run.next_poll_at = None
    run.last_error = _bounded_error(last_error)
    run.updated_at = now

    workspace.repo_post_ready_completed_at = now
    workspace.repo_post_ready_apply_token = None
    workspace.updated_at = now
    if success:
        workspace.repo_post_ready_phase = WorkspacePostReadyPhase.completed.value
        workspace.repo_setup_applied_version = run.setup_script_version
        workspace.repo_files_last_failed_path = None
        workspace.repo_files_last_error = None
        workspace.status_detail = "Ready"
    else:
        workspace.repo_post_ready_phase = WorkspacePostReadyPhase.failed.value
        workspace.repo_files_last_failed_path = None
        workspace.repo_files_last_error = _bounded_error(last_error) or "Repo setup failed"
        workspace.status_detail = "Repo setup failed"


async def mark_setup_run_timed_out(setup_run_id: UUID) -> None:
    await finalize_setup_run(
        setup_run_id,
        final_status="timed_out",
        success=False,
        last_error="Repo setup monitor timed out.",
    )
