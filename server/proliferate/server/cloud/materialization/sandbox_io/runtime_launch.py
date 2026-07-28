"""Launch AnyHarness runtime topology inside a provider sandbox."""

from __future__ import annotations

import logging
import shlex
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProvider,
    SandboxRuntimeContext,
)
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.materialization.sandbox_io.worker_sidecar import (
    launch_worker_sidecar,
    mint_cloud_sandbox_worker_enrollment,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_runtime_env,
    build_runtime_launch_script,
    build_supervised_runtime_stop_command,
    build_supervisor_config,
    build_worker_config,
    supervisor_binary_path,
    supervisor_config_path,
    worker_config_path,
)
from proliferate.server.cloud.runtime.liveness_health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.server.cloud.runtime_workers.service import worker_cloud_base_url


async def _resolve_owner_organization_id(
    db: AsyncSession,
    sandbox: CloudSandboxValue,
) -> UUID | None:
    """Resolve the owning organization for best-effort observability tags."""

    if sandbox.organization_id is not None:
        return sandbox.organization_id
    if sandbox.owner_user_id is None:
        return None
    try:
        record = await organizations_store.get_current_membership_for_user(
            db, sandbox.owner_user_id
        )
    except Exception:  # noqa: BLE001 - identity tagging is best-effort.
        await db.rollback()
        return None
    return record.organization.id if record is not None else None


async def launch_anyharness_runtime(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    provider_sandbox_id: str,
    sandbox_record: CloudSandboxValue,
    endpoint: RuntimeEndpoint,
    runtime_context: SandboxRuntimeContext,
    runtime_token: str,
    anyharness_data_key: str,
) -> None:
    """Launch the configured topology; the caller persists exact-attempt access."""

    if settings.supervisor_owned_runtime:
        await _launch_supervisor_owned_runtime(
            db,
            provider=provider,
            provider_sandbox=provider_sandbox,
            provider_sandbox_id=provider_sandbox_id,
            sandbox_record=sandbox_record,
            endpoint=endpoint,
            runtime_context=runtime_context,
            runtime_token=runtime_token,
            anyharness_data_key=anyharness_data_key,
        )
        return

    launcher_path = runtime_launcher_path(runtime_context)
    organization_id = await _resolve_owner_organization_id(db, sandbox_record)
    # End the optional identity lookup before the first provider side effect.
    await db.commit()
    # A resumed sandbox can retain an old runtime bound to the port with a stale
    # token. The scoped stop command targets only managed binary paths.
    await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_stop_stale_runtime",
        command=build_supervised_runtime_stop_command(runtime_context),
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    await provider.write_file(
        provider_sandbox,
        launcher_path,
        build_runtime_launch_script(
            provider,
            runtime_context,
            build_runtime_env(
                runtime_token,
                anyharness_data_key=anyharness_data_key,
                target_id=sandbox_record.id,
                organization_id=organization_id,
                sandbox_id=provider_sandbox_id,
                user_id=sandbox_record.owner_user_id,
            ),
        ),
    )
    chmod_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_chmod_anyharness_launcher",
        command=f"chmod 700 {shlex.quote(launcher_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(chmod_result, "AnyHarness launcher chmod failed")

    start_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_launch_anyharness",
        command=build_detached_runtime_launch_command(runtime_context),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    assert_command_succeeded(start_result, "AnyHarness launch failed")
    await wait_for_runtime_health(
        endpoint.runtime_url,
        workspace_id=sandbox_record.id,
        total_attempts=30,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        runtime_token,
        workspace_id=sandbox_record.id,
    )
    await launch_worker_sidecar(
        provider=provider,
        provider_sandbox=provider_sandbox,
        sandbox_record=sandbox_record,
        runtime_context=runtime_context,
        runtime_bearer_token=runtime_token,
    )


async def _launch_supervisor_owned_runtime(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    provider_sandbox_id: str,
    sandbox_record: CloudSandboxValue,
    endpoint: RuntimeEndpoint,
    runtime_context: SandboxRuntimeContext,
    runtime_token: str,
    anyharness_data_key: str,
) -> None:
    """Launch Supervisor, which owns the AnyHarness and Worker children."""

    organization_id = await _resolve_owner_organization_id(db, sandbox_record)
    # End the optional identity lookup before the first provider side effect.
    await db.commit()
    await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_stop_stale_runtime",
        command=build_supervised_runtime_stop_command(runtime_context),
        runtime_context=runtime_context,
        timeout_seconds=30,
        log_output_on_success=True,
    )

    cloud_base_url = worker_cloud_base_url()
    if not cloud_base_url:
        # Matches the legacy sidecar's warning (worker_sidecar.py) -- but only
        # the warning, not the behavior. The legacy sidecar warns and then
        # SKIPS launching the worker entirely (see launch_worker_sidecar:
        # `if not cloud_base_url: ... return`), so a misconfigured deploy just
        # runs AnyHarness with no worker. There is no equivalent skip here:
        # `SupervisorConfig.worker_binary`/`worker_config` in
        # anyharness/crates/proliferate-supervisor/src/config.rs are plain
        # (non-Option, no #[serde(default)]) fields, and `run()` in
        # anyharness/crates/proliferate-supervisor/src/process/mod.rs
        # unconditionally calls `spawn_worker` inside the AnyHarness
        # generation loop -- there is no supervisor-config shape that omits
        # the worker. So with an empty base URL the Supervisor still spawns a
        # Worker child that bakes in that empty base URL, fails to enroll
        # immediately, exits, and gets respawned by the Supervisor's restart
        # loop (`restart_delay_seconds`, default 5s) FOREVER -- a permanent
        # crash-loop, not a quiet no-worker runtime like the legacy path.
        # Warn loudly instead of silently shipping a runtime that will
        # crash-loop a child; do not fail the whole materialization over it.
        log_cloud_event(
            "cloud supervisor-owned launch proceeding with no cloud base URL "
            "configured (set CLOUD_WORKER_BASE_URL or API_BASE_URL); the "
            "Worker the Supervisor spawns will be unable to enroll",
            level=logging.WARNING,
            cloud_sandbox_id=str(sandbox_record.id),
        )
    enrollment_token = await mint_cloud_sandbox_worker_enrollment(sandbox_record) or ""
    anyharness_env = build_runtime_env(
        runtime_token,
        anyharness_data_key=anyharness_data_key,
        target_id=sandbox_record.id,
        organization_id=organization_id,
        sandbox_id=provider_sandbox_id,
        user_id=sandbox_record.owner_user_id,
    )
    supervisor_config_toml = build_supervisor_config(
        provider,
        runtime_context,
        anyharness_env,
        organization_id=organization_id,
        sandbox_id=provider_sandbox_id,
        user_id=sandbox_record.owner_user_id,
    )
    worker_config_file = worker_config_path(runtime_context)
    supervisor_config_file = supervisor_config_path(runtime_context)
    await provider.write_file(
        provider_sandbox,
        worker_config_file,
        build_worker_config(
            cloud_base_url=cloud_base_url,
            enrollment_token=enrollment_token,
            runtime_context=runtime_context,
            runtime_bearer_token=runtime_token,
            supervisor_owned=True,
            supervisor_config_toml=supervisor_config_toml,
        ),
    )
    await provider.write_file(
        provider_sandbox,
        supervisor_config_file,
        supervisor_config_toml,
    )
    chmod_config_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_chmod_supervisor_configs",
        command=(
            f"chmod 600 {shlex.quote(worker_config_file)} {shlex.quote(supervisor_config_file)}"
        ),
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(chmod_config_result, "Supervisor config chmod failed")

    start_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_launch_supervisor",
        command=build_detached_supervisor_launch_command(
            runtime_context,
            organization_id=organization_id,
            sandbox_id=provider_sandbox_id,
            user_id=sandbox_record.owner_user_id,
        ),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    assert_command_succeeded(start_result, "Supervisor launch failed")
    try:
        await wait_for_runtime_health(
            endpoint.runtime_url,
            workspace_id=sandbox_record.id,
            total_attempts=30,
            delay_seconds=0.5,
        )
    except CloudRuntimeReconnectError:
        # The launch command above exits 0 even when its `test -x` guard
        # found no supervisor binary (e.g. a paused VM resumed from a
        # template baked before the supervisor binary existed) -- that
        # failure mode surfaces here, as a health timeout, with no other
        # signal. Log a distinct hint so triage doesn't default to "runtime
        # was just slow to boot" on a target that was never going to boot.
        log_cloud_event(
            "cloud supervisor health probe timed out after launch; possible "
            "causes include a missing/stale supervisor binary on this "
            "sandbox's template (the launch command's `test -x` guard would "
            "have silently no-op'd) in addition to ordinary slow boot",
            level=logging.WARNING,
            cloud_sandbox_id=str(sandbox_record.id),
            supervisor_binary_path=supervisor_binary_path(runtime_context),
        )
        raise
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        runtime_token,
        workspace_id=sandbox_record.id,
    )
