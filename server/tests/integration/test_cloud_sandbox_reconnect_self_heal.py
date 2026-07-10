"""Reconnect self-heal + token persistence for connect_ready_sandbox.

Real prod incident (2026-07-09): a legacy cloud_sandbox row was
``status=ready`` with ``provider_sandbox_id`` set but ``runtime_token_ciphertext``
and ``anyharness_base_url`` NULL. Resuming took the fresh-mint branch and
relaunched the runtime, but the resumed E2B sandbox still had an OLD anyharness
process bound to the runtime port holding the OLD bearer token, so auth
verification against the freshly minted token 401'd and the whole reconnect
blew up.

These tests pin the fix at the ``connect_ready_sandbox`` orchestration layer:

1. ``_launch_anyharness_runtime`` kills any stale runtime/worker/supervisor
   (via the supervisor stop command) BEFORE relaunching.
2. A freshly minted runtime token is persisted even when the runtime URL is
   unchanged, so the next connect does not repeat the dance.

Providers and runtime probes are stubbed per the repo testing standard — no
real sandboxes.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.integrations.sandbox.base import RuntimeEndpoint, SandboxRuntimeContext
from proliferate.server.cloud.materialization.sandbox_io import connect as connect_module
from proliferate.server.cloud.runtime.bootstrap import build_supervised_runtime_stop_command
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
    """Records commands so tests can assert the self-heal ordering."""

    template_version = "e2b-template-test"

    def __init__(self) -> None:
        self.commands: list[str] = []
        self.written_files: list[str] = []

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
        self.written_files.append(path)

    async def run_command(self, sandbox: object, command: str, **_kwargs: Any) -> _CommandResult:
        self.commands.append(command)
        return _CommandResult(exit_code=0)


def _install_stubs(monkeypatch: pytest.MonkeyPatch, provider: _FakeProvider) -> None:
    monkeypatch.setattr(connect_module, "get_sandbox_provider", lambda _ref: provider)
    monkeypatch.setattr(
        connect_module, "build_runtime_launch_script", lambda *a, **k: "#!/bin/bash\ntrue\n"
    )
    monkeypatch.setattr(connect_module, "build_runtime_env", lambda *a, **k: {})

    async def _ok_health(*_a: Any, **_k: Any) -> None:
        return None

    async def _ok_auth(*_a: Any, **_k: Any) -> None:
        return None

    async def _ok_sidecar(*_a: Any, **_k: Any) -> None:
        return None

    async def _resume_allowed(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(connect_module, "wait_for_runtime_health", _ok_health)
    monkeypatch.setattr(connect_module, "verify_runtime_auth_enforced", _ok_auth)
    monkeypatch.setattr(connect_module, "launch_worker_sidecar", _ok_sidecar)
    # Billing resume gate is out of scope for reconnect self-heal.
    monkeypatch.setattr(connect_module, "assert_cloud_sandbox_resume_allowed", _resume_allowed)


async def _seed_sandbox(
    db: AsyncSession,
    *,
    anyharness_base_url: str | None,
    runtime_token_ciphertext: str | None,
) -> CloudSandbox:
    user = User(
        email=f"reconnect-{uuid.uuid4().hex[:10]}@example.com",
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
        anyharness_base_url=anyharness_base_url,
        runtime_token_ciphertext=runtime_token_ciphertext,
        anyharness_data_key_ciphertext=None,
    )
    db.add(sandbox)
    await db.commit()
    return sandbox


@pytest.mark.asyncio
async def test_stale_runtime_is_killed_before_relaunch(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The legacy NULL-token row relaunches, and the stale runtime is killed first."""
    provider = _FakeProvider()
    _install_stubs(monkeypatch, provider)
    sandbox = await _seed_sandbox(
        db_session,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
    )
    value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
    assert value is not None

    await connect_module.connect_ready_sandbox(db_session, sandbox=value)

    runtime_context = SandboxRuntimeContext(
        home_dir=HOME_DIR,
        runtime_workdir=f"{HOME_DIR}/work",
        runtime_binary_path=RUNTIME_BINARY,
        base_env={},
    )
    stop_command = build_supervised_runtime_stop_command(runtime_context)
    launch_command = build_detached_runtime_launch_command(runtime_context)
    assert stop_command in provider.commands, provider.commands
    assert launch_command in provider.commands, provider.commands
    # Self-heal invariant: kill the stale runtime BEFORE relaunching it.
    assert provider.commands.index(stop_command) < provider.commands.index(launch_command)


@pytest.mark.asyncio
async def test_fresh_token_persisted_when_url_unchanged(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A NULL-token row whose URL already matches still persists the minted token."""
    provider = _FakeProvider()
    _install_stubs(monkeypatch, provider)
    # The row already carries the URL the provider resolves to, but no token.
    sandbox = await _seed_sandbox(
        db_session,
        anyharness_base_url=RUNTIME_URL,
        runtime_token_ciphertext=None,
    )
    value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
    assert value is not None
    assert value.anyharness_base_url == RUNTIME_URL
    assert value.anyharness_bearer_token_ciphertext is None

    await connect_module.connect_ready_sandbox(db_session, sandbox=value)

    refreshed = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
    assert refreshed is not None
    # The whole point: the freshly minted token is now stored, so the next
    # connect will take the reuse branch instead of repeating the dance.
    assert refreshed.anyharness_bearer_token_ciphertext is not None
    assert refreshed.anyharness_data_key_ciphertext is not None
    assert refreshed.status == "ready"
