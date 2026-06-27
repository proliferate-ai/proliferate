"""High-level managed sandbox materialization entrypoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_repo_config import get_cloud_repo_config
from proliferate.db.store.managed_sandboxes import ManagedSandboxValue
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.managed_sandboxes.materialization import repos, secrets


async def _run_with_fresh_session(
    callback: Callable[[AsyncSession], Awaitable[None]],
) -> None:
    async with db_engine.async_session_factory() as fresh_db:
        await callback(fresh_db)
        await db_engine.commit_session(fresh_db)


def _defer_materialization(
    db: AsyncSession,
    callback: Callable[[], Awaitable[None]],
) -> None:
    db_engine.defer_after_commit(db, callback)


async def reconcile_after_sandbox_ready(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
) -> None:
    await secrets.materialize_global_secrets(db, sandbox=sandbox)
    await repos.reconcile_configured_repos_for_sandbox(db, sandbox=sandbox, run_setup=False)


def schedule_global_secret_materialization_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    async def _materialize(fresh_db: AsyncSession) -> None:
        user = await fresh_db.get(User, user_id)
        if user is None:
            return
        from proliferate.server.cloud.managed_sandboxes.service import (
            ensure_managed_sandbox_ready,
        )

        sandbox = await ensure_managed_sandbox_ready(fresh_db, user)
        await secrets.materialize_global_secrets(fresh_db, sandbox=sandbox)

    async def _run() -> None:
        try:
            await _run_with_fresh_session(_materialize)
        except Exception as exc:
            log_cloud_event(
                "managed sandbox global secret materialization failed",
                user_id=user_id,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )

    _defer_materialization(db, _run)


def schedule_global_secret_materialization_for_organization(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> None:
    async def _materialize(fresh_db: AsyncSession) -> None:
        members = await organization_store.list_organization_members(fresh_db, organization_id)
        from proliferate.server.cloud.managed_sandboxes.service import (
            ensure_managed_sandbox_ready,
        )

        for member in members:
            user = await fresh_db.get(User, member.membership.user_id)
            if user is None:
                continue
            sandbox = await ensure_managed_sandbox_ready(fresh_db, user)
            await secrets.materialize_global_secrets(fresh_db, sandbox=sandbox)

    async def _run() -> None:
        try:
            await _run_with_fresh_session(_materialize)
        except Exception as exc:
            log_cloud_event(
                "managed sandbox organization secret materialization failed",
                organization_id=organization_id,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )

    _defer_materialization(db, _run)


def schedule_workspace_secret_materialization_for_repo(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> None:
    async def _materialize(fresh_db: AsyncSession) -> None:
        user = await fresh_db.get(User, user_id)
        if user is None:
            return
        repo_config = await get_cloud_repo_config(
            fresh_db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        if repo_config is None or not repo_config.configured:
            return
        from proliferate.server.cloud.managed_sandboxes.service import (
            ensure_managed_sandbox_ready,
        )

        sandbox = await ensure_managed_sandbox_ready(fresh_db, user)
        materialization = await repos.ensure_repo_materialized(
            fresh_db,
            sandbox=sandbox,
            repo_config=repo_config,
            run_setup=False,
        )
        await secrets.materialize_workspace_secrets(
            fresh_db,
            sandbox=sandbox,
            repo_config=repo_config,
            repo_path=materialization.repo_path,
        )

    async def _run() -> None:
        try:
            await _run_with_fresh_session(_materialize)
        except Exception as exc:
            log_cloud_event(
                "managed sandbox workspace secret materialization failed",
                user_id=user_id,
                repo=f"{git_owner}/{git_repo_name}",
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )

    _defer_materialization(db, _run)
