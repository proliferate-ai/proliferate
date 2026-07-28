"""Token-owned Redis leases for cross-process critical sections."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from redis.asyncio import Redis


class RedisLeaseError(RuntimeError):
    pass


class RedisLeaseTimeout(RedisLeaseError):
    pass


class RedisLeaseUnavailable(RedisLeaseError):
    pass


class RedisLeaseLost(RedisLeaseError):
    pass


def _lease_holder_task() -> asyncio.Task[object] | None:
    return asyncio.current_task()


async def try_acquire_redis_claim(
    *,
    redis_url: str,
    key: str,
    ttl_seconds: int,
) -> str | None:
    """Take a non-blocking, token-owned claim, or return None if one is held.

    This is the fire-and-forget sibling of ``redis_lease``: there is no waiting,
    no renewal, and no critical section — the caller only wants to know whether
    it is the one that gets to start some work. Losing the race is an ordinary
    outcome (someone else is already doing it), never an error, so a Redis
    outage also returns None: no claim means no duplicate work is started.
    """

    try:
        redis = Redis.from_url(redis_url, decode_responses=True)
    except Exception:  # vendor failures are normalized at this boundary
        return None
    token = uuid4().hex
    try:
        acquired = bool(await redis.set(key, token, nx=True, ex=ttl_seconds))
    except Exception:
        return None
    finally:
        with suppress(Exception):
            await redis.aclose()
    return token if acquired else None


async def release_redis_claim(*, redis_url: str, key: str, token: str) -> None:
    """Release a claim this caller owns; a claim owned by anyone else is left alone.

    The token compare-and-delete matters because the TTL can expire mid-work: a
    later holder's claim must not be dropped by the previous holder finishing.
    """

    try:
        redis = Redis.from_url(redis_url, decode_responses=True)
    except Exception:
        return
    try:
        await redis.eval(
            (
                "if redis.call('get', KEYS[1]) == ARGV[1] then "
                "return redis.call('del', KEYS[1]) else return 0 end"
            ),
            1,
            key,
            token,
        )
    except Exception:
        return
    finally:
        with suppress(Exception):
            await redis.aclose()


async def _renew_lease(
    redis: Redis,
    *,
    key: str,
    token: str,
    ttl_seconds: int,
    lost: asyncio.Event,
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
                key,
                token,
                ttl_seconds,
            )
        except Exception:  # vendor failures are normalized at this boundary
            lost.set()
            return
        if not renewed:
            lost.set()
            return


@asynccontextmanager
async def redis_lease(
    *,
    redis_url: str,
    key: str,
    ttl_seconds: int,
    wait_timeout_seconds: int,
) -> AsyncIterator[None]:
    """Acquire and renew a token-owned Redis lease, failing if custody is lost."""

    try:
        redis = Redis.from_url(redis_url, decode_responses=True)
    except Exception as error:
        raise RedisLeaseUnavailable("Redis lease client construction failed") from error
    token = uuid4().hex
    deadline = time.monotonic() + wait_timeout_seconds
    acquired = False
    renew_task: asyncio.Task[None] | None = None
    loss_watcher: asyncio.Task[None] | None = None
    lost = asyncio.Event()
    holder = _lease_holder_task()
    body_error: BaseException | None = None
    try:
        try:
            while True:
                acquired = bool(await redis.set(key, token, nx=True, ex=ttl_seconds))
                if acquired:
                    break
                if time.monotonic() >= deadline:
                    raise RedisLeaseTimeout(f"Timed out waiting for Redis lease: {key}")
                await asyncio.sleep(0.5)
        except RedisLeaseTimeout:
            raise
        except Exception as error:
            raise RedisLeaseUnavailable("Redis lease acquisition failed") from error

        renew_task = asyncio.create_task(
            _renew_lease(
                redis,
                key=key,
                token=token,
                ttl_seconds=ttl_seconds,
                lost=lost,
            )
        )

        async def _cancel_holder_if_lost() -> None:
            await lost.wait()
            if holder is not None:
                holder.cancel()

        loss_watcher = asyncio.create_task(_cancel_holder_if_lost())
        try:
            yield
        except asyncio.CancelledError as error:
            body_error = error
            if lost.is_set():
                raise RedisLeaseLost("Redis lease was lost during the operation") from error
            raise
        except BaseException as error:
            body_error = error
            raise
    finally:
        for task in (loss_watcher, renew_task):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        cleanup_error: Exception | None = None
        lease_lost_on_release = False
        renewal_reported_lost = lost.is_set()
        if acquired:
            try:
                released = await redis.eval(
                    (
                        "if redis.call('get', KEYS[1]) == ARGV[1] then "
                        "return redis.call('del', KEYS[1]) else return 0 end"
                    ),
                    1,
                    key,
                    token,
                )
                lease_lost_on_release = not bool(released)
            except Exception as error:
                cleanup_error = error
        try:
            await redis.aclose()
        except Exception as error:
            cleanup_error = cleanup_error or error
        if cleanup_error is not None and body_error is None:
            raise RedisLeaseUnavailable("Redis lease release failed") from cleanup_error
        if (renewal_reported_lost or lease_lost_on_release) and body_error is None:
            raise RedisLeaseLost("Redis lease was lost before release")
