"""New-provision topology branch (Make Managed Runtime Updates Supervisor-Owned, decision 5).

``settings.supervisor_owned_runtime`` gates ``_launch_anyharness_runtime``:
off keeps today's direct-nohup AnyHarness + separate worker-sidecar launch
byte-for-byte (regression pin, explicitly monkeypatched by the flag-off
test); on (the default since the live E2B N-1->N proof passed 2026-07-26)
launches the Supervisor first (via ``build_supervisor_config`` +
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


@pytest.mark.asyncio
async def test_default_takes_supervisor_path_without_monkeypatch(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The live E2B N-1->N proof passed 2026-07-26; the flag now defaults on.

    This pins the *default* the ``supervisor_owned_runtime`` field resolves
    to, not the ambient module-level ``settings`` singleton -- a dev with
    ``SUPERVISOR_OWNED_RUNTIME=0`` (or the ``PROLIFERATE_`` alias) exported in
    their shell would make an assertion against the singleton fail
    spuriously even though the field's own default is correct. Construct a
    fresh ``Settings()`` with both env var spellings cleared instead, so the
    assertion reflects only the field default, never ambient env."""
    monkeypatch.delenv("PROLIFERATE_SUPERVISOR_OWNED_RUNTIME", raising=False)
    monkeypatch.delenv("SUPERVISOR_OWNED_RUNTIME", raising=False)
    from proliferate.config import Settings

    fresh_settings = Settings()
    assert fresh_settings.supervisor_owned_runtime is True

    # The launch path itself reads the module-level ``settings`` singleton
    # (see ``_launch_anyharness_runtime``'s ``settings.supervisor_owned_runtime``
    # check), which is resolved once at import time and is NOT re-read from
    # the cleared env above. Pin it to the freshly-resolved default so the
    # launch-path assertion below is deterministic regardless of what env
    # var state this process's `settings` singleton happened to import with.
    monkeypatch.setattr(
        settings, "supervisor_owned_runtime", fresh_settings.supervisor_owned_runtime
    )

    provider = _FakeProvider(db_session)
    sidecar_calls, _runtime_env_calls = _install_stubs(monkeypatch, provider)
    sandbox = await _seed_sandbox(db_session)
    value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
    assert value is not None

    await connect_module.connect_ready_sandbox(db_session, sandbox=value)

    runtime_context = _runtime_context()
    launch_command = build_detached_runtime_launch_command(runtime_context)
    supervisor_binary = supervisor_binary_path(runtime_context)
    supervisor_commands = [
        cmd
        for cmd in provider.commands
        if supervisor_binary in cmd and supervisor_config_path(runtime_context) in cmd
    ]
    assert supervisor_commands, provider.commands
    assert launch_command not in provider.commands
    assert sidecar_calls == []


class TestSupervisorLaunchCommandHardening:
    """Flip-hazard parity with the legacy worker sidecar (worker_sidecar.py):
    a paused VM resumed from a template baked before the supervisor binary
    existed must not half-start. The launch command guards with ``test -x``
    so it still exits 0 without launching anything; the health probe then
    fails with a clean signal instead of a silent timeout."""

    def test_launch_command_guards_missing_binary_with_test_dash_x(self) -> None:
        runtime_context = _runtime_context()
        command = build_detached_supervisor_launch_command(runtime_context)
        supervisor_binary = supervisor_binary_path(runtime_context)
        assert f"test -x {supervisor_binary}" in command or (
            f"test -x '{supervisor_binary}'" in command
        )
        # The guard must gate the nohup, not merely appear somewhere in the script.
        assert "test -x" in command
        guard_index = command.index("test -x")
        nohup_index = command.index("nohup")
        assert guard_index < nohup_index

    def test_guard_precedes_nohup_in_command_shape(self) -> None:
        # `test -x ... && nohup ... &` -- the backgrounded nohup means the
        # overall command does not block on (or propagate) the guard's
        # failure; `set -eu` only affects the script up to the background job.
        #
        # This is a string-shape assertion, not an executed-script assertion:
        # the generated command also carries `pgrep -f <pattern> ... kill
        # "$pid"` lines (build_supervised_runtime_stop_command's kill_lines)
        # that pattern-match and kill against the real live process table --
        # there is no way to scope `pgrep -f` to a tmp_path, so actually
        # running this script (even with a tmp_path-rooted runtime_context)
        # is unsafe. Assert the shape instead: the guard gates the nohup, the
        # nohup is backgrounded with a trailing `&`, and there is no bare
        # unguarded nohup anywhere in the command.
        runtime_context = _runtime_context()
        command = build_detached_supervisor_launch_command(runtime_context)
        assert "&& nohup" in command
        guard_index = command.index("test -x")
        nohup_index = command.index("nohup")
        assert guard_index < nohup_index
        # The whole script is shell-quoted (`bash -lc '...'`), so the nohup
        # line's trailing character is the closing quote, not `&` itself;
        # strip a trailing quote char before checking the backgrounding `&`.
        nohup_line = next(line for line in command.splitlines() if "nohup" in line)
        assert nohup_line.rstrip().rstrip("'\"").endswith("&")
        # Every nohup invocation in the script must be guarded -- no bare
        # `nohup ...` that isn't preceded by `&& ` on the same line.
        for line in command.splitlines():
            if "nohup" in line:
                assert "&& nohup" in line, line

    @pytest.mark.asyncio
    async def test_health_probe_timeout_logs_missing_binary_hint(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When the health probe never succeeds after a supervisor launch (the
        only externally visible symptom of the `test -x` guard silently
        no-op'ing on a stale template), log a distinct hint pointing at the
        possible missing-binary cause instead of a generic timeout only."""
        from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError

        monkeypatch.setattr(settings, "supervisor_owned_runtime", True)
        provider = _FakeProvider(db_session)
        _install_stubs(monkeypatch, provider)

        async def _failing_health(*_a: Any, **_k: Any) -> None:
            raise CloudRuntimeReconnectError(
                "AnyHarness did not become healthy in the cloud sandbox."
            )

        monkeypatch.setattr(runtime_launch_module, "wait_for_runtime_health", _failing_health)

        logged: list[str] = []
        original_log_cloud_event = runtime_launch_module.log_cloud_event

        def _capture_log(message: str, *args: object, **kwargs: object) -> None:
            logged.append(message)
            original_log_cloud_event(message, *args, **kwargs)

        monkeypatch.setattr(runtime_launch_module, "log_cloud_event", _capture_log)

        sandbox = await _seed_sandbox(db_session)
        value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
        assert value is not None

        with pytest.raises(CloudRuntimeReconnectError):
            await connect_module.connect_ready_sandbox(db_session, sandbox=value)

        assert any(
            "missing" in message.lower() and "supervisor" in message.lower() for message in logged
        ), logged


class TestSupervisorOwnedLaunchEmptyBaseUrl:
    """The supervisor path must warn (not silently proceed) when no cloud
    base URL is configured, matching the legacy sidecar's loud warning
    (worker_sidecar.py:91-103) -- warning parity only, NOT behavioral parity.
    The legacy sidecar warns and then skips launching the worker entirely, so
    a misconfigured deploy ends up with AnyHarness and no worker. The
    supervisor-owned path cannot do that: `SupervisorConfig.worker_binary`/
    `worker_config` (anyharness/crates/proliferate-supervisor/src/config.rs)
    are required, non-Option fields with no supervisor-config shape that
    omits the worker, so the Supervisor still launches AnyHarness AND a
    Worker child that bakes in the empty base URL, fails to enroll, exits,
    and gets endlessly respawned by the Supervisor's restart loop -- a
    permanent crash-loop rather than the legacy path's quiet no-worker
    runtime. This test only asserts the Supervisor still launches and that
    the warning fires; it does not (and cannot) assert a worker-less
    config, because none exists on the Rust side."""

    @pytest.mark.asyncio
    async def test_empty_base_url_warns_but_still_launches_supervisor(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "supervisor_owned_runtime", True)
        provider = _FakeProvider(db_session)
        _install_stubs(monkeypatch, provider)
        # Override the stubbed base URL back to empty to hit the warning path.
        monkeypatch.setattr(runtime_launch_module, "worker_cloud_base_url", lambda: "")
        sandbox = await _seed_sandbox(db_session)
        value = await sandbox_store.load_personal_cloud_sandbox(db_session, sandbox.owner_user_id)
        assert value is not None

        logged_warnings: list[str] = []
        original_log_cloud_event = runtime_launch_module.log_cloud_event

        def _capture_log(message: str, *args: object, **kwargs: object) -> None:
            logged_warnings.append(message)
            original_log_cloud_event(message, *args, **kwargs)

        monkeypatch.setattr(runtime_launch_module, "log_cloud_event", _capture_log)

        await connect_module.connect_ready_sandbox(db_session, sandbox=value)

        runtime_context = _runtime_context()
        supervisor_binary = supervisor_binary_path(runtime_context)
        supervisor_commands = [
            cmd
            for cmd in provider.commands
            if supervisor_binary in cmd and supervisor_config_path(runtime_context) in cmd
        ]
        assert supervisor_commands, provider.commands
        assert any("no cloud base URL configured" in message for message in logged_warnings), (
            logged_warnings
        )


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
