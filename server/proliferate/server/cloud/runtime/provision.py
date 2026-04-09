"""Fresh provisioning flow for cloud workspaces."""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field
from uuid import UUID

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
)
from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS, WorkspaceStatus
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
)
from proliferate.db.store.cloud_credentials import load_cloud_credentials_for_user
from proliferate.db.store.cloud_workspaces import (
    bind_allocated_sandbox,
    create_and_attach_sandbox_for_workspace,
    finalize_workspace_provision_for_ids,
    load_cloud_sandbox_by_id,
    load_cloud_workspace_by_id,
    mark_workspace_error_by_id,
    update_sandbox_status,
    update_workspace_status_by_id,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.integrations.sandbox import SandboxProvider, get_configured_sandbox_provider
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repos.service import get_linked_github_account
from proliferate.server.cloud.runtime.anyharness_api import (
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
from proliferate.server.cloud.runtime.credentials import (
    normalize_provision_credentials,
    write_credential_files,
)
from proliferate.server.cloud.runtime.git_operations import (
    checkout_cloud_branch,
    clone_repository,
    configure_git_identity,
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
from proliferate.utils.crypto import decrypt_json, encrypt_text
from proliferate.utils.time import duration_ms, utcnow


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


async def _load_provision_input(workspace_id: UUID) -> CloudProvisionInput | None:
    workspace = await load_cloud_workspace_by_id(workspace_id)
    if workspace is None:
        return None

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
    credential_payloads = {
        record.provider: decrypt_json(record.payload_ciphertext)
        for record in credential_records
        if record.provider in SUPPORTED_CLOUD_AGENTS and record.revoked_at is None
    }
    if not credential_payloads:
        raise CloudApiError(
            "missing_supported_credentials",
            "No synced cloud credentials were found for this user.",
            status_code=400,
        )

    return CloudProvisionInput(
        workspace_id=workspace.id,
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        git_base_branch=workspace.git_base_branch or workspace.git_branch,
        github_token=str(github_token),
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        credentials=normalize_provision_credentials(credential_payloads),
        repo_env_vars=(
            decrypt_json(workspace.repo_env_vars_ciphertext)
            if workspace.repo_env_vars_ciphertext
            else {}
        ),
    )


def _emit_cloud_event(message: str, payload: dict[str, object]) -> None:
    log_cloud_event(message, **payload)  # type: ignore[arg-type]


async def _set_workspace_status(
    workspace_id: UUID,
    status: WorkspaceStatus,
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
        workspace_id=ctx.workspace_id,
        sandbox_id=sandbox_record_id,
        external_sandbox_id=handle.sandbox_id,
        sandbox_execution_id=None,
        started_at=started_at,
        opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
    )

    await _set_workspace_status(
        ctx.workspace_id,
        WorkspaceStatus.provisioning,
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
            WorkspaceStatus.provisioning,
            detail="Using prebuilt AnyHarness binary",
        )
        tracker.begin(ProvisionStep.stage_runtime_binary)
        tracker.complete(skipped=True, reason="template_binary_present")

        await _set_workspace_status(
            ctx.workspace_id,
            WorkspaceStatus.provisioning,
            detail="Using prebuilt Node.js runtime",
        )
        tracker.begin(ProvisionStep.check_node_runtime)
        tracker.complete(skipped=True, reason="template_runtime_present")
        return

    await _set_workspace_status(
        ctx.workspace_id,
        WorkspaceStatus.provisioning,
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
        WorkspaceStatus.provisioning,
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
            WorkspaceStatus.provisioning,
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
        WorkspaceStatus.starting_runtime,
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

    synced_providers = ctx.credentials.synced_providers
    await _set_workspace_status(
        ctx.workspace_id,
        WorkspaceStatus.starting_runtime,
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
        WorkspaceStatus.starting_runtime,
        detail="Resolving workspace",
    )
    tracker.begin(
        ProvisionStep.resolve_remote_workspace,
        runtime_url=connected.endpoint.runtime_url,
    )
    anyharness_workspace_id = await resolve_remote_workspace(
        connected.endpoint.runtime_url,
        runtime_token,
        runtime_workdir=connected.runtime_context.runtime_workdir,
        workspace_id=ctx.workspace_id,
    )
    tracker.complete(anyharness_workspace_id=anyharness_workspace_id)

    return connected, RuntimeHandshake(
        runtime_token=runtime_token,
        ready_agents=ready_agents,
        anyharness_workspace_id=anyharness_workspace_id,
    )


async def provision_workspace(workspace_id: UUID) -> None:
    provision_started = time.perf_counter()
    tracker = _StepTracker(workspace_id=workspace_id)
    ctx: CloudProvisionInput | None = None
    provider: SandboxProvider | None = None
    connected: ConnectedSandbox | None = None
    sandbox_record_id: UUID | None = None

    try:
        ctx = await _load_provision_input(workspace_id)
        if ctx is None:
            return
        provider = get_configured_sandbox_provider()

        log_cloud_event(
            "cloud workspace provisioning started",
            workspace_id=workspace_id,
            provider=provider.kind,
            repo=ctx.repo_label,
            base_branch=ctx.git_base_branch,
            branch_name=ctx.git_branch,
        )
        await _set_workspace_status(
            workspace_id,
            WorkspaceStatus.provisioning,
            detail="Allocating sandbox",
        )
        sandbox_record = await create_and_attach_sandbox_for_workspace(
            workspace_id,
            external_sandbox_id=None,
            provider=provider.kind.value,
            template_version=provider.template_version,
            status="allocating",
            started_at=None,
        )
        sandbox_record_id = sandbox_record.id
        connected = await _create_and_connect_sandbox(
            tracker,
            ctx,
            provider,
            sandbox_record_id=sandbox_record.id,
        )

        await _set_workspace_status(
            workspace_id,
            WorkspaceStatus.provisioning,
            detail="Checking prebuilt runtime template",
        )
        await _prepare_runtime_template(tracker, ctx, provider, connected)

        await _set_workspace_status(
            workspace_id,
            WorkspaceStatus.syncing_credentials,
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
        tracker.complete()

        await _set_workspace_status(
            workspace_id,
            WorkspaceStatus.cloning_repo,
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
            WorkspaceStatus.cloning_repo,
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
            WorkspaceStatus.cloning_repo,
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

        await _set_workspace_status(
            workspace_id,
            WorkspaceStatus.starting_runtime,
            detail="Starting AnyHarness",
        )
        connected, handshake = await _launch_and_connect_runtime(tracker, ctx, provider, connected)

        await finalize_workspace_provision_for_ids(
            workspace_id,
            sandbox_record.id,
            runtime_url=connected.endpoint.runtime_url,
            runtime_token_ciphertext=encrypt_text(handshake.runtime_token),
            anyharness_workspace_id=handshake.anyharness_workspace_id,
            template_version=connected.handle.template_version,
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
        if provider is not None and external_sandbox_id:
            try:
                await provider.destroy_sandbox(external_sandbox_id)
            except Exception:
                log_cloud_event(
                    "cloud workspace failed provisioning sandbox destroy failed",
                    level=logging.WARNING,
                    workspace_id=workspace_id,
                    external_sandbox_id=external_sandbox_id,
                )
        if sandbox_record is not None:
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
