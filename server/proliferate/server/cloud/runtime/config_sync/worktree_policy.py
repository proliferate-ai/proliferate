"""Sync account worktree cleanup policy into managed AnyHarness runtimes."""

from __future__ import annotations

import asyncio
import logging
import time
from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.integrations import anyharness
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.worktree_policy.service import (
    load_worktree_retention_policy_for_runtime as get_worktree_retention_policy,
)
from proliferate.utils.time import duration_ms


async def update_runtime_worktree_retention_policy(
    runtime_url: str,
    access_token: str,
    *,
    max_materialized_worktrees_per_repo: int,
    workspace_id: UUID | None = None,
) -> None:
    sync_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime worktree policy sync started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
    )
    await anyharness.update_runtime_worktree_retention_policy(
        runtime_url,
        access_token,
        max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
    )
    log_cloud_event(
        "cloud runtime worktree policy sync finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        max_materialized_worktrees_per_repo=max_materialized_worktrees_per_repo,
        elapsed_ms=duration_ms(sync_started),
    )


async def run_runtime_worktree_retention(
    runtime_url: str,
    access_token: str,
    *,
    workspace_id: UUID | None = None,
) -> None:
    run_started = time.perf_counter()
    log_cloud_event(
        "cloud runtime deferred worktree retention run started",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
    )
    await anyharness.run_runtime_worktree_retention(runtime_url, access_token)
    log_cloud_event(
        "cloud runtime deferred worktree retention run finished",
        workspace_id=workspace_id,
        runtime_url=runtime_url,
        elapsed_ms=duration_ms(run_started),
    )


async def _run_deferred_cleanup_background(
    *,
    runtime_url: str,
    access_token: str,
    workspace_id: UUID | None,
) -> None:
    try:
        await run_runtime_worktree_retention(
            runtime_url,
            access_token,
            workspace_id=workspace_id,
        )
    except Exception as exc:
        log_cloud_event(
            "cloud runtime deferred worktree retention run failed",
            level=logging.WARNING,
            workspace_id=workspace_id,
            runtime_url=runtime_url,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )


async def sync_cloud_worktree_policy_to_runtime(
    *,
    user_id: UUID,
    runtime_url: str,
    access_token: str,
    workspace_id: UUID | None,
    run_deferred_startup_cleanup: bool,
    await_deferred_startup_cleanup: bool = True,
) -> int:
    async with db_engine.async_session_factory() as db:
        policy = await get_worktree_retention_policy(db, user_id)
    limit = policy.max_materialized_worktrees_per_repo
    await update_runtime_worktree_retention_policy(
        runtime_url,
        access_token,
        max_materialized_worktrees_per_repo=limit,
        workspace_id=workspace_id,
    )
    if run_deferred_startup_cleanup:
        if await_deferred_startup_cleanup:
            await run_runtime_worktree_retention(
                runtime_url,
                access_token,
                workspace_id=workspace_id,
            )
        else:
            asyncio.create_task(
                _run_deferred_cleanup_background(
                    runtime_url=runtime_url,
                    access_token=access_token,
                    workspace_id=workspace_id,
                ),
                name=f"cloud-worktree-retention-{workspace_id or 'runtime'}",
            )
    return limit
