from __future__ import annotations

import logging
import time
from uuid import UUID

from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    USAGE_SEGMENT_CLOSED_BY_DESTROY,
    USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
    WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
)
from proliferate.constants.cloud import (
    SUPPORTED_GIT_PROVIDER,
    CloudWorkspaceStatus,
)
from proliferate.db.models.auth import User
from proliferate.db.models.cloud import CloudWorkspace
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
)
from proliferate.db.store.cloud_credentials import load_cloud_credentials_for_user
from proliferate.db.store.cloud_runtime_environments import load_runtime_environment_for_workspace
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
from proliferate.server.billing.models import BillingSnapshot, SandboxStartAuthorization
from proliferate.server.billing.service import (
    authorize_sandbox_start,
    get_billing_snapshot_for_subject,
)
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
from proliferate.server.cloud.runtime.credential_freshness import (
    build_credential_freshness_snapshot,
    build_credential_revision_state,
    build_runtime_credential_freshness_snapshot,
)
from proliferate.server.cloud.runtime.scheduler import schedule_workspace_provision
from proliferate.server.cloud.runtime.service import (
    get_workspace_connection,
    sync_workspace_credentials,
)
from proliferate.server.cloud.workspaces.models import (
    WorkspaceConnection,
    WorkspaceDetail,
    WorkspaceSummary,
    credential_freshness_payload,
    workspace_detail_payload,
    workspace_summary_payload,
)
from proliferate.utils.time import duration_ms, utcnow

MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS = 160
CLOUD_HUMAN_ORIGIN_JSON = '{"kind":"human","entrypoint":"cloud"}'

PROVISIONING_STATUSES: frozenset[str] = frozenset(
    {
        CloudWorkspaceStatus.pending.value,
        CloudWorkspaceStatus.materializing.value,
    }
)

# Valid status transitions.  Each key lists the statuses that may follow it.
# Every active or terminal state allows ``stopped`` so that workspace deletion
# (destroy) is always permitted, and ``error`` is reachable from any state.
VALID_TRANSITIONS: dict[str, frozenset[str]] = {
    CloudWorkspaceStatus.pending.value: frozenset(
        {
            CloudWorkspaceStatus.materializing.value,
            CloudWorkspaceStatus.archived.value,
            CloudWorkspaceStatus.error.value,
        }
    ),
    CloudWorkspaceStatus.materializing.value: frozenset(
        {
            CloudWorkspaceStatus.ready.value,
            CloudWorkspaceStatus.archived.value,
            CloudWorkspaceStatus.error.value,
        }
    ),
    CloudWorkspaceStatus.ready.value: frozenset(
        {
            CloudWorkspaceStatus.materializing.value,
            CloudWorkspaceStatus.archived.value,
            CloudWorkspaceStatus.error.value,
        }
    ),
    CloudWorkspaceStatus.archived.value: frozenset({CloudWorkspaceStatus.error.value}),
    CloudWorkspaceStatus.error.value: frozenset(
        {CloudWorkspaceStatus.materializing.value, CloudWorkspaceStatus.archived.value}
    ),
}


def transition_workspace_status(
    workspace: CloudWorkspace,
    target: CloudWorkspaceStatus,
    *,
    status_detail: str | None = None,
) -> None:
    """Move *workspace* to *target*, enforcing the transition map.

    Raises ``CloudApiError`` when the transition is not allowed.
    ``status_detail`` overrides the human-readable detail; when *None* the
    detail is derived from the target status.
    """
    current = workspace.status
    if current not in VALID_TRANSITIONS:
        current = CloudWorkspaceStatus.error.value
    allowed = VALID_TRANSITIONS.get(current)
    if allowed is None or target.value not in allowed:
        raise CloudApiError(
            "invalid_status_transition",
            f"Cannot transition workspace from '{workspace.status}' to '{target}'.",
            status_code=409,
        )
    workspace.status = target.value
    workspace.status_detail = status_detail or target.value.replace("_", " ").title()
    workspace.updated_at = utcnow()


async def list_cloud_workspaces_for_user(
    user_id: UUID,
) -> list[WorkspaceSummary]:
    workspaces = await list_cloud_workspaces_store(user_id)
    credential_records = await load_cloud_credentials_for_user(user_id)
    credential_revisions = build_credential_revision_state(credential_records)
    snapshots_by_subject: dict[UUID, BillingSnapshot] = {}
    summaries: list[WorkspaceSummary] = []
    for workspace in workspaces:
        runtime_environment = await load_runtime_environment_for_workspace(workspace)
        credential_freshness = (
            build_credential_freshness_snapshot(runtime_environment, credential_revisions)
            if runtime_environment is not None
            else None
        )
        billing_subject_id = (
            runtime_environment.billing_subject_id
            if runtime_environment is not None
            else workspace.billing_subject_id
        )
        billing = snapshots_by_subject.get(billing_subject_id)
        if billing is None:
            billing = await get_billing_snapshot_for_subject(billing_subject_id)
            snapshots_by_subject[billing_subject_id] = billing
        action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
        summaries.append(
            workspace_summary_payload(
                workspace,
                runtime_environment=runtime_environment,
                credential_freshness=credential_freshness,
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
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT:
        return (
            "Sandbox limit reached. Archive or delete another cloud workspace before "
            "starting a new one."
        )
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED:
        return "Cloud usage is paused because your included sandbox hours are exhausted."
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED:
        return "Cloud usage is paused because billing needs attention."
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD:
        return "Cloud usage is paused for this account."
    if blocked_reason == WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD:
        return "Cloud usage is paused because billing needs attention."
    return "Cloud usage is currently unavailable."


def _raise_if_cloud_workspace_start_denied(authorization: SandboxStartAuthorization) -> None:
    if authorization.allowed:
        return
    raise CloudApiError(
        "quota_exceeded",
        authorization.message or _cloud_workspace_block_message(authorization.start_block_reason),
        status_code=403,
    )


def _workspace_action_block(
    workspace: CloudWorkspace,
    billing: BillingSnapshot,
) -> tuple[str | None, str | None]:
    if billing.billing_mode != BILLING_MODE_ENFORCE or not billing.start_blocked:
        return None, None
    if workspace.status == CloudWorkspaceStatus.ready.value:
        return None, None
    return (
        billing.start_block_reason,
        _cloud_workspace_block_message(billing.start_block_reason),
    )


def _provider_state_is_running(state: str | None) -> bool:
    return state in {"running", "started"}


async def get_cloud_workspace_detail(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    return await _build_workspace_detail(workspace)


async def _build_workspace_detail(
    workspace: CloudWorkspace,
) -> WorkspaceDetail:
    runtime_environment = await load_runtime_environment_for_workspace(workspace)
    credential_freshness = await build_runtime_credential_freshness_snapshot(
        runtime_environment,
    )
    statuses = await load_cloud_credential_statuses(workspace.user_id)
    billing = await get_billing_snapshot_for_subject(
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    return workspace_detail_payload(
        workspace,
        statuses,
        runtime_environment=runtime_environment,
        credential_freshness=credential_freshness,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
    )


async def create_cloud_workspace(
    user: User,
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str | None,
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

    cleaned_base_branch = base_branch.strip() if base_branch else ""
    cleaned_branch_name = branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a new cloud branch before creating a cloud workspace.",
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

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before creating a cloud workspace.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before creating a cloud workspace."
        ),
    )

    resolved_base_branch = cleaned_base_branch or None
    saved_default_branch = (repo_config.default_branch or "").strip() or None
    if resolved_base_branch is None and saved_default_branch:
        if saved_default_branch in repo_branches.branches:
            resolved_base_branch = saved_default_branch
        else:
            log_cloud_event(
                "cloud repo default branch missing on github; falling back",
                user_id=user.id,
                repo=f"{git_owner}/{git_repo_name}",
                saved_default_branch=saved_default_branch,
                github_default_branch=repo_branches.default_branch,
            )
    if resolved_base_branch is None:
        resolved_base_branch = repo_branches.default_branch.strip()

    if resolved_base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{resolved_base_branch}' was not found on GitHub.",
            status_code=400,
        )
    if cleaned_branch_name in repo_branches.branches:
        raise CloudApiError(
            "github_branch_already_exists",
            f"The branch '{cleaned_branch_name}' already exists on GitHub.",
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
        raise CloudApiError(
            "cloud_branch_already_exists",
            (
                f"A cloud workspace already exists for branch '{cleaned_branch_name}'. "
                "Open the existing cloud workspace or choose a different cloud branch."
            ),
            status_code=400,
        )

    authorization = await authorize_sandbox_start(
        user_id=user.id,
        workspace_id=None,
    )
    _raise_if_cloud_workspace_start_denied(authorization)

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
        base_branch=resolved_base_branch,
        branch_name=cleaned_branch_name,
        synced_providers=",".join(status.provider for status in statuses if status.synced),
        active_sandbox_count=authorization.active_sandbox_count,
    )

    workspace = await create_cloud_workspace_for_user(
        user_id=user.id,
        display_name=(display_name.strip() if display_name and display_name.strip() else None),
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=resolved_base_branch,
        origin_json=CLOUD_HUMAN_ORIGIN_JSON,
        template_version=get_configured_sandbox_provider().template_version,
    )
    log_cloud_event(
        "cloud workspace queued",
        workspace_id=workspace.id,
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=resolved_base_branch,
        branch_name=cleaned_branch_name,
    )
    schedule_workspace_provision(workspace.id)
    return await _build_workspace_detail(workspace)


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
        origin_json=CLOUD_HUMAN_ORIGIN_JSON,
        template_version=get_configured_sandbox_provider().template_version,
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
    return await save_workspace(workspace)


async def start_cloud_workspace(
    user: User,
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user.id, workspace_id)
    if (
        workspace.status in PROVISIONING_STATUSES
        and workspace.status != CloudWorkspaceStatus.pending.value
    ):
        return await _build_workspace_detail(workspace)

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

    authorization = await authorize_sandbox_start(
        user_id=user.id,
        workspace_id=workspace.id,
    )
    _raise_if_cloud_workspace_start_denied(authorization)

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
        active_sandbox_count=authorization.active_sandbox_count,
    )

    if workspace.ready_at is None:
        workspace = await _refresh_repo_env_snapshot_for_workspace(workspace)

    if workspace.status == CloudWorkspaceStatus.pending.value:
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
        return await _build_workspace_detail(workspace)

    if workspace.status == CloudWorkspaceStatus.ready.value:
        return await _build_workspace_detail(workspace)

    transition_workspace_status(
        workspace,
        CloudWorkspaceStatus.materializing,
        status_detail="Preparing runtime",
    )
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
    return await _build_workspace_detail(workspace)


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
    return await _build_workspace_detail(workspace)


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
    return await _build_workspace_detail(workspace)


async def sync_cloud_workspace_credentials(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    await sync_workspace_credentials(workspace)
    reloaded_workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    return await _build_workspace_detail(reloaded_workspace)


async def stop_cloud_workspace(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    await _stop_workspace_runtime(workspace)
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
    return await _build_workspace_detail(workspace)


async def delete_cloud_workspace(
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    workspace = await _require_cloud_workspace_for_user(user_id, workspace_id)
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

    if workspace.status != CloudWorkspaceStatus.archived.value:
        transition_workspace_status(
            workspace,
            CloudWorkspaceStatus.archived,
            status_detail="Archived",
        )
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

    transition_workspace_status(workspace, CloudWorkspaceStatus.archived, status_detail="Archived")
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
        credential_freshness=credential_freshness_payload(target.credential_freshness),
    )
