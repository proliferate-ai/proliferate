"""On-demand connection and recovery for persistent cloud sandboxes."""

from __future__ import annotations

from uuid import UUID

from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.cloud_workspaces import (
    load_active_sandbox_for_workspace,
    persist_runtime_reconnect_state_for_workspace,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxProviderKind,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.cloud.runtime.anyharness_api import (
    CloudRuntimeReconnectError,
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    build_detached_runtime_launch_command,
    collect_runtime_debug_report,
    result_exit_code,
    result_stderr,
    result_stdout,
    run_sandbox_command_logged,
)

_DEFAULT_ENDPOINT_HEALTH_ATTEMPTS = 4
_DEFAULT_ENDPOINT_HEALTH_DELAY_SECONDS = 0.5
_DEFAULT_RESTART_HEALTH_ATTEMPTS = 12
_DEFAULT_RESTART_HEALTH_DELAY_SECONDS = 0.5
_DAYTONA_ENDPOINT_HEALTH_ATTEMPTS = 30
_DAYTONA_ENDPOINT_HEALTH_DELAY_SECONDS = 1.0
_DAYTONA_RESTART_HEALTH_ATTEMPTS = 45
_DAYTONA_RESTART_HEALTH_DELAY_SECONDS = 1.0


async def _relaunch_runtime(
    provider: SandboxProvider,
    sandbox: object,
    runtime_context: SandboxRuntimeContext,
    workspace: CloudWorkspace,
) -> None:
    start_result = await run_sandbox_command_logged(
        provider,
        sandbox,
        workspace_id=workspace.id,
        label="relaunch_runtime_nohup",
        command=build_detached_runtime_launch_command(runtime_context),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    if result_exit_code(start_result) != 0:
        stderr = result_stderr(start_result) or result_stdout(start_result)
        raise CloudRuntimeReconnectError(f"Cloud runtime relaunch failed: {stderr.strip()[:400]}")


def _is_daytona_provider(provider_kind: str | SandboxProviderKind) -> bool:
    return provider_kind == SandboxProviderKind.daytona or provider_kind == "daytona"


def _endpoint_health_wait_config(provider_kind: str | SandboxProviderKind) -> tuple[int, float]:
    if _is_daytona_provider(provider_kind):
        return _DAYTONA_ENDPOINT_HEALTH_ATTEMPTS, _DAYTONA_ENDPOINT_HEALTH_DELAY_SECONDS
    return _DEFAULT_ENDPOINT_HEALTH_ATTEMPTS, _DEFAULT_ENDPOINT_HEALTH_DELAY_SECONDS


def _restart_health_wait_config(provider_kind: str | SandboxProviderKind) -> tuple[int, float]:
    if _is_daytona_provider(provider_kind):
        return _DAYTONA_RESTART_HEALTH_ATTEMPTS, _DAYTONA_RESTART_HEALTH_DELAY_SECONDS
    return _DEFAULT_RESTART_HEALTH_ATTEMPTS, _DEFAULT_RESTART_HEALTH_DELAY_SECONDS


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
    if sandbox_state.state not in {"running", "started"}:
        raise CloudRuntimeReconnectError("Cloud workspace sandbox is paused or unavailable.")
    try:
        sandbox = await provider.connect_running_sandbox(
            sandbox_record.external_sandbox_id,
            timeout_seconds=None,
        )
    except Exception as exc:
        raise CloudRuntimeReconnectError("Failed to reconnect to the cloud sandbox.") from exc

    endpoint = await provider.resolve_runtime_endpoint(sandbox)
    # Daytona preview URLs are signed and may rotate even while the same
    # sandbox and AnyHarness process remain healthy. Probe the fresh endpoint
    # before deciding that the runtime itself needs a restart.
    endpoint_probe_attempts, endpoint_probe_delay_seconds = _endpoint_health_wait_config(
        sandbox_record.provider,
    )
    if await _runtime_is_ready(
        endpoint.runtime_url,
        workspace_id=workspace.id,
        access_token=access_token,
        total_attempts=endpoint_probe_attempts,
        delay_seconds=endpoint_probe_delay_seconds,
    ):
        if endpoint.runtime_url != workspace.runtime_url:
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
    await _relaunch_runtime(provider, sandbox, runtime_context, workspace)
    restart_probe_attempts, restart_probe_delay_seconds = _restart_health_wait_config(
        sandbox_record.provider,
    )
    try:
        await wait_for_runtime_health(
            endpoint.runtime_url,
            workspace_id=workspace.id,
            required_successes=1,
            total_attempts=restart_probe_attempts,
            delay_seconds=restart_probe_delay_seconds,
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
