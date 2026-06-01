"""Application service for cloud compute targets."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
    CloudTargetKind,
    CloudTargetStatus,
)
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sync import inventory as inventory_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_sync import worker_control as worker_control_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import (
    publish_target_patch_after_commit,
    publish_worker_control_after_commit,
)
from proliferate.server.cloud.target_git_identity.service import require_user_github_auth
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership
from proliferate.server.cloud.targets.domain.rules import (
    build_install_command,
    clamp_enrollment_ttl_seconds,
    default_workspace_root_for_kind,
    normalize_target_display_name,
    validate_enrollable_kind,
    validate_owner_scope,
)
from proliferate.server.cloud.targets.models import (
    CloudTargetEnrollmentRequest,
    CloudTargetEnrollmentResponse,
    CloudTargetExistingEnrollmentRequest,
    target_detail_payload,
)
from proliferate.utils.time import utcnow


def _hash_token(*, domain: str, token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{domain}:{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _cloud_base_url() -> str:
    for candidate in (
        settings.api_base_url,
        settings.cloud_mcp_oauth_callback_base_url,
        settings.cloud_mcp_oauth_callback_fallback_base_url,
    ):
        normalized = candidate.strip().rstrip("/")
        if normalized:
            return normalized
    return "http://localhost:8000"


async def _create_enrollment_response_for_target(
    db: AsyncSession,
    *,
    target: targets_store.CloudTargetSnapshot,
    user: ActorIdentity,
    ttl_seconds: int | None,
) -> CloudTargetEnrollmentResponse:
    token = secrets.token_urlsafe(48)
    ttl = clamp_enrollment_ttl_seconds(ttl_seconds)
    expires_at = utcnow() + timedelta(seconds=ttl)
    await worker_auth_store.create_enrollment(
        db,
        target_id=target.id,
        token_hash=_hash_token(domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN, token=token),
        created_by_user_id=user.id,
        expires_at=expires_at,
    )
    install_command = build_install_command(
        installer_url=settings.proliferate_target_installer_url,
        cloud_base_url=_cloud_base_url(),
        enrollment_token=token,
        artifact_base_url=settings.proliferate_target_artifact_base_url or None,
    )
    refreshed = await targets_store.get_target_by_id(db, target.id)
    if refreshed is None:
        raise CloudApiError(
            "cloud_target_not_found",
            "Target was not created.",
            status_code=500,
        )
    return CloudTargetEnrollmentResponse(
        target=target_detail_payload(refreshed),
        enrollment_token=token,
        install_command=install_command,
        artifact_base_url=settings.proliferate_target_artifact_base_url or None,
        expires_at=expires_at.isoformat(),
    )


async def create_target_enrollment(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    body: CloudTargetEnrollmentRequest,
) -> CloudTargetEnrollmentResponse:
    kind = validate_enrollable_kind(body.kind)
    owner_scope = validate_owner_scope(
        owner_scope=body.owner_scope,
        organization_id=body.organization_id,
    )
    display_name = normalize_target_display_name(body.display_name)
    organization_id = body.organization_id if owner_scope == "organization" else None
    if organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=organization_id,
            user_id=user.id,
        )
        require_target_admin_membership(membership)
    owner_user_id = user.id if owner_scope == "personal" else None
    await require_user_github_auth(db, user_id=user.id)
    target = None
    if kind == CloudTargetKind.desktop_dispatch.value and owner_scope == "personal":
        target = await targets_store.get_active_personal_target_by_kind(
            db,
            owner_user_id=user.id,
            kind=kind,
        )
    if target is None:
        target = await targets_store.create_target(
            db,
            display_name=display_name,
            kind=kind,
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            created_by_user_id=user.id,
            default_workspace_root=default_workspace_root_for_kind(
                kind,
                body.default_workspace_root,
            ),
        )
    return await _create_enrollment_response_for_target(
        db,
        target=target,
        user=user,
        ttl_seconds=body.ttl_seconds,
    )


async def create_target_enrollment_for_existing_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: ActorIdentity,
    body: CloudTargetExistingEnrollmentRequest,
) -> CloudTargetEnrollmentResponse:
    target = await get_target_detail(db, target_id=target_id, user_id=user.id)
    validate_enrollable_kind(target.kind)
    if target.archived_at is not None or target.status == "archived":
        raise CloudApiError(
            "cloud_target_archived",
            "Target is archived.",
            status_code=409,
        )
    if target.organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=target.organization_id,
            user_id=user.id,
        )
        require_target_admin_membership(membership)
    await require_user_github_auth(db, user_id=user.id)
    now = utcnow()
    await worker_auth_store.revoke_pending_enrollments_for_target(
        db,
        target_id=target.id,
        now=now,
    )
    await worker_auth_store.archive_workers_for_target(db, target_id=target.id, now=now)
    await inventory_store.upsert_target_status(
        db,
        target_id=target.id,
        worker_id=None,
        status_value=CloudTargetStatus.enrolling.value,
        status_detail="Waiting for worker re-enrollment.",
    )
    await targets_store.set_target_status(
        db,
        target_id=target.id,
        status_value=CloudTargetStatus.enrolling.value,
    )
    return await _create_enrollment_response_for_target(
        db,
        target=target,
        user=user,
        ttl_seconds=body.ttl_seconds,
    )


async def list_targets(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[targets_store.CloudTargetSnapshot]:
    return list(await targets_store.list_visible_targets(db, user_id=user_id))


async def get_target_detail(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> targets_store.CloudTargetSnapshot:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user_id,
    )
    if target is None:
        raise CloudApiError(
            "cloud_target_not_found",
            "Target not found.",
            status_code=404,
        )
    return target


async def archive_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: ActorIdentity,
) -> targets_store.CloudTargetSnapshot:
    target = await get_target_detail(db, target_id=target_id, user_id=user.id)
    if target.organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=target.organization_id,
            user_id=user.id,
        )
        require_target_admin_membership(membership)
    archived = await targets_store.archive_target(db, target_id=target.id)
    if archived is None:
        raise CloudApiError(
            "cloud_target_not_found",
            "Target not found.",
            status_code=404,
        )
    await worker_auth_store.archive_workers_for_target(
        db,
        target_id=target.id,
        now=utcnow(),
    )
    await worker_control_store.bump_control_revision(db, target_id=target.id)
    await publish_target_patch_after_commit(db, archived)
    await publish_worker_control_after_commit(
        db,
        target_id=target.id,
        reason="state_changed",
    )
    return archived
