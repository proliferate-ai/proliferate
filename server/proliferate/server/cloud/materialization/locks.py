"""Redis-backed locks for cloud materialization operations."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from proliferate.config import settings
from proliferate.integrations.redis_lock import (
    RedisLeaseLost,
    RedisLeaseTimeout,
    RedisLeaseUnavailable,
    redis_lease,
    release_redis_claim,
    try_acquire_redis_claim,
)


class CloudMaterializationLockTimeout(RuntimeError):
    pass


class CloudMaterializationLockUnavailable(RuntimeError):
    pass


class CloudMaterializationLockLost(RuntimeError):
    pass


def _lock_name(key: str) -> str:
    return f"{settings.redbeat_key_prefix}cloud-materialization:{key}"


def _claim_name(key: str) -> str:
    return f"{settings.redbeat_key_prefix}cloud-materialization-claim:{key}"


async def try_claim_materialization_trigger(
    key: str,
    *,
    ttl_seconds: int,
) -> str | None:
    """Claim the right to *schedule* a materialization, without waiting for one.

    Distinct from ``redis_materialization_lock``, which serializes the
    materialization itself: this claim is what stops N concurrent request
    handlers from each spawning a background materialization for the same cold
    sandbox. The winner schedules; the losers do nothing and let the winner's
    run repair the row. Cross-process by construction (Redis), so it holds
    across API workers, and it self-heals on TTL expiry if the winner's process
    dies before it can release.

    Returns an opaque release token, or None when someone else holds the claim
    (or Redis is unreachable). Treating an outage as "no claim" costs nothing
    real: ``redis_materialization_lock`` needs the same Redis, so a
    materialization scheduled during an outage could only fail on the lock.
    """

    return await try_acquire_redis_claim(
        redis_url=settings.redbeat_redis_url,
        key=_claim_name(key),
        ttl_seconds=ttl_seconds,
    )


async def release_materialization_trigger_claim(key: str, *, token: str) -> None:
    await release_redis_claim(
        redis_url=settings.redbeat_redis_url,
        key=_claim_name(key),
        token=token,
    )


@asynccontextmanager
async def redis_materialization_lock(
    key: str,
    *,
    ttl_seconds: int = 600,
    wait_timeout_seconds: int = 300,
) -> AsyncIterator[None]:
    try:
        async with redis_lease(
            redis_url=settings.redbeat_redis_url,
            key=_lock_name(key),
            ttl_seconds=ttl_seconds,
            wait_timeout_seconds=wait_timeout_seconds,
        ):
            yield
    except RedisLeaseTimeout as error:
        raise CloudMaterializationLockTimeout(
            f"Timed out waiting for materialization lock: {key}"
        ) from error
    except RedisLeaseUnavailable as error:
        raise CloudMaterializationLockUnavailable(
            "Cloud materialization lock service is unavailable"
        ) from error
    except RedisLeaseLost as error:
        raise CloudMaterializationLockLost("Cloud materialization lock was lost") from error
