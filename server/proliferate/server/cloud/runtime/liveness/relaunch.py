"""Runtime relaunch and worker re-enrollment helpers."""

from __future__ import annotations

import shlex
from pathlib import PurePosixPath
from urllib.parse import urlparse
from uuid import UUID

from proliferate.config import settings
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import SandboxProvider, SandboxRuntimeContext
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_supervised_runtime_stop_command,
    build_worker_config,
    local_anyharness_base_url,
    supervisor_config_path,
    worker_config_path,
    worker_db_sidecar_paths,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.server.cloud.runtime.target_registration import ensure_runtime_target_enrollment

_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV = "ANYHARNESS_DEFER_STARTUP_RETENTION"
_LOCAL_CLOUD_BASE_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _is_local_cloud_base_url(value: str) -> bool:
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    return hostname in _LOCAL_CLOUD_BASE_HOSTS or hostname.endswith(".localhost")


def cloud_base_url_for_worker_config() -> str:
    local_candidates: list[tuple[str, str]] = []
    for source, candidate in (
        ("CLOUD_WORKER_BASE_URL", settings.cloud_worker_base_url),
        ("API_BASE_URL", settings.api_base_url),
        ("CLOUD_MCP_OAUTH_CALLBACK_BASE_URL", settings.cloud_mcp_oauth_callback_base_url),
        (
            "CLOUD_MCP_OAUTH_CALLBACK_FALLBACK_BASE_URL",
            settings.cloud_mcp_oauth_callback_fallback_base_url,
        ),
    ):
        normalized = candidate.strip().rstrip("/")
        if not normalized:
            continue
        if _is_local_cloud_base_url(normalized):
            local_candidates.append((source, normalized))
            continue
        return normalized

    detail = (
        " Configured worker callback URLs are local-only: "
        + ", ".join(f"{source}={value}" for source, value in local_candidates)
        + "."
        if local_candidates
        else ""
    )
    raise CloudRuntimeReconnectError(
        "Cloud worker base URL is not configured for managed runtime relaunch." + detail
    )


def _raise_reconnect_on_command_failure(result: object, context: str) -> None:
    try:
        assert_command_succeeded(result, context)
    except RuntimeError as exc:
        raise CloudRuntimeReconnectError(str(exc)) from exc


async def cloud_base_url_for_worker_relaunch(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    workspace_id: UUID,
) -> str:
    try:
        return cloud_base_url_for_worker_config()
    except CloudRuntimeReconnectError as config_error:
        config_path = worker_config_path(runtime_context)
        read_result = await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="read_existing_worker_cloud_base_url",
            command=(
                "sed -n "
                + shlex.quote(r's/^cloud_base_url = "\(.*\)"$/\1/p')
                + f" {shlex.quote(config_path)} | head -n 1"
            ),
            runtime_context=runtime_context,
            timeout_seconds=15,
            log_output_on_success=True,
        )
        existing = result_stdout(read_result).strip()
        if (
            result_exit_code(read_result) == 0
            and existing
            and not _is_local_cloud_base_url(existing)
        ):
            return existing
        raise config_error from None


async def _ensure_launcher_defers_startup_retention(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    workspace_id: UUID,
) -> None:
    launcher = shlex.quote(runtime_launcher_path(runtime_context))
    sentinel = "# Managed by Proliferate: defer startup worktree retention"
    env_line = f"export {_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV}=1"
    command = "bash -lc " + shlex.quote(
        "\n".join(
            [
                f"launcher={launcher}",
                'test -f "$launcher" || exit 1',
                (
                    f"if ! grep -q '^export {_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV}=' "
                    '"$launcher"; then'
                ),
                '  tmp="${launcher}.tmp.$$"',
                (
                    f"  awk -v sentinel={shlex.quote(sentinel)} "
                    f"-v line={shlex.quote(env_line)} "
                    "'BEGIN { inserted=0 } "
                    "/^exec / && !inserted { print sentinel; print line; inserted=1 } "
                    "{ print } "
                    "END { if (!inserted) { print sentinel; print line } }' "
                    '"$launcher" > "$tmp"'
                ),
                '  chmod +x "$tmp"',
                '  mv "$tmp" "$launcher"',
                "fi",
                f"grep -q '^export {_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV}=1$' \"$launcher\"",
            ]
        )
    )
    patch_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="ensure_runtime_launcher_startup_retention_deferral",
        command=command,
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=15,
        log_output_on_success=True,
    )
    if result_exit_code(patch_result) != 0:
        stderr = result_stderr(patch_result) or result_stdout(patch_result)
        raise CloudRuntimeReconnectError(
            "Cloud runtime launcher could not be patched for startup retention deferral: "
            f"{stderr.strip()[:400]}"
        )


async def relaunch_runtime(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    workspace_id: UUID,
) -> None:
    supervisor_config_check = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="check_runtime_supervisor_config",
        command=f"test -f {shlex.quote(supervisor_config_path(runtime_context))}",
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=15,
        log_output_on_success=True,
    )
    if result_exit_code(supervisor_config_check) == 0:
        label = "relaunch_runtime_supervisor"
        command = build_detached_supervisor_launch_command(runtime_context)
    else:
        await _ensure_launcher_defers_startup_retention(
            provider,
            sandbox,
            runtime_context,
            workspace_id,
        )
        label = "relaunch_runtime_nohup_legacy"
        command = build_detached_runtime_launch_command(runtime_context)

    start_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label=label,
        command=command,
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    if result_exit_code(start_result) != 0:
        stderr = result_stderr(start_result) or result_stdout(start_result)
        raise CloudRuntimeReconnectError(f"Cloud runtime relaunch failed: {stderr.strip()[:400]}")


async def refresh_worker_enrollment_for_runtime(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    *,
    environment: CloudRuntimeEnvironment,
    sandbox_record: object,
    workspace_id: UUID,
    access_token: str,
) -> None:
    sandbox_profile_id = getattr(sandbox_record, "sandbox_profile_id", None)
    target_id = getattr(sandbox_record, "target_id", None)
    if sandbox_profile_id is None or target_id is None:
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch cannot refresh worker enrollment without target identity."
        )
    if environment.target_id != target_id:
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch target does not match the active sandbox."
        )

    cloud_base_url = await cloud_base_url_for_worker_relaunch(
        provider,
        sandbox,
        runtime_context,
        workspace_id,
    )

    supervisor_config_check = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="check_runtime_supervisor_config_for_worker_refresh",
        command=f"test -f {shlex.quote(supervisor_config_path(runtime_context))}",
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=15,
        log_output_on_success=True,
    )
    if result_exit_code(supervisor_config_check) != 0:
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch cannot refresh worker enrollment for a legacy "
            "launcher sandbox."
        )

    enrollment = await ensure_runtime_target_enrollment(
        user_id=environment.user_id,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    if enrollment is None:
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch could not create a worker enrollment."
        )

    config_path = worker_config_path(runtime_context)
    worker_dir = str(PurePosixPath(config_path).parent)
    supervisor_dir = str(PurePosixPath(supervisor_config_path(runtime_context)).parent)
    _raise_reconnect_on_command_failure(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="stop_existing_supervised_runtime_for_worker_refresh",
            command=build_supervised_runtime_stop_command(runtime_context),
            runtime_context=runtime_context,
            cwd=runtime_context.runtime_workdir,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed runtime relaunch could not stop existing worker processes",
    )
    db_paths = " ".join(shlex.quote(path) for path in worker_db_sidecar_paths(runtime_context))
    _raise_reconnect_on_command_failure(
        await run_sandbox_command_logged(
            provider,
            sandbox,
            workspace_id=workspace_id,
            label="refresh_worker_enrollment_state",
            command=(
                f"mkdir -p {shlex.quote(worker_dir)} {shlex.quote(supervisor_dir)} "
                f"&& chmod 700 {shlex.quote(worker_dir)} {shlex.quote(supervisor_dir)} "
                f"&& rm -f {db_paths}"
            ),
            runtime_context=runtime_context,
            timeout_seconds=30,
        ),
        "Managed runtime relaunch could not reset worker enrollment state",
    )
    await provider.write_file(
        sandbox,
        config_path,
        build_worker_config(
            cloud_base_url=cloud_base_url,
            enrollment_token=enrollment.enrollment_token,
            anyharness_base_url=local_anyharness_base_url(provider),
            anyharness_bearer_token=access_token,
            runtime_context=runtime_context,
        ),
    )
    chmod_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace_id,
        label="chmod_refreshed_worker_config",
        command=f"chmod 600 {shlex.quote(config_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    if result_exit_code(chmod_result) != 0:
        stderr = result_stderr(chmod_result) or result_stdout(chmod_result)
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch could not secure refreshed worker config: "
            f"{stderr.strip()[:400]}"
        )
