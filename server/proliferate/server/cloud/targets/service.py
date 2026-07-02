"""Application service for cloud compute targets.

Minimal direct-runtime reintroduction (ssh/personal-target design §3.3, §4):
enrollment creates/refreshes a target row, mints the per-runtime AnyHarness
bearer (stored as recoverable Fernet ciphertext on the row), and hands
Desktop a self-contained install command. Worker-side redemption of the
enrollment token (the ``/worker/enroll`` plane) is parked and returns with
the worker slice of the stack; the token is minted here so the install
command contract — and the installer's required env — stays stable.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.config import settings
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership
from proliferate.server.cloud.targets.domain.rules import (
    build_install_command,
    clamp_enrollment_ttl_seconds,
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
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow


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


def _mint_anyharness_bearer() -> str:
    # Same recipe as the managed-sandbox runtime token
    # (runtime/provisioning/launch.py): urlsafe, 32 bytes of entropy.
    return secrets.token_urlsafe(32)


def _enrollment_response_for_target(
    *,
    target: targets_store.CloudTargetSnapshot,
    anyharness_bearer_token: str,
    ttl_seconds: int | None,
) -> CloudTargetEnrollmentResponse:
    enrollment_token = secrets.token_urlsafe(48)
    ttl = clamp_enrollment_ttl_seconds(ttl_seconds)
    expires_at = utcnow() + timedelta(seconds=ttl)
    install_command = build_install_command(
        installer_url=settings.proliferate_target_installer_url,
        cloud_base_url=_cloud_base_url(),
        enrollment_token=enrollment_token,
        anyharness_bearer_token=anyharness_bearer_token,
        artifact_base_url=settings.proliferate_target_artifact_base_url or None,
    )
    return CloudTargetEnrollmentResponse(
        target=target_detail_payload(target),
        enrollment_token=enrollment_token,
        anyharness_bearer_token=anyharness_bearer_token,
        install_command=install_command,
        artifact_base_url=settings.proliferate_target_artifact_base_url or None,
        expires_at=expires_at.isoformat(),
    )


async def _require_org_target_admin(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> None:
    membership = await organizations_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    require_target_admin_membership(membership)


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
        await _require_org_target_admin(db, organization_id=organization_id, user_id=user.id)
    owner_user_id = user.id if owner_scope == "personal" else None
    bearer = _mint_anyharness_bearer()
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
            anyharness_bearer_token_ciphertext=encrypt_text(bearer),
        )
    else:
        # Reusing an existing row is a re-install: rotate its bearer.
        await targets_store.set_target_anyharness_bearer_ciphertext(
            db,
            target_id=target.id,
            ciphertext=encrypt_text(bearer),
        )
    return _enrollment_response_for_target(
        target=target,
        anyharness_bearer_token=bearer,
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
    if target.archived_at is not None or target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_target_archived",
            "Target is archived.",
            status_code=409,
        )
    if target.organization_id is not None:
        await _require_org_target_admin(
            db,
            organization_id=target.organization_id,
            user_id=user.id,
        )
    # A re-enrollment is a re-install: the runtime gets a fresh identity, so
    # the bearer rotates rather than resurfacing the old secret.
    bearer = _mint_anyharness_bearer()
    await targets_store.set_target_anyharness_bearer_ciphertext(
        db,
        target_id=target.id,
        ciphertext=encrypt_text(bearer),
    )
    await targets_store.set_target_status(
        db,
        target_id=target.id,
        status_value=CloudTargetStatus.enrolling.value,
    )
    refreshed = await get_target_detail(db, target_id=target.id, user_id=user.id)
    return _enrollment_response_for_target(
        target=refreshed,
        anyharness_bearer_token=bearer,
        ttl_seconds=body.ttl_seconds,
    )


async def list_targets(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[targets_store.CloudTargetSnapshot]:
    return await targets_store.list_visible_targets(db, user_id=user_id)


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


async def get_target_runtime_access(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> str:
    """Return the decrypted per-runtime bearer for direct attach.

    Personal, caller-owned targets only: the bearer is raw access material
    for a machine the user owns, so visibility (org membership) is not
    enough. Foreign, org-scoped, and unknown ids all read as 404 to avoid
    leaking target existence.
    """
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user_id,
    )
    if target is None or target.owner_scope != "personal" or target.owner_user_id != user_id:
        raise CloudApiError(
            "cloud_target_not_found",
            "Target not found.",
            status_code=404,
        )
    ciphertext = await targets_store.get_target_anyharness_bearer_ciphertext(
        db,
        target_id=target.id,
    )
    if ciphertext is None:
        raise CloudApiError(
            "cloud_target_runtime_access_unavailable",
            "No runtime bearer has been minted for this target.",
            status_code=404,
        )
    return decrypt_text(ciphertext)
