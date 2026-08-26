"""Launch AnyHarness runtime topology inside a provider sandbox.

Only one launch topology exists: Supervisor-owned (Supervisor spawns and
supervises AnyHarness and the Worker itself). The legacy direct-nohup'd
AnyHarness plus a separately launched Worker sidecar was deleted once the
live E2B N-1->N update proof (2026-07-26) and the D5 BRIDGE proof
(2026-07-26, sandbox iwwvadhffzxoora56f437) both passed. The
``supervisor_owned_runtime`` flag and the D5 bridge signal it gated died
later, with the cull sweep's delete-worker-legacy track — there is no
launch-topology lever of any kind anymore.
"""

from __future__ import annotations

import logging
import shlex
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProvider,
    SandboxRuntimeContext,
)
from proliferate.server.cloud.cloud_sandboxes.transactions import run_with_fresh_session
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_runtime_env,
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
    run_sandbox_command_logged,
)
from proliferate.server.event_logging import log_cloud_event
from proliferate.server.seam.workers.service import (
    create_cloud_sandbox_enrollment,
    worker_cloud_base_url,
)


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


async def mint_cloud_sandbox_worker_enrollment(sandbox_record: CloudSandboxValue) -> str | None:
    """Mint (and durably commit) a fresh worker enrollment token for a sandbox.

    Returns ``None`` when the sandbox has no owner (defensive; the column is
    NOT NULL in practice). Runs in its own transaction/session so the token
    is durably visible before the Supervisor's Worker child (a separate
    process) tries to consume it.
    """
    owner_user_id = sandbox_record.owner_user_id
    if owner_user_id is None:
        return None
    enrollment_token = ""

    async def _mint(fresh_db: AsyncSession) -> None:
        nonlocal enrollment_token
        enrollment_token = await create_cloud_sandbox_enrollment(
            fresh_db,
            cloud_sandbox_id=sandbox_record.id,
            owner_user_id=owner_user_id,
            organization_id=sandbox_record.organization_id,
        )

    await run_with_fresh_session(_mint)
    return enrollment_token


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
    """Launch Supervisor, which owns the AnyHarness and Worker children.

    The only launch topology: Supervisor spawns and supervises AnyHarness and
    the Worker itself, so there is no separate Worker-sidecar launch here. The
    caller persists exact-attempt access.
    """

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
        # crash-loop, not a quiet no-worker runtime.
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
