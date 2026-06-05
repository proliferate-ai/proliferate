"""Fresh provisioning flow for cloud workspaces."""

from __future__ import annotations

import logging
import secrets
import time
from urllib.parse import urlparse
from uuid import UUID

from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.config import settings
from proliferate.constants.billing import USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE
from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.constants.cloud import WorkspaceStatus as LegacyWorkspaceStatus
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_sandboxes
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_repo_config import (
    get_organization_cloud_repo_config,
    load_cloud_repo_config_for_user,
)
from proliferate.db.store.cloud_runtime_environments import (
    attach_target_to_runtime_environment,
    ensure_runtime_environment_for_workspace_id,
    save_runtime_environment_state,
)
from proliferate.db.store.cloud_sandboxes import (
    load_cloud_sandbox_by_id,
    update_sandbox_status,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspaces import (
    finalize_workspace_provision_for_ids,
    load_cloud_workspace_by_id,
    mark_workspace_error_by_id,
    update_workspace_status_by_id,
)
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.integrations.sandbox import (
    SandboxProvider,
    get_configured_sandbox_provider,
)
from proliferate.server.billing.service import (
    authorize_sandbox_start,
    record_cloud_sandbox_usage_stopped,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.runtime.bootstrap import build_runtime_env
from proliferate.server.cloud.runtime.bundle import (
    check_runtime_bundle_preinstalled,
    stage_runtime_bundle,
)
from proliferate.server.cloud.runtime.config_sync.repo_config import (
    WorkspaceRuntimeAccess,
    apply_workspace_repo_config_after_provision,
)
from proliferate.server.cloud.runtime.config_sync.worktree_policy import (
    sync_cloud_worktree_policy_to_runtime,
)
from proliferate.server.cloud.runtime.credentials.auth_status import (
    selected_agent_auth_agent_kinds,
)
from proliferate.server.cloud.runtime.domain.runtime_state import runtime_ready_update
from proliferate.server.cloud.runtime.git_operations import (
    checkout_cloud_branch,
    clone_repository,
    configure_git_identity,
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
from proliferate.server.cloud.runtime.provisioning.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.provisioning.launch import (
    launch_supervised_runtime_bundle as _launch_supervised_runtime_bundle,
)
from proliferate.server.cloud.runtime.provisioning.launch import (
    refresh_runtime_config_and_apply as _refresh_runtime_config_and_apply,
)
from proliferate.server.cloud.runtime.provisioning.launch import (
    request_agent_auth_refresh_and_wait as _request_agent_auth_refresh_and_wait,
)
from proliferate.server.cloud.runtime.provisioning.launch import (
    wait_for_worker_target_online as _wait_for_worker_target_online,
)
from proliferate.server.cloud.runtime.provisioning.launch import (
    wake_reused_runtime_if_worker_stale as _wake_reused_runtime_if_worker_stale,
)
from proliferate.server.cloud.runtime.provisioning.sandbox_lifecycle import (
    connect_existing_environment_sandbox as _connect_existing_environment_sandbox,
)
from proliferate.server.cloud.runtime.provisioning.sandbox_lifecycle import (
    connect_existing_profile_sandbox as _connect_existing_profile_sandbox,
)
from proliferate.server.cloud.runtime.provisioning.sandbox_lifecycle import (
    create_and_connect_sandbox as _create_and_connect_sandbox,
)
from proliferate.server.cloud.runtime.provisioning.sandbox_lifecycle import (
    persist_target_runtime_access as _persist_target_runtime_access,
)
from proliferate.server.cloud.runtime.provisioning.sandbox_lifecycle import (
    save_runtime_environment_updates as _save_runtime_environment_updates,
)
from proliferate.server.cloud.runtime.provisioning.step_tracker import (
    ProvisionStepTracker as _StepTracker,
)
from proliferate.server.cloud.runtime.provisioning.workspace import (
    attach_workspace_to_running_runtime as _attach_workspace_to_running_runtime,
)
from proliferate.server.cloud.runtime.provisioning.workspace import (
    prepare_workspace_in_runtime as _prepare_workspace_in_runtime,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    collect_runtime_debug_report,
)
from proliferate.server.cloud.runtime.toolchains import check_node_runtime, install_node_runtime
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import duration_ms, utcnow

WorkspaceStatus = LegacyWorkspaceStatus


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
    async with db_engine.async_session_factory() as db:
        workspace = await load_cloud_workspace_by_id(db, workspace_id)
    if workspace is None:
        return None

    async with db_engine.async_session_factory() as db, db.begin():
        runtime_environment = await ensure_runtime_environment_for_workspace_id(db, workspace_id)
        if runtime_environment and not runtime_environment.anyharness_data_key_ciphertext:
            runtime_environment = await save_runtime_environment_state(
                db,
                runtime_environment.id,
                anyharness_data_key_ciphertext=encrypt_text(generate_anyharness_data_key()),
            )
    if runtime_environment is None:
        return None
    anyharness_data_key_ciphertext = runtime_environment.anyharness_data_key_ciphertext
    if anyharness_data_key_ciphertext is None:
        raise CloudApiError(
            "runtime_data_key_required",
            "Cloud runtime data key could not be prepared.",
            status_code=500,
        )

    async with db_engine.async_session_factory() as db:
        user = await load_user_with_oauth_accounts_by_id(db, workspace.user_id)
        github_grant = await get_ready_github_grant_for_user(db, user_id=workspace.user_id)
    if user is None:
        return None
    if github_grant is None:
        raise CloudApiError(
            "github_link_required",
            "Linked GitHub account is missing an access token.",
            status_code=400,
        )
    git_user_name, git_user_email = _resolve_git_identity(user, github_grant)

    async with db_engine.async_session_factory() as db, db.begin():
        if workspace.sandbox_profile_id is not None and workspace.target_id is not None:
            profile = await agent_auth_store.get_sandbox_profile(db, workspace.sandbox_profile_id)
            target = await targets_store.get_target_by_id(db, workspace.target_id)
            if profile is None or target is None:
                raise CloudApiError(
                    "sandbox_profile_not_found",
                    "Cloud sandbox profile could not be prepared.",
                    status_code=500,
                )
            if target.sandbox_profile_id != profile.id:
                raise CloudApiError(
                    "cloud_target_profile_mismatch",
                    "Cloud target is not attached to the workspace sandbox profile.",
                    status_code=409,
                )
        elif workspace.owner_scope == "organization":
            if workspace.organization_id is None:
                raise CloudApiError(
                    "organization_required",
                    "Organization cloud workspaces require an organization.",
                    status_code=400,
                )
            profile = await agent_auth_store.ensure_organization_sandbox_profile(
                db,
                organization_id=workspace.organization_id,
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
        else:
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

    if workspace.owner_scope == "organization" and workspace.organization_id is not None:
        async with db_engine.async_session_factory() as db:
            repo_config = await get_organization_cloud_repo_config(
                db,
                organization_id=workspace.organization_id,
                git_owner=workspace.git_owner,
                git_repo_name=workspace.git_repo_name,
            )
    else:
        async with db_engine.async_session_factory() as db:
            repo_config = await load_cloud_repo_config_for_user(
                db,
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


_LOCAL_CLOUD_BASE_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def _is_local_cloud_base_url(value: str) -> bool:
    parsed = urlparse(value)
    hostname = (parsed.hostname or "").lower()
    return hostname in _LOCAL_CLOUD_BASE_HOSTS or hostname.endswith(".localhost")


def _cloud_base_url() -> str:
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
        " Managed cloud provisioning is currently configured only with local callback URLs: "
        + ", ".join(f"{source}={value}" for source, value in local_candidates)
        + "."
        if local_candidates
        else ""
    )
    raise CloudApiError(
        "cloud_worker_base_url_required",
        "Managed cloud worker enrollment requires CLOUD_WORKER_BASE_URL to be a public URL "
        "reachable from the sandbox. Start an HTTPS tunnel to this server and set "
        "CLOUD_WORKER_BASE_URL to that tunnel URL." + detail,
        status_code=400,
    )


async def _log_runtime_diagnostics(
    message: str,
    *,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    workspace_id: UUID,
) -> None:
    debug_report = await collect_runtime_debug_report(
        provider,
        connected.sandbox,
        workspace_id=workspace_id,
        runtime_context=connected.runtime_context,
    )
    log_cloud_event(
        message,
        level=logging.WARNING,
        workspace_id=workspace_id,
        runtime_url=connected.endpoint.runtime_url,
        launcher_preview=debug_report.get("launcher"),
        log_preview=debug_report.get("log"),
        supervisor_config_preview=debug_report.get("supervisor_config"),
        supervisor_log_preview=debug_report.get("supervisor_log"),
        process_preview=debug_report.get("processes"),
        binary_preview=debug_report.get("binary"),
        workdir_preview=debug_report.get("workdir"),
    )


async def _set_workspace_status(
    workspace_id: UUID,
    status: CloudWorkspaceStatus,
    detail: str | None = None,
) -> None:
    resolved_detail = detail or str(status).replace("_", " ").title()
    async with db_engine.async_session_factory() as db, db.begin():
        await update_workspace_status_by_id(
            db,
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


async def _launch_and_connect_runtime(
    tracker: _StepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    connected: ConnectedSandbox,
    *,
    cloud_base_url: str,
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
        cloud_base_url=cloud_base_url,
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
        await _log_runtime_diagnostics(
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
    await _set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Waiting for Proliferate Worker enrollment",
    )
    tracker.begin(ProvisionStep.start_worker_process, target_id=str(target_id))
    try:
        await _wait_for_worker_target_online(target_id, workspace_id=ctx.workspace_id)
    except Exception:
        await _log_runtime_diagnostics(
            "cloud worker enrollment diagnostics",
            provider=provider,
            connected=connected,
            workspace_id=ctx.workspace_id,
        )
        raise
    tracker.complete(target_id=str(target_id))
    await _request_agent_auth_refresh_and_wait(
        tracker,
        ctx,
        reason="workspace_provision",
        force_restart=False,
        set_workspace_status=_set_workspace_status,
    )
    await _refresh_runtime_config_and_apply(
        tracker,
        ctx,
        runtime_url=connected.endpoint.runtime_url,
        access_token=runtime_token,
        reason="workspace_provision",
        set_workspace_status=_set_workspace_status,
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
        set_workspace_status=_set_workspace_status,
    )

    return connected, handshake


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
    worker_cloud_base_url: str | None = None
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

        reused_runtime = await _connect_existing_profile_sandbox(tracker, ctx, provider)
        if reused_runtime is None:
            reused_runtime = await _connect_existing_environment_sandbox(tracker, ctx, provider)
        if reused_runtime is not None:
            connected, sandbox_record_id, runtime_token = reused_runtime
        else:
            worker_cloud_base_url = _cloud_base_url()
            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Allocating sandbox",
            )
            async with db_engine.async_session_factory() as db, db.begin():
                profile = await agent_auth_store.get_sandbox_profile(db, ctx.sandbox_profile_id)
                if profile is None:
                    raise CloudApiError(
                        "sandbox_profile_not_found",
                        "Cloud sandbox profile could not be prepared.",
                        status_code=500,
                    )
                sandbox_record = await cloud_sandboxes.ensure_managed_sandbox_for_target(
                    db,
                    sandbox_profile_id=ctx.sandbox_profile_id,
                    target_id=ctx.target_id,
                    billing_subject_id=profile.billing_subject_id,
                    provider=provider.kind.value,
                    template_version=provider.template_version,
                    status="creating",
                )
            sandbox_record_id = sandbox_record.id
            if getattr(sandbox_record, "external_sandbox_id", None):
                raise CloudApiError(
                    "cloud_sandbox_reuse_unavailable",
                    "Existing managed cloud sandbox could not be reused safely.",
                    status_code=409,
                )
            allocated_sandbox_this_attempt = True
            connected = await _create_and_connect_sandbox(
                tracker,
                ctx,
                provider,
                sandbox_record=sandbox_record,
                set_workspace_status=_set_workspace_status,
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
            connected, sandbox_record_id, runtime_token = reused_runtime
            await _set_workspace_status(
                workspace_id,
                CloudWorkspaceStatus.materializing,
                detail="Waiting for Proliferate Worker enrollment",
            )
            tracker.begin(ProvisionStep.start_worker_process, target_id=str(ctx.target_id))
            worker_wake_ran = False
            try:
                worker_wake_ran = await _wake_reused_runtime_if_worker_stale(
                    ctx,
                    set_workspace_status=_set_workspace_status,
                )
                await _wait_for_worker_target_online(ctx.target_id, workspace_id=ctx.workspace_id)
            except Exception:
                await _log_runtime_diagnostics(
                    "cloud worker enrollment diagnostics",
                    provider=provider,
                    connected=connected,
                    workspace_id=ctx.workspace_id,
                )
                raise
            tracker.complete(
                target_id=str(ctx.target_id),
                reused_runtime=True,
                worker_wake_ran=worker_wake_ran,
            )
            await _request_agent_auth_refresh_and_wait(
                tracker,
                ctx,
                reason="workspace_reuse",
                force_restart=False,
                set_workspace_status=_set_workspace_status,
            )
            await _refresh_runtime_config_and_apply(
                tracker,
                ctx,
                runtime_url=connected.endpoint.runtime_url,
                access_token=runtime_token,
                reason="workspace_reuse",
                set_workspace_status=_set_workspace_status,
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
                set_workspace_status=_set_workspace_status,
            )
        else:
            if worker_cloud_base_url is None:
                worker_cloud_base_url = _cloud_base_url()
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
                cloud_base_url=worker_cloud_base_url,
            )
            launched_runtime_this_attempt = True

        runtime_token_ciphertext = encrypt_text(handshake.runtime_token)
        anyharness_data_key_ciphertext = encrypt_text(ctx.anyharness_data_key)
        async with db_engine.async_session_factory() as db, db.begin():
            await finalize_workspace_provision_for_ids(
                db,
                workspace_id,
                sandbox_record_id,
                runtime_url=connected.endpoint.runtime_url,
                runtime_token_ciphertext=runtime_token_ciphertext,
                anyharness_workspace_id=handshake.anyharness_workspace_id,
                template_version=connected.handle.template_version,
            )
        await _persist_target_runtime_access(
            ctx,
            sandbox_record_id=sandbox_record_id,
            runtime_url=connected.endpoint.runtime_url,
            runtime_token_ciphertext=runtime_token_ciphertext,
            anyharness_data_key_ciphertext=anyharness_data_key_ciphertext,
        )
        runtime_state_updates = runtime_ready_update(
            runtime_url=connected.endpoint.runtime_url,
            runtime_token_ciphertext=runtime_token_ciphertext,
            root_anyharness_workspace_id=handshake.root_anyharness_workspace_id,
            root_anyharness_repo_root_id=handshake.anyharness_repo_root_id,
            active_sandbox_id=sandbox_record_id,
            launched_runtime=launched_runtime_this_attempt,
            repo_env_applied_version=ctx.repo_env_version,
        )
        await _save_runtime_environment_updates(ctx.runtime_environment_id, runtime_state_updates)
        async with db_engine.async_session_factory() as db:
            provisioned_workspace = await load_cloud_workspace_by_id(db, workspace_id)
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
        if sandbox_record_id:
            async with db_engine.async_session_factory() as db:
                sandbox_record = await load_cloud_sandbox_by_id(db, sandbox_record_id)
        else:
            sandbox_record = None
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
            await record_cloud_sandbox_usage_stopped(
                sandbox_id=sandbox_record.id,
                ended_at=utcnow(),
                closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
                is_billable=False,
            )
            async with db_engine.async_session_factory() as db, db.begin():
                await update_sandbox_status(db, sandbox_record, "destroyed", stopped_at_now=True)
        async with db_engine.async_session_factory() as db, db.begin():
            await mark_workspace_error_by_id(
                db,
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
