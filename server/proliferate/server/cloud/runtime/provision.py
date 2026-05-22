"""Fresh provisioning flow for cloud workspaces."""

from __future__ import annotations

import asyncio
import logging
import secrets
import shlex
import time
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from uuid import UUID

from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
)
from proliferate.constants.cloud import CloudTargetStatus, CloudWorkspaceStatus
from proliferate.constants.cloud import (
    WorkspaceStatus as LegacyWorkspaceStatus,
)
from proliferate.db import engine as db_engine
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
)
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_repo_config import load_cloud_repo_config_for_user
from proliferate.db.store.cloud_runtime_environments import (
    attach_target_to_runtime_environment,
    ensure_runtime_environment_for_workspace_id,
    load_runtime_environment_with_sandbox,
    reserve_and_attach_sandbox_for_environment,
    save_runtime_environment_state,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspaces import (
    bind_allocated_sandbox,
    finalize_workspace_provision_for_ids,
    load_cloud_sandbox_by_id,
    load_cloud_workspace_by_id,
    mark_workspace_error_by_id,
    save_sandbox_provider_state,
    update_sandbox_status,
    update_workspace_status_by_id,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.integrations.sandbox import (
    SandboxHandle,
    SandboxProvider,
    get_configured_sandbox_provider,
)
from proliferate.server.billing.service import authorize_sandbox_start
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.agent_auth.service import (
    request_agent_auth_refresh_for_profile_target,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.anyharness_api import (
    prepare_remote_mobility_destination,
    reconcile_remote_agents,
    resolve_remote_workspace,
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.auth_status import selected_agent_auth_agent_kinds
from proliferate.server.cloud.runtime.bootstrap import (
    build_detached_supervisor_launch_command,
    build_runtime_env,
    build_supervisor_config,
    build_worker_config,
    check_node_runtime,
    check_runtime_bundle_preinstalled,
    install_node_runtime,
    local_anyharness_base_url,
    stage_runtime_bundle,
    supervisor_config_path,
    worker_config_path,
)
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.domain.reconnect_policy import (
    SandboxReconnectAction,
    reconnect_action_for_sandbox_state,
)
from proliferate.server.cloud.runtime.domain.runtime_state import (
    runtime_connected_sandbox_update,
    runtime_ready_update,
)
from proliferate.server.cloud.runtime.git_operations import (
    checkout_cloud_branch,
    clone_repository,
    configure_git_identity,
    resolve_runtime_root_head_sha,
)
from proliferate.server.cloud.runtime.models import (
    CloudProvisionInput,
    ConnectedSandbox,
    ProvisionStep,
    ProvisionStepMetric,
    RuntimeHandshake,
)
from proliferate.server.cloud.runtime.repo_config_apply import (
    WorkspaceRuntimeAccess,
    apply_workspace_repo_config_after_provision,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    collect_runtime_debug_report,
    run_sandbox_command_logged,
)
from proliferate.server.cloud.runtime.target_registration import ensure_runtime_target_enrollment
from proliferate.server.cloud.runtime.worktree_policy_sync import (
    sync_cloud_worktree_policy_to_runtime,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import duration_ms, utcnow

WorkspaceStatus = LegacyWorkspaceStatus


@dataclass
class _StepTracker:
    workspace_id: UUID
    metrics: list[ProvisionStepMetric] = field(default_factory=list)
    active_step: ProvisionStep = field(default=ProvisionStep.init)
    _step_started: float = field(default=0.0, init=False, repr=False)

    def begin(self, step: ProvisionStep, **fields: object) -> None:
        self.active_step = step
        self._step_started = time.perf_counter()
        payload: dict[str, object] = {
            "workspace_id": self.workspace_id,
            "step": step.value,
        }
        payload.update(fields)
        _emit_cloud_event("cloud workspace setup step started", payload)

    def complete(self, **fields: object) -> None:
        elapsed_ms = duration_ms(self._step_started)
        self.metrics.append(ProvisionStepMetric(step=self.active_step, elapsed_ms=elapsed_ms))
        payload: dict[str, object] = {
            "workspace_id": self.workspace_id,
            "step": self.active_step.value,
            "elapsed_ms": elapsed_ms,
        }
        payload.update(fields)
        _emit_cloud_event("cloud workspace setup step complete", payload)


def _normalize_identity_value(value: object | None) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def _resolve_git_identity(user: object, github_account: object | None) -> tuple[str, str]:
    git_user_email = _normalize_identity_value(getattr(github_account, "account_email", None))
    if git_user_email is None:
        git_user_email = _normalize_identity_value(getattr(user, "email", None))
    if git_user_email is None:
        raise CloudApiError(
            "git_identity_required",
            "A usable email address is required to configure cloud git commits.",
            status_code=400,
        )

    git_user_name = _normalize_identity_value(getattr(user, "display_name", None))
    if git_user_name is None:
        git_user_name = git_user_email.partition("@")[0].strip() or "Proliferate User"

    return git_user_name, git_user_email


async def _load_provision_input(
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> CloudProvisionInput | None:
    workspace = await load_cloud_workspace_by_id(workspace_id)
    if workspace is None:
        return None
    if workspace.owner_scope == "organization":
        raise CloudApiError(
            "org_cloud_not_ready",
            "Organization cloud workspaces are not available yet.",
            status_code=409,
        )

    runtime_environment = await ensure_runtime_environment_for_workspace_id(workspace_id)
    if runtime_environment is None:
        return None
    if not runtime_environment.anyharness_data_key_ciphertext:
        runtime_environment = await save_runtime_environment_state(
            runtime_environment.id,
            anyharness_data_key_ciphertext=encrypt_text(generate_anyharness_data_key()),
        )
    anyharness_data_key_ciphertext = runtime_environment.anyharness_data_key_ciphertext
    if anyharness_data_key_ciphertext is None:
        raise CloudApiError(
            "runtime_data_key_required",
            "Cloud runtime data key could not be prepared.",
            status_code=500,
        )

    user = await load_user_with_oauth_accounts_by_id(workspace.user_id)
    if user is None:
        return None

    async with db_engine.async_session_factory() as db:
        github_grant = await get_ready_github_grant_for_user(db, user_id=workspace.user_id)
    if github_grant is None:
        raise CloudApiError(
            "github_link_required",
            "Linked GitHub account is missing an access token.",
            status_code=400,
        )
    git_user_name, git_user_email = _resolve_git_identity(user, github_grant)

    async with db_engine.async_session_factory() as db, db.begin():
        profile = await agent_auth_store.ensure_personal_sandbox_profile(
            db,
            user_id=workspace.user_id,
            created_by_user_id=workspace.user_id,
        )
        target = await targets_store.ensure_primary_profile_target(
            db,
            sandbox_profile_id=profile.id,
            created_by_user_id=workspace.user_id,
        )
        profile = await agent_auth_store.get_sandbox_profile(db, profile.id)
        if profile is None:
            raise CloudApiError(
                "sandbox_profile_not_found",
                "Cloud sandbox profile could not be prepared.",
                status_code=500,
            )
        await attach_target_to_runtime_environment(
            db,
            runtime_environment_id=runtime_environment.id,
            target_id=target.id,
        )
        workspace_row = await db.get(type(workspace), workspace.id)
        if workspace_row is not None:
            workspace_row.sandbox_profile_id = profile.id
            workspace_row.target_id = target.id
            workspace_row.billing_subject_id = profile.billing_subject_id
            workspace_row.updated_at = utcnow()
        agent_auth_agent_kinds = await selected_agent_auth_agent_kinds(
            db,
            sandbox_profile_id=profile.id,
        )

    if not agent_auth_agent_kinds:
        raise CloudApiError(
            "missing_supported_credentials",
            "No agent authentication credentials were selected for this user.",
            status_code=400,
        )

    repo_config = await load_cloud_repo_config_for_user(
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )

    if repo_config is not None and repo_config.configured:
        repo_env_vars = repo_config.env_vars
        repo_env_version = repo_config.env_vars_version
    else:
        repo_env_vars = {}
        repo_env_version = 0

    return CloudProvisionInput(
        workspace_id=workspace.id,
        runtime_environment_id=runtime_environment.id,
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        git_base_branch=workspace.git_base_branch or workspace.git_branch,
        github_token=github_grant.access_token,
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        anyharness_data_key=decrypt_text(anyharness_data_key_ciphertext),
        sandbox_profile_id=profile.id,
        target_id=target.id,
        required_agent_auth_revision=profile.agent_auth_revision,
        agent_auth_agent_kinds=agent_auth_agent_kinds,
        repo_env_vars=repo_env_vars,
        repo_env_version=repo_env_version,
        requested_base_sha=requested_base_sha,
    )


def _emit_cloud_event(message: str, payload: dict[str, object]) -> None:
    log_cloud_event(message, **payload)  # type: ignore[arg-type]


def _cloud_base_url() -> str:
    for candidate in (
        settings.cloud_worker_base_url,
        settings.api_base_url,
        settings.cloud_mcp_oauth_callback_base_url,
        settings.cloud_mcp_oauth_callback_fallback_base_url,
    ):
        normalized = candidate.strip().rstrip("/")
        if normalized:
            return normalized
    return "http://localhost:8000"


async def _set_workspace_status(
    workspace_id: UUID,
    status: CloudWorkspaceStatus,
    detail: str | None = None,
) -> None:
    resolved_detail = detail or str(status).replace("_", " ").title()
    await update_workspace_status_by_id(
        workspace_id,
        status,
        resolved_detail,
    )
    log_cloud_event(
        "cloud workspace status updated",
        workspace_id=workspace_id,
        status=status.value,
        detail=resolved_detail,
    )


def _log_provision_summary(
    workspace_id: UUID,
    tracker: _StepTracker,
    *,
    status: str,
    total_elapsed_ms: int,
    **fields: object,
) -> None:
    ordered = sorted(tracker.metrics, key=lambda metric: metric.elapsed_ms, reverse=True)
    breakdown = ", ".join(f"{metric.step.value}={metric.elapsed_ms}ms" for metric in ordered)
    payload: dict[str, object] = {
        "workspace_id": workspace_id,
        "status": status,
        "total_elapsed_ms": total_elapsed_ms,
        "step_breakdown": breakdown or "none",
    }
    payload.update(fields)
    _emit_cloud_event("cloud workspace provisioning summary", payload)


async def _create_and_connect_sandbox(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    *,
    sandbox_record_id: UUID,
) -> ConnectedSandbox:
    tracker.begin(
        ProvisionStep.create_sandbox,
        provider=provider.kind,
        template_version=provider.template_version,
        repo=ctx.repo_label,
    )
    handle = await provider.create_sandbox(
        metadata={
            "user_id": str(ctx.user_id),
            "workspace_id": str(ctx.workspace_id),
            "runtime_environment_id": str(ctx.runtime_environment_id),
            "cloud_sandbox_id": str(sandbox_record_id),
        }
    )
    tracker.complete(sandbox_id=handle.sandbox_id)
    started_at = utcnow()
    await bind_allocated_sandbox(
        sandbox_record_id,
        external_sandbox_id=handle.sandbox_id,
        status="provisioning",
        started_at=started_at,
    )
    await open_usage_segment_for_sandbox(
        user_id=ctx.user_id,
        runtime_environment_id=ctx.runtime_environment_id,
        workspace_id=ctx.workspace_id,
        sandbox_id=sandbox_record_id,
        external_sandbox_id=handle.sandbox_id,
        sandbox_execution_id=None,
        started_at=started_at,
        opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
    )

    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Connecting to sandbox",
    )
    tracker.begin(ProvisionStep.connect_sandbox, sandbox_id=handle.sandbox_id)
    sandbox = await provider.connect_running_sandbox(handle.sandbox_id)
    runtime_context = await provider.resolve_runtime_context(sandbox)
    endpoint = await provider.resolve_runtime_endpoint(sandbox)
    tracker.complete(runtime_url=endpoint.runtime_url)

    return ConnectedSandbox(
        handle=handle,
        sandbox=sandbox,
        endpoint=endpoint,
        runtime_context=runtime_context,
    )


async def _connect_existing_environment_sandbox(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
) -> tuple[ConnectedSandbox, UUID, int, str] | None:
    runtime = await load_runtime_environment_with_sandbox(ctx.runtime_environment_id)
    sandbox_record = runtime.sandbox if runtime is not None else None
    if sandbox_record is None or not sandbox_record.external_sandbox_id:
        return None
    if runtime is None or not runtime.environment.runtime_token_ciphertext:
        return None
    if sandbox_record.provider != provider.kind.value:
        return None
    if (
        sandbox_record.sandbox_profile_id != ctx.sandbox_profile_id
        or sandbox_record.target_id != ctx.target_id
        or sandbox_record.slot_generation is None
    ):
        return None

    tracker.begin(
        ProvisionStep.connect_sandbox,
        sandbox_id=sandbox_record.external_sandbox_id,
        reused_sandbox=True,
    )
    try:
        provider_state = await provider.get_sandbox_state(sandbox_record.external_sandbox_id)
        if provider_state is None:
            tracker.complete(reused_sandbox=False, reason="provider_state_missing")
            return None

        observed_state = provider_state.state.strip().lower()
        reconnect_action = reconnect_action_for_sandbox_state(observed_state)
        if reconnect_action == SandboxReconnectAction.connect:
            sandbox = await provider.connect_running_sandbox(sandbox_record.external_sandbox_id)
        elif reconnect_action == SandboxReconnectAction.resume:
            sandbox = await provider.resume_sandbox(sandbox_record.external_sandbox_id)
        else:
            tracker.complete(reused_sandbox=False, provider_state=observed_state)
            return None

        runtime_context = await provider.resolve_runtime_context(sandbox)
        endpoint = await provider.resolve_runtime_endpoint(sandbox)
    except Exception:
        log_cloud_event(
            "cloud runtime environment sandbox reuse failed",
            level=logging.WARNING,
            workspace_id=ctx.workspace_id,
            runtime_environment_id=ctx.runtime_environment_id,
            sandbox_id=sandbox_record.id,
            external_sandbox_id=sandbox_record.external_sandbox_id,
        )
        tracker.complete(reused_sandbox=False, reason="connect_failed")
        return None

    await save_sandbox_provider_state(
        sandbox_record.id,
        status="running",
        started_at=provider_state.started_at or utcnow(),
        stopped_at=None,
    )
    await save_runtime_environment_state(
        ctx.runtime_environment_id,
        **runtime_connected_sandbox_update(
            runtime_url=endpoint.runtime_url,
            active_sandbox_id=sandbox_record.id,
        ),
    )
    tracker.complete(runtime_url=endpoint.runtime_url, reused_sandbox=True)

    return (
        ConnectedSandbox(
            handle=SandboxHandle(
                provider=provider.kind,
                sandbox_id=sandbox_record.external_sandbox_id,
                template_version=sandbox_record.template_version or provider.template_version,
            ),
            sandbox=sandbox,
            endpoint=endpoint,
            runtime_context=runtime_context,
        ),
        sandbox_record.id,
        sandbox_record.slot_generation,
        decrypt_text(runtime.environment.runtime_token_ciphertext),
    )


async def _prepare_runtime_template(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
) -> None:
    tracker.begin(ProvisionStep.check_preinstalled_runtime)
    bundle_preinstalled = await check_runtime_bundle_preinstalled(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(preinstalled=bundle_preinstalled)

    if bundle_preinstalled:
        await _set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Using prebuilt runtime bundle",
        )
        tracker.begin(ProvisionStep.stage_runtime_binary)
        tracker.complete(skipped=True, reason="template_runtime_bundle_present")

        await _set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Using prebuilt Node.js runtime",
        )
        tracker.begin(ProvisionStep.check_node_runtime)
        tracker.complete(skipped=True, reason="template_runtime_present")
        return

    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Uploading runtime bundle",
    )
    tracker.begin(ProvisionStep.stage_runtime_binary)
    binary_paths = await stage_runtime_bundle(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(
        binary_paths={key: str(value) for key, value in binary_paths.items()},
        preinstalled=bundle_preinstalled,
    )

    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Checking Node.js runtime",
    )
    tracker.begin(ProvisionStep.check_node_runtime)
    node_version = await check_node_runtime(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(node_version=node_version or "missing")

    if node_version is None:
        await _set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Installing Node.js",
        )
        tracker.begin(ProvisionStep.install_node_runtime)
        installed_version = await install_node_runtime(
            provider,
            connected.sandbox,
            workspace_id=ctx.workspace_id,
            runtime_context=connected.runtime_context,
        )
        tracker.complete(node_version=installed_version)


async def _launch_supervised_runtime_bundle(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    runtime_env: dict[str, str],
    runtime_token: str,
    cloud_sandbox_id: UUID,
    slot_generation: int,
) -> UUID:
    enrollment = await ensure_runtime_target_enrollment(
        runtime_environment_id=ctx.runtime_environment_id,
        user_id=ctx.user_id,
        display_name=f"Managed cloud: {ctx.repo_label}",
        sandbox_profile_id=ctx.sandbox_profile_id,
        target_id=ctx.target_id,
        cloud_sandbox_id=cloud_sandbox_id,
        slot_generation=slot_generation,
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
            cloud_base_url=_cloud_base_url(),
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


async def _wait_for_worker_target_online(
    target_id: UUID,
    *,
    workspace_id: UUID,
    total_attempts: int = 90,
    delay_seconds: float = 0.5,
) -> None:
    last_status = "missing"
    last_detail: str | None = None
    last_anyharness_version: str | None = None
    last_worker_version: str | None = None
    last_supervisor_version: str | None = None
    for _attempt in range(max(1, total_attempts)):
        async with db_engine.async_session_factory() as db:
            target = await targets_store.get_target_by_id(db, target_id)
        if target is not None:
            last_status = target.status
            last_detail = target.status_record.status_detail if target.status_record else None
            if target.current_versions is not None:
                last_anyharness_version = target.current_versions.anyharness_version
                last_worker_version = target.current_versions.worker_version
                last_supervisor_version = target.current_versions.supervisor_version
            else:
                last_anyharness_version = None
                last_worker_version = None
                last_supervisor_version = None
            if (
                target.status == CloudTargetStatus.online.value
                and target.status_record is not None
                and target.status_record.worker_id is not None
                and last_anyharness_version
                and last_worker_version
                and last_supervisor_version
            ):
                return
        await asyncio.sleep(delay_seconds)

    raise RuntimeError(
        "Proliferate Worker did not report an online AnyHarness runtime "
        f"for target {target_id}; last_status={last_status}; "
        f"last_detail={last_detail or '<none>'}; "
        f"last_anyharness_version={last_anyharness_version or '<none>'}; "
        f"last_worker_version={last_worker_version or '<none>'}; "
        f"last_supervisor_version={last_supervisor_version or '<none>'}."
    )


async def _wait_for_agent_auth_target_current(
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


async def _request_agent_auth_refresh_and_wait(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    *,
    reason: str,
    force_restart: bool,
) -> None:
    await _set_workspace_status(
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
    await _wait_for_agent_auth_target_current(ctx)
    tracker.complete(target_id=str(ctx.target_id), revision=ctx.required_agent_auth_revision)


async def _launch_and_connect_runtime(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    cloud_sandbox_id: UUID,
    slot_generation: int,
) -> tuple[ConnectedSandbox, RuntimeHandshake]:
    runtime_token = secrets.token_urlsafe(32)
    runtime_env = build_runtime_env(
        runtime_token,
        anyharness_data_key=ctx.anyharness_data_key,
        target_id=ctx.target_id,
        repo_env_vars=ctx.repo_env_vars,
    )

    target_id = await _launch_supervised_runtime_bundle(
        tracker,
        ctx,
        provider,
        connected,
        runtime_env=runtime_env,
        runtime_token=runtime_token,
        cloud_sandbox_id=cloud_sandbox_id,
        slot_generation=slot_generation,
    )

    connected = ConnectedSandbox(
        handle=connected.handle,
        sandbox=connected.sandbox,
        endpoint=await provider.resolve_runtime_endpoint(connected.sandbox),
        runtime_context=connected.runtime_context,
    )

    await _set_workspace_status(
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
        debug_report = await collect_runtime_debug_report(
            provider,
            connected.sandbox,
            workspace_id=ctx.workspace_id,
            runtime_context=connected.runtime_context,
        )
        log_cloud_event(
            "cloud runtime launch diagnostics",
            level=logging.WARNING,
            workspace_id=ctx.workspace_id,
            runtime_url=connected.endpoint.runtime_url,
            launcher_preview=debug_report.get("launcher"),
            log_preview=debug_report.get("log"),
            supervisor_config_preview=debug_report.get("supervisor_config"),
            supervisor_log_preview=debug_report.get("supervisor_log"),
            process_preview=debug_report.get("processes"),
            binary_preview=debug_report.get("binary"),
            workdir_preview=debug_report.get("workdir"),
        )
        raise
    tracker.complete(runtime_url=connected.endpoint.runtime_url)
    await verify_runtime_auth_enforced(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
    )
    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Waiting for Proliferate Worker enrollment",
    )
    tracker.begin(ProvisionStep.start_worker_process, target_id=str(target_id))
    await _wait_for_worker_target_online(target_id, workspace_id=ctx.workspace_id)
    tracker.complete(target_id=str(target_id))
    await _request_agent_auth_refresh_and_wait(
        tracker,
        ctx,
        reason="workspace_provision",
        force_restart=False,
    )
    await sync_cloud_worktree_policy_to_runtime(
        user_id=ctx.user_id,
        runtime_url=connected.endpoint.runtime_url,
        access_token=runtime_token,
        workspace_id=ctx.workspace_id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )

    handshake = await _prepare_workspace_in_runtime(
        tracker,
        ctx,
        provider,
        connected,
        runtime_token=runtime_token,
    )

    return connected, handshake


async def _attach_workspace_to_running_runtime(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    runtime_token: str,
) -> RuntimeHandshake:
    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Waiting for AnyHarness health",
    )
    tracker.begin(
        ProvisionStep.wait_for_runtime_health,
        runtime_url=connected.endpoint.runtime_url,
        reused_runtime=True,
    )
    await wait_for_runtime_health(
        connected.endpoint.runtime_url,
        workspace_id=ctx.workspace_id,
        required_successes=1,
        total_attempts=10,
        delay_seconds=0.5,
    )
    tracker.complete(runtime_url=connected.endpoint.runtime_url, reused_runtime=True)
    await verify_runtime_auth_enforced(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
    )
    await sync_cloud_worktree_policy_to_runtime(
        user_id=ctx.user_id,
        runtime_url=connected.endpoint.runtime_url,
        access_token=runtime_token,
        workspace_id=ctx.workspace_id,
        run_deferred_startup_cleanup=True,
        await_deferred_startup_cleanup=False,
    )
    return await _prepare_workspace_in_runtime(
        tracker,
        ctx,
        provider,
        connected,
        runtime_token=runtime_token,
    )


async def _prepare_workspace_in_runtime(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    runtime_token: str,
) -> RuntimeHandshake:
    required_agent_kinds = ctx.agent_auth_agent_kinds
    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Preparing cloud agents",
    )
    tracker.begin(
        ProvisionStep.reconcile_agents,
        required_agents=",".join(required_agent_kinds),
    )
    ready_agents = await reconcile_remote_agents(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
        required_agent_kinds=required_agent_kinds,
    )
    tracker.complete(ready_agents=",".join(ready_agents))

    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Resolving workspace",
    )
    tracker.begin(
        ProvisionStep.resolve_remote_workspace,
        runtime_url=connected.endpoint.runtime_url,
    )
    root_workspace = await resolve_remote_workspace(
        connected.endpoint.runtime_url,
        runtime_token,
        runtime_workdir=connected.runtime_context.runtime_workdir,
        workspace_id=ctx.workspace_id,
    )
    base_sha = ctx.requested_base_sha or await resolve_runtime_root_head_sha(
        provider,
        connected.sandbox,
        ctx=ctx,
        runtime_context=connected.runtime_context,
    )
    visible_workspace = await prepare_remote_mobility_destination(
        connected.endpoint.runtime_url,
        runtime_token,
        repo_root_id=root_workspace.repo_root_id,
        requested_branch=ctx.git_branch,
        requested_base_sha=base_sha,
        destination_id=str(ctx.workspace_id),
        preferred_workspace_name=ctx.git_branch,
        workspace_id=ctx.workspace_id,
    )
    tracker.complete(
        root_anyharness_workspace_id=root_workspace.workspace_id,
        anyharness_workspace_id=visible_workspace.workspace_id,
        anyharness_repo_root_id=root_workspace.repo_root_id,
    )

    return RuntimeHandshake(
        runtime_token=runtime_token,
        ready_agents=ready_agents,
        anyharness_workspace_id=visible_workspace.workspace_id,
        root_anyharness_workspace_id=root_workspace.workspace_id,
        anyharness_repo_root_id=root_workspace.repo_root_id,
    )


async def provision_workspace(
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> None:
    provision_started = time.perf_counter()
    tracker = _StepTracker(workspace_id=workspace_id)
    ctx: CloudProvisionInput | None = None
    provider: SandboxProvider | None = None
    connected: ConnectedSandbox | None = None
    sandbox_record_id: UUID | None = None
    allocated_sandbox_this_attempt = False
    launched_runtime_this_attempt = False

    try:
        ctx = await _load_provision_input(
            workspace_id,
            requested_base_sha=requested_base_sha,
        )
        if ctx is None:
            return
        authorization = await authorize_sandbox_start(
            user_id=ctx.user_id,
            workspace_id=ctx.workspace_id,
        )
        if not authorization.allowed:
            raise CloudApiError(
                "quota_exceeded",
                authorization.message or "Cloud usage is currently unavailable.",
                status_code=403,
            )
        provider = get_configured_sandbox_provider()

        log_cloud_event(
            "cloud workspace provisioning started",
            workspace_id=workspace_id,
            provider=provider.kind,
            repo=ctx.repo_label,
            base_branch=ctx.git_base_branch,
            branch_name=ctx.git_branch,
            requested_base_sha=ctx.requested_base_sha,
        )
        await _set_workspace_status(
            workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Connecting to repo runtime",
        )

        reused_runtime = await _connect_existing_environment_sandbox(tracker, ctx, provider)
        if reused_runtime is not None:
            connected, sandbox_record_id, slot_generation, runtime_token = reused_runtime
        else:
            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Allocating sandbox",
            )
            sandbox_record = await reserve_and_attach_sandbox_for_environment(
                ctx.runtime_environment_id,
                external_sandbox_id=None,
                provider=provider.kind.value,
                template_version=provider.template_version,
                status="allocating",
                started_at=None,
                concurrent_sandbox_limit=(
                    (
                        authorization.active_environment_limit
                        if authorization.active_environment_limit is not None
                        else settings.cloud_concurrent_sandbox_limit
                    )
                    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE
                    else None
                ),
                sandbox_profile_id=ctx.sandbox_profile_id,
                target_id=ctx.target_id,
            )
            if sandbox_record is None:
                raise CloudApiError(
                    "quota_exceeded",
                    (
                        "Sandbox limit reached. Archive or delete another cloud workspace before "
                        "starting a new one."
                    ),
                    status_code=403,
                )
            sandbox_record_id = sandbox_record.id
            if sandbox_record.slot_generation is None:
                raise RuntimeError("Managed cloud sandbox slot is missing slot generation.")
            slot_generation = sandbox_record.slot_generation
            allocated_sandbox_this_attempt = True
            connected = await _create_and_connect_sandbox(
                tracker,
                ctx,
                provider,
                sandbox_record_id=sandbox_record.id,
            )

            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Checking prebuilt runtime template",
            )
            await _prepare_runtime_template(tracker, ctx, provider, connected)

            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Cloning repository",
            )
            tracker.begin(ProvisionStep.clone_repository)
            await clone_repository(
                provider,
                connected.sandbox,
                ctx=ctx,
                runtime_context=connected.runtime_context,
            )
            tracker.complete()

            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Checking out cloud branch",
            )
            tracker.begin(ProvisionStep.checkout_cloud_branch)
            await checkout_cloud_branch(
                provider,
                connected.sandbox,
                ctx=ctx,
                runtime_context=connected.runtime_context,
            )
            tracker.complete()

            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Configuring git identity",
            )
            tracker.begin(ProvisionStep.configure_git_identity)
            await configure_git_identity(
                provider,
                connected.sandbox,
                ctx=ctx,
                runtime_context=connected.runtime_context,
            )
            tracker.complete()

        if reused_runtime is not None:
            connected, sandbox_record_id, slot_generation, runtime_token = reused_runtime
            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Waiting for Proliferate Worker enrollment",
            )
            tracker.begin(ProvisionStep.start_worker_process, target_id=str(ctx.target_id))
            await _wait_for_worker_target_online(ctx.target_id, workspace_id=ctx.workspace_id)
            tracker.complete(target_id=str(ctx.target_id), reused_runtime=True)
            await _request_agent_auth_refresh_and_wait(
                tracker,
                ctx,
                reason="workspace_reuse",
                force_restart=False,
            )
            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Preparing workspace in shared runtime",
            )
            handshake = await _attach_workspace_to_running_runtime(
                tracker,
                ctx,
                provider,
                connected,
                runtime_token=runtime_token,
            )
        else:
            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Starting AnyHarness",
            )
            connected, handshake = await _launch_and_connect_runtime(
                tracker,
                ctx,
                provider,
                connected,
                cloud_sandbox_id=sandbox_record_id,
                slot_generation=slot_generation,
            )
            launched_runtime_this_attempt = True

        await finalize_workspace_provision_for_ids(
            workspace_id,
            sandbox_record_id,
            runtime_url=connected.endpoint.runtime_url,
            runtime_token_ciphertext=encrypt_text(handshake.runtime_token),
            anyharness_workspace_id=handshake.anyharness_workspace_id,
            template_version=connected.handle.template_version,
        )
        runtime_state_updates = runtime_ready_update(
            runtime_url=connected.endpoint.runtime_url,
            runtime_token_ciphertext=encrypt_text(handshake.runtime_token),
            root_anyharness_workspace_id=handshake.root_anyharness_workspace_id,
            root_anyharness_repo_root_id=handshake.anyharness_repo_root_id,
            launched_runtime=launched_runtime_this_attempt,
            repo_env_applied_version=ctx.repo_env_version,
        )
        await save_runtime_environment_state(
            ctx.runtime_environment_id,
            **runtime_state_updates,
        )
        provisioned_workspace = await load_cloud_workspace_by_id(workspace_id)
        if provisioned_workspace is not None:
            await apply_workspace_repo_config_after_provision(
                provisioned_workspace,
                runtime=WorkspaceRuntimeAccess(
                    runtime_url=connected.endpoint.runtime_url,
                    access_token=handshake.runtime_token,
                    anyharness_workspace_id=handshake.anyharness_workspace_id,
                ),
            )

        total_elapsed_ms = duration_ms(provision_started)
        log_cloud_event(
            "cloud workspace provisioning finished",
            workspace_id=workspace_id,
            repo=ctx.repo_label,
            runtime_url=connected.endpoint.runtime_url,
            anyharness_workspace_id=handshake.anyharness_workspace_id,
            ready_agents=",".join(handshake.ready_agents) or "none",
            elapsed_ms=total_elapsed_ms,
        )
        _log_provision_summary(
            workspace_id,
            tracker,
            status="success",
            total_elapsed_ms=total_elapsed_ms,
            ready_agents=",".join(handshake.ready_agents) or "none",
        )
    except Exception as exc:
        error_message = format_exception_message(exc)
        sandbox_record = (
            await load_cloud_sandbox_by_id(sandbox_record_id) if sandbox_record_id else None
        )
        external_sandbox_id = (
            connected.handle.sandbox_id
            if connected is not None
            else sandbox_record.external_sandbox_id
            if sandbox_record is not None
            else None
        )
        if provider is not None and external_sandbox_id and allocated_sandbox_this_attempt:
            try:
                await provider.destroy_sandbox(external_sandbox_id)
            except Exception:
                log_cloud_event(
                    "cloud workspace failed provisioning sandbox destroy failed",
                    level=logging.WARNING,
                    workspace_id=workspace_id,
                    external_sandbox_id=external_sandbox_id,
                )
        if sandbox_record is not None and allocated_sandbox_this_attempt:
            await close_usage_segment_for_sandbox(
                sandbox_id=sandbox_record.id,
                ended_at=utcnow(),
                closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
                is_billable=False,
            )
            await update_sandbox_status(sandbox_record, "destroyed", stopped_at_now=True)
        await mark_workspace_error_by_id(
            workspace_id,
            error_message,
            clear_runtime_metadata=True,
            clear_active_sandbox=True,
        )
        total_elapsed_ms = duration_ms(provision_started)
        log_cloud_event(
            "cloud workspace provisioning failed",
            level=logging.ERROR,
            workspace_id=workspace_id,
            repo=ctx.repo_label if ctx is not None else None,
            step=tracker.active_step.value,
            step_elapsed_ms=tracker.metrics[-1].elapsed_ms if tracker.metrics else 0,
            total_elapsed_ms=total_elapsed_ms,
            error=error_message,
            error_type=exc.__class__.__name__,
            runtime_url=connected.endpoint.runtime_url if connected is not None else None,
        )
        _log_provision_summary(
            workspace_id,
            tracker,
            status="failure",
            total_elapsed_ms=total_elapsed_ms,
            failed_step=tracker.active_step.value,
            error=error_message,
            error_type=exc.__class__.__name__,
        )
        raise
