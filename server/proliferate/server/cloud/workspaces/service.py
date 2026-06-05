from __future__ import annotations

import logging
import time
from dataclasses import dataclass, replace
from types import SimpleNamespace
from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity, OwnerSelection
from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_DESTROY,
    USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
)
from proliferate.constants.cloud import (
    SUPPORTED_GIT_PROVIDER,
    CloudCommandKind,
    CloudCommandSource,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.automation_cloud_workspace_claims import (
    create_managed_cloud_workspace_for_claimed_run,
)
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_repo_config import (
    get_cloud_repo_config,
    get_organization_cloud_repo_config,
)
from proliferate.db.store.cloud_sync import commands as command_store
from proliferate.db.store.cloud_workspaces import (
    CloudRepoLimitExceededError,
    archive_cloud_workspace_record,
    archive_cloud_workspace_record_by_id,
    create_cloud_workspace_for_user,
    delete_cloud_workspace_records_for_workspace,
    get_cloud_workspace_by_id,
    get_existing_managed_cloud_workspace_for_profile,
    list_claimed_organization_workspaces_for_user,
    list_exposed_cloud_workspaces_for_user,
    list_organization_workspaces_for_admin_audit,
    list_unclaimed_organization_workspaces,
    load_any_cloud_workspace_for_repo,
    load_cloud_sandbox_by_id,
    load_cloud_workspace_by_id,
    load_existing_cloud_workspace,
    mark_workspace_error_by_id,
    persist_workspace_destroy_state,
    persist_workspace_stop_state,
    purge_cloud_workspace_record,
    restore_cloud_workspace_record,
    save_workspace,
    update_sandbox_status,
    update_workspace_branch,
    update_workspace_display_name,
)
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces as list_cloud_workspaces_store,
)
from proliferate.integrations.sandbox import get_configured_sandbox_provider, get_sandbox_provider
from proliferate.server.automations.domain.claim_lifecycle import (
    CLOUD_WORKSPACE_CREATION_TRANSITION,
    claim_is_active,
)
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.billing.service import (
    authorize_sandbox_start,
    authorize_sandbox_start_for_billing_subject,
    get_billing_snapshot_for_subject,
    record_cloud_sandbox_usage_stopped,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.claims.domain.policy import is_org_admin_role
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.service import enqueue_command
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
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
from proliferate.server.cloud.runtime.credentials.auth_status import (
    selected_agent_auth_agent_kinds,
)
from proliferate.server.cloud.runtime.scheduler import schedule_workspace_provision
from proliferate.server.cloud.worker.revoked_jti import mark_revoked_jtis_changed
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_archive_with_db,
    cloud_workspace_user_can_interact_with_db,
    cloud_workspace_user_can_read,
    cloud_workspace_user_can_read_with_db,
)
from proliferate.server.cloud.workspaces.details import (
    build_workspace_detail as _build_workspace_detail,
)
from proliferate.server.cloud.workspaces.details import (
    build_workspace_detail_for_request as _build_workspace_detail_for_request,
)
from proliferate.server.cloud.workspaces.details import (
    cloud_workspace_block_message,
)
from proliferate.server.cloud.workspaces.details import (
    workspace_summaries_for_request as _workspace_summaries_for_request,
)
from proliferate.server.cloud.workspaces.domain.lifecycle import (
    decide_workspace_start_after_validation,
    decide_workspace_status_transition,
    provider_failure_debug_state,
    start_request_should_return_existing,
)
from proliferate.server.cloud.workspaces.models import (
    WorkspaceDetail,
    WorkspaceSummary,
)
from proliferate.server.organizations.service import (
    OrganizationServiceError,
    resolve_owner_context,
)
from proliferate.utils.time import duration_ms, utcnow

MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS = 160
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
    user: ActorIdentity | None = None,
    owner_selection: OwnerSelection | None = None,
    scope: str | None = None,
    lifecycle: str = "active",
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
                lifecycle=lifecycle,
            )
        else:
            workspaces = await list_unclaimed_organization_workspaces(
                db,
                organization_id=owner_context.organization_id,
                lifecycle=lifecycle,
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
            lifecycle=lifecycle,
        )
        return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)

    if list_scope != "my":
        raise CloudApiError(
            "invalid_workspace_scope",
            "Unsupported workspace scope.",
            status_code=400,
        )

    workspaces = await list_cloud_workspaces_store(db, user_id, lifecycle=lifecycle)
    claimed_workspaces = await list_claimed_organization_workspaces_for_user(
        db,
        user_id=user_id,
        lifecycle=lifecycle,
    )
    workspaces = sorted(
        [*workspaces, *claimed_workspaces],
        key=lambda workspace: workspace.updated_at,
        reverse=True,
    )
    return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)


def _raise_if_cloud_workspace_start_denied(authorization: SandboxStartAuthorization) -> None:
    if authorization.allowed:
        return
    raise CloudApiError(
        "quota_exceeded",
        authorization.message or cloud_workspace_block_message(authorization.start_block_reason),
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
    async with db_session.open_async_session() as db:
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


async def get_cloud_workspace_detail(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_read_with_db(db, user_id, workspace_id)
    return await _build_workspace_detail_for_request(db, workspace)


async def _load_repo_config_value_tx(
    user_id: UUID, git_owner: str, git_repo_name: str
) -> object | None:
    async with db_session.open_async_session() as db:
        return await load_repo_config_value(
            db, user_id=user_id, git_owner=git_owner, git_repo_name=git_repo_name
        )


async def _bootstrap_repo_config_tx(user_id: UUID, git_owner: str, git_repo_name: str) -> object:
    async with db_session.open_async_transaction() as db:
        return await bootstrap_repo_config(
            db, user_id=user_id, git_owner=git_owner, git_repo_name=git_repo_name
        )


async def _mark_workspace_error_tx(workspace_id: UUID, message: str, **kwargs: object) -> None:
    async with db_session.open_async_transaction() as db:
        await mark_workspace_error_by_id(db, workspace_id, message, **kwargs)


async def _update_sandbox_status_tx(sandbox: CloudSandbox, status: str, **kwargs: object) -> None:
    async with db_session.open_async_transaction() as db:
        await update_sandbox_status(db, sandbox, status, **kwargs)


async def _resolve_new_cloud_workspace_create(
    user: ActorIdentity,
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

    repo_config = await _load_repo_config_value_tx(user.id, git_owner, git_repo_name)
    if repo_config is None or not repo_config.configured:
        async with db_session.open_async_session() as db:
            existing_repo_workspace = await load_any_cloud_workspace_for_repo(
                db,
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
        repo_config = await _bootstrap_repo_config_tx(user.id, git_owner, git_repo_name)
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

    async with db_session.open_async_session() as db:
        existing_cloud_workspace = await load_existing_cloud_workspace(
            db,
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


async def _resolve_new_managed_cloud_workspace_create(
    user: ActorIdentity,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
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

    async with db_session.open_async_session() as db:
        profile = await sandbox_profile_store.load_sandbox_profile_by_id(db, sandbox_profile_id)
        if profile is None or profile.primary_target_id != target_id:
            raise CloudApiError(
                "cloud_target_not_found",
                "Cloud target not found.",
                status_code=404,
            )
        if profile.owner_scope == "organization":
            if profile.organization_id is None:
                raise CloudApiError(
                    "invalid_sandbox_profile",
                    "Organization sandbox profile is invalid.",
                    status_code=409,
                )
            repo_config = await get_organization_cloud_repo_config(
                db,
                organization_id=profile.organization_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        else:
            if profile.owner_user_id is None:
                raise CloudApiError(
                    "invalid_sandbox_profile",
                    "Personal sandbox profile is invalid.",
                    status_code=409,
                )
            repo_config = await get_cloud_repo_config(
                db,
                user_id=profile.owner_user_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        if repo_config is None or not repo_config.configured:
            raise CloudApiError(
                "cloud_repo_not_configured",
                "Configure cloud settings for this repo before creating a cloud workspace.",
                status_code=409,
            )
        existing_cloud_workspace = await get_existing_managed_cloud_workspace_for_profile(
            db,
            sandbox_profile_id=profile.id,
            target_id=target_id,
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
        selected_agent_kinds = await selected_agent_auth_agent_kinds(
            db,
            sandbox_profile_id=profile.id,
        )
        billing_subject_id = profile.billing_subject_id
        saved_default_branch = (repo_config.default_branch or "").strip() or None
        profile_owner_scope = profile.owner_scope

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
    if resolved_base_branch is None and saved_default_branch:
        if saved_default_branch in repo_branches.branches:
            resolved_base_branch = saved_default_branch
        else:
            log_cloud_event(
                "managed cloud repo default branch missing on github; falling back",
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

    authorization = await authorize_sandbox_start_for_billing_subject(
        actor_user_id=user.id,
        billing_subject_id=billing_subject_id,
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
    if profile_owner_scope == "personal":
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
        "managed cloud workspace create validated",
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=resolved_base_branch,
        branch_name=cleaned_branch_name,
        selected_agent_kinds=",".join(selected_agent_kinds),
        active_sandbox_count=authorization.active_sandbox_count,
        owner_scope=profile_owner_scope,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
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
    resolved = await _resolve_new_cloud_workspace_create(
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
) -> CloudWorkspace | None:
    if target_id is None or sandbox_profile_id is None:
        raise CloudApiError(
            "target_required",
            "Cloud automations require a managed cloud target and sandbox profile.",
            status_code=409,
        )
    resolved = await _resolve_new_managed_cloud_workspace_create(
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
    user: ActorIdentity,
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
    async with db_session.open_async_session() as db:
        existing_cloud_workspace = await load_existing_cloud_workspace(
            db,
            user_id=user.id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=cleaned_branch_name,
        )
    if existing_cloud_workspace is not None:
        if _cloud_workspace_should_be_replaced_for_mobility_retry(existing_cloud_workspace):
            await _archive_failed_cloud_workspace_for_mobility_retry(existing_cloud_workspace.id)
            log_cloud_event(
                "failed cloud workspace archived before mobility retry",
                workspace_id=existing_cloud_workspace.id,
                repo=f"{git_owner}/{git_repo_name}",
                branch_name=cleaned_branch_name,
                last_error=existing_cloud_workspace.last_error,
            )
        else:
            return existing_cloud_workspace
    repo_config = await _load_repo_config_value_tx(user.id, git_owner, git_repo_name)
    if repo_config is None or not repo_config.configured:
        repo_config = await _bootstrap_repo_config_tx(user.id, git_owner, git_repo_name)
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
        _raise_repo_limit_exceeded(error)
    log_cloud_event(
        "cloud workspace ensured for mobility",
        workspace_id=workspace.id,
        repo=f"{git_owner}/{git_repo_name}",
        branch_name=cleaned_branch_name,
    )
    return workspace


def _cloud_workspace_should_be_replaced_for_mobility_retry(
    workspace: CloudWorkspace,
) -> bool:
    return (
        workspace.status == CloudWorkspaceStatus.error.value
        and workspace.anyharness_workspace_id is None
    )


async def _archive_failed_cloud_workspace_for_mobility_retry(workspace_id: UUID) -> None:
    async with db_session.open_async_transaction() as db:
        await archive_cloud_workspace_record_by_id(db, workspace_id=workspace_id)


async def _refresh_repo_env_snapshot_for_workspace(workspace: CloudWorkspace) -> CloudWorkspace:
    repo_config = await _load_repo_config_value_tx(
        workspace.user_id, workspace.git_owner, workspace.git_repo_name
    )
    if repo_config is None or not repo_config.configured:
        repo_config = await _bootstrap_repo_config_tx(
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
        return await _build_workspace_detail(workspace)
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
        return await _build_workspace_detail(workspace)

    if start_decision.action in {"return_ready", "return_current"}:
        if not has_requested_revision:
            return await _build_workspace_detail(workspace)
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
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    await _stop_workspace_runtime(workspace)
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_archived")
    workspace = await cloud_workspace_user_can_read(user_id, workspace_id)
    return await _build_workspace_detail(workspace)


async def archive_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    prune_error = None
    if workspace.archived_at is None:
        await command_store.supersede_workspace_commands(
            db,
            cloud_workspace_id=workspace.id,
            reason_code="cloud_workspace_archived",
            reason_message=(
                "Workspace command was superseded because the Cloud workspace was archived."
            ),
        )
        await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_archived")
        prune_error = await _enqueue_archive_prune_command(
            db, user_id=user_id, workspace=workspace
        )
    await archive_cloud_workspace_record(db, workspace=workspace)
    if prune_error is not None:
        workspace.cleanup_state = CloudWorkspaceCleanupState.failed.value
        workspace.cleanup_last_error = prune_error
    detail = await _build_workspace_detail_for_request(db, workspace)
    await db_session.commit_session(db)
    return detail


async def _enqueue_archive_prune_command(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace: CloudWorkspace,
) -> str | None:
    if workspace.target_id is None or not workspace.anyharness_workspace_id:
        return None
    try:
        await enqueue_command(
            db,
            user=SimpleNamespace(id=user_id),
            body=CreateCloudCommandRequest.model_validate(
                {
                    "idempotencyKey": (
                        f"archive-prune:{workspace.id}:{workspace.anyharness_workspace_id}"
                    ),
                    "targetId": workspace.target_id,
                    "workspaceId": workspace.anyharness_workspace_id,
                    "cloudWorkspaceId": workspace.id,
                    "kind": CloudCommandKind.prune_workspace_worktree.value,
                    "payload": {
                        "workspaceId": workspace.anyharness_workspace_id,
                        "cloudWorkspaceId": str(workspace.id),
                        "reason": "archive",
                    },
                    "source": CloudCommandSource.api.value,
                }
            ),
        )
    except CloudApiError as exc:
        log_cloud_event(
            "cloud workspace archive prune enqueue failed",
            workspace_id=workspace.id,
            target_id=workspace.target_id,
            anyharness_workspace_id=workspace.anyharness_workspace_id,
            error_code=exc.code,
        )
        return exc.message
    return None


async def restore_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    if workspace.archived_at is None:
        return await _build_workspace_detail_for_request(db, workspace)
    try:
        await restore_cloud_workspace_record(db, workspace=workspace)
        detail = await _build_workspace_detail_for_request(db, workspace)
        await db_session.commit_session(db)
    except Exception as exc:
        if not db_session.is_integrity_error(exc):
            raise
        await db_session.rollback_session(db)
        raise CloudApiError(
            "workspace_restore_conflict",
            "Another active workspace already exists for this repo and branch.",
            status_code=409,
        ) from exc
    return detail


async def purge_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    if await get_cloud_workspace_by_id(db, workspace_id) is None:
        return
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    if workspace.owner_scope != "personal":
        raise CloudApiError(
            "workspace_purge_unsupported",
            "Only personal cloud workspaces can be purged from this surface.",
            status_code=409,
        )
    if workspace.archived_at is None:
        raise CloudApiError(
            "workspace_purge_requires_archive",
            "Archive this Cloud workspace before purging it.",
            status_code=409,
        )
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_purged")
    await command_store.supersede_workspace_commands(
        db,
        cloud_workspace_id=workspace.id,
        reason_code="cloud_workspace_purged",
        reason_message="Workspace command was superseded because the Cloud workspace was purged.",
        command_kinds=None,
    )
    await purge_cloud_workspace_record(db, workspace=workspace)
    await db_session.commit_session(db)


async def delete_cloud_workspace(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> None:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user_id, workspace_id)
    await _revoke_claim_tokens_for_workspace(workspace, reason="workspace_deleted")
    workspace_record_id = workspace.id
    db.expunge(workspace)
    await _destroy_workspace_runtime(workspace)
    async with db_session.open_async_transaction() as delete_db:
        if refreshed := await load_cloud_workspace_by_id(delete_db, workspace_record_id):
            await delete_cloud_workspace_records_for_workspace(delete_db, refreshed)


async def _revoke_claim_tokens_for_workspace(
    workspace: CloudWorkspace,
    *,
    reason: str,
) -> None:
    async with db_session.open_async_transaction() as db:
        claim = await claims_store.get_claim_for_workspace(db, workspace.id)
        if claim is None:
            return
        if await claim_tokens_store.revoke_active_tokens_for_claim(
            db, claim_id=claim.id, reason=reason
        ):
            await mark_revoked_jtis_changed(db, target_id=claim.target_id)


# These helpers own the interaction with the persisted sandbox provider
# (pause / destroy) and delegate the persistence update to store.py primitives.


async def _stop_workspace_runtime(workspace: CloudWorkspace) -> None:
    """Pause the active sandbox and mark the workspace as stopped."""
    stop_started = time.perf_counter()
    log_cloud_event(
        "cloud workspace stop requested",
        workspace_id=workspace.id,
        sandbox_id=workspace.active_sandbox_id,
        status=workspace.status,
    )
    sandbox = await _load_workspace_owned_runtime_sandbox(workspace)
    if sandbox is not None:
        if sandbox.external_sandbox_id:
            provider = get_sandbox_provider(sandbox.provider)
            try:
                await provider.pause_sandbox(sandbox.external_sandbox_id)
            except Exception:
                failure_state = provider_failure_debug_state("stop")
                await _update_sandbox_status_tx(sandbox, failure_state.sandbox_status)
                log_cloud_event(
                    "cloud sandbox pause failed",
                    level=logging.WARNING,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
            else:
                await record_cloud_sandbox_usage_stopped(
                    sandbox_id=sandbox.id,
                    ended_at=utcnow(),
                    closed_by=USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
                )
                await _update_sandbox_status_tx(sandbox, "paused", stopped_at_now=True)
                log_cloud_event(
                    "cloud sandbox paused",
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
        else:
            await _update_sandbox_status_tx(sandbox, "paused", stopped_at_now=True)

    if workspace.status != CloudWorkspaceStatus.archived.value:
        transition_workspace_status(
            workspace,
            CloudWorkspaceStatus.archived,
            status_detail="Archived",
        )
    else:
        workspace.updated_at = utcnow()
    async with db_session.open_async_transaction() as db:
        await persist_workspace_stop_state(db, workspace)
    log_cloud_event(
        "cloud workspace stopped",
        workspace_id=workspace.id,
        elapsed_ms=duration_ms(stop_started),
    )


async def _destroy_workspace_runtime(workspace: CloudWorkspace) -> None:
    """Destroy the active sandbox and mark the workspace as stopped."""
    destroy_started = time.perf_counter()
    sandbox = await _load_workspace_owned_runtime_sandbox(workspace)
    if sandbox is not None:
        if sandbox.external_sandbox_id:
            provider = get_sandbox_provider(sandbox.provider)
            try:
                await provider.destroy_sandbox(sandbox.external_sandbox_id)
            except Exception:
                failure_state = provider_failure_debug_state("destroy")
                await _update_sandbox_status_tx(sandbox, failure_state.sandbox_status)
                log_cloud_event(
                    "cloud sandbox destroy failed",
                    level=logging.WARNING,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
            else:
                await record_cloud_sandbox_usage_stopped(
                    sandbox_id=sandbox.id,
                    ended_at=utcnow(),
                    closed_by=USAGE_SEGMENT_CLOSED_BY_DESTROY,
                )
                await _update_sandbox_status_tx(sandbox, "destroyed", stopped_at_now=True)
                log_cloud_event(
                    "cloud sandbox destroyed",
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                )
        else:
            await _update_sandbox_status_tx(sandbox, "destroyed", stopped_at_now=True)
    transition_workspace_status(workspace, CloudWorkspaceStatus.archived, status_detail="Archived")
    async with db_session.open_async_transaction() as db:
        await persist_workspace_destroy_state(db, workspace)
    log_cloud_event(
        "cloud workspace destroyed",
        workspace_id=workspace.id,
        elapsed_ms=duration_ms(destroy_started),
    )


async def _load_workspace_owned_runtime_sandbox(
    workspace: CloudWorkspace,
) -> CloudSandbox | None:
    """Load only the legacy workspace-owned runtime sandbox.

    Managed cloud target sandboxes are shared by all workspaces on a sandbox
    profile and target. Workspace stop/delete must not pause or destroy them.
    """
    sandbox_id = getattr(workspace, "active_sandbox_id", None)
    if sandbox_id is None:
        return None
    async with db_session.open_async_session() as db:
        sandbox = await load_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None:
        return None
    if sandbox.sandbox_profile_id is not None or sandbox.target_id is not None:
        log_cloud_event(
            "cloud workspace runtime action skipped non-workspace sandbox",
            workspace_id=workspace.id,
            sandbox_id=sandbox.id,
            sandbox_profile_id=sandbox.sandbox_profile_id,
            target_id=sandbox.target_id,
        )
        return None
    return sandbox
