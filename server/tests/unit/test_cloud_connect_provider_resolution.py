"""Cancellation ordering at the managed-provider resume seam."""

from __future__ import annotations

import asyncio

import pytest

from proliferate.integrations.sandbox import SandboxProviderTargetUnavailableError
from proliferate.server.cloud.materialization.sandbox_io.connect import (
    _resume_provider_sandbox,
)


class _BlockingMissingProvider:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def resume_sandbox(self, _sandbox_id: str) -> object:
        self.started.set()
        await self.release.wait()
        raise SandboxProviderTargetUnavailableError("provider target is gone")


@pytest.mark.asyncio
async def test_cancellation_does_not_swallow_authoritative_provider_absence() -> None:
    provider = _BlockingMissingProvider()
    task = asyncio.create_task(_resume_provider_sandbox(provider, "provider-old"))  # type: ignore[arg-type]
    await provider.started.wait()

    task.cancel()
    await asyncio.sleep(0)
    provider.release.set()

    with pytest.raises(SandboxProviderTargetUnavailableError):
        await task
