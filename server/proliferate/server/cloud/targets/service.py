"""Cloud target registry orchestration."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync.target_records import (
    DirectAttachPolicy,
    TargetAccessScope,
    TargetKind,
    TargetPersistenceClass,
    TargetUpdateChannel,
)
from proliferate.db.store.cloud_sync.targets import (
    create_target_enrollment as insert_target_enrollment,
)
from proliferate.db.store.cloud_sync.targets import (
    get_target_detail_for_user,
    list_targets_for_user,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.targets.models import (
    EnrollmentResponse,
    TargetSummary,
    target_summary_payload,
)
from proliferate.utils.time import utcnow


async def create_target_enrollment(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_kind: str,
    display_name: str,
    access_scope: str,
    ttl_minutes: int,
    default_workspace_root: str | None = None,
    persistence_class: str = "unknown",
    direct_attach_policy: str = "disabled",
    update_channel: str = "stable",
) -> EnrollmentResponse:
    token = secrets.token_urlsafe(32)
    enrollment = await insert_target_enrollment(
        db,
        org_id=user_id,
        owner_user_id=user_id,
        created_by_user_id=user_id,
        token_hash=_sha256(token),
        display_name=display_name,
        kind=TargetKind(target_kind),
        access_scope=TargetAccessScope(access_scope),
        expires_at=utcnow() + timedelta(minutes=ttl_minutes),
        default_workspace_root=default_workspace_root,
        persistence_class=TargetPersistenceClass(persistence_class),
        direct_attach_policy=DirectAttachPolicy(direct_attach_policy),
        cloud_sync_enabled=True,
        update_channel=TargetUpdateChannel(update_channel),
    )
    return EnrollmentResponse(
        enrollment_id=enrollment.id,
        target_id=enrollment.target_id,
        token=token,
        expires_at=enrollment.expires_at,
    )


async def list_targets(db: AsyncSession, *, user_id: UUID) -> list[TargetSummary]:
    targets = await list_targets_for_user(db, user_id=user_id)
    return [target_summary_payload(target) for target in targets]


async def get_target_detail(
    db: AsyncSession,
    *,
    user_id: UUID,
    target_id: UUID,
) -> TargetSummary:
    target = await get_target_detail_for_user(db, user_id=user_id, target_id=target_id)
    if target is None:
        raise CloudApiError("target_not_found", "Target not found.", status_code=404)
    return target_summary_payload(target)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
