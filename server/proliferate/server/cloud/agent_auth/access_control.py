"""Agent-auth access control concern."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    AgentAuthCredentialRecord,
    SandboxProfileRecord,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError

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


async def _require_profile_access(
    db: AsyncSession,
    actor_user_id: UUID,
    sandbox_profile_id: UUID,
    *,
    admin: bool,
) -> SandboxProfileRecord:
    profile = await store.get_sandbox_profile(db, sandbox_profile_id)
    if profile is None:
        raise AgentAuthError(
            "Sandbox profile not found.", code="sandbox_profile_not_found", status_code=404
        )
    if profile.owner_scope == "personal":
        if profile.owner_user_id != actor_user_id:
            raise AgentAuthError(
                "Sandbox profile not found.", code="sandbox_profile_not_found", status_code=404
            )
        return profile
    if profile.organization_id is None:
        raise AgentAuthError("Sandbox profile is invalid.", code="invalid_sandbox_profile")
    if admin:
        await _require_organization_admin(db, actor_user_id, profile.organization_id)
    else:
        await _require_organization_member(db, actor_user_id, profile.organization_id)
    return profile


async def _require_can_manage_credential(
    db: AsyncSession,
    actor_user_id: UUID,
    credential: AgentAuthCredentialRecord,
) -> None:
    if credential.owner_scope == "personal":
        if credential.owner_user_id != actor_user_id:
            raise AgentAuthError(
                "Credential not found.", code="credential_not_found", status_code=404
            )
        return
    if credential.owner_scope == "organization" and credential.organization_id is not None:
        await _require_organization_admin(db, actor_user_id, credential.organization_id)
        return
    raise AgentAuthError(
        "Credential cannot be modified.", code="credential_modify_forbidden", status_code=403
    )


async def _require_organization_member(
    db: AsyncSession,
    actor_user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )
    if membership is None:
        raise AgentAuthError(
            "Organization not found.", code="organization_not_found", status_code=404
        )


async def _require_organization_admin(
    db: AsyncSession,
    actor_user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )
    if membership is None:
        raise AgentAuthError(
            "Organization not found.", code="organization_not_found", status_code=404
        )
    if membership.role not in _ORG_ADMIN_ROLES:
        raise AgentAuthError(
            "You do not have permission to manage this organization.",
            code="organization_permission_denied",
            status_code=403,
        )
