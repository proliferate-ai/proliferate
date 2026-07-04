from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, patch
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
    sandbox = SimpleNamespace(runtime_generation=7, e2b_sandbox_id=None, e2b_template_ref=None)
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
    sandbox = SimpleNamespace(runtime_generation=8, e2b_sandbox_id=None, e2b_template_ref=None)
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
        return SimpleNamespace(
            runtime_generation=ensure_calls, e2b_sandbox_id=None, e2b_template_ref=None
        )

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


@pytest.mark.asyncio
async def test_resolve_calls_resume_sandbox_for_paused_sandbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Paused sandbox triggers resume_sandbox before access is returned."""
    user = SimpleNamespace(id=uuid4())
    sandbox = SimpleNamespace(
        runtime_generation=3,
        e2b_sandbox_id="sb-paused-123",
        e2b_template_ref="e2b",
    )

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        return sandbox

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    mock_provider = AsyncMock()
    mock_provider.resume_sandbox = AsyncMock()

    with patch.object(service, "get_sandbox_provider", return_value=mock_provider) as mock_get:
        access = await service.ensure_cloud_sandbox_gateway_access(
            cast(AsyncSession, object()),
            cast(service._UserWithId, user),
        )

    mock_get.assert_called_once_with("e2b")
    mock_provider.resume_sandbox.assert_awaited_once_with("sb-paused-123")
    assert access.upstream_base_url == "https://sandbox.example.test"
    assert access.upstream_token == "sandbox-token"


@pytest.mark.asyncio
async def test_resolve_resume_failure_does_not_block_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If resume_sandbox raises, access is still returned (with a warning log)."""
    user = SimpleNamespace(id=uuid4())
    sandbox = SimpleNamespace(
        runtime_generation=5,
        e2b_sandbox_id="sb-fail-456",
        e2b_template_ref="e2b",
    )

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        return sandbox

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    mock_provider = AsyncMock()
    mock_provider.resume_sandbox = AsyncMock(side_effect=RuntimeError("E2B timeout"))

    with patch.object(service, "get_sandbox_provider", return_value=mock_provider):
        access = await service.ensure_cloud_sandbox_gateway_access(
            cast(AsyncSession, object()),
            cast(service._UserWithId, user),
        )

    # Access is still returned despite resume failure
    assert access.upstream_base_url == "https://sandbox.example.test"
    assert access.upstream_token == "sandbox-token"
    assert access.runtime_generation == 5


@pytest.mark.asyncio
async def test_resolve_skips_resume_when_no_provider_sandbox_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No resume_sandbox call when e2b_sandbox_id is None (sandbox still creating)."""
    user = SimpleNamespace(id=uuid4())
    sandbox = SimpleNamespace(
        runtime_generation=1,
        e2b_sandbox_id=None,
        e2b_template_ref="e2b",
    )

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        return sandbox

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    with patch.object(service, "get_sandbox_provider") as mock_get:
        access = await service.ensure_cloud_sandbox_gateway_access(
            cast(AsyncSession, object()),
            cast(service._UserWithId, user),
        )

    mock_get.assert_not_called()
    assert access.upstream_base_url == "https://sandbox.example.test"


@pytest.mark.asyncio
async def test_invalidate_gateway_access_forces_re_resolve(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After invalidation the next call re-resolves (re-wakes) the sandbox."""
    user = SimpleNamespace(id=uuid4())
    resolve_count = 0

    sandbox = SimpleNamespace(
        runtime_generation=1,
        e2b_sandbox_id=None,
        e2b_template_ref=None,
    )

    async def ensure_ready(*_args: object, **_kwargs: object) -> object:
        nonlocal resolve_count
        resolve_count += 1
        return sandbox

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "ensure_cloud_sandbox_ready", ensure_ready)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )
    assert resolve_count == 1

    # Invalidate and verify re-resolve
    service.invalidate_gateway_access_for_user(user.id)
    await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )
    assert resolve_count == 2
