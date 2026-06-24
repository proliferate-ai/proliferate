"""Gateway access resolution for managed sandbox runtimes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.managed_sandboxes.service import (
    ensure_managed_sandbox_ready,
    load_managed_sandbox_runtime_access,
)


class _UserWithId(Protocol):
    id: UUID


@dataclass(frozen=True)
class ManagedSandboxGatewayAccess:
    upstream_base_url: str
    upstream_token: str
    runtime_generation: int


async def ensure_managed_sandbox_gateway_access(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxGatewayAccess:
    sandbox = await ensure_managed_sandbox_ready(db, user)
    upstream_base_url, upstream_token, _data_key = await load_managed_sandbox_runtime_access(
        sandbox
    )
    return ManagedSandboxGatewayAccess(
        upstream_base_url=upstream_base_url,
        upstream_token=upstream_token,
        runtime_generation=sandbox.runtime_generation,
    )

