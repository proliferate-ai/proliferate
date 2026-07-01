from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.gateway import service


@pytest.fixture(autouse=True)
def reset_gateway_access_cache() -> object:
    service._reset_cloud_sandbox_gateway_access_cache_for_tests()
    yield
    service._reset_cloud_sandbox_gateway_access_cache_for_tests()


@pytest.mark.asyncio
async def test_gateway_access_reuses_recent_runtime_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    sandbox = SimpleNamespace(runtime_generation=7)
    ensure_calls = 0
    load_calls = 0

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        nonlocal ensure_calls
        ensure_calls += 1
        return sandbox

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        nonlocal load_calls
        load_calls += 1
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    first = await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )
    second = await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )

    assert first is second
    assert first.upstream_base_url == "https://sandbox.example.test"
    assert first.upstream_token == "sandbox-token"
    assert first.runtime_generation == 7
    assert ensure_calls == 1
    assert load_calls == 1


@pytest.mark.asyncio
async def test_gateway_access_singleflights_concurrent_runtime_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    sandbox = SimpleNamespace(runtime_generation=8)
    ensure_calls = 0
    load_calls = 0

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        nonlocal ensure_calls
        ensure_calls += 1
        await asyncio.sleep(0.01)
        return sandbox

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        nonlocal load_calls
        load_calls += 1
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    results = await asyncio.gather(
        *(
            service.ensure_cloud_sandbox_gateway_access(
                cast(AsyncSession, object()),
                cast(service._UserWithId, user),
            )
            for _ in range(10)
        )
    )

    assert {result.runtime_generation for result in results} == {8}
    assert {result.upstream_token for result in results} == {"sandbox-token"}
    assert ensure_calls == 1
    assert load_calls == 1


@pytest.mark.asyncio
async def test_gateway_access_refreshes_after_cache_expiry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    ensure_calls = 0
    now = 1000.0

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        nonlocal ensure_calls
        ensure_calls += 1
        return SimpleNamespace(runtime_generation=ensure_calls)

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        return ("https://sandbox.example.test", f"sandbox-token-{ensure_calls}", "data-key")

    def monotonic() -> float:
        return now

    monkeypatch.setattr(service, "_GATEWAY_ACCESS_CACHE_TTL_SECONDS", 1.0)
    monkeypatch.setattr(service.time, "monotonic", monotonic)
    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    first = await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )
    now += 2.0
    second = await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )

    assert first.runtime_generation == 1
    assert first.upstream_token == "sandbox-token-1"
    assert second.runtime_generation == 2
    assert second.upstream_token == "sandbox-token-2"
    assert ensure_calls == 2
