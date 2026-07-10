"""Personal cloud sandbox bootstrap materialization."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_repo_environment_materializations as repo_mat_store
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

logger = logging.getLogger("proliferate.cloud.materialization")


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
        # Best-effort per repo: pre-cloning each configured repo into a fresh
        # sandbox must not let one repo's failure abort the whole bootstrap
        # (secrets/agent-auth below still need to run). `materialize_repo_
        # environment_in_context` requires a materialization row + expected
        # timestamp (its own signature), so open one here — the same pattern as
        # the standalone `materialize_repo_environment`. Passing the repo object
        # directly was a latent TypeError that silently skipped every preclone.
        try:
            materialization = await repo_mat_store.begin_repo_environment_materialization(
                db,
                cloud_sandbox_id=ctx.sandbox.id,
                repo_environment_id=repo_environment.id,
            )
            attempt_updated_at = materialization.updated_at
            await db.commit()
            await repo_environment_materializer.materialize_repo_environment_in_context(
                db,
                ctx=ctx,
                repo_environment_id=repo_environment.id,
                materialization_id=materialization.id,
                attempt_updated_at=attempt_updated_at,
            )
        except Exception:
            logger.exception(
                "sandbox bootstrap repo preclone failed repo_environment_id=%s",
                repo_environment.id,
            )
            # Reset the session so a mid-transaction failure can't poison the
            # next repo or the trailing agent-auth materialization.
            await db.rollback()
    # Last, defensively: agent-auth materialization writes a fail-closed state
    # even when a selection can't yet be satisfied (e.g. enrollment still
    # syncing), and the enrollment-sync trigger re-materializes once it lands.
    await agent_auth.materialize_agent_auth(db, ctx=ctx, user_id=user_id)
