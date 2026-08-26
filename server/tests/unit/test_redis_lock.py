from __future__ import annotations

import asyncio
import uuid

import pytest

from proliferate.config import settings
from proliferate.integrations import redis_lock


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
async def test_redis_claim_is_taken_once_and_reusable_after_release() -> None:
    """The non-blocking claim behind cold-access repair scheduling.

    Exercised against the live Redis the suite already needs: the
    first caller wins, concurrent callers get None (no duplicate work
    scheduled), and the winner's release frees the key for a later retry.
    """
    key = f"proliferate-test-claim:{uuid.uuid4().hex}"
    url = settings.redbeat_redis_url

    first = await redis_lock.try_acquire_redis_claim(redis_url=url, key=key, ttl_seconds=30)
    assert first is not None

    contenders = await asyncio.gather(
        *(
            redis_lock.try_acquire_redis_claim(redis_url=url, key=key, ttl_seconds=30)
            for _ in range(5)
        )
    )
    assert contenders == [None] * 5

    await redis_lock.release_redis_claim(redis_url=url, key=key, token=first)

    second = await redis_lock.try_acquire_redis_claim(redis_url=url, key=key, ttl_seconds=30)
    assert second is not None
    assert second != first
    await redis_lock.release_redis_claim(redis_url=url, key=key, token=second)


@pytest.mark.asyncio
async def test_stale_release_does_not_drop_a_later_holders_claim() -> None:
    """A previous holder finishing after TTL expiry must not free the new holder."""
    key = f"proliferate-test-claim:{uuid.uuid4().hex}"
    url = settings.redbeat_redis_url

    stale_token = await redis_lock.try_acquire_redis_claim(redis_url=url, key=key, ttl_seconds=30)
    assert stale_token is not None
    # Simulate the TTL lapsing and a second holder taking over.
    await redis_lock.release_redis_claim(redis_url=url, key=key, token=stale_token)
    live_token = await redis_lock.try_acquire_redis_claim(redis_url=url, key=key, ttl_seconds=30)
    assert live_token is not None

    # The first holder now finishes and releases with its own (stale) token.
    await redis_lock.release_redis_claim(redis_url=url, key=key, token=stale_token)

    # The live claim survived, so no third caller can start duplicate work.
    assert await redis_lock.try_acquire_redis_claim(redis_url=url, key=key, ttl_seconds=30) is None
    await redis_lock.release_redis_claim(redis_url=url, key=key, token=live_token)


@pytest.mark.asyncio
async def test_claim_returns_none_when_redis_is_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An outage degrades to "no claim", never to an exception on a request path."""

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

    claim = await redis_lock.try_acquire_redis_claim(
        redis_url="redis://redacted.invalid",
        key="test-key",
        ttl_seconds=30,
    )
    assert claim is None
