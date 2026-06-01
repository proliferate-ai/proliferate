"""Application service for user-facing cloud workspace claims."""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Protocol
from uuid import UUID, uuid4

from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import PolicyDenied
from proliferate.config import settings
from proliferate.db.store import cloud_workspaces
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_claims import tokens as tokens_store
from proliferate.db.store.cloud_runtime_config import revisions as runtime_config_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.claims.access import (
    load_workspace_exposure_and_claim,
    membership_role,
    raise_policy_denied,
    require_workspace_view,
)
from proliferate.server.cloud.claims.domain.jwt import (
    DirectAttachJwtClaims,
    direct_attach_claims_payload,
    timestamp_seconds,
)
from proliferate.server.cloud.claims.domain.pem import normalize_pem_setting
from proliferate.server.cloud.claims.domain.policy import (
    can_claim_cloud_workspace,
    can_request_direct_attach_token,
    can_revoke_claim_token,
    is_org_admin_role,
)
from proliferate.server.cloud.claims.models import (
    ClaimWorkspaceResponse,
    DirectAccessTokenRequest,
    DirectAccessTokenResponse,
    RevokeClaimTokenResponse,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import publish_worker_control_after_commit
from proliferate.utils.time import utcnow

_ACTIVE_TOKEN_CAP = 5
_JTI_HASH_KEY_ID = "sha256-v1"


class ClaimActor(Protocol):
    id: UUID


async def claim_workspace(
    db: AsyncSession,
    *,
    user: ClaimActor,
    cloud_workspace_id: UUID,
    source_kind: str,
) -> ClaimWorkspaceResponse:
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(db, cloud_workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    exposure, existing_claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    role = await membership_role(db, organization_id=workspace.organization_id, user_id=user.id)
    verdict = can_claim_cloud_workspace(
        owner_scope=workspace.owner_scope,
        organization_id=workspace.organization_id,
        exposure_visibility=exposure.visibility if exposure else None,
        workspace_archived=workspace.archived_at is not None,
        has_active_organization_membership=role is not None,
        claim_exists=existing_claim is not None,
    )
    if isinstance(verdict, PolicyDenied):
        raise_policy_denied(verdict)
    if exposure is None or workspace.target_id is None:
        raise CloudApiError(
            "workspace_not_unclaimed",
            "Workspace is not available to claim.",
            status_code=409,
        )
    if workspace.organization_id is None:
        raise CloudApiError(
            "workspace_not_found",
            "Cloud workspace not found.",
            status_code=404,
        )
    now = utcnow()
    async with db.begin_nested():
        claim = await claims_store.insert_workspace_claim(
            db,
            cloud_workspace_id=workspace.id,
            exposure_id=exposure.id,
            organization_id=workspace.organization_id,
            target_id=workspace.target_id,
            anyharness_workspace_id=exposure.anyharness_workspace_id
            or workspace.anyharness_workspace_id,
            cloud_session_id=None,
            anyharness_session_id=None,
            claimed_by_user_id=user.id,
            source_kind=source_kind,
            claimed_at=now,
        )
        if claim is None:
            raise CloudApiError(
                "claim_already_held",
                "Workspace has already been claimed.",
                status_code=409,
            )
        claimed_exposure = await exposures_store.claim_workspace_exposure(
            db,
            exposure_id=exposure.id,
            claimed_by_user_id=user.id,
        )
        if claimed_exposure is None:
            raise CloudApiError(
                "workspace_not_unclaimed",
                "Workspace is not available to claim.",
                status_code=409,
            )
        await publish_worker_control_after_commit(
            db,
            target_id=workspace.target_id,
            reason="exposures",
        )
    return ClaimWorkspaceResponse(
        claim_id=str(claim.id),
        cloud_workspace_id=str(workspace.id),
        exposure_id=str(exposure.id),
        exposure_revision=claimed_exposure.revision,
        claimed_at=claim.claimed_at.isoformat(),
        claimed_by_user_id=str(user.id),
    )


async def issue_direct_access_token(
    db: AsyncSession,
    *,
    user: ClaimActor,
    cloud_workspace_id: UUID,
    body: DirectAccessTokenRequest,
    client_kind: str | None,
) -> DirectAccessTokenResponse:
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(db, cloud_workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    exposure, claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    if claim is None:
        raise CloudApiError(
            "claim_required",
            "Claim the workspace before requesting direct access.",
            status_code=409,
        )
    target = (
        await targets_store.get_target_by_id(db, workspace.target_id)
        if workspace.target_id is not None
        else None
    )
    runtime_access = (
        await targets_store.load_active_runtime_access_for_target(
            db,
            target_id=workspace.target_id,
        )
        if workspace.target_id is not None
        else None
    )
    verdict = can_request_direct_attach_token(
        actor_user_id=user.id,
        claimed_by_user_id=claim.claimed_by_user_id,
        target_kind=target.kind if target else None,
        has_anyharness_base_url=bool(runtime_access and runtime_access.anyharness_base_url),
        client_kind=client_kind,
        workspace_archived=workspace.archived_at is not None,
        exposure_visibility=exposure.visibility if exposure else None,
        exposure_claimed_by_user_id=exposure.claimed_by_user_id if exposure else None,
    )
    if isinstance(verdict, PolicyDenied):
        raise_policy_denied(verdict)
    anyharness_workspace_id = (
        claim.anyharness_workspace_id or workspace.anyharness_workspace_id or ""
    ).strip()
    if not anyharness_workspace_id:
        raise CloudApiError(
            "direct_attach_not_ready",
            "Workspace is not ready for direct Desktop attach.",
            status_code=409,
        )
    if (
        body.target_anyharness_workspace_id is not None
        and body.target_anyharness_workspace_id != anyharness_workspace_id
    ):
        raise CloudApiError(
            "direct_attach_workspace_mismatch",
            "Requested workspace does not match the claimed workspace.",
            status_code=409,
        )
    signing_key_pem = normalize_pem_setting(settings.cloud_jwt_signing_key_pem)
    if not signing_key_pem:
        raise CloudApiError(
            "direct_attach_signing_key_missing",
            "Direct workspace attach is not configured.",
            status_code=503,
        )
    if not _verification_key_configured_for_active_signing_key():
        raise CloudApiError(
            "direct_attach_verification_key_missing",
            "Direct workspace attach verification keys are not configured.",
            status_code=503,
        )
    if not await _active_signing_key_applied_to_target(db, workspace=workspace):
        raise CloudApiError(
            "direct_attach_not_ready",
            "Workspace is not ready for direct Desktop attach.",
            status_code=409,
        )
    if runtime_access is None or not runtime_access.anyharness_base_url:
        raise CloudApiError(
            "direct_attach_not_ready",
            "Workspace is not ready for direct Desktop attach.",
            status_code=409,
        )
    jti = str(uuid4())
    token_hash = claim_jti_hash(jti)
    issued_at = utcnow()
    expires_at = issued_at + timedelta(seconds=settings.cloud_jwt_direct_attach_ttl_seconds)
    permissions = _canonical_permissions(body.permissions)
    payload = direct_attach_claims_payload(
        DirectAttachJwtClaims(
            iss=settings.cloud_jwt_issuer,
            aud=settings.cloud_jwt_audience_anyharness,
            sub=str(user.id),
            exp=timestamp_seconds(expires_at),
            nbf=timestamp_seconds(issued_at),
            iat=timestamp_seconds(issued_at),
            jti=jti,
            org_id=str(claim.organization_id),
            target_id=str(claim.target_id),
            cloud_workspace_id=str(workspace.id),
            anyharness_workspace_id=anyharness_workspace_id,
            cloud_session_id=body.cloud_session_id,
            anyharness_session_id=body.anyharness_session_id,
            claim_id=str(claim.id),
            permissions=permissions,
        )
    )
    raw_token = jwt.encode(
        payload,
        signing_key_pem,
        algorithm="RS256",
        headers={"kid": settings.cloud_jwt_signing_key_id},
    )
    await tokens_store.revoke_oldest_active_tokens_for_claim(
        db,
        claim_id=claim.id,
        keep_latest=max(0, _ACTIVE_TOKEN_CAP - 1),
        reason="active_token_cap",
    )
    token_row = await tokens_store.insert_claim_token(
        db,
        claim_id=claim.id,
        token_jti_hash=token_hash,
        hash_key_id=_JTI_HASH_KEY_ID,
        token_jti_prefix=jti[:8],
        issued_to_user_id=user.id,
        target_id=claim.target_id,
        anyharness_workspace_id=anyharness_workspace_id,
        anyharness_session_id=body.anyharness_session_id,
        permissions=",".join(permissions),
        issued_at=issued_at,
        expires_at=expires_at,
    )
    return DirectAccessTokenResponse(
        token=raw_token,
        token_id=str(token_row.id),
        jti=jti,
        expires_at=expires_at.isoformat(),
        anyharness_base_url=runtime_access.anyharness_base_url,
        target_id=str(claim.target_id),
        cloud_workspace_id=str(workspace.id),
        anyharness_workspace_id=anyharness_workspace_id,
        cloud_session_id=body.cloud_session_id,
        anyharness_session_id=body.anyharness_session_id,
        permissions=permissions,
    )


async def revoke_direct_access_token(
    db: AsyncSession,
    *,
    user: ClaimActor,
    cloud_workspace_id: UUID,
    token_id: UUID,
) -> RevokeClaimTokenResponse:
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(db, cloud_workspace_id)
    if workspace is None:
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    exposure, claim = await load_workspace_exposure_and_claim(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    await require_workspace_view(
        db,
        actor_user_id=user.id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        exposure=exposure,
    )
    if claim is None:
        raise CloudApiError("claim_required", "Workspace is not claimed.", status_code=409)
    token = await tokens_store.get_claim_token_by_id(db, token_id)
    if token is None or token.claim_id != claim.id:
        raise CloudApiError(
            "claim_token_not_found",
            "Direct attach token not found.",
            status_code=404,
        )
    role = await membership_role(db, organization_id=claim.organization_id, user_id=user.id)
    verdict = can_revoke_claim_token(
        actor_user_id=user.id,
        claimed_by_user_id=claim.claimed_by_user_id,
        is_organization_admin=is_org_admin_role(role),
        token_status=token.status,
    )
    if isinstance(verdict, PolicyDenied):
        raise_policy_denied(verdict)
    revoked = await tokens_store.revoke_claim_token(
        db,
        token_id=token.id,
        reason="user_requested",
    )
    if revoked is None:
        raise CloudApiError(
            "claim_token_not_found",
            "Direct attach token not found.",
            status_code=404,
        )
    return RevokeClaimTokenResponse(
        token_id=str(revoked.id),
        status=revoked.status,
        revoked_at=revoked.revoked_at.isoformat() if revoked.revoked_at else None,
    )


async def refresh_direct_access_token(
    db: AsyncSession,
    *,
    user: ClaimActor,
    cloud_workspace_id: UUID,
    body: DirectAccessTokenRequest,
    client_kind: str | None,
) -> DirectAccessTokenResponse:
    return await issue_direct_access_token(
        db,
        user=user,
        cloud_workspace_id=cloud_workspace_id,
        body=body,
        client_kind=client_kind,
    )


def claim_jti_hash(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def _canonical_permissions(permissions: list[str]) -> list[str]:
    ordered = ("read", "write", "control")
    values = set(permissions)
    return [permission for permission in ordered if permission in values]


def _verification_key_configured_for_active_signing_key() -> bool:
    try:
        parsed = json.loads(settings.cloud_jwt_verification_keys_json)
    except json.JSONDecodeError:
        return False
    if not isinstance(parsed, list):
        return False
    for item in parsed:
        if not isinstance(item, dict):
            continue
        public_key_pem = item.get("publicKeyPem", item.get("public_key_pem"))
        if (
            item.get("kid") == settings.cloud_jwt_signing_key_id
            and item.get("algorithm", "RS256") == "RS256"
            and isinstance(public_key_pem, str)
            and public_key_pem.strip()
        ):
            return True
    return False


async def _active_signing_key_applied_to_target(
    db: AsyncSession,
    *,
    workspace,  # noqa: ANN001
) -> bool:
    if workspace.sandbox_profile_id is None or workspace.target_id is None:
        return False
    state = await agent_auth_store.get_target_state(
        db,
        sandbox_profile_id=workspace.sandbox_profile_id,
        target_id=workspace.target_id,
    )
    if (
        state is None
        or state.runtime_config_status != "applied"
        or state.applied_runtime_config_revision_id is None
    ):
        return False
    try:
        revision_id = UUID(state.applied_runtime_config_revision_id)
    except ValueError:
        return False
    revision = await runtime_config_store.get_revision_by_id(db, revision_id)
    if revision is None:
        return False
    try:
        manifest = json.loads(revision.manifest_json)
    except json.JSONDecodeError:
        return False
    if not isinstance(manifest, dict):
        return False
    direct_attach_auth = manifest.get("directAttachAuth")
    if not isinstance(direct_attach_auth, dict):
        return False
    verification_keys = direct_attach_auth.get("verificationKeys")
    if not isinstance(verification_keys, list):
        return False
    for item in verification_keys:
        if not isinstance(item, dict):
            continue
        public_key_pem = item.get("publicKeyPem", item.get("public_key_pem"))
        if (
            item.get("kid") == settings.cloud_jwt_signing_key_id
            and item.get("algorithm", "RS256") == "RS256"
            and isinstance(public_key_pem, str)
            and public_key_pem.strip()
        ):
            return True
    return False
