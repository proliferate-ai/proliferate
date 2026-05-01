"""Fresh provisioning flow for cloud workspaces."""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
)
from proliferate.constants.cloud import (
    CloudRuntimeEnvironmentStatus,
    CloudWorkspaceStatus,
)
from proliferate.constants.cloud import (
    WorkspaceStatus as LegacyWorkspaceStatus,
)
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
)
from proliferate.db.store.cloud_credentials import load_cloud_credentials_for_user
from proliferate.db.store.cloud_repo_config import load_cloud_repo_config_for_user
from proliferate.db.store.cloud_runtime_environments import (
    ensure_runtime_environment_for_workspace_id,
    load_runtime_environment_with_sandbox,
    reserve_and_attach_sandbox_for_environment,
    save_runtime_environment_state,
)
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
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repos.service import get_linked_github_account
from proliferate.server.cloud.runtime.anyharness_api import (
    prepare_remote_mobility_destination,
    reconcile_remote_agents,
    resolve_remote_workspace,
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_runtime_launch_script,
    check_binary_preinstalled,
    check_node_runtime,
    install_node_runtime,
    stage_runtime_binary,
)
from proliferate.server.cloud.runtime.credential_freshness import (
    build_credential_revision_state,
    ensure_runtime_environment_credentials_current,
)
from proliferate.server.cloud.runtime.credentials import (
    write_credential_files,
)
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
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
    build_detached_runtime_launch_command,
    collect_runtime_debug_report,
    run_sandbox_command_logged,
    runtime_launcher_path,
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

    user = await load_user_with_oauth_accounts_by_id(workspace.user_id)
    if user is None:
        return None

    github_account = get_linked_github_account(user)
    github_token = getattr(github_account, "access_token", None) if github_account else None
    if not github_token:
        raise CloudApiError(
            "github_link_required",
            "Linked GitHub account is missing an access token.",
            status_code=400,
        )
    git_user_name, git_user_email = _resolve_git_identity(user, github_account)

    credential_records = await load_cloud_credentials_for_user(workspace.user_id)
    credential_revision_state = build_credential_revision_state(credential_records)
    if credential_revision_state.missing_credentials:
        raise CloudApiError(
            "missing_supported_credentials",
            "No synced cloud credentials were found for this user.",
            status_code=400,
        )

    repo_config = await load_cloud_repo_config_for_user(
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )

    repo_configured = repo_config is not None and repo_config.configured
    return CloudProvisionInput(
        workspace_id=workspace.id,
        runtime_environment_id=runtime_environment.id,
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        git_base_branch=workspace.git_base_branch or workspace.git_branch,
        github_token=str(github_token),
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        anyharness_data_key=decrypt_text(runtime_environment.anyharness_data_key_ciphertext),
        credentials=credential_revision_state.credentials,
        credential_files_revision=credential_revision_state.files_revision,
        credential_process_revision=credential_revision_state.process_revision,
        repo_env_vars=repo_config.env_vars if repo_configured else {},
        repo_env_version=repo_config.env_vars_version if repo_configured else 0,
        requested_base_sha=requested_base_sha,
    )


def _emit_cloud_event(message: str, payload: dict[str, object]) -> None:
    log_cloud_event(message, **payload)  # type: ignore[arg-type]


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
) -> tuple[ConnectedSandbox, UUID, str] | None:
    runtime = await load_runtime_environment_with_sandbox(ctx.runtime_environment_id)
    sandbox_record = runtime.sandbox if runtime is not None else None
    if sandbox_record is None or not sandbox_record.external_sandbox_id:
        return None
    if runtime is None or not runtime.environment.runtime_token_ciphertext:
        return None
    if sandbox_record.provider != provider.kind.value:
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

        state = provider_state.state.strip().lower()
        if state in {"running", "started"}:
            sandbox = await provider.connect_running_sandbox(sandbox_record.external_sandbox_id)
        elif state in {"paused", "stopped"}:
            sandbox = await provider.resume_sandbox(sandbox_record.external_sandbox_id)
        else:
            tracker.complete(reused_sandbox=False, provider_state=state)
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
        status=CloudRuntimeEnvironmentStatus.running.value,
        runtime_url=endpoint.runtime_url,
        active_sandbox_id=sandbox_record.id,
        last_error=None,
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
        decrypt_text(runtime.environment.runtime_token_ciphertext),
    )


async def _prepare_runtime_template(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
) -> None:
    tracker.begin(ProvisionStep.check_preinstalled_runtime)
    binary_preinstalled = await check_binary_preinstalled(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(preinstalled=binary_preinstalled)

    if binary_preinstalled:
        await _set_workspace_status(
            ctx.workspace_id,
            CloudWorkspaceStatus.materializing,
            detail="Using prebuilt AnyHarness binary",
        )
        tracker.begin(ProvisionStep.stage_runtime_binary)
        tracker.complete(skipped=True, reason="template_binary_present")

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
        detail="Uploading AnyHarness binary",
    )
    tracker.begin(ProvisionStep.stage_runtime_binary)
    binary_path = await stage_runtime_binary(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        runtime_context=connected.runtime_context,
    )
    tracker.complete(binary_path=str(binary_path), preinstalled=binary_preinstalled)

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

    # if ctx.credentials.codex is not None:
    #     await _set_workspace_status(
    #         ctx.workspace_id,
    #         WorkspaceStatus.provisioning,
    #         detail="Checking Rust toolchain",
    #     )
    #     tracker.begin(ProvisionStep.check_rust_runtime)
    #     rust_version = await check_rust_runtime(
    #         provider,
    #         connected.sandbox,
    #         workspace_id=ctx.workspace_id,
    #         runtime_context=connected.runtime_context,
    #     )
    #     tracker.complete(rust_version=rust_version or "missing")

    #     if rust_version is None:
    #         await _set_workspace_status(
    #             ctx.workspace_id,
    #             WorkspaceStatus.provisioning,
    #             detail="Installing Rust toolchain",
    #         )
    #         tracker.begin(ProvisionStep.install_rust_runtime)
    #         installed_rust_version = await install_rust_runtime(
    #             provider,
    #             connected.sandbox,
    #             workspace_id=ctx.workspace_id,
    #             runtime_context=connected.runtime_context,
    #         )
    #         tracker.complete(rust_version=installed_rust_version)


async def _launch_and_connect_runtime(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
) -> tuple[ConnectedSandbox, RuntimeHandshake]:
    runtime_token = secrets.token_urlsafe(32)
    runtime_env = build_runtime_env(
        ctx.credentials,
        runtime_token,
        anyharness_data_key=ctx.anyharness_data_key,
        repo_env_vars=ctx.repo_env_vars,
    )

    tracker.begin(ProvisionStep.start_runtime_process)
    await provider.write_file(
        connected.sandbox,
        runtime_launcher_path(connected.runtime_context),
        build_runtime_launch_script(provider, connected.runtime_context, runtime_env),
    )
    await run_sandbox_command_logged(
        provider,
        connected.sandbox,
        workspace_id=ctx.workspace_id,
        label="chmod_runtime_launcher",
        command=f"chmod +x {runtime_launcher_path(connected.runtime_context)}",
        runtime_context=connected.runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            connected.sandbox,
            workspace_id=ctx.workspace_id,
            label="launch_runtime_nohup",
            command=build_detached_runtime_launch_command(connected.runtime_context),
            runtime_context=connected.runtime_context,
            cwd=connected.runtime_context.runtime_workdir,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Cloud runtime launch failed",
    )
    tracker.complete()

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
    synced_providers = ctx.credentials.synced_providers
    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Preparing cloud agents",
    )
    tracker.begin(
        ProvisionStep.reconcile_agents,
        synced_providers=",".join(synced_providers),
    )
    ready_agents = await reconcile_remote_agents(
        connected.endpoint.runtime_url,
        runtime_token,
        workspace_id=ctx.workspace_id,
        synced_providers=synced_providers,
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
            connected, sandbox_record_id, runtime_token = reused_runtime
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
                    settings.cloud_concurrent_sandbox_limit
                    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE
                    else None
                ),
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
                detail="Syncing cloud credentials",
            )
            tracker.begin(ProvisionStep.sync_credentials)
            await write_credential_files(
                provider,
                connected.sandbox,
                workspace_id=ctx.workspace_id,
                credentials=ctx.credentials,
                runtime_context=connected.runtime_context,
            )
            await save_runtime_environment_state(
                ctx.runtime_environment_id,
                credential_files_applied_revision=ctx.credential_files_revision,
                credential_files_applied_at=utcnow(),
                credential_last_error=None,
                credential_last_error_at=None,
            )
            tracker.complete()

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
            credential_freshness = await ensure_runtime_environment_credentials_current(
                ctx.runtime_environment_id,
                workspace_id=workspace_id,
                allow_process_restart=True,
            )
            if credential_freshness.status != "current":
                raise CloudApiError(
                    "runtime_credentials_not_current",
                    "Cloud runtime credentials must refresh before reusing this runtime.",
                    status_code=409,
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
        runtime_state_updates: dict[str, object] = {
            "status": CloudRuntimeEnvironmentStatus.running.value,
            "runtime_url": connected.endpoint.runtime_url,
            "runtime_token_ciphertext": encrypt_text(handshake.runtime_token),
            "root_anyharness_workspace_id": handshake.root_anyharness_workspace_id,
            "root_anyharness_repo_root_id": handshake.anyharness_repo_root_id,
            "increment_runtime_generation": launched_runtime_this_attempt,
            "repo_env_applied_version": ctx.repo_env_version,
            "last_error": None,
        }
        if launched_runtime_this_attempt:
            runtime_state_updates.update(
                {
                    "credential_process_applied_revision": ctx.credential_process_revision,
                    "credential_process_applied_at": utcnow(),
                    "credential_last_error": None,
                    "credential_last_error_at": None,
                }
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
