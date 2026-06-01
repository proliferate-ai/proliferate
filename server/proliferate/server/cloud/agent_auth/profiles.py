"""Agent-auth profiles concern."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxProfileRecord,
)
from proliferate.server.cloud.agent_auth.access_control import _require_organization_admin
from proliferate.server.cloud.agent_auth.refresh import (
    _ensure_profile_target_refresh_if_needed,
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


async def ensure_personal_sandbox_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
) -> SandboxProfileRecord:
    profile = await store.ensure_personal_sandbox_profile(
        db,
        user_id=actor_user_id,
        created_by_user_id=actor_user_id,
    )
    await _ensure_profile_target_refresh_if_needed(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason="sandbox_profile_target_attached",
    )
    return profile


async def ensure_organization_sandbox_profile(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
) -> SandboxProfileRecord:
    await _require_organization_admin(db, actor_user_id, organization_id)
    profile = await store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=actor_user_id,
    )
    await _ensure_profile_target_refresh_if_needed(
        db,
        profile=profile,
        actor_user_id=actor_user_id,
        reason="sandbox_profile_target_attached",
    )
    return profile
