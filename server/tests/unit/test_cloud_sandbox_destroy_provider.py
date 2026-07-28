"""Part A / P2-001: destroy_cloud_sandbox kills the provider VM only AFTER the
DB destroy durably commits, via the canonical run_after_commit hook."""

from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.cloud_sandboxes import service
from proliferate.server.cloud.gateway import service as gateway_service


class _FakeProvider:
    def __init__(self, *, fail: bool = False) -> None:
        self.destroyed: list[str] = []
        self._fail = fail

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroyed.append(sandbox_id)
        if self._fail:
            raise RuntimeError("provider destroy exploded")


def _sandbox(e2b_sandbox_id: str | None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        e2b_sandbox_id=e2b_sandbox_id,
        e2b_template_ref="e2b",
    )


def _patch(monkeypatch: pytest.MonkeyPatch, sandbox: Any, provider: _FakeProvider) -> None:
    async def _load(*_a: Any, **_k: Any) -> Any:
        return sandbox

    async def _revoke(*_a: Any, **_k: Any) -> None:
        return None

    async def _mark(*_a: Any, **_k: Any) -> Any:
        return sandbox

    monkeypatch.setattr(service.sandbox_store, "load_personal_cloud_sandbox", _load)
    monkeypatch.setattr(
        service.runtime_workers_store, "revoke_active_workers_for_identity", _revoke
    )
    monkeypatch.setattr(service.sandbox_store, "mark_cloud_sandbox_destroyed", _mark)
    monkeypatch.setattr(service, "get_sandbox_provider", lambda _ref: provider)


async def _pump() -> None:
    # The after-commit listener schedules the callback via loop.create_task;
    # yield a few times so the deferred coroutine actually runs.
    for _ in range(5):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_provider_killed_only_after_commit(
    monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> None:
    provider = _FakeProvider()
    _patch(monkeypatch, _sandbox("sbx-1"), provider)

    # Real root transaction so run_after_commit defers through db/engine's actual
    # after_commit listener rather than firing inline.
    await db_session.begin()
    result = await service.destroy_cloud_sandbox(db_session, SimpleNamespace(id=uuid.uuid4()))
    assert result is not None
    # Not killed yet — the destroy is deferred until the commit is durable.
    assert provider.destroyed == []

    await db_session.commit()
    await _pump()
    # Exactly one kill after the commit lands.
    assert provider.destroyed == ["sbx-1"]


@pytest.mark.asyncio
async def test_provider_not_killed_on_rollback(
    monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> None:
    provider = _FakeProvider()
    _patch(monkeypatch, _sandbox("sbx-2"), provider)

    await db_session.begin()
    await service.destroy_cloud_sandbox(db_session, SimpleNamespace(id=uuid.uuid4()))
    assert provider.destroyed == []

    # A rollback after destroy returns must discard the deferred kill entirely,
    # otherwise a killed VM would be left with a still-alive row (the wedge bug).
    await db_session.rollback()
    await _pump()
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_provider_failure_after_commit_does_not_raise(
    monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> None:
    provider = _FakeProvider(fail=True)
    _patch(monkeypatch, _sandbox("sbx-3"), provider)

    await db_session.begin()
    result = await service.destroy_cloud_sandbox(db_session, SimpleNamespace(id=uuid.uuid4()))
    assert result is not None
    # A provider failure inside the deferred callback is swallowed (logged);
    # committing the destroy never fails (a periodic reaper backstop for the
    # leaked VM is tracked in #1280).
    await db_session.commit()
    await _pump()
    assert provider.destroyed == ["sbx-3"]


@pytest.mark.asyncio
async def test_no_provider_call_when_no_e2b_id(
    monkeypatch: pytest.MonkeyPatch, db_session: AsyncSession
) -> None:
    provider = _FakeProvider()
    resolved: list[bool] = []
    _patch(monkeypatch, _sandbox(None), provider)
    monkeypatch.setattr(
        service, "get_sandbox_provider", lambda _ref: resolved.append(True) or provider
    )

    await db_session.begin()
    await service.destroy_cloud_sandbox(db_session, SimpleNamespace(id=uuid.uuid4()))
    await db_session.commit()
    await _pump()

    assert provider.destroyed == []
    assert resolved == []


@pytest.mark.asyncio
async def test_no_sandbox_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _load(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(service.sandbox_store, "load_personal_cloud_sandbox", _load)

    result = await service.destroy_cloud_sandbox(
        SimpleNamespace(), SimpleNamespace(id=uuid.uuid4())
    )
    assert result is None


@pytest.mark.asyncio
async def test_destroy_invalidates_cached_gateway_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_user_id = uuid.uuid4()
    sandbox = _sandbox(None)
    sandbox.owner_user_id = owner_user_id
    _patch(monkeypatch, sandbox, _FakeProvider())
    gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
    runtime_resolutions = 0

    async def _allow_billing(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _ensure(*_args: Any, **_kwargs: Any) -> Any:
        nonlocal runtime_resolutions
        runtime_resolutions += 1
        return SimpleNamespace(runtime_generation=runtime_resolutions)

    async def _access(*_args: Any, **_kwargs: Any) -> tuple[str, str, str]:
        return (
            "https://sandbox.example.test",
            f"sandbox-token-{runtime_resolutions}",
            "data-key",
        )

    async def _mark_workspaces_lost(*_args: Any, **_kwargs: Any) -> int:
        return 0

    monkeypatch.setattr(
        gateway_service,
        "require_cloud_provisioning_configured",
        lambda: None,
    )
    monkeypatch.setattr(
        gateway_service,
        "assert_cloud_sandbox_resume_allowed_for_owner",
        _allow_billing,
    )
    monkeypatch.setattr(
        gateway_service,
        "ensure_personal_cloud_sandbox_exists",
        _ensure,
    )
    monkeypatch.setattr(
        gateway_service,
        "load_cloud_sandbox_runtime_access",
        _access,
    )
    monkeypatch.setattr(
        service.cloud_workspace_store,
        "mark_cloud_workspaces_lost_for_sandbox",
        _mark_workspaces_lost,
    )
    user = SimpleNamespace(id=owner_user_id)

    first = await gateway_service.ensure_cloud_sandbox_gateway_access(
        SimpleNamespace(),
        user,
    )
    await service.destroy_cloud_sandbox(SimpleNamespace(), user)
    second = await gateway_service.ensure_cloud_sandbox_gateway_access(
        SimpleNamespace(),
        user,
    )

    assert first.runtime_generation == 1
    assert second.runtime_generation == 2
    assert runtime_resolutions == 2
    gateway_service._reset_cloud_sandbox_gateway_access_cache_for_tests()
