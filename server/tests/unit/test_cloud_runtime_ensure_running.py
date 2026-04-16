from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.integrations.sandbox.base import ProviderSandboxState
from proliferate.server.cloud.runtime import ensure_running
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeReconnectError


def _make_workspace(*, runtime_url: str | None = "https://runtime.invalid") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        active_sandbox_id=uuid4(),
        runtime_url=runtime_url,
    )


@pytest.mark.asyncio
async def test_ensure_workspace_runtime_ready_reuses_healthy_existing_runtime_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace()
    calls: list[tuple[str, str]] = []

    async def _wait(runtime_url: str, **_kwargs: object) -> None:
        calls.append(("wait", runtime_url))
        assert runtime_url == workspace.runtime_url

    async def _verify(runtime_url: str, access_token: str, **_kwargs: object) -> None:
        calls.append(("verify", runtime_url))
        assert runtime_url == workspace.runtime_url
        assert access_token == "runtime-token"

    async def _load_active_sandbox(_workspace: object) -> object:
        raise AssertionError(
            "active sandbox should not be loaded when the cached runtime is healthy"
        )

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_active_sandbox_for_workspace", _load_active_sandbox)

    assert (
        await ensure_running.ensure_workspace_runtime_ready(
            workspace,
            allow_launcher_restart=True,
            access_token="runtime-token",
        )
        == workspace.runtime_url
    )
    assert calls == [("wait", "https://runtime.invalid"), ("verify", "https://runtime.invalid")]


@pytest.mark.asyncio
async def test_ensure_workspace_runtime_ready_rotates_to_fresh_endpoint_without_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace(runtime_url="https://expired.invalid")
    sandbox_record = SimpleNamespace(
        provider="daytona",
        external_sandbox_id="sandbox-123",
    )
    provider_calls: list[str] = []
    persisted: list[tuple[bool, str | None]] = []

    class _Provider:
        async def connect_running_sandbox(
            self,
            sandbox_id: str,
            *,
            timeout_seconds: int | None = None,
        ) -> object:
            assert sandbox_id == "sandbox-123"
            assert timeout_seconds is None
            provider_calls.append("connect")
            return object()

        async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
            return ProviderSandboxState(
                external_sandbox_id=sandbox_id,
                state="running",
                started_at=None,
                end_at=None,
                observed_at=datetime.now(UTC),
                metadata={},
            )

        async def resolve_runtime_endpoint(self, _sandbox: object) -> SimpleNamespace:
            provider_calls.append("endpoint")
            return SimpleNamespace(runtime_url="https://fresh.invalid")

        async def resolve_runtime_context(self, _sandbox: object) -> SimpleNamespace:
            raise AssertionError("runtime context should not be resolved without a relaunch")

    async def _wait(runtime_url: str, **_kwargs: object) -> None:
        if runtime_url == workspace.runtime_url:
            raise CloudRuntimeReconnectError("expired")

    async def _verify(runtime_url: str, access_token: str, **_kwargs: object) -> None:
        assert runtime_url == "https://fresh.invalid"
        assert access_token == "runtime-token"
        provider_calls.append("verify")

    async def _load_active_sandbox(_workspace: object) -> object:
        return sandbox_record

    async def _persist(
        _workspace: object,
        _sandbox: object,
        *,
        restarted_runtime: bool,
        runtime_url: str | None = None,
    ) -> None:
        persisted.append((restarted_runtime, runtime_url))

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_active_sandbox_for_workspace", _load_active_sandbox)
    monkeypatch.setattr(ensure_running, "get_sandbox_provider", lambda _kind: _Provider())
    monkeypatch.setattr(
        ensure_running,
        "persist_runtime_reconnect_state_for_workspace",
        _persist,
    )

    runtime_url = await ensure_running.ensure_workspace_runtime_ready(
        workspace,
        allow_launcher_restart=True,
        access_token="runtime-token",
    )

    assert runtime_url == "https://fresh.invalid"
    assert provider_calls == ["connect", "endpoint", "verify"]
    assert persisted == [(False, "https://fresh.invalid")]


@pytest.mark.asyncio
async def test_ensure_workspace_runtime_ready_resumes_paused_sandbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace(runtime_url="https://paused.invalid")
    sandbox_record = SimpleNamespace(
        provider="e2b",
        external_sandbox_id="sandbox-123",
    )
    provider_calls: list[str] = []
    persisted: list[tuple[bool, str | None]] = []

    class _Provider:
        async def connect_running_sandbox(
            self,
            _sandbox_id: str,
            *,
            timeout_seconds: int | None = None,
        ) -> object:
            raise AssertionError("paused sandboxes should be resumed, not connected as running")

        async def resume_sandbox(
            self,
            sandbox_id: str,
            *,
            timeout_seconds: int | None = None,
        ) -> object:
            assert sandbox_id == "sandbox-123"
            assert timeout_seconds is None
            provider_calls.append("resume")
            return object()

        async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
            return ProviderSandboxState(
                external_sandbox_id=sandbox_id,
                state="paused",
                started_at=None,
                end_at=None,
                observed_at=datetime.now(UTC),
                metadata={},
            )

        async def resolve_runtime_endpoint(self, _sandbox: object) -> SimpleNamespace:
            provider_calls.append("endpoint")
            return SimpleNamespace(runtime_url="https://fresh.invalid")

        async def resolve_runtime_context(self, _sandbox: object) -> SimpleNamespace:
            raise AssertionError("runtime context should not be resolved without a relaunch")

    async def _wait(runtime_url: str, **_kwargs: object) -> None:
        if runtime_url == workspace.runtime_url:
            raise CloudRuntimeReconnectError("paused")

    async def _verify(runtime_url: str, access_token: str, **_kwargs: object) -> None:
        assert runtime_url == "https://fresh.invalid"
        assert access_token == "runtime-token"
        provider_calls.append("verify")

    async def _load_active_sandbox(_workspace: object) -> object:
        return sandbox_record

    async def _persist(
        _workspace: object,
        _sandbox: object,
        *,
        restarted_runtime: bool,
        runtime_url: str | None = None,
    ) -> None:
        persisted.append((restarted_runtime, runtime_url))

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_active_sandbox_for_workspace", _load_active_sandbox)
    monkeypatch.setattr(ensure_running, "get_sandbox_provider", lambda _kind: _Provider())
    monkeypatch.setattr(
        ensure_running,
        "persist_runtime_reconnect_state_for_workspace",
        _persist,
    )

    runtime_url = await ensure_running.ensure_workspace_runtime_ready(
        workspace,
        allow_launcher_restart=True,
        access_token="runtime-token",
    )

    assert runtime_url == "https://fresh.invalid"
    assert provider_calls == ["resume", "endpoint", "verify"]
    assert persisted == [(False, "https://fresh.invalid")]


@pytest.mark.asyncio
async def test_ensure_workspace_runtime_ready_relaunches_only_after_fresh_endpoint_probe_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace(runtime_url="https://expired.invalid")
    sandbox_record = SimpleNamespace(
        provider="daytona",
        external_sandbox_id="sandbox-123",
    )
    events: list[str] = []
    persisted: list[tuple[bool, str | None]] = []
    wait_calls = {"fresh": 0}

    runtime_context = SimpleNamespace(
        home_dir="/root",
        runtime_workdir="/root/workspace",
        runtime_binary_path="/root/anyharness",
        base_env={"HOME": "/root"},
    )

    class _Provider:
        async def connect_running_sandbox(
            self,
            sandbox_id: str,
            *,
            timeout_seconds: int | None = None,
        ) -> object:
            assert sandbox_id == "sandbox-123"
            assert timeout_seconds is None
            events.append("connect")
            return object()

        async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
            return ProviderSandboxState(
                external_sandbox_id=sandbox_id,
                state="running",
                started_at=None,
                end_at=None,
                observed_at=datetime.now(UTC),
                metadata={},
            )

        async def resolve_runtime_endpoint(self, _sandbox: object) -> SimpleNamespace:
            events.append("endpoint")
            return SimpleNamespace(runtime_url="https://fresh.invalid")

        async def resolve_runtime_context(self, _sandbox: object) -> SimpleNamespace:
            events.append("context")
            return runtime_context

    async def _wait(runtime_url: str, **_kwargs: object) -> None:
        if runtime_url == workspace.runtime_url:
            raise CloudRuntimeReconnectError("expired")
        wait_calls["fresh"] += 1
        if wait_calls["fresh"] == 1:
            raise CloudRuntimeReconnectError("runtime not running")

    async def _verify(runtime_url: str, access_token: str, **_kwargs: object) -> None:
        assert runtime_url == "https://fresh.invalid"
        assert access_token == "runtime-token"
        events.append("verify")

    async def _load_active_sandbox(_workspace: object) -> object:
        return sandbox_record

    async def _persist(
        _workspace: object,
        _sandbox: object,
        *,
        restarted_runtime: bool,
        runtime_url: str | None = None,
    ) -> None:
        persisted.append((restarted_runtime, runtime_url))

    async def _relaunch(
        _provider: object,
        _sandbox: object,
        _runtime_context: object,
        _workspace: object,
    ) -> None:
        events.append("relaunch")

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_active_sandbox_for_workspace", _load_active_sandbox)
    monkeypatch.setattr(ensure_running, "get_sandbox_provider", lambda _kind: _Provider())
    monkeypatch.setattr(
        ensure_running,
        "persist_runtime_reconnect_state_for_workspace",
        _persist,
    )
    monkeypatch.setattr(ensure_running, "_relaunch_runtime", _relaunch)

    runtime_url = await ensure_running.ensure_workspace_runtime_ready(
        workspace,
        allow_launcher_restart=True,
        access_token="runtime-token",
    )

    assert runtime_url == "https://fresh.invalid"
    assert events == ["connect", "endpoint", "context", "relaunch", "verify"]
    assert persisted == [(True, "https://fresh.invalid")]


@pytest.mark.asyncio
async def test_ensure_workspace_runtime_ready_raises_when_restart_is_disallowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = _make_workspace(runtime_url="https://expired.invalid")
    sandbox_record = SimpleNamespace(
        provider="daytona",
        external_sandbox_id="sandbox-123",
    )

    class _Provider:
        async def connect_running_sandbox(
            self,
            _sandbox_id: str,
            *,
            timeout_seconds: int | None = None,
        ) -> object:
            return object()

        async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
            return ProviderSandboxState(
                external_sandbox_id=sandbox_id,
                state="running",
                started_at=None,
                end_at=None,
                observed_at=datetime.now(UTC),
                metadata={},
            )

        async def resolve_runtime_endpoint(self, _sandbox: object) -> SimpleNamespace:
            return SimpleNamespace(runtime_url="https://fresh.invalid")

    async def _wait(_runtime_url: str, **_kwargs: object) -> None:
        raise CloudRuntimeReconnectError("offline")

    async def _verify(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("auth verification should not run when health never succeeds")

    async def _load_active_sandbox(_workspace: object) -> object:
        return sandbox_record

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_active_sandbox_for_workspace", _load_active_sandbox)
    monkeypatch.setattr(ensure_running, "get_sandbox_provider", lambda _kind: _Provider())

    with pytest.raises(CloudRuntimeReconnectError, match="unavailable"):
        await ensure_running.ensure_workspace_runtime_ready(
            workspace,
            allow_launcher_restart=False,
            access_token="runtime-token",
        )
