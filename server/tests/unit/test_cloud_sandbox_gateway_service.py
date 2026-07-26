from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.billing.authorization import CloudSandboxResumeBlockedError
from proliferate.server.cloud.gateway import service


@pytest.fixture(autouse=True)
def reset_gateway_access_cache() -> object:
    service._reset_cloud_sandbox_gateway_access_cache_for_tests()
    yield
    service._reset_cloud_sandbox_gateway_access_cache_for_tests()


def _patch_gateway_prerequisites(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow_billing(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(service, "require_cloud_provisioning_configured", lambda: None)
    monkeypatch.setattr(
        service,
        "assert_cloud_sandbox_resume_allowed_for_owner",
        allow_billing,
    )


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

    _patch_gateway_prerequisites(monkeypatch)
    monkeypatch.setattr(service, "ensure_personal_cloud_sandbox_exists", ensure_ready)
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

    _patch_gateway_prerequisites(monkeypatch)
    monkeypatch.setattr(service, "ensure_personal_cloud_sandbox_exists", ensure_ready)
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
    _patch_gateway_prerequisites(monkeypatch)
    monkeypatch.setattr(service, "ensure_personal_cloud_sandbox_exists", ensure_ready)
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
async def test_gateway_access_rechecks_billing_before_runtime_cache_expires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    now = 1000.0
    billing_checks = 0
    runtime_resolutions = 0

    async def assert_billing(*_args: object, **_kwargs: object) -> None:
        nonlocal billing_checks
        billing_checks += 1

    async def ensure_sandbox(*_args: object, **_kwargs: object) -> object:
        nonlocal runtime_resolutions
        runtime_resolutions += 1
        return SimpleNamespace(runtime_generation=9)

    async def load_access(*_args: object, **_kwargs: object) -> tuple[str, str, str]:
        return ("https://sandbox.example.test", "sandbox-token", "data-key")

    monkeypatch.setattr(service, "require_cloud_provisioning_configured", lambda: None)
    monkeypatch.setattr(
        service,
        "assert_cloud_sandbox_resume_allowed_for_owner",
        assert_billing,
    )
    monkeypatch.setattr(service.time, "monotonic", lambda: now)
    monkeypatch.setattr(service, "ensure_personal_cloud_sandbox_exists", ensure_sandbox)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )
    now += service._GATEWAY_BILLING_ALLOW_CACHE_TTL_SECONDS + 0.1
    await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )

    assert billing_checks == 2
    assert runtime_resolutions == 1


@pytest.mark.asyncio
async def test_gateway_billing_denial_is_not_cached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    billing_checks = 0

    async def deny_billing(*_args: object, **_kwargs: object) -> None:
        nonlocal billing_checks
        billing_checks += 1
        raise CloudSandboxResumeBlockedError(
            "billing blocked",
            decision_type="deny_resume",
            reason="credits_exhausted",
        )

    monkeypatch.setattr(service, "require_cloud_provisioning_configured", lambda: None)
    monkeypatch.setattr(
        service,
        "assert_cloud_sandbox_resume_allowed_for_owner",
        deny_billing,
    )

    for _ in range(2):
        with pytest.raises(CloudSandboxResumeBlockedError, match="billing blocked"):
            await service.ensure_cloud_sandbox_gateway_access(
                cast(AsyncSession, object()),
                cast(service._UserWithId, user),
            )

    assert billing_checks == 2


@pytest.mark.asyncio
async def test_gateway_access_forwards_paused_sandbox_with_stamped_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = SimpleNamespace(id=uuid4())
    paused_sandbox = SimpleNamespace(status="paused", runtime_generation=10)

    async def ensure_sandbox(*_args: object, **_kwargs: object) -> object:
        return paused_sandbox

    async def load_access(sandbox: object) -> tuple[str, str, str]:
        assert sandbox is paused_sandbox
        return ("https://paused.example.test", "paused-token", "data-key")

    _patch_gateway_prerequisites(monkeypatch)
    monkeypatch.setattr(service, "ensure_personal_cloud_sandbox_exists", ensure_sandbox)
    monkeypatch.setattr(service, "load_cloud_sandbox_runtime_access", load_access)

    access = await service.ensure_cloud_sandbox_gateway_access(
        cast(AsyncSession, object()),
        cast(service._UserWithId, user),
    )

    assert access.upstream_base_url == "https://paused.example.test"
    assert access.upstream_token == "paused-token"
    assert access.runtime_generation == 10


def test_invalidation_evicts_cached_access() -> None:
    user_id = uuid4()
    service._gateway_access_cache[user_id] = service._CachedCloudSandboxGatewayAccess(
        access=service.CloudSandboxGatewayAccess(
            upstream_base_url="https://old.invalid",
            upstream_token="tok",
            runtime_generation=0,
        ),
        expires_at_monotonic=time.monotonic() + 60.0,
    )

    service.invalidate_cloud_sandbox_gateway_access_for_user(user_id)

    assert service._cached_gateway_access(user_id) is None
