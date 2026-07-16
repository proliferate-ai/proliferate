from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

import pytest

from proliferate.integrations import redis_lock
from proliferate.server.cloud.materialization import locks


@pytest.mark.asyncio
async def test_redis_lease_translates_connection_failure_without_detail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnavailableRedis:
        async def set(self, *_args: object, **_kwargs: object) -> None:
            raise OSError("secret redis endpoint")

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        redis_lock.Redis,
        "from_url",
        lambda *_args, **_kwargs: UnavailableRedis(),
    )

    with pytest.raises(redis_lock.RedisLeaseUnavailable) as exc_info:
        async with redis_lock.redis_lease(
            redis_url="redis://redacted.invalid",
            key="test-key",
            ttl_seconds=30,
            wait_timeout_seconds=1,
        ):
            raise AssertionError("unreachable")

    assert "secret" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_redis_lease_cancels_the_holder_when_renewal_loses_custody(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class LostRedis:
        async def set(self, *_args: object, **_kwargs: object) -> bool:
            return True

        async def eval(self, *_args: object, **_kwargs: object) -> int:
            return 0

        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(
        redis_lock.Redis,
        "from_url",
        lambda *_args, **_kwargs: LostRedis(),
    )

    with pytest.raises(redis_lock.RedisLeaseLost):
        async with redis_lock.redis_lease(
            redis_url="redis://redacted.invalid",
            key="test-key",
            ttl_seconds=1,
            wait_timeout_seconds=1,
        ):
            await asyncio.sleep(2)


@pytest.mark.asyncio
async def test_materialization_lock_maps_redis_unavailability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @asynccontextmanager
    async def unavailable(**_kwargs: object):
        raise redis_lock.RedisLeaseUnavailable("secret redis endpoint")
        yield

    monkeypatch.setattr(locks, "redis_lease", unavailable)

    with pytest.raises(locks.CloudMaterializationLockUnavailable) as exc_info:
        async with locks.redis_materialization_lock("sandbox-a"):
            raise AssertionError("unreachable")

    assert "secret" not in str(exc_info.value)
