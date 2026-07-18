"""Shared operation skeleton for cloud sandbox materialization."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.materialization import locks, sandbox_io
from proliferate.server.cloud.provisioning_observability import provisioning_phase


class CloudMaterializationError(RuntimeError):
    pass


class CloudMaterializationTargetUnavailable(CloudMaterializationError):
    """The exact frozen managed target no longer exists."""


class CloudMaterializationConfigurationError(CloudMaterializationError):
    """Durable authority or configuration prevents materialization."""


@dataclass(frozen=True)
class MaterializationContext:
    sandbox: CloudSandboxValue
    target: sandbox_io.SandboxIOTarget


async def run_cloud_sandbox_operation[T](
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
    operation_key: str,
    lock_ttl_seconds: int = 600,
    wait_timeout_seconds: int = 300,
    refresh_sandbox: Callable[[], Awaitable[CloudSandboxValue]] | None = None,
    run: Callable[[MaterializationContext], Awaitable[T]],
) -> T:
    # Loading or ensuring the sandbox starts a transaction in normal callers.
    # End it before a potentially long distributed-lock wait so the lock holder
    # can refresh authoritative state without competing with a stale checkout.
    if db.in_transaction():
        async with provisioning_phase(
            scope="sandbox_operation",
            phase="request_transaction_commit",
            operation_key=operation_key,
            cloud_sandbox_id=sandbox.id,
        ):
            await db.commit()
    async with AsyncExitStack() as stack:
        async with provisioning_phase(
            scope="sandbox_operation",
            phase="materialization_lock",
            operation_key=operation_key,
            cloud_sandbox_id=sandbox.id,
        ):
            await stack.enter_async_context(
                locks.redis_materialization_lock(
                    f"cloud-sandbox:{sandbox.id}",
                    ttl_seconds=lock_ttl_seconds,
                    wait_timeout_seconds=wait_timeout_seconds,
                )
            )
        if refresh_sandbox is not None:
            async with provisioning_phase(
                scope="sandbox_operation",
                phase="sandbox_refresh",
                operation_key=operation_key,
                cloud_sandbox_id=sandbox.id,
            ):
                locked_sandbox = await refresh_sandbox()
        else:
            async with provisioning_phase(
                scope="sandbox_operation",
                phase="sandbox_refresh",
                operation_key=operation_key,
                cloud_sandbox_id=sandbox.id,
            ):
                refreshed = await cloud_sandboxes_store.load_cloud_sandbox_by_id(
                    db,
                    sandbox.id,
                    refresh=True,
                )
                if refreshed is None or refreshed.destroyed_at is not None:
                    raise CloudMaterializationTargetUnavailable("Cloud sandbox no longer exists.")
                locked_sandbox = refreshed
        async with provisioning_phase(
            scope="sandbox_operation",
            phase="sandbox_connect",
            operation_key=operation_key,
            cloud_sandbox_id=locked_sandbox.id,
        ):
            target = await sandbox_io.connect_ready_sandbox(db, sandbox=locked_sandbox)
        async with provisioning_phase(
            scope="sandbox_operation",
            phase="operation_callback",
            operation_key=operation_key,
            cloud_sandbox_id=locked_sandbox.id,
        ):
            return await run(MaterializationContext(sandbox=locked_sandbox, target=target))
