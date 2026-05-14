"""Application service for cloud compute target operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetStatus
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import inventory as inventory_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.server.cloud.compute.domain.policy import (
    decide_compute_target_admin_membership,
)
from proliferate.server.cloud.compute.domain.rules import (
    TERMINAL_SESSION_STATUSES,
    decide_safe_stop,
    normalize_optional_version,
    normalize_update_channel,
)
from proliferate.server.cloud.compute.domain.types import ComputeRuleError
from proliferate.server.cloud.compute.models import (
    RevokeWorkersResponse,
    SafeStopCheckResponse,
    SetDesiredVersionsRequest,
    SetDesiredVersionsResponse,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.live.service import publish_target_patch_after_commit
from proliferate.server.cloud.targets.models import target_detail_payload
from proliferate.utils.time import utcnow


def _cloud_compute_rule_error(error: ComputeRuleError) -> CloudApiError:
    return CloudApiError(error.code, error.message, status_code=400)


async def _require_admin_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: User,
) -> targets_store.CloudTargetSnapshot:
    target = await targets_store.get_visible_target_by_id(
        db,
        target_id=target_id,
        user_id=user.id,
    )
    if target is None:
        raise CloudApiError(
            "cloud_compute_target_not_found",
            "Target not found.",
            status_code=404,
        )
    if target.organization_id is not None:
        membership = await organizations_store.get_active_membership(
            db,
            organization_id=target.organization_id,
            user_id=user.id,
        )
        verdict = decide_compute_target_admin_membership(
            membership_role=membership.role if membership is not None else None,
        )
        if verdict.denial == "organization_not_found":
            raise CloudApiError(
                "cloud_compute_organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        if verdict.denial == "permission_denied":
            raise CloudApiError(
                "cloud_compute_organization_permission_denied",
                "You do not have permission to manage this compute target.",
                status_code=403,
            )
    return target


async def set_desired_versions(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: User,
    body: SetDesiredVersionsRequest,
) -> SetDesiredVersionsResponse:
    target = await _require_admin_target(db, target_id=target_id, user=user)
    if target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_compute_target_archived",
            "Target is archived.",
            status_code=409,
        )
    try:
        update_channel = normalize_update_channel(body.update_channel)
        desired_anyharness_version = normalize_optional_version(body.anyharness_version)
        desired_worker_version = normalize_optional_version(body.worker_version)
        desired_supervisor_version = normalize_optional_version(body.supervisor_version)
    except ComputeRuleError as error:
        raise _cloud_compute_rule_error(error) from error
    updated = await targets_store.set_target_desired_versions(
        db,
        target_id=target.id,
        update_channel=update_channel,
        desired_anyharness_version=desired_anyharness_version,
        desired_worker_version=desired_worker_version,
        desired_supervisor_version=desired_supervisor_version,
    )
    if updated is None:
        raise CloudApiError(
            "cloud_compute_target_not_found",
            "Target not found.",
            status_code=404,
        )
    await publish_target_patch_after_commit(db, updated)
    return SetDesiredVersionsResponse(target=target_detail_payload(updated))


async def check_safe_stop(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: User,
) -> SafeStopCheckResponse:
    target = await _require_admin_target(db, target_id=target_id, user=user)
    active_session_count = await events_store.count_sessions_for_target_excluding_statuses(
        db,
        target_id=target.id,
        excluded_statuses=TERMINAL_SESSION_STATUSES,
    )
    active_command_count = await commands_store.count_active_commands_for_target(
        db,
        target_id=target.id,
    )
    verdict = decide_safe_stop(
        target_status=target.status,
        update_status=target.update_status,
        has_target_safe_stop_state=False,
        active_session_count=active_session_count,
        active_command_count=active_command_count,
    )
    return SafeStopCheckResponse(
        target_id=str(target.id),
        allowed=verdict.allowed,
        reasons=list(verdict.reasons),
        active_session_count=active_session_count,
        active_command_count=active_command_count,
    )


async def revoke_workers_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    user: User,
) -> RevokeWorkersResponse:
    target = await _require_admin_target(db, target_id=target_id, user=user)
    if target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_compute_target_archived",
            "Target is archived.",
            status_code=409,
        )
    active_session_count = await events_store.count_sessions_for_target_excluding_statuses(
        db,
        target_id=target.id,
        excluded_statuses=TERMINAL_SESSION_STATUSES,
    )
    active_command_count = await commands_store.count_active_commands_for_target(
        db,
        target_id=target.id,
    )
    if active_session_count > 0 or active_command_count > 0:
        raise CloudApiError(
            "cloud_compute_target_active_work",
            "Target has active sessions or commands.",
            status_code=409,
        )
    await worker_auth_store.archive_workers_for_target(db, target_id=target.id, now=utcnow())
    await inventory_store.upsert_target_status(
        db,
        target_id=target.id,
        worker_id=None,
        status_value=CloudTargetStatus.offline.value,
        status_detail="Workers revoked.",
    )
    await targets_store.set_target_status(
        db,
        target_id=target.id,
        status_value=CloudTargetStatus.offline.value,
    )
    refreshed = await targets_store.get_target_by_id(db, target.id)
    if refreshed is not None:
        await publish_target_patch_after_commit(db, refreshed)
    return RevokeWorkersResponse(target_id=str(target.id), revoked=True)
