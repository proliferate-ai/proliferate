"""Public cloud materialization entrypoints."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.cloud_sandboxes import transactions as cloud_sandboxes_transactions
from proliferate.server.cloud.materialization import operation, runner
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


async def materialize_repo_environment_at_frozen_base(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
    base_ref: str,
    expected_cloud_sandbox_id: UUID,
) -> None:
    """Materialize one Cloud repo using the invocation's persisted base ref."""

    await repo_environment_materializer.materialize_repo_environment(
        db,
        repo_environment_id=repo_environment_id,
        frozen_base_ref=base_ref,
        expected_cloud_sandbox_id=expected_cloud_sandbox_id,
    )


async def run_managed_workflow_runtime_operation[T](
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    user_id: UUID | None,
    run: Callable[[str, str], Awaitable[T]],
) -> T:
    """Run one managed-runtime call under the canonical sandbox lock.

    A delivery target may be claimed by duplicate workers. The lock therefore
    owns cold create/resume/launch, optional agent-auth reconciliation, the
    refreshed runtime credential read, and the caller's first custody probe.
    """

    sandbox = await cloud_sandboxes_store.load_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None or sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        raise operation.CloudMaterializationTargetUnavailable()
    await cloud_sandboxes_transactions.commit_cloud_sandbox_session(db)

    async def _refresh_locked() -> cloud_sandboxes_store.CloudSandboxValue:
        refreshed = await cloud_sandboxes_store.load_cloud_sandbox_by_id(
            db,
            sandbox_id,
            refresh=True,
        )
        if (
            refreshed is None
            or refreshed.destroyed_at is not None
            or refreshed.status == "destroyed"
        ):
            raise operation.CloudMaterializationTargetUnavailable()
        return refreshed

    async def _run_locked(ctx: operation.MaterializationContext) -> T:
        if user_id is not None:
            await agent_auth_materializer.materialize_agent_auth(
                db,
                ctx=ctx,
                user_id=user_id,
            )
        refreshed = await cloud_sandboxes_store.load_cloud_sandbox_by_id(
            db,
            sandbox_id,
            refresh=True,
        )
        if (
            refreshed is None
            or refreshed.destroyed_at is not None
            or refreshed.status == "destroyed"
        ):
            raise operation.CloudMaterializationTargetUnavailable()
        (
            runtime_url,
            access_token,
            _data_key,
        ) = await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(refreshed)
        await cloud_sandboxes_transactions.commit_cloud_sandbox_session(db)
        return await run(runtime_url, access_token)

    return await operation.run_cloud_sandbox_operation(
        db,
        sandbox=sandbox,
        operation_key=f"managed-workflow:{sandbox_id}",
        refresh_sandbox=_refresh_locked,
        run=_run_locked,
    )


async def materialize_secret_set(db: AsyncSession, *, secret_set_id: UUID) -> None:
    await secret_set_materializer.materialize_secret_set(db, secret_set_id=secret_set_id)


async def materialize_agent_auth(db: AsyncSession, *, user_id: UUID) -> None:
    await agent_auth_materializer.materialize_agent_auth_for_user(db, user_id=user_id)


async def _spawn(fn: Callable[..., Awaitable[None]], **kwargs: object) -> None:
    runner.spawn_materialization_task(fn, **kwargs)
