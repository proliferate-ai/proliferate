"""On-demand connection and recovery for persistent cloud sandboxes."""

from __future__ import annotations

from uuid import UUID

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_runtime_environments import save_runtime_environment_state
from proliferate.db.store.cloud_sandboxes import (
    load_active_sandbox_for_workspace,
    load_cloud_sandbox_by_id,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspace_runtime import (
    persist_runtime_reconnect_state_for_workspace,
)
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import SandboxProvider, get_sandbox_provider
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
from proliferate.server.cloud.runtime.liveness.health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.liveness.relaunch import (
    refresh_worker_enrollment_for_runtime,
    relaunch_runtime,
)
from proliferate.server.cloud.runtime.sandbox_exec import collect_runtime_debug_report
from proliferate.server.cloud.runtime.target_registration import (
    wait_for_worker_target_fresh_heartbeat,
)
from proliferate.utils.time import utcnow


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
            db,
            workspace,
            sandbox_record,
            restarted_runtime=restarted_runtime,
            runtime_url=runtime_url,
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
    # Provider runtime URLs may rotate even while the same sandbox and
    # AnyHarness process remain healthy. Probe the fresh endpoint before
    # deciding that the runtime itself needs a restart.
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
    await relaunch_runtime(provider, sandbox, runtime_context, workspace.id)
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
                await _save_env_updates(
                    environment.id, runtime_endpoint_rotated_update(endpoint.runtime_url)
                )
            return endpoint.runtime_url
        if not allow_launcher_restart:
            raise CloudRuntimeReconnectError("Cloud runtime restart was requested but disallowed.")
        if should_persist_rotated_runtime_url(environment.runtime_url, endpoint.runtime_url):
            await _save_env_updates(
                environment.id, runtime_endpoint_rotated_update(endpoint.runtime_url)
            )

    if not allow_launcher_restart:
        raise CloudRuntimeReconnectError("Cloud runtime is unavailable in the existing sandbox.")

    runtime_context = await provider.resolve_runtime_context(sandbox)
    previous_worker_id = await _current_target_worker_id(environment.target_id)
    if refresh_worker_enrollment_on_restart:
        await refresh_worker_enrollment_for_runtime(
            provider,
            sandbox,
            runtime_context,
            environment=environment,
            sandbox_record=sandbox_record,
            workspace_id=workspace_id,
            access_token=access_token,
        )
    worker_restart_started_at = utcnow()
    await relaunch_runtime(provider, sandbox, runtime_context, workspace_id)
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
    await _save_env_updates(
        environment.id, runtime_process_relaunched_update(endpoint.runtime_url)
    )
    return endpoint.runtime_url
