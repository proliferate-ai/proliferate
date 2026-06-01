from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, replace
from datetime import timedelta
from types import SimpleNamespace
from typing import NoReturn
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity, OwnerSelection
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
    CloudCommandKind,
    CloudCommandSource,
    CloudCommandStatus,
    CloudTargetKind,
    CloudTargetStatus,
    CloudWorkspaceCleanupState,
    CloudWorkspaceStatus,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import billing as billing_store
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.automation_cloud_workspace_claims import (
    create_managed_cloud_workspace_for_claimed_run,
)
from proliferate.db.store.automations import (
    AutomationRunValue,
    list_latest_runs_by_cloud_workspace_ids_for_user,
)
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_repo_config import (
    get_cloud_repo_config,
    get_organization_cloud_repo_config,
)
from proliferate.db.store.cloud_runtime_environments import (
    get_runtime_environment_for_workspace,
    load_runtime_environment_for_workspace,
)
from proliferate.db.store.cloud_sync import backfill as backfill_store
from proliferate.db.store.cloud_sync import commands as command_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspaces import (
    CloudRepoLimitExceededError,
    archive_cloud_workspace_record,
    archive_cloud_workspace_record_by_id,
    create_cloud_workspace_for_user,
    create_direct_target_cloud_workspace,
    delete_cloud_workspace_records_for_workspace,
    get_cloud_workspace_by_id,
    get_existing_cloud_workspace,
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
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.integrations.sandbox import get_configured_sandbox_provider, get_sandbox_provider
from proliferate.server.automations.domain.claim_lifecycle import (
    CLOUD_WORKSPACE_CREATION_TRANSITION,
    claim_is_active,
)
from proliferate.server.automations.worker.cloud_execution.command_models import (
    EnsureRepoCheckoutPayload,
    MaterializeWorkspacePayload,
    SendPromptPayload,
    StartSessionPayload,
)
from proliferate.server.automations.worker.cloud_execution.commands import (
    parse_materialize_workspace_result,
    parse_start_session_result,
)
from proliferate.server.automations.worker.cloud_executor_commands import (
    AutomationCommandResult,
    wait_for_command_result,
)
from proliferate.server.billing.models import BillingSnapshot, SandboxStartAuthorization
from proliferate.server.billing.service import (
    authorize_sandbox_start,
    authorize_sandbox_start_for_billing_subject,
    get_billing_snapshot_for_subject,
    get_billing_snapshot_for_subject_in_session,
    record_cloud_sandbox_usage_stopped,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud._logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.claims.access import load_workspace_exposure_and_claim
from proliferate.server.cloud.claims.domain.policy import is_org_admin_role
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.commands.service import (
    enqueue_command,
    mark_pending_prompt_interaction_failed_for_command,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import (
    publish_command_status_after_commit,
    publish_worker_control_after_commit,
)
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
    cloud_workspace_user_can_archive_with_db,
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
    BootstrapWorkspaceRemoteAccessRequest,
    LaunchWorkspaceOnTargetRequest,
    WorkspaceConnection,
    WorkspaceCreatorContext,
    WorkspaceDetail,
    WorkspaceDirectTargetContext,
    WorkspaceSummary,
    WorkspaceTargetLaunchCommandIds,
    WorkspaceTargetLaunchResponse,
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
CLOUD_DESKTOP_REMOTE_ACCESS_ORIGIN_JSON = '{"kind":"human","entrypoint":"desktop"}'
CLOUD_SYSTEM_ORIGIN_JSON = '{"kind":"system","entrypoint":"cloud"}'
CREATE_WORKSPACE_ORIGIN_BY_SOURCE = {
    "desktop": ("manual_desktop", '{"kind":"human","entrypoint":"desktop"}'),
    "web": ("manual_web", '{"kind":"human","entrypoint":"web"}'),
    "mobile": ("manual_mobile", '{"kind":"human","entrypoint":"mobile"}'),
}
CLOUD_REMOTE_ACCESS_TEMPLATE_VERSION = "desktop-remote-access-v1"
CLOUD_TARGET_LAUNCH_TEMPLATE_VERSION = "desktop-target-launch-v1"
TARGET_LAUNCH_COMMAND_WAIT_TIMEOUT = timedelta(seconds=240)


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


def _direct_target_context_for_workspace(
    workspace: CloudWorkspace,
    target_kind: str | None,
) -> WorkspaceDirectTargetContext | None:
    if (
        workspace.target_id is None
        or target_kind is None
        or target_kind == CloudTargetKind.managed_cloud.value
        or not workspace.anyharness_workspace_id
    ):
        return None
    return WorkspaceDirectTargetContext(
        target_id=str(workspace.target_id),
        target_kind=target_kind,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
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


async def _workspace_summaries_for_request(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspaces: list[CloudWorkspace],
) -> list[WorkspaceSummary]:
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        db,
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
            target_id=workspace.target_id,
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
            billing = await get_billing_snapshot_for_subject_in_session(db, billing_subject_id)
            snapshots_by_subject[billing_subject_id] = billing
        action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
        direct_target_context = _direct_target_context_for_workspace(
            workspace,
            target.kind if target is not None else None,
        ) or _direct_target_context_for_automation_run(
            automation_runs_by_workspace.get(workspace.id)
        )
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
                direct_target_context=direct_target_context,
                exposure=exposure,
                claim=claim,
                last_session_summary=latest_sessions[0] if latest_sessions else None,
                target_kind=target.kind if target is not None else None,
                target_label=target.display_name if target is not None else None,
                target_online=(
                    target.status == CloudTargetStatus.online.value if target is not None else None
                ),
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
    async with db_session.open_async_session() as db:
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


def _exposure_owner_fields(workspace: CloudWorkspace) -> tuple[UUID | None, UUID | None, str]:
    if workspace.owner_scope == "personal":
        if workspace.owner_user_id is None:
            raise CloudApiError(
                "workspace_owner_invalid",
                "Personal workspace is missing its owner.",
                status_code=409,
            )
        return workspace.owner_user_id, None, "private"
    if workspace.owner_scope == "organization":
        if workspace.organization_id is None:
            raise CloudApiError(
                "workspace_owner_invalid",
                "Organization workspace is missing its organization.",
                status_code=409,
            )
        return None, workspace.organization_id, "shared_unclaimed"
    raise CloudApiError(
        "workspace_owner_invalid",
        "Workspace owner scope is not supported for remote access.",
        status_code=409,
    )


def _remote_access_repo_fields(
    body: BootstrapWorkspaceRemoteAccessRequest,
) -> tuple[str, str, str, str, str]:
    repo = body.repo
    fallback_name = (
        (body.display_name or "").strip() or body.anyharness_workspace_id.strip() or "workspace"
    )
    if repo is None:
        return "local", "local", fallback_name, "default", "default"

    provider = repo.provider.strip() or "local"
    owner = repo.owner.strip() or "local"
    name = repo.name.strip() or fallback_name
    branch = repo.branch.strip() or "default"
    base_branch = (repo.base_branch or "").strip() or branch
    return provider, owner, name, branch, base_branch


async def bootstrap_workspace_remote_access(
    db: AsyncSession,
    user: ActorIdentity,
    body: BootstrapWorkspaceRemoteAccessRequest,
) -> WorkspaceDetail:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=body.target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "remote_access_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.owner_scope != "personal" or target.owner_user_id != user.id:
        raise CloudApiError(
            "remote_access_target_not_personal",
            "Enabling remote access for an existing workspace requires a personal target.",
            status_code=409,
        )
    if target.kind not in {
        CloudTargetKind.desktop_dispatch.value,
        CloudTargetKind.ssh.value,
        CloudTargetKind.self_hosted_cloud.value,
    }:
        raise CloudApiError(
            "remote_access_target_kind_unsupported",
            "This target cannot backfill an existing workspace for remote access.",
            status_code=409,
        )
    if target.status != CloudTargetStatus.online.value:
        raise CloudApiError(
            "remote_access_target_offline",
            "Remote access requires the target worker to be online.",
            status_code=409,
        )

    billing_subject = await billing_store.ensure_personal_billing_subject(db, user.id)
    git_provider, git_owner, git_repo_name, git_branch, git_base_branch = (
        _remote_access_repo_fields(body)
    )
    mapped = await backfill_store.upsert_synced_workspace(
        db,
        target_id=target.id,
        anyharness_workspace_id=body.anyharness_workspace_id,
        billing_subject_id=billing_subject.id,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        display_name=body.display_name,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=git_branch,
        git_base_branch=git_base_branch,
        origin_json=CLOUD_DESKTOP_REMOTE_ACCESS_ORIGIN_JSON,
        template_version=CLOUD_REMOTE_ACCESS_TEMPLATE_VERSION,
    )
    workspace = await get_cloud_workspace_by_id(db, mapped.id)
    if workspace is None:
        raise CloudApiError(
            "remote_access_workspace_missing",
            "Remote access workspace could not be created.",
            status_code=500,
        )

    exposure = await exposures_store.upsert_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=body.anyharness_workspace_id,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        visibility="private",
        claimed_by_user_id=None,
        default_projection_level="live",
        commandable=True,
        status="active",
        origin="manual_desktop",
    )
    await publish_worker_control_after_commit(db, target_id=target.id, reason="exposures")
    await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": (
                    "remote-access-bootstrap:"
                    f"{target.id}:{workspace.id}:{exposure.id}:{exposure.revision}"
                ),
                "targetId": target.id,
                "workspaceId": body.anyharness_workspace_id,
                "cloudWorkspaceId": workspace.id,
                "kind": CloudCommandKind.backfill_exposed_workspace.value,
                "payload": {"workspaceId": body.anyharness_workspace_id},
                "source": CloudCommandSource.api.value,
            }
        ),
    )
    return await _build_workspace_detail_for_request(db, workspace)


async def launch_workspace_on_target(
    db: AsyncSession,
    user: ActorIdentity,
    body: LaunchWorkspaceOnTargetRequest,
) -> WorkspaceTargetLaunchResponse:
    prompt_text = body.prompt.strip()
    if not prompt_text:
        raise CloudApiError(
            "target_launch_prompt_required",
            "Enter a prompt before launching desktop dispatch.",
            status_code=400,
        )
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=body.target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "target_launch_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.owner_scope != "personal" or target.owner_user_id != user.id:
        raise CloudApiError(
            "target_launch_target_not_personal",
            "Launching on a desktop target requires a personal target.",
            status_code=409,
        )
    if target.kind not in {
        CloudTargetKind.desktop_dispatch.value,
        CloudTargetKind.ssh.value,
        CloudTargetKind.self_hosted_cloud.value,
    }:
        raise CloudApiError(
            "target_launch_target_kind_unsupported",
            "This target cannot launch new workspaces.",
            status_code=409,
        )
    if target.status != CloudTargetStatus.online.value:
        raise CloudApiError(
            "target_launch_target_offline",
            "Desktop dispatch requires the target worker to be online.",
            status_code=409,
        )

    resolved = await _resolve_new_direct_target_workspace_create(
        db,
        user=user,
        body=body,
    )
    repo_root_path, worktree_path = _direct_target_workspace_paths(
        git_owner=resolved.git_owner,
        git_repo_name=resolved.git_repo_name,
        branch_name=resolved.git_branch,
        target_kind=target.kind,
        workspace_root=target.default_workspace_root,
    )
    billing_subject = await billing_store.ensure_personal_billing_subject(db, user.id)
    workspace = await create_direct_target_cloud_workspace(
        db,
        target_id=target.id,
        user_id=user.id,
        billing_subject_id=billing_subject.id,
        created_by_user_id=user.id,
        display_name=resolved.display_name,
        git_provider=resolved.git_provider,
        git_owner=resolved.git_owner,
        git_repo_name=resolved.git_repo_name,
        git_branch=resolved.git_branch,
        git_base_branch=resolved.git_base_branch,
        worktree_path=worktree_path,
        origin_json=json.dumps(
            {
                "kind": "human",
                "entrypoint": body.source,
                "targetId": str(target.id),
                "agentKind": body.agent_kind,
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        template_version=CLOUD_TARGET_LAUNCH_TEMPLATE_VERSION,
        origin="manual_mobile" if body.source == "mobile" else "manual_web",
    )
    workspace_id = workspace.id
    await db_session.commit_session(db)

    try:
        checkout = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            kind=CloudCommandKind.ensure_repo_checkout.value,
            payload=EnsureRepoCheckoutPayload(
                provider=resolved.git_provider,
                owner=resolved.git_owner,
                name=resolved.git_repo_name,
                path=repo_root_path,
                base_branch=resolved.git_base_branch,
            ).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:checkout",
            source=body.source,
        )
        await _wait_for_target_launch_command(checkout, workspace_id=workspace_id)

        root_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=None,
            kind=CloudCommandKind.materialize_workspace.value,
            payload=MaterializeWorkspacePayload(
                mode="existing_path",
                path=repo_root_path,
                display_name=f"{resolved.git_owner}/{resolved.git_repo_name}",
                origin={"kind": "system", "entrypoint": "cloud"},
                creator_context={"kind": "human", "label": "Mobile"},
            ).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:materialize-root",
            source=body.source,
        )
        root_result = parse_materialize_workspace_result(
            await _wait_for_target_launch_command(root_command, workspace_id=workspace_id),
        )

        worktree_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            kind=CloudCommandKind.materialize_workspace.value,
            payload=MaterializeWorkspacePayload(
                mode="worktree",
                repo_root_id=root_result.repo_root_id,
                target_path=worktree_path,
                new_branch_name=resolved.git_branch,
                base_branch=resolved.git_base_branch,
                origin={"kind": "system", "entrypoint": "cloud"},
                creator_context={"kind": "human", "label": "Mobile"},
            ).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:materialize-worktree",
            source=body.source,
        )
        materialized = parse_materialize_workspace_result(
            await _wait_for_target_launch_command(worktree_command, workspace_id=workspace_id),
        )

        start_payload = StartSessionPayload(
            workspace_id=materialized.anyharness_workspace_id,
            agent_kind=body.agent_kind,
            model_id=body.model_id,
            mode_id=body.mode_id,
            origin={"kind": "system", "entrypoint": "cloud"},
        ).to_json()
        start_payload["subagentsEnabled"] = False
        start_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            kind=CloudCommandKind.start_session.value,
            payload=start_payload,
            idempotency_key=f"target-launch:{workspace_id}:start-session",
            source=body.source,
        )
        started = parse_start_session_result(
            await _wait_for_target_launch_command(start_command, workspace_id=workspace_id),
        )

        config_command_ids: list[str] = []
        for update in body.session_config_updates:
            config_command = await _enqueue_target_launch_command(
                db,
                user=user,
                target_id=target.id,
                cloud_workspace_id=workspace_id,
                session_id=started.session_id,
                kind=CloudCommandKind.update_session_config.value,
                payload={"configId": update.config_id, "value": update.value},
                idempotency_key=(
                    f"target-launch:{workspace_id}:config:{update.config_id}:{update.value}"
                ),
                source=body.source,
            )
            config_command_ids.append(str(config_command.id))
            await _wait_for_target_launch_command(
                config_command,
                workspace_id=workspace_id,
            )

        prompt_id = body.prompt_id or f"target-launch:{workspace_id}:prompt:{uuid4().hex}"
        send_command = await _enqueue_target_launch_command(
            db,
            user=user,
            target_id=target.id,
            cloud_workspace_id=workspace_id,
            session_id=started.session_id,
            kind=CloudCommandKind.send_prompt.value,
            payload=SendPromptPayload(text=prompt_text, prompt_id=prompt_id).to_json(),
            idempotency_key=f"target-launch:{workspace_id}:send-prompt:{prompt_id}",
            source=body.source,
        )
        await _wait_for_target_launch_command(send_command, workspace_id=workspace_id)
    except CloudApiError as exc:
        message = format_exception_message(exc) or exc.message
        await _mark_workspace_error_tx(
            workspace_id, message, status_detail="Desktop dispatch failed"
        )
        raise
    except (RuntimeError, TimeoutError, ValueError) as exc:
        message = format_exception_message(exc) or str(exc)
        await _mark_workspace_error_tx(
            workspace_id, message, status_detail="Desktop dispatch failed"
        )
        raise CloudApiError(
            "target_launch_failed",
            message or "Desktop dispatch failed before the prompt could be sent.",
            status_code=502,
        ) from exc

    db.expire_all()
    refreshed = await get_cloud_workspace_by_id(db, workspace_id)
    if refreshed is None:
        raise CloudApiError(
            "target_launch_workspace_missing",
            "Launched workspace could not be loaded.",
            status_code=500,
        )
    return WorkspaceTargetLaunchResponse(
        workspace=await _build_workspace_detail_for_request(db, refreshed),
        session_id=started.session_id,
        send_command_id=str(send_command.id),
        command_ids=WorkspaceTargetLaunchCommandIds(
            ensure_repo_checkout=str(checkout.id),
            materialize_root=str(root_command.id),
            materialize_worktree=str(worktree_command.id),
            start_session=str(start_command.id),
            send_prompt=str(send_command.id),
            update_session_config=config_command_ids,
        ),
    )


async def _resolve_new_direct_target_workspace_create(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    body: LaunchWorkspaceOnTargetRequest,
) -> ResolvedCloudWorkspaceCreate:
    if body.git_provider != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "unsupported_repo_provider",
            "Only GitHub repositories are supported for desktop dispatch.",
            status_code=400,
        )
    if get_linked_github_account(user) is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before launching desktop dispatch.",
            status_code=400,
        )
    cleaned_branch_name = body.branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a new branch before launching desktop dispatch.",
            status_code=400,
        )
    if body.agent_kind not in allowed_agent_kinds():
        raise CloudApiError(
            "unsupported_agent_kind",
            "The selected agent is not supported for desktop dispatch.",
            status_code=400,
        )

    repo_config = await get_cloud_repo_config(
        db,
        user_id=user.id,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
    )
    if repo_config is None or not repo_config.configured:
        raise CloudApiError(
            "cloud_repo_not_configured",
            "Configure cloud settings for this repo before launching desktop dispatch.",
            status_code=409,
        )

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
        missing_access_message="Connect a GitHub account before launching desktop dispatch.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before launching desktop dispatch."
        ),
    )
    cleaned_base_branch = body.base_branch.strip() if body.base_branch else ""
    resolved_base_branch = cleaned_base_branch or (repo_config.default_branch or "").strip()
    if not resolved_base_branch:
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
    existing_cloud_workspace = await get_existing_cloud_workspace(
        db,
        user_id=user.id,
        git_provider=body.git_provider,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
        git_branch=cleaned_branch_name,
    )
    if existing_cloud_workspace is not None:
        raise CloudApiError(
            "cloud_branch_already_exists",
            (
                f"A cloud workspace already exists for branch '{cleaned_branch_name}'. "
                "Open the existing workspace or choose a different branch."
            ),
            status_code=400,
        )
    return ResolvedCloudWorkspaceCreate(
        git_provider=body.git_provider,
        git_owner=body.git_owner,
        git_repo_name=body.git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=resolved_base_branch,
        display_name=(
            body.display_name.strip() if body.display_name and body.display_name.strip() else None
        ),
        active_sandbox_count=0,
        selected_agent_kinds=(body.agent_kind,),
        cloud_repo_limit=None,
    )


def _direct_target_workspace_paths(
    *,
    git_owner: str,
    git_repo_name: str,
    branch_name: str,
    target_kind: str,
    workspace_root: str | None,
) -> tuple[str, str]:
    default_root = (
        "~/Proliferate/workspaces"
        if target_kind == CloudTargetKind.desktop_dispatch.value
        else "~/proliferate-workspaces"
    )
    root = (workspace_root or default_root).rstrip("/") or default_root
    owner = git_owner.strip().replace("/", "-")
    name = git_repo_name.strip().replace("/", "-")
    branch_segment = branch_name.strip().replace("/", "-")
    return (
        f"{root}/repos/{owner}/{name}",
        f"{root}/worktrees/{owner}/{name}/{branch_segment}",
    )


async def _enqueue_target_launch_command(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    kind: str,
    payload: dict[str, object],
    idempotency_key: str,
    source: str,
    session_id: str | None = None,
) -> command_store.CloudCommandSnapshot:
    command = await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": idempotency_key,
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": session_id,
                "kind": kind,
                "payload": payload,
                "source": source,
            }
        ),
    )
    await db_session.commit_session(db)
    return command


async def _wait_for_target_launch_command(
    command: command_store.CloudCommandSnapshot,
    *,
    workspace_id: UUID,
) -> AutomationCommandResult:
    del workspace_id
    try:
        return await wait_for_command_result(
            command,
            timeout=TARGET_LAUNCH_COMMAND_WAIT_TIMEOUT,
        )
    except (RuntimeError, TimeoutError):
        await _mark_target_launch_command_failed_interaction_if_needed(command.id)
        raise


async def _mark_target_launch_command_failed_interaction_if_needed(
    command_id: UUID,
) -> None:
    async with db_session.open_async_session() as fresh_db:
        latest = await command_store.get_command_by_id(fresh_db, command_id)
        if latest is None:
            return
        if latest.status not in {
            CloudCommandStatus.rejected.value,
            CloudCommandStatus.failed_delivery.value,
            CloudCommandStatus.expired.value,
            CloudCommandStatus.superseded.value,
        }:
            return
        await mark_pending_prompt_interaction_failed_for_command(fresh_db, latest)
        await publish_command_status_after_commit(fresh_db, latest)
        await db_session.commit_session(fresh_db)


async def enable_cloud_workspace_remote_access(
    db: AsyncSession,
    user: ActorIdentity,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_interact_with_db(db, user.id, workspace_id)
    if workspace.target_id is None or not workspace.anyharness_workspace_id:
        raise CloudApiError(
            "remote_access_workspace_not_materialized",
            "Remote access requires a materialized target workspace.",
            status_code=409,
        )
    target = await targets_store.get_target_by_id(db, workspace.target_id)
    if target is None:
        raise CloudApiError(
            "remote_access_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.status != CloudTargetStatus.online.value:
        raise CloudApiError(
            "remote_access_target_offline",
            "Remote access requires the target worker to be online.",
            status_code=409,
        )

    owner_user_id, organization_id, visibility = _exposure_owner_fields(workspace)
    exposure = await exposures_store.upsert_workspace_exposure(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
        owner_scope=workspace.owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        visibility=visibility,
        claimed_by_user_id=None,
        default_projection_level="live",
        commandable=True,
        status="active",
        origin=workspace.origin,
    )
    await publish_worker_control_after_commit(
        db,
        target_id=workspace.target_id,
        reason="exposures",
    )
    await enqueue_command(
        db,
        user=user,
        body=CreateCloudCommandRequest.model_validate(
            {
                "idempotencyKey": (
                    f"remote-access-backfill:{workspace.id}:{exposure.id}:{exposure.revision}"
                ),
                "targetId": workspace.target_id,
                "workspaceId": workspace.anyharness_workspace_id,
                "cloudWorkspaceId": workspace.id,
                "kind": CloudCommandKind.backfill_exposed_workspace.value,
                "payload": {"workspaceId": workspace.anyharness_workspace_id},
                "source": CloudCommandSource.api.value,
            }
        ),
    )
    return await _build_workspace_detail_for_request(db, workspace)


async def disable_cloud_workspace_remote_access(
    db: AsyncSession,
    user: ActorIdentity,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_archive_with_db(db, user.id, workspace_id)
    if workspace.target_id is None:
        return await _build_workspace_detail_for_request(db, workspace)
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    if exposure is not None:
        await exposures_store.archive_workspace_exposure(db, exposure_id=exposure.id)
        await publish_worker_control_after_commit(
            db,
            target_id=workspace.target_id,
            reason="exposures",
        )
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
        target_id=workspace.target_id,
        limit=1,
    )
    target = (
        await targets_store.get_target_by_id(db, workspace.target_id)
        if workspace.target_id is not None
        else None
    )
    billing = await get_billing_snapshot_for_subject_in_session(
        db,
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id,
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
        db,
        user_id=workspace.user_id,
        cloud_workspace_ids=[workspace.id],
    )
    direct_target_context = _direct_target_context_for_workspace(
        workspace,
        target.kind if target is not None else None,
    ) or _direct_target_context_for_automation_run(automation_runs_by_workspace.get(workspace.id))
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
        direct_target_context=direct_target_context,
        exposure=exposure,
        claim=claim,
        last_session_summary=latest_sessions[0] if latest_sessions else None,
        target_kind=target.kind if target is not None else None,
        target_label=target.display_name if target is not None else None,
        target_online=(
            target.status == CloudTargetStatus.online.value if target is not None else None
        ),
    )


async def _build_workspace_detail(
    workspace: CloudWorkspace,
) -> WorkspaceDetail:
    exposure = None
    claim = None
    async with db_session.open_async_session() as db:
        exposure, claim = await load_workspace_exposure_and_claim(
            db,
            target_id=workspace.target_id,
            cloud_workspace_id=workspace.id,
        )
        runtime_environment = await load_runtime_environment_for_workspace(db, workspace)
    runtime_auth = await load_workspace_runtime_auth_snapshot(
        workspace=workspace,
        runtime_environment=runtime_environment,
    )
    ready_agent_kind_values = await _load_agent_auth_agent_kinds_for_workspace(workspace)
    latest_sessions = ()
    target = None
    automation_runs_by_workspace = {}
    async with db_session.open_async_session() as db:
        latest_sessions = await events_store.list_session_projections_for_workspace(
            db,
            cloud_workspace_id=workspace.id,
            target_id=workspace.target_id,
            limit=1,
        )
        target = (
            await targets_store.get_target_by_id(db, workspace.target_id)
            if workspace.target_id is not None
            else None
        )
        automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
            db,
            user_id=workspace.user_id,
            cloud_workspace_ids=[workspace.id],
        )
    billing = await get_billing_snapshot_for_subject(
        runtime_environment.billing_subject_id
        if runtime_environment is not None
        else workspace.billing_subject_id
    )
    action_block_kind, action_block_reason = _workspace_action_block(workspace, billing)
    direct_target_context = _direct_target_context_for_workspace(
        workspace,
        target.kind if target is not None else None,
    ) or _direct_target_context_for_automation_run(automation_runs_by_workspace.get(workspace.id))
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
        direct_target_context=direct_target_context,
        exposure=exposure,
        claim=claim,
        last_session_summary=latest_sessions[0] if latest_sessions else None,
        target_kind=target.kind if target is not None else None,
        target_label=target.display_name if target is not None else None,
        target_online=(
            target.status == CloudTargetStatus.online.value if target is not None else None
        ),
    )


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
        await claim_tokens_store.revoke_active_tokens_for_claim(
            db,
            claim_id=claim.id,
            reason=reason,
        )


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

    Managed cloud slots are shared by all workspaces on a sandbox profile and
    target. Workspace stop/delete must not pause or destroy that shared slot.
    """
    sandbox_id = getattr(workspace, "active_sandbox_id", None)
    if sandbox_id is None:
        return None
    async with db_session.open_async_session() as db:
        sandbox = await load_cloud_sandbox_by_id(db, sandbox_id)
    if sandbox is None:
        return None
    if sandbox.cloud_workspace_id != workspace.id:
        log_cloud_event(
            "cloud workspace runtime action skipped non-workspace sandbox",
            workspace_id=workspace.id,
            sandbox_id=sandbox.id,
            sandbox_profile_id=sandbox.sandbox_profile_id,
            target_id=sandbox.target_id,
        )
        return None
    return sandbox


async def get_cloud_connection(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceConnection:
    workspace = await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)
    await _reject_shared_workspace_static_connection(workspace)
    async with db_session.open_async_session() as lookup_db:
        automation_runs_by_workspace = await list_latest_runs_by_cloud_workspace_ids_for_user(
            lookup_db,
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
        target = await get_workspace_connection(db, workspace)
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
        await _mark_workspace_error_tx(
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

    async with db_session.open_async_session() as reload_db:
        reloaded_workspace = await load_cloud_workspace_by_id(reload_db, workspace.id)
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
    async with db_session.open_async_session() as db:
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
