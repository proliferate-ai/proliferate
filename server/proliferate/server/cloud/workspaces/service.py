from __future__ import annotations

import logging
import time
from uuid import UUID

from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    USAGE_SEGMENT_CLOSED_BY_DESTROY,
    USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
    USAGE_SEGMENT_OPENED_BY_RESUME,
    WORKSPACE_ACTION_BLOCK_KIND_BILLING_QUOTA,
)
from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER, WorkspaceStatus
from proliferate.db.models.auth import User
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
)
from proliferate.db.store.cloud_workspaces import (
    create_cloud_workspace_for_user,
    delete_cloud_workspace_records_for_workspace,
    load_active_sandbox_for_workspace,
    load_any_cloud_workspace_for_repo,
    load_cloud_workspace_by_id,
    load_cloud_workspace_for_user,
    load_existing_cloud_workspace,
    mark_workspace_error_by_id,
    persist_workspace_destroy_state,
    persist_workspace_stop_state,
    save_workspace,
    save_workspace_branch_for_user,
    save_workspace_display_name_for_user,
    update_sandbox_status,
)
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces_for_user as list_cloud_workspaces_store,
)
from proliferate.integrations.sandbox import get_configured_sandbox_provider, get_sandbox_provider
from proliferate.server.billing.models import BillingSnapshot
from proliferate.server.billing.service import get_billing_snapshot
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.credentials.models import allowed_agent_kinds
from proliferate.server.cloud.credentials.service import load_cloud_credential_statuses
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repo_config.service import (
    bootstrap_repo_config,
    load_repo_config_value,
)
from proliferate.server.cloud.repos.service import (
    get_linked_github_account,
)
from proliferate.server.cloud.repos.service import (
    get_repo_branches_for_user as get_github_repo_branches,
)
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeReconnectError
from proliferate.server.cloud.runtime.ensure_running import ensure_workspace_runtime_ready
from proliferate.server.cloud.runtime.scheduler import schedule_workspace_provision
from proliferate.server.cloud.runtime.service import (
    get_workspace_connection,
    sync_workspace_credentials,
)
from proliferate.server.cloud.workspaces.models import (
    WorkspaceConnection,
    WorkspaceDetail,
    WorkspaceSummary,
    workspace_detail_payload,
    workspace_summary_payload,
)
from proliferate.utils.crypto import decrypt_text, encrypt_json
from proliferate.utils.time import duration_ms, utcnow

MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS = 160

PROVISIONING_STATUSES: frozenset[WorkspaceStatus] = frozenset(
    {
        WorkspaceStatus.queued,
        WorkspaceStatus.provisioning,
        WorkspaceStatus.syncing_credentials,
        WorkspaceStatus.cloning_repo,
        WorkspaceStatus.starting_runtime,
    }
)

# Valid status transitions.  Each key lists the statuses that may follow it.
# Every active or terminal state allows ``stopped`` so that workspace deletion
# (destroy) is always permitted, and ``error`` is reachable from any state.
VALID_TRANSITIONS: dict[WorkspaceStatus, frozenset[WorkspaceStatus]] = {
    WorkspaceStatus.queued: frozenset(
        {WorkspaceStatus.provisioning, WorkspaceStatus.stopped, WorkspaceStatus.error}
    ),
    WorkspaceStatus.provisioning: frozenset(
        {WorkspaceStatus.syncing_credentials, WorkspaceStatus.stopped, WorkspaceStatus.error}
    ),
    WorkspaceStatus.syncing_credentials: frozenset(
        {WorkspaceStatus.cloning_repo, WorkspaceStatus.stopped, WorkspaceStatus.error}
    ),
    WorkspaceStatus.cloning_repo: frozenset(
        {WorkspaceStatus.starting_runtime, WorkspaceStatus.stopped, WorkspaceStatus.error}
    ),
    WorkspaceStatus.starting_runtime: frozenset(
        {WorkspaceStatus.ready, WorkspaceStatus.stopped, WorkspaceStatus.error}
    ),
    WorkspaceStatus.ready: frozenset(
        {WorkspaceStatus.queued, WorkspaceStatus.stopped, WorkspaceStatus.error}
    ),
    WorkspaceStatus.stopped: frozenset(
        {WorkspaceStatus.queued, WorkspaceStatus.ready, WorkspaceStatus.error}
    ),
    WorkspaceStatus.error: frozenset({WorkspaceStatus.queued, WorkspaceStatus.stopped}),
}


def transition_workspace_status(
    workspace: CloudWorkspace,
    target: WorkspaceStatus,
    *,
    status_detail: str | None = None,
) -> None:
    """Move *workspace* to *target*, enforcing the transition map.

    Raises ``CloudApiError`` when the transition is not allowed.
    ``status_detail`` overrides the human-readable detail; when *None* the
    detail is derived from the target status.
    """
    try:
        current = WorkspaceStatus(workspace.status)
    except ValueError:
        current = WorkspaceStatus.error
    allowed = VALID_TRANSITIONS.get(current)
    if allowed is None or target not in allowed:
        raise CloudApiError(
            "invalid_status_transition",
            f"Cannot transition workspace from '{workspace.status}' to '{target}'.",
            status_code=409,
        )
    workspace.status = target
    workspace.status_detail = status_detail or target.replace("_", " ").title()
    workspace.updated_at = utcnow()


async def list_cloud_workspaces_for_user(
    user_id: UUID,
) -> list[WorkspaceSummary]:
    workspaces = await list_cloud_workspaces_store(user_id)
    billing = await get_billing_snapshot(user_id)
    summaries: list[WorkspaceSummary] = []
    for workspace in workspaces:
        action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
        summaries.append(
            workspace_summary_payload(
                workspace,
                action_block_kind=action_block_kind,
                action_block_reason=action_block_reason,
            )
        )
    return summaries


async def _require_cloud_workspace_for_user(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    workspace = await load_cloud_workspace_for_user(user_id, workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return workspace


def _prefer_fresher_workspace_state(
    workspace: CloudWorkspace,
    reloaded_workspace: CloudWorkspace | None,
) -> CloudWorkspace:
    if reloaded_workspace is None:
        return workspace
    if reloaded_workspace.updated_at >= workspace.updated_at:
        return reloaded_workspace
    return workspace


def _cloud_workspace_block_message(blocked_reason: str | None) -> str:
    if blocked_reason == "concurrency_limit":
        return (
            "Cloud usage is currently blocked because you've reached the concurrent sandbox limit."
        )
    return "Cloud usage is currently blocked because your included sandbox hours are exhausted."


def _raise_if_cloud_workspace_blocked(*, blocked: bool, blocked_reason: str | None) -> None:
    if not blocked:
        return
    raise CloudApiError(
        "quota_exceeded",
        _cloud_workspace_block_message(blocked_reason),
        status_code=403,
    )


def _workspace_action_block(
    workspace: CloudWorkspace,
    billing: BillingSnapshot,
) -> tuple[str | None, str | None]:
    if billing.billing_mode != BILLING_MODE_ENFORCE or not billing.blocked:
        return None, None
    if workspace.status == WorkspaceStatus.ready:
        return None, None
    return (
        WORKSPACE_ACTION_BLOCK_KIND_BILLING_QUOTA,
        _cloud_workspace_block_message(billing.blocked_reason),
    )


def _provider_state_is_running(state: str | None) -> bool:
    return state in {"running", "started"}


async def get_cloud_workspace_detail(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    return await _build_workspace_detail(user_id, workspace)


async def _build_workspace_detail(
    user_id: UUID,
    workspace: CloudWorkspace,
) -> WorkspaceDetail:
    statuses = await load_cloud_credential_statuses(workspace.user_id)
    billing = await get_billing_snapshot(user_id)
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    return workspace_detail_payload(
        workspace,
        statuses,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
    )


async def create_cloud_workspace(
    user: User,
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str,
    branch_name: str,
    display_name: str | None,
) -> WorkspaceDetail:
    if git_provider != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "unsupported_repo_provider",
            "Only GitHub repositories are supported for cloud workspaces.",
            status_code=400,
        )

    if get_linked_github_account(user) is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before creating a cloud workspace.",
            status_code=400,
        )

    cleaned_base_branch = base_branch.strip()
    cleaned_branch_name = branch_name.strip()
    if not cleaned_base_branch or not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a base branch and a new cloud branch before creating a cloud workspace.",
            status_code=400,
        )

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before creating a cloud workspace.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before creating a cloud workspace."
        ),
    )
    if cleaned_base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{cleaned_base_branch}' was not found on GitHub.",
            status_code=400,
        )
    if cleaned_branch_name in repo_branches.branches:
        raise CloudApiError(
            "github_branch_already_exists",
            f"The branch '{cleaned_branch_name}' already exists on GitHub.",
            status_code=400,
        )

    repo_config = await load_repo_config_value(
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if repo_config is None or not repo_config.configured:
        existing_repo_workspace = await load_any_cloud_workspace_for_repo(
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        if existing_repo_workspace is None:
            raise CloudApiError(
                "cloud_repo_not_configured",
                "Configure cloud settings for this repo before creating a cloud workspace.",
                status_code=409,
            )
        repo_config = await bootstrap_repo_config(
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        log_cloud_event(
            "cloud repo config auto-bootstrapped",
            user_id=user.id,
            repo=f"{git_owner}/{git_repo_name}",
        )

    existing_cloud_workspace = await load_existing_cloud_workspace(
        user_id=user.id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
    )
    if existing_cloud_workspace is not None:
        raise CloudApiError(
            "cloud_branch_already_exists",
            (
                f"A cloud workspace already exists for branch '{cleaned_branch_name}'. "
                "Open the existing cloud workspace or choose a different cloud branch."
            ),
            status_code=400,
        )

    billing = await get_billing_snapshot(user.id)
    _raise_if_cloud_workspace_blocked(
        blocked=billing.blocked,
        blocked_reason=billing.blocked_reason,
    )

    statuses = await load_cloud_credential_statuses(user.id)
    if not any(status.synced for status in statuses):
        raise CloudApiError(
            "missing_supported_credentials",
            "Sync a supported cloud credential before creating a cloud workspace.",
            status_code=400,
        )
    log_cloud_event(
        "cloud workspace create validated",
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=cleaned_base_branch,
        branch_name=cleaned_branch_name,
        synced_providers=",".join(status.provider for status in statuses if status.synced),
        used_sandbox_hours=round(billing.used_hours, 4),
        active_sandbox_count=billing.active_sandbox_count,
    )

    workspace = await create_cloud_workspace_for_user(
        user_id=user.id,
        display_name=(display_name.strip() if display_name and display_name.strip() else None),
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=cleaned_base_branch,
        template_version=get_configured_sandbox_provider().template_version,
        repo_env_vars_ciphertext=encrypt_json(repo_config.env_vars),
    )
    log_cloud_event(
        "cloud workspace queued",
        workspace_id=workspace.id,
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=cleaned_base_branch,
        branch_name=cleaned_branch_name,
    )
    schedule_workspace_provision(workspace.id)
    return await _build_workspace_detail(user.id, workspace)


async def ensure_cloud_workspace_for_existing_branch(
    user: User,
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    branch_name: str,
    display_name: str | None,
) -> CloudWorkspace:
    if git_provider != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "unsupported_repo_provider",
            "Only GitHub repositories are supported for cloud workspaces.",
            status_code=400,
        )

    if get_linked_github_account(user) is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before provisioning a cloud workspace.",
            status_code=400,
        )

    cleaned_branch_name = branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a branch before provisioning a cloud workspace.",
            status_code=400,
        )

    existing_cloud_workspace = await load_existing_cloud_workspace(
        user_id=user.id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
    )
    if existing_cloud_workspace is not None:
        return existing_cloud_workspace

    repo_config = await load_repo_config_value(
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if repo_config is None or not repo_config.configured:
        repo_config = await bootstrap_repo_config(
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        log_cloud_event(
            "cloud repo config auto-bootstrapped",
            user_id=user.id,
            repo=f"{git_owner}/{git_repo_name}",
        )

    workspace = await create_cloud_workspace_for_user(
        user_id=user.id,
        display_name=(display_name.strip() if display_name and display_name.strip() else None),
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=cleaned_branch_name,
        template_version=get_configured_sandbox_provider().template_version,
        repo_env_vars_ciphertext=encrypt_json(repo_config.env_vars),
    )
    log_cloud_event(
        "cloud workspace ensured for mobility",
        workspace_id=workspace.id,
        repo=f"{git_owner}/{git_repo_name}",
        branch_name=cleaned_branch_name,
    )
    return workspace


async def _refresh_repo_env_snapshot_for_workspace(
    workspace: CloudWorkspace,
) -> CloudWorkspace:
    repo_config = await load_repo_config_value(
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
    )
    if repo_config is None or not repo_config.configured:
        repo_config = await bootstrap_repo_config(
            user_id=workspace.user_id,
            git_owner=workspace.git_owner,
            git_repo_name=workspace.git_repo_name,
        )
        log_cloud_event(
            "cloud repo config auto-bootstrapped",
            user_id=workspace.user_id,
            repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
        )
    workspace.repo_env_vars_ciphertext = encrypt_json(repo_config.env_vars)
    return await save_workspace(workspace)


async def start_cloud_workspace(
    user: User,
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user.id, workspace_id)
    if workspace.status in PROVISIONING_STATUSES and workspace.status != WorkspaceStatus.queued:
        return await _build_workspace_detail(user.id, workspace)

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        missing_access_message="Connect a GitHub account before starting a cloud workspace.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before starting a cloud workspace."
        ),
    )
    base_branch = workspace.git_base_branch or workspace.git_branch
    if base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{base_branch}' was not found on GitHub.",
            status_code=400,
        )

    billing = await get_billing_snapshot(user.id)
    _raise_if_cloud_workspace_blocked(
        blocked=billing.blocked,
        blocked_reason=billing.blocked_reason,
    )

    statuses = await load_cloud_credential_statuses(user.id)
    if not any(status.synced for status in statuses):
        raise CloudApiError(
            "missing_supported_credentials",
            "Sync a supported cloud credential before starting a cloud workspace.",
            status_code=400,
        )
    log_cloud_event(
        "cloud workspace start validated",
        workspace_id=workspace.id,
        repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
        base_branch=base_branch,
        branch_name=workspace.git_branch,
        synced_providers=",".join(status.provider for status in statuses if status.synced),
        used_sandbox_hours=round(billing.used_hours, 4),
        active_sandbox_count=billing.active_sandbox_count,
    )

    if workspace.ready_at is None:
        workspace = await _refresh_repo_env_snapshot_for_workspace(workspace)

    if workspace.status == WorkspaceStatus.queued:
        workspace.last_error = None
        await save_workspace(workspace)
        log_cloud_event(
            "cloud workspace queued",
            workspace_id=workspace.id,
            repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
            base_branch=base_branch,
            branch_name=workspace.git_branch,
            requested_base_sha=requested_base_sha,
        )
        schedule_workspace_provision(
            workspace.id,
            requested_base_sha=requested_base_sha,
        )
        return await _build_workspace_detail(user.id, workspace)

    sandbox = await load_active_sandbox_for_workspace(workspace)
    if (
        sandbox is not None
        and sandbox.external_sandbox_id
        and workspace.runtime_url
        and workspace.runtime_token_ciphertext
        and workspace.anyharness_workspace_id
    ):
        try:
            provider = get_sandbox_provider(sandbox.provider)
            sandbox_state = await provider.get_sandbox_state(sandbox.external_sandbox_id)
            if sandbox_state is None or sandbox_state.state in {
                "killed",
                "destroyed",
                "terminated",
            }:
                raise CloudRuntimeReconnectError("Cloud sandbox is no longer available.")
            if not _provider_state_is_running(sandbox_state.state):
                await provider.resume_sandbox(sandbox.external_sandbox_id)
                resumed_at = utcnow()
                await update_sandbox_status(sandbox, "running", started_at=resumed_at)
                await open_usage_segment_for_sandbox(
                    user_id=workspace.user_id,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                    sandbox_execution_id=None,
                    started_at=resumed_at,
                    opened_by=USAGE_SEGMENT_OPENED_BY_RESUME,
                )
            access_token = decrypt_text(workspace.runtime_token_ciphertext)
            await ensure_workspace_runtime_ready(
                workspace,
                allow_launcher_restart=True,
                access_token=access_token,
            )
            workspace = _prefer_fresher_workspace_state(
                workspace,
                await load_cloud_workspace_by_id(workspace.id),
            )
            if workspace.status != WorkspaceStatus.ready:
                transition_workspace_status(
                    workspace,
                    WorkspaceStatus.ready,
                    status_detail="Ready",
                )
                await save_workspace(workspace)
                workspace = _prefer_fresher_workspace_state(
                    workspace,
                    await load_cloud_workspace_by_id(workspace.id),
                )
            return await _build_workspace_detail(user.id, workspace)
        except Exception as exc:
            reconnect_error = (
                exc
                if isinstance(exc, CloudRuntimeReconnectError)
                else CloudRuntimeReconnectError(format_exception_message(exc))
            )
            await mark_workspace_error_by_id(
                workspace.id,
                str(reconnect_error),
                status_detail="Reconnect failed",
                clear_runtime_metadata=True,
            )
            log_cloud_event(
                "cloud workspace reconnect failed",
                level=logging.WARNING,
                workspace_id=workspace.id,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
            workspace = await _require_cloud_workspace_for_user(user.id, workspace_id)

    transition_workspace_status(workspace, WorkspaceStatus.queued, status_detail="Queued")
    workspace.last_error = None
    await save_workspace(workspace)
    log_cloud_event(
        "cloud workspace restart queued",
        workspace_id=workspace.id,
        repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
        base_branch=base_branch,
        branch_name=workspace.git_branch,
        requested_base_sha=requested_base_sha,
    )
    schedule_workspace_provision(
        workspace.id,
        requested_base_sha=requested_base_sha,
    )
    return await _build_workspace_detail(user.id, workspace)


async def sync_cloud_workspace_branch(
    user_id: UUID,
    workspace_id: UUID,
    *,
    branch_name: str,
) -> WorkspaceDetail:
    cleaned_branch_name = branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Branch name is required.",
            status_code=400,
        )

    workspace = await save_workspace_branch_for_user(
        user_id=user_id,
        workspace_id=workspace_id,
        branch_name=cleaned_branch_name,
    )
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return await _build_workspace_detail(user_id, workspace)


async def sync_cloud_workspace_display_name(
    user_id: UUID,
    workspace_id: UUID,
    *,
    display_name: str | None,
) -> WorkspaceDetail:
    """Set or clear the user-provided cloud workspace display name.

    `display_name=None` (or an empty/whitespace string) clears the override
    and restores the default branch- or repo-derived label in the sidebar.
    """

    cleaned: str | None
    if display_name is None or not display_name.strip():
        cleaned = None
    else:
        cleaned = display_name.strip()
        if len(cleaned) > MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS:
            raise CloudApiError(
                "invalid_display_name",
                (
                    "Workspace display name cannot exceed "
                    f"{MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS} characters."
                ),
                status_code=400,
            )

    workspace = await save_workspace_display_name_for_user(
        user_id=user_id,
        workspace_id=workspace_id,
        display_name=cleaned,
    )
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    return await _build_workspace_detail(user_id, workspace)


async def sync_cloud_workspace_credentials(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    await sync_workspace_credentials(workspace)
    reloaded_workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    return await _build_workspace_detail(user_id, reloaded_workspace)


async def stop_cloud_workspace(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    await _stop_workspace_runtime(workspace)
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    return await _build_workspace_detail(user_id, workspace)


async def delete_cloud_workspace(
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    await _destroy_workspace_runtime(workspace)
    await delete_cloud_workspace_records_for_workspace(workspace)


# ---------------------------------------------------------------------------
# Runtime lifecycle orchestration
# ---------------------------------------------------------------------------
# These helpers own the interaction with the persisted sandbox provider
# (pause / destroy) and delegate the persistence update to store.py primitives.
# ---------------------------------------------------------------------------


async def _stop_workspace_runtime(workspace: CloudWorkspace) -> None:
    """Pause the active sandbox and mark the workspace as stopped."""
    stop_started = time.perf_counter()
    log_cloud_event(
        "cloud workspace stop requested",
        workspace_id=workspace.id,
        sandbox_id=workspace.active_sandbox_id,
        status=workspace.status,
    )
    sandbox = await load_active_sandbox_for_workspace(workspace)
    if sandbox is not None and sandbox.external_sandbox_id:
        provider = get_sandbox_provider(sandbox.provider)
        try:
            await provider.pause_sandbox(sandbox.external_sandbox_id)
        except Exception:
            await update_sandbox_status(sandbox, "error")
            log_cloud_event(
                "cloud sandbox pause failed",
                level=logging.WARNING,
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
                external_sandbox_id=sandbox.external_sandbox_id,
            )
        else:
            await close_usage_segment_for_sandbox(
                sandbox_id=sandbox.id,
                ended_at=utcnow(),
                closed_by=USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
            )
            await update_sandbox_status(sandbox, "paused", stopped_at_now=True)
            log_cloud_event(
                "cloud sandbox paused",
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
                external_sandbox_id=sandbox.external_sandbox_id,
            )

    if workspace.status != WorkspaceStatus.stopped:
        transition_workspace_status(workspace, WorkspaceStatus.stopped, status_detail="Stopped")
    else:
        workspace.updated_at = utcnow()
    await persist_workspace_stop_state(workspace)
    log_cloud_event(
        "cloud workspace stopped",
        workspace_id=workspace.id,
        elapsed_ms=duration_ms(stop_started),
    )


async def _destroy_workspace_runtime(workspace: CloudWorkspace) -> None:
    """Destroy the active sandbox and mark the workspace as stopped."""
    destroy_started = time.perf_counter()
    sandbox = await load_active_sandbox_for_workspace(workspace)
    if sandbox is not None and sandbox.external_sandbox_id:
        provider = get_sandbox_provider(sandbox.provider)
        try:
            await provider.destroy_sandbox(sandbox.external_sandbox_id)
        except Exception:
            await update_sandbox_status(sandbox, "error")
            log_cloud_event(
                "cloud sandbox destroy failed",
                level=logging.WARNING,
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
                external_sandbox_id=sandbox.external_sandbox_id,
            )
        else:
            await close_usage_segment_for_sandbox(
                sandbox_id=sandbox.id,
                ended_at=utcnow(),
                closed_by=USAGE_SEGMENT_CLOSED_BY_DESTROY,
            )
            await update_sandbox_status(sandbox, "destroyed", stopped_at_now=True)
            log_cloud_event(
                "cloud sandbox destroyed",
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
                external_sandbox_id=sandbox.external_sandbox_id,
            )

    transition_workspace_status(workspace, WorkspaceStatus.stopped, status_detail="Stopped")
    await persist_workspace_destroy_state(workspace)
    log_cloud_event(
        "cloud workspace destroyed",
        workspace_id=workspace.id,
        elapsed_ms=duration_ms(destroy_started),
    )


async def get_cloud_connection(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceConnection:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    try:
        target = await get_workspace_connection(workspace)
    except CloudRuntimeReconnectError as exc:
        log_cloud_event(
            "cloud workspace connection still resuming",
            level=logging.INFO,
            workspace_id=workspace.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime is not ready yet.",
            status_code=409,
        ) from exc
    except CloudApiError:
        raise
    except Exception as exc:
        await mark_workspace_error_by_id(
            workspace.id,
            format_exception_message(exc),
            status_detail="Reconnect failed",
            clear_runtime_metadata=False,
        )
        log_cloud_event(
            "cloud workspace connection check failed",
            level=logging.WARNING,
            workspace_id=workspace.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        raise CloudApiError(
            "workspace_not_ready",
            "Cloud workspace runtime is not ready yet.",
            status_code=409,
        ) from exc

    reloaded_workspace = await load_cloud_workspace_by_id(workspace.id)
    if reloaded_workspace is not None:
        workspace = reloaded_workspace
    log_cloud_event(
        "cloud workspace connection issued",
        workspace_id=workspace.id,
        runtime_generation=target.runtime_generation,
        ready_agents=",".join(target.ready_agent_kinds) or "none",
    )
    return WorkspaceConnection(
        runtime_url=target.runtime_url,
        access_token=target.access_token,
        anyharness_workspace_id=target.anyharness_workspace_id,
        runtime_generation=target.runtime_generation,
        allowed_agent_kinds=allowed_agent_kinds(),
        ready_agent_kinds=target.ready_agent_kinds,
    )
