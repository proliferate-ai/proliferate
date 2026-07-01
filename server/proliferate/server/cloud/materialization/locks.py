"""Redis-backed locks for cloud materialization operations."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from redis.asyncio import Redis

from proliferate.config import settings

logger = logging.getLogger("proliferate.cloud.materialization")


class CloudMaterializationLockTimeout(RuntimeError):
    pass


def _lock_name(key: str) -> str:
    return f"{settings.redbeat_key_prefix}cloud-materialization:{key}"


async def _renew_lock(
    redis: Redis,
    *,
    lock_name: str,
    token: str,
    ttl_seconds: int,
) -> None:
    interval_seconds = max(1.0, min(60.0, ttl_seconds / 3))
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            renewed = await redis.eval(
                (
                    "if redis.call('get', KEYS[1]) == ARGV[1] then "
                    "return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end"
                ),
                1,
                lock_name,
                token,
                ttl_seconds,
            )
        except Exception:
            logger.exception("cloud materialization lock renewal failed key=%s", lock_name)
            continue
        if not renewed:
            return


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
    renew_task: asyncio.Task[None] | None = None
    try:
        while True:
            acquired = await redis.set(lock_name, token, nx=True, ex=ttl_seconds)
            if acquired:
                acquired_lock = True
                renew_task = asyncio.create_task(
                    _renew_lock(
                        redis,
                        lock_name=lock_name,
                        token=token,
                        ttl_seconds=ttl_seconds,
                    )
                )
                break
            if time.monotonic() >= deadline:
                raise CloudMaterializationLockTimeout(
                    f"Timed out waiting for materialization lock: {key}"
                )
            await asyncio.sleep(0.5)
        yield
    finally:
        if renew_task is not None:
            renew_task.cancel()
            with suppress(asyncio.CancelledError):
                await renew_task
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
