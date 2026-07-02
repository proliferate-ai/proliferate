"""Public cloud materialization entrypoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.materialization import runner
from proliferate.server.cloud.materialization.materialize import (
    agent_auth as agent_auth_materializer,
)
from proliferate.server.cloud.materialization.materialize import (
    repo_environment as repo_environment_materializer,
)
from proliferate.server.cloud.materialization.materialize import (
    sandbox as sandbox_materializer,
)
from proliferate.server.cloud.materialization.materialize import (
    secret_set as secret_set_materializer,
)


async def schedule_materialize_sandbox(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    await runner.run_after_commit(
        db,
        label=f"materialize_sandbox:{user_id}",
        task=lambda: _spawn(materialize_sandbox, user_id=user_id),
    )


async def schedule_materialize_repo_environment(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> None:
    await runner.run_after_commit(
        db,
        label=f"materialize_repo_environment:{repo_environment_id}",
        task=lambda: _spawn(
            materialize_repo_environment,
            repo_environment_id=repo_environment_id,
        ),
    )


async def schedule_materialize_secret_set(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
) -> None:
    await runner.run_after_commit(
        db,
        label=f"materialize_secret_set:{secret_set_id}",
        task=lambda: _spawn(materialize_secret_set, secret_set_id=secret_set_id),
    )


async def schedule_materialize_agent_auth(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    """Refresh agent-auth state in the user's active cloud sandbox after commit."""
    await runner.run_after_commit(
        db,
        label=f"materialize_agent_auth:{user_id}",
        task=lambda: _spawn(materialize_agent_auth, user_id=user_id),
    )


async def materialize_sandbox(db: AsyncSession, *, user_id: UUID) -> None:
    await sandbox_materializer.materialize_sandbox(db, user_id=user_id)


async def materialize_repo_environment(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> None:
    await repo_environment_materializer.materialize_repo_environment(
        db,
        repo_environment_id=repo_environment_id,
    )


async def materialize_secret_set(db: AsyncSession, *, secret_set_id: UUID) -> None:
    await secret_set_materializer.materialize_secret_set(db, secret_set_id=secret_set_id)


async def materialize_agent_auth(db: AsyncSession, *, user_id: UUID) -> None:
    await agent_auth_materializer.materialize_agent_auth_for_user(db, user_id=user_id)


async def _spawn(fn: Callable[..., Awaitable[None]], **kwargs: object) -> None:
    runner.spawn_materialization_task(fn, **kwargs)
