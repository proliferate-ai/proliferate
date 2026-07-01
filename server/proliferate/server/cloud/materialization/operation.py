"""Shared operation skeleton for cloud sandbox materialization."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.materialization import locks, sandbox_io


class CloudMaterializationError(RuntimeError):
    pass


@dataclass(frozen=True)
class MaterializationContext:
    sandbox: CloudSandboxValue
    target: sandbox_io.SandboxIOTarget


async def run_cloud_sandbox_operation(
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
    operation_key: str,
    lock_ttl_seconds: int = 600,
    wait_timeout_seconds: int = 300,
    run: Callable[[MaterializationContext], Awaitable[None]],
) -> None:
    del operation_key
    async with locks.redis_materialization_lock(
        f"cloud-sandbox:{sandbox.id}",
        ttl_seconds=lock_ttl_seconds,
        wait_timeout_seconds=wait_timeout_seconds,
    ):
        target = await sandbox_io.connect_ready_sandbox(db, sandbox=sandbox)
        await run(MaterializationContext(sandbox=sandbox, target=target))
