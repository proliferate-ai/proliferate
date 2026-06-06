from __future__ import annotations

from dataclasses import replace
from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity, OwnerSelection
from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER, CloudWorkspaceStatus
from proliferate.db import session_ops as db_session
from proliferate.db.store.automation_cloud_workspace_claims import (
    create_managed_cloud_workspace_for_claimed_run,
)
from proliferate.db.store.cloud_workspace_creation import (
    CloudRepoLimitExceededError,
    create_cloud_workspace_for_user,
)
from proliferate.db.store.cloud_workspace_runtime import save_workspace
from proliferate.db.store.cloud_workspaces import (
    get_existing_cloud_workspace,
)
from proliferate.integrations.sandbox import get_configured_sandbox_provider
from proliferate.server.automations.domain.claim_lifecycle import (
    CLOUD_WORKSPACE_CREATION_TRANSITION,
    claim_is_active,
)
from proliferate.server.billing.authorization import authorize_sandbox_start
from proliferate.server.billing.snapshots import (
    get_billing_snapshot_for_subject,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.repos.service import (
    get_linked_github_account,
)
from proliferate.server.cloud.repos.service import (
    get_repo_branches_for_user as get_github_repo_branches,
)
from proliferate.server.cloud.runtime.scheduler import schedule_workspace_provision
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_interact_with_db,
)
from proliferate.server.cloud.workspaces.details import build_workspace_detail
from proliferate.server.cloud.workspaces.domain.lifecycle import (
    decide_workspace_start_after_validation,
    decide_workspace_status_transition,
    start_request_should_return_existing,
)
from proliferate.server.cloud.workspaces.lifecycle import service as lifecycle_service
from proliferate.server.cloud.workspaces.models import WorkspaceDetail
from proliferate.server.cloud.workspaces.provisioning.models import (
    ProvisioningWorkspaceRecord,
)
from proliferate.server.cloud.workspaces.provisioning.preflight import (
    bootstrap_repo_config_tx,
    load_personal_agent_auth_agent_kinds,
    load_repo_config_value_tx,
    raise_if_cloud_workspace_start_denied,
    raise_repo_limit_exceeded,
    resolve_new_cloud_workspace_create,
    resolve_new_managed_cloud_workspace_create,
)
from proliferate.server.organizations.service import (
    OrganizationServiceError,
    resolve_owner_context,
)
from proliferate.utils.time import utcnow

CLOUD_HUMAN_ORIGIN_JSON = '{"kind":"human","entrypoint":"cloud"}'
CLOUD_SYSTEM_ORIGIN_JSON = '{"kind":"system","entrypoint":"cloud"}'
CREATE_WORKSPACE_ORIGIN_BY_SOURCE = {
    "desktop": ("manual_desktop", '{"kind":"human","entrypoint":"desktop"}'),
    "web": ("manual_web", '{"kind":"human","entrypoint":"web"}'),
    "mobile": ("manual_mobile", '{"kind":"human","entrypoint":"mobile"}'),
}


def _raise_org_cloud_not_ready() -> NoReturn:
    raise CloudApiError(
        "org_cloud_not_ready",
        "Organization cloud workspaces are not available yet.",
        status_code=409,
    )


def _map_owner_context_error(error: OrganizationServiceError) -> NoReturn:
    raise CloudApiError(error.code, error.message, status_code=error.status_code) from error


def transition_workspace_status(
    workspace: ProvisioningWorkspaceRecord,
    target: CloudWorkspaceStatus,
    *,
    status_detail: str | None = None,
) -> None:
    """Move *workspace* to *target*, enforcing the transition map."""
    decision = decide_workspace_status_transition(
        workspace.status,
        target,
        status_detail=status_detail,
    )
    if not decision.allowed:
        raise CloudApiError(
            decision.error_code or "invalid_status_transition",
            decision.error_message or "Invalid workspace status transition.",
            status_code=decision.status_code or 409,
        )
    workspace.status = decision.target_status.value
    workspace.status_detail = decision.status_detail
    workspace.updated_at = utcnow()


async def create_cloud_workspace(
    user: ActorIdentity,
    *,
    db: AsyncSession | None = None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str | None,
    branch_name: str,
    display_name: str | None,
    required_agent_kind: str | None = None,
    source: str = "desktop",
    owner_selection: OwnerSelection | None = None,
) -> WorkspaceDetail:
    if owner_selection is not None and owner_selection.owner_scope == "organization":
        if db is None:
            raise CloudApiError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        try:
            await resolve_owner_context(user, owner_selection, db=db)
        except OrganizationServiceError as error:
            _map_owner_context_error(error)
        _raise_org_cloud_not_ready()
    resolved = await resolve_new_cloud_workspace_create(
        user,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        base_branch=base_branch,
        branch_name=branch_name,
        display_name=display_name,
        required_agent_kind=required_agent_kind,
    )

    try:
        origin, origin_json = CREATE_WORKSPACE_ORIGIN_BY_SOURCE.get(
            source,
            CREATE_WORKSPACE_ORIGIN_BY_SOURCE["desktop"],
        )
        async with db_session.open_async_transaction() as create_db:
            workspace = await create_cloud_workspace_for_user(
                create_db,
                user_id=user.id,
                display_name=resolved.display_name,
                git_provider=resolved.git_provider,
                git_owner=resolved.git_owner,
                git_repo_name=resolved.git_repo_name,
                git_branch=resolved.git_branch,
                git_base_branch=resolved.git_base_branch,
                origin=origin,
                origin_json=origin_json,
                template_version=get_configured_sandbox_provider().template_version,
                cloud_repo_limit=resolved.cloud_repo_limit,
            )
    except CloudRepoLimitExceededError as error:
        raise_repo_limit_exceeded(error)
    log_cloud_event(
        "cloud workspace queued",
        workspace_id=workspace.id,
        repo=f"{resolved.git_owner}/{resolved.git_repo_name}",
        base_branch=resolved.git_base_branch,
        branch_name=resolved.git_branch,
    )
    schedule_workspace_provision(workspace.id)
    return await build_workspace_detail(workspace)


async def create_cloud_workspace_for_automation_run(
    user: ActorIdentity,
    *,
    run_id: UUID,
    claim_id: UUID,
    target_id: UUID | None = None,
    sandbox_profile_id: UUID | None = None,
    git_owner: str,
    git_repo_name: str,
    branch_name: str,
    worktree_path: str | None = None,
    display_name: str | None,
    required_agent_kind: str,
) -> ProvisioningWorkspaceRecord | None:
    if target_id is None or sandbox_profile_id is None:
        raise CloudApiError(
            "target_required",
            "Cloud automations require a managed cloud target and sandbox profile.",
            status_code=409,
        )
    resolved = await resolve_new_managed_cloud_workspace_create(
        user,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        git_provider=SUPPORTED_GIT_PROVIDER,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        base_branch=None,
        branch_name=branch_name,
        display_name=display_name,
        required_agent_kind=required_agent_kind,
    )
    try:
        async with db_session.open_async_transaction() as db:
            workspace = await create_managed_cloud_workspace_for_claimed_run(
                db,
                run_id=run_id,
                claim_id=claim_id,
                sandbox_profile_id=sandbox_profile_id,
                target_id=target_id,
                user_id=user.id,
                display_name=resolved.display_name,
                git_provider=resolved.git_provider,
                git_owner=resolved.git_owner,
                git_repo_name=resolved.git_repo_name,
                git_branch=resolved.git_branch,
                git_base_branch=resolved.git_base_branch,
                worktree_path=worktree_path,
                origin_json=CLOUD_SYSTEM_ORIGIN_JSON,
                template_version=get_configured_sandbox_provider().template_version,
                now=utcnow(),
                transition=CLOUD_WORKSPACE_CREATION_TRANSITION,
                claim_is_active=claim_is_active,
            )
    except CloudRepoLimitExceededError as error:
        raise_repo_limit_exceeded(error)
    if workspace is not None:
        log_cloud_event(
            "automation cloud workspace created",
            workspace_id=workspace.id,
            automation_run_id=run_id,
            repo=f"{resolved.git_owner}/{resolved.git_repo_name}",
            branch_name=resolved.git_branch,
        )
    return workspace


async def ensure_cloud_workspace_for_existing_branch(
    user: ActorIdentity,
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    branch_name: str,
    display_name: str | None,
) -> ProvisioningWorkspaceRecord:
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
    async with db_session.open_async_session() as db:
        existing_cloud_workspace = await get_existing_cloud_workspace(
            db,
            user_id=user.id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=cleaned_branch_name,
        )
    if existing_cloud_workspace is not None:
        if _cloud_workspace_should_be_replaced_for_mobility_retry(existing_cloud_workspace):
            await lifecycle_service.archive_failed_cloud_workspace_for_mobility_retry(
                existing_cloud_workspace.id
            )
            log_cloud_event(
                "failed cloud workspace archived before mobility retry",
                workspace_id=existing_cloud_workspace.id,
                repo=f"{git_owner}/{git_repo_name}",
                branch_name=cleaned_branch_name,
                last_error=existing_cloud_workspace.last_error,
            )
        else:
            return existing_cloud_workspace
    repo_config = await load_repo_config_value_tx(user.id, git_owner, git_repo_name)
    if repo_config is None or not repo_config.configured:
        repo_config = await bootstrap_repo_config_tx(user.id, git_owner, git_repo_name)
        log_cloud_event(
            "cloud repo config auto-bootstrapped",
            user_id=user.id,
            repo=f"{git_owner}/{git_repo_name}",
        )
    authorization = await authorize_sandbox_start(
        user_id=user.id,
        workspace_id=None,
    )
    raise_if_cloud_workspace_start_denied(authorization)
    billing_snapshot = await get_billing_snapshot_for_subject(authorization.billing_subject_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        async with db_session.open_async_transaction() as db:
            workspace = await create_cloud_workspace_for_user(
                db,
                user_id=user.id,
                display_name=display_name.strip()
                if display_name and display_name.strip()
                else None,
                git_provider=git_provider,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
                git_branch=cleaned_branch_name,
                git_base_branch=cleaned_branch_name,
                origin_json=CLOUD_HUMAN_ORIGIN_JSON,
                template_version=get_configured_sandbox_provider().template_version,
                cloud_repo_limit=cloud_repo_limit,
            )
    except CloudRepoLimitExceededError as error:
        raise_repo_limit_exceeded(error)
    log_cloud_event(
        "cloud workspace ensured for mobility",
        workspace_id=workspace.id,
        repo=f"{git_owner}/{git_repo_name}",
        branch_name=cleaned_branch_name,
    )
    return workspace


def _cloud_workspace_should_be_replaced_for_mobility_retry(
    workspace: ProvisioningWorkspaceRecord,
) -> bool:
    return (
        workspace.status == CloudWorkspaceStatus.error.value
        and workspace.anyharness_workspace_id is None
    )


async def _refresh_repo_env_snapshot_for_workspace(
    workspace: ProvisioningWorkspaceRecord,
) -> ProvisioningWorkspaceRecord:
    repo_config = await load_repo_config_value_tx(
        workspace.user_id, workspace.git_owner, workspace.git_repo_name
    )
    if repo_config is None or not repo_config.configured:
        repo_config = await bootstrap_repo_config_tx(
            workspace.user_id, workspace.git_owner, workspace.git_repo_name
        )
        log_cloud_event(
            "cloud repo config auto-bootstrapped",
            user_id=workspace.user_id,
            repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
        )
    async with db_session.open_async_transaction() as db:
        return await save_workspace(db, workspace)


async def start_cloud_workspace(
    db: AsyncSession,
    user: ActorIdentity,
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_interact_with_db(db, user.id, workspace_id)
    has_requested_revision = bool((requested_base_sha or "").strip())
    if start_request_should_return_existing(workspace.status) and not has_requested_revision:
        return await build_workspace_detail(workspace)
    if has_requested_revision and workspace.status == CloudWorkspaceStatus.materializing.value:
        raise CloudApiError(
            "cloud_workspace_already_materializing",
            "Cloud workspace is already preparing. Try the move again once it is ready.",
            status_code=409,
        )

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
    raise_if_cloud_workspace_start_denied(authorization)

    selected_agent_kinds = await load_personal_agent_auth_agent_kinds(user.id)
    if not selected_agent_kinds:
        raise CloudApiError(
            "missing_supported_credentials",
            "Select an agent authentication credential before starting a cloud workspace.",
            status_code=400,
        )
    log_cloud_event(
        "cloud workspace start validated",
        workspace_id=workspace.id,
        repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
        base_branch=base_branch,
        branch_name=workspace.git_branch,
        selected_agent_kinds=",".join(selected_agent_kinds),
        active_sandbox_count=authorization.active_sandbox_count,
    )

    start_decision = decide_workspace_start_after_validation(
        workspace.status,
        ready_at_exists=workspace.ready_at is not None,
    )
    if start_decision.refresh_repo_env_snapshot:
        workspace = await _refresh_repo_env_snapshot_for_workspace(workspace)
        start_decision = decide_workspace_start_after_validation(
            workspace.status,
            ready_at_exists=workspace.ready_at is not None,
        )

    if start_decision.action == "queue_pending":
        if start_decision.clear_last_error:
            workspace.last_error = None
        if start_decision.persist_before_schedule:
            async with db_session.open_async_transaction() as persist_db:
                workspace = await save_workspace(persist_db, workspace)
        log_cloud_event(
            "cloud workspace queued",
            workspace_id=workspace.id,
            repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
            base_branch=base_branch,
            branch_name=workspace.git_branch,
            requested_base_sha=requested_base_sha,
        )
        if start_decision.schedule_provision:
            schedule_workspace_provision(
                workspace.id,
                requested_base_sha=requested_base_sha,
            )
        return await build_workspace_detail(workspace)

    if start_decision.action in {"return_ready", "return_current"}:
        if not has_requested_revision:
            return await build_workspace_detail(workspace)
        if start_decision.action == "return_current":
            raise CloudApiError(
                "cloud_workspace_already_materializing",
                "Cloud workspace is already preparing. Try the move again once it is ready.",
                status_code=409,
            )
        start_decision = replace(
            start_decision,
            action="restart_materializing",
            clear_last_error=True,
            persist_before_schedule=True,
            schedule_provision=True,
            target_status=CloudWorkspaceStatus.materializing,
            status_detail="Preparing requested revision",
        )

    if start_decision.target_status is None:
        raise CloudApiError(
            "invalid_status_transition",
            "Invalid workspace status transition.",
            status_code=409,
        )
    transition_workspace_status(
        workspace,
        start_decision.target_status,
        status_detail=start_decision.status_detail,
    )
    if start_decision.clear_last_error:
        workspace.last_error = None
    if start_decision.persist_before_schedule:
        async with db_session.open_async_transaction() as persist_db:
            workspace = await save_workspace(persist_db, workspace)
    log_cloud_event(
        "cloud workspace restart queued",
        workspace_id=workspace.id,
        repo=f"{workspace.git_owner}/{workspace.git_repo_name}",
        base_branch=base_branch,
        branch_name=workspace.git_branch,
        requested_base_sha=requested_base_sha,
    )
    if start_decision.schedule_provision:
        schedule_workspace_provision(
            workspace.id,
            requested_base_sha=requested_base_sha,
        )
    return await build_workspace_detail(workspace)
