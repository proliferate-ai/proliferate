"""Cloud runtime toolchain bootstrap helpers."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
)

_CLAUDE_MIN_NODE_MAJOR = 20
_CLAUDE_MIN_NODE_MINOR = 10
_RUST_INSTALL_TIMEOUT_SECONDS = 900
_BUILD_DEPS_INSTALL_TIMEOUT_SECONDS = 300


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
