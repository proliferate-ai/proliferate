"""On-demand connection and recovery for persistent cloud sandboxes."""

from __future__ import annotations

import shlex
from pathlib import PurePosixPath
from urllib.parse import urlparse
from uuid import UUID

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_runtime_environments import save_runtime_environment_state
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspaces import (
    load_active_sandbox_for_workspace,
    load_cloud_sandbox_by_id,
    persist_runtime_reconnect_state_for_workspace,
)
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.cloud.runtime.anyharness_api import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_supervised_runtime_stop_command,
    build_worker_config,
    local_anyharness_base_url,
    supervisor_config_path,
    worker_config_path,
    worker_db_sidecar_paths,
)
from proliferate.server.cloud.runtime.domain.reconnect_policy import (
    SandboxReconnectAction,
    endpoint_health_wait_config,
    reconnect_action_for_sandbox_state,
    restart_health_wait_config,
    should_persist_rotated_runtime_url,
)
from proliferate.server.cloud.runtime.domain.runtime_state import (
    runtime_endpoint_rotated_update,
    runtime_process_relaunched_update,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    collect_runtime_debug_report,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.server.cloud.runtime.target_registration import (
    ensure_runtime_target_enrollment,
    wait_for_worker_target_fresh_heartbeat,
)
from proliferate.utils.time import utcnow

_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV = "ANYHARNESS_DEFER_STARTUP_RETENTION"
_LOCAL_CLOUD_BASE_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _is_local_cloud_base_url(value: str) -> bool:
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    return hostname in _LOCAL_CLOUD_BASE_HOSTS or hostname.endswith(".localhost")


def _cloud_base_url_for_worker_config() -> str:
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


async def _cloud_base_url_for_worker_relaunch(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    workspace_id: UUID,
) -> str:
    try:
        return _cloud_base_url_for_worker_config()
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


async def _relaunch_runtime(
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


async def _refresh_worker_enrollment_for_runtime(
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
    slot_generation = getattr(sandbox_record, "slot_generation", None)
    if sandbox_profile_id is None or target_id is None or slot_generation is None:
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch cannot refresh worker enrollment without slot identity."
        )
    if environment.target_id != target_id:
        raise CloudRuntimeReconnectError(
            "Managed runtime relaunch target does not match the active sandbox slot."
        )

    cloud_base_url = await _cloud_base_url_for_worker_relaunch(
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
        runtime_environment_id=environment.id,
        user_id=environment.user_id,
        display_name=f"Managed cloud: {environment.git_owner}/{environment.git_repo_name}",
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        cloud_sandbox_id=sandbox_record.id,
        slot_generation=slot_generation,
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


async def _current_target_worker_id(target_id: UUID | None) -> UUID | None:
    if target_id is None:
        return None
    async with db_engine.async_session_factory() as db:
        target = await targets_store.get_target_by_id(db, target_id)
    if target is None or target.status_record is None:
        return None
    return target.status_record.worker_id


async def _runtime_is_ready(
    runtime_url: str,
    *,
    workspace_id: UUID,
    access_token: str,
    total_attempts: int,
    delay_seconds: float = 0.5,
) -> bool:
    try:
        await wait_for_runtime_health(
            runtime_url,
            workspace_id=workspace_id,
            required_successes=1,
            total_attempts=total_attempts,
            delay_seconds=delay_seconds,
        )
        await verify_runtime_auth_enforced(
            runtime_url,
            access_token,
            workspace_id=workspace_id,
        )
    except CloudRuntimeReconnectError:
        return False
    return True


async def _connect_or_resume_sandbox(
    provider: SandboxProvider,
    sandbox_id: str,
    sandbox_state: str,
) -> object:
    reconnect_action = reconnect_action_for_sandbox_state(sandbox_state)
    if reconnect_action == SandboxReconnectAction.connect:
        try:
            return await provider.connect_running_sandbox(
                sandbox_id,
                timeout_seconds=None,
            )
        except Exception as exc:
            raise CloudRuntimeReconnectError("Failed to reconnect to the cloud sandbox.") from exc

    if reconnect_action == SandboxReconnectAction.resume:
        try:
            return await provider.resume_sandbox(
                sandbox_id,
                timeout_seconds=None,
            )
        except Exception as exc:
            raise CloudRuntimeReconnectError("Failed to resume the cloud sandbox.") from exc

    raise CloudRuntimeReconnectError("Cloud workspace sandbox is unavailable.")


async def _persist_reconnect(
    workspace: CloudWorkspace, sandbox_record: object, restarted_runtime: bool, runtime_url: str
) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await persist_runtime_reconnect_state_for_workspace(
            db, workspace, sandbox_record, restarted_runtime=restarted_runtime, runtime_url=runtime_url
        )


async def _save_env_updates(environment_id: UUID, updates: dict[str, object]) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await save_runtime_environment_state(db, environment_id, **updates)


async def ensure_workspace_runtime_ready(
    workspace: CloudWorkspace,
    *,
    allow_launcher_restart: bool,
    access_token: str,
) -> str:
    if not workspace.active_sandbox_id:
        raise CloudRuntimeReconnectError("Cloud workspace does not have a persisted sandbox.")

    # Fast path: reuse the last known runtime URL if it is still serving health
    # checks. This keeps ordinary connection reads side-effect free.
    if workspace.runtime_url and await _runtime_is_ready(
        workspace.runtime_url,
        workspace_id=workspace.id,
        access_token=access_token,
        total_attempts=2,
    ):
        return workspace.runtime_url

    async with db_engine.async_session_factory() as db:
        sandbox_record = await load_active_sandbox_for_workspace(db, workspace)
    if sandbox_record is None:
        raise CloudRuntimeReconnectError("Cloud workspace sandbox record was not found.")

    provider = get_sandbox_provider(sandbox_record.provider)
    if not sandbox_record.external_sandbox_id:
        raise CloudRuntimeReconnectError(
            "Cloud workspace sandbox does not have a provider id yet."
        )
    sandbox_state = await provider.get_sandbox_state(sandbox_record.external_sandbox_id)
    if sandbox_state is None:
        raise CloudRuntimeReconnectError("Cloud workspace sandbox could not be observed.")
    sandbox = await _connect_or_resume_sandbox(
        provider,
        sandbox_record.external_sandbox_id,
        sandbox_state.state,
    )

    endpoint = await provider.resolve_runtime_endpoint(sandbox)
    # Daytona preview URLs are signed and may rotate even while the same
    # sandbox and AnyHarness process remain healthy. Probe the fresh endpoint
    # before deciding that the runtime itself needs a restart.
    endpoint_probe = endpoint_health_wait_config(
        sandbox_record.provider,
    )
    if await _runtime_is_ready(
        endpoint.runtime_url,
        workspace_id=workspace.id,
        access_token=access_token,
        total_attempts=endpoint_probe.total_attempts,
        delay_seconds=endpoint_probe.delay_seconds,
    ):
        if should_persist_rotated_runtime_url(workspace.runtime_url, endpoint.runtime_url):
            await _persist_reconnect(workspace, sandbox_record, False, endpoint.runtime_url)
        return endpoint.runtime_url

    if not allow_launcher_restart:
        raise CloudRuntimeReconnectError("Cloud runtime is unavailable in the existing sandbox.")

    # Only the final recovery step actually relaunches AnyHarness inside the
    # sandbox. We do this after both the cached URL and the fresh provider URL
    # failed health checks.
    runtime_context = await provider.resolve_runtime_context(sandbox)
    await _relaunch_runtime(provider, sandbox, runtime_context, workspace.id)
    restart_probe = restart_health_wait_config(
        sandbox_record.provider,
    )
    try:
        await wait_for_runtime_health(
            endpoint.runtime_url,
            workspace_id=workspace.id,
            required_successes=1,
            total_attempts=restart_probe.total_attempts,
            delay_seconds=restart_probe.delay_seconds,
        )
    except CloudRuntimeReconnectError:
        debug_report = await collect_runtime_debug_report(
            provider,
            sandbox,
            workspace_id=workspace.id,
            runtime_context=runtime_context,
        )
        raise CloudRuntimeReconnectError(
            "Cloud runtime relaunch did not become healthy. "
            f"launcher={debug_report.get('launcher')} "
            f"log={debug_report.get('log')} "
            f"processes={debug_report.get('processes')}"
        ) from None
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        access_token,
        workspace_id=workspace.id,
    )
    await _persist_reconnect(workspace, sandbox_record, True, endpoint.runtime_url)
    return endpoint.runtime_url


async def ensure_environment_runtime_ready(
    environment: CloudRuntimeEnvironment,
    *,
    workspace_id: UUID,
    allow_launcher_restart: bool,
    access_token: str,
    force_launcher_restart: bool = False,
    refresh_worker_enrollment_on_restart: bool = False,
) -> str:
    if not environment.active_sandbox_id:
        raise CloudRuntimeReconnectError("Cloud runtime environment does not have a sandbox.")

    if (
        not force_launcher_restart
        and environment.runtime_url
        and await _runtime_is_ready(
            environment.runtime_url,
            workspace_id=workspace_id,
            access_token=access_token,
            total_attempts=2,
        )
    ):
        return environment.runtime_url

    async with db_engine.async_session_factory() as db:
        sandbox_record = await load_cloud_sandbox_by_id(db, environment.active_sandbox_id)
    if sandbox_record is None:
        raise CloudRuntimeReconnectError("Cloud runtime environment sandbox record was not found.")

    provider = get_sandbox_provider(sandbox_record.provider)
    if not sandbox_record.external_sandbox_id:
        raise CloudRuntimeReconnectError(
            "Cloud runtime environment sandbox does not have a provider id yet."
        )
    sandbox_state = await provider.get_sandbox_state(sandbox_record.external_sandbox_id)
    if sandbox_state is None:
        raise CloudRuntimeReconnectError(
            "Cloud runtime environment sandbox could not be observed."
        )
    sandbox = await _connect_or_resume_sandbox(
        provider,
        sandbox_record.external_sandbox_id,
        sandbox_state.state,
    )

    endpoint = await provider.resolve_runtime_endpoint(sandbox)
    endpoint_probe = endpoint_health_wait_config(
        sandbox_record.provider,
    )
    if await _runtime_is_ready(
        endpoint.runtime_url,
        workspace_id=workspace_id,
        access_token=access_token,
        total_attempts=endpoint_probe.total_attempts,
        delay_seconds=endpoint_probe.delay_seconds,
    ):
        if not force_launcher_restart:
            if should_persist_rotated_runtime_url(environment.runtime_url, endpoint.runtime_url):
                await _save_env_updates(environment.id, runtime_endpoint_rotated_update(endpoint.runtime_url))
            return endpoint.runtime_url
        if not allow_launcher_restart:
            raise CloudRuntimeReconnectError("Cloud runtime restart was requested but disallowed.")
        if should_persist_rotated_runtime_url(environment.runtime_url, endpoint.runtime_url):
            await _save_env_updates(environment.id, runtime_endpoint_rotated_update(endpoint.runtime_url))

    if not allow_launcher_restart:
        raise CloudRuntimeReconnectError("Cloud runtime is unavailable in the existing sandbox.")

    runtime_context = await provider.resolve_runtime_context(sandbox)
    previous_worker_id = await _current_target_worker_id(environment.target_id)
    if refresh_worker_enrollment_on_restart:
        await _refresh_worker_enrollment_for_runtime(
            provider,
            sandbox,
            runtime_context,
            environment=environment,
            sandbox_record=sandbox_record,
            workspace_id=workspace_id,
            access_token=access_token,
        )
    worker_restart_started_at = utcnow()
    await _relaunch_runtime(provider, sandbox, runtime_context, workspace_id)
    restart_probe = restart_health_wait_config(
        sandbox_record.provider,
    )
    try:
        await wait_for_runtime_health(
            endpoint.runtime_url,
            workspace_id=workspace_id,
            required_successes=1,
            total_attempts=restart_probe.total_attempts,
            delay_seconds=restart_probe.delay_seconds,
        )
    except CloudRuntimeReconnectError:
        debug_report = await collect_runtime_debug_report(
            provider,
            sandbox,
            workspace_id=workspace_id,
            runtime_context=runtime_context,
        )
        raise CloudRuntimeReconnectError(
            "Cloud runtime relaunch did not become healthy. "
            f"launcher={debug_report.get('launcher')} "
            f"log={debug_report.get('log')} "
            f"processes={debug_report.get('processes')}"
        ) from None
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        access_token,
        workspace_id=workspace_id,
    )
    if refresh_worker_enrollment_on_restart and environment.target_id is not None:
        await wait_for_worker_target_fresh_heartbeat(
            environment.target_id,
            workspace_id=workspace_id,
            not_before=worker_restart_started_at,
            previous_worker_id=previous_worker_id,
        )
    await _save_env_updates(environment.id, runtime_process_relaunched_update(endpoint.runtime_url))
    return endpoint.runtime_url
