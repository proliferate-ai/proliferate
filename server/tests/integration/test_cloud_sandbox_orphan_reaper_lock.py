"""Real-Postgres proof for the cross-worker orphan-reaper singleton."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db.store.cloud_sandbox_recovery import (
    release_cloud_sandbox_orphan_reaper_lock,
    try_acquire_cloud_sandbox_orphan_reaper_lock,
)


@pytest.mark.asyncio
async def test_orphan_reaper_advisory_lock_is_cross_session_singleton(test_engine) -> None:
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as first, sessions() as second:
        assert await try_acquire_cloud_sandbox_orphan_reaper_lock(first) is True
        assert await try_acquire_cloud_sandbox_orphan_reaper_lock(second) is False

        await release_cloud_sandbox_orphan_reaper_lock(first)

        assert await try_acquire_cloud_sandbox_orphan_reaper_lock(second) is True
        await release_cloud_sandbox_orphan_reaper_lock(second)
