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
async def test_redis_lease_fails_when_renewal_loss_precedes_normal_body_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    renewal_lost = asyncio.Event()

    class RedisWithSuccessfulRelease:
        async def set(self, *_args: object, **_kwargs: object) -> bool:
            return True

        async def eval(self, *_args: object, **_kwargs: object) -> int:
            return 1

        async def aclose(self) -> None:
            return None

    async def lose_renewal(
        _redis: object,
        *,
        key: str,
        token: str,
        ttl_seconds: int,
        lost: asyncio.Event,
    ) -> None:
        del key, token, ttl_seconds
        lost.set()
        renewal_lost.set()

    monkeypatch.setattr(
        redis_lock.Redis,
        "from_url",
        lambda *_args, **_kwargs: RedisWithSuccessfulRelease(),
    )
    monkeypatch.setattr(redis_lock, "_renew_lease", lose_renewal)
    monkeypatch.setattr(redis_lock, "_lease_holder_task", lambda: None)

    with pytest.raises(redis_lock.RedisLeaseLost):
        async with redis_lock.redis_lease(
            redis_url="redis://redacted.invalid",
            key="test-key",
            ttl_seconds=30,
            wait_timeout_seconds=1,
        ):
            await renewal_lost.wait()


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
