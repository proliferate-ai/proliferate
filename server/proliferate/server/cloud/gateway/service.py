"""Gateway access resolution for cloud sandbox runtimes."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.billing.authorization import (
    assert_cloud_sandbox_resume_allowed_for_owner,
)
from proliferate.server.cloud.cloud_sandboxes.service import (
    ensure_personal_cloud_sandbox_exists,
    load_cloud_sandbox_runtime_access,
    require_cloud_provisioning_configured,
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
_GATEWAY_BILLING_ALLOW_CACHE_TTL_SECONDS = 5.0
_gateway_access_cache: dict[UUID, _CachedCloudSandboxGatewayAccess] = {}
_gateway_access_locks: dict[UUID, asyncio.Lock] = {}
_gateway_billing_allow_cache: dict[UUID, float] = {}
_gateway_billing_locks: dict[UUID, asyncio.Lock] = {}


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


def _gateway_billing_lock(user_id: UUID) -> asyncio.Lock:
    lock = _gateway_billing_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _gateway_billing_locks[user_id] = lock
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


def invalidate_cloud_sandbox_gateway_access_for_user(user_id: UUID) -> None:
    """Forget runtime coordinates after their owning row clears or dies."""

    _gateway_access_cache.pop(user_id, None)


def _reset_cloud_sandbox_gateway_access_cache_for_tests() -> None:
    _gateway_access_cache.clear()
    _gateway_access_locks.clear()
    _gateway_billing_allow_cache.clear()
    _gateway_billing_locks.clear()


def _billing_allow_is_cached(user_id: UUID) -> bool:
    expires_at = _gateway_billing_allow_cache.get(user_id)
    if expires_at is None:
        return False
    if expires_at <= time.monotonic():
        _gateway_billing_allow_cache.pop(user_id, None)
        return False
    return True


async def _assert_gateway_billing_allowed(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    if _billing_allow_is_cached(user_id):
        return

    async with _gateway_billing_lock(user_id):
        if _billing_allow_is_cached(user_id):
            return
        # This authorizer builds the complete billing snapshot and may evaluate
        # compute-budget windows, so cache only successful decisions briefly.
        # A 402 is never remembered; the next request re-checks immediately.
        await assert_cloud_sandbox_resume_allowed_for_owner(
            db,
            owner_user_id=user_id,
        )
        _gateway_billing_allow_cache[user_id] = (
            time.monotonic() + _GATEWAY_BILLING_ALLOW_CACHE_TTL_SECONDS
        )


async def ensure_cloud_sandbox_gateway_access(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxGatewayAccess:
    require_cloud_provisioning_configured()
    await _assert_gateway_billing_allowed(db, user_id=user.id)

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
    sandbox = await ensure_personal_cloud_sandbox_exists(db, user_id=user.id)
    upstream_base_url, upstream_token, _data_key = await load_cloud_sandbox_runtime_access(sandbox)
    return CloudSandboxGatewayAccess(
        upstream_base_url=upstream_base_url,
        upstream_token=upstream_token,
        runtime_generation=sandbox.runtime_generation,
    )
