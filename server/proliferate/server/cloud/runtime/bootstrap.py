"""Runtime bootstrap helpers for cloud workspace provisioning."""

from __future__ import annotations

import json
import shlex
from collections.abc import Mapping
from uuid import UUID

from proliferate.config import settings
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.utils.telemetry_mode import is_vendor_telemetry_enabled

_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV = "ANYHARNESS_DEFER_STARTUP_RETENTION"


def _runtime_sentry_dsn() -> str:
    return settings.cloud_runtime_sentry_dsn


def _runtime_sentry_environment() -> str:
    return settings.cloud_runtime_sentry_environment


def _runtime_sentry_release() -> str:
    return settings.cloud_runtime_sentry_release


def _runtime_sentry_traces_sample_rate() -> float:
    return settings.cloud_runtime_sentry_traces_sample_rate


def _target_sentry_env() -> dict[str, str]:
    if not is_vendor_telemetry_enabled() or not settings.cloud_target_sentry_dsn:
        return {}

    env = {
        "PROLIFERATE_TARGET_SENTRY_DSN": settings.cloud_target_sentry_dsn,
        "PROLIFERATE_TARGET_SENTRY_TRACES_SAMPLE_RATE": str(
            settings.cloud_target_sentry_traces_sample_rate
        ),
    }
    if settings.cloud_target_sentry_environment:
        env["PROLIFERATE_TARGET_SENTRY_ENVIRONMENT"] = settings.cloud_target_sentry_environment
    if settings.cloud_target_sentry_release:
        env["PROLIFERATE_TARGET_SENTRY_RELEASE"] = settings.cloud_target_sentry_release
    return env


def _identity_env(
    *,
    organization_id: UUID | None = None,
    sandbox_id: str | None = None,
    user_id: UUID | None = None,
) -> dict[str, str]:
    """Identity env vars for observability (Sentry tags on all runtime surfaces)."""
    env: dict[str, str] = {"PROLIFERATE_RUNTIME_ENV": "e2b"}
    if organization_id is not None:
        env["PROLIFERATE_ORG_ID"] = str(organization_id)
    if sandbox_id:
        env["PROLIFERATE_SANDBOX_ID"] = sandbox_id
    if user_id is not None:
        env["PROLIFERATE_USER_ID"] = str(user_id)
    return env


def build_runtime_env(
    runtime_token: str,
    *,
    anyharness_data_key: str,
    target_id: UUID | None = None,
    repo_env_vars: Mapping[str, str] | None = None,
    organization_id: UUID | None = None,
    sandbox_id: str | None = None,
    user_id: UUID | None = None,
) -> dict[str, str]:
    env: dict[str, str] = {
        "ANYHARNESS_DEV_CORS": "1",
        _ANYHARNESS_DEFER_STARTUP_RETENTION_ENV: "1",
    }
    if is_vendor_telemetry_enabled() and _runtime_sentry_dsn():
        env["ANYHARNESS_SENTRY_DSN"] = _runtime_sentry_dsn()
    if is_vendor_telemetry_enabled() and _runtime_sentry_environment():
        env["ANYHARNESS_SENTRY_ENVIRONMENT"] = _runtime_sentry_environment()
    if is_vendor_telemetry_enabled() and _runtime_sentry_release():
        env["ANYHARNESS_SENTRY_RELEASE"] = _runtime_sentry_release()
    if is_vendor_telemetry_enabled():
        env["ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE"] = str(_runtime_sentry_traces_sample_rate())
    env["ANYHARNESS_BEARER_TOKEN"] = runtime_token
    env["ANYHARNESS_DATA_KEY"] = anyharness_data_key
    if target_id is not None:
        env["ANYHARNESS_RUNTIME_TARGET_ID"] = str(target_id)
    env.update(
        _identity_env(organization_id=organization_id, sandbox_id=sandbox_id, user_id=user_id)
    )
    if repo_env_vars:
        env.update(repo_env_vars)
    return env


def build_runtime_launch_script(
    provider: SandboxProvider,
    runtime_context: SandboxRuntimeContext,
    runtime_env: Mapping[str, str],
) -> str:
    merged_env = {**runtime_context.base_env, **runtime_env}
    export_lines = "\n".join(
        f"export {key}={shlex.quote(value)}" for key, value in sorted(merged_env.items())
    )
    serve_args = []
    serve_args.append("--require-bearer-auth")
    if provider.runtime_endpoint_handles_cors:
        serve_args.append("--disable-cors")
    serve_args.append("--host 0.0.0.0")
    serve_args.append(f"--port {provider.runtime_port}")
    return "\n".join(
        [
            "#!/bin/sh",
            "set -eu",
            f"cd {shlex.quote(runtime_context.runtime_workdir)}",
            export_lines,
            (
                f"exec {shlex.quote(runtime_context.runtime_binary_path)} serve "
                f"{' '.join(serve_args)}"
            ),
            "",
        ]
    )


def local_anyharness_base_url(provider: SandboxProvider) -> str:
    return f"http://127.0.0.1:{provider.runtime_port}"


def worker_binary_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/.proliferate/bin/proliferate-worker"


def worker_config_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/.proliferate/worker/config.toml"


def supervisor_binary_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/.proliferate/bin/proliferate-supervisor"


def supervisor_config_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/.proliferate/supervisor/config.toml"


def supervisor_update_request_dir(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/.proliferate/supervisor/updates"


def supervisor_log_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/proliferate-supervisor.log"


def anyharness_runtime_home(runtime_context: SandboxRuntimeContext) -> str:
    """Where AnyHarness keeps its runtime home (and reads its dotfiles) in-sandbox."""
    return f"{runtime_context.home_dir}/.proliferate/anyharness"


def worker_log_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/proliferate-worker.log"


def build_worker_config(
    *,
    cloud_base_url: str,
    enrollment_token: str,
    runtime_context: SandboxRuntimeContext,
) -> str:
    worker_dir = f"{runtime_context.home_dir}/.proliferate/worker"
    values = {
        "cloud_base_url": cloud_base_url,
        "enrollment_token": enrollment_token,
        "worker_db_path": f"{worker_dir}/worker.sqlite3",
        "integration_gateway_home": anyharness_runtime_home(runtime_context),
        "heartbeat_interval_seconds": 30,
        # The sandbox sidecar has no launcher that updates it (plain nohup),
        # so it converges its own binary onto the heartbeat's desiredVersions.
        # Desktop workers must never set this: the app bundle owns updates.
        "self_update_enabled": True,
    }
    lines = []
    for key, value in values.items():
        if isinstance(value, bool):
            # bool must precede int: Python bools are ints, but TOML needs
            # lowercase true/false rather than repr()'s True/False.
            lines.append(f"{key} = {'true' if value else 'false'}")
        elif isinstance(value, int):
            lines.append(f"{key} = {value}")
        else:
            lines.append(f"{key} = {json.dumps(value)}")
    return "\n".join(lines) + "\n"


def worker_db_path(runtime_context: SandboxRuntimeContext) -> str:
    return f"{runtime_context.home_dir}/.proliferate/worker/worker.sqlite3"


def worker_db_sidecar_paths(runtime_context: SandboxRuntimeContext) -> tuple[str, ...]:
    db_path = worker_db_path(runtime_context)
    return (db_path, f"{db_path}-wal", f"{db_path}-shm", f"{db_path}-journal")


def _serve_args(provider: SandboxProvider) -> list[str]:
    args = ["serve", "--require-bearer-auth"]
    if provider.runtime_endpoint_handles_cors:
        args.append("--disable-cors")
    args.extend(["--host", "0.0.0.0", "--port", str(provider.runtime_port)])
    return args


def build_supervisor_config(
    provider: SandboxProvider,
    runtime_context: SandboxRuntimeContext,
    runtime_env: Mapping[str, str],
    *,
    organization_id: UUID | None = None,
    sandbox_id: str | None = None,
    user_id: UUID | None = None,
) -> str:
    anyharness_env = {**runtime_context.base_env, **runtime_env}
    process_env = {
        **_target_sentry_env(),
        **_identity_env(organization_id=organization_id, sandbox_id=sandbox_id, user_id=user_id),
    }
    values = {
        "anyharness_binary": runtime_context.runtime_binary_path,
        "worker_binary": worker_binary_path(runtime_context),
        "worker_config": worker_config_path(runtime_context),
        "anyharness_args": _serve_args(provider),
        "restart_delay_seconds": 5,
    }
    lines = []
    for key, value in values.items():
        if isinstance(value, int):
            lines.append(f"{key} = {value}")
        else:
            lines.append(f"{key} = {json.dumps(value)}")
    if anyharness_env:
        lines.append("")
        lines.append("[anyharness_env]")
        for key, value in sorted(anyharness_env.items()):
            lines.append(f"{key} = {json.dumps(value)}")
    if process_env:
        lines.append("")
        lines.append("[process_env]")
        for key, value in sorted(process_env.items()):
            lines.append(f"{key} = {json.dumps(value)}")
    return "\n".join(lines) + "\n"


def _pgrep_pattern_for_path(path: str) -> str:
    if path.startswith("/"):
        return "[/]" + path[1:]
    return path


def build_detached_supervisor_launch_command(
    runtime_context: SandboxRuntimeContext,
    *,
    organization_id: UUID | None = None,
    sandbox_id: str | None = None,
    user_id: UUID | None = None,
) -> str:
    supervisor_binary = supervisor_binary_path(runtime_context)
    config_path = supervisor_config_path(runtime_context)
    log_path = supervisor_log_path(runtime_context)
    patterns = [
        f"{_pgrep_pattern_for_path(supervisor_binary)} --config {config_path} run",
        _pgrep_pattern_for_path(runtime_context.runtime_binary_path),
        _pgrep_pattern_for_path(worker_binary_path(runtime_context)),
    ]
    kill_lines: list[str] = []
    kill_lines.extend(
        [
            "current_pid=$$",
            "parent_pid=$PPID",
        ]
    )
    for pattern in patterns:
        quoted_pattern = shlex.quote(pattern)
        kill_lines.extend(
            [
                f"pids=$(pgrep -f {quoted_pattern} || true)",
                'if [ -n "$pids" ]; then',
                "  for pid in $pids; do",
                '    if [ "$pid" != "$current_pid" ] && [ "$pid" != "$parent_pid" ]; then',
                '      kill "$pid" || true',
                "    fi",
                "  done",
                "  sleep 1",
                "fi",
            ]
        )
    combined_env = {
        **_target_sentry_env(),
        **_identity_env(organization_id=organization_id, sandbox_id=sandbox_id, user_id=user_id),
    }
    target_env_lines = [
        f"export {key}={shlex.quote(value)}" for key, value in sorted(combined_env.items())
    ]
    script = "\n".join(
        [
            "set -eu",
            *kill_lines,
            *target_env_lines,
            (
                f"nohup {shlex.quote(supervisor_binary)} --config {shlex.quote(config_path)} run "
                f"> {shlex.quote(log_path)} 2>&1 < /dev/null &"
            ),
        ]
    )
    return "bash -lc " + shlex.quote(script)


def build_supervised_runtime_stop_command(runtime_context: SandboxRuntimeContext) -> str:
    supervisor_binary = supervisor_binary_path(runtime_context)
    config_path = supervisor_config_path(runtime_context)
    patterns = [
        f"{_pgrep_pattern_for_path(supervisor_binary)} --config {config_path} run",
        _pgrep_pattern_for_path(runtime_context.runtime_binary_path),
        _pgrep_pattern_for_path(worker_binary_path(runtime_context)),
    ]
    kill_lines: list[str] = [
        "current_pid=$$",
        "parent_pid=$PPID",
    ]
    for pattern in patterns:
        quoted_pattern = shlex.quote(pattern)
        kill_lines.extend(
            [
                f"pids=$(pgrep -f {quoted_pattern} || true)",
                'if [ -n "$pids" ]; then',
                "  for pid in $pids; do",
                '    if [ "$pid" != "$current_pid" ] && [ "$pid" != "$parent_pid" ]; then',
                '      kill "$pid" || true',
                "    fi",
                "  done",
                "fi",
            ]
        )
    script = "\n".join(["set -eu", *kill_lines, "sleep 1"])
    return "bash -lc " + shlex.quote(script)
