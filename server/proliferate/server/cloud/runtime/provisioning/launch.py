"""Runtime launch support for cloud workspace provisioning."""

from __future__ import annotations

import asyncio
import secrets
import shlex
from collections.abc import Awaitable, Callable
from datetime import timedelta
from pathlib import PurePosixPath
from uuid import UUID

from proliferate.constants.cloud import (
    CLOUD_TARGET_HEARTBEAT_STALE_SECONDS,
    CloudTargetStatus,
    CloudWorkspaceStatus,
)
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.integrations.sandbox import SandboxProvider
from proliferate.server.cloud.agent_auth.service import (
    request_agent_auth_refresh_for_profile_target,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_runtime_env,
    build_supervisor_config,
    build_worker_config,
    local_anyharness_base_url,
    supervisor_config_path,
    worker_config_path,
)
from proliferate.server.cloud.runtime.config_sync.runtime_config import apply_remote_runtime_config
from proliferate.server.cloud.runtime.config_sync.worktree_policy import (
    sync_cloud_worktree_policy_to_runtime,
)
from proliferate.server.cloud.runtime.liveness.health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.models import (
    CloudProvisionInput,
    ConnectedSandbox,
    ProvisionStep,
    RuntimeHandshake,
)
from proliferate.server.cloud.runtime.provisioning.step_tracker import ProvisionStepTracker
from proliferate.server.cloud.runtime.provisioning.workspace import prepare_workspace_in_runtime
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    run_sandbox_command_logged,
)
from proliferate.server.cloud.runtime.target_registration import ensure_runtime_target_enrollment
from proliferate.server.cloud.runtime.wake import run_managed_target_wake_job
from proliferate.server.cloud.runtime_config.service import (
    refresh_profile_runtime_config,
    runtime_config_apply_request_for_revision,
)
from proliferate.utils.time import utcnow

SetWorkspaceStatus = Callable[..., Awaitable[None]]
LogRuntimeDiagnostics = Callable[..., Awaitable[None]]


async def launch_supervised_runtime_bundle(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    runtime_env: dict[str, str],
    runtime_token: str,
    cloud_base_url: str,
) -> UUID:
    enrollment = await ensure_runtime_target_enrollment(
        user_id=ctx.user_id,
        sandbox_profile_id=ctx.sandbox_profile_id,
        target_id=ctx.target_id,
    )
    if enrollment is None:
        raise RuntimeError("Cloud runtime environment disappeared before worker enrollment.")

    tracker.begin(ProvisionStep.start_runtime_process, target_id=str(enrollment.target_id))
    config_path = worker_config_path(connected.runtime_context)
    supervisor_path = supervisor_config_path(connected.runtime_context)
    await run_sandbox_command_logged(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        label="mkdir_runtime_bundle_config_dirs",
        command=(
            f"mkdir -p {shlex.quote(str(PurePosixPath(config_path).parent))} "
            f"{shlex.quote(str(PurePosixPath(supervisor_path).parent))} "
            f"&& chmod 700 {shlex.quote(str(PurePosixPath(config_path).parent))} "
            f"{shlex.quote(str(PurePosixPath(supervisor_path).parent))}"
        ),
        runtime_context=connected.runtime_context,
        timeout_seconds=30,
    )
    await provider.write_file(
        connected.sandbox,
        config_path,
        build_worker_config(
            cloud_base_url=cloud_base_url,
            enrollment_token=enrollment.enrollment_token,
            anyharness_base_url=local_anyharness_base_url(provider),
            anyharness_bearer_token=runtime_token,
            runtime_context=connected.runtime_context,
        ),
    )
    await provider.write_file(
        connected.sandbox,
        supervisor_path,
        build_supervisor_config(provider, connected.runtime_context, runtime_env),
    )
    await run_sandbox_command_logged(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        label="chmod_runtime_bundle_configs",
        command=f"chmod 600 {shlex.quote(config_path)} {shlex.quote(supervisor_path)}",
        runtime_context=connected.runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            connected.sandbox,
            workspace_id=ctx.workspace_id,
            label="launch_runtime_supervisor",
            command=build_detached_supervisor_launch_command(connected.runtime_context),
            runtime_context=connected.runtime_context,
            cwd=connected.runtime_context.runtime_workdir,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Cloud supervised runtime launch failed",
    )
    tracker.complete(target_id=str(enrollment.target_id))
    return enrollment.target_id


async def launch_and_connect_runtime(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    cloud_base_url: str,
    set_workspace_status: SetWorkspaceStatus,
    log_runtime_diagnostics: LogRuntimeDiagnostics,
) -> tuple[ConnectedSandbox, RuntimeHandshake]:
    runtime_token = secrets.token_urlsafe(32)
    runtime_env = build_runtime_env(
        runtime_token,
        anyharness_data_key=ctx.anyharness_data_key,
        target_id=ctx.target_id,
        repo_env_vars=ctx.repo_env_vars,
    )

    target_id = await launch_supervised_runtime_bundle(
        tracker,
        ctx,
        provider,
        connected,
        runtime_env=runtime_env,
        runtime_token=runtime_token,
        cloud_base_url=cloud_base_url,
    )

    connected = ConnectedSandbox(
        handle=connected.handle,
        sandbox=connected.sandbox,
        endpoint=await provider.resolve_runtime_endpoint(connected.sandbox),
        runtime_context=connected.runtime_context,
    )

    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Waiting for AnyHarness health",
    )
    tracker.begin(
        ProvisionStep.wait_for_runtime_health,
        runtime_url=connected.endpoint.runtime_url,
    )
    try:
        await wait_for_runtime_health(
            connected.endpoint.runtime_url,
            workspace_id=ctx.workspace_id,
            required_successes=1,
            total_attempts=30,
            delay_seconds=0.5,
        )
    except Exception:
        await log_runtime_diagnostics(
            "cloud runtime launch diagnostics",
            provider=provider,
            connected=connected,
            workspace_id=ctx.workspace_id,
        )
        raise
    tracker.complete(runtime_url=connected.endpoint.runtime_url)
    await verify_runtime_auth_enforced(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
    )
    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Waiting for Proliferate Worker enrollment",
    )
    tracker.begin(ProvisionStep.start_worker_process, target_id=str(target_id))
    try:
        await wait_for_worker_target_online(target_id, workspace_id=ctx.workspace_id)
    except Exception:
        await log_runtime_diagnostics(
            "cloud worker enrollment diagnostics",
            provider=provider,
            connected=connected,
            workspace_id=ctx.workspace_id,
        )
        raise
    tracker.complete(target_id=str(target_id))
    await request_agent_auth_refresh_and_wait(
        tracker,
        ctx,
        reason="workspace_provision",
        force_restart=False,
        set_workspace_status=set_workspace_status,
    )
    await refresh_runtime_config_and_apply(
        tracker,
        ctx,
        runtime_url=connected.endpoint.runtime_url,
        access_token=runtime_token,
        reason="workspace_provision",
        set_workspace_status=set_workspace_status,
    )
    await sync_cloud_worktree_policy_to_runtime(
        user_id=ctx.user_id,
        runtime_url=connected.endpoint.runtime_url,
        access_token=runtime_token,
        workspace_id=ctx.workspace_id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )

    handshake = await prepare_workspace_in_runtime(
        tracker,
        ctx,
        provider,
        connected,
        runtime_token=runtime_token,
        set_workspace_status=set_workspace_status,
    )

    return connected, handshake


def target_has_current_worker(target: targets_store.CloudTargetSnapshot | None) -> bool:
    if (
        target is None
        or target.status != CloudTargetStatus.online.value
        or target.status_record is None
        or target.status_record.worker_id is None
        or target.status_record.last_heartbeat_at is None
        or target.current_versions is None
        or not target.current_versions.anyharness_version
        or not target.current_versions.worker_version
        or not target.current_versions.supervisor_version
    ):
        return False

    stale_before = utcnow() - timedelta(seconds=CLOUD_TARGET_HEARTBEAT_STALE_SECONDS)
    return target.status_record.last_heartbeat_at > stale_before


async def wake_reused_runtime_if_worker_stale(
    ctx: CloudProvisionInput,
    *,
    set_workspace_status: SetWorkspaceStatus,
) -> bool:
    async with db_engine.async_session_factory() as db:
        target = await targets_store.get_target_by_id(db, ctx.target_id)
    if target_has_current_worker(target):
        return False

    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Restarting cloud runtime worker",
    )
    await run_managed_target_wake_job(ctx.target_id, command_id=None)
    return True


async def wait_for_worker_target_online(
    target_id: UUID,
    *,
    workspace_id: UUID,
    total_attempts: int = 90,
    delay_seconds: float = 0.5,
) -> None:
    last_status = "missing"
    last_detail: str | None = None
    last_heartbeat_at = None
    last_anyharness_version: str | None = None
    last_worker_version: str | None = None
    last_supervisor_version: str | None = None
    for _attempt in range(max(1, total_attempts)):
        async with db_engine.async_session_factory() as db:
            target = await targets_store.get_target_by_id(db, target_id)
        if target is not None:
            last_status = target.status
            last_detail = target.status_record.status_detail if target.status_record else None
            last_heartbeat_at = (
                target.status_record.last_heartbeat_at if target.status_record else None
            )
            if target.current_versions is not None:
                last_anyharness_version = target.current_versions.anyharness_version
                last_worker_version = target.current_versions.worker_version
                last_supervisor_version = target.current_versions.supervisor_version
            else:
                last_anyharness_version = None
                last_worker_version = None
                last_supervisor_version = None
            if target_has_current_worker(target):
                return
        await asyncio.sleep(delay_seconds)

    raise RuntimeError(
        "Proliferate Worker did not report an online AnyHarness runtime "
        f"for target {target_id}; last_status={last_status}; "
        f"last_detail={last_detail or '<none>'}; "
        f"last_heartbeat_at={last_heartbeat_at.isoformat() if last_heartbeat_at else '<none>'}; "
        f"last_anyharness_version={last_anyharness_version or '<none>'}; "
        f"last_worker_version={last_worker_version or '<none>'}; "
        f"last_supervisor_version={last_supervisor_version or '<none>'}."
    )


async def wait_for_agent_auth_target_current(
    ctx: CloudProvisionInput,
    *,
    total_attempts: int = 120,
    delay_seconds: float = 0.5,
) -> None:
    last_status = "missing"
    last_applied_revision: int | None = None
    last_error: str | None = None
    for _attempt in range(max(1, total_attempts)):
        async with db_engine.async_session_factory() as db:
            state = await agent_auth_store.get_target_state(
                db,
                sandbox_profile_id=ctx.sandbox_profile_id,
                target_id=ctx.target_id,
            )
        if state is not None:
            last_status = state.status
            last_applied_revision = state.applied_revision
            last_error = state.last_error_message
            if state.status == "failed":
                raise CloudApiError(
                    "agent_auth_apply_failed",
                    state.last_error_message or "Agent authentication failed to apply.",
                    status_code=409,
                )
            if (
                state.status == "applied"
                and state.applied_revision is not None
                and state.applied_revision >= ctx.required_agent_auth_revision
                and not state.force_restart_required
            ):
                return
        await asyncio.sleep(delay_seconds)

    raise RuntimeError(
        "Agent auth target state did not become current "
        f"for target {ctx.target_id}; last_status={last_status}; "
        f"last_applied_revision={last_applied_revision}; "
        f"required_revision={ctx.required_agent_auth_revision}; "
        f"last_error={last_error or '<none>'}."
    )


async def request_agent_auth_refresh_and_wait(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    *,
    reason: str,
    force_restart: bool,
    set_workspace_status: SetWorkspaceStatus,
) -> None:
    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Applying agent authentication",
    )
    tracker.begin(
        ProvisionStep.apply_agent_auth,
        target_id=str(ctx.target_id),
        revision=ctx.required_agent_auth_revision,
    )
    async with db_engine.async_session_factory() as db, db.begin():
        await request_agent_auth_refresh_for_profile_target(
            db,
            sandbox_profile_id=ctx.sandbox_profile_id,
            target_id=ctx.target_id,
            actor_user_id=ctx.user_id,
            reason=reason,
            force_restart=force_restart,
        )
    await wait_for_agent_auth_target_current(ctx)
    tracker.complete(target_id=str(ctx.target_id), revision=ctx.required_agent_auth_revision)


async def refresh_runtime_config_and_apply(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    *,
    runtime_url: str,
    access_token: str,
    reason: str,
    set_workspace_status: SetWorkspaceStatus,
) -> None:
    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Applying MCPs and skills",
    )
    tracker.begin(
        ProvisionStep.apply_runtime_config,
        target_id=str(ctx.target_id),
        sandbox_profile_id=str(ctx.sandbox_profile_id),
    )
    async with db_engine.async_session_factory() as db, db.begin():
        status = await refresh_profile_runtime_config(
            db,
            sandbox_profile_id=ctx.sandbox_profile_id,
            actor_user_id=ctx.user_id,
            reason=reason,
        )
        if status.current_revision is None:
            raise CloudApiError(
                "runtime_config_missing",
                "Runtime config could not be compiled for the cloud sandbox.",
                status_code=409,
            )
        revision_id = UUID(status.current_revision.revision_id)
        body = await runtime_config_apply_request_for_revision(
            db,
            revision_id=revision_id,
            target_id=ctx.target_id,
        )
    await apply_remote_runtime_config(
        runtime_url,
        access_token,
        body,
        workspace_id=ctx.workspace_id,
    )
    async with db_engine.async_session_factory() as db, db.begin():
        target = await targets_store.get_target_by_id(db, ctx.target_id)
        worker_id = target.status_record.worker_id if target and target.status_record else None
        if worker_id is None:
            raise CloudApiError(
                "runtime_config_worker_missing",
                "Runtime config was applied but the cloud worker is not registered.",
                status_code=409,
            )
        await agent_auth_store.record_runtime_config_worker_status(
            db,
            sandbox_profile_id=ctx.sandbox_profile_id,
            target_id=ctx.target_id,
            sequence=status.current_revision.sequence,
            revision_id=revision_id,
            worker_id=worker_id,
            status="applied",
            error_code=None,
            error_message=None,
        )
    tracker.complete(
        target_id=str(ctx.target_id),
        revision=str(revision_id),
        sequence=status.current_revision.sequence,
    )
