"""Agent-auth grant freshness concern."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudAgentKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store.cloud_agent_auth import store
from proliferate.server.cloud.agent_auth.refresh import _mark_target_pending_and_queue_refresh
from proliferate.server.cloud.agent_auth.results import (
    RuntimeGrantFreshnessReconcilePassResult,
)
from proliferate.utils.time import utcnow

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


async def reconcile_agent_gateway_runtime_grant_freshness(
    db: AsyncSession,
    *,
    limit: int = 50,
    refresh_window: timedelta = timedelta(days=2),
) -> RuntimeGrantFreshnessReconcilePassResult:
    if limit <= 0 or not settings.agent_gateway_enabled:
        return RuntimeGrantFreshnessReconcilePassResult(
            grants_checked=0,
            targets_refreshed=0,
            grants_skipped=0,
            grants_failed=0,
        )
    now = utcnow()
    grants = await store.list_runtime_grants_needing_rotation(
        db,
        now=now,
        expires_before=now + refresh_window,
        limit=limit,
    )
    refreshed_targets: set[tuple[UUID, UUID]] = set()
    skipped = 0
    failed = 0
    for grant in grants:
        key = (grant.sandbox_profile_id, grant.target_id)
        if key in refreshed_targets:
            skipped += 1
            continue
        try:
            profile = await store.get_sandbox_profile(db, grant.sandbox_profile_id)
            if profile is None:
                skipped += 1
                continue
            if profile.primary_target_id != grant.target_id:
                skipped += 1
                continue
            await _mark_target_pending_and_queue_refresh(
                db,
                profile=profile,
                actor_user_id=None,
                reason="runtime_grant_expiring",
                force_restart=True,
            )
            refreshed_targets.add(key)
        except Exception:
            failed += 1
    return RuntimeGrantFreshnessReconcilePassResult(
        grants_checked=len(grants),
        targets_refreshed=len(refreshed_targets),
        grants_skipped=skipped,
        grants_failed=failed,
    )
