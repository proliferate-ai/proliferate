"""Runtime bootstrap helpers for cloud workspace provisioning."""

from __future__ import annotations

import hashlib
import json
import shlex
import sys
from collections.abc import Callable, Mapping
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

from proliferate.config import settings
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
)
from proliferate.utils.telemetry_mode import is_vendor_telemetry_enabled

_CLAUDE_MIN_NODE_MAJOR = 20
_CLAUDE_MIN_NODE_MINOR = 10
_RUST_INSTALL_TIMEOUT_SECONDS = 900
_BUILD_DEPS_INSTALL_TIMEOUT_SECONDS = 300
_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV = "ANYHARNESS_DEFER_STARTUP_RETENTION"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def build_runtime_env(
    runtime_token: str,
    *,
    anyharness_data_key: str,
    target_id: UUID | None = None,
    repo_env_vars: Mapping[str, str] | None = None,
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
    if repo_env_vars:
        env.update(repo_env_vars)
    return env


async def _ensure_curl_available(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
) -> None:
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="ensure_curl_available",
            command=(
                'bash -lc "command -v curl >/dev/null 2>&1 || '
                '(apt-get update && apt-get install -y curl ca-certificates)"'
            ),
            user="root",
            timeout_seconds=240,
            log_output_on_success=True,
        ),
        "Failed to install curl in cloud sandbox",
    )


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


def _resolve_local_component_binary_path(
    *,
    binary_name: str,
    source_binary_path: str,
    source_env_name: str,
) -> Path:
    candidates: list[Path] = []
    if source_binary_path:
        candidates.append(Path(source_binary_path).expanduser())
    repo_root = Path(__file__).resolve().parents[5]
    candidates.extend(
        [
            repo_root / "target" / "x86_64-unknown-linux-musl" / "release" / binary_name,
            repo_root / "target" / "x86_64-unknown-linux-gnu" / "release" / binary_name,
        ]
    )
    if sys.platform.startswith("linux"):
        candidates.append(repo_root / "target" / "release" / binary_name)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        f"{binary_name} Linux binary was not found for cloud provisioning. "
        f"Build target/x86_64-unknown-linux-musl/release/{binary_name} "
        f"(or target/x86_64-unknown-linux-gnu/release/{binary_name}) or set "
        f"{source_env_name}."
    )


def resolve_local_runtime_binary_path() -> Path:
    return _resolve_local_component_binary_path(
        binary_name="anyharness",
        source_binary_path=settings.cloud_runtime_source_binary_path,
        source_env_name="CLOUD_RUNTIME_SOURCE_BINARY_PATH",
    )


def resolve_local_worker_binary_path() -> Path:
    return _resolve_local_component_binary_path(
        binary_name="proliferate-worker",
        source_binary_path=settings.cloud_worker_source_binary_path,
        source_env_name="CLOUD_WORKER_SOURCE_BINARY_PATH",
    )


def resolve_local_supervisor_binary_path() -> Path:
    return _resolve_local_component_binary_path(
        binary_name="proliferate-supervisor",
        source_binary_path=settings.cloud_supervisor_source_binary_path,
        source_env_name="CLOUD_SUPERVISOR_SOURCE_BINARY_PATH",
    )


def is_supported_claude_node_version(version: str) -> bool:
    normalized = version.strip().removeprefix("v")
    parts = normalized.split(".")
    if len(parts) < 2:
        return False
    try:
        major, minor = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    return major > _CLAUDE_MIN_NODE_MAJOR or (
        major == _CLAUDE_MIN_NODE_MAJOR and minor >= _CLAUDE_MIN_NODE_MINOR
    )


async def _check_component_binary_preinstalled(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
    remote_path: str,
    local_resolver: Callable[[], Path],
    label_prefix: str,
) -> bool:
    check_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label=f"check_{label_prefix}_binary",
        command=f"test -x {shlex.quote(remote_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    if result_exit_code(check_result) != 0:
        return False

    try:
        local_binary_path = local_resolver()
    except RuntimeError:
        return True

    local_binary_hash = _sha256_file(local_binary_path)
    hash_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label=f"check_{label_prefix}_binary_sha256",
        command=(
            "bash -lc " + shlex.quote(f"sha256sum {shlex.quote(remote_path)} | cut -d' ' -f1")
        ),
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    if result_exit_code(hash_result) != 0:
        return False

    remote_binary_hash = result_stdout(hash_result).strip()
    return remote_binary_hash == local_binary_hash


async def check_binary_preinstalled(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> bool:
    return await _check_component_binary_preinstalled(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
        remote_path=runtime_context.runtime_binary_path,
        local_resolver=resolve_local_runtime_binary_path,
        label_prefix="runtime",
    )


async def install_node_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> str:
    """Install a supported Node.js version and return the verified version string."""
    await _ensure_curl_available(provider, sandbox, workspace_id=workspace_id)
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="install_nodesource_repo",
            command='bash -lc "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"',
            user="root",
            timeout_seconds=180,
            log_output_on_success=True,
        ),
        "Failed to configure NodeSource repository",
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="install_nodejs",
            command="apt-get install -y nodejs",
            user="root",
            timeout_seconds=240,
        ),
        "Failed to install Node.js in cloud sandbox",
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="link_node_binaries",
            command=(
                "rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx && "
                "ln -sf /usr/bin/node /usr/local/bin/node && "
                "ln -sf /usr/bin/npm /usr/local/bin/npm && "
                "ln -sf /usr/bin/npx /usr/local/bin/npx"
            ),
            user="root",
            timeout_seconds=30,
        ),
        "Failed to prioritize installed Node.js in cloud sandbox",
    )
    return await verify_node_runtime(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )


async def check_rust_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> str | None:
    check_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="check_rust_runtime",
        command="cargo --version",
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    if result_exit_code(check_result) == 0:
        return result_stdout(check_result).strip()
    return None


async def install_rust_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> str:
    await _ensure_curl_available(provider, sandbox, workspace_id=workspace_id)

    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="install_rust_build_deps",
            command=("apt-get update && apt-get install -y build-essential pkg-config libssl-dev"),
            user="root",
            timeout_seconds=_BUILD_DEPS_INSTALL_TIMEOUT_SECONDS,
        ),
        "Failed to install Rust build dependencies in cloud sandbox",
    )

    home_dir = runtime_context.home_dir
    cargo_home = f"{home_dir}/.cargo"
    rustup_home = f"{home_dir}/.rustup"
    cargo_env = {
        "HOME": home_dir,
        "CARGO_HOME": cargo_home,
        "RUSTUP_HOME": rustup_home,
    }
    rustup_command = (
        'bash -lc "set -eu; '
        'if [ ! -x "$HOME/.cargo/bin/cargo" ]; then '
        "curl https://sh.rustup.rs -sSf | "
        "sh -s -- -y --profile minimal --default-toolchain stable; "
        'fi"'
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="install_rust_toolchain",
            command=rustup_command,
            cwd=home_dir,
            runtime_context=runtime_context,
            envs=cargo_env,
            timeout_seconds=_RUST_INSTALL_TIMEOUT_SECONDS,
        ),
        "Failed to install Rust toolchain in cloud sandbox",
    )

    cargo_bin = f"{cargo_home}/bin"
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="link_rust_binaries",
            command=(
                f"ln -sf {cargo_bin}/cargo /usr/local/bin/cargo && "
                f"ln -sf {cargo_bin}/rustc /usr/local/bin/rustc && "
                f"ln -sf {cargo_bin}/rustup /usr/local/bin/rustup"
            ),
            user="root",
            timeout_seconds=30,
        ),
        "Failed to link Rust toolchain binaries in cloud sandbox",
    )

    return await verify_rust_runtime(provider, sandbox, workspace_id=workspace_id)


async def verify_rust_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
) -> str:
    verify_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="verify_rust_runtime",
        command="cargo --version && rustc --version",
        timeout_seconds=30,
        log_output_on_success=True,
    )
    verify_lines = result_stdout(verify_result).strip().splitlines()
    cargo_version = verify_lines[0].strip() if verify_lines else ""
    ok = result_exit_code(verify_result) == 0 and cargo_version.startswith("cargo ")
    if not ok:
        stderr = result_stderr(verify_result) or result_stdout(verify_result)
        error_excerpt = str(stderr).strip()[:400]
        raise RuntimeError(
            f"Installed Rust toolchain is unavailable in cloud sandbox: {error_excerpt}"
        )
    return cargo_version


async def verify_node_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> str:
    verify_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="verify_node_runtime",
        command="node -p 'process.versions.node' && npm --version",
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    verify_lines = result_stdout(verify_result).strip().splitlines()
    node_version = verify_lines[0].strip() if verify_lines else ""
    ok = result_exit_code(verify_result) == 0 and is_supported_claude_node_version(node_version)
    if not ok:
        stderr = result_stderr(verify_result) or result_stdout(verify_result)
        raise RuntimeError(
            f"Installed Node.js is still unsupported for Claude ACP: {str(stderr).strip()[:400]}"
        )
    return node_version


async def stage_runtime_binary(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> Path:
    binary_path = resolve_local_runtime_binary_path()
    await provider.write_file(
        sandbox,
        runtime_context.runtime_binary_path,
        binary_path.read_bytes(),
    )
    await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="chmod_runtime_binary",
        command=f"chmod +x {shlex.quote(runtime_context.runtime_binary_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    return binary_path


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


async def check_worker_binary_preinstalled(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> bool:
    return await _check_component_binary_preinstalled(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
        remote_path=worker_binary_path(runtime_context),
        local_resolver=resolve_local_worker_binary_path,
        label_prefix="worker",
    )


async def check_supervisor_binary_preinstalled(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> bool:
    return await _check_component_binary_preinstalled(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
        remote_path=supervisor_binary_path(runtime_context),
        local_resolver=resolve_local_supervisor_binary_path,
        label_prefix="supervisor",
    )


async def check_runtime_bundle_preinstalled(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> bool:
    return all(
        [
            await check_binary_preinstalled(
                provider,
                sandbox,
                workspace_id=workspace_id,
                runtime_context=runtime_context,
            ),
            await check_worker_binary_preinstalled(
                provider,
                sandbox,
                workspace_id=workspace_id,
                runtime_context=runtime_context,
            ),
            await check_supervisor_binary_preinstalled(
                provider,
                sandbox,
                workspace_id=workspace_id,
                runtime_context=runtime_context,
            ),
        ]
    )


def build_worker_config(
    *,
    cloud_base_url: str,
    enrollment_token: str,
    anyharness_base_url: str,
    anyharness_bearer_token: str,
    runtime_context: SandboxRuntimeContext,
) -> str:
    worker_dir = f"{runtime_context.home_dir}/.proliferate/worker"
    values = {
        "cloud_base_url": cloud_base_url,
        "enrollment_token": enrollment_token,
        "anyharness_base_url": anyharness_base_url,
        "anyharness_bearer_token": anyharness_bearer_token,
        "worker_db_path": f"{worker_dir}/worker.sqlite3",
        "supervisor_update_request_dir": supervisor_update_request_dir(runtime_context),
        "heartbeat_interval_seconds": 30,
    }
    lines = []
    for key, value in values.items():
        if isinstance(value, int):
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
) -> str:
    anyharness_env = {**runtime_context.base_env, **runtime_env}
    process_env = _target_sentry_env()
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


def build_detached_supervisor_launch_command(runtime_context: SandboxRuntimeContext) -> str:
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
    target_env_lines = [
        f"export {key}={shlex.quote(value)}" for key, value in sorted(_target_sentry_env().items())
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


async def stage_worker_binary(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> Path:
    binary_path = resolve_local_worker_binary_path()
    remote_path = worker_binary_path(runtime_context)
    await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="mkdir_worker_binary_dir",
        command=f"mkdir -p {shlex.quote(str(PurePosixPath(remote_path).parent))}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    await provider.write_file(
        sandbox,
        remote_path,
        binary_path.read_bytes(),
    )
    await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="chmod_worker_binary",
        command=f"chmod +x {shlex.quote(remote_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    return binary_path


async def stage_supervisor_binary(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> Path:
    binary_path = resolve_local_supervisor_binary_path()
    remote_path = supervisor_binary_path(runtime_context)
    await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="mkdir_supervisor_binary_dir",
        command=f"mkdir -p {shlex.quote(str(PurePosixPath(remote_path).parent))}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    await provider.write_file(
        sandbox,
        remote_path,
        binary_path.read_bytes(),
    )
    await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="chmod_supervisor_binary",
        command=f"chmod +x {shlex.quote(remote_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    return binary_path


async def stage_runtime_bundle(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> dict[str, Path]:
    runtime = await stage_runtime_binary(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
    worker = await stage_worker_binary(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
    supervisor = await stage_supervisor_binary(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
    return {
        "anyharness": runtime,
        "worker": worker,
        "supervisor": supervisor,
    }


async def check_node_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> str | None:
    check_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="check_node_runtime",
        command="node -p 'process.versions.node'",
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    check_stdout = result_stdout(check_result).strip()
    if result_exit_code(check_result) == 0 and is_supported_claude_node_version(check_stdout):
        return check_stdout
    return None


async def ensure_node_runtime(
    provider: SandboxProvider,
    sandbox: Any,
    *,
    workspace_id: UUID,
    runtime_context: SandboxRuntimeContext,
) -> str:
    existing_version = await check_node_runtime(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
    if existing_version:
        return existing_version
    return await install_node_runtime(
        provider,
        sandbox,
        workspace_id=workspace_id,
        runtime_context=runtime_context,
    )
