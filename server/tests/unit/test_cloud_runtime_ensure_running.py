from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.integrations.sandbox.base import ProviderSandboxState
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.server.cloud.runtime.liveness import ensure_running, relaunch as relaunch_helpers


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

    async def _load_active_sandbox(_db: object, _workspace: object) -> object:
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

    async def _load_active_sandbox(_db: object, _workspace: object) -> object:
        return sandbox_record

    async def _persist(
        _db: object,
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
async def test_ensure_environment_runtime_ready_rotates_url_without_generation_increment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = SimpleNamespace(
        id=uuid4(),
        active_sandbox_id=uuid4(),
        runtime_url="https://expired.invalid",
    )
    sandbox_record = SimpleNamespace(
        provider="e2b",
        external_sandbox_id="sandbox-123",
    )
    saved: list[dict[str, object]] = []

    class _Provider:
        async def connect_running_sandbox(
            self,
            sandbox_id: str,
            *,
            timeout_seconds: int | None = None,
        ) -> object:
            assert sandbox_id == "sandbox-123"
            assert timeout_seconds is None
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

        async def resolve_runtime_context(self, _sandbox: object) -> SimpleNamespace:
            raise AssertionError("URL rotation should not relaunch the runtime")

    async def _wait(runtime_url: str, **_kwargs: object) -> None:
        if runtime_url == environment.runtime_url:
            raise CloudRuntimeReconnectError("expired")

    async def _verify(runtime_url: str, access_token: str, **_kwargs: object) -> None:
        assert runtime_url == "https://fresh.invalid"
        assert access_token == "runtime-token"

    async def _load_cloud_sandbox_by_id(_db: object, _sandbox_id: object) -> object:
        return sandbox_record

    async def _save_runtime_environment_state(
        _db: object, _environment_id: object, **kwargs: object
    ) -> None:
        saved.append(kwargs)

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_cloud_sandbox_by_id", _load_cloud_sandbox_by_id)
    monkeypatch.setattr(ensure_running, "get_sandbox_provider", lambda _kind: _Provider())
    monkeypatch.setattr(
        ensure_running,
        "save_runtime_environment_state",
        _save_runtime_environment_state,
    )

    runtime_url = await ensure_running.ensure_environment_runtime_ready(
        environment,
        workspace_id=uuid4(),
        allow_launcher_restart=True,
        access_token="runtime-token",
    )

    assert runtime_url == "https://fresh.invalid"
    assert saved == [{"runtime_url": "https://fresh.invalid"}]


@pytest.mark.asyncio
async def test_ensure_environment_runtime_ready_refreshes_worker_before_forced_relaunch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_id = uuid4()
    environment = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        active_sandbox_id=uuid4(),
        target_id=target_id,
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        runtime_url="https://runtime.invalid",
    )
    sandbox_record = SimpleNamespace(
        id=uuid4(),
        provider="e2b",
        external_sandbox_id="sandbox-123",
        sandbox_profile_id=uuid4(),
        target_id=target_id,
    )
    runtime_context = SimpleNamespace(
        home_dir="/root",
        runtime_workdir="/root/workspace",
        runtime_binary_path="/root/anyharness",
        base_env={"HOME": "/root"},
    )
    events: list[str] = []
    expected_previous_worker_id = uuid4()

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

    async def _wait(_runtime_url: str, **_kwargs: object) -> None:
        events.append("wait")

    async def _verify(_runtime_url: str, access_token: str, **_kwargs: object) -> None:
        assert access_token == "runtime-token"
        events.append("verify")

    async def _load_cloud_sandbox_by_id(_db: object, _sandbox_id: object) -> object:
        return sandbox_record

    async def _refresh(
        _provider: object,
        _sandbox: object,
        _runtime_context: object,
        *,
        environment: object,
        sandbox_record: object,
        workspace_id: object,
        access_token: str,
    ) -> None:
        assert environment is expected_environment
        assert sandbox_record is expected_sandbox_record
        assert str(workspace_id)
        assert access_token == "runtime-token"
        events.append("refresh")

    async def _relaunch(
        _provider: object,
        _sandbox: object,
        _runtime_context: object,
        _workspace: object,
    ) -> None:
        events.append("relaunch")

    async def _current_target_worker_id(_target_id: object) -> object:
        events.append("previous-worker")
        return expected_previous_worker_id

    async def _wait_for_worker_target_fresh_heartbeat(
        target_id: object,
        *,
        previous_worker_id: object | None = None,
        **_kwargs: object,
    ) -> object:
        assert target_id == expected_environment.target_id
        assert previous_worker_id == expected_previous_worker_id
        events.append("wait-worker")
        return object()

    async def _save_runtime_environment_state(
        _db: object, _environment_id: object, **_kwargs: object
    ) -> None:
        events.append("save")

    monkeypatch.setattr(ensure_running, "wait_for_runtime_health", _wait)
    monkeypatch.setattr(ensure_running, "verify_runtime_auth_enforced", _verify)
    monkeypatch.setattr(ensure_running, "load_cloud_sandbox_by_id", _load_cloud_sandbox_by_id)
    monkeypatch.setattr(ensure_running, "get_sandbox_provider", lambda _kind: _Provider())
    expected_environment = environment
    expected_sandbox_record = sandbox_record
    monkeypatch.setattr(
        ensure_running,
        "refresh_worker_enrollment_for_runtime",
        _refresh,
    )
    monkeypatch.setattr(ensure_running, "relaunch_runtime", _relaunch)
    monkeypatch.setattr(ensure_running, "_current_target_worker_id", _current_target_worker_id)
    monkeypatch.setattr(
        ensure_running,
        "wait_for_worker_target_fresh_heartbeat",
        _wait_for_worker_target_fresh_heartbeat,
    )
    monkeypatch.setattr(
        ensure_running,
        "save_runtime_environment_state",
        _save_runtime_environment_state,
    )

    runtime_url = await ensure_running.ensure_environment_runtime_ready(
        environment,
        workspace_id=uuid4(),
        allow_launcher_restart=True,
        access_token="runtime-token",
        force_launcher_restart=True,
        refresh_worker_enrollment_on_restart=True,
    )

    assert runtime_url == "https://fresh.invalid"
    assert events.index("refresh") < events.index("relaunch")
    assert events.index("relaunch") < events.index("wait-worker")
    assert events[-1] == "save"


@pytest.mark.asyncio
async def test_worker_relaunch_cloud_base_url_falls_back_to_existing_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_context = SimpleNamespace(
        home_dir="/root",
        runtime_workdir="/root/workspace",
        runtime_binary_path="/root/anyharness",
        base_env={"HOME": "/root"},
    )
    commands: list[str] = []

    def _raise_config_error() -> str:
        raise CloudRuntimeReconnectError("local-only")

    async def _run_command(
        _provider: object,
        _sandbox: object,
        *,
        command: str,
        **_kwargs: object,
    ) -> SimpleNamespace:
        commands.append(command)
        return SimpleNamespace(exit_code=0, stdout="https://public-worker.example\n")

    monkeypatch.setattr(relaunch_helpers, "cloud_base_url_for_worker_config", _raise_config_error)
    monkeypatch.setattr(relaunch_helpers, "run_sandbox_command_logged", _run_command)

    url = await relaunch_helpers.cloud_base_url_for_worker_relaunch(
        object(),
        object(),
        runtime_context,
        uuid4(),
    )

    assert url == "https://public-worker.example"
    assert commands


@pytest.mark.asyncio
async def test_refresh_worker_enrollment_stops_and_resets_sidecars_before_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_id = uuid4()
    environment = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        target_id=target_id,
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
    )
    sandbox_record = SimpleNamespace(
        id=uuid4(),
        sandbox_profile_id=uuid4(),
        target_id=target_id,
    )
    runtime_context = SimpleNamespace(
        home_dir="/root",
        runtime_workdir="/root/workspace",
        runtime_binary_path="/root/anyharness",
        base_env={"HOME": "/root"},
    )
    events: list[tuple[str, str, str | None]] = []

    class _Provider:
        runtime_port = 8457

        async def write_file(self, _sandbox: object, path: str, contents: str | bytes) -> None:
            assert path == "/root/.proliferate/worker/config.toml"
            assert "enrollment-token" in str(contents)
            events.append(("write", path, None))

    async def _cloud_base_url(*_args: object, **_kwargs: object) -> str:
        events.append(("cloud-url", "resolved", None))
        return "https://public-worker.example"

    async def _ensure_enrollment(**_kwargs: object) -> SimpleNamespace:
        events.append(("enrollment", "created", None))
        return SimpleNamespace(enrollment_token="enrollment-token")

    async def _run_command(
        _provider: object,
        _sandbox: object,
        *,
        label: str,
        command: str,
        **_kwargs: object,
    ) -> SimpleNamespace:
        events.append(("command", label, command))
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    monkeypatch.setattr(relaunch_helpers, "cloud_base_url_for_worker_relaunch", _cloud_base_url)
    monkeypatch.setattr(relaunch_helpers, "ensure_runtime_target_enrollment", _ensure_enrollment)
    monkeypatch.setattr(relaunch_helpers, "run_sandbox_command_logged", _run_command)

    await relaunch_helpers.refresh_worker_enrollment_for_runtime(
        _Provider(),
        object(),
        runtime_context,
        environment=environment,
        sandbox_record=sandbox_record,
        workspace_id=uuid4(),
        access_token="runtime-token",
    )

    labels = [event[1] for event in events]
    assert labels[:4] == [
        "resolved",
        "check_runtime_supervisor_config_for_worker_refresh",
        "created",
        "stop_existing_supervised_runtime_for_worker_refresh",
    ]
    assert labels.index("refresh_worker_enrollment_state") < labels.index(
        "/root/.proliferate/worker/config.toml"
    )
    assert labels.index("/root/.proliferate/worker/config.toml") < labels.index(
        "chmod_refreshed_worker_config"
    )
    reset_command = next(
        command
        for kind, label, command in events
        if kind == "command" and label == "refresh_worker_enrollment_state"
    )
    assert reset_command is not None
    assert "/root/.proliferate/worker/worker.sqlite3" in reset_command
    assert "/root/.proliferate/worker/worker.sqlite3-wal" in reset_command
    assert "/root/.proliferate/worker/worker.sqlite3-shm" in reset_command
    assert "/root/.proliferate/worker/worker.sqlite3-journal" in reset_command


@pytest.mark.asyncio
async def test_refresh_worker_enrollment_reset_failure_stops_before_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_id = uuid4()
    environment = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        target_id=target_id,
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
    )
    sandbox_record = SimpleNamespace(
        id=uuid4(),
        sandbox_profile_id=uuid4(),
        target_id=target_id,
    )
    runtime_context = SimpleNamespace(
        home_dir="/root",
        runtime_workdir="/root/workspace",
        runtime_binary_path="/root/anyharness",
        base_env={"HOME": "/root"},
    )

    class _Provider:
        async def write_file(self, *_args: object, **_kwargs: object) -> None:
            raise AssertionError("worker config should not be written after reset failure")

    async def _ensure_enrollment(**_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(enrollment_token="enrollment-token")

    async def _run_command(
        _provider: object,
        _sandbox: object,
        *,
        label: str,
        **_kwargs: object,
    ) -> SimpleNamespace:
        if label == "refresh_worker_enrollment_state":
            return SimpleNamespace(exit_code=1, stdout="", stderr="reset failed")
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    async def _cloud_base_url(*_args: object, **_kwargs: object) -> str:
        return "https://public-worker.example"

    monkeypatch.setattr(
        relaunch_helpers,
        "cloud_base_url_for_worker_relaunch",
        _cloud_base_url,
    )
    monkeypatch.setattr(relaunch_helpers, "ensure_runtime_target_enrollment", _ensure_enrollment)
    monkeypatch.setattr(relaunch_helpers, "run_sandbox_command_logged", _run_command)

    with pytest.raises(CloudRuntimeReconnectError, match="reset worker enrollment state"):
        await relaunch_helpers.refresh_worker_enrollment_for_runtime(
            _Provider(),
            object(),
            runtime_context,
            environment=environment,
            sandbox_record=sandbox_record,
            workspace_id=uuid4(),
            access_token="runtime-token",
        )


@pytest.mark.asyncio
async def test_refresh_worker_enrollment_url_failure_does_not_touch_sandbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target_id = uuid4()
    environment = SimpleNamespace(
        id=uuid4(),
        user_id=uuid4(),
        target_id=target_id,
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
    )
    sandbox_record = SimpleNamespace(
        id=uuid4(),
        sandbox_profile_id=uuid4(),
        target_id=target_id,
    )
    runtime_context = SimpleNamespace(
        home_dir="/root",
        runtime_workdir="/root/workspace",
        runtime_binary_path="/root/anyharness",
        base_env={"HOME": "/root"},
    )
    commands: list[str] = []

    async def _cloud_base_url(*_args: object, **_kwargs: object) -> str:
        raise CloudRuntimeReconnectError("missing public URL")

    async def _run_command(
        _provider: object,
        _sandbox: object,
        *,
        label: str,
        **_kwargs: object,
    ) -> SimpleNamespace:
        commands.append(label)
        return SimpleNamespace(exit_code=0, stdout="", stderr="")

    monkeypatch.setattr(relaunch_helpers, "cloud_base_url_for_worker_relaunch", _cloud_base_url)
    monkeypatch.setattr(relaunch_helpers, "run_sandbox_command_logged", _run_command)

    with pytest.raises(CloudRuntimeReconnectError, match="missing public URL"):
        await relaunch_helpers.refresh_worker_enrollment_for_runtime(
            object(),
            object(),
            runtime_context,
            environment=environment,
            sandbox_record=sandbox_record,
            workspace_id=uuid4(),
            access_token="runtime-token",
        )

    assert commands == []


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

    async def _load_active_sandbox(_db: object, _workspace: object) -> object:
        return sandbox_record

    async def _persist(
        _db: object,
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

    async def _load_active_sandbox(_db: object, _workspace: object) -> object:
        return sandbox_record

    async def _persist(
        _db: object,
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
    monkeypatch.setattr(ensure_running, "relaunch_runtime", _relaunch)

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

    async def _load_active_sandbox(_db: object, _workspace: object) -> object:
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
