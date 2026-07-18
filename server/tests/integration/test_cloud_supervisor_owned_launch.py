"""New-provision topology branch (Make Managed Runtime Updates Supervisor-Owned, decision 5).

``settings.supervisor_owned_runtime`` gates ``_launch_anyharness_runtime``:
off (default at merge) keeps today's direct-nohup AnyHarness + separate
worker-sidecar launch byte-for-byte (regression pin); on launches the
Supervisor first (via the previously-dead ``build_supervisor_config`` +
``build_detached_supervisor_launch_command``) and never launches a separate
worker sidecar. Providers and runtime probes are stubbed per the repo testing
standard -- no real sandboxes.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.integrations.sandbox.base import RuntimeEndpoint, SandboxRuntimeContext
from proliferate.server.cloud.materialization.sandbox_io import connect as connect_module
from proliferate.server.cloud.materialization.sandbox_io import (
    runtime_launch as runtime_launch_module,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_supervised_runtime_stop_command,
    build_worker_config,
    supervisor_binary_path,
    supervisor_config_path,
    worker_config_path,
)
from proliferate.server.cloud.runtime.sandbox_exec import build_detached_runtime_launch_command

RUNTIME_URL = "https://runtime.example.invalid"
HOME_DIR = "/home/user"
RUNTIME_BINARY = "/home/user/.proliferate/bin/anyharness"


class _CommandResult:
    def __init__(self, exit_code: int = 0) -> None:
        self.exit_code = exit_code
        self.stdout = ""
        self.stderr = ""


class _FakeProvider:
    """Records commands + written files so tests can assert which path ran."""

    template_version = "e2b-template-test"
    runtime_endpoint_handles_cors = False
    runtime_port = 8080

    def __init__(self, db: AsyncSession | None = None) -> None:
        self.db = db
        self.commands: list[str] = []
        self.written_files: dict[str, str] = {}
        self.runtime_io_transactions: list[bool] = []

    def _record_runtime_io(self) -> None:
        if self.db is not None:
            self.runtime_io_transactions.append(self.db.in_transaction())

    async def resume_sandbox(self, sandbox_id: str, **_kwargs: Any) -> object:
        return object()

    async def resolve_runtime_endpoint(self, sandbox: object) -> RuntimeEndpoint:
        return RuntimeEndpoint(runtime_url=RUNTIME_URL)

    async def resolve_runtime_context(self, sandbox: object) -> SandboxRuntimeContext:
        return SandboxRuntimeContext(
            home_dir=HOME_DIR,
            runtime_workdir=f"{HOME_DIR}/work",
            runtime_binary_path=RUNTIME_BINARY,
            base_env={},
        )

    async def write_file(self, sandbox: object, path: str, content: bytes | str) -> None:
        self._record_runtime_io()
        self.written_files[path] = content if isinstance(content, str) else content.decode()

    async def run_command(self, sandbox: object, command: str, **_kwargs: Any) -> _CommandResult:
        self._record_runtime_io()
        self.commands.append(command)
        return _CommandResult(exit_code=0)


def _install_stubs(
    monkeypatch: pytest.MonkeyPatch,
    provider: _FakeProvider,
) -> tuple[list[str], list[dict[str, object]]]:
    """Installs the same stubs as the reconnect self-heal suite, plus a
    ``launch_worker_sidecar`` spy so tests can assert it was (not) called."""
    monkeypatch.setattr(connect_module, "get_sandbox_provider", lambda _ref: provider)
    monkeypatch.setattr(
        runtime_launch_module,
        "build_runtime_launch_script",
        lambda *a, **k: "#!/bin/bash\ntrue\n",
    )
    runtime_env_calls: list[dict[str, object]] = []

    def _capture_runtime_env(*_args: object, **kwargs: object) -> dict[str, str]:
        runtime_env_calls.append(kwargs)
        return {}

    monkeypatch.setattr(runtime_launch_module, "build_runtime_env", _capture_runtime_env)
    monkeypatch.setattr(
        runtime_launch_module,
        "worker_cloud_base_url",
        lambda: "http://cloud.test",
    )

    async def _mint_enrollment(_sandbox_record: object) -> str:
        return "enrollment-token-stub"

    monkeypatch.setattr(
        runtime_launch_module,
        "mint_cloud_sandbox_worker_enrollment",
        _mint_enrollment,
    )

    async def _ok_health(*_a: Any, **_k: Any) -> None:
        return None

    async def _ok_auth(*_a: Any, **_k: Any) -> None:
        return None

    sidecar_calls: list[str] = []

    async def _spy_sidecar(*_a: Any, **_k: Any) -> None:
        sidecar_calls.append("called")

    async def _resume_allowed(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(runtime_launch_module, "wait_for_runtime_health", _ok_health)
    monkeypatch.setattr(runtime_launch_module, "verify_runtime_auth_enforced", _ok_auth)
    monkeypatch.setattr(runtime_launch_module, "launch_worker_sidecar", _spy_sidecar)
    monkeypatch.setattr(connect_module, "assert_cloud_sandbox_resume_allowed", _resume_allowed)
    return sidecar_calls, runtime_env_calls


async def _seed_sandbox(db: AsyncSession) -> CloudSandbox:
    user = User(
        email=f"supowned-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    sandbox = CloudSandbox(
        owner_user_id=user.id,
        provider_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        status=CloudSandboxStatus.ready,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
    )
    db.add(sandbox)
    await db.commit()
    return sandbox


def _runtime_context() -> SandboxRuntimeContext:
    return SandboxRuntimeContext(
        home_dir=HOME_DIR,
        runtime_workdir=f"{HOME_DIR}/work",
        runtime_binary_path=RUNTIME_BINARY,
        base_env={},
    )


@pytest.mark.asyncio
async def test_flag_off_keeps_legacy_launch_unchanged(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "supervisor_owned_runtime", False)
    provider = _FakeProvider(db_session)
    sidecar_calls, runtime_env_calls = _install_stubs(monkeypatch, provider)
    sandbox = await _seed_sandbox(db_session)
    value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
    assert value is not None

    await connect_module.connect_ready_sandbox(db_session, sandbox=value)

    runtime_context = _runtime_context()
    launch_command = build_detached_runtime_launch_command(runtime_context)
    supervisor_command = build_detached_supervisor_launch_command(runtime_context)

    assert launch_command in provider.commands
    assert supervisor_command not in provider.commands
    assert sidecar_calls == ["called"]
    assert [(call["target_id"], call["sandbox_id"]) for call in runtime_env_calls] == [
        (sandbox.id, sandbox.provider_sandbox_id)
    ]
    assert worker_config_path(runtime_context) not in provider.written_files
    assert supervisor_config_path(runtime_context) not in provider.written_files
    assert provider.runtime_io_transactions
    assert not any(provider.runtime_io_transactions)


@pytest.mark.asyncio
async def test_flag_on_launches_supervisor_first_no_sidecar(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "supervisor_owned_runtime", True)
    provider = _FakeProvider(db_session)
    sidecar_calls, runtime_env_calls = _install_stubs(monkeypatch, provider)
    sandbox = await _seed_sandbox(db_session)
    value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
    assert value is not None

    await connect_module.connect_ready_sandbox(db_session, sandbox=value)

    runtime_context = _runtime_context()
    launch_command = build_detached_runtime_launch_command(runtime_context)
    supervisor_binary = supervisor_binary_path(runtime_context)
    # The issued command embeds per-call identity env (sandbox/user ids), so it
    # cannot be reconstructed byte-for-byte here; assert on its stable shape
    # instead: it launches the supervisor binary, detached, against its config.
    supervisor_commands = [
        cmd
        for cmd in provider.commands
        if supervisor_binary in cmd and supervisor_config_path(runtime_context) in cmd
    ]
    assert supervisor_commands, provider.commands
    assert launch_command not in provider.commands
    # The Supervisor spawns the Worker itself: no separate sidecar launch.
    assert sidecar_calls == []
    assert [(call["target_id"], call["sandbox_id"]) for call in runtime_env_calls] == [
        (sandbox.id, sandbox.provider_sandbox_id)
    ]
    assert worker_config_path(runtime_context) in provider.written_files
    assert supervisor_config_path(runtime_context) in provider.written_files

    stop_command = build_supervised_runtime_stop_command(runtime_context)
    assert stop_command in provider.commands
    assert provider.runtime_io_transactions
    assert not any(provider.runtime_io_transactions)


class TestBuildWorkerConfigFence:
    """Decision 7: a supervisor-owned target's worker config never emits the
    legacy self-/anyharness-update gates, and carries the mailbox + bridge
    config fields instead."""

    def test_legacy_target_unchanged(self) -> None:
        runtime_context = _runtime_context()
        config = build_worker_config(
            cloud_base_url="http://cloud.test",
            enrollment_token="tok",
            runtime_context=runtime_context,
        )
        assert "self_update_enabled = true" in config
        assert "anyharness_update_enabled = true" in config
        assert "supervisor_update_request_dir" not in config

    def test_supervisor_owned_fences_legacy_gates(self) -> None:
        runtime_context = _runtime_context()
        config = build_worker_config(
            cloud_base_url="http://cloud.test",
            enrollment_token="tok",
            runtime_context=runtime_context,
            supervisor_owned=True,
        )
        assert "self_update_enabled = false" in config
        assert "anyharness_update_enabled = false" in config
        assert "supervisor_update_request_dir" in config
        assert "supervisor_binary_path" in config
        assert "supervisor_config_path" in config
        assert "supervisor_bridge_marker_dir" in config
        # The legacy in-place swap paths must never be emitted alongside a fence.
        assert "anyharness_binary_path" not in config
        assert "anyharness_launcher_path" not in config

    def test_supervisor_owned_carries_supervisor_config_toml_when_provided(self) -> None:
        # R9-007: the Worker config carries the Supervisor config TOML so the D5
        # bridge on an already-provisioned box can materialize it before spawn.
        runtime_context = _runtime_context()
        config = build_worker_config(
            cloud_base_url="http://cloud.test",
            enrollment_token="tok",
            runtime_context=runtime_context,
            supervisor_owned=True,
            supervisor_config_toml='anyharness_binary = "/x"\n',
        )
        assert "supervisor_config_toml" in config


class TestSupervisorConfigProcessEnv:
    def test_process_env_carries_anyharness_version(self) -> None:
        # R9-006: the Supervisor spawns the Worker child with process_env, which
        # must carry PROLIFERATE_ANYHARNESS_VERSION so the child reports the
        # runtime version it runs alongside (the child does not inherit it).
        from proliferate.server.cloud.runtime.bootstrap import build_supervisor_config

        runtime_context = _runtime_context()
        provider = _FakeProvider()
        config = build_supervisor_config(
            provider,
            runtime_context,
            {"PROLIFERATE_ANYHARNESS_VERSION": "9.9.9", "OTHER": "x"},
        )
        assert "[process_env]" in config
        process_section = config.split("[process_env]", 1)[1]
        assert 'PROLIFERATE_ANYHARNESS_VERSION = "9.9.9"' in process_section

    def test_process_env_omits_version_when_unstamped(self) -> None:
        # An unstamped deployment exports no version; process_env carries none,
        # matching the absent pin.
        from proliferate.server.cloud.runtime.bootstrap import build_supervisor_config

        runtime_context = _runtime_context()
        provider = _FakeProvider()
        config = build_supervisor_config(provider, runtime_context, {})
        assert "PROLIFERATE_ANYHARNESS_VERSION" not in config
