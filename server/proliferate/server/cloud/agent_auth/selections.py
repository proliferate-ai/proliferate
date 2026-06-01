"""Agent-auth selections concern."""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import PolicyDenied
from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxAgentAuthSelectionRecord,
    SandboxProfileAgentAuthTargetStateRecord,
)
from proliferate.server.cloud.agent_auth.access_control import _require_profile_access
from proliferate.server.cloud.agent_auth.domain.policy import (
    SelectionPlan,
    can_select_credential_for_profile,
    selection_plan_for_credential,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.gateway_policies import (
    _require_credential_ready_for_selection,
)
from proliferate.server.cloud.agent_auth.refresh import _mark_target_pending_and_queue_refresh
from proliferate.server.cloud.agent_auth.router_materializations import (
    _disable_bifrost_runtime_materializations_for_selection,
)

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


async def list_selections(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
) -> tuple[SandboxAgentAuthSelectionRecord, ...]:
    profile = await _require_profile_access(db, actor_user_id, sandbox_profile_id, admin=False)
    return await store.list_selections_for_profile(db, profile.id)


async def select_credential_for_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
    agent_kind: CloudAgentKind,
    credential_id: UUID,
    credential_share_id: UUID | None,
    force_restart: bool,
) -> SandboxAgentAuthSelectionRecord:
    profile = await _require_profile_access(db, actor_user_id, sandbox_profile_id, admin=True)
    credential = await store.get_credential(db, credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if credential.agent_kind != agent_kind:
        raise AgentAuthError(
            "Credential is for a different agent kind.",
            code="agent_kind_mismatch",
            status_code=400,
        )
    await _require_credential_ready_for_selection(db, credential)
    share = None
    if credential_share_id is not None:
        share = await store.get_active_credential_share(
            db,
            credential_id=credential.id,
            organization_id=profile.organization_id or UUID(int=0),
        )
        if share is None or share.id != credential_share_id:
            raise AgentAuthError(
                "Credential share is not active.",
                code="credential_share_required",
                status_code=403,
            )
    has_active_share = share is not None
    if (
        profile.owner_scope == "organization"
        and credential.owner_scope == "personal"
        and credential.credential_kind == "synced_path"
        and credential.owner_user_id != actor_user_id
        and not has_active_share
    ):
        raise AgentAuthError(
            "Credential is not visible to this sandbox profile.",
            code="credential_not_visible",
            status_code=403,
        )
    verdict = can_select_credential_for_profile(
        profile_owner_scope=profile.owner_scope,
        profile_owner_user_id=profile.owner_user_id,
        profile_organization_id=profile.organization_id,
        credential_owner_scope=credential.owner_scope,
        credential_owner_user_id=credential.owner_user_id,
        credential_organization_id=credential.organization_id,
        credential_kind=credential.credential_kind,
        has_active_share=has_active_share,
    )
    if isinstance(verdict, PolicyDenied):
        raise AgentAuthError(verdict.message, code=verdict.code, status_code=verdict.status_code)
    plan = selection_plan_for_credential(
        agent_kind=agent_kind,
        credential_kind=credential.credential_kind,
    )
    if not isinstance(plan, SelectionPlan):
        raise AgentAuthError(plan.message, code=plan.code, status_code=plan.status_code)
    if (
        agent_kind == "opencode"
        and plan.materialization_mode == "gateway_env"
        and not settings.agent_gateway_opencode_enabled
    ):
        raise AgentAuthError(
            "Gateway auth for OpenCode is not enabled.",
            code="gateway_not_supported_for_agent",
            status_code=400,
        )
    existing_selection = next(
        (
            selection
            for selection in await store.list_selections_for_profile(db, profile.id)
            if selection.agent_kind == agent_kind
        ),
        None,
    )
    selected_revision = credential.revision
    if (
        existing_selection is not None
        and existing_selection.credential_id == credential.id
        and existing_selection.credential_share_id == (share.id if share is not None else None)
        and existing_selection.materialization_mode == plan.materialization_mode
        and existing_selection.selected_revision == selected_revision
        and existing_selection.status == "active"
        and existing_selection.last_error_code is None
        and existing_selection.last_error_message is None
        and not force_restart
    ):
        return existing_selection
    if (
        existing_selection is not None
        and existing_selection.status == "active"
        and existing_selection.materialization_mode == "gateway_env"
        and (
            existing_selection.credential_id != credential.id
            or existing_selection.credential_share_id != (share.id if share is not None else None)
            or existing_selection.materialization_mode != plan.materialization_mode
            or existing_selection.selected_revision != selected_revision
        )
    ):
        await _disable_bifrost_runtime_materializations_for_selection(
            db,
            selection=existing_selection,
        )
    selection = await store.upsert_selection(
        db,
        sandbox_profile_id=profile.id,
        owner_scope=profile.owner_scope,
        agent_kind=agent_kind,
        credential_id=credential.id,
        credential_share_id=share.id if share is not None else None,
        materialization_mode=plan.materialization_mode,
        selected_revision=selected_revision,
        status="active",
        last_error_code=None,
        last_error_message=None,
    )
    updated_profile = await store.bump_sandbox_profile_agent_auth_revision(
        db,
        sandbox_profile_id=profile.id,
        reason="selection_changed",
        actor_user_id=actor_user_id,
        force_restart=force_restart,
    )
    if updated_profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.", code="sandbox_profile_not_found", status_code=404
        )
    await _mark_target_pending_and_queue_refresh(
        db,
        profile=updated_profile,
        actor_user_id=actor_user_id,
        reason="selection_changed",
        force_restart=force_restart,
    )
    await store.record_audit_event(
        db,
        action="selection.write",
        actor_user_id=actor_user_id,
        owner_scope=profile.owner_scope,
        owner_user_id=profile.owner_user_id,
        organization_id=profile.organization_id,
        credential_id=credential.id,
        sandbox_profile_id=profile.id,
        metadata_json=json.dumps(
            {
                "agentKind": agent_kind,
                "credentialShareId": str(share.id) if share else None,
                "forceRestart": force_restart,
                "revision": updated_profile.agent_auth_revision,
            },
            sort_keys=True,
        ),
    )
    return selection


async def list_target_states(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
) -> tuple[SandboxProfileAgentAuthTargetStateRecord, ...]:
    profile = await _require_profile_access(db, actor_user_id, sandbox_profile_id, admin=False)
    return await store.list_target_states_for_profile(db, profile.id)
