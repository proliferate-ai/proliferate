from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerSelection
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
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.automation_cloud_workspace_claims import (
    create_cloud_workspace_for_claimed_run,
    create_managed_cloud_workspace_for_claimed_run,
)
from proliferate.db.store.automations import (
    AutomationRunValue,
    list_latest_runs_by_cloud_workspace_ids_for_user,
)
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
)
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_runtime_environments import (
    get_runtime_environment_for_workspace,
    load_runtime_environment_for_workspace,
)
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspaces import (
    CloudRepoLimitExceededError,
    create_cloud_workspace_for_user,
    delete_cloud_workspace_records_for_workspace,
    list_claimed_organization_workspaces_for_user,
    list_exposed_cloud_workspaces_for_user,
    list_organization_workspaces_for_admin_audit,
    list_unclaimed_organization_workspaces,
    load_active_sandbox_for_workspace,
    load_any_cloud_workspace_for_repo,
    load_cloud_workspace_by_id,
    load_existing_cloud_workspace,
    mark_workspace_error_by_id,
    persist_workspace_destroy_state,
    persist_workspace_stop_state,
    save_workspace,
    update_sandbox_status,
    update_workspace_branch,
    update_workspace_display_name,
)
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces as list_cloud_workspaces_store,
)
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import get_configured_sandbox_provider, get_sandbox_provider
from proliferate.server.automations.domain.claim_lifecycle import (
    CLOUD_WORKSPACE_CREATION_TRANSITION,
    claim_is_active,
)
from proliferate.server.billing.models import BillingSnapshot, SandboxStartAuthorization
from proliferate.server.billing.service import (
    authorize_sandbox_start,
    get_billing_snapshot_for_subject,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.claims.access import load_workspace_exposure_and_claim
from proliferate.server.cloud.claims.domain.policy import is_org_admin_role
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
from proliferate.server.cloud.runtime.auth_status import (
    build_workspace_runtime_auth_snapshot,
    load_workspace_runtime_auth_snapshot,
    selected_agent_auth_agent_kinds,
)
from proliferate.server.cloud.runtime.scheduler import schedule_workspace_provision
from proliferate.server.cloud.runtime.service import (
    get_workspace_connection,
)
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_archive,
    cloud_workspace_user_can_interact,
    cloud_workspace_user_can_interact_with_db,
    cloud_workspace_user_can_read,
    cloud_workspace_user_can_read_with_db,
)
from proliferate.server.cloud.workspaces.domain.lifecycle import (
    decide_workspace_start_after_validation,
    decide_workspace_status_transition,
    provider_failure_debug_state,
    start_request_should_return_existing,
)
from proliferate.server.cloud.workspaces.models import (
    WorkspaceConnection,
    WorkspaceCreatorContext,
    WorkspaceDetail,
    WorkspaceDirectTargetContext,
    WorkspaceSummary,
    runtime_auth_payload,
    workspace_detail_payload,
    workspace_summary_payload,
)
from proliferate.server.organizations.service import (
    OrganizationServiceError,
    resolve_owner_context,
)
from proliferate.utils.time import duration_ms, utcnow

MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS = 160
CLOUD_HUMAN_ORIGIN_JSON = '{"kind":"human","entrypoint":"cloud"}'
CLOUD_SYSTEM_ORIGIN_JSON = '{"kind":"system","entrypoint":"cloud"}'


def _raise_org_cloud_not_ready() -> NoReturn:
    raise CloudApiError(
        "org_cloud_not_ready",
        "Organization cloud workspaces are not available yet.",
        status_code=409,
    )


def _map_owner_context_error(error: OrganizationServiceError) -> NoReturn:
    raise CloudApiError(error.code, error.message, status_code=error.status_code) from error


def _creator_context_for_automation_run(
    run: AutomationRunValue | None,
) -> WorkspaceCreatorContext | None:
    if run is None:
        return None
    return WorkspaceCreatorContext(
        kind="automation",
        automation_id=str(run.automation_id),
        automation_run_id=str(run.id),
        label=run.title_snapshot,
    )


def _direct_target_context_for_automation_run(
    run: AutomationRunValue | None,
) -> WorkspaceDirectTargetContext | None:
    if (
        run is None
        or run.cloud_target_id_snapshot is None
        or run.cloud_target_kind_snapshot is None
        or run.cloud_target_kind_snapshot == "managed_cloud"
        or not run.anyharness_workspace_id
    ):
        return None
    return WorkspaceDirectTargetContext(
        target_id=str(run.cloud_target_id_snapshot),
        target_kind=run.cloud_target_kind_snapshot,
        anyharness_workspace_id=run.anyharness_workspace_id,
    )


@dataclass(frozen=True)
class ResolvedCloudWorkspaceCreate:
    git_provider: str
    git_owner: str
    git_repo_name: str
    git_branch: str
    git_base_branch: str
    display_name: str | None
    active_sandbox_count: int
    selected_agent_kinds: tuple[str, ...]
    cloud_repo_limit: int | None


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


async def list_cloud_workspaces_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    user: User | None = None,
    owner_selection: OwnerSelection | None = None,
    scope: str | None = None,
) -> list[WorkspaceSummary]:
    list_scope = scope or (
        "unclaimed"
        if owner_selection is not None and owner_selection.owner_scope == "organization"
        else "my"
    )
    if list_scope in {"unclaimed", "claimable", "org-all"}:
        if user is None:
            raise CloudApiError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        try:
            owner_context = await resolve_owner_context(
                user,
                owner_selection or OwnerSelection(owner_scope="organization"),
                db=db,
            )
        except OrganizationServiceError as error:
            _map_owner_context_error(error)
        if owner_context.organization_id is None:
            raise CloudApiError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        if list_scope == "org-all" and not is_org_admin_role(owner_context.membership_role):
            raise CloudApiError(
                "organization_permission_denied",
                "You do not have permission to view organization workspace audit data.",
                status_code=403,
            )
        if list_scope == "org-all":
            workspaces = await list_organization_workspaces_for_admin_audit(
                db,
                organization_id=owner_context.organization_id,
            )
        else:
            workspaces = await list_unclaimed_organization_workspaces(
                db,
                organization_id=owner_context.organization_id,
            )
        return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)

    if list_scope == "exposed":
        organization_id = (
            owner_selection.organization_id
            if owner_selection is not None and owner_selection.owner_scope == "organization"
            else None
        )
        workspaces = await list_exposed_cloud_workspaces_for_user(
            db,
            user_id=user_id,
            organization_id=organization_id,
        )
        return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)

    if list_scope != "my":
        raise CloudApiError(
            "invalid_workspace_scope",
            "Unsupported workspace scope.",
            status_code=400,
        )

    workspaces = await list_cloud_workspaces_store(db, user_id)
    claimed_workspaces = await list_claimed_organization_workspaces_for_user(
        db,
        user_id=user_id,
    )
    workspaces = sorted(
        [*workspaces, *claimed_workspaces],
        key=lambda workspace: workspace.updated_at,
        reverse=True,
    )
    return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)


async def _workspace_summaries_for_request(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspaces: list[CloudWorkspace],
) -> list[WorkspaceSummary]:
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        user_id=user_id,
        cloud_workspace_ids=[workspace.id for workspace in workspaces],
    )
    snapshots_by_subject: dict[UUID, BillingSnapshot] = {}
    summaries: list[WorkspaceSummary] = []
    for workspace in workspaces:
        exposure, claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
        runtime_environment = await get_runtime_environment_for_workspace(db, workspace)
        runtime_auth = await build_workspace_runtime_auth_snapshot(
            db,
            workspace=workspace,
            runtime_environment=runtime_environment,
        )
        latest_sessions = await events_store.list_session_projections_for_workspace(
            db,
            cloud_workspace_id=workspace.id,
            limit=1,
        )
        target = (
            await targets_store.get_target_by_id(db, workspace.target_id)
            if workspace.target_id is not None
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
                runtime_auth=runtime_auth,
                billing=billing,
                action_block_kind=action_block_kind,
                action_block_reason=action_block_reason,
                creator_context=_creator_context_for_automation_run(
                    automation_runs_by_workspace.get(workspace.id)
                ),
                direct_target_context=_direct_target_context_for_automation_run(
                    automation_runs_by_workspace.get(workspace.id)
                ),
                exposure=exposure,
                claim=claim,
                last_session_summary=latest_sessions[0] if latest_sessions else None,
                target_kind=target.kind if target is not None else None,
            )
        )
    return summaries


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


def _raise_repo_limit_exceeded(error: CloudRepoLimitExceededError) -> NoReturn:
    raise CloudApiError(
        "repo_limit_exceeded",
        (
            "Cloud repo limit reached. Archive an existing cloud repo before adding "
            f"another one ({error.active_repo_count}/{error.cloud_repo_limit})."
        ),
        status_code=403,
    ) from error


async def _load_personal_agent_auth_agent_kinds(user_id: UUID) -> tuple[str, ...]:
    async with db_engine.async_session_factory() as db:
        profile = await agent_auth_store.get_active_personal_sandbox_profile_for_user(
            db,
            user_id,
        )
        if profile is None:
            return ()
        result = await selected_agent_auth_agent_kinds(
            db,
            sandbox_profile_id=profile.id,
        )
        return result


async def _agent_auth_agent_kinds_for_workspace_request(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> tuple[str, ...]:
    sandbox_profile_id = workspace.sandbox_profile_id
    if sandbox_profile_id is None:
        profile = await agent_auth_store.get_active_personal_sandbox_profile_for_user(
            db,
            workspace.user_id,
        )
        if profile is None:
            return ()
        sandbox_profile_id = profile.id
    return await selected_agent_auth_agent_kinds(
        db,
        sandbox_profile_id=sandbox_profile_id,
    )


async def _load_agent_auth_agent_kinds_for_workspace(
    workspace: CloudWorkspace,
) -> tuple[str, ...]:
    async with db_engine.async_session_factory() as db:
        return await _agent_auth_agent_kinds_for_workspace_request(db, workspace)


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
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_read_with_db(db, user_id, workspace_id)
    return await _build_workspace_detail_for_request(db, workspace)


async def _build_workspace_detail_for_request(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> WorkspaceDetail:
    exposure, claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    runtime_environment = await get_runtime_environment_for_workspace(db, workspace)
    runtime_auth = await build_workspace_runtime_auth_snapshot(
        db,
        workspace=workspace,
        runtime_environment=runtime_environment,
    )
    ready_agent_kind_values = await _agent_auth_agent_kinds_for_workspace_request(db, workspace)
    latest_sessions = await events_store.list_session_projections_for_workspace(
        db,
        cloud_workspace_id=workspace.id,
        limit=1,
    )
    target = (
        await targets_store.get_target_by_id(db, workspace.target_id)
        if workspace.target_id is not None
        else None
    )
    billing = await get_billing_snapshot_for_subject(
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        user_id=workspace.user_id,
        cloud_workspace_ids=[workspace.id],
    )
    return workspace_detail_payload(
        workspace,
        ready_agent_kind_values,
        runtime_environment=runtime_environment,
        runtime_auth=runtime_auth,
        billing=billing,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        creator_context=_creator_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        ),
        direct_target_context=_direct_target_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        ),
        exposure=exposure,
        claim=claim,
        last_session_summary=latest_sessions[0] if latest_sessions else None,
        target_kind=target.kind if target is not None else None,
    )


async def _build_workspace_detail(
    workspace: CloudWorkspace,
) -> WorkspaceDetail:
    exposure = None
    claim = None
    async with db_engine.async_session_factory() as db:
        exposure, claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
    runtime_environment = await load_runtime_environment_for_workspace(workspace)
    runtime_auth = await load_workspace_runtime_auth_snapshot(
        workspace=workspace,
        runtime_environment=runtime_environment,
    )
    ready_agent_kind_values = await _load_agent_auth_agent_kinds_for_workspace(workspace)
    latest_sessions = ()
    target = None
    async with db_engine.async_session_factory() as db:
        latest_sessions = await events_store.list_session_projections_for_workspace(
            db,
            cloud_workspace_id=workspace.id,
            limit=1,
        )
        target = (
            await targets_store.get_target_by_id(db, workspace.target_id)
            if workspace.target_id is not None
            else None
        )
    billing = await get_billing_snapshot_for_subject(
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        user_id=workspace.user_id,
        cloud_workspace_ids=[workspace.id],
    )
    return workspace_detail_payload(
        workspace,
        ready_agent_kind_values,
        runtime_environment=runtime_environment,
        runtime_auth=runtime_auth,
        billing=billing,
        action_block_kind=action_block_kind,
        action_block_reason=action_block_reason,
        creator_context=_creator_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        ),
        direct_target_context=_direct_target_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        ),
        exposure=exposure,
        claim=claim,
        last_session_summary=latest_sessions[0] if latest_sessions else None,
        target_kind=target.kind if target is not None else None,
    )


async def _resolve_new_cloud_workspace_create(
    user: User,
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str | None,
    branch_name: str,
    display_name: str | None,
    required_agent_kind: str | None = None,
) -> ResolvedCloudWorkspaceCreate:
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
    billing_snapshot = await get_billing_snapshot_for_subject(authorization.billing_subject_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)

    if required_agent_kind is not None and required_agent_kind not in allowed_agent_kinds():
        raise CloudApiError(
            "unsupported_agent_kind",
            "The selected agent is not supported for cloud workspaces.",
            status_code=400,
        )

    selected_agent_kinds = await _load_personal_agent_auth_agent_kinds(user.id)
    if required_agent_kind is not None and required_agent_kind not in selected_agent_kinds:
        raise CloudApiError(
            "missing_agent_credentials",
            (
                f"Select {required_agent_kind} agent authentication before running "
                "this cloud automation."
            ),
            status_code=400,
        )
    if not selected_agent_kinds:
        raise CloudApiError(
            "missing_supported_credentials",
            "Select an agent authentication credential before creating a cloud workspace.",
            status_code=400,
        )
    log_cloud_event(
        "cloud workspace create validated",
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=resolved_base_branch,
        branch_name=cleaned_branch_name,
        selected_agent_kinds=",".join(selected_agent_kinds),
        active_sandbox_count=authorization.active_sandbox_count,
    )
    return ResolvedCloudWorkspaceCreate(
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=resolved_base_branch,
        display_name=(display_name.strip() if display_name and display_name.strip() else None),
        active_sandbox_count=authorization.active_sandbox_count,
        selected_agent_kinds=selected_agent_kinds,
        cloud_repo_limit=cloud_repo_limit,
    )


async def create_cloud_workspace(
    user: User,
    *,
    db: AsyncSession | None = None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str | None,
    branch_name: str,
    display_name: str | None,
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
    resolved = await _resolve_new_cloud_workspace_create(
        user,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        base_branch=base_branch,
        branch_name=branch_name,
        display_name=display_name,
    )

    try:
        workspace = await create_cloud_workspace_for_user(
            user_id=user.id,
            display_name=resolved.display_name,
            git_provider=resolved.git_provider,
            git_owner=resolved.git_owner,
            git_repo_name=resolved.git_repo_name,
            git_branch=resolved.git_branch,
            git_base_branch=resolved.git_base_branch,
            origin_json=CLOUD_HUMAN_ORIGIN_JSON,
            template_version=get_configured_sandbox_provider().template_version,
            cloud_repo_limit=resolved.cloud_repo_limit,
        )
    except CloudRepoLimitExceededError as error:
        _raise_repo_limit_exceeded(error)
    log_cloud_event(
        "cloud workspace queued",
        workspace_id=workspace.id,
        repo=f"{resolved.git_owner}/{resolved.git_repo_name}",
        base_branch=resolved.git_base_branch,
        branch_name=resolved.git_branch,
    )
    schedule_workspace_provision(workspace.id)
    return await _build_workspace_detail(workspace)


async def create_cloud_workspace_for_automation_run(
    user: User,
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
) -> CloudWorkspace | None:
    resolved = await _resolve_new_cloud_workspace_create(
        user,
        git_provider=SUPPORTED_GIT_PROVIDER,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        base_branch=None,
        branch_name=branch_name,
        display_name=display_name,
        required_agent_kind=required_agent_kind,
    )
    try:
        if target_id is not None and sandbox_profile_id is not None:
            workspace = await create_managed_cloud_workspace_for_claimed_run(
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
        else:
            workspace = await create_cloud_workspace_for_claimed_run(
                run_id=run_id,
                claim_id=claim_id,
                user_id=user.id,
                display_name=resolved.display_name,
                git_provider=resolved.git_provider,
                git_owner=resolved.git_owner,
                git_repo_name=resolved.git_repo_name,
                git_branch=resolved.git_branch,
                git_base_branch=resolved.git_base_branch,
                origin_json=CLOUD_SYSTEM_ORIGIN_JSON,
                template_version=get_configured_sandbox_provider().template_version,
                now=utcnow(),
                transition=CLOUD_WORKSPACE_CREATION_TRANSITION,
                claim_is_active=claim_is_active,
                cloud_repo_limit=resolved.cloud_repo_limit,
            )
    except CloudRepoLimitExceededError as error:
        _raise_repo_limit_exceeded(error)
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

    authorization = await authorize_sandbox_start(
        user_id=user.id,
        workspace_id=None,
    )
    _raise_if_cloud_workspace_start_denied(authorization)
    billing_snapshot = await get_billing_snapshot_for_subject(authorization.billing_subject_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)

    try:
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
            cloud_repo_limit=cloud_repo_limit,
        )
    except CloudRepoLimitExceededError as error:
        _raise_repo_limit_exceeded(error)
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
    workspace = await cloud_workspace_user_can_interact(user.id, workspace_id)
    if start_request_should_return_existing(workspace.status):
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

    selected_agent_kinds = await _load_personal_agent_auth_agent_kinds(user.id)
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
            await save_workspace(workspace)
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
        return await _build_workspace_detail(workspace)

    if start_decision.action in {"return_ready", "return_current"}:
        return await _build_workspace_detail(workspace)

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
        await save_workspace(workspace)
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
    return await _build_workspace_detail(workspace)


async def sync_cloud_workspace_branch(
    db: AsyncSession,
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

    workspace = await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)
    workspace = await update_workspace_branch(db, workspace, cleaned_branch_name)
    return await _build_workspace_detail_for_request(db, workspace)


async def sync_cloud_workspace_display_name(
    db: AsyncSession,
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

    workspace = await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)
    workspace = await update_workspace_display_name(db, workspace, cleaned)
    return await _build_workspace_detail_for_request(db, workspace)


async def stop_cloud_workspace(
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive(user_id, workspace_id)
    await _stop_workspace_runtime(workspace)
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_archived")
    workspace = await cloud_workspace_user_can_read(user_id, workspace_id)
    return await _build_workspace_detail(workspace)


async def delete_cloud_workspace(
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    workspace = await cloud_workspace_user_can_archive(user_id, workspace_id)
    await _destroy_workspace_runtime(workspace)
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_deleted")
    await delete_cloud_workspace_records_for_workspace(workspace)


async def _revoke_claim_tokens_for_workspace(
    workspace: CloudWorkspace,
    *,
    reason: str,
) -> None:
    async with db_engine.async_session_factory() as db:
        claim = await claims_store.get_claim_for_workspace(db, workspace.id)
        if claim is None:
            return
        await claim_tokens_store.revoke_active_tokens_for_claim(
            db,
            claim_id=claim.id,
            reason=reason,
        )
        await db.commit()


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
    if sandbox is not None:
        if sandbox.external_sandbox_id:
            provider = get_sandbox_provider(sandbox.provider)
            try:
                await provider.pause_sandbox(sandbox.external_sandbox_id)
            except Exception:
                failure_state = provider_failure_debug_state("stop")
                await update_sandbox_status(sandbox, failure_state.sandbox_status)
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
        else:
            await update_sandbox_status(sandbox, "paused", stopped_at_now=True)
            log_cloud_event(
                "cloud sandbox pause skipped without provider id",
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
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
    if sandbox is not None:
        if sandbox.external_sandbox_id:
            provider = get_sandbox_provider(sandbox.provider)
            try:
                await provider.destroy_sandbox(sandbox.external_sandbox_id)
            except Exception:
                failure_state = provider_failure_debug_state("destroy")
                await update_sandbox_status(sandbox, failure_state.sandbox_status)
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
        else:
            await update_sandbox_status(sandbox, "destroyed", stopped_at_now=True)
            log_cloud_event(
                "cloud sandbox destroy skipped without provider id",
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
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
    workspace = await cloud_workspace_user_can_interact(user_id, workspace_id)
    await _reject_shared_workspace_static_connection(workspace)
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        user_id=user_id,
        cloud_workspace_ids=[workspace.id],
    )
    latest_run = automation_runs_by_workspace.get(workspace.id)
    if (
        latest_run is not None
        and latest_run.cloud_target_kind_snapshot is not None
        and latest_run.cloud_target_kind_snapshot != "managed_cloud"
    ):
        raise CloudApiError(
            "direct_target_connection_required",
            "This workspace runs on an SSH target and must be opened through "
            "direct target access.",
            status_code=409,
        )
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
        runtime_auth=runtime_auth_payload(target.runtime_auth),
    )


async def _reject_shared_workspace_static_connection(workspace: CloudWorkspace) -> None:
    if workspace.owner_scope != "organization":
        return
    async with db_engine.async_session_factory() as db:
        exposure, _claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
    visibility = exposure.visibility if exposure else None
    if visibility == "shared_unclaimed":
        raise CloudApiError(
            "direct_attach_claim_required",
            "Claim the workspace before opening it directly in Desktop.",
            status_code=409,
        )
    if visibility == "claimed":
        raise CloudApiError(
            "direct_attach_token_required",
            "Claimed shared workspaces require a scoped direct-attach token.",
            status_code=409,
        )
