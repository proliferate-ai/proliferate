"""Worker-facing entrypoints for Cloud background operations."""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sandbox_recovery import (
    release_cloud_sandbox_orphan_reaper_lock,
    try_acquire_cloud_sandbox_orphan_reaper_lock,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    get_configured_sandbox_provider,
)
from proliferate.server.cloud.worker.orphan_sandboxes import reap_orphan_sandboxes

logger = logging.getLogger("proliferate.cloud.orphan_reaper")


async def run_orphan_sandbox_reap_pass(
    db: AsyncSession,
    *,
    provider: SandboxProvider | None = None,
) -> None:
    """Run one advisory-locked, fail-closed provider orphan scan."""

    acquired = await try_acquire_cloud_sandbox_orphan_reaper_lock(db)
    if not acquired:
        logger.debug("orphan reaper skipped because another worker owns the lock")
        return
    try:
        await reap_orphan_sandboxes(
            db,
            provider=provider or get_configured_sandbox_provider(),
        )
    finally:
        await release_cloud_sandbox_orphan_reaper_lock(db)
