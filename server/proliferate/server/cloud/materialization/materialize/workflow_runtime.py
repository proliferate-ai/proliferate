"""Locked runtime custody for managed Workflow delivery."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.materialize import agent_auth


async def run_managed_workflow_runtime_operation[T](
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    user_id: UUID | None,
    run: Callable[[str, str], Awaitable[T]],
) -> T:
    """Run one managed-runtime call under the canonical sandbox lock."""

    sandbox = await cloud_sandboxes_store.load_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None or sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        raise operation.CloudMaterializationTargetUnavailable()
    await db.commit()

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
        await db.commit()
        return refreshed

    async def _run_locked(ctx: operation.MaterializationContext) -> T:
        if user_id is not None:
            await agent_auth.materialize_agent_auth(
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
        await db.commit()
        return await run(runtime_url, access_token)

    return await operation.run_cloud_sandbox_operation(
        db,
        sandbox=sandbox,
        operation_key=f"managed-workflow:{sandbox_id}",
        refresh_sandbox=_refresh_locked,
        run=_run_locked,
    )
