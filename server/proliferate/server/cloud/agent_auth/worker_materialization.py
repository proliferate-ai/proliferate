"""Agent-auth worker materialization concern."""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandKind,
    CloudCommandStatus,
    CloudTargetStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxProfileAgentAuthTargetStateRecord,
    SandboxProfileRecord,
)
from proliferate.db.store.cloud_sync import command_records
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    WorkerAgentAuthMaterializationPlan,
    WorkerAgentAuthStatusRequest,
    WorkerAgentAuthStatusResponse,
)
from proliferate.server.cloud.agent_auth.worker_cleanup import _missing_worker_cleanup_paths
from proliferate.server.cloud.agent_auth.worker_plans import (
    _worker_cleanup_plans_from_state,
    _worker_cleanup_selection_plan,
    _worker_selection_plan,
)
from proliferate.server.cloud.live.service import (
    publish_worker_control_after_commit,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext

_ORG_ADMIN_ROLES = {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}
_GATEWAY_GRANT_TTL = timedelta(days=7)
_DEFAULT_MANAGED_CREDIT_AGENT_KINDS: tuple[CloudAgentKind, ...] = ("claude",)
_USER_FREE_CREDIT_SOURCE = "signup_free_credit"
_CLEANUP_SELECTION_ERROR_CODES = {
    "credential_revoked",
    "credential_share_revoked",
}
_MANAGED_CODEX_HOME = "/home/user/.proliferate/anyharness/agent-auth/codex"
_OPENCODE_ALLOWED_AUTH_FILES: frozenset[str] = frozenset({".config/opencode/auth.json"})
_TERMINAL_AGENT_AUTH_REFRESH_COMMAND_STATUSES = frozenset(
    {
        CloudCommandStatus.accepted.value,
        CloudCommandStatus.accepted_but_queued.value,
        CloudCommandStatus.rejected.value,
        CloudCommandStatus.expired.value,
        CloudCommandStatus.superseded.value,
        CloudCommandStatus.failed_delivery.value,
    }
)


async def worker_agent_auth_materialization_plan(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    command_id: UUID,
    revision: int,
    lease_id: str,
) -> WorkerAgentAuthMaterializationPlan:
    command = await _require_agent_auth_refresh_command(
        db,
        auth=auth,
        sandbox_profile_id=sandbox_profile_id,
        command_id=command_id,
        revision=revision,
        lease_id=lease_id,
    )
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.",
            code="sandbox_profile_not_found",
            status_code=404,
        )
    await _require_active_profile_target(db, auth=auth, profile=profile)
    if revision < profile.agent_auth_revision:
        return WorkerAgentAuthMaterializationPlan(
            applied=False,
            reason="superseded",
            currentRevision=profile.agent_auth_revision,
            targetId=auth.target_id,
            sandboxProfileId=profile.id,
            revision=revision,
            selections=[],
        )
    if revision != profile.agent_auth_revision:
        raise AgentAuthError(
            "Requested agent-auth revision does not match the profile.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )
    target_state = await _require_agent_auth_target_state(
        db,
        profile=profile,
        auth=auth,
        command=command,
    )
    selections = []
    selections.extend(_worker_cleanup_plans_from_state(target_state))
    for selection in await store.list_selections_for_profile(db, profile.id):
        cleanup_plan = await _worker_cleanup_selection_plan(db, selection)
        if cleanup_plan is not None:
            selections.append(cleanup_plan)
            continue
        if selection.status != "active":
            continue
        selections.append(
            await _worker_selection_plan(
                db,
                auth=auth,
                profile=profile,
                selection=selection,
            )
        )
    return WorkerAgentAuthMaterializationPlan(
        applied=True,
        reason=None,
        currentRevision=profile.agent_auth_revision,
        targetId=auth.target_id,
        sandboxProfileId=profile.id,
        revision=revision,
        selections=selections,
    )


async def record_worker_agent_auth_status(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    body: WorkerAgentAuthStatusRequest,
) -> WorkerAgentAuthStatusResponse:
    command = await _require_agent_auth_refresh_command(
        db,
        auth=auth,
        sandbox_profile_id=sandbox_profile_id,
        command_id=body.command_id,
        revision=body.revision,
        lease_id=body.lease_id,
    )
    if body.status not in {"materializing", "applied", "superseded", "failed"}:
        raise AgentAuthError(
            "Agent auth status is invalid.",
            code="agent_auth_status_invalid",
            status_code=400,
        )
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.",
            code="sandbox_profile_not_found",
            status_code=404,
        )
    await _require_active_profile_target(db, auth=auth, profile=profile)
    _validate_worker_status_revisions(body, profile)
    await _require_agent_auth_target_state(
        db,
        profile=profile,
        auth=auth,
        command=command,
    )
    existing = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
    )
    existing_applied = existing.applied_revision if existing is not None else None
    desired_revision = max(profile.agent_auth_revision, body.current_revision or body.revision)
    applied_revision = existing_applied
    status = body.status
    error_code = None
    error_message = None
    if body.status == "applied":
        applied_revision = (
            body.applied_revision if body.applied_revision is not None else body.revision
        )
        missing_cleanup_paths = await _missing_worker_cleanup_paths(
            db,
            sandbox_profile_id=profile.id,
            target_id=auth.target_id,
            applied_cleanup_paths=set(body.applied_cleanup_paths),
        )
        if missing_cleanup_paths:
            status = "failed"
            applied_revision = existing_applied
            error_code = "agent_auth_cleanup_incomplete"
            error_message = "Agent auth cleanup did not report all required paths: " + ", ".join(
                missing_cleanup_paths
            )
        elif applied_revision < desired_revision:
            status = "superseded"
        else:
            desired_revision = applied_revision
    elif body.status == "superseded":
        status = "superseded"
    elif body.status == "failed":
        error_code = body.error_code or "agent_auth_materialization_failed"
        error_message = _worker_status_error_message(error_code)
    if applied_revision is not None and applied_revision > desired_revision:
        desired_revision = applied_revision
    force_restart_required = existing.force_restart_required if existing is not None else False
    if status == "applied" and applied_revision == desired_revision:
        force_restart_required = False
    state = await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
        desired_revision=desired_revision,
        applied_revision=applied_revision,
        status=status,
        force_restart_required=force_restart_required,
        last_command_id=body.command_id,
        last_worker_id=auth.worker_id,
        last_error_code=error_code,
        last_error_message=error_message,
    )
    await worker_control_store.bump_control_revision(db, target_id=auth.target_id)
    await publish_worker_control_after_commit(
        db,
        target_id=auth.target_id,
        reason="state_changed",
    )
    return WorkerAgentAuthStatusResponse(
        sandboxProfileId=profile.id,
        targetId=auth.target_id,
        desiredRevision=state.desired_revision,
        appliedRevision=state.applied_revision,
        status=state.status,
    )


async def _require_active_profile_target(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: SandboxProfileRecord,
) -> targets_store.CloudTargetSnapshot:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise AgentAuthError(
            "Worker target no longer exists.",
            code="cloud_worker_target_missing",
            status_code=401,
        )
    if target.archived_at is not None or target.status == CloudTargetStatus.archived.value:
        raise AgentAuthError(
            "Worker target is no longer active.",
            code="cloud_worker_target_archived",
            status_code=409,
        )
    if (
        target.kind != "managed_cloud"
        or target.profile_target_role != "primary"
        or target.sandbox_profile_id != profile.id
        or profile.primary_target_id != target.id
    ):
        raise AgentAuthError(
            "Worker target is not the active primary target for this sandbox profile.",
            code="sandbox_profile_target_mismatch",
            status_code=409,
        )
    return target


def _validate_worker_status_revisions(
    body: WorkerAgentAuthStatusRequest,
    profile: SandboxProfileRecord,
) -> None:
    current_revision = body.current_revision
    applied_revision = body.applied_revision
    if current_revision is not None and current_revision > profile.agent_auth_revision:
        raise AgentAuthError(
            "Worker reported an unknown agent-auth revision.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )
    if applied_revision is not None and applied_revision > profile.agent_auth_revision:
        raise AgentAuthError(
            "Worker reported an unknown applied agent-auth revision.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )


def _worker_status_error_message(error_code: str) -> str:
    return f"Agent auth materialization failed ({error_code})."


async def _require_agent_auth_refresh_command(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    sandbox_profile_id: UUID,
    command_id: UUID,
    revision: int,
    lease_id: str,
) -> command_records.CloudCommandSnapshot:
    command = await commands_store.get_command_by_id(db, command_id)
    if (
        command is None
        or command.target_id != auth.target_id
        or command.leased_by_worker_id != auth.worker_id
        or command.kind != CloudCommandKind.refresh_agent_auth_config.value
        or command.status != CloudCommandStatus.leased.value
        or command.lease_id != lease_id
    ):
        raise AgentAuthError(
            "Agent auth config command is not leased by this worker.",
            code="agent_auth_command_not_found",
            status_code=404,
        )
    try:
        payload = json.loads(command.payload_json)
    except json.JSONDecodeError as exc:
        raise AgentAuthError(
            "Agent auth config command payload is invalid.",
            code="agent_auth_command_invalid",
            status_code=409,
        ) from exc
    if not isinstance(payload, dict) or payload.get("sandboxProfileId") != str(sandbox_profile_id):
        raise AgentAuthError(
            "Agent auth config command does not match the requested profile.",
            code="agent_auth_command_mismatch",
            status_code=409,
        )
    if payload.get("revision") != revision:
        raise AgentAuthError(
            "Agent auth config command does not match the requested revision.",
            code="agent_auth_command_mismatch",
            status_code=409,
        )
    return command


async def _require_agent_auth_target_state(
    db: AsyncSession,
    *,
    profile: SandboxProfileRecord,
    auth: WorkerAuthContext,
    command: command_records.CloudCommandSnapshot,
) -> SandboxProfileAgentAuthTargetStateRecord:
    state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=auth.target_id,
    )
    if state is None or state.last_command_id != command.id:
        raise AgentAuthError(
            "Agent auth config command is not current for this profile and target.",
            code="agent_auth_command_mismatch",
            status_code=409,
        )
    return state
