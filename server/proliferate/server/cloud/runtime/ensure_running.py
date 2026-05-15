"""On-demand connection and recovery for persistent cloud sandboxes."""

from __future__ import annotations

import shlex
from uuid import UUID

from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_runtime_environments import save_runtime_environment_state
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
    supervisor_config_path,
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
    build_detached_runtime_launch_command,
    collect_runtime_debug_report,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
    runtime_launcher_path,
)

_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV = "ANYHARNESS_DEFER_STARTUP_RETENTION"


async def _ensure_launcher_defers_startup_retention(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    workspace_id: UUID,
) -> None:
    launcher = shlex.quote(runtime_launcher_path(runtime_context))
    sentinel = "# Managed by Proliferate: defer startup worktree retention"
    env_line = f"export {_ANYHARNESS_DEFER_STARTUP_RETENTION_ENV}=1"
    command = "sh -lc " + shlex.quote(
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

    sandbox_record = await load_active_sandbox_for_workspace(workspace)
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
            await persist_runtime_reconnect_state_for_workspace(
                workspace,
                sandbox_record,
                restarted_runtime=False,
                runtime_url=endpoint.runtime_url,
            )
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
    await persist_runtime_reconnect_state_for_workspace(
        workspace,
        sandbox_record,
        restarted_runtime=True,
        runtime_url=endpoint.runtime_url,
    )
    return endpoint.runtime_url


async def ensure_environment_runtime_ready(
    environment: CloudRuntimeEnvironment,
    *,
    workspace_id: UUID,
    allow_launcher_restart: bool,
    access_token: str,
) -> str:
    if not environment.active_sandbox_id:
        raise CloudRuntimeReconnectError("Cloud runtime environment does not have a sandbox.")

    if environment.runtime_url and await _runtime_is_ready(
        environment.runtime_url,
        workspace_id=workspace_id,
        access_token=access_token,
        total_attempts=2,
    ):
        return environment.runtime_url

    sandbox_record = await load_cloud_sandbox_by_id(environment.active_sandbox_id)
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
        if should_persist_rotated_runtime_url(environment.runtime_url, endpoint.runtime_url):
            await save_runtime_environment_state(
                environment.id,
                **runtime_endpoint_rotated_update(endpoint.runtime_url),
            )
        return endpoint.runtime_url

    if not allow_launcher_restart:
        raise CloudRuntimeReconnectError("Cloud runtime is unavailable in the existing sandbox.")

    runtime_context = await provider.resolve_runtime_context(sandbox)
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
    await save_runtime_environment_state(
        environment.id,
        **runtime_process_relaunched_update(endpoint.runtime_url),
    )
    return endpoint.runtime_url
