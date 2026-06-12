"""Agent-auth sharing concern."""

from __future__ import annotations

import json
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
    AgentAuthCredentialRecord,
    AgentAuthCredentialShareRecord,
)
from proliferate.server.cloud.agent_auth.access_control import (
    _require_can_manage_credential,
    _require_organization_member,
)
from proliferate.server.cloud.agent_auth.errors import AgentAuthError
from proliferate.server.cloud.agent_auth.refresh import _bump_profile_for_selection
from proliferate.server.cloud.agent_auth.router_materializations import (
    _disable_bifrost_router_materializations_for_credential,
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


async def share_personal_credential_with_organization(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    credential_id: UUID,
    organization_id: UUID,
) -> AgentAuthCredentialShareRecord:
    await _require_organization_member(db, actor_user_id, organization_id)
    credential = await store.get_credential(db, credential_id)
    if credential is None or credential.revoked_at is not None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    if credential.owner_scope != "personal" or credential.owner_user_id != actor_user_id:
        raise AgentAuthError(
            "Only the credential owner can share this credential.",
            code="credential_share_forbidden",
            status_code=403,
        )
    if credential.credential_kind != "synced_path":
        raise AgentAuthError(
            "Only synced-path credentials can be shared in V1.",
            code="credential_share_not_supported",
            status_code=400,
        )
    share = await store.create_or_reactivate_credential_share(
        db,
        credential_id=credential.id,
        owner_user_id=actor_user_id,
        organization_id=organization_id,
        shared_by_user_id=actor_user_id,
        allowed_credential_provider_id=credential.credential_provider_id,
    )
    await store.record_audit_event(
        db,
        action="credential.share",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=organization_id,
        credential_id=credential.id,
        metadata_json=json.dumps({"shareId": str(share.id)}, sort_keys=True),
    )
    return share


async def revoke_credential_share(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    share_id: UUID,
) -> AgentAuthCredentialShareRecord:
    existing = await store.get_credential_share(db, share_id)
    if existing is None:
        raise AgentAuthError(
            "Credential share not found.", code="credential_share_not_found", status_code=404
        )
    if existing.owner_user_id != actor_user_id:
        raise AgentAuthError(
            "Only the credential owner can revoke this share.",
            code="credential_share_forbidden",
            status_code=403,
        )
    share = await store.revoke_credential_share(
        db,
        share_id=share_id,
        revoked_by_user_id=actor_user_id,
    )
    if share is None:
        raise AgentAuthError(
            "Credential share not found.", code="credential_share_not_found", status_code=404
        )
    affected = await store.list_active_selections_for_credential_or_share(
        db,
        credential_share_id=share.id,
    )
    for selection in affected:
        await store.mark_selection_invalid(
            db,
            selection_id=selection.id,
            error_code="credential_share_revoked",
            error_message="Credential owner revoked the share.",
        )
        await _bump_profile_for_selection(
            db,
            selection,
            actor_user_id=actor_user_id,
            reason="credential_share_revoked",
            force_restart=True,
        )
    await store.record_audit_event(
        db,
        action="credential_share.revoke",
        actor_user_id=actor_user_id,
        owner_scope="personal",
        owner_user_id=share.owner_user_id,
        organization_id=share.organization_id,
        credential_id=share.credential_id,
        metadata_json=json.dumps({"shareId": str(share.id)}, sort_keys=True),
    )
    return share


async def revoke_credential(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    credential_id: UUID,
) -> AgentAuthCredentialRecord:
    credential = await store.get_credential(db, credential_id)
    if credential is None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    await _require_can_manage_credential(db, actor_user_id, credential)
    revoked = await store.revoke_credential(db, credential_id=credential_id)
    if revoked is None:
        raise AgentAuthError("Credential not found.", code="credential_not_found", status_code=404)
    affected = await store.list_active_selections_for_credential_or_share(
        db,
        credential_id=credential_id,
    )
    for selection in affected:
        await store.mark_selection_invalid(
            db,
            selection_id=selection.id,
            error_code="credential_revoked",
            error_message="Selected credential was revoked.",
        )
        await _bump_profile_for_selection(
            db,
            selection,
            actor_user_id=actor_user_id,
            reason="credential_revoked",
            force_restart=True,
        )
    await _disable_bifrost_router_materializations_for_credential(
        db,
        credential=credential,
    )
    await store.record_audit_event(
        db,
        action="credential.revoke",
        actor_user_id=actor_user_id,
        owner_scope=credential.owner_scope,
        owner_user_id=credential.owner_user_id,
        organization_id=credential.organization_id,
        credential_id=credential.id,
    )
    return revoked
