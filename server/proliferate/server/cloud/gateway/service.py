"""Gateway access resolution for cloud sandbox runtimes."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.cloud_sandboxes.service import (
    ensure_cloud_sandbox_ready,
    load_cloud_sandbox_runtime_access,
)


class _UserWithId(Protocol):
    id: UUID


@dataclass(frozen=True)
class CloudSandboxGatewayAccess:
    upstream_base_url: str
    upstream_token: str
    runtime_generation: int


@dataclass(frozen=True)
class _CachedCloudSandboxGatewayAccess:
    access: CloudSandboxGatewayAccess
    expires_at_monotonic: float


_GATEWAY_ACCESS_CACHE_TTL_SECONDS = 60.0
_gateway_access_cache: dict[UUID, _CachedCloudSandboxGatewayAccess] = {}
_gateway_access_locks: dict[UUID, asyncio.Lock] = {}


def _cached_gateway_access(user_id: UUID) -> CloudSandboxGatewayAccess | None:
    cached = _gateway_access_cache.get(user_id)
    if cached is None:
        return None
    if cached.expires_at_monotonic <= time.monotonic():
        _gateway_access_cache.pop(user_id, None)
        return None
    return cached.access


def _gateway_access_lock(user_id: UUID) -> asyncio.Lock:
    lock = _gateway_access_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _gateway_access_locks[user_id] = lock
    return lock


def _remember_gateway_access(
    user_id: UUID,
    access: CloudSandboxGatewayAccess,
) -> CloudSandboxGatewayAccess:
    _gateway_access_cache[user_id] = _CachedCloudSandboxGatewayAccess(
        access=access,
        expires_at_monotonic=time.monotonic() + _GATEWAY_ACCESS_CACHE_TTL_SECONDS,
    )
    return access


def _reset_cloud_sandbox_gateway_access_cache_for_tests() -> None:
    _gateway_access_cache.clear()
    _gateway_access_locks.clear()


async def ensure_cloud_sandbox_gateway_access(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxGatewayAccess:
    cached = _cached_gateway_access(user.id)
    if cached is not None:
        return cached

    async with _gateway_access_lock(user.id):
        cached = _cached_gateway_access(user.id)
        if cached is not None:
            return cached

        access = await _resolve_cloud_sandbox_gateway_access(db, user)
        return _remember_gateway_access(user.id, access)


async def _resolve_cloud_sandbox_gateway_access(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxGatewayAccess:
    sandbox = await ensure_cloud_sandbox_ready(db, user)
    upstream_base_url, upstream_token, _data_key = await load_cloud_sandbox_runtime_access(
        sandbox
    )
    return CloudSandboxGatewayAccess(
        upstream_base_url=upstream_base_url,
        upstream_token=upstream_token,
        runtime_generation=sandbox.runtime_generation,
    )
