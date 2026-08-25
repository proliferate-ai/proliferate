"""S5-B: collect_runtime_debug_report must find the supervisor log regardless
of which of the two locations it landed in.

The standardized location is ``proliferate-supervisor.log`` next to
``config.toml`` -- ``.proliferate/supervisor/proliferate-supervisor.log``
(Python's fresh-launch command writes there; so did the since-deleted Rust D5
bridge). A Supervisor launched before the standardization may still be
writing to the old bare home-dir path. The debug report command must probe
both and surface whichever is present; no real sandbox is involved, so this
asserts on the generated shell command shape.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from proliferate.integrations.sandbox import SandboxRuntimeContext
from proliferate.server.cloud.runtime.bootstrap import (
    legacy_supervisor_log_path,
    supervisor_log_path,
)
from proliferate.server.cloud.runtime.sandbox_exec import collect_runtime_debug_report

HOME_DIR = "/home/user"


class _CommandResult:
    def __init__(self, stdout: str = "", exit_code: int = 0) -> None:
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = ""


class _RecordingProvider:
    """Records every command issued so the test can inspect the log probe."""

    def __init__(self) -> None:
        self.commands: list[str] = []

    async def run_command(self, sandbox: object, command: str, **_kwargs: Any) -> _CommandResult:
        self.commands.append(command)
        return _CommandResult(stdout="ok")


def _runtime_context() -> SandboxRuntimeContext:
    return SandboxRuntimeContext(
        home_dir=HOME_DIR,
        runtime_workdir=f"{HOME_DIR}/work",
        runtime_binary_path=f"{HOME_DIR}/.proliferate/bin/anyharness",
        base_env={},
    )


@pytest.mark.asyncio
async def test_supervisor_log_command_probes_both_candidate_paths() -> None:
    provider = _RecordingProvider()
    runtime_context = _runtime_context()

    await collect_runtime_debug_report(
        provider,  # type: ignore[arg-type]
        object(),
        workspace_id=uuid.uuid4(),
        runtime_context=runtime_context,
    )

    supervisor_log_commands = [
        cmd for cmd in provider.commands if "proliferate-supervisor.log" in cmd
    ]
    assert supervisor_log_commands, provider.commands
    command = supervisor_log_commands[0]
    assert supervisor_log_path(runtime_context) in command
    assert legacy_supervisor_log_path(runtime_context) in command
    # Current (post-standardization) location lives under .proliferate/supervisor/.
    assert ".proliferate/supervisor/proliferate-supervisor.log" in supervisor_log_path(
        runtime_context
    )
    # Legacy location is the bare home-dir path -- distinct from the current one.
    assert legacy_supervisor_log_path(runtime_context) == f"{HOME_DIR}/proliferate-supervisor.log"
    assert legacy_supervisor_log_path(runtime_context) != supervisor_log_path(runtime_context)


@pytest.mark.asyncio
async def test_debug_report_includes_supervisor_log_label(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = _RecordingProvider()
    runtime_context = _runtime_context()

    report = await collect_runtime_debug_report(
        provider,  # type: ignore[arg-type]
        object(),
        workspace_id=uuid.uuid4(),
        runtime_context=runtime_context,
    )

    assert "supervisor_log" in report
    assert report["supervisor_log"] == "ok"
