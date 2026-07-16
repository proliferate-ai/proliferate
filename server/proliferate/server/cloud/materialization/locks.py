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
)


class CloudMaterializationLockTimeout(RuntimeError):
    pass


class CloudMaterializationLockUnavailable(RuntimeError):
    pass


class CloudMaterializationLockLost(RuntimeError):
    pass


def _lock_name(key: str) -> str:
    return f"{settings.redbeat_key_prefix}cloud-materialization:{key}"


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
