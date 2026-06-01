"""Shared sandbox command helpers for cloud runtime flows."""

from __future__ import annotations

import logging
import shlex
import time
from typing import Any
from uuid import UUID

from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.utils.time import duration_ms


def truncate_log_value(value: Any, *, max_chars: int = 240) -> str:
    text = str(value).strip()
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}..."


def result_exit_code(result: Any) -> int:
    return int(getattr(result, "exit_code", getattr(result, "exitCode", 0)))


def result_stdout(result: Any) -> str:
    stdout = getattr(result, "stdout", None)
    if stdout is not None:
        return str(stdout)
    artifacts = getattr(result, "artifacts", None)
    artifact_stdout = getattr(artifacts, "stdout", None)
    if artifact_stdout is not None:
        return str(artifact_stdout)
    rendered = getattr(result, "result", None)
    if rendered is not None:
        return str(rendered)
    return ""


def result_stderr(result: Any) -> str:
    stderr = getattr(result, "stderr", None)
    if stderr is not None:
        return str(stderr)
    return ""


def result_preview(result: Any) -> tuple[str | None, str | None]:
    stdout = result_stdout(result)
    stderr = result_stderr(result)
    return (
        truncate_log_value(stdout) if stdout else None,
        truncate_log_value(stderr) if stderr else None,
    )


def assert_command_succeeded(result: Any, context: str) -> None:
    if result_exit_code(result) != 0:
        stderr = result_stderr(result) or result_stdout(result)
        raise RuntimeError(f"{context}: {str(stderr).strip()[:400]}")


def merge_runtime_envs(
    runtime_context: SandboxRuntimeContext | None,
    envs: dict[str, str] | None,
    *,
    user: str | None,
) -> dict[str, str] | None:
    if runtime_context is None or user == "root":
        return envs
    return {**runtime_context.base_env, **(envs or {})}


def runtime_log_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/anyharness.log"


def runtime_launcher_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/start-anyharness.sh"


def build_detached_runtime_launch_command(runtime_context: SandboxRuntimeContext) -> str:
    """Legacy launcher used by pre-supervisor sandboxes during reconnect fallback."""
    return "bash -lc " + shlex.quote(
        f"nohup {shlex.quote(runtime_launcher_path(runtime_context))} "
        f"> {shlex.quote(runtime_log_path(runtime_context))} 2>&1 < /dev/null &"
    )


def _redacted_launcher_command(path: str) -> str:
    return (
        "awk 'BEGIN { IGNORECASE = 1 } "
        "/^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*"
        "(TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE)[A-Za-z0-9_]*=/ "
        '{ sub(/=.*/, "=<redacted>"); print; next } '
        "{ print }' "
        f"{path} || true"
    )


def _redacted_supervisor_config_command(path: str) -> str:
    return (
        "awk 'BEGIN { in_env = 0 } "
        "/^\\[(anyharness_env|process_env)\\]/ { in_env = 1; print; next } "
        "/^\\[/ { in_env = 0 } "
        "in_env && /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ "
        '{ sub(/=.*/, "= \\"<redacted>\\""); print; next } '
        "{ print }' "
        f"{path} || true"
    )


async def collect_runtime_debug_report(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> dict[str, str]:
    report: dict[str, str] = {}
    launcher_path = shlex.quote(runtime_launcher_path(runtime_context))
    log_path = shlex.quote(runtime_log_path(runtime_context))
    supervisor_config_path = shlex.quote(
        f"{runtime_context.home_dir}/.proliferate/supervisor/config.toml"
    )
    supervisor_log_path = shlex.quote(f"{runtime_context.home_dir}/proliferate-supervisor.log")
    commands = {
        "launcher": _redacted_launcher_command(launcher_path),
        "log": f"tail -n 200 {log_path} || true",
        "supervisor_config": _redacted_supervisor_config_command(supervisor_config_path),
        "supervisor_log": f"tail -n 200 {supervisor_log_path} || true",
        "processes": (
            "ps -ef | grep -E 'anyharness|proliferate-worker|proliferate-supervisor' "
            "| grep -v grep || true"
        ),
        "binary": f"ls -l {shlex.quote(runtime_context.runtime_binary_path)} || true",
        "workdir": f"ls -la {shlex.quote(runtime_context.runtime_workdir)} || true",
    }
    for label, command in commands.items():
        try:
            result = await run_sandbox_command_logged(
                provider,
                sandbox,
                workspace_id=workspace_id,
                label=f"runtime_debug_{label}",
                command=command,
                runtime_context=runtime_context,
                timeout_seconds=15,
                log_output_on_success=True,
            )
        except Exception as exc:
            message = truncate_log_value(format_exception_message(exc), max_chars=800)
            report[label] = f"<failed: {message}>"
            continue

        combined = result_stdout(result).strip() or result_stderr(result).strip() or "<empty>"
        report[label] = truncate_log_value(combined, max_chars=4000)
    return report


async def run_sandbox_command_logged(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    label: str,
    command: str,
    runtime_context: SandboxRuntimeContext | None = None,
    user: str | None = None,
    cwd: str | None = None,
    envs: dict[str, str] | None = None,
    background: bool = False,
    timeout_seconds: int | None = None,
    log_output_on_success: bool = False,
) -> Any:
    command_started = time.perf_counter()
    log_cloud_event(
        "cloud workspace sandbox command started",
        workspace_id=workspace_id,
        command_label=label,
        cwd=cwd,
        background=background,
        timeout_seconds=timeout_seconds,
    )
    try:
        result = await provider.run_command(
            sandbox,
            command,
            user=user,
            cwd=cwd,
            envs=merge_runtime_envs(runtime_context, envs, user=user),
            background=background,
            timeout_seconds=timeout_seconds,
        )
    except Exception as exc:
        log_cloud_event(
            "cloud workspace sandbox command failed",
            level=logging.ERROR,
            workspace_id=workspace_id,
            command_label=label,
            elapsed_ms=duration_ms(command_started),
            error=truncate_log_value(format_exception_message(exc)),
            error_type=exc.__class__.__name__,
        )
        raise

    exit_code = result_exit_code(result)
    stdout_preview, stderr_preview = result_preview(result)
    log_cloud_event(
        "cloud workspace sandbox command finished",
        level=logging.INFO if exit_code == 0 else logging.WARNING,
        workspace_id=workspace_id,
        command_label=label,
        elapsed_ms=duration_ms(command_started),
        exit_code=exit_code,
        stdout_preview=stdout_preview if (exit_code != 0 or log_output_on_success) else None,
        stderr_preview=stderr_preview if (exit_code != 0 or log_output_on_success) else None,
    )
    return result
