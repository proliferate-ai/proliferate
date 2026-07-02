"""Personal cloud sandbox bootstrap materialization."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store import repositories as repositories_store
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.materialize import (
    agent_auth,
    github_credentials,
    secret_set,
)
from proliferate.server.cloud.materialization.materialize import (
    repo_environment as repo_environment_materializer,
)


async def materialize_sandbox(db: AsyncSession, *, user_id: UUID) -> None:
    sandbox = await cloud_sandboxes_store.load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        raise operation.CloudMaterializationError("cloud_sandbox_missing")
    await operation.run_cloud_sandbox_operation(
        db,
        sandbox=sandbox,
        operation_key="sandbox",
        run=lambda ctx: _materialize_sandbox(ctx, db=db, user_id=user_id),
    )


async def _materialize_sandbox(
    ctx: operation.MaterializationContext,
    *,
    db: AsyncSession,
    user_id: UUID,
) -> None:
    await github_credentials.materialize_github_credentials(
        db,
        target=ctx.target,
        operation_id=ctx.sandbox.id,
        user_id=user_id,
    )
    await secret_set.materialize_global_secrets_for_user(
        db,
        ctx=ctx,
        user_id=user_id,
    )
    repo_environments = await repositories_store.list_cloud_repo_environments(
        db,
        user_id=user_id,
    )
    for repo_environment in repo_environments:
        await repo_environment_materializer.materialize_repo_environment_in_context(
            db,
            ctx=ctx,
            repo_environment=repo_environment,
        )
    # Last, defensively: agent-auth materialization writes a fail-closed state
    # even when a selection can't yet be satisfied (e.g. enrollment still
    # syncing), and the enrollment-sync trigger re-materializes once it lands.
    await agent_auth.materialize_agent_auth(db, ctx=ctx, user_id=user_id)
