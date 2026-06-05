"""Runtime bundle discovery and sandbox staging helpers."""

from __future__ import annotations

import hashlib
import shlex
import sys
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

from proliferate.config import settings
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.bootstrap import supervisor_binary_path, worker_binary_path
from proliferate.server.cloud.runtime.sandbox_exec import (
    result_exit_code,
    result_stdout,
    run_sandbox_command_logged,
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
