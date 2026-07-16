"""Shared operation skeleton for cloud sandbox materialization."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.materialization import locks, sandbox_io


class CloudMaterializationError(RuntimeError):
    pass


class CloudMaterializationTargetUnavailable(CloudMaterializationError):
    """The exact frozen managed target no longer exists."""


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
    del operation_key
    async with locks.redis_materialization_lock(
        f"cloud-sandbox:{sandbox.id}",
        ttl_seconds=lock_ttl_seconds,
        wait_timeout_seconds=wait_timeout_seconds,
    ):
        locked_sandbox = await refresh_sandbox() if refresh_sandbox is not None else sandbox
        target = await sandbox_io.connect_ready_sandbox(db, sandbox=locked_sandbox)
        return await run(MaterializationContext(sandbox=locked_sandbox, target=target))
