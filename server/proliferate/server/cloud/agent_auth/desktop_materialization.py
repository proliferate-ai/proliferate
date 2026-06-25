"""Desktop/gateway agent-auth materialization concern."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetStatus
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.models import (
    DesktopAgentAuthConfigApplyResponse,
    DesktopAgentAuthSyncedFileMaterialization,
    DesktopAgentAuthConfigApplyStatusRequest,
    WorkerAgentAuthSelectionPlan,
)
from proliferate.server.cloud.agent_auth.worker_cleanup import _pending_cleanup_entries_from_json
from proliferate.server.cloud.agent_auth.worker_plans import (
    _worker_cleanup_plan_from_entry,
    _worker_cleanup_selection_plan,
    _worker_selection_plan,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext

_DESKTOP_AGENT_AUTH_WORKER_ID = UUID(int=0)


async def desktop_agent_auth_config_apply_request(
    db: AsyncSession,
    *,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    target_id: UUID | None,
    actor_user_id: UUID,
) -> DesktopAgentAuthConfigApplyResponse:
    await _require_desktop_profile_owner(profile, actor_user_id=actor_user_id)
    resolved_target_id = await _resolve_primary_target_id(
        db,
        profile=profile,
        target_id=target_id,
    )
    auth = WorkerAuthContext(
        worker_id=_DESKTOP_AGENT_AUTH_WORKER_ID,
        target_id=resolved_target_id,
    )
    target_state = await store.get_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=resolved_target_id,
    )
    selections = await _desktop_agent_auth_selection_plans(
        db,
        auth=auth,
        profile=profile,
        target_state=target_state,
    )
    return DesktopAgentAuthConfigApplyResponse(
        applyRequest={
            "externalAuthScope": {
                "provider": "proliferate-cloud",
                "id": str(profile.id),
                "targetId": str(resolved_target_id),
            },
            "revision": profile.desired_agent_auth_revision,
            "selections": [_agent_auth_selection_config(plan) for plan in selections],
        },
        syncedFiles=_synced_file_materializations(selections),
    )


async def record_desktop_agent_auth_config_status(
    db: AsyncSession,
    *,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    body: DesktopAgentAuthConfigApplyStatusRequest,
    actor_user_id: UUID,
) -> None:
    await _require_desktop_profile_owner(profile, actor_user_id=actor_user_id)
    resolved_target_id = await _resolve_primary_target_id(
        db,
        profile=profile,
        target_id=body.target_id,
    )
    if body.revision > profile.desired_agent_auth_revision:
        raise AgentAuthError(
            "Desktop reported an unknown agent-auth revision.",
            code="agent_auth_revision_mismatch",
            status_code=409,
        )
    applied_revision = body.revision if body.applied and body.status == "applied" else None
    await store.upsert_target_state(
        db,
        sandbox_profile_id=profile.id,
        target_id=resolved_target_id,
        desired_revision=profile.desired_agent_auth_revision,
        applied_revision=applied_revision,
        status="applied" if applied_revision is not None else "failed",
        force_restart_required=False,
        last_command_id=None,
        last_worker_id=None,
        last_error_code=body.error_code,
        last_error_message=body.error_message,
    )


async def _desktop_agent_auth_selection_plans(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    target_state: SandboxProfileAgentAuthTargetStateRecord | None,
) -> list[WorkerAgentAuthSelectionPlan]:
    selections: list[WorkerAgentAuthSelectionPlan] = []
    if target_state is not None:
        for entry in _pending_cleanup_entries_from_json(target_state.pending_cleanup_json):
            plan = _worker_cleanup_plan_from_entry(entry)
            if plan is not None:
                selections.append(plan)
    for selection in await store.list_selections_for_profile(db, profile.id):
        cleanup_plan = await _worker_cleanup_selection_plan(db, selection)
        if cleanup_plan is not None:
            selections.append(cleanup_plan)
            continue
        if selection.status != "active":
            continue
        _reject_desktop_incompatible_selection(selection)
        selections.append(
            await _worker_selection_plan(
                db,
                auth=auth,
                profile=profile,
                selection=selection,
            )
        )
    return selections


def _agent_auth_selection_config(plan: WorkerAgentAuthSelectionPlan) -> dict[str, object]:
    protected_env: dict[str, str] = {}
    support_env: dict[str, str] = {}
    protected_config: dict[str, object] = {}
    support_config: dict[str, object] = {}
    expires_at: str | None = None
    synced_file_paths: list[str] = []
    if plan.gateway is not None:
        protected_env = dict(plan.gateway.protected_env)
        support_env = dict(plan.gateway.support_env)
        protected_config = dict(plan.gateway.protected_config)
        support_config = dict(plan.gateway.support_config)
        expires_at = plan.gateway.expires_at
    if plan.synced_files is not None:
        synced_file_paths = [
            str(file["relativePath"])
            for file in plan.synced_files.files
            if isinstance(file, dict) and file.get("relativePath") is not None
        ]
    return {
        "agentKind": plan.agent_kind,
        "authSlotId": plan.auth_slot_id,
        "materializationMode": plan.materialization_mode,
        "credentialId": str(plan.credential_id),
        "credentialRevision": plan.credential_revision,
        "status": plan.status,
        "credentialShareId": (
            str(plan.credential_share_id) if plan.credential_share_id is not None else None
        ),
        "expiresAt": expires_at,
        "protectedEnv": protected_env,
        "supportEnv": support_env,
        "protectedConfig": protected_config,
        "supportConfig": support_config,
        "syncedFilePaths": synced_file_paths,
    }


def _synced_file_materializations(
    plans: list[WorkerAgentAuthSelectionPlan],
) -> list[DesktopAgentAuthSyncedFileMaterialization]:
    files: list[DesktopAgentAuthSyncedFileMaterialization] = []
    for plan in plans:
        if plan.synced_files is None:
            continue
        for file in plan.synced_files.files:
            if not isinstance(file, dict):
                continue
            relative_path = file.get("relativePath")
            content = file.get("content")
            if isinstance(relative_path, str) and isinstance(content, str):
                files.append(
                    DesktopAgentAuthSyncedFileMaterialization(
                        relativePath=relative_path,
                        content=content,
                    )
                )
    return files


async def _require_desktop_profile_owner(
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    *,
    actor_user_id: UUID,
) -> None:
    if profile.owner_scope == "personal" and profile.owner_user_id == actor_user_id:
        return
    raise AgentAuthError(
        "Desktop agent-auth config can only be materialized for the signed-in user's personal profile.",
        code="agent_auth_desktop_profile_unsupported",
        status_code=403,
    )


async def _resolve_primary_target_id(
    db: AsyncSession,
    *,
    profile: sandbox_profile_store.SandboxProfileSnapshot,
    target_id: UUID | None,
) -> UUID:
    resolved_target_id = target_id or profile.primary_target_id
    if resolved_target_id is None:
        raise AgentAuthError(
            "Sandbox profile does not have a primary target.",
            code="agent_auth_target_missing",
            status_code=409,
        )
    target = await targets_store.get_target_by_id(db, resolved_target_id)
    if target is None or target.archived_at is not None:
        raise AgentAuthError(
            "Agent-auth target was not found for this sandbox profile.",
            code="agent_auth_target_not_found",
            status_code=404,
        )
    if (
        target.status == CloudTargetStatus.archived.value
        or target.kind != "managed_cloud"
        or target.profile_target_role != "primary"
        or target.sandbox_profile_id != profile.id
        or profile.primary_target_id != target.id
    ):
        raise AgentAuthError(
            "Agent-auth target is not the active primary target for this sandbox profile.",
            code="agent_auth_target_mismatch",
            status_code=409,
        )
    return resolved_target_id


def _reject_desktop_incompatible_selection(selection: SandboxAgentAuthSelectionRecord) -> None:
    if selection.materialization_mode in {"gateway_env", "synced_files"}:
        return
    raise AgentAuthError(
        "Managed sandbox gateway access does not support this agent credential materialization mode.",
        code="agent_auth_materialization_mode_unsupported",
        status_code=409,
    )
