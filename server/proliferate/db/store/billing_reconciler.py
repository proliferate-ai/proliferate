"""Billing reconciler persistence helpers."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_RECONCILER_LOCK_KEY
from proliferate.db import engine as db_engine


async def try_acquire_billing_reconciler_lock(db: AsyncSession) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": BILLING_RECONCILER_LOCK_KEY},
    )
    return bool(result)


async def release_billing_reconciler_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(:lock_key)"),
        {"lock_key": BILLING_RECONCILER_LOCK_KEY},
    )


async def with_billing_reconciler_lock[T](
    callback: Callable[[AsyncSession], Awaitable[T]],
) -> tuple[bool, T | None]:
    async with db_engine.async_session_factory() as db:
        acquired = await try_acquire_billing_reconciler_lock(db)
        if not acquired:
            return False, None
        try:
            result = await callback(db)
            await db.commit()
            return True, result
        finally:
            await release_billing_reconciler_lock(db)
