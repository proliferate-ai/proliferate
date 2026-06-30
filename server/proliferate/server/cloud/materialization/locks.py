"""Redis-backed locks for cloud materialization operations."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from redis.asyncio import Redis

from proliferate.config import settings


class CloudMaterializationLockTimeout(RuntimeError):
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
    redis = Redis.from_url(settings.redbeat_redis_url, decode_responses=True)
    lock_name = _lock_name(key)
    token = uuid4().hex
    deadline = time.monotonic() + wait_timeout_seconds
    acquired_lock = False
    try:
        while True:
            acquired = await redis.set(lock_name, token, nx=True, ex=ttl_seconds)
            if acquired:
                acquired_lock = True
                break
            if time.monotonic() >= deadline:
                raise CloudMaterializationLockTimeout(
                    f"Timed out waiting for materialization lock: {key}"
                )
            await asyncio.sleep(0.5)
        yield
    finally:
        if acquired_lock:
            await redis.eval(
                (
                    "if redis.call('get', KEYS[1]) == ARGV[1] then "
                    "return redis.call('del', KEYS[1]) else return 0 end"
                ),
                1,
                lock_name,
                token,
            )
        await redis.aclose()
